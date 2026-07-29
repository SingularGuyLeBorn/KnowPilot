---
title: "算法类：Transformer 与注意力机制"
category: null
tags:
  - "算法"
  - "Transformer"
  - "Attention"
  - "RoPE"
  - "MoE"
  - "positional-encoding"
published: true
excerpt: null
---
# 算法类：Transformer 与注意力机制

> ⚠️ **时效性说明**：本专题题目覆盖 2024-2026 年高频考点。经典题（如 Self-Attention 缩放）持续有效；前沿题（如 MLA）请关注最新模型实现。
>
> **来源**：掘金面试题、AgentGuide 面经、小林笔记、牛客面经

---

## 1. Self-Attention 的 Softmax 之前为什么要除以 $\sqrt{d_k}$？

- **元数据**：`{topic: "算法·数学推导", quality: ⭐⭐⭐⭐⭐, year: "经典题·持续有效", difficulty: mid}`
- **来源**：cnblogs LLM八股、掘金

**核心要点**：
- $Q K^{T}$ 的方差随 $d_k$ 增大而增大（$\approx d_k$），不缩放则 Softmax 进入饱和区，梯度消失
- 除以 $\sqrt{d_k}$ 后方差稳定在 $\sim 1$，梯度正常流通

设 $q_i,k_j \sim \mathcal{N}(0,1)$ 独立，则 $\mathrm{Var}(q\cdot k)=d_k$。缩放后：

$$
\mathrm{Var}\left(\frac{q\cdot k}{\sqrt{d_k}}\right)=1,\qquad
\mathrm{Attention}(Q,K,V)=\mathrm{softmax}\left(\frac{QK^{T}}{\sqrt{d_k}}\right)V
$$

**面试追问**：「$d_k=4096$ 不缩放会怎样？」→ Softmax 几乎 one-hot，反向梯度 $\approx 0$，无法训练。

> ✅ **时效判断**：经典题，2025/2026 持续高频出现。

---

## 2. 位置编码方式对比：Sinusoidal → RoPE → ALiBi

- **元数据**：`{topic: "算法·架构演进", quality: ⭐⭐⭐⭐⭐, year: "2024-2026", difficulty: mid}`
- **来源**：AgentGuide 面经、小林笔记

| 方式 | 原理 | 外推能力 | 代表模型 |
|---|---|---|---|
| Sinusoidal (绝对) | 正弦/余弦固定 | 有限 | Transformer 原始 |
| 可学习 (BERT) | 训练学到 | ❌ | BERT |
| **RoPE** (旋转) | 在 QK 上做旋转变换 | ✅ 优秀 | LLaMA, Qwen, DeepSeek |
| ALiBi | 注意力分数加线性偏置 | ✅ 简单 | MPT, Bloom |

**RoPE 核心**：在高维空间旋转 $Q$/$K$，使内积仅与相对位置差有关：

$$
\langle \mathrm{RoPE}(q,m),\mathrm{RoPE}(k,n)\rangle = \langle q,\, R(n-m)\, k\rangle
$$

**追问**：「RoPE 为什么能外推？」→ 旋转连续，超长位置只是更大转角，不会 OOD。

> ✅ **时效判断**：2025-2026 面试高频，每个大模型岗几乎必问。

---

## 3. MHA → MQA → GQA → MLA 的演进

- **元数据**：`{topic: "算法·注意力变体", quality: ⭐⭐⭐⭐⭐, year: "2025-2026", difficulty: senior}`
- **来源**：小林笔记、AgentGuide

| 变体 | 共享方式 | KV Cache 节省 | 代表模型 |
|---|---|---|---|
| **MHA** (Multi-Head) | 每头独立 Q/K/V | 基线 | Transformer 原始 |
| **MQA** (Multi-Query) | 所有头共享 K/V | ~80% | PaLM, Falcon |
| **GQA** (Grouped-Query) | 分组共享 K/V | ~50% | LLaMA 2/3, Mistral |
| **MLA** (Multi-head Latent) | 低秩投影 K/V | 极大幅 | DeepSeek V2/V3 |

**追问**：「MQA 效果为什么没降太多？」→ K/V 编码内容信息，多头多样性来自 Q，共享 K/V 损失有限。

> ✅ **时效判断**：2025-2026 新兴高频题。DeepSeek MLA 在 2025 年面试中大量出现。

---

## 4. Transformer 计算量分布与稀疏注意力优化

- **元数据**：`{topic: "算法·工程优化", quality: ⭐⭐⭐⭐, year: "2024-2026", difficulty: mid}`
- **来源**：AgentGuide 面经

**答案**：注意力 $QK^{T}$ 矩阵乘法复杂度 $O(n^{2}\cdot d)$，序列越长占比越大。$n=4096$ 时注意力约占 $60\%$，$n=8192$ 时约占 $80\%$。

**常见优化**：
| 方案 | 原理 | 复杂度 |
|---|---|---|
| Sparse Attention (Longformer/BigBird) | 只计算局部+少数全局位置 | $O(n\cdot\log n)$ |
| FlashAttention | 分块 + 重计算 + IO 感知 | $O(n^{2})$，实测约 $2\text{–}4\times$ |
| Linear Attention (Performer) | 核方法近似 | $O(n)$ |

> ✅ **时效判断**：FlashAttention 在 2025-2026 面试中已替代传统稀疏注意力成为主流考点。

---

## 5. MoE (Mixture of Experts) 的负载均衡与分布式

- **元数据**：`{topic: "算法·架构", quality: ⭐⭐⭐⭐⭐, year: "2025-2026", difficulty: senior}`
- **来源**：掘金、小林笔记、AgentGuide

**核心组件**：Gate Network（选 top-k 专家）+ Experts（子网络）+ Load Balancing Loss

**面试必问三点**：
1. **负载均衡 Loss**：防止所有 token 选同一个专家，给 Gate 加辅助 loss 鼓励均分
2. **Expert Capacity**：限制每个专家最大处理 token 数，超出的 token 走 bypass
3. **分布式部署**：专家可以放在不同 GPU 上，Gate 做路由。DeepSeek V2 做了细粒度 expert 分裂

> ✅ **时效判断**：2025-2026 超高频。DeepSeek V2/R1、Mixtral 8×7B、Grok 都用 MoE。

---

## 6. 手撕代码实战题

- **元数据**：`{topic: "算法·手撕", quality: ⭐⭐⭐⭐, year: "2024-2026", difficulty: mid~senior}`
- **来源**：牛客面经、AgentGuide 面经

**2025-2026 高频手撕题**：

| 题目 | 出现频次 | 难度 |
|---|---|---|
| Attention forward 手写 | ⭐⭐⭐⭐⭐ | mid |
| Top-K softmax | ⭐⭐⭐⭐ | junior |
| AdamW 优化器实现 | ⭐⭐⭐ | senior |
| RoPE 旋转变换实现 | ⭐⭐⭐ | senior |
| sqrt(x) 保留精度 | ⭐⭐⭐ | junior |

> ✅ **时效判断**：手撕 Attention forward 在 2025-2026 面试中出现率极高。RoPE 手撕是 2025 新增题。

---

## 来源汇总

- 掘金·大模型面试题讲解 — Transformer/MoE 基础
- AgentGuide 12-company-interview-cases — 大厂真实面试题
- cnblogs MoonOut LLM八股 — 注意力机制系统题
- xiaolinnote.com — RoPE/MHA→GQA/MLA 图解
- involutionhell.com — KV/QKV 深度解析

**🔍 下次搜索关键词**：FlashAttention tiling 细节、MHA 计算量分布数学推导、DeepSeek MoE 细粒度 expert 实现
