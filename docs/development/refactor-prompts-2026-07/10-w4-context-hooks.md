# 10 W4：context 钩子链（分支 `feat/context-hooks`）

> 用法：连同 `00-执行约定.md` 一起粘贴给实现 agent。**依赖 PR-5（arch/stream-kernel）已合并。**
> 设计来源：pi 的 extensions `context` 事件（参考 `tmp/references/pi`：`packages/coding-agent/docs/extensions.md` 的 Lifecycle 图——每次 LLM 调用前可非破坏性改写消息列表，是「上下文工程总闸」）。

## 目标

KnowPilot 当前每轮发给 LLM 的上下文由 `promptBuilder` 硬编码拼装（记忆注入、tier 身份提示、工具引导、漂移提示等），想加 RAG/新注入源就要改内核。本工单建立 **context 钩子链**：每次 LLM 调用前，按注册顺序跑一组钩子，可注入消息、过滤/改写消息列表——promptBuilder 的既有硬编码注入迁移为内建钩子，后续 RAG/记忆/技能注入都走同一条开放链路。

## 设计契约（已拍板，按此实现）

### 钩子模块

新建叶子模块 `apps/server/src/infra/contextHooks.ts`（只依赖类型，不 import prisma/loop，防循环）：

```ts
export interface ContextHookInput {
  agent: Agent;                       // 当前 agent（只读）
  sessionId: string;
  runId: string;
  round: number;                      // 当前 ReAct 轮次
  messages: LlmMessage[];             // 当前待发送消息列表（副本，可改写）
  systemPrompt: string;               // 当前 system prompt（副本，可改写）
  ctx: NativeToolContext;             // 便于钩子访问 prisma/services（注入而非 import）
}
export interface ContextHookResult {
  messages?: LlmMessage[];            // 改写后的消息列表（过滤/重排/追加）
  systemPrompt?: string;              // 改写后的 system prompt
  prependUserContext?: string;        // 便捷：以 user 角色注入到末尾前的上下文块
}
export interface ContextHook {
  name: string;                       // 唯一名（如 "memory" / "tier-identity" / "tool-guide"）
  order: number;                      // 小先跑；内建钩子的 order 区间 100-999，外部 1000+
  enabled?: (input: ContextHookInput) => boolean;  // 缺省 true
  run: (input: ContextHookInput) => Promise<ContextHookResult | void> | ContextHookResult | void;
}
registerContextHook(hook): void       // 同名覆盖（与 registry 语义一致，dev warn）
runContextHooks(input): Promise<{ messages, systemPrompt }>  // 顺序执行、逐个应用结果；单钩子异常=warn 跳过不阻断
```

### 接入点

- reactLoop 在**每次 transport.complete 之前**（每轮都跑，不是只在 run 开头）调用 runContextHooks，应用其返回的 messages/systemPrompt。sync 链路（agentRuntime）与 stream 链路（agentStream）共用同一接入点（reactLoop 内核统一后只有一处；若现状有两处，一并接入并验证行为一致）。
- 钩子执行要有耗时观测（debug 级日志，单钩子 >500ms warn）。

### 内建钩子迁移（重点：行为等价）

把 promptBuilder 现有注入逐项迁为内建钩子，**迁移后对外行为逐字节等价**（用快照测试证明）：

| 现注入（promptBuilder 内） | 钩子名 | order |
|---|---|---|
| buildMemoryContext 记忆注入 | `memory` | 100 |
| tier 身份提示 buildTierIdentityHint | `tier-identity` | 200 |
| 工具引导 buildAgentToolGuide | `tool-guide` | 300 |
| drift/其他 system prompt 附加段 | `agent-extras` | 400 |

- promptBuilder 迁移后只保留纯字符串构建职能（拼 system prompt 骨架），注入段全部从钩子来；buildSystemPromptWithHints 等既有导出按「禁止兼容包袱」纪律直接改签名/删出口，全仓调用方改完。
- **每轮 vs 每 run**：记忆注入等现状若只在 run 开头拼一次，迁移后变成每轮调用——这是有意的语义变化（pi 模型），但 v1 为控制等价性，钩子 `enabled` 可实现为 `round === 1`（保持现状语义）；把「每轮生效」留给后续具体钩子自行选择。此取舍写进 design-decisions。

### 开放面（v1 最小）

- `registerContextHook` 导出供未来扩展（技能/RAG 插件）使用；v1 不做「技能声明钩子」的配置面，只保证注册表可用 + 文档（模块头注释）写清契约。
- config.yaml 不需要新节（v1 内建钩子全开；若需开关，复用既有 memory.enabled 之类的配置读取，不新造）。

## 测试要求

- `__tests__/contextHooks.test.ts`：
  - 注册/同名覆盖/order 排序/enabled 谓词；
  - run 结果应用（messages 替换/prependUserContext 注入位置正确/systemPrompt 改写）；
  - 单钩子抛错不阻断后续钩子（warn 记录）；
  - **等价性快照**：固定 agent/session 夹具，迁移前后 buildSystemPrompt+messages 拼装结果逐字节相等（迁移前先把旧输出快照存为 fixture）。
  - 每轮调用：round=2 时 round===1 谓词的钩子不再生效。
- 既有 promptBuilder 相关测试迁移到新结构；agentRuntime/agentStream 链路测试不回归。
- 跑：`pnpm --filter @knowpilot/server test`、`pnpm lint` 全绿。

## 验收清单

- [ ] contextHooks.ts 叶子模块 + reactLoop 每轮接入（sync/stream 一致）
- [ ] 4 个内建钩子迁移 + 等价性快照测试
- [ ] promptBuilder 旧注入出口删除、全仓调用方改完（grep 无残留）
- [ ] lint + server test 全绿，合并入 master；AGENTS.md 更新；design-decisions.md 记录「v1 内建钩子 round===1 保持现状语义」

## 红线

- 不做钩子的热重载/外部包安装（pi 的 npm/git 包体系是另一个量级，登记待办）。
- 不改变注入内容的文案本身（纯搬家，逐字节等价）。
- 钩子内禁止直接 import loop/reactLoop（防循环；需要的能力经 input.ctx 注入）。
