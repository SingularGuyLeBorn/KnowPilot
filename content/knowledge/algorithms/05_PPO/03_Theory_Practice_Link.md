# PPO: 从公式到代码的实现指南

本文档详细解释如何将PPO理论公式转化为Python代码，以及关键的工程优化技巧. 

---

## 1. 核心公式与代码对应

### 1.1 概率比 $r_t(\theta)$

**公式**: 
$$r_t(\theta) = \frac{\pi_\theta(a_t|s_t)}{\pi_{\theta_{\text{old}}}(a_t|s_t)}$$

**代码实现** (`02_Implementation.py` 第305-310行):

```python
# 使用对数概率计算(数值更稳定)
# log(a/b) = log(a) - log(b)
# r = exp(log(r)) = exp(log_new - log_old)
ratio = torch.exp(new_log_probs - old_log_probs)
```

**为什么用对数？**
- 直接计算 π/π_old 可能导致数值不稳定(很大或很小的数)
- 对数空间: 减法 → 原空间: 除法，更稳定
- exp() 把结果转回原空间

### 1.2 PPO-Clip目标

**公式**: 
$$L^{CLIP} = \mathbb{E}_t\left[\min(r_t A_t, \text{clip}(r_t, 1-\epsilon, 1+\epsilon) A_t)\right]$$

**代码实现**:

```python
def compute_ppo_loss(old_log_probs, new_log_probs, advantages, clip_epsilon):
    # 步骤1: 计算概率比
    ratio = torch.exp(new_log_probs - old_log_probs)
    
    # 步骤2: 原始目标 r * A
    surr1 = ratio * advantages
    
    # 步骤3: 裁剪目标 clip(r, 1-ε, 1+ε) * A
    surr2 = torch.clamp(ratio, 1.0 - clip_epsilon, 1.0 + clip_epsilon) * advantages
    
    # 步骤4: 取min并取负(因为要最小化loss来最大化目标)
    policy_loss = -torch.min(surr1, surr2).mean()
    
    return policy_loss
```

**公式与代码的逐步对应**:

| 公式部分 | 代码 | 说明 |
|----------|------|------|
| $r_t(\theta)$ | `ratio` | 概率比 |
| $A_t$ | `advantages` | 优势函数(已提前计算) |
| $\text{clip}(r, 1-\epsilon, 1+\epsilon)$ | `torch.clamp(ratio, 1-ε, 1+ε)` | 裁剪函数 |
| $\min(\cdot, \cdot)$ | `torch.min(surr1, surr2)` | 取较小值 |
| $-\mathbb{E}[\cdot]$ | `-.mean()` | 负号+求平均 |

### 1.3 GAE (广义优势估计)

**公式**: 
$$\hat{A}_t = \sum_{k=0}^{\infty} (\gamma\lambda)^k \delta_{t+k}$$

其中 $\delta_t = r_t + \gamma V(s_{t+1}) - V(s_t)$ (TD误差)

**递归形式**:
$$\hat{A}_t = \delta_t + \gamma\lambda \hat{A}_{t+1}$$

**代码实现** (`RolloutBuffer.compute_returns_and_advantages`):

```python
def compute_returns_and_advantages(self, last_value, gamma, gae_lambda):
    T = len(self.rewards)
    gae = 0  # 初始化 A_{T} = 0
    
    # 从后往前递归
    for t in reversed(range(T)):
        # 确定next_value
        if t == T - 1:
            next_value = last_value
        else:
            next_value = self.values[t + 1]
        
        # TD误差: δ_t = r_t + γ·V(s') - V(s)
        delta = self.rewards[t] + gamma * next_value - self.values[t]
        
        # GAE递归: A_t = δ_t + γλ·A_{t+1}
        gae = delta + gamma * gae_lambda * gae
        self.advantages[t] = gae
```

**关键实现细节**:

1. **从后往前**: 因为 $A_t$ 依赖 $A_{t+1}$
2. **处理终止状态**: 如果 `done=True`，则 $V(s_{t+1}) = 0$
3. **累积gae**: 每步更新 `gae = delta + γλ * gae`

---

## 2. Actor-Critic架构

### 2.1 为什么共享底层网络？

```python
class ActorCritic(nn.Module):
    def __init__(self, state_dim, action_dim, hidden_size):
        # 共享特征提取
        self.shared = nn.Sequential(
            nn.Linear(state_dim, hidden_size),
            nn.Tanh(),
            nn.Linear(hidden_size, hidden_size),
            nn.Tanh()
        )
        # 分离的头
        self.actor_head = nn.Linear(hidden_size, action_dim)  # 策略
        self.critic_head = nn.Linear(hidden_size, 1)          # 价值
```

**原因**: 
1. **参数效率**: 状态特征可以复用
2. **更快收敛**: 策略和价值同时学习有用特征
3. **LLM实践**: RLHF中也这样做(在LLM上加Value Head)

### 2.2 采样与更新的区别

```python
def get_action_and_value(self, state, action=None):
    # 采样时: action=None, 返回新采样的动作
    # 更新时: action=给定, 返回该动作的log_prob(用于计算r(θ))
    
    if action is None:
        action = dist.sample()  # 采样新动作
    
    log_prob = dist.log_prob(action)  # 计算对数概率
    return action, log_prob, entropy, value
```

---

## 3. 工程优化技巧

### 3.1 优势标准化

**问题**: 优势值的规模不一，导致梯度不稳定

**解决方案**: 每批数据中标准化

```python
advantages = (advantages - advantages.mean()) / (advantages.std() + 1e-8)
```

**注意**: 在整个batch上标准化，而不是每个mini-batch

### 3.2 梯度裁剪

**问题**: PPO多轮更新可能累积大梯度

**解决方案**: 

```python
nn.utils.clip_grad_norm_(network.parameters(), max_norm=0.5)
```

### 3.3 学习率调度

**常见选择**: 线性衰减

```python
def linear_schedule(initial_lr):
    def scheduler(progress):  # progress: 0 -> 1
        return initial_lr * (1 - progress)
    return scheduler
```

### 3.4 熵正则化

**目的**: 防止策略过早收敛到确定性

**公式**: 
$$L = L^{CLIP} + c_1 L^{VF} - c_2 S[\pi_\theta]$$

**代码**: 
```python
entropy = dist.entropy().mean()
loss = policy_loss + value_coef * value_loss - entropy_coef * entropy
```

**注意负号**: 更高的熵应该降低loss，所以用减法

---

## 4. PPO vs 其他算法

### 4.1 对比表

| 特性 | REINFORCE | A2C | TRPO | PPO |
|------|-----------|-----|------|-----|
| 数据复用 | ✗ | ✗ | ✓ | ✓ |
| 稳定更新 | ✗ | 中 | ✓ | ✓ |
| 实现复杂度 | 低 | 低 | 高 | 中 |
| 超参敏感度 | 高 | 中 | 低 | 低 |

### 4.2 PPO-Clip vs PPO-KL

PPO论文中实际提出了两种变体: 

**PPO-Clip(更常用)** :
```python
surr = torch.min(r * A, clip(r, 1±ε) * A)
```

**PPO-KL(自适应KL惩罚)** :
```python
surr = r * A - β * KL(π_old || π_new)
# β 根据KL散度动态调整
```

PPO-Clip更简单且效果相当，所以更常用. 

---

## 5. LLM-PPO特殊考虑

### 5.1 Token-level vs Response-level

**Response-level**(常见): 
- 奖励只在生成完成后给
- 整个response的优势相同

**Token-level**(更精细): 
- 每个token有自己的优势
- 需要更复杂的credit assignment

### 5.2 KL散度约束

RLHF中通常添加KL惩罚: 

```python
reward = reward_model(response) - β * KL(π_θ || π_ref)
```

这防止模型偏离初始SFT模型太远. 

### 5.3 Value Head

LLM-PPO需要在LLM上添加价值头: 

```python
class LLMWithValueHead(LLM):
    def __init__(self, base_model):
        self.lm_head = base_model.lm_head        # 语言模型头
        self.value_head = nn.Linear(hidden, 1)   # 新增价值头
```

---

## 6. 代码结构总结

```
PPO算法流程            →  代码模块
─────────────────────────────────────
策略网络 π_θ(a|s)      →  ActorCritic.actor_head
价值网络 V(s)         →  ActorCritic.critic_head
采集轨迹              →  rollout loop
存储经验              →  RolloutBuffer
计算GAE               →  compute_returns_and_advantages
计算PPO损失           →  compute_ppo_loss
多轮优化 (K epochs)   →  for _ in range(num_epochs)
梯度更新              →  optimizer.step()
```

---

## 7. 常见问题排查

| 问题 | 可能原因 | 解决方案 |
|------|----------|----------|
| 奖励不增长 | 学习率太小 | 增大lr或增加updates |
| 策略崩溃 | clip_epsilon太大 | 减小到0.1 |
| 震荡严重 | 优势未标准化 | 添加标准化 |
| 收敛太慢 | GAE λ太小 | 增大到0.95 |

---

## 8. 开源参考

- **Stable-Baselines3**: 最易用的PPO实现
- **CleanRL**: 最清晰的单文件实现
- **TRL**: LLM-PPO的标准库
