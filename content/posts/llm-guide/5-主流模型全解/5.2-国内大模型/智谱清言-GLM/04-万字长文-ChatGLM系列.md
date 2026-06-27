---
title: "万字长文带你了解ChatGLM系列"
date: 2026-05-11
tags: []
---

# 04 万字长文带你了解ChatGLM系列

**作者: 暗影智芯**

**原文: https://zhuanlan.zhihu.com/p/696394009**

## 1. 介绍

- Github：[https://github.com/THUDM/ChatGLM-6B](https://link.zhihu.com/?target=https%3A//github.com/THUDM/ChatGLM-6B)- 模型文件：[https://huggingface.co/THUDM/chatglm-6b](https://link.zhihu.com/?target=https%3A//huggingface.co/THUDM/chatglm-6b)- 博客：[https://chatglm.cn/blog](https://link.zhihu.com/?target=https%3A//chatglm.cn/blog)- 论文：[https://arxiv.org/pdf/2103.10360.pdf](https://link.zhihu.com/?target=https%3A//arxiv.org/pdf/2103.10360.pdf)

ChatGLM-6B 是一个开源的、支持中英双语的对话语言模型，基于 General Language Model (GLM) 架构，具有 62 亿参数。**ChatGLM-6B 使用了和 ChatGPT 相似的技术，针对中文问答和对话进行了优化。** 经过约 1T 标识符的中英双语训练，辅以监督微调、反馈自助、人类反馈强化学习等技术的加持，62 亿参数的 ChatGLM-6B 已经能生成相当符合人类偏好的回答。

为了方便下游开发者针对自己的应用场景定制模型，GLM同时实现了基于 P-Tuning v2 的高效参数微调方法，INT4 量化级别下最低只需 7GB 显存即可启动微调。下面进入正题。

1.ChatGLM

## 2. **1.1 背景**

主流的预训练框架主要有三种：

1. **autoregressive自回归模型(AR模型)** ：代表作GPT。本质上是一个left-to-right的语言模型。**通常用于生成式任务**，在长文本生成方面取得了巨大的成功，比如自然语言生成(NLG)领域的任务：摘要、翻译或抽象问答。当扩展到十亿级别参数时，表现出了少样本学习能力。缺点是单向注意力机制，在NLU任务中，无法完全捕捉上下文的依赖关系。

2. **autoencoding自编码模型(AE模型)** ：代表作BERT。是**通过某个降噪目标(比如MLM)训练的双向文本Encoder **。Encoder 会产出适用于NLU任务的上下文表示，但无法直接用于文本生成。

3. **encoder-decoder(Seq2seq模型)** ：代表作T5。采用双向注意力机制，**通常用于条件生成任务**，比如文本摘要、机器翻译等。

三种预训练框架各有利弊，没有一种框架在以下三种领域的表现最佳：自然语言理解(NLU)、无条件生成以及条件生成。T5曾经尝试使用MTL的方式统一上述框架，然而自编码和自回归目标天然存在差异，简单的融合自然无法继承各个框架的优点。

![](./04-万字长文-ChatGLM系列-images/image_0.jpg)

粉色：Encoder-only。绿色：Encoder-Decoder，尽头智谱ChatGLM。蓝色：Decoder-only，尽头OpenAI GPT4。

在这个天下三分的僵持局面下，GLM诞生了。

4.GLM(自回归填空)模型是一种灵活且多样化的语言模型，可以根据给定的上下文生成缺失的部分内容。根据已知的部分文本内容生成可能的填空内容。它可以用于自动文本补全、问答系统、语义理解和生成等多个自然语言处理任务中。

**GLM模型基于autoregressive blank infilling方法，结合了上述三种预训练模型的思想**。

![](./04-万字长文-ChatGLM系列-images/image_1.jpg)

**自然语言理解(NLU)** ：这类任务主要关注从给定文本中提取信息和理解其含义，主要包括情感分析、文本分类、命名实体识别(NER)、关系抽取、词性标注、句法分析、语义角色标注、核心引用消解。

**无条件生成(Cond. Gen.)** ：这类任务关注从头开始生成文本，而不需要特定的输入条件，一般用于用预训练模型直接生成内容，适合语言建模

**有条件生成(Uncond. Gen.)** ：这类任务根据给定的输入或上下文生成文本，主要场景包括文本摘要、问答系统、机器翻译、对话系统中的响应生成

**Autoregressive自回归模型**

**AR模型，代表作GPT，从左往右学习的模型。** AR模型从一系列time steps中学习，并将上一步的结果作为回归模型的输入，以预测下一个time step的值。**AR模型通常用于生成式任务，在长文本的生成能力很强，比如自然语言生成(NLG)领域的任务：摘要、翻译或抽象问答。**

刚刚提到，AR模型会观察之前time steps的内在联系，用以预测下一个time step的值。如果两个变量朝着同一方向变化，比如同时增加或减少，则是正相关的; 若变量朝着相反的方向变化，比如一个增加另一个减少，则是负相关的。无论是什么样的变化方式，我们都可以量化输出与之前变量的关系。这种相关性(正相关 or 负相关)越高，过去预测未来的可能性就越大; 在深度学习训练过程中，对应的模型权重也就越高。由于这种相关性是在过去time steps中，变量与其自身之间的相关性，因此也称为自相关性(autocorrelation)。此外，如果每个变量与输出变量几乎没有相关性，则可能无法预测。

### 2.1 模型原理

AR模型利用上/下文词，通过估计文本语料库的概率分布，预测下一个词。

给定一个文本序列，\( x=\left( x_1,...x_T \right)\) 。AR模型可以将似然因式分解为

前向连乘： \(p\left( x \right)=\prod_{t=1}^{T}p\left( x_t|x_{<t} \right)\)

或者后向连乘： \(p\left( x \right)=\prod_{t=T}^{1}p\left( x_t|x_{>t} \right) \)

我们知道，训练参数模型(比如神经网络)，是用来拟合条件概率分布的。**AR语言模型仅仅是单向编码的(前向或后向)，因此它在建模双向上下文时，效果不佳。** 下图清晰解释了AR模型的前向/后向性。

![](./04-万字长文-ChatGLM系列-images/image_2.jpg)

forward

![](./04-万字长文-ChatGLM系列-images/image_3.jpg)

backward

下游语言理解任务往往需要双向的上下文信息。这导致AR语言模型与有效的预训练之间存在gap。**GPT，GPT-2，GPT-3和CTRL都是AR语言模型。**

### 2.2 **模型优缺点**

我们总结AR语言模型的优缺点如下：

- 优点：AR模型擅长生成式NLP任务。AR模型使用注意力机制，预测下一个token，因此自然适用于文本生成。此外，AR模型可以简单地将训练目标设置为预测语料库中的下一个token，因此生成数据相对容易。- 缺点：AR模型只能用于前向或者后向建模，不能同时使用双向的上下文信息，不能完全捕捉token的内在联系。

**Autoencoder自编码模型**

**AE模型，代表作BERT**，它不会进行精确的估计，但却具有从被mask的输入中，重建原始数据的能力，即*fill in the blanks*(填空)。**AE模型通常用于内容理解任务，比如自然语言理解(NLU)中的分类任务：情感分析、提取式问答。**

BERT一直都是很先进的预训练方法，它可以利用双向上下文信息，对原始输入进行重建(恢复)。这个就是相比于AR模型来说的直接优势：缩小了双向信息gap，从而可提高模型性能。然而，BERT在预训练期间使用的[MASK]符号，在微调阶段的真实数据中并不存在，这就导致了预训练-微调的差异。此外，由于预测的token在输入中被mask，导致BERT无法像AR语言模型那样，使用乘积方式对联合概率进行建模。换言之，BERT假设，在给定unmask的token时，待预测的token彼此之间相互独立，这个假设过于简单化了，在自然语言中，high-order和long-range依赖是非常普遍的。

![](./04-万字长文-ChatGLM系列-images/image_4.jpg)

## 3. Encoder-Decoder(Seq2seq模型)

encoder-decoder模型同时使用Encoder 和Decoder  。它将每个task视作序列到序列的转换/生成(比如，文本到文本，文本到图像或者图像到文本的多模态任务)。对于文本分类任务来说，Encoder 将文本作为输入，Decoder  生成文本标签。Encoder-decoder模型通常用于需要内容理解和生成的任务，比如机器翻译。

T5、BART和BigBird是Encoder-Decoder模型。

### 3.1 **OpenAI GPT系列模型**

自然语言处理领域的GPT(Generative Pre-trained Transformer)系列模型是由OpenAI开发的一系列强大的自然语言处理模型。下面是GPT系列模型的发展历程：

1. GPT-1: GPT模型是于2018年发布的第一代模型。它使用了Transformer架构，预训练了一个大规模的语言模型，并使用无标签的文本数据进行模型训练。这个模型的特点是生成连贯的文本，能够完成一些基础的自然语言处理任务，如语言模型、文本分类和文本生成等。2. GPT-2: 在2019年，OpenAI发布了GPT-2模型作为GPT的后续版本。GPT-2模型采用了更大的预训练模型，使用无标签的互联网文本进行训练。这个模型在生成文本方面取得了突破性的进展，可以生成高质量、连贯的文本，使得生成的文本内容更具有逼真性。由于考虑到模型被滥用可能带来的风险，OpenAI最初限制了GPT-2的访问，并未发布完整的模型。3. GPT-3: GPT-3是在2020年发布的GPT系列的第三代模型。参数量达到了1750亿个，训练了十几万小时。GPT-3在文本生成、文本补全、问答系统等任务上表现出色，其生成的文本能够接近人类水平的表达能力。GPT-3还可以通过提供一些文本提示来理解并回答问题，具有较强的语言理解和推理能力。4. GPT-4：在2023年，OpenAI发布了GPT-4，这是GPT系列的第四个模型。GPT-4比GPT-3系列大得多，具有1.8万亿个参数，而GPT-3只有1750亿个参数。GPT4是一种多模态模型，而GPT3系列是一种自然语言处理模型。自然语言模型只能听或看懂语言，而多模态模型可以处理多种媒体数据，并且将他们整合到统一的语义空间之中。GPT4可接收的文字输入长度达到了惊人的32000字，而GPT3系列，只能输入3000字。

![](./04-万字长文-ChatGLM系列-images/image_5.jpg)

备注：

1. SFT，Supervised Fine-Tuning (有监督微调)

提升模型遵循人类指令执行任务的能力

2. RLHF ，Reinforcement Learning from Human Feedback (基于人类反馈的强化学习算法)

保持模型和人类的价值观或偏好对齐

3. Parameter-Efficient Fine-Tuning(效率微调)

只更新部分参数，减小完整微调的成本

## 4. **1.2 GLM预训练框架**

GLM特点

1. **自编码思想**：在输入文本中，随机删除连续的tokens。

2. **自回归思想**：顺序重建连续tokens。在使用自回归方式预测缺失tokens时，模型既可以访问corrupted文本，又可以访问之前已经被预测的spans。

3. **span shuffling + 二维位置编码技术**。4. 通过改变缺失spans的数量和长度，自回归空格填充目标可以为条件生成以及无条件生成任务预训练语言模型。

### 4.1 **(1)自回归空格填充任务**

GLM 是通过优化一个自回归空白填充目标来训练的。给定一个输入文本\( \bm{x}=\left[ x_1,...,x_n \right] \)，从中采样多个文本片段  \(\left\{ \bm{s}_1,...,\bm{s}_m \right\} \)，其中每个片段 \(\bm{s}_i\) 对应于  \(\bm{x}\) 中的一系列连续的词 \(\left[ s_{i,1},...,s_{i,l_i} \right]\) 。每个片段都用一个单独的 [MASK] 符号替换，形成一个损坏的文本 \(\bm{x}_{\text{corrupt}}\)。模型以自回归的方式从损坏的文本中预测缺失的词，这意味着在预测一个片段中的缺失词时，模型可以访问损坏的文本和**之前预测的片段**。为了充分捕捉不同片段之间的相互依赖关系，我们随机**打乱片段的顺序**，类似于排列语言模型。令  \(Z_m\) 为长度为 m 的索引序列 \(\left[ 1,2,...,m \right]\) 的所有可能排列的集合，令  \(\bm{s}_{z<i}\in\left[ \bm{s}_{z_1},...,\bm{s}_{z_{i-1}} \right]\) ，于是 pretrain 目标函数可以表示为： \(\underset{\theta}{\text{max}}\space \mathbb{E}_{z\sim Z_m}\left[ \sum_{i=1}^{m}\text{log} \space p_{\theta}\left( \bm{s}_{z_i}|\bm{x}_{\text{corrupt}},\bm{s}_{z_{<i}} \right) \right]\) 按照从左到右的顺序生成每个空白中的词，即生成片段  \(\bm{s}_i\) 的概率可以分解为：

\(p_{\theta}\left( \bm{s}_i|\bm{x}_{\text{corrupt}},\bm{s}_{z_{<i}} \right)\\ =\prod_{j=1}^{l_i}p\left( s_{i,j}|\bm{x}_{\text{corrupt}},\bm{s}_{z_{<i}},\bm{s}_{i,<j} \right)\)

使用以下方式实现了自回归空白填充目标。

输入 \(\bm{x}\) 被分成两部分：Part A 是损坏的文本  \(\bm{x}_{\text{corrupt}}\)，Part B 是被遮盖的片段。Part A 的词可以相互看到，但不能看到 Part B 中的任何词。Part B 的词可以看到 Part A 和 Part B 中的前置词，但不能看到 Part B 中的后续词。为了实现自回归生成，每个片段都用特殊的符号 [START] 和 [END] 进行填充，分别用于输入和输出。这样，模型就自动地在一个统一的模型中学习了一个双向Encoder (用于 Part A)和一个单向Decoder  (用于 Part B)。GLM 的实现在图2中说明。

**技术细节：**

1. 输入可以被分成两部分：Part A是被mask的文本 \(\bm{x}_{\text{corrupt}}\)，Part B由masked spans组成。假设原始输入文本是\([x1,x2,x3,x4,x5,x6]\)，采样的两个文本片段是 \([x3]\)以及\([x5,x6]\)。那么mask后的文本序列是： \(x1,x2,x3,[M],x4,[M]\)，即Part A; 同时需要对Part B的片段进行shuffle。每个片段使用[S]填充在开头作为输入，使用[E]填充在末尾作为输出。

2. **二维位置编码**：Transformer使用位置编码来标记tokens中的绝对和相对位置。在GLM中，使用二维位置编码，第一个位置id用来标记Part A中的位置，第二个位置id用来表示跨度内部的相对位置。这两个位置id会通过embedding表被投影为两个向量，最终都会被加入到输入token的embedding表达中。3. 观察GLM中自定义attention mask的设计，非常巧妙：4. Part A中的tokens彼此可见，但是不可见B中的任意tokens。5. Part B tokens可见Part A。6. Part B tokens可见B中过去的tokens，不可见B中未来的tokens。7. 采样方式：文本片段的采样遵循[泊松分布](https://zhida.zhihu.com/search?content_id=242884284&content_type=Article&match_order=1&q=%E6%B3%8A%E6%9D%BE%E5%88%86%E5%B8%83&zhida_source=entity)，重复采样，直到原始tokens中有15%被mask。8. 总结：模型可以自动学习双向encoder(Part A)以及单向decoder(Part B)。

**案例片段介绍如下：**

模型输入的position ids分为两种，从而使得模型可以学习到片段生成的长度

Position 1： Part A中token的绝对位置

- Part A：从1开始排列- Part B：每一个span对应Part A中[MASK]的位置

Position 2：intra-span position，masked span内部的相对位置

- Part A：0- Part B：每个span的token从1开始排列

![](./04-万字长文-ChatGLM系列-images/image_6.jpg)

1. 原始文本 \(\bm{x}=\left[ x_1,x_2,x_3,x_4,x_5,x_6 \right]\) 随机进行连续 mask，这里假设 mask 掉 \(\left[ x_3 \right]\) 和  \(\left[ x_5,x_6 \right]\) ，跨度的长度服从泊松分布( \(\lambda = 3\) )，与 BART 一样。2. 将 \(\left[ x_3 \right]\) 和  \(\left[ x_5,x_6 \right]\) 替换为 [M] 标志，并打乱 Part B 的顺序。为了捕捉跨度之间的内在联系，随机交换跨度的顺序。3. GLM 自回归地生成 Part B。 每个片段在输入时前面加上 [S]，在输出时后面加上 [E]。 二维位置编码表示不同片段之间和片段内部的位置关系。

4. **自注意力掩码**。 **灰色区域被掩盖**。 **Part A 的词语可以自我看到(图2(d)蓝色框)，但不能看到 Part B。 Part B 的词语可以看到 Part A 和 Part B 中的前面的词语(图2(d)黄色和绿色框对应两个片段)** 。  \([M] := [MASK]，[S] := [START]，[E] := [END]\)

这里解释下图中 \(Position1 = [1, 2, 3, 4, 5, 5, 5, 5, 3, 3]，Position2 = [0, 0, 0, 0, 0, 1, 2, 3, 1, 2]\) 是怎么得到的。

Position1 和 Position2 是输入的二维编码，第一个维度表示片段在原始文本中的相对位置，第二个维度表示片段内部的相对位置。具体而言，每个令牌都用两个位置 id 进行编码。第一个位置 id 表示在损坏的文本中的位置\(\bm{x}_{\text{corrupt}}\)，对于被替换的片段，它是相应[ M A S K ]令牌的位置。第二个位置 id 表示片段内部的位置。对于 Part A 中的令牌，它们的第二个位置 id 为0; 对于 Part B 中的令牌，它们的第二个位置 id 在1到片段长度之间。这两个位置 id 通过可学习的嵌入表投影为两个向量，然后与输入令牌嵌入相加。

这种编码确保了在模型重建片段时，模型不知道被替换片段的长度，这与其他模型不同。例如，XLNet 在推理时需要知道或枚举答案的长度，而 SpanBERT 替换了多个\([ M A S K ]\)令牌并保持长度不变。

明白了**二维位置编码**和**自注意力掩码**，就算是明白了 GLM 的核心部分。

### 4.2 **(2)Multi-Task Pretraining**

Multi-Task Pretraining是一种多任务预训练的方法。在传统的预训练方法中，语言模型通过在大规模文本数据上进行训练来学习语言的通用模式和表示。然而，在Multi-Task Pretraining中，模型同时在多个任务上进行训练，这些任务需要不同类型的语言理解能力。

Multi-Task Pretraining的思想是通过在多个任务上训练语言模型，可以学习到更加通用和鲁棒的语言表示。这是因为不同的任务需要不同的语言技能，如句法分析、语义理解或文档级连贯性。通过让模型接触多样化的任务，它可以学习捕捉不同任务之间的共同语言模式，并利用这些模式更好地泛化到新任务上。

Multi-Task Pretraining已被证明可以提高语言模型在下游任务上的性能。例如，预训练在多个任务上的模型在各种自然语言处理基准测试中取得了最先进的结果，如问答、文本分类和命名实体识别。

其中一种常见的Multi-Task Pretraining方法是基于Transformer的模型，如BERT(双向Encoder 表示来自Transformer的方法)和RoBERTa(经过优化的鲁棒BERT方法)。这些模型在掩码语言建模、下一个句子预测和其他辅助任务上进行预训练。

**案例片段介绍如下：**

通过改变遮盖内容的长度和数量，从而使模型能够基于natural language understanding, conditional generation, unconditional generation三类任务进行预训练，实现“三合一”

改变缺失跨度的数量和长度：

![](./04-万字长文-ChatGLM系列-images/image_7.jpg)

### 4.3 **(3)模型结构**

GLM在原始single Transformer的基础上进行了一些修改：

1. 重组了LN和残差连接的顺序; 2. 使用单个线性层对输出token进行预测; 3. [激活函数](https://zhida.zhihu.com/search?content_id=242884284&content_type=Article&match_order=1&q=%E6%BF%80%E6%B4%BB%E5%87%BD%E6%95%B0&zhida_source=entity)从ReLU换成了GeLUS。

**核心和亮点还是空格填充任务的设计。**

### 4.4 (4)Finetuning

Finetuning是指在预训练的基础上，将模型进一步调整和优化以适应特定任务或特定数据集的过程。在机器学习中，预训练模型通常在大规模的数据上进行训练，学习到通用的模式和特征表示。然而，这些预训练模型可能不直接适用于特定的任务或数据集。

通过Finetuning，可以利用预训练模型的通用知识和特征表示来快速适应特定的任务或数据集。这通常涉及解冻预训练模型的一部分或全部层，并在目标任务上进行进一步的训练。通过在目标任务上微调模型参数，可以使其更好地适应任务的特定要求和数据特征。

Finetuning的过程通常包括以下步骤：

1. 选择预训练模型：选择与目标任务相匹配的预训练模型，如BERT或GPT等。2. 初始化参数：将预训练模型加载到模型中，并冻结所有或部分层的参数。3. 构建任务特定层：根据目标任务的需求，构建一个或多个任务特定的层。4. 训练：使用目标任务的数据集，通过反向传播和梯度下降等优化算法，更新模型的参数。5. 调整超参数：对模型进行验证和评估，并根据结果调整超参数，如学习率、批大小等。6. 重复迭代：根据需要，多次迭代训练和调整模型，直到达到满意的性能。

Finetuning可以大大减少在特定任务上的训练时间和样本需求，同时利用预训练模型的知识提供了更好的初始参数和特征表示。它已经被广泛应用于自然语言处理、计算机视觉和其他领域中的许多任务，如文本分类、问答、命名实体识别等。

**案例片段介绍如下：**

GLM将NLG和NLU类下游任务统一为完型填空的生成式任务，如对于分类任务，将输入x写成一个填空问题c(x)，后将生成的答案v(y)映射至标签y

![](./04-万字长文-ChatGLM系列-images/image_8.jpg)

## 5. **2.ChatGLM-2**

### 5.1 **2.1 主要创新**

1. **更长的上下文**：**基于****FlashAttention****技术**，将基座模型的上下文长度(Context Length)由 ChatGLM-6B 的 **2K 扩展到了 32K**，并在对话阶段使用 8K 的上下文长度训练。对于更长的上下文，发布了 ChatGLM2-6B-32K 模型。LongBench 的测评结果表明，在等量级的开源模型中，ChatGLM2-6B-32K 有着较为明显的竞争优势。

2. **更强大的性能**：基于 ChatGLM 初代模型的开发经验，全面升级了 ChatGLM2-6B 的基座模型。ChatGLM2-6B **使用了****GLM****的混合目标函数**，经过了 1.4T 中英标识符的预训练与人类偏好对齐训练，评测结果显示，相比于初代模型，ChatGLM2-6B 在 MMLU(+23%)、CEval(+33%)、GSM8K(+571%) 、BBH(+60%)等数据集上的性能取得了大幅度的提升，在同尺寸开源模型中具有较强的竞争力。

3. **更高效的推理**：基于 Multi-Query Attention 技术，ChatGLM2-6B 有更高效的推理速度和更低的显存占用：在官方的模型实现下，推理速度相比初代提升了 42%，INT4 量化下，6G 显存支持的对话长度由 1K 提升到了 8K。

4. **更开放的协议**：ChatGLM2-6B 权重对学术研究**完全开放**，在填写问卷进行登记后**亦允许免费商业使用**。

### 5.2 **2.2 与ChatGLM的变化**

1. **使用了RoPE替换二维位置编码**。这也是GLM中提出的亮点设计之一。但是目前大部分主流的LLMs都在使用RoPE，所以大势所趋。当前版本仍然采用了最初的RoPE设计，事实上现在的RoPE经过了xPOS→线性内插→NTK-Aware Scaled RoPE→…若干次进化。

2. **Multi-Query Attention**：这是一种共享机制的Attention，是Multi-Head Attention(MHA)一种变体，相比Multi-Head Attention，其Query部分没有区别，Key和Value可以只用一个Head。计算时，对Key和Value进行expand或者repeat操作，使它们填充到与Query一样的维度，后续计算就与Multi-Head Attention没区别。

3. **Attention Mask**: V1的attention mask分了2部分，Part A和Part B，Part A部分是双向Attention(代码中的prefix_attention_mask)，Part B部分是Causal Attention(原代码文件中的get_masks函数)。在V2版本，全部换成了Causal Attention，不再区分是Part A还是Part B，**完全变成了decoder-only的架构**。

4. **多目标任务**：Chat版本主要还是用的gMask生成式任务，但是在V1版本的代码还能看到mask、gMask等字样，V2已经摒弃了这些特殊token，原因与Attention Mask一致，均因为变成了decoder-only的架构，不再需要区分Part A和Part B。

## 6. **3.ChatGLM-3**

省流：**ChatGLM2与ChatGLM3模型架构是完全一致的**，ChatGLM与后继者结构不同。可见ChatGLM3相对于ChatGLM2没有模型架构上的改进。

相对于ChatGLM，ChatGLM2、ChatGLM3模型上的变化：

1. 词表的大小从ChatGLM的150528缩小为65024 (一个直观的体验是ChatGLM2、3加载比ChatGLM快不少)2. **位置编码从每个GLMBlock一份提升为全局一份**3. **SelfAttention之后的前馈网络有不同**。ChatGLM用GELU(Gaussian Error Linear Unit)做激活; ChatGLM用Swish-1做激活。而且ChatGLM2、3应该是修正了之前的一个bug，因为GLU(Gated Linear Unit)本质上一半的入参是用来做门控制的，不需要输出到下层，所以ChatGLM2、3看起来前后维度不一致(27392->13696)反而是正确的。

4.模型架构比较

![](./04-万字长文-ChatGLM系列-images/image_9.jpg)

ChatGLM的模型结构：

![](./04-万字长文-ChatGLM系列-images/image_10.jpg)

ChatGLM2的模型结构：

![](./04-万字长文-ChatGLM系列-images/image_11.jpg)

ChatGLM3的模型结构：

![](./04-万字长文-ChatGLM系列-images/image_12.jpg)

## 7. **4.ChatGLM-4**

2024年01月16日，智谱AI推出新一代基座大模型GLM-4，整体性能相比GLM3全面提升60%，逼近GPT-4; 支持更长上下文; 更强的多模态; 支持更快推理速度，更多并发，大大降低推理成本; 同时GLM-4增强了智能体能力。

**基础能力(英文)：** GLM-4 在 MMLU、GSM8K、MATH、BBH、HellaSwag、HumanEval等数据集上，分别达到GPT-4 94%、95%、91%、99%、90%、100%的水平。

![](./04-万字长文-ChatGLM系列-images/image_13.jpg)

**指令跟随能力：** GLM-4在IFEval的prompt级别上中、英分别达到GPT-4的88%、85%的水平，在Instruction级别上中、英分别达到GPT-4的90%、89%的水平。

![](./04-万字长文-ChatGLM系列-images/image_14.jpg)

**对齐能力：** GLM-4在中文对齐能力上整体超过GPT-4。

![](./04-万字长文-ChatGLM系列-images/image_15.jpg)

**长文本能力：** 我们在LongBench(128K)测试集上对多个模型进行评测，GLM-4性能超过 Claude 2.1; 在「大海捞针」(128K)实验中，GLM-4的测试结果为 128K以内全绿，做到100%精准召回。

![](./04-万字长文-ChatGLM系列-images/image_16.jpg)

**多模态-文生图：** CogView3在文生图多个评测指标上，相比DALLE3 约在 91.4% ~99.3%的水平之间。

![](./04-万字长文-ChatGLM系列-images/image_17.jpg)

**ALL Tools**

GLM-4 实现自主根据用户意图，自动理解、规划复杂指令，自由调用网页浏览器、Code Interpreter代码解释器和多模态文生图大模型，以完成复杂任务。 
简单来讲，即只需一个指令，GLM-4会自动分析指令，结合上下文选择决定调用合适的工具。

**All Tools -文生图。** GLM-4 能够结合上下文进行AI绘画创作(CogView3)，如下图所示，大模型能够遵循人的指令来不断修改生成图片的结果：

![](./04-万字长文-ChatGLM系列-images/image_18.jpg)

**All Tools - 代码解释器。** GLM-4能够通过自动调用python解释器，进行复杂计算(例如复杂方程、微积分等)，在GSM8K、MATH、Math23K等多个评测集上都取得了接近或同等GPT-4 All Tools的水平。

![](./04-万字长文-ChatGLM系列-images/image_19.jpg)

同样GLM-4 也可以完成文件处理、数据分析、图表绘制等复杂任务，支持处理Excel、PDF、PPT等格式文件。

**All Tools - 网页浏览。** GLM-4 能够自行规划检索任务、自行选择信息源、自行与信息源交互，在准确率上能够达到 78.08，是GPT-4 All Tools 的116%。

![](./04-万字长文-ChatGLM系列-images/image_20.jpg)

**All Tools - Function Call。** GLM-4 能够根据用户提供的Function描述，自动选择所需 Function并生成参数，以及根据 Function 的返回值生成回复; 同时也支持一次输入进行多次 Function 调用，支持包含中文及特殊符号的 Function 名字。这一方面GLM-4 All Tools 与 GPT-4 Turbo 相当。

![](./04-万字长文-ChatGLM系列-images/image_21.jpg)

**All Tools - 多工具自动调用。** 除了以上单项工具自动调用外，GLM-4 同样能够实现多工具自动调用，例如结合 网页浏览、CogView3、代码解释器等的调用方式。

![](./04-万字长文-ChatGLM系列-images/image_22.jpg)