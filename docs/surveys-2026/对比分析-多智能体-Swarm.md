# 多智能体 / Swarm 组件级对比（KnowPilot × 综述 × 市面框架）

> 写作日期：2026-07-18  
> 依据：本地三篇综述（`docs/surveys-2026/`）+ 编排综述 *LLM-Based Multi-Agent Orchestration*（Preprints 202604.2147，截止 2026-03）+ 生产实践综述（Supervisor / Swarm / Pipeline / Hierarchical）+ KnowPilot 当前代码（含 Root Workspace / 行级槽 / 三通道父子通信）。  
> 姊妹文档：`对比分析-记忆-Harness-Agent.md`（记忆·Harness·单 Agent，2026-07-12，部分条目已被后续工单超越）。

---

## 0. 一句话定位

| 系统 | 拓扑（综述 taxonomy） | 定位 |
|---|---|---|
| **KnowPilot Swarm** | **Hierarchical**（固定 super→manager→sub）+ 局部 **Centralized**（Workspace 内 manager 编排） | 单用户、本地优先的「组织树 + 权限 OS」；Markdown 事实源 |
| LangGraph | Centralized / Hierarchical（supervisor + nested graph） | 生产态状态机 / 图编排 |
| CrewAI | Hierarchical（manager 动态委派）或角色 Crew | 角色叙事友好的快速组队 |
| AutoGen / MS Agent Framework | Decentralized 对话 / Dynamic speaker select | 对话式协作、代码共创 |
| MetaGPT / ChatDev | Hierarchical + **SOP 流水线** | 软件公司剧本、结构化中间产物 |
| OpenAI Agents SDK | Centralized（handoff / agent-as-tool） | 云端产品化编排 |
| Anthropic「lead + subagents」 | Centralized supervisor | 研究场景并行子代理（token 贵、可靠性靠 harness） |

KnowPilot **不是**「对等 Swarm / 群聊涌现」，也 **不是** MetaGPT 式 SOP 编译器；它是 **带 Workspace 边界的层级组织 + 生产级投递/槽位/HITL**。

---

## 1. 拓扑与组织模型

| 维度 | 市面 / 论文共识 | KnowPilot | 差异 |
|---|---|---|---|
| 协调拓扑 | 三拓扑：中心化 / 去中心化 / 层级；可加动态自适应轴（编排综述 §4） | 固定三 tier + Root/业务 Workspace | **有意不做**对等群聊与运行时拓扑学习（GPTSwarm / DyLAN） |
| 角色模型 | CrewAI backstory；MetaGPT 岗位卡；Generative Agents 人格 | `systemPrompt` + tier + tools + `buildTierIdentityHint` | 身份防冒充更强；缺角色卡库 / SOP 模板市场 |
| 组织边界 | 多数框架无「组织单元」 | Root + 业务 Workspace + `asyncSlotQuota` | **领先面**：空间=权限域+配额域 |
| 规模叙事 | >10–15 agent 需层级（编排综述） | 设计上对齐层级；默认单机 SQLite | 规模上限在进程/DB，非拓扑理论 |

**结论**：拓扑选型与「企业可分解任务」文献处方一致；与 AutoGen 群聊、CrewAI 对等委派是**产品哲学分叉**，不是漏实现。

---

## 2. 组件对照矩阵（逐项）

水位：A=生产级对齐或局部领先 · B=可用但有明显缺口 · C=弱/规划中 · —=理念不做

### 2.1 层级与 Profile

| | |
|---|---|
| 业界 | MetaGPT 岗位 SOP；CrewAI Role/Goal/Backstory；OpenAI handoff 转移所有权 vs as_tool 保留所有权 |
| KnowPilot | `super/manager/sub`；工厂模板；超级不可删/不可自降；manager 出域硬拦 |
| 水位 | **A-**（组织硬约束强于多数框架；缺 SOP 剧本库） |

### 2.2 Workspace / 隔离

| | |
|---|---|
| 业界 | 少见一等 Workspace；多靠 prompt「别越权」；企业方案偶有租户隔离 |
| KnowPilot | Root + 业务空间；`checkCrossWorkspace` / `checkWorkspaceAgentAccess`；向超级报告为出域白名单 |
| 水位 | **A**（开源 MAS 框架普遍缺失的 OS 边界） |
| 缺口 | 非容器/chroot 强隔离；文件仍靠 `safePath` |

### 2.3 通信与消息语义

| | |
|---|---|
| 业界 | 广播贵（编排综述）；MetaGPT pub-sub 降 token；A2A Agent Card；AutoGen 共享线程 |
| KnowPilot | 点对点 `AgentMessage` + 账本；**三通道刻意拆分**：superior 队列（父→子忙时）、`report_back`→Task 认领、`notify_parent`→父发送队列；depth/队列容量/向上时机硬拦 |
| 水位 | **A**（投递语义与通道分工清晰度高于 CrewAI/AutoGen 默认「聊到完」） |
| 缺口 | **无 A2A**；私有信封；无跨厂商发现 |

### 2.4 编排 / 派生 / 槽位

| | |
|---|---|
| 业界 | LangGraph 图边；CrewAI process；Anthropic 并行子代理（~15× token）；失败三模式：重复劳动 / 矛盾输出 / 不收敛 |
| KnowPilot | `SwarmOrchestrator.dispatch`；`spawn_subagent` sync/async；全局 LLM 池 + 行级 `asyncSlotQuota`；`slotClass=lightweight`；血缘槽继承防死锁；60s spawn 去重 |
| 水位 | **A-**（容量经济学与防死锁是差异化强项） |
| 缺口 | **无 DAG/工作流图**；无运行时重规划图（Magentic-One / conditional edges） |

### 2.5 权限 / HITL / 安全

| | |
|---|---|
| 业界 | Harness 综述 L 组件：多数多 Agent 框架 ≈；生产靠外挂网关；级联虚假共识论文显示框架对注入极脆弱 |
| KnowPilot | tier 工具矩阵 + Workspace 出域 + 审批 argsMatch + `awaiting_human` + 身份 hint + 子 Agent 工具裁剪 |
| 水位 | **A**（相对 AutoGen/CrewAI/MetaGPT 矩阵上的明显领先） |
| 缺口 | 默认审批开关可能关闭；无多用户 RBAC；无 Byzantine（单用户合理不做） |

### 2.6 记忆治理（多 Agent 视角）

| | |
|---|---|
| 业界 | 共享世界 + 私有流（Generative Agents）；编排综述强调 hybrid memory；记忆综述开放挑战「多 Agent 记忆治理」 |
| KnowPilot | `global` / `workspace:{id}` / `agent:{id}` 三层 scope + 写硬拦；经验可双写 workspace |
| 水位 | **B+**（比「全池共享」已进步；仍非协商式黑板 / 向量混合） |
| 缺口 | 检索仍偏 FTS；缺矛盾消解/`memory_update`；缺「共享产物工件」一等模型（MetaGPT 式文档接力） |

### 2.7 自主性 / 心跳

| | |
|---|---|
| 业界 | 多为「一次 crew run」；少见常驻 cron Agent；主动性属综述③未来方向 |
| KnowPilot | per-Agent cron 心跳 + 预算门 + 熔断持久化 + LoopContract 证据门 |
| 水位 | **A-**（产品级主动性稀缺） |
| 缺口 | LoopContract 主要服务心跳超级；非通用多目标调度市场 |

### 2.8 规划 / 反思 / 重规划

| | |
|---|---|
| 业界 | ToT/LATS/TOOLLLM；MetaGPT 结构化中间件；Reflexion；动态拓扑 GPTSwarm |
| KnowPilot | ReAct + 可选 critic（默认关）+ 层级委托替代单 Agent 长规划 |
| 水位 | **B-** |
| 缺口 | 无 todo/checkpoint；无 SOP；无搜索式规划；反思默认关 |

### 2.9 工具 / MCP / Skills

| | |
|---|---|
| 业界 | MCP=agent↔tool 事实层；工具枚举 vs CodeAct |
| KnowPilot | native 分域 + Skill 沙箱 + MCP stdio + 断路器 + tRPC `invoke_api` 反射 |
| 水位 | **A-** |
| 缺口 | MCP 远程/OAuth 薄；轨迹→可执行 Skill 闭环未完成 |

### 2.10 状态 / 流式 / UI 不变量

| | |
|---|---|
| 业界 | LangGraph checkpointer；多数框架无一等 Chat 状态机 |
| KnowPilot | SessionStreamHub 双写；三层 store + Stream commit 不变量；父子队列 SSE |
| 水位 | **A**（产品 UI 正确性深度远超研究框架） |

### 2.11 故障恢复 / 可重入

| | |
|---|---|
| 业界 | 框架差异大；编排综述强调 failure-recovery 轴；生产要 at-least-once 语义 |
| KnowPilot | 启动恢复四动作；`reentrant`+重试账本；投递 CLAIM+reconciler；会话手动 resume |
| 水位 | **A-** |
| 缺口 | 无细粒度 checkpoint；无多副本选主 |

### 2.12 协议互操作

| | |
|---|---|
| 业界 | MCP ⊕ A2A 分层；ACP–A2A 收敛趋势；ANP 去中心发现 |
| KnowPilot | MCP ✅ · A2A ❌ · 私有 SwarmBus |
| 水位 | **C+**（本地单域合理；跨产品联协作短板） |

### 2.13 评估 / 可观测

| | |
|---|---|
| 业界 | 编排综述六维协调质量；MASEval；AgencyBench；级联感染实验 |
| KnowPilot | Run phase + SSE + 右栏任务看板 + 正确性测试（Vitest/E2E）强 |
| 水位 | **B-**（系统正确性 A，任务效能/协调质量指标 C） |
| 缺口 | 无协作质量基准；无轨迹导出评测 harness；无「开/关记忆」A/B |

### 2.14 Harness 六元组对照（综述②）

沿用旧文结论并更新：

| 组件 | KnowPilot | vs 典型多 Agent 框架 |
|---|---|---|
| E 执行循环 | ReAct + Run 生命周期 | 同档或更好 |
| T 工具 | 三源 + 反射 | **更强** |
| C 上下文 | 压缩+注入 | 中上 |
| S 状态 | 双写+队列 | **更强** |
| L 生命周期/权限 | tier+审批+出域 | **显著更强** |
| V 评估 | 测试矩阵 | **更弱**（框架也普遍弱） |

---

## 3. 与「生产四模式」对照

| 模式 | 含义 | KnowPilot 是否覆盖 |
|---|---|---|
| Supervisor | 单协调者派专家 | ✅ 超级 / Workspace manager |
| Hierarchical | 多层委派 | ✅ 三 tier 核心 |
| Pipeline | 顺序阶段产物 | ⚠️ 可手写 prompt 模拟；**无一等 SOP/工件接力** |
| Peer Swarm | 对等协商 | ❌ 有意不做（威胁模型与成本） |

生产侧共识：**编排（orchestration）存活率高于无约束协作**；KnowPilot 站在编排侧，与 Anthropic lead+subagents、LangGraph supervisor 同族，与「自由群聊 Swarm」不同义。

---

## 4. 三大经典失败模式 × KnowPilot 防护

编排综述指出无编排层时的三失败：

| 失败 | 市面常见 | KnowPilot 对策 | 仍存风险 |
|---|---|---|---|
| 任务重复 | 多 agent 同解一题 | spawn 60s 去重；池配额；superior FIFO | LLM 仍可能重复派语义不同任务 |
| 矛盾输出 | 共享前提不一致 | Workspace 记忆 scope；审批；report_back 单通道结果 | 缺结构化工件版本/矛盾消解 |
| 不收敛 | 循环委托/空转 | depth 上限；向上时机；LoopContract；工具预算 | 单 Agent 长任务缺 todo；反思默认关 |

级联虚假共识（hub 注入 → 全系统感染）论文对 LangGraph/CrewAI 等极残酷——KnowPilot 的 **出域硬拦 + 身份 hint + 非广播拓扑** 降低感染面，但**未做**专门治理层（论文中的 defense 模块）。

---

## 5. 相对市面的「领先 / 持平 / 落后」清单

### 领先（建议守住）

1. **Workspace 作为权限+配额单元**（含 Root、行级槽）  
2. **父子三通道语义**（过程 / 结果 / 忙时队列）+ 投递账本/对账  
3. **运行时权限深度**（tier × 出域 × 审批 × 身份）  
4. **Chat/流式状态机纪律**（产品级，非 demo）  
5. **心跳主动性 × HITL × 预算** 三角  

### 持平

- ReAct 主循环、MCP 工具面、压缩抗漂移、弹性 LLM 客户端  
- 层级委托替代部分规划（与 MetaGPT「分工」同思路、不同载体）  

### 落后（按性价比）

| 优先级 | 缺口 | 为何综述/市场在乎 | 建议 |
|---|---|---|---|
| P0 | 协作/任务效能评估与轨迹导出 | V 组件；无法证明 Swarm「更值」 | Mock 平台任务基准 + JSONL 轨迹 |
| P1 | 结构化中间产物 / 轻量 SOP | MetaGPT 降幻觉与 token 的核心 | 「阶段工件」实体或约定 Markdown 接力 |
| P1 | 单 Agent 长任务 todo/checkpoint | Claude Code / 规划综述 | `todo_write` 工具 |
| P1 | 记忆 update + 矛盾/过期 | 多 Agent 记忆治理 | 见记忆对比文 P0/P1 |
| P2 | 动态重规划 / 条件边 | LangGraph / Magentic-One | 仅在证据证明 ReAct+层级不够时再做 |
| P2 | A2A | 跨产品 Agent 互联 | 有外部 Agent 需求再做 |
| P3 | 学习型拓扑 / 对等 Swarm | GPTSwarm 等 | **理念不做**（成本与威胁模型） |

---

## 6. 与本地三篇综述的交叉索引

| 综述 | 对 Swarm 最相关的论断 | KnowPilot 落点 |
|---|---|---|
| ① 记忆 | 多 Agent 需协调层记忆；Pattern B→C | workspace/agent scope=B+；分层晋升仍弱 |
| ② Harness | 多 Agent 框架常缺 C/S/L/V；可靠性在 harness | L/S 强；V 弱；与 Claude Code 同档完整性 |
| ③ Agent | 规模化协作 + 人机共生未来方向 | 层级+心跳覆盖协作骨架；HITL+队列覆盖共生 |
| 编排综述（外部） | 三拓扑+协议栈+六维评估 | 层级选型正确；协议/评估两短板 |

---

## 7. 总评

KnowPilot Swarm 在 **2026 生产编排光谱**里，属于：

> **Hierarchical + Supervisor（Workspace 内）+ 强 L/S harness 的本地个人 OS**  
> 而不是 MetaGPT 流水线，也不是 AutoGen 群聊，更不是去中心 A2A 联邦。

- 若目标是「可靠地让超级派活、空间内管理员带队、子代理交付可审计」——**当前架构与文献处方一致，若干组件领先开源框架**。  
- 若目标是「软件公司自动流水线 / 跨厂商 Agent 市场 / 学术协调质量榜」——差距集中在 **SOP 工件、A2A、评估 V、规划搜索** 四条，而不是再叠一层对等 Swarm。

**下一步最划算的三条**（只改 Swarm 相关）：① 平台协作任务基准+轨迹；② 阶段工件或轻量 SOP；③ 子 Agent `todo_write`。记忆侧 P0（`memory_update`）见姊妹文档，与 Swarm 共享记忆治理短板。

---

## 附录 A · 本地综述文件

| 文件 | 用途 |
|---|---|
| `memory-survey-2026-arxiv2603.07670.pdf` | 记忆机制与多 Agent 记忆挑战 |
| `harness-survey-2026-meng-et-al.pdf` | Harness 六元组；多 Agent 框架完整性矩阵 |
| `agent-survey-2026-chowa-springer.pdf` | Agent 总览；框架与未来方向（本机 PDF 曾损坏无法 pdftotext，结论援引自既有对比文 + DOI） |
| `对比分析-记忆-Harness-Agent.md` | 记忆/Harness/单 Agent 深挖（2026-07-12） |
| 本文 | Swarm / MAS 组件深挖（2026-07-18） |

## 附录 B · 建议增补阅读（未强制入库）

- *LLM-Based Multi-Agent Orchestration…*（Preprints 202604.2147）— 拓扑 taxonomy + 框架/协议对比  
- Anthropic multi-agent research 工程笔记 — lead+subagents 成本与适用边界  
- 「From Spark to Fire」级联感染 — 为何广播/弱治理危险  
