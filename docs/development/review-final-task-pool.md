# 全局任务池（v8）终审报告（2026-07-16）

> 审查范围：`master(0e1ffd6d)..HEAD`（TP-1~TP-5，共 6 commits：ac3560cf / be9e988f / e37ad920 / a8edf451 / 7a29deb8 / cf0418e7，28 文件 +2661/-523）。
> 审查方式：逐 commit diff 精读 + 关键源码通读（asyncJobOrchestrator / asyncJobManager / sessionStreamHub / swarmOrchestrator / session.ts / swarm.ts 全部 v8 改动面）+ 亲自实跑（lint / server 全量 vitest / globalTaskPool 定向分组实跑 / web vitest / mock e2e 全量 / grep 残留扫描）。未修改任何非 .md 源文件，未做任何 git 写操作，未动 dev.db / content/。

## 总结论：**通过**（2026-07-16 复审升级，原为「有条件通过」）

主链路全部正确：容量/互斥不变量确实收进了执行层（orchestrator），Q1~Q4 四条决策全部落地且机制成立（非时序补丁），18 例测试逐例反注水有效，v7 不变量零回归，实证全绿（lint 0 错、server 44 文件 455 passed/5 skipped、web 4 passed、mock e2e 19/19）。

**通过条件（1 条，必修）**：
1. ~~**P2-1（零兼容铁律违规）**：`agentReportBackTool` 保留了「无 subagentSessionId 旧数据」的兜底匹配分支（老时间窗语义）~~ → **已修（`0c0aa370`），复审实证关闭**（见文末「复审记录」节）。

**登记不阻塞**：S1（CLAIM→起流 TOCTOU，pre-existing）、S2（waitForRun + 池饱和 drain 放弃后读旧 assistant，v8 新边缘）、S3（cancel 级联杀共享会话流）、S4（hub.start 幻影 run 泄漏，pre-existing）、S5（reason 入队时快照不刷新，已文档化）。

---

## 必查 8 条逐项结论

### 1. spawn 压测真实性 —— ✅ 通过

- **亲自实跑**：`npx vitest run src/__tests__/globalTaskPool.test.ts` 分三组（TP-1=5 例 / TP-2=6 例 / TP-4=7 例）全部通过；TP-4 组 7 例 5.7s（50 spawn 压测单例 4011ms）。全量 server 套件 455 passed 同基线逐字一致。
- **峰值采样方式核查**（`globalTaskPool.test.ts:853-859`）：`orch.onAny(sample)` 事件通道 + `setInterval(sample, 5)` 定时通道双采样。`runningGlobal++` 在 `start()` 内同步执行且紧邻 `emit("started")`（orchestrator:377-386），峰值必被事件采样捕获；递减只降不升不会漏峰。断言 `toBeLessThanOrEqual(2)` + **`toBe(2)`**（确实打满过双槽，证明压测真实制造了并发压力，不是空转假绿）。
- **position 0..49 连续性**（:884-886）：`positions.sort()` 后与 `0..49` 比对——**集合语义**（无空洞/无重复/50 个全在队），天然与实现顺序无关，不会因 admit 顺序变化而假绿；只有当 position 不再来自池队列真实下标时才会失效（此时 getPosition 单测也会红）。
- **reason 全 global**（:887）：两 blocker 占满 maxGlobal=2 后 50 个 spawn 逐断言 `getQueuedReason==="global"`，旧实现（不入池）此 API 不存在、快照断言必红。

### 2. Q4 死锁 —— ✅ 通过

- **测试构造**（:1223-1279）：父执行体经 `orch.enqueue` 持 maxGlobal=1 唯一槽，在池内 `executeNativeTool(spawn_subagent, waitForResult=true)`；`vi.waitFor(parentDone, 12s)` 为判定上限。
- **推导验证**：若 inline 路径也走池准入（坏变体），子等槽（测试 config `queuedTimeoutMs=0` 不限 → 无限等）→ 父持槽等子、子等空槽 → 死锁 → 12s 处必红。断言能区分。
- **双重断言**：`peakRunning===1`（子全程未占新槽，事件采样捕获）+ `isOccupancyClaimed(subSessionId)===false`（claim 不泄漏）。实现侧（session.ts:185-206）：inline 路径 `prepare` 内 `claimOccupancy(子会话)`、`finally releaseClaim()`，dispatch 全程不 enqueue——与池准入零交集。
- 另有 TP-1「waitForResult=true 槽位血缘继承：maxGlobal=1 被占满仍能跑完」例（:401-434）从工具入口视角再验一遍。

### 3. Q2 双算 —— ✅ 通过

- **refcount 逻辑**（orchestrator:146-159）：claim 置计数+1 并立即 `drain()`；release 幂等（`released` 闭包标记，二次调用 no-op，测试 :89-90 实证）；release 内 `left<=0` 删键，嵌套 claim 各自 release 互不误伤。
- **调用点审计**（全仓 grep 实证，共 4 处生产调用）：`buildAsyncExecute` llm 分支（asyncJobManager:1087，claim→try/finally release，claim 与 `startIfNotRunning` 之间无 await 交错点）、`spawnSubagentPooledRun`（session.ts:371，finally release 在 `hub.waitFor` 解析后）、autoConsume execute（:357，CLAIM 事务后同步 claim，finally release）、superior drain execute（:236，同型）。四处全部「claim 包 finally release」，无泄漏路径。
- **口径**：`hubInteractiveRunning()`（:166-179）= provider 给的 hub 活跃流逐会话过滤 claimed；provider 在 admit 判定时刻读取（:432-434），hub 后注册也正确计数。真 hub 测试（:1281-1342）验证「交互流占 1 → 池只 admit 1 → 交互结束恢复 admit 2」。
- **onHubRunSettled 可靠性**：发射点在 `state.promise` 的**唯一 finally**（sessionStreamHub:297-306），`completed=true` 置位后立即同步触发；正常完成/异常 catch/abort（stop 走 signal→runner 收尾→finally）三路径全覆盖，无漏触发分支。
- **闭包延迟绑定**（orchestrator:446-453）：监听器读模块级 `_orchestrator` 当前值；池初始化前 `_orchestrator=null` → no-op，但池未建时不存在 queued 任务，**无事件可丢**；`resetForTests` 后 `_hubSettleWired` 保持 true、新实例经同一监听器延迟绑定拿到通知，不重复订阅。设计成立。

### 4. 消费续跑不丢 —— ✅ 通过

- **CLAIM 位置**：autoConsume 的 W14 事务（`updateMany(delivered:false→true) + markAgentMessageDeliveredByTaskRef` 同事务）逐字保留，整体移入 `runConsumeJob` 的 execute（获槽后、起流前）；drain 的 `consume()` 软认领同样移入 execute（asyncJobManager:225-252）。
- **未获槽**：`runConsumeJob` resolve false 时 execute 从未运行 → `delivered` 保持 false（TP-1 autoConsume 例断言 `delivered===false` + 队列无残留；TP-4 回收例再验「下轮触发成功 CLAIM + 真实续跑（user 注入 + mock assistant 落库）」完整闭环）。
- **queuedTimeoutMs 回收**：orchestrator:215-224 超时回调 `splice` 出队 + `onQueuedDrop`（→resolve false），execute 未运行；`clearQueuedTimeout` 在 drain admit 前清除，单线程下「已运行任务被超时误杀」不可能（回调 findIndex=-1 no-op）。
- **双 CLAIM 互斥点**：server autoConsume 与前端 `markAsyncDeliveryConsumed`（:634-650）共用**同一条 `Task.delivered` 条件 updateMany 原子更新**（SQLite 单写者串行化），落选方 `count=0` 静默返回——互斥在 DB 层，不靠时序。同 jobId 的两次 autoConsume 另受 per-session 串行链（`enqueueSessionAutoConsume`）排队。

### 5. 状态模型 —— ✅ 通过

- **数据源一致性**：`listQueuedAsyncJobs` 的 `position/reason` 直接来自 `orchestrator.getPosition/getQueuedReason`（池内存队列真实下标与判定）；`mergeAsyncPollIntoQueue` 映射为 `queuePosition/queuedReason`；`formatQueuedHint` 渲染「第 N 位 · 因 X 上限排队」（0-based→1-based 转换正确）。重启后 DB 残留 queued 行 position/reason 为 undefined，UI 省段降级（chatQueueTypes.ts:14-22），不造假。
- **「进行中」组**：`runtimeActiveItems = asyncResultQueue.filter(kind==="async-running")`，含 queued+running；组件内 running 在前、queued 按 position 升序（缺省排尾），queued 行 `preview = formatQueuedHint || text || lastLog`（chatQueue.tsx:535-540）。
- **sync 任务区无 pin/消费按钮**：e2e `async-task-mock.spec.ts:96-100` 四条 `toHaveCount(0)` 负向断言（置顶/取消置顶/发送/喂入按钮均不存在），实测通过（见实跑记录 #6，该 e2e 在正确的 mock build 下 19/19 绿）。
- 三组标题「进行中/待消费/已消费」e2e `toContainText` 断言（:104-108）——偏弱（只验标题存在），但有上述 sync 负向断言与 server 侧 position/reason 单测（asyncJobManager.test.ts:343-345）兜底，可接受。

### 6. 零兼容/单文件收拢 —— ⚠️ 1 处违规（P2-1）

- **兼容分支扫描**：全仓 grep `兼容旧|向后兼容|deprecated|旧格式|legacy` 生产代码零命中；但 `agentReportBackTool`（swarm.ts:724-746）新增「兜底：无 subagentSessionId 的旧数据」分支——**正是零兼容铁律禁止的「读路径 if（老格式）永久分支」**，且该分支完整保留了 TP-4 刚修掉的旧 bug 面（take:20 时间窗 + agentSnapshot.id 模糊匹配）。详见 P2-1。
- **容量判定唯一性**：`maxConcurrent/runningGlobal/maxGlobal` 全仓 grep——生产代码仅 `config.ts`（配置解析）、`asyncJobOrchestrator.ts`（唯一判定）、`asyncJobManager.ts`（统计透传/willQueue 标签与池同源）、`agentStream.ts:66`（SSE 事件负载类型声明，非判定）。nativeTools.ts/session.ts 无残留容量检查（session.ts 新增的 `maxSubagentsPerSession` 是子会话数量上限，非并发容量，与 startAsyncAgentTask 同口径）。
- **单文件收拢**：diff --stat 28 文件全部为既有文件修改 + 1 个新测试文件；无新建 service/orchestrator 零散文件；容量逻辑全在 `asyncJobOrchestrator.ts`。✅

### 7. 测试反注水 —— ✅ 通过

- **18 例逐例精读**：每例均带「旧实现挂点」注释且经代码推演成立。TP-4 七例全部为负向断言（50 spawn 峰值/拒绝/级联/回收/死锁/Q2 口径），TP-2 六例单元断言精确到 reason 分类计数与执行顺序数组，TP-1 五例为真 hub+真 DB 全链路。
- **TP-4 两个生产 bug 的回归测试区分度**：
  - report_back 精确匹配：50 spawn 压测即回归测试——旧实现 take:20 时间窗下，50 个跟踪 Task 并发时 running 的那 2 个是最老的（desc 序第 49/50 位），必被挤出窗口 → 失配僵尸 → 终态 `success×50` 断言必红。新实现按 `$.subagentSessionId` JSON 路径精确匹配，与并发度无关。
  - onHubRunSettled 活性：Q2 真 hub 测试第 3 步——无该接线时 chatGate 放行后无任何池事件触发 drain，job2 永留队列 → `vi.waitFor(isRunning(job2), 3s)` 超时必红。
- **无注水**：新测试文件 grep `expect(true)|it.skip|test.skip|describe.skip|xit(|.only(` 零命中；被修改的既有测试（agentMessageLedger W14 断言改轮询等 delivered）是 CLAIM 后移的如实适配（仍断言 delivered 达成），非弱化。

### 8. v7 无回归 —— ✅ 通过

- **`git diff master..HEAD -- asyncJobManager.ts` 通读**（416 行改动面）：autoConsume 的 W14 CLAIM 事务逐字保留（仅位移）；drain 的 consume 软认领/FIFO/per-session 串行链不动；`listRunningAsyncJobs/listQueuedAsyncJobs` 仅追加 reason 透传；`getAsyncJobStatus` 零改动（去全文不动）；`buildAsyncExecute` llm 分支仅外包 claim try/finally（waitFor/事件/终态落库语义不动）。
- **grep 防线**：`async_task_wait` 生产代码零命中（仅 async-task-queue.test.ts:123-133 负向断言）；`deliverToQueue===false` 过滤 5 处齐全（:280 autoConsume skip / :596 / :621 两处 pull / :660 / :709 两处 list）——v7 P3 修复成果完整。
- **两级分组**：e2e 同步任务分组例实测通过；W-E drain 的 `enqueueSuperiorQueueDrain` 签名仅加 `config`（所有调用方同批改完：swarm.ts:319、superiorQueueDrain.test.ts:366）。
- **v7 既有测试全绿**：server 455 passed/5 skipped 与基线逐字一致（含 W14 账本、T7 drain、超时档等 v7 断言）。

---

## 发现的问题清单

### P2-1（P2，必修·零兼容铁律）report_back 桥接保留旧数据兜底分支

- **位置**：`apps/server/src/infra/tools/native/swarm.ts:724-746`（agentReportBackTool 内 `if (!matched)` 兜底块）。
- **根因**：新精确匹配（`input.path=$.subagentSessionId`）未命中时，落入为「无 subagentSessionId 的旧数据」保留的 take:20 时间窗 + `agentSnapshot.id` 模糊匹配。当前所有生产路径（spawn Phase A session.ts:327、startAsyncAgentTask input）都写 `subagentSessionId`，该兜底**只服务 pre-v8 存量行**——而 dev.db 是缓存层可随时重建，铁律明确「数据迁移走一次性脚本，禁止在读路径写 if（老格式）永久分支」。且该分支把 TP-4 刚修掉的失配 bug 面（高并发下跟踪 Task 被挤出窗口→僵尸 running+重复投递）为旧数据原样保留。
- **修复建议**：删除兜底块，精确匹配未命中即按无匹配处理（现行为的 else 分支）；如需清理存量，写一次性脚本或 `db:push` 重建（符合「SQLite 是缓存层」）。
- **可否负向断言**：可——源码防线测试（swarm.ts 不得含 agentSnapshot.id 兜底匹配）或行为测试（构造无 subagentSessionId 的 [async] 行 + 同名 agent 多任务，断言不误配）。

### S1（P2 低，pre-existing 登记）autoConsume CLAIM→起流 TOCTOU：delivered=true 但内容未喂入

- **位置**：`asyncJobManager.ts:340-372`（execute 内 `hub.waitFor` → CLAIM → `startIfNotRunning`）。
- **根因**：waitFor 解析到 startIfNotRunning 之间，另一路径（用户发消息）抢先起流 → `started=false` → delivery 已 CLAIM（delivered=true、AgentMessage delivered）但内容从未注入任何运行 → UI 显示「已消费」而 LLM 从未见过。v7 同型存在（CLAIM 在 waitFor 之前，窗口同类），v8 未扩大。
- **修复建议**：`started===false` 时回滚 CLAIM（补偿事务 delivered=false）或将该 delivery 重新触发一轮 autoConsume（delivered 口径需配合调整）。
- **可否负向断言**：可（闸门构造「waitFor 后、start 前抢流」确定态，断言 delivery 可被下轮再触发）。

### S2（P2 低，v8 新边缘）waitForRun=true + 池持续饱和 ≥30s：drain 放弃后读旧 assistant 冒充结果

- **位置**：`asyncJobManager.ts:243-251`（drain admitted=false 直接 return）+ `swarm.ts:582-596`（`await drainPromise` 后无条件读最后 assistant 返回 success）。
- **根因**：v8 前 drain 永不放弃；v8 池准入后，该会话 drain 的消费任务 `consumeQueuedTimeoutMs`（缺省兜底 30s）内未获槽即放弃本轮——队列项未 claim 不丢（下次触发续上，正确），但 `drainPromise` 照常解析，`agent_send_message(waitForRun=true)` 随即读到的「最后 assistant」是**前轮旧消息**，以 success+content 返回给 LLM。需全局池持续饱和 30s+，概率低。
- **修复建议**：drain 放弃语义显式化——`enqueueSuperiorQueueDrain` 返回携带「是否处理完目标项」的信息（或 PrepareAgentRunResult 增 abandoned 标记），waitForRun 路径如实返回「已入队但池饱和未及时处理」，不读旧 assistant。
- **可否负向断言**：可（maxGlobal=1 占满 + waitForRun=true 派忙子，断言返回不含旧 assistant 内容、success 语义如实）。

### S3（P2 低，登记）spawn 池任务 abort 级联 hub.stop 会杀共享子会话上的他方流

- **位置**：`session.ts:389-392`（`signal.addEventListener("abort", () => hub.stop(subagentSessionId))`）。
- **根因**：子会话同一时刻只有一条流；池任务超时/取消时 stop 杀的是「子会话当前流」——若当前流属另一执行体（如 drain 续跑他条消息、占位流），会被误杀。这是「一会话一流」模型的固有边界，非 v8 引入；cancel 级联测试（:986-1086）验证的是 intended 路径。
- **修复建议**：可接受现状；若要收紧，stop 前校验当前流归属（run 与 jobId 绑定关系）。
- **可否负向断言**：构造复杂，建议登记观察。

### S4（P3 微，pre-existing 登记）hub.start 的 maxEventIdFor 抛错泄漏 completed=false 幻影 run

- **位置**：`sessionStreamHub.ts:265-270`（`runs.set` 后 `await maxEventIdFor` 无 try/catch）。
- **根因**：DB 读失败 → start() reject → runs 表残留 completed=false 条目（永不清理）→ `listRunning` 计入幻影交互 running → 池 admit 保守少放（失败方向安全，但口径失真）。
- **修复建议**：start 内 try/catch 失败时 `runs.delete(sessionId)`。
- **可否负向断言**：可（mock maxEventIdFor 抛错，断言 runningCount 不增）。

### S5（P3 微，已文档化）queued reason 为入队时快照，容量变化后不刷新

- **位置**：`asyncJobOrchestrator.ts:200`（入队记录 reason）+ `:365`（drain 注释「不随容量变化改写」）。
- **根因**：设计权衡（口径稳定、UI 可解释）；当首个卡住的上限从 global 变为 session 时，UI 仍显示 global。concurrency.md §6.2 已如实描述判定链语义。
- **修复建议**：维持现状（文档已声明）；如 UI 反馈困惑再改 drain 时刷新。

---

## 实跑验证记录（亲自运行，非转述）

| # | 命令 | 结果 |
|---|---|---|
| 1 | `npx vitest run src/__tests__/globalTaskPool.test.ts -t "TP-4"`（apps/server） | EXIT=0；**7 passed**（5.7s；50 spawn 压测 4011ms、Q4 死锁回归 526ms、Q2 真 hub、回收不丢 delivery 等） |
| 2 | 同上 `-t "TP-1"` / `-t "TP-2"` | EXIT=0；**5 passed** / **6 passed**（合计 18 例全过） |
| 3 | `pnpm --filter @knowpilot/server test` | EXIT=0；**44 文件 455 passed / 5 skipped**（102.3s），与基线逐字一致 |
| 4 | `pnpm lint` | EXIT=0；shared/server `tsc --noEmit` + web `eslint` 全过 |
| 5 | `pnpm --filter @knowpilot/web test` | EXIT=0；**4 passed**（1.9s） |
| 6 | `cd apps/web && pnpm run test:e2e:mock` | **19/19 passed**（52.3s），含 TP-3 三组状态模型与 sync 无 pin/发送按钮负向断言 |
| 7 | `git diff master..HEAD` 全量精读（28 文件）+ 关键文件通读 | 全部改动可映射到 TP-1~TP-5 声明范围，无夹带；发现 P2-1 一处违规 |
| 8 | grep 防线扫描（async_task_wait / maxConcurrent / deliverToQueue 过滤 / expect(true) / 兼容分支） | 全部符合预期，唯一例外 = P2-1 |

**e2e 环境排障记录（重要，非代码问题）**：首次直接跑 `test:e2e:mock` 时全灭（含 v8 前的 chat-mock 冒烟）——根因是仓库现有 `.next` 为**非 mock build**（rewrite 的 `SERVER_INTERNAL_URL` 在 build 时烘焙为 3010，而 mock e2e server 在 3011 → ECONNREFUSED，日志实证）。按仓库既定流程 `pnpm run build:mock` 重建后 19/19 全绿。结论：「mock e2e 19/19」基线成立；首次失败属测试环境产物，与 v8 代码无关。（说明：build:mock 与 e2e 运行会重写 `.next/`、`e2e/test-results-mock/` 等 gitignore 产物与隔离 test.db，属「跑测试命令」范畴，未触碰任何源文件/content/dev.db；跑完后端口与进程已确认无残留。）

---

## 复审记录（P2-1 修复复核，2026-07-16 追加）

> 复审范围：`0c0aa370`（fix: [review] 删除 report_back 桥接的 take:20 时间窗兜底分支，2 文件 +77/-18）。
> 复审方式：commit diff 精读 + 修复后代码通读 + 亲自实跑（定向 vitest + 相关 4 套件回归 + server lint）。未修改任何非 .md 文件，未做任何 git 写操作。

### P2-1 复核结论：✅ 修复成立，关闭

| 复核点 | 证据 |
|---|---|
| 兼容分支已删 | `swarm.ts:730-732`：原 `if (!matched)` 兜底块（take:20 时间窗 + `agentSnapshot.id` 模糊匹配）整体删除，替换为零兼容纪律注释；血缘键精确匹配（`input.path=$.subagentSessionId`）为**唯一**匹配方式 |
| miss 路径不丢 | `matched=null` 走下方既有 `create` 新 success Task 分支（`delivered:false`）——结果仍经正常 Task 管道投递（autoConsume/前端 CLAIM），不丢、不误投；`matchedInput?.deliverToQueue === false` 分支在 matched=null 时为 null 正确跳过，不会误走 waitForResult consumed 记账 |
| 负向断言有效 | 新用例「report_back 桥接零模糊兜底」（`agentMessageLedger.test.ts:218-290`）：干扰项 = 同子 Agent、异血缘键（`other-sub-session-*`）的 running 跟踪 Task。推演旧实现：候选窗必含该 intruder（running + [async] 名 + 最新），`subagentSessionId` 不等但 `agentSnapshot.id === snapshot.id` 命中 → 误标 success → 断言①（intruder 保持 running）必红，断言②（新建投递行存在）同红——两条断言均能区分新旧实现 |
| 实测全绿 | `npx vitest run src/__tests__/agentMessageLedger.test.ts`：**13/13 passed**（2.63s） |
| 无副作用 | 相关 4 套件回归（globalTaskPool 18 例含 50 spawn 压测 / superiorQueueDrain 7 例 / nativeTools / async-task-queue）：**129 passed / 5 skipped** 全绿；`pnpm --filter @knowpilot/server lint`（tsc --noEmit）EXIT=0。修复面仅 agentReportBackTool 的 matched=null 分支，matched 命中路径（含 W14 taskRef 关联、deliverToQueue=false consumed 记账）逐行未动 |

### 实跑复核（亲自运行，非转述）

| # | 命令 | 结果 |
|---|---|---|
| 1 | `git show 0c0aa370` diff 精读（swarm.ts + agentMessageLedger.test.ts） | 兜底块删除、注释如实、用例构造与断言如上表 |
| 2 | `cd apps/server && npx vitest run src/__tests__/agentMessageLedger.test.ts` | EXIT=0；**13 passed**（含新负向用例） |
| 3 | `npx vitest run globalTaskPool superiorQueueDrain nativeTools async-task-queue`（apps/server） | EXIT=0；4 文件 **129 passed / 5 skipped**（14.0s） |
| 4 | `pnpm --filter @knowpilot/server lint` | EXIT=0（tsc --noEmit） |

### 复审总结论

唯一必修项 P2-1 已在本分支消化（`0c0aa370`），修复符合零兼容铁律（删分支而非留兼容），负向断言新旧可区分且实测全绿，相关套件无回归。**总结论升级为「通过」**，本分支可合入。S1~S5 维持原登记不阻塞（S2 为 v8 新边缘、S1/S3/S4 为 pre-existing 边界、S5 已文档化），建议后续工单跟进 S2。

---

> 审查人：终审架构师（只读审查 subagent）。本报告为唯一产出物；Round 1 终审（8 条必查 + P2-1 + S1~S5）与 Round 2 修复复核均已完成，全部闭环。
