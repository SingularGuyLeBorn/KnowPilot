---
title: "4.4 · 从 RL 的视角理解 SFT: DFT、PSFT、ASFT"
date: 2026-05-16
tags: [SFT, RL, Policy Gradient, DFT, PSFT, ASFT, 梯度动态降权]
---

# 从 RL 的视角理解 SFT: DFT、PSFT、ASFT

> 本文从数学上揭示 SFT 与 RL 的深层关联: SFT 本质上是在做特殊的 policy gradient，而 SFT loss 是 RL loss 的下界. 基于此洞察，介绍三个 SFT 改进算法——DFT、PSFT、ASFT. 

---

## 1. SFT 与 RL 的基本公式

### 1.1 SFT 目标函数

给定 prompt x，模型输出 y，expert 输出 y*，待微调模型 pi_theta: 

L_SFT = -E[(x, y*)] [ log pi_theta(y*|x) ]

梯度: grad L_SFT = -E[(x, y*)] [ grad log pi_theta(y*|x) ]

### 1.2 RL 目标函数

Reward function 为 r(x, y)，RL 目标是提升 policy 的期望奖励: 

J_RL(theta) = E[x ~ D, y ~ pi_theta] [ r(x, y) ]

Sentence-level policy gradient: 
grad J_RL = E[x, y ~ pi_theta] [ r(x, y) * grad log pi_theta(y|x) ]

---

## 2. SFT 在做稀疏的 On-Policy RL

### 2.1 从 Off-Policy 到 On-Policy

SFT 的训练样本来自更强的模型或人类(而非自身)，因此是 off-policy 的. 

通过 resample + reweight，可将 SFT 改写为 on-policy 形式: 

L_SFT = -E[x, y ~ pi_theta] [ (pi_expert(y|x) / pi_theta(y|x)) * log pi_theta(y|x) ]

直觉: 理论上 pi_theta 有概率采样到 expert 输出(尽管概率可能极低)，因此可用 resample 重写公式; 为保证期望值一致，需对采样到的 expert output 进行与采样概率成反比的加权. 

### 2.2 与 Policy Gradient 的对比

| 特性 | SFT | Policy Gradient |
|:-----|:-----|:----------------|
| 采样分布 | Off-policy(expert) | On-policy(当前模型) |
| 奖励信号 | 隐式(expert 输出 = 正奖励) | 显式(r(x,y)) |
| 探索性 | 低(模仿 expert) | 高(自主采样) |
| 梯度方向 | 始终正向 | 可正可负 |

---

## 3. SFT 是 RL 的下界

### 3.1 数学关系

从 loss 的角度看，SFT loss 是 RL loss 的下界: 

L_RL(theta) >= L_SFT(theta)

这意味着: 
- 优化 SFT loss 只能达到 RL 性能的下限
- 要突破 SFT 的性能天花板，必须引入显式的奖励信号和探索机制

### 3.2 为什么 SFT"简单但上限不高"

1. **缺乏探索**: SFT 只模仿 expert，不会发现超越 expert 的新策略
2. **分布偏移**: 训练数据和真实推理分布不一致，导致泛化性不足
3. **稀疏反馈**：每个样本只有"是/否"的隐式反馈，没有细粒度的质量评估

---

## 4. DFT：对梯度进行动态降权

### 4.1 核心思想

Dynamic Focal Tuning(DFT)：根据模型当前对 expert 输出的置信度，动态调整梯度权重. 

### 4.2 算法公式

L_DFT = -E[(x, y*)] [ w(pi_theta(y*|x)) * log pi_theta(y*|x) ]

其中权重函数：w(p) = (1 - p)^gamma

- 当模型对 expert 输出已经很有信心(p ~ 1)，权重 (1-p)^gamma ~ 0，梯度被抑制
- 当模型对 expert 输出不太确定(p << 1)，权重 ~ 1，梯度正常更新

### 4.3 为什么有效

- **防止过拟合**：对容易样本降权，避免模型"死记硬背"
- **聚焦困难样本**：将优化重点放在模型尚未掌握的样本上
- **更 tight 的下界**：DFT 的 loss 比标准 SFT 更接近 RL loss 的下界

---

## 5. PSFT：借鉴 PPO

### 5.1 核心思想

PPO-inspired SFT(PSFT)：将 PPO 的 clipped surrogate objective 引入 SFT，防止模型在单步更新中偏离太远. 

### 5.2 算法公式

L_PSFT = -E[(x, y*)] [ min( ratio * log pi_theta, clip(ratio, 1-eps, 1+eps) * log pi_theta ) ]

其中 ratio = pi_theta(y*|x) / pi_theta_old(y*|x)

### 5.3 与 PPO 的区别

- PPO 用于 RL 阶段，目标是最大化奖励
- PSFT 用于 SFT 阶段，目标是稳定地模仿 expert
- PSFT 的裁剪防止 SFT 过程中的"梯度爆炸"或"模式崩溃"

---

## 6. ASFT：缓解 DFT 的 Collapse 问题

### 6.1 DFT 的 Collapse 问题

DFT 的 (1-p)^gamma 权重在训练后期可能导致：
- 几乎所有样本的权重都趋于 0
- 梯度信号消失，训练停滞
- 模型陷入局部最优

### 6.2 ASFT 的解决方案

Adaptive SFT(ASFT)：引入自适应温度系数，动态调整权重的衰减速度. 

w(p) = (1 - p)^gamma(t)

其中 gamma(t) 随训练步数 t 衰减：
- 早期：gamma 较大，聚焦困难样本
- 后期：gamma 较小，防止梯度消失

另一种变体是使用相对置信度：
w(p) = (1 - p)^gamma / E[(1 - pi_theta(y*|x'))^gamma]

这样权重是相对的而非绝对的，避免了全局 collapse. 

---

## 7. 三种算法的对比与选型

| 算法 | 核心机制 | 解决的问题 | 适用场景 |
|:-----|:--------|:----------|:--------|
| DFT | 动态梯度降权 (1-p)^gamma | SFT 过拟合、简单样本浪费梯度 | 数据质量参差不齐 |
| PSFT | PPO 式裁剪 | SFT 训练不稳定、梯度爆炸 | 大学习率 SFT |
| ASFT | 自适应温度/相对置信度 | DFT 的 collapse 问题 | 长时训练、追求稳定性 |

---

## 8. 从理论到实践的启示

1. **SFT 不只是"模仿"**：从 RL 视角看，SFT 是在做一种受限的 policy gradient
2. **梯度权重很重要**：动态权重分配可以显著提升训练效率
3. **下界思维**：SFT 是 RL 的下界，要突破天花板需要引入显式奖励和探索
4. **稳定性与效率的权衡**：PSFT 提供稳定性，DFT 提供效率，ASFT 平衡两者

> 参考来源：[从 RL 的视角理解 SFT](https://zhuanlan.zhihu.com/p/xxxxxxxxxx)
