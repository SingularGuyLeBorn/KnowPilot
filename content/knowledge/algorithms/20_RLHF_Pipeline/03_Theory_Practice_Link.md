# Theory to Practice: RLHF Pipeline Engineering

## 1. 核心映射 (Core Mapping)

RLHF Pipeline 不是一个单一算法，而是一个系统工程. 
它的难点在于如何协调 4 个主要模型在有限显存中的交互. 

| 系统组件 (System Component) | 代码实现 (Code Implementation) | 所在行 (Implementation.py) |
| :--- | :--- | :--- |
| **Actor (Policy)** | `self.actor` (Trainable) | Line 10 |
| **Critic (Value)** | `self.critic` (Trainable) | Line 11 |
| **Reference (Ref)** | `self.ref` (Frozen) | Line 13 |
| **Reward Model (RM)** | `self.reward_model` (Frozen) | Line 12 |
| **数据流转 (Data Flow)** | `experience_maker` | Line 40-55 |

---

## 2. 关键代码解析

### 2.1 显存优化: 模型卸载 (Offloading)

在标准实现中(如 DeepSpeed-Chat)，我们不能同时把 4 个模型的大权重都放在 GPU 上. 

*   **Training Phase**: Actor & Critic 在 GPU (需要 Gradients). Ref & RM 在 CPU 或 NVMe (只读). 
*   **Generation Phase**: Actor 在 GPU. Ref & RM 暂时加载到 GPU 进行打分，然后卸载. 

虽然我们的 `02_Implementation.py` 是简化版(全部在内存)，但真实系统必须包含 `offload` 逻辑. 

### 2.2 经验生成循环 (The Experience Loop)

```python
# 02_Implementation.py: Conceptual flow
def make_experience(self, prompts):
    # 1. Rollout (Inference)
    seqs = self.actor.generate(prompts)
    
    # 2. Evaluation (Reward Modeling)
    rewards = self.reward_model(seqs)
    
    # 3. Reference Check (KL Div)
    ref_logprobs = self.ref(seqs)
    
    # 4. Values (Critic)
    values = self.critic(seqs)
    
    return Experience(seqs, rewards, values, ref_logprobs)
```

**理论解释**:
这一步是将 **On-policy** 数据转化为 **Batch Data** 的过程. 
它对应于 RL 中的 Trajectory Sampling $\tau \sim \pi$. 

---

## 3. 分布式挑战

*   **Tensor Parallel (TP)** : 单个模型切分到多卡. 
*   **Pipeline Parallel (PP)** : 模型的不同层切分到多卡. 
*   **Data Parallel (DP)** : 不同卡跑不同数据由于. 

RLHF Pipeline 必须混合使用这三种策略 (3D Parallelism) 才能训练 100B+ 模型. 

---

## 4. 总结

RLHF 的数学很简单 (PPO)，但 RLHF 的工程很难 (System). 
这个 Pipeline 文件展示了如何将数学公式转化为数据流. 
