# 第7章: 直接偏好优化 (Direct Preference Optimization, DPO)

**论文信息**: 
- **标题**: Direct Preference Optimization: Your Language Model is Secretly a Reward Model
- **作者**: Rafael Rafailov, Archit Sharma, Eric Mitchell, Stefano Ermon, Christopher D. Manning, Chelsea Finn (Stanford)
- **年份**: 2023
- **arXiv**: 2305.18290
- **PDF**: 见 `papers/` 目录

**前置知识**: PPO(第5章)、RLHF基本流程

---

## 0. 本章目标

DPO是**LLM对齐领域的里程碑算法**，它证明了: 

> **"你的语言模型本身就是一个隐式的奖励模型"**

本章将: 

1. 回顾RLHF的问题，理解为什么需要DPO
2. 详细推导DPO的**隐式奖励**公式
3. 从数学上证明DPO与RLHF等价
4. 解释DPO为什么更简单、更稳定
5. 介绍DPO的变体(IPO、SimPO、ORPO)

---

## 1. RLHF的问题

### 1.1 传统RLHF流程回顾

RLHF (Reinforcement Learning from Human Feedback) 包含三个阶段: 

**阶段1: 监督微调 (SFT)** 
- 在高质量数据上微调预训练模型
- 得到初始策略 $\pi_{SFT}$

**阶段2: 奖励模型训练 (RM)** 
- 收集人类偏好数据 $(x, y_w, y_l)$: 给定prompt $x$，人类更偏好 $y_w$ 而非 $y_l$
- 训练奖励模型 $r_\phi(x, y)$ 预测人类偏好

**阶段3: RL优化 (PPO)** 
- 使用PPO最大化奖励，同时添加KL惩罚: 

$$\max_{\pi_\theta} \mathbb{E}_{x, y \sim \pi_\theta}[r_\phi(x, y)] - \beta D_{KL}(\pi_\theta \| \pi_{ref})$$

### 1.2 RLHF的问题

1. **复杂性**: 需要训练三个独立模型(SFT、RM、Policy)
2. **不稳定**: PPO训练LLM容易崩溃
3. **采样开销**: PPO需要on-policy采样(生成新样本)
4. **超参敏感**: PPO有很多需要调整的超参数

### 1.3 DPO的核心洞察

DPO的关键发现: 

> **可以跳过奖励模型训练，直接从偏好数据优化策略. **

![RLHF vs DPO](images/dpo_vs_rlhf.png)

**图片详细说明**: 

此图对比了**传统RLHF**与**DPO**的训练流程. 

**左侧: RLHF三阶段流程**

1. **Stage 1: SFT(监督微调)** 
   - 输入: 高质量标注数据
   - 输出: 初始策略 $\pi_{SFT}$
   - 目的: 让模型学会基本的指令遵循能力

2. **Stage 2: Reward Model Training(奖励模型训练)** 
   - 输入: 人类偏好数据 $(x, y_w, y_l)$，其中 $y_w$ 是人类更偏好的回复
   - 输出: 奖励模型 $r_\phi(x, y)$
   - 目的: 学习预测人类偏好

3. **Stage 3: PPO(强化学习优化)** 
   - 输入: 奖励模型 + 参考策略
   - 输出: 最终策略 $\pi_\theta$
   - 关键: 需要on-policy采样，训练不稳定

**右侧: DPO单阶段流程**

1. **Direct Optimization(直接优化)** 
   - 输入: 偏好数据 $(x, y_w, y_l)$ + 参考模型 $\pi_{ref}$
   - 输出: 最终策略 $\pi_\theta$
   - 关键: 跳过奖励模型，直接从偏好数据优化

**核心差异**: 
- RLHF需要显式训练奖励模型，然后用RL最大化奖励
- DPO证明可以将奖励模型"隐式地"合并到策略优化中
- 数学等价性: 隐式奖励 $\hat{r}(x,y) = \beta\log\frac{\pi_\theta(y|x)}{\pi_{ref}(y|x)}$

**实际影响**: DPO将3阶段简化为1阶段，更稳定、更高效. 

---

## 2. DPO的数学推导

### 2.1 Bradley-Terry偏好模型

人类偏好可以用Bradley-Terry模型描述: 

$$P(y_w \succ y_l | x) = \sigma(r(x, y_w) - r(x, y_l))$$

**符号解释**: 

- $P(y_w \succ y_l | x)$: 给定prompt $x$，$y_w$ 被偏好于 $y_l$ 的概率
- $\sigma(\cdot) = \frac{1}{1+e^{-(\cdot)}}$: sigmoid函数
- $r(x, y)$: 真实奖励函数(未知，需要从数据中学习)

### 2.2 RLHF目标函数的解析解

RLHF的优化目标是: 

$$\max_{\pi} \mathbb{E}_{x \sim \mathcal{D}, y \sim \pi(\cdot|x)}[r(x, y)] - \beta D_{KL}(\pi \| \pi_{ref})$$

**定理**: 这个优化问题有解析解: 

$$\pi^*(y|x) = \frac{1}{Z(x)} \pi_{ref}(y|x) \exp\left(\frac{1}{\beta} r(x, y)\right)$$

其中 $Z(x) = \sum_y \pi_{ref}(y|x) \exp(\frac{1}{\beta} r(x, y))$ 是归一化常数. 

**推导过程**: 

目标函数展开: 
$$J(\pi) = \mathbb{E}_{x, y \sim \pi}[r(x, y)] - \beta \mathbb{E}_x\left[\sum_y \pi(y|x) \log \frac{\pi(y|x)}{\pi_{ref}(y|x)}\right]$$

对 $\pi(y|x)$ 求变分导数并令其为零，可得上述解析解. 

### 2.3 从最优策略反解奖励

**关键推导**: 从解析解 $\pi^*$ 反解出奖励 $r$: 

从 $\pi^*(y|x) = \frac{1}{Z(x)} \pi_{ref}(y|x) \exp(\frac{1}{\beta} r(x, y))$

取对数: 
$$\log \pi^*(y|x) = \log \pi_{ref}(y|x) + \frac{1}{\beta} r(x, y) - \log Z(x)$$

移项得到**隐式奖励**: 
$$\boxed{r(x, y) = \beta \log \frac{\pi^*(y|x)}{\pi_{ref}(y|x)} + \beta \log Z(x)}$$

**核心洞察**: 奖励可以用策略的对数概率比来表示！

### 2.4 代入偏好模型

将隐式奖励代入Bradley-Terry模型: 

$$P(y_w \succ y_l | x) = \sigma\left(\beta \log \frac{\pi^*(y_w|x)}{\pi_{ref}(y_w|x)} - \beta \log \frac{\pi^*(y_l|x)}{\pi_{ref}(y_l|x)}\right)$$

注意 $\log Z(x)$ 项相消了！

整理得: 
$$P(y_w \succ y_l | x) = \sigma\left(\beta \log \frac{\pi^*(y_w|x)}{\pi_{ref}(y_w|x)} - \beta \log \frac{\pi^*(y_l|x)}{\pi_{ref}(y_l|x)}\right)$$

### 2.5 DPO损失函数

最大化偏好数据的对数似然: 

$$\mathcal{L}_{DPO}(\pi_\theta; \pi_{ref}) = -\mathbb{E}_{(x, y_w, y_l) \sim \mathcal{D}}\left[\log \sigma\left(\beta \log \frac{\pi_\theta(y_w|x)}{\pi_{ref}(y_w|x)} - \beta \log \frac{\pi_\theta(y_l|x)}{\pi_{ref}(y_l|x)}\right)\right]$$

**更简洁的形式**: 

定义**隐式奖励差**: 
$$\hat{r}_\theta(x, y) = \beta \log \frac{\pi_\theta(y|x)}{\pi_{ref}(y|x)}$$

则: 
$$\boxed{\mathcal{L}_{DPO} = -\mathbb{E}\left[\log \sigma\left(\hat{r}_\theta(x, y_w) - \hat{r}_\theta(x, y_l)\right)\right]}$$

---

## 3. DPO的直观理解

### 3.1 损失函数的梯度

对 $\mathcal{L}_{DPO}$ 求梯度: 

$$\nabla_\theta \mathcal{L}_{DPO} = -\beta \mathbb{E}\left[\underbrace{\sigma(\hat{r}_\theta(y_l) - \hat{r}_\theta(y_w))}_{\text{隐式奖励模型的错误概率}} \left[\nabla_\theta \log \pi_\theta(y_w) - \nabla_\theta \log \pi_\theta(y_l)\right]\right]$$

**直观理解**: 

1. $\sigma(\hat{r}_\theta(y_l) - \hat{r}_\theta(y_w))$: 当前模型"犯错"的程度(即认为 $y_l$ 更好的概率)

2. 梯度做两件事: 
   - **增大** $\log \pi_\theta(y_w)$: 提高好回复的概率
   - **减小** $\log \pi_\theta(y_l)$: 降低坏回复的概率

3. 权重由"犯错程度"决定: 
   - 如果模型已经正确地偏好 $y_w$，权重小，学习少
   - 如果模型错误地偏好 $y_l$，权重大，学习多

### 3.2 与交叉熵的联系

DPO本质上是一个**二元分类问题**: 

- 输入: $(x, y_w, y_l)$
- 标签: $y_w$ 应该比 $y_l$ 好
- 预测: 模型给出的隐式奖励差 $\hat{r}_\theta(y_w) - \hat{r}_\theta(y_l)$
- 损失: 二元交叉熵

---

## 4. DPO vs RLHF 对比

### 4.1 对比表

| 特性 | RLHF (PPO) | DPO |
|------|------------|-----|
| 阶段数 | 3 (SFT → RM → PPO) | 1 (直接优化) |
| 需要奖励模型 | ✓ | ✗ |
| 需要采样 | ✓ (on-policy) | ✗ (离线数据) |
| 训练稳定性 | 中(PPO敏感) | 高 |
| 计算开销 | 高 | 低 |
| 内存需求 | 高(多模型) | 中(2模型) |

### 4.2 数学等价性

DPO论文证明: 在无限数据和无限模型容量下，DPO和RLHF收敛到相同的最优策略. 

但在实践中: 
- **DPO更简单**: 只需要语言模型损失
- **DPO更稳定**: 没有PPO的不稳定因素
- **DPO更高效**: 不需要生成新样本

---

## 5. DPO的变体

### 5.1 IPO (Identity Preference Optimization)

**问题**: DPO可能过拟合偏好数据

**解决方案**: 添加正则化

$$\mathcal{L}_{IPO} = \mathbb{E}\left[\left(\hat{r}_\theta(y_w) - \hat{r}_\theta(y_l) - \frac{1}{\beta}\right)^2\right]$$

### 5.2 SimPO (Simple Preference Optimization)

**问题**: DPO需要保存参考模型

**解决方案**: 去掉参考模型，添加长度归一化

$$\mathcal{L}_{SimPO} = -\mathbb{E}\left[\log \sigma\left(\frac{\beta}{|y_w|} \log \pi_\theta(y_w) - \frac{\beta}{|y_l|} \log \pi_\theta(y_l) - \gamma\right)\right]$$

### 5.3 ORPO (Odds Ratio Preference Optimization)

**创新**: 使用odds ratio替代log ratio

$$\mathcal{L}_{ORPO} = \mathcal{L}_{SFT} + \lambda \cdot \mathbb{E}\left[-\log \sigma\left(\log \frac{\text{odds}_\theta(y_w)}{\text{odds}_\theta(y_l)}\right)\right]$$

其中 $\text{odds}_\theta(y) = \frac{P_\theta(y|x)}{1 - P_\theta(y|x)}$

### 5.4 对比总结

| 算法 | 需要参考模型 | 长度归一化 | 核心改进 |
|------|-------------|------------|----------|
| DPO | ✓ | ✗ | 隐式奖励 |
| IPO | ✓ | ✗ | 正则化 |
| SimPO | ✗ | ✓ | 简化 |
| ORPO | ✗ | ✗ | Odds ratio + SFT联合 |

---

## 6. 本章总结

### 6.1 核心公式

| 公式名称 | 数学表达式 |
|----------|------------|
| 隐式奖励 | $\hat{r}(x,y) = \beta \log \frac{\pi_\theta(y\|x)}{\pi_{ref}(y\|x)}$ |
| DPO损失 | $-\mathbb{E}[\log\sigma(\hat{r}(y_w) - \hat{r}(y_l))]$ |
| 梯度权重 | $\sigma(\hat{r}(y_l) - \hat{r}(y_w))$ (犯错概率) |

### 6.2 DPO的贡献

1. **理论突破**: 证明LLM本身就是隐式奖励模型
2. **实践简化**: 从3阶段减少到1阶段
3. **稳定高效**: 避免PPO的不稳定性
4. **广泛应用**: 成为LLM对齐的主流方法之一

---

## 7. 开源实现参考

- **TRL**: https://github.com/huggingface/trl (`DPOTrainer`)
- **verl**: https://github.com/volcengine/verl
- **LLaMA-Factory**: https://github.com/hiyouga/LLaMA-Factory

---

**下一章预告**: [第8章: GRPO与组相对优化](../08_GRPO/01_Theory_Derivation.md)
