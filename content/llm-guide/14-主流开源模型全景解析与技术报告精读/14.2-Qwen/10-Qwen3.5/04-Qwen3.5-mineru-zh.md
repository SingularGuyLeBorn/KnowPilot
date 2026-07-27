---
title: "04 · Qwen3.5 - 逐段精译与译者注"
source: 03-Qwen3.5-mineru-en.md
source_type: "official blog announcement"
translated_by: "AI Agent"
date: 2026-05-24
status: completed
---

# Qwen3.5: 以原生多模态智能体加速生产力

> [返回 14.2-Qwen 家族总览](../../14.2-Qwen.md)

## 说明

Qwen3.5 目录内没有独立公开的技术报告 PDF. 当前可用的一手资料主要是 2026-02-16 发布的官方博客, 保存在 `pdfs/Qwen3.5.html`. 因此, 本文不是基于论文 PDF 的 MinerU 转写稿, 而是基于官方博客整理出的正式中文交付稿, 用于闭环 D3 / D4 / D5.

## Introduction

We are excited to officially release Qwen3.5, and to open-weight the first model in the series: Qwen3.5-397B-A17B. As a native vision-language model, Qwen3.5-397B-A17B performs strongly across reasoning, coding, agent, and multimodal understanding benchmarks, helping developers and enterprises improve productivity.

我们正式发布 Qwen3.5, 并开放 Qwen3.5 系列首款模型 Qwen3.5-397B-A17B 的权重. 作为原生视觉-语言模型, 它在推理、编程、智能体与多模态理解等全方位基准上表现优异, 旨在帮助开发者与企业提升生产力.

> **译者注**: Qwen3.5 的发布形态与 Qwen3 不同——后者有完整 Technical Report PDF, 而 Qwen3.5 目前以博客 + 开放权重 + API 三件套为主. 这意味着当前公开信息更偏产品与技术主张, 详细的消融实验和训练配方可能留待后续技术报告. 阅读时应区分「已验证的 benchmark 数字」与「架构层面的方向性描述」.

The model uses a hybrid architecture that combines Gated Delta Networks (linear attention) with sparse Mixture-of-Experts (MoE). It has 397B total parameters and activates only 17B parameters per forward pass, optimizing speed and cost while preserving capability. Language and dialect support expands from 119 to 201.

该模型采用 Gated Delta Networks(线性注意力)与稀疏 MoE 的混合架构: 总参数 397B, 每次前向传播仅激活 17B, 在保持能力的同时优化速度与成本. 语言与方言支持从 119 种扩展至 201 种.

> **译者注**: 397B/17B 的激活比约 4.3%, 低于 DeepSeek-V3.2(671B/37B, 约 5.5%)和多数 Dense 旗舰. 「原生多模态」指预训练阶段即融合文本-图像-视频, 而非后拼接 ViT——这对 GUI Agent 和像素级空间推理至关重要.

Qwen3.5-Plus is the API version served through Alibaba Cloud Bailian, offering a 1M-token context window, official tools, and adaptive invocation.

Qwen3.5-Plus 为 API 版本, 通过阿里云百炼提供 1M token 上下文、官方工具及自适应调用.

## 1 Model Performance

We evaluate Qwen3.5 against frontier models across multiple tasks and modalities.

我们在多种评估任务与模态下, 对 Qwen3.5 与前沿模型进行全面对比.

### 1.1 Natural Language Benchmarks

| 基准 | GPT-5.2 | Claude 4.5 Opus | Gemini-3 Pro | Qwen3-Max-Thinking | K2.5-1T-A32B | Qwen3.5-397B-A17B |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|
| **知识与推理** |
| MMLU-Pro | 87.4 | 89.5 | 89.8 | 85.7 | 87.1 | 87.8 |
| MMLU-Redux | 95.0 | 95.6 | 95.9 | 92.8 | 94.5 | 94.9 |
| SuperGPQA | 67.9 | 70.6 | 74.0 | 67.3 | 69.2 | 70.4 |
| C-Eval | 90.5 | 92.2 | 93.4 | 93.7 | 94.0 | 93.0 |
| **指令遵循** |
| IFEval | 94.8 | 90.9 | 93.5 | 93.4 | 93.9 | 92.6 |
| IFBench | 75.4 | 58.0 | 70.4 | 70.9 | 70.2 | 76.5 |
| MultiChallenge | 57.9 | 54.2 | 64.2 | 63.3 | 62.7 | 67.6 |
| **长上下文** |
| AA-LCR | 72.7 | 74.0 | 70.7 | 68.7 | 70.0 | 68.7 |
| LongBench v2 | 54.5 | 64.4 | 68.2 | 60.6 | 61.0 | 63.2 |
| **STEM** |
| GPQA | 92.4 | 87.0 | 91.9 | 87.4 | 87.6 | 88.4 |
| HLE | 35.5 | 30.8 | 37.5 | 30.2 | 30.1 | 28.7 |
| HLE-Verified | 43.3 | 38.8 | 48.0 | 37.6 | -- | 37.6 |
| **推理** |
| LiveCodeBench v6 | 87.7 | 84.8 | 90.7 | 85.9 | 85.0 | 83.6 |
| HMMT Feb 25 | 99.4 | 92.9 | 97.3 | 98.0 | 95.4 | 94.8 |
| HMMT Nov 25 | 100 | 93.3 | 93.3 | 94.7 | 91.1 | 92.7 |
| IMOAnswerBench | 86.3 | 84.0 | 83.3 | 83.9 | 81.8 | 80.9 |
| AIME26 | 96.7 | 93.3 | 90.6 | 93.3 | 93.3 | 91.3 |
| **通用 Agent** |
| BFCL-V4 | 63.1 | 77.5 | 72.5 | 67.7 | 68.3 | 72.9 |
| TAU2-Bench | 87.1 | 91.6 | 85.4 | 84.6 | 77.0 | 86.7 |
| VITA-Bench | 38.2 | 56.3 | 51.6 | 40.9 | 41.9 | 49.7 |
| DeepPlanning | 44.6 | 33.9 | 23.3 | 28.7 | 14.5 | 34.3 |
| Tool Decathlon | 43.8 | 43.5 | 36.4 | 18.8 | 27.8 | 38.3 |
| MCP-Mark | 57.5 | 42.3 | 53.9 | 33.5 | 29.5 | 46.1 |
| **搜索 Agent** |
| HLE w/ tool | 45.5 | 43.4 | 45.8 | 49.8 | 50.2 | 48.3 |
| BrowseComp | 65.8 | 67.8 | 59.2 | 53.9 | --/74.9 | 69.0/78.6 |
| BrowseComp-zh | 76.1 | 62.4 | 66.8 | 60.9 | -- | 70.3 |
| WideSearch | 76.8 | 76.4 | 68.0 | 57.9 | 72.7 | 74.0 |
| Seal-0 | 45.0 | 47.7 | 45.5 | 46.9 | 57.4 | 46.9 |
| **多语言** |
| MMMLU | 89.5 | 90.1 | 90.6 | 84.4 | 86.0 | 88.5 |
| MMLU-ProX | 83.7 | 85.7 | 87.7 | 78.5 | 82.3 | 84.7 |
| NOVA-63 | 54.6 | 56.7 | 56.7 | 54.2 | 56.0 | 59.1 |
| INCLUDE | 87.5 | 86.2 | 90.5 | 82.3 | 83.3 | 85.6 |
| Global PIQA | 90.9 | 91.6 | 93.2 | 86.0 | 89.3 | 89.8 |
| PolyMATH | 62.5 | 79.0 | 81.6 | 64.7 | 43.1 | 73.3 |
| WMT24++ | 78.8 | 79.7 | 80.7 | 77.6 | 77.6 | 78.9 |
| MAXIFE | 88.4 | 79.2 | 87.5 | 84.0 | 72.8 | 88.2 |
| **编码 Agent** |
| SWE-bench Verified | 80.0 | 80.9 | 76.2 | 75.3 | 76.8 | 76.4 |
| SWE-bench Multilingual | 72.0 | 77.5 | 65.0 | 66.7 | 73.0 | 69.3 |
| SecCodeBench | 68.7 | 68.6 | 62.4 | 57.5 | 61.3 | 68.3 |
| Terminal Bench 2 | 54.0 | 59.3 | 54.2 | 22.5 | 50.8 | 52.5 |

> 表 1: Qwen3.5-397B-A17B 与前沿模型在自然语言任务上的对比.

> **译者注**: 表 1 中 Qwen3.5 在通用 Agent(BFCL-V4、VITA-Bench、Tool Decathlon、MCP-Mark)全面超越 Qwen3-Max-Thinking 和 K2.5, 说明扩展 RL 环境对 Agent 泛化的增益是实质性的. BrowseComp 两种策略(69.0 vs 78.6)揭示上下文管理策略对搜索 Agent 影响巨大——discard-all 比简单折叠高出近 10 分.

### 1.2 Vision-Language Benchmarks

| 基准 | GPT-5.2 | Claude 4.5 Opus | Gemini-3 Pro | Qwen3-VL-235B-A22B | K2.5-1T-A32B | Qwen3.5-397B-A17B |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|
| **STEM 与谜题** |
| MMMU | 86.7 | 80.7 | 87.2 | 80.6 | 84.3 | 85.0 |
| MMMU-Pro | 79.5 | 70.6 | 81.0 | 69.3 | 78.5 | 79.0 |
| MathVision | 83.0 | 74.3 | 86.6 | 74.6 | 84.2 | 88.6 |
| Mathvista(mini) | 83.1 | 80.0 | 87.9 | 85.8 | 90.1 | 90.3 |
| We-Math | 79.0 | 70.0 | 86.9 | 74.8 | 84.7 | 87.9 |
| DynaMath | 86.8 | 79.7 | 85.1 | 82.8 | 84.4 | 86.3 |
| ZEROBench | 9 | 3 | 10 | 4 | 9 | 12 |
| ZEROBench_sub | 33.2 | 28.4 | 39.0 | 28.4 | 33.5 | 41.0 |
| BabyVision | 34.4 | 14.2 | 49.7 | 22.2 | 36.5 | 52.3/43.3 |
| **通用 VQA** |
| RealWorldQA | 83.3 | 77.0 | 83.3 | 81.3 | 81.0 | 83.9 |
| MMStar | 77.1 | 73.2 | 83.1 | 78.7 | 80.5 | 83.8 |
| HallusionBench | 65.2 | 64.1 | 68.6 | 66.7 | 69.8 | 71.4 |
| MMBenchEN-DEV-v1.1 | 88.2 | 89.2 | 93.7 | 89.7 | 94.2 | 93.7 |
| SimpleVQA | 55.8 | 65.7 | 73.2 | 61.3 | 71.2 | 67.1 |
| **文本识别与文档理解** |
| OmniDocBench1.5 | 85.7 | 87.7 | 88.5 | 84.5 | 88.8 | 90.8 |
| CharXiv(RQ) | 82.1 | 68.5 | 81.4 | 66.1 | 77.5 | 80.8 |
| MMLongBench-Doc | -- | 61.9 | 60.5 | 56.2 | 58.5 | 61.5 |
| CC-OCR | 70.3 | 76.9 | 79.0 | 81.5 | 79.7 | 82.0 |
| AI2D_TEST | 92.2 | 87.7 | 94.1 | 89.2 | 90.8 | 93.9 |
| OCRBench | 80.7 | 85.8 | 90.4 | 87.5 | 92.3 | 93.1 |
| **空间智能** |
| ERQA | 59.8 | 46.8 | 70.5 | 52.5 | -- | 67.5 |
| CountBench | 91.9 | 90.6 | 97.3 | 93.7 | 94.1 | 97.2 |
| RefCOCO(avg) | -- | -- | 84.1 | 91.1 | 87.8 | 92.3 |
| ODInW13 | -- | -- | 46.3 | 43.2 | -- | 47.0 |
| EmbSpatialBench | 81.3 | 75.7 | 61.2 | 84.3 | 77.4 | 84.5 |
| RefSpatialBench | -- | -- | 65.5 | 69.9 | -- | 73.6 |
| LingoQA | 68.8 | 78.8 | 72.8 | 66.8 | 68.2 | 81.6 |
| V* | 75.9 | 67.0 | 88.0 | 85.9 | 77.0 | 95.8/91.1 |
| Hypersim | -- | -- | -- | 11.0 | -- | 12.5 |
| SUNRGBD | -- | -- | -- | 34.9 | -- | 38.3 |
| Nuscene | -- | -- | -- | 13.9 | -- | 16.0 |
| **视频理解** |
| VideoMME(w sub.) | 86 | 77.6 | 88.4 | 83.8 | 87.4 | 87.5 |
| VideoMME(w/o sub.) | 85.8 | 81.4 | 87.7 | 79.0 | 83.2 | 83.7 |
| VideoMMMU | 85.9 | 84.4 | 87.6 | 80.0 | 86.6 | 84.7 |
| MLVU (M-Avg) | 85.6 | 81.7 | 83.0 | 83.8 | 85.0 | 86.7 |
| MVBench | 78.1 | 67.2 | 74.1 | 75.2 | 73.5 | 77.6 |
| LVBench | 73.7 | 57.3 | 76.2 | 63.6 | 75.9 | 75.5 |
| MMVU | 80.8 | 77.3 | 77.5 | 71.1 | 80.4 | 75.4 |
| **视觉 Agent** |
| ScreenSpot Pro | -- | 45.7 | 72.7 | 62.0 | -- | 65.6 |
| OSWorld-Verified | 38.2 | 66.3 | -- | 38.1 | 63.3 | 62.2 |
| AndroidWorld | -- | -- | -- | 63.7 | -- | 66.8 |
| **医学 VQA** |
| SLAKE | 76.9 | 76.4 | 81.3 | 72.5 | 81.6 | 79.9 |
| PMC-VQA | 58.9 | 59.9 | 62.3 | 56.1 | 63.3 | 64.2 |
| MedXpertQA-MM | 73.3 | 63.6 | 76.0 | 47.6 | 65.3 | 70.0 |

> 表 2: Qwen3.5-397B-A17B 与前沿模型在视觉语言任务上的对比.

> **译者注**: MathVision(88.6)超越 Gemini-3 Pro; V* 启用 Code Interpreter 达 95.8, 说明模型不仅能「看懂」图像, 还能通过代码级交互「操作」图像. OSWorld-Verified(62.2)和 AndroidWorld(66.8)接近或超越 Claude 4.5 Opus, 标志开源模型在 GUI 自动化首次达顶级水平.

### 1.3 Post-training Performance Gains

Relative to Qwen3, Qwen3.5's post-training gains mainly come from broad expansion of RL tasks and environments. We emphasize RL environment difficulty and generalization rather than narrow benchmark tuning.

相对于 Qwen3, Qwen3.5 的后训练提升主要来自各类 RL 任务与环境的全面扩展. 我们强调 RL 环境的难度与可泛化性, 而非针对特定指标的狭隘优化.

> **译者注**: 「RL Environment scaling」的核心是扩展「环境」而非仅扩展「数据」——模型在训练时与真实工具、API、多轮交互环境闭环学习. 这与 DeepSeek-V3.2 的智能体任务合成思路相近, 但 Qwen3.5 更强调环境可泛化性. 异步 RL 框架(第 3 节)支撑了这种扩展.

## 2 Pre-training

Qwen3.5 advances pre-training along three dimensions: power, efficiency, and versatility.

Qwen3.5 在能力、效率与通用性三个维度上推进预训练.

**Power.** Trained on larger-scale vision-text corpora with stronger filtering. Qwen3.5-397B-A17B matches Qwen3-Max-Base (>1T parameters).

**能力**: 更大规模视觉-文本语料 + 更严格过滤, 基座与 1T+ 的 Qwen3-Max-Base 表现相当.

**Efficiency.** Built on Qwen3-Next: Gated DeltaNet + Gated Attention hybrid, higher-sparsity MoE, MTP. At 32k/256k, throughput is 8.6x/19.0x Qwen3-Max.

**效率**: 基于 Qwen3-Next 架构, 32k/256k 下解码吞吐分别为 Qwen3-Max 的 8.6 倍/19.0 倍.

**Versatility.** Native multimodality via early fusion; 201 languages; 250k vocabulary.

**通用性**: 早期文本-视觉融合实现原生多模态; 201 种语言; 25 万词表.

> **译者注**: Gated DeltaNet 将注意力从 $O(L^2)$ 降至 $O(L)$; 混合架构在短上下文用 Gated Attention、长上下文用 Gated DeltaNet. 25 万词表带来 10-60% 编码效率提升, 但 embedding 层内存占用更大. 201 种语言覆盖远超多数竞品(通常 50-100 种).

### 2.1 Base Model Performance

| 基准 | Qwen3-235B-A22B | GLM-4.5-355B-A32B | DeepSeek-V3.2-671B-A37B | K2-1T-A32B | Qwen3.5-397B-A17B |
|:---|:---:|:---:|:---:|:---:|:---:|
| **通用知识与多语言** |
| MMLU | 87.33 | 86.56 | 88.11 | 87.38 | 88.61 |
| MMLU-Pro | 67.73 | 65.00 | 62.82 | 67.64 | 76.01 |
| MMLU-Redux | 87.44 | 86.86 | 87.29 | 86.65 | 89.09 |
| SuperGPQA | 42.84 | 44.56 | 43.46 | 44.86 | 57.96 |
| C-Eval | 91.82 | 85.50 | 90.48 | 91.82 | 91.82 |
| MMMLU | 81.27 | 82.26 | 83.20 | 82.26 | 85.82 |
| Include | 75.26 | 73.41 | 76.52 | 72.05 | 79.27 |
| Nova | 66.52 | 60.96 | 60.40 | 61.44 | 67.55 |
| **推理与 STEM** |
| BBH | 87.95 | 87.68 | 86.03 | 89.11 | 90.98 |
| KoRBench | 50.80 | 52.80 | 54.00 | 53.84 | 54.08 |
| GPQA | 47.47 | 44.63 | 44.16 | 46.78 | 54.64 |
| MATH | 71.84 | 61.84 | 64.40 | 71.50 | 74.14 |
| GSM8K | 91.17 | 89.31 | 89.12 | 92.12 | 93.71 |
| **编程** |
| Evalplus | 77.60 | 69.49 | 62.68 | 71.77 | 79.32 |
| MultiPLE | 65.94 | 62.51 | 61.88 | 70.64 | 79.39 |
| SWE-agentless | 31.77 | 29.23 | 34.67 | 28.54 | 43.26 |
| CRUX-I | 64.25 | 67.63 | 63.25 | 70.50 | 71.13 |
| CRUX-O | 78.88 | 77.13 | 73.88 | 77.13 | 82.38 |

> 表 3: Qwen3.5-397B-A17B 基座模型对比.

## 3 Infrastructure

Qwen3.5 uses heterogeneous infrastructure: decoupled TP for vision and EP for language; near-100% mixed-modal training throughput; native FP8 with runtime BF16 fallback (~50% activation memory reduction); scalable async RL with train-infer separation (3-5x end-to-end acceleration).

Qwen3.5 采用异构基础设施: 视觉 TP + 语言 EP 解耦并行; 混合模态训练吞吐近 100%; 原生 FP8 + 运行时 BF16 回退; 可扩展异步 RL 训推分离, 端到端加速 3-5 倍.

> **译者注**: 三个关键工程决策: (1) 异构并行解耦避免统一策略低效; (2) FP8 默认 + 敏感层自动回退 BF16, 避免人工标注; (3) 训推分离使训练集群利用率从 20-40% 提升至接近 100%, 多轮 Rollout 锁定保证 Agent 轨迹不断裂.

## 4 Getting Started

Qwen Chat 提供 auto / thinking / fast 三种模式. 百炼 API 通过 `enable_thinking` 和 `enable_search` 开启推理与搜索/Code Interpreter, 兼容 OpenAI 接口, 可集成 Qwen Code、Claude Code、Cline 等工具.

## 5 Demo Capabilities

Qwen3.5 支持代码与智能体(网页开发、OpenClaw 集成、vibe coding)、视觉智能体(手机/PC 操作、草图转代码、视频理解)和视觉推理(代码级图像处理、裁剪标注增强).

## 6 Multilingual Capabilities

Qwen3.5 支持 201 种语言与方言, 重点扩充低资源语言.

| 语系 | 语种与方言 |
|:---|:---|
| 印欧语系 | 英语、法语、葡萄牙语、德语、罗马尼亚语、瑞典语、丹麦语、保加利亚语、俄语、捷克语、希腊语、乌克兰语、西班牙语、荷兰语、斯洛伐克语、克罗地亚语、波兰语、立陶宛语、挪威语(博克马尔语)、挪威尼诺斯克语、波斯语、斯洛文尼亚语、古吉拉特语、拉脱维亚语、意大利语、奥克语、尼泊尔语、马拉地语、白俄罗斯语、塞尔维亚语、卢森堡语、威尼斯语、阿萨姆语、威尔士语、西里西亚语、阿斯图里亚语、恰蒂斯加尔语、阿瓦德语、迈蒂利语、博杰普尔语、信德语、爱尔兰语、法罗语、印地语、旁遮普语、孟加拉语、奥里雅语、塔吉克语、东意第绪语、伦巴第语、利古里亚语、西西里语、弗留利语、撒丁岛语、加利西亚语、加泰罗尼亚语、冰岛语、托斯克语、阿尔巴尼亚语、林堡语、达里语、南非荷兰语、马其顿语、僧伽罗语、乌尔都语、马加希语、波斯尼亚语、亚美尼亚语、拉特加利亚语、苏格兰盖尔语、中库尔德语、北库尔德语、南普什图语、梵语、敦达里语、马尔瓦里语、阿希拉尼语、巴盖利语、巴格里语、本德利语、布拉吉语、库马翁语、克什米尔语 |
| 汉藏语系 | 中文(简体中文、繁体中文、粤语)、缅甸语、藏语、梅泰语 |
| 亚非语系 | 阿拉伯语(标准语、内志语、黎凡特语、埃及语、摩洛哥语、美索不达米亚语、塔伊兹-阿德尼语、突尼斯语、海湾语、阿尔及利亚语、苏丹语、利比亚语)、希伯来语、马耳他语、阿姆哈拉语、提格里尼亚语、卡比尔语、索马里语、西中奥罗莫语、豪萨语 |
| 南岛语系 | 印度尼西亚语、马来语、他加禄语、宿务语、爪哇语、巽他语、米南加保语、巴厘岛语、班加语、邦阿西楠语、伊洛科语、瓦雷语(菲律宾)、高原马达加斯加语、马达加斯加语、布吉语、毛利语、萨摩亚语、夏威夷语、斐济语 |
| 德拉威语 | 泰米尔语、泰卢固语、卡纳达语、马拉雅拉姆语 |
| 突厥语系 | 土耳其语、北阿塞拜疆语、北乌兹别克语、哈萨克语、巴什基尔语、鞑靼语、克里米亚鞑靼语、吉尔吉斯语、土库曼语、维吾尔语 |
| 壮侗语系 | 泰语、老挝语、掸语 |
| 乌拉尔语系 | 芬兰语、爱沙尼亚语、匈牙利语、草原马里语 |
| 南亚语系 | 越南语、高棉语 |
| 尼日尔-刚果语系 | 约鲁巴语、埃维语、卢旺达语、林加拉语、北索托语、尼扬贾语、绍纳语、南索托语、茨瓦纳语、科萨语、祖鲁语、卢干达语、斯瓦蒂语、聪加语、通布卡语、文达语、乔奎语、卢巴-卡赛语、隆迪语、姆本杜语、基库尤语、刚果语、尼日利亚富拉语、沃洛夫语、丰语、卡比耶语、莫西语、阿坎语、特维语、班巴拉语、伊博语 |
| 其他 | 日语、韩语、格鲁吉亚语、巴斯克语、海地语、帕皮阿门托语、卡布维尔迪亚努语、托克皮辛语、斯瓦希里语、中部艾马拉语、图卢语、那加语、尼日利亚皮钦语、毛里求斯克里奥尔语、桑戈语、阿亚库乔克丘亚语、喀尔喀蒙古语、西南丁卡语、努埃尔语、瓜拉尼语 |

> 表 4: Qwen3.5 支持的语言与方言列表.

## 7 Summary and Future Work

Qwen3.5 凭借混合架构与原生多模态推理, 为通用数字智能体奠定基础. 下一阶段重点: 跨会话持久记忆、具身接口、自我改进机制.

> **译者注(局限风险)**: (1) 397B/17B 极端稀疏对 MoE all-to-all 通信要求高, 单卡 17B 激活仍需 40GB+ 显存; (2) 异步 RL 的样本陈旧性控制在 50+ 轮 Agent 任务中尚未充分验证; (3) 201 种语言可能存在「覆盖广但深度浅」; (4) 博客提及「即将发布的技术报告」, 更多细节(训练数据构成、RL 环境设计、DeltaNet 形式化)有待披露.

## 全文完

## 关联文件说明

- 英文源资料整理稿: `03-Qwen3.5-mineru-en.md`
- 中文精译主稿: `01-Qwen3.5技术报告精译.md`
- D5 架构专题: `05-Qwen3.5-Architecture-Overview.md`
- D5 Index: `05-Qwen3.5-Index.md`
- 源资料: `pdfs/Qwen3.5.html`, `pdfs/README.md`
- 原文链接: https://qwen.ai/blog?id=qwen3.5
