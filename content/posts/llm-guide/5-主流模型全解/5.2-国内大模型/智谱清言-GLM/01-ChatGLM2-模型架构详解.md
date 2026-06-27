---
title: "[ChatGLM2]大模型模型架构详解"
date: 2026-05-11
tags: []
---

# 01 [ChatGLM2]大模型模型架构详解

**作者: 玉林峰**

**原文: **[https://zhuanlan.zhihu.com/p/673547769](https://zhuanlan.zhihu.com/p/673547769)

## 1. self_attention

- QKV如何计算[屋顶菌：Transformer 1. Attention中的Q，K，V是什么](https://zhuanlan.zhihu.com/p/441459022)- Ng 吴恩达老师的讲解：[多头注意力机制](https://zhida.zhihu.com/search?content_id=237806784&content_type=Article&match_order=1&q=%E5%A4%9A%E5%A4%B4%E6%B3%A8%E6%84%8F%E5%8A%9B%E6%9C%BA%E5%88%B6&zhida_source=entity)

![](./01-ChatGLM2-模型架构详解-images/image_0.jpg)

- transformer中decoder注意力机制是Masked的。Transformer模型的encoder使用的是普通的[self-attention机制](https://zhida.zhihu.com/search?content_id=237806784&content_type=Article&match_order=1&q=self-attention%E6%9C%BA%E5%88%B6&zhida_source=entity)，而decoder使用的是masked attention机制。

![](./01-ChatGLM2-模型架构详解-images/image_1.jpg)

transformer架构，但是图并不清晰

### 1.1 GPT架构大模型可视化(非常形象！)

[LLM Visualization](https://link.zhihu.com/?target=https%3A//bbycroft.net/llm)

中文翻译：[新智元：矩阵模拟！Transformer大模型3D可视化，GPT-3、Nano-GPT每一层清晰可见](https://zhuanlan.zhihu.com/p/670287271)

![](./01-ChatGLM2-模型架构详解-images/image_2.jpg)

非常形象！

## 2. multi-head masked(causal) self-attention

[causal attention](https://zhida.zhihu.com/search?content_id=237806784&content_type=Article&match_order=1&q=causal+attention&zhida_source=entity) 就是跟masked 一个意思，只将[query向量](https://zhida.zhihu.com/search?content_id=237806784&content_type=Article&match_order=1&q=query%E5%90%91%E9%87%8F&zhida_source=entity)与过去的key向量进行运算，使得它成为**因果自注意力**。也就是说，token无法「预见未来」。

## 3. mlp (多层感知层)——就是transformer里的 FFN层

![](./01-ChatGLM2-模型架构详解-images/image_3.jpg)

### 3.1 **dense_h_to_4h**** Linear层(数据扩展)** ：

- 这个层的作用是将数据从较低维度空间(在您的例子中是4096维)扩展到更[高维度空间](https://zhida.zhihu.com/search?content_id=237806784&content_type=Article&match_order=1&q=%E9%AB%98%E7%BB%B4%E5%BA%A6%E7%A9%BA%E9%97%B4&zhida_source=entity)(27392维)。这种扩展使得网络可以创建一个更高维度的表示空间，从而在这个空间中学习更复杂的特征和表示。- 在高维空间中，数据点更加分散，减少了各个特征之间的相互干扰，使模型能够更有效地学习数据中的复杂模式和关系。- 这一步骤可以类比于“思考”的过程，其中模型通过扩展数据维度来探索可能的特征组合和关系。

### 3.2 GELU[激活函数](https://zhida.zhihu.com/search?content_id=237806784&content_type=Article&match_order=1&q=%E6%BF%80%E6%B4%BB%E5%87%BD%E6%95%B0&zhida_source=entity)

### 3.3 **dense_4h_to_h** Linear层**(数据压缩)** ：

- 经过数据扩展和处理后，dense_4h_to_h 层的作用是将数据从高维空间(27392维)压缩回原始维度空间(4096维)。这种压缩有助于提炼和总结在高维空间中学习到的特征，把它们转换为更为紧凑和有效的表示。- 通过这种压缩，模型能够减少计算复杂度，并为后续的处理步骤生成一个更为精炼的特征表示。

## 4. 模型推理示意图

参考：[ChatGLM2-6B模型推理流程和模型架构详解-CSDN博客](https://link.zhihu.com/?target=https%3A//blog.csdn.net/jpw41/article/details/134089540)

![](./01-ChatGLM2-模型架构详解-images/image_4.jpg)