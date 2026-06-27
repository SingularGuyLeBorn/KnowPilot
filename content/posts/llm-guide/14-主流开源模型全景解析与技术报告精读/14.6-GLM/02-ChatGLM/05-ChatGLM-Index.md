---
title: "ChatGLM Index"
date: 2026-05-24
status: completed
tags:
  - GLM
  - ChatGLM
  - Zhipu
  - All-Tools
---

# ChatGLM 技术入口

> 返回上级：[14.6-GLM](../../14.6-GLM.md)

ChatGLM 是智谱 GLM 家族的**对话与对齐产品线**, 从 ChatGLM-6B(2023-03) 演进到 GLM-4 / GLM-4 All Tools(2024). 本目录覆盖 **GLM-130B → 三代 ChatGLM → GLM-4** 的谱系技术报告(arXiv:2406.12793).

## 文档导航

| 文件 | 说明 |
| --- | --- |
| [01-ChatGLM 系列技术报告精译](./01-ChatGLM系列技术报告精译.md) | 中文精译主稿(D2) |
| [03-ChatGLM-mineru-en](./03-ChatGLM-mineru-en.md) | MinerU 英文原文(D3) |
| [04-ChatGLM-mineru-zh](./04-ChatGLM-mineru-zh.md) | 逐段精译与译者注(D4) |
| [02-ChatGLM 核心架构剖析](./02-ChatGLM核心架构剖析.md) | 架构与开源生态(D2) |
| [05-ChatGLM-Architecture-Overview](./05-ChatGLM-Architecture-Overview.md) | GLM-4 能力专题 |

## 技术问题定义

ChatGLM 系列要解决的核心问题是: 在 GLM-130B 基座之上, 如何构建**持续迭代的中文对话模型**, 并最终达到与 GPT-4 可比的通用能力, 同时保持开源小模型(6B/9B)与 API 大模型的双线生态.

关键挑战:

1. **谱系连续性**: 不是单次发布, 而是 ChatGLM → ChatGLM2 → ChatGLM3 → GLM-4 的能力累积.
2. **中英双语对齐**: 10T+ token 预训练 + 多阶段 SFT/RLHF, 中文 AlignBench 需领先 GPT-4.
3. **Agent 化**: GLM-4 All Tools 需自主决定何时调用浏览器、Python、文生图等工具.

## 方法拆解

**预训练与架构**

- 继承 GLM 空白填充 + 双语语料(中英为主, 24 语言辅助).
- GLM-4 系列: 10T tokens, 128K/1M 长上下文变体.

**对齐流水线**

- 多阶段 post-training: SFT → RLHF/DPO 类人类反馈对齐.
- 指令跟随(IFEval)、长上下文、代码、函数调用分项优化.

**GLM-4 All Tools**

- 统一 agent 框架: 理解意图 → 选择工具(网页/Python/图像/用户函数) → 多步执行.
- 与 GPT-4 All Tools 对标 Web 浏览与数学求解.

**开源生态**

- ChatGLM-6B 三代、GLM-4-9B(128K/1M)、GLM-4V-9B、WebGLM、CodeGeeX 等.
- HuggingFace 2023 年下载量 1000 万+.

## 工程与架构分析

| 维度 | 要点 |
| --- | --- |
| 产品分层 | API 旗舰(GLM-4) + 开源可部署(6B/9B) |
| 能力栈 | 对话 → 代码 → 视觉 → Agent → All Tools |
| 评测 | MMLU/GSM8K/HumanEval + AlignBench(中文) + IFEval |
| 安全 | 独立 Safety and Risks 章节 |

**与 GLM-130B 关系**: 130B 是基座论文; ChatGLM 是对齐与产品化主线; GLM-4 是能力收敛点.

## 结论与适用边界

**适用**: 研究中国大模型谱系演化、双语对齐、开源+API 双轨策略、工具型 Agent 系统.

**边界**:

- 报告以 GLM-4 为主, 早期 ChatGLM-6B 细节相对简略.
- 部分 benchmark 为自测或特定 harness, 与第三方复现有偏差可能.
- All Tools 能力依赖外部工具链稳定性.
- 闭源满血 GLM-4 与开源 9B 能力差距显著.

**谱系**: GLM-130B → ChatGLM(1/2/3) → **GLM-4 / All Tools** → 后续 GLM-4.5V / GLM-5 系列.
