#!/usr/bin/env node
/**
 * Does the README still describe this tree?
 *
 * Every number in README.md is a claim a reader will act on: 23 playbooks, 55
 * skills, 618 lines of playbook steps, the size of each directory. They rot
 * silently the moment a skill is added or a playbook is edited, and a README that
 * lies is worse than a short one.
 *
 *   node scripts/verify-readme.mjs
 *
 * No model call, no network.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
process.chdir(root);

const readme = fs.readFileSync("README.md", "utf8");

let failed = 0;
const check = (name, ok, detail = "") => {
	if (ok) {
		console.log(`PASS ${name}`);
	} else {
		failed += 1;
		console.log(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`);
	}
};

const skillsDir = path.join(root, ".agents", "skills");
const playbookDir = path.join(skillsDir, "poteto-mode", "playbooks");

const skillNames = fs
	.readdirSync(skillsDir, { withFileTypes: true })
	.filter((e) => e.isDirectory() && fs.existsSync(path.join(skillsDir, e.name, "SKILL.md")))
	.map((e) => e.name);

const playbookNames = fs
	.readdirSync(playbookDir)
	.filter((f) => f.endsWith(".md"))
	.map((f) => f.replace(/\.md$/, ""))
	.sort();

const lineCount = (files) =>
	files.reduce((sum, f) => sum + fs.readFileSync(f, "utf8").split("\n").length - 1, 0);

const principles = skillNames.filter((n) => n.startsWith("principle-"));
const playbookLines = lineCount(playbookNames.map((n) => path.join(playbookDir, `${n}.md`)));
const principleLines = lineCount(principles.map((n) => path.join(skillsDir, n, "SKILL.md")));
const skillLines = lineCount(skillNames.map((n) => path.join(skillsDir, n, "SKILL.md")));

// Headline counts, in both languages.
check("README says 23 playbooks", readme.includes("23 playbooks") && playbookNames.length === 23, `${playbookNames.length} on disk`);
check("README says 55 skills", readme.includes("55 skills") && skillNames.length === 55, `${skillNames.length} on disk`);
check("README says 24 principles", readme.includes("24 principles") && principles.length === 24, `${principles.length} on disk`);
check("README says 618 playbook lines", readme.includes("618") && playbookLines === 618, `${playbookLines} counted`);
check("README says 2242 skill lines", readme.includes("2242") && skillLines === 2242, `${skillLines} counted`);
check("README says 434 principle lines", readme.includes("434") && principleLines === 434, `${principleLines} counted`);

// Every playbook is named in both the English and the Chinese table, with its
// real line count beside it.
const missingEn = playbookNames.filter((n) => !readme.includes(`\`/${n}\``));
check("every playbook is named", missingEn.length === 0, `missing: ${missingEn.join(", ") || "none"}`);

const wrongLines = playbookNames.filter((n) => {
	const lines = fs.readFileSync(path.join(playbookDir, `${n}.md`), "utf8").split("\n").length - 1;
	const rows = readme.split("\n").filter((l) => l.startsWith(`| \`/${n}\` |`));
	return rows.length === 0 || rows.some((row) => !row.includes(`| ${lines} |`));
});
check("every playbook row carries its real line count", wrongLines.length === 0, `wrong: ${wrongLines.join(", ") || "none"}`);

// Both languages are present and reachable.
check("README has an English section", readme.includes("## English"));
check("README has a Chinese section", readme.includes("## 中文"));
check("README links both ways", readme.includes("[English](#english)") && readme.includes("[中文](#中文)"));

// The extension and seat inventories the README quotes.
const ext = (p) => fs.readFileSync(path.join(root, p), "utf8").split("\n").length - 1;
check("skill-routes.ts line count", readme.includes(`${ext(".pi/extensions/skill-routes.ts")} lines`), `${ext(".pi/extensions/skill-routes.ts")}`);
check("todo.ts line count", readme.includes(`${ext(".pi/extensions/todo.ts")} lines`), `${ext(".pi/extensions/todo.ts")}`);
check("bash-guard.ts line count", readme.includes(`${ext(".pi/extensions/bash-guard.ts")} lines`), `${ext(".pi/extensions/bash-guard.ts")}`);
check("subagent line count", readme.includes(`${ext(".pi/extensions/subagent/index.ts")} lines`), `${ext(".pi/extensions/subagent/index.ts")}`);

const seats = fs.readdirSync(path.join(root, ".pi", "agents")).filter((f) => f.endsWith(".md"));
check("README says 7 seats", readme.includes("7 seat") && seats.length === 7, `${seats.length} on disk`);

console.log();
if (failed > 0) {
	console.log(`readme: ${failed} failed`);
	process.exit(1);
}
console.log("readme: all checks passed");
