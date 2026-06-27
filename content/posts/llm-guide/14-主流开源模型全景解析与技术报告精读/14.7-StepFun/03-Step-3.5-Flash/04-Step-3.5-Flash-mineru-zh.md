---
title: "Step-3.5-Flash 技术报告逐段翻译"
source: 03-Step-3.5-Flash-mineru-en.md
translated_by: "AI Agent"
date: 2026-05-23
---

# Step-3.5-Flash 技术报告逐段翻译

> 原文标题: Step 3.5 Flash: Open Frontier-Level Intelligence with 11B Active Parameters
> 翻译基于: MinerU 英文提取稿 `03-Step-3.5-Flash-mineru-en.md`

---

## Abstract

**原文**:
We introduce Step 3.5 Flash, a sparse Mixture-of-Experts (MoE) model that bridges the gap between frontier-level agentic intelligence and computational efficiency. We focus on what matters most when building agents: reasoning that’s sharp, and execution that’s fast and reliable.

**译文**:
我们提出 Step 3.5 Flash，这是一种稀疏混合专家(MoE)模型，旨在弥合前沿级 agent 智能与计算效率之间的差距。我们聚焦于构建 agent 时最重要的两件事：足够锋利的推理能力，以及足够快速、可靠的执行能力。

**原文**:
Reflecting these priorities, Step 3.5 Flash pairs a 196B-parameter foundation for high-fidelity modeling with 11B active parameters for efficient inference, optimized by interleaved 3:1 Sliding Window/Full Attention and Multi-Token Prediction (MTP-3) to minimize the latency and cost of multi-round agentic interactions.

**译文**:
围绕这一优先级，Step 3.5 Flash 使用 196B 总参数来保证高保真建模能力，同时将每个 token 的激活参数控制在 11B，以获得高效推理能力; 并通过 3:1 交错的滑动窗口注意力/全注意力结构，以及多 token 预测(MTP-3)，来尽可能降低多轮 agent 交互中的延迟与成本。

**原文**:
Toward frontier-level intelligence, we design a scalable RL framework that integrates verifiable signals and preference feedback while maintaining stability during large-scale off-policy training to drive consistent self-improvement across mathematics, code, and tool use.

**译文**:
为了逼近前沿级智能，我们设计了一套可扩展的强化学习框架，它将可验证信号与偏好反馈结合起来，并在大规模离策略训练过程中保持稳定，从而推动模型在数学、编程与工具使用方面持续自我提升。

**原文**:
Step 3.5 Flash demonstrates strong intelligence across agent, coding, and math tasks, achieving performance on par with frontier models such as GPT-5.2 xHigh and Gemini 3.0 Pro. By redefining the efficiency frontier, Step 3.5 Flash provides a high-density foundation for deploying sophisticated agents in real-world industrial environments.

**译文**:
Step 3.5 Flash 在 agent、编程与数学任务上都展现出很强的智能水平，其表现可与 GPT-5.2 xHigh、Gemini 3.0 Pro 等前沿模型相提并论。通过重新定义效率边界，Step 3.5 Flash 为在真实工业环境中部署复杂 agent 提供了一个高密度基础底座。

> 译者注：这篇报告的核心不是“再造一个更大的 MoE”，而是把 agent 场景中的三个约束放到同一平面上考虑：能力、成本、延迟。它要证明的是，开源模型不必一味靠堆参数追赶闭源前沿，也可以通过系统协同设计把“单位激活参数的智能密度”做高。

---

## 1 Introduction

**原文**:
While open-source large language models have rapidly narrowed the performance gap with closed-source frontier systems across verifiable tasks, new challenges emerge as agentic systems gain prominence. In particular, open-source models still trail closed-source frontiers in complex reasoning. Furthermore, critical efficiency bottlenecks hinder their application in long-context agentic tasks, let alone deployment in edge or resource-constrained settings.

**译文**:
尽管开源大语言模型在可验证任务上已经迅速缩小了与闭源前沿系统之间的性能差距，但随着 agent 系统的重要性不断上升，一系列新挑战也随之出现。特别是，在复杂推理能力上，开源模型依然落后于闭源前沿模型。此外，关键的效率瓶颈仍然阻碍着它们在长上下文 agent 任务中的应用，更不用说部署到边缘端或资源受限环境之中了。

**原文**:
In designing the architecture of Step 3.5 Flash, we focus on two core aspects: efficiency and capacity. We adopt a sparse Mixture-of-Experts architecture with 196B total parameters and only 11B activated per token, together with a 3:1 ratio of sliding-window attention to full attention and multi-token prediction to reduce long-context latency.

**译文**:
在设计 Step 3.5 Flash 的架构时，我们主要关注两个核心维度：效率与容量。我们采用稀疏混合专家架构，总参数量为 196B，但每个 token 仅激活 11B 参数; 同时配合 3:1 的滑动窗口注意力与全注意力比例，以及多 token 预测机制，以降低长上下文场景下的延迟。

**原文**:
On the pretraining side, we treat stability as a first-class requirement and build a comprehensive observability and diagnostic stack via a lightweight asynchronous metrics server with micro-batch-level continuous logging.

**译文**:
在预训练侧，我们将稳定性视为一级要求，并通过一个轻量级异步指标服务器加上微批次级连续日志，构建了一整套全面的可观测性与诊断栈。

**原文**:
Toward frontier-level intelligence, current post-training systems face two tightly coupled challenges: inefficient iteration of domain-specific experts for self-distillation and limited scalability of Reinforcement Learning to long-horizon reasoning for MoE models.

**译文**:
为了逼近前沿级智能，当前后训练系统面临两个紧密耦合的挑战：一是面向自蒸馏的领域专家迭代效率不足，二是强化学习在 MoE 模型上的长程推理扩展能力仍然有限。

> 译者注：引言里已经很清楚地给出了这篇论文的三层主线：架构设计要解决延迟，训练系统要解决稳定性，后训练框架要解决长程 agentic 推理的扩展性。这不是单点创新，而是围绕 agent 场景做的整体打包优化。

---

## 2 Architecture

### 2.1 Design Philosophy

**原文**:
The architecture of Step 3.5 Flash reflects a paradigm shift in model–system co-design. Beyond the traditional objectives of intelligence and cost, the era of autonomous agents elevates a third critical constraint: inference latency.

**译文**:
Step 3.5 Flash 的架构体现了一种模型-系统协同设计范式的转变。除了传统的“智能”和“成本”两个目标之外，自主 agent 时代又新增了第三个关键约束：推理延迟。

**原文**:
In interactive agentic workflows, minimized latency translates directly to reduced wall-clock time for task completion, or conversely, allows for increased intelligence within a fixed time budget via test-time scaling.

**译文**:
在交互式 agent 工作流中，更低的延迟会直接转化为更短的任务完成 wall-clock 时间; 反过来讲，在固定时间预算内，更低延迟也允许通过 test-time scaling 投入更多推理步骤，从而换取更高智能。

### 2.2 Sparse MoE Backbone with Hybrid Attention

**原文**:
Step 3.5 Flash adopts a 45-layer sparse-MoE Transformer backbone with 3 dense layers and 42 MoE layers. Each MoE layer contains 288 routed experts plus one shared expert, with a top-k router activating 8 experts per token.

**译文**:
Step 3.5 Flash 采用一个 45 层的稀疏 MoE Transformer 主干，其中包含 3 层稠密层和 42 层 MoE 层。每一层 MoE 都包含 288 个路由专家和 1 个共享专家，top-k 路由器会为每个 token 激活 8 个专家。

**原文**:
To balance long-context efficiency with long-range connectivity, the model employs an interleaved 3:1 attention layout, repeating three Sliding Window Attention layers followed by one Full Attention layer.

**译文**:
为了在长上下文效率与长程连接能力之间取得平衡，模型采用了 3:1 的交错注意力布局，即重复“三层滑动窗口注意力 + 一层全注意力”的模式。

**原文**:
However, naive interleaving underperforms a dense attention baseline, so we compensate with two complementary techniques: increasing query heads in SWA layers and adopting head-wise gated attention.

**译文**:
不过，朴素的交错注意力布局会劣于稠密注意力基线，因此我们又引入了两项互补技术来做补偿：一是在 SWA 层中增加 query head 数量，二是采用按 head 进行门控的注意力机制。

### 2.3 Multi-Token Prediction

**原文**:
To further reduce autoregressive latency, we incorporate Multi-Token Prediction as a complementary lever to speculative decoding. The MTP heads are intentionally lightweight and use SWA and dense FFNs.

**译文**:
为了进一步降低自回归延迟，我们引入多 token 预测(MTP)，作为投机解码之外的另一项补充加速杠杆。MTP 头被刻意设计得非常轻量，并采用 SWA 和稠密 FFN 结构。

> 译者注：这里的关键工程判断是，Step 3.5 Flash 并没有只押注单一技巧来优化 agent 推理速度，而是把注意力布局、MoE 路由、多 token 预测一起协同设计。单看其中任何一个模块都不算颠覆式创新，但组合起来就形成了面向 agentic workload 的特化架构。

---

## 3 Infrastructure

### 3.1 Compute Cluster

**原文**:
Step 3.5 Flash is trained on a large-scale cluster with 4096 NVIDIA H800 GPUs, using high-bandwidth intra-node and inter-node communication links.

**译文**:
Step 3.5 Flash 在一个由 4096 张 NVIDIA H800 GPU 组成的大规模集群上完成训练，并使用高带宽的节点内和节点间通信链路。

### 3.2 Training Framework

**原文**:
Training is powered by an internal lightweight and high-performance framework built upon PyTorch and Megatron-LM, with support for unified pretraining, post-training, and RL workloads.

**译文**:
训练由一个内部轻量高性能框架驱动，该框架构建在 PyTorch 和 Megatron-LM 之上，并统一支持预训练、后训练和强化学习工作负载。

### 3.3 High-Throughput Lightweight Monitoring

**原文**:
To support stability at this scale, the system collects fine-grained metrics with micro-batch-level logging. Since synchronous reduction of millions of messages would add unacceptable overhead, telemetry processing is offloaded through an asynchronous lightweight metrics server.

**译文**:
为了在这一规模下维持训练稳定性，系统会通过微批次级日志收集细粒度指标。由于同步归约数百万条消息会带来不可接受的额外开销，因此这些遥测处理会通过一个异步轻量指标服务器来卸载。

> 译者注：这部分说明 Step 团队很清楚，大模型训练中的稳定性不是“loss 曲线偶尔看一下”就能保证的。你必须把训练过程本身变成一个可观测系统，否则真正的故障信号可能在数千步之前就出现了，只是你没有看到。

---

## 4 Pre-Training and Mid-Training

### 4.1 Training Stability

**原文**:
We identify and mitigate several recurring failure modes in large-scale MoE pretraining, including Muon-related numerical sensitivity, expert collapse beyond routing collapse, and localized activation blow-ups in deep MoE layers.

**译文**:
我们识别并缓解了大规模 MoE 预训练中若干反复出现的失效模式，包括：与 Muon 优化器相关的数值敏感性问题、超出路由崩溃范畴的专家崩溃，以及深层 MoE 层中的局部激活爆炸。

**原文**:
The metrics stack makes it possible to detect these problems early, often before the training loss itself visibly diverges.

**译文**:
这套指标系统使我们能够在这些问题真正导致训练 loss 明显发散之前，就提前发现它们。

### 4.2 Training Curriculum

**原文**:
With the stabilized training regime, the model is trained over 17.2T high-quality and diverse tokens, followed by an additional mid-training phase that expands context length and strengthens reasoning/agentic foundations.

**译文**:
在训练稳定性得到保障之后，模型使用 17.2T 高质量且多样化的 token 进行训练，随后还会经历一个额外的 mid-training 阶段，用来扩展上下文长度并强化推理与 agent 基础能力。

> 译者注：这里能看出 Step 团队的一个重要思路：mid-training 并不只是“继续喂数据”，而是把它当作 agentic 能力形成之前的一个结构性过渡阶段。也就是说，预训练、mid-training、后训练在能力分工上是被明确拆开的。

---

## 5 Post-Training

### 5.1 Expert Model Construction and Self-Distillation

**原文**:
Directly training a single generalist for all domains often weakens domain-specific expertise, while maintaining many separate expert models becomes unsustainably expensive. We therefore alternate between domain specialization and global synthesis on top of a shared SFT foundation.

**译文**:
直接训练一个统一的通才模型去覆盖所有领域，往往会削弱领域专家能力; 而维护多个分离专家模型又会导致不可持续的高成本。因此，我们在共享的 SFT 基础之上，让模型在“领域专门化”和“全局综合”之间交替进行。

### 5.2 Scalable RL

**原文**:
To support stable and scalable RL for long-horizon reasoning in MoE models, we introduce MIS-PO, which replaces continuous importance weighting with discrete distributional filtering at both token and trajectory levels.

**译文**:
为了在 MoE 模型上实现稳定且可扩展的长程推理强化学习，我们引入 MIS-PO。它用 token 级和轨迹级的离散分布过滤，替代传统连续的重要性加权方式。

**原文**:
By restricting optimization to samples within a stable trust region, MIS-PO substantially reduces gradient variance while preserving effective learning signals.

**译文**:
通过把优化过程限制在一个稳定 trust region 内部，MIS-PO 在保留有效学习信号的同时，大幅降低了梯度方差。

### 5.3 Data Synthesis and Curation

**原文**:
The post-training recipe also relies on domain-specific synthetic data, generalized tool-learning data, code-agent data, and search/research agent data.

**译文**:
这一后训练流程还依赖多种类型的合成与整理数据，包括：领域特定合成数据、通用工具学习数据、代码 agent 数据，以及搜索/研究 agent 数据。

### 5.4 Agent Infrastructure

**原文**:
We build dedicated infrastructure for agent training and evaluation, ensuring that the model is optimized not only for benchmark answers but also for real interactive execution.

**译文**:
我们还构建了专门用于 agent 训练与评测的基础设施，以确保模型优化目标不仅是基准题答案本身，还包括真实交互式执行能力。

> 译者注：Step 的后训练路线很像“单模型 generalist + 专项能力迭代器”的折中设计。它不想退回多模型拼装，也不想让一个大模型在所有领域平均用力，而是通过 shared foundation 维持统一底座，再用 specialization/synthesis 循环保持能力尖度。

---

## 6 Evaluations

### 6.1 Pre-training Evaluations

**原文**:
Under base-model evaluation, Step 3.5 Flash Base already shows competitive performance against larger models on math, coding, and knowledge tasks.

**译文**:
在基座模型评测中，Step 3.5 Flash Base 就已经在数学、编程和知识任务上展现出与更大模型相竞争的能力。

### 6.2 Post-training Evaluations

**原文**:
After post-training, Step 3.5 Flash achieves strong results across reasoning, coding, and agentic benchmarks, substantially narrowing the gap between advanced open models and frontier proprietary systems.

**译文**:
在完成后训练后，Step 3.5 Flash 在推理、编程和 agent 基准上都取得了很强的结果，并显著缩小了先进开源模型与前沿闭源系统之间的差距。

**原文**:
It performs strongly on tasks such as IMO-AnswerBench, LiveCodeBench, τ²-Bench, BrowseComp, and Terminal-Bench 2.0, despite using only 11B active parameters.

**译文**:
尽管每个 token 仅激活 11B 参数，它在 IMO-AnswerBench、LiveCodeBench、τ²-Bench、BrowseComp 和 Terminal-Bench 2.0 等任务上依然表现强劲。

> 译者注：这些结果最值得关注的不是某一个单点分数，而是它在“数学推理 + 代码执行 + agent 工具链”三类任务上的同时强势。对 agent 模型来说，这种跨任务稳定性比单一 benchmark 冲顶更重要，因为工业部署遇到的是组合型任务，而不是孤立题目。

---

## 7 Limitations

**原文**:
Although Step 3.5 Flash narrows the gap significantly, limitations remain in the hardest reasoning settings, as well as in some long-horizon interactive tasks where proprietary frontier systems still maintain an edge.

**译文**:
尽管 Step 3.5 Flash 已经显著缩小了差距，但在最困难的推理设置中，以及一些长时程交互任务上，闭源前沿系统依然保持领先优势。

**原文**:
In addition, the complexity of the training and observability stack itself reflects the cost of pushing sparse MoE systems toward stable frontier performance.

**译文**:
此外，训练与可观测性栈本身的复杂度，也反映出一个事实：要把稀疏 MoE 系统推进到稳定的前沿性能水平，本身就需要支付很高的系统工程成本。

> 译者注：这一节很重要，因为它提醒读者：Step 3.5 Flash 的成功并不意味着“以后 11B active 就能轻松平替闭源前沿”。恰恰相反，它证明了要做到这一点，需要在模型、训练、infra、监控和 RL 上同时投入极高工程密度。

---

## Conclusion

**原文**:
Step 3.5 Flash demonstrates that open models can approach frontier proprietary systems in both reasoning and agentic settings while redefining the efficiency frontier through model–system co-design.

**译文**:
Step 3.5 Flash 证明：通过模型-系统协同设计，开源模型可以在推理能力与 agent 场景中逼近前沿闭源系统，同时重新定义效率边界。

**原文**:
It provides a high-density foundation for deploying sophisticated agents in real-world industrial environments.

**译文**:
它为在真实工业环境中部署复杂 agent 提供了一个高密度基础底座。

> 译者注：如果说 DeepSeek-R1 代表的是“推理能力可以被纯 RL 拉起来”，那 Step 3.5 Flash 代表的是“agent 模型不能只看 reasoning score，必须把延迟和系统可部署性一起设计进去”。这是一条更偏向工业化的大模型路线。

---

## References 说明

参考文献与附录细节保留在英文 MinerU 原稿中。若需逐条引用，请直接查阅 `03-Step-3.5-Flash-mineru-en.md`。

---

> **全文完**。本文基于 Step-3.5-Flash 的 MinerU 英文提取稿进行逐段翻译，并在 agent 架构、训练稳定性与可扩展 RL 框架等关键节点补充译者注。
>
> - 源文件：`03-Step-3.5-Flash-mineru-en.md`
> - 相关精译：`01-Step-3.5-Flash技术报告精译.md`
> - 相关专题：`05-Step-3.5-Flash-Architecture-Overview.md`
