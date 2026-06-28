---
title: "GLM-4 技术报告 MinerU 逐段翻译"
source: 03-GLM-4-mineru-en.md
translated_by: "AI Agent"
date: 2026-05-23
---

# GLM-4 技术报告 MinerU 逐段翻译

>  **[返回 14.6-GLM 家族总览](../../14.6-GLM.md)**

> 原文标题: ChatGLM: A Family of Large Language Models from GLM-130B to GLM-4 All Tools
> 翻译基于: MinerU 英文提取稿 `03-GLM-4-mineru-en.md`
> 原始 PDF: `pdfs/ChatGLM-Family-GLM-4-All-Tools.pdf`
> 关联专题: `05-GLM-4-Architecture-Overview.md`

---

## 分节结构

- Abstract
- 1 Introduction
- 2 ChatGLM Techniques
- 3 GLM-4 Capabilities
- 4 Safety and Risks
- 5 Conclusion
- References

---

## Abstract

**原文**:
We introduce ChatGLM, an evolving family of large language models that we have been developing over time. This report primarily focuses on the GLM-4 language series, which includes GLM-4, GLM-4-Air, and GLM-4-9B. They represent our most capable models that are trained with all the insights and lessons gained from the preceding three generations of ChatGLM.

**译文**:
我们介绍 ChatGLM，这是一个持续演进的大语言模型家族，也是团队长期迭代开发的模型系列。本报告主要聚焦 GLM-4 语言模型系列，包括 GLM-4、GLM-4-Air 和 GLM-4-9B。它们代表了团队当前能力最强的一组模型，训练过程中吸收了前三代 ChatGLM 积累的全部经验、失败教训和工程洞察。

**原文**:
To date, the GLM-4 models are pre-trained on ten trillions of tokens mostly in Chinese and English, along with a small set of corpus from 24 languages, and aligned primarily for Chinese and English usage. The high-quality alignment is achieved via a multi-stage posttraining process, which involves supervised fine-tuning and learning from human feedback.

**译文**:
截至报告发布时，GLM-4 系列模型已经在约 10 万亿 token 上完成预训练，语料主要由中文和英文构成，同时包含来自 24 种语言的少量数据; 模型对齐也主要围绕中文和英文使用场景展开。高质量对齐通过多阶段后训练流程实现，其中包括监督微调以及基于人类反馈的学习。

**原文**:
Evaluations show that GLM-4 closely rivals or outperforms GPT-4 in terms of general metrics, gets close to GPT-4-Turbo in instruction following, matches GPT-4 Turbo and Claude 3 for long context tasks, and outperforms GPT-4 in Chinese alignments.

**译文**:
评测显示，GLM-4 在 MMLU、GSM8K、MATH、BBH、GPQA 和 HumanEval 等通用指标上已经接近或超过 GPT-4; 在 IFEval 衡量的指令遵循能力上接近 GPT-4-Turbo; 在长上下文任务上匹配 GPT-4 Turbo 与 Claude 3; 在 AlignBench 衡量的中文对齐能力上则超过 GPT-4。

**原文**:
The GLM-4 All Tools model is further aligned to understand user intent and autonomously decide when and which tool(s) to use, including web browser, Python interpreter, text-to-image model, and user-defined functions, to effectively complete complex tasks.

**译文**:
GLM-4 All Tools 版本进一步针对工具使用进行了对齐，使模型能够理解用户意图，并自主判断何时调用哪些工具，包括网页浏览器、Python 解释器、文生图模型以及用户自定义函数，从而完成更复杂的任务。

> 译者注: 摘要里的关键不只是“GLM-4 接近 GPT-4”，而是智谱把 ChatGLM 的小模型迭代、GLM-4 的双语通用能力、All Tools 的工具调用能力放在同一条演化链上说明。GLM-4 在这篇报告中既是模型，也是一个把预训练、对齐、长上下文和 Agent 能力串起来的平台节点。

---

## 1 Introduction

**原文**:
The rapid development of large language models has been phenomenal. The GPT series shows that scaling from GPT-1 and GPT-2 to GPT-3 enables in-context learning and generalized capabilities, while GPT-3.5 further improves the model through instruction tuning, supervised fine-tuning, and reinforcement learning from human feedback.

**译文**:
大语言模型的发展速度极其惊人。以 GPT 系列为例，从 GPT-1、GPT-2 扩展到 GPT-3，参数规模的大幅提升带来了上下文学习和更强的泛化能力; 而 GPT-3.5 又进一步通过指令调优、监督微调以及基于人类反馈的强化学习提升了模型表现。这套流程后来成为构建高性能 LLM 的标准做法。

**原文**:
In a parallel line to the popularly adopted LLM development practices, we proposed the General Language Model architecture featured with the autoregressive blank infilling objective and open-sourced the GLM-10B model in 2021.

**译文**:
与主流 LLM 开发路线并行，团队提出了 General Language Model 架构，其特点是采用自回归空白填充目标，并在 2021 年开源了 GLM-10B 模型。

**原文**:
Starting in late 2021, we began pre-training GLM-130B. The goal was to train a 100B-scale model to match or surpass GPT-3 while also verifying the techniques for successfully training models at this scale.

**译文**:
从 2021 年末开始，团队启动 GLM-130B 的预训练。目标是在百亿以上参数规模上训练出能够匹配或超越 GPT-3 的模型，同时验证在这一规模上稳定训练模型所需的关键技术。

**原文**:
After GLM-130B, we initiated instruction tuning. ChatGPT further motivated us to align the base models with SFT and RLHF. On March 14, 2023, ChatGLM-130B went live, and the smaller ChatGLM-6B was open-sourced on the same day.

**译文**:
在 GLM-130B 之后，团队开始进行指令调优。ChatGPT 的出现进一步推动团队使用 SFT 和 RLHF 对齐基础模型。2023 年 3 月 14 日，对齐后的 ChatGLM-130B 上线，同一天更小的 ChatGLM-6B 也开源发布。

**原文**:
ChatGLM-6B was designed to facilitate fast iteration of pre- and post-training techniques and to enable local deployment on consumer-grade graphics cards using INT4 quantization. Since then, the team rapidly refined pre-training and alignment techniques, releasing second and third generations every other three months.

**译文**:
ChatGLM-6B 被设计成一个便于快速迭代预训练与后训练技术的模型，同时可以通过 INT4 量化部署在消费级显卡上。此后，团队快速探索并优化预训练和对齐技术，几乎每三个月推出一代新的 ChatGLM 系列，而且第二代和第三代都是从头预训练得到的。

**原文**:
With lessons accumulated from earlier generations, we kicked off the training of GLM-4. It was developed into GLM-4 and GLM-4 All Tools, both supporting a 128K context length. The latest GLM-4 (0520) and GLM-4-Air (0605) upgraded both pre-training and alignment.

**译文**:
在吸收前三代模型经验后，团队启动 GLM-4 的训练。GLM-4 后来发展成 GLM-4 与 GLM-4 All Tools 两个版本，二者都支持 128K 上下文长度。最新的 GLM-4 (0520) 与 GLM-4-Air (0605) 在预训练和对齐方面都进行了升级，其中 GLM-4-Air 以更低延迟和更低推理成本获得接近 GLM-4 (0116) 的表现。

**原文**:
Following the three generations of open ChatGLM-6B models, we also released GLM-4-9B with 128K and 1M context length. It is pre-trained on approximately ten trillion multilingual tokens and post-trained with the same pipeline and data used for GLM-4 (0520).

**译文**:
在三代开源 ChatGLM-6B 模型之后，团队还开源发布了 GLM-4-9B，包括 128K 与 1M 上下文版本。GLM-4-9B 在约 10T 多语言 token 上预训练，并使用与 GLM-4 (0520) 相同的流水线和数据完成后训练。

> 译者注: GLM 家族的特殊之处在于“小模型先行”。6B 级模型让团队能快速验证数据配方、对齐策略和部署反馈，再把有效经验迁移到更强模型。这条路线与只发布旗舰闭源模型的做法不同，它把社区反馈也纳入模型迭代回路。

---

## 2 ChatGLM Techniques

**原文**:
In this section, we introduce both the pre- and post-training techniques we adopted and developed in ChatGLM, including the model architecture, pre-training data, alignment, and All Tools.

**译文**:
本节介绍 ChatGLM 中采用和发展出来的预训练与后训练技术，包括模型架构、预训练数据、对齐方法以及 All Tools 系统。

### 2.1 Pre-Training Data

**原文**:
The pre-training corpus consists of multilingual documents from webpages, Wikipedia, books, code, and research papers. The data processing pipeline mainly includes deduplication, filtering, and tokenization.

**译文**:
预训练语料由多语言文档组成，来源包括网页、Wikipedia、书籍、代码和研究论文。数据处理流水线主要包括去重、过滤和分词三个阶段。

**原文**:
To optimize token efficiency, the team employs byte-level BPE to separately learn Chinese and multilingual tokens and merges them with the cl100k_base tokenizer into a unified vocabulary with 150,000 tokens.

**译文**:
为了提升 token 效率，团队使用 byte-level BPE 分别学习中文 token 与多语言 token，并将它们与 tiktoken 中的 cl100k_base 词表合并，形成一个规模为 150,000 的统一词表。

**原文**:
The final training set re-weights different sources to increase the importance of high-quality and educational sources like books and Wikipedia. The corpus consists of around ten trillion tokens.

**译文**:
最终训练集中，不同来源的数据会被重新加权，以提高书籍、Wikipedia 等高质量和教育性语料的权重。整体预训练语料规模约为 10 万亿 token。

> 译者注: 150K 统一词表的意义不只是“词表更大”。对于需要同时理解中文用户意图、英文代码、API 文档和网页内容的模型，统一词表能减少跨语言表征割裂，是中文对齐与工具调用能够结合的底层条件之一。

### 2.2 Architecture

**原文**:
The GLM family is built on Transformer. In GLM-130B, the team explored DeepNorm, RoPE, and gated linear units with GeLU to stabilize training under hardware constraints.

**译文**:
GLM 家族建立在 Transformer 架构之上。在 GLM-130B 中，团队曾在硬件约束下探索 DeepNorm、RoPE 以及带 GeLU 激活的门控线性单元，以稳定大规模预训练。

**原文**:
The recent GLM-4 model removes most bias terms except QKV bias, adopts RMSNorm and SwiGLU, extends RoPE into a two-dimensional form, and replaces MHA with GQA to reduce KV cache size.

**译文**:
最新的 GLM-4 模型采用了几个关键架构选择：除 QKV 矩阵中的 bias 外移除大多数 bias 项; 使用 RMSNorm 和 SwiGLU; 将 RoPE 扩展为二维形式，以适配 GLM 的二维位置编码; 并用 Group Query Attention 取代 Multi-Head Attention，从而降低推理阶段的 KV cache 占用。

**原文**:
Because GQA uses fewer parameters than MHA, the team increases the FFN parameter count to keep the model size, setting the FFN dimension to 10/3 of the hidden size.

**译文**:
由于 GQA 相比 MHA 使用更少参数，团队将节省出的参数预算补偿到 FFN 中，以维持总体模型规模。因此 GLM-4 将 FFN 维度设为隐藏维度的 10/3。

**原文**:
The context length expands from 2K in ChatGLM to 32K in ChatGLM2 and ChatGLM3, then to 128K and 1M in GLM-4 through position extension, continual training on long text, and long-context alignment.

**译文**:
模型上下文长度从 ChatGLM 的 2K 扩展到 ChatGLM2/3 的 32K，再扩展到 GLM-4 的 128K 和 1M。这个过程依赖位置编码扩展、长文本持续训练以及长上下文对齐。

> 译者注: 这里的 GQA 与 FFN 补偿是很典型的工程权衡。GQA 主要节省 KV cache 和内存带宽，FFN 扩容则把参数预算转移到前馈层。它并不是单纯“更省”，而是在长上下文推理场景下优先降低内存瓶颈。

### 2.3 Alignment

**原文**:
Pre-training builds the foundation while post-training aligns models with human preferences. For GLM-4, alignment is mostly achieved with SFT and RLHF.

**译文**:
预训练构建模型基础能力，后训练则进一步将模型对齐到人类偏好。对于 GLM-4，对齐主要通过 SFT 和 RLHF 实现。

**原文**:
Authentic human prompts and interactions are vital to alignment quality. SFT largely aligns the base model, while RLHF further mitigates response rejection, safety, bilingual token mixing, and multi-turn coherence issues.

**译文**:
真实的人类提示和交互对对齐质量至关重要。SFT 可以在很大程度上把基座模型对齐到人类偏好，而 RLHF 能进一步缓解拒答、安全性、中英文混杂生成以及多轮连贯性等问题。

**原文**:
For later models, alignment data combines in-house annotation and proprietary third-party data under strict quality control. Annotators score responses across safety, factuality, relevance, helpfulness, and human preference.

**译文**:
在后续模型中，对齐数据由内部标注和来自第三方的专有数据组合而成，并经过严格质量控制。标注者会从安全性、事实性、相关性、有用性和人类偏好等维度评价模型回复。

### 2.4 ChatGLM Techniques and Benchmarks

**原文**:
Throughout ChatGLM development, the team introduced techniques including LongAlign, ChatGLM-Math, ChatGLM-RLHF, Self-Contrast, AgentTuning, and APAR, and built benchmarks including AgentBench, LongBench, AlignBench, HumanEval-X, and NaturalCodeBench.

**译文**:
在 ChatGLM 的发展过程中，团队提出和沉淀了多项技术，包括 LongAlign、ChatGLM-Math、ChatGLM-RLHF、Self-Contrast、AgentTuning 和 APAR; 同时也建设了 AgentBench、LongBench、AlignBench、HumanEval-X 和 NaturalCodeBench 等评测基准。

**原文**:
LongAlign provides a recipe for long-context alignment; ChatGLM-Math uses self-critique for math problem solving; Self-Contrast creates preference data without expensive human feedback; AgentTuning improves agent capabilities with high-quality interaction trajectories.

**译文**:
LongAlign 提供长上下文对齐方案; ChatGLM-Math 使用自我批判改进数学问题求解; Self-Contrast 在不依赖昂贵人类偏好反馈的情况下构建对齐数据; AgentTuning 则利用高质量的 Agent 与环境交互轨迹提升模型的 Agent 能力。

> 译者注: 这一节说明 GLM-4 不是孤立模型，而是建立在一组方法和评测基础设施上的产物。LongAlign、Self-Contrast、AgentTuning 这些工作分别对应长上下文、反馈数据成本和工具/环境交互三个核心瓶颈。

### 2.5 GLM-4 All Tools

**原文**:
GLM-4 All Tools is further aligned to support intelligent agents. It is trained to autonomously understand user intent, plan complex instructions, and call one or multiple tools such as web browser, Python interpreter, and text-to-image model.

**译文**:
GLM-4 All Tools 是进一步面向智能 Agent 对齐的版本。它被训练成能够自主理解用户意图、规划复杂指令，并调用一个或多个工具，例如网页浏览器、Python 解释器和文生图模型。

**原文**:
When a user issues a complex request, the model analyzes the task and plans the problem-solving process step by step. If it cannot complete the task independently, it sequentially calls external tools and uses intermediate feedback to solve the task.

**译文**:
当用户提出复杂请求时，模型会分析任务，并逐步规划求解流程。如果模型判断自己无法独立完成任务，就会顺序调用一个或多个外部工具，并利用中间反馈与执行结果继续推进任务。

**原文**:
Built on GLM-4's all-tools capabilities, the GLMs application platform allows users to create and customize their own agents with Python interpreter, web browser, text-to-image model, user-defined functions, APIs, and external knowledge bases.

**译文**:
基于 GLM-4 的 All Tools 能力，GLMs 应用平台允许用户创建和定制自己的 Agent。这些 Agent 不仅支持内置 Python 解释器、网页浏览器和文生图模型，还支持用户自定义函数、API 以及外部知识库。

---

## 3 GLM-4 Capabilities

**原文**:
The report evaluates GLM-4 from base capacity, code problem-solving, agent abilities, instruction following, long context in Chinese and English, and Chinese alignment. Results are primarily reported for GLM-4 (0520) and GLM-4-Air (0605).

**译文**:
报告从基础能力、代码问题求解、Agent 能力、指令遵循、中英文长上下文以及中文对齐等角度评估 GLM-4。结果主要报告 GLM-4 (0520) 与 GLM-4-Air (0605)，因为 GLM-4 (0520) 在各项评测上较早期的 0116 版本略有提升。

**原文**:
Overall, GLM-4 gets close to state-of-the-art models across standard benchmarks, instruction following, long context, code problem solving, and English agent abilities. For Chinese alignment, it shows strong performance across fundamental language ability, advanced Chinese understanding, professional knowledge, and open-ended QA.

**译文**:
总体来看，GLM-4 在标准基准、指令遵循、长上下文、代码问题求解以及英文环境中的 Agent 能力上接近当时最强模型。对于中文对齐，它在基础语言能力、高级中文理解、专业知识和开放问答等方面都表现很强。

### 3.1 Evaluation of Academic Benchmarks

**原文**:
The team selects six commonly used benchmarks: MMLU, GSM8K, MATH, BBH, GPQA, and HumanEval. GLM-4 achieves 96.3% of GPT-4's MMLU accuracy and outperforms GPT-4 on several other benchmarks; overall base capacity approaches GPT-4-Turbo and Claude 3 Opus.

**译文**:
团队选择了六个常用学术基准：MMLU、GSM8K、MATH、BBH、GPQA 和 HumanEval。GLM-4 在 MMLU 上达到 GPT-4 准确率的 96.3%，并在若干其他基准上超过原始 GPT-4; 整体基础能力接近 GPT-4-Turbo 与 Claude 3 Opus。

**表格译文**:
Table 2 显示 GLM-4 (0520) 在 MMLU 上为 83.3，在 GSM8K 上为 93.3，在 MATH 上为 61.3，在 BBH 上为 84.7，在 GPQA 上为 39.9，在 HumanEval 上为 78.5。GLM-4-Air (0605) 则以更低成本取得 81.9 MMLU、90.9 GSM8K 与 75.7 HumanEval。

### 3.2 Evaluation of Instruction Following

**原文**:
The team evaluates instruction following with IFEval in English and Chinese. In loose mode, GLM-4 matches GPT-4 Turbo at instruction-level accuracy in both languages. In strict mode, it reaches 99.0% and 98.6% of GPT-4 Turbo (2024-04-09)'s instruction-level accuracy in English and Chinese.

**译文**:
团队使用 IFEval 在英文和中文环境下评估指令遵循能力。在 loose 模式下，GLM-4 在两种语言的 instruction-level 准确率上都追平 GPT-4 Turbo。在 strict 模式下，它分别达到 GPT-4 Turbo (2024-04-09) 英文和中文 instruction-level 准确率的 99.0% 与 98.6%。

**表格译文**:
Table 3 对比了 prompt-level 与 instruction-level 的 loose/strict 准确率。GLM-4 (0520) 在英文 L-I 上为 88.7、S-I 为 85.0，在中文 L-I 上为 84.2、S-I 为 78.0，说明其可验证指令遵循能力已经非常接近闭源前沿模型。

### 3.3 Evaluation of Alignment

**原文**:
AlignBench benchmarks Chinese alignment using a GPT-4 based multidimensional rule-calibrated pointwise reference-based scoring method. On AlignBench-v1.1, GLM-4 achieves the highest overall score among baselines and performs especially well on Chinese logic reasoning and language understanding.

**译文**:
AlignBench 使用基于 GPT-4 的多维规则校准参考评分方法评估中文对齐能力。在 AlignBench-v1.1 上，GLM-4 在对比模型中获得最高总分，并且在中文逻辑推理与语言理解任务上表现尤其突出。

**表格译文**:
Table 4 中 GLM-4 (0520) 的 overall 为 8.00，Math 为 7.89，Logic 为 7.95，Language 为 8.00，Professional 为 8.47。报告指出其主要短板仍在数学维度，与 GPT-4 Turbo (2024-04-09) 的 8.32 相比存在差距。

> 译者注: AlignBench 使用 GPT-4 作为评判器，因此“中文对齐超越 GPT-4”需要谨慎解读。但即便考虑评判器偏差，GLM-4 在中文逻辑、语言理解和专业知识上的表现仍然说明它不是简单英文模型的中文迁移，而是对中文使用场景做过深度优化。

### 3.4 Evaluation of Long Context Handling Abilities

**原文**:
The team evaluates long-context performance on LongBench-Chat, with context lengths from 10K to 100K and tasks including document QA, summarization, and coding. Results are split into Chinese and English portions.

**译文**:
团队在 LongBench-Chat 上评估长上下文能力，任务上下文长度覆盖 10K 到 100K，并包括文档问答、摘要和代码等场景。为了更细粒度地观察跨语言能力，报告将结果拆分为中文和英文两部分。

**原文**:
GLM-4 aligns with GPT-4 Turbo and Claude 3 Opus on English prompts and outperforms the best of them on Chinese prompts.

**译文**:
结果显示，GLM-4 在英文 prompt 上与 GPT-4 Turbo 和 Claude 3 Opus 处于同一水平; 在中文 prompt 上，则超过所有对比模型。

**表格译文**:
Table 5 中 GLM-4 (0520) 英文得分为 87.3，中文得分为 84.0。Claude 3 Opus 为 87.7/82.7，GPT-4 Turbo (2024-04-09) 为 85.0/82.1。GLM-4 的中文长上下文优势是这篇报告最重要的产品化信号之一。

### 3.5 Evaluation of Coding Abilities on Real-world User Prompts

**原文**:
Because HumanEval mostly contains introductory algorithms and may suffer from data contamination, the team also evaluates GLM-4 on NaturalCodeBench, a bilingual coding benchmark derived from real user prompts.

**译文**:
由于 HumanEval 主要包含入门算法题，并且可能存在训练数据污染问题，团队还在 NaturalCodeBench 上评估 GLM-4。NaturalCodeBench 是一个源自真实用户提示的双语代码基准，更能反映真实世界编程任务的复杂性。

**原文**:
GLM-4 has coding performance close to Claude 3 Opus in practical scenarios, while still showing gaps compared with GPT-4 models.

**译文**:
在实际编程场景中，GLM-4 的代码表现接近 Claude 3 Opus，但与 GPT-4 系列相比仍有明显差距。报告认为，由于 GLM-4 的双语平衡特性，后续通过更好的训练策略和数据筛选仍有提升空间。

### 3.6 Evaluation of Function Call

**原文**:
The team evaluates function calling with the Berkeley Function Call Leaderboard, which assesses AST matching, API execution, and relevance detection. GLM-4 (0520) aligns with GPT-4 Turbo (2024-04-09), while GLM-4-9B-Chat significantly outperforms Llama-3-8B-Instruct.

**译文**:
团队使用 Berkeley Function Call Leaderboard 评估函数调用能力，该基准从 AST 匹配、API 执行和相关性检测三个维度检查模型表现。GLM-4 (0520) 的函数调用能力与 GPT-4 Turbo (2024-04-09) 接近，而 GLM-4-9B-Chat 明显超过 Llama-3-8B-Instruct。

**表格译文**:
Table 7 中 GLM-4 (0520) 的 Overall 为 81.76，GLM-4-9B-Chat 为 81.00，GPT-4 Turbo (2024-04-09) 为 81.24。一个值得注意的现象是，整体函数调用准确率并不总是随模型规模单调提升，但执行摘要能力会随模型规模更平滑地提升。

### 3.7 Evaluation of Agent Abilities

**原文**:
The team evaluates GLM-4 on AgentBench, covering text-based agent environments such as operating system, database, knowledge graph, lateral thinking puzzles, household, web shopping, and web browsing.

**译文**:
团队在 AgentBench 上评估 GLM-4，覆盖文本型 Agent 环境，包括操作系统、数据库、知识图谱、横向思维谜题、家务任务、网页购物和网页浏览。

**原文**:
GLM-4 outperforms GPT-4 Turbo and Claude 3 Opus overall, performs especially well on database, household, and web shopping tasks, and still lags behind GPT-4 on operating system, knowledge graph, and lateral thinking puzzles.

**译文**:
GLM-4 在总体分数上超过 GPT-4 Turbo 与 Claude 3 Opus，在数据库、家务任务和网页购物中表现尤其好; 但在操作系统、知识图谱和横向思维谜题等环境中仍落后于 GPT-4 系列。

### 3.8 Evaluation of All Tools

**原文**:
GLM-4 All Tools can autonomously understand user intent, plan step-by-step instructions, and call multiple tools including web browser, Python interpreter, and text-to-image model. Table 9 shows performance comparable to GPT-4 Web on Python interpreter math tasks and browser information seeking.

**译文**:
GLM-4 All Tools 能够自主理解用户意图、逐步规划指令，并调用网页浏览器、Python 解释器和文生图模型等多个工具。Table 9 显示，它在 Python 解释器数学任务和浏览器信息检索任务上与 GPT-4 Web 具备可比表现。

**表格译文**:
Table 9 中，GLM-4 All Tools 在 PythonInterpreter-GSM8K 上为 91.59，对比 GPT-4 Web 的 92.72; 在 MATH 上为 63.60，对比 65.00; 在 Math23K 上为 88.50，对比 88.40; 在 Browser Information Seeking 上为 78.08，超过 GPT-4 Web 的 67.12。

> 译者注: GLM-4 All Tools 的重点不是“会调用工具”这个接口能力，而是模型被训练成能在多步骤任务里决定是否需要工具、调用什么工具、如何吸收中间反馈。这是从聊天模型走向 Agent 系统的关键转折。

---

## 4 Safety and Risks

**原文**:
The team is committed to ensuring that GLM-4 operates as a safe, responsible, and unbiased model. In pre-training, sensitive keywords and blacklisted webpages are removed; in alignment, each training sample is evaluated for safety and risky samples are removed.

**译文**:
团队强调要确保 GLM-4 作为安全、负责任且尽量无偏的模型运行。在预训练阶段，团队会移除包含敏感关键词的文本和黑名单网页; 在对齐阶段，每个训练样本都会被评估安全性，并移除有潜在风险的样本。

**原文**:
Harmlessness is an important criterion for preference alignment. A red team constantly challenges the model with tricky questions that tend to cause unsafe answers, and harmful question-answer pairs from GLM-4 are improved with human annotation for further alignment.

**译文**:
无害性也是偏好对齐中的重要标准。团队维护红队持续用容易诱导不安全回答的问题挑战模型，并收集 GLM-4 产生的有害问答对，再通过人工标注改进这些样本，用于后续模型对齐。

**原文**:
SafetyBench evaluates ethics and morality, illegal activities, mental health, offensiveness, physical health, privacy and property, and unfairness and bias. GLM-4 achieves competitive safety performance and is comparable with Claude 3 Opus, but slightly behind the GPT-4 family.

**译文**:
SafetyBench 从伦理道德、违法活动、心理健康、冒犯性、身体健康、隐私与财产、不公平与偏见七个维度评估模型安全性。GLM-4 在多数维度上具备竞争力，整体表现与 Claude 3 Opus 接近，但略低于 GPT-4 系列。

**表格译文**:
Table 10 中 GLM-4 (0520) Overall 为 87.2，Claude 3 Opus 为 87.5，GPT-4 Turbo (2024-04-09) 为 87.9。GLM-4 在 Physical Health 与 Unfairness & Bias 上仍有明显改进空间。

---

## 5 Conclusion

**原文**:
The report introduces the ChatGLM family from GLM-130B to GLM-4 All Tools. Over the past one and a half years, the team made progress in understanding LLMs from first-hand experiences and learned more effective strategies for pre-training and alignment.

**译文**:
报告介绍了从 GLM-130B 到 GLM-4 All Tools 的 ChatGLM 大语言模型家族。在过去一年半中，团队通过一手训练与部署经验加深了对大语言模型的理解，并逐步学习到更有效的预训练与对齐策略。

**原文**:
Recent ChatGLM models, including GLM-4 (0116, 0520), GLM-4-Air (0605), and GLM-4 All Tools, show significant advancements in understanding and executing complex tasks by autonomously employing external tools and functions.

**译文**:
近期的 ChatGLM 模型，包括 GLM-4 (0116, 0520)、GLM-4-Air (0605) 与 GLM-4 All Tools，在理解和执行复杂任务方面取得显著进展，尤其体现在自主使用外部工具和函数的能力上。

**原文**:
The team is committed to promoting accessibility and safety of LLMs through open release of model weights and techniques. The open models have attracted over 10 million downloads on Hugging Face in 2023. Future work will continue democratizing cutting-edge LLM technologies through open source.

**译文**:
团队承诺通过开放模型权重和相关技术来提升 LLM 的可访问性与安全性。其开源模型仅在 2023 年就在 Hugging Face 获得超过 1000 万次下载。未来团队会继续通过开源推进前沿 LLM 技术的普及，并推动模型能力向“让机器像人一样思考”的目标前进。

> 译者注: 结论部分再次回到“开源”与“平台化”的组合。GLM-4 的产品价值来自强中文对齐、长上下文和 All Tools，而其社区价值来自持续开源小模型、方法与评测基准。这两条线共同构成了 ChatGLM 家族的长期竞争力。

---

## References

**原文**:
The reference list includes work on LongAlign, LongBench, GPT-3, HumanEval, positional interpolation, PaLM, GSM8K, FlashAttention, CogView, GLM, DeepNorm, CogVLM, AgentTuning, GLM-130B, OPT, NaturalCodeBench, SafetyBench, LLM surveys, CodeGeeX, CogView3, LIMA, CharacterGLM, and IFEval.

**译文**:
参考文献覆盖了 GLM-4 技术栈相关的主要来源，包括长上下文对齐与评测、基础大模型、代码评测、位置编码扩展、FlashAttention、图像生成与视觉语言模型、Agent 训练、GLM-130B、函数调用、自然代码基准、安全评测、CharacterGLM 和 IFEval 等。由于参考文献主要用于溯源，本译文不逐条翻译作者列表，而保留英文 D3 中的完整引用。

---

## 全文完

## 关联文件说明

| 文件 | 作用 |
| --- | --- |
| [03-GLM-4-mineru-en.md](./03-GLM-4-mineru-en.md) | MinerU 英文提取稿(D3) |
| [01-GLM-4 技术报告精译.md](./01-GLM-4技术报告精译.md) | D2 中文精译主稿 |
| [02-GLM-4 核心架构剖析.md](./02-GLM-4核心架构剖析.md) | D2 架构剖析 |
| [05-GLM-4-Index.md](./05-GLM-4-Index.md) | D5 技术入口 |
| [05-GLM-4-Architecture-Overview.md](./05-GLM-4-Architecture-Overview.md) | D5 架构专题 |
| [images/](./images/) | 论文插图 |
