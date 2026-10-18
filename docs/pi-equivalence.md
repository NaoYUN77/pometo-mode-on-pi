# pi equivalence

pstack's skills are written for Claude Code. This table says, for each mechanism
those skills name, what provides it here and what proves it. It is pi-specific;
Claude Code and Cursor need nothing from it.

It exists because "pi handles that" is not a claim anyone can audit. A row either
names a file in this tree that does the work, or says `difference` and gives the
reason no skill depends on it.

Statuses:

- `native` — pi does it with no code here.
- `extension` — `.pi/extensions/` does it, and the evidence names the file.
- `script` — a script in `scripts/` does it.
- `mapping` — the skills describe it in prose and `.agents/harness/pi.md` names
  the pi equivalent. No code involved.
- `difference` — pi behaves differently. The reason column says why no workflow
  needs the missing half.
- `n/a` — named somewhere but no behaviour depends on it.

`scripts/verify-equivalence.mjs` checks this file: unknown statuses,
`extension`/`script` rows whose evidence names a file that is not on disk,
`difference` rows with no reason, and a mechanism the skills name that has no row
all fail the build.

## Dispatch

| ID | Claude Code mechanism | On pi | Status | Evidence | Reason |
| --- | --- | --- | --- | --- | --- |
| D01 | `Task` with `subagent_type` | `subagent` tool, `agent` field; agent files resolve from `.pi/agents/` | extension | `.pi/extensions/subagent/index.ts`, `.pi/extensions/subagent/agents.ts` | — |
| D02 | Several `Task` calls in one message | `tasks: [{agent, task}, …]`, 8 tasks, 4 at a time | extension | `.pi/extensions/subagent/index.ts` | — |
| D03 | A `Task` chain threading one result into the next | `chain: [{agent, task}, …]` with a `{previous}` placeholder | extension | `.pi/extensions/subagent/index.ts` | — |
| D04 | `readonly: true` on a `Task` | The seat's `tools:` list, which is a full allowlist and drops `edit` and `write` | extension | `.pi/extensions/subagent/index.ts`, `.pi/agents/explorer.md` | — |
| D05 | `run_in_background: true` | `run_in_background: true` on a single-mode call: returns an agentId at once, and a completion notice arrives when the child exits | extension | `.pi/extensions/subagent/index.ts`, `.pi/lib/pi-child.ts` | — |
| D06 | `SendMessage` to steer a running agent | `send_message` sends an RPC `steer`, which the child reads after its current tool calls and carries on in the same run. A steer to a run that already settled is reported as not delivered, not as accepted | extension | `.pi/extensions/subagent/index.ts`, `.pi/lib/pi-child.ts` | — |
| D05a | `run_in_background` in a one-shot session | Refused with a reason: a `print` or `json` run exits when it settles, and shutting down ends every child | difference | — | Holding the settle would keep the process alive, which is what `pi -p` exists not to do. The caller gets an error that names the substitute (a foreground call, or an interactive session) instead of a promise of a notice that cannot arrive. |
| D06a | `SendMessage` to continue a finished agent | Not provided | difference | — | The child exits when it settles, so there is nothing to resume. `send_message` refuses with the finished run's result instead of silently starting a second one, and a caller that wants more work starts a new background agent. |
| D06b | `ListAgents` / `stop_agent` | `list_agents` lists the session's background runs and their status. There is no `stop_agent` | difference | — | Stopping needs process identity that survives a reload, which this tree does not persist. A stop that guessed at a pid would be worse than none. |
| D07 | `isolation: "worktree"` | `cwd: "<path>"` on a task, or `agentScope` for discovery. The worktree is made by the caller | difference | — | Making the worktree is `git worktree add` through `bash`. What is missing is the automatic cleanup, so a caller that makes one also removes it. `arena` already does its own path separation under `.arena/`. |
| D08 | Nested agents | Allowed with no depth cap and no marker | difference | — | Each seat's brief says not to spawn further agents. Without a depth flag there is no way to withhold the tool at a fixed layer, so the cap is discipline rather than enforcement. |
| D09 | `AskUserQuestion` / `AskQuestion` | Ask in plain text | difference | — | pi has no question tool in this tree. A playbook that needs a decision asks in the reply and waits, which is the same round trip. |
| D10 | `TodoWrite` / `TaskCreate` / `TaskUpdate` | `todo` tool, `/todos` to show it | extension | `.pi/extensions/todo.ts` | — |
| D11 | `Skill` tool and `/command` | Skills load natively; `/skill:<name>` forces one | native | — | — |
| D12 | Bare `/how`, `/bug-fix`, … (Cursor's spelling) | `skill-routes.ts` rewrites the input into the skill or playbook body | extension | `.pi/extensions/skill-routes.ts` | — |
| D13 | `ScheduleWakeup`, `/loop` | Not provided | difference | — | `.agents/harness/pi.md` lists the four playbooks that lose their wake step. They run in one sitting, or a person re-invokes them. |
| D14 | `Read`/`Edit`/`Write`/`Bash`/`Grep`/`Glob` | `read`, `edit`, `write`, `bash`; `grep`, `find`, `ls` when enabled | native | — | — |
| D15 | `WebFetch` / `WebSearch` | `curl` through `bash`; search needs an MCP server | difference | — | No vendored skill names either tool. |

## Context and configuration

| ID | Claude Code mechanism | On pi | Status | Evidence | Reason |
| --- | --- | --- | --- | --- | --- |
| C01 | `SessionStart` hook that re-asserts the mode | Not used. `/poteto-mode` is entered, not resident | difference | — | An always-on router tells a one-line question to match a playbook. The entry point is the prompt template, and the bare routes cover the rest. |
| C02 | `/poteto-mode` slash command | `.pi/prompts/poteto-mode.md`, expanded as `/poteto-mode <task>` | native | `.pi/prompts/poteto-mode.md` | — |
| C03 | `CLAUDE.md` instructions file | `AGENTS.md` or `CLAUDE.md` per directory, plus `~/.pi/agent/AGENTS.md` | native | — | — |
| C04 | `.claude/skills/` project skills | `.agents/skills/`, discovered from the working directory up to the repo root | native | — | — |
| C05 | `.claude/agents/` seat files | `.pi/agents/`, read by the `subagent` tool | extension | `.pi/extensions/subagent/agents.ts` | — |
| C06 | `~/.cursor/rules/pstack-models.mdc` role table | `.agents/pstack-models.md`, and one `model:` per seat file | mapping | `.agents/pstack-models.md` | — |
| C07 | `~/.claude/projects` transcripts | `~/.pi/agent/sessions/<project>/` | mapping | `.pi/extensions/bash-guard.ts` | — |
| C08 | `agent-transcripts/` named by the system prompt | No such directory exists; `.agents/harness/pi.md` gives the real path | difference | — | The four skills that name it are pointed at the sessions directory instead. A search from the filesystem root used to hang the session, which is why the bash guard exists. |
| C09 | `CLAUDE_PLUGIN_ROOT` | Resolved from each extension's own `import.meta.dirname` | extension | `.pi/extensions/skill-routes.ts`, `.pi/lib/project-tools.ts` | — |
| C10 | A marketplace that copies skills in | Nothing is copied; `/routes` rebuilds the list from the tree on every load | extension | `.pi/extensions/skill-routes.ts` | — |

## Guards that exist only here

| ID | Claude Code mechanism | On pi | Status | Evidence | Reason |
| --- | --- | --- | --- | --- | --- |
| G01 | Not applicable — pi-specific | Unbounded search guard: a recursive search rooted at a filesystem root is refused | extension | `.pi/extensions/bash-guard.ts` | — |
| G02 | Not applicable — pi-specific | A tool name the project already ships is stood down at load, not fought over | extension | `.pi/lib/project-tools.ts` | — |
| G03 | Not applicable — pi-specific | A subagent result cut to 50 KB without splitting a character; stdout split mid-character is decoded whole | extension | `.pi/lib/truncate.ts`, `.pi/lib/line-splitter.ts` | — |
