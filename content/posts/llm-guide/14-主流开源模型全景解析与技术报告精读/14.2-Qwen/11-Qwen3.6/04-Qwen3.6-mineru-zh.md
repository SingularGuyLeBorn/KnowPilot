---
title: "04 · Qwen3.6 - 逐段精译与译者注"
source: 03-Qwen3.6-mineru-en.md
source_type: "official blog announcement"
translated_by: "AI Agent"
date: 2026-05-24
status: completed
---

# Qwen3.6: 全尺度智能体编程能力的飞跃

> [返回 14.2-Qwen 家族总览](../../14.2-Qwen.md)

## 说明

Qwen3.6 目录内没有独立公开的技术报告 PDF. 一手资料为 2026-04-15 与 2026-04-22 两篇官方博客. 本文是基于博客整理出的正式中文交付稿, 用于闭环 D3 / D4 / D5.

## Introduction

Following Qwen3.6-Plus, Qwen Team open-sourced Qwen3.6-35B-A3B and Qwen3.6-27B in April 2026, forming a full-scale Qwen3.6 open family.

继 Qwen3.6-Plus 发布之后, Qwen Team 于 2026 年 4 月相继开源 Qwen3.6-35B-A3B 和 Qwen3.6-27B, 构建覆盖全尺度的 Qwen3.6 开源家族.

> **译者注**: Qwen3.6 揭示了一个反直觉判断: 在 Agent 编程维度, 训练数据与后训练方法的权重正在超越模型规模. Qwen3.6-27B 以 27B 稠密参数全面超越 397B/17B MoE 前代旗舰, 对「规模即能力」假设构成直接挑战.

**Qwen3.6-35B-A3B** is a sparse MoE model: 35B total / 3B activated, excelling at agentic coding.

**Qwen3.6-35B-A3B** 是 35B 总参数 / 3B 激活的稀疏 MoE 模型, 在 Agent 编程上表现卓越.

**Qwen3.6-27B** is a 27B dense model surpassing Qwen3.5-397B-A17B on SWE-bench Verified (77.2 vs 76.2), Terminal-Bench 2.0 (59.3 vs 52.5), SkillsBench (48.2 vs 30.0).

**Qwen3.6-27B** 是 27B 稠密多模态模型, 在多项 Agent 编程基准上超越 397B/17B 的 Qwen3.5 前代旗舰.

## 1 Model Performance

### 1.1 Natural Language Benchmarks

#### 1.1.1 Qwen3.6-35B-A3B

| 基准 | Qwen3.5-27B | Gemma4-31B | Qwen3.5-35B-A3B | Gemma4-26B-A4B | Qwen3.6-35B-A3B |
|:---|:---:|:---:|:---:|:---:|:---:|
| **编码 Agent** |
| SWE-bench Verified | 75.0 | 52.0 | 70.0 | 17.4 | 73.4 |
| SWE-bench Multilingual | 69.3 | 51.7 | 60.3 | 17.3 | 67.2 |
| SWE-bench Pro | 51.2 | 35.7 | 44.6 | 13.8 | 49.5 |
| Terminal-Bench 2.0 | 41.6 | 42.9 | 40.5 | 34.2 | 51.5 |
| Claw-Eval Avg | 64.3 | 48.5 | 65.4 | 58.8 | 68.7 |
| Claw-Eval Pass^3 | 46.2 | 25.0 | 51.0 | 28.0 | 50.0 |
| SkillsBench Avg5 | 27.2 | 23.6 | 4.4 | 12.3 | 28.7 |
| QwenClawBench | 52.2 | 41.7 | 47.7 | 38.7 | 52.6 |
| NL2Repo | 27.3 | 15.5 | 20.5 | 11.6 | 29.4 |
| QwenWebBench | 1068 | 1197 | 978 | 1178 | 1397 |
| **通用 Agent** |
| TAU3-Bench | 68.4 | 67.5 | 68.9 | 59.0 | 67.2 |
| VITA-Bench | 41.8 | 43.0 | 29.1 | 36.9 | 35.6 |
| DeepPlanning | 22.6 | 24.0 | 22.8 | 16.2 | 25.9 |
| Tool Decathlon | 31.5 | 21.2 | 28.7 | 12.0 | 26.9 |
| MCPMark | 36.3 | 18.1 | 27.0 | 14.2 | 37.0 |
| MCP-Atlas | 68.4 | 57.2 | 62.4 | 50.0 | 62.8 |
| WideSearch | 66.4 | 35.2 | 59.1 | 38.3 | 60.1 |
| **知识** |
| MMLU-Pro | 86.1 | 85.2 | 85.3 | 82.6 | 85.2 |
| MMLU-Redux | 93.2 | 93.7 | 93.3 | 92.7 | 93.3 |
| SuperGPQA | 65.6 | 65.7 | 63.4 | 61.4 | 64.7 |
| C-Eval | 90.5 | 82.6 | 90.2 | 82.5 | 90.0 |
| **STEM 与推理** |
| GPQA | 85.5 | 84.3 | 84.2 | 82.3 | 86.0 |
| HLE | 24.3 | 19.5 | 22.4 | 8.7 | 21.4 |
| LiveCodeBench v6 | 80.7 | 80.0 | 74.6 | 77.1 | 80.4 |
| HMMT Feb 25 | 92.0 | 88.7 | 89.0 | 91.7 | 90.7 |
| HMMT Nov 25 | 89.8 | 87.5 | 89.2 | 87.5 | 89.1 |
| HMMT Feb 26 | 84.3 | 77.2 | 78.7 | 79.0 | 83.6 |
| IMOAnswerBench | 79.9 | 74.5 | 76.8 | 74.3 | 78.9 |
| AIME26 | 92.6 | 89.2 | 91.0 | 88.3 | 92.7 |

> 表 1: Qwen3.6-35B-A3B 与同规模模型对比.

> **译者注**: Qwen3.6-35B-A3B 在 Terminal-Bench 2.0(51.5)和 Claw-Eval(68.7)上显著超越同规模前代, 说明 3B 激活参数在 Agent 脚手架场景下已具备实用竞争力.

#### 1.1.2 Qwen3.6-27B

| 基准 | Qwen3.5-27B | Qwen3.5-397B-A17B | Gemma4-31B | Claude 4.5 Opus | Qwen3.6-35B-A3B | Qwen3.6-27B |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|
| **编码 Agent** |
| SWE-bench Verified | 75.0 | 76.2 | 52.0 | 80.9 | 73.4 | 77.2 |
| SWE-bench Pro | 51.2 | 50.9 | 35.7 | 57.1 | 49.5 | 53.5 |
| SWE-bench Multilingual | 69.3 | 69.3 | 51.7 | 77.5 | 67.2 | 71.3 |
| Terminal-Bench 2.0 | 41.6 | 52.5 | 42.9 | 59.3 | 51.5 | 59.3 |
| SkillsBench Avg5 | 27.2 | 30.0 | 23.6 | 45.3 | 28.7 | 48.2 |
| QwenWebBench | 1068 | 1186 | 1197 | 1536 | 1397 | 1487 |
| NL2Repo | 27.3 | 32.2 | 15.5 | 43.2 | 29.4 | 36.2 |
| Claw-Eval Avg | 64.3 | 70.7 | 48.5 | 76.6 | 68.7 | 72.4 |
| Claw-Eval Pass^3 | 46.2 | 48.1 | 25.0 | 59.6 | 50.0 | 60.6 |
| QwenClawBench | 52.2 | 51.8 | 41.7 | 52.3 | 52.6 | 53.4 |
| **知识** |
| MMLU-Pro | 86.1 | 87.8 | 85.2 | 89.5 | 85.2 | 86.2 |
| MMLU-Redux | 93.2 | 94.9 | 93.7 | 95.6 | 93.3 | 93.5 |
| SuperGPQA | 65.6 | 70.4 | 65.7 | 70.6 | 64.7 | 66.0 |
| C-Eval | 90.5 | 93.0 | 82.6 | 92.2 | 90.0 | 91.4 |
| **STEM 与推理** |
| GPQA Diamond | 85.5 | 88.4 | 84.3 | 87.0 | 86.0 | 87.8 |
| HLE | 24.3 | 28.7 | 19.5 | 30.8 | 21.4 | 24.0 |
| LiveCodeBench v6 | 80.7 | 83.6 | 80.0 | 84.8 | 80.4 | 83.9 |
| HMMT Feb 25 | 92.0 | 94.8 | 88.7 | 92.9 | 90.7 | 93.8 |
| HMMT Nov 25 | 89.8 | 92.7 | 87.5 | 93.3 | 89.1 | 90.7 |
| HMMT Feb 26 | 84.3 | 87.9 | 77.2 | 85.3 | 83.6 | 84.3 |
| IMOAnswerBench | 79.9 | 80.9 | 74.5 | 84.0 | 78.9 | 80.8 |
| AIME26 | 92.6 | 93.3 | 89.2 | 95.1 | 92.7 | 94.1 |

> 表 2: Qwen3.6-27B 与前后代及前沿模型对比.

> **译者注**: SkillsBench 上 Qwen3.6-27B(48.2) 相对 Qwen3.5-397B-A17B(30.0) 提升 60%, 且模型规模缩小约 15 倍. Terminal-Bench 2.0(59.3) 与 Claude 4.5 Opus 持平. 纯知识任务(MMLU-Pro、SuperGPQA)仍略逊于 397B MoE 前代, 符合「Agent 能力靠训练、知识靠容量」的分工.

### 1.2 Vision-Language Benchmarks

#### 1.2.1 Qwen3.6-35B-A3B

| 基准 | Qwen3.5-27B | Claude-Sonnet-4.5 | Gemma4-31B | Gemma4-26B-A4B | Qwen3.5-35B-A3B | Qwen3.6-35B-A3B |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|
| **STEM 与谜题** |
| MMMU | 82.3 | 79.6 | 80.4 | 78.4 | 81.4 | 81.7 |
| MMMU-Pro | 75.0 | 68.4 | 76.9* | 73.8* | 75.1 | 75.3 |
| Mathvista(mini) | 87.8 | 79.8 | 79.3 | 79.4 | 86.2 | 86.4 |
| ZEROBench_sub | 36.2 | 26.3 | 26.0 | 26.3 | 34.1 | 34.4 |
| **通用 VQA** |
| RealWorldQA | 83.7 | 70.3 | 72.3 | 72.2 | 84.1 | 85.3 |
| MMBenchEN-DEV-v1.1 | 92.6 | 88.3 | 90.9 | 89.0 | 91.5 | 92.8 |
| SimpleVQA | 56.0 | 57.6 | 52.9 | 52.2 | 58.3 | 58.9 |
| HallusionBench | 70.0 | 59.9 | 67.4 | 66.1 | 67.9 | 69.8 |
| **文本识别与文档理解** |
| OmniDocBench1.5 | 88.9 | 85.8 | 80.1 | 74.4 | 89.3 | 89.9 |
| CharXiv(RQ) | 79.5 | 67.2 | 67.9 | 69.0 | 77.5 | 78.0 |
| CC-OCR | 81.0 | 68.1 | 75.7 | 74.5 | 80.7 | 81.9 |
| AI2D_TEST | 92.9 | 87.0 | 89.0 | 88.3 | 92.6 | 92.7 |
| **空间智能** |
| RefCOCO(avg) | 90.9 | -- | -- | -- | 89.2 | 92.0 |
| ODInW13 | 41.1 | -- | -- | -- | 42.6 | 50.8 |
| EmbSpatialBench | 84.5 | 71.8 | -- | -- | 83.1 | 84.3 |
| RefSpatialBench | 67.7 | -- | -- | -- | 63.5 | 64.3 |
| **视频理解** |
| VideoMME(w sub.) | 87.0 | 81.1 | -- | -- | 86.6 | 86.6 |
| VideoMME(w/o sub.) | 82.8 | 75.3 | -- | -- | 82.5 | 82.5 |
| VideoMMMU | 82.3 | 77.6 | 81.6 | 76.0 | 80.4 | 83.7 |
| MLVU | 85.9 | 72.8 | -- | -- | 85.6 | 86.2 |
| MVBench | 74.6 | -- | -- | -- | 74.8 | 74.6 |
| LVBench | 73.6 | -- | -- | -- | 71.4 | 71.4 |

> 表 3: Qwen3.6-35B-A3B 视觉语言基准对比.

> **译者注**: 3B 激活参数下 RealWorldQA(85.3)、RefCOCO(92.0)、ODInW13(50.8) 表现突出, 空间智能增强与视觉 Agent 定位高度一致.

#### 1.2.2 Qwen3.6-27B

| 基准 | Qwen3.5-27B | Qwen3.5-397B-A17B | Gemma4-31B | Claude 4.5 Opus | Qwen3.6-35B-A3B | Qwen3.6-27B |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|
| **STEM 与谜题** |
| MMMU | 82.3 | 85.0 | 80.4 | 80.7 | 81.7 | 82.9 |
| MMMU-Pro | 75.0 | 79.0 | 76.9 | 70.6 | 75.3 | 75.8 |
| MathVista mini | 87.8 | -- | 79.3 | -- | 86.4 | 87.4 |
| DynaMath | 87.7 | 86.3 | 79.5 | 79.7 | 82.8 | 85.6 |
| VlmsAreBlind | 96.9 | -- | 87.2 | -- | 96.6 | 97.0 |
| **通用 VQA** |
| RealWorldQA | 83.7 | 83.9 | 72.3 | 77.0 | 85.3 | 84.1 |
| MMStar | 81.0 | 83.8 | 77.3 | 73.2 | 80.7 | 81.4 |
| MMBenchEN-DEV-v1.1 | 92.6 | -- | 90.9 | -- | 92.8 | 92.3 |
| SimpleVQA | 56.0 | 67.1 | 52.9 | 65.7 | 58.9 | 56.1 |
| **文档理解** |
| CharXiv RQ | 79.5 | 80.8 | 67.9 | 68.5 | 78.0 | 78.4 |
| CC-OCR | 81.0 | 82.0 | 75.7 | 76.9 | 81.9 | 81.2 |
| OCRBench | 89.4 | -- | 86.1 | -- | 90.0 | 89.4 |
| **空间智能** |
| ERQA | 60.5 | 67.5 | 57.5 | 46.8 | 61.8 | 62.5 |
| CountBench | 97.8 | 97.2 | 96.1 | 90.6 | 96.1 | 97.8 |
| RefCOCO avg | 90.9 | 92.3 | -- | -- | 92.0 | 92.5 |
| EmbSpatialBench | 84.5 | -- | -- | -- | 84.3 | 84.6 |
| RefSpatialBench | 67.7 | -- | 4.7 | -- | 64.3 | 70.0 |
| **视频理解** |
| VideoMME(w sub.) | 87.0 | 87.5 | -- | 77.7 | 86.6 | 87.7 |
| VideoMMMU | 82.3 | 84.7 | 81.6 | 84.4 | 83.7 | 84.4 |
| MLVU | 85.9 | 86.7 | -- | 81.7 | 86.2 | 86.6 |
| MVBench | 74.6 | 77.6 | -- | 67.2 | 74.6 | 75.5 |
| **视觉 Agent** |
| V* | 93.7 | 95.8 | -- | 67.0 | 90.1 | 94.7 |
| AndroidWorld | 64.2 | -- | -- | -- | -- | 70.3 |

> 表 4: Qwen3.6-27B 视觉语言基准对比.

> **译者注**: V*(94.7) 接近 Qwen3.5-397B-A17B(95.8); AndroidWorld(70.3) 实现从零到领先; VlmsAreBlind(97.0) 说明视觉 grounding 鲁棒性极强.

## 2 Usage and Deployment

开源权重已在 Hugging Face / ModelScope 发布; 百炼 API 名称 `qwen3.6-flash` / `qwen3.6-27b`; 支持 OpenClaw、Claude Code、Qwen Code 集成.

**preserve_thinking**: 保留前序轮次思维内容, 推荐用于 Agent 任务, 避免多轮工具调用中「遗忘」中间结论.

API 兼容 OpenAI 与 Anthropic 接口; `enable_thinking` / `enable_search` 控制推理与搜索.

## 3 Summary

Qwen3.6-35B-A3B 证明稀疏 MoE 可在 3B 激活下交付旗舰 Agent 编程能力. Qwen3.6-27B 证明精心训练的稠密模型可在开发者关键任务上超越更大 MoE 前代.

> **译者注(局限风险)**: (1) 27B 稠密仍需约 60GB FP16 显存; 35B-A3B 的 MoE 路由在小 batch 下可能抵消稀疏优势. (2) 架构与训练细节披露有限. (3) QwenClawBench、QwenWebBench 等内部基准依赖外部脚手架, 可比性存疑. (4) 完整技术报告尚未发布.

## 全文完

## 关联文件说明

- 英文源资料整理稿: `03-Qwen3.6-mineru-en.md`
- 中文精译主稿: `01-Qwen3.6技术报告精译.md`
- D5 架构专题: `05-Qwen3.6-Architecture-Overview.md`
- D5 Index: `05-Qwen3.6-Index.md`
- 源资料: `pdfs/Qwen3.6.html`, `pdfs/README.md`
- 原文链接: https://qwen.ai/blog?id=qwen3.6-35b-a3b , https://qwen.ai/blog?id=qwen3.6-27b
