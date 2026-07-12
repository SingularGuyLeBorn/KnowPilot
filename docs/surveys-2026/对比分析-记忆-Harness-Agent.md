****

# 2026 三篇综述 × KnowPilot 深度对比分析

> 写作日期：2026-07-12（v2 扩写版）
> 目的：以三篇 2026 年综述列出的**每个模块**为骨架，逐模块梳理：**业内实践 → 最佳实践案例 → 我的设计（KnowPilot）→ 我的改进 → 我的实现 → 差异对比**。
> 「我」= KnowPilot 项目（`D:\ALL IN AI\KnowPilot`）：单用户、本地优先的知识管理 + Agent 平台，Markdown 为唯一事实源，SQLite 仅作查询/缓存层。

## 本目录文件清单


| 文件                                     | 说明                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memory-survey-2026-arxiv2603.07670.pdf` | 综述①：《Memory for Autonomous LLM Agents: Mechanisms, Evaluation, and Emerging Frontiers》，Pengfei Du（香港理工大学 HKRIT），arXiv:2603.07670，2026-03-08。覆盖 2022–2026 初的记忆工作，提出 write–manage–read 形式化 + 三维分类法 + 五大机制族深评 + 四大新基准分析                                                                                        |
| `harness-survey-2026-meng-et-al.pdf`     | 综述②：《Agent Harness for Large Language Model Agents: A Survey》，Meng Qianyu / Wang Yanan / Chen Liyi 等 11 人（大连理工 × 小红书等），Preprints DOI 10.20944/preprints202604.0428，2026-04。本地 PDF 为配套仓库 github.com/Gloriaameng/Awesome-Agent-Harness 的 v4 最新版。形式化 H=(E,T,C,S,L,V)，综述 110+ 论文 × 23 系统，识别 9 大挑战 + 12 个研究方向 |
| `agent-survey-2026-chowa-springer.pdf`   | 综述③：《From language to action: a review of large language models as autonomous agents and tool users》，Chowa 等，Springer*Artificial Intelligence Review*（2026-01-06 见刊，DOI 10.1007/s10462-025-11471-9，已被引 55 次）。系统综述：基座模型 / 工具集成 / 框架 / 推理规划记忆 / prompting-微调-记忆增强 / 评估基准                                         |
| `对比分析-记忆-Harness-Agent.md`         | 本分析文档                                                                                                                                                                                                                                                                                                                                                        |

## 阅读指南

- 每个模块小节固定六段式：**业内实践**（该模块的机制原理、主要变体、已知风险）→ **最佳实践案例**（2–5 个，带具体做法与数据）→ **我的设计**（KnowPilot 的机制级描述）→ **我的改进**（相对业界通用做法我做了哪些不同的、更好的事）→ **我的实现**（文件 + 函数 + 行号 + 关键参数）→ **差异对比**（分维度）。
- 「差距」分三类：**能力差距**（业界有我没有）、**理念取舍**（有意不做）、**实现空隙**（设计有但代码没落地，应修）。
- Part 4 有一页纸速查表与按性价比排序的修复清单。

## 三篇综述的核心论点速览

**综述①（记忆）**：记忆 = 把无状态文本生成器变成自适应 Agent 的关键；形式化为嵌入 POMDP 循环的 write–manage–read 环路；五个互相拉扯的设计目标（Utility / Efficiency / Adaptivity / Faithfulness / Governance）；生产系统是三种架构模式的光谱（A 单体上下文 → B 上下文+检索存储 → C 分层+学习型控制），建议「从 B 起步、充分插桩、数据证明后再升 C」。

**综述②（Harness）**：**「决定 Agent 规模化可靠性的不是模型，是执行 harness」**。关键实证：①仅改 harness 的编辑工具格式，Grok Code Fast 1 在 SWE-bench 从 **6.7% → 68.3%**（模型不变）；②Stripe Minions 每周 **1300 个 PR** 零人写代码；③METR：benchmark 通过的 PR 人类合并率低 **24.2pp** 且每年扩大 9.6pp（评估效度危机）；④SandboxEscapeBench：前沿模型 **15–35%** 容器逃逸率，PRISM 10 钩子零 fork 防御压到近零且开销 <5ms。生产级系统收敛于**六组件全实现**，研究原型通常只实现 2–3 个。

**综述③（Agent 总览）**：经典四模块架构（Profile/Memory/Planning/Action）仍是分析主线；GPT-4 系列是 55 篇研究的基座基准；TOOLLLM 的搜索式推理比 ReAct 平均 pass rate 高约 **81%**——「瓶颈不在算法复杂度，而在模型的长程连贯规划能力」；未来三方向：可验证推理与自我改进、规模化自适应协作、人机共生（个性化/主动性/信任）。

---

# Part 1 · 记忆系统（对照综述①）

## 1.0 综述①的模块地图


| 层次     | 模块                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------ |
| 形式化   | write–manage–read 环路（§2.1）、POMDP 连接（§2.2）、五设计目标（§2.3）                                |
| 分类法   | 三维：时间跨度 / 表示载体 / 控制策略（§3）                                                                |
| 机制族   | ①上下文驻留与压缩 ②检索增强存储 ③反思式自我改进 ④分层与虚拟上下文 ⑤策略学习型管理 ⑥参数化记忆（§4） |
| 评估     | 从召回率到 agentic 效用：LoCoMo / MemBench / MemoryAgentBench / MemoryArena（§5）                         |
| 应用     | 个人助理 / 软件工程 / 开放世界游戏 / 科学推理 / 多 Agent / 工具编排 / 跨域迁移（§6）                      |
| 工程现实 | 写路径 / 读路径 / 过期与矛盾 / 延迟成本 / 隐私删除 / 三种架构模式 / 可观测性（§7）                        |
| 开放挑战 | 原则性整合、因果 grounded 检索、可信反思、学会遗忘、多模态具身记忆、多 Agent 记忆治理等 10 项（§9）       |

以下逐模块展开。

## 1.1 形式化：write–manage–read 环路

**业内实践**：综述把 Agent 记忆形式化为嵌入 POMDP 感知-行动循环的三段环路——**write**（决定记什么、什么粒度、带什么元数据）、**manage**（整合、去重、更新、遗忘、分层迁移）、**read**（何时取、取什么、取多少、怎么拼进上下文）。核心论断：记忆不是附加组件，而是与感知、动作紧耦合的闭环；三环中任何一环薄弱都会让另外两环失效（存了取不出 = 没存；取出的是垃圾 = 不如不取）。

**最佳实践案例**：

- **MemGPT/Letta（NeurIPS 2023）**：操作系统式分页，把 write/manage/read 全部暴露为 LLM 可调用函数（`core_memory_append`、`archival_memory_search`），LLM 自己决定何时写、何时换页；中断机制让 Agent 在回复前可执行多次内部记忆操作。
- **Mem0（2025，生产部署最广的开源记忆层）**：写入即做四元判定 **ADD / UPDATE / DELETE / NOOP**，用 LLM 比对新旧事实做冲突消解；可选图记忆层抽取实体关系。
- **A-MEM（Agentic Memory, NeurIPS 2025）**：每条记忆写入时自动生成关键词、标签、上下文描述，并与已有记忆建立动态链接；新记忆可触发旧记忆的「进化」（改写上下文描述），实现 Zettelkasten 式自组织。
- **Generative Agents（UIST 2023）**：read 侧经典——检索打分 = recency（指数衰减）× relevance（embedding 相似度）× importance（LLM 自评 1–10），多信号加权至今仍是启发式 read 的基线。

**我的设计（KnowPilot）**：

- **write 三条路径**：① Agent 工具 `memory_create`——description 内置规则「不要记可从代码/git/文档直接查到的内容」+ 类型 enum 约束（preference/semantic/episodic/note/procedural）；② 压缩前 **flush**——`flushMemoriesBeforeCompact` 用 side LLM（temperature 0.1）从即将被压缩的 transcript 提取 ≤5 条长期事实（JSON 数组），带同样的「不记可推导信息」规则 + 与已有摘要去重 + **内容前 40 字查重**；③ **经验积累**——每次 Run 结束后 fire-and-forget 调 `accumulateExperience`，把任务摘要/工具列表/成功标志/耗时/token 用量序列化写入 `type="experience"` 的记忆（成功 strength=1.0，失败 0.5）。
- **manage**：`strength`（0–1 静态打分）+ flush 时去重；Markdown 为唯一事实源（CRUD 双向写回 `content/memories/{id}.md`），SQLite 仅作查询/FTS 层，`sourceSlug` 幂等 + `sourceMtime` 增量同步；cleanup 只删「有 sourceSlug 且文件已消失」的记录，**保护运行时写入的记忆不被误删**。
- **read**：每条用户消息取**前 80 字**做关键词 → 优先 FTS5（BM25）召回 → 无命中回退 LIKE 扫 content/keywords → `isMemoryInjectable` 白名单过滤（`experience` 类被排除，修复过「任务 JSON 污染上下文」的真实 bug）→ 取前 5 条、每条截 300 字，拼成 `## 相关长期记忆` 段注入 system prompt。

**我的改进**（相对业界通用做法）：

1. **write 路径内置「可推导信息不记」规则**——综述 §7.1 把「过滤低信号记录」列为写路径第一要素，多数开源项目（包括 Mem0 默认配置）是「全存再说」，我在工具 description 和 flush prompt 两处都强制了这条规则。
2. **flush 与压缩联动**——压缩（丢上下文）之前先把值得长期保留的事实抢救进记忆库，这是 OpenClaw 日记层思路的本地化实现，多数项目压缩就是纯丢弃。
3. **注入白名单按类型隔离**——系统运行经验（含 JSON 噪音）永不进入用户对话上下文，这是踩过真实 bug 后收敛出的防线。

**我的实现**：

- `apps/server/src/infra/agentRuntime.ts` `buildMemoryContext`（L33，read 路径）
- `apps/server/src/infra/memoryFlush.ts`（flush 全链路）
- `apps/server/src/infra/agentEvolution.ts`（`accumulateExperience` / `optimizeAgentPrompt`）
- `apps/server/src/infra/nativeTools.ts` L511–552（`memory_create/search/delete`）
- `apps/server/src/services.ts` `MemoryService`（L1227，CRUD + 写回 md + FTS 钩子）
- `apps/server/src/scripts/sync/sync-memories.ts`（sourceSlug 幂等同步）
- `packages/shared/src/constants.ts` L71（六类 taxonomy + `MEMORY_USER_CREATABLE_TYPES` + `isMemoryInjectable`）

**差异对比**：

1. **manage 环最弱**：业界 manage 的核心是更新/冲突消解（Mem0 四元操作、A-MEM 记忆进化、Zep 时序失效），我**只有 create/search/delete 三操作，缺 `memory_update`**——同一事实新旧两版会共存，只能靠 flush 的 40 字前缀查重兜底。这是能力差距，P0 可修。
2. **read 是「每消息关键词检索」**：取向量/重排/LLM 门控（Self-RAG 的 retrieve-or-not 判断）都没有；Generative Agents 式的多信号打分我只实现了 relevance（BM25）一维，recency 和 importance（strength）**存了但没参与排序**。
3. **write 的元数据 tagging 不足**：综述 §7.1 要求 timestamp/source/task label/confidence 四元组，我有 timestamp 和 strength（≈confidence），缺 source（用户说的 vs Agent 推断的）与 task label——而 source attribution 正是 §7.3 矛盾处理的前提。

## 1.2 五个设计目标及其张力

**业内实践**：五目标互相拉扯，没有全局最优——**Utility**（记忆是否真提升任务结果）诱惑你全存，**Efficiency**（每单位效用的 token/延迟/存储成本）要求少存，**Adaptivity**（增量更新不重训）与 **Faithfulness**（召回准确且新鲜——过期或幻觉召回比不召回更糟）冲突于压缩，**Governance**（隐私、删除请求、组织合规）与全存直接对立。综述的处方：按应用场景选平衡点——医疗分诊 Agent（漏记过敏史可能致命）与菜谱推荐器的 faithfulness–efficiency 前沿完全不同；写路径过滤阈值应由「记忆失效模式 → 下游后果」的风险分析决定。

**最佳实践案例**：

- **Claude Code**：micro-compact（就地截断超长工具结果，保留头尾关键信息）+ macro-compact（整窗摘要）两段式，是 Efficiency/Utility 平衡的工业标杆。
- **OpenClaw**：压缩前先把值得长期保留的事实 flush 进日记层再丢上下文——Faithfulness 优先于 Efficiency。
- **Zep**：时序知识图谱显式建模事实的 valid_at/invalid_at，把 Faithfulness（新鲜度）机制化而非靠 LLM 自觉。
- **Codex CLI**：resume 协议把压缩摘要作为一等公民跨会话传递，解决 Adaptivity（换会话不丢上下文）。

**我的设计**：五目标均有落点——

- **Efficiency**：三段式压缩。micro（>4000 字符的工具结果截断并标注「学 Claude Code」）→ flush（见 1.1）→ macro（阈值 = `triggerRatio 0.75 × 模型 context window`，**按模型窗口动态算，不是固定 48k 字符**——换小窗口模型自动提前压缩）。
- **Faithfulness**：①摘要持久化到 `ChatSession.contextSummary` 并带 generation 边界标记 `[kp-compact-boundary:vN@ts]`；②**下轮优先复用已有摘要，不再调 LLM 重摘要**——直接消灭综述 §4.1 点名的「summarization drift」（每轮重摘要导致低频关键事实逐轮流失，比如「永远不要直连生产库」这种第一天说的指令活不过第三次压缩）；③二次压缩时旧摘要受边界标记保护不被覆盖。
- **Adaptivity**：摘要失败自动降级 `trimOldest`（保 system + 最近 keepRecent=8 条）——任何情况下 run 不崩；`session_rotate` 归档旧会话 + 同 Agent 新会话 + 总结首条消息，对齐 Codex resume。
- **Utility**：记忆注入与压缩都是为了让长任务不丢关键上下文；但**没有量化验证**（见 1.10）。
- **Governance**：本地优先（SQLite + Markdown，数据不出本机）；`.env`/dev.db 不入 git；Credential 表 AES-GCM 加密（`credentialVault.ts`）。缺记忆级删除传播审计（见 1.11）。

**我的改进**：「**摘要只生成一次 + generation 边界 + 复用**」三件套是我对抗摘要漂移的核心机制——业界多数实现（包括一些 LangChain 生态的记忆组件）每轮或每 N 轮重摘要，正是综述警告的漂移温床。

**我的实现**：`apps/server/src/infra/autoCompact.ts`、`config.yaml` 的 `compact:` 段、`prisma/schema.prisma` 的 `ChatSession.contextSummary/contextCompactedAt`、`nativeTools.ts` 的 `session_rotate`。

**差异对比**：三段式 + 复用 + 降级链的组合**达到甚至局部超过 Claude Code 公开描述的实践**（多了 flush 抢救与摘要复用）；差距在：①压缩粒度——Claude Code 对工具结果按类型精细截断（保留 diff 头尾、错误堆栈），我是统一 4000 字符硬切；②无 Zep 式显式新鲜度建模（strength 不随时间衰减，MemoryBank 的艾宾浩斯曲线未引入）。

## 1.3 三维分类法：时间跨度 / 表示载体 / 控制策略

**业内实践**：综述用三个正交维度统一所有记忆设计——

- **时间跨度**：工作记忆（当前任务，秒~分钟）/ 情节记忆（具体交互事件）/ 语义记忆（提炼后的事实与偏好），对应认知心理学的 Tulving 分类。
- **表示载体**：上下文内文本 / 外部文本文件 / 向量 embedding / 结构化 DB（ChatDB 用 SQL 做符号记忆，支持精确 INSERT/SELECT）/ 知识图谱（MAGMA 2026 用语义/情节/时间/因果四图联合检索）/ 模型参数。
- **控制策略**：规则启发式（固定 top-k、阈值）→ LLM 提示控制（Self-Controlled Memory 让 Agent 自选哪些段落原文保留、哪些激进压缩）→ 学习式控制（RL 优化记忆动作）。

**最佳实践案例**：

- **MemoryOS（EMNLP 2025）**：OS 式三级存储（短期→中期→长期）+ 热度更新 + 分段分页，时间维度做得最完整。
- **MAGMA（arXiv 2601.03236, 2026）**：多图记忆，检索时跨四张子图联合推理，表示载体维度的前沿。
- **ChatDB（2023）**：SQL 作为符号记忆，证明结构化 DB 载体在精确查询场景的不可替代性。
- **RETRO（2022）**：从 2 万亿 token 语料检索，7.5B 模型在 10/16 基准上打平 175B Jurassic-1——检索载体规模化的经典证据。

**我的设计**：

- **时间维度**：用类型 taxonomy 近似——`preference`（≈语义-偏好）/ `semantic`（语义）/ `episodic`（情节）/ `note`（工作-便签）/ `procedural`（程序性）/ `experience`（系统运行经验）。比多数项目的「preference/fact/event 三类」更细。
- **表示载体**：**纯文本一维**——Markdown 文件（事实源）+ SQLite 行（查询层）+ FTS5 倒排索引（检索层）。无向量、无图、无 SQL 符号查询、无参数化。
- **控制策略**：**规则启发式**——固定 pipeline（关键词 → FTS → top 5 → 300 字截断），无 LLM 自选、无学习式。

**差异对比**：分类法三个维度上，我的位置是（细粒度类型 taxonomy / 最朴素载体 / 最朴素控制）。类型维度我反而比通用做法细；载体维度缺向量意味着**语义相近但关键词不同的记忆召不回**（用户说「我过敏」，之后问「饮食禁忌」可能 miss）；控制维度缺 LLM 门控意味着**每条消息都付一次检索成本**（Self-RAG 式 gating 可省掉 70%+ 的无谓检索）。这两个缺口正是 `docs/development/memory-research-plan.md` 自评的 S6/S3。

## 1.4 机制族一：上下文驻留记忆与压缩

**业内实践**：最朴素的记忆就是全塞 prompt——system 消息、近期对话、scratchpad，窗内召回完美。历史超长后的四条压缩路线：(i) **滑动窗口**（只留最近 n 轮）；(ii) **滚动摘要**（周期性把旧历史压成摘要）；(iii) **分层摘要**（turn/session/topic 三种粒度分别摘要）；(iv) **任务条件压缩**（当前 query 决定哪些历史保全文、哪些压缩）。核心病理是 **summarization drift**：每次压缩都静默丢弃低频细节，压缩三轮后 Agent「记住」的是历史的 sanitized 泛化版——综述给出具体反例：每天 50 次交互的 Agent 一周后 350 轮历史经过 ≥3 次摘要，第一天「永远不要直连生产库」这类低频高重要指令恰好在第三次压缩消失，然后 Agent 直连了生产库。100k+ 长窗口只是推迟问题，且 attention 成本二次增长。

**最佳实践案例**：

- **Claude Code**：micro-compact（就地截断工具结果，保留头尾）+ macro-compact（整窗摘要）+ 压缩前提示用户，工业界引用最多的压缩设计。
- **Codex CLI**：resume 协议——摘要作为一等公民跨会话传递，换会话不换记忆。
- **OpenClaw**：后台 extract 与前台对话互斥（避免并发污染正在压缩的 transcript）。
- **Self-Controlled Memory（2023）**：把「哪些段落原文保留、哪些激进压缩」的决定权交给 Agent 自己——任务条件压缩的极端形态。

**我的设计**：= §1.2 的三段式（micro → flush → macro）+ 摘要复用 + generation 边界 + trimOldest 降级。此外 `agentStream.ts` 的流式循环入口先做 `maybeCompactMessages`，压缩与 ReAct 循环解耦——**任何一轮 LLM 调用前都保证上下文在预算内**，而不是等爆了再救。

**我的改进**：①「压缩前先 flush 抢救事实」把压缩从纯丢弃变为「丢上下文但不丢记忆」；②「摘要复用」消灭重复压缩的漂移与 token 浪费；③按模型窗口百分比触发，换模型不用改配置。

**差异对比**：机制完整度对齐业界一线。差距：①截断策略一刀切（4000 字符），不如 Claude Code 按内容类型（diff/堆栈/日志）的精细截断；②没有 Self-Controlled 式的 Agent 自选保留——压缩什么完全由规则决定；③micro 只处理工具结果，不处理超长的 assistant 思考块（thinking 很长时仍会挤占预算）。

## 1.5 机制族二：检索增强记忆存储

**业内实践**：RAG 思想搬到 Agent 场景，存储的是**活的交互记录**（工具调用日志、环境观测、用户纠正、部分计划、口头反思）而非百科文章。三个关键子问题：

- **索引粒度**：细粒度（单条工具调用/单句）召回精确但把多步推理切成无意义碎片；粗粒度（整会话）保上下文但信号被噪音淹没。实践甜点是**多粒度索引**，检索器自适应选分辨率。
- **查询构造**：Agent 的即时输入往往是差查询（用户问「为啥崩了」需要的是两个会话前的崩溃日志，不是语义最像的句子）。对策：LLM 重写查询、多查询 fan-out + 结果融合、用当前子目标作额外检索信号；**Self-RAG** 更进一步，训练模型判断「这一步要不要检索」，简单门控省掉大量无谓延迟。
- **规模**：RETRO 与万亿 token 数据store 证明检索记忆可扩展到数年的交互历史——瓶颈从存储转向**相关性保证**。

**最佳实践案例**：

- **Mem0**：向量 + 可选图双层，写入即冲突消解，生产部署最广；论文报告在 LoCoMo 上比全上下文基线更高的准确率与大幅降低的 token 成本。
- **Zep**：时序知识图谱，事实带时间边，支持「截至某时点用户住哪」这类时序查询。
- **MemoryBank（AAAI 2024）**：艾宾浩斯遗忘曲线更新记忆强度，检索时强度参与排序——recency 机制化。
- **Generative Agents**：recency × relevance × importance 三因子加权，启发式排序的基线公式。

**我的设计**：**FTS5 全文检索（BM25 排序）+ LIKE 回退**，无向量、无图、无重排、无门控。工程上有三个正确选择：① Memory 的 CRUD 经 afterCreate/Update/Delete 钩子**自动维护 FTS 索引**（索引一致性不靠人肉）；② 检索前过 `isMemoryInjectable` 白名单，系统噪音不进上下文；③ 每条记忆截 300 字注入，控制预算。strength 字段存在（0–1）但**不参与检索排序**——MemoryBank 式的强度加权我有数据没接线。

**我的改进**：相对「先上向量库再说」的主流，我选择 FTS5 是**零依赖、可解释、可 grep 调试**的本地优先方案——BM25 在关键词明确的查询上不输向量，且不存在 embedding 模型升级导致全库重建的问题（综述 §7.7 点名的回归测试痛点）。

**差异对比**：这是检索质量上限的硬伤区——①缺语义召回（向量/embedding）；②缺查询构造（前 80 字原样当查询，正是综述批评的「即时输入是差查询」）；③缺门控（每条消息都检索，无 Self-RAG 式「要不要取」判断）；④strength/recency 不参与排序（MemoryBank/Generative Agents 的基本操作）。四项中 ③④ 是零依赖可立即补的，①② 需要引入 embedding 或 LLM 调用。

## 1.6 机制族三：反思式自我改进记忆

**业内实践**：Agent 从成败轨迹中提炼「经验教训」存回记忆，后续任务读取后改进行为——这是**程序性/元认知记忆**，区别于事实记忆。中心风险是**自我强化错误**（self-reinforcing error）：Agent 错误地总结「API X 带参数 Y 必报错」，就会永远避开该调用路径，再收集不到推翻错误信念的证据；姊妹风险是**过度泛化**（一个上下文学到的教训盲目用于另一个）。缓解靠质量门：置信度分数、与其他记忆的矛盾检查、定期过期——但综述承认这些机制「必要但仍不发达」，且 Agent 越长寿问题越尖锐。

**最佳实践案例**：

- **Reflexion（NeurIPS 2023）**：失败后写自然语言验尸报告，下次尝试前置到 prompt——**HumanEval 91% pass@1 vs GPT-4 基线 80%**，无梯度更新、无奖励模型，一个文本文件的自我批评。
- **Generative Agents**：原始观测积累为情节流，定期聚类合成高阶反思（「Klaus 最近总一个人吃饭，似乎情绪低落」），25 个角色自主组织了情人节派对。
- **ExpeL（AAAI 2024）**：系统对比成功/失败轨迹，提取判别性「经验法则」（rules of thumb）存为可复用启发式。
- **Voyager（2023）**：成功经验固化为**可执行代码技能库**——比此前 Minecraft Agent 多获得 3.3× 独特物品、科技树推进快 15.3×。
- **Think-in-Memory（2024）**：把检索与推理分离——先回忆，再对回忆内容做专门的 thinking 步骤，最后才生成回复。

**我的设计**：`agentEvolution.ts` 双机制——

1. **accumulateExperience**：每次 Run 结束 fire-and-forget，把任务摘要/工具列表/成功标志/耗时/token 用量 JSON 序列化写入 `experience` 类记忆（成功 strength=1.0 / 失败 0.5）——这是原始素材层。
2. **optimizeAgentPrompt**：经验 ≥5 条时由管理 Agent 心跳触发，**用历史经验蒸馏优化子 Agent 的 systemPrompt**（禁改 super Agent 防失控）——这是 ExpeL「经验→规则」思路作用于 Agent 定义本身。

**我的改进**：比 Reflexion 更进一步——Reflexion 的反思只活在下一次尝试的 prompt 里（用完即弃），我把经验**蒸馏回 Agent 的持久定义**（prompt 进化），跨会话、跨任务生效；且用「心跳批处理 + 禁改 super」两道闸控制自我改进的风险（呼应综述的 self-reinforcing error 警告与「misevolution」风险论文）。

**差异对比**：①我的 experience 记忆被注入白名单排除，**不参与按任务检索**——缺 ExpeL 式的「当前任务 → 检索相似经验」，优化只能靠心跳全量批处理，实时性弱；②无矛盾检查/置信度门（综述强调的质量门），`optimizeAgentPrompt` 完全信任 LLM 的蒸馏结果；③无 Voyager 式的可执行技能固化——经验只进 prompt 不进工具/技能库（`skill_discover/promote` 工具预留了入口但未闭环）。

## 1.7 机制族四：分层记忆与虚拟上下文管理

**业内实践**：仿 OS 虚拟内存——给 LLM「无限连续上下文」的幻觉，数据在层间透明换入换出。MemGPT 三层范式：**Main context（RAM）**= 当前窗口（system prompt + 近期消息 + 相关记录）；**Recall storage（磁盘）**= 全部历史消息的可搜索 DB；**Archival storage（冷存）**= 向量索引的文档与长期知识。Agent 通过记忆管理函数（`archival_memory_search`、`core_memory_append`）自主换页，中断机制让它在回复前执行多次内部记忆操作。认知架构视角（CoALA, Sumers et al. 2024）给出通用蓝图：工作/情节/语义/程序四个存储经中央执行器（LLM）交互，直接呼应 Baddeley 工作记忆模型。**阿喀琉斯之踵是编排（orchestration）**：换错页浪费珍贵 token，归档太激进则「记忆盲」——Agent 不知道冷存里有关键事实。且**编排失败是静默的**——API 崩溃有报错，换错页只是回答悄悄变差，无异常、无日志、无明显信号。

**最佳实践案例**：

- **MemGPT/Letta**：分层 + LLM 自分页的鼻祖，`memory_warning` 压力信号驱动换页行为。
- **MemoryOS（EMNLP 2025）**：三级存储 + 热度晋升 + 分段分页，把「晋升/降级」规则化。
- **HiAgent（ACL 2025）**：长程任务的分层工作记忆管理，子目标级的工作记忆块。
- **JARVIS-1**：分层原则扩展到多模态（视觉观测/文本计划/可执行技能分别存储）。

**我的设计**：目前**两层**——上下文窗口（含压缩摘要，工作记忆）+ Memory 表（FTS 检索注入，长期记忆）。没有常驻层、没有晋升降级、没有 Agent 自主换页。`docs/development/memory-research-plan.md` 已规划 L0–L5 分层：L0/L1 冻结快照 + 硬预算（对标 Hermes 的 USER.md/AGENT.md）、日记层（对标 OpenClaw）、Dreaming 晋升（后台把日记提炼进长期记忆）、LLM 记忆选择器——但**全部是规划，未落地**。

**差异对比**：**这是与业界差距最大的机制族**。具体缺：①常驻层硬预算（用户偏好/项目约定这类「永远该在上下文里」的内容，现在要等 FTS 恰好命中才注入）；②压力信号 → 主动换出闭环（我的压缩是被动阈值触发，不是 MemGPT 式 LLM 收到 `memory_warning` 后自主分页）；③记忆晋升（高频使用的 episodic 应升为 semantic）；④编排可观测性（综述强调编排失败是静默的——我现在连「哪些记忆被写入但从未被读取」的统计都没有，而这正是 §7.7 建议的第一指标）。

## 1.8 机制族五：策略学习型记忆管理

**业内实践**：启发式和提示控制都不针对最终任务优化——kNN 检索器不知道取回的记录是否真有用，固定摘要周期不管被压内容重不重要。**AgeMem（Agentic Memory, arXiv 2601.01885, 2026）** 把五个记忆操作（store/retrieve/update/summarize/discard）作为 Agent 策略内的可调用工具，整体用 RL 优化，三阶段训练：记忆演示的监督预热 → 任务级结果奖励 RL → 步级 GRPO 稠密信用分配。五个长程基准上稳定超过强基线，且学到非显然策略：上下文填满前**主动**摘要中间结果、丢弃与已有记忆语义相似但无新增信息的记录。开放问题：长程 RL 训练贵；学会遗忘可能删掉安全关键信息；单任务分布训练的策略迁移性差；记忆动作的可解释性落后于能力。**MemRL（2026）**：在情节记忆上做运行时 RL，测试时持续进化。

**我的设计**：**无**。最靠近的「学习」是 `optimizeAgentPrompt` 的 LLM 批处理蒸馏——属于 prompted control（提示控制），不是 learned control（学习控制）。

**差异对比**：符合综述定位——这是 2026 研究前沿而非生产必需。单用户本地场景下，RL 训练成本（数据、算力、稳定性）远超收益，规则控制 + 人工可审计更匹配项目宪法（透明、可 diff）。**合理观望，无差距焦虑**。值得借鉴的是 AgeMem 的两条「涌现策略」其实可以零训练引入：「上下文将满时主动摘要」我已有（macro-compact）；「丢弃语义重复记录」正是 1.1 缺的 memory_update/去重。

## 1.9 机制族六：参数化记忆与权重适配

**业内实践**：把记忆编码进模型权重——全量微调、LoRA 热插拔、记忆层（LongMem 用冻结主干 + 残差侧网络，记忆库扩展到 65k token）、测试时训练（TTT）。优势：零检索延迟、信息深度融合；劣势：更新成本高、灾难性遗忘、**可审计性与可删除性（Governance）最差**——你没法让模型「忘掉」某个人要求删除的数据，也没法 diff 两次记忆之间的变化。

**我的设计**：**无，且明确不做**——项目宪法是「Markdown 为唯一事实源」，记忆必须可读、可编辑、可 git diff、可删除。参数化记忆与这条原则根本冲突。

**差异对比**：**理念性分歧，非能力差距**。综述自己也承认参数化路线在 Governance 维度得分最低，且个人知识管理场景的价值主张恰恰是「用户能直接打开文件看 Agent 记住了什么、改得动、删得掉」。长期也不建议引入；LoRA 热插拔若未来成熟到「即插即忘」，可作为可选加速层重新评估。

## 1.10 评估：从召回率到 Agentic 效用

**业内实践**：综述梳理了评估范式的迁移——静态 recall 基准 → 多会话 agentic 基准（记忆与决策交织）。四大新基准各有锋芒：

- **LoCoMo（ACL 2024）**：超长对话记忆，最多 35 个会话、300+ 轮、每对话 9k–16k token；三类任务（事实 QA / 事件摘要 / 对话生成）。头条结论：**即使 RAG 增强的 LLM 也远落后于人类**，尤其在时间与因果动态上。
- **MemBench（2025）**：区分事实记忆与反思记忆，各测「参与模式」与「观察模式」；三维指标——有效性（准确率）、效率（记忆操作次数）、容量（记忆库变大时的性能衰减）。
- **MemoryAgentBench（ICLR 2026）**：认知科学 grounding，测四种能力——精确检索、测试时学习、长程理解、**选择性遗忘**。把长上下文数据集重格式化为增量多轮交互。头条结论：**没有系统掌握全部四种能力，多数在选择性遗忘上明显失败**。
- **MemoryArena（2026）**：把记忆评估嵌入完整 agentic 任务（网页导航、偏好约束规划、渐进信息搜索、序列形式推理），后续子任务依赖先前学到的内容。最震撼的发现：**LoCoMo 上近满分的模型在 MemoryArena 跌到 40–60%**——被动召回与主动决策相关记忆使用之间存在深沟。
- 实用指标栈建议：任务成功率 + 记忆操作准确率 + token 成本 + 延迟，缺一不可。

**我的设计**：没有记忆专项基准。质量保障体系是「不崩 + 时序正确」导向的：① `trpcSmoke.test.ts`——全部 ai-readable procedure 经 `ai.invoke` 触达无崩溃；② Vitest——`chatHistory.test.ts` 验证扁平存储重建多轮 ReAct 消息链（压缩/重建正确性的核心保障）；③ Playwright E2E 双轨——真实 LLM（`chat-thinking-real` 验证思考时间线不重复）+ 全离线 Mock（`chat-resume-mock` 验证刷新后最终结果不丢失、`chat-subagent-resume-mock` 验证切 session/切 Agent 后流式恢复）。

**差异对比**：我的测试能回答「系统是否正确运转」，但**回答不了 MemoryArena 式的问题**——「记忆注入到底有没有让 Agent 任务做得更好」。缺一个最小评估 harness：同一任务开/关记忆注入的 A/B 对比（Mock LLM 下即可做断言，零成本）；缺记忆操作日志的统计视图（哪些记忆被写后从未被读——MemBench 效率维度的雏形）。两者都是低垂果实。

## 1.11 工程现实（综述①§7 逐条对照）

**业内实践 × 我的实现 × 差异**：


| 工程议题                    | 业界最佳实践                                                                                                                                                                                                                                                                                                | KnowPilot 现状                                                                                                                                | 差异                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **写路径**（§7.1）         | 五要素：过滤低信号 / 规范化（日期名称数量）/ 去重合并 / 优先级打分 / 元数据 tagging（timestamp+source+task label+confidence）。阈值按「失效模式→下游后果」风险分析定                                                                                                                                       | 过滤 ✅（「不记可推导信息」规则 ×2 处）；去重 ≈（flush 40 字前缀查重）；优先级 ≈（strength 但不用）；规范化 ✗；元数据缺 source/task label | 中等差距：规范化与 source 标注缺失，矛盾处理无基础        |
| **读路径**（§7.2）         | 四优化：两段检索（快 BM25/元数据过滤 → 慢 cross-encoder 重排）/ retrieve-or-not 门控 / token 预算动态分配 / 高频记录缓存（如用户偏好常驻）                                                                                                                                                                 | BM25 单段 ✅；门控 ✗；预算分配 ✗（固定 5 条 × 300 字）；偏好缓存 ✗（无 USER.md 常驻层）                                                   | 较大差距：门控与常驻层是性价比最高的两个缺口              |
| **过期/矛盾/漂移**（§7.3） | 四机制：时间版本（偏好最新记录）/ 来源归因（用户陈述 > Agent 推断）/ 矛盾检测（标记冲突待解决）/ 定期整合（计划任务合并重复、退役过期）。反例：给前任的旧地址寄生日卡不是无益而是有害                                                                                                                       | 全缺。同一事实新旧版本共存；无来源区分；无整合任务                                                                                            | 最大差距之一：长寿记忆系统必踩的坑，随使用时间增长而恶化  |
| **延迟与成本**（§7.4）     | 检索进关键路径要预算化：FTS 微秒 / 向量毫秒 / LLM 重排百毫秒；缓存高频查询                                                                                                                                                                                                                                  | FTS5 微秒级、零外部调用 ✅；注入固定 5×300 字符预算可控 ✅                                                                                   | **对齐/局部领先**（向量方案的天然优势区我靠不引入规避了） |
| **隐私/合规/删除**（§7.5） | 删除请求要传播到所有副本（含已注入的上下文、备份、向量索引）；记忆分级（敏感/普通）                                                                                                                                                                                                                         | 本地优先天然满足大部分 ✅；Memory 删除会同步删 md 文件 + FTS 索引 ✅；已注入历史消息的内容作为只读档案保留（合理）；无记忆分级                | 基本对齐，缺分级                                          |
| **三种架构模式**（§7.6）   | A 单体上下文（原型期）→ B 上下文+检索存储（生产主力：编码助手/客服/企业 copilot）→ C 分层+学习型控制（MemGPT/AgeMem，上限最高工程最重）。建议：B 起步、充分插桩、数据证明再升 C                                                                                                                           | 标准**Pattern B**：上下文窗口（工作记忆）+ SQLite/Markdown 长期存储 + 每步 FTS 注入                                                           | **完全命中建议路径**；升 C 的前置条件（插桩数据）尚未建立 |
| **可观测性**（§7.7）       | 记忆操作全量日志（每次 write/read/update/delete 带时间戳与触发上下文）/ 回放工具（修改记忆内容重跑失败交互做根因分析）/**memory diff**（两轮之间记忆库变了什么——团队反馈比传统日志更有诊断价值）/ 回归测试（换 embedding 模型后检索质量验证）/ 操作模式分析（哪些记录被写但从未被读、哪些查询持续返回空） | Run 实体记录执行统计（tokenUsage/toolCallCount/durationMs）；Log 表记操作；无 memory diff、无回放、无记忆回归测试、无「写而未读」分析         | 中等差距：有日志骨架，缺记忆维度的专用视图                |

## 1.12 应用领域映射：不同领域需要不同记忆

**业内实践**（综述①§6.8 总结模式）：个人助理最依赖**语义记忆**（用户偏好/画像）；软件工程 Agent 重度依赖**程序性记忆**（验证过的代码模式与架构决策）；游戏 Agent 需要**情节+程序性紧耦合**（发生了什么 + 该做什么）；科学 Agent 需要带**显式不确定性追踪**的语义记忆；多 Agent 系统需要一个**协调层**——目前没有单 Agent 记忆设计处理得好。没有系统在全部画像上同时强，预示下一代是**模块化可插拔记忆架构**（按部署组合配置，而非单体烘焙）。

**我的设计对照**：KnowPilot 的主场景是「单用户知识管理 + 内容生产 + 自动化」，对应需要：语义记忆（用户写作偏好/项目约定——有 taxonomy 但无常驻注入）、程序性记忆（发布流程/审批规矩——目前靠 skill + prompt 承载，未进记忆系统）、情节记忆（「上次发布踩过什么坑」——experience 有但不参与检索）。多 Agent 协调层的记忆（Swarm 间共享什么、私有什么）目前**完全没有设计**——子 Agent 之间不共享记忆， manager 也看不到子 Agent 的 experience，这与综述「多 Agent 记忆治理」开放挑战同处空白。

## 1.13 记忆系统小结


| 维度            | 业界水位（代表系统）                        | KnowPilot 水位                                 | 差距性质                        |
| ----------------- | --------------------------------------------- | ------------------------------------------------ | --------------------------------- |
| write 路径      | Mem0 四元操作 / A-MEM 进化 / 五要素齐全     | 过滤规则强，去重弱，无 update，元数据缺 source | 中等差距（P0 可修 update）      |
| 压缩与摘要      | Claude Code micro/macro                     | micro+flush+macro+复用+降级，按模型窗口触发    | **持平/局部领先**               |
| 检索表示        | 向量+图+重排+门控（Mem0/Zep/Self-RAG）      | FTS5 单段，无门控，strength 未接线             | 较大差距（门控/排序零依赖可补） |
| 反思/经验       | Reflexion 91% / ExpeL 法则 / Voyager 技能库 | 经验积累 +**prompt 进化**（独有）              | 局部领先，但检索缺失、无质量门  |
| 分层/虚拟上下文 | MemGPT 三层 / MemoryOS 晋升                 | 两层，L0–L5 仅在规划文档                      | **最大差距**                    |
| 过期与矛盾      | Zep 时序 / MemoryBank 遗忘曲线              | 全缺                                           | 随使用时间恶化，越早修越好      |
| 策略学习/参数化 | AgeMem RL / LongMem                         | 无（理念性放弃参数化）                         | 合理观望                        |
| 评估            | MemoryArena 等四基准 + 指标栈               | 崩溃/时序测试充分，效用评估为零                | A/B harness 低成本可补          |
| 可观测性        | memory diff / 回放 / 写而未读分析           | Run 统计 + 操作日志骨架                        | 中等差距                        |

---

# Part 2 · Agent Harness（对照综述② H=(E,T,C,S,L,V)）

## 2.0 综述②的模块地图与核心数字

综述②把 harness 形式化为六元组 **H = (E, T, C, S, L, V)**，并给出「Harness 完整性矩阵」：生产级系统（Claude Code、OpenClaw/PRISM、AIOS、OpenHands）六组件全实现；多 Agent 框架（MetaGPT/AutoGen/ChatDev）普遍只有 E、T 两个完整，C/S/L/V 全是 ≈——**这解释了为什么同样模型在不同系统里可靠性天差地别**。关键实证数字：Grok Code Fast 1 仅改编辑工具格式 SWE-bench **6.7% → 68.3%**；Stripe Minions **1300 PR/周**零人写代码；OpenAI Codex 5 个月 100 万行代码零手写（失败归因于「环境规约不足」而非模型）；METR 评估效度危机（benchmark 通过 ≠ 人类合并，差 24.2pp 且每年扩大 9.6pp）；AgencyBench：Agent 在原生 SDK harness 上成功率 **48.4%**，独立 harness 上显著更低——**harness 与 Agent 是紧耦合的**。

## 2.1 E — Execution Loop（执行循环）

**业内实践**：observe-think-act 循环 + 终止条件 + 错误恢复。工业界共识：**循环的健壮性（而非模型聪明度）决定任务成功率上限**。必备件：轮次/预算上限、卡死检测、工具失败的重试与降级、长任务的 checkpoint 与交接。前沿方向是把 harness 本身变成优化对象——**AutoHarness（2026）** 自动合成代码 harness 提升 Agent 表现；**Meta-Harness（2026）** 端到端优化模型 harness；**Agentic Harness Engineering（arXiv 2604.25850）** 用可观测性驱动 harness 自动进化。

**最佳实践案例**：

- **OpenHands（ICLR 2025）**：事件流式 agent loop——每个 action/observation 都是可回放事件，支持暂停-恢复-分叉，循环即事件溯源。
- **Claude Code 长任务 harness**（Anthropic 工程博客 2026-03「Harness design for long-running application development」）：把「上下文耗尽前的 checkpoint 与交接」做成循环一等机制，配合 todo list 工具做子目标管理。
- **SWE-agent（NeurIPS 2024）**：ACI（Agent-Computer Interface）论文证明循环中「每步观测的格式设计」比换模型更能决定成功率——搜索命令的返回格式、编辑命令的 diff 确认，都是循环设计的一部分。
- **PALADIN（ICLR 2026）/ SHIELDA（2025）**：工具失败的自愈——结构化异常处理 + 自我纠正，把错误恢复从 prompt 提示升级为循环机制。

**我的设计**：双循环架构——

- `runAgentLoop`（非流式）：供心跳/子 Agent/异步任务，`chatCompletion` 循环 ≤ `maxToolRounds`（默认 12，`AGENT_MAX_TOOL_ROUNDS` 可调）；无 tool_calls 即终轮；assistant 消息（含 `reasoning_content`）入队 → `executeToolCallsBatch` → 工具结果 JSON 截 16000 字符入队。**思考链与中间正文持久化进 `StoredToolCall[]`（kind=thinking/content）**——spawn/trigger 子会话可完整重建时间线。
- `runAgentLoopStream`（流式，L211）：边收边推 `thinking`/`token` SSE；**maxRounds 耗尽但执行过工具时，追加一次无 tools 的合成调用**——强制 LLM 基于已有工具结果产出最终答案，而非输出「我已完成工具调用」式兜底文案。
- 错误恢复：单工具 30s 超时（结果附带「建议改用 async_task_run」引导）；MCP 失败单次重连重试；LLM 日预算闸门在循环入口拦截。

**我的改进**：①「合成终轮调用」是对「轮次耗尽 = 任务烂尾」通病的优雅解法（OpenHands 靠用户手动点继续）；②思考/工具/正文三合一持久化让子会话可「继承」父任务的完整推理过程，不只是结论；③超时结果带**下一步行动建议**——把错误恢复写进工具协议层（PALADIN 的轻量版）。

**我的实现**：`infra/agentRuntime.ts`（`runAgentLoop`）、`infra/agentStream.ts` L211（`runAgentLoopStream`）、`infra/agentTools.ts`（`executeToolCallsBatch`）。

**差异对比**：①**实现空隙（P0）**：`AGENT_MAX_TOOL_CALLS_PER_RUN`（168）已入 config 与文档，但 `runAgentLoop`/`runAgentLoopStream` 内**未强制执行**——只有 maxToolRounds 生效。综述把预算硬拦截列为循环必备，这是一行级修复；②缺 OpenHands 式事件分叉/回放（暂停-改输入-继续）；③无显式 todo/checkpoint 工具（Claude Code 长任务的关键件），长任务子目标管理靠 Swarm 拆分间接实现；④无 PALADIN 式失败模式分类自愈（目前只有超时引导这一种）。

## 2.2 T — Tool Registry（工具注册表）

**业内实践**：类型化工具目录 + schema 校验 + 路由 + 监控。2026 三大趋势：①**MCP 统一工具发现**（stdio/SSE 传输，调用延迟仅 2–15ms，已成事实标准）；②**工具描述的内容工程**——描述质量直接决定调用成功率；③**工具安全**——ToolHijacker（NDSS 2026）证明 prompt 注入可劫持工具选择，AEGIS（2026）提出工具调用前防火墙 + 审计层（「No Tool Call Left Unchecked」）。

**最佳实践案例**：

- **MCP 生态**：Anthropic 2024-11 发布，2026 已成工具↔harness 标准；配套安全研究（MCP-38 威胁分类、ETDI OAuth 增强工具定义）。
- **EASYTOOL（NAACL 2025）**：把冗长工具文档重写为简洁结构化指令，成功率显著提升且错误更少——证明「注册表内容工程」值得专门投入。
- **TOOLLLM/ToolBench**：16000+ 真实 API 的工具集 + DFS 决策树导航，比 ReAct 平均 pass rate 高约 81%——工具规模大时检索式工具选择成为必须。
- **OpenHands SDK**：可组合工具集，每个工具声明并发/超时/重试策略。
- **AEGIS（2026）**：每个工具调用执行前的防火墙 + 审计层，策略即数据。

**我的设计**：

- **三源统一桥**（`agentTools.ts`）：`native:` / `skill:` / `mcp:` / `skill:*` 统一解析为 OpenAI function schema；schema 带缓存，EventBus 监听 `skill.*/mcp.*` 事件**自动失效缓存**（配置热更新不用重启）。
- **并发分级 A/B/C/D**：纯 CPU 并发 8 / 网络只读 4 / 本地进程 2 / 写入串行 1；桶间并行、桶内限流——写操作永不并发，从调度层消除写冲突。
- **超时与引导**：单工具 30s；长等待工具（`async_task_wait`/`spawn_subagent`/`sleep`）豁免至 10 分钟（Pause-on-Result 语义）；超时结果附带「建议改用 async_task_run」提示。
- **~90 个 native 工具**：文件 IO、Shell（`shellRunner.ts`）、Git 全套、GitHub/飞书/语雀 API、RSS、web_search/read_article/scrape_web_page（含平台 Cookie 与 jsDelivr 降级链路）、memory_*、post_*、async_task_*、session_clear/rotate、Swarm 全套（agent_*/workspace_*/send_email 等）。
- **`invoke_api`（tRPC 反射）**：全部 20 个业务 router 带 `aiReadable` meta，Agent 用**一个工具**触达 19 实体的全部 CRUD；`trpcSmoke.test.ts` 保证反射面零崩溃。
- **MCP 客户端**（`mcpClient.ts`）：stdio transport，连接超时 12s，结果截断 12000 字符（带 `_truncated` + hint），失败单次重连重试，client/schema 缓存，`MOCK_MCP=true` 离线 mock。
- **Skill 运行时**（`skillRunner.ts`）：code 含 `run()` → `node:vm` 沙箱执行（8s 超时、console 捕获、失败回退 instructions）；否则 Prompt 模式返回 instructions 让 LLM 遵循——**双模式渐进式技能**。

**我的改进**：①并发分级 + 写串行是多数开源 harness 没有的调度层（AutoGPT 系写操作全靠运气）；②`invoke_api` 反射是**与业务系统耦合度最低的工具暴露**——新增实体 router 自动成为 Agent 能力，零胶水代码（对比 Cursor/Continue 手写每个工具绑定）；③超时结果带行动引导，错误信息面向「下一步」而非「发生了什么」。

**差异对比**：①MCP 只支持 stdio（无 SSE/HTTP transport，远程 MCP server 接不了）；②无 EASYTOOL 式描述优化流水线（90 个工具的 description 是手写维护的，质量靠自觉）；③无工具调用成功率监控（AEGIS 式审计层只有审批没有统计）；④工具规模大后的检索式选择（ToolLLM 式）暂无必要但值得留意——90 个工具的 schema 已占可观 token，继续膨胀会需要「工具检索」。

## 2.3 C — Context Manager（上下文管理器）

**业内实践**：决定「什么进入窗口」——系统提示组装、记忆检索、压缩、工具结果裁剪、文件按需加载。2026 焦点是**上下文经济学**：1M+ token 任务下每 token 有成本，lost-in-the-middle 研究证明位置也影响召回。AgencyBench 把战场推到 1M token 真实上下文。前沿：**AgentSys（2026）** 显式分层内存管理做安全与动态上下文；**Runtime Harness Adaptation（arXiv 2605.22166）** 不改模型、运行时适配 harness 接口（prompt 格式/动作校验/反馈解释/轨迹控制）。

**最佳实践案例**：

- **Claude Code**：micro/macro 压缩 + 文件**按需读取**而非预载 + 压缩前通知用户。
- **Aider**：repo map——把整个代码库结构压缩成一页地图常驻上下文，文件级细节按需加载，是「项目结构压缩表示」的标杆。
- **Cursor**：codebase 索引 + 相关文件检索注入，IDE 级上下文管理。
- **Hermes Agent（Nous Research, 2026）**：L0–L2 冻结快照 + 硬预算的上下文分层（我的 memory-research-plan 对标对象）。

**我的设计**：= Part 1 全部（记忆注入 + 三段式压缩 + 摘要复用）+ 两项 harness 层专属：

- **`chatHistory.ts` 历史重建**：扁平存储（一条 assistant 含全部 toolCalls）→ 重建为合法 OpenAI 多轮格式——每个 tool_call 拆成 `assistant(content=null) + tool result` 消息对，最终答案是独立 assistant 消息，thinking 聚合为 reasoning_content；vision 模型直传 image_url，否则 OCR 文本拼接。**存储格式与 API 格式解耦**，换 provider 只改重建层。
- **上下文可视化**：前端 `sessionContextUsage` / `tokenBudgetBar` 把上下文占用与预算**实时可视化**给用户——多数 CLI/Web harness 没有这层透明。
- 会话设置面板（`chatSettingsPanel`）支持 model/temperature/maxToolRounds/toolCallTimeoutMs 的会话级覆盖——**harness 参数对单用户可见可调**（Runtime Harness Adaptation 的手动版）。

**差异对比**：对齐 Claude Code 主线实践，可视化与参数可见是体验亮点。差距：①无 Aider repo map 式「项目结构常驻表示」——Agent 了解代码库靠临时读文件，每个会话重复付探索成本；②无文件按需加载的引用机制（大文件读入即全额占预算，无「引用-展开」懒加载）；③上下文经济学的量化面板只有占用率，没有「各段贡献度」（哪段上下文值得它占的 token）。

## 2.4 S — State Store（状态存储）

**业内实践**：跨轮/跨会话持久化 + 崩溃恢复 + 断线续传。生产三大痛点：①客户端断开时 run 该不该杀（杀了浪费已付 token，不杀要管孤儿进程）；②服务端重启后流怎么续；③状态变更的并发安全（TOCTOU）。主流解法是**事件溯源**：状态 = 事件流的重放，断线续传 = 从游标重放。

**最佳实践案例**：

- **LangGraph**：checkpointer 抽象，每个 super-step 持久化状态，支持 **time-travel**（回到任意历史状态分叉）与 human-in-the-loop 断点——状态存储的业界标杆。
- **OpenHands**：完整事件溯源，事件流即状态，可重放、可分叉、可审计。
- **Codex CLI**：session 文件 + resume 协议，跨进程恢复对话。
- **AIOS（COLM 2025）**：OS 级调度 + 上下文快照，2.1× 加速的多 Agent 状态管理。

**我的设计**：

- **SessionStreamHub**（`sessionStreamHub.ts`）：Agent 运行是独立 Promise，**客户端断开不 abort**（已付的 token 不浪费）；事件双写——内存环形缓冲（`config.yaml` `stream.ringSize: 500`，低延迟推送）+ SQLite `SessionStreamEvent` 表（`eventTtlMs: 300000` 5 分钟、`cleanupIntervalMs: 60000` 清理，断线续传/重启恢复）；订阅先重放后实时，`resumeAfter` 游标续传；`startIfNotRunning` 幂等 + **TOCTOU 修复**（先同步占位 `runs.set` 再 await maxEventId）；`migrateSessionId` 处理 POST 占位 → 真实 sessionId 的迁移；`pushExternalEvent` 始终推 externalSubs 同时入活跃流缓冲。
- **SSE HTTP 层**（`agentStream.ts` L990 `handleAgentChatStream`）：POST 启动 / GET 续传；token 事件 16ms 合并刷帧；5s keepalive 心跳；`X-Accel-Buffering: no`；运行已结束时重放完缓冲补发 done 防前端重连循环；`/api/agent/chat/stop` 走 hub.stop → AbortController。
- **消息一致性（INV-6）**：服务端写库 → SSE 推完整消息 → 前端 reducer upsert——**消息唯一真相源在服务端**，react-query 仅 hydrate/翻页/兜底。
- **并发防护**（`docs/development/concurrency.md`）：`agentRunLocks` 进程内串行、每 session 单活跃流 + queueDraining、assistant+Run `$transaction`、SQLite 单连接串行化。

**我的改进**：①「内存热缓冲 + SQLite 事件日志」双写 = LangGraph checkpointer 的核心能力但**零外部依赖**（SQLite 即事件日志、即消息队列、即邮箱）；②断开不 abort + 游标续传 + 重启重放三段全覆盖，多数开源项目只做了其中一段；③TOCTOU、占位迁移这类边角竞态全部以「根因 → 修复 → 好处」沉淀在 design-decisions.md——**状态层的 bug 是根治的不是打补丁的**。

**差异对比**：**全项目与业界对齐度最高的模块**。差距：①无 time-travel/分叉（LangGraph 的杀手锏——「回到第 3 步换个输入重跑」我做不到，只能开新会话）；②运行中的 run 随进程重启丢失——事件可重放但 LLM 调用不可续（综述列为开放挑战，**与业界同水位**）；③进程内锁重启丢失，多实例需 Redis（`concurrency.md` 已自认，单用户场景合理）。

## 2.5 L — Lifecycle Hooks（生命周期钩子：鉴权/日志/策略/插桩）

**业内实践**：在工具调用前后挂策略——权限校验、危险操作审批、审计日志、预算闸门、指标采集。2026 核心共识：**prompt 级约束可被注入绕过，策略必须在运行时强制执行**（runtime policy enforcement）。前沿是「策略即数据」——声明式、可组合、可验证。

**最佳实践案例**：

- **AgentSpec（2025）/ Agentspee（ICSE 2026）**：声明式策略 + 运行时强制——策略写在 Agent 外部，Agent 自己改不了。
- **PRISM/OpenClaw（2026）**：零 fork 纵深防御运行时安全层，10 个钩子把容器逃逸压到近零、开销 <5ms。
- **SafeFlow（2025）**：事务化 Agent 系统协议，危险操作可回滚。
- **AEGIS（2026）**：「No Tool Call Left Unchecked」——每个工具调用执行前过防火墙 + 审计。
- **Claude Code 权限模式**：工具白名单 + 危险命令人工确认 + plan mode（只读）。

**我的设计**：**四层防线**，全部运行时强制、不依赖 LLM 自觉——

1. **工具白名单**：Agent 定义级 `tools` 授权 + `resolveToolsForAgentTier` 按 tier 裁剪 + `parsed.native==="all"` 兜底过滤，**双保险防子 Agent 拿到全量工具**。
2. **tier 硬拦截**（`swarmPermissionGuard.ts`）：super>manager>sub 排序 + `TIER_RESTRICTED_TOOLS` 映射（`workspace_*`/`agent_*` 仅 super，`*_sub`/`spawn_subagent` 需 manager+）；子 Agent 的 `async_task_run` 强制 `mode=tool`（禁带 LLM 的异步任务，防算力失控）；禁自删、禁同级通信、manager 禁跨 Workspace；**向上发消息的时机约束**（工具轮次中禁发，`report` 工具豁免）；`depth>10` 防循环委托。
3. **危险操作人工审批**（`approvalGate.ts`）：`APPROVAL_REQUIRED_OPS`（agent/skill/mcp/task/file.delete + git.push/commit/pull）无 approvalId 时**自动建 pending 审批并抛 FORBIDDEN**（携带 approvalId 供前端引导用户去 `/approvals`）；带 approvalId 时校验状态/工具名/**参数一致性（argsMatch）**——防「审批后改参数」篡改；审批通过走 `trpcInvoker` 重放后删除记录；`REQUIRE_APPROVAL=false` 可全局关闭；`AGENT_DESTRUCTIVE_APPROVAL` 环境变量预留。
4. **预算与审计**：`assertLlmBudget` 日预算闸门（`LLM_DAILY_BUDGET`）；Run 级 token 用量记录；SwarmBus 发送前五重校验（权限/时机/跨 Workspace/depth/队列容量 100）+ 审计 Log 落库；心跳专用便宜模型（`heartbeatModel`）+ Agent 级专属 apiKey + 免费 Key 同步（`sync-free-keys`）。

**我的改进**：①**审批的参数快照 + argsMatch 防篡改**——业界多数审批只记「用户同意了 X 操作」，不校验重放时的参数与审批时是否一致（AEGIS 论文专门点这个洞）；②**向上发消息的时机约束**——多 Agent 系统中「子 Agent 在工具轮次中间向上级发消息」会制造半个任务状态的汇报，我在 guard 层直接禁掉（这个坑在 CrewAI/AutoGen 里没有任何防护）；③**身份防冒充**（`buildTierIdentityHint`）——子 Agent 的 system prompt 明确其 tier 与边界，防 LLM「角色扮演成上级」给自己扩权。

**差异对比**：**KnowPilot 相对业界的最强项之一**，达到 AgentSpec/PRISM 论文级主张的生产落地。差距：①策略是代码内常量（`TIER_RESTRICTED_TOOLS`、`APPROVAL_REQUIRED_OPS` 硬编码），不是 AgentSpec 式声明式可配置数据——改策略要改代码发版；②无 SafeFlow 式操作回滚（审批拦住的是「未发生」，已发生的危险操作没有 undo）；③无 PRISM 式 OS 级沙箱（skill 的 `node:vm` 只是 JS 沙箱，shell 命令直接跑在本机——单用户本地定位下可接受，但 SandboxEscapeBench 15–35% 逃逸率的警示值得记着）。

## 2.6 V — Evaluation Interface（评估接口）

**业内实践**：导出动作轨迹、中间状态、成功信号，供基准测试与回归。**评估效度已成 2026  crisis**：METR 发现 benchmark 通过的 PR 人类合并率低 24.2pp 且每年扩大 9.6pp；OSWorld 报告自动评估 **28% 假阴性率**；HAL 统一 21,730 rollouts 把数周评估压到数小时。前沿是「Agent 评估 Agent」——**VeRO（2026）**：让 Agent 优化 Agent 的评估 harness。

**最佳实践案例**：

- **HAL（ICLR 2026）**：整体 Agent 排行榜，统一评估层 + 成本归一化（不比分数比「每美元成功率」）。
- **SWE-bench 轨迹格式**：patch + 测试通过率为成功信号的极简有效设计。
- **LangSmith**：生产 trace → 数据集 → 回放评估的闭环。
- **MASEval（2026）**：把多 Agent 评估从模型扩展到系统（通信成本、协调开销纳入指标）。

**我的设计**：

- **Run 实体**：每次执行记录 tokenUsage/toolCallCount/durationMs/成功标志——统计级，非轨迹级。
- **审计 Log + 操作日志**：SwarmBus 发送、审批、心跳执行全落库可查。
- **测试体系**：Vitest（19 实体 CRUD 含 InfoSource、db:sync、Agent chat、GitRepo 沙箱、git.commit/pull 审批；agentTools 解析/授权/并发批次；nativeTools；skillRunner 沙箱；mcpClient 截断；chatHistory 重建；async-task-queue；capabilities；fts；auth）+ Playwright E2E 双轨（真实 LLM：思考时间线不重复/工具/OCR/异步队列；Mock 全离线：刷新恢复/切 session 恢复/子 Agent 恢复/异步任务结果自动插入/主题切换/回收站）+ `trpcSmoke`（全部 ai-readable procedure 经反射触达无崩溃）。

**我的改进**：测试矩阵的**场景覆盖度不输一线项目**——特别是 `chat-subagent-resume-mock`（刷新/切 session/切 Agent 后父会话流式恢复）这类竞态场景 E2E，多数项目根本没有对应测试；Mock/真实双轨让 CI 不烧钱也能回归。

**差异对比**：①**无轨迹导出格式**——Run 是统计指标不是可回放轨迹（messages+toolCalls+结果+时间线的 JSONL），无法接入 HAL/SWE-bench 式基准，也无法做「同一输入重放对比」的回归；②无成功率/成本的趋势面板（数据在 Run 表里，没有聚合视图）；③评估只在「不崩」层，缺「任务成功率」层（V 组件在完整性矩阵里我算 ≈ 而非 ✓）。

## 2.7 Harness 完整性矩阵：KnowPilot 自评

对照综述②的矩阵（✓ 完整 / ≈ 部分 / ✗ 缺失）：


| 组件           | Claude Code | OpenHands | MetaGPT | LangGraph | **KnowPilot** | 自评依据                                                     |
| ---------------- | ------------- | ----------- | --------- | ----------- | --------------- | -------------------------------------------------------------- |
| E 执行循环     | ✓          | ✓        | ✓      | ✓        | **✓**        | 双循环 + 合成终轮 + 超时引导；扣分项：预算未强制（实现空隙） |
| T 工具注册表   | ✓          | ✓        | ✓      | ≈        | **✓**        | 三源统一桥 + 并发分级 + 反射；扣分项：MCP 仅 stdio           |
| C 上下文管理器 | ✓          | ✓        | ≈      | ≈        | **✓**        | 三段式压缩 + 记忆注入 + 历史重建 + 可视化                    |
| S 状态存储     | ✓          | ✓        | ≈      | ≈        | **✓**        | 双写续传 + 断开不 abort + INV-6；缺 time-travel              |
| L 生命周期钩子 | ✓          | ✓        | ≈      | ✗        | **✓**        | 四层防线 + argsMatch 审批 + 预算闸门；策略硬编码             |
| V 评估接口     | ≈          | ≈        | ≈      | ✗        | **≈**        | 测试矩阵强，但无轨迹导出/基准接入                            |

结论：按综述②「生产级需六组件全实现」的标准，KnowPilot 是 **5✓ + 1≈**——与 Claude Code/OpenHands 同档（它们是 5✓+1≈ 或 6✓），显著高于多 Agent 框架普遍水平（2✓+4≈）。这不是自夸而是结构性事实：单用户本地平台把 L（权限审批）做到了多 Agent 框架都不做的深度。

## 2.8 综述②九大挑战逐条对照


| # | 挑战（业界关键数字）                                                                                                       | KnowPilot 现状与差异                                                                                                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | **安全与沙箱**：SandboxEscapeBench 前沿模型 15–35% 逃逸率；PRISM 10 钩子 <5ms 开销压到近零；ToolHijacker 注入劫持工具选择 | skill 有`node:vm` 沙箱（8s 超时）；shell 经 `shellRunner.ts` 直接本机执行（**无容器隔离**——单用户本地定位可接受）；审批+权限四层防线强于多数项目；无注入检测（web_search 结果直接进上下文，间接注入面存在） |
| 2 | **评估与基准**：HAL 21,730 rollouts；OSWorld 28% 假阴性；METR 24.2pp 效度危机                                              | 测试丰富但无基准接入、无轨迹导出（见 2.6）                                                                                                                                                                    |
| 3 | **协议标准化**：MCP（2–15ms）成事实标准；A2A（50–200ms）Agent 间标准；威胁建模（MCP-38/ETDI）                            | MCP 客户端（stdio）✅；A2A 未支持——Swarm 用私有`AgentMessage` 总线（SQLite 邮箱），`SWARM_MODE=redis` 预留 BullMQ 升级；本地单域下协议互操作需求低                                                          |
| 4 | **运行时上下文管理**：1M+ token 任务的上下文经济学；AgencyBench 1M token 战场                                              | 三段式压缩 + 摘要复用对齐 Claude Code；无 repo map 常驻、无文件懒加载（见 2.3）                                                                                                                               |
| 5 | **工具使用与注册**：EASYTOOL 描述工程；TOOLLLM 检索式选择；AEGIS 调用前防火墙                                              | 三源桥 + 反射 + 并发分级对齐一线；无描述优化流水线与调用统计（见 2.2）                                                                                                                                        |
| 6 | **记忆架构**：Pattern B→C 演进；MemoryOS 抽象                                                                             | Pattern B 标准实现，缺分层与矛盾处理（见 Part 1）                                                                                                                                                             |
| 7 | **规划与推理**：TOOLLLM DFS 比 ReAct +81% pass rate；plan-and-execute 分离                                                 | ReAct 单环 + thinking 时间线；**无显式 planner**；复杂任务靠 Swarm 层级委托替代（见 3.4）                                                                                                                     |
| 8 | **多 Agent 协调**：AgencyBench 原生 SDK 48.4% vs 独立 harness 显著更低（紧耦合）；Byzantine 容错开放                       | 三层 tier + 心跳 + SQLite 邮箱 + depth/时机防循环 + 推优先轮询兜底；Byzantine 容错不涉及（单用户可信域，合理）；「父流耦合 × 任务池调度」双轴正交设计概念清晰度高于 CrewAI/AutoGen                           |
| 9 | **算力经济**：Dual-pool token 预算路由；成本归一化评估（每美元成功率）                                                     | 日预算闸门 + 心跳降配模型 + Agent 级 apiKey + 免费 Key 同步——**成本控制意识强于多数开源项目**；缺每任务成本归因面板                                                                                         |

---

# Part 3 · Agent 架构总览（对照综述③）

## 3.0 综述③的模块地图


| 章节     | 模块                                                            |
| ---------- | ----------------------------------------------------------------- |
| §4      | 基座 LLM 选择（专有 / 开源）                                    |
| §5      | 外部工具集成（知识 grounding+检索 / 代码+API+系统 / 交互+具身） |
| §6      | Agent 框架（四模块基本架构 / 通用框架 / 领域框架）              |
| §7      | 推理、规划、记忆（单 Agent vs 多 Agent 技术）                   |
| §8      | Prompting / 微调 / 记忆增强的影响与协同                         |
| §9      | 评估基准与数据集                                                |
| §10–11 | 讨论与未来方向（可验证推理 / 规模化协作 / 人机共生）            |

综述③的关键判断：GPT-4 是 55 篇研究的基座基准（其次是 GPT-3.5 的 23 篇），承担三种角色——消融实验金标准、与开源模型协作的多 Agent 成员、Agent 栈的主推理模块；开源生态（LLaMA-2/3、Mistral、Qwen、DeepSeek）正快速缩小差距；**「Agent 推理的瓶颈不在算法复杂度，而在模型的长程连贯规划能力」**。

## 3.1 基座模型选择

**业内实践**：专有模型（GPT-4 系、Claude 3 系、Gemini——后者以超长上下文文档级规划见长）vs 开源（LLaMA、Mistral、Qwen、DeepSeek）；选型按任务×成本×数据合规；多 Agent 系统中常见「强模型做规划 + 弱模型做执行」的混合编配以控成本。

**我的设计**：多 provider 统一客户端（`llmClient.ts`：deepseek/openai/anthropic，流式/非流式统一接口，`MOCK_LLM=true` 全离线测试）；`resolveEffectiveAgentModel` 支持 **Agent 级模型覆盖**；**心跳专用便宜模型**（`Agent.heartbeatModel`——后台自主任务不配用贵模型）；Agent 级专属 apiKey（不同 Agent 走不同账户/额度）；免费 API Key 同步链路（`sync-free-keys`：GitHub → Credential 表，AES-GCM 加密存储）。

**差异对比**：「按任务角色选模型 + 成本路由」与业界混合编配思路一致且做得更细（心跳降配是多数项目没有的）；未支持本地开源模型（Ollama 等）——与「本地优先」理念其实有缺口，单用户隐私场景下本地小模型做 flush/压缩等 side 任务是合理方向（当前 side LLM 也走云端）。

## 3.2 Profile（身份定义模块）

**业内实践**：Profile 定义 Agent 的操作人格（开发者/顾问/领域角色），通过静态专家定义（MetaGPT 角色卡：产品经理/架构师/工程师的 SOP 化职责）或动态生成机制（Generative Agents 的人格特质 + 社会关系，影响下游记忆检索、规划与动作选择）。2026 共识：profile 不只是 prompt 装饰，它**条件化**下游所有模块的行为。

**我的设计**：Agent 实体 = `systemPrompt` + `tier`（super/manager/sub）+ `tools` 白名单 + `workspaceId/parentId` 层级 + `heartbeat` 配置；运行时注入 `buildTierIdentityHint`——**在 prompt 层明确告知子 Agent 的 tier 身份与权限边界**，防 LLM「角色扮演成上级」自我扩权（多 Agent 系统中 profile 伪造是真实攻击面）；Prompt 模板实体（`content/prompts/`）与 about/profile 分离管理；profile 同样走「Markdown 事实源 + db:sync」。

**差异对比**：静态 profile + 层级身份，无 Generative Agents 式人格模拟（项目定位是工具不是社会模拟，合理取舍）；**tier 身份防冒充是独特改进**——AutoGen/CrewAI 的 agent 间消息默认互信，没有任何身份校验层。差距：profile 与记忆的联动缺失（综述强调 profile 条件化记忆检索——我的记忆注入不按 Agent 角色过滤，所有 Agent 共享同一记忆池检索逻辑）。

## 3.3 Memory（记忆模块）

完整对照见 Part 1。综述③特别补充的**多 Agent 记忆技术**视角：多 Agent 系统需要「共享世界状态 + 私有记忆流」的双层设计（Generative Agents：共享环境 + 每角色私有观察流），以及动态检索策略适应分布式复杂性。

**KnowPilot 对照**：Swarm 的记忆是**全共享单池**（所有 Agent 检索同一个 Memory 表）+ 私有通道只有 `AgentMessage` 邮箱与各自 ChatSession——没有「per-Agent 记忆视图」，也没有「workspace 级记忆隔离」。这是 Part 1 未展开的差距：**多 Agent 记忆治理在 KnowPilot 同样是空白**（与综述①§9.6 开放挑战同水位，不算落后但也没有领先）。

## 3.4 Planning（规划模块）

**业内实践**：两大家族——**无反馈规划**（CoT 逐步、ToT 树搜索、Plan-and-Solve、single-shot 一步生成完整计划——适合时间紧迫场景）与**带反馈迭代**（ReAct 环境反馈、ReHAC 用 MDP + RL 做人机任务分配、RAFA 把「推理未来动作」与「当前行为」分离做多步轨迹生成、任务栈规划做结构化目标分解、World Knowledge Model 用持久任务知识减少盲目探索）。2026 趋势：显式 planner 与 executor 分离（plan-and-execute），长任务用检查点 + 子目标树。综述③引用的关键数据：**TOOLLLM 的 DFS 决策树规划在 16000+ API 环境比 ReAct 平均 pass rate 高约 81%**——工具密集环境中，搜索式规划碾压线性 ReAct。

**最佳实践案例**：

- **LangGraph plan-and-execute 模板**：planner 生成多步计划 → executor 逐步执行 → replanner 按结果修正。
- **Tree of Thoughts**：分支探索 + 价值评估剪枝，24 点游戏成功率从 CoT 的 4% 到 74%。
- **Voyager**：课程式自动目标分解——「接下来学什么」由当前能力与库存决定，开放式探索的规划范式。
- **Claude Code todo_write**：轻量 todo list 工具，LLM 自维护子目标清单，长任务不掉链子。

**我的设计**：**ReAct 单环 + thinking 时间线**，无显式 planner 模块。复杂目标分解**外包给 Swarm 层级**：管理 Agent 用 `spawn_subagent`/`agent_create_sub` 把大任务拆给子 Agent——`waitForResult=true` 同步拿结果（结果走 tool return，不进异步队列）/ `false` 异步等 `agent_report_back`（系统不代抓最后一条，语义明确）。前端 `chatTimelineSteps` 把隐式规划过程（思考/工具时间线导轨）可视化。

**我的改进**：「父流耦合 × 任务池调度」**双轴正交**（design-decisions.md 确认的术语纪律，禁用「阻塞式异步」这类自相矛盾概念）——同步 spawn 系统抓最后一条 assistant 作 tool return；异步必须显式 report_back。这套语义比 AutoGen 的「对话到某轮自然结束」清晰得多。

**差异对比**：①「用多 Agent 层级委托替代单 Agent 规划」是有意取舍（与 MetaGPT 的 SOP 分工同思路），但**子 Agent 自己的长任务没有 todo/checkpoint 机制**——Claude Code 证明一个 todo_write 工具就能显著改善长任务，这是低成本高回报缺口（P2）；②无 ToT/搜索式规划——在「90 工具 × 多步组合」场景下，TOOLLLM 的 +81% 数据说明线性 ReAct 可能是工具密集任务的成功率瓶颈；③无 replan 机制（计划失败后只能等下轮用户/心跳驱动）。

## 3.5 Reasoning（推理技术）

**业内实践**（综述③§7.1 的代表技术）：**MATRIX**——仿真式自我批评做内省评估；**ToolEmu**——风险提示推理，GPT-4 在沙箱中评估工具执行风险（系统化风险分析）；**Theorem-of-Thought**——把推理分解为溯因/演绎/归纳子 Agent，信念传播 + NLI 协调；**EASYTOOL**——高层目标分解为模块化子问题改善逐步执行；单 Agent 场景 ReAct（即时效率）与 Reflexion（迭代自我改进）的取舍取决于任务性质，**两者结合平衡即时效率与自我改进**。

**我的设计**：推理层不做算法创新，做**工程承载**：① `reasoning_content` 全程持久化（thinking 进 `StoredToolCall[]`，时间线可重建、可回放展示）；② 思考/工具/正文三合一时间线导轨 UI——**推理过程对用户完全透明**（多数产品折叠或丢弃中间推理）；③ thinking 不重复保障有专门 E2E（`chat-thinking-real.spec.ts` 验证真实 LLM 下思考时间线不重复——这是流式重建的经典 bug 区）。

**差异对比**：推理算法层与业界研究前沿无交集（合理——项目定位是平台不是推理研究）；**推理可观测性是亮点**（时间线持久化 + 不重复保障 + 多版本 `versionMeta`），这正是综述②V 组件强调的「中间状态可导出」的雏形。

## 3.6 Action（行动模块）与工具集成

**业内实践**（综述③§5 三分法）：①知识 grounding + web 搜索 + 结构化检索类工具；②代码生成 + API 调用 + 系统集成类工具（CodeAct：LLM 直接写代码组合工具，动作空间从「枚举」变「编程」）；③交互式与具身环境工具（GUI/机器人）。动作空间设计（粒度、可组合性、错误可恢复性）是成功率关键。

**我的设计**：三类全覆盖——①web_search/read_article/scrape_web_page（带平台 Cookie 与 jsDelivr 降级链路）+ RSS + FTS 全局搜索；②Shell（`shellRunner.ts`）+ Git 全套 + GitHub/飞书/语雀 API + `invoke_api` 反射 + skill 沙箱（**code 模式 = CodeAct 轻量版**：`node:vm` 执行而非完整解释器，8s 超时）；③无具身/GUI（项目域外）。动作可靠性：并发分级 + 写串行 + 超时引导 + 审批拦截（见 2.2/2.5）。

**差异对比**：动作面覆盖对个人项目而言很全。与 CodeAct 的差距：LLM **不能即兴合成新工具并立刻注册**——skill 需预先定义（`skill_discover/promote` 预留了「轨迹→技能」的入口但未闭环，这正是 HASP 论文「技能从建议性文本升级为可执行程序函数」的方向）；GUI/具身不涉及（合理）。

## 3.7 多 Agent 框架对比

**业内实践**（综述③§6.2 + 综述②矩阵）：

- **AutoGen**：对话式协作 + 可插拔人审，强调结构化角色协调与任务编排；矩阵评级 E✓T✓ 其余 ≈。
- **CAMEL**：自主角色扮演 + 目标驱动协作，适合对话密集/模拟场景。
- **MetaGPT（ICLR 2024）**：SOP 装配线——把软件公司流程编码为角色协作协议，共享消息池 + 订阅机制。
- **ChatDev（ACL 2024）**：聊天驱动的软件开发流水线。
- **LangChain**：灵活但「无主见」（unopinionated），关键架构决策全留给开发者。

**我的设计（Swarm）**：三层层级（super/manager/sub）+ Workspace 隔离——

- **super**：全局 CRUD + 每日 9 点心跳自主运行；首次启动幂等创建（tombstone 防重复、`sync-agents` 跳过 tier=super——修过「重复超级 Agent」的真实 bug）。
- **manager**：每 Workspace 一个，`isMainSession` 主会话统一接收上级消息（**「每 Agent 单主会话」避免同 Agent 多会话争抢**）；心跳与用户对话用 `kind="heartbeat"` 会话隔离。
- **sub**：执行任务 + `report_back`；工具集经 tier 裁剪。
- **通信**：`LocalSwarmBus`（SQLite `AgentMessage` 表；messageType=command/query/report/forward；status 机 pending→delivered→consumed；队列容量 100；depth>10 防循环；发送前五重校验 + 审计）；`agent_message` 经 StreamHub **推优先**，`pullAgentMessages` 轮询兜底。
- **心跳引擎**：node-cron 按 `Agent.heartbeat{cron,goal}` 注册；EventBus 监听 agent CRUD **防抖 500ms 增量刷新**（替代 60s 全量轮询）；触发链：预算检查 → 找/建 heartbeat 专用 session → `source="system"` 消息注入（INV-6 广播）→ AsyncJobOrchestrator 共享并发池（全局 2 / 每 session 2）执行非流式 run → 更新 lastRunStatus/consecutiveFailures，连错 3 次记日志。
- **异步任务**：`asyncJobOrchestrator`（超时 5min、重试 3 次、取消、subagent AbortController 注册表）+ `asyncJobManager`（Task 表持久化 delivered/pinned，前端 pinned 延后消费、消费时 ack CLAIM）。

**差异对比**：①**概念清晰度高于 CrewAI/AutoGen**——三队列（userQueue/superiorQueue/asyncResultQueue，async 优先消费、pinned 延后）、双轴正交的结果交付、推优先拉兜底，全部经 design-decisions.md 的 Q&A 流程收敛并文档化；②层级权限 + 身份防冒充 + 时机约束是**多 Agent 框架普遍缺失的安全维度**（矩阵里 MetaGPT/AutoGen 的 L 都是 ≈）；③差距：心跳失败告警只记日志（邮件链路自认 Phase 5 未接通）；无 A2A 协议（外部 Agent 无法加入）；无 MetaGPT 式 SOP 模板库（流程知识靠 systemPrompt 手写）。

## 3.8 Prompting / 微调 / 记忆增强的协同

**业内实践**（综述③§8）：prompting = 非参数化动态控制与角色委托；微调 = 嵌入领域专长与核心行为特质；记忆增强 = grounded 推理与经验学习。三者协同（§8.4）是 2026 共识——单靠任何一个都有天花板。

**我的设计**：prompting 层——Prompt 模板实体 + tier 身份注入 + Agent systemPrompt（Markdown 管理、版本可追溯）；微调——**明确不做**（单用户本地场景 ROI 为负，且违反透明原则）；记忆增强——Part 1 全部 + `optimizeAgentPrompt`（经验 → prompt 的蒸馏，**这是「记忆增强反哺 prompting」的协同闭环**，恰是综述③§8.4 主张的协同形态）。

**差异对比**：与「prompting + 记忆增强优先于微调」的建议完全一致，且 optimizeAgentPrompt 实现了多数项目没有的「记忆→prompt」反哺；差距是协同缺第三环——没有「prompt 变更的效果评估」（改了 systemPrompt 后任务成功率变好还是变差，无度量）。

## 3.9 评估基准全景

**业内实践**（综述③§9 的代表基准）：**任务/交互型**——TIME-ARENA（时间动态约束的多任务模拟：烹饪/家务/实验）、AndroidArena（跨应用协作 + 用户约束合规）、RE-Bench（开放式 ML 研究任务，与人类专家直接对比）、Overcooked-AI（零样本协调）、ALFRED（指令跟随）、WebShop（网页导航）、AndroidWorld；**工具型**——ToolBench（16000+ 真实 API + ToolEval 自动评估 pass rate 与方案质量）、ChemCrow/Coscientist（化学合成规划与执行的领域基准）；**方法论**——从静态语言指标转向动态环境中的任务成功率、步骤效率、成本。

**我的设计**：（同 2.6）测试体系强在「系统正确性」（CRUD/并发/竞态/恢复），与上述基准的「任务效能」层不重叠。KnowPilot 自身就是 Agent 的**工作环境**（Agent 在平台上管内容、跑自动化），所以天然适合做一个「平台任务基准」：发布一篇文章、处理一批审批、完成一次跨 Agent 协作——用 Mock LLM 回放即可断言全流程。这是 V 组件从 ≈ 升 ✓ 的具体路径。

## 3.10 未来方向对照（综述③§11）


| 综述③未来方向                     | KnowPilot 的位置                                                                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| 可验证推理与鲁棒自我改进           | optimizeAgentPrompt 是自我改进雏形；**缺验证环**（改进效果无度量、无回滚——改坏的 prompt 靠人工发现）                               |
| 规模化、自适应、协作式 Agent 系统  | Swarm 三层 + 心跳是协作骨架；规模化上限受 SQLite 单连接与进程内锁约束（`SWARM_MODE=redis` 已预留）                                   |
| 深化人机共生：个性化、主动性、信任 | **最强项**：心跳自主运行（主动性）× 审批拦截+队列化交互（可控性）× 时间线透明（信任）的配对设计——综述§11.3 三角的完整工程化回答 |

---

# Part 4 · 总体差异总结与行动建议

## 4.1 KnowPilot 相对业界的五条「领先线」

1. **权限与审批的工程深度**（对照综述②L、九大挑战#1）：tier 硬拦截 + **参数快照审批（argsMatch 防篡改）** + 向上发消息时机约束 + 身份防冒充 + 子 Agent 算力限制——达到 AgentSpec/PRISM/AEGIS 论文级主张的生产落地，开源一线项目（AutoGPT/CrewAI/AutoGen）普遍没有运行时权限层。
2. **状态与流式的正确性纪律**（对照综述②S）：SessionStreamHub 双写续传 + 断开不 abort + 重启重放 + TOCTOU 根治 + 前端三层 store 的 **reducer 强制不变量**（INV-1~6，「删掉编排层补丁 bug 不复现」的架构铁律）+ 推优先轮询兜底；竞态场景 E2E（刷新/切 session/切 Agent 恢复）覆盖度罕见。
3. **成本与主动性的配对设计**（对照综述②#9、综述③§11.3）：日预算闸门 + 心跳降配模型 + Agent 级 apiKey + 免费 Key 同步；「心跳自主运行 × 审批可控 × 队列化交互」——人机共生三角的完整工程化。
4. **压缩与摘要的抗漂移机制**（对照综述①§4.1）：micro+flush+macro 三段 + **摘要复用 + generation 边界**（消灭 summarization drift 的重复压缩路径）+ 按模型窗口百分比触发 + trimOldest 降级——对齐并局部超过 Claude Code 公开实践。
5. **业务系统的零胶水 Agent 化**（对照综述②T）：`invoke_api` tRPC 反射——新增实体 router 自动成为 Agent 能力；三源工具桥 + 并发分级 + 写串行调度；EventBus 驱动的缓存失效——新增 skill/MCP 配置热生效。

## 4.2 六条「差距线」（按修复性价比排序）


| 优先级 | 差距                                      | 现状证据                                                                                    | 建议动作                                                                                                                                                    | 成本            |
| -------- | ------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| **P0** | `AGENT_MAX_TOOL_CALLS_PER_RUN` 未强制执行 | config 有值 168，`runAgentLoop`/`runAgentLoopStream` 未检查（grep 仅 config/fixtures 引用） | 循环内加工具调用计数器，超限强制终轮（复用合成调用路径）                                                                                                    | 小时级          |
| **P0** | `memory_update` 缺失                      | 记忆仅 create/search/delete；矛盾事实共存                                                   | 加 update：软删旧版（versionMeta 链）+ 写新版 + FTS 同步；flush 提示词加「发现矛盾用 update」                                                               | 天级            |
| **P1** | 记忆检索无语义层与门控                    | FTS5 单段；strength/recency 存而不用；每消息必检索                                          | ①排序加权 = BM25 × (1+strength) × recency 衰减（零依赖）；②retrieve-or-not 门控：连续 N 轮无命中后降低检索频率；③中期可选 embedding 插件（本地小模型） | ①②天级 ③周级 |
| **P1** | 过期/矛盾/整合机制全缺                    | 无时间版本、无来源归因、无定期整合（综述①§7.3 四机制）                                    | Memory 加`validFrom/validTo/source` 字段；心跳加「记忆整合」周期任务（合并重复、退役过期）——复用心跳基建                                                  | 天级            |
| **P1** | 轨迹导出/效用评估缺失                     | Run 仅统计级；无开/关记忆 A/B                                                               | 定义 JSONL 轨迹格式（messages+toolCalls+results+timeline）；Mock LLM 下做「平台任务基准」断言；Run 表聚合面板                                               | 周级            |
| **P2** | 记忆分层/晋升未落地                       | 两层结构；L0–L5 在`memory-research-plan.md` 规划                                           | 按规划 S1→S2：常驻层（USER.md/AGENT.md 硬预算）→ 日记层 → Dreaming 晋升                                                                                  | 周级            |
| **P2** | 子 Agent 长任务无 todo/checkpoint         | 复杂任务靠 Swarm 拆分；单 Agent 长任务无自我管理                                            | 加`todo_write` 工具（学 Claude Code），状态入 ChatMessage.toolCalls，时间线可见                                                                             | 天级            |
| **P3** | MCP 仅 stdio、无 A2A、无本地模型          | 本地 stdio 够用；side LLM 走云端                                                            | 等跨进程/跨机需求实证再做；Ollama 作为 side 任务 provider 可先做                                                                                            | 按需            |

## 4.3 理念性取舍（不是差距，是定位）

- **不做参数化记忆/微调**：与「Markdown 为唯一事实源、可读可 diff」原则根本冲突；综述①也承认参数化路线 Governance 最差。
- **不做 Byzantine 容错/对等协作**：单用户可信域，三层层级 + 硬拦截已覆盖威胁模型。
- **不做容器级沙箱**：shell 直跑本机是单用户本地平台的有意简化；PRISM/SandboxEscapeBench 的警示在「未来开放多用户/远程」时才激活。
- **SQLite 即一切**（消息队列/事件日志/邮箱/缓存）：零外部依赖是项目宪法；`SWARM_MODE=redis` 已预留升级路径——恰是综述①「按数据证明再升级」建议的贯彻执行。

## 4.4 一页纸速查表


| 综述模块                 | 业界代表                              | KnowPilot 对应                                    | 水位   |
| -------------------------- | --------------------------------------- | --------------------------------------------------- | -------- |
| 记忆 write–manage–read | Mem0 四元 / A-MEM 进化 / MemGPT 分页  | 三路径写入 + flush 联动 + FTS 注入；**无 update** | B+     |
| 压缩抗漂移               | Claude Code micro/macro               | 三段式 + 摘要复用 + generation 边界               | **A-** |
| 检索增强                 | 向量+图+重排+门控                     | FTS5 单段，strength 未接线                        | C+     |
| 反思/经验                | Reflexion / ExpeL / Voyager           | 经验积累 +**prompt 进化**（独有）                 | B+     |
| 分层虚拟上下文           | MemGPT / MemoryOS                     | 两层，分层在规划                                  | C      |
| 策略学习/参数化          | AgeMem / LongMem                      | 无（理念放弃参数化）                              | —     |
| E 执行循环               | OpenHands 事件流 / Claude Code 长任务 | 双循环 + 合成终轮；预算未强制                     | B+     |
| T 工具注册表             | MCP 生态 / EASYTOOL                   | 三源桥 + 反射 + 并发分级                          | A-     |
| C 上下文管理器           | Claude Code / Aider repo map          | 压缩+注入+重建+可视化；无 repo map                | B+     |
| S 状态存储               | LangGraph checkpointer                | 双写续传 + 断开不 abort；无 time-travel           | **A-** |
| L 生命周期钩子           | AgentSpec / PRISM / AEGIS             | 四层防线 + argsMatch 审批                         | **A**  |
| V 评估接口               | HAL / SWE-bench 轨迹                  | 测试矩阵强；无轨迹导出                            | C+     |
| Profile                  | MetaGPT 角色卡 / Generative Agents    | 静态 profile +**tier 身份防冒充**                 | B+     |
| Planning                 | ToT / plan-and-execute / todo_write   | ReAct + Swarm 层级委托；无 todo                   | B-     |
| 多 Agent 协调            | AutoGen / MetaGPT                     | 三层 + 心跳 + 邮箱 + 防循环；概念更清晰           | B+     |
| 人机共生                 | （综述③未来方向）                    | 审批 + 队列 + 透明时间线 + 心跳主动性             | **A-** |

**总评**：按综述②的完整性矩阵，KnowPilot 达 5✓+1≈，与 Claude Code/OpenHands 同档；按综述①的三模式，是教科书级 Pattern B（插桩与矛盾处理待补）；按综述③的四模块，Memory/Action 强、Planning 弱、Profile 有独有改进。**最该立刻修的两个 P0：工具调用预算强制（小时级）+ memory_update（天级）。**

---

> **附录：关键实现路径索引**
> 后端：`apps/server/src/infra/`（agentRuntime.ts / agentStream.ts / agentTools.ts / nativeTools.ts / mcpClient.ts / skillRunner.ts / autoCompact.ts / memoryFlush.ts / agentEvolution.ts / sessionStreamHub.ts / swarmPermissionGuard.ts / swarmBus.ts / heartbeatEngine.ts / approvalGate.ts / asyncJobOrchestrator.ts / asyncJobManager.ts / llmClient.ts / chatHistory.ts / shellRunner.ts / credentialVault.ts）、`apps/server/src/services.ts`、`apps/server/src/router.ts`、`apps/server/prisma/schema.prisma`
> 共享：`packages/shared/src/constants.ts`（记忆 taxonomy）、`schemas.ts`
> 前端：`apps/web/lib/useSessionMessages.ts` / `useStreamLifecycle.ts` / `useSessionComposeState.ts`、`apps/web/components/chat.tsx` 及 chat* 组件族
> 配置：`config.yaml`（stream/compact）、`.env`（AGENT_MAX_TOOL_ROUNDS / LLM_DAILY_BUDGET / REQUIRE_APPROVAL / SWARM_MODE 等）
> 文档：`docs/development/`（design-decisions.md / chat-state-architecture.md / chat-scenario-states.md / concurrency.md / scenarios.md / memory-research-plan.md）
> 测试：`apps/server/src/__tests__/`（trpc / trpcSmoke / agentTools / nativeTools / skillRunner / mcpClient / chatHistory / async-task-queue / fts / auth）、`apps/web/e2e/`（chat-*-real / chat-*-mock / admin-pages / blog-smoke 等）
