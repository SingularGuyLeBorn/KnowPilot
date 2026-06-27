---
title: "LLM之LLaMA: LLaMA家族及其生态"
date: 2026-05-11
tags: []
---

# 02 LLM之LLaMA: LLaMA家族及其生态

**作者: APlayBoy**

**原文: **[https://zhuanlan.zhihu.com/p/689556634](https://zhuanlan.zhihu.com/p/689556634)

这个博客介绍了LLaMA模型家族及其后续发展，分析了LLaMA 1与LLaMA 2的主要区别和性能提升，如数据清洗强化、Token数量增加、上下文长度加倍和安全性提升。LLaMA 2在多个基准测试中表现优异，超越LLaMA 1。LLaMA 2-Chat作为改进版本，在对话生成质量上表现出色。博客还详细介绍了专门用于生成代码的LLaMA变体Code Llama，该模型在编程任务中性能卓越并具备较高安全性。最后，文章涉及了LLaMA家族的其他成员如Alpaca、Flan-Alpaca等，以及LLaMA Factory框架，强调其在高效微调LLMs方面的贡献。

LLaMA是Meta AI于2023年2月推出的模型家族，包括四种规模(7B、13B、30B和65B)，自发布以来，便凭借其开放性和有效性，吸引了研究和工业界的广泛关注。LLaMA模型在各种开放基准测试中均展现出卓越性能，迅速成为目前最受欢迎的开放语言模型之一。

众多研究人员通过指令调优或持续预训练方法对LLaMA模型进行了扩展和改进。值得一提的是，通过指令调优优化LLaMA模型已成为开发定制专门模型的主流方法，这在很大程度上得益于其相对较低的计算成本。

## 1. llama 介绍

### 1.1 开源模型介绍

Meta在推出LLaMA的第一个版本之后，又相继推出了LLaMA 2、LLaMA-Chat、Code-LLaMA等系列作品，其中LLaMA2还支持商业应用。这些持续的进展不仅体现了LLaMA在技术上的创新，也进一步巩固了其在语言模型领域的领导地位。

![](https://www.yuque.com/attachments/yuque/0/2025/jp/42982692/1754091426395-67b5bf02-7a4f-4299-85b5-105d9697f9bc.jp)

llama 1开源的模型

![](https://www.yuque.com/attachments/yuque/0/2025/jp/42982692/1754091426471-f5405d19-3117-4997-931d-1118513df616.jp)

llama 2开源的模型

### 1.2 LLaMA 1与LLaMA 2的区别

![](https://www.yuque.com/attachments/yuque/0/2025/jp/42982692/1754091426545-38a4a33b-04f0-46a5-8df3-a53eb69cc2b3.jp)

llama的训练数据

1. **数据清洗的强化**：LLaMA 2在数据清洗方面更为强大，它包含了来自公开可用来源的新数据混合，且排除了Meta的产品或服务数据。同时，为了减少个人信息的包含，已经从某些已知含有大量个人信息的网站中删除了数据。

2. **Token数量的增加**：LLaMA 2在训练时使用了总计2万亿个token的数据，相比LLaMA 1增加了40%。这种增加在提高性能的同时，仍保持了成本效率。通过对真实来源的过采样，LLaMA 2旨在增加知识的覆盖范围并减少误解或错误信息的产生。

3. **上下文长度的加倍**：与LLaMA 1相比，LLaMA 2具有更长的上下文窗口，能够处理更多信息。这对于支持聊天应用中的长历史记录、各种摘要任务以及理解较长文档特别有帮助。

4. **Grouped-query Attention的引入**：LLaMA 2引入了Grouped-query Attention (GQA)机制，这是一种在多头注意力模型中共享键和值投影的方法，可以减少与缓存相关的内存成本。这使得较大的模型在优化内存使用的同时保持良好的性能。

5. **安全性的提升**：与ChatGPT和GPT-4类似，LLaMA 2经过特别的微调，以确保其“安全性”。对挑衅性提示的响应频率评估表明，LLaMA 2在安全性方面比ChatGPT以及其他开源模型表现得更好。其中：34B模型的异常表现可能是其未被公开的原因，而其他规模的模型已可供下载使用。

总体来看，LLaMA 2在数据处理、性能、上下文长度和安全性等多个方面相比LLaMA 1有了显著的提升和优化。

## 2. llama 指标

![](https://www.yuque.com/attachments/yuque/0/2025/jp/42982692/1754091426621-fd71489e-e5e7-47cb-93d6-ea80e54d3174.jp)

LLaMA模型的综合性能指标

LLaMA 2模型的性能通过多个方面的基准测试进行了综合评估。以下是这些测试的概要和比较结果：

- 编程任务：LLaMA 2模型在HumanEval和MBPP编程任务的平均通过率上展现了优秀的性能。- 常识推理：模型在PIQA, SIQA, HellaSwag, WinoGrande, ARC Easy/Challenge, OpenBookQA和CommonsenseQA等基准上的表现进行了评估，其中CommonsenseQA的评估使用了7-shot方法，而其他基准使用了0-shot方法。- 世界知识：LLaMA 2在NaturalQuestions和TriviaQA上的5-shot性能得到了测试，并报告了平均成绩。- 阅读理解：模型在SQuAD, QuAC和BoolQ上的0-shot平均成绩进行了评估。- 数学问题解决：在GSM8K(8 shot)和MATH(4 shot)两个基准上的表现进行了比较。- 综合基准测试：模型在MMLU(5 shot)、Big Bench Hard(BBH)(3 shot)和AGI Eval(3-5 shot)上的整体成绩被报告。在AGI Eval中，仅评估了英语任务并报告了平均成绩。

总体来看，LLaMA 2在这些基准测试上的表现超越了LLaMA 1模型。具体而言，在MMLU和BBH上，LLaMA 2 70B模型相比LLaMA 1 65B模型分别提升了大约5和8个百分点。此外，LLaMA 2的7B和30B模型在除编程任务外的所有类别上均超越了相应规模的MPT模型。在所有类别的基准测试中，LLaMA 2 70B模型也优于所有其他开源模型。

![](https://www.yuque.com/attachments/yuque/0/2025/jp/42982692/1754091426696-8f6869b1-6959-4ba2-bb2c-d636fb75bb24.jp)

LaMA 2 70B模型与一些封闭源模型的比较

LLaMA 2 70B模型的性能还与一些封闭源模型进行了比较。以下是与GPT-3.5、PaLM(540B)以及GPT-4和PaLM-2-L的比较结果：

- 与GPT-3.5的比较：在MMLU和GSM8K基准测试中，LLaMA 2 70B的表现接近于GPT-3.5(OpenAI, 2023)。然而，在编程基准测试上，LLaMA 2 70B与GPT-3.5之间存在显著差距。- 与PaLM的比较：LLaMA 2 70B在几乎所有基准测试上的成绩与PaLM(540B)(Chowdhery et al., 2022)相当或更好。- 与GPT-4和PaLM-2-L的比较：报告中提到，尽管LLaMA 2 70B在多个基准上表现出色，但与GPT-4和PaLM-2-L之间仍存在较大的性能差距。

虽然LLaMA 2 70B在某些方面与封闭源模型接近，但在编程任务和与GPT-4以及PaLM-2-L的比较中仍有一定差距。这显示出LLaMA 2 70B在多个领域的强大竞争力，同时也揭示了进一步提升的潜在空间。

## 3. llama2-chat

LLaMA2-Chat是基于LLaMA 2模型的进阶版本，经过特别设计和微调，以适应对话应用程序的需求。这一模型优化了人机交互体验，提供了更流畅、自然的对话能力。

![](https://www.yuque.com/attachments/yuque/0/2025/jp/42982692/1754091426769-9c031d1e-e33c-4e0e-a858-2547a5ff6b57.jp)

llama2-chat开发过程

### 3.1 训练过程

- **初始阶段(基于公开资源的预训练)** : LLaMA Chat的开发过程首先依赖于LLaMA 2的预训练，该阶段主要使用了公开可用的在线资源。这为LLaMA Chat奠定了坚实的基础，使其能够理解和处理大量的信息。

- **构建初始版本(监督微调)** :在预训练的基础上，采用了监督微调方法来创建LLaMA 2-Chat的初始版本。这一步骤主要侧重于对模型进行特定的调整，以适应聊天应用程序的需求，提高其在实际对话中的表现。

- **迭代改进(应用强化学习)** LLaMA Chat的开发进入了关键阶段，使用带有人类反馈的强化学习(RLHF)方法，特别是通过拒绝抽样和近端策略优化(PPO)，对模型进行了迭代改进。这一过程不仅加强了模型的应对能力，也使其更好地适应实际对话场景。

- **奖励模型**:在整个RLHF阶段，随着模型的增强，并行地积累了迭代奖励建模数据。这一过程对于确保奖励模型能够保持在适当的分布范围内至关重要，有助于提升LLaMA Chat的整体性能和用户体验。

通过这些细致的开发阶段，LLaMA Chat不仅在技术上成熟，而且在用户交互方面表现出了显著的优势，成为了一款高效、可靠的聊天应用模型。

### 3.2 指标测试

![](https://www.yuque.com/attachments/yuque/0/2025/jp/42982692/1754091426844-39cae534-bc06-425c-a838-f99c5e9b1dc6.jp)

LLaMA 2-Chat模型的人类评估实验

在自然语言生成领域，包括对话模型在内，人类评估通常被认为是衡量模型性能的金标准。为了评估主要模型版本的质量，Meta AI团队邀请了人类评估员对其在有用性和安全性上进行评分。

- 实验方法- 比较对象：LLaMA 2-Chat模型与开源模型(包括Falcon, MPT MosaicML NLP Team et al. (2023), Vicuna Chiang et al. (2023))以及封闭源模型(包括ChatGPT (OpenAI, 2023)和PaLM Anil et al. (2023))进行了比较。- 实验设计：评估涵盖了超过4,000个单轮和多轮的提示。- 特定版本使用：在评估ChatGPT时，使用的是gpt-3.5-turbo-0301模型; 对于PaLM，使用的是chat-bison-001模型。- 评估数量：每个模型在人类评估中的最终提示计数显示在第32表中。更多的方法细节可以在附录A.3.7节中找到。- 实验结果- 有用性结果：如图12所示，LLaMA 2-Chat模型在单轮和多轮提示上的表现均显著优于开源模型。特别是，LLaMA 2-Chat 7B模型在60%的提示上超过了MPT-7B-chat模型。- 整体胜率：LLaMA 2-Chat 34B模型在与大小相当的Vicuna-33B和Falcon 40B模型的比较中，整体胜率超过了75%。

LLaMA 2-Chat模型在人类评估实验中展现了出色的性能，特别是在有用性方面，相比于其他开源和封闭源模型具有显著优势。这些结果反映了LLaMA 2-Chat在对话生成质量上的强大竞争力。

![](https://www.yuque.com/attachments/yuque/0/2025/jp/42982692/1754091426933-31ac0221-229a-4104-9fd9-05be09280ba6.jp)

llama2-chat在安全性方面和实用工具的能力测试

为了评估LLaMA 2在语言模型(LM)安全性方面的能力，进行了三个方面的自动基准测试：真实性、有害内容、以及偏见。

- 真实性- 测试方法：使用TruthfulQA 测试。- 目标：衡量LLMs生成符合事实和常识的可靠输出的能力。- 测试结果：LLaMA 2-7B模型比LLaMA 1-7B显示了21.37%的真实性和信息量提升。- 有害内容- 测试方法：使用ToxiGen 测试。- 目标：测量模型产生有害言论和仇恨言语的比例。- 测试结果：LLaMA 2-7B在有害内容方面的比例下降了7.61%。- 偏见- 测试方法：使用BOLD 测试。- 目标：研究模型生成的情感如何随人口统计属性变化。- 测试结果：在BOLD提示中，许多群体的积极情感整体上有所增加。- 预训练和微调模型的对比- 预训练模型：更大的预训练数据可能导致了13B和70B模型在有害内容方面的增加。- 微调模型：LLaMA 2-Chat在真实性(70B从50.18提升到64.14)和有害内容(70B从24.60降到0.01)方面相比预训练LLaMA 2表现出显著改善。所有尺寸的LLaMA 2-Chat的有害内容生成比例实际上降到了0%，在所有比较模型中最低。- 微调后表现：微调后的LLaMA 2-Chat在BOLD基准测试的许多人口统计群体中显示出了整体积极情感的增加。- 额外实验：计算器使用- 还对具备计算器功能的LLaMA 2-Chat进行了评估，其结果仍记录在上图。虽然LLM工具的使用能力令人兴奋，但也可能引发安全问题。

## 4. Code Llama

Code Llama是一款专门用于生成代码的大型语言模型(LLM)，通过文本提示生成代码。Code Llama基于LLaMA 2增强了编码能力。它可以从代码和自然语言提示(例如，“编写一个输出斐波那契序列的函数。”)生成代码和关于代码的自然语言。它还可用于代码补全和调试。它支持当前最流行的多种语言，包括Python、C++、Java、PHP、Typescript(Javascript)、C#和Bash。它在公开可用的LLMs的代码任务中处于领先地位，有潜力使开发流程更快、更高效，并为学习编程的人降低入门门槛。Code Llama可以作为一个生产力和教育工具，帮助程序员编写更稳健、更有文档的软件。

### 4.1 训练过程

![](https://www.yuque.com/attachments/yuque/0/2025/jp/42982692/1754091427042-d117b0c0-b1e2-490d-b227-d85f953d05e8.jp)

code llama训练的过程

Code Llama是LLaMA 2的一个专门针对代码生成优化的版本。以下是其训练过程的概述：

- 基础训练- 源自LLaMA 2：Code Llama基于LLaMA 2，通过在专门的代码数据集上进行额外训练而创建。- 加强采样：为了提高Code Llama的编码能力，从相同的数据集中采样了更多的数据，且训练时间更长。- 增强的编码功能：Code Llama不仅能生成代码，还能从代码和自然语言提示中生成关于代码的自然语言。例如，它能根据提示“编写一个输出斐波那契序列的函数。”来生成代码。- 代码任务支持：Code Llama支持代码补全和调试，兼容多种流行的编程语言，如Python、C++、Java、PHP、Typescript (Javascript)、C#和Bash。- 模型大小和训练数据- 模型规模：发布了四种规模的Code Llama模型——7B、13B、34B和70B参数。- 训练数据：每个模型均使用500B个代码和代码相关的数据令牌进行训练，70B模型则使用1T个令牌。- 中间填充(FIM)能力：7B和13B的基础和指令模型经过FIM训练，能够在现有代码中插入代码，支持如代码补全等任务。- 性能和延迟要求- 不同需求：不同大小的模型满足不同的服务和延迟要求。例如，7B模型可以在单个GPU上运行; 而34B和70B模型提供更好的编码辅助，但较小的7B和13B模型更快，更适合低延迟任务，如实时代码补全。- 上下文长度：Code Llama模型能处理最多100,000个令牌的上下文，所有模型都在16,000个令牌的序列上训练，对最多100,000个令牌的输入有所改进。- Code Llama的特别变体- Code Llama - Python：进一步在100B个Python代码令牌上微调的语言专门版本。鉴于Python在代码生成基准中的重要性，这个专门模型具有额外的实用性。- Code Llama - Instruct：指令微调和对齐的Code Llama变体。指令调优继续训练过程，但目标不同。模型被喂入“自然语言指令”输入和预期输出，使其更好地理解人类的期望。

### 4.2 指标评估

![](https://www.yuque.com/attachments/yuque/0/2025/jp/42982692/1754091427116-2cc2ae07-3302-49f4-9dfe-4749885090b4.jp)

code llama指标测试结果

为了评估Code Llama在编程领域的性能，使用了两个流行的编码基准测试：HumanEval和Mostly Basic Python Programming(MBPP)。这两个测试分别检验模型基于文档字符串完成代码的能力，以及基于描述编写代码的能力。

- 基准测试结果- HumanEval性能：Code Llama 34B在HumanEval上的得分为53.7%，这是与其他最先进的开放解决方案相比的最高分，与ChatGPT相当。- MBPP性能：在MBPP测试中，Code Llama 34B的得分为56.2%，也是最高的。 总体来看，Code Llama在这些基准测试上表现优于开源的代码特定LLMs，同时也超过了LLaMA 2。- 安全性评估- 恶意代码生成风险：作为红队测试工作的一部分，对Code Llama生成恶意代码的风险进行了定量评估。创建了旨在引导生成恶意代码的提示，并将Code Llama的响应与ChatGPT(GPT3.5 Turbo)的响应进行了比较。- 测试结果：结果表明，Code Llama给出了更安全的回答。- 研究论文中的详细信息- 红队测试：研究论文中包含了来自负责任AI、攻击性安全工程、恶意软件开发和软件工程领域专家的红队测试详细信息。

经过测试，发现Code Llama不仅在编程任务的性能上表现突出，而且在安全性方面也展现了积极的成果。

## 5. Llama Family

![](https://www.yuque.com/attachments/yuque/0/2025/jp/42982692/1754091427185-26371159-853e-4e58-b9c4-9a61070341f3.jp)

Llama Faimly的一部分模型进化图

LLaMA模型家族是针对多语言理解和生成的一系列扩展模型，它们基于Meta AI发布的原始LLaMA模型进行改进和微调。以下是LLaMA家族的主要成员和特点：

1. [Alpaca](https://link.zhihu.com/?target=https%3A//crfm.stanford.edu/2023/03/13/alpaca.html)：斯坦福大学发布的Alpaca是基于LLaMA 7B模型的首个指令微调开放模型。Alpaca的开发使用了52K个由text-davinci-003生成的指令演示，这些数据和训练代码在后续项目中得到了广泛应用，如AlpacaLoRA、LoRA、Koala和BELLE，更多部署和训练链接： [Alpaca.cpp](https://link.zhihu.com/?target=https%3A//github.com/antimatter15/alpaca.cpp)，[Alpaca-LoRA](https://link.zhihu.com/?target=https%3A//github.com/tloen/alpaca-lora)。2. [Vicuna](https://link.zhihu.com/?target=https%3A//lmsys.org/blog/2023-03-30-vicuna/)：Vicuna是基于LLaMA的另一种流行变体，经过训练以处理从ShareGPT 16收集的用户共享对话。这种模型凭借其出色的性能和可用性，为LLaMA模型家族增添了丰富多彩的应用场景，与GPT-4竞争，达到90% ChatGPT质量的开源聊天机器人。3. [多模态](https://zhida.zhihu.com/search?content_id=241365438&content_type=Article&match_order=1&q=%E5%A4%9A%E6%A8%A1%E6%80%81&zhida_source=entity)** 模型**：多模态模型如LLaVA、MiniGPT4、InstructBLIP和PandaGPT，将LLaMA作为基础语言模型，以实现更全面的语言理解和生成能力。这些模型在多种语言和任务中表现出色，证明了LLaMA的适应性和灵活性。

4. **更多相关工作：**

- [Flan-Alpaca](https://link.zhihu.com/?target=https%3A//github.com/declare-lab/flan-alpaca) - 来自人类和机器的指令调整。- [Baize](https://link.zhihu.com/?target=https%3A//github.com/project-baize/baize-chatbot) - 使用[LoRA](https://link.zhihu.com/?target=https%3A//github.com/microsoft/LoRA)训练的开源聊天模型，使用ChatGPT自聊生成的100k对话。- [Cabrita](https://link.zhihu.com/?target=https%3A//github.com/22-hours/cabrita) - 葡萄牙语微调的指令LLaMA模型。- [Llama-X](https://link.zhihu.com/?target=https%3A//github.com/AetherCortex/Llama-X) - 提高LLaMA至最新技术水平的开放学术研究。- [Chinese-Vicuna](https://link.zhihu.com/?target=https%3A//github.com/Facico/Chinese-Vicuna) - 基于LLaMA的中文遵循指令模型。- [GPTQ-for-LLaMA](https://link.zhihu.com/?target=https%3A//github.com/qwopqwop200/GPTQ-for-LLaMa) - 使用[GPTQ](https://link.zhihu.com/?target=https%3A//arxiv.org/abs/2210.17323)对 [LLaMA](https://link.zhihu.com/?target=https%3A//arxiv.org/abs/2302.13971)进行4位量化。- [GPT4All](https://link.zhihu.com/?target=https%3A//github.com/nomic-ai/gpt4all) - 基于GPT-J和LLaMa的开源助手风格大型语言模型的演示、数据和代码。- [Koala](https://link.zhihu.com/?target=https%3A//bair.berkeley.edu/blog/2023/04/03/koala/) - 学术研究对话模型。- [BELLE](https://link.zhihu.com/?target=https%3A//github.com/LianjiaTech/BELLE) - 大型语言模型引擎。- [StackLLaMA](https://link.zhihu.com/?target=https%3A//huggingface.co/blog/stackllama) - 使用RLHF训练LLaMA的指南。- [RedPajama](https://link.zhihu.com/?target=https%3A//github.com/togethercomputer/RedPajama-Data) - 重现LLaMA训练数据集的开源配方。- [Chimera](https://link.zhihu.com/?target=https%3A//github.com/FreedomIntelligence/LLMZoo) - 是一款专注于拉丁语系的多语言模型。- [WizardLM|WizardCoder](https://link.zhihu.com/?target=https%3A//github.com/nlpxucan/WizardLM) -由Evol-Instruct驱动的遵循指令LLMs系列。- [CaMA](https://link.zhihu.com/?target=https%3A//github.com/zjunlp/CaMA) - 中英双语LLaMA模型。- [Orca](https://link.zhihu.com/?target=https%3A//aka.ms/orca-lm) - 微软微调的LLaMA模型。- [BayLing](https://link.zhihu.com/?target=https%3A//github.com/ictnlp/BayLing) - 具备高级语言对齐功能的中英LLM。- [UltraLM](https://link.zhihu.com/?target=https%3A//github.com/thunlp/UltraChat) - 大规模多轮聊天模型。- [Guanaco](https://link.zhihu.com/?target=https%3A//github.com/artidoro/qlora) - 使用QLoRA调整的LLaMA。- [ChiMed-GPT](https://link.zhihu.com/?target=https%3A//github.com/synlp/ChiMed-GPT) - 中文医疗大型语言模型。

## 6. Alpaca

![](https://www.yuque.com/attachments/yuque/0/2025/jp/42982692/1754091427261-bbbf544f-08a4-4e74-b17a-8b13bd3c0a1a.jp)

llama Alpace训练流程图

在LLaMA家族中，Alpaca扮演着重要的角色，它是指令微调领域的开拓者。斯坦福大学发布了这个基于LLaMA(7B)模型的创新作品，名为Alpaca，它是首个针对指令微调的开放模型。Alpaca的训练方法独具匠心，采用了52,000个由text-davinci-003模型和self-instruct方法生成的训练样本。这种训练方法不仅确保了Alpaca的高效性和精准度，而且它的数据和训练代码在后续的研究与开发中被广泛应用，极大地影响了其他模型的发展，包括AlpacaLoRA、LoRA、Koala和BELLE等。可以说，Alpaca在LLaMA家族中的地位不仅仅是一个成员，更是一个重要的里程碑和灵感源泉。

Alpaca的训练过程包括：

- **基础训练**：Alpaca基于LLaMA 7B模型开发，通过在专门的数据集上进一步训练而形成。

- **数据生成**：使用text-davinci-003自动生成了52K个独特的指令和相应的输出。

- **微调**：使用Hugging Face训练框架，全分片数据并行和混合精度等技术，有效地微调了LLaMA 7B模型。

- **评估**：Alpaca在初步评估中展示了其在遵循和执行指令方面的强大能力，通过人类评估和盲目对比测试等方法进行验证。

## 7. Llama Factory

![](https://www.yuque.com/attachments/yuque/0/2025/jp/42982692/1754091427330-81f5f035-a13e-4410-8ec5-7d8dfbe56525.jp)

Llama Factory主页图

LLaMA Factory是一个统一框架，集成了一系列高效训练方法，用于适配大型语言模型(LLMs)到下游任务。它的特点包括：

- 高效微调的重要性- 主要挑战：微调具有大量参数的LLMs以适应下游任务时，资源限制成为主要挑战。- 解决方案：高效微调方法减少LLMs适应不同任务时的训练成本。- LLaMA Factory的特点- 统一框架：整合各种高效微调方法，通过可扩展模块实现统一化处理。- 简化用户操作：通过内置的网络用户界面LLAMABOARD，用户可以灵活地定制100多个LLMs的微调，无需编程。- 效率和有效性：在语言建模和文本生成任务上经过实证验证。- LLAMABOARD: 无编程微调- 用户友好界面：用户可以通过命令行或网络界面定制和微调LLMs，几乎不需要编程。- 流程简化：简化了常用的训练方法，包括生成式预训练、监督式微调、人类反馈强化学习等。- 主要模块- 模型加载器：建立模型注册表，准确附加适配器到预训练模型。- 数据工作器：通过数据描述规范，收集和对齐数据集。- 训练器：提供高效微调方法的即插即用实现。- 开源和影响- 开源许可：LLaMA Factory以Apache-2.0许可开源。- [GitHub](https://link.zhihu.com/?target=https%3A//github.com/hiyouga/LLaMA-Factory)接受度：在GitHub上获得超过13,000颗星和1,600个分支。 Hugging Face Hub应用：数百个开源模型基于LLaMA Factory构建。- 跨学科应用：数十个研究项目利用此框架探索LLMs的新方法。 LLaMA Factory通过提供一个统一、用户友好的高效微调平台，显著降低了适配LLMs到各种下游任务的技术门槛和成本，可以促进了大型语言模型研究和应用的发展。

## 8. **结束语**

这个博客是大语言模型教程系列的第四篇，在这里关于Llama Family的介绍就要结束了，感谢每位朋友的陪伴，如果对您有点帮助，就顺手**点个赞**呗。您的**点赞、关注**是我持续分享的动力。我是 ，期待与您一起在AI的世界里不断成长！