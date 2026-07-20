# 05 PR-5：流式内核不变量（分支 `arch/stream-kernel`）

> 用法：连同 `00-执行约定.md` 一起粘贴给实现 agent。发现细节见体检报告 A1-A5 条。**本 PR 与 PR-6（web）通过 E3 abort 协议契约耦合：本 PR 负责服务端——stop 响应/abort 事件必须携带 `partialAssistantMessageId | null`，契约见文末。合并顺序：本 PR 先。**

## 任务

### A1（P1）合成轮吞掉 AbortError

现状：`apps/server/src/infra/loop/reactLoop.ts:619-674`——maxRounds 耗尽或预算触发进 `synthesizing` 后，合成 `transport.complete` 抛出的 AbortError 被 catch-all（:652-654）吞掉 → 落兜底文案 → `transition("done")` + `finalizeRun("success")` → 「已达到最大工具调用轮次」这条用户从未真正得到的兜底文案被落库为 assistant 消息，会话归位 active 而非 paused。

设计契约：终态不变量收进内核——**「run 只有在非 aborted 时才允许以 success 收口」由 finalizeRun/synthesizing 入口强制**（aborted 时唯一合法终态 cancelled）；合成轮 catch 必须用 `isAbortLikeError` 重抛中断，不得 catch-all。检查 synthesizing 分支所有 catch，逐一分类（abort 重抛 / 其他落兜底）。

### A2（P1）SSE 事件 id 双命名空间

现状：`sessionStreamHub.ts:103-115,540-556`——内存 `nextId = maxEventIdFor(sessionId)+1`（per-session），而 `SessionStreamEvent.id` 是全表全局自增；前端 lastEventId 是内存命名空间，重连 GET `resumeAfter` 打 SQLite 重放（`agentStream.ts:1045-1054`）比对的是 DB 命名空间 → 服务重启后已见事件整段重放/混入残留。叠加问题：token 合帧 `writeSse` 不带 id（:1051）→ lastEventId 只随非 token 事件前进，重连后 token 尾巴必重复；重放后 `!isRunning` 分支补发 synthetic done（:1097-1111）与重放出的真实 done 双发；`flushPersistQueue` 重排队自承「顺序可能乱」（:636）。

设计契约：**事件 id 单一事实源**——`SessionStreamEvent` 表加 per-session `seq Int` 列（单调递增，由 hub 分配，与内存 nextId 同源）；SSE `id:`、续传 `resumeAfter`、DB 重放全部用 seq；token 合帧携带帧内最后一个事件的 seq；重放后若 DB 已有 done 事件则不补发 synthetic done；persistQueue 重排队保持原有顺序（失败重排时按 seq 排序落库）。schema 变更走 `prisma db push` + 一次性回填脚本（存量行 seq=id 或按 createdAt 排序编号，执行完即删）。

### A3（P1）autoCompact 双写无串行化/CAS

现状：`autoCompact.ts:450-517`（persistCompactResult）「contextSummary 覆盖到哪条消息」与「边界消息插在哪」分两次独立写；run 入口 auto-compact 与手动 `/compact`（router.ts:676-698，无 running 守卫）并发 → 交错写导致摘要与边界分裂（msg101-120 从模型视野静默消失）。附带 bug：`nextCompactGeneration`（:192-198）靠解析摘要文本 `v\d+@`，落库摘要无 marker → generation 永远停在 2。

设计契约：压缩写回收**单事务 + 代际 CAS**——`UPDATE chatSession SET contextSummary=?, contextCompactedAt=?, compactGeneration=? WHERE id=? AND compactGeneration=?`（读时快照代际做 CAS，count=0 = 并发落败 → 返回 skipped 不写边界）；边界消息同事务写入；generation 改为显式列（不再解析文本 marker）；manual compact 入口复用同一 per-session 锁（或与 hub run 互斥——会话 running 时拒绝/排队手动压缩，选定「拒绝并提示」）。

### A4（P1）POST 起流返回值被忽略 + 占位 sessionId 共享键

现状：`agentStream.ts:963-1010`——`startIfNotRunning` 返回 false 时不区分「同消息重试」与「新消息」，一律降级为订阅：运行中直发的新消息**从不落库、不进队列、无报错**；新会话占位键是共享 `""`，两标签页同时发首条消息 → 第二个 POST 撞车订阅到第一个聊天的流（消息被丢且看到别人的输出）。

设计契约：起流互斥结果**三态化**——`started` / `duplicate`（同 clientMessageId 的重试，允许降级订阅）/ `busy`（不同消息，返回结构化 409，前端转 steer/排队——web 侧联动在 PR-6 工单，本 PR 保证服务端契约 + 现有前端不更坏）；占位键每 POST 唯一（clientMessageId 或服务端预生成 pending id），杜绝共享 `""`。

### A5（P1）steer/follow_up 注入队列随 RunState 销毁

现状：`sessionStreamHub.ts:315-467` + `reactLoop.ts:381,605`——follow_up 仅在 BEFORE_STOP 消费、steer 仅在 AFTER_TOOL_BATCH 消费；run 收尾窗口/最终 LLM 轮/one-at-a-time 剩余项全部滞留，RunState 随 run 结束被 GC：消息不落 DB、不通知前端，UI 却已 toast「已加入后续追问」。另：`takeSteer` 已取出、inject 落库前 abort/崩溃，消息同样蒸发。

设计契约：**接受即持久**——`enqueueInject` 先写 SessionQueueItem（kind=steer/follow_up）做事实源，内存队列只是索引/指针；消费点消费后标记/删除队列行；run 收尾（hub finally 的转移点）统一把未消费项移交既有 drain 通道（起新轮或转普通排队消息）；丢弃只能发生在一个收拢点，并有日志。与 PR-4 B2/B7 的 SessionQueueItem schema 变更协调：**若 PR-4 未合并，本项只加 kind 枚举值不复用其 claimedAt**；若已合并，直接复用软认领语义。

### E3-服务端：abort 协议契约（与 PR-6 联合）

设计契约（两边按此实现）：`stopAgentChat`（tRPC 或服务端 abort 路径）响应携带 `partialAssistantMessageId: string | null`——服务端在 abort 时已确定会落库 partial assistant 则返回其 messageId（预生成 id 先返回、落库用同一 id），确定无 partial 返回 null。web 端据此消除 2s setTimeout 兜底（PR-6 实现）。同时核对 `agentStream.ts` abort 分支（:870-898）partial 落库逻辑与 id 预生成的时序：先预生成 id → 返回响应 → 异步落库用同 id，保证 web 等到的 upsert 与响应 id 一致。

## 测试要求

- A1：负向断言——synthesizing 阶段 abort → 旧实现 success+兜底文案落库，新实现 cancelled 且兜底文案不落库；finalizeRun 对 aborted 状态拒绝 success（单测断言）。
- A2：负向断言——模拟「per-session seq 与全局 id 错位」后重放 → 已见事件不重复；token 合帧尾帧 id 推进 lastEventId；DB 已有 done 时不补发 synthetic done。
- A3：负向断言——两个并发 compact（auto+manual）交错 → 摘要与边界不分裂（落败方 skipped）；generation 单调递增（不再卡 2）。
- A4：负向断言——运行中 POST 新消息 → 409 且消息不丢（转队列或明确拒绝）；两新会话并发首消息 → 各自起流不串。
- A5：负向断言——run 收尾窗口注入 follow_up → 消息不丢（进队列/起新轮）；takeSteer 后 abort → 消息回到队列。
- E3：stopAgentChat 响应契约单测（有/无 partial 两分支，id 与最终落库一致）。
- 既有 `sessionResume.test.ts`、`superiorQueueDrain.test.ts`、`reflection.test.ts`、`runLifecycle.test.ts` 不回归。
- 跑：`pnpm --filter @knowpilot/server test` 全绿；`pnpm lint`。

## 验收清单

- [ ] 5+1 个发现各有负向测试 + 修复 commit
- [ ] schema 变更（SessionStreamEvent.seq、ChatSession.compactGeneration、SessionQueueItem kind 扩展）db push + 回填脚本
- [ ] E3 服务端契约与 PR-6 对接成功（联调用例或契约测试）
- [ ] lint + server test 全绿，合并入 master；体检报告对应行标注；AGENTS.md 更新

## 红线

- 不改 SSE 对外事件类型集（token/tool_call/tool_result/done/error 等形状不变），只加 id 语义与 stop 响应字段。
- autoCompact 的触发阈值、摘要 prompt、保留窗口等策略不动（策略升级在 W5 工单）。
- injectUserMessages 的既有 kind（follow_up/approval/ask_user）语义不动，只改持久化与移交。
