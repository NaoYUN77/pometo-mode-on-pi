/**
 * Skill routes: bare `/name` for every skill in `.agents/skills/`.
 *
 * pstack is written for Cursor, where a skill is invoked as `/how`, `/arena`,
 * `/interrogate`. pi registers skills as `/skill:<name>`, which is the same
 * capability under a longer name. This restores the short name so the original
 * usage runs unchanged.
 *
 * It rewrites the input rather than registering a command. A registered command
 * would handle the line itself, and in print mode the process then exits before
 * the message it sent can run. Transforming the input keeps every mode working:
 * interactive, `-p`, json, and rpc.
 *
 * Nothing is copied. Routes are built from the directory on every load, so
 * adding or removing a skill needs no edit here. pi's own commands and this
 * project's prompt templates win: only a name that no other layer claims is
 * rewritten.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Commands pi owns, plus anything a prompt template already claims. */
const RESERVED = new Set([
	"settings", "model", "thinking", "scoped-models", "login", "logout", "llama",
	"new", "resume", "name", "session", "tree", "fork", "clone", "compact",
	"import", "copy", "export", "share", "bug", "trust", "reload", "hotkeys",
	"changelog", "quit", "commands", "help", "routes",
]);

function frontmatter(text: string): Record<string, string> {
	if (!text.startsWith("---")) return {};
	const end = text.indexOf("\n---", 3);
	if (end === -1) return {};
	const out: Record<string, string> = {};
	for (const line of text.slice(3, end).split("\n")) {
		const at = line.indexOf(":");
		if (at === -1) continue;
		const key = line.slice(0, at).trim();
		if (key) out[key] = line.slice(at + 1).trim().replace(/^["']|["']$/g, "");
	}
	return out;
}

function listDir(dir: string, filter: (name: string) => boolean): string[] {
	try {
		return fs
			.readdirSync(dir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory() && filter(entry.name))
			.map((entry) => entry.name)
			.sort();
	} catch {
		return [];
	}
}

export default function (pi: ExtensionAPI) {
	const root = process.cwd();
	const skillsDir = path.join(root, ".agents", "skills");
	const promptsDir = path.join(root, ".pi", "prompts");

	const promptNames = listDir(promptsDir, (name) =>
		fs.existsSync(path.join(promptsDir, name, "SKILL.md")),
	);
	for (const file of (() => {
		try {
			return fs.readdirSync(promptsDir).filter((f) => f.endsWith(".md"));
		} catch {
			return [];
		}
	})()) {
		promptNames.push(file.replace(/\.md$/, ""));
	}
	for (const name of promptNames) RESERVED.add(name);

	const routes = new Map<string, string>();
	for (const name of listDir(skillsDir, (n) => fs.existsSync(path.join(skillsDir, n, "SKILL.md")))) {
		if (RESERVED.has(name)) continue;
		routes.set(name, path.join(skillsDir, name, "SKILL.md"));
	}

	pi.on("input", async (event) => {
		if (event.source === "extension") return { action: "continue" };
		const text = event.text;
		if (!text.startsWith("/")) return { action: "continue" };

		const space = text.search(/\s/);
		const name = (space === -1 ? text.slice(1) : text.slice(1, space)).trim();
		const file = routes.get(name);
		if (!file) return { action: "continue" };

		const args = space === -1 ? "" : text.slice(space + 1).trim();
		let body: string;
		try {
			body = fs.readFileSync(file, "utf8");
		} catch {
			return { action: "continue" };
		}
		return {
			action: "transform",
			text: args ? `${body}\n\n---\n\n${args}` : body,
		};
	});

	pi.registerCommand("routes", {
		description: "List the bare skill routes this session answers",
		handler: async (_args, ctx) => {
			ctx.ui.notify(
				`${routes.size} routes: ${[...routes.keys()].map((n) => `/${n}`).join("  ")}`,
				"info",
			);
			ctx.ui.notify(
				`reserved, not routed: ${[...RESERVED].sort().join(", ")}`,
				"info",
			);
		},
	});
}
