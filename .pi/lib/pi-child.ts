/**
 * One `pi --mode rpc` child, and the only handle on its stdin.
 *
 * Why rpc and not `-p`: a one-shot child cannot be spoken to after the prompt is
 * sent. Steer needs a process that is still listening, so the prompt goes in as a
 * command on stdin and the child stays alive until it settles.
 *
 * The ordering that matters: a steer may arrive just after the run settled. pi
 * then answers "queued" for a message it will never read, because it exits on
 * EOF. So a steer counts as taken only when the settle had not already been read
 * at the moment the response arrived — the settle can follow in the same chunk of
 * output, and `taken` is decided then, not from the response's own text.
 *
 * Lines split on LF only, through a StringDecoder, so a character split across
 * two pipe chunks is not silently replaced with U+FFFD in the middle of an
 * answer.
 */

import { spawn, type ChildProcessByStdio } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import type { Readable, Writable } from "node:stream";
import { lineSplitter } from "./line-splitter.ts";
import { terminate } from "./kill.ts";

const STDERR_CAP = 8 * 1024;

export interface ChildExit {
	/** The process's exit code, or null when a signal ended it. */
	exitCode: number | null;
	/** Whether the run reached agent_settled, which is when its work was done. */
	settled: boolean;
	finalText: string;
	/** "" when the run ended cleanly. */
	errorMessage: string;
	stderr: string;
}

export interface PiChildOptions {
	command: string;
	/** Args before the rpc flags, e.g. a test stand-in for pi. */
	args: string[];
	cwd: string;
	sessionId: string;
	sessionDir: string;
	model?: string;
	thinking?: string;
	/** A file holding the seat's system prompt, appended to pi's own. */
	systemPromptFile?: string;
	/** A full allowlist: every tool not named here is off, extension tools included. */
	toolList?: string[];
	killGraceMs?: number;
	/** How long the child gets to exit after stdin closes. */
	exitGraceMs?: number;
	prompt: string;
}

export interface SteerResult {
	response: { success: boolean; error?: string } | undefined;
	/** True only when the child was still mid-run when it read the message. */
	taken: boolean;
}

type Answer = { success: boolean; error?: string; data?: { disposition?: string } };

export class PiChild {
	readonly pid: number | undefined;
	readonly exited: Promise<ChildExit>;

	private readonly proc: ChildProcessByStdio<Writable, Readable, Readable>;
	private readonly killGraceMs: number;
	private readonly exitGraceMs: number;
	private readonly pending = new Map<string, (answer: Answer | undefined) => void>();
	private nextId = 0;
	private open = true;
	private settled = false;
	private finalText = "";
	private errorMessage = "";
	private stderr = "";
	private exitTimer?: NodeJS.Timeout;

	constructor(options: PiChildOptions) {
		this.killGraceMs = options.killGraceMs ?? 5000;
		this.exitGraceMs = options.exitGraceMs ?? 30_000;

		const args = [...options.args, "--mode", "rpc", "--session-id", options.sessionId, "--session-dir", options.sessionDir];
		if (options.model) args.push("--model", options.model);
		if (options.thinking) args.push("--thinking", options.thinking);
		if (options.systemPromptFile) args.push("--append-system-prompt", options.systemPromptFile);
		if (options.toolList?.length) args.push("--tools", options.toolList.join(","));

		this.proc = spawn(options.command, args, { cwd: options.cwd, stdio: ["pipe", "pipe", "pipe"] });
		this.pid = this.proc.pid;
		// A closed stdin is the normal end of a run, not an error.
		this.proc.stdin.on("error", () => {});

		const stdout = lineSplitter((line) => this.onLine(line));
		this.proc.stdout.on("data", (chunk: Buffer) => stdout.write(chunk));

		const stderrDecoder = new StringDecoder("utf8");
		this.proc.stderr.on("data", (chunk: Buffer) => {
			this.stderr = (this.stderr + stderrDecoder.write(chunk)).slice(-STDERR_CAP);
		});

		this.exited = new Promise<ChildExit>((resolve) => {
			let exitCode: number | null = null;
			let done = false;
			const finish = (spawnError?: Error) => {
				if (done) return;
				done = true;
				this.open = false;
				clearTimeout(this.exitTimer);
				stdout.end();
				this.stderr += stderrDecoder.end();
				if (spawnError) this.errorMessage = spawnError.message;
				for (const settle of this.pending.values()) settle(undefined);
				this.pending.clear();
				if (!this.finalText && this.errorMessage) this.finalText = this.errorMessage;
				resolve({
					exitCode: spawnError ? null : exitCode,
					settled: this.settled,
					finalText: this.finalText,
					errorMessage: this.errorMessage,
					stderr: this.stderr,
				});
			};
			this.proc.on("error", (e) => finish(e as Error));
			this.proc.on("exit", (code) => {
				exitCode = code;
			});
			this.proc.on("close", (code) => {
				if (code !== null) exitCode = code;
				finish();
			});
		});

		this.command({ type: "prompt", message: options.prompt }).then((answer) => {
			if (!answer) return;
			if (!answer.success) {
				this.errorMessage = answer.error ?? "pi rejected the prompt";
				this.close();
				return;
			}
			if (answer.data?.disposition === "handled") {
				// An extension command consumed the prompt, so no run started and no
				// settle will follow. Holding the child open would hang the caller.
				this.errorMessage = "pi consumed the prompt as an extension command, so no agent run started. Send the task as plain text.";
				this.close();
			}
		});
	}

	/** True once the run settled, whether or not the process has exited. */
	get hasSettled(): boolean {
		return this.settled;
	}

	/**
	 * Queue a message into the run. `taken` is false when the run had already
	 * settled by the time pi answered, which means the message was dropped.
	 */
	steer(message: string): Promise<SteerResult> {
		return new Promise((resolve) =>
			this.command({ type: "steer", message }, (answer) =>
				resolve({ response: answer, taken: answer?.success === true && !this.settled }),
			),
		);
	}

	/** Close stdin and give the child `graceMs` to exit, then end it. */
	end(graceMs: number = this.killGraceMs): void {
		this.closeStdin();
		clearTimeout(this.exitTimer);
		terminate(this.proc, graceMs);
	}

	/** Ask pi to stop the run, then end the child. */
	abort(graceMs: number = this.killGraceMs): void {
		void this.command({ type: "abort" });
		this.end(graceMs);
	}

	private closeStdin(): void {
		if (!this.open) return;
		this.open = false;
		this.proc.stdin.end();
	}

	/**
	 * pi exits on EOF once idle, so closing stdin is the orderly shutdown. A child
	 * that does not exit is ended, since nothing else would end the agent.
	 */
	private close(): void {
		this.closeStdin();
		clearTimeout(this.exitTimer);
		this.exitTimer = setTimeout(() => terminate(this.proc, this.killGraceMs), this.exitGraceMs);
		this.exitTimer.unref();
	}

	private command(
		command: Record<string, unknown>,
		onAnswer?: (answer: Answer | undefined) => void,
	): Promise<Answer | undefined> {
		return new Promise((resolve) => {
			const done = (answer: Answer | undefined) => {
				onAnswer?.(answer);
				resolve(answer);
			};
			if (!this.open) return done(undefined);
			const id = `c${++this.nextId}`;
			this.pending.set(id, done);
			try {
				this.proc.stdin.write(`${JSON.stringify({ id, ...command })}\n`);
			} catch {
				this.pending.delete(id);
				done(undefined);
			}
		});
	}

	private onLine(line: string): void {
		if (!line.trim()) return;
		let event: Record<string, unknown>;
		try {
			event = JSON.parse(line) as Record<string, unknown>;
		} catch {
			// Diagnostics on stdout are not protocol records; one must not end the run.
			return;
		}

		if (event.type === "response" && typeof event.id === "string") {
			const settle = this.pending.get(event.id);
			this.pending.delete(event.id);
			const answer: Answer =
				typeof event.success === "boolean" ? (event as unknown as Answer) : { success: false, error: "malformed response" };
			settle?.(answer);
			return;
		}

		if (event.type === "message_end") {
			const message = event.message as
				| { role?: string; content?: unknown; errorMessage?: string; stopReason?: unknown }
				| undefined;
			if (message?.role !== "assistant") return;
			const text = assistantText(message.content);
			if (text) {
				this.finalText = text;
				this.errorMessage = "";
			}
			if (typeof message.errorMessage === "string" && message.errorMessage) {
				this.errorMessage = text ? `${text}\n\n${message.errorMessage}` : message.errorMessage;
			} else if (!text) {
				this.errorMessage = `(the run ended with no assistant text; stopReason: ${String(message.stopReason)})`;
			}
			return;
		}

		if (event.type === "agent_settled") {
			this.settled = true;
			this.close();
		}
	}
}

/** The text of an assistant message, joined across its text parts. */
function assistantText(content: unknown): string {
	if (!Array.isArray(content)) return typeof content === "string" ? content.trim() : "";
	return content
		.filter((part): part is { type: string; text: string } => {
			return typeof part === "object" && part !== null && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string";
		})
		.map((part) => part.text)
		.join("\n")
		.trim();
}
