---
title: "代表性扩散语言模型一览"
category: null
tags:
  - "models"
  - "D3PM"
  - "Diffusion-LM"
  - "MDLM"
  - "SEDD"
  - "LLaDA"
  - "survey"
published: true
excerpt: "本文按时间线梳理扩散语言模型的关键工作，从 D3PM 的离散扩散奠基到 LLaDA 2.0 的 100B 规模验证，帮助读者建立领域全景图并理解每条技术路线。"
---
# 代表性扩散语言模型一览

## 概述

扩散语言模型从 2021 年的 D3PM 到 2025 年的 LLaDA 2.0，四年间跨越了从"学术好奇"到"100B 级验证"的巨大鸿沟。本文按时间线梳理每个关键工作的核心创新与历史定位，帮助读者在读完前两篇的"为什么"和"怎么做"之后，建立完整的领域全景图。

## 时间线总览

| 时间 | 工作 | 路线 | 关键贡献 |
|---|---|---|---|
| 2021 | D3PM | 离散 | 转移矩阵框架奠基 |
| 2022 | Diffusion-LM | 连续 | 可控文本生成 |
| 2023 | MDLM | 离散 | 掩码扩散简化，最优困惑度 |
| 2024 | SEDD | 离散 | Score entropy 训练目标 |
| 2025.02 | LLaDA | 离散 | 8B 规模验证，对标 LLaMA3 |
| 2025.12 | LLaDA 2.0 | 离散 | 100B 规模，AR→扩散转换 |

## D3PM（NeurIPS 2021）：离散扩散的数学奠基

**作者**：Jacob Austin, Daniel D. Johnson, Jonathan Ho, Daniel Tarlow, Rianne van den Berg（Google Brain / DeepMind）

D3PM（Structured Denoising Diffusion Models in Discrete State-Spaces）是第一个系统地将 DDPM 推广到离散空间的框架。核心创新是用马尔可夫转移矩阵 Q_t 替代高斯噪声，在离散状态空间上定义了完整的前向/反向过程。作者探索了均匀转移、吸收态（即掩码）、离散化高斯等多种 Q_t 设计。D3PM 在当时生成质量远不如自回归模型，但它建立了离散扩散的数学语言——后续 MDLM、SEDD、LLaDA 都站在它的框架之上。

## Diffusion-LM（NeurIPS 2022）：连续路线的代表作

**作者**：Xiang Lisa Li, John Thickstun, Ishaan Gulrajani, Percy Liang, Tatsunori B. Hashimoto（Stanford）

Diffusion-LM 走了一条不同路线：先把离散 token 映射到连续嵌入向量，在嵌入空间做标准高斯扩散，去噪后再通过一个 learned rounding 步骤映射回离散 token。虽然在生成质量上不如同期 AR 模型，但它在**可控生成**上展示了扩散模型的独特优势——通过 classifier guidance 可以精确控制文本的情感、主题等属性。这种"推理时注入约束"的能力是 AR 模型难以做到的。

## MDLM（ICML 2023）：掩码扩散的极简胜利

**作者**：Subham Sekhar Sahoo, Marianne Arriola, Yair Schiff 等

MDLM（Masked Diffusion Language Model）做了一个关键简化：前向过程只需要一种转移——变成 [MASK]。反向时模型预测哪些 [MASK] 位置该恢复成什么 token。这个简化带来了三个好处：

1. **训练极简**：目标函数就是被掩位置上的交叉熵，几乎与 BERT 的 MLM 一致
2. **效果极好**：在同等参数量下达到了当时扩散模型的最佳困惑度（perplexity）
3. **概念清晰**：扩散的"噪声"就是"不知道"，去噪就是"逐渐知道"

MDLM 还提出了 top-p 掩码调度策略：每步只揭示高置信度位置，其余保持 [MASK]。这比均匀随机揭示效率更高。

## SEDD（ICML 2024）：Score Entropy 的理论突破

**作者**：Aaron Lou, Chenlin Meng, Stefano Ermon（Stanford）

SEDD（Score Entropy Discrete Diffusion）从连续扩散的 score matching 理论中获得灵感，为离散扩散提出了一个新的训练目标——score entropy。相比传统的 ELBO，score entropy 直接对离散概率分布建模，避免了繁琐的 KL 散度计算。实验上 SEDD 将扩散语言模型的困惑度降低了 25-75%，生成质量显著提升，在相近参数规模下能与自回归模型正面竞争。

## LLaDA（2025）：8B 规模验证的里程碑

**作者**：Shen Nie 等（中国人民大学 GSAI 实验室）

LLaDA（Large Language Diffusion with mAsking）是第一个在 8B 参数规模上与主流 AR 模型正面竞争的扩散模型。它的核心设计异常简洁：架构就是 decoder-only Transformer + timestep embedding（去掉 causal mask），训练目标就是带 timestep 条件的 MLM。LLaDA 8B 在 MMLU、GSM8K、HumanEval 等 benchmark 上与 LLaMA3 8B 不相上下，还展示了 GPT-4o 都做不到的"双向诗歌补全"能力。

## LLaDA 2.0（2025）：100B 扩展

LLaDA 2.0 解决了"从头训练 100B 扩散模型太贵"的问题——它直接从已有 AR 模型转换而来，使用三阶段块级 WSD 训练策略（渐进 block → 全序列 → 紧凑 block），并采用 MoE 架构。最终得到两款模型：LLaDA 2.0-mini（16B 总参数，~4B 激活）和 LLaDA 2.0-flash（100B 总参数，~20B 激活）。相比同规模 AR 模型，吞吐量提升 3-8 倍。

## 路线选择指南

| 场景 | 推荐路线 |
|---|---|
| 文本生成，想与现有 LLM 生态接轨 | 离散扩散（MDLM / LLaDA 路线） |
| 可控生成，需注入可微约束 | 连续扩散（Diffusion-LM 路线） |
| 刚入门，想快速跑通实验 | 掩码扩散（代码 ≈ BERT + timestep） |

## 来源

- [D3PM (NeurIPS 2021)](https://proceedings.neurips.cc/paper/2021/file/958c530554f78bcd8e97125b70e6973d-Paper.pdf) — 离散扩散数学奠基，转移矩阵框架来源
- [Diffusion-LM (NeurIPS 2022)](https://arxiv.org/abs/2205.14217) — 连续路线可控文本生成，classifier guidance 来源
- [MDLM (ICML 2023)](https://arxiv.org/abs/2306.08162) — 掩码扩散框架与 top-p 调度来源
- [SEDD (ICML 2024)](https://arxiv.org/abs/2310.16834) — score entropy 训练目标，困惑度降低 25-75% 数据来源
- [LLaDA (2025)](https://arxiv.org/abs/2502.09992) — 8B 规模验证，benchmark 对比数据来源
- [LLaDA 2.0 (2025)](https://arxiv.org/abs/2512.15745) — AR→扩散转换，三阶段训练，MoE 架构来源

## 相关

- [为什么要用扩散做语言生成](../01-overview/why-diffusion.md)
- [离散扩散模型：从马尔可夫链到掩码预测](../02-mechanism/masked-diffusion.md)
- [扩散 vs 自回归：全面对比](../04-comparison/diffusion-vs-autoregressive.md)
- [LLaDA 与最新进展](./llada-frontier.md)
