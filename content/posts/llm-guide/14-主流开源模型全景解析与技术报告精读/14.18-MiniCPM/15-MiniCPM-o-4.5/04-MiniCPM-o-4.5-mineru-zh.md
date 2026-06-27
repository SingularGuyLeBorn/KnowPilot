---
title: "MiniCPM-o 4.5 技术报告逐段翻译"
source: 03-MiniCPM-o-4.5-mineru-en.md
translated_by: "AI Agent"
date: 2026-05-23
---

# MiniCPM-o 4.5 技术报告逐段翻译

> 原文标题: MiniCPM-o 4.5: Towards Real-Time Full-Duplex Omni-Modal Interaction
> 原文链接: https://arxiv.org/abs/2604.27393
> 翻译基于: MinerU 英文提取稿 `03-MiniCPM-o-4.5-mineru-en.md`

---

## Abstract

**原文**:
Recent progress in multimodal large language models (MLLMs) has brought AI capabilities from static offline data processing to real-time streaming interaction, yet they still remain far from human-level multimodal interaction. The key bottlenecks are no longer modality coverage or latency alone, but the interaction paradigm itself. First, perception and response are still separated into alternating phases, preventing models from incorporating new inputs for timely adjustment during generation. Second, most current models remain reactive, responding only to explicit user requests instead of acting proactively in the evolving multimodal environment. We present MiniCPM-o 4.5, our latest effort towards human-like multimodal interaction, which mitigates these gaps by real-time full-duplex omni-modal interaction.

**译文**:
近期多模态大语言模型(MLLM)的进展, 已经把 AI 的能力从静态离线数据处理推进到实时流式交互, 但它们距离类人的多模态交互仍然相当遥远。当前的关键瓶颈, 已经不再只是模态覆盖范围或单纯的延迟问题, 而是交互范式本身。第一, 感知与响应仍然被分割为交替发生的两个阶段, 这使模型在生成过程中无法及时吸收新的输入并据此调整输出。第二, 大多数现有模型仍然是被动响应式的, 只会回应用户显式发出的请求, 而不是在持续变化的多模态环境中主动采取行动。我们提出 MiniCPM-o 4.5, 作为朝向类人多模态交互的最新尝试, 它通过实时、全双工、全模态交互来缓解这些缺口。

**原文**:
It can see, listen, and speak simultaneously in real-time, while also exhibiting proactive behaviors such as issuing reminders or comments based on its continuous understanding of the live scene. The key technique behind MiniCPM-o 4.5 is Omni-Flow, a unified streaming framework that aligns omni-modal inputs and outputs along a shared temporal axis. This formulation converts conventional turnbased interaction into a full-duplex, time-aligned process, enabling simultaneous perception and response and allowing proactive behavior to arise within the same framework.

**译文**:
该模型能够在实时条件下同时“看、听、说”, 并且还能表现出主动行为, 例如基于其对实时场景的持续理解, 主动发出提醒或评论。MiniCPM-o 4.5 背后的关键技术是 Omni-Flow, 这是一种统一的流式框架, 用共享的时间轴对齐全模态输入与输出。通过这种表述方式, 传统的轮次式交互被改写成一个全双工、时间对齐的过程, 从而实现了感知与响应的同时发生, 并使主动行为能够在同一框架中自然涌现。

**原文**:
With a total of 9B parameters, MiniCPM-o 4.5 approaches Gemini 2.5 Flash in vision-language capabilities, delivering state-of-the-art open-source performance at its scale. It also surpasses Qwen3-Omni-30B-A3B in omni-modal understanding and delivers better speech generation, with significantly higher computation efficiency. Driven by its efficient architecture design and inference optimization, the model can perform real-time full-duplex omni-modal interaction on edge devices with less than 12GB RAM cost. More importantly, MiniCPM-o 4.5 can be viewed as a representative example of a promising trend (Figure 2): Multimodal foundation models are shipping towards human-like interactive paradigms, poised to engage with the dynamic omni-modal world in the near future.

**译文**:
MiniCPM-o 4.5 总参数量为 9B, 在视觉语言能力上逼近 Gemini 2.5 Flash, 并在该规模级别上实现了开源模型中的最先进性能。它在全模态理解能力上超过了 Qwen3-Omni-30B-A3B, 在语音生成方面也表现更优, 同时具备显著更高的计算效率。依靠高效的架构设计与推理优化, 该模型可以在内存占用不足 12GB 的边缘设备上执行实时全双工全模态交互。更重要的是, MiniCPM-o 4.5 可以被视为一个具有代表性的信号(见图 2)：多模态基础模型正在向更接近类人的交互范式演进, 并有望在不久的将来真正参与到动态的全模态现实世界之中。

> 译者注：这篇报告真正要解决的问题不是“再加一个语音头”或“再加一个视频输入通道”, 而是把多模态交互从“轮流说话的回合制系统”推进到“边感知边输出的持续流系统”。这比传统 VLM 或语音助手难得多, 因为它要求模型在生成期间维持对环境变化的开放性, 而不是把输入阶段和输出阶段严格切开。

---

## 1 Introduction

**原文**:
Recent years have witnessed rapid progress in multimodal foundation models. AI capabilities have evolved from text-only interaction to multimodal understanding, and further to omni live streaming. However, despite this progress, current systems still fall short of human-like multimodal interaction.

**译文**:
近年来, 多模态基础模型取得了快速进展。AI 的能力已经从纯文本交互演进到多模态理解, 并进一步发展到全模态实时流交互。然而, 尽管进展显著, 当前系统距离类人的多模态交互仍有明显差距。

**原文**:
The key bottlenecks are no longer merely whether a model can process multiple modalities or achieve low latency. Instead, they lie in the interaction paradigm itself. Existing systems usually separate perception and response into alternating phases, causing blocked information flow during generation. Moreover, most models remain reactive and seldom act proactively based on continuous understanding of the environment.

**译文**:
当前的关键瓶颈已经不再只是模型是否能够处理多种模态, 或者是否能做到低延迟。更深层的问题在于交互范式本身。现有系统通常将感知与响应拆分为交替发生的两个阶段, 这会在生成过程中造成信息流阻塞。此外, 大多数模型仍然是被动响应的, 很少能够基于对环境的持续理解而主动采取行动。

**原文**:
To bridge this gap, we introduce MiniCPM-o 4.5, a model designed for realtime full-duplex omni-modal interaction. It continuously perceives visual and acoustic streams while generating text and speech outputs, and can also trigger proactive behaviors such as reminders and contextual comments.

**译文**:
为了弥合这一差距, 我们提出 MiniCPM-o 4.5, 一个专为实时全双工全模态交互而设计的模型。它能够在持续感知视觉流和声学流的同时, 生成文本与语音输出, 并且还能触发主动行为, 例如提醒和上下文相关评论。

> 译者注：这里的“主动行为”不是传统意义上的工具调用或任务执行, 而是更接近持续情境感知下的交互主导权转移。也就是说, 模型不仅在回答问题, 还会在它认为“现在应该说点什么”的时候主动发声。这是从 assistant 到 agent 的关键过渡点。

---

## 2 End-to-End Omni-Modal Architecture

**原文**:
MiniCPM-o 4.5 adopts an end-to-end omni-modal architecture in which modality encoders, the LLM backbone, and speech decoders are connected through token-level hidden states in a fully differentiable manner.

**译文**:
MiniCPM-o 4.5 采用端到端的全模态架构, 其中模态编码器、LLM 主干以及语音解码器通过 token 级别的隐藏状态以完全可微的方式连接起来。

**原文**:
The model consists of three major components: a multimodal encoder for visual and audio inputs, an LLM backbone responsible for omni-modal understanding and text generation, and speech decoders that transform hidden states into speech tokens and finally waveforms.

**译文**:
该模型包含三个主要组件：用于视觉和音频输入的多模态编码器; 负责全模态理解与文本生成的 LLM 主干; 以及将隐藏状态转换为语音 token 并最终合成为波形的语音解码器。

### 2.1 Visual Encoding

**原文**:
For visual inputs, we adopt a LLaVA-UHD style partition strategy. In full-duplex streaming mode, the maximum resolution is capped at 448×448, while in normal mode it can reach 2240×2240. Each slice is encoded by a SigLIP ViT encoder and then compressed by a resampler into a compact fixed-length representation.

**译文**:
对于视觉输入, 我们采用类似 LLaVA-UHD 的分块策略。在全双工流式模式下, 最大分辨率被限制为 448×448; 而在普通模式下, 最大分辨率则可以达到 2240×2240。每个切片先由 SigLIP ViT 编码器编码, 然后通过重采样器压缩成紧凑的固定长度表示。

**原文**:
This design yields a high compression ratio, significantly reducing the visual token burden imposed on the LLM backbone, which is critical for enabling real-time interaction.

**译文**:
这一设计带来了很高的压缩率, 显著减轻了视觉 token 给 LLM 主干带来的负担, 而这正是实现实时交互的关键条件之一。

### 2.2 Audio Encoding

**原文**:
For audio input, we employ a Whisper Medium encoder in a chunk-based streaming fashion. It produces 50 feature tokens per second, which are then compressed by a lightweight projector to only 10 tokens per second before entering the LLM.

**译文**:
对于音频输入, 我们采用 Whisper Medium 编码器, 并以基于 chunk 的流式方式运行。该编码器每秒会产生 50 个特征 token, 随后再通过一个轻量级投影器将其压缩为每秒仅 10 个 token, 再输入到 LLM 中。

### 2.3 LLM Backbone and Speech Generation

**原文**:
We use Qwen3-8B as the LLM backbone. A key architectural decision is that the LLM generates only text tokens, while a lightweight speech decoder consumes the reshaped hidden states to generate semantic speech tokens. This avoids the inefficiency and degradation that would arise if the LLM had to directly predict high-frequency speech tokens.

**译文**:
我们使用 Qwen3-8B 作为 LLM 主干。一个关键架构决策是：LLM 只生成文本 token, 而轻量级语音解码器则消费经重塑后的隐藏状态来生成语义语音 token。这样就避免了让 LLM 直接预测高频语音 token 所带来的效率损失与能力退化问题。

**原文**:
Finally, a streaming flow-matching decoder synthesizes waveforms from the semantic speech tokens and supports voice cloning conditioned on reference audio in the system prompt.

**译文**:
最后, 一个流式 flow-matching 解码器根据语义语音 token 合成最终波形, 并支持基于系统提示中参考音频进行语音克隆。

> 译者注：这套架构背后的思想非常务实。论文没有让 8B 主干去承担“文本 + 语音离散码 + 时序控制”三种任务, 而是明确把“语言决策”和“语音生成”拆成两个层次。这样做的直接收益是：主干保持强语言能力, 小语音头承担高频输出负担, 整体计算图也更容易做实时化优化。

---

## 3 Omni-Flow

**原文**:
The core technique behind MiniCPM-o 4.5 is Omni-Flow, a unified streaming framework that aligns all inputs and outputs along a shared temporal axis. It transforms conventional turn-based interaction into a full-duplex time-aligned process.

**译文**:
MiniCPM-o 4.5 的核心技术是 Omni-Flow。这是一种统一的流式框架, 它将所有输入与输出都对齐到同一条共享的时间轴上, 从而把传统的轮次式交互转化为一个全双工、时间对齐的过程。

### 3.1 Time-Aligned Streams

**原文**:
Omni-Flow models interaction through three synchronized streams: an environmental visual stream, an environmental audio stream, and an assistant output stream. Under this formulation, user speech is simply part of the environmental audio stream rather than a privileged symbolic turn marker.

**译文**:
Omni-Flow 通过三条同步流来建模交互：环境视觉流、环境音频流, 以及助手输出流。在这种表述下, 用户语音只是环境音频流的一部分, 而不再是一个具有特权地位的符号化“轮次起点”。

**原文**:
This removes the strong boundary between user input and environmental context, allowing the model to treat all incoming signals as time-indexed observations to be integrated continuously.

**译文**:
这种设计消除了用户输入与环境上下文之间的强边界, 使模型能够把所有到来的信号都视为带有时间索引的观测, 并以持续整合的方式来处理。

### 3.2 Unified Serialization

**原文**:
Inspired by time-division multiplexing in communication systems, Omni-Flow discretizes continuous interaction into fine-grained time windows. Within each window, the model consumes newly arrived signals and emits the next portion of its output.

**译文**:
受到通信系统中时分复用思想的启发, Omni-Flow 将连续交互离散化为细粒度的时间窗口。在每个时间窗口内部, 模型一边消费新到达的信号, 一边输出下一部分响应内容。

### 3.3 Design Tradeoffs

**原文**:
We study three important design choices: the chunk size, whether to explicitly mark boundaries between new input and new output, and whether to jointly predict interaction control and content generation. Empirically, a 1.0-second chunk, explicit boundary markers, and a separated interaction-control/content-generation strategy yield the best tradeoff.

**译文**:
我们研究了三个关键设计选择：时间 chunk 的大小、是否显式标记新输入与新输出之间的边界, 以及是否联合预测交互控制与内容生成。实验上, 1.0 秒的 chunk、大显式边界标记, 以及将交互控制与内容生成解耦的策略, 取得了最优的综合平衡。

**原文**:
The separated strategy first decides whether the model should speak and then decides what to say, which makes proactive full-duplex interaction easier to learn.

**译文**:
这种解耦策略会先决定模型“是否应该说话”, 再决定“具体说什么”, 从而使主动式全双工交互更容易被学习出来。

### 3.4 Time-Aligned Interleaving for Timely Speech Generation

**原文**:
To prevent speech output from lagging behind the latest observations, we introduce Time-Aligned Interleaving (TAIL). Instead of letting text run far ahead of speech, TAIL adaptively controls how much text is generated per chunk so that the spoken content remains approximately aligned with the current time boundary.

**译文**:
为了防止语音输出落后于最新观测, 我们提出了时间对齐交错机制(TAIL)。与让文本内容远远跑在语音前面不同, TAIL 会自适应控制每个 chunk 中生成多少文本, 以便让最终播出的语音内容大致保持与当前时间边界对齐。

**原文**:
TAIL also introduces bounded lookahead: a few final text tokens in the current chunk may defer their speech-token generation to the next chunk, providing enough local context for pronunciation and prosody without letting the text stream advance too far.

**译文**:
TAIL 还引入了有界前瞻机制：当前 chunk 中最后几个文本 token 的语音 token 生成可以被延后到下一个 chunk 中进行, 从而在不让文本流过度超前的前提下, 为发音与韵律判断提供足够的局部上下文。

> 译者注：TAIL 的价值在于, 它不是单纯地追求“生成得快”, 而是追求“说出来的内容在时间上仍然对得上世界”。如果模型正在描述街景, 而它口中说出的句子总是滞后 2 秒以上, 那么即使语音自然、识别能力强, 整体交互体验仍然不类人。TAIL 解决的是这个时序一致性问题。

---

## 4 Data

### 4.1 Speech Data

**原文**:
We construct large-scale speech data from both naturally collected unlabeled audio and carefully curated conversational recordings. The latter are produced by professional voice actors who deliver the dialogues in natural conversational styles rather than read them mechanically.

**译文**:
我们构建了大规模语音数据, 来源既包括自然收集的无标注音频, 也包括精心整理的对话录音。后者由专业配音演员录制, 他们以自然对话风格而不是机械朗读的方式来完成这些对话内容。

### 4.2 Vision-Language Data

**原文**:
On top of the MiniCPM-V 4.5 data system, we further expand high-quality knowledge and alignment data, document and OCR data, real-world scene understanding data, dense video description data, and strong pure-text instruction data.

**译文**:
在 MiniCPM-V 4.5 的数据体系基础上, 我们进一步扩展了高质量知识与对齐数据、文档与 OCR 数据、真实世界场景理解数据、稠密视频描述数据, 以及高质量纯文本指令数据。

**原文**:
For document and OCR learning, we adopt a relevance-aware masking strategy that prefers masking text regions most relevant to surrounding charts and layouts, encouraging the model to actually reason over visual anchors rather than only performing straightforward OCR.

**译文**:
在文档与 OCR 学习方面, 我们采用一种相关性感知掩码策略, 优先遮蔽那些与周围图表和版式最相关的文本区域, 以此促使模型真正围绕视觉锚点进行推理, 而不是仅仅执行直接的 OCR 识别。

### 4.3 Omni-Modal Full-Duplex Data

**原文**:
We additionally curate large-scale audio-video data and manually annotated full-duplex interaction data for tasks such as continuous scene description, reminders, and proactive commenting. Each training sample contains complete visual input, audio input, output text, and output speech aligned on a shared timeline.

**译文**:
我们还额外整理了大规模音视频数据, 以及人工标注的全双工交互数据, 用于连续场景描述、提醒和主动评论等任务。每个训练样本都包含完整的视觉输入、音频输入、输出文本与输出语音, 并且全部对齐在同一条共享时间线上。

> 译者注：这里最关键的数据资产不是单个模态的规模, 而是“多流同步标注”的代价。只有当视觉、音频、文本和语音输出都共享同一个时间索引时, Omni-Flow 才能学到真正的流式互动逻辑。换句话说, 这类数据比普通 VLM 指令数据昂贵得多。

---

## 5 Training

**原文**:
Starting from the MiniCPM-V 4.5 checkpoint, we progressively integrate speech capabilities through four stages: speech pretraining, joint pretraining, joint supervised fine-tuning, and reinforcement learning.

**译文**:
我们从 MiniCPM-V 4.5 的检查点出发, 通过四个阶段逐步整合语音能力：语音预训练、联合预训练、联合监督微调, 以及强化学习。

### 5.1 Speech Pretraining

**原文**:
At the speech pretraining stage, we freeze the pretrained components and only update newly added speech-related modules, aligning audio representations with the LLM hidden space and training the speech decoder to map hidden states into speech semantics.

**译文**:
在语音预训练阶段, 我们冻结预训练组件, 只更新新增的语音相关模块, 以便把音频表征对齐到 LLM 的隐藏空间中, 并训练语音解码器将隐藏状态映射为语音语义表示。

### 5.2 Joint Pretraining

**原文**:
During joint pretraining, all parameters are unfrozen and trained on a balanced mixture of vision-language, speech, and omni-modal data. Different modality combinations are allocated to different data-parallel ranks to stabilize optimization.

**译文**:
在联合预训练阶段, 我们解冻所有参数, 并在视觉语言、语音和全模态数据的平衡混合上进行训练。不同的模态组合会被分配到不同的数据并行 rank 上, 以稳定整体优化过程。

### 5.3 Joint Supervised Fine-Tuning

**原文**:
Joint SFT is carried out in two stages: a large-scale instruction-tuning stage for broad capability adaptation and a high-quality human-annotated stage for fine-grained behavior alignment.

**译文**:
联合监督微调分两个阶段进行：第一阶段是大规模指令微调, 用于广泛能力适配; 第二阶段则使用高质量人工标注数据, 以实现更细粒度的行为对齐。

### 5.4 Reinforcement Learning

**原文**:
We use GRPO to improve reasoning and instruction-following quality, with carefully designed rewards for correctness, format, and response length. We also optimize full-duplex interaction behavior using preference-based rewards.

**译文**:
我们采用 GRPO 来提升推理质量和指令遵循能力, 并为正确性、格式以及响应长度设计了精细化奖励。同时, 我们还使用基于偏好的奖励信号来优化全双工交互行为本身。

> 译者注：这篇论文的 RL 并不是为了把模型推成一个“更强数学推理器”, 而是为了把它推成一个“更像人在实时环境中说话”的系统。所以它的奖励设计除了正确性, 还必须约束长度、时机和交互行为, 这和传统纯文本 reasoning RL 有明显差异。

---

## 6 Evaluation

### 6.1 Modalities and Domains

**原文**:
We evaluate MiniCPM-o 4.5 on diverse benchmarks spanning vision-language understanding, speech understanding, speech generation, text tasks, and omni-modal streaming settings.

**译文**:
我们在覆盖视觉语言理解、语音理解、语音生成、文本任务以及全模态流式设置的多种基准上, 对 MiniCPM-o 4.5 进行了评测。

### 6.2 Vision-Language Results

**原文**:
MiniCPM-o 4.5 approaches Gemini 2.5 Flash in vision-language capabilities and delivers state-of-the-art open-source performance at its scale.

**译文**:
MiniCPM-o 4.5 在视觉语言能力上逼近 Gemini 2.5 Flash, 并在其参数规模级别上实现了开源模型中的最先进性能。

### 6.3 Speech Results

**原文**:
The model also demonstrates strong speech understanding and high-quality speech generation, outperforming strong omni-modal baselines such as Qwen3-Omni-30B-A3B in several evaluations.

**译文**:
该模型还展现出强大的语音理解能力与高质量语音生成效果, 在若干评测中超过了 Qwen3-Omni-30B-A3B 等强势全模态基线。

### 6.4 Text Results

**原文**:
Although the model is designed primarily for omni-modal full-duplex interaction, it also remains competitive on pure-text tasks, benefiting from the strength of the Qwen3-8B backbone and RL post-training.

**译文**:
尽管该模型主要面向全模态全双工交互而设计, 但它在纯文本任务上依然保持竞争力, 这得益于 Qwen3-8B 主干的能力基础以及强化学习后训练的加持。

### 6.5 Omni-Modal and Streaming Results

**原文**:
In omni-modal and streaming benchmarks, MiniCPM-o 4.5 achieves a strong balance between responsiveness, understanding, and generation quality, validating the effectiveness of Omni-Flow and TAIL.

**译文**:
在全模态与流式交互基准上, MiniCPM-o 4.5 在响应速度、理解能力和生成质量之间取得了很强的平衡, 这验证了 Omni-Flow 与 TAIL 机制的有效性。

### 6.6 Analysis

**原文**:
Our analysis further shows that the proposed full-duplex training strategy, dynamic text-speech alignment, and efficient inference design are all important contributors to the final system quality.

**译文**:
我们的分析进一步表明：所提出的全双工训练策略、动态文本-语音对齐机制, 以及高效推理设计, 都是最终系统质量的重要组成部分。

> 译者注：这篇论文的评测不能只盯着单一分数看。它真正有价值的地方, 在于把“视觉语言能力还不错”“语音生成也不错”“还能实时全双工”这三件事同时做成。过去这三类能力往往分散在不同系统里, 而这里开始出现一个统一模型把它们合并起来的趋势。

---

## 7 Efficient Real-Time Inference

**原文**:
MiniCPM-o 4.5 is designed with efficient architecture and inference optimization so that real-time full-duplex interaction can run on edge devices with less than 12GB RAM cost.

**译文**:
MiniCPM-o 4.5 在架构与推理优化层面都经过专门设计, 因此能够在内存成本低于 12GB 的边缘设备上运行实时全双工交互。

**原文**:
Compared with Qwen3-Omni-30B-A3B, MiniCPM-o 4.5 delivers better omni-modal quality with much higher compute efficiency, and can be deployed more broadly in practical settings.

**译文**:
与 Qwen3-Omni-30B-A3B 相比, MiniCPM-o 4.5 以显著更高的计算效率提供了更好的全模态质量, 也因此更有可能在真实应用场景中被广泛部署。

> 译者注：这里的“边缘可部署”不是宣传口号, 而是架构路线选择的直接结果：更强的压缩、更低的语音输出频率负担、主干只负责文本决策、专门的流式语音解码器, 再加上时序对齐机制共同把系统从“实验室大模型”压缩成“能跑在终端上的交互系统”。

---

## 8 Conclusion

**原文**:
We present MiniCPM-o 4.5 as a step toward human-like multimodal interaction. By enabling real-time full-duplex omni-modal interaction with proactive behavior, the model demonstrates a promising direction for future multimodal foundation models.

**译文**:
我们将 MiniCPM-o 4.5 视为迈向类人多模态交互的一步。通过支持带有主动行为的实时全双工全模态交互, 该模型展示了未来多模态基础模型的一条很有前景的发展方向。

**原文**:
More broadly, we believe that multimodal foundation models are moving beyond static understanding and toward sustained participation in the dynamic world.

**译文**:
更广泛地说, 我们相信, 多模态基础模型正在从静态理解能力, 迈向在动态现实世界中持续参与的能力形态。

> 译者注：如果说早期多模态模型的目标是“看懂图片、听懂语音”, 那 MiniCPM-o 4.5 的目标已经变成“像人一样在一个持续流动的世界里参与互动”。这意味着评估标准也会变化：未来不只是看 benchmark 分数, 还要看是否能及时打断、是否能主动提醒、是否能在变化环境里维持上下文一致性。

---

## References

参考文献列表保留在原始 MinerU 英文文件中。若需逐条引用, 请回到 `03-MiniCPM-o-4.5-mineru-en.md` 的 References 与 Appendix 部分查阅。

---

## Appendix 说明

附录中的模型配置表、更多评测表和效率对比表, 因其以结构化表格为主, 建议结合英文原文 `03-MiniCPM-o-4.5-mineru-en.md` 直接对照阅读。本译文已经覆盖正文中的核心方法、设计取舍与主要结论。

---

> **全文完**。本文基于 MiniCPM-o 4.5 的 MinerU 英文提取稿进行逐段翻译, 并在关键架构与交互范式处插入译者注。
>
> - 源文件：`03-MiniCPM-o-4.5-mineru-en.md`
> - 相关精译：`01-MiniCPM-o-4.5-技术报告精译.md`
> - 相关专题：`05-MiniCPM-o-4.5-Omni-Flow全双工流式交互框架.md`
