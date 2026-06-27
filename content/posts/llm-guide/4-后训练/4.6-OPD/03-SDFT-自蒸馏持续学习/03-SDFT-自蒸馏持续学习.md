---
title: "03 · SDFT: 自蒸馏持续学习 — 逆向强化学习视角的破局"
date: 2026-05-16
tags: [SDFT, Self-Distillation, Continual Learning, OPD, 知识蒸馏, 后训练, IRL]
---

# 03 · SDFT: 自蒸馏持续学习 — 逆向强化学习视角的破局

## 1. 背景与核心痛点 (Background & Pain Points)

**家谱定位**: 本算法是 OPD(在线策略蒸馏)与 OPSD(在线自蒸馏)的自然延伸，它致力于将自蒸馏思想引入到一个极其恶劣且常见的真实工业场景——持续学习(Continual Learning). 

**前车之鉴**: 在上一篇《02-OPSD》中，我们证明了模型可以通过查看标准答案(开卷考)来教导未看答案的自己. 然而，在真实的工业迭代中，我们往往需要让一个已经部署的大语言模型**源源不断地学习新技能**(例如: 今天学医学问答，明天学外部 API 工具调用，后天学写特定的 SQL). 
如果你使用传统的监督微调(SFT)向模型持续灌输这些新知识，立刻就会遭遇深度学习领域最绝望的诅咒: **灾难性遗忘(Catastrophic Forgetting)** . 模型一旦在新任务上拟合，其原本的通用常识、长链条推理能力就会迅速崩溃. 更可怕的是，如果直接用过于简短的人工示范去微调一个带有思维链(CoT)的模型，SFT 会直接“压塌”模型的思考长度，使其退化为盲目抢答的复读机. 

**核心动机**: SDFT(Self-Distillation Fine-Tuning)的诞生，正是为了应对“新任务注入必然破坏旧有分布”的现实约束. 它提出了一个天才的设想: 如果我们只有极少量的示范数据(Demonstrations)，且无法承担训练外部奖励模型(Reward Model)的高昂成本，能不能利用 OPSD 的自蒸馏机制，让模型在**不破坏自身原有推理风格的前提下，优雅地吸收新知识**？

## 2. 为什么重要 (Significance)

在《Self-Distillation Enables Continual Learning (arXiv: 2601.19897)》的实证中，SDFT 展现出了令人侧目的性能保全能力: 

当让模型按顺序连续学习 Tool Use(工具调用)、Science Q&A(科学问答)和 Medical(医学)三个领域的技能时: 
- 传统的 SFT: 在学习 Tool Use 时，旧任务平均分从 65.5 暴跌到 56.0. 

- **SDFT**: Tool Use 新任务准确率达到 70.6%(甚至略超 SFT)，**同时旧能力平均分死死咬住在 65.4%**，几乎完美抵御了遗忘. 

更令人震惊的是它对**推理模型(Reasoning Model)的保护**. 当在没有中间推理步骤标注的数据上训练时: 
- 基础模型的平均生成长度为 4612 tokens. 
- SFT 后，长度剧烈坍缩至 3273 tokens，准确率从 31.2% 跌穿至 23.5%(因为模型学会了直接吐出简短但错误的答案). 

- **SDFT 后，生成长度依然保持在 4180 tokens 的深度思考状态，准确率暴涨至 43.7%**. 

SDFT 证明了: 持续学习的解药，就藏在模型自身极其强大的上下文学习(In-Context Learning)能力之中. 

## 3. 直觉类比 (Intuition)

我们可以用**“武林高手学新招”**来直观感受 SFT 与 SDFT 的天壤之别. 

![灾难性遗忘与SDFT持续学习对比](./images/sdft_continual_learning.png)
*图: SFT 就像粗暴地替换大脑齿轮，导致旧齿轮脱落(遗忘); SDFT 则是由一个看过秘籍的高维全息自我，引导低维本体将新齿轮平滑咬合进原有系统. *

- **SFT (填鸭式硬背)** : 高手看到一本新剑谱(Demonstration)，他不管自己以前练了十年的内功心法，强行照猫画虎地模仿剑谱上的动作. 结果动作是学会了，但一上场，因为内力和招式冲突，走火入魔，连最基础的出拳都不会了(推理链崩塌，灾难性遗忘). 

- **SDFT (自我融会贯通)** : 高手先给自己倒杯茶，**仔细阅读并理解这本剑谱(Demonstration-Conditioned Teacher)** . 在这个“领悟”状态下，高手脑子里推演出了这套剑法该怎么打. 接着，他让**没有拿剑谱的本体(Student)** 在演武场上挥剑(On-Policy 采样). 每挥一剑，那个“领悟状态的自我”就会用心法去纠正他: “这一步你原本的内功运行是对的，只需要在出招角度上偏向剑谱三分即可. ” 这样，新招式被完美融入了旧有的神经回路. 

## 4. 数学推导与公式对比: 隐式 IRL 的优美证明 (Mathematical Rigor)

SDFT 最惊艳的学术贡献，并不在于它设计了一个多么复杂的架构，而在于它通过极其严密的数学推导，证明了: **带有示范上下文的自蒸馏，在数学上等价于一种无需奖励模型的逆向强化学习(Implicit IRL)** . 

在讲解核心公式之前，我们先来看看 SDFT 是如何运作的: 
- **学生模型(Student)** : $\pi_\theta(\cdot|x)$，仅观察任务输入 $x$. 

- **教师模型(Teacher)** : $\pi_T(\cdot|x, d)$，同时观察输入 $x$ 和少量的高质量人工示范 $d$(Demonstrations). 

两者模型权重完全一致，教师只是因为多看了几个 Few-Shot 示例，被临时激发成了“高维形态”. 
此时，学生去逼近教师，采用 **Reverse KL** 散度: 
$$ \mathcal{L}_{SDFT} = \mathbb{E}_{x \sim \mathcal{D}} \left[ \underline{\mathbf{D_{KL}(\pi_\theta(\cdot|x) \| \pi_T(\cdot|x, d))}} \right] \tag{1} $$

### 4.1 为什么要与 RL 对比？隐式 IRL 视角的引入
标准的基于信赖域(Trust-Region)的强化学习目标(如 PPO)包含两项: 最大化外部奖励，同时不偏离参考模型太远. 
我们来看标准 RL 的目标函数: 
$$ \max_\theta \mathbb{E}_{y \sim \pi_\theta}[R(y)] - \beta \underline{\mathbf{D_{KL}(\pi_\theta(\cdot|x) \| \pi_{ref}(\cdot|x))}} \tag{2} $$
- $R(y)$: 环境或外部 Reward Model 给出的奖励分数. 
- $\beta$: KL 惩罚系数. 

通过变分推断求导，这个 RL 目标的理论闭式最优解(Optimal Policy)是: 
$$ \pi^*(y|x) \propto \pi_{ref}(y|x) \exp \left( \frac{R(y)}{\beta} \right) \tag{3} $$

### 4.2 惊天替换: The In-Context Assumption
在持续学习中，我们**没有外部奖励模型 $R(y)$**，只有几个正确示范 $d$. 
SDFT 提出了一个大胆的假设(In-Context Assumption): 
**“一个极强的底层模型，在看到了正确的示范 $d$ 之后，它输出的概率分布 $\pi_T(y|x, d)$，就已经极其逼近那个我们梦寐以求的最优策略 $\pi^*(y|x)$. ”**

即:  $\pi_T(y|x, d) \approx \pi^*(y|x)$. 

将这个假设代入上面那个 RL 最优解的等公公式子中，做对数变换，我们得到了一个令人拍案叫绝的结论——**隐式奖励函数(Implicit Reward)** : 

$$ R_{implicit}(y) \approx \beta \cdot \left[ \underline{\mathbf{\log \pi_T(y|x, d)}} - \underline{\mathbf{\log \pi_{ref}(y|x)}} \right] \tag{4} $$
**[公式物理意义详析]**: 
- **这是什么？** 这意味着，我们根本不需要去人工标注十万条偏好数据来训练一个 Reward Model. 

- **如何计算分数？** 任何一条轨迹 $y$ 的“奖励分数”，可以直接用【看过示范的教师给它的打分 $\log \pi_T$】减去【无知状态下的基础模型给它的打分 $\log \pi_{ref}$】来计算！

- **本质机理**: 如果一个 Token 在加上示范后，被老师极其看好($\log \pi_T$ 暴涨)，而基础模型原本不看好它，说明这个 Token 抓住了示范的精髓，它将获得极高的 Implicit Reward; 反之，如果一个 Token 原本是模型就爱说的废话，加上示范后依然是废话(两者打分不变)，Reward 将趋近于 0. 

这从根本上解释了为什么 SDFT 能够抵御灾难性遗忘: 因为它在数学本质上，是一种用旧有模型作为 $\pi_{ref}$ 锚点，用 Demonstration 提取相对奖励的强化学习算法. 

## 5. 数值走查 (Numerical Example)

让我们用真实数值走查一遍这个“隐式奖励”是如何产生的. 

假设用户输入 $x=$ `计算 35+12`. 没有给推理示范. 
- 基础状态下，模型想直接抢答，下一个 Token `47` 的初始概率 $\log \pi_{ref}(47 | x) = -0.5$. 而老老实实写推理步骤的 Token `拆分` 的概率 $\log \pi_{ref}(拆分 | x) = -2.3$. 

现在，我们给教师模型加上极其严谨的 CoT 示范 $d$(如“计算 13+15，拆分为...”). 
- 教师模型看到了 $d$，变得严谨了. 它给直接抢答 `47` 打出的概率暴跌: $\log \pi_T(47 | x, d) = -4.0$. 
- 它给老实推理的 `拆分` 打出的概率暴涨: $\log \pi_T(拆分 | x, d) = -0.2$. 

计算隐式奖励 $R_{implicit}(y)$: 
- 对于抢答 `47`: $R \propto (-4.0) - (-0.5) = \mathbf{-3.5}$ (严重负奖励，惩罚！)
- 对于推理 `拆分`: $R \propto (-0.2) - (-2.3) = \mathbf{+2.1}$ (高额正奖励，鼓励！)

通过自蒸馏的 KL 散度下降，这套隐式的正负反馈被直接写入了学生模型的权重中，从而完美矫正了 SFT 那种不管三七二十一“只看绝对值硬背”的恶习. 

## 6. 简化实现 (PyTorch Code)

在 SDFT 的工程实现中，最重要的一环是**教师模型必须使用 EMA(指数滑动平均)更新**，如果教师和学生完全实时同步更新，会导致严重的崩溃(由于没有外部锚点，左脚踩右脚极容易双脚腾空摔倒). 

```python
import torch
import torch.nn.functional as F

def sdft_train_step(student_model, teacher_ema_model, task_input_x, demonstration_d, beta=1.0):
    """
    SDFT 核心训练步: 利用带示范的 EMA 教师指导学生
    """
    
    # 步骤 1: 学生 (无示范) 自由探索，进行 On-Policy 采样
    student_model.eval()
    with torch.no_grad():
        # 学生根据题目 x 生成轨迹 y
        y_trajectories = student_model.generate(task_input_x, max_new_tokens=1024)
        
    # 步骤 2: 计算学生分布
    student_model.train()
    # 学生的上下文仅有 x
    student_logits = student_model(torch.cat([task_input_x, y_trajectories], dim=-1)).logits
    student_logprobs = F.log_softmax(student_logits, dim=-1)
    
    # 步骤 3: 教师进行评估 (带示范的上帝视角)
    # 教师模型是 EMA 冻结的，不参与本次反向传播
    teacher_ema_model.eval()
    with torch.no_grad():
        # 教师的上下文是 d + x
        teacher_context = torch.cat([demonstration_d, task_input_x], dim=-1)
        teacher_logits = teacher_ema_model(torch.cat([teacher_context, y_trajectories], dim=-1)).logits
        teacher_probs = F.softmax(teacher_logits, dim=-1)
        
    # 步骤 4: 计算 Reverse KL 散度
    # 数学本质等价于隐式 IRL，强制学生逼近教师的示范后分布
    loss_kl = F.kl_div(
        input=student_logprobs, 
        target=teacher_probs, 
        reduction='batchmean'
    )
    
    # 反向传播
    loss_kl.backward()
    # optimizer.step()
    
    return loss_kl.item()

def update_teacher_ema(student_model, teacher_ema_model, alpha=0.99):
    """
    训练步结束后的 EMA 动量更新，保证教师比学生演进得更平滑、稳定
    """
    with torch.no_grad():
        for param_s, param_t in zip(student_model.parameters(), teacher_ema_model.parameters()):
            param_t.data.mul_(alpha).add_(param_s.data, alpha=1 - alpha)
```

> **代码注释印证**: 注意 `teacher_context` 中拼接了 `demonstration_d`，这就是激活 Teacher “领悟状态”的唯一开关. EMA 更新机制 `update_teacher_ema` 则构成了持续学习中防止遗忘的物理防波堤. 

## 7. 局限性与边界条件 (Limitations & Boundary Conditions)

SDFT 虽然在数学上极度优雅，并在抵御灾难性遗忘上立下奇功，但它同样存在严酷的生死边界: 

1. **ICL(上下文学习)能力的铁律**: 
   - **失效区域**: 如果你的底座模型非常小(如参数规模 < 3B)，它根本不具备从 Few-shot 示范中快速顿悟的 In-Context Learning 能力. 

- **数学根因**: 还记得前文的公式 $\pi_T(y|x, d) \approx \pi^*(y|x)$ 吗？这叫 In-Context Assumption. 如果模型太笨，哪怕你给了示范 $d$，它输出的 $\pi_T$ 也是一团乱麻，根本无法逼近最优策略 $\pi^*$. 此时的 SDFT 不仅不能防遗忘，反而会因为教师信号极度嘈杂，导致效果远不如简单暴力的 SFT. 

2. **对隐式奖励上限的妥协**: 
   - **退化场景**: SDFT 的隐式奖励完全来自于模型自身的泛化先验. 如果面临的全新任务(比如让模型学习量子物理的高阶张量推导)超出了底座模型预训练时见过的一切知识盲区，无论你怎么给 Demonstration，模型都无法内部涌现出正确的 $\log \pi_T$. 这种情况下，你必须引入外部的、真实世界的编译器反馈或人类反馈来提供绝对的 Ground Truth. 

## 8. 演进与承上启下 (Evolution & Segue)

SDFT 利用 Demonstration 让模型自己教自己，完美解决了“无外部奖励模型情况下的持续学习”痛点. 
然而，上述提到的第二点局限性却像乌云一样笼罩在工程界: **如果我们真的遇到了一种极难的任务，仅靠模型内部的泛化(In-Context)已经失效了，我们该怎么办？**

如果在写代码、解方程时，我们虽然没有昂贵的 Reward Model，但我们有一个免费且绝对正确的“环境”——代码编译器(Compiler)或 Python 解释器. 
我们能不能把这种来自真实环境绝对零容忍的反馈(Execution Feedback)，融合进自蒸馏的框架中，让模型在真实的撞墙中学习，而不是仅仅在想象中推演？

这就是将隐式 IRL 与真实环境反馈结合的终极形态，它在数学上摒弃了单纯的 KL 散度，将自蒸馏推向了策略优化的高度——欢迎进入 OPD 家族的重火力区: **SDPO(自蒸馏策略优化)** ，请阅读下一篇章. 

## 9. 总结与参考文献 (References)

1. **破除灾难性遗忘**: SDFT 证实了将 Demonstration 作为条件输入给教师，让学生去 On-Policy 蒸馏，能够完美融合新知识并保护旧能力(特别是长程推理思考的风格). 

2. **隐式 IRL 证明**: 无需显式的 Reward Model，带示范的对数概率本身就在数学上构成了一个完美的、防越界的强化学习奖励信号. 

3. **EMA 工程支撑**: 通过冻结并缓慢平滑更新的教师模型，构建了连续学习中的知识锚点. 

**参考文献: **
- Self-Distillation Enables Continual Learning. arXiv: 2601.19897. URL: https://arxiv.org/abs/2601.19897
- ToolAlpaca & SciKnowEval benchmark analysis papers.
