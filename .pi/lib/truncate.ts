/**
 * Cutting a subagent's output to the byte cap without breaking a character.
 *
 * A result that runs past the cap is cut and the full copy is kept in the tool's
 * details. The cut has to land on a character boundary: slicing a JS string by
 * index counts UTF-16 code units, so it can stop between the two halves of a
 * surrogate pair, and slicing an encoded buffer by byte can stop inside a
 * multi-byte sequence. Either one reaches the model as a replacement character,
 * which quietly corrupts the agent's answer.
 *
 * One encode, then walk back at most three bytes. Not slice-and-remeasure, which
 * re-encodes the whole string on every attempt and turns a 120 KB result into
 * three quarters of a second.
 */

export const OUTPUT_CAP_BYTES = 50 * 1024;

/** Bytes a truncated result may occupy, matching the subagent tool's cap. */
export function truncateUtf8(text: string, cap: number = OUTPUT_CAP_BYTES): string {
	// A JS string that already fits in code units fits in bytes for ASCII only,
	// so the cheap exit is on the encoded length.
	const buf = Buffer.from(text, "utf8");
	if (buf.length <= cap) return text;

	let end = cap;
	// 0x80..0xBF are UTF-8 continuation bytes. Back off until the cut sits on the
	// start of a sequence.
	while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
	return buf.subarray(0, end).toString("utf8");
}

/** The message a cut result carries, naming how much was withheld. */
export function truncationNotice(omittedBytes: number, outputFile: string | undefined): string {
	const where = outputFile ? ` Full output: ${outputFile}` : " Full output preserved in tool details.";
	return `[Output truncated: ${omittedBytes} bytes omitted.${where}]`;
}
