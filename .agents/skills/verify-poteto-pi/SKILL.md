---
name: verify-poteto-pi
description: "Prove this repo's setup and anything built on it still work. Runs the doctor and every verify.mjs in tree. Use before claiming a task done, after changing the mode block, seats, or skills, and whenever a page or module needs its numbers checked."
---

# Verify poteto-pi

The check is one command.

```bash
bash scripts/check.sh
```

It runs `scripts/doctor.sh`, then every `verify.mjs` under the tree, and prints
`check: green` or `check: RED` with a non-zero exit on red.

A task file names it, so a headless run cannot skip it:

```markdown
---
check: bash scripts/check.sh
---
```

## What green means, and what it does not

Green covers the setup (mode block present, seat models resolve, no read-only seat
can write, wiring intact) and whatever each page's own `verify.mjs` asserts, which
for a page is its arithmetic and its structure.

Green does not mean the page looks right. Typography, layout at 360px, and whether
a diagram reads are judgement calls no script settles. Say so when reporting:
name what the check covered and name what only a person can see. Claiming a visual
pass off a green script is the failure this skill exists to prevent.

## When a page has no verify.mjs

Write one before claiming the page done. Assert the numbers it computes, against
hand-derived truths, and assert the structural claims: the sections the spec
names, the links that must resolve, the counts the copy states. Keep it re-runnable
rather than eyeballed, per `principle-prove-it-works`.

## When the check is red

Read the failure before touching the implementation. The common case is a broken
assertion, not broken code: a key parsed wrong, a unit assumed, a selector that
moved. Fix the check first when the check is what is wrong, and say which it was.
