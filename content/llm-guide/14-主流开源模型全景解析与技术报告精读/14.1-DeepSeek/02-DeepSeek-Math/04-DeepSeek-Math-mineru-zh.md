---
title: "04 · DeepSeek-Math Technical Report (MinerU 中文精译与译者注)"
source: 03-DeepSeek-Math-mineru-en.md
source_pdf: pdfs/DeepSeek-Math.pdf
date: 2026-05-23
---

# DeepSeekMath: Pushing the Limits of Mathematical Reasoning in Open Language Models

>  **[返回 14.1-DeepSeek 家族总览](../../14.1-DeepSeek.md)**

## 原文标题说明

- 原文标题: DeepSeekMath: Pushing the Limits of Mathematical Reasoning in Open Language Models
- 原文作者: DeepSeek-AI, 清华大学, 北京大学
- 原文来源: arXiv:2402.03300
- 逐译底稿: `03-DeepSeek-Math-mineru-en.md`
- 关联精译: `01-DeepSeek-Math技术报告精译.md`
- 关联专题: `05-DeepSeek-Math-Mathematical-Reasoning.md`

## 分节结构

1. 摘要
2. 引言
3. 数学预训练
4. 监督微调
5. 强化学习
6. 讨论与结论
7. 附录中的 RL 统一分析

---

## Abstract

### 原文

Mathematical reasoning poses a significant challenge for language models due to its complex and structured nature. In this paper, we introduce DeepSeekMath 7B, which continues pretraining DeepSeek-Coder-Base-v1.5 7B with 120B math-related tokens sourced from Common Crawl, together with natural language and code data.

DeepSeekMath 7B has achieved an impressive score of 51.7% on the competition-level MATH benchmark without relying on external toolkits and voting techniques, approaching the performance level of Gemini-Ultra and GPT-4.

Self-consistency over 64 samples from DeepSeekMath 7B achieves 60.9% on MATH.

The mathematical reasoning capability of DeepSeekMath is attributed to two key factors: First, we harness the significant potential of publicly available web data through a meticulously engineered data selection pipeline. Second, we introduce Group Relative Policy Optimization (GRPO), a variant of Proximal Policy Optimization (PPO), that enhances mathematical reasoning abilities while concurrently optimizing the memory usage of PPO.

### 译文

数学推理由于其高度复杂且结构化的特性，一直是语言模型面临的核心难题之一。本文提出 DeepSeekMath 7B，它在 DeepSeek-Coder-Base-v1.5 7B 的基础上继续预训练，使用了来自 Common Crawl 的 120B 数学相关 token，并混合自然语言与代码数据共同训练。

在不依赖外部工具和多数投票技巧的条件下，DeepSeekMath 7B 在竞赛级 MATH 基准上取得了 51.7% 的成绩，已经逼近当时 Gemini-Ultra 和 GPT-4 的水平。

如果使用 64 个样本进行 self-consistency，DeepSeekMath 7B 在 MATH 上还能进一步提升到 60.9%。

作者认为，这一数学推理能力主要来自两个因素：第一，通过精心设计的数据筛选流水线，充分挖掘了公开网页中的数学内容价值; 第二，引入了 Group Relative Policy Optimization，也就是 GRPO，这一 PPO 变体在提升数学推理能力的同时，还显著降低了强化学习训练时的内存成本。

> 译者注: 这篇论文的分量不只在“7B 接近 GPT-4 的数学成绩”，更在于它同时给出了两条后来被 DeepSeek 全系继承的方法论：一条是数学数据工程，一条是 GRPO 强化学习。这两条线最终都直接流向了 DeepSeek-R1。

![开源模型在竞赛级 MATH 基准上的 Top1 准确率演进](./images/figure_01_math_benchmark_progress.jpg)

> Figure 1 | Top1 accuracy of open-source models on the competition-level MATH benchmark.
>
> 图 1：开源模型在竞赛级 MATH 基准上的 Top1 准确率演进。

---

## 1. Introduction

### 原文

Large language models (LLM) have revolutionized the approach to mathematical reasoning in artificial intelligence, spurring significant advancements in both the quantitative reasoning benchmark and the geometry reasoning benchmark.

However, cutting-edge models such as GPT-4 and Gemini-Ultra are not publicly available, and the currently accessible open-source models considerably trail behind in performance.

In this study, we introduce DeepSeekMath, a domain-specific language model that significantly outperforms the mathematical capabilities of open-source models and approaches the performance level of GPT-4 on academic benchmarks.

### 译文

大语言模型已经改变了人工智能处理数学推理问题的方式，无论是在定量推理还是几何推理上，都推动了明显进步。

但问题在于，最强的一批模型，比如 GPT-4 和 Gemini-Ultra，当时都不是开放可用的; 而真正开源可用的模型，在数学推理能力上仍然明显落后。

因此，这篇工作提出了一个非常明确的目标：训练一个面向数学推理的专用模型 DeepSeekMath，让它在开源模型里显著领先，并尽量逼近 GPT-4 的学术基准表现。

### 原文

DeepSeekMath-Base is initialized with DeepSeek-Coder-Base-v1.5 7B, as we notice that starting from a code training model is a better choice compared to a general LLM.

### 译文

DeepSeekMath-Base 不是从通用语言模型出发，而是从 DeepSeek-Coder-Base-v1.5 7B 初始化，因为作者发现，从代码训练模型出发比从通用 LLM 出发更有效。

> 译者注: 这是这篇论文最关键的经验结论之一。它本质上回答了一个后来在推理模型里反复被验证的问题：代码能力和数学推理能力底层上是相通的，尤其体现在步骤拆解、符号处理和程序化思维上。

### 原文

After pre-training, we apply mathematical instruction tuning to DeepSeekMath-Base with chain-of-thought, program-of-thought, and tool-integrated reasoning data.

Furthermore, we introduce the Group Relative Policy Optimization (GRPO), a variant reinforcement learning algorithm of Proximal Policy Optimization (PPO).

### 译文

预训练完成后，作者继续用 CoT、PoT 和工具集成推理数据对 DeepSeekMath-Base 做数学指令微调。

在此基础上，他们进一步提出了 GRPO，也就是 Group Relative Policy Optimization，作为 PPO 的一种新变体，用于强化学习阶段。

---

## 2. Math Pre-Training

### 2.1 Data Collection and Decontamination

### 原文

In this section, we outline the process of constructing the DeepSeekMath Corpus from Common Crawl. We present an iterative pipeline that demonstrates how to systematically gather a large-scale mathematical corpus from Common Crawl, starting with a seed corpus.

### 译文

这一节介绍作者如何从 Common Crawl 中构建 DeepSeekMath Corpus。他们不是简单地把网页抓下来，而是设计了一条迭代式的数据流水线：从一个小规模但高质量的数学种子语料开始，逐轮扩展，持续把更多高质量数学网页召回进来。

![从 Common Crawl 迭代收集数学网页的流程图](./images/figure_02_data_collection_pipeline.jpg)

> Figure 2 | An iterative pipeline that collects mathematical web pages from Common Crawl.
>
> 图 2：从 Common Crawl 中迭代收集数学网页的流程。

### 原文

We choose OpenWebMath as our initial seed corpus. Using this corpus, we train a fastText model to recall more OpenWebMath-like mathematical web pages.

### 译文

作者选择 OpenWebMath 作为初始种子语料。基于这批种子数据，他们训练了一个 fastText 分类器，用来从 Common Crawl 中召回更多风格相近的数学网页。

### 原文

After four iterations of data collection, we end up with 35.5M mathematical web pages, totaling 120B tokens.

### 译文

经过四轮迭代后，最终收集到 3550 万个数学网页，总规模达到 120B token。

> 译者注: 这里的关键不是“训练了一个分类器”，而是它用了“召回 - 标注 - 再训练”的迭代策略。也就是说，这不是一次性静态过滤，而是一个不断增强召回范围的数据自举过程。

### 2.2 Validating the Quality of the DeepSeekMath Corpus

### 原文

We run pre-training experiments to investigate how the DeepSeekMath Corpus compares with recently released math-training corpora.

### 译文

作者随后通过预训练实验，系统比较 DeepSeekMath Corpus 与其他数学训练语料的效果，包括 MathPile、OpenWebMath 和 Proof-Pile-2。

### 原文

The DeepSeekMath Corpus is of high quality, covers multilingual mathematical content, and is the largest in size.

### 译文

实验结论是，DeepSeekMath Corpus 既有更高质量的数学内容，也覆盖了多语言数学语料，同时还是规模最大的一个。

![不同数学语料上的基准曲线 1](./images/chart_03_corpus_curve_1.jpg)
![不同数学语料上的基准曲线 2](./images/chart_04_corpus_curve_2.jpg)
![不同数学语料上的基准曲线 3](./images/chart_05_corpus_curve_3.jpg)
![不同数学语料上的基准曲线 4](./images/chart_06_corpus_curve_4.jpg)

> Figure 3 | Benchmark curves of DeepSeek-LLM 1.3B trained on different mathematical corpora.
>
> 图 3：DeepSeek-LLM 1.3B 在不同数学语料上训练时的基准曲线。

> 译者注: 这里最有意思的发现是，arXiv 并不像很多人想象的那样天然适合数学模型。网页中的数学内容虽然看起来“没那么正式”，但更贴近竞赛题和真实数学问答的表达方式，反而更有效。

### 2.3 Training and Evaluating DeepSeekMath-Base 7B

### 原文

Our model is initialized with DeepSeek-Coder-Base-v1.5 7B and trained for 500B tokens. The distribution of the data is as follows: 56% from the DeepSeekMath Corpus, 4% from AlgebraicStack, 10% from arXiv, 20% Github code, and the remaining 10% natural language data from Common Crawl in both English and Chinese.

### 译文

DeepSeekMath-Base 7B 使用 DeepSeek-Coder-Base-v1.5 7B 初始化，并继续训练 500B token。训练数据分布大致如下：56% 来自 DeepSeekMath Corpus，4% 来自 AlgebraicStack，10% 来自 arXiv，20% 来自 GitHub 代码，剩余 10% 是中英文自然语言网页数据。

### 原文

DeepSeekMath-Base 7B leads in performance across all eight benchmarks among the open-source base models.

### 译文

在基座模型比较中，DeepSeekMath-Base 7B 在全部八个数学基准上都领先其他开源基座模型。

---

## 3. Supervised Fine-Tuning

### 3.1 SFT Data Curation

### 原文

We construct a mathematical instruction-tuning dataset covering English and Chinese problems from different mathematical fields and of varying complexity levels.

### 译文

作者构建了一套覆盖中英文、不同数学领域和不同难度层级的数学指令微调数据集。

### 原文

The total number of training examples is 776K.

### 译文

这套 SFT 数据总规模达到 776K 条训练样本。

### 3.2 Training and Evaluating DeepSeekMath-Instruct 7B

### 原文

As shown in Table 5, under the evaluation setting where tool use is disallowed, DeepSeekMath-Instruct 7B demonstrates strong performance of step-by-step reasoning.

Under the evaluation setting where models are allowed to integrate natural language reasoning and program-based tool use for problem solving, DeepSeekMath-Instruct 7B approaches an accuracy of 60% on MATH.

### 译文

如表 5 所示，在不允许调用工具的评测设定下，DeepSeekMath-Instruct 7B 已经展现出很强的逐步推理能力。

而在允许结合自然语言推理和程序化工具求解的设定下，DeepSeekMath-Instruct 7B 在 MATH 上已经逼近 60% 准确率。

---

## 4. Reinforcement Learning

### 4.1 Group Relative Policy Optimization

### 4.1.1 From PPO to GRPO

### 原文

PPO is an actor-critic RL algorithm widely used in RL fine-tuning of LLMs.

As the value function employed in PPO is typically another model of comparable size as the policy model, it brings a substantial memory and computational burden.

To address this, we propose GRPO, which uses the average reward of multiple sampled outputs for the same question as the baseline.

### 译文

PPO 是大语言模型强化学习微调中非常常见的一种 actor-critic 算法。

但问题在于，PPO 依赖一个与策略模型规模相近的 value model 来估计优势值，这会显著增加显存和计算负担。

为了解决这个问题，论文提出了 GRPO。它不再训练独立的 value model，而是对同一个问题采样一组输出，用这组输出的平均奖励作为基线。

![PPO 与 GRPO 的结构对比图](./images/figure_07_ppo_grpo_demo.jpg)

> Figure 4 | Demonstration of PPO and our GRPO.
>
> 图 4：PPO 与 GRPO 的结构对比示意。

> 译者注: GRPO 的关键价值不是“换了一个损失函数名字”，而是把 PPO 最重的一部分成本，也就是 value model，直接拿掉了。这让它后来能自然扩展到更大模型和更长推理链场景。

### 4.1.2 Outcome Supervision RL with GRPO

### 原文

Outcome supervision provides the normalized reward at the end of each output and sets the advantages of all tokens in the output as the normalized reward.

### 译文

在结果监督设定下，每个输出只在最终答案处获得一个归一化奖励，而该输出中所有 token 的优势值都共享这一个最终奖励。

### 4.1.3 Process Supervision RL with GRPO

### 原文

Process supervision provides a reward at the end of each reasoning step.

### 译文

在过程监督设定下，奖励不再只在最终答案处给出，而是会在每一个推理步骤结束时提供一步级别的奖励。

### 4.1.4 Iterative RL with GRPO

### 原文

We also explore iterative RL with GRPO, where the reward model and policy model are both updated across iterations.

### 译文

作者还探索了基于 GRPO 的迭代式强化学习：策略模型和奖励模型都随着迭代一起更新。

### 4.2 Training and Evaluating DeepSeekMath-RL

### 原文

DeepSeekMath-RL 7B attains accuracies of 88.2% and 51.7% on GSM8K and MATH respectively with chain-of-thought reasoning.

### 译文

在 CoT 推理设定下，DeepSeekMath-RL 7B 在 GSM8K 和 MATH 上分别达到了 88.2% 和 51.7%。

![不同方法进一步训练后的性能对比](./images/figure_08_methods_comparison.jpg)

> Figure 5 | Performance of the DeepSeekMath-Instruct 1.3B model further trained using various methods.
>
> 图 5：DeepSeekMath-Instruct 1.3B 进一步使用不同方法训练后的性能对比。

![迭代强化学习带来的收益](./images/figure_09_iterative_rl.jpg)

> Figure 6 | Performance of iterative reinforcement learning with DeepSeekMath-Instruct 7B.
>
> 图 6：DeepSeekMath-Instruct 7B 的迭代强化学习性能。

![Maj@K / Pass@K 图例](./images/figure_10_maj_pass_intro.jpg)
![Maj@K / Pass@K 在 GSM8K 上的变化](./images/chart_11_maj_pass_gsm8k.jpg)
![Maj@K / Pass@K 在 MATH 上的变化](./images/chart_12_maj_pass_math.jpg)

> Figure 7 | The Maj@K and Pass@K of SFT and RL DeepSeekMath 7B on GSM8K and MATH.
>
> 图 7：SFT 与 RL 版本 DeepSeekMath 7B 在 GSM8K 和 MATH 上的 Maj@K 与 Pass@K 变化。

> 译者注: 这组图非常关键，因为它把 RL 的实际收益说清楚了：RL 主要提升的是输出分布的稳定性，也就是 Maj@K，而不是简单地把模型“本体能力”重新训练一遍。

---

## 5. Discussion

### 5.1 Lessons Learnt in Pre-Training

### 5.1.1 Code Training Benefits Mathematical Reasoning

### 原文

Code training improves models' ability to do mathematical reasoning both with and without tool use.

### 译文

代码训练能够同时提升模型在“借助工具”和“不借助工具”两种情形下的数学推理能力。

### 5.1.2 ArXiv Papers Seem Ineffective in Improving Mathematical Reasoning

### 原文

ArXiv papers seem ineffective in improving mathematical reasoning.

### 译文

论文的一个重要消融结论是：单纯依赖 arXiv 论文，并不能有效提升数学推理能力。

> 译者注: 这是这篇论文最反直觉、也最有价值的结论之一。它说明“形式上看起来像数学”的数据，不等于“真正能提升数学解题能力”的数据。

### 5.2 Insights of Reinforcement Learning

### 5.2.1 Towards a Unified Paradigm

### 原文

We provide a unified paradigm to analyze different training methods, such as SFT, RFT, DPO, PPO, and GRPO.

### 译文

作者尝试给出一个统一框架，用来同时理解 SFT、RFT、DPO、PPO 和 GRPO 这些训练方法。

### 5.2.2 Why RL Works?

### 原文

RL enhances Maj@K's performance but not Pass@K.

### 译文

论文观察到，RL 显著提升了 Maj@K，但并没有对应地提升 Pass@K。

> 译者注: 这个结论非常深。它说明 RL 的主要作用，是让模型更稳定地输出它“本来就会”的正确推理路径，而不是凭空赋予它新的数学知识。

### 5.2.3 How to Achieve More Effective RL?

### 原文

We provide some potential future directions about the three components: data source, algorithm, and reward function.

### 译文

最后，作者围绕数据来源、算法和奖励函数这三个核心部件，总结了未来提升强化学习效果的潜在方向。

---

## 6. Conclusion, Limitation, and Future Work

### 原文

We present DeepSeekMath, which outperforms all open-source models on the competition-level MATH benchmark and approaches the performance of closed models.

Although DeepSeekMath achieves impressive scores on quantitative reasoning benchmarks, its capability on geometry and theorem-proof are relatively weaker than closed models.

### 译文

论文最终给出的结论是：DeepSeekMath 已经在竞赛级 MATH 基准上超过所有开源模型，并逼近闭源模型水平。

但作者也明确承认，它在几何题和定理证明任务上的能力仍然弱于顶级闭源模型，这一部分仍然有明显改进空间。

> 译者注: 这段局限性非常值得保留，因为它恰好说明 DeepSeekMath 不是“神奇地什么都变强了”，而是在代数、竞赛题和可程序化推理上先完成突破，然后再把这些方法继续外推到更难的推理场景。

---

## A. Appendix

### A.1 Analysis of Reinforcement Learning

### 原文

We provide the detailed derivation of the data source and gradient coefficient across various methods, including SFT, RFT, Online RFT, DPO, PPO, and GRPO.

### 译文

附录 A 主要给出了 SFT、RFT、Online RFT、DPO、PPO 和 GRPO 等方法在数据来源、奖励函数和梯度系数层面的统一推导。

> 译者注: 这一附录是整篇论文理论价值最高的一部分之一。它不只是介绍 GRPO，而是试图把一大串“看似不同”的后训练方法放进同一数学框架里理解。后来的 DeepSeek-R1，实际上正是建立在这个统一框架思路之上。

---

## 全文完

## 关联文件说明

- 英文底稿: `03-DeepSeek-Math-mineru-en.md`
- 前序精译: `01-DeepSeek-Math技术报告精译.md`
- 数理逻辑专题: `05-DeepSeek-Math-Mathematical-Reasoning.md`
- 目录索引: `05-DeepSeek-Math-Index.md`
