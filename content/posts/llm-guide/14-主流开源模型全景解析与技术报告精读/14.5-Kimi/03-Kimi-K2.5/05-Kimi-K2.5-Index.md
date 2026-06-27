---
title: "Kimi-K2.5 Index"
date: 2026-05-24
status: completed
tags:
  - Kimi
  - Moonshot
  - Multimodal
  - Agent-Swarm
  - Vision
---

# Kimi-K2.5 技术入口

> 返回上级：[14.5-Kimi](../../14.5-Kimi.md)

Kimi K2.5(arXiv:2602.02276, 2026-01)在 K2 万亿 MoE 基座上引入**原生多模态 Agentic 智能**: 文本-视觉联合预训练、零视觉 SFT、联合多模态 RL, 以及 **Agent Swarm** 并行编排(延迟最高降低 4.5×). SWE-bench Verified **76.8%**, VideoMMMU **86.6%**.

## 文档导航

| 文件 | 说明 |
| --- | --- |
| [01-Kimi-K2.5 技术报告精译](./01-Kimi-K2.5技术报告精译.md) | 中文精译主稿(D2) |
| [02-Kimi-K2.5 推理架构剖析](./02-Kimi-K2.5推理架构剖析.md) | Toggle / token 效率专题(D2) |
| [03-Kimi-K2.5-mineru-en](./03-Kimi-K2.5-mineru-en.md) | MinerU 英文原文(D3) |
| [04-Kimi-K2.5-mineru-zh](./04-Kimi-K2.5-mineru-zh.md) | 逐段精译与译者注(D4) |
| [05-Kimi-K2.5 架构专题](./05-Kimi-K2.5-Architecture-Overview.md) | MoonViT-3D / Agent Swarm 深度拆解 |

## 技术问题定义

K2 已在文本 Agent 任务上达到开源 SOTA, 但真实 Agent 工作负载大量涉及**视觉输入**(UI 截图、图表、文档扫描、长视频). K2.5 要回答:

1. 如何在固定 token 预算下联合优化文本与视觉, 避免「后期加视觉损害文本」?
2. 如何在视觉配对数据稀缺时仍激活强视觉推理(尤其工具调用)?
3. 复杂 Agent 任务串行执行延迟过高, 如何 learned parallelization?

## 方法拆解

**联合预训练(Early Fusion, 低视觉比例)**

- 固定视觉-文本 token 总预算下, **10% 视觉比例 + 从头融合** 优于 50%/80% 晚期融合(表 1 / 图 9).
- MoonViT-3D: SigLIP 初始化, 图像/视频统一 NaViT packing, 4× 时间压缩, 262K 上下文 mid-training.

**零视觉 SFT + 联合 RL**

- SFT 阶段仅文本轨迹(生成操作图像的 Python 代码), 激活视觉工具调用能力.
- 视觉 RL FLOPs 扩展持续提升视觉 benchmark; 视觉 RL 同时提升文本任务(正向迁移).

**Agent Swarm + PARL**

- 可训练编排器动态创建**冻结子智能体**, 并行分解子任务.
- PARL 奖励: 任务性能 + 并行度 + 完成度; 关键步骤指标(类 CPM)惩罚虚假并行.
- WideSearch: 目标 Item-F1 从 30%→70% 时, 单 Agent 耗时 7× 基线, Swarm 维持 ~0.6–1.6×.

**工程: DEP + Toggle**

- Decoupled Encoder Process: 视觉编码器前向/反向解耦, 多模态训练效率达纯文本 90%.
- Toggle RL: 交替长/短 CoT 预算, 平均减少 25–30% 输出 token.

## 工程与架构分析

| 组件 | 要点 |
| --- | --- |
| 基座 | Kimi K2 MoE(1.04T/32B act), 384 experts, MLA |
| 视觉 | MoonViT-3D + MLP projector, 原生分辨率 |
| 训练 | ViT 1T → Joint PT 15T → Long-ctx 262K → SFT → RL |
| Agent | 统一 Gym-like RL 环境; Computer Use / BrowseComp / WideSearch |
| 开源 | Post-trained checkpoint 开放(HuggingFace) |

**代表性成绩(论文报告)**: SWE-bench Verified 76.8, BrowseComp 74.9, MMMU Pro 78.5, VideoMMMU 86.6, AIME 2025 96.1.

## 结论与适用边界

**适用**: 需要开源多模态 Agent(代码+视觉+工具)、长视频理解、并行任务编排的研究与产品; 希望降低视觉 SFT 标注成本(零视觉 SFT 路径).

**边界**:

- Computer Use(OSWorld 等)仍略低于 Claude Opus 4.5 等闭源 GUI Agent.
- Agent Swarm 加速依赖任务可并行度; 本质串行推理收益有限.
- 零视觉 SFT 对需深层语义理解的视觉任务(情感、审美)可能不足.
- 部分 benchmark 与 GPT-5.2 thinking/xhigh 模式不完全可比.

**谱系**: K2(文本 Agent 开源标杆) → **K2.5(视觉 Agent + Swarm)** → K2.6(最新旗舰).
