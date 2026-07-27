---
title: "05 · DCA：双块注意力"
date: 2026-05-24
tags: [DCA, Dual-Chunk-Attention, 长上下文, 训练无关, RoPE, ChunkLlama]
---

# 05 DCA：双块注意力（Dual Chunk Attention）

> 系列索引：[2.3.2 稀疏与压缩注意力](../2.3.2-稀疏与压缩注意力.md) · [2.3 高效与稀疏注意力](../../2.3-高效与稀疏注意力.md)  
> 论文：[Training-Free Long-Context Scaling](https://arxiv.org/abs/2407.02490) · 代码：[ChunkLlama](https://github.com/HKUNLP/ChunkLlama)

在 MHA → MQA → GQA → MLA 这条「**压缩 KV**」主线上，**DCA（Dual Chunk Attention）** 走另一条路：**不改 KV 张量形状，只改写长序列上的相对位置与注意力分解**，在 **无需继续训练** 的前提下，把 4K 预训练窗口推到 **100K+**（ChunkLlama / Llama-2-70B 设定）。

---

## 1. 问题：RoPE 外推为何困难

原生 MHA + RoPE 的 LLM（如 Llama-2 4K）直接吃超长 prompt 时，常见失败模式：

| 做法 | 问题 |
|------|------|
| 线性外推位置索引 | 超出训练分布，远程 token 相位失真 |
| 只增大 RoPE base | 短上下文性能掉点 |
| 全量长上下文微调 | 算力与时间成本极高 |

DCA 的核心洞察：**保留预训练权重与短程 RoPE 习惯，把长序列拆成多个「训练长度内」的 chunk，用三种注意力分支重建全局因果图**。

---

## 2. 三种块级注意力

设训练长度 $L_{\mathrm{train}}$（论文记 $c$），块大小 $C$（论文记 $s$，常取约 $\frac{3}{4}L_{\mathrm{train}}$）。对 $L \gg L_{\mathrm{train}}$ 的序列，DCA **并不把三路 attention 输出向量相加**；而是在 **同一次因果 softmax** 里，按 query/key 所在 chunk 的距离，为每对 $(i,j)$ 选用不同的 query 位置索引 $P_{\mathbf{q}}^{\{\mathrm{Intra,Succ,Inter}\}}[i]$ 与 key 索引 $P_{\mathbf{k}}[j]=j \bmod C$，经 RoPE 得到内积后再归一化：

$$
M[i,j]=
\begin{cases}
P^{\mathrm{Intra}}_{\mathbf{q}}[i]-P_{\mathbf{k}}[j], & \lfloor i/C\rfloor-\lfloor j/C\rfloor=0 \\
P^{\mathrm{Succ}}_{\mathbf{q}}[i]-P_{\mathbf{k}}[j], & \lfloor i/C\rfloor-\lfloor j/C\rfloor=1 \\
P^{\mathrm{Inter}}_{\mathbf{q}}[i]-P_{\mathbf{k}}[j], & \lfloor i/C\rfloor-\lfloor j/C\rfloor>1
\end{cases} \tag{1}
$$

$$
\mathbf{p}_i=\mathrm{softmax}\!\left(\frac{[\,f(\mathbf{q},P_{\mathbf{q}}[i])^\top f(\mathbf{k}_j,P_{\mathbf{k}}[j])\,]_{j\le i}}{\sqrt{d_k}}\right),\quad
\mathbf{o}_i=\mathbf{p}_i V_{:i} \tag{2}
$$

下文「Intra / Inter / Succ」指 **相对位置矩阵 $M$ 的三段构造规则**（论文 Figure 2），便于理解；实现上对应式 (1)(2) 的统一 attention。

![DCA 三路注意力：块内、块间与邻块过渡](./images/fig-dca-attention-patterns.jpg)

> 图 1: DCA 块内/块间/邻块过渡三路注意力在因果矩阵上的非零区域（论文）。

**图 1 解析**

- **Intra-Chunk（块内）**：同一 chunk 内 token 两两做标准因果 attention，相对位置落在 $0 \ldots C-1$ — 与预训练时见过的位置分布一致，是 **保真局部语义** 的锚。
- **Inter-Chunk（块间）**：当前 chunk 的 query 对 **历史 chunk 的代表 KV**（如块首 token 或池化向量）做 attention；跨块相对位置用 **重映射**（块索引差）代替巨大的绝对位置，避免 RoPE 相位飞出训练流形。
- **Successive-Chunk（邻块过渡）**：专门连接 **相邻两块边界** 上的 token 对，缓解「块内位置 0 突然对接全局 4096」的割裂感 — 只有 Intra+Inter 时，边界处长程依赖最易断。
- **实现方式**：对因果矩阵一次 softmax；仅 $M[i,j]$ 的取法按 Intra/Succ/Inter 分段 — 与 FlashAttention-2 分块兼容（ChunkLlama 在 FA-2 上 monkey patch 位置索引）。

### 2.1 Intra-Chunk

块内使用 **原始训练长度内的相对位置**：

$$
\mathrm{Attn}_{\mathrm{intra}}(q_t, K, V) =
\mathrm{softmax}\!\left(\frac{q_t K_{[b(t),:]}^{\top}}{\sqrt{d_k}}\right) V_{[b(t),:]} \tag{2}
$$

其中 $b(t)$ 为 $t$ 所在 chunk 索引。

### 2.2 Inter-Chunk

Query 来自当前块，Key/Value 来自 **先前各块的聚合表示** $\bar{k}_b, \bar{v}_b$：

$$
\mathrm{Attn}_{\mathrm{inter}}(q_t) =
\mathrm{softmax}\!\left(\frac{q_t \, \bar{K}_{<b(t)}^{\top}}{\sqrt{d_k}}\right) \bar{V}_{<b(t)} \tag{3}
$$

跨块 RoPE 使用 **块差** $\Delta b = b(t) - b(s)$ 而非全局 $|t-s|$。

### 2.3 Successive-Chunk

对 $(t,s)$ 若 $b(t)=b(s)+1$ 且 $t,s$ 落在交界窗口内，启用过渡分支，位置编码用 **连续化映射**（论文中的 successive mapping），使模型在边界仍看到平滑相对距离。

---

## 3. 复杂度与工程特性

| 指标 | 标准 Attention | DCA |
|------|---------------|-----|
| 时间（粗估） | $O(L^2)$ | $O(L \cdot C)$，$C \ll L$ |
| KV Cache | 全量 $L$ | **仍全量**（不压缩 KV） |
| 是否需要训练 | — | **否**（Training-Free） |
| FlashAttention | 兼容 | **兼容**（分块即 DCA 块） |

**与 MLA 的对比**：MLA 改 **存什么**（低秩 latent）；DCA 改 **怎么看全局**（分块近似全连接图）。可叠加：MLA 减 cache 体积，DCA 扩有效上下文。

![DCA 推理内核与 FlashAttention 集成（论文）](./images/fig-dca-kernel-pipeline.jpg)

> 图 4: DCA 与 FlashAttention 分块推理栈的集成管线示意（论文）。

**图 4 解析**

- 展示 ChunkLlama 如何把 DCA 三路 mask **映射到 FA-2 分块内核** — 不物化全长 $L\times L$ 矩阵。
- Prefill 按 chunk 调度；与 PagedAttention 正交（DCA 不省 KV 体积）。

![Needle-in-a-Haystack 与长上下文外推（论文）](./images/fig-dca-niah-haystack.jpg)

> 图 3: Needle-in-a-Haystack 热力图，验证 training-free 长程检索（论文）。

**图 3 解析**

- 热力图颜色表示 needle 召回；DCA 在远超训练长度时仍保持可检索性。
- 与线性外推 RoPE 对比：DCA 曲线不会在远端整块失效。
- **局限**：图只验证检索，不保证所有生成任务同等提升。

![长上下文困惑度与基线对比](./images/fig-dca-long-context-ppl.jpg)

> 图 2: 外推上下文长度上的 PPL 或任务分数，DCA 相对位置外推更稳（论文）。

**图 2 解析**

- 横轴多为 **外推上下文长度**（4K → 32K → 100K+）；纵轴为 PPL 或任务分数。
- **全注意力 + 位置外推** 曲线通常在超长处陡升 — RoPE 分布外推失效。
- **DCA** 曲线更平：因每块仍在「训练长度内」做 intra，inter/succ 只补全局骨架。
- 读图时注意：DCA **不降低 KV 显存** — 若曲线好但 OOM，仍需 GQA/MLA/PagedAttention。

---

## 4. 实验结论（论文摘要）

- Llama-2 **70B**：4K 预训练权重上 **100K+** tokens，PPL 增幅可控
- 多项 long-context 基准接近部分 **专门微调** 的长文模型
- 与 **FlashAttention-2** 集成后可实际部署（ChunkLlama）

---

## 5. 适用场景与局限

**适合**

- 已有短上下文 checkpoint，需快速验证超长文档
- 无法承担长上下文 SFT / 继续预训练
- 推理栈已支持 FlashAttention 分块

**局限**

- **不减少 KV Cache** — 高并发 + 极长序列仍 OOM
- 块大小 $C$ 需调参；过大 → 接近全注意力；过小 → 块间细粒度丢失
- 非 RoPE 架构需单独设计映射

---

## 6. 在家谱中的位置

```
MHA → MQA → GQA → MLA        （KV 压缩）
                    ↓
           DCA / S²-Attn       （长上下文路径）
                    ↓
           NSA / MoBA / CSA+HCA （原生稀疏 / 压缩检索）
```

| 方法 | 训练 | KV | 目标 |
|------|------|-----|------|
| [DCA](./05-DCA-双块注意力.md) | 否 | 全量 | Training-free 外推 |
| [S²-Attn](../06-S2-Attn-移位稀疏注意力/06-S2-Attn-移位稀疏注意力.md) | LoRA+稀疏 | 训练期全量 | 高效长文 SFT |
| [MLA](../../../2.2-基础注意力机制/2.2.2-多头注意力变体/04-MLA-低秩潜变量与解耦式注意力/04-MLA-低秩潜变量与解耦式注意力.md) | 是 | 压缩 | 推理成本 |

---

## 7. 可运行参考实现（NumPy）

`project/experiments/dca-dual-chunk/` 按论文式 (2)(5)(7)(8)(9) 实现 **分块 RoPE 相对位置 + 单次因果 softmax**（见目录内 `README.md`）。`run_demo.py` 校验论文图 2 中 $M[6][5]=1$（Succ 保持边界局部性）及单 chunk 退化为标准 RoPE。

```powershell
cd project/experiments/dca-dual-chunk
pip install -r requirements.txt
python run_demo.py
```

多块长序列上与「全局 $P[i]=i$」的标准 RoPE 数值不同属预期。

## 8. 参考文献

1. An, C., et al. (2024). [Training-Free Long-Context Scaling of Large Language Models](https://arxiv.org/abs/2407.02490). *arXiv*.
2. HKUNLP. [ChunkLlama](https://github.com/HKUNLP/ChunkLlama).
