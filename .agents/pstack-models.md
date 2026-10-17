# pstack role map — pi

One line per role. pi takes any `provider/model` the catalog serves, so a role
names the model it wants, in full. Check an id against `pi --list-models` before
writing it anywhere; a wrong id fails the subagent process rather than silently
inheriting, which is the failure worth having.

The parent runs `workbuddy-ai/deepseek-v4.1-flash` by default. A cross-judge must
not share the parent's family, so every panel below avoids DeepSeek for its judge.

## Models in use

| short name | id | why |
| --- | --- | --- |
| flash | `magpie/deepseek/deepseek-flash` | 1M context, cheapest coding seat |
| pro | `magpie/deepseek/deepseek-v4-pro` | 1M context, the judgment seat |
| glm | `magpie/opencode-zen/glm-5.3-flash-free` | second opinion, a different family |
| gpt | `magpie/codex/gpt-6-luna` | review and the third arena family |

## Roles

```
# code writing
feature, refactoring: flash
bug-fix: flash
perf-issue: flash
hillclimb: flash

# judgment
judgment and prose: pro
hardest tasks: pro

# understanding
how explorer: flash
how explainer: pro
why investigators: flash
why synthesizer: pro
reflect tooling: flash
reflect judgment, divergent, synthesizer: pro

# panels: the list length sets the count
arena runners: flash, glm, gpt
arena cross-judge pool: glm, gpt
swarm workers: flash
architect runners: flash, glm
interrogate reviewers: flash, glm

# review, which pstack routes through unslop and no-comments rather than a seat
review: gpt
```

## Seats

| agent file | model | notes |
| --- | --- | --- |
| `poteto-agent` | flash | the general delegate |
| `explorer` | flash | read-only recon |
| `reviewer` | gpt | read-only review |
| `judge` | glm | read-only cross-judge |
| `runner-a` | flash | arena seat on the parent's family |
| `runner-b` | glm | arena seat on a second family |
| `runner-c` | gpt | arena seat on a third family |

## Why the panel is shaped this way

`arena runners` has three entries, so three candidates run, on three families.
That is what makes a bakeoff worth running.

`arena cross-judge pool` is `glm, gpt` and never `flash`, because the parent runs
DeepSeek and arena requires the judge to be a different family.

`how explorer` and `swarm workers` sit on `flash`, the cheap seat. They are the
highest-volume spawns and the least judgment-sensitive.

## Arena seats on pi

pi has no `isolation` field, so a seat that needs its own tree must be given one.
Two shapes work.

- One file, or anything judgeable from text: give each seat its own path under
  `.arena/<slug>/candidate-<letter>/` and pass that path as `cwd`. Separate paths
  satisfy `principle-separate-before-serializing-shared-state`.
- Work on a shared tree: make a worktree yourself with `git worktree add`, pass
  its path as `cwd`, and have the seat commit and report a branch.

## Porting to Claude Code

Claude Code caps a seat at four aliases (`opus`, `sonnet`, `haiku`, `fable`), so
the roles above have to be compressed into four slots filled by
`ANTHROPIC_DEFAULT_*_MODEL`. That port lives in a separate folder, with its own
copy of this table.
