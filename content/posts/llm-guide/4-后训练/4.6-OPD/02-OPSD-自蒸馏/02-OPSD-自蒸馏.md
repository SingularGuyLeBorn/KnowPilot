---
title: "02 · OPSD: 在线自蒸馏 — 当模型成为自己的神明"
date: 2026-05-16
tags: [OPSD, Self-Distillation, On-Policy, OPD, 知识蒸馏, 后训练]
---

# 02 · OPSD: 在线自蒸馏 — 当模型成为自己的神明

## 1. 背景与核心痛点 (Background & Pain Points)

**家谱定位**: 本算法属于 OPD(在线策略蒸馏)家族的核心演进变体. 

在上一篇《01-OPD基础原理》中，我们见证了 OPD 如何利用逐 Token 的密集监督(Dense Supervision)对 RL 实现了降维打击. 
**前车之鉴**: 然而，基础 OPD 有一个致命的物理约束: **它需要一个极其强大的外部教师模型(External Teacher)驻留在显存中**. 如果你正在训练一个 7B 的模型，你可以用 72B 当老师; 但如果你正在训练世界上最强的万亿参数 SOTA 模型呢？谁来当它的老师？

**核心动机**: OPSD(On-Policy Self-Distillation，在线自蒸馏)正是为了解决“无外部教师”的约束而提出的. 它的核心哲学极其疯狂: 既然找不到比自己更聪明的大脑，那可不可以通过**赋予当前的自己“特权信息”(Privileged Context)** ，强行制造出一个高维的“神明视角”来教导低维的自己？

## 2. 为什么重要 (Significance)

在《Self-Distilled Reasoner (arXiv: 2601.18734)》的实验中，OPSD 展现出了极其恐怖的算力经济学: 
- 传统的 GRPO(如 DeepSeek-R1-Zero 所用)每个问题需要采样 8-16 条轨迹进行探索，更新数百步. 

- **OPSD 只需要 1 条探索轨迹**，在 AIME 竞赛数学题上，仅用 100 步训练，单步采样预算不到 GRPO 的 1/125. 

- **能力跃迁**: 它能把 Qwen3-1.7B 的 AIME25 分数从 37.1 暴拉到 43.4，甚至超越了经过复杂 RL 训练的版本. 它证明了“左脚踩右脚上天”在逻辑推理模型中是完全可行的. 

## 3. 直觉类比 (Intuition)

我们可以用**“开卷考 vs 闭卷考”**来完美类比 OPSD 的工作原理. 

![OPSD 闭卷与开卷考类比](./images/opsd_open_book.png)
*图: 虽然权重完全相同，但拥有标准答案的“开卷考”版本具有绝对的上帝视角，能够为“闭卷考”版本提供极其准确的 Token 级指导. *

假设你(学生模型)和另外一个平行宇宙的你(教师模型)，脑容量和智商完全一样(**共享完全相同的模型权重**). 
现在要解一道极难的奥数题(Prompt). 

- **学生宇宙(闭卷考)** : 只给你题目，让你自己硬算(生成轨迹). 

- **教师宇宙(开卷考/特权上下文)** : 不仅给你题目，还**把这道题的标准答案(Golden Answer)直接放在你桌子上**. 

因为教师宇宙的你看到了标准答案，你的推理逻辑和自信心会瞬间爆棚. 
OPSD 就是让“闭卷考的你”在写下每一个算符时，去向“开卷考的你”请教: “喂，兄弟，这道题我已经写到第三步了，你看着标准答案告诉我，第四步我写什么比较稳？”

## 4. 数学推导与公式对比 (Mathematical Rigor)

在 OPSD 中，教师分布 $\pi_T$ 和学生分布 $\pi_\theta$ 是**完全同一个参数化模型**，唯一的区别是输入条件的概率分布. 

### 4.1 教师与学生的条件概率定义
- **学生分布** $\pi_\theta(\cdot | x, y_{<t})$: 只看见问题 $x$ 和自己之前生成的轨迹 $y_{<t}$. 

- **教师分布** $\pi_T(\cdot | x, \underline{\mathbf{y^*}}, y_{<t})$: 不仅看见问题和轨迹，**[高亮差异项]** 还额外看见了**标准答案 $y^*$(Privileged Context)** . 

### 4.2 为什么回归了 Forward KL？
在基础 OPD 中，我们极力推崇 Reverse KL，因为它能防止学生在面对不确定的教师时瞎猜(防幻觉). 
**但在 OPSD 中，作者惊人地发现: 必须改用 Forward KL！**

$$
 \mathcal{L}_{OPSD} = \mathbb{E}_{x, y^*} \mathbb{E}_{y \sim \pi_\theta} \left[ \frac{1}{T} \sum_{t=1}^T \underline{\mathbf{D_{KL}(\pi_T \| \pi_\theta)}} \right] \tag{1}
$$

**物理层面的根因剖析**: 
- 在基础 OPD 中，Teacher 是凭空猜题，它的分布可能是平坦的(High Entropy). 
- 但在 OPSD 中，Teacher 面前放着标准答案 $y^*$！它的思路极其清晰，概率质量会**高度集中在向正确答案逼近的 Token 上**. 
- 此时，教师分布 $\pi_T$ 是一个极其高质量的、确定性极强的“软分布(Soft Labels)”. 

- **[对比项: 散度方向]** 如果用 Reverse KL($D_{KL}(\pi_\theta \| \pi_T)$)，公式为 $\sum \pi_\theta \log(\pi_\theta / \pi_T)$，由学生加权. 学生只要在错误道路上极度自信，Loss 就会变得很小(陷入局部最优). 
- 但使用 **Forward KL($D_{KL}(\pi_T \| \pi_\theta)$)** ，公式为 $\sum \pi_T \log(\pi_T / \pi_\theta)$，是由**教师加权**的！教师说哪个 token 对解题有帮助，学生就必须把该 token 的概率提上来. 实验证明，Forward KL 的效果(41.1分)完爆了 Reverse KL(35.0分). 

## 5. 数值走查 (Numerical Example)

为什么 Forward KL 能够传递“解题思路”？我们来看一个具体数字. 

在推理到某一步时，标准解 $y^*$ 提示接下来应该用“勾股定理”. 
- 教师模型看到了 $y^*$，它给出的 Token 预测概率是: `{"平方": 0.8, "开根号": 0.15, "除以": 0.05}`. 这代表着一种软性的推理倾向. 
- 学生模型在瞎蒙，给出的概率是: `{"除以": 0.9, "平方": 0.1}`. 

计算 **Forward KL**: $\sum P_T \log(P_T / P_S)$
- 对于“平方”这个 Token: $0.8 \times \log(0.8 / 0.1) = 0.8 \times 2.079 = 1.66$. 
- 对于“除以”这个 Token: $0.05 \times \log(0.05 / 0.9) = 0.05 \times (-2.89) = -0.14$. 
巨大的惩罚项 $1.66$ 会沿着反向传播，强行拉高学生网络预测“平方”的 logits，从而把“看过标准答案的潜意识”完美注入到学生权重中. 

## 6. 简化实现 (PyTorch Code)

OPSD 有一个极其关键的工程实现技巧: **Pointwise Clipping(逐词裁剪)** . 
因为文本中包含大量“嗯、然后、所以”等无意义的风格词汇，这些词会产生巨大的无效 KL 梯度. 必须对其裁剪. 

```python
import torch
import torch.nn.functional as F

def opsd_train_step(model, question_tokens, golden_answer_tokens, tau_clip=10.0):
    """
    OPSD: 同一个模型，双路上下文计算 Forward KL
    """
    
    # 步骤 1: On-Policy 采样 (闭卷考)
    # 学生利用纯题目生成轨迹
    model.eval()
    with torch.no_grad():
        student_trajectories = model.generate(question_tokens, max_new_tokens=512)
    
    # 构建教师的开卷考输入: 题目 + 标准解 + 学生生成的轨迹
    # 这样教师就能在评估学生的每一步时，随时偷看标准解
    teacher_input = torch.cat([question_tokens, golden_answer_tokens, student_trajectories], dim=-1)
    # 对齐维度逻辑: 此处简化演示，实际实现需通过 Attention Mask 让教师预测 student_trajectories 部分
    
    # 步骤 2: 学生分布 (闭卷考)
    model.train()
    student_logits = model(torch.cat([question_tokens, student_trajectories], dim=-1)).logits
    student_logprobs = F.log_softmax(student_logits, dim=-1)
    
    # 步骤 3: 教师分布 (开卷考) - 冻结梯度
    with torch.no_grad():
        teacher_logits = model(teacher_input).logits
        teacher_probs = F.softmax(teacher_logits, dim=-1)
    
    # 步骤 4: 计算 Forward KL: D_KL(Teacher || Student)
    # PyTorch 的 kl_div 默认是 KL(target || input)，所以输入是对齐的
    # 公式对应: \pi_T * ( \log \pi_T - \log \pi_\theta )
    pointwise_kl = F.kl_div(
        input=student_logprobs, 
        target=teacher_probs, 
        reduction='none' # 不要求和，以便进行后续的 Clipping
    ).sum(dim=-1) # 对词表维度求和，保留 sequence 维度
    
    # 步骤 5: 核心工程技巧 Pointwise Clipping
    # 防止无意义的风格词汇(如语气词)产生巨大的 KL 梯度
    clipped_kl = torch.clamp(pointwise_kl, min=0.0, max=tau_clip)
    
    loss = clipped_kl.mean()
    loss.backward()
    
    return loss.item()
```
> **注释对应**: `teacher_input` 中强制塞入 `golden_answer_tokens` 就是构造 Privileged Context 的核心操作. 而 `torch.clamp` 则是工程上保证模型不被风格噪声带偏的关键. 

## 7. 局限性与边界条件 (Limitations & Boundary Conditions)

世界上没有包治百病的算法. OPSD 存在着严格的边界要求: 

1. **底座模型的基础能力边界**: 
   - OPSD **绝对无效**的场景: 如果底座模型本身极度愚蠢，即使你把标准答案放在它面前，它也看不懂(比如你给一个纯英文 1B 模型看高等数学的解题过程). 

- **物理根因**: 开卷考的前提是你得能看懂书. 如果 Teacher 在带有 `golden_answer` 时仍然生成混乱的 $\pi_T$ 分布，那么 Forward KL 就会变成把垃圾灌入学生脑子里的毒药. 

2. **捷径学习 (Shortcut Learning)** : 
   - 当标准答案非常简短(如只给出一个最终数字)时，教师模型可能会因为看到了最终答案而产生“过度自信”，在前面推导步骤中瞎写，导致蒸馏出来的学生也学会了“跳步猜答案”. 

## 8. 演进与承上启下 (Evolution & Segue)

尽管 OPSD 极其优雅地解决了“无需外部教师”的问题，但在真实的工业级大模型训练中，需求变得越来越贪婪. 
我们不仅希望模型能够自我迭代，还希望模型在每次吸收新知识、新题型时，**不要忘记以前学过的旧知识**(防止灾难性遗忘，Catastrophic Forgetting). 

如果我们把 OPSD 的“特权上下文”从“标准答案”换成“高质量的专家示范(Demonstration)”，并引入持续学习(Continual Learning)机制，会发生什么化学反应？这自然引出了 OPD 家族的下一位悍将: **SDFT(自蒸馏持续学习)** . 请进入下一章. 

## 9. 总结与参考文献 (References)

1. **同源双模态**: 完全放弃外部教师，利用同一模型在有/无答案两种上下文下的差异形成 Dense 训练信号. 

2. **Forward KL 胜出**: 当参考分布(带标准解的教师)质量极高且确定性强时，使用教师加权的 Forward KL 效果远超 Mode-seeking 的 Reverse KL. 

3. **极低的算力需求**: 单次 Rollout 即可完成梯度更新，将强化学习级别的复杂优化问题转化为简单的有监督分类问题. 

**参考文献: **
- Self-Distilled Reasoner. arXiv: 2601.18734. URL: https://arxiv.org/abs/2601.18734
- OpenThoughts: Data Recipes for Reasoning Models.
