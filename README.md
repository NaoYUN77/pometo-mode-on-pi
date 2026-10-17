# pometo-mode-on-pi

pstack's working mode on [pi](https://pi.dev). You say the goal, it matches a
playbook and holds the rigor, you steer with short follow-ups.

A port, not a redesign. 23 playbooks, 55 skills, 24 principles, 7 subagent seats,
and bare `/how` `/bug-fix` routes — all from Lauren Tan's
[pstack](https://github.com/cursor/plugins/tree/main/pstack) 0.15.25, adapted to
pi's tool and model surface.

## Install

```bash
pi install git:github.com/NaoYUN77/pometo-mode-on-pi@v0.1.0
```

Or from a checkout:

```bash
pi install ./path/to/pometo-mode-on-pi
```

Then in any project:

```bash
pi
/trust          # once per folder, covers everything below it
/routes         # what this session answers
```

**Seats are not in the package.** pi packages carry extensions, skills, prompts,
and themes; `agents/` is not one of them. Copy the seven seat files into the
project that uses them:

```bash
cp -r <package>/.pi/agents your-project/.pi/agents
```

Then check they resolve:

```bash
bash <package>/scripts/doctor.sh
```

It reports every seat whose `model:` id the catalog does not serve. A wrong id
fails the subagent process instead of silently inheriting.

## Use

Three ways in. Pick by how much you want to decide.

```
/how do we cancel runs?          a skill, directly. No playbook, no todo list.
/bug-fix the export drops …      one playbook, chosen by you.
/poteto-mode <task>              the mode picks the playbook for you.
```

All three are bare commands, because the choice is yours. A playbook route carries
the router body on purpose: the steps mean little without the mode's rules, so
`/bug-fix` is the router plus Bug fix, with a line saying the playbook is already
chosen so it does not re-match one.

Then steer short. `continue`. `只做第一步，停下等我`. `新任务：…`.

Say the goal, not the ceremony. "the export drops its last row since yesterday,
repro first, done means the 60k fixture exports every row" routes itself to Bug fix.
A spec is not required and is usually worse.

`/routes` groups the 23 playbooks by kind with a one-line note on each, then lists
the skills. In the TUI it writes a transcript entry (`ctrl+o` to expand); in `-p`
and json modes it writes to stderr.

## What is in it

```
.agents/skills/          pstack 0.15.25, vendored, 55 skills
.agents/harness/pi.md    Cursor to pi mapping. Read before any pstack skill
.agents/pstack-models.md role to model table
.pi/extensions/          skill-routes, todo, subagent, bash-guard, gh
.pi/prompts/poteto-mode.md
.pi/agents/              seven seats, copied per project
scripts/                 doctor, check, and three zero-model-call test suites
```

## Configure models

Every role names a model in `.agents/pstack-models.md`, and each seat file carries
one `model:` id. Check an id against `pi --list-models` before writing it. pi has
no four-slot ceiling and no alias layer, so the id is used as written.

```bash
pi --list-models
```

Edit the seat files, then rerun `scripts/doctor.sh`.

## Verify it

```bash
bash scripts/check.sh
```

Runs the doctor, then every test that spends no tokens: the routing surface
(including both `/routes` output paths), the bash guard, and the GitHub tool's
pure half. Prints `check: green` or `check: RED`.

```bash
node scripts/test-routes.mjs   # 35 checks
node scripts/test-bash-guard.mjs
node scripts/verify-gh-tool.mjs
```

## Differences from pstack

Named because they change behaviour, not for completeness.

- **Playbooks are bare commands.** In Cursor a playbook has no slash command and
  only `/poteto-mode` picks one. Here `.pi/extensions/skill-routes.ts` registers
  all 23, and injects the router alongside the steps.
- **Skills have bare routes.** pi registers skills as `/skill:<name>`; this adds
  `/how`, `/arena`, and the rest, and leaves `/skill:how` working.
- **No always-on mode block.** `/poteto-mode` is entered, not resident. An
  always-on router would tell a one-line question to match a playbook.
- **Seats are per-project.** pi packages cannot ship `agents/`.
- **`/routes` instead of a marketplace.** Nothing is copied; the route list is
  rebuilt from the tree on every load.

## License

MIT. The skills are pstack's, Copyright (c) 2026 Lauren Tan, MIT — see
`.agents/skills/LICENSE-pstack`. Re-vendoring steps are in `.agents/VENDORED.md`.
