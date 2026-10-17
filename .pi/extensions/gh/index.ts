/**
 * GitHub tools: list issues, claim one, open a pull request.
 *
 * This file is only the pi-facing shell: it registers three tools and supplies
 * the real `gh` exec. Every decision about what `gh` is asked and what the model
 * reads back lives in ./format.ts and ./ops.ts, which import neither pi nor
 * typebox and are checked by scripts/verify-gh-tool.mjs with a fake `gh`, no
 * network, and no model call.
 *
 * Two constraints shaped the split:
 *
 *   pi.exec has no stdin. A PR body therefore goes through a temp file and
 *   `--body-file`, never `--body`.
 *
 *   `gh pr create` prints the new URL and nothing structured, so the PR number
 *   costs a second `gh pr view --json` call.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { WRITES, summarize } from "./format.ts";
import { claimIssue, createPr, listIssues, type Exec } from "./ops.ts";
import { registerToolsWhenFree } from "../../lib/defer-tools.ts";

const GH_TIMEOUT = 60_000;

export default function (pi: ExtensionAPI) {
	/** The real exec. cwd defaults to the session's, so `gh` sees the right repo. */
	const exec: Exec = async (args, cwd, signal) => {
		const result = await pi.exec("gh", args, { cwd: cwd || undefined, signal, timeout: GH_TIMEOUT });
		return { stdout: result.stdout, stderr: result.stderr, code: result.code };
	};

	registerToolsWhenFree(pi, [{
		name: "gh_issue_list",
		label: "List GitHub issues",
		description:
			"List issues in a GitHub repository as a compact table. Read-only. " +
			"Use when the user asks what is open, or before claiming an issue.",
		promptSnippet: "List GitHub issues as a table",
		annotations: { readOnlyHint: true, openWorldHint: true },
		parameters: Type.Object({
			repo: Type.Optional(
				Type.String({ description: "owner/name. Defaults to the repo of the working directory" }),
			),
			limit: Type.Optional(Type.Number({ description: "How many issues. Default 30" })),
			state: Type.Optional(
				Type.Union([Type.Literal("open"), Type.Literal("closed"), Type.Literal("all")], {
					description: "Default open",
				}),
			),
			label: Type.Optional(Type.Array(Type.String(), { description: "Only issues carrying every label" })),
			assignee: Type.Optional(Type.String({ description: 'Login, or "@me"' })),
		}),

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const result = await listIssues(exec, { ...params, cwd: ctx.cwd }, signal);
			return {
				content: [{ type: "text", text: result.text }],
				details: { issues: result.issues, repo: params.repo ?? null },
			};
		},
	},

	{
		name: "gh_issue_claim",
		label: "Claim a GitHub issue",
		description:
			"Assign an issue to a user and optionally cut a linked branch for it. " +
			"Assigns first, then creates the branch, so a branch failure leaves the assignment visibly done.",
		promptSnippet: "Claim a GitHub issue: assign it, optionally cut a branch",
		annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
		parameters: Type.Object({
			number: Type.Number({ description: "Issue number" }),
			assignee: Type.Optional(Type.String({ description: 'Login. Default "@me"' })),
			branch: Type.Optional(
				Type.String({ description: "Create and check out a linked branch with this name" }),
			),
			base: Type.Optional(Type.String({ description: "Branch the new branch starts from" })),
		}),

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const result = await claimIssue(exec, { ...params, cwd: ctx.cwd }, signal);
			return {
				content: [{ type: "text", text: result.text }],
				details: {
					number: params.number,
					assignee: params.assignee ?? "@me",
					branch: params.branch ?? null,
					ran: result.ran,
				},
			};
		},
	},

	{
		name: "gh_pr_create",
		label: "Open a pull request",
		description:
			"Open a pull request from the current branch. The branch must already be pushed. " +
			"Returns the PR number and URL. Not a draft unless asked.",
		promptSnippet: "Open a pull request from the current branch",
		annotations: { destructiveHint: true, openWorldHint: true },
		parameters: Type.Object({
			title: Type.String(),
			body: Type.String({ description: "Markdown description" }),
			base: Type.Optional(Type.String({ description: "Target branch, for example main" })),
			draft: Type.Optional(Type.Boolean()),
			labels: Type.Optional(Type.Array(Type.String())),
			reviewers: Type.Optional(Type.Array(Type.String())),
		}),

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const result = await createPr(exec, { ...params, cwd: ctx.cwd }, signal);
			const label = result.number ? `PR #${result.number}` : "PR";
			return {
				content: [{ type: "text", text: `Opened ${label}: ${result.url}` }],
				details: result,
			};
		},
	}]);

	/**
	 * A write to GitHub asks first. In a mode with no UI there is nobody to ask,
	 * so the call is blocked rather than silently allowed — the fail-safe that
	 * pi's own tool_call contract asks for.
	 */
	pi.on("tool_call", async (event, ctx) => {
		if (!WRITES.includes(event.toolName)) return undefined;

		const question = summarize(event.toolName, event.input);
		if (!ctx.hasUI) {
			return { block: true, reason: `${event.toolName} needs confirmation, and this mode has no UI: ${question}` };
		}

		const allowed = await ctx.ui.confirm("GitHub", question);
		if (!allowed) {
			return { block: true, reason: `Declined: ${question}` };
		}
		return undefined;
	});
}
