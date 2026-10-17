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

import * as path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
process.chdir(root);

const extension = (await import(pathToFileURL(path.join(root, ".pi", "extensions", "skill-routes.ts")).href)).default;

const handlers = [];
const pi = {
	on(event, fn) {
		handlers.push({ event, fn });
	},
	registerCommand() {},
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

console.log();
if (failed > 0) {
	console.log(`routes: ${failed} failed`);
	process.exit(1);
}
console.log("routes: all checks passed");
