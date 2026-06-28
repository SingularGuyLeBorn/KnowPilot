---
title: "05 · MLA: 多头潜在注意力的低秩压缩与解耦设计"
---

# MLA: 多头潜在注意力的低秩压缩与解耦设计

>  **[返回 14.1-DeepSeek 家族总览](../../14.1-DeepSeek.md)**


> 本文聚焦 DeepSeek-V3 中 Multi-Head Latent Attention(MLA, 多头潜在注意力)的核心设计原理、数学推导、工程实现细节,以及与解耦 RoPE 的协同机制.

---

## 1 引言: KV Cache 的显存瓶颈

在标准 Multi-Head Attention(MHA)中,每个 token 的 KV Cache 大小为:

$$
 \text{KV Cache}_{\text{MHA}} = 2 \times n_h \times d_h \times L
$$

其中 $n_h$ 为注意力头数,$d_h$ 为每头维度,$L$ 为序列长度.

在 DeepSeek-V3 的配置下($n_h=128, d_h=128$):

$$
 \text{KV Cache}_{\text{MHA}} = 2 \times 128 \times 128 \times L = 32768L \text{ (浮点数)}
$$

在 128K 上下文、BF16 精度下,MHA 的 KV Cache 需要约 **8.2 GB**. 这是长文本推理的显存瓶颈,也是高 API 定价的直接原因 —— 服务提供商需要为每个活跃请求预留大量显存.

MLA 的核心目标是将这个开销压缩一个数量级,同时保持 MHA 的质量.

---

## 2 低秩联合压缩

### 2.1 压缩原理

MLA 将 Key 和 Value 压缩为一个低秩潜在向量 $\mathbf{c}_t^{KV} \in \mathbb{R}^{d_c}$:

$$
 \mathbf{c}_t^{KV} = W^{DKV} \mathbf{h}_t
$$

其中 $W^{DKV} \in \mathbb{R}^{d_c \times d}$ 为下投影矩阵,$d=7168$ 为隐藏维度,$d_c=512$ 为压缩维度.

在推理时,每个头的 Key 和 Value 从压缩向量恢复:

$$
 \mathbf{k}_{t,i}^C = W^{UK}_i \mathbf{c}_t^{KV}, \quad \mathbf{v}_{t,i}^C = W^{UV}_i \mathbf{c}_t^{KV}
$$

其中 $W^{UK}_i, W^{UV}_i \in \mathbb{R}^{d_h \times d_c}$ 为每个头的上投影矩阵.

压缩后的 KV Cache 大小为:

$$
 \text{KV Cache}_{\text{MLA}} = (d_c + d_h^R) \times L = (512 + 64) \times L = 576L \text{ (浮点数)}
$$

**压缩比**:

$$
 \text{压缩比} = \frac{32768}{576} \approx 56.9\times
$$

这意味着在 128K 上下文下,MLA 的 KV Cache 仅需约 **144 MB**.

> 译者注: 57 倍的压缩不是免费午餐. MLA 需要在推理时执行额外的矩阵投影: 先从缓存的 $\mathbf{c}_t^{KV}$ 恢复出每个头的 Key 和 Value. 这引入了额外的计算开销. 但在现代 GPU 上,矩阵乘法的计算密度远高于内存访问,因此「减少内存带宽消耗」带来的收益通常超过「增加计算量」的代价. 具体来说,在解码阶段,瓶颈是内存带宽(加载 KV Cache)而非计算,MLA 的压缩直接缓解了带宽瓶颈.

### 2.2 信息论视角

MLA 的核心假设是: Key 和 Value 在特征维度上存在高度冗余. 通过下投影矩阵将 $d=7168$ 维的隐藏状态压缩到 $d_c=512$ 维,这相当于在 7168 维空间中寻找一个 512 维的子空间,使得注意力计算在该子空间上的投影损失最小.

从信息论角度看,这类似于对 Key-Value 对进行有损压缩,压缩率 $r = d/d_c = 7168/512 = 14$. 但实验表明,这种压缩几乎不损失模型质量,说明注意力头之间的 Key-Value 信息确实高度冗余.

一个直觉性的解释是: 不同的注意力头虽然关注不同的语义模式(如句法、指代、语义关系),但这些模式在低维潜在空间中是可分离的,不需要为每个头单独存储完整的 Key-Value 表示.

---

## 3 解耦 RoPE 的数学本质

### 3.1 为什么需要解耦

标准 RoPE(Rotary Position Embedding)将位置编码直接施加在 Key 向量上. 如果 MLA 对所有 Key 进行联合低秩压缩,位置信息会在压缩过程中丢失或混淆.

DeepSeek 的解决方案是「解耦 RoPE」:

- 压缩向量 $\mathbf{c}_t^{KV}$ 不携带位置信息
- 单独的 $\mathbf{k}_t^R \in \mathbb{R}^{d_h^R}$ 携带 RoPE,且所有注意力头共享($d_h^R=64$)

### 3.2 注意力分数的计算

每个头的完整 Key 为拼接向量:

$$
 \mathbf{k}_{t,i} = [\mathbf{k}_{t,i}^C; \mathbf{k}_t^R]
$$

其中 $\mathbf{k}_{t,i}^C$ 从压缩向量恢复,$\mathbf{k}_t^R$ 直接提供位置信息.

注意力分数计算:

$$
 \text{Attention}(Q, K, V) = \text{softmax}\left(\frac{Q K^T}{\sqrt{d_h + d_h^R}}\right) V
$$

分母为 $\sqrt{192}$ 而非 $\sqrt{128}$,因为有效维度为 $d_h + d_h^R = 128 + 64 = 192$.

> 译者注: 解耦 RoPE 是 MLA 能够工作的关键. 如果没有解耦设计,RoPE 会「污染」低秩压缩向量,使得不同位置上的压缩向量无法共享相同的子空间. 另一个常被忽视的细节是: 在推理缓存时,只需要存储 $d_c=512$ 维的压缩向量和 $d_h^R=64$ 维的解耦键,总共 576 维,而不是存储每个头独立的 RoPE 键(128 头 × 128 维 = 16384 维). 此外,DeepSeek-V3 在长上下文扩展(4K→32K→128K)时,只将 YaRN 应用于解耦的共享键 $\mathbf{k}_t^R$,而不应用于压缩潜在向量中的键,这简化了位置外推的实现.

---

## 4 与 MHA/MQA/GQA 的对比

| 维度 | MHA | MQA | GQA | MLA |
|:---|:---|:---|:---|:---|
| KV 存储/头 | $2 \times d_h$ | $2 \times d_h / n_h$ | $2 \times d_h / g$ | $(d_c + d_h^R) / n_h$ |
| 总 KV Cache | $2 n_h d_h L$ | $2 d_h L$ | $2 n_h d_h L / g$ | $(d_c + d_h^R) L$ |
| DeepSeek-V3 配置 | $32768L$ | $256L$ | $1024L$(g=4) | $576L$ |
| 压缩位置 | 无 | 头维度 | 头维度 | 特征维度 |
| 与 MHA 质量差距 | 0% | 较大 | 中等 | 接近 0% |
| 额外计算 | 无 | 无 | 无 | 低秩投影 |

其中 $g$ 为 GQA 的组数. MLA 在 DeepSeek-V3 上的 KV Cache($576L$)介于 MQA($256L$)和 GQA($1024L$)之间,但质量损失远小于 MQA,与 MHA 几乎持平.

从谱系上看,注意力压缩的演进路线是:

```
MHA (2017, Vaswani) → MQA (2019, Shazeer) → GQA (2023, Ainslie) → MLA (2024, DeepSeek)
```

每个方案都是在「压缩比」和「质量损失」之间寻找更优的帕累托前沿. MLA 的独特之处在于它不是在「头的维度」上做压缩(如 MQA/GQA),而是在「特征维度」上做低秩压缩,这使得它可以与 GQA 叠加使用(如 Qwen3 同时采用 GQA + MLA).

---

## 5 工程实现细节

### 5.1 投影矩阵的吸收

在推理时,MLA 的低秩投影可以通过矩阵乘法融合来减少计算开销:

$$
 W^{UK}_i W^{DKV} \in \mathbb{R}^{d_h \times d}
$$

这个 $d_h \times d$ 的矩阵可以在加载模型时预先计算并缓存,避免每次推理时进行两次矩阵乘法. 类似地,$W^{UV}_i W^{DKV}$ 也可以预先融合.

### 5.2 Query 的低秩压缩

MLA 对 Query 也进行了低秩压缩:

$$
 \mathbf{c}_t^Q = W^{DQ} \mathbf{h}_t, \quad \mathbf{q}_{t,i} = W^{UQ}_i \mathbf{c}_t^Q
$$

其中 $d_c^{\prime}=1536$. Query 压缩只在训练期间有效(减少激活显存),推理时 Query 不需要缓存,因此不影响推理成本.

Query 的压缩率为:

$$
 \text{Q 压缩率} = \frac{d_h n_h}{d_c^{\prime}} = \frac{128 \times 128}{1536} = \frac{16384}{1536} \approx 10.7
$$

---

## 6 局限性与适用边界

### 6.1 额外计算开销

MLA 需要在推理时执行额外的低秩投影. 对于每个 token,需要计算:
- 从 $\mathbf{c}_t^{KV}$ 恢复 128 个头的 Key: $128 \times (128 \times 512)$ 次乘法
- 从 $\mathbf{c}_t^{KV}$ 恢复 128 个头的 Value: $128 \times (128 \times 512)$ 次乘法

总计算量约为 $2 \times 128 \times 128 \times 512 \approx 16.8$ M FLOPs. 相比之下,标准 MHA 的 Attention 计算量约为 $2 \times n_h \times d_h \times L \approx 32.8$ M FLOPs(对于 $L=1024$). 因此 MLA 的额外开销约为 50%,但在解码阶段内存带宽是瓶颈,计算增加不会显著影响延迟.

### 6.2 对短序列的收益有限

对于短序列($L < 4K$),KV Cache 的显存占用本身就不大,MLA 的压缩收益不明显. 例如,在 2K 上下文下,MHA 的 KV Cache 仅约 128 MB,MLA 压缩到 2.3 MB,差异不大.

### 6.3 与某些位置编码不兼容

MLA 的解耦 RoPE 设计与 ALiBi 等绝对位置编码方案不兼容,因为 ALiBi 需要在每个头的 Key 上施加偏置,而解耦 RoPE 将位置信息隔离在共享键中.

---

## 7 技术谱系与影响

### 7.1 直接继承自

- **MHA**(Vaswani et al., 2017): 多头注意力的基础架构
- **MQA**(Shazeer, 2019): 多头共享 KV 的压缩思路
- **GQA**(Ainslie et al., 2023): 分组查询的折中方案
- **LoRA**(Hu et al., 2022): 低秩适配的数学思想

### 7.2 核心创新

1. **特征维度低秩压缩**: 在特征维度而非头维度上做压缩
2. **解耦 RoPE**: 将位置信息隔离在共享键中,保护压缩向量的纯净性
3. **训练-推理统一**: 同一套压缩机制同时服务于训练和推理

### 7.3 被后续工作引用/影响

- Qwen3、GLM-5、MiniMax-M2 等模型同时采用 GQA + MLA
- 催生了「压缩即服务」的推理优化方向
- 影响了 KV Cache 量化研究(如 KIVI、Atom)

---

## 附录 A: 术语表

| 英文术语 | 中文译名 | 说明 |
|---------|---------|------|
| MLA | 多头潜在注意力 | 通过低秩压缩减少 KV Cache 的注意力机制 |
| MHA | 多头注意力 | 标准 Transformer 注意力机制 |
| MQA | 多查询注意力 | 所有头共享同一组 KV |
| GQA | 分组查询注意力 | 每组头共享一组 KV |
| RoPE | 旋转位置编码 | 通过旋转矩阵编码位置信息 |
| KV Cache | 键值缓存 | 推理时缓存的 Key-Value 对 |
| 低秩压缩 | Low-Rank Compression | 用低维子空间近似高维数据 |

## 附录 B: 核心公式索引

| 编号 | 公式 | 说明 |
|------|------|------|
| (1) | $\text{KV Cache}_{\text{MHA}} = 2 n_h d_h L$ | MHA 的 KV Cache 大小 |
| (2) | $\mathbf{c}_t^{KV} = W^{DKV} \mathbf{h}_t$ | KV 联合压缩 |
| (3) | $\text{KV Cache}_{\text{MLA}} = (d_c + d_h^R) L$ | MLA 的 KV Cache 大小 |
| (4) | $\text{压缩比} = 32768 / 576 \approx 56.9$ | DeepSeek-V3 配置下的压缩比 |
| (5) | $\mathbf{k}_{t,i} = [\mathbf{k}_{t,i}^C; \mathbf{k}_t^R]$ | 解耦 RoPE 的 Key 拼接 |

---

*本文档基于《01-DeepSeek-V3技术报告精译.md》的 MLA 章节进行深度剖析与独立整理.*
