#!/usr/bin/env node
/**
 * A seat's short model name, and the id it stands for.
 *
 *   node scripts/test-model-resolve.mjs
 *
 * A seat file may write `model: pro` instead of a full `provider/id`, and list
 * what `pro` means in its own `models:` block. The name is looked up, the id is
 * what reaches pi, and a name the block does not define is refused with the names
 * it does define — not passed to pi as a model id that cannot exist.
 *
 * The discovery half runs against a temp project, so the real `.pi/agents/` can
 * change without moving this test.
 */

import * as fs from "node:fs";
import { register } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");

register(pathToFileURL(path.join(root, "scripts", "pi-resolve.mjs")).href);

let failed = 0;
const check = (name, ok, detail = "") => {
	if (ok) console.log(`PASS ${name}`);
	else {
		failed += 1;
		console.log(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`);
	}
};

const lib = await import(pathToFileURL(path.join(root, ".pi", "lib", "model-resolve.ts")).href);
const { parseModelTable, resolveModel } = lib;

// --- the table ------------------------------------------------------------

{
	const table = parseModelTable("pro: magpie/deepseek/deepseek-v4-pro\nglm : magpie/opencode-zen/glm-5.3-flash-free\n\n# a comment is not a pair\nbroken\n");
	check("a pair becomes an entry", table.pro === "magpie/deepseek/deepseek-v4-pro", JSON.stringify(table));
	check("space before the colon is fine", table.glm === "magpie/opencode-zen/glm-5.3-flash-free");
	check("a line that is not a pair is skipped", Object.keys(table).length === 2, JSON.stringify(table));
	check("a non-string table is empty", Object.keys(parseModelTable(42)).length === 0);
}

{
	// YAML gives the block back as a map, which is the shape real seat files take.
	const table = parseModelTable({ pro: "magpie/deepseek/deepseek-v4-pro", GLM: " magpie/opencode-zen/glm-5.3-flash-free ", broken: 42 });
	check("a yaml map becomes a table", table.pro === "magpie/deepseek/deepseek-v4-pro", JSON.stringify(table));
	check("yaml map keys are lowercased and ids trimmed", table.glm === "magpie/opencode-zen/glm-5.3-flash-free", JSON.stringify(table));
	check("a non-string id is skipped", !("broken" in table), JSON.stringify(table));
}

{
	const table = parseModelTable("Pro: magpie/x/pro");
	check("names are matched case-insensitively", resolveModel("PRO", table).model === "magpie/x/pro", JSON.stringify(resolveModel("PRO", table)));
}

// --- what a model: line means ---------------------------------------------

{
	const table = parseModelTable("pro: magpie/deepseek/deepseek-v4-pro");

	const short = resolveModel("pro", table);
	check("a short name resolves to its id", short.kind === "model" && short.model === "magpie/deepseek/deepseek-v4-pro", JSON.stringify(short));

	const id = resolveModel("magpie/codex/gpt-6-luna", table);
	check("an id passes through unchanged", id.kind === "model" && id.model === "magpie/codex/gpt-6-luna", JSON.stringify(id));

	const idNamedLikeAShortName = resolveModel("pro", parseModelTable("pro: other/thing"));
	check("a short name that is also a table key takes the table", idNamedLikeAShortName.model === "other/thing", JSON.stringify(idNamedLikeAShortName));

	for (const [label, value] of [
		["an empty line", ""],
		["a whitespace line", "   "],
		["a missing line", undefined],
		["none", "none"],
		["None", "None"],
	]) {
		const result = resolveModel(value, table);
		check(`${label} inherits the parent's model`, result.kind === "inherit", JSON.stringify(result));
	}

	const unknown = resolveModel("grok", table);
	check("an undefined short name is reported, not guessed", unknown.kind === "unlisted" && unknown.name === "grok", JSON.stringify(unknown));

	const unknownId = resolveModel("magpie/nope/nothing", table);
	check("an undefined id is still passed to pi", unknownId.kind === "model" && unknownId.model === "magpie/nope/nothing", JSON.stringify(unknownId));
}

// --- discovery reads the block -------------------------------------------

if (!(await import(pathToFileURL(path.join(root, "scripts", "pi-resolve.mjs")).href)).piRoot()) {
	console.log("SKIP discovery: pi is not installed, so the extension's peer packages cannot be resolved");
} else {
	const { discoverAgents } = await import(pathToFileURL(path.join(root, ".pi", "extensions", "subagent", "agents.ts")).href);
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pstack-seats-"));
	try {
		const seatDir = path.join(dir, ".pi", "agents");
		fs.mkdirSync(seatDir, { recursive: true });
		const seat = (name, front) => fs.writeFileSync(path.join(seatDir, `${name}.md`), `---\nname: ${name}\ndescription: test seat\n${front}---\n\nbody\n`);
		seat("short", "model: pro\nmodels:\n  pro: magpie/deepseek/deepseek-v4-pro\n");
		seat("full", "model: magpie/codex/gpt-6-luna\n");
		seat("bare", "");
		seat("typo", "model: prot\nmodels:\n  pro: magpie/deepseek/deepseek-v4-pro\n");

		const result = discoverAgents(dir, "project");
		const by = (name) => result.agents.find((a) => a.name === name);

		check("a short name resolves to modelId", by("short")?.modelId === "magpie/deepseek/deepseek-v4-pro", JSON.stringify(by("short")));
		check("the seat keeps the name as written", by("short")?.model === "pro", String(by("short")?.model));
		check("an id becomes modelId itself", by("full")?.modelId === "magpie/codex/gpt-6-luna", JSON.stringify(by("full")));
		check("a seat with no model: has no modelId", by("bare")?.modelId === undefined, JSON.stringify(by("bare")));
		check("an undefined short name has no modelId", by("typo")?.modelId === undefined, JSON.stringify(by("typo")));
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}

	// --- the refusal reaches the caller --------------------------------------

	const { install } = await import(pathToFileURL(path.join(root, ".pi", "extensions", "subagent", "index.ts")).href);
	const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "pstack-seats-"));
	try {
		const seatDir = path.join(dir2, ".pi", "agents");
		fs.mkdirSync(seatDir, { recursive: true });
		fs.writeFileSync(
			path.join(seatDir, "typo.md"),
			"---\nname: typo\ndescription: test seat\nmodel: prot\nmodels:\n  pro: magpie/deepseek/deepseek-v4-pro\n---\n\nbody\n",
		);
		const tools = new Map();
		const messages = [];
		const entries = [];
		const pi = {
			registerTool: (spec) => tools.set(spec.name, spec),
			registerCommand() {},
			on() {
				return () => {};
			},
			sendMessage: (m) => messages.push(m),
			sendUserMessage() {},
			appendEntry: (e) => entries.push(e),
			getFlag() {},
		};
		const prevCwd = process.cwd();
		const prevAgentDir = process.env.PI_CODING_AGENT_DIR;
		process.chdir(dir2);
		const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pstack-agentdir-"));
		process.env.PI_CODING_AGENT_DIR = agentDir;
		try {
			install(pi, { piInvocation: { command: process.execPath, args: ["-e", "process.exit(9)"] } });
			const ctx = { cwd: dir2, hasUI: false, isProjectTrusted: () => true, sessionManager: { getSessionId: () => "s" } };
			const foreground = await tools
				.get("subagent")
				.execute("c1", { agentScope: "project", agent: "typo", task: "anything" }, undefined, undefined, ctx);
			check("a foreground call to a typo'd seat is an error", foreground.isError === true, foreground.content[0].text.slice(0, 200));
			check("the refusal names the defined short names", foreground.content[0].text.includes("Defined: pro"), foreground.content[0].text.slice(0, 200));
			check("the child was never started", !entries.some((e) => JSON.stringify(e).includes("Child exited")), JSON.stringify(entries).slice(0, 200));

			const background = await tools
				.get("subagent")
				.execute("c2", { agentScope: "project", agent: "typo", task: "anything", run_in_background: true }, undefined, undefined, ctx);
			check("a background call to a typo'd seat is an error", background.isError === true, background.content[0].text.slice(0, 200));
			check("no completion notice is posted for it", messages.length === 0, String(messages.length));
		} finally {
			process.chdir(prevCwd);
			if (prevAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = prevAgentDir;
			fs.rmSync(agentDir, { recursive: true, force: true });
		}
	} finally {
		fs.rmSync(dir2, { recursive: true, force: true });
	}
}

console.log();
if (failed > 0) {
	console.log(`model-resolve: ${failed} failed`);
	process.exit(1);
}
console.log("model-resolve: all checks passed");
