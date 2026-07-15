# 异步工具体系收敛 终审报告（2026-07-16）

> 审查范围：`faf51bf6..HEAD`（W-0 三例 + W-A 两例 + W-E 两例 + W-F + docs，共 9 commits）。
> 审查方式：逐 commit diff 精读 + 关键源码通读 + 亲自实跑（lint / vitest 全量 / 定向 vitest / mock e2e / dev.db 副本只读查询 / grep 残留扫描）。未修改任何非 .md 文件，未做任何 git 写操作。

## 总结论：**有条件通过**

主链路全部正确、六条决策全部落地、测试不注水、实证全绿（lint 0 错、server 425 passed/5 skipped、mock e2e 19/19、dev.db purge 实证 0 行）。未发现高危/阻断问题。

**通过条件（建议在本分支内消化，均为小改）**：
1. P4（必修，一行文案）：`asyncJobManager.ts:827` 子 Agent 提示词仍教 LLM 传已删除的 `mode=tool` 参数——残留清扫漏网。
2. P5（必修，删死参数）：`startAsyncAgentTask` 的 `guard` 选项在 W-D 后已无生产调用方，违反零兼容纪律「不留死参数」。
3. P2/P3（建议修，可登记跟进）：见下。

---

## 确认的问题（按严重度）

### P2（中低）`async_task_run(waitForResult=true)` 无长等待豁免，30s 工具超时使「同步等待」语义在 >30s 任务上破灭

- 位置：`apps/server/src/infra/agentTools.ts:77`（`LONG_WAIT_TOOLS = {"spawn_subagent","sleep"}`，不含 `async_task_run`）+ `apps/server/src/infra/config.ts:409`（默认 `toolCallTimeoutMs=30000`）+ `apps/server/src/infra/tools/native/shell.ts:47`（`waitForAsyncJob` 允许轮询 10 分钟）。
- 现象：`async_task_run(waitForResult=true)` 执行 >30s 的纯工具任务（如 `run_shell` 装依赖）时，`withToolTimeout` race 在 30s 处给 LLM 返回超时错误（且附带的建议文案是「建议改用 async_task_run 异步执行」——LLM 本就在 async_task_run 里，会困惑）；底层任务继续以 `deliverToQueue=false` 跑完，结果只落右栏「同步任务」区，LLM 永远拿不到——与决策表「true=同步：结果走 tool return」的承诺不符。
- 性质分析：`async_task_run` 历史上从未进 LONG_WAIT（pre-existing），但 W-C 删除 `async_task_wait`（10 分钟通道）后，纯工具长任务的同步等待不再有任何 10 分钟通道，缺口被本轮决策**放大**（spawn_subagent 有 10 分钟豁免，async_task_run 没有）。`waitForAsyncJob` 的 10 分钟轮询上限与外层 30s race 自相矛盾。
- 验证方式：读代码确认（`agentTools.ts:318-321` timeout 选取逻辑）；单测/fixture 的 `toolCallTimeoutMs: 30_000`（`toolTestFixtures.ts:45`）佐证默认值。
- 建议：`waitForResult=true` 的 `async_task_run` 纳入长等待（LONG_WAIT 判定从「按工具名」扩为「按工具名+args」），或将 `waitForAsyncJob` 上限显式对齐到 30s 并在工具描述中如实声明。

### P3（低）`listRunningAsyncJobs` / `listQueuedAsyncJobs` 未过滤 `deliverToQueue=false` → sync 任务 running/queued 期间双分组展示

- 位置：`apps/server/src/infra/asyncJobManager.ts:587-614`（listRunningAsyncJobs）、`:628-660`（listQueuedAsyncJobs）——对比 `:538` 与 `:563` 两处已过滤。
- 现象：一个 `waitForResult=true` 的 sync 任务在 running/queued 期间**同时**出现在右栏「异步队列 → 未消费」（经 `pullAsyncQueue.running/queued` → `mergeAsyncPollIntoQueue` → `runtimePendingItems`，见 `useChatDerivedQueues.ts:75-77`）与「同步任务 → 进行中」（`listSyncAsyncJobs`），badge 计数双算；同时也进入左栏发送队列区的 async-running 进度卡。任务完成后从两处自动消失（deliveries/consumed 已过滤），无残留、不可被消费（`useChatQueueDrain.ts:58` 的 `isReady` 排除 async-running）、不会双跑——**纯 UI 分类重复，无功能错误**。
- 实证：e2e `async-task-mock.spec.ts` 第二例种入的 `status:"running"` sync 任务（fixture `asyncQueueFixture.ts:79`）按代码路径必出现在「异步队列」未消费列表，但该 e2e 未断言此点（测试缺口与实现缺口对应）。
- 决策核对：checklist 字面「两处 pull」（deliveries + consumed）已达标 ✅；但 W-A「两级分组隔离」的意图在 running/queued 列表有第三、四处遗漏。
- 建议：两处 list 各加一行 `if (parseAsyncInput(row.input)?.deliverToQueue === false) return null;`，并补一条「running sync 不进 pullAsyncQueue.running」的负向断言。

### P4（微）子 Agent 提示词仍教 LLM 传已删除的 `mode=tool` 参数——残留清扫漏网

- 位置：`apps/server/src/infra/asyncJobManager.ts:827`：`"你可以调用 async_task_run(mode=tool) 把耗时步骤放入后台执行…"`。
- 现象：W-D 已删除 `mode` 参数（schema 无此字段、handler 不读 `args.mode`），该 prompt 文案会引导 LLM 传一个不存在的参数（被静默忽略，功能无害但属误导）。W-F 的残留清扫 grep 模式为 `mode=llm` / `mode: "llm"`，漏掉了 `mode=tool` 文案。
- 建议：改为「你可以调用 async_task_run（toolCall 指定工具）把耗时步骤放入后台执行」。

### P5（微）`startAsyncAgentTask` 的 `guard` 选项已成死参数

- 位置：`apps/server/src/infra/asyncJobManager.ts:1093`（选项声明）+ `:1259`（`guard: options.guard` 透传）。
- 现象：W-D 删除了唯一传参方（shell.ts runAsyncTool 的 guard 入参）后，全仓生产代码再无调用方传 `guard`（grep 实证：仅 `swarmOrchestrator.test.ts` 测 dispatch 层 guard 机制本身；`session.ts:49` 的 guard 是 spawn 的 dispatch 直传，不经 startAsyncAgentTask）。`options.guard` 恒为 `undefined`——正是零兼容纪律禁止的「留着以防万一」死参数。
- 建议：删除该选项与透传（dispatch 层 guard 机制本身保留，spawn/trigger/heartbeat 仍在用）。

---

## 疑似待人工复核

> 均为极端窗口 / pre-existing 行为 / 语义边界，主链路无实证失败；按「宁多报疑似」列出。

- **S1｜prepareAgentRun 的 catch 无条件把子会话标 `failed`，可能误伤健康 running 会话**（`swarm.ts:493-499`）。两个触发面：① busy 分支内 DB 异常（`bus.send` 返回 failed 走 kind=failed 不抛，但 `sessionQueueItem.create` 抛异常会落入 catch）；② busy 判定（`isRunning=false`）与 `hub.start` 之间的 TOCTOU——另一路径（前端 drain / 用户发送）抢先起流，`hub.start` 抛「已有运行中的 Agent 流」（`sessionStreamHub.ts:206-208`）→ catch → 正在健康运行的会话被标 failed。低概率（ms 级窗口 / 需 DB 故障），后果是 UI 状态误标（hub.listRunning 不读 DB 状态，运行本身不受影响）。
- **S2｜spawn_subagent `waitForResult=true` 轮询完成判定不含 SessionQueueItem 检查，drain claim→start 间隙可能抓到前轮旧 assistant（张冠李戴窗口）**（`session.ts:287-313`：条件 = `!streaming && nestedActive===0`，`nestedActive` 只查 Task 表）。时序：子 busy 派活入队 → 前轮结束 → drain 链 `waitFor` 返回 → claim → `prepareAgentRun(fromDrain)` 内 resolveAgent/写消息/`hub.start` 之前的间隙（约百 ms 级，父轮询 400ms 一拍）→ 父判定「空闲」→ 抓到**前轮**的 assistant 当成派活结果返回。注意：旧实现在该场景是 100% 拿错（busy 时直接读旧 assistant），W-E 严格更优，但窗口仍存在。修法建议：完成条件加「`sessionQueueItem.listBySession` 为空」。
- **S3｜drain claim 后 `prepareAgentRun` 起流抛异常 → item 已 consumed、user 消息已写但未起流，上级消息无回答**（`swarm.ts:364-402` 写消息先于 `hub.start`；`asyncJobManager.ts:216-220` runItem catch 仅 warn）。需 TOCTOU 撞车（低概率）；旧实现同等落空，非回归。
- **S4｜`agentSendMessageTool` 的 prepare 异常 catch 对 `waitForRun=true` 返回 `success:true + content:""`**（`swarm.ts:546-553`）——LLM 会误以为同步等待成功并拿到空结果。pre-existing 的 fire-and-forget 契约延伸，本轮未改但值得登记。
- **S5｜`waitForRun=true` + busy 的 `drainPromise` 等的是整条 drain 循环（队列排空），并非注释声称的「该 item 被处理完成」**（`asyncJobManager.ts:196-226` 注释 vs 实现；`swarm.ts:191` 类型注释同）。且该 `await` 在工具执行体内受 30s 默认超时约束（`agent_send_message` 不在 LONG_WAIT_TOOLS）——子等闲超过 30s 时 `waitForRun` 语义同样破灭（pre-existing 同源问题，与 P2 同根）。
- **S6｜busy 分支 `sessionQueueItem.create` 的 `OperationResult` 返回值未检查**（`swarm.ts:305-312`）。若镜像失败（DB 异常），AgentMessage 留 pending 但无队列项 → 仅靠前端 mirror（`useSubagentMessageMirror.ts`，幂等键同 agentMessageId）兜底；前端永不打开且再无发送则 pending 泄漏，堆积后触发 `SWARM_MAX_QUEUE_SIZE` 拒新消息（`swarmBus.ts:93-101`）。已知限制与注释声明一致，但「bus.send 成功 + 镜像失败」无补偿/回滚，属账本完整性边界缺口。
- **S7｜`agentRunLocks` 的 check-then-set 竞态**（`swarm.ts:216-217` + `:501` finally delete）：A await 旧锁期间 B 完成并 delete、C set 新锁，A 醒后 set 覆盖 C 的锁 → A/C 并发进 prepare 段。pre-existing 结构（W-E 仅收窄锁范围未改该模式）；底层 busy 判定 + `hub.start` 拒绝双跑兜底，大概率无害。
- **S8｜`retryAsyncJob` 新建 Task 的 input 丢失 `sourceType/subagentSessionId/deliverToQueue/shareToSessionIds`**（`asyncJobManager.ts:1521-1529` vs `:1550-1553` 执行参数仍用原值）。后果：① 重试 `waitForResult=true` 的 sync 任务 → 新 Task `deliverToQueue` 缺省为 true → 结果进异步队列气泡（语义漂移）；② 重试 spawn 跟踪 Task 可行但会以 buildAsyncExecute 重新执行子任务；③ autoConsume 的 `sourceType ?? "async_task_llm"` 兜底（`:300`）会把重试的纯工具任务误标为 llm 来源。**pre-existing，本轮未触碰**，但与 W-A 分类体系交互后漂移更显性。
- **S9｜`agentResolver.ts:24` 默认 systemPrompt 仍写「使用 native:spawn_subagent 或 native:async_task_run 派生子代理」**——async_task_run 已不能派生子代理（纯工具）。pre-existing 文案，本轮分工变化后已不准确。
- **S10｜`docs/surveys-2026/对比分析-记忆-Harness-Agent.md:326` 仍提及 `async_task_wait`**——历史综述文档，不属必更范围（v7 指令仅要求 scenarios/design-decisions/async-result-dedup-proposal 三份更新，均已更新），列出仅供知情。

---

## 逐决策核对表

| # | 决策 | 结论 | 一句话证据 |
|---|---|---|---|
| 1 | 双工具分工彻底：`spawn_subagent` 专职 LLM；`async_task_run` 专职纯工具，任何路径无法发起 llm | ✅ | shell.ts:20-27 handler 不读 `args.mode`（传 `mode:"llm"` **静默忽略**，schema 已删该字段）、缺 toolCall 硬报错（vitest 负向用例通过）；startAsyncAgentTask 的生产调用方仅 shell.ts(mode:"tool") 与 session.spawn/rerun(isSubagent,llm 默认)；无 tRPC 通用入口暴露 mode。⚠️附注：P4 文案漏网 + P2 超时缺口，不改变分工结论 |
| 2 | `async_task_wait` 删除；`waitForAsyncJob` 保留且唯一调用方 = async_task_run(waitForResult=true) | ✅ | 全仓 grep：`async_task_wait` 生产代码/注册表/权限清单/UI/content 零命中，仅存防线测试负向断言（`async-task-queue.test.ts:119`）与已注记的历史文档；`waitForAsyncJob` 生产调用方唯一（`shell.ts:47`，grep 实证） |
| 3 | `async_task_status` 去全文，全文唯一通道 = 队列原子 claim | ✅ | `getAsyncJobStatus`(:1400)/`listSessionAsyncJobs`(:1430) 返回类型与实现均无 asyncResult/error/logs/tokenUsage；vitest 负向断言（终态 `not.toHaveProperty` 三字段）通过；claim 唯一锁 = `Task.delivered` updateMany（`:266-274`/`:574-584`） |
| 4 | W-E：busy 不写 ChatMessage + 服务端持久队列 + 空闲自动 drain + consume 软认领 + 账本完整 | ✅ | T7 断言 busy 期 ChatMessage 0 条 + AgentMessage pending + item 镜像；drain 复用 per-session 串行链（单流不变量不破）；consume deleteMany 原子认领（并发双 consume 恰一胜，测试通过）；consume 事务内 delivered→consumed / pending 兜底补 deliveredAt（T7 断言 consumed+deliveredAt）；spawn 首轮不受影响（代码路径 + 6 例 e2e 通过）。附注：S1/S3/S6 极端窗口已登记 |
| 5 | 存量 async_task_llm Task 物理删除（实测 0 行） | ✅ | dev.db **副本**只读查询实证：`SELECT count(*) … json_extract(input,'$.sourceType')='async_task_llm'` → 0 行；Task 总行数 8（与 commit message 一致）；sourceType 分布 `(null)×3 + subagent×5` |
| 6 | `buildAsyncExecute` llm 分支一行不删（前端「派生子代理」执行体） | ✅ | `asyncJobManager.ts:1008-1062` llm 分支完整（hub 流式 + runAgentLoop 双路径、finalizeSuccess/Failure 完整）；`session.spawn`/`session.rerun`（`router.ts:521,549`）不传 mode → 默认 llm，未被本轮波及；`asyncJobManager.test.ts` 全量通过 |

**W-A 附加核对**：两处 pull 过滤 ✅（T1/T2 断言，旧实现即红）；「已消费」列表无 sync 混入 ✅（T2）；右栏「配置」页 diff 真为零 ✅（chatRightPanel 仅加 props 透传，ChatSettingsPanel 调用未动）；⚠️ running/queued 列表过滤遗漏（P3）。

**INV-1~8 / drain 触发链附加核对** ✅：`chat.tsx` diff 仅 syncTaskItems 解构 + runtimeGroupTab state + props 透传 + 注释改名；`useChatQueueDrain.ts` diff 仅 W-E 软认领（已声明）；`useChatSseSubscriptions`/`useStreamLifecycle`/`useSessionComposeState`/`useSubagentMessageMirror` 零行为改动（mirror 仅注释）。无夹带。

**测试反注水逐例结论** ✅：superiorQueueDrain 4 例（T7 busy 不写 ChatMessage/queued 标记、T7b waitForRun、T7c idle 残留 FIFO、软认领竞态恰一胜）均为旧实现即红的负向断言，且 T7/T7b 用真 SessionStreamHub + MOCK_LLM 全链路；async-task-queue W-A 四例中 T1/T2/T4 旧实现即红（T3 为新函数正向断言，不适用区分）；e2e 新增「同步任务分组」例断言具体（卡片计数/文案/按钮不存在/切回不回归），非恒真（若 .next 为旧 build，testid 不存在必然失败——通过即证明 build 含新前端）。

---

## 实跑验证记录（亲自运行，非转述）

| # | 命令 | 结果 |
|---|---|---|
| 1 | `pnpm lint` | EXIT=0；shared/server `tsc --noEmit` + web `eslint` 全过 |
| 2 | `pnpm --filter @knowpilot/server test` | EXIT=0；**43 文件 425 passed / 5 skipped**（38.3s），与 AGENTS.md「425+」一致 |
| 3 | `npx vitest run src/__tests__/async-task-queue.test.ts src/__tests__/superiorQueueDrain.test.ts src/__tests__/agentMessageLedger.test.ts`（apps/server） | EXIT=0；3 文件 **25 passed**（含 W-A T1-T4、W-E T7 系列、W14 账本断言） |
| 4 | `cd apps/web && pnpm run test:e2e:mock`（用既有 .next build，未重建） | EXIT=0；**19/19 passed**（51.4s），含新例「右栏同步任务分组」(0.8s) 与 spawn 链路 6 例（chat-subagent-resume 4 + subagent 2） |
| 5 | dev.db **复制到 /tmp 后** prisma 只读查询（不碰原库） | `Task total=8`；`async_task_llm=0 行`；sourceType 分布 `(null)×3/subagent×5`；`AgentMessage pending=0`；`SessionQueueItem=0`——与 W-F commit 声称逐字一致 |
| 6 | grep 残留扫描（全仓，含 include_ignored 排除 node_modules） | `async_task_wait`：生产/注册表/权限/UI/content 零命中，仅防线测试 + 已注记历史文档；`async_task_llm`：仅存 buildAsyncExecute llm 分支（决策 6 刻意保留）+ asyncTaskPanel 展示映射（配套保留）+ 文档；**漏网 1 处** = P4（`asyncJobManager.ts:827` 的 `mode=tool` 文案） |
| 7 | `git diff faf51bf6..HEAD` 逐文件精读（39 文件，+1384/-268） | 全部改动可映射到已声明工单（W-0/W-A/W-E/W-F/docs），无夹带（唯一例外发现 = P3/P4/P5 三处遗漏项） |

---

## 残留的零兼容违规清单

1. **P5（死参数）**：`startAsyncAgentTask` 的 `guard` 选项无生产调用方（`asyncJobManager.ts:1093,1259`）。
2. **P4（过时契约文案）**：`asyncJobManager.ts:827` 引导 LLM 传已删除的 `mode=tool`。
3. **说明项（非违规）**：`async_task_run` 传 `mode:"llm"` 的实测行为 = **静默忽略**（JSON schema 未声明该字段、handler 完全不读，非刻意保留的兼容分支）——可接受；`async_task_status` 去全文后无「旧格式兼容分支」；consume() 签名变更的所有调用方（router/web drain/服务端 drain/测试）已同批改完，无旧签名残留。

除上述 2 项外零命中。

---

## 阶段三复核与修复结论（2026-07-16 追加）

> 本节为追加结论，上方原文保留未动。全部修复在本分支完成，每项独立 `fix: [review]` commit，
> 均先写负向断言测试（旧实现即红）后实现。验收：server **437 passed / 5 skipped**（基线 425 → +12 新断言）、`pnpm lint` EXIT=0、mock e2e **19/19**。

### 确认问题处置

| # | 结论 | 修复 | 负向断言 |
|---|---|---|---|
| P2 | **已修** | `agentTools.resolveToolCallTimeoutMs(name,args,default)`：`async_task_run(waitForResult=true)` 纳入 10 分钟长等待档（含字符串 `"true"` 容忍，与 shell.ts coerceToolBoolean 同源）；超时的「建议改用 async_task_run」误导文案随之不再出现于该场景 | `agentTools.test.ts` 4 例：waitForResult=true/"true" → 600000ms；缺省/false → 30000ms |
| P3 | **已修** | `listRunningAsyncJobs`/`listQueuedAsyncJobs` 各加 `deliverToQueue === false` 跳过（与 :538/:563 同款） | `async-task-queue.test.ts` T5：sync running/queued 不进两异步列表、在 listSyncAsyncJobs；异步对照不受影响 |
| P4 | **已修** | :827 文案改为「async_task_run（toolCall 指定要执行的工具）」 | 源码防线测试：asyncJobManager.ts 不得含 `async_task_run(mode=tool)` |
| P5 | **已修** | 删除 `guard` 选项与透传；`SwarmTaskSpec` 类型导入一并移除（dispatch 层 guard 机制保留，spawn/trigger/heartbeat 直传不动） | 源码防线测试：不得再出现 `guard: options.guard` / `guard?: SwarmTaskSpec["guard"]`；tsc 编译即调用方核查（全仓无生产调用方，grep 实证） |

### 疑似项逐条结论

- **S1 → 转确认，已修**。误伤真实存在：busy 分支 DB 异常与起流 TOCTOU 被拒两条路径都会把健康 running 会话标 failed。修复 = 所有权不变量收进 catch：**运行中的会话状态归 runner 所有，prepare 段失败仅在无活跃流（hub.isRunning=false）时标 failed**。测试：busy 分支注入 sessionQueueItem.create 异常，断言会话状态非 failed 且 hub 仍 running（旧实现即红）。
- **S2 → 转确认，已修（机制层，非时序补丁）**。窗口真实存在，且评审建议的「仅查队列」**不充分**：consume 删除即认领，claim→hub.start 间隙队列已空。修复 = 状态机补全两个此前不可观测的状态：① spawn 轮询空闲判定加「无待处理队列项」（覆盖前轮结束→drain 认领窗口）；② SessionStreamHub 新增 per-session「即将起流」标记（drain 认领后同步 mark、finally unmark、hub.start 占位成功即清除；claim 到 mark 之间无 await 交错点，无时序猜测），判定函数 `isSubagentSessionSettled` 单点收拢四条件。测试：闸门卡住 runItem 构造「已认领未起流」确定态，断言 isRunStarting=true 且 settle=false；放行后恢复（旧实现即红）。**残留边界（接受）**：前端 drain 认领路径未接旗标——需子会话页面打开 + 认领后一轮 HTTP 间隙（远短于服务端 drain 的 prepare 段），概率低一个量级且失败方向同 pre-existing（W-E 前该场景 100% 拿错），登记不阻塞。
- **S3 → 接受，理由**：需 TOCTOU 撞车（低概率）；item 内容已由 busy 分支 bus.send 落 AgentMessage 账，前端 mirror 以同 agentMessageId 幂等键可重建队列项，非永久丢失；旧实现同等落空，非回归；S1 修复后其伴随副作用（误标 failed）已消除。
- **S4 → 转确认，已修**。`waitForRun=true` 准备段失败返回 `success:true + content:""` 会让 LLM 误以为同步等待成功拿到空结果。修复：该分支如实返回 `success:false + error`（fire-and-forget 分支契约不动，spawn 依赖的路径不受影响）。测试：StreamHub 不可用注入准备段失败，断言 success=false 且有 error（旧实现即红）。
- **S5 → 转确认，已修**。30s 破灭与 P2 同根：`agent_send_message(waitForRun=true)` 经 `resolveToolCallTimeoutMs` 纳入 10 分钟档（测试同 P2 套件）。「等整条 drain 链而非该 item」维持现状：FIFO 保证本 item 先于链尾被处理，await 链即等到本 item 处理完成，保守多等后排入队项语义正确；swarm.ts 类型注释已更正为如实描述（随队列排空解析、可能多等）。不做 per-item deferred：收益仅是少等后排项，代价是 drain 链新增按 id 匹配的解析注册表，不划算。
- **S6 → 接受，理由**：需 DB 异常（低概率）；AgentMessage pending 有前端 mirror（幂等键同 agentMessageId）与下次发送 drain 双重兜底；泄漏上限受 `SWARM_MAX_QUEUE_SIZE` 拦截——拒新而非错跑，失败方向安全；「bus.send 成功 + 镜像失败」跨服务事务补偿代价远大于收益；代码已知限制注释与本报告登记一致。
- **S7 → 接受，理由**：pre-existing 结构（W-E 仅收窄锁范围）；底层 busy 判定 + `hub.start` 同步占位拒绝双跑是机制兜底，A/C 并发进 prepare 段最坏结果 = 一方起流被拒 + warn 日志；S1 修复后该被拒路径不再误标 failed，最坏副作用已消除。重写锁为公平队列收益不抵复杂度。
- **S8 → 转确认，已修**。虽 pre-existing，但与 W-A 分类体系交互后漂移显性化（sync 重试结果进气泡、来源误标 llm、二次重试丢 toolCall 变 LLM 模式——漂移逐次复利），值得本分支修。修复：新 Task `input: { ...input, retryCount }` 全量保留原字段。测试 T6：失败 sync 工具任务重试 → 新 input 保留 deliverToQueue=false/sourceType/toolCall、结果不进 pullAsyncDeliveries、出现在 listSyncAsyncJobs（旧实现即红）。
- **S9 → 转确认，已修**。默认 assistant 提示词改为「请使用 native:spawn_subagent 派生子代理执行（native:async_task_run 仅用于后台执行纯工具调用，不跑 LLM、不派生子代理）」。防线测试：提示词不得再含「或 native:async_task_run 派生子代理」。
- **S10 → 接受，理由**：`docs/surveys-2026/` 为历史综述，不属本分支必更范围（v7 指定的三份文档已更新），保留知情注记不改动。

### 通过条件复核

原「有条件通过」三条通过条件（P4 必修、P5 必修、P2/P3 建议修）**已全部在本分支消化**；上方「残留的零兼容违规清单」两项（P4/P5）已清零。修复 commit 序列（基线 `68511e03` 之后）：`cf2c03c3`(P4) → `e4988b2c`(S9) → `5789e2ca`(P5) → `6ea1e714`(P3) → `1e8dd630`(P2/S5) → `ec4ee509`(S8) → `9757d3d3`(S1) → `0ab28177`(S2) → `6d4f4d51`(S4)。

---

> 审查人：终审架构师（subagent）。本报告为唯一产出物；P2~P5 与 S1~S10 的处置权交还主会话/用户。
