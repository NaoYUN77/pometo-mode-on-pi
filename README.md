# poteto-pi

pstack's working mode on pi. You say the goal, it matches a playbook and holds the
rigor, you steer with short follow-ups. This is a port of an existing design, not a
new one; where it differs, the difference is named below.

```
.pi/APPEND_SYSTEM.md         the mode block. Enters the system prompt every request.
.pi/prompts/poteto-mode.md   /poteto-mode <task>
.pi/agents/                  seven seats, each with a provider/model id
.pi/extensions/subagent/     the subagent tool, vendored, defaulting to project agents
.agents/skills/              pstack 0.15.25, vendored
.agents/harness/pi.md        Cursor to pi mapping. Read before any pstack skill.
.agents/pstack-models.md     role to model table, the /setup-pstack equivalent
scripts/doctor.sh            is the setup sound
scripts/check.sh             doctor plus every verify.mjs in tree
```

## Start

```bash
pi                 # first time in this folder
/trust             # saves the decision for this folder and below, stops the prompts
/poteto-mode <task>
```

Then steer short. `continue`. `只做第一步，停下等我`. `新任务：…`.

Say the goal, not the ceremony. "the export drops its last row since yesterday,
repro first, done means the 60k fixture exports every row" routes itself to Bug fix.
A spec is not required and is usually worse.

## What came from pstack, and what did not

Faithful, unmodified:

- `.agents/skills/` is pstack 0.15.25. One file carries a harness preamble, so a
  skill named for Cursor resolves on pi. See `.agents/VENDORED.md`.
- The 23 playbooks, 24 principles, and routed skills run as written.
- Roles map to models the way `/setup-pstack` does, in `.agents/pstack-models.md`.
- Delegation follows the Subagents section: `poteto-agent` for playbook-step work,
  fresh subagent per round, you own the delegate's work.

Harness adaptation, because pi has no Cursor primitives:

- `.pi/APPEND_SYSTEM.md` is the custom mode. Cursor re-asserts the whole skill each
  turn. pi gets a 57-line block holding the router and the triggers, with the skill
  body read on demand. That is a size compromise, not a design change.
- `.pi/agents/` holds seven named seats. pstack has two agents and passes
  `readonly`, `environment` and `model` as call options. pi's subagent tool only
  addresses named agents in `.pi/agents/`, so read-only and per-family variants
  became files. They are the mapping of those call options, not new roles.
- `scripts/doctor.sh` exists because `create-verification-skill` asks a
  verification skill to ship a Doctor step. It answers "is this instance worth
  driving" for the setup itself.

## Unattended work

There is no runner script here on purpose. pstack already has the shape for it:
the **autonomous-run** playbook, which states the exit condition as a checkable
predicate before the first iteration, picks a wake mechanism, and stops only when
the predicate holds. For this repo the predicate is usually `bash scripts/check.sh`
being green.

A human is part of the design. The mode's constraints are prose, and prose holds
because someone is reading the result. Remove the reader and verification is the
first thing to fall through, which is what a wrapper script cannot fix.

## Check it before trusting it

```bash
bash scripts/doctor.sh     # mode block, skills, seat models, read-only seats, wiring
bash scripts/check.sh      # doctor, then every verify.mjs, prints check: green or RED
```

Green covers arithmetic, structure, links and numbers. It does not cover how a
page looks. Typography, 360px layout, and whether a diagram reads are judgement
calls, and claiming a visual pass off a green script is the failure the check
exists to prevent.

## Cost

Measured here, one trivial prompt, same repo:

| host | tokens before your words |
| --- | --- |
| Claude Code, normal mode | 21,758 |
| Claude Code, `--bare` | 1,169 |
| pi with the mode block | 6,952 |

Cost is turns times prefix. Fewer turns and a smaller prefix are the only levers;
compaction manages the window, it does not save money.
