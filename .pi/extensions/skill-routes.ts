/**
 * Skill and playbook routes: bare `/how`, `/arena`, `/bug-fix`, …
 *
 * pstack is written for Cursor, where a skill is invoked as `/how` and a playbook
 * is picked by the mode. pi registers skills as `/skill:<name>`, and knows nothing
 * about playbooks, so this extension adds both shapes as bare commands.
 *
 * Two kinds of route:
 *
 *   skill     `/how why does X work`  injects that skill's body and the question.
 *   playbook  `/bug-fix the export drops a row`  injects the router body, the
 *             playbook's steps, and a line saying the playbook is already chosen.
 *             A playbook is only steps; without the router its rules are missing.
 *
 * It rewrites the input instead of registering commands. A registered command
 * handles the line itself, and in print mode the process then exits before the
 * message it sent can run. Transforming keeps interactive, `-p`, json and rpc
 * all working.
 *
 * Nothing is copied. Routes are rebuilt from the tree on every load, so adding or
 * removing a skill or playbook needs no edit here. pi's own commands and this
 * project's prompt templates win: only a name no other layer claims is rewritten.
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

function read(file: string): string | null {
	try {
		return fs.readFileSync(file, "utf8");
	} catch {
		return null;
	}
}

function subdirs(dir: string): string[] {
	try {
		return fs
			.readdirSync(dir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
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

	// A prompt template owns its name, so /poteto-mode is never rewritten here.
	try {
		for (const file of fs.readdirSync(promptsDir)) {
			if (file.endsWith(".md")) RESERVED.add(file.replace(/\.md$/, ""));
		}
	} catch {
		// no templates: nothing to reserve
	}

	const skills = new Map<string, string>();
	for (const name of subdirs(skillsDir)) {
		if (RESERVED.has(name)) continue;
		const file = path.join(skillsDir, name, "SKILL.md");
		if (fs.existsSync(file)) skills.set(name, file);
	}

	const routerFile = path.join(skillsDir, "poteto-mode", "SKILL.md");
	const playbookDir = path.join(skillsDir, "poteto-mode", "playbooks");
	const playbooks = new Map<string, string>();
	try {
		for (const file of fs.readdirSync(playbookDir).filter((f) => f.endsWith(".md")).sort()) {
			const name = file.replace(/\.md$/, "");
			if (RESERVED.has(name) || skills.has(name)) continue;
			playbooks.set(name, path.join(playbookDir, file));
		}
	} catch {
		// no playbooks installed; skill routes still work
	}

	const split = (text: string): { name: string; args: string } | null => {
		const body = text.slice(1); // drop the leading /
		const at = body.search(/\s/);
		if (at === -1) return { name: body.trim(), args: "" };
		return { name: body.slice(0, at).trim(), args: body.slice(at + 1).trim() };
	};

	pi.on("input", async (event) => {
		if (event.source === "extension") return { action: "continue" };
		const text = event.text;
		if (!text.startsWith("/")) return { action: "continue" };
		const parsed = split(text);
		if (!parsed) return { action: "continue" };

		const skillFile = skills.get(parsed.name);
		if (skillFile) {
			const body = read(skillFile);
			if (body === null) return { action: "continue" };
			return {
				action: "transform",
				text: parsed.args ? `${body}\n\n---\n\n${parsed.args}` : body,
			};
		}

		const playbookFile = playbooks.get(parsed.name);
		if (playbookFile) {
			const router = read(routerFile);
			const steps = read(playbookFile);
			if (router !== null && steps !== null) {
				return {
					action: "transform",
					text: [
						router,
						"---",
						steps,
						"---",
						`The playbook is already chosen: **${parsed.name}**. Do not match another one. Copy its steps into the todo list verbatim, then work them.`,
						parsed.args ? `Task: ${parsed.args}` : "",
					]
						.filter(Boolean)
						.join("\n\n"),
				};
			}
		}

		return { action: "continue" };
	});

	pi.registerCommand("routes", {
		description: "List the bare routes this session answers",
		handler: async (_args, ctx) => {
			ctx.ui.notify(
				`${skills.size} skill routes: ${[...skills.keys()].map((n) => `/${n}`).join("  ")}`,
				"info",
			);
			ctx.ui.notify(
				`${playbooks.size} playbook routes: ${[...playbooks.keys()].map((n) => `/${n}`).join("  ")}`,
				"info",
			);
			ctx.ui.notify(
				`reserved: ${[...RESERVED].sort().join(", ")}`,
				"info",
			);
		},
	});
}
