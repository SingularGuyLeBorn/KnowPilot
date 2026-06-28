---
title: "Qwen2-VL 技术报告 (MinerU 逐译 + 译者注)"
translated_from: 03-Qwen2-VL-mineru-en.md
model: Qwen2-VL
scope: D4 (逐译 + 译者注)
---


> 原文：Qwen2-VL: Enhancing Vision-Language Model's Perception of the World at Any Resolution
> 作者：Peng Wang, Shuai Bai, Sinan Tan, Shijie Wang, Zhihao Fan, Jinze Bai 等 (Qwen Team, Alibaba Group)
> 来源：arXiv:2409.12191v2, 2024-10-03
> 本文件基于 PyMuPDF fallback 提取的 D3 英文原文逐段翻译，并在关键技术节点插入译者注.

---

Qwen2-VL: Enhancing Vision-Language Model's Perception of the World at Any Resolution

> Qwen2-VL: 增强视觉语言模型对任意分辨率世界的感知

Peng Wang*, Shuai Bai*, Sinan Tan*, Shijie Wang*, Zhihao Fan*, Jinze Bai*†, Keqin Chen, Xuejing Liu, Jialin Wang, Wenbin Ge, Yang Fan, Kai Dang, Mengfei Du, Xuancheng Ren, Rui Men, Dayiheng Liu, Chang Zhou, Jingren Zhou, Junyang Lin†
Qwen Team, Alibaba Group

Abstract

We present the Qwen2-VL Series, an advanced upgrade of the previous Qwen-VL models that redefines the conventional predetermined-resolution approach in visual processing. Qwen2-VL introduces the Naive Dynamic Resolution mechanism, which enables the model to dynamically process images of varying resolutions into different numbers of visual tokens. This approach allows the model to generate more efficient and accurate visual representations, closely aligning with human perceptual processes. The model also integrates Multimodal Rotary Position Embedding (M-RoPE), facilitating the effective fusion of positional information across text, images, and videos. We employ a unified paradigm for processing both images and videos, enhancing the model's visual perception capabilities. To explore the potential of large multimodal models, Qwen2-VL investigates the scaling laws for large vision-language models (LVLMs). By scaling both the model size-with versions at 2B, 8B, and 72B parameters-and the amount of training data, the Qwen2-VL Series achieves highly competitive performance. Notably, the Qwen2-VL-72B model achieves results comparable to leading models such as GPT-4o and Claude3.5-Sonnet across various multimodal benchmarks, outperforming other generalist models. Code is available at https://github.com/QwenLM/Qwen2-VL.

> **摘要**
>
> 我们介绍 Qwen2-VL 系列，这是先前 Qwen-VL 模型的高级升级版本，重新定义了视觉处理中传统的预设分辨率方法. Qwen2-VL 引入了朴素动态分辨率(Naive Dynamic Resolution)机制，使模型能够将不同分辨率的图像动态处理为不同数量的视觉 token. 这种方法使模型能够生成更高效、更准确的视觉表示，与人类感知过程高度一致. 该模型还集成了多模态旋转位置嵌入(M-RoPE)，促进文本、图像和视频之间位置信息的有效融合. 我们采用统一的范式处理图像和视频，增强模型的视觉感知能力. 为了探索大型多模态模型的潜力，Qwen2-VL 研究了大型视觉语言模型(LVLMs)的缩放定律. 通过扩展模型规模(2B, 8B 和 72B 参数版本)和训练数据量，Qwen2-VL 系列取得了极具竞争力的性能. 值得注意的是，Qwen2-VL-72B 模型在各种多模态基准测试中取得了与 GPT-4o 和 Claude3.5-Sonnet 等领先模型相当的结果，超越了其他通用模型. 代码可在上述 GitHub 链接获取.

## 1 Introduction

>  **[返回 14.2-Qwen 家族总览](../../14.2-Qwen.md)**


In the realm of artificial intelligence, Large Vision-Language Models (LVLMs) represent a significant leap forward, building upon the strong textual processing capabilities of traditional large language models. These advanced models now encompass the ability to interpret and analyze a broader spectrum of data, including images, audio, and video. This expansion of capabilities has transformed LVLMs into indispensable tools for tackling a variety of real-world challenges. Recognized for their unique capacity to condense extensive and intricate knowledge into functional representations, LVLMs are paving the way for more comprehensive cognitive systems. By integrating diverse data forms, LVLMs aim to more closely mimic the nuanced ways in which humans perceive and interact with their environment. This allows these models to provide a more accurate representation of how we engage with and perceive our environment.

> **1 引言**
>
> 在人工智能领域，大型视觉语言模型(LVLMs)代表了一次重大飞跃，建立在传统大语言模型强大的文本处理能力之上. 这些先进的模型现在具备解释和分析更广泛数据谱系的能力，包括图像、音频和视频. 这种能力的扩展使 LVLMs 成为解决各种现实世界挑战的不可或缺的工具. LVLMs 因其将广泛而复杂的知识浓缩为功能性表示的独特能力而备受认可，正在为更全面的认知系统铺平道路. 通过整合多样化的数据形式，LVLMs 旨在更紧密地模仿人类感知和与环境交互的微妙方式. 这使这些模型能够更准确地表示我们与环境互动和感知的方式.

Recent advancements in large vision-language models (LVLMs) (Li et al., 2023c; Liu et al., 2023b; Dai et al., 2023; Zhu et al., 2023; Huang et al., 2023a; Bai et al., 2023b; Liu et al., 2023a; Wang et al., 2023b; OpenAI., 2023; Team et al., 2023) have led to significant improvements in a short span. These models (OpenAI, 2023; Touvron et al., 2023a,b; Chiang et al., 2023; Bai et al., 2023a) generally follow a common approach of visual encoder→cross-modal connector→LLM. This setup, combined with next-token prediction as the primary training method and the availability of high-quality datasets (Liu et al., 2023a; Zhang et al., 2023; Chen et al., 2023b; Li et al., 2023b), has driven much of the progress. Additional factors like larger model architectures (Alayrac et al., 2022), higher-resolution images (Li et al., 2023a,d), and advanced techniques such as mixture-of-expert models (MoE) (Wang et al., 2023b; Ye et al., 2023b), model ensembles (Lin et al., 2023), and more sophisticated connectors (Ye et al., 2023a) between visual and textual modalities have also played a key role in enhancing LVLMs' ability to process complex visual and textual information more effectively.

> 近期大型视觉语言模型(LVLMs)的进步(Li et al., 2023c; Liu et al., 2023b 等)在短时间内带来了显著提升. 这些模型(OpenAI, 2023; Touvron et al., 2023a,b 等)通常遵循视觉编码器→跨模态连接器→LLM 的共同架构. 这种设置，结合以 next-token prediction 为主要训练方法以及高质量数据集的可用性(Liu et al., 2023a; Zhang et al., 2023 等)，推动了大部分进展. 更大的模型架构(Alayrac et al., 2022)、更高分辨率的图像(Li et al., 2023a,d)、以及混合专家模型(MoE)(Wang et al., 2023b; Ye et al., 2023b)、模型集成(Lin et al., 2023)和视觉与文本模态之间更复杂的连接器(Ye et al., 2023a)等先进技术，也在增强 LVLMs 更有效处理复杂视觉和文本信息的能力方面发挥了关键作用.

> **译者注: LVLM 架构的技术谱系**
>
> Qwen2-VL 所处的技术谱系值得梳理. 早期多模态模型(如 Flamingo, BLIP-2)采用「冻结视觉编码器 + 轻量连接器 + 冻结 LLM」的策略，优点是训练成本低，但视觉表示质量受限于预训练编码器. 2023 年后，LLaVA、Qwen-VL 等模型开始端到端微调，解锁了更强的对齐能力. Qwen2-VL 的架构选择是「ViT + MLP 压缩 + Qwen2 LLM」，与 Qwen-VL 相比最大的简化是**去掉了 cross-modal connector**(Qwen-VL 使用可学习的 query 向量通过 cross-attention 压缩视觉特征). 这一简化基于一个工程洞察：随着 LLM 规模扩大，其本身具备足够的能力直接从扁平化的视觉 token 序列中学习跨模态映射，不需要专门的连接器模块. 这降低了架构复杂度，也减少了训练不稳定性的来源.

However, current large vision-language models (LVLMs) are typically constrained by a fixed image input size. Standard LVLMs encode input images to a fixed resolution (e.g., 224×224), often by either downsampling or upsampling the images (Zhu et al., 2023; Huang et al., 2023a), or by employing a scale-then-padding approach (Liu et al., 2023b,a). While this one-size-fits-all strategy enables processing of images at consistent resolutions, it also limits the model's ability to capture information at different scales, particularly leading to a significant loss of detailed information in high-resolution images. Consequently, such models fall short of perceiving visual information with the same sensitivity to scale and detail as human vision.

> 然而，当前的大型视觉语言模型(LVLMs)通常受限于固定的图像输入尺寸. 标准 LVLMs 将输入图像编码为固定分辨率(例如 224×224)，通常通过对图像进行下采样或上采样(Zhu et al., 2023; Huang et al., 2023a)，或采用先缩放后填充的方法(Liu et al., 2023b,a). 虽然这种一刀切策略使得图像能够以一致的分辨率进行处理，但它也限制了模型在不同尺度上捕捉信息的能力，尤其导致高分辨率图像中详细信息的显著丢失. 因此，这类模型无法像人类视觉那样对尺度和细节具有同等的敏感度.

Additionally, most LVLMs rely on a static, frozen CLIP-style (Radford et al., 2021) vision encoder, raising concerns about whether the visual representations produced by such pre-trained models are adequate, particularly for complex reasoning tasks and processing intricate details within images. Recent works (Bai et al., 2023b; Ye et al., 2023a) have attempted to address these limitations by fine-tuning the vision transformer (ViT) during the LVLM training process, which has shown to yield improved results. To further enhance the model's adaptability to varying resolutions, we introduce dynamic resolution training in the LVLM training process. Specifically, we employ a 2D Rotary Position Embedding (RoPE) in the ViT, thus allowing the model to better capture information across different spatial scales.

> 此外，大多数 LVLMs 依赖于静态、冻结的 CLIP 风格(Radford et al., 2021)视觉编码器，这引发了对这种预训练模型产生的视觉表示是否充分的担忧，尤其对于复杂推理任务和处理图像中复杂细节而言. 近期工作(Bai et al., 2023b; Ye et al., 2023a)尝试通过在 LVLM 训练过程中微调视觉 Transformer(ViT)来解决这些限制，已显示出改进效果. 为了进一步增强模型对不同分辨率的适应性，我们在 LVLM 训练过程中引入了动态分辨率训练. 具体而言，我们在 ViT 中采用二维旋转位置嵌入(2D-RoPE)，从而使模型能够更好地捕捉不同空间尺度上的信息.

When it comes to video内容，which is essentially a sequence of frames, many existing models continue to treat it as an independent modality. However, understanding the dynamic nature of reality, as manifested in videos, is crucial for models aiming to grasp the complexities of the real world. Unlike text, which is inherently one-dimensional, the real-world environment exists in three dimensions. The use of one-dimensional position embeddings in current models significantly limits their ability to model three-dimensional space and temporal dynamics effectively. To bridge this gap, we have developed Multimodal Rotary Position Embedding (M-RoPE), which employs separate components to represent temporal and spatial information. This enables the model to naturally comprehend dynamic content, such as videos or streaming data, improving its ability to understand and interact with the world.

> 当涉及到视频内容时——视频本质上是帧序列——许多现有模型继续将其视为独立模态. 然而，理解视频中体现的现实动态性，对于旨在把握现实世界复杂性的模型至关重要. 与本质上是一维的文本不同，现实环境存在于三维空间中. 当前模型中使用的一维位置嵌入显著限制了其有效建模三维空间和时间动态的能力. 为弥合这一差距，我们开发了多模态旋转位置嵌入(M-RoPE)，它使用独立的组件来表示时间和空间信息. 这使模型能够自然地理解动态内容，如视频或流数据，提高其理解和与世界交互的能力.

Furthermore, compared to the scaling of large language models (LLMs), current LVLMs are still in the early stages of exploring the impact of scaling in terms of training data and model parameters. The exploration of scaling laws for LVLMs-how increases in model and data size affect performance-remains an open and promising area of research.

> 此外，与大语言模型(LLMs)的缩放相比，当前的 LVLMs 仍处于探索训练数据和模型参数缩放影响的早期阶段. LVLMs 缩放定律的探索——模型和数据规模的增加如何影响性能——仍然是一个开放且充满前景的研究领域.

In this work, we introduce the newest addition to the large vision-language models of the Qwen family: Qwen2-VL series, which comprises three open-weight models with total parameter counts of 2 billion, 8 billion, and 72 billion. As shown in Figure 1, the key advances in Qwen2-VL include:
• State-of-the-art understanding across various resolutions and aspect ratios: Qwen2-VL achieves leading performance on visual benchmarks, including DocVQA, InfoVQA, RealWorldQA, MTVQA, MathVista, and others.
• Comprehension of extended-duration videos (20 min+): Qwen2-VL is capable of understanding videos over 20 minutes in length, enhancing its ability to perform high-quality video-based question answering, dialogue, content creation, and more.
• Robust agent capabilities for device operation: With advanced reasoning and decision-making abilities, Qwen2-VL can be integrated with devices such as mobile phones, robots, etc., enabling autonomous operation based on visual inputs and text instructions.
• Multilingual support: To serve a global audience, beyond English and Chinese, Qwen2-VL now supports multilingual context understanding within images, including most European languages, Japanese, Korean, Arabic, Vietnamese, and others.

> 本文中，我们介绍了 Qwen 家族大型视觉语言模型的最新成员：Qwen2-VL 系列，包含三个开源权重模型，总参数分别为 20 亿、80 亿和 720 亿. 如图 1 所示，Qwen2-VL 的关键进步包括：
> • **各种分辨率和宽高比下的 state-of-the-art 理解能力**：Qwen2-VL 在视觉基准测试上取得领先性能，包括 DocVQA、InfoVQA、RealWorldQA、MTVQA、MathVista 等.
> • **理解长时长视频(20 分钟以上)**：Qwen2-VL 能够理解超过 20 分钟的视频，增强其执行高质量基于视频的问答、对话、内容创作等能力.
> • **强大的设备操作 Agent 能力**：凭借先进的推理和决策能力，Qwen2-VL 可以与手机、机器人等设备集成，基于视觉输入和文本指令实现自主操作.
> • **多语言支持**：为了服务全球用户，除中英文外，Qwen2-VL 现在支持图像中的多语言上下文理解，包括大多数欧洲语言、日语、韩语、阿拉伯语、越南语等.

---

Figure 1: Qwen2-VL capabilities: Multilingual image text understanding, code/math reasoning, video analysis, live chat, agent potential, and more. See Appendix for details.

> 图 1: Qwen2-VL 能力概览：多语言图像文本理解、代码/数学推理、视频分析、实时对话、Agent 潜力等. 详见附录.

---

Table 1: Model descriptions of Qwen2-VL.

| Model Name | Vision Encoder | LLM | Model Description |
|------------|---------------|-----|-------------------|
| Qwen2-VL-2B | 675M | 1.5B | The most efficient model, designed to run on-device. It delivers adequate performance for most scenarios with limited resources. |
| Qwen2-VL-7B | 675M | 7.6B | The performance-optimized model in terms of cost, significantly upgraded for text recognition and video understanding capabilities. It delivers significant performance across a broad range of visual tasks. |
| Qwen2-VL-72B | 675M | 72B | The most capable model, further improvements in visual reasoning, instruction-following, decision-making, and agent capabilities. It delivers optimal performance on most complex tasks. |

> **Table 1: Qwen2-VL 模型描述**
>
> | 模型名称 | 视觉编码器 | 语言模型 | 模型描述 |
> |----------|-----------|---------|---------|
> | Qwen2-VL-2B | 675M | 1.5B | 最高效的模型，设计用于端侧运行. 在资源受限的情况下为大多数场景提供足够的性能. |
> | Qwen2-VL-7B | 675M | 7.6B | 在成本方面性能优化的模型，文本识别和视频理解能力显著提升. 在广泛的视觉任务中表现出色. |
> | Qwen2-VL-72B | 675M | 72B | 能力最强的模型，在视觉推理、指令遵循、决策和 Agent 能力方面进一步改进. 在大多数复杂任务上提供最优性能. |

## 2 Approach

The Qwen2-VL series consists of models of 3 sizes, which are Qwen2-VL-2B, Qwen2-VL-7B and Qwen2-VL-72B. Table 1 lists the hyper-parameters and important information. Notably, Qwen2-VL employs a 675M parameter ViT across various-sized LLMs, ensuring that the computational load of the ViT remains constant regardless of the scale of the LLM.

> **2 方法**
>
> Qwen2-VL 系列包含 3 种尺寸的模型：Qwen2-VL-2B、Qwen2-VL-7B 和 Qwen2-VL-72B. Table 1 列出了超参数和重要信息. 值得注意的是，Qwen2-VL 在各种规模的 LLM 中都采用 675M 参数的 ViT，确保无论 LLM 规模如何，ViT 的计算负载保持不变.

> **译者注: 675M ViT 的固定化设计**
>
> Table 1 揭示了一个关键设计决策：三个模型尺寸(2B/7B/72B)共享**相同**的 675M 参数 ViT. 这与许多竞品(如 LLaVA 系列随模型尺寸 scaling 视觉编码器)形成对比. 固定 ViT 规模的好处是：1) 小模型(2B)不会因为 ViT 过大而被「压垮」——ViT 占 2B 总参数的 25%，但只占 72B 的不到 1%; 2) 视觉预训练只需做一次，三种尺寸的 LLM 可以复用同一套视觉表示; 3) 工程上简化了训练管线. 代价是 72B 模型的视觉编码能力受限于 675M ViT 的容量，无法像更大视觉编码器那样捕捉极度精细的视觉细节. 这是一个「视觉能力统一、语言能力分档」的实用主义设计.

### 2.1 Model Architecture

Figure 2 illustrates the comprehensive structure of Qwen2-VL. We have retained the Qwen-VL (Bai et al., 2023b) framework, which integrates vision encoders and language models. For various scale adaptations, we have implemented a Vision Transformer (ViT) (Dosovitskiy et al., 2021) with approximately 675 million parameters, adept at handling both image and video inputs. In terms of language processing, we have opted for the more powerful Qwen2 (Yang et al., 2024) series of language models. To further enhance the model's ability to effectively perceive and comprehend visual information in videos, we introduced several key upgrades:

> **2.1 模型架构**
>
> 图 2 展示了 Qwen2-VL 的整体结构. 我们保留了 Qwen-VL(Bai et al., 2023b)的框架，该框架集成了视觉编码器和语言模型. 为了适应各种规模，我们实现了一个约 6.75 亿参数的 Vision Transformer(ViT)(Dosovitskiy et al., 2021)，擅长处理图像和视频输入. 在语言处理方面，我们选择了更强大的 Qwen2(Yang et al., 2024)系列语言模型. 为了进一步增强模型有效感知和理解视频中视觉信息的能力，我们引入了以下关键升级：

---

Figure 2: Qwen2-VL is capable of accurately identifying and comprehending the content within images, regardless of their clarity, resolution, or extreme aspect ratios.

> 图 2: Qwen2-VL 能够准确识别和理解图像中的内容，无论其清晰度、分辨率或极端宽高比如何.

Naive Dynamic Resolution

A key architectural improvement in Qwen2-VL is the introduction of naive dynamic resolution support (Dehghani et al., 2024). Unlike Qwen-VL, Qwen2-VL can now process images of any resolution, dynamically converting them into a variable number of visual tokens. To support this feature, we modified ViT by removing the original absolute position embeddings and introducing 2D-RoPE (Su et al., 2024; Su, 2021) to capture the two-dimensional positional information of images. At the inference stage, images of varying resolutions are packed into a single sequence, with the packed length controlled to limit GPU memory usage. Furthermore, to reduce the visual tokens of each image, a simple MLP layer is employed after the ViT to compress adjacent 2 × 2 tokens into a single token, with the special <|vision_start|> and <|vision_end|> tokens placed at the beginning and end of the compressed visual tokens. As a result, an image with a resolution of 224 × 224, encoded with a ViT using patch_size=14, will be compressed to 66 tokens before entering LLM.

> **朴素动态分辨率**
>
> Qwen2-VL 的一个关键架构改进是引入了朴素动态分辨率支持(Dehghani et al., 2024). 与 Qwen-VL 不同，Qwen2-VL 现在可以处理任意分辨率的图像，将其动态转换为可变数量的视觉 token. 为支持这一特性，我们修改了 ViT，移除了原始的绝对位置嵌入，并引入 2D-RoPE(Su et al., 2024; Su, 2021)来捕捉图像的二维位置信息. 在推理阶段，不同分辨率的图像被打包成单个序列，打包长度受到控制以限制 GPU 内存使用. 此外，为了减少每张图像的视觉 token 数量，在 ViT 后使用一个简单的 MLP 层将相邻的 2×2 token 压缩为单个 token，并在压缩后的视觉 token 首尾分别放置特殊的 <|vision_start|> 和 <|vision_end|> token. 因此，一张分辨率为 224×224、使用 patch_size=14 的 ViT 编码的图像，在进入 LLM 前将被压缩为 66 个 token.

> **译者注: 动态分辨率的工程含义**
>
> 「66 个 token」这个数字背后有精确的计算逻辑：224×224 图像 / 14×14 patch = 16×16 = 256 个 patch token; 2×2 压缩后 = 256/4 = 64 个 token; 加上 <|vision_start|> 和 <|vision_end|> 两个特殊 token = 66 个 token. 动态分辨率的核心价值在于**打破了固定分辨率的信息瓶颈**. 传统方法将 4K 图像强行缩放到 224×224，会丢失大量细节; 而 Qwen2-VL 可以原生存放高分辨率图像的更多 patch(虽然受 max_pixels=16384×28×28 限制). 2D-RoPE 替代绝对位置嵌入是关键——绝对位置嵌入要求输入尺寸固定，而 RoPE 的旋转矩阵可以自然地外推到未见过的分辨率. 这种设计直接借鉴了 NaViT(Dehghani et al., 2024)的思想，但在 LVLM 场景下做了工程适配(MLP 压缩 + 特殊 token 边界).

Multimodal Rotary Position Embedding (M-RoPE)

Another key architectural enhancement is the innovation of Multimodal Rotary Position Embedding (M-RoPE). Unlike the traditional 1D-RoPE in LLMs, which is limited to encoding one-dimensional positional information, M-RoPE effectively models the positional information of multimodal inputs. This is achieved by deconstructing the original rotary embedding into three components: temporal, height, and width. For text inputs, these components utilize identical position IDs, making M-RoPE functionally equivalent to 1D-RoPE (Su, 2024). When processing images, the temporal IDs of each visual token remain constant, while distinct IDs are assigned to the height and width components based on the token's position in the image. For videos, which are treated as sequences of frames, the temporal ID increments for each frame, while the height and width components follow the same ID assignment pattern as images. In scenarios where the model's input encompasses multiple modalities, position numbering for each modality is initialized by incrementing the maximum position ID of the preceding modality by one. An illustration of M-RoPE is shown in Figure 3. M-RoPE not only enhances the modeling of positional information but also reduces the value of position IDs for images and videos, enabling the model to extrapolate to longer sequences during inference.

> **多模态旋转位置嵌入(M-RoPE)**
>
> 另一个关键架构增强是多模态旋转位置嵌入(M-RoPE)的创新. 与 LLM 中仅限于编码一维位置信息的传统 1D-RoPE 不同，M-RoPE 有效地建模了多模态输入的位置信息. 这是通过将原始旋转嵌入解构为三个组件来实现的：时间(temporal)、高度(height)和宽度(width). 对于文本输入，这些组件使用相同的位置 ID，使 M-RoPE 在功能上等同于 1D-RoPE(Su, 2024). 在处理图像时，每个视觉 token 的时间 ID 保持不变，而高度和宽度组件则根据 token 在图像中的位置分配不同的 ID. 对于视频——被视为帧序列——时间 ID 随每帧递增，而高度和宽度组件遵循与图像相同的 ID 分配模式. 在模型输入包含多种模态的场景中，每种模态的位置编号通过将前一种模态的最大位置 ID 加一来初始化. M-RoPE 的示意如图 3 所示. M-RoPE 不仅增强了位置信息的建模能力，还降低了图像和视频的位置 ID 取值，使模型在推理阶段能够外推到更长的序列.

---

Figure 3: A demonstration of M-RoPE. By decomposing rotary embedding into temporal, height, and width components, M-RoPE can explicitly model the positional information of text, images, and video in LLM.

> 图 3: M-RoPE 示意. 通过将旋转嵌入分解为时间、高度和宽度组件，M-RoPE 可以在 LLM 中显式建模文本、图像和视频的位置信息.

> **译者注: M-RoPE 的数学直觉**
>
> M-RoPE 的设计体现了对位置编码本质的深刻理解. 标准 1D-RoPE 将位置 $m$ 编码为旋转矩阵 $R_m$，其中每个维度对 $(d, d+1)$ 旋转角度为 $m \cdot \theta_d$. M-RoPE 将其扩展为三维：$R_{(t, h, w)}$，其中 $t$ 是时间/帧索引，$h$ 和 $w$ 是空间坐标. 对于文本，$t=h=w=pos$，退化为 1D-RoPE; 对于图像，$t=const$，$h$ 和 $w$ 分别对应行和列; 对于视频，$t$ 逐帧递增. 这种分解的美妙之处在于：它用**同一套旋转机制**统一处理三种模态，不需要为每种模态设计专门的位置编码器. 从工程角度看，「降低位置 ID 取值」意味着模型可以在不超出训练时最大位置 ID 的情况下处理更长的视觉序列——例如，一张 1024×1024 的图像如果用 1D 扁平化，位置 ID 会达到数万，而 M-RoPE 将空间位置分解后，每个维度的 ID 范围显著缩小，自然支持更长序列的外推.

Unified Image and Video Understanding

Qwen2-VL employs a mixed training regimen incorporating both image and video data, ensuring proficiency in image understanding and video comprehension. To preserve video information as completely as possible, we sampled each video at two frames per second. Additionally, we integrated 3D convolutions (Carreira and Zisserman, 2017) with a depth of two to process video inputs, allowing the model to handle 3D tubes instead of 2D patches, thus enabling it to process more video frames without increasing the sequence length (Arnab et al., 2021). For consistency, each image is treated as two identical frames. To balance the computational demands of long video processing with overall training efficiency, we dynamically adjust the resolution of each video frame, limiting the total number of tokens per video to 16384. This training approach strikes a balance between the model's ability to comprehend long videos and training efficiency.

> **统一的图像和视频理解**
>
> Qwen2-VL 采用混合训练方案，结合图像和视频数据，确保在图像理解和视频理解方面的熟练度. 为了尽可能完整地保留视频信息，我们以每秒两帧的速率对视频进行采样. 此外，我们整合了深度为 2 的 3D 卷积(Carreira and Zisserman, 2017)来处理视频输入，使模型能够处理 3D 管状体而非 2D patch，从而能够在不增加序列长度的情况下处理更多的视频帧(Arnab et al., 2021). 为保持一致性，每张图像被视为两个相同的帧. 为了平衡长视频处理的计算需求与整体训练效率，我们动态调整每个视频帧的分辨率，将每个视频的总 token 数限制为 16384. 这种训练方法在模型理解长视频的能力与训练效率之间取得了平衡.

> **译者注: 图像即「双帧视频」的统一范式**
>
> 「每张图像被视为两个相同的帧」是一个看似奇怪但极其巧妙的设计. 其动机是**统一图像和视频的编码路径**：视频通过 3D 卷积(时序深度=2)处理，如果图像只用 2D patch，就需要为图像和视频维护两条不同的编码路径. 将图像视为「双帧相同视频」后，两者都走 3D 卷积路径，简化了实现. 3D 卷积深度为 2 意味着每两个连续帧的时空邻域被联合编码，这比独立处理每帧再拼接更能捕捉运动信息. 但代价是图像编码也引入了时间维度(虽然是恒定的)，增加了少量计算. 「每秒 2 帧」的采样率对于 20 分钟视频意味着 2400 帧，但通过动态分辨率限制总 token 为 16K，平均每帧约 6-7 个 token——这实际上是对视频帧进行了大幅度的空间下采样.

### 2.2 Training

Following Qwen-VL (Bai et al., 2023b), we adopt a three-stage training methodology. In the first stage, we focus exclusively on training the Vision Transformer (ViT) component, utilizing a vast corpus of image-text pairs to enhance semantic understanding within the Large Language Model (LLM). In the second stage, we unfreeze all parameters and train with a wider range of data for more comprehensive learning. In the final stage, we lock the ViT parameters and perform exclusive fine-tuning of the LLM using instructional datasets.

> **2.2 训练**
>
> 遵循 Qwen-VL(Bai et al., 2023b)，我们采用三阶段训练方法. 第一阶段，我们专注于训练 Vision Transformer(ViT)组件，利用大量图像-文本对语料增强大语言模型(LLM)中的语义理解. 第二阶段，我们解冻所有参数，使用更广泛的数据进行全面学习. 最后阶段，我们锁定 ViT 参数，仅使用指令数据集对 LLM 进行微调.

The model is pre-trained on a diverse dataset that includes image-text pairs, optical character recognition (OCR) data, interleaved image-text articles, visual question answering datasets, video dialogues, and image knowledge datasets. Our data sources primarily comprise cleaned web pages, open-source datasets, and synthetic data. The cutoff date for our data knowledge is June 2023. This diverse data composition is instrumental in developing a robust multimodal understanding capability.

> 模型在多样化的数据集上预训练，包括图像-文本对、光学字符识别(OCR)数据、交错的图像-文本文章、视觉问答数据集、视频对话和图像知识数据集. 我们的数据源主要包括清洗后的网页、开源数据集和合成数据. 数据知识截止日期为 2023 年 6 月. 这种多样化的数据组成对于培养强大的多模态理解能力至关重要.

During the initial pre-training phase, Qwen2-VL is exposed to a corpus of around 600 billion tokens. The LLM component of Qwen2-VL is initialized using the parameters from Qwen2 (Yang et al., 2024), while the vision encoder of Qwen2-VL is initialized with the ViT derived from DFN. However, the fixed position embedding in the original DFN's ViT (Fang et al., 2023) is replaced by RoPE-2D. This pre-training phase primarily focuses on learning image-text relationships, textual content recognition within images through OCR, and image classification tasks. Such foundational training is instrumental in enabling the model to develop a robust understanding of core visual-textual correlations and alignments.

> 在初始预训练阶段，Qwen2-VL 接触了约 6000 亿 token 的语料. Qwen2-VL 的 LLM 组件使用 Qwen2(Yang et al., 2024)的参数初始化，而视觉编码器使用源自 DFN 的 ViT 初始化. 然而，原始 DFN ViT(Fang et al., 2023)中的固定位置嵌入被替换为 RoPE-2D. 这一预训练阶段主要专注于学习图像-文本关系、通过 OCR 识别图像中的文本内容以及图像分类任务. 这种基础训练对于使模型建立对核心视觉-文本关联和对齐的稳健理解至关重要.

The second pre-training phase marks a significant progression, involving an additional 800 billion tokens of image-related data. This stage introduces a higher volume of mixed image-text content, facilitating a more nuanced understanding of the interplay between visual and textual information. The incorporation of visual question answering datasets refines the model's capacity to respond to image-related queries. Moreover, the inclusion of multitasking datasets is pivotal in developing the model's ability to navigate diverse tasks concurrently, a skill of paramount importance when dealing with complex, real-world datasets. Concurrently, purely textual data continues to play a crucial role in maintaining and advancing the model's linguistic proficiency.

> 第二预训练阶段标志着重大进展，涉及额外的 8000 亿 token 图像相关数据. 此阶段引入了更多混合图像-文本内容，促进对视觉和文本信息之间交互的更细致理解. 视觉问答数据集的加入提升了模型回答图像相关查询的能力. 此外，多任务数据集的 inclusion 对于培养模型同时处理多样化任务的能力至关重要——这在处理复杂的真实世界数据集时是一项至关重要的技能. 同时，纯文本数据继续在保持和提升模型语言能力方面发挥关键作用.

Throughout the pre-training stages, Qwen2-VL processes a cumulative total of 1.4 trillion tokens. Specifically, these tokens encompass not only text tokens but also image tokens. During the training process, however, we only provide supervision for the text tokens. This exposure to extensive and diverse linguistic and visual scenarios ensures that the model develops a deep understanding of the intricate relationships between visual and textual information, thereby laying a robust foundation for various multimodal tasks.

> 在整个预训练阶段，Qwen2-VL 累计处理了 1.4 万亿 token. 具体而言，这些 token 不仅包括文本 token，还包括图像 token. 然而，在训练过程中，我们**仅对文本 token 提供监督**. 这种对广泛而多样的语言和视觉场景的 exposure 确保了模型对视觉和文本信息之间复杂关系形成深刻理解，从而为各种多模态任务奠定坚实基础.

> **译者注: 1.4T token 与「仅监督文本 token」的训练策略**
>
> 累计 1.4T token(600B + 800B)的规模在 2024 年的 LVLM 领域属于大型预训练. 但「仅对文本 token 提供监督」是一个关键设计——视觉 token 的预测目标被 masking 掉了. 这意味着模型的训练目标不是重建图像(如 MAE 或 VAE)，而是**以视觉为条件生成文本**. 这与 GPT-4V 的训练哲学一致：视觉编码器将图像「翻译」为 LLM 能理解的 token 序列，然后 LLM 的 next-token prediction 目标自然地学习从这些视觉 token 中提取信息并生成文本回复. 这种「文本唯一监督」简化了训练，但也带来一个潜在问题：视觉编码器没有直接的重建监督，其表示质量完全依赖于文本监督的间接信号. 好在第一阶段 600B 的 ViT 预训练(使用图像-文本对)为视觉编码器提供了足够强的初始化.

During the instruction fine-tuning phase, we employ the ChatML (Openai, 2024) format to construct instruction-following data. This dataset encompasses not only pure text-based dialogue data but also multimodal conversational data. The multimodal components include image question-answering, document parsing, multi-image comparison, video comprehension, video stream dialogue, and agent-based interactions. Our comprehensive approach to data construction aims to enhance the model's capability to understand and execute a wide range of instructions across various modalities. By incorporating diverse data types, we seek to develop a more versatile and robust language model capable of handling complex, multimodal tasks in addition to traditional text-based interactions.

> 在指令微调阶段，我们采用 ChatML(Openai, 2024)格式构建指令遵循数据. 该数据集不仅包括纯文本对话数据，还包括多模态对话数据. 多模态组件包括图像问答、文档解析、多图像比较、视频理解、视频流对话和基于 Agent 的交互. 我们全面的数据构建方法旨在增强模型理解和执行跨各种模态的广泛指令的能力. 通过整合多样化的数据类型，我们力求开发一个更通用、更稳健的语言模型，能够处理复杂的多模态任务以及传统的基于文本的交互.


#### 2.2.1 Data Format

In line with Qwen-VL, Qwen2-VL also employs special tokens to distinguish vision and text inputs. Tokens <|vision_start|> and <|vision_end|> are inserted at the start and end of the image feature sequence to demarcate the image content.

> **2.2.1 数据格式**
>
> 与 Qwen-VL 一致，Qwen2-VL 也使用特殊 token 来区分视觉和文本输入. <|vision_start|> 和 <|vision_end|> token 被插入到图像特征序列的开头和结尾，以标记图像内容.

Dialogue Data

In terms of dialogue format, we construct our instruction tuning dataset using the ChatML format, where each interaction's statement is marked with two special tokens (<|im_start|> and <|im_end|>) to facilitate dialogue termination. The sections marked in blue indicate the supervised parts.

> **对话数据**
>
> 在对话格式方面，我们使用 ChatML 格式构建指令微调数据集，其中每次交互的语句都用两个特殊 token(<|im_start|> 和 <|im_end|>)标记，以促进对话终止. 蓝色标记的部分表示受监督的部分.

The Dataset Format Example of ChatML
<|im_start|>user
<|vision_start|>Picture1.jpg<|vision_end|><|vision_start|>Picture2.jpg<|vision_end|>What do the two pictures have in common?<|im_end|>
<|im_start|>assistant
Both pictures are of SpongeBob SquarePants. <|im_end|>
<|im_start|>user
What is happening in the video?<|vision_start|>video.mp4<|vision_end|><|im_end|>
<|im_start|>assistant
The protagonist in the video is frying an egg.<|im_end|>

> **ChatML 数据集格式示例**
>
> <|im_start|>user
> <|vision_start|>Picture1.jpg<|vision_end|><|vision_start|>Picture2.jpg<|vision_end|>这两张图有什么共同点?<|im_end|>
> <|im_start|>assistant
> 两张图都是海绵宝宝. <|im_end|>
> <|im_start|>user
> 视频里发生了什么?<|vision_start|>video.mp4<|vision_end|><|im_end|>
> <|im_start|>assistant
> 视频里的主角正在煎鸡蛋.<|im_end|>

Visual Grounding

To endow the model with visual grounding capabilities, bounding box coordinates are normalized within [0, 1000) and represented as "(Xtop left, Ytop left), (Xbottom right, Ybottom right)". Tokens <|box_start|> and <|box_end|> are utilized to demarcate bounding box text. To accurately link bounding boxes with their textual descriptions, we introduce tokens <|object_ref_start|> and <|object_ref_end|> to indicate the content that the bounding box references, thereby allowing the model to effectively interpret and generate precise descriptions of specific regions.

> **视觉定位**
>
> 为了使模型具备视觉定位能力，边界框坐标在 [0, 1000) 范围内归一化，表示为"(左上角 X, 左上角 Y), (右下角 X, 右下角 Y)". <|box_start|> 和 <|box_end|> token 用于标记边界框文本. 为了准确地将边界框与其文本描述关联起来，我们引入 <|object_ref_start|> 和 <|object_ref_end|> token 来指示边界框引用的内容，从而使模型能够有效解释并生成特定区域的精确描述.

---

Referring Grounding
<|vision_start|>Picture1.jpg<|vision_end|>
<|object_ref_start|>the eyes on a giraffe<|object_ref_end|><|box_start|>(176,106),(232,160)<|box_end|>

> **指代定位示例**
>
> <|vision_start|>Picture1.jpg<|vision_end|>
> <|object_ref_start|>长颈鹿的眼睛<|object_ref_end|><|box_start|>(176,106),(232,160)<|box_end|>

Visual Agent

To develop Qwen2-VL as a general-purpose VL-Agent, we treat various agent tasks, such as UI Operations, Robotic Control, Games, and Navigation, as sequential decision-making problems, enabling Qwen2-VL to accomplish tasks through multi-step action execution. For each task, we first define a set of permissible actions and keywords pattern (underline) for function call (Qwen Team, 2024). Qwen2-VL then analyzes the observations, performs reasoning and planning, executes the selected actions, and interacts with the environment to acquire new observations. This cycle repeats iteratively until the task is successfully completed. By integrating various tools and leveraging the vision perception capabilities of large vision-language models (LVLMs), Qwen2-VL is able to iteratively execute increasingly complex tasks involving real-world visual interactions.

> **视觉 Agent**
>
> 为了将 Qwen2-VL 开发为通用视觉语言 Agent，我们将各种 Agent 任务(如 UI 操作、机器人控制、游戏和导航)视为序列决策问题，使 Qwen2-VL 能够通过多步动作执行来完成任务. 对于每个任务，我们首先定义一组允许的动作和用于函数调用的关键词模式(下划线)(Qwen Team, 2024). 然后 Qwen2-VL 分析观察结果，进行推理和规划，执行选定的动作，并与环境交互以获取新的观察结果. 这个循环迭代重复，直到任务成功完成. 通过整合各种工具并利用大型视觉语言模型(LVLMs)的视觉感知能力，Qwen2-VL 能够迭代执行涉及真实世界视觉交互的日益复杂的任务.

Visual Agent

```
<|im_start|>system
You are a helpful assistant.
# Qwen Technical Report
## You have the following actions.
### Tap
Tap: A gentle tap that commands, chooses, or navigates through a smartphone's user interface.
Parameters: [{"name": "point", "description": "The specific spot of interest on the monitor, denoted by the coordinates (x, y) where x and y range from 0 to 1000.", "required": True}]
### Home
Home: Go to phone's home screen. Parameters: []
### Other Actions ...
## Continuously take action until the task is completed.
*FUNCTION*: The action to take, should be one of {Actions}.
*ARGS*: The input of the action.
*RESULT*: Action results.
*RETURN*: Reply based on action results. <|im_end|>
```
<|im_start|>user
Find a pizza restaurant nearby in Map. <|vision_start|>Screenshot_1.jpg<|vision_end|> <|im_end|>
<|im_start|>assistant
Several e-mails are displaying on the phone screen. To open Map, I need go back to the home screen and find the corresponding app icon.
*FUNCTION*: Home *ARGS*: {}
*RESULT*: <|vision_start|>Screenshot_2.jpg<|vision_end|>
*RETURN*: I return to the home screen. Next, I need to find the icon of Map and tap on it.
*FUNCTION*: Tap *ARGS*: {"point": (348,291)}
*RESULT*: <|vision_start|>Screenshot_3.jpg<|vision_end|>
*RETURN*: [Thinking for the next action.]
[Other subsequent actions.] ......
I have found the pizza restaurant nearby in Map. <|im_end|>

> **视觉 Agent 示例**
>
> 系统提示定义了可用动作(Tap, Home 等)及其参数，模型通过迭代执行动作-观察-推理循环来完成任务. 上述示例展示了模型如何在手机 UI 上找到附近的披萨店：先返回主屏幕，找到地图应用图标并点击，然后逐步导航完成任务.

---

### 2.3 Multimodal Model Infrastructure

The Qwen2-VL models were trained on Alibaba Cloud's PAI-Lingjun Intelligent Computing Service (Alibaba-Cloud, 2024c) with its scalable computing, auto resuming and straggler detection.

> **2.3 多模态模型基础设施**
>
> Qwen2-VL 模型在阿里云 PAI-Lingjun 智能计算服务(Alibaba-Cloud, 2024c)上训练，具备可扩展计算、自动恢复和滞后检测功能.

Storage

We use Alibaba Cloud's ultra-speed CPFS (Cloud Parallel File Storage) (Alibaba-Cloud, 2024a) to build a storage system of Qwen2-VL pre-training and post-training. We decoupled the text data and vision data storage. We simply store text data on CPFS and use mmap for efficient access. For vision data, we use Alibaba Cloud's OSS (Object Storage Service) (Alibaba-Cloud, 2024b) for persistent storage. During training, we accessed vision data through OSS's python-client concurrently and tuned the concurrency and retrying parameters to avoid reaching the QPS (queries per second) limit. We also found that video data decoding is a main bottleneck, especially for long videos. After several attempts with open-source (FFmpeg-Developers, 2024) and in-house software failed, we opted for a caching decoding technique. Checkpointing saves each GPU's optimizer and model states on CPFS.

> **存储**
>
> 我们使用阿里云的超高速 CPFS(云并行文件存储)(Alibaba-Cloud, 2024a)构建 Qwen2-VL 预训练和后训练的存储系统. 我们将文本数据和视觉数据存储解耦. 文本数据直接存储在 CPFS 上并使用 mmap 进行高效访问. 视觉数据使用阿里云 OSS(对象存储服务)(Alibaba-Cloud, 2024b)进行持久化存储. 训练期间，我们通过 OSS 的 python-client 并发访问视觉数据，并调整并发和重试参数以避免达到 QPS(每秒查询数)限制. 我们还发现视频数据解码是一个主要瓶颈，尤其对于长视频. 在开源(FFmpeg-Developers, 2024)和内部软件的多次尝试失败后，我们选择了缓存解码技术. 检查点将每个 GPU 的优化器和模型状态保存在 CPFS 上.

> **译者注: 视频解码瓶颈的工程现实**
>
> 「视频数据解码是主要瓶颈」这句话背后是真实的工程痛点. 在分布式训练中，每个 GPU 需要从存储系统读取视频帧并进行解码(从压缩格式如 MP4 解压缩为原始像素). 对于长视频，随机访问特定时间戳的帧需要解析整个视频文件的结构，I/O 开销巨大. Qwen2-VL 团队尝试 FFmpeg 和内部软件都失败后选择了「缓存解码」—— likely 是预先将视频解码为帧序列的缓存格式(如 WebDataset 或 TFRecord)，牺牲存储空间换取读取速度. 文本-视觉存储解耦也是关键设计：文本数据小且需要随机访问，适合 CPFS 的高 IOPS; 视觉数据大且顺序读取友好，适合 OSS 的高吞吐. 这种异构存储架构在大规模多模态训练中几乎是必选项.

Parallelism

We use 3D parallelism which combines data parallelism (DP) (Li et al., 2020), tensor parallelism (TP) (Krizhevsky et al., 2012; Shoeybi et al., 2019) and pipeline parallelism (PP) (Huang et al., 2019; Narayanan et al., 2021; Lamy-Poirier, 2023) to scale Qwen2-VL model training. We also leverage deepspeed's zero-1 redundancy optimizer (Rajbhandari et al., 2020) to shard states for memory saving. Sequence parallelism (SP) (Korthikanti et al., 2023) with selective checkpointing activation (Chen et al., 2016) was leveraged to reduce memory usage. When enabling TP training, we always shard the vision encoder and large language models together but not the vision merger due to its relatively few parameters. We found the TP training would result in different model shared-weights due to the convolution operator's non-deterministic behavior. We resolved this issue by performing offline reduction of the shared weights, thereby avoiding an additional all-reduce communication step. This approach resulted in only a minimal impact on performance.

> **并行策略**
>
> 我们使用结合数据并行(DP)(Li et al., 2020)、张量并行(TP)(Krizhevsky et al., 2012; Shoeybi et al., 2019)和流水线并行(PP)(Huang et al., 2019; Narayanan et al., 2021; Lamy-Poirier, 2023)的 3D 并行来扩展 Qwen2-VL 模型训练. 我们还利用 DeepSpeed 的 zero-1 冗余优化器(Rajbhandari et al., 2020)对状态进行分片以节省内存. 序列并行(SP)(Korthikanti et al., 2023)配合选择性激活检查点(Chen et al., 2016)被用于减少内存使用. 在启用 TP 训练时，我们始终将视觉编码器和大语言模型一起分片，但不对视觉合并层(vision merger)分片，因为其参数相对较少. 我们发现由于卷积算子的非确定性行为，TP 训练会导致模型共享权重不同. 我们通过执行共享权重的离线归约来解决此问题，从而避免了额外的 all-reduce 通信步骤. 这种方法对性能的影响极小.

We leverage 1F1B PP (Narayanan et al., 2021) for Qwen2-VL 72B training. We combine the vision encoder, vision adapter and several LLM's decoder layers into one stage, and evenly split the remaining decoder layers. Note that the vision and text sequence lengths are dynamic for each data point. We broadcast the dynamic sequence lengths before initiating the 1F1B process and access the shape information using batch indices. We also implemented an interleaved 1F1B PP (Narayanan et al., 2021) but found it is slower than the standard 1F1B setting.

> 我们利用 1F1B PP(Narayanan et al., 2021)进行 Qwen2-VL 72B 训练. 我们将视觉编码器、视觉适配器和若干 LLM 解码器层组合为一个阶段，并均匀划分剩余的解码器层. 请注意，每个数据点的视觉和文本序列长度是动态的. 我们在启动 1F1B 过程之前广播动态序列长度，并使用批次索引访问形状信息. 我们还实现了交错 1F1B PP(Narayanan et al., 2021)，但发现它比标准 1F1B 设置更慢.

Software

We use PyTorch (Paszke et al., 2019; Ansel et al., 2024) version 2.1.2 with CUDA 11.8 (Nvidia, 2024b) for training. Additionally, we leverage flash-attention (Dao et al., 2022; Dao, 2024; Shah et al., 2024) for efficient training in both the vision encoder and the LLM. We also utilize fused operators (Nvidia, 2024a) such as LayerNorm (Ba et al., 2016), RMSNorm (Zhang and Sennrich, 2019), and Adam (Loshchilov and Hutter, 2019). Besides this, we leverage the overlap of communication and computation during matrix multiplication in our training process.

> **软件**
>
> 我们使用 PyTorch(Paszke et al., 2019; Ansel et al., 2024)版本 2.1.2 配合 CUDA 11.8(Nvidia, 2024b)进行训练. 此外，我们在视觉编码器和 LLM 中都利用 flash-attention(Dao et al., 2022; Dao, 2024; Shah et al., 2024)实现高效训练. 我们还使用融合算子(Nvidia, 2024a)，如 LayerNorm(Ba et al., 2016)、RMSNorm(Zhang and Sennrich, 2019)和 Adam(Loshchilov and Hutter, 2019). 除此之外，我们在训练过程中利用矩阵乘法期间通信和计算的重叠.

## 3 Experiments

In this section, we first evaluate the model's performance by conducting a comparative analysis across a variety of visual benchmarks, demonstrating the advantages of our approach. Subsequently, we carry out a detailed examination of specific capabilities, including general visual perception, document understanding, multilingual recognition in images, video comprehension, and agent abilities. Finally, we present an ablation study to investigate several key components of our approach.

> **3 实验**
>
> 在本节中，我们首先通过在多种视觉基准测试上进行比较分析来评估模型性能，展示我们方法的优势. 随后，我们对特定能力进行详细检验，包括通用视觉感知、文档理解、图像中的多语言识别、视频理解和 Agent 能力. 最后，我们进行消融研究以调查我们方法中几个关键组件的影响.

---

Table 2: Performance Comparison of Qwen2-VL Models and State-of-the-art.

| Benchmark | Previous SoTA | Claude-3.5 Sonnet | GPT-4o | Qwen2-VL-72B | Qwen2-VL-7B | Qwen2-VL-2B |
|-----------|--------------|-------------------|--------|-------------|-------------|-------------|
| MMMUval | 66.1 (X.AI, 2024b) | 68.3 | 69.1 | 64.5 | 54.1 | 41.1 |
| DocVQAtest | 94.1 (Chen et al., 2024c) | 95.2 | 92.8 | 96.5 | 94.5 | 90.1 |
| InfoVQAtest | 82.0 (Chen et al., 2024c) | - | - | 84.5 | 76.5 | 65.5 |
| AI2D | 87.6 (Chen et al., 2024c) | 80.2(94.7) | 84.6(94.2) | 88.1 | 83.0 | 74.7 |
| ChartQAtest | 88.4 (Chen et al., 2024c) | 90.8 | 85.7 | 88.3 | 83.0 | 73.5 |
| TextVQAval | 84.4 (Chen et al., 2024c) | - | - | 85.5 | 84.3 | 79.7 |
| OCRBench | 852 (Yao et al., 2024) | 788 | 736 | 877 | 866 | 809 |
| MTVQA | 23.2 (Team et al., 2023) | 25.7 | 27.8 | 30.9 | 25.6 | 18.1 |
| VCRen easy | 84.7 (Chen et al., 2024c) | 63.9 | 91.6 | 91.9 | 89.7 | 81.5 |
| VCRzh easy | 22.1 (Chen et al., 2024c) | 1.0 | 14.9 | 65.4 | 59.9 | 46.2 |
| RealWorldQA | 72.2 (Chen et al., 2024c) | 60.1 | 75.4 | 77.8 | 70.1 | 62.9 |
| MMEsum | 2414.7 (Chen et al., 2024c) | 1920.0 | 2328.7 | 2482.7 | 2326.8 | 1872.0 |
| MMBench-ENtest | 86.5 (Chen et al., 2024c) | 79.7 | 83.4 | 86.5 | 83.0 | 74.9 |
| MMBench-CNtest | 86.3 (Chen et al., 2024c) | 80.7 | 82.1 | 86.6 | 80.5 | 73.5 |
| MMBench-V1.1test | 85.5 (Chen et al., 2024c) | 78.5 | 82.2 | 85.9 | 80.7 | 72.2 |
| MMT-Benchtest | 63.4 (Chen et al., 2024b) | - | 65.5 | 71.7 | 63.7 | 54.5 |
| MMStar | 67.1 (Chen et al., 2024c) | 62.2 | 63.9 | 68.3 | 60.7 | 48.0 |
| MMVetGPT-4-Turbo | 67.5 (OpenAI., 2023) | 66.0 | 69.1 | 74.0 | 62.0 | 49.5 |
| HallBenchavg | 55.2 (Chen et al., 2024c) | 49.9 | 55.0 | 58.1 | 50.6 | 41.7 |
| MathVistatestmini | 69.0 (X.AI, 2024b) | 67.7 | 63.8 | 70.5 | 58.2 | 43.0 |
| MathVision | 30.3 (OpenAI, 2023) | - | 30.4 | 25.9 | 16.3 | 12.4 |
| MMMU-Pro | 46.9 (Team et al., 2023) | 51.5 | 51.9 | 46.2 | 43.5 | 37.6 |

> **Table 2: Qwen2-VL 模型与 State-of-the-art 的性能比较**
>
> (表格结构与上表一致，中文表头：基准测试 | 先前 SoTA | Claude-3.5 Sonnet | GPT-4o | Qwen2-VL-72B | Qwen2-VL-7B | Qwen2-VL-2B)

Table 3: Performance of Qwen2-VL and GPT-4o on internal multilingual OCR benchmarks.

| Language | Korean | Japanese | French | German | Italian | Russian | Vietnamese | Arabic |
|----------|--------|----------|--------|--------|---------|---------|------------|--------|
| GPT-4o | 87.8 | 88.3 | 89.7 | 88.3 | 74.1 | 96.8 | 72.0 | 75.9 |
| Qwen2-VL-72B | 94.5 | 93.4 | 94.1 | 91.5 | 89.8 | 97.2 | 73.0 | 70.7 |

> **Table 3: Qwen2-VL 与 GPT-4o 在内部多语言 OCR 基准测试上的性能**
>
> | 语言 | 韩语 | 日语 | 法语 | 德语 | 意大利语 | 俄语 | 越南语 | 阿拉伯语 |
> |------|------|------|------|------|---------|------|--------|---------|
> | GPT-4o | 87.8 | 88.3 | 89.7 | 88.3 | 74.1 | 96.8 | 72.0 | 75.9 |
> | Qwen2-VL-72B | 94.5 | 93.4 | 94.1 | 91.5 | 89.8 | 97.2 | 73.0 | 70.7 |

### 3.1 Compare to SOTAs

We evaluate the visual capabilities of our model through various visual benchmarks, video tasks, and agent-based assessments. Qwen2-VL demonstrates highly competitive performance at the same scale, achieving new state-of-the-art (SoTA) results. Overall, our 72B model consistently delivers top-tier performance across most evaluation metrics, frequently surpassing even closed-source models such as GPT-4o (OpenAI, 2024) and Claude 3.5-Sonnet (Anthropic, 2024). Notably, it exhibits a significant advantage in document understanding tasks. However, in the MMMU (Yue et al., 2023) benchmark, our model still lags behind GPT-4o to some extent, indicating that Qwen2-VL-72B has room for improvement when handling more complex and challenging problem sets.

> **3.1 与 SoTA 比较**
>
> 我们通过各种视觉基准测试、视频任务和基于 Agent 的评估来评估模型的视觉能力. Qwen2-VL 在同等规模下表现出极具竞争力的性能，取得了新的 state-of-the-art 结果. 总体而言，我们的 72B 模型在大多数评估指标上始终提供顶级性能，频繁超越 GPT-4o(OpenAI, 2024)和 Claude 3.5-Sonnet(Anthropic, 2024)等闭源模型. 值得注意的是，它在文档理解任务上表现出显著优势. 然而，在 MMMU(Yue et al., 2023)基准测试中，我们的模型在某种程度上仍落后于 GPT-4o，表明 Qwen2-VL-72B 在处理更复杂和更具挑战性的问题集方面仍有改进空间.

> **译者注: 评测数据的可信度审视**
>
> Table 2 的数据传递了几个重要信号. 首先，Qwen2-VL-72B 在**文档理解**(DocVQA 96.5, InfoVQA 84.5, OCRBench 877)和**中文视觉理解**(VCRzh 65.4 vs GPT-4o 的 14.9)上具有压倒性优势，这与阿里在电商场景中积累的海量中文图文数据直接相关. 其次，MMMU(64.5 vs GPT-4o 69.1)和 MathVision(25.9 vs GPT-4o 30.4)的差距揭示了**复杂推理仍是 LVLM 的短板**——视觉信息只是输入，真正的瓶颈在于 LLM 本身的推理能力. 第三，Table 3 的「内部多语言 OCR 基准」是内部数据集，无法独立验证，但公开基准 MTVQA 上 Qwen2-VL-72B 确实大幅领先(30.9 vs GPT-4o 27.8). 最后需要注意的是，许多基准(如 MMBench、MMStar)的测试数据可能出现在预训练语料中，数据污染风险在 LVLM 领域比纯文本 LLM 更难排除.

### 3.2 Quantitative Results

In this section, we present an extensive evaluation of the Qwen2-VL series across an array of datasets, offering a comprehensive understanding of the model's capabilities in various aspects.

> **3.2 定量结果**
>
> 在本节中，我们对 Qwen2-VL 系列在大量数据集上进行广泛评估，全面理解模型在各方面的能力.

#### 3.2.1 General Visual Question Answering

To rigorously assess our models' capabilities in general visual question answering tasks, we conduct extensive evaluations across a diverse array of state-of-the-art benchmarks: RealWorldQA (X.AI, 2024a), MMStar (Chen et al., 2024a), MMVet (Yu et al., 2024), MMT-Bench (Ying et al., 2024), MMBench (Liu et al., 2023d), MMbench-1.1 (Liu et al., 2023d), MME (Fu et al., 2023), and HallusionBench (Guan et al., 2023). The Qwen2-VL series exhibits exceptional performance across these benchmarks, with the 72B model consistently achieving or surpassing state-of-the-art results, while the 7B and 2B variants also demonstrate robust capabilities. On RealWorldQA, which evaluates real-world spatial comprehension, Qwen2-VL-72B achieves a score of 77.8, surpassing both the previous state-of-the-art (72.2) and formidable baselines such as GPT-4o (75.4), thus demonstrating superior understanding of physical environments.

> **3.2.1 通用视觉问答**
>
> 为了严格评估模型在通用视觉问答任务上的能力，我们在多种 state-of-the-art 基准测试上进行广泛评估：RealWorldQA(X.AI, 2024a)、MMStar(Chen et al., 2024a)、MMVet(Yu et al., 2024)、MMT-Bench(Ying et al., 2024)、MMBench(Liu et al., 2023d)、MMBench-1.1(Liu et al., 2023d)、MME(Fu et al., 2023)和 HallusionBench(Guan et al., 2023). Qwen2-VL 系列在这些基准测试中表现出卓越性能，72B 模型始终达到或超越 state-of-the-art 结果，而 7B 和 2B 变体也展示了强劲能力. 在评估现实世界空间理解的 RealWorldQA 上，Qwen2-VL-72B 取得了 77.8 分，超越了先前的 state-of-the-art(72.2)和强大的基线如 GPT-4o(75.4)，展示了其对物理环境的优越理解.


For MMStar, a benchmark designed to assess genuine multimodal capabilities through visually indispensable samples, Qwen2-VL-72B attains 68.3, outperforming the previous best of 67.1 and highlighting its proficiency in integrating visual and textual information. On MMVet, which evaluates the integration of core vision-language capabilities across 16 complex multimodal tasks, Qwen2-VL-72B achieves a remarkable 74.0, significantly outperforming strong competitors including GPT-4V (67.5) and showcasing its versatility in addressing diverse multimodal challenges. In the MMT-Bench evaluation, which assesses advanced reasoning and instruction following across 32 core meta-tasks and 162 subtasks in multimodal understanding, Qwen2-VL-72B achieves 71.7, markedly surpassing the previous best (63.4) and demonstrating its prowess in applying expert knowledge and executing deliberate visual recognition, localization, reasoning, and planning. On MMBench, which evaluates fine-grained abilities across 20 dimensions, Qwen2-VL-72B exhibits strong performance, achieving 86.5 on the English test set, matching the state-of-the-art, and 86.6 on the Chinese test set, establishing a new benchmark. For MME, which measures a wide spectrum of perception and cognition abilities across 14 subtasks, Qwen2-VL-72B achieves a cumulative score of 2482.7, significantly outperforming the previous best (2414.7), underscoring its advanced capabilities in both visual perception and high-level cognition tasks.

> 在 MMStar 上——一个通过视觉不可或缺样本评估真正多模态能力的基准测试——Qwen2-VL-72B 达到 68.3，超越了先前的最佳成绩 67.1，凸显了其在整合视觉和文本信息方面的熟练度. 在 MMVet 上——评估 16 个复杂多模态任务中核心视觉语言能力的整合——Qwen2-VL-72B 取得了 74.0 的显著成绩，大幅超越包括 GPT-4V(67.5)在内的强劲竞争者，展示了其应对多样化多模态挑战的多功能性. 在 MMT-Bench 评估中——评估多模态理解中 32 个核心元任务和 162 个子任务的高级推理和指令遵循能力——Qwen2-VL-72B 达到 71.7，明显超越了先前的最佳成绩(63.4)，展示了其在应用专家知识和执行审慎的视觉识别、定位、推理和规划方面的能力. 在 MMBench 上——评估 20 个维度的细粒度能力——Qwen2-VL-72B 表现出色，英文测试集达到 86.5(与 state-of-the-art 持平)，中文测试集达到 86.6(建立新基准). 在 MME 上——测量 14 个子任务中广泛的感知和认知能力——Qwen2-VL-72B 累计得分 2482.7，显著超越先前的最佳成绩(2414.7)，凸显了其在视觉感知和高级认知任务方面的先进能力.

These comprehensive results underscore the Qwen2-VL series' exceptional proficiency in general visual question answering tasks. The models demonstrate advanced capabilities in real-world spatial comprehension, genuine multimodal integration, complex reasoning, instruction following, and a broad range of perception and cognition tasks. The consistent superior performance across diverse benchmarks, particularly the outstanding results of the 72B model, positions the Qwen2-VL series as a leading solution in the field of visual question answering.

> 这些全面的结果凸显了 Qwen2-VL 系列在通用视觉问答任务上的卓越能力. 模型展示了在现实世界空间理解、真正的多模态整合、复杂推理、指令遵循以及广泛的感知和认知任务方面的先进能力. 在多样化基准测试上持续优异的表现，尤其是 72B 模型的突出结果，使 Qwen2-VL 系列成为视觉问答领域的领先解决方案.

---

Table 4: Performance of Qwen2-VL and other models on video benchmarks.

| Benchmark | Previous SoTA | Gemini 1.5-Pro | GPT-4o | Qwen2-VL-72B | Qwen2-VL-7B | Qwen2-VL-2B |
|-----------|--------------|----------------|--------|-------------|-------------|-------------|
| MVBench | 69.6 | - | - | 73.6 | 67.0 | 63.2 |
| PerceptionTesttest | 66.9 | - | - | 68.0 | 62.3 | 53.9 |
| EgoSchematest | 62.0 | 63.2 | 72.2 | 77.9 | 66.7 | 54.9 |
| Video-MME(wo/w subs) | 66.3/69.6 | 75.0/81.3 | 71.9/77.2 | 71.2/77.8 | 63.3/69.0 | 55.6/60.4 |

> **Table 4: Qwen2-VL 与其他模型在视频基准测试上的性能**
>
> | 基准测试 | 先前 SoTA | Gemini 1.5-Pro | GPT-4o | Qwen2-VL-72B | Qwen2-VL-7B | Qwen2-VL-2B |
> |----------|----------|---------------|--------|-------------|-------------|-------------|
> | MVBench | 69.6 | - | - | 73.6 | 67.0 | 63.2 |
> | PerceptionTest | 66.9 | - | - | 68.0 | 62.3 | 53.9 |
> | EgoSchema | 62.0 | 63.2 | 72.2 | 77.9 | 66.7 | 54.9 |
> | Video-MME(无/有字幕) | 66.3/69.6 | 75.0/81.3 | 71.9/77.2 | 71.2/77.8 | 63.3/69.0 | 55.6/60.4 |

Table 5: Performance Comparison of Qwen2-VL-72B across various agent benchmarks and GPT-4o. SR, GC, TM and EM are short for success rate, goal-condition success, type match and exact match. ALFRED, R2R and REVERIE are performance in valid-unseen.

| Benchmark | Metric | Previous SoTA | GPT-4o | Qwen2-VL-72B |
|-----------|--------|--------------|--------|-------------|
| General FnCall | TM | - | 90.2 | 93.1 |
| General FnCall | EM | - | 50.0 | 53.2 |
| UI Operations AITZ | TM | 83.0 (Hong et al., 2023) | 70.0 | 89.6 |
| UI Operations AITZ | EM | 47.7 (Zhan and Zhang, 2023) | 35.3 | 72.1 |
| Card Games Number Line | SR | 89.4 (Zhai et al., 2024) | 91.5 | 100.0 |
| Card Games BlackJack | SR | 40.2 (Zhai et al., 2024) | 34.5 | 42.6 |
| Card Games EZPoint | SR | 50.0 (Zhai et al., 2024) | 85.5 | 100.0 |
| Card Games Point24 | SR | 2.6 (Liu et al., 2023b) | 3.0 | 4.5 |
| Robotic Control ALFRED | SR | 67.7 (Lu et al., 2023) | - | 67.8 |
| Robotic Control ALFRED | GC | 75.3 (Lu et al., 2023) | - | 75.8 |
| Navigation R2R | SR | 79.0 (Chen et al., 2022) | 43.7 | 51.7 |
| Navigation REVERIE | SR | 61.0 (Sigurdsson et al., 2023) | 31.6 | 31.0 |

> **Table 5: Qwen2-VL-72B 在各种 Agent 基准测试上与 GPT-4o 的性能比较. SR=成功率, GC=目标条件成功率, TM=类型匹配, EM=精确匹配.**

#### 3.2.2 Document and Diagrams Reading

We tested our model's OCR and document and diagram comprehension on DocVQA (Mathew et al., 2021), ChartQA (Masry et al., 2022), InfoVQA (Mathew et al., 2021), TextVQA (Singh et al., 2019), AI2D (Kembhavi et al., 2016) datasets. The DocVQA/InfoVQA/ChartQA dataset focuses on the model's ability to comprehend text in documents/high-resolution infographics/charts, while the TextVQA dataset examines the ability to comprehend text in naturalistic images. The OCRBench dataset is a dataset of mixed tasks, which focuses on mathematical formula parsing and information extraction in addition to the text-based VQA. The AI2D dataset focuses on multiple-choice questions on scientific diagrams containing text. In addition, we also tested the OCR and formula recognition capabilities of our model on OCRBench (Liu et al., 2023e), as well as the multilingual OCR capabilities of our model on the MTVQA (Tang et al., 2024) dataset.

> **3.2.2 文档和图表阅读**
>
> 我们在 DocVQA(Mathew et al., 2021)、ChartQA(Masry et al., 2022)、InfoVQA(Mathew et al., 2021)、TextVQA(Singh et al., 2019)、AI2D(Kembhavi et al., 2016)数据集上测试了模型的 OCR 和文档/图表理解能力. DocVQA/InfoVQA/ChartQA 数据集侧重于模型理解文档/高分辨率信息图/图表中文本的能力，而 TextVQA 数据集考察理解自然图像中文本的能力. OCRBench 数据集是混合任务数据集，除基于文本的 VQA 外，还侧重于数学公式解析和信息提取. AI2D 数据集侧重于包含文本的科学图表的多选题. 此外，我们还在 OCRBench(Liu et al., 2023e)上测试了模型的 OCR 和公式识别能力，以及在 MTVQA(Tang et al., 2024)数据集上测试了多语言 OCR 能力.

The experimental results show that our model achieves SoTA level in several metrics, including DocVQA, InfoVQA, TextVQA and OCRBench, demonstrating that our model has good comprehension of textual content in images from multiple domains.

> 实验结果表明，我们的模型在 DocVQA、InfoVQA、TextVQA 和 OCRBench 等多个指标上达到 SoTA 水平，展示了模型对来自多个领域的图像中文本内容的良好理解.

#### 3.2.3 Multilingual Text Recognition and Understanding

In particular, our model surpasses all existing general-purpose LVLMs in multilingual OCR. Our model not only outperforms existing LVLMs (including proprietary models such as GPT-4o, Claude 3.5 Sonnet, etc.) on the public-available MTVQA dataset, it also outperforms GPT-4o on the in-house internal benchmark across all foreign languages except Arabic (Table 3).

> **3.2.3 多语言文本识别和理解**
>
> 特别是，我们的模型在多语言 OCR 方面超越了所有现有通用 LVLMs. 我们的模型不仅在公开可用的 MTVQA 数据集上优于现有 LVLMs(包括 GPT-4o、Claude 3.5 Sonnet 等专有模型)，在内部基准测试上也除了阿拉伯语外全面优于 GPT-4o(Table 3).

#### 3.2.4 Mathematical Reasoning

We've conducted experiments on the MathVista (Lu et al., 2024a) and MathVision (Wang et al., 2024) datasets to assess mathematical reasoning capabilities. MathVista is a comprehensive benchmark featuring 6,141 diverse examples of mathematical and visual tasks. The MathVision dataset comprises 3,040 math problems embedded in visual contexts from actual math competitions, covering 16 mathematical disciplines and varying in difficulty across five levels. These challenges underscore the necessity for LVLMs to exhibit strong visual comprehension, a deep understanding of mathematics, and sound logical reasoning skills. The Qwen2-VL series has demonstrated superior performance on MathVista, achieving a 70.5 outperforming other LVLMs. Additionally, it has set a new open-source benchmark on MathVision with 25.9.

> **3.2.4 数学推理**
>
> 我们在 MathVista(Lu et al., 2024a)和 MathVision(Wang et al., 2024)数据集上进行实验以评估数学推理能力. MathVista 是一个全面的基准测试，包含 6141 个多样化的数学和视觉任务示例. MathVision 数据集包含 3040 个来自实际数学竞赛的视觉上下文数学问题，涵盖 16 个数学学科，难度分为五个级别. 这些挑战凸显了 LVLMs 需要表现出强大的视觉理解、深入的数学理解和合理的逻辑推理能力. Qwen2-VL 系列在 MathVista 上展示了卓越性能，达到 70.5，超越了其他 LVLMs. 此外，它在 MathVision 上以 25.9 的成绩创造了新的开源基准.

#### 3.2.5 Referring Expression Comprehension

Regarding visual localization task, we evaluate Qwen2-VL on RefCOCO, RefCOCO+, and RefCOCOg datasets (Kazemzadeh et al., 2014; Mao et al., 2016). The results, as depicted in Table 6, demonstrate that Qwen2-VL attains top-tier results among generalist models. Benefiting from a more rational structure design, Qwen2-VL is able to perceive details in high-resolution images, leading to significant improvements over Qwen-VL.

> **3.2.5 指代表达理解**
>
> 关于视觉定位任务，我们在 RefCOCO、RefCOCO+ 和 RefCOCOg 数据集(Kazemzadeh et al., 2014; Mao et al., 2012016)上评估 Qwen2-VL. 如 Table 6 所示，结果表明 Qwen2-VL 在通用模型中达到顶级结果. 得益于更合理的结构设计，Qwen2-VL 能够感知高分辨率图像中的细节，相比 Qwen-VL 带来显著提升.

#### 3.2.6 Video Understanding

We evaluate our models on various video understanding tasks, with related benchmarks covering short videos of a few seconds to long videos of up to one hour. Table 4 presents the performance of Qwen2-VL and baseline models. Overall, Qwen2-VL demonstrates strong results across 2B, 7B, and 72B sizes, with Qwen2-VL-72B achieving the best performance on MVBench (Li et al., 2024), PerceptionTest (Patraucean et al., 2024), and EgoSchema (Mangalam et al., 2023). This showcases Qwen2-VL's superior capabilities in video understanding tasks, and scaling up Qwen2-VL yields significant improvements.

> **3.2.6 视频理解**
>
> 我们在各种视频理解任务上评估模型，相关基准测试涵盖从几秒短视频到长达一小时的视频. Table 4 展示了 Qwen2-VL 和基线模型的性能. 总体而言，Qwen2-VL 在 2B、7B 和 72B 尺寸上都展示了强劲结果，Qwen2-VL-72B 在 MVBench(Li et al., 2024)、PerceptionTest(Patraucean et al., 2024)和 EgoSchema(Mangalam et al., 2023)上取得最佳性能. 这展示了 Qwen2-VL 在视频理解任务上的卓越能力，扩大 Qwen2-VL 规模带来了显著提升.

For the challenging Video-MME benchmark (Fu et al., 2024), which includes videos up to one hour, it is noteworthy that we limited the maximum number of frames extracted per video to 768 during evaluation, potentially impacting performance on longer videos. Future work will focus on extending Qwen2-VL to support longer sequences, thereby accommodating longer videos.

> 对于具有挑战性的 Video-MME 基准测试(Fu et al., 2024)——包含长达一小时的视频——值得注意的是，我们在评估期间将每个视频提取的最大帧数限制为 768，这可能影响了对更长视频的性能. 未来工作将专注于扩展 Qwen2-VL 以支持更长的序列，从而容纳更长的视频.

> **译者注: 768 帧限制与视频理解的实际边界**
>
> 「评估时将每视频最大帧数限制为 768」是一个重要披露. 以每秒 2 帧采样计算，768 帧对应约 6.4 分钟的视频内容. 对于长达一小时的视频，这意味着模型实际上只处理了约 10% 的帧，其余帧被丢弃或平均采样. 这解释了为什么 Qwen2-VL-72B 在 Video-MME(71.2/77.8)上落后于 Gemini 1.5-Pro(75.0/81.3)——Gemini 1.5-Pro 支持百万级 token 上下文，可以处理更多帧. 这一限制也揭示了当前 LVLMs 视频理解的一个普遍瓶颈：**上下文长度**而非视觉编码能力. Qwen2-VL 的训练序列长度限制为 16K token，即使 M-RoPE 支持外推，超过训练长度的性能衰减也是不可避免的.

#### 3.2.7 Visual Agent

Qwen2-VL is evaluated first for its ability to interact with the environment via function calls and then for its capacity to complete complex sequential decision tasks through multiple rounds of interaction. The implementation is based on the Qwen-Agent framework (Qwen Team, 2024).

> **3.2.7 视觉 Agent**
>
> Qwen2-VL 首先评估其通过函数调用与环境交互的能力，然后评估其通过多轮交互完成复杂序列决策任务的能力. 实现基于 Qwen-Agent 框架(Qwen Team, 2024).

Function Calling

Unlike function calling in LLMs (Yan et al., 2024; Srinivasan et al., 2023; Chen et al., 2023c), function calling in LVLMs often involves extracting information from visual cues. Due to the absence of public benchmarks for evaluating the capabilities of LVLMs in function calling, we constructed our internal evaluation dataset. To construct the evaluation dataset, we undertook the following procedures (Chen et al., 2023c): Scene Categorization, Image Collection, Image Content Extraction, and Question/Functions/Arguments Generation.

> **函数调用**
>
> 与 LLMs 中的函数调用(Yan et al., 2024; Srinivasan et al., 2023; Chen et al., 2023c)不同，LVLMs 中的函数调用通常涉及从视觉线索中提取信息. 由于缺乏评估 LVLMs 函数调用能力的公开基准测试，我们构建了内部评估数据集. 为构建评估数据集，我们执行了以下步骤(Chen et al., 2023c)：场景分类、图像收集、图像内容提取、以及问题/函数/参数生成.

Similar to the function calling evaluation method in LLMs (Yan et al., 2024), we designed two metrics to evaluate the accuracy of the function selection and the correctness of the arguments input. Specifically, Type Match(TM), is calculated as the ratio of times the model successfully invoked the correct function to the total number of calls attempted. Exact Match(EM), for each function calling, we checked whether the arguments passed to the function exactly matched those recorded in the image's content information, calculating this correctness ratio.

> 类似于 LLMs 中的函数调用评估方法(Yan et al., 2024)，我们设计了两个指标来评估函数选择的准确性和参数输入的正确性. 具体而言，类型匹配(TM)计算模型成功调用正确函数的次数与尝试调用总次数的比率. 精确匹配(EM)检查每次函数调用中传递给函数的参数是否与图像内容信息中记录的参数完全匹配，计算这一正确率.

As shown in Table 5, the performance of Qwen2-VL in both Type Match(93.1 vs. 90.2) and Exact Match(53.2 vs. 50.0) over GPT-4o substantiates the efficacy of Qwen2-VL's capability in function calling, thereby underscoring its significant potential for application expansion through external tool integration.

> 如 Table 5 所示，Qwen2-VL 在类型匹配(93.1 vs 90.2)和精确匹配(53.2 vs 50.0)上都优于 GPT-4o，证实了 Qwen2-VL 函数调用能力的有效性，从而凸显了其通过外部工具集成扩展应用的重要潜力.

The evaluation results demonstrated that GPT-4o underperformed, primarily due to two factors: in scenarios where uncertainty arises, GPT-4o demonstrates a conservative approach by avoiding using external tools. The Optical Character Recognition (OCR) capability of GPT-4o is outperformed by Qwen2-VL, particularly in the context of Chinese characters.

> 评估结果表明 GPT-4o 表现不佳，主要由于两个因素：在出现不确定性的场景中，GPT-4o 表现出保守态度，避免使用外部工具. GPT-4o 的光学字符识别(OCR)能力被 Qwen2-VL 超越，尤其在中文场景下.

---

UI Operations/Games/Robotics/Navigation

To assess Qwen2-VL's ability to generally handle complex tasks, we conduct evaluations across multiple VL agent tasks, including mobile operations (Zhang et al., 2024b; Rawles et al., 2024b; Lu et al., 2024b; Rawles et al., 2024a), robotic control (Kolve et al., 2017; Shridhar et al., 2020a; Inoue and Ohashi, 2022; Lu et al., 2023; Jiang et al., 2022; Huang et al., 2023b), card games (Zhai et al., 2024), and vision-language navigation (Anderson et al., 2018; Qi et al., 2020). As these tasks need multiple actions to complete tasks, we keep the history (observation, action) through Qwen2-VL supports a 32K context length, then append each new observation image after every action, enabling continuous reasoning about subsequent steps.

> **UI 操作/游戏/机器人/导航**
>
> 为了评估 Qwen2-VL 处理复杂任务的一般能力，我们在多个 VL Agent 任务上进行评估，包括移动设备操作(Zhang et al., 2024b; Rawles et al., 2024b 等)、机器人控制(Kolve et al., 2017; Shridhar et al., 2020a 等)、卡牌游戏(Zhai et al., 2024)和视觉语言导航(Anderson et al., 2018; Qi et al., 2020). 由于这些任务需要多个动作才能完成，我们通过 Qwen2-VL 支持的 32K 上下文长度保留历史(观察, 动作)，然后在每次动作后追加新的观察图像，实现对后续步骤的持续推理.

UI Operations: we evaluate Qwen2-VL using the AITZ task (Zhang et al., 2024b), which constructs a core clean test set derived from AITW (Rawles et al., 2024b). Based on common operation patterns of phone, we define actions such as tap, input and swipe (Rawles et al., 2024b) for Qwen2-VL to interact with on-screen icons for task completion. Following the AITZ setting, we report both type match (correctness of tap, input, or swipe) and exact match (correctness of tap location, input text, or swipe direction). With the support of grounding capability on UI, Qwen2-VL surpasses GPT-4 and previous SoTA.

> **UI 操作**：我们使用 AITZ 任务(Zhang et al., 2024b)评估 Qwen2-VL，该任务从 AITW(Rawles et al., 2024b)构建了核心干净测试集. 基于手机的常见操作模式，我们定义了点击(tap)、输入(input)和滑动(swipe)等动作，使 Qwen2-VL 与屏幕上的图标交互以完成任务. 遵循 AITZ 设置，我们报告类型匹配(点击/输入/滑动的正确性)和精确匹配(点击位置、输入文本或滑动方向的正确性). 凭借 UI 定位能力的支持，Qwen2-VL 超越了 GPT-4 和先前的 SoTA.

Robotic Control: we evaluate Qwen2-VL on the ALFRED task (Shridhar et al., 2020a) in AI2THOR (Kolve et al., 2017). The task requires agent to perform complex household tasks, such as toasting bread and slicing an apple to prepare a meal. To improve the accuracy of manipulation, we integrate SAM (Kirillov et al., 2023). ALFRED task reports task success rate (SR) and sub-goal completion metrics (GC). Qwen2-VL slightly outperforms the previously specialized model ThinkBot (Lu et al., 2023) on the valid-unseen set.

> **机器人控制**：我们在 AI2THOR(Kolve et al., 2017)中的 ALFRED 任务(Shridhar et al., 2020a)上评估 Qwen2-VL. 任务要求 Agent 执行复杂的家庭任务，如烤面包和切苹果准备餐食. 为了提高操作准确性，我们集成了 SAM(Kirillov et al., 2023). ALFRED 任务报告任务成功率(SR)和子目标完成指标(GC). Qwen2-VL 在 valid-unseen 集上略微超越了先前的专用模型 ThinkBot(Lu et al., 2023).

Card Games: we leverage the card game environment from RL4VLM (Zhai et al., 2024) to assess Qwen2-VL's performance in a series of card-based games. Qwen2-VL demonstrates superior performance across all tasks.

> **卡牌游戏**：我们利用 RL4VLM(Zhai et al., 2024)的卡牌游戏环境评估 Qwen2-VL 在一系列卡牌游戏中的表现. Qwen2-VL 在所有任务上都展示了卓越性能.

Vision-Language Navigation: we evaluate Qwen2-VL on the Vision-and-Language Navigation (VLN) task using the R2R (Anderson et al., 2018) and REVERIE (Qi et al., 2020). We report the success rate (SR) of VLM in reaching the predetermined destination for this task. The performance of Qwen2-VL is comparable to that of GPT-4o, but both models fall significantly behind current specialized VLN models. We attribute this gap to the incomplete and unstructured map information generated by the model from multiple images. Accurately modeling maps and locations in a 3D environment remains a major challenge for multimodal models.

> **视觉语言导航**：我们在 R2R(Anderson et al., 2018)和 REVERIE(Qi et al., 2020)上评估 Qwen2-VL 的视觉语言导航(VLN)任务. 我们报告 VLM 到达预定目的地的成功率(SR). Qwen2-VL 的性能与 GPT-4o 相当，但两者都显著落后于当前专用 VLN 模型. 我们将这一差距归因于模型从多张图像生成的不完整和非结构化的地图信息. 在 3D 环境中准确建模地图和位置仍然是多模态模型的重大挑战.

> **译者注: VLN 差距揭示的结构性局限**
>
> VLN 任务(R2R 51.7% vs 专用模型 79.0%)的差距尤其值得关注. 这不是视觉理解的问题——模型能「看到」走廊和门——而是**空间推理和地图构建**的问题. 专用 VLN 模型通常内置了拓扑地图表示和路径规划模块，而通用 LVLM 需要从零学习这些结构化知识. 论文归因于「不完整和非结构化的地图信息」，实际上点出了当前端到端 LVLMs 的一个根本限制：它们擅长「感知」但缺乏「结构化认知」. 将感知结果提升为可用于导航的拓扑/度量地图，需要超出纯 next-token prediction 的能力. 这也是 Agent 研究的一个重要方向：如何让多模态模型从感知中构建可操作的内部世界模型.

---

Table 7: Qwen2-VL-7B under fixed/dynamic image tokens. Adjusting image sizes only results in small perturbations in performance, demonstrating the robustness to varying image sizes. Moreover, the dynamic resolution strategy achieves top-tier performance while consuming fewer tokens on average, demonstrating the efficiency of our model.

| Strategy | Average Image Tokens | InfoVQAval | RealWorldQA | OCRBench | MMMU |
|----------|---------------------|------------|-------------|----------|------|
| Fixed 64 | 64 | 28.85 | 56.47 | 572 | 53.33 |
| Fixed 576 | 576 | 65.72 | 65.88 | 828 | 52.78 |
| Fixed 1600 | 1600 | 74.99 | 69.54 | 824 | 52.89 |
| Fixed 3136 | 3136 | 77.27 | 70.59 | 786 | 53.44 |
| Dynamic | 1924 | 75.89 | 70.07 | 866 | 53.44 |

> **Table 7: Qwen2-VL-7B 在固定/动态图像 token 下的表现. 调整图像尺寸只会导致性能的小幅波动，展示了对不同图像尺寸的鲁棒性. 此外，动态分辨率策略在平均消耗更少 token 的情况下实现了顶级性能，展示了模型的效率.**

### 3.3 Ablation Study

In this section, we present ablation studies on image dynamic resolution, M-RoPE, and model scale. These experiments aim to provide insights into the impact of these key components on our model's performance.

> **3.3 消融研究**
>
> 在本节中，我们展示关于图像动态分辨率、M-RoPE 和模型规模的消融研究. 这些实验旨在提供这些关键组件对模型性能影响的洞察.

#### 3.3.1 Dynamic Resolution

As shown in Table 7, we compare the performance between dynamic resolution and fixed resolution. For fixed resolution, we resize the images to ensure a constant number of image tokens being input to the model, rather than resizing to a specific height and width, as this would distort the original aspect ratio. For dynamic resolution, we only set min_pixels= 100 × 28 × 28 and max_pixels= 16384 × 28 × 28, allowing the number of image tokens depend primarily on the image's native resolution. It can be observed that adjusting image sizes only results in small perturbations in performance, demonstrating the model robustness to varying image sizes. Moreover, dynamic resolution approach is more efficient. We can observe that no single fixed resolution achieves optimal performance across all benchmarks. In contrast, the dynamic resolution approach consistently achieves top-tier performance while consuming fewer tokens on average.

> **3.3.1 动态分辨率**
>
> 如 Table 7 所示，我们比较动态分辨率和固定分辨率之间的性能. 对于固定分辨率，我们将图像调整大小以确保向模型输入恒定数量的图像 token，而不是调整到特定高度和宽度(因为这会扭曲原始宽高比). 对于动态分辨率，我们仅设置 min_pixels = 100×28×28 和 max_pixels = 16384×28×28，允许图像 token 数量主要取决于图像的原始分辨率. 可以观察到，调整图像尺寸只会导致性能的小幅波动，展示了模型对不同图像尺寸的鲁棒性. 此外，动态分辨率方法更高效. 我们可以观察到，没有一个固定分辨率在所有基准测试上都达到最优性能. 相比之下，动态分辨率方法始终实现顶级性能，同时平均消耗更少的 token.

Additionally, we observe that merely increasing the image size does not always lead to improved performance. It is more important to choose an appropriate resolution for different images. As detailed in Figure 4, we upscale small images to surpass a specified min_pixels threshold. Evaluations on upscaled images shows enhanced performance on perceptual tasks like InfoVQA, HallusionBench, and OCRBench. We attribute these gains to increased computational load. However, for OCRBench, a too-high min_pixels value leads to a severe performance decline. This is likely because OCRBench contains numerous extremely small images, and excessive enlargement causes these images to deviate from the training data distribution, turning them into out-of-distribution samples. In contrast, the effect of increasing min_pixels on the MMMU benchmark is negligible. We hypothesize that the performance bottleneck in MMMU is more related to the model's reasoning capability rather than image resolution.

> 此外，我们观察到仅仅增加图像尺寸并不总能带来性能提升. 为不同图像选择合适的分辨率更为重要. 如图 4 详细所示，我们将小图像上采样以超过指定的 min_pixels 阈值. 在上采样图像上的评估显示，在 InfoVQA、HallusionBench 和 OCRBench 等感知任务上性能增强. 我们将这些增益归因于增加的计算负载. 然而，对于 OCRBench，过高的 min_pixels 值会导致严重的性能下降. 这可能是因为 OCRBench 包含大量极小的图像，过度放大使这些图像偏离训练数据分布，将它们变成分布外样本. 相比之下，增加 min_pixels 对 MMMU 基准测试的影响可以忽略不计. 我们假设 MMMU 中的性能瓶颈更多与模型的推理能力相关，而非图像分辨率.

---

Table 8: Ablation studies of M-RoPE. Compared to 1D-RoPE, using M-RoPE achieves better performance in downstream tasks, particularly in video benchmarks. RWQ means RealworldQA.

| | Image Benchmarks | | | | | | | Video Benchmarks | | |
|---|---|---|---|---|---|---|---|---|---|---|
| | MathVista | MMB | MMStar | RWQ | DocVQA | ChartQA | InfoVQA | TextVQA | PerceptionTest | NextQA | STAR |
| 1D-RoPE | 39.2 | 58.6 | 36.7 | 54.5 | 82.5 | 68.0 | 50.8 | 71.3 | 46.6 | 43.9 | 55.5 |
| M-RoPE | 43.4 | 60.6 | 36.7 | 53.7 | 82.8 | 68.4 | 50.3 | 71.8 | 47.4 | 46.0 | 57.9 |

> **Table 8: M-RoPE 消融研究. 与 1D-RoPE 相比，使用 M-RoPE 在下游任务上取得更好的性能，尤其在视频基准测试上. RWQ = RealWorldQA.**

#### 3.3.2 M-RoPE

In this subsection, we demonstrate the effectiveness of M-RoPE. First, we validate its capability on various downstream tasks. We employ Qwen2-1.5B and ViT-L as the backbone and report the results of the pre-trained models. As shown in Table 8, compared to 1D-RoPE, using M-RoPE achieves better performance in downstream tasks, particularly in video benchmarks. Furthermore, we assess the length extrapolation capability of M-RoPE on Video-MME medium-length videos. Figure 5 illustrates the performance of Qwen2-VL-72B at different inference lengths. Leveraging M-RoPE, the model demonstrates robust results across various inference lengths. Notably, despite limiting the maximum tokens per video to 16K during training, the model still exhibits exceptional performance at a maximum inference length of 80K tokens.

> **3.3.2 M-RoPE**
>
> 在本小节中，我们展示 M-RoPE 的有效性. 首先，我们在各种下游任务上验证其能力. 我们使用 Qwen2-1.5B 和 ViT-L 作为主干网络，报告预训练模型的结果. 如 Table 8 所示，与 1D-RoPE 相比，使用 M-RoPE 在下游任务上取得更好的性能，尤其在视频基准测试上. 此外，我们在 Video-MME 中等长度视频上评估 M-RoPE 的长度外推能力. 图 5 展示了 Qwen2-VL-72B 在不同推理长度下的性能. 借助 M-RoPE，模型在各种推理长度下都展示了稳健的结果. 值得注意的是，尽管训练期间将每个视频的最大 token 限制为 16K，模型在最大推理长度为 80K token 时仍表现出卓越性能.

#### 3.3.3 Model Scaling

We evaluate the performance of models of varying scales across multiple capability dimensions. Specifically, we categorize these dimensions into complex college-level problem-solving, mathematical abilities, document and table comprehension, general scenario question-answering, and video comprehension. The overall capability of a model is assessed by averaging its scores across different benchmarks associated with each dimension.

> **3.3.3 模型缩放**
>
> 我们在多个能力维度上评估不同规模模型的性能. 具体而言，我们将这些维度分为复杂大学水平问题解决、数学能力、文档和表格理解、通用场景问答和视频理解. 模型的整体能力通过平均每个维度相关基准测试的分数来评估.

As illustrated in Figure 6(a), there is a consistent improvement in performance with increasing model size, particularly with respect to mathematical abilities, which show a positive correlation with the number of model parameters. On the other hand, for optical character recognition (OCR)-related tasks, even smaller-scale models exhibit relatively strong performance.

> 如图 6(a)所示，随着模型规模增加性能持续改善，尤其在数学能力方面，与模型参数数量呈正相关. 另一方面，对于光学字符识别(OCR)相关任务，即使较小规模的模型也表现出相对强劲的性能.

As shown in Figure 6(b), we visualize the relationship between model performance and the number of training tokens during the second stage of pretraining for Qwen2-VL-7B. As the number of training tokens increases, the model performance improves; however, performance on vision question answering (VQA) tasks exhibits some fluctuation. In contrast, for tasks such as AI2D and InfoVQA-both of which involve understanding textual and graphical information in images-the model performance shows steady improvement as training data is augmented.

> 如图 6(b)所示，我们可视化了 Qwen2-VL-7B 第二阶段预训练期间模型性能与训练 token 数量之间的关系. 随着训练 token 数量增加，模型性能提升; 然而，视觉问答(VQA)任务的性能表现出一些波动. 相比之下，对于 AI2D 和 InfoVQA 等任务——两者都涉及理解图像中的文本和图形信息——随着训练数据增加，模型性能稳步提升.

## 4 Conclusion

We have presented the Qwen2-VL series, the versatile large vision-language models, including three open-weight models with total parameter counts of 2, 8, and 72 billion. Qwen2-VL matches the performance of top-tier models like GPT-4o and Claude3.5-Sonnet in a range of multimoal scenarios, surpassing all other open-weight LVLM models. Qwen2-VL series introduces naive dynamic resolution and multimodal rotary position embedding (M-RoPE) to fuse information across modals effectively and be capable of understanding videos over 20 minutes in length. With advanced reasoning and decision-making abilities, Qwen2-VL can be integrated with devices such as mobile phones, robots, etc. Furthermore, Qwen2-VL now supports understanding multilingual texts within images, including most European languages, Japanese, Korean, Arabic, Vietnamese, and others.

> **4 结论**
>
> 我们介绍了 Qwen2-VL 系列，通用的大型视觉语言模型，包括三个开源权重模型，总参数分别为 20 亿、80 亿和 720 亿. Qwen2-VL 在一系列多模态场景中与 GPT-4o 和 Claude3.5-Sonnet 等顶级模型性能相当，超越了所有其他开源 LVLM 模型. Qwen2-VL 系列引入朴素动态分辨率和多模态旋转位置嵌入(M-RoPE)以有效融合跨模态信息，并能够理解超过 20 分钟的视频. 凭借先进的推理和决策能力，Qwen2-VL 可以与手机、机器人等设备集成. 此外，Qwen2-VL 现在支持理解图像中的多语言文本，包括大多数欧洲语言、日语、韩语、阿拉伯语、越南语等.

We have made the Qwen2-VL model weights openly accessible, which enables researchers and developers to harness the full potential in a variety of applications and research projects.

> 我们已公开提供 Qwen2-VL 模型权重，使研究人员和开发者能够在各种应用和研究项目中充分利用其潜力.

---

> **致谢与参考文献**
>
> 第 17 页为致谢，感谢阿里云 PAI 团队、Qwen LLM 团队等在训练基础设施、数据贡献和讨论方面的支持. 第 18-24 页为参考文献列表，涵盖视觉语言模型、Transformer、训练系统、评测基准等领域的经典与前沿工作，共计约 80 篇引用. 核心引用包括：Qwen-VL/Qwen2 技术报告、Flamingo、BLIP-2、LLaVA、NaViT、ViT、RoPE/2D-RoPE、FlashAttention、DeepSpeed、以及各类多模态评测基准(MMBench, MMMU, DocVQA 等)的原始论文.

---

## Appendix A: Model Capabilities and Qualitative Examples (Pages 25-52)

> **附录 A: 模型能力与定性示例**
>
> 附录 A 包含大量定性示例，展示 Qwen2-VL 在实际交互中的能力. 这些示例按能力类别组织，以下为各分类的概括翻译.

### A.1 General Chat and OCR (Pages 25-31)

> **A.1 通用对话与 OCR**
>
> 展示了 Qwen2-VL 在多种 OCR 和多语言文本识别场景下的能力：
> • **多目标识别**：识别图像中彩色方块的布局和颜色(Figure 7).
> • **植物识别**：从照片中识别花卉种类(Figure 8).
> • **密集公式文档解析**：将包含复杂数学公式的图像内容转换为 Markdown(Figure 9).
> • **多语言文本识别**：支持中文、日语、韩语、法语、西班牙语、葡萄牙语、爱尔兰语、英语、德语、波兰语、希腊语、越南语、蒙古语、俄语、斯瓦希里语等 15+ 种语言的图像文本转录与语言识别(Figure 10).
> • **密集中文文本识别**：将长篇紧密排列的中文字符准确流畅地转换为标准英文(Figure 11).
> • **大图像 OCR**：识别大尺寸图像中的文本内容，如产品说明文档(Figure 21).

### A.2 Information Extraction and Visual Reasoning (Pages 32-39)

> **A.2 信息提取与视觉推理**
>
> 展示了 Qwen2-VL 在复杂视觉推理和信息处理方面的能力：
> • **数学问题求解**：求解等腰三角形边长、计算几何体表面积和体积等，提供逐步推导过程(Figures 14-15).
> • **算法问题求解**：阅读题目要求并实现 Python 代码解决「矩阵中的蛇」等问题(Figure 16).
> • **网页内容识别**：从搜索结果的截图中提取所有页面标题(Figure 17).
> • **OCR 与数学推理结合**：从日历图像中读取生日日期并计算日期间隔(Figure 18).
> • **OCR 与格式遵循**：将图像中的 Linux 版本和发布日期整理为 JSON 列表(Figure 19); 将气温数据整理为表格(Figure 20).

### A.3 Video Understanding (Pages 40-42)

> **A.3 视频理解**
>
> 展示了 Qwen2-VL 在视频对话和多视频理解方面的能力：
> • **多轮视频聊天**：详细描述视频内容(如太空站宇航员场景)，并回答后续关于细节的追问(Figure 22).
> • **多视频理解**：理解视频中人物行为(如使用吸尘器清洁地板)，并基于上下文进行多轮对话推理(Figure 23).

### A.4 Visual Agent Capability (Pages 43-52)

> **A.4 视觉 Agent 能力**
>
> 展示了 Qwen2-VL 作为视觉 Agent 的定位、交互和任务执行能力：
> • **视觉定位**：检测图像中特定元素(如「红色汽车」)的边界框(Figure 24).
> • **视觉指代提示**：根据网页截图中的指针位置，回答关于所指内容的问题(Figure 25).
> • **函数调用-基础**：从机票截图中提取目的地和到达时间，调用天气查询函数获取到达时的天气信息(Figure 26).
> • **函数调用-代码解释器**：识别流程图步骤并生成对应代码，通过代码解释器执行验证(Figures 27-29).
> • **VL Agent-UI 操作**：作为手机 UI Agent，理解用户查询，利用预定义动作(点击/输入/滑动/返回/主页/确认/完成)逐步完成任务(Figure 30).
> • **VL Agent-卡牌游戏**：识别扑克牌面，利用 Hit 和 Stand 动作玩 21 点(Figure 31).

