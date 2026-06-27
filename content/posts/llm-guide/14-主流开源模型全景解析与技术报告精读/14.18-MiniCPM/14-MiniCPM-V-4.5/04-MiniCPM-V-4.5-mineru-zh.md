---
title: "MiniCPM-V-4.5 技术报告逐段翻译"
---

# MiniCPM-V-4.5 技术报告逐段翻译

> 原文标题: MiniCPM-V 4.5: Cooking Efficient MLLMs via Architecture, Data, and Training Recipes
> 原文链接: https://arxiv.org/abs/2509.18154
> 翻译基于: PyMuPDF 提取的原文

---

## Abstract

**原文**:
Multimodal Large Language Models (MLLMs) are undergoing rapid progress and represent the frontier of AI development. However, their training and inference efficiency have emerged as a core bottleneck in making MLLMs more accessible and scalable. To address the challenges, we present MiniCPM-V 4.5, an 8B parameter model designed for high efficiency and strong performance. We introduce three core improvements in model architecture, data strategy and training method: a unified 3D-Resampler model architecture for highly compact encoding over images and videos, a unified learning paradigm for document knowledge and text recognition without heavy data engineering, and a hybrid reinforcement learning strategy for proficiency in both short and long reasoning modes. Comprehensive experimental results in OpenCompass evaluation show that MiniCPM-V 4.5 surpasses widely used proprietary models such as GPT-4o-latest, and significantly larger open-source models such as Qwen2.5-VL 72B. Notably, the strong performance is achieved with remarkable efficiency. For example, on the widely adopted VideoMME benchmark, MiniCPM-V 4.5 achieves state-of-the-art performance among models under 30B size, using just 46.7% GPU memory cost and 8.7% inference time of Qwen2.5-VL 7B.

**译文**:
多模态大语言模型正在快速发展,代表了人工智能的前沿方向。然而,训练和推理效率已成为制约 MLLM 普及和扩展的核心瓶颈。为此,我们提出 MiniCPM-V 4.5——一个拥有 8B 参数的高效率、高性能模型。我们在模型架构、数据策略和训练方法三个维度引入了核心改进: 统一 3D-Resampler 模型架构,对图像和视频进行高度紧凑的编码; 统一学习范式,无需繁重数据工程即可实现文档知识和文本识别学习; 混合强化学习策略,使模型同时精通短推理和长推理模式。OpenCompass 综合评测表明,MiniCPM-V 4.5 超越了 GPT-4o-latest 等广泛使用的商用闭源模型,以及 Qwen2.5-VL 72B 等规模显著更大的开源模型。值得注意的是,这一强劲性能是在卓越的效率下实现的: 在广泛采用的 VideoMME 基准上,MiniCPM-V 4.5 在 30B 以下模型中达到 SOTA,但仅使用 Qwen2.5-VL 7B 46.7% 的 GPU 内存和 8.7% 的推理时间。

> 译者注: 摘要中的对比对象选择很有意思。面壁智能没有与同等规模(8B 左右)的模型对比,而是直接与 GPT-4o-latest(闭源、规模未知但估计数百 B)和 Qwen2.5-VL 72B(开源、72B)对比。这种「越级对比」策略在营销上有效,但技术解读时需要注意: 不同评测框架、不同推理配置下的分数并不完全可比。特别是「8.7% 推理时间」这个数据,是在 VideoMME(视频理解)任务上测得的,在图像任务上的加速比可能不同。

---

## 1 Introduction

**原文**:
Multimodal Large Language Models (MLLMs) are advancing rapidly the frontier of artificial intelligence, enabling machines to deeply understand and reason over different modalities such as text and images. However, as MLLMs evolve, the cost of data engineering, training, and inference also increases heavily. Addressing this efficiency challenge is now a central focus of both research and industry, essential for making capable MLLMs more accessible and scalable.

**译文**:
多模态大语言模型正在快速推进人工智能的前沿,使机器能够深入理解和推理文本、图像等不同模态的信息。然而,随着 MLLM 的演进,数据工程、训练和推理的成本也大幅增加。解决这一效率挑战已成为研究和产业界的中心焦点,对于让有能力的 MLLM 更易获取和可扩展至关重要。

**原文**:
We decompose this efficiency problem into three core aspects: (1) Model Architecture. A primary efficiency bottleneck in MLLMs comes from the large number of visual tokens for high-resolution image encoding, which brings heavy computation overhead for visual encoders and LLMs. The problem is even exacerbated in video understanding, where existing models can take thousands of tokens to encode a short and low-resolution video, even when sampling at a low frame rate. For example, processing a 6-second, 2-fps video at a resolution of just 448x448 requires 1,536 tokens for Qwen2.5-VL, and 3,072 tokens for InternVL3. Such long visual token sequences lead to prohibitive training and inference costs in GPU memory and computation speed.

**译文**:
我们将这一效率问题分解为三个核心维度: (1) 模型架构。MLLM 的一个主要效率瓶颈来自高分辨率图像编码产生的大量视觉 token,这给视觉编码器和 LLM 带来了沉重的计算开销。在视频理解中,这一问题更加严重——现有模型即使以低帧率采样,也需要数千个 token 来编码一段短且低分辨率的视频。例如,处理一段 6 秒、2-fps、分辨率为 448x448 的视频,Qwen2.5-VL 需要 1,536 个 token,InternVL3 需要 3,072 个 token。如此长的视觉 token 序列导致 GPU 内存和计算速度方面的训练和推理成本高得令人望而却步。

> 译者注: 论文用具体的数字(1,536 vs 3,072 token)量化了视频理解的效率问题。这里有一个细节值得注意: Qwen2.5-VL 和 InternVL3 的差异来自不同的视觉压缩策略。Qwen2.5-VL 使用 MLP + Pixel Unshuffle,InternVL3 也使用类似的策略但可能有不同的配置。两者都没有利用时序冗余性——每一帧都是独立编码的。这是 MiniCPM-V 4.5 3D-Resampler 的机会所在: 通过跨帧联合压缩,将 12 帧(6 秒 x 2 fps)的冗余视觉信息去除。

**原文**:
(2) Training Data. As we quickly run out of new knowledge from traditional web page data, a new cornerstone of modern MLLMs is harnessing high-quality multimodal knowledge from documents, such as scientific papers and textbooks. These documents are often stored as PDFs, containing multi-disciplinary knowledge in various domains and organized in diverse layouts of interleaved texts, images, and tables. However, most methods depend on brittle external parsing tools to convert document files into interleaved image-text sequences for training. These tools often fail in complex layouts, leading to either errors in knowledge learning or heavy data engineering efforts to fix the failure cases.

**译文**:
(2) 训练数据。随着传统网页数据中的新知识迅速耗尽,现代 MLLM 的一个新基石是从文档中挖掘高质量多模态知识,如科学论文和教科书。这些文档通常以 PDF 格式存储,包含多学科知识,并以文本、图像、表格交织的多样化布局组织。然而,大多数方法依赖脆弱的外部解析工具将文档文件转换为交织的图像-文本序列用于训练。这些工具在复杂布局中经常失败,导致知识学习出现错误,或需要繁重的数据工程工作来修复失败案例。

> 译者注: 「外部解析器」指的是 PyMuPDF、pdfplumber、OCR 引擎等工具。这些工具确实在复杂布局中表现不佳——例如,跨栏文本的阅读顺序、表格单元格的边界识别、图文混排时的关联关系等,都是传统解析器的弱点。MiniCPM-V 4.5 的「直接图像输入」方案虽然避免了解析错误,但代价是模型需要学习「读图」而不是「读文本」。这实际上把负担从「数据预处理 pipeline」转移到了「模型训练」上。

**原文**:
(3) Training Methods. Reinforcement Learning (RL) has shown promise in improving complex reasoning capabilities by enabling a step-by-step explicit thinking process before providing the final answer. However, this performance gain often comes at the expense of extreme verbosity. Even for simple tasks such as identifying obvious objects, most existing thinking models produce excessively long outputs, inducing poor efficiency in both training and inference. For example, on the comprehensive Opencompass benchmark, the hybrid strategy requires only 33.3% long reasoning samples to match the peak long reasoning performance of training exclusively in single mode.

**译文**:
(3) 训练方法。强化学习在提升复杂推理能力方面显示出前景,通过在给出最终答案前实现逐步显式思考过程。然而,这种性能提升往往以极端冗长为代价。即使对于识别明显物体这样的简单任务,大多数现有思考模型也会产生过长的输出,导致训练和推理效率低下。例如,在综合 OpenCompass 基准上,混合策略仅需 33.3% 的长推理样本即可匹配纯单模式长推理训练的峰值性能。

---

## 2 Approach

### 2.1 Architecture

**原文**:
As shown in Figure 1, the architecture of MiniCPM-V 4.5 comprises three main modules: (1) A lightweight visual encoder that flexibly handles high-resolution images with a special partitioning strategy. (2) A unified 3D-Resampler that encodes images and videos into compact features, exploiting temporal redundancies in visual information. (3) An LLM decoder that understands images, videos, and text, and generates text outputs.

**译文**:
如图 1 所示,MiniCPM-V 4.5 的架构包含三个主要模块: (1) 轻量级视觉编码器,通过特殊的分区策略灵活处理高分辨率图像; (2) 统一 3D-Resampler,将图像和视频编码为紧凑特征,利用视觉信息中的时序冗余; (3) LLM 解码器,理解图像、视频和文本,并生成文本输出。

#### 2.1.1 The Unified 3D-Resampler

**原文**:
To tackle the image and video encoding efficiency bottleneck in MLLMs, we extend the 2D-Resampler to a 3D-Resampler that jointly compresses spatial-temporal information for videos. In this way, we achieve a 6x temporal compression rate by leveraging the temporal redundancy of consecutive multiple video frames.

**译文**:
为了解决 MLLM 中图像和视频编码的效率瓶颈,我们将 2D-Resampler 扩展到 3D-Resampler,联合压缩视频的时空信息。通过利用连续多帧视频的时序冗余,我们实现了 6x 时序压缩率。

**原文**:
Image Processing. To handle high-resolution images in any aspect ratio, we adopt the LLaVA-UHD image partitioning strategy. For each image, we estimate the ideal number of slices from the input resolution and choose the partition whose per-slice resolution deviates least from the visual encoder pretraining setting. We then use learnable queries augmented with 2D spatial positional embeddings to produce a fixed-length sequence for each slice through cross-attention.

**译文**:
图像处理。为了处理任意宽高比的高分辨率图像,我们采用 LLaVA-UHD 图像分区策略。对于每张图像,我们根据输入分辨率估算最优切片数量,并选择每片分辨率与视觉编码器预训练设置偏差最小的分区方案。然后我们使用带有 2D 空间位置嵌入的可学习查询,通过交叉注意力为每片生成固定长度的序列。

> 译者注: LLaVA-UHD 策略的一个关键细节是「切片分辨率对齐」。视觉编码器(如 SigLip)在预训练时通常使用固定的输入分辨率(如 224x224 或 448x448)。如果切片分辨率与预训练设置偏差过大,编码质量会下降。LLaVA-UHD 通过选择「最接近预训练分辨率」的切片分区,最小化了分辨率不匹配带来的特征分布偏移。这是一个工程细节,但对最终性能有实质影响。

**原文**:
Most existing MLLMs adopt MLP and pixel unshuffle operation for visual compression, and typically require visual 256 tokens for encoding a 448x448 image. Leveraging the flexibility of resampler architecture, by choosing a small number of query tokens, MiniCPM-V can achieve a significantly higher compression rate for visual tokens (e.g., 64 tokens for a 448x448 image) while maintaining good performance.

**译文**:
现有的大多数 MLLM 采用 MLP 和像素反洗牌操作进行视觉压缩,通常编码一张 448x448 的图像需要 256 个 token。借助 Resampler 架构的灵活性,通过选择少量查询 token,MiniCPM-V 可以实现显著更高的视觉 token 压缩率(例如,一张 448x448 的图像仅需 64 个 token),同时保持良好性能。

**原文**:
Video Processing. To handle the significant redundancy in video data, we employ a joint spatial-temporal compression strategy for higher compression rates. For each video, we first split it into packages along the temporal dimension, where each package contains adjacent frames. Intuitively, the video frames within the same package typically share highly redundant visual information, which can be identified and compressed when jointly modeled. To this end, we resample the frame features from the visual encoder in each package into a fixed-length feature sequence through cross-attention. We augment the learnable queries with both 2D spatial positional embedding, as used in image encoding, and temporal positional embedding. The final video representation is obtained by concatenating the token sequences from all packages.

**译文**:
视频处理。为了处理视频数据中的大量冗余,我们对每包视频帧采用联合时空压缩策略,以获得更高的压缩率。对于每个视频,我们首先沿时间维度将其分割为包,每个包包含相邻帧。直观上,同一包内的视频帧通常共享高度冗余的视觉信息,可以在联合建模时被识别和压缩。为此,我们通过交叉注意力将每个包中视觉编码器的帧特征重采样为固定长度的特征序列。我们用 2D 空间位置嵌入(与图像编码相同)和时间位置嵌入来增强可学习查询。最终的视频表示通过拼接所有包的 token 序列获得。

**原文**:
We sample at most 1,080 frames per video at a maximum frame rate of 10 FPS. During training, the package size and frame rate are randomly augmented to improve robustness. This design also provides flexibility at inference time, allowing these hyperparameters to be adjusted to meet the demands of diverse scenarios and devices.

**译文**:
我们每视频最多采样 1,080 帧,最大帧率为 10 FPS。训练时随机增强包大小和帧率以提高鲁棒性。这种设计在推理时也提供了灵活性,允许调整这些超参数以满足不同场景和设备的需求。

---

### 2.2 Pre-training

#### 2.2.1 Unified Paradigm for Document Knowledge and OCR Learning

**原文**:
We propose a learning paradigm that enables the model to accurately acquire knowledge directly from document images, eliminating the need for fragile external parsers. By dynamically corrupting text regions in documents with varying noise levels and asking the model to reconstruct the text, the model learns to adaptively and properly switch between accurate text recognition (when text is roughly visible) and multimodal context-based knowledge reasoning (when text is heavily corrupted).

**译文**:
我们提出了一种学习范式,使模型能够直接从文档图像中准确获取知识,消除了对脆弱外部解析器的需求。通过在文档中以不同噪声水平动态损坏文本区域,并要求模型重建文本,模型学会自适应地在准确文本识别(当文本大致可见时)和基于多模态上下文的知识推理(当文本被严重损坏时)之间切换。

> 译者注: 动态损坏策略的一个关键设计选择是「损坏级别的分布」。如果低损坏样本过多,模型会过度依赖 OCR 而忽视视觉推理; 如果高损坏样本过多,模型在真实 OCR 场景中的表现可能下降。论文未公开具体的损坏级别分布比例,但从消融实验的结果(+4.2 分在 OmniDocBench 上)推断,分布可能是均衡的或略微偏向中等损坏。

---

### 2.4 Reinforcement Learning

#### 2.4.3 Hybrid Reinforcement Learning

**原文**:
Unlike prior models that optimize for a single long reasoning mode, we develop a hybrid RL post-training strategy to support both short reasoning mode for efficient usage and long reasoning mode for complex tasks. In RL training, we randomly alternate between the two modes during the rollout process for joint optimization. This approach not only enables flexible control over the short and long reasoning modes but also allows for mutual performance enhancement. In experiments, we can achieve better reasoning performance with fewer training samples for both modes.

**译文**:
与先前仅针对单一长推理模式优化的模型不同,我们开发了混合 RL 后训练策略,同时支持短推理模式(高效使用)和长推理模式(复杂任务)。在 RL 训练中,我们在 rollout 过程中随机交替使用两种模式进行联合优化。这种方法不仅实现了对短、长推理模式的灵活控制,还允许两种模式之间的性能相互增强。实验中,我们可以在两种模式下都以更少的训练样本实现更好的推理性能。

---

## 3 Experiments

### 3.2 Main Results

**原文**:
As shown in Table 1, MiniCPM-V 4.5 demonstrates strong performance across a wide range of vision-language capabilities. Comprehensive Capability. MiniCPM-V 4.5 achieves an average score of 77.0 on OpenCompass, a comprehensive evaluation of 8 popular benchmarks. With only 8B parameters, it surpasses widely used proprietary models like GPT-4o-latest and strong open-source models like Qwen2.5-VL 72B for vision-language capabilities.

**译文**:
如表 1 所示,MiniCPM-V 4.5 在广泛的视觉-语言能力上展现出强劲性能。综合能力方面,MiniCPM-V 4.5 在 OpenCompass(覆盖 8 个主流基准的综合评测)上取得 77.0 的平均分。在仅 8B 参数的条件下,它超越了广泛使用的商用闭源模型如 GPT-4o-latest,以及强大的开源模型如 Qwen2.5-VL 72B 的视觉-语言能力。

> 译者注: 表 1 中的对比需要关注「推理配置」这一隐性变量。不同模型在评测时可能使用不同的图像分辨率、不同的视频采样帧率、不同的 prompt 模板。这些配置差异可能导致分数波动。例如,MiniCPM-V 4.5 如果使用更高的图像分辨率,分数可能会进一步提升,但推理时间也会增加。官方技术报告通常会在附录中说明评测配置,但读者在横向对比时往往忽略这些细节。

### 3.3 Inference Efficiency

**原文**:
We evaluated the inference efficiency of MiniCPM-V 4.5 in a standard configuration of 8 A100 GPUs on both image understanding and video understanding tasks. As detailed in Table 2, our model achieves competitive or superior performance while significantly reducing inference time and GPU memory consumption compared to other leading models. On OpenCompass, MiniCPM-V 4.5 not only achieves the highest average score among models under 30B, but also finishes the evaluation using 42.9% of the time of GLM-4.1V.

**译文**:
我们在标准配置的 8 块 A100 GPU 上评估了 MiniCPM-V 4.5 在图像理解和视频理解任务上的推理效率。如表 2 详细所示,与其他领先模型相比,我们的模型在实现相当或更优性能的同时,显著减少了推理时间和 GPU 内存消耗。在 OpenCompass 上,MiniCPM-V 4.5 不仅在 30B 以下模型中取得最高平均分,而且仅使用 GLM-4.1V 42.9% 的时间就完成了评测。

**原文**:
This efficiency is enabled by the model's flexible short and long reasoning modes. On VideoMME, the model demonstrates remarkable efficiency gains. With a strong performance of 73.6, it also reduces the inference time by nearly 10x (from 2.63h to 0.26h) and uses the least memory of 28G. This improvement is primarily due to the efficient 3D-Resampler, which compresses videos jointly considering spatial and temporal dimensions.

**译文**:
这种效率由模型灵活的短推理和长推理模式实现。在 VideoMME 上,模型展现出显著的效率提升。在取得 73.6 的强劲性能的同时,它将推理时间减少了近 10 倍(从 2.63 小时降至 0.26 小时),并使用了最少的 28G 内存。这一提升主要归功于高效的 3D-Resampler,它联合考虑了空间和时间维度来压缩视频。

---

## 4 Conclusion

**原文**:
In this work, we present MiniCPM-V 4.5, an efficient and strong MLLM that achieves state-of-the-art performance among models under 30B parameters. Through three key improvements — a unified 3D-Resampler for compact visual encoding, a unified learning paradigm for document knowledge acquisition, and a hybrid RL strategy for controllable reasoning — MiniCPM-V 4.5 demonstrates that strong multimodal capabilities can be achieved with remarkable efficiency. We hope our work can inspire future research on efficient MLLMs and contribute to the broader accessibility of capable AI systems.

**译文**:
在本工作中,我们提出 MiniCPM-V 4.5——一个高效且强大的 MLLM,在 30B 以下参数模型中达到 SOTA。通过三个关键改进——用于紧凑视觉编码的统一 3D-Resampler、用于文档知识获取的统一学习范式、用于可控推理的混合 RL 策略——MiniCPM-V 4.5 证明,强大的多模态能力可以在卓越的效率下实现。我们希望我们的工作能够启发未来的高效 MLLM 研究,并促进有能力的 AI 系统的更广泛普及。

> 译者注: 结论中的「30B 以下 SOTA」是一个精确的限定词。这意味着论文作者也承认,在更大规模的模型(如 72B 的 Qwen2.5-VL)上,MiniCPM-V 4.5 可能无法全面超越。但在端侧部署场景中,30B 已经是一个过大的规模——即使是最新的 iPhone 也无法本地运行 30B 模型。因此 MiniCPM-V 4.5 的真正竞争对手不是 72B 模型,而是同规模(7-10B)的其他模型。在这个细分市场中,77.0 的 OpenCompass 分数确实具有竞争力。
