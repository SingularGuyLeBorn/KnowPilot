# 第6章: 演员-评论家算法 (Actor-Critic)

**前置知识**: 
- 策略梯度 (PG) / REINFORCE (第3章)
- 贝尔曼方程 (第1章)
- 时间差分学习 (Temporal Difference Learning, TD)

---

## 0. 本章摘要

REINFORCE算法虽然直观且易于实现，但通过蒙特卡洛采样计算的回报 $G_t$ 具有极高的方差. 这导致训练不稳定且采样效率低下. 

**Actor-Critic (AC)** 架构通过引入一个**评论家 (Critic)** 网络来估计价值函数 $V(s)$，并用它来指导**演员 (Actor)** 网络的更新. 这种方法结合了策略梯度(Policy Gradient)和价值迭代(Value Iteration)的优点: 

1.  **降低方差**: 使用贝尔曼方程引入的**自举 (Bootstrapping)** 机制，显著减小了梯度估计的方差. 
2.  **引入偏差**: 作为代价，Critic的估计引入了偏差，但这通常是可以接受的权衡. 
3.  **在线学习**: 不需要等到Episode结束(如REINFORCE)，可以进行单步更新. 

本章将深入探讨AC架构的数学原理、优势函数 (Advantage Function) 的多种估计形式(如GAE)，以及A2C (Advantage Actor-Critic) 的实现细节. 

---

## 1. 从REINFORCE到Actor-Critic

### 1.1 回顾REINFORCE的痛点

在REINFORCE中，我们最大化目标函数: 

$$ J(\theta) = \mathbb{E}_{\tau \sim \pi_\theta} [R(\tau)] $$

其梯度为: 

$$ \nabla_\theta J(\theta) = \mathbb{E}_{t} [ \nabla_\theta \log \pi_\theta(a_t|s_t) \cdot G_t ] $$

其中 $G_t = \sum_{k=0}^\infty \gamma^k r_{t+k}$ 是从 $t$ 时刻开始的**实际累积回报**. 

**痛点**: $G_t$ 对路径极其敏感. 如果环境本身是随机的(例如在这个状态采取同一个动作，有时得100分，有时得-10分)，或者策略本身是随机的，那么 $G_t$ 的波动会非常大. 为了获得准确的梯度估计，我们需要采样成千上万条轨迹来平均掉这些噪声. 

### 1.2 引入基线 (Baseline)

为了降低方差，我们可以引入一个基线 $b(s_t)$: 

$$ \nabla_\theta J(\theta) = \mathbb{E}_{t} [ \nabla_\theta \log \pi_\theta(a_t|s_t) \cdot (G_t - b(s_t)) ] $$

只要 $b(s_t)$ 不依赖于动作 $a_t$，这个梯度就是无偏的(我们在第3章已经证明过). 
最优的基线通常接近于状态价值 $V^\pi(s_t)$. 

### 1.3 评论家登场

如果我们将 $G_t$ 替换为一个**学习到的函数**，会发生什么？
我们定义一个参数为 $\phi$ 的神经网络 $V_\phi(s)$ 来拟合状态价值 $V^\pi(s)$. 

这时，我们可以用 $Q^\pi(s_t, a_t)$ 的估计值来替代 $G_t$. 
根据贝尔曼方程: 
$$ Q^\pi(s_t, a_t) = \mathbb{E} [r_t + \gamma V^\pi(s_{t+1}) ] $$

那么，梯度更新中的 $(G_t - b(s_t))$ 变为: 
$$ \text{Target} - \text{Baseline} = (r_t + \gamma V_\phi(s_{t+1})) - V_\phi(s_t) $$

这个量正是**TD误差 (TD Error)** ，通常记为 $\delta_t$. 这也是**优势函数 (Advantage Function)** 的一种估计: 

$$ A(s_t, a_t) \approx r_t + \gamma V(s_{t+1}) - V(s_t) $$

**Actor-Critic的核心思想**: 
- **Critic**: 负责学习 $V_\phi(s)$，目标是最小化TD误差的平方 (或其他Value Loss). 
- **Actor**: 负责学习 $\pi_\theta(a|s)$，沿着Critic指出的优势方向更新，最大化 $A(s, a)$. 

---

## 2. 偏差-方差权衡 (Bias-Variance Tradeoff)

这是理解RL算法设计的核心视角. 

### 2.1 蒙特卡洛 (MC) vs. 时间差分 (TD)

| 方法 | 目标值 (Target) | 偏差 (Bias) | 方差 (Variance) | 依赖模型? |
|------|-----------------|-------------|-----------------|-----------|
| **MC (REINFORCE)** | $G_t$ (真实回报) | **无** (无偏) | **极高** (受整条路径随机性影响) | 否 |
| **TD (Actor-Critic)** | $r_t + \gamma V(s_{t+1})$ | **有** (因为$V$是估计值) | **低** (只受单步随机性影响) | 否 (Model-Free) |

- **REINFORCE**: "即使我这次运气好走了一条路拿了高分，我也要诚实地告诉策略这个动作好，哪怕平均来看它不好. " (High Variance)
- **Actor-Critic**: "我有了一个对未来的估计 $V$. 这次拿了 $r_t$，如果 $r_t + \gamma V_{next} > V_{curr}$，说明比预期好，我就鼓励这个动作. " (Low Variance, Biased if $V$ is wrong)

### 2.2 多步自举 (n-step Bootstrapping)

为了平衡偏差和方差，我们可以不仅仅看一步，而是看 $n$ 步: 

- **1-step**: $G_t^{(1)} = r_t + \gamma V(s_{t+1})$ (低方差，高偏差)
- **2-step**: $G_t^{(2)} = r_t + \gamma r_{t+1} + \gamma^2 V(s_{t+2})$
- ...
- **$\infty$-step**: $G_t^{(\infty)} = G_t$ (MC) (高方差，低偏差)

我们可以混合使用这些目标. 这引出了**Generalized Advantage Estimation (GAE)** . 

---

## 3. 广义优势估计 (GAE)

**论文**: "High-Dimensional Continuous Control Using Generalized Advantage Estimation" (Schulman et al., 2015)

GAE 是现代Policy Gradient算法(PPO, TRPO)的标配. 它通过加权平均不同步数的TD误差，巧妙地在偏差和方差之间取得平衡. 

定义 $k$ 步的TD误差: 
$$ \delta_t = r_t + \gamma V(s_{t+1}) - V(s_t) $$

注意: 
$$ A^{(1)}_t = \delta_t $$
$$ A^{(2)}_t = \delta_t + \gamma \delta_{t+1} $$
$$ A^{(k)}_t = \sum_{l=0}^{k-1} \gamma^l \delta_{t+l} $$

GAE定义为所有这些 $k$-step 优势的指数加权平均: 

$$ A^{GAE(\gamma, \lambda)}_t = (1-\lambda) (A^{(1)}_t + \lambda A^{(2)}_t + \lambda^2 A^{(3)}_t + ...) $$

利用几何级数求和公式，可以简化为: 

$$ A^{GAE(\gamma, \lambda)}_t = \sum_{l=0}^\infty (\gamma \lambda)^l \delta_{t+l} $$

**参数 $\lambda$ 的作用**: 
- $\lambda = 0$: $A_t = \delta_t = r_t + \gamma V_{t+1} - V_t$ (即普通的Actor-Critic，偏差大，方差小)
- $\lambda = 1$: $A_t = \sum \gamma^l \delta_{t+l} = G_t - V_t$ (接近REINFORCE基线法，偏差小，方差大)
-通常取 $\lambda = 0.95$. 

**递归计算公式**(代码实现关键): 
由于 $A_t = \delta_t + \gamma \lambda A_{t+1}$，我们可以从后往前递归计算GAE，非常高效. 

```python
last_gae = 0
advantages = []
for t in reversed(range(len(rewards))):
    delta = rewards[t] + gamma * values[t+1] * mask[t] - values[t]
    gae = delta + gamma * lambda * mask[t] * last_gae
    advantages.insert(0, gae)
    last_gae = gae
```

---

## 4. A2C vs A3C

DeepMind在2016年提出了 **A3C (Asynchronous Advantage Actor-Critic)** ，随后OpenAI证明了同步版本 **A2C (Advantage Actor-Critic)** 同样有效甚至更好利用GPU. 

### 4.1 A3C架构

- **异步 (Asynchronous)** : 多个Worker在CPU的多个线程中并行与多个环境交互. 
- **参数更新**: 每个Worker计算出梯度后，异步地推送到全局参数服务器 (Parameter Server)，并拉取最新参数. 
- **优点**: 打破了训练数据的相关性(即使没有Replay Buffer)，适合CPU集群. 
- **缺点**: 难以利用GPU的大Batch并行能力; 异步更新导致梯度过时 (Stale Gradients). 

### 4.2 A2C架构

- **同步 (Synchronous)** : 多个Environmental Workers并行采样，等待所有人都采集完一批数据. 
- **批处理**: 将所有数据拼成一个大Batch，送入GPU进行一次前向和反向传播. 
- **优点**: 极高地利用了GPU并行计算能力; 梯度更新确定性，收敛更稳. 
- **现状**: 在单机多卡或单卡训练中，A2C已完全取代A3C. PPO通常也是建立在A2C式的向量化环境之上的. 

---

## 5. 损失函数推导

Actor-Critic的总体损失函数通常由三部分组成: 

$$ L_{total} = L_{policy} + c_1 L_{value} - c_2 L_{entropy} $$

### 5.1 策略损失 (Actor)

$$ L_{policy} = - \frac{1}{N} \sum_{i=1}^N \log \pi_\theta(a_i|s_i) \cdot \hat{A}_i $$

其中 $\hat{A}_i$ 是 detach 过的优势值(不传梯度给 Critic). 

### 5.2 价值损失 (Critic)

Critic的预测 $V_\phi(s_t)$ 应接近真实的回报目标(通常使用 $R_t = A_t + V_{old}(s_t)$ 或 $\lambda$-return). 

$$ L_{value} = \frac{1}{N} \sum_{i=1}^N (V_\phi(s_i) - R_i)^2 $$

这是一个回归问题，使用MSE Loss. 

### 5.3 熵正则化 (Entropy Bonus)

为了鼓励探索，防止策略过早收敛到局部最优(deterministically choosing suboptimal actions)，我们加上策略分布的熵: 

$$ H(\pi(\cdot|s_t)) = - \sum_a \pi(a|s_t) \log \pi(a|s_t) $$

我们在损失函数中**减去**熵(因为我们希望**最大化**熵，而优化器通常是**最小化**损失). 

---

## 6. 数学证明: 为什么减去基线不改变梯度期望？

这是一个非常重要的性质，也是AC成立的基础. 

我们要证明: 
$$ \mathbb{E}_{a \sim \pi} [ \nabla_\theta \log \pi_\theta(a|s) \cdot b(s) ] = 0 $$

证明: 
$$
\begin{aligned}
\text{LHS} &= \int \pi_\theta(a|s) \cdot \frac{\nabla_\theta \pi_\theta(a|s)}{\pi_\theta(a|s)} \cdot b(s) \, da \\
&= \int \nabla_\theta \pi_\theta(a|s) \cdot b(s) \, da \\
&= b(s) \int \nabla_\theta \pi_\theta(a|s) \, da \\
&= b(s) \nabla_\theta \int \pi_\theta(a|s) \, da \\
&= b(s) \nabla_\theta (1) \\
&= 0
\end{aligned}
$$

**结论**: 只要基线 $b(s)$ 只与状态有关而与动作无直接关系，它就不会引入偏差，只会改变方差. 

这也解释了为什么我们可以用 $V(s)$ 作为基线. 如果我们用 $Q(s, a)$ 作为基线，就会引入偏差(这就变成了Q-learning的变体). 

---

## 7. 常见问题 (FAQ)

### Q1: Critic是否一定要是一个独立的网络？
不一定. 在深度学习中，Actor和Critic通常共享大部分卷积层/Transformer层作为特征提取器 (Backbone)，只在最后分叉出两个头 (Policy Head 和 Value Head). 
- **优点**: 特征共享，训练效率高. 
- **缺点**: 两个任务 (Policy和Value) 的梯度可能会相互干扰. 有时需要精细调节 $c_1$ 权重. 

### Q2: 为什么A2C比DQN更适合连续动作空间？
DQN虽然也可以用连续变体(如NAF)，但其核心基于 $\max_a Q(s,a)$，这在连续空间很难求. 
AC架构直接输出 $\mu(s), \sigma(s)$，天然支持采样连续动作，因此在机器人控制任务中占主导地位. 

### Q3: Off-policy Acotr-Critic?
本章讨论的A2C是 On-policy 的(因为我们用 $\log \pi(a|s)$). 
如果想做 Off-policy，可以使用 **DDPG (Deep Deterministic Policy Gradient)** 或 **SAC (Soft Actor-Critic)** ，它们使用 Replay Buffer. 

---

## 8. 算法伪代码 (A2C Style)

```text
Initialize params theta, phi
Initialize vectorized environments E

Loop forever:
    # 1. Collect Data
    Reset gradients d_theta = 0, d_phi = 0
    Storage = []
    
    For t = 0 to n_steps:
        Get states S_t from all envs
        Run Policy: pi, v = Network(S_t)
        Sample actions A_t ~ pi
        Step Envs: S_{t+1}, R_t, Done
        Store (S_t, A_t, R_t, Done, v)
        
    # 2. Compute Returns / Advantages
    Get last value v_next = Network(S_{n+1})
    Calculate GAE for each trajectory using v_next
    
    # 3. Update Network
    Flatten the batch (n_steps * n_envs)
    
    Loss_Policy = -mean(log_pi(a|s) * Advantage)
    Loss_Value = mse(V(s), Return)
    Loss_Entropy = -mean(Entropy(pi))
    
    Loss = Loss_Policy + 0.5 * Loss_Value - 0.01 * Loss_Entropy
    
    Optimize(Loss)
```

---

## 9. 扩展阅读

- **DDPG**: 确定性策略梯度的Actor-Critic，适合连续控制. 
- **SAC**:最大熵强化学习，当前最强的Model-Free连续控制算法之一. 
- **IMPALA**: DeepMind提出的更先进的分布式AC架构，使用V-trace修正Off-policy偏差. 

本章的Actor-Critic是通往PPO(第5章)的必经之路. 理解了GAE和Advantage的概念，你就能轻松理解PPO是如何在此基础上通过限制更新步长来进一步稳定训练的. 
