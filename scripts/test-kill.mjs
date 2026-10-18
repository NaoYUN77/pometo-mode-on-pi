#!/usr/bin/env node
/**
 * Ending a child process, including one that will not take SIGTERM politely.
 *
 *   node scripts/test-kill.mjs
 *
 * The bug this guards is a wrong predicate, not an OS behaviour: `child.killed`
 * turns true the instant `kill("SIGTERM")` returns, so `if (!proc.killed)
 * proc.kill("SIGKILL")` never fires. Testing that against a real child is
 * unreliable for a different reason on each platform — on Windows SIGTERM is not
 * a signal at all and Node terminates the process unconditionally, so a child
 * cannot refuse it and the broken code looks correct.
 *
 * So the escalation is checked against a stub that records what was signalled.
 * That is the part this repo owns. A real-process case runs after it as a smoke
 * test that the function does not throw, and the Windows limitation is stated
 * rather than papered over.
 */

import { spawn } from "node:child_process";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");

let failed = 0;
const check = (name, ok, detail = "") => {
	if (ok) console.log(`PASS ${name}`);
	else {
		failed += 1;
		console.log(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`);
	}
};

const { terminate } = await import(pathToFileURL(path.join(root, ".pi", "lib", "kill.ts")).href);

const GRACE_MS = 120;
const settle = (ms = GRACE_MS * 3) => new Promise((r) => setTimeout(r, ms));

/** A ChildProcess stand-in that records every signal it is sent. */
function stub({ exitOnTerm = false } = {}) {
	const signals = [];
	const proc = {
		exitCode: null,
		signalCode: null,
		// `killed` is present on purpose: the broken predicate read it, and a
		// stub that omitted it would hide the bug rather than catch it.
		killed: false,
		kill(signal) {
			signals.push(signal);
			proc.killed = true;
			if (signal === "SIGTERM" && exitOnTerm) proc.signalCode = "SIGTERM";
			if (signal === "SIGKILL") proc.signalCode = "SIGKILL";
			return true;
		},
	};
	return { proc, signals };
}

// --- a child that ignores SIGTERM is killed anyway -----------------------

{
	const { proc, signals } = stub({ exitOnTerm: false });
	terminate(proc, GRACE_MS);
	check("SIGTERM goes out first", signals[0] === "SIGTERM", signals.join(","));
	await settle();
	check(
		"a child that ignores SIGTERM is escalated to SIGKILL",
		signals.includes("SIGKILL"),
		`signals: ${signals.join(",") || "none"}`,
	);
	check("SIGTERM is not repeated", signals.filter((s) => s === "SIGTERM").length === 1, signals.join(","));
}

// --- a child that honours SIGTERM is not escalated -----------------------

{
	const { proc, signals } = stub({ exitOnTerm: true });
	terminate(proc, GRACE_MS);
	check("a cooperative child gets SIGTERM", signals[0] === "SIGTERM");
	await settle();
	check(
		"a cooperative child is not sent SIGKILL",
		!signals.includes("SIGKILL"),
		`signals: ${signals.join(",")}`,
	);
}

// --- an already-exited child is left alone ------------------------------

{
	const { proc, signals } = stub();
	proc.exitCode = 0;
	terminate(proc, GRACE_MS);
	await settle();
	check("an exited child is sent nothing", signals.length === 0, `signals: ${signals.join(",") || "none"}`);
}

// --- a child that died on SIGTERM before the grace period is left alone --

{
	const { proc, signals } = stub({ exitOnTerm: true });
	terminate(proc, GRACE_MS);
	// Same as a real child: the signal handler runs, then Node fills in signalCode.
	proc.signalCode = "SIGTERM";
	await settle();
	check("a child that exited after SIGTERM is not escalated", !signals.includes("SIGKILL"), signals.join(","));
}

// --- calling it twice is safe -------------------------------------------

{
	const { proc, signals } = stub();
	terminate(proc, GRACE_MS);
	terminate(proc, GRACE_MS);
	await settle(GRACE_MS * 4);
	check("a double terminate still escalates", signals.includes("SIGKILL"), signals.join(","));
	check("neither call throws", true);
}

// --- a real child, as a smoke test --------------------------------------
//
// On Windows this proves only that the call does not throw; Node terminates the
// process on SIGTERM regardless of any handler, so refusal cannot be staged.

{
	const proc = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
	await new Promise((r) => setTimeout(r, 200));
	check("a real child started", proc.pid !== undefined);
	terminate(proc, GRACE_MS);
	const exited = await new Promise((resolve) => {
		if (proc.exitCode !== null || proc.signalCode !== null) return resolve(true);
		const timer = setTimeout(() => resolve(false), 3000);
		proc.once("exit", () => {
			clearTimeout(timer);
			resolve(true);
		});
	});
	check("a real child ends after terminate", exited);
	if (!exited) proc.kill("SIGKILL");
	if (process.platform === "win32") {
		console.log("NOTE Windows cannot stage a SIGTERM refusal: Node terminates unconditionally there,");
		console.log("     so the escalation above is proven against the stub, not against this child.");
	}
}

console.log();
if (failed > 0) {
	console.log(`kill: ${failed} failed`);
	process.exit(1);
}
console.log("kill: all checks passed");
