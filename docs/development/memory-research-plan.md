# 记忆系统学习与改造计划

> 定位：**不克隆、不跑分**。按「KnowPilot 下一阶段最该补的记忆能力」反推——该学谁、学什么、入口在哪、对应哪个模块、能抄回哪一行、难度与阅读体量。
> 体量档 = 阅读/代码量成本：S < 500 行 / M 500–3k / L 3k–15k / XL 15k+。
> 优先级：★ 必看（高 ROI）/ ◆ 选看 / · 知道即可。

---

## 0. KnowPilot 记忆现状（对照基线）

| 层 | 现有实现 | 文件 | 缺口 |
|---|---|---|---|
| 身份/指令 | Agent.systemPrompt + AGENTS.md | `apps/server/src/infra/agentRuntime.ts` `buildSystemPromptWithHints` | 无硬预算；无冻结语义 |
| 长期记忆 | Memory 实体（episodic/semantic/preference）+ keywords | `apps/server/src/services.ts` `MemoryService`；`content/memories/*.md` | 无分层；experience 污染；无晋升 |
| 召回注入 | `buildMemoryContext`：前 80 字 → FTS5 → LIKE 回退 → 注入 system | `apps/server/src/infra/agentRuntime.ts:32` | 无去重；无新鲜度；无 LLM 二次选择 |
| 会话压缩 | `maybeCompactMessages`：超 48k 字符摘要 → `contextSummary` | `apps/server/src/infra/autoCompact.ts` | 压缩前不 flush；无微压缩；无 boundary |
| 工具面 | `memory_create` / `memory_search` / `memory_delete` | `apps/server/src/infra/nativeTools.ts:500` | 无「什么不该记」约束；无自动沉淀 |

---

## 1. Hermes Agent（Nous Research）— ★ 必看

**学什么**：L0–L2 分层 + 冻结快照 + 硬预算 + FTS 会话搜索。

| 项 | 内容 |
|---|---|
| 学什么 | L1 `MEMORY.md`/`USER.md` 硬字符上限（~800+500 token），会话开始冻结注入（保 prefix cache）；L2 `session_search` 用 SQLite FTS5 跨会话按需召回；`memory` 工具 add/replace/remove 三操作 |
| 入口文件 | `agent/memory_provider.py`（MemoryManager ABC）；`agent/memory_tool.py`；`agent/session_search_tool.py`；`agent/context_compressor.py` |
| 对应 KnowPilot | `agentRuntime.ts` `buildMemoryContext` + `buildSystemPromptWithHints`；`autoCompact.ts`；`nativeTools.ts` memory_* 工具 |
| 能抄回哪一行 | `agentRuntime.ts:105` `buildSystemPromptWithHints` → 加「冻结快照 + 硬预算截断」；`services.ts` MemoryService → 加 `USER.md` / `AGENT.md` 双文件 + 字符上限 |
| 难度 | ◆ 中（概念清晰，落地需改注入路径） |
| 阅读体量 | M（~1.5k 行核心） |

**最小可抄**：
1. 双文件 `USER.md` + `AGENT.md`，硬字符上限，会话开始注入一次、会话内冻结。
2. `memory` 工具 add/replace/remove，写盘即生效，但 prompt 下个会话才变。
3. FTS5 跨会话搜索（你已有 FTS 基建，直接复用）。

---

## 2. OpenClaw — ★ 必看（和 KnowPilot 定位最贴）

**学什么**：Markdown 三层（MEMORY.md / 日记 / DREAMS）+ memoryFlush + Dreaming 晋升。

| 项 | 内容 |
|---|---|
| 学什么 | `MEMORY.md`（精炼长期）+ `memory/YYYY-MM-DD.md`（工作日记）+ `DREAMS.md`（晋升审阅）；**compact 前静默 memoryFlush 让 Agent 先写入文件**；Dreaming 后台打分晋升；action-sensitive memory（何时可执行/过期/谁授权） |
| 入口文件 | `docs/concepts/memory.md`；`packages/agent-memory-core/`（memory-core 插件）；`packages/agent-compaction/`（memoryFlush 逻辑） |
| 对应 KnowPilot | `autoCompact.ts` → 加 flush 前置；`content/memories/` → 加日记层；`nativeTools.ts` memory_* → 加 action-sensitive |
| 能抄回哪一行 | `autoCompact.ts:60` `maybeCompactMessages` → 在摘要前插入「静默一轮要求 Agent 写入 Memory」；`content/memories/` 目录结构 → 加 `daily/YYYY-MM-DD.md` |
| 难度 | ◆ 中（flush 需要协调 compact 时机） |
| 阅读体量 | M（文档 + 核心插件 ~2k 行） |

**最小可抄**：
1. **compact 前 memoryFlush**：`maybeCompactMessages` 摘要前，先静默让 Agent 调 `memory_create` 写入关键事实——这正好补你「压缩丢事实」的洞。
2. 日记层 `content/memories/daily/`：只搜不注入。
3. action-sensitive 约束：记忆带「何时可执行 / 何时过期 / 谁授权」，对 Swarm report_back / 审批特别有用。

---

## 3. Claude Code（本地 `claude-code-rev-main`）— ★ 必看（工程最完整）

**学什么**：静态指令≠可写记忆≠会话笔记；microcompact + macro compact 分层；后台 extract 互斥；新鲜度声明。

| 项 | 内容 |
|---|---|
| 学什么 | 6 层记忆（CLAUDE.md / auto-memory / session memory / agent-memory / team memory / compact）；**microcompact 清大工具结果 + macro compact 对话摘要**；回合结束后台 `extractMemories` 与主 Agent 写入互斥；记忆类型四类 +「不记可从代码推导的内容」；`memoryAge` 新鲜度免责 |
| 入口文件 | `src/memdir/memdir.ts`（`buildMemoryPrompt`）；`src/memdir/findRelevantMemories.ts`（LLM 选 ≤5）；`src/services/SessionMemory/sessionMemory.ts`（`shouldExtractMemory`）；`src/services/compact/microCompact.ts`（`microcompactMessages`）；`src/services/compact/compact.ts`（`compactConversation`）；`src/services/extractMemories/extractMemories.ts`（`executeExtractMemories`）；`src/services/autoDream/autoDream.ts` |
| 对应 KnowPilot | `autoCompact.ts` → 加 microcompact；`agentRuntime.ts` → 加 LLM 二次选择 + 去重；`nativeTools.ts` → 加记忆类型约束；新增 extract 后台 |
| 能抄回哪一行 | `autoCompact.ts:30` `estimateChars` → 加 microcompact 先清大 tool result；`agentRuntime.ts:38` `buildMemoryContext` → 加 `alreadySurfaced` 去重 + LLM 选 ≤5 |
| 难度 | ★ 高（多模块协调） |
| 阅读体量 | L（核心 ~8k 行，可选读 microCompact + findRelevantMemories ~2k 行） |

**最小可抄**：
1. **microcompact**：macro 压缩前先清大工具结果（read/bash/grep），延缓触顶——你 `agentStream.ts:353` 已有 `slice(0,16000)` 截断，可升级为按类型/时间清空。
2. **LLM 记忆选择器**：`findRelevantMemories` 用 side LLM 选 ≤5 个相关记忆 + `alreadySurfaced` 去重。
3. **记忆类型约束**：「不记可从代码/git 推导的内容」+ 四类 taxonomy。
4. **新鲜度声明**：>1 天的记忆注入「可能过时，需验证」。
5. **后台 extract 互斥**：主 Agent 已写则跳过后台提取。

---

## 4. Codex（OpenAI）— ◆ 选看（本地仓空，按公开架构）

**学什么**：会话恢复协议 + 沙箱分级 + 审批策略（记忆不是它最炫的一层）。

| 项 | 内容 |
|---|---|
| 学什么 | rollout 会话持久化与 resume；SandboxMode 三级；ApprovalPolicy；记忆与恢复同套事件语义 |
| 入口文件 | 本地 `D:\ALL IN AI\codex` 目前为空；参考 `codex-rs/core/protocol/`、`sandbox/`、`rollout/`（需重新克隆） |
| 对应 KnowPilot | `SessionStreamHub` 检查点 + resume；`shellRunner.ts` 沙箱分级 |
| 能抄回哪一行 | `sessionStreamHub.ts` → 加检查点 ID + 可重放游标；`shellRunner.ts` → 加三级权限档 |
| 难度 | ★ 高（Rust + 协议设计） |
| 阅读体量 | L（如能重新获取源码） |

**最小可抄**：可重放的会话状态机，让记忆写入与 resume 同一套事件语义。**优先级最低**——记忆不是 Codex 强项。

---

## 5. 落地路线（按收益/成本排序）

| 步骤 | 学谁 | 动哪 | 难度 | 收益 |
|---|---|---|---|---|
| **S1** 拆 experience 污染 | Claude Code | `nativeTools.ts` inspect + memory_* 加类型约束 | 低 | 立竿见影（已部分做） |
| **S2** L1 双文件 + 硬预算 + 冻结 | Hermes | `agentRuntime.ts` + `services.ts` + `content/memories/USER.md` | 中 | 核心层稳定 |
| **S3** compact 前 memoryFlush | OpenClaw | `autoCompact.ts` | 中 | 补「压缩丢事实」洞 |
| **S4** microcompact | Claude Code | `autoCompact.ts` + `agentStream.ts` | 中 | 延缓触顶 |
| **S5** 日记层 + FTS 按需召回 | OpenClaw | `content/memories/daily/` + 已有 FTS | 低 | 工作笔记不污染常驻 |
| **S6** LLM 记忆选择器 + 去重 | Claude Code | `agentRuntime.ts` `buildMemoryContext` | 中高 | 召回更准 |
| **S7** Dreaming 晋升 | OpenClaw | 新增后台整理 | 高 | 长期自维护 |
| **S8** 外挂 Mem0/Honcho | Hermes | MemoryProvider 接口 | 高 | 可扩展 |

---

## 6. KnowPilot 推荐分层（自用 + 教学，不上向量库先）

```text
L0  身份/指令     Agent.systemPrompt + Workspace AGENTS.md（冻结）
L1  精炼长期记忆   USER.md + AGENT.md（硬预算，会话开始注入一次，会话内冻结）
L2  工作笔记       content/memories/daily/YYYY-MM-DD.md（只 search，不注入）
L3  会话工作区     ChatMessage + contextSummary（autoCompact）
L4  压缩前 flush   compact 前静默要求写入 L1/L2（学 OpenClaw）
L5  微压缩         macro 压缩前先清大工具结果（学 Claude Code）
禁止              experience 任务 JSON 默认注入 / inspect 默认 dump
```

---

> 最后更新：2026-07-11。本文档为学习计划，不动代码。落地按 S1→S8 顺序，每步可独立验收。
