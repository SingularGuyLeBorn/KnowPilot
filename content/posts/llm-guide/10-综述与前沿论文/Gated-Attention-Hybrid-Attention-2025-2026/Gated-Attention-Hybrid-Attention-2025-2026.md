---
title: "Gated Attention 与混合注意力: 2025-2026 LLM架构最大突破"
date: 2026-05-07
tags:
  - Gated Attention
  - 混合注意力
  - Qwen3-Next
  - Linear Attention
  - Attention Sink
  - NeurIPS 2025
---

# Gated Attention 与混合注意力: 2025-2026 LLM 架构最大突破

> 本文基于 Gated Attention(NeurIPS 2025 Best Paper)作者自述、Qwen3-Next 完整技术解析、Qwen3.5-Plus 工业级实践等多篇最新资料撰写. 信息截至 2026 年 5 月. 

## 1. 背景: Attention Sink 问题的发现

2023 年,Streaming LLM 研究首次揭示了 **Attention Sink 现象**: 在多层 Transformer 中,越深的层越倾向于关注第一个 token(通常是 BOS 或句首 token),这些 token 像" sinks"一样吸收了大量的注意力权重. 

这个现象的背后原因直到 2025 年才被彻底理解. Qwen 团队在《Gated Attention for Large Language Models》一文中给出了关键洞察: 

> **Attention Sink 的根源在于 Softmax 的固有属性. ** Softmax 要求对所有输出求和为 1,因此即使某个位置的上下文信息与当前查询完全无关,模型也必须分配一些注意力权重到这个位置上——否则 Softmax 的归一化就会出问题. 

换句话说,**Attention Sink 不是 bug,而是 Softmax 约束下的必然产物. ** 当模型在某个位置上没有任何需要关注的信息时,它仍然需要维持注意力权重的总和为 1. 

## 2. Gated Attention: 从根源上消除 Attention Sink

### 2.1 核心思想

Gated Attention 的核心创新极其简洁: **在注意力输出后添加一个可学习的门控(gate)机制. **

具体实现: 

```python
# q_proj 中同时生成 query 和 gate
query_states, gate = torch.chunk(
    self.q_proj(hidden_states).view(*input_shape, -1, self.head_dim * 2),
    2, dim=-1
)

# 标准 attention 计算
attn_output = standard_attention(query_states, key_states, value_states)

# 门控筛选
attn_output = attn_output * torch.sigmoid(gate)
```

当上下文与当前查询无关时,门控输出接近 0,模型**不需要通过 Softmax 强行分配一个 Sink token**,而是通过门控将输出 Y 乘以一个接近 0 的系数,直接阻断信息流. 实验证实: Gated 模型的第一 token 注意力占比从 Baseline 的显著比例降到了接近 0. 

### 2.2 G1 位置的关键发现

Qwen 团队实验了四种门控放置位置: 

| 位置 | 描述 | 效果 |
|:----|:-----|:----:|
| **G1** | gate 在 Attn 输出后(Y × gate) | **最优** ✅ |
| G2 | gate 在 Softmax 前 | 无法使输出为 0 |
| G3 | gate 在 V 上 | 无法使输出为 0 |
| G4 | gate 在 Q 之前 | 最差 ❌ |

**G1 位置最优的原因**: 只有将门控放在注意力输出的最终位置,才能从根本上控制"模型是否需要输出任何信息"——这是门控消除 Attention Sink 的关键. 

### 2.3 稀疏性的引入

一个更深层的洞察是: **Attention 中需要稀疏性,但模型需要以 Sink 或 Gate 的方式来引入稀疏性. **

Sink 是 Softmax 强制归一化下的"被动稀疏",而 Gate 是数据依赖的"主动稀疏". 有效的稀疏性是一个重要的 inductive bias——它能加速模型收敛、提高训练稳定性、帮助模型更好地 Scaling. 

作者原话: 
> "我觉得很有启发的点包括: attention 中需要稀疏性,但是模型需要以 sink 或者 gate 的方式来引入稀疏性; 有效地引入稀疏性能加速模型的收敛(或者说合理的稀疏性是一个有效的 inductive bias)"

## 3. 从 Gated Attention 到混合注意力: Qwen3-Next 的实践

### 3.1 Hybrid Attention: Gated DeltaNet + Gated Attention 的 3:1 混合

Qwen3-Next 使用了 **Hybrid Attention** 架构——这是 Gated Attention 的第一次大规模工业落地. 设计如下: 

| 组件 | 比例 | 作用 |
|:----|:----:|:-----|
| **Gated DeltaNet**(线性注意力) | **3 份** | 高效长程依赖建模,无 KV Cache 瓶颈 |
| **Gated Attention**(标准注意力) | **1 份** | 精确召回,消除 Attention Sink |

3:1 的比例是 Qwen 团队大量实验调出来的最优比——在效率和精度之间取得最佳平衡. 

### 3.2 Gated DeltaNet: 线性注意力的进化终点

Gated DeltaNet 代表了线性注意力多年演化的终极形态. 要理解 Gated DeltaNet,需要先理解整个线性注意力的演进路线: 

#### Stage 1: 原始 Linear Attention
去掉 Softmax 和 Causal Mask 后,Attention 变成线性递推形式: 

$$S_t = S_{t-1} + v_t k_t^\top \tag{1}$$
$$o_t = S_t q_t \tag{2} $$
这里 $S_t \in \mathbb{R}^{d \times d}$ 是状态矩阵. 问题是: $S_t$ 容量有限,随着 step 增长会遗忘早期信息. 

#### Stage 2: 常数衰减(RetNet / Lightning Attention)
给 $S_{t-1}$ 一个常数衰减因子 $\gamma$: 

$$S_t = \gamma S_{t-1} + v_t k_t^\top \tag{3}$$

但 $\gamma$ 与数据无关,缺乏选择性更新能力. 

#### Stage 3: 数据依赖的衰减(Mamba-2 / Gated Retention)
让衰减因子 $\gamma_t$ 是输入的函数: 

$$S_t = \gamma_t S_{t-1} + v_t k_t^\top \tag{4} $$

#### Stage 4: Gated DeltaNet(终极形态)
将 SSM 的递归更新视为在线学习问题. 核心思想: 状态 $S_t$ 是一个将 $k_t$ 映射到 $v_t$ 的权重矩阵. 按照 Delta Rule(梯度下降)更新: 

$$S_t = S_{t-1} + \beta_t (v_t - S_{t-1} k_t) k_t^\top \tag{5}$$

这里的创新在于: **更新不再是简单的加法($v_t k_t^\top$),而是包含了误差项($v_t - S_{t-1}k_t$)的修正**——只有当模型对当前输入的预测 $S_{t-1}k_t$ 与真实值 $v_t$ 存在差异时,状态才会被更新. 这大大减少了状态被无关信息污染的程度. 

### 3.3 Qwen3-Next 的完整实现

Gated DeltaNet 的完整前向过程: 

```python
# 1. 获取 qkv + gate + 参数
projected = self.in_proj_qkvz(hidden_states)
query, key, value, z, b, a = split(projected)

# 2. Causal Conv1D 预处理
mixed_qkv = cat([query, key, value], dim=-1)
mixed_qkv = causal_conv1d_update(mixed_qkv, conv_state)

# 3. 计算衰减和门控
beta = sigmoid(b)
gate = -exp(A_log) * softplus(a + dt_bias)

# 4. Gated DeltaNet 递归更新
for i in range(num_heads):
    g_t = exp(gate[:, :, i])
    beta_t = beta[:, :, i]
    kv_mem = last_state * k_t[:, :, i].unsqueeze(-1)
    delta = (v_t - kv_mem) * beta_t
    last_state = last_state + k_t.unsqueeze(-1) * delta.unsqueeze(-2)
    output[:, :, i] = (last_state * q_t[:, :, i].unsqueeze(-1)).sum(dim=-2)
```

### 3.4 Zero-Centered RMSNorm

Qwen3-Next 在 Gated Attention 层使用 **Zero-Centered RMSNorm**,采用零初始化的可学习权重(weight=0),使得训练初期等价于恒等映射,逐步学习缩放. 相比 Qwen3 的 QK-Norm,Zero-Centered RMSNorm 配合 weight decay 可有效抑制部分层 norm weight 异常升高. 

## 4. Qwen3.5-Plus: 系统级的效率革命

### 4.1 架构规格

| 参数 | 数值 |
|:----|:-----|
| 总参数量 | **397B** |
| 激活参数量 | **17B**(4.2% 激活比例) |
| 架构 | Gated Attention + Linear Attention + MoE + MTP |
| 预训练数据 | **文本 + 视觉混合**(原生多模态) |

### 4.2 效率提升的四个维度

Qwen3.5-Plus 实现了 **4 项技术整合 → 约 19× 系统效率提升**: 

| 技术 | 单独提升 | 累积效果 |
|:----|:--------:|:--------:|
| **Hybrid Attention**(Gated + Linear) | ~5× | 长上下文下注意力计算和显存大幅降低 |
| **High-Sparsity MoE**(4.2% 激活) | ~2× | 相比 10% 激活比例节省更多计算 |
| **MTP 多 Token 预测** | ~1.5× | 投机采样友好,提高 Token 吞吐率 |
| **系统级叠加** | **~19×** | 单点技术叠加后的综合效率 |

> 注: 19× 不是简单的乘法叠加(5×2×1.5=15),而是实际综合效果接近 19 倍,反映了技术之间正协同效应. 

### 4.3 Benchmark 数据

| 基准 | Qwen3.5-Plus | 竞品对比 |
|:----|:------------|:--------|
| **MMLU-Pro** | **87.8** | > GPT-5.2 |
| **GPQA** | **88.4** | > Claude 4.5 |
| **IFBench** | **76.5** | SOTA |
| **BFCL-V4** | 领先 | > 多数闭源模型 |
| **AgentBrowseComp** | 领先 | > Gemini 3 Pro |

### 4.4 Agent 时代的成本公式

Qwen3.5-Plus 的实践提出了一个重要视角——**Agent 时代的真正成本公式**: 

$$\text{单位有效成本} = \frac{\text{GPU小时} \times \text{GPU数} / \text{tokens产出}}{\text{成功率}} \tag{6} $$
- **吞吐**(分子)决定"跑得多快、跑得多便宜"
- **成功率**(分母)决定"要不要返工、要不要重跑"

Qwen3.5-Plus 的关键贡献在于: **它不只是把"吞吐"做上去,而是把"聪明程度"也顶上去了**——否则吞吐提升,最后可能只是让你更快地出错. 

## 5. 参考资料

1. Gated Attention for Large Language Models: Non-linearity, Sparsity, and Attention-Sink-Free (NeurIPS 2025 Best Paper)
2. Gated Delta Networks: Improving Mamba2 with Delta Rule
3. Qwen3-Next: Towards Ultimate Training & Inference Efficiency (2025.9)
4. Qwen3.5-Plus 技术报告 (2026)
5. 知乎: 如何评价 Qwen 门控注意力 Gated Attention 获得 NeurIPS 最佳论文(作者自述)
6. 知乎: 如何评价阿里的新模型 Qwen3-Next-80B-A3B-Instruct(淘气堡)
7. 知乎: 阿里除夕夜发布 Qwen3.5 模型(平凡)
