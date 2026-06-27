---
title: "LLaMA 超详细解读(paper & code)"
date: 2026-05-11
tags: []
---

# 04 LLaMA 超详细解读(paper & code)

**作者: JOYWIN**

**原文: **[https://zhuanlan.zhihu.com/p/632102048](https://zhuanlan.zhihu.com/p/632102048)

LLaMA 是目前为止，效果最好的开源 LLM 之一。精读 LLaMA 的论文及代码，可以很好的了解 LLM 的内部原理。本文对 LLaMA 论文进行了介绍，同时附上了关键部分的代码，并对代码做了注释。

## 1. **摘要**

LLaMA是一个系列模型，模型参数量从7B到65B。在大部分的任务上，LLaMA-13B强于GPT-3(175B)。LLaMA-65B的性能，可以和最好的LM相媲美，如Chinchilla-70B 和 PaLM-540B。

## 2. **一、引言**

一般而言，模型越大，效果越好。然而有文献指出[[1]](#ref_1)，当给定计算量的预算之后，最好的performance，并不是最大的模型，而是在一个小模型上用更多的数据进行训练。针对给定的计算量预算，scaling laws可以计算如何选择数据量的大小和模型的大小。然而这忽略了inference的预算，而这一点在模型推理时非常关键。当给定一个模型performance目标之后，最好的模型不是训练最快的模型，而是推理最快的模型。尽管在这种情况下，训练一个更大的模型成本会更低。

文献[[2]](#ref_2)中推荐，训练一个 10B 的模型，需要 200B 的 tokens，而本文的实验发现，一个7B的模型，经过 1T tokens 训练之后，performance 仍然在增加。本文的目标在于，通过在超大规模的数据上训练，给出一系列可能最好 performance 的 LLM。

## 2. 预训练数据

### 2.1 **2.1 数据集**

一共有1.4T的tokens，大部分的训练数据都只用了一次，除了Wikipedia 和 Books 使用了大概2个epochs。

![](./04-LLaMA超详细解读paper-and-code-images/image_0.jpg)

Pre-training data

### 2.2 **2.2 tokenizer**

使用byte pair encoding (BPE) 算法，使用的是Sentence-Piece的实现。所有数字被拆分为单独的digit，所有未知的UTF-8 字符，回退到字节来进行分解。因此，LLaMA 可以通过byte 的方式，构造出很多不在 vocab 中的字符，从而也具有较好的多语言能力。

## 3. 网络结构改进

使用了基于transformer的架构，并做了如下3点改进：

### 3.1 **3.1 Pre-normalization**

为了提高训练的稳定性，对每个transformer层的输入进行归一化，而不是输出进行归一化。

同时，使用 RMS Norm 归一化函数。RMS Norm 的全称为 Root Mean Square layer normalization。与 layer Norm 相比，RMS Norm的主要区别在于去掉了减去均值的部分，计算公式为：

\(\bar{a}_i=\frac{a_i}{\operatorname{RMS}(\mathbf{a})} g_i, \quad \text{where} \operatorname{RMS}(\mathbf{a})=\sqrt{\frac{1}{n} \sum_{i=1}^n a_i^2}\)

RMS Norm 的作者认为这种模式在简化了Layer Norm 的计算，可以在减少约 7%∼64% 的计算时间[[3]](#ref_3)。

### 3.2 **3.2 SwiGLU**

使用SwiGLU替代了ReLU作为激活函数。和PaLM中不同，维度采用 \frac 23 4d 而不是 4d 。

SwiGLU 在论文[[4]](#ref_4) 中提出，相比于其他的激活函数变体，可以取得 log-perplexity 的最优值(和 GEGLU 并列)。

![](./04-LLaMA超详细解读paper-and-code-images/image_1.jpg)

GLU Variants Improve Transformer

SwiGLU 及几种类似变体的计算公式如下：

![](./04-LLaMA超详细解读paper-and-code-images/image_2.jpg)

其中： \(\operatorname{Swish}_\beta(x)=x \sigma(\beta x) \)。代码如下：

从代码可以看到 LlamaMLP 中一共有 3 个 Linear 层，原因就在于 SwiGLU 激活函数比类似 ReLU 的激活函数，需要多一个 Linear 层进行门控。

### 3.3 **3.3 RoPE**

RoPE 的核心思想是“通过绝对位置编码的方式实现相对位置编码”，可以说是具备了绝对位置编码的方便性，同时可以表示不同 token 之间的相对位置关系。 [[5]](#ref_5)不同于原始 Transformers 论文中，将 pos embedding 和 token embedding 进行相加，RoPE 是将位置编码和 query (或者 key) 进行相乘。具体如下：

![](./04-LLaMA超详细解读paper-and-code-images/image_3.jpg)

Rotary Position Embedding

其中：左侧的矩阵 R_m 表示位置第 m 个位置的位置编码，右侧的向量 q_i 表示对应位置的 query 向量。两者相乘，即可得到增加了位置信息的 query (或者 key)。由于 R_m 的稀疏性，上述矩阵乘法可以等价于：

![](./04-LLaMA超详细解读paper-and-code-images/image_4.jpg)

Rotary Position Embedding 的简化实现

其中 ⊗ 是逐位对应相乘， \(\theta_i=1000^{-2i/d}\) 。

RoPE的代码实现如下[[6]](#ref_6)：

## 4. 高效实现

### 4.1 **加速训练：**

- 使用了xformers库。- 减少了activation checkpointing 中，重新计算 activation 的计算量。手动实现 transformer 层的反向传递函数，保存了计算成本高的 activations，例如线性层的输出。- 通过使用 model parallelism 和 sequence parallelism 来减少显存的使用量。- 尽可能地将 activations 的计算和GPU之间的通讯进行并行。

### 4.2 **加速效果：**

- 65B的模型，在2048个80G的A100 GPU上，可以达到380 tokens/sec/GPU的速度。训练1.4T tokens需要21天。

## 5. 主要结果与结论

![](./04-LLaMA超详细解读paper-and-code-images/image_5.jpg)

Massive Multitask LanguageUnderstanding

LLaMA-13B 优于 GPT-3，尽管只有1/10大小。 LLaMA-65B 是可以与 Chinchilla-70B 和 PaLM-540B 这种最佳的LLM相竞争的模型。经过微调之后，LLaMA的效果有显著的提升。

未来打算发布在更大的语料上预训练上的更大的模型，因为随着数据和模型的增大，可以看到 performance 的稳定提升。

## 6. 参考

1. [^](#ref_1_0)Training Compute-Optimal Large Language Models [https://arxiv.org/abs/2203.15556](https://arxiv.org/abs/2203.15556)2. [^](#ref_2_0)Training Compute-Optimal Large Language Models [https://arxiv.org/abs/2203.15556](https://arxiv.org/abs/2203.15556)3. [^](#ref_3_0)Root Mean Square Layer Normalization [https://arxiv.org/pdf/1910.07467.pdf](https://arxiv.org/pdf/1910.07467.pdf)4. [^](#ref_4_0)GLU Variants Improve Transformer [https://arxiv.org/pdf/2002.05202.pdf](https://arxiv.org/pdf/2002.05202.pdf)5. [^](#ref_5_0)Transformer升级之路：2、博采众长的旋转式位置编码 [https://spaces.ac.cn/archives/8265](https://spaces.ac.cn/archives/8265)6. [^](#ref_6_0)[https://github.com/huggingface/transformers/blob/main/src/transformers/models/llama/modeling_llama.py#L91](https://github.com/huggingface/transformers/blob/main/src/transformers/models/llama/modeling_llama.py#L91)