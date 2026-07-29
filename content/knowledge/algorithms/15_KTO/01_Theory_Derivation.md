# 第15章: KTO (Kahneman-Tversky Optimization)

**论文信息**: 
- **标题**: KTO: Model Alignment as Prospect Theoretic Optimization
- **作者**: Kawin Ethayarajh, Winnie Xu, Dan Jurafsky, et al. (Stanford / Contextual AI)
- **年份**: 2024
- **arXiv**: 2402.01306
- **PDF**: 见 `papers/` 目录

**前置知识**: DPO(第7章)、前景理论 (Prospect Theory)

---

## 0. 本章摘要

DPO及其变体(IPO, SimPO, RRHF)都依赖于**成对偏好数据 (Paired Preference Data)** ，即必须告诉模型"A比B好". 然而，在现实世界中，获取这种数据是昂贵且困难的. 很多时候，我们只有: 
- **点赞 (Thumbs Up)** : 用户觉得这个回答不错. 
- **点踩 (Thumbs Down)** : 用户觉得这个回答垃圾. 
这些数据是**不成对 (Unpaired)** 的. 我们可能只有一个好回复，或者只有一个坏回复. 

KTO(Kahneman-Tversky Optimization)通过引入诺贝尔经济学奖得主 Kahneman 和 Tversky 的 **前景理论 (Prospect Theory)** ，提出了一种不需要成对数据的对齐方法. 

KTO的核心思想是: 人类对"得到"和"失去"的感知是不对称的(**损失厌恶**). 通过根据前景理论设计的损失函数，KTO可以在仅有单一好坏标签的数据上达到甚至超过DPO的效果. 

本章将: 
1. 介绍前景理论的核心概念(参考点、损失厌恶). 
2. 推导KTO损失函数. 
3. 解释如何处理非成对数据 (Unpaired Data). 
4. 分析KTO为何能工作. 

---

## 1. 痛点: 成对数据的奢侈

### 1.1 DPO的数据饥渴

DPO损失函数: 
$$ \mathcal{L}_{DPO} = -\log \sigma (\beta (r_w - r_l)) $$

这一项要求输入必须是 $(x, y_w, y_l)$ 三元组. 
这就意味着，如果你只有一堆高质量的 SFT 数据(全都是 $y_w$)，你是没法跑 DPO 的. 或者如果你有一堆由于安全过滤被拦截的垃圾回复(全都是 $y_l$)，你也利用不起来. 

### 1.2 现实中的信号

在生产环境中(如 ChatGPT, Claude 的 Web 界面)，用户反馈通常是孤立的. 用户可能觉得回答好就点个赞，觉得不好就点个踩. 系统很难在同一时刻给用户展示两个回答让用户选(这会破坏用户体验). 

KTO 就是为了利用这种**二元信号 (Binary Signal)** 而生的. 

---

## 2. 理论基础: 前择理论 (Prospect Theory)

### 2.1 效用 vs 价值

在传统经济学(及标准RL)中，我们最大化期望效用 (Expected Utility). 
但在人类决策心理学中，Kahneman & Tversky 发现: 

1.  **参考点依赖 (Reference Dependence)** : 人们评估收益是基于某个参考点(Status Quo)，而不是绝对财富. 
2.  **损失厌恶 (Loss Aversion)** : 失去100块钱的痛苦远大于得到100块钱的快乐. 通常该系数 $\lambda \approx 2.25$. 
3.  **敏感度递减 (Diminishing Sensitivity)** : 随着收益/损失金额变大，边际感知递减(S型曲线). 

### 2.2 价值函数 $v(x)$

前景理论定义价值函数 $v(x)$: 
$$
v(z) = \begin{cases} 
z^\alpha & \text{if } z \ge 0 \\
-\lambda (-z)^\beta & \text{if } z < 0 
\end{cases}
$$
其中 $z = x - r$ 是相对于参考点 $r$ 的收益/损失.  $\lambda > 1$ 体现了损失厌恶. 

---

## 3. KTO 算法推导

### 3.1 隐式奖励定义

像DPO一样，KTO依然定义隐式奖励: 
$$ r_\theta(x, y) = \beta \log \frac{\pi_\theta(y|x)}{\pi_{\text{ref}}(y|x)} $$

### 3.2 引入参考点 (Reference Point)

KTO假设，对于每个输入 $x$，存在一个人类期望的**参考奖励值**. 但在KTO的具体实现中，为了简化，我们并不需要显式计算这个参考点，而是通过 KL 散度项隐式处理. 

KTO 直接定义了两个方向的损失: 

#### (1) 对于期望的回复 (Desirable / Chosen, $y \in Y_{desirable}$)
我们希望奖励尽可能高. 
目标函数: 最大化 $\sigma(r_\theta(x, y) - z_{ref})$
损失函数: 
$$ L_{KTO}^+ = 1 - \sigma(r_\theta(x, y) - z_{ref}) $$

#### (2) 对于不期望的回复 (Undesirable / Rejected, $y \in Y_{undesirable}$)
我们希望奖励尽可能低. 
目标函数: 最大化 $\sigma(z_{ref} - r_\theta(x, y))$
(或者理解为: 避免损失)

作者这里做了一个巧妙的转化. 并不直接使用上述形式，而是直接借鉴前景理论的权重. 

### 3.3 KTO 最终损失函数

KTO Loss 由两部分加权组成: 

$$
\mathcal{L}_{KTO}(\theta) = \frac{1}{N} \sum_{i=1}^N w_i \cdot \text{Loss}_i
$$

其中: 
- 如果 $y$ 是好样本 ($y^+$): 
  $$ \text{Loss}^+(y) = [1 - \sigma(\beta \log \frac{\pi}{\pi_{ref}} - z_{KL})]^2 $$
- 如果 $y$ 是坏样本 ($y^-$): 
  $$ \text{Loss}^-(y) = [1 - \sigma(z_{KL} - \beta \log \frac{\pi}{\pi_{ref}})]^2 $$

**等等，这看起来很像...？**
这里加入了一个 $z_{KL}$ 项. 这是一个基于整个Batch计算的KL散度估计值，充当**参考点**. 
$$ z_{KL} \approx \mathbb{E}_{x' \sim D} [\beta \text{KL}(\pi(x') \| \pi_{ref}(x'))] $$

实际上，KTO最简单的实现版本(HALO的一员)甚至可以简化这一项. 

我们看 KTO 论文中的标准形式: 
$$ 
L_{KTO}(\pi_\theta, \pi_{ref}) = \mathbb{E}_{x, y} [ w(y) (1 - \sigma(r_{KTO}(x, y))) ]
$$
这里 $r_{KTO}$ 稍微复杂一点. 

**让我们看最常用的简化版 KTO (ArXiv v2)** : 

对于 batch 中的样本，如果是 $y_{chosen}$: 
$$ L_{chosen} = 1 - \sigma(r_\theta(x, y) - U_{ref}) $$
如果是 $y_{rejected}$: 
$$ L_{rejected} = 1 - \sigma(U_{ref} - r_\theta(x, y)) $$

这里的 $U_{ref}$ 是参考效用. 

但最关键的是**权重**: 
根据前景理论，我们要对Loss Aversion进行加权. 
Let $n_w$ be number of chosen examples, $n_l$ be number of rejected examples.

为了平衡两类样本对梯度的贡献(因为坏样本通常少，或者我们需要更用力地惩罚坏样本): 
$$ \lambda_D \frac{n_w}{n_l} $$
通常 $\lambda_D \in [1.0, 4.0]$，默认取 1.33 或 2.25 (前景理论经典值). 

---

## 4. KTO 代码实现逻辑

KTO 的核心优势在于它可以处理 `batch_size=1` 的情况(只有好没坏，或只有坏没好)，只要在整个训练集上有混合即可. 

但在代码实现时，通常还是会构造一个 Batch，里面混合了 Good 和 Bad. 

```python
def kto_loss(
    policy_logps, ref_logps,  # 混合了 chosen 和 rejected
    labels,                   # 1=chosen, 0=rejected
    beta=0.1,
    desirable_weight=1.0,
    undesirable_weight=1.0
):
    # 1. 计算隐式奖励
    chosen_rewards = beta * (policy_logps - ref_logps)
    
    # KTO为了避免漂移，通常会减去 KL term (参考点)
    # 简单的实现使用 batch 内的 KL 均值作为参考点
    kl = chosen_rewards - beta * 0 # 简化
    # 实际上: KL term = expectation of rewards
    kl_term = torch.mean(chosen_rewards.detach()) 
    
    # 调整后的奖励 (Reward centered by KL)
    # 这一步是为了模拟参考点依赖
    adjusted_rewards = chosen_rewards - kl_term
    
    # 2. 计算损失
    # 对于 desirable (label=1): maximize sigma(reward) -> minimize 1-sigma(reward)
    # 对于 undesirable (label=0): maximize sigma(-reward) -> minimize 1-sigma(-reward)
    
    losses = torch.where(
        labels == 1,
        (1 - F.sigmoid(adjusted_rewards)) * desirable_weight,
        (1 - F.sigmoid(-adjusted_rewards)) * undesirable_weight
    )
    
    return losses.mean()
```

---

## 5. KTO vs DPO 对比

| 维度 | DPO | KTO |
|------|-----|-----|
| **数据要求** | 必须成对 $(x, y_w, y_l)$ | 可以不成对，只要有 $(x, y, label)$ |
| **数据利用率** | 低 (丢弃不成对数据) | 高 (所有数据都能用) |
| **理论基础** | Bradley-Terry Model | Prospect Theory |
| **实现难度** | 中等 | 中等(需小心处理加权) |
| **效果** | SOTA (Standard) | 经常超越 DPO，特别是数据稀疏时 |

---

## 6. SFT + KTO 还是 直接 KTO？

KTO 允许直接在 SFT 数据上进行微调(只要把 SFT 数据全标为 Good). 
这意味着我们可以把 SFT 阶段和 Alignment 阶段融合. 

但论文建议，最好还是先做 SFT 得到一个像样的模型，然后再用 KTO 微调. 因为 KTO 依赖于 $\pi_{ref}$，如果 $\pi_{ref}$ 本身太差(Base Model)，隐式奖励就没有意义了. 

---

## 7. 超参数 $\lambda_D$ (Loss Aversion)

论文中的核心超参是 $\lambda_D$，用于平衡 desriable 和 undesirable 的权重. 

$$ w_{desirable} = 1.0 $$
$$ w_{undesirable} = \lambda_D \frac{N_{desirable}}{N_{undesirable}} $$

如果你发现模型生成的回答太安全、太无聊，说明它太害怕犯错(Loss Aversion太高)，可以降低 $\lambda_D$. 
如果你发现模型开始胡说八道，说明它不够害怕犯错，可以调高 $\lambda_D$. 

---

## 8. 本章总结

### 8.1 核心公式

$$ L_{KTO} = w_{label} \cdot (1 - \sigma( \text{direction} \cdot (r - z_{ref}) ) ) $$

### 8.2 贡献

1. **解锁非成对数据**: 这是KTO最大的工业价值. 
2. **引入行为经济学**: 证明了人类非理性的偏好(损失厌恶)可以被建模到 LLM 训练中. 

---

**下一章预告**: [GMPO (Geometric Mean Policy Optimization)](../16_GMPO/01_Theory_Derivation.md) - GRPO 家族的新成员. 
