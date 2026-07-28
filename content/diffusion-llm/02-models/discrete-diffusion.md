---
title: "离散扩散语言模型：D3PM、MDLM 与吸收态范式"
category: null
tags:
  - "discrete-diffusion"
  - "d3pm"
  - "mdlm"
  - "masked-diffusion"
  - "absorbing-state"
published: true
excerpt: "离散扩散模型直接在 token 空间操作，用转移矩阵定义加噪/去噪过程。本文详解 D3PM 的通用框架、MDLM 的掩码扩散 SOTA，以及为何吸收态（absorbing state）成为主流选择。"
---
# 离散扩散语言模型：D3PM、MDLM 与吸收态范式

## 概述

与 Diffusion-LM 在**连续向量空间**做扩散不同，离散扩散模型（Discrete Diffusion Models）直接在**离散 token 空间**定义前向和逆向过程，用**转移矩阵**（Transition Matrix）来控制 token 如何被「污染」和「恢复」。

这一路线的代表工作包括 D3PM（2021）和 MDLM（NeurIPS 2024）。特别是 MDLM 证明了**简单掩码离散扩散远比之前认为的更强大**，在标准语言模型基准上逼近了自回归模型的困惑度。

## 关键概念

- **转移矩阵 Q_t**：定义在时刻 t，token i 变成 token j 的概率。这是离散扩散的核心设计选择。
- **吸收态（Absorbing State）**：一种特殊转移矩阵——token 要么保持不变，要么被替换成一个特殊的 [MASK] 标记。一旦进入 [MASK] 就出不去了（前向过程）。
- **掩码扩散（Masked Diffusion）**：前向过程逐步把 token 替换为 [MASK]，逆向过程从全 [MASK] 序列逐步恢复原文。
- **Rao-Blackwellized 目标**：MDLM 采用的改进目标函数，通过对潜变量条件化来减少方差，提升训练效果。

## D3PM：离散扩散的通用框架

D3PM（Austin et al., 2021）提出了离散扩散的统一框架：

### 三种转移矩阵设计

| 类型 | 机制 | 特点 |
|------|------|------|
| **均匀转移（Uniform）** | token 等概率变为任意其他 token | 简单但破坏性大，恢复困难 |
| **吸收态（Absorbing）** | token → [MASK] 或保持 | 与 BERT 的 MLM 目标有天然联系 |
| **量化高斯（Discretized Gaussian）** | 基于嵌入空间距离的近邻转移 | 保留语义局部性 |

### 关键贡献
- 首次将离散状态的扩散模型系统化
- 在字符级文本生成上取得不错结果
- 在 CIFAR-10 图像生成上达到匹敌连续扩散的对数似然
- 证明了转移矩阵的选择是影响性能的关键设计决策

## MDLM：简单而有效的掩码扩散 SOTA

MDLM（Sahoo et al., NeurIPS 2024）是目前离散扩散语言模型的**最优水平**：

### 核心创新

1. **简化的训练目标**：MDLM 的目标函数是一个**加权掩码交叉熵损失的混合**——形式极其简单，等价于不同噪声比例的 MLM 损失。
2. **Rao-Blackwellized 目标**：通过对离散扩散路径进行解析条件化，减少了训练目标的方差，获得额外改进。
3. **高效采样器**：支持灵活的生成策略——可以从任意长度开始生成，也可以半自回归地分段生成。

### 结果
- 在标准语言建模基准上达到**扩散模型 SOTA**
- **逼近自回归模型的困惑度**——此前扩散模型从未如此接近 AR 模型
- 支持 encoder-only 架构训练

```
MDLM vs AR 语言模型（困惑度，越低越好）:
  GPT-2:       xxx (参考)
  MDLM:        xxx (接近)
  其他扩散:    xxx (明显落后)
```

> "We show that simple masked discrete diffusion is more performant than previously thought." — MDLM 论文

## 为什么吸收态成为主流？

从 D3PM 到 MDLM，再到其他后续工作，**吸收态（MASK）** 逐渐成为离散扩散语言模型的主流选择：

1. **与 BERT/MLM 的深层联系**：目标函数可以直接复用成熟的掩码语言建模损失
2. **采样自然**：从全 [MASK] 逐步「揭晓」token，类似自回归的从左到右但可以双向
3. **理论优雅**：吸收态扩散的变分下界有简洁的闭式表达式
4. **训练稳定**：比均匀转移更容易收敛

## 要点

1. **D3PM（2021）奠基性的理论框架**：证明了离散扩散的可行性，并揭示了转移矩阵设计的重要性。
2. **MDLM（2024）是当前最先进的离散扩散语言模型**，首次让扩散模型在语言建模核心指标上与 AR 模型竞争。
3. **吸收态 + 掩码**正在成为离散扩散语言模型的标准范式——简洁、有效、与现有 MLM 技术栈兼容。
4. 关键未解决问题：离散扩散模型在大规模（10B+ 参数）下的行为、推理步数的进一步压缩。

## 来源

- [D3PM: Structured Denoising Diffusion Models in Discrete State-Spaces](https://arxiv.org/abs/2107.03006) — 离散扩散的通用框架，Jacob Austin et al., 2021
- [MDLM: Simple and Effective Masked Diffusion Language Models](https://arxiv.org/abs/2406.07524) — NeurIPS 2024 论文
- [MDLM 项目主页](https://s-sahoo.com/mdlm/) — 含代码、博客与视频教程

## 相关

- [[01-overview/what-is-diffusion-llm]]
- [[02-models/diffusion-lm]] — 连续空间扩散，与离散对立
- [[02-models/masked-and-ar]] — 掩码扩散 vs 自回归的深化对比

## 待补充

- [ ] 离散扩散的 ELBO 推导与 D3PM 论文中的具体公式
- [ ] 贝尔曼方程与 Rao-Blackwellization 的技术细节
- [ ] MDLM 在具体下游任务（如 MT、文本分类）上的表现

