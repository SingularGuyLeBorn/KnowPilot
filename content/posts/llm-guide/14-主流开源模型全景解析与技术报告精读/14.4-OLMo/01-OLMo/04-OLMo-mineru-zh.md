---
title: "OLMo Technical Report (MinerU 逐译+译者注)"
converted_by: PyMuPDF (MinerU fallback)
source_pdf: OLMo.pdf
---

> 提取方式: PyMuPDF 兜底提取 (MinerU 3.1.14 CLI 服务挂起)
> 翻译说明: 本文档为英中对照逐段翻译, 英文原文在前, 中文译文紧随其后. `> 译者注:` 为译者添加的技术点评与背景补充.
> OLMo 是 AI2 推出的"完全白盒"开源语言模型, 其独特之处在于训练数据、代码、权重和日志全部公开.

OLMo : Accelerating the Science of Language Models
OLMo : 加速语言模型科学研究的开放之路

Dirk Groeneveld alpha Iz Beltagy alpha
Pete Walsh alpha Akshita Bhagia alpha Rodney Kinney alpha Oyvind Tafjord alpha
Ananya Harsh Jha alpha Hamish Ivison alpha beta
Ian Magnusson alpha Yizhong Wang alpha beta
Shane Arora alpha David Atkinson alpha Russell Authur alpha Khyathi Raghavi Chandu alpha
Arman Cohan gamma alpha Jennifer Dumas alpha Yanai Elazar alpha beta
Yuling Gu alpha
Jack Hessel alpha Tushar Khot alpha William Merrill delta
Jacob Morrison alpha
Niklas Muennighoff Aakanksha Naik alpha Crystal Nam alpha Matthew E. Peters alpha
Valentina Pyatkin alpha beta
Abhilasha Ravichander alpha Dustin Schwenk alpha Saurabh Shah alpha
Will Smith alpha Emma Strubell alpha mu Nishant Subramani alpha Mitchell Wortsman beta
Pradeep Dasigi alpha Nathan Lambert alpha Kyle Richardson alpha
Luke Zettlemoyer beta Jesse Dodge alpha Kyle Lo alpha Luca Soldaini alpha
Noah A. Smith alpha beta
Hannaneh Hajishirzi alpha beta

alpha Allen Institute for Artificial Intelligence
beta University of Washington
gamma Yale University
delta New York University
mu Carnegie Mellon University
olmo@allenai.org

## 摘要

> 🔙 **[返回 14.4-OLMo 家族总览](../../14.4-OLMo.md)**


Language models (LMs) have become ubiquitous in both NLP research and in commercial product offerings. As their commercial importance has surged, the most powerful models have become closed off, gated behind proprietary interfaces, with important details of their training data, architectures, and development undisclosed. Given the importance of these details in scientifically studying these models, including their biases and potential risks, we believe it is essential for the research community to have access to powerful, truly open LMs. To this end, we have built OLMo, a competitive, truly Open Language Model, to enable the scientific study of language models. Unlike most prior efforts that have only released model weights and inference code, we release OLMo alongside open training data and training and evaluation code. We hope this release will empower the open research community and inspire a new wave of innovation.
语言模型(language models, LMs)已在 NLP 研究与商业产品中无处不在. 随着其商业重要性激增,最强大的模型逐渐封闭,被限制在专有接口之后,其训练数据、架构与开发细节均未公开. 鉴于这些细节对于科学研究会带来重要影响,包括模型的偏见与潜在风险,我们认为研究社区必须能够获得强大的、真正开放的语言模型. 为此,我们构建了 OLMo,一个具有竞争力的、真正开放的语言模型(truly Open Language Model),以推动语言模型的科学研究. 与此前大多数仅发布模型权重与推理代码的工作不同,我们在发布 OLMo 的同时,还开放了训练数据、训练代码与评估代码. 我们希望此次发布能够赋能开放研究社区,并激发新一轮创新.

> 译者注: OLMo 的核心理念是"真正开放"(truly open). 与 LLaMA、Mistral 等仅公开权重的模型不同,OLMo 将数据、代码、权重、训练日志、中间检查点全部开源,并采用 Apache 2.0 许可证. 这种程度的开放对于语言模型的可复现性研究与科学理解至关重要.

## 1 引言

Language models have been at the center of NLP technologies for many years (Rosenfeld, 2000; Bengio et al., 2003; Mikolov et al., 2013; Peters et al., 2018; Brown et al., 2020). Recently, due to large-scale pretraining and human annotation for alignment, they have become commercially valuable (OpenAI, 2023). However, as their commercial value has increased, the largest models have become gated behind proprietary interfaces, with important details left undisclosed.
语言模型多年来一直是 NLP 技术的核心 (Rosenfeld, 2000; Bengio et al., 2003; Mikolov et al., 2013; Peters et al., 2018; Brown et al., 2020). 近期,由于大规模预训练与人类标注的对齐技术,语言模型已具备重要的商业价值 (OpenAI, 2023). 然而,随着商业价值的提升,规模最大的模型被限制在专有接口之后,许多关键细节未被披露.

We believe that full access to open language models for the research community is critical to the scientific study of these models, their strengths and weaknesses, and their biases and risks. Accordingly, we introduce OLMo, a powerful, truly open language model alongside open training data, training and evaluation code, intermediate model checkpoints, and training logs.
我们认为,研究社区能够完全访问开放的语言模型,对于科学理解这些模型的优势与劣势、偏见与风险至关重要. 因此,我们推出了 OLMo,一个强大的、真正开放的语言模型,同时开放了训练数据、训练与评估代码、中间模型检查点以及训练日志.

Recent LM releases have varied in their degree of openness. For example, Mixtral 8x7B provided model weights and a brief report (Jiang et al., 2024), while LLaMA came with in-depth adaptation training instructions (Touvron et al., 2023b), and Mosaic Pretrained Transformer came with many details, including the dataset distribution, though not the data itself (MosaicML NLP Team, 2023).
近期发布的语言模型在开放程度上各不相同. 例如,Mixtral 8x7B 提供了模型权重与简要报告 (Jiang et al., 2024),LLaMA 附带了深入的适配训练说明 (Touvron et al., 2023b),而 Mosaic Pretrained Transformer 则提供了包括数据集分布在内的诸多细节,但并未公开数据本身 (MosaicML NLP Team, 2023).


Falcon's pretraining data was partially released (Almazrouei et al., 2023), and the most open models—the Pythia suite (Biderman et al., 2023) and BLOOM (BigScience et al., 2022)—released training code, model checkpoints, data, and more.
Falcon 的预训练数据部分公开 (Almazrouei et al., 2023),而最为开放的模型套件 Pythia (Biderman et al., 2023) 与 BLOOM (BigScience et al., 2022) 则发布了训练代码、模型检查点、数据等更多内容.

With OLMo, we release the whole framework from data to training to evaluation tools: multiple training checkpoints across multiple hardware types, training logs, and exact datasets used, with a permissive license. We are not the only team to do this; recent work from LLM360 targets similar goals (Liu et al., 2023). OLMo narrows the gap from their models to state-of-the-art capabilities of models like Llama 2. This project has benefited from lessons learned from all of these previous efforts with their varying degrees of openness, and we believe that a large, diverse population of open models is the best hope for scientific progress on understanding language models and engineering progress on improving their utility.
通过 OLMo,我们发布了从数据到训练再到评估工具的完整框架: 跨多种硬件类型的多个训练检查点、训练日志、使用的精确数据集,均采用宽松的许可证. 并非只有我们在做这项工作; 近期 LLM360 的工作也瞄准了类似目标 (Liu et al., 2023). OLMo 缩小了这些模型与 Llama 2 等最先进模型能力之间的差距. 本项目受益于此前各种开放程度工作中的经验教训,我们相信,大量多样化的开放模型是理解语言模型的科学进步以及提升其实用性的工程进步的最佳希望.

The OLMo framework encompasses the tools and resources required for building and researching language models. For training and modeling, it includes full model weights, training code, training logs, and inference code. The released model includes four variants of our language model at the 7B scale corresponding to different architectures, optimizers, and training hardware, and one model at the 1B scale, all trained on at least 2T tokens. We also release hundreds of intermediate checkpoints available as revisions on HuggingFace. For dataset building and analysis, the full training data used for these models is openly available (Dolma; Soldaini et al., 2024), including code that produces the training data, and tools for analyzing pretraining data (Elazar et al., 2024). For evaluation, we build on Catwalk (Groeneveld et al., 2023) for downstream evaluation and Paloma (Magnusson et al., 2023) for perplexity-based evaluation. For adaptation, we use Open Instruct (Ivison et al., 2023; Wang et al., 2023) to train with instruction and feedback data. Finally, all code and weights are released under the Apache 2.0 License.1
OLMo 框架涵盖了构建与研究语言模型所需的工具与资源. 在训练与建模方面,它包括完整的模型权重、训练代码、训练日志和推理代码. 发布的模型包含四个 7B 规模的语言模型变体,分别对应不同的架构、优化器和训练硬件,以及一个 1B 规模的模型,所有模型均至少在 2T 词元上进行了训练. 我们还发布了数百个中间检查点,以 HuggingFace 修订版的形式提供. 在数据集构建与分析方面,这些模型使用的完整训练数据已公开可用 (Dolma; Soldaini et al., 2024),包括生成训练数据的代码以及分析预训练数据的工具 (Elazar et al., 2024). 在评估方面,我们基于 Catwalk (Groeneveld et al., 2023) 进行下游任务评估,基于 Paloma (Magnusson et al., 2023) 进行基于困惑度(perplexity)的评估. 在适配方面,我们使用 Open Instruct (Ivison et al., 2023; Wang et al., 2023) 利用指令与反馈数据进行训练. 最后,所有代码与权重均依据 Apache 2.0 许可证发布.

With this release, we hope to catalyze research into as-yet poorly understood aspects of these models, for example, the relationship between pretraining data and model capabilities, the impact of design and hyperparameter choices, and various optimization methods and their impact on model training. In addition, we report on the lessons learned and important details necessary to successfully train language models at this scale.
通过此次发布,我们希望推动针对这些模型尚未被充分理解方面的研究,例如预训练数据与模型能力之间的关系、设计与超参数选择的影响、以及各种优化方法对模型训练的作用. 此外,我们报告了从中获得的经验教训以及成功训练该规模语言模型所需的关键细节.

## 2 OLMo 框架

This section describes the OLMo framework, consisting of the OLMo models (Section 2.1), our pretraining dataset, Dolma (Section 2.2), and our evaluation framework (Section 2.4).
本节介绍 OLMo 框架,包括 OLMo 模型(第 2.1 节)、我们的预训练数据集 Dolma(第 2.2 节)以及评估框架(第 2.4 节).

### 2.1 OLMo 模型与架构

We adopt a decoder-only transformer architecture based on (Vaswani et al., 2017), and deliver 1B and 7B variants as described in Table 1. Our specific architecture includes several improvements over the vanilla transformer from (Vaswani et al., 2017) following other recent large language models like PaLM (Chowdhery et al., 2022), the LLaMA family (Touvron et al., 2023a,b), OpenLM (Gururangan et al., 2023), and Falcon (Almazrouei et al., 2023). See Table 5 in Appendix A for a comprehensive comparison of our 7B architecture to the similarly-sized models from these other families.
我们采用基于 Vaswani et al. (2017) 的仅解码器(decoder-only) Transformer 架构,并提供如表 1 所述的 1B 与 7B 两种规模. 我们的具体架构在 Vaswani et al. (2017) 的基础 Transformer 之上引入了一系列改进,参考了其他近期的大型语言模型,如 PaLM (Chowdhery et al., 2022)、LLaMA 系列 (Touvron et al., 2023a,b)、OpenLM (Gururangan et al., 2023) 和 Falcon (Almazrouei et al., 2023). 关于我们的 7B 架构与这些同规模模型家族的全面比较,请参见附录 A 的表 5.

We generally select hyperparameters by optimizing for training throughput on our hardware while minimizing the risk of loss spikes and slow divergence. We ablate choices through our in-loop evaluation setting, given available computational sources (Section 2.4). Our main changes over the vanilla transformer architecture can be summarized as follows:
我们通常通过优化硬件上的训练吞吐量(training throughput)来选择超参数,同时尽量减少损失尖峰(loss spikes)与缓慢发散的风险. 在可用计算资源的条件下,我们通过循环内评估(in-loop evaluation)设置对各项选择进行消融实验(第 2.4 节). 我们对基础 Transformer 架构的主要修改可总结如下:

1. No biases. Following LLaMA, PaLM, and others, we exclude all bias terms from our architecture in order to improve training stability.
1. 无偏置项. 遵循 LLaMA、PaLM 等模型,我们从架构中移除了所有偏置项,以提高训练稳定性.

2. Non-parametric layer norm. We use the non-parametric formulation of layer norm (Ba et al., 2016) in which there is no affine transformation within the norm, i.e., no "adaptive gain" (or bias). We believe this was the safest option and it was also the fastest compared to the other variants we considered: parametric layer norm and RMSNorm (Zhang and Sennrich, 2019).
2. 非参数层归一化(non-parametric layer norm). 我们使用 Ba et al. (2016) 提出的非参数层归一化形式,即在归一化内部不存在仿射变换,也就是说没有"自适应增益"(adaptive gain)或偏置. 我们认为这是最稳妥的选择,而且与我们考虑的其他变体(参数化层归一化与 RMSNorm (Zhang and Sennrich, 2019))相比,它也是最快的.

3. SwiGLU activation function. Like LLaMA, PaLM, and others we use the SwiGLU activation function (Shazeer, 2020) instead of ReLU, and following LLaMA the activation hidden size is approximately 8/3 d, but increased to the closest multiple of 128 (e.g. 11,008 for our 7B model) to improve throughput.2
3. SwiGLU 激活函数. 与 LLaMA、PaLM 等模型一样,我们使用 SwiGLU 激活函数 (Shazeer, 2020) 替代 ReLU; 遵循 LLaMA 的做法,激活隐藏层大小约为 8/3 d,但向上取整到最接近的 128 的倍数(例如我们的 7B 模型为 11,008)以提高吞吐量.

2 Since SwiGLU is a "gated" activation function, the output is half the size of the input. So technically our inputs to SwiGLU have a dimensionality of 2 x 11,008 = 22,016 for our 7B model.
2 由于 SwiGLU 是一种"门控"(gated)激活函数,其输出大小为输入的一半. 因此在技术上,对于我们的 7B 模型,SwiGLU 的输入维度为 2 x 11,008 = 22,016.



| 规模 (Size) | 层数 L | 隐藏维度 D | 注意力头数 H | 训练词元 (Tokens) | 峰值学习率 (Peak LR) | 预热 (Warmup) | 权重共享 (Weight Tying) | 批次大小 (Batch size) |
|---|---|---|---|---|---|---|---|---|
| 1B | 16 | 2048 | 16 | 2T | 4.0E-4 | 2000 steps | yes | ~4M |
| 7B | 32 | 4086 | 32 | 2.46T | 3.0E-4 | 5000 steps | no | ~4M |

Table 1: OLMo model sizes, number of training tokens, and optimizer settings. In all runs, the optimizer was AdamW, with betas of 0.9 and 0.95, and an epsilon of 1.0E-5. L is number of layers, D is hidden dimension, H is number of attention heads, WD is weight decay.
表 1: OLMo 模型规模、训练词元数量及优化器设置. 在所有运行中,优化器均为 AdamW,beta 参数为 0.9 和 0.95,epsilon 为 1.0E-5. L 为层数,D 为隐藏维度,H 为注意力头数,WD 为权重衰减(weight decay).

4. Rotary positional embeddings (RoPE). Like LLaMA, PaLM, and others we replace absolute positional embeddings with rotary positional embeddings (RoPE; Su et al., 2021).
4. 旋转位置编码(Rotary Positional Embeddings, RoPE). 与 LLaMA、PaLM 等模型一样,我们将绝对位置编码替换为旋转位置编码 (RoPE; Su et al., 2021).

5. Vocabulary. We use a modified version of the BPE-based tokenizer from GPT-NeoX-20B (Black et al., 2022) with additional tokens for masking personal identifiable information (PII). The final vocabulary size is 50,280. However, to maximize training throughput we increase the size of the corresponding embedding matrix in our model to 50,304 to be a multiple of 128.
5. 词表. 我们使用基于 GPT-NeoX-20B (Black et al., 2022) 的 BPE 分词器(tokenizer)的修改版本,增加了用于掩码个人可识别信息(personal identifiable information, PII)的额外词元. 最终词表大小为 50,280. 然而,为了最大化训练吞吐量,我们将模型中对应嵌入矩阵的大小增加到 50,304,使其成为 128 的倍数.

### 2.2 预训练数据: Dolma

Despite progress in access to model parameters, pretraining datasets are still not as open. Pretraining data are often not released alongside open models (let alone closed models) and documentation about such data is often lacking in detail that would be needed to reproduce or fully understand the work. This has made it difficult to support certain threads of language model research, such as understanding how training data impacts model capabilities and limitations. To facilitate open research on language model pretraining, we built and released our pretraining dataset, Dolma—a diverse, multi-source corpus containing trillions of tokens across billions of documents acquired from different data sources that are (1) commonly seen in large-scale language model pretraining and (2) accessible to the general public (Soldaini et al., 2024). Table 2 provides a high-level overview of the amount of data from each source.
尽管在模型参数访问方面已取得进展,预训练数据集的开放程度仍然不足. 预训练数据通常不会随开放模型一起发布(封闭模型更不必说),而且关于此类数据的文档往往缺乏复现或完全理解该工作所需的细节. 这使得某些语言模型研究难以开展,例如理解训练数据如何影响模型的能力与局限性. 为了促进语言模型预训练的开放研究,我们构建并发布了预训练数据集 Dolma——一个多样化、多来源的语料库,包含来自数十亿文档的数万亿词元,这些数据来源(1)常见于大规模语言模型预训练,且(2)对公众可获取 (Soldaini et al., 2024). 表 2 提供了各数据来源量的高层概览.

> 译者注: 数据开放是 OLMo 区别于 LLaMA、GPT 等模型的关键维度之一. Dolma 不仅发布了最终的训练语料,还开源了从原始数据到训练数据的完整处理流水线(包括语言过滤、质量过滤、内容过滤、去重、混合与分词六个阶段),以及 WIMBD 等分析工具. 这种"从矿石到钢材"的透明化对于研究数据治理、偏见来源与版权问题具有不可替代的价值.

Dolma is built using a pipeline of (1) language filtering, (2) quality filtering, (3) content filtering, (4) deduplication, (5) multi-source mixing, and (6) tokenization. We refer the reader to the Dolma report (Soldaini et al., 2024) for more details about its design principles, details about its construction, and a more detailed summary of its contents. The report provides additional analyses and experimental results from training language models on intermediate states of Dolma to share what we learned about important data curation practices, including the role of content or quality filters, deduplication, and mixing data from multiple sources. We keep documents from each source separate, both during curation as well as in the final release. We open-sourced our high-performance data curation tools; this toolkit can be used to further experiment on Dolma, reproduce our work, and enable fast and easy curation of pretraining corpora. Finally, we also open-sourced our WIMBD tool (Elazar et al., 2024) to help with dataset analysis.
Dolma 的构建使用了包含六个阶段的流水线: (1) 语言过滤,(2) 质量过滤,(3) 内容过滤,(4) 去重,(5) 多源混合,(6) 分词. 关于 Dolma 的设计原则、构建细节及其内容的更详细总结,请参阅 Dolma 报告 (Soldaini et al., 2024). 该报告还提供了在 Dolma 中间状态上训练语言模型的额外分析与实验结果,以分享我们在重要数据策展(data curation)实践中的经验,包括内容或质量过滤的作用、去重以及多源数据混合. 在策展过程中以及最终发布时,我们都将各来源的文档分开保存. 我们开源了高性能的数据策展工具; 该工具包可用于在 Dolma 上进一步实验、复现我们的工作,并实现对预训练语料的快速简便策展. 最后,我们还开源了 WIMBD 工具 (Elazar et al., 2024) 以辅助数据集分析.

| 来源 (Source) | 类型 (Type) | UTF-8 字节 (GB) | 文档数 (百万) | 词元数 (十亿) |
|---|---|---|---|---|
| Common Crawl | web pages | 9,812 | 3,734 | 2,180 |
| GitHub | code | 1,043 | 210 | 342 |
| Reddit | social media | 339 | 377 | 80 |
| Semantic Scholar | papers | 268 | 38.8 | 57 |
| Project Gutenberg | books | 20.4 | 0.056 | 5.2 |
| Wikipedia | encyclopedic | 16.2 | 6.2 | 3.7 |
| Total | | 11,519 | 4,367 | 2,668 |

Table 2: Composition of Dolma. Tokens counts are based on the GPT-NeoX tokenizer.
表 2: Dolma 的组成. 词元数基于 GPT-NeoX 分词器统计.

### 2.3 适配

Pretrained models are not always used as-is, but rather further finetuned to improve their performance, safety, and usability. Often models are first trained to follow instructions (Mishra et al., 2022; Wei et al., 2022; Sanh et al., 2022), and then further trained on human preferences (Ouyang et al., 2022) to improve the quality of their generations. We showcase the efficacy of using OLMo as a base model for further fine-tuning by training OLMo to be a general chat assistant following the TULU data and training setup (Ivison et al., 2023). This involves first performing instruction finetuning with a mixture of distilled and human-written instruction data and then further aligning the model with distilled preference data using Direct Preference Optimization (DPO) (Rafailov et al., 2023).
预训练模型并非总是直接使用,而是进一步微调以提升其性能、安全性与可用性. 通常,模型首先被训练以遵循指令 (Mishra et al., 2022; Wei et al., 2022; Sanh et al., 2022),然后基于人类偏好进一步训练 (Ouyang et al., 2022),以提升其生成质量. 我们通过将 OLMo 训练为通用对话助手来展示其作为进一步微调基座模型的有效性,遵循 TULU 数据与训练设置 (Ivison et al., 2023). 这包括首先使用蒸馏指令数据与人类编写指令数据的混合进行指令微调,然后使用直接偏好优化(Direct Preference Optimization, DPO) (Rafailov et al., 2023) 利用蒸馏偏好数据进一步对齐模型.


### 2.4 评估

We perform base model evaluation at two stages: online evaluation to make decisions for model design and offline evaluation to evaluate model checkpoints. For the offline stage, we use the Catwalk framework (Groeneveld et al., 2023), a publicly available evaluation tool with access to a wide range of datasets and task formats, to perform downstream evaluation as well as intrinsic language modeling evaluation on the perplexity benchmark Paloma (Magnusson et al., 2023). For both downstream and perplexity evaluation, we use our fixed evaluation pipeline to compare results against publicly available models. We also report a separate evaluation of our adapted model.
我们在两个阶段对基座模型进行评估: 在线评估(online evaluation)用于模型设计决策,离线评估(offline evaluation)用于评估模型检查点. 在离线阶段,我们使用 Catwalk 框架 (Groeneveld et al., 2023),这是一个公开可用的评估工具,可访问广泛的数据集与任务格式,用于执行下游任务评估以及基于困惑度基准 Paloma (Magnusson et al., 2023) 的内在语言建模评估. 对于下游任务与困惑度评估,我们都使用固定的评估流水线,以便与公开可用的模型进行比较. 我们还报告了对适配后模型的单独评估.

#### 循环内训练消融

Throughout model training, we perform downstream evaluations to make decisions around model architecture, initialization, optimizers, learning rate schedule, and data mixtures. We call this our online evaluation as it runs in-loop every 1000 training steps (or ~4B training tokens) and provides an early and continuous signal on the quality of the model being trained. These evaluations rely on many of the core tasks and experiment settings used for our offline evaluation detailed in Section 4.1, which also mirrors the task and evaluation structure of the EleutherAI eval harness (Gao et al., 2023).
在模型训练过程中,我们执行下游任务评估,以决定模型架构、初始化、优化器、学习率调度与数据混合等. 我们称之为在线评估,因为它每 1000 个训练步(约 40 亿训练词元)在循环内运行一次,为被训练模型的质量提供早期且持续的信号. 这些评估依赖许多核心任务与实验设置,这些也用于我们在第 4.1 节详述的离线评估,并反映了 EleutherAI 评估工具 (Gao et al., 2023) 的任务与评估结构.

#### 下游任务评估

Following much previous work (Brown et al., 2020; Black et al., 2022; Touvron et al., 2023a,b, inter alia), we report zero-shot performance on a set of downstream tasks. Our evaluation suite consists of 8 core tasks corresponding closely to the commonsense reasoning task set reported by Touvron et al. (2023a) and Touvron et al. (2023b) (see Table 3 for a list of tasks). Given the scale of the models being evaluated, such tasks were selected at the beginning of model development due to their naturalness (e.g., all can formulated as text completion scoring tasks) and ability to provide meaningful signals throughout training (see Figure 1).
遵循大量先前工作 (Brown et al., 2020; Black et al., 2022; Touvron et al., 2023a,b 等),我们报告了一组下游任务的零样本(zero-shot)性能. 我们的评估套件由 8 个核心任务组成,与 Touvron et al. (2023a) 和 Touvron et al. (2023b) 报告的常识推理任务集高度对应(任务列表见表 3). 鉴于被评估模型的规模,这些任务在模型开发初期就被选中,因为它们具有天然性(例如,所有任务均可形式化为文本补全评分任务),并且能够在整个训练过程中提供有意义的信号(见图 1).

#### 内在语言建模评估

To measure how OLMo fits distributions of language beyond held-out training data, we use Paloma (Magnusson et al., 2023), a new perplexity benchmark that includes 585 different domains of text. Domains range from nytimes.com to r/depression on Reddit and are drawn from 18 separate data sources, such as C4 (Raffel et al., 2020), in stratified samples. This allows for more equal inclusion of text domains that are under-represented in their source corpora.
为了衡量 OLMo 对超出预留训练数据的语言分布的拟合程度,我们使用 Paloma (Magnusson et al., 2023),这是一个新的困惑度基准,涵盖 585 个不同的文本领域. 领域范围从 nytimes.com 到 Reddit 上的 r/depression,来自 18 个独立的数据源,如 C4 (Raffel et al., 2020),采用分层抽样. 这使得那些在源语料库中代表性不足的文本领域能够得到更平等的纳入.

We aim not just to compare OLMo against other models for best performance, but also to demonstrate how it enables fuller and more controlled scientific evaluations. OLMo-7B is the largest LM with explicit decontamination for perplexity evaluation. Following the approach described in Paloma, we remove any pretraining document with paragraphs leaked from Paloma evaluation data. Without decontamination, other models risk underestimating perplexity (i.e., overestimating the model's out-of-sample fit). We also release intermediate checkpoints, allowing richer comparisons with two other models that release checkpoints, Pythia-6.9B (Biderman et al., 2023) and RPJ-INCITE-7B (Together Computer, 2023) (see Figure 2).
我们的目标不仅是将 OLMo 与其他模型进行最佳性能比较,还要展示它如何实现更完整、更受控制的科学评估. OLMo-7B 是针对困惑度评估显式去污染(decontamination)的最大规模语言模型. 遵循 Paloma 中描述的方法,我们移除了任何包含从 Paloma 评估数据泄露段落的预训练文档. 如果没有去污染,其他模型可能低估困惑度(即高估模型的样本外拟合能力). 我们还发布了中间检查点,从而可以与另外两个发布检查点的模型——Pythia-6.9B (Biderman et al., 2023) 和 RPJ-INCITE-7B (Together Computer, 2023)——进行更丰富的比较(见图 2).

> 译者注: 评估中的去污染(decontamination)是确保语言模型评估公平性的关键步骤. 如果预训练数据混入了下游评测集的文本,模型会通过记忆而非泛化获得高分,导致对真实能力的系统性高估. OLMo 在 Paloma 上的显式去污染使其困惑度评估更具可信度,这也是开放数据带来的独特优势——研究者可以精确核查训练数据与评测数据的重叠.

#### 适配评估

We also evaluate OLMo after instruction fine-tuning and DPO training using the TULU evaluation suite proposed in Wang et al. (2023); Ivison et al. (2023). We focus on evaluations around model chat capabilities and safety in order to showcase the efficacy of using OLMo as a base for further fine-tuning.
我们还使用 Wang et al. (2023); Ivison et al. (2023) 提出的 TULU 评估套件,对指令微调与 DPO 训练后的 OLMo 进行评估. 我们聚焦于模型的对话能力与安全性评估,以展示将 OLMo 用作进一步微调基座模型的有效性.

## 3 训练 OLMo

This section describes our pretraining setup, including our distributed training framework (Section 3.1), optimizer (Section 3.2), data preparation (Section 3.3), and hardware (Section 3.4).
本节描述我们的预训练设置,包括分布式训练框架(第 3.1 节)、优化器(第 3.2 节)、数据准备(第 3.3 节)以及硬件(第 3.4 节).

### 3.1 分布式训练框架

We train our models using the ZeRO optimizer strategy (Rajbhandari et al., 2019) via PyTorch's FSDP framework (Zhao et al., 2023), which reduces memory consumption by sharding the model weights and their corresponding optimizer state across GPUs. At the 7B scale, this enables training with a micro-batch size of 4096 tokens per GPU on our hardware (see Section 3.4). For OLMo-1B and -7B models, we use a constant global batch size of approximately 4M tokens (2048 instances, each with a sequence length of 2048 tokens).
我们使用 ZeRO 优化器策略 (Rajbhandari et al., 2019) 通过 PyTorch 的 FSDP 框架 (Zhao et al., 2023) 训练模型,该策略通过将模型权重及其对应的优化器状态分片(sharding)到各个 GPU 上来降低显存消耗. 在 7B 规模下,这使得在我们的硬件上每个 GPU 可以使用 4096 词元的微批次大小(micro-batch size)进行训练(见第 3.4 节). 对于 OLMo-1B 和 OLMo-7B 模型,我们使用恒定的全局批次大小(global batch size),约为 400 万词元(2048 个实例,每个实例的序列长度为 2048 词元).

To improve throughput, we employ mixed-precision training (Micikevicius et al., 2017) through FSDP's built-in settings and PyTorch's amp module. The latter ensures that certain operations like the softmax always run in full precision to improve stability, while all other operations run in half-precision with the bfloat16 format. Under our specific settings, the sharded model weights and optimizer state local to each GPU are kept in full precision. The weights within each transformer block are only cast to bfloat16 when the full-sized parameters are materialized on each GPU during the forward and backward passes. Gradients are reduced across GPUs in full precision.
为了提高吞吐量,我们通过 FSDP 内置设置与 PyTorch 的 amp 模块采用混合精度训练(mixed-precision training) (Micikevicius et al., 2017). 后者确保某些操作(如 softmax)始终以全精度运行以提高稳定性,而所有其他操作则以 bfloat16 格式的半精度运行. 在我们的具体设置下,分片的模型权重与每个 GPU 本地的优化器状态均保持全精度. 仅在每个 Transformer 块的前向与反向传播过程中,完整大小的参数在每个 GPU 物化时,权重才会被转换为 bfloat16. 梯度以全精度在各个 GPU 之间规约(reduced).


### 3.2 优化器

We use the AdamW optimizer (Loshchilov and Hutter, 2019) with the hyperparameters shown in Table 1. For all model sizes, we warm up the learning rate over 5000 steps (~21B tokens) and then decay it linearly from there down to a tenth of the peak learning rate over the remainder of training. After the warm-up period, we clip gradients such that the total l2-norm of the parameter gradients3 does not exceed 1.0. Table 5 gives a comparison of our optimizer settings at the 7B scale to those of other recent LMs that also used AdamW.
我们使用 AdamW 优化器 (Loshchilov and Hutter, 2019),超参数如表 1 所示. 对于所有模型规模,我们在 5000 步(约 210 亿词元)内对学习率进行预热,然后在其后的训练过程中将其线性衰减至峰值学习率的十分之一. 预热期结束后,我们对梯度进行裁剪,使得参数梯度的总 l2-范数不超过 1.0. 表 5 将我们在 7B 规模上的优化器设置与其他近期同样使用 AdamW 的语言模型进行了比较.

3 在梯度裁剪过程中,模型的所有参数被视为一个大的向量(如同所有参数被展平并拼接在一起),我们对对应的单一梯度向量取 l2-范数. 这是 PyTorch 中梯度裁剪的标准做法.

### 3.3 数据

We built our training dataset out of a 2T-token sample from our open dataset, Dolma (Soldaini et al., 2024), which we describe in Section 2.2. The tokens from every document are concatenated together after appending a special EOS token to the end of each document, and then we group consecutive chunks of 2048 tokens to form training instances. The training instances are shuffled in the exact same way for each training run. The data order and exact composition of each training batch can be reconstructed from the artifacts we release. All of our released models have been trained to at least 2T tokens (a single epoch over our training data), and some have been trained beyond that by starting a second epoch over the data with a different shuffling order. The impact of repeating this small amount of data should be negligible according to prior work (Muennighoff et al., 2023).
我们从开放数据集 Dolma (Soldaini et al., 2024) 中抽取了 2T 词元的样本构建训练数据集,Dolma 在第 2.2 节中有描述. 每个文档的词元在末尾附加一个特殊的 EOS 词元后被拼接在一起,然后我们将连续的 2048 词元分组以形成训练实例. 每次训练运行时,训练实例都以完全相同的方式被打乱. 数据顺序与每个训练批次的精确组成都可以从我们发布的产物中重建. 我们发布的所有模型都至少训练到了 2T 词元(对训练数据的一个完整轮次),有些模型还通过以不同的打乱顺序开始第二轮训练而训练了更长时间. 根据先前工作 (Muennighoff et al., 2023),重复这一少量数据的影响应该是可忽略的.

### 3.4 硬件

In order to verify that our codebase could be used on both NVIDIA and AMD GPUs without any loss in performance, we trained models on two different clusters:
为了验证我们的代码库可以在 NVIDIA 和 AMD GPU 上使用而不会造成任何性能损失,我们在两个不同的集群上训练了模型:

- LUMI: Provided by the LUMI supercomputer,4 we used up to 256 nodes on this cluster, where each node consists of 4x AMD MI250X GPUs with 128GB of memory5 and 800Gbps of interconnect.
- LUMI: 由 LUMI 超级计算机提供,我们在该集群上使用了最多 256 个节点,每个节点由 4 块 AMD MI250X GPU 组成,显存为 128GB,互联带宽为 800Gbps.

- MosaicML: Provided by MosaicML6 (Databricks), we used 27 nodes on this cluster, where each node consists of 8x NVIDIA A100 GPUs with 40GB of memory and 800Gbps interconnect.
- MosaicML: 由 MosaicML (Databricks) 提供,我们在该集群上使用了 27 个节点,每个节点由 8 块 NVIDIA A100 GPU 组成,显存为 40GB,互联带宽为 800Gbps.

Despite minor differences in batch size to optimize for training throughput, both runs resulted in nearly identical performance on our evaluation suite by 2T tokens.
尽管批次大小存在细微差异以优化训练吞吐量,但两次运行在 2T 词元时于我们的评估套件上取得了几乎相同的性能.

> 译者注: 跨硬件(NVIDIA A100 与 AMD MI250X)的可复现性是 OLMo 工程实践中的亮点. 这不仅验证了代码的可移植性,也为学术界在不同算力基础设施上复现结果提供了信心. 结合完全固定的数据顺序与可重建的训练批次,OLMo 在"可复现训练"方面树立了标杆.


## 4 结果

The checkpoint used for evaluating OLMo-7B is trained until 2.46T tokens on the Dolma (Soldaini et al., 2024) dataset with a linear learning rate decay schedule mentioned in Section 3.2. In our experiments, we find that tuning this checkpoint further on the Dolma dataset for 1000 steps with the learning rate linearly decayed to 0 boosts model performance on perplexity and end-task evaluation suites described in Section 2.4. We compare OLMo with other publicly available models including LLaMA-7B (Touvron et al., 2023a), Llama-2-7B (Touvron et al., 2023b), MPT-7B (MosaicML NLP Team, 2023), Pythia-6.9B (Biderman et al., 2023), Falcon-7B (Almazrouei et al., 2023) and RPJ-INCITE-7B (Together Computer, 2023).
用于评估 OLMo-7B 的检查点训练至 Dolma 数据集 (Soldaini et al., 2024) 上的 2.46T 词元,使用第 3.2 节提及的线性学习率衰减调度. 在实验中,我们发现进一步在 Dolma 数据集上对该检查点微调 1000 步,并将学习率线性衰减至 0,可以提升模型在第 2.4 节描述的困惑度与末端任务评估套件上的性能. 我们将 OLMo 与其他公开可用的模型进行比较,包括 LLaMA-7B (Touvron et al., 2023a)、Llama-2-7B (Touvron et al., 2023b)、MPT-7B (MosaicML NLP Team, 2023)、Pythia-6.9B (Biderman et al., 2023)、Falcon-7B (Almazrouei et al., 2023) 和 RPJ-INCITE-7B (Together Computer, 2023).

### 4.1 下游任务评估

#### 设置

Our core downstream evaluation suite (see Table 3) consists of: arc (both arc_easy and arc_challenge) (Clark et al., 2018), boolq (Clark et al., 2019), openbookqa (Mihaylov et al., 2018), sciq (Welbl et al., 2017), hellaswag (Zellers et al., 2019), piqa (Bisk et al., 2020), and winogrande (Sakaguchi et al., 2021). In Appendix C, we also report results on an additional set of auxiliary tasks outside of our core evaluation set that we found to have less stable performance trends (see Figure 4).
我们的核心下游任务评估套件(见表 3)包括: arc (含 arc_easy 与 arc_challenge) (Clark et al., 2018)、boolq (Clark et al., 2019)、openbookqa (Mihaylov et al., 2018)、sciq (Welbl et al., 2017)、hellaswag (Zellers et al., 2019)、piqa (Bisk et al., 2020) 和 winogrande (Sakaguchi et al., 2021). 在附录 C 中,我们还报告了核心评估集之外的一组辅助任务的评估结果,我们发现这些任务的性能趋势较不稳定(见图 4).

5 The MI250X is a dual-chip module, meaning in practice that each physical device consists of two logical devices, so each node has 8 logical GPU devices with 64GB of memory each.

5 MI250X 是双芯片模块,意味着在实践中每个物理设备由两个逻辑设备组成,因此每个节点有 8 个逻辑 GPU 设备,每个设备显存为 64GB.

In all cases, we perform zero-shot evaluation using the rank classification approach popularized by Brown et al. (2020). Under this approach, candidate text completions (e.g., different multiple-choice options) are ranked by likelihood (usually normalized by some normalization factor), and prediction accuracy is reported. While Catwalk implements several common likelihood normalization strategies, including normalizing by number of tokens (per-token normalization; Brown et al., 2020; Liang et al., 2022), by number of characters (per-character normalization; Gao et al., 2023), as well as incorporating an answer's unconditional likelihood (Brown et al., 2020), we selected the normalization strategies for each dataset separately. Specifically, we used unconditional normalization for arc and openbookqa, per-token normalization for hellaswag, piqa, and winogrande and no normalization for boolq, and sciq (i.e., tasks formulated as single token prediction tasks).
在所有情况下,我们使用 Brown et al. (2020) 推广的排序分类(rank classification)方法进行零样本评估. 在这种方法下,候选文本补全(例如不同的多选选项)按似然度排序(通常经过某种归一化因子归一化),并报告预测准确率. 虽然 Catwalk 实现了多种常见的似然度归一化策略,包括按词元数归一化(每词元归一化; Brown et al., 2020; Liang et al., 2022)、按字符数归一化(每字符归一化; Gao et al., 2023),以及引入答案的无条件似然度 (Brown et al., 2020),但我们为每个数据集单独选择了归一化策略. 具体而言,我们对 arc 和 openbookqa 使用无条件归一化,对 hellaswag、piqa 和 winogrande 使用每词元归一化,对 boolq 和 sciq 不使用归一化(即形式化为单词元预测任务的任务).

#### 结果

Table 3 summarizes the result of zero-shot evaluation of OLMo and compares against other publicly available models of comparable size. We report results on 8 core tasks from our evaluation suite described in Section 2.4. On aggregate, OLMo-7B is competitive against all the comparable models. We include the comparison to StableLM 1.6B, but note that it is significantly larger, and was trained on unknown data.
表 3 总结了 OLMo 的零样本评估结果,并与同规模的其他公开可用模型进行了比较. 我们报告了第 2.4 节描述的评估套件中 8 个核心任务的结果. 总体而言,OLMo-7B 在所有可比模型中均具有竞争力. 我们也包含了与 StableLM 1.6B 的比较,但需注意其规模明显更大,且训练数据未知.

In Figure 1 we plot the accuracy score progression of 8 core end-tasks. All tasks, except OBQA, show an upward trend in accuracy numbers as OLMo-7B is trained on more tokens. A sharp upward tick in accuracy of many tasks between the last and the second to last step shows us the benefit of linearly reducing the LR to 0 over the final 1000 training steps. See Table 7 in Appendix C for additional evaluation results and discussion.
在图 1 中,我们绘制了 8 个核心末端任务的准确率得分变化. 除 OBQA 外,所有任务随着 OLMo-7B 训练词元的增加均呈现上升趋势. 许多任务在最后一步与倒数第二步之间出现的准确率急剧上升,表明了在最终 1000 个训练步中将学习率线性降至 0 的益处. 关于额外的评估结果与讨论,请参见附录 C 的表 7.


| 模型 (Models) | arc challenge | arc easy | boolq | hellaswag | openbookqa | piqa | sciq | winogrande | 平均 (avg.) |
|---|---|---|---|---|---|---|---|---|---|
| StableLM 1.6B | 43.8 | 63.7 | 76.6 | 68.2 | 45.8 | 74.0 | 94.7 | 64.9 | 66.5 |
| Pythia 1B | 33.1 | 50.2 | 61.8 | 44.7 | 37.8 | 69.1 | 86.0 | 53.3 | 54.5 |
| TinyLlama 1.1B | 34.8 | 53.2 | 64.6 | 58.7 | 43.6 | 71.1 | 90.5 | 58.9 | 59.4 |
| OLMo-1B | 34.5 | 58.1 | 60.7 | 62.5 | 46.4 | 73.7 | 88.1 | 58.9 | 60.4 |
| Falcon-7B | 47.5 | 70.4 | 74.6 | 75.9 | 53.0 | 78.5 | 93.9 | 68.9 | 70.3 |
| LLaMA 7B | 44.5 | 67.9 | 75.4 | 76.2 | 51.2 | 77.2 | 93.9 | 70.5 | 69.6 |
| Llama 2 7B | 48.5 | 69.5 | 80.2 | 76.8 | 48.4 | 76.7 | 94.5 | 69.4 | 70.5 |
| MPT-7B | 46.5 | 70.5 | 74.2 | 77.6 | 48.6 | 77.3 | 93.7 | 69.9 | 69.8 |
| Pythia 6.9B | 44.1 | 61.9 | 61.1 | 63.8 | 45.0 | 75.1 | 91.1 | 62.0 | 63.0 |
| RPJ-INCITE-7B | 42.8 | 68.4 | 68.6 | 70.3 | 49.4 | 76.0 | 92.9 | 64.7 | 66.6 |
| OLMo-7B | 48.5 | 65.4 | 73.4 | 76.4 | 50.4 | 78.4 | 93.8 | 67.9 | 69.3 |

Table 3: Zero-shot evaluation of OLMo-1B and OLMo-7B, with other publicly available comparable model checkpoints on 8 core tasks from the downstream evaluation suite described in Section 2.4. For OLMo-7B, we report results for the 2.46T token checkpoint.
表 3: OLMo-1B 和 OLMo-7B 的零样本评估,以及第 2.4 节描述的下游评估套件中 8 个核心任务上其他公开可用可比模型检查点的结果. 对于 OLMo-7B,我们报告的是 2.46T 词元检查点的结果.

### 4.2 内在语言建模评估

#### 设置

For intrinsic evaluations, Paloma proposes a range of analyses, from inspection of performance in each domain separately to more summarized results over combinations of domains. We report results at two levels of granularity: the aggregate performance over 11 of the 18 sources in Paloma as in (Magnusson et al., 2023), as well as more fine-grained results over each of these sources individually. This particular subset of 11 sources from Paloma excludes sources that are not publicly available, involve fringe or toxic text, or consist of code data not supported by Paloma's decontamination approach. This leaves C4 (Raffel et al., 2020), mC4-en (Chung et al., 2023), Wikitext 103 (Merity et al., 2016), Penn Treebank (Marcus et al., 1999; Nunes, 2020), RedPajama (Together Computer, 2023), Falcon-RefinedWeb (Penedo et al., 2023), Dolma (Soldaini et al., 2024), M2D2 S2ORC (Reid et al., 2022), M2D2 Wikipedia (Reid et al., 2022), C4 100 domains (Chronopoulou et al., 2022), and Dolma 100 Subreddits (Soldaini et al., 2024). To allow for a fair comparison between models with different vocabularies, we report bits per byte as defined by Gao et al. (2020) over the test sets of these sources.
对于内在评估,Paloma 提出了一系列分析,从单独检查每个领域的性能到对多个领域组合的更汇总的结果. 我们在两个粒度级别上报告结果: 对 Paloma 中 18 个来源里 11 个来源的聚合性能,如同 (Magnusson et al., 2023) 中所做的; 以及对这些来源中每个来源的更细粒度结果. Paloma 的这 11 个来源子集排除了不公开可用的来源、涉及边缘或有毒文本的来源,或包含 Paloma 去污染方法不支持的代码数据的来源. 剩余的来源包括 C4 (Raffel et al., 2020)、mC4-en (Chung et al., 2023)、Wikitext 103 (Merity et al., 2016)、Penn Treebank (Marcus et al., 1999; Nunes, 2020)、RedPajama (Together Computer, 2023)、Falcon-RefinedWeb (Penedo et al., 2023)、Dolma (Soldaini et al., 2024)、M2D2 S2ORC (Reid et al., 2022)、M2D2 Wikipedia (Reid et al., 2022)、C4 100 domains (Chronopoulou et al., 2022) 和 Dolma 100 Subreddits (Soldaini et al., 2024). 为了在不同词表的模型之间进行公平比较,我们报告了这些来源测试集上由 Gao et al. (2020) 定义的每字节比特数(bits per byte).



#### 结果

In the Sources Combined subplot of Figure 2, we show the performance of OLMo-7B against 6 comparably-sized language models on the combination of 11 data sources from Paloma. Overall we find OLMo to have a competitive fit, especially given its training data was explicitly decontaminated against Paloma. As seen through the comparison of final models (see shapes) as well intermediate checkpoints (see dashed lines), the OLMo results follow similar scaling trends of other models. Note that the performance of intermediate checkpoints is influenced by where that checkpoint occurs in the learning rate schedule. So models trained for fewer steps will tend to have steeper training curves without necessarily being more sample efficient if training duration were fixed across all models. MPT-7B, nevertheless, stands out as improving ahead of the other models in this subplot. This could be due to a number of factors, including pretraining data composition and its match to the domains in Paloma (e.g., MPT trains on 27% non-Common Crawl data rather than 18% for LLaMA, 12.2% for RedPajama, and 11.2% for OLMo) as well as various data preprocessing decisions (e.g., MPT's use of semantic deduplication by Abbas et al., 2023, on C4).
在图 2 的"来源组合"(Sources Combined)子图中,我们展示了 OLMo-7B 与其他 6 个同规模语言模型在 Paloma 11 个数据来源组合上的性能. 总体而言,我们发现 OLMo 具有竞争力的拟合表现,尤其是考虑到其训练数据针对 Paloma 进行了显式去污染. 通过最终模型(见形状标记)与中间检查点(见虚线)的比较可以看出,OLMo 的结果遵循与其他模型类似的扩展趋势. 需要注意的是,中间检查点的性能受其出现在学习率调度中位置的影响. 因此,训练步数较少的模型往往具有更陡峭的训练曲线,但如果所有模型的训练时长固定,这并不一定意味着它们更具样本效率. 尽管如此,MPT-7B 在此子图中脱颖而出,优于其他模型. 这可能归因于多种因素,包括预训练数据的组成及其与 Paloma 领域的匹配程度(例如,MPT 在 27% 的非 Common Crawl 数据上训练,而 LLaMA 为 18%、RedPajama 为 12.2%、OLMo 为 11.2%),以及各种数据预处理决策(例如 MPT 在 C4 上使用 Abbas et al., 2023 的语义去重).

The remaining subplots in Figure 2 provide more fine-grained analysis by reporting bits per byte separately for each of the 11 data sources that are combined in the aggregated Paloma metric. From this we see greater variation in sample efficiency, largely driven by the similarity of training and evaluation distributions. Notably, OLMo-7B fares well on evaluations predominated by Common Crawl, such as C4, though different ways of postprocessing Common Crawl are best fit by models trained with that specific data, such as Falcon-7B on Falcon RefinedWeb. Meanwhile, OLMo-7B is less sample efficient compared to other models on sources less related to scraped web text, such as WikiText-103, M2D2 S2ORC, and M2D2 Wikipedia. The RedPajama evaluation shows a similar pattern, perhaps as only 2 of its 7 domains are from Common Crawl, and Paloma weights domains within each source equally. Since heterogeneous data from curated sources like Wikipedia and ArXiv papers is scarcer than scraped web text, maintaining sample efficiency for fit to these distributions of language will be challenging as pretraining corpora are scaled.
图 2 中剩余的子图通过分别报告聚合 Paloma 指标中所组合的 11 个数据来源各自的每字节比特数,提供了更细粒度的分析. 从中我们可以看到样本效率存在较大差异,这主要由训练分布与评估分布的相似性驱动. 值得注意的是,OLMo-7B 在以 Common Crawl 为主的评估上表现良好,例如 C4,尽管不同的 Common Crawl 后处理方式最适合使用相应特定数据训练的模型,例如 Falcon-7B 在 Falcon RefinedWeb 上. 与此同时,OLMo-7B 在与抓取网页文本关联较小的来源上,与其他模型相比样本效率较低,例如 WikiText-103、M2D2 S2ORC 和 M2D2 Wikipedia. RedPajama 评估也显示出类似模式,可能因为其 7 个领域中仅有 2 个来自 Common Crawl,且 Paloma 对每个来源内的领域赋予相等权重. 由于来自 Wikipedia 和 ArXiv 论文等策展来源的异构数据比抓取的网页文本更稀缺,随着预训练语料规模的扩大,保持对这些语言分布拟合的样本效率将是一项挑战.

### 4.3 适配评估

#### 设置

We evaluate OLMo-7B before adaptation, and after both the supervised fine-tuning and DPO training stage, focusing on the safety and chat evaluations used by Wang et al. (2023). We additionally compare to officially released instruction-tuned variants of the models from Table 3. We finally also compare to TULU 2 models to compare against models trained using the same post-training data mixes and procedures.
我们在适配前,以及在监督微调(supervised fine-tuning, SFT)和 DPO 训练阶段后,对 OLMo-7B 进行评估,聚焦于 Wang et al. (2023) 使用的安全性与对话评估. 此外,我们还与表 3 中模型的官方发布的指令微调变体进行比较. 最后,我们还与 TULU 2 模型进行比较,以对比使用相同训练后数据混合与流程训练的模型.

7 遵循 Ivison et al. (2023),由于测试集污染,我们不报告 TULU 2 的 TruthfulQA 分数.

| 模型 (Model) | MMLU 0-shot | AlpacaEval %win | ToxiGen % Toxic | TruthfulQA %Info+True |
|---|---|---|---|---|
| OLMo (base) | 28.3 | - | 81.4 | 31.6 |
| MPT Chat | 33.8 | 46.8 | 0.1 | 42.7 |
| Falcon Instruct | 25.2 | 14.0 | 70.7 | 27.2 |
| RPJ-INCITE Chat | 27.0 | 38.0 | 46.4 | 53.0 |
| Llama-2-Chat | 46.8 | 87.3 | 0.0 | 26.3 |
| TULU 2 | 50.4 | 73.9 | 7.0 | 51.7 |
| TULU 2+DPO | 50.7 | 85.1 | 0.5 | - |
| OLMo+SFT | 47.3 | 57.0 | 14.4 | 41.2 |
| OLMo+SFT+DPO | 46.2 | 69.3 | 1.7 | 52.0 |

Table 4: Evaluation of various instruction-tuned 7B models, including OLMo-7B and before and after adaptation training. Lower is better for ToxiGen and higher is better for other metrics. We provide a detailed description of models and metrics in Appendix. E.
表 4: 各种指令微调的 7B 模型评估,包括 OLMo-7B 以及适配训练前后的表现. ToxiGen 越低越好,其他指标越高越好. 我们在附录 E 中提供了模型与指标的详细描述.

#### 结果

We find that instruction tuning considerably improves the performance and safety of OLMo-7B, increasing MMLU performance by a wide margin and improving ToxiGen and TruthfulQA scores - especially after DPO training. Additionally, we find that OLMo-7B outperforms most other chat variants after both initial instruction tuning (OLMo+SFT) and additional preference alignment (OLMo+SFT+DPO), highlighting both the strength of OLMo-7B as a base model and the strength of the TULU mix used to perform adaptation training. However, we find there is still a gap with TULU 2, which is trained by applying the TULU mix on Llama 2. This gap may be due to test set contamination in Llama 28 and because the TULU mix was primarily designed for Llama models. Overall, we see that OLMo-7B greatly benefits from additional tuning and serves as a strong base model for downstream applications.
我们发现指令微调显著提升了 OLMo-7B 的性能与安全性,大幅提高了 MMLU 性能,并改善了 ToxiGen 和 TruthfulQA 分数——尤其是在 DPO 训练之后. 此外,我们发现 OLMo-7B 在初始指令微调(OLMo+SFT)和额外的偏好对齐(OLMo+SFT+DPO)之后,性能优于大多数其他对话变体,这既突显了 OLMo-7B 作为基座模型的实力,也突显了用于适配训练的 TULU 数据混合的实力. 然而,我们发现与 TULU 2 仍存在差距,TULU 2 是将 TULU 数据混合应用于 Llama 2 训练得到的. 这一差距可能源于 Llama 2 的测试集污染,也因为 TULU 数据混合主要是为 Llama 模型设计的. 总体而言,我们看到 OLMo-7B 从额外调优中受益匪浅,并作为下游应用的强大基座模型.

8 Touvron et al. (2023b) 报告 Llama 2 的预训练数据受到了 MMLU 测试数据的污染.


## 5 发布的产物

By sharing artifacts from all pipeline stages, we aim to encourage open research and reduce duplicated, often costly efforts, by academics and practitioners. We release the following:
通过分享流水线所有阶段的产物,我们旨在鼓励开放研究,并减少学术界与从业者重复的、往往代价高昂的工作. 我们发布了以下内容:

Pretraining (Section 2.1)
预训练(第 2.1 节)

1. The training and modeling code.
1. 训练与建模代码.

2. The trained model weights for the 7B model, 7B-twin-2T, and the 1B model. For all the models, we release not only the final model weights but also 500+ intermediate checkpoints at intervals of 1000 steps.
2. 7B 模型、7B-twin-2T 和 1B 模型的训练权重. 对于所有模型,我们不仅发布了最终模型权重,还发布了 500 多个中间检查点,间隔为 1000 步.

3. The complete set of metrics logged to Weights & Biases during training.
3. 训练期间记录到 Weights & Biases 的完整指标集.

Data (Section 2.2)
数据(第 2.2 节)

1. Our full pretraining corpus Dolma (Soldaini et al., 2024).
1. 我们的完整预训练语料 Dolma (Soldaini et al., 2024).

2. Tools to support reproduction of full training data order as well as inspection of which training data was seen at each step during training.
2. 支持复现完整训练数据顺序的工具,以及检查训练过程中每一步看到了哪些训练数据的工具.

3. Tools for recreating our training data (Soldaini et al., 2024) and performing dataset analysis (Elazar et al., 2024).
3. 用于重建训练数据 (Soldaini et al., 2024) 和执行数据集分析 (Elazar et al., 2024) 的工具.

Adaptation (Section 2.3)
适配(第 2.3 节)

1. The training code and data for adaptation.
1. 适配的训练代码与数据.

2. The model weights for OLMo+SFT and OLMo+SFT+DPO.
2. OLMo+SFT 与 OLMo+SFT+DPO 的模型权重.

Evaluation (Section 2.4)
评估(第 2.4 节)

1. The code and data in our evaluation framework Catwalk (Groeneveld et al., 2023) for offline evaluation on both downstream tasks and intrinsic language modeling (Magnusson et al., 2023).
1. 评估框架 Catwalk (Groeneveld et al., 2023) 中的代码与数据,用于下游任务和内在语言建模 (Magnusson et al., 2023) 的离线评估.

2. The evaluation suite (Wang et al., 2023; Ivison et al., 2023) for adapted models.
2. 用于适配模型的评估套件 (Wang et al., 2023; Ivison et al., 2023).

> 译者注: 第 5 节列出的开放产物清单几乎涵盖了训练一个现代大语言模型所需的全部要素: 从原始数据、数据处理工具、训练代码、完整日志、中间检查点到微调与评估代码. 这种"全栈开放"(full-stack openness)使 OLMo 成为当时最透明的 7B 规模模型之一,为研究训练动态、涌现能力、数据影响等问题提供了独一无二的素材.


## 6 结论与未来工作

This paper presents our first release of OLMo, a state-of-the-art, truly open language model and its framework to build and study the science of language modeling. Unlike most prior efforts that have only released model weights and inference code, we release OLMo and the whole framework, including training data, training and evaluation code, and detailed metrics collected during the training runs. Additionally, we released adapted models, as well as all of our model adaptation code and data.
本文介绍了 OLMo 的首次发布,一个最先进的、真正开放的语言模型及其构建与研究语言建模科学的框架. 与此前大多数仅发布模型权重与推理代码的工作不同,我们发布了 OLMo 及整个框架,包括训练数据、训练与评估代码,以及训练过程中收集的详细指标. 此外,我们还发布了适配后的模型,以及所有模型适配代码与数据.

We intend to continuously support and extend OLMo and its framework, and continue to push the boundaries of open LMs to empower the open research community. Since the original release of OLMo described here, we improved our data and training setup to significantly improve results. For example, MMLU scores have improved by 24 points to 52%.9 We look forward to bringing different model sizes, modalities, datasets, safety measures, and evaluations into the OLMo family. We hope this and future releases will empower and strengthen the open research community and inspire a new wave of innovation.
我们打算持续支持并扩展 OLMo 及其框架,继续推动开放语言模型的边界,以赋能开放研究社区. 自本文描述的 OLMo 原始发布以来,我们改进了数据与训练设置,显著提升了结果. 例如,MMLU 分数提高了 24 分,达到 52%. 我们期待将不同的模型规模、模态、数据集、安全措施与评估方法纳入 OLMo 家族. 我们希望此次及未来的发布能够赋能并壮大开放研究社区,激发新一轮创新.


### 局限性

We recognize building a large language model has many limitations. In fact, each step of the process of creating a language model, from the data to training to adaptation to evaluation each have their own limitations, and so we've added sections for each below. Of course we recognize that AI systems today can have broad societal reach, and therefore there are significant limitations beyond what we are able to fit into this section.
我们认识到构建大型语言模型存在诸多局限性. 事实上,创建语言模型的每一步——从数据到训练、再到适配与评估——都有其自身的局限性,因此我们在下面为每一步都添加了专门的小节. 当然,我们也认识到当今 AI 系统可能具有广泛的社会影响,因此存在大量本节无法涵盖的重要局限性.

### 数据

Our work focuses on pretraining data in English. We hope that our open framework enables the development of future models in more languages as well as multilingual models. The data that models are trained on is what gives models their capabilities, and at the scale of training a large language model we recognize that the data likely contains problematic content like toxic language, personal information, and copyrighted text. We mitigated this to the best of our ability but recognize there are no perfect approaches today that can completely remove such content.
我们的工作聚焦于英语的预训练数据. 我们希望我们的开放框架能够促进未来更多语言以及多语言模型的发展. 模型训练所用的数据赋予了模型能力,而在训练大型语言模型的规模下,我们认识到数据可能包含有问题的内容,如有毒语言、个人信息和受版权保护的文本. 我们已尽最大努力缓解这些问题,但也认识到目前没有任何完美方法可以完全移除此类内容.

### 训练

Training a large language model is currently a challenging endeavor which is missing significant support from the open source community. With our limited page count we did not provide extensive training logs documenting, for example, training runs that diverged or failed to learn.
训练大型语言模型目前是一项具有挑战性的工作,而开源社区在这方面提供的支持仍然有限. 由于页面数量有限,我们未能提供详尽的训练日志,例如记录发散或未能成功学习的训练运行.

### 适配

Our pretrained models face the same issues as existing pretrained LLMs, such as bias, toxicity and, hallucinations. Our adapted models are better at avoiding these generations, but they are not perfect. Additionally, we note that we largely adopt an existing data mixture designed for a different model family (TULU, designed for Llama models), and OLMo may require different data mixing to adjust for its unique strengths and weaknesses. The TULU mix itself also relies on data distilled from a variety of models, and we hope to reduce our reliance on such data in the future.
我们的预训练模型面临着与现有预训练大语言模型相同的问题,如偏见、毒性和幻觉. 我们的适配模型在避免此类生成方面表现更好,但并非完美. 此外,我们注意到我们 largely 采用了一个为不同模型家族设计的现有数据混合(TULU,为 Llama 模型设计),OLMo 可能需要不同的数据混合以适应其独特的优势与劣势. TULU 数据混合本身也依赖于从多种模型蒸馏而来的数据,我们希望未来减少对此类数据的依赖.

### 评估

While we've included comparisons on a variety of datasets to other current language models, many of the downstream tasks are not actually representative of how users interact with language models (i.e., as a chatbot). In addition, language model evaluations are currently very noisy; we aimed to include only evaluations on datasets that provided some signal as to which model performs best, but recognize that there is no perfect automatic evaluation, and thus comparisons should be taken with a grain of salt.
尽管我们包含了与多种数据集上其他当前语言模型的比较,但许多下游任务实际上并不能代表用户与语言模型的交互方式(即作为聊天机器人). 此外,语言模型评估目前非常嘈杂; 我们旨在仅纳入那些能够提供某种信号以指示哪个模型表现最佳的数据集评估,但也认识到不存在完美的自动评估,因此比较结果应审慎看待.

> 译者注: OLMo 团队在局限性章节中表现出的学术诚实值得注意. 他们明确指出了当前大语言模型评估中的"噪声"问题,并承认下游任务无法完全反映真实对话场景. 这种自我批判的态度与完全开放的数据/代码相结合,为社区提供了更可信的研究基础.



### 伦理声明

Through this work, we take the position that increased openness of language models is essential for scientific understanding of their abilities and limitations and for broad participation in the continued development of such models. Training on open data further enhances these benefits. In addition, our open release enables practitioners to take our models and build on them instead of having to train their own from scratch, in which case they would be repeating our work while consuming more resources and leading to an increased environmental impact. Of course, openness is not without risk; the possibility remains that these models will be used in unintended ways that cause harm. We believe that research and development efforts to understand and mitigate those potential harms will also be accelerated by the openness of the models, allowing a diversity of approaches and analyses. Over the past year there have been a number of comparable models released with very permissive licenses, so using a more strict license for our work would not remove the overall risk in the field. We believe this trade-off on the side of being more open is the best option.
通过这项工作,我们主张增强语言模型的开放性对于科学理解其能力与局限性、以及让广大群体参与此类模型的持续发展至关重要. 在开放数据上训练进一步增强了这些益处. 此外,我们的开放发布使从业者可以采用我们的模型并在此基础上构建,而无需从头训练自己的模型——否则他们将重复我们的工作,消耗更多资源并导致更大的环境影响. 当然,开放并非没有风险; 这些模型仍有可能被以非预期的方式使用从而造成危害. 我们相信,理解和缓解这些潜在危害的研究与开发工作也将因模型的开放性而加速,从而允许多样化的方法与分析. 在过去一年中,已有许多采用非常宽松许可证的同类模型发布,因此为我们的工作使用更严格的许可证并不会消除该领域的整体风险. 我们认为,在更开放这一侧进行权衡是最佳选择.

> 译者注: OLMo 的伦理立场体现了一种"开放促进安全"的哲学: 与其通过封闭来规避风险,不如通过开放来加速对风险的理解与缓解. 这一立场与 BLOOM、Pythia 等项目的伦理观一脉相承,但在商业模型日益封闭的背景下,OLMo 的明确表态具有特殊的时代意义.

### 致谢

OLMo would not have been possible without the support of many individuals and institutions. The experimental components of this work were made possible through a partnership with AMD and CSC, enabling use of the LUMI supercomputer, and Kempner Institute at Harvard University. We thank Jonathan Frankle and the team at MosaicML (now Databricks) for sharing their experiences with FSDP, and building the code base that OLMo is based on. We thank our teammates Taira Anderson, Michelle Benedict, Jon Borchardt, Evie Cheng, Arnavi Chheda, Johann Dahm, Matt Latzke, Kelsey MacMillan, Aaron Sarnat, Carissa Schoenick, Sam Skjonsberg, Michael Schmitz, Michael Wilson, Caitlin Wittlif, and the entire IT team, for their help with the website, design, internal and external communications, budgeting, and other activities that supported smooth progress on this project. Finally, we also express gratitude for the helpful discussions and feedback from our teammates at AI2 and close collaborators, including Prithviraj (Raj) Ammanabrolu, Peter Clark, Nicole DeCario, Doug Downey, Ali Farhadi, Ian Ferreira, Vaino Hatanpaa, Sham M. Kakade, Julien Launay, Sydney Levine, Pekka Manninen, Franzi Roessner, Maarten Sap, Ludwig Schmidt, Yulia Tsvetkov, and Daniel S. Weld.
OLMo 的完成离不开许多个人与机构的支持. 本工作的实验部分得益于与 AMD 和 CSC 的合作,使我们能够使用 LUMI 超级计算机,以及哈佛大学 Kempner 研究所的支持. 我们感谢 Jonathan Frankle 和 MosaicML(现为 Databricks)团队分享他们在 FSDP 方面的经验,并构建了 OLMo 所基于的代码库. 我们感谢队友 Taira Anderson、Michelle Benedict、Jon Borchardt、Evie Cheng、Arnavi Chheda、Johann Dahm、Matt Latzke、Kelsey MacMillan、Aaron Sarnat、Carissa Schoenick、Sam Skjonsberg、Michael Schmitz、Michael Wilson、Caitlin Wittlif 以及整个 IT 团队,感谢他们在网站、设计、内外部沟通、预算及其他支持本项目顺利推进的活动中的帮助. 最后,我们还要感谢 AI2 的队友和密切合作者的有益讨论与反馈,包括 Prithviraj (Raj) Ammanabrolu、Peter Clark、Nicole DeCario、Doug Downey、Ali Farhadi、Ian Ferreira、Vaino Hatanpaa、Sham M. Kakade、Julien Launay、Sydney Levine、Pekka Manninen、Franzi Roessner、Maarten Sap、Ludwig Schmidt、Yulia Tsvetkov 和 Daniel S. Weld.

## 参考文献

Amro Abbas, Kushal Tirumala, Daniel Simig, Surya Ganguli, and Ari S Morcos. 2023. Semdedup: Data-efficient learning at web-scale through semantic deduplication. arXiv preprint arXiv:2303.09540.
Amro Abbas, Kushal Tirumala, Daniel Simig, Surya Ganguli, and Ari S Morcos. 2023. Semdedup: 通过网络规模语义去重实现数据高效学习. arXiv 预印本 arXiv:2303.09540.

Ebtesam Almazrouei, Hamza Alobeidli, Abdulaziz Alshamsi, Alessandro Cappelli, Ruxandra-Aimee Cojocaru, Daniel Hesslow, Julien Launay, Quentin Malartic, Daniele Mazzotta, Badreddine Noune, Baptiste Pannier, and Guilherme Penedo. 2023. The falcon series of open language models. ArXiv, abs/2311.16867.
Ebtesam Almazrouei, Hamza Alobeidli, Abdulaziz Alshamsi, Alessandro Cappelli, Ruxandra-Aimee Cojocaru, Daniel Hesslow, Julien Launay, Quentin Malartic, Daniele Mazzotta, Badreddine Noune, Baptiste Pannier, and Guilherme Penedo. 2023. Falcon 开放语言模型系列. ArXiv, abs/2311.16867.

Yuvanesh Anand, Zach Nussbaum, Brandon Duderstadt, Benjamin Schmidt, and Andriy Mulyar. 2023. Gpt4all: Training an assistant-style chatbot with large scale data distillation from gpt-3.5-turbo. https://github.com/nomic-ai/gpt4all.
Yuvanesh Anand, Zach Nussbaum, Brandon Duderstadt, Benjamin Schmidt, and Andriy Mulyar. 2023. Gpt4all: 通过从 gpt-3.5-turbo 进行大规模数据蒸馏训练助手式聊天机器人. https://github.com/nomic-ai/gpt4all.

Jimmy Ba, Jamie Ryan Kiros, and Geoffrey E. Hinton. 2016. Layer normalization. ArXiv, abs/1607.06450.
Jimmy Ba, Jamie Ryan Kiros, and Geoffrey E. Hinton. 2016. 层归一化(Layer normalization). ArXiv, abs/1607.06450.

Yuntao Bai, Andy Jones, Kamal Ndousse, Amanda Askell, Anna Chen, Nova DasSarma, Dawn Drain, Stanislav Fort, Deep Ganguli, Tom Henighan, Nicholas Joseph, Saurav Kadavath, Jackson Kernion, Tom Conerly, Sheer El-Showk, Nelson Elhage, Zac Hatfield-Dodds, Danny Hernandez, Tristan Hume, Scott Johnston, Shauna Kravec, Liane Lovitt, Neel Nanda, Catherine Olsson, Dario Amodei, Tom Brown, Jack Clark, Sam McCandlish, Chris Olah, Ben Mann, and Jared Kaplan. 2022. Training a helpful and harmless assistant with reinforcement learning from human feedback.
Yuntao Bai, Andy Jones, Kamal Ndousse, Amanda Askell, Anna Chen, Nova DasSarma, Dawn Drain, Stanislav Fort, Deep Ganguli, Tom Henighan, Nicholas Joseph, Saurav Kadavath, Jackson Kernion, Tom Conerly, Sheer El-Showk, Nelson Elhage, Zac Hatfield-Dodds, Danny Hernandez, Tristan Hume, Scott Johnston, Shauna Kravec, Liane Lovitt, Neel Nanda, Catherine Olsson, Dario Amodei, Tom Brown, Jack Clark, Sam McCandlish, Chris Olah, Ben Mann, and Jared Kaplan. 2022. 通过基于人类反馈的强化学习训练一个有益且无害的助手.

Yoshua Bengio, Rejean Ducharme, Pascal Vincent, and Christian Janvin. 2003. A neural probabilistic language model. J. Mach. Learn. Res., 3:1137-1155.
Yoshua Bengio, Rejean Ducharme, Pascal Vincent, and Christian Janvin. 2003. 一种神经概率语言模型. J. Mach. Learn. Res., 3:1137-1155.

Stella Biderman, Hailey Schoelkopf, Quentin Gregory Anthony, Herbie Bradley, Kyle O'Brien, Eric Hallahan, Mohammad Aflah Khan, Shivanshu Purohit, Usvsn Sai Prashanth, Edward Raff, Aviya Skowron, Lintang Sutawika, and Oskar Van Der Wal. 2023. Pythia: A suite for analyzing large language models across training and scaling. In Proceedings of the 40th International Conference on Machine Learning, volume 202 of Proceedings of Machine Learning Research, pages 2397-2430. PMLR.
Stella Biderman, Hailey Schoelkopf, Quentin Gregory Anthony, Herbie Bradley, Kyle O'Brien, Eric Hallahan, Mohammad Aflah Khan, Shivanshu Purohit, Usvsn Sai Prashanth, Edward Raff, Aviya Skowron, Lintang Sutawika, and Oskar Van Der Wal. 2023. Pythia: 一套用于跨训练与扩展分析大型语言模型的工具. 载于第 40 届国际机器学习大会论文集,第 202 卷《机器学习研究论文集》,第 2397-2430 页. PMLR.

BigScience, Teven Le Scao, Angela Fan, Christopher Akiki, Ellie Pavlick, Suzana Ilic, Daniel Hesslow, Roman Castagne, Alexandra Sasha Luccioni, Francois Yvon, et al. 2022. Bloom: A 176b-parameter open-access multilingual language model. arXiv preprint arXiv:2211.05100.
BigScience, Teven Le Scao, Angela Fan, Christopher Akiki, Ellie Pavlick, Suzana Ilic, Daniel Hesslow, Roman Castagne, Alexandra Sasha Luccioni, Francois Yvon, et al. 2022. BLOOM: 一个 1760 亿参数开放获取的多语言语言模型. arXiv 预印本 arXiv:2211.05100.



Yonatan Bisk, Rowan Zellers, Jianfeng Gao, Yejin Choi, et al. 2020. Piqa: Reasoning about physical commonsense in natural language. In Proceedings of the AAAI conference on artificial intelligence, volume 34, pages 7432-7439.
Yonatan Bisk, Rowan Zellers, Jianfeng Gao, Yejin Choi, et al. 2020. Piqa: 关于自然语言中物理常识的推理. 载于 AAAI 人工智能大会论文集,第 34 卷,第 7432-7439 页.

Sid Black, Stella Biderman, Eric Hallahan, Quentin Anthony, Leo Gao, Laurence Golding, Horace He, Connor Leahy, Kyle McDonell, Jason Phang, Michael Pieler, USVSN Sai Prashanth, Shivanshu Purohit, Laria Reynolds, Jonathan Tow, Ben Wang, and Samuel Weinbach. 2022. GPT-NeoX-20B: An open-source autoregressive language model. In Proceedings of the ACL Workshop on Challenges & Perspectives in Creating Large Language Models.
Sid Black, Stella Biderman, Eric Hallahan, Quentin Anthony, Leo Gao, Laurence Golding, Horace He, Connor Leahy, Kyle McDonell, Jason Phang, Michael Pieler, USVSN Sai Prashanth, Shivanshu Purohit, Laria Reynolds, Jonathan Tow, Ben Wang, and Samuel Weinbach. 2022. GPT-NeoX-20B: 一个开源自回归语言模型. 载于 ACL 创建大型语言模型的挑战与视角研讨会论文集.

Su Lin Blodgett, Lisa Green, and Brendan O'Connor. 2016. Demographic dialectal variation in social media: A case study of African-American English. In Proceedings of the 2016 Conference on Empirical Methods in Natural Language Processing, pages 1119-1130, Austin, Texas. Association for Computational Linguistics.
Su Lin Blodgett, Lisa Green, and Brendan O'Connor. 2016. 社交媒体中人口统计方言变异: 非裔美国人英语案例研究. 载于 2016 年自然语言处理实证方法大会论文集,第 1119-1130 页,德克萨斯州奥斯汀. 计算语言学协会.

Tom B. Brown, Benjamin Mann, Nick Ryder, Melanie Subbiah, Jared Kaplan, Prafulla Dhariwal, Arvind Neelakantan, Pranav Shyam, Girish Sastry, Amanda Askell, Sandhini Agarwal, Ariel Herbert-Voss, Gretchen Krueger, T. J. Henighan, Rewon Child, Aditya Ramesh, Daniel M. Ziegler, Jeff Wu, Clemens Winter, Christopher Hesse, Mark Chen, Eric Sigler, Mateusz Litwin, Scott Gray, Benjamin Chess, Jack Clark, Christopher Berner, Sam McCandlish, Alec Radford, Ilya Sutskever, and Dario Amodei. 2020. Language models are few-shot learners. ArXiv, abs/2005.14165.
Tom B. Brown, Benjamin Mann, Nick Ryder, Melanie Subbiah, Jared Kaplan, Prafulla Dhariwal, Arvind Neelakantan, Pranav Shyam, Girish Sastry, Amanda Askell, Sandhini Agarwal, Ariel Herbert-Voss, Gretchen Krueger, T. J. Henighan, Rewon Child, Aditya Ramesh, Daniel M. Ziegler, Jeff Wu, Clemens Winter, Christopher Hesse, Mark Chen, Eric Sigler, Mateusz Litwin, Scott Gray, Benjamin Chess, Jack Clark, Christopher Berner, Sam McCandlish, Alec Radford, Ilya Sutskever, and Dario Amodei. 2020. 语言模型是少样本学习者. ArXiv, abs/2005.14165.

Wei-Lin Chiang, Zhuohan Li, Zi Lin, Ying Sheng, Zhanghao Wu, Hao Zhang, Lianmin Zheng, Siyuan Zhuang, Yonghao Zhuang, Joseph E. Gonzalez, Ion Stoica, and Eric P. Xing. 2023. Vicuna: An open-source chatbot impressing gpt-4 with 90%* chatgpt quality.
Wei-Lin Chiang, Zhuohan Li, Zi Lin, Ying Sheng, Zhanghao Wu, Hao Zhang, Lianmin Zheng, Siyuan Zhuang, Yonghao Zhuang, Joseph E. Gonzalez, Ion Stoica, and Eric P. Xing. 2023. Vicuna: 一个以 90%* ChatGPT 质量令 GPT-4 印象深刻的开源聊天机器人.

Aakanksha Chowdhery, Sharan Narang, Jacob Devlin, Maarten Bosma, Gaurav Mishra, Adam Roberts, Paul Barham, Hyung Won Chung, Charles Sutton, Sebastian Gehrmann, Parker Schuh, Kensen Shi, Sasha Tsvyashchenko, Joshua Maynez, Abhishek Rao, Parker Barnes, Yi Tay, Noam Shazeer, Vinodkumar Prabhakaran, Emily Reif, Nan Du, Ben Hutchinson, Reiner Pope, James Bradbury, Jacob Austin, Michael Isard, Guy Gur-Ari, Pengcheng Yin, Toju Duke, Anselm Levskaya, Sanjay Ghemawat, Sunipa Dev, Henryk Michalewski, Xavier Garcia, Vedant Misra, Kevin Robinson, Liam Fedus, Denny Zhou, Daphne Ippolito, David Luan, Hyeontaek Lim, Barret Zoph, Alexander Spiridonov, Ryan Sepassi, David Dohan, Shivani Agrawal, Mark Omernick, Andrew M. Dai, Thanumalayan Sankaranarayana Pillai, Marie Pellat, Aitor Lewkowycz, Erica Moreira, Rewon Child, Oleksandr Polozov, Katherine Lee, Zongwei Zhou, Xuezhi Wang, Brennan Saeta, Mark Diaz, Orhan Firat, Michele Catasta, Jason Wei, Kathy Meier-Hellstern, Douglas Eck, Jeff Dean, Slav Petrov, and Noah Fiedel. 2022. Palm: Scaling language modeling with pathways.
Aakanksha Chowdhery, Sharan Narang, Jacob Devlin, Maarten Bosma, Gaurav Mishra, Adam Roberts, Paul Barham, Hyung Won Chung, Charles Sutton, Sebastian Gehrmann, Parker Schuh, Kensen Shi, Sasha Tsvyashchenko, Joshua Maynez, Abhishek Rao, Parker Barnes, Yi Tay, Noam Shazeer, Vinodkumar Prabhakaran, Emily Reif, Nan Du, Ben Hutchinson, Reiner Pope, James Bradbury, Jacob Austin, Michael Isard, Guy Gur-Ari, Pengcheng Yin, Toju Duke, Anselm Levskaya, Sanjay Ghemawat, Sunipa Dev, Henryk Michalewski, Xavier Garcia, Vedant Misra, Kevin Robinson, Liam Fedus, Denny Zhou, Daphne Ippolito, David Luan, Hyeontaek Lim, Barret Zoph, Alexander Spiridonov, Ryan Sepassi, David Dohan, Shivani Agrawal, Mark Omernick, Andrew M. Dai, Thanumalayan Sankaranarayana Pillai, Marie Pellat, Aitor Lewkowycz, Erica Moreira, Rewon Child, Oleksandr Polozov, Katherine Lee, Zongwei Zhou, Xuezhi Wang, Brennan Saeta, Mark Diaz, Orhan Firat, Michele Catasta, Jason Wei, Kathy Meier-Hellstern, Douglas Eck, Jeff Dean, Slav Petrov, and Noah Fiedel. 2022. PaLM: 通过 Pathways 扩展语言建模.

Alexandra Chronopoulou, Matthew Peters, and Jesse Dodge. 2022. Efficient hierarchical domain adaptation for pretrained language models. In Proceedings of the 2022 Conference of the North American Chapter of the Association for Computational Linguistics: Human Language Technologies, pages 1336-1351, Seattle, United States. Association for Computational Linguistics.
Alexandra Chronopoulou, Matthew Peters, and Jesse Dodge. 2022. 预训练语言模型的高效层级领域适配. 载于 2022 年计算语言学协会北美分会人类语言技术大会论文集,第 1336-1351 页,美国西雅图. 计算语言学协会.

Hyung Won Chung, Noah Constant, Xavier Garcia, Adam Roberts, Yi Tay, Sharan Narang, and Orhan Firat. 2023. Unimax: Fairer and more effective language sampling for large-scale multilingual pretraining. ArXiv, abs/2304.09151.
Hyung Won Chung, Noah Constant, Xavier Garcia, Adam Roberts, Yi Tay, Sharan Narang, and Orhan Firat. 2023. Unimax: 面向大规模多语言预训练的更公平且更有效的语言采样. ArXiv, abs/2304.09151.

Christopher Clark, Kenton Lee, Ming-Wei Chang, Tom Kwiatkowski, Michael Collins, and Kristina Toutanova. 2019. Boolq: Exploring the surprising difficulty of natural yes/no questions. arXiv preprint arXiv:1905.10044.
Christopher Clark, Kenton Lee, Ming-Wei Chang, Tom Kwiatkowski, Michael Collins, and Kristina Toutanova. 2019. Boolq: 探索自然是非题令人惊讶的困难度. arXiv 预印本 arXiv:1905.10044.

Peter Clark, Isaac Cowhey, Oren Etzioni, Tushar Khot, Ashish Sabharwal, Carissa Schoenick, and Oyvind Tafjord. 2018. Think you have solved question answering? try arc, the ai2 reasoning challenge. arXiv preprint arXiv:1803.05457.
Peter Clark, Isaac Cowhey, Oren Etzioni, Tushar Khot, Ashish Sabharwal, Carissa Schoenick, and Oyvind Tafjord. 2018. 以为你已经解决了问答? 试试 ARC,AI2 推理挑战. arXiv 预印本 arXiv:1803.05457.

Mike Conover, Matt Hayes, Ankit Mathur, Jianwei Xie, Jun Wan, Sam Shah, Ali Ghodsi, Patrick Wendell, Matei Zaharia, and Reynold Xin. 2023. Free dolly: Introducing the world's first truly open instruction-tuned llm.
Mike Conover, Matt Hayes, Ankit Mathur, Jianwei Xie, Jun Wan, Sam Shah, Ali Ghodsi, Patrick Wendell, Matei Zaharia, and Reynold Xin. 2023. Free Dolly: 介绍世界上第一个真正开放的指令微调大语言模型.

Ganqu Cui, Lifan Yuan, Ning Ding, Guanming Yao, Wei Zhu, Yuan Ni, Guotong Xie, Zhiyuan Liu, and Maosong Sun. 2023. Ultrafeedback: Boosting language models with high-quality feedback.
Ganqu Cui, Lifan Yuan, Ning Ding, Guanming Yao, Wei Zhu, Yuan Ni, Guotong Xie, Zhiyuan Liu, and Maosong Sun. 2023. UltraFeedback: 以高质量反馈提升语言模型.

Jesse Dodge, Taylor Prewitt, Remi Tachet Des Combes, Erika Odmark, Roy Schwartz, Emma Strubell, Alexandra Sasha Luccioni, Noah A. Smith, Nicole DeCario, and Will Buchanan. 2022. Measuring the carbon intensity of ai in cloud instances.
Jesse Dodge, Taylor Prewitt, Remi Tachet Des Combes, Erika Odmark, Roy Schwartz, Emma Strubell, Alexandra Sasha Luccioni, Noah A. Smith, Nicole DeCario, and Will Buchanan. 2022. 测量云实例中 AI 的碳强度.

William B. Dolan and Chris Brockett. 2005. Automatically constructing a corpus of sentential paraphrases. In International Joint Conference on Natural Language Processing.
William B. Dolan and Chris Brockett. 2005. 自动构建句子释义语料库. 载于国际自然语言处理联合会议.

Yanai Elazar, Akshita Bhagia, Ian Helgi Magnusson, Abhilasha Ravichander, Dustin Schwenk, Alane Suhr, Evan Pete Walsh, Dirk Groeneveld, Luca Soldaini, Sameer Singh, Hanna Hajishirzi, Noah A. Smith, and Jesse Dodge. 2024. What's in my big data? In The Twelfth International Conference on Learning Representations.
Yanai Elazar, Akshita Bhagia, Ian Helgi Magnusson, Abhilasha Ravichander, Dustin Schwenk, Alane Suhr, Evan Pete Walsh, Dirk Groeneveld, Luca Soldaini, Sameer Singh, Hanna Hajishirzi, Noah A. Smith, and Jesse Dodge. 2024. 我的大数据里有什么? 载于第十二届国际学习表征会议.


Leo Gao, Stella Biderman, Sid Black, Laurence Golding, Travis Hoppe, Charles Foster, Jason Phang, Horace He, Anish Thite, Noa Nabeshima, et al. 2020. The pile: An 800gb dataset of diverse text for language modeling. arXiv preprint arXiv:2101.00027.
Leo Gao, Stella Biderman, Sid Black, Laurence Golding, Travis Hoppe, Charles Foster, Jason Phang, Horace He, Anish Thite, Noa Nabeshima, et al. 2020. The Pile: 一个用于语言建模的 800GB 多样化文本数据集. arXiv 预印本 arXiv:2101.00027.

Leo Gao, Jonathan Tow, Baber Abbasi, Stella Biderman, Sid Black, Anthony DiPofi, Charles Foster, Laurence Golding, Jeffrey Hsu, Alain Le Noac'h, Haonan Li, Kyle McDonell, Niklas Muennighoff, Chris Ociepa, Jason Phang, Laria Reynolds, Hailey Schoelkopf, Aviya Skowron, Lintang Sutawika, Eric Tang, Anish Thite, Ben Wang, Kevin Wang, and Andy Zou. 2023. A framework for few-shot language model evaluation.
Leo Gao, Jonathan Tow, Baber Abbasi, Stella Biderman, Sid Black, Anthony DiPofi, Charles Foster, Laurence Golding, Jeffrey Hsu, Alain Le Noac'h, Haonan Li, Kyle McDonell, Niklas Muennighoff, Chris Ociepa, Jason Phang, Laria Reynolds, Hailey Schoelkopf, Aviya Skowron, Lintang Sutawika, Eric Tang, Anish Thite, Ben Wang, Kevin Wang, and Andy Zou. 2023. 少样本语言模型评估框架.

Sidney Greenbaum and Gerald Nelson. 1996. The international corpus of english (ICE) project. World Englishes, 15(1):3-15.
Sidney Greenbaum and Gerald Nelson. 1996. 国际英语语料库(ICE)项目. World Englishes, 15(1):3-15.

Dirk Groeneveld, Anas Awadalla, Iz Beltagy, Akshita Bhagia, Ian Magnusson, Hao Peng, Oyvind Tafjord, Pete Walsh, Kyle Richardson, and Jesse Dodge. 2023. Catwalk: A unified language model evaluation framework for many datasets. arXiv preprint arXiv:2312.10253.
Dirk Groeneveld, Anas Awadalla, Iz Beltagy, Akshita Bhagia, Ian Magnusson, Hao Peng, Oyvind Tafjord, Pete Walsh, Kyle Richardson, and Jesse Dodge. 2023. Catwalk: 面向多个数据集的统一语言模型评估框架. arXiv 预印本 arXiv:2312.10253.

Biyang Guo, Xin Zhang, Ziyuan Wang, Minqi Jiang, Jinran Nie, Yuxuan Ding, Jianwei Yue, and Yupeng Wu. 2023. How close is chatgpt to human experts? comparison corpus, evaluation, and detection. arXiv preprint arxiv:2301.07597.
Biyang Guo, Xin Zhang, Ziyuan Wang, Minqi Jiang, Jinran Nie, Yuxuan Ding, Jianwei Yue, and Yupeng Wu. 2023. ChatGPT 与人类专家有多接近? 比较语料库、评估与检测. arXiv 预印本 arxiv:2301.07597.

Suchin Gururangan, Mitchell Wortsman, Samir Yitzhak Gadre, Achal Dave, Maciej Kilian, Weijia Shi, Jean Mercat, Georgios Smyrnis, Gabriel Ilharco, Matt Jordan, Reinhard Heckel, Alex Dimakis, Ali Farhadi, Vaishaal Shankar, and Ludwig Schmidt. 2023. OpenLM: a minimal but performative language modeling (lm) repository. GitHub repository.
Suchin Gururangan, Mitchell Wortsman, Samir Yitzhak Gadre, Achal Dave, Maciej Kilian, Weijia Shi, Jean Mercat, Georgios Smyrnis, Gabriel Ilharco, Matt Jordan, Reinhard Heckel, Alex Dimakis, Ali Farhadi, Vaishaal Shankar, and Ludwig Schmidt. 2023. OpenLM: 一个最小化但高性能的语言建模代码库. GitHub 仓库.

Thomas Hartvigsen, Saadia Gabriel, Hamid Palangi, Maarten Sap, Dipankar Ray, and Ece Kamar. 2022. TOXIGEN: Controlling Language Models to Generate Implied and Adversarial Toxicity. In ACL.
Thomas Hartvigsen, Saadia Gabriel, Hamid Palangi, Maarten Sap, Dipankar Ray, and Ece Kamar. 2022. TOXIGEN: 控制语言模型生成隐含与对抗性毒性内容. 载于 ACL.

Dan Hendrycks, Collin Burns, Steven Basart, Andy Zou, Mantas Mazeika, Dawn Song, and Jacob Steinhardt. 2021. Measuring massive multitask language understanding. Proceedings of the International Conference on Learning Representations (ICLR).
Dan Hendrycks, Collin Burns, Steven Basart, Andy Zou, Mantas Mazeika, Dawn Song, and Jacob Steinhardt. 2021. 测量大规模多任务语言理解. 国际学习表征会议(ICLR)论文集.

Hamish Ivison, Yizhong Wang, Valentina Pyatkin, Nathan Lambert, Matthew Peters, Pradeep Dasigi, Joel Jang, David Wadden, Noah A. Smith, Iz Beltagy, and Hannaneh Hajishirzi. 2023. Camels in a changing climate: Enhancing lm adaptation with tulu 2.
Hamish Ivison, Yizhong Wang, Valentina Pyatkin, Nathan Lambert, Matthew Peters, Pradeep Dasigi, Joel Jang, David Wadden, Noah A. Smith, Iz Beltagy, and Hannaneh Hajishirzi. 2023. 变化气候中的骆驼: 用 TULU 2 增强语言模型适配.

Albert Q Jiang, Alexandre Sablayrolles, Antoine Roux, Arthur Mensch, Blanche Savary, Chris Bamford, Devendra Singh Chaplot, Diego de las Casas, Emma Bou Hanna, Florian Bressand, et al. 2024. Mixtral of experts. arXiv preprint arXiv:2401.04088.
Albert Q Jiang, Alexandre Sablayrolles, Antoine Roux, Arthur Mensch, Blanche Savary, Chris Bamford, Devendra Singh Chaplot, Diego de las Casas, Emma Bou Hanna, Florian Bressand, et al. 2024. Mixtral of experts. arXiv 预印本 arXiv:2401.04088.

Andreas Kopf, Yannic Kilcher, Dimitri von Rutte, Sotiris Anagnostidis, Zhi Rui Tam, Keith Stevens, Abdullah Barhoum, Duc Minh Nguyen, Oliver Stanley, Richard Nagyfi, Shahul ES, Sameer Suri, David Alexandrovich Glushkov, Arnav Varma Dantuluri, Andrew Maguire, Christoph Schuhmann, Huu Nguyen, and Alexander Julian Mattick. 2023. Openassistant conversations - democratizing large language model alignment. In Thirty-seventh Conference on Neural Information Processing Systems Datasets and Benchmarks Track.
Andreas Kopf, Yannic Kilcher, Dimitri von Rutte, Sotiris Anagnostidis, Zhi Rui Tam, Keith Stevens, Abdullah Barhoum, Duc Minh Nguyen, Oliver Stanley, Richard Nagyfi, Shahul ES, Sameer Suri, David Alexandrovich Glushkov, Arnav Varma Dantuluri, Andrew Maguire, Christoph Schuhmann, Huu Nguyen, and Alexander Julian Mattick. 2023. OpenAssistant 对话——民主化大语言模型对齐. 载于第三十七届神经信息处理系统会议数据集与基准赛道.

Xuechen Li, Tianyi Zhang, Yann Dubois, Rohan Taori, Ishaan Gulrajani, Carlos Guestrin, Percy Liang, and Tatsunori B. Hashimoto. 2023. Alpacaeval: An automatic evaluator of instruction-following models. Github repository.
Xuechen Li, Tianyi Zhang, Yann Dubois, Rohan Taori, Ishaan Gulrajani, Carlos Guestrin, Percy Liang, and Tatsunori B. Hashimoto. 2023. AlpacaEval: 指令遵循模型的自动评估器. GitHub 仓库.

Percy Liang, Rishi Bommasani, Tony Lee, Dimitris Tsipras, Dilara Soylu, Michihiro Yasunaga, Yian Zhang, Deepak Narayanan, Yuhuai Wu, Ananya Kumar, et al. 2022. Holistic evaluation of language models. arXiv preprint arXiv:2211.09110.
Percy Liang, Rishi Bommasani, Tony Lee, Dimitris Tsipras, Dilara Soylu, Michihiro Yasunaga, Yian Zhang, Deepak Narayanan, Yuhuai Wu, Ananya Kumar, et al. 2022. 语言模型的整体评估. arXiv 预印本 arXiv:2211.09110.

Stephanie Lin, Jacob Hilton, and Owain Evans. 2022. Truthfulqa: Measuring how models mimic human falsehoods. In Proceedings of the 60th Annual Meeting of the Association for Computational Linguistics (Volume 1: Long Papers), pages 3214-3252.
Stephanie Lin, Jacob Hilton, and Owain Evans. 2022. TruthfulQA: 测量模型如何模仿人类虚假陈述. 载于计算语言学协会第 60 届年会论文集(第 1 卷: 长篇论文),第 3214-3252 页.

Jian Liu, Leyang Cui, Hanmeng Liu, Dandan Huang, Yile Wang, and Yue Zhang. 2020. Logiqa: A challenge dataset for machine reading comprehension with logical reasoning. CoRR, abs/2007.08124.
Jian Liu, Leyang Cui, Hanmeng Liu, Dandan Huang, Yile Wang, and Yue Zhang. 2020. LogiQA: 一个用于逻辑推理机器阅读理解的挑战数据集. CoRR, abs/2007.08124.

Zhengzhong Liu, Aurick Qiao, Willie Neiswanger, Hongyi Wang, Bowen Tan, Tianhua Tao, Junbo Li, Yuqi Wang, Suqi Sun, Omkar Pangarkar, et al. 2023. Llm360: Towards fully transparent open-source llms. arXiv preprint arXiv:2312.06550.
Zhengzhong Liu, Aurick Qiao, Willie Neiswanger, Hongyi Wang, Bowen Tan, Tianhua Tao, Junbo Li, Yuqi Wang, Suqi Sun, Omkar Pangarkar, et al. 2023. LLM360: 迈向完全透明的开源大语言模型. arXiv 预印本 arXiv:2312.06550.

Ilya Loshchilov and Frank Hutter. 2019. Decoupled weight decay regularization. In International Conference on Learning Representations.
Ilya Loshchilov and Frank Hutter. 2019. 解耦权重衰减正则化. 载于国际学习表征会议.

Alexandra Sasha Luccioni, Sylvain Viguier, and Anne-Laure Ligozat. 2022. Estimating the carbon footprint of bloom, a 176b parameter language model.
Alexandra Sasha Luccioni, Sylvain Viguier, and Anne-Laure Ligozat. 2022. 估计 BLOOM(一个 1760 亿参数语言模型)的碳足迹.

Ian Magnusson, Akshita Bhagia, Valentin Hofmann, Luca Soldaini, Ananya Harsh Jha, Oyvind Tafjord, Dustin Schwenk, Evan Pete Walsh, Yanai Elazar, Kyle Lo, et al. 2023. Paloma: A benchmark for evaluating language model fit. arXiv preprint arXiv:2312.10523.
Ian Magnusson, Akshita Bhagia, Valentin Hofmann, Luca Soldaini, Ananya Harsh Jha, Oyvind Tafjord, Dustin Schwenk, Evan Pete Walsh, Yanai Elazar, Kyle Lo, et al. 2023. Paloma: 一个用于评估语言模型拟合度的基准. arXiv 预印本 arXiv:2312.10523.

Mitchell P. Marcus, Beatrice Santorini, Mary Ann Marcinkiewicz, and Ann Taylor. 1999. Treebank-3.
Mitchell P. Marcus, Beatrice Santorini, Mary Ann Marcinkiewicz, and Ann Taylor. 1999. Treebank-3.

Stephen Merity, Caiming Xiong, James Bradbury, and Richard Socher. 2016. Pointer sentinel mixture models. ArXiv, abs/1609.07843.
Stephen Merity, Caiming Xiong, James Bradbury, and Richard Socher. 2016. 指针哨兵混合模型. ArXiv, abs/1609.07843.



Paulius Micikevicius, Sharan Narang, Jonah Alben, Gregory Frederick Diamos, Erich Elsen, David Garcia, Boris Ginsburg, Michael Houston, Oleksii Kuchaiev, Ganesh Venkatesh, and Hao Wu. 2017. Mixed precision training. ArXiv, abs/1710.03740.
Paulius Micikevicius, Sharan Narang, Jonah Alben, Gregory Frederick Diamos, Erich Elsen, David Garcia, Boris Ginsburg, Michael Houston, Oleksii Kuchaiev, Ganesh Venkatesh, and Hao Wu. 2017. 混合精度训练. ArXiv, abs/1710.03740.

Todor Mihaylov, Peter Clark, Tushar Khot, and Ashish Sabharwal. 2018. Can a suit of armor conduct electricity? a new dataset for open book question answering. arXiv preprint arXiv:1809.02789.
Todor Mihaylov, Peter Clark, Tushar Khot, and Ashish Sabharwal. 2018. 一副盔甲能导电吗? 一个用于开放书籍问答的新数据集. arXiv 预印本 arXiv:1809.02789.

Tomas Mikolov, Ilya Sutskever, Kai Chen, Gregory S. Corrado, and Jeffrey Dean. 2013. Distributed representations of words and phrases and their compositionality. In Neural Information Processing Systems.
Tomas Mikolov, Ilya Sutskever, Kai Chen, Gregory S. Corrado, and Jeffrey Dean. 2013. 词与短语的分布式表征及其组合性. 载于神经信息处理系统会议.

Swaroop Mishra, Daniel Khashabi, Chitta Baral, and Hannaneh Hajishirzi. 2022. Cross-task generalization via natural language crowdsourcing instructions. In Proceedings of the 60th Annual Meeting of the Association for Computational Linguistics (Volume 1: Long Papers), pages 3470-3487, Dublin, Ireland. Association for Computational Linguistics.
Swaroop Mishra, Daniel Khashabi, Chitta Baral, and Hannaneh Hajishirzi. 2022. 通过自然语言众包指令实现跨任务泛化. 载于计算语言学协会第 60 届年会论文集(第 1 卷: 长篇论文),第 3470-3487 页,爱尔兰都柏林. 计算语言学协会.

MosaicML NLP Team. 2023. Introducing mpt-7b: A new standard for open-source, commercially usable llms. Accessed: 2023-05-05.
MosaicML NLP Team. 2023. 介绍 MPT-7B: 开源商业可用大语言模型的新标准. 访问日期: 2023-05-05.

Niklas Muennighoff, Alexander M Rush, Boaz Barak, Teven Le Scao, Aleksandra Piktus, Nouamane Tazi, Sampo Pyysalo, Thomas Wolf, and Colin Raffel. 2023. Scaling data-constrained language models. arXiv preprint arXiv:2305.16264.
Niklas Muennighoff, Alexander M Rush, Boaz Barak, Teven Le Scao, Aleksandra Piktus, Nouamane Tazi, Sampo Pyysalo, Thomas Wolf, and Colin Raffel. 2023. 扩展数据受限的语言模型. arXiv 预印本 arXiv:2305.16264.

Davide Nunes. 2020. Preprocessed penn tree bank.
Davide Nunes. 2020. 预处理后的宾州树库.

OpenAI. 2023. Gpt-4 technical report. ArXiv, abs/2303.08774.
OpenAI. 2023. GPT-4 技术报告. ArXiv, abs/2303.08774.

Long Ouyang, Jeffrey Wu, Xu Jiang, Diogo Almeida, Carroll Wainwright, Pamela Mishkin, Chong Zhang, Sandhini Agarwal, Katarina Slama, Alex Ray, John Schulman, Jacob Hilton, Fraser Kelton, Luke Miller, Maddie Simens, Amanda Askell, Peter Welinder, Paul F Christiano, Jan Leike, and Ryan Lowe. 2022. Training language models to follow instructions with human feedback. In Advances in Neural Information Processing Systems, volume 35, pages 27730-27744. Curran Associates, Inc.
Long Ouyang, Jeffrey Wu, Xu Jiang, Diogo Almeida, Carroll Wainwright, Pamela Mishkin, Chong Zhang, Sandhini Agarwal, Katarina Slama, Alex Ray, John Schulman, Jacob Hilton, Fraser Kelton, Luke Miller, Maddie Simens, Amanda Askell, Peter Welinder, Paul F Christiano, Jan Leike, and Ryan Lowe. 2022. 训练语言模型遵循带有人类反馈的指令. 载于神经信息处理系统进展,第 35 卷,第 27730-27744 页. Curran Associates, Inc.

Antonis Papasavva, Savvas Zannettou, Emiliano De Cristofaro, Gianluca Stringhini, and Jeremy Blackburn. 2020. Raiders of the lost kek: 3.5 years of augmented 4chan posts from the politically incorrect board. Proceedings of the International AAAI Conference on Web and Social Media, 14:885-894.
Antonis Papasavva, Savvas Zannettou, Emiliano De Cristofaro, Gianluca Stringhini, and Jeremy Blackburn. 2020. 失落kek的突袭者: 来自政治不正确板块的 4chan 增强帖子 3.5 年数据. 国际 AAAI 网络与社交媒体会议论文集, 14:885-894.

David Patterson, Joseph Gonzalez, Quoc Le, Chen Liang, Lluis-Miquel Munguia, Daniel Rothchild, David So, Maud Texier, and Jeff Dean. 2021. Carbon emissions and large neural network training.
David Patterson, Joseph Gonzalez, Quoc Le, Chen Liang, Lluis-Miquel Munguia, Daniel Rothchild, David So, Maud Texier, and Jeff Dean. 2021. 碳排放与大型神经网络训练.

Guilherme Penedo, Quentin Malartic, Daniel Hesslow, Ruxandra-Aimee Cojocaru, Alessandro Cappelli, Hamza Alobeidli, Baptiste Pannier, Ebtesam Almazrouei, and Julien Launay. 2023. The refined-web dataset for falcon llm: Outperforming curated corpora with web data, and web data only. ArXiv, abs/2306.01116.
Guilherme Penedo, Quentin Malartic, Daniel Hesslow, Ruxandra-Aimee Cojocaru, Alessandro Cappelli, Hamza Alobeidli, Baptiste Pannier, Ebtesam Almazrouei, and Julien Launay. 2023. Falcon LLM 的 RefinedWeb 数据集: 仅使用网络数据超越策展语料库. ArXiv, abs/2306.01116.

Matthew E. Peters, Mark Neumann, Mohit Iyyer, Matt Gardner, Christopher Clark, Kenton Lee, and Luke Zettlemoyer. 2018. Deep contextualized word representations. ArXiv, abs/1802.05365.
Matthew E. Peters, Mark Neumann, Mohit Iyyer, Matt Gardner, Christopher Clark, Kenton Lee, and Luke Zettlemoyer. 2018. 深度上下文词表征. ArXiv, abs/1802.05365.

Mohammad Taher Pilehvar and Jose Camacho-Collados. 2018. Wic: 10, 000 example pairs for evaluating context-sensitive representations. CoRR, abs/1808.09121.
Mohammad Taher Pilehvar and Jose Camacho-Collados. 2018. WiC: 用于评估上下文敏感表征的 10,000 个示例对. CoRR, abs/1808.09121.

Jack W. Rae, Sebastian Borgeaud, Trevor Cai, Katie Millican, Jordan Hoffmann, Francis Song, John Aslanides, Sarah Henderson, Roman Ring, Susannah Young, Eliza Rutherford, Tom Hennigan, Jacob Menick, Albin Cassirer, Richard Powell, George van den Driessche, Lisa Anne Hendricks, Maribeth Rauh, Po-Sen Huang, Amelia Glaese, Johannes Welbl, Sumanth Dathathri, Saffron Huang, Jonathan Uesato, John Mellor, Irina Higgins, Antonia Creswell, Nat McAleese, Amy Wu, Erich Elsen, Siddhant Jayakumar, Elena Buchatskaya, David Budden, Esme Sutherland, Karen Simonyan, Michela Paganini, Laurent Sifre, Lena Martens, Xiang Lorraine Li, Adhiguna Kuncoro, Aida Nematzadeh, Elena Gribovskaya, Domenic Donato, Angeliki Lazaridou, Arthur Mensch, Jean-Baptiste Lespiau, Maria Tsimpoukelli, Nikolai Grigorev, Doug Fritz, Thibault Sottiaux, Mantas Pajarskas, Toby Pohlen, Zhitao Gong, Daniel Toyama, Cyprien de Masson d'Autume, Yujia Li, Tayfun Terzi, Vladimir Mikulik, Igor Babuschkin, Aidan Clark, Diego de Las Casas, Aurelia Guy, Chris Jones, James Bradbury, Matthew Johnson, Blake Hechtman, Laura Weidinger, Iason Gabriel, William Isaac, Ed Lockhart, Simon Osindero, Laura Rimell, Chris Dyer, Oriol Vinyals, Kareem Ayoub, Jeff Stanway, Lorrayne Bennett, Demis Hassabis, Koray Kavukcuoglu, and Geoffrey Irving. 2022. Scaling language models: Methods, analysis & insights from training gopher.
Jack W. Rae, Sebastian Borgeaud, Trevor Cai, Katie Millican, Jordan Hoffmann, Francis Song, John Aslanides, Sarah Henderson, Roman Ring, Susannah Young, Eliza Rutherford, Tom Hennigan, Jacob Menick, Albin Cassirer, Richard Powell, George van den Driessche, Lisa Anne Hendricks, Maribeth Rauh, Po-Sen Huang, Amelia Glaese, Johannes Welbl, Sumanth Dathathri, Saffron Huang, Jonathan Uesato, John Mellor, Irina Higgins, Antonia Creswell, Nat McAleese, Amy Wu, Erich Elsen, Siddhant Jayakumar, Elena Buchatskaya, David Budden, Esme Sutherland, Karen Simonyan, Michela Paganini, Laurent Sifre, Lena Martens, Xiang Lorraine Li, Adhiguna Kuncoro, Aida Nematzadeh, Elena Gribovskaya, Domenic Donato, Angeliki Lazaridou, Arthur Mensch, Jean-Baptiste Lespiau, Maria Tsimpoukelli, Nikolai Grigorev, Doug Fritz, Thibault Sottiaux, Mantas Pajarskas, Toby Pohlen, Zhitao Gong, Daniel Toyama, Cyprien de Masson d'Autume, Yujia Li, Tayfun Terzi, Vladimir Mikulik, Igor Babuschkin, Aidan Clark, Diego de Las Casas, Aurelia Guy, Chris Jones, James Bradbury, Matthew Johnson, Blake Hechtman, Laura Weidinger, Iason Gabriel, William Isaac, Ed Lockhart, Simon Osindero, Laura Rimell, Chris Dyer, Oriol Vinyals, Kareem Ayoub, Jeff Stanway, Lorrayne Bennett, Demis Hassabis, Koray Kavukcuoglu, and Geoffrey Irving. 2022. 扩展语言模型: 训练 Gopher 的方法、分析与洞见.

Rafael Rafailov, Archit Sharma, Eric Mitchell, Christopher D Manning, Stefano Ermon, and Chelsea Finn. 2023. Direct preference optimization: Your language model is secretly a reward model. In Thirty-seventh Conference on Neural Information Processing Systems.
Rafael Rafailov, Archit Sharma, Eric Mitchell, Christopher D Manning, Stefano Ermon, and Chelsea Finn. 2023. 直接偏好优化: 你的语言模型 secretly 是一个奖励模型. 载于第三十七届神经信息处理系统会议.

Colin Raffel, Noam Shazeer, Adam Roberts, Katherine Lee, Sharan Narang, Michael Matena, Yanqi Zhou, Wei Li, and Peter J. Liu. 2020. Exploring the limits of transfer learning with a unified text-to-text transformer. J. Mach. Learn. Res., 21(1).
Colin Raffel, Noam Shazeer, Adam Roberts, Katherine Lee, Sharan Narang, Michael Matena, Yanqi Zhou, Wei Li, and Peter J. Liu. 2020. 使用统一文本到文本 Transformer 探索迁移学习的极限. J. Mach. Learn. Res., 21(1).

Samyam Rajbhandari, Jeff Rasley, Olatunji Ruwase, and Yuxiong He. 2019. Zero: Memory optimizations toward training trillion parameter models. SC20: International Conference for High Performance Computing, Networking, Storage and Analysis, pages 1-16.
Samyam Rajbhandari, Jeff Rasley, Olatunji Ruwase, and Yuxiong He. 2019. ZeRO: 面向训练万亿参数模型的内存优化. SC20: 国际高性能计算、网络、存储与分析会议,第 1-16 页.



Machel Reid, Victor Zhong, Suchin Gururangan, and Luke Zettlemoyer. 2022. M2D2: A massively multi-domain language modeling dataset. In Proceedings of the 2022 Conference on Empirical Methods in Natural Language Processing, pages 964-975, Abu Dhabi, United Arab Emirates. Association for Computational Linguistics.
Machel Reid, Victor Zhong, Suchin Gururangan, and Luke Zettlemoyer. 2022. M2D2: 一个大规模多领域语言建模数据集. 载于 2022 年自然语言处理实证方法大会论文集,第 964-975 页,阿联酋阿布扎比. 计算语言学协会.

Manoel Horta Ribeiro, Jeremy Blackburn, Barry Bradlyn, Emiliano De Cristofaro, Gianluca Stringhini, Summer Long, Stephanie Greenberg, and Savvas Zannettou. 2021. The evolution of the manosphere across the web. Proceedings of the International AAAI Conference on Web and Social Media, 15:196-207.
Manoel Horta Ribeiro, Jeremy Blackburn, Barry Bradlyn, Emiliano De Cristofaro, Gianluca Stringhini, Summer Long, Stephanie Greenberg, and Savvas Zannettou. 2021. 网络中男权空间的演变. 国际 AAAI 网络与社交媒体会议论文集, 15:196-207.

Ronald Rosenfeld. 2000. Two decades of statistical language modeling: Where do we go from here? Proceedings of the IEEE, 88(8):1270-1278.
Ronald Rosenfeld. 2000. 统计语言建模二十年: 我们何去何从? Proceedings of the IEEE, 88(8):1270-1278.

Keisuke Sakaguchi, Ronan Le Bras, Chandra Bhagavatula, and Yejin Choi. 2021. Winogrande: An adversarial winograd schema challenge at scale. Communications of the ACM, 64(9):99-106.
Keisuke Sakaguchi, Ronan Le Bras, Chandra Bhagavatula, and Yejin Choi. 2021. WinoGrande: 大规模对抗性 Winograd 模式挑战. Communications of the ACM, 64(9):99-106.

Victor Sanh, Albert Webson, Colin Raffel, Stephen Bach, Lintang Sutawika, Zaid Alyafeai, Antoine Chaffin, Arnaud Stiegler, Arun Raja, Manan Dey, M Saiful Bari, Canwen Xu, Urmish Thakker, Shanya Sharma Sharma, Eliza Szczechla, Taewoon Kim, Gunjan Chhablani, Nihal Nayak, Debajyoti Datta, Jonathan Chang, Mike Tian-Jian Jiang, Han Wang, Matteo Manica, Sheng Shen, Zheng Xin Yong, Harshit Pandey, Rachel Bawden, Thomas Wang, Trishala Neeraj, Jos Rozen, Abheesht Sharma, Andrea Santilli, Thibault Fevry, Jason Alan Fries, Ryan Teehan, Teven Le Scao, Stella Biderman, Leo Gao, Thomas Wolf, and Alexander M Rush. 2022. Multitask prompted training enables zero-shot task generalization. In International Conference on Learning Representations.
Victor Sanh, Albert Webson, Colin Raffel, Stephen Bach, Lintang Sutawika, Zaid Alyafeai, Antoine Chaffin, Arnaud Stiegler, Arun Raja, Manan Dey, M Saiful Bari, Canwen Xu, Urmish Thakker, Shanya Sharma Sharma, Eliza Szczechla, Taewoon Kim, Gunjan Chhablani, Nihal Nayak, Debajyoti Datta, Jonathan Chang, Mike Tian-Jian Jiang, Han Wang, Matteo Manica, Sheng Shen, Zheng Xin Yong, Harshit Pandey, Rachel Bawden, Thomas Wang, Trishala Neeraj, Jos Rozen, Abheesht Sharma, Andrea Santilli, Thibault Fevry, Jason Alan Fries, Ryan Teehan, Teven Le Scao, Stella Biderman, Leo Gao, Thomas Wolf, and Alexander M Rush. 2022. 多任务提示训练实现零样本任务泛化. 载于国际学习表征会议.

Noam M. Shazeer. 2020. Glu variants improve transformer. ArXiv, abs/2002.05202.
Noam M. Shazeer. 2020. GLU 变体改进 Transformer. ArXiv, abs/2002.05202.

Luca Soldaini, Rodney Kinney, Akshita Bhagia, Dustin Schwenk, David Atkinson, Russell Authur, Ben Bogin, Khyathi Chandu, Jennifer Dumas, Yanai Elazar, Valentin Hofmann, Ananya Harsh Jha, Sachin Kumar, Li Lucy, Xinxi Lyu, Nathan Lambert, Ian Magnusson, Jacob Morrison, Niklas Muennighoff, Aakanksha Naik, Crystal Nam, Matthew E. Peters, Abhilasha Ravichander, Kyle Richardson, Zejiang Shen, Emma Strubell, Nishant Subramani, Oyvind Tafjord, Pete Walsh, Luke Zettlemoyer, Noah A. Smith, Hannaneh Hajishirzi, Iz Beltagy, Dirk Groeneveld, Jesse Dodge, and Kyle Lo. 2024. Dolma: an Open Corpus of Three Trillion Tokens for Language Model Pretraining Research. arXiv preprint.
Luca Soldaini, Rodney Kinney, Akshita Bhagia, Dustin Schwenk, David Atkinson, Russell Authur, Ben Bogin, Khyathi Chandu, Jennifer Dumas, Yanai Elazar, Valentin Hofmann, Ananya Harsh Jha, Sachin Kumar, Li Lucy, Xinxi Lyu, Nathan Lambert, Ian Magnusson, Jacob Morrison, Niklas Muennighoff, Aakanksha Naik, Crystal Nam, Matthew E. Peters, Abhilasha Ravichander, Kyle Richardson, Zejiang Shen, Emma Strubell, Nishant Subramani, Oyvind Tafjord, Pete Walsh, Luke Zettlemoyer, Noah A. Smith, Hannaneh Hajishirzi, Iz Beltagy, Dirk Groeneveld, Jesse Dodge, and Kyle Lo. 2024. Dolma: 一个用于语言模型预训练研究的 3 万亿词元开放语料库. arXiv 预印本.

Emma Strubell, Ananya Ganesh, and Andrew McCallum. 2019. Energy and policy considerations for deep learning in NLP. In Proceedings of the 57th Annual Meeting of the Association for Computational Linguistics, pages 3645-3650, Florence, Italy. Association for Computational Linguistics.
Emma Strubell, Ananya Ganesh, and Andrew McCallum. 2019. NLP 深度学习的能源与政策考量. 载于计算语言学协会第 57 届年会论文集,第 3645-3650 页,意大利佛罗伦萨. 计算语言学协会.

Jianlin Su, Yu Lu, Shengfeng Pan, Bo Wen, and Yunfeng Liu. 2021. Roformer: Enhanced transformer with rotary position embedding. ArXiv, abs/2104.09864.
Jianlin Su, Yu Lu, Shengfeng Pan, Bo Wen, and Yunfeng Liu. 2021. RoFormer: 带有旋转位置编码的增强型 Transformer. ArXiv, abs/2104.09864.

Rohan Taori, Ishaan Gulrajani, Tianyi Zhang, Yann Dubois, Xuechen Li, Carlos Guestrin, Percy Liang, and Tatsunori B. Hashimoto. 2023. Stanford alpaca: An instruction-following llama model. https://github.com/tatsu-lab/stanford_alpaca.
Rohan Taori, Ishaan Gulrajani, Tianyi Zhang, Yann Dubois, Xuechen Li, Carlos Guestrin, Percy Liang, and Tatsunori B. Hashimoto. 2023. Stanford Alpaca: 一个遵循指令的 Llama 模型. https://github.com/tatsu-lab/stanford_alpaca.

Teknium1. 2023. Gpteacher. https://github.com/teknium1/GPTeacher.
Teknium1. 2023. GPTeacher. https://github.com/teknium1/GPTeacher.

Together Computer. 2023. RedPajama: An Open Source Recipe to Reproduce LLaMA training dataset.
Together Computer. 2023. RedPajama: 复现 LLaMA 训练数据集的开源配方.

Hugo Touvron, Thibaut Lavril, Gautier Izacard, Xavier Martinet, Marie-Anne Lachaux, Timothee Lacroix, Baptiste Roziere, Naman Goyal, Eric Hambro, Faisal Azhar, Aurelien Rodriguez, Armand Joulin, Edouard Grave, and Guillaume Lample. 2023a. Llama: Open and efficient foundation language models. ArXiv, abs/2302.13971.
Hugo Touvron, Thibaut Lavril, Gautier Izacard, Xavier Martinet, Marie-Anne Lachaux, Timothee Lacroix, Baptiste Roziere, Naman Goyal, Eric Hambro, Faisal Azhar, Aurelien Rodriguez, Armand Joulin, Edouard Grave, and Guillaume Lample. 2023a. LLaMA: 开放且高效的基础语言模型. ArXiv, abs/2302.13971.

Hugo Touvron, Louis Martin, Kevin Stone, Peter Albert, Amjad Almahairi, Yasmine Babaei, Nikolay Bashlykov, Soumya Batra, Prajjwal Bhargava, Shruti Bhosale, Dan Bikel, Lukas Blecher, Cristian Canton Ferrer, Moya Chen, Guillem Cucurull, David Esiobu, Jude Fernandes, Jeremy Fu, Wenyin Fu, Brian Fuller, Cynthia Gao, Vedanuj Goswami, Naman Goyal, Anthony Hartshorn, Saghar Hosseini, Rui Hou, Hakan Inan, Marcin Kardas, Viktor Kerkez, Madian Khabsa, Isabel Kloumann, Artem Korenev, Punit Singh Koura, Marie-Anne Lachaux, Thibaut Lavril, Jenya Lee, Diana Liskovich, Yinghai Lu, Yuning Mao, Xavier Martinet, Todor Mihaylov, Pushkar Mishra, Igor Molybog, Yixin Nie, Andrew Poulton, Jeremy Reizenstein, Rashi Rungta, Kalyan Saladi, Alan Schelten, Ruan Silva, Eric Michael Smith, Ranjan Subramanian, Xiaoqing Ellen Tan, Binh Tang, Ross Taylor, Adina Williams, Jian Xiang Kuan, Puxin Xu, Zheng Yan, Iliyan Zarov, Yuchen Zhang, Angela Fan, Melanie Kambadur, Sharan Narang, Aurelien Rodriguez, Robert Stojnic, Sergey Edunov, and Thomas Scialom. 2023b. Llama 2: Open foundation and fine-tuned chat models.
Hugo Touvron, Louis Martin, Kevin Stone, Peter Albert, Amjad Almahairi, Yasmine Babaei, Nikolay Bashlykov, Soumya Batra, Prajjwal Bhargava, Shruti Bhosale, Dan Bikel, Lukas Blecher, Cristian Canton Ferrer, Moya Chen, Guillem Cucurull, David Esiobu, Jude Fernandes, Jeremy Fu, Wenyin Fu, Brian Fuller, Cynthia Gao, Vedanuj Goswami, Naman Goyal, Anthony Hartshorn, Saghar Hosseini, Rui Hou, Hakan Inan, Marcin Kardas, Viktor Kerkez, Madian Khabsa, Isabel Kloumann, Artem Korenev, Punit Singh Koura, Marie-Anne Lachaux, Thibaut Lavril, Jenya Lee, Diana Liskovich, Yinghai Lu, Yuning Mao, Xavier Martinet, Todor Mihaylov, Pushkar Mishra, Igor Molybog, Yixin Nie, Andrew Poulton, Jeremy Reizenstein, Rashi Rungta, Kalyan Saladi, Alan Schelten, Ruan Silva, Eric Michael Smith, Ranjan Subramanian, Xiaoqing Ellen Tan, Binh Tang, Ross Taylor, Adina Williams, Jian Xiang Kuan, Puxin Xu, Zheng Yan, Iliyan Zarov, Yuchen Zhang, Angela Fan, Melanie Kambadur, Sharan Narang, Aurelien Rodriguez, Robert Stojnic, Sergey Edunov, and Thomas Scialom. 2023b. Llama 2: 开放的基础与微调聊天模型.

Maria Ubierna, Cristina Diez Santos, and Sara Mercier-Blais. 2022. Water Security and Climate Change: Hydropower Reservoir Greenhouse Gas Emissions, pages 69-94. Springer Singapore, Singapore.
Maria Ubierna, Cristina Diez Santos, and Sara Mercier-Blais. 2022. 水安全与气候变化: 水电水库温室气体排放,第 69-94 页. Springer Singapore, 新加坡.

Ashish Vaswani, Noam Shazeer, Niki Parmar, Jakob Uszkoreit, Llion Jones, Aidan N Gomez, Lukasz Kaiser, and Illia Polosukhin. 2017. Attention is all you need. In Advances in Neural Information Processing Systems, volume 30. Curran Associates, Inc.
Ashish Vaswani, Noam Shazeer, Niki Parmar, Jakob Uszkoreit, Llion Jones, Aidan N Gomez, Lukasz Kaiser, and Illia Polosukhin. 2017. 注意力机制就是你所需要的一切. 载于神经信息处理系统进展,第 30 卷. Curran Associates, Inc.

David Vilares and Carlos Gomez-Rodriguez. 2019. HEAD-QA: A healthcare dataset for complex reasoning. In Proceedings of the 57th Annual Meeting of the Association for Computational Linguistics, pages 960-966, Florence, Italy. Association for Computational Linguistics.
David Vilares and Carlos Gomez-Rodriguez. 2019. HEAD-QA: 一个用于复杂推理的医疗保健数据集. 载于计算语言学协会第 57 届年会论文集,第 960-966 页,意大利佛罗伦萨. 计算语言学协会.



Alex Wang, Amanpreet Singh, Julian Michael, Felix Hill, Omer Levy, and Samuel R. Bowman. 2018. Glue: A multi-task benchmark and analysis platform for natural language understanding. ArXiv, abs/1804.07461.
Alex Wang, Amanpreet Singh, Julian Michael, Felix Hill, Omer Levy, and Samuel R. Bowman. 2018. GLUE: 一个用于自然语言理解的多任务基准与分析平台. ArXiv, abs/1804.07461.

Yizhong Wang, Hamish Ivison, Pradeep Dasigi, Jack Hessel, Tushar Khot, Khyathi Raghavi Chandu, David Wadden, Kelsey MacMillan, Noah A. Smith, Iz Beltagy, and Hannaneh Hajishirzi. 2023. How far can camels go? exploring the state of instruction tuning on open resources.
Yizhong Wang, Hamish Ivison, Pradeep Dasigi, Jack Hessel, Tushar Khot, Khyathi Raghavi Chandu, David Wadden, Kelsey MacMillan, Noah A. Smith, Iz Beltagy, and Hannaneh Hajishirzi. 2023. 骆驼能走多远? 探索开放资源上的指令微调现状.

Jason Wei, Maarten Bosma, Vincent Zhao, Kelvin Guu, Adams Wei Yu, Brian Lester, Nan Du, Andrew M. Dai, and Quoc V Le. 2022. Finetuned language models are zero-shot learners. In International Conference on Learning Representations.
Jason Wei, Maarten Bosma, Vincent Zhao, Kelvin Guu, Adams Wei Yu, Brian Lester, Nan Du, Andrew M. Dai, and Quoc V Le. 2022. 微调语言模型是零样本学习者. 载于国际学习表征会议.

Johannes Welbl, Nelson F Liu, and Matt Gardner. 2017. Crowdsourcing multiple choice science questions. arXiv preprint arXiv:1707.06209.
Johannes Welbl, Nelson F Liu, and Matt Gardner. 2017. 众包多选科学问题. arXiv 预印本 arXiv:1707.06209.

Carole-Jean Wu, Ramya Raghavendra, Udit Gupta, Bilge Acun, Newsha Ardalani, Kiwan Maeng, Gloria Chang, Fiona Aga Behram, James Huang, Charles Bai, Michael Gschwind, Anurag Gupta, Myle Ott, Anastasia Melnikov, Salvatore Candido, David Brooks, Geeta Chauhan, Benjamin Lee, Hsien-Hsin S. Lee, Bugra Akyildiz, Maximilian Balandat, Joe Spisak, Ravi Jain, Mike Rabbat, and Kim Hazelwood. 2022. Sustainable ai: Environmental implications, challenges and opportunities.
Carole-Jean Wu, Ramya Raghavendra, Udit Gupta, Bilge Acun, Newsha Ardalani, Kiwan Maeng, Gloria Chang, Fiona Aga Behram, James Huang, Charles Bai, Michael Gschwind, Anurag Gupta, Myle Ott, Anastasia Melnikov, Salvatore Candido, David Brooks, Geeta Chauhan, Benjamin Lee, Hsien-Hsin S. Lee, Bugra Akyildiz, Maximilian Balandat, Joe Spisak, Ravi Jain, Mike Rabbat, and Kim Hazelwood. 2022. 可持续 AI: 环境影响、挑战与机遇.

Can Xu, Qingfeng Sun, Kai Zheng, Xiubo Geng, Pu Zhao, Jiazhan Feng, Chongyang Tao, Qingwei Lin, and Daxin Jiang. 2024. WizardLM: Empowering large pre-trained language models to follow complex instructions. In The Twelfth International Conference on Learning Representations.
Can Xu, Qingfeng Sun, Kai Zheng, Xiubo Geng, Pu Zhao, Jiazhan Feng, Chongyang Tao, Qingwei Lin, and Daxin Jiang. 2024. WizardLM: 赋能大型预训练语言模型遵循复杂指令. 载于第十二届国际学习表征会议.

Canwen Xu, Daya Guo, Nan Duan, and Julian McAuley. 2023. Baize: An open-source chat model with parameter-efficient tuning on self-chat data. arXiv preprint arXiv:2304.01196.
Canwen Xu, Daya Guo, Nan Duan, and Julian McAuley. 2023. Baize: 一个在自聊天数据上进行参数高效微调的开源聊天模型. arXiv 预印本 arXiv:2304.01196.

Savvas Zannettou, Barry Bradlyn, Emiliano De Cristofaro, Haewoon Kwak, Michael Sirivianos, Gianluca Stringini, and Jeremy Blackburn. 2018. What is gab: A bastion of free speech or an alt-right echo chamber. In Companion Proceedings of the The Web Conference 2018, WWW '18, page 1007-1014, Republic and Canton of Geneva, CHE. International World Wide Web Conferences Steering Committee.
Savvas Zannettou, Barry Bradlyn, Emiliano De Cristofaro, Haewoon Kwak, Michael Sirivianos, Gianluca Stringini, and Jeremy Blackburn. 2018. Gab 是什么: 言论自由的堡垒还是另类右翼的回音室. 载于 2018 年万维网会议配套论文集, WWW '18,第 1007-1014 页,瑞士日内瓦共和国与国际组织州. 国际万维网会议指导委员会.

Rowan Zellers, Ari Holtzman, Yonatan Bisk, Ali Farhadi, and Yejin Choi. 2019. Hellaswag: Can a machine really finish your sentence? arXiv preprint arXiv:1905.07830.
Rowan Zellers, Ari Holtzman, Yonatan Bisk, Ali Farhadi, and Yejin Choi. 2019. HellaSwag: 机器真的能补全你的句子吗? arXiv 预印本 arXiv:1905.07830.

Biao Zhang and Rico Sennrich. 2019. Root mean square layer normalization. ArXiv, abs/1910.07467.
Biao Zhang and Rico Sennrich. 2019. 均方根层归一化(Root Mean Square Layer Normalization). ArXiv, abs/1910.07467.

Susan Zhang, Stephen Roller, Naman Goyal, Mikel Artetxe, Moya Chen, Shuohui Chen, Christopher Dewan, Mona Diab, Xian Li, Xi Victoria Lin, Todor Mihaylov, Myle Ott, Sam Shleifer, Kurt Shuster, Daniel Simig, Punit Singh Koura, Anjali Sridhar, Tianlu Wang, and Luke Zettlemoyer. 2022. Opt: Open pre-trained transformer language models.
Susan Zhang, Stephen Roller, Naman Goyal, Mikel Artetxe, Moya Chen, Shuohui Chen, Christopher Dewan, Mona Diab, Xian Li, Xi Victoria Lin, Todor Mihaylov, Myle Ott, Sam Shleifer, Kurt Shuster, Daniel Simig, Punit Singh Koura, Anjali Sridhar, Tianlu Wang, and Luke Zettlemoyer. 2022. OPT: 开放预训练 Transformer 语言模型.

Yanli Zhao, Andrew Gu, Rohan Varma, Liangchen Luo, Chien chin Huang, Min Xu, Less Wright, Hamid Shojanazeri, Myle Ott, Sam Shleifer, Alban Desmaison, Can Balioglu, Bernard Nguyen, Geeta Chauhan, Yuchen Hao, and Shen Li. 2023. Pytorch fsdp: Experiences on scaling fully sharded data parallel. Proc. VLDB Endow., 16:3848-3860.
Yanli Zhao, Andrew Gu, Rohan Varma, Liangchen Luo, Chien chin Huang, Min Xu, Less Wright, Hamid Shojanazeri, Myle Ott, Sam Shleifer, Alban Desmaison, Can Balioglu, Bernard Nguyen, Geeta Chauhan, Yuchen Hao, and Shen Li. 2023. PyTorch FSDP: 扩展全分片数据并行的经验. Proc. VLDB Endow., 16:3848-3860.



## A 训练设置

Table 5 summarizes the model architecture and the optimizer parameters of OLMo-7B as well as recent similar-sized models.
表 5 总结了 OLMo-7B 的模型架构与优化器参数,以及近期同规模模型的参数.

## B 能耗与碳足迹

Following previous literature (Strubell et al., 2019; Patterson et al., 2021; Wu et al., 2022; Dodge et al., 2022), we estimate the total energy consumed and carbon released while pretraining our models by calculating the total power consumption required for training, and then multiplying it by the carbon emission intensity of the power grid where the model was trained. While reporting these operational emissions is standard practice, it does not account for other sources of emissions such as the embodied emissions due to the manufacturing, transportation, and disposal of hardware and datacenter infrastructure, lifetime operational emissions due to use, rebound effects, or other environmental impacts such as water consumption or mining. Thus our estimates should be viewed as lower bounds.
遵循先前文献 (Strubell et al., 2019; Patterson et al., 2021; Wu et al., 2022; Dodge et al., 2022),我们通过计算训练所需的总功耗,再乘以模型训练所在地电网的碳排放强度,来估算预训练模型期间消耗的总能量与释放的碳. 尽管报告这些运营排放是标准做法,但它并未考虑其他排放来源,如硬件与数据中心基础设施的制造、运输和处置所产生的隐含排放、使用导致的终身运营排放、反弹效应,或其他环境影响如水资源消耗或矿产开采. 因此,我们的估计应被视为下限.

We calculate the total power consumption for our models by measuring the power consumption of a single node every 25ms, calculating an average across the entire training run, and multiplying by the total number of nodes. We then account for the energy efficiency of the data center by multiplying the previous total by a power usage effectiveness (PUE) factor, which we set to 1.1, representing a conservative 10% energy consumption overhead typical of energy efficient datacenters.10 11 We estimate that pretraining our 7B models consumed 239 MWh of energy.
我们通过每 25 毫秒测量单个节点的功耗,计算整个训练运行的平均值,再乘以节点总数,来得出模型的总功耗. 然后,我们通过将前述总和乘以数据中心能源效率系数——即电能使用效率(Power Usage Effectiveness, PUE),我们将其设为 1.1,代表能效数据中心典型的保守 10% 能耗开销——来考虑数据中心的能源效率. 我们估计预训练我们的 7B 模型消耗了 239 MWh 的能量.

To calculate carbon emissions, we multiply the total power consumption by a carbon intensity factor, measured in kg CO2 emitted per KWh, based on the physical location of the data center where each model was trained. The model trained on A100-40GB GPUs was trained in Australia, so we assume a carbon intensity factor of 0.610, the national average for Australia in 2022.12 The model trained on MI250X GPUs was trained in the LUMI supercomputer, which runs on 100% renewable, carbon-neutral energy, so we assume a carbon intensity factor of 0. LUMI is powered entirely by hydroelectric power and some sources (Ubierna et al., 2022) measure the carbon intensity factor of hydroelectric power to be 0.024, which would imply total carbon emissions of 3.54 tCO2eq.13 However, we rely on the official LUMI data for our calculations, and thus we estimate total pretraining emissions of 69.78 tCO2eq.14 In Table 6 we compare our models with other previously released models based on publicly available information.
为了计算碳排放,我们将总功耗乘以碳强度因子(以每千瓦时排放的二氧化碳千克数计),该因子基于每个模型训练所用数据中心的实际地理位置. 在 A100-40GB GPU 上训练的模型在澳大利亚训练,因此我们假设碳强度因子为 0.610,即 2022 年澳大利亚的全国平均值. 在 MI250X GPU 上训练的模型在 LUMI 超级计算机上训练,该计算机使用 100% 可再生、碳中和能源运行,因此我们假设碳强度因子为 0. LUMI 完全由水力发电供电,一些来源 (Ubierna et al., 2022) 测得水力发电的碳强度因子为 0.024,这意味着总碳排放量为 3.54 tCO2eq. 然而,我们在计算中依赖 LUMI 的官方数据,因此我们估计总预训练排放量为 69.78 tCO2eq. 在表 6 中,我们基于公开可用信息将我们的模型与其他先前发布的模型进行了比较.

We hope that openly releasing our models can reduce future emissions by allowing others to avoid the need to pretrain models from scratch, and give insights into the true cost of developing state of the art models. We also highlight that our estimates are lower bounds, because they do not include other critical pieces of development such as debugging, hyperparameter tuning, and downtime.
我们希望,通过公开释放我们的模型,可以让其他人避免从头预训练模型的需求,从而减少未来的排放,并揭示开发最先进模型的真实成本. 我们还强调,我们的估计是下限,因为它们不包括其他关键开发环节,如调试、超参数调优和停机时间.

## C 额外评估

### 额外困惑度结果

In Figure 3 we provide results for each of the 7 data sources in Paloma (Magnusson et al., 2023) that are excluded from the combined metric in Figure 2. Some of these sources such as Pile (Gao et al., 2020) and ICE (Greenbaum and Nelson, 1996) are not publicly available at this time. Dolma 100 Programming Languages (Soldaini et al., 2024) consists of code data that is not supported by the decontamination approach used in Paloma. TwitterAAE (Blodgett et al., 2016), along with ICE, are datasets for targeted analyses of disparities in performance between different dialects and as such should be evaluated separately. And finally, the Manosphere, Gab, and 4chan corpora (Ribeiro et al., 2021; Zannettou et al., 2018; Papasavva et al., 2020) are intended to examine model fit to language from fringe online communities that are studied for prevalent hate speech and toxicity. Thus minimizing perplexity on these fringe corpora is not always desirable.
在图 3 中,我们提供了 Paloma (Magnusson et al., 2023) 中被排除在图 2 综合指标之外的 7 个数据来源各自的结果. 其中一些来源,如 Pile (Gao et al., 2020) 和 ICE (Greenbaum and Nelson, 1996),目前不公开可用. Dolma 100 Programming Languages (Soldaini et al., 2024) 包含 Paloma 去污染方法不支持的代码数据. TwitterAAE (Blodgett et al., 2016) 与 ICE 一样,是用于针对性分析不同方言之间性能差异的数据集,因此应单独评估. 最后,Manosphere、Gab 和 4chan 语料库 (Ribeiro et al., 2021; Zannettou et al., 2018; Papasavva et al., 2020) 旨在检验模型对来自边缘在线社区的语言的拟合程度,这些社区因普遍存在仇恨言论和毒性内容而被研究. 因此,在这些边缘语料库上最小化困惑度并不总是可取的.

One notable result here is that OLMo-7B is much farther ahead of the other models on Dolma 100 Programming Languages (100 PLs). Note that this effect may be due in part to underestimation from contamination, as decontaminating code data is beyond the scope of the method in Paloma. At the same time other models that are trained on code data from GitHub such as RPJ-INCITE-7B, that are just as likely to have contamination, fair much worse. Another factor then is that OLMo-7B trains on code data with exactly the same post-processing as that in 100 PLs while the code data in other models will have been processed differently. Similarly, Pile evaluation demonstrates these in-distribution and potential contamination effects as Pythia-6.9B achieves top performance despite being trained on almost an order of magnitude fewer tokens than OLMo-7B.
此处一个显著的结果是,OLMo-7B 在 Dolma 100 Programming Languages (100 PLs) 上远远领先于其他模型. 需要注意的是,这种效应可能部分源于污染导致的低估,因为对代码数据进行去污染超出了 Paloma 方法的范围. 与此同时,其他在 GitHub 代码数据上训练的模型(如 RPJ-INCITE-7B)同样可能存在污染,但表现却差得多. 另一个因素是,OLMo-7B 训练的代码数据与 100 PLs 中的后处理完全相同,而其他模型中的代码数据则可能经过了不同的处理. 类似地,Pile 评估也展示了这种分布内与潜在污染效应:Pythia-6.9B 尽管在比 OLMo-7B 少几乎一个数量级的词元上训练,却取得了最佳性能.



| 维度 (Dimension) | OLMo-7B | LLaMA2-7B | OpenLM-7B | Falcon-7B | PaLM-8B |
|---|---|---|---|---|---|
| 维度 (Dimension) | 4096 | 4096 | 4096 | 4544 | 4096 |
| 注意力头数 (Num heads) | 32 | 32 | 32 | 71 | 16 |
| 层数 (Num layers) | 32 | 32 | 32 | 32 | 32 |
| MLP 比例 (MLP ratio) | ~8/3 | ~8/3 | ~8/3 | 4 | 4 |
| 归一化类型 (Layer norm type) | non-parametric | RMSNorm | parametric | parametric | parametric |
| 位置编码 (Positional embeddings) | RoPE | RoPE | RoPE | RoPE | RoPE |
| 注意力变体 (Attention variant) | full | GQA | full | MQA | MQA |
| 偏置 (Biases) | none | none | in LN only | in LN only | none |
| 块类型 (Block type) | sequential | sequential | sequential | parallel | parallel |
| 激活函数 (Activation) | SwiGLU | SwiGLU | SwiGLU | GeLU | SwiGLU |
| 序列长度 (Sequence length) | 2048 | 4096 | 2048 | 2048 | 2048 |
| 批次大小(实例数) (Batch size (instances)) | 2160 | 1024 | 2048 | 2304 | 512 |
| 批次大小(词元数) (Batch size (tokens)) | ~4M | ~4M | ~4M | ~4M | ~1M |
| 权重共享 (Weight tying) | no | no | no | no | yes |
| 预热步数 (Warmup steps) | 5000 | 2000 | 2000 | 1000 | |
| 峰值学习率 (Peak LR) | 3.0E-04 | 3.0E-04 | 3.0E-04 | 6.0E-04 | |
| 最小学习率 (Minimum LR) | 3.0E-05 | 3.0E-05 | 3.0E-05 | 1.2E-05 | |
| 权重衰减 (Weight decay) | 0.1 | 0.1 | 0.1 | 0.1 | |
| Beta1 | 0.9 | 0.9 | 0.9 | 0.99 | |
| Beta2 | 0.95 | 0.95 | 0.95 | 0.999 | |
| Epsilon | 1.0E-05 | 1.0E-05 | 1.0E-05 | 1.0E-05 | |
| 学习率调度 (LR schedule) | linear | cosine | cosine | cosine | |
| 梯度裁剪 (Gradient clipping) | global 1.0 | global 1.0 | global 1.0 | global 1.0 | |
| 梯度规约精度 (Gradient reduce dtype) | FP32 | FP32 | FP32 | BF16 | |
| 优化器状态精度 (Optimizer state dtype) | FP32 | most likely FP32 | FP32 | FP32 | |

Table 5: LM architecture and optimizer comparison at the 7-8B scale. In the "layer norm type" row, "parametric" and "non-parametric" refer to the usual layer norm implementation with and without adaptive gain and bias, respectively. All models are trained using AdamW.
表 5: 7-8B 规模语言模型架构与优化器比较. 在"归一化类型"一行中,"参数化"(parametric)和"非参数化"(non-parametric)分别指通常带有和不带有自适应增益与偏置的层归一化实现. 所有模型均使用 AdamW 训练.

The results on the remaining 5 targeted sources should be interpreted with care, as Paloma often finds that perplexity on these sources is dominated by superficial features such as low average document length rather than fit to that which would actually be salient to members of these speech communities. TwitterAAE and Gab have among the shortest documents in Paloma contributing to unusually high bits per byte in this figure. Other than these two, the models are notably very closely grouped in a data scaling trend in ICE, Manosphere, and 4chan.
剩余 5 个针对性来源的结果应谨慎解读,因为 Paloma 经常发现,这些来源上的困惑度受表面特征主导,如平均文档长度较短,而非对这些语言社区成员真正显著的拟合程度. TwitterAAE 和 Gab 拥有 Paloma 中最短的文档,导致此图中每字节比特数异常高. 除这两者外,模型在 ICE、Manosphere 和 4chan 上明显紧密聚集在数据扩展趋势中.

### 额外末端任务结果

Next, in Table 7, we provide results from zero-shot evaluation of OLMo-7B on 6 additional end-tasks apart from the 8 in our core evaluation suite. These tasks are headqa_en (Vilares and Gomez-Rodriguez, 2019), logiqa (Liu et al., 2020), mrpc (Dolan and Brockett, 2005), qnli (Wang et al., 2018), wic (Pilehvar and Camacho-Collados, 2018), and wnli (Wang et al., 2018).
接下来,在表 7 中,我们提供了 OLMo-7B 在核心评估套件之外 6 个额外末端任务上的零样本评估结果. 这些任务是 headqa_en (Vilares and Gomez-Rodriguez, 2019)、logiqa (Liu et al., 2020)、mrpc (Dolan and Brockett, 2005)、qnli (Wang et al., 2018)、wic (Pilehvar and Camacho-Collados, 2018) 和 wnli (Wang et al., 2018).

We note, however, that in contrast to our core evaluation set described in Section 4.1, we found these additional end-tasks to have less stable performance during model development, and to provide a limited signal. This is illustrated in Figure 4, where we see the progress of task performance throughout training to be more random (compare with the more stable upward trends in Figure 1). While tasks such as mrpc and wic appear more stable, they offered additional difficulties related to performance being tied to random chance (e.g., wic) or the tendency of models to make spurious predictions (e.g., always predicting a single label) that either inflate or deflate performance due to dataset class imbalances (e.g., mrpc). We therefore caution against relying too heavily on these tasks when measuring model performance throughout training and comparing models.
然而,我们注意到,与第 4.1 节描述的核心评估集相比,我们发现这些额外末端任务在模型开发过程中性能较不稳定,且提供的信号有限. 图 4 展示了这一点,其中我们可以看到任务性能在训练过程中的进展更为随机(与图 1 中更稳定的上升趋势相比). 虽然 mrpc 和 wic 等任务看起来较稳定,但它们带来了额外的困难,例如性能与随机机会相关(如 wic),或模型倾向于做出虚假预测(如总是预测单一标签),这会导致因数据集类别不平衡而夸大或压低性能(如 mrpc). 因此,我们 caution 在衡量训练过程中的模型性能及比较模型时,不要过度依赖这些任务.



| 模型 (Model) | GPU 类型 (GPU Type) | GPU 功耗 (MWh) | 电能使用效率 (PUE) | 碳强度 (kg CO2e/KWh) | 碳排放 (tCO2eq) |
|---|---|---|---|---|---|
| Gopher-280B | TPU v3 | 1,066 | 1.08 | 0.330 | 380 |
| BLOOM-176B | A100-80GB | 433 | 1.2 | 0.057 | 30 |
| OPT-175B | A100-80GB | 324 | 1.1 | 0.231 | 82 |
| T5-11B | TPU v3 | 77 | 1.12 | 0.545 | 47 |
| LLaMA-7B | A100-80GB | 33 | 1.1 | 0.385 | 14 |
| LLaMA2-7B | A100-80GB | 74 | 1.1 | 0.385 | 31 |
| OLMo-7B | MI250X | 135 | 1.1 | 0.000* | 0* |
| OLMo-7B | A100-40GB | 104 | 1.1 | 0.610 | 70 |

Table 6: CO2 emissions during pretraining. We estimate the total carbon emissions for various models using publicly available data on PUE, carbon intensity of local power grid, and reported power consumption. Numbers for Gopher-280B (Rae et al., 2022), BLOOM-176B (Luccioni et al., 2022), OPT-175B (Zhang et al., 2022), T5-11B (Patterson et al., 2021), LLaMA (Touvron et al., 2023a), and LLaMA2 (Touvron et al., 2023b) are taken from their respective papers. See Section B for details on how tCO2eq was calculated.
表 6: 预训练期间的二氧化碳排放. 我们使用公开可用的 PUE 数据、当地电网碳强度以及报告的功耗来估算各模型的总碳排放. Gopher-280B (Rae et al., 2022)、BLOOM-176B (Luccioni et al., 2022)、OPT-175B (Zhang et al., 2022)、T5-11B (Patterson et al., 2021)、LLaMA (Touvron et al., 2023a) 和 LLaMA2 (Touvron et al., 2023b) 的数据来自各自的论文. 关于 tCO2eq 计算方法的详细信息,请参见第 B 节.

* LUMI runs entirely on hydroelectric power13 and some estimates (Ubierna et al., 2022) measure the intensity factor of hydroelectric power to be 0.024, implying total emissions of 3.54 tCO2eq.
* LUMI 完全由水力发电运行,一些估计 (Ubierna et al., 2022) 测得水力发电的强度因子为 0.024,意味着总排放量为 3.54 tCO2eq.

| 模型 (Model) | headqa_en | logiqa | mrpc | qnli | wic | wnli | 平均 (avg.) |
|---|---|---|---|---|---|---|---|
| Falcon-7B | 38.6 | 23.7 | 62.8 | 49.8 | 49.5 | 47.9 | 45.4 |
| LLaMA-7B | 38.7 | 19.5 | 68.6 | 50.1 | 49.1 | 52.1 | 46.4 |
| LLaMA2-7B | 39.5 | 26.1 | 69.1 | 49.4 | 49.8 | 45.1 | 46.5 |
| MPT-7B | 37.4 | 22.9 | 67.7 | 52.1 | 48.1 | 47.9 | 46.0 |
| Pythia-6.9B | 40.1 | 21.5 | 65.4 | 53.8 | 55.0 | 38.0 | 45.6 |
| RPJ-INCITE-7B | 36.9 | 27.8 | 58.8 | 53.8 | 48.9 | 57.8 | 47.3 |
| OLMo-7B | 37.3 | 23.4 | 68.4 | 49.1 | 50.2 | 56.3 | 47.5 |

Table 7: Zero-shot evaluation of OLMo-7B on 6 additional end-tasks apart from the 8 present in our core evaluation suite. Once again, we compare OLMo-7B to 6 other model checkpoints which are publicly available. We find that OLMo-7B outperforms the other models on aggregate taken over 6 additional end-tasks from this table, however these tasks were also found to provide limited signal during training (see Figure 4).
表 7: OLMo-7B 在核心评估套件之外的 6 个额外末端任务上的零样本评估. 我们再次将 OLMo-7B 与 6 个其他公开可用的模型检查点进行比较. 我们发现,就本表中 6 个额外末端任务的总体表现而言,OLMo-7B 优于其他模型,然而这些任务在训练过程中也被发现提供的信号有限(见图 4).

## D 适配训练细节

We use the following hyperparameters when instruction tuning OLMo. These were chosen through small pilot experiments.
在对 OLMo 进行指令微调时,我们使用以下超参数. 这些参数是通过小型试点实验选择的.

- Learning rate: 2 x 10^-6
- 学习率: 2 x 10^-6

- Epochs: 3
- 轮次: 3

- Warmup: Linear warmup for the first 3% of total training time, and then linear cooldown to a learning rate of 0 over the remaining steps.
- 预热: 在总训练时间的前 3% 内进行线性预热,然后在剩余步骤中线性冷却至学习率为 0.

- Weight decay: 0
- 权重衰减: 0

- Gradient clipping: 0
- 梯度裁剪: 0

- Maximum sequence length: 2048
- 最大序列长度: 2048

- Data: TULU V2 SFT mix, resplit such that long conversations are split into 2048-token chunks and replacing the hardcoded split with data about OLMo. Data is publically available.14
- 数据: TULU V2 SFT 混合数据,重新分割以使长对话被分割为 2048 词元的片段,并将硬编码的分割替换为关于 OLMo 的数据. 数据公开可用.

After instruction finetuning, we then use the following hyperparameters for DPO training, following Ivison et al. (2023):
在指令微调之后,我们按照 Ivison et al. (2023) 使用以下超参数进行 DPO 训练:

- Learning rate: 5 x 10^-7
- 学习率: 5 x 10^-7

- beta: 0.1
- beta: 0.1

- Epochs: 3
- 轮次: 3

- Warmup: Linear warmup for the first 10% of total training time, and then linear cooldown to a learning rate of 0 over the remaining steps.
- 预热: 在总训练时间的前 10% 内进行线性预热,然后在剩余步骤中线性冷却至学习率为 0.

- Weight decay: 0
- 权重衰减: 0

- Gradient clipping: 0
- 梯度裁剪: 0




Figure 3: Bits per byte for each of the 7 remaining Paloma data sources not aggregated in Figure 2.
图 3: 图 2 中未聚合的剩余 7 个 Paloma 数据来源各自的每字节比特数.

Figure 4: Accuracy score progression of OLMo-7B on 6 additional end-tasks. The performance of these additional end-tasks was unstable and provided limited signal during model development.
图 4: OLMo-7B 在 6 个额外末端任务上的准确率得分变化. 这些额外末端任务的性能不稳定,在模型开发过程中提供的信号有限.

- Maximum sequence length: 2048
- 最大序列长度: 2048

- Data: A modified form of UltraFeedback (Cui et al., 2023), with TruthfulQA prompts removed. We used the 'fixed' variant released by Argilla, which uses the average of GPT-generated aspect-based scores to determine chosen and rejected pairs.15
- 数据: UltraFeedback (Cui et al., 2023) 的修改形式,移除了 TruthfulQA 提示. 我们使用了 Argilla 发布的"fixed"变体,该变体使用 GPT 生成的基于方面的分数平均值来确定被选中的和被拒绝的配对.



## E 适配评估与模型细节

We choose the models in Table 4 by choosing the 'canonical' best versions (that is, the best instruction-tuned or otherwise adapted models released by the same organisation) of the base models we compare against in Table 3. We additionally compare to TULU 2 to show the current best models trained using the TULU mix used to finetune OLMo. We display evaluations on MMLU, AlpacaEval, ToxiGen, and Truthfulness to focus on displaying how instruction tuning can generally help capabilities (MMLU), how the models perform in an open-ended chat setting (AlpacaEval), and to test how instruction tuning aids in model safety and truthfulness (AlpacaEval, ToxiGen). We additionally report OLMo's performance over the entire TULU evaluation suite in Table 8.
我们通过选择表 3 中对比的基座模型的"规范"最佳版本(即同一组织发布的最佳指令微调或其他适配模型)来确定表 4 中的模型. 我们还与 TULU 2 进行比较,以展示使用用于微调 OLMo 的 TULU 数据混合训练的当前最佳模型. 我们展示 MMLU、AlpacaEval、ToxiGen 和 Truthfulness 的评估,以聚焦于展示指令微调通常如何帮助提升能力(MMLU)、模型在开放式对话场景中的表现(AlpacaEval),以及测试指令微调如何帮助提升模型的安全性与真实性(AlpacaEval, ToxiGen). 此外,我们在表 8 中报告了 OLMo 在整个 TULU 评估套件上的表现.

We provide a brief description of each model evaluated in Table 4 below. For all models, we use the provided chat template for prompt formatting when available.
我们在下面简要描述表 4 中评估的每个模型. 对于所有模型,我们在可用时使用提供的聊天模板进行提示格式化.

- MPT Chat: A version of MPT 7B fine-tuned on the ShareGPT-Vicuna (Chiang et al., 2023), HC3 (Guo et al., 2023), Alpaca (Taori et al., 2023), HH-RLHF (Bai et al., 2022), and Evol-Instruct (Xu et al., 2024) datasets. Retrieved from https://huggingface.co/mosaicml/mpt-7b-chat.
- MPT Chat: 在 ShareGPT-Vicuna (Chiang et al., 2023)、HC3 (Guo et al., 2023)、Alpaca (Taori et al., 2023)、HH-RLHF (Bai et al., 2022) 和 Evol-Instruct (Xu et al., 2024) 数据集上微调的 MPT 7B 版本. 取自 https://huggingface.co/mosaicml/mpt-7b-chat.

- Falcon Instruct: A version of Falcon 7B finetuned on the Baize (Xu et al., 2023), GPT4All (Anand et al., 2023), GPTeacher (Teknium1, 2023), and Refined-Web English (Penedo et al., 2023) datasets. Retrieved from https://huggingface.co/tiiuae/falcon-7b-instruct.
- Falcon Instruct: 在 Baize (Xu et al., 2023)、GPT4All (Anand et al., 2023)、GPTeacher (Teknium1, 2023) 和 Refined-Web English (Penedo et al., 2023) 数据集上微调的 Falcon 7B 版本. 取自 https://huggingface.co/tiiuae/falcon-7b-instruct.

- RPJ-INCITE Chat: A version of RPJ-INCITE 7B finetuned on the OASST1 (Kopf et al., 2023) and Dolly V2 (Conover et al., 2023) datasets. Retrieved from https://huggingface.co/togethercomputer/RedPajama-INCITE-7B-Chat.
- RPJ-INCITE Chat: 在 OASST1 (Kopf et al., 2023) 和 Dolly V2 (Conover et al., 2023) 数据集上微调的 RPJ-INCITE 7B 版本. 取自 https://huggingface.co/togethercomputer/RedPajama-INCITE-7B-Chat.

- Llama-2 Chat: A version of Llama 2 7B fine-tuned on a mixture of instruction datasets and further trained with RLHF. We refer the reader to Touvron et al. (2023b) for further details.
- Llama-2 Chat: 在指令数据集混合上微调并进一步使用 RLHF 训练的 Llama 2 7B 版本. 详细内容请参阅 Touvron et al. (2023b).

- TULU 2: A version of Llama 2 7B finetuned on a mixture of instruction datasets (the TULU 2 mix). We refer the reader to Ivison et al. (2023) for further details.
- TULU 2: 在指令数据集混合(TULU 2 混合)上微调的 Llama 2 7B 版本. 详细内容请参阅 Ivison et al. (2023).

- TULU 2+DPO: TULU 2 further trained with DPO on the UltraFeedback dataset (Cui et al., 2023). We refer the reader to Ivison et al. (2023) for further details.
- TULU 2+DPO: 在 UltraFeedback 数据集 (Cui et al., 2023) 上进一步使用 DPO 训练的 TULU 2. 详细内容请参阅 Ivison et al. (2023).

- OLMo+SFT: A version of OLMo 7B fintuned on the same data as TULU 2.
- OLMo+SFT: 在与 TULU 2 相同数据上微调的 OLMo 7B 版本.

- OLMo+SFT+DPO: OLMo+SFT further trained with DPO on the UltraFeedback dataset (Cui et al., 2023).
- OLMo+SFT+DPO: 在 UltraFeedback 数据集 (Cui et al., 2023) 上进一步使用 DPO 训练的 OLMo+SFT.

We additionally provide a brief description of each evaluation setting from Table 4:
我们还提供了表 4 中每个评估设置的简要描述:

- MMLU: We use the official MMLU (Hendrycks et al., 2021) evaluation script and prompts available at https://github.com/hendrycks/test, with modifications to allow for batch processing. We evaluate using 0 few-shot examples, following the original setup of MMLU. We report average accuracy across test examples.
- MMLU: 我们使用官方 MMLU (Hendrycks et al., 2021) 评估脚本和提示,可在 https://github.com/hendrycks/test 获取,并进行了修改以支持批处理. 我们遵循 MMLU 的原始设置,使用 0 个少样本示例进行评估. 我们报告测试示例上的平均准确率.

- ToxiGen: We follow the setup in Touvron et al. (2023b), but use the original set of prompts from Hartvigsen et al. (2022), which are designed to elicit toxic generations for certain groups. We take only the prompts designed to produce toxic language ('hateful' prompts) and use 500 prompts per group to reduce evaluation costs. For base language models, we pass in the original ToxiGen prompts unchanged and greedily decode up to the first new line (or a maximum of 512 tokens). For instruction-tuned models, we place the prompt in the corresponding template, and ask the model to complete the prompt, until the model generates a stop token (or a maximum of 512 tokens). We pass the generated text into a roberta-large model trained to detect toxic content finetuned as part of Hartvigsen et al. (2022).16 We then report the percentage of generations deemed toxic by the classifier.
- ToxiGen: 我们遵循 Touvron et al. (2023b) 的设置,但使用 Hartvigsen et al. (2022) 的原始提示集,这些提示旨在诱导针对特定群体的毒性生成. 我们仅使用旨在产生有毒语言("仇恨"提示)的提示,每组使用 500 个提示以降低评估成本. 对于基座语言模型,我们直接输入原始 ToxiGen 提示,并以贪婪解码方式生成至第一个新行(或最多 512 个词元). 对于指令微调模型,我们将提示放入相应的模板中,并要求模型补全提示,直到模型生成停止词元(或最多 512 个词元). 我们将生成的文本输入到一个 roberta-large 模型中,该模型经过训练以检测毒性内容,作为 Hartvigsen et al. (2022) 的一部分进行了微调. 然后我们报告被分类器判定为有毒的生成百分比.

- TruthfulQA: Following Touvron et al. (2023b), we mainly use the generation setting of TruthfulQA (Lin et al., 2022). The TruthfulQA dataset contains 818 questions, which are used to prompt the tested model to generate answers. We use the default QA prompt format with 6 in-context QA examples. We follow the official script in their official implemention17 to do greedy decoding and answer postprocessing. We train two LLaMA 2-based classifiers for judging the truthfulness and informativeness of the model response, due to the deprecation of GPT-3 making exact replication of the original TruthfulQA evaluation infeasible. We find that the LLaMA 2 judges are generally able to match the performance of the original GPT-3-based judges used by Lin et al. (2022). We report the rate of the responses being truthful and informative (% Informative and Truthful) following Touvron et al. (2023b). We only report the % Informative and Truthful as our primary metric.
- TruthfulQA: 遵循 Touvron et al. (2023b),我们主要使用 TruthfulQA (Lin et al., 2022) 的生成设置. TruthfulQA 数据集包含 818 个问题,用于提示被测模型生成答案. 我们使用默认的 QA 提示格式,包含 6 个上下文内 QA 示例. 我们遵循其官方实现中的官方脚本进行贪婪解码和答案后处理. 由于 GPT-3 的弃用使得精确复现原始 TruthfulQA 评估不可行,我们训练了两个基于 LLaMA 2 的分类器来判断模型回答的真实性与信息性. 我们发现 LLaMA 2 评判器通常能够达到 Lin et al. (2022) 使用的原始基于 GPT-3 的评判器的性能水平. 我们按照 Touvron et al. (2023b) 报告回答真实且信息丰富的比率(% Informative and Truthful). 我们仅将 % Informative and Truthful 作为主要指标报告.




| 模型 (Model) | MMLU 0-shot | GSM8k 8-shot CoT | BBH 3-shot CoT | TydiQA 1-shot | Codex-Eval Pass@10 | AlpacaEval %win | ToxiGen % Toxic | TruthfulQA % Info + True |
|---|---|---|---|---|---|---|---|---|
| OLMo-7B | 28.3 | 8.5 | 31.7 | 32.3 | 21.4 | - | 81.4 | 31.6 |
| +SFT | 47.3 | 15.5 | 36.9 | 35.2 | 28.6 | 57.0 | 14.4 | 41.2 |
| +SFT+DPO | 46.1 | 11.0 | 35.8 | 21.7 | 27.8 | 69.3 | 1.7 | 52.0 |

Table 8: Evaluation of OLMo-7B models before and after instruction finetuning and DPO training on the full TULU evaluation suite. Lower is better for ToxiGen and higher is better for other metrics.
表 8: OLMo-7B 模型在完整 TULU 评估套件上指令微调与 DPO 训练前后的评估. ToxiGen 越低越好,其他指标越高越好.

- AlpacaEval: We use the package provided by Li et al. (2023), following the default setup which asks the evaluated model to generate responses for 805 prompts and employ GPT-4 to compare the response with Davinci-003. We employ the "alpaca_eval_gpt4" annotator. We allow the evaluated model to generate up to 2048 tokens, without specifying special stop sequences. The reported win-rate is the percentage of model generations that GPT-4 reports as being preferred over the generations from Davinci-003.
- AlpacaEval: 我们使用 Li et al. (2023) 提供的包,遵循默认设置,要求被评估模型为 805 个提示生成回复,并使用 GPT-4 将其回复与 Davinci-003 的回复进行比较. 我们使用"alpaca_eval_gpt4"注释器. 我们允许被评估模型生成最多 2048 个词元,不指定特殊停止序列. 报告的胜率是 GPT-4 判定为优于 Davinci-003 生成的模型生成百分比.

