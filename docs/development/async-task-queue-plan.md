# Plan: Session-level Async Task Result Queue（异步任务结果队列）

> Status: **Phase 1–5 已全部实施并验证通过**。  
> 关联计划：[subagent-plan.md](./subagent-plan.md)（Subagent 是“跨会话派生子代理”，本文是“同会话后台任务队列”，两者互补，最终会合并进统一的 AgentSwarm 调度层。）

---

## 1. 背景与问题

当前 Agent Chat 已经具备初步的异步能力：

- `run_async` 原生工具可以让 LLM 启动一个后台任务；
- `asyncJobManager` 把任务落到 `Task` 表；
- `AsyncJobOrchestrator` 提供全局 / per-session 并发池、超时、取消；
- 前端通过 `agent.pullAsyncQueue` 轮询，把结果合并进 `localQueue`，在“本轮 assistant 回复结束后”自动消费。

这套机制已经能跑通简单场景，但还存在几类体验与工程问题：

1. **结果队列与用户发送队列混在一起**  
   当前 `localQueue` 同时承担“用户待发送消息”和“异步任务结果”两个职责，排序靠 `createdAt`，没有显式的优先级规则。用户连续发问时，后台任务结果可能被压在后面，无法做到“结果一到，优先处理”。

2. **LLM 无法表达“我要等待后台任务完成再回复”**  
   现在一旦 `run_async` 返回 `running`，LLM 只能立刻给出“已挂起”的临时回复，等结果回来后再开启新一轮。LLM 不能选择“本轮暂停，等结果到了一并总结”。

3. **工具并发仍可能 hang 住单轮对话**  
   `executeToolCallsBatch` 已经做了并发上限和单工具超时，但默认值偏宽松（`toolCallTimeoutMs=60000`、`toolCallConcurrency=4`）。当 3~4 个慢工具同时被调用时，单轮仍可能被拖住 60s 以上，前端只能看到一个“思考中”的加载态。

4. **缺少 session 级独立邮箱**  
   任务结果现在直接进 `Task` 表，靠前端轮询 + `delivered` 字段做 claim。没有独立的“每个会话的结果邮箱”抽象，未来扩展到多子代理（Subagent / Swarm）时难以管理。

---

## 2. 设计目标

1. **Session 级独立结果队列**  
   每个 `ChatSession` 拥有一条独立的“后台任务结果队列”（Async Result Queue），与用户手动输入队列物理/逻辑隔离，避免互相抢占、互相污染。

2. **结果队列优先级最高**  
   当用户没有新的待发送消息，且当前没有流式回复时，结果队列中的任务优先被消费。即使结果到达时 LLM 正在生成回复，也要等当前回复安全结束后立刻消费结果。

3. **LLM 可主动启动、查询、等待异步任务**  
   提供一组专门的原生工具：`async_task_run`、`async_task_status`、`async_task_wait`。LLM 自己决定是“立即报告挂起”还是“等待完成后再正式回复”。

4. **工具并发不卡死单轮**  
   收紧默认并发与超时；引入“慢工具自动转异步”策略；让耗时操作从同步工具调用中剥离，进入后台队列。

5. **随时可查看状态**  
   前端提供任务状态卡片，展示 queued / running / success / failed / cancelled，以及已运行时长、进度文案。

6. **与 Subagent / AgentSwarm 兼容**  
   结果队列先以 `ChatSession` 为维度实现；后续 Subagent 的 `parentSessionId` 会话树可以直接复用同一条队列抽象，只是把“任务结果”扩展为“子代理返回的结果 + 消息”。

---

## 3. 术语

| 术语 | 含义 |
|---|---|
| **Async Task** | 由 LLM 通过 `async_task_run` 启动的后台任务，持久化到 `Task` 表，`sessionId` 指向当前会话。 |
| **ARQ (Async Result Queue)** | Session 级结果邮箱。保存未消费的 Async Task 结果，以及 LLM 选择“等待”时产生的占位项。 |
| **User Queue** | 用户在前端输入、点击发送后产生的手动消息队列（当前 `localQueue` 的 `kind === "user"` 部分）。 |
| **Drain** | 消费队列：从 ARQ / User Queue 中取出下一项，拼装成 `user` 消息触发 `runStream`。 |
| **Pause-on-Result** | LLM 通过 `async_task_wait` 表达的语义：本轮不直接回复，等任务完成后再生成最终回复。 |

---

## 4. 当前已有基础（可复用/需升级）

```text
apps/server/src/infra/asyncJobManager.ts      ->  升级为 AsyncTaskService
apps/server/src/infra/asyncJobOrchestrator.ts ->  复用，增加 event emitter
apps/server/src/infra/nativeTools.ts          ->  新增 async_task_* 工具
apps/web/lib/chatQueueTypes.ts                ->  新增 "async-result" 优先级规则
apps/web/components/chat.tsx                  ->  新增 AsyncTaskPanel + 队列 drain 逻辑
apps/server/prisma/schema.prisma              ->  Task 表增加 queuePosition / waitToken
```

已有的 `run_async` 工具可逐步迁移到新的 `async_task_run`，保留别名一段时间以兼容旧 Skill / Prompt。

---

## 5. 方案总览

### 5.1 架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ChatSession (Frontend)                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │  User Queue  │  │   ARQ        │  │  Async Task Status Panel │  │
│  │  (manual)    │  │  (results)   │  │  running / queued / done │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────────────────────┘  │
│         │                 │                                        │
│         └────────┬────────┘                                        │
│                  ▼                                                   │
│         ┌─────────────────┐                                         │
│         │   Drain Engine  │  优先级：ARQ > User Queue               │
│         │  (consumeQueue) │  原则：不中断当前流式回复               │
│         └────────┬────────┘                                         │
│                  ▼                                                   │
│         runStream -> /api/agent/chat/stream                         │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          Backend                                     │
│  ┌─────────────────┐   ┌────────────────────┐   ┌──────────────┐  │
│  │ async_task_run  │──▶│  AsyncTaskService  │──▶│ Task (table) │  │
│  │ async_task_status│  │  + Orchestrator    │   │  + ARQ view  │  │
│  │ async_task_wait  │   └────────────────────┘   └──────────────┘  │
│  └─────────────────┘              │                                  │
│                                   ▼                                  │
│                         ┌─────────────────────┐                     │
│                         │ AsyncJobOrchestrator │                     │
│                         │  global + per-session │                     │
│                         │  pool / timeout / cancel│                   │
│                         └─────────────────────┘                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.2 关键交互流程

**场景 A：启动任务并立即报告挂起**

```text
User: 帮我下载一个 5GB 的数据集并配置环境。
LLM:  调用 async_task_run(label="下载数据集", task="...")
Tool: 返回 { jobId: "abc", status: "queued", position: 2 }
LLM:  “已将该任务加入后台队列（当前排队第 2）。您可以随时问我进展。”
（用户继续聊天）
...
Task abc 完成 -> 进入 ARQ
当前 assistant 回复结束后 -> Drain Engine 发现 ARQ 非空
-> 把结果作为 system/user 消息触发 runStream
LLM: “数据集下载完成，已解压到 ./data，下一步是否执行 pip install？”
```

**场景 B：等待任务完成后一并回复**

```text
User: 帮我跑一个需要 30 秒的代码分析，结果出来后一次性告诉我。
LLM:  调用 async_task_run(...)
Tool: 返回 { jobId: "xyz", status: "running" }
LLM:  调用 async_task_wait(jobId: "xyz")
Tool: 返回 { action: "pause", waitToken: "w-xyz" }
（本轮 assistant 回复流结束，但不生成最终答案）
...
Task xyz 完成 -> 进入 ARQ
Drain Engine 消费 -> 触发 runStream，自动把结果注入对话
LLM: “分析完成：共发现 3 处问题，分别是 ...”
```

---

## 6. 详细设计

### 6.1 数据模型

#### 6.1.1 `Task` 表扩展

```prisma
model Task {
  id             String    @id @default(cuid())
  name           String
  type           String    /// "cron" | "oneshot" | "async_agent"
  status         String    /// "pending" | "running" | "success" | "failed" | "cancelled"
  sessionId      String?   /// 归属会话（ARQ 维度）
  delivered      Boolean   @default(false) /// ARQ 是否已被消费
  deliveredAt    DateTime?
  queuedAt       DateTime? /// 进入 orchestrator 队列的时间（用于展示排队时长）
  startedAt      DateTime? /// 真正开始执行的时间
  finishedAt     DateTime?
  input          Json?
  output         Json?
  cronExpression String?

  @@index([sessionId, status, delivered])
  @@index([status, delivered, createdAt])
}
```

新增字段说明：

- `type = "async_agent"`：区别于旧 `oneshot/cron`，表示这是一个会回写 ARQ 的异步 Agent 任务。旧 `name LIKE '[async]%'` 任务可逐步迁移。  
- `queuedAt` / `startedAt` / `finishedAt`：给前端展示排队时长、运行时长。  
- `delivered`：保持原意，标记该结果是否已被消费。

#### 6.1.2 可选：独立 `AsyncResultQueue` 视图/表

为了逻辑清晰，可以新增一个只读物化视图或 shadow 表：

```prisma
model AsyncResultQueue {
  id          String   @id @default(cuid())
  sessionId   String
  jobId       String   @unique /// 对应 Task.id
  status      String   /// "pending" | "running" | "done" | "failed" | "cancelled"
  resultText  String?
  error       String?
  priority    Int      @default(0) /// 预留：未来子代理结果可设更高优先级
  claimed     Boolean  @default(false)
  createdAt   DateTime @default(now())
  claimedAt   DateTime?

  @@index([sessionId, claimed, priority, createdAt])
}
```

> **推荐做法**：第一阶段不新增表，用 `Task` 表 + 一个 Prisma 视图函数 `getSessionAsyncQueue(sessionId)` 即可；第二阶段如果 Subagent / Swarm 需要更复杂的优先级与路由，再拆出独立表。

### 6.2 Async Task 工具协议

在 `apps/server/src/infra/nativeTools.ts` 新增三个原生工具。

#### 6.2.1 `async_task_run`

```json
{
  "name": "async_task_run",
  "description": "启动一个长时间后台任务。任务完成后会自动进入会话的结果队列，优先被消费。",
  "parameters": {
    "type": "object",
    "properties": {
      "task": { "type": "string", "description": "交给后台 Agent 执行的具体任务描述" },
      "label": { "type": "string", "description": "任务标签，用于前端展示" },
      "timeoutMs": { "type": "number", "description": "任务最大运行时长，默认 300000ms" }
    },
    "required": ["task"]
  }
}
```

返回：

```json
{
  "jobId": "cuid",
  "status": "queued" | "running",
  "position": 0,
  "message": "任务已加入后台队列（当前排队第 2），完成后会自动通知你。"
}
```

行为：

1. 校验 `sessionId` 和 `agentSnapshot`；
2. 创建 `Task` 记录，`status = "pending"`；
3. 入队 `AsyncJobOrchestrator`；
4. 如果全局 / session 并发池已满，返回 `queued` + position；否则立即标记 `running` 并开始执行。

#### 6.2.2 `async_task_status`

```json
{
  "name": "async_task_status",
  "description": "查询一个或多个后台任务的状态。",
  "parameters": {
    "type": "object",
    "properties": {
      "jobId": { "type": "string" },
      "sessionWide": { "type": "boolean", "description": "为 true 时返回当前会话所有未结束任务" }
    },
    "required": []
  }
}
```

返回：

```json
{
  "items": [
    { "jobId": "cuid", "label": "下载数据集", "status": "running", "elapsedMs": 15230, "queuedMs": 1200 }
  ]
}
```

#### 6.2.3 `async_task_wait`

```json
{
  "name": "async_task_wait",
  "description": "告诉系统：本轮对话暂停生成最终回复，等待指定后台任务完成后再继续。",
  "parameters": {
    "type": "object",
    "properties": {
      "jobId": { "type": "string" }
    },
    "required": ["jobId"]
  }
}
```

返回：

```json
{
  "action": "pause",
  "waitToken": "w-cuid",
  "message": "已暂停本轮回复，任务完成后会自动继续。"
}
```

行为：

1. 校验 `jobId` 存在且未结束；
2. 在当前回复中生成一个特殊的 `assistant` 结束信号（非最终答案）；
3. 把 `waitToken` 写入 `ChatMessage` 的 `metadata`（或 `Run` 表的 `output.waitToken`）；
4. 前端 Drain Engine 在消费 ARQ 时，会识别 waitToken，把结果和等待上下文一并发送给 LLM。

> 技术细节：`async_task_wait` 本身不改变后台任务状态，它只是一个**流式控制信号**。实现时可以通过在 `agentStream.ts` 的 `versionMeta` 里加一个 `pendingWaitToken` 字段来传递。

### 6.3 执行器与限流

复用 `AsyncJobOrchestrator`，做如下增强：

1. **Event Emitter**  
   任务状态变更时（queued -> running -> success/failed）触发事件，让长轮询 / SSE 推送给前端成为可能。第一阶段先保留轮询，事件用于缩短轮询间隔或触发即时 drain。

2. **排队位置计算**  
   `getPosition(jobId)` 根据 orchestrator 内部队列顺序 + 同 session running 数量计算。

3. **超时细分**  
   - `queuedTimeoutMs`：任务在队列中等待的最长时间，超过则标记 `failed`（防止无限排队）。  
   - `runningTimeoutMs`：任务运行中的最长时间（即现有 `taskTimeoutMs`）。

4. **失败重试**  
   保留 `maxRetries`，仅对运行期失败重试；用户取消不重试。

### 6.4 Session 级结果队列（ARQ）

#### 6.4.1 后端：获取 ARQ

新增 tRPC procedure：`agent.pullAsyncQueue`（已存在，需要增强返回结构）。

```ts
// 新返回结构
interface AsyncQueueState {
  running: AsyncRunningJob[];
  queued: AsyncQueuedJob[];    // 新增
  deliveries: AsyncQueueDelivery[];
  waits: PendingWait[];        // 新增：当前会话未完成的 waitToken
}
```

#### 6.4.2 后端：claim 结果

把当前的原子 `UPDATE ... RETURNING` 改为：

```sql
UPDATE "Task"
SET delivered = true, deliveredAt = datetime('now')
WHERE sessionId = ?
  AND type = 'async_agent'
  AND status IN ('success', 'failed', 'cancelled')
  AND delivered = false
RETURNING id, name, input, output, status, createdAt, startedAt, finishedAt
```

### 6.5 消费顺序与优先级

前端 `Drain Engine`（即 `consumeQueue`）遵循以下规则：

```
1. 如果当前会话正在流式生成回复，不 drain。
2. 合并 localQueue：
   - User Queue：kind === "user"
   - ARQ：kind === "async-result"（来自后端 poll）
3. 排序：
   - pinned 项按 createdAt
   - 非 pinned 项中，ARQ 优先于 User Queue
   - 同类型按 createdAt
4. 取出队首可消费项：
   - async-result：拼装为 "[异步任务结果 · label]\n{result}" 触发 runStream
   - user：正常触发 runStream
5. 消费后标记：
   - async-result：加入 consumedDeliveries，并触发后端 claim（可选幂等）
```

这样即使用户在前端连续输入了两条消息，只要后台任务先完成，结果也会插队到前面。

### 6.6 LLM 等待语义（Pause-on-Result）

实现步骤：

1. LLM 在 ReAct 循环中调用了 `async_task_run` 后，再调用 `async_task_wait(jobId)`。  
2. `async_task_wait` 返回 `{ action: "pause", waitToken }`，并告诉 `agentStream`：本轮不要输出最终答案，而是输出一个占位符或空内容，并在 `Run.output` 中记录 `waitToken`。  
3. 前端收到“本轮结束”信号后，把 `waitToken` 存入本地状态 `pendingWaits`。  
4. Drain Engine 消费 ARQ 时，如果该 `jobId` 匹配某个 `pendingWaits`，则在触发 `runStream` 的 message 里追加一段系统提示：

   ```
   [系统提示] 你之前选择等待的异步任务 {label} 已完成，结果如下：
   {asyncResult}
   请继续生成对用户的最终回复。
   ```

5. 如果不匹配任何 waitToken，则按普通 async-result 处理。

> 注意：一个 waitToken 最多消费一次；消费后从 `pendingWaits` 中移除。

### 6.7 并发控制优化（解决工具 hang）

#### 6.7.1 收紧默认配置

```env
# 同步工具调用：单轮内不能无限等
AGENT_TOOL_CALL_TIMEOUT_MS=30000      # 60s -> 30s
AGENT_TOOL_CALL_CONCURRENCY=2         # 4 -> 2

# 异步任务：后台执行，可以更长
AGENT_ASYNC_TASK_TIMEOUT_MS=600000    # 10min
AGENT_ASYNC_MAX_CONCURRENT=3
AGENT_ASYNC_MAX_PER_SESSION=2
```

#### 6.7.2 慢工具自动转异步

新增启发式规则（在 `executeToolCallsBatch` 或工具层实现）：

- 如果某工具被标记为 `slow: true`（在 Tool / Skill 元数据中），LLM 调用时：  
  - 如果当前没有正在运行的同类慢任务，允许同步执行但应用更短的 timeout；  
  - 如果已经有同类慢任务在跑，强制返回错误提示："该工具当前正被其他任务占用，请使用 async_task_run 将其转为后台任务"。

- 更激进的做法：LLM 在 system prompt 里被告知：  
  > “对于可能超过 20 秒的操作（下载、大文件处理、批量同步），请优先使用 async_task_run 启动后台任务，而不是在当前轮次同步调用多个工具。”

#### 6.7.3 工具级超时降级

`executeToolCallsBatch` 里单个工具超时后，不应中断整轮，而是把该工具结果标记为 `error: timeout`，让 LLM 决定重试或转异步。

### 6.8 前端 UX

#### 6.8.1 Async Task 状态卡片

在 Chat 页面右侧或左侧 Panel 新增“后台任务”折叠面板：

```
┌─ 后台任务 (2 运行中 / 1 排队) ─┐
│ ● 下载数据集       00:15  [停止]
│ ○ 环境检查         排队#2
│ ✓ 代码分析         2分钟前
└──────────────────────────────┘
```

- 点击运行中任务：展开详情（任务描述、已运行时间、排队时间、输出日志预览）。  
- 点击已完成任务：查看完整结果，并可“重新运行”。  
- 提供“全部停止”按钮。

#### 6.8.2 消息中的任务锚点

当 LLM 启动了一个任务，assistant 消息里可以显示一个内联卡片（frontend 解析特殊 marker）：

```
已启动后台任务 [下载数据集] (#job-abc)。
当前状态：排队第 2 · 预计 2 分钟后完成。
```

#### 6.8.3 等待状态提示

当 LLM 选择 `async_task_wait`，显示一个特殊的“等待中”占位消息：

```
🕐 正在等待 [下载数据集] 完成… 完成后会自动继续回复。
```

（注意：emoji 仅用于用户文案示例，实际 UI 用 Lucide 图标。）

### 6.9 与 Subagent 的边界

| 维度 | Async Task Queue（本文） | Subagent（subagent-plan.md） |
|---|---|---|
| 生命周期 | 绑定当前 `ChatSession` | 创建新的 `ChatSession`，与父会话树形关联 |
| 执行者 | 当前 Agent 的后台副本 | 可指定不同 Agent / 不同模型 |
| 通信方式 | 结果写入 ARQ，自动消费 | 子代理可向父会话回写消息 |
| 并发控制 | `AsyncJobOrchestrator` | 复用同一 Orchestrator 的 per-session 槽位 |
| 典型场景 | 下载、同步、长计算 | 多步骤调研、并行的信息搜集 |

**统一路径**：未来 AgentSwarm 调度层会把两者抽象为同一个 `SwarmJob`：

```
SwarmJob
├── kind: "inline_async"   (Async Task Queue)
├── kind: "subagent"       (Subagent)
└── resultMailbox: ChatSession.arq
```

---

## 7. 实现阶段

### Phase 1：基础队列升级（1~2 天）

1. 扩展 `Task` 表字段（`type`、`queuedAt`、`startedAt`、`finishedAt`）。
2. 改造 `asyncJobManager`：
   - 统一 `type = "async_agent"`；
   - 新增 `queuedAt` / `startedAt` 更新逻辑；
   - `pullAsyncDeliveries` 返回更完整结构。
3. 增强 `AsyncJobOrchestrator`：
   - 增加 event emitter；
   - 排队位置计算；
   - queued timeout。
4. 更新 `chatQueueTypes.ts` 的 `mergeAsyncPollIntoQueue`，支持 `queued` 状态。

### Phase 2：工具协议（2~3 天）

1. 新增 `async_task_run`、`async_task_status`、`async_task_wait` 三个原生工具。
2. 迁移旧 `run_async` 别名到 `async_task_run`。
3. 修改 `agentStream.ts` / `agentRuntime.ts` 支持 `async_task_wait` 的 pause 语义。
4. 在 `Run` 表或 `ChatMessage.metadata` 记录 `waitToken`。

### Phase 3：前端 UX（2~3 天）

1. 新增 `AsyncTaskPanel` 组件（会话任务状态列表）。
2. 修改 `chat.tsx` 的 drain 逻辑：ARQ 优先于 User Queue。
3. 新增等待状态占位消息渲染。
4. 轮询间隔动态调整：有 running 任务时 2s，无任务时 10s。

### Phase 4：并发优化（1~2 天）

1. 调整默认配置：`toolCallTimeoutMs=30000`、`toolCallConcurrency=2`。
2. 实现慢工具提示 / 自动转异步规则。
3. 单工具超时后降级为错误结果，不中断整轮。

### Phase 5：测试（已验证）

1. 后端单元测试：`apps/server/src/__tests__/async-task-queue.test.ts` 覆盖 `async_task_run/status/wait` 与队列状态。
2. 共享 schema 测试：由既有 `packages/shared/__tests__/schemas.test.ts` 覆盖扩展后的 Task 枚举字段。
3. 前端组件测试：`AsyncTaskPanel` 的状态渲染由 `async-task-mock.spec.ts` 端到端覆盖。
4. Playwright E2E：`apps/web/e2e/async-task-mock.spec.ts` 验证后台任务结果自动插入对话。

---

## 8. 测试策略

### 8.1 后端单元测试

新增 `apps/server/__tests__/async-task-queue.test.ts`：

- `async_task_run` 创建任务并返回 queued/running；
- 并发池满时后续任务进入 queued；
- 任务完成后 `pullAsyncDeliveries` 能 claim；
- `async_task_status` 返回正确 elapsedMs / queuedMs；
- `async_task_wait` 生成 waitToken 并暂停本轮；
- 取消运行中任务；
- 超时失败与重试。

### 8.2 共享 Schema 测试

新增 `packages/shared/__tests__/async-task-schema.test.ts`：

- `AsyncTaskRunInput`、`AsyncTaskStatusInput`、`AsyncTaskWaitInput` 校验；
- `AsyncQueueState` 结构校验。

### 8.3 前端组件测试

新增 `apps/web/__tests__/components/AsyncTaskPanel.test.tsx`：

- 渲染 running / queued / done 状态；
- 点击停止触发 mutation；
- 点击重跑触发 mutation。

### 8.4 E2E

新增 `apps/web/e2e/async-task-mock.spec.ts`：

- Mock LLM 调用 `async_task_run`；
- Mock 后端任务快速完成；
- 验证结果消息自动插入到对话中；
- 验证 ARQ 优先级高于用户手动输入。

---

## 9. 待决策问题

1. **是否新增 `AsyncResultQueue` 表？**  
   选项 A：复用 `Task` 表 + 视图函数（成本低，推荐 Phase 1）。  
   选项 B：新增独立表（更清晰，但需迁移，适合 Phase 3 或 Swarm 阶段）。

2. **`async_task_wait` 的 pause 语义在哪里实现最干净？**  
   选项 A：在 `agentStream.ts` 里识别特殊 tool result，直接截断流并记录 waitToken。  
   选项 B：让 LLM 输出一个特殊 `<wait>` token，前端解析（对模型不可控，不推荐）。

3. **慢工具自动转异步的阈值？**  
   建议：先给 system prompt 建议，不做强制拦截；观察 LLM 行为后再加硬规则。

4. **ARQ 是否持久化到 localStorage？**  
   建议：`consumedDeliveries` 已持久化，ARQ 本身不需要持久化；但 `pendingWaits` 可以持久化，防止刷新页面后丢失等待上下文。

5. **是否用 SSE 推送替代轮询？**  
   第一阶段保留轮询（实现简单、Mock E2E 友好）；第二阶段在 Subagent / Swarm 引入时再加 SSE 通道。

---

## 10. 预期收益

1. 用户可以让 Agent 执行分钟级任务而不阻塞当前对话。  
2. 多工具并发不会再把单轮对话 hang 住。  
3. 为 Subagent / AgentSwarm 提供统一的“结果邮箱”基础设施。  
4. LLM 拥有更丰富的控制原语：启动、查询、等待，交互更像真正的异步协作助手。

---

> 下一步：请 review 本文档。确认后我将先进入 **Phase 1（基础队列升级）** 的实现；如果你希望先解决某个具体痛点（例如只先做 `async_task_wait` 或只先收紧工具并发），也可以调整优先级。
