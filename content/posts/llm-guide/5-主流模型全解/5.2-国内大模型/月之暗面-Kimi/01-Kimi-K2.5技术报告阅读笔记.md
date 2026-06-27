---
title: "Kimi K2.5 技术报告阅读笔记"
date: 2026-05-16
tags: [Kimi, K2.5, 多模态, MoE, Muon, Agent Swarm, MoonViT]
---

# Kimi K2.5 技术报告阅读笔记

> 本文整理 Kimi K2.5 技术报告的核心技术细节，涵盖模型架构(MoonViT-3D + MoE LLM)、预训练三阶段策略、后训练(SFT + RL)设计、Reward System 以及基础设施创新. 

---

## 1. 模型架构

### 1.1 MoonViT-3D 视觉Encoder 

Kimi K2.5 的视觉Encoder 从 **SigLIP-SO-400M** 初始化，采用创新的 3D 时空处理方式：

- **时空块(Spatio-Temporal Patch)** ：将连续 4 帧视频看作一个时空块，把 4 帧的 2D patches 展平打包为同一条 1D 序列
- **统一注意力**：同一个注意力机制同时处理空间与时间信息
- **时间压缩**：在进入 Projector 之前，对时间维度进行 4 倍压缩(Pooling)，使 K2.5 能在相同上下文窗口下处理比原本长 4 倍的视频内容

### 1.2 LLM 骨干网络

- **总参数量**：1.04T
- **激活参数**：32B
- **专家数量**：384 个专家，每 token 激活 8 个
- **稳定性优化**：使用 MuonClip + QK-Clip 防止训练不稳定

---

## 2. 预训练：三阶段策略

### 2.1 阶段一：ViT 训练(1T Token)

- 只优化 caption 生成的交叉熵损失
- 将 MoonViT-3D 对齐到 16B 级别的语言模型(Moonlight-16B-A3B)
- 主要更新 ViT 参数，LLM 参数冻结

### 2.2 阶段二：多模态联合预训练(约 10T Token)

- 同时训练 ViT、Projector 和 LLM
- 数据包含图文、视频-文本对
- 引入多模态交错数据(interleaved multimodal documents)

### 2.3 阶段三：纯文本精调(约 4T Token)

- 冻结 ViT，继续训练 LLM
- 提升文本推理能力和指令遵循能力
- 总预训练量约 15T Token

---

## 3. 后训练

### 3.1 监督微调(SFT)

**数据来源**：多模型合成 + 人工验证管线
- 使用多个开源模型生成候选回复
- 人工审核和过滤低质量样本
- 引入拒绝采样(Rejection Sampling)提升数据质量

**Zero-Vision SFT**：
- 一种创新训练策略：在部分 SFT 数据中**移除视觉输入**，仅保留文本指令和期望输出
- 这迫使模型在训练时就学会"不依赖视觉也能给出高质量回答"
- 提升了模型在视觉信息不足或模糊时的鲁棒性

### 3.2 强化学习(RL)

**统一环境 + 稳定的 token 级裁剪策略**：
- 将所有任务(问答、代码、数学、Agent 任务)统一到一个 RL 环境中
- 采用 token 级裁剪(Token-level Clipping)稳定训练，避免 GRPO 中的"Token Level X"问题

**Reward System 设计**：
- 规则奖励(Rule-based)：代码编译通过、数学答案正确等
- 模型奖励(Model-based)：用奖励模型评估生成质量
- 长度惩罚：防止模型过度生成

**更好的 Token 效率**：
- 通过精心设计 reward shaping，使模型在更少 token 下达到相同或更好的效果

---

## 4. 基础设施：Decoupled Encoder Process (DEP)

### 4.1 DEP 架构

Kimi K2.5 引入了 **Decoupled Encoder Process(解耦Encoder 进程)** ：

- **视觉Encoder (ViT)** 和**语言模型(LLM)** 运行在不同的进程/设备上
- ViT 处理完视觉输入后，将压缩后的视觉 token 发送给 LLM
- 两者可以独立扩缩容：视觉负载高时增加 ViT 实例，文本负载高时增加 LLM 实例

### 4.2 优势

- **资源利用优化**：视觉和文本计算特性不同，可以分别优化硬件配置
- **故障隔离**：ViT 或 LLM 一侧故障不影响另一侧
- **灵活部署**：支持纯文本模式(跳过 ViT)和纯视觉模式(预计算视觉特征)

---

## 5. 有意思的设计与发现

### 5.1 原生多模预训练的必要性

Kimi K2.5 的实验表明：**在预训练阶段就引入多模态数据**，比在纯文本预训练后"拼接"视觉模块的效果显著更好. 这验证了"多模态能力需要从头学习"的假设. 

### 5.2 Joint Multimodal Reinforcement Learning

传统的多模态模型通常在文本数据上做 RL，K2.5 则在**多模态混合数据**上做联合 RL：
- 同时包含图文问答、视频理解、纯文本推理等任务
- 这迫使模型学会"在视觉和文本信息之间灵活切换和融合"

### 5.3 Agent Swarm 与 PARL

Kimi K2.5 引入了 **Agent Swarm** 概念和 **PARL(Parallel Agent Reinforcement Learning)** 训练框架：

- **Agent Swarm**：多个智能体并行协作完成复杂任务
- **PARL**：让 Agent Swarm 在 RL 环境中训练，通过多智能体协作提升整体任务完成率
- 每个 Agent 有独立的策略，但共享基础模型参数

---

## 6. 总结

Kimi K2.5 的关键创新点：

| 维度 | 创新 |
|:-----|:-----|
| 架构 | MoonViT-3D 时空统一处理 + 1T MoE LLM |
| 预训练 | 三阶段渐进式多模态训练 |
| SFT | Zero-Vision SFT 提升视觉鲁棒性 |
| RL | 统一环境 + Token 级裁剪 + 多模态联合 RL |
| 基础设施 | DEP 解耦Encoder 进程 |
| Agent | Agent Swarm + PARL 多智能体训练 |

> 参考来源：[Kimi K2.5 技术报告阅读笔记](https://zhuanlan.zhihu.com/p/2000719027690030326)
