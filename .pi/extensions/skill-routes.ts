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
 * Routes are rebuilt from the tree on every load, so adding or removing a skill
 * needs no edit here. pi's own commands and this project's prompt templates win:
 * only a name no other layer claims is rewritten.
 *
 * Two places the tree can live, tried in order, because the same file serves a
 * project checkout and a `pi install` package:
 *
 *   1. `process.cwd()` or an ancestor, the project case.
 *   2. This file's own directory, the installed-package case, where the skills
 *      sit beside the extension instead of under the user's project.
 *
 * Playbooks carry no frontmatter, which is what keeps them from matching on their
 * own. `/routes` still has to say what each one is for, so the grouping and the
 * one-line note live in the tables below, keyed by name. A playbook missing from
 * them still routes, and shows up under `其他`; `scripts/test-routes.mjs` fails
 * when the tables and the directory disagree, so the drift is caught, not shipped.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Commands pi owns, plus anything a prompt template already claims. */
const RESERVED = new Set([
	"settings", "model", "thinking", "scoped-models", "login", "logout", "llama",
	"new", "resume", "name", "session", "tree", "fork", "clone", "compact",
	"import", "copy", "export", "share", "bug", "trust", "reload", "hotkeys",
	"changelog", "quit", "commands", "help", "routes",
]);

/** Playbook groups, in the order `/routes` prints them. Mirrors COMMANDS.md §9. */
const PLAYBOOK_GROUPS: { title: string; names: string[] }[] = [
	{
		title: "写代码",
		names: ["feature", "refactoring", "bug-fix", "perf-issue", "hillclimb"],
	},
	{
		title: "查问题",
		names: ["investigation", "runtime-forensics", "trace-forensics"],
	},
	{
		title: "设计与原型",
		names: ["prototype", "visual-parity", "multi-phase-plan"],
	},
	{
		title: "交付",
		names: ["opening-a-pr", "babysit", "shipping"],
	},
	{
		title: "长时间跑",
		names: ["autonomous-run", "orchestrate", "autopilot-full", "autopilot-stack"],
	},
	{
		title: "维护自己的状态",
		names: ["session-pickup", "pause-safely", "worktree-cleanup", "eval", "authoring-a-skill"],
	},
];

/** One line per playbook: when to reach for it, not what its steps say. */
const PLAYBOOK_NOTES: Record<string, string> = {
	feature: "从命名过的数据形状建新行为",
	refactoring: "行为不变，只改结构",
	"bug-fix": "复现 → 根因 → 拿运行时证据修",
	"perf-issue": "追一个有测量的慢，一次性",
	hillclimb: "对一个指标持续爬坡，一胜一 commit",
	investigation: "只读，交付带引用的答案",
	"runtime-forensics": "活体仪表诊断，交付诊断不是修复",
	"trace-forensics": "诊断已捕获的 profile，不重跑",
	prototype: "丢弃式草图，用实验替代问人",
	"visual-parity": "像素级等价，image diff 为准",
	"multi-phase-plan": "跨阶段或多 stack PR，只写计划",
	"opening-a-pr": "从小的有序 commit 开 ready PR",
	babysit: "开到 merge-ready，不合并",
	shipping: "独立验证绿栈，从底往上合",
	"autonomous-run": "一个任务跑到可检验谓词",
	orchestrate: "常驻项目：多天、多 stack、一队子代理",
	"autopilot-full": "一串独立 PR 全自动跑到 merged",
	"autopilot-stack": "全自动建线性栈，交人合",
	"session-pickup": "接手别人（或昨天的自己）在飞的工作",
	"pause-safely": "干净挂起，写 resume note",
	"worktree-cleanup": "剪已合 worktree、过期模拟器",
	eval: "盲测技能或提示词改动的行为影响",
	"authoring-a-skill": "写或改 SKILL.md",
};

/** Columns a character occupies, so the notes line up behind CJK text. */
function displayWidth(text: string): number {
	let width = 0;
	for (const char of text) {
		const cp = char.codePointAt(0) ?? 0;
		const wide =
			(cp >= 0x1100 && cp <= 0x115f) ||
			(cp >= 0x2e80 && cp <= 0xa4cf) ||
			(cp >= 0xac00 && cp <= 0xd7a3) ||
			(cp >= 0xf900 && cp <= 0xfaff) ||
			(cp >= 0xfe30 && cp <= 0xfe6f) ||
			(cp >= 0xff00 && cp <= 0xff60) ||
			(cp >= 0xffe0 && cp <= 0xffe6) ||
			(cp >= 0x1f300 && cp <= 0x1f9ff);
		width += wide ? 2 : 1;
	}
	return width;
}

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

/** True only for a real pstack tree. `~/.agents/skills` holds unrelated user
 * skills, so plain `.agents/skills` would stop the walk at the home directory and
 * never reach the package's own copy. The router is the marker that distinguishes
 * them. */
function hasTree(dir: string): boolean {
	return fs.existsSync(path.join(dir, ".agents", "skills", "poteto-mode", "SKILL.md"));
}

/** Nearest ancestor of `start` that holds a pstack tree, or null. */
function nearestTree(start: string): string | null {
	let dir = start;
	for (;;) {
		if (hasTree(dir)) return dir;
		const parent = path.dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

/** Where the tree lives, project first, then beside this installed file. */
function findRoot(): string {
	const fromCwd = nearestTree(process.cwd());
	if (fromCwd) return fromCwd;

	// Installed as a package: this file sits in <pkg>/.pi/extensions/, and the
	// skills sit in <pkg>/.agents/skills/. Walk up from the file itself.
	let here = path.dirname(fileURLToPath(import.meta.url));
	for (;;) {
		if (hasTree(here)) return here;
		const parent = path.dirname(here);
		if (parent === here) break;
		here = parent;
	}
	return process.cwd();
}

export default function (pi: ExtensionAPI) {
	const root = findRoot();
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

	/** `/routes` body: playbooks grouped and explained, skills as bare names. */
	const routesText = (): string => {
		const lines: string[] = [];
		lines.push(
			`playbook ${playbooks.size} 个 — 一类任务的强制步骤清单。` +
				`直接点 /<name>，或 /poteto-mode 让它匹配。`,
		);
		lines.push("");

		const seen = new Set<string>();
		const emit = (title: string, names: string[]) => {
			const rows = names.filter((n) => playbooks.has(n) && !seen.has(n));
			if (rows.length === 0) return;
			for (const n of rows) seen.add(n);
			lines.push(title);
			const width = Math.max(...rows.map((n) => displayWidth(`/${n}`)));
			for (const n of rows) {
				const route = `/${n}`;
				const gap = " ".repeat(width - displayWidth(route) + 2);
				lines.push(`  ${route}${gap}${PLAYBOOK_NOTES[n] ?? ""}`.trimEnd());
			}
			lines.push("");
		};

		for (const group of PLAYBOOK_GROUPS) emit(group.title, group.names);
		emit("其他", [...playbooks.keys()]);

		lines.push(
			`skill ${skills.size} 个 — 单个能力，不开清单：` +
				[...skills.keys()].map((n) => `/${n}`).join(" "),
		);
		lines.push("");
		lines.push(`保留给上层（pi 命令、prompt 模板）：${[...RESERVED].sort().join(", ")}`);
		return lines.join("\n");
	};

	// The listing goes through a transcript entry, not `ui.notify`. In `-p` mode pi
	// takes stdout over (`core/output-guard.js`) and a notify writes nowhere, so the
	// command looked dead. `appendEntry` survives every mode and stays out of the
	// model's context; the renderer draws it in the TUI.
	const ROUTES_ENTRY = "routes-listing";

	pi.registerEntryRenderer<{ text: string }>(ROUTES_ENTRY, (entry, { expanded }, theme) => {
		const text = entry.data?.text ?? "";
		const all = text.split("\n");
		const shown = expanded ? all : all.slice(0, 14);
		const lines = shown.map((line) => ` ${line}`);
		if (!expanded && all.length > shown.length) {
			lines.push(` ${theme.fg("dim", `… ${all.length - shown.length} more lines, ctrl+o to expand`)}`);
		}
		// A plain Component, not `@earendil-works/pi-tui`'s Text: this file must stay
		// importable by `node scripts/test-routes.mjs` with no dependency resolution.
		return {
			invalidate() {},
			render(width: number) {
				return lines.map((line) => line.slice(0, Math.max(0, width)));
			},
		};
	});

	pi.registerCommand("routes", {
		description: "List the bare routes this session answers, playbooks by group",
		handler: async (_args, ctx) => {
			const text = routesText();
			// Print mode renders assistant messages only, so a transcript entry would be
			// invisible there. pi redirects stdout to stderr in those modes
			// (`core/output-guard.js`), so stderr is the stream the user actually sees.
			if (ctx.mode !== "tui") {
				process.stderr.write(`${text}\n`);
				return;
			}
			pi.appendEntry(ROUTES_ENTRY, { text });
			// A one-line notify still helps in the TUI, where the entry can be scrolled
			// past. It is deliberately last, because pi collapses back-to-back notifies.
			if (ctx.hasUI) ctx.ui.notify(`${playbooks.size} playbooks, ${skills.size} skills`, "info");
		},
	});
}
