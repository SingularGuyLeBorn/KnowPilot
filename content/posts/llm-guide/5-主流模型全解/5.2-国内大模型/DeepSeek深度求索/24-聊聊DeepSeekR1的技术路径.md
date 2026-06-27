---
title: "聊聊DeepSeek-R1的技术路径"
date: 2026-05-11
tags: []
---

# 24 聊聊DeepSeek-R1的技术路径

***作者: 小狸愚***

***原文: https://zhuanlan.zhihu.com/p/19714987272***

Arxiv论文地址：https://arxiv.org/abs/2501.12948

ModelScope论文地址：https://modelscope.cn/papers/109508

github论文地址：https://github.com/deepseek-ai/DeepSeek-R1/tree/main

DeepSeek-R1本质上给出了模型训练中的长链推理，或复杂推理问题的一种可行路径。可贵的是，在论文中DeepSeek给出了一个非常完整的技术实现路径，还包括了一些失败的尝试。这给其他模型厂商提供了完整的复现方式。我们先看最后的评测结果：

![](./24-聊聊DeepSeekR1的技术路径_images/image_0.jpg)

可以看到R1的结果几乎都与OpenAI-o1-1217持平，部分评测集甚至超越了后者，如[AIME](https://zhida.zhihu.com/search?content_id=252965350&content_type=Article&match_order=1&q=AIME&zhida_source=entity)和MATH。

DeepSeek-R1的训练路径是非常简洁的，这和DeepSeek-V2和V3模型积累的训练经验积累存在非常大的关系。

首先我们先明确R1模型的训练目标，这个非常重要：

Our goal is to explore the potential of [LLM](https://zhida.zhihu.com/search?content_id=252965350&content_type=Article&match_order=1&q=LLM&zhida_source=entity)s to develop reasoning capabilities without any supervised data, focusing on their self-evolution through a pure RL process.

划重点：**探索几乎没有任何监督数据的条件下，模型通过RL训练，自我更新并涌现复杂推理能力的可能性。**

论文中用一句话概括了整体训练过程，我们先放一下原文：

we introduce DeepSeek-R1, which incorporates a small amount of cold-start data and a multi-stage training pipeline. Specifically, we begin by collecting thousands of cold-start data to fine-tune the DeepSeek-V3-Base model. Following this, we perform reasoning-oriented RL like DeepSeek-R1- Zero. Upon nearing convergence in the RL process, we create new SFT data through rejection sampling on the RL checkpoint, combined with supervised data from DeepSeek-V3 in domains such as writing, factual QA, and [self-cognition](https://zhida.zhihu.com/search?content_id=252965350&content_type=Article&match_order=1&q=self-cognition&zhida_source=entity), and then retrain the DeepSeek-V3-Base model. After fine-tuning with the new data, the checkpoint undergoes an additional RL process, taking into account prompts from all scenarios. After these steps, we obtained a checkpoint referred to as DeepSeek-R1, which achieves performance on par with OpenAI-o1-1217.

训练路径：

1. 先收集了一部分高质量冷启动数据(约几千条)，使用该数据fine-tune DeepSeek-V3-[Base模型](https://zhida.zhihu.com/search?content_id=252965350&content_type=Article&match_order=1&q=Base%E6%A8%A1%E5%9E%8B&zhida_source=entity)，记为模型A2. 使用A模型用GRPO训练，使其涌现推理能力，收敛的模型记为B3. 使用B模型产生高质量SFT数据，并混合DeepSeek-V3产生的其他领域的高质量数据，形成一个高质量[数据集](https://zhida.zhihu.com/search?content_id=252965350&content_type=Article&match_order=1&q=%E6%95%B0%E6%8D%AE%E9%9B%86&zhida_source=entity)4. 使用该数据集训练原始DeepSeek-V3-Base模型，记为模型C5. 使用C模型重新进行步骤2，但是数据集变为所有领域，收敛后的模型记为D，这个模型就是DeepSeek-R16. 训练C模型的数据对小模型做蒸馏，效果也非常好

当然，最开始DeepSeek并没有使用冷启动，而是直接对DeepSeek-V3-Base进行了GRPO训练，发现虽然[CoT](https://zhida.zhihu.com/search?content_id=252965350&content_type=Article&match_order=1&q=CoT&zhida_source=entity)能力提升比较大，但是回复的内容鱼龙混杂，甚至有多个语言同时出现的情况，所以才产生了上面比较标准的训练路径。

DeepSeek-R1的实验有很多贡献，我们列出文章中列出来的：

1. 跳过SFT直接使用GRPO做RL，效果一样很好(或者说，只进行冷启动阶段的几千条数据的SFT)。这一发现证明强化学习在LLM训练中的作用比之前预想要大很多，甚至可以取代SFT

个人认为，这一点我们要分开来看，GRPO在少量显卡上的轻量训练比较难涌现比较好的效果，因此如果对Instruct或者Base模型进行垂类训练，SFT仍然是不二之选。

GRPO的介绍可以参考我之前的文章：

[小狸愚：聊聊人类对齐之Step-DPO、GRPO和REINFORCE++89 赞同 · 2 评论文章](https://zhuanlan.zhihu.com/p/15849622594)

2. RL-采样SFT-RL-蒸馏SFT的pipeline对其他模型训练具有启示作用

3. 较大模型蒸馏的数据用于训练小模型效果比直接从零RL小模型要好。这一点的发现基本说明**数据集本身的好坏对模型训练起决定性作用，或者说人给不了模型需要的数据，模型才给得了模型需要的数据**。换句话说，模型的next-token-prediction具有独特的生成和自我进化方式，该方式和人类给出的提示数据有所不同，而在不同模型间可能是通用的。这一点也基本决定了未来模型的训练中使用优质模型蒸馏的数据集，或模型self-improvement会成为重要的训练路径。

### 0.1 **具体实现**

GRPO的reward并没有采用[PRM](https://zhida.zhihu.com/search?content_id=252965350&content_type=Article&match_order=1&q=PRM&zhida_source=entity)，而是使用了基于正则的 [ORM](https://zhida.zhihu.com/search?content_id=252965350&content_type=Article&match_order=1&q=ORM&zhida_source=entity)，其中包括了两个点：

1. 评估最终答案是否正确。包含最终结果比对、代码运行结果等2. 格式奖励：模型需要将CoT过程放在`<think>``</think>`之间

疑问：具体的奖励值是怎么定义的？不连续且稀疏的奖励可能导致policy不收敛

上面我们提过，最开始的GRPO是没有冷启动SFT的，产生的模型叫DeepSeek-R1-Zero，其训练结果如下：

![](./24-聊聊DeepSeekR1的技术路径_images/image_1.jpg)

AIME结果从15.6%一跃到了71%，而且这个训练过程是**不需要任何监督数据的，只需要准确评估最终结果**。这也是以 [PPO](https://zhida.zhihu.com/search?content_id=252965350&content_type=Article&match_order=1&q=PPO&zhida_source=entity)、GRPO为主包含Rollout过程的强化学习路径的优势所在。而且，随着Generate-RL的on policy训练过程，模型涌现了解决复杂任务的能力，甚至出现了反思，以及对复杂的问题产生更多的token和推理过程。

Aha Moment of DeepSeek-R1-Zero A particularly intriguing phenomenon observed during the training of DeepSeek-R1-Zero is the occurrence of an “[aha moment](https://zhida.zhihu.com/search?content_id=252965350&content_type=Article&match_order=1&q=aha+moment&zhida_source=entity)”. This moment, as illustrated in Table 3, occurs in an intermediate version of the model. During this phase, DeepSeek-R1-Zero learns to allocate more thinking time to a problem by reevaluating its initial approach. This behavior is not only a testament to the model’s growing reasoning abilities but also a captivating example of how reinforcement learning can lead to unexpected and sophisticated outcomes.

说句题外话，这是否可以印证模型的能力提升，只需要预训练后来自于真实世界的正负反馈和模型本身的游走呢？那么现在的模型训练系统的最大问题就是模型和真实世界的交互反馈能力的不足了。

![](./24-聊聊DeepSeekR1的技术路径_images/image_2.jpg)

由于Zero模型的游走随机性比较强，不少问题的推理有可读性差的问题，因此DeepSeek额外训练了[DeepSeek-R1模型](https://zhida.zhihu.com/search?content_id=252965350&content_type=Article&match_order=1&q=DeepSeek-R1%E6%A8%A1%E5%9E%8B&zhida_source=entity)。

1. 冷启动，使用少量示例提示，其中包含长推理链，或者直接提示模型生成带有反思和验证的详细答案，或者收集DeepSeek-R1-Zero 的输出并以可读格式呈现，并通过人工注释进行后期处理以细化结果。 从这些数据微调DeepSeek-V3-Base2. 在SFT后的模型上执行和Zero上相同的RL，但是为了规避语言混杂的问题，在ORM中添加了语言一致性奖励，CoT过程中符合要求的语言比例越高则奖励越高3. 通过**拒绝采样**来进行微调。具体来说，首先通过拒绝采样生成推理轨迹，对部分数据(问题、真实值、采样值)输入DeepSeek-V3来判断轨迹质量，以及过滤掉可读性差、语言混杂的部分，对每个query保留了多个正确轨迹，收集好的数据集约60w条。对于CoT无关的数据，使用了和 [DeepSeek-V3](https://zhida.zhihu.com/search?content_id=252965350&content_type=Article&match_order=10&q=DeepSeek-V3&zhida_source=entity)相同的数据集并进行采样，生成了约20w条，总数据集共80w条，使用这个数据集对DeepSeek-V3进行了2 [epoch](https://zhida.zhihu.com/search?content_id=252965350&content_type=Article&match_order=1&q=epoch&zhida_source=entity)的训练4. 对上述微调的模型继续进行GRPO。本次GRPO除了使用上述的ORM判断外，还增加了对非CoT数据的奖励，方法是使用了额外的[reward model](https://zhida.zhihu.com/search?content_id=252965350&content_type=Article&match_order=1&q=reward+model&zhida_source=entity)，以符合人类要求的回复习惯以及提高模型的帮助性和无害性5. 使用80w条数据(论文中的意思应该就是上面描述的数据集)对小模型做蒸馏，效果也比较好。DeepSeek没有做针对小模型的**后续RL**，虽然效果应该也是不错的

![](./24-聊聊DeepSeekR1的技术路径_images/image_3.jpg)

![](./24-聊聊DeepSeekR1的技术路径_images/image_4.jpg)

在对比实验中，DeepSeek做了针对小模型的RL&蒸馏的实验对比：

![](./24-聊聊DeepSeekR1的技术路径_images/image_5.jpg)

在实验中，使用小模型做RL的效果，不如使用大模型蒸馏得到的数据SFT得到的小模型的效果。因此，可以得出两个结论：首先，将更强大的模型蒸馏为较小的模型会产生出色的结果，而较小的模型依赖本文提到的大规模 RL需要巨大的计算能力，并且可能甚至无法达到蒸馏的效果。其次，**尽管蒸馏策略既经济又有效，超越智能的边界可能仍然需要更强大的基础模型和更大规模的强化学习。**

最后，我们注意下不成功的尝试：

1. PRM。过程奖励模型在RL中作用不大，甚至是反作用。我感觉这个和当初把知识图谱+预训练结合起来的问题是一样的，即在大规模transformer结构训练中使用**另外的不可导工具的辅助可能导致不稳定**。PRM模型面临着奖励欺骗、不可导、效果有限等问题，如果训练新的PRM模型需要额外的资源和时间2. [蒙特卡洛树搜索](https://zhida.zhihu.com/search?content_id=252965350&content_type=Article&match_order=1&q=%E8%92%99%E7%89%B9%E5%8D%A1%E6%B4%9B%E6%A0%91%E6%90%9C%E7%B4%A2&zhida_source=entity)。DeepSeek最初探索了使用 [蒙特卡罗树搜索(MCTS)](https://zhida.zhihu.com/search?content_id=252965350&content_type=Article&match_order=1&q=%E8%92%99%E7%89%B9%E5%8D%A1%E7%BD%97%E6%A0%91%E6%90%9C%E7%B4%A2%EF%BC%88MCTS%EF%BC%89&zhida_source=entity)来增强测试时的计算可扩展性。将答案分解为更小的部分，以允许模型系统地探索解决方案空间。提示模型生成多个标签，这些标签对应于搜索所需的具体推理步骤。在训练过程中，首先使用收集到的提示通过由预训练值模型指导的蒙特卡罗树搜索找到答案。随后，使用生成的问题-答案对来同时训练行为模型和值模型，迭代地改进该过程。 这种方法的失败在于next-token的维度爆炸问题非常严重，在优先探索时间下只能采样一部分路径，这些路径可能是不良的，或者是局部最优的，而相关的细粒度价值模型也很难训练，最终导致policy模型难以迭代改进。虽然Alpha-Go/Zero中使用该算法达到了最优，但由于next-token的维度非常高，因此该算法难以扩展到 [NLP](https://zhida.zhihu.com/search?content_id=252965350&content_type=Article&match_order=1&q=NLP&zhida_source=entity)领域

关于第二点需要额外注意，并非[蒙特卡洛方法](https://zhida.zhihu.com/search?content_id=252965350&content_type=Article&match_order=1&q=%E8%92%99%E7%89%B9%E5%8D%A1%E6%B4%9B%E6%96%B9%E6%B3%95&zhida_source=entity)在NLP领域完全不可用(事实上目前不少工作是基于MCTS采样达到的SOTA效果)，而是**从**[base模型](https://zhida.zhihu.com/search?content_id=252965350&content_type=Article&match_order=1&q=base%E6%A8%A1%E5%9E%8B&zhida_source=entity)** 从0开始采样训练的时候是不可用的**。蒙特卡洛方法的前提要求是要么探索空间的维度可控，要么policy模型的generate过程是可控且多样的。如果使用instruct(或者说已经具备了一定CoT能力的)模型进行 [蒙特卡洛采样](https://zhida.zhihu.com/search?content_id=252965350&content_type=Article&match_order=1&q=%E8%92%99%E7%89%B9%E5%8D%A1%E6%B4%9B%E9%87%87%E6%A0%B7&zhida_source=entity)效果应该会有不错的提升。