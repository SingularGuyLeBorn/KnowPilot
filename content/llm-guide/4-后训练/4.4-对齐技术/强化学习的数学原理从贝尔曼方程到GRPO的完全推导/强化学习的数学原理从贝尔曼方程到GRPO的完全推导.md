---
title: "4.4 · 强化学习的数学原理从贝尔曼方程到GRPO的完全推导"
date: 2026-05-11
tags: []
---

## 1. 数学大厦的地基

本章从测度论概率空间开始, 一步步搭建强化学习与对齐算法所依赖的随机过程与马尔可夫决策框架. 这些概念与标准强化学习教材中的形式化是严格一致的.

(如果对数学基础不感兴趣可以跳过第一，二章，直接从第三章 TRPO 开始，不影响阅读)

### 1.1 概率公理与随机过程

我们首先给出概率空间的公理化定义.

**定义 1.1 (概率空间).** 概率空间是一个三元组 $(\Omega, \mathcal{F}, P)$, 其中:

- $\Omega$ 是样本空间, 表示所有可能结果的集合.- $\mathcal{F} \subseteq 2^\Omega$ 是 $\sigma$ 代数, 满足:

- $\Omega \in \mathcal{F}$.- 若 $A \in \mathcal{F}$, 则 $\Omega \setminus A \in \mathcal{F}$.- 若 $A_1, A_2, \dots \in \mathcal{F}$, 则 $\bigcup_{n=1}^\infty A_n \in \mathcal{F}$.

- $P: \mathcal{F} \to [0, 1]$ 是概率测度, 满足:

- 非负性: 对任意 $A \in \mathcal{F}$, 有 $P(A) \ge 0$.- 规范化: $P(\Omega) = 1$.- 可列可加性: 若 $A_i$ 两两不交, 则:

$P\left(\bigcup_{i=1}^\infty A_i\right) = \sum_{i=1}^\infty P(A_i)$
**定义 1.2 (随机变量).** 随机变量是可测函数 
$X: (\Omega, \mathcal{F}) \to (\mathbb{R}, \mathcal{B}(\mathbb{R}))$
, 其中 $\mathcal{B}(\mathbb{R})$ 为实数上的 Borel $\sigma$ 代数.
**期望的定义**

设 $X: \Omega \to \mathbb{R}$ 可积, 即 $\int_\Omega |X(\omega)| dP(\omega) < \infty$. 定义其数学期望为:

$\mathbb{E}[X] = \int_\Omega X(\omega) dP(\omega)$

若 $X$ 的分布有密度 $p_X(x)$, 则:

$\mathbb{E}[X] = \int_{\mathbb{R}} x p_X(x) dx$

对离散随机变量 $X$ 取值于可数集合 $\mathcal{X}$, 若 $P(X=x) = p_X(x)$, 则:

$\mathbb{E}[X] = \sum_{x \in \mathcal{X}} x p_X(x)$

**条件期望**

给定随机变量 $X$ 与 $\sigma$ 代数 $\mathcal{G} \subseteq \mathcal{F}$, 条件期望 $\mathbb{E}[X|\mathcal{G}]$ 是一个 $\mathcal{G}$ 可测随机变量, 满足:

1. $\mathbb{E}[X|\mathcal{G}]$ 可积.2. 对任意 $G \in \mathcal{G}$, 有:

$\int_G X dP = \int_G \mathbb{E}[X|\mathcal{G}] dP$

在强化学习中, 更常用的是给定随机变量 $Y$, 把 $\mathbb{E}[X|Y]$ 看作 $Y$ 的函数 $g(Y)$.

**随机过程与状态序列**

**定义 1.3 (随机过程).** 在给定概率空间 $(\Omega, \mathcal{F}, P)$ 上, 一个索引集合为 $T$ 的随机过程是随机变量族:

$\{S_t\}_{t \in T}, \quad S_t: (\Omega, \mathcal{F}) \to (\mathcal{S}, \mathcal{B}(\mathcal{S}))$

在强化学习中, 我们通常取 $T=\{0, 1, 2, \dots\}$ 为离散时间, 状态空间 $\mathcal{S}$ 可离散也可连续, 对应环境在每个时间步的状态 $S_t$.

为了和后续 MDP 表述统一, 本文中记状态过程为:

$\{S_t\}_{t \ge 0}$

若同时考虑动作过程 $\{A_t\}_{t \ge 0}$ 与奖励过程 $\{R_t\}_{t \ge 1}$, 我们得到更完整的随机过程:

$\{(S_t, A_t, R_{t+1})\}_{t \ge 0}$

### 1.2 策略与“诱导”的马尔可夫链

**策略 (Policy): 智能体的行为准则**

在 MDP 中, 环境通过 $P(s'|s,a)$ 告诉我们“世界是如何运作的”, 而策略 $\pi$ 则定义了“智能体是如何行动的”.

- **随机策略**: $\pi(a|s)$ 表示在状态 $s$ 时, 智能体**有多大的概率**选择动作 $a$. (比如: 看到红灯, 99% 刹车, 1% 闯过去).

- **确定性策略**: $a = \mu(s)$, 表示在状态 $s$ 时, 智能体**铁定**会做动作 $a$.

**马尔可夫链的“诱导” (Induced Markov Chain)** 

这是一个很多初学者卡住的地方. 既然 MDP 有动作 $a$, 为什么我们在分析收敛性时, 经常把它看作一个没有动作的马尔可夫链 (MRP)?

这里的“诱导”**, 本质上就是**“把动作带来的不确定性, 也就是策略 $\pi$, 融合进环境的概率 $P$ 里”.

想象一下:

1. **环境**说: "如果你选动作 A, 我有 80% 让你到状态 1". ($P$)

2. **策略**说: "我有 50% 的概率选动作 A". ($\pi$)

3. **合起来**: "从当前状态直接跳到状态 1 的总概率是多少?"

根据全概率公式, 我们对动作 $a$ 进行求和 (Marginalization):

$P_\pi(s'|s) = \sum_{a \in \mathcal{A}} \underbrace{\pi(a|s)}_{\text{我选这个动作的概率}} \times \underbrace{P(s'|s, a)}_{\text{选了这个动作后环境跳转的概率}}$

**直观解释**: 当策略 $\pi$ 固定后, 动作的选择就不再是一个自由变量, 而是变成了一种已知的概率分布. 此时, 整个系统就退化成了一个只与状态有关的**马尔可夫奖励过程 (MRP)** . 这就是“诱导”的含义.

同理, **诱导奖励** $R_\pi(s)$ 也是期望的概念:

$R_\pi(s) = \sum_{a \in \mathcal{A}} \pi(a|s) R(s,a)$

*(意思是: 在状态 *$s$*, 考虑到我可能做出的各种动作及其概率, 我平均能拿到的即时奖励是多少.)*

### 1.3 贝尔曼方程的硬核推导

我们不直接甩公式，而是从“我们要算什么”开始，一步步拼凑出那个大名鼎鼎的方程. 

**1. 回报 (Return) 的定义与展开**

强化学习的目标不是拿一次高分，而是拿“长久的”高分. 
在时刻 $t$，**回报 **$G_t$ 定义为**折扣累积奖励**. 我们把它展开写出来，利用递归关系: 

$\begin{aligned}\nG_t &= R_{t+1} + \gamma R_{t+2} + \gamma^2 R_{t+3} + \dots \\
&= R_{t+1} + \gamma (R_{t+2} + \gamma R_{t+3} + \dots) \\
&= \color{red}{R_{t+1} + \gamma G_{t+1}}
\end{aligned}$

这个公式的意思是: **现在的总身价 = (马上到手的钱) + (打折后的未来身价)** . 

**2. 价值函数的定义**

我们定义**状态价值函数 **$V^\pi(s)$ 为回报的期望: 

$V^\pi(s) = \mathbb{E}_\pi [G_t | S_t = s]$

**人话翻译**: "如果我现在站在状态 $s$，按照策略 $\pi$ 混下去，平均一共能拿多少分？"

**3. 分解目标: 把期望拆成两半**

我们将 $G_t = R_{t+1} + \gamma G_{t+1}$ 代入价值定义中，利用期望的**线性性质**(即 $\mathbb{E}[A+B] = \mathbb{E}[A] + \mathbb{E}[B]$)，把它拆成两部分: 

$V^\pi(s) = \mathbb{E} [ \color{red}{R_{t+1}} + \color{red}{\gamma G_{t+1}} | S_t = s]$

$V^\pi(s) = \underbrace{\mathbb{E}[R_{t+1} | S_t=s]}_{\text{第一部分: 即时奖励的期望}} + \gamma \underbrace{\mathbb{E}[G_{t+1} | S_t=s]}_{\text{第二部分: 未来价值的期望}}$

现在我们分别计算这两部分，看看它们是如何基于**概率树**展开的. 

- **第一部分(即时奖励)** : 
要拿到 $R_{t+1}$，需要两步: 

1. 策略 $\pi$ 决定选动作 $a$. 2. 环境 $P$ 决定跳转到 $s'$ 并给奖励 $R(s,a)$. 
所以，第一项展开为: 

$\mathbb{E}[R_{t+1} | S_t=s] = \sum_{a} \pi(a|s) \sum_{s'} P(s'|s,a) \cdot \color{red}{R(s,a)}$

- **第二部分(未来价值)** : 
要计算未来的 $G_{t+1}$，关键看下一站 $s'$ 在哪. 
根据定义，$\mathbb{E}[G_{t+1}|S_{t+1}=s']$ 其实就是下一站的价值 $V^\pi(s')$. 
同样的，要到达 $s'$，也需要经过动作 $a$ 和转移 $P$. 
所以，第二项展开为: 

$\mathbb{E}[G_{t+1} | S_t=s] = \sum_{a} \pi(a|s) \sum_{s'} P(s'|s,a) \cdot \color{red}{V^\pi(s')}$

**4. 合并: 见证贝尔曼方程的诞生**

现在我们把拆开的两项加回去. 请注意，这两项的**前缀概率权重**(也就是“发生这件事的概率”)是**完全一样**的，都是 $\sum_{a} \pi(a|s) \sum_{s'} P(s'|s,a)$. 

根据数学上的分配律($A \cdot x + A \cdot y = A \cdot (x+y)$)，我们可以把概率权重提取出来: 

$\begin{aligned}\nV^\pi(s) &= \mathbb{E}[R_{t+1} | S_t=s] + \gamma \cdot \mathbb{E}[G_{t+1} | S_t=s] \\
&= \left[ \sum_{a} \pi(a|s) \sum_{s'} P(s'|s,a) \cdot \color{red}{R(s,a)} \right] + \gamma \cdot \left[ \sum_{a} \pi(a|s) \sum_{s'} P(s'|s,a) \cdot \color{red}{V^\pi(s')} \right] \\
&\text{(提取公因式，进行合并)} \\
&= \sum_{a} \pi(a|s) \sum_{s'} P(s'|s,a) \left[ \color{red}{R(s,a) + \gamma V^\pi(s')} \right]
\end{aligned}$

这就是大名鼎鼎的 **贝尔曼期望方程**. 

**物理含义**: 

$\text{当前价值} = \sum (\text{走这条路的概率} \times \text{这条路的总收益})$

其中: “这条路的总收益” = **眼前的钱** ($R$) + **打折后的未来前景** ($\gamma V$). 

### 1.4 收敛性证明: 为什么迭代一定会停？

我们现在有了一个更新公式 (贝尔曼算子 $\mathcal{T}$), 就像一个“碎纸机”, 把旧的价值函数 $V$ 放进去, 吐出一个新的价值函数 $\mathcal{T}V$.

我们要证明: 这个机器是一个 **“压缩机” (Contraction Mapping)** .

**1. 定义“距离”: 无穷范数**

首先, 我们得定义两个价值函数表 $U$ 和 $V$ 之间到底差了多少.
假设只有两个状态 A 和 B.

- 表 $U$: A=10, B=20- 表 $V$: A=12, B=25

A 差了 2, B 差了 5. 我们取**最严重的那个差距**作为它们之间的距离. 这就是**无穷范数** (Infinity Norm):

$||U - V||_\infty = \max_{s} | U(s) - V(s) |$

**2. 核心推导: 误差是如何缩小的**

假设我们有两个不同的价值估计 $U$ 和 $V$. 我们把它们分别放入贝尔曼算子 $\mathcal{T}^\pi$ 跑一次, 看看出来的新结果 $\mathcal{T}^\pi U$ 和 $\mathcal{T}^\pi V$ 之间的距离会不会变小.

对于任意状态 $s$:

$\begin{aligned}
(\mathcal{T}^\pi U)(s) &= R_\pi(s) + \gamma \sum_{s'} P_\pi(s'|s) U(s') \\
(\mathcal{T}^\pi V)(s) &= R_\pi(s) + \gamma \sum_{s'} P_\pi(s'|s) V(s')
\end{aligned}$

现在计算它们差值的绝对值 (注意: $R_\pi(s)$** 是常数, 直接抵消了!**):

$\begin{aligned}
| (\mathcal{T}^\pi U)(s) - (\mathcal{T}^\pi V)(s) | &= \left| \gamma \sum_{s'} P_\pi(s'|s) U(s') - \gamma \sum_{s'} P_\pi(s'|s) V(s') \right| \\
&= \gamma \left| \sum_{s'} P_\pi(s'|s) (U(s') - V(s')) \right|
\end{aligned}$

利用绝对值不等式 (和的绝对值 $\le$ 绝对值的和), 并提取最大误差:

$\begin{aligned}
&\le \gamma \sum_{s'} P_\pi(s'|s) \cdot \underbrace{| U(s') - V(s') |}_{\text{状态 } s' \text{ 的误差}} \\
&\le \gamma \sum_{s'} P_\pi(s'|s) \cdot \underbrace{||U - V||_\infty}_{\text{最大误差 (常数)}}
\end{aligned}$

**关键一步**: 因为 $\sum_{s'} P_\pi(s'|s) = 1$ (概率之和为1), 所以上面那一坨可以直接化简:

$| (\mathcal{T}^\pi U)(s) - (\mathcal{T}^\pi V)(s) | \le \color{red}{\gamma ||U - V||_\infty}$

这对所有状态 $s$ 都成立, 所以最大差距(范数)也满足:

$\underbrace{||\mathcal{T}^\pi U - \mathcal{T}^\pi V||_\infty}_{\text{更新后的差距}} \le \color{red}{\gamma} \cdot \underbrace{||U - V||_\infty}_{\text{更新前的差距}}$

**3. 结论: Banach 不动点定理**

上面的公式说明了什么?
因为折扣因子 $\gamma < 1$ (比如 0.9), 所以:
**更新后的差距 **$\le$** 0.9 **$\times$** 更新前的差距.**

这意味着, 每迭代一次, 两个价值表之间的差异就会被“压缩”一次.

- 第 1 次: 差距变为原来的 0.9- 第 2 次: 差距变为原来的 0.81- ...- 第 100 次: 差距变为原来的 $0.9^{100} \approx 0.00002$

**Banach 不动点定理** 告诉我们:
在一个完备的空间里, 如果一个映射能让距离不断缩小 (压缩映射), 那么:

1. **唯一性**: 最终一定会收敛到唯一的那个点 (也就是真值 $V^\pi$).

2. **必然性**: 无论你初始值 $V_0$ 猜得有多离谱, 只要不停地算, 最终都会走到同一个终点.

这就是为什么强化学习中的**值迭代 (Value Iteration)** 算法是数学上可证明有效的.

(tmd 考研数学还在追我！)

## 2. 连续控制的鸿沟

从马尔可夫决策过程出发要走向现代连续控制与策略梯度方法, 关键难点在于高维连续动作空间下的优化困难与估计方差问题.

### 2.1 维度灾难与 $\max_a Q(s,a)$ 的困难性

在离散动作空间下, 计算 $\max_{a \in \mathcal{A}} Q(s,a)$ 可以通过遍历所有动作完成, 时间复杂度为 $O(|\mathcal{A}|)$. 对于动作数有限且不多的场景, 这是可行的.

然而在连续高维动作空间下, 动作 $a$ 取值于 $\mathbb{R}^d$:

- 动作空间是无穷多点的连续集合.- 在深度强化学习中, $Q(s,a)$ 往往由深度神经网络 $Q_\phi(s,a)$ 参数化, 其关于 $a$ 的函数形式高度非线性.

因此, 理想的最优动作定义为:

$a^*(s) = \arg\max_{a \in \mathbb{R}^d} Q_\phi(s,a)$

这相当于在深度神经网络图景下求解高维非凸优化问题:

$\max_{a \in \mathbb{R}^d} Q_\phi(s,a)$

我们具体分析困难性:

1. **非凸性**
即便 $Q_\phi$ 是两层 ReLU 网络, 对 $a$ 来说也已经是分段线性但整体非凸的函数. 非凸优化的全球最优求解一般是 NP 困难的, 尤其在维度 $d$ 较大时无法通过穷举或简单网格搜索实现.

2. **维数爆炸**
若尝试把连续动作空间离散化为网格来近似最大化, 假设每个维度离散为 $m$ 个点, 则总的网格数量为 $m^d$. 例如 $m=10, d=20$, 则需要评估 $10^{20}$ 个动作点, 完全不现实. 这就是经典的维度灾难.

3. **梯度的局部极值困境**
若尝试用梯度上升求解 $a^*$, 迭代关系为:

$a_{k+1} = a_k + \alpha_k \nabla_a Q_\phi(s, a_k)$

   由于 $Q_\phi$ 关于 $a$ 的优化景观可能有大量局部极大点与鞍点, 梯度方法很难保证找到全局最大值. 更严重的是, 对每一个状态 $s$ 都进行这样的内层优化, 计算开销极高.

综上, 在高维连续动作空间中直接计算或逼近 $\max_a Q(s,a)$ 是计算上极为困难的任务.

### 2.2 分布策略与重参数化技巧

为绕开直接求 $\arg\max_a Q(s,a)$ 的困难, 一个自然想法是把策略写成概率分布, 用采样而不是显式最大化来探索动作空间. 此时策略 $\pi_\theta(a|s)$ 通常选择为高斯族或其变种.

**高斯策略的形式**

假设动作空间为 $\mathbb{R}^d$, 策略网络输出均值和对角协方差:

$\pi_\theta(a|s) = \mathcal{N}(a | \mu_\theta(s), \Sigma_\theta(s))$
通常 $\Sigma_\theta(s)$ 取对角形式 
$\Sigma_\theta(s) = \mathrm{diag}(\sigma^2_{\theta,1}(s), \dots, \sigma^2_{\theta,d}(s))$
.
对应的采样过程为:

1. 采样标准正态噪声 $\epsilon \sim \mathcal{N}(0, I_d)$.2. 令 $a = \mu_\theta(s) + \sigma_\theta(s) \odot \epsilon$, 其中 $\odot$ 为逐元素乘法.

这就是著名的 reparameterization trick 的核心表达式.

**目标函数与重参数化**

考虑一个一般的期望目标:

$J(\theta) = \mathbb{E}_{s \sim d^\pi, \, a \sim \pi_\theta(\cdot|s)} [f(s,a)]$

其中 $f(s,a)$ 可以是价值函数估计 $Q_\phi(s,a)$, 或者某种对齐场景中的奖励 $r(x,y)$.

若直接对 $a \sim \pi_\theta$ 求梯度, 会遇到采样分布依赖参数的问题. 采用重参数化后, 把 $a$ 写成 $\theta$ 显式函数:

$a = g_\theta(s, \epsilon) = \mu_\theta(s) + \sigma_\theta(s) \odot \epsilon, \quad \epsilon \sim \mathcal{N}(0, I_d)$

于是目标可以改写为:

$J(\theta) = \mathbb{E}_{s \sim d^\pi, \epsilon \sim \mathcal{N}(0, I_d)} [f(s, g_\theta(s, \epsilon))]$

此时采样分布对 $\theta$ 的依赖被“推”到了确定性映射 $g_\theta$ 中, 而噪声 $\epsilon$ 的分布与 $\theta$ 无关.

因此, 在通常的可交换条件下, 可以把梯度算子与期望互换:

$\begin{aligned}
\nabla_\theta J(\theta) &= \nabla_\theta \mathbb{E}_{s, \epsilon} [f(s, g_\theta(s, \epsilon))] \\
&= \mathbb{E}_{s, \epsilon} [\nabla_\theta f(s, g_\theta(s, \epsilon))]
\end{aligned}$

利用链式法则, 有:

$\nabla_\theta f(s, g_\theta(s, \epsilon)) = \nabla_a f(s,a)|_{a=g_\theta(s, \epsilon)} \cdot \nabla_\theta g_\theta(s, \epsilon)$

代入得到:

$\nabla_\theta J(\theta) = \mathbb{E}_{s, \epsilon} [\nabla_a f(s,a)|_{a=g_\theta(s, \epsilon)} \cdot \nabla_\theta g_\theta(s, \epsilon)]$

具体到高斯策略:

$g_\theta(s, \epsilon) = \mu_\theta(s) + \sigma_\theta(s) \odot \epsilon$
.因此 
$\nabla_\theta g_\theta(s, \epsilon) = \nabla_\theta \mu_\theta(s) + \epsilon \odot \nabla_\theta \sigma_\theta(s)$
.

若 $f(s,a) = Q_\phi(s,a)$ 可微, 则:

$\nabla_\theta J(\theta) = \mathbb{E}_{s, \epsilon} \left[ \nabla_a Q_\phi(s,a)|_{a=g_\theta(s, \epsilon)} \cdot (\nabla_\theta \mu_\theta(s) + \epsilon \odot \nabla_\theta \sigma_\theta(s)) \right]$

这一表达式的优势是:

- 梯度由“路径导数”给出, 方差通常比分数函数估计小.- 采样噪声的来源与参数解耦, 适合自动微分框架.

## 3. 策略梯度的黄金时代: TRPO 到 PPO

有了连续策略与重参数化, 下一步是如何稳定高维策略的更新. TRPO 和 PPO 是这一时期最具代表性的算法.

### 3.1 TRPO: 约束优化与自然梯度

TRPO 的核心思想是: 为了避免策略更新步长过大导致性能崩塌, 我们在每一步更新中限制新旧策略之间的 **KL 散度 (Kullback-Leibler Divergence)** , 形成一个 “可信域 (Trust Region)”.

#### 3.1.1 问题建模: 替代目标与约束

设旧策略参数为 $\theta_{\text{old}}$, 待求的新策略参数为 $\theta$.

**1. 定义重要性采样比率 (Importance Sampling Ratio)** 

$\rho_\theta(s,a) = \frac{\pi_\theta(a|s)}{\pi_{\theta_{\text{old}}}(a|s)}$

**2. 替代目标函数 (Surrogate Objective)** 

我们需要最大化新策略的期望回报. 利用重要性采样, 我们可以在旧策略的分布上估算新策略的性能. 定义目标函数 $L(\theta)$:

$L(\theta) = \mathbb{E}_{\color{red}{s \sim d^{\pi_{\theta_{\text{old}}}}, a \sim \pi_{\theta_{\text{old}}}(\cdot|s)}} \left[ \rho_\theta(s,a) A_{\pi_{\theta_{\text{old}}}}(s,a) \right]$

**下标含义详解**:

- $\color{red}{s \sim d^{\pi_{\theta_{\text{old}}}}}$: 状态 $s$ 是从**旧策略**与环境交互产生的平稳分布中采样的.- $\color{red}{a \sim \pi_{\theta_{\text{old}}}(\cdot|s)}$: 动作 $a$ 是由**旧策略**在状态 $s$ 下采样的.- 这意味着我们使用的全是**旧数据 (Old Data)** 来计算梯度.

**3. 形式化约束优化问题**

TRPO 将策略更新建模为如下约束优化问题:

$\begin{aligned}
\max_\theta \quad & L(\theta) \\
\text{s.t.} \quad & \bar{D}_{\text{KL}}(\theta_{\text{old}}, \theta) \le \delta
\end{aligned}$

其中约束条件 $\bar{D}_{\text{KL}}$ 是**平均 KL 散度**:

$\bar{D}_{\text{KL}}(\theta_{\text{old}}, \theta) = \mathbb{E}_{s \sim d^{\pi_{\theta_{\text{old}}}}} \left[ D_{\text{KL}}(\pi_{\theta_{\text{old}}}(\cdot|s) \Vert \pi_\theta(\cdot|s)) \right]$

#### 3.1.2 泰勒展开: 化繁为简的艺术

直接求解上述非线性约束优化极其困难. 我们在 $\theta_{\text{old}}$ 附近进行 **泰勒级数展开 (Taylor Expansion)** .
定义参数更新量 $\Delta \theta = \theta - \theta_{\text{old}}$.

**1. 目标函数的一阶近似**
对 $L(\theta)$ 在 $\theta_{\text{old}}$ 处做一阶泰勒展开:

$L(\theta) \approx L(\theta_{\text{old}}) + \nabla_\theta L(\theta) \big|_{\theta_{\text{old}}} \cdot \Delta \theta$

由于 $L(\theta_{\text{old}})$ 是常数(不影响梯度方向), 我们只关注梯度项. 记梯度为 $\color{red}{g}$:

$g = \nabla_\theta L(\theta) \big|_{\theta_{\text{old}}}$

则目标简化为最大化: $\color{red}{g^T \Delta \theta}$.
**2. 约束条件的二阶近似**
对 $\bar{D}_{\text{KL}}$ 做二阶泰勒展开.
注意一个关键性质: KL 散度在两个分布相等时取得最小值 0. 因此, 
$D_{\text{KL}}(\theta_{\text{old}} \Vert \theta_{\text{old}}) = 0$
, 且**一阶导数也为 0**. 我们必须展开到二阶项才能捕捉到距离信息.
$\bar{D}_{\text{KL}}(\theta_{\text{old}}, \theta) \approx \underbrace{\bar{D}_{\text{KL}}(\theta_{\text{old}}, \theta_{\text{old}})}_{0} + \underbrace{\nabla \bar{D}_{\text{KL}} \big|_{\theta_{\text{old}}} \cdot \Delta \theta}_{0} + \frac{1}{2} \Delta \theta^T \color{red}{H} \Delta \theta$

其中 $\color{red}{H}$ 是平均 KL 散度的 **海森矩阵 (Hessian Matrix)** , 在信息几何中它等价于 **费雪信息矩阵 (Fisher Information Matrix, FIM)** :

$H = \nabla_\theta^2 \bar{D}_{\text{KL}}(\theta_{\text{old}}, \theta) \big|_{\theta_{\text{old}}}$

**3. 最终的二次规划问题**
经过近似, 原问题转化为一个标准的二次规划问题:

$\begin{aligned}
\max_{\Delta \theta} \quad & g^T \Delta \theta \\
\text{s.t.} \quad & \frac{1}{2} \Delta \theta^T H \Delta \theta \le \delta
\end{aligned}$

#### 3.1.3 拉格朗日乘子法求解 (Step-by-Step)

这是一个凸优化问题, 我们可以使用 **拉格朗日乘子法 (Lagrange Multipliers)** 求解解析解.

**第一步: 构造拉格朗日函数**
引入乘子 $\lambda \ge 0$ (因为是不等式约束), 构造函数 $\mathcal{L}$:

$\mathcal{L}(\Delta \theta, \lambda) = g^T \Delta \theta - \lambda \left( \frac{1}{2} \Delta \theta^T H \Delta \theta - \delta \right)$

**第二步: 求偏导并令为 0**
我们要找到最优的步长方向 $\Delta \theta$. 对 $\Delta \theta$ 求导:

$\frac{\partial \mathcal{L}}{\partial \Delta \theta} = g - \lambda \cdot \frac{1}{2} \cdot 2 H \Delta \theta = \color{red}{g - \lambda H \Delta \theta} = 0$

移项可得:

$H \Delta \theta = \frac{1}{\lambda} g$

假设 $H$ 可逆 (即正定), 我们解出更新方向:

$\color{red}{\Delta \theta = \frac{1}{\lambda} H^{-1} g}$

这告诉我们: **最优更新方向是自然梯度方向 (**$H^{-1}g$**), 只是长度受 **$\lambda$** 控制.**

**第三步: 求解 **$\lambda$
由于我们要最大化目标, 最优解一定位于约束边界上 (即 $\bar{D}_{\text{KL}} = \delta$).
将 $\Delta \theta = \frac{1}{\lambda} H^{-1} g$ 代入约束方程 $\frac{1}{2} \Delta \theta^T H \Delta \theta = \delta$:

$\frac{1}{2} \left( \frac{1}{\lambda} H^{-1} g \right)^T H \left( \frac{1}{\lambda} H^{-1} g \right) = \delta$

展开转置 (注意 $H$ 是对称矩阵, $H^T=H$, 且 $(H^{-1})^T = H^{-1}$):

$\frac{1}{2\lambda^2} \left( g^T H^{-1} \right) H \left( H^{-1} g \right) = \delta$

利用矩阵乘法结合律 $H^{-1} H = I$ (单位矩阵), 中间项抵消:

$\frac{1}{2\lambda^2} g^T H^{-1} g = \delta$

现在解出 $\lambda$:

$\lambda^2 = \frac{g^T H^{-1} g}{2\delta} \implies \color{red}{\lambda = \sqrt{\frac{g^T H^{-1} g}{2\delta}}}$

**第四步: 最终更新公式**
将求出的 $\lambda$ 代回 $\Delta \theta$ 的表达式:

$\Delta \theta^* = \frac{1}{\sqrt{\frac{g^T H^{-1} g}{2\delta}}} H^{-1} g = \color{red}{\sqrt{\frac{2\delta}{g^T H^{-1} g}} H^{-1} g}$

这就是 TRPO 的核心更新公式.

#### 3.1.4 工程挑战: 共轭梯度法 (Conjugate Gradient)

在深度学习中, 参数量 $N$ 往往在百万级以上.

1. **存储难**: 存储 $N \times N$ 的矩阵 $H$ 是不可能的.

2. **求逆难**: 计算 $H^{-1}$ 的复杂度是 $O(N^3)$.

TRPO 的解决方案是利用 **共轭梯度法 (Conjugate Gradient, CG)** .
我们不需要显式计算 $H^{-1}$, 只需要求解线性方程组 $\color{red}{Hx = g}$.
CG 算法只需要计算 **矩阵-向量乘积 (Hessian-Vector Product, Hv)** , 这可以通过对梯度再求一次导数高效实现 (Pearlmutter's trick), 从而避开了显式构建 $H$.

### 3.2 PPO: 近端策略优化 (Proximal Policy Optimization)

TRPO 虽然理论优美，但计算费雪信息矩阵的逆 (或共轭梯度) 计算代价过高，且实现极其复杂.
PPO 的核心贡献在于: 它将 TRPO 的**硬约束 (Hard Constraint)** 转化为目标函数中的**软惩罚 (Soft Penalty)** 或 **截断 (Clipping)** ，从而允许我们使用一阶优化器 (如 Adam) 进行多步更新.

#### 3.2.1 核心变量: 概率比率 (Probability Ratio)

为了衡量新策略 $\pi_\theta$ 偏离旧策略 $\pi_{\theta_{\text{old}}}$ 的程度，我们定义概率比率 $r_t(\theta)$:

$r_t(\theta) = \frac{\pi_\theta(a_t|s_t)}{\pi_{\theta_{\text{old}}}(a_t|s_t)}$

- 当 $\theta = \theta_{\text{old}}$ 时， $r_t(\theta) = 1$.- 如果 $r_t > 1$，说明新策略使得动作 $a_t$ 出现的概率增加了.- 如果 $r_t < 1$，说明新策略使得动作 $a_t$ 出现的概率减少了.

#### 3.2.2 PPO-Clip 目标函数

PPO 试图最大化以下的“截断代理目标” (Clipped Surrogate Objective):

$L^{\text{CLIP}}(\theta) = \mathbb{E}_t \left[ \min \left( \underbrace{r_t(\theta) \hat{A}_t}_{\text{原始目标}}, \quad \underbrace{\text{clip}(r_t(\theta), 1-\epsilon, 1+\epsilon) \hat{A}_t}_{\text{截断目标}} \right) \right]$

其中: 

- $\hat{A}_t$: 优势函数估计值 (Advantage).- $\epsilon$: 超参数 (通常为 0.1 或 0.2), 定义了策略更新的“安全范围”.- $\text{clip}(r, 1-\epsilon, 1+\epsilon)$: 将 $r$ 限制在 $[1-\epsilon, 1+\epsilon]$ 区间内.

#### 3.2.3 梯度截断机制的深度剖析

为什么这个 $\min$ 和 $\text{clip}$ 组合能起作用？我们需要对**优势函数的正负**进行分情况讨论，观察梯度 $\nabla_\theta L$ 何时被切断 (归零).

**情形 1: 优势为正 (**$\hat{A}_t > 0$**) —— 鼓励该动作**

当 $\hat{A}_t > 0$ 时，该动作是好的，我们希望 **增加** 其概率 (即增加 $r_t$).
此时目标函数变为: 

$\min(r_t \hat{A}_t, (1+\epsilon)\hat{A}_t)$

- **安全区内 (**$1 < r_t \le 1+\epsilon$**)** :

$L = r_t \hat{A}_t \implies \nabla_\theta L = \hat{A}_t \nabla_\theta r_t > 0$

- **解释**: 此时策略更新幅度还在允许范围内，正常进行梯度上升，提升该动作概率.

- **越界区 (**$r_t > 1+\epsilon$**)** :

$L = (1+\epsilon) \hat{A}_t \implies \nabla_\theta L = 0$

- **解释**: 新策略已经比旧策略激进太多了 (概率提升超过了 $1+\epsilon$). 为了防止过拟合或策略崩塌，我们**强制梯度为 0**，停止对该样本的进一步更新.

**情形 2: 优势为负 (**$\hat{A}_t < 0$**) —— 抑制该动作**

当 $\hat{A}_t < 0$ 时，该动作是差的，我们希望 **减少** 其概率 (即减小 $r_t$).
此时目标函数变为 (注意负数比大小时 $\min$ 的作用):

$\min(r_t \hat{A}_t, (1-\epsilon)\hat{A}_t)$

*(注: 因为 *$\hat{A}_t$* 是负数, 所以 *$(1-\epsilon)\hat{A}_t$* 其实是两个负数中较大的那个, 即绝对值较小的那个. PPO 的实际逻辑是取下界)*.

准确的逻辑是: 我们希望 $r_t$ 减小，但不要减得太猛.

- **安全区内 (**$1-\epsilon \le r_t < 1$**)** :

$L = r_t \hat{A}_t \implies \nabla_\theta L = \hat{A}_t \nabla_\theta r_t$

- **解释**: 正常更新，降低该动作概率.

- **越界区 (**$r_t < 1-\epsilon$**)** :

$L = (1-\epsilon) \hat{A}_t \implies \nabla_\theta L = 0$

- **解释**: 概率已经降得足够低了. 如果继续强行降低，可能会导致该动作的概率密度坍缩到 0 (导致 $\log \pi$ 爆炸)，破坏策略的探索性. 因此**切断梯度**.

#### 3.2.4 数学本质: 悲观下界 (Pessimistic Lower Bound)

PPO 的这种设计体现了一种 **“悲观主义 (Pessimism)”** 的哲学.

$L^{\text{CLIP}} \le L^{\text{TRPO}}$

通过取 $\min$，PPO 实际上是在优化真实目标函数的一个**下界**.

- 如果策略变化不大，我们相信一阶近似，努力提升目标.- 如果策略变化太大，我们变得“悲观”，认为一阶近似已经失效，因此不再提供梯度信号，以此保证更新的安全性.

这种**无需二阶计算**却能实现**类二阶稳定性**的特性，使 PPO 成为了当今 LLM 对齐 (RLHF) 的默认算法.

也是神奇，TRPO 提出后不温不火，作者改了一下变成 PPO，觉得提升不大干脆就放在 arxiv 上，结果效果这么好，流行到现在

## 4. 大模型对齐的变分革命: 从 RLHF 到 DPO

本章是全文核心. 我们将证明: RLHF 本质上是在解一个**受约束的泛函极值问题**. 我们将求出该问题的解析解 (Gibbs 分布)，并揭示一个困扰物理学和机器学习多年的难题——**配分函数 **$Z(x)$，最终通过代数技巧将其完美消去.

### 4.1 RLHF 的 KL 正则化目标 (严密展开)

在 RLHF 中，我们的目标是训练一个策略 $\pi$，使其最大化奖励 $r$，同时不偏离参考模型 $\pi_{\text{ref}}$ 太远. 目标函数为:

$\max_\pi J(\pi) = \mathbb{E}_{x \sim \mathcal{D}} \left[ \mathbb{E}_{y \sim \pi(\cdot|x)} [r(x,y)] - \beta D_{\text{KL}}(\pi(\cdot|x) \Vert \pi_{\text{ref}}(\cdot|x)) \right]$

为了方便求解，我们将**期望符号 **$\mathbb{E}$** 展开为求和形式**，并将 KL 散度项展开合并.

**1. 展开 KL 散度项**
根据定义 $D_{\text{KL}}(P\|Q) = \sum P \log \frac{P}{Q}$:

$D_{\text{KL}}(\pi \Vert \pi_{\text{ref}}) = \sum_y \pi(y|x) \left( \log \pi(y|x) - \log \pi_{\text{ref}}(y|x) \right)$

**2. 展开外部期望与合并**
我们将目标函数 $J(\pi)$ 写成对数据分布 $x$ 和策略分布 $y$ 的双重求和:

$\begin{aligned}\nJ(\pi) &= \sum_x p_{\mathcal{D}}(x) \Bigg[ \underbrace{\sum_y \pi(y|x) r(x,y)}_{\text{期望奖励}} - \beta \underbrace{\sum_y \pi(y|x) (\log \pi(y|x) - \log \pi_{\text{ref}}(y|x))}_{\text{KL 惩罚}} \Bigg] \\
&\text{(提取公因式 } \sum_y \pi(y|x) \text{)} \\
&= \sum_x p_{\mathcal{D}}(x) \sum_y \pi(y|x) \left[ \color{red}{r(x,y) - \beta \log \pi(y|x) + \beta \log \pi_{\text{ref}}(y|x)} \right]
\end{aligned}$

### 4.2 变分法求解: 推导最优策略 $\pi^*$

现在，我们要找到一个分布 $\pi(y|x)$ 来最大化上述目标. 这是一个**泛函极值问题**.
由于不同 $x$ 之间是独立的，我们可以针对**每一个特定的输入 **$x$ 单独求解最优分布 $\pi(\cdot|x)$.

**1. 构造拉格朗日函数**
我们需要满足概率归一化约束: $\sum_y \pi(y|x) = 1$. 引入拉格朗日乘子 $\lambda_x$:

$\mathcal{L}(\pi, \lambda) = \sum_y \pi(y|x) \left( r(x,y) - \beta \log \pi(y|x) + \beta \log \pi_{\text{ref}}(y|x) \right) + \lambda_x \left( \sum_y \pi(y|x) - 1 \right)$

**2. 变分求导 (Fréchet Derivative)** 
我们将 $\pi(y|x)$ 视为标量变量 $p_y$. 关键难点在于 $p_y \log p_y$ 的求导.
利用乘法法则 $(uv)' = u'v + uv'$:

$\frac{\partial}{\partial p_y} (p_y \log p_y) = 1 \cdot \log p_y + p_y \cdot \frac{1}{p_y} = \log p_y + 1$

对 $\pi(y|x)$ 求偏导并令为 0:

$\begin{aligned}
\frac{\partial \mathcal{L}}{\partial \pi(y|x)} &= r(x,y) - \beta \underbrace{(\log \pi(y|x) + 1)}_{\text{来自 } \pi \log \pi \text{ 的导数}} + \beta \log \pi_{\text{ref}}(y|x) + \lambda_x \\
&= 0
\end{aligned}$

*3. 求解 $\pi^**$ 的解析形式**
移项整理，将含 $\log \pi$ 的项留在左边:

$\beta \log \pi^*(y|x) = r(x,y) + \beta \log \pi_{\text{ref}}(y|x) + \lambda_x - \beta$

两边同除以 $\beta$:

$\log \pi^*(y|x) = \frac{1}{\beta} r(x,y) + \log \pi_{\text{ref}}(y|x) + \frac{\lambda_x}{\beta} - 1$

两边取指数 $\exp(\cdot)$:

$\pi^*(y|x) = \pi_{\text{ref}}(y|x) \exp\left( \frac{r(x,y)}{\beta} \right) \cdot \underbrace{\exp\left( \frac{\lambda_x}{\beta} - 1 \right)}_{\text{与 } y \text{ 无关的常数}}$

根据归一化约束 $\sum \pi^* = 1$，后面这一项必须等于归一化常数的倒数. 我们定义 **配分函数 (Partition Function)** $Z(x)$:

$Z(x) = \sum_y \pi_{\text{ref}}(y|x) \exp\left( \frac{r(x,y)}{\beta} \right)$

最终得到最优策略的 **Gibbs (Boltzmann) 分布形式**:

$\pi^*(y|x) = \frac{1}{\color{red}{Z(x)}} \pi_{\text{ref}}(y|x) \exp\left( \frac{r(x,y)}{\beta} \right)$

### 4.3 拦路虎: 为什么 $Z(x)$ 是计算的噩梦?

在经典物理和机器学习中，公式推导到这里通常就卡住了. 为什么我们不能直接用这个 $\pi^*$?

$\color{red}{Z(x) = \sum_{y \in \mathcal{V}^T} \pi_{\text{ref}}(y|x) \exp(r(x,y)/\beta)}$

- **空间爆炸**: 对于 LLM，输出空间是词表大小 $|V|$ 的序列长度 $T$ 次方. 如果 $|V|=50000, T=2048$，求和项数是 $50000^{2048}$.

- **不可计算性**: 我们无法遍历所有可能的回复 $y$ 来计算这个分母. 这意味着我们**无法直接计算** $\pi^*(y|x)$ 的具体数值.

在 DPO 之前，人们尝试过 MCMC 采样或重要性采样来估计 $Z(x)$，但效率极低. DPO 的天才之处在于: **既然算不出来，那就把它消掉.**

### 4.4 The Magic: 奖励消去法 (Reward Cancellation)

我们要利用比较数据 (pairwise data) 的差分性质来消去 $Z(x)$.

**1. 从 Gibbs 形式反解奖励函数**
对 4.2 节得出的最优解 $\pi^*$ 两边取对数:

$\log \pi^*(y|x) = \log \pi_{\text{ref}}(y|x) + \frac{r(x,y)}{\beta} - \log Z(x)$

移项，将 $r(x,y)$ 表示为策略的函数:

$\color{blue}{r(x,y) = \beta \log \frac{\pi^*(y|x)}{\pi_{\text{ref}}(y|x)} + \beta \log Z(x)}$

**2. 代入 Bradley-Terry 模型**
假设人类偏好服从 BT 模型: $P(y_w \succ y_l) = \sigma(r(x, y_w) - r(x, y_l))$.
我们需要计算两个回复的**奖励差值**. 将上面的蓝色公式代入:

$\begin{aligned}\nr(x, y_w) - r(x, y_l) &= \left[ \beta \log \frac{\pi^*(y_w|x)}{\pi_{\text{ref}}(y_w|x)} + \color{red}{\beta \log Z(x)} \right] - \left[ \beta \log \frac{\pi^*(y_l|x)}{\pi_{\text{ref}}(y_l|x)} + \color{red}{\beta \log Z(x)} \right] \\
&= \beta \log \frac{\pi^*(y_w|x)}{\pi_{\text{ref}}(y_w|x)} - \beta \log \frac{\pi^*(y_l|x)}{\pi_{\text{ref}}(y_l|x)}
\end{aligned}$

**见证奇迹**: 那个让无数科学家头秃的 $\color{red}{Z(x)}$** 在减法中直接抵消了!** 它彻底消失了! 以致于 DPO 的损失函数简洁到不可思议，一开始还以为没啥不得了的，越推越觉得作者是天才

### 4.5 DPO 最终目标函数

现在，我们将理论上的最优策略 $\pi^*$ 替换为我们正在训练的参数化网络 $\pi_\theta$.
我们将上面推导出的“奖励差值”直接代入 Sigmoid 函数，构建负对数似然损失 (Negative Log Likelihood):

$\mathcal{L}_{\text{DPO}}(\theta) = - \mathbb{E}_{(x, y_w, y_l) \sim \mathcal{D}} \left[ \log \sigma \left( \beta \log \frac{\pi_\theta(y_w|x)}{\pi_{\text{ref}}(y_w|x)} - \beta \log \frac{\pi_\theta(y_l|x)}{\pi_{\text{ref}}(y_l|x)} \right) \right]$

**直观理解**:

- 这是一场**二分类 (Binary Classification)** 游戏.- Logit 不再是神经网络直接输出的分数，而是 **“当前策略与参考策略的似然比 (Likelihood Ratio)”** 的差值.- 我们不需要显式训练一个 Reward Model (它被隐式包含在 $\pi_\theta$ 和 $\pi_{\text{ref}}$ 的比值里了).- 我们不需要 PPO 的复杂采样和 Critic 网络.

这就是 DPO 的数学本质: **通过变量代换，将一个含不可计算项 **$Z(x)$** 的 RL 问题，等价变换为一个标准的、可微的监督学习问题**

## 5. 推理时代的军备竞赛: GRPO 及其变体

随着 DeepSeek-R1 等推理模型的崛起, 传统的 PPO 和 DPO 显露出局限性. 2025 年, 一系列针对**可验证奖励 (Verifiable Reward)** 和 **MoE 架构稳定性** 的算法——GRPO, GSPO, GMPO, DAPO, BAPO——应运而生. 这一章我们将从数学本质上解析它们.

### 5.1 GRPO: 抛弃 Critic 的相对主义

#### 1. 第一步: 从策略梯度到基线 (The Baseline)

一切的起点是标准的策略梯度 (Policy Gradient). 我们要最大化期望奖励:

$$
 J(\theta) = \mathbb{E}_{q \sim P(Q), o \sim \pi_\theta(\cdot|q)} [r(q, o)] \tag{1}
$$
为了求式 (1) 的梯度，首先将期望显式地写成对所有可能输出 $o$ 的求和(或积分)形式. 注意这里只有策略 $\pi_\theta$ 包含需要优化的参数 $\theta$: 

$J(\theta) = \mathbb{E}_{q \sim P(Q)} \left[ \sum_o \pi_\theta(o|q) \cdot r(q,o) \right]$

接下来对 $\theta$ 求梯度,由于积分和微分可以交换顺序(在满足正则性条件下),我们将梯度符号 $\nabla_\theta$ 移入求和号内部,只作用于依赖 $\theta$ 的 $\pi_\theta$ 项: 

$\nabla_\theta J(\theta) = \mathbb{E}_{q \sim P(Q)} \left[ \sum_o \nabla_\theta \pi_\theta(o|q) \cdot r(q,o) \right]$
这里使用一个关键的**对数导数技巧 (Log-Derivative Trick)** : 利用恒等式 
$\nabla f(x) = f(x) \frac{\nabla f(x)}{f(x)} = f(x) \nabla \log f(x)$
,我们将 $\nabla_\theta \pi_\theta$ 重写: 
$\nabla_\theta \pi_\theta(o|q) = \pi_\theta(o|q) \cdot \frac{\nabla_\theta \pi_\theta(o|q)}{\pi_\theta(o|q)} = \pi_\theta(o|q) \cdot \nabla_\theta \log \pi_\theta(o|q)$

将这个变换代回原来的梯度公式中,你会发现 $\pi_\theta(o|q)$ 再次出现,充当了概率权重的角色: 

$\nabla_\theta J(\theta) = \mathbb{E}_{q \sim P(Q)} \left[ \sum_o \pi_\theta(o|q) \left( \nabla_\theta \log \pi_\theta(o|q) \cdot r(q,o) \right) \right]$

最后,根据期望的定义,$\sum_o \pi_\theta(o|q) (\dots)$ 等价于在分布 $o \sim \pi_\theta$ 下求期望,因此可以将求和号简写回期望符号 $\mathbb{E}$: 

$\nabla_\theta J(\theta) = \mathbb{E}_{q \sim P(Q), o \sim \pi_\theta(\cdot|q)} \left[ \nabla_\theta \log \pi_\theta(o|q) \cdot r(q,o) \right]$

为了降低方差 (Variance Reduction),我们引入一个**基线函数 (Baseline Function)** $b(q)$.只要 $b(q)$ 只依赖于输入 $q$ 而不依赖于具体的输出 $o$,梯度的期望就不会改变(无偏性).

**数学证明(基线无偏性): **

$\begin{aligned}
\mathbb{E}_{o \sim \pi} [ b(q) \nabla_\theta \log \pi_\theta(o|q) ] &= \sum_o \pi_\theta(o|q) \cdot b(q) \cdot \frac{\nabla_\theta \pi_\theta(o|q)}{\pi_\theta(o|q)} \\
&= b(q) \sum_o \nabla_\theta \pi_\theta(o|q) \\
&= b(q) \nabla_\theta \left( \sum_o \pi_\theta(o|q) \right) \\
&= b(q) \nabla_\theta (1) = 0
\end{aligned}$

因此,带有基线的梯度公式为: 

$\nabla_\theta J(\theta) = \mathbb{E} \left[ \nabla_\theta \log \pi_\theta(o|q) \cdot (r(q, o) - b(q)) \right]$

这里的 $r(q, o) - b(q)$ 就是广义的**优势函数 (Advantage)** $A(q, o)$.

在 PPO 中,我们训练一个 Critic 网络 $V_\phi(q)$ 来拟合 $b(q)$(即状态价值 $\mathbb{E}[r|q]$).**GRPO 的核心就是: 我不想要这个 Critic 网络了,我怎么得到 **$b(q)$**？**

#### 2. 第二步: 群组采样与蒙特卡洛近似

GRPO 提出: 既然 $b(q)$ 的理想值是当前输入 $q$ 下的期望回报 $\mathbb{E}_{o \sim \pi}[r(q, o)]$,那我们为什么不直接**当场采样**一组数据来算出这个期望呢？

**操作步骤: **
对于同一个输入问题 $q$,我们从旧策略 $\pi_{\theta_{old}}$ 中采样一组(Group)输出,大小为 $G$: 

$\text{Group} = \{o_1, o_2, \dots, o_G\}$

对应的一组奖励为: 

$\{r_1, r_2, \dots, r_G\}$

**推导基线估计量: **
利用这组样本,我们可以用**样本均值**来作为基线 $b(q)$ 的无偏估计: 

$b(q) \approx \bar{r} = \frac{1}{G} \sum_{j=1}^G r_j$

将这个估计代入优势函数: 

$\hat{A}(o_i) = r_i - \bar{r}$

这就意味着: 如果样本 $i$ 的得分比这一组的平均分高,它的优势就是正的;反之则是负的.这就是 **"Group Relative" (群组相对)** 的数学含义.

#### 3. 第三步: 优势标准化 (Advantage Normalization)

仅仅使用 $r_i - \bar{r}$ 在数值上是不稳定的,因为不同问题 $q$ 的奖励尺度可能不同.为了稳定训练(类似于 Batch Normalization),GRPO 进一步对优势进行了标准化.

计算组内标准差: 

$\sigma = \sqrt{\frac{1}{G-1} \sum_{j=1}^G (r_j - \bar{r})^2 + \epsilon}$

*(注: 分母通常用 G 或 G-1,DeepSeek 实现中包含平滑项 *$\epsilon$*)*

最终的 GRPO 优势函数形式: 

$A_i = \frac{r_i - \bar{r}}{\sigma}$

#### 4. 最终目标函数 (结合 PPO Clip)

有了估计出的优势 $A_i$,GRPO 并没有发明新的 Loss 形式,而是直接复用了 PPO 极其成熟的 Clipping 机制,并加上了 KL 散度正则项(防止偏离参考模型).

**GRPO 完整目标函数: **

$\mathcal{L}_{\text{GRPO}}(\theta) = \frac{1}{G} \sum_{i=1}^G \left( \underbrace{\min \left( \frac{\pi_\theta(o_i|q)}{\pi_{old}(o_i|q)} A_i, \text{clip}\left(\frac{\pi_\theta(o_i|q)}{\pi_{old}(o_i|q)}, 1-\epsilon, 1+\epsilon\right) A_i \right)}_{\text{PPO Clipped Loss}} - \beta \underbrace{D_{KL}(\pi_\theta(o_i|q) || \pi_{\text{ref}}(o_i|q))}_{\text{KL Regularization}} \right)$

#### 总结: GRPO 是怎么"省"出来的？

1. **PPO (Standard)** :

$A(s,a) = r + \gamma V_\phi(s') - V_\phi(s)$

1. **推导代价**: 需要训练一个参数量巨大的 $V_\phi$ 网络,显存占用翻倍.

2. **GRPO**:

$A(o_i) = \frac{r_i - \text{Mean}(\{r_{1..G}\})}{\text{Std}(\{r_{1..G}\})}$

1. **推导代价**: 不需要 $V_\phi$.代价转移到了 Inference 阶段(需要采样 $G$ 个样本),但这对于推理模型(如 DeepSeek-R1)来说是天然符合的,因为强化学习探索本身就需要多采样.

**本质上,GRPO 是用 "采样的宽度" (Group Size) 换取了 "训练的空间" (No Critic Model).**

### 5.2 GSPO: 序列级重要性采样与 MoE 的救赎

Qwen 团队提出的 GSPO 并非简单的“更换公式”, 它是对 PPO 中被长期忽视的**数学近似误差**的一次清算.

#### 5.2.1 Token-Level PPO 的原罪: 独立性假设的谬误

在标准的 PPO (以及 GRPO) 中, 我们实际上是在优化以下目标函数的变体:

$J_{\text{Token}}(\theta) = \mathbb{E}_{\tau \sim \pi_{\text{old}}} \left[ \sum_{t=1}^T \frac{\pi_\theta(a_t|s_t)}{\pi_{\text{old}}(a_t|s_t)} A_t \right]$

请仔细观察这个式子. 它隐含了一个极其强烈的假设: **每个 Token 的贡献是独立的**.
然而, 在推理任务 (Reasoning) 中, 奖励 $R$ 是稀疏的 (Sparse), 通常只有在序列结束生成的 `</s>` 时才能获得. 此时 $A_t$ 对于整个序列通常是一个常数 (即整道题的得分).

这就导致了一个数学上的悖论:
如果序列中某一个无关紧要的 Token (例如连词 "the") 的概率发生了微小剧变 (例如 $\rho_t \to 10$), 在 Token-Level PPO 中, 即使整个序列的逻辑是错误的, 这个 Token 也会产生巨大的梯度回传, 强行更新策略. 这被称为 **Token-Level Variance Explosion**.

#### 5.2.2 序列级比率的严密推导

为了纠正这一偏差, 我们必须回归强化学习的本源——**轨迹优化 (Trajectory Optimization)** .
我们的目标是最大化轨迹 $\tau = (s_0, a_0, \dots, s_T, a_T)$ 的期望回报:

$J(\theta) = \mathbb{E}_{\tau \sim \pi_\theta} [R(\tau)] = \sum_\tau \pi_\theta(\tau) R(\tau)$

利用重要性采样 (Importance Sampling), 我们引入旧策略 $\pi_{\text{old}}$:

$J(\theta) = \mathbb{E}_{\tau \sim \pi_{\text{old}}} \left[ \frac{\pi_\theta(\tau)}{\pi_{\text{old}}(\tau)} R(\tau) \right]$

根据马尔可夫链的链式法则, 轨迹概率分解为:

$\pi_\theta(\tau) = P(s_0) \prod_{t=0}^T \pi_\theta(a_t|s_t) P(s_{t+1}|s_t, a_t)$

环境动力学 $P(s'|s,a)$ 与策略无关, 因此在比率中消去. 我们得到严格的**序列级比率 (Sequence-level Ratio)** :

$\rho_{\text{seq}}(\tau) = \frac{\pi_\theta(\tau)}{\pi_{\text{old}}(\tau)} = \prod_{t=0}^T \frac{\pi_\theta(a_t|s_t)}{\pi_{\text{old}}(a_t|s_t)} = \prod_{t=0}^T \rho_t$

这就是 GSPO 核心公式的数学来源. 它表明: **只有当整个序列生成的概率提升时, 我们才应该增加该序列的权重.**

#### 5.2.3 GSPO 的数值稳定性处理

数学上 $\prod \rho_t$ 虽美, 但在工程上是噩梦. 假设序列长度 $L=1000$, 即使每个 $\rho_t = 1.01$, 连乘积也会达到 $1.01^{1000} \approx 20959$, 导致梯度立刻爆炸.

因此, GSPO 的实际实现必须包含两个关键修正:

1. **对数空间的计算**: 这里的乘积转化为对数求和.

$\log \rho_{\text{seq}} = \sum_{t=0}^T (\log \pi_\theta(a_t|s_t) - \log \pi_{\text{old}}(a_t|s_t))$

1. **极其严格的 Clipping**: GSPO 必须在序列级别进行 Clip, 而不是 Token 级别.

$\mathcal{L}_{\text{GSPO}} = \mathbb{E}_{\tau \sim \pi_{\text{old}}} \left[ \min \left( \rho_{\text{seq}} A, \text{clip}(\rho_{\text{seq}}, 1-\epsilon, 1+\epsilon) A \right) \right]$

注意: 这里的 $\epsilon$ 通常比 Token-PPO 设置得要大, 但由于 $\rho_{\text{seq}}$ 的方差极大, Clip 操作被触发的频率远高于普通 PPO. 这实际上起到了一种**强正则化**的作用: **它无视了序列内部个别 Token 的剧烈波动, 仅关注整体生成逻辑的合理性.**

#### 5.2.4 为什么它是 MoE 的救星?

这解释了为什么 GSPO 对 MoE (Mixture of Experts) 模型至关重要.

在 MoE 中, 某些 Token 负责触发 Router 选择特定的专家.

- **Token-Level PPO**: 可能会因为某个 Expert 的偶然高分, 使得 Router 在该 Token 处的 $\rho_t$ 剧烈增加, 导致 Router "坍塌" (Collapse) 到单一专家, 丧失多样性.

- **GSPO**: 哪怕 Router 在某一步做出了“惊世骇俗”的选择 (导致该步 $\rho_t$ 很大), 只要最终整个序列的 $\rho_{\text{seq}}$ 被 Clip 住了, 梯度就不会失控.

**结论**: GSPO 通过将重要性采样的粒度从 Token 提升到 Sequence, 在数学上消除了由于长序列累积误差导致的方差爆炸, 它是大模型迈向 Long-Chain Reasoning 的必经之路.

### 5.3 GMPO: 几何平均的稳健性与重尾分布的驯服

**Geometric-Mean Policy Optimization (GMPO)** 的提出,并非单纯为了“换个平均数算法”,而是针对大语言模型 (LLM) 训练中一个极其险恶的数学现象——**重尾分布下的方差爆炸**.如果说 GSPO 解决了序列独立性假设的谬误,那么 GMPO 则是为了解决**高维空间中重要性采样的方差崩溃**问题.

#### 5.3.1 算术平均的陷阱: "离群值的暴政"

在 GRPO 或某些变体中,如果我们试图聚合序列中所有 Token 的重要性比率 $\rho_t = \frac{\pi(a_t|s_t)}{\pi_{\text{old}}(a_t|s_t)}$,最直观的方法是计算算术平均 (Arithmetic Mean, AM):

$\rho_{\text{AM}} = \frac{1}{L} \sum_{t=1}^L \rho_t$

这个看似人畜无害的公式在 LLM 语境下隐藏着巨大的危机.
由于词表大小 $|V| \approx 100,000$,在训练初期,$\pi_{\text{old}}(a_t|s_t)$ 可能极小 (例如 $10^{-7}$).如果新策略 $\pi$ 稍微“运气好”一点,采样到了该 Token 并赋予了较高概率 (例如 $10^{-3}$),那么该 Token 的比率 $\rho_t$ 将瞬间达到 $10,000$.

在算术平均中,**一个巨大的离群值 (Outlier) 会彻底主导整个和式**.

$\text{If } \rho_{outlier} = 10000, \text{ and others } \approx 1 \implies \rho_{\text{AM}} \approx \frac{10000}{L}$

这意味着,哪怕整个序列生成的逻辑是一团糟 (其他 $\rho_t < 1$),只要有一个 Token 发生了概率突增,整个序列就会被判定为“极其优秀”并产生巨大的梯度.这被称为 **"The Tyranny of the Outlier" (离群值的暴政)** .

#### 5.3.2 几何平均的数学性质: 对数空间的线性化

GMPO 提出使用**几何平均 (Geometric Mean, GM)** 来聚合 Token 级的比率: 

$\rho_{\text{geom}} = \left( \prod_{t=1}^L \rho_t \right)^{1/L}$

这不仅仅是取个根号那么简单.我们在对数空间审视它,其本质豁然开朗: 

$\log \rho_{\text{geom}} = \log \left( \prod_{t=1}^L \rho_t \right)^{1/L} = \frac{1}{L} \sum_{t=1}^L \log \rho_t$

这里发生了两件在数学上极其重要的事情: 

1. **线性化增长**: 对于那个 $\rho_t = 10,000$ 的离群值,算术平均中它贡献了 $10,000$,而在几何平均中,它仅贡献了 $\log(10,000) \approx 9.2$.**几何平均将指数级的爆发压缩为了线性增长,极大地抑制了方差.**2. **序列长度归一化**: 与 GSPO 的累积积 $\prod \rho_t$ 不同,GMPO 通过 $1/L$ 指数进行了**长度归一化**.这意味着 $\rho_{\text{geom}}$ 代表的是 **"平均每个 Token 的概率提升倍数"**,这使得不同长度的序列 (Long vs Short Reasoning Chains) 在优化时具有了可比性.

#### 5.3.3 重尾分布 (Heavy-Tailed Distribution) 理论

从统计学角度看,重要性采样权重 $w = \frac{P(x)}{Q(x)}$ 往往服从**重尾分布**.
当目标分布 $P$ 的尾部比建议分布 $Q$ 更重时,权重的二阶矩(方差)可能是无穷大: $\text{Var}[w] \to \infty$.

根据 **大数定律 (Law of Large Numbers)** ,算术平均收敛到期望的前提是方差有限.当方差无限或极大时,算术平均值的收敛速度极慢,且极其不稳定.

GMPO 的数学优越性在于它实际上是在估计 $\mathbb{E}[\log \rho]$ 而非 $\mathbb{E}[\rho]$.由于 $\log \rho$ 的尾部远比 $\rho$ 轻,因此几何平均估计量具有更快的收敛速度和更稳健的置信区间.这符合 **Robust Statistics (稳健统计学)** 的核心思想.

#### 5.3.4 均值不等式提供的保守下界

根据著名的 **AM-GM 不等式 (均值不等式)** :

$\frac{1}{L} \sum \rho_t \ge \left( \prod \rho_t \right)^{1/L}$

即 $\rho_{\text{AM}} \ge \rho_{\text{GM}}$.
这意味着,使用 GMPO 实际上是在优化真实目标的一个**下界 (Lower Bound)** .

在强化学习中,**Pessimism (悲观主义)** 往往是美德(参考 CQL 算法).

- 如果 GMPO 认为这个序列好 ($\rho_{\text{geom}} > 1$),那么它**一定**是真的好.- 如果 AMPO 认为这个序列好 ($\rho_{\text{arith}} > 1$),它可能是真的好,也可能只是因为踩中了一个概率极小的离群点.

因此,GMPO 在数学上天然构成了一个**保守策略更新 (Conservative Policy Update)** 机制,它要求策略在**每一个** Token 上都有稳健的表现,而不是寄希望于个别 Token 的投机取巧.

#### 5.3.5 GMPO 目标函数与梯度

最终,GMPO 的目标函数被形式化为: 

$\mathcal{L}_{\text{GMPO}} = \mathbb{E} \left[ \min(\rho_{\text{geom}} A, \text{clip}(\rho_{\text{geom}}, 1-\epsilon, 1+\epsilon) A) \right]$

其梯度回传具有优美的物理意义: 

$\nabla_\theta \log \rho_{\text{geom}} = \frac{1}{L} \sum_{t=1}^L \nabla_\theta \log \pi_\theta(a_t|s_t)$

这意味着 GMPO 将序列的总奖励 $A$ **均匀地 (Uniformly)** 分配到了每一个 Token 的对数概率梯度上,而不是根据每个 Token 当前的 $\rho_t$ 大小进行加权.这彻底消除了 "Outlier Tokens" 对梯度的支配权,确保了长思维链 (Long CoT) 训练的平稳进行.

这是包含 ByteDance 与 Fudan 最新研究成果的 **DAPO** 与 **BAPO** 章节补完版本.这一部分的数学推导将聚焦于 2025 年强化学习中两个最关键的问题: **熵崩塌 (Entropy Collapse)** 与 **异策略梯度的分布失衡 (Off-Policy Distribution Shift)** .

### 5.4 GFPO: 简洁性的数学约束与过滤机制

**Group Filtered Policy Optimization (GFPO)** 由华为诺亚方舟实验室与腾讯 AI Lab 于 2025 年联合提出,论文标题 *《Sample More to Think Less》* 直击要害.该算法旨在解决思维链 (CoT) 中的 **"Verbosity Bias" (冗长偏差)** ——即模型倾向于生成冗长且无效的推理步骤来“骗取”奖励.这一算法的数学美感在于它如何通过简单的集合操作,解决了强化学习中极其棘手的**多目标优化 (Multi-objective Optimization)** 问题——即在保证准确率的同时极度压缩推理成本.

#### 5.4.1 多目标优化的困境: 准确率 vs. 长度

在标准 RLHF 中,我们通常简单地在奖励函数中加入长度惩罚: 

$R(x, y) = \mathbb{I}(y \text{ is correct}) - \lambda \cdot \text{Length}(y)$

这是一个数学上极其脆弱的线性组合.

- 若 $\lambda$ 过小,模型无视长度惩罚,继续啰嗦.- 若 $\lambda$ 过大,模型为了缩短长度,会直接跳过关键推理步骤,导致准确率 ($Acc$) 崩塌.
要在连续的 $\lambda$ 空间中寻找帕累托最优 (Pareto Optimal) 是极其困难的.

#### 5.4.2 组过滤机制 (Group Filtering Mechanism)

GFPO 放弃了显式的 $\lambda$ 惩罚项,转而使用**基于排序的过滤算子 (Sorting-based Filtering Operator)** .

对于输入 $x$,我们从旧策略 $\pi_{\text{old}}$ 中采样一组输出 $\mathcal{G} = \{y_1, y_2, \dots, y_G\}$.
定义**正确集 (Correct Set)** 为所有答案正确的轨迹集合: 

$\mathcal{S}_{\text{correct}} = \{ y_i \in \mathcal{G} \mid \text{Answer}(y_i) = \text{True} \}$

如果 $\mathcal{S}_{\text{correct}}$ 为空,则退化为标准探索.
如果 $\mathcal{S}_{\text{correct}}$ 非空,我们在该集合内寻找**最短**的轨迹作为正样本 (Winner),其余作为负样本 (Loser) 或仅用于基线计算: 

$y^* = \operatorname*{arg\,min}_{y \in \mathcal{S}_{\text{correct}}} \text{Length}(y)$

#### 5.4.3 目标函数的数学本质: 条件概率转移

GFPO 的优化目标不再是最大化所有正确路径的概率,而是最大化**最短正确路径**的概率.
我们在数学上将其形式化为在条件分布下的似然最大化.

定义过滤后的目标分布 $P_{\text{target}}$: 

$P_{\text{target}}(y|x) \propto \begin{cases} 
1, & \text{if } y = y^* \\
0, & \text{otherwise}
\end{cases}$

GFPO 的损失函数可以写为带有**自适应权重**的策略梯度: 

$\mathcal{L}_{\text{GFPO}} = -\mathbb{E}_{x} \left[ \sum_{y_i \in \mathcal{G}} w_i \log \pi_\theta(y_i|x) \right]$

其中权重 $w_i$ 由过滤逻辑决定: 

$w_i = \begin{cases} 
1, & \text{if } y_i = y^* \text{ (Correct \& Shortest)} \\
0, & \text{otherwise}
\end{cases}$

或者更平滑的 DPO 形式,将 $y^*$ 视为 Winner $y_w$,将 $\mathcal{S}_{\text{correct}}$ 中较长的轨迹视为 Loser $y_l$: 

$\mathcal{L}_{\text{GFPO-DPO}} = - \log \sigma \left( \beta \log \frac{\pi(y^*|x)}{\pi_{\text{ref}}(y^*|x)} - \beta \log \frac{\pi(y_{\text{long}}|x)}{\pi_{\text{ref}}(y_{\text{long}}|x)} \right)$

#### 5.4.4 梯度流形分析: 为什么能 "Think Less"?

让我们分析这个梯度的物理意义.
在标准 RL 中,所有正确的轨迹都会产生正向梯度 $\nabla \log \pi(y_{correct})$.这会导致概率密度函数 (PDF) 在所有正确路径上变得平坦 (Flat).

而在 GFPO 中,梯度实际上是: 

$\nabla J \approx \nabla \log \pi(y_{\text{short}}) - \nabla \log \pi(y_{\text{long}})$

这在概率流形 (Probability Manifold) 上产生了一个**推力**,将概率质量 (Probability Mass) 从“正确但冗长”的区域强行挤压到“正确且简洁”的区域.
数学上,这等价于寻找推理任务的**最小充分统计量 (Minimal Sufficient Statistic)** .模型被迫学会只输出对最终答案有贡献的 Token,从而实现了 "Sample More (to find the shortest path) to Think Less (during inference)".

### 5.5 DAPO: 解耦裁剪与动态采样的工程美学

**Decoupled Clip and Dynamic Sampling Policy Optimization (DAPO)** 由 ByteDance Seed 联合清华 AIR 在 2025 年提出.它并非单一的算法改进,而是一套针对大规模 Reasoning 模型的**系统级数学修正**.其核心在于解决了 PPO 在训练后期面临的“熵崩塌”问题.

#### 5.5.1 熵崩塌与 PPO 的对称性缺陷

标准 PPO 的 Clip 机制假设了正负偏离的对称性: 

$\text{clip}(\rho_t, 1-\epsilon, 1+\epsilon)$

然而,DAPO 团队观察到一个致命现象: 在 Reasoning 任务中,模型往往会过早收敛到某些特定的“答题套路”,导致策略熵 (Entropy) 急剧下降.
数学上,这意味着 $\pi_\theta$ 在某些高分路径上的概率密度过度集中.而 PPO 严格的 $1+\epsilon$ 上界限制了策略在探索新高分路径时的更新步幅,反而在 $A < 0$ 时通过 $1-\epsilon$ 迅速打压低分路径.这种**不对称的更新动力学**导致了探索能力的丧失.

#### 5.5.2 Decoupled Clip (非对称解耦裁剪)

DAPO 提出打破对称性,引入**非对称裁剪区间**.具体而言,对于正优势样本 ($A > 0$),放宽上界约束,允许模型在高回报区域进行更激进的探索;而对于负优势样本,保持严格约束以维持稳定性.

$\mathcal{L}_{\text{CLIP}} = \begin{cases} 
\min(\rho_t A_t, \text{clip}(\rho_t, 1-\epsilon, 1+\epsilon_{\text{high}}) A_t), & \text{if } A_t > 0 \\
\min(\rho_t A_t, \text{clip}(\rho_t, 1-\epsilon, 1+\epsilon) A_t), & \text{if } A_t \le 0
\end{cases}$

其中 $\epsilon_{\text{high}} > \epsilon$ (例如 $\epsilon=0.1, \epsilon_{\text{high}}=0.2$).
**数学本质**: 这实际上是在 Trust Region 中引入了**方向性偏置 (Directional Bias)** ,即: **我们容忍策略向“好”的方向偏离得更远,但严厉禁止向“坏”的方向偏离.** 这直接对抗了熵崩塌,迫使策略保持多样性.

#### 5.5.3 动态采样 (Dynamic Sampling)

在大规模 RL 中,大量的样本要么是极其简单的 (Reward=1),要么是完全错误的 (Reward=0).这些样本产生的梯度方差极大且信息量极低.DAPO 引入了基于样本难度的动态滤波器: 

$\mathcal{D}_{\text{eff}} = \{ (q, o) \in \mathcal{D} \mid 0 < \mathbb{E}[r(q,o)] < 1 \}$

在数学上,这等价于在梯度估计中引入一个指示函数 $\mathbb{I}(\cdot)$,剔除了梯度贡献为 0 或 噪声极大的样本,使得优化器始终工作在**决策边界 (Decision Boundary)** 附近,极大提升了样本效率.

---

### 5.6 BAPO: 自适应平衡与异策略的救赎

**Balanced Policy Optimization (BAPO)** 由复旦大学团队在论文 *《Stabilizing Off-Policy Reinforcement Learning for LLMs via Balanced Policy Optimization with Adaptive Clipping》* 中提出.它直指 Off-Policy RL (即使用过时数据训练) 中的核心痛点——**正负样本的梯度失衡**.

#### 5.6.1 异策略下的梯度失衡定理

在 Off-Policy 设置下,我们使用旧策略 $\pi_{\text{old}}$ 产生的数据更新新策略 $\pi_\theta$.随着训练进行,$\pi_\theta$ 与 $\pi_{\text{old}}$ 的分布差异 $D_{KL}(\pi_\theta || \pi_{\text{old}})$ 逐渐增大.

BAPO 的理论分析指出: 
当策略发生漂移时,重要性采样比率 $\rho_t$ 的分布会发生偏斜.特别是,**负优势样本 (**$A < 0$**) 往往占据主导地位**,且其梯度更容易穿透 Clipping 边界.这导致模型在训练中主要是在“学习不该做什么” (Suppression),而不是“学习该做什么” (Exploration).这种**否定式学习**极易导致策略退化.

#### 5.6.2 自适应裁剪 (Adaptive Clipping)

为了平衡正负样本的贡献,BAPO 抛弃了固定的 $\epsilon$,提出了**自适应裁剪边界**.其核心思想是根据当前策略与行为策略的距离,动态调整裁剪阈值.

定义自适应系数 $\alpha$,BAPO 的目标函数修正为: 

$\mathcal{L}_{\text{BAPO}} = \mathbb{E} \left[ \min(\rho_t A_t, \text{clip}(\rho_t, 1-\epsilon(\rho), 1+\epsilon(\rho)) A_t) \right]$

这里的 $\epsilon(\rho)$ 不再是常数,而是 $\rho$ 分布统计量的函数.更精妙的是,BAPO 通过理论推导出了一个**熵保持裁剪规则 (Entropy-Preserving Clip Rule)** : 

$\epsilon_{\text{adaptive}} \propto \frac{\mathbb{E}_{\rho \sim \pi_{\text{old}}} [A^+]}{\mathbb{E}_{\rho \sim \pi_{\text{old}}} [|A^-|]}$

**数学本质**: 
BAPO 实际上是在执行一种**梯度的重加权 (Gradient Re-weighting)** .

- 当负样本梯度过大时,自动收缩负区间的 Clip 范围,限制其破坏力.- 当正样本稀疏时,自动扩张正区间的 Clip 范围,放大其探索信号.

这一机制在数学上保证了 $\mathbb{E}[\nabla J]$ 的方向始终沿着**熵增**与**奖励最大化**的合力方向,从而在 Off-Policy 数据及其陈旧的情况下,依然能稳定地微调大模型.

### 5.7 Dr.GRPO: 统计偏差的数学修正

在 DeepSeek-R1 的复现研究 *《Understanding R1-Zero-Like Training》* 中，研究者发现原始 GRPO 的优势函数存在两个致命的统计学偏差: **难度偏差 (Difficulty Bias)** 与 **长度偏差 (Length Bias)** . **Dr.GRPO** 对此进行了极简却深刻的修正. 

#### 5.7.1 标准差归一化的陷阱

原始 GRPO 定义优势为 $A_i = \frac{r_i - \bar{r}}{\sigma}$. 
从统计学角度看，标准化是为了让不同 Scale 的奖励具有可比性. 然而，在推理任务中，这引入了**难度偏差**: 

- **全对/全错场景 (Low Variance)** : 当题目极难(全错)或极易(全对)时，组内分数的标准差 $\sigma \to 0$. - 此时，微小的随机扰动会导致 $A_i$ 趋向无穷大(数值爆炸)，或者在 $\epsilon$ 平滑下，导致简单题和困难题产生的梯度幅度相同. 

**数学修正**: Dr.GRPO 证明了在 RL 语境下，**去除分母**是更优的无偏估计: 

$A_i^{\text{Dr}} = r_i - \bar{r}$

这恢复了奖励的绝对物理意义: 做对一道难题($\bar{r}$ 低，优势大)应当比做对一道送分题($\bar{r}$ 高，优势小)提供更强的梯度信号. 

#### 5.7.2 长度归一化的去偏

在原始实现中，Token 级梯度的累加往往除以序列长度 $L$ 进行归一化. 这在数学上导致了**长度偏差**: 

$\nabla J \propto \frac{1}{L} \sum \nabla \log \pi$

模型发现，只要生成更长的序列，$L$ 变大，梯度惩罚就被稀释. 这导致模型倾向于生成“废话”来逃避惩罚. Dr.GRPO 移除了这一归一化项(或改为除以固定常数)，迫使模型直面每个 Token 的梯度贡献. 

---

### 5.8 GSPO-Token: 粒度的辩证统一

在 5.2 节中我们推导了序列级 GSPO. 然而，完全忽略 Token 级的细粒度信息有时过于激进. 阿里巴巴团队提出了 **GSPO-token**，试图在序列稳定性与 Token 灵活性之间寻找数学上的平衡. 

#### 5.8.1 混合优势流形

标准 GSPO 将整个序列视为一个整体，分配同一个优势 $A_{\text{seq}}$. 
GSPO-token 允许优势函数在序列内部发生变化，但在梯度加权时引入序列级约束: 

$\nabla J_{\text{GSPO-token}} = \mathbb{E} \left[ \sum_{t=1}^T \left( \frac{\pi_\theta(\tau)}{\pi_{\text{old}}(\tau)} \right) A(s_t, a_t) \nabla_\theta \log \pi_\theta(a_t|s_t) \right]$

请注意其中的精妙之处: 

- **权重项** $\frac{\pi_\theta(\tau)}{\pi_{\text{old}}(\tau)}$ 是**序列级**的比率(GSPO 的核心)，保证了 MoE 路由的稳定性. 

- **优势项** $A(s_t, a_t)$ 和梯度项是 **Token 级**的，保留了对局部语法和逻辑的微调能力. 

这在数学上构建了一个**受约束的梯度流形**: 模型可以在 Token 级别进行微操，但其整体更新方向必须服从序列整体概率提升的大局. 

## 6. 结语: 熵减、流形与智能的数学本质

回顾这万字长文,我们走过了一条从朴素到精巧,再由繁入简的数学朝圣之路.

起初,我们面对的是 $\mathbb{E}[G_t]$ 这一原始的期望定义,它在贝尔曼方程的迭代中显得步履蹒跚.为了驯服高维空间中狂暴的梯度方差,一代代算法应运而生,它们不仅是工程上的补丁,更是数学思想在不同维度的投影: 

- **PPO** 是**控制理论**的胜利,它用截断机制模拟了信赖域,解决了策略更新的**步长稳定性**问题.

- **DPO** 是**变分法**的奇迹,它通过解析解消去了配分函数 $Z(x)$,证明了最优策略与奖励函数在数学上的**对偶性**.

- **GRPO/GSPO/GMPO** 是**稳健统计学**的复兴,它们分别从群论均值、序列独立性和几何不等式的角度,解决了长思维链推理中的**方差爆炸与重尾分布**问题.

- **GFPO** 是**奥卡姆剃刀**的体现,它通过寻找最小充分统计量,在概率流形上挤压冗余信息,实现了**准确率与简洁性的帕累托最优**.

- **DAPO/BAPO** 则是**热力学**的防线,它们通过非对称裁剪与自适应平衡,对抗训练后期的**熵崩塌 (Entropy Collapse)** ,维持了系统的探索热度.

这不仅仅是一部算法演进史,更是一部**数学家与高维空间维数灾难 (Curse of Dimensionality) 的搏斗史**.

我们看到,所有的努力最终都指向了同一个方向: **如何在保持分布多样性 (Entropy) 的同时,以最小的样本代价 (Sample Efficiency),将策略网络引导至奖励流形的全局极大值点.**

未来的 LLM 对齐算法,界限将更加模糊.训练 (Training) 与推理 (Inference) 将在数学上统一,我们或许会看到基于**能量模型 (Energy-based Models)** 的统一框架,或是基于**微分博弈 (Differential Games)** 的多智能体对齐.

但无论形式如何变化,请永远记住: 虽然代码库会更新,架构会迭代,但支撑这一切的**不动点定理、琴生不等式、泰勒展开与贝叶斯法则**,是永恒不变的真理.

**数学,才是智能的通用语言.**