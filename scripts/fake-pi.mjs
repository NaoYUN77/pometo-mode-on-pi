#!/usr/bin/env node
/**
 * Stands in for `pi --mode rpc`, so the child protocol can be tested without a
 * model call.
 *
 *   node fake-pi.mjs <script.json> <log.jsonl> [--model ...] [...]
 *
 * The script names the steps to play for the prompt it receives:
 *
 *   { "default": [steps], "byPrompt": { "<prompt>": [steps] } }
 *
 * Steps, each with exactly one key:
 *
 *   { reply: "text" }            an assistant message_end; ${prompt} expands
 *   { toolStart: {name, args} }  tool_execution_start
 *   { toolEnd: "name" }          tool_execution_end for the last tool call
 *   { error: "text" }            an assistant message_end carrying an errorMessage
 *   { raw: "text" }              bytes straight to stdout
 *   { stderr: "text" }           bytes to stderr
 *   { sleep: ms }                wait, interruptible by a steer or abort
 *   { exit: code }               end the process at once
 *   { ignoreSigterm: true }      keep running when SIGTERM arrives
 *   { holdSettle: ms }           emit agent_settled into a buffer, release it ms later
 *
 * A step that names an unknown key, or carries more than one, exits 64: a
 * misspelled step must not pass for the behaviour it names.
 *
 * A steer command is queued and delivered at the next step boundary, which is
 * what pi does after the current tool calls. Every command, steer, settle, and
 * exit is appended to the log as JSONL so a test can wait for the moment it
 * needs instead of sleeping and hoping.
 */

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const [scriptPath, logPath, ...argv] = process.argv.slice(2);
if (!scriptPath || !logPath) {
	process.stderr.write("fake-pi: usage: fake-pi.mjs <script.json> <log.jsonl> [args...]\n");
	process.exit(64);
}

const log = (record) => appendFileSync(logPath, `${JSON.stringify(record)}\n`);
const flag = (name) => {
	const i = argv.indexOf(name);
	return i === -1 ? undefined : argv[i + 1];
};

// A pid file, so a test can check the process is really gone without guessing.
const pidFile = flag("--fake-pid-file");
if (pidFile) writeFileSync(pidFile, String(process.pid));

const script = JSON.parse(readFileSync(scriptPath, "utf8"));

/** Held stdout lines, released when a holdSettle step ends. */
let held;
const out = (event) => {
	const line = `${JSON.stringify(event)}\n`;
	if (held) held.push(line);
	else process.stdout.write(line);
};

const assistant = (content, extra = {}) => ({
	role: "assistant",
	content,
	stopReason: "stop",
	timestamp: Date.now(),
	...extra,
});

let steerQueue = [];
const steered = [];
let aborted = false;
let wake = () => {};
let stdinClosed = false;
let started = false;
let settled = false;
let holdMs = 0;
let lingerMs = 0;

const STEPS = {
	reply: (text) => {
		out({
			type: "message_end",
			message: assistant([{ type: "text", text: String(text).replaceAll("${prompt}", startedWith) }]),
		});
	},
	toolStart: ({ name, args, id = "t1" }) =>
		out({ type: "tool_execution_start", toolCallId: id, toolName: name, args: args ?? {} }),
	toolEnd: (end) => {
		const { name, id = "t1" } = typeof end === "string" ? { name: end } : end;
		out({ type: "tool_execution_end", toolCallId: id, toolName: name, result: { content: [] }, isError: false });
	},
	error: (message) => out({ type: "message_end", message: assistant([], { stopReason: "error", errorMessage: message }) }),
	raw: (text) => process.stdout.write(text),
	stderr: (text) => process.stderr.write(text),
	sleep: (ms) => waitUntil(ms, () => false),
	exit: (code) => process.exit(code),
	ignoreSigterm: () => {
		process.removeAllListeners("SIGTERM");
		process.on("SIGTERM", () => log({ kind: "sigterm-ignored", pid: process.pid }));
		log({ kind: "ignoring-sigterm", pid: process.pid });
	},
	holdSettle: (ms) => (holdMs = ms),
};

const FLAG_STEPS = new Set(["ignoreSigterm"]);

function stepProblem(step) {
	const keys = Object.keys(step);
	if (keys.length !== 1) return `a step needs exactly one key, got ${JSON.stringify(step)}`;
	if (!Object.hasOwn(STEPS, keys[0])) return `unknown step key "${keys[0]}"`;
	if (FLAG_STEPS.has(keys[0]) && step[keys[0]] !== true) return `step "${keys[0]}" takes only true`;
	return null;
}

for (const step of [...(script.default ?? []), ...Object.values(script.byPrompt ?? {}).flat()]) {
	const problem = stepProblem(step);
	if (problem) {
		process.stderr.write(`fake-pi: ${problem}\n`);
		process.exit(64);
	}
}

const waitUntil = async (ms, done) => {
	const until = Date.now() + ms;
	while (!aborted && !done() && Date.now() < until) await pause(until - Date.now());
};

const pause = (ms) =>
	new Promise((resolve) => {
		const t = setTimeout(resolve, ms);
		wake = () => {
			clearTimeout(t);
			resolve();
		};
	});

const takeSteers = () => {
	for (const text of steerQueue.splice(0)) {
		steered.push(text);
		log({ kind: "steered", text, pid: process.pid });
		out({
			type: "message_end",
			message: { role: "user", content: [{ type: "text", text }], timestamp: Date.now() },
		});
	}
};

let startedWith = "";

function readCommands() {
  return new Promise((resolve) => {
	const lines = createInterface({ input: process.stdin });
	lines.on("line", (line) => {
		if (!line.trim()) return;
		let command;
		try {
			command = JSON.parse(line);
		} catch {
			return;
		}
		const respond = (extra = {}) => out({ type: "response", id: command.id, command: command.type, success: true, ...extra });

		if (command.type === "prompt") {
			// As pi: a slash prompt an extension command consumes starts no run.
			if (String(command.message).startsWith("/")) {
				return respond({ data: { disposition: "handled" } });
			}
			respond({ data: { disposition: "started" } });
			started = true;
			startedWith = command.message;
			log({ kind: "prompted", prompt: command.message, pid: process.pid });
			resolve(command.message);
		} else if (command.type === "steer") {
			if (String(command.message).startsWith("/")) {
				return out({
					type: "response",
					id: command.id,
					command: "steer",
					success: false,
					error: "Extension commands are not allowed in steer",
				});
			}
			respond({ data: { disposition: "queued" } });
			steerQueue.push(command.message);
			wake();
		} else if (command.type === "abort") {
			aborted = true;
			wake();
			respond();
		} else respond();
	});
	lines.on("close", () => {
		stdinClosed = true;
		log({ kind: "stdin-closed", pid: process.pid });
		if (!started) process.exit(0);
		if (settled) setTimeout(() => process.exit(0), lingerMs);
	});
  });
}

out({ type: "session", version: 3, id: flag("--session-id") ?? "none", cwd: process.cwd() });

// Registered before the first await: a child that is killed mid-run must still
// leave a trace, and the default action would end it silently.
process.on("SIGTERM", () => {
	log({ kind: "sigterm", pid: process.pid });
	process.exit(143);
});

// `-p` mode takes the prompt on the command line, rpc mode on stdin.
const oneShot = argv.includes("-p") || argv.includes("--print");
const prompted = oneShot
	? Promise.resolve(argv[argv.length - 1] ?? "").then((text) => {
			started = true;
			startedWith = text;
			log({ kind: "prompted", prompt: text, pid: process.pid });
			return text;
		})
	: readCommands();
const prompt = await prompted;
log({ kind: "invocation", argv, prompt, pid: process.pid, cwd: process.cwd() });

const steps = script.byPrompt?.[prompt] ?? script.default ?? [{ reply: "ok" }];

out({ type: "agent_start" });
out({ type: "message_end", message: { role: "user", content: prompt, timestamp: Date.now() } });

for (const step of steps) {
	if (aborted) break;
	const [[key, value]] = Object.entries(step);
	await STEPS[key](value);
	takeSteers();
}

if (holdMs) held = [];
out({ type: "agent_end", messages: [] });
out({ type: "agent_settled", aborted });
settled = true;
log({ kind: "settled", pid: process.pid });

if (holdMs) {
	log({ kind: "idle", pid: process.pid });
	const heldLines = held;
	setTimeout(() => {
		held = undefined;
		process.stdout.write(heldLines.join(""));
	}, holdMs);
}

if (stdinClosed) setTimeout(() => process.exit(0), lingerMs);
