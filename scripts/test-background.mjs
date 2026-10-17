#!/usr/bin/env node
/**
 * The background path, end to end, without a model.
 *
 *   node scripts/test-background.mjs
 *
 * `install(pi, { piInvocation })` takes the child command as a parameter for
 * exactly this: the fake in scripts/fake-pi.mjs stands in for `pi`, so the launch,
 * the registry, the completion notice, and `send_message` all run for real.
 *
 * What is checked here is the wiring the child tests cannot see: that a
 * background launch returns an id at once, that the id addresses the run, that a
 * steer reaches it, that a steer to a finished run is refused rather than
 * claimed, and that the notice arrives once with the result.
 */

import * as fs from "node:fs";
import { register } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const fake = path.join(root, "scripts", "fake-pi.mjs");

// The extension imports pi's packages as peers. In production pi resolves them;
// here a loader hook points at pi's own installation.
register(pathToFileURL(path.join(root, "scripts", "pi-resolve.mjs")).href);

// A case that fails midway never reaches its cleanup, so sweep on exit too.
const created = [];
process.on("exit", () => {
	for (const dir of created) {
		try {
			fs.rmSync(dir, { recursive: true, force: true });
		} catch {
			/* the OS will get it */
		}
	}
});

const alive = (pid) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return e.code === "EPERM";
	}
};

let failed = 0;
const check = (name, ok, detail = "") => {
	if (ok) console.log(`PASS ${name}`);
	else {
		failed += 1;
		console.log(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`);
	}
};

const { piRoot } = await import(pathToFileURL(path.join(root, "scripts", "pi-resolve.mjs")).href);
if (!piRoot()) {
	console.log("SKIP background: pi is not installed, so the extension's peer packages cannot be resolved");
	process.exit(0);
}

const { install } = await import(pathToFileURL(path.join(root, ".pi", "extensions", "subagent", "index.ts")).href);

/** A temp project with one seat, so discovery has something to find. */
function project(script, seat = "worker") {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pstack-bg-"));
	created.push(dir);
	fs.mkdirSync(path.join(dir, ".pi", "agents"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".pi", "agents", `${seat}.md`),
		`---\nname: ${seat}\ndescription: test seat\n---\n\nYou are a test seat.\n`,
	);
	const scriptFile = path.join(dir, "script.json");
	fs.writeFileSync(scriptFile, JSON.stringify(script));
	const logFile = path.join(dir, "log.jsonl");
	const pidFile = path.join(dir, "child.pid");
	// The extension stands down when the *working directory's* project ships the
	// same tool, and this repo does. A temp project makes it register.
	process.chdir(dir);
	const entries = () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
	return {
		dir,
		entries,
		of: (kind) => entries().filter((e) => e.kind === kind),
		async until(predicate, ms = 8000) {
			const started = Date.now();
			while (Date.now() - started < ms) {
				if (predicate(entries())) return true;
				await new Promise((r) => setTimeout(r, 20));
			}
			return false;
		},
		pidFile,
		/** The child's pid once the fake has started, or undefined. */
		childPid() {
			try {
				const raw = fs.readFileSync(pidFile, "utf8").trim();
				return raw ? Number(raw) : undefined;
			} catch {
				return undefined;
			}
		},
		piInvocation: { command: process.execPath, args: [fake, scriptFile, logFile, "--fake-pid-file", pidFile] },
		cleanup() {
			process.chdir(root);
			fs.rmSync(dir, { recursive: true, force: true });
		},
	};
}

/** The smallest ExtensionAPI the extension actually touches. */
function fakePi() {
	const tools = new Map();
	const handlers = new Map();
	const messages = [];
	return {
		api: {
			registerTool(spec) {
				tools.set(spec.name, spec);
			},
			registerCommand() {},
			on(event, handler) {
				const list = handlers.get(event) ?? [];
				list.push(handler);
				handlers.set(event, list);
				return () => {};
			},
			sendMessage(message, options) {
				messages.push({ message, options });
				return Promise.resolve();
			},
			sendUserMessage() {
				return Promise.resolve();
			},
			appendEntry() {},
			getFlag() {
				return undefined;
			},
		},
		tools,
		messages,
		async emit(event, ...args) {
			for (const handler of handlers.get(event) ?? []) await handler(...args);
		},
	};
}

function fakeCtx(cwd) {
	return {
		cwd,
		hasUI: false,
		isProjectTrusted: () => true,
		sessionManager: { getSessionId: () => "test-session" },
	};
}

// The agent dir is where background session files land; keep it out of ~/.pi.
const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pstack-agentdir-"));
created.push(agentDir);
process.env.PI_CODING_AGENT_DIR = agentDir;

async function launch(w, pi, ctx, params) {
	const tool = pi.tools.get("subagent");
	const result = await tool.execute("call-1", { agentScope: "project", ...params }, undefined, undefined, ctx);
	return result;
}

// --- a background launch returns at once ---------------------------------

{
	const w = project({ default: [{ sleep: 400 }, { reply: "finished: ${prompt}" }] });
	const pi = fakePi();
	install(pi.api, { piInvocation: w.piInvocation });
	const ctx = fakeCtx(w.dir);

	const started = Date.now();
	const result = await launch(w, pi, ctx, { agent: "worker", task: "long job", run_in_background: true });
	const elapsed = Date.now() - started;

	check("the launch returns before the run ends", elapsed < 350, `${elapsed} ms`);
	const payload = JSON.parse(result.content[0].text.split("\n")[0]);
	check("the launch returns an agentId", typeof payload.agentId === "string" && payload.agentId.startsWith("a"), JSON.stringify(payload));
	check("the launch reports running", payload.status === "running", JSON.stringify(payload));

	// The child was really started: the fake logs its prompt.
	check("the child was prompted", await w.until((e) => e.some((r) => r.kind === "prompted")));
	const invocation = w.of("invocation")[0];
	check(
		"the task is not on the child's command line",
		invocation && !invocation.argv.some((a) => a.includes("long job")),
		JSON.stringify(invocation?.argv),
	);
	check(
		"the child runs in rpc mode",
		invocation && invocation.argv[invocation.argv.indexOf("--mode") + 1] === "rpc",
		JSON.stringify(invocation?.argv),
	);

	check("a completion notice arrives", await w.until(() => pi.messages.length > 0, 10_000));
	const notice = pi.messages[0];
	check("the notice carries the result", notice.message.content.includes("finished: long job"), notice.message.content.slice(0, 200));
	check("the notice starts a turn", notice.options?.triggerTurn === true, JSON.stringify(notice.options));
	check("the notice names the agent", notice.message.content.includes(payload.agentId));
	w.cleanup();
}

// --- list_agents sees it -------------------------------------------------

{
	const w = project({ default: [{ reply: "done" }] });
	const pi = fakePi();
	install(pi.api, { piInvocation: w.piInvocation });
	const ctx = fakeCtx(w.dir);

	const result = await launch(w, pi, ctx, { agent: "worker", task: "a job", run_in_background: true });
	const id = JSON.parse(result.content[0].text.split("\n")[0]).agentId;
	await w.until(() => pi.messages.length > 0, 10_000);

	const listed = await pi.tools.get("list_agents").execute("call-2", {}, undefined, undefined, ctx);
	const agents = listed.details.agents;
	check("list_agents shows the run", agents.some((a) => a.agentId === id), JSON.stringify(agents));
	check(
		"a finished run is reported as completed",
		agents.find((a) => a.agentId === id)?.status === "completed",
		JSON.stringify(agents.find((a) => a.agentId === id)),
	);
	w.cleanup();
}

// --- send_message steers a live run --------------------------------------

{
	// The sleep is the window in which the run is live and listening.
	const w = project({ default: [{ sleep: 1200 }, { reply: "after steer" }] });
	const pi = fakePi();
	install(pi.api, { piInvocation: w.piInvocation });
	const ctx = fakeCtx(w.dir);

	const result = await launch(w, pi, ctx, { agent: "worker", task: "start", run_in_background: true });
	const id = JSON.parse(result.content[0].text.split("\n")[0]).agentId;
	check("the run is prompted", await w.until((e) => e.some((r) => r.kind === "prompted")));

	const steered = await pi.tools.get("send_message").execute("call-3", { to: id, message: "change direction" }, undefined, undefined, ctx);
	check("a steer to a live run succeeds", !steered.isError, steered.content[0].text);
	check("the skill reports it was taken", steered.details.taken === true, JSON.stringify(steered.details));
	check("the steer reached the child", await w.until((e) => e.some((r) => r.kind === "steered")), "the fake never logged a steer");

	await w.until(() => pi.messages.length > 0, 10_000);
	w.cleanup();
}

// --- send_message refuses a finished run ---------------------------------

{
	const w = project({ default: [{ reply: "already done" }] });
	const pi = fakePi();
	install(pi.api, { piInvocation: w.piInvocation });
	const ctx = fakeCtx(w.dir);

	const result = await launch(w, pi, ctx, { agent: "worker", task: "quick", run_in_background: true });
	const id = JSON.parse(result.content[0].text.split("\n")[0]).agentId;
	check("the quick run finishes", await w.until(() => pi.messages.length > 0, 10_000));

	const steered = await pi.tools.get("send_message").execute("call-4", { to: id, message: "too late" }, undefined, undefined, ctx);
	check("a steer to a finished run is an error", steered.isError === true, JSON.stringify(steered.details));
	check("the refusal says why", /already finished/i.test(steered.content[0].text), steered.content[0].text.slice(0, 160));
	check("the refusal returns the result instead", steered.content[0].text.includes("already done"));
	w.cleanup();
}

// --- send_message refuses an unknown id ---------------------------------

{
	const w = project({ default: [{ reply: "x" }] });
	const pi = fakePi();
	install(pi.api, { piInvocation: w.piInvocation });
	const ctx = fakeCtx(w.dir);

	const steered = await pi.tools.get("send_message").execute("call-5", { to: "nope", message: "hi" }, undefined, undefined, ctx);
	check("an unknown agent is an error", steered.isError === true);
	check("the error lists the known agents", /Known agents/i.test(steered.content[0].text), steered.content[0].text);
	w.cleanup();
}

// --- session shutdown ends the runs -------------------------------------

{
	const w = project({ default: [{ sleep: 30_000 }] });
	const pi = fakePi();
	install(pi.api, { piInvocation: w.piInvocation });
	const ctx = fakeCtx(w.dir);

	await launch(w, pi, ctx, { agent: "worker", task: "long", run_in_background: true });
	check("the long run is prompted", await w.until((e) => e.some((r) => r.kind === "prompted")));

	const pid = w.childPid();
	check("the child was started", typeof pid === "number" && alive(pid), String(pid));

	await pi.emit("session_shutdown");
	// A pid file is the only portable evidence: on Windows, SIGTERM is
	// TerminateProcess, so the child never runs a handler to log it.
	let gone = false;
	for (let i = 0; i < 100 && !gone; i++) {
		await new Promise((r) => setTimeout(r, 30));
		gone = pid !== undefined && !alive(pid);
	}
	check("shutdown ends the child", gone, `pid ${pid} still alive`);
	w.cleanup();
}

// --- a foreground call is unchanged -------------------------------------
//
// The one-shot path still runs and still returns the text, so adding background
// did not take the old behaviour away.

{
	const w = project({ default: [{ reply: "foreground: ${prompt}" }] });
	const pi = fakePi();
	install(pi.api, { piInvocation: w.piInvocation });
	const ctx = fakeCtx(w.dir);

	const result = await launch(w, pi, ctx, { agent: "worker", task: "quick" });
	check(
		"a foreground call returns the child's text",
		result.content[0].text.includes("foreground:") && result.content[0].text.includes("quick"),
		result.content[0].text.slice(0, 200),
	);
	const invocation = w.of("invocation")[0];
	check(
		"the foreground path stays one-shot",
		invocation && invocation.argv.includes("-p"),
		JSON.stringify(invocation?.argv),
	);
	w.cleanup();
}

fs.rmSync(agentDir, { recursive: true, force: true });

console.log();
if (failed > 0) {
	console.log(`background: ${failed} failed`);
	process.exit(1);
}
console.log("background: all checks passed");
