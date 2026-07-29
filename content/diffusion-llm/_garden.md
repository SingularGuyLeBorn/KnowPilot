---
title: Diffusion LLM · 扩散语言模型
description: 从零理解扩散语言模型：为什么用扩散做语言生成、核心机制、代表性模型、与自回归 LLM 的对比
---
# Diffusion LLM · 扩散语言模型

> 面向有深度学习基础 + 自回归 LLM 常识，但没系统学过扩散模型的读者

## 阅读路径

🟢 **入门起点**

1. [为什么要用扩散做语言生成](./01-overview/why-diffusion.md)
   从自回归模型的推理延迟、反转诅咒、可控性三个局限出发，讲清扩散模型为语言生成带来的新可能。推荐先读。

🟡 **核心机制**

2. [离散扩散模型：从马尔可夫链到掩码预测](./02-mechanism/masked-diffusion.md)
   用转移矩阵定义离散扩散的前向/反向过程，推导 ELBO 训练目标，解释掩码扩散为何成为主流。

🔴 **模型与全景**

3. [代表性扩散语言模型一览](./03-models/representative-models.md)
   D3PM → Diffusion-LM → MDLM → SEDD → LLaDA → LLaDA 2.0，技术路线选择指南。

4. [LLaDA 与前沿进展](./03-models/llada-frontier.md)
   深入 LLaDA 系列的极简架构、三阶段转换训练、MoE 扩展，以及推理加速、扩散-AR 融合等未来方向。

⚖️ **对比与选型**

5. [扩散 vs 自回归：全面对比](./04-comparison/diffusion-vs-autoregressive.md)
   十个维度系统对比，含选型决策框架。文中嵌入 AR vs 扩散生成对比动画。

---

## 🎬 动画一览

| 动画名称 | 嵌入文章 | 说明 |
|---|---|---|
| `ArVsDiffusion` | [扩散 vs 自回归](./04-comparison/diffusion-vs-autoregressive.md) | 左右对比：AR 串行逐 token vs 扩散并行去噪 |
| `MaskedDiffusion` | [离散扩散机制](./02-mechanism/masked-diffusion.md) | 全 \[MASK\] → 逐步揭示 → 完整文本 |

两则动画均通过 `algo_viz_create` 注册，源码位于 `apps/algo-viz/src/compositions/`，可在 Remotion Studio 预览：

```bash
pnpm --filter @knowpilot/algo-viz dev
```

---

## 状态

- 创建：2025-07-29
- 文章：5 篇，全部 published
- 动画：2 则（`ArVsDiffusion` + `MaskedDiffusion`，已部署并嵌入文章）
- 阶段：初版可阅读
- 维护：Agent + knowledge-garden Skill
