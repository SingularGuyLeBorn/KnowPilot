---
title: "GLM-4-Voice Index"
date: 2026-05-24
status: completed
tags:
  - GLM
  - Voice
  - Speech-LLM
---

# GLM-4-Voice 技术入口

> 返回上级：[14.6-GLM](../../14.6-GLM.md)

GLM-4-Voice(arXiv:2412.02612)是智谱首个**端到端语音对话**模型: 12.5Hz / **175bps** 单码本监督语义 token + Flow Matching 解码器 + GLM-4-9B 基座, 1T token 语音-文本联合预训练, 支持中英实时对话与情感/语调/方言控制.

## 文档导航

| 文件 | 说明 |
| --- | --- |
| [01-GLM-4-Voice 技术报告精译](./01-GLM-4-Voice技术报告精译.md) | 中文精译主稿(D2) |
| [03-GLM-4-Voice-mineru-en](./03-GLM-4-Voice-mineru-en.md) | MinerU 英文原文(D3) |
| [04-GLM-4-Voice-mineru-zh](./04-GLM-4-Voice-mineru-zh.md) | 逐段精译与译者注(D4) |
| [05-GLM-4-Voice-Architecture-Overview](./05-GLM-4-Voice-Architecture-Overview.md) | 低延迟与 Streaming Thoughts 专题 |

## 技术问题定义

语音对话模型面临三重矛盾:

1. **数据稀缺**: 真实语音语料远少于文本, 如何迁移 GLM-4 的文本知识?
2. **延迟**: 级联 ASR+LLM+TTS 串行延迟高, 如何实现低首包延迟?
3. **表达力**: 语义 token 码率低但丢声学细节, 如何兼顾 intelligibility 与 naturalness?

GLM-4-Voice 选择「监督语义 token + 专用解码器 + 文本-语音交错预训练」路线, 对标 Moshi / Llama-Omni 等端到端方案.

## 方法拆解

**Speech Tokenizer (175bps, 12.5Hz)**

- 从 Whisper ASR Encoder **中间层**插入 VQ 瓶颈, 单码本 EMA 码本.
- 池化 50Hz→12.5Hz, 比 RVQ 声学 codec 更适合自回归 LLM.

**Speech Decoder**

- Flow Matching 两阶段: 预训练(脏数据) + 微调(干净数据).
- 从离散 token 重建波形, 补全声学细节.

**GLM-4-Voice 主体**

- 基座 GLM-4-9B-Base; 1T token 预训练(455B Speech-Text 交错 + 31B 纯语音 + 10T 文本 0.03 epoch).
- **Streaming Thoughts**: 13 文本 token : 26 语音 token 交替, 降低首包延迟(~3s).
- SFT: 损失掩码分离 S→T 与 S→S 目标; 20 epoch 语音 / 4 epoch 文本.

## 工程与架构分析

| 模块 | 工程要点 |
| --- | --- |
| 码率 | 175bps vs Mimi 1.1Kbps, MOS 仍达 3.39 |
| 推理 | 解耦 S→T 再 S→S + Streaming 模板 |
| 评测 | Llama Questions S→S 50.7% vs Moshi 21.0% |
| 开源 | GitHub THUDM/GLM-4-Voice |

**与 Moshi 对比**: Moshi 堆 700 万小时真实语音; GLM-4-Voice 用**合成交错数据**做知识迁移, 数据效率更高.

## 结论与适用边界

**适用**: 端到端语音 Agent、低码率语音 token 研究、中英双语口语交互.

**边界**:

- S→T 仍优于 S→S, 纯语音推理未完全替代文本中间表示.
- 评测部分限制英文输出, 掩盖双语真实表现.
- GPT-4o judge + ASR 转写评测存在方法论偏差.
- hybrid_auto 仅 2 张主文图, 部分表格依赖 MinerU details 块.

**谱系**: GLM-4 文本平台 → **GLM-4-Voice** 语音模态扩展.
