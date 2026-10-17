#!/usr/bin/env node
/**
 * Would this package crash a project that already ships the same tools?
 *
 * pi reports a load-time tool-name clash between two extensions as an error and
 * refuses to start the session:
 *
 *   Error: Tool "todo" conflicts with /path/to/project/.pi/extensions/todo.ts
 *
 * That is the failure this file guards. A project that vendored `todo.ts`,
 * `subagent/`, or the gh tools, then installed this package, used to get a dead
 * session with no output at all.
 *
 * The fix keeps the definitions but registers them on `session_start`, after pi's
 * one-shot conflict check has run, and skips any name the session already has.
 *
 *   node scripts/test-tool-conflicts.mjs
 *
 * No model call, no network.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
process.chdir(root);

let failed = 0;
const check = (name, ok, detail = "") => {
	if (ok) {
		console.log(`PASS ${name}`);
	} else {
		failed += 1;
		console.log(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`);
	}
};

const { registerToolsWhenFree } = await import(
	pathToFileURL(path.join(root, ".pi", "lib", "defer-tools.ts")).href
);

/** A stand-in for pi's extension API, recording what a load would do. */
const makePi = () => {
	const handlers = new Map();
	const registered = [];
	return {
		handlers,
		registered,
		pi: {
			on(event, fn) {
				if (!handlers.has(event)) handlers.set(event, []);
				handlers.get(event).push(fn);
			},
			registerTool(tool) {
				registered.push(tool.name);
			},
		},
	};
};

const tool = (name) => ({ name, description: name, parameters: {} });

// A session that already has `todo`, as a project-local extension would leave it.
{
	const { handlers, registered, pi } = makePi();
	registerToolsWhenFree(pi, [tool("todo"), tool("subagent")]);
	check("nothing registers at load", registered.length === 0, `registered: ${registered.join(",") || "none"}`);

	const ctx = { getAllTools: () => [{ name: "todo" }, { name: "read" }] };
	for (const fn of handlers.get("session_start") ?? []) await fn({ type: "session_start" }, ctx);

	check("the project's own todo wins", !registered.includes("todo"), `registered: ${registered.join(",")}`);
	check("a free name still registers", registered.includes("subagent"), `registered: ${registered.join(",")}`);
}

// An empty session gets everything.
{
	const { handlers, registered, pi } = makePi();
	registerToolsWhenFree(pi, [tool("todo"), tool("subagent")]);
	for (const fn of handlers.get("session_start") ?? []) {
		await fn({ type: "session_start" }, { getAllTools: () => [] });
	}
	check("an empty session gets every tool", registered.length === 2, `registered: ${registered.join(",")}`);
}

// A host without getAllTools must not break registration.
{
	const { handlers, registered, pi } = makePi();
	registerToolsWhenFree(pi, [tool("todo")]);
	let threw = null;
	try {
		for (const fn of handlers.get("session_start") ?? []) {
			await fn({ type: "session_start" }, {});
		}
	} catch (e) {
		threw = e;
	}
	check("a host without getAllTools still registers", threw === null && registered.includes("todo"), threw ? String(threw) : "");
}

// The real extensions must not call registerTool during load, which is the only
// window pi's conflict check looks at.
for (const file of [".pi/extensions/todo.ts", ".pi/extensions/gh/index.ts", ".pi/extensions/subagent/index.ts"]) {
	const body = fs.readFileSync(path.join(root, file), "utf8");
	const eager = /^\tpi\.registerTool\(/m.test(body);
	check(`${file} does not register a tool at load`, !eager, eager ? "found a bare pi.registerTool call" : "");
	check(`${file} uses the deferred helper`, body.includes("registerToolsWhenFree"));
}

// The helper must not sit in extensions/, where pi would load it as an extension
// and fail with "does not export a valid factory function".
check(
	"the helper lives outside extensions/",
	!fs.existsSync(path.join(root, ".pi", "extensions", "defer-tools.ts")),
);
check("the helper exists in .pi/lib/", fs.existsSync(path.join(root, ".pi", "lib", "defer-tools.ts")));

console.log();
if (failed > 0) {
	console.log(`tool conflicts: ${failed} failed`);
	process.exit(1);
}
console.log("tool conflicts: all checks passed");
