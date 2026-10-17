/**
 * Register a tool only if this session does not already have one by that name.
 *
 * A package cannot know what the project it lands in already provides. This repo
 * ships `todo`, `subagent`, and three `gh_*` tools, and a project that vendored
 * the same extensions registers the same names. pi reports that as a load-time
 * conflict and refuses to start the session at all, not a degraded one:
 *
 *   Error: Tool "todo" conflicts with /path/to/project/.pi/extensions/todo.ts
 *
 * Two facts make the fix cheap.
 *
 * pi's conflict check reads `extension.tools` once, at load. A tool registered
 * later, from `session_start`, is not in that map when the check runs, so it never
 * trips. `registerTool` stays callable after load, and calling it twice with the
 * same name is a plain overwrite rather than an error.
 *
 * So: keep the definition, register it on `session_start`, and skip it when
 * `getAllTools()` already lists the name. That leaves the project's own copy
 * winning, which is what a project-local extension should do.
 *
 * `getAllTools()` is empty during load and populated by `session_start`, which is
 * why the check has to live there rather than beside the definition.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** A tool definition, in the shape `pi.registerTool` accepts. */
export type DeferredTool = Parameters<ExtensionAPI["registerTool"]>[0];

/** Names to claim, in registration order. */
export function registerToolsWhenFree(pi: ExtensionAPI, tools: DeferredTool[]): void {
	pi.on("session_start", async (_event, ctx) => {
		let taken: string[] = [];
		try {
			taken = ctx.getAllTools().map((tool) => tool.name);
		} catch {
			// An older host, or a context without the action. Registering is still
			// the right move; a genuine conflict surfaces as a diagnostic.
		}
		for (const tool of tools) {
			if (taken.includes(tool.name)) continue;
			pi.registerTool(tool);
		}
	});
}
