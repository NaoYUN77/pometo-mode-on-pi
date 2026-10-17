/**
 * Does this project already provide a tool under the same name?
 *
 * pi's conflict check reads each extension's tool map once, at load, and treats a
 * duplicate name from a different path as fatal:
 *
 *   Error: Tool "todo" conflicts with /path/to/project/.pi/extensions/todo.ts
 *
 * That kills the session before any output. A project that vendored `todo.ts`,
 * `subagent/`, or the gh tools and then installed this package hit exactly that.
 *
 * Registering later, from `session_start`, is not a fix. `registerTool` calls
 * `refreshTools()`, which rebuilds the tool registry mid-session and leaves every
 * built-in tool without its context. The symptom is worse than the conflict:
 *
 *   Cannot read properties of undefined (reading 'includes')
 *
 * So the decision has to be made at load, before registering anything, from the
 * file tree rather than from pi's runtime. Walk up from the working directory to
 * the git root, look for a sibling extension that owns the name, and stand down
 * if one is there. The project's copy wins, which is the right precedence for a
 * project-local extension.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** Stop the upward walk at the repository root, or at the filesystem root. */
function findProjectRoot(start: string): string {
	let dir = start;
	for (;;) {
		if (fs.existsSync(path.join(dir, ".git"))) return dir;
		const parent = path.dirname(dir);
		if (parent === dir) return start;
		dir = parent;
	}
}

/** Files whose presence means "this project ships its own copy". */
const OWNED_BY: Record<string, string[]> = {
	todo: ["todo.ts", "todo.js", "todo/index.ts", "todo/index.js"],
	subagent: ["subagent/index.ts", "subagent/index.js", "subagent.ts", "subagent.js"],
	gh_issue_list: ["gh/index.ts", "gh/index.js", "gh.ts", "gh.js"],
	gh_issue_claim: ["gh/index.ts", "gh/index.js", "gh.ts", "gh.js"],
	gh_pr_create: ["gh/index.ts", "gh/index.js", "gh.ts", "gh.js"],
};

/**
 * True when this project's own `.pi/extensions/` already provides `toolName`.
 *
 * `selfDir` is the extension directory this file was loaded from. A project that
 * installed the package has its own extensions in a different directory, so a hit
 * under `selfDir` is this package's own file and does not count.
 */
export function projectOwnsTool(toolName: string, selfDir: string): boolean {
	const candidates = OWNED_BY[toolName];
	if (!candidates) return false;

	const root = findProjectRoot(process.cwd());
	const ownDir = path.join(root, ".pi", "extensions");
	if (path.resolve(ownDir) === path.resolve(selfDir)) return false;

	return candidates.some((relative) => fs.existsSync(path.join(ownDir, relative)));
}
