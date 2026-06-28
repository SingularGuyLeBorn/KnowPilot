---
title: "02 · MQA：共享 Key/Value 的极致压缩"
---

# MQA：共享 Key/Value 的极致压缩

Multi-Query Attention（MQA）由 Shazeer 在 2019 提出：所有 Query 头**共用同一组** Key、Value 投影，在保持多头 Query 表达能力的同时，把 KV Cache 从 $O(H \cdot d_h)$ 压到 $O(d_h)$。自回归解码的瓶颈往往在**读 KV Cache 的带宽**而非 FLOPs；MQA 用「多 Q、单 KV」换显存与带宽，是 PaLM、Falcon、StarCoder 等模型的常见选型。

本文在 [MHA 标准形式](../01-MHA-多头注意力的标准形式/01-MHA-多头注意力的标准形式.md) 的记号下，给出矩阵式、隐藏维坐标展开、双求和、**输出投影再展开**、完整数值走查、RoPE 兼容性、Prefill/Decode 差异与 KV Cache 字节估算。配图均来自原论文（GQA 论文中的 MHA→MQA 转换图、DeepSeek-V2 中的注意力族对比图）。

---

## 1. 为什么需要 MQA：Decoding 的 memory wall

MHA 每个头独立缓存 $(k_j^{(h)}, v_j^{(h)})$，Decode 第 $t$ 步虽只算新 token 的 $q_t^{(h)}$，却要把**全部历史** KV 从 HBM 读回做矩阵乘。当 $L$ 很长、$B$ 很大时，访存带宽先于 FLOPs 触顶——Shazeer 称之为「One Write-Head is All You Need」：**写 cache 的宽度**才是主矛盾。

MQA 的结构性改动只有一条：$W^K, W^V$ 去掉头下标 $h$，全头共享。Query 仍保留 $H$ 路，因此不同头仍可学不同**检索模式** $\alpha_{t,\cdot}^{(h)}$，只是它们检索的是**同一套** Key/Value 向量。

![注意力机制族：MHA、GQA、MQA、MLA](./images/fig-attention-mechanism-family.jpg)

> 图 1：DeepSeek-V2（Dai et al., 2024, Figure 3）。MQA 位于 GQA 与 MLA 之间：KV 份数压到 1，但仍是**显式** $d_h$ 维 K/V，而非 MLA 的低秩 latent。

**图 1 解析**

同一张图在 MHA / GQA / MQA / MLA 四篇都会用到，建议按**从左到右**读演进关系。图中三行分别标 **Values、Keys、Queries**（自下而上），竖条数目表示「头」或「组」的数量；**斜线填充（hatched）** 表示推理时要 **Cached During Inference** 的对象。

1. **最左 Multi-Head Attention (MHA)**：8 个 Query、8 个 Key、8 个 Value，一一对应。每个 query 头有自己独立的 KV，cache 量 $\propto H$。
2. **Grouped-Query Attention (GQA)**：8 个 Query，4 组 Key/Value；每 2 个 Query 共用 1 组 KV。
3. **Multi-Query Attention (MQA)**（本篇重点）：8 个 Query 汇聚到 **1 个 Key + 1 个 Value**；cache 约为 MHA 的 $1/H$。
4. **最右 MLA**：改为 cache **Compressed Latent KV**，再用 projection 恢复多头 K/V；与 MQA 不同，缓存的是更短 latent 而非 $d_h$ 维 K/V。

![MHA 权重 mean-pool 得到 MQA 的 K/V 头](./images/fig-mha-to-mqa-weight-pool.jpg)

> 图 2：Ainslie et al.（2023, GQA 论文 Figure 1）：$W^K_h, W^V_h$ mean pool → 单头 $W^K_{MQ}, W^V_{MQ}$，再 uptrain。

**图 2 解析**

这是 **从已训练好的 MHA 权重构造 MQA 初始权重** 的工程示意图（不是前向计算图）。

- **左侧竖条堆叠**：$H$ 个 Key 投影矩阵 $W^K_1, W^K_2, \ldots, W^K_H$，每个形状约为 $d_{\mathrm{model}} \times d_h$（图中标 $d_{\mathrm{model}}$ 宽、$d_h$ 高）。
- **中间 Mean Pool**：对 $H$ 个矩阵做**逐元素平均**，得到单个 $W^K_{MQ}$。
- **右侧单块**：合并后的 **Key Projection $K_{MQ}$**，所有 query 头共享。
- Value 侧通常做同样的 mean pool（图中只画了 K，V 流程对称）。

含义：不是随机初始化 MQA，而是 **尽量保留 MHA 里各头 KV 信息的「平均方向」**，再用少量 continued pretrain（uptrain）把 perplexity 拉回来。GQA 论文证明 mean pool 优于「只取第 1 头」或随机初始化。

![MQA：多 Query 头共享单组 KV](./images/fig-mqa-shared-kv-structure.jpg)

> 图 3：GQA 论文 Figure 2（Multi-query 面板）。8 个 Query 头 → 1 组 Key + 1 组 Value。

**图 3 解析**

GQA 论文 Figure 2 的 **Multi-query** 子图，专门刻画 MQA 的「多 Q、单 KV」拓扑（与 Figure 2 里 MHA、GQA 三个子图并列）。

- **最上方标题** “Multi-query”：表示 KV 侧已压到单份。
- **底部一行（浅蓝竖条）**：8 个 **Query** 头，仍保持多头，表达能力主要靠不同的 $W^Q_h$。
- **中间（红色）与上方（橙黄）各 1 根竖条**：全组共享的 **Key** 与 **Value**；只有 1 组，不是 8 组。
- **虚线扇出**：8 条 Query 全部连到**同一** Key（再连 Value），表示 attention 时所有头读取**同一份** $k_s, v_s$ 序列，但各自 softmax 权重 $\alpha_{t,s,h}$ 仍不同。

第一次读图时易误以为「只有 1 个 query」——实际是 **8 个 query、1 套 KV**。Decode 时 cache 每步只 append 一组 $k_t, v_t$，宽度 $2d_h$，与 MHA 的 $2H d_h$ 形成鲜明对比。

---

## 2. 矩阵形式与 MHA 对照

设 $X \in \mathbb{R}^{L \times d_{\mathrm{model}}}$，头数 $H$，$d_h = d_k = d_v = d_{\mathrm{model}}/H$。

**MHA**（对照，见 MHA 式 (3)–(5)）：

$$
Q_h = X W^Q_h,\quad K_h = X W^K_h,\quad V_h = X W^V_h,\quad
\mathrm{head}_h = \mathrm{softmax}\!\left(\frac{Q_h K_h^\top}{\sqrt{d_k}}\right) V_h \tag{1}
$$

**MQA**：仅 $W^Q_h$ 带头下标；$W^K, W^V$ 全局共享：

$$
Q_h = X W^Q_h \in \mathbb{R}^{L \times d_h},\quad
K = X W^K \in \mathbb{R}^{L \times d_k},\quad
V = X W^V \in \mathbb{R}^{L \times d_v} \tag{2}
$$

$$
\mathrm{head}_h = \mathrm{softmax}\left(\frac{Q_h K^\top}{\sqrt{d_k}}\right) V,\quad
\mathrm{MQA}(X) = \mathrm{Concat}(\mathrm{head}_1,\ldots,\mathrm{head}_H)\, W^O \tag{3}
$$

与 MHA 相比，式 (3) 中 $K,V$ **不随 $h$ 变化**；$H$ 个 softmax 矩阵 $\in \mathbb{R}^{L \times L}$ 仍各自独立（因 $Q_h$ 不同），但乘的 $V$ 相同。

---

## 3. 隐藏维坐标展开

记 $x_t \in \mathbb{R}^{d_{\mathrm{model}}}$ 为位置 $t$ 的隐藏向量。

**Query**（每头独立，同 MHA 式 (7)）：

$$
q_{t,h,i} = \sum_{m=1}^{d_{\mathrm{model}}} x_{t,m}\, W^Q_{h,i,m} \tag{4}
$$

**Key / Value**（共享，**无** $h$ 下标）：

$$
k_{t,j} = \sum_{m=1}^{d_{\mathrm{model}}} x_{t,m}\, W^K_{j,m},\quad
v_{t,j} = \sum_{m=1}^{d_{\mathrm{model}}} x_{t,m}\, W^V_{j,m} \tag{5}
$$

**Logit 与权重**（第 $h$ 头，位置 $t$ 对 $s$）：

$$
e_{t,s,h} = \frac{1}{\sqrt{d_k}} \sum_{i=1}^{d_k} q_{t,h,i}\, k_{s,i} \tag{6}
$$

$$
\alpha_{t,s,h} = \frac{\exp(e_{t,s,h})}{\sum_{s'=1}^{L} \exp(e_{t,s',h})},\quad
o_{t,h,j} = \sum_{s=1}^{L} \alpha_{t,s,h}\, v_{s,j} \tag{7}
$$

式 (7) 说明：头 $h$ 的输出仍是历史 Value 的凸组合，但 $v_{s,j}$ 对所有 $h$ **相同**；头间差异完全来自 $\alpha_{t,s,h}$（由 $Q_h$ 决定）。

### 3.1 输出投影 $W^O$ 再展开一层

拼接 $\bar{o}_t = [o_{t,1};\ldots;o_{t,H}] \in \mathbb{R}^{H d_v}$，最终：

$$
y_{t,r} = \sum_{h=1}^{H} \sum_{j=1}^{d_v} o_{t,h,j}\, W_{O,\,(h-1)d_v + j,\, r} \tag{8}
$$

MQA 不改变式 (8) 的形式；压缩只发生在 **cache 里的 $k_s, v_s$**，不在 $W^O$。

---

## 4. 双求和与交换求和

将式 (4)(5) 代入式 (6)：

$$
e_{t,s,h}
= \frac{1}{\sqrt{d_k}} \sum_{i=1}^{d_k}
\left(\sum_m x_{t,m} W^Q_{h,i,m}\right)
\left(\sum_n x_{s,n} W^K_{i,n}\right) \tag{9}
$$

交换求和（先 $i$ 再 $m,n$）：

$$
e_{t,s,h} = \sum_{m,n} x_{t,m}\, x_{s,n}
\underbrace{\left(\frac{1}{\sqrt{d_k}} \sum_i W^Q_{h,i,m} W^K_{i,n}\right)}_{B_{h,m,n}} \tag{10}
$$

**读式 (10)**：第 $h$ 头仍对应一张 bilinear form $B_h$，与 MHA 同构；差别是 $W^K$ 只有一套，故所有头「检索」的 Key 子空间相同，只是 $W^Q_h$ 不同导致 $B_h$ 不同。KV 侧 $k_s, v_s$ **只算、只存一份**，这是 cache 收益的来源。

### 4.1 输出侧双求和（式 (7) 展开）

$$
o_{t,h,j} = \sum_{s=1}^{L} \alpha_{t,s,h} \sum_{m=1}^{d_{\mathrm{model}}} x_{s,m} W^V_{j,m}
= \sum_{m=1}^{d_{\mathrm{model}}} W^V_{j,m} \left( \sum_{s=1}^{L} \alpha_{t,s,h}\, x_{s,m} \right) \tag{11}
$$

括号内是第 $m$ 维隐藏坐标在历史 token 上的加权平均；MQA 与 MHA 在此相同，差异仅在 $\alpha$ 是否共享同一组 $k_s$ 算出来。

---

## 5. 因果掩码

Decoder-only 在位置 $t$ 只对 $s \le t$ 求和。实现上于 softmax 前令：

$$
e_{t,s,h} \leftarrow \begin{cases} e_{t,s,h} & s \le t \\ -\infty & s > t \end{cases} \tag{12}
$$

MQA **每个头**各自做式 (12)；掩码语义与 MHA 一致。训练若用 MHA、推理若换 MQA 而不 uptrain，分布偏移会放大——故工业界常 **pool + 短 uptrain**（§9）。

---

## 6. 完整数值走查：$H=2,\, d_h=2,\, L=3$

固定 $d_{\mathrm{model}}=4$，**保留** $\sqrt{d_k}=\sqrt{2}$ 缩放。

**输入**（行向量为 $x_t$）：

$$
x_1=[1,0,0,0],\quad x_2=[0,1,0,0],\quad x_3=[1,1,0,0]
$$

**共享 KV 投影**（取 $W^K$ 为前二维恒等，$W^V$ 交换前两维）：

$$
W^K = \begin{bmatrix}1&0\\0&1\\0&0\\0&0\end{bmatrix},\quad
W^V = \begin{bmatrix}0&1\\1&0\\0&0\\0&0\end{bmatrix}
$$

则 $k_t = [x_{t,1}, x_{t,2}]^\top$，$v_t = [x_{t,2}, x_{t,1}]^\top$：

| $t$ | $k_t$ | $v_t$ |
|:---:|:-----:|:-----:|
| 1 | $[1,0]^\top$ | $[0,1]^\top$ |
| 2 | $[0,1]^\top$ | $[1,0]^\top$ |
| 3 | $[1,1]^\top$ | $[1,1]^\top$ |

**Query 头 0**：$W^Q_0 = W^K$ → $q_{t,0} = k_t$。  
**Query 头 1**：$W^Q_1$ 交换输出两维 → $q_{t,1} = [x_{t,2}, x_{t,1}]^\top$。

### Step 1 — 位置 $t=3$ 的 logits（式 (6)）

**头 0**（$q_3=[1,1]^\top$）：

$$
e_{3,s,0} = \frac{1}{\sqrt{2}} q_3 \cdot k_s
\Rightarrow e_{3,1,0}=\frac{1}{\sqrt{2}},\ e_{3,2,0}=\frac{1}{\sqrt{2}},\ e_{3,3,0}=\sqrt{2}
$$

**头 1**（$q_3=[1,1]^\top$ 同样数值，但来自不同 $W^Q_1$；本例对称故 logits 相同）：

若取 $W^Q_1$ 使 $q_{3,1}=[0,1]^\top$，则 $e_{3,1,1}=0,\ e_{3,2,1}=1/\sqrt{2},\ e_{3,3,1}=1/\sqrt{2}$——**同一** $k_s$，不同 $\alpha$。

### Step 2 — Softmax（头 0，式 (6) 续）

$$
\alpha_{3,\cdot,0} = \mathrm{softmax}\bigl([{\textstyle\frac{1}{\sqrt{2}}}, {\textstyle\frac{1}{\sqrt{2}}}, \sqrt{2}]\bigr)
\approx [0.157,\ 0.157,\ 0.686]
$$

### Step 3 — 聚合（式 (7)）

$$
o_{3,0} = 0.157\, v_1 + 0.157\, v_2 + 0.686\, v_3
\approx 0.157[0,1]^\top + 0.157[1,0]^\top + 0.686[1,1]^\top
\approx [0.84,\ 0.84]^\top
$$

头 1 用同一 $\{v_s\}$、不同 $\alpha_{3,s,1}$ 得 $o_{3,1}$；再经式 (8) 的 $W^O$ 融合为 $y_3$。

**Cache 要点**：三步中 $k_s, v_s$ 只出现一份；头 0/1 仅重复算 $q$ 与 softmax，**不**重复存 KV。

---

## 7. RoPE 与 MQA 如何共存

现代 LLM 在 Q/K 上施加 RoPE：$\tilde{q}_{t,h} = R_t q_{t,h}$，$\tilde{k}_s = R_s k_s$（共享 $k$，故**所有头共用同一条** $\tilde{k}_s$ 序列）。每头 $q_{t,h}$ 仍独立旋转，logit 为：

$$
e_{t,s,h} = \frac{1}{\sqrt{d_k}} \tilde{q}_{t,h}^\top \tilde{k}_s \tag{13}
$$

RoPE **不阻止** MQA：位置信息写入共享 Key 的相位，各 Query 头仍用不同 $W^Q_h$ 读取。MLA 则因低秩压缩与 RoPE 冲突风险，需**解耦**内容/位置通道（见 [04 MLA](../04-MLA-低秩潜变量与解耦式注意力/04-MLA-低秩潜变量与解耦式注意力.md) §6）。

---

## 8. 从 MHA 到 MQA：mean-pool 公式

GQA 论文 Figure 1 的 checkpoint 转换（图 2）：

$$
W^K_{\mathrm{MQ}} = \frac{1}{H}\sum_{h=1}^{H} W^K_h,\quad
W^V_{\mathrm{MQ}} = \frac{1}{H}\sum_{h=1}^{H} W^V_h \tag{14}
$$

$W^Q_h$ 与 $W^O$ 通常**原样保留**。Mean pool 比「只取第 1 头」或随机初始化保留更多 MHA 预训练信息；再对约 **5%** 预训练 token **uptrain** 后，质量可接近 MHA（GQA 论文 Figure 3）。

---

## 9. KV Cache：量级与字节估算

### 9.1 每 token 每层

| 机制 | 缓存对象 | 维度 / token / layer |
|------|----------|----------------------|
| MHA | $H$ 组 $(k^{(h)}, v^{(h)})$ | $2 H d_h = 2 d_{\mathrm{model}}$ |
| MQA | **1 组** $(k, v)$ | $2 d_h$ |

压缩比 $1/H$。

### 9.2 全模型字节（$N$ 层，batch $B$，长 $L$，元素 $s$ 字节）

$$
\text{KV}_{\mathrm{MHA}} = 2 \cdot N \cdot B \cdot L \cdot H \cdot d_h \cdot s,\quad
\text{KV}_{\mathrm{MQA}} = 2 \cdot N \cdot B \cdot L \cdot d_h \cdot s \tag{15}
$$

**例**（Llama-2-70B 量级：$N=80,\ H=64,\ d_h=128,\ s=2$ FP16，$L=4096,\ B=1$）：

- MHA：$2 \times 80 \times 4096 \times 64 \times 128 \times 2 \approx 10.7\,\mathrm{GB}$
- MQA：$\approx 167\,\mathrm{MB}$（约 **64×**）

### 9.3 Decode 单步在算什么

第 $t$ 步：算 $H$ 组 $q_{t,h}$（新 token），读 cache 中 $\{k_s, v_s\}_{s \le t}$（**一份**）。FLOPs 对 $t$ 线性；MQA 相对 MHA 减少的是 **KV 向量宽度 × 读次数**，不是 Query 侧算力。

---

## 10. Prefill 与 Decoding

| 阶段 | MHA | MQA |
|------|-----|-----|
| **Prefill** | 算满 $Q,K,V$，cache $H$ 组 KV | 算 $H$ 组 $Q$ + **1 组** $K,V$，cache 1 组 |
| **Decoding** | 每步 append $H$ 组 $k_t, v_t$ | 每步 append **1 组** $k_t, v_t$ |
| 主要瓶颈 | Prefill：$O(L^2)$ 算力 | 同左；Decode：**带宽**收益更大 |

Prefill 阶段 MQA 已少算 $H-1$ 份 KV 投影；Decode 阶段收益更体现在 **显存占用与 HBM 读宽**。

---

## 11. 表达能力：共享 KV 牺牲了什么

MHA 允许每头在**不同 Key 子空间**里检索（$W^K_h$ 不同）。MQA 强制所有头看同一 $k_s$，等价于 Key 侧秩受限：$H$ 个不同的 $B_h$（式 (10)）共享同一 $W^K$ 列空间。实践上：

- 许多头在 MHA 中学到**冗余** KV 模式 → pool 后 uptrain 可恢复；
- 若任务强依赖「多头看不同 Key 流形」（极少见显式证据），MQA 可能略损 perplexity。

[GQA](../03-GQA-在性能与缓存之间折中/03-GQA-在性能与缓存之间折中.md) 在 $G$ 组 KV 间折中；[MLA](../04-MLA-低秩潜变量与解耦式注意力/04-MLA-低秩潜变量与解耦式注意力.md) 改压缩**维度**而非份数。

---

## 12. 实现：带共享 KV Cache 的伪代码

```python
# W_Q: [H, d_model, d_h]   W_K, W_V: [d_model, d_h]  无头维
def mqa_forward(x, k_cache, v_cache, use_cache=False):
    # x: [B, T, d_model]
    Q = einsum("bld,hdk->bhlk", x, W_Q)      # [B,H,T,d_h]
    K = x @ W_K                               # [B,T,d_h]  共享
    V = x @ W_V                               # [B,T,d_h]
    if use_cache and k_cache is not None:
        K = cat(k_cache, K, dim=1)            # [B,T_total,d_h]
        V = cat(v_cache, V, dim=1)
    if use_cache:
        k_cache, v_cache = K, V               # 只存一份！
    scale = 1.0 / sqrt(d_h)
    # [B,H,T_q,T_kv]
    scores = einsum("bhlk,btk->bhlt", Q, K) * scale
    scores = scores + causal_mask
    attn = softmax(scores, dim=-1)
    out = einsum("bhlt,btv->bhlv", attn, V)
    return merge_heads(out) @ W_O, k_cache, v_cache
```

与 MHA 对比：`k_cache` 形状 `[B, T, d_h]` 而非 `[B, H, T, d_h]`；**写 cache 带宽**降 $H$ 倍。

---

## 13. 训练与失效模式

| 现象 | 可能原因 | 说明 |
|------|----------|------|
| MHA→MQA 直接推理掉点 | 未 uptrain | 用式 (14) + 5% token 微调 |
| 长上下文 OOM 仍发生 | 仅 MQA 不足 | $L$ 极大时还需分页/PagedAttention |
| 多机 EP 通信瓶颈 | 与 MQA 无关 | 查 MoE/并行策略 |

---

## 14. 小结

| 维度 | MHA | MQA |
|------|-----|-----|
| Query | $H$ 独立 | $H$ 独立 |
| Key/Value | $H$ 独立 | **1 组共享** |
| KV Cache | $2 d_{\mathrm{model}}$ / token / layer | $2 d_h$ |
| 代数差异 | 式 (1) | 式 (2)–(3)，$K,V$ 无 $h$ |
| 典型场景 | 质量基线 | **长上下文 Decode、高 batch serving** |

MQA 在公式上与 MHA 仅差「KV 是否带 $h$」；式 (9)–(11) 给出完整双求与输出展开；§6 数值链展示**同 KV、异 $\alpha$**；§9–§10 量化 cache 与阶段瓶颈。介于 MHA 与 MQA 之间见 [GQA](../03-GQA-在性能与缓存之间折中/03-GQA-在性能与缓存之间折中.md)；进一步压缩见 [MLA](../04-MLA-低秩潜变量与解耦式注意力/04-MLA-低秩潜变量与解耦式注意力.md)。

---

## 参考文献

1. Shazeer, N. (2019). *Fast Transformer Decoding: One Write-Head is All You Need.* arXiv:1911.02150.
2. Ainslie, J. et al. (2023). *GQA: Training Generalized Multi-Query Transformer Models from Multi-Head Checkpoints.* arXiv:2305.13245.
3. Dai, D. et al. (2024). *DeepSeek-V2: A Strong, Economical, and Efficient Mixture-of-Experts Language Model.* arXiv:2405.04434.
4. Vaswani, A. et al. (2017). *Attention Is All You Need.* NeurIPS.
