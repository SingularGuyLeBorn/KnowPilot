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

> **⚠️ 2026-07-16 状态更新**：本节方案一/二为 2026-07-15 历史对比稿，均未原样落地。最终拍板为更激进的 v7 变体——**`async_task_wait` 工具整体删除**（不再作为任何「等结果」通道）、**`async_task_status` 去全文**，A1（status 读全文）/A2（wait 读全文）撞车面机制性消除。现行分工与决策记录见文末「v7 决策记录：异步工具体系收敛」。

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
- 父 Agent 等不及想拿结果时的正确姿势~~「调 `async_task_wait` 阻塞等」~~（已随 v7 删除该工具）更新为：用 `agent_send_message` 经服务端持久队列催子 Agent 提前 `report_back`（W-E：子等闲时自动 drain 处理），或结束本轮等队列推送——工具描述写清楚，否则它还是会发明新怪招。

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

---

## W-E 决策记录：给 running 子 Agent 发消息 → 服务端持久队列 + 空闲自动 drain（2026-07-16，v7 已拍板落地）

**背景（C7）**：旧实现 `triggerAgentRun` 先把消息写进子会话 ChatMessage，遇 `hub.isRunning` 则等子本轮结束**直接返回旧 assistant**——新消息躺在历史里无任何机制触发处理（父以为送达，子永远看不到）。

**候选方案**：
- **A（推荐，已采用）**：busy 判定前移到写 ChatMessage 之前；busy 时 `bus.send` 写 AgentMessage（pending，走 depth/queue-size 守卫）+ `sessionQueueItem.create` superior 幂等镜像，**不写 ChatMessage**；新增服务端 drain（复用 per-session 串行链），子等闲时按 FIFO 自动 consume（删除即认领）并重入 `prepareAgentRun` 起流。
- B：纯前端队列（现状 mirror + useChatQueueDrain）——前端不开子会话页面就永不处理，违反「无论前端是否打开，子等闲时自动处理」的拍板决策。

**决策**：采用 **A**。理由：
1. 不变量收执行层：consume 删除即认领是唯一互斥点（软认领 `{success, claimed}`，落选方静默），前端 drain 与服务端 drain 竞态幂等，不靠时序猜测；
2. 「同会话同时至多一条流」由 `hub.start` 抛错 + per-session 串行链（drain 与异步投递续跑同链）双重强制，drain 只在 `isRunning=false` 时认领起流；
3. W14 账本在队列路径完整：pending →（consume 事务内）consumed，`deliveredAt` 兜底补齐，无 pending 泄漏堵 `SWARM_MAX_QUEUE_SIZE`；
4. `agentRunLocks` 收窄为只覆盖 prepare 段（会话 find-or-create/dedup/写消息/起流），运行期间再次派活统一走 busy 入队（不再在锁上干等整轮）；
5. 已知限制（写进代码注释）：drain 链是进程内的，pending 项跨重启留存，靠下次发送或前端打开会话 drain 兜底（与「运行中任务随重启丢失」一致）。

**落地**：`swarm.ts` `triggerAgentRun` → `prepareAgentRun`（started/queued/failed 三态）+ busy 分支；`asyncJobManager.ts` `enqueueSuperiorQueueDrain`（`enqueueSessionAutoConsume` 改返回链 promise）；`services.ts` consume 软认领；`useChatQueueDrain.ts` superior 项 claimed:false 静默跳过。`waitForRun=true` + busy：等该 item 的 drain 链完成后读最后 assistant 返回。spawn_subagent 派活首轮（新会话必闲）与 agent_report_back 路径不变。测试 `__tests__/superiorQueueDrain.test.ts`（T7 等 4 例负向断言，旧实现即红）。

**回答**：

---

## v7 决策记录：异步工具体系收敛（2026-07-16，W-0/W-A/W-E/W-F 已落地）

**背景**：异步工具体系曾是「两个工具干同一件事 + 三个开关名表达同一个维度」——`spawn_subagent` 与 `async_task_run(mode=llm)` 都能发起带 LLM 的后台子任务；`async_task_wait` 是第三条「读全文不留痕」通道（问题 G 的 A2 撞车面）。用户拍板收敛（原话：wait「去掉好了」、存量「数据库里的直接删掉就好了」）。

### 双工具四象限分工表（现行）

| 工具 \ `waitForResult` | `true`（同步任务） | `false`（异步任务，默认） |
|---|---|---|
| **`spawn_subagent`**（专职带 LLM 的子 Agent 任务） | 父流挂起等待；结果走 tool return 进父当前 ReAct 轮；不进异步队列、不成气泡；右栏「同步任务」区展示 running→已完成 | 工具立即返回；结果**仅**经子 Agent `agent_report_back` 进父异步队列，父本轮回复结束后被消费为右侧气泡并触发父续跑 |
| **`async_task_run`**（专职非 LLM 纯工具任务；`toolCall` 必填，`mode` 参数已删） | 同上：tool return 直返（`waitForAsyncJob` 唯一调用方），事后标 `delivered=true` | 同上：结果进异步队列原子 claim 后注入气泡 |

- 异步模式下父对子「只能看状态，看不到执行过程和结果」——`async_task_status` 只回 status/taskLabel/elapsedMs 等元信息。
- **「启动后改主意要结果」**：不再有 `async_task_wait` 逃生舱——正确姿势 = 用 `agent_send_message` 经服务端持久队列（W-E）催子 Agent 提前 `report_back`；子等闲时自动 drain 处理该消息。
- 全文交付唯一通道 = `Task.delivered` 原子 claim（`updateMany delivered=false→true`），认领方 = 服务端 autoConsume / 前端 ack（同一把锁，W14 竞态测试已覆盖）。

### 决策（五条，均已落地）

1. **双工具分工**：`spawn_subagent` 专职带 LLM 子任务；`async_task_run` 收窄纯工具（删 `mode` 参数、`toolCall` 必填）。两者 `waitForResult` 语义完全一致（见上表）。注意：`buildAsyncExecute` 的 llm 执行分支**一行不删**——它是前端「派生子代理」按钮（tRPC `session.spawn`/`session.rerun`）的执行体。
2. **`async_task_wait` 删除**：def/handler/注册/权限清单/UI 条目全清，注册表负向断言（`async-task-queue.test.ts`）。
3. **`async_task_status` 去全文**：问题 G 的 A1/A2 撞车面随 1+2+3 机制性消除；方案三的 `deliveredBy` 审计列永久失去消费方，不加。详见 `async-result-dedup-proposal.md` §8（已标「已落地（变体）」）。
4. **C7 服务端队列**：给 running 子 Agent 发消息走服务端持久队列 + 空闲自动 drain（W-E 决策记录见上一节）。
5. **存量硬删**：dev.db 历史 `sourceType="async_task_llm"` Task 行一次性物理删除（W-F；执行结果 0 行命中，存量库已无此类行），不留脚本不留兼容。

**回答**：

---

## 全局任务池 Q1：池的作用域——全局单池 vs 每会话/每 Agent 池？（2026-07-16，v8 TP-1/TP-2 已落地）

**背景**：异步后台任务（`spawn_subagent` / `async_task_run` / heartbeat / trigger）此前没有统一容量权威——各入口各自起流，LLM 调用成本随并发线性膨胀，且无任何排队与公平语义。要引入任务池，先拍板池的作用域。

**候选方案**：
- **A（推荐，已采用）**：全局单池（`asyncJobOrchestrator` 进程级单例，`maxGlobal` 为唯一容量权威）。
- B：每会话 / 每 Agent 各自一池（分层池）。

**决策**：采用 **A**。理由：
1. **LLM 成本是全局的**：API 并发与费用不按会话分摊——容量权威必须全局唯一，才能回答「此刻全系统同时在烧多少并发」；分层池的总量 = 各池之和，池数量随会话/Agent 动态增长，总量失控防不住。
2. **会话间公平靠调度而非分池**：per-session / per-workspace 上限作为池内准入判定链的**公平配额维度**（`maxPerSession` / `maxPerWorkspace`），而不是独立池——公平与容量解耦，配额可为 0（不限）而不影响容量权威。
3. **分层池复杂度**：每会话池要解决池生命周期（何时创建/销毁）、跨池抢占、全局总量再约束三层问题，复杂度显著高，收益只是把公平换个地方做。

**落地**：`AsyncJobOrchestrator` 进程级单例（`getAsyncJobOrchestrator`），`config.yaml` `asyncJobs.maxConcurrent` 为全局唯一容量权威；`maxPerSession` / `maxPerWorkspace` 是准入判定链的公平维度。

**回答**：

---

## 全局任务池 Q2：交互式运行（用户直发消息）入不入池？（2026-07-16，v8 TP-1/TP-2 已落地）

**背景**：用户在 Chat 直发消息的交互式运行（hub 主链路）与池内后台任务共享同一份 LLM 并发预算。若交互式完全游离于池外，全局并发会突破 `maxGlobal`；若强制入池，用户发消息要等后台任务腾槽，交互体验被排队毁掉。

**候选方案**：
- **A（推荐，已采用）**：交互式**不入池但计入全局占用**——`全局占用 = 池内 running + hub 交互 running`；池内任务起流前检测交互 running 数。
- B：交互式也入池排队（统一调度）。

**决策**：采用 **A**。理由：
1. **交互体验零排队**：用户发消息走 hub 即时起流，永远不被后台任务堵住——交互式是「人在等」，后台任务是「机器在跑」，排队容忍度完全不同。
2. **容量账仍然守得住**：池内任务 admit 前把未被 occupancy claim 的 hub 活跃流计入占用（`hubInteractiveRunning()`），交互流多时后台任务自动让位排队；口径上交互 running 只参与 global 判定，不受 per-session/workspace 配额约束。
3. **活性靠显式事件，不靠时序猜测**：交互流结束经 `onHubRunSettled` 显式通知池 `reevaluateQueue()`（drain 幂等）——pull 口径解决「怎么算」，settled 钩子解决「何时重排」；缺了它，queued 任务在下一次池事件前无人唤醒。
4. **B 的代价**：用户消息排在长后台任务之后，首 token 延迟不可接受；hub 起流路径还要引入等槽挂起，平白增加时序复杂度。

**落地**：`setHubRunningSessionsProvider`（server 启动接线，hub 提供只读统计、不反向依赖池）+ `onHubRunSettled` 活性钩子 + `claimOccupancy`（池内起流/血缘让渡的会话从交互口径剔除，防双算，refcount）。

**回答**：

---

## 全局任务池 Q3：消费续跑与执行任务的池位关系？（2026-07-16，v8 TP-1 已落地）

**背景**：异步结果消费续跑（autoConsume / superior 队列 drain）本质是「起一条新的会话流」，与执行任务一样烧 LLM 并发。若消费不占池位，全局占用口径破一个洞；若消费与普通任务同优先级排队，又会出现「任务跑完了结果送不进去」的投递饥饿。

**候选方案**：
- **A（推荐，已采用）**：**正交**——消费续跑走高优通道（`runConsumeJob`，队首优先 + 同类 FIFO），仍受全局占用上限约束。
- B：消费与执行任务同队列同优先级。
- C：消费完全不入池（游离于容量账外）。

**决策**：采用 **A**。理由：
1. **正交性**：「任务怎么执行」与「结果怎么送达」是两个维度——消费续跑是交付动作（delivery），不是新任务；给它独立的优先级语义，不与普通任务混在一个 FIFO 里互相阻塞。
2. **高优但不特权**：插到队首（admit 优先级高于普通排队任务）保证结果尽快送达，但仍受全局占用上限约束——普通任务不插队到消费前面，消费也不把全局容量打爆。
3. **禁止等槽无限挂起消费链**：`queuedTimeoutMs`（缺省兜底 30s）内未获槽则放弃本轮；CLAIM（`Task.delivered` / SessionQueueItem consume）移到**获槽后**执行，未获槽则 delivery 原样留待下次触发（不丢）——「永不丢任务」与「不死等槽位」同时成立。
4. **无循环等待**：hub 交互流不依赖池槽位 ⇒ 消费任务等 hub 空闲不会与池形成循环等待；B 的投递饥饿与 C 的容量漏洞都被排除。

**落地**：`runConsumeJob`（`priority:"high"` 插队首、同类 FIFO；resolve false = 未获槽，调用方留待下次触发）；`autoConsumeAsyncDelivery` 与 `enqueueSuperiorQueueDrain` 均已改走本通道，CLAIM 在获槽后执行。

**回答**：

---

## 全局任务池 Q4：同步等待（waitForResult=true）在池满时会不会死锁？（2026-07-16，v8 TP-1 已落地）

**背景**：父任务占着池槽位调 `spawn_subagent(waitForResult=true)`，父流挂起等子结果。若子执行也按普通任务入池等槽——池满时「父占槽等子、子等父腾槽」循环等待，经典死锁。

**候选方案**：
- **A（推荐，已采用）**：**inline 血缘继承不占新槽**——子执行视为父槽位让渡，直接 inline 执行。
- B：为同步等待预留专用槽位（reserve slot）。
- C：等槽超时兜底（超时后失败返回）。

**决策**：采用 **A**。理由：
1. **根因消除**：死锁的根源是「同一血缘占两个槽」——不变量定为**同一血缘同时只有一个执行体占槽**：父挂起期间其槽位血统让给子，子经 `claimOccupancy(子会话)` 从「hub 交互 running」口径剔除后 inline 执行，永不新增池位需求，循环等待在机制上不可能发生。
2. **容量账不破**：子执行期间全局占用不变（父槽位仍在账上，只是换了执行体），`maxGlobal` 的语义从「并发任务数」精确化为「并发血缘数」，与 LLM 成本口径一致。
3. **B 的短板**：预留槽位 = 容量永久打折，嵌套深度不受控时一个 reserve 也不够；**C** 只把死锁降级为超时失败，用户看到的是莫名其妙的「池满失败」，语义不如血缘继承干净。

**落地**：`session.ts` spawn 工具 `waitForResult=true` 分支与 `asyncJobManager` inline 路径均经 `claimOccupancy(subagentSessionId)` 让渡；父流挂起轮询语义不动。

**回答**：

---

## 投递可靠性 Q1：S3「认领了但气泡没进会话」如何根治？（2026-07-16，v9 R-1 已落地）

**背景**：S3 竞态——异步结果 CLAIM（`Task.delivered` 原子认领）成功，但续跑起流失败或中途断掉，父会话气泡始终没写入；delivery 已标 `delivered=true`，任何重试路径都把它当「已送达」跳过，结果永久丢失。CLAIM 与气泡写入之间隔着一个无法同事务的 SSE 起流，单点修复不存在，必须回答「失败在哪一层兜底」。

**候选方案**：
- **A（推荐，已采用）**：两层闭环——①**同链即时回滚**：CLAIM 后 `startIfNotRunning` 返回 false（别的流占线，消息确定未写入）→ 事务回滚 `delivered=false` + W14 账本回滚 + 重挂消费链队尾；②**对账者 reconciler**（收进 `asyncJobManager.ts`）：启动即扫 + 周期扫（周期复用 `stream.cleanupIntervalMs`，无新增 config 面），扫「`delivered=true` 且终态、超龄（`RECONCILER_MIN_DELIVERED_AGE_MS=60s`）、未 pinned、`deliverToQueue≠false`、且 ChatMessage 无 `toolResults.subagentResult.jobId=X` 消息」的孤儿 → 条件写回滚（`updateMany where delivered=true`，与前端 ack `markAsyncDeliveryConsumed` 条件互斥）→ `notifyAsyncDelivery` 重走正常管道（`[reconciler] 补投 jobId=...`，每轮上限 `RECONCILER_BATCH_LIMIT=50`）。
- B：把 CLAIM 挪到气泡注入成功之后。
- C：注入一失败就无条件回滚 `delivered`。

**决策**：采用 **A**。理由：
1. **B 会造两个消费者**：CLAIM 挪到注入之后，则注入前服务端 autoConsume 与前端 ack 都可能各自注入一次——同一结果被两个消费者双注气泡。CLAIM 必须是注入**之前**的唯一互斥点，这是 v7 就定下的全文交付语义，不能动。
2. **C 会重复投喂**：`started=true` 后 `chatAgentStream` 中途抛错等路径，消息可能已写入 DB——此时回滚 `delivered` 会让 reconciler/前端把同一结果再投喂一遍。「无法判定消息是否写入」的路径绝不能回滚，这就是**宁漏勿错**（宁漏回滚勿错回滚）原则。
3. **两层互补覆盖全部失败面**：第一层只处理「确定未写消息」的唯一可判路径（`started=false`），即时自愈不丢不重；剩下所有无法判定的失败面交给第二层，以 **ChatMessage 为唯一 ground truth** 对账——有气泡就跳过，无气泡才条件写回滚补投。回滚与正常 CLAIM/前端 ack 条件互斥，补投重走 notify/autoConsume 正常管道，全动作幂等，对账者本身跑多少轮都不会出错。

**落地**：commit `5a410784`（R-1）。同链回滚 `rollbackAsyncDeliveryClaim`（条件写 `updateMany where delivered=true` + 同事务回滚 W14 账本 `delivered→pending`）；对账者 `reconcileAsyncDeliveries` / `startAsyncDeliveryReconciler`（启动即扫 + 周期扫，周期复用 `config.stream.cleanupIntervalMs`）。测试 `__tests__/deliveryReliability.test.ts`。

**回答**：

---

## 投递可靠性 Q2：服务重启后，中断的任务/会话/交付按什么语义恢复？（2026-07-16，v9 R-2 已落地）

**背景**：进程重启后 DB 里留下一批「尸体」：running/queued 的 async Task（进程已死，无人再推进）、running 的 ChatSession（hub 内存态已清空）、superior 孤儿 SessionQueueItem（进程内 drain 链随重启丢失）、`delivered=false` 的终态交付（notify 过但从未被消费）。不恢复则结果滞留；恢复动作若盲目重跑则可能重复执行副作用。

**候选方案**：
- **A（推荐，已采用）**：`runStartupRecovery` 启动首扫四动作，全部条件写幂等、DB 为 ground truth：①僵尸 running/queued Task → failed（error「服务重启，任务中断」），**不自动重跑**；②僵尸 running ChatSession → paused（`updateMany` 条件写）；③superior 孤儿 SessionQueueItem → 重注册 drain（v7 W-E 机制）；④`delivered=false` 终态 → 重新 notify（与 R-1 reconciler 同一幂等入口 `reconcileAsyncDeliveries`，不造第二条恢复路径）。AgentMessage pending 超龄走 W14 既有 stale 对账（`SUPERIOR_MIRROR_STALE_MS`），未新造逻辑。
- B：僵尸 Task 标 failed 后自动重新入池重跑。
- C：另建一套独立于 reconciler 的启动恢复管线。

**决策**：采用 **A**。理由：
1. **僵尸 Task 不自动重跑的根因是副作用**：tool 任务有副作用（写文件/发请求），进程死亡时执行进度未知——可能副作用已发生、只差一点收尾，盲目重跑 = 重复执行。如实宣告失败（failed「服务重启，任务中断」）让用户知情，`retryAsyncJob` 保留手动重试入口，把「要不要承担重复副作用」的决定权交还给人。
2. **会话与队列只是状态归位，不产生新执行**：running 会话标 paused 是如实反映「hub 已无任何活跃流」；孤儿队列项重注册 drain 是重启丢失的进程内链条，续跑内容本就是重启前已排队的待办，不是新任务。
3. **C 违反单一路径纪律**：动作 ④与 R-1 孤儿对账本质是同一问题（终态交付没进会话），共用 `reconcileAsyncDeliveries` 一个幂等入口——CLAIM 原子互斥 + notify/autoConsume 管道只有一条，恢复路径再独立一套 = 两个写方竞态 + 双份维护。
4. **顺序敏感**：先动作 ②（全体僵尸会话 paused）再动作 ③（drain 重注册会把有真实积压的会话重新置 running），颠倒则 ②把刚归位的会话又误标 paused。

**落地**：commit `899978d3`（R-2）。`runStartupRecovery`（`asyncJobManager.ts`）挂载于 `index.ts` 启动序列，shutdown 停 reconciler；动作 ①收拢既有 `recoverStaleAsyncJobs`。负向验证：stash 三生产文件后 `startupRecovery` 3/3 全红，恢复全绿。测试 `__tests__/startupRecovery.test.ts`。

**回答**：

---

## 投递可靠性 Q3：v6（W16a~d）工单的自审闭环怎么补？（2026-07-16，v9 R-3 已落地）

**背景**：v6 工单（W16a~d）阶段一修复 commit 均已在库，但缺阶段二自审报告——「修完了没有、修得对不对」无记录可查，工单无法闭环。按 v6 起立的规矩，每个工单必须留自审报告。

**候选方案**：
- **A（推荐，已采用）**：补跑 v6 自审，产出 `review-final-w16.md`；审出的问题当场转修复工单修掉，不留「已知带病」尾巴。
- B：阶段一 commit 已在即视为闭环，免补报告。

**决策**：采用 **A**。理由：
1. **报告是闭环的唯一证据**：commit 只证明「代码改了」，不证明「改对了」——自审的价值恰在复审视角。补跑结论**通过**，且真揪出了一个阶段一没发现的假绿：P2-1 `agentDrift` 主用例在 fresh 库上 early return，漂移增量段从不执行（已修 `7da7c20f`）；另登记 P2-2 测试基建 flake、P2-3 观察项。
2. **顺手清历史债**：`stash@{0}`（W13c 时代 WIP）逐 hunk 对照确认全部被 W13 正式实现覆盖后 drop；`PLAN_STATUS.json` 全仓 grep 零消费者、数据停在 2026-07-10 已失真，删除（`b535d716`）；另修复 2 个假绿测试（`56bb100e`：git 测试 0 skip 真跑、resilientLlmClient 真实断言）。
3. **B 的代价**：缺报告 = 后续工单无法判断 v6 哪些结论可信，每次都要重新翻 commit 考古；且假绿测试会在库里继续「装健康」。

**落地**：自审报告 commit `f2385ea1`（`docs/development/review-final-w16.md`，结论通过）；P2-1 修复 `7da7c20f`；假绿测试修复 `56bb100e`；stash 处置 + PLAN_STATUS.json 删除 `b535d716`。

**回答**：

---

## 可重入与续跑 Q1：可重入性模型——单点声明还是独立清单？（2026-07-16，v10 C-1 已落地）

**背景**：v9 R-2「僵尸 Task 一律 failed 不自动重跑」的根因是副作用未知。但并非所有任务都有副作用：纯 LLM 任务重跑最坏是重新生成一遍回复，只读工具任务（`web_search`、fs 读类）天然幂等。系统没有任何可重入性标记，安全任务被一刀切陪葬。要支持自动续跑，先回答「系统怎么知道一个任务能不能安全重跑」。

**候选方案**：
- **A（推荐，已采用）**：单点声明 + 任务级推断取最严——工具侧 `ToolCommand.reentrant?: boolean`（默认 false）与既有 `destructive` 同处域注册处声明；任务侧 `inferTaskReentrant`：tool 任务按其 `toolCall.tool` 的声明，llm 任务按 `agentSnapshot.tools` 全体取**最严**（任一 false 则整体 false；无工具 = true 纯 LLM）；推断结果在任务**入队时物化**到 `Task.reentrant` 列，恢复时不重新推断。
- B：独立维护一张 reentrant 工具清单。
- C：按任务名/工具名字符串匹配猜测。

**决策**：采用 **A**。理由：
1. **B 违反单点纪律**：`destructive` 已有「单点在域注册处声明，禁止再造列表」的成例（types.ts 注释明言）；第二张清单必然与注册处漂移，漏标一处就是一次副作用任务被误重跑。
2. **C 脆**：名字是给人看的不是给机器判的——`rss_fetch` 名字像只读实则有写库，`feishu` 读类会刷新 token 写库；标注必须逐个读实现，按名猜必误判。
3. **取最严**：llm 任务声明了任一非 reentrant 工具，ReAct 轮里就可能调到它——整体只能按最严算；无工具的纯 LLM 任务重跑最坏只是重生成回复，标 true。
4. **物化时点 = 入队快照**：恢复时重新推断用的是「现在的工具声明 + 现在的 agentSnapshot」，与任务入队时的真实形态可能已漂移——入队物化是任务的出生证明，恢复只读列不重算。

**落地**：commit `e624e08a`（C-1）。声明链 `NativeToolDefinition.reentrant` → `registerDomain` 透传 → `ToolCommand.reentrant`（与 `destructive` 同处单点）；34 个只读/幂等工具标 true（fs 读类 4、web 只读 3、`async_task_status`/`wait` 2、`memory_search`、swarm 只读 3、integration 只读 21：git 读类 4 / yuque 读 5 / `browser_login_status` / github 读 10 / `feishu_token_status`）；保守 false：`rss_fetch`、`invoke_api`、feishu 读类 4（token 刷新写库）、`free_api_keys_fetch`、`sleep`、`skill:*`/`mcp:*`/未知工具。Task 表三列迁移（`retryCount`/`maxRetries`/`reentrant`），首建 migrations（0_init baseline + 20260716080437_task_reentrancy）；`input.retryCount` 内存字段删除，列是唯一事实源。测试 `__tests__/reentrancyModel.test.ts`。

**回答**：

---

## 可重入与续跑 Q2：续跑语义——at-least-once 还是断点 checkpoint？（2026-07-16，v10 C-1/C-2 已落地）

**背景**：知道任务可重入之后，还要回答「怎么重跑」：从中断点续跑还是从头重跑？重跑多少次喊停？账本放哪——内存态重启即归零，crash-loop 无从防。

**候选方案**：
- **A（推荐，已采用）**：at-least-once 从头重跑，仅 `reentrant=true`，重试账本持久化到 Task 列——僵尸 Task `reentrant=true && retryCount < maxRetries` → `retryCount+1` **先落库**再重建执行体重新入 v8 全局池；否则维持 R-2 语义标 failed，error 文案两态区分「服务重启，任务中断」/「已达自动重试上限（N 次），需人工介入」。手动 `retryAsyncJob` 不消耗自动额度：`retryCount` 清零重来。
- B：断点 checkpoint 续跑（从 ReAct 中断轮恢复）。

**决策**：采用 **A**。理由：
1. **B 成本高不必要**：任务粒度小（一次工具调用 / 一轮子 Agent 任务），checkpoint 要持久化 ReAct 轮次状态（消息链游标、工具批进度、abort 语义），重建成本远超从头重跑省下的 tokens；at-least-once 对 reentrant 任务语义上已足够。
2. **账本即 crash-loop 闸**：自动重跑每次 `retryCount+1` 落库，重启进程计数仍在，超限即停标 failed 交人工——内存态账本防不住「重跑又崩、崩了又重跑」。
3. **手动 retry 不消耗自动额度**：人工介入是最后一道闸，不能被自动计数堵死——`retryAsyncJob` 清零 `retryCount` 重来（同时按当时 config + 工具声明重新物化 `maxRetries`/`reentrant`）。
4. **先落库再入池的顺序不可换**：反过来会出现「进程死在入池后、落库前」→ 计数少记一次，crash-loop 上限被穿透。

**落地**：schema commit `e624e08a`（C-1：三列 + 入队物化 `maxRetries = config.asyncJobs.maxRetries` 快照）；分叉 commit `580b5e56`（C-2）：`recoverStaleAsyncJobs` 同函数内两态分叉（`runStartupRecovery` 动作 1 唯一收拢点，不新造恢复管线）；入池被拒（maxQueued 满）维持 queued 不标 failed、不回滚计数，下轮启动恢复再试。测试 `__tests__/reentrantResume.test.ts`（T1~T5 + 变异验证）。

**回答**：

---

## 可重入与续跑 Q3：会话恢复——手动闭环还是自动恢复？（2026-07-16，v10 C-3 已落地）

**背景**：R-2 把僵尸 running 会话标 paused，但 paused 是死态——前端只有状态标签展示，server 没有 resume API，未完成的 ReAct 轮再也无法推进。任务侧已有自动续跑（Q2），会话侧要不要同样自动恢复？

**候选方案**：
- **A（推荐，已采用）**：手动恢复闭环——server `chatSession.resume`（条件写 `paused→running` 唯一互斥，幂等）+ 前端 paused 会话「恢复运行」按钮；**不做自动恢复**。
- B：启动恢复时自动 resume 全部 paused 会话。

**决策**：采用 **A**。否决自动恢复（B）的理由：
1. **会话恢复烧 LLM 预算且用户在场感强**：重启后用户大概率想自己看看现场（跑到哪了、中间产物对不对）再决定要不要继续——自动恢复剥夺了这次知情决策，直接替用户烧钱。
2. **自动恢复 N 个会话同时抢池烧 key，收益低**：API 并发与费用瞬间冲高；而会话续跑的收益（推进 ReAct 轮）低于任务续跑（产出已排队的确定待办）——用户在场时自己点一下按钮就够了。
3. **不做就没有会话侧 crash-loop 面**：自动恢复必须配会话侧重试账本（恢复又崩、崩了又恢复），账本复杂度翻倍；手动恢复语义下「恢复几次」由人控制，账本只需管任务侧（Q2）。

**A 的不变量**（全收 `SessionService.resume`，条件写/原子操作，无编排层时序猜测）：唯一互斥点 = 条件写 `updateMany where {id, status:"paused"} → running`（并发 double-resume 只一生效；已 running 幂等返回不报错；archived/failed 等 BAD_REQUEST）；获权后注入 `source:"system"` user 消息「（服务已重启，请继续完成未完成的任务）」经 `hub.startIfNotRunning(chatAgentStream)` **交互式起流**（v8 Q2 口径：不入池但计入全局占用，不新造限流层）；`startIfNotRunning` 返回 false = 已有活跃流接管，竞态幂等不算失败；起流抛错 ⟹ runner 未执行 ⟹ 系统消息必然未写入（消息由 chatAgentStream 起流后写入，注入与起流同源，无孤儿窗口）⟹ 安全回滚 running→paused；终态归位挂 runner 内（done→active/completed、error/abort→paused 可再恢复）。

**落地**：commit `81a7e481`（C-3 server 侧）。上下文从 ChatMessage 扁平消息链重建（`chatHistory.test.ts` 已证可重建），resume 前已有的 assistant 消息不重复生成。测试 `__tests__/sessionResume.test.ts`（T6~T8 + 变异验证）。web 按钮 + mock e2e 由并行工单落地。

**回答**：

---

## 可重入与续跑 Q4：恢复风暴限流——新造限流层还是复用 v8 全局池？（2026-07-16，v10 C-2 已落地）

**背景**：重启后 N 个 reentrant 僵尸任务同时恢复——若全部立即起流，API 并发瞬间击穿。恢复路径要不要自带并发计数器/信号量限流？

**候选方案**：
- **A（推荐，已采用）**：复用 v8 全局池——恢复动作只负责「重建执行体入池」，调度与背压全交给既有池（maxGlobal / 准入判定链 / queuedTimeoutMs 就是限流）。
- B：恢复路径新造一层限流（并发计数器/信号量/分批唤醒）。

**决策**：采用 **A**。理由：
1. **两层限流 = 双倍维护 + 口径打架**：v8 已拍板全局单池是全系统后台并发的唯一容量权威（全局任务池 Q1）——恢复路径再造一层，两个容量权威口径必然漂移（池以为占了 2 槽、恢复层以为占了 5 槽），限流问题从「有没有」退化成「信哪个」。
2. **池语义天然覆盖恢复风暴**：僵尸入池走正常 admit 管道——maxGlobal 挡住瞬时并发，maxQueued 满则入池被拒、Task 维持 queued 下轮启动恢复再试（如实状态，不假装已调度）；公平配额、排队原因展示全部免费获得。
3. **B 的收益为零**：恢复限流要解决的问题（瞬时并发、公平、背压）池已经全部解决，新造一层只是把同一套不变量写第二遍。

**落地**：commit `580b5e56`（C-2）。T5 恢复风暴实测：50 个 reentrant 僵尸首扫全部入池，peakRunning 不超 maxGlobal（v8 Q2 口径统计），无新限流层。

**回答**：

---

## 后续候选（已评估，本期不做）

| 事项 | 来源 | 决定 | 理由 |
| --- | --- | --- | --- |
| `session.spawn` 与 `spawn_subagent` 底层语义统一 | v9 R-4 评估 | **本期不做** | v8 后两条路已共享全局任务池（同一容量权威）与执行基座（`buildAsyncExecute` 单一执行体工厂），剩下的差异只在入参形态与 prompt 层；语义统一收益低，而 prompt 行为变化会直接扰动存量 Agent 的对话表现，风险高。 |

---

## Workspace 层级 + 超级 Agent 权限模型（2026-07-18，已拍板 · 按推荐落地）

> 遵循 `AGENTS.md`「设计决策 Q&A」。用户 2026-07-18：**按推荐方案全部采纳**。
> 配套：`docs/development/async-slots-and-parent-child.md`。

### 背景（用户意图摘要）

希望形成清晰的三层运营模型：

1. **超级 Agent**：几乎能干用户能干的一切（CRUD / 建 Workspace / 派任务），**唯一硬禁：删除自己**。
2. **Root Workspace**：超级 Agent 所属的特殊 Workspace；其它业务 Workspace 由超级创建。
3. **业务 Workspace**：创建时可配置是否自动建**管理员 Agent**、是否附带发给管理员的**初始任务**；并为该 Workspace 分配一定数量的**后台异步任务槽位**（接受一定空间冗余，换取设计简单）。
4. **管理员 Agent**：在 Workspace **内**可操作一切（CRUD 子 Agent、任务、会话等）；除**向超级 Agent 报告**外，**禁止触碰任何 Workspace 外资源**。

### AI 评价（先给结论）

**整体方向正确，建议采纳并做少量收口**，理由：

- 与现有 `tier=super|manager|sub` + Workspace 边界高度同构，不是另起炉灶。
- 「每 Workspace 固定异步槽」比「全靠自觉公平」更好解释、更好做 UI（右栏可显示「本空间 2/4 槽」）。
- 冗余可接受：单用户本地场景，槽位是调度账本不是物理机配额。
- 需要提前钉死的风险点见下方 Q1–Q5（尤其是超级删库、跨空间读、槽位与全局 `maxConcurrent` 谁是权威）。

---

### Q1：超级 Agent 的权限边界？

**推荐方案 A**：

| 能力 | 超级 | 备注 |
|---|---|---|
| 全局 / 跨 Workspace CRUD（Agent、Session、Memory、Post…） | ✅ | 等同用户操作面 |
| 创建 / 归档 Workspace | ✅ | 唯一入口（或与用户 UI 共用同一 Service） |
| 向任意 Agent 发消息 / 派任务 | ✅ | |
| 删除**其他** Agent（含各 Workspace 管理员） | ✅ | 需走既有 destructive 审批开关（若开启） |
| **删除自己** | ❌ | 硬禁；`agent.delete` / native 工具双重拦 |
| 修改自己的 `tier` 降级/移交 | ❌（推荐） | 避免「超级把自己降成 sub」导致系统无舵；移交超级另立显式流程（本期可不做） |

**候选 B**：超级连「删自己」也允许（不推荐——系统会失去唯一全局编排者，恢复成本高）。

**回答**：按推荐 A

---

### Q2：Root Workspace 与业务 Workspace 的关系？

**推荐方案 A**：

- 启动时保证存在且仅有一个 **root workspace**（可命名 `KnowPilot Root`），`super` Agent 的 `workspaceId` 固定指向它。
- 业务 Workspace 由超级（或用户 UI）创建；每个业务 Workspace **默认**创建一个 `tier=manager` 管理员 Agent（可用创建参数 `withManager: false` 关闭）。
- 创建参数建议：
  - `name` / `description`
  - `withManager?: boolean`（默认 true）
  - `managerName?: string`
  - `initialTask?: string`（有管理员时：写入管理员主会话并 `prepareAgentRun` 起一轮；无管理员则忽略或报错）
  - `asyncSlotQuota?: number`（该 Workspace 后台 llm 槽上限；见 Q4）

**候选 B**：不设 root，超级 `workspaceId=null` 表示「全局」（现状接近此）。否决理由：与「管理员不得出域」不对称，边界检查更绕。

**回答**：按推荐 A

---

### Q3：管理员 Agent 的出域禁令如何落地？

**推荐方案 A（硬拦截，不靠 prompt）**：

- 所有跨实体读写走 `swarmPermissionGuard`（或 WorkspaceScopeGuard）：
  - `manager` / `sub`：目标实体的 `workspaceId` 必须等于自身 `workspaceId`；否则 `WORKSPACE_FORBIDDEN`。
  - **唯一出域白名单**：`agent_report_back` / `agent_notify_parent` / `agent_send_message` 的目标为**本 Workspace 上级链上的超级 Agent**（或 root 内超级主会话）。
- 子 Agent（`sub`）保持现有更严工具集；管理员可 CRUD 本空间子 Agent，但子 Agent 同样不可出域（除向上报告）。
- Memory / File / GitRepo 等带 workspace 归属的资源同规则；全局 Memory（`scope=global`）仅超级可写（与现行 W5 一致）。

**候选 B**：仅靠 systemPrompt 约束（不推荐——LLM 会越权试探）。

**回答**：按推荐 A

---

### Q4：每 Workspace 异步槽位 vs 全局 `maxConcurrent`，谁是权威？

**推荐方案 A（双层，全局仍是硬顶）**：

```
获槽条件 = 未超 全局 maxConcurrent（llm 槽）
         AND 未超 该 Workspace 的 asyncSlotQuota
         AND 未超 maxPerSession（若配置）
```

- `asyncSlotQuota` 存在 Workspace 行（或 config 映射），创建时写入；默认例如 `2`。
- **lightweight**（sleep / 纯工具）**不计入** Workspace 配额，也不计入全局 llm 槽（与 2026-07-18 已落地的 `slotClass` 一致）。
- 全局 `maxConcurrent` 仍是烧钱硬顶（防止 N 个 Workspace 各满配额把 API 打爆）。
- 接受「配额之和 > 全局」时的排队——简单、可解释。

**候选 B**：取消全局顶，只按 Workspace 配额加总（不推荐——单用户也可能同时开很多空间）。

**候选 C**：只有全局池，不做 per-workspace 配额（维持现状；与用户「给每个空间分配槽位」意图不符）。

**回答**：按推荐 A

---

### Q5：初始任务与管理员创建的事务语义？

**推荐方案 A**：

1. 事务内：创建 Workspace →（可选）创建 manager Agent → 创建管理员主会话。
2. 事务提交后：若有 `initialTask`，再 `prepareAgentRun` / 入队（失败可重试，不回滚 Workspace 已创建）。
3. 超级侧返回：`{ workspaceId, managerAgentId?, managerSessionId?, initialTaskStatus }`。

**候选 B**：初始任务失败则整单回滚 Workspace（过严，本地调试不友好）。

**回答**：按推荐 A

---

### Q6：落地状态（2026-07-18）

| 项 | 状态 |
|---|---|
| Q1 超级不可删 / 不可自降 tier | ✅ Service + native `agent_delete` / `validateUpdate` |
| Q2 Root Workspace + super 绑定 | ✅ `swarmInitializer`（名「KnowPilot Root」，配额 0） |
| Q3 出域硬拦 + 向超级报告白名单 | ✅ `checkCrossWorkspace(toTier)` + `checkWorkspaceAgentAccess` |
| Q4 行级 `asyncSlotQuota` | ✅ schema / provision / `blockReason(workspaceSlotQuota)` |
| Q5 `withManager` / `initialTask` / 失败不回滚 | ✅ `workspaceProvision` + tool + tRPC |

**总回答**：按推荐方案全部采纳并已落地（2026-07-18）

---

## Assistant Home Workspace（2026-07-18，已拍板）

### 背景

默认 assistant（日常对话入口，tier=manager）与超级 Agent（Swarm 治理，tier=super）职责不同。超级已有不可删的 Root Workspace；assistant 此前无固定归属空间。

### 决策

| 项 | 选择 |
|---|---|
| 系统 Workspace | `systemType: "assistant"`，名「KnowPilot Assistant」，`isSystem: true`，路径 `workspaces/__assistant__` |
| 绑定 | 默认 `assistant` Agent 的 `workspaceId` 固定指向该空间；启动 `initSwarm` 幂等保证 |
| 删除 | 复用 `isSystem` 硬拦（不可删/不可归档） |
| 重置 | `workspace.resetAssistantHome`：归档该助手活跃会话 + 清 SessionQueueItem + 恢复 `ASSISTANT_DEFAULT_TOOLS` 与默认 systemPrompt；**不动** Memory 表与 pinned |
| 记忆 | assistant 默认写 `agent:{id}`；可写本空间 `workspace:{homeId}`；不可写 `global`（仅 super） |

**回答**：按上表落地

---

## Hermes Skill 闭环：Memory ≠ Skill（2026-07-18）

### 背景

对照 `hermes-agent` 源码后确认：此前用 experience Memory 拼 `enabled=false` 沙箱 Skill 的路径**不是** Hermes Closed Learning Loop。Hermes 明文拆开：

- **Memory**（USER.md / MEMORY.md）：陈述事实——用户是谁、偏好、当前情境。  
- **Skill**（SKILL.md 包）：程序记忆——这类任务怎么做；经 `skill_manage` 创建/patch，经 `skills_list`/`skill_view` 渐进加载；回合后 background review 主动维护；curator 管生命周期。

### 决策

| 项 | 选择 |
|---|---|
| 主路径 | procedural SKILL.md 目录包 + `skills_list` / `skill_view` / `skill_manage` + 回合后 review + `.usage.json`/curator |
| executable Skill | 保留沙箱 `run()` 旁路，不作为 Hermes 对标核心 |
| experience Memory | 继续写经验账本；**禁止**再当 Skill 自动生成的主原料并对外宣传为 Hermes |
| GEPA | 另立工单，本期不做 |
| 假对标文案 | `future-features.md` §6 已撤回「已落地」宣称 |

**回答**：按上表落地（实现跟踪 `feat/hermes-closed-loop`）

---

## PR-1 Markdown↔DB 投影层完整性（2026-07-20）

### 背景

架构体检 D1/D2/D3/D4/D5/D8：双写顺序与 sync「文件不存在=删除」语义相反；Windows `.trash` 过滤永不命中；slug 可穿越 content；watch unlink 可误删刚改名实体；FTS 三条漂移；supersede 两步写无事务。

### 决策

| 项 | 选择 |
|---|---|
| 双写不变量 | **文件先成为事实，DB 后投影**；create/update 文件失败不动 DB；delete 文件删不掉不删 DB；`deleteFileBySlug` 禁止静默吞错 |
| 改名删旧失败 | warn 不回滚（旧文件残留 → 下次 sync 可能以新 slug upsert 为新行——可接受；不做强制 slug 冲突去重） |
| `.trash` / 点目录 | 收进 `getFilesRecursive` 的 ignoreDirs（含 `.trash` + `.`/`_` 前缀目录），syncer 不再自行路径字符串过滤 |
| slug 消毒 | FileSyncService 单点校验 + 落点必须在对应 content 子目录；shared `safeEntityNameSchema` / `safeEntitySlugSchema` |
| watch 改名窗口 | `guardedWatchDeleteBySlug`：目标行 `updatedAt` 5s 内 → 跳过删除并标记下一防抖周期全量重扫 |
| FTS | upsert/delete 收进各 syncer；rebuild 过滤墓碑；mcp/prompt 补增量挂钩 |
| supersede | 新 active + 旧 superseded 包 `$transaction`；文件/FTS 事务外按 D1 顺序；`memoryService` 缺省 `console.error` |

**回答**：按上表落地（分支 `arch/data-sync-integrity`）

## 审批 / 断路器 / 预算（2026-07-20，PR-2 arch/approval-circuit-budget）

| 编号 | 决策 | 结论 |
| --- | --- | --- |
| C3 | 审批等待 missed-wakeup | 「注册先行、对账在后」；TTL expired 须条件写 count=1；expireStaleApprovals 只 notify 实际翻转行。approval abort=抛错 / ask_user abort=注入续轮（A6 文档化，不对齐实现） |
| D6 | destructive 清单 | 删除硬编码 Set；`listDestructiveNativeOpsForApproval()` 从 registry 派生；创建/写入类标 `approvalExempt` |
| C6 | 半开探测纪元 | half-open 发放 probeToken；record* 校验令牌；迟到无令牌事件忽略 |
| C5 | llmBudget hydrate | 启动 await hydrate + 同日 max 合并；日预算软语义「估算下界、并发可超」 |

### 待办：LLM 预算预留制

日预算当前为软闸（见 concurrency.md §13）。若未来要硬上限，需独立工单做「登记占用再放行」预留制，不在本 PR 范围。

---

## 心跳调度与 Task 认领（2026-07-20，PR-3 arch/heartbeat-scheduler）

### 背景

体检 C1/C2/C4/C7：恢复扫描只认 `[async]` → 心跳/cron 僵尸永久卡闸；refresh 无串行化双发 cron；心跳计数整 blob RMW 丢计数/吞清零；Task 三入口 check-then-act 可叠跑。

### 决策

| 编号 | 决策 | 结论 |
| --- | --- | --- |
| C7 | 认领单点 | `infra/taskClaim.ts`：`claimTaskRun` / `claimExclusiveSessionTaskRun`；TaskService.run、TaskScheduler、TriggerEngine 共用；落选 `TASK_ALREADY_RUNNING` |
| C1 | 僵尸恢复面 | `recoverStaleAsyncJobs` OR 收拢 `[async]`/`async_agent`/`[heartbeat]`/`cron`/`oneshot`；非 async 默认 failed「服务重启，任务中断」；心跳创建 queued→获槽认领 running；池拒绝标 failed「队列满」并计 streak |
| C2 | refresh 串行 | 单条 promise 链 + generation 令牌（coalesce 只落地最新一代）；stop 递增代际作废在途 refresh |
| C4 | 计数原子化 | 运行态 `lastRun*`/`consecutiveFailures` 用 SQLite `json_set`（失败 SQL 自增）；禁止整 heartbeat blob 覆写配置态 |

**回答**：按上表落地（分支 `arch/heartbeat-scheduler`）

---

## W2 心跳决策层（2026-07-21，feat/heartbeat-decision）

### 背景

PR-3 后心跳仍是「cron 到点 → 预算检查 → 直接 dispatch」。缺少「这一 tick 该不该跑」的决策层：等人时空转、无进展不退避、目标闭合后永不停止。参考 loopx 的 quota should-run / scheduler_hint，但刻意简化。

### 决策

| 项 | 选择 | 理由 |
|---|---|---|
| 模块形态 | 纯函数叶子 `heartbeatDecision.ts`，signals 注入，禁止 prisma | 可测性是命根子；决策表单测不依赖 DB |
| 退避实现 | **skip 计数**代替动态改 cron（`skipTicks=min(prev*2+1, quietCap)`） | 避免改 cron 表达式的复杂度与调度抖动；与 loopx 有意偏离 |
| reset_token | sha1(openApprovals\|askUser\|queued\|lastRunId\|failures\|userMsgBucket) | 有新进展/变化立即全速；用户消息按 5min 分桶避免每 token 重置 |
| terminal | 连续 K 次 quiet（无 gate/队列）→ `terminal_no_followup`，**复用** `heartbeatSuspendedAt` + `decision.terminalAt` | 不新造开关；refresh 见 terminalAt 不自动摘除；配置变更/resume 清零 decision 后可复活 |
| repair（v1） | mode 预留；引擎按 bounded_delivery 跑并追加固定句「上轮无实质进展，请重新规划下一步」 | 完整 stall 属 W5；packet 形状为后续预留 |
| 总开关 | `config.yaml` `heartbeat.decisionEnabled`（默认 true） | 可整体回退到点即跑 |
| 持久化 | `Agent.heartbeat.decision` 子键 `json_set`，禁止整 blob 覆写 | 对齐 PR-3 C4 运行态/配置态分列 |

**回答**：按上表落地（分支 `feat/heartbeat-decision`）

---

## PR-5 流式内核不变量（2026-07-21，arch/stream-kernel）

### 背景

体检 A1–A5 + E3 服务端：合成轮吞 Abort、SSE id 双命名空间、compact 双写无 CAS、起流互斥二值化+共享占位键、inject 随 RunState GC、stop/abort partial id 无契约。

### 决策

| 编号 | 决策 | 结论 |
| --- | --- | --- |
| A1 | synthesizing 终态 | AbortError 用 `isAbortLikeError` 重抛；`finalizeRun` 拒绝 aborted→success（唯一合法 cancelled） |
| A2 | 事件 id | `SessionStreamEvent.seq` per-session 单调；SSE/`resumeAfter`/重放同源；token 合帧带尾帧 seq；DB 已有 done 不补 synthetic done |
| A3 | compact | `compactGeneration` 显式列 + 单事务 CAS；running 拒手动 compact |
| A4 | 起流互斥 | `started` / `duplicate` / `busy`；占位键每 POST 唯一；busy→409（web 排队属 PR-6） |
| A5 | inject 持久化 | 接受即写 `SessionQueueItem(kind=steer\|follow_up)`；ack 删行；收尾未消费移交 `kind=user`；PR-4 未合不引入 claimedAt |
| E3 | abort 契约 | stop 响应 `partialAssistantMessageId`；预生成 id 与落库同值（web 消 setTimeout 属 PR-6） |
| P11 附带 | 单主会话 | `SessionService.create/update(isMainSession)` 摘掉同 Agent 其它主标记，避免 prepare/spawn findFirst 命中空壳 |

**回答**：按上表落地（分支 `arch/stream-kernel`）

---

## PR-6 Web Chat store 不变量（2026-07-21，arch/chat-web-store）

### 背景

体检 E1–E6：ACK 乐观 mark 永久丢异步结果；COMMIT_STREAM 接受 streaming→idle 直跳；abort 靠 `setTimeout(2000)` 赌 partial 落库；prefetch hydrate 误置 drainRequested；hydrate 整列覆盖 SSE 新内容；sessionChanged 全量替换抹无 dbId 本地项。

### 决策

| 编号 | 决策 | 结论 |
| --- | --- | --- |
| E1 | ACK 标记时机 | `claimed:true` 之后才 `markDeliveryConsumed`；失败路径 `unmarkDeliveryConsumed`；不变量收进 `ackThenMarkDelivery` |
| E2 | 相位合法性 | COMMIT 合法源 `done\|error`；COMPLETE←streaming；FAIL/ABORT←streaming\|done；streaming 释放走 `ABORT_STREAM` |
| E3 | abort 协议 | stop 响应 `partialAssistantMessageId`→`setPendingAbortPartial`→AbortError `abortStream`；有 id 等对齐，null 立即 idle；删除 2s 计时器 |
| E4 | hydrate 意图 | `MessageHydrateSource = view\|prefetch`；仅 view 调 `hydrateDone`；`DrainTriggerSource` 类型枚举 INV-8 合法源 |
| E5 | hydrate 新鲜度 | same-id 复用字段 compare-skip + `pickFresherMessage`（更长 assistant / 更丰富元数据优先） |
| E6 | 队列水合 | 切会话与同会话统一 `mergeUserQueueFromDb`，单一「DB + local-only」入口 |

**回答**：按上表落地（分支 `arch/chat-web-store`）

---

## W4 context 钩子链（2026-07-21，feat/context-hooks）

### 背景

每轮发给 LLM 的上下文原由 `promptBuilder.buildSystemPromptWithHints` 硬编码拼装（记忆、tier 身份、工具引导）。要对齐 pi extensions 的 `context` 事件（每次 LLM 调用前可非破坏性改写消息列表），并给后续 RAG/技能注入留开放链路。

### 决策

| 项 | 结论 |
| --- | --- |
| 模块 | 叶子 `infra/contextHooks.ts`：只依赖类型 + promptBuilder 片段构建；不 import loop/prisma |
| 接入点 | `reactLoop` 每次 `transport.complete` 前（含 synthesizing）；sync/stream 共用 |
| 内建钩子 | `memory`(100) → `tier-identity`(200) → `tool-guide`(300) → `agent-extras`(400)；拼装顺序仍为历史 `base + identity + memory + guide`（memory 先跑完成检索，片段入 scratch，agent-extras 最终合成） |
| v1 等价性 | 内建钩子 `enabled: round === 1`，保持「每 run 开头注入一次」；「每轮生效」留给后续具体钩子自行选择 |
| 开放面 | `registerContextHook` 导出；v1 无技能声明配置面、无 config.yaml 新节 |
| 不做 | 钩子热重载 / 外部包安装（登记待办）；不改变注入文案本身 |

**回答**：按上表落地（分支 `feat/context-hooks`）
