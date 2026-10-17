# poteto-pi

pstack's working mode on pi. You say the goal, it matches a playbook and holds the
rigor, you steer with short follow-ups. This is a port of an existing design, not a
new one; where it differs, the difference is named below.

```
.pi/prompts/poteto-mode.md   /poteto-mode <task>, the one way into the rigorous mode
.pi/extensions/skill-routes.ts  bare /how, /arena, /interrogate …
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
```

Then either route directly, the way pstack's own README shows:

```
/how do we cancel runs?
/arena this module boundary
/interrogate review this pr
```

or enter the rigorous mode when the work deserves it:

```
/poteto-mode <task>
```

The bare names come from `.pi/extensions/skill-routes.ts`, which rewrites `/how`
into the `how` skill's body before the message reaches the agent. It rebuilds the
list from `.agents/skills/` on every load, so it never drifts from what is
installed. `/routes` lists what it answers. `/skill:how` still works, and pi's own
commands and `/poteto-mode` keep their names.

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

- The mode is entered, never always-on. Cursor's custom mode can be pinned; here
  `/poteto-mode <task>` loads the router for that task only. An always-on block was
  built first and removed: it told every message, including a one-line question, to
  match a playbook and open a todo list, which is the ceremony pstack's own guide
  warns against. Measured both ways on one-line questions: with the block, a
  playbook and a throughput checkpoint; without it, two `bash` calls and a sentence.
- Bare skill names are restored. pstack's README shows `/how …` and
  `/interrogate …`; pi registers skills as `/skill:<name>`. `skill-routes.ts`
  rewrites the input so the short name works, in every mode, rebuilt from
  `.agents/skills/` on each load.
- `.pi/agents/` holds seven named seats. pstack has two agents and passes
  `readonly`, `environment` and `model` as call options. pi's subagent tool only
  addresses named agents in `.pi/agents/`, so read-only and per-family variants
  became files. They are the mapping of those call options, not new roles.
- `scripts/doctor.sh` exists because `create-verification-skill` asks a
  verification skill to ship a Doctor step. It answers "is this instance worth
  driving" for the setup itself.

## The two entry points

```
/how why …                   a skill, directly. No playbook, no todo list, no mode.
/bug-fix the export drops …  one playbook, chosen by you. Brings the router's
                             rules plus that playbook's steps.
/poteto-mode <task>          the mode picks the playbook for you.
```

All three are bare commands, because the choice is yours. `/routes` prints the
whole surface, and [COMMANDS.md](COMMANDS.md) organises every command by what you
are trying to do. A playbook route carries the router body on purpose: the steps mean
little without the mode's rules, so `/bug-fix` is the router plus Bug fix, with a
line saying the playbook is already chosen so it does not re-match one.

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
