# Theory to Practice: GMPO (Geometric Mean Policy Optimization)

## 1. 核心映射 (Core Mapping)

GMPO 是对 GRPO 的一种改进，旨在解决算术平均 (Arithmetic Mean) 对离群值敏感的问题. 

| 理论组件 (Theory) | 代码实现 (Code Implementation) | 所在行 (Implementation.py) |
| :--- | :--- | :--- |
| **几何平均 (GeoMean)** | `exp(mean(log(probs)))` | Line 35 |
| **优势函数 (Advantage)** | `R - Baseline_Geo` | Line 38 |
| **鲁棒性 (Robustness)** | Log-Space 操作 | Line 32-40 |

---

## 2. 关键代码解析

### 2.1 为什么用几何平均？

在 GRPO 中，Baseline 是 $b = \frac{1}{G} \sum r_i$. 
如果 Group 中有一个极端的 Reward (Outlier)，它会拉偏整个 Baseline，导致其他正常的 Response 被错误地评估为负 Advantage. 

GMPO 认为，概率的本质是乘性的. 因此使用几何平均作为 Baseline 更自然. 

```python
# 02_Implementation.py
# 转换到 Log Space 进行加法运算，再 Exp 回来，数值更稳
log_probs_group = ...
baseline_log = log_probs_group.mean(dim=1) # Geometric Mean in Log Space is Arithmetic Mean
```

### 2.2 实际实现中的近似

纯粹的 GMPO 理论上应该针对 Rewards 做几何平均. 
但在代码实现中，GMPO 经常被解释为 **On-Policy Level** 的几何平均. 
我们的实现中展示了一种变体: 

```python
# Geometric Mean of Odds
# 这是一个更鲁棒的 Baseline 估计
baseline = torch.exp(torch.log(rewards + epsilon).mean())
```

---

## 3. 工程实现的细节

*   **Epsilon Trick**: 几何平均对 0 非常敏感(任何一个 0 都会导致结果为 0). 所以在代码中必须加 `eps`. 
*   **Log-Sum-Exp**: 为了数值稳定性，所有乘法计算都应转为 Log 空间的加法计算. 

---

## 4. 总结

GMPO 在数学上比 GRPO 更"优雅"，但在工程实现上需要更小心数值下溢 (Underflow) 问题. 代码展示了如何安全地处理这些计算. 
