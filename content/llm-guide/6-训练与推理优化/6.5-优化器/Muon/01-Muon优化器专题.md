---
title: "01 · Muon 优化器：Newton-Schulz 迭代、矩阵符号函数与分布式训练挑战"
date: 2026-05-16
tags: [Muon, 优化器, Newton-Schulz, Matrix Sign Function, 分布式训练, Shampoo]
---

# 01 · Muon 优化器：Newton-Schulz 迭代、矩阵符号函数与分布式训练挑战

## 1. 背景与核心痛点 (Background & Pain Points)

在大语言模型预训练与后训练的漫长历史中, 优化器(Optimizer)始终是那个沉默却决定性的角色. 它不像注意力机制那样光彩夺目地出现在每一篇架构论文的标题中, 也不像 KV Cache 优化那样直接影响终端用户的推理延迟感知, 但如果没有一个高效的优化器, 再精妙的模型设计也只能在损失函数的崎岖高地上徒劳地打转. 从 2014 年 Adam 的横空出世, 到 2019 年 AdamW 成为 Transformer 训练的事实标准, 再到 2023 年 Sophia 尝试引入轻量级二阶信息, 优化器领域的演进似乎遵循着一条清晰的脉络：**在“计算代价”与“更新质量”之间寻找更优的帕累托前沿**. 

然而, 当我们将目光投向 2024–2025 年的前沿训练实践时, 一个令人不安的事实逐渐浮出水面：AdamW 已经触及了它的能力边界. 

### 1.1 家谱定位：Adam/W 解决了什么, 又在哪里失效了

Adam(Adaptive Moment Estimation)的里程碑意义在于, 它首次将“动量惯性”与“自适应学习率”无缝地融合到了一个统一的更新框架中. 它维护一阶矩估计 $m_t$(梯度的指数移动平均)和二阶矩估计 $v_t$(梯度平方的指数移动平均), 使得每个参数都能获得“定制化的步长”. 对于稀疏梯度或曲率变化剧烈的参数维度, Adam 的自适应机制能够自动压低学习率, 防止震荡; 对于长期保持同一方向的参数维度, 动量机制则能够加速收敛. AdamW 在此基础上更进一步, 将权重衰减(Weight Decay)从梯度计算中解耦出来, 避免了 L2 正则化与自适应学习率之间的有害耦合. 

**但 Adam/W 有一个根深蒂固的假设：参数是一个扁平的向量. **

在 Adam 的更新规则中, 每一步的更新量是这样计算的：

$$
 \theta_{t+1}^{(i)} = \theta_t^{(i)} - \eta \cdot \frac{\hat{m}_t^{(i)}}{\sqrt{\hat{v}_t^{(i)}} + \epsilon} \tag{1}
$$

注意上标中的 $(i)$. 这意味着 Adam 对参数的每一个**标量元素**独立地计算更新方向和步长. 它完全忽略了这样一个事实：在神经网络中, 绝大多数可学习的参数并不是孤立的标量, 而是**具有明确几何结构的矩阵**——全连接层的权重矩阵 $\mathbf{W} \in \mathbb{R}^{d_{out} \times d_{in}}$、注意力投影矩阵 $\mathbf{W}_Q, \mathbf{W}_K, \mathbf{W}_V$、乃至 MLP 中的门控矩阵. 

当一个梯度矩阵 $\mathbf{G}_t \in \mathbb{R}^{m \times n}$ 被 Adam 处理时, 它会被展开(flatten)成一个长度为 $m \times n$ 的向量, 然后逐元素地除以各自对应的二阶矩平方根. 这种做法在数学上等同于假设参数空间的每个坐标轴都是**正交且独立**的. 然而, 矩阵参数的内在结构告诉我们：权重矩阵的行与行之间、列与列之间, 存在着强烈的统计耦合和几何关联. 将矩阵强行拍扁成向量, 无异于在分析一座大厦时只关注每一块砖的质地, 却完全忽视了承重柱与横梁之间的力学传导关系. 

### 1.2 二阶方法的理想与幻灭

既然一阶方法忽略了参数的结构信息, 那为什么不直接使用二阶方法呢？牛顿法的核心思想是利用 Hessian 矩阵 $\mathbf{H}$(损失函数对参数的二阶导数矩阵)来构造一个预条件器(Preconditioner), 使得更新方向 $-\mathbf{H}^{-1} \mathbf{g}$ 能够直接指向损失函数的局部极小值. 理论上, 二阶方法在凸优化问题中拥有令人垂涎的二次收敛速率. 

但理想很丰满, 现实很骨感. 对于一个参数量为 $d$ 的神经网络, Hessian 矩阵的维度是 $d \times d$. 以 Llama-3 8B 为例, $d \approx 8 \times 10^9$, 其 Hessian 矩阵将包含约 $6.4 \times 10^{19}$ 个元素. 即使只存储这个矩阵, 所需显存就高达约 **512 EB**(Exabytes), 这远远超出了任何现有或近期可预见的硬件能力. 

为了绕过这一死胡同, 研究者们提出了大量近似二阶方法. K-FAC(Kronecker-Factored Approximate Curvature)利用神经网络层结构的 Kronecker 积分解, 将 Hessian 近似为两个较小矩阵的 Kronecker 积, 将存储复杂度从 $O(d^2)$ 降低到 $O(d_{in}^2 + d_{out}^2)$. Shampoo 则进一步通过维护梯度矩阵的累积外积来近似预条件器. 它分别累积梯度在输出空间方向的协方差 $\mathbf{L}_t = \sum_{\tau=1}^t \mathbf{G}_\tau \mathbf{G}_\tau^T$ 和输入空间方向的协方差 $\mathbf{R}_t = \sum_{\tau=1}^t \mathbf{G}_\tau^T \mathbf{G}_\tau$, 然后用它们的 $-1/4$ 次幂对更新进行双向缩放, 使得在梯度变化剧烈的方向上步长更小、在梯度稳定的方向上步长更大. 其完整更新规则为：

$$
 \mathbf{W}_{t+1} = \mathbf{W}_t - \eta \cdot \mathbf{L}_t^{-1/4} \mathbf{G}_t \mathbf{R}_t^{-1/4} \tag{2}
$$
其中 $\mathbf{L}_t^{-1/4}$ 和 $\mathbf{R}_t^{-1/4}$ 分别扮演了输出空间和输入空间的自适应预条件器角色, 对梯度矩阵进行左、右双向缩放. 

Shampoo 和 K-FAC 在中小规模模型上展示了比 Adam 更快的收敛速度, 但它们在工程落地时面临两个致命障碍：

1. **显存爆炸**：即使采用了 Kronecker 分解, Shampoo 仍需要为每一层额外维护两个矩阵 $\mathbf{L}$ 和 $\mathbf{R}$, 并周期性计算它们的逆矩阵幂次 $^{-1/4}$. 对于大模型的宽层(如 8192 × 8192 的注意力投影), 这一开销极为可观. 

2. **计算不可行**：显式计算 $(\mathbf{G}\mathbf{G}^T)^{-1/4}$ 需要对该矩阵进行特征分解或 SVD, 其计算复杂度为 $O(d^3)$, 在现代 GPU 上难以高效并行. 

### 1.3 核心动机：为什么需要"谱感知"优化器

Adam 的问题在于它**没有结构感知**——把矩阵当向量处理. Shampoo 和 K-FAC 的问题在于它们**精确计算结构信息的代价太高**——显式矩阵幂运算不可行. 

Muon 优化的核心洞察正是卡在这个夹缝之中：**我们能否以接近一阶方法的计算代价, 获得接近二阶方法的更新质量？**

具体而言, Muon 提出了一个革命性的思路：
- 不再为每个参数元素维护独立的二阶统计量(像 Adam 那样); 
- 也不再显式计算和存储巨大的预条件矩阵(像 Shampoo 那样); 
- 而是直接对**梯度矩阵本身**进行谱归一化操作, 利用 Newton-Schulz 迭代高效地计算其"符号化"版本, 使得更新方向天然地尊重参数矩阵的奇异值结构. 

这种思路将优化器的关注点从"每个坐标轴的曲率"提升到了"整个矩阵的谱分布". 我们称这种特性为**谱感知(Spectrum-Aware)** . Muon 不是在一维的坐标轴上做文章, 而是在矩阵的奇异向量张成的空间中做几何修正. 它既避免了 Adam 的结构盲视, 又规避了 Shampoo 的显存噩梦. 

![AdamW vs Shampoo vs Muon 优化器地形搜索对比](images/optimizer_landscape_analogy.png)

> **图 6.17 AdamW、Shampoo 与 Muon 在极陡峡谷地形(非等同曲率空间)下的寻优路径对比**
> * **AdamW**：由于其一维标量自适应的假设, 它只能沿着正交坐标轴走之字形, 在狭长陡峭的峡谷两侧来回剧烈震荡, 下降效率较低. 
> * **Shampoo**：试图通过计算巨大的二阶协方差预条件器矩阵来精确定位地形的曲率, 但因其求逆与 SVD 开销过大, 如同身负重物, 步履维艰. 
> * **Muon**：轻装上阵, 利用 Newton-Schulz 迭代高效获取谱方向正交基, 能够准确感知地形的“主山脊走向”, 沿最优对角方向平滑、高效地直达谷底. 

## 2. 为什么重要 (Significance)

### 2.1 Kimi K2 训练中的实际采用

Muon 优化器之所以从学术圈的小众话题跃升为业界关注的焦点, 最直接的原因在于：**Moonshot AI(月之暗面)在 Kimi K2 的训练中明确采用了 Muon 作为其隐藏层(Hidden Layers)的优化器**. 

Kimi K2 是 2025 年发布的一款具有超长上下文能力(标准支持 256K tokens, 测试支持高达 200 万字符)的大语言模型. 在其后训练阶段的技术报告中, 研究团队披露了一个关键细节：为了在海量长文本上实现高效收敛, 他们没有简单套用 AdamW, 而是为**矩阵型参数**(Linear 层的权重矩阵)引入了 Muon 优化器, 仅对 bias、embedding 和 LayerNorm 参数保留传统的 AdamW. 

这一混合策略的背后逻辑非常清晰：Muon 在矩阵参数上提供了更本质的几何更新, 而 AdamW 在处理非矩阵型参数时仍然足够有效且工程成熟. Kimi K2 的实际训练数据表明, 在相同的计算预算下, Muon 相比纯 AdamW 能够更快地将训练损失推至更低水平, 这意味着在算力经济学层面, Muon 直接等价于**用更少的 GPU 小时获得同等或更好的模型质量**. 

### 2.2 "一阶计算代价, 二阶更新质量"新范式

Muon 最大的理论贡献在于它开辟了一个全新的优化器设计范式：**通过迭代近似而非显式计算, 获得二阶预条件的效果**. 

传统二阶方法的困境可以用一个公式概括：

$$
 \text{高质量更新} \quad \Leftrightarrow \quad \text{显式计算 } \mathbf{H}^{-1} \quad \Leftrightarrow \quad \text{不可接受的 } O(d^3) \text{ 代价} \tag{3}
$$

Muon 打破了这一等价链. 它用 Newton-Schulz 迭代——一种仅涉及矩阵乘法的迭代算法——来近似矩阵符号函数, 而矩阵乘法在现代 GPU/TPU 上具有极高的硬件效率(GEMM 是加速器上最成熟的算子之一). Muons 的每步额外计算开销远小于 Shampoo 的显式 SVD, 却能提供同样甚至更优的谱归一化效果. 

这种"一阶计算代价, 二阶更新质量"的折中方案, 在 2025–2026 年大模型训练成本持续攀升的背景下, 具有不可忽视的战略意义. 当训练一个千亿参数模型的成本动辄数千万美元时, 任何能将收敛步数减少 10%–30% 的优化器改进, 都意味着数百万美元的直接节省. 

### 2.3 2025–2026 年优化器研究热点

Muon 的出现并非孤立事件. 它是整个优化器研究社区向"结构化更新"转向的标志性成果. 在同一时期, 我们见证了：
- **Sophia**：利用 Hessian 对角线的轻量估计来裁剪更新; 

- **SOAP**：将 Shampoo 与 Adam 的思想结合, 用高效的矩阵幂迭代替代 SVD; 

- **Adam-mini**：对 Adam 的二阶矩进行分组压缩, 降低显存占用; 

- **Muon**：直接对梯度矩阵进行谱归一化, 用 Newton-Schulz 迭代替代显式分解. 

这些算法的共同主线是：**优化器的设计正在从标量层面的自适应, 跃迁到矩阵/张量层面的结构感知**. 在这一浪潮中, Muon 因其数学上的优雅性(Newton-Schulz 迭代的经典数值分析背景)和工程上的可实现性(纯矩阵乘法, 无 SVD)而占据了独特的生态位. 

## 3. 直觉类比 (Intuition)

理解 Muon 的最佳方式, 是将它与 AdamW 在几何直观的层面上进行严格对比. 

### 3.1 AdamW = 每个坐标轴独立决定步长

想象你在一个复杂的高维山谷中寻找最低点. AdamW 给你配备了一个非常精密的导航系统, 但这个系统有一个根本缺陷：**它只能读取你当前位置在 x 轴、y 轴、z 轴等各个正交方向上的坡度**. 它不知道山谷本身是弯曲的, 也不知道坡度最大的方向可能并不沿着任何一条坐标轴, 而是某个斜向的对角线方向. 

更具体地说, AdamW 的逐元素更新等价于：

$$
 \Delta \theta^{(i)} = -\eta \cdot \frac{g^{(i)}}{\sqrt{v^{(i)}} + \epsilon} \tag{4}
$$
这意味着参数向量的第 $i$ 个分量只受第 $i$ 个梯度分量的影响. 两个参数 $\theta^{(i)}$ 和 $\theta^{(j)}$ 之间的任何统计相关性、任何结构性耦合, 都被完全忽略. 如果你的参数恰好是一个矩阵的行向量和列向量, 这种忽略是灾难性的——因为矩阵乘法的本质就是将行与列耦合在一起产生输出. 

### 3.2 Muon = 利用地形主方向(矩阵谱结构)选更高效方向

Muon 的思路完全不同. 它说："既然你的参数是一个矩阵, 那我就把它当作矩阵来处理. "

想象同样在那个山谷中, Muon 配备的不是一个只能读取坐标轴坡度的罗盘, 而是一个能够感知**地形主轴**的惯性导航系统. 它通过分析梯度矩阵的奇异值分解(SVD), 识别出哪些方向是"主要变化方向"(对应大奇异值), 哪些方向是"次要噪声方向"(对应小奇异值). 然后, 它对更新进行重新加权, 使得各个谱方向上的步长更加均衡. 

在矩阵的 SVD 视角下, $\mathbf{G} = \mathbf{U} \mathbf{\Sigma} \mathbf{V}^T$. $\mathbf{U}$ 的列向量张成了输出空间的"主要响应方向", $\mathbf{V}$ 的列向量张成了输入空间的"主要敏感方向". AdamW 对 $\mathbf{G}$ 的每个元素独立缩放, 相当于对 $\mathbf{U}$、$\mathbf{\Sigma}$、$\mathbf{V}^T$ 中的信息做了同等的、但盲目的处理. Muon 则通过保留 $\mathbf{U}$ 和 $\mathbf{V}$ 而"归一化" $\mathbf{\Sigma}$, 确保更新方向严格沿着这些主方向前进, 而不会被某些坐标轴上偶然的梯度幅度波动所误导. 

### 3.3 橡皮筋拉伸 = Newton-Schulz 将扭曲更新矩阵正交化

Newton-Schulz 迭代在 Muon 中的角色, 可以用一个生动的物理类比来理解. 

想象梯度矩阵 $\mathbf{G}$ 是一块被随意揉捏过的橡皮泥. 它的形状(即奇异值分布)是不规则的——某些方向被拉得很长, 某些方向被压得很扁. 如果你直接用这块扭曲的橡皮泥去推动参数更新, 那么长方向上的推力会过大(步长过大, 可能震荡), 扁方向上的推力会过小(步长过小, 收敛缓慢). 

Newton-Schulz 迭代就像一个神奇的"正交化模具". 你把扭曲的橡皮泥放进去, 经过几次(通常是 5–10 次)反复按压, 它出来的形状会变得**各向同性**——所有方向上的"刚度"趋于一致. 数学上, Newton-Schulz 迭代将 $\mathbf{G}$ 的奇异值逐渐推向 1, 同时保持其左右奇异向量不变. 最终输出的矩阵 $\tilde{\mathbf{G}}$ 满足 $\tilde{\mathbf{G}}^T \tilde{\mathbf{G}} \approx \mathbf{I}$, 即它是一个近似正交矩阵. 

这个"正交化"操作的核心物理意义在于：**它消除了梯度矩阵中由于数据分布、网络结构或初始化带来的各向异性缩放, 使得更新在各个谱方向上都获得公平的步长**. 这就像在崎岖地形上铺设了一条标准化的轨道, 无论原始地形如何起伏, 列车(参数更新)都能以稳定的速度前进. 

![Newton-Schulz 矩阵正交化拉平奇异值过程](images/newton_schulz_orthogonalization.png)

> **图 6.18 Newton-Schulz 迭代“正交化模具”物理校正过程**
> * **变形椭圆(左)**：原始梯度矩阵的奇异值分布极度各向异性, 长轴代表极易发生震荡的谱方向, 扁轴代表收敛缓慢的谱方向. 
> * **迭代过渡(中)**：在迭代公式 $X_{k+1} = 0.5 X_k (3I - X_k^T X_k)$ 作用下, 自校正项 $(3I - X_k^T X_k)$ 对大于 1 的奇异值产生向下压缩拉回的力, 对小于 1 的奇异值产生向上推高的力. 
> * **均匀圆(右)**：迭代收敛后, 所有谱方向奇异值都被统一拉平为 1, 形状各向同性, 保证了在所有矩阵子空间更新步长的一致性. 

## 4. 数学推导与公式对比 (Mathematical Rigor)

Muon 的数学之美在于它扎根于经典数值分析中的矩阵函数理论. 为了真正理解 Muon, 我们必须从最基础的矩阵符号函数出发, 逐步推导出 Newton-Schulz 迭代, 并最终将其嵌入到优化器的更新规则中. 这一推导过程是本文的灵魂所在, 要求读者具备基本的线性代数知识, 但我们会尽可能详细地解释每一步的物理含义. 

### 4.1 矩阵符号函数(Matrix Sign Function)

#### 4.1.1 标量符号函数的矩阵推广

我们从最熟悉的标量符号函数开始：

$$
 \text{sign}(x) = \begin{cases} +1 & \text{if } x > 0 \\ -1 & \text{if } x < 0 \\ 0 & \text{if } x = 0 \end{cases} \tag{5}
$$

这个函数提取了一个实数的"方向"信息, 丢弃了其"大小"信息. 在优化中, 如果我们只关心"朝哪个方向走"而不关心"梯度有多大", 那么 sign 函数是一个自然的选择——Lion 优化器正是基于这一直觉设计的. 

现在, 我们想把符号函数推广到矩阵. 给定一个实方阵 $\mathbf{A} \in \mathbb{R}^{n \times n}$, 我们希望构造一种运算, 使其保留 $\mathbf{A}$ 的特征向量结构, 但将所有特征值的幅值统一映射到 1(保持其正负号不变). 满足这一要求的正是**矩阵符号函数**(Matrix Sign Function), 其经典定义为：

$$
 \text{sign}(\mathbf{A}) = \mathbf{A} (\mathbf{A}^2)^{-1/2} \tag{6}
$$
为了验证这一定义确实将每个特征值映射为其符号, 假设 $\mathbf{A}$ 是可对角化的, 即 $\mathbf{A} = \mathbf{P} \mathbf{D} \mathbf{P}^{-1}$, 其中 $\mathbf{D} = \text{diag}(\lambda_1, \lambda_2, \dots, \lambda_n)$ 包含 $\mathbf{A}$ 的特征值. 那么：

$$
 \mathbf{A}^2 = \mathbf{P} \mathbf{D}^2 \mathbf{P}^{-1} \tag{7}
$$
$$
 (\mathbf{A}^2)^{-1/2} = \mathbf{P} \mathbf{D}^{-1} \mathbf{P}^{-1} \tag{8}
$$
$$
 \text{sign}(\mathbf{A}) = \mathbf{P} \mathbf{D} \mathbf{P}^{-1} \cdot \mathbf{P} \mathbf{D}^{-1} \mathbf{P}^{-1} = \mathbf{P} \cdot \text{sign}(\mathbf{D}) \cdot \mathbf{P}^{-1} \tag{9}
$$

其中 $\text{sign}(\mathbf{D}) = \text{diag}(\text{sign}(\lambda_1), \dots, \text{sign}(\lambda_n))$. 

**物理含义**：矩阵符号函数提取了原矩阵所有特征值的"符号", 并以相同的特征向量基重新组装成一个新的矩阵. 如果原矩阵的特征值全为正, 则 $\text{sign}(\mathbf{A}) = \mathbf{I}$(单位矩阵); 如果全为负, 则 $\text{sign}(\mathbf{A}) = -\mathbf{I}$. 

#### 4.1.2 SVD 视角下的矩阵符号函数

在优化器中, 我们处理的梯度矩阵 $\mathbf{G}$ 通常不是方阵, 而是矩形矩阵 $\mathbf{G} \in \mathbb{R}^{m \times n}$. 对于矩形矩阵, 我们需要借助**奇异值分解(SVD)** 来推广符号函数的概念. 

任意实矩阵 $\mathbf{G}$ 的(精简)SVD 将其分解为三个因子的乘积：

$$
 \mathbf{G} = \mathbf{U} \mathbf{\Sigma} \mathbf{V}^T \tag{10}
$$
这里 $\mathbf{U} \in \mathbb{R}^{m \times r}$ 和 $\mathbf{V} \in \mathbb{R}^{n \times r}$ 均为正交矩阵(满足 $\mathbf{U}^T \mathbf{U} = \mathbf{I}_r$ 和 $\mathbf{V}^T \mathbf{V} = \mathbf{I}_r$), 它们的列向量分别称为左、右奇异向量, 前者张成 $\mathbf{G}$ 的列空间(输出空间中的主要响应方向), 后者张成 $\mathbf{G}$ 的行空间(输入空间中的主要敏感方向). 中间的对角矩阵 $\mathbf{\Sigma} \in \mathbb{R}^{r \times r}$ 包含按降序排列的奇异值 $\sigma_1 \geq \sigma_2 \geq \dots \geq \sigma_r > 0$, 每个奇异值量化了对应谱方向上梯度矩阵的"强度", 而 $r = \text{rank}(\mathbf{G})$ 则是矩阵的有效秩. 这一分解的物理意义在于：它将梯度矩阵的作用拆解为"输入旋转—各向异性缩放—输出旋转"三个连续的几何操作, 为后续的谱归一化提供了明确的干预目标. 

Muon 优化器中使用的矩阵符号函数(有时也记作 $\text{msign}(\mathbf{G})$)定义为：

$$
 \text{msign}(\mathbf{G}) = \mathbf{U} \cdot \text{sign}(\mathbf{\Sigma}) \cdot \mathbf{V}^T \tag{11}
$$

其中 $\text{sign}(\mathbf{\Sigma}) = \text{diag}(\text{sign}(\sigma_1), \dots, \text{sign}(\sigma_r))$. 由于奇异值总是非负的($\sigma_i \geq 0$), 对于满秩矩阵(所有 $\sigma_i > 0$), 有 $\text{sign}(\mathbf{\Sigma}) = \mathbf{I}_r$. 因此：

$$
 \text{msign}(\mathbf{G}) = \mathbf{U} \mathbf{V}^T \tag{12}
$$
**这是 Muon 更新规则的核心表达式. **

#### 4.1.3 为什么矩阵符号函数给出谱归一化更新方向

让我们停下来仔细品味 $\mathbf{U} \mathbf{V}^T$ 的几何意义. 

原始梯度 $\mathbf{G} = \mathbf{U} \mathbf{\Sigma} \mathbf{V}^T$ 可以看作这样一个线性变换：先将输入向量投影到由 $\mathbf{V}$ 张成的坐标系上($\mathbf{V}^T$), 然后沿各个坐标轴以奇异值为比例进行缩放($\mathbf{\Sigma}$), 最后再将结果映射到由 $\mathbf{U}$ 张成的输出坐标系中($\mathbf{U}$). 

而 $\mathbf{U} \mathbf{V}^T$ 则去掉了中间的缩放步骤 $\mathbf{\Sigma}$. 它保留了：
- **输入空间的方向结构**：哪些输入方向对输出影响最大(由 $\mathbf{V}$ 决定); 

- **输出空间的方向结构**：哪些输出方向最容易被改变(由 $\mathbf{U}$ 决定); 

但它丢弃了：
- **各个谱方向上的幅度差异**：无论原始奇异值是 $100$ 还是 $0.01$, 在 $\mathbf{U} \mathbf{V}^T$ 中都被统一为 $1$. 

这种"统一化"在优化中的好处是什么？

假设损失函数的 Hessian 在某个谱方向上曲率很大(损失函数沿该方向变化很陡峭), 而在另一个谱方向上曲率很小(损失函数沿该方向变化很平缓). 如果梯度在"陡峭方向"上天然就很大(因为该方向的参数对损失更敏感), AdamW 的逐元素处理无法识别这是"同一个谱方向上的系统性大梯度". 它只会机械地压低该方向上的步长. Muon 则通过将奇异值统一为 1, 再配合一个全局学习率 $\eta$, 实现了**谱层面的自适应**：所有谱方向获得同等的更新"优先级", 然后由全局学习率统一控制步长大小. 

更深刻地, $\mathbf{U} \mathbf{V}^T$ 是**正交 Procrustes 问题**的解. 给定矩阵 $\mathbf{G}$, 在所有正交矩阵(或更一般地, 所有满足 $\mathbf{Q}^T \mathbf{Q} = \mathbf{I}$ 的矩阵)中, $\mathbf{U}\mathbf{V}^T$ 是在 Frobenius 范数意义下最接近 $\mathbf{G}$ 的那个. 换言之, Muon 的更新方向是原始梯度矩阵的"最近正交投影". 

### 4.2 Newton-Schulz 迭代(核心推导！)

直接通过 SVD 计算 $\mathbf{U}\mathbf{V}^T$ 的代价是 $O(\min(m^2 n, m n^2))$, 对于大矩阵而言这是不可接受的. Muon 的破局之道在于使用**Newton-Schulz 迭代**——一种仅依赖矩阵乘法即可快速收敛到 $\mathbf{U}\mathbf{V}^T$ 的迭代算法. 

#### 4.2.1 经典 Newton 迭代求矩阵符号函数

为了理解 Newton-Schulz 迭代, 我们先回顾求矩阵符号函数的经典 Newton 迭代. 

矩阵符号函数满足一个关键性质：$\text{sign}(\mathbf{A})^2 = \mathbf{I}$. 也就是说, 符号函数的不动点集合是所有满足 $\mathbf{X}^2 = \mathbf{I}$ 的矩阵. 对于可逆对称矩阵, 这些不动点恰好是 $\mathbf{X} = \pm \mathbf{I}$. 

将方程 $\mathbf{X}^2 = \mathbf{I}$ 改写为 $\mathbf{X} - \mathbf{X}^{-1} = \mathbf{0}$, 我们可以用 Newton-Raphson 方法求解. 设 $f(\mathbf{X}) = \mathbf{X}^2 - \mathbf{I}$, 则 $f'(\mathbf{X})[\Delta] = \mathbf{X}\Delta + \Delta\mathbf{X}$. Newton 步为：

$$
 \mathbf{X}_{k+1} = \frac{1}{2} \left( \mathbf{X}_k + \mathbf{X}_k^{-1} \right) \tag{13}
$$

这是求矩阵符号函数的**经典 Newton 迭代**. 它具有良好的收敛性(在适当的初值下二次收敛), 但每一步都需要计算矩阵逆 $\mathbf{X}_k^{-1}$, 计算代价为 $O(d^3)$, 且数值稳定性在 $\mathbf{X}_k$ 接近奇异时会出现问题. 

#### 4.2.2 Newton-Schulz 迭代的构造(避免求逆)

Newton-Schulz 迭代是上述经典 Newton 迭代的一个巧妙变体, 它**完全避免了矩阵求逆**, 将每步的计算简化到仅涉及矩阵乘法. 

其核心思想来源于对经典 Newton 迭代的重新整理. 为了构造一个无需矩阵求逆的变体, 我们从经典 Newton 迭代出发, 重新整理其形式：

$$
 \mathbf{X}_{k+1} = \frac{1}{2} \left( \mathbf{X}_k + \mathbf{X}_k^{-1} \right) \tag{14}
$$

两边同时右乘 $\mathbf{X}_k$ 以消除逆矩阵：

$$
 \mathbf{X}_{k+1} \mathbf{X}_k = \frac{1}{2} \left( \mathbf{X}_k^2 + \mathbf{I} \right) \tag{15}
$$

这个形式仍然需要 $\mathbf{X}_k^{-1}$ 的间接信息. Newton-Schulz 采用了另一条路径：它直接构造一个仅通过矩阵乘法就能逼近 $\text{sign}(\mathbf{X}_0)$ 的迭代格式. 

对于矩形梯度矩阵 $\mathbf{G}$, 我们需要一种完全不依赖求逆或矩阵分解的迭代格式, 以便在 GPU 上通过高度优化的 GEMM 算子高效执行. Newton-Schulz 迭代恰好满足这一要求, 其标准形式为：

$$
 \mathbf{X}_{k+1} = \frac{1}{2} \mathbf{X}_k \left( 3\mathbf{I} - \mathbf{X}_k^T \mathbf{X}_k \right) \tag{16}
$$
注意到这个迭代仅涉及矩阵乘法：$\mathbf{X}_k^T \mathbf{X}_k$ 产生一个规模较小的方阵, 再与 $\mathbf{X}_k$ 相乘即可得到下一步迭代, 全程无需任何显式的矩阵求逆或分解操作. 

#### 4.2.3 完整推导：从不动点构造到收敛性证明

让我们严谨地推导为什么 Newton-Schulz 迭代能够收敛到 $\mathbf{U}\mathbf{V}^T$. 

**第一步：初始化与谱保持性**

假设梯度矩阵 $\mathbf{G}$ 的 SVD 为 $\mathbf{G} = \mathbf{U} \mathbf{\Sigma} \mathbf{V}^T$. Muon 的初始化步骤是对 $\mathbf{G}$ 进行归一化：

$$
 \mathbf{X}_0 = \frac{\mathbf{G}}{\|\mathbf{G}\|_2} = \mathbf{U} \frac{\mathbf{\Sigma}}{\sigma_{max}} \mathbf{V}^T = \mathbf{U} \mathbf{\Sigma}_0 \mathbf{V}^T \tag{17}
$$

其中 $\sigma_{max}$ 是 $\mathbf{G}$ 的最大奇异值, $\|\mathbf{G}\|_2 = \sigma_{max}$ 是谱范数. 归一化后的初始矩阵 $\mathbf{X}_0$ 的最大奇异值为 1, 即 $\|\mathbf{X}_0\|_2 = 1$. 

这里 $\mathbf{\Sigma}_0 = \text{diag}(\sigma_1/\sigma_{max}, \dots, \sigma_r/\sigma_{max})$, 所有对角元素都在 $(0, 1]$ 区间内. 

**第二步：证明迭代保持 SVD 结构**

这是推导中最关键的一步. 我们要证明：如果 $\mathbf{X}_k$ 可以写成 $\mathbf{X}_k = \mathbf{U} \mathbf{\Sigma}_k \mathbf{V}^T$(与原始梯度共享相同的左、右奇异向量), 那么 $\mathbf{X}_{k+1}$ 也具有同样的形式. 

首先计算当前迭代矩阵的 Gram 矩阵：

$$
 \mathbf{X}_k^T \mathbf{X}_k = (\mathbf{U} \mathbf{\Sigma}_k \mathbf{V}^T)^T (\mathbf{U} \mathbf{\Sigma}_k \mathbf{V}^T) = \mathbf{V} \mathbf{\Sigma}_k \mathbf{U}^T \mathbf{U} \mathbf{\Sigma}_k \mathbf{V}^T = \mathbf{V} \mathbf{\Sigma}_k^2 \mathbf{V}^T \tag{18}
$$
其中用到了 $\mathbf{U}^T \mathbf{U} = \mathbf{I}_r$($\mathbf{U}$ 的正交性). 代入 Newton-Schulz 迭代公式：

$$
 \mathbf{X}_{k+1} = \frac{1}{2} \mathbf{X}_k \left( 3\mathbf{I} - \mathbf{X}_k^T \mathbf{X}_k \right) \tag{19}
$$
$$
 = \frac{1}{2} (\mathbf{U} \mathbf{\Sigma}_k \mathbf{V}^T) \left( 3\mathbf{I} - \mathbf{V} \mathbf{\Sigma}_k^2 \mathbf{V}^T \right) \tag{20}
$$

将括号展开. 注意 $\mathbf{V}^T \mathbf{V} = \mathbf{I}_r$, 所以 $(\mathbf{U} \mathbf{\Sigma}_k \mathbf{V}^T) \cdot \mathbf{V} \mathbf{\Sigma}_k^2 \mathbf{V}^T = \mathbf{U} \mathbf{\Sigma}_k \mathbf{\Sigma}_k^2 \mathbf{V}^T = \mathbf{U} \mathbf{\Sigma}_k^3 \mathbf{V}^T$. 因此：
$$
 \mathbf{X}_{k+1} = \frac{1}{2} \left( 3\mathbf{U} \mathbf{\Sigma}_k \mathbf{V}^T - \mathbf{U} \mathbf{\Sigma}_k^3 \mathbf{V}^T \right) = \mathbf{U} \left( \frac{3\mathbf{\Sigma}_k - \mathbf{\Sigma}_k^3}{2} \right) \mathbf{V}^T \tag{21}
$$
$$
 = \mathbf{U} \mathbf{\Sigma}_{k+1} \mathbf{V}^T \tag{22}
$$

其中奇异值的更新规则为：
$$
 \mathbf{\Sigma}_{k+1} = \frac{3\mathbf{\Sigma}_k - \mathbf{\Sigma}_k^3}{2} \tag{23}
$$
**结论得证**：Newton-Schulz 迭代保持左右奇异向量不变, 仅对奇异值进行标量迭代. 整个矩阵层面的迭代被完美解耦为 $r$ 个独立的标量迭代. 

**第三步：标量层面的不动点分析**

现在问题简化为分析标量迭代：

$$
 s_{k+1} = f(s_k) = \frac{3s_k - s_k^3}{2} = \frac{s_k(3 - s_k^2)}{2} \tag{24}
$$
其中 $s_k \in (0, 1]$(由初始化保证). 求不动点：

$$
 s = \frac{3s - s^3}{2} \tag{25}
$$
$$
 2s = 3s - s^3 \tag{26}
$$
$$
 s^3 - s = 0 \tag{27}
$$
$$
 s(s^2 - 1) = 0 \tag{28}
$$
不动点为 $s \in \{-1, 0, 1\}$. 由于我们的初始值 $s_0 \in (0, 1]$, 且可以验证 $f$ 将 $(0, 1]$ 映射到 $(0, 1]$(因为当 $s \in (0, 1]$ 时, $3 - s^2 \in [2, 3)$, 所以 $s_{k+1} = s_k(3-s_k^2)/2 \in (0, 3s_k/2]$, 又因为 $f(1) = 1$ 且 $f$ 在 $(0, 1)$ 上单调递增, 故 $s_{k+1} < 1$ 当 $s_k < 1$), 因此迭代将单调收敛到 $s^* = 1$. 

**第四步：收敛速率——二次收敛的证明**

这是 Newton-Schulz 迭代最迷人的性质. 我们来严格证明它在不动点附近的二次收敛性. 

设 $s_k = 1 - \epsilon_k$, 其中 $\epsilon_k$ 是小量(表示与目标值 1 的误差). 代入迭代公式：

$$
 s_{k+1} = \frac{3(1 - \epsilon_k) - (1 - \epsilon_k)^3}{2} \tag{29}
$$

将立方项展开并逐项化简：
$$
 s_{k+1} = \frac{3 - 3\epsilon_k - (1 - 3\epsilon_k + 3\epsilon_k^2 - \epsilon_k^3)}{2} \tag{30}
$$
$$
 = \frac{3 - 3\epsilon_k - 1 + 3\epsilon_k - 3\epsilon_k^2 + \epsilon_k^3}{2} \tag{31}
$$
$$
 = \frac{2 - 3\epsilon_k^2 + \epsilon_k^3}{2} = 1 - \frac{3}{2}\epsilon_k^2 + \frac{1}{2}\epsilon_k^3 \tag{32}
$$
为了分析收敛速度, 我们将误差定义为 $\epsilon_{k+1} = 1 - s_{k+1}$, 代入式 (15) 得到误差递推关系：

$$
 \epsilon_{k+1} = 1 - s_{k+1} = \frac{3}{2}\epsilon_k^2 - \frac{1}{2}\epsilon_k^3 \tag{33}
$$
当 $\epsilon_k \to 0$ 时, 主导项是 $\frac{3}{2}\epsilon_k^2$. 这意味着：

$$
 \epsilon_{k+1} = O(\epsilon_k^2) \tag{34}
$$

**这就是二次收敛(Quadratic Convergence)** . 每一步有效数字的位数大约翻倍. 如果初始误差是 $10^{-1}$, 那么第一步后约为 $10^{-2}$, 第二步后约为 $10^{-4}$, 第三步后约为 $10^{-8}$, 第四步后约为 $10^{-16}$(达到机器精度). 

这种收敛速度解释了为什么 Muon 在实际训练中只需要 **5–10 次 Newton-Schulz 迭代**即可获得足够精确的近似. 

#### 4.2.4 高亮物理意义：$3\mathbf{I} - \mathbf{X}_k^T \mathbf{X}_k$ 是自校正项

现在让我们深入理解 Newton-Schulz 迭代中那个神秘的因子 $3\mathbf{I} - \mathbf{X}_k^T \mathbf{X}_k$ 的物理意义. 

在每一步迭代中, $\mathbf{X}_k^T \mathbf{X}_k$ 度量了当前矩阵 $\mathbf{X}_k$ 偏离正交性的程度：若 $\mathbf{X}_k$ 的奇异值为 $s_k^{(i)}$, 则 $\mathbf{X}_k^T \mathbf{X}_k$ 的特征值恰好是 $(s_k^{(i)})^2$. 因子 $3\mathbf{I} - \mathbf{X}_k^T \mathbf{X}_k$ 因此构成一个精密的自校正系统——当某个奇异值 $s_k^{(i)} > 1$ 时, $(s_k^{(i)})^2 > 1$ 使得该方向的系数 $3 - (s_k^{(i)})^2 < 2$, 整体乘以 $\frac{1}{2}$ 后更新系数小于 1, 起到**拉回(Dampening)** 作用, 将过大的奇异值向下压缩; 反之, 当 $s_k^{(i)} < 1$ 时, $(s_k^{(i)})^2 < 1$ 使得系数 $3 - (s_k^{(i)})^2 > 2$, 乘以 $\frac{1}{2}$ 后仍大于 1, 起到**推高(Amplification)** 作用, 将过小的奇异值向上提升; 而当奇异值恰好为 1 时, 因子等于 $3 - 1 = 2$, 乘以 $\frac{1}{2}$ 后恒为 1, 该方向保持平衡不变. 这种"过大则拉、过小则推、恰好不变"的自校正机制, 使得 Newton-Schulz 迭代像一个精密的弹簧-阻尼系统, 将所有谱方向上的奇异值稳健地驱动到目标值 1. 每一步的修正力度与当前偏差的平方成正比(二次收敛的根源), 这意味着越接近目标, 系统越"敏感", 修正越精细. 

![Newton-Schulz 迭代动力学](images/muon_convergence.png)

> **图 6.5.1 Newton-Schulz 迭代动力学：趋向正交的吸引子**
> 将矩阵谱密度的迭代过程抽象为标量函数 $f(x) = x(3-x^2)/2$ 后, 可以看出 $x=1$ 是一个稳定吸引子. 这好比一个处于平衡态的弹簧：奇异值偏大(被拉伸)时迭代公式将其压回, 偏小(被压缩)时将其推高, 从而最终收敛到完美的正交状态. 

### 4.3 Muon 更新规则

#### 4.3.1 单层权重矩阵的更新流程

现在我们将 Newton-Schulz 迭代嵌入到标准的优化器框架中, 得到 Muon 的完整更新规则. 

考虑神经网络中的某一层, 其权重矩阵为 $\mathbf{W} \in \mathbb{R}^{m \times n}$. 在训练步骤 $t$：

**步骤 1：梯度计算**
通过反向传播得到该层权重在当前 mini-batch 上的梯度：
$$
 \mathbf{G}_t = \frac{\partial \mathcal{L}}{\partial \mathbf{W}_t} \tag{35}
$$

这里 $\mathbf{G}_t \in \mathbb{R}^{m \times n}$ 是损失函数对该层权重矩阵的完整梯度, 保留了矩阵行与列之间的结构化几何信息, 为后续的谱归一化提供原始输入. 

**步骤 2：动量累积**
与 Adam 和 SGD with Momentum 类似, Muon 也维护一个动量矩阵(一阶矩)来平滑梯度：
$$
 \mathbf{M}_t = \beta \mathbf{M}_{t-1} + (1 - \beta) \mathbf{G}_t \tag{36}
$$
其中 $\beta \in [0, 1)$ 是动量衰减系数, 典型值取 $0.9$ 或 $0.95$. 

**步骤 3：Newton-Schulz 正交化**
对动量矩阵进行谱归一化. 首先归一化：
$$
 \mathbf{X}_0 = \frac{\mathbf{M}_t}{\|\mathbf{M}_t\|_2} \tag{37}
$$

该归一化将动量矩阵的最大奇异值缩放到 1, 确保 Newton-Schulz 迭代的初始点落在收敛域 $(0, 1]$ 内, 是迭代稳定性的关键前提. 

然后执行 $K$ 步 Newton-Schulz 迭代(通常 $K = 5$ 到 $10$)：
$$
 \mathbf{X}_{k+1} = \frac{1}{2} \mathbf{X}_k (3\mathbf{I} - \mathbf{X}_k^T \mathbf{X}_k) \tag{38}
$$
迭代结束后得到谱归一化梯度：
$$
 \tilde{\mathbf{G}}_t = \mathbf{X}_K \tag{39}
$$

该输出 $\tilde{\mathbf{G}}_t$ 是动量矩阵经谱归一化后的近似正交版本, 其奇异值被压缩至接近 1, 从而消除梯度各向异性, 使参数更新在各个谱方向上获得均衡的步长. 

**步骤 4：参数更新**
最后执行参数更新(包含解耦的权重衰减)：
$$
 \mathbf{W}_{t+1} = \mathbf{W}_t - \eta_t \tilde{\mathbf{G}}_t - \eta_t \lambda \mathbf{W}_t \tag{40}
$$

将权重衰减项合并到参数自身, 可以得到一个更紧凑的等价形式, 这在实现时更为高效：

$$
 \mathbf{W}_{t+1} = (1 - \eta_t \lambda) \mathbf{W}_t - \eta_t \tilde{\mathbf{G}}_t \tag{41}
$$

其中 $\eta_t$ 是全局学习率(可配合 warmup 和 cosine decay 等调度策略), $\lambda$ 是权重衰减系数. 

#### 4.3.2 等价性：Stiefel 流形上的投影梯度下降

Muon 的更新规则还有一个深刻的几何解释. 在黎曼几何的框架下, 所有满足 $\mathbf{Q}^T \mathbf{Q} = \mathbf{I}$ 的矩阵构成了**Stiefel 流形**. 如果我们把优化问题限制在"每次更新都是一个正交矩阵"的约束下, 那么最优更新方向就是在该流形上的投影梯度. 

Newton-Schulz 迭代的输出 $\tilde{\mathbf{G}} = \mathbf{U}\mathbf{V}^T$ 恰好是原始梯度 $\mathbf{G} = \mathbf{U}\mathbf{\Sigma}\mathbf{V}^T$ 在 Stiefel 流形上的**最近点投影**(在 Frobenius 范数意义下). 因此, Muon 可以被理解为一种"投影梯度下降"：先在参数空间中计算普通梯度, 然后将该梯度投影到最接近的正交矩阵上, 最后用投影后的方向更新参数. 

这种几何视角揭示了一个重要事实：Muon 不仅仅是在"做归一化", 它是在一个具有非欧几何结构的约束流形上进行优化. Stiefel 流形的曲率特性自然地编码了矩阵参数的方向耦合关系, 而这正是 Adam 完全缺失的信息. 

### 4.4 与 Shampoo 的关系

Shampoo 是理解 Muon 的重要参照系. 两者都试图利用梯度矩阵的结构信息来改进更新质量, 但采用了截然不同的技术路径. 

#### 4.4.1 Shampoo 的更新公式回顾

Shampoo 的预条件梯度更新为：

$$
 \Delta \mathbf{W}_{Shampoo} = \mathbf{L}_t^{-1/4} \mathbf{G}_t \mathbf{R}_t^{-1/4} \tag{42}
$$

这里 $\mathbf{L}_t$ 和 $\mathbf{R}_t$ 分别是梯度矩阵在输出空间和输入空间方向上的历史外积累积：

$$
 \mathbf{L}_t = \sum_{\tau=1}^t \mathbf{G}_\tau \mathbf{G}_\tau^T, \quad \mathbf{R}_t = \sum_{\tau=1}^t \mathbf{G}_\tau^T \mathbf{G}_\tau \tag{43}
$$

直观上, $\mathbf{L}_t$ 累积了梯度在输出空间(左)方向上的协方差, $\mathbf{R}_t$ 累积了梯度在输入空间(右)方向上的协方差. $\mathbf{L}_t^{-1/4}$ 和 $\mathbf{R}_t^{-1/4}$ 对这些方向的更新进行自适应缩放, 使得在梯度变化剧烈的方向上步长更小, 在梯度稳定的方向上步长更大. 

#### 4.4.2 Muon 与 Shampoo 的核心差异

**差异一：预条件器的构造方式**

Shampoo 的预条件器是基于**历史梯度的外积累积**, 是一个真正的二阶统计量. 它需要维护两个额外的状态矩阵 $\mathbf{L}_t$ 和 $\mathbf{R}_t$, 并周期性计算它们的 $-1/4$ 次幂(通过特征分解或矩阵幂迭代). 

Muon 的"预条件"则是通过对**当前梯度动量**直接进行谱归一化实现的. 它不维护历史外积矩阵, 也不需要计算矩阵幂次. Newton-Schulz 迭代的全部状态就是一个与梯度同形的矩阵 $\mathbf{X}_k$, 在迭代结束后即被丢弃. 

**差异二：计算复杂度**

Shampoo 每步的核心瓶颈是计算 $\mathbf{L}^{-1/4}$ 和 $\mathbf{R}^{-1/4}$. 即使使用矩阵幂迭代来近似, 其收敛速度和数值稳定性也高度依赖于矩阵的条件数. 

Muon 每步的核心计算是 $K$ 次矩阵乘法 $\mathbf{X}_k^T \mathbf{X}_k$ 和矩阵-矩阵乘法 $\mathbf{X}_k (3\mathbf{I} - \mathbf{X}_k^T \mathbf{X}_k)$. 矩阵乘法是 GPU 上最优化、最成熟的算子, 能够高效利用 Tensor Core 进行混合精度加速. 

**差异三：理论等价条件**

有趣的是, 在没有动量衰减($\beta = 1$, 即使用纯累积梯度而非指数移动平均)且某些理想化假设下, Shampoo 和 Muon 在理论上是有关联的. 当梯度在所有时间步都相同时, Shampoo 的预条件器退化为与 Muon 相似的谱归一化形式. 但在实际的随机优化场景中, 两者的行为差异显著：Shampoo 更依赖历史统计的平滑性, 而 Muon 更强调对当前梯度动量的即时几何修正. 

### 4.5 分布式挑战(Kimi K2 实践)

Muon 的工程落地并非一帆风顺. 其矩阵级别的操作在分布式训练中引入了 Adam 所不具备的挑战. 

#### 4.5.1 All-Gather 通信：每个 rank 只有部分梯度

在现代大模型训练中, 模型并行(Tensor Parallelism)和数据并行(Data Parallelism)是标配. 考虑一个 $4096 \times 4096$ 的 Linear 层权重矩阵, 在 8 路张量并行下, 每个 GPU rank 只持有该矩阵的 $4096 \times 512$ 切片. 

当计算梯度时, 每个 rank 得到的也是对应切片的局部梯度 $\mathbf{G}^{(local)} \in \mathbb{R}^{4096 \times 512}$. 

AdamW 的逐元素特性意味着每个 rank 可以完全独立地更新自己的参数切片, 无需任何跨 rank 通信(除了数据并行下的梯度 All-Reduce, 那是另一回事). 

但 Muon 的 Newton-Schulz 迭代需要对**完整的梯度矩阵**进行操作. 对于被切分的权重矩阵, 每个 rank 必须先通过 **All-Gather** 通信收集其他 rank 的梯度切片, 组装成完整的 $\mathbf{G}$, 才能执行 Newton-Schulz 迭代. 迭代完成后, 每个 rank 再提取自己对应的更新切片, 应用到本地参数上. 

#### 4.5.2 通信量分析

假设一个权重矩阵的维度为 $m \times n$, 被切分到 $P$ 个 rank 上(沿列切分, 每个 rank 持有 $m \times (n/P)$). 

- **AdamW**：每个 rank 独立计算更新, 无需额外的矩阵级通信. 额外的优化器状态只有与参数同形的一阶矩和二阶矩. 

- **Muon**：每个 rank 需要 All-Gather 完整的梯度矩阵 $\mathbf{G}$, 通信量为 $O(m \times n)$(每个 rank 发送自己的 $m \times (n/P)$ 切片, 接收 $(P-1)$ 个其他切片, 总接收量约为 $m \times n$). 

这个额外通信量在大型集群上可能成为瓶颈. 为了缓解这一问题, Kimi K2 的训练实践中可能采用了以下策略：
1. **仅对关键层使用 Muon**：对于参数量小或梯度通信成本高的层, 回退到 AdamW; 

2. **梯度通信与 Newton-Schulz 重叠执行**：利用 pipeline 并行中的通信空闲窗口进行 All-Gather; 

3. **按行/列分组执行**：对于特别大的矩阵, 将多个 rank 组织成子组, 在子组内执行局部的 Muon 更新. 

#### 4.5.3 FP8 梯度压缩对谱计算的影响

为了追求极致的训练效率, 现代大模型训练 increasingly 采用 FP8(8-bit 浮点)梯度压缩. FP8 的动态范围约为 E4M3 或 E5M2 格式, 能够大幅减少梯度通信的带宽占用. 

然而, FP8 压缩对 Muon 提出了额外的数值挑战. Newton-Schulz 迭代的收敛性依赖于初始矩阵归一化后的奇异值精确位于 $(0, 1]$ 区间内. FP8 的低精度可能导致：
- **奇异值截断**：过小的梯度元素被 FP8 的表示精度下限截断为零, 改变了矩阵的有效秩; 

- **归一化误差**：谱范数 $\|\mathbf{G}\|_2$ 的估计在 FP8 精度下可能产生相对误差, 导致初始归一化后的最大奇异值偏离 1; 

- **迭代发散风险**：如果由于数值误差导致某个奇异值被高估为略大于 $\sqrt{3} \approx 1.732$, Newton-Schulz 迭代在该方向上可能发散(因为 $f(\sqrt{3}) = 0$, 而 $f(s) < 0$ 当 $s > \sqrt{3}$). 

工程上的解决方案通常包括在局部使用更高精度(如 FP16 或 FP32)来执行 Newton-Schulz 迭代, 同时保持梯度通信的 FP8 压缩. 这种"混合精度 Muon"需要在通信带宽和数值稳定性之间做出精细的权衡. 

## 5. 数值走查 (Numerical Example)

为了直观感受 Newton-Schulz 迭代的收敛行为, 我们用一个极其简单的 $2 \times 2$ 梯度矩阵手动走三遍迭代, 观察奇异值如何被驱动到 1. 

### 5.1 初始梯度矩阵

假设某一层权重的梯度矩阵为：

$$
 \mathbf{G} = \begin{bmatrix} 3.0 & 1.0 \\ 0.5 & 2.0 \end{bmatrix} \tag{44}
$$
首先计算 $\mathbf{G}$ 的 SVD, 以了解其谱结构：

$$
 \mathbf{G}^T \mathbf{G} = \begin{bmatrix} 3.0 & 0.5 \\ 1.0 & 2.0 \end{bmatrix} \begin{bmatrix} 3.0 & 1.0 \\ 0.5 & 2.0 \end{bmatrix} = \begin{bmatrix} 9.25 & 4.0 \\ 4.0 & 5.0 \end{bmatrix} \tag{45}
$$

求解特征值 $\det(\mathbf{G}^T \mathbf{G} - \lambda \mathbf{I}) = 0$：

$$
 (9.25 - \lambda)(5.0 - \lambda) - 16 = 0 \tag{46}
$$
$$
 \lambda^2 - 14.25\lambda + 46.25 - 16 = 0 \tag{47}
$$
$$
 \lambda^2 - 14.25\lambda + 30.25 = 0 \tag{48}
$$
使用求根公式：
$$
 \lambda = \frac{14.25 \pm \sqrt{203.0625 - 121}}{2} = \frac{14.25 \pm \sqrt{82.0625}}{2} = \frac{14.25 \pm 9.059}{2} \tag{49}
$$

$$
 \lambda_1 \approx 11.655, \quad \lambda_2 \approx 2.596 \tag{50}
$$
因此梯度矩阵的两个奇异值分别为：
$$
 \sigma_1 = \sqrt{11.655} \approx 3.414, \quad \sigma_2 = \sqrt{2.596} \approx 1.611 \tag{51}
$$

上述结果表明谱范数等于最大奇异值, 即 $\|\mathbf{G}\|_2 = \sigma_1 \approx 3.414$. 

### 5.2 初始归一化

$$
 \mathbf{X}_0 = \frac{\mathbf{G}}{\|\mathbf{G}\|_2} = \frac{1}{3.414} \begin{bmatrix} 3.0 & 1.0 \\ 0.5 & 2.0 \end{bmatrix} \approx \begin{bmatrix} 0.8787 & 0.2929 \\ 0.1464 & 0.5858 \end{bmatrix} \tag{52}
$$
归一化后的奇异值为 $s_1^{(0)} = 3.414/3.414 = 1.0$, $s_2^{(0)} = 1.611/3.414 \approx 0.472$. 

注意由于数值舍入, $s_1^{(0)}$ 可能略小于 1. 为了展示迭代的典型行为, 我们以 $s_1^{(0)} = 1.0$ 和 $s_2^{(0)} = 0.472$ 进行标量迭代分析. 

### 5.3 第一步 Newton-Schulz 迭代

首先计算归一化后矩阵的 Gram 矩阵：

$$
 \mathbf{X}_0^T \mathbf{X}_0 \approx \begin{bmatrix} 0.8787 & 0.1464 \\ 0.2929 & 0.5858 \end{bmatrix} \begin{bmatrix} 0.8787 & 0.2929 \\ 0.1464 & 0.5858 \end{bmatrix} \tag{53}
$$
$$
 = \begin{bmatrix} 0.7937 & 0.3431 \\ 0.3431 & 0.4292 \end{bmatrix} \tag{54}
$$

然后计算 Newton-Schulz 迭代所需的修正矩阵：

$$
 3\mathbf{I} - \mathbf{X}_0^T \mathbf{X}_0 \approx \begin{bmatrix} 2.2063 & -0.3431 \\ -0.3431 & 2.5708 \end{bmatrix} \tag{55}
$$

最后执行第一步 Newton-Schulz 迭代更新：

$$
 \mathbf{X}_0 (3\mathbf{I} - \mathbf{X}_0^T \mathbf{X}_0) \approx \begin{bmatrix} 0.8787 & 0.2929 \\ 0.1464 & 0.5858 \end{bmatrix} \begin{bmatrix} 2.2063 & -0.3431 \\ -0.3431 & 2.5708 \end{bmatrix} \tag{56}
$$
$$
 \approx \begin{bmatrix} 1.838 & 0.451 \\ 0.122 & 1.456 \end{bmatrix} \tag{57}
$$
$$
 \mathbf{X}_1 \approx \begin{bmatrix} 0.919 & 0.226 \\ 0.061 & 0.728 \end{bmatrix} \tag{58}
$$
从标量迭代的角度验证：
- $s_1^{(1)} = \frac{3 \times 1.0 - 1.0^3}{2} = 1.0$(保持为 1)
- $s_2^{(1)} = \frac{3 \times 0.472 - 0.472^3}{2} = \frac{1.416 - 0.105}{2} = \frac{1.311}{2} \approx 0.656$

第二个奇异值从 $0.472$ 被推高到了 $0.656$！

### 5.4 第二步 Newton-Schulz 迭代

标量迭代：
- $s_1^{(2)} = 1.0$
- $s_2^{(2)} = \frac{3 \times 0.656 - 0.656^3}{2} = \frac{1.968 - 0.282}{2} = \frac{1.686}{2} \approx 0.843$

第二个奇异值继续从 $0.656$ 被推高到 $0.843$. 

### 5.5 第三步 Newton-Schulz 迭代

标量迭代：
- $s_1^{(3)} = 1.0$
- $s_2^{(3)} = \frac{3 \times 0.843 - 0.843^3}{2} = \frac{2.529 - 0.599}{2} = \frac{1.930}{2} \approx 0.965$

第二个奇异值已非常接近 1！

### 5.6 收敛过程汇总

| 迭代步 $k$ | $s_1^{(k)}$ | $s_2^{(k)}$ | $s_2$ 的误差 $\epsilon_k = 1 - s_2^{(k)}$ | 误差比率 $\epsilon_{k+1}/\epsilon_k^2$ |
|:---:|:---:|:---:|:---:|:---:|
| 0 | 1.000 | 0.472 | 0.528 | — |
| 1 | 1.000 | 0.656 | 0.344 | $0.344 / 0.528^2 \approx 1.23$ |
| 2 | 1.000 | 0.843 | 0.157 | $0.157 / 0.344^2 \approx 1.33$ |
| 3 | 1.000 | 0.965 | 0.035 | $0.035 / 0.157^2 \approx 1.42$ |
| 4 | 1.000 | 0.998 | 0.002 | $0.002 / 0.035^2 \approx 1.63$ |

**观察与解读**：

1. **奇异值 1 保持不动**：由于初始归一化将最大奇异值恰好置于 1(或非常接近 1), Newton-Schulz 迭代中的自校正机制在该方向上不施加任何净力, 它稳定地停留在不动点. 

2. **小奇异值被快速推高**：$s_2$ 从 $0.472$ 仅用 3 步就达到了 $0.965$, 第 4 步几乎达到机器精度意义上的 1. 这完美展示了二次收敛的威力. 

3. **误差比率验证**：最后一列 $\epsilon_{k+1}/\epsilon_k^2$ 的理论极限是 $3/2 = 1.5$(由 4.2.3 节的推导). 由于初始误差较大, 前几步的比率略偏离理论值, 但随着迭代推进, 它逐渐向 1.5 靠拢(从 1.23 → 1.33 → 1.42 → 1.63). 

4. **实际意义**：在 Muon 的训练中, 通常只需要 5–10 次迭代, 因为即使奇异值尚未完全达到 1, 它们已经被充分"拉平", 足以提供高质量的谱归一化更新方向. 

![Newton-Schulz 奇异值收敛与误差曲线](images/newton_schulz_convergence_chart.png)

> **图 6.19 Newton-Schulz 迭代中奇异值 $s_1, s_2$ 逼近曲线与绝对误差 $\epsilon$ 二次收敛对数曲线**
> * **奇异值收敛(左轴)**：最大奇异值 $s_1$ 在归一化后稳定在 1.0 不动(稳定吸引子), 较小的奇异值 $s_2$ 从 $0.472$ 起步, 在前几步以典型的 S 曲线形态迅速逼近 $1.0$. 
> * **误差二次收敛(右轴)**：绝对误差 $\epsilon_k = |1 - s_2^{(k)}|$ 表现出极具代表性的二次下坠. 每一步有效数字位数翻倍, 通常仅需 4-5 步即可完全收敛至机器精度精度限值, 这奠定了 Muon 高效计算的数值基石. 

## 6. 简化实现 (PyTorch Code)

以下是一个完整的、可直接运行的 PyTorch 简化实现, 包含 Newton-Schulz 迭代函数、Muon 优化器类, 以及分布式 All-Gather 的包装逻辑. 核心逻辑控制在约 100 行以内, 并附有详细的公式对应注释. 

```python
import torch
import torch.nn as nn
from torch.optim.optimizer import Optimizer


def newton_schulz_iter(X: torch.Tensor, num_steps: int = 5) -> torch.Tensor:
    """
    Newton-Schulz 迭代：计算矩阵 X 的正交近似 msign(X). 
    
    对应数学公式:
        X_{k+1} = 0.5 * X_k * (3I - X_k^T * X_k)
    
    Args:
        X: 输入矩阵, 形状为 (m, n). 要求已经过谱范数归一化. 
        num_steps: 迭代步数, 默认 5(在大多数场景下已足够). 
    
    Returns:
        迭代结果, 形状为 (m, n), 近似满足 Y^T @ Y ≈ I. 
    """
    # 在迭代过程中保持与输入相同的 dtype 和设备
    for _ in range(num_steps):
        # 计算 X_k^T * X_k, 对应数学项 X_k^T X_k
        # 形状: (n, m) @ (m, n) -> (n, n)
        XTX = X.T @ X
        
        # 计算 3I - X_k^T X_k, 对应数学项 (3I - X_k^T X_k)
        # 这是自校正因子：奇异值>1时拉回, <1时推高
        correction = 3.0 * torch.eye(X.shape[1], device=X.device, dtype=X.dtype) - XTX
        
        # 计算 X_{k+1} = 0.5 * X_k * (3I - X_k^T X_k)
        X = 0.5 * (X @ correction)
    
    return X


class Muon(Optimizer):
    """
    Muon 优化器简化实现. 
    
    对矩阵型参数(nn.Linear 的 weight)使用 Newton-Schulz 谱归一化更新; 
    对非矩阵型参数(bias, embedding, layernorm)回退到 AdamW. 
    
    对应数学公式:
        M_t = β * M_{t-1} + (1-β) * G_t          (动量累积)
        X_0 = M_t / ||M_t||_2                     (谱范数归一化)
        X_{k+1} = 0.5 * X_k * (3I - X_k^T X_k)    (Newton-Schulz 迭代)
        W_{t+1} = (1 - ηλ) * W_t - η * X_K        (参数更新, 含权重衰减)
    """
    
    def __init__(
        self,
        params,
        lr: float = 1e-3,
        momentum: float = 0.95,
        weight_decay: float = 0.01,
        ns_steps: int = 5,
        adamw_params=None,  # 需要用 AdamW 处理的参数列表
        adamw_lr: float = 1e-3,
        adamw_betas=(0.9, 0.999),
        adamw_eps: float = 1e-8,
    ):
        defaults = dict(
            lr=lr, momentum=momentum, weight_decay=weight_decay,
            ns_steps=ns_steps, adamw_lr=adamw_lr,
            adamw_betas=adamw_betas, adamw_eps=adamw_eps,
        )
        super().__init__(params, defaults)
        
        # 分离矩阵型参数和非矩阵型参数
        self.muon_params = []
        self.adamw_param_groups = []
        
        for group in self.param_groups:
            muon_group = []
            adamw_group = []
            for p in group['params']:
                if p.ndim >= 2 and p.numel() >= 2:
                    # 矩阵型参数(Linear weight, Conv weight 等)
                    muon_group.append(p)
                else:
                    # 标量/向量型参数(bias, embedding, LN)
                    adamw_group.append(p)
            
            if muon_group:
                self.muon_params.extend(muon_group)
            if adamw_group:
                self.adamw_param_groups.append({
                    'params': adamw_group,
                    'lr': group['adamw_lr'],
                    'betas': group['adamw_betas'],
                    'eps': group['adamw_eps'],
                    'weight_decay': group['weight_decay'],
                })
        
        # 为 AdamW 参数初始化一阶矩和二阶矩
        for group in self.adamw_param_groups:
            for p in group['params']:
                self.state[p]['exp_avg'] = torch.zeros_like(p)
                self.state[p]['exp_avg_sq'] = torch.zeros_like(p)
    
    def _adamw_step(self, p, group, step_t):
        """AdamW 更新子程序, 用于 bias/embedding/LN 等参数. """
        grad = p.grad
        if grad is None:
            return
        
        state = self.state[p]
        exp_avg, exp_avg_sq = state['exp_avg'], state['exp_avg_sq']
        beta1, beta2 = group['betas']
        
        # 一阶矩和二阶矩的指数移动平均
        exp_avg.mul_(beta1).add_(grad, alpha=1 - beta1)
        exp_avg_sq.mul_(beta2).addcmul_(grad, grad, value=1 - beta2)
        
        # 偏差修正
        bias_correction1 = 1 - beta1 ** step_t
        bias_correction2 = 1 - beta2 ** step_t
        
        step_size = group['lr'] / bias_correction1
        denom = (exp_avg_sq.sqrt() / (bias_correction2 ** 0.5)).add_(group['eps'])
        
        # AdamW 解耦权重衰减
        p.data.mul_(1 - group['lr'] * group['weight_decay'])
        p.data.addcdiv_(exp_avg, denom, value=-step_size)
    
    def step(self, closure=None):
        loss = None
        if closure is not None:
            loss = closure()
        
        for group in self.param_groups:
            ns_steps = group['ns_steps']
            lr = group['lr']
            momentum = group['momentum']
            wd = group['weight_decay']
            
            for p in group['params']:
                if p not in self.muon_params:
                    continue  # AdamW 参数在后续处理
                
                grad = p.grad
                if grad is None:
                    continue
                
                state = self.state[p]
                if len(state) == 0:
                    state['momentum_buffer'] = torch.zeros_like(p)
                
                buf = state['momentum_buffer']
                
                # 步骤 1: 动量累积
                # M_t = β * M_{t-1} + (1-β) * G_t
                buf.mul_(momentum).add_(grad, alpha=1 - momentum)
                
                # 步骤 2: 谱范数归一化
                # X_0 = M_t / ||M_t||_2
                # 谱范数 ||M||_2 等于最大奇异值, 可用幂迭代近似
                # 简化起见, 这里用 Frobenius 范数做保守估计(实际应用应用幂迭代)
                spectral_norm = torch.linalg.matrix_norm(buf, ord=2)
                X = buf / (spectral_norm + 1e-8)
                
                # 步骤 3: Newton-Schulz 迭代
                # X_{k+1} = 0.5 * X_k * (3I - X_k^T X_k)
                X_orth = newton_schulz_iter(X, num_steps=ns_steps)
                
                # 步骤 4: 参数更新(含解耦权重衰减)
                # W_{t+1} = (1 - ηλ) * W_t - η * X_K
                p.data.mul_(1 - lr * wd)
                p.data.add_(X_orth, alpha=-lr)
        
        # 处理 AdamW 参数
        for group in self.adamw_param_groups:
            step_t = self.state.get('_adamw_step', 1)
            for p in group['params']:
                self._adamw_step(p, group, step_t)
            self.state['_adamw_step'] = step_t + 1
        
        return loss


def distributed_muon_step(grad_shard: torch.Tensor, world_size: int, rank: int) -> torch.Tensor:
    """
    分布式场景下的 Muon 梯度 All-Gather + Newton-Schulz 包装. 
    
    对应工程场景：
        每个 rank 持有梯度矩阵的列切分切片, 需要先 All-Gather 完整梯度, 
        再执行 Newton-Schulz 迭代, 最后取回本地对应的更新切片. 
    
    Args:
        grad_shard: 当前 rank 的局部梯度切片, 形状 (m, n // world_size). 
        world_size: 分布式 world size. 
        rank: 当前 rank 编号. 
    
    Returns:
        当前 rank 对应的谱归一化更新切片. 
    """
    # 步骤 1: All-Gather 完整梯度
    # 对应工程挑战: 非逐元素操作需要跨 rank 通信
    gather_list = [torch.empty_like(grad_shard) for _ in range(world_size)]
    torch.distributed.all_gather(gather_list, grad_shard)
    grad_full = torch.cat(gather_list, dim=1)  # 沿列拼接
    
    # 步骤 2: 对完整梯度执行 Newton-Schulz 迭代
    # 对应数学: X_{k+1} = 0.5 * X_k * (3I - X_k^T X_k)
    spectral_norm = torch.linalg.matrix_norm(grad_full, ord=2)
    X = grad_full / (spectral_norm + 1e-8)
    update_full = newton_schulz_iter(X, num_steps=5)
    
    # 步骤 3: 提取当前 rank 对应的切片
    n_local = grad_shard.shape[1]
    start_col = rank * n_local
    end_col = start_col + n_local
    update_shard = update_full[:, start_col:end_col]
    
    return update_shard


# === 使用示例 ===
if __name__ == "__main__":
    # 创建一个简单的两层 MLP
    model = nn.Sequential(
        nn.Linear(128, 256),
        nn.ReLU(),
        nn.Linear(256, 64),
    )
    
    # 所有参数都交给 Muon, 内部会自动区分矩阵型和非矩阵型
    optimizer = Muon(model.parameters(), lr=3e-4, momentum=0.95, weight_decay=0.01)
    
    # 模拟一个训练步
    x = torch.randn(32, 128)
    y = torch.randn(32, 64)
    loss = nn.functional.mse_loss(model(x), y)
    loss.backward()
    optimizer.step()
    optimizer.zero_grad()
    
    print("Muon optimizer step completed successfully.")
```

**代码与理论的对照解读**：

1. `newton_schulz_iter` 函数严格对应了公式 $X_{k+1} = 0.5 \cdot X_k \cdot (3I - X_k^T X_k)$. 注意 `X.T @ X` 产生的是 $(n, n)$ 矩阵, 当 $n \ll m$ 时(这在 Transformer 的 MLP 投影层中很常见, 如 $4d \times d$), 这一乘法的计算量远小于完整的 SVD. 

2. `Muon` 类中的参数自动分离逻辑(`p.ndim >= 2`)对应了 Muon 的一个重要边界条件：**Muon 只适用于矩阵型参数**. 对于 bias、embedding、LayerNorm 的 scale 和 shift 等标量或向量参数, 代码自动回退到 AdamW. 

3. `spectral_norm = torch.linalg.matrix_norm(buf, ord=2)` 计算的是谱范数(最大奇异值). 在实际大规模训练中, 这一操作可以通过**幂迭代(Power Iteration)** 进一步近似, 避免调用成本较高的完整 SVD 例程. 

4. `distributed_muon_step` 展示了分布式训练的核心挑战：必须通过 `all_gather` 收集完整梯度. 这与 AdamW 的逐元素特性形成鲜明对比——AdamW 在每个 rank 上完全独立, 无需任何跨 rank 的矩阵级通信. 

## 7. 局限性与边界条件 (Limitations & Boundary Conditions)

世界上没有包治百病的优化器. Muon 虽然在矩阵型参数上展示了卓越的性能, 但其设计理念也决定了它存在明确的适用边界和工程约束. 

### 7.1 只适用于矩阵型参数

这是 Muon 最根本的结构性限制. Newton-Schulz 迭代操作的输入必须是一个二维矩阵 $\mathbf{G} \in \mathbb{R}^{m \times n}$, 因为只有矩阵才拥有有意义的 SVD 和谱结构. 对于以下参数类型, Muon 要么无法定义, 要么没有意义：

- **偏置(Bias)** ：典型的形状为 $(d_{out},)$ 或 $(d_{out}, 1)$ 的向量. 虽然技术上可以把它看作 $d_{out} \times 1$ 的矩阵并执行 Newton-Schulz 迭代, 但此时 SVD 退化为平凡的标量归一化(因为秩最多为 1), 完全丧失了谱感知的优势. 对 bias 使用 Muon 等价于做了一个不必要的复杂归一化, 效果不如直接使用 AdamW. 

- **词嵌入(Embedding)** ：形状为 $(vocab\_size, d_{model})$, 通常是 $O(10^5) \times O(10^4)$ 的矩阵. 虽然它是一个矩阵, 但 embedding 矩阵的每一行代表一个独立 token 的向量表示, 行与行之间并不存在像 Linear 权重那样的结构化线性映射关系. 对 embedding 矩阵应用谱归一化会强行在语义无关的 token 向量之间引入耦合, 可能破坏已经学到的语义结构. 

- **LayerNorm 参数**：包括 scale 参数 $\gamma$ 和 shift 参数 $\beta$, 都是形状 $(d_{model},)$ 的向量. 与 bias 类似, 对它们应用 Muon 没有意义. 

**工程实践**：正如 Kimi K2 的训练配置所示, 正确的做法是**混合使用**——对 Linear 层的 weight 使用 Muon, 对所有其他参数使用 AdamW. 这增加了优化器配置的复杂度, 要求训练框架能够灵活地为不同参数组分配不同的优化器逻辑. 

### 7.2 迭代次数的权衡

Newton-Schulz 迭代的步数 $K$ 是一个关键超参数, 但它同时影响三个相互冲突的指标：

| 迭代步数 $K$ | 谱归一化精度 | 每步计算开销 | 训练稳定性 |
|:---:|:---:|:---:|:---:|
| $K = 1$–$3$ | 低, 奇异值偏离 1 | 极低 | 差, 方向校正不足 |
| $K = 5$–$7$ | 中高, 接近正交 | 中等 | 良好, 经验最优区间 |
| $K = 10$–$15$ | 极高, 机器精度 | 较高 | 好, 但收益递减 |
| $K \to \infty$ | 精确正交 | 不可接受 | 无额外收益 |

**关键洞察**：由于二次收敛的特性, Newton-Schulz 迭代存在明显的**收益递减效应**. 从 $K=5$ 增加到 $K=10$ 所带来的谱归一化精度提升, 远远小于从 $K=1$ 增加到 $K=5$ 的提升. 但每增加一步迭代, 就意味着额外的两次矩阵乘法(`X.T @ X` 和 `X @ correction`). 对于宽层(如 $m = 16384, n = 4096$), 这些矩阵乘法虽然高效, 但累积起来也不容忽视. 

在实际工程中, $K = 5$ 或 $K = 6$ 是一个经验上非常稳健的选择. 如果观察到训练发散或更新方向异常, 可以适度增加到 $K = 8$–$10$, 但超过 10 的迭代步数几乎没有可见的收益. 

### 7.3 分布式通信瓶颈

如 4.5 节所述, Muon 的矩阵级操作与张量并行(Tensor Parallelism)之间存在天然的张力. 当权重矩阵被切分到多个 GPU 上时, Muon 要求在每个更新步骤之前执行 All-Gather 操作来重组完整梯度. 

这一通信开销的规模可以这样估算：
- 对于一个 $m \times n$ 的权重矩阵, All-Gather 的通信总量约为 $m \times n \times (P-1)/P \times \text{sizeof(dtype)}$ 字节(每个 rank 需要接收其余 $P-1$ 个 rank 的切片). 
- 在典型的 Transformer 中, 一个 Decoder Layer 包含 4 个主要矩阵($W_Q, W_K, W_V, W_O$ 以及两个 MLP 矩阵), All-Gather 的通信量随层数线性增长. 

在强扩展场景(固定模型大小, 增加 GPU 数量)中, 通信开销占总迭代时间的比例会随 $P$ 增加而上升. 当 $P$ 很大时, All-Gather 的延迟可能成为新的瓶颈. 

**缓解策略**：
1. **选择性 Muon**：只在最大的几个矩阵上使用 Muon, 对小矩阵使用 AdamW, 减少通信总量; 

2. **通信与计算重叠**：利用 GPU 的异步执行能力, 在 backward 计算还在进行时, 提前启动上一层的梯度 All-Gather; 

3. **子组 Muon**：将 $P$ 个 rank 分成若干子组, 在子组内部执行 Muon, 牺牲一部分谱精度来换取通信减少. 

### 7.4 与 Adam 混合使用的复杂性

Muon + AdamW 的混合策略虽然工程上有效, 但在理论上引入了一些不优雅之处：

- **超参数空间膨胀**：现在需要同时调优 Muon 的学习率、动量、权重衰减, 以及 AdamW 的学习率、$\beta_1$、$\beta_2$、权重衰减. 两组超参数之间可能存在耦合效应. 

- **更新尺度不匹配**：Muon 的更新方向经过谱归一化后, 其范数大致与矩阵维度相关(因为奇异值被归一化到 1), 而 AdamW 的更新范数受梯度统计量影响. 直接使用相同的学习率可能导致两类参数的更新尺度差异过大. 

- **收敛性分析困难**：混合优化器的收敛性理论分析比纯一阶或纯二阶方法复杂得多, 因为参数空间被划分成了两个使用不同更新动力学(dynamics)的子空间. 

在实践中, Moonshot AI 和开源社区的做法是：对 Muon 参数使用较大的学习率(例如 $3\times 10^{-4}$), 对 AdamW 参数使用较小的学习率(例如 $1\times 10^{-4}$ 或 $3\times 10^{-5}$), 并通过 warmup 和衰减策略来协调两者的时间演化. 

![Muon 适用边界雷达图](images/muon_radar.png)

> **图 6.5.2 优化器选型边界：Muon vs AdamW vs Shampoo**
> Muon 展现出了“偏科”的特性：在 2D 矩阵参数和收敛速度上无可匹敌, 但在非矩阵参数处理及大规模分布式扩展(因跨节点 All-Gather 开销)上存在短板. 这也是为何实际应用中通常采用 Muon 负责核心隐层, 而 AdamW/SGD 负责周边参数的混搭编队. 

## 8. 演进与承上启下 (Evolution & Segue)

Muon 不是优化器演进的终点, 而是一个承前启后的关键节点. 它继承了 Shampoo 对矩阵结构的尊重, 又用 Newton-Schulz 迭代突破了 Shampoo 的工程瓶颈. 面向未来, Muon 的设计理念正在催生一系列新的研究方向. 

### 8.1 Sophia、Adam-mini 与结构感知优化的百花齐放

**Sophia** 是 2023 年由斯坦福和 NVIDIA 提出的轻量级二阶优化器. 与 Muon 不同, Sophia 不操作矩阵的谱结构, 而是估计每个参数维度上的 Hessian 对角线元素, 并用它来裁剪(clip)更新步长. Sophia 的哲学是"一阶方向, 二阶幅度"——保持 Adam 的逐元素更新方向, 但用曲率信息来调整每个维度上最多能走多远. 这可以看作是在 Adam 和全二阶方法之间的另一种折中. 

**Adam-mini** 则走了一条完全不同的路. 它观察到 Adam 的二阶矩 $v_t$ 在不同参数组之间高度冗余, 因此将参数分组后只在组级别维护二阶统计量, 将优化器状态的显存占用减少了约 50%. Adam-mini 的洞察是**结构压缩**而非**结构利用**——它不改变 Adam 的逐元素更新哲学, 而是通过减少冗余状态来让 Adam 跑得更轻. 

Muon、Sophia、Adam-mini 三者共同勾勒出 2025–2026 年优化器研究的三条主线：
- **Muon**：利用矩阵谱结构, 改变更新方向的几何性质; 

- **Sophia**：利用对角曲率, 改变更新幅度的自适应机制; 

- **Adam-mini**：压缩冗余状态, 不改变更新公式但降低显存占用. 

这三条主线并非互斥. 未来的 SOTA 优化器很可能是一个融合体：对矩阵参数使用类似 Muon 的谱归一化, 对高曲率维度使用类似 Sophia 的裁剪机制, 同时在状态维护上借鉴 Adam-mini 的分组压缩. 

### 8.2 量化训练中的优化器挑战

随着 FP8、甚至 INT8 训练成为主流, 优化器面临的数值环境正在发生根本性变化. Muon 对数值精度尤为敏感, 因为 Newton-Schulz 迭代的收敛域是 $(0, \sqrt{3})$, 低精度量化可能将奇异值推出这个安全区间. 

未来的研究方向包括：
- **量化感知的谱归一化**：在 FP8 精度下直接估计谱范数和执行 Newton-Schulz 迭代, 同时保证数值稳定性; 

- **随机舍入的 Muon**：在梯度通信和迭代计算中引入随机舍入(stochastic rounding), 用统计无偏性来补偿量化偏差; 

- **自适应迭代步数**：根据当前梯度矩阵的条件数动态调整 Newton-Schulz 的迭代步数——对条件数好的矩阵少迭代, 对条件数差的矩阵多迭代. 

### 8.3 从隐藏层到全部层：Muon 的泛化前景

当前 Muon 主要用于 Transformer 的隐藏层权重矩阵. 一个自然的问题是：Muon 的思想能否扩展到注意力机制中的其他结构化张量？例如, 注意力 score 矩阵 $\mathbf{Q}\mathbf{K}^T$ 虽然只在 forward 中临时存在, 但其低秩结构是否能在优化中加以利用？

更进一步, 随着状态空间模型(SSM, 如 Mamba)和线性注意力(Linear Attention)的兴起, 参数矩阵的结构性正在发生变化. 在这些架构中, 状态转移矩阵往往具有特定的参数化形式(如对角化或低秩分解), Muons 的谱归一化思想可能需要适配到这些约束流形上. 

**结语**：Muon 优化器用 Newton-Schulz 迭代这把钥匙, 打开了"一阶代价、二阶质量"的宝库. 它提醒我们, 在深度学习优化的漫长征程中, 最深刻的进步往往来自于对基本数学结构的重新发现——矩阵的奇异值分解早在 20 世纪就被数学家们完整掌握, 但直到 2024 年, 它才通过 Muon 的形式, 在十亿参数模型的训练中焕发出工程实践的光辉. 

## 9. 参考文献 (References)

1. **Muon 原论文**：Jordan, K., et al. "Muon: An optimizer for hidden layers in neural networks." *Keller Jordan's Blog*, 2024. 本文的核心算法来源, 首次提出了将 Newton-Schulz 迭代用于神经网络优化器. 

2. **Muon 规模化验证**："Muon is Scalable for LLM Training." *arXiv preprint arXiv:2502.16982*, 2025. 该论文系统验证了 Muon 在十亿参数规模 LLM 训练中的可扩展性, 并讨论了分布式训练中的工程细节. 

3. **Shampoo**：Gupta, V., Koren, T., & Singer, Y. "Shampoo: Preconditioned Stochastic Tensor Optimization." *International Conference on Machine Learning (ICML)*, 2018. Muon 最重要的理论先驱, 首次将矩阵预条件器引入深度学习优化. 

4. **Kimi K2 技术报告**：Moonshot AI. "Kimi K2 Technical Report." 2025. 披露了 Muon 在 Kimi K2 后训练中的实际采用细节和混合优化器配置. 

5. **矩阵符号函数理论**：Roberts, J. D. "Linear model reduction and solution of the Lyapunov and algebraic Riccati equations." *Cambridge University Engineering Department Report CUED/B-Control/TR13*, 1980. 矩阵符号函数的经典参考文献. 

6. **Newton-Schulz 迭代分析**：Higham, N. J. "Functions of Matrices: Theory and Computation." *Society for Industrial and Applied Mathematics*, 2008. 第 5 章详细讨论了包括 Newton-Schulz 在内的各种矩阵符号函数迭代算法的收敛性分析. 

7. **Sophia**：Liu, H., Li, Z., & Ma, T. "Sophia: A Scalable Stochastic Second-order Optimizer for Language Model Pre-training." *arXiv preprint arXiv:2305.14342*, 2023. 同期另一重要的轻量级二阶优化器工作. 

8. **AdamW**：Loshchilov, I., & Hutter, F. "Decoupled Weight Decay Regularization." *International Conference on Learning Representations (ICLR)*, 2019. 现代大模型训练的事实标准优化器. 

9. **Stiefel 流形优化**：Edelman, A., Arias, T. A., & Smith, S. T. "The geometry of algorithms with orthogonality constraints." *SIAM Journal on Matrix Analysis and Applications*, 1998. Muon 更新规则在几何上等价于 Stiefel 流形上的投影梯度下降, 该文献是这一领域的奠基之作. 
