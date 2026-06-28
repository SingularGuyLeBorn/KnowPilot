---
title: "12 · 干货系列 - LLama 一文读懂最强开源大模型的前世今生(附赠llama最全图解+源代码解读+面经分享)"
date: 2026-05-11
tags: []
---

# 12 干货系列 - LLama 一文读懂最强开源大模型的前世今生(附赠llama最全图解+源代码解读+面经分享)

**作者: Impressionniste**

**原文: **[https://zhuanlan.zhihu.com/p/721806966](https://zhuanlan.zhihu.com/p/721806966)

Ps: 注意本文代码和图解是均基于transformers=4.22中llama的实现

本文将通过对llama代码的解读，从**旋转位置编码，多头注意力、前馈网络、层归一化**到**Decoder  ，LlamaModel,LlamaForCausalLM**，逐步介绍llama模型架构特点，并在结尾附赠面试常考问题以及答案. (本文不包含的内容：BPE，FlashAttention，Llama训练流程解析，Llama各种变体等等)

## 1. LLamaModel 整体流程图

- 首先，在transformers仓库中我们可以在transformers/models/llama/modeling_llama.py看到llama的源码，整体代码的流程图如图所示(手画不易，点赞拿图，谢谢各位了~~- LlamaModel类，继承自PreTrainedModel，这个类是所有模型的基类，包含了一些通用的方法，比如保存模型、加载模型、初始化权重等. 继承关系为：LlamaModel -> LlamaPreTrainedModel -> PreTrainedModel- LlamaModel = nn.Embedding + N*[LlamaDecoderLayer](https://zhida.zhihu.com/search?content_id=248531850&content_type=Article&match_order=1&q=LlamaDecoderLayer&zhida_source=entity) ：从图中可以看出由一个nn.Embedding和N个LlamaDecoderLayer 堆叠而成，是一个不包含lm_head或者其它头的基础Llama模型- LlamaForCausalLM =LlamaModel + lm_head ：通过一个线性层将hidden_size映射到vocabulary_size从而得到logits- 根据小学二年级学到的Transformer结构，我们可以清晰地看出Llama的模型架构就是经典的Transformer **decoder**，我们接下来重点介绍llama与transformer decoder之前的区别和改进. 

![](./12-干货系列-LLama一文读懂最强开源大模型的前世今生-images/image_0.jpg)

附赠具体llama2-7b参数：

## 2. LLama改进的具体图解+解析

![](./12-干货系列-LLama一文读懂最强开源大模型的前世今生-images/image_1.jpg)

首先llama2与llama1相比，增加了上下文长度context length从2k拓展到了4k,同时在Attention模块加入了GQA分组查询机制来提高推理的可拓展性. 

具体网络结构特性包括：

- 使用**RMSNorm**来做**pre-normalization**- 使用**SwiGLU**激活函数- 使用旋转位置编码**Rope**- 分组查询注意力**Grouped-Query Attention, GQA**- **KV-cache** 推理缓存加速- ………

本文将依次对以下模块进行介绍：

1. **层归一化: LlamaRMSNorm** (用于稳定输入，相当于保持每个词向量的方向不变，但对模长标准化. )

2. **旋转位置编码: RoPE** (使用旋转矩阵实现的绝对位置编码，可以起到相对位置编码的效果)

3. **前馈网络: LlamaMLP** (用于逐位置将多头注意力融合后的信息进行高维映射变换)

4. **多头注意力: LlamaAttention** (用于融合不同token之间的信息)

5. **Llama解码层: LlamaDecoderLayer** (同时具备信息融合，信息转换功能的基本结构单元)

6. **LlamaDecoder  : LlamaModel** (多个解码层的堆叠)

7. **Llama语言模型: LlamaForCausalLM** (Decoder  加上语言模型head)

8. **Llama分类模型: LlamaForSequenceClassification** (Decoder  加上分类head，可用于reward model)

### 1. **RMSNorm**归一化

![](./12-干货系列-LLama一文读懂最强开源大模型的前世今生-images/image_2.jpg)

也就是在计算时不在考虑mean

LlamaRMSNorm 归一化代码如下(手撕起来也不难，有一点要注意和layer_norm相比，没有减均值的操作，有效果更好，速度更快的优点)：

## 2. 旋转位置位置编码 Rope - LsROPE - NTK-Rope

(对于旋转位置编码不太了解的小伙伴可以看我主页之前发的Rope解读文章)

参考：[https://zhuanlan.zhihu.com/p/670280576](https://zhuanlan.zhihu.com/p/670280576)

在代码库中主要提供了以下三种位置编码：

- **LlamaRotaryEmbedding** 普通的**旋转位置编码 外推性**较差，因此llama内部提供了**线性插值位置编码**和**NTKRope编码**通过减少旋转角度的方式以达到拓展的目的- **LlamaLinearScalingRotaryEmbedding 线性插值**位置编码 即**Position Interpolation**: 思路简单粗暴-目标长度是原来的n倍，则旋转弧度减小至原来的1/n，例如：推理时上下文长度从2048扩展至4096，将每个位置的旋转弧度均变为原来的一半，**直观上试图用模型时见过的旋转角度范围来表达未见过的范围**，从代码上也就是在计算t时 t = t / self.scaling_factor- **LlamaDynamicNTKScalingRotaryEmbedding 动态NTK**旋转位置编码 **NTK-RoPE**在不微调的基础上增加了模型的外推能力！- 首先在了解动态NTK之前，先了解NTK编码：即**NTK-Aware Interpolation**，和线性插值一样也是为了**减小RoPE的旋转弧度，**作者**以NTK(神经正切核)作为理论支撑，**增大RoPE的base来减少旋转弧度- **动态NTK**旋转位置编码 ：上述减少旋转角度的方法，在推理长度小于等于训练长度时，会带来性能的下降，因此动态插值就是在推理长度小于等于训练长度不进行插值; 推理长度大于训练长度时，每一步都通过NTK-Aware插值动态放大base. 体现在代码上就是在 seq_len > self.max_position_embeddings时base乘上一个缩放因子. 以及- **rotate_half**- **apply_rotary_pos_emb**

一言蔽之：通过对Q,K的向量进行旋转，使用绝对编码方式完成了相对位置编码. 

具体代码如下：

## 3. MLP层

如图所示，先从hidden_size维度up_proj到intermediate_size维度，然后再down_proj还原为hidden_size维度. 这里的主要特色是引入了一个gate_proj配合激活函数来实现一个门控注意力的作用. 在MOE比较火的情况下，如今llama3仍然坚持原来经典的MLP结构(有无大佬解读一下~)

流程图：左侧llama 右侧MOE

![](./12-干货系列-LLama一文读懂最强开源大模型的前世今生-images/image_3.jpg)

![](./12-干货系列-LLama一文读懂最强开源大模型的前世今生-images/image_4.jpg)

## 4. Attention

Attention这里有以下几个需要注意的点(非llama原创)：

- 首先是Grouped-Query Attention：- 根据小学二年级学的Mutilhead Attention (MHA)我们可以通过将Q,K,V拆成多个头，类似多通道卷积的思想，每一个头去学习不同子空间的特征表示更好的融合信息. - 然而随着Batch Size和上下文窗口的增大，多头注意力模型(Multi-head Attenrion，MHA)的内存成本会也会随之增加- 如图所示，MHA每一个头都有各自的Q,K,V, MQA则在所有头上共享K,V. GQA则是二者的折中方案对于Q,K进行分组共享，降低计算和内存需求，提升推理速度

![](./12-干货系列-LLama一文读懂最强开源大模型的前世今生-images/image_5.jpg)

代码解读如下：

- KV cache:

参考：[https://zhuanlan.zhihu.com/p/662498827](https://zhuanlan.zhihu.com/p/662498827)

**KV cache** 是Transformer**标配**的推理加速功能，transformer官方use_cache这个参数默认是True. 但是它**只能用于Decoder架构的模型，因为Decoder有Causal Mask**，在推理的时候前面已经生成的字符不需要与后面的字符产生attention，可以理解为**前面生成的token i不需要用Qi去查询后面的Kj>i**，从而使得前面已经计算的K和V可以缓存起来**. **

具体图解如下：

1. 假设模型最终生成了“遥遥领先”4个字，当模型生成第一个“遥”字时，input="~~", ""是起始字符. Attention的计算如下：~~

![](./12-干货系列-LLama一文读懂最强开源大模型的前世今生-images/image_6.jpg)

如上图所示，最终Attention的计算公式如下，(softmaxed 表示已经按行进行了softmax):

![](./12-干货系列-LLama一文读懂最强开源大模型的前世今生-images/image_7.jpg)

1. 当模型生成第二个“遥”字时，我们输入input="~~遥", Attention的计算如下：~~

![](./12-干货系列-LLama一文读懂最强开源大模型的前世今生-images/image_8.jpg)

如图，根据小学二年级的矩阵乘法，第二步Attention计算方式如下：

![](./12-干货系列-LLama一文读懂最强开源大模型的前世今生-images/image_9.jpg)

由此我们不难观察到几个规律：

![](./12-干货系列-LLama一文读懂最强开源大模型的前世今生-images/image_10.jpg)

1. 每一步在Attention计算的时候，**前面生成的token i不需要用Qi去查询后面的Kj>i，也就是不会出现$Q_1K_2^T$，因为$Q_1$是看不见$K_2$的被mask掉了. 即第i步计算时，$Q_{j<i}$的计算和前面一样不会发生变化，同理生成的$Att_{j<i}$也不会发生变化**2. 每一轮我们只需要去**额外计算当前token i对应的$Q_i$与$K_{1-i}$的乘积来计算当前的**$att_i$而前面的att计算结果都可以**复用**

![](./12-干货系列-LLama一文读懂最强开源大模型的前世今生-images/image_11.jpg)

![](./12-干货系列-LLama一文读懂最强开源大模型的前世今生-images/image_12.jpg)

![](./12-干货系列-LLama一文读懂最强开源大模型的前世今生-images/image_13.jpg)

由此我们可以进行如此简化：

1. **推理第 k 个字符的时候只需要输入字符k-1 , 然后用$Q_k,K_k$与保存好的$K_{1\_ k-2}$计算出当前的$Att_k$即可**2. 我们把**每一步的K,V缓存**起来，下一次**输入k-1字符时生成$K_k,V_k$与原来的做拼接**以供下次计算复用，这就是KV cache的基本原理

注意！**KV Cache会占用大量的Memory** 比如batch_size=32, head=32, layer=32, dim_size=4096, seq_length=2048, float32类型，则需要占用的显存为 2 * 32 * 4096 * 2048 * 32 * 4 / 1024/1024/1024 /1024 = 64G. 

代码解析：

Attention部分流程图

![](./12-干货系列-LLama一文读懂最强开源大模型的前世今生-images/image_14.jpg)

## 5. Models

模型层面

- **LlamaDecoderLayer** 由**LlamaAttention，LlamaMLP**，以及两个**LlamaRMSNorm**组成，并使用了两次残差结构. 

- **LlamaModel** 由多个**Llama解码层**堆叠而成，同时注意到两种padding mask和sequence mask的实现- _make_causal_mask 即sequence mask用于构造下三角这种mask结构以实现语言模型的单向注意力. - _expand_mask用于将传入的特殊符号相关的mask信息展开成和attention矩阵相同的张量结构. - 设置**gradient_checkpointing=True**可以节约显存，基本原理是**forward时不保存中间激活值**从而节约显存，**backward时重新计算相关值**，从而通过时间换取了空间- **gradient_checkpointing**和**use_cache**不能同时设置为True，**前者是为了节约显存时间换空间的**，**后者是为了节约时间空间换时间**- **LlamaForCausalLM** 在**LlamaModel**的基础上增加了一个**lm_head，将hidden_state**通过一个**Linear**映射到**词表维度，**同时提供了Logit和Loss的计算方法- **LlamaForSequenceClassification** 是一个序列分类模型，这个分类模型可以用来训练RLHF流程中的Reward模型 可以看到最后加了一个**Linear**将**hidden_state**映射到**2**维度

**总结**

| 
代码
 | 
功能
 |
| --- | --- |
| 
LlamaRMSNorm
 | 
实现了T5LayerNorm，用于层归一化. 
 |
| 
LlamaRotaryEmbedding
 | 
生成旋转位置编码(RoPE)，用于处理序列位置信息. 
 |
| 
LlamaLinearScalingRotaryEmbedding
 | 
线性缩放的旋转位置编码，根据序列长度动态调整RoPE. 
 |
| 
LlamaDynamicNTKScalingRotaryEmbedding
 | 
动态NTK缩放的旋转位置编码，根据序列长度动态调整RoPE. 
 |
| 
rotate_half
 | 
将输入的一半隐藏维度进行旋转. 
 |
| 
apply_rotary_pos_emb
 | 
应用旋转位置嵌入到查询和键张量. 
 |
| 
LlamaMLP
 | 
用于Transformer的Feed Forward网络部分. 
 |
| 
LlamaAttention
 | 
多头注意力
 |
| 
LlamaDecoderLayer
 | 
TransformerDecoder  层，包含自注意力和多层感知机. 
 |
| 
LlamaModel
 | 
TransformerDecoder  模型，由多个LlamaDecoderLayer组成. 
 |
| 
LlamaForCausalLM
 | 
用于因果语言建模的模型，包含LlamaModel和一个线性输出层. 
 |
| 
LlamaForSequenceClassification
 | 
用于序列分类的模型. 
 |

## 6. 面试常考题 :

1. 介绍**RMS Pre-Norm PostNorm**

层数较少时，**Post-Norm**效果更好

层数较⼤时，**Pre-Norm**效果更好，使模型更稳定，不容易梯度消失或者爆炸

**RMS Norm**

相较于⼀般的Layer Norm去掉了均值部分，RMS去掉了均值的计算，包括分⼦和分⺟部分，这样减少了7~64%的计算时间

2. 介绍**SwiGLU**

**SwiGLU**是GLU(Gated Linear Unit)变体**，GLU**定义为输⼊的两个线性变换的逐元素乘积，其 中的⼀个经过了sigmoid激活

**3. RoPE** 旋转位置编码

通过绝对位置编码的⽅式实现相对位置编码

参考： [https://flowus.cn/kmno4/share/527055be-464f-4f0f-98c5-8b8f72a1fc2e](https://link.zhihu.com/?target=https%3A//flowus.cn/kmno4/share/527055be-464f-4f0f-98c5-8b8f72a1fc2e)

[https://zhuanlan.zhihu.com/p/648365207](https://zhuanlan.zhihu.com/p/648365207)

[https://zhuanlan.zhihu.com/p/679819602](https://zhuanlan.zhihu.com/p/679819602)

[https://zhuanlan.zhihu.com/p/693182515](https://zhuanlan.zhihu.com/p/693182515)

[https://zhuanlan.zhihu.com/p/653303123](https://zhuanlan.zhihu.com/p/653303123)

[https://adhesive-larkspur-65c.notion.site/LLama-llama-1535dd3af25e4e0097860ecf322d6d0c?pvs=4](https://link.zhihu.com/?target=https%3A//adhesive-larkspur-65c.notion.site/LLama-llama-1535dd3af25e4e0097860ecf322d6d0c%3Fpvs%3D4)

某hs 同人：heart，秋招找工中~简单总结面经内容

​