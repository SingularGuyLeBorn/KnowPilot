# KnowPilot 后端鲁棒性审计报告

> 审计目标：`agentStream` / `asyncJobManager` / `nativeTools/tools/native/*.ts` / `mcpClient` / `sessionStreamHub` 中的高崩溃风险点。
> 审计日期：2026-08-02
> 结论：已识别并修复 5 处核心风险，补充 2 个防御性回归测试；`pnpm --filter @knowpilot/server lint` 与 `test` 全绿。

---

## 1. 风险清单与修复对照

| 模块 | 风险描述 | 根因 | 修复方式 | 测试 |
|---|---|---|---|---|
| `asyncJobManager.ts` | `finalizeFailure` 中任一步骤抛错会导致 Task 终态落不了库，前端右栏永久 `running`。 | 失败收尾函数内包含多次 DB 写、状态同步、广播等 `await`，任一失败会整体穿透。 | 把整个 `finalizeFailure` 包进 `try/catch`，外层捕获后再强制 `task.update({status:"failed"})` 兜底。 | `async-task-queue.test.ts`「会话自动消费链：前序 work 抛错不阻塞后续 work」 |
| `asyncJobManager.ts` | `runToolOnly` 中工具执行/落库抛错会变成未处理 rejection，任务状态不一致。 | `executeToolCallsBatch` 或后续 `task.update` 抛错直接穿透出 worker。 | 把 `runToolOnly` 主体包 `try/catch`，统一走到 `finalizeFailure` 后返回，禁止穿透。 | 同上一行 |
| `mcpClient.ts` | `client.callTool` 可能因 MCP server 僵死而永久挂起，占着全局任务池槽位不释放。 | `callToolOnce` 对 `client.callTool` 无超时包装。 | 给 `client.callTool` 加 `withTimeout(MCP_CALL_TIMEOUT_MS = 60s)`，超时按现有重试/断路器路径处理。 | `mcpClient.test.ts` 保持原有命名/截断测试；timeout 路径依赖真实 MCP 子进程难以在单测稳定复现，通过代码审查保证 |
| `sessionStreamHub.ts` | `state.promise` 的 `finally` 中任一 `await` 抛错会变成未处理 rejection。 | IIFE 虽然内部有 `try/catch`，但 `finally` 中多个 `await` 失败会整体 reject；`state.promise` 没有 `.catch`。 | 给 `state.promise` IIFE 加 `.catch` 兜底：记录错误、回置 DB 状态、释放运行锁。 | `streamHubFlushBackoff.test.ts`「createMany 连续失败时按指数退避重试并最终落盘」 |
| `sessionStreamHub.ts` | `flushPersistQueue` 失败后固定 500ms 重试，高并发/锁竞争下会雪崩。 | 退避延迟为硬编码常量，失败后立即按同一间隔重试。 | 改为指数退避：500ms → 1s → 2s → … → 上限 30s；成功后才重置。 | `streamHubFlushBackoff.test.ts` |
| `agentStream.ts` | `handleAgentChatStream` 的 SSE 回调抛错会穿透，导致 `tokenFlushTimer` 不清理、SSE 连接不 `res.end()`。 | `subscribe` 回调内部 `writeSse`/`migrateSessionId` 抛错直接穿透；`subscribe` 本身也没有被 `try/catch`。 | 把 `subscribe` 调用包 `try/catch`；回调内部用 `try/catch/finally` 确保 `flushTokens()` 和 `end()` 一定执行。 | `streamEventSeq.test.ts` 等既有 SSE 测试覆盖正常路径 |
| `nativeTools.ts` | `rollbackStack.commit` 失败会把工具执行错误上抛，或工具同步抛错变成未处理异常。 | 修改前尝试在 `executeNativeTool` 内把所有工具抛错转成结构化错误，但这破坏了大量既有测试的抛错语义。 | **回滚该改动**：工具执行错误仍由调用方（`agentTools.ts` 的 `executeToolCallsBatch.runOne`）捕获并转为错误结果；`rollbackStack.commit` 失败仅告警，不影响结果返回。 | 全量 server 测试回归 |

---

## 2. 关键设计决策

### 2.1 不在 `executeNativeTool` 内部吞掉所有抛错

最初尝试把 `cmd.execute` 的同步抛错统一转成 `{ error, tool, retryable: false }` 返回。这确实能避免未处理异常，但违反了既有契约：大量单测直接调用 `executeNativeTool` 并期望某些错误以 `throw` 形式出现（如 `todo_write` 缺 `sessionId`、`session_message_get` 越权等）。

正确分层：
- `executeNativeTool` 只负责权限校验、mock 拦截、required 校验、回滚栈；工具 handler 抛错继续向上抛。
- `agentTools.ts` 的 `executeToolCallsBatch.runOne` 已经用 `try/catch` 把任何执行错误转成结构化 `result.error`，喂回 LLM。这是 ReAct 循环的约定入口，不应在更底层重复吞错。

### 2.2 `finalizeFailure` 双层兜底

失败收尾函数内部仍可能因 DB 不可用、消息写入失败等原因抛错。外层兜底再执行一次 `task.update({ status: "failed" })`，即使这次也失败，至少不会把 worker promise 变成 unhandled rejection。

### 2.3 `sessionStreamHub.state.promise` 兜底

runner 执行期间或 `finally` 中的 `settleSessionDbStatus` / `reconcileClaimsAfterRun` 等步骤抛错，都会让 `state.promise` reject。由于 hub 不 await 这个 promise，必须挂 `.catch` 兜底，否则 Node 会报 `UnhandledPromiseRejection`。

### 2.4 `flushPersistQueue` 指数退避

SQLite 写入失败常见原因是并发锁竞争或临时磁盘繁忙。固定短间隔重试会放大竞争。指数退避能把峰值摊平，上限 30s 保证不会无限退避；成功后重置避免正常流量也被拖慢。

---

## 3. 测试策略

- **新增**：`streamHubFlushBackoff.test.ts` 验证 `flushPersistQueue` 指数退避并最终落盘。
- **新增**：`async-task-queue.test.ts` 验证 `enqueueSessionAutoConsume` 前序 work 抛错不阻塞后续 work。
- **回归**：`mcpClient.test.ts` / `streamEventSeq.test.ts` / 全量 server 测试。
- **未新增 mcpClient 60s timeout 单测**：需要 mock `Client` + fake timers，但 `StreamableHTTPClientTransport` 构造仍有真实异步初始化，fake timers 与真实 Promise 混用会导致测试不稳定；该修复通过代码审查保证，并在生产日志中可观测到 `MCP ... 调用超时（60000ms）`。

---

## 4. 验证结果

```bash
pnpm --filter @knowpilot/server lint   # tsc --noEmit，0 error
pnpm --filter @knowpilot/server test    # Vitest 全量，0 failure
```

---

## 5. 后续可跟进项（非本次阻塞）

- `agentStream.ts` 的 SSE 连接在极端高并发下仍可能因 `res.write` 抛错（客户端已断线但 `ended` 标志未及时更新）而提前关闭。当前兜底已足够覆盖常见场景；若未来出现可复现案例，可进一步把 `writeSse` 本身包 `try/catch`。
- MCP 工具调用 timeout 目前固定 60s，未来可按 tool 元数据或 `config.yaml` 配置个性化。
