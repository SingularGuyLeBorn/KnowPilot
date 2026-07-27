---
title: "02 · ChatGLM结构解读"
date: 2026-05-11
tags: []
---

**作者: 微学AI**

**原文: **[链接](https://blog.csdn.net/weixin_42878111/article/details/134017313?utm_medium=distribute.pc_relevant.none-task-blog-2~default~baidujs_baidulandingword~default-2-134017313-blog-130908593.235%5Ev43%5Epc_blog_bottom_relevance_base7&spm=1001.2101.3001.4242.2&utm_relevant_index=5)** **

ChatGLM大模型的结构与核心代码解读，最全的ChatGLM模型架构介绍与源码解读，本文介绍将ChatGLM-6B的模型结构，与设计原理。 主要代码来自：[https://huggingface.co/THUDM/chatglm-6b/blob/main/modeling\_chatglm.py](https://huggingface.co/THUDM/chatglm-6b/blob/main/modeling%5C_chatglm.py) 
![](./02-ChatGLM结构解读-images/image_0.jpg)

## 1. ChatGLM模型介绍

ChatGLM-6B是有清华团队开发的开源大语言模型，可以用中文和英文进行问答对话。它有着62亿个参数，它采用了General Language Model ([GLM](https://so.csdn.net/so/search?q=GLM&spm=1001.2101.3001.7020))架构，并且通过模型量化技术，可以在普通的显卡上运行(只需6GB显存)。为了优化中文问答和对话，ChatGLM-6B经过了大约1T的中英双语训练，并结合了监督微调、反馈自助和人类反馈强化学习等技术。现在，这个具有62亿参数的ChatGLM-6B已经可以生成非常符合人类喜好的回答了。对于学术研究人员来说，ChatGLM-6B的权重是完全开放的，目前已经发展开发出ChatGLM2-6B，对模型有些升级与改造。

## 2. ChatGLM模型结构思想

### 2.1自回归空格填充的任务

ChatGLM模型引入了一种全新的自回归空格填充的任务，例如下图： 对原始的数据 x 1 , x 2 , x 3 , x 4 , x 5 , x 6 x_1,x_2,x_3,x_4,x_5,x_6 x1,x2,x3,x4,x5,x6，随机 m a s k mask mask了 x 3 x_3 x3和 x 5 , x 6 x_5,x_6 x5,x6，目标就是利用未 m a s k mask mask的来自回归式预测被 m a s k mask mask的信息。图 ( c ) (c) (c)可以看到，不同于 M L M MLM MLM的结构，这里通过两种位置编码，就能自回归式预测被 m a s k mask mask的信息。这里有 p o s i t i o n 1 position1 position1， p o s i t o n 2 positon2 positon2两种 p o s i t i o n position position， p o s i t i o n 1 position1 position1标记的是整体的位置信息;  p o s i t i o n 2 position2 position2标记的是每个被 m a s k mask mask的块内部的相对位置信息。在 ( d ) (d) (d)中就很清晰地展示出对于未被 m a s k mask mask的信息(用来做 p r o m p t prompt prompt的)，在计算self-attention的时候，全部没有 m a s k mask mask，也就是上下文都可见，对于第一块遮挡的信息 x 5 , x 6 x_5,x_6 x5,x6，自己区域内呈下三角形状，也就是自回归预测形式，第二块 m a s k mask mask的信息 x 3 x_3 x3，由于这时候 x 5 x_5 x5和 x 6 x_6 x6已经预测出来了，因此对于 x 3 x_3 x3也变得可见。 
![](./02-ChatGLM结构解读-images/image_1.jpg)

### 2.2 ChatGLM的激活函数选择

ChatGLM-6B使用的激活函数为GELU，其可以近似实现为： 
G E L U ( x ) ≈ 0.5 x ( 1 + tanh ⁡ ( 2 π ( x + 0.044715 x 3 ) ) ) GELU(x)\approx 0.5x(1+ \tanh(\sqrt{\frac{2}{\pi}}(x+0.044715x^{3}))) GELU(x)≈0.5x(1+tanh(π2 (x+0.044715x3)))

ChatGLM2-6B(升级版)模型则使用的 SwiGLU 激活函数：

其实在大模型LLaMA中全连接层也使用了SwiGLU 激活函数，它的计算公式如下： 
F F N S w i G L U ( x , W , V , W 2 ) = S w i G L U ( x , W , V ) W 2 FFN_{SwiGLU}(x,W,V,W_{2})=SwiGLU(x,W,V)W_{2} FFNSwiGLU(x,W,V,W2)=SwiGLU(x,W,V)W2 
S w i G L U ( x , W , V ) = S w i s h β ( x W ) ⊗ x V SwiGLU(x,W,V)=Swish_{\beta}(xW)\otimes xV SwiGLU(x,W,V)=Swishβ(xW)⊗xV 
S w i s h β ( x ) = x σ ( β x ) Swish_{\beta}(x)=x \sigma(\beta x) Swishβ(x)=xσ(βx) 
其中： σ ( x ) σ(x) σ(x)是 S i g m o i d Sigmoid Sigmoid函数。

## 3. ChatGLM模型的GLU层

ChatGLM定义了一个名为GLU模块。GLU通过将输入数据与由另一层计算出的“门”值相乘，来实现对输入数据的选择性过滤。设定特定版本的GLU模型首先将输入hidden_states通过一个线性变换(self.dense_h_to_4h)扩展到4倍的维度，然后对其应用激活函数。其中的激活函数是GELU。然后，它再次将结果投影回原始维度(self.dense_4h_to_h)。

## 4. ChatGLM的位置编码：RoPE

在位置编码上，ChatGLM使用旋转位置嵌入(Rotary Positional Embeddings，RoPE)代替原有的绝对位置编码。

RoPE借助了复数的思想，出发点是通过绝对位置编码的方式实现相对位置编码。其目标是通过下述运算来给 q , k q,k q,k添加绝对位置信息： 
q ~ m = f ( q , m ) , k ~ n = f ( k , n ) \tilde{q}_{m}=f(q,m), \tilde{k}_{n}=f(k,n) q~~m=f(q,m),k~~n=f(k,n) 
经过上述操作后， q ~ m \tilde{q}_{m} q~~m和 k ~ n \tilde{k}_{n} k~~n就带有位置 m m m和 n n n 的绝对位置信息。

最终可以得到二维情况下用复数表示的 RoPE： 
f ( q , m ) = R f ( q , m ) e i θ f ( q , m ) = ∣ q ∣ e i ( θ ( q ) + m θ ) = q e i m θ f(q,m)=R_{f}(q,m)e^{i \theta _{f}(q,m)}=|q|e^{i(\theta(q)+m \theta)}=qe^{im \theta} f(q,m)=Rf(q,m)eiθf(q,m)=∣q∣ei(θ(q)+mθ)=qeimθ 
根据复数乘法的几何意义，上述变换实际上是对应向量旋转，所以位置向量称为“旋转式位置编码”。还可以使用矩阵形式表示： 
f ( q , m ) = ( cos ⁡ m θ − sin ⁡ cos ⁡ m θ sin ⁡ m θ cos ⁡ m θ ) ( q 0 q 1 ) f ( q , m ) = \left(

cos⁡mθ−sin⁡cos⁡mθsin⁡mθcos⁡mθ

\right) \left(

q0q1

\right) f(q,m)=(cosmθsinmθ−sincosmθcosmθ)(q0q1)

ChatGLM模型中定义了一个名为RotaryEmbedding的模块，用于实现旋转嵌入(Rotary Embedding)。它可以捕获序列中单词的位置信息。

RotaryEmbedding模型中定义各个方法的功能： 
1 __init__: 初始化函数。定义了embedding维度(dim)，基数(base)，精度(precision)等参数，并根据是否可学习(learnable)设置inverse frequency (inv_freq)为参数或缓冲区。

2._load_from_state_dict: 这是一个PyTorch内部函数，用于从状态字典加载模型参数。在这里没有进行实现。

3.forward: 前向传播函数。首先计算出输入序列长度(seq_len)，然后根据seq_len和inv_freq计算频率(freqs)。接着将freqs复制并拼接到emb上，并根据精度将其转换为相应类型。最后计算cosine和sine值，并缓存起来以供后续使用。

4._apply: PyTorch内部函数，对缓存的cosine和sine值应用给定操作(fn)。

数学计算过程： 
inv_freq：inverse frequency(逆频率)是通过对等差数列[0, 2, …, dim-2]除以dim做归一化后取base的负指数得到。 
freqs：通过将时间步长t(一个长度为seq_len、元素值从0到seq_len-1的向量)与inv_freq做外积得到。 
emb：emb是由两份freqs拼接而成。 
cos_cached 和 sin_cached: 是emb中每个元素分别取余弦和正弦得到。

通过对位置索引生成周期性信号(余弦和正弦)，进而构建了能够捕获相对位置关系的embedding，也就实现了所谓“旋转”的效果，代码如下：

## 5. ChatGLM的注意力层

ChatGLM采用标准的自注意力机制，在自注意力机制中，输入是一组查询(query) Q Q Q, 键(key) K K K, 值(value) V V V. 这三者都是由输入序列经过线性变换得到。然后计算查询和键之间点积作为权重，并通过softmax函数进行归一化： Attention ( Q , K , V ) = s o f t m a x ( Q K T d ) V \text{Attention}(Q, K, V) = softmax(\frac{QK^T}{\sqrt{d}})V Attention(Q,K,V)=softmax(d QKT)V

代码中，函数attention_fn实现了自注意力机制：

下面是SelfAttention模块，模块中调用attention_fn实现注意力机制，代码如下：

## 6. ChatGLM的GLMBlock

GLMBlock是基于Transformer模型的一种变体，主要包含以下几个部分： 
**1.Layer Norm:** 这是一种常见的归一化方法，主要用于神经网络中的深度学习。它将每个样本在特征维度上进行归一化，使得输出在每个特征维度上都有均值为0和方差为1。这种方法可以加速模型收敛速度，并有助于解决梯度消失和梯度爆炸问题。 
**2.Self Attention:** 自注意力机制是Transformer模型的核心组成部分。给定一个输入序列，自注意力机制能够根据序列中每个元素与其他元素之间的关系，计算出一个权重向量，并用这个权重向量对输入序列进行加权平均。这样可以让模型更好地捕获序列中长距离依赖关系。 在GLMBlock中，Self Attention后面接了一个残差连接(Residual Connection)。残差连接可以让信息直接从前层传递到后层，在深层网络中有助于解决梯度消失问题。 
**3.Layer Normalization:** GLMBlock在Self Attention和GLU之间又添加了一次Layer Norm操作。 
**4.GLU:** GLU是一种非线性激活函数，主要由两部分组成：线性变换和门控机制。线性变换负责提取输入特征，而门控机制则负责控制信息流动。通过这种方式，GLU能够更好地处理复杂任务。 同样地，在GLU后面也接了一个残差连接。 
![](./02-ChatGLM结构解读-images/image_2.jpg)

## 7. ChatGLM的预训练模型

ChatGLM的预训练模型目的是获取注意力mask和position ids，下面具体介绍ChatGLMPreTrainedModel中的get_masks函数实现与获取position_ids函数：

## 8. 最终模型：ChatGLMModel

ChatGLMModel是将以上各种组件与模型块集成加载后的组合模型，代码如下：

到此为止，我已经详细介绍了ChaGLM的详细源码与原理介绍，相信大家对ChaGLM的模型架构有了大致的了解了。更多细节内容请持续关注“微学AI”。