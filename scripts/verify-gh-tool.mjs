#!/usr/bin/env node
/**
 * The gh tool's pure half, checked without a model call and without a network.
 *
 * Everything that decides what `gh` gets asked, and what the model reads back,
 * lives in `.pi/extensions/gh/format.ts` and imports nothing. So the whole
 * surface can be checked here in a second.
 *
 *   node scripts/verify-gh-tool.mjs
 *
 * Exit code is non-zero on any failed case. scripts/check.sh picks this up.
 */

import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const mod = path.join(root, ".pi", "extensions", "gh", "format.ts");

let gh;
try {
	gh = await import(pathToFileURL(mod).href);
} catch (error) {
	console.error(`FAIL cannot load ${path.relative(root, mod)}: ${error.message}`);
	process.exit(1);
}

const fails = [];
const check = (ok, label, detail = "") => {
	if (!ok) fails.push(detail ? `${label} :: ${detail}` : label);
};
const eq = (got, want, label) =>
	check(
		JSON.stringify(got) === JSON.stringify(want),
		label,
		`got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`,
	);

// --- the shape the model sees -------------------------------------------

const raw = {
	number: 42,
	title: "export drops a row",
	state: "OPEN",
	url: "https://github.com/o/r/issues/42",
	labels: [{ id: "LA_1", name: "bug" }, { id: "LA_2", name: "p1" }],
	assignees: [{ login: "nao" }],
};

const issue = gh.toIssue(raw);
eq(issue.number, 42, "toIssue keeps the number as a number");
eq(issue.labels, ["bug", "p1"], "toIssue flattens labels to names");
eq(issue.assignees, ["nao"], "toIssue flattens assignees to logins");
eq(
	Object.keys(issue).sort(),
	["assignees", "labels", "number", "state", "title", "url"],
	"toIssue emits exactly the six fields it declares",
);

eq(
	gh.toIssue({ number: 1, title: "t", state: "OPEN", url: "u" }).labels,
	[],
	"toIssue tolerates a payload without labels",
);

eq(gh.toIssues([raw, { ...raw, number: 43 }]).length, 2, "toIssues maps a list");

// --- what gh gets asked -------------------------------------------------

eq(
	gh.buildIssueListArgs({ repo: "o/r", limit: 5 }),
	[
		"issue", "list",
		"--repo", "o/r",
		"--state", "open",
		"--limit", "5",
		"--json", "number,title,state,url,labels,assignees",
	],
	"buildIssueListArgs asks for exactly the fields toIssue maps",
);

eq(
	gh.buildIssueListArgs({}).slice(0, 1),
	["issue"],
	"buildIssueListArgs still builds a command with no options",
);
check(
	!gh.buildIssueListArgs({}).includes("--repo"),
	"buildIssueListArgs omits --repo when no repo is given",
);
check(
	gh.buildIssueListArgs({ label: ["bug", "p1"] }).join(" ").includes("--label bug --label p1"),
	"buildIssueListArgs repeats --label once per label",
);
eq(
	gh.buildIssueListArgs({ state: "closed" }).includes("closed"),
	true,
	"buildIssueListArgs honours state",
);

// claim: assign, and optionally cut a linked branch
eq(
	gh.buildIssueClaimArgs({ number: 42, assignee: "@me" }),
	[["issue", "edit", "42", "--add-assignee", "@me"]],
	"buildIssueClaimArgs without a branch is one command",
);
eq(
	gh.buildIssueClaimArgs({ number: 42, assignee: "nao", branch: "fix/42", base: "main" }),
	[
		["issue", "edit", "42", "--add-assignee", "nao"],
		["issue", "develop", "42", "--name", "fix/42", "--base", "main", "--checkout"],
	],
	"buildIssueClaimArgs with a branch assigns first, then develops",
);

// pr create
eq(
	gh.buildPrCreateArgs({ title: "T", bodyPath: "/tmp/b.md" }),
	["pr", "create", "--title", "T", "--body-file", "/tmp/b.md"],
	"buildPrCreateArgs passes the body as a file",
);
check(
	!gh.buildPrCreateArgs({ title: "T", bodyPath: "/tmp/b.md" }).includes("--body"),
	"buildPrCreateArgs never uses --body, which cannot read stdin here",
);
eq(
	gh.buildPrCreateArgs({
		title: "T",
		bodyPath: "/b.md",
		base: "main",
		draft: true,
		labels: ["bug"],
		reviewers: ["nao", "sam"],
	}).slice(6),
	[
		"--base", "main",
		"--draft",
		"--label", "bug",
		"--reviewer", "nao",
		"--reviewer", "sam",
	],
	"buildPrCreateArgs adds base, draft, one --label per label, one --reviewer per reviewer",
);

// gh pr create prints the URL and nothing else worth parsing
eq(
	gh.parsePrUrl("https://github.com/o/r/pull/7\n"),
	"https://github.com/o/r/pull/7",
	"parsePrUrl takes a bare URL",
);
eq(
	gh.parsePrUrl("warning: 3 uncommitted changes\nhttps://github.com/o/r/pull/7\n"),
	"https://github.com/o/r/pull/7",
	"parsePrUrl ignores leading noise",
);
eq(gh.parsePrUrl("no git remotes found"), undefined, "parsePrUrl returns undefined when there is no URL");
eq(
	gh.parsePrUrl("see https://github.com/o/r/settings first\nhttps://github.com/o/r/pull/7\n"),
	"https://github.com/o/r/pull/7",
	"parsePrUrl picks the pull URL, not the first URL on the page",
);
eq(
	gh.parsePrUrl("created: https://github.com/o/r/pull/7.\n"),
	"https://github.com/o/r/pull/7",
	"parsePrUrl drops trailing punctuation",
);
eq(
	gh.parsePrUrl("https://github.com/o/r/issues/42"),
	undefined,
	"parsePrUrl does not mistake an issue URL for a pull URL",
);

// --- what the model reads back ------------------------------------------

const table = gh.renderIssueTable("o/r", [issue, { ...issue, number: 43, title: "x", assignees: [] }]);
check(table.includes("o/r"), "renderIssueTable names the repo");
check(table.includes("#42"), "renderIssueTable shows the number");
check(table.includes("bug,p1"), "renderIssueTable joins labels");
check(table.includes("@nao"), "renderIssueTable marks assignees with @");
check(table.includes(" - "), "renderIssueTable shows a dash for unassigned");
eq(gh.renderIssueTable("o/r", []), "o/r: no issues", "renderIssueTable handles the empty case");

const wide = gh.renderIssueTable("o/r", [{ ...issue, title: "y".repeat(200) }]);
const widest = Math.max(...wide.split("\n").map((line) => line.length));
check(widest <= 120, "renderIssueTable keeps every line under 120 chars", `widest line is ${widest}`);

// --- the confirmation gate -----------------------------------------------
//
// summarize() and WRITES decide what the user is asked before a write runs.
// They live in format.ts, not index.ts, so this is checkable: index.ts imports
// typebox, which only resolves inside pi's own loader.

check(typeof gh.summarize === "function", "format.ts exports summarize");
eq(
	gh.summarize("gh_issue_claim", { number: 7 }),
	'Assign #7 to @me?',
	"summarize defaults the claim assignee to @me",
);
eq(
	gh.summarize("gh_issue_claim", { number: 7, assignee: "nao", branch: "fix/7" }),
	"Assign #7 to nao and cut branch fix/7?",
	"summarize names the assignee and branch",
);
eq(
	gh.summarize("gh_pr_create", { title: "T" }),
	'Open a pull request titled "T"?',
	"summarize names the PR title",
);
eq(
	gh.summarize("gh_pr_create", { title: "T", base: "main", draft: true }),
	'Open a pull request into main as a draft titled "T"?',
	"summarize names the base and the draft flag",
);
eq(gh.WRITES, ["gh_issue_claim", "gh_pr_create"], "WRITES lists exactly the two write tools");
check(!gh.WRITES.includes("gh_issue_list"), "WRITES leaves the read tool out");
check(
	gh.summarize("gh_pr_create", { title: "x".repeat(300) }).length < 200,
	"summarize truncates an absurd title rather than flooding the prompt",
);

// --- the executing half, driven by a fake gh -----------------------------
//
// ops.ts takes an exec function instead of importing pi, so every failure path
// below is checked here rather than by hand against a live repository.

let ops;
try {
	ops = await import(pathToFileURL(path.join(root, ".pi", "extensions", "gh", "ops.ts")).href);
} catch (error) {
	console.error(`FAIL cannot load ops.ts: ${error.message}`);
	process.exit(1);
}

/** A fake gh that records calls and answers from a queue. */
function fakeGh(answers) {
	const calls = [];
	const exec = async (args, _cwd, _signal) => {
		calls.push(args);
		const next = answers.shift() ?? { stdout: "", stderr: "", code: 0 };
		if (next instanceof Error) throw next;
		return { stdout: "", stderr: "", code: 0, ...next };
	};
	return { exec, calls };
}

const rejects = async (promise, needle, label) => {
	try {
		await promise;
		check(false, label, "did not throw");
	} catch (error) {
		check(
			String(error.message).includes(needle),
			label,
			`message ${JSON.stringify(error.message)} lacks ${JSON.stringify(needle)}`,
		);
	}
};

// list: the happy path asks for the fields toIssue maps, and maps them
{
	const { exec, calls } = fakeGh([{ stdout: JSON.stringify([raw, { ...raw, number: 43 }]) }]);
	const result = await ops.listIssues(exec, { repo: "o/r", limit: 5 });
	eq(calls.length, 1, "listIssues runs gh exactly once");
	eq(calls[0], gh.buildIssueListArgs({ repo: "o/r", limit: 5 }), "listIssues uses buildIssueListArgs");
	eq(result.issues.length, 2, "listIssues returns mapped issues");
	eq(result.issues[0].labels, ["bug", "p1"], "listIssues maps labels");
	check(result.text.includes("#42"), "listIssues renders a table");
}

// list: a non-zero exit becomes a message naming gh's own stderr
await rejects(
	ops.listIssues(fakeGh([{ code: 1, stderr: "HTTP 404: Not Found" }]).exec, { repo: "o/r" }),
	"HTTP 404",
	"listIssues surfaces gh's stderr",
);
await rejects(
	ops.listIssues(fakeGh([{ code: 4 }]).exec, {}),
	"exit 4",
	"listIssues falls back to the exit code when stderr is empty",
);

// claim: assigns first, then branches; both calls happen in that order
{
	const { exec, calls } = fakeGh([]);
	const result = await ops.claimIssue(exec, { number: 42, branch: "fix/42", base: "main" });
	eq(calls, gh.buildIssueClaimArgs({ number: 42, branch: "fix/42", base: "main" }), "claimIssue runs both commands in order");
	check(result.text.includes("#42"), "claimIssue reports the issue");
	check(result.text.includes("fix/42"), "claimIssue reports the branch");
	eq(result.ran, ["issue edit", "issue develop"], "claimIssue records both commands it ran");
}

// claim: a branch failure still leaves the assignment done, and says so
{
	const { exec, calls } = fakeGh([{}, { code: 1, stderr: "branch exists" }]);
	await rejects(ops.claimIssue(exec, { number: 42, branch: "fix/42" }), "branch exists", "claimIssue surfaces a branch failure");
	eq(calls.length, 2, "claimIssue attempted the branch after assigning");
	eq(calls[0].slice(0, 2), ["issue", "edit"], "claimIssue assigned before failing");
}

// pr: the body reaches gh through a real file that exists during the call
{
	const seen = [];
	const { exec, calls } = fakeGh([
		{ stdout: "https://github.com/o/r/pull/7\n" },
		{ stdout: JSON.stringify({ number: 7 }) },
	]);
	const bodyPathOf = (args) => {
		const at = args.indexOf("--body-file");
		return at === -1 ? undefined : args[at + 1];
	};
	// Read the body while gh is running: createPr deletes it on the way out, and
	// that deletion is asserted separately below.
	const wrapped = async (args, cwd, signal) => {
		const bodyPath = bodyPathOf(args);
		seen.push({ args: [...args], bodyPath, body: bodyPath ? readFileSync(bodyPath, "utf8") : undefined });
		return exec(args, cwd, signal);
	};
	const result = await ops.createPr(wrapped, { title: "T", body: "line one\nline two" });

	eq(result.number, 7, "createPr returns the number from pr view");
	eq(result.url, "https://github.com/o/r/pull/7", "createPr returns the url from pr create");
	eq(seen.length, 2, "createPr ran gh twice: create, then view");
	eq(seen[1].args.slice(0, 2), ["pr", "view"], "createPr looks the number up with pr view");
	eq(seen[1].args.at(-1), "number", "createPr asks pr view only for the number");
	check(
		seen[0].bodyPath.endsWith("body.md"),
		"createPr points --body-file at a body.md",
		seen[0].bodyPath,
	);
	eq(seen[0].body, "line one\nline two", "createPr wrote the body verbatim while gh ran");
	check(!existsSync(seen[0].bodyPath), "createPr removed the body file afterwards");
}

// every op forwards the caller's signal, so a cancelled run can stop gh
{
	const seen = [];
	const controller = new AbortController();
	const exec = async (args, _cwd, signal) => {
		seen.push(signal);
		return { stdout: JSON.stringify([]), stderr: "", code: 0 };
	};
	await ops.listIssues(exec, { repo: "o/r" }, controller.signal);
	eq(seen[0], controller.signal, "listIssues forwards the signal to gh");
}
{
	const seen = [];
	const controller = new AbortController();
	const exec = async (args, _cwd, signal) => {
		seen.push(signal);
		return { stdout: "https://github.com/o/r/pull/7", stderr: "", code: 0 };
	};
	await ops.createPr(exec, { title: "T", body: "b" }, controller.signal);
	eq(seen[0], controller.signal, "createPr forwards the signal to gh");
}
{
	const seen = [];
	const controller = new AbortController();
	const exec = async (args, _cwd, signal) => {
		seen.push(signal);
		return { stdout: "", stderr: "", code: 0 };
	};
	await ops.claimIssue(exec, { number: 1 }, controller.signal);
	eq(seen[0], controller.signal, "claimIssue forwards the signal to gh");
}

// pr: losing the number is not worth failing an opened pull request
{
	const { exec } = fakeGh([{ stdout: "https://github.com/o/r/pull/7" }, { code: 1, stderr: "boom" }]);
	const result = await ops.createPr(exec, { title: "T", body: "b" });
	eq(result.number, null, "createPr tolerates a failed pr view");
	eq(result.url, "https://github.com/o/r/pull/7", "createPr still reports the url");
}

// pr: no URL in the output is a real failure, not a silent success
await rejects(
	ops.createPr(fakeGh([{ stdout: "no git remotes found" }]).exec, { title: "T", body: "b" }),
	"no pull URL",
	"createPr fails when gh printed no URL",
);

// pr: the temp directory is cleaned even when gh fails
{
	let leaked;
	const { exec } = fakeGh([{ code: 1, stderr: "nope" }]);
	const wrapped = async (args, cwd, signal) => {
		leaked = args[args.indexOf("--body-file") + 1];
		return exec(args, cwd, signal);
	};
	await rejects(ops.createPr(wrapped, { title: "T", body: "b" }), "nope", "createPr surfaces a create failure");
	check(!existsSync(leaked), "createPr removed the body file after a failure");
}

// --- reporting ----------------------------------------------------------

if (fails.length) {
	console.error(fails.join("\n"));
	console.error(`\nverify-gh-tool: ${fails.length} failed`);
	process.exit(1);
}
console.log("ok: gh tool arguments, payload mapping, and rendering within contract");
