# Agent Swarm — 异步任务 / Subagent 统一设计（整合稿）

> 状态：设计草案 · 2026-07-08
> 整合文档：本稿合并 `subagent-plan.md`（Subagent 可视化会话）与本文档原版（异步任务闭环 + 并发治理），
> 给出统一的 swarm 初级路线。两份文档描述的是同一件事的两个面：
> **Subagent = 一个独立 ChatSession 在后台跑任务；异步任务 = Subagent 的结果投递回父会话的机制。**

---

## 0. 两份计划的关系（为什么合并）

| 维度 | `subagent-plan.md` | 本文原版 |
|---|---|---|
| 核心实体 | Subagent = 独立 `ChatSession(kind=subagent)` | 异步任务 = `Task(kind=async_agent)` |
| 可见性 | 用户可见（左侧卡片、可进入查看对话） | 后端不可见（只投递结果） |
| 管理 UI | SubagentPanel / SubagentCard / `/subagents` 页 | 无（仅队列） |
| 结果回流 | 未明确 | 独立 `asyncResultQueue` + 优先级 |
| 状态查询 | 卡片轮询 + stop/rerun | `task_status` 工具 |
| LLM 等待策略 | 无 | `waitForResult` / `await_async` |
| 并发治理 | 未涉及 | 工具分级 + abort 下传 + 进程隔离 |

**统一观点**：`run_async` 启动的后台任务，就是一个 `kind=subagent` 的 ChatSession 在后台执行；SubagentPanel 显示的就是这些任务的卡片；`task_status` 查的就是 subagent session 的 status；结果通过 `asyncResultQueue` 投递回父会话。`Task` 表退化为执行记录/调度载体，真正的「任务实例」是 subagent ChatSession。

这样合并后：
- Subagent 有了**结果回流闭环**（独立队列 + 优先级 + LLM 等待策略）。
- 异步任务有了**可视化管理**（卡片、stop/rerun、进入查看对话）。
- 共用一套数据模型（ChatSession 扩展）、一套并发调度（asyncJobOrchestrator）、一套状态机。

---

## 1. 背景与目标

KnowPilot 已有 `run_async` + `asyncJobManager` + `asyncJobOrchestrator` + `pullAsyncDeliveries` 基础设施，`subagent-plan.md` 已设计 Subagent 数据模型与 UI。目标：把两者拼成完整闭环，让 Agent 能像助手一样——「这个事我挂后台跑（=开一个 Subagent），跑完结果自动插进来，你随时问我进度，我先回答你别的」。

---

## 2. 用户场景（设计标尺）

> 用户让 Agent 配置环境，第一步下载大文件。

1. Agent 判断「下载大文件」是长任务 → 调用 `run_async`（= `spawn_subagent`）启动。
2. 后端创建 `ChatSession(kind=subagent, parentSessionId=当前会话, status=running/queued)`，交给 orchestrator 调度。
3. 工具立即返回 `{ subagentSessionId, status }`，**不阻塞**当前 ReAct 轮。
4. Agent 正式回复用户：「已启动后台任务，挂起执行中。有啥需要随时找我。」
5. 左侧 SubagentPanel 出现该任务卡片（状态圆点 + 标题），用户可展开查看 / 进入详情 / 停止。
6. 用户继续和 Agent 聊别的。期间 Agent 可调 `task_status({ jobId })` 告诉用户「还在跑，已 3 分钟」。
7. 后端并发很多时，任务在 orchestrator 队列等槽位（卡片状态 `queued`）。
8. Subagent 执行完成 → 结果写入 subagent session 的最后一条 assistant 消息 + 投递到**父会话的 `asyncResultQueue`**。
9. 若父会话 Agent 正在回复用户（流式中），结果队列**不立即消费**，等当前回复结束。
10. 消费时 **`asyncResultQueue` 优先于 `userQueue`**：用户最后一个问题回答完毕后，异步结果自动作为一条消息发给父会话 LLM。
11. LLM 拿到结果继续聊（「下载完成了，继续配置第二步吧」）。
12. LLM 也可选 `run_async({ waitForResult: true })` **不正式回复**，等结果回来再回（见 §5.4）。

---

## 3. 现状盘点

| 能力 | 现状 | 来源 |
|---|---|---|
| 启动异步任务 | `run_async` 工具，返回 `{ jobId, status, message }` | `nativeTools.ts:1170` |
| 持久化 | Task 表 `kind=async_agent` | `asyncJobManager.ts` |
| 并发调度 | 全局 `maxConcurrent` + per-session `maxPerSession` + 超时 + 取消 | `asyncJobOrchestrator.ts` |
| 结果投递 | `pullAsyncDeliveries` 轮询，`AsyncQueueDelivery` | `asyncJobManager.ts` |
| 前端合并 | `mergeAsyncPollIntoQueue` 把投递合进 `queue` | `chatQueueTypes.ts` |
| Subagent 数据模型 | **未落地**（plan 已设计 ChatSession 扩展） | `subagent-plan.md` §1 |
| Subagent UI | **未落地**（plan 已设计 SubagentPanel/Card） | `subagent-plan.md` §4 |
| 状态查询 | 仅全局 `getStats()`，**无 per-job 工具** | `asyncJobOrchestrator.ts` |
| 结果队列隔离 | ❌ 与用户 queue 混在一起 | `chat.tsx` |
| 优先级 | ⚠️ `sortQueueItems` 隐式，未明确「结果 > 用户」 | `chatQueueTypes.ts` |
| LLM 等待策略 | ❌ 无 | — |
| 并行工具 hang | ⚠️ 仅靠 `toolCallTimeoutMs` 兜底 | `agentTools.ts` |

---

## 4. 统一数据模型（沿用 subagent-plan §1）

`ChatSession` 扩展：

```prisma
model ChatSession {
  // ... 现有字段
  parentSessionId String?       // 新增：父会话 id
  kind            String  @default("chat")   // "chat" | "subagent"
  status          String  @default("active") // "active"|"queued"|"running"|"paused"|"completed"|"failed"
  taskDescription String?       // 新增：任务描述
  parent          ChatSession?  @relation("SessionChildren", fields: [parentSessionId], references: [id], onDelete: SetNull)
  children        ChatSession[] @relation("SessionChildren")
  @@index([parentSessionId, status, updatedAt])
  @@index([kind, status])
}
```

- `run_async` 启动时：创建 `ChatSession(kind=subagent, parentSessionId, status=queued|running, taskDescription=task)`。
- orchestrator 调度执行：`status` 流转 `queued → running → completed/failed`。
- `Task` 表保留为调度/执行记录载体（`asyncJobManager` 仍用），subagent ChatSession 是用户可见的任务实例。
- 兼容性：`kind` 默认 `chat`，不影响现有会话；`parentSessionId` 为空即普通会话。

迁移：`pnpm db:push` + `pnpm db:generate`（FTS 表需手动 drop 再 push，参见历史经验）。

---

## 5. 核心设计

### 5.1 两个独立队列（session 级，复用多 session 隔离）

当前 `chat.tsx` 的 `localQueue` 把「用户手动消息」和「异步任务结果」混在一起。拆成两条，都存 `SessionStreamState`（已随多 session 重构落地，只需新增字段）：

```ts
SessionStreamState {
  userQueue: ChatQueueItem[]              // 用户手动输入
  asyncResultQueue: AsyncQueueDelivery[]  // Subagent 结果投递（独立、优先级最高）
  // ...其余字段
}
```

- `userQueue`：输入框发送的消息，按发送顺序排队。
- `asyncResultQueue`：`pullAsyncDeliveries` 拉到的该父会话的 subagent 结果，独立存放。
- `MessageQueue` 面板分组展示（「后台任务结果」与「待发送消息」分开）。

### 5.2 优先级消费规则

`consumeQueue` 改两阶段：

1. **先扫 `asyncResultQueue`**：有 ready 项立即消费，作为一条 user 角色消息发给 LLM（附带 `asyncResult` 标记）。
2. **再扫 `userQueue`**：无 async 结果时才消费用户队列。

约束：
- 当前 Agent 流式未结束 → 两个队列都不消费（等 `isStreaming=false`）。
- 消费后标记 `consumedDeliveries`（已有），避免重复投递。
- 这就是「用户最后一个问题回答完毕 → 异步结果自动作为消息发送」的体验。

### 5.3 状态查询工具（新增）

新增 native 工具 `task_status`（= 查 subagent session）：

```
name: task_status
parameters: { subagentSessionId?: string, sessionId?: string }
返回:
  单个: { id, status, elapsedMs, label, error?, lastMessage? }
  列表: [{ ... }]  // 当前父会话下所有 subagent
```

来源：`asyncJobOrchestrator.getJobStatus(jobId)`（新增）+ ChatSession `status`/`taskDescription` + 末条消息。Agent 可在回复中调用它告诉用户进度。

### 5.4 LLM 等待策略（新增）

`run_async`（= `spawn_subagent`）增加 `waitForResult` 参数：

- `run_async({ task, waitForResult: true })`：启动后**阻塞当前 ReAct 轮**直到 subagent 结束（受 `toolCallTimeoutMs` 约束），结果直接进本轮 tool result，**不进结果队列**。适合「我就要这个结果，别先回复」。
- `run_async({ task })`（默认）：启动后立即返回 `running`，结果进 `asyncResultQueue`，Agent 正式回复用户。适合「挂后台，先聊别的」。
- 新增 `await_async({ subagentSessionId })`：显式等待一个已启动的 subagent 结束（「我先把别的事做完，现在等它」）。

LLM 自主决定模式。

### 5.5 任务状态机

```
queued ─槽位可用─► running ─┬成功─► completed → 投递 asyncResultQueue
                            ├失败/超时─► failed    → 投递 asyncResultQueue(带 error)
                            └取消─► canceled       → 不投递
```

- `queued`：orchestrator 队列等并发槽。
- `running`：执行中，记录 `startedAt` 供 `elapsedMs`。
- `completed/failed`：写 ChatSession `status` + 末条消息，`pullAsyncDeliveries` 投递。
- `canceled`：用户/Agent 主动取消（`cancel_async` 工具，复用 `abortSubagent`）。

### 5.6 Subagent UI（沿用 subagent-plan §4）

- `SubagentPanel`（左侧）：查 `session.listChildren({ parentSessionId })`，3s 轮询当有 running。
- `SubagentCard`（Kimi Code 风格）：状态圆点 + 标题 + 展开操作（查看详情/停止/重跑/删除）。
- 创建弹窗：Agent 选择 + 任务描述 + 模型 → 调 `run_async`/`spawn_subagent`。
- `/subagents` 后台管理页：表格 + 状态过滤。
- 进入 subagent 会话（`/chat?sessionId=subagentId`）查看完整对话过程。

---

## 6. 并发治理：让三四个工具不再 hang（根本治理）

> 当前 `toolCallTimeoutMs` 是权宜——超时只是让 hang 显式失败，没解决「为什么并发就 hang」。
> 根因：工具共享同一 Node 事件循环 + 部分工具无超时/无 abort，一个慢工具阻塞循环或占满资源。

### 6.1 工具分级并发

`ToolRegistryEntry` 加 `concurrencyClass: "A"|"B"|"C"|"D"`，`executeToolCallsBatch` 按类分桶，每桶独立上限：

| 级别 | 类型 | 并发 |
|---|---|---|
| A | 纯 CPU/内存（read_article、search.global） | 高（8+） |
| B | 网络只读（web_search、fetch） | 中（4），带 `AbortSignal`+超时 |
| C | 本地进程（run_shell、OCR） | 低（2），子进程超时强杀 |
| D | 写入/副作用（git.commit、post.create） | 串行（已有 unsafe 路径） |

### 6.2 真正的 abort 下传

当前 `withToolTimeout` 只 race timer，**底层 Promise 仍跑**（资源泄漏）。根治：

- `executeAgentTool` 接 `AbortSignal`，下传到：
  - `web_search`/`fetch`：`fetch(url, { signal })`（已部分，需全量补）。
  - `run_shell`：子进程 `kill` on abort（已有 `timeoutMs`，需接 abort）。
  - MCP `callTool`：MCP 协议 `client.cancel`，下传 signal。
- 超时/abort 时真正取消底层，而非仅 race 拒绝。

### 6.3 网络工具显式超时

`web_search` 的 `fetch`、`parsePlatformUrl` 的 Jina/fetch、OCR 下载，全部 `fetch(url, { signal: AbortSignal.timeout(ms) })`，不再依赖外层 race。

### 6.4 进程级隔离（远期）

`run_shell`/OCR 迁 worker thread / 子进程，主事件循环永不被阻塞。P2。

---

## 7. 工具清单

| 工具 | 状态 | 说明 |
|---|---|---|
| `run_async` / `spawn_subagent` | 已有 run_async，需统一为 subagent session + 加 `waitForResult` | 两者合并为同一工具 |
| `task_status` | **新增** | 查 subagent 状态 |
| `await_async` | **新增** | 显式等待 subagent 结束 |
| `cancel_async` | 已有 `abortSubagent`，需暴露为工具 | Agent 可取消 |

---

## 8. 前后端交互流程

### 8.1 启动 Subagent

```
User → Agent(流式)
Agent probe → tool_calls:[run_async({task:"下载大文件", label:"下载 SDK"})]
后端 runAsyncTool:
  → 创建 ChatSession(kind=subagent, parentSessionId, status=queued|running)
  → orchestrator.enqueue(spec)
  → 返回 { subagentSessionId, status, message }
Agent onToolEnd → 正式回复「已挂后台」
SSE done → 左侧 SubagentPanel 出现卡片
```

### 8.2 查询状态

```
User:「下载到哪了?」
Agent → task_status({ subagentSessionId })
返回 { status:"running", elapsedMs:180000 }
Agent:「还在跑,已 3 分钟」
```

### 8.3 结果投递与优先消费

```
Subagent done → ChatSession.status=completed + 末条 assistant 消息
前端 pullAsyncDeliveries → AsyncQueueDelivery(sessionId=父会话)
  → 写入父会话 SessionStreamState.asyncResultQueue
父会话 Agent 流式中 → 不消费
流式结束 → consumeQueue:
  → asyncResultQueue 非空 → 消费,作为 user 消息发给 LLM
  → LLM 收「[后台任务完成] 下载 SDK 成功,路径 ...」→ 继续聊
```

---

## 9. 分阶段实施（合并两计划步骤）

### Phase 0 — 多 session 并发流式（已落地 ✅）
- `SessionStreamState` Map + 独立 AbortController + 切换不 abort + queue 按 session 隔离。
- **这是 swarm 的地基**：每个 session 独立流式，互不干扰。

### Phase 1 — 数据模型与队列分离（后端 schema + 前端队列）
- ChatSession 扩展 `parentSessionId/kind/status/taskDescription` + `pnpm db:push`。
- `SessionStreamState` 拆 `userQueue` + `asyncResultQueue`。
- `consumeQueue` 两阶段优先消费。
- `MessageQueue` 面板分组。
- **收益**：异步结果不再混用户消息，优先级明确。

### Phase 2 — Subagent 启动与状态查询（后端工具）
- `run_async` 改为创建 `kind=subagent` 的 ChatSession（统一）。
- 新增 `task_status` 工具 + `asyncJobOrchestrator.getJobStatus`。
- `run_async` 加 `waitForResult`；新增 `await_async`。
- **收益**：Agent 能启动可视化子任务 + 随时汇报进度 + 自主决定等待策略。

### Phase 3 — Subagent UI（前端，沿用 subagent-plan §4）
- `SubagentPanel` / `SubagentCard` / 创建弹窗 / `/subagents` 页。
- `session.listChildren` / `stop` / `rerun` router（subagent-plan §3.2）。
- **收益**：用户可视化管理后台任务。

### Phase 4 — 并发治理（后端）
- 工具分级并发（A/B/C/D 桶）。
- abort signal 真正下传到 fetch/shell/MCP。
- 网络工具显式 `AbortSignal.timeout`。
- **收益**：三四个工具并发不再 hang，超时成为真正取消。

### Phase 5 — 进程级隔离（远期）
- `run_shell`/OCR 迁 worker thread / 子进程。
- **收益**：子进程卡死不影响主循环。

---

## 10. 与多 session 流式隔离的关系

本设计与已落地的多 session 并发流式正交且复用：
- `asyncResultQueue` / `userQueue` 都存 `SessionStreamState`，天然 session 级隔离。
- 切换父会话不影响后台 subagent（后端跑，与视图无关）。
- 切回原父会话能看到该会话的结果队列与 subagent 卡片。
- 多个父会话各自启动各自 subagent，orchestrator 全局限流协调——**这就是初级 swarm**：多个 Agent 实例（每父会话一个）各自带各自的后台子任务池。

---

## 11. 测试计划（合并 subagent-plan §7）

### 11.1 后端
- `session-subagent.test.ts`：ChatSession kind/parent/status CRUD、listChildren、stop、rerun。
- `run_async` 改造后：创建 kind=subagent session、waitForResult 阻塞、结果投递到父会话。
- `task_status` / `await_async` 工具 smoke。

### 11.2 前端 E2E（mock 模式）
- 创建 subagent → 左侧出现卡片。
- 卡片展开 → 查看详情跳转。
- 结果完成 → 父会话队列优先消费（mock 一个快速完成的 subagent 验证）。

### 11.3 并发治理
- 并发 4 个网络工具不 hang（mock 慢响应）。
- abort 真正取消底层 fetch（mock 验证 fetch 被 abort）。

---

## 12. 待优化项

- 任务 `progress` 周期上报（长任务写进度）。
- 结果投递的「打断」语义：用户正在打字时结果到了该不该立刻插队？（当前等流式结束，用户未发送时不阻塞）。
- orchestrator 重启后 `queued` 任务恢复（`recoverStaleAsyncJobs` 已有，需覆盖 `queued`）。
- swarm 协作：多个父会话的 Agent 之间共享 subagent 结果 / 互相调用（远期，可能需要新 `Swarm`/`SwarmMember` 实体，`ChatSession.kind` 扩展为 `"swarm"`）。
- 成本控制：subagent 也消耗 LLM 预算，需纳入 `assertLlmBudget`。
- Subagent 数量上限 per 父会话 / 全局，防止失控。

---

> 本文档整合 `subagent-plan.md` 与异步任务闭环设计，按 Phase 0–5 逐步落地，每 Phase 独立可验证。
> `subagent-plan.md` 的 UI/UX 细节（§10）与组件设计（§4）仍为 Phase 3 的实施依据，不在此重复。
