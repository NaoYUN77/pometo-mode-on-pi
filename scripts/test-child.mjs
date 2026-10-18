#!/usr/bin/env node
/**
 * The child protocol: prompt in, events out, steer into a run.
 *
 *   node scripts/test-child.mjs
 *
 * A rpc child is a long-lived process the parent talks to over stdin and stdout.
 * What is easy to get wrong is the ordering: a steer can arrive just after the
 * run settled, and pi then answers "queued" for a message it will never read,
 * because it exits on EOF. So `taken` is decided at the moment the response is
 * read, against whether the settle had already arrived — not by the response's
 * own text.
 *
 * Every case runs against scripts/fake-pi.mjs, so no model is called. The fake
 * logs each prompt, steer, and settle, which lets a case wait for the exact
 * moment instead of sleeping and hoping.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const fake = path.join(root, "scripts", "fake-pi.mjs");

let failed = 0;
const check = (name, ok, detail = "") => {
	if (ok) console.log(`PASS ${name}`);
	else {
		failed += 1;
		console.log(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`);
	}
};

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

const { PiChild } = await import(pathToFileURL(path.join(root, ".pi", "lib", "pi-child.ts")).href);

/** A temp world with a script, a log, and a place for sessions. */
function world(script) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-child-"));
	created.push(dir);
	const scriptFile = path.join(dir, "script.json");
	fs.writeFileSync(scriptFile, JSON.stringify(script));
	const logFile = path.join(dir, "log.jsonl");
	const sessionDir = path.join(dir, "sessions");
	fs.mkdirSync(sessionDir, { recursive: true });
	const entries = () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
	return {
		dir,
		sessionDir,
		entries,
		of: (kind) => entries().filter((e) => e.kind === kind),
		async until(kind, n = 1, ms = 8000) {
			const started = Date.now();
			while (Date.now() - started < ms) {
				if (entries().filter((e) => e.kind === kind).length >= n) return true;
				await new Promise((r) => setTimeout(r, 20));
			}
			return false;
		},
		cleanup() {
			fs.rmSync(dir, { recursive: true, force: true });
		},
	};
}

/** A child wired to the fake, with a session id like the real one. */
function childFor(w, prompt, opts = {}) {
	return new PiChild({
		command: process.execPath,
		args: [fake, path.join(w.dir, "script.json"), path.join(w.dir, "log.jsonl")],
		cwd: w.dir,
		sessionId: opts.sessionId ?? "11111111-1111-4111-8111-111111111111",
		sessionDir: w.sessionDir,
		model: opts.model,
		thinking: opts.thinking,
		systemPromptFile: opts.systemPromptFile,
		toolList: opts.toolList,
		killGraceMs: 300,
		exitGraceMs: 3000,
		prompt,
	});
}

// --- the prompt goes in over stdin, not argv -----------------------------

{
	const w = world({ default: [{ reply: "done: ${prompt}" }] });
	const child = childFor(w, "a fairly long task description");
	const exit = await child.exited;
	check("a run completes", exit.settled, JSON.stringify(exit));
	check("the final text comes back", exit.finalText === "done: a fairly long task description", JSON.stringify(exit.finalText));

	const invocation = w.of("invocation")[0];
	check("the fake was really started", Boolean(invocation));
	check(
		"the prompt is not on the command line",
		invocation && !invocation.argv.some((a) => a.includes("a fairly long task description")),
		JSON.stringify(invocation?.argv),
	);
	check(
		"the child is in rpc mode",
		invocation && invocation.argv.includes("--mode") && invocation.argv[invocation.argv.indexOf("--mode") + 1] === "rpc",
		JSON.stringify(invocation?.argv),
	);
	check(
		"the child gets a session id",
		invocation && invocation.argv.includes("--session-id"),
		JSON.stringify(invocation?.argv),
	);
	w.cleanup();
}

// --- steer into a running child -----------------------------------------

{
	// The sleep is the window: the steer has to land while the child is mid-run.
	const w = world({ default: [{ sleep: 600 }, { reply: "first" }] });
	const child = childFor(w, "start");
	check("the child is prompted before any steer", await w.until("prompted"));
	const { response, taken } = await child.steer("change direction");
	check("steer was accepted", response?.success === true, JSON.stringify(response));
	check("steer counts as taken while the run is live", taken === true, `taken=${taken}`);
	check("the steer reached the child", await w.until("steered"), "the fake never logged a steered message");
	await child.exited;
	check("the fake recorded one steer", w.of("steered").length === 1, `${w.of("steered").length}`);
	w.cleanup();
}

// --- a steer that arrives after the settle is not taken ------------------

{
	// holdSettle keeps agent_settled off the wire, which is the window in which
	// pi answers "queued" for a message it will never read.
	const w = world({ default: [{ reply: "first" }, { holdSettle: 1500 }] });
	const child = childFor(w, "start");
	check("the run settles", await w.until("settled"));
	const { response, taken } = await child.steer("too late");
	check("the late steer is still answered", response?.success === true, JSON.stringify(response));
	check("a steer after the settle is not taken", taken === false, `taken=${taken}`);
	await child.exited;
	w.cleanup();
}

// --- stdout handling -----------------------------------------------------

{
	const w = world({ default: [{ raw: "this is not json\n" }, { reply: "survived" }] });
	const child = childFor(w, "start");
	const exit = await child.exited;
	check("a non-JSON line does not end the run", exit.finalText === "survived", JSON.stringify(exit.finalText));
	w.cleanup();
}

{
	// A multi-byte character split across two writes must decode whole.
	const w = world({ default: [{ raw: "{\"type\":\"message_end\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"\\u4f60" }] });
	const child = childFor(w, "start");
	const exit = await child.exited;
	check("a truncated JSON line does not crash the reader", !exit.errorMessage || exit.errorMessage.includes("no text"), JSON.stringify(exit.errorMessage));
	w.cleanup();
}

// --- a failed run reports why -------------------------------------------

{
	const w = world({ default: [{ error: "the model refused" }] });
	const child = childFor(w, "start");
	const exit = await child.exited;
	check("an error message makes the run failed", exit.finalText.includes("the model refused"), JSON.stringify(exit.finalText));
	w.cleanup();
}

// --- a prompt consumed as an extension command starts nothing ------------

{
	const w = world({ default: [{ reply: "should not run" }] });
	const child = childFor(w, "/routes");
	const exit = await child.exited;
	check(
		"a consumed prompt is reported, not treated as an answer",
		/consumed|extension command|no run/i.test(exit.errorMessage),
		JSON.stringify(exit.errorMessage),
	);
	w.cleanup();
}

// --- abort ends a child that ignores SIGTERM ----------------------------

{
	const w = world({ default: [{ ignoreSigterm: true }, { sleep: 30_000 }] });
	const child = childFor(w, "start");
	check("the stubborn child is running", await w.until("ignoring-sigterm"));
	child.end(300);
	const exit = await Promise.race([
		child.exited.then(() => "exited"),
		new Promise((r) => setTimeout(() => r("still running"), 6000)),
	]);
	check("an abort ends a child that ignores SIGTERM", exit === "exited", exit);
	w.cleanup();
}

console.log();
if (failed > 0) {
	console.log(`child: ${failed} failed`);
	process.exit(1);
}
console.log("child: all checks passed");
