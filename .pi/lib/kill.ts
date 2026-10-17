/**
 * Ending a child process, including one that will not take SIGTERM politely.
 *
 * The trap this replaces: `child.killed` is a flag for "a signal was sent", not
 * "the process died". It turns true the instant `kill("SIGTERM")` returns, so
 * `if (!child.killed) child.kill("SIGKILL")` never runs and a child that traps
 * SIGTERM outlives the agent that started it. The liveness question is
 * `exitCode`/`signalCode`, which stay null until the process is actually gone.
 *
 * Only signals a process this code spawned. A pid can be reused, so nothing here
 * signals by number.
 */

import type { ChildProcess } from "node:child_process";

export const KILL_GRACE_MS = 5000;

/** True while the child exists, told from Node's own exit bookkeeping. */
function isRunning(proc: ChildProcess): boolean {
	return proc.exitCode === null && proc.signalCode === null;
}

/**
 * SIGTERM now, SIGKILL if the child is still there after `graceMs`.
 *
 * Safe to call more than once: each call only signals a child that is still
 * running. The timer is unref'd so a pending escalation never keeps the host
 * process alive on its own.
 */
export function terminate(proc: ChildProcess, graceMs: number = KILL_GRACE_MS): void {
	if (!isRunning(proc)) return;
	try {
		proc.kill("SIGTERM");
	} catch {
		// ESRCH: it exited between the check and the signal. Nothing to escalate.
		return;
	}
	const timer = setTimeout(() => {
		if (isRunning(proc)) {
			try {
				proc.kill("SIGKILL");
			} catch {
				// Same race, same answer: it is already gone.
			}
		}
	}, graceMs);
	timer.unref();
}
