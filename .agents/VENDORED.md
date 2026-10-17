# Vendored pstack

Upstream: `https://github.com/cursor/plugins` under `pstack/`
Version: **0.15.25**
Commit: `101b274dd991f694e1f7024be2157e5f3adf07de` (2026-10-16)
License: MIT, Copyright (c) 2026 Lauren Tan. See `LICENSE-pstack`.

`.agents/skills/` is a byte-copy of upstream `pstack/skills/`, with exactly one
file edited:

| File | Edit |
| --- | --- |
| `poteto-mode/SKILL.md` | A six line harness preamble inserted after the frontmatter, pointing at `.agents/harness/CLAUDE.md` and `.agents/pstack-models.md`. |

Everything else is untouched, so a re-vendor is a copy plus that one patch.

## Why not the plugin install

`/plugin marketplace add cursor/plugins` installs a generated Cursor-shaped copy
and prefixes every command with `/pstack:`. Vendoring keeps four things:

- Skills readable at a stable path, which `poteto-agent` needs in order to tell a
  delegate where the router lives.
- One place to patch the harness preamble.
- `.agents/skills/` is the location pi, Claude Code and Codex all read, so the
  same tree serves every agent on this machine.
- No marketplace dependency at session start.

## Re-vendoring

```bash
git clone --filter=blob:none --sparse https://github.com/cursor/plugins /tmp/cplugins
cd /tmp/cplugins && git sparse-checkout set pstack
rm -rf .agents/skills && cp -r /tmp/cplugins/pstack/skills .agents/skills
cp /tmp/cplugins/pstack/LICENSE .agents/skills/LICENSE-pstack
# re-apply the poteto-mode preamble, update this file's version and commit
```

## Upstream files deliberately not vendored

`agents/`, `automations/`, `assets/`, `docs/guide/`. `agents/poteto-agent.md`
targets Cursor's `is_background` field and is replaced by `.claude/agents/`.
`docs/harness/claude-code.md` is upstream's mapping and is superseded by
`.agents/harness/CLAUDE.md`, which carries three corrections it lacks: the
`fable` slot, the `Explore` model cap, and the slot-name-only rule.
