# Theory to Practice: GHPO (Guided Hybrid Policy Optimization)

## 1. 核心映射 (Core Mapping)

GHPO 试图解决 RLHF 过程中的 **Alignment Tax**(能力退化)问题. 
核心方案是: 混合使用 **SFT Gradients** (保持原始能力) 和 **RL Gradients** (提升且对齐). 

| 理论组件 (Theory) | 代码实现 (Code Implementation) | 所在行 (Implementation.py) |
| :--- | :--- | :--- |
| **混合目标 (Hybrid Objective)** | `alpha * L_rl + (1-alpha) * L_sft` | Line 45 |
| **SFT 数据复用** | 在 RL batch 中混入 Pre-training/SFT 数据 | Line 30-35 |
| **动态混合 (Dynamic Mixing)** | `alpha` 可以随时间衰减或调整 | Line 48 |

---

## 2. 关键代码解析

### 2.1 损失函数融合

```python
# 02_Implementation.py
# 1. RL Loss (e.g., PPO or DPO)
loss_rl = compute_rl_loss(...)

# 2. SFT Loss (NLL on high-quality demonstrations)
# 这一项像是一个 "Anchor"，防止模型为了刷高分而忘记怎么说话. 
loss_sft = F.cross_entropy(logits, targets)

# 3. Hybrid
total_loss = self.alpha * loss_rl + (1 - self.alpha) * loss_sft
```

**理论依据**:
RL 优化的是 $\max \mathbb{E}[R]$，这通常会导致分布偏移 (Distribution Shift). 
SFT 优化的是 $\min \text{KL}(\pi \| \pi_{data})$. 
将两者结合，本质上是在进行 **KL-Constrained Reinforcement Learning**，但这里的 KL 是针对高质量数据的，而不是针对旧模型的. 

### 2.2 为什么比 PPO 的 KL Penalty 好？

PPO 的 KL Penalty 是 `KL(pi || pi_old)`. 如果 `pi_old` 本身就已经跑偏了，Penalty 就没有意义. 
GHPO 的 SFT Loss 相当于 `KL(pi || pi_gold)`，其中 `pi_gold` 是人类标注的黄金数据. 这提供了更强的 Grounding 信号. 

---

## 3. 工程细节

*   **数据配比**: 这是一个极其关键的超参. 通常 SFT 数据占 10%~20%. 
*   **计算开销**: 需要在一个 Step 内计算两种 Loss，计算量略增，但不需要额外的模型加载. 

---

## 4. 总结

GHPO 展示了 **Multi-Task Learning** 在 RL 中的应用. 
RL 负责 "Go High" (Reward)，SFT 负责 "Stay Real" (Likelihood). 
