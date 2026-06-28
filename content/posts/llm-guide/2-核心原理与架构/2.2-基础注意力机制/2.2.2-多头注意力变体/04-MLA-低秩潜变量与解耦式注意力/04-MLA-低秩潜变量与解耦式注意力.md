---
title: "MLA：低秩潜变量与解耦式注意力"
---

# MLA：低秩潜变量与解耦式注意力

Multi-head Latent Attention（MLA）由 DeepSeek-V2（Dai et al., 2024）提出，并在 DeepSeek-V3 中延续为核心注意力模块。它回答的问题不是「再共享几份 KV」（MQA/GQA 的路子），而是：**推理时是否必须缓存与训练时同形的高维 $k_t, v_t$？** MLA 的答案是：不必——把 KV **联合** 压到低维 latent $c_t^{KV}$，只 cache $c_t^{KV}$ 与解耦的 RoPE 键 $k_t^R$；内容 Query/Key 的上投影在 decode 时可 **矩阵吸收**（详见 [05-MLA 吸收双版本](../05-MLA矩阵吸收与非吸收双版本/05-MLA矩阵吸收与非吸收双版本.md)）。

本文在 [MHA](../01-MHA-多头注意力的标准形式/01-MHA-多头注意力的标准形式.md) 参照系下，给出：MHA 基线 → 低秩 KV 联合压缩 → Q 侧低秩（训练激活省显存）→ **解耦 RoPE** → 全坐标展开 → 双求和 → **含 RoPE 的完整数值走查** → KV Cache 字节估算 → 与 MQA/GQA 及论文消融对比。

---

## 1. 动机：MQA/GQA 之后还差什么

| 机制 | 压缩手段 | 局限 |
|------|----------|------|
| MHA | 无 | KV cache $2 n_h d_h$ / token / layer |
| MQA | KV **份数** → 1 | 单 Key 子空间，质量可能掉 |
| GQA | KV **份数** → $G$ | 折中，仍 cache $2G d_h$ 维 |
| **MLA** | KV **维度** → $d_c$ | 需低秩假设 + RoPE 解耦 + 吸收优化 |

DeepSeek-V2 论文 Table 9：同规模 MoE 下，MLA 相对 MHA **KV cache 仅 4%–14%**，且 hard benchmark **不低于 MHA**。Figure 1(b) 报告相对稠密 67B：KV cache **−93.3%**，最大吞吐 **×5.76**（与 MoE 等共同贡献）。

![MHA / GQA / MQA / MLA](./images/fig-attention-mechanism-family.jpg)

> 图 1：DeepSeek-V2 Figure 3。MLA 右侧 **Compressed Latent KV** 为唯一主 cache；多头 K/V 由 projection 恢复，不必逐头写入 cache。

**图 1 解析**

四列注意力演进，请重点看 **最右 MLA 列**：

- **Queries 行**：仍有多根竖条（多头 Query），说明「怎么看」仍可以多头分工。
- **Keys / Values 行**：每头一根的独立竖条 **没有** 全部标为 cache；真正 cache 的是右侧 **Compressed Latent KV** 单块（斜线填充）。
- **projection 粗箭头**：从 latent 指向 K/V 区域，表示 $c^{KV} \xrightarrow{W^{UK}, W^{UV}}$ 在算分时**恢复**多头内容 K/V，而非把恢复结果写入 cache。
- 与第三列 MQA 对比：MQA cache 的是 **1 份** 完整维度 $d_h$ 的 K 和 V；MLA cache 的是 **更短** 的 $d_c$ 维向量（DeepSeek-V2 中 $d_c=512 \ll n_h d_h$）。

第一次读图易混淆「MLA 是否还算多头」——**算**：多头体现在 $W^{UQ}$ 与 per-head attention；变的是 **cache 里存什么**。

![DeepSeek-V2 MLA 模块](./images/fig-deepseek-v2-mla-block.jpg)

> 图 2：Figure 2 MLA 块。斜线填充 = Cached During Inference（$c^{KV}$、$k^R$）。

**图 2 解析**

DeepSeek-V2 论文 **Figure 2** 右侧放大 **Multi-Head Latent Attention** 子图（左侧还有 DeepSeekMoE，本篇只看 MLA 框）。

- **输入** $\mathbf{h}_t$：当前 token 隐藏态。
- **Query 支路**：$\mathbf{h}_t \xrightarrow{W^{DQ}}$ → **Latent $\mathbf{c}_t^Q$**（可训练低秩）→ 分两路：
  - **内容上采样** $W^{UQ}$ → 各头 $\mathbf{q}_{t,i}^C$；
  - **RoPE 支路** $W^{QR}$ → RoPE → 各头 $\mathbf{q}_{t,i}^R$。
- **KV 支路**：$\mathbf{h}_t \xrightarrow{W^{DKV}}$ → **Latent $\mathbf{c}_t^{KV}$（斜线 cache）** → $W^{UK}, W^{UV}$ 恢复 $\mathbf{k}^C, \mathbf{v}^C$；**位置** $\mathbf{k}_t^R = \mathrm{RoPE}(W^{KR}\mathbf{h}_t)$ **单独 cache**（斜线）。
- **拼接**：每头 $\mathbf{q}=[\mathbf{q}^C;\mathbf{q}^R]$，$\mathbf{k}=[\mathbf{k}^C;\mathbf{k}^R]$，进入 **Multi-Head Attention** 框。
- **输出** $\mathbf{u}_t$ 回残差流。

图例 **斜线填充 = Cached During Inference**：训练时仍算全路径；生成时只持久化 $\mathbf{c}^{KV}$ 与 $\mathbf{k}^R$，不持久化所有头的 $\mathbf{k}^C, \mathbf{v}^C$。

![KV Cache 与吞吐](./images/fig-deepseek-v2-kv-cache-throughput.jpg)

> 图 3：Figure 1(b) 训练成本与推理效率。

**图 3 解析**

DeepSeek-V2 论文 **Figure 1(b)**，对比 **DeepSeek 67B（稠密）** 与 **DeepSeek-V2（MoE + MLA）**：

- 通常包含 **训练成本**（柱状或相对百分比）与 **推理侧指标**（如 KV cache 体积、最大生成吞吐 tokens/s）。
- 论文报告：V2 训练成本约 **−42.5%**，KV cache 约 **−93.3%**，最大生成吞吐约 **×5.76**（相对 67B 基线）。
- 读图时注意：吞吐提升 **不全是 MLA** 的功劳，MoE 稀疏激活也占一部分；但 KV 大幅下降与 MLA 直接相关。

该图回答「MLA 是否只在理论上省 cache」——在完整模型尺度上，系统级指标与理论 $d_c+d_h^R$ 量级一致。

---

## 2. 符号与输入

$$
X = \begin{bmatrix} x_1 \\ \vdots \\ x_T \end{bmatrix} \in \mathbb{R}^{T \times d},\quad
x_t = [x_{t,1},\ldots,x_{t,d}]^\top \in \mathbb{R}^{d} \tag{1}
$$

$d = d_{\mathrm{model}}$；$n_h$ 头数；每头总维 $d_h = d_{h,C} + d_h^R$（内容 + RoPE）；KV 压缩维 $d_c$；Q 压缩维 $d_c'$。DeepSeek-V2：$d=5120$ 量级；V3：$d=7168$，$d_c=512$，$d_h^R=64$，$n_h=128$。

---

## 3. 基线：标准 MHA（论文 §2.1.1）

DeepSeek-V2 先写出 MHA 以便对照：

$$
q_t = h_t W^Q,\quad k_t = h_t W^K,\quad v_t = h_t W^V,\quad
W^{Q,K,V} \in \mathbb{R}^{d \times n_h d_h} \tag{2}
$$

按头切分 $q_{t,i}, k_{t,i}, v_{t,i} \in \mathbb{R}^{d_h}$：

$$
o_{t,i} = \sum_{j=1}^{t} \mathrm{Softmax}_j\!\left(\frac{q_{t,i}^\top k_{j,i}}{\sqrt{d_h}}\right) v_{j,i},\quad
u_t = W^O [o_{t,1};\ldots;o_{t,n_h}] \tag{3}
$$

**推理 cache**：每层每 token 存 $k_{j,i}, v_{j,i}$ 全体 → $2 n_h d_h$ 标量。这是 MQA/GQA/MLA 共同的 **度量零点**。

---

## 4. 低秩 KV 联合压缩（论文 §2.1.2）

MLA 把式 (2) 中 $k_t, v_t$ 换成「先压 latent、再上分」：

$$
c_t^{KV} = h_t W^{DKV},\quad W^{DKV} \in \mathbb{R}^{d \times d_c} \tag{4}
$$

$$
k_t^C = c_t^{KV} W^{UK},\quad v_t^C = c_t^{KV} W^{UV},\quad
W^{UK}, W^{UV} \in \mathbb{R}^{d_c \times n_h d_{h,C}} \tag{5}
$$

再按头切分 $k_{t,i}^C, v_{t,i}^C \in \mathbb{R}^{d_{h,C}}$。**推理主 cache** 仅为 $c_t^{KV} \in \mathbb{R}^{d_c}$（每层每 token $d_c$ 个数）。

### 4.1 低秩分解视角

若忽略解耦 RoPE，式 (5) 等价于 MHA 的 $W^K, W^V$ 做秩-$d_c$ 分解：

$$
W^K \approx W^{DKV} W^{UK},\quad W^V \approx W^{DKV} W^{UV} \tag{6}
$$

参数量：MHA 式 $2 \cdot d \cdot n_h d_{h,C}$；MLA 式 $d \cdot d_c + 2 \cdot d_c \cdot n_h d_{h,C}$。当 $d_c \ll n_h d_{h,C}$ 时参数更少；**推理收益**主要来自 cache 从 $2 n_h d_{h,C}$ 降到 $d_c$，而非参数量本身。

### 4.2 为何 K/V **联合** 压进同一个 $c^{KV}$

Key 负责「匹配」，Value 负责「携带被聚合信息」；训练时两者由同一 $h_t$ 导出，高度相关。联合压缩 $c_t^{KV}$ 比分别压 $c_t^K, c_t^V$ 再 cache 两份更省（DeepSeek 选单 latent；V 仍经独立 $W^{UV}$ 恢复）。

---

## 5. Query 低秩（训练侧，不减 KV cache）

论文式 (12)–(13)：Q 也做 $c_t^Q = h_t W^{DQ}$，$q_t^C = c_t^Q W^{UQ}$。**目的**是训练时减小 **activation** 峰值（大 batch、长序列前向），**不**减少推理 KV cache（Q 本来就不 cache）。

$$
c_t^Q = h_t W^{DQ} \in \mathbb{R}^{d_c'},\quad
q_{t,i}^C = c_t^Q W^{UQ}_{(i)} \in \mathbb{R}^{d_{h,C}} \tag{7}
$$

DeepSeek-V3：$d_c' = q\_lora\_rank = 1536$，$d_c = kv\_lora\_rank = 512$。

---

## 6. 解耦 RoPE（论文 §2.1.3）

RoPE 对 Q/K 施加位置相关旋转 $R_t$。若对 $k_{t,i}^C = c_t^{KV} W^{UK}_{(i)}$ 再 RoPE，则 $R_j$ 插在 $W^{UK}$ 与 $W^{UQ}$ 之间，**无法**预合并 $W^{UK}$ 进 $W^{UQ}$（矩阵不可交换），decode 需对每个历史 $j$ 重算 $k_j^C$ → 吸收失效。

**解耦策略**：内容走 $q^C, k^C$（可低秩 + 可吸收）；位置走独立通道：

$$
q_{t,i}^R = \mathrm{RoPE}\bigl( (c_t^Q W^{QR})_{(i)} \bigr),\quad
k_t^R = \mathrm{RoPE}(h_t W^{KR}) \tag{8}
$$

$$
q_{t,i} = [q_{t,i}^C;\ q_{t,i}^R],\quad k_{t,i} = [k_{t,i}^C;\ k_t^R] \tag{9}
$$

**注意**：$k_t^R$ **全头共享**（无 $i$ 下标），cache 再加 $d_h^R$ 维/token/layer。

### 6.1 打分分解

$$
S_{t,j,i} = \underbrace{(q_{t,i}^C)^\top k_{j,i}^C}_{\text{内容，可吸收}} + \underbrace{(q_{t,i}^R)^\top k_j^R}_{\text{RoPE，不可吸收}} \tag{10}
$$

$$
\tilde{S}_{t,j,i} = \frac{S_{t,j,i}}{\sqrt{d_{h,C} + d_h^R}},\quad
\alpha_{t,j,i} = \frac{\exp(\tilde{S}_{t,j,i})}{\sum_{j'=1}^{t} \exp(\tilde{S}_{t,j',i})} \tag{11}
$$

$$
o_{t,i} = \sum_{j=1}^{t} \alpha_{t,j,i}\, v_{j,i}^C,\quad u_t = W^O [o_{t,1};\ldots;o_{t,n_h}] \tag{12}
$$

---

## 7. 隐藏维坐标展开

**KV 压缩**（式 (4)）：

$$
c_{t,r}^{KV} = \sum_{m=1}^{d} h_{t,m}\, (W^{DKV})_{m,r},\quad r=1,\ldots,d_c \tag{13}
$$

**Key 内容恢复**（头 $i$，维 $u$）：

$$
k_{t,i,u}^{C} = \sum_{r=1}^{d_c} c_{t,r}^{KV}\, (W^{UK})_{r,\,(i-1)d_{h,C}+u} \tag{14}
$$

**Value**：

$$
v_{t,i,u}^{C} = \sum_{r=1}^{d_c} c_{t,r}^{KV}\, (W^{UV})_{r,\,(i-1)d_{h,C}+u} \tag{15}
$$

**Query 内容**：

$$
c_{t,r'}^{Q} = \sum_{m} h_{t,m} (W^{DQ})_{m,r'},\quad
q_{t,i,u}^{C} = \sum_{r'} c_{t,r'}^{Q} (W^{UQ})_{r',(i-1)d_{h,C}+u} \tag{16}
$$

---

## 8. 双求和：内容分数

将 (13)–(16) 代入 $(q_{t,i}^C)^\top k_{j,i}^C$：

$$
S_{t,j,i}^{C} = \sum_{u=1}^{d_{h,C}} q_{t,i,u}^{C}\, k_{j,i,u}^{C}
= \sum_{r',r} c_{t,r'}^{Q} c_{j,r}^{KV}
\underbrace{\left(\sum_u (W^{UQ})_{r',u'} (W^{UK})_{r,u'}\right)}_{M_{i,r',r}} \tag{17}
$$

交换求和：$S^C$ 是 $(c_t^Q, c_j^{KV})$ 的 **双线性型**，系数 $M_i$ 与 token 位置无关。这是 decode **矩阵吸收** 的代数根（[05 篇](../05-MLA矩阵吸收与非吸收双版本/05-MLA矩阵吸收与非吸收双版本.md) 式 (16)）。

---

## 9. 输出侧：Value 加权与 $W^O$

$$
o_{t,i,u}^{C} = \sum_{j=1}^{t} \alpha_{t,j,i} v_{j,i,u}^{C}
= \sum_{r=1}^{d_c} (W^{UV})_{r,u}^{(i)} \left( \sum_j \alpha_{t,j,i}\, c_{j,r}^{KV} \right) \tag{18}
$$

记 $\bar{c}_{t,r,i}^{V} = \sum_j \alpha_{t,j,i} c_{j,r}^{KV}$。拼接多头：

$$
u_{t,p} = \sum_{i=1}^{n_h} \sum_{u=1}^{d_{h,C}} o_{t,i,u}^{C}\, (W^O)_{(i-1)d_{h,C}+u,\, p} \tag{19}
$$

式 (18) 括号内是 **latent 坐标 $r$ 上的历史凸组合**（再经 $W^{UV}$ 映回头维），与 MHA 式 (12)「先混合 $x_j$ 再 $W_V$」同构，只是混合发生在 $c^{KV}$ 空间。

---

## 10. 因果掩码

Decoder-only 在式 (11) 分母只对 $j \le t$ 求和；$j>t$ 时令 $\tilde{S}_{t,j,i}=-\infty$。MLA 与 MHA **掩码语义相同**；每头独立 softmax。

---

## 11. 数值走查 A：仅内容通道（$d_c=2,\, d_{h,C}=2,\, n_h=1$）

$d=4,\ T=3$，省略 RoPE 与 $\sqrt{d_h}$ 缩放。

$$
h_1=[1,0,0,0]^\top,\ h_2=[0,1,0,0]^\top,\ h_3=[1,1,0,0]^\top
$$

$$
W^{DKV}=\begin{bmatrix}1&0\\0&1\\0&0\\0&0\end{bmatrix}
\Rightarrow c_1^{KV}=[1,0]^\top,\ c_2^{KV}=[0,1]^\top,\ c_3^{KV}=[1,1]^\top
$$

$W^{UK}=W^{UV}=I_2$ → $k_{j,C}=v_{j,C}=c_j^{KV}$。设 $c_t^Q=c_t^{KV}$，$t=3$：

| $j$ | $k_{j,C}^\top$ | $h_3^\top k_j$ |
|:---:|:--------------:|:--------------:|
| 1 | $[1,0]$ | 1 |
| 2 | $[0,1]$ | 1 |
| 3 | $[1,1]$ | 2 |

$\alpha_{3,\cdot} = \mathrm{softmax}([1,1,2]) \approx [0.21, 0.21, 0.58]$，

$$
o_{3,C} \approx 0.58[1,1]^\top + 0.21[1,0]^\top + 0.21[0,1]^\top \approx [0.79, 0.79]^\top
$$

**Cache**：MLA 存 $c_j^{KV}$ 各 2 维；MHA 存 $k,v$ 各 2 维 → 同维。**多 head 时** MHA 存 $2 n_h d_{h,C}$，MLA 仍 **$d_c$**（与 $n_h$ 无关）——这才是 MLA 在长上下文下的量级优势。

---

## 12. 数值走查 B：加入 RoPE 二维子块

设 $d_h^R=2$，对第 0 对维度用 RoPE：位置 $t$ 的旋转角 $\theta_t = t \cdot \omega$。

$$
R_t = \begin{bmatrix}\cos\theta_t & -\sin\theta_t \\ \sin\theta_t & \cos\theta_t\end{bmatrix}
$$

简例：$q_{3,1}^R = R_3 [1,0]^\top$，$k_1^R = R_1 [1,0]^\top$，$k_2^R = R_2 [1,0]^\top$。RoPE 内积 $(R_3 q_0)^\top (R_j k_0) = q_0^\top R_{3-j} k_0$ **只依赖相对位置 $3-j$**——这是解耦 $k^R$ 可 cache、且 **不** 参与 $W^{UK}$ 吸收的原因：相位在打分阶段按 $(t,j)$ 现算，而非并进常数矩阵。

Walkthrough 步骤：

1. 用 §11 算 $S_{3,j,1}^C$ 与 $\alpha_{3,j,1}$；
2. 单独算 $S_{3,j,1}^R = (q_{3,1}^R)^\top k_j^R$；
3. $S_{3,j,1} = S^C + S^R$，再 softmax；
4. $o_3$ 仍只加权 $v^C$（Value 无 RoPE 维）。

---

## 13. 矩阵吸收（概要，详见 05 篇）

内容分：

$$
(q_{t,i}^C)^\top k_{j,i}^C = c_t^Q \underbrace{W^{UQ}_{(i)} (W^{UK}_{(i)})^\top}_{W_{\mathrm{abs},i}} (c_j^{KV})^\top \tag{20}
$$

Value 侧 $W^{UV}_{(i)}$ 并进 $W^O$ 对应块。训练始终用式 (4)–(12) **完整路径**；推理 Prefill 常用非吸收、Decode 常用吸收（[05 篇](../05-MLA矩阵吸收与非吸收双版本/05-MLA矩阵吸收与非吸收双版本.md)）。

---

## 14. KV Cache 量级与字节估算

### 14.1 每 token 每层元素数

| 机制 | cache 对象 | 元素数 |
|------|------------|--------|
| MHA | $k_{j,i}, v_{j,i}$ | $2 n_h d_h$ |
| MQA | 共享 $k_j, v_j$ | $2 d_h$ |
| GQA | $G$ 组 KV | $2 G d_h$ |
| MLA | $c_j^{KV}, k_j^R$ | $d_c + d_h^R$ |

### 14.2 DeepSeek-V2（论文配置）

$d_c=512,\ d_h^R=64,\ n_h=128,\ d_h=128$ → MLA **576** vs MHA **32768** / token / layer（≈ **57×**）。

### 14.3 全模型字节（$N$ 层，batch $B$，长 $L$，FP16 $s=2$）

$$
\text{bytes}_{\mathrm{MLA}} = N \cdot B \cdot L \cdot (d_c + d_h^R) \cdot s \tag{21}
$$

**例**（V2 量级 $N=60,\ B=1,\ L=128\text{K},\ s=2$）：

$$
60 \times 131072 \times 576 \times 2 \approx 8.6\,\mathrm{GB}
$$

同配置 MHA 式 cache 约 **490 GB** 量级（未计 GQA/分页）——说明 MLA 对 **128K 上下文 serving** 的决定性意义。

### 14.4 论文 Table 9（消融摘要）

| 模型 | KV / token | MMLU（5-shot） |
|------|------------|----------------|
| Large MoE + MHA | 860.2K elem | 57.5 |
| Large MoE + MLA | **34.6K elem** | **59.0** |

MLA **更小 cache、更高分**（同论文设置）；不是「压 cache 必然掉点」。

---

## 15. Prefill 与 Decoding

| 阶段 | 输入特点 | MLA 典型路径 | 瓶颈 |
|------|----------|--------------|------|
| Prefill | $L$ 大，cache 空 | **非吸收**：显式 $K^C,V^C$，大 GEMM | $O(L^2)$ 算力 |
| Decode | 每步 1 token，cache 长 | **吸收**：$c^Q W_{\mathrm{abs}} (c^{KV})^\top$ | HBM 读 $c^{KV}$ |

Q 低秩在 Prefill 仍执行 $W^{DQ}, W^{UQ}$；KV 只 append $c_t^{KV}, k_t^R$。切换逻辑见 [05 篇 §6–§8](../05-MLA矩阵吸收与非吸收双版本/05-MLA矩阵吸收与非吸收双版本.md)。

---

## 16. MLA vs MQA/GQA：设计哲学

| | MQA/GQA | MLA |
|---|---------|-----|
| 改什么 | KV **份数** | KV **表示维数** |
| 每头 $k,v$ | 维数仍 $d_h$ | 由 $d_c$ **恢复** |
| RoPE | 与内容同 tensor | **解耦** $k^R$ |
| 训练 | 同结构 | Q/KV 低秩 + 解耦 RoPE |
| 风险 | Key 子空间不足 | 低秩近似；实现双路径一致 |

---

## 17. 实现伪代码（训练 / Prefill 完整路径）

```python
def mla_forward(h, cache, use_cache=False):
    # h: [B, T, d]
    c_q  = h @ W_DQ                    # [B,T,d_c']
    c_kv = h @ W_DKV                   # [B,T,d_c]
    k_pe = rope(h @ W_KR)              # [B,T,d_h^R]

    Q_C = einsum("btc,ihc->bthi", c_q, W_UQ)      # [B,T,n_h,d_hC]
    Q_R = rope(einsum("btc,ic->bti", c_q, W_QR))  # 按头
    K_C = einsum("btc,ikc->btki", c_kv, W_UK)
    V_C = einsum("btc,ikc->btki", c_kv, W_UV)
    K_R = k_pe.unsqueeze(2).expand(-1,-1,n_h,-1)

    Q = cat([Q_C, Q_R], dim=-1)
    K = cat([K_C, K_R], dim=-1)
    scores = einsum("bthk,bslk->bhts", Q, K) / sqrt(d_hC + d_hR)
    scores = scores + causal_mask
    attn = softmax(scores, dim=-1)
    out = einsum("bhts,bskv->bthv", attn, V_C)
    if use_cache:
        cache.append(c_kv[:, -1:], k_pe[:, -1:])
    return merge_heads(out) @ W_O
```

Decode 吸收路径见 05 篇 §11。

---

## 18. 训练与失效模式

| 现象 | 可能原因 | 排查 |
|------|----------|------|
| 128K NIAH 掉点 | RoPE 外推 | YaRN / 长度扩展；$k^R$ cache 是否正确 |
| Prefill/Decode 数值不一致 | 吸收实现 bug | 对比非吸收 baseline；查 $W^O$ 吸收 |
| $d_c$ 过小 perplexity 降 | 过强低秩 | 增大 $d_c$ 或 $d_{h,C}$ |
| 误把 MLA 当 MQA | 概念混淆 | MLA cache 维 $d_c$；MQA cache 维 $d_h$ |

---

## 19. 小结

MLA 四步：**(1)** 式 (4)(5) KV 联合低秩；**(2)** 式 (7) Q 低秩（训练激活）；**(3)** 式 (8)(9) RoPE 解耦使吸收可行；**(4)** 式 (20) decode 吸收。§11–§12 数值链可手算；§14 量化 57× cache；工程双模式见 [05 篇](../05-MLA矩阵吸收与非吸收双版本/05-MLA矩阵吸收与非吸收双版本.md)。

---

## 参考文献

1. Dai, D. et al. (2024). *DeepSeek-V2.* arXiv:2405.04434.（§2.1, 附录 C, Table 9）
2. DeepSeek-AI. (2024). *DeepSeek-V3 Technical Report.* arXiv:2412.19437.
3. Ainslie, J. et al. (2023). *GQA.* arXiv:2305.13245.
4. Su, J. et al. (2024). *RoFormer: Enhanced Transformer with Rotary Position Embedding.*
