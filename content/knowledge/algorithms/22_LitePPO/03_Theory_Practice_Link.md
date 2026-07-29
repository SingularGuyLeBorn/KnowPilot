# Theory to Practice: LitePPO

## 1. 核心映射 (Core Mapping)

LitePPO 强调的是对 PPO 组件的精简与优化. 

| 理论组件 (Theory) | 代码实现 (Code Implementation) | 所在行 |
| :--- | :--- | :--- |
| **Critic-Free Advantage** | `(rewards - mean) / std` | Line 27 |
| **PPO Clipping** | `torch.clamp(ratio, 1-eps, 1+eps)` | Line 61 |
| **Token-Level Grad** | `loss = -min(s1, s2).mean()` | Line 62 |

## 2. 关键设计解析

### 2.1 为什么可以没有 Critic?
在 RLHF 场景下，Reward Model 本身就是一个极其强大的信号源. 
如果我们的 Batch Size 足够大(例如 Group Size = 64)，那么 Batch 内的均值 `mean(R)` 就是一个非常好的 Baseline 估计. 
$$ A_i \approx R_i - \bar{R}_{batch} $$
这本质上和 GRPO (Group Relative) 的思想殊途同归，但 LitePPO 保留了 Trust Region (Clipping) 的保护机制，使得训练比纯 Policy Gradient 更稳. 

### 2.2 显存优化
移除 Value Network (Critic) 立刻节省了接近 50% 的参数显存. 这意味着我们可以在同样的硬件上训练更大的 Policy，或者使用更大的 Batch Size——而后者对 RL 的稳定性至关重要. 

## 3. 2025 年的启示
"Tricks or Traps" 论文指出，很多复杂的 PPO 技巧(如 Generalized Advantage Estimation, GAE)在 LLM 后训练中并非必需. 
**Return to Simplicity (回归简约)** 是 2025 年的一个主旋律. 
