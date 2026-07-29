# 第8章: 组相对策略优化 (Group Relative Policy Optimization, GRPO)

**论文信息**: 
- **标题**: DeepSeekMath: Pushing the Limits of Mathematical Reasoning in Open Language Models
- **作者**: Zhihong Shao et al. (DeepSeek)
- **年份**: 2024
- **arXiv**: 2402.03300
- **PDF**: 见 `papers/` 目录

**前置知识**: PPO(第5章)、DPO(第7章)

---

## 0. 本章目标

GRPO是**DeepSeek的核心创新**，也是DeepSeek-R1成功的关键因素之一. 

> **GRPO的核心思想**: 用组内均值作为基线，消除对价值网络的需求. 

本章将: 

1. 解释为什么GRPO比PPO更适合LLM
2. 详细推导GRPO的优势估计公式
3. 讨论标准差归一化的争议(Dr. GRPO)
4. 介绍GRPO的变体(GSPO、GMPO、DAPO)
5. 展示完整的代码实现

---

## 1. 从PPO到GRPO的动机

### 1.1 PPO在LLM中的问题

回顾PPO的优势估计需要**价值网络** $V_\phi(s)$: 

$$A_t = r_t + \gamma V(s_{t+1}) - V(s_t)$$

**公式符号详解**: 

| 符号 | 含义 | 类型 | 取值范围 |
|------|------|------|----------|
| $A_t$ | 时刻 $t$ 的**优势函数**(Advantage)，衡量当前动作相对于平均水平的好坏 | 标量 | $\mathbb{R}$ |
| $r_t$ | 时刻 $t$ 获得的**即时奖励**(Reward) | 标量 | 通常 $[-1, 1]$ 或 $[0, 1]$ |
| $\gamma$ | **折扣因子**(Discount Factor)，决定未来奖励的权重 | 标量 | $(0, 1)$，通常0.99 |
| $V(s_t)$ | 状态 $s_t$ 的**价值函数**(Value Function)，预测从该状态出发的期望累计奖励 | 标量 | $\mathbb{R}$ |
| $s_t$ | 时刻 $t$ 的**状态**(State)，在LLM中是prompt + 已生成的tokens | 向量 | 状态空间 |
| $s_{t+1}$ | 采取动作后的**下一个状态** | 向量 | 状态空间 |

**LLM场景的问题**: 

1. **价值网络开销**: 需要额外训练一个与LLM同等规模的价值网络
2. **训练不稳定**: 价值网络和策略网络需要同步训练
3. **显存占用**: 多一个模型副本，显存需求翻倍

### 1.2 GRPO的解决方案

**核心洞察**: 在LLM生成场景，我们可以对同一个prompt采样多个response，用**组内均值**作为基线！

$$A_i = R_i - \underbrace{\bar{R}}_{\text{组均值基线}}$$

**公式符号详解**: 

| 符号 | 含义 | 类型 | 取值范围 |
|------|------|------|----------|
| $A_i$ | 第 $i$ 个response的**优势值**，表示该response相对于组内平均水平的好坏 | 标量 | $\mathbb{R}$ |
| $R_i$ | 第 $i$ 个response获得的**奖励**(来自奖励模型或规则验证器) | 标量 | 通常 $[0, 1]$ 或 $\{0, 1\}$ |
| $\bar{R}$ | **组内均值基线**，所有response奖励的算术平均 $\bar{R} = \frac{1}{G}\sum_{j=1}^G R_j$ | 标量 | 同 $R_i$ |
| $i$ | response的**索引**，$i \in \{1, 2, \ldots, G\}$ | 整数 | $[1, G]$ |
| $G$ | **组大小**(Group Size)，即每个prompt采样的response数量 | 整数 | 通常 $4, 8, 16$ |

**优势**: 
- 无需价值网络 → 节省显存
- 无需训练价值函数 → 更稳定
- 更符合LLM的评估方式(比较多个response)

---

## 2. GRPO的数学推导

### 2.1 组采样设置

对于每个prompt $x$，采样 $G$ 个response: 

$$\{y_1, y_2, \ldots, y_G\} \sim \pi_\theta(\cdot | x)$$

**公式符号详解**: 

| 符号 | 含义 | 类型 | 说明 |
|------|------|------|------|
| $x$ | **输入prompt**，用户的问题或指令 | 字符串/token序列 | 例如 "Solve: 2+2=" |
| $y_i$ | 第 $i$ 个**采样的response**，模型的完整回复 | 字符串/token序列 | 例如 "The answer is 4." |
| $G$ | **组大小**，每个prompt采样的response数量 | 正整数 | 典型值: 8 |
| $\pi_\theta$ | **当前策略**(参数为$\theta$的语言模型) | 概率分布 | $\pi_\theta(y|x)$ 表示给定$x$生成$y$的概率 |
| $\theta$ | 语言模型的**可训练参数** | 向量 | 模型权重 |
| $\sim$ | **采样符号**，表示从分布中采样 | 操作 | - |

每个response获得奖励: 

$$R_i = r(x, y_i) \quad \text{for } i = 1, \ldots, G$$

**公式符号详解**: 

| 符号 | 含义 | 类型 | 说明 |
|------|------|------|------|
| $R_i$ | 第 $i$ 个response的**奖励值** | 标量 | 通常 $\in [0, 1]$ |
| $r(x, y_i)$ | **奖励函数**，评估response $y_i$ 对prompt $x$ 的质量 | 函数 | 可以是奖励模型或规则验证器 |
| $i$ | response的**索引** | 整数 | $i \in \{1, \ldots, G\}$ |

### 2.2 优势估计

**原始GRPO**使用归一化的优势: 

$$\boxed{A_i = \frac{R_i - \bar{R}}{\sigma_R + \epsilon}}$$

**公式各项详解**: 

| 符号 | 含义 | 计算方式 | 说明 |
|------|------|----------|------|
| $A_i$ | 第 $i$ 个response的**归一化优势** | 见公式 | 正值=好于平均，负值=差于平均 |
| $R_i$ | 第 $i$ 个response的**奖励** | 由奖励函数给出 | - |
| $\bar{R}$ | **组内均值基线** | $\bar{R} = \frac{1}{G} \sum_{j=1}^G R_j$ | 所有response奖励的平均值 |
| $\sigma_R$ | **组内标准差** | $\sigma_R = \sqrt{\frac{1}{G-1} \sum_{j=1}^G (R_j - \bar{R})^2}$ | 衡量奖励的离散程度 |
| $\epsilon$ | **数值稳定项** | 常数，通常 $10^{-5}$ | 防止除以零 |
| $G$ | **组大小** | 正整数 | 分母中使用 $G-1$ 计算无偏标准差 |

**为什么除以标准差？**
- 当奖励差异大时($\sigma_R$ 大)，缩小优势幅度，防止过大更新
- 当奖励差异小时($\sigma_R$ 小)，放大优势幅度，加速学习

---

### 图解: GRPO组采样与优势估计

![GRPO组采样与优势估计](images/group_sampling.png)

**图片详细说明**: 

此图展示了GRPO算法的核心机制——组采样(Group Sampling)与优势估计(Advantage Estimation). 

**图片结构**(从上到下): 

1. **顶部: SINGLE PROMPT**(单个输入提示)
   - 表示用户输入的问题或指令
   - 例如: "请计算 $\sqrt{144}$ 的值"

2. **中部: RESPONSE SAMPLE 1-8**(8个响应样本)
   - 每个方框代表从策略 $\pi_\theta$ 采样的一个独立response
   - $G = 8$ 表示组大小为8
   - 每个response都是完整的文本生成结果

3. **每个response下方: R1=8.5, R2=6.2, ...**(奖励值)
   - $R_i$ 是第 $i$ 个response获得的奖励分数
   - 来自奖励模型 $r(x, y_i)$ 或规则验证器
   - 范围通常是 $[0, 10]$ 或 $[0, 1]$

4. **下部左侧: BASELINE CALCULATION**(基线计算)
   - **Mean Reward(均值奖励)** : $\mu = \frac{\sum R_i}{G} \approx 6.875$
     - 这是所有response奖励的算术平均
     - 作为"平均水平"的基线
   - **Standard Deviation(标准差)** : $\sigma = \sqrt{\frac{\sum(R_i - \mu)^2}{G-1}} \approx 1.48$
     - 衡量奖励的离散程度
     - 用于归一化优势值

5. **下部右侧: ADVANTAGE FORMULA**(优势公式)
   - 公式: $A_i = \frac{R_i - \mu}{\sigma}$
   - **A5的计算示例**: $A_5 = \frac{9.1 - 6.875}{1.48} \approx +1.50$(**正优势**，蓝色高亮)
     - 含义: Response 5的奖励9.1高于均值6.875，是"好的"response
     - 正优势会增加该response的生成概率
   - **A6的计算示例**: $A_6 = \frac{4.9 - 6.875}{1.48} \approx -1.33$(**负优势**，橙色高亮)
     - 含义: Response 6的奖励4.9低于均值6.875，是"差的"response
     - 负优势会降低该response的生成概率

**关键理解**: 
- GRPO用**组内均值 $\bar{R}$** 替代PPO中的**价值网络 $V(s)$**
- 无需额外训练价值函数，大幅简化LLM的RL训练
- 正优势 → 增加概率; 负优势 → 降低概率

---

### 2.3 GRPO损失函数

基于PPO的裁剪目标，但使用组优势: 

$$\mathcal{L}^{GRPO} = -\mathbb{E}_{x}\left[\frac{1}{G}\sum_{i=1}^G \min\left(r_i(\theta) A_i, \text{clip}(r_i, 1-\epsilon, 1+\epsilon) A_i\right)\right]$$

**公式各项逐一详解**: 

| 符号 | 含义 | 详细说明 |
|------|------|----------|
| $\mathcal{L}^{GRPO}$ | **GRPO损失函数**，需要最小化 | 负号是因为我们想最大化期望回报 |
| $\mathbb{E}_x$ | 对所有**prompt $x$** 的期望 | 遍历训练数据中的prompts |
| $\frac{1}{G}$ | 对组内求**平均** | 每个prompt有 $G$ 个response |
| $\sum_{i=1}^G$ | 对组内所有**response求和** | 遍历 $i = 1, 2, \ldots, G$ |
| $r_i(\theta)$ | 第 $i$ 个response的**概率比率** | $r_i = \frac{\pi_\theta(y_i|x)}{\pi_{\theta_{old}}(y_i|x)}$，衡量策略更新幅度 |
| $A_i$ | 第 $i$ 个response的**优势值** | 由2.2节公式计算 |
| $\text{clip}(r_i, 1-\epsilon, 1+\epsilon)$ | **裁剪函数**，限制概率比率范围 | $\epsilon$ 通常为0.2 |
| $\min(\cdot, \cdot)$ | 取**较小值** | 悲观估计，防止过大更新 |

**概率比率 $r_i(\theta)$ 的详细定义**: 

$$r_i(\theta) = \frac{\pi_\theta(y_i | x)}{\pi_{\theta_{old}}(y_i | x)}$$

| 符号 | 含义 | 说明 |
|------|------|------|
| $\pi_\theta(y_i\|x)$ | **当前策略**生成response $y_i$ 的概率 | 参数为 $\theta$ 的LLM |
| $\pi_{\theta_{old}}(y_i\|x)$ | **旧策略**生成response $y_i$ 的概率 | 采样时的LLM参数 |
| $r_i > 1$ | 当前策略更可能生成 $y_i$ | 概率增加了 |
| $r_i < 1$ | 当前策略更不可能生成 $y_i$ | 概率降低了 |
| $r_i = 1$ | 策略未变化 | 概率不变 |

**裁剪机制的作用**: 

| 情况 | $A_i > 0$(好response) | $A_i < 0$(差response) |
|------|-------------------------|-------------------------|
| $r_i > 1+\epsilon$ | 裁剪生效，限制增加 | 不裁剪，鼓励降低 |
| $r_i < 1-\epsilon$ | 不裁剪，鼓励增加 | 裁剪生效，限制降低 |
| $r_i \in [1-\epsilon, 1+\epsilon]$ | 正常更新 | 正常更新 |

---

### 2.4 完整目标函数

加上KL惩罚防止偏离参考模型: 

$$\mathcal{L} = \mathcal{L}^{GRPO} + \beta \cdot \mathbb{E}\left[D_{KL}(\pi_\theta \| \pi_{ref})\right]$$

**公式各项详解**: 

| 符号 | 含义 | 说明 |
|------|------|------|
| $\mathcal{L}$ | **总损失函数** | 需要最小化 |
| $\mathcal{L}^{GRPO}$ | **GRPO策略损失** | 见2.3节 |
| $\beta$ | **KL惩罚系数** | 通常 $0.01 \sim 0.1$，控制偏离程度 |
| $D_{KL}(\pi_\theta \| \pi_{ref})$ | **KL散度** | 衡量当前策略与参考策略的差异 |
| $\pi_{ref}$ | **参考策略** | 通常是SFT后的初始模型 |

---

## 3. 标准差归一化争议 (Dr. GRPO)

### 3.1 问题发现

论文 "Dr. GRPO" 指出原始GRPO中除以标准差可能有问题: 

**问题1: 方差坍缩**
当所有response奖励相近时，$\sigma_R \to 0$，导致优势爆炸. 

**问题2: 信号放大**
即使原始奖励差很小，归一化后可能变得很大. 

### 3.2 Dr. GRPO的建议

**移除标准差归一化**: 

$$A_i^{Dr} = R_i - \bar{R}$$

**公式符号详解**: 

| 符号 | 含义 | 与原始GRPO的区别 |
|------|------|------------------|
| $A_i^{Dr}$ | Dr. GRPO的**未归一化优势** | 不除以 $\sigma_R$ |
| $R_i$ | 第 $i$ 个response的奖励 | 相同 |
| $\bar{R}$ | 组内均值基线 | 相同 |

这样优势直接反映奖励差距，更稳定. 

### 3.3 代码对比

```python
# 原始GRPO
def grpo_advantage(rewards, group_size, eps=1e-5):
    rewards = rewards.view(-1, group_size)
    mean = rewards.mean(dim=1, keepdim=True)
    std = rewards.std(dim=1, keepdim=True)
    return ((rewards - mean) / (std + eps)).view(-1)

# Dr. GRPO (推荐)
def dr_grpo_advantage(rewards, group_size):
    rewards = rewards.view(-1, group_size)
    mean = rewards.mean(dim=1, keepdim=True)
    return (rewards - mean).view(-1)
```

---

## 4. GRPO变体

### 4.1 GSPO (Group Sequence Policy Optimization)

**来源**: Qwen3技术报告

**创新**: 序列级重要性比率

$$r^{GSPO}(\theta) = \exp\left(\sum_t \log \pi_\theta(y_t|y_{<t}) - \sum_t \log \pi_{old}(y_t|y_{<t})\right)$$

**公式符号详解**: 

| 符号 | 含义 | 说明 |
|------|------|------|
| $r^{GSPO}$ | **序列级概率比率** | 在log空间求和后再exp |
| $\sum_t$ | 对所有**token位置 $t$** 求和 | $t = 1, 2, \ldots, T$，$T$ 是序列长度 |
| $\log \pi_\theta(y_t\|y_{<t})$ | 当前策略对第 $t$ 个token的**log概率** | 条件于前面的tokens |
| $\pi_{old}$ | 旧策略 | 采样时的策略 |
| $\exp(\cdot)$ | 指数函数 | 将log空间转回原空间 |

**与GRPO的区别**: GRPO在token级计算比率后相乘(可能溢出)，GSPO在log空间求和后取exp(更稳定). 

---

## 5. 本章总结

### 5.1 核心公式汇总

| 公式名称 | 数学表达式 | 关键符号说明 |
|----------|------------|--------------|
| 组优势 (原始) | $A_i = (R_i - \bar{R}) / \sigma_R$ | $\bar{R}$=组均值, $\sigma_R$=组标准差 |
| 组优势 (Dr.) | $A_i = R_i - \bar{R}$ | 无标准差归一化 |
| GRPO损失 | $-\mathbb{E}[\frac{1}{G}\sum_i\min(r_i A_i, \text{clip}(r_i) A_i)]$ | $r_i$=概率比率, $G$=组大小 |
| 组均值基线 | $\bar{R} = \frac{1}{G}\sum_j R_j$ | $R_j$=第$j$个response的奖励 |

### 5.2 GRPO的贡献

1. **消除价值网络**: 大幅减少显存和训练复杂度
2. **更适合LLM**: 与LLM的生成式评估方式匹配
3. **DeepSeek成功基石**: R1系列的核心训练算法
4. **催生一系列变体**: GSPO、GMPO、DAPO等

---

## 6. 开源实现参考

- **verl**: https://github.com/volcengine/verl (官方支持GRPO)
- **OpenRLHF**: https://github.com/OpenLLMAI/OpenRLHF
- **TRL**: 即将支持

---

**下一章预告**: [第9章: DAPO与解耦裁剪](../09_DAPO/01_Theory_Derivation.md)
