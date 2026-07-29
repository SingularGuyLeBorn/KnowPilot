# 第17章: GDPO / SteerLM (Guided Distribution Policy Optimization)

**论文信息**: 
- **标题**: SteerLM: Attribute Conditioned SFT as an (User-Friendly) RLHF Alternative
- **作者**: Yi Dong, Zhilin Wang, et al. (NVIDIA)
- **年份**: 2023
- **arXiv**: 2310.10696
- **PDF**: 见 `papers/` 目录

**注**: 在本知识库中，GDPO (Guided Distribution Policy Optimization) 指代 NVIDIA 提出的这种基于多维属性引导的优化方法(也称为 SteerLM)，因为它通过操控多维度奖励分布来引导策略生成. 

**前置知识**: SFT、条件生成 (Conditional Generation)

---

## 0. 本章摘要

传统的 RLHF(PPO)或 DPO 都是将人类偏好压缩为一个标量奖励(Single Scalar Reward): "好" 或 "坏". 
然而，人类对文本的评价是多维度的: 
- "这个回答很有用 (Helpfulness: 9)，但不幽默 (Humor: 1)"
- "这个回答很幽默 (Humor: 9)，但是在胡说八道 (Correctness: 0)"

如果我们只用单纯的优/劣去训练，模型可能会学会一种折中的、平庸的风格，或者为了讨好人类而牺牲真实性(Sycophancy). 

NVIDIA 提出的 **SteerLM (GDPO)** 核心思想是: **与其训练模型去猜测人类想要什么，不如让模型根据显式的属性标签(Attribute Tags)来生成. **

在推理时，我们只需要告诉模型: "请给我一个 Helpfulness=10, Humor=10, Toxicity=0 的回答"，模型就会朝着这个方向生成. 这使得对齐过程变得**可控**且**无需复杂的 PPO 训练**. 

本章将: 
1. 介绍 Attribute Conditioned SFT 的数学原理. 
2. 解释如何构建多维属性标注数据 (HelpSteer Dataset). 
3. 推导为何这种简单的 SFT 能够替代复杂的 RLHF. 
4. 实现多维条件生成的代码逻辑. 

---

## 1. 痛点: 标量奖励的局限性

### 1.1 奖励压缩带来的信息丢失

在 PPO 中，Reward Model  $R(x, y) \to \mathbb{R}$ 输出一个实数. 
训练过程中，模型为了最大化这个实数，可能会探索出一些 Reward Hacking 的捷径(例如: 增加回复长度通常能骗得高分). 
而且，标量奖励无法区分"风格偏好"和"事实错误". 

### 1.2 用户需求的多样性

有些用户喜欢简洁的回答，有些用户喜欢详尽的解释. 
RLHF 通常只能对齐到"大众平均偏好". 
SteerLM 允许在一个模型中通过 Prompt 微调来满足不同偏好. 

---

## 2. SteerLM 方法论

SteerLM 分为四步: 

1.  **Step 1: 训练属性预测模型 (Attribute Prediction Model)** 
    训练一个能够给 (Prompt, Response) 打分的模型. 
    输出不再是标量，而是一个向量: $[Helpfulness, Correctness, Coherence, Complexity, Verbosity, ...]$. 
    可以使用 Llama-2-13B 等基座进行 SFT 训练. 

2.  **Step 2: 标注数据集 (Dataset Annotation)** 
    利用 Step 1 的模型，给大规模 SFT 数据集(如 OpenAssistant, ShareGPT)中的每个样本打分. 
    得到数据格式: $(x, y) \to (x, y, \mathbf{a})$，其中 $\mathbf{a}$ 是属性向量. 

3.  **Step 3: 属性条件微调 (Attribute Conditioned SFT)** 
    将属性向量转换为文本 Prompt，拼接到输入中. 
    输入: `[Prompt] Question? [Attributes] Helpfulness:9, Correctness:8 [Response]`
    目标: $\max \log P(y | x, \mathbf{a})$

4.  **Step 4: 推理引导 (Inference Steering)** 
    在推理时，人为构造一个"完美属性"的 Prompt. 
    输入: `[Prompt] Question? [Attributes] Helpfulness:10, Correctness:10 [Response]`
    模型就会尝试生成符合这些高分的回答. 

---

## 3. 为什么这有效？ (GDPO 的数学解释)

我们可以将 RLHF 看作是寻找一个策略 $\pi$，最大化 $\mathbb{E}[R(y)]$. 
SteerLM 实际上是在学习一个条件分布 $P(y | x, R)$. 

根据贝叶斯公式: 
$$ P(y | x, R=High) \propto P(R=High | x, y) \cdot P(y|x) $$

- $P(y|x)$: 基座模型的能力(先验). 
- $P(R=High | x, y)$: 判别器(Attribute Model)认为这个回答得分高的概率. 

SteerLM 通过 SFT 直接拟合了 $P(y | x, \mathbf{a})$. 当我们把 $\mathbf{a}$ 设为高分时，我们就相当于在从高奖励区域采样. 

这与 **Decision Transformer** 或 **Upside-Down RL** 的思想如出一辙: **将强化学习问题转化为序列建模问题 (RL as Sequence Modeling). **

---

## 4. 多维奖励设计

NVIDIA 的 HelpSteer 数据集定义了以下维度: 

1.  **Helpfulness**: 回答是否有助于解决问题. 
2.  **Correctness**: 事实是否准确. 
3.  **Coherence**: 逻辑是否连贯. 
4.  **Complexity**: 内容深浅. 
5.  **Verbosity**: 啰嗦程度. 

在 GDPO 中，我们可以显式控制 **Verbosity**. 
- 如果用户问 "Explain Quantum Physics to a 5-year old"，我们可以设置 `Complexity:0, Verbosity:2`. 
- 如果用户问 "Derive Schrodinger Equation"，我们可以设置 `Complexity:10, Verbosity:8`. 

这种灵活性是 PPO 很难做到的(PPO 需要针对每种偏好重新训练一个 Reward Model). 

---

## 5. 代码实现逻辑

SteerLM 的核心不在于复杂的 Loss 函数(因为 Loss 就是标准的 Cross Entropy)，而在于**数据构造**. 

```python
def format_steerlm_input(prompt, response, attributes):
    """
    构造 SteerLM 的输入格式
    attributes: {"helpfulness": 4, "correctness": 4}
    """
    attr_str = ",".join([f"{k}:{v}" for k, v in attributes.items()])
    
    # Template: 
    # System: You are a helpful AI.
    # User: {prompt}
    # PA (Predicted Attributes): {attr_str}
    # Assistant: {response}
    
    return f"User: {prompt}\nPA: {attr_str}\nAssistant: {response}"

# 训练时: 使用真实的 attributes 标签
# 推理时: 使用期望的 attributes (全10分)
```

---

## 6. 与 DPO 的对比

| 维度 | DPO | SteerLM (GDPO) |
|------|-----|----------------|
| **优化目标** | 最大化 hidden reward gap | 拟合 conditional distribution |
| **数据需求** | 成对 (Preference Pairs) | 单点 (Pointwise Attributes) |
| **可控性** | 低 (只能由 RM 决定) | **极高 (推理时可调)** |
| **训练稳定性** | 中 (需调节 Beta) | **高 (纯 SFT)** |
| **上限** | 理论上更高 (RL探索) | 受限于数据分布覆盖 |

**GDPO 的局限**: 如果训练数据中从来没有出现过 Helpfulness=10 的样本，单纯在推理时输入 "Helpfulness:10" 是泛化不到该区域的(Out-of-Distribution). 这时候 RL (PPO/DPO) 的探索能力就很重要了. 

---

## 7. 本章总结

### 7.1 核心思想
**RL as Conditional Generation**. 将"优化目标"变成了"输入条件". 

### 7.2 贡献
1. **多目标对齐**: 在一个模型里同时解决有用性、安全性、风格化等多个目标. 
2. **极简训练**: 回归到最稳定的 Cross Entropy Loss. 

---

**下一章预告**: [GHPO (Guided Hybrid Policy Optimization)](../18_GHPO/01_Theory_Derivation.md) - 结合 SFT 和 PPO 的混合体. 
