---
title: "应用类：RAG、Agent 与工具调用"
category: null
tags:
  - "应用"
  - "RAG"
  - "Agent"
  - "ReAct"
  - "MCP"
  - "A2A"
  - "工具调用"
published: true
excerpt: null
---
# 应用类：RAG、Agent 与工具调用

> ⚠️ **时效性说明**：本专题是 2025-2026 面试增长最快的领域。MCP/A2A 协议 2025 年才提出，2026 成必问。纯 RAG 基础题已不够，需理解 Agentic RAG、Multi-Agent 编排。
>
> **来源**：小林面试题、AgentGuide 面经、知乎面经汇总、掘金、Google A2A 白皮书

---

## 1. RAG 完整流程与关键设计决策

- **元数据**：`{topic: "应用·RAG", quality: ⭐⭐⭐⭐⭐, year: "经典题·持续有效", difficulty: mid}`
- **来源**：AgentGuide 面经、掘金

**标准流程**：
```
Query → Embedding → 向量检索 (Top-K) → 重排序 (Reranker) → Prompt 拼接 → LLM 生成
```

**面试必问的三个决策点**：
1. **Chunk 策略**：固定大小（256-512 tokens）vs 语义分割 vs 递归分割？→ 取决于文档类型和技术文档兼顾
2. **检索方式**：纯向量 vs Hybrid Search（向量 + BM25）→ BM25 对精确关键词匹配更好
3. **时间衰减处理**：score = sim(q, d)·(1 - λ·Δt) 或按时间窗口过滤

> ✅ **时效判断**：RAG 基础流程是持续有效的经典题。2025-2026 新增"Chunk 策略选型"和"时间衰减"细节追问。

---

## 2. Agentic RAG：单次检索不够时怎么办

- **元数据**：`{topic: "应用·RAG·进阶", quality: ⭐⭐⭐⭐⭐, year: "2025-2026", difficulty: senior}`
- **来源**：小林笔记、知乎面经

**RAG 的两个致命短板**（面试必点）：
1. **多步推理**：需要 A→B→C 的推理链时，单次检索无法串联
2. **跨文档交叉**：信息在多个文档中要对比时

**解决方案 — Agentic RAG**：
```
Query → [循环] 检索 → 推理 → 判断信息是否足够 → 不够则再检索
```
- Self-RAG：模型自己判断是否需要检索
- Corrective RAG：对检索结果打分，低分触发重检索

**追问**：「Agentic RAG 和 Multi-Hop QA 有什么区别？」→ Multi-Hop 是问题分解，Agentic RAG 是模型自主决策检索时机和次数。

> ✅ **时效判断**：2025-2026 面试热门，RAG 方向最常被追问的进阶题。

---

## 3. ReAct 框架：Think → Act → Observe

- **元数据**：`{topic: "应用·Agent", quality: ⭐⭐⭐⭐⭐, year: "2025-2026", difficulty: mid}`
- **来源**：小林笔记、知乎面经

**ReAct (Reasoning + Acting)** 核心循环：
```
Thought: 我需要查天气 → 应该调用 weather API
Action: call weather_api(location="北京")
Observation: {"temp": 28, "condition": "晴"}
Thought: 北京今天 28°C，晴 → 可以建议用户去户外
Final Answer: 北京今天天气晴朗，28°C，适合户外活动
```

**面试追问**：
- 「ReAct 和 Plan-then-Execute 的区别？」→ ReAct 边想边做，Plan-then-Execute 先全部规划再执行。ReAct 更灵活，但可能无限循环
- 「无限循环怎么解决？」→ 最大轮次限制 + 超时 + 人工兜底

> ✅ **时效判断**：Agent 面试核心题。2025-2026 新增 A2A 和 MCP 后常结合提问。

---

## 4. Tool Calling (Function Calling) 工程化

- **元数据**：`{topic: "应用·Agent", quality: ⭐⭐⭐⭐⭐, year: "2025-2026", difficulty: mid~senior}`
- **来源**：小林笔记、AgentGuide

**三种实现方式**：
1. **原生 FC** (OpenAI/Claude) — 模型输出 JSON schema，系统执行
2. **结构化输出** — 约束输出格式（JSON Mode）
3. **代码生成** — 让模型写代码并执行（最危险最灵活）

**面试高频问题**：
- 「工具调用失控怎么兜底？」→ 最大调用次数 + 单次超时 + 权限分级 + 人工审批
- 「模型选错工具怎么办？」→ 提升工具描述质量（instruction + example） + 微调 FC 数据
- 「并行 vs 串行调用？」→ 不依赖的工具并行；依赖关系明确的串行

> ✅ **时效判断**：2025-2026 每个 Agent 岗必问。特别关注"失控兜底"的工程方案。

---

## 5. MCP (Model Context Protocol) 协议

- **元数据**：`{topic: "应用·Agent·前沿", quality: ⭐⭐⭐⭐⭐, year: "2025-2026 新题", difficulty: senior}`
- **来源**：小林笔记、Anthropic MCP 文档

**核心思想**：统一 LLM 与外部工具的接口协议。类比"AI 世界的 USB 接口"。

**架构**：
```
LLM ↔ MCP Client ↔ MCP Server (工具 / 数据源 / 数据库)
```

**面试追问**：
- 「MCP 和 Function Calling 的关系？」→ FC 是模型 API 的升级；MCP 是更通用的协议层，FC 可以跑在 MCP 之上
- 「MCP 的 Server 可以做什么？」→ 文件系统、数据库、API 网关、搜索引擎等
- 「自定义 MCP 需要什么？」→ 实现 MCP 协议的 Server 端接口 + JSON Schema 描述

> ✅ **时效判断**：2025 年提出，2026 年已成面试高频题。Anthropic + OpenAI 都支持，行业趋势。

---

## 6. A2A (Agent-to-Agent) 协议

- **元数据**：`{topic: "应用·Agent·前沿", quality: ⭐⭐⭐⭐, year: "2025-2026 新题", difficulty: senior}`
- **来源**：小林笔记、Google A2A 白皮书

**Google 提出的 Agent 间通信协议**，解决"不同 Agent 系统怎么协作"的问题。

**MCP vs A2A**（2026 面试新题）：
| | MCP | A2A |
|---|---|---|
| 连接对象 | Agent → 工具 | Agent → Agent |
| 角色 | Agent 的外设接口 | Agent 的社交协议 |
| 提出方 | Anthropic | Google |

**追问**：「MCP 和 A2A 能共存吗？」→ 可以。A2A 协调各 Agent，MCP 让每个 Agent 获取工具能力。两者不是替代关系。

> ✅ **时效判断**：2026 年面试新题，关注 Agent 方向的同学建议重点准备。

---

## 7. LangChain Memory 组件设计

- **元数据**：`{topic: "应用·Agent·工程", quality: ⭐⭐⭐, year: "2024-2025 → 2026 热度下降", difficulty: junior}`
- **来源**：小林笔记

**类型**：
- Buffer Memory：完整历史（简单但 token 暴涨）
- Summary Memory：压缩摘要（信息有损）
- Vector Store Memory：检索式（需要 embedding 模型）
- **混合策略**：短窗口用 Buffer，长对话用 Summary

> ⚠️ **时效提示**：LangChain 的 Memory 组件在 2025 年后被 MCP/A2A 等新话题抢了风头。建议把时间留给 MCP/A2A 等新协议。

---

## 来源汇总

- 小林面试题（xiaolinnote.com）— Agent 框架、MCP/A2A 图解（615 张手绘）
- AgentGuide 面经 — RAG 流程、知识图谱 Agent 面试追问
- 掘金·大模型面试题讲解 — RAG 整体流程
- 知乎面经汇总 — Agent 元年趋势、A2A 协议动态
- Anthropic MCP 文档 / Google A2A 白皮书

**🔍 下次搜索关键词**：Agentic RAG 实现案例、Multi-Agent 编排器模式、Tool Calling 微调数据构造方法
