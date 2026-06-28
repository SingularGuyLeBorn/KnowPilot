---
title: "DeepSeek-V3 - 逐段精译与译者注"
source: 03-DeepSeek-V3-mineru-en.md
translated_by: "AI Agent"
date: 2024-12
---

# DeepSeek-V3: 一个强大、经济且高效的混合专家语言模型

>  **[返回 14.1-DeepSeek 家族总览](../../14.1-DeepSeek.md)**


> 原文标题: DeepSeek-V3 Technical Report
> 原文文件: `03-DeepSeek-V3-mineru-en.md`
> 原文链接: https://github.com/deepseek-ai/DeepSeek-V3
> 发布日期: 2024 年 12 月
> 发布机构: DeepSeek-AI

> 说明: 本文在保留英文原文结构、关键图示和公式链路的基础上补入中文译文与译者注.

## 分节结构

- 摘要
- 1. 引言
- 2. 架构
- 3. 基础设施
- 4. 预训练
- 5. 后训练
- 6. 结论、局限与未来方向
- 附录 A-C

## Abstract

We present DeepSeek-V3, a strong Mixture-of-Experts (MoE) language model with 671B total parameters with 37B activated for each token. To achieve efficient inference and cost-effective training, DeepSeek-V3 adopts Multi-head Latent Attention (MLA) and DeepSeekMoE architectures, which were thoroughly validated in DeepSeek-V2. Furthermore, DeepSeek-V3 pioneers an auxiliary-loss-free strategy for load balancing and sets a multi-token prediction training objective for stronger performance. We pre-train DeepSeek-V3 on 14.8 trillion diverse and high-quality tokens, followed by Supervised Fine-Tuning and Reinforcement Learning stages to fully harness its capabilities. Comprehensive evaluations reveal that DeepSeek-V3 outperforms other open-source models and achieves performance comparable to leading closed-source models. Despite its excellent performance, DeepSeek-V3 requires only 2.788M H800 GPU hours for its full training. In addition, its training process is remarkably stable. Throughout the entire training process, we did not experience any irrecoverable loss spikes or perform any rollbacks. The model checkpoints are available at https://github.com/deepseek-ai/DeepSeek-V3.

我们提出 DeepSeek-V3，一个强大的混合专家(MoE)语言模型，总参数量 671B，每个 token 激活 37B。为了实现高效推理和经济训练，DeepSeek-V3 采用了 Multi-head Latent Attention(MLA)和 DeepSeekMoE 架构，这两项架构已在 DeepSeek-V2 中得到充分验证。此外，DeepSeek-V3 开创性地提出了无辅助损失的负载均衡策略，并设置了多 token 预测训练目标以获得更强的性能。我们在 14.8 万亿个多样化且高质量的 token 上对 DeepSeek-V3 进行预训练，随后通过监督微调(SFT)和强化学习(RL)阶段充分释放其能力。全面评估表明，DeepSeek-V3 超越了其他开源模型，性能可与领先的闭源模型媲美。尽管性能卓越，DeepSeek-V3 的完整训练仅需 2.788M H800 GPU 小时。此外，其训练过程异常稳定。在整个训练过程中，我们没有遇到任何不可恢复的损失尖峰，也无需执行任何回滚。模型检查点可在 https://github.com/deepseek-ai/DeepSeek-V3 获取。

> 译者注: 671B 总参数中只有 37B 被激活，这意味着激活率仅约 5.5%。这是 MoE 架构的核心优势——用极低的推理成本获得大模型的表达能力。14.8T token 的训练量与 2.788M GPU 小时的成本比例，意味着每万亿 token 仅需约 180K GPU 小时，这个效率在同等规模模型中极具竞争力。

![](images/fig01_benchmark_performance.jpg)  
Figure 1 | Benchmark performance of DeepSeek-V3 and its counterparts.

> 图 1: DeepSeek-V3 及其对比模型的基准测试性能对比。

---

## 1. Introduction

In recent years, Large Language Models (LLMs) have been undergoing rapid iteration and evolution (Anthropic, 2024; Google, 2024; OpenAI, 2024a), progressively diminishing the gap towards Artificial General Intelligence (AGI). Beyond closed-source models, open-source models, including DeepSeek series (DeepSeek-AI, 2024a,b,c; Guo et al., 2024), LLaMA series (AI@Meta, 2024a,b; Touvron et al., 2023a,b), Qwen series (Qwen, 2023, 2024a,b), and Mistral series (Jiang et al., 2023; Mistral, 2024), are also making significant strides, endeavoring to close the gap with their closed-source counterparts. To further push the boundaries of open-source model capabilities, we scale up our models and introduce DeepSeek-V3, a large Mixture-of-Experts (MoE) model with 671B parameters, of which 37B are activated for each token.

近年来，大型语言模型(LLM)正在经历快速的迭代与演进(Anthropic, 2024; Google, 2024; OpenAI, 2024a)，逐步缩小与通用人工智能(AGI)之间的差距。除了闭源模型之外，开源模型也在取得显著进展，包括 DeepSeek 系列(DeepSeek-AI, 2024a,b,c; Guo et al., 2024)、LLaMA 系列(AI@Meta, 2024a,b; Touvron et al., 2023a,b)、Qwen 系列(Qwen, 2023, 2024a,b)和 Mistral 系列(Jiang et al., 2023; Mistral, 2024)，都在努力缩小与闭源模型之间的差距。为了进一步推展开源模型的能力边界，我们扩大了模型规模并推出了 DeepSeek-V3，一个拥有 671B 参数的大型混合专家(MoE)模型，其中每个 token 激活 37B 参数。

With a forward-looking perspective, we consistently strive for strong model performance and economical costs. Therefore, in terms of architecture, DeepSeek-V3 still adopts Multi-head Latent Attention (MLA) (DeepSeek-AI, 2024c) for efficient inference and DeepSeekMoE (Dai et al., 2024) for cost-effective training. These two architectures have been validated in DeepSeek-V2 (DeepSeek-AI, 2024c), demonstrating their capability to maintain robust model performance while achieving efficient training and inference. Beyond the basic architecture, we implement two additional strategies to further enhance the model capabilities. Firstly, DeepSeek-V3 pioneers an auxiliary-loss-free strategy (Wang et al., 2024a) for load balancing, with the aim of minimizing the adverse impact on model performance that arises from the effort to encourage load balancing. Secondly, DeepSeek-V3 employs a multi-token prediction training objective, which we have observed to enhance the overall performance on evaluation benchmarks.

本着前瞻性的视角，我们始终致力于在强劲模型性能与经济性成本之间取得平衡。因此，在架构方面，DeepSeek-V3 继续采用 Multi-head Latent Attention(MLA)(DeepSeek-AI, 2024c)以实现高效推理，并采用 DeepSeekMoE(Dai et al., 2024)以实现经济训练。这两种架构已在 DeepSeek-V2(DeepSeek-AI, 2024c)中得到验证，证明了它们在保持稳健模型性能的同时实现高效训练与推理的能力。除了基础架构之外，我们还实施了两种额外策略以进一步增强模型能力。首先，DeepSeek-V3 开创性地提出了无辅助损失的负载均衡策略(Wang et al., 2024a)，旨在最小化因鼓励负载均衡而对模型性能产生的不利影响。其次，DeepSeek-V3 采用了多 token 预测训练目标，我们观察到这能提升评测基准上的整体性能。

> 译者注: MLA 和 DeepSeekMoE 是 DeepSeek-V2 验证过的两大核心架构。V3 没有推翻它们，而是继续沿用并在此基础上叠加了两个新策略：无辅助损失负载均衡和 MTP。这种"继承+增量创新"的研发思路值得注意——它不是每次从零设计新架构，而是在已验证的基石上渐进式优化。

In order to achieve efficient training, we support the FP8 mixed precision training and implement comprehensive optimizations for the training framework. Low-precision training has emerged as a promising solution for efficient training (Dettmers et al., 2022; Kalamkar et al., 2019; Narang et al., 2017; Peng et al., 2023b), its evolution being closely tied to advancements in hardware capabilities (Luo et al., 2024; Micikevicius et al., 2022; Rouhani et al., 2023a). In this work, we introduce an FP8 mixed precision training framework and, for the first time, validate its effectiveness on an extremely large-scale model. Through the support for FP8 computation and storage, we achieve both accelerated training and reduced GPU memory usage. As for the training framework, we design the DualPipe algorithm for efficient pipeline parallelism, which has fewer pipeline bubbles and hides most of the communication during training through computation-communication overlap. This overlap ensures that, as the model further scales up, as long as we maintain a constant computation-to-communication ratio, we can still employ fine-grained experts across nodes while achieving a near-zero all-to-all communication overhead. In addition, we also develop efficient cross-node all-to-all communication kernels to fully utilize InfiniBand (IB) and NVLink bandwidths. Furthermore, we meticulously optimize the memory footprint, making it possible to train DeepSeek-V3 without using costly tensor parallelism. Combining these efforts, we achieve high training efficiency.

为了实现高效训练，我们支持 FP8 混合精度训练，并对训练框架实施了全面的优化。低精度训练已成为高效训练的有前途的解决方案(Dettmers et al., 2022; Kalamkar et al., 2019; Narang et al., 2017; Peng et al., 2023b)，其发展与硬件能力的进步密切相关(Luo et al., 2024; Micikevicius et al., 2022; Rouhani et al., 2023a)。在这项工作中，我们引入了 FP8 混合精度训练框架，并首次在极大规模模型上验证了其有效性。通过支持 FP8 计算和存储，我们实现了训练加速和 GPU 内存使用的减少。至于训练框架，我们设计了 DualPipe 算法以实现高效的流水线并行，它具有更少的流水线气泡，并通过计算-通信重叠在训练期间隐藏了大部分通信。这种重叠确保了，随着模型进一步扩展，只要我们保持恒定的计算-通信比，我们仍然可以跨节点使用细粒度专家，同时实现接近零的 all-to-all 通信开销。此外，我们还开发了高效的跨节点 all-to-all 通信内核，以充分利用 InfiniBand(IB)和 NVLink 带宽。再者，我们精心优化了内存占用，使得不使用昂贵的张量并行(TP)也能训练 DeepSeek-V3。综合这些努力，我们实现了高效的训练效率。

> 译者注: FP8 训练在 H100/H200 上才能获得原生硬件支持，A100 不支持。DeepSeek 团队首次在 671B 规模的模型上验证 FP8 训练的可行性，这需要对量化策略做非常精细的设计——否则梯度下溢会导致训练崩溃。DualPipe 的设计核心洞察是"计算-通信重叠"：既然通信不可避免，那就让计算和通信同时进行，用计算掩盖通信延迟。

During pre-training, we train DeepSeek-V3 on 14.8T high-quality and diverse tokens. The pre-training process is remarkably stable. Throughout the entire training process, we did not encounter any irrecoverable loss spikes or have to roll back. Next, we conduct a two-stage context length extension for DeepSeek-V3. In the first stage, the maximum context length is extended to 32K, and in the second stage, it is further extended to 128K. Following this, we conduct post-training, including Supervised Fine-Tuning (SFT) and Reinforcement Learning (RL) on the base model of DeepSeek-V3, to align it with human preferences and further unlock its potential. During the post-training stage, we distill the reasoning capability from the DeepSeek-R1 series of models, and meanwhile carefully maintain the balance between model accuracy

在预训练阶段，我们在 14.8T 高质量且多样化的 token 上训练 DeepSeek-V3。预训练过程异常稳定。在整个训练过程中，我们没有遇到任何不可恢复的损失尖峰，也无需回滚。接下来，我们对 DeepSeek-V3 进行两阶段上下文长度扩展。第一阶段将最大上下文长度扩展到 32K，第二阶段进一步扩展到 128K。此后，我们对 DeepSeek-V3 的基础模型进行后训练，包括监督微调(SFT)和强化学习(RL)，以使其与人类偏好对齐并进一步释放其潜力。在后训练阶段，我们从 DeepSeek-R1 系列模型中蒸馏推理能力，同时仔细保持模型准确率

<table><tr><td>Training Costs</td><td>Pre-Training</td><td>Context Extension</td><td>Post-Training</td><td>Total</td></tr><tr><td>in H800 GPU Hours</td><td>2664K</td><td>119K</td><td>5K</td><td>2788K</td></tr><tr><td> in USD</td><td>$5.328M</td><td>$0.238M</td><td>$0.01M</td><td>$5.576M</td></tr></table>

Table 1 
| Training costs of DeepSeek-V3, assuming the rental price of H800 is $2 per GPU hour.

> 表 1: DeepSeek-V3 的训练成本，假设 H800 的租赁价格为每小时 2 美元。

and generation length.

与生成长度之间的平衡。

We evaluate DeepSeek-V3 on a comprehensive array of benchmarks. Despite its economical training costs, comprehensive evaluations reveal that DeepSeek-V3-Base has emerged as the strongest open-source base model currently available, especially in code and math. Its chat version also outperforms other open-source models and achieves performance comparable to leading closed-source models, including GPT-4o and Claude-3.5-Sonnet, on a series of标准 and open-ended benchmarks.

我们在全面的基准测试阵列上评估了 DeepSeek-V3。尽管训练成本经济，全面评估表明 DeepSeek-V3-Base 已成为目前可用的最强开源基础模型，尤其在代码和数学方面。其对话版本也超越了其他开源模型，在一系列标准和开放式基准测试上取得了与领先闭源模型(包括 GPT-4o 和 Claude-3.5-Sonnet)相当的性能。

> 译者注: "最强开源基础模型"这个定位需要放在具体语境下理解。V3-Base 在代码和数学上的优势，很大程度上得益于 MTP 训练目标和高质量的代码/数学预训练数据。但在知识类基准(MMLU 等)上，它与 GPT-4o 的差距仍然存在。"与闭源模型相当"是一个整体性的概括，具体任务上的表现分布并不均匀。

Lastly, we emphasize again the economical training costs of DeepSeek-V3, summarized in Table 1, achieved through our optimized co-design of algorithms, frameworks, and hardware. During the pre-training stage, training DeepSeek-V3 on each trillion tokens requires only 180K H800 GPU hours, i.e., 3.7 days on our cluster with 2048 H800 GPUs. Consequently, our pretraining stage is completed in less than two months and costs 2664K GPU hours. Combined with 119K GPU hours for the context length extension and 5K GPU hours for post-training, DeepSeek-V3 costs only 2.788M GPU hours for its full training. Assuming the rental price of the H800 GPU is $2 per GPU hour, our total training costs amount to only $5.576M. Note that the aforementioned costs include only the official training of DeepSeek-V3, excluding the costs associated with prior research and ablation experiments on architectures, algorithms, or data.

最后，我们再次强调 DeepSeek-V3 的经济性训练成本，如表 1 所示，这是通过我们在算法、框架和硬件上的优化协同设计实现的。在预训练阶段，每训练一万亿个 token 仅需 180K H800 GPU 小时，即在我们拥有 2048 块 H800 GPU 的集群上仅需 3.7 天。因此，我们的预训练阶段在不到两个月内完成，耗费 2664K GPU 小时。加上上下文长度扩展的 119K GPU 小时和后训练的 5K GPU 小时，DeepSeek-V3 的完整训练仅需 2.788M GPU 小时。假设 H800 GPU 的租赁价格为每小时 2 美元，我们的总训练成本仅为 557.6 万美元。请注意，上述成本仅包括 DeepSeek-V3 的官方训练，不包括与架构、算法或数据的先行研究和消融实验相关的成本。

> 译者注: 557.6 万美元的训练成本是一个极具冲击力的数字。但需要明确两点：第一，这仅是"官方训练"成本，前期的架构探索、数据清洗、消融实验等研究成本未计入，实际研发总成本可能数倍于此; 第二，2048 块 H800 的集群本身就需要数千万美元的硬件投入。这个成本数字更适合理解为"在已有基础设施上的边际训练成本"。

Our main contribution includes:

我们的主要贡献包括:

## Architecture: Innovative Load Balancing Strategy and Training Objective

架构: 创新的负载均衡策略与训练目标

- On top of the efficient architecture of DeepSeek-V2, we pioneer an auxiliary-loss-free strategy for load balancing, which minimizes the performance degradation that arises from encouraging load balancing.

- 在 DeepSeek-V2 的高效架构之上，我们开创性地提出了无辅助损失的负载均衡策略，最小化因鼓励负载均衡而导致的性能下降。

- We investigate a Multi-Token Prediction (MTP) objective and prove it beneficial to model performance. It can also be used for speculative decoding for inference acceleration.

- 我们研究了 Multi-Token Prediction(MTP)目标，并证明其对模型性能有益。它还可用于投机解码以加速推理。

## Pre-Training: Towards Ultimate Training Efficiency

预训练: 迈向极致训练效率

- We design an FP8 mixed precision training framework and, for the first time, validate the feasibility and effectiveness of FP8 training on an extremely large-scale model.

- 我们设计了 FP8 混合精度训练框架，并首次在极大规模模型上验证 FP8 训练的可行性和有效性。

- Through the co-design of algorithms, frameworks, and hardware, we overcome the communication bottleneck in cross-node MoE training, achieving near-full computation-communication overlap. This significantly enhances our training efficiency and reduces the training costs, enabling us to further scale up the model size without additional overhead.

- 通过算法、框架和硬件的协同设计，我们克服了跨节点 MoE 训练中的通信瓶颈，实现了接近完全的计算-通信重叠。这显著提升了训练效率并降低了训练成本，使我们能够在无额外开销的情况下进一步扩展模型规模。

- At an economical cost of only 2.664M H800 GPU hours, we complete the pre-training of DeepSeek-V3 on 14.8T tokens, producing the currently strongest open-source base model. The subsequent training stages after pre-training require only 0.1M GPU hours.

- 以仅 266.4 万 H800 GPU 小时的经济成本，我们完成了 DeepSeek-V3 在 14.8T token 上的预训练，产出了当前最强的开源基础模型。预训练之后的后续训练阶段仅需 10 万 GPU 小时。

## Post-Training: Knowledge Distillation from DeepSeek-R1

后训练: 从 DeepSeek-R1 进行知识蒸馏

- We introduce an innovative methodology to distill reasoning capabilities from the long-Chain-of-Thought (CoT) model, specifically from one of the DeepSeek R1 series models, into standard LLMs, particularly DeepSeek-V3. Our pipeline elegantly incorporates the

- 我们引入了一种创新的方法，将推理能力从长思维链(CoT)模型——具体来说是 DeepSeek R1 系列模型之一——蒸馏到标准 LLM 中，特别是 DeepSeek-V3。我们的流程优雅地融合了

verification and reflection patterns of R1 into DeepSeek-V3 and notably improves its reasoning performance. Meanwhile, we also maintain control over the output style and length of DeepSeek-V3.

R1 的验证和反思模式到 DeepSeek-V3 中，显著提升了其推理性能。同时，我们也保持了对 DeepSeek-V3 输出风格和长度的控制。

## Summary of Core Evaluation Results

核心评估结果总结

- Knowledge: (1) On educational benchmarks such as MMLU, MMLU-Pro, and GPQA, DeepSeek-V3 outperforms all other open-source models, achieving 88.5 on MMLU, 75.9 on MMLU-Pro, and 59.1 on GPQA. Its performance is comparable to leading closed-source models like GPT-4o and Claude-Sonnet-3.5, narrowing the gap between open-source and closed-source models in this domain. (2) For factuality benchmarks, DeepSeek-V3 demonstrates superior performance among open-source models on both SimpleQA and Chinese SimpleQA. While it trails behind GPT-4o and Claude-Sonnet-3.5 in English factual knowledge (SimpleQA), it surpasses these models in Chinese factual knowledge (Chinese SimpleQA), highlighting its strength in Chinese factual knowledge.

- 知识: (1) 在教育类基准测试如 MMLU、MMLU-Pro 和 GPQA 上，DeepSeek-V3 超越了所有其他开源模型，在 MMLU 上取得 88.5 分，MMLU-Pro 上 75.9 分，GPQA 上 59.1 分。其性能可与 GPT-4o 和 Claude-Sonnet-3.5 等领先闭源模型媲美，缩小了开源与闭源模型在该领域的差距。(2) 在事实性基准测试中，DeepSeek-V3 在 SimpleQA 和 Chinese SimpleQA 上都展现了开源模型中的优越性能。虽然在英文事实知识(SimpleQA)上落后于 GPT-4o 和 Claude-Sonnet-3.5，但在中文事实知识(Chinese SimpleQA)上超越了这些模型，凸显了其在中文事实知识上的优势。

- Code, Math, and Reasoning: (1) DeepSeek-V3 achieves state-of-the-art performance on math-related benchmarks among all non-long-CoT open-source and closed-source models. Notably, it even outperforms o1-preview on specific benchmarks, such as MATH-500, demonstrating its robust mathematical reasoning capabilities. (2) On coding-related tasks, DeepSeek-V3 emerges as the top-performing model for coding竞赛 benchmarks, such as LiveCodeBench, solidifying its position as the leading model in this domain. For engineering-related tasks, while DeepSeek-V3 performs slightly below Claude-Sonnet-3.5, it still outpaces all other models by a significant margin, demonstrating its competitiveness across diverse technical benchmarks.

- 代码、数学与推理: (1) DeepSeek-V3 在所有非长思维链(non-long-CoT)开源和闭源模型中，在数学相关基准测试上达到了最先进的性能。值得注意的是，它甚至在特定基准测试(如 MATH-500)上超越了 o1-preview，展示了其强大的数学推理能力。(2) 在代码相关任务上，DeepSeek-V3 成为编码竞赛基准测试(如 LiveCodeBench)中表现最佳的模型，巩固了其在该领域的领先地位。对于工程相关任务，虽然 DeepSeek-V3 的表现略低于 Claude-Sonnet-3.5，但仍以显著优势超越所有其他模型，展示了其在多样化技术基准测试中的竞争力。

In the remainder of this paper, we first present a detailed exposition of our DeepSeek-V3 model architecture (Section 2). Subsequently, we introduce our infrastructures, encompassing our compute clusters, the training framework, the support for FP8 training, the inference deployment strategy, and our suggestions on future hardware design. Next, we describe our pre-training process, including the construction of training data, hyper-parameter settings, long-context extension techniques, the associated evaluations, as well as some discussions (Section 4). Thereafter, we discuss our efforts on post-training, which include Supervised Fine-Tuning (SFT), Reinforcement Learning (RL), the corresponding evaluations, and discussions (Section 5). Lastly, we conclude this work, discuss existing limitations of DeepSeek-V3, and propose potential directions for future research (Section 6).

在本文的其余部分，我们首先详细阐述 DeepSeek-V3 的模型架构(第 2 节)。随后，我们介绍基础设施，包括计算集群、训练框架、FP8 训练支持、推理部署策略以及对未来硬件设计的建议。接下来，我们描述预训练过程，包括训练数据构建、超参数设置、长上下文扩展技术、相关评估以及一些讨论(第 4 节)。之后，我们讨论后训练方面的工作，包括监督微调(SFT)、强化学习(RL)、相应评估和讨论(第 5 节)。最后，我们总结这项工作，讨论 DeepSeek-V3 的现有局限性，并提出未来研究的潜在方向(第 6 节)。


## 2. Architecture

We first introduce the basic architecture of DeepSeek-V3, featured by Multi-head Latent Attention (MLA) (DeepSeek-AI, 2024c) for efficient inference and DeepSeekMoE (Dai et al., 2024) for economical training. Then, we present a Multi-Token Prediction (MTP) training objective, which we have observed to enhance the overall performance on evaluation benchmarks. For other minor details not explicitly mentioned, DeepSeek-V3 adheres to the settings of DeepSeek-V2 (DeepSeek-AI, 2024c).

我们首先介绍 DeepSeek-V3 的基础架构, 它以 Multi-head Latent Attention (MLA) (DeepSeek-AI, 2024c) 实现高效推理, 并以 DeepSeekMoE (Dai et al., 2024) 实现经济训练. 然后, 我们介绍 Multi-Token Prediction (MTP) 训练目标, 我们观察到它能提升评测基准上的整体性能. 对于其他未明确提及的细节, DeepSeek-V3 遵循 DeepSeek-V2 (DeepSeek-AI, 2024c) 的设置.

> 译者注: V3 的架构设计体现了"继承优于重构"的工程哲学. MLA 和 DeepSeekMoE 均来自 V2 的验证成果, V3 并未为了创新而创新, 而是在稳固基础上叠加 MTP 和无辅助损失负载均衡两项改进. 这种渐进式演进降低了研发风险, 也缩短了从实验到生产的周期.

### 2.1. Basic Architecture

The basic architecture of DeepSeek-V3 is still within the Transformer (Vaswani et al., 2017) framework. For efficient inference and economical training, DeepSeek-V3 also adopts MLA and DeepSeekMoE, which have been thoroughly validated by DeepSeek-V2. Compared with DeepSeek-V2, an exception is that we additionally introduce an auxiliary-loss-free load balancing strategy (Wang et al., 2024a) for DeepSeekMoE to mitigate the performance degradation induced by the effort to ensure load balance. Figure 2 illustrates the basic architecture of DeepSeek-V3, and we will briefly review the details of MLA and DeepSeekMoE in this section.

DeepSeek-V3 的基础架构仍属于 Transformer (Vaswani et al., 2017) 框架. 为了实现高效推理和经济训练, DeepSeek-V3 同样采用了已在 DeepSeek-V2 中得到充分验证的 MLA 和 DeepSeekMoE. 与 DeepSeek-V2 相比, 一个例外是我们为 DeepSeekMoE 额外引入了一种无辅助损失的负载均衡策略 (Wang et al., 2024a), 以缓解因确保负载均衡而导致的性能下降. 图 2 展示了 DeepSeek-V3 的基础架构, 本节将简要回顾 MLA 和 DeepSeekMoE 的细节.

![](images/fig02_basic_architecture.jpg)  
Figure 2 | Illustration of the basic architecture of DeepSeek-V3. Following DeepSeek-V2, we adopt MLA and DeepSeekMoE for efficient inference and economical training.

> 图 2: DeepSeek-V3 基础架构示意图. 遵循 DeepSeek-V2, 我们采用 MLA 和 DeepSeekMoE 以实现高效推理和经济训练.

#### 2.1.1. Multi-Head Latent Attention

For attention, DeepSeek-V3 adopts the MLA architecture. Let $d$ denote the embedding dimension, $n_h$ denote the number of attention heads, $d_h$ denote the dimension per head, and $\mathbf{h}_t \in \mathbb{R}^{d}$ denote the attention input for the $t$-th token at a given attention layer. The core of MLA is the low-rank joint compression for attention keys and values to reduce Key-Value (KV) cache during inference:

在注意力机制方面, DeepSeek-V3 采用 MLA 架构. 设 $d$ 为嵌入维度, $n_h$ 为注意力头数, $d_h$ 为每头维度, $\mathbf{h}_t \in \mathbb{R}^{d}$ 为给定注意力层中第 $t$ 个 token 的注意力输入. MLA 的核心是对注意力 key 和 value 进行低秩联合压缩, 以减少推理期间的 Key-Value (KV) Cache:

$$
\left\lceil \mathbf { c } _ { t } ^ { K V } \right\rceil = W ^ { D K V } \mathbf { h } _ { t } ,\tag{1}
$$

$$
[ \mathbf { k } _ { t , 1 } ^ { C } ; \mathbf { k } _ { t , 2 } ^ { C } ; . . . ; \mathbf { k } _ { t , n _ { h } } ^ { C } ] = \mathbf { k } _ { t } ^ { C } = W ^ { U K } \mathbf { c } _ { t } ^ { K V } ,\tag{2}
$$

$$
\boxed { \mathbf { k } _ { t } ^ { R } } = \mathrm { R o P E } ( W ^ { K R } \mathbf { h } _ { t } ) ,\tag{3}
$$

$$
\mathbf { k } _ { t , i } = [ \mathbf { k } _ { t , i } ^ { C } ; \mathbf { k } _ { t } ^ { R } ] ,\tag{4}
$$

$$
[ \mathbf { v } _ { t , 1 } ^ { C } ; \mathbf { v } _ { t , 2 } ^ { C } ; . . . ; \mathbf { v } _ { t , n _ { h } } ^ { C } ] = \mathbf { v } _ { t } ^ { C } = W ^ { U V } \mathbf { c } _ { t } ^ { K V } ,\tag{5}
$$

where $\mathbf { c } _ { t } ^ { K V } \in \mathbb { R } ^ { d _ { c } }$ is the compressed latent vector for keys and values; $d _ { c } ( \ll d _ { h } n _ { h } )$ indicates the KV compression dimension; $\mathring { W } ^ { D K V } \in \mathbb { R } ^ { d _ { c } \times d }$ denotes the down-projection matrix; $W ^ { \bar { U } K } , W ^ { U V } \in \mathbb { R } ^ { d _ { h } n _ { h } \times d _ { c } }$ are the up-projection matrices for keys and values, respectively; $W ^ { K R } \in \mathbb { R } ^ { d _ { h } ^ { R } \times d }$ is the matrix used to produce the decoupled key that carries Rotary Positional Embedding (RoPE) (Su et al., 2024); RoPE(·) denotes the operation that applies RoPE matrices; and $[ \cdot ; \cdot ]$ denotes concatenation. Note that for MLA, only the blue-boxed vectors $( \mathrm { i . e . , } \mathbf { c } _ { t } ^ { K V }$ and $\mathbf { k } _ { t } ^ { R } )$ need to be cached during generation, which results in significantly reduced KV cache while maintaining performance comparable to standard Multi-Head Attention (MHA) (Vaswani et al., 2017).

其中 $\mathbf { c } _ { t } ^ { K V } \in \mathbb { R } ^ { d _ { c } }$ 是 key 和 value 的压缩潜在向量; $d _ { c } ( \ll d _ { h } n _ { h } )$ 表示 KV 压缩维度; $\mathring { W } ^ { D K V } \in \mathbb { R } ^ { d _ { c } \times d }$ 表示下投影矩阵; $W ^ { \bar { U } K } , W ^ { U V } \in \mathbb { R } ^ { d _ { h } n _ { h } \times d _ { c } }$ 分别为 key 和 value 的上投影矩阵; $W ^ { K R } \in \mathbb { R } ^ { d _ { h } ^ { R } \times d }$ 是用于生成携带 Rotary Positional Embedding (RoPE) (Su et al., 2024) 的解耦 key 的矩阵; RoPE(·) 表示应用 RoPE 矩阵的操作; $[ \cdot ; \cdot ]$ 表示拼接. 注意, 对于 MLA, 生成期间只需缓存蓝框标记的向量 $( \mathrm { i . e . , } \mathbf { c } _ { t } ^ { K V }$ and $\mathbf { k } _ { t } ^ { R } )$, 这显著减少了 KV Cache, 同时保持了与标准 Multi-Head Attention (MHA) (Vaswani et al., 2017) 相当的性能.

> 译者注: MLA 的设计动机源于一个工程观察: 推理瓶颈往往不是计算而是内存带宽, 尤其是 KV Cache 的存储和传输. 标准 MHA 中 KV Cache 随层数和头数线性增长, 而 MLA 通过低秩压缩将每 token 的缓存量从 $O(d_h n_h)$ 降到 $O(d_c + d_h^R)$. 这种压缩不会显著损失精度, 因为注意力 key 和 value 本身存在高度冗余, 低秩假设在 Transformer 各层中基本成立.

For the attention queries, we also perform a low-rank compression, which can reduce the activation memory during training:

对于注意力 query, 我们也执行低秩压缩, 这可以减少训练期间的激活内存:

$$
\mathbf { c } _ { t } ^ { Q } = { W } ^ { D Q } \mathbf { h } _ { t } ,\tag{6}
$$

$$
[ \mathbf { q } _ { t , 1 } ^ { C } ; \mathbf { q } _ { t , 2 } ^ { C } ; . . . ; \mathbf { q } _ { t , n _ { h } } ^ { C } ] = \mathbf { q } _ { t } ^ { C } = W ^ { U Q } \mathbf { c } _ { t } ^ { Q } ,\tag{7}
$$

$$
[ \mathbf { q } _ { t , 1 } ^ { R } ; \mathbf { q } _ { t , 2 } ^ { R } ; . . . ; \mathbf { q } _ { t , n _ { h } } ^ { R } ] = \mathbf { q } _ { t } ^ { R } = \mathrm { R o P E } ( W ^ { Q R } \mathbf { c } _ { t } ^ { Q } ) ,\tag{8}
$$

$$
\mathbf { q } _ { t , i } = [ \mathbf { q } _ { t , i } ^ { C } ; \mathbf { q } _ { t , i } ^ { R } ] ,\tag{9}
$$

where $\mathbf { c } _ { t } ^ { Q } \in \mathbb { R } ^ { d _ { c } ^ { \prime } }$ is the compressed latent vector for queries; $d _ { c } ^ { \prime } ( \ll \ d _ { h } n _ { h } )$ denotes the query compression dimension; $W ^ { D \hat { Q } } \in \mathbb { R } ^ { d _ { c } ^ { \prime } \times d } , W ^ { U Q } \in \mathbb { R } ^ { d _ { h } n _ { h } \times d _ { c } ^ { \prime } }$ are the down-projection and up-projection matrices for queries, respectively; and $W ^ { Q R } \in \mathbb { R } ^ { d _ { h } ^ { R } n _ { h } \times d _ { c } ^ { \prime } }$ is the matrix to produce the decoupled queries that carry RoPE.

其中 $\mathbf { c } _ { t } ^ { Q } \in \mathbb { R } ^ { d _ { c } ^ { \prime } }$ 是 query 的压缩潜在向量; $d _ { c } ^ { \prime } ( \ll \ d _ { h } n _ { h } )$ 表示 query 压缩维度; $W ^ { D \hat { Q } } \in \mathbb { R } ^ { d _ { c } ^ { \prime } \times d } , W ^ { U Q } \in \mathbb { R } ^ { d _ { h } n _ { h } \times d _ { c } ^ { \prime } }$ 分别为 query 的下投影和上投影矩阵; $W ^ { Q R } \in \mathbb { R } ^ { d _ { h } ^ { R } n _ { h } \times d _ { c } ^ { \prime } }$ 是用于生成携带 RoPE 的解耦 query 的矩阵.

Ultimately, the attention queries $( \mathbf { q } _ { t , i } )$ , keys $( \mathbf { k } _ { j , i } )$ , and values $( \mathbf { v } _ { j , i } ^ { C } )$ are combined to yield the final attention output ${ \bf { u } } _ { t } .$

最终, 注意力 query $( \mathbf { q } _ { t , i } )$, key $( \mathbf { k } _ { j , i } )$ 和 value $( \mathbf { v } _ { j , i } ^ { C } )$ 被组合以产生最终的注意力输出 ${ \bf { u } } _ { t }$.

$$
{ \bf 0 } _ { t , i } = \sum _ { j = 1 } ^ { t } \mathrm { S o f t m a x } _ { j } ( \frac { { \bf q } _ { t , i } ^ { T } { \bf k } _ { j , i } } { \sqrt { d _ { h } + d _ { h } ^ { R } } } ) { \bf v } _ { j , i } ^ { C } ,\tag{10}
$$

$$
\mathbf { u } _ { t } = W ^ { O } [ \mathbf { o } _ { t , 1 } ; \mathbf { o } _ { t , 2 } ; . . . ; \mathbf { o } _ { t , n _ { h } } ] ,\tag{11}
$$

where $W ^ { O } \in \mathbb { R } ^ { d \times d _ { h } n _ { h } }$ denotes the output projection matrix.

其中 $W ^ { O } \in \mathbb { R } ^ { d \times d _ { h } n _ { h } }$ 表示输出投影矩阵.

#### 2.1.2. DeepSeekMoE with Auxiliary-Loss-Free Load Balancing

Basic Architecture of DeepSeekMoE. For Feed-Forward Networks (FFNs), DeepSeek-V3 employs the DeepSeekMoE architecture (Dai et al., 2024). Compared with traditional MoE architectures like GShard (Lepikhin et al., 2021), DeepSeekMoE uses finer-grained experts and isolates some experts as shared ones. Let $\mathbf{u}_t$ denote the FFN input of the $t$-th token, we compute the FFN output $\mathbf{h}_t^{\prime}$ as follows:

DeepSeekMoE 基础架构. 对于 Feed-Forward Networks (FFNs), DeepSeek-V3 采用 DeepSeekMoE 架构 (Dai et al., 2024). 与传统 MoE 架构(如 GShard (Lepikhin et al., 2021))相比, DeepSeekMoE 使用更细粒度的专家, 并将部分专家隔离为共享专家. 设 $\mathbf{u}_t$ 为第 $t$ 个 token 的 FFN 输入, 我们按如下方式计算 FFN 输出 $\mathbf{h}_t^{\prime}$:

$$
\mathbf { h } _ { t } ^ { \prime } = \mathbf { u } _ { t } + \sum _ { i = 1 } ^ { N _ { s } } \mathrm { F F N } _ { i } ^ { ( s ) } \left( \mathbf { u } _ { t } \right) + \sum _ { i = 1 } ^ { N _ { r } } g _ { i , t } \mathrm { F F N } _ { i } ^ { ( r ) } \left( \mathbf { u } _ { t } \right) ,\tag{12}
$$

$$
g _ { i , t } = { \frac { g _ { i , t } ^ { \prime } } { \sum _ { j = 1 } ^ { N _ { r } } g _ { j , t } ^ { \prime } } } ,\tag{13}
$$

$$
g _ { i , t } ^ { \prime } = \left\{ \begin{array} { l l } { s _ { i , t } , } & { s _ { i , t } \in \mathrm { T o p k } ( \{ s _ { j , t } | 1 \leqslant j \leqslant N _ { r } \} , K _ { r } ) , } \\ { 0 , } & { \mathrm { o t h e r w i s e } , } \end{array} \right.\tag{14}
$$

$$
{ \boldsymbol { s } } _ { i , t } = \mathrm { S i g m o i d } \left( \mathbf { u } _ { t } ^ { \boldsymbol { T } } \mathbf { e } _ { i } \right) ,\tag{15}
$$

where $N_s$ and $N_r$ denote the numbers of shared experts and routed experts, respectively; $\mathrm{FFN}_i^{(s)}(\cdot)$ and $\mathrm{FFN}_i^{(r)}(\cdot)$ denote the $i$-th shared expert and the $i$-th routed expert, respectively; $K_r$ denotes the number of activated routed experts; $g_{i,t}$ is the gating value for the $i$-th expert; $s_{i,t}$ is the token-to-expert affinity; $\mathbf{e}_i$ is the centroid vector of the $i$-th routed expert; and $\mathrm{Topk}(\cdot, K)$ denotes the set comprising $K$ highest scores among the affinity scores calculated for the $t$-th token and all routed experts. Slightly different from DeepSeek-V2, DeepSeek-V3 uses the sigmoid function to compute the affinity scores, and applies a normalization among all selected affinity scores to produce the gating values.

其中 $N_s$ 和 $N_r$ 分别表示共享专家和路由专家的数量; $\mathrm{FFN}_i^{(s)}(\cdot)$ 和 $\mathrm{FFN}_i^{(r)}(\cdot)$ 分别表示第 $i$ 个共享专家和第 $i$ 个路由专家; $K_r$ 表示激活的路由专家数量; $g_{i,t}$ 为第 $i$ 个专家的 gating value; $s_{i,t}$ 为 token-to-expert affinity; $\mathbf{e}_i$ 为第 $i$ 个路由专家的质心向量; $\mathrm{Topk}(\cdot, K)$ 表示在第 $t$ 个 token 与所有路由专家计算的 affinity scores 中取 $K$ 个最高分数构成的集合. 与 DeepSeek-V2 略有不同, DeepSeek-V3 使用 Sigmoid 函数计算 affinity scores, 并对所有选中的 affinity scores 进行归一化以产生 gating values.

> 译者注: 共享专家与路由专家的分离是 DeepSeekMoE 的一个关键设计. 共享专家负责捕获跨所有 token 的通用知识(如语法, 常见事实), 而路由专家专门处理特定语义模式的 token. 这种分离避免了所有专家都学习重复的基础知识, 从而提高了参数效率. V3 相对于 V2 的一个细微改动是将 affinity 计算从 Softmax 改为 Sigmoid 并做局部归一化, 这使得 gating value 的计算不再受未选中专家的影响, 路由决策更加稳定.

Auxiliary-Loss-Free Load Balancing. For MoE models, an unbalanced expert load will lead to routing collapse (Shazeer et al., 2017) and diminish computational efficiency in scenarios with expert parallelism. Conventional solutions usually rely on the auxiliary loss (Fedus et al., 2021; Lepikhin et al., 2021) to avoid unbalanced load. However, too large an auxiliary loss will impair the model performance (Wang et al., 2024a). To achieve a better trade-off between load balance and model performance, we pioneer an auxiliary-loss-free load balancing strategy (Wang et al., 2024a) to ensure load balance. To be specific, we introduce a bias term $b _ { i }$ for each expert and add it to the corresponding affinity scores $s _ { i , t }$ to determine the top-K routing:

无辅助损失负载均衡. 对于 MoE 模型, 不均匀的专家负载会导致 routing collapse (Shazeer et al., 2017), 并在专家并行场景下降低计算效率. 传统解决方案通常依赖辅助损失 (Fedus et al., 2021; Lepikhin et al., 2021) 来避免负载不均衡. 然而, 过大的辅助损失会损害模型性能 (Wang et al., 2024a). 为了在负载均衡与模型性能之间取得更好的权衡, 我们开创性地提出了无辅助损失负载均衡策略 (Wang et al., 2024a) 以确保负载均衡. 具体而言, 我们为每个专家引入一个偏置项 $b _ { i }$, 将其加到相应的 affinity score $s _ { i , t }$ 上以确定 top-K 路由:

$$
\begin{array} { r } { \boldsymbol { g } _ { i , t } ^ { \prime } = \left\{ \begin{array} { l l } { s _ { i , t } , } & { s _ { i , t } + b _ { i } \in \mathrm { T o p } \mathrm { k } ( \{ s _ { j , t } + b _ { j } | 1 \leqslant j \leqslant N _ { r } \} , K _ { r } ) , } \\ { 0 , } & { \mathrm { o t h e r w i s e } . } \end{array} \right. } \end{array}\tag{16}
$$

Note that the bias term is only used for routing. The gating value, which will be multiplied with the FFN output, is still derived from the original affinity score $s_{i,t}$. During training, we keep monitoring the expert load on the whole batch of each training step. At the end of each step, we will decrease the bias term by a fixed step if its corresponding expert is overloaded, and increase it by the same step if its corresponding expert is underloaded, where the step size is a hyper-parameter called bias update speed. Through the dynamic adjustment, DeepSeek-V3 keeps balanced expert load during training, and achieves better performance than models that encourage load balance through pure auxiliary losses.

注意, 偏置项仅用于路由. 将与 FFN 输出相乘的 gating value 仍从原始 affinity score $s_{i,t}$ 推导而来. 训练期间, 我们持续监控每个训练步骤整个 batch 上的专家负载. 在每个步骤结束时, 如果对应专家过载, 我们将偏置项按固定步长减小; 如果对应专家欠载, 则按同样的步长增大, 其中该步长是一个称为偏置更新速度的超参数. 通过这种动态调整, DeepSeek-V3 在训练期间保持均衡的专家负载, 并取得了比纯辅助损失促进负载均衡的模型更好的性能.

> 译者注: 无辅助损失负载均衡是 V3 最重要的架构创新之一. 其核心洞察是"解耦路由决策与门控值": 偏置项只影响"选哪个专家", 不影响"选中的专家输出乘多少". 这意味着负载均衡的调节不会直接干扰梯度流向专家网络的强度, 从而避免了辅助损失对模型性能的下拉. 该策略已在后续多个开源 MoE 模型中被借鉴, 成为社区共识性方案.

Complementary Sequence-Wise Auxiliary Loss. Although DeepSeek-V3 mainly relies on the auxiliary-loss-free strategy for load balance, to prevent extreme imbalance within any single sequence, we also employ a complementary sequence-wise balance loss:

互补的序列级辅助损失. 尽管 DeepSeek-V3 主要依赖无辅助损失策略实现负载均衡, 但为了防止单个序列内出现极端不均衡, 我们还采用了一种互补的序列级均衡损失:

$$
\mathcal { L } _ { \mathrm { B a l } } = \alpha \sum _ { i = 1 } ^ { N _ { r } } f _ { i } P _ { i } ,\tag{17}
$$

$$
f _ { i } = \frac { N _ { r } } { K _ { r } T } \sum _ { t = 1 } ^ { T } \Im \left( s _ { i , t } \in \mathrm { T o p k } ( \{ s _ { j , t } | 1 \leqslant j \leqslant N _ { r } \} , K _ { r } ) \right) ,\tag{18}
$$

$$
s _ { i , t } ^ { \prime } = \frac { s _ { i , t } } { \sum _ { j = 1 } ^ { N _ { r } } s _ { j , t } } ,\tag{19}
$$

$$
P _ { i } = \frac { 1 } { T } \sum _ { t = 1 } ^ { T } s _ { i , t } ^ { \prime } ,\tag{20}
$$

where the balance factor $\alpha$ is a hyper-parameter, which will be assigned an extremely small value for DeepSeek-V3; $\mathbf{1}(\cdot)$ denotes the indicator function; and $T$ denotes the number of tokens in a sequence. The sequence-wise balance loss encourages the expert load on each sequence to be balanced.

其中均衡因子 $\alpha$ 是一个超参数, 在 DeepSeek-V3 中将被赋予极小的值; $\mathbf{1}(\cdot)$ 表示指示函数; $T$ 表示序列中的 token 数量. 序列级均衡损失鼓励每个序列上的专家负载保持均衡.

![](images/fig03_mtp_implementation.jpg)  
Figure 3 | Illustration of our Multi-Token Prediction (MTP) implementation. We keep the complete causal chain for the prediction of each token at each depth.

> 图 3: 我们的 Multi-Token Prediction (MTP) 实现示意图. 我们在每个深度的每个 token 预测中保持完整的因果链.

Node-Limited Routing. Like the device-limited routing used by DeepSeek-V2, DeepSeek-V3 also uses a restricted routing mechanism to limit communication costs during training. In short, we ensure that each token will be sent to at most $M$ nodes, which are selected according to the sum of the highest $\frac{K_r}{M}$ affinity scores of the experts distributed on each node. Under this constraint, our MoE training framework can nearly achieve full computation-communication overlap.

节点受限路由. 与 DeepSeek-V2 使用的设备受限路由类似, DeepSeek-V3 也采用受限路由机制以限制训练期间的通信开销. 简而言之, 我们确保每个 token 最多被发送到 $M$ 个节点, 这些节点根据分布在各节点上的专家中最高的 $\frac{K_r}{M}$ 个 affinity score 之和来选择. 在此约束下, 我们的 MoE 训练框架几乎可以实现完全的计算-通信重叠.

No Token-Dropping. Due to the effective load balancing strategy, DeepSeek-V3 keeps a good load balance during its full training. Therefore, DeepSeek-V3 does not drop any tokens during training. In addition, we also implement specific deployment strategies to ensure inference load balance, so DeepSeek-V3 also does not drop tokens during inference.

无 Token 丢弃. 得益于有效的负载均衡策略, DeepSeek-V3 在整个训练期间保持良好的负载均衡. 因此, DeepSeek-V3 在训练期间不会丢弃任何 token. 此外, 我们还实现了特定的部署策略以确保推理负载均衡, 因此 DeepSeek-V3 在推理期间也不会丢弃 token.

### 2.2. Multi-Token Prediction

Inspired by Gloeckle et al. (2024), we investigate and set a Multi-Token Prediction (MTP) objective for DeepSeek-V3, which extends the prediction scope to multiple future tokens at each position. On the one hand, an MTP objective densifies the training signals and may improve data efficiency. On the other hand, MTP may enable the model to pre-plan its representations for better prediction of future tokens. Figure 3 illustrates our implementation of MTP. Different from Gloeckle et al. (2024), which parallelly predicts multiple additional tokens using independent output heads, we sequentially predict additional tokens and keep the complete causal chain at each prediction depth. We introduce the details of our MTP implementation in this section.

受 Gloeckle et al. (2024) 启发, 我们研究并为 DeepSeek-V3 设置了 Multi-Token Prediction (MTP) 目标, 将每个位置的预测范围扩展到多个未来 token. 一方面, MTP 目标加密了训练信号, 可能提高数据效率. 另一方面, MTP 可能使模型能够预先规划其表示, 以更好地预测未来 token. 图 3 展示了我们的 MTP 实现. 与 Gloeckle et al. (2024) 使用独立输出头并行预测多个额外 token 不同, 我们按顺序预测额外 token, 并在每个预测深度保持完整的因果链. 本节介绍我们 MTP 实现的细节.

MTP Modules. To be specific, our MTP implementation uses $D$ sequential modules to predict $D$ additional tokens. The $k$-th MTP module consists of a shared embedding layer Emb(·), a shared output head OutHead(·), a Transformer block $\mathrm { T R M } _ { k } ( \cdot )$ , and a projection matrix $M _ { k } \in \mathbb { R } ^ { d \times 2 d }$ . For the $i$-th input token $t _ { i }$, at the $k$-th prediction depth, we first combine the representation of the $i$-th token at the $(k-1)$-th depth $\mathbf { h } _ { i } ^ { k - 1 } \in \mathbb { R } ^ { d }$ and the embedding of the $(i+k)$-th token $\mathrm { E m b } ( t _ { i + k } ) \in \mathbb { R } ^ { d }$

MTP 模块. 具体而言, 我们的 MTP 实现使用 $D$ 个顺序模块来预测 $D$ 个额外 token. 第 $k$ 个 MTP 模块由共享嵌入层 Emb(·), 共享输出头 OutHead(·), Transformer 块 $\mathrm { T R M } _ { k } ( \cdot )$ 和投影矩阵 $M _ { k } \in \mathbb { R } ^ { d \times 2 d }$ 组成. 对于第 $i$ 个输入 token $t _ { i }$, 在第 $k$ 个预测深度, 我们首先将第 $i$ 个 token 在第 $(k - 1)$ 深度的表示 $\mathbf { h } _ { i } ^ { k - 1 } \in \mathbb { R } ^ { d }$ 与第 $(i + k)$ 个 token 的嵌入 $\mathrm { E m b } ( t _ { i + k } ) \in \mathbb { R } ^ { d }$ 进行组合

with the linear projection:

通过线性投影进行组合:

$$
\mathbf { h } _ { i } ^ { \prime k } = M _ { k } [ \mathrm { R M S N o r m } ( \mathbf { h } _ { i } ^ { k - 1 } ) ; \mathrm { R M S N o r m } ( \mathrm { E m b } ( t _ { i + k } ) ) ] ,\tag{21}
$$

where $[ \cdot ; \cdot ]$ denotes concatenation. Especially, when $k = 1 , \mathbf { h } _ { i } ^ { k - 1 }$ refers to the representation given by the main model. Note that for each MTP module, its embedding layer is shared with the main model. The combined $\mathbf { h } _ { i } ^ { \prime k }$ serves as the input of the Transformer block at the $k$-th depth to produce the output representation at the current depth $\mathbf { h } _ { i } ^ { k }$

其中 $[ \cdot ; \cdot ]$ 表示拼接. 特别地, 当 $k = 1$ 时, $\mathbf { h } _ { i } ^ { k - 1 }$ 指主模型给出的表示. 注意, 每个 MTP 模块的嵌入层与主模型共享. 组合后的 $\mathbf { h } _ { i } ^ { \prime k }$ 作为第 $k$ 深度 Transformer 块的输入, 以产生当前深度的输出表示 $\mathbf { h } _ { i } ^ { k }$

$$
\mathbf { h } _ { 1 : T - k } ^ { k } = \mathrm { T R M } _ { k } ( \mathbf { h } _ { 1 : T - k } ^ { \prime k } ) ,\tag{22}
$$

where $T$ represents the input sequence length and $i { : } j$ denotes the slicing operation (inclusive of both the left and right boundaries). Finally, taking $\mathbf { h } _ { i } ^ { k }$ as the input, the shared output head will compute the probability distribution for the $(k+1)$-th prediction token $P _ { i + 1 + k } ^ { k } \in \mathbb { R } ^ { V }$ , where $V$ is the vocabulary size:

其中 $T$ 表示输入序列长度, $i { : } j$ 表示切片操作(包含左右边界). 最后, 以 $\mathbf { h } _ { i } ^ { k }$ 为输入, 共享输出头将计算第 $(k+1)$ 个预测 token 的概率分布 $P _ { i + 1 + k } ^ { k } \in \mathbb { R } ^ { V }$, 其中 $V$ 为词汇表大小:

$$
P _ { i + k + 1 } ^ { k } = \mathrm { O u t H e a d } ( \mathbf { h } _ { i } ^ { k } ) .\tag{23}
$$

The output head OutHead(·) linearly maps the representation to logits and subsequently applies the Softmax(·) function to compute the prediction probabilities of the next target token. Also, for each MTP module, its output head is shared with the main model. Our principle of maintaining the causal chain of predictions is similar to that of EAGLE (Li et al., 2024b), but its primary objective is speculative decoding (Leviathan et al., 2023; Xia et al., 2023), whereas we utilize MTP to improve training.

输出头 OutHead(·) 将表示线性映射到 logits, 随后应用 Softmax(·) 函数计算下一个目标 token 的预测概率. 此外, 每个 MTP 模块的输出头也与主模型共享. 我们保持预测因果链的原则与 EAGLE (Li et al., 2024b) 类似, 但 EAGLE 的主要目标是投机解码 (Leviathan et al., 2023; Xia et al., 2023), 而我们利用 MTP 来改进训练.

> 译者注: MTP 的设计有两个互补的视角. 从训练信号角度看, 每个位置同时产生 D 个预测损失, 相当于在相同数据量上将监督信号密度提高了 D 倍, 这对数据效率有直接影响. 从表示学习角度看, 要求模型在每个位置预测未来多个 token, 相当于强制模型学习更具前瞻性的上下文表示, 而非仅优化对下一个 token 的局部拟合. 值得注意的是, 推理时 MTP 模块可被直接丢弃或复用于投机解码, 这种"训练时增强, 推理时零开销"的特性使其成为一个高性价比的改进.

MTP Training Objective. For each prediction depth, we compute a cross-entropy loss $\mathcal { L } _ { \mathrm { M T P } } ^ { k }$

MTP 训练目标. 对于每个预测深度, 我们计算一个交叉熵损失 $\mathcal { L } _ { \mathrm { M T P } } ^ { k }$

$$
\mathcal { L } _ { \mathrm { M T P } } ^ { k } = \mathrm { C r o s s E n t r o p y } ( P _ { 2 + k : T + 1 } ^ { k } , t _ { 2 + k : T + 1 } ) = - \frac { 1 } { T } \sum _ { i = 2 + k } ^ { T + 1 } \log P _ { i } ^ { k } [ t _ { i } ] ,\tag{24}
$$

where $T$ denotes the input sequence length, $t _ { i }$ denotes the ground-truth token at the $i$-th position, and $P _ { i } ^ { k } [ t _ { i } ]$ denotes the corresponding prediction probability of $t _ { i }$, given by the $k$-th MTP module. Finally, we compute the average of the MTP losses across all depths and multiply it by a weighting factor $\lambda$ to obtain the overall MTP loss ${ \mathcal { L } } _ { \mathrm { M T P } }$, which serves as an additional training objective for DeepSeek-V3:

其中 $T$ 表示输入序列长度, $t _ { i }$ 表示第 $i$ 个位置的真实 token, $P _ { i } ^ { k } [ t _ { i } ]$ 表示第 $k$ 个 MTP 模型给出的 $t _ { i }$ 的对应预测概率. 最后, 我们计算所有深度上 MTP 损失的平均值, 并将其乘以权重因子 $\lambda$ 以获得总体 MTP 损失 ${ \mathcal { L } } _ { \mathrm { M T P } }$, 作为 DeepSeek-V3 的额外训练目标:

$$
\mathcal { L } _ { \mathrm { M T P } } = \frac { \lambda } { D } \sum _ { k = 1 } ^ { D } \mathcal { L } _ { \mathrm { M T P } } ^ { k } .\tag{25}
$$

MTP in Inference. Our MTP strategy mainly aims to improve the performance of the main model, so during inference, we can directly discard the MTP modules and the main model can function independently and normally. Additionally, we can also repurpose these MTP modules for speculative decoding to further improve the generation latency.

MTP 在推理中的应用. 我们的 MTP 策略主要旨在提升主模型的性能, 因此在推理期间, 我们可以直接丢弃 MTP 模块, 主模型可以独立正常运行. 此外, 我们还可以将这些 MTP 模块重新用于投机解码, 以进一步降低生成延迟.

## 3. Infrastructures

### 3.1. Compute Clusters

DeepSeek-V3 is trained on a cluster equipped with 2048 NVIDIA H800 GPUs. Each node in the H800 cluster contains 8 GPUs connected by NVLink and NVSwitch within nodes. Across different nodes, InfiniBand (IB) interconnects are utilized to facilitate communications.

DeepSeek-V3 在一个配备 2048 块 NVIDIA H800 GPU 的集群上训练. H800 集群中的每个节点包含 8 块 GPU, 节点内通过 NVLink 和 NVSwitch 连接. 跨节点则利用 InfiniBand (IB) 互联来促进通信.

> 译者注: 2048 块 H800 是一个相对紧凑的集群规模. 作为对比, Meta 训练 Llama-3.1 405B 使用了约 16,000 块 H100. DeepSeek 能在小集群上完成大模型训练, 得益于极致的算法和工程优化, 而非单纯堆叠硬件. 这也解释了为什么 V3 的训练成本能控制在 557.6 万美元.

### 3.2. Training Framework

The training of DeepSeek-V3 is supported by the HAI-LLM framework, an efficient and lightweight training framework crafted by our engineers from the ground up. On the whole, DeepSeek-V3 applies 16-way Pipeline Parallelism (PP) (Qi et al., 2023a), 64-way Expert Parallelism (EP) (Lepikhin et al., 2021) spanning 8 nodes, and ZeRO-1 Data Parallelism (DP) (Rajbhandari et al., 2020).

DeepSeek-V3 的训练由 HAI-LLM 框架支持, 这是一个由我们的工程师从零开始打造的高效轻量级训练框架. 总体而言, DeepSeek-V3 采用 16 路流水线并行 (PP) (Qi et al., 2023a)、跨越 8 个节点的 64 路专家并行 (EP) (Lepikhin et al., 2021), 以及 ZeRO-1 数据并行 (DP) (Rajbhandari et al., 2020).

In order to facilitate efficient training of DeepSeek-V3, we implement meticulous engineering optimizations. Firstly, we design the DualPipe algorithm for efficient pipeline parallelism. Compared with existing PP methods, DualPipe has fewer pipeline bubbles. More importantly, it overlaps the computation and communication phases across forward and backward processes, thereby addressing the challenge of heavy communication overhead introduced by cross-node expert parallelism. Secondly, we develop efficient cross-node all-to-all communication kernels to fully utilize IB and NVLink bandwidths and conserve Streaming Multiprocessors (SMs) dedicated to communication. Finally, we meticulously optimize the memory footprint during training, thereby enabling us to train DeepSeek-V3 without using costly Tensor Parallelism (TP).

为了实现 DeepSeek-V3 的高效训练, 我们实施了精细的工程优化. 首先, 我们设计了 DualPipe 算法以实现高效的流水线并行. 与现有 PP 方法相比, DualPipe 具有更少的流水线气泡. 更重要的是, 它在前后向过程中重叠计算和通信阶段, 从而解决了跨节点专家并行引入的巨大通信开销挑战. 其次, 我们开发了高效的跨节点 all-to-all 通信内核, 以充分利用 IB 和 NVLink 带宽, 并节省专用于通信的流式多处理器 (SM). 最后, 我们精细优化了训练期间的内存占用, 使我们能够在不使用昂贵的张量并行 (TP) 的情况下训练 DeepSeek-V3.

> 译者注: 不使用 TP 是一个非常重要的工程决策. 传统大模型训练通常采用 TP (将每层切分到多个 GPU) 来减少单卡显存压力, 但 TP 会引入大量的 intra-node 通信(通过 NVLink), 且会限制 batch size. DeepSeek-V3 通过 MLA(减少 KV Cache)、DeepSeekMoE(稀疏激活)、FP8(降低精度)和精细的内存优化, 成功避免了 TP, 这是其实现高训练效率的关键因素之一.

#### 3.2.1. DualPipe and Computation-Communication Overlap

For DeepSeek-V3, the communication overhead introduced by cross-node expert parallelism results in an inefficient computation-to-communication ratio of approximately 1:1. To tackle this challenge, we design an innovative pipeline parallelism algorithm called DualPipe, which not only accelerates model training by effectively overlapping forward and backward computation-communication phases, but also reduces the pipeline bubbles.

对于 DeepSeek-V3, 跨节点专家并行引入的通信开销导致计算-通信比约为 1:1, 效率低下. 为了解决这一挑战, 我们设计了一种创新的流水线并行算法 DualPipe, 它不仅通过有效重叠前向和后向的计算-通信阶段来加速模型训练, 还减少了流水线气泡.

The key idea of DualPipe is to overlap the computation and communication within a pair of individual forward and backward chunks. To be specific, we divide each chunk into four components: attention, all-to-all dispatch, MLP, and all-to-all combine. Specially, for a backward chunk, both attention and MLP are further split into two parts, backward for input and backward for weights, like in ZeroBubble (Qi et al., 2023b). In addition, we have a PP communication component. As illustrated in Figure 4, for a pair of forward and backward chunks, we rearrange these components and manually adjust the ratio of GPU SMs dedicated to communication versus computation. In this overlapping strategy, we can ensure that both all-to-all and PP communication can be fully hidden during execution. Given the efficient overlapping strategy, the full DualPipe scheduling is illustrated in Figure 5. It employs a bidirectional pipeline scheduling, which feeds micro-batches from both ends of the pipeline simultaneously and a significant portion of communications can be fully overlapped. This overlap also ensures that, as the model further scales up, as long as we maintain a constant computation-to-communication ratio, we can still employ fine-grained experts across nodes while achieving a near-zero all-to-all communication overhead.

DualPipe 的核心思想是在一对独立的前向和后向 chunk 内重叠计算和通信. 具体而言, 我们将每个 chunk 分为四个组件: attention、all-to-all dispatch、MLP 和 all-to-all combine. 特别地, 对于后向 chunk, attention 和 MLP 都被进一步拆分为两部分: 输入梯度和权重梯度, 类似于 ZeroBubble (Qi et al., 2023b). 此外, 我们还有 PP 通信组件. 如图 4 所示, 对于一对前向和后向 chunk, 我们重新排列这些组件并手动调整专用于通信与计算的 GPU SM 比例. 在这种重叠策略中, 我们可以确保 all-to-all 和 PP 通信在执行期间都能被完全隐藏. 鉴于高效的重叠策略, 完整的 DualPipe 调度如图 5 所示. 它采用双向流水线调度, 同时从流水线两端喂入微批次, 并且大部分通信可以被完全重叠. 这种重叠还确保, 随着模型进一步扩展, 只要我们保持恒定的计算-通信比, 我们仍然可以跨节点采用细粒度专家, 同时实现接近零的 all-to-all 通信开销.

> 译者注: DualPipe 的精妙之处在于"双向流水线". 传统流水线(如 1F1B)只能从一端喂入微批次, 导致流水线填满和排空阶段产生大量气泡. DualPipe 从两端同时喂入, 使得气泡时间从 O(PP) 降到 O(PP/2). 更关键的是, 它将前向计算、后向计算和通信在时间上精细交错, 利用 SM 分区让计算和通信并行执行.

In addition, even in more general scenarios without a heavy communication burden, DualPipe still exhibits efficiency advantages. In Table 2, we summarize the pipeline bubbles and memory usage across different PP methods. As shown in the table, compared with ZB1P (Qi et al., 2023b) and 1F1B (Harlap et al., 2018), DualPipe significantly reduces the pipeline bubbles while only increasing the peak activation memory by 1/PP times. Although DualPipe requires keeping two copies of the model parameters, this does not significantly increase the memory consumption since we use a large EP size during training. Compared with Chimera (Li and Hoefler, 2021), DualPipe only requires that the pipeline stages and micro-batches be divisible by 2, without requiring micro-batches to be divisible by pipeline stages.

此外, 即使在通信负担不重的更一般场景中, DualPipe 仍然表现出效率优势. 在表 2 中, 我们总结了不同 PP 方法的流水线气泡和内存使用. 如表所示, 与 ZB1P (Qi et al., 2023b) 和 1F1B (Harlap et al., 2018) 相比, DualPipe 显著减少了流水线气泡, 同时仅将峰值激活内存增加了 1/PP 倍. 尽管 DualPipe 需要保留两份模型参数, 但由于训练期间使用了较大的 EP 尺寸, 这并不会显著增加内存消耗. 与 Chimera (Li and Hoefler, 2021) 相比, DualPipe 仅要求流水线阶段和微批次可被 2 整除, 而不要求微批次可被流水线阶段数整除.

#### 3.2.2. Efficient Implementation of Cross-Node All-to-All Communication

In order to ensure sufficient computational performance for DualPipe, we customize efficient cross-node all-to-all communication kernels (including dispatching and combining) to conserve the number of SMs dedicated to communication. The implementation of the kernels is codesigned with the MoE gating algorithm and the network topology of our cluster. To be specific, in our cluster, cross-node GPUs are fully interconnected with IB, and intra-node communications are handled via NVLink. NVLink offers a bandwidth of 160 GB/s, roughly 3.2 times that of IB (50 GB/s). To effectively leverage the different bandwidths of IB and NVLink, we limit each token to be dispatched to at most 4 nodes, thereby reducing IB traffic. For each token, when its routing decision is made, it will first be transmitted via IB to the GPUs with the same in-node index on its target nodes. Once it reaches the target nodes, we will endeavor to ensure that it is instantaneously forwarded via NVLink to specific GPUs that host their target experts, without being blocked by subsequently arriving tokens. In this way, communications via IB and NVLink are fully overlapped, and each token can efficiently select an average of 3.2 experts per node without incurring additional overhead from NVLink. This implies that, although DeepSeek-V3 selects only 8 routed experts in practice, it can scale up this number to a maximum of 13 experts (4 nodes x 3.2 experts/node) while preserving the same communication cost.

为了确保 DualPipe 具有足够的计算性能, 我们定制了高效的跨节点 all-to-all 通信内核(包括 dispatch 和 combine)以节省专用于通信的 SM 数量. 这些内核的实现与 MoE 门控算法和集群的网络拓扑协同设计. 具体而言, 在我们的集群中, 跨节点 GPU 通过 IB 完全互联, 节点内通信通过 NVLink 处理. NVLink 提供 160 GB/s 的带宽, 大约是 IB (50 GB/s) 的 3.2 倍. 为了有效利用 IB 和 NVLink 的不同带宽, 我们将每个 token 限制为最多分发到 4 个节点, 从而减少 IB 流量. 对于每个 token, 当其路由决策做出后, 它首先通过 IB 传输到目标节点上具有相同节点内索引的 GPU. 一旦到达目标节点, 我们努力确保它通过 NVLink 即时转发到承载其目标专家的特定 GPU, 而不会被随后到达的 token 阻塞. 这样, IB 和 NVLink 通信完全重叠, 每个 token 可以高效地在每个节点选择平均 3.2 个专家, 而不会产生 NVLink 的额外开销. 这意味着, 尽管 DeepSeek-V3 在实践中仅选择 8 个路由专家, 但它可以将此数量扩展到最多 13 个专家(4 节点 x 3.2 专家/节点), 同时保持相同的通信成本.

> 译者注: 这是工程协同设计的典范. 他们充分利用了 IB 和 NVLink 的带宽差异: IB 是跨节点瓶颈(50GB/s), NVLink 是节点内高速通道(160GB/s). 通过限制每个 token 只去 4 个节点, IB 流量被控制; 而节点内利用 NVLink 的高带宽可以多选专家(3.2/节点). 这种设计使得通信内核仅需 20 个 SM 就能饱和所有网络带宽, 其余 SM 全部用于计算.

In detail, we employ the warp specialization technique (Bauer et al., 2014) and partition 20 SMs into 10 communication channels. During the dispatching process, (1) IB sending, (2) IB-to-NVLink forwarding, and (3) NVLink receiving are handled by respective warps. The number of warps allocated to each communication task is dynamically adjusted according to the actual workload across all SMs. Similarly, during the combining process, (1) NVLink sending, (2) NVLink-to-IB forwarding and accumulation, and (3) IB receiving and accumulation are also handled by dynamically adjusted warps. In addition, both dispatching and combining kernels overlap with the computation stream, so we also consider their impact on other SM computation kernels. Specifically, we employ customized PTX (Parallel Thread Execution) instructions and auto-tune the communication chunk size, which significantly reduces the use of the L2 cache and the interference to other SMs.

具体而言, 我们采用 warp 特化技术 (Bauer et al., 2014) 并将 20 个 SM 划分为 10 个通信通道. 在 dispatch 过程中, (1) IB 发送、(2) IB 到 NVLink 转发和 (3) NVLink 接收由各自的 warp 处理. 分配给每个通信任务的 warp 数量根据所有 SM 上的实际工作负载动态调整. 类似地, 在 combine 过程中, (1) NVLink 发送、(2) NVLink 到 IB 转发和累加以及 (3) IB 接收和累加也由动态调整的 warp 处理. 此外, dispatch 和 combine 内核都与计算流重叠, 因此我们还考虑它们对其他 SM 计算内核的影响. 具体而言, 我们采用定制的 PTX (Parallel Thread Execution) 指令并自动调优通信块大小, 这显著减少了 L2 缓存的使用和对其他 SM 的干扰.

#### 3.2.3. Extremely Memory Saving with Minimal Overhead

In order to reduce the memory footprint during training, we employ the following techniques.

为了减少训练期间的内存占用, 我们采用以下技术.

Recomputation of RMSNorm and MLA Up-Projection. We recompute all RMSNorm operations and MLA up-projections during back-propagation, thereby eliminating the need to persistently store their output activations. With a minor overhead, this strategy significantly reduces memory requirements for storing activations.

RMSNorm 和 MLA 上投影的重计算. 我们在反向传播期间重计算所有 RMSNorm 操作和 MLA 上投影, 从而无需持久存储它们的输出激活. 以较小的开销, 这种策略显著减少了存储激活的内存需求.

Exponential Moving Average in CPU. During training, we preserve the Exponential Moving Average (EMA) of the model parameters for early estimation of the model performance after learning rate decay. The EMA parameters are stored in CPU memory and are updated asynchronously after each training step. This method allows us to maintain EMA parameters without incurring additional memory or time overhead.

CPU 中的指数移动平均. 在训练期间, 我们保留模型参数的指数移动平均 (EMA), 用于在学习率衰减后早期估计模型性能. EMA 参数存储在 CPU 内存中, 并在每个训练步骤后异步更新. 这种方法使我们能够在不产生额外内存或时间开销的情况下维护 EMA 参数.

Shared Embedding and Output Head for Multi-Token Prediction. With the DualPipe strategy, we deploy the shallowest layers (including the embedding layer) and deepest layers (including the output head) of the model on the same PP rank. This arrangement enables the physical sharing of parameters and gradients, of the shared embedding and output head, between the MTP module and the main model. This physical sharing mechanism further enhances our memory efficiency.

多 Token 预测的共享嵌入和输出头. 通过 DualPipe 策略, 我们将模型的最浅层(包括嵌入层)和最深层(包括输出头)部署在同一 PP 等级上. 这种安排实现了 MTP 模块和主模型之间共享嵌入和输出头的参数和梯度的物理共享. 这种物理共享机制进一步提高了我们的内存效率.

### 3.3. FP8 Training

Inspired by recent advances in low-precision training (Dettmers et al., 2022; Noune et al., 2022; Peng et al., 2023b), we propose a fine-grained mixed precision framework utilizing the FP8 data format for training DeepSeek-V3. While low-precision training holds great promise, it is often limited by the presence of outliers in activations, weights, and gradients (Fishman et al., 2024; He et al.; Sun et al., 2024). Although significant progress has been made in inference quantization (Frantar et al., 2022; Xiao et al., 2023), there are relatively few studies demonstrating successful application of low-precision techniques in large-scale language model pre-training (Fishman et al., 2024). To address this challenge and effectively extend the dynamic range of the FP8 format, we introduce a fine-grained quantization strategy: tile-wise grouping with $1 \times N_c$ elements or block-wise grouping with $N_c \times N_c$ elements. The associated dequantization overhead is largely mitigated under our increased-precision accumulation process, a critical aspect for achieving accurate FP8 General Matrix Multiplication (GEMM). Moreover, to further reduce memory and communication overhead in MoE training, we cache and dispatch activations in FP8, while storing low-precision optimizer states in BF16. We validate the proposed FP8 mixed precision framework on two model scales similar to DeepSeek-V2-Lite and DeepSeek-V2, training for approximately 1 trillion tokens (see more details in Appendix B.1). Notably, compared with the BF16 baseline, the relative loss error of our FP8-training model remains consistently below 0.25%, a level well within the acceptable range of training randomness.

受低精度训练最新进展的启发 (Dettmers et al., 2022; Noune et al., 2022; Peng et al., 2023b), 我们提出了一种细粒度混合精度框架, 利用 FP8 数据格式训练 DeepSeek-V3. 虽然低精度训练前景广阔, 但它常常受到激活、权重和梯度中异常值 (outliers) 的限制 (Fishman et al., 2024; He et al.; Sun et al., 2024). 尽管推理量化已取得显著进展 (Frantar et al., 2022; Xiao et al., 2023), 但在大规模语言模型预训练中成功应用低精度技术的研究相对较少 (Fishman et al., 2024). 为解决这一挑战并有效扩展 FP8 格式的动态范围, 我们引入了细粒度量化策略: 基于 tile 的分组, 每组 $1 \times N_c$ 个元素; 或基于 block 的分组, 每组 $N_c \times N_c$ 个元素. 在我们提升精度的累加过程中, 相关的反量化开销被大幅缓解, 这是实现高精度 FP8 通用矩阵乘法 (GEMM) 的关键. 此外, 为了进一步降低 MoE 训练中的内存和通信开销, 我们以 FP8 格式缓存和分发激活, 同时以 BF16 存储低精度优化器状态. 我们在两个与 DeepSeek-V2-Lite 和 DeepSeek-V2 相似的模型规模上验证了所提出的 FP8 混合精度框架, 每个训练约 1 万亿 token (更多细节见附录 B.1). 值得注意的是, 与 BF16 基线相比, 我们 FP8 训练模型的相对损失误差始终低于 0.25%, 这一水平完全在训练随机性的可接受范围内.

> 译者注: FP8 训练是 DeepSeek-V3 最具工程突破性的贡献之一. 此前 FP8 训练在大模型上的应用受限于量化精度和累加精度不足. 本文提出的细粒度量化 (tile-wise/block-wise) 和提升累加精度 (通过 CUDA Cores 做 FP32 累加) 是两大关键创新, 使得 FP8 训练的相对误差控制在 0.25% 以内, 几乎无损. 这为后续大模型训练大幅降低计算成本提供了可行路径.

![](images/fig06_mixed_precision_framework.jpg)  
Figure 6 | The overall mixed precision framework with FP8 data format. For clarification, only the Linear operator is illustrated.

图 6 | 使用 FP8 数据格式的整体混合精度框架. 为清晰起见, 仅展示了 Linear 算子.

#### 3.3.1. Mixed Precision Framework

Building upon widely adopted techniques in low-precision training (Kalamkar et al., 2019; Narang et al., 2017), we propose a mixed precision framework for FP8 training. In this framework, most compute-density operations are conducted in FP8, while a few key operations are strategically maintained in their original data formats to balance training efficiency and numerical stability. The overall framework is illustrated in Figure 6.

基于低精度训练中广泛采用的技术 (Kalamkar et al., 2019; Narang et al., 2017), 我们提出了一种用于 FP8 训练的混合精度框架. 在该框架中, 大多数计算密集型操作以 FP8 执行, 而少数关键操作则策略性地保留在原始数据格式中, 以平衡训练效率和数值稳定性. 整体框架如图 6 所示.

Firstly, in order to accelerate model training, the majority of core computation kernels, i.e., GEMM operations, are implemented in FP8 precision. These GEMM operations accept FP8 tensors as inputs and produce outputs in BF16 or FP32. As depicted in Figure 6, all three GEMMs associated with the Linear operator, namely Fprop (forward pass), Dgrad (activation backward pass), and Wgrad (weight backward pass), are executed in FP8. This design theoretically doubles the computational speed compared with the original BF16 method. Additionally, the FP8 Wgrad GEMM allows activations to be stored in FP8 for use in the backward pass. This significantly reduces memory consumption.

首先, 为了加速模型训练, 大多数核心计算内核, 即 GEMM 操作, 均以 FP8 精度实现. 这些 GEMM 操作接受 FP8 张量作为输入, 并输出 BF16 或 FP32. 如图 6 所示, 与 Linear 算子相关的三个 GEMM, 即 Fprop (前向传播)、Dgrad (激活反向传播) 和 Wgrad (权重反向传播), 均以 FP8 执行. 这一设计在理论上将计算速度相比原始 BF16 方法提升了一倍. 此外, FP8 Wgrad GEMM 允许激活以 FP8 格式存储, 用于反向传播, 从而显著降低了内存消耗.

Despite the efficiency advantage of the FP8 format, certain operators still require a higher precision due to their sensitivity to low-precision computations. Besides, some low-cost operators can also utilize a higher precision with a negligible overhead to the overall training cost. For this reason, after careful investigations, we maintain the original precision (e.g., BF16 or FP32) for the following components: the embedding module, the output head, MoE gating modules, normalization operators, and attention operators. These targeted retentions of high precision ensure stable training dynamics for DeepSeek-V3. To further guarantee numerical stability, we store the master weights, weight gradients, and optimizer states in higher precision. While these high-precision components incur some memory overheads, their impact can be minimized through efficient sharding across multiple DP ranks in our distributed training system.

尽管 FP8 格式具有效率优势, 但某些算子由于对低精度计算敏感, 仍需要更高精度. 此外, 一些低成本的算子也可以使用更高精度, 而对整体训练成本的影响可忽略不计. 因此, 经过仔细研究, 我们对以下组件保留原始精度 (如 BF16 或 FP32): 嵌入模块、输出头、MoE 门控模块、归一化算子和注意力算子. 这些有针对性的高精度保留确保了 DeepSeek-V3 的训练动态稳定性. 为了进一步保证数值稳定性, 我们将主权重、权重梯度和优化器状态存储在更高精度中. 虽然这些高精度组件会带来一些内存开销, 但在我们的分布式训练系统中, 通过跨多个 DP 秩的高效分片, 其影响可以被最小化.

> 译者注: 混合精度框架的设计体现了"该省的省, 该花的花"的工程哲学. 不是盲目地将所有操作转为 FP8, 而是识别出对精度敏感的模块 (embedding, attention, normalization, gating) 保留高精度. 同时通过 DP 分片来摊薄高精度状态的内存开销. 这是一种非常务实的平衡策略.

![](images/fig07a_fine_grained_quantization.jpg)

![](images/fig07b_increasing_accumulation_precision.jpg)  
(b) Increasing accumulation precision  
Figure 7 | (a) We propose a fine-grained quantization method to mitigate quantization errors caused by feature outliers; for illustration simplicity, only Fprop is illustrated. (b) In conjunction with our quantization strategy, we improve the FP8 GEMM precision by promoting to CUDA Cores at an interval of $N_C = 128$ elements MMA for the high-precision accumulation.

图 7 | (a) 我们提出了一种细粒度量化方法来缓解特征异常值引起的量化误差; 为简化说明, 仅展示了 Fprop. (b) 结合我们的量化策略, 我们通过以 $N_C = 128$ 个元素的间隔提升到 CUDA Core 进行 MMA 高精度累加, 从而提升 FP8 GEMM 精度.

#### 3.3.2. Improved Precision from Quantization and Multiplication

Based on our mixed precision FP8 framework, we introduce several strategies to enhance low-precision training accuracy, focusing on both the quantization method and the multiplication process.

基于我们的混合精度 FP8 框架, 我们引入了多种策略来提升低精度训练的精度, 重点关注量化方法和乘法过程.

Fine-Grained Quantization. In low-precision training frameworks, overflows and underflows are common challenges due to the limited dynamic range of the FP8 format, which is constrained by its reduced exponent bits. As a standard practice, the input distribution is aligned to the representable range of the FP8 format by scaling the maximum absolute value of the input tensor to the maximum representable value of FP8 (Narang et al., 2017). This method makes low-precision training highly sensitive to activation outliers, which can heavily degrade quantization accuracy. To solve this, we propose a fine-grained quantization method that applies scaling at a more granular level. As illustrated in Figure 7 (a), (1) for activations, we group and scale elements on a 1x128 tile basis (i.e., per token per 128 channels); and (2) for weights, we group and scale elements on a 128x128 block basis (i.e., per 128 input channels per 128 output channels). This approach ensures that the quantization process can better accommodate outliers by adapting the scale according to smaller groups of elements. In Appendix B.2, we further discuss the training instability when we group and scale activations on a block basis in the same way as weights quantization.

细粒度量化. 在低精度训练框架中, 由于 FP8 格式的动态范围有限 (受限于其减少的指数位), 溢出和下溢是常见挑战. 作为标准做法, 通过将输入张量的最大绝对值缩放到 FP8 的最大可表示值, 使输入分布与 FP8 格式的可表示范围对齐 (Narang et al., 2017). 这种方法使低精度训练对激活异常值高度敏感, 可能严重降低量化精度. 为解决此问题, 我们提出了一种在更细粒度级别上应用缩放的细粒度量化方法. 如图 7 (a) 所示, (1) 对于激活, 我们在 1x128 tile 基础上对元素进行分组和缩放 (即每个 token 每 128 个通道); (2) 对于权重, 我们在 128x128 block 基础上对元素进行分组和缩放 (即每 128 个输入通道每 128 个输出通道). 这种方法确保量化过程可以通过根据更小的元素组自适应调整尺度来更好地适应异常值. 在附录 B.2 中, 我们进一步讨论了当以与权重量化相同的方式在 block 基础上对激活进行分组和缩放时的训练不稳定性.

One key modification in our method is the introduction of per-group scaling factors along the inner dimension of GEMM operations. This functionality is not directly supported in the standard FP8 GEMM. However, combined with our precise FP32 accumulation strategy, it can be efficiently implemented.

我们方法中的一个关键改进是在 GEMM 操作的内维度上引入了逐组缩放因子. 这一功能在标准 FP8 GEMM 中并不直接支持. 然而, 结合我们精确的 FP32 累加策略, 它可以被高效实现.

Notably, our fine-grained quantization strategy is highly consistent with the idea of microscaling formats (Rouhani et al., 2023b), while the Tensor Cores of NVIDIA next-generation GPUs (Blackwell series) have announced the support for microscaling formats with smaller quantization granularity (NVIDIA, 2024a). We hope our design can serve as a reference for future work to keep pace with the latest GPU architectures.

值得注意的是, 我们的细粒度量化策略与微缩放格式 (microscaling formats) 的思想高度一致 (Rouhani et al., 2023b), 而 NVIDIA 下一代 GPU (Blackwell 系列) 的 Tensor Core 已宣布支持更小量化粒度的微缩放格式 (NVIDIA, 2024a). 我们希望我们的设计能为未来的工作提供参考, 以跟上最新 GPU 架构的步伐.

> 译者注: 细粒度量化 (tile-wise 1x128 对激活, block-wise 128x128 对权重) 是 FP8 训练成功的核心. 这种设计与 NVIDIA Blackwell 的微缩放格式 (MXFP) 不谋而合, 说明 DeepSeek 的工程团队对硬件演进方向有深刻预判. 这种软硬件协同设计 (co-design) 的思维值得借鉴.

Increasing Accumulation Precision. Low-precision GEMM operations often suffer from underflow issues, and their accuracy largely depends on high-precision accumulation, which is commonly performed in an FP32 precision (Kalamkar et al., 2019; Narang et al., 2017). However, we observe that the accumulation precision of FP8 GEMM on NVIDIA H800 GPUs is limited to retaining around 14 bits, which is significantly lower than FP32 accumulation precision. This problem will become more pronounced when the inner dimension K is large (Wortsman et al., 2023), a typical scenario in large-scale model training where the batch size and model width are increased. Taking GEMM operations of two random matrices with $K = 4096$ for example, in our preliminary test, the limited accumulation precision in Tensor Cores results in a maximum relative error of nearly 2%. Despite these problems, the limited accumulation precision is still the default option in a few FP8 frameworks (NVIDIA, 2024b), severely constraining the training accuracy.

提升累加精度. 低精度 GEMM 操作经常遭受下溢问题, 其精度在很大程度上依赖于高精度累加, 通常以 FP32 精度执行 (Kalamkar et al., 2019; Narang et al., 2017). 然而, 我们观察到 NVIDIA H800 GPU 上 FP8 GEMM 的累加精度仅保留约 14 位, 显著低于 FP32 累加精度. 当内维度 K 较大时 (Wortsman et al., 2023), 这一问题会更加明显, 这是大规模模型训练中批量大小和模型宽度增加的典型场景. 以两个随机矩阵的 GEMM 操作为例, 其中 $K = 4096$, 在我们的初步测试中, Tensor Core 中有限的累加精度导致最大相对误差接近 2%. 尽管存在这些问题, 有限的累加精度仍然是某些 FP8 框架中的默认选项 (NVIDIA, 2024b), 严重限制了训练精度.

In order to address this issue, we adopt the strategy of promotion to CUDA Cores for higher precision (Thakkar et al., 2023). The process is illustrated in Figure 7 (b). To be specific, during MMA (Matrix Multiply-Accumulate) execution on Tensor Cores, intermediate results are accumulated using the limited bit width. Once an interval of $N_C$ is reached, these partial results will be copied to FP32 registers on CUDA Cores, where full-precision FP32 accumulation is performed. As mentioned before, our fine-grained quantization applies per-group scaling factors along the inner dimension K. These scaling factors can be efficiently multiplied on the CUDA Cores as the dequantization process with minimal additional computational cost.

为解决这一问题, 我们采用了提升到 CUDA Core 进行更高精度计算的策略 (Thakkar et al., 2023). 该过程如图 7 (b) 所示. 具体而言, 在 Tensor Core 上执行 MMA (矩阵乘累加) 期间, 中间结果以有限的位宽累加. 一旦达到 $N_C$ 的间隔, 这些部分结果将被复制到 CUDA Core 的 FP32 寄存器中, 在那里执行全精度 FP32 累加. 如前所述, 我们的细粒度量化沿内维度 K 应用逐组缩放因子. 这些缩放因子可以在 CUDA Core 上作为反量化过程被高效相乘, 仅增加极少的计算开销.

It is worth noting that this modification reduces the WGMMA (Warpgroup-level Matrix Multiply-Accumulate) instruction issue rate for a single warpgroup. However, on the H800 architecture, it is typical for two WGMMA to persist concurrently: while one warpgroup performs the promotion operation, the other is able to execute the MMA operation. This design enables overlapping of the two operations, maintaining high utilization of Tensor Cores. Based on our experiments, setting $N_C = 128$ elements, equivalent to 4 WGMMAs, represents the minimal accumulation interval that can significantly improve precision without introducing substantial overhead.

值得注意的是, 这一修改降低了单个 warpgroup 的 WGMMA (Warpgroup-level Matrix Multiply-Accumulate) 指令发射速率. 然而, 在 H800 架构上, 两个 WGMMA 通常可以并发执行: 当一个 warpgroup 执行提升操作时, 另一个能够执行 MMA 操作. 这种设计使得两个操作可以重叠, 保持 Tensor Core 的高利用率. 根据我们的实验, 设置 $N_C = 128$ 个元素, 相当于 4 个 WGMMA, 是能够在不引入显著开销的情况下显著提升精度的最小累加间隔.

> 译者注: H800 的 FP8 Tensor Core 累加精度仅有约 14 位, 这是一个硬件缺陷. DeepSeek 的解决方案非常巧妙: 每 128 个元素 (4 个 WGMMA) 就将部分和提升到 CUDA Core 做 FP32 累加, 同时利用双 warpgroup 重叠隐藏延迟. 这是典型的"用软件算法弥补硬件不足"的工程案例.

Mantissa over Exponents. In contrast to the hybrid FP8 format adopted by prior work (NVIDIA, 2024b; Peng et al., 2023b; Sun et al., 2019b), which uses E4M3 (4-bit exponent and 3-bit mantissa) in Fprop and E5M2 (5-bit exponent and 2-bit mantissa) in Dgrad and Wgrad, we adopt the E4M3 format on all tensors for higher precision. We attribute the feasibility of this approach to our fine-grained quantization strategy, i.e., tile and block-wise scaling. By operating on smaller element groups, our methodology effectively shares exponent bits among these grouped elements, mitigating the impact of the limited dynamic range.

尾数优先于指数. 与先前工作采用的混合 FP8 格式不同 (NVIDIA, 2024b; Peng et al., 2023b; Sun et al., 2019b), 后者在 Fprop 中使用 E4M3 (4 位指数和 3 位尾数), 在 Dgrad 和 Wgrad 中使用 E5M2 (5 位指数和 2 位尾数), 我们在所有张量上采用 E4M3 格式以获得更高精度. 我们将这种方法的可行性归因于我们的细粒度量化策略, 即 tile 和 block 级别的缩放. 通过在更小的元素组上操作, 我们的方法有效地在这些分组元素之间共享指数位, 缓解了有限动态范围的影响.

Online Quantization. Delayed quantization is employed in tensor-wise quantization frameworks (NVIDIA, 2024b; Peng et al., 2023b), which maintains a history of the maximum absolute values across prior iterations to infer the current value. In order to ensure accurate scales and simplify the framework, we calculate the maximum absolute value online for each 1x128 activation tile or 128x128 weight block. Based on it, we derive the scaling factor and then quantize the activation or weight online into the FP8 format.

在线量化. 张量级量化框架采用延迟量化 (NVIDIA, 2024b; Peng et al., 2023b), 它维护先前迭代中最大绝对值的历史记录来推断当前值. 为了确保精确的尺度并简化框架, 我们在线计算每个 1x128 激活 tile 或 128x128 权重块的最大绝对值. 基于此, 我们推导缩放因子, 然后将激活或权重在线量化为 FP8 格式.

> 译者注: 在线量化相比延迟量化更加直接和稳定, 不需要维护历史统计量. E4M3 全统一格式 (而非 E4M3+E5M2 混合) 的选择也体现了对精度的追求, 这只有在细粒度量化提供了足够动态范围补偿的前提下才可行.

#### 3.3.3. Low-Precision Storage and Communication

In conjunction with our FP8 training framework, we further reduce the memory consumption and communication overhead by compressing cached activations and optimizer states into lower-precision formats.

结合我们的 FP8 训练框架, 我们通过将缓存的激活和优化器状态压缩为低精度格式, 进一步降低了内存消耗和通信开销.

Low-Precision Optimizer States. We adopt the BF16 data format instead of FP32 to track the first and second moments in the AdamW (Loshchilov and Hutter, 2017) optimizer, without incurring observable performance degradation. However, the master weights (stored by the optimizer) and gradients (used for batch size accumulation) are still retained in FP32 to ensure numerical stability throughout training.

低精度优化器状态. 我们采用 BF16 数据格式而非 FP32 来跟踪 AdamW (Loshchilov and Hutter, 2017) 优化器中的一阶和二阶矩, 而不会产生可观察到的性能下降. 然而, 主权重 (由优化器存储) 和梯度 (用于批量大小累加) 仍保留在 FP32 中, 以确保整个训练过程中的数值稳定性.

Low-Precision Activation. As illustrated in Figure 6, the Wgrad operation is performed in FP8. To reduce the memory consumption, it is a natural choice to cache activations in FP8 format for the backward pass of the Linear operator. However, special considerations are taken on several operators for low-cost high-precision training:

低精度激活. 如图 6 所示, Wgrad 操作以 FP8 执行. 为了减少内存消耗, 将激活以 FP8 格式缓存用于 Linear 算子的反向传播是一种自然的选择. 然而, 对于低成本高精度训练, 我们对几个算子采取了特殊考虑:

(1) Inputs of the Linear after the attention operator. These activations are also used in the backward pass of the attention operator, which makes it sensitive to precision. We adopt a customized E5M6 data format exclusively for these activations. Additionally, these activations will be converted from an 1x128 quantization tile to an 128x1 tile in the backward pass. To avoid introducing extra quantization error, all the scaling factors are round scaled, i.e., integral power of 2.

(1) 注意力算子之后 Linear 的输入. 这些激活也用于注意力算子的反向传播, 这使其对精度敏感. 我们专门为这些激活采用定制的 E5M6 数据格式. 此外, 这些激活在反向传播中将从 1x128 量化 tile 转换为 128x1 tile. 为了避免引入额外的量化误差, 所有缩放因子都是圆整缩放的, 即 2 的整数次幂.

(2) Inputs of the SwiGLU operator in MoE. To further reduce the memory cost, we cache the inputs of the SwiGLU operator and recompute its output in the backward pass. These activations are also stored in FP8 with our fine-grained quantization method, striking a balance between memory efficiency and computational accuracy.

(2) MoE 中 SwiGLU 算子的输入. 为了进一步降低内存成本, 我们缓存 SwiGLU 算子的输入, 并在反向传播中重计算其输出. 这些激活也以 FP8 格式通过我们的细粒度量化方法存储, 在内存效率和计算精度之间取得平衡.

Low-Precision Communication. Communication bandwidth is a critical bottleneck in the training of MoE models. To alleviate this challenge, we quantize the activation before MoE up-projections into FP8 and then apply dispatch components, which is compatible with FP8 Fprop in MoE up-projections. Like the inputs of the Linear after the attention operator, scaling factors for this activation are integral power of 2. A similar strategy is applied to the activation gradient before MoE down-projections. For both the forward and backward combine components, we retain them in BF16 to preserve training precision in critical parts of the training pipeline.

低精度通信. 通信带宽是 MoE 模型训练中的关键瓶颈. 为缓解这一挑战, 我们将 MoE 上投影之前的激活量化为 FP8, 然后应用分发组件, 这与 MoE 上投影中的 FP8 Fprop 兼容. 与注意力算子后 Linear 的输入类似, 此激活的缩放因子也是 2 的整数次幂. 类似的策略也应用于 MoE 下投影之前的激活梯度. 对于前向和后向的 combine 组件, 我们将它们保留在 BF16 中, 以在训练管道的关键部分保持训练精度.

> 译者注: FP8 不仅用于计算, 还贯穿于存储 (激活缓存) 和通信 (all-to-all dispatch/combine) 的全链路. 这种端到端的低精度设计是 DeepSeek-V3 训练效率的核心. 特别值得注意的是, 他们在对精度敏感的位置 (如 attention 后的 Linear 输入) 使用了定制的 E5M6 格式, 并确保缩放因子为 2 的幂次以避免额外误差.

### 3.4. Inference and Deployment

We deploy DeepSeek-V3 on the H800 cluster, where GPUs within each node are interconnected using NVLink, and all GPUs across the cluster are fully interconnected via IB. To simultaneously ensure both the Service-Level Objective (SLO) for online services and high throughput, we employ the following deployment strategy that separates the prefilling and decoding stages.

我们将 DeepSeek-V3 部署在 H800 集群上, 其中每个节点内的 GPU 通过 NVLink 互连, 集群中的所有 GPU 通过 IB 完全互连. 为了同时确保在线服务的服务级别目标 (SLO) 和高吞吐量, 我们采用了以下将预填充 (prefilling) 和解码 (decoding) 阶段分离的部署策略.

#### 3.4.1. Prefilling

The minimum deployment unit of the prefilling stage consists of 4 nodes with 32 GPUs. The attention part employs 4-way Tensor Parallelism (TP4) with Sequence Parallelism (SP), combined with 8-way Data Parallelism (DP8). Its small TP size of 4 limits the overhead of TP communication. For the MoE part, we use 32-way Expert Parallelism (EP32), which ensures that each expert processes a sufficiently large batch size, thereby enhancing computational efficiency. For the MoE all-to-all communication, we use the same method as in training: first transferring tokens across nodes via IB, and then forwarding among the intra-node GPUs via NVLink. In particular, we use 1-way Tensor Parallelism for the dense MLPs in shallow layers to save TP communication.

预填充阶段的最小部署单元由 4 个节点共 32 个 GPU 组成. 注意力部分采用 4 路张量并行 (TP4) 结合序列并行 (SP), 以及 8 路数据并行 (DP8). 较小的 TP 尺寸 4 限制了 TP 通信开销. 对于 MoE 部分, 我们使用 32 路专家并行 (EP32), 确保每个专家处理足够大的批量大小, 从而提升计算效率. 对于 MoE 的 all-to-all 通信, 我们采用与训练相同的方法: 首先通过 IB 跨节点传输 token, 然后通过 NVLink 在节点内 GPU 之间转发. 特别地, 我们对浅层的稠密 MLP 使用 1 路张量并行, 以节省 TP 通信.

To achieve load balancing among different experts in the MoE part, we need to ensure that each GPU processes approximately the same number of tokens. To this end, we introduce a deployment strategy of redundant experts, which duplicates high-load experts and deploys them redundantly. The high-load experts are detected based on statistics collected during the online deployment and are adjusted periodically (e.g., every 10 minutes). After determining the set of redundant experts, we carefully rearrange experts among GPUs within a node based on the observed loads, striving to balance the load across GPUs as much as possible without increasing the cross-node all-to-all communication overhead. For the deployment of DeepSeek-V3, we set 32 redundant experts for the prefilling stage. For each GPU, besides the original 8 experts it hosts, it will also host one additional redundant expert.

为了在 MoE 部分的不同专家之间实现负载均衡, 我们需要确保每个 GPU 处理大致相同数量的 token. 为此, 我们引入了一种冗余专家部署策略, 即复制高负载专家并冗余部署它们. 高负载专家根据在线部署期间收集的统计数据进行检测, 并定期调整 (例如每 10 分钟). 在确定冗余专家集合后, 我们根据观察到的负载仔细重新排列节点内 GPU 之间的专家, 努力在不增加跨节点 all-to-all 通信开销的情况下尽可能平衡各 GPU 的负载. 对于 DeepSeek-V3 的部署, 我们在预填充阶段设置了 32 个冗余专家. 对于每个 GPU, 除了其托管的原始 8 个专家外, 还将额外托管一个冗余专家.

> 译者注: 冗余专家 (redundant experts) 是推理部署中解决负载不均衡的实用技巧. 与训练时的负载均衡不同, 推理时的 token 分布是动态变化的 (如某些领域请求突增). 通过在线统计检测热点专家并每 10 分钟调整一次冗余副本, 系统可以自适应地平衡负载. 这是典型的"以空间换时间/以冗余换均衡"策略.

Furthermore, in the prefilling stage, to improve the throughput and hide the overhead of all-to-all and TP communication, we simultaneously process two micro-batches with similar computational workloads, overlapping the attention and MoE of one micro-batch with the dispatch and combine of another.

此外, 在预填充阶段, 为了提高吞吐量并隐藏 all-to-all 和 TP 通信的开销, 我们同时处理两个计算负载相似的微批次, 将一个微批次的 attention 和 MoE 与另一个微批次的 dispatch 和 combine 重叠.

Finally, we are exploring a dynamic redundancy strategy for experts, where each GPU hosts more experts (e.g., 16 experts), but only 9 will be activated during each inference step. Before the all-to-all operation at each layer begins, we compute the globally optimal routing scheme on the fly. Given the substantial computation involved in the prefilling stage, the overhead of computing this routing scheme is almost negligible.

最后, 我们正在探索一种动态冗余策略, 其中每个 GPU 托管更多专家 (例如 16 个专家), 但在每个推理步骤中仅激活 9 个. 在每层的 all-to-all 操作开始之前, 我们动态计算全局最优路由方案. 鉴于预填充阶段涉及的大量计算, 计算此路由方案的开销几乎可以忽略不计.

#### 3.4.2. Decoding

During decoding, we treat the shared expert as a routed one. From this perspective, each token will select 9 experts during routing, where the shared expert is regarded as a heavy-load one that will always be selected. The minimum deployment unit of the decoding stage consists of 40 nodes with 320 GPUs. The attention part employs TP4 with SP, combined with DP80, while the MoE part uses EP320. For the MoE part, each GPU hosts only one expert, and 64 GPUs are responsible for hosting redundant experts and shared experts. All-to-all communication of the dispatch and combine parts is performed via direct point-to-point transfers over IB to achieve low latency. Additionally, we leverage the IBGDA (NVIDIA, 2022) technology to further minimize latency and enhance communication efficiency.

在解码阶段, 我们将共享专家视为一个路由专家. 从这个角度来看, 每个 token 在路由期间将选择 9 个专家, 其中共享专家被视为一个高负载专家, 始终被选中. 解码阶段的最小部署单元由 40 个节点共 320 个 GPU 组成. 注意力部分采用 TP4 结合 SP, 以及 DP80, 而 MoE 部分使用 EP320. 对于 MoE 部分, 每个 GPU 仅托管一个专家, 64 个 GPU 负责托管冗余专家和共享专家. dispatch 和 combine 部分的 all-to-all 通信通过 IB 上的直接点对点传输执行, 以实现低延迟. 此外, 我们利用 IBGDA (NVIDIA, 2022) 技术进一步最小化延迟并提升通信效率.

Similar to prefilling, we periodically determine the set of redundant experts in a certain interval, based on the statistical expert load from our online service. However, we do not need to rearrange experts since each GPU only hosts one expert. We are also exploring the dynamic redundancy strategy for decoding. However, this requires more careful optimization of the algorithm that computes the globally optimal routing scheme and the fusion with the dispatch kernel to reduce overhead.

与预填充类似, 我们基于在线服务的统计专家负载, 以一定间隔定期确定冗余专家集合. 然而, 由于每个 GPU 仅托管一个专家, 我们不需要重新排列专家. 我们也在探索解码阶段的动态冗余策略. 然而, 这需要更仔细地优化计算全局最优路由方案的算法, 以及与 dispatch 内核的融合, 以减少开销.

Additionally, to enhance throughput and hide the overhead of all-to-all communication, we are also exploring processing two micro-batches with similar computational workloads simultaneously in the decoding stage. Unlike prefilling, attention consumes a larger portion of time in the decoding stage. Therefore, we overlap the attention of one micro-batch with the dispatch+MoE+combine of another. In the decoding stage, the batch size per expert is relatively small (usually within 256 tokens), and the bottleneck is memory access rather than computation. Since the MoE part only needs to load the parameters of one expert, the memory access overhead is minimal, so using fewer SMs will not significantly affect the overall performance. Therefore, to avoid impacting the computation speed of the attention part, we can allocate only a small portion of SMs to dispatch+MoE+combine.

此外, 为了提升吞吐量并隐藏 all-to-all 通信的开销, 我们也在探索在解码阶段同时处理两个计算负载相似的微批次. 与预填充不同, 注意力在解码阶段消耗了更大比例的时间. 因此, 我们将一个微批次的 attention 与另一个微批次的 dispatch+MoE+combine 重叠. 在解码阶段, 每个专家的批量大小相对较小 (通常在 256 个 token 以内), 瓶颈是内存访问而非计算. 由于 MoE 部分只需要加载一个专家的参数, 内存访问开销很小, 因此使用较少的 SM 不会显著影响整体性能. 因此, 为了避免影响注意力部分的计算速度, 我们可以仅将一小部分 SM 分配给 dispatch+MoE+combine.

> 译者注: 推理部署将预填充和解码分离是业界的标准做法 (因为两个阶段计算特征完全不同), 但 DeepSeek-V3 在工程细节上做了大量优化: 冗余专家、双微批次重叠、IBGDA 低延迟通信、动态路由探索等. 解码阶段每专家 batch size 通常小于 256, 说明 MoE 的稀疏性在推理时可能导致 GPU 利用率不足, 这是 MoE 模型推理的固有效率挑战.

### 3.5. Suggestions on Hardware Design

Based on our implementation of the all-to-all communication and FP8 training scheme, we propose the following suggestions on chip design to AI hardware vendors.

基于我们对 all-to-all 通信和 FP8 训练方案的实现, 我们向 AI 硬件供应商提出以下芯片设计建议.

#### 3.5.1. Communication Hardware

In DeepSeek-V3, we implement the overlap between computation and communication to hide the communication latency during computation. This significantly reduces the dependency on communication bandwidth compared to serial computation and communication. However, the current communication implementation relies on expensive SMs (e.g., we allocate 20 out of the 132 SMs available in the H800 GPU for this purpose), which will limit the computational throughput. Moreover, using SMs for communication results in significant inefficiencies, as tensor cores remain entirely under-utilized.

在 DeepSeek-V3 中, 我们实现了计算与通信的重叠, 以隐藏计算期间的通信延迟. 与串行的计算和通信相比, 这显著降低了对通信带宽的依赖. 然而, 当前的通信实现依赖于宝贵的 SM (例如, 我们在 H800 GPU 可用的 132 个 SM 中分配了 20 个用于此目的), 这会限制计算吞吐量. 此外, 使用 SM 进行通信导致显著的效率低下, 因为 Tensor Core 完全未被利用.

Currently, the SMs primarily perform the following tasks for all-to-all communication:

目前, SM 主要为 all-to-all 通信执行以下任务:

• Forwarding data between the IB (InfiniBand) and NVLink domain while aggregating IB traffic destined for multiple GPUs within the same node from a single GPU.

• 在 IB (InfiniBand) 和 NVLink 域之间转发数据, 同时聚合从单个 GPU 发往同一节点内多个 GPU 的 IB 流量.

• Transporting data between RDMA buffers (registered GPU memory regions) and input/output buffers.

• 在 RDMA 缓冲区 (已注册的 GPU 内存区域) 和输入/输出缓冲区之间传输数据.

• Executing reduce operations for all-to-all combine.

• 执行 all-to-all combine 的归约操作.

• Managing fine-grained memory layout during chunked data transferring to multiple experts across the IB and NVLink domain.

• 在跨 IB 和 NVLink 域向多个专家分块传输数据期间管理细粒度内存布局.

We aspire to see future vendors developing hardware that offloads these communication tasks from the valuable computation unit SM, serving as a GPU co-processor or a network co-processor like NVIDIA SHARP (Graham et al., 2016). Furthermore, to reduce application programming complexity, we aim for this hardware to unify the IB (scale-out) and NVLink (scale-up) networks from the perspective of the computation units. With this unified interface, computation units can easily accomplish operations such as read, write, multicast, and reduce across the entire IB-NVLink-unified domain via submitting communication requests based on simple primitives.

我们期望未来的供应商开发能够将上述通信任务从宝贵的计算单元 SM 上卸载的硬件, 作为 GPU 协处理器或类似 NVIDIA SHARP (Graham et al., 2016) 的网络协处理器. 此外, 为了降低应用编程复杂度, 我们希望这种硬件能从计算单元的视角统一 IB (scale-out) 和 NVLink (scale-up) 网络. 通过这一统一接口, 计算单元可以通过基于简单原语提交通信请求, 轻松地在整个 IB-NVLink 统一域中完成读取、写入、多播和归约等操作.

> 译者注: 这是 DeepSeek 向硬件厂商发出的明确信号. 他们认为当前 GPU 将通信任务交给 SM 执行是极大的浪费 (Tensor Core 闲置, 20/132 SM 被占用). 理想的硬件应该有专门的通信协处理器, 并将 IB (scale-out) 和 NVLink (scale-up) 从软件层面统一为单一网络抽象. 这种建议具有前瞻性, 但也反映了当前 Hopper 架构在超大规模 MoE 训练场景下的局限性.

#### 3.5.2. Compute Hardware

Higher FP8 GEMM Accumulation Precision in Tensor Cores. In the current Tensor Core implementation of the NVIDIA Hopper architecture, FP8 GEMM suffers from limited accumulation precision. After aligning 32 mantissa products by right-shifting based on the maximum exponent, the Tensor Core only uses the highest 14 bits of each mantissa product for addition, and truncates bits exceeding this range. The accumulation of addition results into registers also employs 14-bit precision. Our implementation partially mitigates the limitation by accumulating the addition results of 128 FP8×FP8 multiplications into registers with FP32 precision in the CUDA core. Although helpful in achieving successful FP8 training, it is merely a compromise due to the Hopper architecture's hardware deficiency in FP8 GEMM accumulation precision. Future chips need to adopt higher precision.

Tensor Core 中更高的 FP8 GEMM 累加精度. 在 NVIDIA Hopper 架构当前的 Tensor Core 实现中, FP8 GEMM 遭受有限的累加精度之苦. 在基于最大指数对 32 个尾数乘积进行右移对齐后, Tensor Core 仅使用每个尾数乘积的最高 14 位进行加法, 并截断超出此范围的位. 加法结果到寄存器的累加也采用 14 位精度. 我们的实现通过在 CUDA Core 中以 FP32 精度将 128 个 FP8×FP8 乘法的结果累加到寄存器中, 部分缓解了这一限制. 虽然这有助于实现成功的 FP8 训练, 但这仅仅是由于 Hopper 架构在 FP8 GEMM 累加精度方面存在硬件缺陷而做出的妥协. 未来的芯片需要采用更高的精度.

Support for Tile- and Block-Wise Quantization. Current GPUs only support per-tensor quantization, lacking the native support for fine-grained quantization like our tile- and block-wise quantization. In the current implementation, when the accumulation interval is reached, the partial results will be copied from Tensor Cores to CUDA cores, multiplied by the scaling factors, and added to FP32 registers on CUDA cores. Although the dequantization overhead is significantly mitigated combined with our precise FP32 accumulation strategy, the frequent data movements between Tensor Cores and CUDA cores still limit the computational efficiency. Therefore, we recommend future chips to support fine-grained quantization by enabling Tensor Cores to receive scaling factors and implement MMA with group scaling. In this way, the whole partial sum accumulation and dequantization can be completed directly inside Tensor Cores until the final result is produced, avoiding frequent data movements.

支持 Tile 和 Block 级别的量化. 当前的 GPU 仅支持张量级量化, 缺乏对细粒度量化 (如我们的 tile 和 block 级别量化) 的原生支持. 在当前的实现中, 当达到累加间隔时, 部分结果将从 Tensor Core 复制到 CUDA Core, 乘以缩放因子, 并累加到 CUDA Core 的 FP32 寄存器中. 尽管结合我们精确的 FP32 累加策略, 反量化开销被显著缓解, 但 Tensor Core 和 CUDA Core 之间频繁的数据移动仍然限制了计算效率. 因此, 我们建议未来的芯片通过使 Tensor Core 能够接收缩放因子并实现带组缩放的 MMA, 来支持细粒度量化. 这样, 整个部分和累加和反量化可以直接在 Tensor Core 内部完成, 直到产生最终结果, 避免频繁的数据移动.

> 译者注: 细粒度量化的硬件支持是当前 GPU 的重大缺口. DeepSeek 在 Hopper 上不得不通过 Tensor Core  CUDA Core 之间的频繁数据移动来实现, 这造成了效率损失. 他们建议下一代芯片直接在 Tensor Core 内支持 group scaling, 这与 NVIDIA Blackwell 的 microscaling 方向一致, 再次验证了他们的硬件前瞻能力.

Support for Online Quantization. The current implementations struggle to effectively support online quantization, despite its effectiveness demonstrated in our research. In the existing process, we need to read 128 BF16 activation values (the output of the previous computation) from HBM (High Bandwidth Memory) for quantization, and the quantized FP8 values are then written back to HBM, only to be read again for MMA. To address this inefficiency, we recommend that future chips integrate FP8 cast and TMA (Tensor Memory Accelerator) access into a single fused operation, so quantization can be completed during the transfer of activations from global memory to shared memory, avoiding frequent memory reads and writes. We also recommend supporting a warp-level cast instruction for speedup, which further facilitates the better fusion of layer normalization and FP8 cast. Alternatively, a near-memory computing approach can be adopted, where compute logic is placed near the HBM. In this case, BF16 elements can be cast to FP8 directly as they are read from HBM into the GPU, reducing off-chip memory access by roughly 50%.

支持在线量化. 尽管在线量化在我们的研究中已证明有效, 但当前实现难以有效支持它. 在现有流程中, 我们需要从 HBM (高带宽内存) 读取 128 个 BF16 激活值 (前一次计算的输出) 进行量化, 然后将量化的 FP8 值写回 HBM, 仅为 MMA 再次读取. 为解决这一低效问题, 我们建议未来的芯片将 FP8 类型转换和 TMA (张量内存加速器) 访问集成到单一的融合操作中, 使得量化可以在激活从全局内存传输到共享内存的过程中完成, 避免频繁的内存读写. 我们还建议支持 warp 级别的类型转换指令以加速, 这进一步促进层归一化和 FP8 类型转换的更好融合. 或者, 可以采用近内存计算方案, 将计算逻辑放置在 HBM 附近. 在这种情况下, BF16 元素可以在从 HBM 读入 GPU 时直接转换为 FP8, 将片外内存访问减少约 50%.

Support for Transposed GEMM Operations. The current architecture makes it cumbersome to fuse matrix transposition with GEMM operations. In our workflow, activations during the forward pass are quantized into 1x128 FP8 tiles and stored. During the backward pass, the matrix needs to be read out, dequantized, transposed, re-quantized into 128x1 tiles, and stored in HBM. To reduce memory operations, we recommend future chips to enable direct transposed reads of matrices from shared memory before MMA operation, for those precisions required in both training and inference. Combined with the fusion of FP8 format conversion and TMA access, this enhancement will significantly streamline the quantization workflow.

支持转置 GEMM 操作. 当前架构使得将矩阵转置与 GEMM 操作融合变得繁琐. 在我们的工作流程中, 前向传播期间的激活被量化为 1x128 FP8 tile 并存储. 在反向传播期间, 矩阵需要被读出、反量化、转置、重新量化为 128x1 tile, 并存入 HBM. 为了减少内存操作, 我们建议未来的芯片在 MMA 操作之前启用从共享内存直接转置读取矩阵, 适用于训练和推理中所需的那些精度. 结合 FP8 格式转换和 TMA 访问的融合, 这一改进将显著简化量化工作流程.

> 译者注: 这四条硬件建议 (更高 FP8 累加精度、细粒度量化、在线量化、转置 GEMM) 每一条都切中当前 GPU 架构的痛点, 并且与 NVIDIA Blackwell 及后续架构的演进方向高度吻合. 这表明 DeepSeek 团队不仅精通算法和软件, 对硬件架构也有深刻理解. 这类来自顶级算法团队的反馈, 对硬件设计具有极高的参考价值.

## 4. Pre-Training

### 4.1. Data Construction

Compared with DeepSeek-V2, we optimize the pre-training corpus by enhancing the ratio of mathematical and programming samples, while expanding multilingual coverage beyond English and Chinese. Also, our data processing pipeline is refined to minimize redundancy while maintaining corpus diversity. Inspired by Ding et al. (2024), we implement the document packing method for data integrity but do not incorporate cross-sample attention masking during training. Finally, the training corpus for DeepSeek-V3 consists of 14.8T high-quality and diverse tokens in our tokenizer.

与 DeepSeek-V2 相比, 我们通过增加数学和编程样本的比例来优化预训练语料库, 同时将多语言覆盖范围扩展到英语和中文之外. 此外, 我们的数据处理流程经过优化, 在保持语料库多样性的同时最小化冗余. 受 Ding et al. (2024) 启发, 我们实现了文档打包方法以确保数据完整性, 但在训练期间不采用跨样本注意力掩码. 最终, DeepSeek-V3 的训练语料库在我们的分词器下包含 14.8T 高质量且多样化的 token.

> 译者注: 14.8T token 对于 671B 总参数 / 37B 激活参数的 MoE 模型来说, 训练数据量相对克制. 作为对比, LLaMA-3.1 405B 使用了约 15T token (接近 1:1 的参数-数据比), 而 DeepSeek-V3 的总参数更多但数据量相似. 这表明他们更注重数据质量和架构效率, 而非单纯的数据堆砌.

In the training process of DeepSeekCoder-V2 (DeepSeek-AI, 2024a), we observe that the Fill-in-Middle (FIM) strategy does not compromise the next-token prediction capability while enabling the model to accurately predict middle text based on contextual cues. In alignment with DeepSeekCoder-V2, we also incorporate the FIM strategy in the pre-training of DeepSeek-V3. To be specific, we employ the Prefix-Suffix-Middle (PSM) framework to structure data as follows:

在 DeepSeekCoder-V2 (DeepSeek-AI, 2024a) 的训练过程中, 我们观察到 Fill-in-Middle (FIM) 策略不会损害 next-token 预测能力, 同时使模型能够基于上下文线索准确预测中间文本. 与 DeepSeekCoder-V2 保持一致, 我们也在 DeepSeek-V3 的预训练中加入了 FIM 策略. 具体而言, 我们采用 Prefix-Suffix-Middle (PSM) 框架来构建数据, 格式如下:

$$
< | \mathrm { ~ f ~ i ~ m ~ \_ b e g i n } | > f _ { \mathrm { p r e } } < | \mathrm { ~ f ~ i ~ m ~ \_ h o l e ~ } | > f _ { \mathrm { s u t } } < | \mathrm { ~ f ~ i ~ m ~ \_ e n d ~ } | > f _ { \mathrm { m i d d l e } } < | \mathrm { ~ e ~ o s \_ t o k e n } | > .
$$

This structure is applied at the document level as a part of the pre-packing process. The FIM strategy is applied at a rate of 0.1, consistent with the PSM framework.

这种结构在文档级别应用, 作为预打包过程的一部分. FIM 策略以 0.1 的比例应用, 与 PSM 框架保持一致.

The tokenizer for DeepSeek-V3 employs Byte-level BPE (Shibata et al., 1999) with an extended vocabulary of 128K tokens. The pretokenizer and training data for our tokenizer are modified to optimize multilingual compression efficiency. In addition, compared with DeepSeek-V2, the new pretokenizer introduces tokens that combine punctuations and line breaks. However, this trick may introduce the token boundary bias (Lundberg, 2023) when the model processes multi-line prompts without terminal line breaks, particularly for few-shot evaluation prompts. To address this issue, we randomly split a certain proportion of such combined tokens during training, which exposes the model to a wider array of special cases and mitigates this bias.

DeepSeek-V3 的分词器采用 Byte-level BPE (Shibata et al., 1999), 扩展词表为 128K token. 我们的分词器的预分词器和训练数据经过修改, 以优化多语言压缩效率. 此外, 与 DeepSeek-V2 相比, 新的预分词器引入了组合标点和换行的 token. 然而, 当模型处理没有结尾换行的多行提示时, 这一技巧可能引入 token 边界偏差 (Lundberg, 2023), 特别是对于少样本评估提示. 为解决此问题, 我们在训练期间随机拆分一定比例的此类组合 token, 使模型接触到更广泛的特殊情况, 从而缓解这一偏差.

> 译者注: FIM (Fill-in-Middle) 是代码模型中常见的预训练策略, 对代码补全任务至关重要. 随机拆分组合 token 来缓解边界偏差是一个细致的数据工程技巧, 体现了团队对评估公平性的关注 —— 如果训练时总是看到带换行的 token 组合, 而评估时 prompt 没有换行, 模型性能会被系统性低估.

### 4.2. Hyper-Parameters

Model Hyper-Parameters. We set the number of Transformer layers to 61 and the hidden dimension to 7168. All learnable parameters are randomly initialized with a standard deviation of 0.006. In MLA, we set the number of attention heads $n_h$ to 128 and the per-head dimension $d_h$ to 128. The KV compression dimension $d_c$ is set to 512, and the query compression dimension $d_c'$ is set to 1536. For the decoupled queries and key, we set the per-head dimension $d_h^R$ to 64. We substitute all FFNs except for the first three layers with MoE layers. Each MoE layer consists of 1 shared expert and 256 routed experts, where the intermediate hidden dimension of each expert is 2048. Among the routed experts, 8 experts will be activated for each token, and each token will be ensured to be sent to at most 4 nodes. The multi-token prediction depth $D$ is set to 1, i.e., besides the exact next token, each token will predict one additional token. As DeepSeek-V2, DeepSeek-V3 also employs additional RMSNorm layers after the compressed latent vectors, and multiplies additional scaling factors at the width bottlenecks. Under this configuration, DeepSeek-V3 comprises 671B total parameters, of which 37B are activated for each token.

模型超参数. 我们将 Transformer 层数设置为 61, 隐藏维度设置为 7168. 所有可学习参数以标准差 0.006 随机初始化. 在 MLA 中, 我们将注意力头数 $n_h$ 设置为 128, 每头维度 $d_h$ 设置为 128. KV 压缩维度 $d_c$ 设置为 512, 查询压缩维度 $d_c'$ 设置为 1536. 对于解耦的查询和键, 我们将每头维度 $d_h^R$ 设置为 64. 我们将除前三层外的所有 FFN 替换为 MoE 层. 每个 MoE 层由 1 个共享专家和 256 个路由专家组成, 每个专家的中间隐藏维度为 2048. 在路由专家中, 每个 token 将激活 8 个专家, 并确保每个 token 最多被发送到 4 个节点. 多 token 预测深度 $D$ 设置为 1, 即除了精确的下一个 token 外, 每个 token 还将预测一个额外的 token. 与 DeepSeek-V2 一样, DeepSeek-V3 也在压缩潜在向量后使用额外的 RMSNorm 层, 并在宽度瓶颈处乘以额外的缩放因子. 在此配置下, DeepSeek-V3 共包含 671B 总参数, 其中每个 token 激活 37B 参数.

> 译者注: 关键配置回顾: 61 层, 隐藏维度 7168, 256 个路由专家 + 1 共享专家, 每 token 激活 8+1=9 个专家, 总参数 671B, 激活参数 37B. 注意前 3 层保持稠密 FFN, 这是一个有趣的工程选择 —— 浅层通常学习低级特征, 可能不需要稀疏化. 激活参数仅占总参数的 5.5%, 这是 MoE 架构的核心效率优势.

Training Hyper-Parameters. We employ the AdamW optimizer (Loshchilov and Hutter, 2017) with hyper-parameters set to $\beta_1 = 0.9, \beta_2 = 0.95$, and weight_decay = 0.1. We set the maximum sequence length to 4K during pre-training, and pre-train DeepSeek-V3 on 14.8T tokens. As for the learning rate scheduling, we first linearly increase it from 0 to $2.2 \times 10^{-4}$ during the first 2K steps. Then, we keep a constant learning rate of $2.2 \times 10^{-4}$ until the model consumes 10T training tokens. Subsequently, we gradually decay the learning rate to $2.2 \times 10^{-5}$ in 4.3T tokens, following a cosine decay curve. During the training of the final 500B tokens, we keep a constant learning rate of $2.2 \times 10^{-5}$ in the first 333B tokens, and switch to another constant learning rate of $7.3 \times 10^{-6}$ in the remaining 167B tokens. The gradient clipping norm is set to 1.0. We employ a batch size scheduling strategy, where the batch size is gradually increased from 3072 to 15360 in the training of the first 469B tokens, and then keeps 15360 in the remaining training. We leverage pipeline parallelism to deploy different layers of a model on different GPUs, and for each layer, the routed experts will be uniformly deployed on 64 GPUs belonging to 8 nodes. As for the node-limited routing, each token will be sent to at most 4 nodes (i.e., $M = 4$). For auxiliary-loss-free load balancing, we set the bias update speed $\gamma$ to 0.001 for the first 14.3T tokens, and to 0.0 for the remaining 500B tokens. For the balance loss, we set $\alpha$ to 0.0001, just to avoid extreme imbalance within any single sequence. The MTP loss weight $\lambda$ is set to 0.3 for the first 10T tokens, and to 0.1 for the remaining 4.8T tokens.

训练超参数. 我们采用 AdamW 优化器 (Loshchilov and Hutter, 2017), 超参数设置为 $\beta_1 = 0.9, \beta_2 = 0.95$, weight_decay = 0.1. 预训练期间最大序列长度设置为 4K, 在 14.8T token 上预训练 DeepSeek-V3. 学习率调度方面, 我们在前 2K 步中线性将其从 0 增加到 $2.2 \times 10^{-4}$. 然后, 保持恒定学习率 $2.2 \times 10^{-4}$ 直到模型消耗了 10T 训练 token. 随后, 我们在 4.3T token 中按照余弦衰减曲线将学习率逐渐衰减到 $2.2 \times 10^{-5}$. 在最后 500B token 的训练中, 我们在前 333B token 保持恒定学习率 $2.2 \times 10^{-5}$, 在剩余的 167B token 切换到另一个恒定学习率 $7.3 \times 10^{-6}$. 梯度裁剪范数设置为 1.0. 我们采用批量大小调度策略, 在前 469B token 的训练中将批量大小从 3072 逐渐增加到 15360, 然后在剩余训练中保持 15360. 我们利用流水线并行将模型的不同层部署在不同的 GPU 上, 对于每一层, 路由专家将均匀部署在属于 8 个节点的 64 个 GPU 上. 对于节点限制路由, 每个 token 最多被发送到 4 个节点 (即 $M = 4$). 对于无辅助损失负载均衡, 我们在前 14.3T token 将偏置更新速度 $\gamma$ 设置为 0.001, 在剩余 500B token 设置为 0.0. 对于平衡损失, 我们将 $\alpha$ 设置为 0.0001, 仅为了避免任何单个序列内的极端不平衡. MTP 损失权重 $\lambda$ 在前 10T token 设置为 0.3, 在剩余 4.8T token 设置为 0.1.

> 译者注: 训练超参数中有几个值得注意的细节: (1) 学习率调度采用"预热 → 恒定 → 余弦衰减 → 双阶段低学习率微调"的四段式策略, 最后 500B token 的低学习率微调有助于模型收敛到更优的局部最小值; (2) 批量大小从 3072 逐渐增加到 15360, 这是标准的批大小预热; (3) 无辅助损失负载均衡的偏置更新速度 $\gamma$ 在最后阶段设为 0, 说明此时路由已经稳定, 不再需要动态调整.

Pressure Testing DeepSeek-V3 128K Context via "Needle In A HayStack"  
![](images/fig08_niah_test.jpg)  
Figure 8 | Evaluation results on the "Needle In A Haystack" (NIAH) tests. DeepSeek-V3 performs well across all context window lengths up to 128K.

图 8 | "大海捞针" (Needle In A Haystack, NIAH) 测试的评估结果. DeepSeek-V3 在所有长达 128K 的上下文窗口长度上表现良好.

### 4.3. Long Context Extension

We adopt a similar approach to DeepSeek-V2 (DeepSeek-AI, 2024c) to enable long context capabilities in DeepSeek-V3. After the pre-training stage, we apply YaRN (Peng et al., 2023a) for context extension and perform two additional training phases, each comprising 1000 steps, to progressively expand the context window from 4K to 32K and then to 128K. The YaRN configuration is consistent with that used in DeepSeek-V2, being applied exclusively to the decoupled shared key $\mathbf{k}_t^R$. The hyper-parameters remain identical across both phases, with the scale $s = 40, \alpha = 1, \beta = 32$, and the scaling factor $\sqrt{t} = 0.1 \ln s + 1$. In the first phase, the sequence length is set to 32K, and the batch size is 1920. During the second phase, the sequence length is increased to 128K, and the batch size is reduced to 480. The learning rate for both phases is set to $7.3 \times 10^{-6}$, matching the final learning rate from the pre-training stage.

我们采用与 DeepSeek-V2 (DeepSeek-AI, 2024c) 类似的方法来使 DeepSeek-V3 具备长上下文能力. 在预训练阶段之后, 我们应用 YaRN (Peng et al., 2023a) 进行上下文扩展, 并执行两个额外的训练阶段, 每个阶段包含 1000 步, 以逐步将上下文窗口从 4K 扩展到 32K, 再到 128K. YaRN 配置与 DeepSeek-V2 中使用的一致, 仅应用于解耦的共享键 $\mathbf{k}_t^R$. 两个阶段的超参数保持一致, 尺度 $s = 40, \alpha = 1, \beta = 32$, 缩放因子 $\sqrt{t} = 0.1 \ln s + 1$. 在第一阶段, 序列长度设置为 32K, 批量大小为 1920. 在第二阶段, 序列长度增加到 128K, 批量大小减少到 480. 两个阶段的学习率均设置为 $7.3 \times 10^{-6}$, 与预训练阶段的最终学习率相匹配.

Through this two-phase extension training, DeepSeek-V3 is capable of handling inputs up to 128K in length while maintaining strong performance. Figure 8 illustrates that DeepSeek-V3, following supervised fine-tuning, achieves notable performance on the "Needle In A Haystack" (NIAH) test, demonstrating consistent robustness across context window lengths up to 128K.

通过这两阶段扩展训练, DeepSeek-V3 能够处理长达 128K 的输入, 同时保持强劲性能. 图 8 表明, 经过监督微调后的 DeepSeek-V3 在"大海捞针" (Needle In A Haystack, NIAH) 测试中表现优异, 在长达 128K 的上下文窗口长度上展现出一致的鲁棒性.

> 译者注: 长上下文扩展采用"两阶段渐进式"策略 (4K → 32K → 128K), 每阶段仅 1000 步, 这是非常高效的. YaRN 仅应用于解耦共享键 $\mathbf{k}_t^R$ 而非全部 KV, 减少了计算开销. 值得注意的是, 长上下文训练的学习率与预训练最终学习率相同, 属于微调而非从头学习.

### 4.4. Evaluations

#### 4.4.1. Evaluation Benchmarks

The base model of DeepSeek-V3 is pretrained on a multilingual corpus with English and Chinese constituting the majority, so we evaluate its performance on a series of benchmarks primarily in English and Chinese, as well as on a multilingual benchmark. Our evaluation is based on our internal evaluation framework integrated in our HAI-LLM framework. Considered benchmarks are categorized and listed as follows, where underlined benchmarks are in Chinese and double-underlined benchmarks are multilingual ones:

DeepSeek-V3 的基础模型在 multilingual 语料库上预训练, 其中英语和中文占主导地位, 因此我们在一系列主要以英语和中文为主的基准测试上评估其性能, 同时也在多语言基准上评估. 我们的评估基于集成在 HAI-LLM 框架中的内部评估框架. 考虑的基准测试分类如下, 其中下划线标注的为中文基准, 双下划线标注的为多语言基准:

Multi-subject multiple-choice datasets include MMLU (Hendrycks et al., 2020), MMLU-Redux (Gema et al., 2024), MMLU-Pro (Wang et al., 2024b), MMMLU (OpenAI, 2024b), C-Eval (Huang et al., 2023), and CMMLU (Li et al., 2023).

多主题多项选择数据集包括 MMLU (Hendrycks et al., 2020)、MMLU-Redux (Gema et al., 2024)、MMLU-Pro (Wang et al., 2024b)、MMMLU (OpenAI, 2024b)、C-Eval (Huang et al., 2023) 和 CMMLU (Li et al., 2023).

Language understanding and reasoning datasets include HellaSwag (Zellers et al., 2019), PIQA (Bisk et al., 2020), ARC (Clark et al., 2018), and BigBench Hard (BBH) (Suzgun et al., 2022).

语言理解和推理数据集包括 HellaSwag (Zellers et al., 2019)、PIQA (Bisk et al., 2020)、ARC (Clark et al., 2018) 和 BigBench Hard (BBH) (Suzgun et al., 2022).

Closed-book question answering datasets include TriviaQA (Joshi et al., 2017) and NaturalQuestions (Kwiatkowski et al., 2019).

闭卷问答数据集包括 TriviaQA (Joshi et al., 2017) 和 NaturalQuestions (Kwiatkowski et al., 2019).

Reading comprehension datasets include RACE (Lai et al., 2017), DROP (Dua et al., 2019), C3 (Sun et al., 2019a), and CMRC (Cui et al., 2019).

阅读理解数据集包括 RACE (Lai et al., 2017)、DROP (Dua et al., 2019)、C3 (Sun et al., 2019a) 和 CMRC (Cui et al., 2019).

Reference disambiguation datasets include CLUEWSC (Xu et al., 2020) and WinoGrande (Sakaguchi et al., 2019).

指代消歧数据集包括 CLUEWSC (Xu et al., 2020) 和 WinoGrande (Sakaguchi et al., 2019).

Language modeling datasets include Pile (Gao et al., 2020).

语言建模数据集包括 Pile (Gao et al., 2020).

Chinese understanding and culture datasets include CCPM (Li et al., 2021).

中文理解与文化数据集包括 CCPM (Li et al., 2021).

Math datasets include GSM8K (Cobbe et al., 2021), MATH (Hendrycks et al., 2021), MGSM (Shi et al., 2023), and CMath (Wei et al., 2023).

数学数据集包括 GSM8K (Cobbe et al., 2021)、MATH (Hendrycks et al., 2021)、MGSM (Shi et al., 2023) 和 CMath (Wei et al., 2023).

Code datasets include HumanEval (Chen et al., 2021), LiveCodeBench-Base (0801-1101) (Jain et al., 2024), MBPP (Austin et al., 2021), and CRUXEval (Gu et al., 2024).

代码数据集包括 HumanEval (Chen et al., 2021)、LiveCodeBench-Base (0801-1101) (Jain et al., 2024)、MBPP (Austin et al., 2021) 和 CRUXEval (Gu et al., 2024).

Standardized exams include AGIEval (Zhong et al., 2023). Note that AGIEval includes both English and Chinese subsets.

标准化考试包括 AGIEval (Zhong et al., 2023). 注意 AGIEval 包含英语和中文子集.

Following our previous work (DeepSeek-AI, 2024b,c), we adopt perplexity-based evaluation for datasets including HellaSwag, PIQA, WinoGrande, RACE-Middle, RACE-High, MMLU, MMLU-Redux, MMLU-Pro, MMMLU, ARC-Easy, ARC-Challenge, C-Eval, CMMLU, C3, and CCPM, and adopt generation-based evaluation for TriviaQA, NaturalQuestions, DROP, MATH, GSM8K, MGSM, HumanEval, MBPP, LiveCodeBench-Base, CRUXEval, BBH, AGIEval, CLUEWSC, CMRC, and CMath. In addition, we perform language-modeling-based evaluation for Pile-test and use Bits-Per-Byte (BPB) as the metric to guarantee fair comparison among models using different tokenizers.

遵循我们之前的工作 (DeepSeek-AI, 2024b,c), 我们对 HellaSwag、PIQA、WinoGrande、RACE-Middle、RACE-High、MMLU、MMLU-Redux、MMLU-Pro、MMMLU、ARC-Easy、ARC-Challenge、C-Eval、CMMLU、C3 和 CCPM 等数据集采用基于困惑度的评估, 对 TriviaQA、NaturalQuestions、DROP、MATH、GSM8K、MGSM、HumanEval、MBPP、LiveCodeBench-Base、CRUXEval、BBH、AGIEval、CLUEWSC、CMRC 和 CMath 采用基于生成的评估. 此外, 我们对 Pile-test 进行基于语言建模的评估, 并使用 Bits-Per-Byte (BPB) 作为指标, 以保证使用不同分词器的模型之间的公平比较.

#### 4.4.2. Evaluation Results

In Table 3, we compare the base model of DeepSeek-V3 with the state-of-the-art open-source base models, including DeepSeek-V2-Base (DeepSeek-AI, 2024c) (our previous release), Qwen2.5 72B Base (Qwen, 2024b), and LLaMA-3.1 405B Base (AI@Meta, 2024b). We evaluate all these models with our internal evaluation framework, and ensure that they share the same evaluation setting. Note that due to the changes in our evaluation framework over the past months, the performance of DeepSeek-V2-Base exhibits a slight difference from our previously reported results. Overall, DeepSeek-V3-Base comprehensively outperforms DeepSeek-V2-Base and Qwen2.5 72B Base, and surpasses LLaMA-3.1 405B Base in the majority of benchmarks, essentially becoming the strongest open-source model.

在表 3 中, 我们将 DeepSeek-V3 的基础模型与最先进的开源基础模型进行比较, 包括 DeepSeek-V2-Base (DeepSeek-AI, 2024c) (我们之前的版本)、Qwen2.5 72B Base (Qwen, 2024b) 和 LLaMA-3.1 405B Base (AI@Meta, 2024b). 我们在内部评估框架中评估了所有这些模型, 并确保它们共享相同的评估设置. 注意, 由于过去几个月评估框架的变更, DeepSeek-V2-Base 的性能与我们之前报告的结果略有差异. 总体而言, DeepSeek-V3-Base 全面超越 DeepSeek-V2-Base 和 Qwen2.5 72B Base, 并在大多数基准测试中 surpasses LLaMA-3.1 405B Base, 实质上成为最强的开源模型.

<table><tr><td></td><td>Benchmark (Metric)</td><td># Shots</td><td>DeepSeek-V2 Base</td><td>Qwen2.5 72B Base</td><td>LLaMA-3.1 405B Base</td><td>DeepSeek-V3 Base</td></tr><tr><td rowspan="5"></td><td>Architecture</td><td></td><td>MoE</td><td>Dense</td><td>Dense</td><td>MoE</td></tr><tr><td># Activated Params</td><td></td><td>21B</td><td>72B</td><td>405B</td><td>37B</td></tr><tr><td># Total Params</td><td>=</td><td>236B</td><td>72B</td><td>405B</td><td>671B</td></tr><tr><td>Pile-test (BPB)</td><td>1</td><td>0.606</td><td>0.638</td><td>0.542</td><td>0.548</td></tr><tr><td></td><td>3-shot</td><td>78.8</td><td>79.8</td><td></td><td></td></tr><tr><td rowspan="14">English</td><td>BBH (EM)</td><td></td><td></td><td></td><td>82.9</td><td>87.5</td></tr><tr><td>MMLU (EM)</td><td>5-shot</td><td>78.4</td><td>85.0</td><td>84.4</td><td>87.1</td></tr><tr><td>MMLU-Redux (EM)</td><td>5-shot</td><td>75.6</td><td>83.2</td><td>81.3</td><td>86.2</td></tr><tr><td>MMLU-Pro (EM)</td><td>5-shot</td><td>51.4</td><td>58.3</td><td>52.8</td><td>64.4</td></tr><tr><td>DROP (F1)</td><td>3-shot</td><td>80.4</td><td>80.6</td><td>86.0</td><td>89.0</td></tr><tr><td>ARC-Easy (EM)</td><td>25-shot</td><td>97.6</td><td>98.4</td><td>98.4</td><td>98.9</td></tr><tr><td>ARC-Challenge (EM)</td><td>25-shot</td><td>92.2</td><td>94.5</td><td>95.3</td><td>95.3</td></tr><tr><td>HellaSwag (EM)</td><td>10-shot</td><td>87.1</td><td>84.8</td><td>89.2</td><td>88.9</td></tr><tr><td>PIQA (EM)</td><td>O-shot</td><td>83.9</td><td>82.6</td><td>85.9</td><td>84.7</td></tr><tr><td>WinoGrande (EM)</td><td>5-shot</td><td>86.3</td><td>82.3</td><td>85.2</td><td>84.9</td></tr><tr><td>RACE-Middle (EM)</td><td>5-shot</td><td>73.1</td><td>68.1</td><td>74.2</td><td>67.1</td></tr><tr><td>RACE-High (EM)</td><td>5-shot</td><td>52.6</td><td>50.3</td><td>56.8</td><td>51.3</td></tr><tr><td>TriviaQA (EM)</td><td>5-shot</td><td>80.0</td><td>71.9</td><td>82.7</td><td>82.9</td></tr><tr><td>NaturalQuestions (EM) AGIEval (EM)</td><td>5-shot O-shot</td><td></td><td></td><td></td><td></td></tr></table>

Table 3 
| Comparison among DeepSeek-V3-Base and other representative open-source base models. All models are evaluated in our internal framework and share the same evaluation setting. Scores with a gap not exceeding 0.3 are considered to be at the same level. DeepSeek-V3-Base achieves the best performance on most benchmarks, especially on math and code tasks.

表 3 | DeepSeek-V3-Base 与其他代表性开源基础模型的比较. 所有模型均在我们的内部框架中评估并共享相同的评估设置. 差距不超过 0.3 的分数被视为同一水平. DeepSeek-V3-Base 在大多数基准测试中取得了最佳性能, 尤其是在数学和代码任务上.

From a more detailed perspective, we compare DeepSeek-V3-Base with the other open-source base models individually. (1) Compared with DeepSeek-V2-Base, due to the improvements in our model architecture, the scale-up of the model size and training tokens, and the enhancement of data quality, DeepSeek-V3-Base achieves significantly better performance as expected. (2) Compared with Qwen2.5 72B Base, the state-of-the-art Chinese open-source model, with only half of the activated parameters, DeepSeek-V3-Base also demonstrates remarkable advantages, especially on English, multilingual, code, and math benchmarks. As for Chinese benchmarks, except for CMMLU, a Chinese multi-subject multiple-choice task, DeepSeek-V3-Base also shows better performance than Qwen2.5 72B. (3) Compared with LLaMA-3.1 405B Base, the largest open-source model with 11 times the activated parameters, DeepSeek-V3-Base also exhibits much better performance on multilingual, code, and math benchmarks. As for English and Chinese language benchmarks, DeepSeek-V3-Base shows competitive or better performance, and is especially good on BBH, MMLU-series, DROP, C-Eval, CMMLU, and CCPM.

从更详细的角度来看, 我们分别将 DeepSeek-V3-Base 与其他开源基础模型进行比较. (1) 与 DeepSeek-V2-Base 相比, 由于模型架构的改进、模型规模和训练 token 的扩大以及数据质量的提升, DeepSeek-V3-Base 如预期般取得了显著更好的性能. (2) 与 Qwen2.5 72B Base (最先进的开源中文模型) 相比, 仅用一半的激活参数, DeepSeek-V3-Base 也展现出显著优势, 尤其是在英语、多语言、代码和数学基准测试中. 至于中文基准测试, 除了 CMMLU (一个中文多主题多项选择任务) 外, DeepSeek-V3-Base 也表现出比 Qwen2.5 72B 更好的性能. (3) 与 LLaMA-3.1 405B Base (激活参数多 11 倍的最大开源模型) 相比, DeepSeek-V3-Base 在多语言、代码和数学基准测试上也展现出好得多的性能. 至于英语和中文语言基准测试, DeepSeek-V3-Base 展现出有竞争力或更好的性能, 尤其在 BBH、MMLU 系列、DROP、C-Eval、CMMLU 和 CCPM 上表现突出.

Due to our efficient architectures and comprehensive engineering optimizations, DeepSeek-V3 achieves extremely high training efficiency. Under our training framework and infrastructures, training DeepSeek-V3 on each trillion tokens requires only 180K H800 GPU hours, which is much cheaper than training 72B or 405B dense models.

由于我们高效的架构和全面的工程优化, DeepSeek-V3 实现了极高的训练效率. 在我们的训练框架和基础设施下, 训练 DeepSeek-V3 每万亿 token 仅需 180K H800 GPU 小时, 这比训练 72B 或 405B 的稠密模型便宜得多.

> 译者注: 180K H800 GPU 小时 / 万亿 token 是一个惊人的数字. 作为对比, LLaMA-3.1 405B 的训练成本约为 400K+ GPU 小时 / 万亿 token (估算). DeepSeek-V3 用 671B 总参数 (37B 激活) 的模型, 实现了比 405B 稠密模型更低的单位训练成本, 这充分证明了 MoE + FP8 + 工程优化的威力. 这也是开源社区首次在性能超越闭源顶尖模型的同时, 实现训练成本的大幅降低.

<table><tr><td>Benchmark (Metric)</td><td># Shots</td><td>Small MoE Baseline</td><td>Small MoE w/ MTP</td><td>Large MoE Baseline</td><td>Large MoE w/ MTP</td></tr><tr><td>#Activated Params (Inference)</td><td></td><td>2.4B</td><td>2.4B</td><td>20.9B</td><td>20.9B</td></tr><tr><td>#Total Params (Inference)</td><td></td><td>15.7B</td><td>15.7B</td><td>228.7B</td><td>228.7B</td></tr><tr><td># Training Tokens</td><td></td><td>1.33T</td><td>1.33T</td><td>540B</td><td>540B</td></tr><tr><td>Pile-test (BPB)</td><td></td><td>0.729</td><td>0.729</td><td>0.658</td><td>0.657</td></tr><tr><td>BBH (EM)</td><td>3-shot</td><td>39.0</td><td>41.4</td><td>70.0</td><td>70.7</td></tr><tr><td>MMLU (EM)</td><td>5-shot</td><td>50.0</td><td>53.3</td><td>67.5</td><td>66.6</td></tr><tr><td>DROP (F1)</td><td>1-shot</td><td>39.2</td><td>41.3</td><td>68.5</td><td>70.6</td></tr><tr><td>TriviaQA (EM)</td><td>5-shot</td><td>56.9</td><td>57.7</td><td>67.0</td><td>67.3</td></tr><tr><td>NaturalQuestions (EM)</td><td>5-shot</td><td>22.7</td><td>22.3</td><td>27.2</td><td>28.5</td></tr><tr><td>HumanEval (Pass@1)</td><td>O-shot</td><td>20.7</td><td>26.8</td><td>44.5</td><td>53.7</td></tr><tr><td>MBPP (Pass@1)</td><td>3-shot</td><td>35.8</td><td>36.8</td><td>61.6</td><td>62.2</td></tr><tr><td>GSM8K (EM)</td><td>8-shot</td><td>25.4</td><td>31.4</td><td>72.3</td><td>74.0</td></tr><tr><td>MATH (EM)</td><td>4-shot</td><td>10.7</td><td>12.6</td><td>38.6</td><td>39.8</td></tr></table>

Table 4 
| Ablation results for the MTP strategy. The MTP strategy consistently enhances the model performance on most of the evaluation benchmarks.

表 4 | MTP 策略的消融结果. MTP 策略在大多数评估基准测试中持续提升模型性能.

### 4.5. Discussion

#### 4.5.1. Ablation Studies for Multi-Token Prediction

In Table 4, we show the ablation results for the MTP strategy. To be specific, we validate the MTP strategy on top of two baseline models across different scales. At the small scale, we train a baseline MoE model comprising 15.7B total parameters on 1.33T tokens. At the large scale, we train a baseline MoE model comprising 228.7B total parameters on 540B tokens. On top of them, keeping the training data and the other architectures the same, we append a 1-depth MTP module onto them and train two models with the MTP strategy for comparison. Note that during inference, we directly discard the MTP module, so the inference costs of the compared models are exactly the same. From the table, we can observe that the MTP strategy consistently enhances the model performance on most of the evaluation benchmarks.

在表 4 中, 我们展示了 MTP 策略的消融结果. 具体而言, 我们在两个不同规模的基线模型上验证 MTP 策略. 在小规模上, 我们训练了一个总参数 15.7B 的基线 MoE 模型, 在 1.33T token 上训练. 在大规模上, 我们训练了一个总参数 228.7B 的基线 MoE 模型, 在 540B token 上训练. 在此基础上, 保持训练数据和其他架构相同, 我们为它们添加一个深度为 1 的 MTP 模块, 并用 MTP 策略训练两个模型进行比较. 注意, 在推理期间, 我们直接丢弃 MTP 模块, 因此比较模型的推理成本完全相同. 从表中可以看出, MTP 策略在大多数评估基准测试中持续提升模型性能.

#### 4.5.2. Ablation Studies for the Auxiliary-Loss-Free Balancing Strategy

In Table 5, we show the ablation results for the auxiliary-loss-free balancing strategy. We validate this strategy on top of two baseline models across different scales. At the small scale, we train a baseline MoE model comprising 15.7B total parameters on 1.33T tokens. At the large scale, we train a baseline MoE model comprising 228.7B total parameters on 578B tokens.

在表 5 中, 我们展示了无辅助损失均衡策略的消融结果. 我们在两个不同规模的基线模型上验证该策略. 在小规模上, 我们训练了一个总参数 15.7B 的基线 MoE 模型, 在 1.33T token 上训练. 在大规模上, 我们训练了一个总参数 228.7B 的基线 MoE 模型, 在 578B token 上训练.

<table><tr><td>Benchmark (Metric)</td><td># Shots</td><td>Small MoE Aux-Loss-Based</td><td>Small MoE Aux-Loss-Free</td><td>Large MoE Aux-Loss-Based</td><td>Large MoE Aux-Loss-Free</td></tr><tr><td>#Activated Params</td><td></td><td>2.4B</td><td>2.4B</td><td>20.9B</td><td>20.9B</td></tr><tr><td># Total Params</td><td></td><td>15.7B</td><td>15.7B</td><td>228.7B</td><td>228.7B</td></tr><tr><td># Training Tokens</td><td></td><td>1.33T</td><td>1.33T</td><td>578B</td><td>578B</td></tr><tr><td>Pile-test (BPB)</td><td>-</td><td>0.727</td><td>0.724</td><td>0.656</td><td>0.652</td></tr><tr><td>BBH (EM)</td><td>3-shot</td><td>37.3</td><td>39.3</td><td>66.7</td><td>67.9</td></tr><tr><td>MMLU (EM)</td><td>5-shot</td><td>51.0</td><td>51.8</td><td>68.3</td><td>67.2</td></tr><tr><td>DROP (F1)</td><td>1-shot</td><td>38.1</td><td>39.0</td><td>67.1</td><td>67.1</td></tr><tr><td>TriviaQA (EM)</td><td>5-shot</td><td>58.3</td><td>58.5</td><td>66.7</td><td>67.7</td></tr><tr><td>NaturalQuestions (EM)</td><td>5-shot</td><td>23.2</td><td>23.4</td><td>27.1</td><td>28.1</td></tr><tr><td>HumanEval (Pass@1)</td><td>O-shot</td><td>22.0</td><td>22.6</td><td>40.2</td><td>46.3</td></tr><tr><td>MBPP (Pass@1)</td><td>3-shot</td><td>36.6</td><td>35.8</td><td>59.2</td><td>61.2</td></tr><tr><td>GSM8K (EM)</td><td>8-shot</td><td>27.1</td><td>29.6</td><td>70.7</td><td>74.5</td></tr><tr><td>MATH (EM)</td><td>4-shot</td><td>10.9</td><td>11.1</td><td>37.2</td><td>39.6</td></tr></table>

Table 5 
| Ablation results for the auxiliary-loss-free balancing strategy. Compared with the purely auxiliary-loss-based method, the auxiliary-loss-free strategy consistently achieves better model performance on most of the evaluation benchmarks.

表 5 | 无辅助损失均衡策略的消融结果. 与纯辅助损失方法相比, 无辅助损失策略在大多数评估基准测试中持续取得更好的模型性能.

Both of the baseline models purely use auxiliary losses to encourage load balance, and use the sigmoid gating function with top-K affinity normalization. Their hyper-parameters to control the strength of auxiliary losses are the same as DeepSeek-V2-Lite and DeepSeek-V2, respectively. On top of these two baseline models, keeping the training data and the other architectures the same, we remove all auxiliary losses and introduce the auxiliary-loss-free balancing strategy for comparison. From the table, we can observe that the auxiliary-loss-free strategy consistently achieves better model performance on most of the evaluation benchmarks.

两个基线模型均纯粹使用辅助损失来鼓励负载均衡, 并使用带 top-K 亲和度归一化的 sigmoid 门控函数. 它们控制辅助损失强度的超参数分别与 DeepSeek-V2-Lite 和 DeepSeek-V2 相同. 在这两个基线模型之上, 保持训练数据和其他架构相同, 我们移除所有辅助损失并引入无辅助损失均衡策略进行比较. 从表中可以看出, 无辅助损失策略在大多数评估基准测试中持续取得更好的模型性能.

#### 4.5.3. Batch-Wise Load Balance VS. Sequence-Wise Load Balance

The key distinction between auxiliary-loss-free balancing and sequence-wise auxiliary loss lies in their balancing scope: batch-wise versus sequence-wise. Compared with the sequence-wise auxiliary loss, batch-wise balancing imposes a more flexible constraint, as it does not enforce in-domain balance on each sequence. This flexibility allows experts to better specialize in different domains. To validate this, we record and analyze the expert load of a 16B auxiliary-loss-based baseline and a 16B auxiliary-loss-free model on different domains in the Pile test set. As illustrated in Figure 9, we observe that the auxiliary-loss-free model demonstrates greater expert specialization patterns as expected.

无辅助损失均衡与序列级辅助损失的关键区别在于其均衡范围: 批次级 (batch-wise) 与序列级 (sequence-wise). 与序列级辅助损失相比, 批次级均衡施加了更灵活的约束, 因为它不强制每个序列内的域内平衡. 这种灵活性使专家能够更好地专注于不同领域. 为验证这一点, 我们记录并分析了 Pile 测试集上 16B 辅助损失基线模型和 16B 无辅助损失模型在不同领域的专家负载. 如图 9 所示, 我们观察到无辅助损失模型如预期般展现出更强的专家专业化模式.

> 译者注: 批次级均衡 vs 序列级均衡的对比揭示了 MoE 负载均衡中的一个深层权衡: 严格的序列级均衡会强迫每个序列内部均匀分配, 从而损害专家的专业化 (specialization). 批次级均衡给予专家更大的自由度去学习特定领域的知识, 这是无辅助损失策略性能更优的根本原因 —— 它不仅解决了负载均衡问题, 还提升了模型的表征能力.

To further investigate the correlation between this flexibility and the advantage in model performance, we additionally design and validate a batch-wise auxiliary loss that encourages load balance on each training batch instead of on each sequence. The experimental results show that, when achieving a similar level of batch-wise load balance, the batch-wise auxiliary loss can also achieve similar model performance to the auxiliary-loss-free method. To be specific, in our experiments with 1B MoE models, the validation losses are: 2.258 (using a sequence-wise auxiliary loss), 2.253 (using the auxiliary-loss-free method), and 2.253 (using a batch-wise auxiliary loss). We also observe similar results on 3B MoE models: the model using a sequence-wise auxiliary loss achieves a validation loss of 2.085, and the models using the auxiliary-loss-free method or a batch-wise auxiliary loss achieve the same validation loss of 2.080.

为了进一步研究这种灵活性与模型性能优势之间的相关性, 我们额外设计并验证了一种批次级辅助损失, 它在每个训练批次而非每个序列上鼓励负载均衡. 实验结果表明, 当达到相似的批次级负载均衡水平时, 批次级辅助损失也能取得与无辅助损失方法相似的模型性能. 具体而言, 在我们对 1B MoE 模型的实验中, 验证损失分别为: 2.258 (使用序列级辅助损失)、2.253 (使用无辅助损失方法) 和 2.253 (使用批次级辅助损失). 我们在 3B MoE 模型上也观察到类似结果: 使用序列级辅助损失的模型验证损失为 2.085, 使用无辅助损失方法或批次级辅助损失的模型验证损失均为 2.080.

In addition, although the batch-wise load balancing methods show consistent performance advantages, they also face two potential challenges in efficiency: (1) load imbalance within certain sequences or small batches, and (2) domain-shift-induced load imbalance during inference. The first challenge is naturally addressed by our training framework that uses large-scale expert parallelism and data parallelism, which guarantees a large size of each micro-batch. For the second challenge, we also design and implement an efficient inference framework with redundant expert deployment, as described in Section 3.4, to overcome it.

此外, 尽管批次级负载均衡方法展现出持续的性能优势, 它们在效率方面也面临两个潜在挑战: (1) 某些序列或小批次内的负载不均衡, (2) 推理期间领域偏移引起的负载不均衡. 第一个挑战被我们使用大规模专家并行和数据并行的训练框架自然解决, 这保证了每个微批次具有较大的大小. 对于第二个挑战, 我们也设计并实现了高效的推理框架, 采用冗余专家部署, 如第 3.4 节所述, 以克服它.

![](images/fig09_expert_load_comparison.jpg)  
Figure 9 | Expert load of auxiliary-loss-free and auxiliary-loss-based models on three domains in the Pile test set. The auxiliary-loss-free model shows greater expert specialization patterns than the auxiliary-loss-based one. The relative expert load denotes the ratio between the actual expert load and the theoretically balanced expert load. Due to space constraints, we only present the results of two layers as an example, with the results of all layers provided in Appendix C.

图 9 | 无辅助损失和辅助损失模型在 Pile 测试集三个领域上的专家负载. 无辅助损失模型展现出比辅助损失模型更强的专家专业化模式. 相对专家负载表示实际专家负载与理论均衡专家负载之间的比率. 由于空间限制, 我们仅展示两层的结果作为示例, 所有层的结果见附录 C.

## 5. Post-Training

### 5.1. Supervised Fine-Tuning

We curate our instruction-tuning datasets to include 1.5M instances spanning multiple domains, with each domain employing distinct data creation methods tailored to its specific requirements.

我们精心策划了指令微调数据集, 包含 150 万个实例, 涵盖多个领域, 每个领域采用针对其特定需求定制的数据创建方法.

Reasoning Data. For reasoning-related datasets, including those focused on mathematics, code competition problems, and logic puzzles, we generate the data by leveraging an internal DeepSeek-R1 model. Specifically, while the R1-generated data demonstrates strong accuracy, it suffers from issues such as overthinking, poor formatting, and excessive length. Our objective is to balance the high accuracy of R1-generated reasoning data and the clarity and conciseness of regularly formatted reasoning data.

推理数据. 对于推理相关数据集, 包括专注于数学、代码竞赛问题和逻辑谜题的数据集, 我们利用内部 DeepSeek-R1 模型生成数据. 具体而言, 虽然 R1 生成的数据展现出很强的准确性, 但它存在过度思考、格式不佳和过长等问题. 我们的目标是在 R1 生成推理数据的高准确性与常规格式化推理数据的清晰简洁之间取得平衡.

> 译者注: 这里首次公开确认了 DeepSeek-V3 的后训练使用了 DeepSeek-R1 (尚未公开的推理模型) 生成的数据. R1 数据具有高准确性但存在"过度思考"问题, 这暗示 R1 是一个类似 o1 的推理模型, 使用长思维链 (long CoT). DeepSeek-V3 并非直接蒸馏 R1, 而是通过精心设计的流程取其精华、去其糟粕.

To establish our methodology, we begin by developing an expert model tailored to a specific domain, such as code, mathematics, or general reasoning, using a combined Supervised Fine-Tuning (SFT) and Reinforcement Learning (RL) training pipeline. This expert model serves as a data generator for the final model. The training process involves generating two distinct types of SFT samples for each instance: the first couples the problem with its original response in the format of <problem, original response>, while the second incorporates a system prompt alongside the problem and the R1 response in the format of <system prompt, problem, R1 response>.

为了建立我们的方法论, 我们首先开发一个针对特定领域 (如代码、数学或通用推理) 定制的专家模型, 使用监督微调 (SFT) 和强化学习 (RL) 相结合的训练流程. 该专家模型作为最终模型的数据生成器. 训练过程涉及为每个实例生成两种不同类型的 SFT 样本: 第一种将问题与其原始回复配对, 格式为 <问题, 原始回复>; 第二种将系统提示与问题和 R1 回复结合, 格式为 <系统提示, 问题, R1 回复>.

The system prompt is meticulously designed to include instructions that guide the model toward producing responses enriched with mechanisms for reflection and verification. During the RL phase, the model leverages high-temperature sampling to generate responses that integrate patterns from both the R1-generated and original data, even in the absence of explicit system prompts. After hundreds of RL steps, the intermediate RL model learns to incorporate R1 patterns, thereby enhancing overall performance strategically.

系统提示经过精心设计, 包含引导模型生成富含反思和验证机制回复的指令. 在 RL 阶段, 模型利用高温采样生成回复, 整合来自 R1 生成数据和原始数据的模式, 即使没有显式的系统提示. 经过数百个 RL 步骤后, 中间 RL 模型学会融入 R1 模式, 从而战略性地提升整体性能.

Upon completing the RL training phase, we implement rejection sampling to curate high-quality SFT data for the final model, where the expert models are used as data generation sources. This method ensures that the final training data retains the strengths of DeepSeek-R1 while producing responses that are concise and effective.

完成 RL 训练阶段后, 我们实施拒绝采样 (rejection sampling), 为最终模型筛选高质量 SFT 数据, 其中专家模型被用作数据来源. 这种方法确保最终训练数据保留 DeepSeek-R1 的优势, 同时产生简洁有效的回复.

Non-Reasoning Data. For non-reasoning data, such as creative writing, role-play, and simple question answering, we utilize DeepSeek-V2.5 to generate responses and enlist human annotators to verify the accuracy and correctness of the data.

非推理数据. 对于非推理数据, 如创意写作、角色扮演和简单问答, 我们利用 DeepSeek-V2.5 生成回复, 并招募人工标注员验证数据的准确性和正确性.

SFT Settings. We fine-tune DeepSeek-V3-Base for two epochs using the SFT dataset, using the cosine decay learning rate scheduling that starts at $5 \times 10^{-6}$ and gradually decreases to $1 \times 10^{-6}$. During training, each single sequence is packed from multiple samples. However, we adopt a sample masking strategy to ensure that these examples remain isolated and mutually invisible.

SFT 设置. 我们使用 SFT 数据集对 DeepSeek-V3-Base 进行两个 epoch 的微调, 采用余弦衰减学习率调度, 从 $5 \times 10^{-6}$ 开始逐渐降低到 $1 \times 10^{-6}$. 训练期间, 每个单一序列由多个样本打包而成. 然而, 我们采用样本掩码策略, 以确保这些示例保持隔离且互不可见.

> 译者注: 后训练的数据构建流程相当复杂: SFT+RL 训练领域专家模型 → 专家模型生成带 R1 模式的数据 → 拒绝采样筛选高质量数据 → 最终 SFT. 这是一种"模型生成数据, 数据训练模型"的自举 (bootstrapping) 范式. 值得注意的是, 非推理数据仍用 V2.5 生成而非 R1, 说明 R1 可能只擅长推理任务, 在通用对话上未必优于 V2.5.

### 5.2. Reinforcement Learning

#### 5.2.1. Reward Model

We employ a rule-based Reward Model (RM) and a model-based RM in our RL process.

我们在 RL 过程中采用基于规则的奖励模型 (RM) 和基于模型的 RM.

Rule-Based RM. For questions that can be validated using specific rules, we adopt a rule-based reward system to determine the feedback. For instance, certain math problems have deterministic results, and we require the model to provide the final answer within a designated format (e.g., in a box), allowing us to apply rules to verify the correctness. Similarly, for LeetCode problems, we can utilize a compiler to generate feedback based on test cases. By leveraging rule-based validation wherever possible, we ensure a higher level of reliability, as this approach is resistant to manipulation or exploitation.

基于规则的 RM. 对于可以使用特定规则验证的问题, 我们采用基于规则的奖励系统来确定反馈. 例如, 某些数学问题具有确定性结果, 我们要求模型以指定格式 (如在方框中) 提供最终答案, 使我们能够应用规则验证正确性. 类似地, 对于 LeetCode 问题, 我们可以利用编译器基于测试用例生成反馈. 通过在可能的情况下利用基于规则的验证, 我们确保更高水平的可靠性, 因为这种方法不易被操纵或利用.

> 译者注: 基于规则的奖励系统对防止奖励劫持 (reward hacking) 至关重要. 数学和代码任务天然适合规则验证, 这使得 RL 在这些领域特别有效. 对于开放性问题则必须使用模型-based RM, 但后者更容易被策略模型"欺骗" —— 因此文中提到要加入思维链来缓解.

Model-Based RM. For questions with free-form ground-truth answers, we rely on the reward model to determine whether the response matches the expected ground-truth. Conversely, for questions without a definitive ground-truth, such as those involving creative writing, the reward model is tasked with providing feedback based on the question and the corresponding answer as inputs. The reward model is trained from the DeepSeek-V3 SFT checkpoints. To enhance its reliability, we construct preference data that not only provides the final reward but also includes the chain-of-thought leading to the reward. This approach helps mitigate the risk of reward hacking in specific tasks.

基于模型的 RM. 对于具有自由形式标准答案的问题, 我们依赖奖励模型来确定回复是否与预期的标准答案匹配. 相反, 对于没有确定标准答案的问题, 如涉及创意写作的问题, 奖励模型的任务是基于问题和相应答案作为输入提供反馈. 奖励模型从 DeepSeek-V3 SFT 检查点训练而来. 为了增强其可靠性, 我们构建的偏好数据不仅提供最终奖励, 还包括导致该奖励的思维链. 这种方法有助于缓解特定任务中奖励劫持的风险.

#### 5.2.2. Group Relative Policy Optimization

Similar to DeepSeek-V2 (DeepSeek-AI, 2024c), we adopt Group Relative Policy Optimization (GRPO) (Shao et al., 2024), which foregoes the critic model that is typically with the same size as the policy model, and estimates the baseline from group scores instead. Specifically, for each question $q$, GRPO samples a group of outputs $\{o_1, o_2, \cdots, o_G\}$ from the old policy model $\pi_{\theta_{old}}$ and then optimizes the policy model $\pi_{\theta}$ by maximizing the following objective:

与 DeepSeek-V2 (DeepSeek-AI, 2024c) 类似, 我们采用 Group Relative Policy Optimization (GRPO) (Shao et al., 2024), 它放弃了通常与策略模型大小相同的评论模型 (critic model), 转而从组分数中估计基线. 具体而言, 对于每个问题 $q$, GRPO 从旧策略模型 $\pi_{\theta_{old}}$ 中采样一组输出 $\{o_1, o_2, \cdots, o_G\}$, 然后通过最大化以下目标来优化策略模型 $\pi_{\theta}$:

$$
\begin{array} { l } { \displaystyle \mathcal { J } _ { G R P O } ( \theta ) = \mathbb { E } \big [ q \sim P ( Q ) , \{ o _ { i } \} _ { i = 1 } ^ { G } \sim \pi _ { \theta _ { o d d } } ( O | q ) \big ] } \\ { \displaystyle \frac { 1 } { G } \sum _ { i = 1 } ^ { G } \left( \operatorname* { m i n } \left( \frac { \pi _ { \theta } ( o _ { i } | q ) } { \pi _ { \theta _ { o d d } } ( o _ { i } | q ) } A _ { i } , \mathrm { c l i p } \left( \frac { \pi _ { \theta } ( o _ { i } | q ) } { \pi _ { \theta _ { o d d } } ( o _ { i } | q ) } , 1 - \varepsilon , 1 + \varepsilon \right) A _ { i } \right) - \beta \mathbb { D } _ { K L } \left( \pi _ { \theta } | | \pi _ { r e f } \right) \right) , } \end{array}\tag{26}
$$

$$
\mathbb { D } _ { K L } \left( \pi _ { \theta } | | \pi _ { r e f } \right) = \frac { \pi _ { r e f } ( o _ { i } | q ) } { \pi _ { \theta } ( o _ { i } | q ) } - \log \frac { \pi _ { r e f } ( o _ { i } | q ) } { \pi _ { \theta } ( o _ { i } | q ) } - 1 ,\tag{27}
$$

where $\epsilon$ and $\beta$ are hyper-parameters; $\pi_{ref}$ is the reference model; and $A_i$ is the advantage, derived from the rewards $\{r_1, r_2, \ldots, r_G\}$ corresponding to the outputs within each group:

其中 $\epsilon$ 和 $\beta$ 是超参数; $\pi_{ref}$ 是参考模型; $A_i$ 是优势, 由每组内输出对应的奖励 $\{r_1, r_2, \ldots, r_G\}$ 推导而来:

$$
A _ { i } = { \frac { r _ { i } - \operatorname* { m e a n } ( \{ r _ { 1 } , r _ { 2 } , \cdots , r _ { G } \} ) } { { \mathrm { s t d } } ( \{ r _ { 1 } , r _ { 2 } , \cdots , r _ { G } \} ) } } .\tag{28}
$$

We incorporate prompts from diverse domains, such as coding, math, writing, role-playing, and question answering, during the RL process. This approach not only aligns the model more closely with human preferences but also enhances performance on benchmarks, especially in scenarios where available SFT data are limited.

我们在 RL 过程中纳入来自多个领域的提示, 如编程、数学、写作、角色扮演和问答. 这种方法不仅使模型更紧密地与人类偏好对齐, 还提升了在基准测试上的性能, 尤其是在可用 SFT 数据有限的场景中.

> 译者注: GRPO 是 PPO 的变体, 核心优势是不需要同等大小的 Critic 模型, 大幅降低了 RL 训练的内存和计算开销. 组内相对奖励 (group relative advantage) 的设计非常巧妙: 同一问题的多个采样输出互相作为参照, 天然归一化了问题难度差异. 这也是 DeepSeek 在资源受限情况下仍能开展大规模 RL 的关键.

### 5.3. Evaluations

#### 5.3.1. Evaluation Settings

Evaluation Benchmarks. Apart from the benchmark we used for base model testing, we further evaluate instructed models on IFEval (Zhou et al., 2023), FRAMES (Krishna et al., 2024), LongBench v2 (Bai et al., 2024), GPQA (Rein et al., 2023), SimpleQA (OpenAI, 2024c), C-SimpleQA (He et al., 2024), SWE-Bench Verified (OpenAI, 2024d), Aider, LiveCodeBench (Jain et al., 2024) (questions from August 2024 to November 2024), Codeforces, Chinese National High School Mathematics Olympiad (CNMO 2024), and American Invitational Mathematics Examination 2024 (AIME 2024) (MAA, 2024).

评估基准. 除了用于基础模型测试的基准外, 我们还在 IFEval (Zhou et al., 2023)、FRAMES (Krishna et al., 2024)、LongBench v2 (Bai et al., 2024)、GPQA (Rein et al., 2023)、SimpleQA (OpenAI, 2024c)、C-SimpleQA (He et al., 2024)、SWE-Bench Verified (OpenAI, 2024d)、Aider、LiveCodeBench (Jain et al., 2024) (2024 年 8 月至 11 月的问题)、Codeforces、中国全国高中数学奥林匹克 (CNMO 2024) 和美国数学邀请赛 2024 (AIME 2024) (MAA, 2024) 上进一步评估指令模型.

Compared Baselines. We conduct comprehensive evaluations of our chat model against several strong baselines, including DeepSeek-V2-0506, DeepSeek-V2.5-0905, Qwen2.5 72B Instruct, LLaMA-3.1 405B Instruct, Claude-Sonnet-3.5-1022, and GPT-4o-0513. For the DeepSeek-V2 model series, we select the most representative variants for comparison. For closed-source models, evaluations are performed through their respective APIs.

对比基线. 我们对我们的对话模型与几个强基线进行全面评估, 包括 DeepSeek-V2-0506、DeepSeek-V2.5-0905、Qwen2.5 72B Instruct、LLaMA-3.1 405B Instruct、Claude-Sonnet-3.5-1022 和 GPT-4o-0513. 对于 DeepSeek-V2 模型系列, 我们选择最具代表性的变体进行比较. 对于闭源模型, 评估通过其各自的 API 进行.

Detailed Evaluation Configurations. For standard benchmarks including MMLU, DROP, GPQA, and SimpleQA, we adopt the evaluation prompts from the simple-evals framework.

详细评估配置. 对于包括 MMLU、DROP、GPQA 和 SimpleQA 在内的标准基准, 我们采用 simple-evals 框架的评估提示.

We utilize the Zero-Eval prompt format (Lin, 2024) for MMLU-Redux in a zero-shot setting. For other datasets, we follow their original evaluation protocols with default prompts as provided by the dataset creators. For code and math benchmarks, the HumanEval-Mul dataset includes 8 mainstream programming languages (Python, Java, Cpp, C#, JavaScript, TypeScript, PHP, and Bash) in total. We use CoT and non-CoT methods to evaluate model performance on LiveCodeBench, where the data are collected from August 2024 to November 2024. The Codeforces dataset is measured using the percentage of competitors. SWE-Bench verified is evaluated using the agentless framework (Xia et al., 2024). We use the "diff" format to evaluate the Aider-related benchmarks. For mathematical assessments, AIME and CNMO 2024 are evaluated with a temperature of 0.7, and the results are averaged over 16 runs, while MATH-500 employs greedy decoding. We allow all models to output a maximum of 8192 tokens for each benchmark.

我们对 MMLU-Redux 在 zero-shot 设置下使用 Zero-Eval 提示格式 (Lin, 2024). 对于其他数据集, 我们遵循其原始评估协议, 使用数据集创建者提供的默认提示. 对于代码和数学基准, HumanEval-Mul 数据集共包含 8 种主流编程语言 (Python、Java、Cpp、C#、JavaScript、TypeScript、PHP 和 Bash). 我们使用 CoT 和非 CoT 方法评估模型在 LiveCodeBench 上的性能, 数据收集自 2024 年 8 月至 11 月. Codeforces 数据集使用参赛者百分比作为衡量指标. SWE-Bench Verified 使用 agentless 框架 (Xia et al., 2024) 进行评估. 我们使用 "diff" 格式评估 Aider 相关基准. 对于数学评估, AIME 和 CNMO 2024 以温度 0.7 进行评估, 结果取 16 次运行的平均值, 而 MATH-500 采用贪心解码. 我们允许所有模型在每个基准测试中最多输出 8192 个 token.

<table><tr><td rowspan=1 colspan=2>Benchmark (Metric)</td><td rowspan=1 colspan=1>|DeepSeek DeepSeek|V2-0506V2.5-0905</td><td rowspan=1 colspan=1>|Qwen2.5 LLaMA-3.1 Claude-3.5- GPT-4072B-Inst.405B-Inst.Sonnet-1022 0513</td><td rowspan=1 colspan=1>|DeepSeekV3</td></tr><tr><td rowspan=3 colspan=2>Architecture#Activated Params# Total Params</td><td rowspan=1 colspan=1>MoE     MoE</td><td rowspan=3 colspan=1>Dense    Dense                     172B      405B                      =72B      405B          1          1</td><td rowspan=3 colspan=1>MoE37B671B</td></tr><tr><td rowspan=1 colspan=1>21B      21B</td></tr><tr><td rowspan=1 colspan=1>236B      236B</td></tr><tr><td rowspan=3 colspan=2>MMLU (EM)MMLU-Redux (EM)MMLU-Pro (EM)</td><td rowspan=1 colspan=1>78.2      80.6</td><td rowspan=1 colspan=1>85.3      88.6        88.3      87.2</td><td rowspan=1 colspan=1>88.5</td></tr><tr><td rowspan=1 colspan=1>77.9       80.3</td><td rowspan=1 colspan=1>85.6      86.2        88.9      88.0</td><td rowspan=1 colspan=1>89.1</td></tr><tr><td rowspan=1 colspan=1>4MLU-PrO(EM)</td><td rowspan=1 colspan=1>58.5      66.2</td><td rowspan=1 colspan=1>71.6      73.3        78.0      72.6</td><td rowspan=1 colspan=1>75.9</td></tr><tr><td rowspan=6 colspan=2>DROP (3-shot F1)EnglishIF-Eval (Prompt Strict)GPQA-Diamond (Pass@1)SimpleQA (Correct)FRAMES (Acc.)LongBench v2 (Acc.)</td><td rowspan=1 colspan=1>ROP(3-shot F1)</td><td rowspan=1 colspan=1>83.0       87.8</td><td rowspan=1 colspan=1>76.7      88.7        88.3      83.7</td></tr><tr><td rowspan=1 colspan=1>57.7      80.6</td><td rowspan=1 colspan=1>84.1      86.0        86.5      84.3</td><td rowspan=1 colspan=1>86.1</td></tr><tr><td rowspan=1 colspan=1>35.3      41.3</td><td rowspan=1 colspan=1>49.0      51.1        65.0      49.9</td><td rowspan=1 colspan=1>59.1</td></tr><tr><td rowspan=1 colspan=1>9.0       10.2</td><td rowspan=1 colspan=1>9.1       17.1        28.4      38.2</td><td rowspan=1 colspan=1>24.9</td></tr><tr><td rowspan=1 colspan=1></td><td rowspan=1 colspan=1></td><td rowspan=1 colspan=1></td></tr><tr><td rowspan=1 colspan=1></td><td rowspan=1 colspan=1></td><td rowspan=1 colspan=1></td></tr></table>

Table 6 
| Comparison between DeepSeek-V3 and other representative chat models. All models are evaluated in a configuration that limits the output length to 8K. Benchmarks containing fewer than 1000 samples are tested multiple times using varying temperature settings to derive robust final results. DeepSeek-V3 stands as the best-performing open-source model, and also exhibits competitive performance against frontier closed-source models.

表 6 | DeepSeek-V3 与其他代表性对话模型的比较. 所有模型均在限制输出长度为 8K 的配置下评估. 包含少于 1000 个样本的基准测试使用不同温度设置多次测试以获得鲁棒的最终结果. DeepSeek-V3 是表现最好的开源模型, 并且与前沿闭源模型相比也展现出有竞争力的性能.

#### 5.3.2. Standard Evaluation

Table 6 presents the evaluation results, showcasing that DeepSeek-V3 stands as the best-performing open-source model. Additionally, it is competitive against frontier closed-source models like GPT-4o and Claude-3.5-Sonnet.

表 6 展示了评估结果, 表明 DeepSeek-V3 是表现最好的开源模型. 此外, 它与 GPT-4o 和 Claude-3.5-Sonnet 等前沿闭源模型相比也具有竞争力.

English Benchmarks. MMLU is a widely recognized benchmark designed to assess the performance of large language models, across diverse knowledge domains and tasks. DeepSeek-V3 demonstrates competitive performance, standing on par with top-tier models such as LLaMA-3.1-405B, GPT-4o, and Claude-Sonnet 3.5, while significantly outperforming Qwen2.5 72B. Moreover, DeepSeek-V3 excels in MMLU-Pro, a more challenging educational knowledge benchmark, where it closely trails Claude-Sonnet 3.5. On MMLU-Redux, a refined version of MMLU with corrected labels, DeepSeek-V3 surpasses its peers. In addition, on GPQA-Diamond, a PhD-level evaluation testbed, DeepSeek-V3 achieves remarkable results, ranking just behind Claude 3.5 Sonnet and outperforming all other competitors by a substantial margin.

英语基准. MMLU 是一个广泛认可的基准, 旨在评估大语言模型在多样化知识领域和任务中的性能. DeepSeek-V3 展现出有竞争力的性能, 与 LLaMA-3.1-405B、GPT-4o 和 Claude-Sonnet 3.5 等顶级模型并驾齐驱, 同时显著超越 Qwen2.5 72B. 此外, DeepSeek-V3 在 MMLU-Pro (一个更具挑战性的教育知识基准) 上表现出色, 仅略逊于 Claude-Sonnet 3.5. 在 MMLU-Redux (MMLU 的修正标签 refined 版本) 上, DeepSeek-V3 超越了同类模型. 此外, 在 GPQA-Diamond (一个博士级评估测试平台) 上, DeepSeek-V3 取得了显著成果, 仅次于 Claude 3.5 Sonnet, 并以显著优势超越所有其他竞争对手.

In long-context understanding benchmarks such as DROP, LongBench v2, and FRAMES, DeepSeek-V3 continues to demonstrate its position as a top-tier model. It achieves an impressive 91.6 F1 score in the 3-shot setting on DROP, outperforming all other models in this category. On FRAMES, a benchmark requiring question-answering over 100k token contexts, DeepSeek-V3 closely trails GPT-4o while outperforming all other models by a significant margin. This demonstrates the strong capability of DeepSeek-V3 in handling extremely long-context tasks. The long-context capability of DeepSeek-V3 is further validated by its best-in-class performance on LongBench v2, a dataset that was released just a few weeks before the launch of DeepSeek V3. On the factual knowledge benchmark, SimpleQA, DeepSeek-V3 falls behind GPT-4o and Claude-Sonnet, primarily due to its design focus and resource allocation. DeepSeek-V3 assigns more training tokens to learn Chinese knowledge, leading to exceptional performance on the C-SimpleQA. On the instruction-following benchmark, DeepSeek-V3 significantly outperforms its predecessor, DeepSeek-V2-series, highlighting its improved ability to understand and adhere to user-defined format constraints.

在长上下文理解基准测试如 DROP、LongBench v2 和 FRAMES 上, DeepSeek-V3 继续展现出其顶级模型的地位. 它在 DROP 的 3-shot 设置中取得了令人印象深刻的 91.6 F1 分数, 超越了该类别的所有其他模型. 在 FRAMES (一个需要在 100k token 上下文上进行问答的基准) 上, DeepSeek-V3 紧随 GPT-4o 之后, 同时以显著优势超越所有其他模型. 这展示了 DeepSeek-V3 处理极长上下文任务的强大能力. DeepSeek-V3 的长上下文能力进一步通过其在 LongBench v2 上的最佳表现得到验证, 该数据集在 DeepSeek V3 发布前几周才发布. 在事实知识基准 SimpleQA 上, DeepSeek-V3 落后于 GPT-4o 和 Claude-Sonnet, 主要是由于其设计重点和资源分配. DeepSeek-V3 分配更多训练 token 来学习中文知识, 从而在 C-SimpleQA 上表现出众. 在指令遵循基准上, DeepSeek-V3 显著超越其前身 DeepSeek-V2 系列, 突显了其理解和遵循用户定义格式约束能力的提升.

> 译者注: 评估结果中有几个亮点和遗憾: (1) DROP 91.6 F1 和 FRAMES 上的强劲表现证明了 128K 长上下文扩展的成功; (2) SimpleQA 上落后于 GPT-4o 和 Claude, 作者归因于"设计重点和资源分配" (即更多资源分配给中文知识), 这是一个坦诚的局限说明; (3) 在 LongBench v2 (发布于 V3 之前几周) 上的最佳表现说明模型没有针对性过拟合到旧基准.

Code and Math Benchmarks. Coding is a challenging and practical task for LLMs, encompassing engineering-focused tasks like SWE-Bench-Verified and Aider, as well as algorithmic tasks such as HumanEval and LiveCodeBench. In engineering tasks, DeepSeek-V3 trails behind Claude-Sonnet-3.5-1022 but significantly outperforms open-source models. The open-source DeepSeek-V3 is expected to foster advancements in coding-related engineering tasks. By providing access to its robust capabilities, DeepSeek-V3 can drive innovation and improvement in areas such as software engineering and algorithm development, empowering developers and researchers to push the boundaries of what open-source models can achieve in coding tasks. In algorithmic tasks, DeepSeek-V3 demonstrates superior performance, outperforming all baselines on benchmarks like HumanEval-Mul and LiveCodeBench. This success can be attributed to its advanced knowledge distillation technique, which effectively enhances its code generation and problem-solving capabilities in algorithm-focused tasks.

代码和数学基准. 编码对 LLM 来说是一项具有挑战性且实用的任务, 涵盖以工程为重点的任务如 SWE-Bench-Verified 和 Aider, 以及算法任务如 HumanEval 和 LiveCodeBench. 在工程任务中, DeepSeek-V3 落后于 Claude-Sonnet-3.5-1022, 但显著超越开源模型. 开源的 DeepSeek-V3 有望促进与编码相关的工程任务的进步. 通过提供其强大能力的访问, DeepSeek-V3 可以推动软件工程和算法开发等领域的创新和改进, 使开发者和研究人员能够突破开源模型在编码任务中所能实现的边界. 在算法任务中, DeepSeek-V3 展现出卓越性能, 在 HumanEval-Mul 和 LiveCodeBench 等基准上超越所有基线. 这一成功可归因于其先进的知识蒸馏技术, 有效提升了其在算法导向任务中的代码生成和问题解决能力.

On math benchmarks, DeepSeek-V3 demonstrates exceptional performance, significantly surpassing baselines and setting a new state-of-the-art for non-o1-like models. Specifically, on AIME, MATH-500, and CNMO 2024, DeepSeek-V3 outperforms the second-best model, Qwen2.5 72B, by approximately 10% in absolute scores, which is a substantial margin for such challenging benchmarks. This remarkable capability highlights the effectiveness of the distillation technique from DeepSeek-R1, which has been proven highly beneficial for non-o1-like models.

在数学基准上, DeepSeek-V3 展现出卓越性能, 显著超越基线, 并为非 o1 类模型设立了新的最先进水平. 具体而言, 在 AIME、MATH-500 和 CNMO 2024 上, DeepSeek-V3 以约 10% 的绝对分数优势超越第二名 Qwen2.5 72B, 对于如此具有挑战性的基准来说, 这是一个巨大的差距. 这一非凡能力凸显了来自 DeepSeek-R1 的蒸馏技术的有效性, 该技术已被证明对非 o1 类模型非常有益.

Chinese Benchmarks. Qwen and DeepSeek are two representative model series with robust support for both Chinese and English. On the factual benchmark Chinese SimpleQA, DeepSeek-V3 surpasses Qwen2.5-72B by 16.4 points, despite Qwen2.5 being trained on a larger corpus compromising 18T tokens, which are 20% more than the 14.8T tokens that DeepSeek-V3 is pre-trained on.

中文基准. Qwen 和 DeepSeek 是两个具有强大中英文支持的代表性模型系列. 在事实基准 Chinese SimpleQA 上, DeepSeek-V3 以 16.4 分的优势超越 Qwen2.5-72B, 尽管 Qwen2.5 在更大的语料库上训练, 包含 18T token, 比 DeepSeek-V3 预训练的 14.8T token 多 20%.

<table><tr><td>Model</td><td>Arena-Hard</td><td>AlpacaEval 2.0</td></tr><tr><td>DeepSeek-V2.5-0905</td><td>76.2</td><td>50.5</td></tr><tr><td>Qwen2.5-72B-Instruct</td><td>81.2</td><td>49.1</td></tr><tr><td>LLaMA-3.1405B</td><td>69.3</td><td>40.5</td></tr><tr><td>GPT-4o-0513</td><td>80.4</td><td>51.1</td></tr><tr><td>Claude-Sonnet-3.5-1022</td><td>85.2</td><td>52.0</td></tr><tr><td>DeepSeek-V3</td><td>85.5</td><td>70.0</td></tr></table>

Table 7 
| English open-ended conversation evaluations. For AlpacaEval 2.0, we use the length-controlled win rate as the metric.

表 7 | 英语开放式对话评估. 对于 AlpacaEval 2.0, 我们使用长度控制胜率作为指标.

On C-Eval, a representative benchmark for Chinese educational knowledge evaluation, and CLUEWSC (Chinese Winograd Schema Challenge), DeepSeek-V3 and Qwen2.5-72B exhibit similar performance levels, indicating that both models are well-optimized for challenging Chinese-language reasoning and educational tasks.

在 C-Eval (中文教育知识评估的代表性基准) 和 CLUEWSC (中文 Winograd Schema 挑战) 上, DeepSeek-V3 和 Qwen2.5-72B 展现出相似的性能水平, 表明两个模型都针对具有挑战性的中文语言推理和教育任务进行了良好优化.

#### 5.3.3. Open-Ended Evaluation

In addition to standard benchmarks, we also evaluate our models on open-ended generation tasks using LLMs as judges, with the results shown in Table 7. Specifically, we adhere to the original configurations of AlpacaEval 2.0 (Dubois et al., 2024) and Arena-Hard (Li et al., 2024a), which leverage GPT-4-Turbo-1106 as judges for pairwise comparisons. On Arena-Hard, DeepSeek-V3 achieves an impressive win rate of over 86% against the baseline GPT-4-0314, performing on par with top-tier models like Claude-Sonnet-3.5-1022. This underscores the robust capabilities of DeepSeek-V3, especially in dealing with complex prompts, including coding and debugging tasks. Furthermore, DeepSeek-V3 achieves a groundbreaking milestone as the first open-source model to surpass 85% on the Arena-Hard benchmark. This achievement significantly bridges the performance gap between open-source and closed-source models, setting a new standard for what open-source models can accomplish in challenging domains.

除了标准基准测试外, 我们还使用 LLM 作为评判者在开放式生成任务上评估我们的模型, 结果如表 7 所示. 具体而言, 我们遵循 AlpacaEval 2.0 (Dubois et al., 2024) 和 Arena-Hard (Li et al., 2024a) 的原始配置, 使用 GPT-4-Turbo-1106 作为评判者进行成对比较. 在 Arena-Hard 上, DeepSeek-V3 对基线 GPT-4-0314 实现了超过 86% 的令人印象深刻的胜率, 与 Claude-Sonnet-3.5-1022 等顶级模型表现相当. 这凸显了 DeepSeek-V3 的强大能力, 尤其是在处理复杂提示 (包括编码和调试任务) 方面. 此外, DeepSeek-V3 实现了一个开创性的里程碑: 成为首个在 Arena-Hard 基准上超越 85% 的开源模型. 这一成就显著缩小了开源与闭源模型之间的性能差距, 为开源模型在具有挑战性领域中所能实现的成就树立了新标准.

Similarly, DeepSeek-V3 showcases exceptional performance on AlpacaEval 2.0, outperforming both closed-source and open-source models. This demonstrates its outstanding proficiency in writing tasks and handling straightforward question-answering scenarios. Notably, it surpasses DeepSeek-V2.5-0905 by a significant margin of 20%, highlighting substantial improvements in tackling simple tasks and showcasing the effectiveness of its advancements.

类似地, DeepSeek-V3 在 AlpacaEval 2.0 上展现出卓越性能, 超越了闭源和开源模型. 这展示了其在写作任务和处理简单问答场景方面的杰出能力. 值得注意的是, 它以 20% 的显著优势超越 DeepSeek-V2.5-0905, 突显了在处理简单任务方面的实质性改进, 展示了其进步的有效性.

> 译者注: Arena-Hard >85% 和 AlpacaEval 2.0 70% 的胜率是极具标志性的成果. 这不仅意味着 DeepSeek-V3 在标准基准上强, 在开放式对话质量上也达到了顶尖水平. 20% 的相对提升 (对比 V2.5) 说明了后训练流程 (R1 蒸馏 + GRPO + Self-Rewarding) 的巨大价值.

#### 5.3.4. DeepSeek-V3 as a Generative Reward Model

We compare the judgment ability of DeepSeek-V3 with state-of-the-art models, namely GPT-4o and Claude-3.5. Table 8 presents the performance of these models in RewardBench (Lambert et al., 2024). DeepSeek-V3 achieves performance on par with the best versions of GPT-4o-0806 and Claude-3.5-Sonnet-1022, while surpassing other versions. Additionally, the judgment ability of DeepSeek-V3 can also be enhanced by the voting technique. Therefore, we employ DeepSeek-V3 along with voting to offer self-feedback on open-ended questions, thereby improving the effectiveness and robustness of the alignment process.

我们将 DeepSeek-V3 的判断能力与最先进模型 (即 GPT-4o 和 Claude-3.5) 进行比较. 表 8 展示了这些模型在 RewardBench (Lambert et al., 2024) 上的表现. DeepSeek-V3 取得了与 GPT-4o-0806 和 Claude-3.5-Sonnet-1022 最佳版本相当的性能, 同时超越了其他版本. 此外, DeepSeek-V3 的判断能力也可以通过投票技术增强. 因此, 我们采用 DeepSeek-V3 结合投票来为开放式问题提供自我反馈, 从而提高对齐过程的有效性和鲁棒性.

<table><tr><td>Model</td><td>Chat</td><td>Chat-Hard</td><td>Safety</td><td>Reasoning</td><td> Average</td></tr><tr><td>GPT-4o-0513</td><td>96.6</td><td>70.4</td><td>86.7</td><td>84.9</td><td>84.7</td></tr><tr><td>GPT-4o-0806</td><td>96.1</td><td>76.1</td><td>88.1</td><td>86.6</td><td>86.7</td></tr><tr><td>GPT-4o-1120</td><td>95.8</td><td>71.3</td><td>86.2</td><td>85.2</td><td>84.6</td></tr><tr><td>Claude-3.5-sonnet-0620</td><td>96.4</td><td>74.0</td><td>81.6</td><td>84.7</td><td>84.2</td></tr><tr><td>Claude-3.5-sonnet-1022</td><td>96.4</td><td>79.7</td><td>91.1</td><td>87.6</td><td>88.7</td></tr><tr><td>DeepSeek-V3</td><td>96.9</td><td>79.8</td><td>87.0</td><td>84.3</td><td>87.0</td></tr><tr><td>DeepSeek-V3 (maj@6)</td><td>96.9</td><td>82.6</td><td>89.5</td><td>89.2</td><td>89.6</td></tr></table>

Table 8 
| Performances of GPT-4o, Claude-3.5-sonnet and DeepSeek-V3 on RewardBench.

表 8 | GPT-4o、Claude-3.5-sonnet 和 DeepSeek-V3 在 RewardBench 上的表现.

<table><tr><td rowspan="2">Model</td><td colspan="2">LiveCodeBench-CoT</td><td colspan="2">MATH-500</td></tr><tr><td>Pass@1</td><td>Length</td><td>Pass@1</td><td>Length</td></tr><tr><td>DeepSeek-V2.5 Baseline</td><td>31.1</td><td>718</td><td>74.6</td><td>769</td></tr><tr><td>DeepSeek-V2.5 +R1 Distill</td><td>37.4</td><td>783</td><td>83.2</td><td>1510</td></tr></table>

Table 9 
| The contribution of distillation from DeepSeek-R1. The evaluation settings of LiveCodeBench and MATH-500 are the same as in Table 6.

表 9 | DeepSeek-R1 蒸馏的贡献. LiveCodeBench 和 MATH-500 的评估设置与表 6 相同.

### 5.4. Discussion

#### 5.4.1. Distillation from DeepSeek-R1

We ablate the contribution of distillation from DeepSeek-R1 based on DeepSeek-V2.5. The baseline is trained on short CoT data, whereas its competitor uses data generated by the expert checkpoints described above.

我们基于 DeepSeek-V2.5 消融了 DeepSeek-R1 蒸馏的贡献. 基线在短 CoT 数据上训练, 而其对比模型使用上述专家检查点生成的数据.

Table 9 demonstrates the effectiveness of the distillation data, showing significant improvements in both LiveCodeBench and MATH-500 benchmarks. Our experiments reveal an interesting trade-off: the distillation leads to better performance but also substantially increases the average response length. To maintain a balance between model accuracy and computational efficiency, we carefully selected optimal settings for DeepSeek-V3 in distillation.

表 9 证明了蒸馏数据的有效性, 在 LiveCodeBench 和 MATH-500 基准上均显示出显著改进. 我们的实验揭示了一个有趣的权衡: 蒸馏带来更好的性能, 但也显著增加了平均回复长度. 为了在模型准确性和计算效率之间保持平衡, 我们在 DeepSeek-V3 的蒸馏中仔细选择了最优设置.

Our research suggests that knowledge distillation from reasoning models presents a promising direction for post-training optimization. While our current work focuses on distilling data from mathematics and coding domains, this approach shows potential for broader applications across various task domains. The effectiveness demonstrated in these specific areas indicates that long-CoT distillation could be valuable for enhancing model performance in other cognitive tasks requiring complex reasoning. Further exploration of this approach across different domains remains an important direction for future research.

我们的研究表明, 从推理模型进行知识蒸馏为后训练优化提供了一个有前景的方向. 虽然我们当前的工作专注于从数学和编码领域蒸馏数据, 但这种方法在各种任务领域显示出更广泛的潜力. 在这些特定领域展示的有效性表明, 长 CoT 蒸馏对于提升其他需要复杂推理的认知任务中的模型性能可能很有价值. 在不同领域进一步探索这种方法仍然是未来研究的重要方向.

> 译者注: 从推理模型 (R1) 向通用模型 (V3) 蒸馏长思维链数据, 是 DeepSeek-V3 在数学和代码上取得突破性进展的秘密武器. 这种"推理模型生产知识, 通用模型消费知识"的分工模式, 可能是未来大模型开发的重要范式. 但需要注意的是, 蒸馏也带来了回复长度增加的问题, 这在实际部署中需要考虑推理成本.

#### 5.4.2. Self-Rewarding

Rewards play a pivotal role in RL, steering the optimization process. In domains where verification through external tools is straightforward, such as some coding or mathematics scenarios, RL demonstrates exceptional efficacy. However, in more general scenarios, constructing a feedback mechanism through hard coding is impractical. During the development of DeepSeek-V3, for these broader contexts, we employ the constitutional AI approach (Bai et al., 2022), leveraging the voting evaluation results of DeepSeek-V3 itself as a feedback source. This method has produced notable alignment effects, significantly enhancing the performance of DeepSeek-V3 in subjective evaluations. By integrating additional constitutional inputs, DeepSeek-V3 can optimize towards the constitutional direction. We believe that this paradigm, which combines supplementary information with LLMs as a feedback source, is of paramount importance. The LLM serves as a versatile processor capable of transforming unstructured information from diverse scenarios into rewards, ultimately facilitating the self-improvement of LLMs. Beyond self-rewarding, we are also dedicated to uncovering other general and scalable rewarding methods to consistently advance the model capabilities in general scenarios.

奖励在 RL 中起着关键作用, 引导优化过程. 在通过外部工具验证较为直接的领域, 如某些编码或数学场景, RL 展现出卓越的效能. 然而, 在更一般的场景中, 通过硬编码构建反馈机制是不切实际的. 在 DeepSeek-V3 的开发过程中, 对于这些更广泛的上下文, 我们采用宪法 AI 方法 (Bai et al., 2022), 利用 DeepSeek-V3 自身的投票评估结果作为反馈来源. 这种方法产生了显著的对齐效果, 大幅提升了 DeepSeek-V3 在主观评估中的性能. 通过整合额外的宪法输入, DeepSeek-V3 可以朝着宪法方向优化. 我们相信, 这种将补充信息与 LLM 作为反馈来源相结合的范式至关重要. LLM 作为一个多功能处理器, 能够将来自多样化场景的非结构化信息转化为奖励, 最终促进 LLM 的自我改进. 除了自我奖励之外, 我们还致力于发现其他通用且可扩展的奖励方法, 以持续推动模型在一般场景中的能力进步.

> 译者注: Self-Rewarding (自奖励) 是 DeepSeek-V3 后训练的另一大亮点. 当外部验证器不可用时 (如创意写作、开放式问答), 模型自己评判自己的输出并通过投票产生奖励信号. 这与 Anthropic 的 Constitutional AI 理念一脉相承, 但 DeepSeek 将其与 GRPO 结合, 形成了一个完整的"自举式对齐"闭环. 这也解释了为什么 V3 在 AlpacaEval 和 Arena-Hard 等主观评估中表现如此出色.

#### 5.4.3. Multi-Token Prediction Evaluation

Instead of predicting just the next single token, DeepSeek-V3 predicts the next 2 tokens through the MTP technique. Combined with the framework of speculative decoding (Leviathan et al., 2023; Xia et al., 2023), it can significantly accelerate the decoding speed of the model. A natural question arises concerning the acceptance rate of the additionally predicted token. Based on our evaluation, the acceptance rate of the second token prediction ranges between 85% and 90% across various generation topics, demonstrating consistent reliability. This high acceptance rate enables DeepSeek-V3 to achieve a significantly improved decoding speed, delivering 1.8 times TPS (Tokens Per Second).

DeepSeek-V3 不仅预测下一个单一 token, 还通过 MTP 技术预测接下来的 2 个 token. 结合投机解码框架 (Leviathan et al., 2023; Xia et al., 2023), 它可以显著加速模型的解码速度. 一个自然的问题是关于额外预测 token 的接受率. 根据我们的评估, 第二个 token 预测的接受率在各种生成主题中介于 85% 到 90% 之间, 展现出一致的可靠性. 这一高接受率使 DeepSeek-V3 能够实现显著改善的解码速度, 达到 1.8 倍 TPS (每秒 token 数).

> 译者注: MTP 在推理阶段与投机解码结合, 实现了 1.8 倍解码加速. 85-90% 的次 token 接受率非常高, 说明 MTP 模块的预测质量足够可靠. 但需要注意, 这一加速比是在特定硬件和 batch 条件下实现的, 实际生产环境中的加速效果可能因延迟要求和并发量而异.

## 6. Conclusion, Limitations, and Future Directions

In this paper, we introduce DeepSeek-V3, a large MoE language model with 671B total parameters and 37B activated parameters, trained on 14.8T tokens. In addition to the MLA and DeepSeekMoE architectures, it also pioneers an auxiliary-loss-free strategy for load balancing and sets a multi-token prediction training objective for stronger performance. The training of DeepSeek-V3 is cost-effective due to the support of FP8 training and meticulous engineering optimizations. The post-training also makes a success in distilling the reasoning capability from the DeepSeek-R1 series of models. Comprehensive evaluations demonstrate that DeepSeek-V3 has emerged as the strongest open-source model currently available, and achieves performance comparable to leading closed-source models like GPT-4o and Claude-3.5-Sonnet. Despite its strong performance, it also maintains economical training costs. It requires only 2.788M H800 GPU hours for its full training, including pre-training, context length extension, and post-training.

在本文中, 我们介绍了 DeepSeek-V3, 一个拥有 671B 总参数和 37B 激活参数的大型 MoE 语言模型, 在 14.8T token 上训练. 除了 MLA 和 DeepSeekMoE 架构外, 它还开创了无辅助损失的负载均衡策略, 并设立了多 token 预测训练目标以获得更强的性能. 由于 FP8 训练的支持和细致的工程优化, DeepSeek-V3 的训练具有成本效益. 后训练也成功地从 DeepSeek-R1 系列模型中蒸馏了推理能力. 全面评估表明, DeepSeek-V3 已成为目前可用的最强开源模型, 并取得了与 GPT-4o 和 Claude-3.5-Sonnet 等领先闭源模型相当的性能. 尽管性能强劲, 它仍保持了经济的训练成本. 其完整训练仅需 2.788M H800 GPU 小时, 包括预训练、上下文长度扩展和后训练.

> 译者注: 2.788M H800 GPU 小时 ≈ 318 年单卡 H800 计算量, 按每 GPU 小时 $2-3 计算, 总训练成本约 $550-830 万美元. 这与 GPT-4 或 Claude 等闭源模型的训练成本 (传闻数亿美元) 相比, 效率提升了数十倍. 这是开源 AI 历史上的一个里程碑: 首次用可负担的成本训练出与顶级闭源模型性能相当的开源模型.

While acknowledging its strong performance and cost-effectiveness, we also recognize that DeepSeek-V3 has some limitations, especially on the deployment. Firstly, to ensure efficient inference, the recommended deployment unit for DeepSeek-V3 is relatively large, which might pose a burden for small-sized teams. Secondly, although our deployment strategy for DeepSeek-V3 has achieved an end-to-end generation speed of more than two times that of DeepSeek-V2, there still remains potential for further enhancement. Fortunately, these limitations are expected to be naturally addressed with the development of more advanced hardware.

在承认其强劲性能和成本效益的同时, 我们也认识到 DeepSeek-V3 存在一些局限性, 尤其是在部署方面. 首先, 为了确保高效推理, DeepSeek-V3 的推荐部署单元相对较大, 这可能对小型团队构成负担. 其次, 尽管我们为 DeepSeek-V3 制定的部署策略已实现超过 DeepSeek-V2 两倍多的端到端生成速度, 但仍有进一步提升的潜力. 幸运的是, 随着更先进硬件的发展, 这些局限有望自然得到解决.

DeepSeek consistently adheres to the route of open-source models with longtermism, aiming to steadily approach the ultimate goal of AGI (Artificial General Intelligence). In the future, we plan to strategically invest in research across the following directions.

DeepSeek 始终坚持开源模型的长期主义路线, 旨在稳步接近 AGI (通用人工智能) 的终极目标. 未来, 我们计划在以下方向进行战略性研究投入.

• We will consistently study and refine our model architectures, aiming to further improve both the training and inference efficiency, striving to approach efficient support for infinite context length. Additionally, we will try to break through the architectural limitations of Transformer, thereby pushing the boundaries of its modeling capabilities.

• 我们将持续研究和完善模型架构, 旨在进一步提升训练和推理效率, 努力接近对无限上下文长度的高效支持. 此外, 我们将尝试突破 Transformer 的架构限制, 从而推动其建模能力的边界.

• We will continuously iterate on the quantity and quality of our training data, and explore the incorporation of additional training signal sources, aiming to drive data scaling across a more comprehensive range of dimensions.

• 我们将持续迭代训练数据的数量和质量, 并探索纳入额外的训练信号来源, 旨在推动数据在更全面的维度范围内扩展.

• We will consistently explore and iterate on the deep thinking capabilities of our models, aiming to enhance their intelligence and problem-solving abilities by expanding their reasoning length and depth.

• 我们将持续探索和迭代模型的深度思考能力, 旨在通过扩展推理长度和深度来增强其智能和问题解决能力.

• We will explore more comprehensive and multi-dimensional model evaluation methods to prevent the tendency towards optimizing a fixed set of benchmarks during research, which may create a misleading impression of the model capabilities and affect our foundational assessment.

• 我们将探索更全面和多维度的模型评估方法, 以防止研究过程中针对固定基准集进行优化的倾向, 这可能对模型能力产生误导性印象并影响我们的基础评估.

> 译者注: 结论部分的四个未来方向非常有信息量: (1) 无限上下文 + 突破 Transformer 限制; (2) 更多训练数据和信号; (3) 深度思考能力 (明确指向类似 o1/R1 的推理能力); (4) 更全面的评估方法. 第三点尤其值得关注, 它暗示 DeepSeek 正在研发的下一代模型可能会将长思维链推理作为原生能力, 而不仅仅是通过后训练蒸馏.

## References

以下参考文献列表保留原文, 未翻译. 如需追溯具体论文与实现, 请参考原始 PDF、GitHub 仓库与对应 arXiv 链接。

AI@Meta. Llama 3 model card, 2024a. URL https://github.com/meta-llama/llama3/bl ob/main/MODEL\_CARD.md.

AI@Meta. Llama 3.1 model card, 2024b. URL https://github.com/meta-llama/llama-m odels/blob/main/models/llama3\_1/MODEL\_CARD.md.

Anthropic. Claude 3.5 sonnet, 2024. URL https://www.anthropic.com/news/claude-3 -5-sonnet.

J. Austin, A. Odena, M. Nye, M. Bosma, H. Michalewski, D. Dohan, E. Jiang, C. Cai, M. Terry, Q. Le, et al. Program synthesis with large language models. arXiv preprint arXiv:2108.07732, 2021.

Y. Bai, S. Kadavath, S. Kundu, A. Askell, J. Kernion, A. Jones, A. Chen, A. Goldie, A. Mirhoseini, C. McKinnon, et al. Constitutional AI: Harmlessness from AI feedback. arXiv preprint arXiv:2212.08073, 2022.

Y. Bai, S. Tu, J. Zhang, H. Peng, X. Wang, X. Lv, S. Cao, J. Xu, L. Hou, Y. Dong, J. Tang, and J. Li. LongBench v2: Towards deeper understanding and reasoning on realistic long-context multitasks. arXiv preprint arXiv:2412.15204, 2024.

M. Bauer, S. Treichler, and A. Aiken. Singe: leveraging warp specialization for high performance on GPUs. In Proceedings of the 19th ACM SIGPLAN Symposium on Principles and Practice of Parallel Programming, PPoPP '14, page 119–130, New York, NY, USA, 2014. Association for Computing Machinery. ISBN 9781450326568. doi: 10.1145/2555243.2555258. URL https://doi.org/10.1145/2555243.2555258.

Y. Bisk, R. Zellers, R. L. Bras, J. Gao, and Y. Choi. PIQA: reasoning about physical commonsense in natural language. In The Thirty-Fourth AAAI Conference on Artificial Intelligence, AAAI 2020, The Thirty-Second Innovative Applications of Artificial Intelligence Conference, IAAI 2020, The Tenth AAAI Symposium on Educational Advances in Artificial Intelligence, EAAI 2020, New York, NY, USA, February 7-12, 2020, pages 7432–7439. AAAI Press, 2020. doi: 10.1609/aaai.v34i05.6239. URL https://doi.org/10.1609/aaai.v34i05.6239.

M. Chen, J. Tworek, H. Jun, Q. Yuan, H. P. de Oliveira Pinto, J. Kaplan, H. Edwards, Y. Burda, N. Joseph, G. Brockman, A. Ray, R. Puri, G. Krueger, M. Petrov, H. Khlaaf, G. Sastry, P. Mishkin, B. Chan, S. Gray, N. Ryder, M. Pavlov, A. Power, L. Kaiser, M. Bavarian, C. Winter, P. Tillet, F. P. Such, D. Cummings, M. Plappert, F. Chantzis, E. Barnes, A. Herbert-Voss, W. H. Guss, A. Nichol, A. Paino, N. Tezak, J. Tang, I. Babuschkin, S. Balaji, S. Jain, W. Saunders, C. Hesse,

A. N. Carr, J. Leike, J. Achiam, V. Misra, E. Morikawa, A. Radford, M. Knight, M. Brundage, M. Murati, K. Mayer, P. Welinder, B. McGrew, D. Amodei, S. McCandlish, I. Sutskever, and W. Zaremba. Evaluating large language models trained on code. CoRR, abs/2107.03374, 2021. URL https://arxiv.org/abs/2107.03374.

P. Clark, I. Cowhey, O. Etzioni, T. Khot, A. Sabharwal, C. Schoenick, and O. Tafjord. Think you have solved question answering? try arc, the AI2 reasoning challenge. CoRR, abs/1803.05457, 2018. URL http://arxiv.org/abs/1803.05457.

K. Cobbe, V. Kosaraju, M. Bavarian, M. Chen, H. Jun, L. Kaiser, M. Plappert, J. Tworek, J. Hilton, R. Nakano, et al. Training verifiers to solve math word problems. arXiv preprint arXiv:2110.14168, 2021.

Y. Cui, T. Liu, W. Che, L. Xiao, Z. Chen, W. Ma, S. Wang, and G. Hu. A span-extraction dataset for Chinese machine reading comprehension. In K. Inui, J. Jiang, V. Ng, and X. Wan, editors, Proceedings of the 2019 Conference on Empirical Methods in Natural Language Processing and the 9th International Joint Conference on Natural Language Processing (EMNLP-IJCNLP), pages 5883–5889, Hong Kong, China, Nov. 2019. Association for Computational Linguistics. doi: 10.18653/v1/D19-1600. URL https://aclanthology.org/D19-1 600.

D. Dai, C. Deng, C. Zhao, R. X. Xu, H. Gao, D. Chen, J. Li, W. Zeng, X. Yu, Y. Wu, Z. Xie, Y. K. Li, P. Huang, F. Luo, C. Ruan, Z. Sui, and W. Liang. Deepseekmoe: Towards ultimate expert specialization in mixture-of-experts language models. CoRR, abs/2401.06066, 2024. URL https://doi.org/10.48550/arXiv.2401.06066.

DeepSeek-AI. Deepseek-coder-v2: Breaking the barrier of closed-source models in code intelligence. CoRR, abs/2406.11931, 2024a. URL https://doi.org/10.48550/arXiv.2406.11 931.

DeepSeek-AI. Deepseek LLM: scaling open-source language models with longtermism. CoRR, abs/2401.02954, 2024b. URL https://doi.org/10.48550/arXiv.2401.02954.

DeepSeek-AI. Deepseek-v2: A strong, economical, and efficient mixture-of-experts language model. CoRR, abs/2405.04434, 2024c. URL https://doi.org/10.48550/arXiv.2405. 04434.

T. Dettmers, M. Lewis, Y. Belkada, and L. Zettlemoyer. Gpt3. int8 (): 8-bit matrix multiplication for transformers at scale. Advances in Neural Information Processing Systems, 35:30318– 30332, 2022.

H. Ding, Z. Wang, G. Paolini, V. Kumar, A. Deoras, D. Roth, and S. Soatto. Fewer truncations improve language modeling. arXiv preprint arXiv:2404.10830, 2024.

D. Dua, Y. Wang, P. Dasigi, G. Stanovsky, S. Singh, and M. Gardner. DROP: A reading comprehension benchmark requiring discrete reasoning over paragraphs. In J. Burstein, C. Doran, and T. Solorio, editors, Proceedings of the 2019 Conference of the North American Chapter of the Association for Computational Linguistics: Human Language Technologies, NAACL-HLT 2019, Minneapolis, MN, USA, June 2-7, 2019, Volume 1 (Long and Short Papers), pages 2368– 2378. Association for Computational Linguistics, 2019. doi: 10.18653/V1/N19-1246. URL https://doi.org/10.18653/v1/n19-1246.

Y. Dubois, B. Galambosi, P. Liang, and T. B. Hashimoto. Length-controlled alpacaeval: A simple way to debias automatic evaluators. arXiv preprint arXiv:2404.04475, 2024.

W. Fedus, B. Zoph, and N. Shazeer. Switch transformers: Scaling to trillion parameter models with simple and efficient sparsity. CoRR, abs/2101.03961, 2021. URL https://arxiv.org/ abs/2101.03961.

M. Fishman, B. Chmiel, R. Banner, and D. Soudry. Scaling FP8 training to trillion-token llms. arXiv preprint arXiv:2409.12517, 2024.

E. Frantar, S. Ashkboos, T. Hoefler, and D. Alistarh. Gptq: Accurate post-training quantization for generative pre-trained transformers. arXiv preprint arXiv:2210.17323, 2022.

L. Gao, S. Biderman, S. Black, L. Golding, T. Hoppe, C. Foster, J. Phang, H. He, A. Thite, N. Nabeshima, et al. The Pile: An 800GB dataset of diverse text for language modeling. arXiv preprint arXiv:2101.00027, 2020.

A. P. Gema, J. O. J. Leang, G. Hong, A. Devoto, A. C. M. Mancino, R. Saxena, X. He, Y. Zhao, X. Du, M. R. G. Madani, C. Barale, R. McHardy, J. Harris, J. Kaddour, E. van Krieken, and P. Minervini. Are we done with mmlu? CoRR, abs/2406.04127, 2024. URL https://doi.or g/10.48550/arXiv.2406.04127.

F. Gloeckle, B. Y. Idrissi, B. Rozière, D. Lopez-Paz, and G. Synnaeve. Better & faster large language models via multi-token prediction. In Forty-first International Conference on Machine Learning, ICML 2024, Vienna, Austria, July 21-27, 2024. OpenReview.net, 2024. URL https://openreview.net/forum?id=pEWAcejiU2.

Google. Our next-generation model: Gemini 1.5, 2024. URL https://blog.google/techno logy/ai/google-gemini-next-generation-model-february-2024.

R. L. Graham, D. Bureddy, P. Lui, H. Rosenstock, G. Shainer, G. Bloch, D. Goldenerg, M. Dubman, S. Kotchubievsky, V. Koushnir, et al. Scalable hierarchical aggregation protocol (SHArP): A hardware architecture for efficient data reduction. In 2016 First International Workshop on Communication Optimizations in HPC (COMHPC), pages 1–10. IEEE, 2016.

A. Gu, B. Rozière, H. Leather, A. Solar-Lezama, G. Synnaeve, and S. I. Wang. Cruxeval: A benchmark for code reasoning, understanding and execution, 2024.

D. Guo, Q. Zhu, D. Yang, Z. Xie, K. Dong, W. Zhang, G. Chen, X. Bi, Y. Wu, Y. K. Li, F. Luo, Y. Xiong, and W. Liang. Deepseek-coder: When the large language model meets programming - the rise of code intelligence. CoRR, abs/2401.14196, 2024. URL https://doi.org/10.485 50/arXiv.2401.14196.

A. Harlap, D. Narayanan, A. Phanishayee, V. Seshadri, N. Devanur, G. Ganger, and P. Gibbons. Pipedream: Fast and efficient pipeline parallel dnn training, 2018. URL https://arxiv.or g/abs/1806.03377.

B. He, L. Noci, D. Paliotta, I. Schlag, and T. Hofmann. Understanding and minimising outlier features in transformer training. In The Thirty-eighth Annual Conference on Neural Information Processing Systems.

Y. He, S. Li, J. Liu, Y. Tan, W. Wang, H. Huang, X. Bu, H. Guo, C. Hu, B. Zheng, et al. Chinese simpleqa: A chinese factuality evaluation for large language models. arXiv preprint arXiv:2411.07140, 2024.

D. Hendrycks, C. Burns, S. Basart, A. Zou, M. Mazeika, D. Song, and J. Steinhardt. Measuring massive multitask language understanding. arXiv preprint arXiv:2009.03300, 2020.

D. Hendrycks, C. Burns, S. Kadavath, A. Arora, S. Basart, E. Tang, D. Song, and J. Steinhardt. Measuring mathematical problem solving with the math dataset. arXiv preprint arXiv:2103.03874, 2021.

Y. Huang, Y. Bai, Z. Zhu, J. Zhang, J. Zhang, T. Su, J. Liu, C. Lv, Y. Zhang, J. Lei, et al. C-Eval: A multi-level multi-discipline chinese evaluation suite for foundation models. arXiv preprint arXiv:2305.08322, 2023.

N. Jain, K. Han, A. Gu, W. Li, F. Yan, T. Zhang, S. Wang, A. Solar-Lezama, K. Sen, and I. Stoica. Livecodebench: Holistic and contamination free evaluation of large language models for code. CoRR, abs/2403.07974, 2024. URL https://doi.org/10.48550/arXiv.2403.07974.

A. Q. Jiang, A. Sablayrolles, A. Mensch, C. Bamford, D. S. Chaplot, D. d. l. Casas, F. Bressand, G. Lengyel, G. Lample, L. Saulnier, et al. Mistral 7b. arXiv preprint arXiv:2310.06825, 2023.

M. Joshi, E. Choi, D. Weld, and L. Zettlemoyer. TriviaQA: A large scale distantly supervised challenge dataset for reading comprehension. In R. Barzilay and M.-Y. Kan, editors, Proceedings of the 55th Annual Meeting of the Association for Computational Linguistics (Volume 1: Long Papers), pages 1601–1611, Vancouver, Canada, July 2017. Association for Computational Linguistics. doi: 10.18653/v1/P17-1147. URL https://aclanthology.org/P17-1147.

D. Kalamkar, D. Mudigere, N. Mellempudi, D. Das, K. Banerjee, S. Avancha, D. T. Vooturi, N. Jammalamadaka, J. Huang, H. Yuen, et al. A study of bfloat16 for deep learning training. arXiv preprint arXiv:1905.12322, 2019.

S. Krishna, K. Krishna, A. Mohananey, S. Schwarcz, A. Stambler, S. Upadhyay, and M. Faruqui. Fact, fetch, and reason: A unified evaluation of retrieval-augmented generation. CoRR, abs/2409.12941, 2024. doi: 10.48550/ARXIV.2409.12941. URL https://doi.org/10.485 50/arXiv.2409.12941.

T. Kwiatkowski, J. Palomaki, O. Redfield, M. Collins, A. P. Parikh, C. Alberti, D. Epstein, I. Polosukhin, J. Devlin, K. Lee, K. Toutanova, L. Jones, M. Kelcey, M. Chang, A. M. Dai, J. Uszkoreit, Q. Le, and S. Petrov. Natural questions: a benchmark for question answering research. Trans. Assoc. Comput. Linguistics, 7:452–466, 2019. doi: 10.1162/tacl\_a\_00276. URL https://doi.org/10.1162/tacl\_a\_00276.

G. Lai, Q. Xie, H. Liu, Y. Yang, and E. H. Hovy. RACE: large-scale reading comprehension dataset from examinations. In M. Palmer, R. Hwa, and S. Riedel, editors, Proceedings of the 2017 Conference on Empirical Methods in Natural Language Processing, EMNLP 2017, Copenhagen, Denmark, September 9-11, 2017, pages 785–794. Association for Computational Linguistics, 2017. doi: 10.18653/V1/D17-1082. URL https://doi.org/10.18653/v1/d1 7-1082.

N. Lambert, V. Pyatkin, J. Morrison, L. Miranda, B. Y. Lin, K. Chandu, N. Dziri, S. Kumar, T. Zick, Y. Choi, et al. Rewardbench: Evaluating reward models for language modeling. arXiv preprint arXiv:2403.13787, 2024.

D. Lepikhin, H. Lee, Y. Xu, D. Chen, O. Firat, Y. Huang, M. Krikun, N. Shazeer, and Z. Chen. Gshard: Scaling giant models with conditional computation and automatic sharding. In 9th International Conference on Learning Representations, ICLR 2021. OpenReview.net, 2021. URL https://openreview.net/forum?id=qrwe7XHTmYb.

Y. Leviathan, M. Kalman, and Y. Matias. Fast inference from transformers via speculative decoding. In International Conference on Machine Learning, ICML 2023, 23-29 July 2023, Honolulu, Hawaii, USA, volume 202 of Proceedings of Machine Learning Research, pages 19274–19286. PMLR, 2023. URL https://proceedings.mlr.press/v202/leviathan23 a.html.

H. Li, Y. Zhang, F. Koto, Y. Yang, H. Zhao, Y. Gong, N. Duan, and T. Baldwin. CMMLU: Measuring massive multitask language understanding in Chinese. arXiv preprint arXiv:2306.09212, 2023.

S. Li and T. Hoefler. Chimera: efficiently training large-scale neural networks with bidirectional pipelines. In Proceedings of the International Conference for High Performance Computing, Networking, Storage and Analysis, SC '21, page 1–14. ACM, Nov. 2021. doi: 10.1145/345881 7.3476145. URL http://dx.doi.org/10.1145/3458817.3476145.

T. Li, W.-L. Chiang, E. Frick, L. Dunlap, T. Wu, B. Zhu, J. E. Gonzalez, and I. Stoica. From crowdsourced data to high-quality benchmarks: Arena-hard and benchbuilder pipeline. arXiv preprint arXiv:2406.11939, 2024a.

W. Li, F. Qi, M. Sun, X. Yi, and J. Zhang. Ccpm: A chinese classical poetry matching dataset, 2021.

Y. Li, F. Wei, C. Zhang, and H. Zhang. EAGLE: speculative sampling requires rethinking feature uncertainty. In Forty-first International Conference on Machine Learning, ICML 2024, Vienna, Austria, July 21-27, 2024. OpenReview.net, 2024b. URL https://openreview.net /forum?id=1NdN7eXyb4.

B. Y. Lin. ZeroEval: A Unified Framework for Evaluating Language Models, July 2024. URL https://github.com/WildEval/ZeroEval.

I. Loshchilov and F. Hutter. Decoupled weight decay regularization. arXiv preprint arXiv:1711.05101, 2017.

S. Lundberg. The art of prompt design: Prompt boundaries and token healing, 2023. URL https://towardsdatascience.com/the-art-of-prompt-design-prompt-bound aries-and-token-healing-3b2448b0be38.

Y. Luo, Z. Zhang, R. Wu, H. Liu, Y. Jin, K. Zheng, M. Wang, Z. He, G. Hu, L. Chen, et al. Ascend HiFloat8 format for deep learning. arXiv preprint arXiv:2409.16626, 2024.

MAA. American invitational mathematics examination - aime. In American Invitational Mathematics Examination - AIME 2024, February 2024. URL https://maa.org/math -competitions/american-invitational-mathematics-examination-aime.

P. Micikevicius, D. Stosic, N. Burgess, M. Cornea, P. Dubey, R. Grisenthwaite, S. Ha, A. Heinecke, P. Judd, J. Kamalu, et al. FP8 formats for deep learning. arXiv preprint arXiv:2209.05433, 2022.

Mistral. Cheaper, better, faster, stronger: Continuing to push the frontier of ai and making it accessible to all, 2024. URL https://mistral.ai/news/mixtral-8x22b.

S. Narang, G. Diamos, E. Elsen, P. Micikevicius, J. Alben, D. Garcia, B. Ginsburg, M. Houston, O. Kuchaiev, G. Venkatesh, et al. Mixed precision training. In Int. Conf. on Learning Representation, 2017.

B. Noune, P. Jones, D. Justus, D. Masters, and C. Luschi. 8-bit numerical formats for deep neural networks. arXiv preprint arXiv:2206.02915, 2022.

NVIDIA. Improving network performance of HPC systems using NVIDIA Magnum IO NVSH-MEM and GPUDirect Async. https://developer.nvidia.com/blog/improving-net work-performance-of-hpc-systems-using-nvidia-magnum-io-nvshmem-and-g pudirect-async, 2022.

NVIDIA. Blackwell architecture. https://www.nvidia.com/en-us/data-center/tech nologies/blackwell-architecture/, 2024a.

NVIDIA. TransformerEngine, 2024b. URL https://github.com/NVIDIA/TransformerE ngine. Accessed: 2024-11-19.

OpenAI. Hello GPT-4o, 2024a. URL https://openai.com/index/hello-gpt-4o/.

OpenAI. Multilingual massive multitask language understanding (mmmlu), 2024b. URL https://huggingface.co/datasets/openai/MMMLU.

OpenAI. Introducing SimpleQA, 2024c. URL https://openai.com/index/introducing -simpleqa/.

OpenAI. Introducing SWE-bench verified we're releasing a human-validated subset of swebench that more, 2024d. URL https://openai.com/index/introducing-swe-bench -verified/.

B. Peng, J. Quesnelle, H. Fan, and E. Shippole. Yarn: Efficient context window extension of large language models. arXiv preprint arXiv:2309.00071, 2023a.

H. Peng, K. Wu, Y. Wei, G. Zhao, Y. Yang, Z. Liu, Y. Xiong, Z. Yang, B. Ni, J. Hu, et al. FP8-LM: Training FP8 large language models. arXiv preprint arXiv:2310.18313, 2023b.

P. Qi, X. Wan, G. Huang, and M. Lin. Zero bubble pipeline parallelism. arXiv preprint arXiv:2401.10241, 2023a.

P. Qi, X. Wan, G. Huang, and M. Lin. Zero bubble pipeline parallelism, 2023b. URL https: //arxiv.org/abs/2401.10241.

Qwen. Qwen technical report. arXiv preprint arXiv:2309.16609, 2023.

Qwen. Introducing Qwen1.5, 2024a. URL https://qwenlm.github.io/blog/qwen1.5.

Qwen. Qwen2.5: A party of foundation models, 2024b. URL https://qwenlm.github.io/b log/qwen2.5.

S. Rajbhandari, J. Rasley, O. Ruwase, and Y. He. Zero: Memory optimizations toward training trillion parameter models. In SC20: International Conference for High Performance Computing, Networking, Storage and Analysis, pages 1–16. IEEE, 2020.

D. Rein, B. L. Hou, A. C. Stickland, J. Petty, R. Y. Pang, J. Dirani, J. Michael, and S. R. Bowman. GPQA: A graduate-level google-proof q&a benchmark. arXiv preprint arXiv:2311.12022, 2023.

B. D. Rouhani, R. Zhao, A. More, M. Hall, A. Khodamoradi, S. Deng, D. Choudhary, M. Cornea, E. Dellinger, K. Denolf, et al. Microscaling data formats for deep learning. arXiv preprint arXiv:2310.10537, 2023a.

B. D. Rouhani, R. Zhao, A. More, M. Hall, A. Khodamoradi, S. Deng, D. Choudhary, M. Cornea, E. Dellinger, K. Denolf, et al. Microscaling data formats for deep learning. arXiv preprint arXiv:2310.10537, 2023b.

K. Sakaguchi, R. L. Bras, C. Bhagavatula, and Y. Choi. Winogrande: An adversarial winograd schema challenge at scale, 2019.

Z. Shao, P. Wang, Q. Zhu, R. Xu, J. Song, M. Zhang, Y. Li, Y. Wu, and D. Guo. Deepseekmath: Pushing the limits of mathematical reasoning in open language models. arXiv preprint arXiv:2402.03300, 2024.

N. Shazeer, A. Mirhoseini, K. Maziarz, A. Davis, Q. V. Le, G. E. Hinton, and J. Dean. Outrageously large neural networks: The sparsely-gated mixture-of-experts layer. In 5th International Conference on Learning Representations, ICLR 2017. OpenReview.net, 2017. URL https: //openreview.net/forum?id=B1ckMDqlg.

F. Shi, M. Suzgun, M. Freitag, X. Wang, S. Srivats, S. Vosoughi, H. W. Chung, Y. Tay, S. Ruder, D. Zhou, D. Das, and J. Wei. Language models are multilingual chain-of-thought reasoners. In The Eleventh International Conference on Learning Representations, ICLR 2023, Kigali, Rwanda, May 1-5, 2023. OpenReview.net, 2023. URL https://openreview.net/forum?i d=fR3wGCk-IXp.

Y. Shibata, T. Kida, S. Fukamachi, M. Takeda, A. Shinohara, T. Shinohara, and S. Arikawa. Byte pair encoding: A text compression scheme that accelerates pattern matching. 1999.

J. Su, M. Ahmed, Y. Lu, S. Pan, W. Bo, and Y. Liu. Roformer: Enhanced transformer with rotary position embedding. Neurocomputing, 568:127063, 2024.

K. Sun, D. Yu, D. Yu, and C. Cardie. Investigating prior knowledge for challenging chinese machine reading comprehension, 2019a.

M. Sun, X. Chen, J. Z. Kolter, and Z. Liu. Massive activations in large language models. arXiv preprint arXiv:2402.17762, 2024.

X. Sun, J. Choi, C.-Y. Chen, N. Wang, S. Venkataramani, V. V. Srinivasan, X. Cui, W. Zhang, and K. Gopalakrishnan. Hybrid 8-bit floating point (HFP8) training and inference for deep neural networks. Advances in neural information processing systems, 32, 2019b.

M. Suzgun, N. Scales, N. Schärli, S. Gehrmann, Y. Tay, H. W. Chung, A. Chowdhery, Q. V. Le, E. H. Chi, D. Zhou, et al. Challenging big-bench tasks and whether chain-of-thought can solve them. arXiv preprint arXiv:2210.09261, 2022.

V. Thakkar, P. Ramani, C. Cecka, A. Shivam, H. Lu, E. Yan, J. Kosaian, M. Hoemmen, H. Wu, A. Kerr, M. Nicely, D. Merrill, D. Blasig, F. Qiao, P. Majcher, P. Springer, M. Hohnerbach, J. Wang, and M. Gupta. CUTLASS, Jan. 2023. URL https://github.com/NVIDIA/cutlas s.

H. Touvron, T. Lavril, G. Izacard, X. Martinet, M.-A. Lachaux, T. Lacroix, B. Rozière, N. Goyal, E. Hambro, F. Azhar, et al. LLaMA: Open and efficient foundation language models. arXiv preprint arXiv:2302.13971, 2023a.

H. Touvron, L. Martin, K. Stone, P. Albert, A. Almahairi, Y. Babaei, N. Bashlykov, S. Batra, P. Bhargava, S. Bhosale, D. Bikel, L. Blecher, C. Canton-Ferrer, M. Chen, G. Cucurull, D. Esiobu, J. Fernandes, J. Fu, W. Fu, B. Fuller, C. Gao, V. Goswami, N. Goyal, A. Hartshorn, S. Hosseini,

R. Hou, H. Inan, M. Kardas, V. Kerkez, M. Khabsa, I. Kloumann, A. Korenev, P. S. Koura, M. Lachaux, T. Lavril, J. Lee, D. Liskovich, Y. Lu, Y. Mao, X. Martinet, T. Mihaylov, P. Mishra, I. Molybog, Y. Nie, A. Poulton, J. Reizenstein, R. Rungta, K. Saladi, A. Schelten, R. Silva, E. M. Smith, R. Subramanian, X. E. Tan, B. Tang, R. Taylor, A. Williams, J. X. Kuan, P. Xu, Z. Yan, I. Zarov, Y. Zhang, A. Fan, M. Kambadur, S. Narang, A. Rodriguez, R. Stojnic, S. Edunov, and T. Scialom. Llama 2: Open foundation and fine-tuned chat models. CoRR, abs/2307.09288, 2023b. doi: 10.48550/arXiv.2307.09288. URL https://doi.org/10.48550/arXiv.2307. 09288.

A. Vaswani, N. Shazeer, N. Parmar, J. Uszkoreit, L. Jones, A. N. Gomez, Ł. Kaiser, and I. Polosukhin. Attention is all you need. Advances in neural information processing systems, 30, 2017.

L. Wang, H. Gao, C. Zhao, X. Sun, and D. Dai. Auxiliary-loss-free load balancing strategy for mixture-of-experts. CoRR, abs/2408.15664, 2024a. URL https://doi.org/10.48550/ar xiv.2408.15664.

Y. Wang, X. Ma, G. Zhang, Y. Ni, A. Chandra, S. Guo, W. Ren, A. Arulraj, X. He, Z. Jiang, T. Li, M. Ku, K. Wang, A. Zhuang, R. Fan, X. Yue, and W. Chen. Mmlu-pro: A more robust and challenging multi-task language understanding benchmark. CoRR, abs/2406.01574, 2024b. URL https://doi.org/10.48550/arXiv.2406.01574.

T. Wei, J. Luan, W. Liu, S. Dong, and B. Wang. Cmath: Can your language model pass chinese elementary school math test?, 2023.

M. Wortsman, T. Dettmers, L. Zettlemoyer, A. Morcos, A. Farhadi, and L. Schmidt. Stable and low-precision training for large-scale vision-language models. Advances in Neural Information Processing Systems, 36:10271–10298, 2023.

H. Xi, C. Li, J. Chen, and J. Zhu. Training transformers with 4-bit integers. Advances in Neural Information Processing Systems, 36:49146–49168, 2023.

C. S. Xia, Y. Deng, S. Dunn, and L. Zhang. Agentless: Demystifying llm-based software engineering agents. arXiv preprint, 2024.

H. Xia, T. Ge, P. Wang, S. Chen, F. Wei, and Z. Sui. Speculative decoding: Exploiting speculative execution for accelerating seq2seq generation. In Findings of the Association for Computational Linguistics: EMNLP 2023, Singapore, December 6-10, 2023, pages 3909–3925. Association for Computational Linguistics, 2023. URL https://doi.org/10.18653/v1/ 2023.findings-emnlp.257.

G. Xiao, J. Lin, M. Seznec, H. Wu, J. Demouth, and S. Han. Smoothquant: Accurate and efficient post-training quantization for large language models. In International Conference on Machine Learning, pages 38087–38099. PMLR, 2023.

L. Xu, H. Hu, X. Zhang, L. Li, C. Cao, Y. Li, Y. Xu, K. Sun, D. Yu, C. Yu, Y. Tian, Q. Dong, W. Liu, B. Shi, Y. Cui, J. Li, J. Zeng, R. Wang, W. Xie, Y. Li, Y. Patterson, Z. Tian, Y. Zhang, H. Zhou, S. Liu, Z. Zhao, Q. Zhao, C. Yue, X. Zhang, Z. Yang, K. Richardson, and Z. Lan. CLUE: A chinese language understanding evaluation benchmark. In D. Scott, N. Bel, and C. Zong, editors, Proceedings of the 28th International Conference on Computational Linguistics, COLING 2020, Barcelona, Spain (Online), December 8-13, 2020, pages 4762–4772. International Committee on Computational Linguistics, 2020. doi: 10.18653/V1/2020.COLING-MAIN.419. URL https://doi.org/10.18653/v1/2020.coling-main.419.

R. Zellers, A. Holtzman, Y. Bisk, A. Farhadi, and Y. Choi. HellaSwag: Can a machine really finish your sentence? In A. Korhonen, D. R. Traum, and L. Màrquez, editors, Proceedings of the 57th Conference of the Association for Computational Linguistics, ACL 2019, Florence, Italy, July 28- August 2, 2019, Volume 1: Long Papers, pages 4791–4800. Association for Computational Linguistics, 2019. doi: 10.18653/v1/p19-1472. URL https://doi.org/10.18653/v1/p1 9-1472.

W. Zhong, R. Cui, Y. Guo, Y. Liang, S. Lu, Y. Wang, A. Saied, W. Chen, and N. Duan. AGIEval: A human-centric benchmark for evaluating foundation models. CoRR, abs/2304.06364, 2023. doi: 10.48550/arXiv.2304.06364. URL https://doi.org/10.48550/arXiv.2304.06364.

J. Zhou, T. Lu, S. Mishra, S. Brahma, S. Basu, Y. Luan, D. Zhou, and L. Hou. Instruction-following evaluation for large language models. arXiv preprint arXiv:2311.07911, 2023.

## 全文完

## 关联文件说明

- 原始英文 MinerU 文档: `03-DeepSeek-V3-mineru-en.md`
- 既有精译/导读: `01-DeepSeek-V3技术报告精译.md`
- 核心架构剖析: `02-DeepSeek-V3核心架构剖析.md`
- D5 主题专题: `05-DeepSeek-V3-Architecture-Overview.md`、`05-DeepSeek-V3-MLA.md`、`05-DeepSeek-V3-DeepSeekMoE.md`、`05-DeepSeek-V3-DualPipe.md`、`05-DeepSeek-V3-MTP.md`、`05-DeepSeek-V3-Training-System.md`、`05-DeepSeek-V3-Index.md`
