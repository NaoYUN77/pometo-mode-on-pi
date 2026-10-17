# poteto-pi

pstack's working mode on pi. One command starts rigorous work, the mode stays in
context every turn, and the subagents run on different model families.

```
.pi/APPEND_SYSTEM.md      the mode. Enters the system prompt on every request.
.pi/prompts/poteto-mode.md   /poteto-mode <task>
.pi/agents/               seven seats, each with a real provider/model id
.pi/extensions/subagent/  the subagent tool, vendored, defaulting to project agents
.agents/skills/           pstack 0.15.25, vendored
.agents/harness/pi.md     Cursor to pi mapping. Read before any pstack skill.
.agents/pstack-models.md  role to model table
scripts/doctor.sh         preflight
```

## Start

```bash
pi                      # first time in this folder
/trust                  # saves the trust decision, stops the prompts
/poteto-mode <task>
```

Headless:

```bash
pi -p "/poteto-mode <task>" --approve
```

In Git Bash prefix with `MSYS_NO_PATHCONV=1`, or the shell rewrites `/poteto-mode`
into a Windows path. PowerShell and cmd need nothing.

## How the mode works here

Cursor's custom mode re-asserts the skill every turn and survives compaction. pi
has the same primitive, so this is a faithful port rather than an imitation.

- **Always on.** `APPEND_SYSTEM.md` is sent with every request. It is 60 lines of
  router and triggers, not the 150-line skill body. The body stays a file, read
  when a trigger fires, which is what keeps the always-on block cheap.
- **Applies itself.** The block says to match the task to a playbook, read that
  playbook, and copy its steps into a todo list before any task work. A step that
  does not apply stays visible as `skip: <reason>`.
- **Stays out of the way.** Nothing in the block needs to run for a one-line
  answer. The leaf skills hold the detail and are read only when named.
- **No slot ceiling.** Claude Code caps a seat at four aliases. pi takes any
  `provider/model`, so the role table is honoured literally.

## The seats

| seat | model | tools |
| --- | --- | --- |
| `poteto-agent` | `magpie/deepseek/deepseek-flash` | all |
| `explorer` | `magpie/deepseek/deepseek-flash` | read, grep, find, ls, bash |
| `reviewer` | `magpie/codex/gpt-6-luna` | read, grep, find, ls, bash |
| `judge` | `magpie/opencode-zen/glm-5.3-flash-free` | read, grep, find, ls |
| `runner-a` | `magpie/deepseek/deepseek-flash` | all |
| `runner-b` | `magpie/opencode-zen/glm-5.3-flash-free` | all |
| `runner-c` | `magpie/codex/gpt-6-luna` | all |

The cross-judge must not share the parent's family. The parent runs DeepSeek, so
the judge takes GLM.

## Check it before trusting it

```bash
bash scripts/doctor.sh
```

Five checks: the mode block exists, the skill tree is complete, every seat's
model resolves against `pi --list-models`, no read-only seat can write, and the
subagent extension plus the `/poteto-mode` prompt are wired.

## Cost

Measured on this machine with one trivial prompt, same repo:

| host | tokens before your words |
| --- | --- |
| Claude Code, normal mode | 21,758 |
| Claude Code, `--bare` | 1,169 |
| pi with the pstack mode block | 6,952 |

Token cost is turns times prefix. The levers that matter are fewer turns, a
smaller prefix, and not letting screenshots or whole-file reads into the history.
Compaction does not save money, it only stops the window from overflowing.

## What is not here

- No hooks. Daily context rebuild and hard read-only enforcement are skill
  instructions, not gates.
- Arena and swarm have not been run end to end on pi.
- The Claude Code port lives in a separate folder. `.agents/skills` serves both.
