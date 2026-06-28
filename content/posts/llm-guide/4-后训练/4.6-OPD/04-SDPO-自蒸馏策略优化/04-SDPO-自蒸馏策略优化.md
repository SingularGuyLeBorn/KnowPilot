---
title: "04 · SDPO：自蒸馏策略优化 — Rich Feedback 驱动的自我进化"
date: 2026-05-16
tags: [SDPO, Self-Distillation, RLVR, Rich Feedback, OPD, 后训练, 强化学习]
---

# 04 · SDPO：自蒸馏策略优化 — Rich Feedback 驱动的自我进化

## 1. 背景与核心痛点 (Background & Pain Points)

**家谱定位**：SDPO(Self-Distillation Policy Optimization)是整个 OPD 家族中最具野心的一块拼图. 如果说基础 OPD 解决了 SFT 的暴露偏差(Exposure Bias)，OPSD 解决了对外部强教师的依赖，SDFT 解决了灾难性遗忘，那么 SDPO 则是直接向当代大模型后训练的最高王座——**RLVR(基于可验证奖励的强化学习，Reinforcement Learning via Verifiable Rewards)** 发起了正面冲锋. 它试图在数学底层，将强化学习与自蒸馏彻底统一. 

**前车之鉴：RLVR 与稀疏信号的绝望深渊**
在 DeepSeek-R1 惊艳全球之后，RLVR(如 GRPO，组内相对策略优化)成为了所有大厂追捧的圣杯. GRPO 的核心思想极其简单：让模型对同一个数学题或代码题采样 8-16 条推理轨迹(Rollouts). 最后，用一个确定性的规则检查器(如 Python 编译器或数学答案正则匹配)给出奖励分数 $+1$ 或 $-1$. 然后，计算每条轨迹的相对优势(Advantage)，通过 PPO 损失更新权重. 

然而，GRPO 在工程实践中面临着两个极其致命的物理边界：
1. **信用分配的灾难(Credit Assignment Problem)** ：环境只在长达几千个 token 的推理结束时，扔出一个干瘪的标量分数(`False`). 模型根本不知道自己是第一步提取公因式错了，还是最后一步加减法算错了. 这就像你写了 2000 行 C++ 代码，编译器只告诉你“编译失败”，但不给你抛出任何 Error Line Log. 

2. **优势塌缩(Advantage Collapse)** ：在极其困难的题目上，模型生成的 16 条轨迹可能全军覆没(全错，奖励全为 $-1$); 在极其简单的题目上，模型可能 16 条全对. 在 GRPO 的公式 $A_i = \frac{R_i - \text{mean}(R)}{\text{std}(R)}$ 中，如果组内分数全部一致，方差 $\text{std}(R)$ 趋近于 $0$，优势 $A_i$ 直接塌缩为 $0$. 此时模型在这一步等于白跑，消耗了巨大的算力却得不到任何有效梯度. 

**核心动机：Rich Feedback 的觉醒**
SDPO 的作者发出了直击灵魂的追问：当我们调用 Python 编译器运行模型的代码时，编译器明明抛出了一大堆异常堆栈(Exception Stacktrace)和单元测试失败信息(Assertion Error)！为什么传统的 RLVR 算法要把这些极其珍贵的**富反馈(Rich Feedback)** 直接扔进垃圾桶，仅仅把它们降维成一个冰冷的 `0` 分？

能不能不依赖昂贵的外部人工奖励模型(Reward Model)，也不依赖外部的 GPT-4 教师，而是**利用模型自己，阅读这些 Rich Feedback，转化为每个 Token 的稠密奖励信号**？

## 2. 为什么重要 (Significance)

在《Reinforcement Learning via Self-Distillation (arXiv: 2601.20802)》中，SDPO 在各大极限基准上碾压了传统的 GRPO：

1. **绝对分数的跃迁**：在具有真实编译反馈的代码任务 LiveCodeBench v6 上，Claude Opus 4 的准确率为 39.7%，标准 GRPO 训练出的模型准确率为 41.2%，而 **SDPO 仅用同样的底座模型，准确率直接飙升至 48.8%**. 

2. **算力成本的粉碎**：在 Chemistry 数据集上，传统的 GRPO 需要训练 **5 小时**才能艰难爬升到的分数，SDPO 仅需 **50 分钟**即可触达(实现约 6 倍的挂钟时间加速). 在样本生成效率上，SDPO 所需的 Rollout 数量比 GRPO 少了 4 倍. 

3. **输出长度的抑制**：由于 GRPO 信号稀疏，模型往往会发展出“极度冗长、不停绕圈子试错”的绕路策略，导致输出经常爆显存. SDPO 因为在每一个 Token 上都有极其明确的对错指导，其生成的正确推理轨迹长度比 GRPO 缩短了最高 **11 倍**. 

## 3. 直觉类比 (Intuition)

我们可以用**“程序员修 Bug”**来完美类比 GRPO 和 SDPO 的天壤之别. 

![SDPO Rich Feedback 与 Token级指导](./images/sdpo_rich_feedback.png)
*图：GRPO 是盲目尝试后只看测试通过与否; SDPO 则是让“未来的自己”看着编译器的报错日志，手把手教“现在的自己”改代码. *

- **GRPO (盲人摸象)** ：你(学生模型)闭着眼睛瞎写了 8 份代码交上去. 测试引擎直接把这 8 份全打回，并在所有代码上盖了一个大红章：“不通过(-1)”. 你看着这 8 个不通过，满头大汗，完全不知道该改哪里，只能继续瞎试. 

- **SDPO (反思之镜)** ：你交了一份代码，测试引擎报错了. 此时，我们把你拉进一个“时空精神时光屋”，把**编译器抛出的详细报错日志(Rich Feedback，例如 `IndexError: list index out of range at line 14`)** 拍在你脸上. 你看了这个日志，瞬间恍然大悟(进入 Teacher 状态). 然后，这个“恍然大悟的你”，坐回“刚开始写代码的你”(Student 状态)身边，看着他写每一个字母(Token-level)，只要他企图写导致数组越界的代码，你就立刻重重拍他的手. 

SDPO 的本质，就是让**看过错误日志的自己，指导尚未犯错的自己**. 

## 4. 数学推导与公式对比：Token 级优势的诞生 (Mathematical Rigor)

SDPO 将富反馈(Rich Feedback)引入自蒸馏，在数学上彻底颠覆了 RL 的优势函数(Advantage Function)定义. 

### 4.1 双状态角色的定义
- **学生策略(Student Policy)** ：$\pi_\theta(a_t | x, y_{<t})$
  - 只能看到最初的题目 $x$ 和自己正在生成的轨迹 $y_{<t}$. 这是模型在真实部署时的状态. 

- **教师策略(Teacher Policy)** ：$\pi_T(a_t | x, \underline{\mathbf{f}}, y_{<t})$
  - 参数与学生**完全相同**. 

- **[核心差异项]**：在输入中强行塞入了富反馈 $f$. 这个反馈 $f$ 可以是环境编译器返回的 `Traceback`，可以是人类留下的纠错评语，甚至可以是同批次中其他已经做对的轨迹(Sample Solution). 

### 4.2 SDPO 的蒸馏目标函数
为了让学生逼近这个“看了答案/反馈的自己”，SDPO 采用了 Forward KL 散度(在后续工程中进化为 JS 散度，见工程章节)：

$$
 \mathcal{L}_{SDPO} = \sum_t \underline{\mathbf{D_{KL}\left(\pi_\theta(\cdot|x, y_{<t}) \| \text{stopgrad}(\pi_T(\cdot|x, f, y_{<t}))\right)}} \tag{1}
$$

**极其关键的操作：`stopgrad`**
为什么在 $\pi_T$ 外面必须套上一层 $\text{stopgrad}$(停止梯度传播)？
如果不加 `stopgrad`，根据变分推断的特性，不仅学生会努力向老师靠拢，**老师也会倒退着向学生靠拢！** 在多轮训练后，教师网络会因为过于偷懒，直接放弃阅读富反馈 $f$，选择和学生一起瞎猜(这被称为“反馈忽略坍缩”). 套上 `stopgrad`，就等于在物理层面上锁死了教师的高维认知，逼迫学生只能单向攀岩. 

### 4.3 颠覆 PPO：从序列级优势到 Token 级优势
这是 SDPO 论文中最震撼的一笔数学推演. 如果我们将上述 KL 散度目标写成策略梯度(Policy Gradient)的形式，我们会发现，SDPO 竟然隐式地计算出了一个**逐 Token 的动态优势函数**！

对比一下传统 GRPO 和 SDPO 的 Advantage：

**传统 GRPO 的序列级优势(Sequence-Level Advantage)** ：
$$
 A_t^{GRPO} = \frac{R(y) - \mu(R)}{\sigma(R)} \tag{2}
$$
- 特点：这是一个常数！对于一条长达 2000 token 的代码，从第 1 个 token 到第 2000 个 token，它们获得的 Advantage $A_t$ **全部都是同一个固定的数字**. 即便第 1 个 token 写得无比绝妙，只要最后一个 token 写漏了一个分号导致编译失败，第 1 个 token 也会背锅挨骂. 

**SDPO 的稠密优势(Token-Level Advantage)** ：
通过对 KL 散度求导展开，SDPO 对每个 token $a_t$ 更新的梯度方向正比于：
$$
 A_t^{SDPO} = \underline{\mathbf{\log \pi_T(a_t|x, f, y_{<t})}} - \underline{\mathbf{\log \pi_\theta(a_t|x, y_{<t})}} \tag{3}
$$

**[公式物理意义详析]**：
这个公式极其优美. 它在每一个特定的时间步 $t$ 计算分数. 
- 如果在第 14 行，学生模型准备写 `arr[n]`，概率很高($\log \pi_\theta$ 大). 
- 此时，看到了富反馈 $f$(提示 Line 14 out of bounds)的教师模型，对 `arr[n]` 的概率暴跌($\log \pi_T$ 极小). 
- 两者相减：$A_t^{SDPO}$ 变成了一个巨大的负数！惩罚极其精准地落在了导致数组越界的这个特定 Token 上. 
- 这彻底粉碎了 Credit Assignment 问题. 模型不需要再像瞎子一样猜测自己哪一步错了，每一行代码都有极其稠密、精准的正负反馈. 

## 5. 工程细节与代码级优化 (Engineering Implementations)

在实际的万卡集群训练中，要想让 SDPO 的双模型架构真正跑通并收敛，还需要跨越几座极难的工程险峰. 

### 5.1 Top-K Distillation 显存拯救术
**痛点**：如果要对包含 150,000 个 token 的大模型词表进行全量 KL 散度计算，你需要同时在显存里缓存教师和学生的完整 logits 张量. 对于 72B 模型，光是一批数据的 logits 显存占用就会直接炸毁 H100 集群. 
**破局**：SDPO 引入了 **Top-K Distillation**. 
在每个生成的时间步 $t$，系统只保存学生模型预测概率最高的前 $K$ 个 token(如 $K=100$)，把剩下的 $149,900$ 个 token 揉成一个被称为 Tail Bucket 的统一垃圾桶(剩余概率求和). 
因为 SDPO 计算的是从学生视角出发的散度，只要对比在这前 $K$ 个高优选项中，带富反馈的教师给出了怎样的调整，就足以获取 $99.9\%$ 的有效梯度信号. 这把显存占用硬生生砍掉了三个数量级. 

### 5.2 Teacher EMA 与信任域插值 (Trust-Region Interpolation)
如果教师模型每一步都用学生最新的权重，那么一旦学生在某一步因为异常噪声而发散，教师也会跟着发散，然后给学生提供更荒谬的反馈，陷入死亡螺旋. 
**工程实操**：
1. **EMA 冻结**：维持一个独立的教师副本 $\theta_{EMA}$，使用公式 $\theta_{EMA} = \alpha \theta_{EMA} + (1-\alpha) \theta_{Student}$ 进行指数平滑更新($\alpha \approx 0.99$). 这确保了老师的认知永远比激进的学生更稳重. 

2. **插值约束**：将当前的 $\theta_{EMA}$ 与整个训练刚开始时的初始权重 $\theta_{init}$ 按照特定比例插值，形成最终用于计算的 $\pi_T$. 这一步死死把教师拴在最初始的常识认知上，防止它在针对特定数学任务的自蒸馏中，走火入魔彻底丧失通用对话能力. 

### 5.3 弃用 KL，拥抱对称 JS Divergence
直接使用单向 KL 散度容易在极端概率下导致无穷大梯度爆炸. SDPO 在实战中将目标函数更换为对称的 Jensen-Shannon Divergence：
$$
 \mathcal{L}_{JS} = \frac{1}{2} D_{KL}(\pi_\theta \| M) + \frac{1}{2} D_{KL}(\pi_T \| M) \quad \text{其中 } M = \frac{1}{2}(\pi_\theta + \pi_T) \tag{4}
$$
JS 散度天然有界(在 $[0, \ln 2]$ 之间)，这意味着即使老师和学生在某个 Token 上的分歧大到天上去了，梯度惩罚依然会被柔和地限制在安全范围内. 

## 6. 最强创新：Test-Time Self-Distillation (测试时搜索)

如果说前面的讨论都是在改进“训练算法”，那么 SDPO 论文中真正让人倒吸一口凉气的创新，是它在**推理测试时(Test-Time Inference)** 的变态用法. 

想象你处于真实的推理环境. 你要解一道旷世难题. 你没有训练集，只有题目和环境. 
按照传统的强化学习，因为没有提前训练的答案，你无能为力. 但在 SDPO 下，你可以做 **Test-Time Self-Distillation**！

1. **第一步(瞎跑)** ：先让模型对这个问题采样生成 64 份代码并运行. 由于题目极难，64 份全部报错. 

2. **第二步(自我反思)** ：模型自己阅读这 64 份报错日志(Rich Feedback)，在当前这道题目的上下文中(In-Context)，现场对自己进行一次反向传播和临时权重微调. 

3. **第三步(再跑)** ：带着微调过的权重，再次生成. 

**恐怖的数据表现**：
在极度困难的编程题(初始 `pass@64 < 0.03`，即瞎蒙 64 次对一次的概率极低)上，如果使用 Best-of-N(随机狂猜取最好)，在尝试 2750 次后，解出题目的概率仅为 41.5%. 
而使用 **SDPO 测试时自蒸馏**，在环境反馈的指引下不断现场纠错，解出题目的概率达到了惊人的 **53.2%**，且达到相同发现概率所需的算力只有前者的 **三分之一**！
这打破了强化学习必须在“训练集”上见效的死局，使得 AI 有了在全新未知任务中，借助编译器日志**现场进化、当场成佛**的能力. 

## 7. 局限性与边界条件 (Limitations & Boundary Conditions)

即便 SDPO 将 RLVR 推进到了富反馈时代，它的物理铁律依旧存在：

1. **反思能力的涌现门槛(Retrospection Emergence)** ：
   - 实验表明，在 Qwen2.5-1.5B 这样的小参数模型上，SDPO 的表现甚至不如传统无脑暴力的 GRPO. 

- **根本原因**：SDPO 的核心前提是——“把错误日志喂给模型，模型就能看懂并知道怎么改(Teacher 状态)”. 如果你的底座模型参数太小，其内在认知连编译器报的 `TypeError` 是什么意思都理解不了，你喂给它再丰富的 Rich Feedback，对它来说也只是一堆乱码. 此时，SDPO 的高维教师信号将彻底退化为随机噪声. 

2. **幻觉型反馈的剧毒(Hallucinated Feedback Toxicity)** ：
   - 如果 Rich Feedback 并非来自绝对客观的物理编译器或数学定理检验器，而是来自另一个 LLM 给出的评语(RLAIF)，一旦评语本身存在事实错误或逻辑幻觉，带有 `stopgrad` 的自蒸馏会毫不留情地将这些致命幻觉死死钉进学生模型的参数深处，导致模型在错误的方向上狂奔. 

## 8. 演进与承上启下 (Evolution & Segue)

从基础 OPD(解决暴露偏差)，到 OPSD(剥离外部教师)，再到 SDFT(克服灾难遗忘)，最后到 SDPO(驾驭环境富反馈的 Token 级优势). 至此，OPD(在线策略蒸馏)家族已经在逻辑推理和代码生成领域，构建起了一座从 SFT 通往终极 RL 的宏伟天桥. 

然而，在这个框架中，我们始终都在利用“概率散度(KL/JS)”来约束模型. 这种数学约束虽然稳定，但在一些需要极其奔放的创造性任务(如跨模态机器人操作，或纯粹的文学创作)中，数学证明的严密性反而会成为束缚泛化的枷锁. 

如果我们将这种自我反馈的理念，彻底拓展到无需 KL 约束的广义边界，甚至拓展到具身智能(Embodied AI)的机器人动作控制中，情况又会怎样？
这正是 OPD 家族走向通用的集大成者——**G-OPD(广义在线策略蒸馏)与 VLA-OPD**. 请翻开知识库的下一卷，让我们进入具身智能的世界. 

## 9. 总结与参考文献 (References)

1. **破除稀疏困境**：SDPO 利用富反馈(报错日志、测试结果)，将序列级奖励降维打击为 Token 级优势函数，极大加速了代码与推理模型的训练. 

2. **无需额外 Reward Model**：利用同一模型在有/无反馈情况下的认知差产生自蒸馏信号，避免了训练庞大 RM 的高昂成本. 

3. **测试时进化(Test-Time Compute)** ：打破了训练与推理的死板边界，赋予了模型利用环境反馈当场纠错进化的划时代能力. 

**参考文献：**
- Reinforcement Learning via Self-Distillation. arXiv: 2601.20802. URL: https://arxiv.org/abs/2601.20802
- DeepSeek-R1 Technical Report.
- GRPO: Group Relative Policy Optimization papers.
