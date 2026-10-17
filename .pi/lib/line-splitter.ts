/**
 * Splitting a subprocess's stdout into lines without breaking a character.
 *
 * A pipe hands over whatever bytes are ready, and a multi-byte character can
 * straddle two chunks. Decoding each chunk on its own produces U+FFFD at the
 * seam — and JSON.parse accepts it, because the replacement character is legal
 * inside a string literal. The result is silent corruption of an agent's answer
 * rather than an error.
 *
 * StringDecoder holds the incomplete tail of a chunk until the next one arrives.
 *
 * Lines split on LF only. U+2028 and U+2029 are valid unescaped inside a JSON
 * string, so splitting on those would cut a JSONL record in half.
 */

import { StringDecoder } from "node:string_decoder";

export interface LineSplitter {
	write(chunk: Buffer | string): void;
	/** Flush the decoder and deliver a final line that has no newline. */
	end(): void;
}

export function lineSplitter(onLine: (line: string) => void): LineSplitter {
	const decoder = new StringDecoder("utf8");
	let buffered = "";
	const feed = (text: string) => {
		buffered += text;
		const lines = buffered.split("\n");
		buffered = lines.pop() ?? "";
		for (const line of lines) onLine(line);
	};
	return {
		write: (chunk) => feed(decoder.write(chunk)),
		end: () => {
			feed(decoder.end());
			if (buffered) onLine(buffered);
			buffered = "";
		},
	};
}
