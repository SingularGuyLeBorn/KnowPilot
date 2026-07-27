---
title: "01 · DeepSeek-Math 技术报告精读"
status: completed
date: 2026-05-19
---

# DeepSeek-Math 技术报告精译

>  **[返回 14.1-DeepSeek 家族总览](../../14.1-DeepSeek.md)**


> 原文标题: DeepSeekMath: Pushing the Limits of Mathematical Reasoning in Open Language Models
> 原文链接: https://arxiv.org/abs/2402.03300
> 发布日期: 2024-02-05
> 发布机构: DeepSeek-AI, 清华大学, 北京大学

---

## 摘要

数学推理对语言模型提出了重大挑战，因其复杂且结构化的特性。本文中，我们介绍了 DeepSeekMath 7B，它从 DeepSeek-Coder-Base-v1.5 7B 出发，在来自 Common Crawl 的 120B 数学相关 token 以及自然语言和代码数据上继续预训练。DeepSeekMath 7B 在竞赛级 MATH 基准上取得了令人印象深刻的 51.7% 分数，未借助外部工具包和投票技术，接近 Gemini-Ultra 和 GPT-4 的性能水平。来自 DeepSeekMath 7B 的 64 样本自一致性在 MATH 上达到 60.9%。DeepSeekMath 的数学推理能力归因于两个关键因素:首先，我们通过精心设计的数据选择流水线，挖掘了公开网页数据的巨大潜力。其次，我们引入了 Group Relative Policy Optimization(GRPO，分组相对策略优化)，一种 Proximal Policy Optimization(PPO)的变体，在增强数学推理能力的同时优化了 PPO 的内存使用。

> 谱系与影响节点: DeepSeek-Math 是 DeepSeek 家族中强化学习方法的「原点」。GRPO 算法首次在此论文中提出，随后被 DeepSeek-V2、DeepSeek-Coder-V2、DeepSeek-V3 和 DeepSeek-R1 完整继承，成为 DeepSeek 后训练阶段的事实标准。论文的另一个重要贡献是「从 Common Crawl 提取数学数据」的流水线——四迭代 fastText 分类器 + 域名标注的策略，后来被 DeepSeek-Coder-V2 的数学语料收集直接复用。DeepSeek-Math 还回答了一个长期问题:「代码训练是否提升推理能力?」答案是肯定的，至少对数学推理而言。

---

## 1. 引言

大语言模型彻底改变了人工智能中数学推理的方法，在定量推理基准和几何推理基准上都取得了显著进步。此外，这些模型已被证明在协助人类解决复杂数学问题方面发挥了重要作用。然而，GPT-4 和 Gemini-Ultra 等尖端模型并未公开可用，当前可访问的开源模型在性能上明显落后。

在本研究中，我们介绍了 DeepSeekMath，一个领域特定语言模型，在数学能力上显著超越开源模型，并在学术基准上接近 GPT-4 的性能水平。

为实现这一目标，我们创建了 DeepSeekMath Corpus，一个包含 120B 数学 token 的大规模高质量预训练语料库。该数据集使用基于 fastText 的分类器从 Common Crawl 中提取。在初始迭代中，分类器使用 OpenWebMath 的实例作为正例，同时纳入多样化的其他网页作为负例进行训练。随后，我们使用分类器从 Common Crawl 中挖掘更多正例，并通过人工标注进一步精炼。然后用这个增强的数据集更新分类器以提升性能。评估结果表明，大规模语料库质量很高，我们的基座模型 DeepSeekMath-Base 7B 在 GSM8K 上达到 64.2%、在竞赛级 MATH 数据集上达到 36.2%，超越了 Minerva 540B。此外，DeepSeekMath Corpus 是多语言的，我们注意到在中文数学基准上也有提升。我们相信我们在数学数据处理方面的经验是研究社区的起点，未来仍有显著的改进空间。

DeepSeekMath-Base 使用 DeepSeek-Coder-Base-v1.5 7B 初始化，因为我们发现从代码训练模型开始比从通用大语言模型开始是更好的选择。此外，我们观察到数学训练也提升了模型在 MMLU 和 BBH 基准上的能力，表明它不仅增强了数学能力，还放大了通用推理能力。

预训练后，我们对 DeepSeekMath-Base 应用数学指令微调，使用链式思维(Chain-of-Thought, CoT)、程序思维(Program-of-Thought, PoT)和工具集成推理数据。 resulting 模型 DeepSeekMath-Instruct 7B 击败了所有 7B 同类模型，并与 70B 开源指令微调模型相当。

此外，我们引入了 Group Relative Policy Optimization(GRPO)，一种 Proximal Policy Optimization(PPO)的变体强化学习算法。GRPO 摒弃了 Critic 模型，转而从组分数估计基线，显著减少了训练资源。仅使用英语指令微调数据的一个子集，GRPO 就在强大的 DeepSeekMath-Instruct 上取得了实质性提升，包括领域内(GSM8K: 82.9% → 88.2%, MATH: 46.8% → 51.7%)和领域外数学任务(如 CMATH: 84.6% → 88.8%)。

我们还提供了一个统一范式来理解不同方法，如 Rejection Sampling Fine-Tuning(RFT)、Direct Preference Optimization(DPO)、PPO 和 GRPO。基于这一统一范式，我们发现所有这些方法在概念上都可以归类为直接或简化的强化学习技术。我们还进行了广泛的实验(在线 vs 离线训练、结果监督 vs 过程监督、单轮 vs 迭代强化学习等)，以深入探究这一范式的基本要素。最后，我们解释了为什么我们的强化学习提升了指令微调模型的性能，并进一步基于这一统一范式总结了实现更有效强化学习的潜在方向。

> 设计动机节点: 为什么从代码模型而非通用模型初始化? 论文给出的答案是实验性的:「我们发现从代码训练模型开始是更好的选择」。背后的工程直觉是:数学推理和代码推理在底层能力上有显著重叠——两者都需要严格的逻辑推导、符号操作和步骤化思维。代码预训练让模型学会了「按照精确的语法规则逐步构造输出」，这种能力可以直接迁移到数学证明和计算中。论文表 10 的对比也支持这一点:DeepSeek-Coder-Base-v1.5 7B 在数学基准上已经远超通用模型 Mistral 7B(GSM8K 43.2% vs 40.3%, MATH 19.2% vs 14.3%)。这为后续 DeepSeek-R1 的「代码 → 推理」迁移假设提供了早期证据。

### 1.1 主要贡献

**大规模数学预训练**
- 我们的研究提供了有力证据，证明公开可访问的 Common Crawl 数据包含对数学有价值的丰富信息。通过实施精心设计的数据选择流水线，我们成功构建了 DeepSeekMath Corpus，一个从网页中过滤数学内容得到的高质量 120B token 数据集。这几乎是 Minerva 使用的数学网页的 7 倍，是最近发布的 OpenWebMath 的 9 倍。
- 我们的预训练基座模型 DeepSeekMath-Base 7B 取得了与闭源 Minerva 540B 相当的性能，表明参数量并非数学推理能力的唯一关键因素。在高质量数据上预训练的小模型也能取得强劲表现。
- 我们分享了数学训练实验的发现。代码训练先于数学训练提升了模型有工具和不用工具解决数学问题的能力。这为长期存在的问题「代码训练是否提升推理能力?」提供了部分答案:我们认为是的，至少对数学推理而言。
- 尽管在许多数学相关论文中，在 arXiv 论文上训练是常见做法，但它在本文采用的所有数学基准上都没有带来显著改进。

**强化学习的探索与分析**
- 我们引入了 Group Relative Policy Optimization(GRPO)，一种高效且有效的强化学习算法。GRPO 摒弃了 Critic 模型，转而从组分数估计基线，与 PPO 相比显著减少了训练资源。
- 我们证明了 GRPO 仅使用指令微调数据就显著增强了 DeepSeekMath-Instruct 的性能。此外，我们在强化学习过程中观察到领域外性能的提升。
- 我们提供了一个统一范式来理解 RFT、DPO、PPO 和 GRPO 等不同方法。我们还进行了广泛的实验(在线 vs 离线训练、结果 vs 过程监督、单轮 vs 迭代 RL 等)以深入探究这一范式的基本要素。
- 基于我们的统一范式，我们探索了强化学习有效性的原因，并总结了实现更有效大语言模型强化学习的几个潜在方向。

### 1.2 评测与指标概述

- **英文和中文数学推理**: 我们在英文和中文基准上全面评估模型，涵盖从小学到大学级别的数学问题。英文基准包括 GSM8K、MATH、SAT、OCW Courses、MMLU-STEM;中文基准包括 MGSM-zh、CMATH、Gaokao-MathCloze 和 Gaokao-MathQA。我们评估模型生成自包含文本解答(不用工具)和使用 Python 解决问题的能力。DeepSeekMath-Base 在英文基准上与闭源 Minerva 540B 相当，并超越所有开源基座模型。在中文基准上表现尤为出色，因为我们不仅收集英文数学预训练数据，还包含高质量的非英文数据。经过数学指令微调和强化学习，DeepSeekMath-Instruct 和 DeepSeekMath-RL 在开源社区首次在竞赛级 MATH 数据集上取得超过 50% 的准确率。
- **形式化数学**: 我们使用 miniF2F 上的 informal-to-formal 定理证明任务评估 DeepSeekMath-Base，选择 Isabelle 作为证明助手。DeepSeekMath-Base 展示了强大的少样本自动形式化性能。
- **自然语言理解、推理和代码**: 为构建模型通用理解、推理和编码能力的全面画像，我们在 MMLU、BBH、HumanEval 和 MBPP 上评估 DeepSeekMath-Base。数学预训练对语言理解和推理性能都有益。

---

## 2. 数学预训练

### 2.1 数据收集与去污染

在本节中，我们将概述从 Common Crawl 构建 DeepSeekMath Corpus 的过程。如图 1 所示，我们展示了一个迭代流水线，演示如何系统地从 Common Crawl 收集大规模数学语料库，从种子语料库(如小规模但高质量的数学相关数据集)开始。值得注意的是，这种方法也适用于其他领域，如代码。

> 图 1: 从 Common Crawl 收集数学网页的迭代流水线。(见 `images/pipeline.pdf`)

首先，我们选择 OpenWebMath 作为初始种子语料库。使用该语料库，我们训练一个 fastText 模型来召回更多类似 OpenWebMath 的数学网页。具体而言，我们从种子语料库中随机选择 50 万个数据点作为正训练样本，从 Common Crawl 中选择另外 50 万个网页作为负样本。训练配置:向量维度 256，学习率 0.1，最大词 n-gram 长度 3，最小词出现次数 3，训练轮数 3。

为减小原始 Common Crawl 的规模，我们采用基于 URL 的去重和近去重技术，得到 400 亿个 HTML 网页。然后用 fastText 模型从去重后的 Common Crawl 中召回数学网页。为过滤低质量数学内容，我们根据 fastText 模型预测的分数对收集的页面排序，仅保留排名靠前的页面。

第一轮数据收集后，大量数学网页仍未被收集，主要原因是 fastText 模型缺乏足够的多样性。因此我们识别额外的数学网页来源来丰富种子语料库。具体而言，我们将整个 Common Crawl 组织为不相交的域名;域名定义为共享相同基础 URL 的网页。对每个域名，我们计算第一轮收集中被收集的网页百分比。超过 10% 网页被收集的域名被归类为数学相关(如 mathoverflow.net)。随后，我们人工标注这些识别出的域名中与数学内容相关的 URL。链接到这些 URL 但未被收集的网页将被添加到种子语料库中。

经过四轮数据收集，我们最终获得 3550 万个数学网页，总计 120B token。在第四轮中，我们注意到近 98% 的数据已在第三轮中收集，因此决定停止数据收集。

为避免基准污染，我们过滤掉包含 GSM8K、MATH 等英文数学基准以及 CMATH、AGIEval 等中文基准问题或解答的网页。过滤标准:任何包含与评估基准中任何子串精确匹配的 10-gram 字符串的文本段都被移除。对于短于 10-gram 但至少 3-gram 的基准文本，我们采用精确匹配过滤。

> 工程落地视角: 四迭代数据收集流水线是 DeepSeek 数据工程的核心方法论，后来在 Coder-V2 中被直接复用。其核心洞察是:fastText 分类器的性能受限于训练数据的多样性——第一轮只用 OpenWebMath 作为正例，召回的网页风格单一;通过「域名分析 → 人工标注 URL → 扩展种子语料库」的循环，每轮都能显著提升分类器的覆盖范围。第四轮 98% 的已有数据重复率是一个聪明的停止准则——它避免了边际收益递减后的无效计算。

### 2.2 验证 DeepSeekMath Corpus 的质量

我们通过预训练实验来比较 DeepSeekMath Corpus 与近期发布的数学训练语料库:

- **MathPile**: 8.9B token，多来源语料库(教科书、Wikipedia、ProofWiki、CommonCrawl、StackExchange、arXiv)，其中 majority(超过 85%)来自 arXiv。
- **OpenWebMath**: 13.6B token，从 Common Crawl 过滤的数学内容。
- **Proof-Pile-2**: 51.9B token，包含 OpenWebMath、AlgebraicStack(10.3B 数学代码 token)和 arXiv 论文(28.0B token)。

我们对一个 1.3B 参数的通用预训练语言模型(DeepSeek-LLM 1.3B)分别在每个数学语料库上训练 150B token。

| 数学语料库 | 规模 | GSM8K | MATH | OCW | SAT | MMLU STEM | CMATH | Gaokao MathCloze | Gaokao MathQA |
|------------|------|-------|------|-----|-----|-----------|-------|------------------|---------------|
| 无数学训练 | N/A | 2.9% | 3.0% | 2.9% | 15.6% | 19.5% | 12.3% | 0.8% | 17.9% |
| MathPile | 8.9B | 2.7% | 3.3% | 2.2% | 12.5% | 15.7% | 1.2% | 0.0% | 2.8% |
| OpenWebMath | 13.6B | 11.5% | 8.9% | 3.7% | 31.3% | 29.6% | 16.8% | 0.0% | 14.2% |
| Proof-Pile-2 | 51.9B | 14.3% | 11.2% | 3.7% | 43.8% | 29.2% | 19.9% | 5.1% | 11.7% |
| DeepSeekMath Corpus | 120.2B | 23.8% | 13.6% | 4.8% | 56.3% | 33.1% | 41.5% | 5.9% | 23.6% |

> 表 1: 在不同数学语料库上训练的 DeepSeek-LLM 1.3B 的性能。(使用我们的 100K 词汇量分词器计算语料库规模)

**DeepSeekMath Corpus 高质量、覆盖多语言数学内容、规模最大**:
- **高质量**: 如表 1 所示，在 DeepSeekMath Corpus 上训练的模型表现出明显的性能领先。在 50B token(Proof-Pile-2 的 1 个完整 epoch)时，DeepSeekMath Corpus 训练的模型已优于 Proof-Pile-2，表明 DeepSeekMath Corpus 的平均质量更高。
- **多语言**: DeepSeekMath Corpus 包含多种语言数据，主要以英文和中文为代表。如表 1 所示，在 DeepSeekMath Corpus 上训练提升了英文和中文的数学推理性能。相比之下，现有数学语料库主要以英文为中心，在中文数学推理上提升有限甚至可能损害性能。
- **大规模**: DeepSeekMath Corpus 比现有数学语料库大数倍。学习曲线更陡峭，改进更持久;而基线语料库规模小得多，在训练过程中已被重复多轮，模型性能很快达到平台期。

> 数据与实验节点: 三个引人注目的对比。第一，MathPile 在几乎所有基准上都低于「无数学训练」基线——这说明 arXiv 论文(占 MathPile 85%+)对数学推理能力的提升效果非常有限。第二，DeepSeekMath Corpus 在中文 CMATH 上达到 41.5%，远超 Proof-Pile-2 的 19.9%——这证明了「多语言数学数据」的价值，也解释了为什么 DeepSeekMath-Base 在中文基准上远超 Minerva(后者只用英文数据)。第三，120B vs 51.9B 的规模差异带来了显著的性能差距，说明数学预训练的数据规模仍未饱和。

### 2.3 DeepSeekMath-Base 7B 的训练与评估

本节介绍 DeepSeekMath-Base 7B，一个在数学方面具有强大推理能力的基座模型。我们的模型使用 DeepSeek-Coder-Base-v1.5 7B 初始化，训练 500B token。数据分布如下:56% 来自 DeepSeekMath Corpus，4% 来自 AlgebraicStack，10% 来自 arXiv，20% 来自 GitHub 代码，剩余 10% 为来自 Common Crawl 的中英文自然语言数据。

**逐步推理的数学问题解决** 我们在英文和中文的 8 个基准上评估 DeepSeekMath-Base 使用少样本链式思维提示解决数学问题的性能。如表 2 所示，DeepSeekMath-Base 7B 在所有 8 个基准上领先于开源基座模型。在竞赛级 MATH 数据集上，DeepSeekMath-Base 超越现有开源基座模型超过 10% 的绝对值，并超越了 Minerva 540B——一个闭源基座模型，其参数量是 DeepSeekMath-Base 的 77 倍。

| 模型 | 规模 | GSM8K | MATH | OCW | SAT | MMLU STEM | CMATH | Gaokao MathCloze | Gaokao MathQA |
|------|------|-------|------|-----|-----|-----------|-------|------------------|---------------|
| **闭源基座模型** |
| Minerva | 7B | 16.2% | 14.1% | 7.7% | - | 35.6% | - | - | - |
| Minerva | 62B | 52.4% | 27.6% | 12.0% | - | 53.9% | - | - | - |
| Minerva | 540B | 58.8% | 33.6% | 17.6% | - | 63.9% | - | - | - |
| **开源基座模型** |
| Mistral | 7B | 40.3% | 14.3% | 9.2% | 71.9% | 51.1% | 44.9% | 5.1% | 23.4% |
| Llemma | 7B | 37.4% | 18.1% | 6.3% | 59.4% | 43.1% | 43.4% | 11.9% | 23.6% |
| Llemma | 34B | 54.0% | 25.3% | 10.3% | 71.9% | 52.9% | 56.1% | 11.9% | 26.2% |
| DeepSeekMath-Base | 7B | 64.2% | 36.2% | 15.4% | 84.4% | 56.5% | 71.7% | 20.3% | 35.3% |

> 表 2: DeepSeekMath-Base 7B 与强基座模型在英文和中文数学基准上的对比。(Minerva 结果引用自原文)

**使用工具的数学问题解决** 我们在 GSM8K 和 MATH 上使用少样本 program-of-thought 提示评估程序辅助数学推理。模型被提示通过编写 Python 程序解决问题，可使用 math 和 sympy 等库进行复杂计算。如表 3 所示，DeepSeekMath-Base 7B 超越了先前的 state-of-the-art Llemma 34B。

| 模型 | 规模 | GSM8K+Python | MATH+Python | miniF2F-valid | miniF2F-test |
|------|------|-------------|-------------|---------------|--------------|
| Mistral | 7B | 48.5% | 18.2% | 18.9% | 18.0% |
| CodeLlama | 7B | 27.1% | 17.2% | 16.3% | 17.6% |
| CodeLlama | 34B | 52.7% | 23.5% | 18.5% | 18.0% |
| Llemma | 7B | 41.0% | 18.6% | 20.6% | 22.1% |
| Llemma | 34B | 64.6% | 26.3% | 21.0% | 21.3% |
| DeepSeekMath-Base | 7B | 66.9% | 31.4% | 25.8% | 24.6% |

> 表 3: 基座模型使用工具解决数学问题以及进行 informal-to-formal 定理证明的少样本评估。(miniF2F 使用 Isabelle 证明助手)

**形式化数学** 我们在 miniF2F 上评估 DeepSeekMath-Base 7B 的 informal-to-formal 证明任务。遵循先前工作，我们利用模型生成证明草图，然后执行现成的自动证明器 Sledgehammer 来填补缺失的细节。如表 3 所示，DeepSeekMath-Base 7B 在证明自动形式化方面表现出强劲性能。

**自然语言理解、推理和代码** 我们在 MMLU、BBH、HumanEval 和 MBPP 上评估模型性能。如表 4 所示，DeepSeekMath-Base 7B 相比其前身 DeepSeek-Coder-Base-v1.5 在 MMLU 和 BBH 上表现出显著提升，说明数学训练对语言理解和推理有正向影响。此外，通过包含代码 token 进行继续训练，DeepSeekMath-Base 7B 有效保持了在编码基准上的性能。

| 模型 | 规模 | MMLU | BBH | HumanEval | MBPP |
|------|------|------|-----|-----------|------|
| Mistral | 7B | 62.4% | 55.7% | 28.0% | 41.4% |
| DS-Coder-Base-v1.5(衰减前) | 7B | 42.9% | 42.9% | 40.2% | 52.6% |
| DS-Coder-Base-v1.5 | 7B | 49.1% | 55.2% | 43.2% | 60.4% |
| DeepSeekMath-Base | 7B | 54.9% | 59.5% | 40.9% | 52.6% |

> 表 4: 自然语言理解、推理和代码基准评估。(DS-Coder-Base-v1.5† 是用于训练 DeepSeekMath-Base 的衰减前Checkpoint)

> 数据与实验节点: 表 4 揭示了一个重要的「能力迁移」现象。DeepSeekMath-Base 相比 DeepSeek-Coder-Base-v1.5(最后一行 vs 倒数第二行):MMLU 从 49.1% 提升到 54.9%，BBH 从 55.2% 提升到 59.5%——数学预训练不仅增强了数学能力，还增强了通用推理。但代码能力有轻微下降(HumanEval 43.2% → 40.9%, MBPP 60.4% → 52.6%)，这是「灾难性遗忘」的微弱信号。不过下降幅度很小(约 2-8%)，说明 20% 代码数据 + 10% 自然语言数据的配比有效缓解了遗忘。这个实验为后续所有 DeepSeek 模型的「混合预训练」策略提供了关键证据。

---

## 3. 监督微调

### 3.1 SFT 数据构建

我们构建了一个覆盖不同数学领域和复杂度的数学指令微调数据集，包含英文和中文问题。问题与链式思维(CoT)、程序思维(PoT)和工具集成推理格式的解答配对。训练样本总数为 776K。

- **英文数学数据集**: 我们为 GSM8K 和 MATH 问题标注工具集成解答，并采用 MathInstruct 的子集以及 Lila-OOD 的训练集，其中问题使用 CoT 或 PoT 解决。覆盖代数、概率、数论、微积分和几何等多样化数学领域。
- **中文数学数据集**: 我们收集涵盖 76 个子主题(如线性方程)的中国 K-12 数学问题，解答使用 CoT 和工具集成推理格式标注。

### 3.2 DeepSeekMath-Instruct 7B 的训练与评估

DeepSeekMath-Instruct 7B 基于 DeepSeekMath-Base 进行数学指令微调。训练样本随机连接至最大 4K 上下文长度。模型训练 500 步，批量大小 256，恒定学习率 5e-5。

评估涵盖英文和中文的 4 个定量推理基准，对比当时领先模型:

| 模型 | 规模 | GSM8K | MATH | CMATH | Gaokao MathQA |
|------|------|-------|------|-------|---------------|
| **闭源模型** |
| GPT-4 | - | 92.0% | 52.9% | - | - |
| GPT-4 Code Interpreter | - | 97.0% | 69.7% | - | - |
| Gemini Ultra | - | - | 53.2% | - | - |
| **开源指令模型** |
| DeepSeekMath-Instruct | 7B | 82.9% | 46.8% | 84.6% | 36.3% |
| DeepSeekMath-RL | 7B | 88.2% | 51.7% | 88.8% | 41.3% |

> 表 5: 主要模型在数学推理基准上的性能。(仅列出核心结果, 完整对比见原文)

---

## 4. 强化学习

### 4.1 Group Relative Policy Optimization(GRPO)

我们引入 GRPO，一种 PPO 的变体强化学习算法。GRPO 摒弃了 Critic 模型，转而从组分数估计基线，显著减少了训练资源。

GRPO 的核心思想:对每个问题 $q$，从旧策略模型 $\pi_{\theta_{old}}$ 采样一组输出 $\{o_1, o_2, ..., o_G\}$，奖励模型为每个输出分配奖励 $\{r_1, r_2, ..., r_G\}$。组内归一化的相对优势为:

$$
A_i = \frac{r_i - \text{mean}(\{r_j\})}{\text{std}(\{r_j\})}
$$

GRPO 的目标函数:

$$
J_{GRPO}(\theta) = \mathbb{E}_{q, \{o_i\}} \left[ \frac{1}{G} \sum_{i=1}^{G} \min\left( \frac{\pi_\theta(o_i|q)}{\pi_{\theta_{old}}(o_i|q)} A_i, \text{clip}\left(\frac{\pi_\theta(o_i|q)}{\pi_{\theta_{old}}(o_i|q)}, 1-\epsilon, 1+\epsilon\right) A_i \right) \right]
$$

> 图 2: PPO 与 GRPO 的对比示意图。(见 `images/GRPO.pdf`)

> 架构细节节点: GRPO 与 PPO 的核心差异在于「基线估计方式」。PPO 使用一个与策略模型等大的 Critic 模型来估计状态价值 $V(s)$，然后用 $A = r - V(s)$ 计算优势。Critic 模型需要与策略模型同步训练，不仅 doubling 了显存占用，还引入了「Critic 估计不准 → 优势计算偏差 → 策略更新次优」的误差传播链。GRPO 用「组内均值」替代 Critic，本质上是假设同一问题的多个输出在质量上呈正态分布，用样本均值作为期望奖励的估计。这个假设在数学问题(答案对错分明)上尤为合理，因为同一问题的多个输出通常会聚集在「正确」和「错误」两个模式周围。GRPO 的代价是组大小 $G$ 必须足够大(通常 4-16)才能保证均值估计的稳定性，这增加了每步的采样成本;但相比维护一个完整 Critic 模型，这个代价是可以接受的。

### 4.2 统一范式: 理解 RFT、DPO、PPO 和 GRPO

我们提供一个统一范式来理解不同方法。这些方法在概念上都可以归类为直接或简化的强化学习技术，其核心差异在于三个要素:

1. **数据来源**: 在线采样(从实时训练策略中采样)vs 离线采样(从固定模型采样)。
2. **奖励函数**: 规则奖励(基于答案正确性)vs 模型奖励(训练奖励模型打分)。
3. **算法**: 如何根据奖励信号计算梯度更新策略。

基于这一范式，我们发现:
- **RFT(Rejection Sampling Fine-Tuning)**: 离线采样 + 规则奖励 + 直接最大化似然。本质上是「过滤后的 SFT」。
- **DPO(Direct Preference Optimization)**: 离线采样 + 模型奖励(隐含在偏好对中) + 直接优化策略。本质上是「无需显式奖励模型的 RL」。
- **PPO**: 在线采样 + 模型奖励 + 带 Critic 的策略梯度。
- **GRPO**: 在线采样 + 模型/规则奖励 + 无 Critic 的策略梯度。

> 谱系与影响节点: 这个统一范式是理解后训练方法演进的关键框架。从 RFT → DPO → PPO → GRPO 的演进本质上是一个「简化」过程:RFT 最简单但效果有限(因为它只是从现有样本中筛选好的进行模仿);DPO 省去了奖励模型但受限于离线数据;PPO 最通用但成本最高;GRPO 在 PPO 的基础上砍掉了 Critic，是「效果与成本」的最佳平衡点。这个范式后来被 DeepSeek-R1 进一步扩展，加入了「规则奖励」(编译器/计算器反馈)和「过程奖励模型」，形成了更丰富的奖励信号体系。

### 4.3 强化学习的有效性分析

我们解释了为什么强化学习能提升指令微调模型的性能:

1. **探索 vs 利用**: 强化学习允许策略模型通过采样探索新的解题路径，而 SFT 只能模仿训练数据中的已有路径。
2. **信号密度**: 规则奖励(答案正确性)提供了密集且明确的反馈信号，比 SFT 中的「模仿教师输出」更直接地优化目标性能。
3. **分布外泛化**: 在 RL 训练过程中，我们观察到领域外性能的提升——模型不仅在训练见过的题型上进步，在未见过的题型上也有改进。

基于统一范式，我们总结了实现更有效强化学习的潜在方向:
- **更高效的采样策略**: 减少低质量输出的采样概率。
- **更精细的奖励设计**: 从结果奖励扩展到过程奖励(每个推理步骤的反馈)。
- **迭代强化学习**: 多轮 RL 训练，每轮使用更新后的策略生成新数据。

> 局限与风险节点: 论文中的 RL 实验仅使用了英语指令微调数据的一个子集，这是一个刻意的限制——它证明了即使数据量有限，GRPO 仍然有效。但这也意味着 RL 的潜力可能远未被完全挖掘。此外，「领域外泛化」的观察虽然在实验中成立，但其机制尚不完全清楚:是 RL 让模型学到了更通用的推理策略，还是只是让模型在测试集上「过拟合」得更好? 后续 DeepSeek-R1 通过更大规模的 RL 训练和更严格的测试集时间切割，才更确凿地证明了 RL 的泛化能力。

---

## 5. 结论

本文中，我们介绍了 DeepSeekMath，一个在数学推理能力上显著超越开源模型、接近 GPT-4 性能水平的领域特定语言模型。我们创建了 DeepSeekMath Corpus，一个 120B token 的大规模高质量数学预训练语料库，并引入了 GRPO，一种高效且有效的强化学习算法。实验结果表明，高质量的数据和有效的 RL 算法是提升数学推理能力的关键。

---

## 附录 A: 术语表

| 英文术语 | 中文译名 | 首次出现位置 | 简要解释 |
|----------|----------|------------|----------|
| GRPO | Group Relative Policy Optimization | 摘要 | 分组相对策略优化,无需 Critic 模型的 RL 算法 |
| PPO | Proximal Policy Optimization | 摘要 | 近端策略优化,经典 RL 算法 |
| CoT | Chain-of-Thought | 引言 | 链式思维,逐步推理的提示技术 |
| PoT | Program-of-Thought | 引言 | 程序思维,用代码解决问题的提示技术 |
| RFT | Rejection Sampling Fine-Tuning | 强化学习 | 拒绝采样微调,筛选高质量样本进行 SFT |
| DPO | Direct Preference Optimization | 强化学习 | 直接偏好优化,无需奖励模型的 RL 方法 |
| MATH | - | 摘要 | 竞赛级数学推理基准 |
| GSM8K | - | 数据收集 | 小学数学应用题基准 |
| miniF2F | - | 形式化数学 | 形式化奥林匹克数学基准 |
| Sledgehammer | - | 形式化数学 | Isabelle 证明助手中的自动证明器 |

## 附录 B: 核心数据汇总

| 任务 | 基准 | DS-Math-Base 7B | DS-Math-Instruct 7B | DS-Math-RL 7B |
|------|------|----------------|---------------------|---------------|
| 数学推理 | GSM8K | 64.2% | 82.9% | 88.2% |
| 数学推理 | MATH | 36.2% | 46.8% | 51.7% |
| 数学推理 | CMATH | 71.7% | 84.6% | 88.8% |
| 工具使用 | GSM8K+Python | 66.9% | - | - |
| 工具使用 | MATH+Python | 31.4% | - | - |
| 形式化证明 | miniF2F-test | 24.6% | - | - |
| 通用能力 | MMLU | 54.9% | - | - |
| 通用能力 | BBH | 59.5% | - | - |
| 代码 | HumanEval | 40.9% | - | - |
| 代码 | MBPP | 52.6% | - | - |

## 附录 C: 模型谱系定位

- **直接继承自**: DeepSeek-Coder-Base-v1.5 7B(代码模型,已训练 2T token)
- **核心创新**:
  - 四迭代 fastText 数据收集流水线,从 Common Crawl 提取 120B 数学 token
  - 证明了代码预训练对数学推理的正向迁移效应
  - 发现 arXiv 论文对数学推理提升效果有限
  - 首次提出 GRPO 算法,成为 DeepSeek 家族 RL 的标准方法
  - 提出统一范式理解 RFT/DPO/PPO/GRPO 等后训练方法
- **被后续工作引用/影响**:
  - GRPO 被 DeepSeek-V2/V3/R1 完整继承
  - 数据收集方法被 DeepSeek-Coder-V2 复用
  - 统一范式为后续 RL 研究提供了概念框架
  - 7B 小模型接近 GPT-4 数学能力,证明了高质量数据 + 高效算法 > 纯参数规模
