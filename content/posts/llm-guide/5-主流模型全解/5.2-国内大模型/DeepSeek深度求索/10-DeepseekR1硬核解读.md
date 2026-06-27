---
title: "Deepseek R1 硬核解读"
date: 2026-05-11
tags: []
---

# 10 Deepseek R1 硬核解读

**作者: 学车辆算法工程师**

**原文: https://zhuanlan.zhihu.com/p/21516563677**

## 1. **R1和zero的关系：**

1. zero是预训练后直接进行强化学习获得的，存在可读性差、语言混合等问题2. R1的构造逻辑如下： 

1. deepseek进行预训练，得到deepseek v3-base2. 构造少量long-cot数据对deepseek v3-base进行sft，得到sft model3. 将以上sft model 进行强化学习得到RL model4. 对以上RL model进行拒绝采样，获取部分蒸馏数据A5. 将[蒸馏数据](https://zhida.zhihu.com/search?content_id=253325529&content_type=Article&match_order=2&q=%E8%92%B8%E9%A6%8F%E6%95%B0%E6%8D%AE&zhida_source=entity)A和deepseek v3的sft数据进行混合训练得到 sft model26. 对sft model2 进行价值对齐(有用性、无害性、多场景)的RLHF得到最终的R17. b-f步迭代

​

![](./10-DeepseekR1硬核解读_images/image_0.jpg)

​

1. 不经过SFT，直接RL(zero)2. 经过少量 long-cot 数据SFT然后进行RL(R1)3. R1使用少量(数千条)的long-cot数据进行冷启动的SFT目标在于以下几点： 

prompt：你好，base：漂亮，SFT：你好，有什么可以帮您。R1:您好，step1.我可以洗衣服、step2查资料、。。。

1. 由于目标策略\(\pi_\theta\)与base模型的策略\(\pi\)相差甚远，这会导致 [收敛速度](https://zhida.zhihu.com/search?content_id=253325529&content_type=Article&match_order=1&q=%E6%94%B6%E6%95%9B%E9%80%9F%E5%BA%A6&zhida_source=entity)慢的问题，使用少量long-cot数据冷启动，这类似于深度学习训练中，首先使用较大的learn rate靠近目标，再使用较小的learn rate精调。2. 直接使用强化学习，不进行任何的sft将导致不可读、语言混合等问题。这个问题出现的原因，个人认为还是由于目标策略\(\pi_\theta\)与base模型的策略 \(\pi\)相差甚远，强化学习仅由结果奖励(ORM)粒度太粗，难以控制细粒度的生成问题。3. 语言一致性奖励，将混合语言的采样输出进行惩罚，将提高人类可读性。(规则->reward->SFT->reward model)

## 2. **强化学习**

1. GRPO算法

![](./10-DeepseekR1硬核解读_images/image_1.jpg)

1. 以上GRPO不再计算Critic估计的优势函数，而是以组内的相对奖励作为优势进行训练。 

1. 以下每次采样获得的优势，是该次采样的奖励减去组内奖励均值并且处以方差，即标准化过程2. 标准化过程的目的是：不同组内标准化有一个统一量纲:(每一个组代表ACTOR同输入下，不同的输出采样) 

1. 举例如下第一组(代码题)分数，5，4，3。第二组(写作)分数1，2，3。2. 如果不做标准化，所有优势为正，更加重要的是，由于两组的整体均值为3，此时将导致第一组所有样本被奖励，第二组所有样本被惩罚。这种情况下完全不会使得模型变好。

1. 为什么不使用[dpo](https://zhida.zhihu.com/search?content_id=253325529&content_type=Article&match_order=1&q=dpo&zhida_source=entity)和ppo： 

1. Dpo的数据样式：prompt：你好。 answer1: 你好，有什么可以帮您。answer2:我现在很忙，戴一边去。(离线强化学习)2. dpo需要对每个输入，标注至少两个相对优劣的answer，标注成本高，将注定难以泛化。3. 由于$\pi_{ref}的正则项，不进行任何long-cot的SFT直接dpo将会导致模型的正则项非常大，难以收敛$

\(\mathcal{L}_{DPO}(\theta) = - \mathbb{E}_{(x, y_w, y_l) \sim D} \left[ \log \sigma \left( \beta \left( \log \frac{\pi_\theta(y_w | x)}{\pi_{ref}(y_w | x)} - \log \frac{\pi_\theta(y_l | x)}{\pi_{ref}(y_l | x)} \right) \right) \right]\)

ppo算法的优势依赖于Critic模型对状态价值进行估计，Value的的含义是当前状态未来所有可能的奖励(reward)期望总和，reward本身就是reward model进行估计的，使用Critic model估计value将更加难以泛化。 

\(\mathcal{L}_{CLIP}(\theta) = E_t \left[ \min \left( r_t (\theta) A_t , \mathrm{clip} \left( r_t (\theta), 1-\epsilon, 1+\epsilon \right) A_t \right) \right] A_t = r_t + \gamma V(s_{t+1}) - V(s_t)\)

[时序差分](https://zhida.zhihu.com/search?content_id=253325529&content_type=Article&match_order=1&q=%E6%97%B6%E5%BA%8F%E5%B7%AE%E5%88%86&zhida_source=entity)的At优势，这里的V都是用Critic估计的。

​

## 3. **Reward model**

1. 奖励分为两块，一块是格式，一块是输出结果2. 不使用模特卡罗搜索树和过程奖励(PRM)，不使用PRM的原因是 

1. 难以对过程建立较好的reward判断，容易出现[reward hack](https://zhida.zhihu.com/search?content_id=253325529&content_type=Article&match_order=1&q=reward+hack&zhida_source=entity)。2. 难以控制奖励的粒度，比如句子级、token级、还是cot级。3. 数据标注变得复杂，也难以泛化。

​

1. 不使用MCTS([蒙特卡洛搜索树](https://zhida.zhihu.com/search?content_id=253325529&content_type=Article&match_order=1&q=%E8%92%99%E7%89%B9%E5%8D%A1%E6%B4%9B%E6%90%9C%E7%B4%A2%E6%A0%91&zhida_source=entity))，这个主要由于句子生成的状态空间太大(比如长链条数据假设上限长度10000，中文词表数30000，状态空间将高达) \(30000^{10000}\),状态空间太大，难以训练泛化性良好的Critic 模型估计Value。2. 训练3. zero模型给予一个推理思考的模板，

![](./10-DeepseekR1硬核解读_images/image_2.jpg)

​

1. zero模型在强化学习过程中会逐渐增加推理长度，从而获得正确答案，这是因为对于复杂问题，长链条的思考会结合反思逐步增加正确率，然后正确答案获得奖励，从而改变模型的推理范式。

![](./10-DeepseekR1硬核解读_images/image_3.jpg)

​

## 4. **SFT数据构成：**

1. 推理(cot)数据：使用之前RL的Checkpoint进行数据生成，之前第一轮只用规则能够验证的通过的数据，后面我们可以扩充部分通过reward model拒绝采样的数据。2. 非推理数据：对于简单问题直接回复，否则直接使用deepseek v3的cot回复，进行数据收集。3. 为了与人类的偏好一致，再次进行了强化学习，这次强化学习与instruct gpt 相同，主要考虑无害性和有用性。

## 5. **小模型蒸馏**

1. 将deepseek r1的数据蒸馏到小模型中将极大的增加小模型的复杂问题解决能力2. 蒸馏后的模型重复R1的强化学习过程可以进一步加强推理能力3. 小参数模型仅进行强化学习收益远低于R1[数据蒸馏](https://zhida.zhihu.com/search?content_id=253325529&content_type=Article&match_order=2&q=%E6%95%B0%E6%8D%AE%E8%92%B8%E9%A6%8F&zhida_source=entity)4. 资源有限的情况下，优先进行R1的蒸馏5. 小模型没有壁垒