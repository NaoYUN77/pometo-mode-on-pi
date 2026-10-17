#!/usr/bin/env node
/**
 * The seat files, and the one pi flag whose meaning is easy to get wrong.
 *
 *   node scripts/test-seats.mjs
 *
 * `--tools` with plain names REPLACES the whole selection. It is not a filter on
 * top of the defaults: every tool not named, built-in or extension, is off. That
 * is what makes a read-only seat actually read-only — and what makes a seat that
 * needs `gh_issue_list` fail with no explanation if someone writes `tools: read,
 * bash` and expects the rest to stay.
 *
 * Verified against pi 1.3.0: an extension tool is absent from the child's tool
 * list when `--tools read` is passed, and present when `--exclude-tools` is used
 * instead.
 *
 * So the checks here are: a read-only seat cannot write, no seat mixes the two
 * spellings (pi rejects that outright), and the harness doc says which semantics
 * apply.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const seatDir = path.join(root, ".pi", "agents");

let failed = 0;
const check = (name, ok, detail = "") => {
	if (ok) console.log(`PASS ${name}`);
	else {
		failed += 1;
		console.log(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`);
	}
};

const files = fs.readdirSync(seatDir).filter((f) => f.endsWith(".md")).sort();
check("there are seats", files.length > 0, `${files.length}`);

/** Frontmatter `key: value`, with `tools:` split into a list. */
function readSeat(file) {
	const text = fs.readFileSync(path.join(seatDir, file), "utf8");
	const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
	const field = (key) => new RegExp(`^${key}:\\s*(.*)$`, "m").exec(front)?.[1]?.trim();
	const tools = field("tools");
	return {
		file,
		name: field("name"),
		description: field("description") ?? "",
		model: field("model"),
		tools: tools === undefined ? undefined : tools.split(",").map((t) => t.trim()).filter(Boolean),
	};
}

const seats = files.map(readSeat);

// --- every seat is addressable -------------------------------------------

for (const seat of seats) {
	check(`${seat.file}: names itself`, seat.name === path.basename(seat.file, ".md"), `name: ${seat.name}`);
	check(`${seat.file}: names a model`, Boolean(seat.model), "no model: line");
}

// --- a read-only seat cannot write ---------------------------------------
//
// The tell is in the seat's own description. If it says it only reads, its tool
// list must not carry a writer.

const WRITERS = new Set(["edit", "write"]);

for (const seat of seats) {
	if (!/read-only|readonly/i.test(seat.description)) continue;
	check(`${seat.name}: declares a tool list`, seat.tools !== undefined, "a read-only seat with no tools: gets the default writers");
	if (!seat.tools) continue;
	for (const tool of seat.tools) {
		check(
			`${seat.name}: does not carry ${tool}`,
			!WRITERS.has(tool),
			`a read-only seat lists ${tool}`,
		);
	}
}

// --- no seat mixes the two spellings -------------------------------------
//
// pi rejects a mixed list outright, so the failure would be a dead seat rather
// than a wrong one. Catch it before pi does.

for (const seat of seats) {
	if (!seat.tools || seat.tools.length === 0) continue;
	const plus = seat.tools.filter((t) => t.startsWith("+") || t.startsWith("-"));
	check(
		`${seat.name}: one spelling`,
		plus.length === 0 || plus.length === seat.tools.length,
		`mixed ${plus.length} +/- entries with ${seat.tools.length - plus.length} plain names`,
	);
}

// --- the extension passes --tools, not a filter --------------------------

{
	const body = fs.readFileSync(path.join(root, ".pi", "extensions", "subagent", "index.ts"), "utf8");
	check(
		"the subagent passes --tools for a seat's list",
		body.includes('args.push("--tools"'),
		"no --tools push found",
	);
	check(
		"the subagent passes the seat's system prompt on a file, not argv",
		body.includes('"--append-system-prompt"'),
		"no --append-system-prompt push found",
	);
}

// --- the doc says which semantics apply ----------------------------------

{
	const doc = fs.readFileSync(path.join(root, ".agents", "harness", "pi.md"), "utf8");
	check(
		"pi.md says a seat's tools: list is a full allowlist",
		/full allowlist|replaces the whole selection|entire selection/i.test(doc),
		"the trap is not documented",
	);
	check(
		"pi.md says extension tools are dropped by it",
		/extension tool/i.test(doc),
		"the consequence is not documented",
	);
}

console.log();
if (failed > 0) {
	console.log(`seats: ${failed} failed`);
	process.exit(1);
}
console.log("seats: all checks passed");
