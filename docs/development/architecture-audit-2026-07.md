# KnowPilot 架构审查报告（2026-07-13）

> 审查依据：`agent_architecture_audit_prompt v1.0`（10 维度）
> 审查范围：`apps/server/src/`（重点 `infra/`）、`apps/web/components/chat.tsx`、`packages/shared/`
> 审查分支：`fix/p0-agent-budget-hitl`（含未提交改动）
> 审查方式：两路并行只读代码审查，所有证据精确到文件:行号

---

## 一句话总结

**当前架构处于「骨架优秀、血肉欠债」阶段**：ReAct 内核（phase 状态机）、Swarm 权限代理、配置外置是教科书级样板；但记忆层和反思层完全缺位，LLM 调用零重试零降级，审批审计有合规硬伤，两个 3400 行上帝文件 + 一个真运行时循环依赖环是必须偿还的债务。

## Top 5 问题（按 ROI 排序）

1. **审批审计硬伤（HITL，半天工作量）**：`Approval` 无 `decidedBy/decidedAt`，且 `approvalGate.ts:242` 审批执行成功后**物理删除审批记录**——审计痕迹被销毁。
2. **LLM 调用零重试零降级（错误恢复）**：`llmClient.ts:247-250,345-348` 遇 `!res.ok` 直接 throw，429/5xx/网络抖动无指数退避；配置了 14 个 provider 却从不 failover。
3. **记忆层全面缺位（Memory）**：无 `MemoryRepository` 抽象，`agentRuntime.ts:29-54` 等多处直查 Prisma；`Memory` 模型**无 `agentId/sessionId` 字段**导致跨 Agent 上下文污染；`strength` 字段无任何衰减逻辑消费。
4. **运行时循环依赖环**：`agentRuntime → reactLoop → agentTools → nativeTools → agentRuntime`，靠函数提升侥幸不炸，代码里 10+ 处 `await import()` 动态导入打补丁躲环。
5. **前端 chat.tsx 残留编排层补丁**：`chat.tsx:1849-1854` `queueMicrotask` 兜底 drain 与 `onStreamCommitted` 正规钩子**双驱动并存**，直接违反 AGENTS.md「禁止打补丁」铁律；另有 4 处 microtask + 1 处 `await hydrate`。

## 10 维度总评

| # | 维度 | 状态 | 一句话 |
|---|---|---|---|
| 1 | LLM 调用层 — 策略模式 | ⚠️ | 单一出口 + 14 厂商配置切换达标；但无 Provider 接口、DeepSeek 特判渗入通用层、推理策略不可插拔 |
| 2 | 工具层 — 适配器+命令模式 | ⚠️ | ToolCommand + 注册表 + PR-4a 三域落地；但 ~80 个遗留工具仍堆 3376 行、**rollback 全仓零实现**、并发分级双真相 |
| 3 | 记忆层 — 仓储+缓存 | ❌ | 无仓储抽象、无 session/agent 隔离、无淘汰策略，prompt 拼接处直查 Prisma |
| 4 | 状态管理 — 状态机 | ⚠️ | 后端 phase 机是样板（`loop/phase.ts:9-53`）；前端基本达标但残留补丁；Run 表是死日志；无 checkpoint、无 AWAITING_HUMAN |
| 5 | 反思层 — 装饰器模式 | ❌ | 完全不存在，无任何 critic/verify 模块或 LLM 调用装饰器 |
| 6 | 多 Agent 协作 — 中介者+代理 | ⚠️ | Guard 扎实、Bus 有抽象；但中介者缺位（四个入口各自为政），heartbeat 已在绕过体系 |
| 7 | 错误恢复 — 断路器+补偿 | ⚠️ | 超时/预算/审批/重启恢复齐全；但无断路器、LLM 零重试、错误不分类、无 saga |
| 8 | HITL — 拦截器模式 | ⚠️ | 闸门收敛双路径共用；但 tRPC 侧手动包装 9 处易漏、审计字段缺失且执行后删记录 |
| 9 | 配置与实例化 — 工厂/建造者 | ⚠️ | 配置三层外置 + DI 容器优秀；但三 tier 实例化无工厂（三处硬编码）、配置无热更新 |
| 10 | 通用代码质量 — 反模式 | ❌ | 两个 3400 行上帝文件、一个运行时循环依赖环、globalThis 状态、模型名硬编码 31 处 |

---

## 各维度关键证据

### 维度 1：LLM 调用层 ⚠️

**达标**：
- `infra/llmClient.ts` 是全仓唯一 LLM HTTP 出口（`chatCompletion` :205、`chatCompletionStream` :301 是仅有的两处 `fetch(.../chat/completions)`），全仓无裸调 SDK。
- 14 厂商 baseUrl 表（:65-79），`.env` 驱动切换，改配置不改业务代码。
- ReAct 内核显式 phase 机（`loop/phase.ts:19-27`），sync/stream 共用内核只换 `LlmTransport`（`loop/transports.ts:14,36`）。

**违规**：
- 是「一个客户端」而非「策略接口」：无 `LlmProvider` 多态；厂商识别靠**字符串包含嗅探**（`inferProviderFromModel` :179-193，`lower.includes("deepseek")` 等）。
- DeepSeek 特判渗入通用层：`resolveDeepSeekRequest`（:122-150）、`applyDeepSeekThinkingBody`（:167-176）、`reasoning_content` 序列化（:152-165）——非 OpenAI 兼容厂商（Anthropic 原生 Messages API）无法接入。
- 推理策略不可插拔：ReAct 硬编码在 `runReactLoop`（`reactLoop.ts:118`），无法切换 Plan-Execute / CoT-only。
- mock 开关裸读 env：`process.env.MOCK_LLM` 在 :212,308 直接分支。

### 维度 2：工具层 ⚠️

**达标**：
- `ToolCommand` 接口存在（`tools/types.ts:20-28`，含可选 `rollback`），全局注册表（`tools/registry.ts:7-42`）。
- PR-4a 落地：`tools/native/{fs,web,shell}.ts` 经 `registerNativeDomain` 灌入，新增工具不改 Agent 核心。
- 分发统一：`executeNativeTool`（`nativeTools.ts:1317-1367`）先过 Swarm 权限硬拦截再走注册表；`executeAgentTool`（`agentTools.ts:296-327`）统一 native/skill/mcp 三路 + HITL 闸门。
- tRPC 侧 Zod → JSON Schema 自动生成（`router.ts:899` `zodToJsonSchema`）。

**违规**：
- **rollback 全仓零实现**：仅存在于 `tools/types.ts:5,27` 接口定义，无一工具实现、无一调用方——补偿入口是空壳。
- ~80 个遗留工具仍堆在 `nativeTools.ts`（3376 行）：handler（:105-194）+ 手写 JSON schema 字面量（:196-1271，非 Zod 生成）。PR-4b/4c 未做。
- 并发分级双真相：`CONCURRENCY_CLASS_NATIVE`（`agentTools.ts:75-127`）与接口的 `concurrencyClass?` 字段并存，注册时从不填后者。

### 维度 3：记忆层 ❌

- 全仓 0 处 `MemoryRepository` 定义。prompt 拼接处直查 Prisma：`agentRuntime.ts:29-54` `buildMemoryContext()`（两条路径绕过统一接口）、`agentEvolution.ts:64-70,103,178` 直读直写（绕过 MemoryService 的 FTS 同步与文件回写）、`nativeTools.ts:2528` 又一次直查 + `startsWith("{")` 猜 JSON（:2530-2544 面条代码）。
- 短期（ChatMessage + `contextSummary`）与长期（Memory 表）完全异构，唯一桥梁是 `memoryFlush.ts:56-106` 单向管道。
- **无隔离**：`Memory` 模型（`schema.prisma:232-242`）无 `agentId/sessionId/workspaceId`——子 Agent 经验、用户偏好全局共享，注入任意 Agent 的 system prompt（`agentRuntime.ts:241,337`）。代码自己在 `nativeTools.ts:2522` 注释承认「experience 会污染父 Agent 上下文」，但治理手段是读时手工过滤而非写时隔离。
- **无淘汰**：`strength` 字段无任何 decay/LRU/TTL 逻辑消费；去重是 `content.slice(0,40)` 前缀匹配（`memoryFlush.ts:88-89`，挡不住语义重复且 N+1 查询）。

### 维度 4：状态管理 ⚠️

- ✅ 后端：`loop/phase.ts:9-53` 教科书实现，`TRANSITIONS` 表 + 非法转移直接抛错（:42）；`reactLoop.ts:4-9` 文件头明确 4 条不变量。
- ✅ 前端三层 store：`useStreamLifecycle.ts:119-126` reducer 强制 INV-2（occupied 拒绝 BEGIN_STREAM）、:230-243 INV-1（done→idle 唯一入口 COMMIT_STREAM）、显式 `onStreamCommitted` 钩子（:286-301）。
- ❌ 前端残留补丁（违反 AGENTS.md 自检清单第 4 条）：`chat.tsx:1849-1854` queueMicrotask 兜底 drain 与正规钩子双驱动；:1683,1704,1842,1851 共 4 处 microtask；:444 `await hydrateFromServer()` 赌落库。共 28 个 useEffect。
- ❌ Run 表是死日志：所有写入点都是终态一次性写（`agentRuntime.ts:274`、`agentStream.ts:652-670`），无 `status:"running"` 落库、无 phase 快照 → 无 checkpoint 恢复（`config.yaml` 注释自认「运行中的 Agent 任务随重启丢失」）。
- ❌ 无 `AWAITING_HUMAN` phase：审批以工具报错建模，审批通过后 `approveAndExecute`（`router.ts:825-828`）只执行操作**不续跑原会话**——ReAct 链断裂，要等用户下一轮消息。对照组 `sleep` 工具已有真正的挂起/唤醒（Task + scheduler 续跑）却未复用。

### 维度 5：反思层 ❌

- 全 `infra/` 搜索 `reflect|critic|review|self.?correct` 零命中相关模块。
- LLM 调用链无装饰器：`transports.ts:14,36` 直接调 llmClient。
- 最接近的质量门是 Auto-Compact 与 Loop Contract 停滞检测（`loopContract.ts`），管上下文/进度，不评估输出质量。
- 后果：工具结果错误/幻觉答案无人复核直接进 `done`；纠错只能靠用户人工点 retry（`agentStream.ts:328-331`）。

### 维度 6：多 Agent 协作 ⚠️

- ✅ 权限代理扎实：`swarmPermissionGuard.ts:33-64` `TIER_RESTRICT_TOOLS` 按 tier 声明 + `checkToolPermission`（:99-183）硬拦截；纵深防御细致（sub 强制 `mode=tool` :116-124、manager 锁本 Workspace :127-135、禁自删 :138-150）。
- ✅ 通信有总线抽象：`swarmBus.ts:49-53` `SwarmBus` 接口 + Local 实现 + 预留 Redis；深度防循环（:82-88）、容量上限（:90-99）、审计日志（:116-124）、推优先（:138-173）。
- ❌ 无统一中介者：任务分发在 `nativeTools.ts:1978` spawnSubagentTool、执行调度在 `asyncJobOrchestrator.ts`、结果聚合在 `asyncJobManager.ts`、心跳触发在 `heartbeatEngine.ts:253-328`（**自己内联一个返回 undefined 的 invokeTrpc 桩** :260-264）——四个入口各自为政。心跳路径甚至绕过 swarm 消息体系直接 `runAgentLoop`（:266-277）。
- ❌ spawn 层面无任务去重；`MAX_DEPTH=10` 在 `swarmBus.ts:21` 与 `swarmPermissionGuard.ts:174` 两处独立定义。

### 维度 7：错误恢复 ⚠️

**已有**：工具超时兜底（`agentTools.ts:427-442`，默认 30s）、MCP 单次重连重试（`mcpClient.ts:173-203`）、LLM 预算硬闸（`llmBudget.ts:75-83`）、重启后遗留任务收口（`asyncJobManager.ts:382-415`）、异步任务手动重试（:1296-1362）。

**缺失**：
- 无断路器：MCP server 连续失败 100 次就重连 100 次（每次调用独立重试 :188-202）；心跳失败仅计数发邮件后继续撞墙（`heartbeatEngine.ts:35`）。
- LLM 零重试零降级：`!res.ok` 直接 throw（`llmClient.ts:247-250,345-348`）。
- 错误不分类：`retryable` 一律写死 `true`（`agentRuntime.ts:293,404`），不区分 401/429/400。
- 无 saga：`asyncJobManager.ts` 20+ 处 `console.warn(...失败)` 吞错（:254,282,332,629,712,832…），失败无反向操作。

### 维度 8：HITL ⚠️

- ⚠️ tRPC 侧是手动包装而非自动拦截器：`withApprovalGuard()` 逐个 procedure 手包 9 处（`router.ts:100,116,365,375,384-385,599,622-631,777`），新增危险 procedure 忘包无任何机制能发现。Agent 侧单点（`agentTools.ts:322-324`）是真拦截器 ✅。
- ⚠️ 审批规则硬编码 Set（`approvalGate.ts:15-39`），仅两个 env 开关，`config.yaml` 无审批规则段。
- ✅ 超时默认拒绝（24h TTL，:46-52），但清理是惰性触发（:134-138）且 `pageSize:100` 漏扫。
- ❌ **审计硬伤**：`Approval` 模型无 `decidedBy/decidedAt/rejectReason`；`executeApprovedOperation` 成功后 :242 **直接删除审批记录**。对比 `swarmBus.ts:116-124` 有 Log 审计——项目知道该怎么做，审批域没对齐。

### 维度 9：配置与实例化 ⚠️

- ✅ Agent 配置外置（`content/agents/*.md` frontmatter + 双向写回）、`.env` / `config.yaml` 三层分离、`ServiceContainer` DI（`serviceContainer.ts:36-82`）、Turn Snapshot 冻结（`reactLoop.ts:128-134`）。
- ❌ 无 Agent 工厂：三 tier 实例化是三处手写常量 + 直写 Prisma——super（`swarmInitializer.ts:27-73,169-181`）、manager（`agentRuntime.ts:111-190`，且 :145-177 读路径带写副作用，静默自动改用户数据）、sub（`loop/setup.ts:9-16`）。
- ❌ 无热更新：`getAppConfig` 是 globalThis 单例（`config.ts:533-541`），改模型/温度须重启进程。

### 维度 10：反模式 ❌

- **上帝文件**：`chat.tsx` 3467 行（`ChatView` 单组件 ~3300 行、28 个 useEffect）；`nativeTools.ts` 3376 行（PR-4a 拆走 1317 行后仍是巨兽）。`services.ts` 2328 / `router.ts` 998 属 AGENTS.md 明文约定的知情决策 ⚠️。
- **运行时循环依赖环**：`agentRuntime → loop/index → reactLoop → agentTools → nativeTools → agentRuntime`（nativeTools.ts:16 值导入 agentRuntime 三个函数）。10+ 处 `await import()` 躲环（`nativeTools.ts:1327,2140,2253,2380,2664,2812,2889,3030`…）。
- **隐式全局状态**：`llmBudget.ts:16` 预算状态挂 globalThis 且 LLM 调用路径上**同步 fs 读写** `.dev-log/llm-budget.json`（:35-44）；模块级可变单例 10+ 处，每个配套 `__reset*ForTests`——全局状态多到测试需逐一重置本身就是信号。
- **重复代码**：工具清单三处独立维护（`agentRuntime.ts:111-129` / `swarmInitializer.ts:54-73` / `loop/setup.ts:9-16`，加上 `resolveAgent:148-156` 是第四处枚举）；兜底 prompt `"你是 KnowPilot 助手。"` 在 `nativeTools.ts:2259` 与 `router.ts:449` 重复。
- **魔法数字**：`"deepseek-v4-flash"` 硬编码 31 处 / 14 个文件（而 `packages/shared/src/constants.ts:135` 明明有模型注册表）；39 处 `.slice(0, N)` 硬截断（16000 同值出现在 `reactLoop.ts:133` 与 `web.ts:378` 不同源）；`heartbeatEngine.ts:322` 连续失败 3 次后只 console.warn——注释「邮件通知在 Phase 5 实现」的僵尸功能。

---

## 机器可读 JSON

```json
{
  "summary": {
    "total_files_scanned": 60,
    "total_issues": 32,
    "critical": 9,
    "warning": 18,
    "compliant": 5
  },
  "dimensions": [
    { "id": "llm_strategy", "name": "LLM 调用层 — 策略模式", "status": "⚠️", "score": 6,
      "issues": [
        { "severity": "warning", "file": "apps/server/src/infra/llmClient.ts", "line": 179, "description": "厂商识别靠字符串包含嗅探，无 LlmProvider 接口", "consequence": "接入非 OpenAI 兼容厂商需改序列化+请求体+流式解析三处", "refactor_suggestion": "定义 LlmProvider 接口 + provider 注册表 matches(model) 钩子" },
        { "severity": "warning", "file": "apps/server/src/infra/llmClient.ts", "line": 122, "description": "DeepSeek 特判渗入通用序列化层", "consequence": "换厂商要携带 reasoning_content 兼容负担", "refactor_suggestion": "收进 DeepSeekProvider 实现" },
        { "severity": "info", "file": "apps/server/src/infra/loop/reactLoop.ts", "line": 118, "description": "ReAct 是唯一推理策略，硬编码", "consequence": "新增推理范式要改内核", "refactor_suggestion": "抽 AgentLoopStrategy 接口" }
      ] },
    { "id": "tool_command", "name": "工具层 — 适配器+命令模式", "status": "⚠️", "score": 6,
      "issues": [
        { "severity": "critical", "file": "apps/server/src/infra/tools/types.ts", "line": 27, "description": "rollback 接口全仓零实现零调用", "consequence": "D 类写入工具失败即半成品，无补偿", "refactor_suggestion": "为 write_file/git_push/post_create 等 D 类工具实现幂等 rollback，reactLoop 在 run 失败时逆序调用" },
        { "severity": "warning", "file": "apps/server/src/infra/nativeTools.ts", "line": 105, "description": "~80 个遗留工具 + 手写 JSON schema 堆在 3376 行单文件", "consequence": "新增工具触碰上帝文件；schema 与 Zod 真相漂移", "refactor_suggestion": "完成 PR-4b/4c 按域迁出；schema 改 Zod 复用 router.ts:899 转换" },
        { "severity": "warning", "file": "apps/server/src/infra/agentTools.ts", "line": 75, "description": "CONCURRENCY_CLASS_NATIVE 与 ToolCommand.concurrencyClass 双真相", "consequence": "分类信息游离接口之外，注册时从不填", "refactor_suggestion": "并入各域注册时的 concurrencyClass 字段" }
      ] },
    { "id": "memory_repository", "name": "记忆层 — 仓储+缓存", "status": "❌", "score": 2,
      "issues": [
        { "severity": "critical", "file": "apps/server/src/infra/agentRuntime.ts", "line": 29, "description": "buildMemoryContext 等 4+ 处直查 Prisma，无 MemoryRepository 抽象", "consequence": "换向量库需改 ≥5 个散落文件", "refactor_suggestion": "定义 MemoryRepository 接口 + PrismaMemoryRepository 实现" },
        { "severity": "critical", "file": "apps/server/prisma/schema.prisma", "line": 232, "description": "Memory 模型无 agentId/sessionId/scope 字段，全局共享", "consequence": "子 Agent 经验污染父 Agent 上下文（代码注释自认）", "refactor_suggestion": "加 scope 字段，默认按 agent 隔离 + 显式 global scope" },
        { "severity": "warning", "file": "apps/server/src/infra/memoryFlush.ts", "line": 88, "description": "strength 字段无衰减逻辑消费；去重靠 slice(0,40) 前缀匹配", "consequence": "记忆表只增不减无限膨胀；语义重复挡不住", "refactor_suggestion": "repository 层读时按 strength×recency 排序 + 后台周期 decay" }
      ] },
    { "id": "state_machine", "name": "状态管理 — 状态机", "status": "⚠️", "score": 7,
      "issues": [
        { "severity": "critical", "file": "apps/web/components/chat.tsx", "line": 1849, "description": "queueMicrotask 兜底 drain 与 onStreamCommitted 正规钩子双驱动并存（违反 AGENTS.md 铁律）", "consequence": "下个闪烁 bug 的温床；回调顺序一变即破", "refactor_suggestion": "删兜底 effect；漏的场景收进 Lifecycle reducer（如 HYDRATE_DONE action 触发 drain）" },
        { "severity": "warning", "file": "apps/server/src/infra/agentRuntime.ts", "line": 274, "description": "Run 表只写终态，无 running 落库无 phase 快照", "consequence": "无法回答哪些 run 在跑；重启后无 checkpoint 可恢复", "refactor_suggestion": "run.create(running) → 周期快照 → 终态 update；重启标 interrupted 或重建" },
        { "severity": "warning", "file": "apps/server/src/infra/loop/phase.ts", "line": 19, "description": "无 AWAITING_HUMAN phase；审批通过后不续跑原会话", "consequence": "ReAct 链断裂，需人工接力", "refactor_suggestion": "复用 sleep 工具的挂起/唤醒机制，approval_resolved 事件触发 resume" }
      ] },
    { "id": "reflection", "name": "反思层 — 装饰器模式", "status": "❌", "score": 0,
      "issues": [
        { "severity": "critical", "file": "apps/server/src/infra/loop/transports.ts", "line": 14, "description": "无任何 critic/verify 模块；LLM 调用链无装饰器", "consequence": "幻觉答案无人复核直接进 done；纠错全靠用户人工 retry", "refactor_suggestion": "withReflection(transport, {rounds, criticModel, enabled}) 装饰器，critic 不通过则经 injectUserMessages 回注再走一轮" }
      ] },
    { "id": "multi_agent", "name": "多 Agent 协作 — 中介者+代理", "status": "⚠️", "score": 6,
      "issues": [
        { "severity": "critical", "file": "apps/server/src/infra/heartbeatEngine.ts", "line": 253, "description": "无统一中介者；heartbeat 内联 invokeTrpc 桩（返回 undefined）并绕过 swarm 消息体系", "consequence": "新加入口极易漏并发/预算/权限一环（桩就是已漏实例）", "refactor_suggestion": "抽 SwarmOrchestrator 统一 dispatch→权限→并发池→执行→聚合→审计，四入口改为调用方" },
        { "severity": "warning", "file": "apps/server/src/infra/swarmBus.ts", "line": 21, "description": "MAX_DEPTH=10 与 swarmPermissionGuard.ts:174 两处独立定义；spawn 无去重", "consequence": "规则漂移；同一 task 可被重复 spawn", "refactor_suggestion": "常量移到 packages/shared/constants.ts；按 (agentId, taskHash) 短窗口去重" }
      ] },
    { "id": "error_recovery", "name": "错误恢复 — 断路器+补偿", "status": "⚠️", "score": 5,
      "issues": [
        { "severity": "critical", "file": "apps/server/src/infra/llmClient.ts", "line": 247, "description": "LLM 调用 !res.ok 直接 throw，零重试零降级", "consequence": "厂商抖动直接表现为对话失败；14 个 provider 从不 failover", "refactor_suggestion": "ResilientLlmClient：错误分类 + 指数退避(3次+jitter) + fallbackProviders 换厂商" },
        { "severity": "warning", "file": "apps/server/src/infra/mcpClient.ts", "line": 188, "description": "无断路器，MCP 每调用独立重连重试", "consequence": "半死 server 每轮拖 12s 超时", "refactor_suggestion": "CircuitBreaker：每 server 失败计数→open N 秒→half-open" },
        { "severity": "warning", "file": "apps/server/src/infra/agentRuntime.ts", "line": 293, "description": "retryable 一律写死 true，错误不分类", "consequence": "前端无法区分重试/换 Key/需审批", "refactor_suggestion": "按 HTTP 状态/错误码真实填充 retryable" }
      ] },
    { "id": "hitl", "name": "HITL — 拦截器模式", "status": "⚠️", "score": 6,
      "issues": [
        { "severity": "critical", "file": "apps/server/src/infra/approvalGate.ts", "line": 242, "description": "审批执行成功后物理删除记录；模型无 decidedBy/decidedAt/rejectReason", "consequence": "审计痕迹被销毁，不合规", "refactor_suggestion": "加 decidedBy/decidedAt/decisionNote 字段；改软删除 status=executed 永不物理删除" },
        { "severity": "warning", "file": "apps/server/src/router.ts", "line": 82, "description": "withApprovalGuard 手动包装 9 处，新增危险 procedure 忘包无机制发现", "consequence": "遗漏即安全洞", "refactor_suggestion": "改 tRPC middleware 按 meta({approval:true}) 自动拦截" },
        { "severity": "info", "file": "apps/server/src/infra/approvalGate.ts", "line": 103, "description": "过期清理惰性触发 + pageSize:100 漏扫", "consequence": "无人碰审批时过期记录永不清理", "refactor_suggestion": "启动时 + 定时任务清理，不限 100 条" }
      ] },
    { "id": "config_factory", "name": "配置与实例化 — 工厂/建造者", "status": "⚠️", "score": 6,
      "issues": [
        { "severity": "warning", "file": "apps/server/src/infra/swarmInitializer.ts", "line": 27, "description": "三 tier 实例化无工厂，默认 prompt/tools 三处硬编码直写 Prisma", "consequence": "新增 tier 或调默认能力要同时改三个文件", "refactor_suggestion": "AgentFactory.create({tier, overrides})，模板从 content/agents/_templates/*.md 读取" },
        { "severity": "warning", "file": "apps/server/src/infra/agentRuntime.ts", "line": 145, "description": "resolveAgent 读路径带写副作用，静默自动改用户数据", "consequence": "用户配置被隐式覆盖，不可审计", "refactor_suggestion": "改为显式迁移脚本" },
        { "severity": "info", "file": "apps/server/src/infra/config.ts", "line": 533, "description": "getAppConfig 是 globalThis 单例，无热更新", "consequence": "改模型/温度须重启，心跳中的 super Agent 会中断", "refactor_suggestion": "reloadAppConfig() + config.yaml fs.watch，新 run 生效" }
      ] },
    { "id": "antipatterns", "name": "通用代码质量 — 反模式", "status": "❌", "score": 3,
      "issues": [
        { "severity": "critical", "file": "apps/web/components/chat.tsx", "line": 155, "description": "ChatView 单组件 ~3300 行、28 个 useEffect；nativeTools.ts 3376 行", "consequence": "无人能整体理解，改动靠祈祷", "refactor_suggestion": "按 PR-4b/4c 拆 nativeTools；chat.tsx 按面板/ hook 拆分" },
        { "severity": "critical", "file": "apps/server/src/infra/nativeTools.ts", "line": 16, "description": "运行时循环依赖环 agentRuntime→reactLoop→agentTools→nativeTools→agentRuntime，10+ 处动态 import 躲环", "consequence": "任何一处改模块顶层执行即崩", "refactor_suggestion": "把 nativeTools 依赖的 3 个 prompt 构造函数移入独立 promptBuilder.ts 打断环" },
        { "severity": "warning", "file": "apps/server/src/infra/llmBudget.ts", "line": 16, "description": "预算状态挂 globalThis 且 LLM 调用路径上同步 fs 读写", "consequence": "每次 LLM 调用带同步 IO；跨进程状态不一致", "refactor_suggestion": "状态进 SQLite 或内存 + 异步落盘" },
        { "severity": "warning", "file": "apps/server/src/infra/agentRuntime.ts", "line": 184, "description": "deepseek-v4-flash 硬编码 31 处/14 文件；工具清单三处独立维护", "consequence": "换默认模型改 14 个文件；清单漂移", "refactor_suggestion": "收敛为 config.llm.defaultModel 单一来源 + packages/shared 常量" }
      ] }
  ],
  "top_priorities": [
    "1. 审批审计（Approval 加字段 + 软删除）——合规硬伤，半天工作量，独立无依赖",
    "2. LLM 弹性客户端（重试/退避/降级/错误分类）——用户痛点最直接，投入最小",
    "3. chat.tsx 双驱动 drain 收口——AGENTS.md 铁律直接相关，防下个闪烁 bug",
    "4. MemoryRepository + scope 隔离——多 Agent 正确性前提，阻塞后续记忆功能",
    "5. 拆循环依赖环（抽 promptBuilder.ts）——是 PR-4b/4c 与一切 nativeTools 改动的前置",
    "6. 完成 PR-4b/4c + D 类工具 rollback——是 saga 补偿的前置",
    "7. 反思装饰器——独立增量，复用 LlmTransport 包装点",
    "8. SwarmOrchestrator 中介者——入口已漏一次（heartbeat 桩），越早统一代价越小"
  ],
  "architecture_adr": {
    "recommended_patterns": ["Strategy (LlmProvider/AgentLoopStrategy)", "Decorator (withReflection/ResilientLlmClient)", "Repository (MemoryRepository)", "Mediator (SwarmOrchestrator)", "Interceptor (approval middleware)", "Factory (AgentFactory)", "Circuit Breaker (MCP/外部工具)"],
    "suggested_directory_structure": "保持 AGENTS.md「单文件逻辑收拢」约定不变；新增限于：infra/promptBuilder.ts（打断循环）、infra/memoryRepository.ts、infra/agentFactory.ts、infra/swarmOrchestrator.ts、infra/resilientLlmClient.ts、infra/tools/native/{swarm,session,memory,integration}.ts（PR-4b/4c 域拆分）"
  }
}
```

---

> 配套修复提示词：`docs/development/architecture-fix-prompt-2026-07.md`
