# 第13章: 简单偏好优化 (Simple Preference Optimization, SimPO)

**论文信息**: 
- **标题**: SimPO: Simple Preference Optimization with a Reference-Free Reward
- **作者**: Yu Meng, Mengzhou Xia, Danqi Chen (Princeton University)
- **年份**: 2024
- **arXiv**: 2405.14734
- **PDF**: 见 `papers/` 目录

**前置知识**: DPO(第7章)、最大间隔损失 (Margin Loss)

---

## 0. 本章目标

在DPO和ORPO之后，普林斯顿大学团队提出了**SimPO**，进一步将偏好优化简化到了极致. 

> **SimPO的核心哲学**: 如果DPO的核心是"隐式奖励"，那我们为什么不直接定义一个**最简单的奖励形式**，并强制好回复的奖励比坏回复高出一个**间隔 (Margin)** 呢？

本章将: 

1. 揭示DPO中参考模型 (Reference Model) 的冗余性
2. 推导SimPO的**长度归一化奖励**公式
3. 解释**Target Margin**在防止长度欺骗中的作用
4. 实现SimPO算法(可能目前最简单的对齐代码)

---

## 1. 动机: DPO真的需要参考模型吗？

### 1.1 DPO的回顾

DPO的隐式奖励: 
$$r_{DPO}(x, y) = \beta \log \frac{\pi_\theta(y|x)}{\pi_{ref}(y|x)}$$

这个公式里有两项: 
1. $\log \pi_\theta$: 当前策略的生成概率(越高越好)
2. $-\log \pi_{ref}$: 参考策略的生成概率(作为基线)

### 1.2 SimPO的洞察

SimPO作者发现，在实践中，$\pi_{ref}$ 这一项其实主要起到了**正则化**的作用，防止模型输出概率崩坏. 但通过显式的**长度归一化**和**Margin**约束，我们可以完全去掉 $\pi_{ref}$. 

去掉 $\pi_{ref}$ 的好处: 
1. **显存减半**: 不需要加载两份模型参数
2. **计算加速**: 不需要前向传播两次
3. **流程简化**: 训练流程更像普通的SFT

---

## 2. SimPO算法详解

### 2.1 长度归一化奖励 (Length-Normalized Reward)

SimPO直接定义奖励为**序列的平均对数概率**: 

$$r_{SimPO}(x, y) = \frac{\beta}{|y|} \log \pi_\theta(y|x) = \frac{\beta}{|y|} \sum_{t=1}^{|y|} \log \pi_\theta(y_t | y_{<t}, x)$$

**符号详解**: 

| 符号 | 含义 | 说明 |
|------|------|------|
| $\beta$ | **缩放系数** | 控制奖励的量级，通常较大 (如2.0) |
| $|y|$ | **序列长度** | Token数量 |
| $\log \pi_\theta$ | **序列总Log概率** | 所有token log prob之和 |

**为什么要除以长度？**
如果不除以长度，长句子天然 Log Prob 更低(因为是负数相加). 例如: 
- 短回复 (len=10, avg_logp=-1.0): Sum = -10
- 长回复 (len=100, avg_logp=-1.0): Sum = -100

如果不归一化，模型会倾向于生成极短的回复来最大化 Sum Log Prob. 
归一化后，模型关注的是**生成质量**(平均概率)而非长度. 

### 2.2 目标间距 (Target Margin)

有了奖励定义，我们希望好回复的奖励不仅大于坏回复，还要大出一个**安全间隔 $\gamma$**: 

$$r(y_w) - r(y_l) > \gamma$$

这引入了**最大间隔 (Max Margin)** 的思想，类似于SVM. 

### 2.3 SimPO损失函数

将上述思想结合，SimPO使用带Margin的Sigmoid损失: 

$$\mathcal{L}_{SimPO} = -\mathbb{E}_{(x, y_w, y_l) \sim \mathcal{D}} \left[ \log \sigma \left( r_{SimPO}(y_w) - r_{SimPO}(y_l) - \gamma \right) \right]$$

展开后: 

$$\mathcal{L}_{SimPO} = -\mathbb{E} \left[ \log \sigma \left( \frac{\beta}{|y_w|} \log \pi_\theta(y_w) - \frac{\beta}{|y_l|} \log \pi_\theta(y_l) - \gamma \right) \right]$$

**参数推荐**: 
- $\beta$: 2.0 ~ 2.5 (比DPO的0.1大得多)
- $\gamma$: 0.5 ~ 1.5

---

## 3. SimPO vs DPO vs ORPO

| 维度 | DPO | ORPO | SimPO |
|------|-----|------|-------|
| **需要参考模型** | ✅ | ❌ | ❌ |
| **奖励形式** | $\log(\pi/\pi_{ref})$ | Odds Ratio | $\frac{1}{L} \log \pi$ |
| **损失函数** | $\log \sigma(\Delta r)$ | NLL + $\log \sigma(\Delta OR)$ | $\log \sigma(\Delta r - \gamma)$ |
| **主要超参** | $\beta \approx 0.1$ | $\lambda \approx 0.1$ | $\beta \approx 2.0, \gamma \approx 1.0$ |
| **显存效率** | 低 | 高 | **极高** |

**SimPO的优势**: 
- 在AlpacaEval 2和Arena-Hard等榜单上，SimPO通常能击败DPO. 
- 只有SimPO显式引入了Margin，这被证明对泛化能力至关重要. 

---

## 4. 梯度分析

SimPO的梯度: 

$$\nabla_\theta \mathcal{L} = -\sigma(-\Delta r + \gamma) \cdot \nabla_\theta (r_w - r_l)$$

由于 $\gamma > 0$，即使模型已经能够区分 $y_w$ 和 $y_l$(即 $r_w > r_l$)，只要差值还没达到 $\gamma$，损失函数依然会提供较大的梯度. 
这迫使模型**"过度自信"**地偏好优胜回复，从而获得更鲁棒的对齐效果. 

---

## 5. 本章总结

### 5.1 核心公式

$$r_{SimPO}(y) = \frac{\beta}{|y|} \log \pi_\theta(y|x)$$

$$\mathcal{L} = -\log \sigma(r(y_w) - r(y_l) - \gamma)$$

### 5.2 SimPO的贡献

1. **极简主义**: 证明了复杂的参考模型不是必要的. 
2. **长度归一化**: 解决了生成式模型常见的长度偏差问题. 
3. **Margin机制**: 引入间隔最大化，提升了对齐的鲁棒性. 

---

**下一章预告**: 建议阅读 [IPO (Identity Preference Optimization)](../14_IPO/01_Theory_Derivation.md) 了解另一种DPO变体. 
