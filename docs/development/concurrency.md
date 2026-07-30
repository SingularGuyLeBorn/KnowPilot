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
| 全局并发上限 | `maxConcurrent`（→ `maxGlobal`） | 全局占用 = 池内 **llm** running + hub 交互 running（Q2 口径）；`slotClass=lightweight`（sleep/纯工具）不计入 |
| 单会话上限 | `maxPerSession` | 同 session 同时 running 的 **llm** 池任务数 |
| 单工作区配额 | `Workspace.asyncSlotQuota`（行级；缺省回退 `maxPerWorkspace`） | 业务空间默认 2；Root=0 不限；全局 `maxConcurrent` 仍是硬顶 |
| 排队总数上限 | `maxQueued` | 满则入池拒绝（throw），调用方给 LLM/UI 明确错误「队列已满，请稍后再派」 |
| 执行超时 | `taskTimeoutMs` | 单任务 running 超时 → AbortController 中断 |
| 排队超时 | `queuedTimeoutMs`（0 = 不限） | queued 超时未获槽 → 移出队列并回调 `onQueuedDrop` |

### 6.2 准入判定链

drain 时对每个排队任务逐条求值，**首个命中的上限即排队原因**（记录 `reason: global|session|workspace`，供统计与 UI 展示）：

1. `slotClass === "lightweight"` → **永不因容量排队**（仍可 cancel / timeout；不占 `runningGlobal`）
2. `global`：`runningGlobal + hubInteractiveRunning >= maxGlobal`
3. `session`：`runningBySession[sessionId] >= maxPerSession`
4. `workspace`：`maxPerWorkspace > 0 且 runningByWorkspace[workspaceId] >= maxPerWorkspace`
5. 全部通过才 `start`。

父子通道与槽位期望场景见 `async-slots-and-parent-child.md`。Abort 文案按 `AbortSignal.reason`（`user|timeout|cancel|pool|session_stop`）区分，见 `infra/abortReason.ts`。

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
- `recoverStaleAsyncJobs()`（启动时挂载）：遗留 `running/queued` 的 async_agent Task **一律**标 `failed`（文案「服务重启，任务中断」），**绝不**重建执行体自动续跑——tool 任务有副作用、进度未知，盲目重跑可能重复执行；留待人工 `retryAsyncJob`。`recoverStaleRuns` 仍只标 `interrupted` 不续跑。
- 与 AGENTS.md「服务重启不自动续跑」铁律一致；会话侧手动恢复见 §8。

---

## 7. 投递可靠性（v9 R-1/R-2）

v9 落地。异步结果从「任务完成」到「气泡进会话」的链路是：CLAIM（认领交付）→ 注入（写 ChatMessage + 起流续跑）→ 对账（兜底自愈）。三段的不变量全部收在服务端（`asyncJobManager.ts`），编排层写错也打不破。设计决策（Q1~Q2）见 `design-decisions.md` 文末「投递可靠性」。

### 7.1 CLAIM：`Task.delivered` 原子认领是唯一互斥点

- 全文交付的互斥点只有一个：`updateMany where delivered=false → delivered=true`（条件写天然竞态原子，落选方 count=0 静默跳过）。两处 CLAIM——服务端 `autoConsumeAsyncDelivery` 与前端 ack `markAsyncDeliveryConsumed`——共用同一把锁，先认领者注入，后到者空手返回。
- 两处 CLAIM 均在**同一事务**内完成 W14 账本记账（`markAgentMessageDeliveredByTaskRef`，按 `taskRef=jobId` 幂等），不存在「Task 已 delivered 但旁路邮箱仍 pending」的中间态。
- CLAIM 必须发生在注入**之前**：挪到注入之后会造出两个各自注入的消费者，同一结果双注气泡。

### 7.2 注入失败：确定未写消息才同链回滚（宁漏勿错）

- CLAIM 与气泡写入之间隔着无法同事务的 SSE 起流，失败分两类：
  - **确定未写消息**（唯一可判路径）：`startIfNotRunning` 返回 false（别的流占线，runner/chatAgentStream 未执行）→ `rollbackAsyncDeliveryClaim` 事务回滚 `delivered=false` + 同事务回滚 W14 账本（delivered→pending）+ 重挂消费链队尾。不丢、不重复。
  - **无法判定**（如 `started=true` 后 `chatAgentStream` 中途抛错）：消息可能已写入，回滚会导致重复投喂——**一律不回滚**，交 7.3 对账兜底。
- 原则一句话：**宁漏回滚勿错回滚**。漏回滚有对账者补，错回滚必重复投喂。
- 回滚本身是条件写（`updateMany where delivered=true`），与正常 CLAIM / 前端 ack 条件互斥：期间已被正常消费的记录条件写不命中（count=0），调用方放弃回滚，不补投。

### 7.3 对账：ChatMessage 是 ground truth，reconciler 全幂等

- 对账者 reconciler（`reconcileAsyncDeliveries` / `startAsyncDeliveryReconciler`）：启动即扫 + 周期扫（周期复用 `config.stream.cleanupIntervalMs`，无新增 config 面）。
- 扫描面：`delivered=true` 且终态、超龄（`RECONCILER_MIN_DELIVERED_AGE_MS=60s`，CLAIM→落库正常在秒级完成，该阈值只影响补投时机不影响正确性）、未 pinned、`deliverToQueue≠false`（同步任务结果走 tool return，永不进队列，不属补投范围）、且会话内无 `toolResults.subagentResult.jobId=X` 的 ChatMessage 的孤儿交付。
- **ChatMessage 是唯一 ground truth**：交付是否完成只看气泡在不在，不看 Task 标志位。有气泡 → 跳过；无气泡 → 条件写回滚（同 7.2 互斥语义）→ `notifyAsyncDelivery` 重走正常 notify/autoConsume 管道补投（`[reconciler] 补投 jobId=...`，每轮上限 `RECONCILER_BATCH_LIMIT=50`）。补投不另造投递路径，对账者跑多少轮、与其他写方如何交错都不会出错（幂等）。

### 7.4 重启恢复四动作：全部条件写幂等

`runStartupRecovery` 启动首扫（index.ts 启动序列挂载，shutdown 停 reconciler），DB 为 ground truth：

1. 僵尸 running/queued async Task → **一律** failed（「服务重启，任务中断」），**不自动重跑**。tool 任务有副作用（写文件/发请求），进程死亡时执行进度未知，盲目重跑可能重复执行；`retryAsyncJob` 保留手动重试，把「要不要承担重复副作用」的决定权交还给人。（历史：曾短暂落地 `reentrant`/`retryCount`/`maxRetries` 两态分叉自动续跑，已按用户要求整体撤销；三列已从 schema 删除。）
2. 僵尸 running ChatSession → paused（`updateMany` 条件写；重启后 hub 无任何活跃流，仍 running 的都是尸体）。先于动作 3 执行——drain 重注册会把有真实积压的会话重新置 running。
3. superior 孤儿 SessionQueueItem → 重注册 drain（v7 W-E 机制；进程内 drain 链随重启丢失，pending 队列项跨重启留存于 SQLite）。
4. `delivered=false` 终态未投递 → 重新 notify——与 R-1 reconciler **同一幂等入口** `reconcileAsyncDeliveries`，不造第二条恢复路径。

AgentMessage pending 超龄走 W14 既有 stale 对账（`SUPERIOR_MIRROR_STALE_MS`），不在此新造逻辑。

---

## 8. 会话手动恢复（原 v10 C-3；可重入自动续跑已撤销）

> **状态更新（现行）**：v10 曾落地 `Task.reentrant`/`retryCount`/`maxRetries` + 启动自动续跑（C-1/C-2），已按用户要求**整体撤销**——schema 三列删除、`inferTaskReentrant`/`ToolCommand.reentrant`/入队物化/`config.asyncJobs.maxRetries` 全部清除；`recoverStaleAsyncJobs` 统一标 failed。仅保留 **C-3 会话手动恢复**（`chatSession.resume`）。历史决策原文见 `design-decisions.md`「可重入与续跑 Q1~Q4」（已加撤销注记）。异步工具全生命周期见 `async-tools-semantics.md`。

### 8.1 启动恢复：僵尸 Task 一律 failed

- `recoverStaleAsyncJobs`（`runStartupRecovery` 动作 1 唯一收拢点）：所有僵尸 running/queued Task → failed「服务重启，任务中断」，不重建执行体、不入池。
- 逐条条件写认领（`updateMany where id + status in (running,queued)`），落选 count=0 跳过——重入/并发幂等。
- 手动 `retryAsyncJob` 是唯一复活闸：直接重建执行体入池（不再物化 reentrant/maxRetries）。

### 8.2 会话手动恢复（chatSession.resume）

- 唯一互斥点 = 条件写 `updateMany where {id, status:"paused"} → running`：并发 double-resume 只一生效；count=0 重读——已 running 幂等返回（不报错、不重复起流），archived/failed 等 BAD_REQUEST。
- 获恢复权后注入 `source:"system"` user 消息「（服务已重启，请继续完成未完成的任务）」，经 `hub.startIfNotRunning(chatAgentStream)` **交互式起流**（v8 Q2 口径：不入池但计入全局占用，不新造限流层）。系统消息由 chatAgentStream 起流后写入——注入与起流同源，不存在「消息已写、流未起」的孤儿窗口。
- `startIfNotRunning` 返回 false = 已有活跃流接管（如前端断线重连先一步起流）→ 竞态幂等不算失败；起流抛错 ⟹ runner 未执行 ⟹ 消息必未写入 ⟹ 安全回滚 running→paused。
- 终态归位挂 runner 内（hub 标 completed 之前）：done → active/completed（subagent），error/abort → paused 可再次恢复；条件写 `where status:"running"` 保证期间被 stop/report_back 接管时不覆盖。
- 上下文从 ChatMessage 扁平消息链重建（`chatHistory.test.ts` 已证可重建），resume 前已有的 assistant 消息不重复生成。
- **禁止**启动时自动 resume——paused 会话由用户点按钮触发。

### 8.3 与 v8 池 / v9 reconciler 的职责边界

| 机制 | 管什么 | 对账键 | 扫描面 |
| --- | --- | --- | --- |
| v8 全局池（§6） | 活着的任务怎么排队：后台并发容量与公平 | 池内 running/queued 内存态 + hub 交互口径 | 调度准入（drain 逐条求值） |
| v9 reconciler（§7.3） | 「结果已产出、气泡没进会话」的孤儿**投递** | ChatMessage 有无 `toolResults.subagentResult.jobId=X` | `delivered=true` 终态交付 |
| 启动恢复（§7.4 / §8.1） | 「执行体已死」的僵尸**归档**（标 failed，不复活） | Task.status | running/queued 僵尸任务 |
| 会话 resume（§8.2） | paused 会话的**手动**续聊 | ChatSession.status 条件写 | 用户触发 |

- 扫描面两两不相交：池管调度、reconciler 管投递、启动恢复管归档、resume 管会话续聊。任务跑完后的结果投递仍走 §7 的 CLAIM/对账管道。

---

## 9. 数据库写入事务

### 9.1 assistant 消息 + Run 记录

`chatAgentStream` 在 SSE 结束时，用一次 `$transaction` 同时写入：

1. assistant `ChatMessage`。
2. `Run` 运行记录。

**作用**：避免只写了一半数据（例如只写了 assistant 消息但没写 Run 记录）。

### 9.2 SQLite 单连接限制

SQLite 是文件级锁，并发写会串行化。KnowPilot 默认单用户、单进程，因此不会遇到严重的写并发冲突。

如果未来迁移到 PostgreSQL：

- 需要给关键表加唯一索引和乐观锁。
- `Run` 和 `ChatMessage` 写入继续保持事务化。

---

## 10. Agent 间消息的防循环

### 10.1 `depth` 字段

`AgentMessage` 有 `depth` 字段，默认 1，每次转发递增。

`swarmBus.send` 校验：

```ts
if (depth > MAX_DEPTH) {
  return { success: false, error: { code: "DELEGATION_DEPTH_EXCEEDED", ... } };
}
```

**作用**：防止 Agent 之间无限循环委派。

### 10.2 向上发消息时机约束

`swarmPermissionGuard.checkUpwardMessageTiming` 保证：

- 下级 Agent 只能在“收到上级消息之后”回复上级。
- 不能连续向上级发多条消息。

**作用**：防止子 Agent 骚扰上级。

---

## 11. 刷新/断线恢复

### 11.1 前端流式状态持久化

前端把每个 session 的流式状态写入 `sessionStorage`：

- `streamingContent`
- `liveTimeline`
- `lastEventId`
- `userQueue`、`asyncOverlays`

刷新页面后：

1. 从 `sessionStorage` 恢复状态。
2. 如果 `isStreaming` 为 true，自动调用 `runStream({ isResume: true, resumeAfter: lastEventId })` 续传。

### 11.2 后端事件日志

后端 `SessionStreamHub` 双写：

- 内存热缓冲：低延迟推送。
- SQLite 事件日志：断线续传和服务端重启恢复。

**作用**：刷新页面或短暂断线不会丢失流式内容。

---

## 12. 典型竞态场景与防护

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

## 13. LLM 日预算与硬预留 MVP（C5）

`llmBudget`（`apps/server/src/infra/llmBudget.ts`）：

- **硬预留 MVP**：`reactLoop` 入口 `tryReserveLlmBudget`（默认约 4k tokens 估值），`finally` 释放；`assertLlmBudget` / `getLlmBudgetStatus` 按 `spentUsd + reservedUsd` 判定超限，挡住「尚未 record 的在途占用」。
- `recordTokenUsage` 仍记真实花费；预留不是厂商账单。
- Goal 外环在继续前 `assertLlmBudget`（见 `goalLoop`）；细粒度 Goal×内环账本仍待办。
- 启动期 `await hydrateLlmBudget`（`index.ts`）：同日取 `max(内存已花, 磁盘已花)`，消除 hydrate 竞态抹额度。

---

## 14. 未来改进

1. **分布式锁**：多实例部署时用 Redis 替代进程内 `agentRunLocks`。
2. **推送替代轮询**：`pullAsyncQueue`、`pullAgentMessages` 改为 SSE 推送（详见 `future-features.md`）。
3. **队列持久化**：用户/上级合并队列顺序持久化到 `SessionQueueItem` 表。
