# 命令手册

按用途组织。找你的处境，敲那一行的命令。

三句话先说清：

- **小问题用技能**，比如 `/how`，不进模式、不开清单。
- **想指定打法用 playbook**，比如 `/bug-fix`，你选剧本，它守纪律。
- **想让它自己判断用 `/poteto-mode`**，它匹配剧本。

全部是直接敲的命令，选择权在你。`/routes` 按类型列出 23 个 playbook 和每个的中文说明。

---

## 一、先想清楚你要哪种

| 你现在的状况 | 敲这个 | 会不会开清单 |
| --- | --- | --- |
| 想问清楚一件事 | `/how` `/why` | 不会 |
| 写出来的字有 AI 味 | `/unslop` | 不会 |
| 不敢确定改动的影响面 | `/blast-radius` | 不会 |
| 任务没说清楚，想先磨一下 | `/sharpen` | 不会 |
| 明确是修 bug，想要失败测试 | `/tdd` | 不会 |
| 明确是修 bug，按剧本走 | `/bug-fix` | 会 |
| 明确是加功能 | `/feature` | 会 |
| 有多种合理做法，想对比 | `/arena` | 会 |
| 大活、多阶段、想它能自己跑 | `/poteto-mode` 或 `/autonomous-run` | 会 |
| 不知道用哪个 | `/poteto-help` | 不会 |

---

## 二、理解代码

| 命令 | 干什么 |
| --- | --- |
| `/how` | 这段怎么工作的。代码走查、子系统结构、分层归属 |
| `/why` | 当初为什么这么设计。理由、退步、复盘、数据驱动的决策 |
| `/teach` | 把一堆工作讲明白，让人真懂（跑 how + why 再缝起来） |
| `/bro` | 把上一段话用人话重说，不带术语 |
| `/recall` | 从聊天记录和当前状态重建上下文 |
| `/ketchup` | 你离开一段后，补上这期间改了什么 |

## 三、开始之前

| 命令 | 干什么 |
| --- | --- |
| `/sharpen` | 开工前磨清楚：专家会怎么做、你到底要什么、该多具体 |
| `/in-your-own-words` | 让它复述它理解的目标和问题。理解错在这里暴露，比写错代码便宜 |
| `/blast-radius` | 改这个会炸到哪，出 diff 之外的那一个事实 |
| `/architect` | 实现前先定类型、签名、模块结构 |
| `/figure-it-out` | 没有现成剧本时，现场设计一份可审的（大迁移、跨切面改动） |

## 四、文字

| 命令 | 干什么 |
| --- | --- |
| `/unslop` | 去掉任何文字里的 AI 腔 |
| `/no-comments` | 清掉没用的注释（派 Comment Sicko 审） |
| `/technical-writing` | 分层写作标准：Diátaxis 结构、句式、术语 |
| `/typescript-best-practices` | TS 规范，读写 `.ts` / `.tsx` 时用 |

## 五、并行与对抗

| 命令 | 干什么 | 成本 |
| --- | --- | --- |
| `/arena` | N 个候选同题竞价，选底稿，把落选者的好东西嫁接进来 | 高 |
| `/swarm` | N 个工人分片扇出，汇总一份报告 | 中高 |
| `/interrogate` | 多模型对抗审查，专治有争议的设计 | 中 |
| `/reflect` | 三个并行子代理回看当前对话，提炼教训并对接到行动 | 中 |

## 六、验证与风险

| 命令 | 干什么 |
| --- | --- |
| `/verify-poteto-pi` | 跑本仓库的 doctor 和所有 `verify.mjs`，出 green / RED |
| `/create-verification-skill` | 给项目生成一个 `verify-<app>` 技能，像用户一样驱动它 |
| `/maintain-verification-skill` | 定期校正那个技能和特性图 |
| `/benchmark-checklist` | 报任何性能数字之前的体检 |
| `/tdd` | 先写失败测试再修。只在"测试路径便宜且明确"或你明确要求时用 |
| `/show-me-your-work` | 长任务留决策轨迹（TSV：做了什么、为什么、证据、结果） |

## 七、元

| 命令 | 干什么 |
| --- | --- |
| `/poteto-help` | 不知道用哪个技能/剧本/原则，问它 |
| `/setup-pstack` | 配每个角色用哪个模型、什么推理档 |
| `/automate-me` | 把**你的工作习惯**提炼成一个 `-mode` 技能 |
| `/correct` | 找出 agent 在这仓库反复犯的错，让它们不可能再犯 |

## 八、24 条原则（可直接点名）

```
/principle-laziness-protocol          /principle-foundational-thinking
/principle-model-the-domain           /principle-boundary-discipline
/principle-type-system-discipline     /principle-make-operations-idempotent
/principle-prove-it-works             /principle-fix-root-causes
/principle-sequence-verifiable-units  /principle-test-behavior-not-implementation
/principle-guard-the-context-window   /principle-never-block-on-the-human
/principle-attack-the-premise         /principle-subtract-before-you-add
/principle-explain-the-number         /principle-encode-lessons-in-structure
…（共 24 条，`/routes` 可列全）
```

平时不用手动点。`/poteto-mode` 路由时会自己读，回复里必须点名"哪条原则改了哪个决定"。

---

## 九、23 个 playbook

你有两种用法：直接点它（下面这些），或者让 `/poteto-mode` 匹配。

### 写代码

| 命令 | 什么时候 |
| --- | --- |
| `/feature` | 新行为或改变的行为，从**命名过的数据形状**建 |
| `/refactoring` | 保持行为不变地改结构 |
| `/bug-fix` | 复现 → 根因 → 用运行时证据修 |
| `/perf-issue` | 追一个**有测量**的慢 |
| `/hillclimb` | 对一个指标持续爬坡：假设 → 前后测量 → 每个小胜一个 commit |

### 查问题

| 命令 | 什么时候 |
| --- | --- |
| `/investigation` | 只读问题，交付一个有引用的答案 |
| `/runtime-forensics` | 从活体仪表诊断（泄漏、空转、卡顿），交付诊断不是修复 |
| `/trace-forensics` | 诊断已捕获的 profile（cpuprofile / trace / heap） |

### 设计与原型

| 命令 | 什么时候 |
| --- | --- |
| `/prototype` | 丢弃式草图，用一个实验替代问人 |
| `/visual-parity` | 像素级 UI 等价 |
| `/multi-phase-plan` | 跨阶段或跨 stack PR 的活 |

### 交付

| 命令 | 什么时候 |
| --- | --- |
| `/babysit` | 把 PR 或 stack 开到 merge-ready：冲突、review 线程、CI |
| `/shipping` | 独立验证绿栈 → 从底往上合。**绿 ≠ 安全** |
| `/opening-a-pr` | 从小的有序 commit 开一个 ready PR |

### 长时间跑

| 命令 | 什么时候 |
| --- | --- |
| `/autonomous-run` | 一个任务一直跑到你定的那条标准成立。标准得能验真假，比如「测试全绿」 |
| `/orchestrate` | 长期项目：多天、多 stack PR、一队子代理 |
| `/autopilot-full` | 一串独立 PR 全自动跑到 merged |
| `/autopilot-stack` | 全自动建并验证一条线性栈，交给人合 |

### 维护自己的状态

| 命令 | 什么时候 |
| --- | --- |
| `/session-pickup` | 接手别人（或昨天的自己）没做完的活 |
| `/pause-safely` | 干净停下：安全边界停、取消子代理、`wip:` 提交、写一份接着干的说明 |
| `/worktree-cleanup` | 清掉已合或废弃的 worktree、过期模拟器 |
| `/eval` | 在不知情的前提下测一个技能/提示词改动对 agent 行为的影响 |
| `/authoring-a-skill` | 写或改 SKILL.md |

---

## 十、pi 自己的命令

| 类 | 命令 |
| --- | --- |
| 模型 | `/model` `/thinking` `/scoped-models` `/login` `/logout` `/llama` |
| 会话 | `/new` `/resume` `/name` `/session` `/tree` `/fork` `/clone` `/compact` `/import` |
| 输出 | `/copy` `/export` `/share` `/bug` |
| 系统 | `/settings` `/trust` `/reload` `/hotkeys` `/changelog` `/quit` |

还有两个本地命令：`/routes` 列路由（playbook 按类型分组、带一句话说明），`/todos` 看 `/poteto-mode` 开的那张清单。

`/reload` 在改了 `.pi/` 里的东西之后用。`/trust` 每个目录一次，向下继承。

---

## 十一、名字冲突怎么解

四层，前面的赢：

```
pi 内建          /model /session /compact /trust …      ← 不可覆盖
本项目模板        /poteto-mode                          ← 不可覆盖
技能              /how /arena /bug-fix…   54 个         ← 第三层
playbook          /bug-fix /pause-safely…  23 个        ← 第四层
```

`/skill:how` 这条老形式一直可用，和 `/how` 等价。

---

## 十一半、测这套命令本身

```bash
node scripts/test-routes.mjs   # 28 项，零模型调用，一秒出结果
bash scripts/check.sh          # doctor + 路由测试 + 所有 verify.mjs
```

`test-routes.mjs` 用 Node 24 直接 import 那个 `.ts` 扩展，喂输入、看输出。它验证的是**改写逻辑**：

- `/how x` 注入的是 how 的技能正文，且保留你的问题
- `/bug-fix x` 注入 router + bug-fix 步骤 + "already chosen" 标记
- `/poteto-mode` `/model` `/compact` `/routes` 和未知名字**不被改写**（前面的层赢）
- `/routes` 列出每一个 playbook、每一类分组、每一句说明；表和数据目录不一致就红
- 扩展自己发的消息不会被二次改写

不花钱，也不需要模型在跑。改完 `.pi/extensions/skill-routes.ts` 就跑它。

---

## 十二、三个完整例子

**查一件小事**

```
/how 这个仓库的 doctor 检查了哪几项
```

不带清单，直接答，带文件行号。

**指定打法修 bug**

```
/bug-fix 导出少最后一行，repro first，done 是 6 万行夹具全导出，show me 前后行数
```

它带模式纪律 + Bug fix 那几步，开清单，逐条走。`repro first` 和 `done means` 会变成真实条目。

**让它自己判断，同时给它闸门**

```
/poteto-mode 给 verify.mjs 加一条断言：内联 script 必须与 app.js 逐字相同。
只做这一步，改完停下等我，不要开 PR
```

后半句不是客套，是清单里的真条目。改代码的 playbook 最后一步就是开 PR，不加这句它会一路走到那。
