---
title: "为什么扩散模型适合语言建模？"
category: null
tags:
  - "diffusion-llm"
  - "motivation"
  - "comparison"
published: true
excerpt: "自回归模型统治了 NLP 多年，扩散模型凭什么挑战它？本文从可控性、非自回归生成、填补式生成、连续隐空间等角度分析扩散模型在语言域的独特优势与当前局限。"
---
# 为什么扩散模型适合语言建模？

## 概述

自回归（AR）语言模型（GPT 系列、Llama）通过「逐个预测下一个 token」统治了当代 NLP——简单、可扩展、在大量数据上表现惊艳。那么，为什么研究者还要费力把扩散模型搬到语言域？答案是：**自回归范式并非没有根本性局限，而扩散模型在某些维度提供了独特的优势**。

## 关键概念

- **自回归局限**：严格的从左到右单向依赖，无法利用「后文」信息；生成速度与序列长度线性相关；细粒度控制需要复杂 prompt engineering 或微调。
- **扩散优势来源**：非自回归、迭代精炼（iterate refinement）的生成过程，天然支持双向上下文和连续隐空间操作。

## AR 语言模型的三个根本局限

### 1. 单向生成——无回头路
AR 模型每个 token 生成后就不能再修改。想调整句子中间某个词？只能重新生成整个前缀。这导致：
- 难以做**文本改写/修补**（需专门设计架构如 Masked LM 或 Seq2Seq）
- 长文本的**全局一致性**控制困难

### 2. 细粒度可控生成需要复杂的工程
要控制 AR 模型输出的属性（情感、风格、句法结构），主流方法包括 prompt 工程、RLHF、或者训练属性专属适配器——都不是开箱即用的方案。梯度引导（classifier guidance）在 AR 模型上不自然。

### 3. 推理效率
生成 N 个 token 需要 N 次前向推理。虽然 KV-cache 等手段有所缓解，但本质上是串行的。

## 扩散模型带来的改变

### ✅ 可控性：梯度引导自然嵌入
扩散模型生成过程涉及一系列连续隐变量，每个去噪步都可以用**分类器的梯度**来引导生成方向。Diffusion-LM 利用这一特性，仅用一个简单的情感分类器的梯度就实现了细粒度的情感、句法结构控制——无需修改模型参数或重新训练。

> "The continuous, hierarchical nature of these intermediate variables enables a simple gradient-based algorithm to perform complex, controllable generation tasks." — Diffusion-LM 论文

### ✅ 非自回归与并行生成
扩散模型可以：
- 一次性确定所有 token 位置，然后多步迭代去噪
- 支持**任意长度的半自回归生成**（如 SSD-LM 的分块策略）
- 理论上可以训练出 1 步/少量步数生成的高质量模型

### ✅ 填补式生成（Infilling）天然支持
AR 模型做 infilling 需要双向注意力或特殊架构。扩散模型的正向过程天然支持任何位置的掩码，逆向去噪从任意上下文恢复文本——MDLM 等模型完全基于这一思想。

### ✅ 连续空间的代数操作
扩散模型的隐层是连续的，可以对向量做插值、算术运算（"国王 - 男人 + 女人"式的语义操作），这在离散 token 空间很难实现。

## 当前局限与挑战

| 挑战 | 说明 |
|------|------|
| **困惑度差距** | 即使在 MDLM 最优结果下，扩散模型在标准 LM 基准上的 perplexity 仍落后 AR 模型（尽管差距在快速缩小） |
| **推理速度** | 多步去噪（通常 50–1000 步）使得生成延迟高于单步 AR；但是步数压缩（distillation）正在解决这个问题 |
| **可扩展性** | AR 模型的 Scaling Law 已在大规模验证（GPT-3、Llama 等）；扩散 LLM 在超大规模下的行为尚未充分探索 |
| **工程生态** | AR 模型拥有成熟的训练/部署工具链（vLLM、TensorRT-LLM）；扩散 LLM 的工具链尚在早期 |

## 要点

1. **可控性是扩散 LLM 最独特的卖点**——它提供了一种无需微调、基于梯度的细粒度控制方式，AR 模型难以匹敌。
2. **非自回归+迭代精炼**的双重特性使扩散 LLM 在需要反复修改/精炼的场景（写作辅助、翻译校对）有天然优势。
3. **填补式生成**不需要架构修改——这对于代码生成、文本编辑等场景非常实用。
4. 当前最大的两个未知数是：**大规模扩展性**（能否通过 10 倍数据/参数量逼近或超越 AR 模型）和**推理效率优化**（能否将步数压缩到 4–8 步）。

## 来源

- [Diffusion-LM Improves Controllable Text Generation](https://arxiv.org/abs/2205.14217) — 展示了扩散模型在可控生成上的独特优势
- [SSD-LM: Semi-autoregressive Simplex-based Diffusion Language Model](https://arxiv.org/abs/2210.17432) — 半自回归扩散在生成质量上匹敌 AR 模型
- [MDLM: Simple and Effective Masked Diffusion Language Models](https://arxiv.org/abs/2406.07524) — 掩码扩散逼近 AR 困惑度，NeurIPS 2024
- [D3PM: Structured Denoising Diffusion Models in Discrete State-Spaces](https://arxiv.org/abs/2107.03006) — 离散空间扩散的开创工作

## 相关

- [[01-overview/what-is-diffusion-llm]]
- [[02-models/diffusion-lm]]
- [[04-frontier/diffusion-vs-ar]]
- [[04-frontier/scaling-diffusion-llm]]

## 待补充

- [ ] 定量对比表：扩散 LLM vs AR LLM 在可控生成任务上的具体指标
- [ ] 推理延迟对比（去噪步数 vs token/s）

