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

**回答**：我不知道怎么选 → AI 补充详细方案对比（2026-07-15，见下方「方案对比与推荐」）

---

## 问题 G 补充：方案对比与推荐

### 先把现状通道数清楚（2026-07-15 修正版）

> 初版误记为三条通道，经代码核实（`swarm.ts:484-650` + `asyncJobManager.ts:170-240`）修正：`report_back` 与「异步队列气泡」是**同一条管道**——report_back 完成跟踪 Task 后调 `notifyAndAutoConsumeAsyncDelivery`，由 `autoConsumeAsyncDelivery` 原子认领（`updateMany delivered=false→true`，claim 不到即跳过，已有幂等）并插入气泡。`AgentMessage` 只是同一动作顺手写的旁路邮箱/审计记录，**不是投递载具**（这正是它永远 pending 不回写的原因）。

子 Agent「最终结果」到达父会话实际是**两条**路径：

| 通道 | 路径 | 消费语义 | 本次事件中是否出现 |
|---|---|---|---|
| **A. 轮询读取** | 父 Agent 调 `async_task_status` → 读 `task.output` 全文 | **查询消费**（读了内容，不改任何状态） | ✅ 父正式回复引用结果就来自这里（轮询 13 次） |
| **B. 队列消费** | report_back/任务完成 → Task success → `notifyAndAutoConsumeAsyncDelivery` → 原子认领 → 右侧气泡 + INV-8 drain → 触发父新一轮 | **呈现消费**（`delivered=true`，用户可见） | ✅（00:48:10.736 注入触发父第二轮；第二个 task `cmrkvxydx0`） |

去重本质是协调 A 与 B：A 读了全文不改状态，B 不知道 A 读过，照插气泡 → 双份回复。这正对应用户提出的「被查询消费 vs 已作为气泡出现」需要区分。

---

### 方案一：通道分工（单一到达原则）—— AI 推荐 ✅

**思路**：不做状态记账，而是**从根上消除多通道**——每条通道有且只有一种职责，结果全文只有一个自动到达路径。

1. `async_task_status`（非阻塞查询）：**只返回状态与元信息**（status/startedAt/finishedAt/error 摘要/进度），**不再返回 `output` 全文**。父 Agent 想知道「跑没跑完」可以查，想知道「结果是什么」只有两条正路：
2. `async_task_wait`（显式阻塞等待）：返回完整 output——选择 wait 就是选择同步模式。wait 返回结果时同事务标记 `task.resultPickedAt=now, resultPickedBy="wait"`（**写发生在显式命令里，不是读路径副作用**），投递层见到此标记**跳过气泡注入**（结果父已取走，再冒气泡就是重复）。
3. 异步完成（通道 B）：**唯一自动注入**结果全文的路径（推优先，符合 AGENTS.md「推送替代轮询」既定方向）。
4. `agent_report_back`（通道 B 的入口）：注入前查 `taskRef` 对应 task——已 `resultPickedBy="wait"` 或同 taskRef 消息已注入过 → 只落库不注入（幂等）；否则走 `autoConsumeAsyncDelivery` 正常注入 + drain（该函数已有原子 claim 幂等，此处在其之上再补 taskRef 维度）。
5. schema 变更仅一处：`Task` 加 `resultPickedAt DateTime?` + `resultPickedBy String?`（`"wait" | "bubble"`）。

**优点**：
- 消除根因而非管理症状——LLM 不可能再「轮询读到结果」，因为它根本读不到；双回复在机制上不可能发生；
- 语义干净：写状态只发生在 `wait` 这个显式动作点，没有读路径写副作用（避免重蹈 `resolveAgent` 读时偷偷 update 的覆辙）；
- 实现量最小：改 `async_task_status` 返回结构 + 4 个工具描述 + 投递层一个检查 + W14 记账；
- 与项目既定「推优先、轮询兜底」战略一致。

**缺点**：
- 父 Agent 失去「随时偷看结果全文」的能力（但这正是本次事故的根源，算缺点也算特性）；
- 存量 prompt/测试若依赖 `async_task_status` 返回 output，需要同步调整（有 breaking 面，但项目无向后兼容包袱）；
- 父 Agent 等不及想拿结果时正确姿势变成「调 `async_task_wait` 阻塞等」或「结束本轮等推送」——需要工具描述写清楚，否则它还是会发明新怪招。

---

### 方案二：全量消费状态机（原推荐方案的完整版）

**思路**：保留三条通道都能传全文，用精细记账 + 降级注入来事后去重（即原推荐：`Task.consumedAt/consumedBy` 三态 `poll/bubble/push`，poll 读取即记账，注入时按消费状态降级）。

**优点**：
- 能力最全：父 Agent 随时可以轮询读到完整结果，灵活性最高；
- 状态语义最精确，审计信息最全（谁在什么时间经哪条路读了什么）。

**缺点**：
- **复杂度显著高**：`poll` 记账是读路径写副作用（`async_task_status` 每次调用都可能改库），且「查状态」与「读结果」要拆成两个动作，LLM 每次查询都在改变系统状态，调试时因果链难看懂；
- **用户体验受损的隐藏面**：父轮询读过后，气泡注入被「降级」→ **用户在聊天记录里看不到完整结果气泡**，只能看到父 Agent 回复里引用/转述的部分。转述可能失真、漏细节——用正确性换了一个本可避免的双重表示；
- 竞态窗口仍在：poll 与注入同时发生时，记账和注入的先后无 happens-before，还是要补幂等；
- 实现量约为方案一的 2~3 倍（schema 两个字段 + 三条通道各自的记账点 + 降级注入逻辑 + 存量数据迁移）。

---

### 对比总表

| 维度 | 方案一：通道分工（推荐） | 方案二：全量状态机 |
|---|---|---|
| 根治程度 | 双回复机制上不可能 | 靠记账事后去重，仍有竞态窗口 |
| 用户能否看到完整结果气泡 | 能（唯一自动通道就是气泡） | 可能被降级吃掉 |
| 读路径写副作用 | 无 | 有（poll 记账） |
| schema 变更 | 2 个字段（wait/bubble 两态） | 2 个字段（三态）+ 三通道记账点 |
| LLM 行为约束 | 工具描述讲清分工即可 | 还要 LLM 理解「读过了会降级」 |
| 实现量 | 小 | 中 |
| 与「推优先」战略 | 一致 | 部分背离（轮询仍是一等公民） |

### 推荐

**方案一**，并建议执行顺序：W14（AgentMessage 记账修复，两方案都需要）→ `async_task_status` 去 output 化 + `async_task_wait` 取结果标记 → 投递层幂等检查 → 工具描述与系统 prompt 引导（等结果用 wait / 异步就先回复用户）。

**回答（用户拍板）**：

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


| 面板                        | 展示内容                                                                                                     | 是否触发消费 |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------- |
| 左侧 Async 任务列表         | 本次对话里发生过的**所有**工具/子 Agent 运行记录：运行中、已完成、阻塞式子 Agent、shell 脚本、普通工具调用等 | 否，仅追溯   |
| 右侧 Runtime / 异步任务队列 | 只展示**已完成但尚未被消费**的异步结果（会进入右侧气泡的任务）                                               | 是           |

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


| 项                                 | 状态 |
| ------------------------------------ | ------ |
| A 阻塞式不写 ChatMessage           | ✅   |
| B SessionQueueItem 表 + CRUD       | ✅   |
| C 消费时同步 AgentMessage consumed | ✅   |
| D Task.pinned + ack 后 CLAIM       | ✅   |
| E async_delivery 推优先 + 轮询兜底 | ✅   |

---

## 已确认 ✅（2026-07-11）：同步等待 vs 异步投递


| 决策             | 说明                                                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| 两轴正交         | **父流耦合**（`waitForResult`）与 **任务池调度**（`AsyncJobOrchestrator`）分开；禁止再叫「阻塞式异步」                    |
| 只有非阻塞叫异步 | `waitForResult=false` → 结果进异步任务结果队列，当前流结束后消费                                                         |
| 同步等待         | `waitForResult=true` → 父 `streaming` 挂起；结果走 tool return；不进异步队列；不成右侧投递气泡                           |
| 任务池           | `config.yaml` → `asyncJobs.maxConcurrent`（全局共享）；状态 `queued`≈等槽，`running`=执行中；env `AGENT_ASYNC_*` 可覆盖 |
| 同步 spawn 回报  | 子会话空闲后**系统抓取**最后一条 assistant；不强制 `report_back`；若子主动 report_back 可提前结束且仍不进异步队列         |
| 异步 spawn 回报  | **仅**子 Agent 自行 `agent_report_back`；系统不抓最后一条                                                                 |

气泡矩阵与逐步状态见 `docs/development/chat-scenario-states.md` §0 / §0.1 / 场景 5–6。

---

## 已确认 ✅（2026-07-11 续）：同步等待 vs 异步投递


| 决策       | 说明                                                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 命名       | `waitForResult=true` = **同步等待**；`waitForResult=false` = **异步投递**。禁止再称「阻塞式异步」。                                     |
| 任务池     | 两路径都可入`AsyncJobOrchestrator`（`queued`→`running`）；池只管并发。上限：`config.yaml` → `asyncJobs.maxConcurrent`（env 可覆盖）。 |
| 同步 spawn | 父流挂起；子空闲后**系统抓取**最后一条 assistant 作 tool return；不强制 `report_back`；不进异步结果队列；不成右侧投递气泡。             |
| 异步 spawn | 工具立刻返回；**仅**子 Agent 调用 `agent_report_back` 才投递父异步队列；系统不自动抓 assistant。                                        |
| 气泡矩阵   | 见`docs/development/chat-scenario-states.md` §0.1。                                                                                    |

---

# 非Chat架构复盘（2026-07-12）：TOCTOU / SSE 绕过 / 退出泄漏

> 在修 chat INV-6/7 时顺带排查了非 chat 的架构隐患，按「根因 → 修复 → 好处」记录，避免后续重复打补丁。

## 已修复 ✅

### A. SessionStreamHub.startIfNotRunning TOCTOU

- **根因**：`isRunning` 检查 → `await maxEventIdFor`（DB 异步）→ `runs.set` 之间有窗口。两个并发调用方（autoConsume + 用户发消息 / 多个异步投递）都能过 `isRunning` 检查，第二个 `start` 覆盖第一个 `runs.set`，第一个 run 被孤立泄漏、abort 信号/队列状态错乱。
- **修复**：`start` 内先同步 `runs.set`（`nextId` 占位 0），再 `await maxEventIdFor` 后赋值；runner 在赋值后才启动，期间不发事件，安全。`startIfNotRunning` 捕获「已运行」异常返回 false。
- **好处**：以后任何「同一 session 多源并发触发运行」（心跳 + 用户 + 触发器 + autoConsume）都不会再出现 run 被覆盖、信号错乱。

### B. heartbeat 裸 prisma.chatMessage.create 绕过 MessageService

- **根因**：`heartbeatEngine.ts` 注入心跳 user 消息用裸 `prisma.chatMessage.create`，不广播 `message_upserted`（与 chat INV-6 同源）。心跳触发的会话前端看不到触发消息直到刷新。
- **修复**：改走 `this.services.message.create`，走 `MessageService.afterCreate` → `pushExternalEvent`。
- **好处**：心跳消息进 MessageStore 的契约与所有其他消息一致。**INV-6 现在覆盖所有消息持久化路径**——以后新增任何「系统注入消息」的入口（触发器、定时任务）只要走 `services.message.create`，前端自动收到。

### C. 进程退出未停 cron / interval，句柄泄漏

- **根因**：`handleShutdown` 只调 `triggerEngine.stop()`，未停 `heartbeatEngine`（node-cron）、`taskScheduler`（node-cron）、`sessionStreamHub.cleanupTimer`（setInterval）。SIGTERM 后这些句柄可能阻止进程退出或泄漏。
- **修复**：`sessionStreamHub` 新增 `destroy()`（清 cleanupTimer + flush 持久化队列）；`handleShutdown` 依次 stop 三个引擎 + `streamHub.destroy()`。
- **好处**：优雅退出语义完整。以后新增任何带 interval/cron 的引擎，只要在 `handleShutdown` 加一行 stop，就不会泄漏。

## 待处理（已诊断，未修，按优先级）


| # | 位置                                                                                                                                                                   | 问题                                                                  | 优先级                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | -------------------------------- |
| D | `serviceContainer.ts:86`、`heartbeatEngine`/`triggerEngine`/`taskScheduler`/`asyncJobOrchestrator` 单例、`config.ts`/`eventBus.ts`/`llmBudget.ts` 的 `globalThis` 缓存 | 单例不按 PrismaClient/config 失效，测试间污染（同 swarmBus 已修的类） | 中（影响测试隔离，运行时无碍） |
| E | `swarmInitializer.ts:120`、`asyncJobManager.recoverStaleAsyncJobs` 裸 `chatSession` 写；`SessionQueueItemService` create/consume 无队列 SSE                            | 同 INV-6 类的「写 DB 不广播 SSE」                                     | 中                             |
| F | `asyncJobManager.ts:830` 等 `catch {}` 吞关键状态失败；`heartbeatEngine.ts:257,310` `.catch(()=>{})` 无日志                                                            | 错误吞没掩盖真实失败                                                  | 低                             |
| G | `MessageService.afterCreate` SSE 失败被 catch 忽略 → DB 已提交、前端无事件                                                                                            | 非回滚型，INV-7 切会话对账已兜底                                      | 低（已有兜底）                 |

---

# P0 Agent 架构改造（2026-07-12）

> 来源：架构自查（LLM / 工具 / 记忆 / 状态机 / HITL）+ 对照 [Pi Agent](https://github.com/earendil-works/pi) 与 [LoopX](https://github.com/huangruiteng/loopx)。
> PR 拆分落地清单见 `docs/development/p0-agent-arch-pr-split.md`。
> **约定不变**：不写回答 = 默认同意推荐方案；写了回答 = AI 需调整后再确认。

## 问题 A：要不要引入 Pi 式 Steering / Follow-up 双队列？

**背景**：

Pi Agent Harness 把「运行中用户插话」拆成两种投递语义，投递点固定、可审计：


| 队列          | 投递时机                                                 | 用途                                        |
| --------------- | ---------------------------------------------------------- | --------------------------------------------- |
| **Steering**  | 当前 assistant 的工具批执行完之后、下一轮 LLM 调用之前   | 纠偏、改方向、补充约束（不 abort 重开一轮） |
| **Follow-up** | Agent 本会停止时（无 tool calls、且无 pending steering） | 排队下一任务，等当前工作真正结束再跑        |

KnowPilot 现状：

- 前端已有 `userQueue` / `asyncOverlays`（`useSessionComposeState`）+ Stream `phase` 不变量。
- 后端 `runAgentLoopStream` 是 `for` 轮次循环，**没有**「工具批结束 → 注入用户消息 → 再 LLM」的显式投递点。
- 风险：若用 `queueMicrotask` / `setTimeout` / `phase === streaming` 守卫去「猜」何时可插入，会违反 AGENTS.md「不打补丁」铁律。

**推荐方案**：

1. **语义对齐，不照搬 Pi 类名到 UI**：内部事件用 `steer` / `follow_up`；UI 可继续叫「队列 / 纠偏插入」。
2. **投递点写进后端 loop 不变量**（与前端 `commitStream` 同级）：
   - `AFTER_TOOL_BATCH`：若 steering 非空 → 注入为 user 消息（`services.message.create`）→ 再进入下一轮 LLM。
   - `BEFORE_STOP`：若 follow-up 非空 → 注入 → 开新一轮（不算「新用户点击发送」的 `beginStream`，但算同一 run 的续轮，或显式 `followUpRun`——见下问）。
3. **与现有队列关系**：
   - 用户在 `phase === streaming` 时回车 → **默认 steer**（对齐 Pi Enter）。
   - 用户明确「结束后再问」或 Alt+Enter 类手势 → **follow_up**。
   - `asyncResultQueue` / `superiorQueue` **不是** steering；它们仍按既有「当前流结束后消费」契约（已确认表）。
4. **模式配置**：`config.yaml` → `stream.steeringMode` / `stream.followUpMode`：`one-at-a-time` | `all`（默认 `one-at-a-time`）。
5. **禁止**：编排层用时序猜测插入；任何插入必须经 reducer/loop 状态转移。

**疑问**：

- follow-up 算同一 SSE run 续轮，还是结束后再 `start` 新 run？
- 上级 Agent 消息（`superiorQueue`）要不要也能 steer？

**回答**：

---

## 问题 B：Follow-up / Steering 与现有 Stream 状态机如何咬合？

**推荐方案**：

1. **Steering**：不改变 `StreamLifecycle.phase`（保持 `streaming`）；只在后端 loop 的 `AFTER_TOOL_BATCH` 注入消息；前端乐观气泡可标记 `kind: "steer"`。
2. **Follow-up**：
   - **推荐**：同一 `runId` 内续轮（Pi 语义），`phase` 保持 `streaming` 直到真正无 tool / 无 steer / 无 follow-up → `done` → `commitStream`。
   - **禁止**：`done` 后未 `commitStream` 就偷偷再 `beginStream`（破坏 INV-1/2）。
3. **Abort**：abort 清空 steering + follow-up（对齐 Pi）；已落库的 steer 消息保留（历史可见），未注入的队列项回编辑器。
4. **Turn Snapshot（学 Pi）**：进入 run 时冻结 `agent.model/tools/systemPrompt` 快照；热更新配置只影响下一 run，不改飞行中 turn。

**回答**：

---

## 问题 C：要不要引入 LoopX 式 Loop Contract（控制平面）？

**背景**：

LoopX 不是执行器，而是长程 Agent 的**控制平面**：跨 turn / 重启保持 goal、gates、todos、evidence、quota、handoff。KnowPilot 已有执行器（ReAct + Swarm + 心跳）+ 审批 + SessionStreamHub，缺的是「长程任务剧情」契约。

**推荐方案（挂在心跳 / Swarm 之上，不替换执行器）**：

为每个长程目标（首期：超级 Agent 心跳任务、可选 Workspace 级目标）持久化 `LoopContract`：


| 字段              | 含义                | KnowPilot 落点建议                            |
| ------------------- | --------------------- | ----------------------------------------------- |
| `goal`            | 稳定目标陈述        | 心跳已有 goal 雏形 → 结构化字段              |
| `gates`           | 需人工判断的点      | 复用`Approval` + 显式 gate id                 |
| `todos` / `claim` | 下一步谁做          | AgentMessage / Task，带 ownership             |
| `evidence`        | 为什么相信状态变了  | append-only：Run 摘要、校验结果、关键产物路径 |
| `quota`           | 成本/次数上限       | `llmBudget` + `maxToolCallsPerRun`            |
| `handoff`         | 能否交回 Agent 继续 | 布尔 + 原因；false 时停心跳触发               |
| `stopRule`        | 无证据进展则停      | 连续 N 轮 evidence 无新条目 → stop           |

操作者五问（LoopX）应对 UI/日志：目标是什么？下一步？哪些要人判？证据变了吗？能否交回 Agent？

**首期范围**：

- Phase 1：只服务 **heartbeat 超级 Agent**（单用户本地，收益最大）。
- Phase 2：可选挂到 manager 主会话的长任务。
- **不做**：把 KnowPilot 改成「纯控制平面、外包 Codex/Claude 执行」。

**回答**：

---

## 问题 D：P0 改造的边界与非目标？

**推荐纳入 P0**（阻塞依赖，见拆分文档）：

1. `nativeTools` → `ToolCommand` 注册表 + 按域拆分（开闭原则）
2. `AGENT_MAX_TOOL_CALLS_PER_RUN` 在 loop 内硬停（配置已存在未强制）
3. HITL：`AGENT_DESTRUCTIVE_APPROVAL` 落地 + `approvalGate` 下沉到 `executeAgentTool` + pending TTL
4. 后端 `AgentRunPhase` 最小枚举（为 steering / awaiting_approval 打地基）
5. ReAct 双路径收敛为单一 `AgentLoopStrategy`（可与 4 同 PR 或紧随）

**明确非 P0**（避免范围膨胀）：

- 完整 Reflection 装饰器 / 换向量库 MemoryRepository 全抽象
- Redis SwarmBus 生产化
- Session branching / time-travel
- 工具级 saga rollback 全覆盖（只要求 D 类写入预留 `rollback?` 接口）

**回答**：

---

## 问题 E：目录拆分是否违反「单文件收拢」铁律？

**推荐方案**：

- **不改**：`services.ts` / `router.ts` / `hooks.ts` / `shared.tsx` 单文件约定。
- **允许**：`infra/tools/native/*.ts` 按域拆分 + `infra/tools/native/index.ts` barrel 注册；对外仍从 `nativeTools.js` 或 `tools/registry.js` 单一入口导出，避免调用方散落 import。
- **判定标准**：新增 native 工具 = 新文件 + 一行 `register(...)`，**禁止**再往 4000+ 行文件追加 handler。

**回答**：

---

## 已确认 ✅（默认同意，待用户改口）预填

> 若你未在上方「回答：」填写，则按下表执行。若填写了，以你的回答为准并更新本表。


| 决策                 | 默认                                                                           |
| ---------------------- | -------------------------------------------------------------------------------- |
| A Steering/Follow-up | 引入；投递点在后端 loop；streaming 回车=steer；配置`one-at-a-time`             |
| B 与 phase 咬合      | steer 不改 phase；follow-up 同 run 续轮；abort 清队列；Turn Snapshot 冻结      |
| C Loop Contract      | Phase 1 仅心跳超级 Agent；不替换执行器                                         |
| D P0 边界            | 工具注册表 + 硬停 + HITL 下沉 + RunPhase + ReAct 收敛；反思/向量库/Redis 非 P0 |
| E 目录               | infra 内按域拆 native；services/router 铁律不变                                |

### 落地进度（2026-07-13）


| 项                      | 状态                                                                                                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A/B Steering·Follow-up | ✅`SessionStreamHub` 内存队列 + `reactLoop` AFTER_TOOL_BATCH / BEFORE_STOP + `agent.submitInject`；前端 occupied 时 Ctrl+Enter=steer，Ctrl+Alt+Enter=follow_up |
| PR-5 统一 loop          | ✅`infra/loop/`                                                                                                                                                |
| PR-1/2 预算·HITL       | ✅                                                                                                                                                             |
| C Loop Contract         | ✅ Phase 1：`infra/loopContract.ts` + 超级 Agent 心跳门禁/evidence/stopRule；`agent.getLoopContract` / `resumeLoopContract` / `closeLoopGate`                  |
| PR-3/4 Tool 拆分        | ✅ PR-3 注册表；✅ PR-4a fs/web/shell；⬜ 4b/4c                                                                                                                |

---

## 问题 F：是否引入 pi 式 entry 树支持会话分支（branch / time-travel）？

**背景**：pi 的 session 系统用「只追加 entry 树 + leafId 投影」同时实现分支与压缩（学习笔记：`docs/development/session-tree-study-2026-07.md`）。问题 D 曾把「Session branching / time-travel」列为 P0 非目标；pi 给出具体实现路径后重新提问。当前痛点：编辑用户消息会 `deleteMany` 截断全部尾部（agentStream A5），被截断的历史不可恢复；pi 的方案是切分支只动 leafId 指针，旧分支不删只是不进投影。

**推荐方案**：**暂不引入 entry 树**。先吸收不依赖分支能力的三点（笔记「值得采纳」清单）：摘要六小节结构化 checkpoint、keepRecent 按 token/字符预算替代按条数、压缩切点避开 toolResult。分支能力等出现真实高频需求（用户频繁编辑历史重开 / 需要多分支对比探索）再做；若做，走最小迁移路径——ChatMessage 加 `parentId` + ChatSession 加 `leafMessageId` + 压缩改追加节点，而不是照搬全套 9 种 entry 类型与 JSONL 持久化（后者与「SQLite 缓存 + Markdown 事实源」架构冲突）。

**回答**：

---

## 问题 G：异步任务结果的「消费」状态如何区分？（子 Agent 报告双通道去重的前置）

**背景**：2026-07-15 实测发现子 Agent 报告可经两条通道到达父会话——① 父 Agent 轮询 `async_task_status` 读 `task.output`；② `agent_report_back` 创建 AgentMessage 注入父 session 成为气泡。两通道无去重导致父 Agent 对同一份结果回复两遍（战地笔记：`开发心路历程.md` 2026-07-15 条）。去重的前提是先把「消费」的语义讲清楚。

**核心争议**：`Task.delivered` 现在是单一布尔值，但「消费」实际有两个不同阶段：


| 阶段                            | 含义                                                                                    | 现状                             |
| --------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------- |
| **查询消费（read-consumed）**   | 父 Agent 通过`async_task_status` / 异步任务列表**读到了结果内容**，可能已写进自己的回复 | 无标记——查询不改变任何状态     |
| **呈现消费（bubble-rendered）** | 结果已作为右侧气泡出现在父会话聊天记录里，用户可见                                      | `delivered=true`（混入两种情况） |

如果两个阶段不做区分，去重逻辑无从判断「这份结果父 Agent 到底见没见过」：父 Agent 轮询读过了，但 report 注入流程不知道它读过，照样注入气泡 → 双份回复。

**推荐方案**：

1. `Task` 增加 `consumedAt DateTime?` + `consumedBy String?`（取值 `"poll"`=父 Agent 轮询读取 / `"bubble"`=气泡呈现 / `"push"`=推送注入），与现有 `delivered/deliveredAt` 并存：
   - `async_task_status` / 任务列表查询返回结果内容时，若 `consumedAt` 为空则置 `consumedAt=now, consumedBy="poll"`；
   - 气泡呈现路径保持 `delivered=true`，同时（若为空）置 `consumedBy="bubble"`。
2. 去重规则收在**投递层**（不指望 LLM 自觉）：`agent_report_back` 注入父 session 前检查——若对应 task 已 `consumedBy="poll"`（父已读过），则**降级注入**：AgentMessage 正常落库（供审计），但注入内容标记「该结果父 Agent 已通过轮询获取」，且不触发父会话新一轮 drain；若未被消费过，走现有正常注入 + drain。
3. AgentMessage 自身的 `status`（pending→delivered→consumed）与 Task 的消费状态解耦：AgentMessage 记「消息链路」，Task 记「结果内容被谁读过」，两条账各记各的（W14 先修 AgentMessage 不回写的 bug，本问题是 Task 侧语义扩展）。

**回答**：我不知道怎么选 我需要你详细给出 优缺点 以及推荐实现

---

## W1–W12 架构修复：不做 / 跟进项登记（2026-07-15，DoD 收尾）

> 12 个架构工单已全部提交并验收（分支 `fix/p0-agent-budget-hitl`），审计报告维度终态见 `architecture-audit-2026-07.md`。以下为工单执行中明确「不做 / 另立跟进」的事项，按本文件惯例挂 `回答：` 待拍板；不写回答 = 默认同意维持现状。

| # | 事项 | 来源工单 | 状态 | 说明 |
|---|---|---|---|---|
| 1 | SSE stream 链路接入 `withReflection` | W7（`8044b6f9`） | ⏳ 另立跟进 | 反思装饰器已接 agentRuntime sync 链路（`config.yaml` `reflection.enabled` 默认 false）；stream 链路（agentStream）未接——流式下 critic 回注时机（done 转移点前插一轮）与 token 成本需单独评估，且 `reflection.enabled` 默认关闭使该跟进优先级低 |
| 2 | `config.yaml` 配置热更新 | W9（`136d3220`） | ❌ 明确不做（暂不） | `getAppConfig` 维持进程级单例，改模型/温度需重启进程；单用户本地场景重启成本可接受，`reloadAppConfig()` + fs.watch 的热更新复杂度（飞行中 run 用旧快照、心跳中断语义）暂不值得引入 |
| 3 | fs/web/shell 三遗留域 Zod schema 化 | W6（`0798811a`） | ⏳ 另立跟进 | memory/swarm/session/integration 四域已 Zod 化（`zodParams` 与 router 同一转换器）；PR-4a 先行的 fs/web/shell 三域仍手写 JSON schema，功能正确但风格未统一，待下次触碰这三域时顺手统一 |

**回答**：

---

## W16a-② 决策记录：waitForResult 路径 AgentMessage 终结方式（2026-07-15，W16a 已落地）

**背景**：`deliverToQueue=false`（同步 spawn + waitForResult）时 report_back 跳过 notify → 跟踪 Task 永不 CLAIM → W14 回写永不触发，旁路邮箱 AgentMessage 永远停 `pending`。后果有二：修复脚本 content 匹配永远 MISS（结果走 tool return 不落父会话气泡原文），每次运行都告警且永不消解；这些 pending 还计入 `SWARM_MAX_QUEUE_SIZE`（swarmBus.ts），长期累积会把该 Agent 的消息通道堵到 QUEUE_FULL。

**候选方案**：
- **A（推荐）**：report_back 识别 `deliverToQueue === false` 时，直接把对应 AgentMessage 置 `consumed`（结果已由 tool return 交付，消息链路就此终结），`deliveredAt` 如实记为 report_back 时刻。
- B：写入时就不落 AgentMessage（tool return 路径不需要邮箱记录），同步删存量孤儿。

**决策**：采用 **A**。理由：
1. AgentMessage 旁路邮箱的定位是「旁路邮箱/审计记录」（agentMessageLedger.ts 头注释、swarmBus 审计日志 #17）——tool return 路径同样需要可审计的消息链路账与 taskRef=jobId 对账键，B 删记录会丢审计与对账能力；
2. A 只动 report_back 一个分支（swarm.ts），B 要改 send 写入路径 + 存量孤儿清理，侵入面更大；
3. consumed 终态让存量修复脚本天然零告警（不再进滞留 pending 扫描集），QUEUE_FULL 计数随之消解；
4. 时间戳语义：schema 单时间戳（无 consumedAt 列），`deliveredAt` 即交付时刻——tool return 交付正发生在 report_back 此刻，如实记录。

**落地**：`swarm.ts` agentReportBackTool `deliverToQueue === false` 分支直接置 `consumed` + `deliveredAt=now`；测试「waitForResult（deliverToQueue=false）：report_back 直接终结 AgentMessage 为 consumed，修复脚本零告警」（agentMessageLedger.test.ts）。

**回答**：

---

## W16d-3 决策记录：drift 管理页横幅可发现性（2026-07-16，W16d-3 已落地）

**背景**：W9 只读化后，默认 assistant 的配置漂移只经 `resolveAgent` 返回值 → server `console.warn` 输出（`logAgentDrift`），管理页完全不可见——用户不开 server 控制台就永远不知道老库 assistant 需要跑一次性迁移脚本，drift 提示形同虚设。

**候选方案**：
- **A（推荐）**：新增只读 tRPC 通道 `agent.driftStatus`（server 侧复用 `detectAssistantDrift`），`/agents` 管理页顶部渲染横幅，附一次性迁移脚本提示；drift 为空时横幅渲染 null（无漂移零打扰）。
- B：前端复用现有 `agent.list` 在浏览器端做漂移检测——漂移规则（内置默认工具清单 / 旧版默认提示词 / tier 缺失）会在前端第二次定义，违反单源化；且 `agent.list` 按 R19 裁剪 systemPrompt，根本检测不了提示词漂移。

**决策**：采用 **A**。理由：
1. 检测逻辑单点保留在 server `agentResolver.detectAssistantDrift`，与迁移脚本 `migrate-assistant-tools.ts` 的修复逻辑一一对应，前端零规则拷贝；
2. 管理页查询必须零写副作用：`getAssistantDriftStatus` 不创建、不修改；assistant 不存在时返回 `agentId=null`，绝不引导创建（与 `resolveAgent` 的「首次启动引导创建」语义显式区分——后者是运行时引导，前者是管理页只读查询）；
3. tRPC 通道带 `aiReadable` meta，Agent 也可经 `ai.invoke` 自查漂移，不只服务人类用户；
4. 横幅为纯展示组件，`drift.length === 0` 直接渲染 null，无漂移时零视觉噪音。

**落地**：`agentResolver.getAssistantDriftStatus`（复用 `findAssistantCandidate`，全量实体经 `getById` 取）+ `agent.driftStatus` procedure + `components/assistantDriftBanner.tsx` + `/agents` 页接入（`staleTime: 60_000`）。测试：`__tests__/agentDrift.test.ts`（基线读取 → 人为摘掉一个内置默认工具制造漂移 → drift 增长并点名缺失工具 → 恢复后回到基线，try/finally 强制还原）+ `components/__tests__/assistantDriftBanner.test.tsx`（渲染/空态两例）。

**回答**：

---

## W16d-1 决策记录：反思层 stream 链路接入（2026-07-16，W16d-1 已落地）

**背景**：W7 反思装饰器落地时仅接 sync 链路（agentRuntime），而用户聊天主路径是 stream（agentStream）——默认关 + stream 未接 = 用户聊天路径上反思为零，「反思层」名头大于生效强度。

**候选方案**：
- **A（推荐，已采用）**：把 stream 链路接上，评估点与 sync 一致（「即将 done」终轮：withTools 且零 toolCalls），默认仍关但开启后全覆盖。
- B：文档与 AGENTS.md 降级为「反思层（实验性，仅异步/心跳链路，默认关）」。

**决策**：采用 **A**。理由：B 等于承认核心场景（用户聊天）永远无反思，反思层名存实亡；A 只点状接入 agentStream 的 done 等价转移点，不重写 985 行编排，critic 失败静默跳过原则不变。

**落地**：`agentStream.ts` stream 路径接入 `withReflection`（评估在 transport 装饰器、决策在 done 转移点，与 sync 同构）；`config.yaml` `reflection.enabled` 默认 false 不变，开启后 sync/stream 全覆盖。测试：stream 路径反思用例补入 `__tests__/reflection.test.ts`。

**回答**：

---

## W16d-2 决策记录：心跳熔断 suspended 持久化与个体化恢复（2026-07-16，W16d-2 已落地）

**背景**：W12 心跳连续失败暂停是引擎内存态 `suspendedAgents: Set`——`refresh()` 里 `clear()` 连坐恢复（无关 Agent 也被复活），进程重启即失，名头大于生效强度。

**候选方案**：
- **A（推荐，已采用）**：suspended 状态持久化（Agent 行加 `heartbeatSuspendedAt DateTime?`），refresh 只恢复「该 Agent 自身指标已好转」的个体。
- B：改名「连续失败抑制（易失）」并在文档写明语义。

**决策**：采用 **A**。理由：连坐恢复会让刚被熔断的问题 Agent 在下次配置刷新时立刻复活继续撞墙，熔断名存实亡；持久化 + 个体化恢复只加一列与恢复条件判断，改动面可控。

**落地**：`schema.prisma` Agent 加 `heartbeatSuspendedAt`（db:push 已应用）；`suspendHeartbeat()` 写列 + 摘除 cron job；`refresh()` 按个体指标恢复（仅当该 Agent 连续失败计数已清零）；`resumeHeartbeat()` 清列恢复。另：`runApprovalCleanup` 的非必要 `await import("./approvalGate.js")` 已改静态导入（验证不成环）。测试：suspended 持久化与个体恢复用例补入 `__tests__/circuitBreaker.test.ts`。

**回答**：
