---
title: "为什么要用扩散做语言生成"
category: null
tags:
  - "diffusion"
  - "language-model"
  - "overview"
  - "autoregressive"
  - "reversal-curse"
published: true
excerpt: "本文从自回归语言模型的三个结构性局限出发，解释扩散模型为语言生成带来的并行解码、双向理解与可控生成等新可能，并梳理从 D3PM 到 LLaDA 的关键里程碑。"
---
# 为什么要用扩散做语言生成

## 概述

自 ChatGPT 爆发以来，自回归（Autoregressive, AR）几乎成了语言模型的代名词：GPT、LLaMA、Claude、Gemini——全部逐个 token 从左到右生成。但 AR 并非唯一解。扩散模型（Diffusion Model）在图像生成领域已证明其强大能力，近年研究者将其迁移到文本领域，衍生出 Diffusion Language Model（DLM）这一新范式。本文回答一个核心问题：**为什么要把扩散模型用到语言生成上来？** 我们从 AR 的结构性短板出发，解释扩散模型的独特优势，并梳理从 D3PM 到 LLaDA 的关键里程碑。

## 自回归模型的三个结构性局限

### 1. 推理延迟：串行瓶颈

自回归模型的生成过程是天然的 O(n) 串行：生成第 i 个 token 必须等前 i-1 个全部计算完毕。

$$P(x) = \prod_{i=1}^{n} P_\theta(x_i \mid x_1, x_2, \dots, x_{i-1})$$

即使有 KV-cache 优化，每次前向传播依然无法并行。对于 128 token 的短文本，AR 模型需要 128 次串行前向；而扩散模型只需 T 步（通常 32-256 步）并行去噪就能一次性产出同等长度的文本。LLaDA 8B 的实验显示，在短文本生成场景下扩散模型比同规模 AR 模型快 2-8 倍。

### 2. 反转诅咒与单向上下文

自回归模型只能利用左侧的上下文。这导致一个著名问题——**反转诅咒（Reversal Curse）**：模型从「A 是 B」中学不到「B 是 A」。例如训练数据中出现过「姚明的妻子是叶莉」，模型很难推出「叶莉的丈夫是谁」。这是因果注意力（causal attention）的结构性缺陷，因为信息只能从前往后流。

扩散模型天然免疫此问题：每一步去噪时，所有位置都能看到彼此，不存在「前」与「后」的区分。LLaDA 论文中的诗歌补全实验证明，扩散模型可以同时从前后两个方向补全文本，而 GPT-4o 几乎只能往下续。

### 3. 可控生成困难

想让 AR 模型生成「包含五个给定关键词」或「第二段比第一段长 20%」的文本，通常需要复杂的 prompt engineering 或额外的 RLHF 训练。扩散模型则继承了图像扩散中的 guided generation 技术，可以在去噪过程中直接注入可微约束，无需再训练。

## 从图像扩散到语言扩散：核心挑战

图像扩散模型在连续像素空间上操作，加高斯噪声顺理成章。但语言 token 是离散的整数 ID，「加噪声」没有天然定义。这催生出两条技术路线：

| 路线 | 做法 | 代表工作 |
|---|---|---|
| **连续扩散** | 将 token 嵌入连续向量空间，在嵌入层加高斯噪声，去噪后映射回离散 token | Diffusion-LM (NeurIPS 2022) |
| **离散扩散** | 直接在离散 token 上定义扩散过程，用马尔可夫转移矩阵描述 token 间跳转 | D3PM (NeurIPS 2021), MDLM (ICML 2023), SEDD (ICML 2024), LLaDA (2025) |

离散扩散近年成为主流，因为它与 BERT 风格的 Masked Language Modeling 有天然的数学联系——LLaDA 的核心洞察就是「MLM 是扩散模型的单步特例」。想直观感受两种范式的生成过程差异？请跳转到[扩散 vs 自回归对比文](../04-comparison/diffusion-vs-autoregressive.md)观看动画。

## 关键里程碑

从 2021 到 2025，扩散语言模型走过了从「学术好奇」到「与 AR 正面竞争」的四年：

- **D3PM (NeurIPS 2021)**：最早在离散空间定义扩散过程，用马尔可夫转移矩阵替代高斯噪声
- **Diffusion-LM (NeurIPS 2022)**：走连续路线，展示可控文本生成优势
- **MDLM (ICML 2023)**：提出极简掩码扩散框架，达到当时最优困惑度
- **SEDD (ICML 2024)**：引入 score entropy 训练目标，理论更优、生成质量更高
- **LLaDA (2025)**：8B 规模上首个与 LLaMA3 8B 正面竞争的扩散模型，完整走通预训练 + SFT
- **LLaDA 2.0 (2025)**：扩展到 100B 参数，用 AR→扩散转换策略降低训练成本

## 扩散 vs 自回归：不是替代，是互补

| 维度 | 自回归 | 扩散 |
|---|---|---|
| 生成方向 | 单向（左→右） | 双向（全局） |
| 推理并行度 | 逐 token 串行 | 全序列并行 |
| 反转诅咒 | 存在 | 天然避免 |
| 训练效率 | 高（teacher forcing） | 需多步去噪 |
| 长文本 | 天然适配 | 当前挑战 |
| 成熟度 | 极度成熟 | 快速发展中 |

扩散模型不是 AR 的替代品，而是补充——不同场景选不同工具。

## 来源

- [A Survey on Diffusion Language Models (2025)](https://arxiv.org/abs/2508.10875) — 截至目前最全面的 DLM 综述，本文的技术路线分类与里程碑时间线主要参考此篇
- [LLaDA: Large Language Diffusion Models (2025)](https://arxiv.org/abs/2502.09992) — 8B 规模验证扩散语言模型可行性的工作，反转诅咒实验与 SFT 路线数据取自此篇
- [D3PM (NeurIPS 2021)](https://proceedings.neurips.cc/paper/2021/file/958c530554f78bcd8e97125b70e6973d-Paper.pdf) — 离散扩散的数学奠基，本文的转移矩阵与扩散策略分类来源

## 相关

- [离散扩散机制：从马尔可夫链到掩码预测](../02-mechanism/masked-diffusion.md)
- [代表性扩散语言模型一览](../03-models/representative-models.md)
- [扩散 vs 自回归：全面对比](../04-comparison/diffusion-vs-autoregressive.md)
