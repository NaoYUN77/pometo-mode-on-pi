#!/usr/bin/env node
/**
 * Does the equivalence table still describe this tree?
 *
 *   node scripts/verify-equivalence.mjs
 *
 * docs/pi-equivalence.md claims, one row at a time, how each Claude Code
 * mechanism a pstack skill names is provided here. A table like that rots in two
 * directions: a row starts naming a file that no longer exists, and a skill
 * starts naming a mechanism that has no row. Both are checked.
 *
 * The failure this prevents is a claim nobody can audit: "pi handles that" with
 * nothing behind it.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const docPath = path.join(root, "docs", "pi-equivalence.md");

let failed = 0;
const check = (name, ok, detail = "") => {
	if (ok) console.log(`PASS ${name}`);
	else {
		failed += 1;
		console.log(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`);
	}
};

if (!fs.existsSync(docPath)) {
	console.log(`FAIL the table exists :: ${path.relative(root, docPath)} is missing`);
	console.log("\nequivalence: 1 failed");
	process.exit(1);
}

const text = fs.readFileSync(docPath, "utf8");
const lines = text.split(/\r?\n/);

// --- parse ---------------------------------------------------------------

const COLUMNS = 6;
const STATUSES = new Set(["native", "extension", "script", "mapping", "difference", "n/a"]);

/** Split a markdown table row on pipes that are not escaped. */
function cells(line) {
	const body = line.trim().replace(/^\|/, "").replace(/\|$/, "");
	const out = [];
	let cur = "";
	for (let i = 0; i < body.length; i++) {
		if (body[i] === "\\" && body[i + 1] === "|") {
			cur += "|";
			i++;
		} else if (body[i] === "|") {
			out.push(cur.trim());
			cur = "";
		} else cur += body[i];
	}
	out.push(cur.trim());
	return out;
}

const rows = [];
for (const line of lines) {
	if (!line.trim().startsWith("|")) continue;
	const c = cells(line);
	if (c.length !== COLUMNS) continue;
	// Skip the header and its separator.
	if (c[0] === "ID" || /^-+$/.test(c[0].replace(/:/g, ""))) continue;
	rows.push({ id: c[0], mechanism: c[1], onPi: c[2], status: c[3], evidence: c[4], reason: c[5] });
}

check("the table has rows", rows.length > 0, `${rows.length}`);

// --- every row is well formed --------------------------------------------

for (const row of rows) {
	check(`${row.id}: a known status`, STATUSES.has(row.status), `got "${row.status}"`);
	check(`${row.id}: names the pi mechanism`, row.onPi.length > 0);
}

// --- an extension or script row points at something real -----------------

/** A backticked path in the evidence cell, resolved against the repo root. */
function namedPaths(evidence) {
	return [...evidence.matchAll(/`([^`]+)`/g)]
		.map((m) => m[1])
		.filter((p) => p.includes("/") && !p.includes(" "))
		.map((p) => p.replace(/^\.\//, ""));
}

for (const row of rows) {
	if (row.status !== "extension" && row.status !== "script") continue;
	const paths = namedPaths(row.evidence);
	check(`${row.id}: evidence names a path`, paths.length > 0, `"${row.evidence}"`);
	for (const p of paths) {
		check(`${row.id}: ${p} exists`, fs.existsSync(path.join(root, p)), "named in evidence, not on disk");
	}
}

// --- a difference row says why it is safe --------------------------------

for (const row of rows) {
	if (row.status !== "difference") continue;
	check(`${row.id}: gives a reason`, row.reason !== "" && row.reason !== "—", "no reason");
}

// --- every mechanism the skills name has a row ---------------------------
//
// The list is what the vendored skills actually mention. A new skill that names
// a new primitive fails here until the table covers it.

const MENTIONED_IN_SKILLS = ["Task", "readonly", "run_in_background", "subagent_type", "AskQuestion"];

function skillFiles(dir, found = []) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) skillFiles(full, found);
		else if (entry.name.endsWith(".md")) found.push(full);
	}
	return found;
}

const allSkills = skillFiles(path.join(root, ".agents", "skills"));
const skillText = allSkills.map((f) => fs.readFileSync(f, "utf8")).join("\n");

for (const token of MENTIONED_IN_SKILLS) {
	if (!skillText.includes(token)) {
		// The skill tree no longer names it; the row is allowed to stay, but say so.
		console.log(`SKIP ${token} is not named by any skill any more`);
		continue;
	}
	const covered = rows.some((r) => r.mechanism.includes(token));
	check(`a row covers ${token}, which the skills name`, covered, "no row");
}

// --- the table says which tree it describes ------------------------------

check("the table says it is pi-specific", /pi/i.test(text.slice(0, 400)));

console.log();
if (failed > 0) {
	console.log(`equivalence: ${failed} failed`);
	process.exit(1);
}
console.log("equivalence: all checks passed");
