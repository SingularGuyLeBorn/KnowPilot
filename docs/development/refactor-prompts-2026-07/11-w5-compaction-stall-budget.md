# 11 W5：compaction 切割规则 + 心跳 stall 自愈 + 行为记账（分支 `feat/compaction-stall-budget`）

> 用法：连同 `00-执行约定.md` 一起粘贴给实现 agent。**依赖：W2（feat/heartbeat-decision）已合并；PR-3、PR-5 已合并。**
> 设计来源：pi 的 compaction 切割工程（`tmp/references/pi`：`packages/coding-agent/src/core/compaction/compaction.ts`、`docs/compaction.md`）与 loopx 的 stall_repair + spend-slot 记账（`tmp/references/loopx`：`loopx/control_plane/quota/stall_repair.py`、`docs/quota-allocation.md`）。

## 目标

三个小而实的健壮性增量，一个分支三段 commit：

### 第一段：compaction 切割规则（pi 移植）

现状：KnowPilot autoCompact 按阈值触发、LLM 摘要、写 contextSummary + 边界消息，但切割点没有合法性规则、无迭代摘要防漂移、无 overflow 恢复。移植 pi 的规则：

- **切割点合法性**：绝不切在 toolCall 与其 toolResult 之间——KnowPilot 的 assistant 消息含 toolCalls JSON、工具结果随消息存储，切割点选择必须保证「被保留段内没有 result 缺 call 或 call 缺 result」；选择算法：从最新向最旧累计 keepRecentTokens（config compact 节加 `keepRecentTokens`，默认 20000）定初切点，若切点落在 tool 对中间则向旧侧移动到安全边界。
- **迭代摘要**：再次压缩从上次的压缩边界起算（`firstKeptMessageId` 显式持久化——若 PR-5 已加 compactGeneration 列，配套加 `compactBoundaryMessageId`；不要靠解析摘要文本 marker），防止多轮压缩漂移。
- **overflow 恢复**：LLM 调用抛 context-overflow 类错误时，触发一次压缩后用原请求重试一次（仅一次，重试仍失败则按原错误路径上抛）；接入点 reactLoop transport 错误分类处（复用 resilientLlmClient 的错误分类，overflow 单列一类）。
- **跨压缩累计文件清单**：摘要 details 里累计 readFiles/modifiedFiles（从被压缩段的工具调用参数提取读/写文件路径，并入既有清单去重），写入摘要的 details JSON——供后续 run 快速获知「历史上碰过哪些文件」。

### 第二段：心跳 stall 自愈（loopx 移植）

接入 W2 决策层（`heartbeatDecision.ts`）：

- **productive 判定**（收集 signals 时计算）：上一个 heartbeat run「有产出」= 满足其一——toolCalls>0、产生审批/ask_user、写入 queued 交付物、gate 被推进。纯文本复读 = 无产出。
- **stall 状态机**（收在决策模块，状态存 Agent.heartbeat blob 的 decision 子键）：
  - 连续 2 个无产出 tick → mode=`repair`：跑一轮有界修复 run（system 追加固定修复提示：「连续 N 轮无实质进展，请重新评估目标与下一步，只做一个能改变状态的动作」）；
  - repair 轮仍无产出，再连续 2 tick → mode=`terminal_no_followup`：suspended 心跳（reason「stall repair exhausted」）+ 通知（emailNotifier，文案含 agent 名与最近 N 轮摘要）；
  - 任何一轮有产出 → stall 计数归零。
- 决策表测试覆盖状态机全部转移（含「repair 一轮有产出后回 normal」）。

### 第三段：行为记账（spend-slot 的 KnowPilot 版）

现状 llmBudget 只记 token 花费，不区分「有效推进」与「空转」。增量：

- 心跳/异步 run 结束时按 productive 判定打标：productive run → 正常计预算；**unproductive run 的 token 花费记入独立的 `wastedTokens` 计数**（llmBudget 状态加字段，与日预算并列展示——日预算扣减规则不变，wastedTokens 只用于观测，v1 不拦截）。
- 看板/brief 展示「今日空转占比」（wastedTokens / totalTokens），超阈值（如 50%）在 swarm_brief 告警区出提示。
- 不做 loopx 的「无产出不记账免扣」（单用户场景预算主要是观测，写进 design-decisions）。

## 测试要求

- `__tests__/compactCutPoints.test.ts`：切割点不落 tool 对中间（构造多轮带 toolCalls 的消息序列，各切点断言 call/result 成对）；迭代摘要边界（二次压缩从 firstKeptMessageId 起算）；overflow 重试一次后上抛；文件清单累计去重。
- `__tests__/heartbeatStall.test.ts`（可并入 heartbeatDecision.test.ts）：stall 状态机全转移（2 无产出→repair；repair 后再 2 无产出→terminal+通知；中途有产出→归零）。
- `__tests__/llmBudget.test.ts` 扩充：productive/unproductive 分账、wastedTokens 累计、占比计算。
- 既有 autoCompact/compact 相关测试不回归（注意 PR-5 刚改过 CAS，逐个核对）。
- 跑：`pnpm --filter @knowpilot/server test`、`pnpm lint` 全绿。

## 验收清单

- [ ] 切割合法性 + 迭代边界 + overflow 重试 + 文件清单，各有测试
- [ ] stall 状态机接入决策层，terminal 复用 suspended + 通知
- [ ] wastedTokens 分账 + 看板/告警展示
- [ ] config.yaml compact 节新增 keepRecentTokens（AGENTS.md config 说明同步）
- [ ] lint + server test 全绿，合并入 master；AGENTS.md 更新；design-decisions.md 记录「wastedTokens 只观测不拦截」

## 红线

- 不改变压缩触发阈值与摘要 prompt 文案（只改切割/边界/重试/累计逻辑）。
- stall 修复提示词固定一句话（不做 loopx 的 replan obligation 结构化清单）。
- 三段各自独立 commit（feat(compact): / feat(heartbeat): / feat(budget):），可分别 review。
