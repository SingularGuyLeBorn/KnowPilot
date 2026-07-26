---
title: "扩散模型术语对照表（Glossary）"
category: "参考资料"
tags:
  - "glossary"
  - "terminology"
  - "diffusion"
  - "reference"
published: true
excerpt: "扩散模型领域常用术语速查手册，覆盖 DDPM、DDIM、LDM、CFG、LoRA、ControlNet、DiT、Sora 等关键概念。"
---
> **概述**：扩散模型领域常用术语速查手册。按字母排序，持续扩充中。适合阅读其他文章时对照查阅。

---

## A

| 术语 | 全称 / 原文 | 简要解释 |
|------|-------------|----------|
| **ADE** | Adaptive Diffusion Ensemble | 自适应扩散集成，用多个扩散模型组合提升质量 |
| **Ancestral Sampling** | — | DDPM 原始采样方式，每一步加入随机噪声 |
| **ADM** | Ablated Diffusion Model | OpenAI 的消融扩散模型，系统研究了引导/架构的影响 |

## C

| 术语 | 全称 / 原文 | 简要解释 |
|------|-------------|----------|
| **CFG** | Classifier-Free Guidance | 无分类器引导，训练时随机 drop 条件，推理时引导生成朝向条件 |
| **CLIP** | Contrastive Language-Image Pre-training | OpenAI 的图文对比学习模型，SD 用它做 text encoder |
| **Consistency Model** | — | 一种新范式，一步或多步直接把噪声映射到数据 |
| **ControlNet** | — | 给 SD 添加空间控制条件（边缘/深度/姿态）的网络结构 |
| **Conditioning** | — | 条件信息（文本、图像、类别标签等）引导生成方向 |

## D

| 术语 | 全称 / 原文 | 简要解释 |
|------|-------------|----------|
| **DDPM** | Denoising Diffusion Probabilistic Models | 去噪扩散概率模型，扩散模型的奠基性工作 |
| **DDIM** | Denoising Diffusion Implicit Models | 隐式扩散模型，确定性采样，可加速 10-50× |
| **DiT** | Diffusion Transformer | 用 Transformer 代替 U-Net 的扩散骨干 |
| **DPM-Solver** | Diffusion Probabilistic Model Solver | 基于 ODE 求解器的快速采样方法，可做到 10-20 步 |
| **Diffusion** | — | 通过逐步加噪和去噪生成数据的概率模型 |
| **DreamBooth** | — | 用少量图片微调扩散模型，学会生成特定主体 |

## F

| 术语 | 全称 / 原文 | 简要解释 |
|------|-------------|----------|
| **FID** | Fréchet Inception Distance | 最常用的生成质量评价指标，越低越好 |
| **Flow Matching** | — | Rectified Flow 的理论基础，用 ODE 配分匹配 |

## G

| 术语 | 全称 / 原文 | 简要解释 |
|------|-------------|----------|
| **Guidance Scale** | — | CFG 的引导强度，值越大越贴近条件、多样性越低 |

## I

| 术语 | 全称 / 原文 | 简要解释 |
|------|-------------|----------|
| **IP-Adapter** | Image Prompt Adapter | 以图像为 prompt 的适配器，不需微调即可做图生图 |

## L

| 术语 | 全称 / 原文 | 简要解释 |
|------|-------------|----------|
| **LDM** | Latent Diffusion Models | 潜扩散模型（Stable Diffusion 的基础），在 VAE 潜空间扩散 |
| **LCM** | Latent Consistency Model | 潜一致性模型，1-4 步完成采样 |
| **LoRA** | Low-Rank Adaptation | 低秩适配，用少量参数微调大模型（SD 中最常用） |
| **Langevin Dynamics** | — | 基于梯度 Langevin 采样的 MCMC 方法，NCSN 的核心 |

## N

| 术语 | 全称 / 原文 | 简要解释 |
|------|-------------|----------|
| **NCSN** | Noise Conditional Score Network | 噪声条件分数网络，分数匹配范式的开创工作 |
| **Noise Schedule** | — | 噪声调度，控制每一步加噪的多寡（线性/余弦/缩放线性等） |

## R

| 术语 | 全称 / 原文 | 简要解释 |
|------|-------------|----------|
| **Rectified Flow** | — | 矫正流，通过 ODE 直线化实现更快采样，Stable Diffusion 3 采用 |
| **Reverse Process** | — | 反向去噪过程，从噪声逐步恢复数据 |
| **Reparameterization Trick** | — | 重参数化技巧，让采样可微以训练神经网络 |

## S

| 术语 | 全称 / 原文 | 简要解释 |
|------|-------------|----------|
| **Score Matching** | — | 分数匹配，学习数据分布梯度的训练方法 |
| **Score SDE** | Score-Based Generative Modeling through SDEs | 用随机微分方程统一扩散与分数匹配 |
| **SDE** | Stochastic Differential Equation | 随机微分方程，扩散过程的连续形式 |
| **SNR** | Signal-to-Noise Ratio | 信噪比，控制每一步中信号与噪音的比例 |
| **Sora** | — | OpenAI 视频生成模型，基于 DiT + 时空 patch |
| **Stable Diffusion** | — | 基于 Latent Diffusion 的开源文生图模型（Stability AI） |

## U

| 术语 | 全称 / 原文 | 简要解释 |
|------|-------------|----------|
| **U-Net** | — | 扩散模型最常用的骨干网络，编码-解码结构 + 跳跃连接 |

## V

| 术语 | 全称 / 原文 | 简要解释 |
|------|-------------|----------|
| **VAE** | Variational Autoencoder | 变分自编码器，LDM 中用于压缩图像到潜空间 |
| **VQ-VAE** | Vector Quantized VAE | 矢量量化 VAE，DALL·E / VQDM 使用 |
| **VE / VP SDE** | Variance Exploding / Preserving SDE | 方差爆炸/保持型 SDE，NCSN 和 DDPM 对应的连续形式 |
| **VRAM** | — | 显存，训练/推理扩散模型的关键资源瓶颈 |

## 其他

| 术语 | 解释 |
|------|------|
| **777k** | 指 Stable Diffusion v1 训练用 256×256 图的 777k 步（一个梗） |
| **EMA** | Exponential Moving Average，训练时对模型参数做指数滑动平均 |
| **v-prediction** | 预测 $v = \alpha_t \epsilon - \sigma_t x_0$ 替代直接预测噪声，更稳定 |
| **x0-prediction** | 直接预测原始图像 $x_0$（也是常见设置） |

---

## 🧩 速查卡片（按层级分类）

```
Data Space  ←→  Latent Space
    ↓                 ↓
  DDPM             Stable Diffusion
  NCSN             LDM
                  SDXL / SD3
```

```
Sampling Speed:
  DDPM (1000步) → DDIM (50步) → DPM-Solver (20步) → LCM (2-4步) → Consistency (1步)
```

---

> **TODO**：此表持续扩充中。欢迎补充遗漏的术语！数学符号/公式版术语表后续考虑单独开篇。

