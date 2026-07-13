# P0 Agent 架构改造 — PR 拆分方案

> 日期：2026-07-12  
> 决策依据：`docs/development/design-decisions.md` §「P0 Agent 架构改造」  
> 铁律：不变量进 reducer / loop 转移；禁止 `setTimeout` / `queueMicrotask` / `phase === xxx` 编排补丁。

---

## 0. 目标与成功标准

| 目标 | 可验证标准 |
|---|---|
| 开闭原则（native 工具） | 新增工具 = 新文件 + 一行 register，不改 `executeNativeTool` 核心 |
| 硬预算 | `AGENT_MAX_TOOL_CALLS_PER_RUN` 在 sync/stream 两路径均强制；超限合成终轮并 stop |
| HITL 闭环 | `AGENT_DESTRUCTIVE_APPROVAL=true` 时 Agent 路径删除类工具走审批；pending 有 TTL |
| 可插拔 loop | `runAgentLoop` / `runAgentLoopStream` 共享同一 Strategy 内核 |
| 地基 | 后端暴露 `AgentRunPhase`；为 Steering / Loop Contract 留投递点 |

**非目标（本系列 PR 不做）**：Reflection 装饰器、向量 MemoryRepository、Redis Swarm 生产化、全工具 saga。

---

## 1. PR 依赖图

```text
PR-1 硬停 maxToolCallsPerRun          ──┐
PR-2 HITL 下沉 + TTL + 环境变量落地    ──┼──► 可并行（无代码冲突则同时开）
PR-3 ToolCommand 接口 + 注册表骨架     ──┘
         │
         ▼
PR-4 native 按域拆分（可拆成 4a/4b/4c）
         │
         ▼
PR-5 AgentRunPhase + ReAct Strategy 收敛
         │
         ├──────────────► PR-6 Pi Steering / Follow-up
         └──────────────► PR-7 LoopX Contract（心跳 Phase 1）
```

建议合并顺序：**1 → 2 → 3 → 4 → 5 → (6 ∥ 7)**。  
1/2/3 若冲突面小可并行开发、串行 merge。

---

## 2. 各 PR 详细说明

### PR-1：`maxToolCallsPerRun` 硬停

**标题建议**：`fix(agent): 强制 AGENT_MAX_TOOL_CALLS_PER_RUN 硬停`

**范围**：

- `apps/server/src/infra/agentRuntime.ts` — `runAgentLoop`
- `apps/server/src/infra/agentStream.ts` — `runAgentLoopStream`
- 测试：`apps/server/src/__tests__/` 新增或扩写（mock LLM 多轮多 tool）

**改动要点**：

```ts
// 伪代码 — 两路径共用计数器
let toolCallsUsed = 0;
const maxCalls = config.llm.maxToolCallsPerRun;

// 每批工具执行前：
const room = maxCalls - toolCallsUsed;
if (room <= 0) break; // 进入合成终轮 / 上限文案
const batch = toolCalls.slice(0, room);
// 执行后 toolCallsUsed += batch.length
// 若被截断：向 messages 注入 system/tool 提示「已达工具调用上限」
```

**验收**：

- [ ] 配置 `AGENT_MAX_TOOL_CALLS_PER_RUN=3`，mock 每轮 2 个 tool → 第二轮截断并停止
- [ ] 仅 `maxToolRounds` 仍生效（两者取更严）
- [ ] `pnpm --filter @knowpilot/server test` 绿

**风险**：低。不改对外 API。

---

### PR-2：HITL 下沉 + `AGENT_DESTRUCTIVE_APPROVAL` + 审批 TTL

**标题建议**：`feat(hitl): Agent 工具路径审批拦截与 pending TTL`

**范围**：

- `apps/server/src/infra/approvalGate.ts`
- `apps/server/src/infra/agentTools.ts` — `executeAgentTool` 入口
- `apps/server/src/infra/config.ts` / `.env.example` — 读入 `AGENT_DESTRUCTIVE_APPROVAL`、`APPROVAL_PENDING_TTL_MS`
- 可选：`heartbeatEngine` / cron 清理过期 pending
- 测试：`trpc.test.ts` 审批用例 + agentTools 单元测

**改动要点**：

```ts
// approvalGate.ts
const DESTRUCTIVE_NATIVE = new Set([
  "post_delete", "memory_delete", "file_delete", /* …与现有 tRPC 列表对齐 */
]);

export function toolRequiresApproval(toolName: string): boolean {
  if (process.env.REQUIRE_APPROVAL === "false") return false;
  if (APPROVAL_REQUIRED_OPS.has(toolName)) return true;
  if (config.agentDestructiveApproval && DESTRUCTIVE_NATIVE.has(toolName)) return true;
  return false;
}

// executeAgentTool 入口
await assertApprovalOrProceed(ctx.services, resolvedName, args, args.approvalId as string | undefined);
```

- `argsMatch`：改为 canonical sort keys 再比，或 `deepEqual`。
- TTL：`approval.list({ status: pending, createdAt < now - ttl })` → `rejected` + reason `timeout`。

**验收**：

- [ ] `AGENT_DESTRUCTIVE_APPROVAL=true` 时，Agent 调 `memory_delete` 创建 pending 并返回可识别错误（非静默成功）
- [ ] tRPC 原有审批路径回归不破
- [ ] 过期 pending 被标记 rejected

**风险**：中。Agent 路径首次强制审批可能改变现有 E2E；mock E2E 需带 approval 或关开关。

**依赖**：无硬依赖 PR-1；建议先于 PR-4 merge，避免拆文件后改审批漏网。

---

### PR-3：`ToolCommand` 接口 + 注册表骨架（不搬迁实现）

**标题建议**：`refactor(tools): 引入 ToolCommand 注册表骨架`

**范围（新建，薄）**：

```text
apps/server/src/infra/tools/
  types.ts          # ToolCommand { name, schema(), execute(), rollback? }
  registry.ts       # registerTool / getTool / listTools
  native/index.ts   # 暂 re-export 旧 TOOL_HANDLERS 注册结果
```

- `nativeTools.ts`：`executeNativeTool` 改为 `registry.get(name).execute(...)`；handlers 仍留原文件。
- `agentTools.ts`：只改 import 路径（若需要）。

**伪代码**：

```ts
export interface ToolCommand {
  name: string;
  kind: "native" | "skill" | "mcp";
  concurrencyClass?: "A" | "B" | "C" | "D";
  schema(): { description: string; parameters: Record<string, unknown> };
  execute(params: Record<string, unknown>, ctx: NativeToolContext): Promise<unknown>;
  rollback?(params: Record<string, unknown>, result: unknown, ctx: NativeToolContext): Promise<void>;
}

const registry = new Map<string, ToolCommand>();
export function registerTool(cmd: ToolCommand) { registry.set(cmd.name, cmd); }
```

**验收**：

- [x] 行为与拆前完全一致（现有 nativeTools / agentTools / trpc 测试全绿）
- [x] 无新公开 API 破坏
- [x] `infra/tools/{types,registry,index}.ts` 落地；`nativeTools` 模块加载时 `ensureNativeToolsRegistered()`
- [x] `executeNativeTool` / `listNativeTools` / `buildNativeToolSchemas` 走 registry
- [x] 单测 `toolRegistry.test.ts`

**风险**：低（纯搬接口）。为 PR-4 铺路。

**状态（2026-07-13）**：✅ 已落地（handlers 仍在 `nativeTools.ts`；按域拆分见 PR-4）。

---

### PR-4：native 按域拆分

**标题建议**：`refactor(tools): nativeTools 按域拆分`

可再拆子 PR（建议 4a→4c 串行，降低冲突）：

| 子 PR | 域文件 | 工具示例 |
|---|---|---|
| **4a** | `native/fs.ts`, `native/web.ts`, `native/shell.ts` | read/write_file、web_search、run_shell、async_task_* |
| **4b** | `native/swarm.ts`, `native/session.ts`, `native/memory.ts` | agent_*、spawn_*、session_*、memory_* |
| **4c** | `native/github.ts`, `native/feishu.ts`, `native/yuque.ts`, … | 第三方集成 |

每个域文件末尾：

```ts
registerTool({ name: "read_file", kind: "native", schema: () => (...), execute: readFileTool });
```

`nativeTools.ts` 最终瘦身为：re-export + `import "./tools/native/index.js"` 副作用注册。

**验收**：

- [x] PR-4a：`infra/tools/native/{fs,web,shell}.ts` 落地；`nativeTools.ts` 兼容 re-export
- [ ] `nativeTools.ts` < 300 行（或删除，仅留兼容 export）— 4b/4c 继续
- [ ] 新增工具文档：`docs/development/` 补一节「如何加 native 工具」
- [x] 相关 server test 绿（nativeTools / toolRegistry）

**风险**：高（大 diff）。必须子 PR 拆开；每子 PR 只搬迁、不改行为。

**纪律**：禁止借拆分之机改工具语义。

**状态（2026-07-13）**：✅ PR-4a 已落地（fs/web/shell）；⬜ 4b swarm/session/memory、4c 第三方集成。

---

### PR-5：`AgentRunPhase` + ReAct Strategy 收敛

**标题建议**：`refactor(agent): 统一 AgentLoopStrategy 与 RunPhase`

**范围**：

- 新建 `apps/server/src/infra/loop/types.ts`、`loop/reactStrategy.ts`
- `agentRuntime.ts` / `agentStream.ts` 变为 facade（SSE emit 适配）
- phase 枚举（最小集）：

```ts
type AgentRunPhase =
  | "idle"
  | "llm"
  | "tool_batch"
  | "awaiting_approval" // PR-2 已能触发；本 PR 打点
  | "compacting"
  | "done"
  | "failed";
```

- SSE 事件可选带 `phase`（向后兼容：无则前端忽略）。
- **Turn Snapshot**：run 开始时冻结 agent 配置（为 PR-6 做准备）。

**验收**：

- [ ] sync / stream 行为对齐（同一 mock 脚本）
- [ ] 非法 phase 转移开发期 `console.error`，生产静默 no-op
- [ ] chat mock E2E 绿

**风险**：中高。必须对照 `chat-state-architecture.md`，后端 phase ≠ 前端 StreamPhase，但语义可映射文档化。

---

### PR-6：Pi Steering / Follow-up

**标题建议**：`feat(agent): Steering / Follow-up 双队列投递`

**前置**：PR-5 merged；`design-decisions` 问题 A/B 无反对。

**范围**：

- 后端 loop：`AFTER_TOOL_BATCH` / `BEFORE_STOP` 投递点
- `config.yaml`：`stream.steeringMode` / `followUpMode`
- 前端：`useSessionComposeState` 区分 `steer` vs `follow_up`（或扩展 `ChatQueueItem.kind`）
- Compose drain 钩子仍只认 `onStreamCommitted`（follow-up 在 run 内消化则不必等 commit）

**不变量（必须写进 reducer/loop，不是注释）**：

1. steer 只在 `tool_batch → llm` 之间注入。
2. follow-up 只在将 `done` 前、且 steer 空时注入。
3. abort 清空两队列；已落库消息不删。

**验收**：

- [ ] mock：streaming 中 steer → 下一轮 LLM messages 含该 user 消息
- [ ] follow-up 在无 tool 时触发续轮，最终一次 `done`/`commitStream`
- [ ] 无新增 `setTimeout` 编排

**风险**：高（状态机）。单独 PR，禁止与工具拆分混提。

---

### PR-7：LoopX Contract（心跳 Phase 1）

**标题建议**：`feat(swarm): 心跳 LoopContract（goal/gate/evidence/stop）`

**前置**：PR-1（quota 硬停）建议先合；PR-5 可选。

**范围**：

- Prisma：`LoopContract` 表或挂在现有 Workspace/Agent JSON 字段（优先 JSON 列降低迁移成本，字段契约稳定后再升表）
- `heartbeatEngine`：每轮写 evidence；无进展触发 stopRule；gate 打开时跳过触发
- 管理页只读视图（可极简：`/dashboard` 或 Agent 详情一节）

**验收**：

- [x] 连续 N 轮无新 evidence → 心跳停止并打日志（`handoff=false` + `stoppedReason`）
- [x] 人工关 gate 后可 `resumeLoopContract` 恢复
- [x] 不改变普通用户 Chat 路径（仅 `tier===super` 心跳）
- [x] 单测 `loopContract.test.ts`；配置 `config.yaml` → `heartbeat.loopContract`

**风险**：中。首期范围锁死「仅超级 Agent 心跳」。

**状态（2026-07-13）**：✅ Phase 1 已落地（JSON 挂在 `Agent.heartbeat.loopContract`；管理页只读 UI 可后续补）。

---

## 3. 分支与 PR 卫生

| 项 | 约定 |
|---|---|
| 分支前缀 | `refactor/p0-tools-*` / `feat/p0-hitl-*` / `feat/p0-steering` / `feat/p0-loop-contract` |
| 每 PR | 单一主题；测试绿；中文 commit：`feat:` / `fix:` / `refactor:` |
| 禁止 | 同 PR 既拆文件又改语义；既加 steering 又改 HITL |
| 文档 | 行为变更同步 `AGENTS.md` 相关段落 + 本拆分文档勾选状态 |

---

## 4. 工作量粗估（单人熟悉代码库）

| PR | 估时 |
|---|---|
| PR-1 | 0.5–1 天 |
| PR-2 | 1–2 天 |
| PR-3 | 0.5–1 天 |
| PR-4a/b/c | 各 1–2 天（共 3–5 天） |
| PR-5 | 2–3 天 |
| PR-6 | 2–4 天 |
| PR-7 | 2–3 天 |

---

## 5. 进度勾选

- [x] PR-1 硬停
- [x] PR-2 HITL
- [x] PR-3 注册表骨架
- [x] PR-4a fs/web/shell 域拆分
- [ ] PR-4b / 4c 域拆分
- [x] PR-5 RunPhase + Strategy
- [x] PR-6 Steering / Follow-up
- [x] PR-7 Loop Contract

> 2026-07-12：分支 `fix/p0-agent-budget-hitl` 已落地 PR-1 + PR-2（含单测 `agentBudgetApproval.test.ts`）。  
> 2026-07-13：同一分支落地 PR-5 — `infra/loop/` 统一 ReAct 内核 + `AgentRunPhase`；`runAgentLoop` / `runAgentLoopStream` 变为 transport facade。  
> 2026-07-13：PR-6 Steering/Follow-up — RunState 内存队列 + reactLoop 投递点 + `agent.submitInject` + 前端 streaming 默认 steer。  
> 2026-07-13：PR-3 ToolCommand 注册表 + PR-7 心跳 LoopContract Phase 1（`infra/loopContract.ts` + 超级 Agent 门禁）。  
> 2026-07-13：PR-4a — `infra/tools/native/{fs,web,shell}.ts`；`nativeTools.ts` 瘦身为其余域 + 兼容出口。

落地后把「已确认」表从 `design-decisions.md` 迁入本节，并更新 `AGENTS.md`「当前状态」一行。
