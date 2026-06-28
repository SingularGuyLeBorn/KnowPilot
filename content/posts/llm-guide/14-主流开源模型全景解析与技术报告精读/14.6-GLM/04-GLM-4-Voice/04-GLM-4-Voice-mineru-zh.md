---
title: "04 · GLM-4-Voice 技术报告 (MinerU 逐译 + 译者注)"
translated_from: 03-GLM-4-Voice-mineru-en.md
model: GLM-4-Voice
scope: D4 (逐译 + 译者注)
---


> 原文：GLM-4-Voice: Towards Intelligent and Human-Like End-to-End Spoken Chatbot
> 作者：Aohan Zeng, Zhengxiao Du, Mingdao Liu 等 (Zhipu.AI / Tsinghua University)
> 来源：arXiv:2412.02612v1, 2024-12-03
> 本文件基于 PyMuPDF fallback 提取的 D3 英文原文逐段翻译，并在关键技术节点插入译者注。

---

GLM-4-Voice: Towards Intelligent and Human-Like End-to-End Spoken Chatbot

> GLM-4-Voice：迈向智能且拟人化的端到端语音对话机器人

Aohan Zeng‡§∗, Zhengxiao Du‡§∗, Mingdao Liu‡, Kedong Wang§, Shengmin Jiang§, Lei Zhao§, Yuxiao Dong‡, Jie Tang‡
§Zhipu.AI, ‡Tsinghua University

https://github.com/THUDM/GLM-4-Voice

Abstract

We introduce GLM-4-Voice, an intelligent and human-like end-to-end spoken chatbot. It supports both Chinese and English, engages in real-time voice conversations, and varies vocal nuances such as emotion, intonation, speech rate, and dialect according to user instructions. GLM-4-Voice uses an ultra-low bitrate (175bps), single-codebook speech tokenizer with 12.5Hz frame rate derived from an automatic speech recognition (ASR) model by incorporating a vector-quantized bottleneck into the encoder. To efficiently transfer knowledge from text to speech modalities, we synthesize speech-text interleaved data from existing text pre-training corpora using a text-to-token model. We continue pre-training from the pre-trained text language model GLM-4-9B with a combination of unsupervised speech data, interleaved speech-text data, and supervised speech-text data, scaling up to 1 trillion tokens, achieving state-of-the-art performance in both speech language modeling and spoken question answering. We then fine-tune the pre-trained model with high-quality conversational speech data, achieving superior performance compared to existing baselines in both conversational ability and speech quality. The open models can be accessed through https://github.com/THUDM/GLM-4-Voice and https://huggingface.co/THUDM/glm-4-voice-9b.

> **摘要**
>
> 我们介绍 GLM-4-Voice，一个智能且拟人化的端到端语音对话机器人。它支持中英文，能够进行实时语音对话，并根据用户指令调整语音的情感、语调、语速和方言等细微特征。GLM-4-Voice 采用超低码率(175bps)单码本语音分词器，帧率为 12.5Hz，通过在 ASR 模型编码器中引入向量量化瓶颈层得到。为了高效地将知识从文本模态迁移到语音模态，我们利用文本到 token 模型从现有文本预训练语料中合成语音-文本交错数据。我们在预训练好的文本语言模型 GLM-4-9B 基础上继续进行预训练，结合无监督语音数据、交错语音-文本数据和监督语音-文本数据，规模达到 1 万亿 token，在语音语言建模和口语问答两项任务上均达到 state-of-the-art。随后，我们用高质量对话语音数据对预训练模型进行微调，在对话能力和语音质量两方面均优于现有基线。开源模型可通过上述 GitHub 和 HuggingFace 链接获取。

## 1 Introduction

>  **[返回 14.6-GLM 家族总览](../../14.6-GLM.md)**


The success of large language models (LLMs) has driven significant advancements in conversational AI, enabling the development of text-based chatbots and digital assistants. However, LLMs are primarily designed to process text input and generate text output, focusing on semantic and logical communication. In contrast, human communication extends beyond semantics, often conveying emotions and subtle nuances. Voice-based interaction, therefore, provides a more natural and intuitive medium for human-computer interaction, offering richer and more engaging user experiences.

> **1 引言**
>
> 大语言模型(LLM)的成功推动了对话式 AI 的显著进步，催生了基于文本的聊天机器人和数字助手。然而，LLM 主要设计用于处理文本输入并生成文本输出，聚焦于语义和逻辑层面的交流。相比之下，人类交流超越语义，常常传达情感和微妙细节。因此，基于语音的交互为人机交互提供了更自然、更直观的媒介，带来更丰富、更具吸引力的用户体验。

Traditional spoken chatbot typically rely on a pipeline combining Automatic Speech Recognition (ASR), LLM processing, and Text-to-Speech (TTS) synthesis. While functional, this approach is often hindered by high latency, compounded errors introduced during the ASR and TTS stages, and a limited capacity to capture and express emotional nuances.

> 传统的语音聊天机器人通常依赖一个将自动语音识别(ASR)、LLM 处理和文本转语音(TTS)合成相结合的流水线方案。虽然功能上可行，但这种方法往往受困于高延迟、ASR 和 TTS 阶段累积的复合误差，以及在捕捉和表达情感细微差别方面的有限能力。

Speech-language models (SpeechLMs), which process both speech input and output in an end-to-end manner, offer a promising approach for building spoken chatbots. Efforts such as [24, 17] have explored pre-training on speech data in a manner similar to large language models (LLMs). Similarly, Défossez et al. [12] scaled speech data to 7 million hours for model training. However, these approaches face a significant limitation: the relative scarcity of speech data compared to the extensive text corpora available online. This data imbalance makes it challenging to fully leverage the capabilities of text-based LLMs, ultimately constraining the intelligence of SpeechLMs. Other methods aim to align speech and text modalities [15, 42] by integrating a speech encoder and a text-to-speech module into existing LLMs and fine-tuning them on spoken dialogue datasets. While this approach provides a straightforward way to develop speech-to-speech models from LLMs, it lacks the ability to deliver truly human-like speech output due to the absence of dedicated speech pre-training. This limitation hinders these models from capturing the rich nuances and expressiveness inherent in human speech.

> 语音语言模型(SpeechLMs)以端到端方式同时处理语音输入和输出，为构建语音聊天机器人提供了一条有前景的路径。已有工作如 [24, 17] 探索了类似 LLM 的语音数据预训练方式。Défossez 等人 [12] 更是将语音数据规模扩展至 700 万小时用于模型训练。然而，这些方法面临一个重大限制：与互联网上丰富的文本语料相比，语音数据相对稀缺。这种数据不平衡使得难以充分利用基于文本的 LLM 的能力，最终限制了 SpeechLM 的智能水平。另一类方法通过在现有 LLM 中集成语音编码器和 TTS 模块，并在语音对话数据集上微调来对齐语音和文本模态 [15, 42]。虽然这种方法提供了一种从 LLM 直接开发语音到语音模型的简便途径，但由于缺乏专门的语音预训练，它无法产出真正拟人化的语音输出。这一限制阻碍了这些模型捕捉人类语音中丰富的细微差别和表现力。

> **译者注: 设计动机与路线选择**
>
> GLM-4-Voice 的设计哲学可以概括为「在文本 LLM 的肩膀上构建语音能力，而非从零开始」。团队识别出两条主流路线的瓶颈：纯语音预训练路线(如 Moshi)受限于语音数据的规模和多样性，难以达到文本 LLM 的认知水平; 而「外挂式」路线(如 Llama-Omni、Mini-Omni)虽然快速，但缺乏专门的语音预训练导致输出语音干瘪。GLM-4-Voice 的解决方案是第三条路——在强大的文本基座(GLM-4-9B)之上，通过 1 万亿 token 的大规模语音-文本交错预训练，同时做「模态扩展」和「知识迁移」。这本质上是在用文本预训练的认知深度来弥补语音数据的稀缺性。

In this paper, we introduce GLM-4-Voice, an intelligent and human-like spoken chatbot. We use a single code-book supervised speech tokenizer with 12.5Hz frame rate to efficiently represent speech. A flow-matching-based speech decoder is employed to convert speech tokens into natural-sounding speech. To bridge the gap between text and speech modalities, we conduct large-scale speech-text pre-training using 1 trillion tokens. This includes synthetic interleaved speech-text corpora derived from text pre-training data, as well as unsupervised speech data and supervised speech-text datasets (e.g., ASR and TTS). The resulting base model demonstrates strong performance across various tasks, including speech language modeling, spoken question answering, ASR, and TTS. To further enhance the chatbot's conversational capabilities, we fine-tune the base model on high-quality conversational datasets using a "streaming thoughts" template. This template alternates between outputting text and speech tokens, improving the model's ability to generate seamless, low-latency responses while maintaining high-quality performance.

> 本文中，我们介绍 GLM-4-Voice，一个智能且拟人化的语音对话机器人。我们使用单码本、12.5Hz 帧率的监督式语音分词器来高效表示语音。采用基于 flow matching 的语音解码器将语音 token 转换为自然听感的语音。为了弥合文本与语音模态之间的鸿沟，我们使用 1 万亿 token 进行大规模语音-文本预训练，包括从文本预训练数据中合成的交错语音-文本语料，以及无监督语音数据和监督语音-文本数据集(如 ASR 和 TTS)。由此得到的基座模型在多种任务上表现出色，包括语音语言建模、口语问答、ASR 和 TTS。为了进一步增强对话能力，我们使用「流式思考(streaming thoughts)」模板在高质量对话数据集上对基座模型进行微调。该模板交替输出文本 token 和语音 token，提升模型生成无缝、低延迟回复的能力，同时保持高质量的输出表现。

---

## 2 Related Work

### 2.1 Speech Tokenization

Speech tokenizers, which transform a audio clip into discrete tokens, can be categorized into two directions. The neural acoustic codecs [44, 11, 23, 20] target at reconstructing high-quality audio at low bitrates. The semantic tokens [19, 10] are extracted from speech representations learned with self-supervised learning on speech data. Recently, SpeechTokenizer [48] and Mini [12] unify semantic and acoustic tokens as different residual vector quantization (RVQ) layers, but they also suffer from multiple tokens at the same position, leading to either parallel prediction of semantic and acoustic tokens, or degradation to semantic tokenizers for language models. CosyVoice [14] proposes the supervised semantic tokenizer derived from a speech recognition model, and successfully apply the tokenizer to text-to-speech synthesis. The application of the tokenizer on speech language modeling is not explored.

> **2 相关工作**
>
> **2.1 语音分词**
>
> 语音分词器将音频片段转换为离散 token，可分为两个方向。神经声学编解码器 [44, 11, 23, 20] 致力于在低码率下重建高质量音频。语义 token [19, 10] 则从语音数据上通过自监督学习获得的语音表示中提取。近期，SpeechTokenizer [48] 和 Mini [12] 将语义 token 和声学 token 统一为不同的残差向量量化(RVQ)层，但它们也面临同一位置存在多个 token 的问题，导致要么需要并行预测语义和声学 token，要么在语言模型中退化为仅使用语义分词器。CosyVoice [14] 提出了从语音识别模型衍生而来的监督式语义分词器，并成功将其应用于文本转语音合成。但该分词器在语音语言建模上的应用尚未被探索。

> **译者注: 分词器路线的技术谱系**
>
> 语音分词器的演进呈现清晰的谱系：声学编解码器(如 SoundStream)追求高保真重建但码率偏高; 自监督语义 token(如 HuBERT)码率低但丢弃了声学细节; RVQ 多层方案试图兼顾两者，却给自回归生成带来并行预测的复杂度。GLM-4-Voice 选择了 CosyVoice 开创的「监督式语义分词」路线——在 Whisper 编码器中间插入 VQ 瓶颈，以 ASR 精度为监督信号训练。这一选择的巧妙之处在于：ASR 目标天然对齐文本语义，使得 token 同时保留语义信息和部分声学信息，且单码本设计完美适配自回归 next-token prediction。12.5Hz × 1 codebook = 175bps 的码率，相比 Moshi Mimi 的 1.1Kbps 或 SpeechTokenizer 的 1.5-4Kbps，是数量级的效率优势。

### 2.2 Speech Language Modeling

Speech language models are autoregressive models pretrained on unsupervised speech data. Lakhotia et al. [24] first proposes generative spoken language modeling (GSLM), which trains the next-token-prediction objective on discrete semantic tokens produced by self-supervised learning. AudioLM [5] proposes a hybrid tokenization scheme that combines these semantic tokens with acoustic tokens from a neural audio codec [44]. TWIST [17] trains the speech language model using a warm-start from the pretrained text language model OPT [47]. Moshi [12] scales up the size of natural speech data in TWIST to 7 million hours. Spirit-LM [32] further extends TWIST by adding speech-text interleaving data curated from speech-text parallel corpus. However, the scarcity of speech-text parallel corpus restricts the scale of interleaving data.

> **2.2 语音语言建模**
>
> 语音语言模型是在无监督语音数据上预训练的自回归模型。Lakhotia 等人 [24] 首次提出生成式口语语言建模(GSLM)，在自监督学习产生的离散语义 token 上训练 next-token prediction 目标。AudioLM [5] 提出混合分词方案，将语义 token 与神经音频编解码器的声学 token [44] 结合。TWIST [17] 使用预训练文本语言模型 OPT [47] 进行热启动来训练语音语言模型。Moshi [12] 将 TWIST 中的自然语音数据规模扩展至 700 万小时。Spirit-LM [32] 进一步通过从语音-文本平行语料中构建的交错数据扩展 TWIST。然而，语音-文本平行语料的稀缺限制了交错数据的规模。

### 2.3 End-to-End Spoken Chatbots

Early works in speech-to-speech models mainly focus on processing tasks like speech translation [8, 2]. Since success of ChatGPT in text-based chatbots, many works have explored methods to develop speech-based chatbots that can understand and respond in speech. SpeechGPT [46] proposes to combine existing large language models (LLM) with discrete speech representations to obtain speech conversational abilities. Moshi [12] proposes a full-duplex spoken dialogue framework based on their pretrained speech language model. Qwen-Audio [9] adapts pre-trained textual language models for speech understanding by aligning speech representations of the Whisper [36] encoder. The model can understand speech, but not generate speech. Llama-Omni [15] and Freeze-Omni [41] extend the method by adding a text-to-speech model after the language model to transform the text output to speech output. In this way language models can only control the content of speech, but not the styles and prosodies. Mini-Omni [42] directly fine-tunes language models to generate text and speech responses simultaneously with only instruction datasets. Without speech pre-training, the quality of both text and speech responses is severely limited, as we will show in the experiments.

> **2.3 端到端语音对话机器人**
>
> 早期语音到语音模型的工作主要聚焦于语音翻译等处理任务 [8, 2]。自 ChatGPT 在文本对话机器人领域取得成功以来，许多工作探索了开发能够理解和以语音回应的语音对话机器人的方法。SpeechGPT [46] 提出将现有大语言模型与离散语音表示相结合以获得语音对话能力。Moshi [12] 基于其预训练的语音语言模型提出了全双工语音对话框架。Qwen-Audio [9] 通过对齐 Whisper [36] 编码器的语音表示，使预训练文本语言模型适配语音理解。该模型能理解语音，但无法生成语音。Llama-Omni [15] 和 Freeze-Omni [41] 通过在语言模型后增加 TTS 模型来扩展该方法，将文本输出转换为语音输出。这样语言模型只能控制语音内容，无法控制风格和韵律。Mini-Omni [42] 直接用指令数据集微调语言模型以同时生成文本和语音回复。但正如我们将在实验中展示的，缺乏语音预训练会严重限制文本和语音回复的质量。

---

## 3 Architecture

In this section, we introduce the architecture of GLM-4-Voice. Our goal is to build a human-like, end-to-end spoken chatbot with high intelligence. To achieve this, the model must 1) comprehend the user's speech and provide a semantically accurate response, and 2) follow the user's spoken instructions, generating speech with paralinguistic features that meet the user's expectations. Inspired by the successful pre-training and fine-tuning paradigm used in LLMs, we believe that these capabilities for spoken chatbots can be best developed through extensive pre-training on diverse speech corpus, rather than simply fine-tuning existing LLMs with speech question-answering data, as in recent spoken chatbot approaches [15, 42].

> **3 架构**
>
> 本节介绍 GLM-4-Voice 的架构。我们的目标是构建一个高智能、拟人化的端到端语音对话机器人。为此，模型必须：1)理解用户语音并提供语义准确的回复; 2)遵循用户的语音指令，生成满足用户期望的、带有副语言特征(paralinguistic features)的语音。受 LLM 成功的预训练-微调范式启发，我们认为语音对话机器人的这些能力最好通过在多样化语音语料上的广泛预训练来培养，而不是像近期语音对话机器人方案 [15, 42] 那样简单地用语音问答数据微调现有 LLM。

To achieve this goal, GLM-4-Voice is designed with minimal modifications to the auto-regressive transformer architecture. For speech tokenization, we utilize a supervised speech tokenizer, which effectively captures semantic information at a ultra-low bitrate (175bps) while maintaining high-quality speech reconstruction. Additionally, we adopt a single-codebook approach for speech tokenization, avoiding the complex architectural adjustments often required for multi-layer speech token generation [12, 42]. This approach helps preserve the model's text processing capabilities while enabling efficient speech modeling. Furthermore, the model employs a unified speech representation for both input and output, enabling next-token prediction for speech data and facilitating efficient pre-training on unsupervised speech corpora.

> 为实现这一目标，GLM-4-Voice 在自回归 Transformer 架构上做了最小化修改。对于语音分词，我们采用监督式语音分词器，在超低码率(175bps)下有效捕捉语义信息，同时保持高质量的语音重建。此外，我们采用单码本方案进行语音分词，避免了多层语音 token 生成通常需要的复杂架构调整 [12, 42]。这种方法有助于保留模型的文本处理能力，同时实现高效的语音建模。此外，模型对输入和输出使用统一的语音表示，支持对语音数据进行 next-token prediction，并便于在无监督语音语料上高效预训练。

We use the same speech tokenizer and speech decoder as described in Zeng et al. [45]. To enable low-latency interaction, we adapt the speech decoder to support streaming inference and design a streaming thought template capable of alternating between text and speech tokens during the supervised fine-tuning stage, as detailed in Section 3.3 and Section 3.2.

> 我们使用与 Zeng 等人 [45] 相同的语音分词器和语音解码器。为了实现低延迟交互，我们调整语音解码器以支持流式推理，并设计了一个流式思考模板，能够在监督微调阶段交替输出文本和语音 token，详见第 3.3 节和第 3.2 节。

### 3.1 Speech Tokenization

The speech tokenizer converts continuous waveforms into discrete speech tokens, which reserve semantic information and a part of acoustic information. Previous methods can be categorized into two directions. Acoustic tokenizers are trained with reconstruction/adversarial objectives of speech waveform. Acoustic tokens reserve enough information to reconstruct the original audio, but to represent the additional information it relies on either high sampling rate (i.e. number of tokens per second) or residual vector quantization [44] (i.e. multiple stacked codebooks). Semantic tokens are extracted from self-supervised representations learned on automatically discovered speech units [19]. Semantic tokens discard additional information that is unnecessary to represent semantic meaning of speech, but also result in low-quality speech synthesis and a loss of acoustic details [31]. The ideal speech tokenizer for speech-text language modeling should have several key features: 1) low sampling rate with a single codebook to support autoregressive generation. 2) aligning with texts to transfer knowledge of pretrained language models. 3) support of high-quality speech synthesis.

> **3.1 语音分词**
>
> 语音分词器将连续波形转换为离散语音 token，保留语义信息和部分声学信息。先前方法可分为两类。声学分词器使用语音波形的重建/对抗目标进行训练。声学 token 保留足够信息以重建原始音频，但要表示额外信息需要依赖高采样率(即每秒 token 数)或残差向量量化 [44](即多个堆叠码本)。语义 token 从在自动发现的语音单元上自监督学习得到的表示中提取 [19]。语义 token 丢弃了表示语音语义所不需要的额外信息，但也导致低质量语音合成和声学细节损失 [31]。用于语音-文本语言建模的理想语音分词器应具备以下关键特征：1)低采样率配合单码本，以支持自回归生成; 2)与文本对齐，以迁移预训练语言模型的知识; 3)支持高质量语音合成。

We adopt the 12.5Hz speech tokenizer variant described in Zeng et al. [45]. To make the paper self-contained, we briefly describe the architecture of the speech tokenizer. Inspired by the supervised semantic tokenizer in text-to-speech synthesis [14], we finetune a pretrained automatic speech recognition model (we use whisper-large-v3 in the Whisper family [36]) with an additional pooling layer and a vector quantization layer [40] in the middle of the encoder. The codebook vectors are learned with exponential moving average (EMA) and we reset vectors whose mean usage falls below a certain threshold with randomly-selected continuous representations before quantization to overcome codebook collapse following Dhariwal et al. [13].

> 我们采用 Zeng 等人 [45] 描述的 12.5Hz 语音分词器变体。为使论文自洽，我们简要描述该分词器的架构。受文本转语音合成中监督式语义分词器 [14] 的启发，我们在预训练自动语音识别模型(我们使用 Whisper 系列中的 whisper-large-v3 [36])的编码器中间增加一个池化层和一个向量量化层 [40] 进行微调。码本向量通过指数移动平均(EMA)学习，并且对于平均使用率低于特定阈值的向量，在量化前用随机选取的连续表示重置，以克服码本崩溃问题，遵循 Dhariwal 等人 [13] 的方法。

> **译者注: 175bps 单码本的技术权衡**
>
> 分词器是语音语言模型的「地基」。GLM-4-Voice 选择 12.5Hz 单码本方案，背后是精确的技术权衡：码率越低，LLM 自回归生成的计算负担越轻(每秒只需预测 12.5 个 token)，但信息损失风险越大。Table 1 的评测数据揭示了这一权衡的量化结果——12.5Hz 变体在 WER(8.43%)和 MOSNet(3.39)之间取得了最佳平衡。相比之下，50Hz 变体虽然 WER 更低(6.24%)，但每秒 token 数翻两番，对 LLM 的推理效率是沉重负担; 6.25Hz 变体虽然码率最低(100bps)，但 WER 飙升至 14.41%，信息损失过大。12.5Hz 的「甜点」位置不是拍脑袋决定的，而是有明确的评测指标支撑。

#### Causality for Streaming Inference

To enable streaming encoding of input speech during inference, we adapt the architecture of Whisper encoder to introduce causality [45]. Specifically, we replace the convolution layer before the encoder Transformer with causal convolution [39]. We also replace the bidirectional attention in the encoder with block causal attention.

> **流式推理的因果性**
>
> 为了支持推理时输入语音的流式编码，我们调整 Whisper 编码器的架构以引入因果性 [45]。具体而言，我们将编码器 Transformer 前的卷积层替换为因果卷积 [39]，并将编码器中的双向注意力替换为块因果注意力(block causal attention)。

#### Training Details

We fine-tune the vector-quantized Whisper model with a collection of ASR datasets, including LibriSpeech [34], GigaSpeech [7], MLS-Eng [35], Wenet [43], CommonVoice [3], AISHELL-1 [6], and a proprietary Chinese ASR dataset of 10k hours. We also include 700k hours unsupervised speech data with pseudo labels generated by whisper-large-v3 [36] for English and paraformer-large [1] for Chinese. All of our speech tokenizers are fine-tuned from whisper-large-v3 for 2 epochs with batch size 4096 and learning rate 1e-5. The ratio of supervised samples to pseudo-labeled samples is 1:3. The codebook vectors are updated with exponential moving average with decay coefficient 0.99 and the commitment loss coefficient is 10.0. To reduce the information loss of average pooling, we increase the codebook size as the sampling rate decreases.

> **训练细节**
>
> 我们使用一系列 ASR 数据集微调向量量化 Whisper 模型，包括 LibriSpeech [34]、GigaSpeech [7]、MLS-Eng [35]、Wenet [43]、CommonVoice [3]、AISHELL-1 [6]，以及一个 1 万小时的专有中文 ASR 数据集。我们还纳入 70 万小时无监督语音数据，伪标签分别由 whisper-large-v3 [36](英文)和 paraformer-large [1](中文)生成。所有语音分词器均从 whisper-large-v3 微调 2 个 epoch，批次大小 4096，学习率 1e-5。监督样本与伪标签样本比例为 1:3。码本向量以衰减系数 0.99 的指数移动平均更新，承诺损失(commitment loss)系数为 10.0。为了减少平均池化的信息损失，随着采样率降低，我们增大码本大小。

#### Evaluation

We measure the reservation of semantic information in the speech tokens by the accuracy of the finetuned ASR model. The results on LibriSpeech [34] and AISHELL-1 [6] are shown in Table 1, with whisper-large-v3 [36] and SenseVoice-Large [1] as baselines. Overall all the tokenizers reserve enough semantic information to achieve accurate ASR performance. Considering the reconstruction results in the following section, we select the 12.5Hz tokenizer for GLM-4-Voice.

> **评测**
>
> 我们通过微调 ASR 模型的精度来衡量语音 token 中语义信息的保留程度。LibriSpeech [34] 和 AISHELL-1 [6] 上的结果见 Table 1，基线为 whisper-large-v3 [36] 和 SenseVoice-Large [1]。总体而言，所有分词器都保留了足够的语义信息以实现准确的 ASR 性能。综合考虑下一节的重建结果，我们选择 12.5Hz 分词器用于 GLM-4-Voice。

---

### 3.2 Speech Decoder

The speech decoder synthesizes speech waveforms from discrete speech tokens and is crucial for ensuring the quality and expressiveness of generated speech. To minimize latency during speech interaction, the decoder must also support streaming inference. As in Zeng et al. [45], we adopt the decoder architecture of CosyVoice [14], which comprises a speech token encoder, a conditional flow matching model [28], and a HiFi-GAN vocoder [22].

> **3.2 语音解码器**
>
> 语音解码器从离散语音 token 合成语音波形，对于确保生成语音的质量和表现力至关重要。为了在语音交互中最小化延迟，解码器还必须支持流式推理。如 Zeng 等人 [45] 所述，我们采用 CosyVoice [14] 的解码器架构，包括语音 token 编码器、条件流匹配模型 [28] 和 HiFi-GAN 声码器 [22]。

#### Training Details

We train the speech token encoder and the flow matching model from scratch, with a two-stage training paradigm to fully utilize the abundant speech data of varied quality. During the pre-training stage, we use all the speech samples in the unsupervised speech data of various speakers and quality. During the fine-tuning stage, we use high-quality speech samples from a single speaker.

> **训练细节**
>
> 我们从零开始训练语音 token 编码器和流匹配模型，采用两阶段训练范式以充分利用数量丰富但质量各异的语音数据。预训练阶段使用无监督语音数据中各种说话人和质量的全部语音样本。微调阶段使用单一说话人的高质量语音样本。

#### Support for Streaming Inference

To enable streaming inference and reduce latency, we incorporate truncated audio samples (i.e., the first n · b seconds of the audio, where n = 1, 2, 3, ..., and b is the block size) during the fine-tuning stage. This prepares the model to handle streaming scenarios effectively. During inference, the decoder processes speech tokens corresponding to the first n · b seconds of audio. It uses the speech from the initial (n − 1)b seconds as the prompt and predicts the speech content from (n − 1)b to n · b seconds. This approach allows the model to generate speech tokens with a minimum delay of b seconds. Based on empirical studies, we set b = 0.8 for GLM-4-Voice, which implies that at least 10 speech tokens are required to generate the initial speech output.

> **流式推理支持**
>
> 为了支持流式推理并降低延迟，我们在微调阶段纳入截断音频样本(即音频的前 n·b 秒，n = 1, 2, 3, ...，b 为块大小)。这使模型能够有效应对流式场景。推理时，解码器处理对应于前 n·b 秒音频的语音 token。它使用初始 (n−1)b 秒的语音作为 prompt，预测从 (n−1)b 到 n·b 秒的语音内容。这种方法允许模型以最少 b 秒的延迟生成语音 token。基于经验研究，我们为 GLM-4-Voice 设置 b = 0.8，意味着生成初始语音输出至少需要 10 个语音 token。

> **译者注: 10-token 最低延迟的工程含义**
>
> 「最低只需 10 个 token 即可开始合成语音」是 GLM-4-Voice 低延迟架构的核心设计之一。以 12.5Hz 的帧率计算，10 个 token 仅对应 0.8 秒的音频内容，这意味着模型不需要等待整句话的 token 生成完毕才开始合成，而是可以「边说边想」。结合后面介绍的流式思考模板(streaming thoughts)，文本生成和语音生成交替进行，文本作为语义锚点确保内容正确性，语音则紧随其后逐步合成。这种「文本先行、语音紧跟」的流水线和 Mini-Omni 等同步生成方案形成对比，在延迟和质量之间做了务实的取舍。

#### Evaluation

We take the reconstruction results from Zeng et al. [45] to demonstrate the performance of our speech decoder with low-bit-rate speech tokens. We evaluate our speech decoder on speech reconstruction of LibriSpeech [34]. and compare our tokenizer with SpeechTokenizer [48] and Mini [12]. Following Défossez et al. [12], we also evaluate a variant of SpeechTokenizer that only keeps the first 3 RVQ layers to obtain a 1.5kbps bitrate. Table 1 shows that our speech decoder performs well across various sampling rates, with the 12.5Hz variant offering an optimal balance between efficiency and quality. It maintains high quality scores (MOSNet 3.39) and content preservation (WER 8.43) while significantly reducing bitrate (175).

> **评测**
>
> 我们采用 Zeng 等人 [45] 的重建结果来展示我们的语音解码器在低码率语音 token 下的性能。我们在 LibriSpeech [34] 的语音重建任务上评测解码器，并与 SpeechTokenizer [48] 和 Mini [12] 进行比较。遵循 Défossez 等人 [12] 的方法，我们还评测了仅保留前 3 层 RVQ 以获得 1.5Kbps 码率的 SpeechTokenizer 变体。Table 1 显示，我们的语音解码器在各种采样率下表现良好，12.5Hz 变体在效率和质量之间提供了最佳平衡。它在显著降低码率(175bps)的同时保持了高质量分数(MOSNet 3.39)和内容保真度(WER 8.43)。

---

### 3.3 Inference

#### Decoupling Speech-to-Speech Task

An ideal speech language model would operate solely on speech tokens for direct speech-to-speech tasks. However, given the success of large language models and the assumption that text representing the semantic content of most speech, we decouple the speech-to-speech task into two sub-tasks: speech-to-text and speech-and-text-to-speech. Given the user's speech input Qs, the correspond text response At, and the speech output As, these tasks are defined as follows:
• Speech-to-Text: The model generates a text response, At, based on the user's speech input, Qs.
• Speech-and-Text-to-Speech: Leveraging both Qs and At, the model generates spoken output, As, with adaptive tone and prosody to ensure conversational coherence.

> **3.3 推理**
>
> **语音到语音任务的解耦**
>
> 理想的语音语言模型应仅使用语音 token 进行直接的语音到语音任务。然而，鉴于大语言模型的成功以及文本可以表示大多数语音语义内容这一假设，我们将语音到语音任务解耦为两个子任务：语音到文本，以及语音加文本到语音。给定用户语音输入 Qs、对应的文本回复 At 和语音输出 As，这两个任务定义如下：
> • 语音到文本(Speech-to-Text)：模型基于用户语音输入 Qs 生成文本回复 At。
> • 语音加文本到语音(Speech-and-Text-to-Speech)：利用 Qs 和 At，模型生成语音输出 As，并带有自适应的语调和韵律以确保对话连贯性。

> **译者注: 解耦策略的深层逻辑**
>
> 「解耦」是 GLM-4-Voice 架构中最具设计感的决策之一。表面上看，端到端模型应该追求纯语音 token 的 S→S(Speech-to-Speech)，但团队发现文本作为语义中间表示的价值不可替代。理由很朴素：LLM 在文本上的认知能力远高于语音，先用文本「想清楚」再「说出去」，比直接 S→S 更可靠。实验数据也支持这一点——Table 4 显示 S→T(Speech-to-Text)的问答准确率显著高于 S→S(如 Llama Questions: 64.7 vs 50.7)。但解耦不等于级联：GLM-4-Voice 的创新在于「流式思考模板」让文本和语音交替生成，避免了传统 ASR→LLM→TTS 流水线的高延迟和误差累积。这是一种「软解耦」——文本指导语音，而非文本替代语音。

We adopt the decoupling strategy for the inference process. First, the model generates the text answer At based on the user input Qs, and then generates As using both Qs and At. In this way the generation of speech response As is guided by the text response At to improve performance. However, this approach results in a high initial token delay, as it requires waiting for the complete generation of At before starting on As. To address this, we apply a template named called Streaming Thoughts. As illustrated in Figure 2, given Qs, the model alternates between outputting text and speech tokens at a specified ratio, which are then concatenated to form At and As, respectively. Specifically, based on our 12.5Hz tokenizer, we alternate between generating 13 text tokens and 26 speech tokens. This 1:2 ratio is chosen to ensure that text generation is consistently faster than speech. Otherwise, the generated speech tokens would lack the necessary context from the text tokens. The choice of 26 speech tokens is based on empirical observations, allowing the model to produce a coherent portion of content before synthesizing it to ensure accuracy in the synthesized speech.

> 我们在推理过程中采用解耦策略。首先，模型基于用户输入 Qs 生成文本回复 At，然后利用 Qs 和 At 生成 As。这样，语音回复 As 的生成由文本回复 At 指导，以提升性能。然而，这种方法会导致较高的初始 token 延迟，因为需要等待 At 完全生成后才能开始生成 As。为解决此问题，我们应用了一个名为「流式思考(Streaming Thoughts)」的模板。如图 2 所示，给定 Qs，模型按指定比例交替输出文本和语音 token，随后分别拼接形成 At 和 As。具体而言，基于我们的 12.5Hz 分词器，我们交替生成 13 个文本 token 和 26 个语音 token。选择 1:2 的比例是为了确保文本生成始终快于语音生成。否则，生成的语音 token 将缺乏来自文本 token 的必要上下文。选择 26 个语音 token 是基于经验观察，使模型能够在合成前生成一段连贯的内容，以确保合成语音的准确性。

---

#### Overall Latency

The overall response latency for generating the first speech waveform can be calculated as follows:
• Speech Tokenization: The user's speech input is processed in a streaming manner by the speech tokenizer, which operates on blocks of fixed size tblock. Thanks to the streaming design, the tokenizer begins processing immediately and only requires the time to handle the current block, regardless of the total speech duration. Thus, the tokenization latency is: Tspeech_tokenize = fspeech_tokenize(tblock)
• LLM Prefilling: The number of speech tokens, Nspeech_tokens, generated by the tokenizer is based on the length of the user's speech Tuser_speech and the frame rate fr = 12.5 tokens per second. The prefill latency for the LLM is given by: Tllm_prefill = fllm_prefill (fr · Tuser_speech)
• LLM Decoding: For the initial audio response, the LLM generates 13 text tokens and 10 speech tokens, resulting in a total of Nfirst_speech = 13 + 10 = 23 tokens. The decoding latency for this step is: Tllm_decode = fllm_decode (Nfirst_speech)
• Speech Decoding: The Nspeech = 10 audio tokens are processed by the speech decoder to generate the first audio chunk. The latency for this step is: Tspeech_decode = fspeech_decode (Nspeech)
The total response latency is then: Ttotal = Tspeech_tokenize + Tllm_prefill + Tllm_decode + Tspeech_decode

> **总体延迟**
>
> 生成第一个语音波形的总体响应延迟可按以下步骤计算：
> • **语音分词**：用户语音输入由语音分词器以流式方式处理，分词器以固定大小 tblock 的块为单位运行。得益于流式设计，分词器立即开始处理，且只需处理当前块的时间，与语音总时长无关。因此，分词延迟为：Tspeech_tokenize = fspeech_tokenize(tblock)
> • **LLM 预填充**：分词器生成的语音 token 数 Nspeech_tokens 基于用户语音时长 Tuser_speech 和帧率 fr = 12.5 token/秒。LLM 的预填充延迟为：Tllm_prefill = fllm_prefill (fr · Tuser_speech)
> • **LLM 解码**：对于初始音频回复，LLM 生成 13 个文本 token 和 10 个语音 token，总计 Nfirst_speech = 13 + 10 = 23 个 token。此步骤的解码延迟为：Tllm_decode = fllm_decode(Nfirst_speech)
> • **语音解码**：Nspeech = 10 个音频 token 由语音解码器处理以生成第一个音频块。此步骤的延迟为：Tspeech_decode = fspeech_decode(Nspeech)
> 总体响应延迟为：Ttotal = Tspeech_tokenize + Tllm_prefill + Tllm_decode + Tspeech_decode

## 4 Training Procedure

### 4.1 Stage 1: Joint Speech-Text Pre-training

We adopt the same pre-training data and procedure in Zeng et al. [45]. The primary objective of this stage is to extend speech modeling ability to LLM through large-scale speech pre-training. We utilize three types of speech data:
• Interleaved speech-text data: Synthesized from text pre-training data as described in Zeng et al. [45], these datasets facilitate cross-modal knowledge transfer between text and speech.
• Unsupervised speech data: Comprising 700k hours of speech data, this dataset encourages the model to learn from real-world speech.
• Supervised speech-text data: Including both ASR and TTS data, this dataset improves the model's capabilities in basic speech tasks.
We also mix text pre-training datasets to maintain text performance. The statistics of training data is shown in Table 2.

> **4 训练流程**
>
> **4.1 第一阶段：联合语音-文本预训练**
>
> 我们采用与 Zeng 等人 [45] 相同的预训练数据和流程。本阶段的主要目标是通过大规模语音预训练将语音建模能力扩展到 LLM。我们使用三类语音数据：
> • **交错语音-文本数据**：如 Zeng 等人 [45] 所述，从文本预训练数据中合成，促进文本与语音之间的跨模态知识迁移。
> • **无监督语音数据**：包含 70 万小时语音数据，促使模型从真实世界语音中学习。
> • **监督语音-文本数据**：包括 ASR 和 TTS 数据，提升模型在基础语音任务上的能力。
> 我们还混合文本预训练数据集以保持文本性能。训练数据统计见 Table 2。

> **译者注: 1 万亿 token 的数据配方**
>
> Table 2 的数据配比值得细品：1 万亿 token 中，交错语音-文本数据占 45.5%(455B token，其中 279B 为语音)，无监督语音数据占 3.1%(31B token)，ASR+TTS 监督数据占 1.1%(11B 语音 + 3.5B 文本)，而文本-only 数据仅占 0.03%(10T 文本只跑了 0.03 个 epoch，即约 300B token)。这个配方的核心洞察是：交错数据是「桥梁」——它让模型学会语音和文本之间的映射关系; 无监督语音数据提供「真实世界分布」; 监督数据巩固基础能力; 而少量的文本数据只是「保温」——防止语音预训练过度侵蚀已有的文本认知能力。30% 的文本采样率(Table 2 注)与实际 token 占比看似矛盾，实际上是因为文本预训练数据本身规模极大(10T)，即使低采样率也能贡献可观 token 量。

#### 4.1.1 Hyper-parameters

We initialize GLM-4-Voice from GLM-4-9B-Base [16] and expand its vocabulary to include speech tokens. We perform pre-training on 1 trillion tokens, with a fixed sampling ratio of 30% text data, one epoch each of unsupervised speech and supervised speech-text data, and the remainder composed of interleaved speech-text data. The composition of the training corpora is detailed in Table 2. We use the AdamW [27] optimizer with β1 = 0.9 and β2 = 0.95. The model is trained with a sequence length of 8192 and a learning rate that linearly decays from 6 × 10−5 to 6 × 10−6.

> **4.1.1 超参数**
>
> 我们从 GLM-4-9B-Base [16] 初始化 GLM-4-Voice，并扩展其词表以包含语音 token。我们在 1 万亿 token 上进行预训练，固定采样 30% 的文本数据，无监督语音和监督语音-文本数据各跑一个 epoch，剩余部分由交错语音-文本数据组成。训练语料的组成详见 Table 2。我们使用 AdamW [27] 优化器，β1 = 0.9，β2 = 0.95。模型以 8192 的序列长度训练，学习率从 6×10⁻⁵ 线性衰减至 6×10⁻⁶。

---

### 4.2 Stage 2: Supervised Fine-tuning

#### 4.2.1 Data Construction

To create a human-like spoken chatbot, we utilize the following two types of data:
• Multi-turn conversational spoken dialogues: These dialogues are primarily derived from text-based data, carefully filtered to ensure quality. Code and math-related content are excluded to focus on conversational material suitable for spoken interactions. Responses are refined by shortening lengthy texts and avoiding outputs unsuitable for verbal delivery. Corresponding speech outputs are synthesized to align with the refined dialogues. To enhance speech input diversity in real-world voice chat scenarios, annotators read and record a variety of speech inputs.
• Speech style-controlled spoken dialogues: This category contains high-quality multi-turn spoken dialogues tailored to specific speech style requirements, such as speed, emotion, or dialect.

> **4.2 第二阶段：监督微调**
>
> **4.2.1 数据构建**
>
> 为了创建拟人化的语音对话机器人，我们使用以下两类数据：
> • **多轮对话式口语对话**：主要来源于文本数据，经过仔细筛选以确保质量。排除代码和数学相关内容，聚焦于适合口语交互的对话材料。通过缩短冗长文本并避免不适合口头表达的输出来精炼回复。相应的语音输出被合成以与精炼后的对话对齐。为增强真实世界语音聊天场景中语音输入的多样性，标注员朗读并录制了多种语音输入。
> • **语音风格控制的口语对话**：这类数据包含针对特定语音风格要求(如语速、情感或方言)定制的高质量多轮口语对话。

#### 4.2.2 Training Details

As described in Section 3.3, we decouple the speech-to-speech task into two subtasks and employ the streaming thoughts template to reduce latency. Each conversational turn consists of a user speech input Qs, the corresponding text input Qt, a text output At, and the corresponding speech output As. We observed differing learning curves for the two subtasks. Specifically, given a user speech input Qs, the model learns the text output At more quickly and compared to the speech output As. To address this discrepancy, we split each training sample into two components: one focuses on learning the text output from the speech input by masking the loss for the speech output, while the other focuses on learning the speech output from both the speech input and text output by masking the loss for the text output.

> **4.2.2 训练细节**
>
> 如第 3.3 节所述，我们将语音到语音任务解耦为两个子任务，并采用流式思考模板以降低延迟。每个对话轮次包含用户语音输入 Qs、对应的文本输入 Qt、文本输出 At 和对应的语音输出 As。我们观察到两个子任务的学习曲线不同。具体而言，给定用户语音输入 Qs，模型学习文本输出 At 比学习语音输出 As 更快。为解决这一差异，我们将每个训练样本拆分为两个部分：一部分聚焦于从语音输入学习文本输出(对语音输出的 loss 做掩码)，另一部分聚焦于从语音输入和文本输出学习语音输出(对文本输出的 loss 做掩码)。

The model is fine-tuned for 20 epochs on speech output and 4 epochs on text output. The learning rate is gradually reduced from 1 × 10−5 to 1 × 10−6. To mitigate overfitting, we apply a weight decay of 0.1, set a dropout rate of 0.5 for hidden layers, and clip gradients to a maximum value of 1.0.

> 模型在语音输出上微调 20 个 epoch，在文本输出上微调 4 个 epoch。学习率从 1×10⁻⁵ 逐步降低至 1×10⁻⁶。为缓解过拟合，我们施加 0.1 的权重衰减，隐藏层 dropout 率设为 0.5，梯度裁剪最大值为 1.0。

> **译者注: 双学习曲线与非对称训练**
>
> SFT 阶段的「双学习曲线」现象揭示了语音和文本模态在 LLM 中的不对称性：文本输出 At 学得更快(仅需 4 epoch)，而语音输出 As 需要 20 epoch。这并不意外——GLM-4-9B 基座在文本上已经充分预训练，语音只是「增量学习」; 但语音生成涉及韵律、音色、副语言特征等更细粒度的建模，需要更多迭代。团队的对策是将每个样本拆分为两个 loss-masked 变体，本质上是「多任务学习」的变体：让模型在同一批数据中分别优化两个目标，避免一个目标主导梯度。20:4 的 epoch 比例(5:1)是经过观察后的经验设定，体现了对语音生成难度的认知。隐藏层 dropout 高达 0.5 也值得关注，这在 LLM 微调中属于激进值，说明团队对过拟合风险有充分预期——毕竟高质量对话语音数据的规模相对有限。

---

## 5 Evaluation

### 5.1 Base Model Evaluation

We evaluate the base model with two speech-text tasks, speech language modeling [5] and spoken question answering [30]. For both tasks we consider two different settings: from speech context to speech generation (denoted as S→S), and from speech context to text generation, denoted as S→T. For all the tasks we synthesis the contexts and continuations with the multi-speaker TTS API provided by VolcEngine1.

> **5 评测**
>
> **5.1 基座模型评测**
>
> 我们通过两项语音-文本任务评测基座模型：语音语言建模 [5] 和口语问答 [30]。对于两项任务，我们考虑两种不同的设置：从语音上下文生成语音(记为 S→S)，以及从语音上下文生成文本(记为 S→T)。所有任务的上下文和续写均使用 VolcEngine 提供的多说话人 TTS API 合成。

#### Speech Language Modeling

This tasks evaluates the pretrained model's ability to model interleaved speech and texts. The model is given a context and required to select the correct continuation according to the predicted likelihood. We use two datasets proposed by Hassid et al. [17], spoken StoryCloze and spoken Topic-StoryCloze. Both datasets are transformed from the StoryCloze textual benchmark [29]. The spoken Topic-StoryCloze is easier than spoken StoryCloze. The baseline results are taken from Défossez et al. [12].

> **语音语言建模**
>
> 该任务评测预训练模型对交错语音和文本的建模能力。模型被给予一段上下文，需要根据预测概率选择正确的续写。我们使用 Hassid 等人 [17] 提出的两个数据集：口语 StoryCloze 和口语 Topic-StoryCloze。两个数据集均由 StoryCloze 文本基准 [29] 转换而来。口语 Topic-StoryCloze 比口语 StoryCloze 更简单。基线结果取自 Défossez 等人 [12]。

#### Spoken Question Answering

Similar to closed-book question answering in NLP, spoken question answering requires the speech language model to answer spoken questions about broad factual knowledge without access to external knowledge base. We evaluate our model on 3 datasets used in Défossez et al. [12], Web Questions [4], Llama Questions [30], and TriviaQA [21]. The baseline results are taken from Défossez et al. [12].

> **口语问答**
>
> 类似于 NLP 中的闭卷问答，口语问答要求语音语言模型在不依赖外部知识库的情况下回答关于广泛事实知识的语音问题。我们在 Défossez 等人 [12] 使用的 3 个数据集上评测模型：Web Questions [4]、Llama Questions [30] 和 TriviaQA [21]。基线结果取自 Défossez 等人 [12]。

#### Results

The results for speech language modeling are shown in Table 3 and those for spoken question answering are shown in Table 4. We can observe that GLM-4-Voice outperforms baselines on all the evaluated tasks in both S→S and S→T settings, except Topic-StoryCloze in the S→S setting. Compared with Moshi [12], which also supports both speech and text modalities, our model excels in spoken question answering, whether the answers are textual or spoken. Another observation is that the accuracy in the S→T setting is always better than that in the S→S setting, especially for spoken question answering. Therefore textual guidance is still necessary for intelligent speech chatbots. However, our method significantly reduces the gap between spoken answers and textual answers on spoken question answering, especially on Llama Questions, with the potential to develop direct speech-to-speech chatbots.

> **结果**
>
> 语音语言建模结果见 Table 3，口语问答结果见 Table 4。我们可以观察到，GLM-4-Voice 在 S→S 和 S→T 两种设置下的所有评测任务上均优于基线，除 S→S 设置下的 Topic-StoryCloze 外。与同样支持语音和文本模态的 Moshi [12] 相比，我们的模型在口语问答上表现突出，无论答案是文本还是语音形式。另一个观察是，S→T 设置下的准确率始终优于 S→S 设置，尤其在口语问答上。因此，对于智能语音对话机器人而言，文本指导仍然是必要的。然而，我们的方法显著缩小了口语问答中语音答案与文本答案之间的差距，尤其在 Llama Questions 上，展现了开发直接语音到语音对话机器人的潜力。

> **译者注: S→T 与 S→S 的性能差距意味着什么**
>
> Table 3 和 Table 4 的数据传递了一个重要信号：S→T(语音输入→文本输出)始终优于 S→S(语音输入→语音输出)。在 Llama Questions 上，差距尤其明显(64.7 vs 50.7)。这验证了团队「解耦」策略的合理性——文本作为中间表示确实能提升认知质量。但更有趣的是差距在缩小：相比 Moshi S→S 的 21.0，GLM-4-Voice S→S 达到了 50.7，提升超过 1.4 倍。这说明大规模语音-文本交错预训练(1T token)确实在弥合语音模态与文本模态之间的「智商差距」。不过，S→S 仍然追不上 S→T，意味着「纯语音思考」在短期内仍难以匹敌「文本思考+语音表达」的混合模式。这一发现对整个 SpeechLM 领域都有启示：文本不会消亡，但语音模态的认知能力正在快速提升。

#### ASR / TTS

We prompt the base model with the same prompt format used for the ASR / TTS task in pre-training. Whisper-Large-V3 [36] and Paraformer-Large [38] are employed to generate the text prediction for English and Chinese recognition in the TTS task respectively. Before computing the error rate, the text prediction is normalized respectively with tokenizer of whisper-large-v3 and CosyVoice [14] pipeline for ASR and TTS tasks. The results are summarized in Table 5. GLM-4-Voice achieve similar ASR and TTS ability compared with whisper-large-v3[36] and CosyVoice [14] baselines.

> **ASR / TTS**
>
> 我们使用与预训练中 ASR/TTS 任务相同的 prompt 格式提示基座模型。TTS 任务中，Whisper-Large-V3 [36] 和 Paraformer-Large [38] 分别用于生成英文和中文识别的文本预测。在计算错误率之前，文本预测分别使用 whisper-large-v3 的分词器和 CosyVoice [14] 流程进行归一化。结果汇总于 Table 5。GLM-4-Voice 的 ASR 和 TTS 能力与 whisper-large-v3 [36] 和 CosyVoice [14] 基线相当。

---

### 5.2 Chat Model Evaluation

#### ChatGPT Score

To evaluate the question answering ability and knowledge memorization of the fine-tuned chat model, we use GPT-4o [33], specifically gpt-4o-2024-05-13, to evaluate quality or correctness of the model response. For the General QA task, we adopt the questions from the helpful base and vicuna subset of AlpacaEval [25] with math-related questions removed, which follows the chat evaluation dateset of Llama-Omni [15]. We ask GPT-4o to evaluate response quality and score the response in a range from 1 to 10 following the evaluation method of MT-Bench [49]. For the Knowledge task, we select 100 questions from Web Questions, Llama Questions, and TriviaQA. We provide GPT-4o with ground-truth answer and ask it to judge whether the response of the model is correct. The score reported in Table 6 is the answer accuracy normalized to a scale of 0 (0%) to 10 (100%). All texts used for judging are audio transcriptions produced by Whisper-Large-V3 [36] and the prompts used for scoring are included in Appendix A.1.

> **5.2 对话模型评测**
>
> **ChatGPT Score**
>
> 为了评测微调后对话模型的问答能力和知识记忆能力，我们使用 GPT-4o [33](具体为 gpt-4o-2024-05-13)来评估模型回复的质量或正确性。对于通用 QA 任务，我们采用 AlpacaEval [25] 的 helpful base 和 vicuna 子集中的问题，并移除数学相关问题，这与 Llama-Omni [15] 的对话评测数据集一致。我们请 GPT-4o 按照 MT-Bench [49] 的评测方法评估回复质量，并在 1 到 10 的范围内打分。对于知识任务，我们从 Web Questions、Llama Questions 和 TriviaQA 中选取 100 个问题。我们向 GPT-4o 提供标准答案，并请其判断模型回复是否正确。Table 6 中报告的分数是答案准确率归一化到 0(0%)至 10(100%)的量表。所有用于评判的文本均由 Whisper-Large-V3 [36] 生成的音频转写，评分所用 prompt 包含在附录 A.1 中。

#### Speech Quality

We use the UTMOS [37] model to predict the mean opinion score (MOS) to evaluate the naturalness of the generated speech.

> **语音质量**
>
> 我们使用 UTMOS [37] 模型预测平均意见分(MOS)来评估生成语音的自然度。

#### Speech-Text Alignment

To evaluate the correspondence between the generated text responses and speech responses, we transcribe the speech responses for the General QA task into text with whisper-large-v3 [36]. Then, the word error rate (WER) is calculated between the transcription and the text response, which is referred to as ASR-WER(%) in Table 6. GLM-4-Voice is a bilingual model and sometimes answers the English query with a Chinese response, whose WER cannot be calculated directly. For a fair comparison with the English-only baseline models, we restrict the output of GLM-4-Voice to English tokens when evaluating the tasks reported in Table 6.

> **语音-文本对齐**
>
> 为了评估生成的文本回复与语音回复之间的一致性，我们使用 whisper-large-v3 [36] 将通用 QA 任务的语音回复转写为文本。然后计算转写与文本回复之间的词错误率(WER)，在 Table 6 中记为 ASR-WER(%)。GLM-4-Voice 是双语模型，有时会用中文回复英文查询，这种情况下 WER 无法直接计算。为了与仅支持英文的基线模型公平比较，我们在评测 Table 6 报告的任务时将 GLM-4-Voice 的输出限制为英文 token。

> **译者注: 评测方法论的自我审视**
>
> Table 6 的评测设计有几个值得注意的细节。首先，GPT-4o 作为评判者(judge)已是业界惯例，但将语音回复先转写为文本再评判，实际上是在用文本智能的标尺衡量语音智能——这与论文强调的「语音模态独特性」存在一定张力。其次，ASR-WER 指标衡量的是语音输出与文本输出的一致性，而非语音输出的绝对质量; 低 WER(5.74%)说明语音和文本内容高度对齐，但不能直接推断语音本身是否自然。UTMOS(5.20)作为语音自然度的客观预测指标，与 SpeechGPT 的 1.40、Mini-Omni 的 1.10 形成鲜明对比，确实证明了 GLM-4-Voice 在语音质量上的优势。但需要注意评测限制：英文-only 的输出限制掩盖了双语模型的真实能力，实际应用中中文回复的语音质量未被充分评估。

## 6 Conclusion

In this paper, we introduced GLM-4-Voice, an end-to-end spoken chatbot designed for natural and expressive voice interactions. By integrating a 12.5Hz supervised speech tokenizer, a flow-matching based speech decoder, and large-scale pre-training on 1 trillion tokens of speech-text data, GLM-4-Voice effectively bridges text and speech modalities. It achieves strong performance across tasks like speech language modeling, ASR, TTS, and spoken question answering. Fine-tuning with high-quality conversational datasets further enhances its ability to generate fluent, low-latency, and nuanced responses. The open availability of GLM-4-Voice encourages further exploration in building practical and accessible spoken AI systems.

> **6 结论**
>
> 本文介绍了 GLM-4-Voice，一个为自然而富有表现力的语音交互设计的端到端语音对话机器人。通过集成 12.5Hz 监督式语音分词器、基于 flow matching 的语音解码器，以及在 1 万亿 token 语音-文本数据上的大规模预训练，GLM-4-Voice 有效桥接了文本和语音模态。它在语音语言建模、ASR、TTS 和口语问答等任务上均取得了强劲表现。使用高质量对话数据集进行微调，进一步增强了其生成流畅、低延迟、细腻回复的能力。GLM-4-Voice 的开放可用性将鼓励在构建实用且易获取的语音 AI 系统方面的进一步探索。


> **参考文献与附录**
>
> 第 10-13 页为参考文献列表([1]-[49])，涵盖语音合成、语音识别、语言模型、评估方法等领域的经典与前沿工作。第 14 页附录 A.1 提供了评测对话机器人所用的 GPT-4o prompt 模板，包括通用 QA 的评分指令和知识任务的 JSON 格式判断指令。
>
> 参考文献中值得注意的工作包括：CosyVoice [14](监督语义 token 与 TTS)、Moshi [12](全双工语音对话)、Qwen-Audio [9](通用音频理解)、Whisper [36](大规模弱监督语音识别)、Flow Matching [28](生成模型)、以及同团队的前置工作 Zeng et al. [45](合成交错数据的语音-文本预训练)。这些文献构成了 GLM-4-Voice 的技术底座，也勾勒出 2023-2024 年语音语言模型领域的快速演进图景。

## 全文完

## 关联文件说明

| 文件 | 说明 |
| --- | --- |
| [03-GLM-4-Voice-mineru-en.md](./03-GLM-4-Voice-mineru-en.md) | MinerU 英文原文(D3) |
| [01-GLM-4-Voice 技术报告精译.md](./01-GLM-4-Voice技术报告精译.md) | 中文精译主稿(D2) |
| [02-GLM-4-Voice 核心架构剖析.md](./02-GLM-4-Voice核心架构剖析.md) | 架构专题(D2) |
| [05-GLM-4-Voice-Index.md](./05-GLM-4-Voice-Index.md) | 技术入口 Index(D5) |
| [05-GLM-4-Voice-Architecture-Overview.md](./05-GLM-4-Voice-Architecture-Overview.md) | 低延迟与分词器专题 |
| [pdfs/GLM-4-Voice.pdf](./pdfs/GLM-4-Voice.pdf) | 官方论文 PDF |
| [images/](./images/) | 论文插图 |
