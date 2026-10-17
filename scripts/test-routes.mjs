#!/usr/bin/env node
/**
 * Route tests, with no model calls.
 *
 * The extension is plain logic: a name goes in, a rewritten message comes out.
 * Node 24 imports the TypeScript directly, so the whole routing surface can be
 * checked in a second without spending a token.
 *
 *   node scripts/test-routes.mjs
 *
 * Exit code is non-zero on any failed case.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
process.chdir(root);

const extension = (await import(pathToFileURL(path.join(root, ".pi", "extensions", "skill-routes.ts")).href)).default;

const handlers = [];
const commands = new Map();
const renderers = new Map();
const entries = [];
const pi = {
	on(event, fn) {
		handlers.push({ event, fn });
	},
	registerCommand(name, options) {
		commands.set(name, options);
	},
	registerEntryRenderer(type, factory) {
		renderers.set(type, factory);
	},
	appendEntry(type, data) {
		entries.push({ type, data });
	},
	getCommands() {
		return [];
	},
};
extension(pi);

const input = handlers.find((h) => h.event === "input");
if (!input) {
	console.error("FAIL the extension registered no input handler");
	process.exit(1);
}

const run = (text, source = "user") =>
	input.fn({ text, source }, { ui: { notify() {} } });

let failed = 0;
const check = (name, ok, detail = "") => {
	if (ok) {
		console.log(`PASS ${name}`);
	} else {
		failed += 1;
		console.log(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`);
	}
};

const transformed = async (text) => {
	const result = await run(text);
	return result.action === "transform" ? result.text : null;
};

// A skill route injects that skill's own body.
const how = await transformed("/how 为什么导出会少一行");
check("skill route /how rewrites", how !== null);
check("skill route /how carries the how body", Boolean(how && how.includes("How") && how.length > 800), how ? `${how.length} chars` : "no text");
check("skill route /how keeps the question", Boolean(how && how.includes("为什么导出会少一行")));

// A playbook route carries the router AND the steps, and says the choice is made.
const bug = await transformed("/bug-fix 导出少最后一行");
check("playbook route /bug-fix rewrites", bug !== null);
check("playbook route carries the router rules", Boolean(bug && bug.includes("Non-negotiables")));
check("playbook route carries the steps", Boolean(bug && bug.includes("Opening a PR")));
check("playbook route marks the choice", Boolean(bug && bug.includes("already chosen") && bug.includes("bug-fix")));

// Every playbook is routed, not a hand-picked subset.
for (const name of ["feature", "autonomous-run", "pause-safely", "worktree-cleanup", "shipping"]) {
	check(`playbook route /${name} exists`, (await transformed(`/${name} x`)) !== null);
}

// Layers that own their name must pass straight through.
for (const [text, why] of [
	["/poteto-mode 一个任务", "prompt template"],
	["/model sonnet", "pi command"],
	["/compact", "pi command"],
	["/routes", "our own command"],
	["/not-a-route x", "unknown name"],
	["just a sentence", "not a slash line"],
]) {
	const result = await run(text);
	check(`passes through: ${text} (${why})`, result.action === "continue", result.action);
}

// Messages the extension injected itself are never rewritten again.
const echo = await run("/how x", "extension");
check("extension-sourced input is not rewritten", echo.action === "continue", echo.action);

// `/routes` groups every playbook and explains each one, and the tables match
// the directory, so a new playbook cannot land unexplained.
// `/routes` has two output paths. The TUI gets a transcript entry, because a notify
// collapses when sent back to back. Print, json, and rpc modes get stderr, because
// pi takes stdout over there (`core/output-guard.js`) and only assistant messages
// are rendered. Both are checked; a regression in either is the bug that shipped.
const routes = commands.get("routes");
check("/routes is registered", Boolean(routes));

const notices = [];
await routes.handler("", { mode: "tui", hasUI: true, ui: { notify: (m) => notices.push(m) } });

const listing = entries.filter((e) => e.type === "routes-listing").at(-1)?.data?.text ?? "";
check("/routes appends a transcript entry in the TUI", listing.length > 0, `${entries.length} entries`);
check("/routes registers a renderer for it", renderers.has("routes-listing"));
check("/routes sends at most one notify", notices.length <= 1, `${notices.length} notices`);

const drawn = renderers
	.get("routes-listing")({ data: { text: listing } }, { expanded: true }, { fg: (_c, s) => s })
	.render(120)
	.join("\n");
check("/routes renderer draws the listing", drawn.includes("/bug-fix") && drawn.includes("/hillclimb"));

// Print mode: no entry is readable there, so the listing must reach stderr.
const stderrWrite = process.stderr.write;
let printed = "";
process.stderr.write = (chunk) => {
	printed += String(chunk);
	return true;
};
try {
	await routes.handler("", { mode: "print", hasUI: false, ui: { notify() {} } });
} finally {
	process.stderr.write = stderrWrite;
}
check("/routes writes to stderr outside the TUI", printed.includes("/bug-fix"), `${printed.length} chars`);

const dir = path.join(root, ".agents", "skills", "poteto-mode", "playbooks");
const onDisk = fs
	.readdirSync(dir)
	.filter((f) => f.endsWith(".md"))
	.map((f) => f.replace(/\.md$/, ""))
	.sort();

const routed = onDisk.filter((name) => listing.includes(`  /${name} `));
check(
	"/routes lists every playbook",
	routed.length === onDisk.length,
	`${routed.length}/${onDisk.length} listed: missing ${onDisk.filter((n) => !routed.includes(n)).join(", ") || "none"}`,
);

const unexplained = onDisk.filter((name) => {
	const line = listing.split("\n").find((l) => l.startsWith(`  /${name} `));
	return !line || line.slice(line.indexOf(`/${name}`) + name.length + 1).trim() === "";
});
check(
	"every playbook has a note",
	unexplained.length === 0,
	`unexplained: ${unexplained.join(", ") || "none"}`,
);

for (const group of ["写代码", "查问题", "设计与原型", "交付", "长时间跑", "维护自己的状态"]) {
	check(`/routes groups: ${group}`, listing.includes(group));
}

// A subdirectory session still resolves the tree.
const nested = path.join(root, "web");
if (fs.existsSync(nested)) {
	process.chdir(nested);
	const fromSubdir = (await import(`${pathToFileURL(path.join(root, ".pi", "extensions", "skill-routes.ts")).href}?subdir`)).default;
	const subCommands = new Map();
	const subEntries = [];
	fromSubdir({
		on() {},
		registerCommand(name, options) {
			subCommands.set(name, options);
		},
		registerEntryRenderer() {},
		appendEntry(type, data) {
			subEntries.push({ type, data });
		},
		getCommands() {
			return [];
		},
	});
	await subCommands.get("routes").handler("", { mode: "tui", hasUI: false, ui: { notify() {} } });
	process.chdir(root);
	const text = subEntries.at(-1)?.data?.text ?? "";
	check(
		"/routes works from a subdirectory",
		text.includes("  /bug-fix "),
		`entries: ${subEntries.length}, head: ${text.split("\n")[0]}`,
	);
}

// A foreign directory still finds the tree beside the installed extension. The
// trap is `~/.agents/skills`, which holds unrelated user skills and would stop a
// plain `.agents/skills` walk before it ever reached the package. Only the router
// marks a real tree.
if (fs.existsSync(path.join(os.homedir(), ".agents", "skills"))) {
	process.chdir(os.tmpdir());
	const fromPackage = (await import(`${pathToFileURL(path.join(root, ".pi", "extensions", "skill-routes.ts")).href}?pkg`)).default;
	const pkgCommands = new Map();
	const pkgEntries = [];
	fromPackage({
		on() {},
		registerCommand(name, options) {
			pkgCommands.set(name, options);
		},
		registerEntryRenderer() {},
		appendEntry(type, data) {
			pkgEntries.push({ type, data });
		},
		getCommands() {
			return [];
		},
	});
	await pkgCommands.get("routes").handler("", { mode: "tui", hasUI: false, ui: { notify() {} } });
	process.chdir(root);
	const text = pkgEntries.at(-1)?.data?.text ?? "";
	check(
		"/routes ignores ~/.agents/skills and finds the package tree",
		text.includes("  /bug-fix "),
		`entries: ${pkgEntries.length}, head: ${text.split("\n")[0]}`,
	);
}

console.log();
if (failed > 0) {
	console.log(`routes: ${failed} failed`);
	process.exit(1);
}
console.log("routes: all checks passed");
