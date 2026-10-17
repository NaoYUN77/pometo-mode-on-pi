/**
 * The gh tool's pure half: what to ask `gh`, what the model reads back.
 *
 * Nothing here imports, touches the network, or reads a clock. That is on
 * purpose — scripts/verify-gh-tool.mjs imports this file directly and checks
 * every branch of it in a second, with no model call and no GitHub token.
 *
 * gh.ts does the executing and the tool registration; this file decides the
 * arguments and the text.
 */

export type RawIssue = {
	number: number;
	title: string;
	state?: string;
	url?: string;
	labels?: { name: string }[];
	assignees?: { login: string }[];
};

export type Issue = {
	number: number;
	title: string;
	state: string;
	url: string;
	labels: string[];
	assignees: string[];
};

/** The fields `toIssue` maps. Anything else `gh` can return stays out of the payload. */
export const ISSUE_JSON_FIELDS = ["number", "title", "state", "url", "labels", "assignees"] as const;

const MAX_TABLE_WIDTH = 120;

/** Flatten gh's `{id,name}` / `{login}` objects into the two string arrays the model reads. */
export function toIssue(raw: RawIssue): Issue {
	return {
		number: raw.number,
		title: raw.title,
		state: raw.state ?? "OPEN",
		url: raw.url ?? "",
		labels: (raw.labels ?? []).map((label) => label.name),
		assignees: (raw.assignees ?? []).map((assignee) => assignee.login),
	};
}

export function toIssues(raw: RawIssue[]): Issue[] {
	return raw.map(toIssue);
}

export type IssueListOptions = {
	repo?: string;
	limit?: number;
	state?: "open" | "closed" | "all";
	label?: string[];
	assignee?: string;
};

export function buildIssueListArgs(options: IssueListOptions): string[] {
	const args = ["issue", "list"];
	if (options.repo) args.push("--repo", options.repo);
	args.push("--state", options.state ?? "open");
	args.push("--limit", String(options.limit ?? 30));
	for (const label of options.label ?? []) args.push("--label", label);
	if (options.assignee) args.push("--assignee", options.assignee);
	args.push("--json", ISSUE_JSON_FIELDS.join(","));
	return args;
}

export type IssueClaimOptions = {
	number: number;
	assignee?: string;
	branch?: string;
	base?: string;
};

/**
 * One command, or two. Assigning is separate from cutting the branch so a
 * failure in the second leaves the first visibly done rather than half-applied
 * inside one call.
 */
export function buildIssueClaimArgs(options: IssueClaimOptions): string[][] {
	const number = String(options.number);
	const commands = [
		["issue", "edit", number, "--add-assignee", options.assignee ?? "@me"],
	];
	if (options.branch) {
		const develop = ["issue", "develop", number, "--name", options.branch];
		if (options.base) develop.push("--base", options.base);
		develop.push("--checkout");
		commands.push(develop);
	}
	return commands;
}

export type PrCreateOptions = {
	title: string;
	bodyPath: string;
	base?: string;
	draft?: boolean;
	labels?: string[];
	reviewers?: string[];
};

/**
 * `--body-file`, never `--body`. pi.exec has no stdin, so a body written to a
 * temp file is the only way to pass multi-line markdown through unharmed.
 */
export function buildPrCreateArgs(options: PrCreateOptions): string[] {
	const args = ["pr", "create", "--title", options.title, "--body-file", options.bodyPath];
	if (options.base) args.push("--base", options.base);
	if (options.draft) args.push("--draft");
	for (const label of options.labels ?? []) args.push("--label", label);
	for (const reviewer of options.reviewers ?? []) args.push("--reviewer", reviewer);
	return args;
}

/**
 * `gh pr create` prints the new URL and nothing structured. Warnings can precede
 * it, so scan for the URL rather than trusting the first or last line.
 */
export function parsePrUrl(stdout: string): string | undefined {
	const match = stdout.match(/https:\/\/[^\s/]+\/[^\s/]+\/[^\s/]+\/pull\/\d+/);
	return match?.[0];
}

function pad(text: string, width: number): string {
	return text.length >= width ? text.slice(0, width) : text + " ".repeat(width - text.length);
}

/** A fixed-width table, hard-capped at 120 columns so one long title cannot flood context. */
export function renderIssueTable(repo: string, issues: Issue[]): string {
	if (issues.length === 0) return `${repo}: no issues`;

	const numberWidth = Math.max(...issues.map((issue) => String(issue.number).length)) + 1;
	const labelWidth = 18;
	const assigneeWidth = 16;
	const titleWidth = Math.max(
		20,
		MAX_TABLE_WIDTH - numberWidth - labelWidth - assigneeWidth - 4,
	);

	const lines = [`${repo}: ${issues.length} issue${issues.length === 1 ? "" : "s"}`];
	for (const issue of issues) {
		const labels = issue.labels.length ? issue.labels.join(",") : "-";
		const assignees = issue.assignees.length ? issue.assignees.map((a) => `@${a}`).join(",") : "-";
		lines.push(
			`${pad(`#${issue.number}`, numberWidth)} ${pad(labels, labelWidth)} ${pad(assignees, assigneeWidth)} ${pad(issue.title, titleWidth).trimEnd()}`,
		);
	}
	return lines.join("\n");
}

/**
 * Tools that change something on GitHub. These ask before running.
 * A plain array, not a Set, so the verify script can compare it whole.
 */
export const WRITES = ["gh_issue_claim", "gh_pr_create"];

const MAX_QUESTION = 160;

/**
 * One line the user can judge at a glance. Never a wall of text: a 300-character
 * title would otherwise bury the part that matters.
 */
export function summarize(toolName: string, input: Record<string, unknown>): string {
	let text: string;
	if (toolName === "gh_issue_claim") {
		const assignee = input.assignee ?? "@me";
		const branch = input.branch ? ` and cut branch ${input.branch}` : "";
		text = `Assign #${input.number} to ${assignee}${branch}?`;
	} else {
		const base = input.base ? ` into ${input.base}` : "";
		const draft = input.draft ? " as a draft" : "";
		text = `Open a pull request${base}${draft} titled ${JSON.stringify(input.title)}?`;
	}
	return text.length > MAX_QUESTION ? `${text.slice(0, MAX_QUESTION - 1)}…` : text;
}
