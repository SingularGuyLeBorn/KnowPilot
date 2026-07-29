# REINFORCE: 从公式到代码的实现指南

本文档解释如何将第1节(理论推导)中的数学公式转化为第2节的Python代码，以及在工程实现中需要注意的优化技巧. 

---

## 1. 公式与代码的对应关系

### 1.1 策略函数 $\pi_\theta(a|s)$

**理论公式**: 

对于离散动作空间，常用Softmax策略: 
$$\pi_\theta(a|s) = \frac{\exp(h_\theta(s, a))}{\sum_{a'} \exp(h_\theta(s, a'))}$$

其中 $h_\theta(s, a)$ 是对状态-动作对的偏好分数(logits). 

**代码实现**(见 `02_Implementation.py` 第65-100行): 

```python
class PolicyNetwork(nn.Module):
    def __init__(self, state_dim, action_dim, hidden_size=128):
        super().__init__()
        self.fc1 = nn.Linear(state_dim, hidden_size)
        self.fc2 = nn.Linear(hidden_size, action_dim)
    
    def forward(self, state):
        # h_θ(s, a) 的计算
        x = F.relu(self.fc1(state))
        logits = self.fc2(x)  # 未归一化的分数
        
        # Softmax: exp(logits) / Σexp(logits)
        action_probs = F.softmax(logits, dim=-1)
        return action_probs
```

**对应关系**: 
| 公式符号 | 代码变量 | 说明 |
|----------|----------|------|
| $s$ | `state` | 输入状态 |
| $h_\theta(s, a)$ | `logits` | 神经网络输出的原始分数 |
| $\pi_\theta(a\|s)$ | `action_probs` | Softmax后的概率分布 |
| $\theta$ | `self.fc1.weight`, `self.fc2.weight`, ... | 所有网络参数 |

### 1.2 动作采样 $a \sim \pi_\theta(\cdot|s)$

**理论**: 根据概率分布采样动作

**代码实现**: 

```python
def select_action(self, state):
    action_probs = self.forward(state_tensor)
    
    # 创建Categorical分布对象
    dist = Categorical(action_probs)
    
    # 从分布中采样
    action = dist.sample()  # 对应 a ~ π_θ(·|s)
    
    # 同时计算 log π_θ(a|s)，用于后续梯度
    log_prob = dist.log_prob(action)
    
    return action.item(), log_prob
```

**关键点**: 
- `Categorical(probs)` 创建离散概率分布
- `dist.sample()` 进行采样
- `dist.log_prob(action)` 计算对数概率，避免后续重复计算

### 1.3 回报计算 $G_t$

**理论公式**: 
$$G_t = \sum_{k=0}^{T-t-1} \gamma^k r_{t+k+1} = r_{t+1} + \gamma G_{t+1}$$

**代码实现**(见第140-165行): 

```python
def compute_returns(rewards, gamma):
    T = len(rewards)
    returns = [0.0] * T
    
    # 边界条件: 最后一步
    returns[T-1] = rewards[T-1]
    
    # 从后往前递归
    for t in range(T-2, -1, -1):
        returns[t] = rewards[t] + gamma * returns[t+1]
    
    return returns
```

**为什么从后往前？**
- 公式 $G_t = r_{t+1} + \gamma G_{t+1}$ 表明 $G_t$ 依赖于 $G_{t+1}$
- 因此必须先知道 $G_{T-1}$，才能计算 $G_{T-2}$，依此类推
- 复杂度: $O(T)$，比从前往后的 $O(T^2)$ 高效得多

### 1.4 策略梯度损失

**理论公式**(最大化目标): 
$$J(\theta) = \sum_t \log \pi_\theta(a_t|s_t) \cdot G_t$$

**PyTorch损失**(最小化): 
$$\text{Loss} = -J(\theta) = -\sum_t \log \pi_\theta(a_t|s_t) \cdot G_t$$

**代码实现**: 

```python
def compute_policy_loss(log_probs, returns):
    log_probs_tensor = torch.stack(log_probs)
    
    # 负号是关键！
    # PyTorch做梯度下降(最小化loss)
    # 我们要最大化 J，所以 loss = -J
    policy_loss = -(log_probs_tensor * returns).sum()
    
    return policy_loss
```

**常见错误**: 
- 忘记负号 → 策略会越来越差
- 用 `.mean()` 而不是 `.sum()` → 数学上等价，但学习率需要调整

---

## 2. 工程优化技巧

### 2.1 回报标准化

**问题**: 如果所有回报都是正数(如 CartPole 的奖励)，那么所有动作的概率都会增大，只是程度不同. 

**解决方案**: 标准化回报

```python
def normalize_returns(returns):
    returns_tensor = torch.FloatTensor(returns)
    mean = returns_tensor.mean()
    std = returns_tensor.std()
    normalized = (returns_tensor - mean) / (std + 1e-8)
    return normalized
```

**效果**: 
- 约一半的回报变为正，一半变为负
- 好于平均的动作被正强化，差于平均的被负强化
- 显著降低方差，加速收敛

### 2.2 梯度裁剪

**问题**: 高方差的回报可能导致梯度爆炸

**解决方案**: 

```python
# 在 loss.backward() 之后，optimizer.step() 之前
torch.nn.utils.clip_grad_norm_(policy.parameters(), max_norm=1.0)
```

### 2.3 学习率调度

**问题**: 固定学习率可能不适合整个训练过程

**解决方案**: 

```python
scheduler = torch.optim.lr_scheduler.StepLR(optimizer, step_size=100, gamma=0.9)

# 在每个episode后
scheduler.step()
```

### 2.4 并行采样(高级)

**问题**: 单条轨迹的梯度估计方差很高

**解决方案**: 同时采集多条轨迹，汇总梯度

```python
num_trajectories = 8
all_log_probs = []
all_returns = []

for _ in range(num_trajectories):
    trajectory = collect_trajectory(env, policy)
    all_log_probs.extend(trajectory.log_probs)
    all_returns.extend(trajectory.returns)

# 使用所有数据计算梯度
loss = compute_policy_loss(all_log_probs, normalize(all_returns))
```

---

## 3. 调试技巧

### 3.1 监控指标

```python
# 应该监控的关键指标
metrics = {
    "episode_reward": episode_reward,  # 应该上升
    "loss": loss.item(),               # 不一定下降(这不是监督学习！)
    "policy_entropy": dist.entropy().mean().item(),  # 应该逐渐下降
    "grad_norm": compute_grad_norm(policy),  # 不应该太大或太小
}
```

### 3.2 常见问题诊断

| 现象 | 可能原因 | 解决方案 |
|------|----------|----------|
| 奖励不增长 | 学习率太小 | 增大学习率 |
| 奖励剧烈震荡 | 学习率太大 / 方差太高 | 减小学习率 / 标准化回报 |
| 策略崩溃(奖励骤降) | 梯度爆炸 | 梯度裁剪 |
| 收敛到次优策略 | 探索不足 | 添加熵正则化 |

### 3.3 熵正则化

为了防止策略过早收敛，可以添加熵bonus: 

```python
entropy = dist.entropy().mean()
loss = policy_loss - entropy_coef * entropy
```

较高的熵意味着策略更随机，有助于探索. 

---

## 4. 从REINFORCE到Actor-Critic的过渡

REINFORCE的主要问题: **高方差**(因为使用完整轨迹的蒙特卡洛回报)

**解决思路**: 用一个learned的价值函数 $V(s)$ 来减少方差

```python
# REINFORCE
advantage = G_t  # 蒙特卡洛回报，高方差

# Actor-Critic
advantage = r + gamma * V(s') - V(s)  # TD误差，低方差但有偏
```

这就是下一章(Actor-Critic)的核心内容. 

---

## 5. 总结: 代码结构与理论的映射

```
理论概念                    →  代码模块
─────────────────────────────────────────────
策略 π_θ(a|s)              →  PolicyNetwork 类
采样 a ~ π_θ(·|s)          →  Categorical.sample()
对数概率 log π_θ(a|s)       →  Categorical.log_prob()
回报 G_t                   →  compute_returns()
策略梯度 ∇_θ J             →  loss.backward()
参数更新 θ ← θ + α∇J       →  optimizer.step()
```
