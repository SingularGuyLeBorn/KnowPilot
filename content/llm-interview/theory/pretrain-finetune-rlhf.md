---
title: 原理类：预训练、SFT 与 RLHF
category: null
published: true
excerpt: null
tags:
  - 原理
  - 预训练
  - SFT
  - RLHF
  - PPO
  - DPO
  - scaling-law
---
# 原理类：预训练、SFT 与 RLHF

> ⚠️ **时效性说明**：本专题区分"经典题"（2024 起持续有效）和"前沿题"（2025-2026 新增）。GRPO、Scaling Law 新趋势等已标注年份。
>
> **来源**：掘金、小林笔记、AgentGuide 面经、DeepSeek 技术报告

***

## 1. 预训练 → SFT → RLHF 三阶段的关系

* **元数据**：`{topic: "原理·训练流程", quality: ⭐⭐⭐⭐⭐, year: "2024-2026", difficulty: mid}`
* **来源**：掘金、AgentGuide

**三阶段定位**：

| 阶段   | 目标     | 数据        | 方法                    |
| ---- | ------ | --------- | --------------------- |
| 预训练  | 通用语言能力 | TB 级无标注语料 | Next Token Prediction |
| SFT  | 指令遵循   | 万级高质量对话   | 监督学习                  |
| RLHF | 价值观对齐  | 人类偏好排序    | PPO / DPO / GRPO      |

**面试高频追问**：
「RLHF 能不能跳过 SFT？」→ 不能。SFT 让模型学会"回答问题"的基本格式，否则 RLHF 的搜索空间太大，容易发散。

「为什么不把 RLHF 目标直接加进预训练？」→ 预训练目标是无监督的，RLHF 需要人类偏好信号，信号来源不同。

> ✅ **时效判断**：经典三阶段理论，2024 起持续有效。2025-2026 面试重点转向 RLHF 内部细节（PPO vs GRPO）。

***

## 2. RLHF 完整流程：Reward Model → PPO vs DPO vs GRPO

* **元数据**：`{topic: "原理·对齐", quality: ⭐⭐⭐⭐⭐, year: "2025-2026", difficulty: senior}`
* **来源**：掘金、DeepSeek 技术报告、小林笔记

**完整流程**：

```
Step 1: SFT 基座模型
Step 2: 人类标注 N 个回答排序 → 训练 Reward Model (pairwise preference)
Step 3: PPO — RM 打分，策略梯度优化；或 DPO — 直接优化偏好
```

**三大算法对比（2026 面试高频）**：

|       | PPO                           | DPO     | GRPO        |
| ----- | ----------------------------- | ------- | ----------- |
| 需要 RM | ✅ 是                           | ❌ 否     | ❌ 否         |
| 模型数   | 4（policy, value, reward, ref） | 2       | 2           |
| 内存占用  | 极高                            | 低       | 低           |
| 代表模型  | ChatGPT / GPT-4               | —       | DeepSeek R1 |
| 流行度   | 2024 主流                       | 2025 主流 | 2026 新星     |

**追问**：「GRPO 怎么做到不需要 RM 的？」→ 同一 prompt 生成一组回答，用组内相对分数（不是绝对打分）做奖励，类似群体比较。

> ✅ **时效判断**：2025-2026 面试热门。GRPO 因 DeepSeek R1 爆火，2026 年出现频率极高。

***

## 3. Scaling Law 的现状与挑战

* **元数据**：`{topic: "原理·理论", quality: ⭐⭐⭐⭐, year: "2024-2026", difficulty: mid}`
* **来源**：掘金、Chinchilla 论文

**经典结论**：

* OpenAI Scaling Law：参数/数据/算力等比增长 → 性能幂律提升
* Chinchilla Law：20 tokens / 参数是最优配比
* 2025 新共识：高质量数据比数量更重要

**2026 面试新方向**：

* 「Scaling Law 是否到顶？」→ 高质量文本数据枯竭，合成数据 + 推理时 scaling (test-time compute) 是新趋势
* 「o1 模型的 scaling 方式？」→ 推理时增加 thinking tokens → 性能提升，这是新的 scaling 维度

> ✅ **时效判断**：经典 Scaing Law 持续有效，2025-2026 新增"数据和推理时 scaling"讨论。

***

## 4. KV Cache 为什么能加速？Q 为什么不能 cache？

* **元数据**：`{topic: "原理·推理", quality: ⭐⭐⭐⭐⭐, year: "经典题·持续有效", difficulty: mid}`
* **来源**：AgentGuide 面经、林哥笔记

**核心理解**：

* 自回归生成时，token 的 K/V 只依赖历史 token，对所有未来位置不变 → **可复用**
* Q 是"当前要预测的位置"的 query，每次生成都不同 → **不可 cache**

**显存计算场景题**（2025-2026 高频）：
「Qwen-72B, batch=1, 输入 1024 token, FP16, KV Cache 需要多少显存？」
→ 约 72 层 × 2（K+V）× 1024 × d\_model(8192) × 2B ≈ 2.3 GB

> ✅ **时效判断**：经典高频题。2025-2026 新增显存计算场景题变种。

***

## 5. 涌现能力：现象与争议

* **元数据**：`{topic: "原理·现象", quality: ⭐⭐⭐, year: "2024-2025 高频→2026 热度下降", difficulty: junior}`
* **来源**：掘金

**主流解释**：

* 非线性指标：某些能力在参数阈值后跳升
* 数据覆盖理论：小模型记不住特定模式，大模型参数量足够
* **争议**：有人认为"涌现"只是评测指标的 artifact（离散指标的分辨率问题）

> ⚠️ **时效提示**：本题是 2024 年热门题。2026 年出现频率下降，面试官更倾向问"test-time compute scaling"或"o1 的思维链"。

***

## 6. 反转诅咒 (Reversal Curse)

* **元数据**：`{topic: "原理·缺陷", quality: ⭐⭐⭐⭐, year: "2025-2026", difficulty: mid}`
* **来源**：LLaDA 论文、知乎

**定义**：AR 模型从「A 是 B」学不到「B 是 A」—— 因果注意力的结构性缺陷。

**扩散模型为什么免疫？** 每步去噪时所有位置互相可见，不存在方向性。

**面试题**：「你能设计一个实验验证反转诅咒吗？」→ 训练数据含「姚明的妻子是叶莉」，测试「叶莉的丈夫是谁」。AR 模型答不出，扩散模型可以。

> ✅ **时效判断**：2025-2026 新热门题，扩散模型与 AR 对比的面试中高频出现。

***

## 来源汇总

* 掘金·大模型面试题讲解 — 预训练/SFT/RLHF 基础
* DeepSeek R1 技术报告 — GRPO
* AgentGuide 面经 — KV Cache、Reward Model 追问
* 小林笔记 — RLHF 流程图解
* LLaDA / 扩散模型论文 — 反转诅咒

**🔍 下次搜索关键词**：GRPO 算法伪代码、Reward Hacking 缓解方案、Test-time compute scaling 具体实现

