---
title: "为什么要用扩散做语言生成"
category: null
tags:
  - "diffusion"
  - "language-model"
  - "overview"
  - "autoregressive"
  - "LLM"
published: true
excerpt: "本文回答「为什么要把扩散模型用于语言生成」：自回归 LLM 在推理延迟、双向上下文、反转诅咒等方面存在结构性局限，而扩散模型以并行迭代去噪的方式提供了根本不同的解法，并能与现有 LLM 生态互补。"
---
# 为什么要用扩散做语言生成

## 概述

自 2022 年底 ChatGPT 引爆大语言模型革命以来，「语言模型 = 自回归（Autoregressive）」几乎成了共识。GPT 系列、LLaMA、Claude、Gemini——无一例外地逐个 token 生成文本，用前文预测后文，像一条单向流水线。但这是唯一的道路吗？本文从自回归模型的结构性局限出发，解释为什么研究者正在认真对待一个看似「跨界」的方案——把图像生成领域大放异彩的**扩散模型（Diffusion Model）**搬到语言生成中来。我们会看到：扩散不止是图像的工具；在语言问题上，它提供了并行生成、双向上下文、可控性等自回归难以企及的优势——而近年 LLaDA、MDLM、SEDD 等工作已证明这条路走得通。

## 自回归模型的三个结构性局限

自回归语言模型的生成方式是逐 token 从左到右：

$$P(x) = \prod_{i=1}^{n} P_\theta(x_i \mid x_1, x_2, \dots, x_{i-1})$$

这一定义简洁优雅，训练时可以用 teacher forcing 并行计算所有位置的 loss。但在推理时，它暴露出三个问题：

### 1. 推理延迟：串行瓶颈

生成 n 个 token 需要 n 次前向传播。即使有了 KV-cache 等优化，每次前向传播仍然无法并行化，因为第 i 个 token 的生成必须等前 i-1 个 token 全部算完。当序列变长或模型变大时，这个 O(n) 的串行瓶颈变得非常突出。扩散模型则天然支持并行生成：所有位置同时去噪，多步迭代后一次性产出整段文本。

### 2. 单向上下文与「反转诅咒」

自回归模型只能利用左侧上下文。对于需要双向理解的任务（填空、改写、纠错、翻译），模型必须把所有信息编码进单向的 hidden state 中，效率低下。一个著名的症状是**反转诅咒（Reversal Curse）**：模型知道「A 是 B」，却推不出「B 是 A」。LLaDA 论文中用一个诗歌补全实验展示了扩散模型天然不受此限——因为在每一步去噪时，所有位置都能看到彼此的信息。

### 3. 可控生成困难

想要让自回归模型生成「包含五个特定关键词」或「第二段比第一段长 20%」的文本，通常需要复杂的 prompt engineering 或额外的 classifier guidance。扩散模型则继承了图像扩散领域成熟的 guided generation 方法，可以在去噪过程中注入约束，实现更精细的可控生成。

## 扩散模型做语言：核心直觉

扩散模型的基本思路是：**先破坏，再重建。** 训练时，在前向过程中逐步向数据添加噪声，直到变成纯噪声；反向过程中学习如何从噪声恢复出原始数据。推理时，从纯噪声出发，逐步去噪，最终生成一个样本。

这一流程在图像上非常自然——像素是连续值，加高斯噪声顺理成章。但语言是**离散的**——token 是词典中的整数 ID，不能直接加高斯噪声。这是扩散模型迁移到语言领域的核心挑战，也由此分化出两条技术路线：

| 路线 | 做法 | 代表工作 |
|---|---|---|
| **连续扩散** | 先将离散 token 嵌入连续向量空间，在嵌入层加噪声，去噪后再映射回离散 token | Diffusion-LM (2022), Bit Diffusion |
| **离散扩散** | 直接在离散 token 上定义扩散过程，用转移矩阵描述 token 之间的跳转概率 | D3PM (2021), MDLM (2023), SEDD (2024), LLaDA (2025) |

离散扩散近年逐渐成为主流，因为它更直接地处理语言的离散本质，且与 BERT 风格的 masked language modeling 有天然的数学联系——LLaDA 正是利用了「掩码即扩散」这一洞察，把 MLM 重新诠释为离散扩散的特例。

## 关键里程碑

从 2021 年至今，扩散语言模型经历了从「学术好奇」到「可与 AR 竞争」的跃迁：

- **D3PM (NeurIPS 2021)**：最早在离散空间系统定义扩散过程，用马尔可夫转移矩阵替代高斯噪声，覆盖了均匀噪声、掩码等多种扩散策略
- **Diffusion-LM (NeurIPS 2022)**：走连续路线，在嵌入空间加噪声，展示了 diffusion 在可控文本生成上的独特优势
- **MDLM (ICML 2023)**：提出简洁的掩码扩散框架，将离散扩散简化为「随机掩码→预测被掩 token」，实现了当时最优的 perplexity
- **SEDD (ICML 2024)**：引入 score entropy 作为离散扩散的训练目标，理论更优美，生成质量显著提升
- **LLaDA (2025)**：第一个在 8B 规模上与 LLaMA3 8B 正面竞争的扩散语言模型，完整走通预训练 + SFT 路线，证明扩散模型也能做 instruction following
- **LLaDA 2.0 (2025)**：将扩散语言模型扩展到 100B 参数，进一步验证可扩展性

## 扩散 vs 自回归：不是替代，是互补

把扩散模型视为「自回归杀手」是误解。更准确的理解是：它们是**两种不同的生成范式**，各有擅长：

| 维度 | 自回归 (AR) | 扩散 (Diffusion) |
|---|---|---|
| 生成方向 | 单向（左→右） | 双向（全局） |
| 推理并行度 | 逐 token 串行 | 全序列并行去噪 |
| 反转诅咒 | 存在 | 天然避免 |
| 训练效率 | 高（teacher forcing） | 需多步加噪/去噪 |
| 长文本 | 天然适配 | 目前仍是挑战 |
| 可控生成 | 困难 | 自然支持 guided generation |
| 成熟度 | 极度成熟 | 快速发展中 |

实际上，两者的关系更像是 Transformer 时代 CNN 与 Attention 的关系——不同任务选不同工具，甚至可以在同一个系统中融合两者优势。

## 来源

- [A Survey on Diffusion Language Models (2025)](https://arxiv.org/abs/2508.10875) — 截至目前最全面的 DLM 综述，本文的路线分类与里程碑主要来自此篇
- [LLaDA: Large Language Diffusion Models (2025)](https://arxiv.org/abs/2502.09992) — 第一个在 8B 规模证明扩散语言模型可行性的工作，反转诅咒实验与 SFT 路线来自此篇
- [Diffusion Language Models: The New Paradigm (HuggingFace Blog)](https://huggingface.co/blog/ProCreations/diffusion-language-model) — 面向大众的入门介绍，本文的「先破坏再重建」直觉来自此篇
- [D3PM (NeurIPS 2021)](https://proceedings.neurips.cc/paper/2021/file/958c530554f78bcd8e97125b70e6973d-Paper.pdf) — 离散扩散的开山之作，转移矩阵框架来自此篇

## 相关

- [离散扩散模型：从马尔可夫链到掩码预测](./02-mechanism/discrete-diffusion.md)
- [代表性扩散语言模型一览](./04-models/representative-models.md)
- [扩散 vs 自回归：全面对比](./05-comparison/diffusion-vs-ar.md)

