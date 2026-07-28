---
title: Diffusion LLM — 扩散模型与语言模型
description: 扩散语言模型的前沿、原理、关键论文与应用综述
---
# Diffusion LLM — 扩散模型与语言模型

> 将扩散模型引入文本生成与语言建模的前沿综述

## 本库定位

面向 **对扩散模型有基础、想了解其在 NLP/LLM 领域应用的研究者与工程师**。覆盖：

- 扩散语言模型的**核心原理**（Continuous/Discrete Diffusion、Masked Diffusion）
- **关键论文**解读（Diffusion-LM、SSD-LM、MDLM、D3PM 等）
- **应用场景**（文本生成、可控生成）
- 与自回归模型的**对比分析**与**前沿趋势**

## 目录（10 篇文章，初版完整）

```
diffusion-llm/
├── 01-overview/
│   ├── what-is-diffusion-llm              ✅ 扩散语言模型概述
│   └── why-diffusion-for-language         ✅ 为什么扩散模型适合语言
├── 02-models/
│   ├── diffusion-lm                       ✅ Diffusion-LM 开创性工作
│   ├── discrete-diffusion                 ✅ D3PM、MDLM 等离散扩散
│   └── masked-and-ar                      ✅ 掩码扩散 vs BERT/AR
├── 03-applications/
│   ├── text-generation                    ✅ 文本生成应用（DiffuSeq 等）🆕
│   └── controllable-generation            ✅ 可控生成与属性控制
├── 04-frontier/
│   ├── scaling-diffusion-llm              ✅ 扩展性与前沿趋势
│   └── diffusion-vs-ar                    ✅ 扩散 vs 自回归深度对比
└── sources/
    └── key-papers                         ✅ 关键论文摘要集
```

## 阅读路径

1. 🌀 从 `01-overview/what-is-diffusion-llm` 开始，建立整体认知
2. ❓ 读 `01-overview/why-diffusion-for-language` 了解动机
3. 🔬 进入 `02-models/` 三篇深入核心模型
4. 🎮 `03-applications/` 两篇看应用场景
5. 🔭 `04-frontier/` 两篇讨论对比与未来
6. 📚 `sources/key-papers` 快速查阅论文摘要

## 状态

- 创建：2025-07-11
- 阶段：**初版已完成**（10 篇，每篇含多源引用）
- 维护：Standing Goal 已达成
- 后续可深化的方向：SSD-LM 独立文章、图片与公式、2025 最新论文跟踪、代码示例
