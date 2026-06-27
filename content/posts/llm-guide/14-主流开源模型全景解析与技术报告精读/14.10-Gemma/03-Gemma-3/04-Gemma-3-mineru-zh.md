---

title: "Gemma-3 Technical Report (MinerU 逐译+译者注)"

source: 03-Gemma-3-mineru-en.md

converted_by: PyMuPDF (MinerU fallback)

translated_by: TechReportDeepDive

---


> 原文标题:

> 原文链接: <https://arxiv.org/abs/2503.19786>

> 发布日期: 2025 年 3 月 12 日

> 发布机构: Gemma Team, Google DeepMind

> 逐译底稿: 03-Gemma-3-mineru-en.md (PyMuPDF 提取)

---

2025-03-12

Gemma Team, Google DeepMind1

We introduce Gemma 3, a multimodal addition to the Gemma family of lightweight open models, ranging in scale from 1 to 27 billion parameters. This version introduces vision understanding abilities, a wider coverage of languages and longer context - at least 128K tokens. We also change the architecture of the model to reduce the KV-cache memory that tends to explode with long context. This is achieved by increasing the ratio of local to global attention layers, and keeping the span on local attention short. The Gemma 3 models are trained with distillation and achieve superior performance to Gemma 2 for both pre-trained and instruction finetuned versions. In particular, our novel post-training recipe significantly improves the math, chat, instruction-following and multilingual abilities, making Gemma3-4B-IT competitive with Gemma2-27B-IT and Gemma3-27B-IT comparable to Gemini-1.5-Pro across benchmarks. We release all our models to the community.

我们介绍 Gemma 3, 这是 Gemma 轻量级开源模型家族的多模态新成员, 规模从 10 亿到 270 亿参数不等. 该版本引入了视觉理解能力, 更广泛的语言覆盖范围以及更长的上下文窗口 - 至少 128K tokens. 我们还修改了模型架构, 以减少在长上下文场景下容易急剧膨胀的 KV Cache 内存占用. 这一目标的实现方式是提高局部注意力层(local attention layer)与全局注意力层(global attention layer)的比例, 并缩短局部注意力的跨度.

Gemma 3 模型采用蒸馏(distillation)方式进行训练, 在预训练版本和指令微调(instruction finetuned)版本上均取得了优于 Gemma 2 的性能.

特别是, 我们新颖的后训练(post-training)配方显著提升了数学, 对话, 指令遵循和多语言能力, 使得 Gemma3-4B-IT 能够与 Gemma2-27B-IT 相媲美, 而 Gemma3-27B-IT 在各项基准测试上可与 Gemini-1.5-Pro 比肩. 我们将所有模型向社区开源发布.

> 译者注: 这里的设计动机值得关注. 长上下文场景下 KV Cache 的内存爆炸是端侧部署的真实瓶颈 - 对于一个 128K 上下文的 Dense 模型, 完整的 KV Cache 可能占用数十 GB 显存. Gemma 3 的核心洞察是: 并非每一层都需要全局注意力. 通过将局部注意力层与全局注意力层按 5:1 交错排列, 只有全局层需要存储长序列的 KV, 而局部层仅关注 1024 tokens 的滑动窗口, 从而从架构层面直接压缩了 KV Cache 的内存占用. 这是显存换计算质量的典型权衡 - 局部层无法建立远距离依赖, 但论文后续的消融实验表明这种影响在 perplexity 上微乎其微.

## 1. Introduction

> 🔙 **[返回 14.10-Gemma 家族总览](../../14.10-Gemma.md)**


## 1. 引言

We present the newest version of Gemma open language models (Gemma Team, 2024a), co-designed with the family of Gemini frontier models (Gemini Team, 2023). This new version comes in sizes comparable to Gemma 2 (Gemma Team, 2024b), with the addition of a 1B model. These models are designed to run on standard consumer-grade hardware such as phones, laptops, and high-end GPUs. This version comes with several new abilities to the Gemma family; namely, multimodality, long context, and multilinguality, while preserving or surpassing the performance of prior versions. 我们展示了 Gemma 开源语言模型的最新版本 (Gemma Team, 2024a), 该模型与 Gemini 前沿模型家族 (Gemini Team, 2023) 协同设计. 这一新版本的规模与 Gemma 2 (Gemma Team, 2024b) 相当, 并新增了 1B 模型. 这些模型旨在在标准的消费级硬件上运行, 例如手机, 笔记本电脑和高端 GPU. 该版本为 Gemma 家族带来了几项新能力; 即多模态, 长上下文和多语言性, 同时保持或超越了先前版本的性能. In terms of multimodality, most Gemma 3 models are compatible with a tailored version of the SigLIP vision encoder (Zhai et al., 2023). The language models treat images as a sequence of soft tokens encoded by SigLIP. We reduce the inference cost of image processing by condensing the vision embeddings into a fixed size of 256 vectors. The encoder works at a fixed resolution and we take inspiration from LLaVA (Liu et al., 2024) to enable flexible resolutions with a Pan and Scan (P&S) method. 就多模态而言, 大多数 Gemma 3 模型兼容一个定制版的 SigLIP 视觉编码器 (Zhai et al., 2023). 语言模型将图像视为由 SigLIP 编码的一系列 soft token. 我们通过将视觉嵌入(vision embeddings)压缩为固定大小的 256 个向量来降低图像处理的推理成本. 该编码器以固定分辨率工作, 我们借鉴 LLaVA (Liu et al., 2024) 的思路, 采用 Pan and Scan (P&S) 方法来实现灵活的分辨率处理. The second main architectural improvement is an increase in context size to 128K tokens, without reducing performance. A challenge with long context is the memory explosion of the KV cache during inference. To reduce this issue, we interleave multiple local layers between each global layer, and assign a smaller span of only 1024 tokens to the local layers. Therefore, only the global layers attend to long context, and we have 1 global for every 5 local layers.

第二个主要的架构改进是将上下文大小增加到 128K tokens, 且未降低性能. 长上下文带来的一个挑战是推理过程中 KV Cache 的内存爆炸. 为了减少这一问题, 我们在每个全局层之间交错插入多个局部层, 并为局部层分配仅 1024 tokens 的较小跨度. 因此, 只有全局层需要关注长上下文, 且我们每 5 个局部层设置 1 个全局层.

The pre-training optimization recipe is similar to Gemma 2, with some modifications in the architecture design. We use the same tokenizer as Gemini 2.0, and we also revisit our data mixture to improve the multilingual capabilities of the models, while introducing image understanding. All Gemma 3 models are trained with knowledge distillation (Hinton et al., 2015). 预训练优化方案与 Gemma 2 类似, 但在架构设计上做了一些修改. 我们使用与 Gemini 2.0 相同的 tokenizer, 并重新调整了数据混合(data mixture)策略以提升模型的多语言能力, 同时引入图像理解能力. 所有 Gemma 3 模型均采用知识蒸馏(knowledge distillation, Hinton et al., 2015) 进行训练. In post-training, we focus our efforts on improving mathematics, reasoning, and chat abilities, as well as integrating the new capabilities of Gemma 3, long-context, and image inputs. We use a novel post-training approach that brings gains across all capabilities, including math, coding, chat, instruction following, and multilingual. The resulting Gemma 3 instruction-tuned models are both powerful and versatile, outperforming their predecessors by a wide margin.

在后训练中, 我们聚焦于提升数学, 推理和对话能力, 同时整合 Gemma 3 的新能力, 长上下文和图像输入. 我们采用了一种新颖的后训练方法, 在数学, 编程, 对话, 指令遵循和多语言等各项能力上都带来了提升. 由此得到的 Gemma 3 指令微调(instruction-tuned, IT) 模型既强大又通用, 以显著优势超越了前代模型.

In the following sections, we provide a brief overview of our models, including the architecture and pre- and post-training recipes. We also provide detailed evaluations across a wide variety of quantitative and qualitative benchmarks. We discuss our approach to safe and responsible deployment and outline the broader implications of Gemma 3, its limitations, and advantages.

在接下来的章节中, 我们简要概述我们的模型, 包括架构以及预训练和后训练方案. 我们还在大量定量和定性基准测试上提供了详细的评估. 我们讨论了安全且负责任的部署方法, 并概述了 Gemma 3 的更广泛影响, 局限性以及优势.

---

Figure 1 | Example of visual interaction with Gemma 3 27B IT model.

> 图 1: Gemma 3 27B IT 模型视觉交互示例.

## 2. Model Architecture

## 2. 模型架构

Gemma 3 models follow the same general decoder-only transformer architecture as previous iterations (Vaswani et al., 2017), with most architecture elements similar to the first two Gemma versions. We use a Grouped-Query Attention (GQA) (Ainslie et al., 2023) with post-norm and pre-norm with RMSNorm (Zhang and Sennrich, 2019). Inspired by Dehghani et al. (2023), Wortsman et al. (2023) and Chameleon Team (2024), we replace the soft-capping of Gemma 2 with QK-norm. In this section, we focus on some key differences from previous versions below. Gemma 3 模型遵循与前几代相同的通用 decoder-only Transformer 架构 (Vaswani et al., 2017), 大多数架构元素与前两个 Gemma 版本相似. 我们使用 Grouped-Query Attention (GQA, 分组查询注意力, Ainslie et al., 2023), 配合 post-norm 和 pre-norm 以及 RMSNorm (Zhang and Sennrich, 2019). 受 Dehghani et al. (2023), Wortsman et al. (2023) 和 Chameleon Team (2024) 的启发, 我们用 QK-norm 替代了 Gemma 2 中的 soft-capping.

在本节中, 我们重点介绍与先前版本的一些关键差异.

> 译者注: QK-norm 替代 soft-capping 是一个值得关注的架构细节. Soft-capping 通过对注意力 logits 施加 tanh 缩放来限制其数值范围, 防止训练中的 logits 爆炸, 但这会引入非线性饱和效应. QK-norm 则是在计算注意力分数前对 Query 和 Key 做层归一化, 从根本上约束了内积的数值范围, 避免了饱和问题. 从谱系上看, QK-norm 最早在 Chameleon 等模型中得到验证, 其优势在于不改变注意力分布的形状, 仅压缩其尺度, 这对训练稳定性更友好. Gemma 3 采用这一设计, 说明 Google DeepMind 内部在将前沿模型的技术成果向开源模型迁.

| Model | Vision Encoder | Embedding Parameters | Non-embedding Parameters |
|-------|----------------|----------------------|--------------------------|
| 1B | 0 | 302M | 698M |
| 4B | 417M | 675M | 3,209M |
| 12B | 417M | 1,012M | 10,759M |
| 27B | 417M | 1,416M | 25,600M |

Table 1
| Parameter counts for the Gemma 3 models. Our vocabulary has 256k entrie.

| 模型 | 视觉编码器 | 嵌入参数 | 非嵌入参数 |
|------|-----------|---------|-----------|
| 1B | 0 | 302M | 698M |
| 4B | 417M | 675M | 3,209M |
| 12B | 417M | 1,012M | 10,759M |
| 27B | 417M | 1,416M | 25,600M |

> 表 1: Gemma 3 模型的参数量统计. 我们的词表大小为 256k. 5:1 interleaving of local/global layers. We alternate between a local sliding window self-attention (Beltagy et al., 2020) and global self-attention (Luong et al., 2015), with a pattern of 5 local layers for every global layer, starting with a local layer as the first layer of the model. 局部/全局层 5:1 交错.

我们在局部滑动窗口自注意力(local sliding window self-attention, Beltagy et al., 2020) 和全局自注意力(global self-attention, Luong et al., 2015) 之间交替, 模式为每 1 个全局层对应 5 个局部层, 模型的第一层为局部层. Long context. Gemma 3 models support context length of 128K tokens, with the exception of the 1B model that has 32K.

We increase RoPE base frequency from 10k to 1M on global self-attention layers, and keep the frequency of the local layers at 10k. We follow a process similar to the positional interpolation of Chen et al. (2023) to extend the span of the global self-attention layers.

长上下文. Gemma 3 模型支持 128K tokens 的上下文长度, 1B 模型例外, 其上下文为 32K. 我们在全局自注意力层上将 RoPE (Rotary Position Embedding, 旋转位置编码) 的基准频率从 10k 提升到 1M, 而局部层的频率保持在 10k. 我们遵循与 Chen et al. (2023) 的位置插值(positional interpolation) 类似的过程来扩展全局自注意力层的跨度.

### 2.1. Vision modality

### 2.1. 视觉模态

Vision encoder. We use a 400M variant of the SigLIP encoder (Zhai et al., 2023), a Vision Transformer (Dosovitskiy, 2020) trained with a variation of the CLIP loss (Radford et al., 2021). The Gemma vision encoder takes as input square images resized to 896 x 896, and is finetuned on data from visual assistant tasks. For simplicity, we share the vision encoder across our 4B, 12B, and 27B models, keeping it frozen during training. 视觉编码器. 我们使用 SigLIP 编码器 (Zhai et al., 2023) 的 400M 变体, 这是一个使用 CLIP loss (Radford et al., 2021) 变体训练的 Vision Transformer (Dosovitskiy, 2020). Gemma 视觉编码器接收调整为 896 x 896 的正方形图像作为输入, 并在视觉助手任务的数据上进行微调.

为简化起见, 我们在 4B, 12B 和 27B 模型之间共享同一个视觉编码器, 并在训练期间保持其冻结. Pan & Scan (P&S).

The Gemma vision encoder operates at a fixed resolution of 896 x 896. This results in artifacts when processing non-square aspect ratios and high-resolution images, leading to unreadable text, or small objects disappearing. We address this issue with an adaptive windowing algorithm during inference. This algorithm segments images into non-overlapping crops of equal size, covering the whole image, and resize them to 896x896 pixels to pass them to the encoder. This windowing is applied only when necessary, and control for the maximum number of crops. It is an inference-time only optimization and can be disabled for faster inference. Pan & Scan (P&S). Gemma 视觉编码器以固定的 896 x 896 分辨率运行.

这在处理非正方形宽高比和高分辨率图像时会产生伪影, 导致文本无法识别或小物体消失. 我们通过推理期间的自适应窗口化算法来解决这一问题. 该算法将图像分割为等大小的非重叠裁剪块, 覆盖整个图像, 并将其调整为 896x896 像素后送入编码器. 这种窗口化仅在必要时应用, 并控制最大裁剪数量. 这是一种仅用于推理时的优化, 可以禁用以获得更快的推理速度. ---

| Model | Type | #Chips | Data | Se.

| Replica |
|-------|------|--------|------|------|---------|
| 1B | TPUv5e | 512 | 16 | 16 | 2 |
| 4B | TPUv5e | 2048 | 16 | 16 | 8 |
| 12B | TPUv4 | 6144 | 16 | 16 | 24 |
| 27B | TPUv5p | 6144 | 24 | 8 | 32 |

Table 2 | Training infrastructure with sharding by data, sequence (Seq.), and replic.

| 模型 | 类型 | 芯片数量 | 数据分片 | 序列分片 | 副本数 |
|------|------|---------|---------|---------|--------|
| 1B | TPUv5e | 512 | 16 | 16 | 2 |
| 4B | TPUv5e | 2048 | 16 | 16 | 8 |
| 12B | TPUv4 | 6144 | 16 | 16 | 24 |
| 27B | TPUv5p | 6144 | 24 | 8 | 32 |

> 表 2: 训练基础设施配置, 按数据, 序列(Seq.)和副本进行分片.

### 2.2. Pre-training

### 2.2. 预训练

We follow a similar recipe as in Gemma 2 for pre-training with knowledge distillation. 我们在预训练中遵循与 Gemma 2 类似的配方, 并结合知识蒸馏. Training data. We pre-train our models on a slightly larger token budget than Gemma 2, i.e., we train on 14T tokens for Gemma 3 27B, 12T for the 12B version, 4T for the 4B, and 2T tokens for the 1B. The increase in tokens accounts for the mix of images and text used during pre-training. We also increase the amount of multilingual data to improve language coverage. We add both monolingual and parallel data, and we handle the imbalance in language representation using a strategy inspired by Chung et al. (2023). 训练数据. 我们在略大于 Gemma 2 的 token 预算上预训练模型, 即 Gemma 3 27B 训练了 14T tokens, 12B 版本训练了 12T, 4B 训练了 4T, 1B 训练了 2T tokens. Token 量的增加考虑了预训练期间使用的图像和文本混合. 我们还增加了多语言数据的数量以提升语言覆盖范围. 我们同时添加了单语数据和并行数据, 并使用受 Chung et al. (2023) 启发的策略来处理语言表示不均衡的问题. Tokenizer. We use the same tokenizer as Gemini 2.0: a SentencePiece tokenizer with split digits, preserved whitespace, and byte-level encodings (Kudo and Richardson, 2018). The resulting vocabulary has 262k entries. This tokenizer is more balanced for non-English languages. Tokenizer.

我们使用与 Gemini 2.0 相同的 tokenizer: 一个带有数字拆分, 保留空白符和字节级编码的 SentencePiece tokenizer (Kudo and Richardson, 2018). resulting 词表有 262k 个条目. 这个 tokenizer 对非英语语言更加均衡. Filtering.

We use filtering techniques that reduce the risk of unwanted or unsafe utterances and remove certain personal information and other sensitive data. We decontaminate evaluation sets from our pre-training data mixture, and reduce the risk of recitation by minimizing the proliferation of sensitive outputs. We also apply a quality reweighing step inspired by Sachdeva et al. (2024) to reduce occurrences of low quality data. 过滤. 我们使用过滤技术来降低产生不良或不安全内容的风险, 并移除某些个人信息和其他敏感数据.

我们对预训练数据混合中的评测集进行去污染(decontaminate)处理, 并通过最小化敏感输出的扩散来降低复述(recitation)风险. 我们还应用了受 Sachdeva et al. (2024) 启发的质量重加权步骤, 以减少低质量数据的出现. Distillation.

We sample 256 logits per token, weighted by teacher probabilities. The student learns the teacher's distribution within these samples via cross-entropy loss. The teacher's target distribution is set to zero probability for non-sampled logits, and renormalized.

蒸馏. 我们对每个 token 采样 256 个 logits, 并按教师模型的概率进行加权. 学生模型通过这些样本以交叉熵损失学习教师模型的分布. 对于未被采样的 logits, 教师目标分布的概率被设为零, 然后重新归一化.

> 译者注: 这里的蒸馏细节值得深入理解. 与标准的硬标签蒸馏或完整 softmax 蒸馏不同, Gemma 3 采用的是"稀疏采样蒸馏": 仅对 top-256 的 logits 进行监督, 而非完整的词表(262k). 这种做法的动机在于: 教师模型在长尾词汇上的概率分布往往是噪声主导的, 强制学生学习这些低概率区域会浪费容量. 通过将非采样 logits 的概率设为零并重新归一化, 教师分布被截断为一个更干净的信号. 但代价是: 如果教师模型在长尾区域有真正有用的知识, 这种截断会造成信息损失. 从工程角度看, 256 维的蒸馏比 262k 维的完整蒸馏在通信带宽和内存占用上都有显著优势, 尤其适合大规模分布式训.





| Model | Raw bf16 (GB) | Int4 (GB) | Int4blocks=32 (GB) | SFP8 (GB) | +KV bf16 (GB) | +KV Int4 (GB) | +KV Int4blocks=32 (GB) | +KV SFP8 (GB) |
|-------|---------------|-----------|--------------------|-----------|---------------|-------------|------------------------|---------------|
| 1B | 2.0 | 0.5 | 0.7 | 1.0 | 2.9 | 1.4 | 1.6 | 1.9 |
| 4B | 8.0 | 2.6 | 2.9 | 4.4 | 12.7 | 7.3 | 7.6 | 9.1 |
| 12B | 24.0 | 6.6 | 7.1 | 12.4 | 38.9 | 21.5 | 22.0 | 27.3 |
| 27B | 54.0 | 14.1 | 15.3 | 27.4 | 72.7 | 32.8 | 34.0 | 46.1 |

Table 3
| Memory footprints (in GB) comparison between raw (bfloat16) and quantized checkpoints for weights and KV caching (+KV) at 32,768 context size, quantized in 8 bit.

| 模型 | 原始 bf16 (GB) | Int4 (GB) | Int4blocks=32 (GB) | SFP8 (GB) | +KV bf16 (GB) | +KV Int4 (GB) | +KV Int4blocks=32 (GB) | +KV SFP8 (GB) |
|------|---------------|-----------|--------------------|-----------|---------------|-------------|------------------------|---------------|
| 1B | 2.0 | 0.5 | 0.7 | 1.0 | 2.9 | 1.4 | 1.6 | 1.9 |
| 4B | 8.0 | 2.6 | 2.9 | 4.4 | 12.7 | 7.3 | 7.6 | 9.1 |
| 12B | 24.0 | 6.6 | 7.1 | 12.4 | 38.9 | 21.5 | 22.0 | 27.3 |
| 27B | 54.0 | 14.1 | 15.3 | 27.4 | 72.7 | 32.8 | 34.0 | 46.1 |

> 表 3: 原始(bfloat16)和量化检查点的内存占用(GB)对比, 包含权重和 KV Cache (+KV), 上下文大小为 32,768, 以 8 位量化.

### 2.3. Quantization Aware Training

### 2.3. 量化感知训练

Along with the raw checkpoints, we also provide quantized versions of our models in different standard formats. These versions are obtained by fine-tuning each model for a small number of steps, typically 5,000, using Quantization Aware Training (QAT) (Jacob et al., 2018). We use probabilities from the non-quantized checkpoint as targets, and adapt the data to match the pre-training and post-training distributions. Based on the most popular open source quantization inference engines (e.g. llama.cpp), we focus on three weight representations: per-channel int4, per-block int4, and switched fp8. In Table 3, we report the memory filled by raw and quantized models for each weight representation with and without a KV-cache for a sequence of 32k tokens.

除了原始检查点之外, 我们还提供了不同标准格式下的量化版本模型. 这些版本是通过对每个模型进行少量步骤(通常为 5,000 步)的微调来获得的, 使用 Quantization Aware Training (QAT, 量化感知训练, Jacob et al., 2018). 我们以非量化检查点的概率作为目标, 并调整数据以匹配预训练和后训练的分布. 基于最流行的开源量化推理引擎(例如 llama.cpp), 我们聚焦于三种权重表示方式: per-channel int4, per-block int4 和 switched fp8. 在表 3 中, 我们报告了原始模型和量化模型在每种权重表示下的内存占用, 包含和不包含 32k token 序列的 KV Cache.

> 译者注: QAT 在这里的部署价值非常明确. 原始 bf16 的 27B 模型在 32K 上下文下需要 72.7 GB 内存, 这已经超出了大多数消费级 GPU 的显存容量. 通过 QAT 压缩到 Int4 后, 内存需求降至 32.8 GB, 这使得单卡 A100 40GB 部署成为可能. 值得注意的是, Gemma 3 的 QAT 不是简单的静态量化, 而是在预训练和后训练分布上进行了 5,000 步的微调恢复, 这对保持量化后的质量至关重要. 从工程落地角度看, 官方直接提供 QAT 检查点意味着用户不需要自己进行复杂的后训练量化调优, 显著降低了部署门槛.

### 2.4. Compute Infrastructure

### 2.4. 计算基础设施

We train our models with TPUv4, TPUv5e, and TPUv5p as outlined in Table 2. Each model configuration is optimized to minimize training step time. For the vision encoder, we pre-compute the embeddings for each image and directly train with the embeddings, adding no cost to the training of the language models. 我们使用 TPUv4, TPUv5e 和 TPUv5p 训练模型, 具体配置如表 2 所述.

每种模型配置都经过优化以最小化训练步时间. 对于视觉编码器, 我们预先计算每张图像的嵌入, 并直接使用嵌入进行训练, 不会增加语言模型训练的成本.

The optimizer state is sharded using an implementation of ZeRO-3 (Ren et al., 2021). For multi-pod training, we perform a data replica reduction over the data center network, using the Pathways approach of Barham et al. (2022). We use the 'single controller' programming paradigm of Jax (Roberts et al., 2023) and Pathways (Barham et al., 2022), along with the GSPMD partitioner (Xu et al., 2021) and the MegaScale XLA compiler (XLA, 2019).

优化器状态使用 ZeRO-3 (Ren et al., 2021) 的实现进行分片. 对于多 pod 训练, 我们通过数据中心网络执行数据副本归约(data replica reduction), 使用 Barham et al. (2022) 的 Pathways 方法. 我们使用 Jax (Roberts et al., 2023) 和 Pathways (Barham et al., 2022) 的"单一控制器"编程范式, 以及 GSPMD 分区器 (Xu et al., 2021) 和 MegaScale XLA 编译器 (XLA, 2019). ---

| Context | Formatting |
|---------|-----------|
| User turn | <start_of_turn>user |
| Model turn | <start_of_turn>model |
| End of turn | <end_of_turn> |

Example of discussion: User: Who are you? Model: My name is Gemma! User: What is 2+2? Model: 2+2=4. Model input: [BOS]<start_of_turn>user

Who are you?<end_of_turn>

<start_of_turn>model

My name is Gemma!<end_of_turn>

<start_of_turn>user

What is 2+2?<end_of_turn>

<start_of_turn>model

Model output: 2+2=4.<end_of_turn>

Table 4
| Formatting for Gemma IT models. Explicitly add the [BOS] token after tokenization, or use the add_bos=True option in the tokenizer. Do not tokenize the text "[BOS].

| 上下文 | 格式 |
|--------|------|
| User turn | <start_of_turn>user |
| Model turn | <start_of_turn>model |
| End of turn | <end_of_turn> |

对话示例: User: Who are you? Model: My name is Gemma! User: What is 2+2? Model: 2+2=4. 模型输入: [BOS]<start_of_turn>user

Who are you?<end_of_turn>

<start_of_turn>model

My name is Gemma!<end_of_turn>

<start_of_turn>user

What is 2+2?<end_of_turn>

<start_of_turn>model

模型输出: 2+2=4.<end_of_turn>

> 表 4: Gemma IT 模型的格式规范. 在 tokenization 之后显式添加 [BOS] token, 或在 tokenizer 中使用 add_bos=True 选项. 不要对文本 "[BOS]" 进行 tokenize.

## 3. Instruction-Tuning

## 3. 指令微调

Pre-trained models are turned into instruction-tuned models with an improved post-training approach compared to our prior recipe (see Table 6). 与先前的配方相比, 预训练模型通过改进的后训练方法转化为指令微调模型(见表 6). Techniques. Our post-training approach relies on an improved version of knowledge distillation (Agarwal et al., 2024; Anil et al., 2018; Hinton et al., 2015) from a large IT teacher, along with a RL finetuning phase based on improved versions of BOND (Sessa et al., 2024), WARM (Rame et al., 2024b), and WARP (Rame et al., 2024a).

技术方法. 我们的后训练方法依赖于改进版的知识蒸馏 (Agarwal et al., 2024; Anil et al., 2018; Hinton et al., 2015), 从一个大型 IT 教师模型进行蒸馏, 并配合一个基于改进版 BOND (Sessa et al., 2024), WARM (Rame et al., 2024b) 和 WARP (Rame et al., 2024a) 的 RL 微调阶段.

> 译者注: Gemma 3 的后训练配方融合了 Google DeepMind 近期多项内部研究成果. BOND (Best-of-N Distillation) 将 Best-of-N 采样与蒸馏结合, 让学生模型直接学习经过筛选的高质量输出分布; WARM (Weight Averaged Reward Models) 通过对多个奖励模型的权重进行平均来降低单一奖励模型的过拟合风险; WARP (Weight Averaged Rewarded Policies) 则是在策略层面进行权重平均. 三者的组合意味着 Gemma 3 的后训练不仅使用了蒸馏来传递教师模型的知识, 还通过多目标 RL 来对齐人类偏好和安全策略. 这种多层级的后训练管线与 OpenAI 的 InstructGPT 和 DeepSeek 的 RL  pipeline 在理念上类似, 但具体技术选型反映了 Google 内部的研发路线. Reinforcement learning objectives. We use a variety of reward functions to improve helpfulness, math, coding, reasoning, instruction-following, and multilingual abilities, while minimizing model harmfulness. This includes learning from weight averaged reward models (Rame et al., 2024b) trained with human feedback data, code execution feedback (Gehring et al., 2024), and ground-truth rewards for solving math problems (DeepSeek-AI, 2025; Lambert et al., 2024). 强化学习目标. 我们使用多种奖励函数来提升有用性, 数学, 编程, 推理, 指令遵循和多语言能力, 同时最小化模型的有害性. 这包括从使用人类反馈数据训练的权重平均奖励模型 (Rame et al., 2024b) 中学习, 从代码执行反馈 (Gehring et al., 2024) 中学习, 以及从解决数学问题的真实答案奖励中学习 (DeepSeek-AI, 2025; Lambert et al., 2024). Data filtering. We carefully optimize the data used in post-training to maximize model performance. We filter examples that show certain personal information, unsafe or toxic model outputs, mistaken self-identification data, and duplicated examples. Including subsets of data that encourage better in-context attribution, hedging, and refusals to minimize hallucinations also improves performance on factuality metrics, without degrading model performance on other metrics. 数据过滤. 我们仔细优化后训练中使用的数据以最大化模型性能. 我们过滤掉包含某些个人信息, 不安全或有毒模型输出, 错误自我识别数据以及重复样本的示例. 纳入鼓励更好的上下文归因(context attribution), 模糊表述(hedging)和拒绝回答(refusals)的数据子集以减少幻觉, 这也能提升事实性指标上的性能, 而不会降低模型在其他指标上的表现. [BOS] token. For both PT and IT models, text starts with a [BOS] token, that needs to be added explicitly since the text "[BOS]" does not map to the [BOS] token. For instance, Flax has an option, add_bos=True, to add this token automatically when tokenizing. An example of the formatting for an IT model is shown in Table 4, [BOS] token. 对于 PT 和 IT 模型, 文本都以 [BOS] token 开头, 需要显式添加, 因为文本 "[BOS]" 不会映射到 [BOS] token. 例如, Flax 有一个 add_bos=True 选项, 可以在 tokenization 时自动添加该 token. IT 模型的格式示例如表 4 所示. PT versus IT Formatting. All models share the same tokenizer, with some control tokens dedicated to IT formatting. A key difference is that PT models output a <eos> token at the end of generation, while IT models output a <end_of_turn> at the end of the generation, as shown for IT in Table 4. Fine-tuning either model type thus also requires adding their respective end tokens. PT 与 IT 的格式差异. 所有模型共享同一个 tokenizer, 但有一些控制 token 专门用于 IT 格式. 一个关键区别是, PT 模型在生成结束时输出 <eos> token, 而 IT 模型在生成结束时输出 <end_of_turn>, 如表 4 中 IT 所示. 因此, 对任一种模型类型进行微调都需要添加其对应的结束 token.

## 4. Evaluation of final models

## 4. 最终模型评估

### 4.1. LMSYS Chatbot Arena

In this section, we report the performance of our IT 27B model on LMSys Chatbot Arena (Chiang et al., 2024) in blind side-by-side evaluations by human raters against other state-of-the-art models. We report Elo scores in Table 5.

在本节中, 我们报告 IT 27B 模型在 LMSys Chatbot Arena (Chiang et al., 2024) 上的表现, 通过人类评分员与其他最先进模型进行盲测的并排对比评估. 我们在表 5 中报告 Elo 分数.

---

| Rank | Model | Elo | 95% CI | Open | Type | #params/#activated |
|------|-------|-----|--------|------|------|-------------------|
| 1 | Grok-3-Preview-02-24 | 1412 | +8/-10 | - | - | - |
| 1 | GPT-4.5-Preview | 1411 | +11/-11 | - | - | - |
| 3 | Gemini-2.0-Flash-Thinking-Exp-01-21 | 1384 | +6/-5 | - | - | - |
| 3 | Gemini-2.0-Pro-Exp-02-05 | 1380 | +5/-6 | - | - | - |
| 3 | ChatGPT-4o-latest (2025-01-29) | 1377 | +5/-4 | - | - | - |
| 6 | DeepSeek-R1 | 1363 | +8/-6 | yes | MoE | 671B/37B |
| 6 | Gemini-2.0-Flash-001 | 1357 | +6/-5 | - | - | - |
| 8 | o1-2024-12-17 | 1352 | +4/-6 | - | - | - |
| 9 | Gemma-3-27B-IT | 1338 | +8/-9 | yes | Dense | 27B |
| 9 | Qwen2.5-Max | 1336 | +7/-5 | - | - | - |
| 9 | o1-preview | 1335 | +4/-3 | - | - | - |
| 9 | o3-mini-high | 1329 | +8/-6 | - | - | - |
| 13 | DeepSeek-V3 | 1318 | +8/-6 | yes | MoE | 671B/37B |
| 14 | GLM-4-Plus-0111 | 1311 | +8/-8 | - | - | - |
| 14 | Qwen-Plus-0125 | 1310 | +7/-5 | - | - | - |
| 14 | Claude 3.7 Sonnet | 1309 | +9/-11 | - | - | - |
| 14 | Gemini-2.0-Flash-Lite | 1308 | +5/-5 | - | - | - |
| 18 | Step-2-16K-Exp | 1305 | +7/-6 | - | - | - |
| 18 | o3-mini | 1304 | +5/-4 | - | - | - |
| 18 | o1-mini | 1304 | +4/-3 | - | - | - |
| 18 | Gemini-1.5-Pro-002 | 1302 | +3/-3 | - | - | - |
| ... | ... | ... | ... | ... | ... | ... |
| 28 | Meta-Llama-3.1-405B-Instruct-bf16 | 1269 | +4/-3 | yes | Dense | 405B |
| ... | ... | ... | ... | ... | ... | ... |
| 38 | Llama-3.3-70B-Instruct | 1257 | +5/-3 | yes | Dense | 70B |
| ... | ... | ... | ... | ... | ... | ... |
| 39 | Qwen2.5-72B-Instruct | 1257 | +3/-3 | yes | Dense | 72B |
| ... | ... | ... | ... | ... | ... | ... |
| 59 | Gemma-2-27B-it | 1220 | +3/-2 | yes | Dense | 27B |

> **Table 5**：Gemma 3 27B IT 模型在 Chatbot Arena (Chiang et al., 2024) 中的评估结果。所有模型均通过人类评分员进行盲测并排对比评估。每个模型根据 Elo 评分系统获得分数。Gemma-3-27B-IT 的数据为 2025 年 3 月 8 日收到的初步结果。

| 排名 | 模型 | Elo | 95% 置信区间 | 开源 | 类型 | 参数量/激活参数 |
|------|------|-----|-------------|------|------|---------------|
| 1 | Grok-3-Preview-02-24 | 1412 | +8/-10 | - | - | - |
| 1 | GPT-4.5-Preview | 1411 | +11/-11 | - | - | - |
| 3 | Gemini-2.0-Flash-Thinking-Exp-01-21 | 1384 | +6/-5 | - | - | - |
| 3 | Gemini-2.0-Pro-Exp-02-05 | 1380 | +5/-6 | - | - | - |
| 3 | ChatGPT-4o-latest (2025-01-29) | 1377 | +5/-4 | - | - | - |
| 6 | DeepSeek-R1 | 1363 | +8/-6 | yes | MoE | 671B/37B |
| 6 | Gemini-2.0-Flash-001 | 1357 | +6/-5 | - | - | - |
| 8 | o1-2024-12-17 | 1352 | +4/-6 | - | - | - |
| 9 | Gemma-3-27B-IT | 1338 | +8/-9 | yes | Dense | 27B |
| 9 | Qwen2.5-Max | 1336 | +7/-5 | - | - | - |
| 9 | o1-preview | 1335 | +4/-3 | - | - | - |
| 9 | o3-mini-high | 1329 | +8/-6 | - | - | - |
| 13 | DeepSeek-V3 | 1318 | +8/-6 | yes | MoE | 671B/37B |
| 14 | GLM-4-Plus-0111 | 1311 | +8/-8 | - | - | - |
| 14 | Qwen-Plus-0125 | 1310 | +7/-5 | - | - | - |
| 14 | Claude 3.7 Sonnet | 1309 | +9/-11 | - | - | - |
| 14 | Gemini-2.0-Flash-Lite | 1308 | +5/-5 | - | - | - |
| 18 | Step-2-16K-Exp | 1305 | +7/-6 | - | - | - |
| 18 | o3-mini | 1304 | +5/-4 | - | - | - |
| 18 | o1-mini | 1304 | +4/-3 | - | - | - |
| 18 | Gemini-1.5-Pro-002 | 1302 | +3/-3 | - | - | - |
| ... | ... | ... | ... | ... | ... | ... |
| 28 | Meta-Llama-3.1-405B-Instruct-bf16 | 1269 | +4/-3 | yes | Dense | 405B |
| ... | ... | ... | ... | ... | ... | ... |
| 38 | Llama-3.3-70B-Instruct | 1257 | +5/-3 | yes | Dense | 70B |
| ... | ... | ... | ... | ... | ... | ... |
| 39 | Qwen2.5-72B-Instruct | 1257 | +3/-3 | yes | Dense | 72B |
| ... | ... | ... | ... | ... | ... | ... |
| 59 | Gemma-2-27B-it | 1220 | +3/-2 | yes | Dense | 27B |

> 表 5: Gemma 3 27B IT 模型在 Chatbot Arena (Chiang et al., 2024) 中的评估. 所有模型均通过人类评分员进行盲测并排对比评估. 每个模型根据 Elo 评分系统获得一个分数. Gemma-3-27B-IT 的数据为 2025 年 3 月 8 日收到的初步结果. IT (1338) is among the top 10 best models, with a score above other non-thinking open models, such as DeepSeek-V3 (1318), LLaMA 3 405B (1257), and Qwen2.5-70B (1257), which are much larger models. Finally, the Elo of Gemma 3 is significantly higher than Gemma 2, at 1220. Note that Elo scores do not take into account visual abilities, which none of the aforementioned models have. IT (1338) 位列前 10 最佳模型之一, 分数高于其他非思考型(non-thinking)开源模型, 例如 DeepSeek-V3 (1318), LLaMA 3 405B (1257) 和 Qwen2.5-70B (1257), 而这些都是规模大得多的模型. 最后, Gemma 3 的 Elo 显著高于 Gemma 2 的 1220.

需要注意的是, Elo 分数没有考虑视觉能力, 而上述模型均不具备该能力.

> 译者注: Chatbot Arena 的 Elo 分数需要谨慎解读. 第一, Gemma-3-27B-IT 的数据标注为"preliminary results received on March 8, 2025", 这意味着分数可能基于较小的样本量, 置信区间(+8/-9)相对较宽. 第二, Elo 评分是一个相对排名系统, 受参与对比的模型池影响较大 - 如果某个时间段内有大量新模型上线, 所有模型的绝对 Elo 都可能发生漂移. 第三, 正如原文所注, Elo 不评估视觉能力, 而 Gemma 3 是多模态模型, 这实际上是它的一个独特优势, 但在 Arena 的纯文本对话评分中无法体现. 第四, 与 DeepSeek-V3 (671B/37B MoE) 和 Llama-3.1-405B 等巨型模型相比, Gemma 3 27B 作为 Dense 模型取得相近的 Elo, 确实体现了其效率优势.

### 4.2. Standard benchmarks

### 4.2. 标准基准测试

In Table 6, we show the performance of our final models across a variety of benchmarks compared to our previous model iteration, and Gemini 1.5. We do not compare directly with external models that often report their own evaluation settings, since running them in our setting does not guarantee a fair comparison. We encourage the reader to follow third-party static leaderboards for a fairer comparison across models. We include additional evaluations of our models on other benchmarks in the appendix.

在表 6 中, 我们展示了最终模型在多种基准测试上的表现, 并与前代模型迭代以及 Gemini 1.5 进行了对比. 我们不直接与外部模型进行比较, 因为这些模型通常报告它们自己的评测设置, 在我们的设置下运行它们无法保证公平对比. 我们建议读者参考第三方静态排行榜以获得更公平的跨模型对比. 我们在附录中包含了对模型在其他基准测试上的额外评估.

## 5. Ablations

## 5. 消融实验

In this section, we focus on the impact of our architecture changes, as well as some of the vision abilities new to this model.

在本节中, 我们聚焦于架构变更的影响, 以及该模型新增的一些视觉能力.

### 5.1. Pre-training ability probing

### 5.1. 预训练能力探针

We use several standard benchmarks as probes during pre-training to ensure our models capture general abilities, and in Figure 2, we compare the quality of pre-trained models from Gemma 2 and 3 across these general abilities, namely, science, code, factuality, multilinguality, reasoning, and vision. The details of the performance across the different public benchmarks used in these plots are summarized in the appendix. Overall, we see that the new versions improve in most categories, despite the addition of vision. We particularly focus on multilinguality in this version, and this directly impacts the quality of our models. However, despite the use of decontamination techniques, there is always a risk of contamination of these probes (Mirzadeh et al., 2024), making more definitive conclusions harder to assess.

我们在预训练期间使用多个标准基准测试作为探针(probes), 以确保模型掌握通用能力, 并在图 2 中对比了 Gemma 2 和 Gemma 3 的预训练模型在这些通用能力上的质量, 即科学, 编程, 事实性, 多语言性, 推理和视觉. 这些图表中使用的不同公开基准测试的性能细节在附录中汇总. 总体而言, 我们看到新版本在大多数类别上都有提升, 尽管增加了视觉能力. 我们在该版本中特别关注多语言性, 这直接影响了模型的质量. 然而, 尽管使用了去污染技术, 这些探针始终存在被污染的风险 (Mirzadeh et al., 2024), 这使得得出更明确的结论更加困难. ---

| Benchmark | Gemini 1.5 Flash | Gemini 1.5 Pro | Gemini 2.0 Flash | Gemini 2.0 Pro | Gemma 2 2B | Gemma 2 9B | Gemma 2 27B | Gemma 3 1B | Gemma 3 4B | Gemma 3 12B | Gemma 3 27B |
|-----------|------------------|----------------|------------------|----------------|------------|------------|-------------|------------|------------|-------------|-------------|
| MMLU-Pro | 67.3 | 75.8 | 77.6 | 79.1 | 15.6 | 46.8 | 56.9 | 14.7 | 43.6 | 60.6 | 67.5 |
| LiveCodeBench | 30.7 | 34.2 | 34.5 | 36.0 | 1.2 | 10.8 | 20.4 | 1.9 | 12.6 | 24.6 | 29.7 |
| Bird-SQL (dev) | 45.6 | 54.4 | 58.7 | 59.3 | 12.2 | 33.8 | 46.7 | 6.4 | 36.3 | 47.9 | 54.4 |
| GPQA Diamond | 51.0 | 59.1 | 60.1 | 64.7 | 24.7 | 28.8 | 34.3 | 19.2 | 30.8 | 40.9 | 42.4 |
| SimpleQA | 8.6 | 24.9 | 29.9 | 44.3 | 2.8 | 5.3 | 9.2 | 2.2 | 4.0 | 6.3 | 10.0 |
| FACTS Grounding | 82.9 | 80.0 | 84.6 | 82.8 | 43.8 | 62.0 | 62.4 | 36.4 | 70.1 | 75.8 | 74.9 |
| Global MMLU-Lite | 73.7 | 80.8 | 83.4 | 86.5 | 41.9 | 64.8 | 68.6 | 34.2 | 54.5 | 69.5 | 75.1 |
| MATH | 77.9 | 86.5 | 90.9 | 91.8 | 27.2 | 49.4 | 55.6 | 48.0 | 75.6 | 83.8 | 89.0 |
| HiddenMath | 47.2 | 52.0 | 63.5 | 65.2 | 1.8 | 10.4 | 14.8 | 15.8 | 43.0 | 54.5 | 60.3 |
| MMMU (val) | 62.3 | 65.9 | 71.7 | 72.7 | - | - | - | - | 48.8 | 59.6 | 64.9 |

Table 6
| Performance of instruction fine-tuned (IT) models compared to Gemini 1.5, Gemini 2.0, and Gemma 2 on zero-shot benchmarks across different abilities. 

| 基准测试 | Gemini 1.5 Flash | Gemini 1.5 Pro | Gemini 2.0 Flash | Gemini 2.0 Pro | Gemma 2 2B | Gemma 2 9B | Gemma 2 27B | Gemma 3 1B | Gemma 3 4B | Gemma 3 12B | Gemma 3 27B |
|----------|------------------|----------------|------------------|----------------|------------|------------|-------------|------------|------------|-------------|-------------|
| MMLU-Pro | 67.3 | 75.8 | 77.6 | 79.1 | 15.6 | 46.8 | 56.9 | 14.7 | 43.6 | 60.6 | 67.5 |
| LiveCodeBench | 30.7 | 34.2 | 34.5 | 36.0 | 1.2 | 10.8 | 20.4 | 1.9 | 12.6 | 24.6 | 29.7 |
| Bird-SQL (dev) | 45.6 | 54.4 | 58.7 | 59.3 | 12.2 | 33.8 | 46.7 | 6.4 | 36.3 | 47.9 | 54.4 |
| GPQA Diamond | 51.0 | 59.1 | 60.1 | 64.7 | 24.7 | 28.8 | 34.3 | 19.2 | 30.8 | 40.9 | 42.4 |
| SimpleQA | 8.6 | 24.9 | 29.9 | 44.3 | 2.8 | 5.3 | 9.2 | 2.2 | 4.0 | 6.3 | 10.0 |
| FACTS Grounding | 82.9 | 80.0 | 84.6 | 82.8 | 43.8 | 62.0 | 62.4 | 36.4 | 70.1 | 75.8 | 74.9 |
| Global MMLU-Lite | 73.7 | 80.8 | 83.4 | 86.5 | 41.9 | 64.8 | 68.6 | 34.2 | 54.5 | 69.5 | 75.1 |
| MATH | 77.9 | 86.5 | 90.9 | 91.8 | 27.2 | 49.4 | 55.6 | 48.0 | 75.6 | 83.8 | 89.0 |
| HiddenMath | 47.2 | 52.0 | 63.5 | 65.2 | 1.8 | 10.4 | 14.8 | 15.8 | 43.0 | 54.5 | 60.3 |
| MMMU (val) | 62.3 | 65.9 | 71.7 | 72.7 | - | - | - | - | 48.8 | 59.6 | 64.9 |

> 表 6: 指令微调(IT)模型在不同能力上的 zero-shot 基准测试表现, 与 Gemini 1.5, Gemini 2.0 和 Gemma 2 的对比. Figure 2 | Summary of the performance of different pre-trained models from Gemma 2 and 3 across general abilities. These plots are meant to give a simplified summary and details are in the appendix. > 图 2: Gemma 2 和 Gemma 3 不同预训练模型在通用能力上的表现汇总.

这些图表旨在提供简化概述, 细节见附录. 这些图表旨在提供简化概述, 细节见附录.

### 5.2. 局部:全局注意力层

We measure the impact of changes to local and global self-attention layers on performance and memory consumption during inference. 我们测量局部和全局自注意力层的变更对推理期间性能和内存消耗的影响. Local:Global ratio. In Fig. 3, we compare different ratios of local to global attention layers. 1:1 is used in Gemma 2 models, and 5:1 is used in Gemma 3. We observe minimal impact on perplexity when changing this ratio.

局部:全局比例. 在图 3 中, 我们比较了局部注意力层与全局注意力层的不同比例.

Gemma 2 模型使用 1:1, Gemma 3 使用 5:1.

我们观察到改变这一比例对 perplexity 的影响微乎其微.

> 译者注: 这个消融实验的结果非常关键. 图 3 显示, 即使将局部:全局比例从 1:1 提升到 7:1, perplexity 的变化仍然极小. 这意味着局部注意力层可以在不显著损害模型质量的前提下, 大幅减少 KV Cache 的内存占用. 从工程角度看, 这是一个非常实用的发现: 它允许模型设计者在固定参数预算下, 通过增加局部层数量来"免费"获得更长的上下文支持. 但需要注意的是, 该消融实验是在纯文本模型上进行的, 多模态场景下局部注意力对跨模态长距离依赖的影响尚未被充分验证. Sliding window size. In Fig. 4, we compare different sliding window sizes for the local attention layers in different global:local ratio configurations. The sliding window can be reduced significantly without impacting perplexity. 滑动窗口大小. 在图 4 中, 我们在不同的全局:局部比例配置下比较了局部注意力层的不同滑动窗口大小. 滑动窗口可以显著缩小而不会影响 perplexity. ---

Impact on KV cache memory. In Fig. 5, we show the balance between the memory used by the model and the KV cache during inference with a context of 32k tokens. The "global only" configuration is the standard configuration used across most dense models. The "1:1, sw=4096" is used in Gemma 2. We observe that the "global only" configuration results in a memory overhead of 60%, while this is reduced to less than 15% with 1:3 and sliding windows of 1024 ("sw=1024"). In Fig. 6, we compute the memory used by the KV cache as a function of the context length with either our 2B architecture (L:G=5:1, sw=1024) versus a "global only" 2B model. KV Cache 内存影响. 在图 5 中, 我们展示了在 32k token 上下文推理期间, 模型本身和 KV Cache 之间的内存平衡. "global only" 配置是大多数 Dense 模型中使用的标准配置. "1:1, sw=4096" 在 Gemma 2 中使用. 我们观察到 "global only" 配置导致 60% 的内存开销, 而使用 1:3 和 1024 的滑动窗口("sw=1024")时, 这一开销降至 15% 以下.

在图 6 中, 我们计算了 KV Cache 的内存使用量随上下文长度的变化, 对比了我们的 2B 架构(L:G=5:1, sw=1024)与 "global only" 的 2B 模型. Figure 5 | Model versus KV cache memory during inference with a pre-fill KV cache of size 32k.

We consider a 2B model with different local to global ratios and sliding window sizes (sw). We compare to global only, which is the standard used in Gemma 1 and Llama. This ablation is run with a text-only model. > 图 5: 在 32k 预填充 KV Cache 推理期间的模型与 KV Cache 内存对比. 我们考虑了一个具有不同局部:全局比例和滑动窗口大小(sw)的 2B 模型. 我们与 global only 进行对比, 这是 Gemma 1 和 Llama 使用的标准配置.

该消融实验在纯文本模型上运行.

Figure 6 | KV cache memory versus context length. We show the memory usage of the KV cache for our architecture (L:G=5:1, sw=1024) and a transformer with global attention only - as used in LLaMa or Gemma 1. > 图 6: KV Cache 内存与上下文长度的关系.

我们展示了我们的架构(L:G=5:1, sw=1024)和仅使用全局注意力的 Transformer(如 LLaMA 或 Gemma 1 所用)的 KV Cache 内存使用量.

### 5.3. 实现长上下文

Instead of training with 128K sequences from scratch, we pre-train our models with 32K sequences and then scale the 4B, 12B, and 27B models up to 128K tokens at the end of pre-training while rescaling RoPE (Chen et al., 2023). We find a scaling factor of 8 to work well in practice. Note that compared to Gemma 2, we have also increased the RoPE base frequency of global self-attention layers from 10k to 1M, while keeping 10k for the local self-attention layers. In Figure 7, we show the impact on perplexity for different context lengths. Our models generalize to 128K, but rapidly degrade as we continue to scale.

我们没有从一开始就使用 128K 序列进行训练, 而是先用 32K 序列预训练模型, 然后在预训练结束时将 4B, 12B 和 27B 模型扩展到 128K tokens, 同时重新缩放 RoPE (Chen et al., 2023). 我们发现缩放因子为 8 在实际中效果良好. 需要注意的是, 与 Gemma 2 相比, 我们还将全局自注意力层的 RoPE 基准频率从 10k 增加到 1M, 而局部自注意力层保持在 10k. 在图 7 中, 我们展示了不同上下文长度对 perplexity 的影响. 我们的模型可以泛化到 128K, 但继续扩展后性能会迅速下降.

Figure 7 | Long context performance of pre-trained models before and after RoPE rescaling. > 图 7: 预训练模型在 RoPE 重新缩放前后的长上下文性能.

### 5.4. 小教师模型 vs 大教师模型

A common finding is that, to train a small model, it is preferable to distill from a smaller teacher. 一个常见的发现是, 为了训练一个小模型, 从较小的教师模型进行蒸馏更为可取. Figure 8 | Small versus large teacher. Relative difference of perplexity when using a small and large teacher as a function of the token size of training. Smaller numbers means distilling from a larger teacher is better. > 图 8: 小教师模型 vs 大教师模型. 使用小教师模型和大教师模型时 perplexity 的相对差异, 以训练 token 大小为函数.

数值越小表示从大教师模型蒸馏效果越好.

We suspect this is because these studies are often performed in settings where the regularization effect of using a worse teacher surpasses the benefit of using a better teacher. We train a student with 2 teachers of different sizes, one large and one small, for different training horizons. In Fig. 8, we observe that for short training horizons, the smaller teacher is better, but the trend is reversed for longer training.

我们怀疑这是因为这些研究通常是在使用较差教师模型的正则化效应超过使用更好教师模型收益的设定下进行的. 我们用两个不同规模的教师模型(一个大的和一个小的)以不同的训练时长训练学生模型. 在图 8 中, 我们观察到对于较短的训练时长, 较小的教师模型更好, 但对于较长的训练时长, 趋势发生了逆转.

> 译者注: 这个发现对蒸馏实践有重要指导意义. 传统观点认为小教师模型更适合蒸馏小模型, 因为容量差距较小, 学生更容易模仿. 但 Gemma 3 的实验表明, 在"短训练时长"和"长训练时长"之间存在一个拐点: 当训练充分时, 大教师模型提供的更丰富的信号分布反而能指导学生达到更好的收敛点. 这本质上是一个"正则化-信号质量"的权衡: 小教师模型的较弱信号起到了隐式正则化作用, 在数据有限时防止过拟合; 但当数据充足时, 大教师模型的高质量信号才是决定性因素. 对于 Gemma 3 这样使用 14T tokens 进行预训练的模型, 选择大教师模型(很可能是 Gemini 系列)进行蒸馏是合理的工程决策.

### 5.5. Vision encoder

### 5.5. 视觉编码器

| Resolution | DocVQA | InfoVQA | TextVQA |
|------------|--------|---------|---------|
| 256 | 31.9 | 23.1 | 44.1 |
| 448 | 45.4 | 31.6 | 53.5 |
| 896 | 59.8 | 33.7 | 58.0 |

Table 7
| Impact of image encoder input resolution. We measure performance using a short schedule 2B Gemma model on a few evaluation benchmarks to observe the effect of input image resolution on vision encoder pre-trainin.

| 分辨率 | DocVQA | InfoVQA | TextVQA |
|--------|--------|---------|---------|
| 256 | 31.9 | 23.1 | 44.1 |
| 448 | 45.4 | 31.6 | 53.5 |
| 896 | 59.8 | 33.7 | 58.0 |

> 表 7: 图像编码器输入分辨率的影响. 我们使用短训练周期的 2B Gemma 模型在一些评测基准上测量性能, 以观察输入图像分辨率对视觉编码器预训练的影响. Impact of image resolution. We use a vision encoder based on SigLIP (Zhai et al., 2023). The vision encoder is frozen, and only the language model is trained. Each image in this multimodal data is represented by 256 image tokens from the respective vision encoder. The higher resolution encoders thus use average pooling to reduce their output to 256 tokens. For instance, the 896 resolution encoder has a 4x4 average pooling on its output. As shown in Table 7, higher resolution encoders perform better than smaller ones.

图像分辨率的影响. 我们使用基于 SigLIP (Zhai et al., 2023) 的视觉编码器. 视觉编码器是冻结的, 只有语言模型被训练. 该多模态数据中的每张图像由相应视觉编码器的 256 个图像 token 表示. 因此更高分辨率的编码器使用平均池化(average pooling)将其输出降至 256 个 token. 例如, 896 分辨率编码器在其输出上执行 4x4 平均池化. 如表 7 所示, 更高分辨率的编码器表现优于较低分辨率的编码器.

| | DocVQA | InfoVQA | TextVQA |
|---|--------|---------|---------|
| 4B | 72.8 | 44.1 | 58.9 |
| 4B w/ P&S | 81.0 | 57.0 | 60.8 |
| Delta | (+8.2) | (+12.9) | (+1.9) |
| 27B | 85.6 | 59.4 | 68.6 |
| 27B w/ P&S | 90.4 | 76.4 | 70.2 |
| Delta | (+4.8) | (+17.0) | (+1.6) |

Table 8
| Impact of P&S. 4-shot evaluation results on the valid set, with and without P&S on a pre-trained checkpoint. Boosts are on tasks associated with images with varying aspect ratios, or involving reading text on image.

| | DocVQA | InfoVQA | TextVQA |
|---|--------|---------|---------|
| 4B | 72.8 | 44.1 | 58.9 |
| 4B w/ P&S | 81.0 | 57.0 | 60.8 |
| 提升 | (+8.2) | (+12.9) | (+1.9) |
| 27B | 85.6 | 59.4 | 68.6 |
| 27B w/ P&S | 90.4 | 76.4 | 70.2 |
| 提升 | (+4.8) | (+17.0) | (+1.6) |


> 表 8: P&S 的影响. 在预训练检查点上使用和不使用 P&S 的 valid 集 4-shot 评估结果. 提升主要体现在与不同宽高比图像相关的任务, 或涉及读取图像上文本的任务. Pan & Scan. P&S enables capturing images at close to their native aspect ratio and image resolution. In Table 8, we compare our 27B IT model with and without P&S. As expected, the ability to treat images with close to native resolution greatly helps with tasks that require some form of reading text on images, which is particularly important for visual language models. Pan & Scan. P&S 能够以接近原始宽高比和图像分辨率的方式捕获图像. 在表 8 中, 我们对比了使用和不使用 P&S 的 27B IT 模型.

正如预期的那样, 以接近原始分辨率处理图像的能力极大地帮助了需要以某种形式读取图像上文本的任务, 这对视觉语言模型尤为重要.

## 6. 记忆化与隐私

Large language models may produce near-copies of some text used in training (Biderman et al., 2023; Carlini et al., 2021, 2022; Ippolito et al., 2022; Nasr et al., 2023). Several prior reports have released audits that quantify this risk by measuring the memorization rate (Anil et al., 2023; Chowdhery et al., 2022; Gemini Team, 2023, 2024; Gemma Team, 2024a,b; LLaMa Team, 2024). This "memorization rate"1 is defined as the ratio of generations from the model that match its training data compared to all model generations using the following setup. We follow the methodology described in Gemma Team (2024b) to measure it. Specifically, we subsample a large portion of training data distributed uniformly across different corpora and test for discoverable extraction (Nasr et al., 2023) of this content using a prefix of length 50 and a suffix of length 50. We denote text as either "exactly memorized" if all tokens in the continuation match the source suffix or "approximately memorized" if they match up to an edit distance of 10%.

大型语言模型可能会生成训练中使用过的某些文本的近副本 (Biderman et al., 2023; Carlini et al., 2021, 2022; Ippolito et al., 2022; Nasr et al., 2023). 之前的几份报告发布了审计结果, 通过测量记忆化率(memorization rate)来量化这一风险 (Anil et al., 2023; Chowdhery et al., 2022; Gemini Team, 2023, 2024; Gemma Team, 2024a,b; LLaMa Team, 2024). 这个"记忆化率"1 定义为: 模型生成内容中与其训练数据匹配的部分占所有模型生成内容的比例, 使用以下设置进行测量. 我们遵循 Gemma Team (2024b) 中描述的方法论进行测量. 具体来说, 我们从均匀分布在不同语料库上的训练数据中抽取大量样本, 并使用长度为 50 的前缀和长度为 50 的后缀来测试该内容的可发现提取(discoverable extraction, Nasr et al., 2023). 如果续写中的所有 token 都与源后缀匹配, 我们将该文本标记为"精确记忆化"(exactly memorized); 如果它们最多在 10% 的编辑距离内匹配, 则标记为"近似记忆化"(approximately memorized). 1"We do not state or imply [here] that a model "contains" its training data in the sense that there is a copy of that data in the model.

Rather, a model memorizes attributes of its training data such that in certain cases it is statistically able to generate such training data when following rules and using information about features of its training data that it does contain."

1"我们并非在此声明或暗示模型以'模型中包含数据副本'的意义上'包含'其训练数据. 相反, 模型记忆的是其训练数据的属性, 使得在某些情况下, 当它遵循规则并使用其所包含的训练数据特征信息时, 能够在统计意义上生成这样的训练数据."

---

Figure 9 | Total memorization rates for both exact and approximate memorization. Gemma 3 models memorize significantly less than all prior models. *No results for approximate memorization on these models. > 图 9: 精确记忆化和近似记忆化的总记忆化率. Gemma 3 模型的记忆化显著低于所有先前模型.*这些模型没有近似记忆化的结果. Figure 9 compares the memorization rates across Gemma and Gemini models; these models are ordered in reverse chronological order, with the newest Gemma 3 models on the left. We find that Gemma 3 models memorize long-form text at a much lower rate than prior models (note the log y-axis). We observe only a marginal difference in the memorization rates between the 4B, 12B, and 27B models, with 1B memorizing less than these larger models. Further, we find that a larger proportion of text is characterized as approximately memorized, with a relative increase in approximate memorization compared to exact memorization of roughly 24x on average.

图 9 比较了 Gemma 和 Gemini 模型之间的记忆化率; 这些模型按逆时间顺序排列, 最新的 Gemma 3 模型位于最左侧. 我们发现 Gemma 3 模型以远低于先前模型的比率记忆长文本(注意对数 y 轴). 我们观察到 4B, 12B 和 27B 模型之间的记忆化率差异微乎其微, 1B 模型比这些更大的模型记忆得更少. 此外, 我们发现更大比例的文本被归类为近似记忆化, 近似记忆化相对于精确记忆化的相对增长平均约为 24 倍.

> 译者注: 图 9 的结果值得仔细解读. Gemma 3 的记忆化率显著低于前代模型, 这很可能归因于更激进的数据过滤和去重策略, 以及训练数据构成的变化. 但"精确记忆化"的绝对率仍然很低(在对数尺度上), 而"近似记忆化"高出约 24 倍, 这说明模型记住的是训练数据的"统计特征"而非逐字副本. 从隐私风险角度看, 精确记忆化才是真正危险的 - 它可能导致版权文本或个人信息的逐字泄露. 近似记忆化在日常生成中几乎无法避免, 因为语言模型本质上就是在学习数据的统计分布. 另一个值得注意的细节是: 1B 模型比 4B/12B/27B 记忆得更少, 这符合"容量限制导致记忆减少"的预期, 但 4B 到 27B 之间差异很小, 说明记忆化率可能在某个容量阈值后趋于饱和. We also study the rate at which the generations may contain personal information. To identify potentially personal information, we use the Google Cloud Sensitive Data Protection (SDP) service.2 SDP uses broad detection rules to identify text that may contain personal information. SDP is designed to have high recall and does not consider the context in which the information may appear, which leads to many false positives. Thus, we are likely overestimating the true amount of potentially personal information contained in the outputs classified as memorized. SDP also provides broad severity levels: low, medium, and high. We classify text as personal if SDP classifies it as personal information at any severity level. We observed no personal information in the outputs characterized as memorization for all Gemma 3 models. This indicates a low rate of personal data, below our detection thresholds, in outputs classified as memorization. 我们还研究了生成内容中包含个人信息的比率. 为了识别潜在个人信息, 我们使用了 Google Cloud Sensitive Data Protection (SDP) 服务2. SDP 使用广泛的检测规则来识别可能包含个人信息的文本. SDP 旨在保持高召回率, 不考虑信息可能出现的上下文, 这导致了许多误报. 因此, 我们可能高估了被归类为记忆化的输出中潜在个人信息的真正数量. SDP 还提供宽泛的严重程度等级: 低, 中, 高. 如果 SDP 在任何严重程度等级上将文本归类为个人信息, 我们就将其分类为个人信息. 我们在所有 Gemma 3 模型被归类为记忆化的输出中均未观察到个人信息. 这表明被归类为记忆化的输出中个人数据比率很低, 低于我们的检测阈值. 2<https://cloud.google.com/sensitive-data-protection>

## 7. Responsibility, Safety, Security

## 7. 责任, 安全与安保

Responsibility, safety, and security are of utmost importance in the development of Gemma models. To reduce risks to Gemma 3 users, we have continued to integrate enhanced internal safety processes that span the development workflow, in line with recent Google AI models (Gemini Team, 2024). This focuses on safety mitigation at training time, and robust and transparent model evaluations for the new image-to-text capabilities we have introduced.

责任, 安全和安保在 Gemma 模型的开发中至关重要. 为了降低 Gemma 3 用户的风险, 我们继续整合了贯穿开发工作流的增强内部安全流程, 这与近期 Google AI 模型 (Gemini Team, 2024) 的做法一致. 这聚焦于训练时的安全缓解措施, 以及对我们引入的新图像到文本能力进行稳健且透明的模型评估.

### 7.1. Governance & Assessment

### 7.1. 治理与评估

Our approach to assessing the benefits and risks of Gemma is reflective of that outlined for Gemma 1 (Gemma Team, 2024a), taking into account the changes in supported modalities. We continue to believe that openness in AI can spread the benefits of these technologies across society, but must be evaluated against the risk of malicious uses that can cause harm on both individual and institutional levels (Weidinger et al., 2021). Since the inaugural Gemma launch, we have seen these models drive a number of socially beneficial applications, such as our own ShieldGemma 2, a 4B image safety classifier built with Gemma 3, which provides a ready-made solution for image safety, outputting safety labels across dangerous content, sexually explicit, and violence categories. 我们评估 Gemma 的收益和风险的方法反映了为 Gemma 1 概述的方法 (Gemma Team, 2024a), 同时考虑了所支持模态的变化. 我们继续相信 AI 的开放性可以将这些技术的益处传播到整个社会, 但必须与可能造成个人和机构层面伤害的恶意使用风险进行权衡 (Weidinger et al., 2021).

自 Gemma 首次发布以来, 我们看到这些模型推动了许多对社会有益的应用, 例如我们自己的 ShieldGemma 2, 一个使用 Gemma 3 构建的 4B 图像安全分类器, 它为图像安全提供了现成的解决方案, 输出危险内容, 性暴力和暴力类别的安全标签.

Releasing Gemma 3 models required specific attention to changes in model capabilities and close monitoring of the evolving risks of existing multimodal LLMs (Lin et al., 2024), as well as an understanding of the ways in which models are being used in the wild. Although we are yet to receive any reports of malicious use for Gemma, we remain committed to investigating any such reporting, and work with the academic and developer communities, as well as conduct our own monitoring, to flag such cases.

发布 Gemma 3 模型需要对模型能力的变化给予特别关注, 并密切监测现有多模态 LLM 的不断演变的风险 (Lin et al., 2024), 以及了解模型在实际环境中被使用的方式. 尽管我们尚未收到任何关于 Gemma 恶意使用的报告, 我们仍致力于调查任何此类报告, 并与学术和开发者社区合作, 同时开展我们自己的监测工作, 以标记此类案例.

Despite advancements in capabilities, we believe that, given the number of larger powerful open models available, this release will have a negligible effect on the overall risk landscape.

尽管能力有所提升, 但我们认为, 鉴于目前已有大量更强大, 更大规模的开源模型, 本次发布对整体风险格局的影响微乎其微. ---

close monitoring of the evolving risks of existing multimodal LLMs (Lin et al., 2024), as well as an understanding of the ways in which models are being used in the wild. Although we are yet to receive any reports of malicious use for Gemma, we remain committed to investigating any such reporting, and work with the academic and developer communities, as well as conduct our own monitoring, to flag such cases.

密切监测现有多模态 LLM 的不断演变的风险 (Lin et al., 2024), 以及了解模型在实际环境中被使用的方式. 尽管我们尚未收到任何关于 Gemma 恶意使用的报告, 我们仍致力于调查任何此类报告, 并与学术和开发者社区合作, 同时开展我们自己的监测工作, 以标记此类案例.

Despite advancements in capabilities, we believe that, given the number of larger powerful open models available, this release will have a negligible effect on the overall risk landscape.

尽管能力有所提升, 但我们认为, 鉴于目前已有大量更强大, 更大规模的开源模型, 本次发布对整体风险格局的影响微乎其微.

### 7.2. Safety policies and train-time mitigations

### 7.2. 安全策略与训练时缓解措施

A key pillar of Gemma's approach to safety is to align fine-tuned models with Google's safety policies, in line with Gemini models (Gemini Team, 2023). They are designed to help prevent our models from generating harmful content, i.e., Gemma 安全方法的一个关键支柱是将微调模型与 Google 的安全策略对齐, 这与 Gemini 模型 (Gemini Team, 2023) 的做法一致. 这些策略旨在帮助防止模型生成有害内容, 即: - Child sexual abuse and exploitation

- 儿童性虐待和剥削

- Revealing personally identifiable information that can lead to harm (e.g., Social Security numbers)

- 泄露可能导致伤害的个人可识别信息(例如, 社会安全号码)

- Hate speech and harassment

- 仇恨言论和骚扰

- Dangerous or malicious content (including promoting self-harm or instructing in harmful activities)

- 危险或恶意内容(包括宣扬自残或指导有害活动)

- Sexually explicit content

- 性暴露内容

- Medical advice that runs contrary to scientific or medical consensus

- 与科学或医学共识相悖的医疗建议

We undertook considerable safety filtering of our pre-training data to reduce the likelihood of our pre-trained and fine-tuned checkpoints producing harmful content. For fine-tuned models, we also use both SFT and RLHF to steer the model away from undesirable behavior.

我们对预训练数据进行了大量的安全过滤, 以降低预训练检查点和微调检查点产生有害内容的可能性. 对于微调模型, 我们还同时使用 SFT (Supervised Fine-Tuning, 监督微调) 和 RLHF (Reinforcement Learning from Human Feedback, 基于人类反馈的强化学习) 来引导模型远离不良行为.

### 7.3. 保证评估

We also run our IT models through a set of baseline assurance evaluations to understand the potential harms that our models can cause. As we champion open models, we also recognize that the irreversible nature of weight releases requires rigorous risk assessment. Our internal safety processes are designed accordingly, and for previous Gemma models we have also undertaken evaluations of capabilities relevant to extreme risks (Phuong et al., 2024; Shevlane et al., 2023). As we continue to develop and share open models, we will follow the heuristic that thoroughly evaluating a more capable model often provides sufficient assurance for less capable ones. As such, we prioritised a streamlined set of evaluations for Gemma 3, reserving in-depth dangerous capability assessments for cases where a specific model may present a potentially heightened risk (as described below on CBRN evaluations). We balance development speed with targeted safety testing, ensuring our evaluations are well-focused and efficient, while upholding the commitments laid out in our Frontier Safety Framework.

我们还对 IT 模型进行了一系列基线保证评估, 以了解模型可能造成的潜在危害. 作为开源模型的倡导者, 我们也认识到权重发布的不可逆性需要严格的风险评估. 我们的内部安全流程据此设计, 对于之前的 Gemma 模型, 我们还进行了与极端风险相关的能力评估 (Phuong et al., 2024; Shevlane et al., 2023). 随着我们继续开发和分享开源模型, 我们将遵循以下启发式原则: 对能力更强的模型进行彻底评估通常能为能力较弱的模型提供足够的保证. 因此, 我们为 Gemma 3 优先采用了一套精简的评估方案, 仅在特定模型可能呈现潜在 heightened risk 的情况下保留深入的危险能力评估(如下文 CBRN 评估所述). 我们在开发速度与有针对性的安全测试之间取得平衡, 确保评估聚焦且高效, 同时遵守我们在 Frontier Safety Framework 中做出的承诺. Baseline Evaluations

基线评估

Baseline assurance captures the model violation rate for safety policies, using a large number of synthetic adversarial user queries, and human raters to label the answers as policy violating or not. Overall, Gemma 3 violation rate is significantly low overall on these safety policies.

基线保证通过使用大量合成对抗性用户查询以及人工评分员将答案标记为是否违反策略, 来捕获模型对安全策略的违反率. 总体而言, Gemma 3 在这些安全策略上的违反率显著较低.

Chemical, Biological, Radiological and Nuclear (CBRN) knowledge

化学, 生物, 放射性和核(CBRN)知识

Owing to enhanced performance on STEM-related tasks, we evaluated knowledge relevant to biological, radiological, and nuclear risks using an internal dataset of closed-ended, knowledge-based multiple choice questions. For evaluations of chemical knowledge, we employed a closed-ended knowledge-based approach on chemical hazards developed by Macknight et al. Our evaluation suggests that the knowledge of Gemma 3 models in these domains is low.

由于在 STEM 相关任务上的性能提升, 我们使用内部封闭的, 基于知识的选择题数据集评估了与生物, 放射性和核风险相关的知识. 对于化学知识的评估, 我们采用了 Macknight et al. 开发的基于知识的封闭式化学危害评估方法. 我们的评估表明, Gemma 3 模型在这些领域的知识水平较低.

### 7.4. Our approach to responsible open models

### 7.4. 我们对负责任开源模型的方法

Designing safe, secure, and responsible applications requires a system-level approach, working to mitigate risks associated with each specific use case and environment. We will continue to adopt assessments and safety mitigations proportionate to the potential risks from our models, and will only share these with the community when we are confident that the benefits significantly outweigh the foreseeable risks.

设计安全, 可靠且负责任的应用需要系统级的方法, 致力于缓解与每个特定用例和环境相关的风险. 我们将继续采用与模型潜在风险相称的评估和安全缓解措施, 并且只有在我们确信收益显著超过可预见风险时, 才会与社区分享这些模型.

## 8. 讨论与结论

In this work, we have presented Gemma 3, the latest addition to the Gemma family of open language models for text, image, and code. In this version, we focus on adding image understanding and long context while improving multilinguality and STEM-related abilities. Our model sizes and architectures are designed to be compatible with standard hardware, and most of our architecture improvements are tailored to fit this hardware while maintaining performance.

在本工作中, 我们展示了 Gemma 3, 这是 Gemma 开源语言模型家族的最新成员, 支持文本, 图像和代码. 在该版本中, 我们聚焦于增加图像理解和长上下文能力, 同时提升多语言性和 STEM 相关能力. 我们的模型规模和架构设计旨在与标准硬件兼容, 我们的大多数架构改进都针对这种硬件进行了定制, 同时保持性能. ---

References

参考文献

Realworldqa. <https://x.ai/news/grok-1>. Realworldqa. <https://x.ai/news/grok-1>. M. Acharya, K. Kafle, and C. Kanan. Tallyqa: Answering complex counting questions. In AAAI, 2018. M. Acharya, K. Kafle, and C. Kanan. Tallyqa: 回答复杂的计数问题. 发表于 AAAI, 2018. R. Agarwal, N. Vieillard, Y. Zhou, P. Stanczyk, S. R. Garea, M. Geist, and O. Bachem. On-policy distillation of language models: Learning from self-generated mistakes. In ICLR, 2024. R. Agarwal 等. On-policy distillation of language models: Learning from self-generated mistakes(语言模型的 on-policy 蒸馏: 从自生成错误中学习). 发表于 ICLR, 2024. J. Ainslie, J. Lee-Thorp, M. de Jong, Y. Zemlyanskiy, F. Lebrón, and S. Sanghai. Gqa: Training generalized multi-query transformer models from multi-head checkpoints. arXiv preprint arXiv:2305.13245, 2023. J. Ainslie 等. Gqa: Training generalized multi-query transformer models from multi-head checkpoints(从多头检查点训练广义多查询 Transformer 模型). arXiv preprint arXiv:2305.13245, 2023. R. Anil, G. Pereyra, A. Passos, R. Ormandi, G. E. Dahl, and G. E. Hinton. Large scale distributed neural network training through online distillation. arXiv preprint arXiv:1804.03235, 2018. R. Anil 等. Large scale distributed neural network training through online distillation(通过在线蒸馏进行大规模分布式神经网络训练). arXiv preprint arXiv:1804.03235, 2018. R. Anil, A. M. Dai, O. Firat, M. Johnson, D. Lepikhin, A. Passos, S. Shakeri, E. Taropa, P. Bailey, Z. Chen, et al. Palm 2 technical report. arXiv preprint arXiv:2305.10403, 2023. R. Anil 等. Palm 2 technical report(PaLM 2 技术报告). arXiv preprint arXiv:2305.10403, 2023. M. Artetxe, S. Ruder, and D. Yogatama. On the cross-lingual transferability of monolingual representations. In ACL, 2020. M. Artetxe 等. On the cross-lingual transferability of monolingual representations(论单语表示的跨语言可迁移性). 发表于 ACL, 2020. A. Asai, J. Kasai, J. H. Clark, K. Lee, E. Choi, and H. Hajishirzi. Xor qa: Cross-lingual open-retrieval question answering. arXiv preprint arXiv:2010.11856, 2020. A. Asai 等. Xor qa: Cross-lingual open-retrieval question answering(XOR QA: 跨语言开放检索问答). arXiv preprint arXiv:2010.11856, 2020. J. Austin, A. Odena, M. I. Nye, M. Bosma, H. Michalewski, D. Dohan, E. Jiang, C. J. Cai, M. Terry, Q. V. Le, and C. Sutton. Program synthesis with large language models. CoRR, abs/2108.07732, 2021. J. Austin 等. Program synthesis with large language models(使用大型语言模型进行程序合成). CoRR, abs/2108.07732, 2021. P. Barham, A. Chowdhery, J. Dean, S. Ghemawat, S. Hand, D. Hurt, M. Isard, H. Lim, R. Pang, S. Roy, B. Saeta, P. Schuh, R. Sepassi, L. E. Shafey, C. A. Thekkath, and Y. Wu. Pathways: Asynchronous distributed dataflow for ml, 2022. P. Barham 等. Pathways: Asynchronous distributed dataflow for ml(Pathways: 用于机器学习的异步分布式数据流). 2022. I. Beltagy, M. E. Peters, and A. Cohan. Longformer: The long-document transformer. arXiv preprint arXiv:2004.05150, 2020. I. Beltagy 等. Longformer: The long-document transformer(Longformer: 长文档 Transformer). arXiv preprint arXiv:2004.05150, 2020. S. Biderman, U. Prashanth, L. Sutawika, H. Schoelkopf, Q. Anthony, S. Purohit, and E. Raff. Emergent and predictable memorization in large language models. NeurIPS, 36: 28072-28090, 2023. S. Biderman 等. Emergent and predictable memorization in large language models(大型语言模型中的涌现性和可预测性记忆化). NeurIPS, 36: 28072-28090, 2023. Y. Bisk, R. Zellers, R. L. Bras, J. Gao, and Y. Choi. PIQA: reasoning about physical commonsense in natural language. CoRR, abs/1911.11641, 2019. Y. Bisk 等. PIQA: reasoning about physical commonsense in natural language(PIQA: 自然语言中的物理常识推理). CoRR, abs/1911.11641, 2019. N. Carlini, F. Tramer, E. Wallace, M. Jagielski, A. Herbert-Voss, K. Lee, A. Roberts, T. Brown, D. Song, U. Erlingsson, et al. Extracting training data from large language models. In USENIX, 2021. N. Carlini 等. Extracting training data from large language models(从大型语言模型中提取训练数据).

发表于 USENIX, 2021. N. Carlini, D. Ippolito, M. Jagielski, K. Lee, F. Tramer, and C. Zhang. Quantifying memorization across neural language models. arXiv preprint arXiv:2202.07646, 2022. N. Carlini 等. Quantifying memorization across neural language models(量化神经语言模型中的记忆化). arXiv preprint arXiv:2202.07646, 2022. Chameleon Team. Chameleon: Mixed-modal early-fusion foundation models. arXiv preprint arXiv:2405.09818, 2024. Chameleon Team. Chameleon: Mixed-modal early-fusion foundation models(Chameleon: 混合模态早期融合基础模型). arXiv preprint arXiv:2405.09818, 2024. M. Chen, J. Tworek, H. Jun, Q. Yuan, H. P. de Oliveira Pinto, J. Kaplan, H. Edwards, Y. Burda, N. Joseph, G. Brockman, A. Ray, R. Puri, G. Krueger, M. Petrov, H. Khlaaf, G. Sastry, P. Mishkin, B. Chan, S. Gray, N. Ryder, M. Pavlov, A. Power, L. Kaiser, M. Bavarian, C. Winter, P. Tillet, F. P. Such, D. Cummings, M. Plappert, F. Chantzis, E. Barnes, A. Herbert-Voss, W. H. Guss, A. Nichol, A. Paino, N. Tezak, J. Tang, I. Babuschkin, S. Balaji, S. Jain, W. Saunders, C. Hesse, A. N. Carr, J. Leike, J. Achiam, V. Misra, E. Morikawa, A. Radford, M. Knight, M. Brundage, M. Murati, K. Mayer, P. Welinder, B. McGrew, D. Amodei, S. McCandlish, I. Sutskever, and W. Zaremba. Evaluating large language models trained on code. CoRR, abs/2107.03374, 2021. M. Chen 等. Evaluating large language models trained on code(评估在代码上训练的大型语言模型). CoRR, abs/2107.03374, 2021. S. Chen, S. Wong, L. Chen, and Y. Tian. Extending context window of large language models via positional interpolation. arXiv preprint arXiv:2306.15595, 2023. S. Chen 等. Extending context window of large language models via positional interpolation(通过位置插值扩展大型语言模型的上下文窗口). arXiv preprint arXiv:2306.15595, 2023. X. Chen, H. Fang, T.-Y. Lin, R. Vedantam, S. Gupta, P. Dollár, and C. L. Zitnick. Microsoft coco captions: Data collection and evaluation server. ArXiv, abs/1504.00325, 2015. X. Chen 等. Microsoft coco captions: Data collection and evaluation server(Microsoft COCO Captions: 数据收集和评估服务器). ArXiv, abs/1504.00325, 2015. W.-L. Chiang, L. Zheng, Y. Sheng, A. N. Angelopoulos, T. Li, D. Li, H. Zhang, B. Zhu, M. Jordan, J. E. Gonzalez, and I. Stoica. Chatbot arena: An open platform for evaluating llms by human preference, 2024. W.-L. Chiang 等. Chatbot arena: An open platform for evaluating llms by human preference(Chatbot Arena: 一个通过人类偏好评估 LLM 的开放平台). 2024. F. Chollet. On the measure of intelligence. arXiv preprint arXiv:1911.01547, 2019. F. Chollet. On the measure of intelligence(论智能的度量). arXiv preprint arXiv:1911.01547, 2019. A. Chowdhery, S. Narang, J. Devlin, M. Bosma, G. Mishra, A. Roberts, P. Barham, H. W. Chung, C. Sutton, S. Gehrmann, P. Schuh, K. Shi, S. Tsvyashchenko, J. Maynez, A. Rao, P. Barnes, Y. Tay, N. Shazeer, V. Prabhakaran, E. Reif, N. Du, B. Hutchinson, R. Pope, J. Bradbury, J. Austin, M. Isard, G. Gur-Ari, P. Yin, T. Duke, A. Levskaya, S. Ghemawat, S. Dev, H. Michalewski, X. Garcia, V. Misra, K. Robinson, L. Fedus, D. Zhou, D. Ippolito, D. Luan, H. Lim, B. Zoph, A. Spiridonov, R. Sepassi, D. Dohan, S. Agrawal, M. Omernick, A. M. Dai, T. S. Pillai, M. Pellat, A. Lewkowycz, E. Moreira, R. Child, O. Polozov, K. Lee, Z. Zhou, X. Wang, B. Saeta, M. Diaz, O. Firat, M. Catasta, J. Wei, K. Meier-Hellstern, D. Eck, J. Dean, S. Petrov, and N. Fiedel. Palm: Scaling language modeling with pathways, 2022. A. Chowdhery 等. Palm: Scaling language modeling with pathways(PaLM: 使用 Pathways 扩展语言建模). 2022. H. W. Chung, N. Constant, X. Garcia, A. Roberts, Y. Tay, S. Narang, and O. Firat. Unimax: Fairer and more effective language sampling for large-scale multilingual pretraining, 2023. H. W. Chung 等. Unimax: Fairer and more effective language sampling for large-scale multilingual pretraining(Unimax: 更公平且更有效的大规模多语言预训练语言采样). 2023. C. Clark, K. Lee, M. Chang, T. Kwiatkowski, M. Collins, and K. Toutanova. Boolq: Exploring the surprising difficulty of natural yes/no questions. CoRR, abs/1905.10044, 2019. C. Clark 等. Boolq: Exploring the surprising difficulty of natural yes/no questions(BoolQ: 探索自然是非问题的惊人难度). CoRR, abs/1905.10044, 2019. K. Cobbe, V. Kosaraju, M. Bavarian, M. Chen, H. Jun, L. Kaiser, M. Plappert, J. Tworek, J. Hilton, R. Nakano, C. Hesse, and J. Schulman. Training verifiers to solve math word problems. CoRR, abs/2110.14168, 2021. K. Cobbe 等. Training verifiers to solve math word problems(训练验证器解决数学文字问题). CoRR, abs/2110.14168, 2021. DeepSeek-AI. Deepseek-r1: Incentivizing reasoning learning, 2025. DeepSeek-AI. Deepseek-r1: Incentivizing reasoning learning(DeepSeek-R1: 激励推理学习). 2025. M. Dehghani, J. Djolonga, B. Mustafa, P. Padlewski, J. Heek, J. Gilmer, A. P. Steiner, M. Caron, R. Geirhos, I. Alabdulmohsin, et al. Scaling vision transformers to 22 billion parameters. In ICML, 2023. M. Dehghani 等. Scaling vision transformers to 22 billion parameters(将 Vision Transformer 扩展到 220 亿参数). 发表于 ICML, 2023. D. Deutsch, E. Briakou, I. Caswell, M. Finkelstein, R. Galor, J. Juraska, G. Kovacs, A. Lui, R. Rei, J. Riesa, S. Rijhwani, P. Riley, E. Salesky, F. Trabelsi, S. Winkler, B. Zhang, and M. Freitag. Wmt24++: Expanding the language coverage of wmt24 to 55 languages & dialects, 2025. D. Deutsch 等. Wmt24++: Expanding the language coverage of wmt24 to 55 languages & dialects(WMT24++: 将 WMT24 的语言覆盖扩展到 55 种语言和方言). 2025. A. Dosovitskiy.

An image is worth 16x16 words: Transformers for image recognition at scale. arXiv preprint arXiv:2010.11929, 2020. A. Dosovitskiy. An image is worth 16x16 words: Transformers for image recognition at scale(一张图像值 16x16 个词: 用于大规模图像识别的 Transformer). arXiv preprint arXiv:2010.11929, 2020. D. Dua, Y. Wang, P. Dasigi, G. Stanovsky, S. Singh, and M. Gardner. DROP: A reading comprehension benchmark requiring discrete reasoning over paragraphs. In ACL, 2019. D. Dua 等. DROP: A reading comprehension benchmark requiring discrete reasoning over paragraphs(DROP: 一个需要对段落进行离散推理的阅读理解基准测试).

发表于 ACL, 2019. B. Fatemi, M. Kazemi, A. Tsitsulin, K. Malkan, J. Yim, J. Palowitch, S. Seo, J. Halcrow, and B. Perozzi. Test of time: A benchmark for evaluating llms on temporal reasoning. arXiv preprint arXiv:2406.09170, 2024. B. Fatemi 等. Test of time: A benchmark for evaluating llms on temporal reasoning(时间考验: 评估 LLM 时间推理能力的基准测试). arXiv preprint arXiv:2406.09170, 2024. X. Fu, Y. Hu, B. Li, Y. Feng, H. Wang, X. Lin, D. Roth, N. A. Smith, W.-C. Ma, and R. Krishna. Blink: Multimodal large language models can see but not perceive. ArXiv, abs/2404.12390, 2024. X. Fu 等. Blink: Multimodal large language models can see but not perceive(BLINK: 多模态大型语言模型能看见但无法感知). ArXiv, abs/2404.12390, 2024. ---

J. Gehring, K. Zheng, J. Copet, V. Mella, T. Cohen, and G. Synnaeve. Rlef: Grounding code llms in execution feedback with reinforcement learning. arXiv preprint arXiv:2410.02089, 2024. J. Gehring 等. Rlef: Grounding code llms in execution feedback with reinforcement learning(RLEF: 通过强化学习将代码 LLM 扎根于执行反馈). arXiv preprint arXiv:2410.02089, 2024. Gemini Team. Gemini: A family of highly capable multimodal models, 2023. Gemini Team. Gemini: A family of highly capable multimodal models(Gemini: 一系列高能力多模态模型). 2023. Gemini Team. Gemini 1.5: Unlocking multimodal understanding across millions of tokens of context, 2024. Gemini Team. Gemini 1.5: Unlocking multimodal understanding across millions of tokens of context(Gemini 1.5: 解锁跨越数百万 token 上下文的多模态理解). 2024. Gemma Team. Gemma: Open models based on gemini research and technology, 2024a. Gemma Team. Gemma: Open models based on gemini research and technology(Gemma: 基于 Gemini 研究和技术的开源模型). 2024a. Gemma Team. Gemma 2: Improving open language models at a practical size. arXiv preprint arXiv:2408.00118, 2024b. Gemma Team. Gemma 2: Improving open language models at a practical size(Gemma 2: 在实用规模上改进开源语言模型). arXiv preprint arXiv:2408.00118, 2024b. O. Goldman, U. Shaham, D. Malkin, S. Eiger, A. Hassidim, Y. Matias, J. Maynez, A. M. Gilady, J. Riesa, S. Rijhwani, L. Rimell, I. Szpektor, R. Tsarfaty, and M. Eyal. Eclektic: a novel challenge set for evaluation of cross-lingual knowledge transfer, 2025. O. Goldman 等. Eclektic: a novel challenge set for evaluation of cross-lingual knowledge transfer(ECLeKTic: 一个用于评估跨语言知识迁移的新型挑战集). 2025. N. Goyal, C. Gao, V. Chaudhary, P.-J. Chen, G. Wenzek, D. Ju, S. Krishnan, M. Ranzato, F. Guzmán, and A. Fan. The flores-101 evaluation benchmark for low-resource and multilingual machine translation. ACL, 2022. N. Goyal 等. The flores-101 evaluation benchmark for low-resource and multilingual machine translation(FLoRes-101: 低资源和多语言机器翻译评估基准). 发表于 ACL, 2022. Y. Goyal, T. Khot, D. Summers-Stay, D. Batra, and D. Parikh. Making the V in VQA matter: Elevating the role of image understanding in Visual Question Answering. In CVPR, 2017. Y. Goyal 等. Making the V in VQA matter: Elevating the role of image understanding in Visual Question Answering(让 VQA 中的 V 发挥作用: 提升图像理解在视觉问答中的角色). 发表于 CVPR, 2017. D. Hendrycks, C. Burns, S. Basart, A. Zou, M. Mazeika, D. Song, and J. Steinhardt. Measuring massive multitask language understanding. CoRR, abs/2009.03300, 2020. D. Hendrycks 等. Measuring massive multitask language understanding(测量大规模多任务语言理解). CoRR, abs/2009.03300, 2020. D. Hendrycks, C. Burns, S. Kadavath, A. Arora, S. Basart, E. Tang, D. Song, and J. Steinhardt. Measuring mathematical problem solving with the math dataset. NeurIPS, 2021. D. Hendrycks 等. Measuring mathematical problem solving with the math dataset(使用 MATH 数据集测量数学问题解决能力). NeurIPS, 2021. J. Hessel, A. Marasović, J. D. Hwang, L. Lee, J. Da, R. Zellers, R. Mankoff, and Y. Choi. Do androids laugh at electric sheep? humor" understanding" benchmarks from the new yorker caption contest. arXiv preprint arXiv:2209.06293, 2022. J. Hessel 等. Do androids laugh at electric sheep? humor understanding benchmarks from the new yorker caption contest(仿生人是否会嘲笑电子羊?

来自《纽约客》标题比赛幽默理解基准). arXiv preprint arXiv:2209.06293, 2022. G. Hinton, O. Vinyals, and J. Dean. Distilling the knowledge in a neural network. arXiv preprint arXiv:1503.02531, 2015. G. Hinton 等. Distilling the knowledge in a neural network(蒸馏神经网络中的知识). arXiv preprint arXiv:1503.02531, 2015. C.-P. Hsieh, S. Sun, S. Kriman, S. Acharya, D. Rekesh, F. Jia, Y. Zhang, and B. Ginsburg. Ruler: What's the real context size of your long-context language models? arXiv preprint arXiv:2404.06654, 2024. C.-P. Hsieh 等. Ruler: What's the real context size of your long-context language models?(RULER: 你的长上下文语言模型的真实上下文大小是多少?). arXiv preprint arXiv:2404.06654, 2024. D. Ippolito, F. Tramèr, M. Nasr, C. Zhang, M. Jagielski, K. Lee, C. A. Choquette-Choo, and N. Carlini. Preventing verbatim memorization in language models gives a false sense of privacy. arXiv preprint arXiv:2210.17546, 2022. D. Ippolito 等. Preventing verbatim memorization in language models gives a false sense of privacy(防止语言模型中的逐字记忆化会产生虚假的隐私感). arXiv preprint arXiv:2210.17546, 2022. B. Jacob, S. Kligys, B. Chen, M. Zhu, M. Tang, A. Howard, H. Adam, and D. Kalenichenko. Quantization and training of neural networks for efficient integer-arithmetic-only inference.

In CVPR, 2018. B. Jacob 等. Quantization and training of neural networks for efficient integer-arithmetic-only inference(神经网络的量化与训练以实现高效的纯整数算术推理). 发表于 CVPR, 2018. M. Joshi, E. Choi, D. S. Weld, and L. Zettlemoyer. Triviaqa: A large scale distantly supervised challenge dataset for reading comprehension. CoRR, abs/1705.03551, 2017. M. Joshi 等. Triviaqa: A large scale distantly supervised challenge dataset for reading comprehension(TriviaQA: 一个用于阅读理解的大规模远程监督挑战数据集). CoRR, abs/1705.03551, 2017. M. Kazemi, H. Alvari, A. Anand, J. Wu, X. Chen, and R. Soricut. Geomverse: A systematic evaluation of large models for geometric reasoning. arXiv preprint arXiv:2312.12241, 2023. M. Kazemi 等. Geomverse: A systematic evaluation of large models for geometric reasoning(GeomVerse: 对大型模型几何推理能力的系统评估). arXiv preprint arXiv:2312.12241, 2023. M. Kazemi, N. Dikkala, A. Anand, P. Dević, I. Dasgupta, F. Liu, B. Fatemi, P. Awasthi, D. Guo, S. Gollapudi, and A. Qureshi. Remi: A dataset for reasoning with multiple images. ArXiv, abs/2406.09175, 2024a. M. Kazemi 等. Remi: A dataset for reasoning with multiple images(ReMI: 一个用于多图像推理的数据集). ArXiv, abs/2406.09175, 2024a. M. Kazemi, Q. Yuan, D. Bhatia, N. Kim, X. Xu, V. Imbrasaite, and D. Ramachandran. Boardgameqa: A dataset for natural language reasoning with contradictory information. NeurIPS, 36, 2024b. M. Kazemi 等. Boardgameqa: A dataset for natural language reasoning with contradictory information(BoardgameQA: 一个用于带矛盾信息的自然语言推理数据集). NeurIPS, 36, 2024b. M. Kazemi, B. Fatemi, H. Bansal, J. Palowitch, C. Anastasiou, S. V. Mehta, L. K. Jain, V. Aglietti, D. Jindal, P. Chen, et al. Big-bench extra hard. arXiv preprint arXiv:2502.19187, 2025. M. Kazemi 等. Big-bench extra hard(BIG-Bench Extra Hard: 极度困难的基准测试). arXiv preprint arXiv:2502.19187, 2025. A. Kembhavi, M. Salvato, E. Kolve, M. Seo, H. Hajishirzi, and A. Farhadi. A diagram is worth a dozen images. ArXiv, abs/1603.07396, 2016. A. Kembhavi 等. A diagram is worth a dozen images(一张图表抵得上一打图像). ArXiv, abs/1603.07396, 2016. ---

E. Kıcıman, R. Ness, A. Sharma, and C. Tan. Causal reasoning and large language models: Opening a new frontier for causality. arXiv preprint arXiv:2305.00050, 2023. E. Kıcıman 等. Causal reasoning and large language models: Opening a new frontier for causality(因果推理与大型语言模型: 为因果性开辟新前沿). arXiv preprint arXiv:2305.00050, 2023. T. Kudo and J. Richardson. SentencePiece: A simple and language independent subword tokenizer and detokenizer for neural text processing. 2018. T. Kudo and J. Richardson. SentencePiece: A simple and language independent subword tokenizer and detokenizer for neural text processing(SentencePiece: 一个简单且与语言无关的神经文本处理子词 tokenizer 和 detokenizer). 2018. T. Kwiatkowski, J. Palomaki, O. Redfield, M. Collins, A. Parikh, C. Alberti, D. Epstein, I. Polosukhin, J. Devlin, K. Lee, K. Toutanova, L. Jones, M. Kelcey, M.-W. Chang, A. M. Dai, J. Uszkoreit, Q. Le, and S. Petrov. Natural questions: A benchmark for question answering research. ACL, 2019. T. Kwiatkowski 等. Natural questions: A benchmark for question answering research(Natural Questions: 一个用于问答研究的基准测试). 发表于 ACL, 2019. N. Lambert, J. Morrison, V. Pyatkin, S. Huang, H. Ivison, F. Brahman, L. J. V. Miranda, A. Liu, N. Dziri, S. Lyu, et al. Tulu 3: Pushing frontiers in open language model post-training. arXiv preprint arXiv:2411.15124, 2024. N. Lambert 等. Tulu 3: Pushing frontiers in open language model post-training(Tulu 3: 推进开源语言模型后训练的前沿). arXiv preprint arXiv:2411.15124, 2024. Z. Lin, J. Cui, X. Liao, and X. Wang. Malla: Demystifying real-world large language model integrated malicious services, 2024. Z. Lin 等. Malla: Demystifying real-world large language model integrated malicious services(Malla: 揭秘现实世界的大型语言模型集成恶意服务). 2024. H. Liu, C. Li, Q. Wu, and Y. J. Lee. Visual instruction tuning. NeurIPS, 36, 2024. H. Liu 等. Visual instruction tuning(视觉指令微调). NeurIPS, 36, 2024. LLaMa Team. The llama 3 herd of models. arXiv preprint arXiv:2407.21783, 2024. LLaMa Team. The llama 3 herd of models(Llama 3 模型家族). arXiv preprint arXiv:2407.21783, 2024. M. Luong, H. Pham, and C. D. Manning. Effective approaches to attention-based neural machine translation. 2015. M. Luong 等. Effective approaches to attention-based neural machine translation(基于注意力的神经机器翻译的有效方法). 2015. Macknight, Aung, and Gomes. Personal Communication. Macknight, Aung, and Gomes. 个人通信. K. Marino, M. Rastegari, A. Farhadi, and R. Mot-taghi. Ok-vqa: A visual question answering benchmark requiring external knowledge. In CVPR, 2019. K. Marino 等. Ok-vqa: A visual question answering benchmark requiring external knowledge(OK-VQA: 一个需要外部知识的视觉问答基准测试). 发表于 CVPR, 2019. A. Masry, X. L. Do, J. Q. Tan, S. Joty, and E. Hoque. ChartQA: A benchmark for question answering about charts with visual and logical reasoning. ACL, 2022. A. Masry 等. ChartQA: A benchmark for question answering about charts with visual and logical reasoning(ChartQA: 一个使用视觉和逻辑推理进行图表问答的基准测试).

发表于 ACL, 2022. M. Mathew, D. Karatzas, R. Manmatha, and C. V. Jawahar. Docvqa: A dataset for vqa on document images. WACV, 2020. M. Mathew 等. Docvqa: A dataset for vqa on document images(DocVQA: 一个用于文档图像视觉问答的数据集). 发表于 WACV, 2020. M. Mathew, V. Bagal, R. Tito, D. Karatzas, E. Valveny, and C. Jawahar. Infographicvqa.

In WACV, 2022. M. Mathew 等. Infographicvqa(信息图 VQA). 发表于 WACV, 2022. I. Mirzadeh, K. Alizadeh, H. Shahrokhi, O. Tuzel, S. Bengio, and M. Farajtabar. Gsm-symbolic: Understanding the limitations of mathematical reasoning in large language models. arXiv preprint arXiv:2410.05229, 2024. I. Mirzadeh 等. Gsm-symbolic: Understanding the limitations of mathematical reasoning in large language models(GSM-Symbolic: 理解大型语言模型中数学推理的局限性). arXiv preprint arXiv:2410.05229, 2024. M. Nasr, N. Carlini, J. Hayase, M. Jagielski, A. F. Cooper, D. Ippolito, C. A. Choquette-Choo, E. Wallace, F. Tramèr, and K. Lee. Scalable extraction of training data from (production) language models. arXiv preprint arXiv:2311.17035, 2023. M. Nasr 等. Scalable extraction of training data from (production) language models(从(生产级)语言模型中可扩展地提取训练数据). arXiv preprint arXiv:2311.17035, 2023. A. Nie, Y. Zhang, A. S. Amdekar, C. Piech, T. B. Hashimoto, and T. Gerstenberg. Moca: Measuring human-language model alignment on causal and moral judgment tasks. NeurIPS, 36, 2024. A. Nie 等. Moca: Measuring human-language model alignment on causal and moral judgment tasks(MoCA: 测量人类-语言模型在因果和道德判断任务上的一致性). NeurIPS, 36, 2024. R. Paiss, A. Ephrat, O. Tov, S. Zada, I. Mosseri, M. Irani, and T. Dekel. Teaching clip to count to ten. ICCV, 2023. R. Paiss 等. Teaching clip to count to ten(教 CLIP 数到十).

发表于 ICCV, 2023. M. Phuong, M. Aitchison, E. Catt, S. Cogan, A. Kaskasoli, V. Krakovna, D. Lindner, M. Rahtz, Y. Assael, S. Hodkinson, H. Howard, T. Lieberum, R. Kumar, M. A. Raad, A. Webson, L. Ho, S. Lin, S. Farquhar, M. Hutter, G. Deletang, A. Ruoss, S. El-Sayed, S. Brown, A. Dragan, R. Shah, A. Dafoe, and T. Shevlane. Evaluating frontier models for dangerous capabilities, 2024. M. Phuong 等. Evaluating frontier models for dangerous capabilities(评估前沿模型的危险能力). 2024. A. Radford, J. W. Kim, C. Hallacy, A. Ramesh, G. Goh, S. Agarwal, G. Sastry, A. Askell, P. Mishkin, J. Clark, et al. Learning transferable visual models from natural language supervision.

In ICML, pages 8748-8763. PMLR, 2021. A. Radford 等. Learning transferable visual models from natural language supervision(从自然语言监督中学习可迁移的视觉模型). 发表于 ICML, pages 8748-8763. PMLR, 2021. A. Ramé, J. Ferret, N. Vieillard, R. Dadashi, L. Hussenot, P.-L. Cedoz, P. G. Sessa, S. Girgin, A. Douillard, and O. Bachem. WARP: On the benefits of weight averaged rewarded policies, 2024a. A. Ramé 等. WARP: On the benefits of weight averaged rewarded policies(WARP: 论权重平均奖励策略的益处). 2024a. A. Ramé, N. Vieillard, L. Hussenot, R. Dadashi, G. Cideron, O. Bachem, and J. Ferret. WARM: On the benefits of weight averaged reward models. In ICML, 2024b. A. Ramé 等. WARM: On the benefits of weight averaged reward models(WARM: 论权重平均奖励模型的益处). 发表于 ICML, 2024b. ---

D. Rein, B. L. Hou, A. C. Stickland, J. Petty, R. Y. Pang, J. Dirani, J. Michael, and S. R. Bowman. Gpqa: A graduate-level google-proof q&a benchmark. ArXiv, abs/2311.12022, 2023. D. Rein 等. Gpqa: A graduate-level google-proof q&a benchmark(GPQA: 一个研究生级别的防 Google 搜索问答基准测试). ArXiv, abs/2311.12022, 2023. J. Ren, S. Rajbhandari, R. Y. Aminabadi, O. Ruwase, S. Yang, M. Zhang, D. Li, and Y. He. Zero-offload: Democratizing billion-scale model training. In USENIX, 2021. J. Ren 等. Zero-offload: Democratizing billion-scale model training(ZeRO-Offload: 使十亿规模模型训练民主化). 发表于 USENIX, 2021. A. Roberts, H. W. Chung, G. Mishra, A. Levskaya, J. Bradbury, D. Andor, S. Narang, B. Lester, C. Gaffney, A. Mohiuddin, et al. Scaling up models and data with t5x and seqio. JMLR, 2023. A. Roberts 等. Scaling up models and data with t5x and seqio(使用 T5X 和 SeqIO 扩展模型和数据). JMLR, 2023. N. Sachdeva, B. Coleman, W.-C. Kang, J. Ni, L. Hong, E. H. Chi, J. Caverlee, J. McAuley, and D. Z. Cheng. How to train data-efficient llms. arXiv preprint arXiv:2402.09668, 2024. N. Sachdeva 等. How to train data-efficient llms(如何训练数据高效的 LLM). arXiv preprint arXiv:2402.09668, 2024. K. Sakaguchi, R. L. Bras, C. Bhagavatula, and Y. Choi. WINOGRANDE: an adversarial winograd schema challenge at scale. CoRR, abs/1907.10641, 2019. K. Sakaguchi 等. WINOGRANDE: an adversarial winograd schema challenge at scale(WinoGrande: 大规模对抗性 Winograd 模式挑战). CoRR, abs/1907.10641, 2019. E. Sánchez, B. Alastruey, C. Ropers, P. Stenetorp, M. Artetxe, and M. R. Costa-jussà. Linguini: A benchmark for language-agnostic linguistic reasoning. arXiv preprint arXiv:2409.12126, 2024. E. Sánchez 等. Linguini: A benchmark for language-agnostic linguistic reasoning(Linguini: 一个与语言无关的语言推理基准测试). arXiv preprint arXiv:2409.12126, 2024. M. Sap, H. Rashkin, D. Chen, R. L. Bras, and Y. Choi. Socialiqa: Commonsense reasoning about social interactions. CoRR, abs/1904.09728, 2019. M. Sap 等. Socialiqa: Commonsense reasoning about social interactions(SocialIQA: 关于社会互动的常识推理). CoRR, abs/1904.09728, 2019. P. G. Sessa, R. Dadashi, L. Hussenot, J. Ferret, N. Vieillard, A. Ramé, B. Shariari, S. Perrin, A. Friesen, G. Cideron, S. Girgin, P. Stanczyk, A. Michi, D. Sinopalnikov, S. Ramos, A. Héliou, A. Severyn, M. Hoffman, N. Momchev, and O. Bachem. Bond: Aligning llms with best-of-n distillation, 2024. P. G. Sessa 等. Bond: Aligning llms with best-of-n distillation(BOND: 使用 Best-of-N 蒸馏对齐 LLM). 2024. K. Shah, N. Dikkala, X. Wang, and R. Panigrahy. Causal language modeling can elicit search and reasoning capabilities on logic puzzles. arXiv preprint arXiv:2409.10502, 2024. K. Shah 等. Causal language modeling can elicit search and reasoning capabilities on logic puzzles(因果语言建模可以激发逻辑谜题上的搜索和推理能力). arXiv preprint arXiv:2409.10502, 2024. T. Shevlane, S. Farquhar, B. Garfinkel, M. Phuong, J. Whittlestone, J. Leung, D. Kokotajlo, N. Marchal, M. Anderljung, N. Kolt, L. Ho, D. Siddarth, S. Avin, W. Hawkins, B. Kim, I. Gabriel, V. Bolina, J. Clark, Y. Bengio, P. Christiano, and A. Dafoe. Model evaluation for extreme risks, 2023. T. Shevlane 等. Model evaluation for extreme risks(极端风险的模型评估). 2023. F. Shi, M. Suzgun, M. Freitag, X. Wang, S. Srivats, S. Vosoughi, H. W. Chung, Y. Tay, S. Ruder, D. Zhou, D. Das, and J. Wei. Language models are multilingual chain-of-thought reasoners. In ICLR, 2023. F. Shi 等. Language models are multilingual chain-of-thought reasoners(语言模型是多语言思维链推理器).

发表于 ICLR, 2023. A. Singh, V. Natarjan, M. Shah, Y. Jiang, X. Chen, D. Parikh, and M. Rohrbach. Towards vqa models that can read.

In CVPR, 2019. A. Singh 等. Towards vqa models that can read(迈向能够阅读的 VQA 模型). 发表于 CVPR, 2019. H. Singh, N. Gupta, S. Bharadwaj, D. Tewari, and P. Talukdar. Indicgenbench: a multilingual benchmark to evaluate generation capabilities of llms on indic languages. arXiv preprint arXiv:2404.16816, 2024a. H. Singh 等. Indicgenbench: a multilingual benchmark to evaluate generation capabilities of llms on indic languages(IndicGenBench: 一个用于评估 LLM 在印度语言上生成能力的多语言基准测试). arXiv preprint arXiv:2404.16816, 2024a. S. Singh, A. Romanou, C. Fourrier, D. I. Adelani, J. G. Ngui, D. Vila-Suero, P. Limkonchotiwat, K. Marchisio, W. Q. Leong, Y. Susanto, R. Ng, S. Longpre, W.-Y. Ko, M. Smith, A. Bosselut, A. Oh, A. F. T. Martins, L. Choshen, D. Ippolito, E. Ferrante, M. Fadaee, B. Ermis, and S. Hooker. Global mmlu: Understanding and addressing cultural and linguistic biases in multilingual evaluation, 2024b. S. Singh 等. Global mmlu: Understanding and addressing cultural and linguistic biases in multilingual evaluation(Global MMLU: 理解和解决多语言评估中的文化和语言偏见). 2024b. A. Steiner, A. S. Pinto, M. Tschannen, D. Key-sers, X. Wang, Y. Bitton, A. Gritsenko, M. Minderer, A. Sherbondy, S. Long, S. Qin, R. Ingle, E. Bugliarello, S. Kazemzadeh, T. Mesnard, I. Alabdulmohsin, L. Beyer, and X. Zhai. PaliGemma 2: A Family of Versatile VLMs for Transfer. arXiv preprint arXiv:2412.03555, 2024. A. Steiner 等. PaliGemma 2: A Family of Versatile VLMs for Transfer(PaliGemma 2: 一个用于迁移的多功能视觉语言模型家族). arXiv preprint arXiv:2412.03555, 2024. M. Suzgun, N. Scales, N. Schärli, S. Gehrmann, Y. Tay, H. W. Chung, A. Chowdhery, Q. V. Le, E. H. Chi, D. Zhou, and J. Wei. Challenging big-bench tasks and whether chain-of-thought can solve them, 2022. M. Suzgun 等. Challenging big-bench tasks and whether chain-of-thought can solve them(挑战 BIG-Bench 任务以及思维链是否能解决它们). 2022. G. Tyen, H. Mansoor, P. Chen, T. Mak, and V. Cărbune. Llms cannot find reasoning errors, but can correct them! arXiv preprint arXiv:2311.08516, 2023. G. Tyen 等. Llms cannot find reasoning errors, but can correct them!(LLM 无法发现推理错误, 但可以纠正它们!). arXiv preprint arXiv:2311.08516, 2023. A. Vaswani, N. Shazeer, N. Parmar, J. Uszkoreit, L. Jones, A. N. Gomez, L. Kaiser, and I. Polosukhin. Attention is all you need. 2017. A. Vaswani 等. Attention is all you need(注意力机制就是你所需要的一切). 2017. ---

K. Vodrahalli, S. Ontanon, N. Tripuraneni, K. Xu, S. Jain, R. Shivanna, J. Hui, N. Dikkala, M. Kazemi, B. Fatemi, et al. Michelangelo: Long context evaluations beyond haystacks via latent structure queries. arXiv preprint arXiv:2409.12640, 2024. K. Vodrahalli 等. Michelangelo: Long context evaluations beyond haystacks via latent structure queries(Michelangelo: 通过潜在结构查询超越大海捞针的长上下文评估). arXiv preprint arXiv:2409.12640, 2024. Y. Wang, X. Ma, G. Zhang, Y. Ni, A. Chandra, S. Guo, W. Ren, A. Arulraj, X. He, Z. Jiang, et al. Mmlu-pro: A more robust and challenging multi-task language understanding benchmark. In NeurIPS, 2024. Y. Wang 等. Mmlu-pro: A more robust and challenging multi-task language understanding benchmark(MMLU-Pro: 一个更鲁棒且更具挑战性的多任务语言理解基准测试). 发表于 NeurIPS, 2024. L. Weidinger, J. Mellor, M. Rauh, C. Griffin, J. Uesato, P.-S. Huang, M. Cheng, M. Glaese, B. Balle, A. Kasirzadeh, Z. Kenton, S. Brown, W. Hawkins, T. Stepleton, C. Biles, A. Birhane, J. Haas, L. Rimell, L. A. Hendricks, W. Isaac, S. Legassick, G. Irving, and I. Gabriel. Ethical and social risks of harm from language models, 2021. L. Weidinger 等. Ethical and social risks of harm from language models(语言模型造成伤害的伦理和社会风险). 2021. C. White, S. Dooley, M. Roberts, A. Pal, B. Feuer, S. Jain, R. Shwartz-Ziv, N. Jain, K. Saifullah, S. Naidu, et al. Livebench: A challenging, contamination-free llm benchmark. arXiv preprint arXiv:2406.19314, 2024. C. White 等. Livebench: A challenging, contamination-free llm benchmark(LiveBench: 一个具有挑战性, 无数据污染的 LLM 基准测试). arXiv preprint arXiv:2406.19314, 2024. M. Wortsman, P. J. Liu, L. Xiao, K. Everett, A. Alemi, B. Adlam, J. D. Co-Reyes, I. Gur, A. Kumar, R. Novak, et al. Small-scale proxies for large-scale transformer training instabilities. arXiv preprint arXiv:2309.14322, 2023. M. Wortsman 等. Small-scale proxies for large-scale transformer training instabilities(大规模 Transformer 训练不稳定性的小规模代理). arXiv preprint arXiv:2309.14322, 2023. XLA. Xla: Optimizing compiler for tensorflow, 2019. URL <https://www.tensorflow.org/xla>. XLA. Xla: Optimizing compiler for tensorflow(XLA: TensorFlow 优化编译器). 2019. URL <https://www.tensorflow.org/xla>. Y. Xu, H. Lee, D. Chen, B. A. Hechtman, Y. Huang, R. Joshi, M. Krikun, D. Lepikhin, A. Ly, M. Maggioni, R. Pang, N. Shazeer, S. Wang, T. Wang, Y. Wu, and Z. Chen. GSPMD: general and scalable parallelization for ML computation graphs. 2021. Y. Xu 等. GSPMD: general and scalable parallelization for ML computation graphs(GSPMD: 用于机器学习计算图的通用可扩展并行化). 2021. Y. Yamada, Y. Bao, A. K. Lampinen, J. Kasai, and I. Yildirim. Evaluating spatial understanding of large language models. arXiv preprint arXiv:2310.14540, 2023. Y. Yamada 等. Evaluating spatial understanding of large language models(评估大型语言模型的空间理解能力). arXiv preprint arXiv:2310.14540, 2023. K. Yang, O. Russakovsky, and J. Deng. Spatialsense: An adversarially crowdsourced benchmark for spatial relation recognition. ICCV, 2019. K. Yang 等. Spatialsense: An adversarially crowdsourced benchmark for spatial relation recognition(SpatialSense: 一个对抗性众包的空间关系识别基准测试).

发表于 ICCV, 2019. X. Yue, Y. Ni, K. Zhang, T. Zheng, R. Liu, G. Zhang, S. Stevens, D. Jiang, W. Ren, Y. Sun, C. Wei, B. Yu, R. Yuan, R. Sun, M. Yin, B. Zheng, Z. Yang, Y. Liu, W. Huang, H. Sun, Y. Su, and W. Chen. Mmmu: A massive multi-discipline multimodal understanding and reasoning benchmark for expert agi. CVPR, 2023. X. Yue 等. Mmmu: A massive multi-discipline multimodal understanding and reasoning benchmark for expert agi(MMMU: 一个用于专家 AGI 的大规模多学科多模态理解和推理基准测试). 发表于 CVPR, 2023. R. Zellers, A. Holtzman, Y. Bisk, A. Farhadi, and Y. Choi. HellaSwag: Can a machine really finish your sentence? In ACL, 2019. R. Zellers 等. HellaSwag: Can a machine really finish your sentence?(HellaSwag: 机器真的能补全你的句子吗?). 发表于 ACL, 2019. X. Zhai, B. Mustafa, A. Kolesnikov, and L. Beyer. Sigmoid loss for language image pre-training.

In CVPR, 2023. X. Zhai 等. Sigmoid loss for language image pre-training(SigLIP: 语言图像预训练的 Sigmoid 损失). 发表于 CVPR, 2023. B. Zhang and R. Sennrich. Root mean square layer normalization. 2019. B. Zhang and R. Sennrich. Root mean square layer normalization(均方根层归一化). 2019. J. Zhang, L. Jain, Y. Guo, J. Chen, K. L. Zhou, S. Suresh, A. Wagenmaker, S. Sievert, T. Rogers, K. Jamieson, et al. Humor in ai: Massive scale crowd-sourced preferences and benchmarks for cartoon captioning. arXiv preprint arXiv:2406.10522, 2024. J. Zhang 等. Humor in ai: Massive scale crowd-sourced preferences and benchmarks for cartoon captioning(AI 中的幽默: 大规模众包偏好和卡通标题生成基准测试). arXiv preprint arXiv:2406.10522, 2024. W. Zhong, R. Cui, Y. Guo, Y. Liang, S. Lu, Y. Wang, A. Saied, W. Chen, and N. Duan. Agieval: A human-centric benchmark for evaluating foundation models, 2023. W. Zhong 等. Agieval: A human-centric benchmark for evaluating foundation models(AGIEval: 一个以人为中心的评估基础模型基准测试). 2023. ---

Core contributors

核心贡献者

Aishwarya Kamath*

Johan Ferret*

Shreya Pathak*

Nino Vieillard*

Ramona Merhej*

Sarah Perrin*

Tatiana Matejovicova*

Alexandre Ramé*

Morgane Rivière*

Louis Rouillard*

Thomas Mesnard*

Geoffrey Cideron*

Jean-bastien Grill*

Sabela Ramos*

Edouard Yvinec*

Michelle Casbon*

Etienne Pot

Ivo Penchev

Gaël Liu

Francesco Visin

Kathleen Kenealy

Lucas Beyer

Xiaohai Zhai

Anton Tsitsulin

Robert Busa-Fekete

Alex Feng

Noveen Sachdeva

Benjamin Coleman

Yi Gao

Basil Mustafa

Iain Barr

Emilio Parisotto

David Tian

Matan Eyal

Colin Cherry

Jan-Thorsten Peter

Danila Sinopalnikov

Surya Bhupatiraju

Rishabh Agarwal

Mehran Kazemi

Dan Malkin

Ravin Kumar

David Vilar

Idan Brusilovsky

Jiaming Luo

Andreas Steiner

*co-first authors.*共同第一作者. Contributors (alphabetical order)

贡献者(按字母顺序)

Abe Friesen

Abhanshu Sharma

Abheesht Sharma

Adi Mayrav Gilady

Adrian Goedeckemeyer

Alaa Saade

Alex Feng

Alexander Kolesnikov

Alexei Bendebury

Alvin Abdagic

Amit Vadi

András György

André Susano Pinto

Anil Das

Ankur Bapna

Antoine Miech

Antoine Yang

Antonia Paterson

Ashish Shenoy

Ayan Chakrabarti

Bilal Piot

Bo Wu

Bobak Shahriari

Bryce Petrini

Charlie Chen

Charline Le Lan

Christopher A. Choquette-Choo

CJ Carey

Cormac Brick

Daniel Deutsch

Danielle Eisenbud

Dee Cattle

Derek Cheng

Dimitris Paparas

Divyashree Shivakumar Sreepathihalli

Doug Reid

Dustin Tran

Dustin Zelle

Eric Noland

Erwin Huizenga

Eugene Kharitonov

Frederick Liu

Gagik Amirkhanyan

Glenn Cameron

Hadi Hashemi

Hanna Klimczak-Plucińska

Harman Singh

Harsh Mehta

---

Harshal Tushar Lehri

Hussein Hazimeh

Ian Ballantyne

Idan Szpektor

Ivan Nardini

Jean Pouget-Abadie

Jetha Chan

Joe Stanton

John Wieting

Jonathan Lai

Jordi Orbay

Joseph Fernandez

Josh Newlan

Ju-yeong Ji

Jyotinder Singh

Kat Black

Kathy Yu

Kevin Hui

Kiran Vodrahalli

Klaus Greff

Linhai Qiu

Marcella Valentine

Marina Coelho

Marvin Ritter

Matt Hoffman

Matthew Watson

Mayank Chaturvedi

Michael Moynihan

Min Ma

Nabila Babar

Natasha Noy

Nathan Byrd

Nick Roy

Nikola Momchev

Nilay Chauhan

Noveen Sachdeva

Oskar Bunyan

Pankil Botarda

Paul Caron

Paul Kishan Rubenstein

Phil Culliton

Philipp Schmid

Pier Giuseppe Sessa

Pingmei Xu

Piotr Stanczyk

Pouya Tafti

Rakesh Shivanna

Renjie Wu

Renke Pan

Reza Rokni

Rob Willoughby

Rohith Vallu

Ryan Mullins

Sammy Jerome

Sara Smoot

Sertan Girgin

Shariq Iqbal

Shashir Reddy

Shruti Sheth

Siim Põder

Sijal Bhatnagar

Sindhu Raghuram Panyam

Sivan Eiger

Susan Zhang

Tianqi Liu

Trevor Yacovone

Tyler Liechty

Uday Kalra

Utku Evci

Vedant Misra

Vincent Roseberry

Vlad Feinberg

Vlad Kolesnikov

Woohyun Han

Woosuk Kwon

Xi Chen

Yinlam Chow

Yuvein Zhu

Zichuan Wei

Zoltan Egyed

Support

支持团队

Victor Cotruta

Minh Giang

Phoebe Kirk

Anand Rao

Kat Black

Nabila Babar

Jessica Lo

Erica Moreira

Luiz Gustavo Martins

Omar Sanseviero

Lucas Gonzalez

Zach Gleicher

Tris Warkentin

Sponsors

赞助者

---

Vahab Mirrokni

Evan Senter

Eli Collins

Joelle Barral

Zoubin Ghahramani

Raia Hadsell

Yossi Matias

D. Sculley

Slav Petrov

Noah Fiedel

Noam Shazeer

Oriol Vinyals

Jeff Dean

Demis Hassabis

Koray Kavukcuoglu

Clement Farabet

Technical advisors

技术顾问

Elena Buchatskaya

Jean-Baptiste Alayrac

Rohan Anil

Dmitry (Dima) Lepikhin

Sebastian Borgeaud

Olivier Bachem

Lead

负责人

Armand Joulin

Technical leads

技术负责人

Alek Andreev

Cassidy Hardin

Robert Dadashi

Léonard Hussenot

---

Appendix

附录

Details of pre-trained performances. 预训练性能细.

| Benchmark | Gemma 2 2B | Gemma 2 9B | Gemma 2 27B | Gemma 3 1B | Gemma 3 4B | Gemma 3 12B | Gemma 3 27B |
|-----------|------------|------------|-------------|------------|------------|-------------|-------------|
| HellaSwag | 72.9 | 81.9 | 86.4 | 62.3 | 77.2 | 84.2 | 85.6 |
| BoolQ | 75.6 | 77.5 | 76.2 | 63.2 | 72.3 | 78.8 | 82.4 |
| PIQA | 78.1 | 81.9 | 83.5 | 73.8 | 79.6 | 81.8 | 83.3 |
| SIQA | 51.8 | 53.3 | 53.8 | 48.9 | 51.9 | 53.4 | 54.9 |
| TriviaQA | 60.2 | 76.5 | 83.8 | 39.8 | 65.8 | 78.2 | 85.5 |
| Natural Questions | 17.2 | 29.2 | 34.7 | 9.48 | 20.0 | 31.4 | 36.1 |
| ARC-C | 55.8 | 69.1 | 71.4 | 38.4 | 56.2 | 68.9 | 70.6 |
| ARC-E | 80.6 | 88.3 | 88.6 | 73.0 | 82.4 | 88.3 | 89.0 |
| WinoGrande | 65.4 | 73.9 | 79.4 | 58.2 | 64.7 | 74.3 | 78.8 |
| BBH | 42.4 | 69.4 | 74.8 | 28.4 | 50.9 | 72.6 | 77.7 |
| DROP | 53.2 | 71.5 | 75.2 | 42.4 | 60.1 | 72.2 | 77.2 |

Table 9
| Factuality, common-sense performance and reasoning after pre-training phas.

| 基准测试 | Gemma 2 2B | Gemma 2 9B | Gemma 2 27B | Gemma 3 1B | Gemma 3 4B | Gemma 3 12B | Gemma 3 27B |
|----------|------------|------------|-------------|------------|------------|-------------|-------------|
| HellaSwag | 72.9 | 81.9 | 86.4 | 62.3 | 77.2 | 84.2 | 85.6 |
| BoolQ | 75.6 | 77.5 | 76.2 | 63.2 | 72.3 | 78.8 | 82.4 |
| PIQA | 78.1 | 81.9 | 83.5 | 73.8 | 79.6 | 81.8 | 83.3 |
| SIQA | 51.8 | 53.3 | 53.8 | 48.9 | 51.9 | 53.4 | 54.9 |
| TriviaQA | 60.2 | 76.5 | 83.8 | 39.8 | 65.8 | 78.2 | 85.5 |
| Natural Questions | 17.2 | 29.2 | 34.7 | 9.48 | 20.0 | 31.4 | 36.1 |
| ARC-C | 55.8 | 69.1 | 71.4 | 38.4 | 56.2 | 68.9 | 70.6 |
| ARC-E | 80.6 | 88.3 | 88.6 | 73.0 | 82.4 | 88.3 | 89.0 |
| WinoGrande | 65.4 | 73.9 | 79.4 | 58.2 | 64.7 | 74.3 | 78.8 |
| BBH | 42.4 | 69.4 | 74.8 | 28.4 | 50.9 | 72.6 | 77.7 |
| DROP | 53.2 | 71.5 | 75.2 | 42.4 | 60.1 | 72.2 | 77.2 |

> 表 9: 预训练阶段后的事实性, 常识性能和推理能力. Factuality and common-sense. In Table 9, we report the performance of our new pre-trained benchmarks compared to previous versions. We consider several standard benchmarks, namely HellaSwag (Zellers et al., 2019), BoolQ (Clark et al., 2019), PIQA (Bisk et al., 2019), SIQA (Sap et al., 2019), TriviaQA (Joshi et al., 2017), Natural Questions (Kwiatkowski et al., 2019), ARC-C and ARC-E (Chollet, 2019), WinoGrande (Sakaguchi et al., 2019), BBH (Suzgun et al., 2022), DROP (Dua et al., 2019). Evaluation details are described in Table 19. Overall, our models are in the same ballpark as Gemma 2, which is encouraging since these abilities are not the focus of the improvements brought in this version. 事实性与常识. 在表 9 中, 我们报告了新预训练基准测试与前代版本的性能对比. 我们考虑了多个标准基准测试, 即 HellaSwag (Zellers et al., 2019), BoolQ (Clark et al., 2019), PIQA (Bisk et al., 2019), SIQA (Sap et al., 2019), TriviaQA (Joshi et al., 2017), Natural Questions (Kwiatkowski et al., 2019), ARC-C 和 ARC-E (Chollet, 2019), WinoGrande (Sakaguchi et al., 2019), BBH (Suzgun et al., 2022), DROP (Dua et al., 2019).

评估细节在表 19 中描述. 总体而言, 我们的模型与 Gemma 2 处于同一水平, 这是令人鼓舞的, 因为这些能力并非该版本改进的重点. STEM and code.

The details of our performance on STEM and Code are in Table 10. We consider several standard benchmarks, namely MMLU (Hendrycks et al., 2020), MMLU-Pro (Wang et al., 2024), AGIEval (Zhong et al., 2023), MATH (Hendrycks et al., 2021), GSM8K (Cobbe et al., 2021), GPQA (Rein et al., 2023), MBPP (Austin et al., 2021), HumanEval (Chen et al., 2021). Evaluation details are described in Table 19. Overall we see a consistent improvement over STEM abilities across our pre-trained models. On code, we see a similar improvement for the 4B and 12B models but not on the 27B. STEM 与代码.

我们在 STEM 和代码上的性能细节见表 10. 我们考虑了多个标准基准测试, 即 MMLU (Hendrycks et al., 2020), MMLU-Pro (Wang et al., 2024), AGIEval (Zhong et al., 2023), MATH (Hendrycks et al., 2021), GSM8K (Cobbe et al., 2021), GPQA (Rein et al., 2023), MBPP (Austin et al., 2021), HumanEval (Chen et al., 2021). 评估细节在表 19 中描述. 总体而言, 我们的预训练模型在 STEM 能力上表现出一致的改进. 在代码方面, 4B 和 12B 模型有类似的改进, 但 27B 没有.

| Benchmark | Gemma 2 2B | Gemma 2 9B | Gemma 2 27B | Gemma 3 4B | Gemma 3 12B | Gemma 3 27B |
|-----------|------------|------------|-------------|------------|-------------|-------------|
| MMLU | 52.2 | 71.2 | 75.2 | 59.6 | 74.5 | 78.6 |
| MMLU-Pro | 22.2 | 43.7 | 49.4 | 29.2 | 45.3 | 52.2 |
| AGIEval | 31.6 | 53.1 | 55.1 | 42.1 | 57.4 | 66.2 |
| MATH | 16.4 | 36.4 | 42.1 | 24.2 | 43.3 | 50.0 |
| GSM8K | 25.0 | 70.2 | 74.6 | 38.4 | 71.0 | 82.6 |
| GPQA Diamond | 12.5 | 24.8 | 26.3 | 15.0 | 25.4 | 24.3 |
| MBPP | 31.0 | 51.2 | 60.8 | 46.0 | 60.4 | 65.6 |
| HumanEval | 19.5 | 40.2 | 51.2 | 36.0 | 45.7 | 48.8 |

Table 10
| STEM and code performance after pre-training phas.

| 基准测试 | Gemma 2 2B | Gemma 2 9B | Gemma 2 27B | Gemma 3 4B | Gemma 3 12B | Gemma 3 27B |
|----------|------------|------------|-------------|------------|-------------|-------------|
| MMLU | 52.2 | 71.2 | 75.2 | 59.6 | 74.5 | 78.6 |
| MMLU-Pro | 22.2 | 43.7 | 49.4 | 29.2 | 45.3 | 52.2 |
| AGIEval | 31.6 | 53.1 | 55.1 | 42.1 | 57.4 | 66.2 |
| MATH | 16.4 | 36.4 | 42.1 | 24.2 | 43.3 | 50.0 |
| GSM8K | 25.0 | 70.2 | 74.6 | 38.4 | 71.0 | 82.6 |
| GPQA Diamond | 12.5 | 24.8 | 26.3 | 15.0 | 25.4 | 24.3 |
| MBPP | 31.0 | 51.2 | 60.8 | 46.0 | 60.4 | 65.6 |
| HumanEval | 19.5 | 40.2 | 51.2 | 36.0 | 45.7 | 48.8 |

> 表 10: 预训练阶段后的 STEM 和代码性.

| Benchmark | Gemma 3 4B | Gemma 3 12B | Gemma 3 27B |
|-----------|------------|-------------|-------------|
| COCO Caption | 102 | 111 | 116 |
| DocVQA | 72.8 | 82.3 | 85.6 |
| InfoVQA | 44.1 | 54.8 | 59.4 |
| MMMU | 39.2 | 50.3 | 56.1 |
| TextVQA | 58.9 | 66.5 | 68.6 |
| RealWorldQA | 45.5 | 52.2 | 53.9 |
| ReMI | 27.3 | 38.5 | 44.8 |
| AI2D | 63.2 | 75.2 | 79.0 |
| ChartQA | 63.6 | 74.7 | 76.3 |
| VQAv2 | 63.9 | 71.2 | 72.9 |
| BLINK | 38.0 | 35.9 | 39.6 |
| OK-VQA | 51.0 | 58.7 | 60.2 |
| TallyQA | 42.5 | 51.8 | 54.3 |
| SpatialSense VQA | 50.9 | 60.0 | 59.4 |
| CountBench VQA | 26.1 | 17.8 | 68.0 |

Table 11
| Multimodal performance after pre-training phase. The scores are on the val split of each dataset without P&.

| 基准测试 | Gemma 3 4B | Gemma 3 12B | Gemma 3 27B |
|----------|------------|-------------|-------------|
| COCO Caption | 102 | 111 | 116 |
| DocVQA | 72.8 | 82.3 | 85.6 |
| InfoVQA | 44.1 | 54.8 | 59.4 |
| MMMU | 39.2 | 50.3 | 56.1 |
| TextVQA | 58.9 | 66.5 | 68.6 |
| RealWorldQA | 45.5 | 52.2 | 53.9 |
| ReMI | 27.3 | 38.5 | 44.8 |
| AI2D | 63.2 | 75.2 | 79.0 |
| ChartQA | 63.6 | 74.7 | 76.3 |
| VQAv2 | 63.9 | 71.2 | 72.9 |
| BLINK | 38.0 | 35.9 | 39.6 |
| OK-VQA | 51.0 | 58.7 | 60.2 |
| TallyQA | 42.5 | 51.8 | 54.3 |
| SpatialSense VQA | 50.9 | 60.0 | 59.4 |
| CountBench VQA | 26.1 | 17.8 | 68.0 |

> 表 11: 预训练阶段后的多模态性能. 分数为各数据集 val 集上的结果, 未使用 P&S. Image understanding. In Table 11, we report performance across a variety of visual question answer benchmarks for the different models that were trained with a vision encoder, namely COCO Caption (Chen et al., 2015), DocVQA (Mathew et al., 2020), InfographicVQA (Mathew et al., 2022), MMMU (Yue et al., 2023), TextVQA (Singh et al., 2019), RealWorldQA (Rea), ReMI (Kazemi et al., 2024a), AI2D (Kembhavi et al., 2016), ChartQA (Masry et al., 2022), VQA v2 (Goyal et al., 2017), BLINK (Fu et al., 2024), OK-VQA (Marino et al., 2019), TallyQA (Acharya et al., 2018), SpatialSense VQA (Yang et al., 2019), CountBench VQA (Paiss et al., 2023). Evaluation details are described in Table 20.

图像理解. 在表 11 中, 我们报告了使用视觉编码器训练的不同模型在多种视觉问答基准测试上的性能, 即 COCO Caption (Chen et al., 2015), DocVQA (Mathew et al., 2020), InfographicVQA (Mathew et al., 2022), MMMU (Yue et al., 2023), TextVQA (Singh et al., 2019), RealWorldQA (Rea), ReMI (Kazemi et al., 2024a), AI2D (Kembhavi et al., 2016), ChartQA (Masry et al., 2022), VQA v2 (Goyal et al., 2017), BLINK (Fu et al., 2024), OK-VQA (Marino et al., 2019), TallyQA (Acharya et al., 2018), SpatialSense VQA (Yang et al., 2019), CountBench VQA (Paiss et al., 2023). 评估细节在表 20 中描述. ---

| Benchmark | PaliGemma 2 2B | PaliGemma 2 9B | PaliGemma 2 27B | Gemma 3 4B | Gemma 3 12B | Gemma 3 27B |
|-----------|---------------|----------------|-----------------|------------|-------------|------------|
| DocVQA | 81.6 | 86.3 | 85.1 | 86.1 | 89.0 | 89.5 |
| InfoVQA | 41.4 | 53.1 | 50.2 | 55.6 | 61.6 | 64.6 |
| TextVQA | 76.3 | 76.3 | 75.1 | 79.1 | 81.6 | 83.2 |
| ChartQA | 70.7 | 79.1 | 71.3 | 79.8 | 83.5 | 83.4 |
| AI2D | 76.0 | 84.4 | 84.6 | 80.9 | 85.6 | 86.5 |
| OKVQA | 64.1 | 68.6 | 70.6 | 65.2 | 69.3 | 71.1 |
| CountBenchQA | 82.0 | 85.3 | 87.4 | 79.4 | 83.5 | 87.8 |
| COCO Caption | 143. | 145. | 145. | 143. | 143. | 144. |
| VQAv2 | 84.8 | 85.8 | 85.8 | 84.1 | 84.9 | 85.1 |
| Tally QA | 80.6 | 82.4 | 82.1 | 79.0 | 81.3 | 81.7 |

Table 12
| Performance of pre-trained checkpoints after fine-tuning on multi-modal benchmarks (without P&S). PaliGemma 2 was transferred at 896x896 resolution for the first four benchmarks, and at 448x448 resolution for the other.

| 基准测试 | PaliGemma 2 2B | PaliGemma 2 9B | PaliGemma 2 27B | Gemma 3 4B | Gemma 3 12B | Gemma 3 27B |
|----------|----------------|----------------|-----------------|------------|-------------|------------|
| DocVQA | 81.6 | 86.3 | 85.1 | 86.1 | 89.0 | 89.5 |
| InfoVQA | 41.4 | 53.1 | 50.2 | 55.6 | 61.6 | 64.6 |
| TextVQA | 76.3 | 76.3 | 75.1 | 79.1 | 81.6 | 83.2 |
| ChartQA | 70.7 | 79.1 | 71.3 | 79.8 | 83.5 | 83.4 |
| AI2D | 76.0 | 84.4 | 84.6 | 80.9 | 85.6 | 86.5 |
| OKVQA | 64.1 | 68.6 | 70.6 | 65.2 | 69.3 | 71.1 |
| CountBenchQA | 82.0 | 85.3 | 87.4 | 79.4 | 83.5 | 87.8 |
| COCO Caption | 143. | 145. | 145. | 143. | 143. | 144. |
> 表 12: 在多模态基准测试上微调后的预训练检查点性能(不使用 P&S). PaliGemma 2 在前四个基准测试上以 896x896 分辨率迁移, 其他以 448x448 分辨率迁移. Comparison to PaliGemma 2. We fine-tune multimodal Gemma 3 pre-trained checkpoints following the protocol from Steiner et al. (2024) - only learning rate is swept, otherwise the same transfer settings are used. The results in Table 12 show that Gemma 3 excels at benchmarks involving document understanding, even outperforming the larger PaliGemma 2 variant. Note that due to average pooling in the vision encoder the Gemma 3 4B and 12B models are about 10x cheaper to transfer compared with the PaliGemma 2 9B and 27B models at the same 896 x 896 resolution. Gemma 3 also performs better on AI2D and OKVQA, but PaliGemma 2 performs slightly better on VQAv2 and COCO caption.

与 PaliGemma 2 的对比. 我们按照 Steiner et al. (2024) 的协议对多模态 Gemma 3 预训练检查点进行微调 - 仅对学习率进行搜索, 其他迁移设置保持不变. 表 12 的结果显示, Gemma 3 在涉及文档理解的基准测试中表现出色, 甚至超越了更大的 PaliGemma 2 变体. 需要注意的是, 由于视觉编码器中的平均池化, 在相同的 896 x 896 分辨率下, Gemma 3 4B 和 12B 模型的迁移成本比 PaliGemma 2 9B 和 27B 模型低约 10 倍.

Gemma 3 在 AI2D 和 OKVQA 上也表现更好, 但 PaliGemma 2 在 VQAv2 和 COCO Caption 上略胜一筹.

| Benchmark | Gemma 2 2B | Gemma 2 9B | Gemma 2 27B | Gemma 3 1B | Gemma 3 4B | Gemma 3 12B | Gemma 3 27B |
|-----------|------------|------------|-------------|------------|------------|-------------|-------------|
| MGSM | 18.7 | 57.3 | 68.0 | 2.04 | 34.7 | 64.3 | 74.3 |
| Global-MMLU-Lite | 43.3 | 64.0 | 69.4 | 24.9 | 57.0 | 69.4 | 75.7 |
| WMT24++ | 38.8 | 50.3 | 53.0 | 36.7 | 48.4 | 53.9 | 55.7 |
| FLoRes | 30.2 | 41.3 | 44.3 | 29.5 | 39.2 | 46.0 | 48.8 |
| XQuAD | 53.7 | 72.2 | 73.9 | 43.9 | 68.0 | 74.5 | 76.8 |
| ECLeKTic | 8.29 | 14.0 | 17.1 | 4.69 | 11.0 | 17.2 | 24.4 |
| IndicGenBench | 47.4 | 59.3 | 62.1 | 41.4 | 57.2 | 61.7 | 63.4 |

Table 13
| Multilingual performance after the pre-training phase. IndicGenBench is an average over benchmarks reported in Table 14. | 基准测试 | Gemma 2 2B | Gemma 2 9B | Gemma 2 27B | Gemma 3 1B | Gemma 3 4B | Gemma 3 12B | Gemma 3 27B |
|----------|------------|------------|-------------|------------|------------|-------------|-------------|
| MGSM | 18.7 | 57.3 | 68.0 | 2.04 | 34.7 | 64.3 | 74.3 |
| Global-MMLU-Lite | 43.3 | 64.0 | 69.4 | 24.9 | 57.0 | 69.4 | 75.7 |
| WMT24++ | 38.8 | 50.3 | 53.0 | 36.7 | 48.4 | 53.9 | 55.7 |
| FLoRes | 30.2 | 41.3 | 44.3 | 29.5 | 39.2 | 46.0 | 48.8 |
| XQuAD | 53.7 | 72.2 | 73.9 | 43.9 | 68.0 | 74.5 | 76.8 |
| ECLeKTic | 8.29 | 14.0 | 17.1 | 4.69 | 11.0 | 17.2 | 24.4 |
| IndicGenBench | 47.4 | 59.3 | 62.1 | 41.4 | 57.2 | 61.7 | 63.4 |

> 表 13: 预训练阶段后的多语言性能. IndicGenBench 是表 14 中报告的基准测试的平均值. Multilinguality. In Table 13 we report the performance of the pre-trained models on multilingual tasks. We apply in-context learning with multi-shot prompting and present results on the following benchmarks: MGSM (Shi et al., 2023), Global-MMLU-Lite (Singh et al., 2024b), WMT24++ (Deutsch et al., 2025), FLoRes (Goyal et al., 2022), XQuAD (Artetxe et al., 2020), ECLeKTic (Goldman et al., 2025), IndicGenBench (Singh et al., 2024a), XOR QA (Asai et al., 2020). Evaluation details are described in Table 19.

多语言性. 在表 13 中, 我们报告了预训练模型在多语言任务上的性能. 我们使用多 shot 提示进行上下文学习, 并在以下基准测试上展示结果: MGSM (Shi et al., 2023), Global-MMLU-Lite (Singh et al., 2024b), WMT24++ (Deutsch et al., 2025), FLoRes (Goyal et al., 2022), XQuAD (Artetxe et al., 2020), ECLeKTic (Goldman et al., 2025), IndicGenBench (Singh et al., 2024a), XOR QA (Asai et al., 2020). 评估细节在表 19 中描述.

| Benchmark | Gemma 2 2B | Gemma 2 9B | Gemma 2 27B | Gemma 3 1B | Gemma 3 4B | Gemma 3 12B | Gemma 3 27B |
|-----------|------------|------------|-------------|------------|------------|-------------|-------------|
| XQuAD Indic | 54.3 | 73.1 | 74.9 | 43.1 | 68.3 | 75.2 | 77.8 |
| XORQA in-en | 66.2 | 69.3 | 72.5 | 56.3 | 68.3 | 69.8 | 70.4 |
| XORQA in-xx | 31.2 | 40.8 | 44.3 | 27.1 | 39.8 | 43.8 | 46.0 |
| Flores Indic | 38.1 | 54.0 | 56.9 | 39.0 | 52.3 | 58.0 | 59.5 |

Table 14
| Detailed IndicGenBench performance after the pre-training phas.

| 基准测试 | Gemma 2 2B | Gemma 2 9B | Gemma 2 27B | Gemma 3 1B | Gemma 3 4B | Gemma 3 12B | Gemma 3 27B |
|----------|------------|------------|-------------|------------|------------|-------------|-------------|
| XQuAD Indic | 54.3 | 73.1 | 74.9 | 43.1 | 68.3 | 75.2 | 77.8 |
| XORQA in-en | 66.2 | 69.3 | 72.5 | 56.3 | 68.3 | 69.8 | 70.4 |
| XORQA in-xx | 31.2 | 40.8 | 44.3 | 27.1 | 39.8 | 43.8 | 46.0 |
| Flores Indic | 38.1 | 54.0 | 56.9 | 39.0 | 52.3 | 58.0 | 59.5 |

> 表 14: 预训练阶段后的详细 IndicGenBench 性能. Long context. In Table 15 we report the performance of pre-trained and fine-tuned models on long context benchmarks. We include RULER (Hsieh et al., 2024) and MRCR (Vodrahalli et al., 2024) benchmarks evaluating at 32K and 128K sequence lengths.

长上下文. 在表 15 中, 我们报告了预训练模型和微调模型在长上下文基准测试上的性能. 我们包含 RULER (Hsieh et al., 2024) 和 MRCR (Vodrahalli et al., 2024) 基准测试, 在 32K 和 128K 序列长度上进行评估.

### 8.1. IT 模型的性能

We report in Table 18, additional benchmarks on our IT models. Note that N2C refers to Natural2Code, the Gemini 1.0 internal held-out dataset, which uses author-generated sources instead of web-based information. BBEH refers to BIG-Bench Extra Hard (Kazemi et al., 2025), a challenging LLM reasoning benchmark that aggregates several reasoning tasks (Fatemi et al., 2024; Hessel et al., 2022; Kazemi et al., 2023, 2024b; Kıcıman et al., 2023; Nie et al., 2024; Sánchez et al., 2024; Shah et al., 2024; Tyen et al., 2023; White et al., 2024; Yamada et al., 2023; Zhang et al., 2024). ECLeKTic refers to Goldman et al. (2025). We report the micro average score. More evaluation details are described in Table 21.

我们在表 18 中报告了 IT 模型在更多基准测试上的表现. 需要注意的是, N2C 指的是 Natural2Code, 这是 Gemini 1.0 的内部 held-out 数据集, 使用作者生成的源而非基于网络的信息. BBEH 指的是 BIG-Bench Extra Hard (Kazemi et al., 2025), 一个具有挑战性的 LLM 推理基准测试, 聚合了多个推理任务 (Fatemi et al., 2024; Hessel et al., 2022; Kazemi et al., 2023, 2024b; Kıcıman et al., 2023; Nie et al., 2024; Sánchez et al., 2024; Shah et al., 2024; Tyen et al., 2023; White et al., 2024; Yamada et al., 2023; Zhang et al., 2024). ECLeKTic 指的是 Goldman et al. (2025). 我们报告微平均分数. 更多评估细节在表 21 中描述. ---

| Benchmark | Context | Gemma 3 PT 4B | Gemma 3 PT 12B | Gemma 3 PT 27B | Gemma 3 IT 4B | Gemma 3 IT 12B | Gemma 3 IT 27B |
|-----------|---------|---------------|----------------|----------------|---------------|----------------|----------------|
| RULER | 32K | 67.1 | 90.6 | 85.9 | 61.4 | 80.3 | 91.1 |
| RULER | 128K | 51.7 | 80.7 | 72.9 | 46.8 | 57.1 | 66.0 |
| MRCR | 32K | 44.7 | 59.8 | 63.2 | 49.8 | 53.7 | 63.2 |
| MRCR | 128K | 40.6 | 56.9 | 60.0 | 44.6 | 49.8 | 59.3 |

Table 15
| Performance of pre-trained (PT) and instruction fine-tuned (IT) models on long context benchmarks at different context length.

| 基准测试 | 上下文 | Gemma 3 PT 4B | Gemma 3 PT 12B | Gemma 3 PT 27B | Gemma 3 IT 4B | Gemma 3 IT 12B | Gemma 3 IT 27B |
|----------|--------|---------------|----------------|----------------|---------------|----------------|----------------|
| RULER | 32K | 67.1 | 90.6 | 85.9 | 61.4 | 80.3 | 91.1 |
| RULER | 128K | 51.7 | 80.7 | 72.9 | 46.8 | 57.1 | 66.0 |
| MRCR | 32K | 44.7 | 59.8 | 63.2 | 49.8 | 53.7 | 63.2 |
| MRCR | 128K | 40.6 | 56.9 | 60.0 | 44.6 | 49.8 | 59.3 |

> 表 15: 预训练(PT)和指令微调(IT)模型在不同上下文长度下的长上下文基准测试性能.

| Benchmark | Gemma 3 IT 4B | Gemma 3 IT 12B | Gemma 3 IT 27B |
|-----------|---------------|----------------|----------------|
| MMMU (val) | 48.8 | 59.6 | 64.9 |
| DocVQA | 75.8 | 87.1 | 86.6 |
| InfoVQA | 50.0 | 64.9 | 70.6 |
| TextVQA | 57.8 | 67.7 | 65.1 |
| AI2D | 74.8 | 84.2 | 84.5 |
| ChartQA | 68.8 | 75.7 | 78.0 |
| VQAv2 (val) | 62.4 | 71.6 | 71.0 |
| MathVista (testmini) | 50.0 | 62.9 | 67.6 |

Table 16
| Performance of instruction fine-tuned (IT) models on multimodal benchmarks. If not mentioned, these results are on the final test set of each dataset with P&S applie.

| 基准测试 | Gemma 3 IT 4B | Gemma 3 IT 12B | Gemma 3 IT 27B |
|----------|---------------|----------------|----------------|
| MMMU (val) | 48.8 | 59.6 | 64.9 |
| DocVQA | 75.8 | 87.1 | 86.6 |
| InfoVQA | 50.0 | 64.9 | 70.6 |
| TextVQA | 57.8 | 67.7 | 65.1 |
| AI2D | 74.8 | 84.2 | 84.5 |
| ChartQA | 68.8 | 75.7 | 78.0 |
| VQAv2 (val) | 62.4 | 71.6 | 71.0 |
| MathVista (testmini) | 50.0 | 62.9 | 67.6 |

> 表 16: 指令微调(IT)模型在多模态基准测试上的性能. 如未特别说明, 这些结果为各数据集最终测试集上使用 P&S 的结果. Additional multimodal evaluations. Gemma 3 IT models were evaluated on common vision benchmarks following the evaluation protocol of Gemini 1.5 (Gemini Team, 2024). The results are given in Table 16 when P&S is activated.

额外的多模态评估. Gemma 3 IT 模型按照 Gemini 1.5 (Gemini Team, 2024) 的评估协议在常见视觉基准测试上进行了评估. 表 16 给出了激活 P&S 时的结果.

### 8.2. IT 模型在视频理解上的性能

| Benchmark | Gemma 3 IT 4B | Gemma 3 IT 12B | Gemma 3 IT 27B |
|-----------|---------------|----------------|----------------|
| Perception Test MCVQA | 50.6 | 54.9 | 58.1 |
| ActivityNet-QA | 46.3 | 50.4 | 52.8 |

Table 17
| Performance of instruction fine-tuned (IT) models on vision understanding benchmarks using 0 shot with 16 frames linspac.

| 基准测试 | Gemma 3 IT 4B | Gemma 3 IT 12B | Gemma 3 IT 27B |
|----------|---------------|----------------|----------------|
| Perception Test MCVQA | 50.6 | 54.9 | 58.1 |
| ActivityNet-QA | 46.3 | 50.4 | 52.8 |

> 表 17: 指令微调(IT)模型在视觉理解基准测试上的性能, 使用 0 shot, 16 帧等间距采样. Perception Test consists of real-world videos designed to show perceptually interesting situations and we report results on the multiple choice video QA benchmark in terms of top-1 accuracy. ActivityNet-QA reports standard gpt-evaluation. Perception Test 由旨在展示感知上有趣情境的真实世界视频组成, 我们在多项选择视频 QA 基准测试上以 top-1 准确率报告结果. ActivityNet-QA 报告标准 GPT 评估结果. ---

| Benchmark | Gemma 2 2B | Gemma 2 9B | Gemma 2 27B | Gemma 3 1B | Gemma 3 4B | Gemma 3 12B | Gemma 3 27B |
|-----------|------------|------------|-------------|------------|------------|-------------|-------------|
| MMLU | 56.1 | 71.3 | 76.2 | 38.8 | 58.1 | 71.9 | 76.9 |
| MBPP | 36.6 | 59.2 | 67.4 | 35.2 | 63.2 | 73.0 | 74.4 |
| HumanEval | 20.1 | 40.2 | 51.8 | 41.5 | 71.3 | 85.4 | 87.8 |
| N2C | 46.8 | 68.3 | 77.3 | 56.0 | 70.3 | 80.7 | 84.5 |
| LiveCodeBench | 7.0 | 20.0 | 29.0 | 5.0 | 23.0 | 32.0 | 39.0 |
| GSM8K | 62.6 | 88.1 | 91.1 | 62.8 | 89.2 | 94.4 | 95.9 |
| MATH | 27.2 | 49.4 | 55.6 | 48.0 | 75.6 | 83.8 | 89.0 |
| HiddenMath | 2.0 | 8.0 | 12.0 | 15.0 | 42.0 | 51.0 | 56.0 |
| BBH | 41.4 | 69.0 | 74.9 | 39.1 | 72.2 | 85.7 | 87.6 |
| BBEH | 5.9 | 9.8 | 14.8 | 7.2 | 11.0 | 16.3 | 19.3 |
| IFEval | 80.4 | 88.4 | 91.1 | 80.2 | 90.2 | 88.9 | 90.4 |
| Global-MMLU-Lite | 41.9 | 64.8 | 68.6 | 34.2 | 54.5 | 69.5 | 75.1 |
| ECLeKTic | 5.3 | 11.8 | 17.6 | 1.4 | 4.6 | 10.3 | 16.7 |
| WMT24++ | 37.4 | 48.7 | 51.7 | 35.9 | 46.8 | 51.6 | 53.4 |

Table 18
| Performance of instruction fine-tuned (IT) models of different sizes on more internal and external benchmark.

| 基准测试 | Gemma 2 2B | Gemma 2 9B | Gemma 2 27B | Gemma 3 1B | Gemma 3 4B | Gemma 3 12B | Gemma 3 27B |
|----------|------------|------------|-------------|------------|------------|-------------|-------------|
| MMLU | 56.1 | 71.3 | 76.2 | 38.8 | 58.1 | 71.9 | 76.9 |
| MBPP | 36.6 | 59.2 | 67.4 | 35.2 | 63.2 | 73.0 | 74.4 |
| HumanEval | 20.1 | 40.2 | 51.8 | 41.5 | 71.3 | 85.4 | 87.8 |
| N2C | 46.8 | 68.3 | 77.3 | 56.0 | 70.3 | 80.7 | 84.5 |
| LiveCodeBench | 7.0 | 20.0 | 29.0 | 5.0 | 23.0 | 32.0 | 39.0 |
| GSM8K | 62.6 | 88.1 | 91.1 | 62.8 | 89.2 | 94.4 | 95.9 |
| MATH | 27.2 | 49.4 | 55.6 | 48.0 | 75.6 | 83.8 | 89.0 |
| HiddenMath | 2.0 | 8.0 | 12.0 | 15.0 | 42.0 | 51.0 | 56.0 |
| BBH | 41.4 | 69.0 | 74.9 | 39.1 | 72.2 | 85.7 | 87.6 |
| BBEH | 5.9 | 9.8 | 14.8 | 7.2 | 11.0 | 16.3 | 19.3 |
| IFEval | 80.4 | 88.4 | 91.1 | 80.2 | 90.2 | 88.9 | 90.4 |
| Global-MMLU-Lite | 41.9 | 64.8 | 68.6 | 34.2 | 54.5 | 69.5 | 75.1 |
| ECLeKTic | 5.3 | 11.8 | 17.6 | 1.4 | 4.6 | 10.3 | 16.7 |
| WMT24++ | 37.4 | 48.7 | 51.7 | 35.9 | 46.8 | 51.6 | 53.4 |

> 表 18: 不同规模的指令微调(IT)模型在更多内部和外部基准测试上的性能. ---

| Evaluation | Metric | Type | n-shot | COT | Norm |
|------------|--------|------|--------|-----|------|
| MBPP | pass@1 | sampling | 3-shot | | |
| HumanEval | pass@1 | sampling | 0-shot | | |
| HellaSwag | Accuracy | scoring | 10-shot | | Char-Len |
| BoolQ | Accuracy | scoring | 0-shot | | Char-Len |
| PIQA | Accuracy | scoring | 0-shot | | Char-Len |
| SIQA | Accuracy | scoring | 0-shot | | Char-Len |
| TriviaQA | Accuracy | sampling | 5-shot | | |
| Natural Questions | Accuracy | sampling | 5-shot | | |
| ARC-C | Accuracy | scoring | 25-shot | | Char-Len |
| ARC-E | Accuracy | scoring | 0-shot | | Char-Len |
| WinoGrande | Accuracy | scoring | 5-shot | | Char-Len |
| BBH | Accuracy | sampling | few-shot | Yes | |
| DROP | Token F1 score | sampling | 1-shot | | |
| AGIEval | Accuracy | sampling | 3-5-shot | | |
| MMLU | Accuracy | scoring | 5-shot | | Char-Len |
| MATH | Accuracy | sampling | 4-shot | Yes | |
| GSM8K | Accuracy | sampling | 8-shot | Yes | |
| GPQA Diamond | Accuracy | sampling | 5-shot | Yes | |
| MMLU-Pro | Accuracy | sampling | 5-shot | Yes | |
| MGSM | Accuracy | sampling | 8-shot | | |
| FLoRes | CHaRacter-level F-score | sampling | 1-shot | | |
| Global-MMLU-Lite | Accuracy | scoring | 5-shot | | Char-Len |
| XQuAD | CHaRacter-level F-score | sampling | 5-shot | | |
| WMT24++ | CHaRacter-level F-score | sampling | 5-shot | | |
| ECLeKTic | ECLeKTic score | sampling | 2-shot | | First-line/strip |
| XQuAD Indic | CHaRacter-level F-score | sampling | 5-shot | | |
| XOR QA IN-EN | CHaRacter-level F-score | sampling | 5-shot | | |
| XOR QA IN-XX | CHaRacter-level F-score | sampling | 5-shot | | |
| FLoRes Indic | CHaRacter-level F-score | sampling | 5-shot | | |
| RULER | Accuracy | sampling | 0-shot | | |
| MRCR | MRCR score | sampling | few-shot | | |

Table 19
| Details on text benchmarks. Char-Len stands for Character Length Normalization and COT stands for Chain-Of-Thought promptin.

| 评测 | 指标 | 类型 | n-shot | COT | 归一化 |
|------|------|------|--------|-----|--------|
| MBPP | pass@1 | sampling | 3-shot | | |
| HumanEval | pass@1 | sampling | 0-shot | | |
| HellaSwag | Accuracy | scoring | 10-shot | | Char-Len |
| BoolQ | Accuracy | scoring | 0-shot | | Char-Len |
| PIQA | Accuracy | scoring | 0-shot | | Char-Len |
| SIQA | Accuracy | scoring | 0-shot | | Char-Len |
| TriviaQA | Accuracy | sampling | 5-shot | | |
| Natural Questions | Accuracy | sampling | 5-shot | | |
| ARC-C | Accuracy | scoring | 25-shot | | Char-Len |
| ARC-E | Accuracy | scoring | 0-shot | | Char-Len |
| WinoGrande | Accuracy | scoring | 5-shot | | Char-Len |
| BBH | Accuracy | sampling | few-shot | Yes | |
| DROP | Token F1 score | sampling | 1-shot | | |
| AGIEval | Accuracy | sampling | 3-5-shot | | |
| MMLU | Accuracy | scoring | 5-shot | | Char-Len |
| MATH | Accuracy | sampling | 4-shot | Yes | |
| GSM8K | Accuracy | sampling | 8-shot | Yes | |
| GPQA Diamond | Accuracy | sampling | 5-shot | Yes | |
| MMLU-Pro | Accuracy | sampling | 5-shot | Yes | |
| MGSM | Accuracy | sampling | 8-shot | | |
| FLoRes | CHaRacter-level F-score | sampling | 1-shot | | |
| Global-MMLU-Lite | Accuracy | scoring | 5-shot | | Char-Len |
| XQuAD | CHaRacter-level F-score | sampling | 5-shot | | |
| WMT24++ | CHaRacter-level F-score | sampling | 5-shot | | |
| ECLeKTic | ECLeKTic score | sampling | 2-shot | | First-line/strip |
| XQuAD Indic | CHaRacter-level F-score | sampling | 5-shot | | |
| XOR QA IN-EN | CHaRacter-level F-score | sampling | 5-shot | | |
| XOR QA IN-XX | CHaRacter-level F-score | sampling | 5-shot | | |
| FLoRes Indic | CHaRacter-level F-score | sampling | 5-shot | | |
| RULER | Accuracy | sampling | 0-shot | | |
| MRCR | MRCR score | sampling | few-shot | | |

> 表 19: 文本基准测试详情. Char-Len 表示 Character Length Normalization(字符长度归一化), COT 表示 Chain-Of-Thought prompting(思维链提示). ---

| Evaluation | Metric | Type | n-shot |
|------------|--------|------|--------|
| COCO Caption | Cider score | sampling | 4-shot |
| DocVQA | ANLS score | sampling | 4-shot |
| InfographicVQA | ANLS score | sampling | 4-shot |
| MMMU | Accuracy | sampling | 3-shot text only |
| TextVQA | Accuracy | sampling | 4-shot |
| RealWorldQA | Accuracy | sampling | 4-shot text only |
| ReMI | Accuracy | sampling | 4-shot |
| AI2D | Accuracy | sampling | 4-shot |
| ChartQA | Accuracy | sampling | 4-shot |
| VQA v2 | Accuracy | sampling | 4-shot |
| BLINK | Accuracy | sampling | 0-shot |
| OK-VQA | Accuracy | sampling | 4-shot |
| TallyQA | Accuracy | sampling | 4-shot |
| SpatialSense VQA | Accuracy | sampling | 4-shot |
| CountBench VQA | Accuracy | sampling | 0-shot |

Table 20
| Details on vision benchmarks. No Chain-Of-Thought prompting nor normalizatio.

| 评测 | 指标 | 类型 | n-shot |
|------|------|------|--------|
| COCO Caption | Cider score | sampling | 4-shot |
| DocVQA | ANLS score | sampling | 4-shot |
| InfographicVQA | ANLS score | sampling | 4-shot |
| MMMU | Accuracy | sampling | 3-shot text only |
| TextVQA | Accuracy | sampling | 4-shot |
| RealWorldQA | Accuracy | sampling | 4-shot text only |
| ReMI | Accuracy | sampling | 4-shot |
| AI2D | Accuracy | sampling | 4-shot |
| ChartQA | Accuracy | sampling | 4-shot |
| VQA v2 | Accuracy | sampling | 4-shot |
| BLINK | Accuracy | sampling | 0-shot |
| OK-VQA | Accuracy | sampling | 4-shot |
| TallyQA | Accuracy | sampling | 4-shot |
| SpatialSense VQA | Accuracy | sampling | 4-shot |
| CountBench VQA | Accuracy | sampling | 0-shot |

> 表 20: 视觉基准测试详情. 不使用 Chain-Of-Thought prompting 或归一.

| Evaluation | Metric | Type | n-shot | COT |
|------------|--------|------|--------|-----|
| MMLU | Accuracy | sampling | 0-shot | |
| MBPP | pass@1 | sampling | 3-shot | |
| HumanEval | pass@1 | sampling | 0-shot | |
| N2C | pass@1 | sampling | 0-shot | |
| LiveCodeBench | Average over 8 samples | sampling | 0-shot | Yes |
| GSM8K | Accuracy | sampling | 0-shot | Yes |
| GPQA Diamond | Accuracy | sampling | 0-shot | Yes |
| MATH | Accuracy | sampling | 0-shot | |
| HiddenMath | Accuracy | sampling | 0-shot | |
| BBH | Accuracy | sampling | 0-shot | |
| BBEH | Accuracy | sampling | 0-shot | |
| IFEval | Accuracy | sampling | 0-shot | |
| Global-MMLU-lite | Accuracy | sampling | 0-shot | Yes |
| ECLeKTic | ECLeKTic score | sampling | 0-shot | |
| WMT24++ | CHaRacter-level F-score | sampling | 0-shot | |

Table 21
| Details on instruction fine-tuned (IT) benchmarks. No normalizatio.

| 评测 | 指标 | 类型 | n-shot | COT |
|------|------|------|--------|-----|
| MMLU | Accuracy | sampling | 0-shot | |
| MBPP | pass@1 | sampling | 3-shot | |
| HumanEval | pass@1 | sampling | 0-shot | |
| N2C | pass@1 | sampling | 0-shot | |
| LiveCodeBench | Average over 8 samples | sampling | 0-shot | Yes |
| GSM8K | Accuracy | sampling | 0-shot | Yes |
| GPQA Diamond | Accuracy | sampling | 0-shot | Yes |
| MATH | Accuracy | sampling | 0-shot | |
| HiddenMath | Accuracy | sampling | 0-shot | |
| BBH | Accuracy | sampling | 0-shot | |
| BBEH | Accuracy | sampling | 0-shot | |
| IFEval | Accuracy | sampling | 0-shot | |
| Global-MMLU-lite | Accuracy | sampling | 0-shot | Yes |
| ECLeKTic | ECLeKTic score | sampling | 0-shot | |
| WMT24++ | CHaRacter-level F-score | sampling | 0-shot | |

> 表 21: 指令微调(IT)基准测试详情. 不归一化.
