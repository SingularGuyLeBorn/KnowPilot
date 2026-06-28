---
title: "Qwen Technical Report (MinerU 中文精译与译者注)"
source: 03-Qwen-mineru-en.md
source_pdf: pdfs/Qwen.pdf
date: 2026-05-23
---

# Qwen Technical Report 中文精译与译者注

>  **[返回 14.2-Qwen 家族总览](../../14.2-Qwen.md)**

## 原文标题说明

- 原文标题: Qwen Technical Report
- 原文作者: Qwen Team, Alibaba Group
- 原文来源: arXiv:2309.16609
- 逐译底稿: `03-Qwen-mineru-en.md`
- 关联精译: `01-Qwen技术报告精译.md`

## 分节结构

1. 摘要与模型家族定位
2. 引言: 从基座模型到 Agent 生态
3. 预训练: 数据、分词、架构与训练
4. 上下文长度扩展
5. 基座模型评测结果
6. 对齐: SFT、奖励模型与 RLHF
7. 工具使用、代码解释器与 Agent
8. Code-Qwen 与 Math-Qwen
9. 相关工作与结论
10. 附录要点

---

## 1. 摘要与模型家族定位

### 原文

Large language models (LLMs) have revolutionized the field of artificial intelligence, enabling natural language processing tasks that were previously thought to be exclusive to humans.

In this work, we introduce QWEN, the first installment of our large language model series. QWEN is a comprehensive language model series that encompasses distinct models with varying parameter counts.

It includes QWEN, the base pretrained language models, and QWEN-CHAT, the chat models finetuned with human alignment techniques.

### 译文

大语言模型已经深刻改变了人工智能领域，使许多过去被认为只有人类才能完成的自然语言处理任务成为可能。

本文介绍 Qwen，这是 Qwen 大语言模型系列的第一个版本。Qwen 不是单一模型，而是一组覆盖不同参数规模的模型体系。

该体系包含两条核心主线: 一条是作为基础能力底座的 Qwen 预训练语言模型，另一条是通过人类对齐技术微调得到的 Qwen-Chat 对话模型。

> 译者注: Qwen 1.0 的报告一开始就把它定义为“模型系列”而不是“单个模型”。这很关键，因为后文的 Code-Qwen、Math-Qwen、Qwen-VL 都是围绕同一个基座能力扩展出来的分支。对于工程落地而言，这种家族化布局意味着统一 tokenizer、统一对话格式和统一生态入口比单点 benchmark 更重要。

### 原文

The base language models consistently demonstrate superior performance across a multitude of downstream tasks, and the chat models, particularly those trained using Reinforcement Learning from Human Feedback (RLHF), are highly competitive.

The chat models possess advanced tool-use and planning capabilities for creating agent applications, showcasing impressive performance even when compared to bigger models on complex tasks like utilizing a code interpreter.

### 译文

基础语言模型在大量下游任务上持续表现优异。对话模型也具有很强竞争力，尤其是经过 RLHF 训练的版本。

这些对话模型具备较强的工具使用与规划能力，可以用于构建 Agent 应用。在代码解释器等复杂任务上，它们即使与更大模型相比也展现出令人印象深刻的效果。

> 译者注: 这里的重点不是简单宣称“聊天能力强”，而是把 Agent、工具使用、代码解释器纳入模型报告的主线。这说明 Qwen 1.0 的产品假设已经从纯文本问答扩展到“模型调用外部工具完成任务”。

---

## 2. 引言: 从基座模型到 Agent 生态

### 原文

LLMs are not just limited to language tasks. They can also function as a generalist agent, collaborating with external systems, tools, and models to achieve the objectives set by humans.

For example, LLMs can understand multimodal instructions, execute code, use tools, and more.

### 译文

大语言模型并不局限于语言任务。它们还可以作为通用智能体，与外部系统、工具和模型协作，完成由人类设定的目标。

例如，大语言模型可以理解多模态指令、执行代码、调用工具，并承担更多复合型任务。

### 原文

QWEN is a moniker that derives from the Chinese phrase Qianwen, which translates to "thousands of prompts" and conveys the notion of embracing a wide range of inquiries.

The model series include the base pretrained language models, chat models finetuned with human alignment techniques, as well as specialized models in coding and math.

### 译文

Qwen 这个名字来自中文“千问”，可以理解为“成千上万的问题或提示”，表达的是覆盖广泛查询与任务的含义。

Qwen 系列包括基础预训练语言模型、通过人类对齐技术微调得到的对话模型，以及面向代码和数学任务的专用模型。

![Qwen 系列模型谱系](./images/figure_01_qwen_model_lineage.jpg)

> 译者注: 图 1 的模型谱系说明了 Qwen 1.0 的产品架构: 基座模型提供通用能力，PMP/RM/RLHF 提供偏好对齐能力，Code/Math/VL 分支则面向垂直场景。这种结构后来成为 Qwen 系列持续扩展的重要基础。

---

## 3. 预训练: 数据、分词、架构与训练

### 3.1 数据

#### 原文

The pretraining stage involves learning vast amount of data to acquire a comprehensive understanding of the world and its various complexities.

Our dataset is designed to meet these requirements and includes public web documents, encyclopedia, books, codes, etc. Additionally, our dataset is multilingual, with a significant portion of the data being in English and Chinese.

#### 译文

预训练阶段通过学习海量数据，使模型获得对世界及其复杂性的综合理解。

Qwen 的预训练数据集覆盖公共网页文档、百科、书籍、代码等来源，并且是多语言数据集，其中英语和中文占据重要比例。

#### 原文

To ensure the quality of our pretraining data, we have developed a comprehensive data preprocessing procedure.

We employ deduplication techniques, including exact-match deduplication after normalization and fuzzy deduplication using MinHash and LSH algorithms.

#### 译文

为了保证预训练数据质量，Qwen 团队构建了完整的数据预处理流程。

该流程包括规范化后的精确匹配去重，以及基于 MinHash 和 LSH 的模糊去重。

> 译者注: 这部分反映出 Qwen 1.0 的核心竞争力很大程度来自数据工程。3T token 的规模本身重要，但更关键的是清洗、去重、质量评分、指令数据混入和 benchmark 去污染这些细节。

### 3.2 分词

#### 原文

The design of vocabulary significantly impacts the training efficiency and the downstream task performance.

We start with the open-source fast BPE tokenizer, tiktoken, and select the vocabulary cl100k base as our starting point.

To enhance the performance of our model on multilingual downstream tasks, particularly in Chinese, we augment the vocabulary with commonly used Chinese characters and words, as well as those in other languages.

#### 译文

词表设计会显著影响训练效率和下游任务表现。

Qwen 从开源高速 BPE 分词器 tiktoken 出发，并选择 cl100k base 作为初始词表。

为了增强模型在多语言任务，尤其是中文任务上的能力，团队向词表中补充了常用中文字、中文词和其他语言中的高频词项。

![分词压缩率对比](./images/chart_03_tokenizer_compression.jpg)

> 译者注: Qwen 1.0 使用约 152K 词表，这是一个明显偏工程化的选择。它会增加 embedding 与输出层成本，但可以显著改善中文和多语言文本的 token 压缩率。对于中文应用，压缩率提升会直接影响上下文容量和推理成本。

### 3.3 架构

#### 原文

QWEN is designed using a modified version of the Transformer architecture. Specifically, we have adopted the recent open-source approach of training large language models, LLaMA.

Our modifications to the architecture include untied embedding, RoPE positional embedding, QKV bias, Pre-Norm and RMSNorm, and SwiGLU activation.

#### 译文

Qwen 采用修改版 Transformer 架构。具体来说，它以当时开源大语言模型中的代表架构 LLaMA 为基础。

Qwen 的主要架构调整包括: 非绑定 embedding、RoPE 位置编码、注意力 QKV 层偏置、Pre-Norm 与 RMSNorm，以及 SwiGLU 激活函数。

#### 原文

Based on preliminary experimental findings, we have opted for the untied embedding approach instead of tying the weights of input embedding and output projection.

For most layers, we remove biases following PaLM, but we add biases in the QKV layer of attention to enhance the extrapolation ability of the model.

#### 译文

基于初步实验结果，Qwen 选择不绑定输入 embedding 与输出投影权重，而不是采用共享权重方案。

对于大多数层，Qwen 遵循 PaLM 的做法移除偏置项，但在注意力的 QKV 层保留偏置，以增强模型的外推能力。

> 译者注: 这是一组“保守但有取舍”的架构决策。Qwen 没有在基础 Transformer 上做高风险创新，而是在词表、embedding 绑定、RoPE 精度、QKV bias 等细节上做工程优化。这种策略适合第一代开源基座模型: 优先稳定训练和可靠复现。

### 3.4 训练

#### 原文

We follow the standard autoregressive language modeling approach described in GPT. This involves training the model to predict the next token based on the context provided by the preceding tokens.

We use 2048 context length for training our models. To improve computational efficiency and reduce memory usage, we apply Flash Attention in the attention module.

#### 译文

Qwen 遵循 GPT 系列中的标准自回归语言建模方式，即根据前文 token 预测下一个 token。

模型训练时采用 2048 的上下文长度。为了提升计算效率并降低显存占用，注意力模块中使用了 Flash Attention。

---

## 4. 上下文长度扩展

### 原文

Transformer models have a significant limitation in the context length of their attention mechanisms. In this work, we implement simple training-free techniques that only apply at inference to extend the context length of our models.

One of the key techniques we use is NTK-aware interpolation. To further improve performance, we also implement a simple extension named dynamic NTK-aware interpolation.

### 译文

Transformer 模型在注意力机制的上下文长度上存在显著限制。本文采用一组只在推理阶段使用、无需额外训练的技术来扩展模型上下文长度。

其中一项关键技术是 NTK-aware 插值。为了进一步提升效果，团队还实现了 dynamic NTK-aware 插值，即动态 NTK 感知插值。

### 原文

We further incorporate two other attention mechanisms, LogN-Scaling and window attention. The former rescales the dot product of query and value by a factor depending on the ratio of the context length to the training length.

For window attention, we assign different window sizes for each layer, using shorter windows for lower layers and longer windows for higher layers.

### 译文

Qwen 还进一步引入 LogN-Scaling 和 window attention 两种注意力机制。前者根据当前上下文长度与训练长度的比例重新缩放注意力相关的点积项。

对于 window attention，Qwen 为不同层分配不同窗口大小: 较低层使用较短窗口，较高层使用较长窗口。

> 译者注: 这是 Qwen 1.0 报告中最值得工程复用的部分之一。它没有重新训练长上下文模型，而是通过 RoPE 插值、注意力缩放和分层窗口组合，在推理阶段缓解训练长度限制。其优点是成本低、上线快; 局限是原生长上下文建模能力仍受训练长度制约。

---

## 5. 基座模型评测结果

### 原文

To assess the zero-shot and few-shot learning capabilities of our models, we have conducted comprehensive benchmark evaluations using a range of datasets.

Our evaluation covers MMLU, C-Eval, GSM8K, MATH, HumanEval, MBPP, and BBH.

### 译文

为了评估模型的零样本和少样本学习能力，Qwen 团队在一系列数据集上进行了全面基准评测。

评测覆盖 MMLU、C-Eval、GSM8K、MATH、HumanEval、MBPP 和 BBH 等任务。

### 原文

Our experimental results demonstrate that all three QWEN models exhibit superior performance across all downstream tasks. Notably, even the significantly larger LLAMA2-70B model is surpassed by QWEN-14B in three tasks.

### 译文

实验结果显示，三个规模的 Qwen 模型在所有下游任务上都表现突出。尤其值得注意的是，参数规模显著更大的 LLaMA2-70B 在三个任务上被 Qwen-14B 超越。

![Qwen-14B 与 GPT-4、GPT-3.5 及 13B SOTA 对比](./images/chart_02_qwen_14b_radar.jpg)

> 译者注: Qwen-14B 在 C-Eval 和数学、代码相关任务上的表现尤其突出。结合前文的数据策略，可以推断中文数据、代码数据、数学数据和指令混入共同构成了这一代模型的优势来源。

---

## 6. 对齐: SFT、奖励模型与 RLHF

### 6.1 监督微调

#### 原文

The initial step is supervised fine-tuning, or SFT, which fine-tunes the pretrained LLMs on chat-style data containing queries and responses.

To ensure that the model can generalize to a wide range of scenarios, we intentionally exclude data formatted with prompt templates that could limit the model's capabilities.

#### 译文

对齐的第一步是监督微调，也就是在包含查询和回复的对话式数据上微调预训练大语言模型。

为了保证模型能够泛化到更广泛场景，团队有意排除了可能限制模型能力的模板化提示数据。

#### 原文

We adopt ChatML formatting, a versatile meta-language capable of describing the metadata of turns, such as role, and content.

#### 译文

Qwen 采用 ChatML 格式。它是一种可以描述对话轮次元信息的通用元语言，例如角色和内容。

> 译者注: ChatML 是 Qwen 系列长期沿用的关键格式资产。它把 system、user、assistant 等角色边界显式编码出来，减少模型把对话控制符误当普通文本的概率。

### 6.2 奖励模型与 RLHF

#### 原文

This process involves training reward models and performing policy training using Proximal Policy Optimization (PPO).

In creating the reward model, we use the language model QWEN of the same size for initialization. We add a pooling layer to the original QWEN model to extract the reward of the sentence based on a particular ending token.

#### 译文

RLHF 流程包括训练奖励模型，并使用 PPO 进行策略训练。

在构建奖励模型时，团队使用相同规模的 Qwen 语言模型进行初始化，并在原始 Qwen 模型上增加一个 pooling 层，根据特定结束 token 提取句子级奖励值。

#### 原文

In the PPO process, we adopt the strategy of sampling two responses for each query at a time. We set the KL divergence coefficient to 0.04 and normalize the reward based on the running mean.

Additionally, we implement pretrained gradients to mitigate the alignment tax.

#### 译文

在 PPO 过程中，Qwen 对每个 query 一次采样两个回复。团队将 KL 散度系数设为 0.04，并基于运行均值对奖励进行归一化。

此外，Qwen 引入预训练梯度来缓解对齐税，也就是避免模型在对齐人类偏好时过度损伤预训练阶段获得的通用能力。

> 译者注: “预训练梯度”可以理解为 RLHF 过程中的能力锚点。PPO 优化人类偏好，但如果没有足够约束，模型可能牺牲知识、数学或代码能力。混入预训练梯度，本质上是在偏好优化和基础能力保持之间做正则化。

---

## 7. 工具使用、代码解释器与 Agent

### 原文

The QWEN models, which are designed to be versatile, have the remarkable ability to assist with automating daily tasks by leveraging their skills in tool-use and planning.

We explore QWEN's proficiency in utilizing unseen tools through ReAct prompting, using a Python code interpreter, and functioning as an agent that accesses Hugging Face's multimodal models.

### 译文

Qwen 模型被设计为具备通用性，可以借助工具使用和规划能力辅助自动化日常任务。

报告重点考察了三个方向: 通过 ReAct 提示使用未见过的工具、调用 Python 代码解释器，以及作为访问 Hugging Face 多模态模型的 Agent。

### 原文

Table 6 reports the performance of QWEN on the in-house Chinese benchmark that evaluates its ability to use unseen tools via ReAct prompting.

### 译文

表 6 展示了 Qwen 在内部中文基准上的表现，该基准评估模型通过 ReAct 提示使用未见工具的能力。

![聊天模型人工评估胜率](./images/chart_04_chat_model_winrate.jpg)

> 译者注: Qwen-7B 在工具选择准确率上达到很高水平，说明工具调用并不完全依赖模型参数规模。对于 Agent 产品，工具 schema、提示格式、调用监督数据和错误恢复能力往往与模型规模同等重要。

### 原文

CODE LLAMA underperforms on visualization tasks because it hallucinates non-existent columns solely based on CSV file names.

QWEN creates a two-step plan and first investigates the columns present in the CSV file before proceeding to draw the plot.

### 译文

Code Llama 在可视化任务中表现较弱，因为它会仅根据 CSV 文件名幻觉出不存在的列。

Qwen 则会制定两步计划: 先检查 CSV 文件中真实存在的列，再继续绘制图表。

![Qwen 代码解释器案例](./images/figure_05_code_interpreter_qwen_plan.jpg)

---

## 8. Code-Qwen 与 Math-Qwen

### 8.1 Code-Qwen

#### 原文

We introduce CODE-QWEN, which includes CODE-QWEN-7B and CODE-QWEN-14B, as well as their chat models.

We continue to pre-train the base language models on a dataset consisting of around 90B tokens of code data, which covers multiple programming languages.

#### 译文

报告介绍了 Code-Qwen，包括 Code-Qwen-7B、Code-Qwen-14B 以及它们对应的对话模型。

团队在约 90B token 的代码数据上继续预训练基础语言模型，该数据覆盖多种编程语言。

#### 原文

For CODE-QWEN-CHAT, we apply multi-stage supervised fine-tuning, which includes training on general instruction data and then on code-related conversational data.

#### 译文

对于 Code-Qwen-Chat，团队采用多阶段监督微调: 先使用通用指令数据训练，再使用代码相关对话数据训练。

> 译者注: Code-Qwen 的路线不是从零训练一个代码模型，而是在通用基座上做代码继续预训练和代码对话微调。这保留了通用推理能力，也降低了训练成本。

### 8.2 Math-Qwen

#### 原文

MATH-QWEN-CHAT is trained through supervised fine-tuning on math-related instruction data.

To avoid teaching the model to repeat user prompts, we mask the loss of user inputs and only optimize the output answer.

#### 译文

Math-Qwen-Chat 通过数学相关指令数据进行监督微调。

为了避免模型学习重复用户提示，训练时会 mask 用户输入部分的损失，只优化模型输出答案。

### 原文

The results show that MATH-QWEN-CHAT outperforms open-source models of the same size by large margins and approaches GPT-3.5 on GSM8K and MATH.

### 译文

结果显示，Math-Qwen-Chat 在相同规模的开源模型中大幅领先，并且在 GSM8K 和 MATH 上接近 GPT-3.5。

---

## 9. 相关工作与结论

### 原文

In this report, we present the QWEN series of large language models, which showcase the latest advancements in natural language processing.

With 14B, 7B, and 1.8B parameters, these models have been pre-trained on massive amounts of data, including trillions of tokens, and fine-tuned using cutting-edge techniques such as SFT and RLHF.

### 译文

本文介绍了 Qwen 系列大语言模型，展示了自然语言处理领域的最新进展。

这些模型覆盖 14B、7B 和 1.8B 参数规模，在数万亿 token 级别的数据上完成预训练，并使用 SFT 和 RLHF 等技术进行微调。

### 原文

We believe that the open access of QWEN will foster collaboration and innovation within the community, enabling researchers and developers to build upon our work.

### 译文

团队认为，开放 Qwen 将促进社区协作与创新，使研究者和开发者能够在此基础上继续构建新的研究和应用。

> 译者注: 从历史定位看，Qwen 1.0 的价值不只在于单次性能排名，而在于建立了中文优先、多语言覆盖、工具调用、代码、数学、多模态并行推进的开源模型路线。

---

## 10. 附录要点

### 原文

Different from conventional pretraining based on autoregressive next-token prediction, despite using a similar training task, there should be a specially designed data format for SFT and RLHF to build a conversational AI assistant model.

Instead, we turned to the ChatML format proposed by OpenAI. This format allows the use of special tokens that do not appear in pretraining.

### 译文

与传统基于自回归下一个 token 预测的预训练不同，即使训练任务形式类似，构建对话式 AI 助手时仍需要为 SFT 和 RLHF 设计专门的数据格式。

因此，Qwen 转向采用 ChatML 格式。该格式允许使用预训练文本中不会自然出现的特殊 token，从而更清楚地区分对话角色和内容边界。

### 原文

The appendix provides more details on automatic evaluation, human evaluation, and the analysis of code interpreter.

### 译文

附录进一步给出自动评测、人类评测和代码解释器案例分析等细节。

> 译者注: 当前 MinerU D3 中附录人类评测表存在部分 OCR 断字和表格碎片，但主体章节、关键表格、图像引用和模型方法脉络已经可读。对于交付链而言，D4 负责给出可读中文闭环，D5 负责抽象出工程问题和适用边界。

---

## 关联文件说明

| 文件 | 作用 |
|---|---|
| `01-Qwen技术报告精译.md` | 既有完整中文精译稿，可作为连续阅读版本 |
| `03-Qwen-mineru-en.md` | MinerU 英文底稿，已检查 frontmatter、标题层级、表格可读性和图片引用 |
| `04-Qwen-mineru-zh.md` | 本文件，按 MinerU 底稿重建中文精译与译者注 |
| `05-Qwen-Architecture-Overview.md` | D5 技术专题，分析 Qwen 架构、数据、长上下文和历史定位 |
| `05-Qwen-Index.md` | D5 阅读入口，已增强为非纯索引 |

全文完
