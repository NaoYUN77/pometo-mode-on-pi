# pstack on pi — harness adapter

pstack's skills are written for Cursor, and `.agents/harness/CLAUDE.md` maps them
to Claude Code. This file maps them to pi. Read it once per session, before
running any pstack skill. Where this file and a skill disagree, this file wins.

`<pstack>` means `.agents/skills/`.

## Tools

| Cursor | pi |
| --- | --- |
| `Task` | the `subagent` tool |
| `AskQuestion` | ask in plain text |
| Open a todolist | `todo` tool when the session has it, else keep the list in the reply |
| `Grep`, `Glob` | `grep`, `find` |
| `Read` | `read` |

## Subagent modes

pi's subagent tool takes three shapes, and they map onto Cursor's `Task` calls
better than Claude Code does.

| Cursor | pi |
| --- | --- |
| one `Task` | `{ agent, task }` |
| several `Task` calls in one message | `{ tasks: [{agent, task}, …] }`, up to 8, 4 concurrent |
| a chained flow with `{previous}` | `{ chain: [{agent, task}, …] }` |
| `readonly: true` | `agent: "explorer"` |
| `environment: "cloud"`, own worktree | `cwd: "<path to a worktree you made>"`. pi has no isolation flag, so make the worktree yourself and pass its path |
| `run_in_background` | pi's parallel mode is already concurrent and waits; omit it |
| `resume` | spawn fresh and paste the earlier report into the brief |

Pass `agentScope: "both"` whenever the agent you want lives in `.pi/agents/`.
The vendored extension in `.pi/extensions/subagent/` defaults to it, but a
session that replaced the extension will not.

## Models

pi takes any `provider/model` the catalog serves, resolved through
`pi --list-models`. There is no four-slot ceiling and no alias layer here, so the
role table in `.agents/pstack-models.md` is honoured literally.

Give each agent file one exact id, for example `model: magpie/codex/gpt-6-luna`.
Check the id against `pi --list-models` before trusting it; a wrong id fails the
subagent process instead of silently inheriting, which is the failure mode worth
having.

## Paths

| Cursor | pi |
| --- | --- |
| `.cursor/skills/` | `.agents/skills/`, natively. No mirror step, unlike Claude Code |
| `.cursor/agents/` | `.pi/agents/` |
| `.cursor/rules/*.mdc` | `.pi/APPEND_SYSTEM.md`, which enters the system prompt every request. That is the Custom Mode equivalent |
| transcripts | `~/.pi/agent/sessions/`, one JSONL per session. Subagents run with `--no-session`, so their transcript is the parent's tool result |
| `/poteto-mode` | `.pi/prompts/poteto-mode.md`, expanded as `/poteto-mode <task>` |

## Cursor-only features

Automations, Bugbot, cloud agents, and Cursor's pull request tool have no pi
equivalent. Say so, skip that step, and continue.

## Why the mode lives in APPEND_SYSTEM.md

Cursor's custom mode re-asserts the skill every turn and survives compaction.
pi has the same primitive: a project `APPEND_SYSTEM.md` enters the system prompt
on every request. Keep it to the router and the triggers. The 150-line skill body
stays a file, read when a trigger fires, so the always-on block costs about a
tenth of what pasting it would.

Rebuild nothing after editing it except the session: `/reload` picks up skills and
prompts, a new session picks up `APPEND_SYSTEM.md`.
