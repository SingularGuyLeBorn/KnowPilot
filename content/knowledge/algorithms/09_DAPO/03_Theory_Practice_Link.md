# DAPO: 从公式到代码的实现指南

本文档解释DAPO的四大技术如何从数学公式转化为代码实现. 

---

## 1. Clip-Higher (解耦裁剪)

### 1.1 公式

**标准PPO**:
$$\text{clip}(r, 1-\epsilon, 1+\epsilon)$$

**DAPO**:
$$\text{clip}^{DAPO}(r, A) = \begin{cases}
\min(r, 1+\epsilon_{high}) & A > 0 \\
\max(r, 1-\epsilon_{low}) & A < 0
\end{cases}$$

### 1.2 代码

```python
def dapo_clip(ratio, advantages, eps_high=0.28, eps_low=0.2):
    clipped = torch.where(
        advantages > 0,
        torch.clamp(ratio, max=1 + eps_high),  # 正优势: 只裁上界
        torch.clamp(ratio, min=1 - eps_low)    # 负优势: 只裁下界
    )
    return clipped
```

### 1.3 对比

| 场景 | PPO | DAPO | 效果 |
|------|-----|------|------|
| A>0, r=1.5 | clip到1.2 | clip到1.28 | 更多探索 |
| A<0, r=0.7 | clip到0.8 | clip到0.8 | 相同约束 |

---

## 2. Token-Level Loss

### 2.1 公式

**序列级 (GRPO)** :
$$L = -r^{seq} \cdot A \quad \text{where } r^{seq} = \prod_t r_t$$

**Token级 (DAPO)** :
$$L = -\sum_t r_t \cdot A$$

### 2.2 代码

```python
# GRPO: 序列级
seq_ratio = torch.exp(log_ratio.sum(dim=-1))
loss = -seq_ratio * advantages

# DAPO: Token级
per_token_ratio = torch.exp(log_ratio)  # [B, T]
loss = -(per_token_ratio * advantages.unsqueeze(-1)).sum()
```

---

## 3. Dynamic Sampling

### 3.1 公式 (算法描述)

```
while valid_count < target:
    sample responses
    filter prompts where all rewards == 0
    add new prompts
```

### 3.2 代码

```python
def filter_zero_reward_prompts(rewards, group_size):
    rewards_grouped = rewards.view(-1, group_size)
    # 检查每个prompt是否有非零奖励
    has_nonzero = (rewards_grouped != 0).any(dim=1)
    return has_nonzero
```

---

## 4. Overlong Reward Shaping

### 4.1 公式

$$R_{shaped} = R_{original} - \lambda \cdot \max(0, |y| - L_{max})$$

### 4.2 代码

```python
def overlong_reward_shaping(rewards, lengths, max_len, penalty=0.01):
    excess = torch.clamp(lengths - max_len, min=0)
    return rewards - penalty * excess
```

---

## 5. DAPO vs GRPO 代码对比

### 5.1 裁剪

```python
# GRPO: 对称裁剪
clipped = torch.clamp(ratio, 1-eps, 1+eps)

# DAPO: 解耦裁剪
clipped = torch.where(adv > 0,
    torch.clamp(ratio, max=1+eps_high),
    torch.clamp(ratio, min=1-eps_low))
```

### 5.2 损失级别

```python
# GRPO: 序列级
seq_logp = log_probs.sum(dim=-1)
ratio = torch.exp(seq_logp - old_seq_logp)
loss = -(ratio * adv).mean()

# DAPO: Token级  
per_token_ratio = torch.exp(log_probs - old_log_probs)
per_token_loss = per_token_ratio * adv.unsqueeze(-1)
loss = -(per_token_loss * mask).sum() / mask.sum()
```

---

## 6. 关键超参数

| 参数 | DAPO值 | 说明 |
|------|--------|------|
| eps_high | 0.28 | 比标准0.2更宽松 |
| eps_low | 0.2 | 保持标准 |
| min_valid_ratio | 0.5 | 动态采样阈值 |
| overlong_penalty | 0.01 | 过长惩罚系数 |

---

## 7. 代码结构总结

```
DAPO流程                        →  核心函数
──────────────────────────────────────────
采样responses                   →  sample_fn()
过长奖励塑造                    →  overlong_reward_shaping()
过滤全零prompts                 →  filter_zero_reward_prompts()
计算组优势                      →  compute_advantages()
Token级概率比                   →  exp(log_probs - old_log_probs)
解耦裁剪                        →  dapo_clip()
Token级损失                     →  -Σ(clipped_r * A)
```
