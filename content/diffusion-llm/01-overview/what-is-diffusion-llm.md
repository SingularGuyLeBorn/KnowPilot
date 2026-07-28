---
title: "扩散语言模型（Diffusion LLM）概述"
category: null
tags:
  - "diffusion-llm"
  - "overview"
  - "survey"
published: true
excerpt: "什么是扩散语言模型？它如何将扩散过程从视觉领域引入文本生成？本文介绍扩散语言模型的基本范式、核心流派与发展脉络。"
---
# 扩散语言模型（Diffusion LLM）概述

## 概述

扩散语言模型（Diffusion Language Models, 简称 Diffusion LLM）是将**扩散模型**（Diffusion Models）的生成范式引入自然语言处理领域的一类新型语言模型。与当前主流自回归（Autoregressive, AR）语言模型（如 GPT 系列）从左到右逐词生成不同，扩散语言模型**从一个完全随机的噪声序列开始，通过多步去噪逐步转化为有意义的文本**。

这个领域自 2021–2022 年起步以来蓬勃发展，涌现出 Diffusion-LM、SSD-LM、MDLM 等代表性工作。到 2024 年，掩码扩散模型已在语言建模基准上逼近自回归模型的困惑度，展现出替代或补充 AR 范式的潜力。

## 关键概念

- **扩散过程（Diffusion Process）**：前向逐步向数据添加噪声，逆向学习去噪恢复原始数据。
- **非自回归生成（Non-autoregressive Generation）**：模型一次性或分块生成全部 token，而非从左到右逐个生成——这是扩散 LLM 与传统 LLM 的本质区别。
- **连续空间扩散 vs 离散空间扩散**：前者在连续词向量空间做扩散（Diffusion-LM），后者直接在离散 token 空间定义扩散过程（D3PM、MDLM）。
- **掩码扩散（Masked Diffusion）**：用 [MASK] 标记逐步替换 token，逆向从掩码恢复原文——与 BERT 的掩码语言模型有深层联系。

## 核心流派与发展脉络

| 流派 | 代表工作 | 核心思路 |
|------|---------|---------|
| **连续扩散** | Diffusion-LM (2022) | 在连续词向量空间做高斯扩散，逆向去噪后映射回 token |
| **离散扩散** | D3PM (2021)、MDLM (2024) | 在离散 token 空间定义转移矩阵，直接对 token 做扩散/去噪 |
| **半自回归扩散** | SSD-LM (2023) | 分块生成，块内双向去噪，块间自回归依赖 |
| **吸收态扩散** | MDLM、D3PM (absorbing) | 用 [MASK] 吸收态实现扩散，简化训练目标与采样 |

## 要点

1. **起源**：D3PM（2021）最早将扩散模型扩展到离散数据域，在字符级文本生成上取得初步成果。
2. **突破**：Diffusion-LM（2022）提出连续空间扩散语言模型框架，首次展示了扩散模型在**细粒度可控文本生成**上的独特优势——利用中间隐变量的连续性做梯度引导控制。
3. **成熟**：SSD-LM（2023）引入半自回归 + simplex 扩散，在非受限文本生成质量上匹敌 GPT-2，同时支持模块化控制。
4. **前沿**：MDLM（NeurIPS 2024）证明简单掩码离散扩散远未被挖掘潜力，通过 Rao-Blackwellized 目标函数达到扩散模型 SOTA，逼近自回归困惑度。

## 为什么值得关注？

- **可控性**：扩散模型的连续隐空间天然支持梯度引导（classifier guidance），比 AR 模型更容易实现细粒度属性控制。
- **非自回归效率**：理论上可以通过更少的去噪步数（甚至 1 步）实现并行生成。
- **填补式生成**：天然支持文本修补（infilling），无需像 AR 模型那样修改架构。
- **新范式可能性**：若扩散 LLM 能在规模扩展上追上 AR 模型，可能开辟不同于 Next Token Prediction 的新 Scaling Law。

## 来源

- [D3PM: Structured Denoising Diffusion Models in Discrete State-Spaces](https://arxiv.org/abs/2107.03006) — 离散状态空间扩散的开创性工作
- [Diffusion-LM Improves Controllable Text Generation](https://arxiv.org/abs/2205.14217) — 首个连续空间扩散语言模型
- [SSD-LM: Semi-autoregressive Simplex-based Diffusion Language Model](https://arxiv.org/abs/2210.17432) — 半自回归扩散语言模型
- [MDLM: Simple and Effective Masked Diffusion Language Models](https://arxiv.org/abs/2406.07524) — NeurIPS 2024，掩码扩散 SOTA

## 相关

- [[01-overview/why-diffusion-for-language]]
- [[02-models/diffusion-lm]]
- [[02-models/discrete-diffusion]]

## 待补充

- [ ] 更系统的综述论文引用
- [ ] 扩散 LLM 与其他非自回归模型（如 MaskGIT、Levenshtein Transformer）的关系
- [ ] 最新工作（2025）的前沿进展

