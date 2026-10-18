/**
 * Turning a short name into a model the catalog serves.
 *
 * A seat writes `model: pro`, or `model: magpie/deepseek/deepseek-v4-pro`, or
 * nothing at all. `models:` holds the short names and the ids they stand for.
 *
 * Short names are matched case-insensitively. A `model:` that is not a short
 * name is taken as an id and passed through, so a typo is pi's error to report
 * and doctor's to catch, not something silently swapped for a different model.
 * `none` is the one word that names no model: it clears the seat's own model so
 * the seat inherits the parent session's, which is what removing the line does.
 */

/** One short name to id, as written in `models:` frontmatter. */
export interface ModelTable {
	[shortName: string]: string;
}

export type ModelResolution =
	| { kind: "model"; model: string }
	| { kind: "inherit" }
	| { kind: "unlisted"; name: string };

/**
 * `short: id` lines from a `models:` block, as name to id.
 *
 * Frontmatter is parsed as YAML, so the block normally arrives already mapped:
 *
 *     models:
 *       pro: magpie/deepseek/deepseek-v4-pro
 *
 * A string is accepted too, for a block written on one line or in a file whose
 * frontmatter parser hands back raw text. Anything else yields an empty table.
 */
export function parseModelTable(value: unknown): ModelTable {
	const table: ModelTable = Object.create(null);

	if (typeof value === "object" && value !== null) {
		for (const [name, id] of Object.entries(value as Record<string, unknown>)) {
			if (typeof id === "string" && id.trim()) table[name.toLowerCase()] = id.trim();
		}
		return table;
	}

	if (typeof value !== "string") return table;
	for (const line of value.split(/\r?\n/)) {
		const match = /^\s*([A-Za-z0-9_.-]+)\s*:\s*(\S+)\s*$/.exec(line);
		if (match) table[match[1].toLowerCase()] = match[2];
	}
	return table;
}

/**
 * What a seat's `model:` means against a table.
 *
 * `unlisted` is a short name the table does not define. The caller decides
 * whether that is an error; this function only says what it saw.
 */
export function resolveModel(value: string | undefined, table: ModelTable): ModelResolution {
	const name = value?.trim();
	if (!name) return { kind: "inherit" };
	if (name.toLowerCase() === "none") return { kind: "inherit" };
	if (name.includes("/")) return { kind: "model", model: name };
	const id = table[name.toLowerCase()];
	return id ? { kind: "model", model: id } : { kind: "unlisted", name };
}
