---
title: "06 · 从GPT-1到GPT-4，GPT系列模型详解"
date: 2026-05-11
tags: []
---

# 06 从GPT-1到GPT-4，GPT系列模型详解

**作者: 北方的郎**

**原文: **[https://zhuanlan.zhihu.com/p/627901828](https://zhuanlan.zhihu.com/p/627901828)

## 1. 相关论文链接：

GPT **Improving Language Understanding by Generative Pre-Training**. 2018. [Paper](https://link.zhihu.com/?target=https%3A//s3-us-west-2.amazonaws.com/openai-assets/research-covers/language-unsupervised/language_understanding_paper.pdf)

[GPT-2](https://zhida.zhihu.com/search?content_id=227665636&content_type=Article&match_order=1&q=GPT-2&zhida_source=entity)** Language Models are Unsupervised Multitask Learners**. 2018. [Paper](https://link.zhihu.com/?target=https%3A//d4mucfpksywv.cloudfront.net/better-language-models/language_models_are_unsupervised_multitask_learners.pdf)

[GPT-3](https://zhida.zhihu.com/search?content_id=227665636&content_type=Article&match_order=1&q=GPT-3&zhida_source=entity)** "Language Models are Few-Shot Learners"**. NeurIPS 2020. [Paper](https://link.zhihu.com/?target=https%3A//arxiv.org/abs/2005.14165)

[InstructGPT](https://zhida.zhihu.com/search?content_id=227665636&content_type=Article&match_order=1&q=InstructGPT&zhida_source=entity): **Training language models to follow instructions with human feedback**, Arxiv 2022 [Paper](https://link.zhihu.com/?target=https%3A//arxiv.org/abs/2203.02155)

GPT-4 **"GPT-4 Technical Report"**. 2023. [Paper](https://link.zhihu.com/?target=http%3A//arxiv.org/abs/2303.08774v2)

GPT影响 [[2303.10130] GPTs are GPTs: An Early Look at the Labor Market Impact Potential of Large Language Models (arxiv.org)](https://link.zhihu.com/?target=https%3A//arxiv.org/abs/2303.10130) 2023.

![](https://www.yuque.com/attachments/yuque/0/2025/p/42982692/1754091473975-514ca785-279c-4782-b6af-a7604c7a3181.p)

## 2. GPT-1(GPT就是Generative Pre-Training)：

《Improving Language Understanding by Generative Pre-Training》是2018年由OpenAI的研究团队发布的一篇论文. 它介绍了一种名为“生成式预训练”(Generative Pre-Training，简称GPT)的新型语言模型，该模型通过在大规模语料库上进行训练，能够学习自然语言的模式和规律，从而实现更好的语言理解. 

![](https://www.yuque.com/attachments/yuque/0/2025/j/42982692/1754091474040-d8fbcaa0-1dd2-49d1-a670-dfa94daa803b.j)

GPT模型是一种基于神经网络的自回归语言模型. 该模型使用了一个称为“Transformer”的架构，这是一种新型的序列到序列模型，能够在处理长序列数据时避免传统的循环神经网络(Recurrent Neural Network，RNN)中存在的梯度消失问题. Transformer架构中的关键组件包括多头注意力机制和残差连接等. GPT使用了Transformer的Decoder  部分. 为了预训练GPT模型，研究团队使用了两个大规模的语料库：BooksCorpus和英文维基百科. 

以下是GPT1的主要技术特点：

基于Transformer架构：GPT1采用了Transformer架构，其中包括多头自注意力机制和前向神经网络. 这使得GPT1可以在处理自然语言时捕捉长距离依赖性，并且具有高效的并行性. 

![](https://www.yuque.com/attachments/yuque/0/2025/j/42982692/1754091474115-031bd30b-e772-4261-8304-4a0a686f768b.j)

预训练技术：GPT-1使用了一种称为“生成式预训练”(Generative Pre-Training，GPT)的技术. 预训练分为两个阶段：预训练和微调(fine-tuning). 在预训练阶段，GPT-1使用了大量的无标注文本数据集，例如维基百科和网页文本等. 通过最大化预训练数据集上的log-likelihood来训练模型参数. 在微调阶段，GPT-1将预训练模型的参数用于特定的自然语言处理任务，如文本分类和问答系统等. 

多层模型：GPT-1模型由多个堆叠的TransformerEncoder 组成，每个Encoder 包含多个注意力头和前向神经网络. 这使得模型可以从多个抽象层次对文本进行建模，从而更好地捕捉文本的语义信息. 

通过使用上述预训练任务，研究团队成功地训练出了一个大规模的语言模型GPT. 该模型在多项语言理解任务上取得了显著的成果，包括阅读理解、情感分类和自然语言推理等任务. 

![](https://www.yuque.com/attachments/yuque/0/2025/j/42982692/1754091474176-298669a5-9370-461b-9003-b15c97ea9710.j)

通过微调GPT模型，可以针对特定的任务进行优化，例如文本生成、机器翻译和对话系统等. 

总之，GPT1是一种基于Transformer架构的预训练语言模型，具有多层模型、生成式预训练技术和独特的解码技术等特点. 它为后续的自然语言处理技术提供了一个新的标准，并为人工智能技术的发展提供了新的思路. 

## 3. GPT-2(模型不需要人来指导，要的就是Unsupervise)：

《Language Models are Unsupervised Multitask Learners》是一篇介绍GPT-2(Generative Pre-trained Transformer 2)模型的论文，它是2019年发表在OpenAI的博客上. 

![](https://www.yuque.com/attachments/yuque/0/2025/j/42982692/1754091474249-622e00a9-1bc1-4089-8384-2d4615357f93.j)

GPT-2主要解决的问题是如何利用大规模未标注的自然语言文本来预训练一个通用的语言模型，从而提高自然语言处理的能力. 与GPT-1模型不同之处在于，GPT-2模型使用了更大的模型规模和更多的数据进行预训练，同时增加了许多新的预训练任务. 

![](https://www.yuque.com/attachments/yuque/0/2025/j/42982692/1754091474334-0739ba00-32a1-4b09-92eb-b157ae50e5ee.j)

以下是GPT-2的主要技术特点(其实除了规模大一点，和GPT-1变化不大)：

1. 大规模预训练：GPT-2使用了一种无监督学习的方法，在大规模文本语料库上进行预训练. 在这个阶段，模型从语料库中学习文本序列的统计规律和语义信息. 2. 非监督多任务学习：GPT-2具有多任务学习的能力，通过训练模型来执行多个不同的自然语言处理任务，从而提高模型的鲁棒性和泛化能力. 3. Transformer架构：GPT-2使用Transformer架构作为模型的基础，使得模型可以自适应地处理长距离依赖关系，从而更好地理解文本的语义. 4. 无需人工标注数据：GPT-2在训练过程中不需要人工标注数据，可以自动从大规模文本语料库中学习自然语言的规律. 5. 零样本学习：GPT-2具有零样本学习的能力，能够在只看到少量样本的情况下学习和执行新任务. 

![](https://www.yuque.com/attachments/yuque/0/2025/j/42982692/1754091474415-5a5ca147-753a-4a43-84e2-3bf5b4b83aaf.j)

在成果方面，GPT-2模型在许多自然语言处理任务上取得了显著的成果，如问答系统、文本分类、命名实体识别、语言推理等. 此外，GPT-2模型还在生成文本方面表现出色，能够生成具有逼真度的连贯文本，并且可以根据用户提供的开头和主题生成长篇文章. GPT-2模型被广泛认为是目前最强大的自然语言处理模型之一. 

总之，GPT-2是一种无监督学习的多任务语言模型，具有大规模预训练、Transformer架构、多层结构、无需人工标注数据和零样本学习等特点. 它在自然语言处理任务中取得了显著的成果，是自然语言处理领域中的一项重要进展. 

## 4. GPT-3(模型变大了也变强了)：

《Language Models are Few-Shot Learners》是一篇介绍GPT-3(Generative Pre-trained Transformer 3)模型的论文，它是2020年发表在OpenAI的博客上. 

![](https://www.yuque.com/attachments/yuque/0/2025/j/42982692/1754091474490-891164c6-4b1d-4920-89d2-9a35bf442a13.j)

GPT-3主要解决的问题是如何使一个预训练的语言模型具有迁移学习的能力，即在只有少量标注数据的情况下，能够快速适应到新的任务中. 

![](https://www.yuque.com/attachments/yuque/0/2025/j/42982692/1754091474573-97eb08cf-3fac-439a-a445-6a55cdfe8f78.j)

GPT-3模型采用了基于Transformer的架构，与前一代GPT-2类似(原话是：We use the same model and architecture as GPT-2)，但是在模型规模、预训练数据量和使用的预训练任务上都有所增加. GPT-3的模型规模为1750亿个参数，是前一代GPT-2的100倍以上. 

![](https://www.yuque.com/attachments/yuque/0/2025/j/42982692/1754091474658-30af9408-1606-4c8a-a0e1-52ebd628552e.j)

GPT它变大了，也变强了:

![](https://www.yuque.com/attachments/yuque/0/2025/j/42982692/1754091474733-b4cec911-be17-4f49-80bd-c73ed42af9e2.j)

GPT-3使用了多个来源的数据，包括互联网上的文本、书籍、新闻和Wikipedia等. 这些数据经过清洗和处理后，用于预训练和微调. 

![](https://www.yuque.com/attachments/yuque/0/2025/j/42982692/1754091474810-330ad9f3-78ef-4b89-8250-278731935358.j)

![](./06-从GPT-1到GPT-4GPT系列模型详解-images/image_12.jpg)

GPT-3在多个NLP任务上表现出了惊人的能力. 在自然语言推理任务中，GPT-3模型的准确率达到了近80%，超过了当时最好的模型. 在问答任务中，GPT-3模型只需要给出几个样例输入就能够完成对新问题的回答. 

![](https://www.yuque.com/attachments/yuque/0/2025/j/42982692/1754091474885-5798ad3e-64fd-42d9-8611-3de0a193d6f9.j)

![](./06-从GPT-1到GPT-4GPT系列模型详解-images/image_14.jpg)

在生成文本任务中，GPT-3模型能够生成逼真、连贯、富有创造性的文本，甚至可以写出短故事、诗歌和新闻报道等. 

此外，GPT-3还具有零样本学习的能力，即能够在没有任何样本数据的情况下进行学习和预测. 例如，当给定一个新的任务和一些文字描述时，GPT-3能够基于文字描述自动推理出该任务的执行过程. 

总之，GPT-3模型的能力已经超出了传统的自然语言处理模型，展示了无监督学习和迁移学习在自然语言处理领域的潜力和前景. 

## 5. InstructGPT(还是要指导指导(Instruct)模型啊，要不总出幺蛾子):

《InstructGPT: Training language models to follow instructions with human feedback》是一篇由OpenAI团队发表的论文，于2021年在ICML上发布. 

![](https://www.yuque.com/attachments/yuque/0/2025/j/42982692/1754091474962-b3c02801-c510-4fe9-953a-f04c9f0ee06d.j)

InstructGPT提出的背景：使语言模型更大并不意味着它们能够更好地遵循用户的意图，例如大型语言模型可以生成不真实、有毒或对用户毫无帮助的输出，即这些模型与其用户不一致. InstructGPT主要解决的问题是如何让语言模型能够更好地遵循人类给出的指令，并在实践中实现它们. 此类模型可以广泛应用于自然语言生成、对话系统和语言翻译等领域. 

InstructGPT模型在GPT-3基础上进一步强化. InstructGPT使用来自人类反馈的强化学习方案RLHF(reinforcement learning from human feedback)，通过对大语言模型进行微调，从而能够在参数减少的情况下，实现优于GPT-3的功能. 

![](https://www.yuque.com/attachments/yuque/0/2025/j/42982692/1754091475039-8ca917a3-3be7-454e-937b-5e3924e5cd25.j)

OpenAI在GPT-3基础上根据人类反馈的强化学习方案RHLF，训练出奖励模型(rewardmodel)去训练学习模型(即：用AI训练AI的思路)

具体来说，该方法包括以下步骤：

定义指令：首先，定义指令集合，即人类需要模型生成的语言指令. 这些指令通常是任务相关的，例如完成一项任务或回答某个问题. 

生成指令：通过 InstructGPT 生成一个或多个备选指令，每个指令都对应一个相应的生成概率. 这些备选指令会显示在屏幕上供人类评估. 

人类反馈：人类对生成的备选指令进行评估，并提供一个奖励信号，表示该指令与预期指令的匹配程度. 奖励信号可以表示为基于 BLEU、ROUGE 等指标的分数. 

强化学习训练：根据人类反馈，训练模型以优化生成指令的质量. 具体来说，使用强化学习算法，将生成的指令和人类反馈作为训练数据，迭代训练模型，以最大化生成指令的奖励信号. 

该方法的优点是可以让语言模型更加有针对性地生成文本，以适应特定任务或场景，并且可以根据人类反馈进行动态调整，提高生成文本的质量和多样性. 

InstructGPT的结果表明，在接受足够反馈的情况下，该模型可以在大多数指令数据集上达到95%以上的准确率，超过了其他常用模型. 此外，InstructGPT还展示了其在指令执行、对话系统和游戏中的应用能力. 例如，它可以在指令行动游戏中成功地执行多个连续的指令，如“向右移动、跳跃、开门”等，还可以在对话系统中通过遵循用户的指令来进行对话. 

总之，InstructGPT通过将人类反馈作为训练和微调的关键组成部分，开发出了一种新的指令遵循框架，该框架可以提高语言模型的实际应用能力. 这项工作为训练语言模型以更好地遵循指令提供了一个新的范例，未来可以在更多领域进行应用. 

## 6. ChatGPT(来聊聊吧)

ChatGPT 是OpenAI在2022年基于 GPT-3 模型的升级版，主要针对对话任务进行了优化，增加了对话历史的输入和输出，以及对话策略的控制. ChatGPT 在对话任务上表现出色，可以与人类进行自然而流畅的对话. 不过没有详细的论文说明了，技术细节大致、应该和InstructGPT差不多吧. 

## 7. GPT-4(这个模型能自己考大学了)：

GPT-4是OpenAI在2023年发布的最新一代模型. 可以理解图片. GPT-4也是只有技术报告. 

![](https://www.yuque.com/attachments/yuque/0/2025/j/42982692/1754091475112-ef311e79-aa5f-4c2d-a665-fdc1fa943072.j)

在随意谈话中，ChatGPT和GPT-4之间的区别是很微妙的. 只有当任务的复杂性达到足够的阈值时，差异就出现了，GPT-4比ChatGPT更可靠、更有创意，并且能够处理更细微的指令. 为了了解这两种模型之间的差异，OpenAI在各种基准测试和一些为人类设计的模拟考试上进行了测试，并且取得了非常好的结果. 同时GPT-4有很强的多模态能力. 在这个报告包括各种爆表的性能，例如：

在随意谈话中，GPT-3.5和GPT-4之间的区别是很微妙的. 只有当任务的复杂性达到足够的阈值时，差异就出现了，GPT-4比GPT-3.5 更可靠、更有创意，并且能够处理更细微的指令. 为了了解这两种模型之间的差异，OpenAI在各种基准测试和一些为人类设计的模拟考试上进行了测试. 

GPT-4在各种考试中，有几个测试几乎接近了满分，如：USABO Semifinal 2020(美国生物奥林匹克竞赛)，GRE Writing. 以美国 BAR律师执照统考为例，GPT3.5可以达到 10%水平，GPT4可以达到90%水平. 生物奥林匹克竞赛从GPT3.5的31%水平，直接飙升到 99%水平

此外，OpenAI 还在为机器学习模型设计的传统基准上评估了 GPT-4. 从实验结果来看，GPT-4 大大优于现有的大型语言模型，以及大多数 SOTA 模型

英伟达AI科学家Jim Fan点评道：「GPT-4最强的其实就是推理能力. 它在GRE、SAT、法学院考试上的得分，几乎和人类考生没有区别. 也就是说，GPT-4可以全靠自己考进斯坦福了. 」(Jim Fan自己就是斯坦福毕业的！)

![](https://www.yuque.com/attachments/yuque/0/2025/j/42982692/1754091475222-c56b810e-c3ef-46cb-8ca7-b69bfcfa02c1.j)

![](./06-从GPT-1到GPT-4GPT系列模型详解-images/image_19.jpg)

GPT-4在不同语种上的能力表现：中文的准确度大概在 80% 左右，已经要优于GPT-3.5的英文表现了. 

许多现有的 ML 基准测试都是用英语编写的. 为了初步了解GPT-4其他语言的能力，研究人员使用 Azure翻译将 MMLU 基准(一套涵盖57个主题的14000个多项选择题)翻译成多种语言. 

![](https://www.yuque.com/attachments/yuque/0/2025/j/42982692/1754091475298-9657d047-b439-4413-8959-1bd2f28d81ac.j)

GPT-4模型的一大重点是建立了一个可预测扩展的深度学习栈. 因为对于像GPT-4这样的大型训练，进行广泛的特定模型调整是不可行的. 因此，OpenAI团队开发了基础设施和优化，在多种规模下都有可预测的行为. 为了验证这种可扩展性，研究人员提前准确地预测了GPT-4在内部代码库(不属于训练集)上的最终损失，方法是通过使用相同的方法训练的模型进行推断，但使用的计算量为1/10000. 

![](https://www.yuque.com/attachments/yuque/0/2025/j/42982692/1754091475387-8fbce084-1e3d-4629-b199-d0ee15073811.j)

![](./06-从GPT-1到GPT-4GPT系列模型详解-images/image_22.jpg)

GPT-4的规模报告里也没有提，不过可以从它Token的数量上大致推测一下：GPT-4最大的模型有32,768个Token，对比GPT-3.5( 4,096 个)及GPT-3 (2,049个)规模有很大提升. 

![](https://www.yuque.com/attachments/yuque/0/2025/j/42982692/1754091475459-570e83e5-5286-44b5-9e9c-0edcafb98c4f.j)

![](./06-从GPT-1到GPT-4GPT系列模型详解-images/image_24.jpg)

## 8. GPT的影响

既然GPT这么厉害，那么对大家的工作会有多少影响呢？OpenAI发布了调研报告《GPTs are GPTs: An Early Look at the Labor Market Impact Potential of Large Language Models》针对GPT-4对于不同工作的影响进行了分析. 下面给大家简要介绍以下它的分析方法及部分结论，大家可以看看自己的行业有多大影响. 

文章开头，估计是为了吓唬读者一下，OpenAI又给大家亮了一下GPT-4在各种考试上横扫的成绩：

![](https://www.yuque.com/attachments/yuque/0/2025/j/42982692/1754091475529-ed6fc6b4-8ca0-4323-a5a5-c0612d81057a.j)

然后是分析方法和各种结论，摘要部分分享给大家. 

**分析方法**

OpenAI的这篇产业报告(下称报告)主要针对美国的职业信息网络数据集[O*NET](https://zhida.zhihu.com/search?content_id=227665636&content_type=Article&match_order=1&q=O%2ANET&zhida_source=entity)进行了人工加机器的评测. 报告里使用了来自该数据集里1016个职业的信息. 其中每个职业又被细化为他们的详细职业活动描述和任务类型，共计2087个不同的职业活动描述和19265个不同的任务. 报告主要根据O*NET数据集里的描述信息，使用人工和机器(GPT4)来对比判断不同职业受大模型的影响程度. 

报告所基于的人工评测主要来自于几位作者以及OpenAI的InstructGPT里雇佣过的标注人群. 标注方法主要是基于标注者的主观评判，将不同工作分为三个受影响等级：无影响，直接影响，和受可预见的大模型生态影响. 其中直接影响指的是如果直接使用chatGPT可以将完成该工作的职业活动描述或任务的工作时间减少一半以上. 受可预见的大模型生态影响指的是虽然直接使用chatGPT不会将工作任务所需时间减半. 

**部分结论**

算法认为如果考虑到当前的大模型的能力和可能营造的生态来说，至少50%的工作有百分之五十以上的工作内容，会在引入AI大模型后缩减至少一半的工作时间. 而人类对此的判断更为悲观，接近百分之六十. 

![](https://www.yuque.com/attachments/yuque/0/2025/j/42982692/1754091475602-4bfd074c-98c0-46e7-9f31-29f510be9e38.j)

现在chatGPT所掀起的风暴，相比于未来所可能得惊涛骇浪，仅仅是小儿科般的前兆. 随着OpenAI在2023-03-24日官宣的大模型+工具的生态接口，大模型的能力将会极大提升，而受波及的职业及人口将极速增加. 

报告里评测了受大模型所影响的职业和职业人口的相关关系，无论是人工评测还是GPT4模型评测，受影响的深浅程度与就业人口的多寡总体来说有联系，但影响不太直观. 即无论该职业的就业人口多寡，在技术浪潮面前没有显著差异. 

![](https://www.yuque.com/attachments/yuque/0/2025/j/42982692/1754091475674-39571f5c-833b-435a-8502-a20abad7a7d8.j)

总体来看，薪酬更高的职业受大模型及其相关生态的影响更大. 尽管低薪职业的方差较大(即存在受影响微乎其微的职业，也存在受大幅影响的职业，下面会解释何种职业受影响程度高或低)

![](https://www.yuque.com/attachments/yuque/0/2025/j/42982692/1754091475756-1b469445-7f18-48a8-ace2-686a63e7133f.j)

所需能力与写作和编程相关的职业受到影响最大. 其次是交流能力和主动倾听的能力. 从现有的chatGPT所展现出的能力来看，需要写作相关能力的如营销文案策划，需要主动倾听能力的如心理咨询，需要交流能力的如客服等职业都会受到剧烈的冲击. 而值得注意的是，**需要编程相关的工作，其回归数值的大小远远大于其他能力的数值(程序员痛哭ing)** . 

![](https://www.yuque.com/attachments/yuque/0/2025/j/42982692/1754091475836-70c0ca74-6aec-424a-aea1-c7f1c14d7944.j)

报告里细化讨论了不同学历，培训周期所对应的职业受影响程度的大小. 结论依然是越高学历所受的冲击越大. 其中需要人力从事直接体力劳动的职业(如餐饮，保洁等，普遍不需要太长的职业前培训和教育程度的工作)受该轮AI爆发的冲击极小. 而相反，如律师，设计师等需要大量时间职业前培训和教育程度的职业反而受到了巨大的冲击. 

如果从行业划分的话，所有与体力相关的行业，如制造业，农业，矿业受本轮AI浪潮影响最小. 而与之相反的是金融证券，保险行业，出版行业则受到的影响最大. 体力劳动行业，和部分中位数收入较低的职业，但所需技能集中在沟通写作类的群体如客服群体，其受影响程度截然不同. 

​