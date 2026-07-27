---
title: "04 · DeepSeek-V3.2 - 逐段精译与译者注"
source: 03-DeepSeek-V3.2-mineru-en.md
translated_by: "AI Agent"
date: 2026-05-19
---

# DeepSeek-V3.2: Pushing the Frontier of Open Large Language Models

>  **[返回 14.1-DeepSeek 家族总览](../../14.1-DeepSeek.md)**


# DeepSeek-V3.2: 推动开源大语言模型的前沿

DeepSeek-AI

research@deepseek.com

## Abstract

We introduce DeepSeek-V3.2, a model that harmonizes high computational efficiency with superior reasoning and agent performance. The key technical breakthroughs of DeepSeek-V3.2 are as follows: (1) DeepSeek Sparse Attention (DSA): We introduce DSA, an efficient attention mechanism that substantially reduces computational complexity while preserving model performance in long-context scenarios. (2) Scalable Reinforcement Learning Framework: By implementing a robust reinforcement learning protocol and scaling post-training compute, DeepSeek-V3.2 performs comparably to GPT-5. Notably, our high-compute variant, DeepSeek-V3.2-Speciale, surpasses GPT-5 and exhibits reasoning proficiency on par with Gemini-3.0-Pro, achieving gold-medal performance in both the 2025 International Mathematical Olympiad (IMO) and the International Olympiad in Informatics (IOI). (3) Large-Scale Agentic Task Synthesis Pipeline: To integrate reasoning into tool-use scenarios, we developed a novel synthesis pipeline that systematically generates training data at scale. This methodology facilitates scalable agentic post-training, yielding substantial improvements in generalization and instruction-following robustness within complex, interactive environments.

我们推出了 DeepSeek-V3.2，一个在高计算效率与卓越推理和智能体性能之间取得平衡的模型。DeepSeek-V3.2 的关键技术突破如下：(1) DeepSeek Sparse Attention (DSA，深度求索稀疏注意力)：我们引入了 DSA，一种高效的注意力机制，在大幅降低计算复杂度的同时，保持长上下文场景下的模型性能。(2) 可扩展强化学习框架：通过实施稳健的强化学习协议并扩大后训练计算量，DeepSeek-V3.2 的性能可与 GPT-5 媲美。值得注意的是，我们的高计算变体 DeepSeek-V3.2-Speciale 超越了 GPT-5，展现出与 Gemini-3.0-Pro 相当的推理能力，在 2025 年国际数学奥林匹克 (IMO) 和国际信息学奥林匹克 (IOI) 中均获得金牌级表现。(3) 大规模智能体任务合成流水线：为了将推理能力整合到工具使用场景中，我们开发了一种新颖的合成流水线，系统地大规模生成训练数据。这一方法促进了可扩展的智能体后训练，在复杂交互环境中显著提升了泛化能力和指令遵循的鲁棒性。

> 译者注: DeepSeek-V3.2 的定位非常清晰——它不是从零预训练的新模型，而是在 V3.1-Terminus 基础上通过继续预训练 + 后训练升级的版本。三大技术支柱中，DSA 解决的是"效率瓶颈"(长序列注意力计算量爆炸)，可扩展 RL 解决的是"后训练投入不足"(开源模型普遍在 RL 阶段计算预算远低于闭源对手)，智能体任务合成解决的是"工具使用泛化差"(开源模型在真实 agent 场景中表现落后)。这三个问题恰好对应了论文 Introduction 中识别的开源模型三大缺陷。

![](images/fig01_capabilities_overview.jpg)  
Reasoning Capabilities  
Agentic Capabilities

> 推理能力 / 智能体能力

Figure 1 | Benchmark of DeepSeek-V3.2 and its counterparts. For HMMT 2025, we report the February competition, consistent with the baselines. For HLE, we report the text-only subset.

> 图 1: DeepSeek-V3.2 及其对比模型的基准测试。对于 HMMT 2025，我们报告二月的比赛结果，与基线一致。对于 HLE，我们报告纯文本子集。

## 1. Introduction

## 1. 引言

The release of reasoning models (DeepSeek-AI, 2025; OpenAI, 2024a) marked a pivotal moment in the evolution of Large Language Models (LLMs), catalyzing a substantial leap in overall performance across the verifiable fields. Since this milestone, the capabilities of LLMs have advanced rapidly. However, a distinct divergence has emerged in the past months. While the open-source community (MiniMax, 2025; MoonShot, 2025; Qwen, 2025; ZhiPu-AI, 2025) continues to make strides, the performance trajectory of closed-source proprietary models (Anthropic, 2025b; DeepMind, 2025a; OpenAI, 2025) has accelerated at a significantly steeper rate. Consequently, rather than converging, the performance gap between closed-source and opensource models appears to be widening, with proprietary systems demonstrating increasingly superior capabilities in complex tasks.

推理模型的发布 (DeepSeek-AI, 2025; OpenAI, 2024a) 标志着大语言模型 (LLM) 发展史上的一个关键时刻，在可验证领域推动了整体性能的大幅跃升。自这一里程碑以来，LLM 的能力迅速提升。然而，过去几个月出现了一个明显的分化趋势。尽管开源社区 (MiniMax, 2025; MoonShot, 2025; Qwen, 2025; ZhiPu-AI, 2025) 继续取得进展，但闭源专有模型 (Anthropic, 2025b; DeepMind, 2025a; OpenAI, 2025) 的性能轨迹以显著更陡的斜率加速上升。因此，闭源与开源模型之间的性能差距似乎正在扩大而非收敛，专有系统在复杂任务中展现出越来越强的能力。

> 译者注: 论文开篇就点出了一个严峻的现实——开源与闭源的差距在拉大而非缩小。这与 2024 年底 DeepSeek-R1 发布时的乐观情绪形成对比。当时 R1 被认为"追平了 OpenAI o1"，但几个月后 GPT-5、Gemini-3.0-Pro 等闭源模型再次拉开了距离。这种"追赶-被拉开-再追赶"的循环反映了开源社区在计算资源上的结构性劣势：闭源公司可以投入数亿美元进行 RL 训练，而开源项目通常依赖有限的学术或企业赞助算力。

Through our analysis, we identify three critical deficiencies that limit the capability of opensource models in complex tasks. First, architecturally, the predominant reliance on vanilla attention (Vaswani et al., 2017) mechanisms severely constrains efficiency for long sequences. This inefficiency poses a substantial obstacle to both scalable部署 and effective posttraining. Second, regarding resource allocation, open-source models suffer from insufficient computational investment during the post-training phase, limiting their performance on hard tasks. Finally, in the context of AI agents, open-source models demonstrate a marked lag in generalization and instruction-following capabilities compared to their proprietary counterparts (EvalSys, 2025; Li et al., 2025; Luo et al., 2025), hindering their effectiveness in real deployment.

通过我们的分析，我们识别出三个限制开源模型在复杂任务中能力的关键缺陷。第一，在架构上，对标准注意力 (Vaswani et al., 2017) 机制的主要依赖严重限制了长序列的效率。这种低效率对可扩展部署和有效的后训练都构成了重大障碍。第二，在资源分配方面，开源模型在后训练阶段的计算投入不足，限制了它们在困难任务上的性能。最后，在 AI 智能体的语境下，开源模型相比其专有对手在泛化能力和指令遵循能力方面表现出明显滞后 (EvalSys, 2025; Li et al., 2025; Luo et al., 2025)，阻碍了它们在真实部署中的有效性。

> 译者注: 三大缺陷的归纳非常精准。第一个缺陷(标准注意力的效率瓶颈)是工程层面的——Transformer 的自注意力复杂度为 O(n^2)，当序列长度达到 128K 时，计算量和显存占用呈二次方增长。第二个缺陷(后训练计算投入不足)是资源层面的——DeepSeek 在本文中明确提到他们的 RL 计算预算"已超过预训练成本的 10%"，而大多数开源模型的 RL 预算可能不到预训练的 1%。第三个缺陷(agent 泛化差)是应用层面的——开源模型在工具使用、多轮交互等场景中的表现远不如闭源模型。

To address these critical limitations, we first introduce DSA, a highly efficient attention mechanism designed to substantially reduce computational complexity. This architecture effectively addresses the efficiency bottleneck, preserving model performance even in longcontext scenarios. Second, we develop a stable and scalable RL protocol that allows for significant computational expansion during the post-training phase. Notably, this framework allocates a post-training computational budget exceeding 10% of the pre-training cost, unlocking advanced capabilities. Thirdly, we propose a novel pipeline to foster generalizable reasoning in tool-use scenarios. First, we implement a cold-start phase utilizing the DeepSeek-V3 (DeepSeek-AI, 2024) methodology to unify reasoning and tool-use within single trajectories. Subsequently, we advance to large-scale agentic task synthesis, where we generate over 1,800 distinct environments and 85,000 complex prompts. This extensive synthesized data drives the RL process, significantly enhancing the model's generalization and instruction-following capability in the agent context.

为解决这些关键局限，我们首先引入了 DSA，一种旨在大幅降低计算复杂度的高效注意力机制。这一架构有效解决了效率瓶颈，即使在长上下文场景下也能保持模型性能。其次，我们开发了一个稳定且可扩展的 RL 协议，允许在后训练阶段进行大规模的计算扩展。值得注意的是，该框架分配的后训练计算预算超过预训练成本的 10%，解锁了高级能力。第三，我们提出了一个新颖的流水线，以促进工具使用场景中的可泛化推理。首先，我们利用 DeepSeek-V3 (DeepSeek-AI, 2024) 的方法论实现了一个冷启动阶段，在单一轨迹中统一推理和工具使用。随后，我们推进到大规模智能体任务合成，生成了超过 1,800 个不同环境和 85,000 个复杂提示。这些大量的合成数据驱动了 RL 过程，显著增强了模型在智能体语境下的泛化能力和指令遵循能力。

> 译者注: "后训练计算预算超过预训练成本的 10%"是一个非常重要的数字。在传统 LLM 训练范式中，预训练(在数万亿 token 上训练基座模型)通常占总计算成本的 90% 以上，SFT 和 RL 只占很小一部分。DeepSeek 在这里打破了这个惯例，将 RL 阶段的计算投入提升到与预训练相当的数量级。这背后的逻辑是：预训练赋予模型"知识"，而 RL 赋予模型"能力"——如何有效地运用知识来解决问题。对于推理任务而言，后者的边际收益可能已经超过前者。

DeepSeek-V3.2 achieves similar performance with Kimi-k2-thinking and GPT-5 across multiple reasoning benchmarks. Furthermore, DeepSeek-V3.2 significantly advances the agentic capabilities of open models, demonstrating exceptional proficiency on the long-tail agent tasks introduced in EvalSys (2025); Li et al. (2025); Luo et al. (2025). DeepSeek-V3.2 emerges as a highly cost-efficient alternative in agent scenarios, significantly narrowing the performance gap between open and frontier proprietary models while incurring substantially lower costs. Notably, with the aim of pushing the boundaries of open models in the reasoning domain, we relaxed the length constraints to develop DeepSeek-V3.2-Speciale. As a result, DeepSeek-V3.2-Speciale achieves performance parity with the leading closed-source system, Gemini-3.0-Pro (DeepMind, 2025b). It shows gold-medal performance in the IOI 2025, ICPC World Final 2025, IMO 2025, and CMO 2025.

DeepSeek-V3.2 在多个推理基准上与 Kimi-k2-thinking 和 GPT-5 取得了相似的性能。此外，DeepSeek-V3.2 显著推进了开源模型的智能体能力，在 EvalSys (2025); Li et al. (2025); Luo et al. (2025) 引入的长尾智能体任务上展现出卓越的能力。DeepSeek-V3.2 在智能体场景中成为一个极具成本效益的替代方案，在大幅缩小开源与前沿专有模型之间性能差距的同时，成本显著更低。值得注意的是，为了推动开源模型在推理领域的边界，我们放宽了长度约束，开发了 DeepSeek-V3.2-Speciale。因此，DeepSeek-V3.2-Speciale 达到了与领先闭源系统 Gemini-3.0-Pro (DeepMind, 2025b) 相当的性能。它在 IOI 2025、ICPC World Final 2025、IMO 2025 和 CMO 2025 中均展现了金牌级表现。

> 译者注: DeepSeek-V3.2-Speciale 的竞赛成绩非常引人注目：IMO 2025 金牌、IOI 2025 金牌、ICPC WF 2025 金牌。但需要注意两个关键点：1) 这些是"不受时间严格限制"的评测——模型可以生成数万 token 的推理链，而真实竞赛中人类选手只有几小时; 2) Speciale 变体放宽了长度约束，意味着它使用了更多的推理 token(见 Table 3，Speciale 在 CodeForces 上使用 77k token vs V3.2 的 42k)。官方发布的 V3.2 则通过长度约束奖励模型在性能和效率之间做了权衡。

## 2. DeepSeek-V3.2 Architecture

## 2. DeepSeek-V3.2 架构

### 2.1. DeepSeek Sparse Attention

### 2.1. DeepSeek 稀疏注意力

DeepSeek-V3.2 uses exactly the same architecture as DeepSeek-V3.2-Exp. Compared with DeepSeek-V3.1-Terminus, the last version of DeepSeek-V3.1, the only architectural modification of DeepSeek-V3.2 is the introduction of DeepSeek Sparse Attention (DSA) through continued training.

DeepSeek-V3.2 使用的架构与 DeepSeek-V3.2-Exp 完全相同。与 DeepSeek-V3.1 的最后一个版本 DeepSeek-V3.1-Terminus 相比，DeepSeek-V3.2 唯一的架构修改是通过继续训练引入了 DeepSeek Sparse Attention (DSA)。

> 译者注: "唯一的架构修改是 DSA"——这说明 V3.2 在模型结构上与 V3.1-Terminus 几乎相同(都是基于 MLA 的 MoE 架构)，差异仅在于注意力机制从稠密变为稀疏。这种"最小改动、最大收益"的设计哲学在 DeepSeek 系列中一脉相承：V2 引入 MLA，V3 引入 MTP + 更优的 MoE 路由，V3.2 引入 DSA。每一次迭代都是在前代基础上做精准的外科手术式改进，而不是推倒重来。

Prototype of DSA. The prototype of DSA primarily consists of two components: a lightning indexer and a fine-grained token selection mechanism.

DSA 的原型。DSA 的原型主要由两个组件构成：一个闪电索引器 (lightning indexer) 和一个细粒度 token 选择机制。

The lightning indexer computes the index score $I_{t,s}$ between the query token $\mathbf{h}_t \in \mathbb{R}^d$ and a preceding token $\mathbf{h}_s \in \mathbb{R}^d$, determining which tokens to be selected by the query token:

闪电索引器计算查询 token $\mathbf{h}_t \in \mathbb{R}^d$ 与前序 token $\mathbf{h}_s \in \mathbb{R}^d$ 之间的索引分数 $I_{t,s}$，决定查询 token 应该选择哪些 token：

$$
I_{t,s} = \sum_{j=1}^{H^I} w_{t,j}^I \cdot \mathrm{ReLU}\left( \mathbf{q}_{t,j}^I \cdot \mathbf{k}_s^I \right), \tag{1}
$$

where $H^I$ denotes the number of indexer heads; $\mathbf{q}_{t,j}^I \in \mathbb{R}^{d^I}$ and $w_{t,j}^I \in \mathbb{R}$ are derived from the query token $\mathbf{h}_t$; and $\mathbf{k}_s^I \in \mathbb{R}^{d^I}$ is derived from the preceding token $\mathbf{h}_s$. We choose ReLU as the activation function for throughput consideration. Given that the lightning indexer has a small number of heads and can be implemented in FP8, its computational efficiency is remarkable.

其中 $H^I$ 表示索引器头的数量; $\mathbf{q}_{t,j}^I \in \mathbb{R}^{d^I}$ 和 $w_{t,j}^I \in \mathbb{R}$ 从查询 token $\mathbf{h}_t$ 推导而来; $\mathbf{k}_s^I \in \mathbb{R}^{d^I}$ 从前序 token $\mathbf{h}_s$ 推导而来。我们选择 ReLU 作为激活函数是出于吞吐量考虑。鉴于闪电索引器具有少量的头并且可以用 FP8 实现，其计算效率非常显著。

> 译者注: DSA 的核心思想非常直观：不计算查询与所有前序 token 的注意力，而是先用一个轻量级的"索引器"快速筛选出最重要的 k 个 token，然后只对这些 token 做标准注意力。式 (1) 中的索引器本质上是一个简化版的多头注意力：$\mathbf{q}$ 和 $\mathbf{k}$ 的维度 $d^I$ 远小于主注意力的维度，头数 $H^I$ 也少得多。ReLU 的选择很有意思——相比 softmax，ReLU 的计算更简单(无需指数和归一化)，且天然产生稀疏输出(负值被截断为 0)，这与"稀疏注意力"的目标一致。

Given the index scores $\{I_{t,s}\}$ for each query token $\mathbf{h}_t$, our fine-grained token selection mechanism retrieves only the key-value entries $\{\mathbf{c}_s\}$ corresponding to the top-k index scores. Then, the attention output $\mathbf{u}_t$ is computed by applying the attention mechanism between the query token $\mathbf{h}_t$ and the sparsely selected key-value entries $\{\mathbf{c}_s\}$:

给定每个查询 token $\mathbf{h}_t$ 的索引分数 $\{I_{t,s}\}$，我们的细粒度 token 选择机制只检索对应于 top-k 索引分数的键值条目 $\{\mathbf{c}_s\}$。然后，注意力输出 $\mathbf{u}_t$ 通过在查询 token $\mathbf{h}_t$ 与稀疏选择的键值条目 $\{\mathbf{c}_s\}$ 之间应用注意力机制来计算：

$$
\mathbf{u}_t = \mathrm{Attn}\big( \mathbf{h}_t, \big\{ \mathbf{c}_s \big| I_{t,s} \in \mathrm{Top\text{-}k}\big(I_{t,:}\big) \big\} \big). \tag{2}
$$

> 译者注: 式 (2) 是 DSA 的核心：注意力只在 top-k 个 token 上计算，而非整个序列。复杂度从 $O(L^2)$ 降到 $O(L \cdot k)$，其中 $k \ll L$。但这里有一个工程细节需要注意：top-k 选择是不可微的，如何在训练中优化索引器？论文在 2.1.1 节回答了这个问题——通过 KL 散度损失将索引器的输出分布与主注意力的分布对齐。

Instantiate DSA Under MLA. For the consideration of continued training from DeepSeek-V3.1-Terminus, we instantiate DSA based on MLA (DeepSeek-AI, 2024) for DeepSeek-V3.2. At the kernel level, each key-value entry must be shared across multiple queries for computational efficiency (Yuan et al., 2025). Therefore, we implement DSA based on the MQA (Shazeer, 2019) mode of $\mathrm{MLA}^1$, where each latent vector (the key-value entry of MLA) will be shared across all query heads of the query token. The DSA architecture based on MLA is illustrated in Figure 2. We also provide an open-source implementation of DeepSeek-V3.2$^2$ to specify the details unambiguously.

在 MLA 下实例化 DSA。考虑到从 DeepSeek-V3.1-Terminus 继续训练，我们为 DeepSeek-V3.2 基于 MLA (DeepSeek-AI, 2024) 实例化 DSA。在 kernel 层面，每个键值条目必须在多个查询之间共享以确保计算效率 (Yuan et al., 2025)。因此，我们基于 MLA 的 MQA (Shazeer, 2019) 模式实现 DSA，其中每个潜在向量(MLA 的键值条目)将在查询 token 的所有查询头之间共享。基于 MLA 的 DSA 架构如图 2 所示。我们还提供了 DeepSeek-V3.2 的开源实现以明确指定细节。

> 译者注: "在 MLA 下实例化 DSA"是一个关键工程决策。MLA 本身已经将 KV 压缩到低秩潜在空间，DSA 的稀疏选择直接在 MLA 的潜在向量上进行，而不是在原始的完整 KV 上。这意味着稀疏选择的计算开销极小。选择 MQA 模式(而非 MHA 模式)是因为在解码阶段，MQA 让所有查询头共享同一组 KV，这与 DSA 的"共享键值条目"需求天然匹配。从谱系上看，DSA 与同期的 NSA (Native Sparse Attention, Yuan et al., 2025) 有相似之处，但 DSA 更强调与 MLA 的深度集成和 FP8 实现。

#### 2.1.1. Continued Pre-Training

#### 2.1.1. 继续预训练

Starting from a base checkpoint of DeepSeek-V3.1-Terminus, whose context length has been extended to 128K, we perform continued pre-training followed by post-training to create DeepSeek-V3.2.

从上下文长度已扩展至 128K 的 DeepSeek-V3.1-Terminus 基座检查点开始，我们执行继续预训练，随后进行后训练，以创建 DeepSeek-V3.2。

The continued pre-training of DeepSeek-V3.2 consists of two training stages. For both stages, the distribution of training data is totally aligned with the 128K long context extension data used for DeepSeek-V3.1-Terminus.

DeepSeek-V3.2 的继续预训练包含两个训练阶段。两个阶段的数据分布与 DeepSeek-V3.1-Terminus 使用的 128K 长上下文扩展数据完全一致。

![](images/fig02_dsa_architecture.jpg)  
Figure 2 | Attention architecture of DeepSeek-V3.2, where DSA is instantiated under MLA. The green part illustrates how DSA selects the top-k key-value entries according to the indexer.

> 图 2: DeepSeek-V3.2 的注意力架构，其中 DSA 在 MLA 下实例化。绿色部分展示了 DSA 如何根据索引器选择 top-k 键值条目。

Dense Warm-up Stage. We first use a short warm-up stage to initialize the lightning indexer. In this stage, we keep dense attention and freeze all model parameters except for the lightning indexer. To align the indexer outputs with the main attention distribution, for the $t$-th query token, we first aggregate the main attention scores by summing across all attention heads. This sum is then L1-normalized along the sequence dimension to produce a target distribution $p_{t,:} \in \mathbb{R}^t$. Based on $p_{t,:}$, we set a KL-divergence loss as the training objective of the indexer:

稠密热身阶段。我们首先使用一个短热身阶段来初始化闪电索引器。在这个阶段，我们保持稠密注意力并冻结除闪电索引器外的所有模型参数。为了将索引器输出与主注意力分布对齐，对于第 $t$ 个查询 token，我们首先通过对所有注意力头求和来聚合主注意力分数。然后沿序列维度进行 L1 归一化，产生目标分布 $p_{t,:} \in \mathbb{R}^t$。基于 $p_{t,:}$，我们将 KL 散度损失设为索引器的训练目标：

$$
\mathcal{L}^I = \sum_t \mathbb{D}_{\mathrm{KL}}\big( p_{t,:} \big\| \mathrm{Softmax}\big(I_{t,:}\big) \big). \tag{3}
$$

For warm-up, we use a learning rate of $10^{-3}$. We train the indexer for only 1000 steps, with each step consisting of 16 sequences of 128K tokens, resulting in a total of 2.1B tokens.

在热身阶段，我们使用 $10^{-3}$ 的学习率。我们仅训练索引器 1000 步，每步包含 16 个 128K token 的序列，总计 2.1B token。

> 译者注: 稠密热身阶段的设计非常巧妙。新问题：如果直接开始稀疏训练，索引器的初始输出是随机的，top-k 选择会选中无关 token，导致主模型接收到质量极差的注意力输入，训练会崩溃。解决方案：先冻结主模型，只用稠密注意力来"教"索引器——让索引器的输出分布逼近真实注意力分布(通过 KL 散度)。这 2.1B token 的数据量很小(主模型训练用 943.7B)，但足以让索引器学会基本的注意力模式。学习率 $10^{-3}$ 相对较高，因为索引器是从零初始化的，需要快速收敛。

Sparse Training Stage. Following indexer warm-up, we introduce the fine-grained token selection mechanism and optimize all model parameters to adapt the model to the sparse pattern of DSA. In this stage, we also keep aligning the indexer outputs to the main attention distribution, but considering only the selected token set $S_t = \left\{ s \big| I_{t,s} \in \mathrm{Top\text{-}k}\big(I_{t,:}\big) \right\}$:

稀疏训练阶段。索引器热身完成后，我们引入细粒度 token 选择机制并优化所有模型参数，使模型适应 DSA 的稀疏模式。在这个阶段，我们继续将索引器输出与主注意力分布对齐，但仅考虑被选中的 token 集合 $S_t = \left\{ s \big| I_{t,s} \in \mathrm{Top\text{-}k}\big(I_{t,:}\big) \right\}$：

$$
\mathcal{L}^I = \sum_t \mathbb{D}_{\mathrm{KL}}\big( p_{t,S_t} \big\| \mathrm{Softmax}\big(I_{t,S_t}\big) \big). \tag{4}
$$

It is worth noting that we detach the indexer input from the computational graph for separate optimization. The training signal of the indexer is from only $\mathcal{L}^I$, while the optimization of the main model is according to only the language modeling loss. In this sparse training stage, we use a learning rate of $7.3 \times 10^{-6}$, and select 2048 key-value tokens for each query token. We train both the main model and the indexer for 15000 steps, with each step consisting of 480 sequences of 128K tokens, resulting in a total of 943.7B tokens.

值得注意的是，我们将索引器输入从计算图中分离以进行独立优化。索引器的训练信号仅来自 $\mathcal{L}^I$，而主模型的优化仅根据语言建模损失。在这个稀疏训练阶段，我们使用 $7.3 \times 10^{-6}$ 的学习率，为每个查询 token 选择 2048 个键值 token。我们训练主模型和索引器共 15000 步，每步包含 480 个 128K token 的序列，总计 943.7B token。

> 译者注: 稀疏训练阶段有几个关键设计细节：
1. **索引器输入分离**：索引器的梯度不回流到主模型，反之亦然。这避免了两个组件的优化目标冲突——索引器想学"哪些 token 重要"，主模型想学"如何用被选中的 token 做预测"。
2. **2048 个 selected token**：对于 128K 的上下文长度，2048 意味着只关注约 1.6% 的 token。这是一个非常激进的选择，但也意味着巨大的计算节省。
3. **943.7B token 的继续预训练**：这几乎相当于一次小规模的完整预训练(V3 的预训练约为 14.8T token 的 1/15)。如此大的数据量确保了模型能够充分适应稀疏注意力模式。

### 2.2. Parity Evaluation

### 2.2. 性能对等评估

Standard Benchmark In September 2025, we evaluate DeepSeek-V3.2-Exp on a suite of benchmarks, which focus on diverse capabilities, and compare it with DeepSeek-V3.1-Terminus showing similar performance. While DeepSeek V3.2 Exp significantly improves computational efficiency on long sequences, we do not observe substantial performance degradation compared with DeepSeek-V3.1-Terminus, on both short- and long-context tasks.

标准基准 2025 年 9 月，我们在一系列关注多样化能力的基准上评估了 DeepSeek-V3.2-Exp，并与 DeepSeek-V3.1-Terminus 进行比较，显示出相似的性能。尽管 DeepSeek-V3.2-Exp 在长序列上的计算效率显著提升，但我们在短上下文和长上下文任务上均未观察到与 DeepSeek-V3.1-Terminus 相比的实质性性能退化。

> 译者注: "性能对等"(parity) 是稀疏注意力论文中必须回答的核心问题：计算量减少了，质量是否也下降了？DeepSeek 的答案是：没有。这是一个强有力的声明——他们不仅在效率上获胜，在质量上也持平。但需要注意的是，这里的"相似性能"是在标准学术基准上测得的，这些基准的序列长度通常较短(< 8K)。DSA 的真正价值在长上下文(64K+)场景中才能充分体现。

Human Preference Given that direct human preference assessments are inherently susceptible to bias, we employ ChatbotArena as an indirect evaluation framework to approximate user preferences for the newly developed base models. Both DeepSeek-V3.1-Terminus and DeepSeek-V3.2-Exp share an identical post-training strategy, and their Elo scores, obtained from evaluations conducted on 10 November 2025, are closely matched. These results suggest that the new base model achieves performance on par with the previous iteration, despite incorporating a sparse attention mechanism.

人类偏好 鉴于直接的人类偏好评估本质上容易受到偏见影响，我们采用 ChatbotArena 作为间接评估框架来近似用户对新开发基座模型的偏好。DeepSeek-V3.1-Terminus 和 DeepSeek-V3.2-Exp 共享相同的后训练策略，它们在 2025 年 11 月 10 日进行的评估中获得的 Elo 分数非常接近。这些结果表明，尽管引入了稀疏注意力机制，新基座模型仍达到了与前代相当的性能。

Long Context Eval Following the release of DeepSeek-V3.2-Exp, several independent long-context evaluations were conducted using previously unseen test集. A representative benchmark is AA-LCR$^3$, in which DeepSeek-V3.2-Exp scores four points higher than DeepSeek-V3.1-Terminus in reasoning mode. In the Fiction.liveBench evaluation$^4$, DeepSeek-V3.2-Exp consistently outperforms DeepSeek-V3.1-Terminus across multiple metrics. This evidence indicates the base checkpoint of DeepSeek-V3.2-Exp does not regress on long context tasks.

长上下文评估 在 DeepSeek-V3.2-Exp 发布后，多项独立的长上下文评估使用此前未见过的测试集进行。一个代表性基准是 AA-LCR$^3$，其中 DeepSeek-V3.2-Exp 在推理模式下比 DeepSeek-V3.1-Terminus 高出 4 分。在 Fiction.liveBench 评估$^4$中，DeepSeek-V3.2-Exp 在多个指标上一致优于 DeepSeek-V3.1-Terminus。这些证据表明 DeepSeek-V3.2-Exp 的基座检查点在长上下文任务上没有退化。

### 2.3. Inference Costs

### 2.3. 推理成本

DSA reduces the core attention complexity of the main model from $O(L^2)$ to $O(kL)$, where $k$ $(\ll L)$ is the number of selected tokens. Although the lightning indexer still has a complexity of $O(L^2)$, it requires much less computation compared with MLA in DeepSeek-V3.1-Terminus. Combined with our optimized implementation, DSA achieves a significant end-to-end speedup in long-context scenarios. Figure 3 presents how token costs of DeepSeek-V3.1-Terminus and DeepSeek-V3.2 vary with the token position in the sequence. These costs are estimated from benchmarking the actual service deployed on H800 GPUs, at a rental price of 2 USD per GPU hour. Note that for short-sequence prefilling, we specially implement a masked MHA mode to simulate DSA, which can achieve higher efficiency under short-context conditions.

DSA 将主模型的核心注意力复杂度从 $O(L^2)$ 降低到 $O(kL)$，其中 $k$ $(\ll L)$ 是被选中的 token 数量。尽管闪电索引器仍具有 $O(L^2)$ 的复杂度，但与 DeepSeek-V3.1-Terminus 中的 MLA 相比，它需要的计算量要少得多。结合我们的优化实现，DSA 在长上下文场景中实现了显著的端到端加速。图 3 展示了 DeepSeek-V3.1-Terminus 和 DeepSeek-V3.2 的 token 成本如何随序列中的 token 位置变化。这些成本是根据部署在 H800 GPU 上的实际服务进行基准测试估算的，GPU 租用价格为每小时 2 美元。注意，对于短序列预填充，我们特别实现了一个 masked MHA 模式来模拟 DSA，这可以在短上下文条件下实现更高的效率。

> 译者注: 推理成本的量化非常具体——H800 GPU、每小时 2 美元。DSA 的端到端收益来自两个方面：1) 主注意力从 $O(L^2)$ 降到 $O(kL)$; 2) 索引器虽然也是 $O(L^2)$，但它的维度小、头数少、可用 FP8，实际计算量远小于主 MLA。短序列时使用 masked MHA 模拟 DSA 的细节值得关注：这说明 DSA 在短序列(< 8K)时可能并不划算，因为 top-k 选择的开销可能超过稀疏计算节省的收益。DeepSeek 选择在短序列时回退到稠密模式，这是务实的工程权衡。

![](images/fig03a_prefilling_cost.jpg)  
(a) Prefilling

![](images/fig03b_decoding_cost.jpg)  
(b) Decoding  
Figure 3 | Inference costs of DeepSeek-V3.1-Terminus and DeepSeek-V3.2 on H800 clusters.

> 图 3: DeepSeek-V3.1-Terminus 和 DeepSeek-V3.2 在 H800 集群上的推理成本。

## 3. Post-Training

## 3. 后训练

After continued pre-training, we perform post-training to create the final DeepSeek-V3.2. The post-training of DeepSeek-V3.2 also employs sparse attention in the same way as the sparse continued pre-training stage. For DeepSeek-V3.2, we maintain the same post-training pipeline as in DeepSeek-V3.2-Exp, which includes specialist distillation and mixed RL training.

继续预训练之后，我们进行后训练以创建最终的 DeepSeek-V3.2。DeepSeek-V3.2 的后训练也以与稀疏继续预训练阶段相同的方式使用稀疏注意力。对于 DeepSeek-V3.2，我们保持与 DeepSeek-V3.2-Exp 相同的后训练流水线，包括专家蒸馏和混合 RL 训练。

Specialist Distillation For each task, we initially develop a specialized model dedicated exclusively to that particular domain, with all specialist models being fine-tuned from the same pre-trained DeepSeek-V3.2 base checkpoint. In addition to writing tasks and general questionanswering, our framework encompasses six specialized domains: mathematics, programming, general logical reasoning, general agentic tasks, agentic coding, and agentic search, with all the domains supporting both thinking and non-thinking modes. Each specialist is trained with largescale Reinforcement Learning (RL) computing. Furthermore, we employ different models to generate training data for long chain-of-thought reasoning (thinking mode) and direct response generation (non-thinking mode). Once the specialist models are prepared, they are used to produce the domain-specific data for the final checkpoint. Experimental results demonstrate that models trained on the distilled data achieve performance levels only marginally below those of domain-specific specialists, with the performance gap being effectively eliminated through subsequent RL training.

专家蒸馏 对于每个任务，我们首先开发一个专门致力于该特定领域的专家模型，所有专家模型都从同一个预训练的 DeepSeek-V3.2 基座检查点进行微调。除了写作任务和通用问答外，我们的框架涵盖六个专业领域：数学、编程、通用逻辑推理、通用智能体任务、智能体编码和智能体搜索，所有领域都支持 thinking 和 non-thinking 模式。每个专家都使用大规模强化学习 (RL) 计算进行训练。此外，我们使用不同的模型为长思维链推理(thinking 模式)和直接回复生成(non-thinking 模式)生成训练数据。专家模型准备就绪后，它们被用于为最终检查点生成领域特定的数据。实验结果表明，在蒸馏数据上训练的模型达到的性能仅略低于领域特定专家，而这一性能差距通过后续的 RL 训练被有效消除。

> 译者注: 专家蒸馏是 DeepSeek-V3.2 后训练的第一个阶段，其策略类似于"分而治之"：先训练多个领域专家(每个专家只专注于一个领域)，然后用这些专家生成高质量数据来训练一个通用模型。这种方法的优势在于：领域专家可以在各自领域达到极高的性能(因为不需要考虑跨领域的折中)，而通用模型通过蒸馏继承了这些专业能力。六个专业领域覆盖了推理模型最核心的应用场景。thinking 和 non-thinking 双模式的设置也很重要——non-thinking 模式用于低延迟场景，thinking 模式用于复杂推理。

Mixed RL Training For DeepSeek-V3.2, we still adopt Group Relative Policy Optimization (GRPO) (DeepSeek-AI, 2025; Shao et al., 2024) as the RL training algorithm. As DeepSeek-V3.2-Exp, we merge reasoning, agent, and human alignment training into one RL stage. This approach effectively balances performance across diverse domains while circumventing the catastrophic forgetting issues commonly associated with multi-stage训练 paradigms. For reasoning and agent tasks, we employ rule-based outcome reward, length penalty, and language consistency reward. For general tasks, we employ a generative reward model where each prompt has its own rubrics for evaluation.

混合 RL 训练 对于 DeepSeek-V3.2，我们仍然采用 Group Relative Policy Optimization (GRPO) (DeepSeek-AI, 2025; Shao et al., 2024) 作为 RL 训练算法。与 DeepSeek-V3.2-Exp 一样，我们将推理、智能体和人类对齐训练合并为一个 RL 阶段。这种方法有效平衡了跨多样化领域的性能，同时规避了多阶段训练范式中常见的灾难性遗忘问题。对于推理和智能体任务，我们使用基于规则的结果奖励、长度惩罚和语言一致性奖励。对于通用任务，我们使用生成式奖励模型，其中每个提示都有自己的评估标准。

> 译者注: "合并为一个 RL 阶段"是一个重要设计。传统的多阶段训练(如先 RL 推理、再 RL agent、再 RL 对齐)容易导致灾难性遗忘——模型在学新任务时忘记了旧任务。DeepSeek 的解决方案是将所有任务的奖励信号混合在同一个 RL 阶段中。这要求奖励设计非常精细：推理任务用结果正确性奖励，agent 任务用工具执行成功奖励，通用任务用生成式奖励模型(类似 GPT-4 作为裁判)。三种奖励的权重平衡是关键超参数。

DeepSeek-V3.2 and DeepSeek-V3.2-Speciale DeepSeek-V3.2 integrates reasoning, agent, and human alignment data distilled from specialists, undergoing thousands of steps of continued RL training to reach the final checkpoints. To investigate the potential of extended thinking, we also developed an experimental variant, DeepSeek-V3.2-Speciale. This model was trained exclusively on reasoning data with a reduced length penalty during RL. Additionally, we incorporated the dataset and reward method from DeepSeekMath-V2 (Shao et al., 2025) to enhance capabilities in mathematical proofs.

DeepSeek-V3.2 和 DeepSeek-V3.2-Speciale DeepSeek-V3.2 整合了从专家蒸馏而来的推理、智能体和人类对齐数据，经过数千步的持续 RL 训练达到最终检查点。为了调查扩展思考的潜力，我们还开发了一个实验变体 DeepSeek-V3.2-Speciale。该模型仅在推理数据上训练，并在 RL 期间减少了长度惩罚。此外，我们引入了 DeepSeekMath-V2 (Shao et al., 2025) 的数据集和奖励方法来增强数学证明能力。

We would like to highlight our efforts in how to create a stable recipe to scale up RL compute in Section 3.1, and how to integrate thinking into agentic tasks in Section 3.2

我们希望在 3.1 节重点介绍如何创建稳定的大规模扩展 RL 计算的方案，以及在 3.2 节介绍如何将思考能力整合到智能体任务中。

### 3.1. Scaling GRPO

### 3.1. 扩展 GRPO

GRPO (Shao et al., 2024) is a powerful RL algorithm for reasoning model training. In GRPO, for each question $q$, a group of $G$ responses are sampled from the current model. A group of reward scores are generated by the rule-based verifier or reward model, and the advantage is calculated by the normalized reward of the responses, without the value model. The optimization objective of GRPO can be formulated as:

GRPO (Shao et al., 2024) 是一种用于推理模型训练的强大 RL 算法。在 GRPO 中，对于每个问题 $q$，从当前模型采样一组 $G$ 个回复。一组奖励分数由基于规则的验证器或奖励模型生成，优势通过回复的归一化奖励计算，无需价值模型。GRPO 的优化目标可以表述为：

$$
J_{\mathrm{GRPO}}(\theta) = \mathbb{E}\left[ q \sim P(Q), \left\{ o_i \right\}_{i=1}^{G} \sim \pi_{\theta_{\text{old}}}(O|q) \right]
\frac{1}{G} \sum_{i=1}^{G} \left( \min \left( \frac{\pi_\theta(o_i|q)}{\pi_{\theta_{\text{old}}}(o_i|q)} A_i, \ \mathrm{clip}\left( \frac{\pi_\theta(o_i|q)}{\pi_{\theta_{\text{old}}}(o_i|q)}, 1-\varepsilon, 1+\varepsilon \right) A_i \right) - \beta \mathbb{D}_{\mathrm{KL}}\left( \pi_\theta \big\| \pi_{\mathrm{ref}} \right) \right), \tag{5}
$$

where $A_i = \frac{r_i - \text{mean}(r)}{\text{std}(r)}$ is the advantage of the $i$-th response, which is calculated by the normalized reward score.

其中 $A_i = \frac{r_i - \text{mean}(r)}{\text{std}(r)}$ 是第 $i$ 个回复的优势，通过归一化奖励分数计算。

> 译者注: GRPO 的核心思想是"组内相对优势"——不训练单独的价值模型，而是在同一问题的多个采样回复之间做相对比较。$A_i$ 的计算非常简单：将一组回复的奖励归一化(减去均值除以标准差)。这种方法避免了 PPO 中价值模型估计不准的问题，同时大幅降低了训练开销(不需要额外的价值网络)。式 (5) 中的 min-clip 形式与 PPO 的 clipped surrogate objective 相同，确保策略更新不会过大。KL 散度惩罚项防止策略偏离参考模型太远。

In addition to the reasoning ability, we aim to enhance the models' agentic and general capabilities through RL. For reasoning tasks, the reward is typically a scalar representing the accuracy of the final answer. For tool-use tasks, the reward score is a weighted sum of each tool call's effectiveness and the final answer's correctness. For general tasks, we generate scalar rewards with a reward model. We merge reasoning, agent, and general tasks into one single RL training stage and uniformly use GRPO as the training objective.

除了推理能力，我们还旨在通过 RL 增强模型的智能体和通用能力。对于推理任务，奖励通常是一个表示最终答案准确性的标量。对于工具使用任务，奖励分数是每个工具调用有效性和最终答案正确性的加权和。对于通用任务，我们用奖励模型生成标量奖励。我们将推理、智能体和通用任务合并到一个单一的 RL 训练阶段，统一使用 GRPO 作为训练目标。

When scaling the RL compute to thousands of GPU steps, we observe the training is rather unstable without carefully designing the training recipe. Thus, we propose several practical strategies to improve the training stability of GRPO.

当将 RL 计算扩展到数千 GPU 步时，我们观察到如果不仔细设计训练方案，训练会相当不稳定。因此，我们提出了几种实用策略来提高 GRPO 的训练稳定性。

> 译者注: "数千 GPU 步"意味着巨大的计算投入。以 DeepSeek 的集群规模(数千张 GPU)，数千步 RL 训练可能消耗数十万 GPU 小时。在这样大的规模下，训练不稳定性会被放大——微小的梯度爆炸或策略崩溃可能导致数万美元的计算浪费。下面介绍的四种稳定策略(无偏 KL 估计、离线序列掩码、Keep Routing、Keep Sampling Mask)是本文最具工程价值的技术贡献之一。

#### Unbiased KL Estimate

#### 无偏 KL 估计

As the training progresses, the old policy $\pi_{\theta_{\text{old}}}$ will deviate from the reference policy $\pi_{\mathrm{ref}}$. For off-policy RL algorithms, the old policy must remain close to the reference policy to calculate an accurate KL divergence. The standard estimation method, defined as $\mathbb{D}_{\mathrm{KL}}(\pi_\theta \| \pi_{\mathrm{ref}}) = \log \frac{\pi_\theta(o_i|q)}{\pi_{\mathrm{ref}}(o_i|q)}$, is susceptible to high variance, particularly when the policy $\pi_\theta$ is far from $\pi_{\mathrm{ref}}$. Inspired by Schulman et al. (2020), we employ an unbiased estimator to reduce the variance:

随着训练进行，旧策略 $\pi_{\theta_{\text{old}}}$ 会偏离参考策略 $\pi_{\mathrm{ref}}$。对于离线 RL 算法，旧策略必须保持接近参考策略以计算准确的 KL 散度。标准估计方法定义为 $\mathbb{D}_{\mathrm{KL}}(\pi_\theta \| \pi_{\mathrm{ref}}) = \log \frac{\pi_\theta(o_i|q)}{\pi_{\mathrm{ref}}(o_i|q)}$，容易受到高方差的影响，特别是当策略 $\pi_\theta$ 远离 $\pi_{\mathrm{ref}}$ 时。受 Schulman et al. (2020) 启发，我们采用一个无偏估计器来降低方差：

$$
\mathbb{D}_{\mathrm{KL}}\left( \pi_\theta \big\| \pi_{\mathrm{ref}} \right) = \frac{\pi_{\mathrm{ref}}(o_i|q)}{\pi_\theta(o_i|q)} - \log \frac{\pi_{\mathrm{ref}}(o_i|q)}{\pi_\theta(o_i|q)} - 1. \tag{7}
$$

The proof of the unbiasedness is provided in Appendix A.

无偏性的证明见附录 A。

> 译者注: 标准的 KL 估计 $\log(\pi_\theta / \pi_{\mathrm{ref}})$ 在 $\pi_\theta$ 和 $\pi_{\mathrm{ref}}$ 差异较大时方差很大。式 (7) 的估计器来自 Schulman et al. (2020) 的"k3"估计器，其方差更低。直观理解：当 $\pi_\theta \approx \pi_{\mathrm{ref}}$ 时，$\pi_{\mathrm{ref}}/\pi_\theta \approx 1$，利用泰勒展开 $\frac{1}{x} - \log\frac{1}{x} - 1 \approx \frac{1}{2}(x-1)^2$，这与 KL 的二阶近似一致。这个细节在大规模 RL 中至关重要——每一步的梯度噪声累积起来，低方差估计器意味着更稳定的训练。

#### Off-Policy Sequence Masking

#### 离线策略序列掩码

GRPO is an off-policy RL algorithm. To reduce the variance, we clip the ratio $\frac{\pi_\theta}{\pi_{\theta_{\text{old}}}}$ to the range $[1-\varepsilon, 1+\varepsilon]$. However, this ratio may still be prone to instability. For instance, when the ratio is close to or exceeds the upper bound $1 + \varepsilon$, the gradient of the clipped surrogate objective will vanish. This indicates that when the model is updated too much, we will lose part of the gradient from the corresponding responses. To mitigate this, we maintain a buffer of recently sampled sequences and filter out those whose ratios fall outside $[1 - \varepsilon, 1 + \varepsilon]$, thus retaining a stable set of sequences for each training step.

GRPO 是一种离线策略 RL 算法。为了降低方差，我们将比率 $\frac{\pi_\theta}{\pi_{\theta_{\text{old}}}}$ 裁剪到 $[1-\varepsilon, 1+\varepsilon]$ 范围。然而，这个比率仍然可能不稳定。例如，当比率接近或超过上界 $1 + \varepsilon$ 时，裁剪后的替代目标的梯度将消失。这表明当模型更新过多时，我们会丢失对应回复的部分梯度。为了缓解这个问题，我们维护一个最近采样序列的缓冲区，并过滤掉比率落在 $[1 - \varepsilon, 1 + \varepsilon]$ 之外的序列，从而为每个训练步骤保留一组稳定的序列。

> 译者注: 这是 GRPO 训练中一个微妙的工程问题。PPO/GRPO 的 clip 机制设计初衷是防止策略更新过大，但当比率频繁触及 clip 边界时，对应的样本对梯度没有任何贡献(梯度为 0)，这实际上造成了有效训练数据的浪费。DeepSeek 的解决方案是动态过滤：在缓冲区中只保留比率在"安全范围"内的序列。这相当于一种在线的数据清洗，确保每一步训练都有足够的高质量梯度信号。

#### Keep Routing

#### 保持路由

DeepSeek-V3.2 utilizes an MoE (Mixture-of-Experts) architecture. During training, the routing weights are computed based on the features extracted by the current model. However, the features from the old model may differ from those of the current model. If the routing weights are computed from the current model while the sequence was sampled from the old model, the training may be unstable. To mitigate this issue, we keep the routing weights from the old model during the forward pass. This approach effectively decouples the routing and feature computation, significantly improving training stability.

DeepSeek-V3.2 使用 MoE (Mixture-of-Experts) 架构。在训练期间，路由权重基于当前模型提取的特征计算。然而，旧模型的特征可能与当前模型的特征不同。如果路由权重从当前模型计算而序列从旧模型采样，训练可能不稳定。为了缓解这个问题，我们在前向传播期间保持旧模型的路由权重。这种方法有效地解耦了路由和特征计算，显著提高了训练稳定性。

> 译者注: Keep Routing 是 MoE 架构下特有的稳定策略。MoE 的路由网络(决定每个 token 分配给哪些专家)是一个轻量级网络，但它的输出对训练稳定性非常敏感。如果路由权重基于当前模型的特征计算，而输入 token 的分布来自旧模型(因为 GRPO 是 off-policy)，路由决策可能完全错误(将 token 分配给不相关的专家)，导致梯度噪声剧增。"保持旧模型的路由权重"意味着：用旧模型决定 token 去哪个专家，但用当前模型计算专家的输出。这类似于 DSA 中索引器输入的分离——都是"解耦"思想的应用。

#### Keep Sampling Mask

#### 保持采样掩码

In sparse attention, the selection of key-value tokens is determined by the indexer. Similar to the routing issue in MoE, the indexer outputs may differ between the old and current models. To ensure training stability, we keep the sampling mask from the old model during the forward pass. Specifically, for each query token, we use the top-k tokens selected by the old model's indexer, rather than recomputing the selection with the current model.

在稀疏注意力中，键值 token 的选择由索引器决定。类似于 MoE 中的路由问题，索引器输出在旧模型和当前模型之间可能不同。为了确保训练稳定性，我们在前向传播期间保持旧模型的采样掩码。具体来说，对于每个查询 token，我们使用旧模型索引器选择的 top-k token，而不是用当前模型重新计算选择。

> 译者注: Keep Sampling Mask 是 Keep Routing 在 DSA 上的自然延伸。DSA 的索引器本质上是一个"路由网络"——它决定每个查询 token 应该"关注"哪些 token。如果索引器输出随模型更新而剧烈变化，注意力输入的分布也会剧烈变化，导致训练不稳定。保持旧模型的采样掩码确保了注意力输入分布的稳定性。值得注意的是，DeepSeek 在 DSA 训练中已经分离了索引器输入(2.1.1 节)，但这里更进一步：不仅索引器输入分离，连 top-k 选择的结果也固定为旧模型的输出。

In the ablation study (see Table 6 in Appendix B), we demonstrate that these strategies are critical for the stability of training at scale. Without them, the training tends to collapse at a certain point, making it impossible to scale to thousands of steps.

在消融研究(见附录 B 的表 6)中，我们证明这些策略对于大规模训练的稳定性至关重要。没有它们，训练往往会在某个点崩溃，无法扩展到数千步。

### 3.2. Thinking in Tool-Use

### 3.2. 工具使用中的思考

We integrate reasoning into the tool-use scenarios, forming the thinking-in-tool-use paradigm. When presented with a user query, the model processes the query by combining reasoning and tool execution in a cohesive reasoning chain. We develop several key mechanisms to support this paradigm, including thinking context management, cold-start training, and large-scale agentic task synthesis.

我们将推理整合到工具使用场景中，形成了"工具使用中的思考"范式。当面对用户查询时，模型通过在一个连贯的推理链中结合推理和工具执行来处理查询。我们开发了几种关键机制来支持这一范式，包括思考上下文管理、冷启动训练和大规模智能体任务合成。

#### 3.2.1. Thinking Context Management

#### 3.2.1. 思考上下文管理

Tool-use tasks typically involve multi-step interactions, where each step comprises a thinking phase followed by an action phase. In a naive implementation, only the immediate output of a tool is appended to the context. Consequently, the reasoning steps from previous steps are discarded, resulting in the model losing its historical reasoning context for subsequent steps.

工具使用任务通常涉及多步交互，每一步包含一个思考阶段后接一个行动阶段。在朴素实现中，只有工具的即时输出被追加到上下文中。因此，前面步骤的推理步骤被丢弃，导致模型在后续步骤中丢失其历史推理上下文。

To preserve the model's historical reasoning context, we implement a context management mechanism that retains all reasoning trajectories across the multi-step interaction. Specifically, for each step in the interaction, the reasoning output and tool result are both appended to the context for the next step. This ensures that the model maintains access to its complete reasoning history throughout the entire trajectory.

为了保留模型的历史推理上下文，我们实现了一种上下文管理机制，在多次交互中保留所有推理轨迹。具体来说，对于交互中的每一步，推理输出和工具结果都被追加到下一步的上下文中。这确保了模型在整个轨迹中始终可以访问其完整的推理历史。

> 译者注: 这是一个看似简单但至关重要的设计。许多 agent 框架(如 ReAct)在每一步只保留"观察"(工具输出)而丢弃"思考"(推理过程)，导致模型在后续步骤中"忘记"自己为什么做了某个决定。DeepSeek 的解决方案是将思考链完整地保留在上下文中。这增加了上下文长度(因为每一步都追加推理文本)，但换来的是更连贯的多步推理。这与人类解决问题的过程一致：我们不会在每一步都清空大脑，而是带着之前的思路继续前进。

#### 3.2.2. Cold-Start

#### 3.2.2. 冷启动

To bootstrap the training process, we employ the methodology from DeepSeek-V3 (DeepSeek-AI, 2024) as a cold-start mechanism. This approach merges both the model's thinking processes and corresponding tool invocations into single training trajectories, which are then used for the initial SFT phase. For each task, we first sample multiple solutions using DeepSeek-V3. Subsequently, we select the longest successful trajectory and filter out those with excessive repetition, ensuring the acquisition of high-quality initial training data.

为了引导训练过程，我们采用 DeepSeek-V3 (DeepSeek-AI, 2024) 的方法论作为冷启动机制。这种方法将模型的思考过程和相应的工具调用合并到单一的训练轨迹中，然后用于初始的 SFT 阶段。对于每个任务，我们首先使用 DeepSeek-V3 采样多个解决方案。随后，我们选择最长的成功轨迹并过滤掉重复过多的轨迹，确保获得高质量的初始训练数据。

> 译者注: "选择最长的成功轨迹"是一个有趣的启发式策略。直觉是：更长的轨迹通常包含更详细的推理过程(更多的思考步骤)，这对于教授模型"如何思考"比短轨迹更有价值。过滤"重复过多"的轨迹也很重要——有些模型会陷入无意义的循环(如重复"让我再检查一下")，这些低质量样本需要剔除。冷启动阶段的目标是提供一个"好的起点"，让后续的 RL 有高质量的初始策略可以改进。

#### 3.2.3. Large-Scale Agentic Tasks

#### 3.2.3. 大规模智能体任务

To facilitate scalable agentic RL training, we develop a novel pipeline for synthesizing large-scale agentic tasks. As shown in Table 1, this pipeline generates over 1,800 distinct environments and more than 85,000 complex prompts.

为了促进可扩展的智能体 RL 训练，我们开发了一种新颖的大规模智能体任务合成流水线。如表 1 所示，该流水线生成了超过 1,800 个不同环境和超过 85,000 个复杂提示。

**Search Agent** For search agents, we utilized the entire Wikipedia dump (dated 2025-01-01, totaling 8.1M articles) as the source to generate search tasks, where the queries were designed to be unsolvable without extensive reading. In addition to providing access to the search tool, we also granted the model access to Python to handle numeric computations, ensuring comprehensive coverage of diverse query types. These tasks were generated by GPT-5o and DeepSeek-V3.2. We filtered out tasks that could be answered with less than 15 tools. In total, we generated over 1,400 environments and 50,000 prompts.

**搜索智能体** 对于搜索智能体，我们使用完整的 Wikipedia 转储(日期为 2025-01-01，总计 810 万篇文章)作为来源来生成搜索任务，其中查询被设计为不经过广泛阅读就无法解答。除了提供搜索工具的访问外，我们还授予模型 Python 权限以处理数值计算，确保全面覆盖多样化的查询类型。这些任务由 GPT-5o 和 DeepSeek-V3.2 生成。我们过滤掉了可以用少于 15 个工具回答的任务。总计，我们生成了超过 1,400 个环境和 50,000 个提示。

**Code Agent** For code agents, we constructed a code sandbox supporting over 1,000 libraries. Based on the tool description, we generated a code description and test cases, and then used a code agent to implement the functionality. We leveraged existing coding datasets, such as SWE-bench (Jimenez et al., 2024), to generate tasks. The code agent utilizes both file editing tools and bash tools to write, run, and test code. To ensure the quality of the generated tasks, we implemented a multi-stage filtering process to remove low-quality tasks.

**代码智能体** 对于代码智能体，我们构建了一个支持超过 1,000 个库的代码沙箱。基于工具描述，我们生成代码描述和测试用例，然后使用代码智能体实现功能。我们利用现有的代码数据集(如 SWE-bench (Jimenez et al., 2024))来生成任务。代码智能体同时使用文件编辑工具和 bash 工具来编写、运行和测试代码。为了确保生成任务的质量，我们实施了多阶段过滤流程来移除低质量任务。

**Code Interpreter Agent** For code interpreter agents, we employed the NuminaMath dataset (Li et al., 2024) and existing question-answering datasets, such as TriviaQA (Joshi et al., 2017) and Natural Questions (Kwiatkowski et al., 2019). We generated code interpreter tasks by prompting the model to use Python code to solve these problems. These tasks are designed to test the model's ability to write and execute Python code to perform calculations, data analysis, and other tasks.

**代码解释器智能体** 对于代码解释器智能体，我们使用了 NuminaMath 数据集 (Li et al., 2024) 和现有的问答数据集，如 TriviaQA (Joshi et al., 2017) 和 Natural Questions (Kwiatkowski et al., 2019)。我们通过提示模型使用 Python 代码解决这些问题来生成代码解释器任务。这些任务旨在测试模型编写和执行 Python 代码进行计算、数据分析等任务的能力。

**General Agent** For general agentic tasks, we utilized the BrowserGym (Shi et al., 2024) framework to simulate web browsing and information retrieval. We generated tasks involving web navigation, form filling, and data extraction. These tasks are designed to test the model's ability to interact with web-based interfaces and perform complex information retrieval tasks. Additionally, we incorporated multi-turn dialog tasks to evaluate the model's ability to maintain context and provide coherent responses across multiple interactions.

**通用智能体** 对于通用智能体任务，我们使用 BrowserGym (Shi et al., 2024) 框架来模拟网页浏览和信息检索。我们生成了涉及网页导航、表单填写和数据提取的任务。这些任务旨在测试模型与基于网页的界面交互并执行复杂信息检索任务的能力。此外，我们纳入了多轮对话任务来评估模型在多次交互中保持上下文和提供连贯回复的能力。

> 译者注: 四种智能体覆盖了 agent 能力的四个核心维度：信息检索(搜索)、代码开发(代码)、数据分析(解释器)、网页交互(通用)。总计 1,827 个环境和 85,000+ 提示的规模非常庞大——作为对比，SWE-bench 只有约 500 个任务，WebArena 只有 812 个任务。DeepSeek 的合成流水线解决了 agent RL 训练中的核心瓶颈：高质量任务数据的稀缺。传统上，agent 任务需要人工标注或真实环境交互，成本高且难以扩展。DeepSeek 的方案是用强模型(GPT-5o 和自身)自动生成任务，然后用多阶段过滤确保质量。

**Trip Planning** As an illustrative example, we present a trip planning task. The agent is tasked with planning a trip from New York to Los Angeles, with specific constraints such as budget, time, and preferences. The agent must use search tools to find flights, hotels, and activities, and then synthesize the information into a coherent itinerary. This task requires the agent to perform multi-step reasoning, tool use, and synthesis, making it a comprehensive test of agentic capabilities.

**行程规划** 作为一个说明性示例，我们展示了一个行程规划任务。智能体的任务是从纽约到洛杉矶规划一次旅行，有预算、时间和偏好等特定约束。智能体必须使用搜索工具查找航班、酒店和活动，然后将信息综合成一份连贯的行程。这个任务要求智能体执行多步推理、工具使用和综合，使其成为智能体能力的全面测试。

## 4. Evaluation

## 4. 评估

### 4.1. Main Results

### 4.1. 主结果

We evaluate models on MMLU-Pro (Wang et al., 2024), GPQA Diamond (Rein et al., 2023), Human Last Exam (HLE) Text-only (Phan et al., 2025), LiveCodeBench (2024.08-2025.04), Codeforces, Aider-Polyglot, AIME 2025, HMMT Feb 2025, HMMT Nov 2025 (Balunovi´c et al., 2025), IMOAnswerBench (Luong et al., 2025), Terminal Bench 2.0, SWE-Verified (OpenAI, 2024b), SWE Multilingual (Yang et al., 2025), BrowseComp (Wei et al., 2025), BrowseCompZh (Zhou et al., 2025), Tau2-bench (Barres et al., 2025), MCP-Universe (Luo et al., 2025), MCP-Mark (EvalSys, 2025), and Tool-Decathlon (Li et al., 2025). Tool-use benchmarks are evaluated using the standard function call format, wherein models are configured to thinking mode. For MCP-Universe (Luo et al., 2025) and MCP-Mark (EvalSys, 2025), we evaluate all models with our internal environment, because the search and playwright environment might be slightly different from the official setting. We set the temperature to 1.0, and the context window to 128K tokens. For math-related tasks such as AIME, HMMT, IMOAnswerBench, and HLE, we eval with the following template: "{question}\nPlease reason step by step, and put your final answer within \\boxed{}.")

我们在 MMLU-Pro (Wang et al., 2024)、GPQA Diamond (Rein et al., 2023)、Human Last Exam (HLE) 纯文本 (Phan et al., 2025)、LiveCodeBench (2024.08-2025.04)、Codeforces、Aider-Polyglot、AIME 2025、HMMT 2025 年 2 月赛、HMMT 2025 年 11 月赛 (Balunovi´c et al., 2025)、IMOAnswerBench (Luong et al., 2025)、Terminal Bench 2.0、SWE-Verified (OpenAI, 2024b)、SWE Multilingual (Yang et al., 2025)、BrowseComp (Wei et al., 2025)、BrowseCompZh (Zhou et al., 2025)、Tau2-bench (Barres et al., 2025)、MCP-Universe (Luo et al., 2025)、MCP-Mark (EvalSys, 2025) 和 Tool-Decathlon (Li et al., 2025) 上评估模型。工具使用基准使用标准函数调用格式评估，其中模型配置为 thinking 模式。对于 MCP-Universe (Luo et al., 2025) 和 MCP-Mark (EvalSys, 2025)，我们使用内部环境评估所有模型，因为搜索和 playwright 环境可能与官方设置略有不同。我们将温度设为 1.0，上下文窗口设为 128K token。对于数学相关任务(如 AIME、HMMT、IMOAnswerBench 和 HLE)，我们使用以下模板评估："{问题}\n请逐步推理，并将最终答案放在 \\boxed{} 中。"

> 译者注: 评估覆盖了 18 个基准，横跨知识理解(MMLU-Pro)、科学推理(GPQA、HLE)、编程(LiveCodeBench、Codeforces)、数学竞赛(AIME、HMMT、IMO)、代码智能体(Terminal Bench、SWE-bench)、搜索智能体(BrowseComp)、工具使用(Tau2-bench、MCP-Universe、MCP-Mark、Tool-Decathlon)。这种广泛的覆盖确保了模型能力的全面评估。值得注意的是，MCP 基准使用"内部环境"——这说明不同论文的 MCP 评测环境可能有差异，结果不一定直接可比。

**Table 2** presents the comprehensive comparison between DeepSeek-V3.2 and closed/open models across English understanding, coding, math, code agent, search agent, and tool-use categories.

**表 2** 展示了 DeepSeek-V3.2 与闭源/开源模型在英语理解、编程、数学、代码智能体、搜索智能体和工具使用等类别上的全面比较。

> 译者注: 表 2 的详细数据见 D3 原文。核心结论：DeepSeek-V3.2 在推理任务上与 GPT-5-High 相当，但略逊于 Gemini-3.0-Pro。在代码智能体任务上(Terminal Bench 2.0 46.4%、SWE-Verified 73.1%)，DeepSeek-V3.2 显著优于开源对手。在搜索智能体 BrowseComp 上，使用上下文管理技术后达到 67.6%，超过 GPT-5-High 的 54.9%。在工具使用基准上，DeepSeek-V3.2 大幅缩小了开源与闭源之间的差距，尽管在 MCP-Mark 和 Tool-Decathlon 上仍低于前沿模型。Tau2-bench 的三个领域(航空 63.8、零售 81.1、电信 96.2)表现出色。

DeepSeek-V3.2 achieves similar performance with GPT-5-high on reasoning tasks, but is slightly worse than Gemini-3.0-Pro. Compared to K2-Thinking, DeepSeek-V3.2 achieves comparable scores with substantially fewer output tokens, as shown in Table 3. These performance gains can be attributed to the increased computational resources allocated to RL training. Over recent months, we have observed consistent performance improvements correlating with extended RL training budget, which already exceeds 10% of the pre-training cost. We hypothesize that reasoning capabilities could be further enhanced with additional computational budget allocation. Notably, the performance of DeepSeek-V3.2 presented herein is constrained by a length constraint reward model; upon removal of the restriction, we observe further improvement in model performance, as detailed in Section 4.2.

DeepSeek-V3.2 在推理任务上与 GPT-5-High 取得相似性能，但略逊于 Gemini-3.0-Pro。与 K2-Thinking 相比，DeepSeek-V3.2 在输出 token 数显著更少的情况下取得了可比的分数，如表 3 所示。这些性能提升可归因于分配给 RL 训练的增加的计算资源。近几个月来，我们观察到性能持续提升与扩展的 RL 训练预算相关，该预算已超过预训练成本的 10%。我们假设推理能力可以通过额外的计算预算分配进一步增强。值得注意的是，本文呈现的 DeepSeek-V3.2 性能受到长度约束奖励模型的限制; 移除该限制后，我们观察到模型性能的进一步提升，详见 4.2 节。

> 译者注: "长度约束奖励模型"是 DeepSeek-V3.2 的一个关键设计。在 RL 训练中，模型会学会生成更长的思考链来提高正确率(因为更多的思考时间通常带来更好的结果)。但过长的输出会增加推理成本和延迟。DeepSeek 在 RL 中加入了长度惩罚，迫使模型在性能和效率之间做权衡。Speciale 变体移除了这个约束，所以性能更高但 token 效率更低。这解释了为什么表 3 中 V3.2-Thinking 的 token 数通常比 Speciale 少(如 AIME 16k vs 23k)。

In code agent evaluations, DeepSeek-V3.2 significantly outperforms open-source LLMs on both SWE-bench Verified and Terminal Bench 2.0, demonstrating its potential within real-world coding workflows. Regarding Terminal Bench 2.0, as previously noted, our context management strategy for the 'thinking mode' is currently incompatible with Terminus; consequently, the reported score of 46.4 was achieved using the Claude Code framework. We also evaluated DeepSeek-V3.2 with Terminus in non-thinking mode, yielding a score of 39.3. For SWE-bench Verified, the primary score was obtained using our internal framework. Robustness tests across other settings—including the Claude Code and RooCode frameworks, as well as non-thinking mode—produced consistent results, ranging from 72 to 74.

在代码智能体评估中，DeepSeek-V3.2 在 SWE-bench Verified 和 Terminal Bench 2.0 上均显著优于开源 LLM，展示了其在真实世界编码工作流中的潜力。关于 Terminal Bench 2.0，如前所述，我们的 thinking 模式上下文管理策略目前与 Terminus 不兼容; 因此，报告的 46.4 分是使用 Claude Code 框架获得的。我们还使用 Terminus 在 non-thinking 模式下评估了 DeepSeek-V3.2，得分为 39.3。对于 SWE-bench Verified，主要分数是使用我们的内部框架获得的。在其他设置(包括 Claude Code 和 RooCode 框架，以及 non-thinking 模式)中的鲁棒性测试产生了 72 到 74 之间的一致结果。

For the search agent evaluation, we assess our models using a standard commercial search API. Since DeepSeek-V3.2 supports a maximum context length of only 128K, approximately 20%+ of the test cases exceed this limit. To address this, we employ a context management method to derive the final score. For reference, the score is 51.4 without context management. Further details are provided in Section 4.4.

对于搜索智能体评估，我们使用标准商业搜索 API 评估模型。由于 DeepSeek-V3.2 仅支持最大 128K 的上下文长度，约 20%+ 的测试用例超过了此限制。为解决这一问题，我们采用上下文管理方法来推导最终分数。作为参考，不使用上下文管理的分数为 51.4。更多细节见 4.4 节。

On tool-use benchmarks, DeepSeek-V3.2 substantially narrows the performance gap between open-source and closed-source LLMs, though it remains below frontier models. For Tau2-bench, we employ the model itself as the user agent, achieving final category scores of 63.8 (Airline), 81.1 (Retail), and 96.2 (Telecom). For the MCP benchmarks, we employ the function calling format and place tool outputs within messages designated with the 'tool' role, rather than the 'user' role. During our testing, we observed that DeepSeek-V3.2 frequently engages in redundant self-verification, generating excessively long trajectories. This tendency often causes the context length to exceed the 128K limit, particularly in tasks such as MCP-Mark GitHub and Playwright evaluation. Consequently, this phenomenon hinders the final performance of DeepSeek-V3.2. However, integrating context management strategies can further enhance performance. We identify this as a direction for future work and a practical consideration for users. Even if DeepSeek-V3.2 suffers from the issue, it still significantly outperforms existing open models. Notably, since the environments and toolsets employed in these benchmarks were not encountered during RL training, the observed improvements demonstrate DeepSeek-V3.2's capacity to generalize its reasoning strategies to out-of-domain agentic scenarios. The evaluation of non-thinking model in the agent scenario is shown in Appendix Table 9.

在工具使用基准上，DeepSeek-V3.2 大幅缩小了开源与闭源 LLM 之间的性能差距，尽管仍低于前沿模型。对于 Tau2-bench，我们使用模型本身作为用户智能体，最终类别分数为 63.8(航空)、81.1(零售)和 96.2(电信)。对于 MCP 基准，我们使用函数调用格式，并将工具输出放在标记为 'tool' 角色的消息中，而非 'user' 角色。在测试过程中，我们观察到 DeepSeek-V3.2 频繁进行冗余的自验证，生成过长的轨迹。这种倾向经常导致上下文长度超过 128K 限制，特别是在 MCP-Mark GitHub 和 Playwright 评估等任务中。因此，这种现象阻碍了 DeepSeek-V3.2 的最终性能。然而，整合上下文管理策略可以进一步提升性能。我们将此确定为未来工作的方向和用户的实际考虑因素。即使 DeepSeek-V3.2 存在这一问题，它仍然显著优于现有开源模型。值得注意的是，由于这些基准中使用的环境和工具集在 RL 训练期间未遇到过，观察到的改进展示了 DeepSeek-V3.2 将其推理策略泛化到域外智能体场景的能力。non-thinking 模型在智能体场景中的评估见附录表 9。

> 译者注: "冗余自验证"是一个有趣的发现——模型在 agent 任务中过于谨慎，反复检查自己的结论，导致上下文长度耗尽。这与人类行为类似：有些人面对复杂任务时会过度思考，反而降低了效率。DeepSeek 计划在未来的工作中通过更精细的长度控制来解决这个问题。值得注意的是，这些工具使用基准的环境在 RL 训练中从未见过，这说明模型的 agent 能力具有良好的泛化性，不是对特定环境的过拟合。

### 4.2. Results of DeepSeek-V3.2-Speciale

### 4.2. DeepSeek-V3.2-Speciale 的结果

Table 3 demonstrates that DeepSeek-V3.2-Speciale achieves superior performance by leveraging increased reasoning tokens, surpassing the state-of-the-art Gemini-3.0-Pro across multiple benchmarks. Remarkably, as shown in Table 4, this general-purpose model attains gold-medal level performance in the 2025 International Olympiad in Informatics (IOI) and the ICPC World Finals (ICPC WF) without targeted training. Furthermore, by incorporating techniques from Shao et al. (2025), the model excels in complex proof tasks, reaching gold-medal thresholds in the 2025 International Mathematical Olympiad (IMO) and China Mathematical Olympiad (CMO).

表 3 表明 DeepSeek-V3.2-Speciale 通过利用增加的推理 token 实现了卓越性能，在多个基准上超越了最先进的 Gemini-3.0-Pro。值得注意的是，如表 4 所示，这个通用模型在未经过针对性训练的情况下，在 2025 年国际信息学奥林匹克 (IOI) 和 ICPC 世界总决赛 (ICPC WF) 中达到了金牌级表现。此外，通过引入 Shao et al. (2025) 的技术，该模型在复杂证明任务中表现出色，在 2025 年国际数学奥林匹克 (IMO) 和中国数学奥林匹克 (CMO) 中达到了金牌门槛。

> 译者注: Speciale 的竞赛成绩确实令人印象深刻，但需要理性看待。IOI 的评估方法(500 个候选解 → 多阶段过滤 → 选 50 个最长思考轨迹提交)与真实竞赛环境有差异——真实 IOI 中选手只有有限次提交机会(通常每题 50 次)，且不知道测试用例结果。IMO 使用了"生成-验证-精炼"循环，允许模型反复修改直到自评估满分，这也超出了真实竞赛的时间限制。这些评估方法更接近"测试时计算扩展"(test-time compute scaling)的研究范式，而非严格的竞赛模拟。不过，即使在宽松的评测条件下达到金牌水平，也证明了模型具备解决这些问题的"能力"。

However, the token efficiency of DeepSeek-V3.2-Speciale remains significantly inferior to that of Gemini-3.0-Pro. To mitigate deployment costs and latency, we imposed stricter token constraints during the training of the official DeepSeek-V3.2, aiming to optimize the trade-off between performance and cost. We believe that token efficiency remains a critical area for future investigation.

然而，DeepSeek-V3.2-Speciale 的 token 效率仍然显著低于 Gemini-3.0-Pro。为了缓解部署成本和延迟，我们在官方 DeepSeek-V3.2 的训练期间施加了更严格的 token 约束，旨在优化性能和成本之间的权衡。我们相信 token 效率仍然是未来研究的关键领域。

### 4.3. Synthesis Agentic Tasks

### 4.3. 合成智能体任务

In this section, we perform ablation experiments to study the effect of synthetic agentic tasks. We focus on two questions. First, are synthetic tasks sufficiently challenging for reinforcement learning? Second, how well do these synthetic tasks generalize, i.e., can they transfer to different downstream tasks or real-world environments?

在本节中，我们进行消融实验来研究合成智能体任务的效果。我们关注两个问题。第一，合成任务对强化学习来说是否足够具有挑战性？第二，这些合成任务的泛化能力如何，即它们能否迁移到不同的下游任务或真实环境？

To address the first question, we randomly sample 50 instances from the general synthesized agentic tasks and evaluate both the model used for synthesis and frontier closed-source LLMs. As shown in Table 5, DeepSeek-V3.2-Exp attains an accuracy of only 12%, while frontier closed-source models achieve at most 62%. These results indicate that the synthetic data include agentic tasks that are challenging for both DeepSeek-V3.2-Exp and frontier closed-source models.

为回答第一个问题，我们从通用合成智能体任务中随机采样 50 个实例，并评估用于合成的模型和前沿闭源 LLM。如表 5 所示，DeepSeek-V3.2-Exp 仅达到 12% 的准确率，而前沿闭源模型最多达到 62%。这些结果表明合成数据包含对 DeepSeek-V3.2-Exp 和前沿闭源模型都具有挑战性的智能体任务。

> 译者注: 12% 的准确率说明合成任务确实足够困难——即使是生成这些任务的模型本身也只能答对 12%。这解决了合成数据常见的一个顾虑：如果合成任务太简单，RL 训练会过拟合到简单模式，无法提升真实能力。62% 的上限(GPT-5-Thinking)说明这些任务对人类水平的模型也有挑战性。

To investigate whether RL on synthetic data can generalize to different tasks or real-world environments, we apply RL to the SFT checkpoint of DeepSeek-V3.2 (denoted DeepSeek-V3.2-SFT). To exclude the effects of long CoT and other RL data, we conduct RL only on synthetic agentic tasks in non-thinking mode. We then compare the model with DeepSeek-V3.2-SFT and DeepSeek-V3.2-Exp, where DeepSeek-V3.2-Exp is trained with RL only in search and code environments. As shown in Figure 5, large-scale RL on synthetic data yields substantial improvements over DeepSeek-V3.2-SFT on Tau2Bench, MCP-Mark, and MCP-Universe benchmarks. In contrast, restricting RL to code and search scenarios does not improve performance on these benchmarks, further highlighting the potential of synthetic data.

为了调查在合成数据上的 RL 是否能泛化到不同任务或真实环境，我们对 DeepSeek-V3.2 的 SFT 检查点(记为 DeepSeek-V3.2-SFT)应用 RL。为了排除长思维链和其他 RL 数据的影响，我们仅在 non-thinking 模式的合成智能体任务上进行 RL。然后我们将该模型与 DeepSeek-V3.2-SFT 和 DeepSeek-V3.2-Exp 进行比较，其中 DeepSeek-V3.2-Exp 仅在搜索和代码环境中用 RL 训练。如图 5 所示，在合成数据上的大规模 RL 在 Tau2Bench、MCP-Mark 和 MCP-Universe 基准上相对于 DeepSeek-V3.2-SFT 带来了显著提升。相比之下，将 RL 限制在代码和搜索场景中并不能提升这些基准上的性能，进一步凸显了合成数据的潜力。

> 译者注: 这个消融实验的设计很精巧。对照组(仅在搜索+代码上 RL)与实验组(在通用合成数据上 RL)的对比说明：通用合成数据培养的是"通用智能体能力"，而非特定工具的使用技巧。这类似于人类教育——学习广泛的推理和问题解决能力，比只学特定技能更有迁移价值。图 5 的数据(见 D3)显示通用合成 RL 在 Tau2Bench 上从约 60 提升到约 80，在 MCP-Mark 上从约 20 提升到约 45，在 MCP-Universe 上从约 25 提升到约 55，提升幅度非常显著。

![](images/fig05_rl_synthetic_agent.jpg)  
Figure 5 | RL training of DeepSeek-V3.2-SFT using exclusively synthetic general agent data.

> 图 5: 仅使用合成通用智能体数据对 DeepSeek-V3.2-SFT 进行 RL 训练。

### 4.4. Context Management of Search Agent

### 4.4. 搜索智能体的上下文管理

Even with extended context windows such as 128k, agentic workflows, particularly in searchbased scenarios, frequently encounter maximum length limitations that prematurely truncate the reasoning process. This bottleneck inhibits the full realization of test-time compute potential. To address this, we introduce context management employing simple strategies to extend token budgets at test time, when the token usage exceeds 80% of the context window length. These strategies include (1) Summary, which summarizes the overflowed trajectory and re-initiates the rollout; (2) Discard-75%, which discards the first 75% tool call history in the trajectory to free up spaces; (3) Discard-all, which resets the context by discarding all previous tool call history (similar to the new context tool (Anthropic, 2025a)). For comparison, we also implement a parallel scaling baseline, Parallel-fewest-step, which samples N independent trajectories and selects the trajectory with the fewest steps.

即使有了 128k 这样的扩展上下文窗口，智能体工作流——特别是在基于搜索的场景中——经常遇到最大长度限制，过早截断推理过程。这个瓶颈阻碍了测试时计算潜力的充分实现。为解决此问题，我们引入了上下文管理，采用简单策略在测试时扩展 token 预算，当 token 使用量超过上下文窗口长度的 80% 时触发。这些策略包括：(1) Summary(摘要)，总结溢出的轨迹并重新启动 rollout; (2) Discard-75%(丢弃 75%)，丢弃轨迹中前 75% 的工具调用历史以释放空间; (3) Discard-all(全部丢弃)，通过丢弃所有先前的工具调用历史来重置上下文(类似于 Anthropic 的新上下文工具 (Anthropic, 2025a))。作为对比，我们还实现了一个并行扩展基线 Parallel-fewest-step，采样 N 个独立轨迹并选择步数最少的轨迹。

> 译者注: 上下文管理是 agent 部署中的实际工程问题。当智能体进行多步搜索时，每一步都会增加上下文长度(搜索查询 + 搜索结果 + 推理过程)。128K 的窗口在复杂任务中很快就会被填满。三种策略各有优劣：Summary 保留信息最完整但计算开销最大(需要额外生成摘要); Discard-75% 在信息保留和效率之间取折中; Discard-all 最简单高效但丢失最多历史信息。Parallel-fewest-step 则是另一种思路——不延长单条轨迹，而是并行尝试多条短轨迹，选最优的。

We evaluate these strategies on the BrowseComp benchmark (Wei et al., 2025). As illustrated in Figure 6, under varying compute budgets, context management leads to significant performance gains by allowing the model to scale up test-time compute, providing more space to perform additional execution steps. For example, Summary extends the average steps to 364, achieving a performance improvement of up to 60.2. However, its overall efficiency is relatively low. Despite its simplicity, Discard-all performs well in both efficiency and scalability, achieving a score of 67.6, comparable to parallel scaling while using significantly fewer steps.

我们在 BrowseComp 基准 (Wei et al., 2025) 上评估这些策略。如图 6 所示，在不同计算预算下，上下文管理通过允许模型扩展测试时计算、提供更多空间执行额外步骤，带来了显著的性能提升。例如，Summary 将平均步数扩展到 364，实现了高达 60.2 的性能提升。然而，其整体效率相对较低。尽管简单，Discard-all 在效率和可扩展性方面都表现良好，达到 67.6 分，与并行扩展相当但使用的步数显著更少。

![](images/fig06_browsecomp_accuracy.jpg)  
Figure 6 | Accuracy of Browsecomp with different test-time compute expansion strategies.

> 图 6: 使用不同测试时计算扩展策略的 BrowseComp 准确率。

In summary, test-time compute can be scaled either serially through context management or in parallel, both effectively extending the model's problem-solving capacity. However, different strategies exhibit varying efficiency and scalability. Thus, it is crucial to account for actual compute costs when benchmarking model performance. Meanwhile, finding the optimal combination of serial and parallel scaling to maximize both efficiency and scalability remains a crucial direction for future work.

总之，测试时计算可以通过上下文管理进行串行扩展，或通过并行采样进行并行扩展，两者都能有效扩展模型的问题解决能力。然而，不同策略展现出不同的效率和可扩展性。因此，在基准测试模型性能时考虑实际计算成本至关重要。同时，找到串行和并行扩展的最佳组合以最大化效率和可扩展性仍然是未来工作的关键方向。

> 译者注: 这里的"测试时计算扩展"(test-time compute scaling)是当前 LLM 研究的前沿话题。传统上，模型性能取决于训练时的计算投入(FLOPs); 但近来的研究表明，在推理时允许模型进行更多计算(如生成更长的思维链、并行采样多条解、迭代精炼)也能显著提升性能。DeepSeek-V3.2-Speciale 本质上就是"训练时减少长度约束 + 测试时允许更长推理"的产物。上下文管理则是在固定上下文窗口下实现测试时计算扩展的工程方案。

## 5. Conclusion, Limitation, and Future Work

## 5. 结论、局限性与未来工作

In this work, we introduced DeepSeek-V3.2, a framework that effectively bridges the gap between computational efficiency and advanced reasoning capabilities. Using DSA, we addressed critical computation complexity without sacrificing long-context performance. By increasing computational budget, DeepSeek-V3.2 achieves comparable performance with GPT-5 on reasoning benchmarks. Finally, the integration of our large-scale agentic task synthesis pipeline significantly enhances tool-use proficiency, unlocking new possibilities for robust and generalizable AI agents with open LLM. Furthermore, our high-compute variant, DeepSeek-V3.2-Speciale, validated by gold-medal achievements in the IMO and IOI, sets a milestone for open LLMs.

在本工作中，我们推出了 DeepSeek-V3.2，一个有效弥合计算效率与高级推理能力之间差距的框架。通过 DSA，我们在不牺牲长上下文性能的前提下解决了关键计算复杂度问题。通过增加计算预算，DeepSeek-V3.2 在推理基准上达到了与 GPT-5 相当的性能。最后，大规模智能体任务合成流水线的整合显著增强了工具使用熟练度，为使用开源 LLM 构建鲁棒且可泛化的 AI 智能体解锁了新的可能性。此外，我们的高计算变体 DeepSeek-V3.2-Speciale 通过在 IMO 和 IOI 中获得金牌成绩得到验证，为开源 LLM 树立了里程碑。

Despite these achievements, we acknowledge certain limitations when compared to frontier closed-source models such as Gemini-3.0-Pro. First, due to fewer total training FLOPs, the breadth of world knowledge in DeepSeek-V3.2 still lags behind that of leading proprietary models. We plan to address this knowledge gap in future iterations by scaling up the pre-training compute. Second, token efficiency remains a challenge; DeepSeek-V3.2 typically requires longer generation trajectories (i.e., more tokens) to match the output quality of models like Gemini-3.0-Pro. Future work will focus on optimizing the intelligence density of the model's reasoning chains to improve efficiency. Third, solving complex tasks is still inferior to frontier models, motivating us to further refine our foundation model and post-training recipe.

尽管取得了这些成就，我们承认与 Gemini-3.0-Pro 等前沿闭源模型相比仍存在某些局限。第一，由于总训练 FLOPs 较少，DeepSeek-V3.2 的世界知识广度仍然落后于领先的专有模型。我们计划在未来迭代中通过扩大预训练计算来解决这一知识差距。第二，token 效率仍然是一个挑战; DeepSeek-V3.2 通常需要更长的生成轨迹(即更多 token)来匹配 Gemini-3.0-Pro 等模型的输出质量。未来工作将专注于优化模型推理链的"智能密度"以提升效率。第三，解决复杂任务的能力仍然不如前沿模型，这促使我们进一步完善基础模型和后训练方案。

> 译者注: DeepSeek 坦诚地列出了三大局限，这种自我批评的态度值得赞赏。局限 1(知识广度不足)根源在于预训练计算量——V3.2 是在 V3.1-Terminus 基础上继续预训练 943.7B token，而非从头预训练数万亿 token。局限 2(token 效率低)是当前推理模型的普遍问题——更长的思维链带来更好的结果，但也意味着更高的推理成本。"智能密度"(intelligence density) 是一个值得关注的概念，指的是每单位 token 中蕴含的有效推理量。局限 3(复杂任务解决能力)说明即使有了 DSA 和大规模 RL，开源模型与最顶尖闭源模型之间仍有差距。

## References

## 参考文献

论文引用的主要文献包括：

- **核心方法**: DeepSeek-V3 (DeepSeek-AI, 2024) 的 MLA 架构和冷启动方法论; GRPO (Shao et al., 2024) 的强化学习算法; Schulman et al. (2020) 的 KL 散度无偏估计; Yuan et al. (2025) 的 Native Sparse Attention。
- **竞争模型**: GPT-5 (OpenAI, 2025), Gemini-3.0-Pro (DeepMind, 2025b), Claude-4.5-Sonnet (Anthropic, 2025b), Kimi-K2-Thinking (MoonShot, 2025), MiniMax-M2 (MiniMax, 2025), Qwen3 (Qwen, 2025), GLM-4.5 (ZhiPu-AI, 2025)。
- **评估基准**: MMLU-Pro (Wang et al., 2024), GPQA Diamond (Rein et al., 2023), HLE (Phan et al., 2025), SWE-bench (Jimenez et al., 2024), BrowseComp (Wei et al., 2025), MCP-Universe (Luo et al., 2025), Tool-Decathlon (Li et al., 2025), Tau2-bench (Barres et al., 2025) 等。
- **技术基础**: Attention Is All You Need (Vaswani et al., 2017), MQA (Shazeer, 2019), DeepSeekMath-V2 (Shao et al., 2025) 等。

> 完整的参考文献列表见 D3 原文(第 298-362 行)，共 30 余篇引用。

## Appendices

## 附录

### A. MHA and MQA Modes of MLA

### A. MLA 的 MHA 和 MQA 模式

Figure 7 illustrates two aspects of MLA – the MHA and MQA modes – as well as the transformation between them.

图 7 展示了 MLA 的两个方面——MHA 和 MQA 模式——以及它们之间的转换。

![](images/fig07_mha_mqa_modes.jpg)  
Figure 7 | Illustration of the MHA and MQA modes of MLA. For DeepSeek-V3.1-Terminus, the MHA mode is used for training and prefilling, while the MQA mode is used for decoding.

> 图 7: MLA 的 MHA 和 MQA 模式示意图。对于 DeepSeek-V3.1-Terminus，MHA 模式用于训练和预填充，MQA 模式用于解码。

### B. Cold Start Template

### B. 冷启动模板

Appendix B 提供了推理数据和智能体数据的系统提示模板示例，包括：
- **表 6**: 推理数据系统提示示例，要求模型在 `<think></think>` 标签内输出推理过程
- **表 7**: 智能体系统提示模板，包含工具描述和工具调用格式的占位符
- **表 8**: 需要推理的智能体系统提示，允许在 `<think></think>` 中使用 Python 工具进行最多 20 次代码执行

> 详细模板内容见 D3 原文(第 375-384 行)。

### C. Non-thinking DeepSeek-V3.2 Agentic Evaluation

### C. Non-thinking 模式的 DeepSeek-V3.2 智能体评估

Appendix C 比较了 DeepSeek-V3.2 在 non-thinking 和 thinking 模式下的智能体性能(表 9)。结果表明 non-thinking 模式略逊于 thinking 模式，但仍具有竞争力。例如，Terminal Bench 2.0 上 non-thinking 为 37.1% vs thinking 为 46.4%; SWE-Verified 上 non-thinking 为 72.1% vs thinking 为 73.1%; MCP-Mark 上 non-thinking 为 26.5% vs thinking 为 38.0%。

### D. Evaluation Method of IOI, ICPC World Final, IMO, and CMO

### D. IOI、ICPC 世界总决赛、IMO 和 CMO 的评估方法

对于所有竞赛，模型的最大生成长度设为 128k。不使用工具或互联网访问，测试严格遵循竞赛的时间和尝试限制。

- **IOI 评估**: 按照官方竞赛规则设计提交策略(每题最多 50 次提交，按所有子任务最高分计)。首先为每题采样 500 个候选解，然后应用多阶段过滤：先淘汰未通过样例测试或超出长度限制的无效提交; 再用 DeepSeek-V3.2-Exp 模型识别并移除明确表示无法或拒绝解决问题的样本; 从剩余有效候选中选择思考轨迹最长的 50 个进行最终提交。
- **ICPC 评估**: 采用相同的过滤方法，但初始样本量更小(每题 32 个候选解)。
- **IMO 和 CMO**: 采用生成-验证-精炼循环。模型迭代改进其解法，直到达到完美自评估或达到最大修订上限，与 Shao et al. (2025) 的过程相同。

> 译者注: 竞赛评估方法的细节揭示了这些"金牌成绩"的实际评测条件。IOI 的 500 选 50 策略、ICPC 的 32 选策略、IMO/CMO 的迭代精炼循环，都超出了真实竞赛的限制。这并不意味着成绩没有价值——它证明了模型具备解决这些问题的能力——但读者需要理解评测条件与真实竞赛的差异。

### E. Author List

### E. 作者列表

论文作者分为三个团队：
- **研究与工程** (Research & Engineering): 约 150 人，包括核心贡献者 Aixin Liu, Bangcai Lin, Bing Xue, Bochao Wu, Chaofan Lin, Chengda Lu, Chong Ruan, Damai Dai, Daya Guo, Dejian Yang, Deli Chen 等。标 * 号者为已离职团队成员。
- **数据标注** (Data Annotation): 约 25 人
- **业务与合规** (Business & Compliance): 约 25 人

作者按名字首字母排序。完整的作者名单见 D3 原文(第 406-411 行)。

---

## 全文完

> **全文完**。本文基于 DeepSeek-V3.2 官方技术报告(23 页 PDF)的 MinerU 英文原文进行逐段中英对照翻译。核心公式、表格数据、图表引用均保留自 D3 原文。译者注聚焦于设计动机、工程细节、数据可信度和技术谱系分析。

## 关联文件说明

- 原始 MinerU 英文稿：`03-DeepSeek-V3.2-mineru-en.md`
- 前序精译/导读：`01-DeepSeek-V3.2技术报告精译.md`
- D5 专题正文：`05-DeepSeek-V3.2-Speciale极限推理剖析.md`
- D5 技术入口：`05-DeepSeek-V3.2-Index.md`
