---
title: "DeepSeek-Coder - 逐段精译与译者注"
source: 03-DeepSeek-Coder-mineru-en.md
translated_by: "AI Agent"
date: 2026-05-19
---

# DeepSeek-Coder: When the Large Language Model Meets Programming - The Rise of Code Intelligence

>  **[返回 14.1-DeepSeek 家族总览](../../14.1-DeepSeek.md)**


DeepSeek-Coder: 当大语言模型遇见编程——代码智能的崛起

> 译者注: 这篇技术报告发表于 2024 年 1 月，是 DeepSeek 在代码模型领域的开山之作。在当时的背景下，开源代码模型(StarCoder、CodeLlama)与闭源模型(Codex、GPT-3.5)之间存在明显差距。DeepSeek-Coder 首次在开源领域缩小了这一差距，并且在 1.3B 到 33B 的多个尺寸上都提供了开源权重。这篇论文提出的核心创新包括：项目级代码语料预训练、16K 长上下文窗口、Fill-In-the-Middle (FIM) 训练策略，以及中英双语代码数据配比。这些设计思路直接影响了后续的 Coder-V2、V2 和 R1。

> 注: 第 1 行 "LeetCode Weekly Contest" 为 MinerU 从 PDF 页眉识别的内容，保留原文。

LeetCode Weekly Contest

Daya Guo\*1, Qihao Zhu∗1,2, Dejian Yang1, Zhenda Xie1, Kai Dong1, Wentao Zhang1   
Guanting Chen1, Xiao Bi 1, Y. Wu1, Y.K. Li1, Fuli Luo1, Yingfei Xiong2, Wenfeng Liang1

郭达雅\*1, 朱祺浩∗1,2, 杨德健1, 谢哲达1, 董凯1, 张文韬1   
陈冠廷1, 毕晓1, 吴翼1, 李昱坤1, 罗福莉1, 熊英飞2, 梁文锋1

1DeepSeek-AI   
2Key Lab of HCST (PKU), MOE; SCS, Peking University {zhuqh, guodaya}@deepseek.com   
https://github.com/deepseek-ai/DeepSeek-Coder

1DeepSeek-AI   
2北京大学高可信软件技术教育部重点实验室; 北京大学软件与微电子学院

## Abstract

The rapid development of large language models has revolutionized code intelligence in software development. However, the predominance of closed-source models has restricted extensive research and development. To address this, we introduce the DeepSeek-Coder series, a range of open-source code models with sizes from 1.3B to 33B, trained from scratch on 2 trillion tokens. These models are pre-trained on a high-quality project-level code corpus and employ a fill-in-the-blank task with a 16K window to enhance code generation and infilling. Our extensive evaluations demonstrate that DeepSeek-Coder not only achieves state-of-the-art performance among open-source code models across multiple benchmarks but also surpasses existing closed-source models like Codex and GPT-3.5. Furthermore, DeepSeek-Coder models are under a permissive license that allows for both research and unrestricted commercial use.

大语言模型的快速发展彻底改变了软件开发中的代码智能。然而，闭源模型的主导地位限制了广泛的研究与开发。为解决这一问题，我们推出了 DeepSeek-Coder 系列，一系列从 1.3B 到 33B 参数的开源代码模型，在 2 万亿 token 上从头训练。这些模型在高质量的项目级代码语料上预训练，并采用 16K 窗口的填空任务来增强代码生成和填充能力。我们的大量评测表明，DeepSeek-Coder 不仅在多个基准上达到了开源代码模型的最先进性能，还超越了 Codex 和 GPT-3.5 等现有闭源模型。此外，DeepSeek-Coder 模型采用宽松许可证发布，允许研究和无限制的商业使用。

> 译者注: "从头训练"(trained from scratch) 是一个关键决策。与后来 Coder-V2 基于 V2 持续预训练的策略不同，DeepSeek-Coder 选择从零开始。原因有二：一是 2024 年初尚无合适的通用 MoE 基座可用; 二是代码模型需要特定的数据配比(87% 代码 + 13% 自然语言)和 tokenizer，从零训练可以确保这些设计选择贯穿始终。这个决策在当时是合理的，但也意味着 33B Dense 模型的训练成本远高于后来的 MoE 方案。

![](images/figure_01_language_radar.jpg)

![](images/figure_02_leetcode_contest_bar.jpg)  
Figure 1 | The Performance of DeepSeek-Coder

> 图 1: DeepSeek-Coder 的性能表现。

## 1. Introduction

The field of software development has been significantly transformed by the swift advancement of large language models (OpenAI, 2023; Touvron et al., 2023), which have brought about a new era of code intelligence. These models have the potential to automate and streamline many aspects of coding, from bug detection to code generation, thereby enhancing productivity and reducing the likelihood of human error. However, a major challenge in this field is the performance gap between open-source models (Li et al., 2023; Nijkamp et al., 2022; Roziere et al., 2023; Wang et al., 2021) and closed-source models (Gemini Team, 2023; OpenAI, 2023). The giant closed-source models, while powerful, are often inaccessible to many researchers and developers due to their proprietary nature.

软件开发领域已被大语言模型的快速发展 (OpenAI, 2023; Touvron et al., 2023) 深刻改变，开启了一个代码智能的新时代。这些模型有望将编码的许多方面自动化和简化，从 bug 检测到代码生成，从而提高生产力并降低人为错误的可能性。然而，该领域的一个主要挑战是开源模型 (Li et al., 2023; Nijkamp et al., 2022; Roziere et al., 2023; Wang et al., 2021) 与闭源模型 (Gemini Team, 2023; OpenAI, 2023) 之间的性能差距。强大的闭源巨型模型由于其专有性质，往往对许多研究人员和开发者来说难以获取。

In response to this challenge, we present the DeepSeek-Coder series. This series comprises a range of open-source code models, varying in size from 1.3B to 33B, including the base version and instructed version for each size. Each model in the series has been trained from scratch on 2 trillion tokens sourced from 87 programming languages, ensuring a comprehensive understanding of coding languages and syntax. Besides, we attempt to organize the pretraining data at the repository level to enhance the pre-trained model's understanding capability within the context of cross-files within a repository. In addition to employing the next token prediction loss during pre-training, we have also incorporated the Fill-In-Middle (FIM) approach (Bavarian et al., 2022; Li et al., 2023). This approach is designed to further bolster the model's code completion capabilities. To meet the requirements of handling longer code inputs, we have extended the context length to 16K. This adjustment allows our models to handle more complex and extensive coding tasks, thereby increasing their versatility and applicability in various coding scenarios.

为应对这一挑战，我们推出了 DeepSeek-Coder 系列。该系列包含一系列开源代码模型，尺寸从 1.3B 到 33B 不等，每个尺寸都包括基座版本和指令版本。系列中的每个模型均在来自 87 种编程语言的 2 万亿 token 上从头训练，确保对编程语言和语法有全面的理解。此外，我们尝试在仓库级别组织预训练数据，以增强预训练模型在仓库内跨文件上下文中的理解能力。除了在预训练期间使用下一 token 预测损失外，我们还引入了 Fill-In-Middle (FIM，中间填充) 方法 (Bavarian et al., 2022; Li et al., 2023)。该方法旨在进一步增强模型的代码补全能力。为了满足处理更长代码输入的需求，我们将上下文长度扩展到 16K。这一调整使我们的模型能够处理更复杂、更广泛的编码任务，从而提高了它们在各种编码场景中的通用性和适用性。

> 译者注: 项目级代码语料(repository-level corpus)是 DeepSeek-Coder 相对于同期模型的核心创新之一。传统代码模型(如 StarCoder、CodeLlama)在文件级别训练，模型看不到同一仓库中其他文件的内容。但真实开发中，一个功能往往跨多个文件实现(如 Python 的 import、C 的 include)。通过依赖解析和拓扑排序将相关文件按顺序拼接，模型可以学习到"模块 A 调用了模块 B 的函数 X"这样的跨文件关系。这直接提升了模型在 RepoBench 等仓库级补全基准上的表现。

We have carried out comprehensive experiments using a variety of public code-related benchmarks. The findings reveal that among open-source models, DeepSeek-Coder-Base 33B consistently delivers superior performance across all benchmarks. Furthermore, DeepSeek-Coder-Instruct 33B surpasses OpenAI GPT-3.5 Turbo in the majority of the evaluation benchmarks, significantly narrowing the performance gap between OpenAI GPT-4 and open-source models. Remarkably, despite having fewer parameters, DeepSeek-Coder-Base 7B demonstrates competitive performance when compared to models that are five times larger, such as CodeLlama-33B (Roziere et al., 2023). To summarize, our main contributions are:

我们使用多种公开代码相关基准进行了全面实验。结果显示，在开源模型中，DeepSeek-Coder-Base 33B 在所有基准上持续表现出色。此外，DeepSeek-Coder-Instruct 33B 在大多数评测基准上超越了 OpenAI GPT-3.5 Turbo，显著缩小了 OpenAI GPT-4 与开源模型之间的性能差距。值得注意的是，尽管参数更少，DeepSeek-Coder-Base 7B 在与 CodeLlama-33B (Roziere et al., 2023) 等五倍大的模型对比时仍表现出有竞争力的性能。总而言之，我们的主要贡献如下：

- We introduce DeepSeek-Coder-Base and DeepSeek-Coder-Instruct, our advanced codefocused large language models (LLMs). Developed through extensive training on an expansive code corpus, these models exhibit proficiency in understanding 87 programming languages. Additionally, they are available in various model scales to cater to a wide range of computational and application needs.

- 我们推出了 DeepSeek-Coder-Base 和 DeepSeek-Coder-Instruct，这是我们先进的面向代码的大语言模型。通过在庞大的代码语料上进行大量训练，这些模型展现出对 87 种编程语言的熟练理解能力。此外，它们提供多种模型规模，以满足广泛的计算和应用需求。

- We make the first attempt to incorporate repository-level data construction during the pre-training phase of our models. We find that it can significantly boost the capability of cross-file code generation.

- 我们首次尝试在模型的预训练阶段引入仓库级数据构建。我们发现这能显著提升跨文件代码生成的能力。

- Our analysis rigorously examines the impact of FIM training strategies on the pretraining phase of code models. The outcomes of these comprehensive studies shed light on intriguing aspects of FIM configurations, offering valuable insights that significantly contribute to the enhancement and development of code pretrained models.

- 我们的分析严格审视了 FIM 训练策略对代码模型预训练阶段的影响。这些全面研究的结果揭示了 FIM 配置中有趣的方面，提供了宝贵的见解，对代码预训练模型的改进和发展做出了重要贡献。

- We conduct extensive evaluations of our code LLMs against a wide array of benchmarks encompassing numerous code-related tasks. The findings demonstrate that DeepSeek-Coder-Base surpasses all existing open-source code LLMs across these benchmarks. Furthermore, with meticulous fine-tuning using instructional data, DeepSeek-Coder-Instruct achieves better performance compared to the OpenAI GPT-3.5 Turbo model in code-related tasks.

- 我们对代码大语言模型在涵盖众多代码相关任务的广泛基准上进行了大量评测。结果表明，DeepSeek-Coder-Base 在这些基准上超越了所有现有开源代码大语言模型。此外，通过使用指令数据精心微调，DeepSeek-Coder-Instruct 在代码相关任务上取得了优于 OpenAI GPT-3.5 Turbo 的性能。

## 2. Data Collection

The training dataset of DeepSeek-Coder is composed of 87% source code, 10% English coderelated natural language corpus, and 3% code-unrelated Chinese natural language corpus. The English corpus consists of materials from GitHub's Markdown and StackExchange1, which are used to enhance the model's understanding of code-related concepts and improve its ability to handle tasks like library usage and bug fixing. Meanwhile, the Chinese corpus consists of high-quality articles aimed at improving the model's proficiency in understanding the Chinese language. In this section, we will provide an overview of how we construct the code training data. This process involves data crawling, rule-based filtering, dependency parsing, repositorylevel deduplication, and quality screening, as illustrated in Figure 2. In the following, we will describe the data creation procedure step by step.

DeepSeek-Coder 的训练数据集由 87% 源代码、10% 英文代码相关自然语言语料和 3% 与代码无关的中文自然语言语料组成。英文语料包括 GitHub Markdown 和 StackExchange1 的内容，用于增强模型对代码相关概念的理解，并提高其处理库使用和 bug 修复等任务的能力。同时，中文语料由高质量文章组成，旨在提高模型理解中文的熟练度。在本节中，我们将概述如何构建代码训练数据。该过程涉及数据爬取、基于规则的过滤、依赖解析、仓库级去重和质量筛选，如图 2 所示。接下来，我们将逐步描述数据创建流程。

> 译者注: 87% 代码 + 10% 英文 + 3% 中文的数据配比，与后来 Coder-V2 的 60% + 10% + 30% 形成鲜明对比。早期模型(Coder、Math)使用更高比例的代码数据，因为当时的主要目标是最大化代码能力。但随着模型尺寸增大，发现纯代码训练会导致通用能力严重退化。Coder-V2 将通用语料提升到 30%，正是从 Coder 的经验中学习到的。3% 的中文数据看似很少，但足以让模型理解中文注释和变量名——这对于服务中国开发者至关重要。

![](images/figure_03_dataset_creation_pipeline.jpg)  
Figure 2 | The Procedure of Dataset Creation

> 图 2: 数据集创建流程。

### 2.1. GitHub Data Crawling and Filtering

We collect public repositories created before February 2023 on GitHub and retain only 87 programming languages, as listed in Table 1. To reduce the amount of data to be processed, we apply filtering rules similar to those used in the StarCoder project (Li et al., 2023) to preliminarily filter out lower-quality code. By applying these filtering rules, we reduce the total amount of data to only 32.8% of its original size. To make the paper self-contained, we briefly describe the filter rules used in the StarCoder Data project:

我们在 GitHub 上收集 2023 年 2 月之前创建的公开仓库，并仅保留表 1 中列出的 87 种编程语言。为了减少需要处理的数据量，我们应用与 StarCoder 项目 (Li et al., 2023) 类似的过滤规则，初步过滤掉低质量代码。通过应用这些过滤规则，我们将总数据量减少到原始大小的 32.8%。为使论文自洽，我们简要描述 StarCoder Data 项目中使用的过滤规则：

Firstly, we filter out files with an average line length exceeding 100 characters or a maximum line length surpassing 1000 characters. Additionally, we remove files with fewer than 25% alphabetic characters. Except for the XSLT programming language, we further filter out files where the string "<?xml version=" appeared in the first 100 characters. For HTML files, we consider the ratio of visible text to HTML code. We retain files where the visible text constitutes at least 20% of the code and is no less than 100 characters. For JSON and YAML files, which typically contain more data, we only keep files that have a character count ranging from 50 to 5000 characters. This effectively removes most data-heavy files.

首先，过滤掉平均行长度超过 100 个字符或最大行长度超过 1000 个字符的文件。此外，移除字母字符比例低于 25% 的文件。除 XSLT 编程语言外，我们还进一步过滤掉前 100 个字符中出现字符串 "<?xml version=" 的文件。对于 HTML 文件，我们考虑可见文本与 HTML 代码的比例，仅保留可见文本至少占代码 20% 且不少于 100 个字符的文件。对于通常包含更多数据的 JSON 和 YAML 文件，我们只保留字符数在 50 到 5000 之间的文件。这有效移除了大部分数据密集型文件。

### 2.2. Dependency Parsing

In previous works (Chen et al., 2021; Li et al., 2023; Nijkamp et al., 2022; Roziere et al., 2023), large language models for code are mainly pre-trained on file-level source code, which ignores the dependencies between different files in a project. However, in practical applications, such models struggle to effectively scale to handle entire project-level code scenarios. Therefore, we will consider how to leverage the dependencies between files within the same repository in this step. Specifically, we first parse the dependencies between files and then arrange these files in an order that ensures the context each file relies on is placed before that file in the input sequence. By aligning the files in accordance with their dependencies, our dataset more accurately represents real coding practices and structures. This enhanced alignment not only makes our dataset more relevant but also potentially increases the practicality and applicability of the model in handling project-level code scenarios. It's worth noting that we only consider the invocation relationships between files and use regular expressions to extract them, such as "import" in Python, "using" in C#, and "include" in C.

在先前的工作 (Chen et al., 2021; Li et al., 2023; Nijkamp et al., 2022; Roziere et al., 2023) 中，代码大语言模型主要在文件级源代码上预训练，忽略了项目中不同文件之间的依赖关系。然而，在实际应用中，这类模型难以有效扩展到处理整个项目级代码场景。因此，在这一步中，我们将考虑如何利用同一仓库内文件之间的依赖关系。具体而言，我们首先解析文件之间的依赖关系，然后按顺序排列这些文件，确保每个文件所依赖的上下文都排在该文件之前。通过按照依赖关系对齐文件，我们的数据集更准确地反映了真实的编程实践和结构。这种增强的对齐不仅使我们的数据集更具相关性，还可能提高模型在处理项目级代码场景中的实用性和适用性。值得注意的是，我们只考虑文件之间的调用关系，并使用正则表达式提取它们，如 Python 中的 "import"、C# 中的 "using" 和 C 中的 "include"。

> 译者注: 依赖解析是项目级训练的核心技术挑战。不同语言有不同的导入语法(Python 的 import/from、JavaScript 的 require/import、C++ 的 #include 等)，而且导入路径可能是相对路径、绝对路径或第三方包名。论文提到使用正则表达式提取，这说明实现上相对简单(没有使用完整的 AST 解析)，但效果已经显著。拓扑排序的巧妙之处在于：如果文件 A 依赖文件 B，那么 B 应该出现在 A 之前——这保证了模型在预测 A 的内容时，已经"看过" B 的 API 定义。

Algorithm 1 Topological Sort for Dependency Analysis   
1: procedure TOPOLOGICAL_SORT(files)
2:   graph ← {}       ⊲ adjacency list
3:   in_degree ← {}   ⊲ in-degrees
4:   for each file in files do
5:     graph[file] ← []
6:     in_degree[file] ← 0
7:   end for
8:
9:   for each fileA in files do
10:    for each fileB in files do
11:      if HAS_DEPENDENCY(fileA, fileB) then  ⊲ fileA depends on fileB
12:        graph[fileB].append(fileA)          ⊲ edge: B -> A
13:        in_degree[fileA] ← in_degree[fileA] + 1
14:      end if
15:    end for
16:  end for
17:
18:  subgraphs ← getDisconnectedSubgraphs(graph)
19:  orders ← []
20:  for each subgraph in subgraphs do
21:    order ← []
22:    while length(order) ≠ NumberOfNodes(subgraph) do
23:      file ← argmin({in_degree[f] | f ∈ subgraph and f ∉ order})
24:      for each neighbor in graph[file] do
25:        in_degree[neighbor] ← in_degree[neighbor] − 1
26:      end for
27:      order.append(file)
28:    end while
29:    orders.append(order)
30:  end for
31:  return orders
32: end procedure

算法 1 依赖分析拓扑排序   
1: 过程 拓扑排序(文件列表)   
2: graphs ← {} ⊲ 初始化空邻接表   
3: inDegree ← {} ⊲ 初始化空入度字典   
4: 对于 文件列表 中的每个文件 做   
5: graphs[文件] ← []   
6: inDegree[文件] ← 0   
7: 结束 for   
8:   
9: 对于 文件列表 中的每个文件A 做   
10: 对于 文件列表 中的每个文件B 做   
11: 如果 存在依赖(文件A, 文件B) 则 ⊲ 如果文件A依赖文件B   
12: graphs[文件B].append(文件A) ⊲ 添加从 B 到 A 的边   
13: inDegree[文件A] ← inDegree[文件A] + 1 ⊲ 增加 A 的入度   
14: 结束 if   
15: 结束 for   
16: 结束 for   
17:   
18: subgraphs ← getDisconnectedSubgraphs(graphs) ⊲ 识别不连通子图   
19: results ← []   
20: 对于 subgraphs 中的每个子图 做   
21: sorted ← []   
22: 当 length(sorted) ≠ NumberOfNodes(子图) 时 做   
23: file ← argmin({inDegree[文件] | 文件 ∈ 子图 且 文件 ∉ sorted})   
24: 对于 graphs[文件] 中的每个邻居 做   
25: inDegree[邻居] ← inDegree[邻居] − 1   
26: 结束 for   
27: sorted.append(文件)   
28: 结束 while   
29: results.append(sorted)   
30: 结束 for   
31:   
32: 返回 results   
33: 结束过程

> 译者注: MinerU 在算法 1 的少量符号处出现了乱码，但不影响理解。该算法是拓扑排序的变体：标准拓扑排序每轮选择入度为 0 的节点; 这里更像是选择“当前入度最小”的节点(argmin)，用于在真实代码库可能存在循环依赖时仍能给出一个可用的排列。对不连通子图(disconnected subgraphs)，算法分别排序后拼接，保证每个连通分量的完整性。

The algorithm 1 describes a topological sort for dependency analysis on a list of files within the same project. Initially, it sets up two data structures: an empty adjacency list named "graphs" to represent dependencies between files and an empty dictionary called "inDegree" for storing the in-degrees of each file. The algorithm then iterates over each file pair to identify dependencies, updating "graphs" and "inDegree" accordingly. Next, it identifies any disconnected subgraphs within the overall dependency graph. For each subgraph, the algorithm employs a modified topological sort. Unlike the standard approach that selects nodes with zero in-degrees, this algorithm selects nodes with minimal in-degrees, which allows it to handle cycles within the graph. Selected nodes are added to a "results" list, and the in-degrees of their connected nodes are decreased. This process continues until a topologically sorted sequence is generated for each subgraph. The algorithm concludes by returning a list of these sorted sequences, and each sequence's files are concatenated to form a single training sample. To incorporate file path information, a comment indicating the file's path is added at the beginning of each file. This method ensures that the path information is preserved in the training data.

算法 1 描述了同一项目中文件列表的依赖分析拓扑排序。初始时，它建立两个数据结构：一个名为 "graphs" 的空邻接表来表示文件之间的依赖关系，以及一个名为 "inDegree" 的空字典来存储每个文件的入度。然后，算法遍历每对文件以识别依赖关系，相应地更新 "graphs" 和 "inDegree"。接下来，它识别整体依赖图中的任何不连通子图。对于每个子图，算法采用改进的拓扑排序。与标准方法选择入度为 0 的节点不同，该算法选择入度最小的节点，这使其能够处理图中的循环。选中的节点被添加到 "results" 列表中，其连接节点的入度被减 1。这一过程持续进行，直到为每个子图生成拓扑排序序列。算法最后返回这些排序序列的列表，每个序列的文件被拼接形成一个训练样本。为了纳入文件路径信息，在每个文件开头添加一个指示文件路径的注释。这种方法确保路径信息在训练数据中得到保留。

### 2.3. Repo-Level Deduplication

Recent studies have demonstrated the significant performance improvements that can be achieved by deduplicating training datasets for Large Language Models (LLMs). Lee et al. (2022) have shown that language model training corpora often contain numerous near-duplicates, and the performance of LLMs can be enhanced by removing long repetitive substrings. Kocetkov et al. (2022) have applied a near-deduplication method to training data, resulting in dramatic improvements, and they emphasize that near-deduplication is a crucial preprocessing step for achieving competitive performance on code benchmark tasks. In our dataset, we have also employed near-deduplication. However, there is a distinction in our approach compared to previous works. We perform deduplication at the repository level of code, rather than at the file level, as the latter approach may filter out certain files within a repository, potentially disrupting the structure of the repository. Specifically, we treat the concatenated code from the repository level as a single sample and apply the same near-deduplication algorithm to ensure the integrity of the repository structure.

近期研究表明，对大语言模型训练数据集进行去重可以显著提升性能。Lee 等人 (2022) 证明，语言模型训练语料通常包含大量近似重复内容，通过移除长重复子串可以提升 LLM 的性能。Kocetkov 等人 (2022) 将近似去重方法应用于训练数据，取得了显著改进，并强调近似去重是在代码基准任务上取得竞争性性能的关键预处理步骤。在我们的数据集中，我们也采用了近似去重。然而，我们的方法与以往工作有所不同。我们在代码的仓库级别进行去重，而非文件级别，因为后者可能会过滤掉仓库中的某些文件，从而破坏仓库的结构。具体而言，我们将仓库级别的拼接代码视为单个样本，并应用相同的近似去重算法，以确保仓库结构的完整性。

> 译者注: 仓库级去重 vs 文件级去重是一个微妙的工程决策。文件级去重简单高效，但可能误删：同一个工具函数被复制到多个项目中(这是开源社区的常见做法)，文件级去重会保留其中一个而删除其他——这没有问题。但如果同一个仓库中有两个文件共享大量代码(如前后端 API 定义)，文件级去重可能删除其中一个，破坏仓库的完整性。仓库级去重将整个项目视为一个原子单位，避免了这个问题，代价是去重粒度更粗、计算成本更高。

### 2.4. Quality Screening and Decontamination

In addition to applying the filtering rules mentioned in Section 2.1, we also employ a compiler and a quality model, combined with heuristic rules, to further filter out low-quality data. This includes code with syntax errors, poor readability, and low modularity. We provide the statistical summary of source code in Table 1, which includes a total of 87 languages, detailing the disk size, number of files, and percentage for each language. The total data volume is 798 GB with 603 million files. To ensure that our code training data is not contaminated by information from the test set, which may be present on GitHub, we've implemented an n-gram filtering process. This process involves the removal of any code segments that match specific criteria. Specifically, we filter out files containing docstrings, questions, and solutions from sources such as HumanEval (Chen et al., 2021), MBPP (Austin et al., 2021), GSM8K (Cobbe et al., 2021) and MATH (Hendrycks et al., 2021). For the filtering criteria, we apply the following rules: if a piece of code includes a 10-gram string identical to any in the test data, it is excluded from our training data. In cases where the test data comprises strings that are shorter than 10-grams but no less than 3-grams, we use an exact match approach for filtering.

除了应用 2.1 节中提到的过滤规则外，我们还使用编译器和质量模型，结合启发式规则，进一步过滤低质量数据。这包括包含语法错误、可读性差和模块化程度低的代码。我们在表 1 中提供了源代码的统计摘要，共包含 87 种语言，详细列出了每种语言的磁盘大小、文件数量和占比。总数据量为 798 GB，6.03 亿个文件。为了确保我们的代码训练数据不受测试集信息的污染(测试集可能存在于 GitHub 上)，我们实现了 n-gram 过滤流程。该流程涉及移除符合特定标准的任何代码段。具体而言，我们过滤掉包含来自 HumanEval (Chen et al., 2021)、MBPP (Austin et al., 2021)、GSM8K (Cobbe et al., 2021) 和 MATH (Hendrycks et al., 2021) 等来源的 docstring、题目和解答的文件。对于过滤标准，我们应用以下规则：如果一段代码包含与测试数据中任何字符串相同的 10-gram 字符串，则将其从训练数据中排除。如果测试数据包含短于 10-gram 但不低于 3-gram 的字符串，我们使用精确匹配方法进行过滤。

> 译者注: 数据去污染(decontamination)是代码模型评测中的关键步骤，但往往被忽视。GitHub 上存在大量 LeetCode 题解、竞赛代码和教程，如果不过滤，模型可能在训练时"见过"测试题目。论文使用的 10-gram 过滤标准相对严格(StarCoder 使用 50-gram)，这可能是考虑到代码的重复模式比自然语言更常见(如常见的 import 语句、循环结构)。但 10-gram 也可能过度过滤——两个不相关的代码片段可能共享 10 个 token 的常见模式。这是一个召回率与精确率的权衡。

Table 1 
| A summary of the cleaned training data for the selected programming languages.

> 表 1: 所选编程语言的清洗后训练数据摘要。原表包含 87 种语言的详细统计(磁盘大小、文件数、占比)，完整数据见 D3 原文。总计 798 GB，6.03 亿文件。

## 3. Training Policy

### 3.1. Training Strategy

#### 3.1.1. Next Token Prediction

The first training objective for our model is known as next token prediction. In this process, various files are concatenated to form a fixed-length entry. Then, these entries are used to train the model, enabling it to predict the subsequent token based on the provided context.

模型的第一个训练目标是下一 token 预测。在此过程中，各种文件被拼接形成固定长度的条目，然后这些条目用于训练模型，使其能够根据提供的上下文预测后续的 token。

#### 3.1.2. Fill-in-the-Middle

The second training objective for our model is known as fill-in-the-middle. In the code pre-training scenario, it is often necessary to generate corresponding inserted content based on the given context and subsequent text. Due to specific dependencies in a programming language, relying solely on next token prediction is insufficient to learn this fill-in-the-middle capability. Therefore, several approaches (Bavarian et al., 2022; Li et al., 2023) propose the pretraining method of Fill-in-the-Middle (FIM). This approach involves randomly dividing the text into three parts, then shuffling the order of these parts and connecting them with special characters. This method aims to incorporate a fill-in-the-blank pretraining task during the training process. Within the FIM methodology, two distinct modes are employed: PSM (Prefix-Suffix-Middle) and SPM (Suffix-Prefix-Middle). In the PSM mode, the training corpus is organized in the sequence of Prefix, Suffix, Middle, aligning the text in a way that the middle segment is flanked by the prefix and suffix. Conversely, the SPM mode arranges the segments as Suffix, Prefix, Middle, presenting a different structural challenge. These modes are instrumental in enhancing the model's capability to handle various structural arrangements in code, providing a robust training framework for advanced code prediction tasks.

模型的第二个训练目标是中间填充(Fill-in-the-Middle)。在代码预训练场景中，常常需要根据给定的上下文和后续文本来生成相应的插入内容。由于编程语言中特定的依赖关系，仅靠下一 token 预测不足以学习这种中间填充能力。因此，一些方法 (Bavarian et al., 2022; Li et al., 2023) 提出了 Fill-in-the-Middle (FIM) 预训练方法。该方法将文本随机分成三部分，然后打乱这些部分的顺序并用特殊字符连接它们。这种方法旨在训练过程中引入填空预训练任务。在 FIM 方法中，采用两种不同的模式：PSM(前缀-后缀-中间，Prefix-Suffix-Middle)和 SPM(后缀-前缀-中间，Suffix-Prefix-Middle)。在 PSM 模式中，训练语料按照"前缀、后缀、中间"的顺序组织，使中间段被前缀和后缀包围。相反，SPM 模式将段落按"后缀、前缀、中间"排列，呈现出不同的结构挑战。这些模式有助于增强模型处理代码中各种结构排列的能力，为高级代码预测任务提供了稳健的训练框架。

> 译者注: FIM(Fill-in-the-Middle)是代码模型独有的预训练任务，因为编程中"中间填充"场景极为常见：IDE 中在函数签名和 return 语句之间补全函数体、在两个已有代码块之间插入新逻辑等。PSM 与 SPM 的区别在于输入顺序：PSM 把前缀和后缀放在前面，让模型看到"问题"和"答案框架"后再生成中间内容; SPM 则先给后缀再给前缀。论文通过消融实验发现 50% PSM 率效果最好，这成为后来代码模型的标准配置(包括 CodeLlama 也采用 50% FIM 率)。

![](images/chart_04_fim_ablation_curve_a.jpg)

![](images/chart_05_fim_ablation_curve_b.jpg)

![](images/chart_06_fim_ablation_curve_c.jpg)  
Figure 3 | The effectiveness of using FIM objective.

> 图 3: 使用 FIM 训练目标的效果。

To determine the effectiveness of various hyperparameters within the FIM approach, we conducted a series of ablation experiments.

为了确定 FIM 方法中各种超参数的效果，我们进行了一系列消融实验。

Experiment Settings: In this experiment, we employ DeepSeek-Coder-Base 1.3B as our model architecture. We focused on a Python subset from our training dataset to streamline the experimental process. Our primary objective was to assess the efficacy of the Fill-in-the-Middle (FIM) technique, utilizing the HumanEval-FIM benchmark (Fried et al., 2022). This benchmark specializes in a single-line FIM task for Python, in which one line of code from a HumanEval solution is随机 obscured, testing the model's proficiency in predicting the missing line. We hypothesize that the PSM mode may exhibit subtle differences compared to the traditional next-token prediction objective. This is primarily because PSM involves rearranging the order of the original text, potentially impacting the learning dynamics of the model. Therefore, we implement the PSM mode for FIM across four distinct configurations: 0% FIM rate, 50% FIM rate, 100% FIM rate, and 50% MSP rate. The Masked Span Prediction (MSP) strategy, initially introduced in T5 (Raffel et al., 2023), conceals multiple text spans and trains the model to reconstruct these segments. According to CodeGen2.5 (Nijkamp et al., 2023), MSP may enhance FIM performance compared to PSM. Thus, we include this method in our comparative analysis.

实验设置：在此实验中，我们使用 DeepSeek-Coder-Base 1.3B 作为模型架构。我们专注于训练数据集的一个 Python 子集以简化实验流程。我们的主要目标是使用 HumanEval-FIM 基准 (Fried et al., 2022) 评估 Fill-in-the-Middle (FIM) 技术的有效性。该基准专门针对 Python 的单行 FIM 任务，其中 HumanEval 解决方案中的一行代码被随机遮蔽，测试模型预测缺失行的能力。我们假设 PSM 模式可能与传统下一 token 预测目标存在细微差异，这主要是因为 PSM 涉及重新排列原始文本的顺序，可能影响模型的学习动态。因此，我们在四种不同配置下实现 FIM 的 PSM 模式：0% FIM 率、50% FIM 率、100% FIM 率和 50% MSP 率。掩码跨度预测(Masked Span Prediction, MSP)策略最初在 T5 (Raffel et al., 2023) 中提出，遮蔽多个文本跨度并训练模型重建这些段。根据 CodeGen2.5 (Nijkamp et al., 2023)，与 PSM 相比，MSP 可能提升 FIM 性能。因此，我们将该方法纳入比较分析。

Results: The outcomes of our experiment are illustrated in Figure 3. While the model demonstrates peak performance on the HumanEval-FIM with a 100% FIM rate, this configuration also results in the weakest code completion capability. This indicates a trade-off between FIM and code completion abilities. Moreover, we observe that with a 50% PSM rate, the model outperforms the MSP strategy. To achieve a balance between FIM efficiency and code completion proficiency, we ultimately choose the 50% PSM rate as our preferred training policy.

结果：我们的实验结果如图 3 所示。虽然模型在 100% FIM 率下在 HumanEval-FIM 上表现出最佳性能，但这种配置也导致代码补全能力最弱。这表明 FIM 与代码补全能力之间存在权衡。此外，我们观察到在 50% PSM 率下，模型优于 MSP 策略。为了在 FIM 效率与代码补全能力之间取得平衡，我们最终选择 50% PSM 率作为首选训练策略。

In our implementation, we have introduced three sentinel tokens specifically for this task. For each code file, we initially divide its content into three segments, denoted as $f _ { p r e } , f _ { m i d d l e } ,$ and $f _ { s u f }$ . Using the PSM mode, we construct the training example as follows:

在我们的实现中，我们为此任务引入了三个哨兵 token。对于每个代码文件，我们首先将其内容分为三段，记为 $f_{pre}$、$f_{middle}$ 和 $f_{suf}$。使用 PSM 模式，我们按如下方式构建训练示例：

$$
<|\mathbf{f}\equiv\mathrm{im}_-\mathbf{start}|> f_{pre} <|\mathbf{f}\equiv\mathrm{im}_-\mathbf{hole}|> f_{suf} <|\mathbf{f}\equiv\mathrm{im}_-\mathbf{end}|> f_{middle} <|\mathbf{eos}_-\mathbf{token}|>
$$

We implement the Fill-in-the-Middle (FIM) method at the document level before the packing process, as proposed in the original work by Bavarian et al. (2022). This is done with an FIM rate of 0.5, following the PSM mode.

我们在打包过程之前在文档级别实现 Fill-in-the-Middle (FIM) 方法，如 Bavarian 等人 (2022) 的原始工作所提出的。按照 PSM 模式，FIM 率为 0.5。

### 3.2. Tokenizer

For the tokenization process, we employ the HuggingFace Tokenizer $\mathrm{library}^2$ to train Byte Pair Encoding (BPE) tokenizers, as outlined in Sennrich et al. (2015) (Sennrich et al., 2015), on a subset of our training corpus. Ultimately, we utilize a tokenizer configured with a vocabulary size of 32,000.

对于分词过程，我们使用 HuggingFace Tokenizer 库在训练语料的一个子集上训练字节对编码(Byte Pair Encoding, BPE)分词器，如 Sennrich 等人 (2015) 所述。最终，我们使用词汇表大小为 32,000 的分词器。

> 译者注: 32K 的词汇表相对于当时的其他代码模型(如 StarCoder 的 49K、CodeLlama 的 32K)属于中等规模。较小的词汇表意味着每个 token 更长、模型对罕见字符的表示更粗糙，但 embedding 层参数量更少。DeepSeek-Coder 选择 32K 可能是为了在性能和效率之间取得平衡。值得注意的是，这是 BPE 分词器，与后来 V2/V3 使用的更先进的 BPE 变体(如基于 tiktoken 的实现)不同。

### 3.3. Model Architecture

We develop a range of models with varying parameters to cater to diverse applications, including models with 1.3B, 6.7B, and 33B parameters. These models are built upon the same framework as the DeepSeek Large Language Model (LLM) outlined by DeepSeek-AI (2024). Each model is a decoder-only Transformer, incorporating Rotary Position Embedding (RoPE) as described by Su et al. (2023). Notably, the DeepSeek 33B model integrates Grouped-Query-Attention (GQA) with a group size of $8,$ enhancing both training and inference efficiency. Additionally, we employ FlashAttention $\mathbf{v}2$ (Dao, 2023) to expedite the computation involved in the attention mechanism. The architectural details of our models are summarized in Table 2.

我们开发了一系列参数各异的模型以满足不同应用需求，包括 1.3B、6.7B 和 33B 参数模型。这些模型基于 DeepSeek-AI (2024) 所述的 DeepSeek 大语言模型框架构建。每个模型都是仅解码器(decoder-only)Transformer，采用 Su 等人 (2023) 描述的旋转位置编码(RoPE)。值得注意的是，DeepSeek 33B 模型集成了分组查询注意力(Grouped-Query-Attention, GQA)，分组大小为 8，提升了训练和推理效率。此外，我们采用 FlashAttention v2 (Dao, 2023) 加速注意力机制的计算。我们模型的架构细节总结于表 2。

### 3.4. Optimization

Following DeepSeek LLM (DeepSeek-AI, 2024), we use AdamW (Loshchilov and Hutter, 2019) as the optimizer with $\beta_1$ and $\beta_2$ values of 0.9 and 0.95. We adapt batch sizes and learning rates by the scaling laws suggested in DeepSeek LLM. For the learning rate scheduling, we implement a three-stage policy, which includes 2000 warm-up steps, and set the final learning rate to 10% of the initial rate. Notably, the learning rate at each stage is scaled down to $\sqrt{\frac{1}{10}}$ of the preceding stage's rate, following the guidelines established in DeepSeek LLM (DeepSeek-AI, 2024).

遵循 DeepSeek LLM (DeepSeek-AI, 2024) 的做法，我们使用 AdamW (Loshchilov and Hutter, 2019) 作为优化器，$\beta_1$ 和 $\beta_2$ 分别设为 0.9 和 0.95。我们根据 DeepSeek LLM 中的 scaling laws 调整批次大小和学习率。对于学习率调度，我们实现了一个三阶段策略，包括 2000 步 warm-up，并将最终学习率设为初始学习率的 10%。值得注意的是，每个阶段的学习率按照 DeepSeek LLM (DeepSeek-AI, 2024) 中确立的指导方针，降低到前一阶段学习率的 $\sqrt{\frac{1}{10}}$。

### 3.5. Environments

Our experiments are conducted using the HAI-LLM (High-Flyer, 2023) framework, known for its efficiency and lightweight approach in training large language models. This framework incorporates a variety of parallelism策略 to optimize computational efficiency. These include tensor parallelism (Korthikanti et al., 2023), alongside ZeRO data parallelism (Rajbhandari et al., 2020) and PipeDream pipeline parallelism (Narayanan et al., 2019). Our experiments utilize clusters outfitted with NVIDIA A100 and H800 GPUs. In the A100 cluster, each node is configured with 8 GPUs, interconnected in pairs using NVLink bridges. The H800 cluster is similarly arranged, with each node containing 8 GPUs. These GPUs are interconnected using a combination of NVLink and NVSwitch technologies, ensuring efficient data transfer within nodes. To facilitate seamless communication between nodes in both A100 and H800 clusters, we employ InfiniBand interconnects, known for their high throughput and low latency. This setup provides a robust and efficient infrastructure for our computational experiments.

我们的实验使用 HAI-LLM (High-Flyer, 2023) 框架进行，该框架以大语言模型训练的高效和轻量著称。该框架融合了多种并行策略以优化计算效率，包括张量并行 (Korthikanti et al., 2023)、ZeRO 数据并行 (Rajbhandari et al., 2020) 和 PipeDream 流水线并行 (Narayanan et al., 2019)。我们的实验使用配备 NVIDIA A100 和 H800 GPU 的集群。在 A100 集群中，每个节点配置 8 个 GPU，通过 NVLink 桥接器成对互联。H800 集群采用类似布局，每个节点包含 8 个 GPU。这些 GPU 通过 NVLink 和 NVSwitch 技术组合互联，确保节点内高效数据传输。为了促进 A100 和 H800 集群节点之间的无缝通信，我们采用以高吞吐量和低延迟著称的 InfiniBand 互连。这种设置为我们的计算实验提供了稳健高效的基础设施。

Table 2 | Hyperparameters of DeepSeek-Coder.

> 表 2: DeepSeek-Coder 的超参数。原表包含 1.3B/6.7B/33B 三个尺寸的详细架构参数(隐藏维度、层数、注意力头数、GQA 分组、批次大小、学习率等)，完整数据见 D3 原文。

### 3.6. Long Context

To enhance the capabilities of DeepSeek-Coder in handling extended contexts, particularly for scenarios like repository-level code processing, we have reconfigured the RoPE (Su et al., 2023) parameters to extend the default context window. Following previous practices (Chen et al., 2023; kaiokendev, 2023), we employed a linear scaling strategy, increasing the scaling factor from 1 to 4 and altering the base frequency from 10000 to 100000. The model underwent an additional 1000 steps of training, using a batch size of 512 and a sequence length of 16K. The learning rate was maintained as in the final pre-training phase. Theoretically, these modifications enable our model to process up to 64K tokens in context. However, empirical observations suggest that the model delivers its most reliable outputs within a 16K token range. Future research will continue to refine and evaluate the long-context adaptation methodology, aiming to further enhance DeepSeek-Coder's efficiency and user-friendliness in processing extended contexts.

为了增强 DeepSeek-Coder 处理扩展上下文的能力，特别是仓库级代码处理等场景，我们重新配置了 RoPE (Su et al., 2023) 参数以扩展默认上下文窗口。遵循先前实践 (Chen et al., 2023; kaiokendev, 2023)，我们采用线性缩放策略，将缩放因子从 1 增加到 4，并将基频从 10000 改为 100000。模型额外训练了 1000 步，批次大小为 512，序列长度为 16K。学习率保持在预训练最后阶段的水平。理论上，这些修改使我们的模型能够处理多达 64K token 的上下文。然而，经验观察表明，模型在 16K token 范围内提供最可靠的输出。未来的研究将继续改进和评估长上下文适应方法，旨在进一步提升 DeepSeek-Coder 在处理扩展上下文时的效率和易用性。

> 译者注: RoPE 线性缩放(linear scaling / NTK-aware scaling)是 2023 年社区流行的长上下文扩展技巧。核心思想是：不改变位置编码公式本身，而是缩放位置索引(如把位置 i 映射为 i/4)，让模型"感觉"上下文比实际短。这里缩放因子为 4，意味着 16K 的上下文在模型看来相当于 4K——这在训练时已经完全见过，因此不会退化。理论上限 64K(16K × 4)但实际只保证 16K，说明线性缩放虽然有效，但过度拉伸会导致精度损失。后来的 Yarn / NTK-by-parts 等方法对此进行了改进。

### 3.7. Instruction Tuning

We develop DeepSeek-Coder-Instruct by enhancing the DeepSeek-Coder-Base through instructionbased fine-tuning using high-quality data. This data comprises helpful and impartial human instructions, structured by the Alpaca Instruction format (Taori et al., 2023). To demarcate each dialogue turn, we employed a unique delimiter token <|EOT|> to signify the conclusion of each segment. For training, we use a cosine schedule with 100 warm-up steps and an initial learning rate 1e-5. We also use a batch size of 4M tokens and 2B tokens in total.

我们通过使用高质量数据进行基于指令的微调来增强 DeepSeek-Coder-Base，从而开发 DeepSeek-Coder-Instruct。这些数据包含有用且公正的人类指令，按 Alpaca 指令格式 (Taori et al., 2023) 组织。为了区分每个对话轮次，我们使用一个独特的分隔符 token <|EOT|> 来表示每个段的结束。训练时我们使用余弦调度，100 步 warm-up，初始学习率 1e-5。我们还使用 4M token 的批次大小，总共 2B token。

> 译者注: 与后来 Coder-V2 使用的 GRPO 强化学习方法不同，Coder 的指令微调完全采用监督学习(SFT)。Alpaca 格式是 2023 年最主流的指令数据格式(问题+回答对)，数据量仅 2B token(对比 Coder-V2 的 2.2T token)。这反映了当时的业界共识：代码模型的对齐阶段不需要复杂的强化学习，简单的 SFT 就足够了。但实际上，后来的 Coder-V2 证明 GRPO 在代码推理任务上效果显著——这说明代码对齐的"最佳实践"也在快速演进。

An example of using DeepSeek-Coder-Instruct 34B is depicted in Figure 4. This example is a multi-turn dialogue scenario for building a snake game. Initially, we ask the model to write a game snake using pygame. The model successfully creates a basic snake game that can run without bugs. To improve the game, we further request adding a scoring system in the top left corner. The model then introduces a "score" variable and a "display_score" function, along with an explanation of how to integrate these features. This example illustrates DeepSeek-Coder-Instruct's ability to provide complete solutions in multi-turn dialogue settings. More cases can be found in the Appendix A.

使用 DeepSeek-Coder-Instruct 33B 的示例如图 4 所示。该示例是一个构建贪吃蛇游戏的多轮对话场景。首先，我们要求模型使用 pygame 写一个贪吃蛇游戏。模型成功创建了一个可以无 bug 运行的基础贪吃蛇游戏。为了改进游戏，我们进一步要求在左上角添加计分系统。模型随后引入了 "score" 变量和 "display_score" 函数，并解释了如何集成这些功能。这个示例展示了 DeepSeek-Coder-Instruct 在多轮对话环境中提供完整解决方案的能力。更多案例见附录 A。

## Q1: Write a game snake using pygame

## Q2: Add a scoring system in the top left corner

![](images/figure_07_multiturn_snake_game.jpg)  
Figure 4 | An example of responses from DeepSeek-Coder-Instruct 33B in a multi-turn setting.

> 图 4: DeepSeek-Coder-Instruct 33B 在多轮对话中的回复示例。

## 4. Experimental Results

In this section, we evaluate DeepSeek-Coder on four tasks, including code generation (§4.1), FIM code completion (§4.2), cross-file code completion (§4.3) and program-based math reasoning (§4.4). We compare DeepSeek-Coder with the previous state-of-the-art large language models:

在本节中，我们在四项任务上评估 DeepSeek-Coder，包括代码生成 (§4.1)、FIM 代码补全 (§4.2)、跨文件代码补全 (§4.3) 和基于程序的数学推理 (§4.4)。我们将 DeepSeek-Coder 与之前最先进的大语言模型进行比较：

- CodeGeeX2 (Zheng et al., 2023) represents the second generation of the multilingual code generation model CodeGeeX. It is developed using the ChatGLM2 (Du et al., 2022) architecture and is enhanced with an extensive dataset of coding examples.

- CodeGeeX2 (Zheng et al., 2023) 是多语言代码生成模型 CodeGeeX 的第二代。它基于 ChatGLM2 (Du et al., 2022) 架构开发，并通过大量编码示例数据集进行了增强。

- StarCoder (Li et al., 2023) is a publicly accessible model with a substantial parameter count of 15 billion. It is specifically trained on a meticulously curated subset of the Stack dataset (Kocetkov et al., 2022), covering 86 programming languages, ensuring its proficiency across a wide range of coding tasks.

- StarCoder (Li et al., 2023) 是一个公开可用的模型，拥有 150 亿的参数量。它专门针对 Stack 数据集 (Kocetkov et al., 2022) 精心策划的子集进行训练，涵盖 86 种编程语言，确保其在广泛的编码任务上的熟练度。

- CodeLlama (Roziere et al., 2023) encompasses a series of code-centric Large Language Models (LLMs) that are derivatives of LLaMA2 (Touvron et al., 2023). Available in three sizes — 7B, 13B, and 34B — these models undergo continued training on a vast 500 billion token code corpus, building upon the foundational LLaMA2 architecture.

- CodeLlama (Roziere et al., 2023) 包含一系列以代码为中心的大语言模型，是 LLaMA2 (Touvron et al., 2023) 的衍生模型。这些模型有 7B、13B 和 34B 三种尺寸，在 LLaMA2 基础架构上，在庞大的 5000 亿 token 代码语料上继续训练。

- code-cushman-001 Chen et al. (2021) is a 12 billion parameter model developed by OpenAI and served as the initial model for Github Copilot.

- code-cushman-001 (Chen et al., 2021) 是 OpenAI 开发的 120 亿参数模型，是 Github Copilot 的初始模型。

- GPT-3.5 and GPT-4 (OpenAI, 2023) are advanced generative AI models developed by OpenAI. While they are not explicitly trained for code generation, they also demonstrate notable performance in this domain. Their effectiveness in handling code generation tasks is largely attributed to their massive scale in terms of parameter count.

- GPT-3.5 和 GPT-4 (OpenAI, 2023) 是 OpenAI 开发的先进生成式 AI 模型。虽然它们不是专门为代码生成训练的，但在该领域也表现出显著性能。它们处理代码生成任务的有效性主要归因于其巨大的参数规模。

### 4.1. Code Generation

HumanEval and MBPP Benchmarks The HumanEval (Chen et al., 2021) and MBPP (Austin et al., 2021) benchmarks are widely used for evaluating code LLMs. HumanEval consists of 164 hand-written Python problems that are validated using test cases to assess the code generated by a Code LLM in a zero-shot setting, while the MBPP benchmark includes 500 problems in a few-shot setting. To evaluate the model's multilingual capabilities, we expanded the Python problems of Humaneval Benchmark to seven additional commonly used programming languages, namely C++, Java, PHP, TypeScript (TS), C#, Bash, and JavaScript (JS) (Cassano et al., 2023). For both benchmarks, We adopted a greedy search approach and re-implemented the baseline results using the same脚本 and environment for fair comparison.

HumanEval 和 MBPP 基准 HumanEval (Chen et al., 2021) 和 MBPP (Austin et al., 2021) 基准广泛用于评估代码大语言模型。HumanEval 包含 164 个手写 Python 问题，使用测试用例验证，在 zero-shot 设置下评估代码大语言模型生成的代码; MBPP 基准包含 500 个问题，在 few-shot 设置下评估。为了评估模型的多语言能力，我们将 Humaneval 基准的 Python 问题扩展到七种额外常用的编程语言，即 C++、Java、PHP、TypeScript (TS)、C#、Bash 和 JavaScript (JS) (Cassano et al., 2023)。对于两个基准，我们采用贪婪搜索方法，并使用相同的脚本和环境重新实现基线结果，以确保公平比较。

Table 3 
| Performance of approaches on the Multilingual HumanEval and MBPP Benchmarks.

> 表 3: 各方法在多语言 HumanEval 和 MBPP 基准上的性能。原表包含多语言 Base 模型和 Instruct 模型在 Python、C++、Java、PHP、TS、C#、Bash、JS 和 MBPP 上的 pass@1 结果，完整数据见 D3 原文。

The results are presented in Table 3. As we can see, DeepSeek-Coder-Base achieves stateof-the-art performance with an average accuracy of 50.3% on HumanEval and 66.0% on MBPP. In comparison to the similarly sized open-source model CodeLlama-Base 34B, our model has demonstrated a notable improvement of 9% and 11% in accuracy, respectively. It's worth noting that even our smaller model, DeepSeek-Coder-Base 6.7B, surpasses the performance of CodeLlama-Base 34B. After instruction fine-tuning, our model surpasses the closed-source GPT-3.5-Turbo model in HumanEval benchmark, significantly reducing the performance gap between OpenAI GPT-4 and open-source models.

结果如表 3 所示。可以看到，DeepSeek-Coder-Base 达到了最先进的性能，在 HumanEval 上平均准确率为 50.3%，在 MBPP 上为 66.0%。与同规模的开源模型 CodeLlama-Base 34B 相比，我们的模型分别在准确率上提升了 9% 和 11%。值得注意的是，即使是我们较小的模型 DeepSeek-Coder-Base 6.7B，也超越了 CodeLlama-Base 34B 的性能。经过指令微调后，我们的模型在 HumanEval 基准上超越了闭源的 GPT-3.5-Turbo 模型，显著缩小了 OpenAI GPT-4 与开源模型之间的性能差距。

DS-1000 Benchmark HumanEval and MBPP have a significant drawback in that they rely heavily on straightforward programming tasks that may not accurately represent大多数程序员通常编写的代码类型。In contrast, the DS-1000 benchmark, as introduced in the work by Lai et al. (2023), offers a comprehensive collection of 1,000 practical and realistic data science workflows across seven different libraries. This benchmark evaluates code generation by executing it against specific test cases. What sets DS-1000 apart is its categorization of problems based on the libraries involved, which encompass Matplotlib, NumPy, Pandas, SciPy, Scikit-

Learn, PyTorch, and TensorFlow. The benchmark assesses the performance of base models in the code completion setting and we provide pass@1 results for each library, as well as overall score.

DS-1000 基准 HumanEval 和 MBPP 有一个明显的缺陷，即它们严重依赖简单的编程任务，这些任务可能无法准确代表大多数程序员通常编写的代码类型。相比之下，Lai 等人 (2023) 提出的 DS-1000 基准提供了 1000 个跨七个不同库的实用且真实的数据科学工作流。该基准通过针对特定测试用例执行来评估代码生成。DS-1000 的独特之处在于它根据涉及的库对问题进行分类，涵盖 Matplotlib、NumPy、Pandas、SciPy、Scikit-Learn、PyTorch 和 TensorFlow。该基准在代码补全设置下评估基础模型的性能，我们提供每个库的 pass@1 结果以及总体分数。

The results of DS-1000 benchmark are shown in Table 4. As can be seen from the table, the DeepSeek-Coder model achieves relatively high accuracy in all libraries, demonstrating that our model is not only capable of generating good code but also of using libraries more accurately in real数据科学工作流中。

DS-1000 基准的结果如表 4 所示。从表中可以看出，DeepSeek-Coder 模型在所有库中都取得了相对较高的准确率，表明我们的模型不仅能够生成优质代码，还能在真实数据科学工作流中更准确地使用库。

Table 4 
| Results on the DS-1000 benchmark.

> 表 4: DS-1000 基准结果。原表包含 CodeGeeX2、StarCoder-Base、CodeLlama-Base 和 DeepSeek-Coder-Base(1.3B/6.7B/33B)在 Matplotlib、NumPy、Pandas、PyTorch、SciPy、Scikit-Learn、TensorFlow 和平均得分上的 pass@1 结果，完整数据见 D3 原文。

LeetCode Contest Benchmark To further validate the model's capability in real-world programming problems, we construct the LeetCode Contest benchmark3. LeetCode4 presents competition-level problems, offering significant challenges that test the model's problem understanding and code generation skills. We collected the latest problems from LeetCode Contests to prevent the appearance of both the problems or their solutions in our pre-training data. A total of 180 problems were collected from July 2023 to January 2024. For each problem, we collected 100 test cases to ensure the test coverage. We use the template "{problem_description}\nPlease complete the code below to solve the above problem:\n\`\`\`python\n{code_template}\n\`\`\`" to build the instruction prompt.

LeetCode 竞赛基准 为了进一步验证模型在真实编程问题上的能力，我们构建了 LeetCode 竞赛基准。LeetCode 提供竞赛级别的问题，对模型的问题理解和代码生成能力构成重大挑战。我们收集了 LeetCode 竞赛的最新题目，以防止题目或其解决方案出现在我们的预训练数据中。共收集了 2023 年 7 月至 2024 年 1 月的 180 道题目。对于每道题目，我们收集了 100 个测试用例以确保测试覆盖率。我们使用模板 "{问题描述}\n请完成以下代码来解决上述问题：\n\`\`\`python\n{代码模板}\n\`\`\`" 来构建指令提示。

The evaluation results are shown in Table 5. In our evaluation, the DeepSeek-Coder models demonstrate remarkable performance over current open-source coding models. Specifically, the DeepSeek-Coder-Instruct 6.7B and 33B achieve Pass@1 scores of 19.4% and 27.8% respectively in this benchmark. This performance notably surpasses existing open-sourced models such as Code-Llama-33B. The DeepSeek-Coder-Instruct 33B is the only open-sourced model that outperforms OpenAI's GPT-3.5-Turbo in this task. However, there remains a substantial performance gap when compared to the more advanced GPT-4-Turbo.

评估结果如表 5 所示。在我们的评估中，DeepSeek-Coder 模型相比当前开源编码模型表现出显著优势。具体而言，DeepSeek-Coder-Instruct 6.7B 和 33B 在该基准上分别取得了 19.4% 和 27.8% 的 Pass@1 分数。这一性能显著超越了 Code-Llama-33B 等现有开源模型。DeepSeek-Coder-Instruct 33B 是唯一在该任务上超越 OpenAI GPT-3.5-Turbo 的开源模型。然而，与更先进的 GPT-4-Turbo 相比，仍存在显著的性能差距。

Table 5 
| Performance of different models on the LeetCode Contest Benchmark.

> 表 5: 不同模型在 LeetCode 竞赛基准上的性能。原表包含 WizardCoder、CodeLlama、Phind-CodeLlama、GPT-3.5/GPT-4(±CoT)和 DeepSeek-Coder-Instruct(1.3B/6.7B/33B，±CoT)在 Easy/Medium/Hard/Overall 上的 Pass@1 结果，完整数据见 D3 原文。

Our analysis indicates that the implementation of Chain-of-Thought (CoT) prompting notably enhances the capabilities of DeepSeek-Coder-Instruct models. This improvement becomes particularly evident in the more challenging subsets of tasks. By adding the directive, "You need first to write a step-by-step outline and then write the code." following the initial prompt, we have observed enhancements in performance. This observation leads us to believe that the process of first crafting detailed code描述 assists the model in more effectively understanding and addressing the intricacies of logic and dependencies in coding tasks, particularly those of higher complexity. Therefore, we strongly recommend employing CoT prompting strategies when utilizing DeepSeek-Coder-Instruct models for complex coding challenges. Such an approach promotes a more methodical and logical framework for problem-solving, potentially resulting in more precise and efficient outcomes in code generation tasks.

我们的分析表明，思维链(Chain-of-Thought, CoT)提示的实现显著增强了 DeepSeek-Coder-Instruct 模型的能力。这种改进在更具挑战性的任务子集中尤为明显。通过在初始提示后添加指令"你需要先写一个逐步大纲，然后再写代码"，我们观察到了性能提升。这一观察使我们相信，首先制定详细的代码描述的过程有助于模型更有效地理解和处理编码任务中的逻辑和依赖复杂性，尤其是那些复杂度更高的任务。因此，我们强烈建议在使用 DeepSeek-Coder-Instruct 模型处理复杂编码挑战时采用 CoT 提示策略。这种方法促进了更系统化、更符合逻辑的解题框架，可能在代码生成任务中产生更精确、更高效的结果。

> 译者注: CoT 对代码模型的提升是一个有趣且重要的发现。传统上 CoT 被认为主要用于数学推理(如 GSM8K)，但论文证明它在竞赛级编程中也有显著效果——尤其是在 Hard 难度的题目上。这暗示代码生成不仅仅是"翻译"问题描述为代码，而是需要中间推理步骤(如设计算法、选择数据结构、处理边界情况)。后来的研究表明，CoT 对代码模型的效果取决于任务复杂度：简单任务(如 HumanEval)使用 CoT 反而可能降低性能(因为增加了不必要的 token 开销)，但复杂任务(如 LeetCode Hard)中 CoT 的收益明显。

It is important to acknowledge that despite our diligent efforts to gather the most recent code questions for model testing, the possibility of data contamination cannot be entirely ruled out. We observed that the GPT-4-Turbo and DeepSeek-Coder models achieved higher scores in the LeetCode Contest held in July and August. We encourage the research社区 to consider the potential issue of data contamination when evaluating models in future studies using our released LeetCode data.

需要承认的是，尽管我们努力收集最新的编程题目用于模型测试，但数据污染的可能性无法完全排除。我们观察到 GPT-4-Turbo 和 DeepSeek-Coder 模型在 7 月和 8 月举行的 LeetCode 竞赛中取得了较高分数。我们鼓励研究社区在未来使用我们发布的 LeetCode 数据评估模型时考虑潜在的数据污染问题。

### 4.2. Fill-in-the-Middle Code Completion

DeepSeek-Coder models are trained with a 0.5 FIM (Fill-In-the-Middle) rate during their pretraining phase. This specialized training strategy empowers the model to proficiently generate code by filling in blanks based on the surrounding context, both prefix and suffix, of the given code snippet. This capability is particularly advantageous in the realm of code completion tools. Several open-source models have emerged with similar capabilities. Notable among these are SantaCoder (Allal et al., 2023), StarCoder (Li et al., 2023), and CodeLlama (Roziere et al., 2023). These models have set a precedent in the field of code generation and completion. In evaluating the performance DeepSeek-Coder models, we conducted a comparative analysis with the aforementioned models. The benchmark for this comparison was the Single-Line Infilling benchmarks, encompassing three different programming languages, as proposed by Allal et al. (2023). This benchmark uses the line exact match accuracy as the evaluation metric.

DeepSeek-Coder 模型在预训练阶段以 0.5 的 FIM(Fill-In-the-Middle)率进行训练。这种专门的训练策略使模型能够熟练地根据给定代码片段的前后上下文(前缀和后缀)填补空白来生成代码。这种能力在代码补全工具领域尤为有利。多个开源模型也具备类似能力，其中值得注意的有 SantaCoder (Allal et al., 2023)、StarCoder (Li et al., 2023) 和 CodeLlama (Roziere et al., 2023)。这些模型在代码生成和补全领域树立了先例。在评估 DeepSeek-Coder 模型性能时，我们与上述模型进行了对比分析。对比基准是 Allal 等人 (2023) 提出的单行填充基准，涵盖三种不同的编程语言。该基准使用行精确匹配准确率作为评估指标。

Table 6 
| Performance of different approaches on the FIM-Tasks.

> 表 6: 不同方法在 FIM 任务上的性能。原表包含 SantaCoder、StarCoder、CodeLlama-Base 和 DeepSeek-Coder-Base(1.3B/7B/33B)在 Python/Java/JavaScript/Mean 上的行精确匹配结果，完整数据见 D3 原文。

The evaluation results are shown in Table 6. Despite being the smallest model with a capacity of 1.3 billion parameters, DeepSeek-Coder outperforms its larger counterparts, StarCoder and CodeLlama, in these benchmarks. This superior performance can be attributed to the high quality of the pre-trained data utilized by DeepSeek-Coder. Furthermore, a notable trend observed is the correlation between the size of the model and its performance. As the model size increases, there is a corresponding and responsible enhancement in performance. This trend underscores the importance of model capacity in achieving higher accuracy in code completion tasks. Based on these findings, we recommend the deployment of the DeepSeek-Coder-Base 6.7B model in code completion工具. This recommendation is grounded in the model's demonstrated balance between efficiency and accuracy. The DeepSeek-Coder-Base 6.7B model, with its substantial parameter size, has proven to be highly effective in the context of code completion, making it an ideal choice for integrating advanced computational capabilities into coding environments.

评估结果如表 6 所示。尽管 DeepSeek-Coder-Base 1.3B 是最小的模型(仅 13 亿参数)，但在这些基准上却超越了更大的 StarCoder 和 CodeLlama 模型。这种优越性能可归因于 DeepSeek-Coder 使用的高质量预训练数据。此外，观察到一个显著的趋势：模型规模与性能之间存在正相关。随着模型规模增大，性能相应提升。这一趋势凸显了模型容量在实现更高代码补全准确率方面的重要性。基于这些发现，我们推荐在代码补全工具中部署 DeepSeek-Coder-Base 6.7B 模型。这一建议基于该模型在效率和准确率之间已证明的平衡。DeepSeek-Coder-Base 6.7B 模型凭借其可观的参数量，在代码补全方面被证明非常有效，是将先进计算能力集成到编码环境中的理想选择。

### 4.3. Cross-File Code Completion

In this section, we will evaluate the performance of existing open-source models in cross-file code completion tasks. Unlike code generation discussed in the previous section, cross-file code completion requires the model to access and understand repositories that span multiple files with numerous cross-file dependencies. We use CrossCodeEval (Ding et al., 2023) to evaluate the capabilities of currently available open-source code models of 7B scale in cross-file completion tasks. This dataset is constructed on a diverse set of real-world, open-sourced, permissively licensed repositories in four popular programming languages: Python, Java, TypeScript, and C#. The dataset is specifically designed to strictly require cross-file context for accurate completion. Notably, this dataset was constructed from repositories created between March and June 2023, while our pre-training data only includes code created before February 2023, which ensures that this dataset was not present in our pre-training data, thus avoiding data leakage.

在本节中，我们将评估现有开源模型在跨文件代码补全任务中的性能。与上一节讨论的代码生成不同，跨文件代码补全要求模型访问和理解跨多个文件、具有众多跨文件依赖关系的仓库。我们使用 CrossCodeEval (Ding et al., 2023) 来评估当前可用的 7B 规模开源代码模型在跨文件补全任务中的能力。该数据集基于一组多样化的真实世界、开源、许可宽松的实际仓库构建，涵盖四种流行的编程语言：Python、Java、TypeScript 和 C#。该数据集专门设计为严格需要跨文件上下文才能准确补全。值得注意的是，该数据集由 2023 年 3 月至 6 月创建的仓库构建，而我们的预训练数据仅包含 2023 年 2 月之前创建的代码，这确保了该数据集不存在于我们的预训练数据中，从而避免了数据泄漏。

Table 7 
| Performance of different models on cross-file code completion.

> 表 7: 不同模型在跨文件代码补全上的性能。原表包含 CodeGeeX2、StarCoder-Base、CodeLlama-Base 和 DeepSeek-Coder-Base(±Retrieval，±w/o Repo Pre-training)在 Python/Java/TypeScript/C# 的 EM(精确匹配)和 ES(编辑相似度)结果，完整数据见 D3 原文。

In our evaluation of various models, we set the maximum sequence length to 2048 tokens, the maximum output length to 50 tokens, and a limit of 512 tokens for the cross-file context. For the cross-file context, we utilize the official BM25 search results provided by Ding et al. (2023). Evaluation metrics include exact match and edit similarity. The results, presented in Table 7, demonstrate that DeepSeek-Coder consistently outperforms other models in cross-file completion tasks across multiple languages, showcasing its superior practical application capabilities. When only utilizing file-level code corpus (w/o Repo Pre-training) to pre-train DeepSeek-Coder, we observe a decrease in performance in the Java, TypeScript, and C# languages, indicating the effectiveness of the repository-level pre-training.

在评估各种模型时，我们将最大序列长度设为 2048 token，最大输出长度为 50 token，跨文件上下文限制为 512 token。对于跨文件上下文，我们使用 Ding 等人 (2023) 提供的官方 BM25 搜索结果。评估指标包括精确匹配(EM)和编辑相似度(ES)。表 7 中的结果表明，DeepSeek-Coder 在跨文件补全任务中持续超越其他模型，跨越多种语言，展示了其卓越的实践应用能力。当仅使用文件级代码语料(无仓库预训练)预训练 DeepSeek-Coder 时，我们观察到在 Java、TypeScript 和 C# 语言上的性能下降，这表明仓库级预训练的有效性。

> 译者注: 跨文件补全是验证"仓库级预训练"价值的直接证据。表 7 中的消融实验(+Retrieval w/o Repo Pre-training)非常关键：即使给文件级预训练模型提供相同的 BM25 检索到的跨文件上下文，其表现仍然落后于仓库级预训练模型。这说明仓库级预训练不仅让模型"看到"了跨文件信息，更教会了模型如何理解和利用这些信息。这是一个重要的区分：数据暴露 vs 能力学习。

### 4.4. Program-based Math Reasoning

Program-based math reasoning involves evaluating a model's ability to understand and solve mathematical problems through programming. This type of reasoning is critical in fields such as data analysis and scientific computing. To conduct this assessment, we utilize the Program-Aided Math Reasoning (PAL) method as outlined in Gao et al. (2023). This approach is applied across seven distinct benchmarks, each offering unique challenges and contexts. These benchmarks includes GSM8K (Cobbe et al., 2021), MATH (Hendrycks et al., 2021), GSM-Hard (Gao et al., 2023), SVAMP (Patel et al., 2021), TabMWP (Lu et al., 2022), ASDiv (Miao et al., 2020) and MAWPS (Gou et al., 2023). In each of these benchmarks, the model is prompted to alternately描述 a solution step in natural language and then execute that step with code. As seen in Table 8, DeepSeek-Coder models achieve a remarkable performance across all benchmarks, especially the 33B variant, which demonstrates the potential of using such models in applications that require complex mathematical computations and problem-solving abilities.

基于程序的数学推理涉及评估模型通过编程理解和解决数学问题的能力。这种推理在数据分析和科学计算等领域至关重要。为了进行评估，我们使用 Gao 等人 (2023) 概述的程序辅助数学推理(Program-Aided Math Reasoning, PAL)方法。该方法应用于七个不同的基准，每个基准都提供独特的挑战和上下文。这些基准包括 GSM8K (Cobbe et al., 2021)、MATH (Hendrycks et al., 2021)、GSM-Hard (Gao et al., 2023)、SVAMP (Patel et al., 2021)、TabMWP (Lu et al., 2022)、ASDiv (Miao et al., 2020) 和 MAWPS (Gou et al., 2023)。在每个基准中，模型被提示用自然语言交替描述解题步骤，然后用代码执行该步骤。如表 8 所示，DeepSeek-Coder 模型在所有基准上都取得了显著性能，尤其是 33B 变体，展示了将此类模型用于需要复杂数学计算和问题解决能力的应用中的潜力。

Table 8 
| Performance of different approaches on the program-aid math reasoning tasks.

> 表 8: 不同方法在程序辅助数学推理任务上的性能。原表包含 CodeGeeX-2、StarCoder-Base、CodeLlama-Base 和 DeepSeek-Coder-Base(1.3B/6.7B/33B)在 GSM8k、MATH、GSM-Hard、SVAMP、TabMWP、ASDiv、MAWPS 和平均得分上的结果，完整数据见 D3 原文。

## 5. Continue Pre-Training From General LLM

To further enhance the natural language understanding and mathematical reasoning abilities of the DeepSeek-Coder model, we perform additional pre-training from the general language model DeepSeek-LLM-7B Base (DeepSeek-AI, 2024) on 2 trillion tokens, resulting in DeepSeek-Coder-v1.5 7B. For this pre-training, we specifically use the data sources listed in Table 9. Unlike DeepSeek-Coder, DeepSeek-Coder-v1.5 employs solely a next token prediction objective with a 4K context length during its pre-training phase.

为了进一步增强 DeepSeek-Coder 模型的自然语言理解和数学推理能力，我们从通用语言模型 DeepSeek-LLM-7B Base (DeepSeek-AI, 2024) 出发，在 2 万亿 token 上进行额外预训练，得到 DeepSeek-Coder-v1.5 7B。对于这次预训练，我们专门使用表 9 中列出的数据来源。与 DeepSeek-Coder 不同，DeepSeek-Coder-v1.5 在预训练阶段仅使用下一 token 预测目标和 4K 上下文长度。

Table 9 
| Data sources for DeepSeek-Coder-v1.5 7B pre-training

> 表 9: DeepSeek-Coder-v1.5 7B 预训练的数据来源。原表包含源代码 70%、Markdown 和 StackExchange 10%、代码相关自然语言 7%、数学相关自然语言 7%、中英双语自然语言 6%。

We conduct a comparison between DeepSeek-Coder-v1.5 7B and DeepSeek-Coder 6.7B, and re-run all benchmarks using our evaluation pipeline to ensure a fair comparison. We evaluate performance across a wide range of tasks, which can be categorized as follows:

我们对 DeepSeek-Coder-v1.5 7B 和 DeepSeek-Coder 6.7B 进行了比较，并使用我们的评估流水线重新运行所有基准以确保公平比较。我们在广泛的任务上评估性能，可分为以下几类：

- Programming: This category includes evaluations in a multilingual setting using the HumanEval dataset by Chen et al. (2021), as well as evaluations in a Python setting using the MBPP dataset by Austin et al. (2021)

- 编程：此类别包括使用 Chen 等人 (2021) 的 HumanEval 数据集进行多语言设置评估，以及使用 Austin 等人 (2021) 的 MBPP 数据集进行 Python 设置评估。

- Math Reasoning: We assess performance on math推理 tasks using the GSM8K benchmark (Cobbe et al., 2021) and the MATH (Hendrycks et al., 2021) benchmark [4]. These tasks involve solving math problems by generating programs.

- 数学推理：我们使用 GSM8K 基准 (Cobbe et al., 2021) 和 MATH 基准 (Hendrycks et al., 2021) 评估数学推理任务的性能。这些任务涉及通过生成程序来解决数学问题。

- Natural Language Our evaluation in natural language tasks includes MMLU (Hendrycks et al., 2020), BBH (Suzgun et al., 2022), HellaSwag (Zellers et al., 2019), Winogrande (Sakaguchi et al., 2021), and ARC-Challenge (Clark et al., 2018) benchmarks.

- 自然语言：我们在自然语言任务上的评估包括 MMLU (Hendrycks et al., 2020)、BBH (Suzgun et al., 2022)、HellaSwag (Zellers et al., 2019)、Winogrande (Sakaguchi et al., 2021) 和 ARC-Challenge (Clark et al., 2018) 基准。

The results for the Base and Instruct models are presented in Table 10. It is observed that the DeepSeek-Coder-Base-v1.5 model, despite a slight decrease in coding performance, shows marked improvements across most tasks when compared to the DeepSeek-Coder-Base model. In particular, in the Math Reasoning and Natural Language categories, DeepSeek-Coder-Base-v1.5 significantly outperforms its predecessor across all benchmarks, which also demonstrates significant improvements in its mathematical reasoning and natural语言 processing capabilities.

Base 和 Instruct 模型的结果如表 10 所示。可以观察到，DeepSeek-Coder-Base-v1.5 模型尽管编码性能略有下降，但在大多数任务上相比 DeepSeek-Coder-Base 模型表现出显著改进。特别是在数学推理和自然语言类别中，DeepSeek-Coder-Base-v1.5 在所有基准上都显著优于其前身，这也证明了其数学推理和自然语言处理能力的显著提升。

Table 10 
| Comparative analysis of performance between DeepSeek-Coder-Base and DeepSeek-Coder-Base-v1.5. Math tasks are solved through programming.

> 表 10: DeepSeek-Coder-Base 与 DeepSeek-Coder-Base-v1.5 的性能对比分析。数学任务通过编程解决。原表包含 Base 和 Instruct 版本在 Programming(HumanEval、MBPP)、Math Reasoning(GSM8K、MATH)和 Natural Language(MMLU、BBH、HellaSwag、WinoG、ARC-C)上的详细结果，完整数据见 D3 原文。

> 译者注: Coder-v1.5 的实验是一个重要的"概念验证"：证明代码模型不应孤立地训练，而应基于强大的通用 LLM。v1.5 从 DeepSeek-LLM-7B 继续预训练(而非从头训练)，在 GSM8K 上从 43.2% 提升到 62.4%(Base)和 72.6%(Instruct)，MMLU 从 36.6% 提升到 49.1%。这一发现直接影响了后续 Coder-V2 的设计决策——选择 DeepSeek-V2 作为基座而非 Coder-33B。论文的总结性观点"最有效的代码专用大语言模型是建立于强大通用大语言模型之上的"成为 DeepSeek 后续代码模型开发的核心原则。

## 6. Conclusion

In this technical report, we introduce a series of specialized Large Language Models (LLMs) for coding, named DeepSeek-Coder, available in three distinct scales: 1.3B, 6.7B, and 33B parameters. These models are uniquely trained on a meticulously curated project-level code corpus, utilizing a "fill-in-the-blank" pre-training objective to enhance code infilling capabilities. A significant advancement is the extension of the models' context window to 16,384 tokens, thereby greatly improving their effectiveness in handling extensive code generation tasks. Our evaluations reveal that the most advanced model in our series, DeepSeek-Coder-Base 33B surpasses existing open-source code models across a variety of standard tests. Impressively, the DeepSeek-Coder-Base 6.7B model, despite its smaller scale, delivers performance on par with the 34B parameter CodeLlama, a testament to the high quality of our pretraining corpus.

在本技术报告中，我们介绍了一系列专为编码设计的专用大语言模型——DeepSeek-Coder，提供三种不同的规模：1.3B、6.7B 和 33B 参数。这些模型独特地在一个精心策划的项目级代码语料上训练，利用"填空"预训练目标来增强代码填充能力。一个重要的进展是将模型的上下文窗口扩展到 16,384 token，从而大大提高了它们处理大规模代码生成任务的有效性。我们的评估表明，我们系列中最先进的模型 DeepSeek-Coder-Base 33B 在多种标准测试中超越了现有开源代码模型。令人印象深刻的是，DeepSeek-Coder-Base 6.7B 模型尽管规模较小，但性能与 34B 参数的 CodeLlama 相当，这证明了我们预训练语料的高质量。

To augment the zero-shot instruction capabilities of the DeepSeek-Coder-Base models, we have fine-tuned them with high-quality instructional data. This has led to the DeepSeek-Coder-Instruct 33B model outperforming OpenAI's GPT-3.5 Turbo in a range of coding-related tasks, showcasing its exceptional proficiency in代码生成 and understanding.

为了增强 DeepSeek-Coder-Base 模型的 zero-shot 指令能力，我们使用高质量指令数据对它们进行了微调。这使得 DeepSeek-Coder-Instruct 33B 模型在一系列与编码相关的任务上超越了 OpenAI 的 GPT-3.5 Turbo，展示了其在代码生成和理解方面的卓越能力。

To further improve the natural language understanding capabilities of the DeepSeek-Coder-Base models, we have conducted additional pretraining based on the DeepSeek-LLM 7B checkpoint. This additional training involved processing a diverse dataset comprising 2 billion tokens, including natural language, code, and mathematical data. The result is the creation of a new and improved code model, DeepSeek-Coder-v1.5. Our observations indicate that DeepSeek-Coder-v1.5 not only maintains its predecessor's high-level coding performance but also exhibits enhanced natural language comprehension. This advancement underscores our belief that the most effective code-focused Large Language Models (LLMs) are those built upon robust general LLMs. The reason is evident: to effectively interpret and execute coding tasks, these models must also possess a deep understanding of human instructions, which often come in various forms of natural language. Looking ahead, our commitment is to develop and openly share even more powerful code-focused LLMs based on larger-scale general LLMs.

为了进一步提高 DeepSeek-Coder-Base 模型的自然语言理解能力，我们基于 DeepSeek-LLM 7B 检查点进行了额外预训练。这次额外训练涉及处理一个包含 20 亿 token 的多样化数据集，包括自然语言、代码和数学数据。结果是创建了一个新的改进型代码模型 DeepSeek-Coder-v1.5。我们的观察表明，DeepSeek-Coder-v1.5 不仅保持了其前身的高水平编码性能，还展现出增强的自然语言理解能力。这一进展强调了我们的信念：最有效的面向代码的大语言模型是建立于强大的通用大语言模型之上的。原因很简单：为了有效理解和执行编码任务，这些模型还必须深入理解人类指令，而人类指令通常以各种形式的自然语言出现。展望未来，我们致力于开发并开放分享基于更大规模通用大语言模型的更强大的面向代码的大语言模型。

## Acknowledgements

We would like to express our gratitude to Bo Liu, Chengqi Deng, Chong Ruan, Damai Dai, Jiashi Li, Kang Guan, Mingchuan Zhang, Panpan Huang, Shuiping Yu, Shirong Ma, Yaofeng Sun, Yishi Piao, Zhihong Shao, and Zhewen Hao for their invaluable discussions and assistance during training DeepSeek-Coder models.

我们要感谢 Bo Liu、Chengqi Deng、Chong Ruan、Damai Dai、Jiashi Li、Kang Guan、Mingchuan Zhang、Panpan Huang、Shuiping Yu、Shirong Ma、Yaofeng Sun、Yishi Piao、Zhihong Shao 和 Zhewen Hao 在训练 DeepSeek-Coder 模型期间提供的宝贵讨论和帮助。

## References

参考文献列表(按原文顺序)

- L. B. Allal 等. Santacoder: don't reach for the stars! arXiv:2301.03988, 2023.
- J. Austin 等. Program synthesis with large language models, 2021.
- M. Bavarian 等. Efficient training of language models to fill in the middle. arXiv:2207.14255, 2022.
- F. Cassano 等. Multipl-e: a scalable and polyglot approach to benchmarking neural code generation. IEEE TSE, 2023.
- M. Chen 等. Evaluating large language models trained on code. arXiv:2107.03374, 2021.
- S. Chen 等. Extending context window of large language models via positional interpolation. arXiv:2306.15595, 2023.
- P. Clark 等. Think you have solved question answering? try arc. arXiv:1803.05457, 2018.
- K. Cobbe 等. Training verifiers to solve math word problems. arXiv:2110.14168, 2021.
- T. Dao. Flashattention-2: Faster attention with better parallelism and work partitioning, 2023.
- DeepSeek-AI. Deepseek llm: Scaling open-source language models with longtermism. arXiv:2401.02954, 2024.
- Y. Ding 等. Crosscodeeval: A diverse and multilingual benchmark for cross-file code completion. NeurIPS D&B, 2023.
- Z. Du 等. Glm: General language model pretraining with autoregressive blank infilling. ACL 2022.
- D. Fried 等. Incoder: A generative model for code infilling and synthesis. arXiv:2204.05999, 2022.
- L. Gao 等. Pal: Program-aided language models. ICML 2023.
- Gemini Team. Gemini: A family of highly capable multimodal models, 2023.
- Z. Gou 等. Tora: A tool-integrated reasoning agent for mathematical problem solving. arXiv:2309.17452, 2023.
- D. Hendrycks 等 (2020). Measuring massive multitask language understanding. ICLR 2021.
- D. Hendrycks 等 (2021). Measuring mathematical problem solving with the math dataset. arXiv:2103.03874.
- High-Flyer. Hai-llm: An efficient and lightweight tool for training large models. 2023.
- kaiokendev. Things i'm learning while training superhot. 2023.
- D. Kocetkov 等. The stack: 3 tb of permissively licensed source code. TMLR, 2022.
- V. A. Korthikanti 等. Reducing activation recomputation in large transformer models. MLSys, 2023.
- Y. Lai 等. Ds-1000: A natural and reliable benchmark for data science code generation. ICML 2023.
- K. Lee 等. Deduplicating training data makes language models better. ACL 2022.
- R. Li 等. Starcoder: may the source be with you! arXiv:2305.06161, 2023.
- I. Loshchilov and F. Hutter. Decoupled weight decay regularization, 2019.
- P. Lu 等. Dynamic prompt learning via policy gradient for semi-structured mathematical reasoning. ICLR 2023.
- S.-Y. Miao 等. A diverse corpus for evaluating and developing english math word problem solvers. ACL 2020.
- D. Narayanan 等. Pipedream: Generalized pipeline parallelism for dnn training. SOSP 2019.
- E. Nijkamp 等 (2022). Codegen: An open large language model for code. arXiv:2203.13474.
- E. Nijkamp 等 (2023). Codegen2: Lessons for training llms on programming and natural languages.
- OpenAI. Gpt-4 technical report, 2023.
- A. Patel 等. Are nlp models really able to solve simple math word problems? NAACL 2021.
- C. Raffel 等. Exploring the limits of transfer learning with a unified text-to-text transformer, 2023.
- S. Rajbhandari 等. Zero: Memory optimizations toward training trillion parameter models. SC 2020.
- B. Roziere 等. Code llama: Open foundation models for code. arXiv:2308.12950, 2023.
- K. Sakaguchi 等. Winogrande: An adversarial winograd schema challenge at scale. CACM 2021.
- R. Sennrich 等. Neural machine translation of rare words with subword units. arXiv:1508.07909, 2015.
- J. Su 等. Roformer: Enhanced transformer with rotary position embedding, 2023.
- M. Suzgun 等. Challenging big-bench tasks and whether chain-of-thought can solve them. arXiv:2210.09261, 2022.
- R. Taori 等. Stanford alpaca: An instruction-following llama model. 2023.
- H. Touvron 等. Llama 2: Open foundation and fine-tuned chat models. arXiv:2307.09288, 2023.
- Y. Wang 等. Codet5: Identifier-aware unified pre-trained encoder-decoder models. arXiv:2109.00859, 2021.
- R. Zellers 等. Hellaswag: Can a machine really finish your sentence? ACL 2019.
- Q. Zheng 等. Codegeex: A pre-trained model for code generation with multilingual benchmarking. KDD 2023.

## A. Cases of Chatting with DeepSeek-Coder-Instruct

We will present two cases of interactions with DeepSeek-Coder-Instruct, with one involving a multi-turn conversation about creating a database and performing data analysis, and the other centered around using a model to solve a sample problem from LeetCode.

我们将展示两个与 DeepSeek-Coder-Instruct 交互的案例，一个是关于创建数据库和执行数据分析的多轮对话，另一个是使用模型解决 LeetCode 示例问题。

In the first scenario, depicted in Figure 5, we instruct the model to build a student database using Python and randomly insert 10 pieces of information. Subsequently, in the second round of the conversation, we continue to ask the model by analyzing the age distribution of the students. From Figure 5, it's evident that the model can generate bug-free and comprehensive code, accompanied by explanatory details. In the second scenario, as illustrated in Figure 6, we further assess the model's capabilities by testing it on an out-of-domain LeetCode contest problem. This particular problem was released in November 2023, after our data collection, and thus, isn't part of our model's training data. The results show that our model excels at solving problems that extend beyond its training distribution.

在第一个场景中(图 5)，我们指示模型使用 Python 构建一个学生数据库并随机插入 10 条信息。随后，在第二轮对话中，我们继续要求模型分析学生的年龄分布。从图 5 中可以明显看出，模型能够生成无 bug 且全面的代码，并附带解释性细节。在第二个场景中(图 6)，我们通过在域外 LeetCode 竞赛问题上测试模型来进一步评估其能力。这道特定题目发布于 2023 年 11 月，在我们的数据收集之后，因此不属于我们模型的训练数据。结果表明，我们的模型擅长解决超出其训练分布的问题。

![](images/figure_08_database_analysis_case.jpg)  
Figure 5 | An example of building database and data analysis.

> 图 5: 构建数据库和数据分析的示例。

![](images/fig06_leetcode_example.jpg)  
Figure 6 | An example of solving LeetCode Problem.

> 图 6: 解决 LeetCode 问题的示例。

## B. Benchmark curves during training of DeepSeek-Coder-Base

In Figure 7, we present the benchmark curves illustrating the performance of DeepSeek-Coder-Base models during their training phase. For validation, a carefully curated subset of the training corpus was employed, consisting of 8,000 code files. This subset was deliberately chosen to ensure a diverse and representative sample, critical for an accurate assessment of the models' capabilities. The performance metrics of these models are specifically detailed in the final two sub-figures of Figure 7, offering a clear visual representation of their efficacy throughout the training process.

在图 7 中，我们展示了 DeepSeek-Coder-Base 模型在训练阶段的基准曲线。为了验证，我们使用了一个精心策划的训练语料子集，包含 8,000 个代码文件。该子集经过特意挑选，以确保多样性和代表性，这对于准确评估模型的能力至关重要。这些模型的性能指标详细展示在图 7 的最后两个子图中，清晰直观地展现了它们在训练过程中的效果。

> 译者注: 训练曲线(图 7)虽然 D3 中包含，但主要是技术验证用的可视化数据，对读者理解核心方法的贡献有限。感兴趣的读者可查阅 D3 原文中的图 7 及相应曲线。

![](images/chart_13_training_curve_1.jpg)

![](images/chart_14_training_curve_2.jpg)

![](images/chart_15_training_curve_3.jpg)

![](images/chart_16_training_curve_4.jpg)

![](images/chart_17_training_curve_5.jpg)

![](images/chart_18_training_curve_6.jpg)

![](images/chart_19_training_curve_7.jpg)

![](images/chart_20_training_curve_8.jpg)  
Figure 7 | Benchmark curves during training of DeepSeek-Coder-Base.

> 图 7: DeepSeek-Coder-Base 训练期间的基准曲线。

---

## 全文完

## 关联文件说明

- 原文 (D3): `03-DeepSeek-Coder-mineru-en.md`
- 精译 (D1): `01-DeepSeek-Coder技术报告精译.md`
- 架构剖析 (D2): `02-DeepSeek-Coder核心架构剖析.md`
- 专题 (D5): `05-DeepSeek-Coder-Architecture-Overview.md`
- 导航 (D5): `05-DeepSeek-Coder-Index.md`
