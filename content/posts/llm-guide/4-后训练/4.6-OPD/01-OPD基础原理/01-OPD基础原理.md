---
title: "01 · OPD 基础原理：Reverse KL、On-Policy 与后训练革命"
date: 2026-05-16
tags: [OPD, Reverse KL, On-Policy, 知识蒸馏, 后训练, RL]
---

# 01 · OPD 基础原理：Reverse KL、On-Policy 与后训练革命

## 1. 背景与核心痛点 (Background & Pain Points)

当今大模型的后训练长久以来被夹在两座冰山之间. 左边是**监督微调(SFT)** ，模型在海量的“学霸满分试卷”上逐字模仿. 但一旦到了真实的测试环境，如果模型自己走错了一步(产生了与训练集不同的前缀)，它就完全不知道该如何挽救，只能“一步错，步步错”，这在学术界被称为**暴露偏差(Exposure Bias)** 与复合误差. 

右边是**强化学习**，模型被允许自己去探索解题空间(On-Policy). 但在探索完长达几千个 token 的推理链后，它只能得到一个干瘪的最终得分(+1 或 -1). 这导致了臭名昭著的**奖励稀疏(Sparse Reward)** 与信用分配问题(Credit Assignment)：模型根本不知道自己到底是哪一步做对了，哪一步做错了. 

**家谱定位**：On-Policy Distillation(OPD，在线策略蒸馏)正是站在这两座冰山中间的“第三极”. 它是整个 OPD 算法家族(包括后来的 OPSD、SDFT、SCOPE 等)的地基. 
**核心动机**：OPD 的诞生，正是为了应对 SFT 的 Exposure Bias 和 RL 的极低数据效率. 它试图在**学生模型自己采样的轨迹上**(On-Policy，解决 Exposure Bias)，利用**教师模型的密集分布信号**(Dense Supervision，解决奖励稀疏)，实现一种前所未有的高效后训练范式. 

## 2. 为什么重要 (Significance)

在《Qwen3 Technical Report》中，研究团队披露了一个震撼业界的数据：
从一个经过基础训练的 Checkpoint 出发，如果使用传统的 RL(强化学习)来提升数学推理能力(AIME'24 数据集)，需要耗费高达 **17,920 个 GPU 小时** 才能将准确率提升到 67.6%. 
而使用 OPD，仅需约 150 个 steps(约 77K prompts)，耗费 **1,800 个 GPU 小时**，就将分数一举推高到了 **74.4%**. 

**OPD 用大约十分之一的 RL 算力，做到了比 RL 显著更高的上限分数. ** 这种在算力经济学上的降维打击，使得 OPD 成为近两年(2025-2026)所有闭源/开源大厂后训练 pipeline 中不可或缺的核心组件. 

## 3. 直觉类比 (Intuition)

我们可以用“驾校学车”来类比三种不同的训练方式：

![SFT vs RL vs OPD 驾校类比](./images/opd_driving_analogy.png)
*图：SFT 就像看教练开车(不动手)，RL 就像蒙眼盲开(纯试错)，而 OPD 则是自己在赛道上开，教练在旁边做密集指导. *

- **SFT (Off-Policy)** ：教练(Teacher)在副驾驶握着方向盘跑完一整圈，你坐在旁边看着记. 一上路，如果你不小心把车开偏了 10 厘米，因为你从来没有学习过“在偏离路线时如何修正”，你大概率会直接把车开进沟里(暴露偏差). 

- **RL (On-Policy)** ：教练把你蒙上眼睛扔进车里，你自己瞎开(Rollout). 如果你撞树了，教练在结束时打你一顿(Score: -1); 如果你奇迹般地开到了终点，教练给你一块糖(Score: +1). 你要挨无数次打，才能慢慢试出哪条路是对的(奖励极度稀疏). 

- **OPD (在线蒸馏)** ：**你自己握着方向盘，亲自在赛道上开(On-Policy)** . 但在你踩下油门、打方向盘的**每一个瞬间(Every Token)** ，坐在副驾驶的教练都会大声告诉你：“如果你现在往左打死，生还概率是 90%; 如果往右打死，概率是 2%. ”(Dense Distribution Supervision). 你是在自己的驾驶轨迹上，接受教练最密集的纠偏指导. 

## 4. 数学推导与公式对比 (Mathematical Rigor)

OPD 的核心在于目标函数的根本性转变. 让我们直接对比 SFT 和 OPD 的损失函数. 

### 4.1 SFT 隐含的 Forward KL

在标准的 SFT 或 Off-Policy Distillation 中，学生模型 $\pi_\theta$ 试图最小化负对数似然损失：
$$
 \mathcal{L}_{SFT} = \mathbb{E}_{s_t \sim \pi_T} [ - \log \pi_\theta(a_t | s_t) ] \tag{1}
$$

- $\mathbb{E}_{s_t \sim \pi_T}$：期望的采样来自**教师模型 $\pi_T$**(或人类演示数据集). 状态 $s_t$ 是预设的. 
- $\log \pi_\theta(a_t | s_t)$：学生模型在给定教师状态下，生成正确动作 $a_t$ 的对数概率. 

这在数学上等价于最小化 **Forward KL (前向 KL 散度)** $D_{KL}(\pi_T \| \pi_\theta)$. 
Forward KL 的致命特点是 **Mean-Seeking(求均值)** 或 **Mass-Covering**. 如果老师会三种解法，学生为了把 KL 散度降到最低，会被迫将概率质量平均分配给这三种解法. 当学生能力有限时，它很容易在三种解法中产生四不像的“幻觉”. 

### 4.2 OPD 的 Reverse KL

OPD 逆转了这一过程，使用的是 **Reverse KL (逆向 KL 散度)** . 同族算法(如 GRPO, PPO)通常基于优势函数(Advantage)，而 **<u>OPD 的核心是直接对分布的差异求期望</u>**：

$$
 \mathcal{L}_{OPD} = \mathbb{E}_{s_t \sim \pi_\theta} [ D_{KL}(\pi_\theta(\cdot|s_t) \| \pi_T(\cdot|s_t)) ] \tag{2}
$$
让我们拆解这个极其优美的公式：
- $\mathbb{E}_{s_t \sim \pi_\theta}$：**[高亮差异项：采样源]** 注意期望的下标！现在的状态 $s_t$ 是由**学生模型 $\pi_\theta$ 自己生成**的(On-Policy). 这解决了 Exposure Bias，因为学生在训练时看到的就是它在推理时会遇到的状态. 
- $D_{KL}(\pi_\theta \| \pi_T)$：**[高亮差异项：散度方向]** 这是 Reverse KL. 展开它：
  $$
 \sum_{a} \pi_\theta(a|s_t) \left[ \log \pi_\theta(a|s_t) - \log \pi_T(a|s_t) \right] \tag{3}
$$
  - $\pi_\theta(a|s_t)$：权重项. 学生自己觉得概率很低的 token，哪怕老师觉得很重要，损失的权重也极小. 这意味着 **Reverse KL 是 Mode-Seeking(寻模态)的**. 
  - $\log \pi_\theta - \log \pi_T$：对数概率的差值，作为优化的梯度信号. 

学生不再强求学会老师所有的技能(Mass-covering). 只要在自己生成的轨迹上，挑一个自己最擅长、且老师也认可的方向(高概率对齐)，就能把 Loss 降下来. 这极大程度地避免了幻觉. 

## 5. 数值走查 (Numerical Example)

为了彻底理解 Forward KL 和 Reverse KL 对行为的影响，我们来看一个极其简化的 2-token 词表：$\mathcal{V} = \{A, B\}$. 

假设在一个特定的状态下，**教师(Teacher)** 的认知是模糊的，给出的真实分布为 $P_T = [0.5, 0.5]$(既可以选 A 也可以选 B). 
由于能力限制，**学生(Student)** 只能是极端的，只能输出 $P_S = [1.0, 0.0]$(死磕 A)或者 $P_S = [0.0, 1.0]$(死磕 B). 

**场景 1：如果强制使用 Forward KL (SFT 范式)** 
$$
 D_{KL}(P_T \| P_S) = \sum P_T \log \frac{P_T}{P_S} \tag{4}
$$
- 若学生选 $P_S = [1.0, 0.0]$，计算 $B$ 的 KL：$0.5 \log(0.5 / 0) \to +\infty$. 
- 结果：Loss 爆炸！Forward KL 强迫学生必须学会 B，即便学生没这个能力，最终导致崩溃. 

**场景 2：如果使用 Reverse KL (OPD 范式)** 
$$
 D_{KL}(P_S \| P_T) = \sum P_S \log \frac{P_S}{P_T} \tag{5}
$$
- 学生选 $P_S = [1.0, 0.0]$，此时只计算 $A$ 的项，因为当 $P_S(B)=0$ 时权重为 0. 
- 计算：$1.0 \times \log(1.0 / 0.5) = 1.0 \times 0.693 = 0.693$. 
- 结果：Loss 是一个非常小且稳定的标量. OPD 宽容了学生的偏科，允许学生“只挑自己会的且老师不反对的”那条路走. 

## 6. 简化实现 (PyTorch Code)

以下是单次 OPD 训练步(Step)的 50 行简化核心逻辑. 

```python
import torch
import torch.nn.functional as F

def opd_train_step(student_model, teacher_model, prompts, temperature=1.0):
    """
    在线策略蒸馏 (OPD) 核心训练逻辑
    prompts: list[str], 初始的问题输入
    """
    
    # 步骤 1: On-Policy 采样
    # 对应数学公式: s_t \sim \pi_\theta
    # 学生利用自己的参数进行自回归生成，获得轨迹 (Trajectories)
    student_model.eval() # 采样阶段不更新梯度
    with torch.no_grad():
        trajectories = student_model.generate(prompts, max_new_tokens=512)
    
    # 步骤 2: 计算学生在自己轨迹上的对数概率
    # 对应数学公式: \log \pi_\theta(a|s_t)
    student_model.train() # 切回训练模式
    student_logits = student_model(trajectories).logits
    student_logprobs = F.log_softmax(student_logits / temperature, dim=-1)
    
    # 步骤 3: 教师进行 Dense 评估
    # 对应数学公式: \log \pi_T(a|s_t)
    # 注意：教师的参数是冻结的，不传播梯度
    teacher_model.eval()
    with torch.no_grad():
        teacher_logits = teacher_model(trajectories).logits
        # 我们需要的是教师的概率分布作为 Target
        teacher_probs = F.softmax(teacher_logits / temperature, dim=-1)
    
    # 步骤 4: 计算 Reverse KL 损失
    # 对应数学公式: D_{KL}( \pi_\theta || \pi_T )
    # 在 PyTorch 中，kl_div 的输入是 (log_input, target) -> (log S, T)
    # 注意 reduction='batchmean' 是在全轨迹的 token 上求均值
    loss_kl = F.kl_div(
        input=student_logprobs,   # 学生的 log 概率
        target=teacher_probs,     # 教师的真实概率分布
        reduction='batchmean'
    ) * (temperature ** 2) # 温度缩放修正
    
    # 步骤 5: 反向传播与参数更新
    loss_kl.backward()
    # optimizer.step() 
    
    return loss_kl.item()
```

> **注释对应**：代码中的 `student_model.generate` 严格对应了公式中的 $\mathbb{E}_{s_t \sim \pi_\theta}$，这正是“On-Policy”物理意义的直接体现. 而 `kl_div` 的参数顺序明确了这是一个 Reverse KL 操作. 

## 7. 局限性与边界条件 (Limitations & Boundary Conditions)

世界上没有包治百病的算法，基础 OPD 同样面临严峻的工程挑战和数学边界：

1. **强教师依赖 (Teacher Dependency)** ：
   - **前置环境要求**：你需要一个显着强于当前学生模型的 Teacher 驻留在显存中. 这在预训练千亿参数模型时是几乎不可能的(因为你找不到比自己大一个代差且还能跑得动的开源模型). 

2. **状态崩塌 (Degeneration under High Entropy)** ：
   - **失效区域**：当教师的分布在某个状态极度平滑(High Entropy，即没有一个选项具有明显统治力，所有 token 概率都在 5% 左右)时，Reverse KL 的 Mode-seeking 特性会导致灾难. 学生会“强行捏造”一个极端的概率尖峰(比如 $P_S(A)=99\%$)，因为这样能让 Reverse KL Loss 变得极小，但这种“盲目自信”其实是错误的. 

- **物理根因**：Reverse KL 的公式 $\sum Q \log \frac{Q}{P}$，只要 $Q$ 集中在 $P$ 不是零的任意一个点，即便 $P$ 很平坦，散度也会非常小. 

## 8. 演进与承上启下 (Evolution & Segue)

针对基础 OPD 极度依赖外部“强教师”(Teacher Dependency)这一最大痛点，研究界开始了激烈的自救与演进. 

如果在实际工程中，我们根本掏不出多余的几百 GB 显存去跑一个 GPT-4 级别的 Teacher 模型怎么办？既然基础 OPD 的本质是“在同一条轨迹上，用高维的认知降维打击低维的生成”，**我们可不可以使用模型自己，通过赋予更长时间或更优越的上下文，来充当自己的 Teacher 呢？**

这自然催生了 OPD 家族中极具革命性的下一个核心算法——**OPSD(在线自蒸馏，Online Self-Distillation)** . 在没有外援的情况下，模型如何做到“左脚踩右脚上天”？请见下一篇技术剖析. 

## 9. 总结与参考文献 (References)

1. **On-Policy 采样**：通过让模型在自己生成的轨迹上训练，彻底消灭了 SFT 固有的 Exposure Bias. 

2. **Dense Supervision**：每个 Token 都有教师提供的稠密概率信号，极大地降低了强化学习中 Sparse Reward 的方差，使得训练成本降低了一个数量级. 

3. **Reverse KL 目标**：采用寻找众数(Mode-seeking)的散度衡量方式，允许模型只学习教师高概率且自己也擅长的部分，避免了强行覆盖未知空间而造成的幻觉. 

**参考文献：**
- MiniLLM: Knowledge Distillation of Large Language Models (arXiv: 2306.08543). URL: https://arxiv.org/abs/2306.08543
- GKD: Generalized Knowledge Distillation (arXiv: 2306.13649). URL: https://arxiv.org/abs/2306.13649
- Qwen3 Technical Report (Alibaba Group).
