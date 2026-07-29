---
title: "LLaDA 与前沿进展：从 8B 到 100B 的扩散语言模型"
category: null
tags:
  - "LLaDA"
  - "LLaDA2.0"
  - "MoE"
  - "frontier"
  - "scaling"
published: true
excerpt: "本文深入 LLaDA 系列的核心设计——掩码扩散、AR→扩散转换、三阶段训练与 MoE——并展望推理加速、扩散-AR 融合、长文本支持等未来方向。"
---
# LLaDA 与前沿进展：从 8B 到 100B 的扩散语言模型

## 概述

LLaDA 是扩散语言模型领域最重要的里程碑之一：**它证明了扩散模型在 8B 级别可以和 LLaMA3 正面竞争，在 100B 级别依然可扩展。** 本文深入 LLaDA 的核心设计——从"BERT + timestep"的极简架构到三阶段 AR→扩散转换训练——并梳理推理加速、扩散-AR 融合、多模态扩展等未来方向。

## LLaDA 的核心设计

### 架构：BERT + timestep

LLaDA 的架构是标准的 decoder-only Transformer，只做了两处改动：

1. **去掉 causal mask**：改为双向注意力（所有 token 互相可见）
2. **添加 timestep embedding**：让模型知道当前处于去噪的哪一步

除此之外，和 LLaMA 几乎一样——同样的 RoPE、SwiGLU FFN、RMSNorm。

训练目标是在被掩码位置上计算交叉熵：

$$\mathcal{L} = -\mathbb{E}_{x, t} \left[ \sum_{i \in \mathcal{M}_t} \log p_\theta(x_i \mid x_{\setminus \mathcal{M}_t}, t) \right]$$

其中 M_t 是第 t 步被掩码的位置集合。t 越大，掩码比例越高；t=0 时不掩码。

### 关键结果

| Benchmark | LLaDA 8B | LLaMA3 8B |
|---|---|---|
| MMLU (5-shot) | 62.3 | 65.0 |
| GSM8K (8-shot) | 54.8 | 53.0 |
| HumanEval | 38.4 | 41.5 |

LLaDA 在 GSM8K 上反超 LLaMA3——说明扩散模型的全局推理在某些任务上确有优势。

### 反转诅咒实验

LLaDA 设计了一个诗歌补全任务：给定"床前明月光，___"，GPT-4o 只能往下续；LLaDA 同样可以往前补全。原因：扩散每步都能看到全文，没有"前"与"后"的区别。

## LLaDA 2.0：从 AR 模型转换

LLaDA 2.0 的核心创新是**知识继承**——直接从已有 AR 模型转换出扩散模型，大幅降低训练成本。

### 三阶段块级 WSD 训练

```text
阶段 1（Warm-up）：渐进增大 block size（16→128→512→全序列）
阶段 2（Stable）：全序列扩散训练
阶段 3（Decay）：回到紧凑 block size，优化推理效率
```

### 模型规格

| 模型 | 总参数 | 激活参数 | 架构 |
|---|---|---|---|
| LLaDA 2.0-mini | 16B | ~4B | MoE |
| LLaDA 2.0-flash | 100B | ~20B | MoE |

相比同规模 AR 模型，吞吐量提升 **3-8×**。

## 未来方向

**1. 推理加速**：当前扩散需 32-256 步去噪。蒸馏式加速（8 步）、一致性模型（单步）、投机式去噪等正在探索中。

**2. 扩散 + AR 融合**：最直接的方案——用扩散生成大纲/关键句子，AR 填充连接词和修饰语。更深层的混合架构：某些层 bidirectional，某些层 causal。

**3. 多模态扩展**：LLaDA 2.0 已提到多模态。文本和图像都可离散化为 token，在统一的离散扩散框架下联合建模——比 AR 的"逐个 token 生成"在多模态场景下更自然。

**4. 长文本支持**：块级扩散（block diffusion）是最有希望的方向——长文本分成 block，block 间顺序、block 内并行扩散。

## 来源

- [LLaDA: Large Language Diffusion Models (2025)](https://arxiv.org/abs/2502.09992) — 8B 扩散语言模型，本文架构设计与 benchmark 数据来源
- [LLaDA 2.0: Scaling Up Diffusion Language Models to 100B (2025)](https://arxiv.org/abs/2512.15745) — AR→扩散转换、三阶段训练、MoE 架构与推理效率数据来源
- [Awesome Diffusion Language Models](https://github.com/VILA-Lab/Awesome-DLMs) — 领域论文索引，未来方向参考

## 相关

- [为什么要用扩散做语言生成](../01-overview/why-diffusion.md)
- [离散扩散模型：从马尔可夫链到掩码预测](../02-mechanism/masked-diffusion.md)
- [代表性扩散语言模型一览](./representative-models.md)
- [扩散 vs 自回归：全面对比](../04-comparison/diffusion-vs-autoregressive.md)
