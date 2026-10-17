/**
 * Run guard: the turn cap and tool wall pi does not have built in.
 *
 * pi ships no `--max-turns` and no `--max-budget`, and a headless run will keep
 * going until it decides it is done. Claude Code has maxTurns in agent
 * frontmatter and a permissions layer; pi has extensions. This is that.
 *
 * Environment, all optional:
 *   PI_MAX_TURNS=20     stop after this many assistant turns
 *   PI_DENY_TOOLS=write,edit   block these tools outright
 *   PI_READONLY=1       block write, edit, and patch
 *
 * Turn counting is per process, so a subagent gets its own budget rather than
 * sharing the parent's.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function list(value: string | undefined): string[] {
	return (value ?? "")
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
}

export default function (pi: ExtensionAPI) {
	const maxTurns = Number.parseInt(process.env.PI_MAX_TURNS ?? "0", 10) || 0;
	const denied = new Set(list(process.env.PI_DENY_TOOLS));
	if (process.env.PI_READONLY === "1") {
		for (const tool of ["write", "edit", "patch"]) denied.add(tool);
	}

	if (denied.size > 0) {
		pi.on("tool_call", async (event) => {
			if (!denied.has(event.toolName)) return undefined;
			return {
				block: true,
				reason: `${event.toolName} is blocked for this run (PI_READONLY / PI_DENY_TOOLS)`,
			};
		});
	}

	if (maxTurns > 0) {
		let turns = 0;
		pi.on("turn_end", async (_event, ctx) => {
			turns += 1;
			if (turns < maxTurns) return;
			if (ctx.hasUI) ctx.ui.notify(`turn cap reached (${maxTurns}), stopping`, "warning");
			ctx.shutdown();
		});
	}
}
