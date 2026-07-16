# KnowPilot 并发、阻塞与竞态条件防护

> 本文档说明 KnowPilot 在多 Agent、多会话、多异步任务并发时，如何避免竞态条件、阻塞和数据损坏。

---

## 1. 总体原则

1. **单用户**：系统默认只有一个用户，因此不需要多用户权限隔离。
2. **每个 Agent 一条主会话**：所有父 Agent 下发的消息都进入子 Agent 的主会话，避免同 Agent 多会话争抢。
3. **每个会话同一时间只允许一条活跃流**：避免两条流同时写入同一个 `ChatSession`。
4. **队列串行消费**：每个 session 的队列通过 `queueDraining` 标志保证同一时间只消费一条。
5. **数据库写入事务化**：关键写入（如 assistant 消息 + Run 记录）放在 Prisma `$transaction` 里。

---

## 2. Agent 运行锁

### 2.1 `agentRunLocks`

后端维护一个进程内 Map：

```ts
const agentRunLocks = new Map<string, Promise<unknown>>();
```

当某个 Agent 正在被触发运行（例如 `triggerAgentRun`）时：

1. 先检查 `agentRunLocks.get(agentId)`。
2. 如果已有运行，等待它完成再开始新的运行。
3. 新的运行结束后，从 Map 中删除。

**作用**：避免同一个 Agent 被并发触发两次运行，导致主会话历史顺序错乱。

### 2.2 限制

- `agentRunLocks` 是进程内内存，服务器重启后丢失。
- 多实例部署时需要用 Redis/BullMQ 等分布式锁（Phase 4 计划）。

---

## 3. 会话级队列串行消费

前端 `chat.tsx` 中每个 session 的 `SessionStreamState` 包含：

```ts
queueDraining: boolean;
```

`consumeQueue` 逻辑：

1. 如果当前 session 正在流式（`isSessionStreaming`）或 `queueDraining` 为 true，直接返回。
2. 找到可消费的队列项后，立即把 `queueDraining` 设为 true。
3. 调用 `runStream` 发起 SSE。
4. SSE 结束（onDone/onError/finally）时，把 `queueDraining` 设回 false，并再次触发 `consumeQueue`。

**作用**：保证同一个 session 不会同时启动两条流。

---

## 4. 流式请求的中止与隔离

### 4.1 每个 session 一个 AbortController

`SessionStreamState.abort` 保存当前 session 的 `AbortController`。

当用户在同一个 session 发起新流时：

1. 先 `getAbort(originSid)?.abort()` 中止旧流。
2. 再创建新的 `AbortController`。

**作用**：避免旧流和新流同时往同一个 session 写 token。

### 4.2 多 session 并发

不同 session 的流互相独立，由 `originSid` 区分。

用户可以同时：

- 在 session A 里发起一条流。
- 切换到 session B，再发起一条流。

两条流分别写入各自的 `ChatSession`，不会互相干扰。

---

## 5. 异步任务并发控制

### 5.1 `asyncJobManager`

后端 `asyncJobManager` 维护：

- 运行中的 job 列表。
- 排队中的 job 列表。
- 每个 session 的 delivery 记录。

并发上限由配置控制（如 `AGENT_MAX_TOOL_CALLS_PER_RUN`、异步队列容量）。

### 5.2 队列容量校验

`swarmBus.send` 在写入 `AgentMessage` 前会检查目标 Agent 的 pending 消息数：

```ts
const pendingCount = await prisma.agentMessage.count({
  where: { toAgentId, status: "pending" },
});
if (pendingCount >= MAX_QUEUE_SIZE) {
  return { success: false, error: { code: "QUEUE_FULL", ... } };
}
```

**作用**：防止某个 Agent 的收件箱被无限塞满。

---

## 6. 全局任务池（asyncJobOrchestrator）

v8 TP-1/TP-2 落地。`apps/server/src/infra/asyncJobOrchestrator.ts` 是全系统**后台任务并发容量的单一事实源**——容量/互斥不变量收在执行层，不靠各入口自觉。设计决策（Q1~Q4）见 `design-decisions.md` 文末。

### 6.1 容量与互斥不变量

| 不变量 | 配置（`config.yaml` `asyncJobs` 节） | 语义 |
| --- | --- | --- |
| 全局并发上限 | `maxConcurrent`（→ `maxGlobal`） | 全局占用 = 池内 running + hub 交互 running（Q2 口径） |
| 单会话上限 | `maxPerSession` | 同 session 同时 running 的池任务数 |
| 单工作区公平配额 | `maxPerWorkspace`（0 = 不限） | 公平策略，不是容量权威；全局池才是 |
| 排队总数上限 | `maxQueued` | 满则入池拒绝（throw），调用方给 LLM/UI 明确错误「队列已满，请稍后再派」 |
| 执行超时 | `taskTimeoutMs` | 单任务 running 超时 → AbortController 中断 |
| 排队超时 | `queuedTimeoutMs`（0 = 不限） | queued 超时未获槽 → 移出队列并回调 `onQueuedDrop` |

### 6.2 准入判定链

drain 时对每个排队任务逐条求值，**首个命中的上限即排队原因**（记录 `reason: global|session|workspace`，供统计与 UI 展示）：

1. `global`：`runningGlobal + hubInteractiveRunning >= maxGlobal`
2. `session`：`runningBySession[sessionId] >= maxPerSession`
3. `workspace`：`maxPerWorkspace > 0 且 runningByWorkspace[workspaceId] >= maxPerWorkspace`
4. 全部通过才 `start`。

排队任务携带 `reason` + `position`（`getQueuedReason` / `getPosition`），前端右栏「进行中」组展示「第 N 位 · 因 X 上限排队」。

### 6.3 交互式运行的占用口径（Q2）

- 交互式运行（用户在 Chat 直发消息，hub 主链路）**不入池、零排队**，但计入全局占用：
  `hub 交互 running = hub 活跃流中未被 occupancy claim 的部分`。
- 池内任务起流前 `claimOccupancy(sessionId)`（refcount）把自己的 hub 流从「交互 running」剔除，避免双算。
- 活性：pull 口径只解决「怎么算」；hub 交互流结束经 `onHubRunSettled` 显式通知池 `reevaluateQueue()`（drain 幂等），解决「何时重排」——否则 queued 任务在下一次池事件前无人唤醒。

### 6.4 血缘槽位继承（Q4 防死锁）

- `spawn_subagent(waitForResult=true)` 的同步等待路径：父持有池槽位挂起等待，子若再入池等槽 → 池满时「父占槽等子、子等父腾槽」循环等待死锁。
- 解法：子执行视为**父槽位让渡**——`claimOccupancy(子会话)` 把子会话 hub 流从「交互 running」剔除，子走 inline **不占新槽**。
- 不变量一句话：**同一血缘同时只有一个执行体占槽**。

### 6.5 消费续跑高优通道（Q3，与执行正交）

- 交付消费（`autoConsumeAsyncDelivery` / superior 队列 drain 续跑）与「任务执行」正交：走 `runConsumeJob` 高优通道——插到队首（同类 FIFO），admit 优先级高于普通排队任务，**但仍受全局占用上限约束**（普通任务不插队到消费前面，消费也不把全局容量打爆）。
- **禁止等槽无限挂起消费链**：`queuedTimeoutMs`（缺省兜底 30s）内未获槽则 resolve false 放弃本轮——CLAIM（`Task.delivered` 原子认领 / SessionQueueItem consume）移到**获槽后**执行，未获槽则 delivery 原样留待下次触发（不丢）。
- hub 交互流不依赖池槽位 ⇒ 消费任务等 hub 空闲不会与池形成循环等待。

### 6.6 回收器

- 池的 queue/running 是进程内存态，服务端重启即清空。
- `recoverStaleAsyncJobs()`（启动时挂载）把遗留 `running/queued` 的 async_agent Task 标 `failed` 并同步子会话状态——如实宣告失败，不假装能续跑（与 `recoverStaleRuns` 同款机制）。
- 与 AGENTS.md「运行中的 Agent 任务随服务端进程重启而丢失」一致；跨重启恢复属后续扩展。

---

## 7. 数据库写入事务

### 7.1 assistant 消息 + Run 记录

`chatAgentStream` 在 SSE 结束时，用一次 `$transaction` 同时写入：

1. assistant `ChatMessage`。
2. `Run` 运行记录。

**作用**：避免只写了一半数据（例如只写了 assistant 消息但没写 Run 记录）。

### 7.2 SQLite 单连接限制

SQLite 是文件级锁，并发写会串行化。KnowPilot 默认单用户、单进程，因此不会遇到严重的写并发冲突。

如果未来迁移到 PostgreSQL：

- 需要给关键表加唯一索引和乐观锁。
- `Run` 和 `ChatMessage` 写入继续保持事务化。

---

## 8. Agent 间消息的防循环

### 8.1 `depth` 字段

`AgentMessage` 有 `depth` 字段，默认 1，每次转发递增。

`swarmBus.send` 校验：

```ts
if (depth > MAX_DEPTH) {
  return { success: false, error: { code: "DELEGATION_DEPTH_EXCEEDED", ... } };
}
```

**作用**：防止 Agent 之间无限循环委派。

### 8.2 向上发消息时机约束

`swarmPermissionGuard.checkUpwardMessageTiming` 保证：

- 下级 Agent 只能在“收到上级消息之后”回复上级。
- 不能连续向上级发多条消息。

**作用**：防止子 Agent 骚扰上级。

---

## 9. 刷新/断线恢复

### 9.1 前端流式状态持久化

前端把每个 session 的流式状态写入 `sessionStorage`：

- `streamingContent`
- `liveTimeline`
- `lastEventId`
- `userQueue`、`asyncOverlays`

刷新页面后：

1. 从 `sessionStorage` 恢复状态。
2. 如果 `isStreaming` 为 true，自动调用 `runStream({ isResume: true, resumeAfter: lastEventId })` 续传。

### 9.2 后端事件日志

后端 `SessionStreamHub` 双写：

- 内存热缓冲：低延迟推送。
- SQLite 事件日志：断线续传和服务端重启恢复。

**作用**：刷新页面或短暂断线不会丢失流式内容。

---

## 10. 典型竞态场景与防护

| 场景 | 风险 | 防护 |
| --- | --- | --- |
| 同一 Agent 被两个父 Agent 同时触发 | 主会话历史顺序错乱 | `agentRunLocks` 串行化 |
| 用户在同一 session 连续发两条消息 | 两条流同时写入 | `queueDraining` 串行消费 |
| 用户在流式时刷新页面 | 流式内容丢失 | `sessionStorage` + `lastEventId` 续传 |
| 异步任务和子 Agent 同时投递结果 | 队列乱序 | 统一进入 `asyncResultQueue`，按优先级消费 |
| 子 Agent 无限向上级发消息 | 循环委派 | `depth` + 向上发消息时机约束 |
| assistant 消息和 Run 记录写入一半 | 数据不一致 | Prisma `$transaction` |
| 浏览器关闭时父 Agent 发消息 | 子 Agent 收不到 | `AgentMessage` 持久化到 DB |

---

## 11. 未来改进

1. **分布式锁**：多实例部署时用 Redis 替代进程内 `agentRunLocks`。
2. **推送替代轮询**：`pullAsyncQueue`、`pullAgentMessages` 改为 SSE 推送（详见 `future-features.md`）。
3. **队列持久化**：用户/上级合并队列顺序持久化到 `SessionQueueItem` 表。
