---
title: "离散扩散模型：从马尔可夫链到掩码预测"
category: null
tags:
  - "discrete-diffusion"
  - "mechanism"
  - "masked-diffusion"
  - "D3PM"
  - "MDLM"
published: true
excerpt: "本文从马尔可夫转移矩阵出发，逐步推导离散扩散模型的前向加噪、反向去噪与训练目标，并解释掩码扩散为何成为当前主流方案。"
---
# 离散扩散模型：从马尔可夫链到掩码预测

## 概述

图像扩散模型在连续像素空间上操作，加高斯噪声顺理成章。但语言 token 是离散的整数 ID，两个 token 之间没有连续的"距离"概念。离散扩散模型（Discrete Diffusion Model）通过马尔可夫转移矩阵替代高斯噪声，在离散 token 空间上定义了完整的扩散过程。本文从转移矩阵出发，推导前向加噪、反向去噪与训练目标，并解释为什么掩码扩散成了当前最有效、最简洁的方案。

> 下方动画直观展示了掩码扩散的去噪过程：从全 [MASK] 出发，每步并行揭示一批 token，逐步还原为完整文本。

```viz
composition: MaskedDiffusion
title: 掩码扩散去噪过程
text: "床前明月光，疑是地上霜"
steps: 6
```

## 前向过程：用转移矩阵代替高斯噪声

在连续扩散中，前向过程是每步加少量高斯噪声：

$$q(x_t \mid x_{t-1}) = \mathcal{N}(x_t; \sqrt{1-\beta_t}\, x_{t-1}, \beta_t I)$$

离散扩散用一个 **转移矩阵 Q_t** 来替代它。设 x_t 为 one-hot 向量（长度 = 词表大小 |V|），Q_t 是一个 |V| × |V| 的马尔可夫矩阵，其中 Q_t[i, j] 表示 token i 跳转到 token j 的概率：

$$q(x_t \mid x_{t-1}) = \text{Cat}(x_t; \, x_{t-1} Q_t)$$

经过 t 步，从 x_0 到 x_t 的累积转移为：

$$q(x_t \mid x_0) = \text{Cat}(x_t; \, x_0 \bar{Q}_t), \quad \bar{Q}_t = Q_1 Q_2 \cdots Q_t$$

不同 Q_t 的设计对应不同的扩散策略：

| 策略 | Q_t 设计 | 特点 |
|---|---|---|
| **均匀扩散** | Q_t = (1-β_t)I + β_t · (1/|V|)11ᵀ | 每个 token 有 β_t 概率跳转为任意 token |
| **吸收态扩散（掩码）** | Q_t 含一个 [MASK] 吸收态，token 要么保持原样，要么变 [MASK] | 最简单、效果最好 |
| **离散化高斯** | 利用 token embedding 的余弦距离定义跳转概率 | 计算复杂，效果一般 |

## 掩码扩散：为什么它胜出

掩码扩散（Masked Diffusion）的核心思想极简：前向过程中，每个 token 以一定概率被替换为特殊 token [MASK]；经过足够多步，整个序列变成全 [MASK]。反向过程就是逐步"揭开"掩码，恢复原始文本。上方动画展示了这个完整过程。

这与 BERT 的 Masked Language Modeling 有相同的数学形式——但有一个关键区别：

> **BERT 是一步到位预测所有被掩 token，而扩散模型多步迭代地预测，每一步只恢复一部分。**

MDLM（2023）的核心洞察是：MLM 的交叉熵目标等价于扩散模型 ELBO 的单步近似。把单步扩展为多步，就得到了扩散模型。

## 反向过程与训练目标

反向过程学习 p_θ(x_{t-1} | x_t)，即从噪声状态退一步。在离散扩散中，这通过神经网络预测原始 token 来实现：

$$p_\theta(x_{t-1} \mid x_t) = \sum_{\tilde{x}_0} q(x_{t-1} \mid x_t, \tilde{x}_0) \, p_\theta(\tilde{x}_0 \mid x_t)$$

先让模型猜原始文本是什么，再根据扩散的后验概率从 x_t 退回 x_{t-1}。

训练目标（变分下界 ELBO）：

$$\mathcal{L} = \mathbb{E}_q \left[ -\log p_\theta(x_0 \mid x_1) + \sum_{t=2}^{T} D_{KL}(q(x_{t-1} \mid x_t, x_0) \parallel p_\theta(x_{t-1} \mid x_t)) \right]$$

MDLM 发现一个更简洁的目标：

$$\mathcal{L}_{\text{MDLM}} = -\mathbb{E}_{x_0, t, x_t} \left[ \sum_{i: x_t^i = \text{[MASK]}} \log p_\theta(x_0^i \mid x_t) \right]$$

即只在被掩码的位置上计算交叉熵——与 BERT 的 MLM 完全一致，仅仅多了一个 timestep 条件。

## 推理：逐步去噪的伪代码

从全 [MASK] 序列出发，迭代 T 步：

```text
输入：序列长度 n, 步数 T, 神经网络 f_θ

x ← [MASK, MASK, ..., MASK]  # 全掩码初始化

for t = T down to 1:
    logits ← f_θ(x, t)              # 所有位置同时预测
    confs ← max(softmax(logits))    # 每个位置的置信度
    k ← schedule(t)                 # 本轮揭示数量（调度函数）
    indices ← top_k(confs, k)       # 选置信度最高的 k 个位置
    for i in indices:
        x[i] ← argmax(logits[i])    # 揭示：填入预测的 token
    # 其余位置保持 [MASK]

输出：x  # 完整文本序列
```

top-p 掩码调度是关键：高置信度位置先揭示，低置信度位置留到后续步骤。这比随机揭示效率高得多。

## 离散扩散 vs 连续扩散

| 维度 | 离散扩散 | 连续扩散 |
|---|---|---|
| 操作空间 | 直接在 token ID 上 | token 嵌入向量空间 |
| 噪声类型 | 马尔可夫转移矩阵 / 掩码 | 高斯噪声 |
| 是否需要嵌入层 | 否 | 需要，去噪后需 argmax 映射回 token |
| 主流方案 | MDLM, SEDD, LLaDA | Diffusion-LM |
| 当前地位 | 占主导 | 较少使用 |

离散扩散直接操作 token，避免了"嵌入→加噪→去噪→映射回 token"中的信息损失，与现有 Transformer 架构无缝衔接——LLaDA 的训练代码几乎就是 BERT 加一个 timestep embedding。

## 来源

- [D3PM: Structured Denoising Diffusion Models in Discrete State-Spaces (NeurIPS 2021)](https://proceedings.neurips.cc/paper/2021/file/958c530554f78bcd8e97125b70e6973d-Paper.pdf) — 离散扩散的数学奠基，本文的 Q_t 转移矩阵定义和"均匀/吸收态/离散化高斯"分类来源
- [MDLM: Simple and Effective Masked Diffusion Language Models (2024)](https://arxiv.org/abs/2306.08162) — 掩码扩散框架与简洁交叉熵目标来源，本文的 top-p 调度伪代码参考其实现
- [LLaDA: Large Language Diffusion Models (2025)](https://arxiv.org/abs/2502.09992) — 通过 LLaDA 的"BERT + timestep"设计佐证离散扩散的简洁性

## 相关

- [为什么要用扩散做语言生成](../01-overview/why-diffusion.md)
- [代表性扩散语言模型一览](../03-models/representative-models.md)
- [扩散 vs 自回归：全面对比](../04-comparison/diffusion-vs-autoregressive.md)
