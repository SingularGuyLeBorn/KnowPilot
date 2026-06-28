---
title: "GLM-5 核心架构剖析"
---

# GLM-5 核心架构剖析

>  **[返回 14.6-GLM 家族总览](../../14.6-GLM.md)**


> 基于 GLM-5 技术报告(arXiv:2602.15763)的架构深度分析,聚焦四大技术支柱:DSA 稀疏注意力、MLA+Muon Split、异步 Agentic RL 基础设施、国产芯片全栈适配.

---

## 1 架构总览

GLM-5 是一个 744B 总参数、40B 激活参数的 MoE 模型,采用 80 层 transformer 架构(3 层稠密 + 75 层 MoE).与 GLM-4.5(355B/32B)相比,参数规模翻倍,但核心创新不在于单纯的规模扩展,而在于四个维度的系统性优化:

| 维度 | GLM-4.5 | GLM-5 | 核心变化 |
|:---|:---|:---|:---|
| 注意力机制 | GQA-8 | MLA-256 + DSA | 从分组查询到潜在压缩+动态稀疏 |
| 推理加速 | 单 MTP 层 | 3 MTP 层(参数共享) | 接受长度 2.55 -> 2.76 |
| RL 基础设施 | slime v1 | slime v2(异步解耦) | 支持 1K+ 并发 rollouts |
| 芯片适配 | NVIDIA 为主 | 7 大国产平台 | 全栈深度优化 |

---

## 2 DSA: 从二次到线性的注意力革命

### 2.1 问题背景

标准 Transformer 的 self-attention 计算复杂度为 $O(L^2 \cdot d)$,其中 $L$ 为序列长度.当 $L=128K$ 时,注意力计算成为训练和推理的主要瓶颈.现有解决方案分为三类:

1. **固定模式稀疏**(如滑动窗口): 简单但内容无关,长距离依赖易丢失
2. **线性注意力**(如 GDN): 将 softmax 替换为线性核,但表达能力受限
3. **内容感知稀疏**(如 DSA): 动态选择重要 token,保持表达能力的同时降低复杂度

### 2.2 DSA 的两阶段机制

DSA 的核心是一个「lightning indexer」和一个「token selector」:

**阶段 1: Lightning Indexer**

为每个查询 token $q_t$ 计算与所有 key $k_i$ 的相似度分数,检索 top-$k$ 个最相关的 key-value 对:

$$
S_t = \text{TopK}_i\left( q_t \cdot k_i^T \right), \quad |S_t| = k
$$

在 GLM-5 中,$k=2048$,远小于序列长度(128K 或 200K).

**阶段 2: Sparse Attention**

注意力仅在检索到的子集 $S_t$ 上计算:

$$
\text{Attention}(q_t, K, V) = \text{softmax}\left( \frac{q_t \cdot K_{S_t}^T}{\sqrt{d_k}} \right) \cdot V_{S_t}
$$

> **[关键洞察]** 为什么 DSA 是无损的?
> 
> 固定模式稀疏(如滑动窗口)预设了「哪些 token 重要」,这 inevitably 会丢弃有用信息.DSA 的 indexer 是内容感知的——它为每个查询动态选择最相关的 token.实验表明,在长上下文中约 90% 的注意力条目是冗余的,DSA 通过只计算剩下的 10% 实现了 1.5-2 倍的计算 reduction,同时保持了与全注意力相当的性能.

### 2.3 持续预训练适配

DSA 的一个工程优势是可通过持续预训练从稠密模型迁移,无需从头训练:

1. **Warmup 阶段**: 冻结基座模型,仅训练 indexer 1000 步
2. **Joint-training 阶段**: 解冻所有参数,联合训练 20B token

GLM-4.7-Flash 上的实验表明,仅 warmup 就保留了 90%+ 的性能;联合训练 150B token 后,性能几乎完全恢复.

---

## 3 MLA + Muon Split: 压缩与优化的平衡

### 3.1 MLA 的基本原理

MLA(Multi-latent Attention)将 key 和 value 压缩到低维潜在向量,减少 KV Cache 内存:

- 标准 GQA-8: KV Cache 每 token 为 $2 \times 2048$ 维
- MLA: KV Cache 每 token 为 $576$ 维(压缩比 3.55x)

但 MLA 的原始实现在 Muon optimizer 下性能不如 GQA-8.问题在于 Muon 的正交化操作对所有注意力头共享,限制了不同头的独立优化.

### 3.2 Muon Split 的改进

Muon Split 将上投影矩阵 $W^{UQ}, W^{UK}, W^{UV}$ 按头拆分为独立子矩阵:

$$
W^{UQ} = [W^{UQ}_1, W^{UQ}_2, \dots, W^{UQ}_h], \quad \text{对每个 } W^{UQ}_i \text{ 独立正交化}
$$

这使不同头的投影权重可以以不同尺度更新,实验显示 MLA + Muon Split 在 4/7 基准上超越了 GQA-8.

### 3.3 MLA-256: 降低解码成本

MLA 的另一个问题是解码阶段的高计算成本(576 维点积 vs GQA 的 128 维).GLM-5 将头维度从 192 增加到 256,头数减少 1/3,保持训练计算不变的同时降低了解码 FLOPs.

---

## 4 异步 Agentic RL: 基础设施创新

### 4.1 同步 RL 的瓶颈

在 agentic 任务中,rollout 长度差异极大:简单任务可能只需 10 步,复杂任务可能需要 1000+ 步.同步 RL 等待所有 rollout 完成后才进行梯度更新,导致大量 GPU 空闲时间.

### 4.2 完全异步架构

GLM-5 的异步 RL 将推理引擎和训练引擎物理分离:

```
推理引擎(GPU Cluster A)          训练引擎(GPU Cluster B)
     |                                    |
  持续生成轨迹  -------------------->  批量接收轨迹
     |                                    |
  权重定期同步  <--------------------  梯度更新
```

关键设计:
- **TITO(Token-in-Token-out)**: 直接传输 token IDs,避免文本往返的 tokenization 不一致
- **Direct Double-sided Importance Sampling**: 丢弃 $\pi_{\theta_{\text{old}}}$,直接用 rollout 概率作为行为代理,简化 off-policy 修正
- **DP-aware Routing**: 通过一致性哈希将同一 rollout 的请求路由到固定 DP rank,最大化 KV Cache 复用

### 4.3 多任务 Rollout Orchestrator

中央编排器管理超过 1K 并发 rollouts,支持:
- 动态任务采样比例调整
- 统一消息列表表示(隔离任务特定逻辑)
- 细粒度任务进度监控

---

## 5 国产芯片全栈适配

### 5.1 混合精度量化策略

| 组件 | 精度 | 原因 |
|:---|:---|:---|
| Attention & MLP | W8A8 (INT8) | 平衡精度与速度 |
| MoE Experts | W4A8 (INT4) | 最大内存节省 |

采用 QuaRot 进行 outlier 抑制,Flex_AWQ_SSZ 进行缩放校准.

### 5.2 定制融合内核

- **Lightning Indexer**: 融合分数计算、ReLU、TopK 为单内核
- **Sparse Flash Attention**: 并行处理 TopK 选择和稀疏注意力
- **MLAPO**: 将 13 个小算子融合为「超级算子」

### 5.3 推理引擎优化

- **异步调度**: 重叠 D2H 采样复制与下一步解码准备
- **RadixCache + Prefix Cache**: KV 前缀共享+系统内存扩展
- **FlashComm**: 拆分 AllReduce 以隐藏通信延迟
- **MTP**: 每步多 token 生成,提升 NPU 计算密度

---

## 6 与前沿模型的架构对比

| 维度 | GLM-5 | DeepSeek-V3.2 | Kimi K2.5 | Claude Opus 4.5 |
|:---|:---|:---|:---|:---|
| 总参数 | 744B | 约 320B | 约 1T | 未公开 |
| 激活参数 | 40B | 37B | 32B | 未公开 |
| 注意力 | MLA + DSA | MLA + NSA | MLA | 未公开 |
| 上下文 | 200K | 128K | 262K | 200K |
| 专家数 | 256 | 256 | 384 | 未公开 |
| RL 框架 | slime(异步) | 同步 GRPO | 同步 | 未公开 |
| 芯片生态 | 7 大国产+NVIDIA | NVIDIA | NVIDIA | 未公开 |
| 开源协议 | MIT | MIT | Modified MIT | 专有 |

---

## 7 关键公式索引

| 编号 | 公式 | 说明 |
|:---:|:---|:---|
| (1) | IcePop 优化损失 | Reasoning RL 的核心目标函数,含 pop 算子和训练-推理不匹配比率 |
| (2) | 组级策略优化 | Agentic RL 的基础目标,仅优化模型生成 token |
| (3) | Token 级重要性采样 | 异步 RL 的简化 off-policy 修正,丢弃历史策略追踪 |
| (4) | 校准函数 | 双边裁剪机制,将信任区域限制在 $[1-\epsilon_\ell, 1+\epsilon_h]$ |
| (5) | Cross-stage Distillation 优势 | 用教师模型概率与学生模型概率的比值作为优势 |

---

## 8 总结

GLM-5 的架构设计体现了「效率优先」的哲学:不是单纯追求最大参数规模,而是在给定计算预算下最大化 agentic 能力.其四大支柱——DSA(降低注意力成本)、MLA+Muon Split(降低 KV Cache 成本)、异步 RL(提升训练效率)、国产芯片适配(降低部署成本)——共同构成了一个从训练到推理、从云端到端侧的完整效率优化体系.这种系统性方法使 GLM-5 在 744B 总参数的规模上实现了与千亿级模型相当的 agentic 性能,同时保持了对消费级硬件的友好性.
