---
title: "DeepSeek-R1论文速读"
date: 2026-05-11
tags: []
---

# 05 DeepSeek-R1论文速读

​

***作者: Meta***

**原文:**[https://zhuanlan.zhihu.com/p/19530895760](https://zhuanlan.zhihu.com/p/19530895760)

春节将至,DeepSeek又出王炸！DeepSeek-R1系列重磅开源. 本文对其技术报告做简单解读.

话不多说,show me the benchmark. 从各个高难度benchmark结果来看,DeepSeek-R1已经比肩OpenAI-o1-1217,妥妥的第一梯队推理模型. 同时蒸馏Qwen2.5-32B而来的DeepSeek-R1-32B也取得非常惊艳的效果,和OpenAI-o1-mini旗鼓相当.

![](./05-DeepSeek-R1论文速读_images/image_0.jpg)

天下苦[SFT](https://zhida.zhihu.com/search?content_id=252928762&content_type=Article&match_order=1&q=SFT&zhida_source=entity)久矣,已有的公开研究无一例外都是采用SFT+RL的方式,首先需要大量的SFT数据进行 [指令微调](https://zhida.zhihu.com/search?content_id=252928762&content_type=Article&match_order=1&q=%E6%8C%87%E4%BB%A4%E5%BE%AE%E8%B0%83&zhida_source=entity). 而DeepSeek不走寻常路. 他们发现即使不使用SFT,也可以通过大规模强化学习 (RL) 显著提高推理能力. 此外,通过包含少量冷启动数据进行SFT就可以进一步提高性能.

本文的几个主要贡献：

- DeepSeek-R1-Zero ： 不用SFT直接进行RL,也能取得不错的效果.- DeepSeek-R1 ： 加入少量(数千量级)CoT数据进行SFT作为冷启动,然后再进行RL,可以取得更优的性能. 同时回答更符合人类偏好.- 用DeepSeek-R1的样例去蒸馏小模型,能取得惊人的效果.

下面会逐一介绍.

## 1. DeepSeek-R1-Zero

直接从DeepSeek-V3-Base开搞,仍然用DeepSeek[独家定制](https://zhida.zhihu.com/search?content_id=252928762&content_type=Article&match_order=1&q=%E7%8B%AC%E5%AE%B6%E5%AE%9A%E5%88%B6&zhida_source=entity)的GRPO,使用如下平平无奇的PE模版.

![](./05-DeepSeek-R1论文速读_images/image_1.jpg)

RM方面,考虑到是推理任务,没有训练常规的稠密奖励模型,而是采用了两种奖励方式结合：

1. 准确性奖励：对于数学问题,直接匹配标准答案; 对于代码问题,基于[编译执行](https://zhida.zhihu.com/search?content_id=252928762&content_type=Article&match_order=1&q=%E7%BC%96%E8%AF%91%E6%89%A7%E8%A1%8C&zhida_source=entity)单测去验证.2. 格式奖励：看CoT过程是否以标准 包裹.

就是这么看起来似乎暴力又简单的方法,效果却出奇地好.

看起来随着训练步数的增加,性能稳步提升,达到和OpenAI-o1-0912接近的水平.

![](./05-DeepSeek-R1论文速读_images/image_2.jpg)

并且观察到了明显的“进化”现象,随着训练步数的增加,输出平均长度也在增加. 意味着[LLM](https://zhida.zhihu.com/search?content_id=252928762&content_type=Article&match_order=1&q=LLM&zhida_source=entity)似乎自己已经潜移默化学会了进行更多的思考和推理,达到更好的效果.

![](./05-DeepSeek-R1论文速读_images/image_3.jpg)

甚至出现了自主的“Aha Moment”情况,突然就能开始反思. DeepSeek顿悟了,DeepSeek的兄弟们也顿悟了,我似乎也顿悟了. 怎么只是平平无奇的奖励信号,就能让它学会这么多？还得是RL！！!

![](./05-DeepSeek-R1论文速读_images/image_4.jpg)

真就这么完美？SFT完全不必要了？实际情况并非如此,DeepSeek的兄弟们也发现了一些问题,比如,DeepSeek-R1-Zero 生成的答案 [可读性](https://zhida.zhihu.com/search?content_id=252928762&content_type=Article&match_order=1&q=%E5%8F%AF%E8%AF%BB%E6%80%A7&zhida_source=entity)相对差、存在混合语言输出情况(这个似乎QwQ也比较明显). 为了让模型说人话,还是得加点SFT,这就到DeepSeek-R1的舞台了.

## 2. DeepSeek-R1

DeepSeek-R1-Zero已经证明了,完全不进行SFT, 直接RL就能显著提升LLM的推理能力; 但是同时输出的可读性、[混合语言](https://zhida.zhihu.com/search?content_id=252928762&content_type=Article&match_order=2&q=%E6%B7%B7%E5%90%88%E8%AF%AD%E8%A8%80&zhida_source=entity)输出问题还是老大难. 可别忘了SFT不就是为了遵循指令,让LLM模仿说人话吗？那把SFT阶段再加上不就得了. 既然完全不SFT也能有非常好的效果,那少加一点是不是就能让LLM学会说人话了,同时推理能力也能进一步提升呢？DeepSeek-R1采用如下4个阶段,又把能力进一步加强.

- **少量数据冷启动**

采用一定的手段收集少量高质量数据：比如对于长CoT数据,使用[few-shot](https://zhida.zhihu.com/search?content_id=252928762&content_type=Article&match_order=1&q=few-shot&zhida_source=entity),直接提示DeepSeek-R1-Zero通过反思和验证生成详细答案,然后通过 [人工注释](https://zhida.zhihu.com/search?content_id=252928762&content_type=Article&match_order=1&q=%E4%BA%BA%E5%B7%A5%E6%B3%A8%E9%87%8A&zhida_source=entity)者的后处理来细化结果.

总共收集了数千个样本,相比完全不用SFT,收集的样本进行SFT,可以显著增强可读性; 同时后续的实验也证明了通过少量数据冷启动也能进一步提升推理能力.

- **对推理场景进行RL**

然后对数学、代码等推理场景进行RL. 这里没啥好说的,和DeepSeek-R1-Zero一样的方式. 针对DeepSeek-R1-Zero输出中语言混合的情况,额外增加一个奖励：语言一致性奖励,统计输出中目标语言的占比作为奖励信号. 将原始的准确性奖励与语言一致性奖励求和作为最终奖励,进行过程反馈.

- **拒绝采样和SFT**

这一步主要是为了提升模型的通用能力,通过构建两部分的数据进行SFT来实现.

1. [推理数据](https://zhida.zhihu.com/search?content_id=252928762&content_type=Article&match_order=1&q=%E6%8E%A8%E7%90%86%E6%95%B0%E6%8D%AE&zhida_source=entity)：采用拒绝采样的方式从前一阶段得到的模型生成推理过程,同时额外引入一些无法用规则进行奖励的数据(这部分数据使用DeepSeek-V3通过LLM-as-judge的方式进行奖励,比较GroudTruth与实际输出). 同时,过滤掉了包含混合语言、长段落、代码块的CoT数据. 总计有60w样本.2. 非推理数据：使用DeepSeek-V3生成、使用DeepSeek-V3的SFT数据,共计20w推理无关的样本.

这一阶段总共生成了80w样本,用DeepSeek-V3-Base 进行了2个epoch的SFT.

- **适配所有场景的RL阶段**

最后为了同时平衡推理能力和通用能力,又进行了一次RL. 对于不同的数据类型,采用不同的prompt和奖励.

对于推理数据,使用DeepSeek-R1-Zero中的方法,该方法在数学、编程和逻辑推理领域使用基于规则的奖励指导学习过程. 对于通用数据,使用通用的RM来进行奖励. 基本复用[DeepSeek-V3](https://zhida.zhihu.com/search?content_id=252928762&content_type=Article&match_order=6&q=DeepSeek-V3&zhida_source=entity)的方式. 对于有用性,专注于评估最终的summary,确保评估对用户的实用性和相关性,同时尽量减少对底层推理过程的干扰. 对于无害性,评估模型的整个响应,包括推理过程和总结,以识别和减轻生成过程中可能出现的任何潜在风险、偏见或有害内容.

最终,奖励信号和多样化[数据分布](https://zhida.zhihu.com/search?content_id=252928762&content_type=Article&match_order=1&q=%E6%95%B0%E6%8D%AE%E5%88%86%E5%B8%83&zhida_source=entity)的整合使得最终的模型既能保持推理能力,又能满足有用性和无害性,取得比较好的用户体验.

实验结果自然是遥遥领先,和OpenAI-o1-1217不分伯仲.

![](./05-DeepSeek-R1论文速读_images/image_5.jpg)

## 3. 蒸馏小模型

直接用DeepSeek-R1阶段三：“拒绝采样和SFT” 时的数据对小模型进行SFT,**不包含RL阶段**,就能取得比较好的效果.

![](./05-DeepSeek-R1论文速读_images/image_6.jpg)

## 4. 一些讨论

- **蒸馏 v.s. RL**

从实验结果来看,蒸馏是又便宜又实用. 用小的模型哼哧哼哧一顿SFT+RL操作,最后的效果还远不如直接蒸馏更好性能模型的输出直接SFT.

![](./05-DeepSeek-R1论文速读_images/image_7.jpg)

- **一些暂未成功的尝试**

这里DeepSeek团队也是诚意满满,分享了几个业界呼声很高,但是他们暂时没尝试成功的方法.

[PRM](https://zhida.zhihu.com/search?content_id=252928762&content_type=Article&match_order=1&q=PRM&zhida_source=entity): 指出PRM的几个主要限制,影响了它的规模化应用. 1. 在一般推理过程中明确定义细粒度的步骤比较困难. 2. 对步骤打标难以扩展,采用自动标注难以获得较高准确率,手动标注又难以规模化应用. 3. 引入基于模型的PRM,不可避免地会遇到[reward hacking](https://zhida.zhihu.com/search?content_id=252928762&content_type=Article&match_order=1&q=reward+hacking&zhida_source=entity), 重新训练奖励模型需要额外的训练资源,并使整个训练流程复杂化.

[MCTS](https://zhida.zhihu.com/search?content_id=252928762&content_type=Article&match_order=1&q=MCTS&zhida_source=entity)** :**** **他们也尝试了实用MCTS,但是过程中遇到了一些问题,1是搜索空间过大,虽然设置了最大扩展限制使得不会无限搜索,但是容易陷入局部最优;  2是 [value model](https://zhida.zhihu.com/search?content_id=252928762&content_type=Article&match_order=1&q=value+model&zhida_source=entity)直接影响生成的质量,而训练一个细粒度的value model本质上是困难的,这使得模型比较难以迭代改进.

## 5. 一些未来的改进方向

- **通用能力**：DeepSeek-R1的通用能力仍然不及[DeepSeekV3](https://zhida.zhihu.com/search?content_id=252928762&content_type=Article&match_order=1&q=DeepSeekV3&zhida_source=entity). 接下来,DeepSeek团队计划探索如何利用长CoT来提升这些领域的任务表现.

- **语言混合**：DeepSeek-R1目前针对中文和英文进行了优化,但是在处理其他语言以及语言遵循方面还是会有问题.

- **PE**：DeepSeek-R1对Prompt非常敏感. few-shot提示会持续降低其性能. 这里建议用户直接描述问题并指定输出格式(采用 [zero-shot](https://zhida.zhihu.com/search?content_id=252928762&content_type=Article&match_order=1&q=zero-shot&zhida_source=entity),不要加示例),以获得最佳结果.

- **软件工程任务**：由于长时间的评估会影响RL过程的效率,大规模RL尚未在软件工程任务中广泛应用. 因此,DeepSeek-R1在软件工程基准测试上未显示出比DeepSeek-V3更大的改进. 未来版本将通过在软件工程数据上实施拒绝采样或在RL过程中引入异步评估来提高效率.

## 6. 参考

1. [https://github.com/deepseek-ai/DeepSeek-R1/blob/main/DeepSeek_R1.pdf](https://link.zhihu.com/?target=https%3A//github.com/deepseek-ai/DeepSeek-R1/blob/main/DeepSeek_R1.pdf)