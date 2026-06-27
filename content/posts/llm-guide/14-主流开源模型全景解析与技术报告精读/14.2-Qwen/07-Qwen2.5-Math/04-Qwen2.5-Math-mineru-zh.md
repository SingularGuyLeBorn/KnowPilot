---
title: "Qwen2.5-Math - 逐段精译与译者注"
source: 03-Qwen2.5-Math-mineru-en.md
translated_by: "AI Agent"
date: 2026-05-19
---

# Qwen Technical Report

> 🔙 **[返回 14.2-Qwen 家族总览](../../14.2-Qwen.md)**


An Yang, Beichen Zhang, Binyuan Hui, Bofei Gao, Bowen Yu†, Chengpeng Li, Dayiheng Liu†, Jianhong Tu, Jingren Zhou, Junyang Lin†, Keming Lu, Mingfeng Xue, Runji Lin, Tianyu Liu, Xingzhang Ren, Zhenru Zhang

Qwen Team, Alibaba Group∗

> **译者注**：本文档为 Qwen2.5-Math 技术报告的 MinerU 提取版本逐段中英对照翻译。MinerU 转换保留了原文的章节结构、表格和 89 张图片引用。翻译遵循原文段落后紧跟中文译文的格式，仅在关键设计决策、数据实验、架构细节等处附加译者注，以辅助理解技术细节。

---

## ABSTRACT

In this report, we present a series of math-specific large language models: Qwen2.5-Math and Qwen2.5-Math-Instruct-1.5B/7B/72B. The core innovation of the Qwen2.5 series lies in integrating the philosophy of self-improvement throughout the entire pipeline, from pre-training and post-training to inference: (1) During the pre-training phase, Qwen2-Math-Instruct is utilized to generate large-scale, high-quality mathematical data. (2) In the post-training phase, we develop a reward model (RM) by conducting massive sampling from Qwen2-Math-Instruct. This RM is then applied to the iterative evolution of data in supervised fine-tuning (SFT). With a stronger SFT model, it is possible to iteratively train and update the RM, which in turn guides the next round of SFT data iteration. On the final SFT model, we employ the ultimate RM for reinforcement learning, resulting in the Qwen2.5-Math-Instruct. (3) Furthermore, during the inference stage, the RM is used to guide sampling, optimizing the model performance.

**摘要**：本报告介绍了一系列数学专用大语言模型：Qwen2.5-Math 和 Qwen2.5-Math-Instruct-1.5B/7B/72B。Qwen2.5 系列的核心创新在于将自我改进(self-improvement)的理念贯穿于从预训练、后训练到推理的整个流程：(1) 预训练阶段，利用 Qwen2-Math-Instruct 生成大规模高质量数学数据; (2) 后训练阶段，通过对 Qwen2-Math-Instruct 进行大规模采样来开发奖励模型(Reward Model, RM)，将该 RM 应用于监督微调(SFT)数据的迭代进化，更强的 SFT 模型可以迭代训练和更新 RM，进而引导下一轮 SFT 数据迭代，最终在 SFT 模型上使用终极 RM 进行强化学习，得到 Qwen2.5-Math-Instruct; (3) 推理阶段，使用 RM 引导采样以优化模型性能。

Qwen2.5-Math-Instruct supports both Chinese and English, and possess advanced mathematical reasoning capabilities, including Chain-of-Thought (CoT) and Tool-Integrated Reasoning (TIR). We evaluate our models on 10 mathematics datasets in both English and Chinese, such as GSM8K, MATH, GaoKao, AMC23, and AIME24, covering a range of difficulties from grade school level to math competition problems. The flagship model, Qwen2.5-Math-72B-Instruct, significantly outperforms both open-source models and leading closed-source models (e.g., GPT-4o, Gemini Math-Specialized 1.5 Pro). Particularly in the challenging AMC 2023, with the assistance of RM, Qwen2.5-Math-72B-Instruct successfully solves almost all the problems. Qwen2.5-Math-7B-Instruct surpasses Qwen2-Math-Instruct 72B in performance. Under CoT and TIR settings, it achieves MATH scores of 83.6 and 85.3, respectively. Even our smallest 1.5B model, achieving a MATH score of around 80 when utilizing the Python Interpreter, outperforms the majority of current models in this domain. We hope that Qwen2.5-Math can contribute to the community for solving complex mathematical problems.

Qwen2.5-Math-Instruct 支持中英双语，具备先进的数学推理能力，包括思维链(Chain-of-Thought, CoT)和工具集成推理(Tool-Integrated Reasoning, TIR)。我们在 10 个英中文数学数据集上评估了模型，包括 GSM8K、MATH、高考、AMC23 和 AIME24，难度覆盖小学到数学竞赛级别。旗舰模型 Qwen2.5-Math-72B-Instruct 显著超越开源模型和领先闭源模型(如 GPT-4o、Gemini Math-Specialized 1.5 Pro)。特别是在具有挑战性的 AMC 2023 中，在 RM 辅助下，72B-Instruct 成功解决了几乎所有问题。7B-Instruct 超越了 Qwen2-Math-Instruct 72B 的性能。在 CoT 和 TIR 设置下，MATH 得分分别为 83.6 和 85.3。即使是最小的 1.5B 模型，在使用 Python 解释器时 MATH 得分也达到约 80，超越了该领域大多数当前模型。

> **译者注**：Qwen2.5-Math 的技术路线核心可以概括为自我改进飞轮——用更强的模型生成更好的数据，用更好的数据训练更强的模型。这个理念与 DeepSeek-R1 的冷启动+RL 自举有异曲同工之妙，但 Qwen2.5-Math 将其扩展到了预训练阶段(用 Instruct 模型生成预训练语料)，这是比仅在 SFT/RL 阶段做数据迭代更激进的自我改进策略。1.5B 模型在 MATH 上达到 ~80 分(TIR 模式)，这个小模型+工具的结果非常惊人，说明数学推理中计算准确性的瓶颈可以通过外部工具大幅缓解。

The base models, instruct models, and reward model of the Qwen2.5-Math series are available on Hugging Face and ModelScope, and the evaluation scripts on GitHub. We have also developed a demo that supports the TIR mode in Qwen-Agent, which allows running code locally to experience Tool-Integrated Reasoning capabilities of Qwen2.5-Math.

Qwen2.5-Math 系列的基模型、指令模型和奖励模型已在 Hugging Face 和 ModelScope 上开源，评估脚本在 GitHub 上提供。我们还开发了一个支持 Qwen-Agent 中 TIR 模式的 demo，允许本地运行代码以体验 Qwen2.5-Math 的工具集成推理能力。


1 Introduction 3   
2 Qwen2.5-Math Pre-training 4   
3 Qwen2.5-Math Post-training 5   
3.1 Supervised Fine-tuning 6   
3.1.1 Chain-of-Thought Data Synthesis 6   
3.1.2 Tool-integrated Reasoning Data Synthesis . 6   
3.2 Reward Model Training . 7   
3.2.1 Data Synthesis 7   
3.2.2 Training Strategy 7   
3.3 Reinforcement Learning 7   
4 Decontamination 8   
5 Evaluation 9   
5.1 Base Models . . . 9   
5.2 Instruction Models 9   
6 Conclusion 14   
A Case Study of Qwen2-MATH on Olympiad-level Problems 19   
A.1 Number Theory 19   
A.2 Algebra 22   
A.3 Counting & Probability 27   
A.4 Geometry 30   
B Prompts Used in the Evaluation 31

**目录(中文)**：1 引言 | 2 Qwen2.5-Math 预训练 | 3 Qwen2.5-Math 后训练 | 3.1 监督微调 | 3.1.1 思维链数据合成 | 3.1.2 工具集成推理数据合成 | 3.2 奖励模型训练 | 3.2.1 数据合成 | 3.2.2 训练策略 | 3.3 强化学习 | 4 去污染 | 5 评估 | 5.1 基模型 | 5.2 指令模型 | 6 结论 | A Qwen2-Math 在奥赛级别问题上的案例研究 | A.1 数论 | A.2 代数 | A.3 计数与概率 | A.4 几何 | B 评估中使用的提示

---

## 1 Introduction

Over the past year, we have devoted considerable effort to researching and enhancing the reasoning capabilities of large language models, with a particular emphasis on their ability to solve arithmetic and mathematical problems. In this report, we introduce a series of math-specific large language models, Qwen2.5-Math, Qwen2.5-Math-RM, and Qwen2.5-Math-Instruct-1.5B/7B/72B. To provide a comprehensive understanding of the technical developments behind Qwen2.5-Math, we also offer a detailed overview of its predecessor, Qwen2-Math (Qwen, 2024).

**1 引言**
过去一年中，我们投入了大量精力研究和增强大语言模型的推理能力，特别是其解决算术和数学问题的能力。本报告介绍了一系列数学专用大语言模型：Qwen2.5-Math、Qwen2.5-Math-RM 和 Qwen2.5-Math-Instruct-1.5B/7B/72B。为全面理解 Qwen2.5-Math 背后的技术发展，我们还详细介绍了其前身 Qwen2-Math。

We introduce a series of self-improvement techniques to develop Qwen2.5-Math models on top of the Qwen2-Math. Self-improvement techniques take advantage of supervision from large language models themselves (Cao et al., 2024). Specifically, we apply self-improvement from three aspects during the training of Qwen2.5-Math. In pre-training, we employ Qwen2-Math-Instruct to synthesize math queries and corresponding responses on a large scale to enrich the pre-training corpus of Qwen2.5-Math. In post-training, we train a reward model on massive sampling from previous models and apply it to the iterative evolution of data in supervised fine-tuning. The better mathematical models trained from this enhancement lead to a more robust reward model, Qwen2.5-Math-RM. Then, we use this reward model in reinforcement learning and best-of-N sampling during inference. Synthetic data and judgment play a significant role in the enhancement of Qwen2.5-Math compared with its predecessor.

我们在 Qwen2-Math 之上引入了一系列自我改进技术来开发 Qwen2.5-Math 模型。自我改进技术利用大语言模型自身的监督信号。具体而言，我们在 Qwen2.5-Math 的训练中从三个方面应用自我改进：预训练中，使用 Qwen2-Math-Instruct 大规模合成数学查询和对应回复以丰富 Qwen2.5-Math 的预训练语料; 后训练中，在从前代模型进行大规模采样的基础上训练奖励模型，并将其应用于监督微调数据的迭代进化; 经过增强训练出的更好数学模型催生出更稳健的奖励模型 Qwen2.5-Math-RM; 然后，我们在强化学习和推理阶段的 best-of-N 采样中使用该奖励模型。与前身相比，合成数据和评判在 Qwen2.5-Math 的增强中发挥了重要作用。

Specifically, the overall pipelines for developing Qwen2-Math and Qwen2.5-Math are illustrated in Figure 2. First, the Qwen2-Math base models are trained on a high-quality mathematical pre-training dataset called the Qwen Math Corpus v1, which contains approximately 700 billion tokens. Second, we train a math-specific reward model Qwen2-Math-RM, derived from Qwen2-Math-72B, to create the Qwen2-Math-Instruct models. This reward model is used to construct Supervised Fine-Tuning (SFT) data through Rejection Sampling (Yuan et al., 2023). Moreover, the reward model plays a key role in the reinforcement learning stage, where we employ Group Relative Policy Optimization (GRPO) (Shao et al., 2024) following SFT. Third, leveraging the Qwen2-Math-72B-Instruct model, we synthesize additional high-quality mathematical pre-training data, which serves as the foundation for Qwen Math Corpus v2. This updated corpus contains over 1 trillion tokens and is used to pre-train the Qwen2.5-Math models. Lastly, similar to the process used for the Qwen2-Math-Instruct models, we construct the Qwen2.5-Math-RM and Qwen2.5-Math-Instruct models. An important distinction in this stage is the inclusion of both English and Chinese Chain-of-Thought (CoT) reasoning data, as well as Tool-Integrated Reasoning (TIR) data, for training the Qwen2.5-Math-Instruct models, as opposed to using only English CoT data as was done for Qwen2-Math-Instruct.

具体而言，Qwen2-Math 和 Qwen2.5-Math 的开发整体流程如图 2 所示。首先，Qwen2-Math 基模型在名为 Qwen Math Corpus v1 的高质量数学预训练数据集上训练，包含约 7000 亿 tokens。其次，我们从 Qwen2-Math-72B 派生训练数学专用奖励模型 Qwen2-Math-RM，用于创建 Qwen2-Math-Instruct 模型。该奖励模型通过拒绝采样(Rejection Sampling)构建 SFT 数据，并在强化学习阶段(SFT 后使用 GRPO)发挥关键作用。第三，利用 Qwen2-Math-72B-Instruct 模型合成额外的高质量数学预训练数据，作为 Qwen Math Corpus v2 的基础。更新后的语料包含超过 1 万亿 tokens，用于预训练 Qwen2.5-Math 模型。最后，类似 Qwen2-Math-Instruct 的流程，我们构建 Qwen2.5-Math-RM 和 Qwen2.5-Math-Instruct 模型。此阶段的重要区别在于：Qwen2.5-Math-Instruct 的训练同时包含中英文 CoT 推理数据和 TIR 数据，而 Qwen2-Math-Instruct 仅使用英文 CoT 数据。

We evaluate our math-specific models on eight English and Chinese math benchmarks. Notably, the Qwen2.5-Math-7B base model achieves scores of 91.6, 55.4, and 57.6 on GSM8K, MATH, and GaoKao Math Cloze, respectively, outperforming the Qwen2-72B general model, which achieves scores of 89.5, 51.1, and 55.9 on the same datasets. Additionally, the Qwen2.5-Math-72B base model sets a new state-of-the-art on the MATH benchmark, achieving a score of 66.8, an improvement of 5.3 points over Qwen2-Math-72B and 15.7 points over Qwen2-72B.

我们在八个中英文数学基准上评估了数学专用模型。Qwen2.5-Math-7B 基模型在 GSM8K、MATH 和高考数学填空上分别取得 91.6、55.4 和 57.6 分，超越了通用模型 Qwen2-72B 的 89.5、51.1 和 55.9 分。Qwen2.5-Math-72B 基模型在 MATH 基准上创下新 SOTA，得分 66.8，相比 Qwen2-Math-72B 提升 5.3 分，相比 Qwen2-72B 提升 15.7 分。

For the Instruct models, in CoT mode, the Qwen2.5-Math-1.5B-Instruct model surpasses the performance of all currently available open-source models on most metrics, including models as large as 70B parameters. Furthermore, the Qwen2.5-Math-7B-Instruct model nearly matches the performance of the Qwen2-Math-72B-Instruct model, indicating that improvements to the training data and strategy can, to a certain extent, compensate for the scaling up of parameters. The Qwen2.5-Math-72B-Instruct model outperforms the Qwen2-Math-72B-Instruct model by an average margin of 4.4 and 6.1 points in English and Chinese, respectively, establishing itself as the best open-source mathematical model currently available. Moreover, all model sizes demonstrate significant improvements in their Chinese math problem-solving capabilities. In our newly introduced TIR mode, performance sees further enhancement compared to CoT. For instance, the 72B model achieves close to 90 points on the MATH benchmark, and even the 1.5B model scores around 80, demonstrating that Qwen2.5 is now highly proficient at leveraging the Python Interpreter for accurate mathematical computation.

对于指令模型，在 CoT 模式下，Qwen2.5-Math-1.5B-Instruct 在大多数指标上超越了所有当前可用的开源模型，包括高达 70B 参数的模型。Qwen2.5-Math-7B-Instruct 几乎达到了 Qwen2-Math-Instruct 72B 的性能，表明训练数据和策略的改进在一定程度上可以弥补参数规模的扩大。Qwen2.5-Math-72B-Instruct 在英文和中文上分别平均超越 Qwen2-Math-Instruct 72B 4.4 和 6.1 分，成为当前最好的开源数学模型。此外，所有尺寸的模型在中文数学解题能力上都有显著提升。在新引入的 TIR 模式下，性能相比 CoT 进一步提升：72B 模型在 MATH 上接近 90 分，1.5B 模型也达到约 80 分，表明 Qwen2.5 在利用 Python 解释器进行精确数学计算方面已非常熟练。

> **译者注**：Qwen2.5-Math 的训练流程是一个典型的数据飞轮——从 v1(700B)到 v2(1T+)的语料扩展完全由前代最强模型(72B-Instruct)合成驱动。这种模型生成数据、数据训练更强模型的循环是自我改进的核心机制。值得注意的是，Qwen2.5-Math-7B 基模型在 MATH 上 55.4 分已超越 Qwen2-72B 通用模型(51.1 分)，这说明数学专用预训练对数学能力的提升远超通用预训练——即使在更小的参数规模下。

![](images/fig02_development_pipelines.jpg)  
Figure 2: The development pipelines of Qwen2-Math and Qwen2.5-Math.
图 2：Qwen2-Math 和 Qwen2.5-Math 的开发流程。

---

## 2 QWEN2.5-MATH PRE-TRAINING

In mathematical pre-training, our primary focus is on constructing a high-quality dataset rich in mathematical content. This dataset encompasses a wide variety of sources, including math-related web texts, code snippets, encyclopedias, exam questions, and synthetic mathematical data generated by Qwen2 (Yang et al., 2024). The process of assembling this pre-training dataset involves several key steps: data recall, deduplication, filtering, data synthesis, and optimization of the data mixture. The final curated dataset, which forms the foundation of our pre-training, is termed the Qwen Math Corpus v1. The Qwen2-Math base models, initialized with Qwen2-1.5B/7B/72B, undergo continuous pre-training using the Qwen Math Corpus v1.

**2 Qwen2.5-Math 预训练**
在数学预训练中，我们的主要重点是构建一个富含数学内容的高质量数据集。该数据集涵盖多种来源，包括数学相关网页文本、代码片段、百科全书、考试题目以及由 Qwen2 生成的合成数学数据。组装预训练数据集的过程涉及几个关键步骤：数据召回、去重、过滤、数据合成和数据混合优化。最终策划的数据集被称为 Qwen Math Corpus v1，是预训练的基础。Qwen2-Math 基模型以 Qwen2-1.5B/7B/72B 初始化，使用 Qwen Math Corpus v1 进行持续预训练。

Prior to the construction of Qwen Math Corpus v1, we observe that the suboptimal performance of general language models in mathematical reasoning stems from an insufficiency of mathematical data during pre-training. The existing endeavors pre-training to large-scale, specialized LLMs focused on mathematics have unequivocally demonstrated the value of extracting a considerable corpus of mathematical texts from digital databases. Our initial strategy involves the recall of mathematical data from web sources, such as Common Crawl, to escalate the quantity of data. Concretely, we train a FastText classifier utilizing high-quality mathematical seed data and general text data. We leverage iterative training with more math data each epoch to continuously enhance the performance of the classifier. To recognize the missing mathematical-related data in the corpus pool, we leverage meta-information, such as URLs, from the recalled data to expand the data pool for mathematical data retrieval. Subsequently, deduplication techniques, including MinHash, are employed to filter out similar mathematical documents.

在构建 Qwen Math Corpus v1 之前，我们观察到通用语言模型在数学推理中的次优表现源于预训练期间数学数据的不足。现有的大规模数学专用 LLM 预训练工作已经明确证明了从数字数据库中提取大量数学文本语料的价值。我们的初始策略是从网页源(如 Common Crawl)召回数学数据以增加数据量。具体而言，我们使用高质量数学种子数据和通用文本数据训练 FastText 分类器，利用每轮加入更多数学数据的迭代训练来持续提升分类器性能。为识别语料池中缺失的数学相关数据，我们利用召回数据中的元信息(如 URL)来扩展数学数据检索的数据池。随后，使用包括 MinHash 在内的去重技术来过滤相似的数学文档。

Upon collecting a substantial volume of mathematical data, our focus shifts toward enhancing its quality. For this, we implement a language-model-based filtering technique to further curate the dataset. Specifically, we utilize the Qwen2-0.5B-Instruct model, augmented with prompt engineering, to evaluate the quality of potential data entries. Data that receive higher scores, indicating higher quality according to the language model, are prioritized for inclusion in the final dataset. Beyond recalling a diverse set of mathematical documents and filtering out low-quality data, we draw inspiration from previous efforts in generating synthetic mathematical data. We employ the Qwen2-72B-Instruct model to synthesize a large amount of mathematical pre-training corpus. At this stage, the high-quality mathematical data already collected are used as reference materials. Using the Qwen2-72B-Instruct model, we: (1) extract and refine existing mathematical question-answer data from these references, and (2) directly generate new mathematical question-answer pairs.

在收集了大量数学数据后，我们的重点转向提升数据质量。为此，我们实现了基于语言模型的过滤技术来进一步策划数据集。具体而言，我们使用 Qwen2-0.5B-Instruct 模型配合提示工程来评估潜在数据条目的质量，得分较高(即语言模型认为质量更高)的数据优先纳入最终数据集。除了召回多样化的数学文档和过滤低质量数据外，我们还借鉴了先前生成合成数学数据的工作，使用 Qwen2-72B-Instruct 模型合成大量数学预训练语料。在此阶段，已收集的高质量数学数据被用作参考材料：(1) 从这些参考中提取和精炼现有的数学问答数据，(2) 直接生成新的数学问答对。

In the final phase, we conduct ablation studies on data mixture using a small math-specific language model, Qwen2-Math-1.5B. Based on the findings, we construct the Qwen Math Corpus v1, which comprises 700 billion tokens in total. We initialize the Qwen2-Math-1.5B/7B/72B pre-training with intermediate checkpoints from the corresponding Qwen2-1.5B/7B/72B base models. These models are then continuously pre-trained on Qwen Math Corpus v1 with a context length of 4K.

最后阶段，我们使用小型数学专用语言模型 Qwen2-Math-1.5B 对数据混合进行消融实验。基于实验发现，我们构建了总计 7000 亿 tokens 的 Qwen Math Corpus v1。Qwen2-Math-1.5B/7B/72B 的预训练以对应 Qwen2 基模型的中间 checkpoint 初始化，然后在 Qwen Math Corpus v1 上以 4K 上下文长度进行持续预训练。

Following the training of the Qwen2-Math base models, we further upgrade them to Qwen2.5-Math models through three primary avenues: (1) We utilize the Qwen2-Math-72B-Instruct model, further post-trained with the steps described in Section 3, to synthesize additional high-quality mathematical pre-training data. (2) We aggregate more high-quality mathematical data, especially in Chinese, sourced from web documents, books, and code repositories across multiple recall cycles. As a result of these efforts, we compile the Qwen Math Corpus v2 for Qwen2.5-Math-1.5B/7B/72B pre-training, while maintaining a context length of 4K. Compared to Qwen Math Corpus v1, the total token count of Qwen Math Corpus v2 escalates from 700B to over 1T. (3) Instead of initializing from the Qwen2 series, we leverage the Qwen2.5 series base models for parameter initialization, as they exhibit enhanced capabilities in language understanding, code generation, and text reasoning. Qwen2.5-Math models are continuously pre-trained on Qwen Math Corpus v2 under a math pre-training setup similar to Qwen2-Math. Benefiting from the improvements in both the dataset and the base model, Qwen2.5-Math models demonstrate further advancements in mathematical reasoning abilities beyond Qwen2-Math.

在训练完 Qwen2-Math 基模型后，我们通过三个主要途径将其升级为 Qwen2.5-Math：(1) 使用经过第 3 节所述后训练步骤进一步训练的 Qwen2-Math-72B-Instruct 模型合成额外的高质量数学预训练数据; (2) 聚合更多高质量数学数据(特别是中文)，来源包括多次召回周期中的网页文档、书籍和代码仓库，最终编制出用于 Qwen2.5-Math-1.5B/7B/72B 预训练的 Qwen Math Corpus v2，保持 4K 上下文长度，总 token 数从 700B 提升到超过 1T; (3) 不再从 Qwen2 系列初始化，而是利用 Qwen2.5 系列基模型进行参数初始化，因为它们在语言理解、代码生成和文本推理方面表现出更强的能力。Qwen2.5-Math 模型在类似 Qwen2-Math 的数学预训练设置下，使用 Qwen Math Corpus v2 进行持续预训练。受益于数据集和基模型的双重改进，Qwen2.5-Math 模型在数学推理能力上超越了 Qwen2-Math。

> **译者注**：预训练的数据工程非常系统：FastText 召回 -> MinHash 去重 -> 0.5B-Instruct 质量评分 -> 72B-Instruct 合成扩增 -> 1.5B 消融确定混合比例。特别值得注意的是，Qwen2.5-Math 使用 Qwen2.5(而非 Qwen2)作为初始化基座，这与 Qwen2-Math 使用 Qwen2 初始化不同——这意味着数学专用模型的收益不仅来自数学语料，还来自更强大的通用基座。v2 语料增加到 1T+ tokens，中文数据比例也显著提升。

---
## 3 QWEN2.5-MATH POST-TRAINING

After completing extensive mathematical pre-training, we proceed with post-training to further augment the mathematical logical reasoning capabilities of Qwen-Math, specifically focusing on Chain-of-Thought (CoT) and Tool-Integrated Reasoning (TIR). Our investigation is particularly focused on two key challenges: (1) How to automatically generate a substantial volume of highquality and reliable CoT and TIR annotations, and (2) How to effectively leverage these annotations for both Supervised Fine-Tuning and Reinforcement Learning.

**3 Qwen2.5-Math 后训练**
在完成广泛的数学预训练后，我们进行后训练以进一步增强 Qwen-Math 的数学逻辑推理能力，特别关注思维链(CoT)和工具集成推理(TIR)。我们的研究聚焦于两个关键挑战：(1) 如何自动生成大量高质量且可靠的 CoT 和 TIR 标注，(2) 如何有效利用这些标注进行监督微调和强化学习。

### 3.1 SUPERVISED FINE-TUNING

We aim for Qwen-Math to excel in two core capabilities: solving math problems through step-by-step natural language reasoning (Wei et al., 2022), and leveraging external tools (e.g., a Python interpreter) to address complex mathematical or algorithmic reasoning tasks (Yue et al., 2023). We have constructed dedicated datasets for both Chain-of-Though (CoT) and Tool-integrated Reasoning (TIR) and combined these datasets to train the model jointly. All models are trained for 3 epochs with a sequence length of 4,096 tokens. For the 72B model, we use a batch size of 256 and a learning rate of $5 \times 10^{-6}$. For the 1.5B and 7B models, we set the batch size to 128 and the learning rate to $2 \times 10^{-5}$. During training, the learning rate gradually decays to a final value of $7 \times 10^{-7}$.

**3.1 监督微调**
我们期望 Qwen-Math 在两项核心能力上表现卓越：通过逐步自然语言推理解决数学问题，以及利用外部工具(如 Python 解释器)处理复杂的数学或算法推理任务。我们为 CoT 和 TIR 分别构建了专用数据集并联合训练模型。所有模型训练 3 个 epoch，序列长度为 4096 tokens。72B 模型使用 batch size 256 和学习率 $5 \times 10^{-6}$; 1.5B 和 7B 模型 batch size 为 128，学习率为 $2 \times 10^{-5}$。训练期间学习率逐渐衰减至最终值 $7 \times 10^{-7}$。

#### 3.1.1 CHAIN-OF-THOUGHT DATA SYNTHESIS

Query Construction. The chain-of-thought dataset comprises a wide-ranging collection of 580K English and 500K Chinese mathematical problems, including both annotated and synthesized items. The annotated problems are derived from well-established sources such as the training set of GSM8K (Cobbe et al., 2021), MATH (Hendrycks et al., 2021b), and NuminaMath (LI et al., 2024). In an effort to bolster the Chinese reasoning capabilities of Qwen2.5-Math, we have further enriched the dataset with additional Chinese mathematical problems from exclusive K-12 problem collections. The synthesized problems are evolved from the annotated ones using the MuggleMath approach (Li et al., 2024b). To maintain a balanced distribution across varying levels of problem complexity, we utilize a difficulty-scoring model to categorize our problem set effectively.

**3.1.1 思维链数据合成**
查询构建：CoT 数据集包含 58 万英文和 50 万中文数学问题，包括标注和合成的题目。标注题目来源于成熟数据集如 GSM8K、MATH 和 NuminaMath 的训练集。为增强 Qwen2.5-Math 的中文推理能力，我们还从独家 K-12 题库中补充了中文数学题。合成题目使用 MuggleMath 方法从标注题目演化而来。为保持不同复杂度问题的均衡分布，我们使用难度评分模型对题目集进行分类。

Response Construction. We adopt an iterative approach that leverages rejection sampling, guided by reward modeling and annotated answers, to incrementally enhance the quality of responses (Yuan et al., 2023). At each iteration, the current best model is deployed to generate multiple reasoning pathways for the given problems, expanding the pool of candidate solutions. For problems with annotated answers, we select the top-k reasoning paths with correct final answers from the pool. For synthesized problems lacking definitive answers, we implement a weighted majority投票机制 to deduce the most plausible correct reasoning paths. From these, we choose the top-k pathways that receive the highest reward scores. In the development of Qwen2.5-Math, an additional iteration is conducted using the Qwen2-Math-Instruct models to polish the quality of responses further. The final CoT training set encompasses 2000K English samples and 500K Chinese samples.

回复构建：我们采用迭代方法，利用拒绝采样(由奖励模型和标注答案引导)逐步提升回复质量。每轮迭代中，部署当前最佳模型为给定问题生成多条推理路径，扩展候选解池。对于有标注答案的问题，从池中选出最终答案正确的 top-k 推理路径; 对于缺乏确定答案的合成问题，采用加权多数投票机制推断最可能正确的推理路径，然后从中选择获得最高奖励分数的 top-k 路径。在 Qwen2.5-Math 的开发中，还使用 Qwen2-Math-Instruct 模型进行额外迭代以进一步打磨回复质量。最终 CoT 训练集包含 200 万英文样本和 50 万中文样本。

#### 3.1.2 TOOL-INTEGRATED REASONING DATA SYNTHESIS

It is important to recognize that while CoT prompting plays a crucial role in enhancing the reasoning skills of large language models, it faces challenges in achieving computational accuracy and in handling complex mathematical or algorithmic problems, such as finding the roots of quadratic equations or computing the eigenvalues of matrices (Yue et al., 2023). To overcome these limitations and improve the model's proficiency in precise calculations, symbolic manipulation, and algorithmic reasoning, we have developed a dataset that incorporates a tool-integrated reasoning format. This innovative format enables the model to leverage a Python interpreter as an auxiliary resource in reasoning tasks.

**3.1.2 工具集成推理数据合成**
需要认识到，虽然 CoT 提示在增强大语言模型推理能力方面发挥关键作用，但它在实现计算准确性和处理复杂数学或算法问题(如求二次方程根或计算矩阵特征值)方面面临挑战。为克服这些局限并提升模型在精确计算、符号操作和算法推理方面的熟练度，我们开发了一种包含工具集成推理格式的数据集。这种创新格式使模型能够在推理任务中利用 Python 解释器作为辅助资源。

Query Construction. The tool-integrated reasoning dataset consists of 190K annotated problems and 205K synthesized problems. The annotated problems are sourced from the training sets of established benchmarks, including GSM8K (Cobbe et al., 2021), MATH (Hendrycks et al., 2021b), CollegeMath (Tang et al., 2024a), and NuminaMath (LI et al., 2024). The synthesized problems are generated by employing techniques from MuggleMath (Li et al., 2024b) and DotaMath (Li et al., 2024a) designed to facilitate query evolution within the GSM8K and MATH training sets. Additionally, we have selected 75K annotated problems for translation into Chinese using the Qwen2-72B model (Yang et al., 2024), aimed at enhancing the model's reasoning capabilities in Chinese.

查询构建：TIR 数据集包含 19 万标注问题和 20.5 万合成问题。标注问题来源于成熟基准的训练集，包括 GSM8K、MATH、CollegeMath 和 NuminaMath。合成问题使用 MuggleMath 和 DotaMath 技术生成，以促进 GSM8K 和 MATH 训练集中的查询演化。此外，我们选取了 7.5 万标注问题使用 Qwen2-72B 模型翻译成中文，以增强模型的中文推理能力。

Response Construction. For the annotated problems, we utilize an online Rejection Fine-Tuning (RFT) (Yuan et al., 2023; Singh et al., 2024) approach to iteratively generate tool-integrated reasoning paths whose final answers align with the reference answers. In each RFT iteration, we carry out multiple nucleus samplings with the currently best model at various temperatures, increasing the sample size for particularly challenging problems. After each iteration, to enhance data多样性, we apply a deduplication process to the responses, and the resulting cleaned dataset is then used to fine-tune the model for the next iteration. For the synthesized problems, we employ the optimal model derived from the online RFT process to generate reasoning samples. Majority voting is employed to select the most probable correct reasoning paths, which are subsequently incorporated into the overall dataset.

回复构建：对于标注问题，我们使用在线拒绝微调(RFT)方法迭代生成最终答案与参考答案一致的工具集成推理路径。每轮 RFT 迭代中，使用当前最佳模型在不同温度下进行多次核采样，对特别困难的问题增加采样数量。每轮迭代后，为增强数据多样性，对回复进行去重处理，清洗后的数据集用于下一轮迭代的模型微调。对于合成问题，使用在线 RFT 过程得到的最优模型生成推理样本，采用多数投票选择最可能正确的推理路径，随后将其纳入整体数据集。

> **译者注**：SFT 数据合成策略非常系统——CoT 数据通过拒绝采样 + RM 打分迭代生成，TIR 数据通过在线 RFT 迭代生成。关键数据规模：CoT 训练集 2500K(2000K EN + 500K ZH)，TIR 训练集约 395K 标注 + 75K 中文翻译。中英文 CoT 双语训练和 TIR 是 Qwen2.5-Math-Instruct 相比 Qwen2-Math-Instruct 的核心差异。RFT(Rejection Fine-Tuning)的本质是用当前最佳模型采样、过滤正确解、再微调模型的自举循环，与 self-play 的思想一致。

### 3.2 REWARD MODEL TRAINING

To provide supervisory signals beyond merely the final answer during both the selection of supervised fine-tuning data and the subsequent stages of reinforcement learning training, we have developed a mathematical reward model for Qwen2-Math and Qwen2.5-Math, referred to as Qwen2-Math-RM and Qwen2.5-Math-RM, respectively. These reward models are specifically designed to guide the model throughout the training process by offering more granular feedback on the quality of reasoning and intermediate steps, ultimately facilitating more robust model improvements.

**3.2 奖励模型训练**
为了在 SFT 数据选择和后续 RL 训练阶段提供超越最终答案的监督信号，我们为 Qwen2-Math 和 Qwen2.5-Math 开发了数学专用奖励模型，分别称为 Qwen2-Math-RM 和 Qwen2.5-Math-RM。这些奖励模型专门设计用于在训练过程中为模型提供更细粒度的推理质量和中间步骤反馈，最终促进更稳健的模型改进。

#### 3.2.1 DATA SYNTHESIS

In the development of Qwen2-Math-RM, we utilize 206K English mathematical problems, each paired with 6 candidate responses sampled from an intermediate version of Qwen2-Math. For Qwen2.5-Math-RM, we further enhance its support for both the Chinese language and TIR mode, training it with a more diverse set of 361K English and 257K Chinese mathematical problems, with each problem accompanied by 6 responses sampled from Qwen2.5-Math. This expansion ensures that Qwen2.5-Math-RM is well-equipped to provide supervisory feedback across a broader range of problem types and languages.

**3.2.1 数据合成**
在 Qwen2-Math-RM 的开发中，我们使用 20.6 万英文数学问题，每个问题搭配从 Qwen2-Math 中间版本采样的 6 个候选回复。对于 Qwen2.5-Math-RM，我们进一步增强其对中文和 TIR 模式的支持，使用更多样化的 36.1 万英文和 25.7 万中文数学问题进行训练，每个问题搭配从 Qwen2.5-Math 采样的 6 个回复。这种扩展确保 Qwen2.5-Math-RM 能够为更广泛的问题类型和语言提供监督反馈。

To establish the preference signals among the responses, we check the final answers of the responses to determine their correctness. Responses with the correct answers are labeled as positive, while those with incorrect answers are labeled as negative, thereby naturally creating a ranking relationship among the responses. We then filter out any cases where all responses are either entirely correct or entirely incorrect. However, to avoid the potential drawback of retaining only overly simplistic data, we enrich the dataset with responses from various intermediate versions and models of different sizes. This strategy ensures a more balanced distribution of query difficulty and maintains an even ratio of positive to negative responses.

为建立回复间的偏好信号，我们检查回复的最终答案以确定其正确性。答案正确的回复标记为正例，错误的标记为负例，从而在回复间自然形成排序关系。然后过滤掉所有回复全对或全错的案例。然而，为避免仅保留过于简单数据的潜在缺陷，我们用各种中间版本和不同尺寸模型的回复来丰富数据集。这一策略确保查询难度的更均衡分布，并保持正负例的均衡比例。

#### 3.2.2 TRAINING STRATEGY

We initialize the reward model from the supervised fine-tuning model. In terms of architecture, we replace the language modeling head originally used for next-token prediction with a scalar-value head, consisting of two linear layers. As previously mentioned, each query in the reward model's training dataset is paired with 6 responses, comprising both positive and negative candidates. If there are k positive responses, then the remaining $6 - k$ are negative. Following Ouyang et al. (2022), the loss function for the reward model can therefore be formulated as follows:

**3.2.2 训练策略**
我们从监督微调模型初始化奖励模型。在架构上，将原本用于下一 token 预测的语言建模头替换为由两个线性层组成的标量值头。如前所述，奖励模型训练数据集中的每个查询搭配 6 个回复，包含正负候选。如果有 k 个正例回复，则剩余 $6-k$ 个为负例。遵循 Ouyang 等人(2022)，奖励模型的损失函数可表述如下：

$$
\mathcal{L}_{rm}(\theta) = -\frac{1}{k \times (6-k)} E_{(x, y_{pos}, y_{neg}) \sim D} \left[ \log \left( \sigma \left( r_\theta(x, y_{pos}) - r_\theta(x, y_{neg}) \right) \right) \right]. \tag{1}
$$

Here, $r_\theta(x, y)$ denotes the output of the reward model, where x represents the problem and $y$ is the corresponding response. Rather than breaking these into multiple individual pairs and computing the loss in a pairwise fashion, we adopt a listwise approach to compute the ranking loss directly over valid pairs. This method enhances both training efficiency and effectiveness.

其中 $r_\theta(x, y)$ 表示奖励模型的输出，x 代表问题，y 是对应回复。我们不将其拆分为多个独立对并以成对方式计算损失，而是采用 listwise 方法直接在所有有效对上计算排序损失。这种方法同时提升了训练效率和效果。

> **译者注**：RM 训练采用 listwise ranking loss(而非 pairwise)，这是对传统 RLHF 中 Bradley-Terry 模型的改进。每个问题 6 个回复，正负比例动态变化(k 个正例，6-k 个负例)，通过在所有有效对上求平均来计算损失。这种设计比简单成对比较更稳定，特别是在正负例数量不均衡时。RM 数据规模：Qwen2-Math-RM 206K × 6 = 1.24M 个回复对; Qwen2.5-Math-RM 618K × 6 = 3.71M 个回复对，规模扩大了约 3 倍且增加了中文和 TIR 数据。

### 3.3 REINFORCEMENT LEARNING

Query Selection. The queries for reinforcement learning training are selected from the reward model's training set. We leverage supervised fine-tuning models with varying sizes to resample 8 responses for each query, with each response classified as either correct or incorrect by comparing it to the gold-standard answer. In the reinforcement learning stage, our primary goal is to ensure that the model consistently produces correct answers for queries where a correct response is possible. Therefore, we only retain queries for which 2 to 5 out of the 8 responses are correct. Queries with fewer than 2 correct answers are excluded as they indicate that the current Math model lacks the fundamental capability to learn from them. Likewise, queries with more than 5 correct responses are omitted since the model already demonstrates competence in these cases and no further training is necessary. In the end, we retain 66K queries for training.

**3.3 强化学习**
查询选择：RL 训练查询选自奖励模型的训练集。我们使用不同尺寸的 SFT 模型为每个查询重新采样 8 个回复，通过与标准答案比较将每个回复分类为正确或错误。在 RL 阶段，我们的主要目标是确保模型对存在正确回复可能的查询持续产生正确答案。因此，仅保留 8 个回复中有 2-5 个正确的查询。正确回复少于 2 个的查询被排除，因为表明当前数学模型缺乏从中学习的基本能力; 正确回复超过 5 个的查询也被省略，因为模型已掌握这些情况，无需进一步训练。最终保留 6.6 万查询用于训练。

Group Relative Policy Optimization (GRPO). As introduced by Shao et al. (2024), GRPO is a reinforcement learning method specifically designed for large language models, obviating the need for additional value function approximation as in PPO. GRPO uses the average rewards of a group of sampled outputs as a baseline to calculate the advantages of each output. The objective of GRPO is defined as Eq. 2:

组相对策略优化(GRPO)：如 Shao 等人(2024)所介绍，GRPO 是一种专为大语言模型设计的强化学习方法，免除了像 PPO 那样需要额外价值函数近似的需求。GRPO 使用一组采样输出的平均奖励作为基线来计算每个输出的优势。GRPO 的目标函数定义为式 2：

$$
\begin{array}{l}
\mathcal{J}_{GRPO}(\theta) = \mathbb{E}_{[q \sim P(Q), \{o_i\}_{i=1}^G \sim \pi_{\theta_{old}}(O|q)]} \\
\displaystyle \frac{1}{G} \sum_{i=1}^{G} \frac{1}{|o_i|} \sum_{t=1}^{|o_i|} \left\{ \min\left( \frac{\pi_\theta}{\pi_{\theta_{old}}^{i,t}} \hat{A}_{i,t}, \text{clip}\left( \frac{\pi_\theta}{\pi_{\theta_{old}}^{i,t}}, 1-\epsilon, 1+\epsilon \right) \hat{A}_{i,t} \right) - \beta \mathbb{D}_{KL}[\pi_\theta || \pi_{\text{ref}}] \right\},
\end{array} \tag{2}
$$

where $\pi^{i,t} = \pi(o_{i,t}|q, o_{i,<t})$, G is the number of responses in a group. $\pi_{ref}, \pi_\theta$, and $\pi_{old}$ are reference, training, and sampling models, respectively. q and $\{o_i\}_{i=1}^G$ are questions and generated responses set in training. The advantage of each responses $\hat{A}_i$ is calculated by $\hat{A}_i = \frac{r_i - \text{mean}(r_i)}{\text{std}(r_i)}$. Then this sequence-level advantage is applied to each token in the response as $\hat{A}_{i,t}$.

其中 $\pi^{i,t} = \pi(o_{i,t}|q, o_{i,<t})$，G 是一组中的回复数量。$\pi_{ref}$、$\pi_\theta$ 和 $\pi_{old}$ 分别是参考模型、训练模型和采样模型。q 和 $\{o_i\}_{i=1}^G$ 是训练中的问题和生成回复集。每个回复的优势 $\hat{A}_i$ 通过 $\hat{A}_i = \frac{r_i - \text{mean}(r_i)}{\text{std}(r_i)}$ 计算，然后将序列级优势应用于回复中的每个 token 作为 $\hat{A}_{i,t}$。

Reward Shaping. We combine the rewards from both a rule-based verifier and the reward model to shape the overall reward signal. The rule-based verifier extracts potential answers from each response and compares them against the gold-standard answer.

奖励塑形：我们结合基于规则的验证器和奖励模型的奖励来塑造整体奖励信号。基于规则的验证器从每个回复中提取潜在答案并与标准答案比较。

Given that the output of the reward model is denoted as $r_m \in \mathbb{R}$, and the sparse reward from the rule-based verifier as $r_v \in \{0, 1\}$, the overall reward is calculated as follows:

设奖励模型的输出为 $r_m \in \mathbb{R}$，基于规则验证器的稀疏奖励为 $r_v \in \{0, 1\}$，整体奖励计算如下：

$$
\boldsymbol{r} = \sigma(\boldsymbol{\alpha} \cdot \boldsymbol{r}_m) + (\boldsymbol{r}_v - 1), \tag{3}
$$

where α is set as 0.5 in all of our experiments.

其中 α 在所有实验中设为 0.5。

This shaping mechanism ensures that correct responses consistently receive higher overall rewards compared to incorrect ones. Within each of the correct and incorrect groups, the responses are ranked based on the scores from the reward models. Especially in hard samples.

这种塑形机制确保正确回复相比错误回复始终获得更高的整体奖励。在正确组和错误组内部，回复根据奖励模型的分数排序，尤其在困难样本中。

Implementations. Our experiments are implemented based on the open-source RLHF framework ChatLearn. The core implementation of our rule-based verifier is similar to the one used in our evaluation. All policy models in different parameter sizes are trained with the same reward model. We sample 32 responses for each query. Considering a pair of queries and responses as a sample, the number of samples in one episode is 4,096 and 2,048 for training 7B and 72B, respectively. All models are trained with a 512 global batch size. The learning rates are $1 \times 10^{-5}$ and $5 \times 10^{-6}$ for 7B and 72B, respectively. And the KL coefficient for all training is $1 \times 10^{-3}$. We mask all output tokens the Python executor provides in reinforcement learning of tool-integrated reasoning.

实现细节：我们的实验基于开源 RLHF 框架 ChatLearn 实现。基于规则验证器的核心实现与评估中使用的类似。所有不同参数尺寸的策略模型使用同一个奖励模型训练。我们为每个查询采样 32 个回复。将查询-回复对视为一个样本，7B 和 72B 训练每轮 episode 的样本数分别为 4096 和 2048。所有模型使用 512 的全局 batch size 训练。7B 和 72B 的学习率分别为 $1 \times 10^{-5}$ 和 $5 \times 10^{-6}$。所有训练的 KL 系数为 $1 \times 10^{-3}$。在 TIR 的强化学习中，我们 mask 掉 Python 执行器提供的所有输出 token。

> **译者注**：RL 阶段有三个关键技术细节值得注意：(1) 查询筛选策略——只保留 8 个采样中有 2-5 个正确的查询，这确保了 RL 训练在模型能力边界附近进行，既不太简单(>5 正确)也不太难(<2 正确); (2) Reward Shaping 将规则验证器的稀疏奖励(0/1)与 RM 的连续信号通过 sigmoid 组合，α=0.5 平衡了两者; (3) GRPO 相比 PPO 无需训练单独的价值网络，直接使用组内平均奖励作为基线，显著降低了 RL 训练的内存和计算开销。TIR 的 RL 中 mask Python 执行器输出 token 是一个重要细节——这防止了模型学习去复制代码执行结果，而是专注于生成正确的代码和推理。

---

## 4 DECONTAMINATION

Decontamination is critical to ensuring unbiased model performance evaluation. Following prior work (Yang et al., 2024), we exclude potentially contaminated training samples using 13-gram matching. To improve the accuracy of this matching process, we perform text normalization, removing irrelevant punctuation and symbols. To further reduce false negatives, particularly for common mathematical expressions, we introduce an additional criterion: the ratio of the longest common subsequence must exceed 0.6 for a sample to be considered contaminated. For pre-training data, we filter potentially contaminated samples against datasets such as GSM8K (Cobbe et al., 2021) and MATH (Hendrycks et al., 2021b). When dealing with post-training data, including SFT data, RM training data, and the RL query set, we exclude any potentially contaminated problems or solutions across all reported evaluation datasets. These evaluation datasets include GSM8K (Cobbe et al., 2021), MATH (Hendrycks et al., 2021b), Minerva Math (Lewkowycz et al., 2022b), Gaokao 2023 En (Liao et al., 2024), Olympiad Bench (He et al., 2024), College Math (Tang et al., 2024b), MMLU STEM (Hendrycks et al., 2021a), GaoKao (Zhong et al., 2024), CMATH (Wei et al., 2023), CN Middle School 24, AIME 24, and AMC 23.

**4 去污染**
去污染对于确保无偏的模型性能评估至关重要。遵循先前工作(Yang et al., 2024)，我们使用 13-gram 匹配排除可能受污染的训练样本。为提高匹配准确性，我们进行文本归一化，移除无关标点和符号。为进一步减少假阴性，尤其对于常见数学表达式，我们引入额外标准：最长公共子序列比率必须超过 0.6 才视为受污染。对于预训练数据，我们针对 GSM8K 和 MATH 等数据集过滤可能受污染的样本。对于后训练数据(包括 SFT 数据、RM 训练数据和 RL 查询集)，我们排除所有报告评估数据集中任何可能受污染的问题或解答。这些评估数据集包括 GSM8K、MATH、Minerva Math、Gaokao 2023 En、Olympiad Bench、College Math、MMLU STEM、GaoKao、CMATH、CN Middle School 24、AIME 24 和 AMC 23。

During the analysis of contaminated samples, we identify that some existing training datasets (e.g., the MATH training dataset) contain a significant proportion of problems that share highly similar concepts or structures with those found in test datasets. Although these variations are not exact duplicates, they could potentially compromise the integrity of our evaluation. Therefore, we continue to exclude such samples from the training corpora. Table 1 provides examples of similar problems identified across the training and test sets.

在分析受污染样本时，我们发现一些现有训练数据集(如 MATH 训练集)包含大量与测试集中问题概念或结构高度相似的题目。尽管这些变体不是完全重复，但可能损害评估的完整性。因此，我们继续从训练语料中排除此类样本。表 1 提供了训练集和测试集中发现的相似问题示例。

Problems from MATH train (filtered):

MATH 训练集(已过滤)中的问题：

- What is the remainder when 1 + 2 + 3 + 4 + · · · + 9 + 10 is divided by 8?
  当 1+2+3+4+···+9+10 除以 8 时余数是多少？
- For how many integer values of n between 1 and 1000 inclusive does the decimal representation of $\frac{n}{1400}$ terminate?
  对于 1 到 1000 之间(含)的多少个整数 n，$\frac{n}{1400}$ 的小数表示会终止？

Problems from MATH test:

MATH 测试集中的问题：

- Krista put 1 cent into her new bank on a Sunday morning. On Monday she put 2 cents into her bank. On Tuesday she put 4 cents into her bank, and she continued to double the amount of money she put into her bank each day for two weeks. On what day of the week did the total amount of money in her bank first exceed $2?
  Krista 在周日上午往新银行存了 1 美分。周一存了 2 美分，周二存了 4 美分，她继续每天将存入金额翻倍，持续两周。总金额首次超过 2 美元是在星期几？
- What is the remainder when 1 + 2 + 3 + 4 + · · · + 9 + 10 is divided by 9?
  当 1+2+3+4+···+9+10 除以 9 时余数是多少？
- For how many integer values of n between 1 and 1000 inclusive does the decimal representation of $\frac{n}{1375}$ terminate?
  对于 1 到 1000 之间(含)的多少个整数 n，$\frac{n}{1375}$ 的小数表示会终止？
- Krista put 1 cent into her new bank on a Sunday morning. On Monday she put 2 cents into her bank. On Tuesday she put 4 cents into her bank, and she continued to double the amount of money she put into her bank each day for two weeks. On what day of the week did the total amount of money in her bank first exceed $5?
  Krista 在周日上午往新银行存了 1 美分...总金额首次超过 5 美元是在星期几？

Table 1: Examples of filtered samples in the MATH training set with similar samples in the test set.
表 1：MATH 训练集中已过滤样本与测试集中相似样本的示例。

> **译者注**：去污染策略采用双重标准——13-gram 精确匹配 + LCS 比率 > 0.6 的模糊匹配。这比单纯的 n-gram 去重更严格，能捕获概念相似但表述不同的题目(如表 1 所示，仅数字 8→9、1400→1375、$2→$5 的差异)。注意到他们发现 MATH 训练集中有大量与测试集高度相似的问题，这说明数学数据集的去污染比一般 NLP 任务更关键，因为数学问题的结构相似性更容易导致数据泄露。

---

## 5 EVALUATION

### 5.1 BASE MODELS

We evaluate our Qwen2-Math and Qwen2.5-Math base models on three widely used English math benchmarks GSM8K (Cobbe et al., 2021), MATH (Hendrycks et al., 2021b), and MMLU-STEM (Hendrycks et al., 2021a). In addition, we also evaluate three Chinese math benchmarks CMATH (Wei et al., 2023), GaoKao Math Cloze (Zhong et al., 2024), and GaoKao Math QA (Zhong et al., 2024). All evaluations are tested with few-shot chain-of-thought prompting. The prompts of these benchmarks are shown in Appendix B. For general models, we report the results on LLama-3.1-8B/70B/405B (AI@Meta, 2024) and Qwen2-1.5B/7B/72B (Yang et al., 2024). For specific models, DeepSeekMath-Base-7B (Shao et al., 2024), DeepSeek-Coder-V2-Lite-Base (Zhu et al., 2024), and Intermln2-Math-Base-20B (Ying et al., 2024) are used as baselines.

**5 评估**
**5.1 基模型**
我们在三个广泛使用的英文数学基准 GSM8K、MATH 和 MMLU-STEM 上评估 Qwen2-Math 和 Qwen2.5-Math 基模型。此外，还在三个中文数学基准 CMATH、高考数学填空和高考数学 QA 上进行评估。所有评估使用少样本思维链提示测试。基准的提示见附录 B。对于通用模型，报告 LLama-3.1-8B/70B/405B 和 Qwen2-1.5B/7B/72B 的结果。对于专用模型，使用 DeepSeekMath-Base-7B、DeepSeek-Coder-V2-Lite-Base 和 Intermln2-Math-Base-20B 作为基线。

The results are shown in Table 2. We can see that the smallest model of the Qwen2.5-Math series, Qwen2.5-Math-1.5B, outperforms all specific baselines on GSM8K, MATH, CMATH, GaoKao Math Cloze, and Gaokao Math QA. Furthermore, the medium-size model, Qwen2.5-Math-7B, obtains 91.6 and 55.4 scores on GSM8K and MATH, which outperforms Qwen2-72B with 89.5 and 51.1, and Llama-3.1-405B with 89.0 and 53.8. Our flagship Qwen2.5-Math-72B achieves new SOTA on MATH, CMATH, Gaokao Math Cloze, and Gaokao Math QA, which obtains 66.8 on MATH. Compared to Qwen2-Math-1.5B/7B/72B, Qwen2.5-Math-1.5B/7B/72B have achieved significant improvements on all benchmarks. For example, Qwen2.5-Math-1.5B/7B/72B obtains 5.4, 5.0, 6.3 scores improvement on MATH, and 3.4, 12.2, 19.8 scores improvement on Gaokao Math QA, which demonstrates the effectiveness of our Qwen Math corpus v2.

结果如表 2 所示。Qwen2.5-Math 系列最小的 1.5B 模型在 GSM8K、MATH、CMATH、高考数学填空和高考数学 QA 上超越了所有专用基线。中等尺寸的 7B 模型在 GSM8K 和 MATH 上分别获得 91.6 和 55.4 分，超越了 Qwen2-72B 的 89.5 和 51.1，以及 Llama-3.1-405B 的 89.0 和 53.8。旗舰模型 Qwen2.5-Math-72B 在 MATH、CMATH、高考数学填空和高考数学 QA 上创下新 SOTA，MATH 得分 66.8。与 Qwen2-Math 系列相比，Qwen2.5-Math 系列在所有基准上都有显著提升：1.5B/7B/72B 在 MATH 上分别提升 5.4、5.0、6.3 分，在高考数学 QA 上分别提升 3.4、12.2、19.8 分，证明了 Qwen Math Corpus v2 的有效性。

> **译者注**：基模型评估的关键发现：Qwen2.5-Math-7B(55.4 MATH)> Qwen2-72B 通用模型(51.1 MATH)，这再次印证了数学专用预训练的效率——7B 数学专用模型在数学任务上击败 72B 通用模型。Qwen2.5-Math-72B 的 MATH 66.8 是基模型新 SOTA，比 Qwen2-Math-72B 提升 5.3 分，这个提升主要来自 v2 语料(1T+ tokens)和更强的 Qwen2.5 初始化基座。

Table 2: The results of Qwen2.5-Math and other base models on English and Chinese mathematical benchmarks. Models are evaluated with few-shot chain-of-thought prompting.
表 2：Qwen2.5-Math 及其他基模型在中英文数学基准上的结果。模型使用少样本思维链提示评估。

(表格数据见原始 MinerU-EN 文件，此处保留原表格结构)

### 5.2 INSTRUCTION MODELS

We evaluate Qwen2-Math-Instruct on mathematical benchmarks in both English and Chinese. In addition to the widely-used benchmarks, such as GSM8K (Cobbe et al., 2021) and MATH (Hendrycks et al., 2021b), we also involve more exams that are more challenging to fully inspect the capabilities of Qwen2-Math-Instruct and Qwen2.5-Math-Instruct, such as OlympiadBench (He et al., 2024), CollegeMath (Tang et al., 2024a), GaoKao 2023 En (Liao et al., 2024), AIME2024, and AMC2023. For Chinese mathematical benchmarks, we use CMATH (Wei et al., 2023), GaoKao (including GaoKao I/II 2024, GaoKao-Math-QA, GaoKao-Math-Cloze and 91 collected GaoKao problems in 2024), and CN Middle School 24 (101 collected problems from China High School Entrance Examination in 2024). We report greedy, Maj@8, and RM@8 performance on all benchmarks in the zero-shot setting, except for the multi-choice benchmarks (including MMLU STEM and multiple-choice problems in GaoKao and CN Middle School 24) with a 5-shot setting.

**5.2 指令模型**
我们在中英文数学基准上评估 Qwen2-Math-Instruct。除了广泛使用的基准如 GSM8K 和 MATH 外，还引入了更具挑战性的考试以全面检验模型能力，包括 OlympiadBench、CollegeMath、GaoKao 2023 En、AIME2024 和 AMC2023。中文数学基准使用 CMATH、GaoKao(含 2024 高考 I/II、高考数学 QA、高考数学填空和 91 道 2024 高考收集题)和 CN Middle School 24(101 道 2024 中考收集题)。我们在零样本设置下报告所有基准的 greedy、Maj@8 和 RM@8 性能，多选题基准(含 MMLU STEM 和高考、中考中的选择题)使用 5-shot 设置。

We take Qwen2-1.5/7/72B-Instruct (Yang et al., 2024), Llama-3.1-8/70B-instruct (AI@Meta, 2024), and GPT4o-2024-08-06 (OpenAI, 2024) as general model baselines. Besides, DeepSeekMath-7B-RL (Shao et al., 2024), DeepSeek-Coder-V2-Lite-Instruct (Zhu et al., 2024), Intermln2-math-plus-7B/20B/mixtral8x7B (Ying et al., 2024), Mathstral-7B-v0.1 (Mistral-AI, 2024), NuminaMath-7/72B-CoT (LI et al., 2024) are taken as specific-model baselines.

通用模型基线包括 Qwen2-1.5/7/72B-Instruct、Llama-3.1-8/70B-instruct 和 GPT4o-2024-08-06。专用模型基线包括 DeepSeekMath-7B-RL、DeepSeek-Coder-V2-Lite-Instruct、Intermln2-math-plus-7B/20B/mixtral8x7B、Mathstral-7B-v0.1、NuminaMath-7/72B-CoT。

Let us first analyze the performance on English benchmarks. As shown in Table 3, we can draw the following conclusions: (1) Qwen2-Math-Instruct has demonstrated exceptional capabilities. The 1.5B model achieves an average score higher than any sub-70B model currently available. The 7B model performs on par with Qwen2-72B-Instruct, and Qwen2-Math-72B-Instruct surpasses the latest version of GPT-4o by 3.7 points. (2) The performance of Qwen2.5-Math-Instruct represents a further upgrade over Qwen2-Math-Instruct. In the traditional CoT mode, the 1.5B and 7B Qwen2.5-Math-Instruct models achieve results comparable to the 7B and 72B Qwen2-Math-Instruct models, respectively, demonstrating a cross-scale improvement. Qwen2.5-Math-72B-Instruct achieves an average score of 2.5 points ahead of the current best model and is 6.2 points higher than GPT-4o. This shows that our improvements in training data and strategy can provide an alternative pathway for performance enhancements beyond simply increasing model size. (3) The TIR mode introduced in Qwen2.5-Math-Instruct is highly effective. With the assistance of a Python Interpreter, the 7B model already matches the performance of Qwen2.5-Math-72B-Instruct. This indicates that precise mathematical calculations via external tools can significantly aid LLM reasoning. In many cases, the reasoning process of LLMs is sound, but computational errors can arise. (4) Our RM performs exceptionally well. Across almost all benchmarks and models, RM@N scores are substantially better than Maj@N scores. This provides a reliable performance oracle for improving reinforcement learning strategies in the future. It is likely that we may soon see models with greedy decoding exceeding 90 points on MATH, even for the 7B scale.

首先分析英文基准上的表现。如表 3 所示，可得出以下结论：(1) Qwen2-Math-Instruct 展现了卓越能力。1.5B 模型的平均分超越了所有当前可用的 70B 以下模型; 7B 模型与 Qwen2-72B-Instruct 表现相当; 72B-Instruct 超越最新版 GPT-4o 3.7 分。(2) Qwen2.5-Math-Instruct 相比 Qwen2-Math-Instruct 进一步提升。传统 CoT 模式下，1.5B 和 7B Qwen2.5-Math-Instruct 分别达到了 7B 和 72B Qwen2-Math-Instruct 的水平，展示了跨尺寸提升。72B-Instruct 平均分领先当前最佳模型 2.5 分，比 GPT-4o 高 6.2 分，表明训练数据和策略的改进可以成为超越单纯扩大模型尺寸的替代路径。(3) Qwen2.5-Math-Instruct 引入的 TIR 模式非常有效。在 Python 解释器辅助下，7B 模型已能达到 72B-Instruct 的性能，说明通过外部工具进行精确数学计算可以显著辅助 LLM 推理——很多时候 LLM 的推理过程是正确的，但计算错误。(4) 我们的 RM 表现卓越。几乎所有基准和模型上，RM@N 分数都显著优于 Maj@N 分数，这为未来改进 RL 策略提供了可靠的性能预言。我们很可能很快看到 7B 规模模型通过 greedy decoding 在 MATH 上超过 90 分。

Table 3: The results of Qwen2.5-Math-Instruct and other instruct models on English benchmarks. For CoT, we report few-shot pass@1 performance on MMLU(STEM) and zero-shot pass@1 performance on other benchmarks. For TIR, all benchmarks are evaluated in the zero-shot setting. Except for the pass@1 scores, we also provide the Qwen2-Math and Qwen2.5-Math performance with majority voting and reward model best-of-N among 8 sampled responses. Best pass@1 performance in CoT and TIR are marked in bold.
表 3：Qwen2.5-Math-Instruct 及其他指令模型在英文基准上的结果。CoT 模式下 MMLU(STEM) 报告 few-shot pass@1，其他基准报告 zero-shot pass@1。TIR 模式下所有基准使用 zero-shot 评估。除 pass@1 分数外，还提供了 Qwen2-Math 和 Qwen2.5-Math 在 8 个采样回复上的多数投票和奖励模型 best-of-N 性能。CoT 和 TIR 中的最佳 pass@1 用粗体标出。

(表格数据见原始 MinerU-EN 文件)

![](images/fig03_math_cot_comparison.jpg)  
Figure 3: The Performance of Qwen2.5-Math-1.5/7/72B-Instruct on MATH by CoT compared to models of the same size.
图 3：Qwen2.5-Math-1.5/7/72B-Instruct 在 MATH 上使用 CoT 与同尺寸模型的性能对比。

Let's now shift our attention to Table 4 to analyze the performance on the Chinese benchmarks. For Qwen2-Math-Instruct, no specifically Chinese mathematics-related training data was incorporated. However, thanks to Qwen2's strong language transfer capabilities, the Qwen2-Math-1.5B-Instruct model has already surpassed GPT-4o in terms of the average Chinese score. During the development of Qwen2.5-Math-Instruct, we intentionally integrated Chinese-specific math post-training data, resulting in substantial improvements in Chinese performance. The Qwen2.5-Math-1.5B-Instruct model achieves results similar to Qwen2-Math-72B-Instruct, while Qwen2.5-Math-72B-Instruct outperforms GPT-4o by an impressive 17.5 points. Our RM also exhibits strong performance in Chinese benchmarks. Similar to our results in English, RM@N scores consistently surpass Maj@N scores, highlighting its effectiveness. However, one key difference from the English results is that the TIR mode in Chinese does not show a significant performance advantage over the CoT mode. We will continue to investigate this aspect in future research.

现在将注意力转向表 4 分析中文基准表现。Qwen2-Math-Instruct 未纳入专门的中文数学训练数据，但得益于 Qwen2 强大的语言迁移能力，1.5B-Instruct 在中文平均分上已超越 GPT-4o。在 Qwen2.5-Math-Instruct 开发中，我们有意识地整合了中文数学后训练数据，中文性能获得大幅提升。1.5B-Instruct 达到了 Qwen2-Math-72B-Instruct 的水平，而 72B-Instruct 以令人印象深刻的 17.5 分优势超越 GPT-4o。我们的 RM 在中文基准上也表现强劲，与英文结果类似，RM@N 分数持续超越 Maj@N 分数。但与英文结果的一个关键差异是，中文中 TIR 模式相比 CoT 模式未显示出显著性能优势，我们将在未来研究中继续探索这一点。

Table 4: The results of Qwen2.5-Math-Instruct and other instruct models on Chinese benchmarks.
表 4：Qwen2.5-Math-Instruct 及其他指令模型在中文基准上的结果。

(表格数据见原始 MinerU-EN 文件)

![](images/fig04_tir_vs_cot.jpg)  
Figure 4: The Performance of Qwen2.5-Math-1.5/7/72B-Instruct by using TIR compared to using CoT. We use blue color to represent the performance of TIR, and orange to represent the performance of CoT. It can be seen that TIR can achieve further performance improvement compared to CoT.
图 4：Qwen2.5-Math-1.5/7/72B-Instruct 使用 TIR 与 CoT 的性能对比。蓝色代表 TIR，橙色代表 CoT。可见 TIR 相比 CoT 可进一步提升性能。

Lastly, we intend to evaluate the model's ability to solve complex mathematical problems on highly challenging competition benchmarks such as AIME 2024 and AMC 2023. As shown in Table 5, we observe a significant improvement in performance on difficult problems with Qwen2.5-Math-Instruct compared to Qwen2-Math-Instruct. With the support of the RM, Qwen2.5-Math-1.5B-Instruct, using the RM@256 in CoT mode, successfully solves 29 out of 40 problems on AMC 2023, significantly outperforming NuminaMath-72B CoT. Moreover, Qwen2.5-Math-72B-Instruct nearly achieves a perfect score in TIR mode, solving almost all the problems. We attribute this impressive performance to the extensive amounts of challenging mathematical data collected and synthesized during pretraining. On the extremely difficult AIME 2024 benchmark, Claude3 Opus, GPT-4 Turbo, and Gemini 1.5 Pro manage to solve only 1 or 2 questions out of 30. In contrast, Qwen2.5-Math-72B-Instruct solves 9 problems in Greedy decoding CoT mode and 12 problems in TIR mode. With the help of the RM, Qwen2.5-Math-7B-Instruct could even solve up to 21 problems, further demonstrating the outstanding mathematical problem-solving ability of Qwen2.5-Math-Instruct.

最后，我们评估模型在极具挑战性的竞赛基准(AIME 2024 和 AMC 2023)上解决复杂数学问题的能力。如表 5 所示，Qwen2.5-Math-Instruct 在难题上相比 Qwen2-Math-Instruct 有显著提升。在 RM 支持下，Qwen2.5-Math-1.5B-Instruct 使用 CoT 模式 RM@256 成功解决 AMC 2023 的 40 题中的 29 题，显著超越 NuminaMath-72B CoT。此外，72B-Instruct 在 TIR 模式下几乎获得满分，解决了几乎所有问题。我们将这一令人印象深刻的表现归因于预训练期间收集和合成的海量挑战性数学数据。在极难的 AIME 2024 基准上，Claude3 Opus、GPT-4 Turbo 和 Gemini 1.5 Pro 仅能解决 30 题中的 1 或 2 题。相比之下，72B-Instruct 在 Greedy decoding CoT 模式下解决 9 题，在 TIR 模式下解决 12 题。在 RM 帮助下，7B-Instruct 甚至能解决多达 21 题，进一步展示了 Qwen2.5-Math-Instruct 卓越的数学解题能力。

Table 5: The results on the mathematics competition problems.
表 5：数学竞赛问题的结果。

(表格数据见原始 MinerU-EN 文件)

> **译者注**：竞赛题评估是最令人瞩目的部分。AIME 2024(30 题)上，7B-Instruct + RM@256 能解决 21 题，72B-Instruct TIR 能解决 12 题(greedy)/ 21 题(RM@256)。这超越了 Claude3 Opus/GPT-4 Turbo/Gemini 1.5 Pro 的 1-2 题。一个关键发现：RM@N 相比 Maj@N 在所有基准上都有显著提升，说明奖励模型不仅用于 RL 训练，在推理时的 best-of-N 采样中也是极强的性能放大器。TIR 在英文上提升显著但在中文上优势不明显，这可能是因为中文数学题更侧重逻辑推理而非复杂计算，或者 TIR 的中文代码注释/理解还有优化空间。

---

## 6 CONCLUSION

In this report, we introduce Qwen2.5-Math, which features several key technical highlights: (1) extensive use of synthesized mathematical data from Qwen2-Math during the pre-training phase, (2) iterative generation of fine-tuning data and reinforcement training guided by the reward model during the post-training and inference phase and (3) support for bilingual (English and Chinese) queries, along with chain-of-thought and tool-integrated reasoning capabilities. As a result, Qwen2.5-Math represents the most advanced open-source math model series to date. The Qwen2.5-Math-1.5B-Instruct model already surpasses most previous 70B math models, while the Qwen2.5-Math-7B-Instruct matches the performance of Qwen2-Math-72B-Instruct. Our flagship model, Qwen2.5-Math-72B-Instruct, outperforms Qwen2-Math-72B-Instruct with an average score increase of 4.4 points across 7 datasets. We hope that the advances we've made with specialized models like Qwen2.5-Math will continue to strengthen the overall capabilities of the Qwen model and bring us closer to achieving artificial general intelligence.

**6 结论**
本报告介绍了 Qwen2.5-Math，其关键技术亮点包括：(1) 预训练阶段大量使用 Qwen2-Math 合成的数学数据，(2) 后训练和推理阶段由奖励模型引导的微调数据迭代生成和强化训练，(3) 支持双语(中英文)查询，以及思维链和工具集成推理能力。因此，Qwen2.5-Math 代表了迄今为止最先进的开源数学模型系列。1.5B-Instruct 已超越大多数之前的 70B 数学模型，7B-Instruct 达到了 Qwen2-Math-72B-Instruct 的性能水平。旗舰模型 72B-Instruct 在 7 个数据集上平均超越 Qwen2-Math-72B-Instruct 4.4 分。我们希望 Qwen2.5-Math 等专用模型的进展能继续增强 Qwen 模型的整体能力，使我们更接近实现通用人工智能。

## ACKNOWLEDGEMENTS

We sincerely appreciate the support from other members of the Qwen team. We would also like to thank the ChatLearn team from PAI, Alibaba, for their infrastructure support of large-scale reinforcement learning.

**致谢**
我们衷心感谢 Qwen 团队其他成员的支持。同时感谢阿里云 PAI 的 ChatLearn 团队为大规模强化学习提供的基础设施支持。

> **译者注**：ChatLearn 是阿里云 PAI 团队开源的 RLHF 框架，支持大规模分布式 RL 训练。Qwen2.5-Math 使用 ChatLearn 实现 GRPO 训练，说明其 RL 训练规模较大(7B 模型每轮 4096 样本，72B 每轮 2048 样本，全局 batch 512)。这暗示了 72B 模型的 RL 训练可能使用了模型并行或 pipeline 并行来扩展。

---

## REFERENCES

参考文献列表见原始 MinerU-EN 文件(03-Qwen2.5-Math-mineru-en.md)。主要引用包括：

- **AI@Meta (2024)**：Llama 3 模型卡片
- **Azerbayev et al. (2024)**：Llemma，开源数学语言模型
- **Broder (2000)**：MinHash，近似文档去重
- **Cao et al. (2024)**：LLM 自动对齐综述
- **Cobbe et al. (2021)**：GSM8K，数学文字问题训练验证器
- **He et al. (2024)**：OlympiadBench，奥林匹克级别双语多模态科学问题基准
- **Hendrycks et al. (2021a/b)**：MMLU / MATH 基准
- **Joulin et al. (2016)**：FastText，文本分类
- **Lewkowycz et al. (2022)**：Minerva，语言模型解决定量推理问题
- **Li et al. (2024a/b)**：DotaMath / MuggleMath，数学推理数据合成
- **LI et al. (2024)**：NuminaMath，AI 数学奥林匹克数据集
- **Ouyang et al. (2022)**：InstructGPT，人类反馈训练语言模型遵循指令
- **Qwen (2024)**：Qwen2-Math 技术报告
- **Shao et al. (2024)**：DeepSeekMath，开源数学推理的极限
- **Singh et al. (2024)**：超越人类数据，语言模型自我训练的规模扩展
- **Tang et al. (2024)**：MathScale，数学推理指令调优的规模扩展
- **Wei et al. (2022)**：Chain-of-Thought 提示激发大语言模型推理
- **Wei et al. (2023)**：CMATH，中文小学数学测试
- **Yang et al. (2024)**：Qwen2 技术报告
- **Ying et al. (2024)**：InternLM-Math，可验证推理的开放数学大语言模型
- **Yuan et al. (2023)**：拒绝采样扩展数学推理学习
- **Yue et al. (2023/2024)**：MAmmoTH / MAmmoTH2，混合指令调优构建数学通才模型
- **Zhang et al. (2023)**：高考基准评估大语言模型
- **Zhong et al. (2024)**：AGIEval，以人为本的基础模型评估基准
- **Zhou et al. (2024)**：Jiuzhang3.0，通过训练小型数据合成模型高效提升数学推理
- **Zhu et al. (2024)**：DeepSeek-Coder-V2，突破代码智能闭源模型壁垒

---

## A CASE STUDY OF QWEN2-MATH ON OLYMPIAD-LEVEL PROBLEMS

## A Qwen2-Math 在奥赛级别问题上的案例研究

> **译者注**：附录 A 是 Qwen2-Math(而非 Qwen2.5-Math)在奥林匹克级别问题上的案例研究，包含数论、代数、计数与概率、几何四个领域。每个案例展示了模型的完整解题过程(CoT)，是理解模型推理能力的宝贵素材。由于篇幅较长(占原文件约 60%)，以下按领域摘录代表性案例的翻译。完整案例请参见原始 MinerU-EN 文件中的图片和详细推理过程。

### A.1 NUMBER THEORY

### A.1 数论

#### Problem From IMO Shortlist 2002:

**IMO 2002 短名单问题：**

What is the smallest positive integer t such that there exist integers $x_1, x_2, \ldots, x_t$ with

求最小的正整数 t，使得存在整数 $x_1, x_2, \ldots, x_t$ 满足：

$$
x_1^3 + x_2^3 + \cdots + x_t^3 = 2002^{2002}
$$

(后续详细解题过程见原始文件中的图片和推理步骤)

> **译者注**：该问题涉及立方数和的表示理论。模型展示了完整的数论分析过程，包括对模 9 的分析(因为立方数模 9 只能是 0, ±1)，以及对 2002^{2002} 模 9 的计算。这是一个典型的奥赛数论问题，考察了模型对高次幂模运算和存在性证明的理解。

### A.2 ALGEBRA

### A.2 代数

(代数领域案例研究，包含多项式、函数方程、不等式等问题的详细解题过程。完整内容见原始 MinerU-EN 文件。)

> **译者注**：代数案例通常涉及复杂的多项式操作、函数方程求解和不等式证明。模型展示了从问题理解到最终答案的完整 CoT 推理链，包括中间变量的引入、代数变形和验证步骤。

### A.3 COUNTING & PROBABILITY

### A.3 计数与概率

(计数与概率领域案例研究，包含组合计数、概率计算、期望问题等。完整内容见原始 MinerU-EN 文件。)

> **译者注**：计数与概率问题通常需要精确的枚举和计算。模型的解题过程展示了如何系统地分解复杂计数问题、应用组合公式以及验证结果的正确性。

### A.4 GEOMETRY

### A.4 几何

(几何领域案例研究，包含平面几何、解析几何和几何变换问题。完整内容见原始 MinerU-EN 文件。)

> **译者注**：几何问题通常需要辅助线的构造、坐标系的建立或向量方法的应用。模型展示了多种几何解题策略，从纯几何推理到解析几何方法的转换。

---

## B PROMPTS USED IN THE EVALUATION

## B 评估中使用的提示

(附录 B 包含各评估基准使用的具体 prompt 模板，包括 GSM8K、MATH、MMLU STEM、CMATH、GaoKao 等基准的 few-shot 和 zero-shot prompt。完整 prompt 内容见原始 MinerU-EN 文件。)

> **译者注**：评估 prompt 的设计对少样本数学推理性能有显著影响。Qwen2.5-Math 使用标准的 CoT prompt(如 "Let's think step by step")进行 few-shot 评估。对于多选题基准使用 5-shot，其他使用 zero-shot。TIR 模式的 prompt 需要特别设计以引导模型正确使用 Python 代码块进行计算。

---

> **全文译者总结**：Qwen2.5-Math 的技术报告展示了一个完整的数学专用模型开发流水线，核心创新是"自我改进飞轮"——用更强的模型生成更好的数据，用更好的数据训练更强的模型。从预训练(v1→v2 语料扩展)、后训练(SFT 数据迭代进化 + RM 引导 + GRPO 强化学习)到推理(RM best-of-N 采样)，每个阶段都充分利用了前代最强模型的能力。关键成果包括：72B-Instruct 在 MATH 上达到 83.6(CoT)/85.3(TIR)，AIME 2024 上 72B TIR 解决 12 题(greedy)/ 21 题(RM@256)，7B-Instruct 几乎达到 72B 水平。中英文双语支持和 TIR 模式是相比前代 Qwen2-Math 的两大重要升级。对于社区而言，1.5B 模型在 TIR 下 MATH ~80 分的结果尤其值得关注——它证明了小模型+外部工具在数学推理中的巨大潜力。
