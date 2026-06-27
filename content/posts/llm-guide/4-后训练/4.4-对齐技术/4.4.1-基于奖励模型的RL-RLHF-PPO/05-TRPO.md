---
title: "TRPO: 信任域策略优化深度解析"
date: 2026-05-11
tags: []
---

# 05 TRPO: 信任域策略优化深度解析


## 1. 第一性原理: 策略改进的数学保证

要设计一个能稳定提升策略的算法, 首先需要一个能够量化“提升”的数学工具. TRPO的理论基石是一个精确描述新旧策略性能差异的恒等式.

### 1.1 关键恒等式: 新旧策略的性能差异

假设旧策略为 $\pi$, 新策略为 $\tilde{\pi}$. 它们各自的期望折扣回报(性能)为 $\eta(\pi)$ 和 $\eta(\tilde{\pi})$. 在2002年, Sham Kakade等人证明了两者之间存在如下美妙关系:

$\eta(\tilde{\pi}) = \eta(\pi) + \mathbb{E}_{\tau \sim \tilde{\pi}} \left[ \sum_{t=0}^{\infty} \gamma^t A_{\pi}(s_t, a_t) \right]$

这个公式是TRPO推导的起点. 它告诉我们, 新策略的性能等于旧策略的性能, 加上一项修正值. 这个修正值是在**新策略** $\tilde{\pi}$ 的轨迹分布下, 对**旧策略** $\pi$ 的优势函数的期望总和.

### 1.2 辅助概念: 优势函数 (Advantage Function)

公式中的 $A_{\pi}(s, a)$ 被称为**优势函数**, 其定义为:

$A_{\pi}(s, a) = Q_{\pi}(s, a) - V_{\pi}(s)$

- $Q_{\pi}(s, a)$: 在状态 $s$ 执行动作 $a$, 然后继续遵循策略 $\pi$ 所能获得的期望回报.- $V_{\pi}(s)$: 在状态 $s$, 遵循策略 $\pi$ 所能获得的平均期望回报.

**直观理解**: 优势函数 $A_{\pi}(s, a)$ 回答了这样一个问题: “在状态 $s$ 下, 选择动作 $a$ 相比于所有可能动作的平均水平, 到底好多少?”

- **视觉化描述**: 想象在状态 $s$ 处有一个岔路口, 每个动作 $a$ 是一条分支路径. $V_{\pi}(s)$ 就像是这个岔路口所有分支路径价值的“平均分”. 而 $Q_{\pi}(s, a)$ 则是某一条特定分支路径的“得分”. $A_{\pi}(s, a)$ 就是这条路的得分与平均分的差值. 如果 $A_{\pi}(s, a) > 0$, 说明选择动作 $a$ 是一个优于平均的选择.

### 1.3 理论上的单调改进
回到关键恒等式, 我们可以看到, 只要我们能找到一个新策略 $\tilde{\pi}$, 使得 
$\mathbb{E}_{\tau \sim \tilde{\pi}} [ \sum_{t=0}^{\infty} \gamma^t A_{\pi}(s_t, a_t) ] \ge 0$
, 就能保证 $\eta(\tilde{\pi}) \ge \eta(\pi)$. 这意味着我们找到了一个保证策略性能单调不减的路径.
然而, 这里的期望是基于**新策略** $\tilde{\pi}$ 进行采样的, 而 $\tilde{\pi}$ 正是我们要求解的未知量. 这形成了一个“先有鸡还是先有蛋”的困境, 使得直接优化这个目标变得不可行.

## 2. 从理论到实践: 构造可优化的替代目标

为了打破上述困境, TRPO引入了一系列精妙的近似, 构建了一个易于处理的**替代目标函数**(Surrogate Objective).

### 2.1 第一个近似: 状态访问分布的简化

公式中最棘手的部分是状态访问频率 $\rho_{\tilde{\pi}}(s)$ 依赖于新策略. TRPO做了一个大胆但关键的简化: **用旧策略的状态访问频率 **$\rho_{\pi}(s)$** 来代替新策略的**.

于是, 我们得到一个近似的目标函数, 称为替代目标 $L_{\pi}(\tilde{\pi})$:

$L_{\pi}(\tilde{\pi}) = \eta(\pi) + \sum_s \rho_{\pi}(s) \sum_a \tilde{\pi}(a|s) A_{\pi}(s, a)$

这个近似在 $\tilde{\pi}$ 与 $\pi$ 非常接近时是合理的, 这也预示了后续引入“信任域”的必要性.

### 2.2 第二个近似: 重要性采样

现在, 替代目标 $L_{\pi}(\tilde{\pi})$ 仍然需要根据新策略 $\tilde{\pi}(a|s)$ 来选择动作, 这依然无法直接计算. 这里, 我们引入**重要性采样**(Importance Sampling)技巧.
**辅助概念: 重要性采样**: 如果我们想计算函数 $f(x)$在分布 $p(x)$下的期望 $\mathbb{E}_{x \sim p}[f(x)]$, 但我们只有从另一个分布 $q(x)$ 中采样的样本 $x_i$, 我们可以通过如下方式进行估计: 
$\mathbb{E}_{x \sim p}[f(x)] = \mathbb{E}_{x \sim q}[\frac{p(x)}{q(x)}f(x)]$
. 这里的 $\frac{p(x)}{q(x)}$ 称为重要性权重.
我们将这个技巧应用到替代目标中, 将动作的采样分布从新策略 $\tilde{\pi}$ 切换到旧策略 $\pi$:

$\sum_a \tilde{\pi}(a|s) A_{\pi}(s, a) = \mathbb{E}_{a \sim \pi(\cdot|s)} \left[ \frac{\tilde{\pi}(a|s)}{\pi(a|s)} A_{\pi}(s, a) \right]$

### 2.3 最终的替代目标函数

结合以上两个近似, 我们可以将替代目标函数写成一个完全可以用**旧策略** $\pi$ 采样的数据来估计的形式. 令 $\pi = \pi_{\theta_{old}}$ 和 $\tilde{\pi} = \pi_{\theta}$, 我们要最大化的目标是:

$L_{\theta_{old}}(\theta) = \mathbb{E}_{s \sim \rho_{\theta_{old}}, a \sim \pi_{\theta_{old}}} \left[ \frac{\pi_{\theta}(a|s)}{\pi_{\theta_{old}}(a|s)} A_{\theta_{old}}(s, a) \right]$

### 2.4 理论联系: 为什么这个近似有效?

虽然 $L_{\theta_{old}}(\theta)$ 是对真实性能提升的一个近似, 但它具有一个至关重要的性质: 在 $\theta = \theta_{old}$ 这个点, 它的梯度与真实性能目标 $\eta(\pi_{\theta})$ 的梯度是完全相同的.

$\nabla_{\theta} L_{\theta_{old}}(\theta)|_{\theta=\theta_{old}} = \nabla_{\theta} \eta(\pi_{\theta})|_{\theta=\theta_{old}}$

这意味着, 在 $\theta_{old}$ 的一个极小邻域内, 沿着 $L$ 的梯度方向更新, 就等同于沿着真实性能的梯度方向更新. 这为我们使用 $L$ 作为优化目标提供了理论依据.

**引导性问题**: 我们现在有了一个可以在旧数据上计算的替代目标. 但我们如何保证, 在最大化这个替代目标时, 我们不会因为步子迈得太大, 导致近似失效, 反而使真实性能下降呢? 这就是“信任域”将要解决的问题.

## 3. 信任域约束: 为策略更新套上“缰绳”

为了防止策略更新过大导致近似失效, TRPO引入了对新旧策略差异的约束.

### 3.1 辅助概念: KL 散度

TRPO选择**KL散度**(Kullback-Leibler Divergence)来衡量两个策略(概率分布)之间的差异. $D_{KL}(\pi || \tilde{\pi})$ 度量了用策略 $\tilde{\pi}$ 来近似策略 $\pi$ 时所损失的信息量. 关键在于, 它是一种非对称的“距离”度量, 并且当两个策略相同时, KL散度为0.

### 3.2 性能下界与单调改进的保证

Schulman等人在TRPO论文中证明了一个更为关键的不等式, 它为真实性能 $\eta$ 提供了一个下界(Lower Bound):

$\eta(\tilde{\pi}) \ge L_{\pi}(\tilde{\pi}) - C \cdot D_{KL}^{\max}(\pi, \tilde{\pi})$

其中 $C$ 是一个常数, $D_{KL}^{\max}$ 是在所有状态 $s$ 上新旧策略KL散度的最大值. 这个不等式是TRPO算法的理论核心.
让我们定义下界 
$M(\tilde{\pi}) = L_{\pi}(\tilde{\pi}) - C \cdot D_{KL}^{\max}(\pi, \tilde{\pi})$
.
- 在更新点, $\eta(\pi) = L_{\pi}(\pi)$ 且 $D_{KL}^{\max}(\pi, \pi)=0$, 所以 $\eta(\pi) = M(\pi)$.- 对于任何新策略 $\tilde{\pi}$, 真实性能的提升量 $\eta(\tilde{\pi}) - \eta(\pi)$ 满足:

$\eta(\tilde{\pi}) - \eta(\pi) \ge M(\tilde{\pi}) - M(\pi)$

这意味着, 只要我们能找到一个新策略 $\tilde{\pi}$ 使得下界 $M$ 得到提升, 那么真实性能 $\eta$ 也必定得到提升. 这就实现了**单调策略改进**.

### 3.3 最终的优化问题

直接最大化 $M(\tilde{\pi})$ 因为惩罚项 $C$ 的存在会导致更新步长过小. TRPO将其转化为一个带约束的优化问题, 这更符合其“信任域”的直观思想. 经过一些简化(例如用平均KL散度代替最大KL散度), 最终的优化问题形式化为:

$\begin{aligned}
\underset{\theta}{\text{maximize}} \quad & L_{\theta_{old}}(\theta) = \mathbb{E}_{s,a \sim \pi_{\theta_{old}}} \left[ \frac{\pi_{\theta}(a|s)}{\pi_{\theta_{old}}(a|s)} A_{\theta_{old}}(s, a) \right] \\
\text{subject to} \quad & \bar{D}_{KL}(\pi_{\theta_{old}}, \pi_{\theta}) = \mathbb{E}_{s \sim \pi_{\theta_{old}}} \left[ D_{KL}(\pi_{\theta_{old}}(\cdot|s) || \pi_{\theta}(\cdot|s)) \right] \le \delta
\end{aligned}$

这里的 $\delta$ 是一个超参数, 定义了信任域的大小. 这个问题可以解读为: 在与旧策略的平均KL距离不超过 $\delta$ 的前提下, 最大化我们的替代目标.

## 4. 求解优化问题: 共轭梯度法与线性搜索

直接求解上述带非线性约束的优化问题是困难的. TRPO通过泰勒展开将其近似为一个更容易求解的形式.

### 4.1 问题简化: 泰勒展开与二次近似

对**目标函数** $L_{\theta_{old}}(\theta)$ 在 $\theta_{old}$ 处进行**一阶**泰勒展开:

$L_{\theta_{old}}(\theta) \approx L_{\theta_{old}}(\theta_{old}) + g^T (\theta - \theta_{old})$
, 其中 $g$ 是目标函数在 $\theta_{old}$ 处的梯度.对**约束条件** $\bar{D}_{KL}$ 在 $\theta_{old}$ 处进行**二阶**泰勒展开:

$\bar{D}_{KL}(\pi_{\theta_{old}}, \pi_{\theta}) \approx \frac{1}{2} (\theta - \theta_{old})^T H (\theta - \theta_{old})$
, 其中 $H$ 是KL散度在 $\theta_{old}$ 处的**黑塞矩阵(Hessian Matrix)** . 在此场景下, $H$ 也被称为**费雪信息矩阵(Fisher Information Matrix, FIM)** .

近似后的优化问题变为:

$\begin{aligned}
\underset{\theta}{\text{maximize}} \quad & g^T (\theta - \theta_{old}) \\
\text{subject to} \quad & \frac{1}{2} (\theta - \theta_{old})^T H (\theta - \theta_{old}) \le \delta
\end{aligned}$

这个问题的解具有解析形式: $\theta - \theta_{old} \propto H^{-1}g$. 更新方向是 $H^{-1}g$, 步长由约束 $\delta$ 决定.

### 4.2 核心算法: 共轭梯度法 (Conjugate Gradient)

对于深度神经网络, 参数量 $\theta$ 巨大, 直接计算并求逆黑塞矩阵 $H$ (一个维度为 n_params * n_params 的矩阵) 在计算和存储上都是不可行的.

TRPO的精髓在于使用**共轭梯度法 (Conjugate Gradient, CG)** 来回避这个问题. CG是一种迭代算法, 它可以高效地求解形如 $Hx=g$ 的线性方程组, 而**无需显式地计算或存储** $H$. 它只需要我们能够计算**黑塞-向量积 (Hessian-vector product)** , 即 $Hv$, 这可以通过两次反向传播高效求得, 其计算复杂度远低于求逆.

**视觉化描述**: 想象一个狭长的山谷. 普通梯度下降法会在山谷两侧来回震荡, 缓慢地向谷底移动. 共轭梯度法则不同, 它迈出的每一步都与之前的步在某种意义上“正交”(共轭), 确保不会“抵消”之前的进展. 这使得它能够更直接、高效地沿着谷底找到最小值. 在TRPO中, CG帮助我们找到了最佳的更新方向 $x = H^{-1}g$.

### 4.3 安全保障: 线性搜索 (Line Search)

由于泰勒展开本身是近似, 通过CG计算出的更新步长可能并不能严格满足KL约束, 或不能保证替代目标的提升. 因此, TRPO在最后增加了一个**线性搜索**步骤.

它会从计算出的理论最大步长开始, 不断按比例 $\alpha \in (0, 1)$ 缩小步长 (例如 $\theta_{new} = \theta_{old} + \alpha^i \cdot \text{step}$), 直到找到一个新策略 $\pi_{\theta_{new}}$ 同时满足以下两个条件:

真实KL散度 
$\bar{D}_{KL}(\pi_{\theta_{old}}, \pi_{\theta_{new}}) \le \delta$
.替代目标得到提升 
$L_{\theta_{old}}(\theta_{new}) > L_{\theta_{old}}(\theta_{old})$
.

这个回退步骤是保证算法稳定性的最后一道防线.

## 5. 实践中的关键组件

### 5.1 广义优势估计 (GAE)

为了在实践中估计优势函数 $A(s,a)$, 我们需要估计值函数 $V(s)$. 这通常由一个被称为**Critic**的神经网络完成. 由于Critic的估计存在误差, 这会给优势估计带来偏差和方差.

**广义优势估计(Generalized Advantage Estimation, GAE)** 提供了一种在偏差和方差之间进行权衡的优雅方法. 它引入了一个参数 $\lambda \in [0, 1]$:

$A_t^{GAE(\gamma, \lambda)} = \sum_{l=0}^{\infty} (\gamma\lambda)^l \delta_{t+l}$

其中 $\delta_t = r_t + \gamma V(s_{t+1}) - V(s_t)$ 是时序差分误差(TD-error).

- 当 $\lambda=0$ 时, $A_t = \delta_t$, 这是单步TD估计, 偏差低但方差高.- 当 $\lambda=1$ 时, $A_t$ 等价于用蒙特卡洛方法估计回报再减去基线, 偏差高但方差低.

通过选择合适的 $\lambda$ (如0.95), GAE可以在两者之间取得很好的平衡, 显著提升了算法的性能和稳定性.

### 5.2 网络架构: Actor-Critic 的实现

TRPO通常采用Actor-Critic架构:

- **Actor (策略网络)** : 即 PolicyNet, 输入状态 $s$, 输出动作的概率分布 $\pi(\cdot|s)$. TRPO的核心优化正是针对这个网络.

- **Critic (价值网络)** : 即 ValueNet, 输入状态 $s$, 输出该状态的价值估计 $V(s)$. 它不参与TRPO的约束优化, 仅用于计算优势函数. 通常使用简单的均方误差损失进行监督学习更新.

## 6. 代码实现全解析

以下是TRPO算法在CartPole-v0环境下的Python实现, 代码经过整理和注释, 将理论与实践紧密联系.

### 6.1 整体框架: 训练流程概览

TRPO是一种**On-Policy**算法, 其训练循环如下:

1. **数据采样**: 使用当前策略 agent.actor 与环境交互, 收集一个或多个完整的轨迹(episode), 存入 transition_dict.

2. **优势计算**: 使用收集到的数据和 agent.critic 网络, 计算每个时间步的TD-error, 然后通过GAE计算优势函数 advantage.

3. **策略更新**: 调用 agent.update() 方法, 使用收集到的状态、动作、优势等信息, 执行TRPO的核心更新逻辑 (CG + Line Search).

4. **循环**: 重复以上步骤.

### 6.2 核心类: TRPO

## 7. 参考文献 (References)

- Schulman, J., Levine, S., Abbeel, P., Jordan, M. I., & Bartlett, P. (2015). Trust Region Policy Optimization. In *International conference on machine learning (ICML)*.- Kakade, S., & Langford, J. (2002). Approximately optimal approximate reinforcement learning. In *ICML*.- 原始材料中提供的知乎文章、博客及笔记链接.
