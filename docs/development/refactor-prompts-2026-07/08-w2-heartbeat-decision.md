# 08 W2：心跳决策层（分支 `feat/heartbeat-decision`）

> 用法：连同 `00-执行约定.md` 一起粘贴给实现 agent。**依赖 PR-3（arch/heartbeat-scheduler）已合并。**
> 设计来源：loopx 的 quota should-run 决策内核与 scheduler_hint 退避（参考实现 `tmp/references/loopx`，重点读 `loopx/quota.py` 的 `build_quota_should_run`、`loopx/control_plane/scheduler/scheduler_hint.py`、`docs/quota-allocation.md`）。

## 目标

KnowPilot 心跳现状：node-cron 到点 → 预算检查 → 直接 dispatch LLM run。没有「这一 tick 该不该跑」的决策层——该等人的时候空转烧钱、没进展时不会退避、目标闭合后永不停止。本工单把心跳升级为「cron 只负责唤醒，决策层决定 deliver/ask/wait/repair/quiet/terminal」。

## 设计契约（已拍板，按此实现）

### 决策模块

新建叶子模块 `apps/server/src/infra/heartbeatDecision.ts`（纯函数、无 IO 依赖、可单测；输入经参数注入，不直接 import prisma）：

```
buildHeartbeatDecision(signals: HeartbeatSignals): HeartbeatDecision
```

- **输入信号**（heartbeatEngine 负责收集注入）：agent 配置（goal/cron/enabled）、openApprovals 数、pendingAskUser 数、queuedItems 数、lastRunId/lastRunAt、consecutiveFailures、最近 N tick 的 productive 标记（见 W5，v1 可用「lastRun 是否有 toolCalls>0」近似）、budget 状态、当前时间。
- **输出 packet**：
  - `mode`（闭集）：`bounded_delivery`（正常跑 agent）/ `wait_user_gate`（有待人审批或 ask_user：不跑，等）/ `monitor_quiet_skip`（纯监听无变化：静默跳过）/ `quiet`（无实质进展信号：跳过）/ `repair`（连续无产出：跑一轮有界修复提示，W5 接入完整 stall 逻辑，v1 决策层先留 mode）/ `terminal_no_followup`（目标闭合：停心跳）。
  - `reasons: string[]`（人类可读，进 Log）。
  - `userGate?: { kind: "approval"|"ask_user", summary }`（mode=wait_user_gate 时必填——**必须给出具体待办，禁止只说「等 owner」**；用于通知与日志）。
  - `skipTicks: number`（本次跳过后，接下来还要再跳过几个 tick，见退避节）。
- **决策流水线顺序**（固定，写进模块头注释）：identity/boundary（agent 启用？目标在？）→ user gate 归一化（有待人事项 → wait_user_gate，附具体 summary）→ budget/health（超限/熔断 → quiet 并记原因）→ frontier（有无待办信号？无 → terminal 判定；有但无新进展 → quiet + 退避推进）→ 默认 bounded_delivery。
- **terminal 判定**：目标闭合 = 无 open gates、无 queued、最近连续 K 次 quiet（K 默认 3，config 可调）→ 置 `heartbeatSuspendedAt` 并记原因「goal terminal」，复用 W16d-2 的个体 suspended 机制（不新造开关）；复活条件沿用「配置变更清零」。

### 退避（scheduler_hint 的 KnowPilot 简化版）

- cron 表达式保持不变（唤醒频率不动），退避用 **skip 计数**实现（避免动态改 cron 的复杂度——这是与 loopx 的有意偏离，写进 design-decisions）：
  - 每次 quiet/monitor_quiet_skip → `skipTicks = min(skipTicks*2+1, cap)`（指数推进，cap 默认 8，config 可调）；
  - 每个 tick 先检查 `skipRemaining>0` → 只 decrement 不决策；
  - **reset_token**：对「决策身份」做哈希（openApprovals 数 + pendingAskUser 数 + queuedItems 数 + lastRunId + consecutiveFailures 的拼接 sha1），与上次不同 → skipRemaining 归零（有新进展/新变化立即恢复全速）。
  - 状态存 `Agent.heartbeat` JSON blob 的独立子键（如 `decision: { skipRemaining, resetToken, lastMode, quietStreak }`），与 PR-3 的「运行态/配置态分列」对齐，不整 blob 覆写。
- 交互式活动（用户在该 agent 会话发消息）视同 reset 信号（resetToken 输入含 lastUserMessageAt 的粗粒度分桶，避免每 token 都变）。

### 接入点

- `heartbeatEngine.triggerHeartbeat`：cron 触发 → 收集 signals → `buildHeartbeatDecision` →
  - `bounded_delivery` → 走现有 dispatch（swarmOrchestrator 池）；
  - `repair`（v1）→ 按 bounded_delivery 跑但 system 提示追加「上轮无实质进展，请重新规划下一步」（固定一句话，W5 再做完整 stall 修复）；
  - 其余 mode → 不 dispatch，写 Log（event="heartbeat_decision"，payload 含 mode/reasons/skipTicks/userGate），wait_user_gate 触发通知冷却检查（若距上次通知该 gate 超冷却窗口——默认 30min config 可调——发一次通知邮件/日志，复用 emailNotifier）。
- config.yaml `heartbeat:` 节新增：`decisionEnabled: true`（总开关，可整体回退到旧行为）、`quietCap: 8`、`terminalAfterQuiet: 3`、`gateNotifyCooldownMs: 1800000`。
- /agents 健康看板与 swarm_brief 增加每个 agent 的 lastMode/skipRemaining 展示（只读字段，复用现有 heartbeatSuspendedAt 展示路径；agent.getById 带 decision 子键即可，UI 轻量加列/chip）。

## 测试要求

- `__tests__/heartbeatDecision.test.ts`（纯函数决策表全枚举）：
  - 各 mode 的触发条件边界（有待审批→wait_user_gate 且 summary 非空；无信号 K 次 quiet→terminal；budget 超限→quiet）；
  - 退避推进（quiet→1,3,7…cap）与 reset_token 变化归零；
  - userGate summary 必填（mode=wait_user_gate 无 summary 视为实现错误，断言）；
- 引擎集成：fake cron 触发 N 次 → 断言 dispatch 次数随退避递减、terminal 后 suspendedAt 置位；
- 通知冷却：同 gate 窗口内只通知一次；
- 既有 heartbeat/circuitBreaker 测试不回归。
- 跑：`pnpm --filter @knowpilot/server test`、`pnpm lint` 全绿。

## 验收清单

- [ ] heartbeatDecision.ts 纯函数模块 + 决策表测试全绿
- [ ] 引擎接入 + config 节 + Log 事件
- [ ] 退避/reset_token/terminal 全链路测试
- [ ] 看板/brief 展示 decision 状态
- [ ] lint + server test 全绿，合并入 master；AGENTS.md 更新；design-decisions.md 记录「skip 计数代替动态 cron」「terminal 复用 suspended」两个偏离/取舍

## 红线

- 决策模块保持纯函数（signals 注入），禁止在模块内 import prisma/ctx——可测性是本工单的命根子。
- 不改变 bounded_delivery 路径的 dispatch 语义（池、guard、去重不动）。
- v1 不做 loopx 的 spend-slot 记账与完整 stall repair（那是 W5），但 mode/packet 形状要为 W5 预留（reasons/userGate 字段如上）。
