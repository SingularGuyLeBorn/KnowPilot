---
title: "Qwen2.5-VL - 逐段精译与译者注"
source: 03-Qwen2.5-VL-mineru-en.md
translated_by: "AI Agent"
date: 2026-05-19
---

# Qwen Technical Report

>  **[返回 14.2-Qwen 家族总览](../../14.2-Qwen.md)**


Qwen Team, Alibaba Group

https://chat.qwenlm.ai | https://huggingface.co/Qwen | https://modelscope.cn/organization/qwen | https://github.com/QwenLM/Qwen2.5-VL

> **译者注**：本文档为 Qwen2.5-VL 技术报告的 MinerU 提取版本逐段中英对照翻译。Qwen2.5-VL 是 Qwen 视觉语言系列的最新旗舰模型，核心创新包括窗口注意力 ViT、动态 FPS 采样、绝对时间对齐的 MRoPE、以及从 1.2T 扩展到 4.1T tokens 的预训练语料。报告共 23 页，MinerU 转换保留了 13 张图片和全部表格结构。

---

## Abstract

We introduce Qwen2.5-VL, the latest flagship model of Qwen vision-language series, which demonstrates significant advancements in both foundational capabilities and innovative functionalities. Qwen2.5-VL achieves a major leap forward in understanding and interacting with the world through enhanced visual recognition, precise object localization, robust document parsing, and long-video comprehension. A standout feature of Qwen2.5-VL is its ability to localize objects using bounding boxes or points accurately. It provides robust structured data extraction from invoices, forms, and tables, as well as detailed analysis of charts, diagrams, and layouts. To handle complex inputs, Qwen2.5-VL introduces dynamic resolution processing and absolute time encoding, enabling it to process images of varying sizes and videos of extended durations (up to hours) with second-level event localization. This allows the model to natively perceive spatial scales and temporal dynamics without relying on traditional normalization techniques. By training a native dynamic-resolution Vision Transformer (ViT) from scratch and incorporating Window Attention, we have significantly reduced computational overhead while maintaining native resolution. As a result, Qwen2.5-VL excels not only in static image and document understanding but also as an interactive visual agent capable of reasoning, tool usage, and task execution in real-world scenarios such as operating computers and mobile devices. The model achieves strong generalization across domains without requiring task-specific fine-tuning. Qwen2.5-VL is available in three sizes, addressing diverse use cases from edge AI to high-performance computing. The flagship Qwen2.5-VL-72B model matches state-of-the-art models like GPT-4o and Claude 3.5 Sonnet, particularly excelling in document and diagram understanding. The smaller Qwen2.5-VL-7B and Qwen2.5-VL-3B models outperform comparable competitors, offering strong capabilities even in resource-constrained environments.

**摘要**：我们介绍 Qwen2.5-VL，Qwen 视觉语言系列的最新旗舰模型，在基础能力和创新功能上都实现了显著提升。Qwen2.5-VL 通过增强的视觉识别、精确的物体定位、稳健的文档解析和长视频理解，在理解和与世界交互方面实现了重大飞跃。其突出特点是能够使用边界框或点准确定位物体。它能从发票、表单和表格中稳健地提取结构化数据，并对图表、示意图和布局进行详细分析。为处理复杂输入，Qwen2.5-VL 引入动态分辨率处理和绝对时间编码，使其能够处理不同尺寸的图像和超长时长(可达数小时)的视频，并实现秒级事件定位。这使模型能够原生感知空间尺度和时间动态，无需依赖传统的归一化技术。通过从头训练原生动态分辨率的 Vision Transformer(ViT)并引入 Window Attention，我们在保持原生分辨率的同时显著降低了计算开销。因此，Qwen2.5-VL 不仅在静态图像和文档理解方面表现出色，还能作为交互式视觉智能体，在操作计算机和移动设备等真实场景中执行推理、工具使用和任务执行。模型在跨领域实现了强大的泛化能力，无需针对特定任务进行微调。Qwen2.5-VL 提供三种尺寸，覆盖从边缘 AI 到高性能计算的多样化用例。旗舰模型 72B 达到 GPT-4o 和 Claude 3.5 Sonnet 等 SOTA 模型水平，尤其在文档和图表理解方面表现突出。较小的 7B 和 3B 模型超越了同尺寸竞争对手，即使在资源受限环境中也提供强大能力。

> **译者注**：Qwen2.5-VL 的核心定位是"细粒度感知 + Agent 能力"。与 Qwen2-VL 相比，三大关键升级：(1) 预训练数据从 1.2T 扩展到 4.1T tokens; (2) 引入绝对时间编码的 MRoPE，支持小时级视频理解和秒级事件定位; (3) 增强的 Agent 能力，包括 GUI 元素定位和操作推理。值得注意的是，3B 模型在 ScreenSpot Pro 上达到 43.6%，远超 Qwen2-VL-72B 的 1.6%——这说明小模型通过架构优化和数据质量提升可以实现跨越尺寸的性能飞跃。

---

## 1 Introduction

Large vision-language models (LVLMs) represent a pivotal breakthrough in artificial intelligence, signaling a transformative approach to multimodal understanding and interaction. By seamlessly integrating visual perception with natural language processing, these advanced models are fundamentally reshaping how machines interpret and analyze complex information across diverse domains. Despite significant advancements in multimodal large language models, the current capabilities of these models can be likened to the middle layer of a sandwich cookie—competent across various tasks but falling short of exceptional performance. Fine-grained visual tasks form the foundational layer of this analogy. In this iteration of Qwen2.5-VL, we are committed to exploring fine-grained perception capabilities, aiming to establish a robust foundation for LVLMs and create an agentic amplifier for real-world applications. The top layer of this framework is multi-modal reasoning, which is enhanced by leveraging the latest Qwen2.5 LLM and employing multi-modal QA data construction.

**1 引言**
大型视觉语言模型(LVLMs)代表了人工智能领域的突破性进展，标志着多模态理解与交互的变革性方法。通过无缝整合视觉感知与自然语言处理，这些先进模型正在从根本上重塑机器跨领域解读和分析复杂信息的方式。尽管多模态大语言模型取得了显著进展，但当前这些模型的能力可以被比喻为三明治饼干的中间层——在各种任务上都有一定能力，但尚未达到卓越表现。细粒度视觉任务构成了这个比喻的基础层。在 Qwen2.5-VL 的迭代中，我们致力于探索细粒度感知能力，旨在为 LVLMs 建立坚实基础，并为真实世界应用创建智能体放大器。这个框架的顶层是多模态推理，通过利用最新的 Qwen2.5 LLM 和采用多模态 QA 数据构建来增强。

A spectrum of works have promoted the development of multimodal large models, characterized by architectural design, visual input processing, and data curation. One of the primary drivers of progress in LVLMs is the continuous innovation in architecture. The studies presented have incrementally shaped the current paradigm, which typically consists of a visual encoder, a cross-modal projector, and LLM. Fine-grained perception models have emerged as another crucial area. The architectures of Omni and MoE also inspire the future evolution of LVLMs. Enhancements in visual encoders and resolution scaling have played a pivotal role in improving the quality of practical visual understanding. Curating data with more diverse scenarios and higher-quality is an essential step in training advanced LVLMs.

一系列工作推动了多模态大模型的发展，其特征体现在架构设计、视觉输入处理和数据策划上。LVLMs 进步的主要驱动力之一是架构的持续创新。已有研究逐步塑造了当前的范式，通常由视觉编码器、跨模态投影器和 LLM 组成。细粒度感知模型已成为另一个关键领域。Omni 和 MoE 的架构也启发了 LVLMs 的未来演进。视觉编码器和分辨率扩展的增强在提升实际视觉理解质量方面发挥了关键作用。策划更多样化场景和更高质量的数据是训练先进 LVLMs 的关键步骤。

However, despite their remarkable progress, vision-language models currently face developmental bottlenecks, including computational complexity, limited contextual understanding, poor fine-grained visual perception, and inconsistent performance across varied sequence length.

然而，尽管取得了显著进展，视觉语言模型目前仍面临发展瓶颈，包括计算复杂度、有限的上下文理解、较差的细粒度视觉感知，以及在不同序列长度上的性能不一致。

In this report, we introduce the latest work Qwen2.5-VL, which continues the open-source philosophy of the Qwen series, achieving and even surpassing top-tier closed-source models on various benchmarks. Technically, our contributions are four-folds: (1) We implement window attention in the visual encoder to optimize inference efficiency; (2) We introduce dynamic FPS sampling, extending dynamic resolution to the temporal dimension and enabling comprehensive video understanding across varied sampling rates; (3) We upgrade MRoPE in the temporal domain by aligning to absolute time, thereby facilitating more sophisticated temporal sequence learning; (4) We make significant efforts in curating high-quality data for both pre-training and supervised fine-tuning, further scaling the pre-training corpus from 1.2 trillion tokens to 4.1 trillion tokens.

本报告中，我们介绍最新工作 Qwen2.5-VL，延续 Qwen 系列的开源理念，在各种基准上达到甚至超越顶级闭源模型。技术上，我们的贡献包括四个方面：(1) 在视觉编码器中实现窗口注意力以优化推理效率; (2) 引入动态 FPS 采样，将动态分辨率扩展到时间维度，实现对不同采样率的全面视频理解; (3) 通过将 MRoPE 与绝对时间对齐来升级时间域表示，从而促进更复杂的时间序列学习; (4) 在预训练和监督微调的高质量数据策划上投入大量精力，将预训练语料从 1.2 万亿 tokens 进一步扩展到 4.1 万亿 tokens。

The sparkling characteristics of Qwen2.5-VL are as follows:

Qwen2.5-VL 的突出特点如下：

- Powerful document parsing capabilities: Qwen2.5-VL upgrades text recognition to omnidocument parsing, excelling in processing multi-scene, multilingual, and various built-in (handwriting, tables, charts, chemical formulas, and music sheets) documents.
  强大的文档解析能力：Qwen2.5-VL 将文本识别升级为全文档解析，在处理多场景、多语言以及各种内置元素(手写、表格、图表、化学公式和乐谱)的文档方面表现出色。
- Precise object grounding across formats: Qwen2.5-VL unlocks improved accuracy in detecting, pointing, and counting objects, accommodating absolute coordinate and JSON formats for advanced spatial reasoning.
  跨格式的精确物体定位：Qwen2.5-VL 在检测、指向和计数物体方面解锁了更高的准确性，支持绝对坐标和 JSON 格式以实现高级空间推理。
- Ultra-long video understanding and fine-grained video grounding: Our model extends native dynamic resolution to the temporal dimension, enhancing the ability to understand videos lasting hours while extracting event segments in seconds.
  超长视频理解和细粒度视频定位：我们的模型将原生动态分辨率扩展到时间维度，增强了对持续数小时的视频的理解能力，同时以秒级精度提取事件片段。
- Enhanced agent Functionality for computer and mobile devices: Leverage advanced grounding, reasoning, and decision-making abilities, boosting the model with superior agent functionality on smartphones and computers.
  增强的计算机和移动设备 Agent 功能：利用先进的定位、推理和决策能力，提升模型在智能手机和计算机上的 Agent 功能。

![](images/fig01_framework.jpg)  
Figure 1: The Qwen2.5-VL framework demonstrates the integration of a vision encoder and a language model decoder to process multimodal inputs, including images and videos. The vision encoder is designed to handle inputs at their native resolution and supports dynamic FPS sampling. Images of varying sizes and video frames with different FPS rates are dynamically mapped to token sequences of varying lengths. Notably, MRoPE aligns time IDs with absolute time along the temporal dimension, enabling the model to better comprehend temporal dynamics, such as the pace of events and precise moment localization. The processed visual data is subsequently fed into the Qwen2.5 LM Decoder. We have re-engineered the vision transformer (ViT) architecture, incorporating advanced components such as FFN with SwiGLU activation, RMSNorm for normalization, and window-based attention mechanisms to enhance performance and efficiency.

图 1：Qwen2.5-VL 框架展示了视觉编码器和语言模型解码器的整合，用于处理包括图像和视频在内的多模态输入。视觉编码器设计为以原生分辨率处理输入，并支持动态 FPS 采样。不同尺寸的图像和不同 FPS 率的视频帧被动态映射为不同长度的 token 序列。值得注意的是，MRoPE 将时间 ID 与绝对时间沿时间维度对齐，使模型能够更好地理解时间动态，如事件节奏和精确时刻定位。处理后的视觉数据随后被送入 Qwen2.5 LM 解码器。我们重新设计了 ViT 架构，整合了 FFN with SwiGLU 激活、RMSNorm 归一化和基于窗口的注意力机制等先进组件，以提升性能和效率。

> **译者注**：图 1 展示了 Qwen2.5-VL 的完整架构：原生动态分辨率 ViT → MLP-based Vision-Language Merger(2x2 patch 分组 + 两层 MLP) → Qwen2.5 LLM Decoder。三个关键设计细节值得注意：(1) 窗口注意力只在 112x112(8x8 patches) 范围内计算，仅第 7/15/23/31 层使用全局注意力; (2) 视频处理时两帧合并为一组，减少 token 数; (3) MRoPE 的时间维度 ID 不再绑定帧序号，而是与绝对时间对齐——这意味着不同 FPS 的视频可以用一致的时间表示。

---

## 2 Approach

In this section, we first outline the architectural updates of the Qwen2.5-VL series models and provide an overview of the data and training details.

**2 方法**
本节首先概述 Qwen2.5-VL 系列模型的架构更新，然后提供数据和训练细节的概览。

### 2.1 Model Architecture

The overall model architecture of Qwen2.5-VL consists of three components:

**2.1 模型架构**
Qwen2.5-VL 的整体模型架构由三个组件组成：

Large Language Model: The Qwen2.5-VL series adopts large language models as its foundational component. The model is initialized with pre-trained weights from the Qwen2.5 LLM. To better meet the demands of multimodal understanding, we have modified the 1D RoPE (Rotary Position Embedding) to our Multimodal Rotary Position Embedding Aligned to Absolute Time.

大语言模型：Qwen2.5-VL 系列采用大语言模型作为基础组件。模型使用 Qwen2.5 LLM 的预训练权重初始化。为更好地满足多模态理解需求，我们将 1D RoPE(旋转位置编码)修改为与绝对时间对齐的多模态旋转位置编码(MRoPE)。

Vision Encoder: The vision encoder of Qwen2.5-VL employs a redesigned Vision Transformer (ViT) architecture. Structurally, we incorporate 2D-RoPE and window attention to support native input resolutions while accelerating the computation of the entire visual encoder. During both training and inference, the height and width of the input images are resized to multiples of 28 before being fed into the ViT. The vision encoder processes images by splitting them into patches with a stride of 14, generating a set of image features. We provide a more detailed introduction to the vision encoder in Section 2.1.1.

视觉编码器：Qwen2.5-VL 的视觉编码器采用重新设计的 ViT 架构。结构上，我们引入 2D-RoPE 和窗口注意力以支持原生输入分辨率，同时加速整个视觉编码器的计算。在训练和推理期间，输入图像的高度和宽度在被送入 ViT 之前被调整为 28 的倍数。视觉编码器通过以 14 的步幅将图像分割为 patches 来处理图像，生成一组图像特征。我们在第 2.1.1 节提供更详细的视觉编码器介绍。

MLP-based Vision-Language Merger: To address the efficiency challenges posed by long sequences of image features, we adopt a simple yet effective approach to compress the feature sequences before feeding them into the large language model (LLM). Specifically, instead of directly using the raw patch features extracted by the Vision Transformer (ViT), we first group spatially adjacent sets of four patch features. These grouped features are then concatenated and passed through a two-layer multi-layer perceptron (MLP) to project them into a dimension that aligns with the text embeddings used in the LLM. This method not only reduces computational costs but also provides a flexible way to dynamically compress image feature sequences of varying lengths.

基于 MLP 的视觉-语言合并器：为解决长图像特征序列带来的效率挑战，我们采用一种简单但有效的方法，在将特征序列送入 LLM 之前进行压缩。具体而言，我们不直接使用 ViT 提取的原始 patch 特征，而是首先将空间相邻的四个 patch 特征分组。这些分组特征随后被拼接并通过两层 MLP 投影到与 LLM 中文本嵌入维度对齐的维度。这种方法不仅降低了计算成本，还提供了一种灵活的方式来动态压缩不同长度的图像特征序列。

In Table 1, the architecture and configuration of Qwen2.5-VL are detailed.

表 1 详细列出了 Qwen2.5-VL 的架构和配置。

Table 1: Configuration of Qwen2.5-VL.
表 1：Qwen2.5-VL 的配置。

(表格数据见原始 MinerU-EN 文件)

> **译者注**：表 1 显示三个尺寸(3B/7B/72B)共享相同的 ViT 配置(1280 hidden, 32 layers, 16 heads, patch 14, window 112)，但 Vision-Language Merger 和 LLM 的维度随模型尺寸缩放。3B 模型使用 Embedding Tying(输入/输出嵌入共享)，7B 和 72B 不使用。所有模型都在 4.1T tokens 上训练。值得注意的是，ViT 的参数量在三个尺寸中是固定的，只有 LLM 部分缩放——这是多模态模型的典型设计，视觉感知能力不随语言模型尺寸增加而线性增长。

#### 2.1.1 Fast and Efficient Vision Encoder

The vision encoder plays a pivotal role in multimodal large language models (MLLMs). To address the challenges posed by computational load imbalances during training and inference due to native resolution inputs, we have redesigned the Vision Transformer (ViT) architecture. A key issue arises from the quadratic computational complexity associated with processing images of varying sizes. To mitigate this, we introduce windowed attention in most layers, which ensures that computational cost scales linearly with the number of patches rather than quadratically. In our architecture, only four layers employ full self-attention, while the remaining layers utilize windowed attention with a maximum window size of 112x112 (corresponding to 8x8 patches). Regions smaller than 112x112 are processed without padding, preserving their original resolution. This design allows the model to operate natively at the input resolution, avoiding unnecessary scaling or distortion.

**2.1.1 快速高效的视觉编码器**
视觉编码器在多模态大语言模型(MLLMs)中扮演关键角色。为解决原生分辨率输入在训练和推理期间导致的计算负载不均衡挑战，我们重新设计了 ViT 架构。一个关键问题是处理不同尺寸图像时的二次计算复杂度。为缓解这一问题，我们在大多数层中引入窗口注意力，确保计算成本与 patch 数量呈线性关系而非二次关系。在我们的架构中，仅四层使用全局自注意力，其余层使用最大窗口尺寸为 112x112(对应 8x8 patches)的窗口注意力。小于 112x112 的区域不使用 padding 处理，保持其原始分辨率。这种设计允许模型在输入分辨率下原生运行，避免不必要的缩放或失真。

For positional encoding, we adopt 2D Rotary Positional Embedding (RoPE) to effectively capture spatial relationships in 2D space. Furthermore, to better handle video inputs, we extend our approach to 3D patch partitioning. Specifically, we use 14x14 image patches as the basic unit, consistent with traditional ViTs for static images. For video data, two consecutive frames are grouped together, significantly reducing the number of tokens fed into the language model. This design not only maintains compatibility with existing architectures but also enhances efficiency when processing sequential video data.

对于位置编码，我们采用 2D 旋转位置编码(RoPE)以有效捕捉 2D 空间中的空间关系。此外，为更好地处理视频输入，我们将方法扩展到 3D patch 分区。具体而言，我们使用 14x14 图像 patch 作为基本单元，与传统 ViT 处理静态图像保持一致。对于视频数据，两帧连续帧被组合在一起，显著减少了送入语言模型的 token 数量。这种设计不仅保持了与现有架构的兼容性，还增强了处理序列视频数据时的效率。

To streamline the overall network structure, we align the ViT architecture more closely with the design principles of large language models (LLMs). Specifically, we adopt RMSNorm for normalization and SwiGLU as the activation function. These choices enhance both computational efficiency and compatibility between the vision and language components of the model.

为简化整体网络结构，我们将 ViT 架构与 LLM 的设计原则更紧密地对齐。具体而言，我们采用 RMSNorm 进行归一化，SwiGLU 作为激活函数。这些选择既增强了计算效率，也增强了模型视觉和语言组件之间的兼容性。

In terms of training, we train the redesigned ViT from scratch. The training process consists of several stages, including CLIP pre-training, vision-language alignment, and end-to-end fine-tuning. To ensure robustness across varying input resolutions, we employ dynamic sampling at native resolutions during training. Images are randomly sampled according to their original aspect ratios, enabling the model to generalize effectively to inputs of diverse resolutions. This approach not only improves the model's adaptability but also ensures stable and efficient training across different sizes of visual data.

在训练方面，我们从头训练重新设计的 ViT。训练过程包括多个阶段，包括 CLIP 预训练、视觉-语言对齐和端到端微调。为确保在不同输入分辨率下的稳健性，我们在训练期间采用原生分辨率的动态采样。图像根据其原始宽高比随机采样，使模型能够有效泛化到不同分辨率的输入。这种方法不仅提高了模型的适应性，还确保了不同尺寸视觉数据的稳定和高效训练。

> **译者注**：视觉编码器的设计有几个关键工程决策：(1) 窗口注意力 + 全局注意力的混合策略(4 层全局，28 层窗口)——这与 Swin Transformer 的分层窗口注意力不同，Qwen2.5-VL 是在同一分辨率下混合使用; (2) 2D-RoPE 替代传统的绝对位置编码或正弦位置编码，更适合处理变长图像; (3) 视频帧两两合并(temporal pooling)减少 token 数约 50%; (4) ViT 从头训练而非使用预训练视觉模型——这意味着视觉表示完全为多模态任务优化，不受 ImageNet 预训练的偏差影响。

#### 2.1.2 Native Dynamic Resolution and Frame Rate

Qwen2.5-VL introduces advancements in both spatial and temporal dimensions to handle diverse multimodal inputs effectively.

**2.1.2 原生动态分辨率和帧率**
Qwen2.5-VL 在空间和时间维度都引入了进步，以有效处理多样化的多模态输入。

In the spatial domain, Qwen2.5-VL dynamically converts images of varying sizes into sequences of tokens with corresponding lengths. Unlike traditional approaches that normalize coordinates, our model directly uses the actual dimensions of the input image to represent bounding boxes, points, and other spatial features. This allows the model to learn scale information inherently, improving its ability to process images across different resolutions.

在空间域，Qwen2.5-VL 将不同尺寸的图像动态转换为对应长度的 token 序列。与传统方法对坐标进行归一化不同，我们的模型直接使用输入图像的实际尺寸来表示边界框、点和其他空间特征。这使模型能够内在地学习尺度信息，提高其处理不同分辨率图像的能力。

For video inputs, Qwen2.5-VL incorporates dynamic frame rate (FPS) training and absolute time encoding. By adapting to variable frame rates, the model can better capture the temporal dynamics of video content. Unlike other approaches that incorporate textual timestamps or utilize additional heads to enable temporal grounding, we introduce a novel and efficient strategy that aligns MRoPE IDs directly with the timestamps. This approach allows the model to understand the tempo of time through the intervals between temporal dimension IDs, without necessitating any additional computational overhead.

对于视频输入，Qwen2.5-VL 整合了动态帧率(FPS)训练和绝对时间编码。通过适应可变帧率，模型能够更好地捕捉视频内容的时间动态。与其他方法引入文本时间戳或使用额外头来实现时间定位不同，我们引入了一种新颖且高效的策略，直接将 MRoPE ID 与时间戳对齐。这种方法允许模型通过时间维度 ID 之间的间隔来理解时间节奏，无需任何额外的计算开销。

> **译者注**：动态分辨率是 Qwen2.5-VL 相比传统 MLLM 的核心差异。传统方法(如 LLaVA)将图像统一缩放到固定尺寸(如 336x336)，丢失了原始尺度和宽高比信息。Qwen2.5-VL 的动态分辨率策略保留了这些关键信息，使模型能够：(1) 理解"这是一个高分辨率图像"vs"这是一个缩略图"; (2) 输出与原始图像尺寸匹配的绝对坐标(而非 0-1 归一化坐标); (3) 原生处理各种宽高比(如全景图、竖屏截图)。在时间维度上，绝对时间编码使模型能够理解"事件发生在大约 3 分 15 秒"，而不是"第 47 帧"——前者是视频内容的本征属性，后者依赖于采样率。

#### 2.1.3 Multimodal Rotary Position Embedding Aligned to Absolute Time

Positional embeddings are crucial for modeling sequential data in both vision and language modalities. Building upon the Multimodal Rotary Position Embedding (MRoPE) introduced in Qwen2-VL, we extend its capabilities to better handle temporal information in videos.

**2.1.3 与绝对时间对齐的多模态旋转位置编码**
位置编码对于建模视觉和语言模态中的序列数据至关重要。在 Qwen2-VL 引入的多模态旋转位置编码(MRoPE)基础上，我们扩展其能力以更好地处理视频中的时间信息。

The MRoPE in Qwen2-VL decomposes the position embedding into three distinct components: temporal, height, and width to effectively model multimodal inputs. For textual inputs, all three components use identical position IDs, making MRoPE functionally equivalent to traditional 1D RoPE. For images, the temporal ID remains constant across visual tokens, while unique IDs are assigned to the height and width components based on each token's spatial position within the image. When processing videos, which are treated as sequences of frames, the temporal ID increments for each frame, while the height and width components follow the same assignment pattern as for static images.

Qwen2-VL 中的 MRoPE 将位置编码分解为三个不同的组件：时间、高度和宽度，以有效建模多模态输入。对于文本输入，三个组件使用相同的位置 ID，使 MRoPE 在功能上等同于传统的 1D RoPE。对于图像，时间 ID 在视觉 token 间保持恒定，而基于每个 token 在图像中的空间位置为其高度和宽度组件分配唯一 ID。在处理视频时(被视为帧序列)，每帧的时间 ID 递增，而高度和宽度组件遵循与静态图像相同的分配模式。

However, in Qwen2-VL, the temporal position IDs in MRoPE were tied to the number of input frames, which did not account for the speed of content changes or the absolute timing of events within the video. To address this limitation, Qwen2.5-VL introduces a key improvement: aligning the temporal component of MRoPE with absolute time. As shown in Figure 1, by leveraging the intervals between temporal IDs, the model is able to learn consistent temporal alignment across videos with different FPS sampling rates.

然而，在 Qwen2-VL 中，MRoPE 的时间位置 ID 与输入帧数绑定，没有考虑内容变化的速度或视频中事件的绝对时间。为解决这一局限，Qwen2.5-VL 引入了一个关键改进：将 MRoPE 的时间组件与绝对时间对齐。如图 1 所示，通过利用时间 ID 之间的间隔，模型能够跨不同 FPS 采样率的视频学习一致的时间对齐。

> **译者注**：MRoPE 的设计是 Qwen 系列 VLM 的独特创新。与 LLaVA 等模型使用简单的 1D 位置编码不同，MRoPE 显式地将位置编码分解为三个正交维度(t, h, w)，使模型能够：(1) 区分"这是文本"(t=h=w)和"这是图像"(t=const); (2) 理解 2D 空间关系; (3) 处理时间序列。Qwen2.5-VL 的关键升级是将时间 ID 从"帧序号"改为"绝对时间"——例如，一个 30FPS 视频的第 30 帧在 Qwen2-VL 中时间 ID=30，而在 Qwen2.5-VL 中时间 ID=1000(ms)。这意味着模型可以直接回答"事件发生在 2.5 秒"，而不需要知道视频的 FPS。

---
### 2.2 Pre-Training

In this section, we first describe the construction of the pre-training dataset, followed by an overview of the overall training pipeline and configuration.

**2.2 预训练**
本节首先描述预训练数据集的构建，然后概述整体训练流程和配置。

#### 2.2.1 Pre-Training Data

Compared to Qwen2-VL, we have significantly expanded the volume of our pre-training data, increasing it from 1.2 trillion tokens to approximately 4 trillion tokens. Our pre-training dataset was constructed through a combination of methods, including cleaning raw web data, synthesizing data, etc. The dataset encompasses a wide variety of multimodal data, such as image captions, interleaved image-text data, optical character recognition (OCR) data, visual knowledge (e.g., celebrity, landmark, flora, and fauna identification), multi-modal academic questions, localization data, document parsing data, video descriptions, video localization, and agent-based interaction data. Throughout the training process, we carefully adjusted the composition and proportions of these data types at different stages to optimize learning outcomes.

**2.2.1 预训练数据**
与 Qwen2-VL 相比，我们大幅扩展了预训练数据量，从 1.2 万亿 tokens 增加到约 4 万亿 tokens。预训练数据集通过多种方法构建，包括清洗原始网页数据、合成数据等。数据集涵盖多种多模态数据，如图像描述、交错图像-文本数据、OCR 数据、视觉知识(如名人、地标、动植物识别)、多模态学术问题、定位数据、文档解析数据、视频描述、视频定位和基于 Agent 的交互数据。在整个训练过程中，我们在不同阶段仔细调整这些数据类型的组成和比例以优化学习效果。

Interleaved Image-Text Data: Interleaved image-text data is essential for multimodal learning, offering three key benefits: (1) enabling in-context learning with simultaneous visual and textual cues, (2) maintaining strong text-only capabilities when images are missing, and (3) containing a wide range of general information. However, much of the available interleaved data lacks meaningful text-image associations and is often noisy, limiting its usefulness for complex reasoning and creative generation. To address these challenges, we developed a pipeline for scoring and cleaning data, ensuring only high-quality, relevant interleaved data is used. Our process involves two steps: standard data cleaning followed by a four-stage scoring system using an internal evaluation model. The scoring criteria include: (1) text-only quality, (2) image-text relevance, (3) image-text complementarity, and (4) information density balance.

交错图像-文本数据：交错图像-文本数据对多模态学习至关重要，提供三个关键优势：(1) 通过同时的视觉和文本线索实现上下文学习，(2) 在缺少图像时保持强大的纯文本能力，(3) 包含广泛的通用信息。然而，许多可用的交错数据缺乏有意义的文本-图像关联，且通常带有噪声，限制了其在复杂推理和创造性生成方面的用途。为应对这些挑战，我们开发了一个评分和清洗数据的流水线，确保只使用高质量、相关的交错数据。我们的流程包括两个步骤：标准数据清洗，然后使用内部评估模型进行四阶段评分系统。评分标准包括：(1) 纯文本质量，(2) 图像-文本相关性，(3) 图像-文本互补性，(4) 信息密度平衡。

Grounding Data with Absolute Position Coordinates: We adopt native resolution training with the aim of achieving a more accurate perception of the world. In contrast, relative coordinates fail to effectively represent the original size and position of objects within images. To address this limitation, Qwen2.5-VL uses coordinate values based on the actual dimensions of the input images during training to represent bounding boxes and points. This approach ensures that the model can better capture the real-world scale and spatial relationships of objects, leading to improved performance in tasks such as object detection and localization.

带绝对位置坐标的定位数据：我们采用原生分辨率训练，旨在实现更准确的世界感知。相比之下，相对坐标无法有效表示图像中物体的原始大小和位置。为解决这一局限，Qwen2.5-VL 在训练期间使用基于输入图像实际尺寸的坐标值来表示边界框和点。这种方法确保模型能够更好地捕捉物体的真实世界尺度和空间关系，从而在物体检测和定位等任务中取得改进的性能。

To improve the generalizability of grounding capabilities, we have developed a comprehensive dataset encompassing bounding boxes and points with referring expressions, leveraging both publicly available datasets and proprietary data. Our methodology involves synthesizing data into various formats, including XML, JSON, and custom formats, employing techniques such as copy-paste augmentation and synthesis with off-the-shelf models such as Grounding DINO and SAM.

为提高定位能力的泛化性，我们开发了一个全面的数据集，包含带引用表达的边界框和点，利用公开数据集和专有数据。我们的方法涉及将数据合成为各种格式，包括 XML、JSON 和自定义格式，采用 copy-paste 增强和使用 Grounding DINO 和 SAM 等现成模型合成等技术。

To enhance the model's performance on open-vocabulary detection, we expanded the training dataset to include over 10,000 object categories. Additionally, to improve the model's effectiveness in extreme object detection scenarios, we synthesized non-existent object categories within the queries and constructed image data containing multiple instances for each object.

为增强模型在开放词汇检测上的性能，我们将训练数据集扩展到包含超过 10,000 个物体类别。此外，为提高模型在极端物体检测场景中的有效性，我们在查询中合成了不存在的物体类别，并构建了包含每个物体多个实例的图像数据。

Document Omni-Parsing Data: To train Qwen2.5-VL, we synthesized a large corpus of document data. Traditional methods for parsing document content typically rely on separate models to handle layout分析、文本提取、图表解读和插图处理。In contrast, Qwen2.5-VL is designed to empower a general-purpose model with comprehensive capabilities for parsing, understanding, and converting document formats. Specifically, we incorporated a diverse array of elements into the documents, such as tables, charts, equations, natural or synthetic images, music sheets, and chemical formulas. These elements were uniformly formatted in HTML, which integrates layout box information and descriptions of illustrations into HTML tag structures.

文档全解析数据：为训练 Qwen2.5-VL，我们合成了大量文档数据。传统的文档内容解析方法通常依赖单独的模型来处理布局分析、文本提取、图表解读和插图处理。相比之下，Qwen2.5-VL 旨在赋予通用模型全面的解析、理解和转换文档格式的能力。具体而言，我们在文档中整合了多种元素，如表格、图表、公式、自然或合成图像、乐谱和化学公式。这些元素统一格式化为 HTML，将布局框信息和插图描述整合到 HTML 标签结构中。

OCR Data: Data from different sources are gathered and curated to enhance the OCR performance, including synthetic data, open-sourced data and in-house collected data. Synthetic data is generated through a visual text generation engine to produce high-quality text images in the wild. To support a wider range of languages and enhance multilingual capabilities, we have incorporated a large-scale multilingual OCR dataset. This dataset includes support for diverse languages such as French, German, Italian, Spanish, Portuguese, Arabic, Russian, Japanese, Korean, and Vietnamese. For chart-type data, we synthesized 1 million samples using visualization libraries including matplotlib, seaborn, and plotly. Regarding tabular data, we processed 6 million real-world samples through an offline end-to-end table recognition model.

OCR 数据：收集和整理了来自不同来源的数据以增强 OCR 性能，包括合成数据、开源数据和内部收集数据。合成数据通过视觉文本生成引擎生成，以产生野外场景的高质量文本图像。为支持更广泛的语言并增强多语言能力，我们纳入了大规模多语言 OCR 数据集，支持法语、德语、意大利语、西班牙语、葡萄牙语、阿拉伯语、俄语、日语、韩语和越南语等。对于图表类型数据，我们使用 matplotlib、seaborn 和 plotly 等可视化库合成了 100 万个样本。对于表格数据，我们通过离线端到端表格识别模型处理了 600 万个真实样本。

Video Data: To ensure enhanced robustness in understanding video data with varying frames per second (FPS), we dynamically sampled FPS during training to achieve a more evenly distributed representation of FPS within the training dataset. Additionally, for videos exceeding half an hour in length, we specifically constructed a set of long video captions by synthesizing multi-frame captions through a targeted synthesis pipeline. Regarding video grounding data, we formulated timestamps in both second-based formats and hour-minute-second-frame (hmsf) formats.

视频数据：为确保对具有不同 FPS 的视频数据有更稳健的理解，我们在训练期间动态采样 FPS，以在训练数据集中实现更均匀分布的 FPS 表示。此外，对于超过半小时的视频，我们通过有针对性的合成流水线合成多帧描述，专门构建了一组长视频描述。关于视频定位数据，我们用基于秒的格式和时分秒帧(hmsf)格式制定了时间戳。

Agent Data: We enhance the perception and decision-making abilities to build the agent capabilities of Qwen2.5-VL. For perception, we collect screenshots on mobile, web, and desktop platforms. A synthetic data engine is used to generate screenshot captions and UI element grounding annotations. For decision-making, we first unify the operations across mobile, web, and desktop platforms into a function call format with a shared action space. A set of annotated multi-step trajectories collected from open-source data and synthesized by agent framework on virtual environments are reformatted into a function format. We further generate a reasoning process for each step through human and model annotators.

Agent 数据：我们增强感知和决策能力以构建 Qwen2.5-VL 的 Agent 能力。对于感知，我们在移动、网页和桌面平台上收集截图。使用合成数据引擎生成截图描述和 UI 元素定位标注。对于决策，我们首先将跨移动、网页和桌面平台的操作统一为具有共享动作空间的函数调用格式。从开源数据收集并由虚拟环境中的 Agent 框架合成的一组标注多步轨迹被重新格式化为函数格式。我们进一步通过人类和模型标注者为每一步生成推理过程。

Table 2: Training data volume and composition across different stages.
表 2：不同阶段的训练数据量和组成。

(表格数据见原始 MinerU-EN 文件)

> **译者注**：预训练数据从 1.2T(Qwen2-VL)扩展到 4.1T(Qwen2.5-VL)，增幅约 3.4 倍。数据构成的精细化程度非常高：交错数据经过 4 维评分(文本质量/图文相关/图文互补/信息密度平衡)，定位数据涵盖 10,000+类别并支持绝对坐标，文档数据统一用 HTML 格式(含布局框信息)，OCR 覆盖 10+语言，视频支持动态 FPS 和 hmsf 时间格式，Agent 数据包含跨平台操作和推理过程。三阶段训练策略(ViT 预训练 1.5T → 多模态预训练 2T → 长上下文预训练 0.6T)也体现了渐进式能力构建的思路。

#### 2.2.2 Training Recipe

We trained a Vision Transformer (ViT) from scratch using DataComp and some in-house datasets as the initialization for the vision encoder, while leveraging the pre-trained Qwen2.5 large language model (LLM) as the initialization for the LLM component. As shown in Table 2, the pre-training process is divided into three distinct phases.

**2.2.2 训练方案**
我们使用 DataComp 和一些内部数据集从头训练 ViT 作为视觉编码器的初始化，同时利用预训练的 Qwen2.5 LLM 作为 LLM 组件的初始化。如表 2 所示，预训练过程分为三个不同阶段。

In the first phase, only the Vision Transformer (ViT) is trained to improve its alignment with the language model, laying a solid foundation for multimodal understanding. The primary data sources during this phase include image captions, visual knowledge, and OCR data.

第一阶段，仅训练 ViT 以改善其与语言模型的对齐，为多模态理解奠定坚实基础。此阶段的主要数据源包括图像描述、视觉知识和 OCR 数据。

In the second phase, all model parameters are unfrozen, and the model is trained on a diverse set of multimodal image data to enhance its capacity to process complex visual information. This phase introduces more intricate and reasoning-intensive datasets, such as interleaved data, multi-task learning datasets, visual question answering (VQA), multimodal mathematics, agent-based tasks, video understanding, and pure-text datasets.

第二阶段，解冻所有模型参数，模型在多样化的多模态图像数据上训练，以增强处理复杂视觉信息的能力。此阶段引入更复杂和推理密集的数据集，如交错数据、多任务学习数据集、VQA、多模态数学、Agent 任务、视频理解和纯文本数据集。

In the third phase, to further enhance the model's reasoning capabilities over longer sequences, video, and agent-based data are incorporated, alongside an increase in sequence length. This allows the model to tackle more advanced and intricate multimodal tasks with greater precision.

第三阶段，为进一步增强模型对更长序列的推理能力，纳入了视频和 Agent 数据，同时增加序列长度。这使模型能够以更高的精度处理更先进和复杂的多模态任务。

To address the challenges posed by varying image sizes and text lengths, which can lead to imbalanced computational loads during training, we adopted a strategy to optimize training efficiency. Specifically, we dynamically packed data samples based on their corresponding input sequence lengths to the LLM, ensuring consistent computational loads. In the first and second phases, data were uniformly packed to a sequence length of 8,192, while in the third phase, the sequence length was increased to 32,768.

为解决不同图像尺寸和文本长度带来的挑战(这可能导致训练期间计算负载不均衡)，我们采用了优化训练效率的策略。具体而言，我们根据数据样本对应的 LLM 输入序列长度动态打包，确保计算负载一致。在第一和第二阶段，数据统一打包到 8192 的序列长度，而在第三阶段，序列长度增加到 32768。

> **译者注**：三阶段预训练策略非常系统。第一阶段"ViT-only"确保视觉编码器在接入 LLM 之前已经具备了良好的视觉表示能力，避免了"冷启动"问题。第二阶段的"全参数解冻"是能力跃升的关键——此时模型学会了真正的跨模态关联。第三阶段的长序列训练(32K)为视频理解和长文档解析奠定了基础。动态打包(dynamic packing)是解决多模态训练效率问题的经典工程技巧——由于图像尺寸不同，对应的视觉 token 数差异巨大，简单的按样本 batching 会导致严重的 GPU 负载不均衡。通过按序列长度打包，可以最大化 GPU 利用率。

### 2.3 Post-training

The post-training alignment framework of Qwen2.5-VL employs a dual-stage optimization paradigm comprising Supervised Fine-Tuning (SFT) and Direct Preference Optimization (DPO). This hierarchical alignment strategy synergizes parameter-efficient domain adaptation with human preference distillation, addressing both representational grounding and behavioral refinement through distinct optimization objectives.

**2.3 后训练**
Qwen2.5-VL 的后训练对齐框架采用包含监督微调(SFT)和直接偏好优化(DPO)的双阶段优化范式。这种分层对齐策略将参数高效的领域适应与人类偏好蒸馏协同起来，通过不同的优化目标解决表示 grounding 和行为细化两方面问题。

Supervised Fine-Tuning (SFT) aims to bridge the gap between pretrained representations and downstream task requirements through targeted instruction optimization. During this phase, we employ the ChatML format to structure instruction-following data. This format transition enables three critical adaptations: 1) Explicit dialogue role tagging for multimodal turntaking, 2) Structured injection of visual embeddings alongside textual instructions, and 3) Preservation of cross-modal positional relationships through format-aware packing.

监督微调(SFT)旨在通过有针对性的指令优化来弥合预训练表示与下游任务需求之间的差距。在此阶段，我们使用 ChatML 格式来构建指令遵循数据。这种格式转换实现了三个关键适应：(1) 用于多模态轮转的显式对话角色标记，(2) 视觉嵌入与文本指令的结构化注入，(3) 通过格式感知打包保留跨模态位置关系。

#### 2.3.1 Instruction Data

The Supervised Fine-Tuning (SFT) phase employs a meticulously curated dataset designed to enhance the model's instruction-following capabilities across diverse modalities. This dataset comprises approximately 2 million entries, evenly distributed between pure text data (50%) and multimodal data (50%), which includes image-text and video-text combinations. The dataset is primarily composed of Chinese and English data, with supplementary multilingual entries.

**2.3.1 指令数据**
SFT 阶段采用精心策划的数据集，旨在增强模型跨多样化模态的指令遵循能力。该数据集包含约 200 万个条目，在纯文本数据(50%)和多模态数据(50%，包括图像-文本和视频-文本组合)之间均匀分布。数据集主要由中文和英文数据组成，辅以多语言条目。

The dataset is structured to reflect varying levels of dialogue complexity, including both single-turn and multi-turn interactions. These interactions are further contextualized by scenarios ranging from single-image inputs to multi-image sequences, thereby simulating realistic conversational dynamics. To address a wide range of application scenarios, the dataset includes specialized subsets for General VQA, image captioning, mathematical problem-solving, coding tasks, and security-related queries. Additionally, dedicated datasets for Document and OCR, Grounding, Video Analysis, and Agent Interactions are constructed to enhance domain-specific proficiency.

数据集的结构反映了不同层次的对话复杂性，包括单轮和多轮交互。这些交互进一步通过从单图像输入到多图像序列的场景进行情境化，从而模拟真实的对话动态。为应对广泛的应用场景，数据集包括通用 VQA、图像描述、数学解题、编码任务和安全相关查询的专用子集。此外，还构建了文档和 OCR、定位、视频分析和 Agent 交互的专用数据集，以增强领域特定能力。

#### 2.3.2 Data Filtering Pipeline

The quality of training data is a critical factor influencing the performance of vision-language models. We implement a two-stage data filtering pipeline designed to systematically enhance the quality of the SFT dataset.

**2.3.2 数据过滤流水线**
训练数据的质量是影响视觉语言模型性能的关键因素。我们实现了一个两阶段数据过滤流水线，旨在系统性地提升 SFT 数据集的质量。

Stage 1: Domain-Specific Categorization. In the initial stage, we employ Qwen2-VL-Instag, a specialized classification model derived from Qwen2-VL-72B, to perform hierarchical categorization of question-answer (QA) pairs. This model organizes QA pairs into eight primary domains, such as Coding and Planning, which are further divided into 30 fine-grained subcategories.

第一阶段：领域特定分类。在初始阶段，我们使用 Qwen2-VL-Instag(从 Qwen2-VL-72B 派生的专用分类模型)对 QA 对进行层次化分类。该模型将 QA 对组织为八个主要领域(如编码和规划)，进一步细分为 30 个细粒度子类别。

Stage 2: Domain-Tailored Filtering. The second stage involves domain-tailored filtering, which integrates both rule-based and model-based approaches. Rule-Based Filtering employs predefined heuristics to eliminate low-quality or problematic entries. Model-Based Filtering further refines the dataset by leveraging reward models trained on the Qwen2.5-VL series. These models evaluate multimodal QA pairs across multiple dimensions.

第二阶段：领域定制过滤。第二阶段涉及领域定制过滤，整合基于规则和基于模型的方法。基于规则的过滤采用预定义启发式方法消除低质量或有问题的条目。基于模型的过滤通过利用在 Qwen2.5-VL 系列上训练的奖励模型进一步细化数据集，这些模型从多个维度评估多模态 QA 对。

#### 2.3.3 Rejection Sampling for Enhanced Reasoning

To complement our structured data filtering pipeline, we employ rejection sampling as a strategy to refine the dataset and enhance the reasoning capabilities of the VLM. This approach is particularly critical for tasks requiring complex inference, such as mathematical problem-solving, code generation, and domain-specific VQA. Prior research has shown that incorporating Chain-of-Thought (CoT) reasoning significantly improves a model's inferential performance.

**2.3.3 拒绝采样增强推理**
为补充结构化的数据过滤流水线，我们采用拒绝采样作为策略来细化数据集并增强 VLM 的推理能力。这种方法对于需要复杂推理的任务(如数学解题、代码生成和领域特定 VQA)尤为关键。先前研究表明，纳入思维链(CoT)推理显著提高了模型的推理性能。

The rejection sampling process begins with datasets enriched with ground truth annotations. Using an intermediate version of the Qwen2.5-VL model, we evaluate the generated responses against the ground truth. Only samples where the model's output matches the expected answers are retained. To further improve data quality, we apply additional constraints to filter out undesirable outputs, excluding responses that exhibit code-switching, excessive length, or repetitive patterns.

拒绝采样过程从带有真实标注的数据集开始。使用 Qwen2.5-VL 的中间版本，我们根据真实标注评估生成的回复。仅保留模型输出与预期答案匹配的样本。为进一步提高数据质量，我们应用额外约束过滤掉不良输出，排除表现出代码切换、过长或重复模式的回复。

A key challenge in applying CoT reasoning to vision-language models is their reliance on both textual and visual modalities. Intermediate reasoning steps may fail to adequately integrate visual information. To address this, we have developed rule-based and model-driven filtering strategies to validate the accuracy of intermediate reasoning steps. Despite these efforts, achieving optimal modality alignment remains an ongoing challenge.

将 CoT 推理应用于视觉语言模型的一个关键挑战是它们对文本和视觉模态的双重依赖。中间推理步骤可能未能充分整合视觉信息。为解决这一问题，我们开发了基于规则和模型驱动的过滤策略来验证中间推理步骤的准确性。尽管付出了这些努力，实现最佳模态对齐仍然是一个持续的挑战。

#### 2.3.4 Training Recipe

The post-training process for Qwen2.5-VL consists of two phases: Supervised Fine-Tuning (SFT) and Direct Preference Optimization (DPO), both with the Vision Transformer (ViT) parameters frozen.

**2.3.4 训练方案**
Qwen2.5-VL 的后训练过程包括两个阶段：监督微调(SFT)和直接偏好优化(DPO)，两者都冻结 ViT 参数。

In the SFT phase, the model is fine-tuned on diverse multimodal data, including image-text pairs, video, and pure text, sourced from general VQA, Rejection Sampling, and specialized datasets such as Document and OCR, Grounding, Video, and Agent-related tasks. The DPO phase focuses exclusively on image-text and pure text data, utilizing preference data to align the model with human preferences, with each sample processed only once to ensure efficient optimization.

在 SFT 阶段，模型在多样化的多模态数据上进行微调，包括来自通用 VQA、拒绝采样和专用数据集(如文档和 OCR、定位、视频和 Agent 相关任务)的图像-文本对、视频和纯文本。DPO 阶段专注于图像-文本和纯文本数据，利用偏好数据将模型与人类偏好对齐，每个样本仅处理一次以确保高效优化。

> **译者注**：后训练阶段有几个值得注意的设计选择：(1) ViT 参数在 SFT 和 DPO 中都被冻结——这说明视觉感知能力在预训练阶段已经基本定型，后训练主要优化跨模态对齐和指令遵循; (2) SFT 数据 200 万条，50% 纯文本 + 50% 多模态——保持纯文本比例是为了防止多模态微调导致语言能力的灾难性遗忘; (3) 拒绝采样用于增强 CoT 推理能力，但特别强调了视觉-文本模态对齐的挑战——这是 VLM 相比纯文本 LLM 的独特难点; (4) DPO 阶段每个样本只处理一次，这与一些工作多次迭代 DPO 的做法不同，可能是出于计算效率考虑。

---

## 3 Experiments

In this section, we first introduce the overall model and compare it with the current state-of-the-art (SoTA) models. Then, we evaluate the model's performance across various sub-capabilities.

**3 实验**
本节首先介绍整体模型并将其与当前 SOTA 模型进行比较。然后，我们在各种子能力上评估模型性能。

### 3.1 Comparison with the SOTA Models

Table 3: Performance of Qwen2.5-VL and State-of-the-art.
表 3：Qwen2.5-VL 与 SOTA 模型的性能对比。

(表格数据见原始 MinerU-EN 文件)

The experimental section evaluates the performance of Qwen2.5-VL across a variety of datasets, comparing it with state-of-the-art models such as Claude-3.5-Sonnet-0620, GPT-4o-0513, InternVL2.5, and different sizes of Qwen2-VL. In college-level problems, Qwen2.5-VL-72B achieves a score of 70.2 on MMMU. For MMMU-Pro, Qwen2.5-VL-72B scores 51.1, surpassing the previous open-source state-of-the-art models and achieving performance comparable to GPT-4o.

实验部分在多种数据集上评估了 Qwen2.5-VL 的性能，与 Claude-3.5-Sonnet-0620、GPT-4o-0513、InternVL2.5 和不同尺寸的 Qwen2-VL 等 SOTA 模型进行比较。在大学水平问题上，72B 在 MMMU 上取得 70.2 分。对于 MMMU-Pro，72B 得分 51.1，超越了此前的开源 SOTA 模型，达到与 GPT-4o 相当的性能。

In math-related tasks, Qwen2.5-VL-72B demonstrates strong capabilities. On MathVista, it achieves a score of 74.8, outperforming the previous open-source state-of-the-art score of 72.3. For MATH-Vision, Qwen2.5-VL-72B scores 38.1, while MathVerse achieves 57.6, both showing competitive results.

在数学相关任务中，72B 展现出强大能力。在 MathVista 上取得 74.8 分，超越此前开源 SOTA 的 72.3 分。对于 MATH-Vision，72B 得分 38.1，MathVerse 达到 57.6，均显示出有竞争力的结果。

For general visual question answering, Qwen2.5-VL-72B excels across multiple benchmarks. On MMbench-EN, it achieves a score of 88.6, slightly surpassing the previous best score of 88.3. The model also performs well in MuirBench with a score of 70.7 and BLINK with 64.4.

对于通用视觉问答，72B 在多个基准上表现出色。在 MMbench-EN 上取得 88.6 分，略微超越此前最佳 88.3 分。模型在 MuirBench 上也表现良好，得分 70.7，BLINK 得分 64.4。

### 3.2 Performance on Pure Text Tasks

To critically evaluate the performance of instruction-tuned models on pure text tasks, we selected several representative benchmarks to assess the model's capabilities across a variety of domains. We compared Qwen2.5-VL with several large language models (LLMs) of similar size. The results demonstrate that Qwen2.5-VL not only achieves state-of-the-art performance on multimodal tasks but also exhibits leading performance on pure text tasks.

**3.2 纯文本任务性能**
为严格评估指令微调模型在纯文本任务上的性能，我们选取了多个代表性基准来评估模型在各个领域的能力。我们将 Qwen2.5-VL 与多个相似尺寸的 LLM 进行比较。结果表明，Qwen2.5-VL 不仅在多模态任务上达到 SOTA 性能，在纯文本任务上也表现出领先性能。

Table 4: Performance on pure text tasks of the 70B+ Instruct models and Qwen2.5-VL.
表 4：70B+ 指令模型和 Qwen2.5-VL 的纯文本任务性能。

(表格数据见原始 MinerU-EN 文件)

> **译者注**：Qwen2.5-VL-72B 在纯文本任务上的表现非常值得关注。MMLU-Pro 71.2 分接近 Qwen2.5-72B 的 71.1，MATH 83.0 接近 Qwen2.5-72B 的 83.1，HumanEval 87.8 甚至超过了 Qwen2.5-72B 的 86.6。这说明 Qwen2.5-VL 的视觉训练几乎没有损害纯文本能力——这是通过 SFT 阶段保持 50% 纯文本数据比例实现的。一个有趣的细节是 LiveBench-0831 得分 57.0，显著高于 Qwen2.5-72B 的 52.3——这可能是因为多模态训练增强了模型对复杂指令的理解能力。

### 3.3 Quantitative Results

#### 3.3.1 General Visual Question Answering

To comprehensively evaluate the model's capabilities in general VQA and dialogue, we conducted extensive experiments across a diverse range of datasets. Qwen2.5-VL demonstrates state-of-the-art performance in various VQA tasks, subjective evaluations, multilingual scenarios, and multi-image questions. Specifically, it excels on benchmark datasets such as MMBench series, MMStar, MME, MuirBench, BLINK, CRPE, HallBench, MTVQA, MME-RealWorld, MMVet, and MM-MT-Bench.

**3.3 定量结果**
**3.3.1 通用视觉问答**
为全面评估模型在通用 VQA 和对话中的能力，我们在多样化数据集上进行了大量实验。Qwen2.5-VL 在各种 VQA 任务、主观评估、多语言场景和多图像问题上表现出 SOTA 性能。具体而言，它在 MMBench 系列、MMStar、MME、MuirBench、BLINK、CRPE、HallBench、MTVQA、MME-RealWorld、MMVet 和 MM-MT-Bench 等基准数据集上表现出色。

Notably, even the smaller-scale versions of Qwen2.5-VL, specifically Qwen2.5-VL-7B and Qwen2.5-VL-3B, exhibit highly competitive performance. For instance, on the MMStar dataset, Qwen2.5-VL-7B achieves 63.9%, while Qwen2.5-VL-3B scores 55.9%. This demonstrates that Qwen2.5-VL's architecture is not only powerful but also scalable.

值得注意的是，即使是较小尺寸的 Qwen2.5-VL 版本(7B 和 3B)也表现出极具竞争力的性能。例如，在 MMStar 数据集上，7B 达到 63.9%，3B 得分 55.9%。这证明 Qwen2.5-VL 的架构不仅强大，而且具有可扩展性。

#### 3.3.2 Document Understanding and OCR

We evaluated our models across a diverse range of OCR, chart, and document understanding benchmarks. For OCR-related parsing benchmarks on element parsing for multi-scene, multilingual, and various built-in documents, Qwen2.5-VL-72B model sets the new state-of-the-art. For OCR-related understanding benchmarks, Qwen2.5-VL models achieve impressive performance. Notably, on composite OCR-related understanding benchmarks as OCRBench, InfoVQA, and SEED-Bench-2-Plus, Qwen2.5-VL-72B achieves remarkable results, significantly outperforming strong competitors such as InternVL2.5-78B.

**3.3.2 文档理解和 OCR**
我们在多种 OCR、图表和文档理解基准上评估了模型。对于多场景、多语言和各种内置元素的 OCR 相关解析基准，72B 模型创下新 SOTA。对于 OCR 相关理解基准，Qwen2.5-VL 模型取得了令人印象深刻的性能。值得注意的是，在 OCRBench、InfoVQA 和 SEED-Bench-2-Plus 等综合性 OCR 理解基准上，72B 取得了显著结果，大幅超越 InternVL2.5-78B 等强劲竞争对手。

Furthermore, for OCR-related comprehensive benchmarks as OCRBench_v2 including a wide range of OCR-related parsing and understanding tasks, top performance is also achieved by Qwen2.5-VL models, largely exceeding best model Gemini 1.5-Pro by 9.6% and 20.6% for English and Chinese track respectively.

此外，对于 OCRBench_v2 等涵盖广泛 OCR 解析和理解任务的综合性基准，Qwen2.5-VL 模型也取得了顶级性能，在英文和中文赛道上分别大幅超越最佳模型 Gemini 1.5-Pro 9.6% 和 20.6%。

Table 5: Performance of Qwen2.5-VL and other models on OCR, chart, and document understanding benchmarks.
表 5：Qwen2.5-VL 及其他模型在 OCR、图表和文档理解基准上的性能。

(表格数据见原始 MinerU-EN 文件)

#### 3.3.3 Spatial Understanding

Understanding spatial relationships is crucial for developing AI models that can interpret and interact with the world as humans do. We evaluated Qwen2.5-VL's grounding capabilities on the referring expression comprehension benchmarks, object detection in the wild, self-curated point grounding benchmark, and CountBench.

**3.3.3 空间理解**
理解空间关系对于开发能够像人类一样解读和与世界交互的 AI 模型至关重要。我们在引用表达理解基准、野外物体检测、自策划点定位基准和 CountBench 上评估了 Qwen2.5-VL 的定位能力。

Qwen2.5-VL achieves leading performance across different benchmarks from box-grounding, and point-grounding to counting. For open-vocabulary object detection, Qwen2.5-VL achieves a good performance of 43.1 mAP on ODinW-13, surpassing most LVLMs and quickly narrowing the gap between generalist models and specialist models. In addition, Qwen2.5-VL unlocks the point-based grounding ability so that it could precisely locate the very details of a certain object. Qwen2.5-VL's counting ability also makes great progress, achieving a leading accuracy of 93.6 on CountBench.

Qwen2.5-VL 在从框定位、点定位到计数的不同基准上都取得了领先性能。对于开放词汇物体检测，72B 在 ODinW-13 上达到 43.1 mAP，超越了大多数 LVLM，快速缩小了通用模型和专用模型之间的差距。此外，Qwen2.5-VL 解锁了点定位能力，能够精确定位某个物体的具体细节。Qwen2.5-VL 的计数能力也取得了重大进步，在 CountBench 上达到领先的 93.6 准确率。

Table 6: Performance of Qwen2.5-VL and other models on grounding.
表 6：Qwen2.5-VL 及其他模型在定位上的性能。

Table 7: Performance of Qwen2.5-VL and other models on counting.
表 7：Qwen2.5-VL 及其他模型在计数上的性能。

(表格数据见原始 MinerU-EN 文件)

#### 3.3.4 Video Understanding and Grounding

We assessed our models across a diverse range of video understanding and grounding tasks, utilizing benchmarks that include videos ranging from a few seconds to several hours in length. Notably, on LVBench and MLVU, which evaluate long-form video understanding capabilities through question-answering tasks, Qwen2.5-VL-72B achieves remarkable results, significantly outperforming strong competitors such as GPT-4o.

**3.3.4 视频理解和定位**
我们在多样化的视频理解和定位任务上评估了模型，使用的基准包含从几秒到数小时长度的视频。值得注意的是，在通过问答任务评估长视频理解能力的 LVBench 和 MLVU 上，72B 取得了显著结果，大幅超越 GPT-4o 等强劲竞争对手。

By utilizing the proposed synchronized MRoPE, Qwen2.5-VL enhances its capabilities in time-sensitive video understanding, featuring improved timestamp referencing, temporal grounding, dense captioning, and additional functionalities. On the Charades-STA dataset, Qwen2.5-VL-72B achieves an impressive mIoU score of 50.9, thereby surpassing the performance of GPT-4o. For all evaluated benchmarks, we capped the maximum number of frames analyzed per video at 768, with the total number of video tokens not exceeding 24,576.

通过利用所提出的同步 MRoPE，Qwen2.5-VL 增强了其在时间敏感视频理解方面的能力，包括改进的时间戳引用、时间定位、密集描述和额外功能。在 Charades-STA 数据集上，72B 达到令人印象深刻的 50.9 mIoU 分数，超越了 GPT-4o 的性能。对于所有评估基准，我们将每视频分析的最大帧数限制为 768，视频 token 总数不超过 24,576。

Table 8: Performance of Qwen2.5-VL and other models on video benchmarks.
表 8：Qwen2.5-VL 及其他模型在视频基准上的性能。

(表格数据见原始 MinerU-EN 文件)

> **译者注**：视频理解是 Qwen2.5-VL 相比 Qwen2-VL 最显著的升级领域。关键数据点：(1) LVBench 47.3 vs GPT-4o 30.8，优势巨大; (2) MLVU 74.6 vs GPT-4o 64.6; (3) Charades-STA mIoU 50.9 vs GPT-4o 35.7。这些结果验证了绝对时间编码 MRoPE 的有效性——模型不仅能理解"视频里发生了什么"，还能精确回答"这件事发生在第几分钟第几秒"。768 帧 / 24,576 video tokens 的限制说明即使是 72B 模型，处理超长视频时也需要在帧级别做取舍，这是一个工程上的实用约束。

#### 3.3.5 Agent

Agent capabilities within multimodal models are crucial for enabling these models to effectively interact with real-world devices. We assess the agent capabilities of Qwen2.5-VL through various aspects. The UI elements grounding is evaluated by ScreenSpot and ScreenSpot Pro. Offline evaluations are conducted on Android Control, while online evaluations are performed on platforms including AndroidWorld, MobileMiniWob++, and OSWorld.

**3.3.5 Agent**
多模态模型中的 Agent 能力对于使这些模型能够有效与真实世界设备交互至关重要。我们通过多个方面评估 Qwen2.5-VL 的 Agent 能力。UI 元素定位由 ScreenSpot 和 ScreenSpot Pro 评估。离线评估在 Android Control 上进行，在线评估在 AndroidWorld、MobileMiniWob++ 和 OSWorld 等平台上进行。

Table 9: Performance of Qwen2.5-VL and other models on GUI Agent benchmarks.
表 9：Qwen2.5-VL 及其他模型在 GUI Agent 基准上的性能。

(表格数据见原始 MinerU-EN 文件)

The performance of Qwen2.5-VL-72B demonstrates exceptional advancements across GUI grounding benchmarks. It achieves 87.1% accuracy on ScreenSpot, competing strongly with Gemini 2.0 (84.0%) and Claude (83.0%), while notably setting a new standard on ScreenSpot Pro with 43.6% accuracy - far surpassing both Aguvis-72B (23.6%) and its foundation Qwen2-VL-72B (1.6%). Leveraging these superior grounding capabilities, Qwen2.5-VL-72B significantly outperforms baselines across all offline evaluation benchmarks with a large gap. In online evaluation, Qwen2.5-VL-72B can outperform the baselines on AndroidWorld and MobileMiniWob++ and achieve comparable performance on OSWorld in online evaluation without auxiliary marks. This observation suggests that Qwen2.5-VL-72B is able to function as an agent in real and dynamic environments.

72B 在 GUI 定位基准上展现出卓越进步。它在 ScreenSpot 上达到 87.1% 准确率，与 Gemini 2.0(84.0%)和 Claude(83.0%)激烈竞争，同时在 ScreenSpot Pro 上以 43.6% 的准确率创下新标准——远超 Aguvis-72B(23.6%)和其基础模型 Qwen2-VL-72B(1.6%)。利用这些卓越的定位能力，72B 在所有离线评估基准上以巨大优势显著超越基线。在在线评估中，72B 在 AndroidWorld 和 MobileMiniWob++ 上超越基线，在 OSWorld 上达到可比的性能，且无需辅助标记。这表明 72B 能够在真实和动态环境中作为 Agent 运行。

> **译者注**：Agent 能力是 Qwen2.5-VL 最令人瞩目的突破。ScreenSpot Pro 从 1.6%(Qwen2-VL-72B)跃升到 43.6%(Qwen2.5-VL-72B)——这不是渐进式改进，而是质的飞跃。ScreenSpot Pro 测试的是高分辨率专业软件界面上的精确元素定位，1.6% 意味着几乎无法使用，而 43.6% 意味着可以实际部署。Android Control High EM 67.36% 和 Low EM 93.7% 的结果也非常亮眼。值得注意的是，Qwen2.5-VL 在 OSWorld(8.83)上落后于 Claude(14.90)——OSWorld 是开放式桌面任务，需要多步规划和错误恢复，这说明纯定位能力不足以解决所有 Agent 问题，规划和推理仍然是瓶颈。

---

## 4 Conclusion

We present Qwen2.5-VL, a state-of-the-art vision-language model series that achieves significant advancements in multimodal understanding and interaction. With enhanced capabilities in visual recognition, object localization, document parsing, and long-video comprehension, Qwen2.5-VL excels in both static and dynamic tasks. Its native dynamic-resolution processing and absolute time encoding enable robust handling of diverse inputs, while Window Attention reduces computational overhead without sacrificing resolution fidelity. Qwen2.5-VL caters to a wide range of applications, from edge AI to high-performance computing. The flagship Qwen2.5-VL-72B matches or surpasses leading models like GPT-4o, and Claude 3.5 Sonnet, particularly in document and diagram understanding, while maintaining strong performance on pure text tasks. The smaller Qwen2.5-VL-7B and Qwen2.5-VL-3B variants outperform similarly sized competitors, offering efficiency and versatility. Qwen2.5-VL sets a new benchmark for vision-language models, demonstrating exceptional generalization and task execution across domains.

**4 结论**
我们呈现 Qwen2.5-VL，一个在多模态理解和交互方面取得显著进步的 SOTA 视觉语言模型系列。凭借在视觉识别、物体定位、文档解析和长视频理解方面的增强能力，Qwen2.5-VL 在静态和动态任务中都表现出色。其原生动态分辨率处理和绝对时间编码使其能够稳健处理多样化输入，而 Window Attention 在不影响分辨率保真度的情况下降低了计算开销。Qwen2.5-VL 满足从边缘 AI 到高性能计算的广泛应用需求。旗舰模型 72B 达到或超越 GPT-4o 和 Claude 3.5 Sonnet 等领先模型，尤其在文档和图表理解方面，同时保持强大的纯文本任务性能。较小的 7B 和 3B 变体超越同尺寸竞争对手，提供效率和多功能性。Qwen2.5-VL 为视觉语言模型树立了新基准，展示了跨领域的卓越泛化和任务执行能力。

> **译者注**：Qwen2.5-VL 的技术报告展示了一个从架构到数据到训练的全栈优化故事。核心创新可以总结为：(1) 视觉侧：窗口注意力 ViT + 原生动态分辨率 + 2D-RoPE; (2) 时序侧：绝对时间对齐 MRoPE + 动态 FPS 采样; (3) 数据侧：4.1T tokens 预训练语料 + 精细化的 8 域 30 子类 SFT 数据过滤; (4) Agent 侧：从 1.6% 到 43.6% 的 ScreenSpot Pro 跨越。72B 模型在文档理解、视频定位、GUI Agent 三个方向上都达到或超越了 GPT-4o，而 3B 小模型也能在多项任务上保持竞争力——这是架构效率、数据质量和训练策略三者协同的结果。对于社区而言，Qwen2.5-VL 的开源(Apache 2.0)为 LVLM 的工业落地提供了强有力的基座选择。

---

## 5 Authors

Core Contributors: Shuai Bai, Keqin Chen, Xuejing Liu, Jialin Wang, Wenbin Ge, Sibo Song, Kai Dang, Peng Wang, Shijie Wang, Jun Tang, Humen Zhong, Yuanzhi Zhu, Mingkun Yang, Zhaohai Li, Jianqiang Wan, Pengfei Wang, Wei Ding, Zheren Fu, Yiheng Xu, Jiabo Ye, Xi Zhang, Tianbao Xie, Zesen Cheng, Hang Zhang, Zhibo Yang, Haiyang Xu, Junyang Lin

Contributors: An Yang, Binyuan Hui, Bowen Yu, Chen Cheng, Dayiheng Liu, Fan Hong, Fei Huang, Jiawei Liu, Jin Xu, Jianhong Tu, Jianyuan Zeng, Jie Zhang, Jinkai Wang, Jianwei Zhang, Jingren Zhou, Kexin Yang, Mei Li, Ming Yan, Na Ni, Rui Men, Songtao Jiang, Xiaodong Deng, Xiaoming Huang, Ximing Zhou, Xingzhang Ren, Yang Fan, Yichang Zhang, Yikai Zhu, Yuqiong Liu, Zhifang Guo

**5 作者**
核心贡献者：白帅、陈克勤、刘学晶、王佳林、葛文彬、宋思博、党凯、王鹏、王士杰、唐俊、钟虎门、朱元志、阳明坤、李兆海、万建强、王鹏飞、丁伟、付哲人、许一恒、叶家博、张曦、谢天宝、程泽森、张航、杨志博、徐海洋、林俊旸

贡献者：杨安、惠彬源、于博文、程晨、刘大衍、洪帆、黄飞、刘佳伟、徐进、涂建宏、曾建元、张杰、王进凯、张建伟、周靖人、杨可欣、李梅、严明、倪娜、门睿、蒋松涛、邓晓东、黄晓明、周希明、任星璋、樊洋、张毅昌、朱毅凯、刘玉琼、郭志芳

---

## References

参考文献列表见原始 MinerU-EN 文件(03-Qwen2.5-VL-mineru-en.md)。主要引用包括：

- **Alayrac et al. (2022)**：Flamingo，视觉语言模型的少样本学习
- **Anthropic (2024a/b)**：Claude 3.5 Sonnet / Computer Use
- **Chen et al. (2024d)**：InternVL2.5，开源多模态模型的扩展
- **Dauphin et al. (2017)**：SwiGLU 激活函数
- **DeepSeek-AI et al. (2024)**：DeepSeek-V3 技术报告
- **Deitke et al. (2024)**：Molmo 和 PixMo，开放权重和数据的多模态模型
- **Gadre et al. (2023)**：DataComp，下一代多模态数据集搜索
- **Ghiasi et al. (2021)**：Copy-Paste 数据增强
- **Kirillov et al. (2023)**：Segment Anything (SAM)
- **Liu et al. (2023c)**：Grounding DINO，开放集物体检测
- **OpenAI (2024)**：GPT-4o / ChatML
- **Rafailov et al. (2023)**：DPO，直接偏好优化
- **Su et al. (2024)**：RoPE 旋转位置编码
- **Wang et al. (2024e)**：Qwen2-VL，任意分辨率视觉语言模型
- **Yang et al. (2024a)**：Qwen2.5 技术报告
- **Zhang & Sennrich (2019)**：RMSNorm 均方根层归一化

---

> **全文译者总结**：Qwen2.5-VL 的技术报告呈现了一个在视觉语言模型领域全面领先的开源工作。从架构上看，窗口注意力 ViT(4 层全局 + 28 层窗口)解决了原生分辨率输入的计算瓶颈; MRoPE 的绝对时间对齐使模型真正理解了"时间"而不仅是"帧序列"。从数据上看，4.1T tokens 的预训练语料(比 Qwen2-VL 增加 3.4 倍)覆盖了图像描述、交错数据、OCR、视觉知识、定位、文档解析、视频描述、视频定位、Agent 交互等 9 大类数据，且每类数据都有精细的清洗和评分流程。从训练上看，三阶段预训练(1.5T ViT → 2T 全参数 → 0.6T 长序列)+ 双阶段后训练(SFT + DPO，ViT 冻结)的策略确保了能力的渐进式构建。从评估上看，72B 在文档理解(OmniDocBench CC-OCR 79.8%)、视频定位(Charades-STA 50.9 mIoU)、GUI Agent(ScreenSpot Pro 43.6%)三个方向均超越或达到 GPT-4o 水平，而 7B/3B 小模型也展现出超越同尺寸竞争对手的实力。对于 LVLM 研究和应用社区，Qwen2.5-VL 提供了一个性能强劲、尺寸灵活、完全开源(Apache 2.0)的理想基座。
## 全文完

## 关联文件说明

- `03-Qwen2.5-VL-mineru-en.md`：英文抽取底稿，用于校对章节顺序、图表位置与术语
- `05-Qwen2.5-VL-Index.md`：技术入口页，聚焦问题定义、方法拆解与工程边界
- `05-Qwen2.5-VL-Architecture-Overview.md`：补充拆解视觉编码器、MRoPE 与多模态桥接设计
