---
title: "llama模型架构特点"
date: 2026-05-11
tags: []
---

# 09 llama模型架构特点

**作者: 张十六**

**原文: https://zhuanlan.zhihu.com/p/9526634466**

## 1. **Decoder-Only 架构**

![](./09-llama模型架构特点-images/image_0.jpg)

## 2. 参数量：

llama 2: 7B / 13B / 70B

llama3: 8B / 70B

![](./09-llama模型架构特点-images/image_1.jpg)

**加速训练：**

- 使用了[xformers](https://zhida.zhihu.com/search?content_id=250928134&content_type=Article&match_order=1&q=xformers&zhida_source=entity)库。- 减少了activation checkpointing 中，重新计算 [activation](https://zhida.zhihu.com/search?content_id=250928134&content_type=Article&match_order=2&q=activation&zhida_source=entity) 的计算量。手动实现 transformer 层的[反向传递函数](https://zhida.zhihu.com/search?content_id=250928134&content_type=Article&match_order=1&q=%E5%8F%8D%E5%90%91%E4%BC%A0%E9%80%92%E5%87%BD%E6%95%B0&zhida_source=entity)，保存了计算成本高的 activations，例如线性层的输出。- 通过使用 model parallelism 和 sequence parallelism 来减少[显存](https://zhida.zhihu.com/search?content_id=250928134&content_type=Article&match_order=1&q=%E6%98%BE%E5%AD%98&zhida_source=entity)的使用量。- 尽可能地将 [activations](https://zhida.zhihu.com/search?content_id=250928134&content_type=Article&match_order=2&q=activations&zhida_source=entity) 的计算和GPU之间的通讯进行并行。

**Tokenizer** 
使用byte pair encoding (BPE) 算法，使用的是Sentence-Piece的实现。所有数字被拆分为单独的digit，所有未知的UTF-8 字符，回退到字节来进行分解。因此，LLaMA 可以通过byte 的方式，构造出很多不在 vocab 中的字符，从而也具有较好的多语言能力。

## 3. [归一化方法](https://zhida.zhihu.com/search?content_id=250928134&content_type=Article&match_order=1&q=%E5%BD%92%E4%B8%80%E5%8C%96%E6%96%B9%E6%B3%95&zhida_source=entity)RMSNorm

主要是将[transformer](https://zhida.zhihu.com/search?content_id=250928134&content_type=Article&match_order=2&q=transformer&zhida_source=entity)中的LayerNorm换成了RMSNorm。

原论文在这里[[1910.07467] Root Mean Square Layer Normalization (arxiv.org)](https://link.zhihu.com/?target=https%3A//arxiv.org/abs/1910.07467)

RMSNorm是对Layer Norm之上的的简化，它通过舍弃中心不变性来降低计算量。

RMSNorm移除了LayerNorm中的均值项(由于没有计算均值，所以[方差](https://zhida.zhihu.com/search?content_id=250928134&content_type=Article&match_order=1&q=%E6%96%B9%E5%B7%AE&zhida_source=entity)计算也没有了减去均值的操作)

它的计算效率更高。减少了约40%的计算时间。

pre RMSNorm

where layer normalization is applied before the residual connections, enhancing training stability and convergence.

layer norm：减去样本的均值，除以样本的方差，使得整体样本不要太分散。

RMS(root mean square) Norm：去除了减去均值的操作，也就是没有[去中心化](https://zhida.zhihu.com/search?content_id=250928134&content_type=Article&match_order=1&q=%E5%8E%BB%E4%B8%AD%E5%BF%83%E5%8C%96&zhida_source=entity)的操作，只有缩放的操作。RMSnorm就是均值为0的 [layer norm](https://zhida.zhihu.com/search?content_id=250928134&content_type=Article&match_order=3&q=layer+norm&zhida_source=entity)。**优点：** 没有了去中心化的操作，可以提升运行效率

Layer norm 公式：

\(y = \frac{x-mean(x)}{\sqrt{var(x)}}*W +B\)

RMS-norm 公式

\(RMS(a) = \sqrt{\frac{1}{n}\sum_1^na_i^2}\)

\(y = \frac{x}{\sqrt{Mean(x^2)+\epsilon}}*W\)

RMSNorm 是 pre norm 前置归一， 对每个transformer层的输入进行归一化，而不是输出进行归一化。有助于提升训练的稳定性。

原始的transformer论文中的add&norm是[post norm](https://zhida.zhihu.com/search?content_id=250928134&content_type=Article&match_order=1&q=post+norm&zhida_source=entity)。

### 3.1 post norm 和 pre norm

![](./09-llama模型架构特点-images/image_2.jpg)

RMSNorm 是 pre norm

原始的transformer论文中的add&norm是post norm。

同一设置之下，Pre Norm结构往往更容易训练，但最终效果通常不如Post Norm。

Pre Norm的深度有“水分”！

也就是说，一个L层的Pre Norm模型，其实际等效层数不如L层的Post Norm模型; 而因为pre Norm实际层数少了导致效果变差了。

多层的优势在于可以在不同的抽象层次上学习特征，随着层数的增加，每个神经元相对于前一层的[感受野](https://zhida.zhihu.com/search?content_id=250928134&content_type=Article&match_order=1&q=%E6%84%9F%E5%8F%97%E9%87%8E&zhida_source=entity)变得越来越大，因此深层可以提供全局语义和抽象细节的信息，这是宽层很难做到的。

那么再根据上面公式推导的结论，说白了，Pre Norm结构无形地增加了模型的宽度而降低了模型的深度，所以在无形之中的降低深度导致最终效果变差了。

## 4. [注意力机制](https://zhida.zhihu.com/search?content_id=250928134&content_type=Article&match_order=1&q=%E6%B3%A8%E6%84%8F%E5%8A%9B%E6%9C%BA%E5%88%B6&zhida_source=entity)MQA( Multi Query Attention

Multi-Head Attention换成了GQA(llama是MQA)。

MQA，全称 Multi Query Attention,

所有 Q 头共享一组 KV， 可以减少显存占用。

1. **降低了从内存中读取的数据量**，所以也就减少了计算单元等待时间，提高了计算利用率; 2. KV cache 变小了 head_num 倍，也就是显存中需要保存的 [tensor](https://zhida.zhihu.com/search?content_id=250928134&content_type=Article&match_order=1&q=tensor&zhida_source=entity) 变小了，**空出来空间就可以加大 batch size**，从而又能提高利用率。

### 4.1 为什么要MQA (Multi query attention)

在[模型结构](https://zhida.zhihu.com/search?content_id=250928134&content_type=Article&match_order=1&q=%E6%A8%A1%E5%9E%8B%E7%BB%93%E6%9E%84&zhida_source=entity)和参数比较简单的手， 多个head的 KV都能够直接存在缓存中。

但对于大模型，**KV 根本就存不进缓存**。

比如 Llama 7B 模型，[hidden size](https://zhida.zhihu.com/search?content_id=250928134&content_type=Article&match_order=1&q=hidden+size&zhida_source=entity) 是 4096，那么每个 timestep 需缓存参数量为 4096*2*32=262144，假设[半精度保存](https://zhida.zhihu.com/search?content_id=250928134&content_type=Article&match_order=1&q=%E5%8D%8A%E7%B2%BE%E5%BA%A6%E4%BF%9D%E5%AD%98&zhida_source=entity)就是 512KB，1024 长度那就要 512MB. 而现在[英伟达](https://zhida.zhihu.com/search?content_id=250928134&content_type=Article&match_order=1&q=%E8%8B%B1%E4%BC%9F%E8%BE%BE&zhida_source=entity)最好的卡 H100 的 SRAM 缓存大概是 50MB，而 A100 则是 40MB. 而 7B 模型都这样，175B 模型就更不用说了。

于是退一步，放不进缓存可以放 DRAM 上去，而 DRAM 内存也就是我们常说的 GPU 显存。

![](./09-llama模型架构特点-images/image_3.jpg)

## 5. GQA (Group Query Attention

llama3为 GQA。

GQA 是前段时间 Google 提出的 MQA 变种，全称 Group-Query Attention.

而 GQA 呢，是 MHA 和 MQA 的折衷方案，既不想损失性能太多，又想获得 MQA 带来的推理加速好处。具体思想是，不是所有 Q 头共享一组 KV，而是**分组一定头数 Q 共享一组 KV**，比如上面图片就是两组 Q 共享一组 KV。

分为多组Q向量不同，共享kv。

## 6. **旋转位置编码**RoPE(Rotary Position Encoding)

postionnal换成了RotatyEmbedding(RoPE[相对位置编码](https://zhida.zhihu.com/search?content_id=250928134&content_type=Article&match_order=1&q=%E7%9B%B8%E5%AF%B9%E4%BD%8D%E7%BD%AE%E7%BC%96%E7%A0%81&zhida_source=entity))。

RoPE 的核心思想是“通过[绝对位置编码](https://zhida.zhihu.com/search?content_id=250928134&content_type=Article&match_order=1&q=%E7%BB%9D%E5%AF%B9%E4%BD%8D%E7%BD%AE%E7%BC%96%E7%A0%81&zhida_source=entity)的方式实现相对位置编码”，可以说是具备了绝对位置编码的方便性，同时可以表示不同 token 之间的相对位置关系。

绝对位置编码的优点是计算速度快等，缺点是拓展长度比较麻烦，且绝对位置并没有什么实际意义。 
而相对位置编码对学习token之间的关系很有意义，比如距离的很远的两个token之间的关联大概率很小，使用相对位置编码往往能够获得更好的效果。

不同于原始 Transformers 论文中，将 pos embedding 和 [token embedding](https://zhida.zhihu.com/search?content_id=250928134&content_type=Article&match_order=1&q=token+embedding&zhida_source=entity) 进行相加。

RoPE 是将[位置编码](https://zhida.zhihu.com/search?content_id=250928134&content_type=Article&match_order=9&q=%E4%BD%8D%E7%BD%AE%E7%BC%96%E7%A0%81&zhida_source=entity)和 query (或者 key) 进行相乘。先将位置信息注入到Q和k中，再进行[内积运算](https://zhida.zhihu.com/search?content_id=250928134&content_type=Article&match_order=1&q=%E5%86%85%E7%A7%AF%E8%BF%90%E7%AE%97&zhida_source=entity)。

目的是使Q和K相乘的结果只与相对位置有关、与绝对位置无关，特点是在在长上下文场景下表现更好。

这种方法能够更有效地捕捉序列中的位置信息，具有[长度外推性](https://zhida.zhihu.com/search?content_id=250928134&content_type=Article&match_order=1&q=%E9%95%BF%E5%BA%A6%E5%A4%96%E6%8E%A8%E6%80%A7&zhida_source=entity)。

对处理较长序列的效果好，计算效率提升。

长度外推性 
是指在[短序列](https://zhida.zhihu.com/search?content_id=250928134&content_type=Article&match_order=1&q=%E7%9F%AD%E5%BA%8F%E5%88%97&zhida_source=entity)上训练的模型能够应用于 [长序列](https://zhida.zhihu.com/search?content_id=250928134&content_type=Article&match_order=2&q=%E9%95%BF%E5%BA%8F%E5%88%97&zhida_source=entity)并保持较好效果的能力。具体来说，这意味着模型可以在较短的数据集上进行训练，然后成功地处理比训练数据更长的序列。

## 7. **激活函数**SwiGLU(Swish-Gated Linear Unit)

保持非线性特性的同时，增加模型的表达能力

Swish同样是个处处可微的[非线性函数](https://zhida.zhihu.com/search?content_id=250928134&content_type=Article&match_order=1&q=%E9%9D%9E%E7%BA%BF%E6%80%A7%E5%87%BD%E6%95%B0&zhida_source=entity)，且有一个参数beta用于 [控制函数](https://zhida.zhihu.com/search?content_id=250928134&content_type=Article&match_order=1&q=%E6%8E%A7%E5%88%B6%E5%87%BD%E6%95%B0&zhida_source=entity)的形状。

效果类似平滑版的ReLU.

\(SwishGLU(x) = sigmod(x)*x\)

不同于传统FFN的2个矩阵，SwiGLU有三个矩阵，因此缩小了隐藏层维度，由原来的4倍变成8/3倍。

![](./09-llama模型架构特点-images/image_4.png)

## 8. LLAMA和其他模型的结构差异

### 8.1 chatglm2

GLM在原始single Transformer的基础上进行了一些修改：

1)重组了LN和[残差](https://zhida.zhihu.com/search?content_id=250928134&content_type=Article&match_order=1&q=%E6%AE%8B%E5%B7%AE&zhida_source=entity)连接的顺序; 

2)使用单个[线性层](https://zhida.zhihu.com/search?content_id=250928134&content_type=Article&match_order=2&q=%E7%BA%BF%E6%80%A7%E5%B1%82&zhida_source=entity)对输出token进行预测; 

ChatGLM的亮点主要还是他的模型设计，融合了自编码、[自回归](https://zhida.zhihu.com/search?content_id=250928134&content_type=Article&match_order=1&q=%E8%87%AA%E5%9B%9E%E5%BD%92&zhida_source=entity)、encoder-decoder各类思想，并且有精妙的span设计:

自回归：**采样span进行单向自回归预测，A为mask后文本，B为span**

自编码：**A、B互不可见，但内部可见，B单向可见**

- MQA(ChatGLM2

让 Q 仍然保持原来的头数，但 K 和 V 只有一个头，相当于所有的 Q 头共享一组 K 和 V 头。

Flash attention:(ChatGLM2

简单的说就是，计算softmax时候不需要全量input数据，可以分段计算;  反向传播的时候，不存储attention matrix (N^2的矩阵)，而是只存储softmax归一化的系数。

激活函数：GeLU

### 8.2 百川

llama 的 qkv 三个[权重矩阵](https://zhida.zhihu.com/search?content_id=250928134&content_type=Article&match_order=1&q=%E6%9D%83%E9%87%8D%E7%9F%A9%E9%98%B5&zhida_source=entity)，在 baichuan 里变成了一个矩阵，相当于 qkv concat 起来

[激活函数](https://zhida.zhihu.com/search?content_id=250928134&content_type=Article&match_order=3&q=%E6%BF%80%E6%B4%BB%E5%87%BD%E6%95%B0&zhida_source=entity)：Baichuan 2使用了SwiGLU

Baichuan 2采用了由xFormers2实现的内存高效注意力

RMSNorm

Baichuan 2-7B上应用了RoPE，在Baichuan 2-13B上应用了ALiBi

**QWEN**

RoPE为位置编码

Bias：在QKV注意力层中添加了偏差，以增强模型的外推能力。

RMSNorm

SwiGLU激活函数

**Yi**

即便是LLaMA表现出了极大地跨语言能力，但是碍于LLaMA词表中的中文Token较少

![](./09-llama模型架构特点-images/image_5.jpg)