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
| Open a todolist | `todo` tool, registered by `.pi/extensions/todo.ts`. `/todos` shows the list |
| `Grep`, `Glob` | `grep`, `find` |
| `Read` | `read` |

## Subagent modes

pi's subagent tool takes three shapes, and they map onto Cursor's `Task` calls
better than Claude Code does. A single-mode call also takes `run_in_background`,
which is what makes `send_message` usable: a foreground call occupies the turn, so
there is nothing to steer it from.

| Cursor | pi |
| --- | --- |
| one `Task` | `{ agent, task }` |
| several `Task` calls in one message | `{ tasks: [{agent, task}, …] }`, up to 8, 4 concurrent |
| a chained flow with `{previous}` | `{ chain: [{agent, task}, …] }` |
| `readonly: true` | `agent: "explorer"` |
| `environment: "cloud"`, own worktree | `cwd: "<path to a worktree you made>"`. pi has no isolation flag, so make the worktree yourself and pass its path |
| `run_in_background` | `run_in_background: true` on a single-mode call. Returns an `agentId` at once and posts a completion notice when the child exits. Refused in `print` and `json` mode, where the session ends at settle and would kill the child |
| `SendMessage` | `send_message`, addressed by `agentId`. It steers a run that is still live; a run that already settled is refused, because the child exits when it does |
| `ListAgents` | `list_agents` |
| `stop_agent` | not available. End the session, or let the run finish |
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

## A seat's `tools:` list is a full allowlist

`--tools` with plain names replaces the whole selection, so a seat that writes
`tools: read, grep, find, ls` gets exactly those four and nothing else. Every
tool not named is off, built-in or extension alike: `edit`, `write`, `subagent`,
`todo`, and every `gh_*` tool are all gone.

That is what makes `explorer`, `judge` and `reviewer` read-only in practice rather
than on paper, and it is also the trap. A seat that needs an extension tool has to
name it, and a seat written as `tools: read, bash` by someone expecting the rest
to stay gets a child that can read and run shell commands and cannot call
`gh_issue_list` to report back. The failure is silent: the tool is simply absent.

Two spellings exist and cannot be mixed. `+name` and `-name` entries adjust the
default selection instead of replacing it, so `tools: +grep, +find` keeps `read`,
`bash`, `edit` and `write` and adds two. A list holding both a plain name and a
`+`/`-` entry is rejected outright. Use the plain form for a read-only seat, where
replacing everything is the point, and the `+`/`-` form when the defaults should
survive.

Verified on pi 1.3.0: an extension tool registered for the child is absent under
`--tools read` and present under `--exclude-tools edit,write`.

## Paths

| Cursor | pi |
| --- | --- |
| `.cursor/skills/` | `.agents/skills/`, natively. No mirror step, unlike Claude Code |
| `.cursor/agents/` | `.pi/agents/` |
| `.cursor/rules/*.mdc` | `.pi/APPEND_SYSTEM.md`, which enters the system prompt every request. That is the Custom Mode equivalent |
| transcripts | `~/.pi/agent/sessions/`, one JSONL per session. Subagents run with `--no-session`, so their transcript is the parent's tool result |
| `/poteto-mode` | `.pi/prompts/poteto-mode.md`, expanded as `/poteto-mode <task>` |

## Where a skill says `agent-transcripts/`

Four vendored skills (`automate-me`, `eval`, `orchestrate`, `session-pickup`) say
a workspace's transcripts live in `agent-transcripts/`, and that "the system
prompt names this path". In pi there is no such directory and the system prompt
names no such path. The transcripts are here:

```
~/.pi/agent/sessions/<project>/<timestamp>_<id>.jsonl
```

Do not search the filesystem for it. `find / -name agent-transcripts` never
returns on this machine and pi's bash has no timeout, so the session stops dead
with no error. `.pi/extensions/bash-guard.ts` refuses a search rooted at a
filesystem root, so the call fails fast with a reason instead of hanging.

## Cursor-only features

Automations, Bugbot, cloud agents, and Cursor's pull request tool have no pi
equivalent. Say so, skip that step, and continue.

Three skills the router names are not installed here, because they ship with
Cursor or with the `cursor-team-kit` plugin. Each has the substitute below. Do not
pretend to run one.

| Named in a skill | Here |
| --- | --- |
| `/deslop` (before commit) | `unslop` over the diff's prose, then `no-comments` before review |
| `control-cli` / `control-ui` (before shipping a UI) | not available. Drive the artifact yourself, or use the project's `verify-*` skill |
| `create-skill` (Cursor built-in) | the `authoring-a-skill` playbook |
| `/loop` (wake mechanism) | not available. `autonomous-run`, `autopilot-full`, `autopilot-stack` and `orchestrate` lose their wake step; a run happens in one sitting, or a person re-invokes it |

## Why there is no always-on mode block

Cursor's custom mode re-asserts the skill every turn. pi can do the same with a
project `APPEND_SYSTEM.md`, and it was tried and removed. An always-on router
block tells every message, including a one-line question, to match a playbook and
open a todo list. That is the ceremony pstack's own guide warns against.

The mode is entered instead. `/poteto-mode <task>` loads the router and asks for
the playbook, and a bare question goes to `/how` or to the answer. The template
also says to reread the router after a compaction, which is the one thing the
always-on block bought.

Rebuild nothing after editing it except the session: `/reload` picks up skills and
prompts, a new session picks up `APPEND_SYSTEM.md`.
