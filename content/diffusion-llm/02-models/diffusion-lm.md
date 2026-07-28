---
title: "Diffusion-LM：连续空间扩散语言模型的开创"
category: null
tags:
  - "diffusion-lm"
  - "continuous"
  - "controllable-generation"
  - "pioneer"
published: true
excerpt: "Diffusion-LM 是第一个将连续扩散模型成功应用于文本生成的工作，提出了「高斯向量 → 词向量」的去噪框架，并在细粒度可控生成上展示了惊人效果。本文解读其核心方法与创新。"
---
# Diffusion-LM：连续空间扩散语言模型的开创

## 概述

**Diffusion-LM**（Li et al., 2022）是第一个将**连续扩散模型**（Continuous Diffusion）成功应用于文本生成的工作。它的核心思路简洁而优雅：把文本的词嵌入向量视作「连续数据」，在词向量空间上运行标准的高斯扩散过程，再通过一个**Rounding 步骤**将去噪后的连续向量映射回离散 token。

这项工作发表在 2022 年，不仅证明了扩散模型可以处理离散的文本数据，更展示了其核心优势——利用连续隐空间实现**细粒度可控文本生成**，在 6 个复杂控制任务上大幅超越此前方法。

## 关键概念

- **连续扩散**：在连续的词向量空间做前向加噪（高斯噪声）和逆向去噪（学习到的去噪网络）。
- **Rounding**：将去噪后的连续向量通过最近邻搜索映射回词表中的离散 token——这是连续空间到离散空间的「桥梁」。
- **梯度引导控制（Classifier Guidance）**：在去噪过程中，用外部分类器的梯度引导生成过程向目标属性偏移。

## 模型架构

```
        正向过程：x₀ → x₁ → x₂ → ... → x_T（加噪）
                    ↓
        逆向过程：x_T → ... → x₂ → x₁ → x₀（去噪）
                    ↓
               Rounding layer → 离散 token
                    ↓
             任意控制信号（梯度引导）
```

### 1. 嵌入与去噪网络
- 每个 token 先被映射为词嵌入向量
- 在嵌入空间上定义前向扩散（高斯噪声）
- 用 Transformer 架构学习逆向去噪过程

### 2. Rounding 层
去噪完成后，得到的连续向量通过**最近邻查找**匹配到最近的词嵌入，得到最终文本。这是关键创新——它使得连续扩散可以直接在词嵌入空间运行，无需修改扩散模型本身。

### 3. 可控生成：梯度引导
这是 Diffusion-LM 最大的亮点。在每一步去噪时，用一个训练好的属性分类器计算梯度：
```
x_{t-1} = 去噪网络输出 + α · ∇(分类器对数概率)
```
这个简单的梯度修正可以让生成结果具备指定的情感、主题、句法结构等属性——**无需重新训练模型**。

## 实验结果

Diffusion-LM 在六大细粒度控制能力上显著超越此前 SOTA：

| 控制任务 | 指标提升 |
|---------|---------|
| 情感控制（正面→负面） | 准确性 +20% |
| 句法结构控制（句长、句式） | 精确匹配率大幅提升 |
| 语义关系控制（同义改写） | BLEU 与可控性均优于基线 |
| 内容约束（包含指定词） | 包含率接近 100% |
| 语法时态控制 | 准确变换率显著提高 |
| 位置相关性控制 | 超越以往所有方法 |

## 局限性

- **推理慢**：需要数百步去噪 + 每步一个前向传播，远慢于 AR 模型
- **质量尚不及 AR**：在自由生成（无控制）时的文本流畅度不如 GPT-2 等 AR 模型
- **Rounding 误差**：连续向量可能落在两个词嵌入之间，导致映射失真
- **词汇量受限**：受嵌入空间质量影响，大词表场景下 rounding 准确率下降

## 要点

1. **开创性地位**：Diffusion-LM 是首个在文本域系统应用连续扩散的工作，启发了后续 SSD-LM、MDLM 等一系列研究。
2. **可控性的标杆**：直到今天，梯度引导控制仍然是扩散语言模型相比 AR 模型最具区分度的能力。
3. **历史意义大于实用价值**：2022 年时生成质量还不足以与 AR 模型竞争，但它证明了「把文本放到连续空间做扩散」是可行的。
4. **后续改进**：SSD-LM 用 simplex 扩散取代 round，MDLM 用离散掩码取代连续空间——都试图解决 Diffusion-LM 的质量和效率问题。

## 来源

- [Diffusion-LM Improves Controllable Text Generation](https://arxiv.org/abs/2205.14217) — 原论文，Xiang Lisa Li et al., 2022
- [SSD-LM: Semi-autoregressive Simplex-based Diffusion Language Model](https://arxiv.org/abs/2210.17432) — 后续改进，用 simplex 替代 continuous + rounding

## 相关

- [[01-overview/what-is-diffusion-llm]]
- [[01-overview/why-diffusion-for-language]]
- [[02-models/discrete-diffusion]]
- [[03-applications/controllable-generation]]

## 待补充

- [ ] Diffusion-LM 的具体训练目标公式解读
- [ ] Rounding 层的双向最近邻 vs 仅前向策略的区别
- [ ] 与其他非自回归模型（Mask-Predict、CMLM）的对比

