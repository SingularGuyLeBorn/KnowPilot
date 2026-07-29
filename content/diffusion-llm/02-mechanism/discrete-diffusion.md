---
title: "离散扩散模型：从马尔可夫链到掩码预测"
category: null
tags:
  - "discrete-diffusion"
  - "mechanism"
  - "D3PM"
  - "MDLM"
  - "markov-chain"
published: true
excerpt: "本文从数学原理出发，逐步讲清离散扩散模型的核心机制：如何用马尔可夫转移矩阵在离散 token 空间定义扩散过程，反向去噪如何通过神经网络学习，以及掩码扩散为何成为当前主流方案。"
---
# 离散扩散模型：从马尔可夫链到掩码预测

## 概述

图像扩散模型的成功建立在连续空间上——像素值是 0-255 的实数，加高斯噪声、用神经网络预测噪声，一切在实数域内顺理成章。但语言 token 是离散的：词表 V 中的整数 ID，两个 token 之间没有天然的「距离」概念，高斯噪声无从加起。离散扩散模型（Discrete Diffusion Models）正是为解决这一根本矛盾而诞生。本文从马尔可夫链的基本定义出发，逐步推导离散扩散的前向/反向过程、训练目标，并解释为什么「掩码扩散」成了当前最有效的方案。

## 前向过程：从 token 到噪声

### 马尔可夫转移矩阵

在连续扩散中，前向过程是：

$$q(x_t \mid x_{t-1}) = \mathcal{N}(x_t; \sqrt{1-\beta_t}\, x_{t-1}, \beta_t I)$$

每次加一点高斯噪声。在离散空间中，我们用一个**转移矩阵** Q_t 替代高斯噪声：

$$q(x_t \mid x_{t-1}) = \text{Cat}(x_t; x_{t-1} Q_t)$$

其中 x_t 是一个 one-hot 向量（长度为 |V|），Q_t 是一个 |V| × |V| 的马尔可夫转移矩阵。Q_t[i, j] 表示 token i 跳转到 token j 的概率。经过 t 步，从 x_0 到 x_t 的累积转移为：

$$q(x_t \mid x_0) = \text{Cat}(x_t; x_0 \bar{Q}_t), \quad \bar{Q}_t = Q_1 Q_2 \cdots Q_t$$

关键是选择合适的 Q_t。不同选择对应不同的扩散策略：

| 策略 | Q_t 设计 | 特点 |
|---|---|---|
| **均匀扩散** | Q_t = (1-β_t)I + β_t · (1/|V|)11ᵀ | 每个 token 有 β_t 概率跳转到任意 token |
| **掩码扩散** | Q_t 包含一个特殊 [MASK] token，token 只能变为 [MASK] 或保持不变 | 最简单、效果最好，与 MLM 自然衔接 |
| **吸收态扩散** | 类似掩码但可以跳转到其他「吸收态」 | D3PM 中探索的多种结构 |

### 为什么掩码扩散胜出

掩码扩散（Masked Diffusion）的核心思想简单得令人意外：前向过程中，每个 token 以一定概率被替换为 [MASK]；经过足够多步后，整条序列变成全 [MASK]。反向过程就是逐步「揭开」掩码，恢复原始文本。

这与 BERT 的 MLM 训练有相同的数学形式——但有一个关键区别：MLM 一步到位地预测所有被掩 token，而扩散模型**多步迭代**地预测，每一步只恢复一部分 token。这正是 MDLM 和 LLaDA 的核心洞察：**MLM 是扩散模型的一步特例**。

## 反向过程：学习去噪

反向过程的目标是学习 p_θ(x_{t-1} | x_t)，即从噪声状态恢复一步。在离散扩散中，这个条件分布由神经网络参数化：

$$p_\theta(x_{t-1} \mid x_t) = \sum_{\tilde{x}_0} q(x_{t-1} \mid x_t, \tilde{x}_0) \, p_\theta(\tilde{x}_0 \mid x_t)$$

其中 p_θ(x̃_0 | x_t) 是神经网络对原始 token 的预测。这个公式的含义是：先让模型猜原始文本是什么，再根据扩散过程的后验从 x_t 退回 x_{t-1}。

训练目标是**变分下界（ELBO）**：

$$\mathcal{L} = \mathbb{E}_{q} \left[ -\log p_\theta(x_0 \mid x_1) + \sum_{t=2}^{T} D_{KL}(q(x_{t-1} \mid x_t, x_0) \parallel p_\theta(x_{t-1} \mid x_t)) \right]$$

在实践中，MDLM 发现一个更简洁的目标效果更好——直接让模型预测哪些位置应该是 [MASK]，并最小化交叉熵：

$$\mathcal{L}_{\text{MDLM}} = -\mathbb{E}_{x_0, t, x_t} \left[ \sum_{i: x_t^i = \text{[MASK]}} \log p_\theta(x_0^i \mid x_t) \right]$$

## 推理：迭代去噪的完整流程

推理时从全 [MASK] 序列出发，经过 T 步迭代生成。每一步：

```text
输入：当前序列 x_t（部分 token 已知，部分为 [MASK]）
1. 神经网络 f_θ 读入 x_t，输出所有 [MASK] 位置的 token 预测分布
2. 按一定策略选择部分位置「揭示」：将预测概率最高的 token 填入
3. 其余位置保持 [MASK] 留给后续步骤
输出：x_{t-1}（比 x_t 少了一些 [MASK]）
```

这个流程天然支持**并行解码**：每一步中所有 [MASK] 位置同时预测，不需要像 AR 那样串行。经过 T 步（通常 100-1000 步），所有 [MASK] 消失，文本生成完成。

SEDD 进一步引入 **score entropy** 作为训练目标，替代传统的 ELBO：

$$\mathcal{L}_{\text{SEDD}} = \mathbb{E}_{x_0, t, x_t} \left[ \sum_{i} s_\theta(x_t)^i_{x_t^i} + \frac{1}{1 - \bar{\alpha}_t} \mathbb{E}_{x_0^i \mid x_t^i} [s_\theta(x_t)^i_{x_0^i}] \right]$$

Score entropy 在理论上更优雅，直接对离散分布的对数概率梯度建模，绕过了 ELBO 中繁琐的 KL 散度计算。

## 与连续扩散的对比

| 维度 | 离散扩散 | 连续扩散 |
|---|---|---|
| 操作空间 | 直接在 token ID 上 | token 嵌入向量空间 |
| 噪声类型 | 转移矩阵 / 掩码 | 高斯噪声 |
| 是否需要 embedding | 否 | 需要，且去噪后需 argmax 映射回 token |
| 主流方案 | MDLM, SEDD, LLaDA | Diffusion-LM, Bit Diffusion |
| 当前趋势 | **占主导** | 较少使用 |

离散扩散直接操作 token，避免了「嵌入→加噪→去噪→映射回 token」中的信息损失，且与现有 Transformer 架构无缝衔接——LLaDA 的训练代码几乎就是 BERT 加了一个 timestep embedding。

## 来源

- [D3PM: Structured Denoising Diffusion Models in Discrete State-Spaces (NeurIPS 2021)](https://proceedings.neurips.cc/paper/2021/file/958c530554f78bcd8e97125b70e6973d-Paper.pdf) — 离散扩散的数学奠基，转移矩阵框架来源
- [MDLM: Simple and Effective Masked Diffusion Language Models (ICML 2023)](https://arxiv.org/abs/2306.08162) — 掩码扩散的简洁公式与训练目标来源
- [SEDD: Score Entropy Discrete Diffusion Models (ICML 2024)](https://arxiv.org/abs/2310.16834) — score entropy 训练目标来源
- [A Survey on Diffusion Language Models (2025)](https://arxiv.org/abs/2508.10875) — 本文框架归类参考

## 相关

- [为什么要用扩散做语言生成](./01-overview/why-diffusion-for-language.md)
- [代表性扩散语言模型一览](./04-models/representative-models.md)
- [扩散 vs 自回归：全面对比](./05-comparison/diffusion-vs-ar.md)

