/**
 * GitHub tools: list issues, claim one, open a pull request.
 *
 * Three tools, all thin. Every decision about what `gh` is asked and what the
 * model reads back lives in ./format.ts, which imports nothing and is checked by
 * scripts/verify-gh-tool.mjs without a network or a model call. This file only
 * spawns `gh`, maps exit codes to results, and registers the tools.
 *
 * Two constraints shaped it:
 *
 *   pi.exec has no stdin. A PR body therefore goes through a temp file and
 *   `--body-file`, never `--body`.
 *
 *   `gh pr create` prints the new URL and nothing structured, so the PR number
 *   costs a second `gh pr view --json` call.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	buildIssueClaimArgs,
	buildIssueListArgs,
	buildPrCreateArgs,
	parsePrUrl,
	renderIssueTable,
	toIssues,
	type Issue,
	type RawIssue,
} from "./format.ts";
import { projectOwnsTool } from "../../lib/project-tools.ts";

const GH_TIMEOUT = 60_000;

type Exec = (args: string[], cwd: string, signal?: AbortSignal) => Promise<{ stdout: string; stderr: string; code: number }>;

/** One place where a non-zero exit becomes a message the model can act on. */
async function gh(exec: Exec, args: string[], what: string) {
	const result = await exec(args, "", undefined);
	if (result.code !== 0) {
		const detail = result.stderr.trim() || `exit ${result.code}`;
		throw new Error(`${what} failed: ${detail}`);
	}
	return result.stdout;
}

export default function (pi: ExtensionAPI) {
	const run: Exec = async (args, cwd, signal) => {
		const result = await pi.exec("gh", args, { cwd: cwd || undefined, signal, timeout: GH_TIMEOUT });
		return { stdout: result.stdout, stderr: result.stderr, code: result.code };
	};

	// The project's own gh extension wins, if it has one. A second registration
	// of the same tool name is a load-time conflict pi treats as fatal.
	if (projectOwnsTool("gh_issue_list", import.meta.dirname)) return;

	// --- read ------------------------------------------------------------

	pi.registerTool({
		name: "gh_issue_list",
		label: "List GitHub issues",
		description:
			"List issues in a GitHub repository as a compact table. Read-only. " +
			"Use when the user asks what is open, or before claiming an issue.",
		promptSnippet: "List GitHub issues as a table",
		annotations: { readOnlyHint: true, openWorldHint: true },
		parameters: Type.Object({
			repo: Type.Optional(Type.String({ description: "owner/name. Defaults to the repo of the working directory" })),
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
			const args = buildIssueListArgs(params);
			const stdout = await gh((a, _c, s) => run(a, ctx.cwd, s), args, "gh issue list");
			const issues = toIssues(JSON.parse(stdout) as RawIssue[]);
			return {
				content: [{ type: "text", text: renderIssueTable(params.repo ?? "this repo", issues) }],
				details: { issues, repo: params.repo ?? null },
			};
		},
	});

	// --- write -----------------------------------------------------------

	pi.registerTool({
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
			branch: Type.Optional(Type.String({ description: "Create and check out a linked branch with this name" })),
			base: Type.Optional(Type.String({ description: "Branch the new branch starts from" })),
		}),

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const commands = buildIssueClaimArgs(params);
			const done: string[] = [];
			for (const args of commands) {
				await gh((a, _c, s) => run(a, ctx.cwd, s), args, `gh ${args.slice(0, 2).join(" ")}`);
				done.push(args.slice(0, 2).join(" "));
			}
			const assignee = params.assignee ?? "@me";
			const branch = params.branch ? `, branch ${params.branch}` : "";
			return {
				content: [{ type: "text", text: `Claimed #${params.number} as ${assignee}${branch}.` }],
				details: { number: params.number, assignee, branch: params.branch ?? null, ran: done },
			};
		},
	});

	pi.registerTool({
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
			const dir = await mkdtemp(join(tmpdir(), "pi-gh-pr-"));
			const bodyPath = join(dir, "body.md");
			try {
				await writeFile(bodyPath, params.body, "utf8");
				const args = buildPrCreateArgs({ ...params, bodyPath });
				const stdout = await gh((a, _c, s) => run(a, ctx.cwd, s), args, "gh pr create");

				const url = parsePrUrl(stdout);
				if (!url) {
					throw new Error(`gh pr create printed no pull URL: ${stdout.trim().slice(0, 200)}`);
				}

				let number: number | null = null;
				try {
					const viewed = await gh(
						(a, _c, s) => run(a, ctx.cwd, s),
						["pr", "view", url, "--json", "number"],
						"gh pr view",
					);
					number = (JSON.parse(viewed) as { number: number }).number;
				} catch {
					// The PR exists. Losing its number is not worth failing the call.
				}

				const label = number ? `PR #${number}` : "PR";
				return {
					content: [{ type: "text", text: `Opened ${label}: ${url}` }],
					details: { number, url, draft: params.draft ?? false },
				};
			} finally {
				await rm(dir, { recursive: true, force: true });
			}
		},
	});
}
