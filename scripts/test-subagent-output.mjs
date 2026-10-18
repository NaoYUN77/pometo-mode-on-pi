#!/usr/bin/env node
/**
 * The subagent tool's output handling, without spending a token.
 *
 *   node scripts/test-subagent-output.mjs
 *
 * Two things a subagent result must survive: being truncated to the 50 KB cap
 * without breaking a UTF-8 sequence or a surrogate pair, and arriving as whole
 * characters when pi's stdout arrives split mid-character.
 *
 * Both are pure functions over strings and buffers, so they need no child
 * process. The stdout splitter is exercised through the same line splitter the
 * extension uses, fed one byte at a time, which is the worst case a pipe can
 * produce.
 */

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

const truncate = await import(
	pathToFileURL(path.join(root, ".pi", "lib", "truncate.ts")).href
);
const CAP = truncate.OUTPUT_CAP_BYTES;

// A lone surrogate is the tell that a slice cut a character in half. It cannot
// be encoded as UTF-8, so it reaches the model as U+FFFD.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

// --- truncation: byte cap -------------------------------------------------

{
	const ascii = "a".repeat(CAP * 2);
	const out = truncate.truncateUtf8(ascii, CAP);
	check("ascii over the cap is cut to the cap", Buffer.byteLength(out, "utf8") === CAP);
}

{
	const exact = "a".repeat(CAP);
	const out = truncate.truncateUtf8(exact, CAP);
	check("a string at the cap is returned whole", out === exact);
}

{
	const short = "hello";
	check("a short string is untouched", truncate.truncateUtf8(short, CAP) === short);
}

// --- truncation: never split a character ---------------------------------

{
	const cases = [
		["a 2-byte run", "a" + "é".repeat(CAP)],
		["a 3-byte run", "a" + "中".repeat(CAP)],
		["a 4-byte run", "a" + "😀".repeat(CAP)],
		["mixed widths", "a中😀".repeat(CAP)],
	];
	for (const [name, text] of cases) {
		const out = truncate.truncateUtf8(text, CAP);
		const bytes = Buffer.byteLength(out, "utf8");
		check(
			`${name}: stays under the cap`,
			bytes <= CAP,
			`${bytes} > ${CAP}`,
		);
		check(
			`${name}: no lone surrogate at the cut`,
			!LONE_SURROGATE.test(out),
			`tail ${JSON.stringify(out.slice(-3))}`,
		);
		// Re-encoding must round-trip: a cut mid-sequence would show as U+FFFD.
		check(
			`${name}: re-encodes without replacement characters`,
			!out.includes("\uFFFD"),
		);
	}
}

// --- truncation: cost -----------------------------------------------------
//
// The old slice-and-remeasure loop is O(n^2): each Buffer.byteLength walks the
// whole string. A 120 KB Chinese result must not take most of a second.

{
	const text = "中文输出".repeat(30_000);
	const started = performance.now();
	truncate.truncateUtf8(text, CAP);
	const ms = performance.now() - started;
	check(
		"a 120 KB Chinese result truncates in under 50 ms",
		ms < 50,
		`took ${ms.toFixed(1)} ms`,
	);
}

// --- the notice a cut result carries -------------------------------------

{
	const text = "x".repeat(CAP + 1000);
	const out = truncate.truncateUtf8(text, CAP);
	check("the cut is shorter than the input", out.length < text.length);
	check(
		"the cut result has no trailing partial character",
		Buffer.from(out, "utf8").toString("utf8") === out,
	);
}

// --- stdout decoding: split mid-character ---------------------------------

{
	const { lineSplitter } = await import(
		pathToFileURL(path.join(root, ".pi", "lib", "line-splitter.ts")).href
	);
	const line = JSON.stringify({
		type: "message_end",
		message: { role: "assistant", content: [{ type: "text", text: "中文输出，带标点。" }] },
	});
	const bytes = Buffer.from(`${line}\n`, "utf8");
	for (const [name, chunkSize] of [
		["one byte at a time", 1],
		["three bytes", 3],
		["seven bytes", 7],
		["the whole line", bytes.length],
	]) {
		const lines = [];
		const splitter = lineSplitter((l) => lines.push(l));
		for (let i = 0; i < bytes.length; i += chunkSize) splitter.write(bytes.subarray(i, i + chunkSize));
		splitter.end();
		check(`${name}: one line out`, lines.length === 1, `${lines.length} lines`);
		let parsed;
		try {
			parsed = JSON.parse(lines[0]);
		} catch (e) {
			check(`${name}: parses as JSON`, false, e.message);
			continue;
		}
		check(
			`${name}: the text survived intact`,
			parsed.message.content[0].text === "中文输出，带标点。",
			JSON.stringify(parsed.message.content[0].text),
		);
	}
}

// --- stdout decoding: a non-JSON line must not end the run ----------------

{
	const { lineSplitter } = await import(
		pathToFileURL(path.join(root, ".pi", "lib", "line-splitter.ts")).href
	);
	const seen = [];
	const splitter = lineSplitter((l) => seen.push(l));
	splitter.write(Buffer.from("not json\n{\"ok\":true}\npartial", "utf8"));
	splitter.end();
	check("a partial final line is still delivered", seen.length === 3, `${seen.length} lines`);
	check("the last line has no trailing newline", seen[2] === "partial", JSON.stringify(seen[2]));
}

console.log();
if (failed > 0) {
	console.log(`subagent output: ${failed} failed`);
	process.exit(1);
}
console.log("subagent output: all checks passed");
