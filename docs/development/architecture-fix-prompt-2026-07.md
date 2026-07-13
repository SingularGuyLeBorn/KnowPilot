# KnowPilot 架构修复任务提示词（2026-07-13）

> **使用方式**：把本文件整篇交给执行者（人或 AI 编码助手）。本提示词自包含，无需额外上下文。
> 配套审查报告（含完整证据与行号）：`docs/development/architecture-audit-2026-07.md`

---

## 0. 你的角色与项目背景

你是一位资深 TypeScript 架构师，要修复 KnowPilot 项目的架构债务。

- **项目路径**：`D:\ALL IN AI\KnowPilot`（pnpm monorepo：`apps/server` = Express+tRPC+Prisma+SQLite 后端，`apps/web` = Next.js 16 前端，`packages/shared` = 共享 Zod schema/常量）
- **工作分支**：`fix/p0-agent-budget-hitl`
- **必读文件（动手前）**：
  1. `AGENTS.md`（项目宪法，尤其是「架构纪律：禁止打补丁」一节——**违反即打回**）
  2. `docs/development/architecture-audit-2026-07.md`（本次修复的全部证据来源）
  3. `docs/development/p0-agent-arch-pr-split.md`（PR-4b/4c 拆分计划）

### 铁律（来自 AGENTS.md，必须遵守）

1. **禁止打补丁**：修状态机/编排层问题时，不变量必须收进 store 的 reducer/action。提交前过自检清单：删掉你加的编排层代码，reducer 还能保证正确吗？不能就是补丁。禁止新增 `await hydrate` / `setTimeout` / `queueMicrotask` / `phase === "xxx"` 守卫去赌时序。
2. **单文件逻辑收拢**：Service 逻辑只在 `apps/server/src/services.ts`；tRPC 路由只在 `apps/server/src/router.ts`；前端 hooks 只在 `apps/web/lib/hooks.ts`；共享 UI 组件只在 `apps/web/components/shared.tsx`。本提示词中允许新增的infra文件已明确列出，除此之外不要新建零散文件。
3. **最小改动**：达到目标的最小 diff，不顺手重构无关代码。
4. 注释、UI 文案、提交信息用中文；标识符用英文。提交前缀 `refactor:` / `fix:` / `feat:`。
5. UI 图标禁止 emoji。

### 验收命令（每个工单完成后必须跑）

```bash
pnpm lint        # server/shared 用 tsc --noEmit，web 用 eslint
pnpm test        # Vitest 全 package（不得有回归）
pnpm --filter @knowpilot/web build   # 涉及前端时
```

涉及 Chat 状态机的改动还需跑：`pnpm test:e2e`（至少 `chat-mock.spec.ts`、`chat-subagent-resume-mock.spec.ts`、`chat-resume-mock.spec.ts`）。

---

## 1. 工单总览（严格按优先级顺序执行，可拆成多个 commit）

| # | 工单 | 严重度 | 预估 | 阻塞依赖 |
|---|---|---|---|---|
| W1 | 审批审计合规修复 | 🔴 critical | 0.5 天 | 无 |
| W2 | LLM 弹性客户端（重试/退避/降级/错误分类） | 🔴 critical | 1.5 天 | 无 |
| W3 | chat.tsx 双驱动 drain 收口（状态机铁律） | 🔴 critical | 1 天 | 无 |
| W4 | 打断运行时循环依赖环（抽 promptBuilder.ts） | 🔴 critical | 1 天 | 是 W5/W6 前置 |
| W5 | MemoryRepository + scope 隔离 | 🔴 critical | 2 天 | W4 |
| W6 | 完成 PR-4b/4c + D 类工具 rollback | 🟡 high | 3 天 | W4 |
| W7 | 反思装饰器 withReflection | 🟡 high | 1.5 天 | 无 |
| W8 | 常量化收敛（模型名/工具清单/深度上限/截断值） | 🟡 high | 1 天 | 无 |
| W9 | AgentFactory + resolveAgent 去写副作用 | 🟢 medium | 1 天 | W8 |
| W10 | SwarmOrchestrator 中介者统一 | 🟢 medium | 2 天 | W6 |
| W11 | Run 表活状态 + AWAITING_HUMAN + 审批续跑 | 🟢 medium | 2 天 | W1 |
| W12 | MCP 断路器 + 审批清理定时化 | 🟢 medium | 1 天 | 无 |

**执行纪律**：每个工单一个独立 commit；工单内先写/改测试再改实现；任何工单不允许引入新的 `globalThis` 状态、新的动态 `import()` 躲环、新的裸模型名字符串。

---

## 2. 工单详情

### W1：审批审计合规修复（证据：approvalGate.ts:242、schema.prisma:362-371）

**问题**：`Approval` 模型无 `decidedBy/decidedAt/rejectReason`；`executeApprovedOperation` 成功后**物理删除审批记录**，审计痕迹被销毁。

**改动**：
1. `prisma/schema.prisma` Approval 模型加字段：`decidedBy String?`、`decidedAt DateTime?`、`decisionNote String?`、`executedAt DateTime?`；status 枚举语义增加 `"executed"`。
2. `pnpm db:push` + `pnpm db:generate`。
3. `approvalGate.ts`：
   - `executeApprovedOperation`（:186-251）成功后**改软删除**：`status: "executed"` + 写 `executedAt`，永不 `delete`。
   - approve/reject 入口写 `decidedBy`（当前单用户可写 `"local-user"`，从 AUTH 上下文取更佳）、`decidedAt`、`decisionNote`（reject 时来自入参）。
4. `expireStaleApprovals`（:103-120）：去掉 `pageSize: 100` 漏扫（循环翻页或直接用 prisma `updateMany` 一条 SQL 解决）。
5. `router.ts` 的 `approval.list` 确认能返回 executed 记录（管理页 `/approvals` 应能看到历史）。

**验收**：新增/修改 Vitest 用例覆盖「审批执行后记录仍在且 status=executed」「过期清理超过 100 条也全扫到」；`pnpm test` 通过；`git.commit` 审批 E2E 不回归。

---

### W2：LLM 弹性客户端（证据：llmClient.ts:247-250,345-348、agentRuntime.ts:293,404）

**问题**：`chatCompletion`/`chatCompletionStream` 遇 `!res.ok` 直接 throw——429/5xx/网络抖动无重试，14 个 provider 从不 failover；`retryable` 一律写死 `true`。

**改动**（装饰器模式，不改 llmClient 内核签名）：
1. 新增 `apps/server/src/infra/resilientLlmClient.ts`：
   - 错误分类函数：`classifyLlmError(status, body) → "fatal" | "retryable" | "degradable"`。规则：401/403→fatal；400/422→fatal（参数错）；408/409/425/429/5xx/网络异常/超时→retryable；`retryable` 重试耗尽且配置了备用厂商→degradable。
   - `withResilience(client, { maxRetries: 3, baseDelayMs: 1000, jitter: true })` 包装 `chatCompletion`：指数退避 + jitter；`MOCK_LLM` 时跳过退避等待。
   - `config.yaml` 新增段：
     ```yaml
     llm:
       maxRetries: 3
       baseDelayMs: 1000
       fallbackModels: []   # 形如 ["kimi-k2", "glm-4-flash"]，按序降级
     ```
     在 `infra/config.ts` 加解析（zod，给默认值，保持向后兼容）。
   - degradable 时按 `fallbackModels` 顺序换 model 重试（provider 由现有 `inferProviderFromModel` 推导）；全部耗尽才 throw。
2. 流式路径：`chatCompletionStream` 的**连接建立阶段**失败适用同样重试；**已开始输出 token 后**失败不重试（避免重复输出），只分类上抛。
3. `agentRuntime.ts:293,404` 与 `agentStream.ts` 的 error 事件：`retryable` 改为按 `classifyLlmError` 真实填充，message 中带「可重试 / 请检查 API Key / 已自动降级到 xxx」的明确指引。
4. `llmBudget.ts:16,35-44`：预算状态从 `globalThis` + 同步 fs 读写改为模块级内存 + **防抖异步落盘**（保留 `__resetForTests`）；LLM 调用路径上不得再有同步 IO。

**验收**：新增 `resilientLlmClient.test.ts`：用 fetch mock 覆盖 429→退避成功、401→立即 fatal、重试耗尽→降级到 fallback model、全部耗尽→抛错且 retryable=false；`MOCK_LLM` 下 e2e 不回归。

---

### W3：chat.tsx 双驱动 drain 收口（证据：chat.tsx:1849-1854,1683,1704,1842,1851,444,397）

**问题**：`chat.tsx:1849-1854` 的 `useEffect([isStreaming, queue.length, ...])` + `queueMicrotask(consumeRef)` 兜底 drain，与 :1840-1846 的 `onStreamCommitted` 正规钩子**双驱动并存**；另有 4 处 microtask、:444 `await hydrateFromServer()`、:397 `queueMicrotask(setSessionId)`。全部违反 AGENTS.md 自检清单第 4 条。

**方法（按铁律）**：
1. 先写一句中文不变量，例如：「Compose 队列的 drain 只能由三个显式事件触发：用户发送、onStreamCommitted、会话切换完成；任何 store 状态变化不得隐式触发 drain。」写进 `useStreamLifecycle.ts` 文件头注释。
2. 逐场景确认 :1849-1854 兜底 effect 实际在补哪个场景的洞（大概率是 hydrate 完成后队列里有 pending 消息的场景）。把该场景收进 Lifecycle reducer：如增加 `HYDRATE_DONE` action，在 reducer 的转移点置一个 `drainRequested` 标记，由 `onStreamCommitted` 同款显式钩子消费——**不许用 useEffect 监听状态来触发**。
3. 删掉 :1849-1854 兜底 effect 与 :1683,1704 两处 microtask；:397 的 `queueMicrotask(setSessionId)` 改为在路由/session 选择的同一个事件处理里同步设置。
4. :444 `await hydrateFromServer()`：若是「onDone 后赌落库」，改为信赖 `onStreamCommitted` 的 commit 数据；若确需服务端对账，放进 `HYDRATE_DONE` 的显式加载流程，不挂在流式 done 回调里。
5. 删一处就跑一次 `pnpm test:e2e` 的 chat 相关 spec；**任何场景 bug 复现 = 该场景的不变量还没收进 reducer，回去继续收，不许加回补丁**。

**验收**：`chat.tsx` 中 `queueMicrotask` 计数 ≤ 1（无法消除的需注释说明为什么不是补丁）、无 `await hydrate` 挂在流式回调上；`chat-mock` / `chat-subagent-resume-mock` / `chat-resume-mock` / `async-task-mock` e2e 全绿。

---

### W4：打断运行时循环依赖环（证据：nativeTools.ts:16、reactLoop.ts:12、agentTools.ts:10、agentRuntime.ts:13；动态 import 躲环 10+ 处）

**问题**：环 = `agentRuntime → loop/index → reactLoop → agentTools → nativeTools → agentRuntime`。nativeTools 值导入 agentRuntime 的 `buildMemoryContext/buildSystemPromptWithHints/resolveAgent`。

**改动**：
1. 新增 `apps/server/src/infra/promptBuilder.ts`：把 `buildMemoryContext`、`buildSystemPromptWithHints`、`buildTierIdentityHint`（agentRuntime.ts:72-97）三个纯函数移入（它们只依赖 services/prisma 与常量，不依赖 reactLoop）。
2. `nativeTools.ts` 改为从 `promptBuilder.ts` 导入；`agentRuntime.ts` 同步改导入（可 re-export 兼容，但新代码直接引 promptBuilder）。
3. `resolveAgent` 的调用方：若是工具层需要，改为通过工具 ctx 注入（`agentTools.ts` 的 ToolContext 已有 ctx 模式），而非 nativeTools 直接 import agentRuntime。
4. 消掉因此不再需要的动态 `import()`（至少 `nativeTools.ts:1327` 的 swarmPermissionGuard 改为静态导入——guard 本身不依赖 nativeTools，可安全静态化）。剩余动态 import 每处加注释说明为何仍必要。
5. 加一道防线：在 `apps/server/src/__tests__/` 加一个 import 顺序冒烟测试（以不同入口文件先加载，验证模块求值不炸）。

**验收**：`pnpm --filter @knowpilot/server test` 全绿；`grep -n "await import(" apps/server/src/infra/nativeTools.ts` 数量 ≤ 改动前的一半。

---

### W5：MemoryRepository + scope 隔离（证据：agentRuntime.ts:29-54、agentEvolution.ts:64-70,103,178、nativeTools.ts:2528、schema.prisma:232-242）

**问题**：无仓储抽象、4+ 处直查 Prisma；Memory 无 owner 字段导致跨 Agent 上下文污染；strength 无衰减；去重靠 slice(0,40)。

**改动**：
1. `schema.prisma` Memory 加 `scope String @default("global")`（取值：`global` / `agent:{agentId}` / `workspace:{workspaceId}`）+ `agentId String?` 冗余列便于查询；`pnpm db:push`。现有数据迁移：scope 全置 `global`（保持现行为不变），唯独 `type="experience"` 的按 sourceSlug 能归因到 agent 的置 `agent:{id}`，归因不了的保持 global。
2. 新增 `apps/server/src/infra/memoryRepository.ts`：
   ```ts
   interface MemoryRepository {
     read(query: { keyword?: string; types?: string[]; scopes: string[]; limit?: number }): Promise<MemoryItem[]>;
     write(input: { content: string; type: string; scope: string; strength?: number; keywords?: string[]; sourceSlug?: string }): Promise<MemoryItem>;
     forget(criteria: { scope?: string; beforeStrength?: number; before?: Date }): Promise<number>;
   }
   ```
   实现 `PrismaMemoryRepository`：read 走 FTS（失败回退 like 查询，即现有两条路径收进来）；读时排序 `strength * recencyScore`；去重改 `content` 全量 hash（新增 `contentHash` 列）而非前缀。
3. 改造调用方全部走接口：`promptBuilder.buildMemoryContext`（scopes = [`global`, `agent:{当前agent}`]）、`agentEvolution.ts`（写经验时 scope=`agent:{id}`，**不再绕开 MemoryService**，确保 FTS 同步与文件回写）、`nativeTools.ts` 的 `memorySearchTool`（按调用 Agent 注入 scopes）、`agentInspectTool`（:2528-2544 的 startsWith 猜 JSON 启发式删除，改按 type 字段查）。
4. 淘汰策略：新增 `decayMemories()`（strength *= 0.95 / 天，< 0.1 归档删除），挂到 heartbeatEngine 的每日 cron；`memoryFlush.ts:93` 的 0.95/0.85 改为 `packages/shared/constants.ts` 常量。
5. experience 污染问题：`buildMemoryContext` 默认排除 `type=experience` 的其他 agent scope（把 `nativeTools.ts:2522` 注释承认的问题从「读时手工过滤」改为「写时隔离」）。

**验收**：`memoryRepository.test.ts` 覆盖 scope 隔离（A agent 经验不出现在 B agent context）、contentHash 去重、decay 后低分归档；`chatHistory.test.ts` 等存量测试不回归。

---

### W6：完成 PR-4b/4c + D 类工具 rollback（证据：nativeTools.ts 3376 行、tools/types.ts:27、agentTools.ts:75-127）

按 `docs/development/p0-agent-arch-pr-split.md` 既定拆分执行（该文档是权威计划，此处只补审计新增要求）：

1. 剩余 ~80 个 handler 按域迁出 `nativeTools.ts` → `infra/tools/native/{swarm,session,memory,integration}.ts`（integration 含语雀/飞书/GitHub/邮件），沿用 PR-4a 的 `registerNativeDomain` 模式。迁移后 `nativeTools.ts` 只保留注册兼容层 + 分发逻辑（目标 < 500 行）。
2. **rollback 落地**（saga 前置）：为 D 类工具实现幂等 `rollback`：
   - `write_file`：执行前快照旧内容到内存（run 级 Map，容量上限 10MB 超出则标记不可回滚），rollback = 写回快照；
   - `post.create`/`memory.create`：rollback = 删除该 id（走 Service 保证文件回写）；
   - `git.commit`：rollback 不做（记录 warn「需人工 revert」）——不可逆操作如实声明，不假装能回滚；
   - `directory_delete`/`file_delete`：执行前移到 `.trash` 目录，rollback = 移回。
3. reactLoop 在本 run 记录已执行 D 类工具序列；run 进入 `failed` 且非用户 abort 时逆序调用 rollback，结果写入 Run.output。
4. `CONCURRENCY_CLASS_NATIVE`（agentTools.ts:75-127）并入各域注册时的 `concurrencyClass` 字段，删除双真相。
5. 手写 JSON schema 字面量逐步改 Zod + 复用 `router.ts:899` 的 `zodToJsonSchema` 转换（本工单至少完成迁移出去的四个域，遗留域另立跟进）。

**验收**：PR-4b/4c 文档中的验收清单逐条勾掉；新增 rollback 单测（write_file 失败后内容还原）；`trpc.test.ts` / `nativeTools.test.ts` / `agentTools.test.ts` 不回归。

---

### W7：反思装饰器 withReflection（证据：维度 5 全维度缺失；transports.ts:14,36）

**改动**：
1. 新增 `apps/server/src/infra/loop/reflection.ts`：`withReflection(transport: LlmTransport, opts: { enabled: boolean; maxRounds: number; criticModel: string })` 包装 `complete`——在 loop 即将进入 `done` 前的最后一次 complete 结果上，用 `criticModel`（便宜模型）做一票结构化 critic（prompt 模板放 `content/prompts/` 或 constants，输出 JSON `{ passed: boolean, issues: string[] }`）。
2. 不通过且轮数未满：把 critic 意见作为 user 消息经 `reactLoop.ts:90-116` 的 `injectUserMessages` 机制回注，loop 再走一轮；轮数耗尽则带 `[未经反思通过]` 标记放行（不阻断用户）。
3. `config.yaml` 加 `reflection: { enabled: false, maxRounds: 1, criticModel: "" }`，默认关闭；只有 sync 路径先接入，stream 路径另立跟进（避免改 agentStream 985 行编排）。
4. critic 调用本身走 W2 的弹性客户端；critic 失败 = 跳过反思，绝不影响主链路。

**验收**：`reflection.test.ts`：mock transport 覆盖「critic 通过→原样返回」「不通过→回注重走一轮」「轮数耗尽→标记放行」「critic 抛错→静默跳过」。

---

### W8：常量化收敛（证据：31 处模型名硬编码、工具清单三处、MAX_DEPTH 两处、39 处 slice）

**改动**：
1. `packages/shared/src/constants.ts` 新增/收敛：`DEFAULT_LLM_MODEL`（读 `config.llm.defaultModel`，env `DEFAULT_LLM_MODEL` 可覆盖）、`MEMORY_*`（初始 strength、decay 系数、归档阈值）、`SWARM_MAX_DEPTH`、`SWARM_MAX_QUEUE_SIZE`、`AGENT_TOOL_RESULT_MAX_CHARS = 16000`（统一 `reactLoop.ts:133` 与 `web.ts:378` 同源）、`HEARTBEAT_MAX_CONSECUTIVE_FAILURES`、`APPROVAL_DEFAULT_TTL_MS`。
2. 全仓替换 `"deepseek-v4-flash"` 字面量为常量引用（`agentRuntime.ts:184`、`swarmInitializer.ts:164,173`、`autoCompact.ts:28`、`sessionAutoName.ts`、`workspaceProvision.ts`、`router.ts` 等 14 个文件）。
3. 工具清单三处（`agentRuntime.ts:111-129`、`swarmInitializer.ts:54-73`、`loop/setup.ts:9-16`）收敛为 `packages/shared/constants.ts` 的 `TIER_DEFAULT_TOOLS: Record<Tier, string[]>` 单点定义；`resolveAgent:148-156` 的 needsToolsUpdate 检查改为引用同一常量。
4. `heartbeatEngine.ts:322` 僵尸功能二选一：实现邮件告警（复用现有 send_email 通道）或删除该分支与注释——不留「Phase 5 实现」的尸体。

**验收**：`grep -rn "deepseek-v4-flash" apps/ packages/ | grep -v test | grep -v constants` 结果 ≤ 2 处（constants 定义 + .env.example 说明）。

---

### W9：AgentFactory + resolveAgent 去写副作用（证据：swarmInitializer.ts:27-73、agentRuntime.ts:111-190、loop/setup.ts:9-16；依赖 W8）

**改动**：
1. 新增 `apps/server/src/infra/agentFactory.ts`：`createAgentForTier({ tier, name?, overrides? })`，三 tier 默认模板（systemPrompt/tools/heartbeat）从 `content/agents/_templates/{super,manager,sub}.md` 读取（模板文件本工单创建，内容即现有硬编码常量的搬家），读不到模板时 fallback 到 W8 的常量并 warn。
2. `swarmInitializer.ts` 与 `loop/setup.ts` 改为调用工厂。
3. `agentRuntime.ts:145-177` resolveAgent 的「读路径顺手 update 数据库」逻辑抽出为显式迁移脚本 `apps/server/src/scripts/migrate-assistant-tools.ts`（README 写明一次性执行），resolveAgent 改为只读 + 返回 `{ agent, drift: string[] }` 提示而非静默修改。
4. 配置热更新（如时间充裕）：`config.ts` 加 `reloadAppConfig()` + `config.yaml` fs.watch，进程内换 config 引用；在跑的 run 因 Turn Snapshot 不受影响，新 run 生效。

**验收**：新库首次启动 super/manager/sub 三个 tier 的 Agent 均正确创建；老库重复启动不产生重复 Agent（对照「重复超级 Agent 已清理」的既有约束）。

---

### W10：SwarmOrchestrator 中介者（证据：heartbeatEngine.ts:253-328、nativeTools.ts:1978、asyncJobManager.ts；依赖 W6）

**改动**：
1. 新增 `apps/server/src/infra/swarmOrchestrator.ts`：统一 `dispatch(taskSpec) → swarmPermissionGuard 校验 → 并发池 → 执行 → 结果聚合 → Log 审计` 生命周期。
2. 四个入口改为调用方：`spawnSubagentTool`、`async_task_run`、`heartbeatEngine`（**删掉 :260-264 返回 undefined 的 invokeTrpc 桩**，心跳 Agent 走统一通道拿到工具结果回传）、TriggerEngine。
3. spawn 去重：`(agentId, hash(taskText))` 60 秒短窗口内重复 dispatch 直接返回已有 task。
4. `swarmPermissionGuard.ts:163-169` 的空块检查：要么实现完整校验，要么删除并把职责注释明确指向 `swarmBus.ts:72-75` 的单点实现——不留「标记了但没做」的半吊子。

**验收**：心跳触发路径与 spawn_subagent 路径走同一段执行代码（测试用 spy 验证）；重复 spawn 去重生效；`heartbeatEngine` 相关存量测试不回归。

---

### W11：Run 表活状态 + AWAITING_HUMAN + 审批续跑（证据：agentRuntime.ts:274、agentStream.ts:652-670、phase.ts:19-27、router.ts:825-828；依赖 W1）

**改动**：
1. Run 生命周期：`run.create({ status: "running" })` 在 run 入口落库；每轮 tool_batch 结束后把 `{ phase, roundsUsed, executedToolsCount }` 快照写 `Run.output`（节流：每 5 秒最多一次）；终态 update。
2. 重启恢复：`recoverStaleAsyncJobs` 同款机制把遗留 `running` Run 标 `interrupted`（如实声明不假装能续跑——完整 checkpoint 重建另立设计）。
3. `phase.ts` 增加 `awaiting_human` phase（合法转移：`tool_batch → awaiting_human → llm`）：工具触发审批 pending 时 loop 挂起（复用 sleep 工具的 Task + scheduler 机制），`approval.approveAndExecute` 执行后发 `approval_resolved` 事件 → 向原 session 注入续跑消息唤醒 loop。
4. 审批拒绝/过期：注入「审批被拒绝/已过期」消息让 LLM 自行收尾，run 正常结束而非断裂。

**验收**：新测试覆盖「审批 pending → run 挂起 → approve → 同 session 续跑完成」「reject → LLM 收到拒绝信息并收尾」；`Run.status="running"` 在运行中可查（`/runs` 管理页如实显示）。

---

### W12：MCP 断路器 + 审批清理定时化（证据：mcpClient.ts:188-202,21、approvalGate.ts:103-138）

**改动**：
1. 新增 `apps/server/src/infra/circuitBreaker.ts`：通用 `CircuitBreaker({ failureThreshold: 5, openDurationMs: 60_000 })`，状态机 `closed → open → half-open`（非法转移拒绝，呼应铁律）。接入 `executeMcpTool`：每个 MCP server 一个实例（Map 挂 mcpClient 模块级，带 `__resetForTests`）；open 期间工具调用直接返回「服务熔断中，N 秒后重试」的结构化错误结果（不抛，喂回 LLM）。
2. 审批过期清理：启动时执行一次 + heartbeatEngine 每日 cron 执行（复用 W1 的 `updateMany` 实现）。
3. `heartbeatEngine.ts:35` 连续失败达阈值后暂停该 Agent 心跳（置 `suspended`，邮件告警——接 W8 的告警实现），而非继续每周期撞墙。

**验收**：`circuitBreaker.test.ts` 覆盖三态转移与半开恢复；MCP mock 测试验证 open 期间零真实连接尝试。

---

## 3. 完成定义（Definition of Done）

- [ ] 12 个工单全部完成或有明确的「不做」说明（写入 `docs/development/design-decisions.md`）
- [ ] `pnpm validate`（lint → test → build → e2e）全绿
- [ ] `docs/development/architecture-audit-2026-07.md` 的 10 维度状态更新：❌ 项全部消除或降级为 ⚠️ 并附理由
- [ ] `AGENTS.md`「当前状态与近期变更」更新本次改动摘要
- [ ] 每个工单独立 commit，message 格式：`refactor: [W{n}] 中文描述`
- [ ] 全程零新增：globalThis 状态、动态 import 躲环、裸模型名字符串、编排层时序补丁

## 4. 明确不做的事（范围外，别顺手）

- 不换数据库（SQLite 现状不变）、不引入新运行时依赖（Redis/BullMQ 仍是 `SWARM_MODE=redis` 的 Phase 4 预留）
- 不动 `services.ts` / `router.ts` 的单文件收拢约定（2328/998 行是知情决策）
- 不重写 agentStream.ts 985 行编排（W2/W7 接入时只做点状接入）
- 不引入用户系统/多租户（单用户本地优先定位不变）
