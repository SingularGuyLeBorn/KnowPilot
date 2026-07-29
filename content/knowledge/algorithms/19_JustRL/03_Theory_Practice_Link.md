# Theory to Practice: JustRL (The Simple Recipe)

## 1. 核心映射概览 (Core Mapping)

JustRL 的革命性在于它的**减法**. 这一章的"Theory to Practice"主要关注我们**移除了**什么，以及剩下的极简核心是如何工作的. 

| 理论组件 (Theory) | 代码实现 (Code Implementation) | 所在行 (Implementation.py) |
| :--- | :--- | :--- |
| **No Critic** | 移除 Value Network 和 GAE 计算 | N/A (Deleted) |
| **Group Relative Reward** | `(rewards - mean) / (std + eps)` | Line 27-30 |
| **Policy Gradient** | `- (A * log_probs).mean()` | Line 45 |
| **No Clipping** | 移除 `torch.clamp(ratio, 1-e, 1+e)` | N/A (Deleted) |
| **No KL Penalty** | 移除 `beta * kl_div` | N/A (Deleted) |

---

## 2. 关键代码解析

### 2.1 只有一行的 Advantage 计算

在 PPO 中，Advantage 计算通常占据了 50 行代码 (GAE Loop). 
在 JustRL 中，它利用 Group Norm 性质，直接用统计量作为 Advantage. 

```python
# JustRL: 02_Implementation.py Line 27-30
mean_r = batch_rewards.mean(dim=1, keepdim=True)
std_r = batch_rewards.std(dim=1, keepdim=True) + 1e-8
advantages = (batch_rewards - mean_r) / std_r
```

**理论依据**:
$$ \mathbb{A}(o_i) \approx \frac{R(o_i) - \mathbb{E}[R]}{\sqrt{\text{Var}(R)}} $$
这里的 $\mathbb{E}[R]$ 直接由当前 Group 的 Mean 估计. 这利用了 Monte Carlo 思想: 只要 Group 足够大，Mean 就足够准，不需要 Critic 来预测 $V(s)$. 

### 2.2 极简的 PG Loss

```python
# JustRL: 02_Implementation.py Line 45
loss = - (advantages * log_probs).mean()
```

这也即使是教科书级的 REINFORCE loss. 
JustRL 的核心发现是: **对于 LLM，如果你的 Learning Rate 足够小，Trust Region 是不需要显式强制的 (via Clipping or KL). **
这极大地节省了显存，因为不需要存储 Old Policy 的 Logits 用于计算 KL 或 Clip Ratio. 

---

## 3. 工程实现的差异

### 3.1 显存占用对比

假设模型为 7B，Batch Size=1, Seq Len=1024. 

*   **PPO**:
    *   Policy Model (7B)
    *   Ref Model (7B) [Frozen, Inference only]
    *   Critic Model (7B) [Training]
    *   Reward Model (7B) [Frozen, Inference only]
    *   **Total VRAM**: 需要加载 4 个模型. Training 需要保存 2 个模型的 Gradients. 

*   **JustRL**:
    *   Policy Model (7B)
    *   Ref Model (Only needed if doing manual KL check, otherwise not loaded)
    *   **Total VRAM**: 只需要训练 1 个模型. Reward 通常作为 API 或轻量级脚本在 CPU/单独节点运行. 
    *   **优势**: 单卡 24G/40G 显存即可微调 7B 模型 (配合 LoRA). 

### 3.2 超参数敏感度

*   **PPO**: 对 `clip_range`, `vf_coef`, `ent_coef` 极其敏感. 调参如同炼丹. 
*   **JustRL**: 几乎只有一个超参 —— `Learning Rate`. 只要 LR 够小，训练就很稳. 

---

## 4. 总结

代码的**空缺**正是 JustRL 的精髓. 
你找不到的代码行(Critic class, GAE buffer, PPO Loss)，正是它能 Scale Up 的原因. 
