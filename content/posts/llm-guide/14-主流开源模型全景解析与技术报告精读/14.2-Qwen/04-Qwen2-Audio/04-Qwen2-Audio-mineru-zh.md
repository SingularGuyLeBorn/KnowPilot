---
title: "04 · Qwen2-Audio Technical Report (MinerU 中文精译与译者注)"
source: 03-Qwen2-Audio-mineru-en.md
source_pdf: pdfs/Qwen2-Audio.pdf
date: 2026-05-23
---

# Qwen2-Audio Technical Report 中文精译与译者注

>  **[返回 14.2-Qwen 家族总览](../../14.2-Qwen.md)**

## 原文标题说明

- 原文标题: Qwen2-Audio Technical Report
- 原文作者: Qwen Team, Alibaba Group
- 原文来源: arXiv:2407.10759
- 逐译底稿: `03-Qwen2-Audio-mineru-en.md`
- 关联精译: `01-Qwen2-Audio技术报告精译.md`
- 关联专题: `05-Qwen2-Audio-Architecture-Overview.md`

## 分节结构

1. 摘要: 统一自然语言提示与双模式交互
2. 引言: 音频理解与模型定位
3. 方法
4. 实验与主结果
5. 案例展示
6. 结论、致谢与补充说明

---

## 1. 摘要: 统一自然语言提示与双模式交互

### 1.1 核心能力

#### 原文

We introduce the latest progress of Qwen-Audio, a large-scale audio-language model called Qwen2-Audio, which is capable of accepting various audio signal inputs and performing audio analysis or direct textual responses with regard to speech instructions.

In contrast to complex hierarchical tags, we have simplified the pre-training process by utilizing natural language prompts for different data and tasks, and have further expanded the data volume.

#### 译文

本文介绍 Qwen-Audio 系列的最新进展，即大规模音频语言模型 Qwen2-Audio。它能够接收多种音频信号输入，并围绕语音指令执行音频分析，或者直接给出文本回复。

与复杂的层次化标签不同，作者改用自然语言提示来统一描述不同数据和任务，从而简化预训练过程，并进一步扩大了训练数据规模。

> 译者注: 这里真正重要的变化不是“多了多少数据”，而是任务接口从专用 token 切成了自然语言。这样预训练、SFT 和实际用户使用时的输入样式更接近，模型不用再为“先识别任务 token，再执行任务”单独浪费容量。

### 1.2 双模式交互

#### 原文

We have boosted the instruction-following capability of Qwen2-Audio and implemented two distinct audio interaction modes for voice chat and audio analysis.

In the voice chat mode, users can freely engage in voice interactions with Qwen2-Audio without text input. In the audio analysis mode, users could provide audio and text instructions for analysis during the interaction.

Note that we do not use any system prompts to switch between voice chat and audio analysis modes.

#### 译文

Qwen2-Audio 进一步增强了指令遵循能力，并实现了两种不同的音频交互模式：语音聊天和音频分析。

在语音聊天模式下，用户不需要文本输入，就可以直接和模型进行语音对话。在音频分析模式下，用户则可以同时提供音频和文本指令，让模型围绕输入音频执行分析。

需要特别指出的是，这两种模式之间并不依赖系统提示来切换。也就是说，模型要靠自己理解输入内容，判断当前更像是在“聊天”，还是更像在“分析音频”。

> 译者注: 这一步比“ASR 转文字后再喂给 LLM”难得多。模型不仅要听懂音频内容，还要在音频里找出真正承担“指令”角色的片段，并据此切换响应方式。

### 1.3 效果概览

#### 原文

According to the evaluation results from AIR-Bench, Qwen2-Audio outperformed previous SOTAs, such as Gemini-1.5-pro, in tests focused on audio-centric instruction-following capabilities.

#### 译文

根据 AIR-Bench 的评测结果，Qwen2-Audio 在以音频为中心的指令遵循测试中超过了此前的 SOTA 模型，例如 Gemini-1.5-pro。

---

## 2. 引言: 音频理解与模型定位

### 2.1 为什么音频重要

#### 原文

Audio serves as a crucial medium for interaction and communication among humans and other living beings, carrying rich information content.

A comprehensive understanding of various forms of audio signals is paramount to achieving Artificial General Intelligence (AGI).

#### 译文

音频是人类以及其他生物之间互动和交流的重要媒介，里面承载了大量信息。

如果希望朝着更通用的人工智能继续推进，模型就必须能够全面理解各种形式的音频信号，而不只是把语音转写成文字。

### 2.2 Qwen2-Audio 的定位

#### 原文

In this report, we develop Qwen2-Audio, with a primary focus on enhancing its instruction-following capabilities.

Qwen2-Audio is a Large Audio-Language Model (LALM) designed to process both audio and text inputs to generate textual outputs.

#### 译文

在这篇报告中，作者开发 Qwen2-Audio 的核心目标，是提升模型围绕音频输入执行指令的能力。

Qwen2-Audio 是一个音频语言模型，能够同时处理音频和文本输入，并最终输出文本结果。

### 2.3 结果图示

#### 原文

As shown in Figure 1, extensive evaluation demonstrates that Qwen2-Audio, without any task-specific fine-tuning, outperforms previous LALMs across a diverse range of tasks.

#### 译文

如图 1 所示，广泛评测表明，Qwen2-Audio 在无需任务特定微调的前提下，已经能在多种任务上超过此前的音频语言模型。

![Qwen2-Audio 与 Qwen-Audio 及前沿音频语言模型的任务雷达对比](./images/figure_01_benchmark_radar.jpg)

> Figure 1: Performance of Qwen2-Audio, Qwen-Audio and previous top tiers across ASR, S2TT, SER, VSC and AIR-Bench tasks.
>
> 图 1：Qwen2-Audio、Qwen-Audio 以及前代代表模型在语音识别、语音翻译、情感识别、人声分类和 AIR-Bench 等任务上的综合表现对比。

> 译者注: 这张图的重要性不在于“某个单点分数更高”，而在于它把 Qwen2-Audio 明确定位成一个通用音频助手，而不是单一语音识别工具。

---

## 3. 方法

### 3.1 Model Architecture

#### 原文

The training process of Qwen2-Audio is depicted in Figure 2, which contains an audio encoder and a large language model.

Given the paired data (a, x), where a and x denote the audio sequences and text sequences, the training objective is to maximize the next text token probability.

Different from Qwen-Audio, the initialization of the audio encoder of Qwen2-Audio is based on the Whisper-large-v3 model.

#### 译文

Qwen2-Audio 的训练流程如图 2 所示，整体由一个音频编码器和一个大语言模型组成。

给定配对数据 `(a, x)`，其中 `a` 表示音频序列，`x` 表示文本序列，训练目标是在已有音频表示和已有文本前缀的条件下，最大化下一个文本 token 的生成概率。

与 Qwen-Audio 不同，Qwen2-Audio 的音频编码器初始化基于 Whisper-large-v3。这意味着它直接站在成熟语音表示模型的基础上做模态融合，而不是从零重新训练整个音频前端。

![Qwen2-Audio 三阶段训练流程图](./images/figure_02_training_pipeline.jpg)

> Figure 2: The overview of three-stage training process of Qwen2-Audio.
>
> 图 2：Qwen2-Audio 的三阶段训练总览，包括预训练、监督微调与偏好优化。

### 3.2 Pre-training

#### 原文

At the pre-training stage, we replace the hierarchical tags with natural language prompts, as shown in Figure 2.

We find that using language prompts can improve both generalization ability and instruction-following ability.

#### 译文

在预训练阶段，作者用自然语言提示取代了原先的层次化标签。

实践表明，这种做法能同时提升模型的泛化能力和指令遵循能力，因为模型面对的是统一的自然语言接口，而不是一组人为定义的任务开关。

### 3.3 Supervised Fine-tuning

#### 原文

The thorough pre-training of Qwen2-Audio has equipped the model with a comprehensive understanding of audio content.

Building upon this, we employ instruction-based fine-tuning techniques to improve the ability of the model to align with human intent, resulting in an interactive chat model.

Our preliminary study emphasizes the critical influence of the quality and complexity of SFT data on the model's performance.

#### 译文

充分的预训练让 Qwen2-Audio 获得了对音频内容的全面理解能力。

在此基础上，作者使用基于指令的监督微调来进一步提升模型和人类意图之间的对齐能力，使其最终具备可交互的聊天行为。

他们还明确指出：SFT 数据的质量和复杂度，对模型最终效果有决定性影响。这说明 Qwen2-Audio 的性能不只是架构决定的，训练数据设计同样是核心部分。

![预训练数据小时数统计](./images/chart_03_pretraining_hours.jpg)

> Figure 3: Statistics (hours) of pre-training dataset.
>
> 图 3：预训练数据集在语音、声音和音乐三类任务上的小时数分布统计。

> 译者注: 图 3 说明这不是一个只靠语音识别数据堆出来的系统。它同时吸收了环境声音和音乐任务数据，这也是它能够处理混合音频和非语音内容的关键基础。

### 3.4 Direct Preference Optimization

#### 原文

We employ DPO to further optimize models to follow human preferences.

By obtaining the dataset with triplet data, we optimize the model to prefer good responses over bad responses.

#### 译文

作者进一步使用 DPO 来优化模型，使其更符合人类偏好。

在这个阶段，训练数据不再只是“输入和答案”的简单对应，而是包含同一输入下更优回答和更差回答的成对偏好信息，让模型学习把概率质量向更好回答倾斜。

> 译者注: 对音频模型而言，DPO 的价值不只是让回答更“好听”，而是提升事实性、行为稳定性和多轮交互中的一致性。对于开放式音频问答，这类后训练收益通常非常明显。

---

## 4. 实验与主结果

### 4.1 Evaluation

#### 原文

We mainly evaluated performance directly on AIR-Bench.

We still perform a comprehensive evaluation that encompasses various tasks, namely Automatic Speech Recognition (ASR), Speech-to-Text Translation (S2TT), Speech Emotion Recognition (SER), and Vocal Sound Classification (VSC).

#### 译文

作者把 AIR-Bench 作为最核心的评测基准，因为他们认为它比很多传统数据集更接近真实用户交互体验。

与此同时，论文仍然保留了更传统的全面评测，包括自动语音识别、语音翻译、语音情感识别和人声分类等任务，用来验证模型是不是在通用音频理解上也足够扎实。

### 4.2 Main Results

#### 原文

Qwen2-Audio exhibits superior performance compared to previous multi-task learning models. Specifically, it achieves a 1.6% and 3.6% WER on the Librispeech test-clean and test-other datasets, respectively.

The results reveal that Qwen2-Audio outperforms the baselines by a substantial margin across all seven translation directions.

Qwen2-Audio demonstrates state-of-the-art instruction-following capabilities across speech, sound, music and mixed-audio subsets.

#### 译文

Qwen2-Audio 在多个任务上都明显优于此前的多任务学习模型。以英文 ASR 为例，它在 Librispeech 的 `test-clean` 和 `test-other` 上分别做到 `1.6%` 与 `3.6%` 的 WER。

在 CoVoST2 语音翻译任务上，它在全部七个翻译方向上都超过了基线模型。

而在更贴近真实交互的 AIR-Bench 上，Qwen2-Audio 在语音、声音、音乐和混合音频几个子集里都展现出当时最强的音频指令遵循能力。

> 译者注: 这里最值得看的其实是 AIR-Bench，不是因为它最“权威”，而是因为它更像真实产品环境里的任务分布。Qwen2-Audio 的强项，恰恰是把音频理解和开放式问答结合起来。

---

## 5. 案例展示

### 5.1 围绕语音的自由聊天

#### 原文

Figure 4: Example showing Qwen2-Audio’s capability in free chat around speech.

#### 译文

图 4 展示了 Qwen2-Audio 围绕语音内容进行自由聊天的能力。用户不仅可以让它理解说话内容，还可以进一步围绕情绪、身份和建议等问题展开追问。

![语音自由聊天案例](./images/figure_04_voice_chat_case.jpg)

> 图 4：围绕语音内容进行自由聊天的交互案例。

### 5.2 翻译与连续对话

#### 原文

Figure 5: Example showing Qwen2-Audio’s capability in free chat around speech.

Figure 6: Example showing Qwen2-Audio’s capability in free chat around speech and nature sound.

#### 译文

图 5 体现了 Qwen2-Audio 在语音翻译、多语言转换和连续改写上的能力。它不是一次性给出翻译，而是能围绕同一输入继续执行多轮变换。

图 6 则展示了模型在混合环境声和自然语言请求同时存在时，仍然能够抓住用户意图并给出合理建议。

![语音翻译与续写案例](./images/figure_05_speech_translation_case.jpg)

> 图 5：围绕语音输入执行多语言翻译和语义改写。

![噪声与自然声场景案例](./images/figure_06_noise_and_nature_case.jpg)

> 图 6：在环境噪声与自然声音背景下的自由聊天能力。

### 5.3 语音、声音与音乐分析

#### 原文

Figure 7: Example showing Qwen2-Audio’s capability in speech analysis.

Figure 8: Example showing Qwen2-Audio’s capability in sound analysis.

Figure 9: Example showing Qwen2-Audio’s capability in music analysis.

#### 译文

图 7 展示了模型在语音分析上的能力，例如先转录原始内容，再根据进一步指令进行扩写和重写。

图 8 展示了它在非语音声音分析上的表现，例如识别警报、气刹和发动机等复合环境声，并据此给出场景解释与建议。

图 9 则说明它已经能对音乐做相对结构化的分析，包括节奏、拍号和调性等信息。

![语音分析案例](./images/figure_07_speech_analysis_case.jpg)

> 图 7：先理解语音内容，再按后续要求继续加工输出。

![声音分析案例](./images/figure_08_sound_analysis_case.jpg)

> 图 8：围绕非语音环境声执行识别、解释与建议生成。

![音乐分析案例](./images/figure_09_music_analysis_case.jpg)

> 图 9：对音乐内容进行风格、节奏、拍号与调性分析。

### 5.4 混合音频鲁棒性

#### 原文

Figure 10: Example showing Qwen2-Audio’s robustness in mixed audio analysis.

#### 译文

图 10 说明 Qwen2-Audio 在混合音频场景中的鲁棒性：无论歌词与噪声混在一起，还是说话声与音乐交织在一起，模型都还能稳定抽取目标内容。

![混合音频鲁棒性案例](./images/figure_10_mixed_audio_case.jpg)

> 图 10：混合音频条件下的歌词与语音内容抽取能力。

> 译者注: 这一组案例比单一 benchmark 更能说明产品价值。真实世界的音频输入几乎从来都不是“干净单声道”，而是各种声音、说话人和背景混在一起。Qwen2-Audio 的意义就在这里。

---

## 6. 结论、致谢与补充说明

### 6.1 结论

#### 原文

In this paper, we present Qwen2-Audio, which builds upon Qwen-Audio’s capability to analyze various types of audio while also being endowed with voice interaction abilities.

Objective metrics tested on diverse benchmarks demonstrate Qwen2-Audio’s proficiency in audio understanding and dialogue capabilities.

#### 译文

这篇报告给出的 Qwen2-Audio，不只是 Qwen-Audio 的简单增量版，而是在保留多类型音频分析能力的同时，正式补上了自然语音交互能力。

多项 benchmark 的结果说明，它已经具备相当强的音频理解和围绕音频进行对话的能力。

### 6.2 致谢

#### 原文

We express our gratitude to Jinze Bai, Shuai Bai, Peng Wang, Sinan Tan, Shijie Wang, Kai Dang for their insightful discussion.

#### 译文

作者在致谢中感谢了 Jinze Bai、Shuai Bai、Peng Wang、Sinan Tan、Shijie Wang 与 Kai Dang 等人的讨论和支持。

### 6.3 补充说明

> 译者注: 从技术谱系上看，Qwen2-Audio 是 Qwen 多模态路线上的一个关键中间站。它把“统一自然语言提示”“双模式联合训练”“音频 DPO 对齐”这几件事先在音频场景里跑通，后续 Qwen2.5-Omni 之类更全的多模态路线，实际上就是在这个基础上继续外推。

---

## 全文完

## 关联文件说明

- 英文底稿: `03-Qwen2-Audio-mineru-en.md`
- 前序精译: `01-Qwen2-Audio技术报告精译.md`
- 架构专题: `05-Qwen2-Audio-Architecture-Overview.md`
- 索引入口: `05-Qwen2-Audio-Index.md`
