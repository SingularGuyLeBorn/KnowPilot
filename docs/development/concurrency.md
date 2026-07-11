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

## 6. 数据库写入事务

### 6.1 assistant 消息 + Run 记录

`chatAgentStream` 在 SSE 结束时，用一次 `$transaction` 同时写入：

1. assistant `ChatMessage`。
2. `Run` 运行记录。

**作用**：避免只写了一半数据（例如只写了 assistant 消息但没写 Run 记录）。

### 6.2 SQLite 单连接限制

SQLite 是文件级锁，并发写会串行化。KnowPilot 默认单用户、单进程，因此不会遇到严重的写并发冲突。

如果未来迁移到 PostgreSQL：

- 需要给关键表加唯一索引和乐观锁。
- `Run` 和 `ChatMessage` 写入继续保持事务化。

---

## 7. Agent 间消息的防循环

### 7.1 `depth` 字段

`AgentMessage` 有 `depth` 字段，默认 1，每次转发递增。

`swarmBus.send` 校验：

```ts
if (depth > MAX_DEPTH) {
  return { success: false, error: { code: "DELEGATION_DEPTH_EXCEEDED", ... } };
}
```

**作用**：防止 Agent 之间无限循环委派。

### 7.2 向上发消息时机约束

`swarmPermissionGuard.checkUpwardMessageTiming` 保证：

- 下级 Agent 只能在“收到上级消息之后”回复上级。
- 不能连续向上级发多条消息。

**作用**：防止子 Agent 骚扰上级。

---

## 8. 刷新/断线恢复

### 8.1 前端流式状态持久化

前端把每个 session 的流式状态写入 `sessionStorage`：

- `streamingContent`
- `liveTimeline`
- `lastEventId`
- `userQueue`、`asyncOverlays`

刷新页面后：

1. 从 `sessionStorage` 恢复状态。
2. 如果 `isStreaming` 为 true，自动调用 `runStream({ isResume: true, resumeAfter: lastEventId })` 续传。

### 8.2 后端事件日志

后端 `SessionStreamHub` 双写：

- 内存热缓冲：低延迟推送。
- SQLite 事件日志：断线续传和服务端重启恢复。

**作用**：刷新页面或短暂断线不会丢失流式内容。

---

## 9. 典型竞态场景与防护

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

## 10. 未来改进

1. **分布式锁**：多实例部署时用 Redis 替代进程内 `agentRunLocks`。
2. **推送替代轮询**：`pullAsyncQueue`、`pullAgentMessages` 改为 SSE 推送（详见 `future-features.md`）。
3. **队列持久化**：用户/上级合并队列顺序持久化到 `SessionQueueItem` 表。
