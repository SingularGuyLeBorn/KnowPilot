---
title: "01 · GQA与MQA源码实现分析"
date: 2026-05-17
tags: [GQA, MQA, MHA, KV Cache, SDPA, PyTorch, C++, 性能优化]
---
# 01 · GQA与MQA源码实现分析

## 1. 演进脉络与技术背景 (Evolution & Context)

在自回归大语言模型 (LLM) 推理中, 自注意力机制面临严重的内存带宽瓶颈. 自回归生成每次仅生成一个 Token, 这一过程被称为解码阶段 (Decode Phase). 在解码过程中, 模型需要频繁读取历史 Token 的 Key 和 Value 向量以计算注意力权重. 为了避免重复计算, 工程上普遍采用 KV Cache 缓存技术.

然而, 随着序列长度的增加和并发请求 (Batch Size) 的增大, KV Cache 的物理显存占用呈现出线性增长, 成为制约大模型高吞吐服务的首要障碍.

### 1.1 前代局限与内存屏障

在标准多头注意力 (MHA, Multi-Head Attention) 中, 每个注意力头独立投影出各自的 Query, Key 和 Value 向量. 设隐藏层维度为 $d_{model}$, 注意力头数为 $h$, 每个头的维度为 $D_{head} = d_{model} / h$.

当采用双字节浮点数 (FP16/BF16) 精度存储时, 对于 Batch Size 为 $B$, 序列长度为 $S$ 的推理服务, 单层 KV Cache 占用的显存字节数为:

$$
M_{\text{MHA}} = 4 \cdot B \cdot S \cdot h \cdot D_{head} \tag{1}
$$

其中系数 4 代表 Key 和 Value 两个张量(各占 2 字节). 当模型层数为 $N_{\text{layer}}$ 时, 总显存开销直接乘以 $N_{\text{layer}}$. 在高并发(如 $B=64$)和长文本(如 $S=4096$)的生产场景下, KV Cache 显存占用可达数十甚至上百吉字节 (GB), 迫使系统降低 Batch Size, 导致 GPU 计算核心 (Tensor Core) 大量处于空转状态.

### 1.2 替代方案的演进逻辑

为了消除 KV Cache 的显存瓶颈, 研究人员探索了注意力头维度的共享机制:

1. **多查询注意力 (MQA, Multi-Query Attention)**: 由 Noam Shazeer 在 2019 年提出. 其核心逻辑是让所有 Query 头共享单一的一对 Key 和 Value 头. 这使得 KV Cache 的显存消耗降低了 $h$ 倍. 然而, 由于极端的参数共享, MQA 丢弃了 Key/Value 的多空间表达能力, 导致模型在长文本召回、多轮对话和复杂推理任务中出现显著的精度退化.
2. **分组查询注意力 (GQA, Grouped-Query Attention)**: 由 Ainslie 等人在 2023 年提出, 是 MHA 与 MQA 的折中方案. GQA 将 Query 头分为 $g$ 个组, 每一组内的 Query 头共享一对独立的 Key 和 Value 头. 这种设计在保留大部分多空间表达能力的同时, 大幅度压缩了 KV Cache 的显存带宽需求, 成为现代 LLM (如 Llama-3, Mistral) 的标准配置.

---

## 2. 工业价值与应用场景 (Significance & Deployment)

GQA 在实际部署中带来了算力能效比的提升. 通过将 Key/Value 头数压缩 $8$ 倍(如 Llama-3-70B 中 $h_q=64, h_{kv}=8$, 组大小为 8), 推理服务可以在有限的显存资源内支持更大的 Batch Size.

在生产级推理服务(如 vLLM 和 TensorRT-LLM)中, GQA 带来的吞吐量提升达到 $2$ 到 $3$ 倍. 这直接缩减了云端 GPU 租赁成本, 使百万 Token 推理的部署成本下降了 60% 以上.

---

## 3. 数学推导与公式对比 (Mathematical Rigor)

我们从张量映射和投影矩阵的角度, 严格形式化 MHA, MQA 和 GQA 的数学表达.

设输入特征矩阵为 $X \in \mathbb{R}^{S \times d_{model}}$. 定义 Query, Key 和 Value 的线性投影矩阵分别为 $W_Q \in \mathbb{R}^{d_{model} \times d_{model}}$, $W_K \in \mathbb{R}^{d_{model} \times d_{model}}$, $W_V \in \mathbb{R}^{d_{model} \times d_{model}}$.

在 MHA 中, 投影输出为:

$$
Q = X W_Q, \quad K = X W_K, \quad V = X W_V \tag{2}
$$

在 GQA 中, 设 Query 头数为 $h_q$, Key/Value 头数为 $h_{kv}$, 组大小为 $g = h_q / h_{kv}$. 投影矩阵被重组为分组共享模式:

$$
W_Q = [W_{Q,1}, W_{Q,2}, \dots, W_{Q,h_q}] \tag{3}
$$

$$
W_K = [W_{K,1}, W_{K,2}, \dots, W_{K,h_{kv}}] \tag{4}
$$

$$
W_V = [W_{V,1}, W_{V,2}, \dots, W_{V,h_{kv}}] \tag{5}
$$

对于第 $i \in \{1, \dots, h_q\}$ 个 Query 头, 其对应的 Key 和 Value 投影头索引由如下映射关系确定:

$$
\text{map}(i) = \left\lceil \frac{i}{g} \right
\rceil \tag{6}
$$

因此, 第 $i$ 个 Query 头的注意力输出计算公式为:

$$
O_i = \text{softmax}\left(\frac{Q_i K_{\text{map}(i)}^T}{\sqrt{D_{head}}}\right) V_{\text{map}(i)} \tag{7}
$$

在 MQA 中, $h_{kv} = 1$, 映射关系退化为 $\text{map}(i) = 1$, 所有的 Query 头全部与同一个 Key/Value 头进行点积与加权求和.

通过将公式 (7) 与标准多头注意力进行对比, 可以清晰地看出: **GQA 在数学本质上是通过引入分组映射函数 $\text{map}(i)$, 在空间维度上强制对 Key 和 Value 进行了局部的低秩共享.**

---

## 4. 算力成本与数值走查 (Numerical Walkthrough)

为了论证三者的显存占用和计算延迟差异, 我们针对 Llama-3-8B 模型进行严密的数值走查.

### 4.1 典型配置参数

- **Batch Size** $B = 32$
- **序列长度** $S = 4096$
- **层数** $N_{\text{layer}} = 32$
- **Query 注意力头数** $h_q = 32$
- **Key/Value 注意力头数** $h_{kv} = 8$ (GQA 组大小 $g = 4$)
- **头维度** $D_{head} = 128$
- **数据精度** FP16 (2 字节)

### 4.2 KV Cache 显存占用定量对比

#### 4.2.1 多头注意力 (MHA)

在 MHA 下, $h_{kv} = h_q = 32$. 单层 KV Cache 大小为:

$$
M_{\text{MHA, layer}} = 2 \times 32 \times 4096 \times 32 \times 128 \times 2\text{ bytes} = 2,147,483,648\text{ Bytes} \approx 2.0\text{ GB} \tag{8}
$$

(
总显存开销（32 层)为:

$$
M_{\text{MHA, total}} = 32 \times 2.0\text{ GB} = 64.0\text{ GB} \tag{9}
$$

#### 4.2.2 分组查询注意力 (GQA)

在 GQA 下, $h_{kv} = 8$. 单层 KV Cache 大小为:

$$
M_{\text{GQA, layer}} = 2 \times 32 \times 4096 \times 8 \times 128 \times 2\text{ bytes} = 536,870,912\text{ Bytes} \approx 0.5\text{ GB} \tag{10}
$$

(
总显存开销（32 层)为:

$$
M_{\text{GQA, total}} = 32 \times 0.5\text{ GB} = 16.0\text{ GB} \tag{11}
$$

#### 4.2.3 多查询注意力 (MQA)

在 MQA 下, $h_{kv} = 1$. 单层 KV Cache 大小为:

$$
M_{\text{MQA, layer}} = 2 \times 32 \times 4096 \times 1 \times 128 \times 2\text{ bytes} = 67,108,864\text{ Bytes} \approx 0.0625\text{ GB} \tag{12}
$$

(
总显存开销（32 层)为:

$$
M_{\text{MQA, total}} = 32 \times 0.0625\text{ GB} = 2.0\text{ GB} \tag{13}
$$

---

## 5. PyTorch与C++源码对照 (Source Code Deep Dive)

### 5.1 SDPA 接口定义与 GQA 开关

在 PyTorch 中, `scaled_dot_product_attention` 是高内聚底层算子的前瞻派发入口.

```python
def scaled_dot_product_attention(
    query: Tensor,
    key: Tensor,
    value: Tensor,
    attn_mask: Tensor | None = None,
    dropout_p: float = 0.0,
    is_causal: bool = False,
    scale: float | None = None,
    enable_gqa: bool = False,  # GQA 模式启用开关
) -> Tensor:
    ...
```

### 5.2 CPU / GPU 内部实现 C++ 核心逻辑

(
当 `enable_gqa` 为真时, 底层 C++ 核心派发逻辑（以 ATen 算子库为准)将对 Key 和 Value 执行基于跨步重映射的物理广播扩展.

```cpp
// C++ 核心机制 (ATen 源码架构简化对照)
Tensor scaled_dot_product_attention_backward_cpu(
    const Tensor& grad_out, const Tensor& query, const Tensor& key, const Tensor& value,
    const Tensor& logsumexp, const Tensor& out, double scale, bool is_causal) {
  
  // FP16/BF16 输入处理, 精度保障机制
  auto query_acc = !ctx.allowFP16BF16ReductionMathSDP() &&
                   (query.scalar_type() == at::kHalf || query.scalar_type() == at::kBFloat16)
      ? query.to(at::kFloat)
      : query;
    
  int64_t B = query.size(0);
  int64_t H_q = query.size(1);
  int64_t H_kv = key.size(1);
  int64_t S = query.size(2);
  int64_t D = query.size(3);
  
  int64_t group_size = H_q / H_kv;
  
  // 当 H_q != H_kv 时, 激活 GQA 广播映射
  Tensor k_expanded = key;
  Tensor v_expanded = value;
  if (group_size > 1) {
      // 物理重组: shape 展开为 [B, H_kv, 1, S, D] -> expand 广播 -> 重塑为 [B, H_q, S, D]
      k_expanded = key.unsqueeze(2).expand({B, H_kv, group_size, S, D}).reshape({B, H_q, S, D});
      v_expanded = value.unsqueeze(2).expand({B, H_kv, group_size, S, D}).reshape({B, H_q, S, D});
  }
  
  // 核心的融合注意力计算 (Fused Kernel) 调度
  return sdp_math_cpu(query_acc, k_expanded, v_expanded, scale, is_causal);
}
```

---

## 6. 边界条件与失效模式 (Failure Modes & Edge Cases)

虽然 GQA 极大降低了内存带宽压力, 但在极端物理边界下, 它会触发显著的系统性能退化或数值失效.

### 6.1 极端组大小导(表达力崩塌

如果组大小 $g$ 设置过大（例如在 $h_q=32$ 时设置 $h_{kv}=2$, $g=16$), 模型的困惑度 (Perplexity) 会在长文本续写任务中急剧上升. 物理原因在于: 当过多的 Query 头共享同一对 Key/Value 时, 不同头对“时序距离”和“语义焦点”的捕捉能力发生严重的均值重叠, 使多头注意力退化为单一注意力, 在处理长文本的“大海捞针”测试 (Needle In A Haystack) 时召回率会呈现断崖式下跌.

### 6.2 显存对齐与非连续访存导致的延迟雪崩(

在 GPU 层面, `expand` 操作是一个 lazy 变换, 它仅改变张量的 Stride（跨步)属性, 而不实际分配连续的显存空间.
如果后续的 Attention 计算 Kernel 没有针对非连续 (Non-contiguous) 内存访问进行高度优化, GPU 线程块在读取 Key/Value 矩阵时会发生频繁的**非合并内存访问 (Uncoalesced Memory Access)**. 这会导致大量的显存访问事务排队, 使计算延迟不降反升.
(
**工程防护手段**: 在将 K 和 V 送入核心注意力计算 Kernel 之前, 必须通过执行 `.contiguous()` 强制在 GPU HBM 中进行一次显存物理规整, 或者直接采用支持非连续 Stride 输入的高性能融合算子（如 FlashAttention-2 专属接口).

---

## 7. 技术前瞻与演进 (Future Directions)

随着长文本序列向百万级别演进, GQA 仍存在优化的空间.

### 7.1 MLA (Multi-head Latent Attention)

在 2024 年, MLA 作为一种更为激进的注意力变体被提出. 它通过低秩投影将 Key 和 Value 压缩到一个隐空间 (Latent Space) 维度中:

$$
h_{kv\_latent} \ll d_{model} \tag{14}
$$

在推理时, 推理服务只需要在 HBM 中缓存这个极小维度的 Latent Key/Value 向量, 在前向传播计算时再动态重构回原维度. 这一设计相比 GQA 进一步压缩了 4 倍以上的显存带宽, 正逐步成为新一代超大模型推理的技术演进方向.

---

## 8. 参考文献 (References)

- Ainslie, J., et al. (2023). "GQA: Training Generalized Grouped-Query Attention for Distributed Large Language Models." arXiv preprint arXiv:2305.13245.
- Shazeer, N. (2019). "Fast Transformer Decoding: One Write-Head is All You Need." arXiv preprint arXiv:1911.02150.
