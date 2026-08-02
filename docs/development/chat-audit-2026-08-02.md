# Chat 真实代码与文档理想时序一致性审计报告

> 审计日期：2026-08-02  
> 审计范围：多轮对话 queue、ask_user、子 Agent 同步/异步、async_task_run 同步/异步、后台/切 session drain  
> 文档基准：`docs/development/chat-state-architecture.md`、`docs/development/chat-scenario-states.md`  
> 方法：人工逐文件阅读核心路径，对照文档不变量，标注一致/不一致/测试缺口。

---

## 1. 结论速览

| 维度 | 结果 |
|---|---|
| 架构骨架 | ✅ 已落地：MessageStore(SSE) + StreamLifecycle 状态机 + Compose 队列三层 |
| 消息推送 | ✅ `MessageService.afterCreate/Update/Delete` 已推 `message_upserted`/`message_deleted` |
| 多轮 drain | ✅ 已修复：字段比较补全、后台 drain systemPrompt 取目标 session、服务端 resumeAfter 校验 |
| async-result 优先级 | ⚠️ 文档与代码不一致（文档写「优先于 userQueue」），但真实路径（服务端 autoConsume → SSE）功能正常；已清理死代码 |
| 测试覆盖 | ✅ 补了 `useSessionMessages.test.ts`、`agentStreamResume.test.ts`、`chatQueueDrainLifecycle.test.ts`；新增 `chat-queue-mock.spec.ts`（受 mock E2E 基础设施前置故障阻塞） |

**P0 必须修（本轮已修复）：**

1. ✅ `messageFieldsEqual` 字段过少，可能误判消息相同 → 已补全 `role/source/attachments/finishReason/kind/label/parentId` 并新增 `useSessionMessages.test.ts`。
2. ✅ 后台 drain 时 `runStream` 用 `selectedAgent`（焦点 Agent）给非焦点 session 用，可能用错 systemPrompt → 已扩展 `ChatSessionConfig.agentId/agentSystemPrompt`，在会话创建/迁移时写入，后台 drain 按 sid 取。
3. ✅ 服务端 `resumeAfter` 无 NaN/越界校验 → 已加 `resolveResumeAfter` 校验并补 `agentStreamResume.test.ts`。

**P1 清理（本轮已修复）：**

4. ✅ `useChatQueueDrain.consumeQueue` 中的 `async-result` 分支永远不会执行，是死代码 → 已删除并加注释说明真实路径（async-result 由服务端 `autoConsumeAsyncDelivery` 触发 `session_run_started`）。

**新发现：mock LLM E2E 基础设施前置故障**

- baseline（未应用本轮改动）`chat-resume-mock.spec.ts` 即失败：assistant-message-bubble 始终为 0。
- 这是本轮之外的基础设施问题，不在用户截图的 queue 卡死根因链上；记录为阻塞项，待后续排查。

---

## 2. 逐场景对照

### 2.1 基础单轮对话

| 步骤 | 文档理想 | 代码实现 | 一致？ |
|---|---|---|---|
| 用户发 A | 入 userQueue → drain → consumeQueue → beginStream | `useChatQueueDrain.ts:consumeQueue` / `ChatSessionPane` enqueue | ✅ |
| 服务端写 user 消息 | 推 `message_upserted` | `MessageService.afterCreate` 推 SSE | ✅ |
| MessageStore 更新 | reducer 直接 upsert | `useSessionMessages.ts` reducer | ✅ |
| LLM 流式 | `onToken` → appendTokenDelta | `useChatRunStream` rAF 合帧 | ✅ |
| 结束 | `done` → completeStream → upsert assistant → tryCommitStream → commit → idle → drain | `useStreamLifecycle` reducer + `onStreamCommitted` | ✅ |

### 2.2 连续发送多条（用户截图场景）

| 步骤 | 文档理想 | 代码实现 | 一致？ |
|---|---|---|---|
| A streaming 时发 B/C | 入 `userQueue`，不建 optimistic | `sessionComposeActions.enqueueUserQueueItem` | ✅ |
| A 结束 | commit → idle → `onStreamCommitted(S1)` | `StreamLifecycleStore.notifyCommit` | ✅ |
| 自动消费 B | `drainAllPendingQueues(S1)` → `consumeQueue(S1)` → runStream(B) | `useChatQueueDrain.ts` | ✅（finally 已补二次触发） |
| B 结束再消费 C | 同上 | 同上 | ✅ |

**风险点：** `messageFieldsEqual` 字段不全，如果 A 的 assistant `message_upserted` SSE 与 done 竞态，可能让 `tryCommitAfterAssistant` 判定 no-op 或错误 commit，导致 drain 不触发。

### 2.3 ask_user 工具

| 步骤 | 文档理想 | 代码实现 | 一致？ |
|---|---|---|---|
| LLM 调 ask_user | timeline 显示 AskUser running | `onToolStart`/`onToolEnd` | ✅ |
| 弹窗 | `ask_user_pending` SSE | `useChatSseSubscriptions` 注册 | ✅ |
| 等待用户 | phase 仍为 streaming，queue 不 drain | `isRunOccupied=true` 拦住 | ✅ |
| 用户回答 | 注入当前 run 上下文，继续 streaming | `injectUserMessages` + `SessionStreamHub` steeringQueue | ✅ |

### 2.4 async_task_run 同步 `waitForResult=true`

| 步骤 | 文档理想 | 代码实现 | 一致？ |
|---|---|---|---|
| 父 run 调工具 | timeline 显示 running | `onToolStart` | ✅ |
| Task 入池 | queued/running | `AsyncJobOrchestrator` | ✅ |
| 结果回父 | tool return 进最终 assistant | `executeToolCallsBatch` | ✅ |
| 不进异步队列 | `deliverToQueue=false` | `AsyncTaskInput.deliverToQueue` | ✅ |

### 2.5 async_task_run 异步 `waitForResult=false`

| 步骤 | 文档理想 | 代码实现 | 一致？ |
|---|---|---|---|
| 工具立刻返回 jobId | 父 run 可结束 | `nativeTools.ts async_task_run` | ✅ |
| Task 完成进异步队列 | `autoConsumeAsyncDelivery` 注入父会话 | `asyncJobManager.ts` | ✅ |
| 前端队列显示 | asyncOverlays + asyncResultQueue | `useChatDerivedQueues` | ✅ |
| 当前 run 结束后消费 | `drainAllPendingQueues` 优先 async-result > user | ⚠️ **真实路径不由前端 drain 消费** |

**真实路径：** async-result 靠服务端 `autoConsumeAsyncDelivery` 启动父会话新流，前端通过 `session_run_started` SSE 走 `handleSessionRunStarted` resume。这与文档「队列优先级 async-result > user」不一致，但功能上仍能工作。已在前端 `drainAllPendingQueues` 注释中显式说明。

### 2.6 子 Agent 同步 `waitForResult=true`

| 步骤 | 文档理想 | 代码实现 | 一致？ |
|---|---|---|---|
| spawn_subagent | 父 run 挂起，子等派活 | `swarmOrchestrator.ts` / `asyncJobManager.ts` | ✅ |
| 子 run 结束 | 系统抓取最后 assistant 作为 tool return | `waitForRun` + `prepareAgentRun` | ✅ |
| 父继续生成 | 最终 assistant 无右侧气泡 | `onDone` 正常结束 | ✅ |

### 2.7 子 Agent 异步 `waitForResult=false`

| 步骤 | 文档理想 | 代码实现 | 一致？ |
|---|---|---|---|
| spawn 立刻返回 | 父可继续聊 | `spawn_subagent` tool | ✅ |
| 子自己 report_back | 进父异步队列 | `agent_report_back` → `autoConsumeAsyncDelivery` | ✅ |
| 父当前 run 结束后消费 | async-result > user | ⚠️ 同上，真实路径为服务端 autoConsume |

### 2.8 后台/切 session drain

| 步骤 | 文档理想 | 代码实现 | 一致？ |
|---|---|---|---|
| 切到 S2，S1 仍在跑 | S1 后台继续，phase 仍 streaming | `useSyncExternalStore` 订阅不丢 | ✅ |
| S1 结束 | `onStreamCommitted(S1)` 触发 `drainAllPendingQueues(S1)` | `useChatQueueDrain.ts:drainAllPendingQueues` 遍历所有可见 session | ✅ |
| 不抢视图 | `keepCurrentView=true` | `consumeQueue` 设置 | ✅ |
| 用 S1 的 Agent | 后台 drain 用目标 session 的 Agent systemPrompt | ❌ 用 `selectedAgent`（焦点 Agent） |

---

## 3. 不一致列表与根因

### P0-1 `messageFieldsEqual` 字段不全

- **位置：** `apps/web/lib/useSessionMessages.ts:89-96`
- **现状：** 只比较 `content/toolCalls/toolResults/tokenUsage`。
- **风险：** `role/source/attachments/finishReason/kind/label/parentId` 变化时会被误判为「相同消息」，导致 hydrate/upsert no-op 判定错误，可能让 `tryCommitAfterAssistant` 漏触发 commit，进而 drain 不触发。
- **修复：** 把这些字段纳入比较，并写测试。

### P0-2 后台 drain 用错 Agent systemPrompt

- **位置：** `apps/web/lib/useChatRunStream.ts:255-264`
- **现状：** `buildStreamConfig` 的 fallback systemPrompt 来自 `selectedAgent`，而 `selectedAgent` 是焦点 session 的 Agent。
- **风险：** 当用户在 S2，S1 后台 drain 时，S1 的 Agent 实际用的是 S2 的 systemPrompt，可能让回复风格/身份/工具清单错配。
- **修复：** 按 `originSid` 取目标 session 的 Agent systemPrompt。`sessionConfigStore` 目前不存 Agent systemPrompt，需要扩展或从 tRPC 取。

### P0-3 服务端 `resumeAfter` 无 NaN 校验

- **位置：** `apps/server/src/infra/agentStream.ts`（`chatAgentStream` / resume 入口）
- **现状：** 客户端传来的 `resumeAfter` 直接用于查询，未校验 `Number.isFinite`。
- **风险：** 传 `NaN`/`Infinity`/负数/超大值可能导致全量重放或 SQL 参数异常。
- **修复：** 入口加 `Number.isFinite(resumeAfter) && resumeAfter >= 0` 校验，非法时按 0 处理。

### P1-1 `async-result` 死代码分支

- **位置：** `apps/web/lib/useChatQueueDrain.ts:181-206`
- **现状：** `consumeQueue` 只从 `compose.userQueue` 取，永远拿不到 `async-result`。
- **风险：** 文档说 async-result 优先于 user，但代码不执行；真实靠服务端 autoConsume，两者并存会造成维护者困惑。
- **修复：** 删除该死分支，并在 `drainAllPendingQueues` 注释中说明「async-result 不由前端 drain 消费，由服务端 autoConsume 触发 session_run_started」。

---

## 4. 测试缺口与已补测试

| 缺口 | 影响 | 已补充 |
|---|---|---|
| `messageFieldsEqual` 字段不全导致误判 | hydrate/upsert no-op 错误， drain 不触发 | ✅ `apps/web/lib/__tests__/useSessionMessages.test.ts`（15 例） |
| 后台 drain systemPrompt 用错 Agent | 非焦点 session 回复风格/身份错配 | ✅ `apps/web/lib/chatConfig.ts` 运行态回退 + `sessionConfigStore.test.ts` 覆盖 |
| 服务端 `resumeAfter` 非法值 | 全量重放或 SQL 异常 | ✅ `apps/server/src/__tests__/agentStreamResume.test.ts` |
| 连续发送 drain 生命周期 | 用户截图的 queue 卡住 | ✅ `apps/web/lib/__tests__/chatQueueDrainLifecycle.test.tsx`（S1~S3） |
| 缺少 mock LLM 下「连续两条自动 drain」E2E | 用户截图的 bug 无稳定复现 | ⚠️ 已新增 `e2e/chat-queue-mock.spec.ts`，但受 mock E2E 基础设施前置故障阻塞 |
| mock LLM E2E 基础设施前置故障 | baseline 即失败，无法验证 mock 场景 | ❌ 待排查（非本轮 queue 卡死根因） |

---

## 5. 修复结论

本轮已修复 P0/P1 全部不一致点：
- P0-1：`useSessionMessages.messageFieldsEqual` 补全字段比较。
- P0-2：后台 drain 用目标 session 的 Agent systemPrompt（扩展 `ChatSessionConfig` + `sessionConfigStore` + `chat.tsx` 迁移时写入）。
- P0-3：`agentStream.ts` 增加 `resolveResumeAfter` 非法值回 0。
- P1-1：删除 `useChatQueueDrain.consumeQueue` 中 unreachable 的 `async-result` 分支，注释说明真实消费路径。

未解决项：
- mock LLM E2E（`chat-resume-mock.spec.ts` / `chat-queue-mock.spec.ts`）在 baseline 即失败，与本轮改动无关；需单独排查 mock E2E 基础设施。

验证结果：
- `pnpm --filter @knowpilot/web lint`：0 errors
- `pnpm --filter @knowpilot/web test`：47 files, 167 passed
- `pnpm --filter @knowpilot/server lint`：通过
- `pnpm --filter @knowpilot/server test`：149 files, 1036 passed
- mock E2E：baseline 失败，前置阻塞
