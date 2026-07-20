# 02 PR-2：审批等待 / 破坏性清单 / 断路器 / 预算（分支 `arch/approval-circuit-budget`）

> 用法：连同 `00-执行约定.md` 一起粘贴给实现 agent。发现细节见体检报告 C3/C5/C6/D6 条。

## 任务

### C3（P1）审批等待注册表 missed-wakeup + TTL 误报

现状：`apps/server/src/infra/approvalGate.ts:160-233`——`waitApprovalResolution` 先 `await getById` 读状态、后注册 waiter：读（pending）与注册之间决策+notify 落地则事件丢失，waiter 挂到 TTL（默认 24h）。TTL 定时器（:216-228）忽略 `expireApprovalIfPending` 条件写结果，count=0（实际已被并发批准执行）也无条件 `resolve({outcome:"expired"})` → LLM 被告知「审批超时未执行」但操作其实已执行，可能重复执行（如 git_commit）。批量清扫 `expireStaleApprovals`（:284-308）同样对 findMany 快照全量 notify，不论实际翻转几行。

设计契约：

- 不变量：**「决策事件必达」= 注册先行、对账在后**。先同步注册 waiter → 同一临界区复读一次审批状态：已决 → 立即 resolve 真实结果并摘 waiter；pending → 正常等待。读与收事件闭合成原子区间（无 await 交错；参照 askUserGate 的同步临界区做法）。
- TTL 到期的 expired 解析**必须以条件写 count=1 为前提**；count=0 说明已有并发决策 → 复读真实状态如实 resolve（approved/rejected）。
- `expireStaleApprovals` 只对自己条件写实际翻转成功的行发 notify。
- 顺手统一两 gate 语义（A6）：approval 与 ask_user 的挂起/唤醒/中止行为抽成同一原语或至少对齐文档化差异（abort 时 approval 抛错 vs ask_user 注入「被中止」续轮——选定一种语义，全仓对齐；建议保留各自语义但在同文件注释明确，不强制统一实现）。

### D6（P1）destructive 两份清单漂移

现状：`approvalGate.ts:48-65` `DESTRUCTIVE_NATIVE_OPS` 硬编码 16 个；`tools/types.ts` 注释明确「单点在域注册处声明」，域注册处（如 `tools/native/swarm.ts:1476`）`agent_delete_sub destructive:true` 不在审批清单 → `AGENT_DESTRUCTIVE_APPROVAL=true` 时删子 Agent 绕过审批。

设计契约：

- approvalGate 改为**从 registry 派生**：`listTools("native").filter(t => t.destructive)` 为唯一事实源，删除硬编码 Set。
- 在 `registerNativeDomain`（或 registry 单点）加反向校验：destructive 工具默认入审批清单；确需豁免必须显式声明（如 `approvalExempt:true` 字段，注明理由注释）。注意避免循环依赖（approvalGate → registry 的 import 方向；若成环，把派生函数挂到 tools/registry 叶子上，approvalGate 调它）。
- 核对 tRPC 侧对齐清单（`memory.delete`/`post.delete` 走审批的声明）也改从同一派生读取。

### C6（P2）CircuitBreaker 半开期无探测纪元

现状：`infra/circuitBreaker.ts:123-153`——`recordSuccess/Failure` 只按当前 state 解释事件。closed 期发出的在途请求在 half-open 探测在途时完成：其成功被当探测成功误合闸（且清 probeInFlight，真探测还在飞可再放进一个）；其失败被当探测失败误重开重计 openedAt。

设计契约：half-open 放行探测时返回探测令牌（token/epoch），`record*` 校验令牌归属；非探测期迟到事件一律忽略；探测成功才合闸、探测失败才重开。保持既有三态转移表与「非法转移拒绝」语义不动。

### C5（P2）llmBudget hydrate 竞态 + 软语义明示

现状：`infra/llmBudget.ts:43-62` 模块级内存 + fire-and-forget hydrate——重启后首个 getState 触发异步读盘，读盘完成前已有消耗（dirty=true）时整份磁盘消耗被丢弃（重启即抹掉今日已花额度）；`assertWithinBudget`（:121-142）与 record 分离，并发 N 入口都看到未超限全放行（TOCTOU）。

设计契约：

- hydrate：启动期一次性 await 完成后再服务请求（在 server 启动序列挂载，参照 runStartupRecovery 的挂法）；或合并式 hydrate（内存与磁盘取 max，不丢已花）。二选一，选「启动 await」更直白。
- 软语义：日预算是「估算下界、并发可超」——把这句话写进 llmBudget.ts 头注释与 `docs/development/concurrency.md`；不做预留制（登记 design-decisions 待办）。

## 测试要求

- C3：负向断言——决策落在「读 pending 之后、注册之前」的窗口（用可控的 fake prisma/notify 时序）→ 旧实现挂起到 TTL，新实现立即 resolve 真实结果；TTL 边界并发批准 → 不再误报 expired（断言 resolve 值为真实 approved）；expireStaleApprovals 对翻转失败的行不 notify。
- D6：负向断言——`agent_delete_sub` 在 `AGENT_DESTRUCTIVE_APPROVAL=true` 时必须触发审批（旧实现不触发）；派生清单与 registry destructive 集合相等的单测（防再漂移）。
- C6：注入「closed 期发出的迟到成功/失败」→ 断言不改变 half-open 判定；探测令牌不匹配的事件被忽略。
- C5：模拟「磁盘有消耗、hydrate 未完成的窗口内发生新消耗」→ 断言合并后不丢额度。
- 跑：`pnpm --filter @knowpilot/server test` 全绿（重点 circuitBreaker/agentTools/approval 相关测试文件）；`pnpm lint`。

## 验收清单

- [ ] C3 三个竞态点各有负向测试 + 修复；askUserGate 对照语义注释就位
- [ ] 硬编码 DESTRUCTIVE_NATIVE_OPS 删除，派生单点 + 反向校验就位；agent_delete_sub 审批测试通过
- [ ] C6 探测令牌机制 + 测试；既有 circuitBreaker.test.ts 11 例不回归
- [ ] C5 hydrate 启动挂载 + 合并语义测试；软语义文档化
- [ ] lint + server test 全绿，合并入 master；体检报告对应行标注；AGENTS.md 更新

## 红线

- 不改变审批对外流程语义（批准→执行→唤醒的路径不变），只修竞态。
- 不改断路器对外 API 形状（executeMcpTool 调用点不动）。
- 预算不做硬预留制（那是另一个工单，登记即可）。
