/**
 * What the gh tools do, given a way to run `gh`.
 *
 * Nothing here imports pi, typebox, or the network. The exec function is passed
 * in, so scripts/verify-gh-tool.mjs drives every branch — including the failure
 * paths — with a fake `gh` and no token.
 *
 * ./index.ts supplies the real exec and registers these as tools.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildIssueClaimArgs,
	buildIssueListArgs,
	buildPrCreateArgs,
	parsePrUrl,
	renderIssueTable,
	toIssues,
	type IssueListOptions,
	type IssueClaimOptions,
	type PrCreateOptions,
	type RawIssue,
} from "./format.ts";

/** Run `gh` with these args. Throws are allowed; a non-zero code must be reported, not thrown. */
export type Exec = (
	args: string[],
	cwd: string,
	signal?: AbortSignal,
) => Promise<{ stdout: string; stderr: string; code: number }>;

/**
 * One place where a non-zero exit becomes a message the model can act on.
 * gh's own stderr is kept: it is the only thing that says *why*.
 */
async function runGh(exec: Exec, args: string[], what: string, cwd = ""): Promise<string> {
	const result = await exec(args, cwd);
	if (result.code !== 0) {
		const detail = result.stderr.trim() || `exit ${result.code}`;
		throw new Error(`${what} failed: ${detail}`);
	}
	return result.stdout;
}

export type ListResult = { issues: ReturnType<typeof toIssues>; text: string };

export async function listIssues(exec: Exec, options: IssueListOptions & { cwd?: string }): Promise<ListResult> {
	const { cwd, ...listOptions } = options;
	const stdout = await runGh(exec, buildIssueListArgs(listOptions), "gh issue list", cwd);
	let raw: RawIssue[];
	try {
		raw = JSON.parse(stdout) as RawIssue[];
	} catch {
		throw new Error(`gh issue list returned unparseable JSON: ${stdout.trim().slice(0, 200)}`);
	}
	const issues = toIssues(raw);
	return { issues, text: renderIssueTable(listOptions.repo ?? "this repo", issues) };
}

export type ClaimResult = { text: string; ran: string[] };

/**
 * Assigns, then optionally branches. Two calls rather than one so a branch
 * failure leaves the assignment visibly done instead of half-applied.
 */
export async function claimIssue(
	exec: Exec,
	options: IssueClaimOptions & { cwd?: string },
): Promise<ClaimResult> {
	const { cwd, ...claimOptions } = options;
	const commands = buildIssueClaimArgs(claimOptions);
	const ran: string[] = [];
	for (const args of commands) {
		await runGh(exec, args, `gh ${args.slice(0, 2).join(" ")}`, cwd);
		ran.push(args.slice(0, 2).join(" "));
	}
	const assignee = claimOptions.assignee ?? "@me";
	const branch = claimOptions.branch ? `, branch ${claimOptions.branch}` : "";
	return { text: `Claimed #${claimOptions.number} as ${assignee}${branch}.`, ran };
}

export type PrResult = { number: number | null; url: string; draft: boolean };

/**
 * The body goes through a temp file because pi.exec has no stdin. The directory
 * is removed in a finally, so a failed create leaks nothing.
 */
export async function createPr(
	exec: Exec,
	options: PrCreateOptions & { cwd?: string },
): Promise<PrResult> {
	const { cwd, ...prOptions } = options;
	const dir = await mkdtemp(join(tmpdir(), "pi-gh-pr-"));
	const bodyPath = join(dir, "body.md");
	try {
		await writeFile(bodyPath, prOptions.body, "utf8");
		const stdout = await runGh(exec, buildPrCreateArgs({ ...prOptions, bodyPath }), "gh pr create", cwd);

		const url = parsePrUrl(stdout);
		if (!url) {
			throw new Error(`gh pr create printed no pull URL: ${stdout.trim().slice(0, 200)}`);
		}

		let number: number | null = null;
		try {
			const viewed = await runGh(exec, ["pr", "view", url, "--json", "number"], "gh pr view", cwd);
			number = (JSON.parse(viewed) as { number: number }).number;
		} catch {
			// The PR exists. Losing its number is not worth failing the call.
		}

		return { number, url, draft: prOptions.draft ?? false };
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}
