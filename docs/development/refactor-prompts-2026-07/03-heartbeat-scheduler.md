# 03 PR-3：心跳刷新串行化 / 僵尸 Task / 原子认领 / 计数器（分支 `arch/heartbeat-scheduler`）

> 用法：连同 `00-执行约定.md` 一起粘贴给实现 agent。发现细节见体检报告 C1/C2/C4/C7 条。**本 PR 与 PR-1 都碰 `services.ts`：本 PR 只碰 TaskService.run 区（约 2357 行附近），PR-1 先合并后本 PR rebase。**

## 任务

### C1（P1）僵尸 running Task 永久卡死心跳与定时任务

现状：`apps/server/src/infra/asyncJobManager.ts:930-935` 的启动恢复扫描 where 只认 `name startsWith "[async]"` 或 `type="async_agent"`；而 `heartbeatEngine.ts:361-375`（心跳）、`taskScheduler.ts:56-59`（cron 任务）、`triggerEngine.ts:142-148`（trigger）都在 v8 池体系之外自写 `status:"running"` Task 行，且心跳（:331-337）与 TaskScheduler 把该行当重叠闸——崩溃或池准入失败后行永远 running → 该 Agent 心跳**静默永久停摆**（重叠闸每轮查到 running 直接 return，不计失败、不触发熔断告警）；cron 任务每轮 tick「正在运行，跳过」直至人工清库。另一个无需崩溃的路径：心跳 dispatch 走 swarmOrchestrator pool，enqueue 被 maxQueued 拒绝时异常上抛、外层只 console（heartbeatEngine.ts:481-483），已建的 running 行无人收尾。

设计契约：

- **Task 行生命周期与池准入口径合一**：入队/起跑前落 `queued`，获槽/真正开始执行才转 `running`；池准入拒绝对已建行做补偿收尾（标 failed 带原因）。
- **恢复扫描收拢全部「执行型 Task」**：按 `type`（async_agent/heartbeat/cron_task/trigger 等，按 schema 现状枚举核对）或统一命名空间识别，不再只扫 `[async]` 前缀；僵尸 running → 按 v10 既有语义处理（reentrant 续跑 / failed「服务重启，任务中断」），心跳/cron/trigger 行默认不可重入 → failed。
- **重叠闸改原子条件写认领**：`updateMany({id/agentKey, status:{not:"running"}}, {status:"running"})`，count=0 即跳过——闸与写之间无窗口。
- 心跳 dispatch 被拒（maxQueued）时必须把已建 Task 行收尾为 failed（原因「队列满」），并计入失败 streak（让熔断可见）。

### C2（P1）HeartbeatEngine.refresh() 无串行化

现状：`heartbeatEngine.ts:158-207`——`jobs.clear()` 与重新 `cron.schedule` 之间隔着两处 `await` DB；交叠 refresh（start/事件防抖/resumeHeartbeat 三入口）各自注册同一 agent，`jobs.set` 互相覆盖，先注册的 ScheduledTask 永远摘不掉 → cron 到点双发（双倍 LLM 消耗、双倍失败计数）。`start→stop→start` 序列同样中招（`this.started` 检查防不住旧 refresh 恢复）。

设计契约：refresh 串行化收进引擎——**单条 promise 链**（新 refresh 链到上一条之后；连续多次可 coalesce 成「只跑最新一次」）+ **generation 令牌**：每次 refresh 递增代际，注册每个 cron job 前比对代际，过期代际立即 stop 已建 job 并放弃剩余注册。两个机制都做（链保证不交错，令牌保证 stop/start 交错也不泄漏）。

### C4（P2）心跳状态混合版本 read-modify-write

现状：`heartbeatEngine.ts:622-657`——`consecutiveFailures` 用触发时刻的旧值算，其余字段用新读的 current 合并再整 blob 覆写；并发 run 丢计数；在途失败写回旧值+1 会覆盖用户刚保存的「配置变更清零」（services.ts:1043-1046），suspended 复活的唯一条件被破坏。

设计契约：失败/成功计数改 Prisma 原子操作（`increment` 或条件更新，清零=条件写 `set 0`）；心跳运行态（lastRun/consecutiveFailures/suspendedAt）与配置态（enabled/cron/goal）分列或分字段更新，杜绝整 blob 覆写——写回只 touch 本次执行该写的字段。

### C7（P2）cron 触发与手动触发无原子认领

现状：`taskScheduler.ts:53-63`（findUnique 查 → 调 run）、`services.ts:2357`（`update({status:"running"})` 无条件）、`triggerEngine.ts:142-148`（同样无条件）——check-then-act，窗口内可双跑。

设计契约：**认领单点化**——新增一个共用认领函数（如 `claimTaskRun(taskId)`：`updateMany({id, status:{not:"running"}},{status:"running"})` 返回 claimed 布尔），cron/手动 tRPC/TriggerEngine 三入口全部改走它；落选方如实返回「正在运行」。

## 测试要求

- C1：负向断言——制造 `[heartbeat]` 僵尸 running 行 → 跑一次启动恢复 → 断言变 failed 且下次心跳不再被闸跳过；池拒绝对已建行有 failed 收尾；重叠闸并发双触发只有一个 claimed。
- C2：负向断言——并发触发两次 refresh（人工注入交错点）→ 断言每个 agent 只有一个活跃 ScheduledTask（可 spy cron.schedule/stop）；start→stop→start 交错无泄漏。
- C4：并发两个失败写回 + 中途人工清零 → 断言计数不丢、清零不被覆盖。
- C7：三入口并发 run 同一任务 → 只有一个执行体（spy）。
- 既有 `circuitBreaker.test.ts`、`reentrantResume.test.ts`、`startupRecovery.test.ts` 不回归（C1 动了恢复扫描，逐个核对断言）。
- 跑：`pnpm --filter @knowpilot/server test` 全绿；`pnpm lint`。

## 验收清单

- [ ] 僵尸 Task 三类来源全覆盖（测试证明：心跳/cron/trigger 僵尸行均可被恢复且不再卡闸）
- [ ] refresh 串行链 + generation 令牌就位，双发测试通过
- [ ] 计数器原子化，无整 blob 覆写
- [ ] 认领单点函数三入口共用
- [ ] lint + server test 全绿，合并入 master；体检报告对应行标注；AGENTS.md 更新

## 红线

- 不改变心跳 cron 表达式语义与 suspended 个体化恢复语义（W16d-2 成果不动）。
- 恢复扫描对 `[async]` 既有行为（reentrant 续跑/retryCount 账本）不回归。
- 不给心跳加持久化队列（那是 redis/Phase 4 的事）。
