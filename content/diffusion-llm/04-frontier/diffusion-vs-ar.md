---
title: "扩散 vs 自回归：语言模型的两条技术路线"
category: null
tags:
  - "comparison"
  - "autoregressive"
  - "diffusion"
  - "paradigm"
published: true
excerpt: "扩散语言模型与自回归语言模型在生成范式、可控性、效率、扩展性上到底有何本质区别？本文从多个维度做系统对比，并展望两者的融合可能。"
---
# 扩散 vs 自回归：语言模型的两条技术路线

## 概述

自回归（AR）语言模型（GPT、Llama、Mistral）通过**逐个预测下一个 token** 进行生成，是当代 LLM 的事实标准。扩散语言模型则从**完全噪声开始，多步迭代去噪**得到完整文本。两者代表了完全不同的生成范式——一个像「从左到右写字」，一个像「从模糊到清晰成像」。

本文从多个维度做系统对比，分析各自的优劣、适用场景以及可能的融合方向。

## 关键概念

- **自回归生成**：P(x) = ∏ P(x_i | x_{<i})，条件概率链式分解
- **扩散生成**：从先验噪声 p(x_T) 开始，通过学习到的逆向过程逐步去噪得到 p(x_0)
- **非自回归**：不依赖 strict left-to-right 依赖，可并行或双向生成

## 多维度对比

### 1. 生成范式

| 维度 | 自回归（AR） | 扩散 |
|------|------------|------|
| **方向性** | 严格从左到右 | 全局/双向 |
| **修改能力** | 生成后不能回头修改 | 迭代精炼，可逐步修正 |
| **条件依赖** | 仅依赖前文（causal attention） | 全可见（bidirectional attention） |
| **Token 顺序** | 固定（从左到右） | 灵活（可通过时序安排） |

### 2. 文本质量

- **AR 模型**：在标准语言建模基准（WikiText-103、PG-19）上长期保持最优困惑度
- **扩散模型**：MDLM（2024）首次逼近 AR 模型的困惑度，但在大规模上尚未验证
- **多样性**：扩散模型的迭代精炼过程可能产生比 AR 模型 greedy decoding 更多样的输出

### 3. 可控性

| 控制方式 | AR | 扩散 |
|---------|-----|------|
| **Prompt engineering** | ✅ 常用 | ✅ 可用 |
| **Fine-tuning** | ✅ 有效但贵 | ✅ 有效但贵 |
| **Gradient guidance** | ❌ 不自然 | ✅ **天然支持** |
| **Modular control** | ⚠️ 需要特殊架构 | ✅ **即插即用** |

**结论：可控性是扩散模型最显著的优势。**

### 4. 推理效率

| 指标 | AR | 扩散 |
|------|-----|------|
| **生成速度** | O(N) 次前向（N=token数） | O(K) 次前向（K=去噪步数，通常 50–1000） |
| **并行度** | 串行（KV-cache 缓解） | 可并行（所有 token 同时去噪） |
| **批处理友好** | 较高（标准 decoder-only） | 中等（batch 内不同序列去噪进度可同步） |
| **步数压缩潜力** | N/A | 蒸馏到 4–8 步正在推进 |

**注意**：虽然去噪步数多，但扩散模型可以并行生成所有 token，在长文本场景下可能更快。当前 AR 模型有 KV-cache、speculative decoding 等大量优化，而扩散 LLM 的工程优化生态尚在早期。

### 5. 扩展性（Scaling）

这是扩散 LLM 最大的未知数：
- AR 模型的 Scaling Law 经过 GPT-3、Llama、Chinchilla 等工作的验证，已经非常清晰
- 扩散 LLM 在 1B+ 参数规模的行为尚缺乏系统研究
- MDLM 仅在相对较小的模型上验证（百万到亿级参数）
- 扩散模型的训练是否也能从「更多数据 + 更大模型」中获得稳定收益，还未有定论

### 6. 填补式生成（Infilling）

| 场景 | AR | 扩散 |
|------|-----|------|
| **前缀→后缀** | ✅ 天然 | ✅ 需要处理 |
| **后缀→前缀** | ❌ 需特殊架构 | ✅ 天然 |
| **中间补全** | ⚠️ 需 bidirectional | ✅ **天然** |
| **任意位置编辑** | ❌ 困难 | ✅ **天然** |

## 有没有可能「既要又要」？

一些工作正在尝试融合两者的优势：

### 半自回归扩散（SSD-LM 等）
- 分块生成，块内双向扩散，块间自回归
- 同时具备非自回归的灵活性和自回归的序列建模能力

### Block Diffusion
- 在自回归框架中嵌入扩散块
- 每个块用扩散生成，块间用自回归连接
- 作为 AR 和扩散之间的插值方案

### 扩散蒸馏为自回归
- 训练好的扩散模型可以蒸馏为一个自回归网络
- 推理时享受 AR 速度，生成多样性则保留扩散特性

## 要点

1. **AR 仍然是语言建模的「黄金标准」**——简单、可扩展、生态成熟、效果已被大规模验证。
2. **扩散模型的核心优势是可控性和非自回归灵活性**——在需要细粒度控制、文本编辑、填补式生成的场景中尤其突出。
3. **最大不确定性在于扩展性**——如果扩散 LLM 能在 10B+ 参数上证明其 Scaling Law 与 AR 模型相当或更好，范式转移才真正开始。
4. **最可能的终局不是二选一，而是融合**——AR + 扩散的混合架构（半自回归、Block Diffusion）可能是最实用的方向。

## 来源

- [Diffusion-LM Improves Controllable Text Generation](https://arxiv.org/abs/2205.14217) — 扩散模型可控性 vs AR
- [SSD-LM: Semi-autoregressive Simplex-based Diffusion Language Model](https://arxiv.org/abs/2210.17432) — 半自回归融合方案
- [MDLM: Simple and Effective Masked Diffusion Language Models](https://arxiv.org/abs/2406.07524) — 扩散 LLM 逼近 AR 困惑度
- [Block Diffusion](https://openreview.net/forum?id=tyEyYT267x) — 插值 AR 与扩散

## 相关

- [[01-overview/why-diffusion-for-language]]
- [[02-models/masked-and-ar]]
- [[04-frontier/scaling-diffusion-llm]]

## 待补充

- [ ] 最新的扩散 LLM Scaling 实验结果
- [ ] 定量对比表（perplexity、生成速度、FID 等具体指标）
- [ ] 混合架构的详细分析

