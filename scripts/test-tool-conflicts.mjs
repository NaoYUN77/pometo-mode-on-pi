#!/usr/bin/env node
/**
 * Would this package crash a project that already ships the same tools?
 *
 * pi reads each extension's tool map once, at load, and treats a duplicate name
 * from a different path as fatal:
 *
 *   Error: Tool "todo" conflicts with /path/to/project/.pi/extensions/todo.ts
 *
 * The session then exits 1 with nothing on stdout. A project that vendored
 * `todo.ts`, `subagent/`, or the gh tools and installed this package hit exactly
 * that.
 *
 * Deferring registration to `session_start` is NOT the fix. `registerTool` calls
 * `refreshTools()`, which rebuilds the tool registry mid-session and leaves every
 * built-in tool without its context:
 *
 *   Cannot read properties of undefined (reading 'includes')
 *
 * So each extension asks, at load, whether the project already owns the name, and
 * stands down if it does. That decision is made from the file tree, not from pi's
 * runtime.
 *
 *   node scripts/test-tool-conflicts.mjs
 *
 * No model call, no network.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");

let failed = 0;
const check = (name, ok, detail = "") => {
	if (ok) {
		console.log(`PASS ${name}`);
	} else {
		failed += 1;
		console.log(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`);
	}
};

const { projectOwnsTool } = await import(
	pathToFileURL(path.join(root, ".pi", "lib", "project-tools.ts")).href
);

/** Build a throwaway project with the given files under .pi/extensions/. */
const project = (files) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pkg-conflict-"));
	fs.mkdirSync(path.join(dir, ".git"));
	fs.mkdirSync(path.join(dir, ".pi", "extensions"), { recursive: true });
	for (const file of files) {
		const target = path.join(dir, ".pi", "extensions", file);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, "");
	}
	return dir;
};

const pkgDir = path.join(root, ".pi", "extensions");
const cwdBefore = process.cwd();

// A project with its own todo.ts owns "todo".
{
	const dir = project(["todo.ts"]);
	process.chdir(dir);
	check("a project with todo.ts owns todo", projectOwnsTool("todo", pkgDir));
	check("it does not own subagent", !projectOwnsTool("subagent", pkgDir));
	check("an unknown name is never owned", !projectOwnsTool("read", pkgDir));
	process.chdir(cwdBefore);
	fs.rmSync(dir, { recursive: true, force: true });
}

// A directory form counts too, since that is how subagent and gh ship.
{
	const dir = project(["subagent/index.ts", "gh/index.ts"]);
	process.chdir(dir);
	check("subagent/index.ts owns subagent", projectOwnsTool("subagent", pkgDir));
	check("gh/index.ts owns every gh tool", projectOwnsTool("gh_issue_list", pkgDir) && projectOwnsTool("gh_pr_create", pkgDir));
	process.chdir(cwdBefore);
	fs.rmSync(dir, { recursive: true, force: true });
}

// An empty project owns nothing, so the package registers everything.
{
	const dir = project([]);
	process.chdir(dir);
	check("an empty project owns nothing", !projectOwnsTool("todo", pkgDir) && !projectOwnsTool("subagent", pkgDir));
	process.chdir(cwdBefore);
	fs.rmSync(dir, { recursive: true, force: true });
}

// This package's own directory must never count as "the project owns it", or the
// package would never register anything when used from its own checkout.
{
	process.chdir(root);
	check("this package does not shadow itself", !projectOwnsTool("todo", pkgDir), "the package dir matched its own files");
}

// A subdirectory session still finds the repository root.
{
	const dir = project(["todo.ts"]);
	const nested = path.join(dir, "packages", "app");
	fs.mkdirSync(nested, { recursive: true });
	process.chdir(nested);
	check("a subdirectory session finds the root's extensions", projectOwnsTool("todo", pkgDir));
	process.chdir(cwdBefore);
	fs.rmSync(dir, { recursive: true, force: true });
}

// Static guard: no extension may register a tool during load without checking
// first. That check is what keeps the conflict from happening at all.
for (const [file, toolName] of [
	[".pi/extensions/todo.ts", "todo"],
	[".pi/extensions/gh/index.ts", "gh_issue_list"],
	[".pi/extensions/subagent/index.ts", "subagent"],
]) {
	const body = fs.readFileSync(path.join(root, file), "utf8");
	check(`${file} asks before registering`, body.includes(`projectOwnsTool("${toolName}"`), "no projectOwnsTool guard");
}

// The helper must live outside extensions/, where pi would load it as an
// extension and reject it for having no factory.
check("the helper is not in extensions/", !fs.existsSync(path.join(root, ".pi", "extensions", "project-tools.ts")));
check("the helper exists in .pi/lib/", fs.existsSync(path.join(root, ".pi", "lib", "project-tools.ts")));

// The deferred-registration approach that broke every built-in tool must not come
// back. Its marker is a registerTool call inside a session_start handler.
for (const file of [".pi/extensions/todo.ts", ".pi/extensions/gh/index.ts", ".pi/extensions/subagent/index.ts"]) {
	const body = fs.readFileSync(path.join(root, file), "utf8");
	check(`${file} does not defer registration to session_start`, !body.includes("registerToolsWhenFree"));
}

console.log();
if (failed > 0) {
	console.log(`tool conflicts: ${failed} failed`);
	process.exit(1);
}
console.log("tool conflicts: all checks passed");
