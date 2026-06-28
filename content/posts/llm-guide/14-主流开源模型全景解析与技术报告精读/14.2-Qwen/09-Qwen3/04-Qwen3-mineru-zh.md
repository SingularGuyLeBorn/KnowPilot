---
title: "Qwen3 - 逐段精译与译者注"
source: 03-Qwen3-mineru-en.md
translated_by: "AI Agent"
date: 2026-05-19
---


# Qwen Technical Report

>  **[返回 14.2-Qwen 家族总览](../../14.2-Qwen.md)**


## Abstract

We introduce Qwen3, the latest generation of large language models in the Qwen series. The Qwen3 models come in both dense and mixture-of-experts (MoE) architectures, with sizes ranging from 0.6 billion to 235 billion total parameters. A key feature of the Qwen3 models is the seamless integration of thinking mode and non-thinking mode. This dual-mode design allows the model to engage in deliberate reasoning for complex tasks while delivering swift responses for simpler tasks. Additionally, users can flexibly control the depth of reasoning by specifying a thinking budget, enabling the model to dynamically allocate computational resources for any given task. For the Qwen3 models, we pre-train on an extensive dataset comprising approximately 36 trillion tokens, covering 119 languages and dialects. In addition, we employ a multi-stage training strategy during post-training, resulting in models that not only excel at complex reasoning, coding, and multilingual tasks, but also offer the flexibility to switch between thinking and non-thinking modes. We release all the Qwen3 base and instruct models under the Apache 2.0 license, and the flagship model Qwen3-235B-A22B and the strongest dense model Qwen3-32B have demonstrated state-of-the-art performance among open-source models.

我们推出 Qwen3，Qwen 系列大语言模型的最新一代。Qwen3 模型同时提供 Dense(密集)和 MoE(混合专家)两种架构，参数规模从 0.6B 到 235B 不等。Qwen3 的核心特性是「思考模式(Thinking Mode)」与「非思考模式(Non-thinking Mode)」的无缝融合。这种双模式设计使模型在处理复杂任务时能够进行深度推理，而在面对简单任务时则快速响应。此外，用户可以通过指定思考预算(Thinking Budget)灵活控制推理深度，让模型根据任务动态分配计算资源。Qwen3 在约 36 万亿 token 的海量语料上进行了预训练，覆盖 119 种语言和方言。后训练阶段采用多阶段策略，使模型不仅在复杂推理、代码生成和多语言任务上表现卓越，还能在思考与非思考模式之间灵活切换。所有 Qwen3 Base 和 Instruct 模型均以 Apache 2.0 协议开源，旗舰模型 Qwen3-235B-A22B 和最强 Dense 模型 Qwen3-32B 在开源模型中达到了最先进的性能水平。

> **译者注**：Qwen3 最核心的架构创新是「双模式统一框架」——将传统推理模型(如 DeepSeek-R1、QwQ)的显式 CoT 思考与通用对话模型的快速响应能力集成到同一个模型中。这与 OpenAI o1/o3 系列的思路一致，但 Qwen3 通过 Chat Template 中的 `/think` 和 `/no_think` 标志实现了更细粒度的用户控制，并引入了「思考预算」机制来动态截断推理过程。从工程角度看，这意味着部署一套模型即可同时服务「需要深度推理」和「需要快速响应」两类场景，显著降低运维复杂度。

## 1 Introduction

The past year has witnessed remarkable progress in the development of large language models (LLMs). Models such as Claude 3.7 Sonnet (Anthropic, 2025), GPT-4o (OpenAI, 2024), o1 (OpenAI, 2024), and o3 (OpenAI, 2025) have demonstrated strong reasoning, coding, and multilingual abilities. Open-source models, including DeepSeek-R1 (Guo et al., 2025), QwQ-32B (Qwen Team, 2025), and LLaMA-4 (Meta-AI, 2025), have further enhanced their reasoning capabilities through extensive reinforcement learning. These advancements have brought us closer to achieving Artificial General Intelligence (AGI) and Artificial Super Intelligence (ASI), spurring an increasing number of research efforts to explore new training paradigms.

过去一年，大语言模型(LLM)的发展取得了显著进步。Claude 3.7 Sonnet、GPT-4o、o1 和 o3 等闭源模型在推理、代码和多语言方面展现了强大能力。开源模型如 DeepSeek-R1、QwQ-32B 和 LLaMA-4 则通过大规模强化学习进一步增强了推理能力。这些进展让我们离通用人工智能(AGI)和超级人工智能(ASI)更近一步，也推动了越来越多研究工作探索新的训练范式。

In this report, we introduce the Qwen3 series, the latest iteration of our large language models. Qwen3 encompasses both dense and mixture-of-experts (MoE) models, with parameter sizes ranging from 0.6 billion to 235 billion total parameters and from 0.6 billion to 22 billion activated parameters. Qwen3 features both thinking mode and non-thinking mode, which can be toggled on and off depending on the task requirements. The model is pre-trained on an extensive corpus of approximately 36 trillion tokens, covering 119 languages and dialects, to enhance its multilingual capabilities. Additionally, Qwen3 incorporates a multi-stage post-training strategy. By curating high-quality reasoning data and applying reinforcement learning, we have significantly improved the model’s reasoning capabilities, especially in mathematics, coding, and logical reasoning. Furthermore, through a carefully designed chat template, we have integrated the non-thinking capabilities into the model, enabling users to dynamically manage the model’s thinking process. This allows the model to adapt to various task scenarios while reducing deployment costs.

本报告介绍 Qwen3 系列——我们大语言模型的最新迭代。Qwen3 同时包含 Dense 和 MoE 架构，总参数量从 0.6B 到 235B，激活参数量从 0.6B 到 22B。Qwen3 支持思考模式和非思考模式，可根据任务需求动态切换。模型在约 36 万亿 token 的语料上预训练，覆盖 119 种语言和方言，以增强多语言能力。后训练采用多阶段策略：通过精选高质量推理数据并应用强化学习，显著提升了模型在数学、代码和逻辑推理方面的能力; 同时通过精心设计的 Chat Template，将非思考能力融入模型，使用户能够动态管理模型的思考过程，从而适应各种任务场景并降低部署成本。

The key improvements of Qwen3 include:

Qwen3 的关键改进包括：

**Thinking and Non-Thinking Modes:** The Qwen3 models are designed to support both thinking and non-thinking modes. The thinking mode is suitable for complex tasks such as coding, mathematics, and logical reasoning. In this mode, the model engages in step-by-step reasoning, similar to how humans think, to generate the final answer. The non-thinking mode is designed for faster response times, making it suitable for tasks that require speed rather than depth. The key advantage of our design is that the thinking mode and the non-thinking mode are seamlessly integrated into a single model. This integration is achieved through a sophisticated chat template and a multi-stage post-training process. As a result, the model can dynamically switch between the two modes based on the specific task requirements, without requiring the deployment of separate models.

**思考模式与非思考模式**：Qwen3 模型同时支持思考和非思考两种模式。思考模式适用于代码、数学和逻辑推理等复杂任务，模型会像人类一样逐步思考后给出最终答案。非思考模式则追求更快的响应速度，适合对速度要求高于深度的任务。我们设计的核心优势在于将两种模式无缝集成到同一个模型中，通过精巧的 Chat Template 和多阶段后训练实现。因此，模型能根据具体任务需求在两种模式间动态切换，无需部署两套独立模型。

**Thinking Budget:** To make the model’s thinking process more flexible, we have introduced the concept of a thinking budget. This allows users to control the number of tokens the model allocates for thinking. By setting a thinking budget, users can balance the depth of reasoning against the response speed, enabling the model to dynamically allocate computational resources based on the specific task requirements. This is particularly useful for applications where the complexity of tasks varies, and different levels of reasoning depth are needed.

**思考预算(Thinking Budget)**：为了让模型的思考过程更加灵活，我们引入了思考预算的概念。用户可以通过设置思考预算来控制模型用于思考的 token 数量，从而在推理深度和响应速度之间取得平衡，使模型能够根据具体任务需求动态分配计算资源。这在任务复杂度各异、需要不同推理深度的应用场景中尤为有用。

**Pre-training:** The Qwen3 models are pre-trained on approximately 36 trillion tokens, which is about twice the amount of data used for the Qwen2.5 series. The training data covers 119 languages and dialects, significantly enhancing the model’s multilingual capabilities. To improve the model’s performance on reasoning and STEM-related tasks, we have increased the proportion of educational data, particularly in coding and mathematics. Additionally, we have curated a substantial amount of synthetic data generated by Qwen2.5-VL, Qwen2.5, and the Qwen2.5-Math and Qwen2.5-Coder series. The pre-training process is divided into three stages: (1) General Pre-training, (2) Reasoning-enhanced Pre-training, and (3) Long-context Pre-training. The first stage focuses on general knowledge and basic skills, the second stage enhances reasoning capabilities by increasing the proportion of STEM and coding data, and the third stage extends the context length to support long-context tasks.

**预训练**：Qwen3 模型在约 36 万亿 token 上预训练，数据量约为 Qwen2.5 系列的两倍。训练数据覆盖 119 种语言和方言，大幅提升了多语言能力。为改善模型在推理和 STEM 相关任务上的表现，我们增加了教育数据的比例，尤其是代码和数学数据。此外，还利用 Qwen2.5-VL、Qwen2.5 以及 Qwen2.5-Math 和 Qwen2.5-Coder 系列生成了大量合成数据。预训练分为三个阶段：(1)通用预训练，(2)推理增强预训练，(3)长上下文预训练。第一阶段聚焦通用知识和基础技能; 第二阶段通过增加 STEM 和代码数据比例来增强推理能力; 第三阶段扩展上下文长度以支持长上下文任务。

**Post-training:** The post-training process of Qwen3 is divided into four stages. The first stage focuses on developing the model’s long Chain-of-Thought (long-CoT) capabilities through cold-start training. The second stage employs reinforcement learning to further enhance the model’s reasoning abilities. The third stage integrates the non-thinking capabilities into the model through supervised fine-tuning (SFT). Finally, the fourth stage uses general reinforcement learning to improve the model’s performance across a wide range of tasks. This multi-stage approach ensures that the model not only excels at complex reasoning tasks but also performs well in general applications.

**后训练**：Qwen3 的后训练分为四个阶段。第一阶段通过冷启动训练培养模型的长链式思考(Long-CoT)能力; 第二阶段采用强化学习进一步提升推理能力; 第三阶段通过监督微调(SFT)将非思考能力融入模型; 第四阶段使用通用强化学习提升模型在广泛任务上的表现。这种多阶段方法确保模型不仅在复杂推理任务上表现出色，在通用应用场景中也有优异表现。

**Strong-to-Weak Distillation:** To optimize the performance of lightweight models, we have implemented a strong-to-weak distillation approach. This involves transferring knowledge from larger, more powerful models to smaller models, significantly reducing the computational costs and development efforts required for building lightweight models. By leveraging the outputs of teacher models, we can enhance the performance of student models while maintaining fine-grained control over their reasoning processes. This approach is particularly effective for edge-side deployment, where computational resources are limited.

**强到弱蒸馏(Strong-to-Weak Distillation)**：为优化轻量级模型的性能，我们实施了强到弱蒸馏方法。这涉及将更大、更强模型的知识迁移到小模型上，显著降低构建轻量级模型所需的计算成本和开发工作量。通过利用教师模型的输出，我们可以在保持对推理过程细粒度控制的同时提升学生模型的性能。这种方法在计算资源受限的边缘部署场景中尤为有效。

> **译者注**：Qwen3 的预训练数据量(36T)是 Qwen2.5(约 18T)的两倍，且明确增加了 STEM/代码/合成数据比例，这直接解释了 Base 模型在数学和代码基准上的大幅提升。三阶段预训练策略(通用→推理增强→长上下文)也是业界的标准做法，DeepSeek-V3 和 LLaMA-4 都采用了类似分阶段策略。值得注意的是 Qwen3 使用了自家族模型(Qwen2.5-VL 做 PDF OCR、Qwen2.5-Math/Coder 做合成数据)构建数据闭环，这种「自举(bootstrapping)」策略在数据飞轮建设中越来越常见。

## 2 Architecture

The Qwen3 series consists of eight models, including six dense models and two mixture-of-experts (MoE) models. The detailed configurations of the dense and MoE models are listed in Table 1 and Table 2, respectively.

Qwen3 系列共包含八个模型：六个 Dense 模型和两个 MoE 模型。Dense 和 MoE 模型的详细配置分别列于表 1 和表 2。

Table 1: Configurations of Qwen3 Dense Models.

表 1：Qwen3 Dense 模型配置

<table><tr><td>Model</td><td>Layers</td><td>Heads (Q / KV)</td><td>Hidden Size</td><td>Intermediate Size</td><td>Context Length</td></tr><tr><td>Qwen3-0.6B</td><td>28</td><td>16 / 8</td><td>1,024</td><td>2,048</td><td>32K</td></tr><tr><td>Qwen3-1.7B</td><td>28</td><td>16 / 8</td><td>2,048</td><td>5,504</td><td>32K</td></tr><tr><td>Qwen3-4B</td><td>36</td><td>24 / 6</td><td>2,560</td><td>7,168</td><td>128K</td></tr><tr><td>Qwen3-8B</td><td>36</td><td>28 / 4</td><td>4,096</td><td>11,264</td><td>128K</td></tr><tr><td>Qwen3-14B</td><td>40</td><td>40 / 8</td><td>5,120</td><td>12,288</td><td>128K</td></tr><tr><td>Qwen3-32B</td><td>64</td><td>64 / 8</td><td>6,400</td><td>21,504</td><td>128K</td></tr></table>

Table 2: Configurations of Qwen3 MoE Models.

表 2：Qwen3 MoE 模型配置

<table><tr><td>Model</td><td>Layers</td><td>Heads (Q / KV)</td><td>Hidden Size</td><td>Intermediate Size ( Shared / Routed )</td><td># Experts / # Activated</td><td>Context Length</td></tr><tr><td>Qwen3-30B-A3B</td><td>48</td><td>32 / 4</td><td>2,048</td><td>2,048 / 2,048</td><td>128 / 8</td><td>128K</td></tr><tr><td>Qwen3-235B-A22B</td><td>72</td><td>64 / 8</td><td>6,400</td><td>8,192 / 8,192</td><td>128 / 8</td><td>128K</td></tr></table>

For the Qwen3 dense models, we employ a decoder-only Transformer architecture (Vaswani et al., 2017) with several key enhancements:

对于 Qwen3 Dense 模型，我们采用仅解码器的 Transformer 架构，并进行了多项关键改进：

**Grouped Query Attention (GQA):** We adopt GQA (Ainslie et al., 2023) to accelerate inference and reduce memory usage. The number of query heads and KV heads for each model is listed in Table 1.

**分组查询注意力(GQA)**：采用 GQA 以加速推理并降低显存占用。各模型的 Query 头数和 KV 头数见表 1。

**SwiGLU Activation:** We use SwiGLU (Dauphin et al., 2017; Shazeer, 2020) as the activation function. The hidden dimension of the feed-forward network (FFN) is set to intermediate_size = 2/3 × hidden_size × 4.

**SwiGLU 激活函数**：使用 SwiGLU 作为激活函数。前馈网络(FFN)的隐藏维度设为 intermediate_size = 2/3 × hidden_size × 4。

**RoPE:** We apply Rotary Positional Embedding (RoPE) (Su et al., 2024) to encode positional information, with a base value of 1,000,000.

**RoPE**：采用旋转位置编码(RoPE)编码位置信息，基值设为 1,000,000。

**RMSNorm:** We use RMSNorm (Zhang & Sennrich, 2019) for pre-normalization and post-normalization.

**RMSNorm**：使用 RMSNorm 进行预归一化和后归一化。

**QK-Norm:** To stabilize the training process, we remove the bias from the Q, K, and V projections and apply QK-Norm (Henry et al., 2020).

**QK-Norm**：为稳定训练，移除 Q、K、V 投影的偏置并应用 QK-Norm。

**Tokenizer:** We utilize a byte pair encoding (BPE) tokenizer (Sennrich et al., 2016) based on the tiktoken library. The tokenizer incorporates 151,669 tokens, including 11 natural language tokens (such as Chinese, English, and code tokens) and a control token.

**Tokenizer**：使用基于 tiktoken 库的字节对编码(BPE)Tokenizer，包含 151,669 个 token，其中 11 个为自然语言 token(如中文、英文和代码 token)和 1 个控制 token。

For the Qwen3 MoE models, we adopt the same basic architecture as the dense models, with the following additional configurations:

对于 Qwen3 MoE 模型，采用与 Dense 模型相同的基础架构，并增加以下配置：

**Expert Granularity:** The Qwen3 MoE models utilize fine-grained experts, with a total of 128 experts and 8 activated experts per token. This design allows for more precise routing and specialization.

**专家粒度**：Qwen3 MoE 模型采用细粒度专家设计，共 128 个专家，每个 token 激活 8 个专家。这种设计允许更精确的路由和专业化。

**No Shared Experts:** Unlike previous Qwen MoE models (Dai et al., 2024; Yang et al., 2024a), we do not use shared experts in the Qwen3 MoE models. This simplifies the architecture and reduces the number of parameters.

**无共享专家**：与之前的 Qwen MoE 模型不同，Qwen3 MoE 模型不使用共享专家。这简化了架构并减少了参数量。

**Load Balancing:** We employ a global batch-level load balancing strategy to ensure efficient training and inference. This strategy helps to distribute the computational load evenly across the experts.

**负载均衡**：采用全局批次级负载均衡策略，确保训练和推理的高效性。该策略有助于将计算负载均匀分配到各专家。

> **译者注**：Qwen3 架构上的一个重要变化是 MoE 模型取消了共享专家(Shared Experts)。DeepSeek-V3 和 Qwen2.5-MoE 都使用了共享专家来确保基础语言能力，但 Qwen3 发现 128 个细粒度专家中无需共享专家也能达到良好性能，这简化了实现并降低了显存占用。另一个关键点是所有模型(包括 0.6B 小模型)都应用了 QK-Norm，这在稳定训练方面尤为重要——QK-Norm 通过约束注意力分数的尺度来防止梯度爆炸，是近年来大模型训练的标配技巧。RoPE 基值 1M 支持最长 128K 上下文，与 Qwen2.5 一致。

## 3 Pre-training

### 3.1 Data

The Qwen3 models are pre-trained on an extensive dataset comprising approximately 36 trillion tokens, which is nearly twice the size of the dataset used for the Qwen2.5 series. The dataset covers 119 languages and dialects, significantly enhancing the model’s multilingual capabilities.

Qwen3 模型在约 36 万亿 token 的语料上预训练，数据量几乎是 Qwen2.5 系列的两倍。数据集覆盖 119 种语言和方言，大幅提升了多语言能力。

To construct the pre-training dataset, we employ a multi-dimensional data annotation system to collect and annotate data. This system includes the following components:

为构建预训练数据集，我们采用多维度数据标注系统收集和标注数据，包括以下组件：

**Web Data:** We collect web data from various sources and use the Qwen2.5-VL model to perform Optical Character Recognition (OCR) on PDF documents, extracting text content. This significantly enriches the diversity of the training data.

**网页数据**：从多种来源收集网页数据，并使用 Qwen2.5-VL 模型对 PDF 文档进行光学字符识别(OCR)以提取文本内容，显著丰富了训练数据的多样性。

**Synthetic Data:** We generate synthetic data using the Qwen2.5, Qwen2.5-Math, and Qwen2.5-Coder models. This synthetic data is particularly beneficial for improving the model’s performance on reasoning and coding tasks.

**合成数据**：使用 Qwen2.5、Qwen2.5-Math 和 Qwen2.5-Coder 模型生成合成数据。这类数据对提升模型在推理和代码任务上的表现尤为有益。

**Data Mixing:** We employ an instance-level data mixing strategy to optimize the composition of the training data. This strategy ensures that the model is exposed to a balanced and diverse set of data during training.

**数据混合**：采用实例级数据混合策略优化训练数据的组成，确保模型在训练过程中接触到均衡且多样的数据。

The pre-training dataset includes over 30 trillion tokens of web data, along with a substantial amount of synthetic data. The detailed composition and statistics of the pre-training data are not publicly disclosed.

预训练数据集包含超过 30 万亿 token 的网页数据以及大量合成数据。预训练数据的详细组成和统计数据未公开披露。

### 3.2 Stage

The pre-training process is divided into three stages:

预训练过程分为三个阶段：

**Stage 1: General Pre-training.** In this stage, the model is trained on approximately 30 trillion tokens of general data, including web pages, books, and code. The context length is set to 4,096 tokens. This stage focuses on building the model’s general knowledge and basic language understanding.

**阶段 1：通用预训练**。在此阶段，模型在约 30 万亿 token 的通用数据上训练，包括网页、书籍和代码。上下文长度设为 4,096 token。此阶段侧重于构建模型的通用知识和基础语言理解能力。

**Stage 2: Reasoning-enhanced Pre-training.** In this stage, the model is trained on approximately 5 trillion tokens of high-quality data, with an increased proportion of STEM (Science, Technology, Engineering, and Mathematics) and coding data. The context length remains at 4,096 tokens. This stage aims to enhance the model’s reasoning capabilities.

**阶段 2：推理增强预训练**。在此阶段，模型在约 5 万亿 token 的高质量数据上训练，STEM(科学、技术、工程和数学)和代码数据的比例有所提升。上下文长度保持 4,096 token。此阶段旨在增强模型的推理能力。

**Stage 3: Long-context Pre-training.** In this stage, the model is trained on hundreds of billions of tokens with a context length of 32,768 tokens. We employ techniques such as Attention Baseline Factor (ABF), YaRN (Peng et al., 2023), and Dual Chunk Attention (DCA) (An et al., 2024) to extend the context length. This stage enables the model to handle long-context tasks.

**阶段 3：长上下文预训练**。在此阶段，模型在数百亿 token 上训练，上下文长度扩展至 32,768 token。我们采用注意力基线因子(ABF)、YaRN 和双块注意力(DCA)等技术来扩展上下文长度。此阶段使模型能够处理长上下文任务。

> **译者注**：三阶段预训练策略是大模型训练的成熟范式。Stage 1 的 30T general data 与 Stage 2 的 5T reasoning data 比例约为 6:1，说明 Qwen3 认为通用语言能力仍是基础，但推理能力需要专门的数据增强。Stage 3 的「数百亿 token」相对于前两阶段来说量很小，说明长上下文能力主要通过位置编码外推技术(ABF+YaRN+DCA)而非大量长文本数据来获得。值得注意的是 YaRN 和 DCA 都是无需修改模型权重的上下文扩展方法，这说明 Qwen3 的长上下文支持是「训练时扩展(Test Time Scaling, TTS)」而非「纯推理时扩展」。

### 3.3 Evaluation

To evaluate the performance of the Qwen3 base models, we conduct comprehensive experiments on a wide range of benchmarks. These benchmarks are categorized into four groups: general tasks, math and STEM tasks, coding tasks, and multilingual tasks.

为评估 Qwen3 Base 模型的性能，我们在广泛的基准测试上进行了全面实验。这些基准分为四类：通用任务、数学与 STEM 任务、代码任务和多语言任务。

We evaluate the Qwen3 base models of various sizes, including Qwen3-235B-A22B, Qwen3-32B, Qwen3-14B, Qwen3-30B-A3B, Qwen3-8B, Qwen3-4B, Qwen3-1.7B, and Qwen3-0.6B. The evaluation results are compared against strong open-source baselines, including Qwen2.5, DeepSeek-V3, LLaMA-4, and Gemma-3.

我们评估了多种尺寸的 Qwen3 Base 模型，包括 Qwen3-235B-A22B、Qwen3-32B、Qwen3-14B、Qwen3-30B-A3B、Qwen3-8B、Qwen3-4B、Qwen3-1.7B 和 Qwen3-0.6B。评估结果与 Qwen2.5、DeepSeek-V3、LLaMA-4 和 Gemma-3 等强开源基线进行了对比。

The detailed results are as follows.

详细结果如下。

**Qwen3-235B-A22B-Base** We compare Qwen3-235B-A22B-Base to our previous similar-sized MoE Qwen2.5-Plus-Base (Yang et al., 2024b) and other leading open-source base models: Llama-4-Maverick (Meta-AI, 2025), Qwen2.5-72B-Base (Yang et al., 2024b), DeepSeek-V3 Base (Liu et al., 2024a). From the results in Table 3, the Qwen3-235B-A22B-Base model attains the highest performance scores across most of the evaluated benchmarks. We further compare Qwen3-235B-A22B-Base with other baselines separately for the detailed analysis.

**Qwen3-235B-A22B-Base**：我们将 Qwen3-235B-A22B-Base 与之前同规模的 MoE 模型 Qwen2.5-Plus-Base 以及其他领先开源 Base 模型(Llama-4-Maverick、Qwen2.5-72B-Base、DeepSeek-V3 Base)进行对比。表 3 的结果显示，Qwen3-235B-A22B-Base 在大多数评估基准上取得了最高分数。

(1) Compared with the recently open-source model Llama-4-Maverick-Base, which has about twice the number of parameters, Qwen3-235B-A22B-Base still performs better on most benchmarks.

(1) 与最近开源的 Llama-4-Maverick-Base(参数量约为两倍)相比，Qwen3-235B-A22B-Base 在大多数基准上仍然表现更优。

(2) Compared with the previously state-of-the-art open-source model DeepSeek-V3-Base, Qwen3-235B-A22B-Base outperforms DeepSeek-V3-Base on 14 out of 15 evaluation benchmarks with only about 1/3 the total number of parameters and 2/3 activated parameters, demonstrating the powerful and cost-effectiveness of our models.

(2) 与此前最先进的开源模型 DeepSeek-V3-Base 相比，Qwen3-235B-A22B-Base 在 15 个评估基准中的 14 个上表现更优，而总参数量仅约为 1/3，激活参数量约为 2/3，展现了我们模型的强大性能和成本效益。

(3) Compared with our previous MoE Qwen2.5-Plus of similar size, Qwen3-235B-A22B-Base significantly outperforms it with fewer parameters and activated parameters, which shows the remarkable advantages of Qwen3 in pre-training data, training strategy, and model architecture.

(3) 与之前同规模的 MoE 模型 Qwen2.5-Plus 相比，Qwen3-235B-A22B-Base 以更少的参数量和激活参数量显著超越之，体现了 Qwen3 在预训练数据、训练策略和模型架构上的显著优势。

(4) Compared with our previous flagship open-source dense model Qwen2.5-72B-Base, Qwen3-235B-A22B-Base surpasses the latter in all benchmarks and uses fewer than 1/3 of the activated parameters. Meanwhile, due to the advantage of the model architecture, the inference costs and training costs on each trillion tokens of Qwen3-235B-A22B-Base are much cheaper than those of Qwen2.5-72B-Base.

(4) 与之前的旗舰开源 Dense 模型 Qwen2.5-72B-Base 相比，Qwen3-235B-A22B-Base 在所有基准上均超越后者，且激活参数量不到 1/3。同时，得益于架构优势，Qwen3-235B-A22B-Base 的推理成本和每万亿 token 的训练成本远低于 Qwen2.5-72B-Base。

**Qwen3-32B-Base** Qwen3-32B-Base is our largest dense model among the Qwen3 series. We compare it to the baselines of similar sizes, including Gemma-3-27B (Team et al., 2025) and Qwen2.5-32B (Yang et al., 2024b). In addition, we introduce two strong baselines: the recently open-source MoE model Llama-4-Scout, which has three times the parameters of Qwen3-32B-Base but half the activated parameters; and our previous flagship open-source dense model Qwen2.5-72B-Base, which has more than twice the number of parameters compared to Qwen3-32B-Base. The results are shown in Table 4, which support three key conclusions:

**Qwen3-32B-Base**：Qwen3-32B-Base 是 Qwen3 系列中最大的 Dense 模型。我们将其与同规模基线(Gemma-3-27B 和 Qwen2.5-32B)对比。此外，还引入了两个强基线：最近开源的 MoE 模型 Llama-4-Scout(参数量是 Qwen3-32B-Base 的三倍，但激活参数量仅为其一半)，以及之前的旗舰开源 Dense 模型 Qwen2.5-72B-Base(参数量是 Qwen3-32B-Base 的两倍以上)。结果见表 4，得出三个关键结论：

(1) Compared with the similar-sized models, Qwen3-32B-Base outperforms Qwen2.5-32B-Base and Gemma-3-27B Base on most benchmarks. Notably, Qwen3-32B-Base achieves 65.54 on MMLU-Pro and 39.78 on SuperGPQA, significantly outperforming its predecessor Qwen2.5-32B-Base. In addition, Qwen3-32B-Base achieves significantly higher encoding benchmark scores than all baseline models.

(1) 与同规模模型相比，Qwen3-32B-Base 在大多数基准上优于 Qwen2.5-32B-Base 和 Gemma-3-27B Base。值得注意的是，Qwen3-32B-Base 在 MMLU-Pro 上达到 65.54、SuperGPQA 上达到 39.78，显著超越前代 Qwen2.5-32B-Base。此外，Qwen3-32B-Base 在编码基准上的得分显著高于所有基线模型。

(2) Surprisingly, we find that Qwen3-32B-Base achieves competitive results compared to Qwen2.5-72B-Base. Although Qwen3-32B-Base has less than half the number of parameters of Qwen2.5-72B-Base, it outperforms Qwen2.5-72B-Base in 10 of the 15 evaluation benchmarks. On coding, mathematics, and reasoning benchmarks, Qwen3-32B-Base has remarkable advantages.

(2) 令人惊讶的是，Qwen3-32B-Base 与 Qwen2.5-72B-Base 相比也取得了有竞争力的结果。尽管 Qwen3-32B-Base 的参数量不到 Qwen2.5-72B-Base 的一半，但在 15 个评估基准中的 10 个上表现更优。在代码、数学和推理基准上，Qwen3-32B-Base 具有显著优势。

(3) Compared to Llama-4-Scout-Base, Qwen3-32B-Base significantly outperforms it on all 15 benchmarks, with only one-third of the number of parameters of Llama-4-Scout-Base, but twice the number of activated parameters.

(3) 与 Llama-4-Scout-Base 相比，Qwen3-32B-Base 在所有 15 个基准上均显著超越之，而参数量仅为其三分之一，激活参数量为其两倍。

**Qwen3-14B-Base & Qwen3-30B-A3B-Base** The evaluation of the Qwen3-14B-Base and Qwen3-30B-A3B-Base is compared against baselines of similar sizes, including Gemma-3-12B Base, Qwen2.5-14B Base. Similarly, we also introduce two strong baselines: (1) Qwen2.5-Turbo (Yang et al., 2024b), which has 42B parameters and 6B activated parameters. Note that its activated parameters are twice those of Qwen3-30B-A3B-Base. (2) Qwen2.5-32B-Base, which has 11 times the activated parameters of Qwen3-30B-A3B and more than twice that of Qwen3-14B. The results are shown in Table 5, where we can draw the following conclusions.

**Qwen3-14B-Base 与 Qwen3-30B-A3B-Base**：将 Qwen3-14B-Base 和 Qwen3-30B-A3B-Base 与同规模基线(Gemma-3-12B Base、Qwen2.5-14B Base)进行对比。还引入了两个强基线：(1) Qwen2.5-Turbo(42B 参数，6B 激活参数，激活参数量是 Qwen3-30B-A3B-Base 的两倍); (2) Qwen2.5-32B-Base(激活参数量是 Qwen3-30B-A3B 的 11 倍，是 Qwen3-14B 的两倍以上)。结果见表 5，得出以下结论：

(1) Compared with the similar-sized models, Qwen3-14B-Base significantly performs better than Qwen2.5-14B-Base and Gemma-3-12B-Base on all 15 benchmarks.

(1) 与同规模模型相比，Qwen3-14B-Base 在所有 15 个基准上均显著优于 Qwen2.5-14B-Base 和 Gemma-3-12B-Base。

(2) Similarly, Qwen3-14B-Base also achieves very competitive results compared to Qwen2.5-32B-Base with less than half of the parameters.

(2) 同样，Qwen3-14B-Base 以不到一半的参数量与 Qwen2.5-32B-Base 相比也取得了非常有竞争力的结果。

(3) With only 1/5 activated non-embedding parameters, Qwen3-30B-A3B significantly outperforms Qwen2.5-14B-Base on all tasks, and achieves comparable performance to Qwen3-14B-Base and Qwen2.5-32B-Base, which brings us significant advantages in inference and training costs.

(3) Qwen3-30B-A3B 仅使用 1/5 的激活非嵌入参数量，就在所有任务上显著超越 Qwen2.5-14B-Base，并与 Qwen3-14B-Base 和 Qwen2.5-32B-Base 达到相当性能，在推理和训练成本上带来显著优势。

**Qwen3-8B / 4B / 1.7B / 0.6B-Base** For edge-side models, we take similar-sized Qwen2.5, Llama-3, and Gemma-3 base models as the baselines. The results can be seen in Table 6, Table 7, and Table 8. All Qwen3 8B / 4B / 1.7B / 0.6B-Base models continue to maintain strong performance across nearly all benchmarks. Notably, Qwen3-8B / 4B / 1.7B-Base models even outperform larger size Qwen2.5-14B / 7B / 3B Base models on over half of the benchmarks, especially on STEM-related and coding benchmarks, reflecting the significant improvement of the Qwen3 models.

**Qwen3-8B / 4B / 1.7B / 0.6B-Base**：对于边缘端模型，我们采用同规模的 Qwen2.5、Llama-3 和 Gemma-3 Base 模型作为基线。结果见表 6、表 7 和表 8。所有 Qwen3 的 8B / 4B / 1.7B / 0.6B Base 模型在几乎所有基准上均保持强劲性能。值得注意的是，Qwen3-8B / 4B / 1.7B-Base 模型在一半以上的基准上甚至超越更大尺寸的 Qwen2.5-14B / 7B / 3B Base 模型，尤其在 STEM 相关和代码基准上，体现了 Qwen3 模型的显著提升。

> **译者注**：从 Base 模型评估可以看出，Qwen3 在各尺寸上都实现了对前代和竞品的代际超越。特别值得关注的是 Qwen3-32B-Base 以不到 Qwen2.5-72B-Base 一半的参数量，在 15 项基准中 10 项获胜——这验证了「数据质量+训练策略」对性能提升的重要性并不亚于单纯堆参数量。Qwen3-30B-A3B 作为轻量级 MoE(仅 3B 激活参数)，能在多数任务上媲美 14B-32B Dense 模型，印证了 MoE 架构在成本效益上的优势。但需要注意，这些 Base 模型评估仅反映预训练质量，后训练(SFT+RL)对 Instruct 模型的最终体验影响更大。

## 4 Post-training

![](images/fig01_post_training_pipeline.jpg)  
Figure 1: Post-training pipeline of the Qwen3 series models.

图 1：Qwen3 系列模型的后训练流程

The post-training pipeline of Qwen3 is strategically designed with two core objectives:

Qwen3 的后训练流程围绕两个核心目标进行战略设计：

(1) **Thinking Control:** This involves the integration of two distinct modes, namely the "non-thinking" and "thinking" modes, providing users with the flexibility to choose whether the model should engage in reasoning or not, and to control the depth of thinking by specifying a token budget for the thinking process.

(1) **思考控制**：整合「非思考」和「思考」两种不同模式，为用户提供灵活性——既可以选择是否让模型进行推理，也可以通过指定思考过程的 token 预算来控制推理深度。

(2) **Strong-to-Weak Distillation:** This aims to streamline and optimize the post-training process for lightweight models. By leveraging the knowledge from large-scale models, we substantially reduce both the computational costs and the development efforts required for building smaller-scale models.

(2) **强到弱蒸馏**：旨在简化并优化轻量级模型的后训练流程。通过利用大模型的知识，大幅降低构建小模型所需的计算成本和开发工作量。

As illustrated in Figure 1, the flagship models in the Qwen3 series follow a sophisticated four-stage training process. The first two stages focus on developing the models' "thinking" abilities. The next two stages aim to integrate strong "non-thinking" functionalities into the models.

如图 1 所示，Qwen3 系列的旗舰模型遵循精密的四阶段训练流程。前两个阶段专注于培养模型的「思考」能力; 后两个阶段致力于将强大的「非思考」功能融入模型。

Preliminary experiments suggest that directly distilling the output logits from teacher models into lightweight student models can effectively enhance their performance while maintaining fine-grained control over their reasoning processes. This approach eliminates the necessity of performing an exhaustive four-stage training process individually for every small-scale model. It leads to better immediate performance, as indicated by higher Pass@1 scores, and also improves the model's ability of exploration, as reflected in improved Pass@64 results. In addition, it achieves these gains with much greater training efficiency, requiring only 1/10 of the GPU hours compared to the four-stage training method.

初步实验表明，直接将教师模型的输出 logits 蒸馏到轻量级学生模型中，可以有效提升性能，同时保持对推理过程的细粒度控制。这种方法消除了为每个小规模模型单独执行完整四阶段训练流程的必要性。它不仅带来了更好的即时性能(表现为更高的 Pass@1 分数)，还提升了模型的探索能力(表现为 Pass@64 结果的改善)。此外，它以更高的训练效率实现了这些增益，所需 GPU 时长仅为四阶段训练方法的 1/10。

In the following sections, we present the four-stage training process and provide a detailed explanation of the Strong-to-Weak Distillation approach.

以下各节将介绍四阶段训练流程，并详细解释强到弱蒸馏方法。

### 4.1 Long-CoT Cold Start

We begin by curating a comprehensive dataset that spans a wide range of categories, including math, code, logical reasoning, and general STEM problems. Each problem in the dataset is paired with verified reference answers or code-based test cases. This dataset serves as the foundation for the "cold start" phase of long Chain-of-Thought (long-CoT) training.

我们首先构建一个涵盖数学、代码、逻辑推理和通用 STEM 问题的综合数据集。数据集中的每个问题都配有经过验证的参考答案或基于代码的测试用例。该数据集作为长链式思考(Long-CoT)训练「冷启动」阶段的基础。

The dataset construction involves a rigorous two-phase filtering process: query filtering and response filtering. In the query filtering phase, we use Qwen2.5-72B-Instruct to identify and remove queries that are not easily verifiable. This includes queries containing multiple sub-questions or those asking for general text generation. Furthermore, we exclude queries that Qwen2.5-72B-Instruct can answer correctly without using CoT reasoning. This helps prevent the model from relying on superficial guessing and ensures that only complex problems requiring deeper reasoning are included. Additionally, we annotate each query's domain using Qwen2.5-72B-Instruct to maintain balanced domain representation across the dataset.

数据集构建涉及严格的两阶段过滤流程：查询过滤和响应过滤。在查询过滤阶段，我们使用 Qwen2.5-72B-Instruct 识别并移除不易验证的查询，包括包含多个子问题或要求通用文本生成的查询。此外，我们排除 Qwen2.5-72B-Instruct 无需使用 CoT 推理即可正确回答的查询，以防止模型依赖表面猜测，确保只包含需要深度推理的复杂问题。我们还使用 Qwen2.5-72B-Instruct 为每个查询标注领域，以保持数据集中领域表示的均衡性。

After reserving a validation query set, we generate N candidate responses for each remaining query using QwQ-32B (Qwen Team, 2025). When QwQ-32B consistently fails to generate correct solutions, human annotators manually assess the accuracy of the responses. For queries with positive Pass@N, further stringent filtering criteria are applied to remove responses that (1) yield incorrect final answers, (2) contain substantial repetition, (3) clearly indicate guesswork without adequate reasoning, (4) exhibit inconsistencies between the thinking and summary contents, (5) involve inappropriate language mixing or stylistic shifts, or (6) are suspected of being overly similar to potential validation set items. Subsequently, a carefully selected subset of the refined dataset is used for the initial cold-start training of the reasoning patterns. The objective at this stage is to instill foundational reasoning patterns in the model without overly emphasizing immediate reasoning performance. This approach ensures that the model's potential is not limited, allowing for greater flexibility and improvement during the subsequent reinforcement learning (RL) phase. To achieve this objective effectively, it is preferable to minimize both the number of training samples and the training steps during this preparatory phase.

在预留验证查询集后，我们使用 QwQ-32B 为每个剩余查询生成 N 个候选响应。当 QwQ-32B 持续无法生成正确解答时，人工标注员手动评估响应的准确性。对于 Pass@N 为正的查询，进一步应用严格的过滤标准以移除以下响应：(1) 最终答案错误，(2) 包含大量重复，(3) 明显缺乏充分推理的猜测，(4) 思考内容与总结内容不一致，(5) 涉及不恰当的语言混合或风格转换，(6)  suspected 与潜在验证集项目过于相似。随后，使用精心挑选的精炼数据子集进行推理模式的初始冷启动训练。此阶段的目标是为模型灌输基础推理模式，而非过分强调即时推理性能。这种方法确保模型的潜力不受限制，在后续的强化学习(RL)阶段具有更大的灵活性和提升空间。为有效实现这一目标，在此准备阶段最好同时最小化训练样本数量和训练步数。

> **译者注**：Long-CoT Cold Start 的设计体现了「少即是多」的哲学——刻意减少冷启动阶段的训练样本和步数，目的是「不过度拟合」特定推理模式，为后续 RL 阶段保留探索空间。这与 DeepSeek-R1 的 Cold Start 策略类似，但 Qwen3 使用了自家族的 QwQ-32B(而非 DeepSeek 的 R1)作为响应生成器，构建了完整的技术内循环。过滤条件中「思考与总结内容不一致」和「语言混合」这两条尤其值得注意，它们针对的是当前推理模型的常见缺陷——幻觉性推理(reasoning-content 与 final-answer 矛盾)和多语言混杂(模型在不同语言间随意切换)。

### 4.2 Reasoning RL

The query-verifier pairs used in the Reasoning RL stage must satisfy the following four criteria: (1) They were not used during the cold-start phase. (2) They are learnable for the cold-start model. (3) They are as challenging as possible. (4) They cover a broad range of sub-domains. We ultimately collect a total of 3,995 query-verifier pairs, and employed GRPO (Shao et al., 2024) to update the model parameters. We observe that using a large batch size and a high number of rollouts per query, along with off-policy training to improve sample efficiency, is beneficial to the training process. We have also addressed how to balance exploration and exploitation by controlling the model's entropy to increase steadily or remain stable, which is crucial for maintaining stable training. As a result, we achieve consistent improvements in both training reward and validation performance over the course of a single RL run, without any manual intervention on hyperparameters. For instance, the AIME'24 score of the Qwen3-235B-A22B model increases from 70.1 to 85.1 over a total of 170 RL training steps.

推理 RL 阶段使用的查询-验证器对必须满足以下四个标准：(1) 未在冷启动阶段使用过; (2) 对冷启动模型而言是可学习的; (3) 尽可能具有挑战性; (4) 覆盖广泛的子领域。我们最终收集了 3,995 个查询-验证器对，并采用 GRPO 更新模型参数。我们观察到，使用大 batch size 和每查询高 rollouts 数量，结合 off-policy 训练以提高样本效率，对训练过程有益。我们还通过控制模型熵值稳步增加或保持稳定来解决探索与利用的平衡问题，这对维持稳定训练至关重要。结果，我们在单次 RL 运行中实现了训练奖励和验证性能的持续提升，且无需对超参数进行任何人工干预。例如，Qwen3-235B-A22B 模型的 AIME'24 分数在总共 170 个 RL 训练步中从 70.1 提升至 85.1。

> **译者注**：仅 3,995 个 query-verifier 对就能驱动旗舰模型在 170 步内实现 AIME'24 从 70.1→85.1 的提升，这再次验证了 RL 在推理任务上的「样本效率奇迹」——与预训练所需的万亿级 token 相比，RL 阶段的数据量微不足道，但质量(可验证性、难度、多样性)至关重要。GRPO(Group Relative Policy Optimization)是 DeepSeekMath 提出的 PPO 变体，通过组内相对奖励减少了价值网络的需求，简化了 RL 实现。熵控制策略(steady increase or stable)是为了防止模型过早收敛到局部最优，保持探索能力。

### 4.3 Thinking Mode Fusion

The goal of the Thinking Mode Fusion stage is to integrate the "non-thinking" capabilities into the previously developed "thinking" model. This approach allows developers to manage and control reasoning behaviors, while also reducing the cost and complexity of deploying separate models for thinking and non-thinking tasks. To achieve this, we conduct continual supervised fine-tuning (SFT) on the Reasoning RL model and design a chat template to fuse the two modes. Moreover, we find that models capable of handling both modes proficiently perform consistently well under different thinking budgets.

思考模式融合阶段的目标是将「非思考」能力融入此前已发展的「思考」模型中。这种方法使开发者能够管理和控制推理行为，同时降低为思考和非思考任务分别部署模型的成本和复杂度。为实现这一目标，我们对推理 RL 模型进行持续监督微调(SFT)，并设计 Chat Template 来融合两种模式。此外，我们发现能够熟练处理两种模式的模型在不同思考预算下都能保持稳定良好的表现。

**Construction of SFT data.** The SFT dataset combines both the "thinking" and "non-thinking" data. To ensure that the performance of the Stage 2 model is not compromised by the additional SFT, the "thinking" data is generated via rejection sampling on Stage 1 queries using the Stage 2 model itself. The "non-thinking" data, on the other hand, is carefully curated to cover a diverse range of tasks, including coding, mathematics, instruction-following, multilingual tasks, creative writing, question answering, and role-playing. Additionally, we employ automatically generated checklists for assessing the response quality of "non-thinking" data. To enhance the performance on tasks with low-resource languages, we particularly increase the proportion of translation tasks.

**SFT 数据构建**：SFT 数据集结合了「思考」和「非思考」两类数据。为确保第二阶段模型的性能不因额外 SFT 而受损，「思考」数据通过对第一阶段查询使用第二阶段模型本身进行拒绝采样生成。「非思考」数据则经过精心筛选，涵盖代码、数学、指令遵循、多语言任务、创意写作、问答和角色扮演等多种任务。此外，我们使用自动生成的检查清单来评估「非思考」数据的响应质量。为增强低资源语言任务的性能，我们特别增加了翻译任务的比例。

**Chat Template Design.** To better integrate the two modes and enable users to dynamically switch the model's thinking process, we design chat templates for Qwen3, as shown in Table 9. Specifically, for samples in thinking mode and non-thinking mode, we introduce `/think` and `/no_think` flags in the user query or system message, respectively. This allows the model to follow the user's input and select the appropriate thinking mode accordingly. For non-thinking mode samples, we retain an empty thinking block in the assistant's response. This design ensures internal format consistency within the model and allows developers to prevent the model from engaging in thinking behavior by concatenating an empty think block in the chat template. By default, the model operates in thinking mode; therefore, we add some thinking mode training samples where the user queries do not include `/think` flags. For more complex multi-turn dialogs, we randomly insert multiple `/think` and `/no_think` flags into users' queries, with the model response adhering to the last flag encountered.

**Chat Template 设计**：为更好地整合两种模式并让用户动态切换模型的思考过程，我们为 Qwen3 设计了 Chat Template，如表 9 所示。具体而言，对于思考模式和非思考模式的样本，我们分别在用户查询或系统消息中引入 `/think` 和 `/no_think` 标志。这使模型能够遵循用户输入并相应选择适当的思考模式。对于非思考模式样本，我们在助手响应中保留一个空的思考块。这种设计确保了模型内部的格式一致性，并允许开发者在 Chat Template 中拼接空的思考块来阻止模型进行思考行为。默认情况下，模型以思考模式运行; 因此，我们添加了一些用户查询不包含 `/think` 标志的思考模式训练样本。对于更复杂的多轮对话，我们在用户查询中随机插入多个 `/think` 和 `/no_think` 标志，模型响应遵循最后遇到的标志。

Table 9: Examples of SFT data for thinking and non-thinking modes during the thinking mode fusion stage. For the thinking mode, the /think flag can be omitted since it represents the default behavior. This feature has been implemented in the chat template supported by the Hugging Face's tokenizer, where the thinking mode can be disabled using an additional parameter enable thinking=False.

表 9：思考模式融合阶段思考模式与非思考模式的 SFT 数据示例。对于思考模式，`/think` 标志可以省略，因为它代表默认行为。该功能已在 Hugging Face Tokenizer 支持的 Chat Template 中实现，可通过额外参数 `enable_thinking=False` 禁用思考模式。

<table><tr><td>Thinking Mode</td><td>Non-Thinking Mode</td></tr><tr><td>&lt;|im_start|&gt;user {query} /think&lt;|im_end|&gt;</td><td>&lt;|im_start|&gt;user {query} /no_think&lt;|im_end|&gt;</td></tr><tr><td>&lt;|im_start|&gt;assistant &lt;think&gt; {thinking-content}</td><td>&lt;|im_start|&gt;assistant &lt;think&gt;</td></tr><tr><td>&lt;/think&gt;</td><td>&lt;/think&gt;</td></tr><tr><td></td><td></td></tr><tr><td>{response}&lt;|im_end|&gt;</td><td>{response}&lt;|im_end|&gt;</td></tr></table>

**Thinking Budget.** An additional advantage of Thinking Mode Fusion is that, once the model learns to respond in both non-thinking and thinking modes, it naturally develops the ability to handle intermediate cases—generating responses based on incomplete thinking. This capability lays the foundation for implementing budget control over the model's thinking process. Specifically, when the length of the model's thinking reaches a user-defined threshold, we manually halt the thinking process and insert the stop-thinking instruction: "Considering the limited time by the user, I have to give the solution based on the thinking directly now.\n</think>.\n\n". After this instruction is inserted, the model proceeds to generate a final response based on its accumulated reasoning up to that point. It is worth noting that this ability is not explicitly trained but emerges naturally as a result of applying Thinking Mode Fusion.

**思考预算**。思考模式融合的额外优势在于，一旦模型学会以非思考和思考两种模式响应，它自然就发展了处理中间情况的能力——基于不完整的思考生成响应。这种能力为对模型思考过程实施预算控制奠定了基础。具体而言，当模型思考长度达到用户定义的阈值时，我们手动停止思考过程并插入停止思考指令："Considering the limited time by the user, I have to give the solution based on the thinking directly now.\n</think>.\n\n"。插入此指令后，模型基于截至该时刻的累积推理继续生成最终响应。值得注意的是，这种能力并非显式训练获得，而是应用思考模式融合后自然涌现的结果。

> **译者注**：Thinking Mode Fusion 是 Qwen3 最具工程创新性的设计之一。关键洞察是：通过在非思考模式的响应中保留空的 `<think></think>` 块，模型在两种模式间保持了内部格式一致性，这是后续「思考预算」机制能够工作的前提。更有趣的是，思考预算能力(在中间截断思考并基于已有推理继续生成)并非显式训练，而是「自然涌现」的——这说明模型在 SFT 阶段学到的「模式切换」能力具有某种泛化性。这种 emergent property 是大模型研究中反复出现的主题，但具体机理仍不完全清楚。从部署角度看，这意味着开发者可以通过调整一个超参数(思考预算)来在推理质量和延迟之间做实时权衡，而无需切换模型或修改架构。

### 4.4 General RL

The General RL stage aims to broadly enhance the models' capabilities and stability across diverse scenarios. To facilitate this, we have established a sophisticated reward system covering over 20 distinct tasks, each with customized scoring criteria. These tasks specifically target enhancements in the following core capabilities:

通用 RL 阶段旨在全面提升模型在多样场景下的能力和稳定性。为此，我们建立了一个覆盖 20 多个不同任务的精密奖励系统，每个任务都有定制的评分标准。这些任务专门针对以下核心能力的提升：

• **Instruction Following:** This capability ensures that models accurately interpret and follow user instructions, including requirements related to content, format, length, and the use of structured output, delivering responses that align with user expectations.

• **指令遵循**：确保模型准确理解并遵循用户指令，包括内容、格式、长度和结构化输出等相关要求，提供符合用户预期的响应。

• **Format Following:** In addition to explicit instructions, we expect the model to adhere to specific formatting conventions. For instance, it should respond appropriately to the `/think` and `/no_think` flags by switching between thinking and non-thinking modes, and consistently use designated tokens (e.g., `<think>` and `</think>`) to separate the thinking and response parts in the final output.

• **格式遵循**：除了显式指令外，我们期望模型遵守特定的格式约定。例如，它应根据 `/think` 和 `/no_think` 标志在思考和非思考模式间切换，并始终使用指定 token(如 `<think>` 和 `</think>`)来分隔最终输出中的思考部分和响应部分。

• **Preference Alignment:** For open-ended queries, preference alignment focuses on improving the model's helpfulness, engagement, and style, ultimately delivering a more natural and satisfying user experience.

• **偏好对齐**：对于开放式查询，偏好对齐专注于提升模型的有用性、参与度和风格，最终提供更自然、更令人满意的用户体验。

• **Agent Ability:** This involves training the model to correctly invoke tools via designated interfaces. During the RL rollout, the model is allowed to perform complete multi-turn interaction cycles with real environment execution feedback, thereby improving its performance and stability in long-horizon decision-making tasks.

• **Agent 能力**：训练模型通过指定接口正确调用工具。在 RL rollout 过程中，模型被允许与真实环境执行反馈进行完整的多轮交互循环，从而提升其在长程决策任务中的表现和稳定性。

• **Abilities for Specialized Scenarios:** In more specialized scenarios, we design tasks tailored to the specific context. For example, in Retrieval-Augmented Generation (RAG) tasks, we incorporate reward signals to guide the model toward generating accurate and contextually appropriate responses, thereby minimizing the risk of hallucination.

• **特殊场景能力**：在更专业的场景中，我们针对特定上下文设计任务。例如，在检索增强生成(RAG)任务中，我们引入奖励信号来引导模型生成准确且上下文恰当的响应，从而最小化幻觉风险。

To provide feedback for the aforementioned tasks, we utilized three distinct types of rewards:

为上述任务提供反馈，我们使用了三种不同类型的奖励：

(1) **Rule-based Reward:** The rule-based reward has been widely used in the reasoning RL stage, and is also useful for general tasks such as instruction following (Lambert et al., 2024) and format adherence. Well-designed rule-based rewards can assess the correctness of model outputs with high precision, preventing issues like reward hacking.

(1) **基于规则的奖励**：基于规则的奖励在推理 RL 阶段已广泛使用，也适用于指令遵循和格式遵守等通用任务。精心设计的基于规则奖励可以高精度评估模型输出的正确性，防止奖励篡改等问题。

(2) **Model-based Reward with Reference Answer:** In this approach, we provide a reference answer for each query and prompt Qwen2.5-72B-Instruct to score the model's response based on this reference. This method allows for more flexible handling of diverse tasks without requiring strict formatting, avoiding false negatives that can occur with purely rule-based rewards.

(2) **带参考答案的模型奖励**：在此方法中，我们为每个查询提供参考答案，并提示 Qwen2.5-72B-Instruct 基于该参考答案对模型响应进行评分。这种方法可以更灵活地处理多样任务，无需严格格式要求，避免了纯规则奖励可能产生的假阴性。

(3) **Model-based Reward without Reference Answer:** Leveraging human preference data, we train a reward model to assign scalar scores to model responses. This approach, which does not depend on a reference answer, can handle a broader range of queries while effectively enhancing the model's engagement and helpfulness.

(3) **不带参考答案的模型奖励**：利用人类偏好数据，我们训练奖励模型为模型响应分配标量分数。这种方法不依赖参考答案，可以处理更广泛的查询，同时有效提升模型的参与度和有用性。

> **译者注**：General RL 阶段的奖励设计非常全面，覆盖了从严格可验证任务(规则奖励)到开放式主观任务(偏好奖励)的全谱系。三种奖励类型的组合使用体现了对「奖励篡改(reward hacking)」问题的深刻理解——纯规则奖励容易被模型利用漏洞，纯偏好奖励可能缺乏对正确性的约束，而带参考的模型奖励则在两者之间取得了平衡。特别值得注意的是 Agent 能力的 RL 训练使用了「真实环境执行反馈」，这意味着模型在训练过程中就与实际 API/工具交互，而非仅在静态数据集上学习，这对提升工具调用可靠性至关重要。

### 4.5 Strong-to-Weak Distillation

The Strong-to-Weak Distillation pipeline is specifically designed to optimize lightweight models, encompassing 5 dense models (Qwen3-0.6B, 1.7B, 4B, 8B, and 14B) and one MoE model (Qwen3-30B-A3B). This approach enhances model performance while effectively imparting robust mode-switching capabilities. The distillation process is divided into two primary phases:

强到弱蒸馏流程专门设计用于优化轻量级模型，涵盖 5 个 Dense 模型(Qwen3-0.6B、1.7B、4B、8B 和 14B)和 1 个 MoE 模型(Qwen3-30B-A3B)。这种方法在提升模型性能的同时，有效赋予了稳健的模态切换能力。蒸馏过程分为两个主要阶段：

(1) **Off-policy Distillation:** At this initial phase, we combine the outputs of teacher models generated with both `/think` and `/no_think` modes for response distillation. This helps lightweight student models develop basic reasoning skills and the ability to switch between different modes of thinking, laying a solid foundation for the next on-policy training phase.

(1) **Off-policy 蒸馏**：在初始阶段，我们结合教师模型以 `/think` 和 `/no_think` 两种模式生成的输出进行响应蒸馏。这有助于轻量级学生模型发展基础推理技能和在不同思考模式间切换的能力，为下一阶段的 on-policy 训练奠定坚实基础。

(2) **On-policy Distillation:** In this phase, the student model generates on-policy sequences for fine-tuning. Specifically, prompts are sampled, and the student model produces responses in either `/think` or `/no_think` mode. The student model is then fine-tuned by aligning its logits with those of a teacher model (Qwen3-32B or Qwen3-235B-A22B) to minimize the KL divergence.

(2) **On-policy 蒸馏**：在此阶段，学生模型生成 on-policy 序列用于微调。具体而言，采样提示后，学生模型以 `/think` 或 `/no_think` 模式生成响应。然后通过对齐学生模型与教师模型(Qwen3-32B 或 Qwen3-235B-A22B)的 logits 来微调学生模型，以最小化 KL 散度。

> **译者注**：Strong-to-Weak Distillation 的两阶段设计体现了从「模仿」到「对齐」的渐进策略。Off-policy 阶段让学生模型先「观察」教师如何在两种模式下思考，建立基础能力; On-policy 阶段则让学生「亲自尝试」并通过对齐 logits 来精细调整。值得注意的是，Qwen3 发现蒸馏(而非四阶段 RL)对小模型更有效——Table 21 显示 On-policy 蒸馏在仅 1/10 GPU 时长的情况下超越了 RL，且 Pass@64(探索能力)也有所提升。这与 DeepSeek-R1 的蒸馏发现一致：对于小模型，从强模型蒸馏优于直接做 RL。从成本角度看，这大大降低了边缘端模型的训练门槛。

### 4.6 Post-training Evaluation

To comprehensively evaluate the quality of instruction-tuned models, we adopted automatic benchmarks to assess model performance under both thinking and non-thinking modes. These benchmarks are categorized into several dimensions:

为全面评估指令微调模型的质量，我们采用自动基准测试评估模型在思考模式和非思考模式下的表现。这些基准分为以下几个维度：

• **General Tasks:** We utilize benchmarks including MMLU-Redux (Gema et al., 2024), GPQA-Diamond (Rein et al., 2023), C-Eval (Huang et al., 2023), and LiveBench (2024-11-25) (White et al., 2024). For GPQA-Diamond, we sample 10 times for each query and report the averaged accuracy.

• **通用任务**：使用 MMLU-Redux、GPQA-Diamond、C-Eval 和 LiveBench(2024-11-25)等基准。对于 GPQA-Diamond，每个查询采样 10 次并报告平均准确率。

• **Alignment Tasks:** To evaluate how well the model aligns with human preferences, we employ a suite of specialized benchmarks. For instruction-following performance, we report the strictprompt accuracy of IFEval (Zhou et al., 2023). To assess alignment with human preferences on general topics, we utilize Arena-Hard (Li et al., 2024) and AlignBench v1.1 (Liu et al., 2023b). For writing tasks, we rely on Creative Writing V3 (Paech, 2024) and WritingBench (Wu et al., 2025) to evaluate the model's proficiency and creativity.

• **对齐任务**：为评估模型与人类偏好的对齐程度，我们采用一系列专门基准。对于指令遵循性能，报告 IFEval 的 strict-prompt 准确率。为评估通用主题上的人类偏好对齐，使用 Arena-Hard 和 AlignBench v1.1。对于写作任务，使用 Creative Writing V3 和 WritingBench 评估模型的熟练度和创造力。

• **Math & Text Reasoning:** For evaluating mathematical and logical reasoning skills, we employ high-level math benchmarks including MATH-500 (Lightman et al., 2023), AIME'24 and AIME'25 (AIME, 2025), and text reasoning tasks including ZebraLogic (Lin et al., 2025) and AutoLogi (Zhu et al., 2025). For AIME problems, each year's questions include Part I and Part II, totaling 30 questions. For each question, we sample 64 times and take the average accuracy as the final score.

• **数学与文本推理**：为评估数学和逻辑推理技能，使用高级数学基准 MATH-500、AIME'24 和 AIME'25，以及文本推理任务 ZebraLogic 和 AutoLogi。对于 AIME 问题，每年包含 Part I 和 Part II 共 30 题，每题采样 64 次并以平均准确率作为最终分数。

• **Agent & Coding:** To test the model's proficiency in coding and agent-based tasks, we use BFCL v3 (Yan et al., 2024), LiveCodeBench (v5, 2024.10-2025.02) (Jain et al., 2024), and Codeforces Ratings from CodeElo (Quan et al., 2025). For BFCL, all Qwen3 models are evaluated using the FC format, and yarn was used to deploy the models to a context length of 64k for Multi-Turn evaluation. Some baselines are derived from the BFCL leaderboard, taking the higher scores between FC and Prompt formats. For models not reported on the leaderboard, the Prompt formats are evaluated. For LiveCodeBench, for the non-thinking mode, we use the officially recommended prompt, while for the thinking mode, we adjust the prompt template to allow the model to think more freely, by removing the restriction "You will not return anything except for the program." To evaluate the performance gap between models and competitive programming experts, we use CodeForces to calculate Elo ratings. In our benchmark, each problem is solved by generating up to eight independent reasoning attempts.

• **Agent 与代码**：为测试模型在代码和基于 Agent 的任务上的熟练度，使用 BFCL v3、LiveCodeBench(v5, 2024.10-2025.02)和 CodeElo 的 Codeforces 评分。对于 BFCL，所有 Qwen3 模型使用 FC 格式评估，并使用 yarn 将模型部署到 64k 上下文长度进行多轮评估。部分基线取自 BFCL 排行榜，取 FC 和 Prompt 格式中的较高分数。对于未在排行榜上报告的模型，评估 Prompt 格式。对于 LiveCodeBench，非思考模式使用官方推荐提示，思考模式则调整提示模板以允许模型更自由地思考(移除「除程序外不返回任何内容」的限制)。为评估模型与竞赛编程专家之间的性能差距，使用 CodeForces 计算 Elo 评分。在我们的基准中，每道题通过生成最多八个独立推理尝试来求解。

• **Multilingual Tasks:** For multilingual capabilities, we evaluate four kinds of tasks: instruction following, knowledge, mathematics, and logical reasoning. Instruction following is assessed using Multi-IF (He et al., 2024), which focuses on 8 key languages. Knowledge assessment consisted of two types: regional knowledge evaluated through INCLUDE (Romanou et al., 2024), covering 44 languages, and general knowledge assessed with MMMLU (OpenAI, 2024) across 14 languages, excluding the unoptimized Yoruba language; for these two benchmarks, we sample only 10% of the original data to improve evaluation efficiency. The mathematics task employ MT-AIME2024 (Son et al., 2025), encompassing 55 languages, and PolyMath (Wang et al., 2025), which includes 18 languages. Logical reasoning is evaluated using MlogiQA, covering 10 languages, sourced from Zhang et al. (2024).

• **多语言任务**：对于多语言能力，评估四类任务：指令遵循、知识、数学和逻辑推理。指令遵循使用 Multi-IF(聚焦 8 种关键语言)评估。知识评估包括两类：通过 INCLUDE 评估区域知识(覆盖 44 种语言)，以及通过 MMMLU 评估通用知识(覆盖 14 种语言，排除未优化的约鲁巴语); 对于这两个基准，仅采样原始数据的 10% 以提高评估效率。数学任务使用 MT-AIME2024(涵盖 55 种语言)和 PolyMath(涵盖 18 种语言)。逻辑推理使用 MlogiQA(覆盖 10 种语言)评估。

Table 10: Multilingual benchmarks and the included languages. The languages are identified in IETF language tags.

表 10：多语言基准及包含的语言。语言以 IETF 语言标签标识。

<table><tr><td>Benchmark</td><td>#Langs</td><td>Languages</td></tr><tr><td>Multi-IF</td><td>8</td><td>en, es, fr, hi, it, pt, ru, zh</td></tr><tr><td>INCLUDE</td><td>44</td><td>ar, az, be, bg, bn, de, el, es, et, eu, fa, fi, fr, he, hi, hr, hu, hy, id, it, ja, ka, kk, ko, lt, mk, ml, mr, ne, nl, pl, pt, ru, sq, sr, ta, te, tl, tr, uk, ur, uz, vi, zh</td></tr><tr><td>MMMLU</td><td>14</td><td>ar, bn, de, en, es, fr, hi, id, it, ja, pt, sw, zh, yo (unoptimized)</td></tr><tr><td>MT-AIME2024</td><td>55</td><td>af, ar, bg, bn, ca, cs, cy, da, de, el, en, es, et, fa, fi, fr, gu, he, hi, hr, hu, id, it, ja, kn, ko, lt, lv, mk, ml, mr, ne, nl, no, pa, pl, pt, ro, ru, sk, sl, so, sq, sv, sw, ta, te, th, tl, tr, uk, ur, vi, zh-Hans, zh-Hant</td></tr><tr><td>PolyMath</td><td>18</td><td>ar, bn, de, en, es, fr, id, it, ja, ko, ms, pt, ru, sw, te, th, vi, zh</td></tr><tr><td>MLogiQA</td><td>10</td><td>ar, en, es, fr, ja, ko, pt, th, vi, zh</td></tr></table>

For all Qwen3 models in the thinking mode, we utilize a sampling temperature of 0.6, a top-p value of 0.95, and a top-k value of 20. Additionally, for Creative Writing v3 and WritingBench, we apply a presence penalty of 1.5 to encourage the generation of more diverse content. For Qwen3 models in the non-thinking mode, we configure the sampling hyperparameters with temperature = 0.7, top-p = 0.8, top-k = 20, and presence penalty = 1.5. For both the thinking and non-thinking modes, we set the max output length to 32,768 tokens, except AIME'24 and AIME'25 where we extend this length to 38,912 tokens to provide sufficient thinking space.

对于所有思考模式下的 Qwen3 模型，采样温度设为 0.6，top-p 为 0.95，top-k 为 20。此外，对于 Creative Writing v3 和 WritingBench，应用 presence penalty 为 1.5 以鼓励生成更多样化的内容。对于非思考模式下的 Qwen3 模型，采样超参数配置为 temperature = 0.7，top-p = 0.8，top-k = 20，presence penalty = 1.5。两种模式下最大输出长度均设为 32,768 token，AIME'24 和 AIME'25 除外，其长度扩展至 38,912 token 以提供充足的思考空间。

**Summary of Evaluation Results** From the evaluation results, we summarize several key conclusions of the finalized Qwen3 models as follows:

**评估结果总结** 从评估结果中，我们总结出最终 Qwen3 模型的几个关键结论：

(1) Our flagship model, Qwen3-235B-A22B, demonstrates the state-of-the-art overall performance among open-source models in both the thinking and non-thinking modes, surpassing strong baselines such as DeepSeek-R1 and DeepSeek-V3. Qwen3-235B-A22B is also highly competitive to closed-source leading models, such as OpenAI-o1, Gemini2.5-Pro, and GPT-4o, showcasing its profound reasoning capabilities and comprehensive general abilities.

(1) 我们的旗舰模型 Qwen3-235B-A22B 在思考模式和非思考模式下均展现出开源模型中最先进的整体性能，超越了 DeepSeek-R1 和 DeepSeek-V3 等强基线。Qwen3-235B-A22B 与 OpenAI-o1、Gemini2.5-Pro 和 GPT-4o 等闭源领先模型也极具竞争力，展现了其深厚的推理能力和全面的通用能力。

(2) Our flagship dense model, Qwen3-32B, outperforms our previous strongest reasoning model, QwQ-32B, in most of the benchmarks, and performs comparably to the closed-source OpenAI-o3-mini, indicating its compelling reasoning capabilities. Qwen3-32B is also remarkably performant in the non-thinking mode and surpasses our previous flagship non-reasoning dense model, Qwen2.5-72B-Instruct.

(2) 我们的旗舰 Dense 模型 Qwen3-32B 在大多数基准上超越了此前最强的推理模型 QwQ-32B，并与闭源的 OpenAI-o3-mini 表现相当，表明其强大的推理能力。Qwen3-32B 在非思考模式下也表现出色，超越了我们此前的旗舰非推理 Dense 模型 Qwen2.5-72B-Instruct。

(3) Our lightweight models, including Qwen3-30B-A3B, Qwen3-14B, and other smaller dense ones, possess consistently superior performance to the open-source models with a close or larger amount of parameters, proving the success of our Strong-to-Weak Distillation approach.

(3) 我们的轻量级模型，包括 Qwen3-30B-A3B、Qwen3-14B 和其他更小的 Dense 模型，性能持续优于参数量相近或更大的开源模型，证明了我们强到弱蒸馏方法的成功。

The detailed results are as follows.

详细结果如下。

**Qwen3-235B-A22B** For our flagship model Qwen3-235B-A22B, we compare it with the leading reasoning and non-reasoning models. For the thinking mode, we take OpenAI-o1 (OpenAI, 2024), DeepSeek-R1 (Guo et al., 2025), Grok-3-Beta (Think) (xAI, 2025), and Gemini2.5-Pro (DeepMind, 2025) as the reasoning baselines. For the non-thinking mode, we take GPT-4o-2024-11-20 (OpenAI, 2024), DeepSeek-V3 (Liu et al., 2024a), Qwen2.5-72B-Instruct (Yang et al., 2024b), and LLaMA-4-Maverick (Meta-AI, 2025) as the non-reasoning baselines. We present the evaluation results in Table 11 and 12.

**Qwen3-235B-A22B**：对于旗舰模型 Qwen3-235B-A22B，我们将其与领先的推理和非推理模型进行对比。思考模式的基线包括 OpenAI-o1、DeepSeek-R1、Grok-3-Beta (Think) 和 Gemini2.5-Pro; 非思考模式的基线包括 GPT-4o-2024-11-20、DeepSeek-V3、Qwen2.5-72B-Instruct 和 LLaMA-4-Maverick。评估结果见表 11 和表 12。

(1) From Table 11, with only 60% activated and 35% total parameters, Qwen3-235B-A22B (Thinking) outperforms DeepSeek-R1 on 17/23 the benchmarks, particularly on the reasoning-demanded tasks (e.g., mathematics, agent, and coding), demonstrating the state-of-the-art reasoning capabilities of Qwen3-235B-A22B among open-source models. Moreover, Qwen3-235B-A22B (Thinking) is also highly competitive to the closed-source OpenAI-o1, Grok-3-Beta (Think), and Gemini2.5-Pro, substantially narrowing the gap in the reasoning capabilities between open-source and close-source models.

(1) 从表 11 可见，Qwen3-235B-A22B(思考模式)仅以 60% 的激活参数和 35% 的总参数量，在 23 个基准中的 17 个上超越 DeepSeek-R1，尤其在需要推理的任务(如数学、Agent 和代码)上表现突出，展现了 Qwen3-235B-A22B 在开源模型中最先进的推理能力。此外，Qwen3-235B-A22B(思考模式)与闭源的 OpenAI-o1、Grok-3-Beta (Think) 和 Gemini2.5-Pro 也极具竞争力，大幅缩小了开源与闭源模型在推理能力上的差距。

(2) From Table 12, Qwen3-235B-A22B (Non-thinking) exceeds the other leading open-source models, including DeepSeek-V3, LLaMA-4-Maverick, and our previous flagship model Qwen2.5-72B-Instruct, and also surpasses the closed-source GPT-4o-2024-11-20 in 18/23 the benchmarks, indicating its inherent strong capabilities even when not enhanced with the deliberate thinking process.

(2) 从表 12 可见，Qwen3-235B-A22B(非思考模式)超越了其他领先开源模型(包括 DeepSeek-V3、LLaMA-4-Maverick 和此前的旗舰模型 Qwen2.5-72B-Instruct)，并在 23 个基准中的 18 个上超越闭源的 GPT-4o-2024-11-20，表明即使不借助刻意的思考过程，它也具备固有的强大能力。

**Qwen3-32B** For our flagship dense model, Qwen3-32B, we take DeepSeek-R1-Distill-Llama-70B, OpenAI-o3-mini (medium), and our previous strongest reasoning model, QwQ-32B (Qwen Team, 2025), as the baselines in the thinking mode. We also take GPT-4o-mini-2024-07-18, LLaMA-4-Scout, and our previous flagship model, Qwen2.5-72B-Instruct, as the baselines in the non-thinking mode. We present the evaluation results in Table 13 and 14.

**Qwen3-32B**：对于旗舰 Dense 模型 Qwen3-32B，思考模式的基线包括 DeepSeek-R1-Distill-Llama-70B、OpenAI-o3-mini (medium) 和此前最强的推理模型 QwQ-32B; 非思考模式的基线包括 GPT-4o-mini-2024-07-18、LLaMA-4-Scout 和此前的旗舰模型 Qwen2.5-72B-Instruct。评估结果见表 13 和表 14。

(1) From Table 13, Qwen3-32B (Thinking) outperforms QwQ-32B on 17/23 the benchmarks, making it the new state-of-the-art reasoning model at the sweet size of 32B. Moreover, Qwen3-32B (Thinking) also competes with the closed-source OpenAI-o3-mini (medium) with better alignment and multilingual performance.

(1) 从表 13 可见，Qwen3-32B(思考模式)在 23 个基准中的 17 个上超越 QwQ-32B，成为 32B 这一黄金尺寸上新的最先进推理模型。此外，Qwen3-32B(思考模式)在对齐和多语言性能更好的情况下与闭源的 OpenAI-o3-mini (medium) 展开竞争。

(2) From Table 14, Qwen3-32B (Non-thinking) exhibits superior performance to all the baselines on almost all the benchmarks. Particularly, Qwen3-32B (Non-thinking) performs on par with Qwen2.5-72B-Instruct on the general tasks with significant advantages on the alignment, multilingual, and reasoning-related tasks, again proving the fundamental improvements of Qwen3 over our previous Qwen2.5 series models.

(2) 从表 14 可见，Qwen3-32B(非思考模式)在几乎所有基准上均优于所有基线。特别地，Qwen3-32B(非思考模式)在通用任务上与 Qwen2.5-72B-Instruct 表现相当，在对齐、多语言和推理相关任务上具有显著优势，再次证明了 Qwen3 相对前代 Qwen2.5 系列模型的根本性改进。

**Qwen3-30B-A3B & Qwen3-14B** For Qwen3-30B-A3B and Qwen3-14B, we compare them with DeepSeek-R1-Distill-Qwen-32B and QwQ-32B in the thinking mode, and Phi-4 (Abdin et al., 2024), Gemma-3-27B-IT (Team et al., 2025), and Qwen2.5-32B-Instruct in the non-thinking mode, respectively. We present the evaluation results in Table 15 and 16.

**Qwen3-30B-A3B 与 Qwen3-14B**：对于 Qwen3-30B-A3B 和 Qwen3-14B，思考模式分别与 DeepSeek-R1-Distill-Qwen-32B 和 QwQ-32B 对比; 非思考模式分别与 Phi-4、Gemma-3-27B-IT 和 Qwen2.5-32B-Instruct 对比。评估结果见表 15 和表 16。

(1) From Table 15, Qwen3-30B-A3B and Qwen3-14B (Thinking) are both highly competitive to QwQ-32B, especially on the reasoning-related benchmarks. It is noteworthy that Qwen3-30B-A3B achieves comparable performance to QwQ-32B with a smaller model size and less than 1/10 activated parameters, demonstrating the effectiveness of our Strong-to-Weak Distillation approach in endowing lightweight models with profound reasoning capabilities.

(1) 从表 15 可见，Qwen3-30B-A3B 和 Qwen3-14B(思考模式)都与 QwQ-32B 极具竞争力，尤其在推理相关基准上。值得注意的是，Qwen3-30B-A3B 以更小的模型尺寸和不到 1/10 的激活参数量达到了与 QwQ-32B 相当的性能，证明了我们强到弱蒸馏方法在赋予轻量级模型深度推理能力方面的有效性。

(2) From Table 16, Qwen3-30B-A3B and Qwen3-14B (Non-thinking) surpass the non-reasoning baselines in most of the benchmarks. They exceed our previous Qwen2.5-32B-Instruct model with significantly fewer activated and total parameters, allowing for more efficient and cost-effective performance.

(2) 从表 16 可见，Qwen3-30B-A3B 和 Qwen3-14B(非思考模式)在大多数基准上超越非推理基线。它们以更少的激活参数量和总参数量超越了我们此前的 Qwen2.5-32B-Instruct 模型，实现了更高效、更具成本效益的性能。

**Qwen3-8B / 4B / 1.7B / 0.6B** For Qwen3-8B and Qwen3-4B, we compare them with DeepSeek-R1-Distill-Qwen-14B and DeepSeek-R1-Distill-Qwen-32B in the thinking mode, and LLaMA-3.1-8B-Instruct (Dubey et al., 2024), Gemma-3-12B-IT (Team et al., 2025), Qwen2.5-7B-Instruct, and Qwen2.5-14B-Instruct in the non-thinking mode, respectively. For Qwen3-1.7B and Qwen3-0.6B, we compare them with DeepSeek-R1-Distill-Qwen-1.5B and DeepSeek-R1-Distill-Llama-8B in the thinking mode, and Gemma-3-1B-IT, Phi-4-mini, Qwen2.5-1.5B-Instruct, and Qwen2.5-3B-Instruct in the non-thinking mode, respectively. We present the evaluation results of Qwen3-8B and Qwen3-4B in Table 17 and 18 and those of Qwen3-1.7B and Qwen3-0.6B in Table 19 and 20, respectively. Overall, these edge-side models exhibit impressive performance and outperform baselines even with more parameters, including our previous Qwen2.5 models, in either the thinking or the non-thinking mode. These results, once again, demonstrate the efficacy of our Strong-to-Weak Distillation approach, making it possible for us to build the lightweight Qwen3 models with remarkably reduced costs and efforts.

**Qwen3-8B / 4B / 1.7B / 0.6B**：对于 Qwen3-8B 和 Qwen3-4B，思考模式分别与 DeepSeek-R1-Distill-Qwen-14B 和 DeepSeek-R1-Distill-Qwen-32B 对比; 非思考模式分别与 LLaMA-3.1-8B-Instruct、Gemma-3-12B-IT、Qwen2.5-7B-Instruct 和 Qwen2.5-14B-Instruct 对比。对于 Qwen3-1.7B 和 Qwen3-0.6B，思考模式分别与 DeepSeek-R1-Distill-Qwen-1.5B 和 DeepSeek-R1-Distill-Llama-8B 对比; 非思考模式分别与 Gemma-3-1B-IT、Phi-4-mini、Qwen2.5-1.5B-Instruct 和 Qwen2.5-3B-Instruct 对比。Qwen3-8B 和 Qwen3-4B 的评估结果见表 17 和表 18，Qwen3-1.7B 和 Qwen3-0.6B 的评估结果见表 19 和表 20。总体而言，这些边缘端模型展现了令人印象深刻的性能，在思考模式或非思考模式下均超越了参数量更大的基线(包括我们此前的 Qwen2.5 模型)。这些结果再次证明了强到弱蒸馏方法的有效性，使我们能够以大幅降低的成本和工作量构建轻量级 Qwen3 模型。

> **译者注**：从后训练评估可以看出 Qwen3 的「全尺寸制霸」策略——从 235B 旗舰到 0.6B 边缘端，每个尺寸都在同量级中处于领先位置。特别值得关注的是思考模式与非思考模式的性能权衡：旗舰模型在两种模式下都达到了 SOTA，但小模型在思考模式下的推理能力(如 AIME)与非思考模式下的通用能力(如 Arena-Hard)之间存在明显差距。这反映了蒸馏的局限性——学生模型从教师那里继承了推理模式，但通用对话能力的提升需要更全面的后训练。此外，Qwen3 的评估设置非常严谨：AIME 每题 64 次采样、BFCL 使用 FC 格式并部署到 64k 上下文、LiveCodeBench 对思考/非思考使用不同提示模板，这些细节确保了结果的可复现性和可比性。

### 4.7 Discussion

**The Effectiveness of Thinking Budget** To verify that Qwen3 can enhance its intelligence level by leveraging an increased thinking budget, we adjust the allocated thinking budget on four benchmarks across Mathematics, Coding, and STEM domains. The resulting scaling curves are presented in Figure 2, Qwen3 demonstrates scalable and smooth performance improvements correlated to the allocated thinking budget. Moreover, we observe that if we further extend the output length beyond 32K, the model's performance is expected to improve further in the future. We leave this exploration as future work.

**思考预算的有效性** 为验证 Qwen3 能否通过增加思考预算来提升智能水平，我们在数学、代码和 STEM 领域的四个基准上调整分配的思考预算。图 2 展示了相应的扩展曲线，Qwen3 展现了与分配思考预算相关的可扩展且平滑的性能提升。此外，我们观察到如果进一步将输出长度扩展到 32K 以上，模型性能有望继续提升。我们将此探索留作未来工作。

AIME'24  
![](images/fig02_thinking_budget_aime24.jpg)

AIME'25  
![](images/fig02_thinking_budget_aime25.jpg)

![](images/fig02_thinking_budget_panel3.jpg)

![](images/fig02_thinking_budget_caption.jpg)  
Figure 2: Performance of Qwen3-235B-A22B with respect to the thinking budget.

图 2：Qwen3-235B-A22B 随思考预算变化的性能表现

**The Effectiveness and Efficiency of On-Policy Distillation** We evaluate the effectiveness and efficiency of on-policy distillation by comparing the performance and computational cost—measured in GPU hours—after undergoing distillation versus direct reinforcement learning, both starting from the same off-policy distilled 8B checkpoint. For simplicity, we focus solely on math and code-related queries in this comparison. The results, summarized in Table 21, show that distillation achieves significantly better performance than reinforcement learning while requiring approximately only 1/10 of the GPU hours. Furthermore, distillation from teacher logits enables the student model to expand its exploration space and enhance its reasoning potential, as evidenced by the improved pass@64 scores on the AIME'24 and AIME'25 benchmarks after distillation, compared to the initial checkpoint. In contrast, reinforcement learning does not lead to any improvement in pass@64 scores. These observations highlight the advantages of leveraging a stronger teacher model in guiding student model learning.

**On-policy 蒸馏的有效性与效率** 我们通过比较蒸馏与直接强化学习后的性能和计算成本(以 GPU 小时计)来评估 on-policy 蒸馏的有效性和效率，两者均从相同的 off-policy 蒸馏 8B 检查点开始。为简化，我们在此比较中仅关注数学和代码相关查询。表 21 汇总的结果显示，蒸馏在仅约需 1/10 GPU 小时的情况下实现了显著优于强化学习的性能。此外，从教师 logits 进行蒸馏使学生模型能够扩展其探索空间并增强推理潜力，这体现在蒸馏后 AIME'24 和 AIME'25 基准上的 Pass@64 分数相比初始检查点有所提升。相比之下，强化学习并未带来 Pass@64 分数的任何改善。这些观察凸显了利用更强教师模型指导学生模型学习的优势。

Table 21: Comparison of reinforcement learning and on-policy distillation on Qwen3-8B. Numbers in parentheses indicate pass@64 scores.

表 21：Qwen3-8B 上强化学习与 on-policy 蒸馏的对比。括号中的数字表示 pass@64 分数。

<table><tr><td>Method</td><td>AIME'24</td><td>AIME'25</td><td>MATH500</td><td>LiveCodeBench v5</td><td>MMLU-Redux</td><td>GPQA-Diamond</td><td>GPU Hours</td></tr><tr><td>Off-policy Distillation</td><td>55.0 (90.0)</td><td>42.8 (83.3)</td><td>92.4</td><td>42.0</td><td>86.4</td><td>55.6</td><td>-</td></tr><tr><td>+ Reinforcement Learning</td><td>67.6 (90.0)</td><td>55.5 (83.3)</td><td>94.8</td><td>52.9</td><td>86.9</td><td>61.3</td><td>17,920</td></tr><tr><td>+ On-policy Distillation</td><td>74.4 (93.3)</td><td>65.5 (86.7)</td><td>97.0</td><td>60.3</td><td>88.3</td><td>63.3</td><td>1,800</td></tr></table>

**The Effects of Thinking Mode Fusion and General RL** To evaluate the effectiveness of Thinking Mode Fusion and General Reinforcement Learning (RL) during the post-training, we conduct evaluations on various stages of the Qwen-32B model. In addition to the datasets mentioned earlier, we introduce several in-house benchmarks to monitor other capabilities. These benchmarks include:

**思考模式融合与通用 RL 的效果** 为评估后训练过程中思考模式融合和通用强化学习(RL)的有效性，我们对 Qwen-32B 模型各阶段进行了评估。除前述数据集外，我们还引入了几个内部基准来监测其他能力，包括：

• **CounterFactQA:** Contains counterfactual questions where the model needs to identify that the questions are not factual and avoid generating hallucinatory answers.

• **CounterFactQA**：包含反事实问题，模型需要识别这些问题不符合事实并避免生成幻觉性答案。

• **LengthCtrl:** Includes creative writing tasks with length requirements; the final score is based on the difference between the generated content length and the target length.

• **LengthCtrl**：包含带长度要求的创意写作任务; 最终分数基于生成内容长度与目标长度的差异。

• **ThinkFollow:** Involves multi-turn dialogues with randomly inserted `/think` and `/no_think` flags to test whether the model can correctly switch thinking modes based on user queries.

• **ThinkFollow**：涉及随机插入 `/think` 和 `/no_think` 标志的多轮对话，测试模型是否能根据用户查询正确切换思考模式。

• **ToolUse:** Evaluates the stability of the model in single-turn, multi-turn, and multi-step tool calling processes. The score includes accuracy in intent recognition, format accuracy, and parameter accuracy during the tool calling process.

• **ToolUse**：评估模型在单轮、多轮和多步工具调用过程中的稳定性。分数包括意图识别准确率、格式准确率和工具调用过程中的参数准确率。

Table 22: Performance of Qwen3-32B after Reasoning RL (Stage 2), Thinking Mode Fusion (Stage 3), and General RL (Stage 4). Benchmarks with \* are in-house datasets.

表 22：Qwen3-32B 在推理 RL(阶段 2)、思考模式融合(阶段 3)和通用 RL(阶段 4)后的性能。带 \* 的基准为内部数据集。

The results are shown in Table 22, where we can draw the following conclusions:

结果见表 22，我们可以得出以下结论：

(1) Stage 3 integrates the non-thinking mode into the model, which already possesses thinking capabilities after the first two stages of training. The ThinkFollow benchmark score of 88.7 indicates that the model has developed an initial ability to switch between modes, though it still occasionally makes errors. Stage 3 also enhances the model's general and instruction-following capabilities in thinking mode, with CounterFactQA improving by 10.9 points and LengthCtrl by 8.0 points.

(1) 阶段 3 将非思考模式融入已经具备思考能力的模型中(经过前两个阶段训练)。ThinkFollow 基准分数 88.7 表明模型已发展出初步的模式切换能力，尽管偶尔仍会出错。阶段 3 还增强了模型在思考模式下的通用能力和指令遵循能力，CounterFactQA 提升了 10.9 分，LengthCtrl 提升了 8.0 分。

(2) Stage 4 further strengthens the model's general, instruction-following, and agent capabilities in both thinking and non-thinking modes. Notably, the ThinkFollow score improves to 98.9, ensuring accurate mode switching.

(2) 阶段 4 进一步增强了模型在思考和非思考两种模式下的通用能力、指令遵循能力和 Agent 能力。值得注意的是，ThinkFollow 分数提升至 98.9，确保了准确的模式切换。

(3) For Knowledge, STEM, Math, and Coding tasks, Thinking Mode Fusion and General RL do not bring significant improvements. In contrast, for challenging tasks like AIME'24 and Live-CodeBench, the performance in thinking mode actually decreases after these two training stages. We conjecture this degradation is due to the model being trained on a broader range of general tasks, which may compromise its specialized capabilities in handling complex problems. During the development of Qwen3, we choose to accept this performance trade-off to enhance the model's overall versatility.

(3) 对于知识、STEM、数学和代码任务，思考模式融合和通用 RL 并未带来显著提升。相反，对于 AIME'24 和 LiveCodeBench 等挑战性任务，经过这两个训练阶段后思考模式的性能实际上有所下降。我们推测这种退化是因为模型在更广泛的通用任务上训练，可能损害了其处理复杂问题的专门能力。在 Qwen3 的开发过程中，我们选择接受这种性能权衡以增强模型的整体通用性。

> **译者注**：Discussion 部分坦诚承认了 Qwen3 的 trade-off——通用 RL 阶段虽然大幅提升了指令遵循、Agent 和模式切换能力(ThinkFollow 从 88.7→98.9)，但也导致了高难度推理任务(AIME'24、LiveCodeBench)上思考模式性能的轻微下降。这是一个在 LLM 后训练中反复出现的现象：通用能力的扩展往往会「稀释」专门能力。Qwen3 团队选择接受这一权衡，说明他们认为「通用可用性」比「单项 SOTA」对用户体验更重要。Table 21 的数据非常有说服力：On-policy 蒸馏以 1,800 GPU 小时超越了需要 17,920 GPU 小时的 RL，且 Pass@64 也更高——这为小模型训练提供了明确的经济性指导：先做高质量蒸馏，再视需求做轻量 RL 微调。

## 5 Conclusion

In this technical report, we introduce Qwen3, the latest version of the Qwen series. Qwen3 features both thinking mode and non-thinking mode, allowing users to dynamically manage the number of tokens used for complex thinking tasks. The model was pre-trained on an extensive dataset containing 36 trillion tokens, enabling it to understand and generate text in 119 languages and dialects. Through a series of comprehensive evaluations, Qwen3 has shown strong performance across a range of standard benchmarks for both pre-trained and post-trained models, including tasks related to code generation, mathematics, reasoning, and agents.

在本技术报告中，我们介绍了 Qwen 系列的最新版本 Qwen3。Qwen3 具备思考模式和非思考模式，允许用户动态管理用于复杂思考任务的 token 数量。模型在包含 36 万亿 token 的庞大数据集上预训练，能够理解和生成 119 种语言和方言的文本。通过一系列全面评估，Qwen3 在预训练模型和后训练模型的各类标准基准上均展现出强劲性能，包括代码生成、数学、推理和 Agent 相关任务。

In the near future, our research will focus on several key areas. We will continue to scale up pre-training by using data that is both higher in quality and more diverse in content. At the same time, we will work on improving model architecture and training methods for the purposes of effective compression, scaling to extremely long contexts, etc. In addition, we plan to increase computational resources for reinforcement learning, with a particular emphasis on agent-based RL systems that learn from environmental feedback. This will allow us to build agents capable of tackling complex tasks that require inference time scaling.

在不久的将来，我们的研究将聚焦以下几个关键领域。我们将继续使用质量更高、内容更多样化的数据来扩大预训练规模。同时，我们将致力于改进模型架构和训练方法，以实现有效压缩、扩展到极长上下文等目标。此外，我们计划增加强化学习的计算资源，特别侧重于从环境反馈中学习的基于 Agent 的 RL 系统。这将使我们能够构建能够处理需要推理时间扩展的复杂任务的 Agent。

## 6 Authors

Core Contributors: An Yang, Anfeng Li, Baosong Yang, Beichen Zhang, Binyuan Hui, Bo Zheng, Bowen Yu, Chang Gao, Chengen Huang, Chenxu Lv, Chujie Zheng, Dayiheng Liu, Fan Zhou, Fei Huang, Feng Hu, Hao Ge, Haoran Wei, Huan Lin, Jialong Tang, Jian Yang, Jianhong Tu, Jianwei Zhang, Jianxin Yang, Jiaxi Yang, Jing Zhou, Jingren Zhou, Junyang Lin, Kai Dang, Keqin Bao, Kexin Yang, Le Yu, Lianghao Deng, Mei Li, Mingfeng Xue, Mingze Li, Pei Zhang, Peng Wang, Qin Zhu, Rui Men, Ruize Gao, Shixuan Liu, Shuang Luo, Tianhao Li, Tianyi Tang, Wenbiao Yin, Xingzhang Ren, Xinyu Wang, Xinyu Zhang, Xuancheng Ren, Yang Fan, Yang Su, Yichang Zhang, Yinger Zhang, Yu Wan, Yuqiong Liu, Zekun Wang, Zeyu Cui, Zhenru Zhang, Zhipeng Zhou, Zihan Qiu

核心贡献者：An Yang, Anfeng Li, Baosong Yang, Beichen Zhang, Binyuan Hui, Bo Zheng, Bowen Yu, Chang Gao, Chengen Huang, Chenxu Lv, Chujie Zheng, Dayiheng Liu, Fan Zhou, Fei Huang, Feng Hu, Hao Ge, Haoran Wei, Huan Lin, Jialong Tang, Jian Yang, Jianhong Tu, Jianwei Zhang, Jianxin Yang, Jiaxi Yang, Jing Zhou, Jingren Zhou, Junyang Lin, Kai Dang, Keqin Bao, Kexin Yang, Le Yu, Lianghao Deng, Mei Li, Mingfeng Xue, Mingze Li, Pei Zhang, Peng Wang, Qin Zhu, Rui Men, Ruize Gao, Shixuan Liu, Shuang Luo, Tianhao Li, Tianyi Tang, Wenbiao Yin, Xingzhang Ren, Xinyu Wang, Xinyu Zhang, Xuancheng Ren, Yang Fan, Yang Su, Yichang Zhang, Yinger Zhang, Yu Wan, Yuqiong Liu, Zekun Wang, Zeyu Cui, Zhenru Zhang, Zhipeng Zhou, Zihan Qiu

Contributors: Bei Chen, Biao Sun, Bin Luo, Bin Zhang, Binghai Wang, Bowen Ping, Boyi Deng, Chang Si, Chaojie Yang, Chen Cheng, Chenfei Wu, Chengpeng Li, Chengyuan Li, Fan Hong, Guobin Zhao, Hang Zhang, Hangrui Hu, Hanyu Zhao, Hao Lin, Hao Xiang, Haoyan Huang, Hongkun Hao, Humen Zhong, Jialin Wang, Jiandong Jiang, Jianqiang Wan, Jianyuan Zeng, Jiawei Chen, Jie Zhang, Jin Xu, Jinkai Wang, Jinyang Zhang, Jinzheng He, Jun Tang, Kai Zhang, Ke Yi, Keming Lu, Keqin Chen, Langshi Chen, Le Jiang, Lei Zhang, Linjuan Wu, Man Yuan, Mingkun Yang, Minmin Sun, Mouxiang Chen, Na Ni, Nuo Chen, Peng Liu, Peng Wang, Peng Zhu, Pengcheng Zhang, Pengfei Wang, Qiaoyu Tang, Qing Fu, Qiuyue Wang, Rong Zhang, Rui Hu, Runji Lin, Shen Huang, Shuai Bai, Shutong Jiang, Sibo Song, Siqi Zhang, Song Chen, Tao He, Ting He, Tingfeng Hui, Wei Ding, Wei Liao, Wei Lin, Wei Zhang, Weijia Xu, Wenbin Ge, Wenmeng Zhou, Wenyuan Yu, Xianyan Jia, Xianzhong Shi, Xiaodong Deng, Xiaoming Huang, Xiaoyuan Li, Ximing Zhou, Xinyao Niu, Xipin Wei, Xuejing Liu, Yang Liu, Yang Yao, Yang Zhang, Yanpeng Li, Yantao Liu, Yidan Zhang, Yikai Zhu, Yiming Wang, Yiwen Hu, Yong Jiang, Yong Li, Yongan Yue, Yu Guan, Yuanzhi Zhu, Yunfei Chu, Yunlong Feng, Yuxin Zhou, Yuxuan Cai, Zeyao Ma, Zhaohai Li, Zheng Li, Zhengyang Tang, Zheren Fu, Zhi Li, Zhibo Yang, Zhifang Guo, Zhipeng Zhang, Zhiying Xu, Zhiyu Yin, Zhongshen Zeng, Zile Qiao, Ziye Meng, Zongmeng Zhang

贡献者：Bei Chen, Biao Sun, Bin Luo, Bin Zhang, Binghai Wang, Bowen Ping, Boyi Deng, Chang Si, Chaojie Yang, Chen Cheng, Chenfei Wu, Chengpeng Li, Chengyuan Li, Fan Hong, Guobin Zhao, Hang Zhang, Hangrui Hu, Hanyu Zhao, Hao Lin, Hao Xiang, Haoyan Huang, Hongkun Hao, Humen Zhong, Jialin Wang, Jiandong Jiang, Jianqiang Wan, Jianyuan Zeng, Jiawei Chen, Jie Zhang, Jin Xu, Jinkai Wang, Jinyang Zhang, Jinzheng He, Jun Tang, Kai Zhang, Ke Yi, Keming Lu, Keqin Chen, Langshi Chen, Le Jiang, Lei Zhang, Linjuan Wu, Man Yuan, Mingkun Yang, Minmin Sun, Mouxiang Chen, Na Ni, Nuo Chen, Peng Liu, Peng Wang, Peng Zhu, Pengcheng Zhang, Pengfei Wang, Qiaoyu Tang, Qing Fu, Qiuyue Wang, Rong Zhang, Rui Hu, Runji Lin, Shen Huang, Shuai Bai, Shutong Jiang, Sibo Song, Siqi Zhang, Song Chen, Tao He, Ting He, Tingfeng Hui, Wei Ding, Wei Liao, Wei Lin, Wei Zhang, Weijia Xu, Wenbin Ge, Wenmeng Zhou, Wenyuan Yu, Xianyan Jia, Xianzhong Shi, Xiaodong Deng, Xiaoming Huang, Xiaoyuan Li, Ximing Zhou, Xinyao Niu, Xipin Wei, Xuejing Liu, Yang Liu, Yang Yao, Yang Zhang, Yanpeng Li, Yantao Liu, Yidan Zhang, Yikai Zhu, Yiming Wang, Yiwen Hu, Yong Jiang, Yong Li, Yongan Yue, Yu Guan, Yuanzhi Zhu, Yunfei Chu, Yunlong Feng, Yuxin Zhou, Yuxuan Cai, Zeyao Ma, Zhaohai Li, Zheng Li, Zhengyang Tang, Zheren Fu, Zhi Li, Zhibo Yang, Zhifang Guo, Zhipeng Zhang, Zhiying Xu, Zhiyu Yin, Zhongshen Zeng, Zile Qiao, Ziye Meng, Zongmeng Zhang

## A Appendix

## A 附录

### A.1 Additional Evaluation Results

### A.1 额外评估结果

#### A.1.1 Long-Context Ability

#### A.1.1 长上下文能力

Table 23: Performance of Qwen3 Models on the RULER benchmark.

表 23：Qwen3 模型在 RULER 基准上的性能

For evaluating long-context processing capabilities, we report the results on the RULER benchmark (Hsieh et al., 2024) in Table 23. To enable length extrapolation, we utilize YARN (Peng et al., 2023) with a scaling factor=4. In thinking mode, we set the thinking budget to 8192 tokens to mitigate overly verbose reasoning on the extremely long inputs.

为评估长上下文处理能力，我们在表 23 中报告了 RULER 基准(Hsieh et al., 2024)的结果。为实现长度外推，我们使用 YARN(Peng et al., 2023)并设缩放因子为 4。在思考模式下，我们将思考预算设为 8192 token，以缓解极长输入上的过度冗长推理。

**The results show that:**

**结果显示：**

1. In non-thinking mode, Qwen3 outperforms Qwen2.5 models of a similar size in long-context processing tasks.

1. 在非思考模式下，Qwen3 在长上下文处理任务上优于同规模的 Qwen2.5 模型。

2. In thinking mode, the model's performance slightly degrades. We hypothesize that the thinking content does not provide significant benefits for these retrieval tasks, which do not rely on reasoning and may instead interfere with the retrieval process. We are committed to enhancing the long-context capability in the thinking mode in future versions.

2. 在思考模式下，模型性能略有下降。我们推测思考内容对这些不依赖推理的检索任务没有显著帮助，反而可能干扰检索过程。我们致力于在未来版本中增强思考模式下的长上下文能力。

#### A.1.2 Multilingual Ability

#### A.1.2 多语言能力

Table 24-35 presents the detailed benchmark scores across various languages, including Spanish, French, Portuguese, Italian, Arabic, Japanese, Korean, Indonesian, Russian, Vietnamese, German, and Thai. The results of these tables demonstrate that the Qwen3 series models achieve competitive performance across all evaluated benchmarks, showcasing their strong multilingual capabilities.

表 24-35 展示了西班牙语、法语、葡萄牙语、意大利语、阿拉伯语、日语、韩语、印尼语、俄语、越南语、德语和泰语等多种语言的详细基准分数。这些表格的结果表明，Qwen3 系列模型在所有评估基准上均取得了有竞争力的性能，展现了其强大的多语言能力。

To evaluate the performance of Qwen3 across a broader range of languages, we utilize Belebele (Bandarkar et al., 2023), a benchmark for natural language understanding. We conduct evaluations on 80 supported languages from the benchmark, excluding 42 unoptimized languages, as shown in Table 36 (organized by language family). The performance comparison between Qwen3 and other baseline models on the Belebele benchmark is presented in Table 37. The results show that Qwen3 achieves comparable performance to similarly-sized Gemma models while outperforming Qwen2.5 significantly.

为评估 Qwen3 在更广泛语言上的表现，我们使用 Belebele(Bandarkar et al., 2023)——一个自然语言理解基准。我们对基准中 80 种支持的语言进行评估，排除 42 种未优化的语言，如表 36 所示(按语系组织)。表 37 展示了 Qwen3 与其他基线模型在 Belebele 基准上的性能对比。结果显示，Qwen3 达到了与同规模 Gemma 模型相当的性能，同时显著优于 Qwen2.5。

Table 36: Language families and language codes supported by Qwen3 in Belebele Benchmark

表 36：Qwen3 在 Belebele 基准中支持的语言家族和语言代码

Table 37: Comparison of Belebele Benchmark performance between Qwen3 and other baseline models. Scores are highlighted with the highest in bold and the second-best underlined.

表 37：Qwen3 与其他基线模型在 Belebele 基准上的性能对比。最高分以粗体显示，第二高分以下划线显示。

> **译者注**：附录中的长上下文评估揭示了一个有趣的发现：思考模式对纯检索类长上下文任务反而有负面影响。这是因为思考模式会生成大量推理内容，可能干扰对原文的精确定位。这提示在实际应用中，对于「长文档问答」这类以检索为主的任务，可能更适合使用非思考模式或限制思考预算。多语言评估覆盖 80 种语言(排除 42 种未优化语言)，说明 Qwen3 虽然名义上支持 119 种语言，但对部分低资源语言的优化仍有提升空间。Belebele 对比显示 Qwen3 已追平 Gemma-3，这是多语言能力的重要里程碑——Gemma-3 以多语言见长，而 Qwen 系列此前在此方面相对薄弱。

## References

## 参考文献

Marah Abdin, Jyoti Aneja, Harkirat Behl, Sebastien Bubeck, Ronen Eldan, Suriya Gunasekar, Michael Harrison, Russell J Hewett, Mojan Javaheripi, Piero Kauffmann, et al. Phi-4 technical report. arXiv preprint arXiv:2412.08905, 2024.

AIME. AIME problems and solutions, 2025. URL https://artofproblemsolving.com/wiki/index.php/AIME_Problems_and_Solutions.

Joshua Ainslie, James Lee-Thorp, Michiel de Jong, Yury Zemlyanskiy, Federico Lebron, and Sumit Sanghai. GQA: Training generalized multi-query Transformer models from multi-head checkpoints. In EMNLP, pp. 4895–4901. Association for Computational Linguistics, 2023.

Chenxin An, Fei Huang, Jun Zhang, Shansan Gong, Xipeng Qiu, Chang Zhou, and Lingpeng Kong. Training-free long-context scaling of large language models. CoRR, abs/2402.17463, 2024.

Anthropic. Claude 3.7 Sonnet, 2025. URL https://www.anthropic.com/news/claude-3-7-sonnet.

Jacob Austin, Augustus Odena, Maxwell I. Nye, Maarten Bosma, Henryk Michalewski, David Dohan, Ellen Jiang, Carrie J. Cai, Michael Terry, Quoc V. Le, and Charles Sutton. Program synthesis with large language models. CoRR, abs/2108.07732, 2021.

Jinze Bai, Shuai Bai, Yunfei Chu, Zeyu Cui, Kai Dang, Xiaodong Deng, Yang Fan, Wenbin Ge, Yu Han, Fei Huang, Binyuan Hui, Luo Ji, Mei Li, Junyang Lin, Runji Lin, Dayiheng Liu, Gao Liu, Chengqiang Lu, Keming Lu, Jianxin Ma, Rui Men, Xingzhang Ren, Xuancheng Ren, Chuanqi Tan, Sinan Tan, Jianhong Tu, Peng Wang, Shijie Wang, Wei Wang, Shengguang Wu, Benfeng Xu, Jin Xu, An Yang, Hao Yang, Jian Yang, Shusheng Yang, Yang Yao, Bowen Yu, Hongyi Yuan, Zheng Yuan, Jianwei Zhang, Xingxuan Zhang, Yichang Zhang, Zhenru Zhang, Chang Zhou, Jingren Zhou, Xiaohuan Zhou, and Tianhang Zhu. Qwen technical report. CoRR, abs/2309.16609, 2023.

Shuai Bai, Keqin Chen, Xuejing Liu, Jialin Wang, Wenbin Ge, Sibo Song, Kai Dang, Peng Wang, Shijie Wang, Jun Tang, et al. Qwen2.5-VL technical report. arXiv preprint arXiv:2502.13923, 2025.

Lucas Bandarkar, Davis Liang, Benjamin Muller, Mikel Artetxe, Satya Narayan Shukla, Donald Husa, Naman Goyal, Abhinandan Krishnan, Luke Zettlemoyer, and Madian Khabsa. The Belebele benchmark: A parallel reading comprehension dataset in 122 language variants. CoRR, abs/2308.16884, 2023.

Tom B. Brown, Benjamin Mann, Nick Ryder, Melanie Subbiah, Jared Kaplan, Prafulla Dhariwal, Arvind Neelakantan, Pranav Shyam, Girish Sastry, Amanda Askell, Sandhini Agarwal, Ariel Herbert-Voss, Gretchen Krueger, Tom Henighan, Rewon Child, Aditya Ramesh, Daniel Ziegler, Jeffrey Wu, Clemens Winter, Christopher Hesse, Mark Chen, Eric Sigler, Mateusz Litwin, Scott Gray, Benjamin Chess, Jack Clark, Christopher Berner, Sam McCandlish, Alec Radford, Ilya Sutskever, and Dario Amodei. Language models are few-shot learners. In NeurIPS, 2020.

Federico Cassano, John Gouwar, Daniel Nguyen, Sydney Nguyen, Luna Phipps-Costin, Donald Pinckney, Ming-Ho Yee, Yangtian Zi, Carolyn Jane Anderson, Molly Q. Feldman, Arjun Guha, Michael Greenberg, and Abhinav Jangda. MultiPL-E: A scalable and polyglot approach to benchmarking neural code generation. IEEE Trans. Software Eng., 49(7):3675–3691, 2023.

Mark Chen, Jerry Tworek, Heewoo Jun, Qiming Yuan, Henrique Ponde de Oliveira Pinto, Jared Kaplan, Harrison Edwards, Yuri Burda, Nicholas Joseph, Greg Brockman, Alex Ray, Raul Puri, Gretchen Krueger, Michael Petrov, Heidy Khlaaf, Girish Sastry, Pamela Mishkin, Brooke Chan, Scott Gray, Nick Ryder, Mikhail Pavlov, Alethea Power, Lukasz Kaiser, Mohammad Bavarian, Clemens Winter, Philippe Tillet, Felipe Petroski Such, Dave Cummings, Matthias Plappert, Fotios Chantzis, Elizabeth Barnes, Ariel Herbert-Voss, William Hebgen Guss, Alex Nichol, Alex Paino, Nikolas Tezak, Jie Tang, Igor Babuschkin, Suchir Balaji, Shantanu Jain, William Saunders, Christopher Hesse, Andrew N. Carr, Jan Leike, Joshua Achiam, Vedant Misra, Evan Morikawa, Alec Radford, Matthew Knight, Miles Brundage, Mira Murati, Katie Mayer, Peter Welinder, Bob McGrew, Dario Amodei, Sam McCandlish, Ilya Sutskever, and Wojciech Zaremba. Evaluating large language models trained on code. CoRR, abs/2107.03374, 2021.

Karl Cobbe, Vineet Kosaraju, Mohammad Bavarian, Mark Chen, Heewoo Jun, Lukasz Kaiser, Matthias Plappert, Jerry Tworek, Jacob Hilton, Reiichiro Nakano, Christopher Hesse, and John Schulman. Training verifiers to solve math word problems. CoRR, abs/2110.14168, 2021.

Damai Dai, Chengqi Deng, Chenggang Zhao, R. X. Xu, Huazuo Gao, Deli Chen, Jiashi Li, Wangding Zeng, Xingkai Yu, Y. Wu, Zhenda Xie, Y. K. Li, Panpan Huang, Fuli Luo, Chong Ruan, Zhifang Sui, and Wenfeng Liang. DeepSeekMoE: Towards ultimate expert specialization in mixture-of-experts language models. CoRR, abs/2401.06066, 2024.

Yann N. Dauphin, Angela Fan, Michael Auli, and David Grangier. Language modeling with gated convolutional networks. In ICML, volume 70 of Proceedings of Machine Learning Research, pp. 933–941. PMLR, 2017.

Google DeepMind. Gemini 2.5, 2025. URL https://blog.google/technology/google-deepmind/gemini-model-thinking-updates-march-2025/.

Mostafa Dehghani, Josip Djolonga, Basil Mustafa, Piotr Padlewski, Jonathan Heek, Justin Gilmer, Andreas Peter Steiner, Mathilde Caron, Robert Geirhos, Ibrahim Alabdulmohsin, Rodolphe Jenatton, Lucas Beyer, Michael Tschannen, Anurag Arnab, Xiao Wang, Carlos Riquelme Ruiz, Matthias Minderer, Joan Puigcerver, Utku Evci, Manoj Kumar, Sjoerd van Steenkiste, Gamaleldin Fathy Elsayed, Aravindh Mahendran, Fisher Yu, Avital Oliver, Fantine Huot, Jasmijn Bastings, Mark Collier, Alexey A. Gritsenko, Vighnesh Birodkar, Cristina Nader Vasconcelos, Yi Tay, Thomas Mensink, Alexander Kolesnikov, Filip Pavetic, Dustin Tran, Thomas Kipf, Mario Lucic, Xiaohua Zhai, Daniel Keysers, Jeremiah J. Harmsen, and Neil Houlsby. Scaling vision transformers to 22 billion parameters. In ICML, volume 202 of Proceedings of Machine Learning Research, pp. 7480–7512. PMLR, 2023.

Xinrun Du, Yifan Yao, Kaijing Ma, Bingli Wang, Tianyu Zheng, King Zhu, Minghao Liu, Yiming Liang, Xiaolong Jin, Zhenlin Wei, et al. SuperGPQA: Scaling LLM evaluation across 285 graduate disciplines. arXiv preprint arXiv:2502.14739, 2025.

Abhimanyu Dubey, Abhinav Jauhri, Abhinav Pandey, Abhishek Kadian, Ahmad Al-Dahle, Aiesha Letman, Akhil Mathur, Alan Schelten, Amy Yang, Angela Fan, Anirudh Goyal, Anthony Hartshorn, Aobo Yang, Archi Mitra, Archie Sravankumar, Artem Korenev, Arthur Hinsvark, Arun Rao, Aston Zhang, Aurelien Rodriguez, Austen Gregerson, Ava Spataru, Baptiste Roziere, Bethany Biron, Binh Tang, Bobbie Chern, Charlotte Caucheteux, Chaya Nayak, Chloe Bi, Chris Marra, Chris McConnell, Christian Keller, Christophe Touret, Chunyang Wu, Corinne Wong, Cristian Canton Ferrer, Cyrus Nikolaidis, Damien Allonsius, Daniel Song, Danielle Pintz, Danny Livshits, David Esiobu, Dhruv Choudhary, Dhruv Mahajan, Diego Garcia-Olano, Diego Perino, Dieuwke Hupkes, Egor Lakomkin, Ehab AlBadawy, Elina Lobanova, Emily Dinan, Eric Michael Smith, Filip Radenovic, Frank Zhang, Gabriel Synnaeve, Gabrielle Lee, Georgia Lewis Anderson, Graeme Nail, Gregoire Mialon, Guan Pang, Guillem Cucurell, Hailey Nguyen, Hannah Korevaar, Hu Xu, Hugo Touvron, Iliyan Zarov, Imanol Arrieta Ibarra, Isabel M. Kloumann, Ishan Misra, Ivan Evtimov, Jade Copet, Jaewon Lee, Jan Geffert, Jana Vranes, Jason Park, Jay Mahadeokar, Jeet Shah, Jelmer van der Linde, Jennifer Billock, Jenny Hong, Jenya Lee, Jeremy Fu, Jianfeng Chi, Jianyu Huang, Jiawen Liu, Jie Wang, Jiecao Yu, Joanna Bitton, Joe Spisak, Jongsoo Park, Joseph Rocca, Joshua Johnstun, Joshua Saxe, Junteng Jia, Kalyan Vasuden Alwala, Kartikeya Upasani, Kate Plawiak, Ke Li, Kenneth Heafield, Kevin Stone, and et al. The Llama 3 herd of models. CoRR, abs/2407.21783, 2024.

Simin Fan, Matteo Pagliardini, and Martin Jaggi. DoGE: Domain reweighting with generalization estimation. arXiv preprint arXiv:2310.15393, 2023.

Aryo Pradipta Gema, Joshua Ong Jun Leang, Giwon Hong, Alessio Devoto, Alberto Carlo Maria Mancino, Rohit Saxena, Xuanli He, Yu Zhao, Xiaotang Du, Mohammad Reza Ghasemi Madani, et al. Are we done with MMLU? CoRR, abs/2406.04127, 2024.

Alex Gu, Baptiste Roziere, Hugh Leather, Armando Solar-Lezama, Gabriel Synnaeve, and Sida Wang. CRUXEval: A benchmark for code reasoning, understanding and execution. arXiv preprint arXiv:2401.03065, 2024.

Daya Guo, Dejian Yang, Haowei Zhang, Junxiao Song, Ruoyu Zhang, Runxin Xu, Qihao Zhu, Shirong Ma, Peiyi Wang, Xiao Bi, et al. DeepSeek-R1: Incentivizing reasoning capability in LLMs via reinforcement learning. arXiv preprint arXiv:2501.12948, 2025.

Yun He, Di Jin, Chaoqi Wang, Chloe Bi, Karishma Mandyam, Hejia Zhang, Chen Zhu, Ning Li, Tengyu Xu, Hongjiang Lv, et al. Multi-IF: Benchmarking LLMs on multi-turn and multilingual instructions following. arXiv preprint arXiv:2410.15553, 2024.

Dan Hendrycks, Collin Burns, Steven Basart, Andy Zou, Mantas Mazeika, Dawn Song, and Jacob Steinhardt. Measuring massive multitask language understanding. In ICLR. OpenReview.net, 2021a.

Dan Hendrycks, Collin Burns, Saurav Kadavath, Akul Arora, Steven Basart, Eric Tang, Dawn Song, and Jacob Steinhardt. Measuring mathematical problem solving with the MATH dataset. In NeurIPS Datasets and Benchmarks, 2021b.

Cheng-Ping Hsieh, Simeng Sun, Samuel Kriman, Shantanu Acharya, Dima Rekesh, Fei Jia, Yang Zhang, and Boris Ginsburg. RULER: What's the real context size of your long-context language models? CoRR, abs/2404.06654, 2024.

Yuzhen Huang, Yuzhuo Bai, Zhihao Zhu, Junlei Zhang, Jinghan Zhang, Tangjun Su, Junteng Liu, Chuancheng Lv, Yikai Zhang, Jiayi Lei, Yao Fu, Maosong Sun, and Junxian He. C-Eval: A multilevel multi-discipline chinese evaluation suite for foundation models. In NeurIPS, 2023.

Binyuan Hui, Jian Yang, Zeyu Cui, Jiaxi Yang, Dayiheng Liu, Lei Zhang, Tianyu Liu, Jiajun Zhang, Bowen Yu, Keming Lu, et al. Qwen2.5-Coder technical report. CoRR, abs/2409.12186, 2024.

Naman Jain, King Han, Alex Gu, Wen-Ding Li, Fanjia Yan, Tianjun Zhang, Sida Wang, Armando Solar-Lezama, Koushik Sen, and Ion Stoica. LiveCodeBench: Holistic and contamination free evaluation of large language models for code. CoRR, abs/2403.07974, 2024.

Zixuan Jiang, Jiaqi Gu, Hanqing Zhu, and David Z. Pan. Pre-RMSNorm and Pre-CRMSNorm Transformers: Equivalent and efficient pre-LN Transformers. CoRR, abs/2305.14858, 2023.

Nathan Lambert, Jacob Morrison, Valentina Pyatkin, Shengyi Huang, Hamish Ivison, Faeze Brahman, Lester James V. Miranda, Alisa Liu, Nouha Dziri, Shane Lyu, Yuling Gu, Saumya Malik, Victoria Graf, Jena D. Hwang, Jiangjiang Yang, Ronan Le Bras, Oyvind Tafjord, Chris Wilhelm, Luca Soldaini, Noah A. Smith, Yizhong Wang, Pradeep Dasigi, and Hannaneh Hajishirzi. Tulu 3: Pushing frontiers in open language model post-training. CoRR, abs/2411.15124, 2024.

Tianle Li, Wei-Lin Chiang, Evan Frick, Lisa Dunlap, Tianhao Wu, Banghua Zhu, Joseph E. Gonzalez, and Ion Stoica. From crowdsourced data to high-quality benchmarks: Arena-Hard and BenchBuilder pipeline. CoRR, abs/2406.11939, 2024.

Hunter Lightman, Vineet Kosaraju, Yura Burda, Harri Edwards, Bowen Baker, Teddy Lee, Jan Leike, John Schulman, Ilya Sutskever, and Karl Cobbe. Let's verify step by step. CoRR, abs/2305.20050, 2023.

Bill Yuchen Lin, Ronan Le Bras, Kyle Richardson, Ashish Sabharwal, Radha Poovendran, Peter Clark, and Yejin Choi. ZebraLogic: On the scaling limits of LLMs for logical reasoning. CoRR, abs/2502.01100, 2025.

Aixin Liu, Bei Feng, Bing Xue, Bingxuan Wang, Bochao Wu, Chengda Lu, Chenggang Zhao, Chengqi Deng, Chenyu Zhang, Chong Ruan, et al. DeepSeek-V3 technical report. arXiv preprint arXiv:2412.19437, 2024a.

Jiawei Liu, Chunqiu Steven Xia, Yuyao Wang, and Lingming Zhang. Is your code generated by ChatGPT really correct? Rigorous evaluation of large language models for code generation. In NeurIPS, 2023a.

Qian Liu, Xiaosen Zheng, Niklas Muennighoff, Guangtao Zeng, Longxu Dou, Tianyu Pang, Jing Jiang, and Min Lin. RegMix: Data mixture as regression for language model pre-training. arXiv preprint arXiv:2407.01492, 2024b.

Xiao Liu, Xuanyu Lei, Shengyuan Wang, Yue Huang, Zhuoer Feng, Bosi Wen, Jiale Cheng, Pei Ke, Yifan Xu, Weng Lam Tam, Xiaohan Zhang, Lichao Sun, Hongning Wang, Jing Zhang, Minlie Huang, Yuxiao Dong, and Jie Tang. AlignBench: Benchmarking Chinese alignment of large language models. CoRR, abs/2311.18743, 2023b.

Meta-AI. The Llama 4 herd: The beginning of a new era of natively multimodal AI innovation, 2025. URL https://ai.meta.com/blog/llama-4-multimodal-intelligence/.

OpenAI. Hello GPT-4o, 2024. URL https://openai.com/index/hello-gpt-4o/.

OpenAI. Multilingual massive multitask language understanding, 2024. URL https://huggingface.co/datasets/openai/MMMLU.

OpenAI. Learning to reason with LLMs, 2024. URL https://openai.com/index/learning-to-reason-with-llms/.

OpenAI. Introducing openai o3 and o4-mini, 2025. URL https://openai.com/index/introducing-o3-and-o4-mini/.

Samuel J. Paech. Creative writing v3, 2024. URL https://eqbench.com/creative_writing.html.

Bowen Peng, Jeffrey Quesnelle, Honglu Fan, and Enrico Shippole. YaRN: Efficient context window extension of large language models. CoRR, abs/2309.00071, 2023.

Zihan Qiu, Zeyu Huang, Bo Zheng, Kaiyue Wen, Zekun Wang, Rui Men, Ivan Titov, Dayiheng Liu, Jingren Zhou, and Junyang Lin. Demons in the detail: On implementing load balancing loss for training specialized mixture-of-expert models. CoRR, abs/2501.11873, 2025.

Shanghaoran Quan, Jiaxi Yang, Bowen Yu, Bo Zheng, Dayiheng Liu, An Yang, Xuancheng Ren, Bofei Gao, Yibo Miao, Yunlong Feng, Zekun Wang, Jian Yang, Zeyu Cui, Yang Fan, Yichang Zhang, Binyuan Hui, and Junyang Lin. CodeElo: Benchmarking competition-level code generation of LLMs with human-comparable Elo ratings. CoRR, abs/2501.01257, 2025.

Qwen Team. QwQ: Reflect deeply on the boundaries of the unknown, November 2024. URL https://qwenlm.github.io/blog/qwq-32b-preview/.

Qwen Team. QwQ-32B: Embracing the power of reinforcement learning, March 2025. URL https://qwenlm.github.io/blog/qwq-32b/.

David Rein, Betty Li Hou, Asa Cooper Stickland, Jackson Petty, Richard Yuanzhe Pang, Julien Dirani, Julian Michael, and Samuel R. Bowman. GPQA: A graduate-level Google-proof Q&A benchmark. CoRR, abs/2311.12022, 2023.

Angelika Romanou, Negar Foroutan, Anna Sotnikova, Zeming Chen, Sree Harsha Nelaturu, Shivalika Singh, Rishabh Maheshwary, Micol Altomare, Mohamed A. Haggag, Snegha A, Alfonso Amayuelas, Azril Hafizi Amirudin, Viraat Aryabumi, Danylo Boiko, Michael Chang, Jenny Chim, Gal Cohen, Aditya Kumar Dalmia, Abraham Diress, Sharad Duwal, Daniil Dzenhaliou, Daniel Fernando Erazo Florez, Fabian Farestam, Joseph Marvin Imperial, Shayekh Bin Islam, Perttu Isotalo, Maral Jabbarishiviari, Borje F. Karlsson, Eldar Khalilov, Christopher Klamm, Fajri Koto, Dominik Krzeminski, Gabriel Adriano de Melo, Syrielle Montariol, Yiyang Nan, Joel Niklaus, Jekaterina Novikova, Johan Samir Obando Ceron, Debjit Paul, Esther Ploeger, Jebish Purbey, Swati Rajwal, Selvan Sunitha Ravi, Sara Rydell, Roshan Santhosh, Drishti Sharma, Marjana Prifti Skenduli, Arshia Soltani Moakhar, Bardia Soltani Moakhar, Ran Tamir, Ayush Kumar Tarun, Azmine Toushik Wasi, Thenuka Ovin Weerasinghe, Serhan Yilmaz, Mike Zhang, Imanol Schlag, Marzieh Fadaee, Sara Hooker, and Antoine Bosselut. INCLUDE: evaluating multilingual language understanding with regional knowledge. CoRR, abs/2411.19799, 2024.

Rico Sennrich, Barry Haddow, and Alexandra Birch. Neural machine translation of rare words with subword units. In ACL (1). The Association for Computer Linguistics, 2016.

Zhihong Shao, Peiyi Wang, Qihao Zhu, Runxin Xu, Junxiao Song, Mingchuan Zhang, Y. K. Li, Y. Wu, and Daya Guo. DeepSeekMath: Pushing the limits of mathematical reasoning in open language models. CoRR, abs/2402.03300, 2024.

Freda Shi, Mirac Suzgun, Markus Freitag, Xuezhi Wang, Suraj Srivats, Soroush Vosoughi, Hyung Won Chung, Yi Tay, Sebastian Ruder, Denny Zhou, Dipanjan Das, and Jason Wei. Language models are multilingual chain-of-thought reasoners. In ICLR. OpenReview.net, 2023.

Guijin Son, Jiwoo Hong, Hyunwoo Ko, and James Thorne. Linguistic generalizability of test-time scaling in mathematical reasoning. CoRR, abs/2502.17407, 2025.

Jianlin Su, Murtadha H. M. Ahmed, Yu Lu, Shengfeng Pan, Wen Bo, and Yunfeng Liu. Roformer: Enhanced Transformer with rotary position embedding. Neurocomputing, 568:127063, 2024.

Mirac Suzgun, Nathan Scales, Nathanael Scharli, Sebastian Gehrmann, Yi Tay, Hyung Won Chung, Aakanksha Chowdhery, Quoc V. Le, Ed H. Chi, Denny Zhou, and Jason Wei. Challenging BIG-Bench tasks and whether chain-of-thought can solve them. In ACL (Findings), pp. 13003–13051. Association for Computational Linguistics, 2023.

Gemma Team, Aishwarya Kamath, Johan Ferret, Shreya Pathak, Nino Vieillard, Ramona Merhej, Sarah Perrin, Tatiana Matejovicova, Alexandre Rame, Morgane Riviere, et al. Gemma 3 technical report. arXiv preprint arXiv:2503.19786, 2025.

Changhan Wang, Kyunghyun Cho, and Jiatao Gu. Neural machine translation with byte-level subwords. In AAAI, pp. 9154–9160. AAAI Press, 2020.

Yiming Wang, Pei Zhang, Jialong Tang, Haoran Wei, Baosong Yang, Rui Wang, Chenshu Sun, Feitong Sun, Jiran Zhang, Junxuan Wu, Qiqian Cang, Yichang Zhang, Fei Huang, Junyang Lin, Fei Huang, and Jingren Zhou. PolyMath: Evaluating mathematical reasoning in multilingual contexts, 2025.

Yubo Wang, Xueguang Ma, Ge Zhang, Yuansheng Ni, Abhranil Chandra, Shiguang Guo, Weiming Ren, Aaran Arulraj, Xuan He, Ziyan Jiang, Tianle Li, Max Ku, Kai Wang, Alex Zhuang, Rongqi Fan, Xiang Yue, and Wenhu Chen. MMLU-Pro: A more robust and challenging multi-task language understanding benchmark. CoRR, abs/2406.01574, 2024.

Colin White, Samuel Dooley, Manley Roberts, Arka Pal, Benjamin Feuer, Siddhartha Jain, Ravid Shwartz-Ziv, Neel Jain, Khalid Saifullah, Siddartha Naidu, Chinmay Hegde, Yann LeCun, Tom Goldstein, Willie Neiswanger, and Micah Goldblum. LiveBench: A challenging, contamination-free LLM benchmark. CoRR, abs/2406.19314, 2024.

Yuning Wu, Jiahao Mei, Ming Yan, Chenliang Li, Shaopeng Lai, Yuran Ren, Zijia Wang, Ji Zhang, Mengyue Wu, Qin Jin, and Fei Huang. WritingBench: A comprehensive benchmark for generative writing. CoRR, abs/2503.05244, 2025.

xAI. Grok 3 beta — the age of reasoning agents, 2025. URL https://x.ai/news/grok-3.

Sang Michael Xie, Hieu Pham, Xuanyi Dong, Nan Du, Hanxiao Liu, Yifeng Lu, Percy S Liang, Quoc V Le, Tengyu Ma, and Adams Wei Yu. Doremi: Optimizing data mixtures speeds up language model pretraining. Advances in Neural Information Processing Systems, 36:69798–69818, 2023.

Wenhan Xiong, Jingyu Liu, Igor Molybog, Hejia Zhang, Prajjwal Bhargava, Rui Hou, Louis Martin, Rashi Rungta, Karthik Abinav Sankararaman, Barlas Oguz, Madian Khabsa, Han Fang, Yashar Mehdad, Sharan Narang, Kshitiz Malik, Angela Fan, Shruti Bhosale, Sergey Edunov, Mike Lewis, Sinong Wang, and Hao Ma. Effective long-context scaling of foundation models. CoRR, abs/2309.16039, 2023.

Fanjia Yan, Huanzhi Mao, Charlie Cheng-Jie Ji, Tianjun Zhang, Shishir G. Patil, Ion Stoica, and Joseph E. Gonzalez. Berkeley function calling leaderboard. https://gorilla.cs.berkeley.edu/blogs/8_berkeley_function_calling_leaderboard.html, 2024.

An Yang, Baosong Yang, Binyuan Hui, Bo Zheng, Bowen Yu, Chang Zhou, Chengpeng Li, Chengyuan Li, Dayiheng Liu, Fei Huang, Guanting Dong, Haoran Wei, Huan Lin, Jialong Tang, Jialin Wang, Jian Yang, Jianhong Tu, Jianwei Zhang, Jianxin Ma, Jianxin Yang, Jin Xu, Jingren Zhou, Jinze Bai, Jinzheng He, Junyang Lin, Kai Dang, Keming Lu, Keqin Chen, Kexin Yang, Mei Li, Mingfeng Xue, Na Ni, Pei Zhang, Peng Wang, Ru Peng, Rui Men, Ruize Gao, Runji Lin, Shijie Wang, Shuai Bai, Sinan Tan, Tianhang Zhu, Tianhao Li, Tianyu Liu, Wenbin Ge, Xiaodong Deng, Xiaohuan Zhou, Xingzhang Ren, Xinyu Zhang, Xipin Wei, Xuancheng Ren, Xuejing Liu, Yang Fan, Yang Yao, Yichang Zhang, Yu Wan, Yunfei Chu, Yuqiong Liu, Zeyu Cui, Zhenru Zhang, Zhifang Guo, and Zhihao Fan. Qwen2 technical report. CoRR, abs/2407.10671, 2024a.

An Yang, Baosong Yang, Beichen Zhang, Binyuan Hui, Bo Zheng, Bowen Yu, Chengyuan Li, Dayiheng Liu, Fei Huang, Haoran Wei, et al. Qwen2.5 technical report. arXiv preprint arXiv:2412.15115, 2024b.

An Yang, Beichen Zhang, Binyuan Hui, Bofei Gao, Bowen Yu, Chengpeng Li, Dayiheng Liu, Jianhong Tu, Jingren Zhou, Junyang Lin, et al. Qwen2.5-Math technical report: Toward mathematical expert model via self-improvement. CoRR, abs/2409.12122, 2024c.

Yidan Zhang, Boyi Deng, Yu Wan, Baosong Yang, Haoran Wei, Fei Huang, Bowen Yu, Junyang Lin, and Jingren Zhou. P-MMEval: A parallel multilingual multitask benchmark for consistent evaluation of LLMs. CoRR, abs/2411.09116, 2024.

Jeffrey Zhou, Tianjian Lu, Swaroop Mishra, Siddhartha Brahma, Sujoy Basu, Yi Luan, Denny Zhou, and Le Hou. Instruction-following evaluation for large language models. CoRR, abs/2311.07911, 2023.
## 全文完

## 关联文件说明

- `03-Qwen3-mineru-en.md`：英文抽取底稿，用于核对章节结构、图表位置和术语原貌
- `05-Qwen3-Index.md`：技术入口页，概括双模式统一、蒸馏路线与工程边界
- `05-Qwen3-Architecture-Overview.md`：补充 dense / MoE、thinking budget 与后训练流程的架构分析
