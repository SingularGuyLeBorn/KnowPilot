# 第16章: GMPO (Geometic Mean Policy Optimization)

**论文信息**: 
- **标题**: GMPO: Group Relative Optimization with Geometric Mean Baseline (Simulated/Proposed)
- **年份**: 2025 (ICLR 2026 Submission Conceptual)
- **关键词**: Group Relative, Geometric Mean, Robustness

**前置知识**: GRPO(第8章)、算术平均 vs 几何平均

---

## 0. 本章摘要

**注意**: GMPO 是 GRPO 家族中较新的探索方向(部分灵感来源于社区讨论及对数空间优化的自然推论). 它旨在解决 GRPO 中算术平均 (Arithmetic Mean) 基线的一些潜在问题. 

在 GRPO 中，我们使用组内样本的**算术平均值**作为基线: 
$$ A_i = R_i - \frac{1}{G} \sum_{j=1}^G R_j $$

然而，算术平均对**异常值 (Outliers)** 非常敏感. 如果组内有一个极其幸运的高分样本，它会拉高基线，导致其他表现尚可的样本都被判为负优势("被误杀"). 此外，当奖励跨越多个数量级时，算术差值可能无法正确反映相对改进. 

GMPO 提出使用**几何平均 (Geometric Mean)** 作为基线(或在对数空间进行平均)，这在处理长尾分布和比例奖励时具有更好的鲁棒性. 

本章将: 
1. 分析算术平均基线的局限性. 
2. 推导基于几何平均的优势函数形式. 
3. 展示如何在对数域稳定地计算 GMPO. 
4. 对比 GMPO 与 GRPO 在不同奖励分布下的表现. 

---

## 1. 为什么我们需要几何平均？

### 1.1 算术平均的陷阱

假设我们的一组采样(Group Size = 4)奖励如下: 
$$ R = [10, 10, 10, 1000] $$

- **算术平均**: $\bar{R} = 257.5$
- **GRPO 优势**: 
  - $R_1=10$: $A_1 = 10 - 257.5 = -247.5$ (被严重惩罚)
  - $R_4=1000$: $A_4 = 1000 - 257.5 = +742.5$

在这里，虽然前三个样本表现稳定(可能是基准水平)，但因为第四个样本的出现，它们受到了巨大的负反馈. 这会导致策略急剧收缩. 

### 1.2 几何平均的平滑作用

**几何平均**定义为: 
$$ \text{GM}(R) = \left( \prod_{i=1}^G R_i \right)^{1/G} $$

对于 $R = [10, 10, 10, 1000]$: 
$$ \log \text{GM}(R) = \frac{1}{4} (\log 10 + \log 10 + \log 10 + \log 1000) = \frac{1}{4} (1+1+1+3) \ln 10 \approx \text{scale} $$
如果算 Log: Average Log Reward = 1.5 (对应数值 $10^{1.5} \approx 31.6$)

- **几何平均**: $\approx 31.6$
- **GMPO 优势** (Ratio or Log Difference): 
  - $R_1=10$: $A_1 \propto \log 10 - \log 31.6 \approx -0.5$ (温和的负反馈)
  - $R_4=1000$: $A_4 \propto \log 1000 - \log 31.6 \approx +1.5$

可以看到，几何平均基线对异常值更不敏感，能在大数值波动下保护"普通样本". 

---

## 2. GMPO 理论推导

### 2.1 目标函数

我们不再最大化奖励的算术期望，而是最大化奖励的**几何期望**(等价于最大化对数奖励的期望). 
这在数学上通常对应于优化 **Nash Bargaining Solution** 或 **Kelly Criterion**. 

$$ J_{GMPO}(\theta) = \mathbb{E} [ \log R(\tau) ] $$

### 2.2 组内基线

在对数空间中，几何平均变成了算术平均: 

$$ \log \text{GM}(R) = \frac{1}{G} \sum_{i=1}^G \log R_i $$

因此，GMPO 的优势函数可以定义为**对数奖励的中心化**: 

$$ A_i^{GMPO} = \log R_i - \frac{1}{G} \sum_{j=1}^G \log R_j $$

这等价于: 
$$ A_i^{GMPO} = \log \frac{R_i}{\text{GM}(R)} $$

### 2.3 适用场景

使用 $\log R$ 的前提是 $R > 0$. 这限制了 GMPO 的使用场景: 它适用于**全正奖励**的任务(如生成的正确率概率、BLEU分数、F1分数等). 对于可能为负的奖励(如 DPO 的 Implicit Reward)，需要加上一个 Offset 或者使用其他变换. 

---

## 3. 实现细节: Log-Sum-Exp 技巧

为了数值稳定性，我们通常即便在奖励非常小时(接近0)也要小心. 

```python
def compute_gmpo_advantages(rewards, eps=1e-8):
    """
    rewards: [Batch, GroupSize]
    """
    # 1. 转换到对数域
    # 限制最小奖励，防止 log(0)
    log_rewards = torch.log(rewards.clamp(min=eps))
    
    # 2. 计算组内均值 (对数域的算术平均 = 原域的几何平均的Log)
    mean_log_rewards = log_rewards.mean(dim=1, keepdim=True)
    
    # 3. 计算优势
    advantages = log_rewards - mean_log_rewards
    
    return advantages
```

### 3.1 归一化 (Normalization)

在 GRPO 中，我们经常除以标准差 $\sigma$. 
在 GMPO 中，我们对应地除以**对数奖励的标准差**: 

$$ \sigma_{\log} = \sqrt{\frac{1}{G-1} \sum (\log R_i - \overline{\log R})^2} $$

$$ A_i^{normalized} = \frac{\log R_i - \overline{\log R}}{\sigma_{\log} + \epsilon} $$

这意味着我们实际上是在衡量奖励的**数量级差异**(Order of Magnitude)，而不是绝对数值差异. 

---

## 4. GMPO vs GRPO 对比

| 维度 | GRPO | GMPO |
|------|------|------|
| **核心指标** | $R$ (原始奖励) | $\log R$ (对数奖励) |
| **基线** | 算术平均 (Mean) | 几何平均 (GeoMean) |
| **对异常值** | 敏感 | **鲁棒** |
| **优势物理意义** | 差值 (Difference) | **比率 (Ratio)** |
| **适用范围** | 任意实数奖励 | 正实数奖励 ($R>0$) |
| **最佳场景** | 奖励分布均匀 | 奖励分布长尾/跨数量级 |

---

## 5. 什么时候使用 GMPO？

1.  **Code Generation**: 通过测试用例的数量可能从 0 到 100 指数级变化. 
2.  **Math Reasoning**: 某些复杂步骤的奖励设计可能是乘性的(概率乘积). 
3.  **High Stakes**: 当你需要模型非常稳健，不被偶尔的"狗屎运"(Lucky Guess)带偏时. 

---

## 6. 本章总结

### 6.1 核心公式

$$ A_i^{GMPO} = \log R_i - \mathbb{E}_{\text{group}}[\log R] $$

### 6.2 贡献

1. **Scale Invariance**: 优势值的计算不再依赖于奖励的绝对大小，而只依赖于相对比例. 
2. **Outlier Resistance**: 更好地处理高方差环境. 

---

**下一章预告**: 我们将进入 Advanced Variants 区域，探讨 **GDPO** 和 **JustRL**. 
