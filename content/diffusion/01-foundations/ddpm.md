---
title: "DDPM 原理与推导"
category: "基础理论"
tags:
  - "diffusion"
  - "DDPM"
  - "foundations"
published: true
excerpt: "Denoising Diffusion Probabilistic Models：前向加噪、反向去噪与简化训练目标的推导提纲。"
---

> 本文是路线图中「详细推导」入口。骨架已就位，后续可继续展开完整证明与代码对照。

## 1. 问题设定

我们希望学习数据分布 $q(x_0)$。DDPM 通过一条 **马尔可夫加噪链** 把 $x_0$ 变成近高斯噪声，再学习 **反向去噪链** 从噪声还原样本。

## 2. 前向过程

固定方差日程 $\{\beta_t\}_{t=1}^{T}$，令 $\alpha_t = 1-\beta_t$，$\bar\alpha_t = \prod_{s=1}^{t}\alpha_s$：

$$
q(x_t \mid x_{t-1}) = \mathcal{N}\big(x_t;\ \sqrt{\alpha_t}\,x_{t-1},\ \beta_t I\big)
$$

闭式重参数化：

$$
x_t = \sqrt{\bar\alpha_t}\, x_0 + \sqrt{1 - \bar\alpha_t}\,\epsilon,\quad \epsilon\sim\mathcal{N}(0,I)
$$

## 3. 反向过程与训练目标

反向用参数化高斯 $p_\theta(x_{t-1}\mid x_t)$。Ho et al. 证明可把变分下界简化为 **噪声预测** 损失：

$$
\mathcal{L} = \mathbb{E}_{t,x_0,\epsilon}\left[ \|\epsilon - \epsilon_\theta(x_t, t)\|^2 \right]
$$

网络 $\epsilon_\theta$ 通常是 U-Net，输入带噪图与时间步嵌入。

## 4. 采样

从 $x_T\sim\mathcal{N}(0,I)$ 出发，逐步用预测噪声估计均值，迭代得到 $x_0$。后续加速见 DDIM / DPM-Solver / LCM（见[路线图](./roadmap)）。

## 5. 下一步阅读

- [扩散模型路线图](./roadmap)
- [术语对照表](../glossary)

## TODO

- [ ] 完整 ELBO 推导
- [ ] $\beta$ 日程选择（linear / cosine）
- [ ] 与分数匹配（Score Matching）的关系
- [ ] 最小可运行训练伪代码
