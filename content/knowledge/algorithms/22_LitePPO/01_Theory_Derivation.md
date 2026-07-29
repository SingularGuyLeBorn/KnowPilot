# 第22章 LitePPO: 极致简约的架构与归一化艺术

> **"Tricks or Traps? A Deep Dive into RL for LLM Reasoning"**  
> *arXiv:2508.08221* | **Authors**: Alibaba, HKUST, OpenRLHF Team

---

> [!IMPORTANT]
> **LitePPO** 并非某种复杂的新算法，它是对 PPO 的一次 **数学清算**. 它的核心观点是: 在大模型后训练中，复杂的 Critic 网络和复杂的 GAE 权重往往是不可靠的. 通过强力的 **优势归一化 (Advantage Normalization)** 和 **Token 级裁剪 (Token-level Clipping)** ，我们可以用极小的代价实现超越 GRPO 的稳定性. 

## 1. 理论根基: 为什么 PPO 变重了？

在传统强化学习中(如游戏或机器人控制)，Critic 网络的作用是捕捉 **状态演化 (State Evolution)** 的连续性. 
然而，在 LLM 生成中，状态转移是离散的(Token 到 Token). 论文研究发现，在大模型推理任务中，训练一个参数化的 Critic 存在以下致命伤: 

1.  **信号滞后 (Signal Lag)** : Critic 的学习率通常需要比特有的 Policy 低，导致优势函数的估计永远跟不上策略的演变. 
2.  **泛化崩塌 (Generalization Collapse)** : 在海量可能的推理路径中，Critic 很容易对某些路径产生过拟合，导致 Advantage 剧烈抖动，进而导致 Policy 的 Trust Region (TR) 失效. 

**LitePPO 的回答是: 扔掉 Critic，用统计量说话. **

---

## 2. 数学推导: 分层优势归一化 (Hierarchical Normalization)

LitePPO 提出了一种结合 **Group-level Mean** 和 **Batch-level Std** 的独特归一化方案. 

### 2.1 优势函数的重定义

假设我们在一个 Batch 中对采样了 $B$ 个 Prompts，每个 Prompt 采取了 $G$ 次采样(即 Group Size). 
对于第 $i$ 个 Prompt 的第 $j$ 个采样，其实际回报为 $R_{i,j}$. 

LitePPO 计算优势函数分为三步: 

1.  **组内去均值 (Group De-meaning)** :
    每一个回答的基线(Baseline)是该 Prompt 下所有回答的平均表现: 
    $$ \Delta_{i,j} = R_{i,j} - \text{mean}(R_{i,1 \dots G}) $$
    *这消除了 Prompt 本身难度带来的偏差. *

2.  **全局缩放 (Batch Scaling)** :
    使用整个 Batch(横跨所有 Prompts)的标准差进行缩放: 
    $$ \hat{A}_{i,j} = \frac{\Delta_{i,j}}{\text{std}(R_{all}) + \epsilon} $$
    *这确保了不同梯度步之间的幅度一致性. *

### 2.2 Token-level Clipping 的动力学

LitePPO 坚持在每一个 Token $t$ 处进行 PPO Clipping. 
其梯度方向为: 
$$ \nabla_\theta \mathcal{L} \approx \mathbb{E}_t \left[ \min\left( \nabla_\theta \log \pi_\theta(x_t) \hat{A}_{total}, \nabla_\theta \text{clip}(\dots) \hat{A}_{total} \right) \right] $$

**关键洞察**: 当 $\hat{A}$ 是正值时，我们增加该路径上 *所有* Token 的概率; 当 $\hat{A}$ 为负值时，减少概率. 
由于采用了 Token-level Clipping，只有当 $\pi_{new}/\pi_{old}$ 变化在 $[1-\epsilon, 1+\epsilon]$ 之间时，梯度才会全量回传. 这在数学上强制模型**均匀地**改进整个推理链，而不是孤注一掷地依赖某几个关键词. 

---

## 3. 实现细节与超参数陷阱 (Tricks or Traps)

论文通过大规模实验(A100/H100 集群，7B 到 70B 模型)总结了以下实战经验: 

### 3.1 学习率的非对称性
在 LitePPO 中，由于没有 Critic 需要妥协，可以大胆提高 Policy 的学习率. 但作者建议配合同步的 **KL Penalty**: 
*   如果 KL 散度增长过快，LitePPO 会通过 Clipping 自动“刹车”. 
*   理想的 KL 范围应维持在 $0.05 \sim 0.15$. 

### 3.2 显存分配的秘密 (VRAM Analysis)

| 组件 | VRAM (7B FP16) | 备注 |
| :--- | :--- | :--- |
| **Policy (Trainable)** | 14 GB | 必须保留梯度 |
| **Reference (Static)** | 14 GB | 可通过参数卸载或部分计算节省 |
| **Reward (Inference)** | ~5 GB | 如果是 Rule-based 则是 0 |
| **Optimizer States** | 28 GB | Adam (m & v) |
| **LitePPO Total** | **~56 GB** | 单张 A800 (80G) 即可流畅闭环 |

*对比标准 PPO 需要额外 14G (Value) + 28G (Value Optimizer) = 42G. LitePPO 直接省出了训练一个副模型的能力. *

---

## 4. 案例研究: LitePPO vs GRPO 在 AIME 2024 的表现

在极难的数学竞赛题 (AIME) 中，奖励信号极其不稳定. 
*   **GRPO**: 因为完全没有 Clipping，当模型偶然产生一个正确但概率极低的回答时，$\pi_{new}/\pi_{old}$ 可能会飙升到 $10^5$，导致梯度爆炸，模型瞬间崩溃输出乱码. 
*   **LitePPO**: 由于有 `clamp(ratio, 0.9, 1.1)` 的存在，模型会选择“稳健地进步”. 它会保留这个正确回答的方向，但只允许 Policy 概率小幅增加. 经过多轮迭代，这种“点滴积累”最终战胜了 GRPO 的“冒险主义”. 

---

## 5. 算法伪代码 (Rigorous Algorithm)

```python
# 核心逻辑: 优势函数的两级归一化
for prompt_batch in loader:
    # 1. 采样 (Group Sampling)
    all_trajectories = policy.sample(prompt_batch, G)
    all_rewards = get_rewards(all_trajectories) # [B, G]
    
    # 2. 计算组内相对优势
    group_mean = all_rewards.mean(dim=1, keepdim=True)
    relative_rewards = all_rewards - group_mean
    
    # 3. 全局标准差缩放 (核心 Trick)
    batch_std = all_rewards.std()
    advantages = relative_rewards / (batch_std + 1e-6)
    
    # 4. PPO 更新过程... (配合 Token-level Clipping)
```

## 6. 总结 (Final Thought)

LitePPO 告诉我们在大模型对齐中，**"少即是多"**. 
移除不稳定的参数化 Critic，转而利用 Batch 内部的博弈(Group Contrast)和全局的稳定步长(Global Scale)，是 2025 年 LLM-RL 的主流进化路径. 

---
*本章相关实验数据基于 2025 年 8 月阿里巴巴开源的 OpenRLHF 框架最新测试结果. *
