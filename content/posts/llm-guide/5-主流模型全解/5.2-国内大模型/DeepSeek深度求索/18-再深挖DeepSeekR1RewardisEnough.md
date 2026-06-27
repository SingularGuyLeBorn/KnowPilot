---
title: "再深挖DeepSeek-R1 ：Reward is Enough"
date: 2026-05-11
tags: []
---

# 18 再深挖DeepSeek-R1 ：Reward is Enough

​

***作者: 小冬瓜 AIGC*** 

**原文: **[https://zhuanlan.zhihu.com/p/20053834500](https://zhuanlan.zhihu.com/p/*20053834500)

## 1. 再深挖 DeepSeek-R 1: Reward is Enough

## 1. DeepSeek-R1-Zero 启示

### 1.1 推理任务问题定义和目标

我们通常接触到的语言模型分两类，一种是通用模型 (General), 一种是特定任务模型。前者代表如 ChatGPT 可以在创意写作、代码协作和翻译等任务中都有出色表现，后者指特定场景任务下能够有出色表现比如代码模型，如果将“推理(reasoning)“定义为一种具体能力，那么”数学“就是体现”推理“能力的一种具体任务，数学问题通常需要有严密的逻辑推导或证明，才能得到正确的答案。

在数学任务里，我们有两种问题形式，主要分为：

1. 选择题/填空题：特指我们只要答对答案就可以，特点是答案是客观的，无歧义的，答案形式如 1/2 或 0.5 ，意义也是准确的，比如你在一个几何题里你用量尺直接得到答案，只要撞对 ground truth，也能够得分，这个打分的判别是 Answer-Check2. 解答题：根据题干我们需要有解答过程，推导出正确答案，我们才能拿到分数，那么这里的解答过程 Solution，在严格的评判标准里，推导的过程也是要计算分数的。这个打分的判别是 Solution-Answer-Check 的

这种有客观答案的问题我们定义为 close-form 的问题，当前主流的 LLM 数学能力评判其实是 Answer-Check，就意味着评判 LLM 的能力不关心解答过程 Solution。而主流的数学推理能力需要思维链 (Chain-of-thought) 生成 solution，只是一种提高 answer 的准确性的手段。

对于通用任务问题，如果是 

- closed-form 问题比 open-form 更容易监督，- Answer-Oriented 较 Solution-Answer-Oriented 进一步简化标签，更易监督。

所以现在 Post-Training 的目标是使得模型通用能力提高，而通用里面的瓶颈是推理难题，解决数学难题的好处在于：

1. 模型的逻辑推理能力提升2. 数学推理能力能够泛化到其他领域3. 学习到的推理形式能够加强模型结构化推理

### 1.2 分析

#### 1.2.1 DeepSeek-R1-Zero 目标

![图片](data: image/svg+xml,%3 C%3 Fxml version='1.0' encoding='UTF-8'%3 F%3 E%3 Csvg width='1 px' height='1 px' viewBox='0 0 1 1' version='1.1' xmlns='[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)' xmlns:xlink='[http://www.w3.org/1999/xlink'%3](http://www.w3.org/1999/xlink'%3) E%3 Ctitle%3 E%3 C/title%3 E%3 Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3 E%3 Cg transform='translate (-249.000000, -126.000000)' fill='%23 FFFFFF'%3 E%3 Crect x='249' y='126' width='1' height='1'%3 E%3 C/rect%3 E%3 C/g%3 E%3 C/g%3 E%3 C/svg%3 E)

我们先简要说明 DeepSeek-V3-Base 到 DeepSeek-R1-Zero 的 RL 训练目标

- 在 Close-form 的数学问题上得到高的 Answer-Check 高分，而 Answer 与 Label 的判别是具体客观的，也就是 ruled-based 判别- 那么在训练过程中，我们只需要准备好数学问题集，我们可以让模型在线采样出 CoT Solution，最后的答案用 $\boxed{}$ 来包裹; - RL 过程中 on-policy 采样出来的 CoT Solution，是否是 step-by-step，是否是每一步都正确，是否是逻辑连贯，是否是乱码，是否是混合语言，是否是格式混乱，是否是 Aha Moment，都不重要，**只要 Final Answer 是正确，那么哪怕 solution 是乱码，每个 token 都是有益的正反馈(通过 adavatage 形式)** - 在 Answer-check 的问题设置里，open-form 开放问题是没法在这一套 GRPO 框架训的，因为生成结果不能 rule-based 判别，也没有 reward model。所以 DeepSeek-R 1-Zero 只在 close-form 和 answer-check 的特殊问题上进行训练的。

Q: DeepSeek-R1-Zero CoT 过程一定是正确的吗？能否部署？

A:  CoT 过程不一定是正确的，没有严格要求; 未经过指令微调和偏好对齐，是不适用在部署通用应用里的，R 1-Zero 是个特异的模型

#### 1.2.2  RL 激发“Aha Moment”

R1-Zero 纯 Reasoning RL 训练过程中会采样出“Aha Moment”(顿悟), 我认为有两点原因：

1. V3-Base 模型强(即 DeepSeek-V3 本身 MATH-500 就是高分 90.1)2. GRPO on-policy 采样时相较 PPO，会 Rejection Sampling 出多个 output(即 GRPO 是一种探索)，哪怕探索出的答案都是错的，那么 RL 训练能抑制这一批推导错误的生成。如果有多个正反馈，那么也能某种程度保证模型输出多样性。

![图片](data: image/svg+xml,%3 C%3 Fxml version='1.0' encoding='UTF-8'%3 F%3 E%3 Csvg width='1 px' height='1 px' viewBox='0 0 1 1' version='1.1' xmlns='[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)' xmlns:xlink='[http://www.w3.org/1999/xlink'%3](http://www.w3.org/1999/xlink'%3) E%3 Ctitle%3 E%3 C/title%3 E%3 Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3 E%3 Cg transform='translate (-249.000000, -126.000000)' fill='%23 FFFFFF'%3 E%3 Crect x='249' y='126' width='1' height='1'%3 E%3 C/rect%3 E%3 C/g%3 E%3 C/g%3 E%3 C/svg%3 E)

所以“Aha Moment”本质是搜索，我们有足量的搜索，一定有可能顿悟，搜索出错误答案对于 RL 那就避免这个行为产生，搜索出错误的答案对于训练也是有用的。在过去我们可以尝试用规则或者模型来控制推理行为：如 Self-evaluate、Self-Reflection、Self-Improve 等，我们所说 RL 能激发“Aha-Moment” 指的是我们并没有引入“先验”，就探索到提高准确率对应的推理技巧。

在“Aha Moment”里我们不能直接量化过程推理能力，而是通过 CoT 采样 Solution 的 token 序列长度 (test-time computation increases, 产生越长的 token 需要的计算量越多) 决定的。

DeepSeek-R1-Zero naturally acquires the ability to solve increasingly complex reasoning tasks by leveraging extended test-time computation.

Aha Moment 有什么弊端？ 可能会造成过度思考问题和重复思考等问题。

#### 1.2.3 SFT 数据质量影响

我们可以进一步对比 DeepSeek-V3-Base 系列模型，来做进一步分析 RL 前的 SFT 是否必要。

1. DeepSeek-R1-Zero 纯 Reasoning RL 在 AIME 取得显著提升 (39.2->71.0)，我们可以审视 DeepSeek-V3 的 SFT 训练的影响。2. DeepSeek-R1 也有 SFT 但是产生了更高的分数，我们能知道所用的数据包含 600 k 的 long-CoT 推理数据。

![图片](data: image/svg+xml,%3 C%3 Fxml version='1.0' encoding='UTF-8'%3 F%3 E%3 Csvg width='1 px' height='1 px' viewBox='0 0 1 1' version='1.1' xmlns='[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)' xmlns:xlink='[http://www.w3.org/1999/xlink'%3](http://www.w3.org/1999/xlink'%3) E%3 Ctitle%3 E%3 C/title%3 E%3 Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3 E%3 Cg transform='translate (-249.000000, -126.000000)' fill='%23 FFFFFF'%3 E%3 Crect x='249' y='126' width='1' height='1'%3 E%3 C/rect%3 E%3 C/g%3 E%3 C/g%3 E%3 C/svg%3 E)

*[注]美国数学邀请赛(AIME，American Invitational Mathematics Examination)*

所以做个不严格的结论：SFT 是没问题的，也不存在 SFT 无用论，**数据质量影响可能远大于方法本身。**

**那么训练的数据瓶颈就变为了收集或者合成复杂问题的“Long-CoT” solution，过程中有错误也能接受，毕竟无法让人类手写出 600 k 条高质量的 solution**

而 DeepSeek-R1-Zero 的尝试或者存在的目的，是为了合成高质量的 Long-CoT

#### 1.2.4 R 1-Zero 纯 Reasoning RL 为什么不用 SFT

在过去一直被诟病 SFT 或者其他对齐方法，会对整体性能产生“遗忘”或“性能退化”，我们总结下 SFT 的弊端：

1. 满血的 base 更强2. 现有的数据 Long-CoT 少3. 哪怕是从 o 1 采样的数据去蒸馏，也只是强行适配 o 1 的模型的分布。4. 现有的 solution 仍不够复杂，比如是人类写出的 solution，大多是抛弃掉了“草稿纸演算”后的简洁解答，或者是没有显式的写出思考的“心路历程”，我们在复杂数学问题上，写在试卷里的解答过程，实际上是跳过了思维的精华。5. 人类教授的推理技巧，可能是在帮助模型先走捷径再探索，而不是纯 RL 先探索再走捷径。

另外缺少人类的先验，那么产生的解答“可读性差”并不奇怪，R 1-Zero 的目标是最大化准确率，并不是给人用的，也不是用于产品部署的。我们仍需要有通用能力的模型。

那么我们可以留下问题：

1. R1-Zero 没有 SFT 训练，RL 初期 GRPO 采样时有 Few-shot/CoT prompt？会不会难以采样到正确答案使得训练缓慢或不稳定？2. 能否在 R1-Zero 之后进行指令微调？3. 能否将通用问题和推理问题一起从 base 模型做 RL？4. 为什么 R1 还要重起炉灶，从 base 训仍要 SFT？

#### 1.2.5 R 1 需要什么样的 SFT 数据

我们先说为什么要 Cold-Start SFT？

1. 加快 RL 训练2. 引入人类先验3. 控制 reasoning 回答格式

R1 的训练是四个阶段，实际上可以分成两部分，两个部分都要 SFT+RL，按照这两个主要阶段说明数据源

A. 特定推理能力的 SFT 和 RL，相较 R1-Zero，实际上是为了引入人类先验，帮助模型在特定特例场景下控制输出格式提升可读性，SFT 数据：prompt engineering 产生的 CoT 数据、从 R1-Zero 采样并且人工处理、Markdown 格式控制数据、摘要数据收集，RL 过程：增加一致性奖励等。

B. 当模型能够输出可读性好的 reasoning 数据(合成数据)，才开始进入到最终的 R1 训练，最终的问题我们要思索的是为什么 R 1 引入了通用数据训练，会比 R1-Zero 推理性能更好？直觉的猜测为：

- 通用的数据部分可能也有较强的推理属性，如代码、谜题、摘要和脑经急转弯等，丰富了推理的模式- 格式化组织数据，使得数据表征更高效。

![图片](data: image/svg+xml,%3 C%3 Fxml version='1.0' encoding='UTF-8'%3 F%3 E%3 Csvg width='1 px' height='1 px' viewBox='0 0 1 1' version='1.1' xmlns='[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)' xmlns:xlink='[http://www.w3.org/1999/xlink'%3](http://www.w3.org/1999/xlink'%3) E%3 Ctitle%3 E%3 C/title%3 E%3 Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3 E%3 Cg transform='translate (-249.000000, -126.000000)' fill='%23 FFFFFF'%3 E%3 Crect x='249' y='126' width='1' height='1'%3 E%3 C/rect%3 E%3 C/g%3 E%3 C/g%3 E%3 C/svg%3 E)

#### 1.2.6 R 1 工程部署优势

1. 提示词工程决定“deepthink”模式

we call DeepSeek-V 3 to generate a potential chain-of-thought before answering the question by prompting. **However, for simpler queries, such as “hello” we do not provide a CoT in response.**

1. 不用额外的模型，即可做 summarization

we design a **readable pattern** that includes a summary at the end of each response and

filters out responses that are not reader-friendly

1. 虽然对 prompt 提示词敏感，但解决问题可以纯 zero-shot

we recommend users directly describe the problem and specify the output format using a

**zero-shot** setting for optimal results.

### 1.3 小结

1. 从 GRPO 的 on-policy 采样角度看“Aha-Moment”是合理的，顿悟是探索的结果。2. SFT 是否必要？如果是通用能力我们仍需要 SFT。如果是特定任务，SFT 要不要做取决于数据质量。3. AIME 的结果表明了 R 1-Zero 的纯 RL-Reasoning 的超强能力，尽管上线的是 R1，而 R1-Zero 的影响也是非常重大的

## 2. End-to-End Reasoning Learning

在 R1-Zero 的训练过程里，并没有过程监督，是通过结果来监督的，实际上是一种端到端的学习。更具体的我们可以称为：端到端的推理能力学习。我们所知道的自动驾驶里：

1. 端到端：输入获取传感器信息，输出控制信息2. 非端到端：传感器获取视频，视频信息里检测和追踪车道线、汽车、红绿灯等，然后做出规划和决策等，每步都进行拆解，相较端到端，learning 过程里的标签的获取成本高。

至于 Learning 的具体算法，用的 PPO、GRPO 甚至 SFT 其实都没关系，只要 solution 是在线采样的。

### 2.1 Reward is enough

在 R1-Zero 的实践表明，仅靠规则 reward 是足够的，reward 足够与具体的问题类别有关如：

1. Close-form 数学问题：有标准的答案2. 代码：运行代码，执行器反馈对错，或者 Leetcode 提交代码后的平台反馈。

我们看下更早的是 AlphaGo-Zero，围棋的奖励是终局的规则判别，经过大量的 self-play 仅靠胜负反馈就能学习到超越人类的“围棋推理能力”。

### 2.2 更早的端到端推理学习： STaR

STaR: Bootstrapping Reasoning With Reasoning

在 22 年的 STaR 的文章里，已经有端到端推理思想了，只不过所用的训练方法是 SFT

我们在以下选择题形式的问题里，我们可以在线采样出 Rationale 和 Answer，这里的 Rationale 我们当成是 CoT/Long-CoT 来看待，那么如果采样出的 Answer 和 Label 匹配，那么这条采样数据我们保留，如果不匹配，那么剔除。所保留带 CoT 的数据，进行 SFT 训练。

通过这种端到端思想，就可以提高推理能力，弊端无一例外在于 Rationale 或 CoT 里推断的准确性是无法保证的。

![图片](data: image/svg+xml,%3 C%3 Fxml version='1.0' encoding='UTF-8'%3 F%3 E%3 Csvg width='1 px' height='1 px' viewBox='0 0 1 1' version='1.1' xmlns='[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)' xmlns:xlink='[http://www.w3.org/1999/xlink'%3](http://www.w3.org/1999/xlink'%3) E%3 Ctitle%3 E%3 C/title%3 E%3 Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3 E%3 Cg transform='translate (-249.000000, -126.000000)' fill='%23 FFFFFF'%3 E%3 Crect x='249' y='126' width='1' height='1'%3 E%3 C/rect%3 E%3 C/g%3 E%3 C/g%3 E%3 C/svg%3 E)

### 2.3 OpenAI 强化学习微调 ReFT

OpenAI's Reinforcement Fine-Tuning Research Program

在 OpenAI 12 day 里提出了 ReFT 项目，实质上就是期望收集垂直领域专家级别问题和答案。

Reinforcement Fine-Tuning excels at tasks where the outcome has an objectively  **“correct”** answer that most experts would agree with.

样例来自 OpenAI 12 days： Day 2，我们按照 R1-Zero RL 训练需求数据，实际上要的专家级问题可以不用 solution 但是需要 final answer ，仅需 final answer “Answer”就可以进行监督，如下例的 Correct Answer ： FOXE3

![图片](data: image/svg+xml,%3 C%3 Fxml version='1.0' encoding='UTF-8'%3 F%3 E%3 Csvg width='1 px' height='1 px' viewBox='0 0 1 1' version='1.1' xmlns='[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)' xmlns:xlink='[http://www.w3.org/1999/xlink'%3](http://www.w3.org/1999/xlink'%3) E%3 Ctitle%3 E%3 C/title%3 E%3 Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3 E%3 Cg transform='translate (-249.000000, -126.000000)' fill='%23 FFFFFF'%3 E%3 Crect x='249' y='126' width='1' height='1'%3 E%3 C/rect%3 E%3 C/g%3 E%3 C/g%3 E%3 C/svg%3 E)

## 3. MCTS Search 的挑战

与 End-to-End(Outcome Supervision)相对应的是过程监督(Process Supervision)，在 Deepseek 尝试里，PRM 和 MCTS 并不理想。

### 3.1 过程监督是否无效？

结论：无效

实际上 LLM 的过程定义是不具体的：

1. 步骤不具体：按照换行符换分，按照段落划分，按照字符数量划分，按照逻辑部落划分，这里有很大的区别，另外不同的任务的定义有所区分，比如代码是否可以是 function-level 还是 line-level2. 准确性判别：如果一个 leetcode 问题，生成导出使用暴力搜索的方法步骤，或者我们输出一段代码能够运行，但是内存泄漏，我们能 100%一致性标注出准确还是错误吗？

上述数据标签噪声大，那么所训 PRM 性能也受限。

另外自动化的标注可见方案，标注是建立在一定架设上的统计，而非是确定的正确性判别标签。

| 
 
 | 
title
 | 
简介
 |
| --- | --- | --- |
| 
1
 | 
Math-Shepherd: Verify and Reinforce LLMs Step-by-step without Human Annotations
 | 
Math-Shepherd: 有较高的标注成本，且标注值为概率，而非准确性。
 |
| 
2
 | 
Improve Mathematical Reasoning in Language Models by Automated Process Supervision
 | 
Omega-PRM 提出更宽松的假设，进行二分标注
 |

相对应的 Searchf 方法，实际上 PRM 的在难度等级 5 的数学题下，准确率低下。对于难题的解决的矛头仍指向：**如何将推理能力训练到模型本身**

Scaling LLM Test-Time Compute Optimally can be More Effective than Scaling Model Parameter

![图片](data: image/svg+xml,%3 C%3 Fxml version='1.0' encoding='UTF-8'%3 F%3 E%3 Csvg width='1 px' height='1 px' viewBox='0 0 1 1' version='1.1' xmlns='[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)' xmlns:xlink='[http://www.w3.org/1999/xlink'%3](http://www.w3.org/1999/xlink'%3) E%3 Ctitle%3 E%3 C/title%3 E%3 Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3 E%3 Cg transform='translate (-249.000000, -126.000000)' fill='%23 FFFFFF'%3 E%3 Crect x='249' y='126' width='1' height='1'%3 E%3 C/rect%3 E%3 C/g%3 E%3 C/g%3 E%3 C/svg%3 E)

PRM 无法准确描述环境，那么在难题上的 Search 就是可有可无, R 1 的评价是“Limited”

Its advantages are **limited** compared to the additional computational overhead it introduces during large-scale reinforcement learning process in our experiments

### 3.2 MCTS 是否无效？

结论：无效

AlphaGo 和 AlphaGo-Zero 里的区别：AlphaGo 的 MCTS 价值估计是 rollout 再回溯估计动作价值，而 AlphaGo-Zero 是做价值估计。

围棋的难度相较 LLM Next-Token generation 式的 MDP 简单的多。另外价值网络也会直接影响生成的选择，LLM Next Token 预测较围棋网络下子 inference 成本大的多，工程受限下的 MCTS 试错成本高。

While AlphaGo’s core success relied on training a value model to progressively enhance its performance, this principle proves difficult to replicate in our setup due to the complexities of token generation.

我们前面提到的 GRPO 也具有用了搜索的思想，在线采样实际上是 MC Rollout，但是不做常规的动作或状态价值估计，从真实奖励进行估计优势，需要花费 inference 的成本。

## 4. 总结

1. R 1-Zero 将推理难题转为 close-form 下的端到端学习问题，纯 RL 就能激发模型的顿悟，并且在 AIME 显著提升2. OpenAI 的 ReFT 思路与 R 1 应该大差不大，将 math 推理能力高效泛化到其他领域是下一个研究热点。3. O 1 类推理的方案又前进了一步，而 DeepSeek 的 MCTS 和 PRM 上的尝试，是非常有价值的经验分享，少走弯路

拓展阅读：

[【解读】DeepSeek-R1: RL前到底需不需要SFT???](https://mp.weixin.qq.com/s?__biz=MzkzNzU4MTU5Nw==&mid=2247486106&idx=1&sn=195f6a4f4a5c44040831c3cf5a629206&scene=21#wechat_redirect)

## 5. 原创课程[手撕 LLM-RLHF]+o 1 训练实操

近期新增第 14 章节 o 1 实操 o 1 相关技术 PRM、MCTS、MCTS-LLM 技术

[>>【手撕LLM+RLHF+](http://mp.weixin.qq.com/s?__biz=MzkzNzU4MTU5Nw==&mid=2247485447&idx=1&sn=fb1a05270ee0b7d4c542f7409a15ddb8&chksm=c28c0575f5fb8c632089746c7bdb9afde09775e1fbf62655789fbca70a23503914657b04133c&scene=21#wechat_redirect)[多模态+o1推理】](https://mp.weixin.qq.com/s?__biz=MzkzNzU4MTU5Nw==&mid=2247486082&idx=1&sn=d921d6570376509998a189e0099f45c2&scene=21#wechat_redirect)

[小冬瓜AIGC：【OpenAI o3安全对齐方案】坏消息：RLHF里的HF无了!!](https://zhuanlan.zhihu.com/p/14792481053)[小冬瓜AIGC：【解读】DeepSeek-R1：RL前真的不需要SFT了吗???](https://zhuanlan.zhihu.com/p/19623772462)[小冬瓜AIGC：【OpenAI o3安全对齐方案】坏消息：RLHF里的HF无了!!](https://zhuanlan.zhihu.com/p/14792481053)

[小冬瓜AIGC：【o1推理】Scaling LLM Test-Time：谁说类o1推理一定要用RL?!](https://zhuanlan.zhihu.com/p/877197813)

[小冬瓜AIGC：为什么DPO里Chosen和Rejected概率会同时下降???](https://zhuanlan.zhihu.com/p/6327313416)

[小冬瓜AIGC：【手撕RLHF-DPO】step-by-step公式推导及实验分析](https://zhuanlan.zhihu.com/p/692991235)

[小冬瓜AIGC：【手撕RLHF-Aligner】7B模型外挂，暴涨GPT4安全性26.9%](https://zhuanlan.zhihu.com/p/682627363)

[小冬瓜AIGC：【手撕RLHF_Weak-to-Strong】OpenAI超级对齐新思路(含代码解析)](https://zhuanlan.zhihu.com/p/674714374)

[小冬瓜AIGC：【手撕RLHF-Safe RLHF】带着脚镣跳舞的PPO](https://zhuanlan.zhihu.com/p/670288679)

[小冬瓜AIGC：【手撕RLHF-Rejection Sampling】如何优雅的从SFT过渡到PPO](https://zhuanlan.zhihu.com/p/669397860)

[小冬瓜AIGC：【手撕RLHF-LLaMA2】 Reward Model PyTorch实现](https://zhuanlan.zhihu.com/p/679012951)

**_《手撕LLM》_**系列文章+原创课程：LLM原理涵盖Pretrained/PEFT/RLHF/[高性能计算](https://zhida.zhihu.com/search?content_id=253033122&content_type=Article&match_order=1&q=%E9%AB%98%E6%80%A7%E8%83%BD%E8%AE%A1%E7%AE%97&zhida_source=entity)

[小冬瓜AIGC：【手撕LLM_Nv-Embed】英伟达LLM-as-Embedding, ICLR高分佳作, RAG检索有救了!!!](https://zhuanlan.zhihu.com/p/16854104123)

[小冬瓜AIGC：【手撕LLM-Cut Cross Entropy】ICLR高分：LLM训练交叉熵的Memory-Efficient优化](https://zhuanlan.zhihu.com/p/13548439339)

[小冬瓜AIGC：【手撕online softmax】Flash Attention前传，一撕一个不吱声](https://zhuanlan.zhihu.com/p/5078640012)

[小冬瓜AIGC：【手撕LLM-FlashAttention2】只因For循环优化的太美](https://zhuanlan.zhihu.com/p/670085985)

[小冬瓜AIGC：【手撕LLM-Flash Attention】从softmax说起，保姆级超长文！！](https://zhuanlan.zhihu.com/p/663932651)

[小冬瓜AIGC：【手撕LLM】长文本的Position Encoding的衰减性证明](https://zhuanlan.zhihu.com/p/709234529)

[小冬瓜AIGC：【手撕LLM-NTK RoPE】长文本“高频外推、低频内插“从衰减性视角理解](https://zhuanlan.zhihu.com/p/702964625/edit)

[小冬瓜AIGC：【手撕LLM - Mixtral-8x7B】Pytorch 实现](https://zhuanlan.zhihu.com/p/680361287)

[小冬瓜AIGC：【手撕LLM-Medusa】并行解码范式: 美杜莎驾到, 通通闪开！！](https://zhuanlan.zhihu.com/p/686000524)

[小冬瓜AIGC：【手撕LLM-Speculative Decoding】大模型迈向"并行"解码时代](https://zhuanlan.zhihu.com/p/671432448)

[小冬瓜AIGC: 【手撕LLM-Generation】Top-K+重复性惩罚](https://zhuanlan.zhihu.com/p/667025336)

[小冬瓜AIGC：【手撕LLM-KVCache】显存刺客的前世今生--文末含代码](https://zhuanlan.zhihu.com/p/667763542)
