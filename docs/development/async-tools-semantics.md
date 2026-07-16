# 异步工具语义：spawn_subagent × async_task_run

> 本文档是 KnowPilot 两个后台任务工具的**完整语义参考**：定位分工、waitForResult 双模式全生命周期、deliverToQueue 分流与右栏展示、「结果不丢」三层兜底、取消语义、Q4 血缘继承防死锁、async_task_status 去全文的动机。
>
> 所有论断带「文件:行号」出处（行号以 2026-07-16 工作区为准）。设计决策全文不在此重复，只做交叉引用（见文末 §8）。并发不变量的系统性表述见 `concurrency.md` §6/§7，本文是其工具语义侧的展开。

**阅读地图**：

| 模块 | 文件 | 角色 |
|---|---|---|
| `spawn_subagent` 工具 | `apps/server/src/infra/tools/native/session.ts` | 带 LLM 子 Agent 任务（两模式） |
| `async_task_*` 工具 | `apps/server/src/infra/tools/native/shell.ts` | 纯工具后台任务 + 状态查询 + 取消 |
| 全局任务池 | `apps/server/src/infra/asyncJobOrchestrator.ts` | 并发容量单一事实源（v8 TP-1/TP-2） |
| 调度中介者 | `apps/server/src/infra/swarmOrchestrator.ts` | dispatch → 权限 → 60s 去重 → 池/inline → 聚合审计（W10） |
| 任务管理器 | `apps/server/src/infra/asyncJobManager.ts` | Task 落库、执行体工厂、投递/消费/对账/重启恢复 |
| 右栏 | `apps/web/components/chatQueue.tsx`、`chatRightPanel.tsx` | 两级分组（异步队列 / 同步任务）+ 三组状态 |

---

## 1. 两工具定位分工

v7 收敛后的分工只有一条判据：**要不要 LLM**。

| | `spawn_subagent` | `async_task_run` |
|---|---|---|
| 执行内容 | 带 LLM 的子 Agent 任务（独立 tier=sub 子 Agent + 子会话） | 纯工具调用（不跑 LLM，`toolCall` 必填） |
| 底层实现 | `agent_create_sub` + `agent_send_message({ autoRun: true })`（session.ts:52-53 头注） | 经 `startAsyncAgentTask` 以 `mode: "tool"` 入池（shell.ts:39-40） |
| 工具定义 | session.ts:807-828 | shell.ts:126-141（`required: ["task", "toolCall"]`，:139） |
| 工具描述自指 | 「要跑带 LLM 的子任务请用 spawn_subagent」（shell.ts:128） | 同左 |

关键事实：

1. **`async_task_run` 的 `mode` 参数已从工具层删除**（W-D）。handler 强制 `toolCall.tool` 必填，缺则抛错（shell.ts:20-27，注释「W-D：工具不再提供 mode=llm；带 LLM 的后台子任务一律走 spawn_subagent」）。
2. **`mode: "llm"` 执行体仍保留**：`buildAsyncExecute` 的 llm 分支（asyncJobManager.ts:1258-1560）是前端「派生子代理」按钮（tRPC `session.spawn` / `session.rerun`）与手动重试（`retryAsyncJob`，:2030 起）的执行体——工具面收窄 ≠ 执行体删除。
3. **`async_task_wait` 工具已整体删除**（注册表/权限清单/UI 全清，含负向断言）。「启动后改主意要结果」的正确姿势 = `agent_send_message` 经服务端持久队列（W-E）催子 Agent 提前 `report_back`。
4. 纯工具任务也有 LLM 预算豁免：只有 `mode === "llm"` 才 `assertLlmBudget`（asyncJobManager.ts:1607-1610）。
5. 入池拒绝（`maxQueued` 满）时两个工具口径一致：回收已建的 Task 行置 failed 并把错误上抛给 LLM——「任务池队列已满（maxQueued=N），请稍后再派」（asyncJobOrchestrator.ts:197-198；spawn 侧回收见 session.ts:150-163，async_task 侧见 asyncJobManager.ts:1794-1803）。

---

## 2. waitForResult 两种模式全生命周期

两个工具的 `waitForResult` 语义**完全一致**（v7 四象限表，`design-decisions.md` :847-856）：

- `false`（默认）= **异步投递**：工具立刻返回，结果经异步队列回流父会话；
- `true` = **同步等待**：父流挂起，结果作为**工具返回值**（tool return）进父当前 ReAct 轮，不进异步队列。

分流的物化点只有一个字段：**`deliverToQueue: !waitForResult`**——spawn 侧在跟踪 Task 的 input 写入（session.ts:332-333，注释「同步等待：结果走 tool return，禁止 autoConsume 二次喂给父会话」）；async_task 侧同样写法（shell.ts:42-43）。

### 2.1 waitForResult=false（异步投递）：入池 → 执行 → 队列回流

以 `spawn_subagent` 为例（async_task_run 同骨架，执行体换成 `runToolOnly`）：

1. **前置检查**：会话上下文 + `maxSubagentsPerSession` 数量上限（running/queued 子会话计数，session.ts:74-82）。
2. **dispatch 中介者**：`orchestrator.dispatch({ schedule: "pool" })`（session.ts:126-149）。中介者同步段完成权限校验（swarmPermissionGuard 单点复用）与 **60 秒去重窗口**——同 (agentId, sha1(taskText)) 窗口内重复派生直接返回已有任务句柄（`SWARM_SPAWN_DEDUP_WINDOW_MS = 60_000`，swarmOrchestrator.ts:29；命中方拿早结 attach 即返回，不等池任务收口，session.ts:137-138）。
3. **Phase A 准备段**（`spawnSubagentPrepare`，session.ts:210-345）：创建/解析子 Agent → **find-or-create 子 Agent 主会话**（状态落 `queued`，session.ts:267——右栏可见「agent 未启动」；必须在此建会话，否则同步等待失去完成判定锚点，:261-266 注释）→ 创建父会话**跟踪 Task**（`type: "async_agent"`、`status: "queued"` + `queuedAt`，:308-335）。**池任务 id = 跟踪 Task id**（prepare 返回 `{ jobId }`，session.ts:142-146）——这是取消同源的根基（见 §5）。
4. **排队期**：跟踪 Task / 子会话状态为 `queued`；池记录 `reason`（首个卡住的上限）+ `position`，右栏展示「第 N 位 · 因 X 上限排队」（asyncJobManager.ts:1109-1164）。
5. **获槽起流**（`spawnSubagentPooledRun`，session.ts:350-412）：跟踪 Task `queued → running`（:366-369）→ `claimOccupancy(子会话)` 防 Q2 双算（:371-374）→ `agentSendMessageTool({ autoRun: true, waitForRun: false })` 非阻塞派活（:378-388）→ 挂 abort 级联（:394-398）→ **`await hub.waitFor(子会话)`：槽位持有到子会话本轮流结束**（:400-404）→ `finally releaseClaim()`（:409-411）。
6. **结果回流**：子 Agent 完成后调 `agent_report_back` → 桥接按**血缘键精确匹配**跟踪 Task（`input.path = "$.subagentSessionId"`，swarm.ts:790-801；零兼容纪律：miss 不做时间窗模糊兜底，:802-804 注释）→ Task 置 `success` + `output.asyncResult` → `notifyAndAutoConsumeAsyncDelivery`（swarm.ts:876-887）。纯工具任务（async_task_run）无 report_back，由执行体 `runToolOnly` 直接落终态并 notify（asyncJobManager.ts:1432-1499）。
7. **消费续跑**：`notifyAsyncDelivery` 推 SSE `async_delivery` 事件 + 触发 `autoConsumeAsyncDelivery`（asyncJobManager.ts:482-507）——详见 §4 第一层。

入池前的初始状态标签与池准入口径同源：`willQueue = runningGlobal + hubInteractiveRunning >= maxGlobal`（asyncJobManager.ts:1623-1624），工具返回文案据此区分「已排队」/「已启动」（:1808-1812）。

### 2.2 waitForResult=true（同步等待）：inline 血缘继承 → 四条件空闲判定 → tool return

1. **dispatch `schedule: "inline"`**（session.ts:184-197）：**不入池、不占新槽**（Q4，见 §6）。Phase A 同 2.1，但子会话与跟踪 Task 初始状态为 `running` + `startedAt`（session.ts:267、:314），且 `deliverToQueue=false`。
2. **槽位让渡**：prepare 段内 `releaseClaim = pool.claimOccupancy(子会话)`（session.ts:193），把子会话 hub 流从「hub 交互 running」口径剔除；dispatch 返回后 `finally releaseClaim()`（:197-201）。
3. **派活**：`agentSendMessageTool({ autoRun: true, waitForRun: false })`（session.ts:425-435）。
4. **轮询等待**（`spawnSubagentSyncWait`，session.ts:418-596）：每 400ms 一轮（:548），上限 10 分钟（:451）。两条完成路径：
   - **路径 ① 子主动 report_back** → 跟踪 Task 被桥接置 `success/failed` → 读到终态即取 `output.asyncResult` 返回，并把 Task 标 `delivered=true`（:461-477）；
   - **路径 ② 空闲抓取**：暖机（见过子流或已满 2s，:514）+ **四条件真空闲判定** `isSubagentSessionSettled`（session.ts:35-42）→ 抓子会话最后一条 assistant 作为结果（:521-525），Task 置 success + delivered（:530-543）。

   四条件缺一不可（session.ts:27-34 头注）：`streaming=false`（无活跃流）、`runStarting=false`（无「drain 已认领、流未起」的间隙标记，缺它会抓到前轮旧 assistant 当本轮结果）、`nestedActive=0`（子会话内无 running/queued Task）、`queuedItems=0`（无待处理队列项，覆盖前轮结束到 drain 认领之间的窗口）。
5. **超时兜底**：10 分钟未完成后最后再抓一次（:551-562），仍无内容则返回 failed + `agent_inspect` 提示（:564-579），**不编造 ID**。
6. **结果形态**：作为工具返回值（tool return）进父当前 ReAct 轮，`content` 截 500 字符展示、全文在 `attach.content`（:582-595）。**不进异步队列、不成气泡**。

`async_task_run(waitForResult=true)` 更简：入池执行（纯工具也走池容量准入）→ `waitForAsyncJob` 每秒轮询 Task 终态（上限 10 分钟，asyncJobManager.ts:1995-2018，其唯一调用方）→ 结果作为 tool return 返回 → 标 `delivered=true` 杜绝 worker 侧误投递/竞态二次消费（shell.ts:46-56）。

### 2.3 同步等待的结果为什么不会被二次投喂

三道互斥保证「tool return 已交付 → 队列永不送」：

- `deliverToQueue=false` 使 `autoConsumeAsyncDelivery` 直接 skipped（asyncJobManager.ts:339）；
- 拉取侧四处过滤（见 §3）使同步任务永不进队列数据；
- tool return 时标 `delivered=true`（shell.ts:48-56；spawn 路径 :473-475 / :531-543），CLAIM 条件写（`where delivered=false`）天然不命中。

旁路邮箱同步终结：report_back 桥接发现跟踪 Task `deliverToQueue === false` 时，把 AgentMessage 直接记账 `consumed`（swarm.ts:860-875，W16a-②），不走进 notify 管道。

---

## 3. deliverToQueue 分流与右栏两级分组

### 3.1 分流字段语义

`deliverToQueue`（Task.input 字段，asyncJobManager.ts:89-94）是**结果送达方式**的唯一开关，与「是否入池执行」正交（config.yaml 注释：「池只控制并发调度（queued → running）；是否异步投递由工具的 waitForResult 决定」）：

- `true`（默认）：结果进**异步队列**——可拉取、可 pin、被原子 CLAIM 后注入气泡并触发父续跑；
- `false`：结果走 **tool return**——不进队列、不进气泡、不可 pin/consume，仅右栏「同步任务」区展示。

### 3.2 拉取侧四处过滤（两级分组隔离）

tRPC `agent.pullAsyncQueue` 一次返回五组数据（router.ts:208-217）：`deliveries`（待消费）/ `running` / `queued` / `consumed`（已消费）/ `syncTasks`（同步任务）。前四组全部排除 `deliverToQueue === false`：

| 函数 | 过滤位置 | 用途 |
|---|---|---|
| `pullAsyncDeliveries` | asyncJobManager.ts:990 | 待消费队列（附注：修窗口漏洞——sync 任务完成落库到 tool return 标 delivered 之间会被误拉进队列） |
| `pullConsumedAsyncDeliveries` | asyncJobManager.ts:1022 | 「已消费」追溯（最近 30 条） |
| `listRunningAsyncJobs` | asyncJobManager.ts:1063 | 异步 running（否则 running 期间双分组重复展示） |
| `listQueuedAsyncJobs` | asyncJobManager.ts:1109 | 异步 queued（带 position/reason） |
| `listSyncAsyncJobs` | asyncJobManager.ts:1165-1222 | **只收** `deliverToQueue === false`（:1183），状态判定与 `getAsyncJobStatus` 同源（orchestrator isRunning/isQueued 优先，DB 兜底，:1185-1199） |

### 3.3 右栏两级分组（W-A + TP-3）

前端 `RuntimeStatusPanel`（chatQueue.tsx:812-1049）：

- **一级分组**：「异步队列 / 同步任务」两个 tab（chatQueue.tsx:902-938），由 `groupTab` 受控切换（chatRightPanel.tsx:46-49 注入）。
- **异步队列**（TP-3 三组状态模型）：
  - **进行中**：running 在前、queued 在后按池位置升序（chatQueue.tsx:822-833）；queued 行展示「第 N 位 · 因 X 上限排队」；
  - **待消费**：终态且 `delivered=false`；`pinned` 为子组「钉住·未喂入」（:834-836、:987-988）——pinned 结果不被自动 CLAIM（CLAIM 条件含 `pinned: false`，asyncJobManager.ts:413），仅供展示；
  - **已消费**：`delivered=true`（success/failed 是 badge 不是独立组）。
- **同步任务**：进行中（queued/running，可取消）/ 已结束（completed/failed）两组（:890-898、:949-958）。

`SyncTaskRow`（chatQueue.tsx:706-810）是**只展示**行：无 pin、无消费、无气泡发送（:706 头注）；结束后仅显示 **120 字符结果预览**（`:720`，`(item.error ?? item.asyncResult)?.slice(0, 120)`）；进行中可展开 logs、可取消（:773-806）。

### 3.4 推优先、轮询兜底

右栏数据以 SSE 为主、轮询为兜底（chat.tsx）：

- `agent.pullAsyncQueue`：SSE `async_delivery` / `async_job_update` 即时触发 refetch；**仅查询出错时 15s 短轮询兜底，正常不 interval**（chat.tsx:354-362）；
- `agent.asyncQueueStats`：SSE `async_job_update` 带 stats；60s 兜底防漏（chat.tsx:347-352）；
- SSE 推送源：`wireAsyncJobPush` 把池生命周期事件（queued/started/completed/cancelled/failed/timeout）桥接到 SessionStreamHub（asyncJobManager.ts:809-840，index.ts:146 挂载）。

---

## 4. 「结果不丢」三层兜底

从「任务完成」到「气泡进会话」的链路：**CLAIM（认领交付）→ 注入（写消息 + 起流续跑）→ 对账（兜底自愈）**。三层不变量全部收在服务端 `asyncJobManager.ts`。设计决策见 `design-decisions.md`「投递可靠性 Q1/Q2」（§8）。

### 4.1 第一层：原子 CLAIM —— `Task.delivered` 条件写是唯一互斥点

- 全文交付的认领方有两个：服务端 `autoConsumeAsyncDelivery`（asyncJobManager.ts:322）与前端 ack `markAsyncDeliveryConsumed`（:1047）。两者共用**同一把锁**：`updateMany where { id: jobId, delivered: false, pinned: false } → delivered: true`（:405-414 / :1050-1059），条件写竞态原子，落选方 `count=0` 静默跳过。
- CLAIM 与 W14 账本记账（`markAgentMessageDeliveredByTaskRef`，按 `taskRef=jobId` 幂等）在**同一事务**内——不存在「Task 已 delivered 但旁路邮箱仍 pending」的中间态。
- CLAIM 必须发生在注入**之前**：挪到注入之后会造出两个各自注入的消费者，同一结果双注气泡。
- 消费续跑走**高优池通道** `runConsumeJob`（队首优先 + 仍受全局占用约束；CLAIM 移到**获槽后**执行，等槽超时（缺省兜底 30s，asyncJobOrchestrator.ts:63）未获槽则放弃本轮、delivery 原样留待下次触发（不丢），asyncJobManager.ts:392-476）。同会话的自动续跑经 per-session 串行链 `enqueueSessionAutoConsume` 串行化（:195-220）。

### 4.2 第二层：同链即时回滚 —— 宁漏勿错

CLAIM 与气泡写入之间隔着无法同事务的 SSE 起流，失败分两类（asyncJobManager.ts:387-391 头注）：

- **确定未写消息**（唯一可判路径）：`hub.startIfNotRunning` 返回 false（别的流占线，runner 未执行，消息必然未写入）→ `rollbackAsyncDeliveryClaim`（:303-316）条件写回滚 `delivered=true→false` + 同事务回滚 W14 账本（delivered→pending）+ 重挂消费链队尾（:461-476）。不丢、不重复。
- **无法判定**（如 `started=true` 后流中途抛错）：消息可能已写入，回滚会重复投喂——**一律不回滚**（:449-456），交第三层对账。

原则一句话：**宁漏回滚勿错回滚**——漏回滚有对账者补，错回滚必重复投喂。回滚本身也是条件写（`updateMany where delivered=true`），与正常 CLAIM / 前端 ack 条件互斥：期间已被正常消费的记录条件写不命中，调用方放弃回滚不补投。

### 4.3 第三层：reconciler 对账 + runStartupRecovery 重启恢复

**对账者 reconciler**（`reconcileAsyncDeliveries`，asyncJobManager.ts:582-708；`startAsyncDeliveryReconciler` :709-722 挂载于 index.ts:299，启动即扫 + 周期扫，周期复用 `stream.cleanupIntervalMs`，shutdown 停于 index.ts:315）：

- **Pass 1（R-1 孤儿）**：扫「`delivered=true` 且终态、超龄（`RECONCILER_MIN_DELIVERED_AGE_MS = 60_000`，:555）、未 pinned、`deliverToQueue ≠ false`」的候选，用 **`json_extract` 裸查 ChatMessage** 判定 ground truth（:625-629：会话里存在 `toolResults.subagentResult.jobId = X` 的气泡 = 已注入）——有气泡跳过，无气泡 → 条件写回滚 → `notifyAsyncDelivery` 重走正常管道补投（:635-648）。每轮上限 `RECONCILER_BATCH_LIMIT = 50`（:549）。
- **Pass 2（R-2 未投递）**：扫「`delivered=false` 终态超龄、未 pinned」的未投递（重启丢失 notify / 消费链放弃后无再触发）→ 直接重新 notify（:651-695）；会话已删除/归档的跳过避免空转（:674-684）。
- **ChatMessage 是唯一 ground truth**：交付是否完成只看气泡在不在，不看 Task 标志位。全部动作幂等，对账者跑多少轮、与其他写方如何交错都不会出错。

**重启恢复**（`runStartupRecovery`，asyncJobManager.ts:764-788；index.ts:261 启动序列挂载），四动作顺序敏感、全部条件写幂等：

1. 僵尸 running/queued async Task → failed「服务重启，后台任务已中断」（`recoverStaleAsyncJobs`，:887-920，同步子会话置 failed）。**不自动重跑**——tool 任务有副作用（写文件/发请求），进程死亡时进度未知，盲目重跑可能重复执行；`retryAsyncJob` 保留手动重试，把「要不要承担重复副作用」的决定权交还给人。
2. 僵尸 running ChatSession → paused（`updateMany` 条件写，:771-775；先于动作 3——drain 重注册会把有真实积压的会话重新置 running）。
3. superior 孤儿 SessionQueueItem → 重注册 drain（v7 W-E 机制，:777-778）。
4. `delivered=false` 终态未投递 + R-1 孤儿 → 合并对账首轮（与 reconciler **同一幂等入口** `reconcileAsyncDeliveries`，:780-781，不造第二条恢复路径）。

---

## 5. 取消语义：cancel / stop 同源 + abort 级联

**同源根基：池任务 id = 跟踪 Task id**（session.ts:142 注释；swarmOrchestrator.ts:75-76 prepare 头注）。因此 LLM 侧的 `async_task_cancel` 与 UI 侧的 `session.stop` 取消的是**同一条任务**。

### 5.1 `async_task_cancel`（LLM 工具，按 jobId）

`cancelAsyncJob`（asyncJobManager.ts:1223-1256）：只接受 `running` / `queued`（终态不允许取消，:1230-1233）→ `orchestrator.cancel(jobId)`（asyncJobOrchestrator.ts:298-313）：running 则 `controller.abort()`；queued 则移出队列、清排队超时、回调 `onQueuedDrop` → Task 回写 failed（:1248-1255）。orchestrator 未命中（刚好执行完未 poll）则把残留 running/queued 标 failed 防永久占坑（:1237-1246）。

### 5.2 `session.stop`（UI，按 subagentSessionId）

tRPC `session.stop`（router.ts:475-506）：`kind === "subagent"` 时走 `stopSubagentSession`（asyncJobManager.ts:2019-2028）：

1. `orchestrator.stopSubagent(subagentSessionId)`（asyncJobOrchestrator.ts:317-334）：运行中 → abort 并回传 jobId；排队中 → 按 `metadata.subagentSessionId` 移出队列；
2. **级联 `getStreamHub()?.stop(subagentSessionId)`**（asyncJobManager.ts:2026）——同时中断 SessionStreamHub 的 SSE 运行，前端立即停止流式输出；
3. 排队任务被移出队列后不触发执行体 finally，由 router 手动回写 Task failed「异步任务已取消（用户停止）」（router.ts:484-496）；运行中任务的会话状态由 `buildAsyncExecute` 的 catch 统一回写 paused，stop 处不重复写避免竞争（router.ts:497-503）。

### 5.3 abort 级联与超时

- 池内 spawn 执行体：`signal` abort → `hub.stop(子会话)`（session.ts:394-398），中断/超时真正停子会话流；
- `buildAsyncExecute` hub 路径同样挂 `signal → hub.stop`（asyncJobManager.ts:1534-1535）；
- 池任务级超时：`start()` 内 `setTimeout(controller.abort, timeoutMs)`（asyncJobOrchestrator.ts:388-391），`timeoutMs` 任务级覆盖、缺省 `config.asyncJobs.taskTimeoutMs`（300s）。

---

## 6. Q4 槽位血缘继承：为什么能防 maxGlobal=1 死锁

**死锁场景**（v8 压测背景）：`maxGlobal=1` 时，父池任务占着唯一槽位调 `spawn_subagent(waitForResult=true)`，父流挂起等子结果。若子执行也按普通任务入池等槽——**父占槽等子、子等父腾槽**，经典循环等待死锁。

**解法**（已落地，session.ts:180-206）：子执行视为**父槽位让渡**——

1. `schedule: "inline"`：dispatch 全程**不 enqueue**（swarmOrchestrator.ts:204-226 的 inline 分支），与池准入零交集；
2. `claimOccupancy(子会话)`（session.ts:193）：把子会话 hub 流从「hub 交互 running」口径剔除（Q2 口径见 asyncJobOrchestrator.ts:165-179），子执行期间全局占用不变；
3. 不变量一句话：**同一血缘同时只有一个执行体占槽**（asyncJobOrchestrator.ts:11-13 头注）。

容量语义随之精确化：`maxGlobal` 从「并发任务数」变为「**并发血缘数**」，与 LLM 成本口径一致——父挂起期间其槽位血统让给子，账上还是一份并发。

**负向验证**（v8 TP-4 压测）：`globalTaskPool.test.ts:1223`「Q4 死锁回归」——父执行体持 maxGlobal=1 唯一槽，池内 `executeNativeTool(spawn_subagent, waitForResult=true)`，`vi.waitFor(parentDone, 12s)` 为判定上限；若 inline 也走池准入（坏变体），子等槽（`queuedTimeoutMs=0` 无限等）→ 12s 处必红。另有 `:401` TP-1 例从工具入口视角再验一遍（「maxGlobal=1 被占满仍能跑完」）。审查记录见 `review-final-task-pool.md` §2。

---

## 7. async_task_status 为什么只回状态不回全文

**07-15 事故教训**（`design-decisions.md` 问题 G 补充，:41-119）：子 Agent「最终结果」到达父会话曾存在**两条路径**——

| 通道 | 路径 | 消费语义 |
|---|---|---|
| A. 轮询读取 | 父调 `async_task_status` → 读 `task.output` 全文 | 查询消费（读了内容，不改任何状态） |
| B. 队列消费 | report_back/任务完成 → Task success → 原子认领 → 气泡 + 父续跑 | 呈现消费（`delivered=true`，用户可见） |

事故中父 Agent 轮询 13 次经 A 读到全文并写进正式回复，B 通道不知道 A 读过，照插气泡并触发父第二轮 → **同一结果双份回复**。去重的本质是协调 A 与 B，而 A 读了全文不改状态、B 无从感知——竞态在机制上无法靠时序消除。

**根治 = 通道分工（单一到达原则）**，不是事后记账去重：

1. `async_task_status` **只回状态元信息**（status / taskLabel / elapsedMs / subagentSessionId / timeoutMs），不回结果全文与日志（asyncJobManager.ts:1932 头注「W-B：只回状态，不回结果全文/日志——结果完成后经队列唯一通道投递」；`getAsyncJobStatus` :1933 起；工具描述 shell.ts:146）。父想知道「跑没跑完」可以查，想知道「结果是什么」只有队列一条正路。
2. **结果全文唯一通道 = `Task.delivered` 原子 claim**（§4.1）。`async_task_wait` 这条「读全文不留痕」的逃生舱已整体删除。
3. 教训一句话：**同一结果有两条到达路径时，幂等去重必须做在投递层**（CLAIM 互斥点），不能靠读路径自觉——LLM 不可能再「轮询读到结果」，因为它根本读不到；双回复在机制上不可能发生。

「等不及想拿结果」的正确姿势：`agent_send_message` 经服务端持久队列催子 Agent 提前 `report_back`（W-E），或结束本轮等队列推送。

---

## 8. 交叉引用（决策全文不在此重复）

| 主题 | 位置 |
|---|---|
| v7 异步工具体系收敛（双工具四象限分工表 + 五条决策） | `design-decisions.md` :843-866 |
| 全局任务池 Q1（全局单池 vs 分层池） | `design-decisions.md` :870-887 |
| 全局任务池 Q2（交互式运行不入池但计入全局占用） | `design-decisions.md` :889-907 |
| 全局任务池 Q3（消费续跑高优通道，与执行正交） | `design-decisions.md` :909-928 |
| 全局任务池 Q4（waitForResult=true 血缘继承防死锁） | `design-decisions.md` :930-948 |
| 投递可靠性 Q1（S3「认领了但气泡没进会话」两层根治） | `design-decisions.md` :950-968 |
| 投递可靠性 Q2（重启恢复四动作语义） | `design-decisions.md` :970-989 |
| 07-15 事故与通道分工（问题 G 补充，A/B 双通道撞车） | `design-decisions.md` :41-119 |
| W16a-②（waitForResult 路径 AgentMessage 终结方式） | `design-decisions.md` :750-770 |
| 并发不变量（全局任务池 §6 / 投递可靠性 §7） | `concurrency.md` :116-202 |
| v8 任务池压测审查（Q4 死锁回归等 8 条逐项） | `review-final-task-pool.md` |
| 运行时配置（`asyncJobs` 节：maxConcurrent/maxPerSession/maxPerWorkspace/maxQueued/taskTimeoutMs/queuedTimeoutMs/maxRetries/maxSubagentsPerSession） | `config.yaml` |

**相关测试**：`__tests__/globalTaskPool.test.ts`（TP-1/TP-2/TP-4，含 Q4 死锁回归 :1223、50 spawn 压测 :866）、`__tests__/deliveryReliability.test.ts`（R-1）、`__tests__/startupRecovery.test.ts`（R-2）、`__tests__/async-task-queue.test.ts`（含 `async_task_wait` 注册表移除负向断言）。
