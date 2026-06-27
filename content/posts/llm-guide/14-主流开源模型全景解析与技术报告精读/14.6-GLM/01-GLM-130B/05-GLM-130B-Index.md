---
title: "GLM-130B Index"
date: 2026-05-24
status: completed
tags:
  - GLM
  - Zhipu
  - Bilingual
  - INT4
---

# GLM-130B 技术入口

> 返回上级：[14.6-GLM](../../14.6-GLM.md)

GLM-130B(ICLR 2023, arXiv:2210.02414)是首个在多项英文 benchmark 上**超越 GPT-3 175B** 的开源 100B+ 双语模型(130B 参数). 核心贡献: GLM 架构、DeepNorm 训练稳定、EGS 防 loss spike、**无后训练 INT4 量化**(4×RTX 3090 可推理).

## 文档导航

| 文件 | 说明 |
| --- | --- |
| [01-GLM-130B 顶会论文精译](./01-GLM-130B顶会论文精译.md) | ICLR 2023 中文精译(D2) |
| [03-GLM-130B-mineru-en](./03-GLM-130B-mineru-en.md) | MinerU 英文原文(D3) |
| [04-GLM-130B-mineru-zh](./04-GLM-130B-mineru-zh.md) | 逐段精译与译者注(D4) |
| [02-GLM-130B 二维 RoPE 推导](./02-GLM-130B二维RoPE数理推导.md) | 2D RoPE 数学专题 |
| [05-GLM-130B-RoPE](./05-GLM-130B-RoPE.md) | RoPE 工程实践 |

## 技术问题定义

2022 年 GPT-3 闭源, OPT-175B / BLOOM-176B 开源但性能不及 GPT-3. GLM-130B 要证明:

1. **100B+ 开源模型能否追上并超越 GPT-3?**
2. **100B 稠密模型训练如何克服 loss spike / 梯度爆炸?**
3. **100B 模型能否在消费级 GPU 上部署?**

同时提供完整双语(中英)能力, 挑战 ERNIE Titan 3.0 260B 等中文闭源模型.

## 方法拆解

**GLM 架构**

- 自回归空白填充: `[MASK]`(理解) + `[gMASK]`(生成) 统一目标.
- 双向上下文注意力(零样本 LAMBADA **80.2%**).
- DeepNorm Post-LN + RoPE + GLU-GeLU FFN.

**预训练**

- 400B tokens(中英 1:1), 768× A100 40G, 3D 并行(4 TP × 8 PP × 3 DP).
- MIP(Multi-task Instruction Pre-training): 5% 英文指令数据, 74 数据集.

**训练稳定性**

- **DeepNorm**: $\alpha = \sqrt{2N}$, Xavier 缩放 $(2N)^{-1/2}$.
- **EGS(Embedding Gradient Shrink)**: $\alpha=0.1$, `.detach()` 切断嵌入层大梯度.
- FP16 混合精度(非 BF16, 兼容 V100).

**INT4 推理**

- GLM 权重分布更窄 → 对称 INT4 几乎无损.
- 4× RTX 3090(24G) 或 8× RTX 2080 Ti(11G) 可运行 130B.

## 工程与架构分析

| 模块 | 工程要点 |
| --- | --- |
| 并行 | PipeDream-Flush 流水线, MFU ~32.5% |
| 稳定性 | 数月 spike 排查 → EGS 为关键 |
| 量化 | attn-dense / w2 分布决定 INT4 质量 |
| 开源 | 权重 + 代码 + 训练日志全公开 |
| 伦理 | CrowS-Pairs / StereoSet / RealToxicPrompts 主动评估 |

**关键 benchmark**: LAMBADA +5% vs GPT-3; MMLU 5-shot 44.8; BIG-bench-lite 零样本超 PaLM 540B; CLUE 超 ERNIE 260B +24%.

## 结论与适用边界

**适用**: 研究 100B 训练稳定性、双语 LLM、INT4 边缘部署; 理解 GLM 谱系(→ ChatGLM → GLM-4).

**边界**:

- 400B token 按 Chinchilla 仍 under-trained(130B 最优约 2.6T).
- 少样本 in-context learning 增益弱于 GPT-3(双向模型零样本已接近上限).
- 30% 激活维度 outlier 使 LLM.int8() 类方法不适用.
- 2022 伦理评估标准较初级.

**谱系地位**: 开源 100B+ **性能里程碑** → 后续 ChatGLM / GLM-4 家族的技术与工程基座.
