#!/usr/bin/env node
/**
 * Test the bash guard without spending a token.
 *
 *   node scripts/test-bash-guard.mjs
 *
 * The guard is a pure function over the command text plus one handler, so both
 * halves can be checked directly.
 */

import * as path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
process.chdir(root);

const mod = await import(pathToFileURL(path.join(root, ".pi", "extensions", "bash-guard.ts")).href);
const { offendingRoot } = mod;

let failed = 0;
const check = (name, ok, detail = "") => {
	if (ok) console.log(`PASS ${name}`);
	else {
		failed += 1;
		console.log(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`);
	}
};

const BLOCKED = [
	["find / -maxdepth 6 -type d -name agent-transcripts", "/"],
	["find / -name '*.md' 2>/dev/null | head", "/"],
	["find ~ -type d -name x", "~"],
	["find /c -maxdepth 3 -name x", "/c"],
	["find C:/ -name x", "C:/"],
	["cd /tmp && find / -name x", "/"],
	["grep -r foo /", "/"],
	["rg foo /", "/"],
	["ls -R /", "/"],
	["du -sh ~", "~"],
];

const ALLOWED = [
	"find . -maxdepth 2 -type d -name test",
	"find durable-cli-probe -name '*.ts'",
	"find /e/Code/pi-durable -maxdepth 2 -name '*.md'",
	"find /tmp -maxdepth 2 -name x",
	"grep -rn foo src/",
	"rg foo durable-cli-probe/src",
	"ls -la",
	"ls -R durable-cli-probe/src",
	"cd durable-cli-probe && npm test",
	"echo 'find / -name x'",
];

for (const [command, expect] of BLOCKED) {
	const got = offendingRoot(command);
	check(`blocks: ${command.slice(0, 52)}`, got === expect, `got ${JSON.stringify(got)}`);
}

for (const command of ALLOWED) {
	const got = offendingRoot(command);
	check(`allows: ${command.slice(0, 52)}`, got === null, `blocked on ${JSON.stringify(got)}`);
}

// The handler half: a blocked call returns a reason, an allowed one passes through.
const handlers = [];
mod.default({
	on(event, fn) {
		handlers.push({ event, fn });
	},
});
const handler = handlers.find((h) => h.event === "tool_call")?.fn;
check("registers a tool_call handler", Boolean(handler));

const call = (command) => handler({ toolName: "bash", input: { command } }, {});
const blocked = await call("find / -name x");
check("a blocked call returns block: true", blocked?.block === true && /Refusing/.test(blocked.reason ?? ""));
check("an allowed call passes through", (await call("find . -name x")) === undefined);
check("other tools are untouched", (await handler({ toolName: "read", input: {} }, {})) === undefined);

console.log();
if (failed > 0) {
	console.log(`bash guard: ${failed} failed`);
	process.exit(1);
}
console.log("bash guard: all checks passed");
