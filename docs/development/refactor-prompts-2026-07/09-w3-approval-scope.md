# 09 W3：审批 decision-scope + safe fallback（分支 `feat/approval-scope`）

> 用法：连同 `00-执行约定.md` 一起粘贴给实现 agent。**依赖 PR-2（arch/approval-circuit-budget）已合并。**
> 设计来源：loopx 的 user gate decision-scope 与安全 fallback（参考 `tmp/references/loopx`：`docs/project-agent-todo-contract.md`、`loopx/quota.py` 的 `_blocked_priority_fallback` / `safe_bypass_user_gate_fallback`）。

## 目标

KnowPilot 审批现状：工具触发审批 pending → 整个 run 挂起 awaiting_human，用户不批就全停。loopx 的语义更细：gate 用 decision_scope 精确圈定阻塞范围——被堵的路挂着，scope 不重叠的工作继续推进；gate 公示后允许一个有界只读步（safe bypass）；gate 通知有冷却，不每 tick 重复打扰。本工单把这套语义引入 KnowPilot 审批体系。

## 设计契约（已拍板，按此实现）

### Scope 模型

- `Approval` 表加 `decisionScope String?`——创建审批时由服务端从「工具名 + 关键参数」派生，格式 `<domain>:<verb>:<target>`：
  - `git:commit:<repoId>`、`git:push:<repoId>`
  - `fs:write:<规范化路径前缀（目录级）>`、`fs:delete:<路径>`
  - `agent:delete:<agentId>`、`memory:delete:<memoryId>`、`post:delete:<postId>`
  - 派生函数收在 approvalGate（或新叶子 `infra/approvalScope.ts`），每个 destructive 工具注册处可提供 `deriveScope(args)`，缺省回退 `tool:<toolName>`。LLM 不可见、不可传（与 taskRef/depth 同纪律）。
- 工作项声明 `requiredScopes`：swarm 任务（spawn/async taskSpec）与心跳 run 可按其工具集静态推导（该 run 可用工具 → 可能产生的 scope 集合，粗粒度即可——如声明了 write_file 则含 `fs:write:*` 通配）。v1 通配匹配规则：`fs:write:*` 覆盖 `fs:write:<任意路径>`；`git:*` 覆盖 git 全族。匹配函数与派生函数同模块。

### 挂起语义升级

- 现状「run 挂起 awaiting_human」**保留**（单 run 内串行，这是简单正确的部分），本工单升级的是**跨工作项的调度面**：
  - swarmOrchestrator / asyncJobOrchestrator 选择下一个执行体前，检查其 requiredScopes 与当前 pending approvals 的 decisionScope 是否相交——相交 → 跳过（记 reason「gate 阻塞」），不相交 → 正常准入。**被堵的 lane 挂着，其他 lane 继续跑。**
  - 心跳决策层（W2 已落地）的 wait_user_gate mode 输出附带被堵 scope 清单；若该 agent 还有其他不冲突的待办（queued items），决策可返回 bounded_delivery 并在 packet.reasons 注明「gate 仅阻塞 scope X，其余推进」。
- **safe bypass**：gate 已公示（通知已发/已展示）后，被堵 agent 允许执行**一个有界只读步**——v1 定义：一次仅含只读工具（fs 读类/web 读类/memory_search 等，复用 reentrant=true 的只读工具集）的 turn，产出分析/计划但不写。入口：决策层 mode 仍 wait_user_gate 时，若 `safeBypassUsed=false` 则允许一个 readonly turn 并置 `safeBypassUsed=true`（存 Agent.heartbeat blob 或 run 上下文），同一 gate 生命周期内只用一次。
- **通知冷却**：per-approval `lastNotifiedAt`（复用 Approval 行加列或内存 map + TTL——选 Approval 加列，重启不丢）；同一 gate 冷却窗口（config `approvalGate.notifyCooldownMs`，默认 30min）内不重复通知；冷却判断收在通知单点。

### UI/可观测

- /approvals 列表加 decisionScope 列；/runs 的 awaiting_human 卡显示被堵 scope；右栏状态页「进行中」组对 gate 阻塞的排队项显示「因审批 X 阻塞 scope」。

## 测试要求

- `__tests__/approvalScope.test.ts`：
  - 派生函数：各 destructive 工具 args → 预期 scope 字符串；缺省回退；
  - 匹配：通配/精确/不相交三态；
  - 调度：pending approval(fs:write:/a) 存在时——requiredScopes 含 fs:write:* 的准入被拒、不含的放行（负向：旧实现全堵/全放）；
  - safe bypass：同 gate 只放行一次 readonly turn，第二次不再放行；readonly turn 内写工具被权限层拒绝（复用既有工具权限）；
  - 通知冷却：窗口内第二次通知被抑制。
- 既有 approval 相关测试（approvalGate/agentTools/runLifecycle）不回归。
- 跑：`pnpm --filter @knowpilot/server test`、`pnpm lint` 全绿。

## 验收清单

- [ ] Approval.decisionScope 列 + 派生/匹配模块 + 迁移（存量 pending 审批回填缺省 scope）
- [ ] 调度面 scope 相交检查接入（orchestrator 单点）
- [ ] safe bypass 一次性只读 turn
- [ ] 通知冷却 + UI 展示
- [ ] lint + server test 全绿，合并入 master；AGENTS.md 更新；design-decisions.md 记录「v1 保留单 run 挂起，升级调度面」的边界

## 红线

- 不实现「单 run 内部分挂起」（run 内工具级并行调度是另一个量级的事，登记待办）。
- scope 派生/匹配不做全路径规范化解析（不做 realpath/环境变量展开）——字符串前缀级即可，文档注明近似语义。
- 不改审批批准/拒绝/执行的主流程（PR-2 刚修过，保持）。
