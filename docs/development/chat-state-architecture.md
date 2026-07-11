# Chat 会话状态架构重构设计

> 状态：**Phase 1–3 已落地**（2026-07-11）。目标是从根上解决「丢消息 / 需刷新 / 闪烁 / 卡顿」，而不是继续在 `chat.tsx` 里打补丁。
>
> 实现入口：
> - `apps/web/lib/useSessionMessages.ts`
> - `apps/web/lib/useStreamLifecycle.ts`
> - `apps/web/lib/useSessionComposeState.ts`
> - `apps/web/components/chat.tsx`（编排层）
> - `apps/server/src/services.ts` MessageService.afterCreate/Update/Delete → SSE
>
> 最后更新：2026-07-12（新增 §13：INV-4 渲染单一所有权 / INV-5 挂接进度一致性）

---

## 0. 一句话结论

**旧架构的问题不是「少推了一个 SSE」或「少 invalidate 一次」——而是前端同时维护了三套消息真相源 + 一套语义模糊的 `ssSet` 万能写入器，靠几十个 `useEffect` 互相追赶。**

新架构把职责拆成三层：

1. **消息真相源**（服务端写库 → SSE 推完整消息 → 前端 reducer 直接 patch）
2. **流式生命周期状态机**（显式 phase：`idle → streaming → done | error`）
3. **队列 / 乐观气泡**（与当前视图强绑定的局部状态，不再混进流式 Map）

命名原则：**禁止 `ssSet` / `st` / `lv` 这类缩写**；所有公开 API 用完整语义名（如 `setStreamingContent`、`patchSessionQueue`）。

---

## 1. 原来的问题是什么

### 1.1 症状（用户已感知）

| 症状 | 典型场景 |
|---|---|
| 子 Agent 消息不出现 | 父 Agent 派活后，子会话页空白；刷新才看到任务气泡 |
| UI 闪烁 | 下达命令、子 Agent 回传、`async_delivery` 到达时消息列表整页闪 |
| 卡死 / 卡顿 | 子 Agent 收到上级消息后界面卡住，需刷新才显示任务 |
| 丢消息 | SSE 漏推或 `invalidate` 时机不对 → 本地缓存落后于 DB |

这些症状看起来分散，根因是同一套架构缺陷。

### 1.2 根因 A：三套消息真相源互相打架

旧前端同时存在：

```text
① streamAgentChat（SSE 流）     → streamingContent / liveTimeline（本地）
② message.listForChat（tRPC）   → messages（React Query 缓存）
③ optimistic（本地乐观气泡）    → 临时 user 气泡
```

同步手段是：

- `utils.message.listForChat.invalidate()` → 触发 refetch → 整页替换
- 若干 `useEffect` 在「流结束 / SSE 事件 / 切会话」时手动清理 optimistic / streamingContent
- 子会话还靠 `listRunning` + `pullAgentMessages` 间接发现「服务端已写消息」

**结果：**

- 消息已经在 DB，但前端还在等 invalidate → **需刷新**
- invalidate 回来时列表 key / pages 变化 → **闪烁**
- optimistic 与 DB 消息短暂并存或先后清空 → **闪一下空**
- 子 Agent `triggerAgentRun` 写 user 消息时，前端 SSE 未必 invalidate 到正确 session → **消息不出现**

### 1.3 根因 B：`SessionStreamState` 是个「大杂烩 Map」

旧 `streamStatesRef: Map<sessionId, SessionStreamState>` 把三类完全不同的东西塞进同一个对象：

| 类别 | 字段举例 | 生命周期 |
|---|---|---|
| 流式过程 | `isStreaming`, `streamingContent`, `liveTimeline`, `lastEventId`, `connected` | 一轮 Agent run |
| 视图过渡 | `optimistic`, `streamTargetUserId`, `error` | 发送前后几秒 |
| 队列 | `userQueue`, `asyncOverlays`, `consumedDeliveries`, `queueDraining` | 跨多轮、可持久化 |

再用：

- `applyView(sid)`：切会话时把 Map 镜像到一堆 `useState`
- `ssSet(sid, key, value)`：万能写入器，既改 Map 又按「是否当前视图」同步 useState

**问题：**

1. **语义不可读**：`ssSet` 看不出是 set stream state 还是 set session something；新人无法从名字知道副作用范围。
2. **切会话 = 整表镜像**：`applyView` 一次 `setState` 十几个字段 → 必然闪。
3. **清理时机不一致**：`onDone` / `onError` / Abort / 「DB 已匹配」四个地方各自清 `streamingContent` / `liveTimeline` / `optimistic`，容易漏清或双清。
4. **多会话隔离靠约定**：闭包捕获 `originSid` + `ssSet` 只更新「当前视图」——正确，但分散在 400+ 行 `runStream` 里，无法用状态机图表达。

### 1.4 根因 C：服务端「写了消息」≠「前端知道」

消息写入点很多：

- `agentStream` 主对话写 user / assistant
- `triggerAgentRun` 子 Agent 写任务 user + 最终 assistant
- `asyncJobManager` 异步任务写子会话消息
- 用户侧 `message.create` / `delete` / 版本切换 `switchVersion`（update）

旧方案依赖前端在各种 SSE（`session_run_started` / `async_delivery` / `subagent_session_update`）里 **猜**「该 invalidate 哪个 session 的 listForChat」。猜错或漏推 → 丢消息。

**正确模型应是：写库成功 → 立刻广播「这条消息」本身，而不是广播「你去自己再查一遍」。**

### 1.5 根因 D：补丁式演进的累积

历史上每次修一个症状就加：

- 一个 `refetchInterval`
- 一处 `invalidate`
- 一个 `useEffect`
- 一个 `ssSet` 分支

于是 `chat.tsx` 膨胀到 ~3500 行，26+ 个 effect，**局部正确、全局不可推理**。这正是「不能再打补丁」的原因。

### 1.6 命名问题（你明确要求）

| 旧名 | 为什么烂 |
|---|---|
| `ssSet` | 双字母缩写，看不出 set 什么、副作用是什么 |
| `st` / `sst` / `finSt` | 局部变量无语义 |
| `applyView` | 像「渲染」，实际是「把后台 Map 镜像到 React state」 |
| `getStreamState` | 其实还含队列 / abort，不是纯 stream |
| `messagesInfinite` 兼容 shim | 为了少改调用点而伪造对象，**就是补丁** |

新架构里所有公开符号必须可读：`setStreamingContent`、`appendThinkingDelta`、`hydrateSessionMessages`、`beginStream`、`completeStream`。

---

## 2. 新架构总览

```text
┌─────────────────────────────────────────────────────────────────┐
│                         服务端                                   │
│  MessageService.create/delete                                    │
│       │                                                          │
│       ▼                                                          │
│  SessionStreamHub.pushExternalEvent                              │
│       │  message_upserted / message_deleted（带完整 message）      │
│       │  （已有 async_* / session_run_started / agent_message…）   │
│       ▼                                                          │
│  /api/agent/async-stream  →  EventSource                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         前端                                     │
│                                                                  │
│  ┌─────────────────────┐  ┌──────────────────────┐               │
│  │ SessionMessageStore │  │ StreamLifecycleStore │               │
│  │ （消息唯一真相源）    │  │ （流式状态机）         │               │
│  │ hydrate + upsert    │  │ idle→streaming→done  │               │
│  │ + delete via SSE    │  │ /error               │               │
│  └─────────┬───────────┘  └──────────┬───────────┘               │
│            │ useSyncExternalStore    │ useSyncExternalStore      │
│            ▼                         ▼                           │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ ChatView（编排层）                                         │    │
│  │  - 只订阅当前 sessionId 的 messages + lifecycle            │    │
│  │  - 队列 / optimistic 用语义清晰的局部 state + 小 hook      │    │
│  │  - runAgentStream：只 dispatch 状态机 action，不散落 setState│  │
│  └──────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

三层互不替代：

| 层 | 管什么 | 不管什么 |
|---|---|---|
| MessageStore | DB 已持久化的 ChatMessage 列表 | 正在打字的 token、思考过程 |
| LifecycleStore | 这一轮 run 的 phase / 内容 / timeline / 续传游标 | 历史消息、发送队列 |
| SessionQueue（局部） | 用户待发队列、异步 overlay、乐观气泡 | DB 消息、SSE 历史 |

---

## 3. 模块一：消息单一真相源（Session Message Store）

### 3.1 要改什么地方

| 位置 | 原来 | 改成 |
|---|---|---|
| 服务端 `MessageService.afterCreate` | 只 bump session.updatedAt + eventBus | **额外** `pushExternalEvent(sessionId, message_upserted)`，payload 含完整消息 |
| 服务端 `MessageService.afterDelete` | 无前端推送 | `pushExternalEvent(sessionId, message_deleted)` |
| `AgentStreamEvent` 类型 | 无 message_* | 增加 `message_upserted` / `message_deleted` |
| 前端 `message.listForChat.useInfiniteQuery` | 作为日常刷新主路径 + 大量 invalidate | **仅**首次 hydrate + 向上翻历史 + 断线兜底 |
| 前端 SSE 监听 | 收到业务事件就 `listForChat.invalidate` | 收到 `message_upserted` **直接 upsert**；业务事件只管 listRunning / 队列统计等 |
| `switchVersion`（update 非 create） | invalidate 列表 | 单独：mutation 成功后 **主动 hydrate** 或服务端对 update 也推 upserted |

### 3.2 设计为什么这样

**推「完整消息」而不是「请你 refetch」**，原因：

1. **延迟**：refetch 至少一轮 RTT；SSE 推完整对象可立即渲染。
2. **闪烁**：refetch 会替换整个 infinite query pages；upsert 只改一条，Virtuoso key 稳定。
3. **正确性**：所有写库路径（主对话 / 子 Agent / 异步任务）都走 `MessageService.create`，**一处钩子覆盖全部**，不会漏某个 triggerAgentRun。
4. **教学意义**：符合「事件溯源 / 推送优先」的清晰模型，比「轮询 + invalidate 拼图」更好讲。

### 3.3 优秀之处

- **单一写入钩子**：不用改 `agentStream` / `asyncJobManager` / `nativeTools` 每一处 create。
- **与现有 SessionStreamHub 契合**：`pushExternalEvent` 已保证推到 `async-stream` 的 externalSubs（此前已修「只进 Agent 流、前端收不到」）。
- **断线可恢复**：SSE 丢事件时，用 `hydrate`（拉最近一页 merge）兜底，而不是日常路径依赖 hydrate。

### 3.4 可能的问题与对策

| 风险 | 对策 |
|---|---|
| SSE 在消息写入前未订阅该 session | `watchSession(sessionId)`：父会话监听子会话；`session_run_started` 时立刻 watch |
| 事件乱序 / 重复 | upsert 按 `message.id` 幂等；同 id 内容未变则跳过 setState |
| `switchVersion` 是 update | 要么 afterUpdate 也推 upserted，要么前端 mutation 后 hydrate 一次（明确标注为「非 create 路径」） |
| 历史翻页与实时 upsert 冲突 | hydrate 合并策略：保留已加载的更早页 + 用服务端最近页覆盖近期；按 `createdAt` 排序 |
| 双 EventSource（chat 业务 SSE + MessageStore SSE） | 中期合并为**一个** SessionEventHub 客户端，按事件 type 分发；短期可两路并存但禁止对 messages 再 invalidate |

### 3.5 与本场景适配度

KnowPilot 是**单用户、本地、教学向**，消息量中等，SSE + 内存 store 完全够用，**不需要** CRDT / OT / 向量时钟。适配度：**极高**。

---

## 4. 模块二：流式生命周期状态机（Stream Lifecycle Store）

### 4.1 要改什么地方

| 位置 | 原来 | 改成 |
|---|---|---|
| `streamStatesRef` 里的流式字段 | 与队列混在同一 Map | **拆出**独立模块级 store |
| `isStreaming` / `streamingContent` / `liveTimeline` 等 `useState` | 视图镜像 | 由 `useSyncExternalStore` 订阅当前 session 的 lifecycle |
| `applyView` | 镜像十几个字段 | **删除对生命周期字段的镜像**；切会话只换 `sessionId`，订阅自动切 |
| `runStream` 内散落 set | `ssSet(sid, "streamingContent", …)` | 只调语义动作：`beginStream` / `appendTokenDelta` / `appendThinkingDelta` / `completeStream` / `failStream` |
| 持久化 | 把流式字段塞进同一个 sessionStorage blob | 生命周期单独键（如 `kp:chat-lifecycle-states`），刷新后续传只恢复 `lastEventId` +「是否应 resume」 |

### 4.2 状态机定义（必须写进代码注释 / 文档）

```text
                    beginStream()        commitStream() / tryCommitStream()
         ┌──────────────────────────────────┐                ┌──────────────┐
         │                                  ▼                │              ▼
       idle  ─────►  streaming  ─────►  done  ───────────────► idle
         ▲               │                │
         │               │ failStream()   │ failStream()
         │               ▼                │
         └──────────── error ◄────────────┘
                         │
                         └─ clearError() / commitStream() → idle
```

| Phase | 含义 | UI 表现 |
|---|---|---|
| `idle` | 无进行中的 run | 无流式气泡 |
| `streaming` | 正在收 SSE | 显示 thinking / tool / token |
| `done` | 本轮结束，等 MessageStore 对齐 assistant | 保留过渡 `streamingContent`；**不允许**开新流 |
| `error` | 失败 | 显示错误条 |

**关键转移规则（INV）：**

- **INV-1**：`done → idle` 只能经 `commitStream` / `tryCommitStream`（MessageStore 已承接本轮 assistant）。
- **INV-2**：Compose 仅当 `phase === idle` 才 `consumeQueue` / `beginStream`；`streaming | done` = `isRunOccupied`。
- **INV-3**：过渡 UI（`streamingContent` / `liveTimeline`）在 commit 前不得被新 `BEGIN_STREAM` 清掉；reducer 在 `isRunOccupied` 时拒绝非 resume 的 `beginStream`。
- **INV-4（渲染单一所有权）**：一条 assistant 消息任一时刻只能有一个渲染源。流式期间由 liveTimeline 独占；`message_upserted` 先于 `done` 到达时记入 `inFlightAssistantId`，渲染层屏蔽 MessageStore 中同一条消息的 stored 渲染，直到 commit 后由 MessageStore 独占。见 §13。
- **INV-5（挂接进度一致性）**：向运行中会话挂接 SSE 时，`resumeAfter` 必须与本地已有进度一致——本地无任何进度（服务端启动的运行）必须从 0 全量重放事件缓冲；本地有进度（断线重连）才接在本地 `lastEventId` 之后。见 §13。

1. `beginStream`：清内容（非 resume）、设 `streamTargetUserId`、phase=`streaming`、`connected=true`。**非 resume 且 isRunOccupied 时 no-op**（开发期 console.error）。
2. `completeStream(content, { assistantMessageId })`：phase=`done`，保留 content 供过渡，写入 `pendingAssistantMessageId`；MessageStore 出现同 id assistant → `tryCommitStream` → `commitStream` → idle。
3. `commitStream` / `tryCommitStream`：清 timeline/content/pending → `phase=idle`；通知 `onStreamCommitted` 监听器（Compose 挂载 `drainAllPendingQueues` 的唯一钩子）。
4. `failStream(message)`：phase=`error`，清 timeline/content；编排层随后 `commitStream` 释放占用，error 字段保留供 UI。
5. `migrateStreamSession(tempKey → realSessionId)`：新会话首条消息尚无 id 时用临时键，收到 `session_start` 后整体迁移。

### 4.3 为什么用状态机而不是继续 Map+ssSet

1. **可推理**：任意时刻 phase 唯一；禁止「isStreaming=true 但 content 残留上次」这类非法组合（由 reducer 保证）。
2. **副作用集中**：进入/离开 phase 的清理在 reducer 或少量 transition 函数里，而不是 4 个回调各清一遍。
3. **多会话仍成立**：store 仍是 `Map<sessionId, LifecycleState>`，但**写入只能通过命名 action**，不能 `ssSet(anyKey)`。
4. **教学清晰**：状态图可画在文档里，学生/自己半年后还能看懂。

### 4.4 API 命名（强制语义化）

禁止：`ssSet`、`st`、`lvSet`、`applyView`（用于流式）。

推荐公开面：

| 动作 | 名称示例 | 含义 |
|---|---|---|
| 开始一轮 | `beginStream({ sessionId, targetUserMessageId, resume })` | 进入 streaming（occupied 时拒绝） |
| 追加 token | `appendTokenDelta(sessionId, delta)` | 合并 rAF 后写入 |
| 思考增量 | `appendThinkingDelta(sessionId, delta)` | 更新 timeline |
| 工具起止 | `markToolRunning` / `markToolDone` | timeline 工具步 |
| 正常结束 | `completeStream(sessionId, finalContent, { assistantMessageId })` | → done + pending |
| 提交到 MS | `tryCommitStream(sessionId, { messageId, content })` | done→idle（匹配 pending） |
| 强制提交 | `commitStream(sessionId)` | done/error→idle（abort/空回复） |
| 失败 | `failStream(sessionId, errorMessage)` | → error |
| 释放占用 | `onStreamCommitted(cb)` | Compose drain 的唯一钩子 |
| 临时键迁移 | `migrateStreamSession(fromKey, toSessionId)` | 新会话首条 |

组件侧：

```text
const { phase, streamingContent, liveTimeline, … } = useStreamLifecycle(sessionId)
const isStreaming = phase === "streaming"
```

### 4.5 可能的问题

| 风险 | 说明与对策 |
|---|---|
| `runStream` 仍很长 | 状态机只收拢「状态」；网络 IO 仍在 `streamAgentChat`。下一步可把 callbacks 编成「事件→action」表，但**第一刀**先拆 store |
| resume / 多会话 | 必须保留 `lastEventId` + `AbortController`（abort 可仍挂在 session 级资源表，不必塞进 lifecycle phase） |
| rAF 合并 token | 保留「pending delta + requestAnimationFrame」作为 **StreamTokenBuffer** 小模块，不要塞回万能 setter |
| 切会话闪烁 | 不再 `applyView` 镜像；订阅 key 随 `sessionId` 变，React 只重渲染订阅切片 |

### 4.6 适配度

Agent Chat + 工具时间线 + 断线续传，**天然适合有限状态机**。比 Redux 全家桶轻，比散落 useState 严。适配度：**高**。

---

## 5. 模块三：队列与乐观气泡（Session Compose State）

### 5.1 要改什么地方

这类状态**不要**进 MessageStore，也**不必**进 LifecycleStore：

- `userQueue`（待发送用户 / 上级消息）
- `asyncOverlays`（异步任务进度条）
- `consumedDeliveries`
- `optimistic`（发送瞬间的假 user 气泡）
- `AbortController` / `queueDraining` / `activeQueueTaskId`

建议：`useSessionComposeState(sessionId)` 或继续用 per-session Map，但 **API 必须语义化**：

- `enqueueUserMessage`
- `dequeueNextReadyItem`
- `pinAsyncOverlay` / `dismissAsyncOverlay`
- `addOptimisticUserBubble` / `removeOptimisticUserBubble`
- `setActiveAbortController`

### 5.2 为什么单独一层

1. 队列与「DB 消息」生命周期不同（可未落库、可跨 run）。
2. 乐观气泡只存在于 `idle→streaming` 过渡；`completeStream` 后由 MessageStore 的真实消息替代。
3. 避免再造一个 `SessionStreamState` 大杂烩。

### 5.3 与消息 store 的协作

```text
用户点发送
  → addOptimisticUserBubble
  → beginStream
  → 服务端 message.create → message_upserted
  → MessageStore upsert 真实 user
  → removeOptimisticUserBubble（按 clientMessageId / 内容匹配）
  → … token …
  → completeStream
  → message_upserted(assistant)
  → clearStreamingUi（当 store 中 assistant 内容已对齐）
```

**禁止**再用 `invalidate listForChat` 来「发现」这两条消息。

---

## 6. ChatView 编排层怎么变（不写大段代码，只写职责）

`chat.tsx` 应退化成编排器：

| 保留 | 迁出 / 删除 |
|---|---|
| 布局、面板宽度、历史列表 UI | `messagesInfinite` 兼容对象（**禁止 shim**） |
| 选择 session / agent / workspace | 对 messages 的一切 `invalidate`（除明确兜底 hydrate） |
| 调用 `runAgentStream` | `ssSet` / `applyView` 对流式字段的镜像 |
| 订阅两个 store + compose hook | 「为兼容而伪造的 messagesInfinite.isLoading 等」 |

加载态语义改为：

- `isMessagesHydrated`：MessageStore 是否已拉过首屏
- `isStreaming`：`phase === "streaming"`
- `hasOlderMessages` / `loadOlderMessages`：翻历史

**不要**用假对象伪装成 React Query infinite query。

---

## 7. 服务端侧还需对齐的点（架构层，非补丁清单）

### 7.1 `async_task_run` 的 `mode`（已定位）

- **问题**：权限要求子 Agent `mode=tool`，但工具 schema 未暴露 `mode`/`toolCall` → LLM 无法传 → 死循环提示。
- **改法**：schema 声明 `mode` + `toolCall`；description 写清子 Agent 必须用 tool。
- **架构含义**：工具契约必须与权限守卫一致——**契约即文档**。

### 7.2 `spawn_subagent` + `waitForResult`

- **问题**：曾过早返回「第一轮回复」而非最终 report_back。
- **改法**：跟踪 Task 直到 success/failed（此前已部分落地）。
- **与记忆相关**：最终结果再进父上下文，避免中间态污染。

### 7.3 记忆系统（另文，但同属「上下文架构」）

见 `docs/development/memory-research-plan.md`。与本聊天架构的交点：

- inspect 默认不 dump experience
- compact 前 memoryFlush
- 分层记忆避免「错误记忆驱动错误思考」

消息推送架构解决 **UI 一致性**；记忆架构解决 **LLM 上下文正确性**——两条线，不要混成一个大补丁。

---

## 8. 为什么选这套，而不是其他方案

### 8.1 对比候选

| 方案 | 做法 | 否决/采纳理由 |
|---|---|---|
| A. 继续 invalidate + 多加 effect | 最快止血 | **否决**：补丁堆叠，闪烁与竞态无法根治 |
| B. 全面上 Redux / Zustand 全局 store | 一个大 store | **过重**：单用户 Chat 不需要全局 action 日志；且易再变成大杂烩 |
| C. 仅 React Query 乐观更新 | setQueryData 补消息 | **半吊子**：流式 token / timeline 仍无家；切会话仍靠 queryKey 闪 |
| D. **MessageStore(SSE) + Lifecycle 状态机 + Compose 局部**（本文） | 按生命周期拆分 | **采纳**：贴合 SSE 已有基建；教学清晰；改动面可控 |
| E. 服务端推「全量 messages 快照」每轮 | 简化前端 | **浪费带宽**；Virtuoso 大数据重渲染更差 |

### 8.2 优秀之处（相对 KnowPilot 定位）

1. **本地优先 / 教学向**：事件驱动 + 显式状态机，文档可画图，适合「学着写 Agent 产品」。
2. **复用现有 Hub**：不必上 WebSocket 新协议；扩展 SSE 事件类型即可。
3. **单用户**：无冲突合并复杂度。
4. **与 Swarm 契合**：父 watch 子 session、子消息实时出现，正是多 Agent UI 所需。

### 8.3 适配度评分（主观）

| 维度 | 分（1–5） | 说明 |
|---|---|---|
| 解决丢消息 / 需刷新 | 5 | 写库即推消息 |
| 解决闪烁 | 4–5 | 消除 list 整页 refetch；切会话不再整表 applyView |
| 解决子 Agent 卡死感 | 4 | 需配合 watchSession + session_run_started；状态机保证 resume 清晰 |
| 实现成本 | 3 | chat.tsx 仍需大手术；但可分 PR |
| 回归风险 | 3 | E2E（resume / subagent / queue）必须全绿 |
| 可维护 / 可读 | 5 | 语义化 API + 状态图 |

---

## 9. 落地顺序（仍然是架构步骤，不是补丁清单）

### Phase 1 — 消息真相源（收益最大，建议先合）

1. 服务端 `message_upserted` / `message_deleted`
2. 前端 MessageStore + 去掉 messages 路径上的 invalidate
3. 禁止 `messagesInfinite` 兼容 shim：调用点改为 `isMessagesHydrated` / `loadOlderMessages`

**验收：** 子 Agent 收任务 / 回传时，不刷新也能看到气泡；发送时无明显整表闪烁。

### Phase 2 — 流式状态机

1. LifecycleStore + 语义化 action
2. `runAgentStream` 只 dispatch action
3. 删除 `ssSet` 与对流式字段的 `applyView`
4. Token buffer 独立小模块

**验收：** 切会话不闪流式区；resume 仍可用；无「双气泡 / 空白一瞬」。

### Phase 3 — Compose 队列语义化

1. 队列 / optimistic / abort 独立 hook
2. 命名全面语义化
3. 合并双 EventSource（可选）

**验收：** 异步队列与消息列表不再互相 invalidate 拖垮。

### Phase 4 — 记忆与工具契约（并行轨道）

按 `memory-research-plan.md` + `async_task_run` schema 对齐。

---

## 10. 明确「什么不叫架构重构」

以下行为视为继续打补丁，**本设计拒绝**：

1. 为少改调用点而伪造 `messagesInfinite = { isLoading, fetchNextPage, … }`
2. 保留 `ssSet(sid, anyKey, anyValue)` 作为唯一写入口
3. 再加一个 `useEffect`「某某事件来了就 invalidate listForChat」
4. 把队列、流式、消息再塞回同一个 `SessionStreamState`
5. 用不透明缩写命名核心 API

---

## 11. 与当前仓库已有进度的关系

| 已有 | 定位 |
|---|---|
| `MessageService` 推 SSE + `useSessionMessages` 草案 | **Phase 1 方向正确**，应作为正式方案完善（去掉任何兼容 shim） |
| `useStreamLifecycle` 草案 | **Phase 2 方向正确**，但不得用 `ssSet` 路由器「偷偷转发」——那是伪重构 |
| chat.tsx 内未完成的 ssSet 迁移 | **应丢弃该迁移策略**，按本文 Phase 2 重做：调用点改为语义化 action，而不是万能 setter |

---

## 12. 总结：新架构一句话

**服务端写消息就推消息；前端用 MessageStore 收消息；用显式 StreamLifecycle 管「这一轮在干什么」；用 Compose 管「还没进 DB 的队列与乐观 UI」。三者用可读的英文全名通信，禁止万能缩写 setter。**

这才是和 KnowPilot「自用 + 教学 + Swarm」场景匹配的架构，而不是在 3500 行 `chat.tsx` 上继续叠 effect。

---

## 13. 架构复盘（2026-07-12）：闪烁 / 卡空 Thinking / 需刷新的两个根因与两条新不变量

> 三层 Store 拆分后仍出现「进子 Agent 会话卡空 Thinking」「正式回复先出现、闪烁后完整时间线重建」「report_back 后父会话卡住需刷新」。
> 复盘结论：**数据层职责是对的，但缺了两条跨层契约**——渲染所有权、挂接进度一致性。补上后这类症状是「违反不变量」而不是「又一个待修 bug」。

### 13.1 根因 A：双渲染源竞态（→ INV-4）

**现象**：正式回复先出现，done 后闪烁一下，完整回复（思考 + 工具调用）重建。

**机制**：服务端在发 `done` 事件**之前**就持久化 assistant 消息并广播 `message_upserted`。
MessageStore SSE 是独立连接、无 token 缓冲，通常**先于** agent 流的 `done` 到达。于是流式期间：

```text
liveTimeline（流式块）          ← 渲染源 ①
messageGroups（MessageStore）  ← 渲染源 ②（assistant 提前进组）
```

两个渲染源同时显示同一条消息 → done → commit → live 块从 Virtuoso 列表移除（列表项数变化）→ 布局跳动 + stored timeline 重建 = 闪烁。

**修复（INV-4：渲染单一所有权）**：

1. `useSessionMessages.tryCommitAfterAssistant`：upsert 时 `tryCommitStream` 失败（phase 仍 `streaming`）→ `markInFlightAssistant(sessionId, messageId)`。
2. `useStreamLifecycle`：新增 `inFlightAssistantId` 字段 + `MARK_INFLIGHT_ASSISTANT` action（仅 occupied 期生效）；`COMMIT_STREAM` / `FAIL_STREAM` 清空。
3. `chat.tsx` 渲染层：组的 `assistantMessage.id === inFlightAssistantId` 时，该组由 live 块**原位**渲染（stored timeline + 气泡不渲染），且尾部 `live-trailing` 列表项不再追加。

**为什么这样修**：live→stored 的切换发生在**同一个 Virtuoso 列表项内部**，React 按组件类型 reconcile（ThinkingTimeline → ThinkingTimeline），无列表项增删 → 无重排 → 无闪烁。数据层不动（MessageStore 照常收消息），只约束「谁来渲染」。

**好处**：以后任何「消息提前到 / 晚到 / 重复到」都不会造成双渲染——渲染权由状态机决定，与网络时序解耦。新增消息通道（如未来的 WebSocket）也不需要改渲染逻辑。

### 13.2 根因 B：挂接进度与本地状态脱节（→ INV-5）

**现象**：进入正在运行的子 Agent 会话卡空 Thinking（sleep 20s 期间无任何内容）；report_back 后父会话被 autoConsume 启动同样卡住；结束后才闪烁重建。

**机制**：服务端自己启动的运行（子 Agent `triggerAgentRun`、父会话 `autoConsumeAsyncDelivery`），前端本地 StreamLifecycle 对这条流一无所知。发现机制 `listRunning` → effect 挂接时用了 `resumeAfter: item.lastEventId`（服务端事件流的**尾巴**）——已发生的 `round_start` / `thinking` / `tool_start` 全部跳过：

- 本地 liveTimeline 空 → 空 Thinking 转圈，直到下一个新事件（sleep 20s = 卡 20s）。
- done 时本地只有 content → 正式回复先出现 → hydrate 拉到完整消息 → 闪烁重建（与根因 A 叠加）。

**修复（INV-5：挂接进度一致性）**：`chat.tsx` 的 `listRunning` 挂接 effect——

```text
本地无该运行任何进度（phase 非 streaming 或 timeline 空）→ resumeAfter = 0（全量重放 ring buffer）
本地已有进度（断线重连）→ resumeAfter = 本地 lastEventId（避免重复拼接）
```

服务端 `hub.subscribe(sessionId, 0, …)` 天然支持全量重放；运行已结束时 GET resume 会收到显式 `done`（此前已修：服务端结束的 session 必须发 done 再关连接，防止前端重连循环卡 Thinking）。

**好处**：「前端知道多少」和「从哪儿开始接」永远一致。以后新增任何服务端自启动的运行类型（心跳、定时任务触发的会话），只要走 `listRunning` 发现，就自动获得完整时间线，不需要每种来源单独处理。

### 13.3 这两条不变量如何减少未来打补丁

| 未来症状 | 旧做法（补丁） | 新做法（查不变量) |
|---|---|---|
| 又出现双气泡 / 闪烁 | 找时序、加 setTimeout / flushSync | 查「谁违反了 INV-4：是不是有第二个渲染源在 occupied 期渲染了 in-flight 消息」 |
| 又出现空 Thinking / 需刷新 | 加轮询、加 invalidate | 查「谁违反了 INV-5：挂接时 resumeAfter 是不是和本地进度脱节」 |
| 新增消息来源（新 SSE 事件 / 新运行类型） | 每处单独处理渲染与挂接 | 数据进 MessageStore、渲染权走 INV-4、挂接走 INV-5，零新增渲染逻辑 |
