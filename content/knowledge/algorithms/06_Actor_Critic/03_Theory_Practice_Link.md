# Theory to Practice: Actor-Critic (The Foundation)

## 1. 核心映射 (Core Mapping)

Actor-Critic 是连接 Policy Gradient (REINFORCE) 和 Value-Based (DQN) 的桥梁. 

| 理论组件 (Theory) | 代码实现 (Code Implementation) | 所在行 (Implementation.py) |
| :--- | :--- | :--- |
| **Actor (Policy)** | 输出动作概率 $\pi(a|s)$ | Line 25 (`self.actor`) |
| **Critic (Value)** | 输出状态价值 $V(s)$ | Line 26 (`self.critic`) |
| **Advantage** | $R_t + \gamma V(s_{t+1}) - V(s_t)$ | Line 55 (TD Error) |
| **Bootstrap** | 使用后续状态的 Value 估计当前 | Line 60 (Detach Next Val) |

---

## 2. 关键代码解析

### 2.1 共享主干 (Shared Backbone)

在代码中，Actor 和 Critic 往往共享感知层 (Feature Extractor). 

```python
# 02_Implementation.py
x = self.feature_layer(state)
policy_logits = self.actor(x)
value = self.critic(x)
```

**理论依据**:
Feature Sharing 利用了多任务学习的优势. Value 预测有助于提取有用的状态特征，这些特征对 Policy 决策通常也是有用的. 这也减少了参数量. 

### 2.2 TD Error 作为 Advantage

```python
# 02_Implementation.py
# TD Target (Bootstrap)
target = reward + gamma * next_value * (1 - done)
# TD Error (Advantage Approximation)
delta = target - current_value
```

这是 AC 的核心. 相比于 REINFORCE 使用整条轨迹的 Return $G_t$，AC 使用单步 TD Error. 
- **Bias 增加**: 因为使用了 $V(s_{t+1})$ 的估计值. 
- **Variance 减少**: 只依赖单步 Reward，随机性大幅降低. 
- **Efficiency**: 支持单步更新 (Online)，不需要等回合结束. 

---

## 3. 面试考点

*   **A2C vs A3C**: A2C 是同步版 (Synchronous)，利用 GPU 的 Batch 能力通常比 A3C (异步 CPU) 更快且更稳. 代码实现的是 A2C 风格. 
*   **Critic 的作用**: 它是 Policy 的"教练"，告诉 Policy 这一步是比平常好 (Positive Advantage) 还是差 (Negative). 

---

## 4. 总结

Actor-Critic 是现代 DRL 的基石. PPO, TRPO, DDPG 都是它的变体. 
掌握 AC 等于掌握了 DRL 的半壁江山. 
