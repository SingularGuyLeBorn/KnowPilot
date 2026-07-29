# RLOO: 从公式到代码的实现指南

本文档解释RLOO的核心机制——"留一法"优势计算如何从数学公式映射到高效的PyTorch代码. 

---

## 1. 留一法 (Leave-One-Out) 核心

### 1.1 数学公式

对于第 $i$ 个样本，基线 $b_i$ 是**其他样本**的均值: 

$$
b_i = \frac{1}{G-1} \sum_{j \neq i} R_j
$$

这个求和符号 $\sum_{j \neq i}$ 表示"除了 $i$ 以外的所有 $j$". 

**展开示例** ($G=4$):

$$
b_1 = \frac{R_2 + R_3 + R_4}{3}
$$

$$
b_2 = \frac{R_1 + R_3 + R_4}{3}
$$

---

### 1.2 朴素实现 (慢)

最直观的写法是用循环: 

```python
def naive_rloo(rewards):
    G = len(rewards)
    baselines = []
    for i in range(G):
        # 收集除了i以外的所有奖励
        others = [rewards[j] for j in range(G) if j != i]
        # 计算均值
        b_i = sum(others) / (G - 1)
        baselines.append(b_i)
    return baselines
```

**缺点**: 在GPU上使用Python循环非常慢，无法并行化. 

---

### 1.3 向量化实现 (快)

利用数学恒等式: 

$$
\sum_{j \neq i} R_j = (\text{Total Sum}) - R_i
$$

代入基线公式: 

$$
b_i = \frac{\sum_{j=1}^G R_j - R_i}{G - 1}
$$

**PyTorch代码**: 

```python
def compute_rloo_advantages(rewards, group_size):
    # 1. 重塑 [Batch*G] -> [Batch, G]
    # 每一行是一个Group (对应一个Prompt)
    rewards_grouped = rewards.view(-1, group_size)
  
    # 2. 计算每行的总和 [Batch, 1]
    # keepdim=True 保持维度以便广播
    sum_rewards = rewards_grouped.sum(dim=1, keepdim=True)
  
    # 3. 广播减法
    # [Batch, 1] - [Batch, G] -> [Batch, G]
    # sum_rewards中的每个标量减去该行对应的每个元素
    loo_sums = sum_rewards - rewards_grouped
  
    # 4. 计算均值
    # 除以 G-1
    loo_means = loo_sums / (group_size - 1)
  
    # 5. 计算优势
    advantages = rewards_grouped - loo_means
  
    return advantages.flatten()
```

---

## 2. RLOO vs GRPO 代码对比

### GRPO Code

```python
# GRPO: 包含自己的均值
mean = rewards.mean(dim=1, keepdim=True)  # (R1+R2+R3+R4)/4
std = rewards.std(dim=1, keepdim=True)
adv = (rewards - mean) / (std + eps)
```

### RLOO Code

```python
# RLOO: 排除自己的均值
sum_r = rewards.sum(dim=1, keepdim=True)
loo_mean = (sum_r - rewards) / (group_size - 1) # (Sum - R1)/3
adv = rewards - loo_mean
```

**关键差异**: 

1. GRPO用 `mean()`，分母是 $G$
2. RLOO用 `(sum - self) / (G-1)`，分母是 $G-1$
3. RLOO通常不除以标准差 (Though in practice, batch-wise normalization helps)

---

## 3. 为什么向量化很重要？

在LLM训练中，Batch Size可能很大(例如 $B=64, G=8 \to 512$ 个样本). 

- **循环法**: 需要执行512次Python加法和除法. 
- **向量化**: 只需要执行1次矩阵减法和1次矩阵除法. 

PyTorch/GPU对矩阵运算进行了极度优化，向量化实现通常快**100倍以上**. 
