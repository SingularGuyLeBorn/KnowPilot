# 异步任务结果重复消费：方案调研与推荐（问题 G）

> - 状态：**已落地（变体）**（2026-07-16，v7 工单 W-0/W-A/W-E/W-F；见文末「落地状态」节）
> - 调研日期：2026-07-15（分支 `fix/p0-agent-budget-hitl`，W1–W15 已验收）
> - 证据来源：`design-decisions.md` 问题 G 及补充节、`开发心路历程.md` 2026-07-15 条、`swarm.ts` / `asyncJobManager.ts` / `session.ts` / `shell.ts` / `agentMessageLedger.ts` / `router.ts` / `useSubagentMessageMirror.ts` 源码核实
> - 本文 §1–§6 为调研与方案对比的历史记录；最终落地形态与本文推荐（方案三）的差异见文末「落地状态」

---

## 1. 问题重述

2026-07-15 实测事故：父 Agent 异步派生子 Agent 执行「sleep 10s 并汇报」，同一份结果父 Agent 对用户说了三遍。逐层拆解后（证据：父 session `cmrkvwhi` / 子 session `cmrkvws7`），与「消费状态」直接相关的根因是：

- 子 Agent 结果到达父会话有**两条互不对账的路径**：
  - **A. 轮询读取**：父 Agent 在 ReAct 循环里连调 13 次 `async_task_status`，每次都能读到 `task.output.asyncResult` **全文**——读了内容，不改任何状态，不留任何痕迹；
  - **B. 队列投递**：`report_back` 完成跟踪 Task → `notifyAndAutoConsumeAsyncDelivery` → `autoConsumeAsyncDelivery` 原子认领（`updateMany delivered=false→true`）→ 注入气泡 + drain 触发父会话新一轮。
- A 读了全文 B 不知道，B 照插气泡 → 父 Agent 把同一份报告当「新消息」又回复一遍。

问题 G 的原始提问是：`Task.delivered` 单一布尔值无法区分「**查询消费**（父 Agent 轮询读到了内容）」与「**呈现消费**（结果作为气泡出现在会话里）」，去重逻辑无从判断「这份结果父 Agent 到底见没见过」。

### 本次调研新确认的第三个撞车面（原问题未覆盖）

核实 `waitForAsyncJob`（`asyncJobManager.ts:1331`）与 `finalizeSuccess`（`asyncJobManager.ts:748`）后确认：**`async_task_wait` 与队列推送之间存在同构撞车**——

1. `async_task_wait` 轮询看到 `status=success` 即返回全文给父 Agent 本轮的 tool result，**但不认领、不改 `delivered`**；
2. 任务完成瞬间 `finalizeSuccess` 同步触发 `notifyAsyncDelivery` → `autoConsumeAsyncDelivery` 认领成功 → 气泡注入，且 `enqueueSessionAutoConsume` 等父本轮结束后**再起一轮**，把同一份全文作为 user 消息再喂一次。

即：父 Agent 调 `wait` 拿到全文并回复 → 本轮结束 → 队列 drain 又起一轮带同样全文 → 再回复一遍。**方案一落地后 LLM 的正确替代动作恰恰是从轮询改用 `wait`，若 `wait` 不参与去重，事故只是换个马甲复现。** 因此「wait × 推送撞车」必须与「poll × 推送撞车」在同一个方案里一并解决，不能分期。

---

## 2. 现状机制（W14 后的新事实）

### 2.1 通道清单（精确到代码）

| 通道 | 入口 | 能拿到全文？ | 改变状态？ | 互斥保护 |
|---|---|---|---|---|
| **A1. 状态轮询** | `async_task_status` → `getAsyncJobStatus`（`asyncJobManager.ts:1259`） | ✅ `asyncResult` 全文 + logs | ❌ 纯读，零痕迹 | 无（也不需要——它是万恶之源） |
| **A2. 阻塞等待** | `async_task_wait` → `waitForAsyncJob`（`asyncJobManager.ts:1331`） | ✅ 全文 | ❌ 不认领 | **无——与 B 撞车（§1 新确认）** |
| **B1. 服务端自动消费** | `autoConsumeAsyncDelivery`（`asyncJobManager.ts:172`） | ✅（注入气泡 + drain） | ✅ 事务内原子 claim + W14 记账 | `updateMany(delivered=false→true)` 命中 1 行才继续 |
| **B2. 前端兜底消费** | `consumeQueue` → `ackAsyncDelivery` → `markAsyncDeliveryConsumed`（`asyncJobManager.ts:506`，`router.ts:230`） | ✅（注入气泡 + drain） | ✅ 同一个原子 claim 事务 | 与 B1 同一把锁，先到者胜，落选 `claimed=false` |
| **C. 同步直返** | `async_task_run(waitForResult=true)`、`spawn_subagent(waitForResult=true)` | ✅（tool return） | 事后标 `delivered=true` | 靠 `deliverToQueue=false` 让 B1 跳过，但**非原子事后标记**（小洞，见 §2.3） |

B 通道内部（B1×B2）的互斥**已经**由 `Task.delivered` 单字段原子 claim 保证——这是现有机制里唯一经过实战检验的互斥原语，W14 的两条认领路径竞态测试（`agentMessageLedger.test.ts`「重复消费幂等拒绝」）已覆盖。

### 2.2 已排除的伪通道（防止再次画错靶子）

- **AgentMessage 旁路邮箱不是第三条投递通道**：`report_back` 经 `bus.send` 写的 AgentMessage 收件人是父 **Agent**；前端 `pullAgentMessages` 仅在 `isSubagentSession` 时启用（`chat.tsx:379`），父会话从不轮询自己的收件箱。它经 W14 `taskRef=jobId` 关联后纯作审计账本。
- **`async_task_status` 不经 tRPC 暴露**：`getAsyncJobStatus` 全仓唯一调用方是 native 工具 `taskStatusTool`（`shell.ts:74`），前端拿不到它的返回——**「status 去全文」无前端回归面**（对方案一/三的迁移成本评估是关键事实）。
- `listSessionAsyncJobs`（列表查询）本就不返回 `asyncResult`，只有单个查询泄露全文；`toolResultHint.formatAsyncJobHint` 的摘要只取 `status/elapsedMs/taskLabel`，不依赖 `asyncResult` 字段。

### 2.3 W14 改变了什么（问题 G 的边界已收窄）

W14（`agentMessageLedger.ts`）落地前，问题 G 把 AgentMessage「永远 pending」与 Task 消费状态混在一起讨论。W14 后：

1. **消息链路账已闭合**：`delivered`（Task 管道 claim 成功，同事务回写）→ `consumed`（气泡随会话历史进入 ReAct 上下文，`agentStream.ts:557` 挂点回写），全部按 `taskRef` 幂等 `updateMany`；另有存量修复脚本 `fix-agent-message-ledger.ts` 与镜像入队幂等防线（`services.ts:1586`）。
2. **两条账各记各的已实现一半**：AgentMessage 记「消息链路」，问题 G 剩余的争议**只剩 Task 侧「结果全文到达路径」**——即原推荐方案第 3 条的前半句已落地，后半句（Task 侧语义扩展）才是本调研的对象。
3. **现成资产**：原子 claim 事务（claim + 记账一体化）已被 B1/B2 两处复用，任何新方案都应直接站在它上面，而不是另造互斥机制。

### 2.4 现存的洞（按严重度排序）

1. **A1 全文泄露（事故根因）**：轮询读全文零成本零痕迹，LLM 必然滥用（07-15 实测 13 次轮询）。
2. **A2×B 撞车（本调研新确认）**：`wait` 返回全文但不认领，与队列推送双到达；方案一实施后 LLM 从 poll 转 wait，此洞即成为主犯。
3. **（小）`pullAsyncDeliveries` 不过滤 `deliverToQueue=false`**（`asyncJobManager.ts:455` SQL 只查 `delivered=0`）：同步路径（C）事后标 `delivered=true` 若失败（`catch ignore`），前端兜底轮询会把同步任务结果捡走注入气泡。概率低，但属同一族「双到达」。
4. **（小）同步路径的 `delivered=true` 是非原子事后 update**（`shell.ts:62`、`session.ts:259/299`）：与 claim 族函数不统一，语义正确但形式上是第三种标记写法。

---

## 3. 方案对比

### 方案一：通道分工（status 去全文 + wait 记账 `resultPickedBy` + 投递层跳过）

> 来源：`design-decisions.md` 问题 G 补充节，AI 推荐方案。

**不变量**：结果全文只有一个自动到达路径（气泡推送）；`wait` 显式取走后投递层见 `resultPickedBy="wait"` 标记跳过注入。

**优点**（核实后成立）：

- A1 关闭后 LLM **物理上读不到**全文，双回复在 poll 路径上机制性不可能——消除根因而非管理症状；
- 写状态只发生在 `wait` 这个显式命令点，无读路径写副作用（不蹈 `resolveAgent` 读时偷 update 的覆辙）；
- 与项目「推优先、轮询兜底」既定战略一致；
- 已核实无前端回归面（§2.2）。

**缺点与风险（独立评估，补充原文未覆盖项）**：

- **残留竞态（关键）**：`resultPickedBy` 与 `delivered` 是两个独立字段，原文未规定 `wait` 标记与 `autoConsume` claim 的原子互斥条件。若 `wait` 只查 `resultPickedAt IS NULL` 而 `autoConsume` 只查 `delivered=false`，两个 `updateMany` 针对不同列**可以同时成功** → §1 的 wait×push 撞车依旧。要堵上需双方都查双列（`delivered=false AND resultPickedAt IS NULL`）——用两个字段的价钱买了半个字段的锁，且正确性依赖每个认领方都记得写全条件，**属于编排层纪律而非机制强制**；
- 新增 2 个 schema 字段 + 投递层新检查分支；
- 工具描述必须写清「等结果用 wait / 异步就结束本轮」，否则 LLM 还会发明新怪招（07-15 教训③④⑤，此点三方案共有）。

### 方案二：全量消费状态机（`consumedAt/consumedBy` 三态 + 降级注入）

> 来源：问题 G 原始推荐方案（`poll/bubble/push` 三态，poll 读取即记账，注入时按消费状态降级）。

**不变量**：谁在何时经哪条路读过结果全程记账；注入按账降级（父已 poll 读过则只落库不触发新轮）。

**优点**：

- 能力最全：父 Agent 随时可轮询读全文，灵活性最高；
- 审计最细：每条结果的消费链路完整可查。

**缺点（核实后加重）**：

- **poll 记账 = 读路径写副作用**：`async_task_status` 每次调用都可能改库，LLM 每次查询都在改变系统状态，调试时因果链难看懂——直接违反本项目已踩过的 `resolveAgent` 教训；
- **隐藏 UX 代价（原文已指出，此处确认成立）**：父 poll 读过后气泡注入被降级 → **用户在聊天记录里看不到完整结果气泡**，只能看父 Agent 转述，转述可能失真漏细节——用正确性换了一个本可避免的双重表示；
- **竞态窗口仍在**：poll 记账与注入无 happens-before，复杂度付了、根治没买到，到头来还得补幂等；
- **架构纪律自检不合格**：按 `AGENTS.md`「删掉编排层补丁，bug 还会不会复现」标准——降级注入逻辑就是编排层补丁，删掉它双回复照常复现；它管理症状而非消除根因；
- 实现量约为方案一 2~3 倍（三通道记账点 + 降级注入 + 存量迁移），且与「推优先」战略部分背离（轮询仍是一等公民）。

### 方案三（本调研提出）：单一认领点——「领取制」全文交付

**思路**：完整继承方案一的通道分工（A1 去全文），但**不新增任何消费状态字段**；把既有 `Task.delivered` 原子 claim 升格为全文交付的**唯一互斥点**，`async_task_wait` 从「旁观读者」变成「认领参与者」。

**不变量（一句话）**：

> **一个异步结果的全文只有一个领取者——谁先以 `updateMany(delivered=false→true)` 命中 1 行，谁负责把全文交给父 Agent；其余一切路径（status 查询、落选的 wait、重复投递）永远拿不到全文。**

互斥由 SQLite 单写者原子性保证，与编排时序无关——删掉任何编排层代码 bug 也不会复现，满足 `AGENTS.md` 架构纪律自检。

**机制（四处改动，无schema变更）**：

1. **关 A1**：`async_task_status` 单个查询不再返回 `asyncResult` 全文（保留 status/elapsedMs/error 摘要/logs 进度）。已核实无前端回归面（§2.2）。
2. **认领函数统一**：把 B1/B2 各写一遍的 claim 事务（`updateMany` + `markAgentMessageDeliveredByTaskRef`）抽成唯一 `claimAsyncDelivery(jobId)`；三个认领方共用：服务端 autoConsume、前端 ack、**`async_task_wait`（新）**。
3. **`wait` 改「领取」语义**：轮询看到终态 → 尝试 claim → **成功**：返回全文（hint「结果已由你领取，不会再进气泡」）；**失败**（已被气泡认领）：**不返回全文**，返回「结果已通过异步队列投递/已在会话中，请结束本轮等待推送」。落选路径拿不到全文 → 双重表示机制上不可能。
4. **投递层零改动 + 小洞顺手收口**：`autoConsume`/`pullAsyncDeliveries` 天然只见 `delivered=false`，wait 领取后自动跳过，**不需要方案一的 `resultPickedBy` 检查分支**；同时把 §2.4 小洞 3（`pullAsyncDeliveries` 补 `deliverToQueue` 过滤）与小洞 4（同步路径改走同一 claim 函数）一并收口。

**与方案一的关系**：方案三是方案一的「去字段化」修正——通道分工、wait 优先、工具描述引导全部继承；唯一差别是互斥机制复用既有 `delivered` 单字段锁，而非新增字段对再靠双列条件互咬。若未来需要审计「谁取走的」，可在 claim 事务里顺手写 `deliveredBy` **纯审计列**（不参与互斥）——本期不需要。

**优点**：

- **互斥语义最强**：单字段单锁，所有认领方（含未来的）共用一把锁，不存在「记得加第二个条件」的纪律负担；
- **零 schema 变更、零数据迁移**：`delivered/deliveredAt` 是既有字段；
- **实现面最小**：全部收在 `asyncJobManager.ts` + `shell.ts`（+ 工具描述），且与 W14 刚落地的 claim 事务天然同构；
- **已消费可追溯**：`pullConsumedAsyncDeliveries`（右侧「已消费」Tab）天然保留 wait 领取结果的全文，用户可查；
- 满足架构纪律：不变量由 DB 原子性强制（reducer 级），非编排层时序猜测。

**缺点（如实列出）**：

- wait 落选分支的体验依赖工具描述引导：LLM 收到「已投递」提示后应结束本轮，否则可能再说一句「结果已投递」——但它拿不到全文，**危害有界**（一句废话 vs 一遍完整复述）；
- wait 领取后父 run 若崩溃，全文只留在 `task.output` + 工具调用记录 + 已消费 Tab（无气泡 ChatMessage）——比气泡路径的持久化略弱，可接受；
- 「poll 也能读全文」的能力被永久移除——但那正是事故根源，**应视为特性而非损失**（同方案一的自我评价）；
- pinned 任务的 wait 需特判（claim 条件含 `pinned=false`，wait 对 pinned 任务应返回「已钉住，请在队列中手动消费」而非错误提示）——一处分支，记录在案。

### 对比总表

| 维度 | 方案一：通道分工 | 方案二：全量状态机 | 方案三：单一认领点（推荐） |
|---|---|---|---|
| 不变量 | 全文唯一自动通道 + wait 标记跳过 | 全程记账 + 按账降级 | 全文交付权 = `delivered` 原子认领权，唯一赢家 |
| 根治程度 | A1 关闭；wait×push 互斥依赖双字段咬合条件，写漏即破 | 事后记账，竞态窗口仍在 | 单字段原子锁，机制级互斥 |
| wait×push 撞车 | 需新增字段+双方都查双列才堵得住 | 记账可识别但仍靠降级补救 | 与 B1×B2 同一把锁，天然互斥 |
| schema 变更 | +2 字段 | +2 字段 + 存量迁移 | **0** |
| 读路径写副作用 | 无 | 有（poll 记账） | 无 |
| 用户可见完整结果 | 能（气泡或父回复转述） | 可能被降级吃掉 | 能（气泡或父回复；已消费 Tab 留全文） |
| 投递层改动 | 新增 `resultPickedBy` 检查分支 | 降级注入逻辑（编排层补丁） | **零改动** |
| 实现面 | status 工具 + wait 标记 + 投递层检查 + 描述 | 三通道记账 + 降级 + 迁移 | status 工具 + claim 函数抽取 + wait 接入 + 描述 |
| 架构纪律自检 | 半通过（互斥靠纪律） | 不通过（管理症状） | 通过（reducer 级强制） |
| 与「推优先」战略 | 一致 | 部分背离 | 一致 |

---

## 4. 推荐

**推荐方案三（单一认领点·领取制）**，理由四条：

1. **唯一通过架构纪律自检的方案**：不变量「全文只有一个领取者」由 SQLite 原子写强制，不靠任何编排层时序；删掉所有引导性代码，双到达也无法发生。
2. **方案一方向正确、机制选错**：通道分工（status 去全文）是对的，但它新造的 `resultPickedBy` 字段对把互斥复杂度引回了编排层——方案三继承其方向、用既有 `delivered` 锁修正其机制，是严格更优。
3. **方案二付复杂度买症状管理**：读路径写副作用 + 降级注入损害 UX + 竞态窗口仍在，三条都踩在本项目已确认的教训上。
4. **成本最低且站在 W14 资产上**：零 schema 变更、零迁移；claim 事务已在 B1/B2 实战运行并有竞态测试，方案三只是把它推广给第三个认领方。

**建议执行顺序**（拍板后另立工单，本期不动代码）：

1. `async_task_status` 去全文（关 A1，事故根因，独立可发）；
2. 抽 `claimAsyncDelivery` + `async_task_wait` 接入认领（堵 A2×B，含落选分支文案）；
3. 小洞收口：`pullAsyncDeliveries` 补 `deliverToQueue` 过滤；同步直返路径（`shell.ts` / `session.ts`）改走同一 claim 函数；
4. 工具描述与系统 prompt 引导（`async_task_status`/`wait`/`run`/`spawn_subagent` 四件 + spawn 语义「等结果用 waitForResult=true，异步就先回复用户别轮询」+ 指令原样传递——对应 07-15 教训③④⑤）。

---

## 5. 迁移影响

- **schema**：无变更（复用 `Task.delivered/deliveredAt`）；无需 `db:push`、无需迁移脚本、无存量数据处理（已 delivered 历史任务不受影响，未 delivered 的 success 任务继续走队列）。
- **breaking 面**：`async_task_status` 单个查询不再返回 `asyncResult`——已核实该函数仅经 native 工具触达（不经 tRPC router），**无前端回归**；`packages/shared/toolResultHint.formatAsyncJobHint` 不依赖该字段，无需改。受影响清单：`getAsyncJobStatus` 返回结构、`async_task_status` 工具描述、`async-task-queue.test.ts`「查询单个任务」断言（同步调整）。按 AGENTS.md「禁止向后兼容包袱」，同一改动内改完全部调用方，不留兼容分支。
- **AgentMessage / W14 账本**：零影响——wait 认领走同一 claim 事务，`delivered` 记账自动正确；`consumed` 挂点（`agentStream.ts`）不变。
- **prompt/描述面**：四个工具描述 + 系统 prompt 引导语（执行顺序第 4 步）。
- **回滚**：纯代码改动，无数据迁移，revert 即回滚。

---

## 6. 测试策略

### 单测（Vitest，`apps/server/src/__tests__/`）

1. **去全文**：`async_task_status` 单个查询断言无 `asyncResult` 字段（保留 status/elapsedMs/logs）；列表查询行为不变。
2. **wait 领取成功**：终态任务 + `delivered=false` → `async_task_wait` 返回全文，且 `Task.delivered=true`，关联 AgentMessage 记账 `delivered`（复用 W14 断言模式）。
3. **wait×push 撞车（核心回归）**：同一任务并发 `async_task_wait` + `notifyAndAutoConsumeAsyncDelivery` → 全文只出现一次：要么 wait 领取（autoConsume `skipped`），要么 autoConsume 认领（wait 返回「已投递」提示且**无全文**）；两种结局都断言 `delivered=true` 恰好一次、父会话 ChatMessage 无重复注入。
4. **三认领方全组合**：autoConsume×wait、ack×wait 新增；autoConsume×ack 已有 W14 覆盖。
5. **小洞收口**：`deliverToQueue=false` 任务不出现在 `pullAsyncDeliveries`；同步直返路径领取后 `delivered=true`。
6. **幂等**：同一 wait 重复调用，第二次返回「已领取/已投递」提示而非全文；pinned 任务 wait 返回钉住提示且不改变任何状态。

### E2E（Playwright，mock 优先）

- 扩展 `e2e/async-task-mock.spec.ts`：复刻 07-15 场景——父 spawn 异步子 Agent + 混用 wait/轮询，断言同一份结果在父会话只触发一轮回复（气泡数 / assistant 回复数断言）。
- 真实 LLM 手动验收：重跑「sleep 10s 并汇报」，确认父 Agent 只说一遍（对应 `chat-*-real.spec.ts` 族）。

---

## 7. 待拍板问题（已结案）

1. 是否接受 `async_task_status` 去全文（breaking，已核实无前端面）？——推荐：接受。**结案：已接受并落地（W-B）。**
2. wait 落选分支策略：完全不返回全文（推荐，双重表示机制上不可能）vs 返回全文 + 「已投递」hint（更宽容但有重复总结风险）？——推荐：前者。**结案：用户拍板更激进的变体——`async_task_wait` 工具整体删除，落选分支不复存在（见 §8）。**
3. 是否顺手加 `deliveredBy` 纯审计列（记录 wait/bubble/poll 谁领取）？——推荐：不加，本期无消费方，需要时再加（claim 事务内一处赋值）。**结案：不加。wait 删除后「谁领取」只剩队列气泡一条路径，审计列永久失去消费方。**

**回答**：（已结案，无需回答）

---

## 8. 落地状态（2026-07-16，v7 工单 W-0/W-A/W-E/W-F）：已落地（变体）

本文推荐的方案三（wait 变认领参与者）在拍板时被用户改为更激进的变体：**`async_task_wait` 不是改认领语义，而是整体删除**。最终落地形态：

1. **A1 撞车面消除（按本文推荐执行）**：`async_task_status` 去全文——`getAsyncJobStatus` / `listSessionAsyncJobs` 只回 status/taskLabel/elapsedMs/subagentSessionId/timeoutMs，不回 asyncResult/logs/error；轮询读全文在机制上不可能。
2. **A2 撞车面消除（变体）**：`async_task_wait` 工具删除（def/handler/注册/权限清单/UI 条目全清），「阻塞等结果」不再作为独立通道存在；同步等待语义由两个分工工具的 `waitForResult=true` 承担（`spawn_subagent` / `async_task_run`，结果走 tool return、不进队列）。`waitForAsyncJob` 函数保留，唯一调用方为 `async_task_run(waitForResult=true)`。
3. **claim 唯一锁已为现状**：全文交付唯一通道 = `Task.delivered` 原子 claim（`updateMany delivered=false→true`），认领方 = 服务端 `autoConsumeAsyncDelivery` / 前端 `ackAsyncDelivery`（B1×B2 同一把锁，W14 已有竞态测试）；同步直返路径 `deliverToQueue=false` 天然绕过队列。本文方案三的「wait 作第三认领方」与 `claimAsyncDelivery` 抽取随 wait 删除而作废。
4. **无需 `deliveredBy`**：认领方只剩队列路径，审计列无消费方；§2.4 小洞 3（`pullAsyncDeliveries` 未过滤 `deliverToQueue=false`）已在 W-A 顺手收口（两处 pull 均过滤 + 新增 `listSyncAsyncJobs` 右栏「同步任务」视图）。
5. **存量硬删**：dev.db 历史 `sourceType="async_task_llm"` Task 行一次性物理删除（W-F，执行结果 0 行命中——存量库已无此类行）。

结论：问题 G 的 A1/A2 两个「读全文不留痕」撞车面均已机制性消除，残留风险面归零；决策记录同步于 `design-decisions.md` 文末 v7 节。
