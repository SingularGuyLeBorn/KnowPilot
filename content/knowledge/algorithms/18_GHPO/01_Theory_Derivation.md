# 第18章: GHPO (Guided Hybrid Policy Optimization)

**论文信息**: 
- **标题**: Hybrid RLHF: Mixing SFT and RL Gradients for Stable Alignment
- **作者**: (Conceptual Synthesis based on "SFT-RL Hybrid" works like OPRO, GOLD, etc.)
- **年份**: 2024
- **状态**: Advanced Baseline

**前置知识**: PPO(第5章)、SFT、KL散度

---

## 0. 本章摘要

在 LLM 对齐中，我们经常面临一个两难困境: 
- **SFT (Supervised Fine-Tuning)** : 极其稳定，但受限于人类演示的质量(Teacher Forcing). 模型很难超越提供数据的人类. 
- **RL (PPO/DPO)** : 可以探索出超越人类的策略，但极其不稳定，容易出现 Reward Hacking 或模式崩坏. 

**GHPO (Guided Hybrid Policy Optimization)** 是一种将两者结合的策略. 核心思想是在强化学习的过程中，持续地混入一定比例的高质量 SFT 数据(或由 Teacher Model 生成的 Guide 数据)，不仅作为一个 KL 约束，而是直接作为一个 **辅助 Loss**. 

这种混合不仅能稳定训练，还能缓解 RL 中的**遗忘问题 (Catastrophic Forgetting)** : 模型在为了高分狂奔时，往往会忘记基本的语法和常识，GHPO 把这些基本功"拉回来". 

本章将: 
1. 分析 RLHF 过程中的语言能力退化现象. 
2. 推导 Hybrid Loss Function: $L = L_{RL} + \lambda L_{SFT}$. 
3. 探讨 **Dynamic Mixing**: 随着训练进行动态调整混合比例. 
4. 介绍 **Off-policy Replay**: 如何复用历史优秀轨迹. 

---

## 1. 为什么纯 RL 会让模型变傻？

### 1.1 KL 约束是不够的

PPO 使用 $\text{KL}(\pi \| \pi_{ref})$ 来限制模型不偏离初始模型太远. 
但是，$\pi_{ref}$(即 SFT 模型)本身并不是完美的. 随着 $\pi$ 的更新，如果你只用 KL 约束，模型可能会在 $\pi_{ref}$ 概率较高的区域内找到一些"捷径". 

更严重的是，RL 更新通常只发生在 Reward 高的特定领域样本上. 对于那些通用的、基础的语言能力(如逻辑推理、事实知识)，如果它们没有在 RL 的 Prompt 分布中频繁出现，模型对它们的掌握就会退化. 

### 1.2 对齐税 (Alignment Tax)

这就是著名的**对齐税**: 经过 RLHF 后的模型，在标准 NLP 任务(如阅读理解、翻译)上的分数往往会下降. 
GHPO 旨在通过混合训练来最小化这种税. 

---

## 2. GHPO 算法原理

### 2.1 混合目标函数

GHPO 的 Loss 非常直观: 

$$ \mathcal{L}_{GHPO}(\theta) = \mathcal{L}_{RL}(\theta) + \lambda \cdot \mathcal{L}_{SFT}(\theta) $$

- $\mathcal{L}_{RL}$: 强化学习损失. 可以是 PPO 的 Clip Loss，也可以是 DPO Loss，甚至是 GRPO Loss. 使用当前策略 $\pi_\theta$ 采样的数据. 
- $\mathcal{L}_{SFT}$: 监督学习损失. 通常使用**原始的高质量 SFT 数据集**，或者是**Top-tier 的回放数据**. 
- $\lambda$: 混合系数. 通常设为 0.1 到 10.0 不等，取决于 RL 信号的强弱. 

### 2.2 数据源的选择

对于 $\mathcal{L}_{SFT}$ 部分，我们有几种选择: 

1.  **Pre-training Data (PT-Mix)** : 混入预训练语料. 
    - *优点*: 最大程度保持语言建模能力和知识储备. 
    - *缺点*: 与指令微调的目标分布差异大，可能干扰对齐. 

2.  **SFT Data (SFT-Mix)** : 混入原始 SFT 数据. 
    - *优点*: 保持指令遵循能力，防止遗忘. 
    - *推荐*: 目前业界的标准做法(如 LLaMA-2, InstructGPT 都有提及). 

3.  **Self-Generated Top Data (Best-of-N Mix)** : 
    - 在 RL 训练过程中，如果模型生成了一个获得极高 Reward 的回答，我们将它存入 Replay Buffer. 
    - 将这个 $(x, y_{high\_reward})$ 作为 SFT 样本训练. 
    - *优点*: 这相当于让模型不断巩固自己的"高光时刻"，实现**自举进化 (Self-Improvement)** . 

### 2.3 动态权重 (Dynamic Weighting)

在训练初期，模型还在探索，RL 信号可能很嘈杂. 此时 $\lambda$ 可以大一点，稳住底盘. 
在训练后期，模型已经收敛，我们需要微调策略以冲击最高分，此时 $\mathcal{L}_{SFT}$ 可能会阻碍进一步提升，可以将 $\lambda$ 调小. 

或者采用 **Sigmoid Schedule**: 
$\lambda(t) = \text{Initial} \to 0$. 

---

## 3. 引导式探索 (Guided Exploration)

除了混合 Loss，GHPO 还包含**引导式采样**. 

在 PPO 采样阶段: 
$$ a \sim \alpha \cdot \pi_\theta(\cdot|s) + (1-\alpha) \cdot \pi_{guide}(\cdot|s) $$

其中 $\pi_{guide}$ 可以是一个更强的模型(如 GPT-4 蒸馏)，或者是一个专门的 Exploration Policy. 
这种方法在稀疏奖励场景下特别有用. 

---

## 4. 实战代码逻辑

在 PyTorch 中实现 GHPO 只需要在 PPO/DPO 的 Trainer 循环中加几行代码. 

```python
def train_step(batch):
    # 1. RL Update (e.g., PPO)
    rl_loss, rl_metrics = ppo_trainer.step(batch['rl_data'])
    
    # 2. SFT Update (Hybrid)
    # 对 SFT 数据进行标准的 Next Token Prediction
    sft_loss = compute_lm_loss(model, batch['sft_data'])
    
    # 3. Combine
    total_loss = rl_loss + config.sft_coef * sft_loss
    
    total_loss.backward()
    optimizer.step()
```

但这带来了一个工程挑战: **数据加载**. 
RL 数据通常是 On-policy 的(现采现用)，而 SFT 数据是 Off-policy 的(存在硬盘上的). 
需要两个 DataLoader，或者通过采样比率在一个 DataLoader 中混合. 

**最佳实践**: 
- 保持两个独立的 Iterator. 
- 每个 Step 从 SFT Iterator 取一个小 Batch(例如 RL Batch=128, SFT Batch=32). 
- 梯度累积(Gradient Accumulation)之后再 Step. 

---

## 5. GHPO vs PPO-ptx

InstructGPT 论文中提到的 PPO-ptx 其实就是 GHPO 的一种(混入 Pre-training data). 
GHPO 强调的是**更广泛的混合策略**，特别是混入 **Top-k Replay** 数据. 

| 算法 | SFT Loss 来源 | 目的 |
|------|--------------|------|
| **PPO-ptx** | 预训练语料 | 保持通用语言能力，防止性能回退 |
| **PPO-SFT** | SFT指令数据 | 保持指令遵循能力，防止格式崩坏 |
| **Expert Iteration** | 自身生成的High Reward样本 | 自举进化，不断推高上限 |

---

## 6. 本章总结

### 6.1 核心公式

$$ \nabla J = \nabla J_{RL} + \lambda \nabla J_{SFT} $$

### 6.2 贡献

1. **稳定性 (Stability)** : SFT loss 像一个锚点，防止 RL 漂移. 
2. **抗遗忘 (Anti-forgetting)** : 保持了模型原有的广泛知识和能力. 
3. **平滑过渡**: 使得从 SFT 到 RL 的过渡更加平滑，不会出现突变的分布偏移. 

---

**下一章预告**: [JustRL (第19章)](../19_JustRL/01_Theory_Derivation.md) - 回归极简主义. 
