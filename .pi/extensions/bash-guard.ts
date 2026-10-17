/**
 * bash guard: refuse a search that cannot finish.
 *
 * `find / -maxdepth 6` looks bounded and is not. On this machine `/` is a whole
 * drive, and pi's bash tool has no timeout, so the call never returns and the
 * session stops dead with no error. That is how one session died at 21:10.
 *
 * So the guard blocks a recursive search rooted at a filesystem root, and says
 * why. A scoped search is untouched: `find . -name`, `find src -type d`,
 * `find /e/Code/repo -maxdepth 2`.
 *
 * Only the command text is inspected. It is a guard against the accident, not a
 * sandbox: a determined command can still get through, and the point is not to
 * stop that.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Paths that mean "everything": no search rooted here can be bounded. */
function isRoot(token: string): boolean {
	const value = token.replace(/^["']|["']$/g, "");
	if (value === "/" || value === "//" || value === "~" || value === "~/" ) return true;
	if (value === "$HOME" || value === "${HOME}" || value === "%USERPROFILE%") return true;
	// A single-letter mount under Git Bash: /c, /d, /e
	if (/^\/[a-z]\/?$/i.test(value)) return true;
	// A bare Windows drive: C:, C:/, C:\
	if (/^[a-z]:[\\/]?$/i.test(value)) return true;
	return false;
}

/** Which words name a command that walks a tree. */
const WALKERS = new Set(["find", "du", "tree", "ls"]);

/** Options of `find` that consume the next word. */
const FIND_ARG_OPTS = new Set([
	"-maxdepth", "-mindepth", "-type", "-name", "-iname", "-path", "-ipath",
	"-regex", "-iregex", "-user", "-group", "-size", "-mtime", "-mmin",
	"-newer", "-perm", "-printf", "-fprint", "-exec", "-execdir", "-not",
	"-a", "-o", "-and", "-or", "-printf",
]);

function tokenize(segment: string): string[] {
	const out: string[] = [];
	let current = "";
	let quote: string | null = null;
	for (const ch of segment) {
		if (quote) {
			if (ch === quote) quote = null;
			else current += ch;
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			continue;
		}
		if (/\s/.test(ch)) {
			if (current) out.push(current);
			current = "";
			continue;
		}
		current += ch;
	}
	if (current) out.push(current);
	return out;
}

/** The path a walking command starts from, or null when it starts at `.`. */
function searchRoot(tokens: string[]): string | null {
	const command = tokens[0];
	if (!WALKERS.has(command)) return null;

	if (command === "find") {
		let i = 1;
		while (i < tokens.length) {
			const token = tokens[i];
			if (token === "-H" || token === "-L" || token === "-P") {
				i += 1;
				continue;
			}
			if (token.startsWith("-")) {
				// A flag that takes a value swallows the next token.
				i += FIND_ARG_OPTS.has(token) ? 2 : 1;
				continue;
			}
			return token;
		}
		return null;
	}

	// du, tree, ls: the root is the first non-flag word.
	for (const token of tokens.slice(1)) {
		if (!token.startsWith("-")) return token;
	}
	return null;
}

/** grep and rg walk too, when told to recurse. */
function recursiveGrepRoot(tokens: string[]): string | null {
	const command = tokens[0];
	if (command !== "grep" && command !== "egrep" && command !== "fgrep" && command !== "rg") {
		return null;
	}
	const recursing =
		command === "rg" ||
		tokens.some((t) => t === "-r" || t === "-R" || t === "--recursive" || /^-[a-zA-Z]*[rR]/.test(t));
	if (!recursing) return null;
	const paths = tokens.slice(1).filter((t) => !t.startsWith("-"));
	// grep: pattern then paths; rg: pattern then paths
	return paths.length > 1 ? paths[paths.length - 1] : null;
}

export function offendingRoot(command: string): string | null {
	const segments = command.split(/\|\||&&|[;|]/);
	for (const segment of segments) {
		const tokens = tokenize(segment.trim());
		if (tokens.length === 0) continue;

		// Skip a leading cd; the search itself is what matters.
		const start = tokens[0] === "cd" ? 2 : 0;
		const head = tokens.slice(start);
		if (head.length === 0) continue;

		const root = searchRoot(head) ?? recursiveGrepRoot(head);
		if (root && isRoot(root)) return root;
	}
	return null;
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event) => {
		if (event.toolName !== "bash" && event.toolName !== "powershell") return undefined;
		const command = String((event.input as any)?.command ?? "");
		if (!command) return undefined;

		const root = offendingRoot(command);
		if (!root) return undefined;

		return {
			block: true,
			reason: [
				`Refusing a search rooted at ${root}: it walks the whole filesystem and never returns here,`,
				"and pi's bash has no timeout.",
				"Scope it instead: the repo (`.`), a directory you can name, or a real subdirectory of a mount.",
				"Do not retry with a different root spelling.",
			].join(" "),
		};
	});
}
