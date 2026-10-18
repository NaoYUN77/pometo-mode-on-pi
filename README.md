# pometo-mode-on-pi

[English](#english) · [中文](#中文)

---

## English

pstack's working mode on [pi](https://pi.dev). Say the goal; it matches a
playbook, holds the rigor, and you steer with short follow-ups.

A port, not a redesign. 23 playbooks, 55 skills, 24 principles, 7 subagent seats,
and bare `/how` `/bug-fix` routes, all from Lauren Tan's
[pstack](https://github.com/cursor/plugins/tree/main/pstack) 0.15.25, adapted to
pi's tool and model surface.

### Install

```bash
pi install git:github.com/NaoYUN77/pometo-mode-on-pi@v0.1.0
```

Then in any project:

```bash
pi
/trust          # once per folder, covers everything below it
/routes         # what this session answers
```

Seats do not travel. A pi package carries extensions, skills, prompts, and themes;
`agents/` is not one of them. Copy them into the project that uses them:

```bash
cp -r <package>/.pi/agents your-project/.pi/agents
bash <package>/scripts/doctor.sh   # every seat's model id must resolve
```

### 项目里已经有同名扩展时

项目如果自己带了 `todo.ts` 或 `subagent/`，注册的工具名跟这个包一样。
pi 把这当加载期冲突，直接退出，stdout 一个字节都没有：

```
Error: Tool "todo" conflicts with /path/to/project/.pi/extensions/todo.ts
```

这里的每个扩展在加载时会先问一句「项目自己有没有这个工具」，有就让位。项目那份赢，
不需要任何配置。

把注册推迟到 `session_start` 看着像修好了，其实更糟：它会在会话中途重建工具表，
让所有内建工具拿不到 context，于是 `read` 和 `bash` 全部报
`Cannot read properties of undefined`。0.1.1 就是这么坏的，不能用。请用 0.1.2 或更新。

### If your project already ships these extensions

A project that vendored `todo.ts` or `subagent/` registers the same
tool names this package does. pi treats that as a load-time conflict and exits
with nothing on stdout:

```
Error: Tool "todo" conflicts with /path/to/project/.pi/extensions/todo.ts
```

Each extension here asks, at load, whether the project already owns the name, and
stands down if it does. Your copy wins. Nothing to configure.

Deferring registration to `session_start` looks like a fix and is not: it rebuilds
the tool registry mid-session and leaves every built-in tool without its context,
so `read` and `bash` fail with `Cannot read properties of undefined`. Version
0.1.1 shipped that and is not usable. Use 0.1.2 or later.

### What you get

```
.agents/skills/          924K   pstack 0.15.25, 55 skills, 2242 lines
  poteto-mode/           451K   the router: 24K SKILL.md + 144K playbooks
    playbooks/           144K   23 files, 618 lines
    references/           12K   bugbot triage
    scripts/             271K   check-plan, worktree-audit, orch, watch-pr
  why/                    81K   98 lines + evidence-category playbooks
  reflect/                32K   67 lines, three parallel reviewers
  interrogate/            32K   74 lines + rubric and reviewer prompt
  principle-*/            81K   24 rules, 434 lines total
  (24 more skills)        ~150K
.agents/harness/pi.md      8K   132 lines: Cursor to pi mapping
.agents/pstack-models.md   8K   91 lines: role to model table
docs/pi-equivalence.md     8K   34 rows: each CC mechanism, its provider here, its proof
.pi/extensions/          104K
  subagent/index.ts     1358 lines
  skill-routes.ts        340 lines
  todo.ts                301 lines
  bash-guard.ts          148 lines
  lib/                   460 lines: project-tools, truncate, line-splitter, kill, pi-child
.pi/agents/               23K   7 seat files, 16 to 28 lines each
.pi/prompts/               4K   /poteto-mode template
scripts/                 124K  doctor, check, 10 zero-token test suites, 2 test doubles
```

### Three layers

The design is three tiers, and the tier decides what a file may do.

**1. Skill — one capability.** Has frontmatter with a `description`, so the model
can match it on its own. Invoke as `/how`, `/arena`, `/why`. Does not open a todo
list.

**2. Playbook — one kind of task.** A step list with **no frontmatter**, which is
deliberate: no description means the model cannot match it by accident. Entry is
either you naming it (`/bug-fix`) or `/poteto-mode` matching it semantically. Its
steps are copied into the todo list **verbatim**, and a step you skip stays in the
list as `skip: <reason>`. Playbooks call skills; skills never call playbooks.

**3. Principle — one rule.** 24 of them, 11 to 34 lines each. `/poteto-mode` reads
them and must name in its reply which principle changed which decision.

### The 23 playbooks

Six groups. Line counts are the playbook file, not the work.

**Write code — 98 lines**

| Route | Lines | When |
|---|---|---|
| `/feature` | 21 | New or changed behaviour, built from a named data shape |
| `/refactoring` | 16 | Structure changes, behaviour does not |
| `/bug-fix` | 15 | Reproduce, root-cause, fix with runtime evidence |
| `/perf-issue` | 25 | One measured slowness, traced against a baseline |
| `/hillclimb` | 21 | Sustained improvement of one metric: hypothesis, measure, one commit per win |

`/hillclimb` and `/perf-issue` are the pair people confuse. Perf issue is a
one-off fix. Hillclimb is the loop, with a floor on attempts so a lucky early win
cannot end it.

**Investigate — 39 lines**

| Route | Lines | When |
|---|---|---|
| `/investigation` | 14 | Read-only. Delivers a cited answer, not a diff |
| `/runtime-forensics` | 11 | Diagnose a live process: leak, idle spin, glitch. Diagnosis, not fix |
| `/trace-forensics` | 14 | Diagnose a captured profile you were handed. The artifact is fixed; do not re-run it |

**Design and prototype — 180 lines**

| Route | Lines | When |
|---|---|---|
| `/prototype` | 14 | Throwaway sketch, so an experiment settles the fork instead of a question to you |
| `/visual-parity` | 11 | Pixel-exact equivalence. The baseline is the spec; image diff decides |
| `/multi-phase-plan` | 155 | Work spanning phases or stacked PRs. Writes the plan, implements nothing |

**Deliver — 69 lines**

| Route | Lines | When |
|---|---|---|
| `/opening-a-pr` | 34 | Called at the end of every other playbook |
| `/babysit` | 23 | Drive a PR or stack to merge-ready. Does not merge |
| `/shipping` | 12 | Independently verify a green stack, then land the contiguous verified run from the root. Green is not safe |

**Long runs — 162 lines**

| Route | Lines | When |
|---|---|---|
| `/autonomous-run` | 13 | One task driven to a checkable predicate. It defines done |
| `/orchestrate` | 112 | A standing program: multi-day, many stacked PRs, a fleet of subagents |
| `/autopilot-full` | 25 | A queue of independent PRs run to merged, one owner each |
| `/autopilot-stack` | 12 | Same, delivered as one linear stack the operator lands |

**State — 70 lines**

| Route | Lines | When |
|---|---|---|
| `/session-pickup` | 11 | Take over in-flight work from a transcript, URL, or branch |
| `/pause-safely` | 10 | Clean suspend: stop at a safe boundary, cancel subagents, `wip:` commit, resume note |
| `/worktree-cleanup` | 12 | Reclaim disk from merged worktrees and stale simulators |
| `/eval` | 25 | Blind-test how a skill or prompt change moves agent behaviour |
| `/authoring-a-skill` | 12 | Write or edit a SKILL.md |

A playbook that does not fit routes to `/figure-it-out`, which designs a bespoke
one. A program that outlives any single agent routes to `/orchestrate`.

### Configure models

Every role names a model in `.agents/pstack-models.md`, and each seat file carries
one `model:` id. Check an id against `pi --list-models` before writing it: a wrong
id fails the subagent process instead of silently inheriting.

```bash
pi --list-models
```

Edit the seat files, rerun `scripts/doctor.sh`.

### Verify

```bash
bash scripts/check.sh
```

Doctor, then every test that spends no tokens: the routing surface (38 checks,
covering both `/routes` output paths), the bash guard (24), the subagent's output
handling (28: the 50 KB cap never splits a character, and stdout split
mid-character still decodes whole), the seat files (39), the kill escalation
(11), the child protocol (20: a steer that arrives after the settle is reported
as not delivered), the background path end to end (31, against a fake pi), the tool-name conflict
guard (16), the equivalence table (113: every claim names a file that exists), and
the README's numbers (20).
Prints `check: green` or `check: RED`.

### Differences from pstack

Named because they change behaviour. `docs/pi-equivalence.md` carries the full
row-by-row table, including what is missing and why no workflow needs it.

- **Playbooks are bare commands.** In Cursor only `/poteto-mode` picks one. Here
  all 23 are registered, and the route injects the router alongside the steps.
- **Skills have bare routes.** pi registers skills as `/skill:<name>`; this adds
  `/how`, `/arena`, and the rest, and leaves `/skill:how` working.
- **No always-on mode block.** `/poteto-mode` is entered, not resident. An
  always-on router would tell a one-line question to match a playbook.
- **Two child modes.** A foreground call is a one-shot `pi --mode json -p` and
  waits for its report. `run_in_background: true` starts a `pi --mode rpc` child
  with its own session, so `send_message` can steer it while it runs; the prompt
  travels on stdin, not argv. A run that already settled cannot be resumed, only
  replaced.
- **Seats are per-project.** pi packages cannot ship `agents/`.
- **`/routes` instead of a marketplace.** Nothing is copied; the list is rebuilt
  from the tree on every load.

### License

MIT. The skills are pstack's, Copyright (c) 2026 Lauren Tan, MIT. See
`.agents/skills/LICENSE-pstack`. Re-vendoring steps are in `.agents/VENDORED.md`.

---

## 中文

pstack 的工作模式，跑在 [pi](https://pi.dev) 上。你说目标，它匹配 playbook、
守住纪律，你用短句掌舵。

是移植，不是重新设计。23 个 playbook、55 个 skill、24 条原则、7 个 subagent 档位，
以及直接敲的命令 `/how` `/bug-fix`，全部来自 Lauren Tan 的
[pstack](https://github.com/cursor/plugins/tree/main/pstack) 0.15.25，按 pi 的工具
和模型接口做了适配。

### 安装

```bash
pi install git:github.com/NaoYUN77/pometo-mode-on-pi@v0.1.0
```

然后在任意项目里：

```bash
pi
/trust          # 每个目录一次，向下继承
/routes         # 这个会话答应了哪些命令
```

**subagent 档位不随包走。** pi 包只能带 extensions、skills、prompts、themes，没有
`agents/`。把它拷进用它的项目：

```bash
cp -r <package>/.pi/agents your-project/.pi/agents
bash <package>/scripts/doctor.sh   # 每个档位的 model id 都必须能查到
```

### 里面有什么

```
.agents/skills/          924K   pstack 0.15.25，55 个 skill，2242 行
  poteto-mode/           451K   路由层：24K 的 SKILL.md + 144K playbooks
    playbooks/           144K   23 个文件，618 行
    references/           12K   bugbot 分诊
    scripts/             271K   check-plan、worktree-audit、orch、watch-pr
  why/                    81K   98 行 + 按证据分类的调查提示词
  reflect/                32K   67 行，三个并行审阅者
  interrogate/            32K   74 行 + 评分表和审阅者提示词
  principle-*/            81K   24 条规则，共 434 行
  （其余 24 个 skill）    ~150K
.agents/harness/pi.md      8K   132 行：Cursor 到 pi 的映射
.agents/pstack-models.md   8K   91 行：角色到模型表
docs/pi-equivalence.md     8K   34 行：每条 CC 机制、它在 pi 上由谁提供、证据
.pi/extensions/          104K
  subagent/index.ts     1358 行
  skill-routes.ts        340 行
  todo.ts                301 行
  bash-guard.ts          148 行
  lib/                   460 行：project-tools、truncate、line-splitter、kill、pi-child
.pi/agents/               23K   7 个档位文件，每个 16 到 28 行
.pi/prompts/               4K   /poteto-mode 模板
scripts/                 124K  doctor、check、10 个不花钱的测试、2 个测试替身
```

### 三层结构

整个设计是三层，层级决定一个文件能做什么。

**1. Skill —— 一个能力。** 有 frontmatter 和 `description`，所以模型能自己匹配。
用 `/how`、`/arena`、`/why` 调用。不开 todolist。

**2. Playbook —— 一类任务。** 一个步骤清单，**没有 frontmatter**，这是故意的：
没有 description，模型就不可能误触发。入口只有两个——你直接点名（`/bug-fix`），
或者 `/poteto-mode` 语义匹配。它的步骤会被**逐字**抄进 todolist，跳过的步骤留在
清单里写 `skip: <理由>`。playbook 调用 skill，skill 从不调用 playbook。

**3. Principle —— 一条规则。** 24 条，每条 11 到 34 行。`/poteto-mode` 会读它们，
并且必须在回复里点名「哪条原则改了哪个决定」。

### 23 个 playbook

六类。行数是 playbook 文件本身，不是工作量。

**写代码 —— 98 行**

| 命令 | 行数 | 什么时候用 |
|---|---|---|
| `/feature` | 21 | 新行为或改变的行为，从命名过的数据形状建 |
| `/refactoring` | 16 | 结构变，行为不变 |
| `/bug-fix` | 15 | 复现 → 根因 → 拿运行时证据修 |
| `/perf-issue` | 25 | 一个有测量的慢，对着基线追，一次性 |
| `/hillclimb` | 21 | 对一个指标持续爬坡：假设 → 测量 → 每个小胜一个 commit |

`/hillclimb` 和 `/perf-issue` 是最容易混的一对。Perf issue 是一次性修复；
Hillclimb 是那个循环，并且对尝试次数设了下限，免得一次早来的好运就结束了整轮。

**查问题 —— 39 行**

| 命令 | 行数 | 什么时候用 |
|---|---|---|
| `/investigation` | 14 | 只读。交一个有出处的答案，不是 diff |
| `/runtime-forensics` | 11 | 诊断跑着的进程：泄漏、空转、卡顿。交诊断，不修 |
| `/trace-forensics` | 14 | 诊断别人给你的 profile 文件。文件是死的，不要重跑 |

**设计与原型 —— 180 行**

| 命令 | 行数 | 什么时候用 |
|---|---|---|
| `/prototype` | 14 | 扔掉也不可惜的草图，让实验来定岔路口，而不是问你 |
| `/visual-parity` | 11 | 像素级一致。基线就是规格，image diff 说了算 |
| `/multi-phase-plan` | 155 | 跨阶段或跨 stack PR 的活。只写计划，不实现 |

**交付 —— 69 行**

| 命令 | 行数 | 什么时候用 |
|---|---|---|
| `/opening-a-pr` | 34 | 每个别的 playbook 结尾都会调它 |
| `/babysit` | 23 | 把 PR 或 stack 弄到可以合。不合并 |
| `/shipping` | 12 | 独立验一遍绿栈，然后从根开始合连着的那一段。**绿 ≠ 安全** |

**长时间跑 —— 162 行**

| 命令 | 行数 | 什么时候用 |
|---|---|---|
| `/autonomous-run` | 13 | 一个任务一直跑到你定的那条标准成立。标准得能验真假，比如「测试全绿」「复现脚本不再失败」 |
| `/orchestrate` | 112 | 长期项目：多天、多 stack PR、一队子代理 |
| `/autopilot-full` | 25 | 一串独立 PR 一路跑到 merged，每个 PR 一个负责人 |
| `/autopilot-stack` | 12 | 同上，但交付成一条线性栈，由人来合 |

**维护自己的状态 —— 70 行**

| 命令 | 行数 | 什么时候用 |
|---|---|---|
| `/session-pickup` | 11 | 接手别人（或昨天的自己）没做完的活 |
| `/pause-safely` | 10 | 干净停下：在安全边界停、取消子代理、`wip:` 提交、写一份接着干的说明 |
| `/worktree-cleanup` | 12 | 腾磁盘：清掉已合的 worktree、过期模拟器 |
| `/eval` | 25 | 在不知情的前提下测一个 skill 或提示词改动怎么影响 agent 行为 |
| `/authoring-a-skill` | 12 | 写或改 SKILL.md |

没有 playbook 匹配的活走 `/figure-it-out`，它当场设计一个。比任何一个 agent 活得
都长的项目走 `/orchestrate`。

### 配置模型

每个角色在 `.agents/pstack-models.md` 里指定模型，每个档位文件带一个 `model:` id。
写之前用 `pi --list-models` 核对：id 写错会让 subagent 进程直接失败，而不是悄悄用
父会话的模型。

```bash
pi --list-models
```

改完档位文件，重跑 `scripts/doctor.sh`。

### 验证

```bash
bash scripts/check.sh
```

跑 doctor，然后跑所有不花 token 的测试：命令路由（38 项，覆盖 `/routes` 的两条
输出路径）、bash 守卫（24 项）、subagent 的输出处理（28 项：50 KB 截断不切开字符，
stdout 在多字节字符中间被切开也能完整解码）、档位文件（39 项）、SIGKILL 兜底
（11 项）、子进程协议（20 项：settle 之后才到的 steer 会报「没送进去」）、后台链路端到端
（31 项，对着一个假 pi）、工具名冲突（16 项）、等价表（113 项：每条声明都得指向一个
真实存在的文件）、README 里的每个数字（20 项）。打印
`check: green` 或 `check: RED`。

### 与 pstack 的差异

列出来是因为它们改变行为。完整的逐条对照在 `docs/pi-equivalence.md`，包括缺了什么、
以及为什么没有哪条工作流需要它。

- **playbook 也能直接敲。** Cursor 上只有 `/poteto-mode` 会选一个。这里 23 个全部
  注册好了，路由会把 router 连同步骤一起注入。
- **skill 也能直接敲。** pi 把 skill 注册成 `/skill:<name>`；这里加了 `/how`、
  `/arena` 等，`/skill:how` 依然可用。
- **没有常驻的模式块。** `/poteto-mode` 是进去的，不是一直挂着的。一直挂着的路由会
  让一句单行提问也去匹配 playbook。
- **子进程有两种模式。** 前台调用是 `--mode json -p` 的一次性进程，等它交报告。
  `run_in_background: true` 起的是带独立会话的 `--mode rpc` 子进程，所以
  `send_message` 能在它跑的时候插手；提示词走 stdin，不走 argv。已经结束的 run 不能续跑，
  只能重开一个。
- **档位按项目放。** pi 包带不了 `agents/`。
- **用 `/routes` 代替插件市场。** 没有拷贝，列表每次加载从目录重建。

### 许可

MIT。skill 来自 pstack，Copyright (c) 2026 Lauren Tan，MIT。见
`.agents/skills/LICENSE-pstack`。重新 vendor 的步骤在 `.agents/VENDORED.md`。
