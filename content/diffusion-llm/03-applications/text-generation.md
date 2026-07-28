---
title: "扩散语言模型的文本生成应用"
category: null
tags:
  - "text-generation"
  - "applications"
  - "seq2seq"
  - "diffuseq"
  - "diversity"
published: true
excerpt: "扩散语言模型已覆盖多种文本生成场景：自由文本生成、Seq2Seq（翻译/摘要/对话）、代码生成、文本改写等。本文综述各场景的进展，重点分析 DiffuSeq、SSD-LM 等代表性工作。"
---
# 扩散语言模型的文本生成应用

## 概述

扩散语言模型最初因可控文本生成而名声大噪，但它的应用场景远不止于此。从无约束的自由文本生成、序列到序列（Seq2Seq）任务（翻译、摘要、对话），到代码生成、文本改写与补全——扩散模型的**迭代精炼**与**非自回归**特性为这些场景带来了独特的价值。

## 关键概念

- **自由文本生成（Unconditional Generation）**：模型从随机噪声直接生成完整句子/段落，无任何条件输入。
- **条件文本生成（Conditional Generation）**：以源文本或 prompt 为条件生成目标文本（如翻译、摘要）。
- **迭代精炼（Iterative Refinement）**：生成过程多轮修正自己之前的输出——这是扩散模型与一次性生成的非自回归模型（如 Mask-Predict）的关键区别。
- **生成多样性（Diversity）**：模型对同一输入产生语义不同但都合理的输出——扩散模型在这方面有天然优势。

## 应用场景概览

| 场景 | 代表工作 | 核心优势 |
|------|---------|---------|
| **自由生成** | SSD-LM、MDLM | 质量匹敌 AR 模型，多样性更高 |
| **Seq2Seq（翻译/摘要/对话）** | DiffuSeq (ICLR 2023) | 高多样性，质量与 AR 模型相当 |
| **文本改写** | Diffusion-LM | 迭代精炼天然适合改写 |
| **代码生成** | D3PM (字符级) | 双向上下文适合补全 |
| **数据增强** | 可控扩散 | 生成带指定属性的合成数据 |

## 1. 自由文本生成（Unconditional）

SSD-LM（ACL 2023）率先在自由文本生成质量上**匹敌甚至超越 GPT-2**：

- 在 LM1B、Wikitext-103 等基准上，生成质量指标（PPL、MAUVE）与 GPT-2 接近或持平
- 生成多样性显著高于 AR 模型的 greedy decoding
- 核心设计：半自回归分块生成 + simplex 概率空间扩散

MDLM（NeurIPS 2024）进一步缩小了与 AR 模型的困惑度差距，支持灵活的采样策略（一次性揭晓、逐步揭晓、半自回归）。

> "Our approach matches or outperforms strong autoregressive GPT-2 models across standard quality and diversity metrics." — SSD-LM 论文

## 2. Seq2Seq 文本生成（DiffuSeq）

**DiffuSeq**（Gong et al., ICLR 2023）是扩散模型在 Seq2Seq 任务中的里程碑：

**解决的问题**：扩散模型在条件文本生成（给定源文本生成目标文本）中的应用尚未充分探索。

**方法**：
- 将源文本和目标文本拼接，在连续嵌入空间做扩散
- 去噪时**固定源文本区域**，只去噪目标区域
- 无需额外的分类器引导——条件信息直接通过拼接注入

**结果**：
- 在文本摘要、对话生成、问题生成、数据-to-文本等任务上**与强 AR 基线（包括预训练模型）相当甚至更优**
- **生成多样性显著高于 AR 模型**——同一源文本可产生多种合理的译文/摘要
- 连接了 AR 和非自回归模型的理论分析

> "DiffuSeq achieves comparable or even better performance than six established baselines, including a state-of-the-art model based on pre-trained language models." — DiffuSeq 论文

## 3. 文本改写与编辑

扩散模型的迭代精炼天然适合文本修改：

- **局部改写**：在去噪过程中，只有部分 token 被修改，其他保持——相当于「局部编辑」
- **同义改写（Paraphrasing）**：Diffusion-LM 通过梯度引导控制语义保持，实现多样化的同义表达
- **风格迁移**：从正式→非正式，或从复杂→简单

## 4. 代码生成

虽然扩散语言模型在代码生成领域的应用尚少，但其潜力值得关注：

- **代码补全天然适用**：双向注意力可以同时感知上下文（import 语句、函数签名）
- **代码 Infilling**：填补函数体中间部分——AR 模型需要特殊处理，扩散模型天然支持
- 目前主要处于字符级扩散的初步探索（D3PM 等）

## 5. 作为数据增强工具

扩散模型的高可控性使其成为强大的**合成数据生成器**：
- 用情感分类器引导生成正面/负面训练样本
- 用主题分类器生成特定主题的文本
- 生成多样化的对抗样本用于鲁棒性训练

## 生成多样性的独特优势

扩散模型在所有文本生成场景中最一致的亮点是**高多样性**：

| 方法 | 多样性 | 质量 |
|------|--------|------|
| AR greedy decoding | ❌ 低（倾向高频 token） | ✅ 高 |
| AR beam search | ⚠️ 中（beam 间差异有限） | ✅ 高 |
| AR random sampling | ✅ 高 | ⚠️ 可能产生不流畅 |
| 扩散模型 | ✅ **天然高** | ✅ **可控** |

原因：扩散模型的生成不是「选最可能的 token」，而是「多步迭代优化全局解空间」，天然覆盖更多模式。

## 要点

1. **自由文本生成**：SSD-LM 首次让扩散在质量上匹敌 AR 模型；MDLM 进一步缩小差距。
2. **Seq2Seq（DiffuSeq）**：ICLR 2023 工作，扩散模型在翻译/摘要等条件下的表现已接近主流 AR 模型。
3. **多样性是贯穿所有应用场景的共同优势**——对同一条件输入可产生多种合理的生成结果。
4. **代码生成**是尚未充分挖掘的潜力场景，扩散的双向注意力特性可能有独特价值。
5. 目前扩散模型尚未在**大规模、强基线对比**（如 GPT-3.5/GPT-4 级）上验证文本生成能力。

## 来源

- [DiffuSeq: Sequence to Sequence Text Generation with Diffusion Models](https://arxiv.org/abs/2210.08933) — ICLR 2023，Seq2Seq 扩散模型
- [SSD-LM: Semi-autoregressive Simplex-based Diffusion Language Model](https://arxiv.org/abs/2210.17432) — ACL 2023，自由文本生成匹敌 GPT-2
- [MDLM: Simple and Effective Masked Diffusion Language Models](https://arxiv.org/abs/2406.07524) — NeurIPS 2024，掩码扩散 SOTA
- [Diffusion-LM Improves Controllable Text Generation](https://arxiv.org/abs/2205.14217) — 可控/改写扩散模型

## 相关

- [[03-applications/controllable-generation]] — 可控生成的姐妹篇
- [[02-models/diffusion-lm]]
- [[02-models/discrete-diffusion]]
- [[04-frontier/diffusion-vs-ar]]

## 待补充

- [ ] 在机器翻译任务上与 SOTA 翻译模型（NLLB、M2M-100）的定量对比
- [ ] 代码生成的具体个案/评测基准
- [ ] 扩散模型在表到文本（Table-to-Text）等其他 Seq2Seq 场景的扩展

