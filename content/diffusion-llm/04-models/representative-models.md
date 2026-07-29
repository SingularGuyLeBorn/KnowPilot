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
excerpt: "本文按时间线梳理扩散语言模型的关键工作：从 D3PM 的离散扩散奠基，到 Diffusion-LM 的连续路线，再到 MDLM/SEDD 的理论精进，最终到 LLaDA 与 LLaDA 2.0 的大规模验证，帮助读者建立领域全景图。"
---
# 代表性扩散语言模型一览

## 概述

扩散语言模型从 2021 年的学术探索到 2025 年 8B/100B 级别的大规模验证，短短四年间经历了从「玩具」到「竞争者」的跃迁。本文按时间线梳理每个关键工作的核心思想、创新点与历史意义，帮助读者在读完前两篇的「为什么」和「怎么做」之后，建立对整个领域发展脉络的全景认知。

## 时间线总览

| 时间 | 工作 | 路线 | 关键贡献 |
|---|---|---|---|
| 2021 | D3PM | 离散 | 离散扩散奠基：转移矩阵框架 |
| 2022 | Diffusion-LM | 连续 | 可控文本生成 |
| 2023 | MDLM | 离散 | 掩码扩散简化，最优困惑度 |
| 2024 | SEDD | 离散 | Score entropy 训练目标 |
| 2025.02 | LLaDA | 离散 | 8B 规模验证，对标 LLaMA3 |
| 2025.12 | LLaDA 2.0 | 离散 | 100B 规模，多模态扩展 |

## D3PM (2021)：离散扩散的奠基

**全称**：Structured Denoising Diffusion Models in Discrete State-Spaces  
**会议**：NeurIPS 2021  
**作者**：Jacob Austin, Daniel D. Johnson, Jonathan Ho, Daniel Tarlow, Rianne van den Berg（Google Brain / DeepMind）

D3PM 是第一个系统地将 DDPM（Denoising Diffusion Probabilistic Models）推广到离散空间的框架。核心创新是用**马尔可夫转移矩阵 Q_t** 替代高斯噪声。作者探索了多种矩阵设计：

- **均匀矩阵**：每个 token 以 β_t 概率跳转到任意其他 token
- **吸收态矩阵**：token 只能跳转到某个「吸收态」（类似 [MASK]）
- **离散化高斯矩阵**：将高斯噪声的连续转移离散化
- **基于嵌入距离的矩阵**：利用 token embedding 的相似度定义跳转概率

D3PM 在文本和图像上均做了实验，但当时的生成质量远不及自回归模型。它的主要意义在于**建立了离散扩散的数学语言**，后续 MDLM、SEDD、LLaDA 等都站在它的肩膀上。

> 关键公式——累积转移：q(x_t | x_0) = Cat(x_t; x_0 Q_1 Q_2 ... Q_t)

## Diffusion-LM (2022)：连续路线的代表作

**全称**：Diffusion-LM Improves Controllable Text Generation  
**会议**：NeurIPS 2022  
**作者**：Xiang Lisa Li, John Thickstun, Ishaan Gulrajani, Percy Liang, Tatsunori B. Hashimoto（Stanford）

Diffusion-LM 走了一条不同的路：先把离散 token 映射到连续嵌入向量，在嵌入空间做标准的高斯扩散，去噪后再通过一个 learned rounding 步骤把连续向量映射回离散 token。这个「嵌入→扩散→rounding」的 pipeline 虽然在生成质量上不如当时的 AR 模型，但在**可控生成**（controllable generation）上展示了扩散模型的独特优势：

- 通过 classifier guidance 可以精确控制生成文本的某些属性（如情感强度、主题分布）
- 可以在去噪过程中注入任意可微约束
- 不需要像 AR 模型那样修改采样策略

Diffusion-LM 的局限在于：嵌入维度的扩散 + 离散映射两步之间存在信息损失，且 rounding 步骤本身是一个不可微的操作，需要特殊处理。

## MDLM (2023)：掩码扩散的极简胜利

**全称**：Simple and Effective Masked Diffusion Language Models  
**会议**：ICML 2023  
**作者**：Subham Sekhar Sahoo, Marianne Arriola, Yair Schiff, et al.

MDLM 做了一个关键简化：**只需要一种转移——变成 [MASK]**。前向过程中，每个 token 以一定概率被替换为 [MASK]；反向过程中，模型学习预测哪些 [MASK] 位置应该恢复成什么 token。这个简化带来了三个好处：

1. **训练极简**：目标函数就是 masked position 上的交叉熵，几乎就是 BERT 的 MLM 加上 timestep embedding
2. **效果极好**：在同等参数量下达到了当时最好的困惑度（perplexity）
3. **概念清晰**：直觉上，扩散的「噪声」就是「不知道」，去噪就是「逐渐知道」

MDLM 还提出了一个实用的解码策略：**top-p 掩码调度**。在推理的每一步中，根据模型预测的置信度，只揭示高置信度位置的 token，其余保持 [MASK]。这比均匀随机揭示更高效，也更接近人类写作的「先搭框架再填细节」模式。

## SEDD (2024)：Score Entropy 的理论突破

**全称**：Score Entropy Discrete Diffusion Models  
**会议**：ICML 2024  
**作者**：Aaron Lou, Chenlin Meng, Stefano Ermon（Stanford）

SEDD 从连续扩散的 **score matching** 理论中获得灵感，为离散扩散提出了一个新的训练目标——**score entropy**。在连续扩散中，score function 是 ∇_x log p(x)，即对数概率密度的梯度。SEDD 将这一概念推广到离散空间：

$$\mathcal{L}_{\text{SEDD}} = \mathbb{E}_{x_0, t, x_t} \left[ \sum_i s_\theta(x_t)^i_{x_t^i} + \frac{1}{1-\bar{\alpha}_t} \mathbb{E}_{x_0^i|x_t^i}[s_\theta(x_t)^i_{x_0^i}] \right]$$

相比 ELBO，score entropy 在理论上更优雅——它直接对离散概率分布建模，避免了 ELBO 中需要显式计算 KL 散度的繁琐。实验上，SEDD 在多个文本生成 benchmark 上超越了 MDLM，生成质量更接近自回归模型。

SEDD 的另一贡献是展示了离散扩散的**采样灵活性**：可以通过调节去噪步数在速度和质量之间权衡，10 步就能生成可读文本，100 步接近最优质量。

## LLaDA (2025)：大规模验证的里程碑

**全称**：Large Language Diffusion Models（扩散语言模型也可以是大模型）  
**时间**：2025 年 2 月  
**作者**：Shen Nie 等（中国人民大学 GSAI 实验室）

LLaDA 是第一个在 **8B 参数规模**上与主流自回归 LLM 正面竞争的扩散模型。它的核心思路出奇简单：**把 BERT 的训练目标重新诠释为扩散模型的单步特例，然后把单步扩展为多步**。具体来说：

- 架构上就是一个 decoder-only Transformer + timestep embedding（几乎和 LLaMA 一样，只是去掉了 causal mask）
- 使用 mask predictor 而非 next-token predictor
- 完整走通预训练（2.3T tokens）+ SFT 路线

结果令人震惊：**LLaDA 8B 在多项 benchmark 上与 LLaMA3 8B 不相上下**，包括 MMLU、GSM8K（数学推理）、HumanEval（代码生成）等。更关键的是，LLaDA 还展示了扩散模型的一些独特能力：

- **反转诅咒免疫**：在诗歌补全任务中，LLaDA 能同时从前后两个方向补全，超越了 GPT-4o
- **可控生成**：通过调整去噪步数和掩码比例，可以在同一模型上实现不同的生成风格

LLaDA 的出现标志着扩散语言模型从「有趣但不够好」进入了「可以和 AR 掰手腕」的阶段。

## LLaDA 2.0 (2025)：向 100B 扩展

**时间**：2025 年 12 月  
**作者**：同一团队 + 产业合作

LLaDA 2.0 将扩散语言模型推到了 **100B 总参数**量级（约 80B 激活参数），在更大规模上验证了扩散范式的可扩展性。此外：

- 开始探索**多模态扩展**（Discrete Diffusion Multimodal Language Models）
- 混合专家（MoE）架构在离散扩散中的适配
- 推理效率持续优化，逐步缩小与 AR 模型的部署差距

## 连续路线 vs 离散路线：一个简单判断

如果你在纠结入坑哪个方向，以下判断可能有用：

| 场景 | 推荐路线 |
|---|---|
| 主要做文本生成，想和现有 LLM 生态接轨 | 离散扩散（MDLM / LLaDA 路线） |
| 做可控生成研究，需要注入可微约束 | 连续扩散（Diffusion-LM 路线） |
| 刚入门，想快速跑通实验 | 掩码扩散（最简单，代码 ≈ BERT + timestep） |

## 来源

- [D3PM (NeurIPS 2021)](https://proceedings.neurips.cc/paper/2021/file/958c530554f78bcd8e97125b70e6973d-Paper.pdf) — 离散扩散奠基，转移矩阵框架
- [Diffusion-LM (NeurIPS 2022)](https://arxiv.org/abs/2205.14217) — 连续路线，可控文本生成
- [MDLM (ICML 2023)](https://arxiv.org/abs/2306.08162) — 掩码扩散、top-p 调度
- [SEDD (ICML 2024)](https://arxiv.org/abs/2310.16834) — score entropy 训练目标
- [LLaDA (2025)](https://arxiv.org/abs/2502.09992) — 8B 规模验证、反转诅咒免疫
- [LLaDA 2.0 (2025)](https://arxiv.org/abs/2512.15745) — 100B 扩展、多模态
- [A Survey on Diffusion Language Models (2025)](https://arxiv.org/abs/2508.10875) — 全景综述

## 相关

- [为什么要用扩散做语言生成](./01-overview/why-diffusion-for-language.md)
- [离散扩散模型：从马尔可夫链到掩码预测](./02-mechanism/discrete-diffusion.md)
- [扩散 vs 自回归：全面对比](./05-comparison/diffusion-vs-ar.md)
- [LLaDA 与最新进展](./06-frontier/llada-and-beyond.md)

