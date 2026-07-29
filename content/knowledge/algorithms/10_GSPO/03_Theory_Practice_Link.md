# GSPO: 从公式到代码的实现指南

本文档解释GSPO如何通过序列级优化提高训练稳定性. 

---

## 1. 核心差异: Token级 vs 序列级

### 1.1 GRPO (Token级)

**公式**:
$$r^{GRPO} = \prod_{t=1}^T \frac{\pi_\theta(y_t)}{\pi_{old}(y_t)}$$

**代码**:
```python
# Token级比率
per_token_ratio = torch.exp(log_probs - old_log_probs)  # [B, T]
# 序列比率 = 乘积
seq_ratio = per_token_ratio.prod(dim=-1)  # [B] -> 可能爆炸!
```

### 1.2 GSPO (序列级)

**公式**:
$$r^{GSPO} = \exp\left(\sum_t \log\pi_\theta(y_t) - \sum_t \log\pi_{old}(y_t)\right)$$

**代码**:
```python
# 序列级log概率
policy_seq_logp = log_probs.sum(dim=-1)  # [B]
old_seq_logp = old_log_probs.sum(dim=-1)  # [B]
# 序列比率 = exp(差值)
seq_ratio = torch.exp(policy_seq_logp - old_seq_logp)  # [B] -> 稳定
```

### 1.3 关键区别

| 步骤 | GRPO | GSPO |
|------|------|------|
| 1. 计算 | token级ratio | token级log概率 |
| 2. 聚合 | 乘积 | 求和(log空间) |
| 3. 裁剪 | token级 | 序列级 |

---

## 2. 序列级log概率计算

### 2.1 公式

$$\log\pi(y|x) = \sum_{t=1}^T \log P(y_t | y_{<t})$$

### 2.2 代码

```python
def compute_sequence_log_probs(logits, labels, attention_mask):
    # 对齐
    shift_logits = logits[:, :-1, :]
    shift_labels = labels[:, 1:]
    shift_mask = attention_mask[:, 1:]
    
    # Log softmax
    log_probs = F.log_softmax(shift_logits, dim=-1)
    
    # 提取目标token
    per_token_logp = torch.gather(
        log_probs, dim=2, index=shift_labels.unsqueeze(-1)
    ).squeeze(-1)
    
    # 求和 (GSPO的关键!)
    seq_log_probs = (per_token_logp * shift_mask).sum(dim=-1)
    
    return seq_log_probs
```

---

## 3. 序列级裁剪

### 3.1 GRPO vs GSPO 裁剪

```python
# GRPO: Token级裁剪后乘积 (仍可能爆炸)
clipped_token_ratio = torch.clamp(token_ratio, 1-eps, 1+eps)
seq_ratio = clipped_token_ratio.prod(dim=-1)  # 乘积可能超出[1-eps, 1+eps]

# GSPO: 序列级裁剪 (有界)
seq_ratio = torch.exp(log_new - log_old)
clipped_seq_ratio = torch.clamp(seq_ratio, 1-eps, 1+eps)  # 直接有界
```

---

## 4. 数值稳定性分析

### 4.1 示例代码

```python
def demo_stability():
    T = 100  # 100 tokens
    token_log_ratio = torch.randn(T) * 0.1  # 小波动
    
    # GRPO
    grpo_ratio = torch.exp(token_log_ratio).prod()
    
    # GSPO
    gspo_ratio = torch.exp(token_log_ratio.sum())
    
    print(f"GRPO ratio: {grpo_ratio.item()}")  # 可能 1e10 或 1e-10
    print(f"GSPO ratio: {gspo_ratio.item()}")  # 约 1.0
```

### 4.2 数学解释

设 $\log r_t \sim N(0, \sigma^2)$:

- **GRPO**: $r^{GRPO} = \exp(\sum_t \log r_t)$, 但裁剪在token级，最终乘积无界
- **GSPO**: $r^{GSPO} = \exp(\sum_t \log r_t)$, 裁剪在序列级，有界

---

## 5. 代码结构

```
GSPO流程                        →  核心函数
──────────────────────────────────────────
计算序列log概率                 →  compute_sequence_log_probs()
计算序列比率                    →  compute_sequence_ratio()
序列级裁剪                      →  torch.clamp(ratio, 1-ε, 1+ε)
GSPO损失                        →  compute_gspo_loss()
```

---

## 6. 常见问题

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| MoE训练崩溃 | Token级方差爆炸 | 使用GSPO序列级 |
| ratio超出范围 | 长序列 | 序列级裁剪 |
