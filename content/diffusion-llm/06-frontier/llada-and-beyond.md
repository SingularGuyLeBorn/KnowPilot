---
title: "LLaDA 与最新进展"
category: null
tags:
  - "LLaDA"
  - "LLaDA2.0"
  - "frontier"
  - "scaling"
  - "MoE"
published: true
excerpt: "本文深入 LLaDA 系列——第一个在 8B/100B 规模证明扩散语言模型可行性的工作——解读其架构设计、训练策略、关键实验，并展望扩散语言模型的未来方向。"
---
# LLaDA 与最新进展

## 概述

如果说 D3PM 定义了离散扩散的数学语言、MDLM 简化了训练流程、SEDD 完善了理论，那么 LLaDA 系列就是那个把这一切**推到工程可行规模**的人。LLaDA（2025.02）首次在 8B 参数上证明扩散模型可以和 LLaMA3 正面竞争；LLaDA 2.0（2025.12）更进一步——不再从零训练，而是直接从已有 AR 模型**转换**出 100B 扩散模型，彻底改变了扩散语言模型的成本结构。本文深入这两个里程碑工作的核心设计，并展望未来方向。

## LLaDA：把 BERT 变成扩散模型

### 核心洞察

LLaDA 最天才的地方在于它几乎没有发明任何新东西——而是把一个众所周知的结论重新诠释了一遍：**BERT 的 Masked Language Modeling 就是扩散模型的单步特例**。

```text
BERT: 随机掩码 15% token → 一次性预测所有被掩 token
扩散: 随机掩码 → 逐步预测 → 继续掩码 → 继续预测 → ... → 全揭示

LLaDA 的做法：把 BERT 训练好，然后在推理时多步迭代去噪。
```

### 架构

LLaDA 的架构就是一个标准的 decoder-only Transformer，只做了两个改动：

1. **去掉 causal mask**：改为双向注意力（所有 token 互相可见）
2. **添加 timestep embedding**：让模型知道当前处于去噪的哪一步

除此之外，和 LLaMA 几乎一模一样——同样的 RoPE、同样的 SwiGLU FFN、同样的 RMSNorm。这意味着**现有的 LLM 训练基础设施几乎可以零成本复用**。

### 训练

LLaDA 8B 在 2.3T tokens 上使用掩码扩散目标训练，训练流程完全遵循预训练 + SFT 范式：

$$\mathcal{L} = -\mathbb{E}_{x, t} \left[ \sum_{i \in \mathcal{M}_t} \log p_\theta(x_i \mid x_{\setminus \mathcal{M}_t}, t) \right]$$

其中 M_t 是第 t 步被掩码的位置集合。t 越大，掩码比例越高；t=0 时不掩码。

### 关键实验结果

| Benchmark | LLaDA 8B | LLaMA3 8B | 差距 |
|---|---|---|---|
| MMLU (5-shot) | 62.3 | 65.0 | -2.7 |
| GSM8K (8-shot) | 54.8 | 53.0 | +1.8（！） |
| HumanEval | 38.4 | 41.5 | -3.1 |
| MATH | 18.4 | 16.0 | +2.4（！） |

最令人意外的是：LLaDA 在 GSM8K 和 MATH 上**反超**了 LLaMA3——这说明扩散模型的全局推理能力在某些任务上可能确有优势。

### 反转诅咒实验

LLaDA 设计了一个精巧的诗歌补全任务来证明其双向理解能力：

- 给定「床前明月光，___」→ AR 模型只能往后补；LLaDA 也能往前补
- 在 reversal poem 任务上，LLaDA 8B 超越 GPT-4o
- 原因：扩散每步都能看到全文，没有「前」与「后」的区别

## LLaDA 2.0：从 AR 模型「拖拽」出扩散模型

LLaDA 2.0 解决了一个核心痛点：**从头训练一个 100B 扩散模型太贵了**。它的方案是：直接把已有的 AR 模型转换成扩散模型。这种「知识继承」策略大幅降低了入门成本。

### 三阶段块级 WSD 训练

LLaDA 2.0 的核心创新是一个三阶段训练方案：

```text
阶段 1（Warm-up）：渐进增大 block size
  - 把文本分成小块，块内做扩散，块间顺序生成
  - block size 从 16 → 128 → 512 → 全序列

阶段 2（Stable）：全序列扩散
  - 在完整序列上做标准离散扩散训练
  - 这是最主要的训练阶段

阶段 3（Decay）：回到紧凑 block size
  - 为推理效率优化，回到较小 block
  - 让模型在推理时能以 block 为单位并行解码
```

这种渐进式策略让模型先学会在局部做扩散，再扩展到全局，最后优化到实用块大小——比直接全序列训练更稳定、更高效。

### 模型规格

LLaDA 2.0 发布了两款 MoE（混合专家）模型：

| 模型 | 总参数 | 激活参数 | 定位 |
|---|---|---|---|
| LLaDA 2.0-mini | 16B | ~4B | 轻量部署 |
| LLaDA 2.0-flash | 100B | ~20B | 前沿性能 |

两款模型均为 instruction-tuned（SFT + DPO），开箱即用。MoE 架构在扩散模型中尤其有意义——因为它天然并行，每个 token 可以路由到不同专家，进一步放大并行解码的效率优势。

## 推理效率的真实数字

LLaDA 2.0 的论文报告了令人印象深刻的推理效率：

- 相比同规模 AR 模型，**吞吐量提升 3-8×**（取决于 batch size 和生成长度）
- 在 100B 规模，单次前向传播约 50ms，64 步去噪总计约 3.2s——生成 128 token 仅需 3.2s，而 AR 模型需 128 次前向传播
- MoE 架构下，每个 token 实际激活参数仅 20B（100B 的 20%），单步计算更轻

## 未来方向

### 1. 推理加速

当前扩散模型仍需 32-256 步去噪，每步一次全模型前向。正在探索的方向包括：

- **蒸馏式加速**：用 teacher（256 步）蒸馏 student（8 步），类似图像扩散的 progressive distillation
- **一致性模型**：将扩散模型蒸馏为单步生成器
- **投机式去噪**：类似 AR 的 speculative decoding，用草稿模型预测几步后的状态

### 2. 扩散 + 自回归融合

最简单的融合：用扩散模型生成大纲/关键句子，再用小型 AR 模型填充连接词和修饰语。更深的融合包括混合架构——某些层 bidirectional，某些层 causal。

### 3. 多模态扩散语言模型

LLaDA 2.0 的论文已提到多模态扩展。离散扩散在跨模态对齐上有一个天然优势：文本和图像都可以离散化为 token（通过 VQ-VAE 等），然后在统一的离散扩散框架下联合建模。这比 AR 的「逐个 token 生成」在多模态场景下更自然（图像 token 天然是并行的）。

### 4. 长文本支持

块级扩散（block diffusion）是目前最有希望的方向：把长文本分成多个 block，block 间顺序、block 内并行扩散。LLaDA 2.0 的三阶段训练已为此打下基础。

## 来源

- [LLaDA: Large Language Diffusion Models (2025)](https://arxiv.org/abs/2502.09992) — 8B 扩散语言模型，本文核心实验数据与反转诅咒实验来源
- [LLaDA 2.0: Scaling Up Diffusion Language Models to 100B (2025)](https://arxiv.org/abs/2512.15745) — AR→扩散转换、三阶段训练、MoE 架构来源
- [LLaDA 项目主页](https://ml-gsai.github.io/LLaDA-demo/) — 在线 Demo 与模型权重
- [Awesome Diffusion Language Models](https://github.com/VILA-Lab/Awesome-DLMs) — 领域论文索引

## 相关

- [为什么要用扩散做语言生成](./01-overview/why-diffusion-for-language.md)
- [离散扩散模型：从马尔可夫链到掩码预测](./02-mechanism/discrete-diffusion.md)
- [代表性扩散语言模型一览](./04-models/representative-models.md)
- [扩散 vs 自回归：全面对比](./05-comparison/diffusion-vs-ar.md)

