---
title: "04 · ChatGLM 技术报告逐段翻译"
source: 03-ChatGLM-mineru-en.md
translated_by: "AI Agent"
date: 2026-05-23
---

# ChatGLM 技术报告逐段翻译

> 原文标题: ChatGLM: A Family of Large Language Models from GLM-130B to GLM-4 All Tools
> 翻译基于: MinerU 英文提取稿 `03-ChatGLM-mineru-en.md`

---

## Abstract

**原文**:
We introduce ChatGLM, an evolving family of large language models that we have been developing over time. This report primarily focuses on the GLM-4 language series, which includes GLM-4, GLM-4-Air, and GLM-4-9B. They represent our most capable models that are trained with all the insights and lessons gained from the preceding three generations of ChatGLM.

**译文**:
我们介绍 ChatGLM，这是一条持续演进中的大语言模型家族，也是我们长期逐步开发出来的一系列模型。本报告的重点主要放在 GLM-4 语言模型系列上，其中包括 GLM-4、GLM-4-Air 和 GLM-4-9B。这些模型代表了我们目前能力最强的一批系统，并整合了前三代 ChatGLM 迭代过程中积累的全部经验与教训。

**原文**:
To date, the GLM-4 models are pre-trained on ten trillions of tokens mostly in Chinese and English, along with a small set of corpus from 24 languages, and aligned primarily for Chinese and English usage. The high-quality alignment is achieved via a multi-stage post-training process, which involves supervised fine-tuning and learning from human feedback.

**译文**:
截至目前，GLM-4 系列模型已在以中英文为主、外加 24 种语言少量语料构成的约 10T token 上完成预训练，并主要针对中文和英文使用场景进行了对齐。高质量对齐是通过多阶段后训练流程实现的，其中包括监督微调(SFT)以及基于人类反馈的学习过程。

**原文**:
Evaluations show that GLM-4 closely rivals or outperforms GPT-4 on general metrics, gets close to GPT-4-Turbo in instruction following, matches GPT-4 Turbo and Claude 3 for long context tasks, and outperforms GPT-4 in Chinese alignments.

**译文**:
评测结果表明，GLM-4 在通用指标上已经能够接近甚至超过 GPT-4，在指令跟随方面逼近 GPT-4-Turbo，在长上下文任务上与 GPT-4 Turbo 和 Claude 3 处于相近水平，并且在中文对齐方面优于 GPT-4。

**原文**:
The GLM-4 All Tools model is further aligned to understand user intent and autonomously decide when and which tools to use, including web browser, Python interpreter, text-to-image model, and user-defined functions.

**译文**:
GLM-4 All Tools 版本则在此基础上继续做了工具使用对齐，使模型能够理解用户意图，并自主决定在何时、调用哪些工具，包括网页浏览器、Python 解释器、文生图模型以及用户自定义函数。

> 译者注：摘要的重点其实不只是“GLM-4 分数接近 GPT-4”，更重要的是智谱把 ChatGLM、GLM-4、All Tools 这三条演化线合并成了一个连续谱系：从中文对话模型，到通用双语大模型，再到具备工具调用和 agent 能力的系统。这个谱系感是理解 ChatGLM 家族价值的关键。

---

## 1 Introduction

**原文**:
The rapid development of large language models has been phenomenal. Taking the GPT series as an example, scale-up from GPT-1 to GPT-3 enabled in-context learning and generalized capabilities. GPT-3.5 further improved performance with instruction tuning, supervised fine-tuning, and reinforcement learning from human feedback, which has become a standard procedure for creating performing LLMs.

**译文**:
大语言模型的发展速度极其惊人。以 GPT 系列为例，从 GPT-1 到 GPT-3 的参数规模跃升，带来了 in-context learning 与更广泛的通用能力; 而 GPT-3.5 则进一步通过 instruction tuning、监督微调和基于人类反馈的强化学习提升了整体表现，这也逐渐成为构建高性能 LLM 的标准流程。

**原文**:
In parallel with mainstream LLM development practices, we proposed the General Language Model (GLM) architecture with an autoregressive blank infilling objective and open-sourced GLM-10B in 2021. Later, we trained GLM-130B to match or surpass GPT-3 while validating techniques for 100B-scale training.

**译文**:
与主流 LLM 路线并行，我们提出了 General Language Model(GLM)架构，采用自回归空白填充目标，并在 2021 年开源了 GLM-10B。此后，我们继续训练 GLM-130B，目标是在能力上达到或超过 GPT-3，同时验证百亿级以上模型训练所需的关键技术。

**原文**:
Following this, we initiated instruction tuning on GLM-130B. After ChatGPT, we were further motivated to align the base models with SFT and RLHF, leading to ChatGLM-130B and the smaller open-sourced ChatGLM-6B.

**译文**:
在此之后，我们开始对 GLM-130B 做 instruction tuning。ChatGPT 的出现进一步推动我们使用 SFT 和 RLHF 去对齐基础模型，最终形成了 ChatGLM-130B 以及较小规模、同步开源的 ChatGLM-6B。

**原文**:
Since then, we have been rapidly exploring and refining our pre-training and alignment techniques, leading to the second and third generations of ChatGLM series every other three months, both of which were pre-trained entirely from the beginning.

**译文**:
从那以后，我们持续快速探索并打磨自己的预训练与对齐技术，使 ChatGLM 系列几乎以每三个月一代的速度推进到第二代和第三代，而且这两代模型都不是简单继续训练，而是从头完成了新的预训练。

> 译者注：这一段体现出 ChatGLM 路线与很多“单模型爆发式发布”路线不同。它是一个连续三代、从小模型到大模型、从对话到工具使用能力逐步展开的长期工程，而不是单篇论文里突然出现的一次性结果。

---

## 2 ChatGLM Techniques

**原文**:
In this section, we introduce both the pre- and post-training techniques we adopted and developed in ChatGLM, including the model architecture, pre-training data, alignment, and All Tools.

**译文**:
在本节中，我们介绍 ChatGLM 所采用并逐步发展出来的预训练与后训练技术，包括模型架构、预训练数据、对齐方法，以及 All Tools 系统。

### 2.1 Pre-Training Data

**原文**:
Our pre-training corpus consists of multilingual documents from webpages, Wikipedia, books, code, and research papers. The data pipeline mainly includes deduplication, filtering, and tokenization. High-quality and educational sources such as books and Wikipedia are re-weighted more heavily.

**译文**:
我们的预训练语料由多语言文档组成，来源包括网页、Wikipedia、书籍、代码与研究论文。数据处理流程主要包含去重、过滤和分词三个阶段。最终训练集中，书籍和 Wikipedia 这类高质量、教育性更强的来源会被重新赋予更高权重。

**原文**:
To optimize token efficiency, we use byte-level BPE to separately learn Chinese and multilingual tokens, and merge them with the cl100k_base tokenizer into a unified 150,000-size vocabulary.

**译文**:
为了优化 token 效率，我们采用 byte-level BPE，分别学习中文 token 和多语言 token，然后再与 cl100k_base 分词器的词项合并，构成一个统一的 150,000 规模词表。

**原文**:
Throughout four generations of ChatGLM development, our findings align with existing studies: data quality and diversity are crucial for building effective LLMs, although a fundamental principle for data collection, cleaning, and selection remains elusive.

**译文**:
在 ChatGLM 四代模型的发展过程中，我们的结论与现有研究一致：数据质量与多样性对于构建有效的 LLM 至关重要，尽管到目前为止，我们仍然没有找到一个足以系统指导数据收集、清洗与选择的根本原则。

### 2.2 Architecture

**原文**:
The GLM family is built on Transformer. In GLM-130B, we explored various options to stabilize pre-training under hardware constraints, including DeepNorm, Rotary Positional Encoding, and Gated Linear Units with GeLU activations.

**译文**:
GLM 家族建立在 Transformer 架构之上。在 GLM-130B 中，我们曾在硬件受限条件下探索多种手段来稳定预训练过程，包括 DeepNorm、Rotary Positional Encoding，以及结合 GeLU 激活函数的 Gated Linear Unit。

**原文**:
The recent GLM-4 model adopts several architectural decisions: removing most bias terms except QKV bias, replacing LayerNorm/ReLU with RMSNorm/SwiGLU, extending RoPE into a two-dimensional form, and replacing MHA with Group Query Attention to reduce KV cache size.

**译文**:
最新的 GLM-4 模型采用了若干重要架构决策：除 QKV bias 外基本移除其他 bias 项; 用 RMSNorm 和 SwiGLU 替代 LayerNorm 与 ReLU; 将 RoPE 扩展为二维形式; 并用 Group Query Attention(GQA)取代传统多头注意力，以降低推理中的 KV cache 大小。

**原文**:
The context length of our models has been expanded from 2K to 32K, and then to 128K and 1M through position extension, continual training on long texts, and long-context alignment.

**译文**:
我们的模型上下文长度已经从最初的 2K 扩展到 32K，再进一步扩展到 128K 和 1M。这一过程依赖于位置编码扩展、长文本持续训练以及长上下文对齐等技术组合。

### 2.3 Alignment

**原文**:
Pre-training builds the foundation of LLMs while post-training refines them to align with human preferences. For GLM-4, alignment is mostly achieved through SFT and RLHF.

**译文**:
预训练为 LLM 打下基础，而后训练则进一步把模型往人类偏好方向收敛。对于 GLM-4 来说，这种对齐主要通过 SFT 和 RLHF 来完成。

**原文**:
We find that authentic human prompts and interactions are vital to alignment quality. While SFT largely aligns the base model, RLHF further mitigates issues such as rejection, safety, mixed bilingual generation, and multi-turn coherence.

**译文**:
我们发现，真实的人类提示与真实交互对对齐质量至关重要。SFT 虽然可以在很大程度上把基座模型对齐到人类偏好，但 RLHF 还能进一步缓解拒答、安全性、中英文混杂生成以及多轮连贯性等问题。

### 2.4 ChatGLM Techniques and Benchmarks

**原文**:
Throughout the development of ChatGLM, we have introduced several techniques and benchmarks, such as LongAlign, ChatGLM-Math, ChatGLM-RLHF, Self-Contrast, AgentTuning, APAR, and open evaluation suites including AgentBench, LongBench, AlignBench, HumanEval-X, and others.

**译文**:
在 ChatGLM 的发展过程中，我们提出了多项技术和基准，包括 LongAlign、ChatGLM-Math、ChatGLM-RLHF、Self-Contrast、AgentTuning、APAR，以及 AgentBench、LongBench、AlignBench、HumanEval-X 等开放评测体系。

> 译者注：这一节最重要的信息不是单个技术点本身，而是智谱围绕 ChatGLM 建了一整套“模型 + 对齐 + agent + benchmark”的生态。这意味着 ChatGLM 不是一个孤立模型，而是一条持续产出方法论和评测基础设施的研究主线。

---

## 3 GLM-4 Capabilities

### 3.1 Evaluation of Academic Benchmarks

**原文**:
We evaluate GLM-4 on six widely used academic benchmarks, including MMLU, GSM8K, MATH, BBH, GPQA, and HumanEval. Results show that GLM-4 approaches GPT-4-Turbo and Claude 3 Opus in base capacity.

**译文**:
我们在六个广泛使用的学术基准上评估 GLM-4，包括 MMLU、GSM8K、MATH、BBH、GPQA 和 HumanEval。结果表明，GLM-4 的基础能力已经逼近 GPT-4-Turbo 和 Claude 3 Opus。

### 3.2 Evaluation of Instruction Following

**原文**:
We assess instruction-following with IFEval in both English and Chinese. In loose mode, GLM-4 matches GPT-4 Turbo at the instruction level, and in strict mode reaches almost the same accuracy.

**译文**:
我们在英文和中文环境下使用 IFEval 来评估指令跟随能力。在 loose 模式下，GLM-4 在 instruction-level 准确率上已经追平 GPT-4 Turbo; 在 strict 模式下，其准确率也已经非常接近。

### 3.3 Evaluation of Alignment

**原文**:
Using AlignBench, we show that GLM-4 outperforms GPT-4 Turbo, Claude 3 Opus, and Gemini 1.5 Pro in Chinese alignment overall, especially in Chinese logic reasoning and language understanding.

**译文**:
借助 AlignBench，我们展示了 GLM-4 在中文对齐总体表现上超过 GPT-4 Turbo、Claude 3 Opus 和 Gemini 1.5 Pro，尤其在中文逻辑推理和语言理解方面优势明显。

### 3.4 All Tools and Agent Capability

**原文**:
GLM-4 All Tools is aligned to autonomously understand user intent, plan step by step, and invoke tools such as web browsing, Python interpreter, image generation, and user-defined functions. In first-hand tests, it matches or often surpasses GPT-4 All Tools on common tasks.

**译文**:
GLM-4 All Tools 被专门对齐为能够自主理解用户意图、分步骤制定计划，并调用网页浏览、Python 解释器、图像生成以及用户自定义函数等工具。在一手测试中，它在常见任务上能够与 GPT-4 All Tools 持平，甚至经常超过后者。

### 3.5 Open Model Track: GLM-4-9B

**原文**:
Following the open ChatGLM-6B releases, we also openly release GLM-4-9B (128K and 1M context). Despite less training compute, it outperforms Llama-3-8B and supports All Tools functionality.

**译文**:
在连续开源 ChatGLM-6B 三代之后，我们还进一步开放了 GLM-4-9B(提供 128K 和 1M 上下文版本)。尽管训练算力投入更少，它依然超过了 Llama-3-8B，并且支持 All Tools 的核心功能。

> 译者注：这一部分说明 GLM 路线的一个关键特点：它不是把“闭源大模型”和“开源小模型”割裂开来，而是始终在做 API 大模型与开源可部署模型的双线并进。对中国大模型生态而言，这种双轨策略实际上非常有影响力。

---

## Conclusion

**原文**:
Overall, GLM-4 gets close to state-of-the-art models over standard benchmarks, instruction following, long context, code problem-solving, and agent abilities in English, while also delivering among the best performance in Chinese language tasks.

**译文**:
总体而言，GLM-4 在标准基准、指令跟随、长上下文、代码问题求解以及英文环境下的 agent 能力上，都已经逼近最先进模型; 与此同时，它在中文语言任务上则进一步达到最强梯队水平。

**原文**:
The GLM family’s progression from GLM-130B through three generations of ChatGLM to GLM-4 All Tools demonstrates continuous accumulation in architecture, alignment, long-context modeling, code, vision, and agent capability.

**译文**:
GLM 家族从 GLM-130B 出发，经过三代 ChatGLM，再发展到 GLM-4 All Tools，体现出一种持续累积式的路线：架构、对齐、长上下文建模、代码能力、视觉能力以及 agent 能力都在不断沉淀和迭代。

> 译者注：如果把 ChatGLM 只看成“国产一个开源对话模型”，会低估这条路线的意义。它真正的价值在于：它是少数能够把双语基础模型、对话模型、代码模型、视觉模型、agent 模型串成一条连续技术谱系的中国大模型家族。

---

## References 说明

参考文献与图表细节保留在英文 MinerU 原稿中。若需逐条引用，请直接查阅 `03-ChatGLM-mineru-en.md`。

---

## 全文完

## 关联文件说明

| 文件 | 说明 |
| --- | --- |
| [03-ChatGLM-mineru-en.md](./03-ChatGLM-mineru-en.md) | MinerU 英文原文(D3), 含 5 张语义化插图 |
| [01-ChatGLM 系列技术报告精译.md](./01-ChatGLM系列技术报告精译.md) | 中文精译主稿(D2) |
| [02-ChatGLM 核心架构剖析.md](./02-ChatGLM核心架构剖析.md) | 架构与三代迭代剖析(D2) |
| [05-ChatGLM-Index.md](./05-ChatGLM-Index.md) | 技术入口 Index(D5) |
| [05-ChatGLM-Architecture-Overview.md](./05-ChatGLM-Architecture-Overview.md) | GLM-4 / All Tools 架构专题 |
| [pdfs/chatglm-family.pdf](./pdfs/chatglm-family.pdf) | 官方技术报告 PDF |
| [images/](./images/) | 论文插图 |
