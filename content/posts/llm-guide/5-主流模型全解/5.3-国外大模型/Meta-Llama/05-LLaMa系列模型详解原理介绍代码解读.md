---
title: "LLaMa系列模型详解(原理介绍、代码解读)：LLaMa"
date: 2026-05-11
tags: []
---

# 05 LLaMa系列模型详解(原理介绍、代码解读)：LLaMa

**作者: 青云遮夜雨**

**原文: **[https://zhuanlan.zhihu.com/p/903529711](https://zhuanlan.zhihu.com/p/903529711)

LLaMA(Large Language Model Meta AI)是由Meta(前身为Facebook)开发的一种大规模语言模型，旨在提高自然语言处理(NLP)任务的性能。LLaMA基于变换器(Transformer)架构，并经过大规模数据训练，以便在多种语言任务中表现出色。

**Meta AI认为：对于给定的计算预算，最佳性能不是通过最大的模型实现的，而是通过在更多数据上训练的较小模型实现的。**

## 1. 模型结构

与GPT等生成模型类似，LLaMA也只使用了Transformer的Decoder  ，但基于Transformer进行了三个改进：

1. 使用了GPT3的预标准化。为了提高训练稳定性，对每个Transformer子层的输入进行归一化，而不是对输出进行归一化。使用由RMSNorm 归一化函数。 2. 用 SwiGLU 激活函数替换 ReLU 非线性，以提高性能。使用 \(\frac{2}{3}4d\) 的维度代替PaLM中的 4d 。 3. 类似GPTNeo，删除了绝对位置嵌入，而是添加了旋转位置嵌入(RoPE)。

下面逐一介绍这三个改进：

### 1.1 RMSNorm

RMSNorm(Root Mean Square Normalization)是一种归一化技术，用于稳定和加速神经网络的训练过程。与其他归一化方法(如BatchNorm和LayerNorm)不同，RMSNorm通过计算输入张量的均方根(RMS)来进行归一化。RMSNorm公式如下：  \(\text{RMSNorm}(x) = \frac{x}{\sqrt{\frac{1}{d} \sum_{i=1}^{d} x_i^2 + \epsilon}} \cdot \gamma\) 其中 xx 是输入向量， dd 是输入向量的维度， 是一个小常数，用于避免除零错误， 是一个可学习的缩放参数。

LLaMa中的实现如下：

### 1.2 SwiGLU激活函数

SwiGLU (Swish-Gated Linear Unit) 是一种用于神经网络的激活函数，它结合了Swish激活函数和[门控机制](https://zhida.zhihu.com/search?content_id=249048908&content_type=Article&match_order=1&q=%E9%97%A8%E6%8E%A7%E6%9C%BA%E5%88%B6&zhida_source=entity)，能够有效地增强模型的表达能力和性能。公式如下：

\(\text{SwiGLU}(x) = \text{Swish}(x) \cdot (\text{Gated Linear Unit}(x)) \\ \text{Swish}(x) = x \cdot \sigma(x) \\ \text{Gated Linear Unit}(x) = \text{Linear}_1(x) \cdot \sigma(\text{Linear}_2(x)) \sigma(x) = \frac{1}{1 + e^{-x}}\)

\(\text{Linear}_1\) 和 \(\text{Linear}_2\) 是两个单独的线性变换。

LLaMa代码中使用 F.silu(x) 添加SwiGLU激活函数

### 1.3 RoPE

旋转位置嵌入(Rotary Position Embedding, RoPE)是一种为序列模型(如Transformer)提供位置编码的方法。RoPE通过将输入向量在复数域进行旋转变换，来编码序列中位置的信息。与传统的位置编码方法(如正弦-余弦位置编码)相比，RoPE能够更好地捕捉序列中的相对位置信息，提高模型的表现力。

旋转位置嵌入(RoPE)是一种为序列模型提供位置编码的方法。其通过将输入向量在复数域进行旋转变换来编码位置信息。以下是RoPE的具体实现步骤： 1. 频率向量的计算: \(f_i = \frac{1}{\theta^{\frac{2i}{d}}}\) 其中 \theta 是一个常数(通常取 10000)， i 是向量维度的索引。

1. 旋转角度的计算: \(\text{angle}(t) = t \cdot f_i\)其中t是位置索引。2. 应用旋转变换: 对每个位置t的输入向量x_t，在复数域进行旋转变换： \(x_t' = x_t \cdot e^{j \cdot \text{angle}(t)}\)对于位置编码，常规的做法是在计算 query，key 和 value 向量之前，会计算一个位置编码向量 加到词嵌入上，位置编码向量同样也是维向量，然后再乘以对应的变换矩阵。 RoPE 的 self-attention 操作的流程是：对于 token 序列中的每个词嵌入向量，首先计算其对应的 query 和 key 向量，然后对每个 token 位置都计算对应的旋转位置编码，接着对每个 token 位置的 query 和 key 向量的元素按照**两两一组**应用旋转变换，最后再计算 query 和 key 之间的内积得到 self-attention 的计算结果。

下图很直观的展示了旋转变换的过程：

![](./05-LLaMa系列模型详解原理介绍代码解读-images/image_0.jpg)

​

旋转编码 RoPE 可以有效地保持位置信息的相对关系，**即相邻位置的编码之间有一定的相似性，而远离位置的编码之间有一定的差异性。** 这样可以增强模型对位置信息的感知和利用。这一点是其他绝对位置编码方式(如正弦位置编码、学习的位置编码等)所不具备的，因为它们只能表示绝对位置，而不能表示相对位置。

为什么旋转位置嵌入有效？ 1. 捕捉相对位置信息：传统的位置嵌入方法通常仅编码绝对位置，这可能在处理长序列或需要捕捉相对位置信息的任务中表现不佳。而RoPE通过旋转变换自然地引入了相对位置信息，使得模型能够更好地理解序列中各个位置之间的相对关系。 2. 由于RoPE通过复数域的旋转变换来编码位置，这种变换能够捕捉更加丰富的位置信息。相比于简单的线性变换，旋转变换提供了更强的非线性表达能力，使得模型在处理复杂任务时具有更好的表现力。 3. RoPE的计算相对简单，不需要复杂的矩阵运算。预计算频率向量和应用旋转变换的过程可以高效地实现，适合在实际应用中大规模部署。 4. RoPE能够无缝集成到现有的Transformer架构中，不需要对模型结构进行大的修改。这种兼容性使得RoPE成为一种易于应用和推广的位置编码方法。 5. 在长序列处理任务中，传统的位置编码方法可能会遇到信息稀释或计算复杂度增加的问题。RoPE通过引入旋转变换，可以更好地保持长序列中的位置信息，使得模型在长序列任务中表现更加稳定和高效。 6. (这一点是我的猜想)在高维向量中，方向是比模长更重要的量，常规位置编码直接在词嵌入上加上位置编码，相当于改变了模长，旋转位置编码改变了方向，实际上比常规位置编码多获得了一部分信息。

下面这篇文章给出了公式原理和推导，讲解十分详细：[点击此处](https://link.zhihu.com/?target=https%3A//blog.csdn.net/qq_27590277/article/details/132703524%3Fops_request_misc%3D%26request_id%3D%26biz_id%3D102%26utm_term%3DRoPE%26utm_medium%3Ddistribute.pc_search_result.none-task-blog-2~all~sobaiduweb~default-2-132703524.142%255Ev100%255Epc_search_result_base9%26spm%3D1018.2226.3001.4187)

在LLaMA中，RoPE使用下面的方式实现：

下面的代码给出了加入旋转位置嵌入的注意力机制：

接下来给出LLaMA实现的全部代码：