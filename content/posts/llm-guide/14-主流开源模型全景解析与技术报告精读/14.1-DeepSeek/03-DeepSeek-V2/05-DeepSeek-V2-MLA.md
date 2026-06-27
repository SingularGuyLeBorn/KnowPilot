---
title: "DeepSeek-V2 MLA 深度解析"
status: completed
date: 2026-05-19
---

# DeepSeek-V2: Multi-Head Latent Attention (MLA) 原理与工程实现

> 🔙 **[返回 14.1-DeepSeek 家族总览](../../14.1-DeepSeek.md)**


> 原文基础: DeepSeek-V2: A Strong, Economical, and Efficient Mixture-of-Experts Language Model (arXiv:2405.04434)
> 本文聚焦 MLA 的完整数理推导、设计动机、工程落地细节和与同类技术的系统对比.

---

## 1 设计动机: 为什么标准注意力机制的 KV 缓存是瓶颈

### 1.1 问题的数学本质

标准 Transformer 采用 Multi-Head Attention (MHA). 设嵌入维度为 $d$, 注意力头数为 $n_h$, 每头维度为 $d_h$, 层数为 $l$. 对于第 $t$ 个 token, MHA 通过三个投影矩阵 $W^Q, W^K, W^V \in \mathbb{R}^{d_h n_h \times d}$ 分别产生 query、key 和 value:

$$ \mathbf{q}_t = W^Q \mathbf{h}_t, \quad \mathbf{k}_t = W^K \mathbf{h}_t, \quad \mathbf{v}_t = W^V \mathbf{h}_t $$

在自回归生成过程中, 为了加速推理, 所有前缀 token 的 key 和 value 必须被缓存. 因此 MHA 每个 token 的 KV 缓存大小为:

$$ \text{KV Cache}_{\text{MHA}} = 2 \times n_h \times d_h \times l \tag{1} $$

以 DeepSeek-V2 的配置为例 ($n_h = 128, d_h = 128, l = 60$):

$$ \text{KV Cache}_{\text{MHA}} = 2 \times 128 \times 128 \times 60 = 1{,}966{,}080 \text{ 元素/token} $$

在 FP16/BF16 精度下, 这相当于每个 token 约 3.77 MB 的显存占用. 当 batch size 为 64、序列长度为 32K 时, KV 缓存总大小约为 $64 \times 32000 \times 3.77 \text{MB} \approx 7.7 \text{TB}$——这超出了任何单节点 GPU 的显存容量, 成为限制最大 batch size 和序列长度的核心瓶颈.

### 1.2 现有解决方案及其局限

为缓解 KV 缓存压力, 社区提出了两种主要方案:

**Multi-Query Attention (MQA)**: 所有头共享同一组 KV, 将缓存降至 $2 d_h l$. 这极大地减少了缓存, 但性能显著下降——因为不同头的 query 需要关注不同的语义子空间, 共享 KV 无法满足这种多样性需求.

**Grouped-Query Attention (GQA)**: 将 $n_h$ 个 query 头分为 $n_g$ 组, 每组共享一组 KV, 缓存为 $2 n_g d_h l$. GQA 是 MHA 和 MQA 的折中, 在缓存和性能之间取了一个实用的平衡点. 但它本质上是「在头的维度上做压缩」, 压缩比受限于组数 $n_g$.

| 机制 | 每 Token KV 缓存 | 与 MHA 缓存比 | 能力 |
|:---|:---|:---|:---|
| MHA | $2 n_h d_h l$ | $1\times$ | 强 |
| GQA | $2 n_g d_h l$ ($n_g < n_h$) | $n_g / n_h$ | 中等 |
| MQA | $2 d_h l$ | $1 / n_h$ | 弱 |

> 这里需要停下来理解一个关键洞察: MQA 和 GQA 的压缩都是在「头的维度」上进行的——它们减少的是 KV 头的数量, 但每个头内部的维度 $d_h$ 保持不变. 这意味着它们的压缩比存在理论上限: 即使极端到 MQA, 每个 token 仍需缓存 $2 d_h l$ 个元素. MLA 的突破在于, 它不是在「头的维度」上压缩, 而是在「特征维度」上做低秩压缩——这打开了全新的压缩空间.

---

## 2 核心原理: 低秩键值联合压缩

### 2.1 压缩机制

MLA 的核心思想是: key 和 value 的信息在高维空间中是高度冗余的, 完全不需要存储完整的 $d_h n_h$ 维向量. 通过低秩联合压缩, 将 key 和 value 映射到一个低维潜在空间中.

具体而言, MLA 引入一个压缩潜在向量 $\mathbf{c}_t^{KV} \in \mathbb{R}^{d_c}$ ($d_c \ll d_h n_h$):

$$ \mathbf{c}_t^{KV} = W^{DKV} \mathbf{h}_t \tag{2} $$

其中 $W^{DKV} \in \mathbb{R}^{d_c \times d}$ 是下投影矩阵. 在推理时, 只需要缓存 $\mathbf{c}_t^{KV}$, 因此 KV 缓存降至:

$$ \text{KV Cache}_{\text{MLA}} = d_c \times l \tag{3} $$

为了从压缩向量恢复 key 和 value 进行注意力计算, MLA 使用上投影矩阵:

$$ \mathbf{k}_t^C = W^{UK} \mathbf{c}_t^{KV}, \quad \mathbf{v}_t^C = W^{UV} \mathbf{c}_t^{KV} \tag{4} $$

其中 $W^{UK}, W^{UV} \in \mathbb{R}^{d_h n_h \times d_c}$.

### 2.2 推理时的矩阵吸收

MLA 的一个关键工程优化是「矩阵吸收」: 在推理时, 无需显式恢复 $\mathbf{k}_t^C$ 和 $\mathbf{v}_t^C$.

考虑注意力计算中的 query-key 点积:

$$ \mathbf{q}_t^{C^T} \mathbf{k}_j^C = (W^{UQ} \mathbf{c}_t^Q)^T (W^{UK} \mathbf{c}_j^{KV}) = \mathbf{c}_t^{Q^T} (W^{UQ^T} W^{UK}) \mathbf{c}_j^{KV} $$

定义融合后的投影矩阵 $\tilde{W}^Q = W^{UQ^T} W^{UK}$, 则:

$$ \mathbf{q}_t^{C^T} \mathbf{k}_j^C = \mathbf{c}_t^{Q^T} \tilde{W}^Q \mathbf{c}_j^{KV} \tag{5} $$

类似地, 对于输出投影:

$$ W^O [\mathbf{o}_{t,1}; ...; \mathbf{o}_{t,n_h}] = W^O W^{UV} \tilde{\mathbf{o}}_t $$

定义 $\tilde{W}^O = W^O W^{UV}$, 则所有计算都可以在压缩维度 $d_c$ 上进行, 而不是原始头维度 $d_h n_h$.

> 译者注: 矩阵吸收是 MLA 在工程上可行的关键. 如果没有这一优化, 每次注意力计算都需要先将压缩向量投影回高维空间($d_c \to d_h n_h$), 计算后再压缩, 这引入了额外的计算开销. 通过吸收, 推理时的计算复杂度从 $O(d_h n_h)$ 降至 $O(d_c)$, 与高维空间的交互完全消除. 但代价是: 训练时不能使用吸收, 因为训练需要独立的梯度流通过 $W^{UQ}$ 和 $W^{UK}$——这是一个「训练-推理不对称」的设计, 在实现上需要维护两套计算图.

### 2.3 Query 的低秩压缩

除了 KV 压缩外, MLA 还对 query 进行低秩压缩以减少训练期间的激活内存(虽然这不影响 KV 缓存):

$$ \mathbf{c}_t^Q = W^{DQ} \mathbf{h}_t, \quad \mathbf{q}_t^C = W^{UQ} \mathbf{c}_t^Q \tag{6} $$

其中 $\mathbf{c}_t^Q \in \mathbb{R}^{d_c^{\prime}}$, $d_c^{\prime} \ll d_h n_h$.  query 压缩的设计动机是: 在训练大规模模型时, 激活值(而非权重)往往是显存的主要占用者, 对 query 进行压缩可以显著降低训练时的峰值显存.

---

## 3 解耦旋转位置编码: 低秩压缩与位置信息的兼容性

### 3.1 核心冲突

RoPE (Rotary Position Embedding) 通过旋转矩阵对 query 和 key 进行位置编码. 然而, RoPE 与低秩 KV 压缩存在根本性的兼容性问题.

假设我们直接对压缩后的 key 应用 RoPE:

$$ \mathbf{k}_t^C = W^{UK} \cdot \text{RoPE}(W^{DKV} \mathbf{h}_t) $$

由于 RoPE 是位置相关的, $W^{UK}$ 会与位置矩阵耦合. 在推理时, 为了计算当前 token 与所有前缀 token 的注意力:

$$ \mathbf{q}_t^T \mathbf{k}_j = (W^Q \mathbf{h}_t)^T \cdot W^{UK} \cdot \text{RoPE}_j(W^{DKV} \mathbf{h}_j) $$

这里 $\text{RoPE}_j$ 依赖于位置 $j$, 而 $j$ 随序列增长变化. 由于矩阵乘法不满足交换律, $W^{UK}$ 无法被吸收进 $W^Q$. 这意味着每次生成都需要重新计算所有前缀 token 的 key——这完全抵消了 KV 缓存节省的收益.

### 3.2 解耦 RoPE 的设计

DeepSeek-V2 提出的解决方案是「解耦 RoPE 策略」: 将位置信息从压缩向量中分离出来, 使用独立的向量来承载 RoPE.

具体实现:
- 引入额外的多头 query $\mathbf{q}_{t,i}^R \in \mathbb{R}^{d_h^R}$ 和共享的 key $\mathbf{k}_t^R \in \mathbb{R}^{d_h^R}$
- $\mathbf{q}_{t,i}^R$ 和 $\mathbf{k}_t^R$ 直接应用 RoPE, 不经过压缩
- 压缩向量 $\mathbf{c}_t^{KV}$ 不携带位置信息

注意力计算变为拼接形式:

$$ \mathbf{q}_{t,i} = [\mathbf{q}_{t,i}^C; \mathbf{q}_{t,i}^R], \quad \mathbf{k}_{t,i} = [\mathbf{k}_{t,i}^C; \mathbf{k}_t^R] \tag{7} $$

$$ \mathbf{o}_{t,i} = \sum_{j=1}^{t} \text{Softmax}_j\left(\frac{\mathbf{q}_{t,i}^T \mathbf{k}_{j,i}}{\sqrt{d_h + d_h^R}}\right) \mathbf{v}_{j,i}^C \tag{8} $$

点积分解为两部分:

$$ \mathbf{q}_{t,i}^T \mathbf{k}_{j,i} = \underbrace{\mathbf{q}_{t,i}^{C^T} \mathbf{k}_{j,i}^C}_{\text{语义部分, 可吸收}} + \underbrace{\mathbf{q}_{t,i}^{R^T} \mathbf{k}_j^R}_{\text{位置部分, RoPE 计算}} $$

语义部分通过矩阵吸收在压缩空间中计算, 位置部分通过标准 RoPE 计算. 两者独立, 互不干扰.

### 3.3 缓存代价分析

解耦 RoPE 引入了一个额外代价: 需要缓存解耦的 key $\mathbf{k}_t^R$. 因此 MLA 的总 KV 缓存变为:

$$ \text{KV Cache}_{\text{MLA (total)}} = (d_c + d_h^R) \times l \tag{9} $$

对于 DeepSeek-V2, $d_c = 512$, $d_h^R = 64$:

$$ \text{KV Cache}_{\text{MLA}} = (512 + 64) \times 60 = 34{,}560 \text{ 元素/token} $$

与 MHA 的 $1{,}966{,}080$ 相比, 压缩比约为 $56.9\times$.

> 译者注: 需要注意的是, 论文中报告的「减少 93.3%」是以 DeepSeek 67B (稠密模型) 为对比基准, 而非同等配置的 MHA. 67B 的配置与 V2 不同, 因此直接的压缩比数字需要谨慎解读. 更准确的对比应该看论文表 7 中大型 MoE 模型的数据: MHA 860.2K vs MLA 34.6K, 压缩比约为 $24.9\times$. 即便如此, 这也是从「头维度压缩」(GQA/MQA)到「特征维度压缩」的质变.

---

## 4 与同类技术的系统对比

### 4.1 能力-缓存权衡

| 注意力机制 | 每 Token KV 缓存 (元素数) | 与 MHA 缓存比 | 能力 | 关键局限 |
|:---|:---|:---|:---|:---|
| MHA | $2 n_h d_h l$ | $1\times$ | 最强 | 缓存最大 |
| GQA | $2 n_g d_h l$ | $n_g/n_h$ | 中等 | 压缩比受限于组数 |
| MQA | $2 d_h l$ | $1/n_h$ | 最弱 | 所有头共享 KV |
| MLA | $(d_c + d_h^R) l$ | $\approx 9d_h/(2n_h d_h) = 9/(2n_h)$* | 更强 | 训练-推理不对称 |

*以 DeepSeek-V2 配置计算: $(512+64)/(2 \times 128 \times 128) = 576/32768 \approx 1/56.9$.

对于 DeepSeek-V2 的具体配置, MLA 的 KV 缓存「相当于仅有 2.25 个组的 GQA」, 但性能比 MHA 更强——这是 MQA 和 GQA 都无法实现的.

### 4.2 压缩维度的本质差异

MQA/GQA 与 MLA 的根本区别在于压缩的维度:

- **MQA/GQA**: 在「头的维度」上压缩. 减少 KV 头的数量 $n_h \to n_g \to 1$, 但每个头的内部维度 $d_h$ 不变. 压缩比上限为 $1/n_h$.
- **MLA**: 在「特征维度」上压缩. 将 $d_h n_h$ 维向量压缩到 $d_c$ 维 ($d_c \ll d_h n_h$). 压缩比取决于 $d_c$ 的选择, 与头数无关.

这种差异意味着: MLA 的压缩比可以独立于模型规模进行调整. 无论模型有多少个头, 只要选择合适的 $d_c$, 就可以获得相同的缓存压缩效果. 而 GQA 的压缩比直接受限于头数——模型越大(头数越多), GQA 的压缩空间反而越小.

### 4.3 对后续工作的影响

MLA 的设计被 DeepSeek-V3 (2024) 完整继承, $d_c = 512$ 保持不变. 这验证了一个关键假设: KV 缓存的压缩维度与模型总参数量解耦, 512 维的潜在向量已经足够编码 Key-Value 的关键信息.

后续 Qwen3、GLM-5 等模型也采用了类似的低秩注意力压缩思路, 但实现细节有所不同. 例如, Qwen3 的 MLA 变体在解耦 RoPE 的具体公式上做了微调, 以适应其 GQA + RoPE 基值 1M 的配置.

---

## 5 局限性与工程风险

### 5.1 训练-推理不对称

MLA 在训练和推理时使用不同的计算图: 训练时显式计算 $W^{UK}$ 和 $W^{UQ}$ 以保持独立的梯度流, 推理时通过矩阵吸收消除这些投影. 这种不对称带来以下工程挑战:

1. **代码复杂度**: 需要维护两套注意力实现, 增加测试和维护成本.
2. **数值一致性**: 吸收后的矩阵 $\tilde{W}^Q$ 和 $\tilde{W}^O$ 是浮点运算的累积结果, 可能与分步计算存在微小的数值差异. 虽然通常在可接受范围内, 但在极端精度敏感场景下可能引发问题.
3. **量化兼容性**: 当对吸收后的矩阵进行 INT8/INT4 量化时, 量化误差的传播路径与分步量化不同, 可能需要专门的校准策略.

### 5.2 解耦 RoPE 的额外缓存

解耦 RoPE 虽然解决了位置编码的兼容性问题, 但引入了额外的 KV 缓存开销 ($d_h^R \times l$). 在 DeepSeek-V2 中, $d_h^R = 64$, 占 MLA 总缓存的 $64/(512+64) \approx 11.1\%$.

如果未来模型进一步增大 $n_h$, $d_h^R$ 是否需要相应调整? 论文中没有明确讨论这个问题. 从原理上看, $d_h^R$ 只需要足够编码位置信息即可, 与语义头数无关. 但如果采用更复杂的位置编码方案(如 ALiBi 的线性偏置), 解耦策略可能需要重新设计.

### 5.3 对非自回归场景的适用性

MLA 的设计完全围绕自回归生成的 KV 缓存优化. 在需要双向注意力的场景(如 BERT 风格的编码器、多轮对话中的上下文重排序)中, MLA 的压缩优势不复存在——因为双向注意力不需要缓存前缀 KV, 所有 token 的 key 和 value 都在前向传播中实时计算.

这意味着 MLA 的价值主要局限于 Decoder-only 的生成模型. 对于 Encoder-Decoder 架构或需要双向编码的任务, MLA 并非最优选择.

---

## 6 技术谱系定位

```
Transformer (2017)
    └── Attention 机制
           ├── Multi-Head Attention (MHA) [Vaswani et al., 2017]
           │      ├── Multi-Query Attention (MQA) [Shazeer, 2019]
           │      ├── Grouped-Query Attention (GQA) [Ainslie et al., 2023]
           │      └── Multi-Head Latent Attention (MLA) [DeepSeek-V2, 2024]
           │             └── MLA + MTP [DeepSeek-V3, 2024]
           └── Position Encoding
                  └── Rotary Position Embedding (RoPE) [Su et al., 2021]
                         └── 解耦 RoPE [DeepSeek-V2, 2024]
```

MLA 在算法家族树中的位置: 它是 MHA 向「低维潜在空间」演进的关键节点. 与 MQA/GQA 在「头的维度」上做压缩不同, MLA 开创了「特征维度压缩」的新路线. 这一路线被 DeepSeek-V3 继承并扩展(引入 Multi-Token Prediction), 同时也影响了后续 Qwen3、GLM-5 等模型的注意力设计.

---

*本文档同步至: `docs/sections/llm-guide/14-主流开源模型全景解析与技术报告精读/14.1-DeepSeek/03-DeepSeek-V2/05-DeepSeek-V2-MLA.md`*
