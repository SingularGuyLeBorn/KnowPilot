---
title: "掩码扩散与自回归：从 BERT 到 MDLM 的桥梁"
category: null
tags:
  - "masked-diffusion"
  - "masked-lm"
  - "bert"
  - "mdlm"
  - "mlm"
published: true
excerpt: "掩码语言模型（MLM，如 BERT）与掩码扩散语言模型（MDLM）之间有怎样的深刻联系？为什么说 MDLM 的训练目标等价于「加权 MLM 损失」？本文从目标函数和生成能力两个角度揭示两者的关系。"
---
# 掩码扩散与自回归：从 BERT 到 MDLM 的桥梁

## 概述

如果你熟悉 BERT 的**掩码语言模型**（Masked Language Model, MLM）目标——随机遮盖 15% 的 token，让模型预测它们——那么你已经掌握了**掩码扩散语言模型**的核心直觉。

MDLM（2024）的一个关键贡献就是揭示了：**掩码扩散的训练目标等价于一个加权混合的 MLM 损失**，差别仅在于噪声比例的分布。这使得掩码扩散语言模型可以复用 BERT 成熟的技术栈，同时获得生成式模型的能力。

## 关键概念

- **MLM 目标**：给定被 [MASK] 部分遮盖的输入序列，预测被遮盖位置的原始 token（通常是单步预测）
- **掩码扩散目标**：在**多个噪声水平**上加权 MLM 损失的混合——既预测轻度遮盖的片段，也预测重度遮盖的片段
- **生成能力的差异**：MLM 只是表征模型（无生成过程），MDLM 是生成模型（定义从全 [MASK] 到原文的去噪过程）

## BERT 的 MLM vs 掩码扩散

| 方面 | BERT (MLM) | 掩码扩散 (MDLM) |
|------|-----------|-----------------|
| **遮盖比例** | 固定 15% | 全覆盖（0% → 100%） |
| **目标函数** | 单噪声水平交叉熵 | **多噪声水平加权交叉熵混合** |
| **生成能力** | ❌ 仅编码器表征 | ✅ 可定义采样过程，是生成模型 |
| **方向性** | 双向注意力 | 双向注意力 |
| **训练效率** | 高效（单步训练） | 略高（需采样噪声时间步） |

## MDLM 的训练目标：加权 MLM 损失

MDLM 的核心公式极其简洁。对于时间步 t（对应噪声比例 α_t），其变分下界中的一项可以写成：

> L_t = E[ -log p_θ(x_0 | z_t) ] = 在噪声水平 α_t 下的 MLM 损失

整个训练目标是对所有时间步的 MLM 损失进行加权平均：

> L_total = Σ_t w_t · L_t(MLM at noise level α_t)

其中 w_t 是权重。这意味着——

**MDLM 的训练 = 在不同遮盖比例下同时训练 BERT，然后加权求和。**

### Rao-Blackwellized 改进
MDLM 进一步对损失函数做 Rao-Blackwellization（通过对离散扩散路径做解析条件化来减少估计方差），得到更紧的变分下界，这也是 MDLM 性能提升的关键之一。

## 从「表征」到「生成」的跨越

虽然训练目标相似，但 MDLM 和 BERT 有一个本质区别：

### BERT 是编码器，不是生成模型
- BERT 的 MLM 训练是为了学好的**双向表示**，而不是为了生成
- BERT 不能从纯 [MASK] 序列采样得到合理文本——它没有定义生成过程

### MDLM 是生成模型
- 定义了从全 [MASK] 到原文的**完整去噪过程**（采样器）
- 每一步只预测被遮盖位置，然后逐步「揭开」token
- 可以用不同的采样策略（一次性揭晓 / 逐步揭晓 / 半自回归揭晓）

## 采样策略灵活性

MDLM 支持多种采样策略，这是传统 MLM 不具备的能力：

1. **一次性采样**：一步从全 [MASK] 恢复——接近 BERT 但需要多个位置同时预测
2. **逐步揭晓**：每次去噪「揭晓」一部分 token（类似 D3PM 的吸收态逆向）
3. **半自回归采样**：从左到右分段揭晓，每段内做双向扩散——结合了 AR 和扩散的优势
4. **任意长度生成**：可以从部分已知文本出发，生成任意长度的续写

## 与 BERT 的技术栈兼容性

由于目标函数的相似性，BERT 时代的许多技术进步可以直接迁移到 MDLM：

- **注意力架构**（RoPE、ALiBi、Flash Attention）
- **预训练策略**（NSP、SOP 等可能适配）
- **模型压缩**（蒸馏、量化）可能比 AR 模型更容易（因为双向）
- **下游任务适配**（分类、NER 等）可以直接复用 BERT 的 fine-tuning 方法

## 要点

1. **MDLM 的训练 ≈ 在不同噪声水平上同时训练 BERT**——目标函数是加权 MLM 损失的混合。
2. **关键区别**：MDLM 定义了完整的生成过程（采样器），而 BERT 不能生成文本。
3. **Rao-Blackwellized 目标**减少了训练方差，是 MDLM 超越此前离散扩散模型的关键改进。
4. **技术栈兼容性**意味着 BERT 时代的许多工程优化可以复用到掩码扩散模型上，加速落地。
5. **这个桥梁关系也暗示了**：你可以把 MDLM 理解为一个「具备生成能力的 BERT」，它同时保留了双向表征和生成能力。

## 来源

- [MDLM: Simple and Effective Masked Diffusion Language Models](https://arxiv.org/abs/2406.07524) — 揭示 MLM 与掩码扩散的关系
- [D3PM: Structured Denoising Diffusion Models in Discrete State-Spaces](https://arxiv.org/abs/2107.03006) — 吸收态扩散的原始定义
- [BERT: Pre-training of Deep Bidirectional Transformers](https://arxiv.org/abs/1810.04805) — 经典 MLM

## 相关

- [[02-models/discrete-diffusion]]
- [[04-frontier/diffusion-vs-ar]]
- [[01-overview/what-is-diffusion-llm]]

## 待补充

- [ ] MDLM 训练目标的具体数学推导
- [ ] 不同噪声比例分布（cosine、linear、sigmoid）的影响分析
- [ ] 从 BERT checkpoint 初始化 MDLM 的迁移实验

