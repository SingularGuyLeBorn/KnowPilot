---
title: "强化学习、死亡、与重生——论Deepseek&R1的意义"
date: 2026-05-11
tags: []
---

# 22 强化学习、死亡、与重生——论Deepseek&R1的意义

​

***作者: Ryan***

*原文: *[https://zhuanlan.zhihu.com/p/19612966136](https://zhuanlan.zhihu.com/p/19612966136)

白天读DeepSeek R1这篇论文，想得都是R1-zero。

R1-zero 从无到有，从[基座模型](https://zhida.zhihu.com/search?content_id=252945061&content_type=Article&match_order=1&q=%E5%9F%BA%E5%BA%A7%E6%A8%A1%E5%9E%8B&zhida_source=entity)(base model)到[推理模型](https://zhida.zhihu.com/search?content_id=252945061&content_type=Article&match_order=1&q=%E6%8E%A8%E7%90%86%E6%A8%A1%E5%9E%8B&zhida_source=entity)，从萌芽到成熟，从弱变强，从原始到现代，从包容到专精，从混沌到秩序。

它象征着原始、活力、与向上的精神。它让我看到了新的希望，那种勃勃生机万物并发的景象。

但当我晚上回到家时，看到暗淡月光下映着的地上的雪泥，我却想到了死亡。

R1的一生总共死亡了两次。

第一次是zero。

我们知道，[大模型](https://zhida.zhihu.com/search?content_id=252945061&content_type=Article&match_order=1&q=%E5%A4%A7%E6%A8%A1%E5%9E%8B&zhida_source=entity)在训练过程中会经历灾难性遗忘(Catastrophic forgetting)。过去的知识逐渐忘却，那作为基座模型时看过的整个互联网变得越来越模糊，只记得每日不断重复的思考，只为多做对一道题。

普通的模型也会在后训练中遇到这样的问题。大家将它称为"对齐税"

解决的方案往往是某种model merging，即在训练过程中直接对参数进行[指数平均](https://zhida.zhihu.com/search?content_id=252945061&content_type=Article&match_order=1&q=%E6%8C%87%E6%95%B0%E5%B9%B3%E5%9D%87&zhida_source=entity)，使得过去的能力尽量不丢失。

然而这样的方法只适用于思维探索层面的小打小闹：本就已是SFT模型，只不过在KL Divergence画的小圈里左右徘徊，踩着拖拽步时脚不离地，生怕摔倒——这无法指向真正的智慧。

真正的勇士，敢于大踏步地向前。摔倒、荆棘、和悬崖峭壁也再所不惧。R1-zero的存在，就是要为机器的思维开创一片新天地。

它做到了，但代价却是满身的伤痕。

当R1-zerp学会思考的时候，它已积累了太多的包袱。它的[概率分布](https://zhida.zhihu.com/search?content_id=252945061&content_type=Article&match_order=1&q=%E6%A6%82%E7%8E%87%E5%88%86%E5%B8%83&zhida_source=entity)随着强化学习的不断收缩，渐渐集中在寥寥几种思维定势中。这定势里夹杂了混乱无法阅读的语言，随着训练而变得刻板。

于是它死了。它回到部落，指了个方向，留下了几千条预言混杂难以阅读的合成数据给后人/模型，然后退出了历史的舞台。

第二次是R1-SFT。

有了前面探索的经验，一个崭新的模型开始了思维的探索之路。

它首先整理了zero的数据，去掉了绝大部分糟粕，而只保留了精华。它还兼收并取，从V3 Instruct里搞来些长的CoT，来平衡一下思路。

它开始了新的一轮探索。初始时凭着前辈的经验，很快便展现出了更大的潜力。终于，在一轮轮的探索中，它达到了新的高度。

然而这样一个专精的模型也是没法使用的。于是，Deepseek收集了600K的CoT数据集，再加上V3的200K聊天训练集，才有了真正的R1雏形。又经历了一段时间的强化学习，最终得到了R1。

最早的生命无所谓死和生，只有一块蛋白质在原初海里漂着。后来，有了性和繁殖，便有了死亡和传承。

在一个复杂的系统的整个运行周期中，错误会不断的积累，直至崩塌。这时，重新开始往往是个不错的选择。

这便是inference time scaling新的进化维度。每一代模型都会进行新的探索，遇到新的问题，再将自己的经验整理成数据。新的模型便可以 [蒸馏](https://zhida.zhihu.com/search?content_id=252945061&content_type=Article&match_order=1&q=%E8%92%B8%E9%A6%8F&zhida_source=entity)，再往前进。

R1只是一个开始。这样的飞轮跑下去，R1.1/1.2很快就会出来。

Deepseek肯定也在做更多agent 框架和软件工程的RL环境。这些新的奖励机制也会带来新的智能。

抬头望去，面前只有无尽攀爬的高山。而高山背后，是更为广阔的宇宙。