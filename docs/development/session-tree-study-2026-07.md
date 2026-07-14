# pi Session 树学习笔记与 KnowPilot 对照（2026-07）

> 来源：微信公众号文章（pi 系列 session 系统设计），对应源码 `session-manager.ts` + `core/compaction/compaction.ts`。
> 目的：评估 pi 的 session 设计哪些值得 KnowPilot 吸收。KnowPilot 现状均已对照源码核实。

## 一、pi 设计要点

### 1. 存储模型：只追加的 entry 树，不是 messages 数组

- session 不存 messages 数组，存一棵**只追加（append-only）的 entry 树**：每个 entry 有 `id` + `parentId`，树关系编码在节点自身上。
- 树结构天然支持「回到历史某一轮重开、且不丢原分支后续」：同一节点可挂多个子节点（分支）。数组做不到——数组每个元素只有一个 next，重开必然截断或覆盖尾部。
- 共 9 种 entry 类型：`message` / `thinking_level_change` / `model_change` / `compaction` / `branch_summary` / `custom` / `custom_message` / `label` / `session_info`，共享 `SessionEntryBase`。模型/思考档位切换、压缩、分支摘要都是树上的普通节点。

### 2. 投影（projection）：发给模型的是视图，不是存储

- 发给模型的 messages 不是存出来的，是 `buildSessionContext(entries, leafId, byId)` 现算的：从当前 `leafId` 沿 `parentId` 一路回溯到 root（unshift 得正序），再转换成模型消息格式。
- **切分支 = 只移动 leafId 指针**。`branch()` 方法只改 leafId；旧分支的 entry 不删，只是不再进入投影。
- 存储（全量树）与视图（当前路径）彻底分离，这是分支能力、压缩能力都建立在上的核心不变量。

### 3. 压缩即节点（compaction as entry）

- 触发：`contextTokens > contextWindow - reserveTokens`（reserve 16k）。token 用 **chars/4** 粗估。
- 切点：`keepRecentTokens`（20k）决定保留多少近处原文；**切点绝不落在 toolResult 上**（保证 tool_call 与 tool result 成对）。
- 摘要是**结构化 checkpoint**，六小节：Goal / Constraints / Progress / Key Decisions / Next Steps / Critical Context + 相关文件列表。
- 二次压缩基于旧摘要迭代更新（`UPDATE_SUMMARIZATION_PROMPT`），不是推倒重来。
- compaction 作为普通 entry **追加**到树上；投影时路径切三段：摘要消息 + `firstKeptEntryId` 起到压缩点前的原文 + 压缩点之后全部。
- **底层只追加不删除，一切变化发生在投影阶段**——压缩不丢信息，旧原文随时可回。

### 4. 持久化：一个 session 一个 .jsonl

- 首行 header，之后每行一个 entry，纯追加写。
- 崩溃只坏最后一行，读回时跳过坏行即可，容错成本极低。
- 第一条 assistant 回复产生前暂缓写盘：不留「有 user 无回复」的半截会话文件。
- 读回只建 `byId` 索引 + leaf 落最后一条；子节点关系用时现算（向上回溯单线 while；向下铺树 `getTree` 两趟扫描），不维护冗余结构。

## 二、KnowPilot 现状对照（已核实源码）

| 维度 | pi | KnowPilot 现状 | 差距 |
|---|---|---|---|
| 存储模型 | entry 树（id + parentId） | ChatSession/ChatMessage **扁平存储**，按 createdAt 线性排列（`chatHistory.test.ts`「扁平存储重建多轮 ReAct 消息链」） | 无树结构 |
| 分支能力 | `branch()` 只动 leafId，旧分支不丢 | 编辑用户消息 → `deleteMany` **截断全部尾部**（agentStream.ts A5）；regenerate 仅 assistant 侧多版本（versionMeta），线性激活其一 | 编辑即丢历史 |
| 压缩落点 | compaction 是追加节点，原文全留 | `ChatSession.contextSummary` **替换式**更新（带 `kp-compact-boundary:v{n}` 代际标记）+ 边界 ChatMessage；原文不删但重建时被 `sliceHistoryAfterCompactBoundary` 整体切出模型视野 | 无「追加节点+投影」，但原文同样不丢 |
| 摘要结构 | 六小节结构化 checkpoint | 自由文本摘要（prompt 要求保留目标/决策/工具要点/未完成任务） | 结构松散，续跑信息密度低 |
| 二次压缩 | 基于旧摘要迭代更新 | **已有**：`[已有摘要]` 拼入 transcript 重新压缩（autoCompact.ts） | 对齐 |
| token 估算 | chars/4 | **已对齐**：`resolveCompactCharThreshold = windowTokens × 0.75 × 4` 字符；`estimateChars` 按字符累计 | 对齐 |
| 近处保留 | keepRecentTokens 20k（按 token 预算） | `keepRecent = 8`（按**条数**） | 8 条超长 tool result 仍可能爆窗口 |
| 压缩切点 | 不切在 toolResult 上 | `rest.slice(0, -keepRecent)` 在 LlmMessage 粒度切，recent 首条可能是孤儿 tool 消息 | 待验证/修复 |
| 持久化 | 单 session 单 .jsonl，坏行跳过 | SQLite（ChatMessage 表）为查询/缓存层 + `content/sessions/*-summary.md`（session_rotate 时） | 架构路线不同 |
| 半截会话 | 首条 assistant 回复前暂缓写盘 | session 创建即落库（`session_start` 需立刻推送供刷新恢复） | 机制冲突，见下 |
| 会话轮换 | —（文章未涉及） | `session_rotate` 已落地：归档旧会话 + 同 Agent 新会话 + 总结写入 md 与新会话首条消息 | KnowPilot 独有 |

## 三、可借鉴清单

### 值得采纳（不依赖分支能力，低成本高收益）

1. **摘要六小节结构化 checkpoint**（Goal/Constraints/Progress/Key Decisions/Next Steps/Critical Context + 文件列表）：替换 autoCompact 的自由文本摘要 prompt，只改一处 prompt，LLM 续跑信息密度显著提升。
2. **keepRecent 按 token/字符预算截断，替代按条数**：现在的 `keepRecent=8` 在 8 条长 tool result 场景下仍超阈值；真实约束是窗口预算，不是条数。
3. **压缩切点不对齐 toolResult 需验证/修复**：`rest.slice(0, -keepRecent)` 可能让 recent 首条是孤儿 tool 消息；pi 的「切点绝不落在 toolResult 上」是明确的正确性规则，应补进 `maybeCompactMessages`。

### 需要分支能力时再采纳（entry 树前置）

4. **entry 树 + leafId 投影**：根治「编辑用户消息 deleteMany 截断尾部」的历史丢失，但要动 ChatMessage（加 parentId）、ChatSession（加 leafMessageId）、重建逻辑与前端分支切换 UI——单用户场景编辑重开频率低，收益暂时抵不上成本。
5. **compaction 追加节点 + 三段式投影**：只在有分支后才必要——多分支共享压缩点前原文时「追加不删」才有独占价值；单线下现在的「替换式 + 边界消息 + slice 重建」已等价且更简单。
6. **branch_summary / label / custom 等扩展 entry 类型**：依附于 entry 树存在，随树一起评估。

### 暂不采纳（与现有架构冲突）

7. **JSONL 单文件持久化**：KnowPilot 走 SQLite（查询/FTS）+ Markdown 双写，「本地 Markdown 是唯一事实源」是项目基石；jsonl 坏行跳过是为文件追加设计的容错，SQLite 事务天然免疫同类问题。
8. **9 种 entry 类型全集**：模型/思考档位切换已存在 session 字段与消息 toolCalls 元数据里，不需要独立 entry 类型；只取 compaction 一种的思想即可。
9. **首条 assistant 回复前暂缓写盘**：与 `session_start` 早推机制冲突——前端刷新/切 tab 后靠真实 sessionId 恢复流式状态，session 必须在发消息瞬间就落库。

---

> 关联：设计决策见 `design-decisions.md` 问题 F（是否引入 entry 树支持会话分支）。
