---
title: Attention Residuals 推导笔记
category: 推导笔记
published: true
excerpt: 从 Pre-LN 残差连接的累加问题出发，推导 Attention Residuals（AttnRes）的设计动机与最终形式。
tags:
  - Attention Residuals
  - 残差连接
  - 注意力机制
  - Transformer
  - 推导笔记
---
# Attention Residuals 推导笔记

> 从 Pre-LN 残差连接的累加问题出发，推导 Attention Residuals（AttnRes）的设计动机与最终形式。

***

## 1. Pre-LN 残差连接的问题

设一个 Transformer block 为 $F$。Pre-LN 的递推为：

$$
h_i = F_i(\mathrm{Norm}(x_i))
$$

$$
x_{l+1} = x_l + h_l
$$

展开后：

$$
x_1 = x_0 + h_0
$$

$$
x_2 = x_1 + h_1 = x_0 + h_0 + h_1
$$

$$
\vdots
$$

$$
x_l = x_0 + \sum_{i=0}^{l-1} h_i
$$

***

## 2. 两个核心问题

### 问题一：残差流幅度无界增长

$x_l$ 是前面所有 $h_i$ 的累加和，因此：

$$
\|x_l\| \approx \|x_0\| + \sum_{i=0}^{l-1} \|h_i\|
$$

随着深度 $l$ 增加，$\|x_l\|$ 单调增长（经验上常呈线性或指数增长）。

### 问题二：所有历史层等权累加，无选择性

在 Pre-LN 展开式中：

$$
x_L = x_0 + \sum_{i=0}^{L-1} h_i
$$

每个 $h_i$ 的系数都是 $1$。虽然 $h_i$ 对 $x_L$ 的**绝对贡献**固定为 $1$，但其**相对贡献**随深度 $L$ 衰减。

假设各层输出幅度有界：$\|h_i\| \leq M$。若 $h_i$ 大致同向累加，则：

$$
\|x_L\| \approx \|x_0\| + L \cdot M
$$

第 $i$ 层输出 $h_i$ 对最终状态 $x_L$ 的相对贡献为：

$$
\frac{\|h_i\|}{\|x_L\|} \approx \frac{M}{\|x_0\| + L \cdot M} \to O\!\left(\frac{1}{L}\right), \quad L \to \infty
$$

即使 $h_i$ 之间不完全同向，仅按随机游走假设（各 $h_i$ 近似独立同分布），也有：

$$
\mathbb{E}[\|x_L\|^2] = \|x_0\|^2 + \sum_{i=0}^{L-1} \mathbb{E}[\|h_i\|^2] \approx \|x_0\|^2 + L \cdot \sigma^2
$$

从而 $\|x_L\| \sim \sqrt{L}$，相对贡献衰减至 $O(1/\sqrt{L})$。

**结论**：无论累加是同向还是随机，早期层 $h_i$ 对深层状态 $x_L$ 的相对影响力都会随深度衰减。这就是"早期层信息被稀释"的数学含义。

此外，所有层系数固定为 $1$，意味着：

* 当前层无法选择性地关注更相关的历史层；
* 不同类型的层（Attention / MLP）对输入的需求相同。

### 两个问题的耦合

问题一和问题二并非独立，而是通过残差递推形成正反馈。

Pre-LN 的更新为：

$$
x_{l+1} = x_l + h_l
$$

第 $l$ 层对 $x_{l+1}$ 的**相对影响力**为：

$$
\rho_l = \frac{\|h_l\|}{\|x_{l+1}\|}
$$

若要求每一层保持非零相对影响力（即 $\rho_l \geq \varepsilon$ 对某个常数 $\varepsilon > 0$），则：

$$
\|h_l\| \geq \varepsilon \|x_{l+1}\|
$$

由于 $x_{l+1} = x_l + h_l$ 且假设 $h_l$ 与 $x_l$ 近似同向，有：

$$
\|x_{l+1}\| \approx \|x_l\| + \|h_l\| \geq \|x_l\| + \varepsilon \|x_{l+1}\|
$$

整理得：

$$
\|x_{l+1}\| \geq \frac{1}{1-\varepsilon} \|x_l\|
$$

因此：

$$
\|x_L\| \geq \|x_0\| \left(\frac{1}{1-\varepsilon}\right)^L
$$

即残差流幅度随深度**指数增长**。

同时，由 $\|h_l\| \geq \varepsilon \|x_{l+1}\|$ 可知，各层输出 $h_l$ 也必须随深度指数增长：

$$
\|h_l\| \geq \varepsilon \|x_0\| \left(\frac{1}{1-\varepsilon}\right)^{l+1}
$$

**耦合的直观解释**：

* $x_l$ 越大 → $h_l$ 必须越大才能影响 $x_{l+1}$；
* $h_l$ 越大 → $x_{l+1} = x_l + h_l$ 越大；
* 循环往复，导致深层 $h_l$ 和 $x_l$ 同步指数增长。

这正对应原文中的观察：深层网络必须学习越来越大的输出，从而增加训练不稳定性。

AttnRes 通过 $\sum_i a_i = 1$ 的凸组合，将 $x_{l+1}$ 限制在 $\max_i \|h_i\|$ 范围内，直接打断这一正反馈循环。

***

## 3. 改进思路：从固定累加到加权聚合

将固定系数 $1$ 替换为可学习的权重：

$$
x_{l+1} = \sum_{i=0}^{l} a_i^{(l+1)} h_i
$$

其中约定 $h_0 = x_0$，即把 embedding 层也作为第一个历史层输出。

对权重施加两个自然约束：

1. $a_i^{(l+1)} \geq 0$（非负，避免反向抵消）
2. $\sum_{i=0}^{l} a_i^{(l+1)} = 1$（归一化，控制残差流幅度）

由三角不等式和归一化约束：

$$
\|x_{l+1}\| = \left\| \sum_{i=0}^{l} a_i^{(l+1)} h_i \right\| \leq \sum_{i=0}^{l} a_i^{(l+1)} \|h_i\| \leq \max_i \|h_i\|
$$

因此 $x_{l+1}$ 是历史层输出的凸组合，幅度被控制在 $\max_i \|h_i\|$ 内，不再随深度累加增长。

### 3.1 从约束自然导出 softmax 形式

一旦确定 $a_i \geq 0$ 且 $\sum a_i = 1$，最自然的参数化就是 softmax：

$$
a_i^{(l+1)} = \frac{\exp(s_i^{(l+1)})}{\sum_{j=0}^{l} \exp(s_j^{(l+1)})}
$$

其中 $s_i^{(l+1)}$ 是未归一化的分数（logit），可以任意取值。

这样，设计问题从"直接学习受约束的 $a_i$"简化为：

> **设计分数函数** $s_i^{(l+1)}$，使其合理反映历史层 $h_i$ 与当前层 $l+1$ 的关联程度。

由于 softmax 自动满足非负性和归一化，我们只需要关注 $s_i^{(l+1)}$ 如何与 $h_i$ 相关即可。

### 3.2 分数函数：静态的，还是与 $h_i$ 相关的？

一旦把问题变成"设计 $s_i^{(l+1)}$"，第一个问题就是：这个分数是否与历史层输出 $h_i$ 有关？

#### 方案 A：静态分数

$$
s_i^{(l+1)} = c_i^{(l+1)}
$$

其中 $c_i^{(l+1)}$ 是只与层索引 $i$ 和 $l+1$ 有关的可学习标量。

对应的权重 $a_i^{(l+1)}$ 只由层索引决定，与输入无关。这意味着不同输入使用同样的历史层组合，无法根据内容动态选择。

论文消融实验（Table 4）显示，DenseFormer 采用这种固定标量系数时，loss 为 $1.767$，与 Pre-LN baseline 的 $1.766$ 几乎没有区别，说明**静态权重不足以超越残差 baseline**。

#### 方案 B：动态分数，与 $h_i$ 相关

$$
s_i^{(l+1)} = f(g_{l+1}, h_i)
$$

其中 $g_{l+1}$ 是第 $l+1$ 层的偏好向量，$h_i$ 是历史层输出。这样分数随输入变化，因为 $h_i$ 随输入变化。

AttnRes 选择方案 B，用 softmax attention 实现：

$$
a_i^{(l+1)} = \frac{\exp(f(g_{l+1}, h_i))}{\sum_{j=0}^{l} \exp(f(g_{l+1}, h_j))}
$$

#### 为什么不把 query 也做成输入依赖？

理论上可以让 query 也依赖当前输入：

$$
g_{l+1} = W_q \, x_{l+1} + b_q
$$

论文消融实验显示，input-dependent query 能进一步降低 loss（$1.731$ vs $1.737$），但会带来额外计算和推理复杂度。AttnRes 默认采用**静态 query + 动态 key** 的折中：

* query 只与层索引有关，便于工程实现和预计算；
* key 来自历史层输出，权重仍随输入变化，保留了内容感知能力。

**总结**：系数和为 $1$ 且非负是自然的约束，softmax 是满足这一约束的最自然形式。在此形式下，只需设计分数函数 $s_i^{(l+1)}$。分数函数必须与历史层内容 $h_i$ 相关，才能真正实现选择性访问；静态分数虽然也能满足约束，但无法突破残差 baseline。

### 3.3 补充：ResNet 原论文是否做过类似消融？

原始 ResNet 论文（He et al., 2016, *Deep Residual Learning for Image Recognition*）**没有**做这种"静态可学习权重聚合所有历史层"的消融实验。

ResNet 原论文的消融主要集中在快捷连接本身的设计：

| 实验                              | 内容                    | 结论                  |
| ------------------------------- | --------------------- | ------------------- |
| Plain vs Residual               | 同深度的 plain 网络 vs 残差网络 | 残差连接解决退化问题          |
| Identity vs Projection shortcut | 恒等映射 vs 1×1 卷积投影      | 恒等映射足够好，投影只在维度变化时必要 |
| Bottle-neck design              | 1×1-3×3-1×1 结构        | 更深的网络可用 bottleneck  |

原论文的核心形式是 $y = F(x) + x$，系数固定为 $1$，没有尝试学习每层不同的权重。

最接近的相关工作：

* **DenseNet**（2017）：把所有历史层**拼接**起来；
* **DenseFormer**：把所有历史层用**固定可学习标量**加权，即 AttnRes 论文 Table 4 中 loss 1.767 的 baseline；
* **Highway Networks**（2015）：用可学习门控控制残差与变换的加权，但实验发现门控会趋于"打开"状态，即退化为普通残差。

因此，AttnRes 论文中 DenseFormer 的消融结果是后来这一研究方向上的证据，用来支撑：**单纯把固定系数** $1$ 改成可学习静态系数，不足以超越残差 baseline；必须让权重与内容相关（即 attention），才能真正实现选择性聚合。

***

## 4. 分数函数的具体设计

### 4.1 最简单的选择：线性内积

最自然的打分方式是用 query-key 内积：

$$
s_i^{(l+1)} = g_{l+1}^\top k_i
$$

其中 $g_{l+1} \in \mathbb{R}^d$ 是第 $l+1$ 层可学习的 query 向量，$k_i$ 是第 $i$ 层输出的 key。

### 4.2 对 key 做 RMSNorm：剥离幅度影响

若直接取 $k_i = h_i$，则 $\|h_i\|$ 较大的层会在 softmax 中天然占优。我们希望的匹配是基于**方向/内容**相似度，而非幅度大小。

因此对 key 做 RMSNorm：

$$
k_i = \mathrm{RMSNorm}(h_i)
$$

RMSNorm 是正标量缩放，不改变方向：

$$
\mathrm{RMSNorm}(c \cdot h) = \mathrm{RMSNorm}(h), \quad \forall c > 0
$$

于是 $g_{l+1}^\top k_i$ 只反映方向夹角的余弦相似度，不受原始幅度影响。

***

## 5. 最终形式

综合以上，AttnRes 的输入聚合公式为：

$$
\boxed{
x_{l+1} = \sum_{i=0}^{l} a_i^{(l+1)} h_i
}
$$

$$
\boxed{
a_i^{(l+1)} = \frac{\exp\!\left(g_{l+1}^\top \, \mathrm{RMSNorm}(h_i)\right)}{\sum_{j=0}^{l} \exp\!\left(g_{l+1}^\top \, \mathrm{RMSNorm}(h_j)\right)}
}
$$

其中：

* $g_{l+1} \in \mathbb{R}^d$：第 $l+1$ 层的可学习 query 向量，只与层索引有关，与输入无关；
* $h_i$：第 $i$ 个 Transformer block 的输出（$h_0 = x_0$ 为 embedding）；
* $k_i = \mathrm{RMSNorm}(h_i)$：第 $i$ 层输出的归一化 key；
* $a_i^{(l+1)}$：第 $l+1$ 层对第 $i$ 层的注意力权重。

***

## 6. 设计动机总结

| 问题             | 解决方案                  | 作用              |
| -------------- | --------------------- | --------------- |
| 残差流 $x_l$ 无界增长 | 加权聚合 + $\sum a_i = 1$ | 凸组合，幅度有界        |
| 历史层等权累加，无选择性   | 可学习 softmax attention | 动态选择相关历史层       |
| 幅度大的层主导注意力     | key 做 RMSNorm         | 匹配基于方向，而非幅度     |
| 权重可能为负或归一化困难   | softmax               | 保证非负、和为 1、竞争性选择 |

***

## 7. 与 Block AttnRes 的关系

Full AttnRes 需要对每一层都 attention 到所有历史层，计算和通信复杂度为 $O(L^2 \cdot d)$。为了扩展到大规模模型，引入 Block AttnRes：

* 将 $L$ 层划分为 $N$ 个 block；
* block 内用标准残差累加压缩成一个 block 表示；
* block 之间执行 Full AttnRes 风格的注意力。

复杂度从 $O(L^2 \cdot d)$ 降到 $O(N \cdot L \cdot d)$，同时保留了大部分收益。

核心洞察：Block AttnRes 的压缩仍然是加权求和的一种形式——每个 block 内是等权求和，block 之间是 softmax 加权。它优于 Sliding Window Attention（SWA）是因为压缩保留了所有历史层信息，只是粒度变粗；而 SWA 直接丢弃远距离层，破坏了残差连接的完整性。

***

## 8. 相关思想：大模型中"把固定权重动态化"的其他例子

AttnRes 的核心模式是：

> 把原本固定为 $1$ 的连接/累加/传递权重，改成由输入动态决定的权重。

这种模式在大模型领域非常常见，下面按不同维度给出最典型的例子，帮助理解 AttnRes 在更广泛的架构演进中的位置。

***

### 8.1 Self-Attention：序列维度上的同一个模式

**原本固定为** $1$ 的结构：RNN / 因果递推

$$
h_t = f(h_{t-1}, x_t)
$$

每个位置 $t$ 只能收到前一个位置 $t-1$ 的状态，传递权重固定为 $1$。

**动态化**：Transformer Self-Attention

$$
o_t = \sum_{s=1}^{n} \alpha_{ts} \, v_s
$$

每个位置 $t$ 动态决定看哪些历史位置，权重：

$$
\alpha_{ts} = \frac{\exp(q_t^\top k_s)}{\sum_{u} \exp(q_t^\top k_u)}
$$

**对应关系**：

| AttnRes                       | Self-Attention              |
| ----------------------------- | --------------------------- |
| 深度维度：第 $l$ 层看历史所有层            | 序列维度：第 $t$ 个 token 看所有位置    |
| 固定残差系数 $1$ → 动态 $\alpha_{li}$ | 固定递推 $1$ → 动态 $\alpha_{ts}$ |

这其实就是 AttnRes 论文的核心类比：既然 attention 在序列维度上成功替代了固定递推，那么它也可以在深度维度上替代固定残差累加。

***

### 8.2 Mixture of Experts（MoE）：把 FFN 的固定输出动态化

**原本固定为** $1$ 的结构：标准 FFN

所有 token 都走同一个 FFN，每个参数对所有输入都生效。

**动态化**：MoE

$$
y = \sum_{i=1}^{E} g_i(x) \cdot E_i(x)
$$

其中 $g_i(x) = \mathrm{softmax}(W_g x)$ 是路由 gate，根据输入 $x$ 决定激活哪些专家 $E_i$。

**共同点**：原来"所有专家/神经元都参与"，现在"根据输入动态选择一部分"。

典型工作：Switch Transformer、GLaM、Mixtral、DeepSeek-V3 / Moonlight。

***

### 8.3 GLU / SwiGLU：FFN 内部的动态门控

**原本固定为** $1$ 的结构：标准 FFN

$$
\mathrm{FFN}(x) = W_2 \cdot \sigma(W_1 x)
$$

**动态化**：GLU 变体

$$
\mathrm{GLU}(x) = (W_1 x) \cdot \sigma(W_2 x)
$$

或 SwiGLU：

$$
\mathrm{SwiGLU}(x) = \mathrm{Swish}(W_1 x) \odot (W_2 x)
$$

**共同点**：把 FFN 的线性变换输出，用输入依赖的门控 $\sigma(\cdot)$ 动态调制。每个神经元/通道的激活强度都随输入变化。

***

### 8.4 Hyper-Connections / xHC：多残差流的动态混合

这是和 AttnRes 最直接竞争的一路线。

**原本固定为** $1$ 的结构：单残差流

$$
x_{l+1} = x_l + h_l
$$

**动态化**：Hyper-Connections

把状态扩展到多个并行流：

$$
X_{l+1} = H_{l+1}^{res} X_l + H_{l+1}^{post} F_l(H_{l+1}^{pre} X_l)
$$

其中 $H$ 是学习的混合矩阵，实现多个残差流之间的动态线性组合。

早期的 mHC 用 sigmoid 和双随机性保证稳定性，并验证了大模型上的有效性。近期这一路线已进一步发展成为 **xHC（Expanded Hyper-Connections）**：在 mHC 的基础上引入时序特征增强（richer write-back）和稀疏残差流结构，把可扩展的并行流数 $N$ 从 mHC 的 $N=4$ 瓶颈进一步推开，成为当前 HC 系列的代表。

**与 AttnRes 的区别**：

* Hyper-Connections / xHC：多流状态，矩阵混合；
* AttnRes：单流，但跨层 attention 选择历史层。

***

### 8.5 RWKV：带通道衰减的线性递推

**原本固定为** $1$ 的结构：RNN / 因果线性 attention

RNN 把历史压缩到单个隐状态，每个时间步对前一状态的传递权重固定为 $1$：

$$
h_t = f(h_{t-1}, x_t)
$$

因果线性 attention 则对每个历史位置做等权或固定核加权：

$$
o_t = \sum_{s=1}^{t} \phi(t-s) \, v_s
$$

其中核函数 $\phi(\cdot)$ 不随输入变化。

**动态化**：RWKV 的 time-mixing

对每个通道学习一个衰减率 $w$ 和当前位置奖励 $u$，并把历史 key-value 乘积按指数衰减累加：

$$
\mathrm{wkv}_t = \sum_{s=1}^{t-1} e^{-(t-1-s) w} k_s v_s + e^{u} k_t v_t
$$

其中 $w = \exp(-\exp(\omega))$ 为逐通道可学习衰减率，$u$ 为逐通道可学习标量，$k_s, v_s$ 来自输入 $x_s$ 的投影。

然后引入输入依赖的 receptance gate：

$$
r_t = \sigma(W_r x_t)
$$

最终输出：

$$
o_t = r_t \odot \bigl(W_o \cdot \mathrm{wkv}_t\bigr)
$$

**关键点**：

* 衰减 $w$ 是**数据无关**的（只与通道有关），让历史信息以可学习但固定的半衰期消退；
* receptance $r_t$ 是**输入依赖**的，决定当前 token 在多大程度上使用聚合后的历史；
* 因此历史权重不再是固定 $1$，而是 $e^{-(t-1-s)w} \cdot r_t$，实现了序列维度上的动态残差/递推。

**与 Mamba 的对比**：Mamba 的状态转移矩阵 $\bar{A}(x_t)$ 和输入门 $\bar{B}(x_t)$ 都是输入依赖的，选择性更强；RWKV 的 decay 是数据无关的，选择能力较弱，但实现更简单、推理更快（类似线性 RNN）。

***

### 8.6 Mamba / Selective SSM：把状态转移动态化

**原本固定为** $1$ 的结构：线性状态空间模型

$$
h_t = A h_{t-1} + B x_t
$$

$A, B$ 是固定参数。

**动态化**：Mamba 的 Selective SSM

$$
h_t = \bar{A}(x_t) h_{t-1} + \bar{B}(x_t) x_t
$$

$A, B, \Delta$ 都变成输入 $x_t$ 的函数。

**共同点**：原来"固定参数控制信息如何传递"，现在"根据输入动态决定保留/遗忘多少"。

***

### 8.7 动态深度 / Early Exit：让层数本身动态

**原本固定为** $1$ 的结构：所有输入都过 $L$ 层。

**动态化**：不同输入过不同层数。

* **PABEE**：基于内部层输出一致性决定提前退出；
* **Dynamic Depth**：学习退出策略；
* **Mixture of Depths（Apple, 2024）**：不同 token 经过不同层数。

**共同点**：原来"每层权重都是 $1$（必须过）"，现在"某些 token 可以跳过某些层"。

***

### 8.8 总结表

| 固定结构       | 动态化方法                                   | 维度          |
| ---------- | --------------------------------------- | ----------- |
| 残差累加（深度）   | AttnRes、Hyper-Connections、xHC（mHC 为其前身） | 深度          |
| RNN 递推（序列） | Self-Attention                          | 序列          |
| 线性递推的固定衰减核 | RWKV                                    | 序列时间 / 线性递推 |
| FFN 固定输出   | MoE、GLU/SwiGLU                          | 特征/专家       |
| 线性状态转移     | Mamba / Selective SSM                   | 时间/序列       |
| 固定层数       | Early Exit / Dynamic Depth              | 深度          |
| 固定多流混合     | Hyper-Connections / SiameseNorm         | 多流          |

**AttnRes 的特殊位置**：它是在**深度维度**上，对**残差连接**本身做 attention 动态化。这与 Self-Attention 在序列维度上的做法高度对称，也是它被称为"把 attention 从序列维度搬到深度维度"的根本原因。

***

## 参考

* Attention Residuals, arXiv:2603.15031
* 苏剑林：《Attention Residuals 回忆录》, <https://kexue.fm/archives/11664>
* YyWangCS：《从推理架构的角度，谈谈 Attention Residual 架构一些背后的想法》, <https://qingkeai.online/archives/Attention%20Residual%20>
* He et al.：Deep Residual Learning for Image Recognition, CVPR 2016
* Vaswani et al.：Attention Is All You Need, NeurIPS 2017
* Shazeer et al.：Outrageously Large Neural Networks: The Sparsely-Gated Mixture-of-Experts Layer, ICLR 2017
* Srivastava et al.：Training Very Deep Networks, NeurIPS 2015 (Highway Networks)
* Huang et al.：Densely Connected Convolutional Networks, CVPR 2017 (DenseNet)
* Peng et al.：RWKV: Reinventing RNNs for the Transformer Era, arXiv:2305.13048, 2023
* Gu & Dao：Mamba: Linear-Time Sequence Modeling with Selective State Spaces, 2023
* Zhu et al.：xHC: Expanded Hyper-Connections, arXiv:2607.14530, 2026
