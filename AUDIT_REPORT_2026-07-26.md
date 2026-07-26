# KnowPilot 架构审计报告（2026-07-26）

> 基于 `AUDIT_PROMPT.md` Phase 0→3。Phase 0 卫生项已在前序会话修完；本报告覆盖 Phase 1/2 发现与当场落地修复。

## 执行摘要

PR-1~6 / v7~v10 核心不变量**整体稳固**，2026-07-20 的 P0/P1 **未复发**。本轮新发现并以代码落地的重点：

| 级别 | 项 | 状态 |
|---|---|---|
| P1 | 多路 SSE 续传互 abort | **已修** `useChatRunStream.ts` resume 单飞 |
| P1 | FS 读写隔离不对称 + `content/posts` 可绕过 Post 管道 | **已修** `resolveAgentFsPath` |
| P2 | E7 子 Agent 镜像 content 撞名误吞 | **已修** `useSubagentMessageMirror.ts` |
| P2 | localStorage tombstone 永久 skip reconciler 补投 | **已修** `chatQueueTypes.ts` |
| P2 | spawn 去重 60s 与在途任务脱节（B8） | **已修** `swarmOrchestrator.lookupDedup` |
| P3 | `retryKind:auto` / `staleTasksResumed` 死字段 | **已修** |
| P3 | `swarmBus` 兼容 re-export | **已修** |

验收：`pnpm lint` 绿；server **767/767**、web **60/60**、shared **40/40**。

---

## 已确认稳固（证据）

- Chat：`BEGIN_STREAM` occupied 拒绝 / `COMMIT_STREAM` 仅 done|error / `ABORT_STREAM` 三态 — `useStreamLifecycle.ts`
- 投递：`ackThenMarkDelivery`、reconciler、`deliveryExempt`、重启 Task 一律 failed — `asyncJobManager.ts`
- Swarm：`invoke_api` 已删；`agent_inspect` 不返消息 content；depth 服务端物化；busy→bus 不写 ChatMessage
- Import 环：`importOrder.test.ts` 防线仍在
- Schema：`reentrant`/`maxRetries`/`retryCount` 已删

---

## 本轮已落地修复（摘要）

### 1. Resume 单飞（P1）

`useChatRunStream.runStream`：`isResume` 且已有未 abort 的 AbortController → no-op；仅非 resume 才 abort 旧流。避免 mount/listRunning/visibility/切 session 四路续传互杀。

### 2. FS 路径单点（P1）

`fs.ts` `resolveAgentFsPath(mode)`：

- 读：`content/**` 知识库 + Workspace
- 写：仅 `content/uploads/**`；硬拒 `content/posts|about`；其余 Workspace
- list/search 默认 Workspace 根（禁止裸扫项目根）

### 3. E7 镜像判重（P2）

去掉 content 正文撞名；一律 `createSessionQueueItem(agentMessageId)`；服务端 skip（无 data）再 `markConsumed`。

### 4. consumedDeliveries（P2-5）

`mergeAsyncPollIntoQueue`：**不再**用 `skipDeliveryJobIds` 过滤 `poll.deliveries`（server 为 ground truth）。单测 `ackThenMarkDelivery` 增补负向断言。

### 5. B8 dedup / 死代码

- 在途 dedup entry 过期仍返回（有 completion 无 outcome）
- 删 `swarmBus` re-export、`retryKind:"auto"`、`staleTasksResumed`

---

## 本轮续修（已落地）

| 项 | 修法 |
|---|---|
| E8 会话 config 双事实源 | `sessionConfigStore` 为权威切片；runStream/drain/resume 按 sid 取；删 focusedPaneConfig 上报 |
| A7 reflection 拒稿已流出 | `__reflection__` onToolStart 清 streaming + discard rAF；拒稿进时间线作中间结果（默认 reflection 仍关） |
| P2-4 abort hydrate | user abort / AbortError 有 partialId 只靠 SSE upsert+tryCommit；仅 resume 无流保留 hydrate |
| P2-7 agent_inspect | 不返 systemPrompt/memory 正文，只返 chars/元信息 |

## 仍开放（低优先级）

| 项 | 说明 | 建议优先级 |
|---|---|---|
| A7 服务端终轮缓冲 | reflection.enabled 时缓冲 token 至 critic 通过（当前仅前端清流） | 低 |
| A8/C8/D7 旧登记项 | 扁平 inject / config 热更新 / symlink | 低 |

---

## 依赖图（Phase 1）

见会话内 Phase 1 子代理输出：环 `agentRuntime→…→nativeTools→agentRuntime` 已断；叶子 `promptBuilder`/`agentResolver`/`delegationDepth`/`agentMessageLedger`。

---

## 测试缺口（登记）

- mount sessionStorage 续传 + listRunning 同 session 互 abort（现已用 store 单飞根治，建议补 E2E）
- FS：sub Agent 读 `config/agents/` 负向断言（可加）
- reflection 开启时拒稿可见性

---

*生成：2026-07-26 · 续修已落地，按主题拆 commit*
