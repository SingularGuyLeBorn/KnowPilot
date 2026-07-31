---
title: The Illustrated Transformer 中文翻译
category: 译文
published: true
excerpt: null
tags:
  - 翻译
  - Transformer
  - 图解
---
# The Illustrated Transformer 中文翻译

> 原文：https://jalammar.github.io/illustrated-transformer/
> 作者：Jay Alammar（"一次一个概念地可视化机器学习"）
> 本文为忠实完整翻译；原文中的图（Image 1~37）均为文字说明并注明原图位置，详见原站。

---

## 引言

在[上一篇博文中，我们了解了 Attention](https://jalammar.github.io/visualizing-neural-machine-translation-mechanics-of-seq2seq-models-with-attention/)——现代深度学习模型中无处不在的方法。Attention 是一个帮助提升神经机器翻译应用性能的概念。在本文中，我们将了解**Transformer**——一个用 attention 来加速模型训练速度的模型。Transformer 在特定任务上超越了 Google 神经机器翻译模型。然而，它最大的好处在于 Transformer 非常适合**并行化**。事实上，Google Cloud 推荐使用 Transformer 作为参考模型来使用他们的 [Cloud TPU](https://cloud.google.com/tpu/) 产品。所以让我们试着拆开这个模型，看看它是如何运作的。

Transformer 是在论文 [Attention is All You Need](https://arxiv.org/abs/1706.03762) 中提出的。它的 TensorFlow 实现是 [Tensor2Tensor](https://github.com/tensorflow/tensor2tensor) 包的一部分。哈佛大学 NLP 组创建了[一份带 PyTorch 实现的论文注释指南](http://nlp.seas.harvard.edu/2018/04/03/attention.html)。在本文中，我们将尝试把事情过度简化一点，并一个一个地介绍这些概念，希望让没有深入知识的读者更容易理解。

**2025 更新**：我们构建了一个[免费的短视频课程](https://bit.ly/4aRnn7Z)，用动画把本文内容更新到最新（[视频 3](https://www.youtube.com/watch?v=k1ILy23t89E)）。

## 高层视角（A High-Level Look）

让我们先把模型看作一个黑盒。在机器翻译应用中，它输入一种语言的句子，输出另一种语言的翻译。

**（图 Image 2：Transformer 黑盒——输入英文句子，输出法文翻译）**

打开这个"擎天柱"般的黑盒，我们看到一个**编码组件**、一个**解码组件**，以及它们之间的连接。

**（图 Image 3：编码组件与解码组件及连接）**

编码组件是一堆 encoder（论文把 6 个叠在一起——数字 6 没有什么神奇之处，完全可以尝试其他排布）。解码组件是数量相同的 decoder 堆叠。

**（图 Image 4：encoder 堆叠与 decoder 堆叠）**

所有 encoder 结构相同（但它们**不共享权重**）。每个 encoder 分为两个子层：

**（图 Image 5：encoder 的两个子层——自注意力层 + 前馈神经网络）**

encoder 的输入首先经过一个**自注意力层（self-attention layer）**——这个层帮助 encoder 在编码某个特定词时，查看输入句子中的其他词。我们稍后会更仔细地看自注意力。

自注意力层的输出被送入**前馈神经网络**。完全相同的前馈网络独立地应用于每个位置。

decoder 也有这两个层，但在它们之间还有一个**注意力层**，帮助 decoder 聚焦于输入句子的相关部分（类似 seq2seq 模型中 attention 的作用）。

**（图 Image 6：decoder 的结构——含 masked 自注意力、encoder-decoder 注意力、前馈层）**

## 把张量引入画面（Bringing The Tensors Into The Picture）

现在我们已经看到了模型的主要组件，让我们看看各个向量/张量是如何在这些组件之间流动，把一个已训练模型的输入变成输出的。

与一般 NLP 应用一样，我们首先用[嵌入算法](https://medium.com/deeper-learning/glossary-of-deep-learning-word-embedding-f90c3cec34ca)把每个输入词变成向量。

**（图 Image 7：每个词被嵌入为 512 维向量）**

每个词被嵌入成一个 512 维的向量。我们用这些简单的方块来表示这些向量。

嵌入只发生在最底层的 encoder。所有 encoder 共同的抽象是：它们都接收一个向量列表，每个向量大小为 512——在最底层 encoder 里是词嵌入，而在其他 encoder 里，则是正下方 encoder 的输出。这个列表的大小是我们可以设置的超参数——基本上就是训练数据集中最长句子的长度。

把输入序列的词嵌入之后，每个词都会流过 encoder 的两个层。

**（图 Image 8：带张量的 encoder——每个位置的词流过自注意力层与前馈层）**

从这里我们开始看到 Transformer 的一个关键性质：**每个位置的词在 encoder 中走自己的路径**。这些路径在自注意力层中有依赖关系。然而前馈层没有这些依赖，因此在流过前馈层时，各种路径可以**并行**执行。

接下来，我们把例子换成一个更短的句子，看看 encoder 每个子层里到底发生了什么。

## 现在我们开始编码！（Now We're Encoding!）

如前所述，encoder 接收一个向量列表作为输入。它通过把这些向量传入"自注意力"层，然后传入前馈神经网络来处理这个列表，然后把输出向上发送给下一个 encoder。

**（图 Image 9：每个位置的词先经过自注意力过程，再各自独立经过同一个前馈网络）**

## 高层自注意力（Self-Attention at a High Level）

别被我随口抛出"自注意力"这个词给骗了，好像它是人人都该熟悉的概念。我自己在读到 Attention is All You Need 论文之前也从未遇到过这个概念。让我们蒸馏一下它是怎么运作的。

假设下面这句话是我们想翻译的输入句子：

"The animal didn't cross the street because it was too tired"（动物没有过马路，因为它太累了）

这句话里的 "it" 指的是什么？是指 street（马路）还是 animal（动物）？对人类来说这是个简单的问题，但对算法来说就没那么简单了。

当模型处理 "it" 这个词时，自注意力让它把 "it" 与 "animal" 关联起来。

当模型处理每个词（输入序列中的每个位置）时，自注意力让它查看输入序列中的其他位置，寻找有助于更好编码当前词的线索。

如果你熟悉 RNN，想想 RNN 是如何通过维护隐藏状态，把之前处理过的词/向量的表示与当前正在处理的词结合起来的。自注意力就是 Transformer 用来把其他相关词的"理解"烘焙进当前处理词的表示中的方法。

**（图 Image 10：编码第 5 个 encoder 中的 "it" 时，部分注意力集中在 "The Animal" 上，并把其表示的一部分烘焙进 "it" 的编码中）**

一定要看看 [Tensor2Tensor notebook](https://colab.research.google.com/github/tensorflow/tensor2tensor/blob/master/tensor2tensor/notebooks/hello_t2t.ipynb)，你可以加载一个 Transformer 模型，并用这种交互式可视化来检查它。

## 自注意力详解（Self-Attention in Detail）

让我们先看看如何用向量计算自注意力，然后再看它实际是如何用矩阵实现的。

计算自注意力的**第一步**，是从每个 encoder 的输入向量（这里即每个词的嵌入）创建三个向量。也就是说，对每个词，我们创建一个 **Query 向量**、一个 **Key 向量**和一个 **Value 向量**。这些向量是通过把嵌入乘以三个我们训练过程中学到的矩阵得到的。

注意这些新向量的维度比嵌入向量小。它们的维度是 64，而嵌入向量和 encoder 输入/输出向量的维度是 512。它们**不一定**要更小，这是一个架构选择，目的是让多头注意力的计算（基本）恒定。

**（图 Image 11：x1 乘以 WQ 权重矩阵产生 q1，即与该词关联的"query"向量。我们最终为输入句子的每个词创建 "query"、"key"、"value" 投影）**

什么是 "query"、"key"、"value" 向量？

它们是用于计算和思考注意力的有用抽象。一旦你继续读完下面的注意力计算方法，你基本上就知道每个向量扮演的角色了。

计算自注意力的**第二步**是计算一个分数。假设我们在计算这个例子中第一个词 "Thinking" 的自注意力。我们需要对输入句子的每个词与这个词打分。这个分数决定了当我们在某个位置编码一个词时，要对输入句子的其他部分投入多少关注。

分数是通过把 **query 向量**与所打分词的 **key 向量**做点积计算的。所以如果我们在处理位置 #1 的词的注意力，第一个分数就是 q1 和 k1 的点积，第二个分数就是 q1 和 k2 的点积。

**（图 Image 12：q1 与每个 k 的点积得到分数）**

**第三和第四步**，是把分数除以 8（论文中使用的 key 向量维度的平方根——64 的平方根。这会让梯度更稳定。这里可能有其他取值，但这是默认值），然后把结果通过 softmax 操作。Softmax 对分数归一化，使它们全部为正且加起来等于 1。

**（图 Image 13：softmax 归一化）**

这个 softmax 分数决定了每个词在这个位置被表达多少。显然，当前位置的词会获得最高的 softmax 分数，但有时关注另一个与当前词相关的词也是有用的。

**第五步**，把每个 value 向量乘以 softmax 分数（为求和做准备）。直觉是：保持我们想关注的词的 value 完整，淹没不相关的词（例如把它们乘以 0.001 这样的小数）。

**第六步**，把加权后的 value 向量求和。这就产生了该位置（第一个词）自注意力层的输出。

**（图 Image 14：自注意力输出）**

这就是自注意力计算的整个过程。得到的向量可以送入前馈神经网络。然而在实际实现中，这个计算是以矩阵形式完成的，以便更快处理。既然我们已经看到了词级别的计算直觉，现在来看看矩阵形式吧。

## 自注意力的矩阵计算（Matrix Calculation of Self-Attention）

**第一步**是计算 Query、Key、Value 矩阵。我们把嵌入打包进矩阵 $X$，乘以我们训练好的权重矩阵（$W^Q$、$W^K$、$W^V$）。

**（图 Image 15：X 矩阵的每一行对应输入句子中的一个词；注意嵌入向量（512）与 q/k/v 向量（64）的大小差异）**

**最后**，既然我们在处理矩阵，我们可以把第二步到第六步压缩成一个公式来计算自注意力层的输出：

$$
\mathrm{Attention}(Q,K,V) = \mathrm{softmax}\left(\frac{QK^{T}}{\sqrt{d_k}}\right)V
$$

**（图 Image 16：矩阵形式的自注意力计算公式）**

## 多头怪兽（The Beast With Many Heads）

论文进一步用名为"多头"注意力的机制精化了自注意力层。这在两个方面提升了注意力层的性能：

1. **它扩展了模型关注不同位置的能力。** 是的，在上面的例子里，$z_1$ 包含一点其他所有编码，但它可能被词本身主导。如果我们在翻译 "The animal didn't cross the street because it was too tired" 这样的句子，知道 "it" 指代哪个词会很有用。

2. **它给注意力层多个"表示子空间"。** 正如我们接下来要看到的，多头注意力不仅有 1 组，而是多组 Query/Key/Value 权重矩阵（Transformer 使用 8 个注意力头，所以每个 encoder/decoder 有 8 组）。每组随机初始化。训练后，每组被用来把输入嵌入（或来自下层 encoder/decoder 的向量）投影到不同的表示子空间。

**（图 Image 17：多头注意力——每个头维护独立的 Q/K/V 权重矩阵，得到不同的 Q/K/V 矩阵）**

如果我们对上述自注意力计算做 8 次，只是权重矩阵不同，最终得到 8 个不同的 $Z$ 矩阵。

**（图 Image 18：8 个不同的 Z 矩阵）**

这给我们留下了一点挑战。前馈层不期望 8 个矩阵——它期望一个矩阵（每个词一个向量）。所以我们需要一种方法把这 8 个压缩成一个矩阵。

怎么做呢？我们把矩阵拼接，再乘以一个额外的权重矩阵 $W^O$。

**（图 Image 19：拼接 8 个 Z 矩阵，乘以 W^O 得到最终输出）**

这就是多头自注意力的全部内容。我意识到这是相当多的矩阵。让我试着把它们全部放在一张图里，方便一起查看。

**（图 Image 20：多头自注意力总览——Q/K/V 投影、8 头并行计算、拼接 + W^O）**

既然我们已经接触了注意力头，让我们回到之前的例子，看看编码我们例句中 "it" 这个词时，不同的注意力头在关注什么：

**（图 Image 21：编码 "it" 时，一个注意力头最关注 "the animal"，另一个关注 "tired"——某种意义上，"it" 的表示同时烘焙了 "animal" 和 "tired" 的部分表示）**

然而，如果把所有注意力头加进画面，事情可能更难解读：

**（图 Image 22：全部注意力头的可视化，难以解读）**

## 用位置编码表示序列顺序（Representing The Order of The Sequence Using Positional Encoding）

我们目前描述的模型还缺少一个东西：**考虑输入序列中词顺序**的方法。

为了解决这个问题，Transformer 给每个输入嵌入**加一个向量**。这些向量遵循模型学到的特定模式，帮助它确定每个词的位置，或序列中不同词之间的距离。直觉是：把这些值加到嵌入上，一旦嵌入被投影成 Q/K/V 向量并在点积注意力中，就为嵌入向量之间提供了有意义的距离。

**（图 Image 23：为了给模型词的顺序感，我们添加遵循特定模式的位置编码向量）**

如果我们假设嵌入维度为 4，实际的位置编码会是这样：

**（图 Image 24：玩具嵌入大小 4 的真实位置编码示例）**

这个模式可能是什么样的呢？

在下面的图中，每行对应一个向量的位置编码。所以第一行是我们加到输入序列第一个词嵌入上的向量。每行包含 512 个值——每个值在 1 到 -1 之间。我们给它们上了色，让模式可见。

**（图 Image 25：20 个词（行）× 512 嵌入维度（列）的真实位置编码。可以看到它看起来沿中心分成两半。因为左半部分的值由一个函数生成（用 sine），右半部分由另一个函数生成（用 cosine），然后拼接形成每个位置编码向量）**

位置编码的公式在论文（3.5 节）中描述。你可以在 [`get_timing_signal_1d()`](https://github.com/tensorflow/tensor2tensor/blob/23bd23b9830059fbc349381b70d9429b5c40a139/tensor2tensor/layers/common_attention.py) 中看到生成位置编码的代码。这不是唯一可能的位置编码方法。然而，它的优势在于能够**扩展到未见过的序列长度**（例如，如果我们训练好的模型被要求翻译一个比训练集里任何句子都长的句子）。

**2020 年 7 月更新**：上面展示的位置编码来自 Tensor2Tensor 对 Transformer 的实现。论文中展示的方法略有不同——它不直接拼接，而是把两个信号**交织**。下图展示了这一点。[这里是生成它的代码](https://github.com/jalammar/jalammar.github.io/blob/master/notebookes/transformer/transformer_positional_encoding_graph.ipynb)：

**（图 Image 26：论文版位置编码——sin 与 cos 信号交织而非拼接）**

## 残差（The Residuals）

在继续之前，我们需要提到 encoder 架构中的一个细节：每个 encoder 的每个子层（自注意力、前馈）周围都有**残差连接**，后面跟着一个[层归一化](https://arxiv.org/abs/1607.06450)步骤。

**（图 Image 27：Add & Norm——每个子层后是残差连接 + 层归一化）**

如果我们可视化自注意力相关的向量和层归一化操作，它会是这样：

**（图 Image 28：自注意力子层的残差 + LayerNorm 可视化）**

这对 decoder 的子层也一样。如果我们想象一个 2 层 encoder 和 2 层 decoder 的 Transformer，它看起来会是这样：

**（图 Image 29：2 encoder + 2 decoder 的完整残差与归一化结构）**

## 解码器一侧（The Decoder Side）

现在我们已经覆盖了 encoder 侧的大部分概念，基本上也知道 decoder 的组件是如何工作的了。但让我们看看它们是如何协同工作的。

encoder 从处理输入序列开始。最顶层 encoder 的输出被转换为一组注意力向量 $K$ 和 $V$。这些向量将被每个 decoder 在它的"encoder-decoder attention"层中使用，帮助 decoder 聚焦于输入序列中合适的位置：

**（图 Image 30：编码阶段完成后，顶层 encoder 输出被转换成 K 和 V，供 decoder 使用）**

完成编码阶段后，我们开始解码阶段。解码阶段的每一步输出输出序列中的一个元素（这里是英文翻译句子）。

以下步骤重复进行，直到到达一个特殊的 `<end of sentence>` 符号，表示 Transformer decoder 已完成输出。每一步的输出在下一个时间步被送入最底部的 decoder，decoder 像 encoder 一样向上冒泡它们的解码结果。正如我们对 encoder 输入所做的那样，我们对这些 decoder 输入做嵌入并加上位置编码，以指示每个词的位置。

**（图 Image 31：解码逐步生成——上一步输出作为下一步输入，直到产生结束符号）**

decoder 中的自注意力层与 encoder 中的操作方式略有不同：

在 decoder 中，自注意力层**只被允许关注输出序列中更早的位置**。这是通过在自注意力计算的 softmax 步骤之前**掩蔽未来位置**（把它们设为 `-inf`）实现的。

"Encoder-Decoder Attention" 层的工作原理与多头自注意力一样，只是它的 Query 矩阵来自它下面的层，而 Key 和 Value 矩阵来自 encoder 堆叠的输出。

## 最终的 Linear 和 Softmax 层（The Final Linear and Softmax Layer）

decoder 堆叠输出一个浮点数向量。我们怎么把它变成一个词呢？这是最终 **Linear 层**的工作，后面跟着 **Softmax 层**。

Linear 层是一个简单的全连接神经网络，它把 decoder 堆叠产生的向量投影到一个**大得多**的向量，称为 **logits 向量**。

假设我们的模型知道 10,000 个独特的英文词（模型的"输出词汇表"），从训练数据集中学到。这将使 logits 向量有 10,000 个单元宽——每个单元对应一个独特词的分数。这就是我们在 Linear 层之后解读模型输出的方式。

**（图 Image 32：从 decoder 输出向量 → Linear 层 → logits 向量 → softmax → 输出词）**

然后 softmax 层把这些分数变成概率（全为正，加起来为 1.0）。选择概率最高的单元，与之关联的词作为该时间步的输出。

## 训练回顾（Recap Of Training）

既然我们已经覆盖了训练好的 Transformer 的完整前向过程，看一眼训练模型的直觉会很有用。

训练期间，未训练的模型会经历完全相同的前向过程。但由于我们在带标签的训练数据集上训练，我们可以把它的输出与正确的实际输出进行比较。

为了可视化，假设我们的输出词汇表只包含 6 个词（"a"、"am"、"i"、"thanks"、"student" 和 `<eos>`（"end of sentence" 的缩写））。

**（图 Image 33：输出词汇表在开始训练前的预处理阶段创建）**

一旦定义了输出词汇表，我们就可以用同样宽度的向量来表示词汇表中的每个词。这也被称为 **one-hot 编码**。例如，我们可以用下面的向量表示 "am" 这个词：

**（图 Image 34：输出词汇表的 one-hot 编码示例）**

回顾完这些，让我们讨论模型的**损失函数**——训练阶段我们要优化的指标，以得到一个训练好的、希望是非常准确的模型。

## 损失函数（The Loss Function）

假设我们在训练模型。假设这是训练阶段的第一步，我们在训练一个简单例子——把 "merci" 翻译成 "thanks"。

这意味着，我们想要输出是一个指示 "thanks" 这个词的概率分布。但由于这个模型还没有训练，这种情况还不太可能发生。

**（图 Image 35：未训练模型产生每个单元/词任意值的概率分布；与真实输出比较，用反向传播调整权重使输出接近期望输出）**

由于模型的参数（权重）都是随机初始化的，（未训练的）模型产生每个单元/词任意值的概率分布。我们可以把它与实际输出比较，然后用反向传播调整模型的所有权重，使输出更接近期望输出。

怎么比较两个概率分布呢？我们简单地把一个减去另一个。更多细节请看[交叉熵](https://colah.github.io/posts/2015-09-Visual-Information/)和[KL 散度](https://www.countbayesie.com/blog/2017/5/9/kullback-leibler-divergence-explained)。

但注意这是一个过度简化的例子。更现实地，我们会用比一个词长的句子。例如——输入："je suis étudiant"，期望输出："i am a student"。这实际意味着，我们希望模型依次输出概率分布，其中：

*   每个概率分布用一个宽度为 vocab_size 的向量表示（我们的玩具例子中是 6，但更现实的是 30,000 或 50,000 这样的数字）；
*   第一个概率分布在 "i" 关联的单元处概率最高；
*   第二个概率分布在 "am" 关联的单元处概率最高；
*   依此类推，直到第五个输出分布指示 `<end of sentence>` 符号（它也在 10,000 元素词汇表中有对应单元）。

**（图 Image 36：单个样本句子的训练目标概率分布序列）**

在足够大的数据集上训练足够长时间后，我们希望产生的概率分布看起来像这样：

**（图 Image 37：训练后模型输出的概率分布）**

希望训练后，模型会输出我们期望的正确翻译。当然，如果这个短语是训练数据集的一部分，这并不能真正说明什么（参见[交叉验证](https://www.youtube.com/watch?v=TIgfjmp-4BA)）。注意每个位置都得到一点概率，即使它不太可能是该时间步的输出——这是 softmax 的一个非常有用的性质，帮助训练过程。

现在，由于模型一次只产生一个输出，我们可以假设模型从概率分布中选择概率最高的词并丢弃其余部分。这是一种方法（称为**贪心解码 greedy decoding**）。另一种方法是，例如保留前两个词（比如 'I' 和 'a'），然后在下一步运行模型两次：一次假设第一个输出位置是 'I'，另一次假设第一个输出位置是 'a'，保留在位置 #1 和 #2 上误差更小的版本。我们对位置 #2 和 #3 重复这个过程……等等。这种方法称为**束搜索 beam search**，在我们的例子里 beam_size 是 2（意味着任何时候都保留两个部分假设（未完成的翻译）在内存中），top_beams 也是 2（意味着我们返回两个翻译）。这两个都是你可以实验的超参数。

## 去变形吧（Go Forth And Transform）

我希望你觉得这里是一个打破 Transformer 主要概念僵局的有用起点。如果你想深入，我建议这些下一步：

*   阅读 [Attention Is All You Need](https://arxiv.org/abs/1706.03762) 论文、Transformer 博客文章（[Transformer: A Novel Neural Network Architecture for Language Understanding](https://ai.googleblog.com/2017/08/transformer-novel-neural-network.html)）；
*   阅读 Harvard NLP 的 PyTorch 注释版（[The Annotated Transformer](http://nlp.seas.harvard.edu/2018/04/03/attention.html)）；
*   查看 [Tensor2Tensor 的 Transformer 代码](https://github.com/tensorflow/tensor2tensor/blob/master/tensor2tensor/models/transformer.py)；
*   观看 [Łukasz Kaiser 的讲解 Transformer 的讲座](https://www.youtube.com/watch?v=rBCqOTEfxvg)；
*   阅读[关于 Attention 的下一篇博文](https://jalammar.github.io/visualizing-neural-machine-translation-mechanics-of-seq2seq-models-with-attention/)。

---

*全文完。原文所有图见 https://jalammar.github.io/illustrated-transformer/*
