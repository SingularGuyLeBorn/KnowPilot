# Chat 典型场景：逐步状态机说明

> 本文档按「用户动作 → 系统一步步做什么 → 各层状态如何变」描述 Chat 运行时。  
> 状态分四层（与 `chat-state-architecture.md` 一致）：  
>
> | 层 | 存放 | 关键字段 |
> |---|---|---|
> | **MessageStore** | `useSessionMessages` | `messages[]`（DB 真相源，SSE `message_upserted` 直接 patch） |
> | **StreamLifecycle** | `useStreamLifecycle` | `phase`：`idle → streaming → done \| error`；`streamingContent`；`liveTimeline` |
> | **Compose** | `useSessionComposeState` | `userQueue`；`asyncOverlays`；`optimistic`；`queueDraining`；`consumedDeliveries` |
> | **服务端** | Prisma + `SessionStreamHub` + `AsyncJobOrchestrator` | `ChatMessage`；`SessionQueueItem`；`Task`（池调度 + 可选异步投递）；`AgentMessage`（非 autoRun 收件箱） |
>
> 队列消费规则（前端 `drainAllPendingQueues`）：  
> 1. **优先级**：未 pinned 的 `async-result` > `user` / `superior`  
> 2. **按 session 独立**：流结束后优先消费**刚结束流的 session**，再扫描其它有待消费项的 session  
> 3. **后台不抢视图**：消费非当前视图 session 时 `keepCurrentView=true`，不改 URL / `sessionId`  
> 4. **异步投递后台续跑**：服务端 `autoConsumeAsyncDelivery` 可在无前端时 CLAIM Task 并 `hub.start` 父会话流
>
> 最后更新：2026-07-11

---

## 0. 同步等待 vs 异步投递（命名必须分清）

两根**正交**轴，不要混叫「阻塞式异步」：

| 轴 | 含义 | 参数 / 模块 |
|---|---|---|
| **父流耦合** | **同步等待** = 父 ReAct/`streaming` 挂起直到工具返回；**异步投递** = 工具立刻返回，结果稍后进异步结果队列 | `waitForResult` |
| **任务池调度** | 耗时工作是否占全局并发槽：`queued`（等槽，≈ ready）→ `running` | `AsyncJobOrchestrator` + `config.yaml` → `asyncJobs.maxConcurrent` |

因此：

- **只有 `waitForResult=false` 才叫异步任务**：结果进「异步任务结果队列」，**等当前父流结束后**再消费。
- **`waitForResult=true` 叫同步等待的工具调用**：父会话一直转圈；结果走 **tool return**；**不进**异步结果队列；**不单独出**右侧投递气泡。
- 同步等待的工作**仍可进 Task 池**排队——那是并发控制，不是「异步语义」。

`config.yaml` 示例：

```yaml
asyncJobs:
  maxConcurrent: 2   # 全局同时 running 上限（共享池）
  maxPerSession: 2
  # …
```

环境变量 `AGENT_ASYNC_*` 可覆盖 yaml。

---

## 0.1 父子 Agent 气泡矩阵（左右 + 角标）

实现：`chat.tsx`（`isParentAgentTask` / `isAsyncResultDelivery`）+ `chatMessageBits.tsx`（`MessageSourceLabel`）。

### 父会话

| 来源 | 气泡左右 | 角标 | 如何出现 |
|---|---|---|---|
| 用户手打 | **右** | 无 | 发送 / 队列消费 → `ChatMessage(source=user)` |
| 异步结果消费（非阻塞 `spawn` 的 report_back / 非阻塞 `async_task_run`） | **右** | 青绿角标（任务标签，或「子 Agent 回报 · 名」） | 队列消费开流，`source=sub` + `toolResults.subagentResult` |
| 父 Agent 最终回复 | **左** | 无 | 正常 assistant |
| 同步等待的 `spawn` / `async_task_run` 工具过程 | **不成聊天气泡** | 仅左侧 ThinkingTimeline 工具卡片 | 结果进 LLM 后写在最终左侧 assistant 里 |

### 子会话

| 来源 | 气泡左右 | 角标 | 如何出现 |
|---|---|---|---|
| 父下发任务（`autoRun` 写库，或非 autoRun 经 superior 队列消费） | **右** | **「父 Agent」**（品牌色） | `source=super\|manager` |
| 用户在子会话手打 | **右** | 无 | `source=user`；**不自动**回传父会话 |
| 子 Agent 回复 | **左** | 无 | 正常 assistant |
| 子内同步工具（搜索等） | 不成聊天气泡 | 左侧时间线工具卡片 | 同普通 ReAct |

### 异步 vs 同步子 Agent（回报规则）

| | 同步等待 `waitForResult=true` | 异步投递 `waitForResult=false` |
|---|---|---|
| 父流 | 挂起转圈直到工具返回 | 工具立刻返回，用户可继续聊父 Agent |
| 结果怎么回父 | **系统抓取**子会话最后一条 assistant（子空闲：无流 + 无子会话内 running/queued Task）；子也可提前 `report_back` | **仅**子 Agent 自己决定调用 `agent_report_back`；系统不抓最后一条 |
| 父会话呈现 | tool return → 最终左侧 assistant；**无**右侧投递气泡 | 进异步结果队列 → 当前流结束后消费 → **右侧**投递气泡 + 角标 |

---

## 状态缩写（全文通用）

每个步骤末尾用表格标出「相对上一步」的变化；未列出的字段视为**不变**。

- `LC.phase` = StreamLifecycle.phase  
- `CQ.userQueue` = Compose.userQueue  
- `CQ.optimistic` = Compose.optimistic  
- `MS.messages` = MessageStore 该 session 的消息列表  
- `视图` = 用户当前正在看的 `effectiveSessionId`

---

## 场景 1：基础单轮对话（不带工具）

### 前置

- 打开 `/chat?sessionId=S1`，Agent = A1（manager/super 均可）  
- `LC.phase(S1)=idle`，`CQ.userQueue=[]`，`MS.messages` 已 hydrate

### 步骤

#### 1.1 用户输入「你好」并发送

| 层 | 变化 |
|---|---|
| Compose | 若当前**正在 streaming**：消息入 `userQueue`，本场景假设空闲 → 直接走消费 |
| Compose | `queueDraining=true`；从队列取出后 `optimistic` 增加 `{id: opt-*, content:"你好"}` |
| Lifecycle | `beginStream` → `phase=streaming`，`streamingContent=""`，`liveTimeline` 可出现空 thinking |
| 视图 | 右侧出现乐观 user 气泡「你好」；左侧出现 Thinking… |

实际发送路径：

1. `createUserQueueItem` → 写入 `CQ.userQueue` + DB `SessionQueueItem`  
2. `drainAllPendingQueues` / `consumeQueue(S1)` 发现空闲 → 移出队列项、标记 SessionQueueItem consumed  
3. `runStream({ message, optimisticUser, targetSessionId:S1 })`

#### 1.2 服务端写库 + 开 SSE

| 层 | 变化 |
|---|---|
| 服务端 | 创建 `ChatMessage(role=user, content="你好", source=user)` |
| MessageStore | SSE `message_upserted` → `MS.messages` 追加该 user 消息 |
| Compose | 稍后用 `clientMessageId` / 内容对齐去掉对应 `optimistic` |
| 服务端 | 组装历史 + system，调用 LLM（无 tool_calls） |

#### 1.3 LLM 流式输出 token

| 层 | 变化 |
|---|---|
| Lifecycle | 每次 `onToken` → `appendTokenDelta` → `streamingContent` 增长 |
| 视图 | 左侧流式 assistant 气泡逐字更新；`liveTimeline` 可有 thinking 步骤 |

#### 1.4 流结束

| 层 | 变化 |
|---|---|
| 服务端 | 写入 `ChatMessage(role=assistant, content=最终回复)`；agent SSE 推 `done` |
| MessageStore | `message_upserted` 追加 assistant → `tryCommitStream`（INV-1） |
| Lifecycle | `completeStream(content, {assistantMessageId})` → `phase=done` + pending；MS 对齐后 `commitStream` → `phase=idle`，清 `streamingContent`/`liveTimeline` |
| Lifecycle | `onStreamCommitted(S1)` 通知 Compose（INV-2 释放） |
| Compose | `queueDraining=false`；`abort=null` |
| Compose | `onStreamCommitted` 触发 `drainAllPendingQueues(S1)` —— 队列空，无事发生 |

> 不再由 `finally` 直接 `consume`：`done` 期间 `isRunOccupied=true`，Compose 必须等 `commitStream→idle` 才能开新流。

### 本场景结束态

- `MS`：user + assistant 各一条  
- `LC.phase=idle`，无流式 UI  
- `CQ.userQueue=[]`，`optimistic=[]`

---

## 场景 2：单轮对话（带同步工具）

以 `web_search` 为例（阻塞当前 ReAct 轮次，结果立刻回灌 LLM）。

### 步骤

#### 2.1～2.2 同场景 1（用户消息入队 → 消费 → `phase=streaming` → user 消息入 MS）

#### 2.3 LLM 决定调工具

| 层 | 变化 |
|---|---|
| SSE | `tool_start` / `tool_result`（或等价事件） |
| Lifecycle | `liveTimeline` 追加 `{type:"tool", name:"web_search", status:"running"}` → 完成后 `status:"done"` + 结果摘要 |
| 视图 | 时间线出现工具卡片；**尚无**最终 assistant 长文（或仅有中间 thinking） |
| 服务端 | 工具结果写入本轮 ReAct 消息链，**再次**调 LLM |

#### 2.4 LLM 基于工具结果生成最终回复（流式）

| 层 | 变化 |
|---|---|
| Lifecycle | `streamingContent` 增长；timeline 可再开 thinking |
| 服务端 | 最终 `ChatMessage(assistant)` 入库，可能带 `toolCalls` / timeline 元数据 |

#### 2.5 流结束

同 1.4。工具过程已固化在 assistant 消息的 timeline / 存储字段中；刷新后由 `buildTimelineFromStored` 重建，**不会**再走一遍工具。

### 与场景 1 的关键差

- 中间多轮「LLM → tool → LLM」都在**同一次** `phase=streaming` 内完成  
- 前端不把工具结果当成独立 user 气泡；工具只出现在 **ThinkingTimeline**

---

## 场景 3：多轮对话（带工具 / 不带工具）

### 3A：不带工具的多轮

| 轮次 | 用户 | 状态要点 |
|---|---|---|
| 第 1 轮 | 「你好」 | 同场景 1；结束后 `MS` 有 2 条 |
| 第 1 轮结束 | — | `LC.phase=idle`；下一轮才能再发（或边流边入队，见场景 4） |
| 第 2 轮 | 「刚才我说了什么？」 | 再次 `beginStream`；服务端把**全部历史** MS 消息编入 LLM context |
| 第 2 轮结束 | — | `MS` 再 +2；上下文变长，可能触发 auto-compact（另述） |

每一轮都是独立的 `idle → streaming → done` 生命周期；**MessageStore 只追加，不替换整页**。

### 3B：带工具的多轮

| 轮次 | 行为 | 状态要点 |
|---|---|---|
| 第 1 轮 | 问天气 → 调 `web_search` → 回复 | 同场景 2；timeline 留在该轮 assistant |
| 第 2 轮 | 「换成上海呢？」 | 新一轮 streaming；LLM 可能再次调工具；**新 timeline 挂在新 assistant 上** |
| 对比 | — | 旧轮工具卡片不会「重跑」；只是历史展示 |

### 多轮时切 session（预告）

- 切到 S2：**不 abort** S1 的流（若仍在 streaming）  
- S1 的 `LC` / `CQ` / `MS` 切片继续在后台更新  
- 回到 S1 时直接读 store，无需 `listForChat.invalidate` 整页替换

---

## 场景 4：用户连续发送多条 → 入队 → 逐一消费

这也是多轮的一种，但由**队列**驱动，而不是等用户看到回复后再点发送。

### 前置

- 用户在 S1，发送「问题 A」→ 已 `phase=streaming`

### 步骤

#### 4.1 流式进行中，用户再发「问题 B」「问题 C」

| 层 | 变化 |
|---|---|
| Compose | `userQueue` 追加 B、C（各有本地 id；并 `createSessionQueueItem` 写 DB） |
| Lifecycle | **仍** `phase=streaming`（处理 A） |
| 视图 | 右侧「发送队列」面板显示 B、C 待消费；对话区仍以 A 的流式为主 |
| 注意 | **不会**立刻为 B/C 建 optimistic（要等消费时才加） |

#### 4.2 A 的流结束（commit 驱动）

| 层 | 变化 |
|---|---|
| 服务端 | agent SSE `done`；同时 `MessageService.create(assistant)` 推 `message_upserted` |
| Lifecycle | `completeStream(content, {assistantMessageId})` → S1 `phase=done` + pending |
| MessageStore | upsert assistant → `tryCommitStream(S1)` → `commitStream` → `phase=idle` |
| Lifecycle | `onStreamCommitted(S1)` 通知 Compose |
| Compose | `queueDraining=false`；`onStreamCommitted` → `drainAllPendingQueues(S1)` |

> 旧版 `finally` 直接 `consume`：`done` 期间就开新流 → 抹掉过渡 UI → 首条闪空。
> 新版 INV-1/2：必须 `commitStream→idle` 后才 `consume`。

#### 4.3 自动消费 B

| 层 | 变化 |
|---|---|
| Compose | 取出 B；`userQueue` 剩 [C]；`queueDraining=true`；加 optimistic(B) |
| Lifecycle | `beginStream` → `phase=streaming` |
| MessageStore | 随后 upsert user(B)、assistant(B 的回复) |

#### 4.4 B 结束 → 自动消费 C

同 4.3，直到 `userQueue=[]`。

### 后台未查看时也会消费（本轮修复点）

| 动作 | 旧行为（bug） | 新行为 |
|---|---|---|
| S1 streaming 时入队 B、C，再切到 S2 | S1 结束后 `consumeRef()` 只看**当前视图 S2**，S1 队列卡住 | `onStreamCommitted(S1)` 触发 `drainAllPendingQueues(S1)`，后台开跑 B，**不抢** S2 视图 |
| 消费时 | `runStream` 可能 `setSessionId` 把用户拽回 S1 | `keepCurrentView=true` + 使用 S1 的 `agentId` |

状态示意：

```text
视图 = S2（用户在看）
S1: LC.phase=streaming（消费 B）, CQ.userQueue=[C]
S2: LC.phase=idle
→ B 结束 → 后台继续消费 C → 用户切回 S1 时 MS 已有完整 A/B/C 轮次
```

---

## 场景 5：多轮 + 后台任务工具（`async_task_run`，非子 Agent）

工具：`async_task_run`。  
参数关键：`waitForResult`、`mode`（`llm` | `tool`）；服务端设 `deliverToQueue = !waitForResult`。  
任务一律进 **全局任务池**（`queued` → `running`，上限见 `config.yaml` → `asyncJobs.maxConcurrent`）。

> 子 Agent 调本工具时：**只能** `mode=tool`；下文以父/管理 Agent 视角为主。

### 5A：同步等待（`waitForResult=true`）——不是「异步」

适合：父 LLM 必须拿到结果才能继续写最终回复。

| # | 动作 | 状态变化 |
|---|---|---|
| 1 | 用户发「跑一个耗时计算」 | `phase=streaming`，user 入 MS |
| 2 | LLM 调 `async_task_run(waitForResult=true, …)` | Task 入池：`queued` 或直接 `running`；**本轮工具挂起**（父流继续转圈） |
| 3 | worker 执行 | Task → success/failed；`deliverToQueue=false` |
| 4 | 工具返回值回父 ReAct | timeline 工具卡片 done；**同一** `phase=streaming` 继续 |
| 5 | 父 LLM 写最终回复 | 同 1.4；**不会**出现右侧投递气泡 / 异步结果队列项 |

要点：这是 **同步工具语义** + 池化调度；不要叫异步任务。

### 5B：异步投递（`waitForResult=false`，默认）——才叫异步

| # | 动作 | 状态变化 |
|---|---|---|
| 1 | 用户发送 → streaming | 同前 |
| 2 | LLM 调 `async_task_run(waitForResult=false)` | 立刻返回 `{jobId}`；Task 入池；`deliverToQueue=true` |
| 3 | 父 LLM 可说「已启动」并结束本轮 | `phase→idle`；Runtime 显示 `async-running` |
| 4 | Task 完成 | `notifyAndAutoConsumeAsyncDelivery`（可无人看）→ 父会话新流 |
| 5 | 消费呈现 | **右侧**气泡 + 青绿角标；`source=sub` + `subagentResult` |
| 6 | 父 LLM 再回复 | 又一轮 `streaming→done`（在**当前流结束后**才消费，若父仍在流则先排队） |

### 5C：异步任务结果队列（仅异步投递路径）

| 队列段 | 行为 |
|---|---|
| `async-running` | 展示进行中；不当作用户消息消费 |
| `async-result`（未 pinned） | **优先于** `userQueue` 消费 → 开新流 |
| `async-result`（pinned） | 不自动消费 |
| `userQueue` | 无待消费 async-result 时才消费 |

### 子 Agent 调用 `async_task_run`

- 必须 `mode=tool`；同步/异步语义同上  
- 异步完成投递到**该子会话**；若要回父 → 再 `agent_report_back`（场景 6）

---

## 场景 6：多轮 + 子 Agent（`spawn_subagent`）

底层 ≈ `agent_create_sub` + `agent_send_message({ autoRun: true })`。  
**子 Agent（tier=sub）不能再 `spawn_subagent`**。

### 6A：同步等待 `waitForResult=true`

| # | 动作 | 父会话 | 子会话 |
|---|---|---|---|
| 1 | 用户提问 | `phase=streaming` | — |
| 2 | `spawn_subagent(waitForResult=true)` | timeline：spawn running；跟踪 Task `deliverToQueue=false` | 创建子 Agent；`S_sub.parentSessionId=S_parent` |
| 3 | `autoRun` 派活 | **挂起转圈** | 写右侧「父 Agent」气泡 + 开子流（不写 pending AgentMessage） |
| 4 | 子跑工具 / 写最终答复 | 仍挂起 | 左 assistant；子内可同步工具或池化 `async_task_run(mode=tool)` |
| 5 | **完成** | 子空闲（无流 + 无子会话 running/queued Task）→ **系统抓取**最后一条 assistant 作 tool return；或子提前 `report_back`（仍不进异步队列） | — |
| 6 | 父继续生成 | spawn done → **左侧**最终 assistant；**无**右侧投递气泡 | — |

### 6B：异步投递 `waitForResult=false`（默认）

| # | 动作 | 父会话 | 子会话 |
|---|---|---|---|
| 1～2 | spawn，`deliverToQueue=true` | 工具**立刻**返回「已派生」 | autoRun 开流 |
| 3 | 父可结束本轮；用户可继续发消息给父 | `phase=idle` 或新一轮；Runtime 显示子任务 | 子继续跑 |
| 4 | 子**自己决定**是否 `agent_report_back` | 系统**不**抓最后一条 assistant | 闲聊不自动回父 |
| 5 | report_back 成功 | 进父**异步结果队列**；当前流结束后消费 → **右侧**投递气泡 + 角标 | — |
| 6 | 父 LLM 总结 | 左侧 assistant | — |

### 6C：子界面如何接收父消息

**路径 A `autoRun=true`（spawn 默认）**：`triggerAgentRun` 写库 → SSE → 右侧「父 Agent」气泡；不经队列。

**路径 B `autoRun=false`**：`AgentMessage` → 打开子会话时镜像 `superior` 队列 → 消费后右侧「父 Agent」气泡。

气泡矩阵见上文 **§0.1**；速查表与 §0.1 一致。

### 6D：子内再调工具

| 类型 | 行为 |
|---|---|
| 普通同步工具 | 子 timeline |
| `async_task_run(waitForResult=true, mode=tool)` | 同步等待；tool return |
| `async_task_run(waitForResult=false, mode=tool)` | 异步投递到**子**会话队列；回父须再 report_back |
| `spawn_subagent` | **拒绝** |

### 6E：report_back 如何找到正确父 session

1. `ChatSession.parentSessionId`（spawn 时绑定/刷新）  
2. 跟踪 Task：`input.subagentSessionId`  
3. 跟踪 Task：`input.agentSnapshot.id`  
4. 仍找不到：只发 SwarmBus，**跳过**异步队列（防误投）

`deliverToQueue=false`（同步等待跟踪 Task）时：report_back 可提前结束父工具等待，但 **autoConsume 不投递**异步队列。

### 6F：UI 跳转

- WorkspaceTree / spawn 返回的 `subagentSessionId`  
- 子页提示：用户手打只在本会话；回父靠异步路径的 `agent_report_back`（同步路径由系统抓取）

---

## 附录 A：一次「发送」的完整状态穿越（对照实现）

```text
用户点发送
  → Compose.userQueue += item (+ SessionQueueItem DB)
  → drainAllPendingQueues(viewSid)
      → 若该 session LC.isRunOccupied (streaming|done) 或 queueDraining：仅排队
      → 否则 consumeQueue(sid):
            queueDraining=true
            移出 userQueue / ack async
            optimistic += bubble
            runStream({ targetSessionId, keepCurrentView?, agentId? })
              → LC.beginStream (phase=streaming)
              → SSE...
              → MessageStore <- message_upserted (user, assistant, ...)
              → LC.completeStream(content, {assistantMessageId}) → phase=done + pending
              → MS upsert assistant → tryCommitStream → commitStream → phase=idle
              → LC.onStreamCommitted(sid) → drainAllPendingQueues(originSid)  // 继续下一条
```

**INV-1**：done→idle 只经 commitStream（MS 已对齐 assistant）。
**INV-2**：Compose 仅 phase===idle 才 consumeQueue / beginStream。
**INV-3**：过渡 UI 在 commit 前不得被新 BEGIN_STREAM 清掉（reducer 拒绝 occupied 时 beginStream）。

## 附录 B：相关代码入口

| 主题 | 文件 |
|---|---|
| 前端队列消费 / 后台不抢视图 | `apps/web/components/chat.tsx`（`consumeQueue` / `drainAllPendingQueues` / `keepCurrentView`） |
| Compose / Lifecycle / MessageStore | `apps/web/lib/useSessionComposeState.ts` 等 |
| 气泡角标 | `apps/web/components/chatMessageBits.tsx`（`MessageSourceLabel`） |
| 队列 UI 文案 | `apps/web/components/chatQueue.tsx` |
| spawn / report_back / async_task_run | `apps/server/src/infra/nativeTools.ts` |
| 全局任务池 | `apps/server/src/infra/asyncJobOrchestrator.ts` + `config.yaml` → `asyncJobs` |
| 无人看也消费异步结果 | `apps/server/src/infra/asyncJobManager.ts`（`autoConsumeAsyncDelivery`） |
| 子 Agent 不能 spawn | `apps/server/src/infra/swarmPermissionGuard.ts`（`spawn_subagent` ∈ manager） |

## 附录 C：与旧文档关系

- 产品向短文：`docs/development/scenarios.md`  
- 架构设计：`docs/development/chat-state-architecture.md`  
- 设计决策 Q&A：`docs/development/design-decisions.md`  
- **本文**：按状态机逐步展开，供排障与教学对照实现。
