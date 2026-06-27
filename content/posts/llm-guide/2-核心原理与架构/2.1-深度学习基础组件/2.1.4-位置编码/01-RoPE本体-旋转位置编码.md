---
title: "01 RoPE本体：旋转位置编码"
date: 2026-05-24
tags: []
---

# 01 RoPE本体：旋转位置编码

RoPE 是位置编码路线里最关键的一步. 它真正的突破不是“用了旋转矩阵”，而是 **把绝对位置写成相位，让相对位置在点积里自动出现**. 如果要追它的中文源头，最值得直接读的是苏剑林的博客《[Transformer升级之路：2、博采众长的旋转式位置编码](https://kexue.fm/archives/8265)》; 对应的英文论文入口则是《[RoFormer: Enhanced Transformer with Rotary Position Embedding](https://arxiv.org/abs/2104.09864)》. 

> 苏老师真是太牛逼了. 此事在 kexue.com 内亦有记载. 

这篇只讲 RoPE 本身的数学定义、核心性质和为什么它会成为现代开源 LLM 的默认位置编码. RoPE 的外推、多模态 3D RoPE、MLA 与 RoPE 的兼容问题、工程成本和实现映射，放在扩展篇：[《02-RoPE扩展-长上下文、多模态与工程实现》](./02-RoPE扩展-长上下文、多模态与工程实现.md). 

## 1. 核心定义

[Su et al. (2021)](https://arxiv.org/abs/2104.09864) 将位置相关的 Query、Key 写成：

$$
\mathbf{q}_m = \mathbf{R}_{\Theta,m}\mathbf{W}_Q\mathbf{x}_m, \quad
\mathbf{k}_n = \mathbf{R}_{\Theta,n}\mathbf{W}_K\mathbf{x}_n \tag{1}
$$

这里 $\mathbf{x}_m, \mathbf{x}_n \in \mathbb{R}^{d_{model}}$ 是输入向量，$\mathbf{W}_Q, \mathbf{W}_K \in \mathbb{R}^{d_{model} \times d_{head}}$ 是投影矩阵，$\mathbf{R}_{\Theta,m}$ 和 $\mathbf{R}_{\Theta,n}$ 是与位置 $m,n$ 相关的块对角旋转矩阵. 

对每一对相邻维度，RoPE 使用一个二维旋转块：

$$
\mathbf{R}_{\Theta,m}^{(i)} =
\begin{pmatrix}
\cos(m\theta_i) & -\sin(m\theta_i) \\
\sin(m\theta_i) & \cos(m\theta_i)
\end{pmatrix} \tag{2}
$$

其中 $\theta_i$ 是第 $i$ 个二维子空间的基频，通常定义为：

$$
\theta_i = \text{base}^{-2i/d_{head}}, \quad i \in [0, d_{head}/2) \tag{3}
$$

这意味着每两维被视为一个二维平面，位置 $m$ 会让该平面中的向量旋转 $m\theta_i$. 高频维度旋转得快，负责短程差异; 低频维度旋转得慢，负责长程结构. 

> 配图建议：画一个二维平面里的单向量旋转示意图，左侧是原始向量，右侧是经过位置 $m$ 后旋转 $m\theta_i$ 的向量，并标出角度与坐标轴. 
> 图片描述：展示 RoPE 在单个二维子空间里的最小工作单元，让读者先看懂“每两维就是一次平面旋转”. 
> GPT-Image-2 Prompt：Create a technical educational figure showing the minimal 2D rotation unit of RoPE. Display a vector in a 2D plane before rotation and after rotation by angle m·theta_i, with x/y axes, arc annotation, and labels for original vector and rotated vector. White background, research-paper style, minimal academic palette, precise arrows, no decorative art.

> 图 1: RoPE 的最小计算单元不是整条向量，而是每两维构成的一个二维平面旋转. 

### 1.1 一个能直接算出来的二维旋转例子

如果只看一个二维子空间，RoPE 的行为其实非常具体. 假设某一对维度上的原始向量是：

$$
\mathbf{u}=
\begin{pmatrix}
1\\
0
\end{pmatrix}, \qquad \theta_i = \frac{\pi}{6}, \qquad m=2 \tag{4}
$$

这里向量 $\mathbf{u}$ 一开始沿着 $x$ 轴正方向，基频 $\theta_i$ 取 $\pi/6$，位置索引 $m=2$，所以实际旋转角度是 $m\theta_i = \pi/3$. 代入式 (2) 可得：

$$
\mathbf{R}_{\Theta,m}^{(i)}\mathbf{u}
=
\begin{pmatrix}
\cos(\pi/3) & -\sin(\pi/3)\\
\sin(\pi/3) & \cos(\pi/3)
\end{pmatrix}
\begin{pmatrix}
1\\
0
\end{pmatrix}
=
\begin{pmatrix}
1/2\\
\sqrt{3}/2
\end{pmatrix} \tag{5}
$$

这个例子说明，RoPE 并没有往向量里“额外加一个位置向量”，而是直接改变了原始表示的方向. 模长保持不变，但方向随着位置索引变化. 对模型来说，这就等于把“位于第几位”写进了向量的相位，而不是写成一张独立的位置表. 

## 2. 为什么它天然得到相对位置

RoPE 最值得记住的不是定义，而是结果. 把每两维视为一个复数：

$$
z_i = x_{2i} + i x_{2i+1} \tag{6}
$$

那么位置 $m$ 的旋转就等价于：

$$
z_i^{(m)} = z_i \cdot e^{im\theta_i} \tag{7}
$$

对 Key 取共轭后做内积，可以得到：

$$
\sum_{i=0}^{d_{head}/2-1} z_i^{(m)}\overline{z_i^{(n)}}
=
\sum_{i=0}^{d_{head}/2-1} z_i\overline{z_i} \cdot e^{i(m-n)\theta_i} \tag{8}
$$

式 (8) 的关键不在公式复杂，而在结构：绝对位置 $m$ 和 $n$ 没了，只剩相对距离 $m-n$. 也就是说，**RoPE 没有额外手写相对位置项，但相对位置信息已经自然嵌进了 Query-Key 点积. **

这正是它后来胜出的核心原因：

- 不需要像 Shaw 那样额外维护大块相对位置参数. 
- 不需要改写标准 attention 主体结构. 
- 相对关系在数学上是“自带”的，而不是靠补丁拼上去的. 

> 配图建议：画两组 Query/Key 向量在复平面上的旋转过程，标出绝对相位 $m\theta_i$、$n\theta_i$ 被抵消，只留下相对相位 $(m-n)\theta_i$. 
> 图片描述：展示为什么 RoPE 的点积最终只依赖相对距离，而不是两个绝对位置各自的坐标. 
> GPT-Image-2 Prompt：Create a technical educational figure explaining why RoPE produces relative position naturally. Show query and key vectors rotated by absolute phases m·theta_i and n·theta_i on the complex plane, then indicate that inner product depends only on relative phase difference (m-n)·theta_i. White background, academic diagram style, precise arrows, clean labels, no decorative art.

> 图 2: RoPE 的关键不是“旋转过了”，而是点积里绝对相位被抵消，只留下相对相位差. 

### 2.1 一个只剩相对距离的小例子

为了把式 (8) 看得更直观，假设某个二维子空间上的原始复数表示是 $z=1+i$，其模平方为 $z\overline{z}=2$. 再取 $\theta_i=\pi/4$，并让两个 token 的位置分别为 $m=5$、$n=3$. 那么旋转后的内积贡献就是：

$$
z^{(m)}\overline{z^{(n)}}
=
z\overline{z}\cdot e^{i(m-n)\theta_i}
=
2\cdot e^{i(5-3)\pi/4}
=
2\cdot e^{i\pi/2}
=
2i \tag{9}
$$

这里真正起作用的不是 $m=5$ 和 $n=3$ 这两个绝对位置本身，而是它们的差值 $m-n=2$. 如果把两个位置同时平移到 $m=105$、$n=103$，那么结果完全不变，因为相对距离还是 2. **这就是 RoPE 真正让人拍桌子的地方：它把“平移不变性”直接写进了结构里，而不是交给模型自己去猜. **

## 3. 一个更直白的实数视角

如果不用复数写法，只看实数内积，也能看到同样结论. 设未经旋转的投影为 $\mathbf{q}_m^{(0)}$ 和 $\mathbf{k}_n^{(0)}$，那么旋转后的内积可以整理成：

$$
\mathbf{q}_m^T \mathbf{k}_n
=
(\mathbf{q}_m^{(0)})^T \mathbf{R}_{\Theta,n-m}\mathbf{k}_n^{(0)} \tag{10}
$$

式 (10) 说明，旋转后的 Query-Key 打分只依赖相对距离 $n-m$，不再依赖绝对位置本身. 这一性质让 RoPE 非常适合语言、代码、检索这类“相对关系大于绝对坐标”的任务. 

> 配图建议：画一张左右对照图，左边是绝对位置编码把 token 绑定到编号，右边是 RoPE 把两个 token 的交互绑定到相对位移. 
> 图片描述：让读者一眼看出绝对位置和相对位置建模在结构上的差异. 
> GPT-Image-2 Prompt：Create a side-by-side technical educational figure comparing absolute positional encoding and RoPE. Left panel: tokens tied to absolute indices like 5 and 6. Right panel: token interaction tied to relative distance like delta=1 through rotation-based phase difference. White background, research-paper style, minimal academic palette, readable labels, no decorative art.

> 图 3: 绝对位置编码强调“你在第几位”，RoPE 强调“你和别人相隔多远”. 

## 4. 为什么现代开源模型几乎都选 RoPE

RoPE 后来成为事实标准，通常不是因为它在所有维度都最好，而是因为它同时满足了三件事：

1. **相对性强**：天然建模距离关系. 
2. **工程代价低**：可直接融合进 Q/K 投影后的实现. 
3. **生态惯性大**：Llama 系列、Qwen 系列、DeepSeek 系列都围绕它深度优化. 

从工程视角看，位置编码真正决定的是下面几件事：

- 模型是否能外推到训练长度之外. 
- 高频与低频位置模式如何取舍. 
- KV Cache 和推理内核如何组织. 
- 多模态输入中的一维、二维、时间坐标如何统一. 

**位置编码不是前处理细节，而是时序归纳偏置的入口. **

## 5. 参考文献

1. [Su, J., et al. (2021). RoFormer：带旋转位置嵌入的 Transformer(RoFormer: Enhanced Transformer with Rotary Position Embedding).](https://arxiv.org/abs/2104.09864) *arXiv*.
