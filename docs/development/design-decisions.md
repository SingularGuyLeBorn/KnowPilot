# Agent 消息投递与队列设计决策

> 本文件合并了原 `swarm/` 下的三轮设计讨论，遵循 `AGENTS.md` 的「设计决策 Q&A 流程」。
> 约定：不写回答 = 默认同意推荐方案；写了回答 = AI 需调整后再确认。

# Agent 间消息与子 Agent 结果投递设计决策

> 本文件遵循 `AGENTS.md` 的「设计决策 Q&A 流程」。
> **约定**：不写回答 = 默认同意推荐方案；写了回答 = AI 需调整后再确认。

---

## 问题 1：非阻塞式子 Agent 的结果在父会话里如何展示？

**场景**：父 Agent 调用 `spawn_subagent(waitForResult=false)`，创建子 Agent 并下发任务。子 Agent 完成后，父会话里应该怎么呈现这个结果？

**推荐方案**：

1. 父 Agent 调用 `spawn_subagent(waitForResult=false)` 后，后端创建子 Agent，把任务内容写入子 Agent 的 `AgentMessage` 收件箱。
2. 子 Agent **自动消费**这条消息并运行（在后台运行，不依赖前端是否打开子会话）。
3. 子 Agent 完成后，通过异步投递机制把最终结果推送到**父 Agent 当前会话的异步任务结果队列**（`asyncResultQueue`）。
4. 父会话里：
   - 结果以 **右侧 user 气泡** 形式出现。理由：父 Agent 是接收方，子 Agent 发给父 Agent 的消息和“我发给父 Agent 的消息”等价。
   - 气泡上方/内部带特殊来源标识：
     - 子 Agent 结果用英文标签 **SubAgent** + 子 Agent 名字/任务名，配 SVG icon。
     - 普通异步任务用英文标签 **Sync** + 任务类型，配 SVG icon。
   - 提供“打开子 Agent 对话”入口：
     - 在右侧气泡上可直接点击跳转；
     - 也可以在左侧 panel 的「子 Agent」标签页里继续对话。
5. 非子 Agent 的普通异步任务（如 `async_task_run` 执行的 shell/bash 脚本）也走同样逻辑：结果进入父会话异步队列，消费后以右侧 user 气泡出现，带对应任务类型标识（shell / bash / 脚本名等）。

**疑问**：

- `AgentMessage` 收件箱是和用户发送的 `userQueue` 同一个东西吗？
- 子 Agent 结果“如何投递”到父会话的异步队列？

**回答**：

- 不是。`AgentMessage` 是数据库层 Agent 间邮箱；前端 `userQueue` 是会话级发送队列。两者分层不同。
- 投递方式：子 Agent 运行完成后，后端创建一个异步投递记录（async delivery），目标为父 Agent 的当前 `sessionId`；前端通过 `pullAsyncQueue` 轮询到该投递，进入 `asyncResultQueue`；`consumeQueue` 消费时生成右侧 user 气泡。

---

## 问题 2：阻塞式子 Agent 的结果在父会话里如何展示？

**场景**：父 Agent 调用 `spawn_subagent(waitForResult=true)`，子 Agent 同步运行并立即返回结果。

**推荐方案**：

1. 父 Agent 调用 `spawn_subagent(waitForResult=true)` 后，同样先把任务写入子 Agent 的 `AgentMessage` 收件箱。
2. 与 non-blocking 不同的是，父 Agent **同步等待**子 Agent 消费并运行完成，拿到最终结果。
3. 这个结果**不进入异步任务队列**，也**不单独显示为右侧气泡**。
4. 它作为本次工具调用的结果直接返回给父 Agent，由父 Agent 自己消化后在左侧 assistant 气泡里给出最终回复。
5. 这次工具调用作为运行记录出现在**左侧时间线 / Async 面板**里（仅追溯，不消费）。

**回答**：

- 两种模式底层都会调用 `agent_send_message` 把任务写进子 Agent 收件箱。
- 阻塞式父 Agent 会同步等待子 Agent 跑完，子 Agent 的返回内容直接作为 `spawn_subagent` 这个工具调用的结果返回给父 Agent LLM；**不写入父会话 ChatMessage**。
- 非阻塞式父 Agent 不等待，工具调用立即返回“已派生/已排队”；子 Agent 的结果后续通过异步投递进入父会话。

---

## 问题 3：左侧 Async 面板与右侧 Runtime/异步任务队列的职责划分？

**推荐方案**：

| 面板 | 展示内容 | 是否触发消费 |
| --- | --- | --- |
| 左侧 Async 任务列表 | 本次对话里发生过的**所有**工具/子 Agent 运行记录：运行中、已完成、阻塞式子 Agent、shell 脚本、普通工具调用等 | 否，仅追溯 |
| 右侧 Runtime / 异步任务队列 | 只展示**已完成但尚未被消费**的异步结果（会进入右侧气泡的任务） | 是 |

**疑问**：

- 右侧队列是否也展示运行中的任务？

**回答**：

- 不展示。运行中的任务只出现在左侧 Async 面板作为运行记录；等任务完成后，如果它属于“异步结果”类型，才进入右侧 Runtime/异步任务队列等待消费。

---

## 问题 4：子 Agent 会话里父 Agent 下发的任务如何展示？

**场景**：用户手动打开子 Agent 会话，查看完整对话历史。

**推荐方案**：

- 子 Agent 会话顶部显示子 Agent 名称。
- 父 Agent 下发的任务内容作为第一条 **右侧 user 气泡** 出现。
- 气泡来源标识为“上级 Agent”或“父 Agent 任务”。
- 子 Agent 的回复作为 **左侧 assistant 气泡** 紧随其后。
- 用户可在子 Agent 会话底部继续追问。

**疑问**：

- 父 Agent 如何对一个已存在的子 Agent 继续发消息？
- 每个 subagent 只能有一条会话吗？现在是这么设计的吗？

**回答**：

- 父 Agent 继续使用 `agent_send_message` 工具，指定 `toAgentId` 为已有子 Agent 的 id，新消息会进入该子 Agent 的 `AgentMessage` 收件箱；子 Agent 消费后追加到其主会话的 user 队列。
- 是的，当前设计每个 Agent 只有一条**主会话**（`isMainSession=true`）。所有父 Agent 下发的消息都会进入这条主会话。未来如需“一个子任务一个会话”可以再扩展，但 Phase 1 保持单主会话。

---

## 问题 5：父会话是否需要实时显示子 Agent 的运行进度？

**推荐方案**：

- **Phase 1 不实现实时进度透传到父会话消息流**。
- 子 Agent 在后台运行期间，父会话只在左侧 Async 面板显示一条“SubAgent 运行中”的记录。
- 运行完成后，异步结果以右侧 user 气泡形式进入父会话。
- 如果用户想查看详细过程，点击“打开子 Agent 对话”进入子会话查看完整时间线/导轨。

**疑问**：

- 父会话里实时进度是不是实现起来很困难？

**回答**：

- 是的。当前 Agent 运行是 SSE 流，运行状态绑定到某个会话的流连接上。要让父会话实时显示子 Agent 进度，需要跨会话事件转发或父会话主动轮询子 Agent 的运行事件，改动较大。Phase 1 先只做“运行中记录 + 完成后投递”，后续再考虑实时透传。


---

# Agent Queue 与消息投递设计（v2）

> 本文件遵循 `AGENTS.md` 的「设计决策 Q&A 流程」。
> 承接 `agent-message-delivery.md`，对上轮讨论中的疑问和修正做第二轮细化。

---

## 已修正的共识

### 1. 阻塞/非阻塞不是按 Agent 分类，而是按每次 `spawn_subagent` 调用分类

- 同一个子 Agent，第一次可以被父 Agent 以阻塞方式调用，第二次可以被非阻塞方式调用。
- 阻塞或非阻塞只取决于本次 `spawn_subagent` 的 `waitForResult` 参数。

### 2. 阻塞式结果不进异步队列

- 阻塞式 `spawn_subagent(waitForResult=true)`：子 Agent 运行完成后，结果直接作为本次 `spawn_subagent` 工具调用的结果返回给父 Agent LLM。
- 父 Agent LLM 拿到结果后继续生成最终回复，**不进入父会话的异步任务结果队列**。

### 3. 非阻塞式结果需要子 Agent 显式回报

- 非阻塞式 `spawn_subagent(waitForResult=false)`：子 Agent 运行完成后，需要调用 `agent_report_back`（或同类工具）把结果发到父 Agent 的异步任务结果队列。
- 父会话后续消费这条异步结果，以右侧 user 气泡形式呈现。

---

## 问题 1：用户和上级 Agent 的消息队列如何组织？

**推荐方案**：

- 物理上保持三个队列：
  1. **用户发送队列**（`userQueue`）
  2. **上级 Agent 发送队列**（`superiorQueue`，后端用 `AgentMessage` 持久化）
  3. **异步任务结果队列**（`asyncResultQueue`）
- 但**用户发送队列**和**上级 Agent 发送队列**在 UI 上合并展示：
  - 默认按时间排序。
  - 用户可拖拽调整顺序。
  - 调整后的顺序持久化，刷新不丢失。重启也不丢失
- **异步任务结果队列**优先级最高：
  - 消费顺序上，`asyncResultQueue` > `userQueue + superiorQueue`。
  - 即使上级消息或用户消息排在前面，只要异步任务结果到达，也优先消费异步结果。

**疑问**：

- “保留 `AgentMessage` 作为后端持久层，但不再对用户隐藏”是什么意思？
- 上级消息直接进 `userQueue`，那后台持久化靠什么？`userQueue` 不是持久化的吗？

**回答**：

- `AgentMessage` 是数据库表，专门存 Agent 之间的消息，后端不会因为浏览器关闭而丢失。
- 前端 `userQueue` 当前只是一个 React state / sessionStorage，关闭页面就会丢（除非我们做持久化）。
- “不再对用户隐藏”的意思是：打开子 Agent 会话时，把 `AgentMessage` 里 pending 的上级消息取出来，渲染到发送队列里，让用户能看到“父 Agent 给我发了什么任务”。
- 后台持久化还是靠 `AgentMessage`；前端展示的是它的镜像。用户调整顺序后，我们再把这个顺序写回 DB（比如存到 Agent 或 Session 的 queueOrder 字段里）。

⏳ 这样设计可以吗？

回答：userquue算了不做持久化了 . 那agentmessage为什么也要做持久化? 

---

## 问题 2：子 Agent 的哪些回复应该自动发给父 Agent？

**场景**：

- 父 Agent 非阻塞派生子 Agent 执行任务。
- 子 Agent 运行完调用 `agent_report_back` 把结果发给父 Agent。
- 之后用户主动打开子 Agent 会话，跟子 Agent 闲聊了几句。
- 这些闲聊的回复也要发给父 Agent 吗？

**推荐方案**：

- **子 Agent 自行判断**：只有子 Agent 显式调用 `agent_report_back` 时，才把内容发到父 Agent 的异步任务结果队列。
- 普通闲聊回复（用户问、子 Agent 答）**不自动**发给父 Agent。
- 系统不会自动把子 Agent 的每条 assistant 回复都推给父 Agent，避免父会话被刷屏。

**疑问**：

- 如果用户希望某条闲聊内容也同步给父 Agent，怎么办？

**回答**：

- Phase 1 先不自动同步闲聊。
- 未来可以扩展：子 Agent 的 `agent_report_back` 工具允许带上 `forwardToParent: true`，或者用户手动点击“转发到父会话”。

⏳ 这样设计可以吗？

回答：子 Agent 的 `agent_report_back` 工具允许带上 `forwardToParent: true` 这本来就是子agent用于发送给父agent的工具 为什么还要有个参数控制? 

---

## 问题 3：异步任务结果队列的消费机制是什么？

**推荐方案**：

- 异步任务（`async_task_run`、非阻塞子 Agent、shell 脚本等）完成后，后端生成一条 delivery 记录，绑定到父 Agent 的当前 `sessionId`。
- 前端通过某种机制拿到 delivery，进入 `asyncResultQueue`。
- `consumeQueue` 优先消费 `asyncResultQueue`：
  - 如果当前没在流式，就把 delivery 作为 user 消息喂给 Agent，走 `runStream`。
  - Agent 拿到结果后继续生成最终回复（左侧 assistant 气泡）。
- 异步任务结果**默认自动消费**，不需要用户手动点“消费”。

**疑问**：

- 用户能不能取消/延后某条异步结果的消费？

**回答**：

- Phase 1 默认自动消费。
- 如果需要延后，可以在 UI 上把某条结果“钉住”（pinned），pinned 的项排在最后，等用户取消 pin 后再消费。

⏳ 这样设计可以吗？

回答：在 UI 上把某条结果“钉住”（pinned），pinned 的项排在最后，等用户取消 pin 后再消费。 不要作为后续 要现在就实现 

---

## 问题 4：能不能把轮询改成主动推送？

**当前**：前端轮询 `pullAsyncQueue` 拉取异步任务状态。

**推荐方案**：

- 可以改成**推送**，但需要分场景：
  1. **父会话有活跃 SSE 流时**：后端在创建 delivery 的瞬间，直接通过该 SSE 连接推送一个 `async_delivery` 事件，前端立刻插入 `asyncResultQueue`。
  2. **父会话没有活跃 SSE 流时**（页面关闭、用户在看别的会话）：推送无法到达，必须依赖持久化 + 下次连接时拉取（可以叫“推优先、拉兜底”）。
- 其他目前还在轮询的地方：
  - `pullAgentMessages`（Agent 间消息轮询）
  - `session.listRunning`（运行中会话轮询）
  - `session.listChildren`（子会话列表轮询）
  - `listRunningAsyncJobs` / `listQueuedAsyncJobs`（异步任务运行状态轮询）
- 这些都可以逐步改成 SSE 推送，但 Phase 1 建议先把 `pullAsyncQueue` 改成推优先，其他后续再迭代。

**疑问**：

- 推送失败/丢事件怎么办？

**回答**：

- 每条事件带自增 ID，前端记录最后收到的事件 ID。
- 重连时前端上报 `lastEventId`，后端补推缺失事件。
- 如果长时间离线，前端 fallback 到 `pullAsyncQueue` 拉取全量未消费 delivery。

⏳ 这样设计可以吗？

回答：我觉得可以的 保持业内优秀实践

---

## 问题 5：队列持久化的范围

**推荐方案**：

- **必须持久化**：
  - 上级 Agent 发送队列（`AgentMessage` 表）
  - 异步任务结果 delivery 记录（已有表）
  - 用户/上级合并队列的顺序（新增字段，存到 `ChatSession` 或独立 `sessionQueue` 表）
- **可暂不持久化**：
  - 用户正在输入但还没发送的草稿（继续用 localStorage 即可）
  - 流式过程中的临时状态（如 `streamingContent`、`liveTimeline`，用 sessionStorage 做刷新恢复即可）

**疑问**：

- 队列顺序持久化会不会每次调整都写 DB，太频繁？

**回答**：

- 调整顺序时 500ms 防抖写 DB。
- 如果 500ms 内多次调整，只写最后一次。

⏳ 这样设计可以吗？

回答：如果要持久化 那就肯定是 agentmessage和userqueue一起持久化了 不然顺序 持久化干什么?


userqueue是否持久化 和 agentmessage是否持久化 需要更细致的讨论


---

# 用户队列与 AgentMessage 持久化设计

> 本文件遵循 `AGENTS.md` 的「设计决策 Q&A 流程」。
> 承接 `queue-design-v2.md`，针对持久化问题做第三轮细化。

---

## 上一轮回答的整理

### 1. `agent_report_back` 不需要额外参数

- `agent_report_back` 本身就是子 Agent 主动给父 Agent 发消息的工具。
- 不需要 `forwardToParent` 参数，调用即转发。

### 2. Pinned 延后消费现在要

- 异步任务结果可以被用户“钉住”（pinned）。
- pinned 的项排在最后，取消 pin 后才被消费。
- Phase 1 就实现。

### 3. 推送方案 OK

- `pullAsyncQueue` 改为“推优先、拉兜底”。
- 父会话有活跃 SSE 流时直接推送 `async_delivery` 事件。
- 无活跃流时 fallback 到拉取/补推。

---

## 问题 1：为什么 `AgentMessage` 必须持久化？

**结论**：`AgentMessage` 是跨会话、跨前端生命周期的 Agent 间邮箱，必须持久化。

回答：同意

---

## 问题 2：`userQueue` 要不要持久化？

**推荐方案**：**B2 新建 `SessionQueueItem` 表**。

回答：B2。消费时同步把关联 AgentMessage 标 consumed。

---

## 问题 3：合并队列的顺序怎么持久化？

**推荐方案**：`SessionQueueItem.order` + 拖拽后 500ms 防抖写 DB。

回答：同意

---

## 问题 4：异步任务结果队列的 Pinned 功能

**推荐方案**：

- 异步结果复用 `Task` 表（没有独立的 `AsyncJobDelivery` 表）。
- `Task.pinned` 字段持久化钉住状态。
- `pullAsyncDeliveries` 只 SELECT 未 delivered 的结果，不 CLAIM。
- 前端 `consumeQueue` 跳过 pinned；消费时再 `ackAsyncDelivery` 标记 delivered。

回答：同意

---

## 问题 5：推送的优先级和范围

**推荐方案**：

- Phase 1：独立 SSE `/api/agent/async-stream` 推送 `async_delivery`；轮询降为 10s 兜底。
- `pullAgentMessages` Phase 1 维持轮询。

回答：同意

---

## 问题 6：阻塞式子 Agent 的结果展示记录

**推荐方案**：

- 阻塞式结果**只作为 tool result 进父 Agent LLM 上下文**。
- **不写入父会话 ChatMessage**（避免幻影 user 气泡 + 消息分组错位）。

回答：同意。阻塞式结果只进 LLM 上下文，不单独显示气泡。

---

## 落地状态（2026-07-11）

| 项 | 状态 |
|---|---|
| A 阻塞式不写 ChatMessage | ✅ |
| B SessionQueueItem 表 + CRUD | ✅ |
| C 消费时同步 AgentMessage consumed | ✅ |
| D Task.pinned + ack 后 CLAIM | ✅ |
| E async_delivery 推优先 + 轮询兜底 | ✅ |

