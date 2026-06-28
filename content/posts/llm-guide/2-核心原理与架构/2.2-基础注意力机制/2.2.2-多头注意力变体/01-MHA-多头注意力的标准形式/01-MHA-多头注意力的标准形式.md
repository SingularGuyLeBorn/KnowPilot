---
title: "01 · MHA：多头注意力的标准形式"
date: 2026-05-24
tags: [MHA, Multi-Head Attention, KV-Cache, Transformer, RoPE]
---
# 01 MHA：多头注意力的标准形式

MHA（Multi-Head Attention，多头注意力）是 Transformer 的核心算子：同一段序列表示被投影到 $H$ 个并行子空间，每个子空间里独立做「Query 检索 Key、再对 Value 加权聚合」，最后拼接并映射回主干维度。它不是单头注意力的简单复制，而是把**关系模式**拆成多路并行学习——局部句法、长程共指、位置邻近、提示聚焦可以各占一头。

本文从 MHA 出发建立 **KV Cache** 的参照系，供后文 MQA / GQA / MLA 对比「压缩 KV 究竟牺牲了什么」。行文按本库教材规范组织，**不是**任何外部专栏的逐段转写。

---

## 1. MHA 是什么：从单头到多头

单头注意力已经建立了「Query 检索 Key、再对 Value 加权聚合」的基本机制，但所有依赖关系都被迫挤在同一套 $d_k$ 维子空间里。语法局部搭配、实体共指、长程语义、位置邻近性如果共用同一组投影，模型很容易学出「平均化」策略。

MHA 的做法是：为每个头 $s=1,\dots,H$ 准备独立的 $W_q^{(s)}, W_k^{(s)}, W_v^{(s)}$，让不同头在不同子空间里并行学习关系模式。这样一个头可以偏重局部句法，另一个头偏重长程检索，还有的头专门对提示词或特殊 token 聚焦。

设输入序列 $X=[x_1,x_2,\cdots,x_l]$，每个 $x_i\in\mathbb{R}^d$ 是 $d$ 维（即 $d_{model}$）隐藏向量。对第 $s$ 个头，可学习参数为：

$$
W_q^{(s)} \in \mathbb{R}^{d \times d_k},\quad
W_k^{(s)} \in \mathbb{R}^{d \times d_k},\quad
W_v^{(s)} \in \mathbb{R}^{d \times d_v} \tag{1}
$$

Query、Key、Value 向量为：

$$
q_i^{(s)} = x_i W_q^{(s)} \in \mathbb{R}^{d_k},\quad
k_i^{(s)} = x_i W_k^{(s)} \in \mathbb{R}^{d_k},\quad
v_i^{(s)} = x_i W_v^{(s)} \in \mathbb{R}^{d_v} \tag{2}
$$

其中 $q_i^{(s)}, k_i^{(s)}, v_i^{(s)}$ 分别是位置 $i$、头 $s$ 上的查询、键、值向量。

![](./images/fig-scaled-dot-product-attention.jpg)

> 图 1：缩放点积注意力（Vaswani et al., 2017, Figure 2 左）。

**图 1 解析**

这张图是自注意力最底层的「单头计算单元」，数据自下而上流动。

- **底部三个输入**：$Q$（Query）、$K$（Key）、$V$（Value）来自对同一序列隐藏态的三种线性投影，形状可理解为 $[T, d_k]$ 或 $[T, d_v]$。
- **第一次 MatMul（紫色）**：计算 $QK^\top$，得到每个 query 位置对每个 key 位置的原始相似度，矩阵规模为 $T \times T$。
- **Scale（黄色）**：除以 $\sqrt{d_k}$，防止维度过大时点积方差爆炸、softmax 梯度变小。
- **Mask (opt.)（粉色）**：Decoder 自回归时在 softmax 前把「未来位置」置为 $-\infty$，保证位置 $t$ 只能看见 $j \le t$。
- **SoftMax（绿色）**：对每一行（固定 query 位置 $t$）在 key 维做归一化，得到注意力权重 $\alpha_{t,j}$，同一行和为 1。
- **第二次 MatMul（紫色）**：用 $\alpha$ 对 $V$ 加权求和，输出该 query 位置的新表示。

读图要点：**Attention 输出不是「选中某一个 token」，而是对所有历史 Value 的加权平均**；MHA 只是在上面并行复制多路这样的单元，最后拼接。

---

## 2. 数学形式：矩阵式与逐元素展开

### 2.1 标准矩阵形式

堆叠成矩阵时，设 $X\in\mathbb{R}^{T\times d_{model}}$，头数 $H$，每头维度 $d_{head}=d_k$（通常 $H\cdot d_{head}=d_{model}$）：

$$
Q^{(h)} = XW_Q^{(h)},\quad
K^{(h)} = XW_K^{(h)},\quad
V^{(h)} = XW_V^{(h)} \tag{3}
$$

第 $h$ 个头：

$$
\text{head}^{(h)} = \text{softmax}\left(\frac{Q^{(h)}(K^{(h)})^T}{\sqrt{d_{head}}}\right)V^{(h)} \tag{4}
$$

拼接并输出投影：

$$
\text{MHA}(X)=\text{Concat}(\text{head}^{(1)},\dots,\text{head}^{(H)})W_O \tag{5}
$$

这里 $W_O\in\mathbb{R}^{Hd_{head}\times d_{model}}$。式 (4) 中的 $\sqrt{d_{head}}$ 是缩放因子，防止 $d_k$ 较大时点积方差过大导致 softmax 梯度消失。

### 2.2 投影：从隐藏向量到 Q/K/V 坐标

式 (2) 的矩阵乘 $q_i^{(s)} = x_i W_q^{(s)}$ 若写到**隐藏维坐标**，就是一次线性组合。设

$$
x_i = [x_{i,1}, x_{i,2}, \ldots, x_{i,d}] \in \mathbb{R}^{d}, \quad d = d_{model} \tag{6}
$$

权重矩阵按**行下标 = 输入维、列下标 = 输出维**理解（与 PyTorch `Linear(d, d_k)` 一致），则 Query 的第 $m$ 个坐标为：

$$
q_{i,m}^{(s)} = \sum_{p=1}^{d} x_{i,p}\, W^{(s)}_{Q,p,m} \tag{7}
$$

同理：

$$
k_{j,n}^{(s)} = \sum_{p=1}^{d} x_{j,p}\, W^{(s)}_{K,p,n}, \qquad
v_{j,u}^{(s)} = \sum_{p=1}^{d} x_{j,p}\, W^{(s)}_{V,p,u} \tag{8}
$$

这里 $m,n$ 遍历 $d_k$（或 $d_{head}$），$u$ 遍历 $d_v$。式 (7)–(8) 说明：**Q/K/V 的每一维都是整段隐藏状态 $x$ 各坐标的加权和**，权重由对应投影矩阵列向量决定。

### 2.3 分数：点积的双重求和

位置 $t$ 的 Query 与位置 $j$ 的 Key 做点积，代入式 (7)–(8) 可得**未缩放**分数：

$$
S_{t,j}^{(h)} = \sum_{m=1}^{d_{head}} q_{t,m}^{(h)} k_{j,m}^{(h)}
= \sum_{m=1}^{d_{head}} \left(\sum_{p=1}^{d} x_{t,p} W^{(h)}_{Q,p,m}\right)
\left(\sum_{p'=1}^{d} x_{j,p'} W^{(h)}_{K,p',m}\right) \tag{9}
$$

对内层 $m$ 求和后，$S_{t,j}^{(h)}$ 是 $(x_t, x_j)$ 的**双线性函数**：同一对头 $h$，所有输入坐标通过 $W_Q, W_K$ 耦合进一个标量相似度。缩放与 softmax：

$$
\tilde{S}_{t,j}^{(h)} = \frac{S_{t,j}^{(h)}}{\sqrt{d_{head}}}, \qquad
\alpha_{t,j}^{(h)} = \frac{\exp(\tilde{S}_{t,j}^{(h)})}{\sum_{u=1}^{T} \exp(\tilde{S}_{t,u}^{(h)})} \tag{10}
$$

分母只对**同一行** $t$ 的历史位置 $u$ 归一化，因此 $\sum_j \alpha_{t,j}^{(h)} = 1$（在无上界掩码时；因果掩码下只对 $j \le t$ 求和）。

### 2.4 输出：对 Value 的双重加权

该头在位置 $t$ 的输出向量 $o_t^{(h)} \in \mathbb{R}^{d_v}$，第 $u$ 维为：

$$
o_{t,u}^{(h)} = \sum_{j=1}^{T} \alpha_{t,j}^{(h)} v_{j,u}^{(h)}
= \sum_{j=1}^{T} \alpha_{t,j}^{(h)} \sum_{p=1}^{d} x_{j,p}\, W^{(h)}_{V,p,u} \tag{11}
$$

交换求和顺序：

$$
o_{t,u}^{(h)} = \sum_{p=1}^{d} W^{(h)}_{V,p,u} \left( \sum_{j=1}^{T} \alpha_{t,j}^{(h)} x_{j,p} \right) \tag{12}
$$

括号内 $\sum_j \alpha_{t,j}^{(h)} x_{j,p}$ 是**第 $p$ 维隐藏坐标**在所有历史 token 上的注意力加权平均。式 (12) 把「检索权重 $\alpha$」与「Value 投影 $W_V$」拆开：先混合历史内容，再线性映射到 $d_v$ 维——这是理解 MHA **不是**「选中单个 token」的关键。

### 2.5 多头拼接与输出投影（再展开一层）

$H$ 个头各自得到 $o_t^{(h)} \in \mathbb{R}^{d_v}$，拼接为：

$$
\bar{o}_t = \big[ o_t^{(1)};\, o_t^{(2)};\, \ldots;\, o_t^{(H)} \big] \in \mathbb{R}^{H d_v} \tag{13}
$$

经输出投影 $W_O \in \mathbb{R}^{H d_v \times d}$，最终第 $r$ 维主干输出为：

$$
y_{t,r} = \sum_{c=1}^{H d_v} \bar{o}_{t,c}\, W_{O,c,r}
= \sum_{h=1}^{H} \sum_{u=1}^{d_v} o_{t,u}^{(h)}\, W_{O,\,(h-1)d_v + u,\, r} \tag{14}
$$

式 (14) 表明：**不同头的结果在输出层被重新线性混合**，多头分工不是永久隔离，而是在 $W_O$ 处再次融合回 $d_{model}$ 维流形。

### 2.6 因果掩码（写进 softmax 之前）

Decoder-only 自回归在位置 $t$ 只能 attend $j \le t$。实现上在式 (10) 之前令：

$$
\tilde{S}_{t,j}^{(h)} \leftarrow
\begin{cases}
\tilde{S}_{t,j}^{(h)} & j \le t \\
-\infty & j > t
\end{cases} \tag{15}
$$

于是 $\alpha_{t,j}^{(h)} = 0$（$j > t$），且 $\sum_{j=1}^{t} \alpha_{t,j}^{(h)} = 1$。训练与推理必须使用**同一掩码语义**，否则分布偏移会在长序列生成中放大。

![](./images/fig-multi-head-attention.jpg)

> 图 2：多头注意力结构（Vaswani et al., 2017, Figure 2 右）；式 (9)–(14) 为其代数展开。

**图 2 解析**

在图 1 单头单元外包一层「多路并行 + 汇合」：

- **左侧输入**：同一份隐藏序列 $X$ 分三路，经 **三个独立线性层** 得到 $Q$、$K$、$V$（论文里常合并为一个大的 `qkv_proj`，逻辑等价）。
- **中间「h 个头」**：每条支路在头维上切成 $H$ 份；每个头内部跑一遍图 1 的 Scale Dot-Product Attention，得到 $\mathrm{head}^{(1)}, \ldots, \mathrm{head}^{(H)}$，每头输出维度 $d_v$（通常 $d_v = d_k = d_{\mathrm{model}}/H$）。
- **Concat**：在特征维把 $H$ 个头拼成 $H \cdot d_v$ 维向量。
- **最右侧 $W^O$**：输出投影，把拼接结果线性映射回 $d_{\mathrm{model}}$，让多头信息重新融合进主干残差流。

与单头的区别：**$K/V$ 也按头拆分**，因此推理时每个头要 cache 自己的 $(k^{(h)}, v^{(h)})$，总 cache 量 $\propto H$——这是后文 MQA/GQA/MLA 优化的直接动机。

---：$T=3$，单头，$d=4$，$d_{head}=2$

固定**一个头**（略去上标 $h$），设：

$$
x_1 = [1,0,0,0],\quad x_2 = [0,1,0,0],\quad x_3 = [0,0,1,0]
$$

为看清计算链，取极简权重（仅示意，非训练所得）：

$$
W_Q = \begin{bmatrix} 1 & 0 \\ 0 & 1 \\ 0 & 0 \\ 0 & 0 \end{bmatrix},\quad
W_K = W_Q,\quad
W_V = \begin{bmatrix} 1 & 0 & 0 & 0 \\ 0 & 1 & 0 & 0 \end{bmatrix}^\top
$$

**Step 1 — 投影**（式 (7)–(8)）：  
$q_1 = k_1 = v_1 = [1,0]$，$q_2 = k_2 = v_2 = [0,1]$，$q_3 = k_3 = v_3 = [0,0]$（$v_3$ 在 $W_V$ 下为 $[0,0]$）。

**Step 2 — 位置 $t=2$ 的因果分数**（式 (9)–(10)）：  
只对 $j \in \{1,2\}$：

$$
S_{2,1} = q_2 \cdot k_1 = 0,\quad S_{2,2} = q_2 \cdot k_2 = 1
$$

设 $\sqrt{d_{head}} = \sqrt{2}$，则 $\tilde{S}_{2,1} = 0$，$\tilde{S}_{2,2} = 1/\sqrt{2}$，

$$
\alpha_{2,1} = \frac{e^0}{e^0 + e^{1/\sqrt{2}}} \approx 0.32,\quad
\alpha_{2,2} = \frac{e^{1/\sqrt{2}}}{e^0 + e^{1/\sqrt{2}}} \approx 0.68
$$

**Step 3 — 聚合**（式 (11)）：  
$v_1 = [1,0]$，$v_2 = [0,1]$，

$$
o_2 = 0.32 \cdot [1,0] + 0.68 \cdot [0,1] \approx [0.32,\, 0.68]
$$

可见输出是**两个 Value 的凸组合**，而非 one-hot 选中 $j=2$。把 $H=2$ 的两个 $o_t^{(h)}$ 代入式 (13)–(14)，即得完整 MHA 在该 token 上的最终 $y_t$。

---

## 3. 位置编码：MHA 如何感知 token 顺序

注意力本身对输入排列是**置换等变**的：若不注入位置信息，$\text{MHA}(X)$ 无法区分 token 顺序。Transformer 通过**位置编码**把顺序写进表示。

### 3.1 绝对位置编码（原始 Transformer）

为每个位置 $pos$ 分配固定向量 $PE_{pos}\in\mathbb{R}^d$，与词嵌入相加：

$$
\begin{aligned}
PE_{(pos,2i)} &= \sin(pos/10000^{2i/d}) \\
PE_{(pos,2i+1)} &= \cos(pos/10000^{2i/d})
\end{aligned} \tag{16}
$$

### 3.2 相对位置编码

不编码绝对下标，而编码 token 间**相对距离**，更符合「间隔多远」的 linguistic 直觉，对长序列外推通常更友好。

### 3.3 RoPE（现代 LLM 主流）

RoPE（Rotary Position Embedding）通过旋转矩阵把位置信息写入 Q/K 的相位结构。Llama、Qwen、DeepSeek 等主流模型在 MHA/GQA 路径上普遍采用 RoPE。后续 [04 MLA](../04-MLA-低秩潜变量与解耦式注意力/04-MLA-低秩潜变量与解耦式注意力.md) 会把 RoPE 与低秩 KV 压缩**解耦**，那是变体层的事；在标准 MHA 里，RoPE 直接作用在各头的 Q/K 上。

实际输入为 $\tilde{x}_i = x_i + PE_i$（或等价融合方式），再代入式 (7)–(14)。RoPE 则对 Q/K 的二维子块施加位置相关旋转 $R_i$，使 $q_i^\top k_j$ 仅依赖相对位置 $i-j$；细节留到位置编码专章，此处只强调：**无位置注入则 MHA 对 token 置换不变，无法建模顺序。**

---

## 4. 计算流程与实现的一一对应

代数链条已在 §2 展开；实现时把同一逻辑映射为张量算子即可：

| 步骤 | 数学对象 | 典型张量形状（单头、batch=1） |
|------|---------|------------------------------|
| 投影 | 式 (7)–(8) | $Q,K,V \in \mathbb{R}^{T \times d_{head}}$ |
| 分数 | 式 (9)–(10) | $S \in \mathbb{R}^{T \times T}$，再 softmax 得 $A$ |
| 聚合 | 式 (11) | $O = AV \in \mathbb{R}^{T \times d_v}$ |
| 多头 | 式 (13)–(14) | stack → $W_O$ |

因果性由式 (15) 在 $S$ 上置 $-\infty$ 实现；Prefill 一次算整段 $T$，Decoding 每步只算新行 $q_t$ 与缓存中全部 $K,V$（见 §5）。

---

## 5. KV Cache：MHA 在推理阶段的真正成本

### 5.1 为什么需要 KV Cache

自回归生成时，第 $t$ 步只需为新 token 算 Query，但 Attention 要与**全部历史** Key/Value 交互。若每步重算所有历史的 $k_i^{(s)}, v_i^{(s)}$，复杂度随 $t$ 二次重复。因此推理会把已算好的键值对缓存下来——这就是 **KV Cache**。

### 5.2 显存量级

GPU 显存大致分三类：**模型权重**、**中间激活**、**KV Cache**。前两者由模型规模决定；KV Cache 随序列长度 $L$ **线性增长**。

对 $h$ 个头、每头 Key/Value 各 $d_k$（或 $d_v$）维，历史长度 $L$，单层缓存元素量级：

$$
h \times L \times (d_k + d_v) \tag{17}
$$

全模型（$N$ 层、batch $B$、dtype 字节数 $s$）：

$$
\text{KV Cache} \propto 2 \times N \times B \times L \times H \times d_{head} \times s \tag{18}
$$

系数 $2$ 来自 Key 与 Value 各一份。MHA 下 $H\times d_{head}=d_{model}$，因此**每个 token 每层**都要缓存宽度为 $2d_{model}$ 的 KV 张量（按头组织）。

**数值例**：Llama-2-7B 量级（$N=32$ 层，$H=32$，$d_{head}=128$，FP16 每元素 2 字节），单序列长度 $L=4096$、batch $B=1$：

$$
\text{bytes} = 2 \times N \times B \times L \times H \times d_{head} \times 2
= 2 \times 32 \times 4096 \times 32 \times 128 \times 2 \approx 2.1\,\text{GB} \tag{19}
$$

仅 KV 已占单卡显存显著比例；$B$ 或 $L$ 再翻倍，Cache 近似线性跟着翻倍——这是 MHA 在 serving 里最先触顶的原因。

### 5.3 Decoding 单步在算什么

生成第 $t$ 个新 token 时，只需算当前 $q_t^{(h)}$（式 (7)），但 Attention 分数行 $\alpha_{t,\cdot}^{(h)}$ 仍依赖**全部**缓存的 $k_j^{(h)}, v_j^{(h)}$（$j \le t$）。单步 FLOPs 对 $t$ 线性，**访存量**也线性读回整段 KV——算力不大、带宽先满，即 Decoding 的 memory-wall 特征。

### 5.4 Prefill 与 Decoding 的瓶颈差异

| 阶段               | 输入特点            | 主要瓶颈                           |
| ------------------ | ------------------- | ---------------------------------- |
| **Prefill**  | 并行处理整段 prompt | 计算量（$O(L^2)$ 注意力）        |
| **Decoding** | 每步 1 个新 token   | **KV Cache 容量与 HBM 带宽** |

MQA、GQA、MLA 等变体几乎都在为 **Decoding 阶段的 KV** 服务。理解 MHA 的完整 KV 结构，是读懂后续一切压缩方案的前提。

---

## 6. 多头分工：结构直觉（非另一套公式）

§2.7 已用单头走查说明「加权混合」。扩展到 $H$ 个头时，同一 $x_t$ 在不同 $W_Q^{(h)}$ 下产生不同 $q_t^{(h)}$，从而对**同一组** $\{k_j, v_j\}$ 得到不同 $\alpha_{t,j}^{(h)}$ 与 $o_t^{(h)}$。头与头之间的差异来自投影矩阵不同，而非输入不同；式 (14) 的 $W_O$ 再把 $H$ 路子空间结果混回统一表示。这是「多头 = 并行子空间 + 输出层再融合」，而不是 $H$ 次独立复制同一注意力。

---

## 7. 实现映射：带 KV Cache 的 MHA 伪代码

下面给出与式 (7)–(15) 对齐的推理向伪代码（单头视角，多头在外层循环或 batched 维实现）：

```python
import torch
import torch.nn.functional as F
import math

class MultiHeadAttention(torch.nn.Module):
  def __init__(self, n_heads, d_model, d_k, d_v, max_seq_len):
    super().__init__()
    self.n_heads = n_heads
    self.d_k = d_k
    self.d_v = d_v
    self.W_q = torch.nn.ModuleList([torch.nn.Linear(d_model, d_k, bias=False) for _ in range(n_heads)])
    self.W_k = torch.nn.ModuleList([torch.nn.Linear(d_model, d_k, bias=False) for _ in range(n_heads)])
    self.W_v = torch.nn.ModuleList([torch.nn.Linear(d_model, d_v, bias=False) for _ in range(n_heads)])
    self.W_o = torch.nn.Linear(n_heads * d_v, d_model, bias=False)
    self.register_buffer("k_cache", None, persistent=False)
    self.register_buffer("v_cache", None, persistent=False)
    mask = torch.full((1, 1, max_seq_len, max_seq_len), float("-inf"))
    self.register_buffer("causal_mask", torch.triu(mask, diagonal=1), persistent=False)

  def forward(self, x, use_cache=False):
    # x: [B, T, d_model]
    B, T, _ = x.shape
    head_outs = []
    for h in range(self.n_heads):
      q = self.W_q[h](x)
      k = self.W_k[h](x)
      v = self.W_v[h](x)
      if use_cache and self.k_cache is not None:
        k = torch.cat([self.k_cache[h], k], dim=1)
        v = torch.cat([self.v_cache[h], v], dim=1)
      if use_cache:
        if self.k_cache is None:
          self.k_cache = [None] * self.n_heads
          self.v_cache = [None] * self.n_heads
        self.k_cache[h] = k
        self.v_cache[h] = v
      scale = 1.0 / math.sqrt(self.d_k)
      scores = torch.matmul(q, k.transpose(-2, -1)) * scale
      scores = scores + self.causal_mask[:, :, :T, :k.size(1)]
      attn = F.softmax(scores.float(), dim=-1).type_as(q)
      head_outs.append(torch.matmul(attn, v))
    out = torch.cat(head_outs, dim=-1)
    return self.W_o(out)
```

工程实现里常把 $H$ 个头合并为一次大矩阵乘（`qkv_proj`）以吃满 Tensor Core；逻辑上与上式等价。

![](./images/fig-transformer-architecture.jpg)

> 图 3：Transformer 整体架构（Vaswani et al., 2017, Figure 1）。

**图 3 解析**

经典 Encoder–Decoder 全貌（现代 LLM 多为右侧 **Decoder 栈** 的变体）：

- **左侧 Encoder**：输入 token 经嵌入 + 位置编码后，堆叠 $N$ 层；每层 = **Multi-Head Attention（自注意力）** + Add&Norm + **FFN** + Add&Norm。Encoder 内 MHA 的 $Q,K,V$ 都来自同一编码序列，**无因果掩码**，每个位置能看见全体。
- **右侧 Decoder**：同样 $N$ 层；每层多一个 **Masked Multi-Head Attention**（只能看已生成前缀），再 **Cross-Attention**（$Q$ 来自解码端，$K/V$ 来自 Encoder 输出），最后 FFN。
- **连线含义**：Encoder 顶层输出作为 Decoder Cross-Attention 的 $K/V$ 来源；Decoder 顶层经 Linear + Softmax 得到词表概率。

读图时抓住两点：**(1)** 每层都有 MHA 子层（图 2 结构重复 $N$ 次）；**(2)** 推理瓶颈往往在 Decoder 自注意力的 **KV Cache**（每层、每头都要存历史 Key/Value）。

---：MHA 为何仍是「参考系」

MHA 的表达能力最强，因为**每个头保留独立 Key/Value**，可学习多样化的注意力模式。代价也最大：

- **KV Cache** 随 $H$ 线性放大
- 长上下文 + 高并发时，带宽先于算力成为瓶颈

后续 MQA（共享 KV）、GQA（分组共享）、MLA（低秩 latent）都在回答同一问题：

> 若不再让每个头缓存独立高维 KV，会损失多少能力，又能换回多少显存与吞吐？

因此 MHA 不是「过时的基线」，而是整条演进链的**度量零点**。

---

## 9. 训练与失效模式（简要）

| 现象           | 可能原因                           | 说明                          |
| -------------- | ---------------------------------- | ----------------------------- |
| 极长上下文 OOM | KV Cache 线性膨胀                  | MHA 最敏感；需 GQA/MLA 或分页 |
| 长程依赖弱     | 头数/$d_{head}$ 不足或训练长度短 | 与架构无关时查数据与 RoPE     |
| 推理吞吐低     | Decode 带宽 bound                  | 典型 MHA 部署痛点             |

---

## 10. 本节小结

MHA 的完整计算链可概括为：**隐藏坐标线性投影 → 双线性打分 → softmax 筛选 → 对历史隐藏态加权 → 多头拼接 → $W_O$ 融合**（式 (3)–(15)）。式 (12) 尤其值得记住：Attention 输出是历史 $x_j$ 各维坐标的凸组合，再经 $W_V$ 映到 Value 空间。

推理侧，每个头独立缓存 $(k_j^{(h)}, v_j^{(h)})$，式 (17)–(19) 的量级决定 MQA/GQA/MLA 的动机。下一篇 [02 MQA](../02-MQA-共享KeyValue的极致压缩/02-MQA-共享KeyValue的极致压缩.md) 在保留 Query 多头的前提下，把 KV 压到 **1 份共享**。

---

## 11. 参考文献

1. Vaswani, A., et al. (2017). [Attention Is All You Need](https://arxiv.org/abs/1706.03762). *NeurIPS*.
2. Shazeer, N. (2019). [Fast Transformer Decoding: One Write-Head is All You Need](https://arxiv.org/abs/1911.02150). *arXiv*.
