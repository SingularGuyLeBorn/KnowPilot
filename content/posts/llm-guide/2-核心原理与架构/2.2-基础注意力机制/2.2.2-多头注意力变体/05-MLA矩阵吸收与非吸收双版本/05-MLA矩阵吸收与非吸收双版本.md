---
title: "MLA 矩阵吸收与非吸收双版本"
---

# MLA 矩阵吸收与非吸收双版本

> 前置：[04 MLA — 低秩潜变量与解耦式注意力](../04-MLA-低秩潜变量与解耦式注意力/04-MLA-低秩潜变量与解耦式注意力.md)

[04 篇](../04-MLA-低秩潜变量与解耦式注意力/04-MLA-低秩潜变量与解耦式注意力.md) 定义了 MLA 的 **数学对象**（$c^{KV}, c^Q, k^R$ 与解耦 RoPE）。本篇回答 **工程落地** 问题：同一套 checkpoint，Prefill 与 Decode 为何走两条计算图？非吸收（MHA mode）与吸收（MQA mode）如何 **代数等价**？DeepSeek-V3 参数下何时切换更省 FLOPs / 激活？

配图：InfraTech 计算流原图 + DeepSeek-V2 论文 Figure 2/3 + 本地复现 FLOPs diff 曲线。

---

## 1. 两种模式：工程地图

![DeepSeek-V3 整体架构](./images/fig-deepseek-v3-architecture.jpg)

> 图 1：InfraTech 架构总览。MLA 位于每个 Transformer 层的注意力子模块。

**图 1 解析**

InfraTech 绘制的 **DeepSeek-V3 整体架构**（高清长图），适合第一次建立「MLA 在整机里占哪一块」的全景。

- **自下而上**：Token Embedding → 重复 $L$ 次的 **Transformer Block** → 输出头（LM Head）。
- **每个 Block 内**（需放大看图）：通常是 **RMSNorm → MLA 注意力 → 残差 → RMSNorm → MoE FFN → 残差**；MLA 替换标准 MHA 位置。
- **MoE 部分**：DeepSeek-V3 用稀疏专家 FFN（路由专家 + 共享专家），与 MLA 正交——MLA 省 KV cache，MoE 省 FFN 激活 FLOPs。
- **与 Figure 2（论文 MLA 细图）关系**：本图看「层间堆叠」；05 篇图 2 看「单层 MLA 内部数据流」。

建议：先扫全图找 **Attention / MLA** 标注，再对照 [04 篇](../04-MLA-低秩潜变量与解耦式注意力/04-MLA-低秩潜变量与解耦式注意力.md) 公式。

![DeepSeek-V2 MLA 模块（论文 Figure 2）](./images/fig-deepseek-v2-mla-appendix-block.jpg)

> 图 2：论文 Figure 2。斜线块 = inference cache（$c^{KV}, k^R$）。

**图 2 解析**

与 [04 篇图 2](../04-MLA-低秩潜变量与解耦式注意力/04-MLA-低秩潜变量与解耦式注意力.md) 同源（DeepSeek-V2 Figure 2 MLA 放大图）。本篇读图时额外强调 **哪些框对应「非吸收 / 吸收」共用**：

- **$c^{KV}, k^R$ 斜线块**：两种模式 **cache 内容完全相同**；差别只在算分时是否把 $W^{UK}, W^{UV}$ 提前乘进 Q/O。
- **$W^{UK}, W^{UV}$ 方框**：非吸收模式在 Attention 前显式执行；吸收模式在图 4 中被「拆开」到 Q 后与 O 前。
- **Multi-Head Attention 大框**：非吸收在 **head 维 $d_{qk}$** 上算；吸收在 **latent 维 $d_c$** 上算（等价 MQA 内核 + broadcast）。

| 模式 | 工程名 | 典型阶段 | KV 上采样 |
|------|--------|----------|-----------|
| **非吸收** | MHA mode | Prefill | cache 后 **显式** $W^{UK}, W^{UV}$ |
| **吸收** | MQA mode | Decode | $W^{UK}$ → Q 侧；$W^{UV}$ → $W^O$ |

![非吸收流图（MHA mode）](./images/fig-mla-non-absorb-compute-flow.jpg)

> 图 3：InfraTech `MLA计算流图(MHA模式).jpg`。Attention 在 **完整 head 维** $d_{qk}$ 上算；KV cache 后接上采样。

**图 3 解析**

InfraTech **MLA 非吸收（MHA mode）** 详细计算流图（Prefill 常用）。图很大，建议按 **数据从左到右、cache 在中间** 读。

**图例**：直角框 = 算子；圆角框 = 张量 $T$；旁标 $W$ = 矩阵乘 $T_{\mathrm{out}}=T_{\mathrm{in}}W$。

**典型阅读顺序**：

1. **输入隐藏态 $h$** 进入 Q/KV 下采样：$W^{DQ}, W^{DKV}$，得到 $c^Q, c^{KV}$；$h$ 另路得到 RoPE 用 $k_{pe}$。
2. **写入 KV Cache**：圆角框标 **compress_kv**、**k_pe**（对应 $c^{KV}, k^R$）——这是推理持久化的部分。
3. **从 cache 读出后**：对整段 cache 做 **KV 上采样** $W^{UK}, W^{UV}$，物化多头 $K_C, V_C$（大张量，随 cache 长度 $y$ 增长）。
4. **Q 上采样** $W^{UQ}$ + RoPE → 多头 $Q$。
5. **Attention 内核**：在 **每头 $d_{qk}$（+ RoPE 维）** 上做标准 MHA（与 [01-MHA](../01-MHA-多头注意力的标准形式/01-MHA-多头注意力的标准形式.md) 同构）。
6. **$W^O$** 输出回 $d_{\mathrm{model}}$。

**与图 4 的关键差异**：图 3 在 Attention **之前** 对 cache 全长做 KV 上采样；Prefill 时 $y=0$ 或 $y$ 较小，一次性大 GEMM 划算；Decode 若误用此路径，会对每个历史 token 重复上采样 → 极慢。

![吸收流图（MQA mode）](./images/fig-mla-absorb-compute-flow.jpg)

> 图 4：InfraTech `MLA计算流图(MQA模式).jpg`。Attention 在 **latent 维** $d_c$ 上算（head 维 broadcast）；上采样拆到 Q/O 两侧。

**图 4 解析**

InfraTech **MLA 吸收（MQA mode）** 计算流图（Decode 常用）。整体拓扑与图 3 相似，但 **KV 上采样方框被拆开、挪位**。

**读图要点**：

1. **Cache 仍只有** $c^{KV}, k_{pe}$——与图 3 **相同**，不增加 cache 体积。
2. **没有**「对全长 cache 做 KV 上采样再进 Attention」的大块；$c^{KV}$ 直接进入 Attention 或在 Q 侧先乘 **吸收矩阵** $W_{\mathrm{abs}} = W^{UQ}W^{UK\top}$。
3. **Q 支路**：$c^Q$ 上采样后，多一个与 $W^{UK}$ 相关的乘（图中常标在 `q_nope` 后）——对应式 $c^Q W_{\mathrm{abs}} (c^{KV})^\top$。
4. **Attention 内**：打分在 **latent 维 $d_c$**（+ RoPE 项）完成；逻辑上 KV 只有 **1 份** latent 序列，对 $n_h$ 个头 **broadcast**（与 [02-MQA](../02-MQA-共享KeyValue的极致压缩/02-MQA-共享KeyValue的极致压缩.md) 内核同构）。
5. **O 支路**：Attention 输出后、$W^O$ 前，多一块来自 $W^{UV}$ 的合并乘——对应 Value 吸收进 $W^{O'}$。
6. **权重不变**：与图 3 同一 checkpoint；只是矩阵乘顺序变化（结合律）。

**第一次读图**：在图 3 找到「KV 上采样」大块，在图 4 找同一功能被拆到 **Q 后 + O 前** 的两处小框，即理解「吸收」。

**流图图例**（图 3–4 通用）：直角框 = 算子；圆角框 = 张量；$W$ = 右乘矩阵。

---

## 2. 附录 C 完整公式（DeepSeek-V2）

与 04 篇式 (4)–(12) 对齐，此处用论文编号 $h_t$：

$$
c_t^{Q} = h_t W^{DQ},\quad
[q_{t,i}^{C}] = W^{UQ} c_t^{Q},\quad
[q_{t,i}^{R}] = \mathrm{RoPE}(W^{QR} c_t^{Q}) \tag{1}
$$

$$
\boxed{c_t^{KV}} = h_t W^{DKV},\quad
[k_{t,i}^{C}] = W^{UK} c_t^{KV},\quad
[v_{t,i}^{C}] = W^{UV} c_t^{KV},\quad
\boxed{k_t^{R}} = \mathrm{RoPE}(h_t W^{KR}) \tag{2}
$$

$$
q_{t,i}=[q_{t,i}^{C}; q_{t,i}^{R}],\ k_{t,i}=[k_{t,i}^{C}; k_t^{R}] \tag{3}
$$

$$
o_{t,i} = \sum_{j=1}^{t} \mathrm{Softmax}_j\!\left(\frac{q_{t,i}^\top k_{j,i}}{\sqrt{d_{h,C}+d_h^{R}}}\right) v_{j,i}^{C},\quad
u_t = W^{O} [o_{t,1};\ldots;o_{t,n_h}] \tag{4}
$$

**训练**：始终按式 (1)–(4) 前向（非吸收语义）。**推理**：按阶段选非吸收或吸收实现，权重 tensor **相同**。

---

## 3. 张量形状对照表（DeepSeek-V3 参数）

`d=7168, n_h=128, d_c=512, d_c'=1536, d_hC=128, d_hR=64, d_v=128`

| 步骤 | 非吸收（Prefill） | 吸收（Decode, 1 token） |
|------|-------------------|-------------------------|
| $c^Q$ | `[B, x, 1536]` | `[B, 1, 1536]` |
| $c^{KV}$ cache | `[B, x+y, 512]` | append `[B,1,512]` |
| $k^R$ cache | `[B, x+y, 64]` | append `[B,1,64]` |
| $Q^C$ | `[B, x, 128, 128]` | `[B, 1, 128, 128]` |
| $K^C$ | `[B, x+y, 128, 128]` **物化** | **不物化** |
| $V^C$ | `[B, x+y, 128, 128]` **物化** | **不物化** |
| Attention 内积维 | $128+64=192$ / head | $512+64=576$ latent+rope |
| $O$ 输入 | `[B, x, 128, 128]` | `[B, 1, 128, 512]` latent 聚合后 |

吸收路径 Attention 在 **$d_c$ 维** 上与 cache 交互，等价 MQA「单份 KV latent」+ head broadcast。

---

## 4. 非吸收路径：逐步展开

### 4.1 标量坐标（头 $i$，维 $u$）

$$
q_{t,i,u}^{C} = \sum_{r'} c_{t,r'}^{Q} (W^{UQ})_{r',(i-1)d_{h,C}+u} \tag{5}
$$

$$
k_{j,i,u}^{C} = \sum_{r} c_{j,r}^{KV} (W^{UK})_{r,(i-1)d_{h,C}+u},\quad
v_{j,i,u}^{C} = \sum_{r} c_{j,r}^{KV} (W^{UV})_{r,(i-1)d_{h,C}+u} \tag{6}
$$

对 **cache 中全部** $j \in [1, x+y]$ 执行 (6) 的上投影 → Prefill 代价 $\propto n_h (x+y) d_c d_{h,C}$，但可与 FlashAttention 大 GEMM 融合。

### 4.2 内容分数双线性型

$$
S_{t,j,i}^{C} = \sum_{r',r} c_{t,r'}^{Q} c_{j,r}^{KV} M_{i,r',r},\quad
M_{i,r',r} = \sum_u (W^{UQ})_{r',u} (W^{UK})_{r,u} \tag{7}
$$

### 4.3 RoPE 分数（不可合并进 $M$）

$$
S_{t,j,i}^{R} = (q_{t,i}^{R})^\top k_j^{R},\quad
S_{t,j,i} = S_{t,j,i}^{C} + S_{t,j,i}^{R} \tag{8}
$$

---

## 5. 吸收路径：Key / Value 侧推导

### 5.1 Key 吸收

$$
(q_{t,i}^{C})^\top k_{j,i}^{C}
= c_t^{Q} W^{UQ}_{(i)} (W^{UK}_{(i)})^\top (c_j^{KV})^\top
= c_t^{Q} W_{\mathrm{abs},i} (c_j^{KV})^\top \tag{9}
$$

$$
W_{\mathrm{abs},i} = W^{UQ}_{(i)} (W^{UK}_{(i)})^\top \in \mathbb{R}^{d_c' \times d_c} \tag{10}
$$

加载权重时预计算 $W_{\mathrm{abs},i}$，**与 $y$ 无关**。

### 5.2 Value 吸收进 $W^O$（块矩阵形式）

记 $\alpha_{t,j,i}$ 为头 $i$ 的注意力权重。非吸收：

$$
o_{t,i,u}^{C} = \sum_j \alpha_{t,j,i} \sum_r c_{j,r}^{KV} (W^{UV})_{r,u}^{(i)} \tag{11}
$$

拼接 $o_t = [o_{t,1}; \ldots; o_{t,n_h}]$，$u_t = o_t W^O$。将 (11) 代入：

$$
u_{t,p} = \sum_i \sum_u \sum_j \alpha_{t,j,i} \sum_r c_{j,r}^{KV} (W^{UV})_{r,u}^{(i)} (W^O)_{\mathrm{idx}(i,u), p} \tag{12}
$$

定义吸收后投影 $(W^{O'})_{r,p}^{(i)} = \sum_u (W^{UV})_{r,u}^{(i)} (W^O)_{\mathrm{idx}(i,u), p}$，则：

$$
u_{t,p} = \sum_i \sum_r \underbrace{\left(\sum_j \alpha_{t,j,i} c_{j,r}^{KV}\right)}_{\bar{c}_{t,r,i}^{V}} (W^{O'})_{r,p}^{(i)} \tag{13}
$$

Attention 输出直接是 **latent 维** 上的 $\bar{c}^V$，再经 $W^{O'}$ 回 $d_{\mathrm{model}}$——对应图 4 中 O 前的额外 $W$。

### 5.3 等价性三条件

1. 内容分只用 (9)(10)，RoPE 分只用 (8) 相加；
2. $W^{O'}$ 与 (13) 浮点结合顺序与训练图一致；
3. softmax 归一化域相同（同一 $S_{t,j,i}$）。

---

## 6. 数值走查：非吸收 vs 吸收（无 RoPE）

$d_c=d_c'=2,\ d_{h,C}=2,\ n_h=1$。$c_1^{KV}=[1,0]^\top,\ c_2^{KV}=[0,1]^\top$；$c_2^Q=[1,1]^\top$；$W^{UQ}=W^{UK}=W^{UV}=I$。

**非吸收**：$k_1^C=[1,0]^\top,\ k_2^C=[0,1]^\top$；$S_{2,1}^C=S_{2,2}^C=1$ → $\alpha=[0.5,0.5]$ → $o_2^C=[0.5,0.5]^\top$。

**吸收**：$W_{\mathrm{abs}}=I$；$S_{2,j}^C = c_2^Q (c_j^{KV})^\top$ 相同；$\bar{c}_2^V = 0.5 c_1^{KV}+0.5 c_2^{KV}=[0.5,0.5]^\top = o_2^C$。

吸收路径 **未 allocate** $K^C \in \mathbb{R}^{2 \times 2}$ 张量。

---

## 7. 数值走查：含 RoPE 一项

设 $d_h^R=2$，$q_2^R=k_j^R$ 为二维单位向量经 $R_j$ 旋转。即使 $S^C$ 同 §6，加上 $S^R$ 后 $\alpha$ 改变，**两路径仍一致**——只要 (8) 在非吸收与吸收中 **同一式** 计算，且 Value 仍只聚合 $v^C$（RoPE 不进 Value）。

Walkthrough：$S_{2,j}=S_{2,j}^C + (R_2 q_0)^\top (R_j k_0)$ → softmax → 式 (11)(13) 分别算 $u_2$，应 bitwise 匹配（忽略浮点误差）。

---

## 8. 为何要分两版？阶段与 $(x,y)$

记 $x=\text{seq\_len}$（当前步参与计算的 query 数），$y=\text{cache\_len}$（已有历史）。

| 场景 | $x$ | $y$ | 更优 | 原因 |
|------|-----|-----|------|------|
| Prefill | $\gg 1$ | 0 | **非吸收** | 大 $x$ 时 $x(y+x)$ attention GEMM 主导；显式 $K^C,V^C$ 利于 Tensor Core |
| Decode | 1 | $\gg 1$ | **吸收** | 避免对 $y$ 个历史重复 $c_j^{KV} \mapsto k_j^C$（$\propto y n_h d_c d_{h,C}$） |
| Prefix | 中 | 中 | 看交叉点 | 图 7 |

DeepSeek-V3：**Prefill = MHA mode，Decode = MQA mode**（InfraTech README 与论文一致）。

---

## 9. FLOPs 模型（V3 参数）

`bs=1, n_h=128, d=7168, d_c=512, d_c'=1536, d_hC=128, d_hR=64, d_v=128`

**非吸收主项**（乘加次数量级，省略系数 2）：

$$
\begin{aligned}
F_q &\sim x d d_c' + x d_c' n_h d_{qk} \\
F_{kv} &\sim x d (d_c+d_hR) + n_h (x+y) d_c (d_{h,C}+d_v) \\
F_{\mathrm{attn}} &\sim n_h x (x+y) (d_{qk}+d_hR+d_v) \\
F_o &\sim x n_h d_v d
\end{aligned} \tag{14}
$$

**吸收**：去掉 $F_{kv}$ 中 $n_h(x+y)d_c(d_{h,C}+d_v)$；加 $F_{q,\mathrm{abs}} \sim n_h x d_{h,C} d_c$；$F_{\mathrm{attn}}$ 中 head 维换成 $d_c+d_hR$ 与 $d_c$；$F_o$ 加 $x n_h d_c d_v$。

### 9.1 归一化差分

$\Delta F = F_{\mathrm{non-abs}} - F_{\mathrm{abs}}$，约去 $2bs n_h$ 后：

$$
z = 131072\, y - 768\, x^2 - 768\, x y \tag{15}
$$

$z>0$ → 非吸收省；$z<0$ → 吸收省。

### 9.2 代入数值

**Prefill**：$x=4096,\ y=0$：

$$
z = -768 \times 4096^2 \approx -1.29 \times 10^{10} < 0
$$

$z = F_{\mathrm{non-abs}} - F_{\mathrm{abs}} < 0$ → 非吸收 FLOPs **更少** → 选 **MHA mode**（与图 5 一致）。

**Decode**：$x=1,\ y=4096$：

$$
z = 131072 \times 4096 - 768 - 768 \times 4096 \approx 5.3 \times 10^{8} > 0
$$

非吸收 FLOPs **更多** → 选 **MQA mode（吸收）**（与图 6 一致）。

![Prefill diff](./images/fig-mla-flops-diff-prefill.jpg)

> 图 5：$y=0$，$x$ 增大时 $z<0$ 加深 → **非吸收** FLOPs 更少（Prefill 选 MHA mode）。

**图 5 解析**

横轴 **seq_len** $x$（Prefill 时当前 batch 长度），纵轴 $z = F_{\mathrm{non-abs}} - F_{\mathrm{abs}}$（非吸收减吸收的 FLOPs 差）。**红色虚线 $z=0$**。

- 固定 **cache_len $y=0$**（纯 Prefill、无历史 cache）。
- 曲线全程在 0 线 **下方** → $z<0$ → **非吸收总 FLOPs 更少**。
- $x$ 越大（长 prompt），曲线越负 → 越应选 **MHA mode（图 3）**。

物理含义：长 prompt 并行算时，显式 $K^C,V^C$ 大 GEMM 的 Tensor Core 利用率高；吸收路径额外的 $W_{\mathrm{abs}}$ 乘在 Prefill 不划算。

![Decode diff](./images/fig-mla-flops-diff-decode.jpg)

> 图 6：$x=1$，$y$ 增大后 $z>0$ → 吸收更优（Decode 选 MQA mode）。

**图 6 解析**

横轴 **cache_len** $y$（已有历史 token 数），纵轴仍为 $z$。固定 **seq_len $x=1$**（Decode 每步只来 1 个新 token）。

- 起始 $y=0$ 附近 $z$ 可能 $\le 0$；随 $y$ 增大曲线 **升到 0 线以上** → $z>0$ → **非吸收更费** → 应选 **MQA mode（图 4）**。
- 长对话（$y=4096+$）时差距显著：若仍用图 3 对全长 cache 做 KV 上采样，FLOPs $\propto y$ 的浪费极大。

对应工程：**生成阶段默认吸收路径**。

![Prefix $y=20$](./images/fig-mla-flops-diff-prefix-cache.jpg)

> 图 7：固定 $y=20$ 存在 $z=0$ 的 $x$ 交叉点。

**图 7 解析**

**Prefix cache / 混合场景**：已有 **$y=20$** 个历史 token，再 Prefill 一段长度为 $x$ 的新 prompt 片段。

- 横轴 $x$ 从短到长；纵轴 $z$ 从负变正（或反之），与 **纯 Prefill（图 5）**、**纯 Decode（图 6）** 都不同。
- 曲线与 **$z=0$ 红线相交** → 存在交叉点 $x^*$：左侧一种模式更省，右侧另一种更省。
- 工程含义：带 prefix 的推理服务不能「全局只开一种 mode」，可能在 chunk 边界按 $(x,y)$ 切换，或在 $x^*$ 附近任选（差异不大）。

![3D 曲面](./images/fig-mla-flops-diff-3d.jpg)

> 图 8：$\Delta F(x,y)$ 全曲面。

**图 8 解析**

三维曲面：横轴 **seq_len** $x$，纵轴 **cache_len** $y$，竖轴 **FLOPs 差分 $z$**。DeepSeek-V3 参数下本地复现（公式 (15)）。

- **$z>0$ 区域**（曲面在 0 平面之上）：非吸收更费 → 倾向 **吸收 / MQA mode**。
- **$z<0$ 区域**（曲面之下）：非吸收更省 → 倾向 **MHA mode**。
- **$z=0$ 曲面与平面交线**：两种模式算力等价；Prefill 角（$y$ 小、$x$ 大）在平面下；Decode 角（$x=1,y$ 大）在平面上。
- 与图 5–7 关系：图 5 = 取 $y=0$ 切片；图 6 = 取 $x=1$ 切片；图 7 = 取 $y=20$ 切片。

一张图汇总 **「什么时候用图 3、什么时候用图 4」** 的完整地图。

Notebook：[InfraTech/MLA_diff_mode_mfu_calculation.ipynb](https://github.com/CalvinXKY/InfraTech/blob/main/deepseek_v3/MLA_diff_mode_mfu_calculation.ipynb)

### 9.3 交叉点（Prefix cache）

令 $z=0,\ y>0$：$131072 y = 768 x(x+y)$ → 给定 $y$ 可解最优切换 $x^*$。例 $y=20$：$x^* \approx 85$（见图 7 零点）。

---

## 10. 显存：权重、Cache、激活

### 10.1 静态权重

两模式 **同一 checkpoint**。运行时可选：

- 预合并 $W_{\mathrm{abs},i}$、$W^{O'}$（额外 workspace，不增 disk 体积）；
- 或按需乘（省内存、费 FLOPs）。

### 10.2 KV Cache（与 04 篇 §14 一致）

每 token 每层：**576** FP16 元素（512+64）vs MHA 式 32768。

### 10.3 激活峰值（InfraTech 结论）

| 阶段 | 非吸收 | 吸收 |
|------|--------|------|
| Prefill | $K^C,V^C$ 物化，峰值 $\propto n_h(x+y)d_{h,C}$ | 一般不选 |
| Decode | 若强行使用，仍物化 $K^C$ | Attention 在 $d_c$ 维，峰值 $\propto n_h(x+y)d_c$ |

当 $d_c < d_{h,C}$ 且 $y$ 大时，吸收 **激活** 在 Attention 段可更低；但 Q/O 吸收乘引入额外 buffer。Net：Prefill 仍偏非吸收（算力 + 激活）；Decode 偏吸收（算力 + 少物化 $K^C$）。

---

## 11. 流图框  公式映射（图 3–4）

| 流图框 | 公式 | 非吸收 | 吸收 |
|--------|------|--------|------|
| Q 下采样 | $c^Q = h W^{DQ}$ | ✓ | ✓ |
| Q 上采样 | $W^{UQ}$ | ✓ | ✓ |
| Q 吸收乘 | $W_{\mathrm{abs}}$ | ✗ | ✓ |
| KV 下采样 | $c^{KV}=h W^{DKV}$ | ✓ cache | ✓ cache |
| k_pe | $k^R=\mathrm{RoPE}(hW^{KR})$ | ✓ cache | ✓ cache |
| KV 上采样 | $W^{UK}, W^{UV}$ | ✓ 对 cache 全长 | ✗ 进 Q/O |
| Attention | 式 (4) | head 维 MHA | latent 维 MQA |
| O 投影 | $W^O$ / $W^{O'}$ | $W^O$ | $W^{O'}$ |

---

## 12. Decode 单步走查（$x=1,\ y=1000$）

1. 输入 $h_t \in \mathbb{R}^{7168}$（新 token）。
2. $c_t^Q, c_t^{KV}$ 各 `[1,512]` / `[1,1536]`；append cache → $y=1001$。
3. **吸收**：算 $W_{\mathrm{abs},i}$ 得 scores $[128, 1001]$；加 RoPE 项；softmax。
4. $\bar{c}^V = \mathrm{attn} @ c^{KV}_{cache}$ → `[128, 512]`。
5. $u_t = \bar{c}^V @ W^{O'}$ → `[7168]`。

**非吸收**若用于同一步：需先 `up_k/up_v` 得 $K^C,V^C$ shape `[128,1001,128]` → 额外 $\sim 2 \times 128 \times 1001 \times 128 \approx 32M$ 元素物化/读。

---

## 13. 实现：阶段切换伪代码

```python
def mla_layer(h, cache, mode):
    c_q  = h @ W_DQ
    c_kv = h @ W_DKV
    k_pe = rope(h @ W_KR)
    cache.append(c_kv, k_pe)

    if mode == "mha":  # Prefill
        Q_C = up_q(c_q, W_UQ)
        Q_R = rope_q(c_q, W_QR)
        K_C = up_k(cache.c_kv, W_UK)      # [B,T,n_h,d_hC]
        V_C = up_v(cache.c_kv, W_UV)
        K_R = cache.k_pe.unsqueeze(2).expand(-1,-1,n_h,-1)
        out = flash_attn(cat(Q_C,Q_R), cat(K_C,K_R), V_C)
        return out @ W_O

    # mqa — Decode
    scores = einsum("bhc,btc->bht", c_q @ W_abs, cache.c_kv)
    scores += rope_scores(c_q, cache.k_pe)
    attn = softmax(scores, dim=-1)
    ctx  = einsum("bht,btc->bhc", attn, cache.c_kv)
    return einsum("bhc,hcp->bp", ctx, W_O_abs)
```

vLLM / SGLang / DeepSeek 推理栈在 **scheduler** 层根据 batch 是 prefill 还是 decode 自动设 `mode`；同一 layer 权重指针不变。

---

## 14. 与标准 MQA 内核的关系

吸收模式 Attention 在 **KV 维** 只有 **一份** $c^{KV}$（latent），对 $n_h$ 个 Q 头 broadcast——与 [MQA](../02-MQA-共享KeyValue的极致压缩/02-MQA-共享KeyValue的极致压缩.md) 的「多 Q 单 KV」同构，但：

- MQA 的 KV 维是 $d_h$；MLA 吸收路径是 $d_c$（通常 $d_c \neq d_h$）；
- MLA 另有 RoPE 通道 $k^R$ 与内容分 **相加** 打分；
- MLA 权重来自低秩分解，不是 MHA pool 得到。

因此 DeepSeek 称吸收形态为 **MQA mode**（内核布局），而非「模型变成 MQA 架构」。

---

## 15. 常见误解（扩展）

| 误解 | 纠正 |
|------|------|
| 吸收会掉精度 | 精确线性重排；掉点来自 $d_c$ 低秩，非吸收本身 |
| 两模式要两套权重 | 一套；仅 runtime graph 不同 |
| Prefill 也用吸收更省 KV | KV cache 相同；Prefill 省的是 **算力/激活**，非 cache |
| $W^{UK}$ 吸收 = 删掉 $W^{UK}$ | 合并进 $W_{\mathrm{abs}}$，数学仍在 |
| 图 4 与图 3 训练不兼容 | 训练用完整式；两图仅 inference |

---

## 16. 训练与失效模式

| 现象 | 排查 |
|------|------|
| Prefill/Decode 输出漂移 | 对照全 non-absorb；查 $W^{O'}$ 块索引 |
| 长 cache 延迟仍高 | 是否误用 non-absorb decode；bandwidth bound |
| MFU 低于 notebook | kernel 未 fuse 吸收乘；head broadcast 低效 |
| Prefix 切换抖动 | 在 $z=0$ 附近 hysteresis，避免频繁切换 |

---

## 17. 小结

| 维度 | 非吸收 MHA mode | 吸收 MQA mode |
|------|-----------------|---------------|
| 式 | (6) 显式 $K^C,V^C$ | (9)(13) latent |
| 适用 | Prefill、大 $x$ | Decode、大 $y$ |
| KV cache | $d_c+d_hR$ | 同 |
| FLOPs | $z<0$（$y=0$，大 $x$） | $z>0$（$x=1$，大 $y$） |
| 图 | 图 3 | 图 4 |

**一句话**：[04 篇](../04-MLA-低秩潜变量与解耦式注意力/04-MLA-低秩潜变量与解耦式注意力.md) 定义 **cache 是什么**；本篇定义 **同一权重下乘法顺序如何排** 才在 Prefill/Decode 各段最省。式 (9)–(13) 是吸收代数；式 (15) 是选型地图；图 3–8 是工程与实验对照。

---

## 参考文献

1. Dai, D. et al. (2024). *DeepSeek-V2.* arXiv:2405.04434.（附录 C）
2. DeepSeek-AI. (2024). *DeepSeek-V3 Technical Report.* arXiv:2412.19437.
3. CalvinXKY. *InfraTech — DeepSeek V3 MLA.* [github.com/CalvinXKY/InfraTech/tree/main/deepseek_v3](https://github.com/CalvinXKY/InfraTech/tree/main/deepseek_v3)
4. CalvinXKY. *MLA_diff_mode_mfu_calculation.ipynb.* [GitHub](https://github.com/CalvinXKY/InfraTech/blob/main/deepseek_v3/MLA_diff_mode_mfu_calculation.ipynb)
