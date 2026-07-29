---
title: LLM · Agent 面试题集
description: 每日搜索大模型（LLM）与 AI Agent 方向的高质量面试题，按专题分类并标注时效性/难度/质量评级
---
# LLM · Agent 面试题集

> 每日搜索大模型与 AI Agent 方向新更新的面试题，按专题分类入库。**每道题均标注元数据**：质量评级、时效性（年份+是否仍有效）、难度等级。

---

## 📊 质量评级体系

| 评级 | 含义 | 来源特征 |
|---|---|---|
| ⭐⭐⭐⭐⭐ | 大厂真实面经，完整轮次+追问 | AgentGuide、牛客大厂面经 |
| ⭐⭐⭐⭐ | 系统性题库，有答案有图解 | 小林笔记、掘金、cnblogs |
| ⭐⭐⭐ | 有参考价值但不完整 | 单篇博客、片段 |
| ❌ | 教程/广告/过时 → 已过滤 | 菜鸟教程、CSDN 拼凑文 |

## 📅 时效性标签

| 标签 | 含义 |
|---|---|
| `"经典题·持续有效"` | 2024 起每年都问的基础题 |
| `"2024-2026"` | 有效期内 |
| `"2025-2026"` | 这两年高频 |
| `"2025-2026新题"` | 近一年才出现的新题（MCP/A2A/MLA） |
| `"2026热度下降"` | 曾经热门，但现在面试官不太问了 |

---

## 📚 当前题库（2026-07-29 首轮）

| 分类 | 文章 | 题数 | 时效 | 质量 |
|---|---|---|---|---|
| 🟦 **算法** | [Transformer 与注意力机制](./algorithm/transformer-and-attention.md) | 6 | 经典~2026 | ⭐⭐⭐⭐⭐ |
| 🟩 **原理** | [预训练、SFT 与 RLHF](./theory/pretrain-finetune-rlhf.md) | 6 | 经典~2026 | ⭐⭐⭐⭐⭐ |
| 🟧 **工程** | [分布式训练、LoRA 与推理部署](./engineering/distributed-and-deployment.md) | 6 | 经典~2026 | ⭐⭐⭐⭐⭐ |
| 🟥 **应用** | [RAG、Agent 与工具调用](./application/rag-and-agent.md) | 7 | 2025-2026 | ⭐⭐⭐⭐⭐ |
| 🔴 **面经** | [大厂真实面经案例集](./comprehensive/real-cases.md) | 15+ | 2025-2026 | ⭐⭐⭐⭐⭐ |

**总计：40+ 题，全部带元数据**

### 🔜 下次搜索补充方向

| 缺口 | 建议关键词 |
|---|---|
| 🈳 FlashAttention 源码细节 | `FlashAttention tiling IO complexity` |
| 🈳 DeepSeek MoE 细粒度专家 | `DeepSeek MoE fine-grained expert` |
| 🈳 Test-time compute scaling | `o1 thinking token scaling` |
| 🈳 多模态模型面试题 | `MLLM interview VLM` |

---

## 📥 如何新增题目

每个入库条目格式：

```markdown
## N. 题目名称
- **元数据**：`{topic: "分类·子类", quality: ⭐⭐⭐⭐⭐, year: "2025-2026", difficulty: mid}`
- **来源**：XXX
<!-- 答案内容 -->
```

---

**维护**：Agent 每日搜索 → 过滤质量+时效 → 分类入库 → 更新首页
