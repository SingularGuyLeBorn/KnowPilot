---
title: "Step-3 Technical Report (MinerU 逐译+译者注)"
converted_by: PyMuPDF (MinerU fallback)
source_pdf: Step-3.pdf
---


> 原始来源: Step-3 technical report PDF
> 提取方式: PyMuPDF 兜底提取 (MinerU 3.1.14 CLI 服务挂起)
> 翻译说明: 本文档为英中对照逐段翻译, 英文原文在前, 中文译文紧随其后. `> 译者注:` 为译者添加的技术点评与背景补充.
> Step-3 是阶跃星辰(StepFun)推出的 MoE 大语言模型, 强调训练与推理的系统级协同优化.

---

Step-3 is Large yet Affordable: Model-system Co-design for Cost-effective Decoding

Step-3: Large yet Affordable - 面向低成本解码的模型-系统协同设计

StepFun Inc.

阶跃星辰 (StepFun Inc.)

## 摘要

>  **[返回 14.7-StepFun 家族总览](../../14.7-StepFun.md)**


Large language models (LLMs) face low hardware efficiency during decoding, especially for long-context reasoning tasks. This paper introduces Step-3, a 321B-parameter VLM with hardware-aware model-system co-design optimized for minimizing decoding costs. Step-3 innovates in two key dimensions: (1) A novel Multi-Matrix Factorization Attention (MFA) mechanism that significantly reduces both KV cache size and computation while maintaining high attention expressiveness, and (2) Attention-FFN Disaggregation (AFD), a distributed inference system that decouples attention and Feed-Forward Network (FFN) layers into specialized subsystems. This co-design achieves unprecedented cost efficiency: Step-3 significantly reduces theoretical decoding costs compared with models like DeepSeek-V3 and Qwen3 MoE 235B, with the gains widening at longer context. Step-3 achieves low cost while activating 38B parameters per token (more than DeepSeek-V3 and Qwen3 MoE 235B), demonstrating that hardware-aligned attention arithmetic intensity, MoE sparsity, and AFD are critical to cost-effectiveness. We perform a head-to-head comparison with DeepSeek-V3 in its favorable scenarios. Our implementation on Hopper GPUs achieves a decoding throughput of up to 4,039 tokens per second per GPU under 50ms TPOT SLA (4K context, FP8, no MTP). It is higher than DeepSeek-V3's 2,324 in the same setup and sets a new Pareto frontier for LLM decoding.

大语言模型 (LLM) 在解码阶段面临硬件效率低下的问题, 尤其在长上下文推理任务中. 本文介绍 Step-3, 一个拥有 321B 参数的视觉语言模型 (VLM), 通过硬件感知的模型-系统协同设计 (model-system co-design) 来最小化解码成本. Step-3 在两个关键维度上进行了创新: (1) 新型的多矩阵分解注意力 (Multi-Matrix Factorization Attention, MFA) 机制, 在保持高注意力表达能力的同时显著减少 KV 缓存大小和计算量; (2) 注意力-前馈网络解耦 (Attention-FFN Disaggregation, AFD), 一种将注意力层和前馈网络 (Feed-Forward Network, FFN) 层解耦到专用子系统的分布式推理系统. 这种协同设计实现了前所未有的成本效率: 与 DeepSeek-V3 和 Qwen3 MoE 235B 等模型相比, Step-3 显著降低了理论解码成本, 且上下文越长优势越明显. Step-3 在单 token 激活 38B 参数的情况下 (多于 DeepSeek-V3 和 Qwen3 MoE 235B) 实现了低成本, 表明与硬件对齐的注意力算术强度 (arithmetic intensity), 混合专家 (MoE) 稀疏性以及 AFD 是成本效益的关键. 我们在对 DeepSeek-V3 有利的场景下进行了正面比较. 我们在 Hopper GPU 上的实现在 50ms TPOT SLA 下达到了最高 4,039 tokens/second/GPU 的解码吞吐 (4K 上下文, FP8, 无 MTP), 高于同配置下 DeepSeek-V3 的 2,324, 为 LLM 解码树立了新的帕累托前沿 (Pareto frontier).

## 1 引言

This paper presents the model-system co-design of Step-3, specifically engineered for the test-time scaling paradigm with the primary optimization objective of minimizing decoding costs. Step-3 has 321 billion total parameters, while for each text token, 38B parameters are activated. We will demonstrate that, although Step-3 is in the multi-hundred billion parameter range and the activated parameters are slightly larger than representative open-weight models like DeepSeek V3 (DSv3) [4], we achieve significantly lower decoding costs with model-system co-design.

本文介绍 Step-3 的模型-系统协同设计, 该设计专门针对测试时扩展 (test-time scaling) 范式, 主要优化目标是最小化解码成本. Step-3 拥有总计 3,210 亿参数, 每个文本 token 激活 380 亿参数. 我们将证明, 尽管 Step-3 处于数千亿参数级别且激活参数量略高于 DeepSeek V3 (DSv3) [4] 等代表性开源权重模型, 但通过模型-系统协同设计, 我们实现了显著更低的解码成本.

We focus on optimizing decoding because 1) it is the most expensive per token (because of low MFU) compared with training and prefill. 2) For reasoning models, longer thinking leads to higher intelligence, so lowering decoding costs can translate to higher intelligence for fixed-budget scenarios. 3) Faster and cheaper decoding also speeds up the RL training. 4) There is a large room for optimization and is therefore more technically interesting.

我们专注于优化解码, 原因在于: 1) 与训练和预填充 (prefill) 相比, 解码是每个 token 最昂贵的阶段 (由于 MFU 较低); 2) 对于推理模型, 更长的思考过程带来更高的智能水平, 因此降低解码成本可以在固定预算场景下转化为更高的智能; 3) 更快且更便宜的解码也能加速 RL 训练; 4) 解码阶段存在巨大的优化空间, 因此更具技术趣味性.

> **译者注**: 此处揭示了 Step-3 的核心设计动机：在推理时代，decoding 阶段(自回归生成)的 MFU 通常仅 5-15%，远低于 prefill(30-50%)和训练(50-60%)。因此，降低 decoding 成本对部署 economics 的影响远大于单纯缩小模型规模。

Recently, there emerged several large open-weight models. Some of them explored novel architecture changes on top of traditional Transformers. The innovations focus on the two main Transformer components - there are new attention designs to reduce KV cache overhead during inference, and there are Mixture-of-Experts (MoE) structures to enhance FFN while limiting the growth of computation requirements. We also started to work on model architecture exploration, e.g., through MoE model development (Step-2 [20]) since late 2023 and MFA [7], a new attention architecture released in late 2024. In the process, observing the recent open-weight models, we identify two common suboptimal practices:

近期出现了多个大型开源权重模型. 其中一些在传统 Transformer 之上探索了新颖的架构变革. 这些创新聚焦于 Transformer 的两个主要组件: 新的注意力设计以减少推理时的 KV 缓存开销, 以及混合专家 (Mixture-of-Experts, MoE) 结构以增强 FFN 同时限制计算需求的增长. 我们同样自 2023 年末起通过 MoE 模型开发 (Step-2 [20]) 和 2024 年末发布的新型注意力架构 MFA [7] 进行模型架构探索. 在此过程中, 通过观察近期的开源权重模型, 我们发现两种常见的次优实践:


For attention, some are overly emphasizing on reducing KV cache sizes, at excessive cost of computation load. It makes the model less cost-effective to run on more affordable but weaker hardware. Meanwhile, it limits the room for other acceleration techniques like quantization and speculative decoding.

在注意力方面, 一些设计过度强调减小 KV 缓存大小, 却以过高的计算负载为代价. 这使得模型在更便宜但性能较弱的硬件上运行时成本效益降低. 同时, 这也限制了量化 (quantization) 和投机解码 (speculative decoding) 等其他加速技术的应用空间.

For FFN, some are overly emphasizing on pursuing sparser architectures without considering whether they fit today's hardware. It either harms the hardware efficiency, or lowering model performance without gaining cost advantages.

在 FFN 方面, 一些设计过度追求更稀疏的架构, 而未考虑其是否适配当今硬件. 这要么损害硬件效率, 要么在没有获得成本优势的情况下降低了模型性能.

> **译者注**: Step-3 对当前开源社区的两大趋势提出了尖锐批评：(1) Attention 侧过度追求 KV cache 压缩(如 MLA、MQA)，却增加了计算复杂度，在性价比硬件上反而得不偿失; (2) MoE 侧盲目追求激活参数量最小化，忽视了硬件实际吞吐约束。这种 "硬件-算法协同" 的视角是本文最具价值的洞察之一。

Hoping to inspire more discussion and rethinking about the above trends, we report our recent progress, Step-3, and the analysis and rationale behind its design. The outcome is promising - in Figure 1, we show the best theoretical decoding costs of Step-3 and recent models. For each model, we searched for the best deployment strategy based on Attention-FFN Disaggregation (AFD, §3), which we advocate, and any combination of H800, H20, A800 or Ascend 910B. Step-3 largely improves the Pareto frontier of activated parameters and decoding costs. Though not shown in the figure, its advantage continues to widen with longer context.

希望激发关于上述趋势的更多讨论与反思, 我们报告了近期进展 Step-3 及其设计背后的分析与原理. 结果是令人鼓舞的 - 在图 1 中, 我们展示了 Step-3 与近期模型的最佳理论解码成本. 对于每个模型, 我们基于我们倡导的注意力-FFN 解耦 (AFD, §3) 以及 H800, H20, A800 或 Ascend 910B 的任意组合, 搜索了最佳部署策略. Step-3 显著提升了激活参数量与解码成本之间的帕累托前沿. 尽管图中未展示, 其优势随上下文变长而持续扩大.

Our work is based on the assumption of deploying prior work of Prefill-Decoding (PD) disaggregation [18,31]. With it, we can focus only on optimizing decoding, without worrying about the impact on prefill. Readers will see similar benefits of deploying AFD, i.e., how it allows us to divide-and-conquer attention and FFN designs. It leads to a model architecture whose both parts are more cost-effective. We implement the inference system and show that Step-3 indeed achieves much lower decoding costs compared with other multi-billion parameter models.

我们的工作基于部署已有预填充-解码 (Prefill-Decoding, PD) 解耦工作 [18,31] 的假设. 基于此, 我们可以只专注于优化解码, 而无需担心对预填充的影响. 读者将看到部署 AFD 的类似好处, 即它如何使我们能够分而治之地设计注意力与 FFN. 这导出了一个两个部分都更具成本效益的模型架构. 我们实现了推理系统并证明, 与其他数百亿参数模型相比, Step-3 确实实现了低得多的解码成本.

Below is a summary of our findings.

以下是我们发现的总结.

Decoding costs go beyond parameter count: Neither the total parameter count or activated parameter count is a good indicator for decoding costs.

解码成本超越参数量: 总参数量或激活参数量都不是解码成本的良好指标.

For example, Qwen-3 MoE 235B exhibits only 10% lower theoretical decoding cost (on H20, the best hardware for it) than DSv3 (on H800, the best hardware for DSv3) despite having 65% fewer total parameters and 40% fewer activated parameters.

例如, Qwen-3 MoE 235B 的总参数量比 DSv3 少 65%, 激活参数量少 40%, 但其理论解码成本 (在 H20 上, 对其最佳的硬件) 仅比 DSv3 (在 H800 上, 对 DSv3 最佳的硬件) 低 10%.

Step-3 achieves ~40% decoding cost reduction versus both models despite its total parameter count being between the two models and having the highest activation parameters.

Step-3 的总参数量介于这两个模型之间且拥有最高的激活参数量, 但相比这两个模型实现了约 40% 的解码成本降低.

> **译者注**: "~40% 解码成本降低" 是 Step-3 的核心量化成果。值得注意的是，这一优势并非来自单纯缩小模型，而是通过 AFD 架构使 attention 和 FFN 分别运行在各自最优的硬件配置上(如 attention 用高算力卡、FFN 用高带宽卡)，实现了真正的 "分而治之"。

The attention design dominates decoding costs: With AFD, we decouple the cost analysis of attention and FFN because we can run them in the most cost-effective way, respectively. Then it becomes apparent that the attention design has a larger impact on decoding costs than (total or activated) parameter count.

注意力设计主导解码成本: 通过 AFD, 我们将注意力和 FFN 的成本分析解耦, 因为我们可以分别以最具成本效益的方式运行它们. 于是显而易见, 注意力设计对解码成本的影响大于 (总或激活) 参数量.

KV cache size is not the single factor impacting attention costs: We find that some attention designs requires too much computation (too high arithmetic intensity) for lower-cost hardware platforms. More importantly, we are the first to show this problem indeed affects the final decoding costs and thus leaves large room for Step-3 to achieve significant cost savings.

KV 缓存大小并非影响注意力成本的唯一因素: 我们发现某些注意力设计对低成本硬件平台需要过多计算 (算术强度过高). 更重要的是, 我们首次证明这个问题确实影响了最终解码成本, 从而为 Step-3 实现显著的成本节约留下了巨大空间.

MoE needs hardware-aware design: The degree of MoE sparsity must joinly consider hardware's computation power, memory bandwidth and network bandwidth. Overly sparse models may have small activated parameters on paper, but run inefficiently on today's hardware.

MoE 需要硬件感知的设计: MoE 稀疏程度必须综合考虑硬件的计算能力, 内存带宽和网络带宽. 过度稀疏的模型在纸面上激活参数量很小, 但在当今硬件上运行效率低下.

> **译者注**: 文中提出的 "MoE 稀疏度必须与硬件协同设计" 是一个容易被忽视的关键点。DeepSeek-V3 采用极高稀疏比(37B/671B ≈ 5.5%)在理论上很优，但专家并行(EP)的 all-to-all 通信开销在低端卡上可能成为瓶颈。Step-3 的稀疏比(38B/321B ≈ 11.8%)看似更高，但在实际部署中可能因更均衡的通信-计算比而获得更好的 wall-clock 效率。

For decoding acceleration, the devil is in the details: Linear attention, quantization, and MTP are all promising directions to accelerate decoding. However, some design points that may seem nuance can remove most of the benefits in decoding.

对于解码加速, 细节决定成败: 线性注意力, 量化和 MTP 都是加速解码的有前景的方向. 然而, 一些看似细微的设计点可能会消除解码中的大部分收益.

AFD deployment: We believe it is the superior decoding system design compared with existing solutions, because of the following unique advantages:

AFD 部署: 我们相信相比现有方案, 它是更优的解码系统设计, 原因如下:

Facilitating divide-and-conquer model design.

便于分而治之的模型设计.

Easy scaling of attention instances to handle dynamic context length.

注意力实例易于扩展以处理动态上下文长度.

Always keeping an ideal batch size for FFN to achieve high MFU, independent from attention.

始终为 FFN 保持理想的 batch size 以实现高 MFU, 与注意力无关.

Overlapping communication overhead with a perfectly balanced pipeline.

通过完美平衡的流水线重叠通信开销.

Reducing the scale requirement compared with DeepEP [30], and getting better reliability and less EP imbalance.

相比 DeepEP [30] 降低规模要求, 获得更好的可靠性和更少的 EP 负载不均衡.

Allowing the use of heterogeneous hardware to further reduce decoding costs.

允许使用异构硬件以进一步降低解码成本.

> **译者注**: AFD(Attention-FFN Disaggregation)是本文的架构核心创新，将在 §3 展开。其本质是将 Transformer 的两条主要计算路径拆分到不同硬件集群上运行，打破了传统 "同构部署" 的假设。这种思路类似于训练中的 TP+PP 混合并行，但首次系统性地应用于推理 serving 场景。

## 2 Step-3 模型卡片

Before diving into the model-system co-design details, we briefly describe Step-3.

在深入模型-系统协同设计细节之前, 我们简要介绍 Step-3.

Step-3 is built upon the Transformer architecture [24], with each Transformer block comprising an attention module and a Feed-Forward Network (FFN). For the attention mechanism, we introduce Multi-Matrix Factorization Attention (MFA) [7], which leverages low-rank matrix factorization in the Query-Key (QK) circuit [5]. This design enables parameter-efficient scaling of both the number and dimensionality of attention heads while minimizing KV cache overhead. For FFNs, we adopt a shared expert design inspired by DeepSeekMoE, incorporating Mixture-of-Experts (MoE) layers. Our configuration includes 61 Transformer layers with a hidden dimension of 7168. For MFA, we configure 64 query heads and they share a Key and a Value head, all with a dimension of 256. The query dimension is down-projected from 7168 to a lower-rank of 2048, followed by a normalization, and then up-projected to 64*256. MoE layers are applied to all FFNs except the first four and the last layer. Under this setup, Step-3 comprises 316 billion parameters, with 38 billion activated per token. There is an additional vision encoder of 5 billion parameters, which we do not discuss in this paper because it is irrelevant to decoding.

Step-3 基于 Transformer 架构 [24] 构建, 每个 Transformer 块包含一个注意力模块和一个前馈网络 (FFN). 在注意力机制方面, 我们引入了多矩阵分解注意力 (MFA) [7], 它在查询-键 (Query-Key, QK) 电路 [5] 中利用低秩矩阵分解. 该设计实现了注意力头数量和维度的参数高效扩展, 同时最小化 KV 缓存开销. 对于 FFN, 我们采用受 DeepSeekMoE 启发的共享专家 (shared expert) 设计, 引入混合专家 (MoE) 层. 我们的配置包含 61 层 Transformer, 隐藏维度为 7168. 对于 MFA, 我们配置 64 个查询头 (query heads), 它们共享一个键头和一个值头, 维度均为 256. 查询维度从 7168 下投影 (down-projected) 到低秩 2048, 经过归一化后, 再上投影 (up-projected) 到 64*256. MoE 层应用于除前四层和最后一层外的所有 FFN. 在此配置下, Step-3 包含 3,160 亿参数, 每 token 激活 380 亿参数. 此外还有一个 50 亿参数的视觉编码器, 本文不讨论它, 因为它与解码无关.

In the future, we will release more details on the model side for Step-3.

未来, 我们将发布更多关于 Step-3 模型层面的细节.

> 译者注: Step-3 的 MoE 架构采用了共享专家 (shared expert) 设计, 这是一种在 DeepSeekMoE 中验证有效的稀疏化策略. 值得注意的是, 模型刻意避开了前四层和最后一层的 MoE 化, 这与早期层需要更稳定特征表示, 输出层需要集中预测能力的经验一致. 总参数量 316B 中仅激活 38B, 稀疏比约 8.3:1, 属于当前大模型中相对保守但硬件友好的稀疏度.

Table 1: Model card for Step-3.

表 1: Step-3 模型卡片.

| 属性 | 数值 |
|:---|:---|
| Layers | 61 |
| Hidden Dimension | 7168 |
| Attention Mechanism | MFA |
| Low-rank Query Dimension | 2048 |
| # Query Heads | 64 |
| Head Dimension | 256 |
| # Shared Experts | 1 |
| MoE Layer Configuration | All layers except the first four and last layer |
| Total Parameters (LLM) | 316 Billion |
| Activated Params per Token | 38 Billion |
| Total Parameters (VLM) | 321 Billion |


## 3 注意力-FFN 解耦 (Attention-FFN Disaggregation, AFD)

We start by describing Step-3 inference system, which may be one of the first production quality serving systems that leverages the Attention-FFN Disaggregation (AFD) idea and achieves high-throughput decoding under strict SLO constraints. First, we elaborate on the rationale behind the AFD design.

我们首先描述 Step-3 的推理系统, 它可能是首批利用注意力-FFN 解耦 (AFD) 理念并在严格 SLO 约束下实现高吞吐解码的生产级服务系统之一. 首先, 我们阐述 AFD 设计背后的原理.

Rationale. LLMs are typically composed of interleaved attention and Feed-Forward Network (FFN) layers, each exhibiting distinct computational and memory access patterns. For example, attention layers typically have a smaller number of parameters, but require storing the key-value cache (KV-cache) for each token, which is memory-intensive during inference. In contrast, FFN layers generally take up a much larger parameter count, especially for MoE models, yet do not require storing intermediate computation results. We will dive into the operational characteristics and inference costs of attention and FFN layers in §4.

原理. LLM 通常由交错排列的注意力层和前馈网络 (FFN) 层组成, 各自展现出不同的计算和内存访问模式. 例如, 注意力层通常参数量较小, 但需要为每个 token 存储键值缓存 (KV-cache), 这在推理期间是内存密集型的. 相比之下, FFN 层通常占用更大的参数量, 尤其对 MoE 模型而言, 但不需要存储中间计算结果. 我们将在 §4 中深入探讨注意力层和 FFN 层的运行特性与推理成本.

Existing serving systems often treat these layers as monolithic blocks and overlook their intrinsic differences, leading to suboptimal GPU utilization. Hence, by disaggregating the attention and FFN components, we can better exploit their respective hardware affinities and optimize throughput. In addition, the disaggregation provides us with an opportunity to make an assumption: Both the attention and FFN parts can operate under ideal hardware conditions and can achieve high MFU, respectively.

现有的服务系统通常将这些层视为单一整体块, 忽视其内在差异, 导致 GPU 利用率不佳. 因此, 通过将注意力与 FFN 组件解耦, 我们可以更好地利用各自的硬件亲和性并优化吞吐. 此外, 解耦为我们提供了一个假设机会: 注意力部分和 FFN 部分都可以在理想的硬件条件下运行, 并分别实现高 MFU.

This idea is based on the Prefill-Decoding (PD) disaggregation approach [31], which advocates separating the prefill and decoding stages to optimize resource utilization. Hence, we focus on the decoding stage with AFD without worrying about the impact on prefill. The analysis will become much simpler with this divide-and-conquer approach.

这一想法基于预填充-解码 (PD) 解耦方法 [31], 该方法倡导分离预填充和解码阶段以优化资源利用. 因此, 我们通过 AFD 专注于解码阶段, 而无需担心对预填充的影响. 这种分而治之的方法将使分析大为简化.

> 译者注: AFD (Attention-FFN Disaggregation) 可视为 PD (Prefill-Decoding) 解耦思想在模型内部组件层面的自然延伸. PD 将预填充与解码分离, 而 AFD 进一步将注意力与 FFN 分离, 形成 "双层解耦". 这种架构的关键洞察在于: 注意力和 FFN 具有截然不同的计算特征 (内存密集型 vs 计算密集型), 强行放在同一张 GPU 上会导致两者互相拖累, 而分离后各自可以针对硬件特性做极致优化.

### 3.1 设计目标

AFD deploys the attention and FFN layers onto separate sets of GPUs. This architectural separation allows each subsystem to adopt different parallelism strategies that best suit their computational characteristics. During layer-wise decoding, hidden states are transmitted between the attention and FFN subsystems through high-speed network communication. This interleaved communication pattern forms a tightly coupled pipeline, where attention and FFN act as upstream and downstream stages for each other.

AFD 将注意力层和 FFN 层部署到不同的 GPU 集合上. 这种架构分离允许每个子系统采用最适合其计算特性的不同并行策略. 在逐层解码过程中, 隐藏状态通过高速网络通信在注意力子系统和 FFN 子系统之间传输. 这种交错通信模式形成了一个紧密耦合的流水线, 其中注意力和 FFN 互为上下游阶段.

Furthermore, network transmission latency must also be taken into account. In such fine-grained scenarios, its magnitude is comparable to the computation time of both attention and FFN stages. This means that the communication stage should also be considered when orchestrating the pipeline.

此外, 网络传输延迟也必须纳入考量. 在这种细粒度场景中, 其量级与注意力和 FFN 阶段的计算时间相当. 这意味着在编排流水线时也应考虑通信阶段.

To achieve optimal overall performance, the processing latency of both sides must be precisely matched; any imbalance leads to pipeline stalls or under-utilized resources. Therefore, it is essential to jointly orchestrate the performance of A/F and communication stages.

为实现最佳整体性能, 两侧的processing latency必须精确匹配; 任何不平衡都会导致流水线停顿或资源利用率不足. 因此, 必须联合编排注意力/FFN (A/F) 和通信阶段的性能.

We summarize the design goals of AFD as follows, which will be discussed in detail later:

我们将 AFD 的设计目标总结如下, 稍后将详细讨论:

Performance target: 50ms time per output token (TPOT, >=20 tokens/sec) via a 3-stage pipeline, with 16.6ms per stage for A/F/communication, respectively. Here the time is accumulated across all model layers.

性能目标: 通过 3 级流水线实现每输出 token 50ms 的 TPOT (>=20 tokens/sec), 注意力/FFN/通信每个阶段分别占 16.6ms. 此处时间为所有模型层累积时间.

Pipeline optimization: Resource allocation and performance tuning that enable perfect A/F/communication multi-stages pipelining, hiding communication latency.

流水线优化: 资源分配与性能调优, 实现完美的 A/F/通信多级流水线, 隐藏通信延迟.

Independent design of A/F: With AFD, we can independently analyze the operational characteristics of attention and FFN. This separation not only enables optimal optimization for each subsystem, but also allows for flexible architectural modifications to the model itself.

A/F 独立设计: 通过 AFD, 我们可以独立分析注意力和 FFN 的运行特性. 这种分离不仅使每个子系统获得最优优化, 还允许对模型本身进行灵活的架构修改.

Hardware selection: Independent hardware selection for attention and FFN subsystems based on their operational characteristics.

硬件选择: 根据注意力和 FFN 子系统的运行特性进行独立的硬件选择.

### 3.2 与相关工作的比较

DeepSeek EP. Large Expert Parallelism (EP) architecture is introduced in DeepSeek-V3 [4] to improve serving efficiency. Although EP also facilitates batch size amplification by distributing expert weights to multiple devices, we argue that this approach exhibits fundamental limitations compared to AFD.

DeepSeek EP. DeepSeek-V3 [4] 引入了大型专家并行 (Large Expert Parallelism, EP) 架构以提高服务效率. 尽管 EP 也通过将专家权重分布到多个设备来放大 batch size, 但我们认为与 AFD 相比, 这种方法存在根本性局限.

Alternatively, we can also use a 4-stage pipeline: A -> communication -> F -> communication, with a 12.5ms budget for each stage.

或者, 我们也可以使用 4 级流水线: A -> 通信 -> F -> 通信, 每个阶段预算 12.5ms.

Deployment scale: A key advantage of AFD is its ability to operate efficiently at a smaller deployment scale. As mentioned before, DSv3 requires 320 GPUs for a decoding instance, while Step-3 only uses 32 GPUs (§7.3). If the deployment scale expands significantly, network congestion becomes a critical issue [29], resulting in increased and unpredictable latency. This heightened latency can severely impact the serving system's ability to meet inference SLA.

部署规模: AFD 的一个关键优势是能够在更小的部署规模下高效运行. 如前所述, DSv3 的解码实例需要 320 张 GPU, 而 Step-3 仅使用 32 张 GPU (§7.3). 如果部署规模大幅扩展, 网络拥塞将成为关键问题 [29], 导致延迟增加且不可预测. 这种增加的延迟会严重影响服务系统满足推理 SLA 的能力.

Context-length efficiency: Long-context processing disproportionately burdens EP's attention layers, causing FFN under-utilized due to fixed expert-node allocation. AFD resolves this via decoupled scaling of attention and FFN. We will present quantitative results on different context lengths in §4.

上下文长度效率: 长上下文处理给 EP 的注意力层带来不成比例的负担, 导致 FFN 因固定的专家节点分配而利用率不足. AFD 通过注意力与 FFN 的解耦扩展解决了这一问题. 我们将在 §4 中展示不同上下文长度的定量结果.

Load imbalance issue: EP suffers from the well-known workload imbalanced issue [13,14]. DeepSeek-V3 alleviates this issue using duplicated experts that can balance each GPU's workload in an ad-hoc manner. But this approach incurs additional memory overhead, and is inflexible to dynamic workload changes, especially when the data distribution shifts significantly. On the other hand, AFD can easily leverage hybrid TP-EP strategy to strike a balance between computation efficiency, communication traffic, and load balancing.

负载不均衡问题: EP 存在众所周知的负载不均衡问题 [13,14]. DeepSeek-V3 使用重复专家 (duplicated experts) 以临时方式平衡每个 GPU 的工作负载来缓解该问题. 但这种方法会带来额外的内存开销, 并且对动态工作负载变化缺乏灵活性, 尤其在数据分布显著变化时. 另一方面, AFD 可以轻松利用混合 TP-EP 策略, 在计算效率, 通信流量和负载均衡之间取得平衡.

Heterogeneous hardware constraints: AFD enables more flexible hardware deployment, in that attention and FFN instances can be mapped to heterogeneous hardware tailored to their respective compute and memory requirements, while EP forces homogeneous hardware deployment, limiting specialization benefits.

异构硬件约束: AFD 实现了更灵活的硬件部署, 因为注意力实例和 FFN 实例可以映射到针对各自计算和内存需求定制的异构硬件, 而 EP 强制同构硬件部署, 限制了专业化收益.

Performance modeling: Our following analytical framework leverages the architectural disaggregation of attention and FFN. This separation provides methodological clarity due to their divergent computational profiles, which enables more accurate modeling of performance ceilings while substantially narrowing the gap between theoretical projections and empirical measurements. Contrarily, EP-only architecture lacks this divide-and-conquer clarity, suffering from inherent analytical ambiguity when modeling coupled subsystems.

性能建模: 我们后续的分析框架利用了注意力与 FFN 的架构解耦. 由于两者计算特征迥异, 这种分离提供了方法论上的清晰性, 使得性能上限的建模更加准确, 并大幅缩小理论预测与实测结果之间的差距. 相反, 纯 EP 架构缺乏这种分而治之的清晰性, 在建模耦合子系统时存在固有的分析模糊性.

In particular, we note that AFD is not a replacement for EP, but rather a complementary approach. In fact, Step-3 can be combined with the TP-EP strategy to achieve better performance and cost-effectiveness. The above analysis is against the EP-only architecture that does not employ AFD, which is commonly used in existing serving systems [4,33].

特别需要指出, AFD 并非要取代 EP, 而是一种互补方法. 事实上, Step-3 可以与 TP-EP 策略结合以实现更好的性能和成本效益. 上述分析针对的是不采用 AFD 的纯 EP 架构, 这是现有服务系统 [4,33] 中常见的做法.

Megascale-Infer. To our knowledge, Megascale-Infer [32] is the first to build a disaggregated serving system leveraging the AFD idea. However, it focuses on high throughput rather than providing a practical implementation to achieve the low latency target (i.e., 50ms TPOT) simultaneously. In fact, according to [32], the reported latency per token of Megascale-Infer is 150ms, which is significantly higher than ours. Such high latency is not applicable for real-time applications like chatbots. Moreover, the core of Step-3 is in model-system co-design, and we use the AFD idea to design Step-3's model architecture for attention and FFN layers, while Megascale-Infer primarily only focuses on system-level optimizations. We believe the co-design brings more opportunities to thoroughly exploit the hardware capabilities.

Megascale-Infer. 据我们所知, Megascale-Infer [32] 是第一个构建利用 AFD 理念解耦服务系统的项目. 然而, 它侧重于高吞吐, 而非同时提供实现低延迟目标 (即 50ms TPOT) 的实用方案. 事实上, 根据 [32], Megascale-Infer 报告的每 token 延迟为 150ms, 显著高于我们. 如此高的延迟不适用于聊天机器人等实时应用. 此外, Step-3 的核心在于模型-系统协同设计, 我们利用 AFD 理念来设计 Step-3 的注意力层和 FFN 层模型架构, 而 Megascale-Infer 主要只关注系统级优化. 我们相信协同设计带来了更多彻底挖掘硬件能力的机会.

## 4 LLM 解码的成本分析

Given the important assumption that, with AFD, the attention part and the FFN part can operate near hardware limitations, we will now delve into the theoretical costs of each model. We compare Step-3 with several recently released models, namely DSv3 [4], Kimi K2 [17], Qwen3-235B-A22B [8] (Qwen3-MoE for brevity), Qwen3-32B [25], Llama 4 Maverick [15], MiniMax M1 [16] (MM M1), ERNIE 4.5 [22], and Pangu Pro MoE [21].

基于 AFD 下注意力部分和 FFN 部分可以接近硬件极限运行的重要假设, 我们现在深入探讨各模型的理论成本. 我们将 Step-3 与多个近期发布的模型进行比较, 包括 DSv3 [4], Kimi K2 [17], Qwen3-235B-A22B [8] (简称为 Qwen3-MoE), Qwen3-32B [25], Llama 4 Maverick [15], MiniMax M1 [16] (MM M1), ERNIE 4.5 [22] 和 Pangu Pro MoE [21].

### 4.1 理论 FLOPs 与内存访问

We begin by examining the overall memory access and computational operations required for decoding each token. Given that various quantization methods directly impact memory access and the type of floating point computation, we select widely used quantized versions for each model:

我们首先检查解码每个 token 所需的总体内存访问和计算操作. 鉴于各种量化方法直接影响内存访问和浮点计算类型, 我们为每个模型选择了广泛使用的量化版本:

MLA family: The official implementation of DSv3 uses BF16 for attention, with other parts in FP8. However, recognizing the existence of an FP8 quantized version of MLA within the open-source community, we adopt FP8 quantization for the whole model. The same quantization is applied to Kimi K2.

MLA 家族: DSv3 的官方实现对注意力使用 BF16, 其他部分使用 FP8. 然而, 考虑到开源社区中存在 FP8 量化的 MLA 版本, 我们对整个模型采用 FP8 量化. Kimi K2 也应用相同的量化.

GQA family: The official release of Qwen3 includes full FP8 quantization, which we will use. For other models like ERNIE 4.5 and Pangu Pro MoE, to align with Qwen3, we also use the same quantization. We believe the risk of losing model accuracy is low given our own experience with GQA models.

GQA 家族: Qwen3 的官方发布包含完整的 FP8 量化, 我们将采用该方案. 对于 ERNIE 4.5 和 Pangu Pro MoE 等其他模型, 为与 Qwen3 对齐, 我们也使用相同的量化. 根据我们对 GQA 模型的经验, 我们认为模型精度损失的风险较低.

Hybrid models: The official quantization of Llama 4 Maverick and MiniMax M1 is conservative, especially for attention. As hybrid attention model's quantization remains largely unexplored for us, we mostly follow the official setup, i.e., BF16 KV for full attention layers because they are critical for long context tasks. We use FP32 for MiniMax M1's Lightning Attention states, the same as its official setup. We give Llama 4 Maverick a favor for using FP8 for its chunked GQA attention, again based on our experience with GQA. For all the other parts we adopt the same aggressive FP8 quantization like all other evaluated models, to have a fair comparison.

混合模型: Llama 4 Maverick 和 MiniMax M1 的官方量化较为保守, 尤其在注意力方面. 由于混合注意力模型的量化对我们来说仍很大程度上未被探索, 我们主要遵循官方设置, 即对全注意力层使用 BF16 KV, 因为它们对长上下文任务至关重要. 我们对 MiniMax M1 的 Lightning Attention 状态使用 FP32, 与其官方设置一致. 基于我们对 GQA 的经验, 我们对 Llama 4 Maverick 的分块 GQA 注意力使用 FP8 给予优待. 对于所有其他部分, 我们像其他被评估模型一样采用激进的 FP8 量化, 以确保公平比较.

Step-3: we have successfully quantized Step-3 to be a full FP8 model without losing model accuracy. So we use full FP8 quantization, which aligns with MLA and GQA family. If the hardware does not support FP8 quantization, we assume the use of INT8 weights and INT8 KV cache instead of FP8, so the memory access remains the same. The computation will be in BF16 or FP16.

Step-3: 我们已成功将 Step-3 量化为完整的 FP8 模型而未损失模型精度. 因此我们使用完整的 FP8 量化, 与 MLA 和 GQA 家族对齐. 如果硬件不支持 FP8 量化, 我们假设使用 INT8 权重和 INT8 KV 缓存代替 FP8, 因此内存访问保持不变. 计算将在 BF16 或 FP16 中进行.


Table 2: Theoretical computation and memory access per decoding token at 8K context length.

表 2: 8K 上下文长度下每解码 token 的理论计算量与内存访问.

| 模型 | KV/状态内存访问 (字节) | 不含线性投影的注意力计算 (FLOPs) | 注意力前后线性投影 (FLOPs) | FFN 计算 (FLOPs) |
|:---|:---|:---|:---|:---|
| DSv3 | 2.88x10^8 | 1.47x10^11 | 2.28x10^10 | 4.84x10^10 |
| Kimi K2 | 2.88x10^8 | 7.37x10^10 | 1.23x10^10 | 4.84x10^10 |
| Qwen3 MoE | 7.89x10^8 | 2.52x10^10 | 1.34x10^10 | 2.84x10^10 |
| Qwen3 32B | 1.07x10^9 | 1.72x10^10 | 1.21x10^10 | 5.03x10^10 |
| Llama 4 M | 1.01x10^9 | 8.05x10^9 | 6.04x10^9 | 2.42x10^10 |
| MM M1 | 9.23x10^8 | 3.42x10^9 | 3.75x10^10 | 5.44x10^10 |
| ERNIE 4.5 | 9.06x10^8 | 1.45x10^10 | 1.63x10^10 | 7.61x10^10 |
| Pangu Pro | 8.05x10^8 | 8.05x10^9 | 6.04x10^9 | 2.38x10^10 |
| Step-3 | 2.56x10^8 | 3.27x10^10 | 2.07x10^10 | 5.33x10^10 |

> **译者注**: Step-3 能实现全 FP8 量化而不损失精度，得益于其 MFA(Multi-head Fixed Attention)架构的数值稳定性。相比 MLA 的压缩 KV cache 需要保留部分 BF16 精度，MFA 的固定状态矩阵对量化更友好。这是 Step-3 在成本控制上的又一结构性优势。

Table 3: Theoretical computation and memory access per decoding token at 32K context length.

表 3: 32K 上下文长度下每解码 token 的理论计算量与内存访问.

| 模型 | KV/状态内存访问 (字节) | 不含线性投影的注意力计算 (FLOPs) | 注意力前后线性投影 (FLOPs) | FFN 计算 (FLOPs) |
|:---|:---|:---|:---|:---|
| DSv3 | 1.15x10^9 | 5.89x10^11 | 2.28x10^10 | 4.84x10^10 |
| Kimi K2 | 1.15x10^9 | 2.95x10^11 | 1.23x10^10 | 4.84x10^10 |
| Qwen3 MoE | 3.15x10^9 | 1.01x10^11 | 1.34x10^10 | 2.84x10^10 |
| Qwen3 32B | 4.29x10^9 | 6.87x10^10 | 1.21x10^10 | 5.03x10^10 |
| Llama 4 M | 2.21x10^9 | 1.41x10^10 | 6.04x10^9 | 2.42x10^10 |
| MM M1 | 1.93x10^9 | 1.15x10^10 | 3.75x10^10 | 5.44x10^10 |
| ERNIE 4.5 | 3.62x10^9 | 5.80x10^10 | 1.63x10^10 | 7.61x10^10 |
| Pangu Pro | 3.22x10^9 | 3.22x10^10 | 6.04x10^9 | 2.38x10^10 |
| Step-3 | 1.02x10^9 | 1.31x10^11 | 2.07x10^10 | 5.33x10^10 |

The results are listed in Table 2 and 3. With the assumption of AFD, we divide the model costs into three parts: attention (without linear projection), the linear projection before and after attention, and FFN. For the first part, we consider the KV cache size and the computation simultaneously, since they grow linearly with batch size and context length.

结果列于表 2 和表 3. 在 AFD 假设下, 我们将模型成本分为三部分: 注意力 (不含线性投影), 注意力前后的线性投影, 以及 FFN. 对于第一部分, 我们同时考虑 KV 缓存大小和计算量, 因为它们随 batch size 和上下文长度线性增长.

For the linear projection before and after attention, we assume they can achieve compute-bound performance with sufficient batching. In this case, the memory access of the weights is amortized, and the costs will be determined by FLOPs. There is an exception where the q/k/v_proj of MLA and MFA may not be able to run in H800's compute-bound area, due to those parts not being TP-friendly and may not have a large enough batch size for H800. This means we slightly underestimate MLA and MFA costs on H800. However, this is a relatively small part of the total costs and specific to H800, so we omit it for simplicity.

对于注意力前后的线性投影, 我们假设它们在足够大的 batching 下可以达到计算受限 (compute-bound) 性能. 在这种情况下, 权重的内存访问被摊销, 成本由 FLOPs 决定. 存在一个例外: MLA 和 MFA 的 q/k/v_proj 由于不适合 TP 且可能没有足够大的 batch size 来喂饱 H800, 可能无法在 H800 的计算受限区域运行. 这意味着我们在 H800 上略微低估了 MLA 和 MFA 的成本. 然而, 这部分在总成本中占比较小且仅针对 H800, 因此为简洁起见我们将其省略.

For FFN, we focus only on the activated computation volume because, using AFD for not-too-sparse MoE, sufficient batching can always be accumulated for FFN to reach high MFU and amortize the memory access for weights. Further details on MoE sparsity are discussed in the §5. In the worst case, over-sparse models like DSv3, Kimi K2 and Llama 4 Marverick may see their FFN cost doubling or even tripling on H800 in real deployment. For now, we omit it for simplicity and give them a favor.

对于 FFN, 我们只关注激活的计算量, 因为对于不太稀疏的 MoE 使用 AFD 时, 总能积累足够的 batching 使 FFN 达到高 MFU 并摊销权重的内存访问. 关于 MoE 稀疏性的更多细节在 §5 中讨论. 在最坏情况下, 像 DSv3, Kimi K2 和 Llama 4 Maverick 这样过度稀疏的模型在实际部署中 FFN 成本可能在 H800 上翻倍甚至三倍. 目前为简洁起见我们将其省略, 并给予了它们优待.

We also omit the embedding table and the final output linear layer since they consume relatively small (< 5%) memory access and computation for these models, and they are not too different across different models.

我们还省略了嵌入表 (embedding table) 和最终的输出线性层, 因为它们在这些模型中消耗的内存访问和计算相对较小 (< 5%), 且在不同模型之间差异不大.

### 4.2 理论解码成本 (USD)

Next, we can calculate the theoretical decoding costs of the models on different accelerators. Table 4 shows the accelerator specifications and their estimated prices on public clouds.

接下来, 我们可以计算各模型在不同加速器上的理论解码成本. 表 4 展示了加速器规格及其在公有云上的预估价格.

Suppose, in the theoretically ideal case, accelerators constantly at their peak FLOPs and maximum memory bandwidth, we derive the unit costs of a floating-point operation (UFLOP) and a byte of memory access (Ubyte), in Table 5.

> **译者注**: 此处体现了 AFD 的核心理论优势：通过将 FFN 部署在独立的 GPU 集群上，可以不受 attention 侧动态 batch size 的干扰，始终维持大 batch 下的高 MFU(通常 70-90%)。这意味着 FFN 的权重访存可以被充分摊销，实际成本趋近于纯计算成本。而传统同构部署中，attention 和 FFN 共享 GPU，batch size 受限于 KV cache 容量，FFN 往往只能跑在小 batch、低 MFU 状态。

假设在理论理想情况下, 加速器持续处于峰值 FLOPs 和最大内存带宽, 我们推导出浮点运算单位成本 (UFLOP) 和每字节内存访问成本 (Ubyte), 列于表 5.

The theoretical cost of the attention part is the larger of the attention's core computation and memory access costs, plus the linear computation before and after:

注意力部分的理论成本是注意力核心计算成本与内存访问成本中的较大者, 加上注意力前后的线性计算成本:

max(FLOP_Attn * U_FLOP, Byte_KV * U_byte) + FLOP_Linear * U_FLOP

Assuming, with AFD, we can keep the FFN part in the compute-bound region, the theoretical cost of the FFN part is simply the computation cost FLOP_FFN * U_FLOP.

假设在 AFD 下我们可以将 FFN 部分保持在计算受限区域, FFN 部分的理论成本就是计算成本 FLOP_FFN * U_FLOP.

Combining the attention and FFN parts, we obtain Table 6. The final costs of different deployment choices can be directly computed. For example, we can add the attention and FFN parts together for different context on each hardware. For AFD, we choose the cheapest hardware for attention cost and FFN cost, respectively, and then sum them up. We assume all communication time on network can be overlapped by computation in a multi-batch pipeline, so the communication costs are ignored.

结合注意力与 FFN 部分, 我们得到表 6. 不同部署选择的最终成本可以直接计算. 例如, 我们可以将不同硬件上不同上下文的注意力成本和 FFN 成本相加. 对于 AFD, 我们分别为注意力成本和 FFN 选择最便宜的硬件, 然后求和. 我们假设网络中的通信时间可以通过多批次流水线中的计算重叠, 因此忽略通信成本.

For brevity, we only show the results of Qwen family (representative for GQA models), DSv3 (representative for MLA models), and Step-3 in Figure 2. With all the results shown, we make the following observations:

为简洁起见, 我们在图 2 中仅展示 Qwen 家族 (GQA 模型代表), DSv3 (MLA 模型代表) 和 Step-3 的结果. 基于所有展示的结果, 我们得出以下观察:

Observation 1: Step-3 has the lowest decoding costs. When at 8K context length, Step-3 is the most cost-effective at 0.055 per 1M decoding tokens (with AFD, H800 and H20), lower than DSv3's 0.068 (with EP and H800) and Qwen MoE's 0.062 (with AFD, H800 and H20). The advantage is larger at 32K context, with Step-3 at 0.129, significantly lower than DSv3's 0.211 and Qwen-3 MoE's 0.193.

观察 1: Step-3 具有最低的解码成本. 在 8K 上下文长度时, Step-3 最具成本效益, 每 1M 解码 token 成本为 0.055 USD (AFD, H800 和 H20), 低于 DSv3 的 0.068 (EP 和 H800) 和 Qwen MoE 的 0.062 (AFD, H800 和 H20). 在 32K 上下文时优势更大, Step-3 为 0.129, 显著低于 DSv3 的 0.211 和 Qwen-3 MoE 的 0.193.

Observation 2: Total and activated parameter numbers are bad indicator for decoding costs. Qwen3 32B has much less total parameters than DSv3 and Step-3, and also slightly less activated parameters. However, the decoding cost of Qwen3 32B is the highest among all models in Figure 2.

观察 2: 总参数量和激活参数量是解码成本的糟糕指标. Qwen3 32B 的总参数量远小于 DSv3 和 Step-3, 激活参数量也略少. 然而, Qwen3 32B 的解码成本在图 2 的所有模型中最高.

Observation 3: The cost of attention is dominating the total decoding cost. It is clear in Table 6, at 8K context length, attention is already significantly more expensive than FFN. The gap grows quickly with longer context, given that FFN's cost is irrelevant to context length. This means the attention design matters much more than activated number of parameters - that's the reason for Observation 2.

观察 3: 注意力成本主导了总解码成本. 在表 6 中清晰可见, 在 8K 上下文长度时, 注意力已经显著比 FFN 昂贵. 随着上下文变长, 差距迅速扩大, 因为 FFN 成本与上下文长度无关. 这意味着注意力设计远比激活参数量重要 - 这就是观察 2 的原因.

Observation 4: Hardware friendliness. DSv3's MLA is quite unfriendly to hardware other than H800, resulting in multi-fold increase when running on hardware weaker than H800. GQA models like Qwen3 are quite unfriendly to hardware other than H20, because of large KV sizes. In contrast, Step-3's MFA is more hardware-friendly, with minimal cost differences for weaker hardware. We show this in Figure 2.

观察 4: 硬件友好性. DSv3 的 MLA 对除 H800 外的硬件相当不友好, 在弱于 H800 的硬件上运行会导致数倍成本增加. 像 Qwen3 这样的 GQA 模型由于 KV 尺寸较大, 对除 H20 外的硬件相当不友好. 相比之下, Step-3 的 MFA 更具硬件友好性, 在较弱硬件上的成本差异极小. 我们在图 2 中展示了这一点.

> 译者注: 本节的理论成本分析采用了一个关键的 "理想假设": 所有模型都能在各自最适合的硬件上以理论峰值运行, 且通信可被完全隐藏. 这个假设对比较不同架构的 "理论下限" 是公平的, 但读者应注意实际部署中, 过度稀疏的模型 (如 DSv3) 会因专家并行 (EP) 的负载不均衡和网络瓶颈而远离理论成本. Step-3 通过 AFD 和适度的稀疏性, 在实际部署中更接近理论下限.

Table 4: Comparison of accelerator specifications. *We do not have publicly available 910B pricing. We estimate its price proportionally based on its FLOPs and A800's. As far as we know, there are multiple versions of 910B. We show the weakest and (presumably) most affordable one that we know.

表 4: 加速器规格比较. *我们没有公开可得的 910B 定价. 我们根据其 FLOPs 和 A800 的价格按比例估算. 据我们所知, 910B 有多个版本. 我们展示的是我们所知的最弱 (推测也是最便宜) 的版本.

| 加速器 | 每卡每小时价格 (USD) | BF16/FP16 FLOPs | FP8 FLOPs | 内存带宽 (B/s) | 计算-带宽比 (roofline) |
|:---|:---|:---|:---|:---|:---|
| NVIDIA H800 | 2 | 9.89x10^14 | 1.98x10^15 | 3.35x10^12 | 591 |
| NVIDIA H20 | 0.8 | 1.48x10^14 | 2.96x10^14 | 4.00x10^12 | 74 |
| NVIDIA A800 | 0.75 | 3.12x10^14 | N/A | 2.00x10^12 | 156 |
| Ascend 910B | 0.67* | 2.80x10^14 | N/A | 1.60x10^12 | 175 |

Table 5: The unit cost of different accelerators assuming full utilization for the whole month. For FLOP costs, we consider FP8 for H800 and H20, BF16/FP16 for A800 and 910B.

表 5: 不同加速器在整月满负载假设下的单位成本. 对于 FLOP 成本, H800 和 H20 考虑 FP8, A800 和 910B 考虑 BF16/FP16.

| 加速器 | 每 FLOP 成本 | 每字节内存访问成本 |
|:---|:---|:---|
| H800 | 2.80x10^-19 | 1.66x10^-16 |
| H20 | 7.51x10^-19 | 5.56x10^-17 |
| A800 | 6.68x10^-19 | 1.04x10^-16 |
| 910B | 6.65x10^-19 | 1.16x10^-16 |

Table 6: Theoretical decoding cost analysis for each model on each hardware, in USD. As a reminder, these models have different number of activated parameters: DSv3 37B, Qwen3 MoE 22B, Qwen3 32B, MM M1 46B, ERNIE 4.5 47B, Pangu Pro MoE 16.5B and Step-3 38B.

表 6: 各模型在各硬件上的理论解码成本分析 (USD). 提醒: 这些模型的激活参数量不同: DSv3 37B, Qwen3 MoE 22B, Qwen3 32B, MM M1 46B, ERNIE 4.5 47B, Pangu Pro MoE 16.5B, Step-3 38B.

| 模型 | 8k-Attn-H800 | 8k-Attn-H20 | 8k-Attn-A800 | 8k-Attn-910B | 32k-Attn-H800 | 32k-Attn-H20 | 32k-Attn-A800 | 32k-Attn-910B | FFN-H800 | FFN-H20 | FFN-A800 | FFN-910B |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| DSv3 | 0.054 | 0.128 | 0.114 | 0.113 | 0.197 | 0.460 | 0.409 | 0.407 | 0.014 | 0.036 | 0.032 | 0.032 |
| Kimi K2 | 0.051 | 0.065 | 0.057 | 0.057 | 0.194 | 0.231 | 0.205 | 0.204 | 0.014 | 0.036 | 0.032 | 0.032 |
| Qwen3 MoE | 0.135 | 0.054 | 0.091 | 0.101 | 0.527 | 0.185 | 0.338 | 0.376 | 0.008 | 0.021 | 0.019 | 0.019 |
| Qwen3 32B | 0.181 | 0.069 | 0.120 | 0.133 | 0.716 | 0.248 | 0.455 | 0.508 | 0.014 | 0.038 | 0.034 | 0.033 |
| Llama 4 M | 0.169 | 0.060 | 0.109 | 0.121 | 0.369 | 0.128 | 0.235 | 0.262 | 0.007 | 0.018 | 0.016 | 0.016 |
| MM M1 | 0.164 | 0.079 | 0.121 | 0.132 | 0.330 | 0.135 | 0.226 | 0.249 | 0.015 | 0.041 | 0.036 | 0.036 |
| ERNIE 4.5 | 0.155 | 0.063 | 0.105 | 0.116 | 0.606 | 0.214 | 0.388 | 0.432 | 0.021 | 0.057 | 0.051 | 0.051 |
| Pangu Pro MoE | 0.135 | 0.049 | 0.088 | 0.098 | 0.536 | 0.183 | 0.340 | 0.379 | 0.007 | 0.018 | 0.016 | 0.016 |
| Step-3 | 0.048 | 0.040 | 0.040 | 0.043 | 0.176 | 0.114 | 0.120 | 0.133 | 0.015 | 0.040 | 0.036 | 0.035 |

Figure 2: Decoding costs (per 1M tokens) of different models and inference configurations. For AFD, we combine the lowest costs on different hardware for attention and FFN, respectively. Reminder: Step-3 has the most activated parameters among them.

图 2: 不同模型和推理配置的解码成本 (每 1M tokens). 对于 AFD, 我们分别组合注意力与 FFN 在不同硬件上的最低成本. 提醒: Step-3 在其中拥有最多的激活参数.

### 4.3 揭示模型设计选择

In this section, we discuss some ongoing model design trends in the community. We especially focus on the decoding phase.

在本节中, 我们讨论社区中一些持续的模型设计趋势. 我们特别关注解码阶段.

Linear attention and hybrid models. Linear attention is a promising direction but still faces challenges in long context tasks. A practical workaround is "hybrid models", which consist of two types of attention layers; most are linear attention, while the rest are traditional full attention. For example, MM M1, using a hybrid architecture with 70 layers of linear attention and 10 layers of GQA full attention, exhibits significantly slower KV growth with context length compared to full-GQA models like Qwen3. The design of Llama 4 Maverick is similar except for the layer numbers.

线性注意力与混合模型. 线性注意力是一个有前景的方向, 但在长上下文任务中仍面临挑战. 一个实用的变通方案是 "混合模型", 由两种注意力层组成: 大多数是线性注意力, 其余是传统全注意力. 例如, MM M1 采用混合架构, 包含 70 层线性注意力和 10 层 GQA 全注意力, 与 Qwen3 等全 GQA 模型相比, 其 KV 随上下文长度的增长显著更慢. Llama 4 Maverick 的设计类似, 只是层数不同.

However, such hybrid models have two additional challenges for inference systems.

然而, 这类混合模型对推理系统有两个额外挑战.

First, while the number of full attention layers seems small, they may still ruin the point of using linear attention for saving KV cache. MM M1 and Llama 4 Maverick's full attention part alone (based on the official quantization scheme) has a larger KV cache volume than Step-3's entire model. No matter how much the rest of the linear attention layers save, no matter how long the context is, the total memory access will be larger than Step-3, as shown in Figure 3.

首先, 尽管全注意力层的数量看起来很少, 但它们仍可能破坏使用线性注意力节省 KV 缓存的意义. MM M1 和 Llama 4 Maverick 仅全注意力部分 (基于官方量化方案) 的 KV 缓存量就大于 Step-3 整个模型的 KV 缓存量. 无论其余线性注意力层节省了多少, 无论上下文多长, 总内存访问都将大于 Step-3, 如图 3 所示.

Second, the time spent on each layer will be largely unbalanced - when running with long context, the full GQA layers consume much more time than the linear attention layers. This may not be a problem for single-node inference deployment, but can be quite troublesome for distributed inference deployment (especially AFD) when one tries to build a pipeline to hide communication time. The imbalance of layer times can cause significant pipeline bubbles.

其次, 每层消耗的时间将严重不平衡 - 在长上下文运行时, 全 GQA 层消耗的时间远多于线性注意力层. 这对单节点推理部署可能不是问题, 但在尝试构建流水线以隐藏通信时间的分布式推理部署 (尤其是 AFD) 中可能相当麻烦. 层间时间不平衡会导致显著的流水线气泡 (pipeline bubbles).

In Figure 3, we compare MM M1 and Llama 4 Maverick with Step-3 using a single hardware (H800) setup. Due to the reason above, they always have higher decoding costs than Step-3 despite most of their layers being linear attention. Admittedly, using hardware with cheaper memory bandwidth (like H20) can largely narrow the gap. But fundamentally, they require more KV cache access than Step-3 in the end.

在图 3 中, 我们使用单一硬件 (H800) 配置比较 MM M1, Llama 4 Maverick 与 Step-3. 由于上述原因, 尽管它们的大部分层都是线性注意力, 其解码成本始终高于 Step-3. 诚然, 使用内存带宽更便宜的硬件 (如 H20) 可以在很大程度上缩小差距. 但从根本上说, 它们最终需要的 KV 缓存访问仍多于 Step-3.

We call for hybrid model designs that are more friendly to inference systems. One should design the full attention part carefully so that it does not ruin the cost saving from linear attention. Also, try to make every layer hybrid so that the time for each layer is balanced, instead of having a few slow layers that may limit the potentials of running in a distributed pipeline.

我们呼吁对推理系统更友好的混合模型设计. 应仔细设计全注意力部分, 使其不破坏线性注意力带来的成本节约. 此外, 尝试使每一层都是混合的, 从而使每层时间平衡, 而不是只有少数慢层限制了分布式流水线的潜力.

"Hardware-optimized design" - for training or decoding?

"硬件优化设计" - 针对训练还是解码?

Designing a model that is optimized for a given hardware is not a new concept. In this paper, we include Pangu Pro MoE, a model claimed to be specifically optimized for Huawei's own accelerator, 910B.

为给定硬件优化模型并非新概念. 在本文中, 我们纳入了 Pangu Pro MoE, 该模型声称专为华为自研加速器 910B 优化.

However, in our analysis, the decoding cost of Pangu Pro MoE on 910B is not low - it is theoretically much larger than Step-3 (Figure 4). Remember, Pangu Pro MoE has only 16.5B activated parameters, less than half of Step-3's! It is evident that Pangu Pro MoE's decoding on 910B is not cost-effective at all.

> **译者注**: 混合注意力模型(如 MM M1、Llama 4)的理论优势(线性 attention 节省 KV cache)在实际部署中可能被 "长尾效应" 抵消：少数几层全 attention 层的 KV cache 膨胀就足以主导整体内存占用。这提醒我们，架构设计的评估不能仅看 "平均 case"，而必须考虑 worst-case 的部署约束。

然而, 在我们的分析中, Pangu Pro MoE 在 910B 上的解码成本并不低 - 理论上远大于 Step-3 (图 4). 记住, Pangu Pro MoE 仅有 16.5B 激活参数, 不到 Step-3 的一半! 显然, Pangu Pro MoE 在 910B 上的解码完全不具备成本效益.

To be fair, the main focus of Pangu Pro MoE was not about decoding cost, it was about training. We also show a rough estimation of training cost per 1M token assuming 100% MFU, purely based on the theoretical FLOPs. We see that Pangu Pro MoE indeed is more than 50% cheaper than Step-3 to train, reflecting the difference in activated parameters.

公平地说, Pangu Pro MoE 的主要关注点不是解码成本, 而是训练. 我们还展示了假设 100% MFU 下每 1M token 训练成本的粗略估算, 纯粹基于理论 FLOPs. 我们看到 Pangu Pro MoE 的训练成本确实比 Step-3 便宜 50% 以上, 反映了激活参数量的差异.

The lesson is, be clear about the goal during model-system co-design. Training and inference can be vastly different. Training costs are largely tied to the number of activated parameters, while lowering decoding costs requires additional model-system co-design. We will discuss the co-design points immediately.

教训是, 在模型-系统协同设计期间必须明确目标. 训练和推理可能截然不同. 训练成本主要取决于激活参数量, 而降低解码成本需要额外的模型-系统协同设计. 我们将立即讨论协同设计要点.


Figure 4: Step-3 and Pangu Pro MoE have very different trends of decoding cost and training cost.

图 4: Step-3 与 Pangu Pro MoE 的解码成本与训练成本趋势截然不同.

## 5 模型-系统协同设计

### 5.1 匹配注意力算术强度与硬件

Readers paying attention (pun intended) may notice that in Tables 2 and 3, Step-3's MFA exhibits only a 10% reduction in KV memory access volume compared with DSv3's MLA. Yet in Table 6, Step-3's attention cost is reduced by half or more in many cases. Why? The result stems from the design of MFA.

细心的读者可能注意到, 在表 2 和表 3 中, 与 DSv3 的 MLA 相比, Step-3 的 MFA 在 KV 内存访问量上仅减少了 10%. 然而在表 6 中, Step-3 的注意力成本在许多情况下降低了一半甚至更多. 为什么? 结果源于 MFA 的设计.

As pointed out in prior work [26,27], each attention design has an inherent property called arithmetic intensity. It is the ratio of the arithmetic operations needed for each byte of KV accessed from memory. Different batch sizes or context lengths do not change the arithmetic intensity.

如先前工作 [26,27] 所指出的, 每种注意力设计都有一个称为算术强度 (arithmetic intensity) 的固有属性. 它是每从内存访问一字节 KV 所需算术运算量的比值. 不同的 batch size 或上下文长度不会改变算术强度.

The better the match between attention's arithmetic intensity and a hardware's "computation-bandwidth ratio" (or referred to as roofline) (see Table 4), the more likely it is to achieve good efficiency on that hardware. Otherwise, significant bottlenecks may occur, either compute-bound or memory-bound.

注意力算术强度与硬件 "计算-带宽比" (或称为 roofline) (见表 4) 匹配得越好, 在该硬件上实现良好效率的可能性就越大. 否则可能出现显著瓶颈, 要么是计算受限, 要么是内存受限.

With Step-3's MFA design, its arithmetic intensity is 128 (assuming 8-bit quantization of KV). It is much closer to A800 (roofline is 156) and 910B (roofline is 175) than DSv3's MLA (arithmetic intensity is 512). On H20 (roofline is 74), Step-3's gap is also not too large compared with Qwen3 MoE (arithmetic intensity is 32). To better illustrate, we show the above models and hardware in Figure 5. We show how compute and memory access grows with context length, from 8K to 32K, for each model. Correspondingly, we also plot a line for each hardware with the slope based on their computation-bandwidth ratio.

在 Step-3 的 MFA 设计中, 其算术强度为 128 (假设 KV 为 8-bit 量化). 这比 DSv3 的 MLA (算术强度为 512) 更接近 A800 (roofline 为 156) 和 910B (roofline 为 175). 在 H20 (roofline 为 74) 上, 与 Qwen3 MoE (算术强度为 32) 相比, Step-3 的差距也不算太大. 为更好地说明, 我们在图 5 中展示了上述模型和硬件. 我们展示了每种模型的计算量和内存访问量如何随上下文长度从 8K 增长到 32K. 相应地, 我们还为每种硬件绘制了一条斜线, 斜率基于其计算-带宽比.

In Figure 5, it is also clear that Step-3's MFA achieves low computation and memory access simultaneously. Namely, its required computation is one-fourth of DSv3's, and its required memory access is one-third of Qwen3's. This enables Step-3 to maintain low costs even on accelerators whose roofline does not match Step-3 well.

在图 5 中同样清晰可见, Step-3 的 MFA 同时实现了低计算量和低内存访问量. 也就是说, 其所需计算量为 DSv3 的四分之一, 所需内存访问量为 Qwen3 的三分之一. 这使得 Step-3 即使在 roofline 与 Step-3 不太匹配的加速器上也能保持低成本.

Step-3's MFA achieves the more balanced arithmetic intensity and low overhead without cutting corners. In fact, its attention effective rank [7] is 16,384, the same as DSv3's MLA and larger than Qwen3 MoE's 8,192.

Step-3 的 MFA 在不偷工减料的情况下实现了更均衡的算术强度和低开销. 事实上, 其注意力有效秩 (attention effective rank) [7] 为 16,384, 与 DSv3 的 MLA 相同, 大于 Qwen3 MoE 的 8,192.

Step-3 chooses slightly lower arithmetic intensity than most of the hardware's roofline, to leave room for future optimizations like quantization and MTP, as discussed next.

Step-3 选择的算术强度略低于大多数硬件的 roofline, 为未来的量化 (quantization) 和 MTP 等优化留出空间, 如下文所述.

> 译者注: 算术强度 (arithmetic intensity) 是连接模型架构与硬件特性的关键桥梁. 本文首次系统论证了注意力设计的算术强度如何直接影响端到端解码成本, 而非仅看 KV 缓存大小. Step-3 的 MFA 将算术强度精确控制在 128, 恰好落在 H20 (74), A800 (156), 910B (175) 等主流硬件的 "甜点区" 附近, 而 DSv3 的 MLA (512) 仅在 H800 (591) 上效率最高, 在其他硬件上则严重计算受限. 这种 "硬件对齐" 思维是模型-系统协同设计的核心.

### 5.2 讨论: 量化与多 Token 预测 (MTP)

Quantization: All models can adopt more aggressive quantization strategies than those we have assumed. A particularly noteworthy quantization approach is low-bit storage with high-bit computation, e.g., storing KV in 4-bit but performing attention calculation in 8-bit. This effectively doubles the arithmetic intensity of each attention design. Such a change has different meanings for different attention designs. We still use DSv3, Qwen3, and Step-3 as examples:

量化: 所有模型都可以采用比我们假设的更激进的量化策略. 一种特别值得注意的量化方法是低比特存储配合高比特计算, 例如以 4-bit 存储 KV 但以 8-bit 执行注意力计算. 这实际上将每种注意力设计的算术强度翻倍. 这种变化对不同注意力设计具有不同意义. 我们仍以 DSv3, Qwen3 和 Step-3 为例:

Implications for DSv3: Because DSv3's arithmetic intensity is already close to H800's roofline and much higher than other hardware, such quantization scheme will not improve efficiency.

对 DSv3 的影响: 由于 DSv3 的算术强度已接近 H800 的 roofline 且远高于其他硬件, 这种量化方案不会提升效率.

Implications for Qwen3: It might enable GQA-family models to get closer to or surpass H20's roofline. It can benefit on all hardware listed.

对 Qwen3 的影响: 这可能使 GQA 家族模型更接近或超过 H20 的 roofline. 它在所列所有硬件上都能受益.

Implications for Step-3: This could potentially turn arithmetic intensity to exceed the roofline of A800 and 910B, but still not far off. There should be moderate performance gain. It may benefit a lot on H800 with higher roofline.

对 Step-3 的影响: 这可能使算术强度超过 A800 和 910B 的 roofline, 但差距不会太大. 应有适度的性能提升. 在 roofline 更高的 H800 上可能获益良多.

For quantization schemes that use the same format for KV storage and attention computation (assuming the hardware has native support), we anticipate that those will not significantly alter the overall trends of different models.

对于 KV 存储和注意力计算使用相同格式的量化方案 (假设硬件有原生支持), 我们预计这些方案不会显著改变不同模型的整体趋势.

Regarding hybrid models like MM M1, many (including ourselves) may wonder if aggressive KV quantization is feasible. However, given that there are only 8 layers of full attention and they might be more sensitive to quantized KV, we adopt a more conservative approach - using the official setup - in this paper. We look forward to more in-depth research on this topic.

关于像 MM M1 这样的混合模型, 许多人 (包括我们自己) 可能想知道激进的 KV 量化是否可行. 然而, 鉴于仅有 8 层全注意力且它们可能对量化 KV 更敏感, 我们在本文中采用更保守的方法 - 使用官方设置. 我们期待对此话题进行更深入的研究.

Multi-Token Prediction (MTP): MTP and the "low-bit storage, high-bit computation" quantization scheme have similar effects on arithmetic intensity - doubling (or even multiplying) it. Therefore, similar to the previous discussion, DSv3 is the least MTP-friendly model. GQA and MFA (Step-3) models can leverage MTP to enhance throughput on various hardware.

多 Token 预测 (Multi-Token Prediction, MTP): MTP 与 "低比特存储, 高比特计算" 量化方案对算术强度有类似影响 - 将其翻倍 (甚至乘以更高倍数). 因此, 与前面的讨论类似, DSv3 是最不适合 MTP 的模型. GQA 和 MFA (Step-3) 模型可以利用 MTP 在各种硬件上提升吞吐.

However, MTP's impact is global - enabling MTP also alters the computation load of FFN. Under the assumption of AFD, where FFN can always get enough batch to run with high MFU (see the next section), MTP could actually incur additional costs. MTP is not 100% accurate in predicting additional tokens, yet FFN's cost is always increased regardless of prediction accuracy. One must be very careful in deciding whether to enable MTP.

然而, MTP 的影响是全局性的 - 启用 MTP 也会改变 FFN 的计算负载. 在 AFD 假设下, FFN 总能获得足够的 batch 以高 MFU 运行 (见下一节), MTP 实际上可能带来额外成本. MTP 在预测额外 token 时并非 100% 准确, 但无论预测精度如何, FFN 的成本总会增加. 在决定是否启用 MTP 时必须非常谨慎.

Summary: Step-3's MFA design and its arithmetic intensity allows applying further KV quantization or enabling MTP to gain further cost savings than the results in Table 6. In principle, Qwen3 and other GQA-based models could benefit from similar mechanisms. However, due to the high arithmetic intensity of its MLA, DSv3 may not see substantial benefits from further KV storage quantization or enabling MTP in large-batch, high-throughput scenarios.

总结: Step-3 的 MFA 设计及其算术强度允许进一步应用 KV 量化或启用 MTP, 从而获得比表 6 中结果更大的成本节约. 原则上, Qwen3 和其他基于 GQA 的模型也能从类似机制中受益. 然而, 由于其 MLA 的高算术强度, DSv3 在大 batch, 高吞吐场景中可能无法从进一步的 KV 存储量化或启用 MTP 中获得实质性收益.

### 5.3 FFN 实现高 MFU 的 batch 需求

Next, we discuss the costs of the Feed-Forward Network (FFN). The majority of FFN computation involves matrix multiplications, with a very small portion for activation functions. Most memory accesses are for model weights, with a very smaller portion for input and output hidden features. For simplicity, we will focus on matrix multiplications and model weight accesses.

接下来, 我们讨论前馈网络 (FFN) 的成本. FFN 的大部分计算涉及矩阵乘法, 激活函数只占很小一部分. 大部分内存访问针对模型权重, 输入和输出隐藏特征只占很小一部分. 为简洁起见, 我们将专注于矩阵乘法和模型权重访问.

For the matrix multiplication in FFN computation, the number of floating-point operations (FLOPs) is given by:

对于 FFN 计算中的矩阵乘法, 浮点运算数 (FLOPs) 由下式给出:

2 * N_token * W_FFN

where N_token represents the number of tokens processed in a batched FFN computation. In decoding, it is equivalent to the batch size B entering the FFN (without MTP). W_FFN denotes the number of model weights in the FFN. Clearly, the computation-to-memory access ratio (assuming 8-bit weight storage) is 2 * N_token, or 2 * B.

其中 N_token 表示批处理 FFN 计算中处理的 token 数量. 在解码中, 它等价于进入 FFN 的 batch size B (不含 MTP). W_FFN 表示 FFN 中的模型权重数量. 显然, 计算与内存访问之比 (假设 8-bit 权重存储) 为 2 * N_token, 即 2 * B.

In the roofline model, to achieve good MFU, the computation-to-memory access ratio should at least match the hardware's roofline, as shown in Table 4. The corresponding ideal batch size, denoted as B_dense, should at least be:

在 roofline 模型中, 为实现良好 MFU, 计算与内存访问之比至少应匹配硬件的 roofline, 如表 4 所示. 相应的理想 batch size, 记为 B_dense, 至少应为:

2 * B_dense >= FLOPs / Bandwidth

With a batch size that activates all experts, MoE increases the proportion between memory accesses and computation. We define the sparsity of MoE as S. For example: - If 2 experts are chosen from 8, then S = 1/4. - If 8 experts are chosen from 256 plus one shared expert, then S = 9/256.

在激活所有专家的 batch size 下, MoE 增加了内存访问与计算之间的比例. 我们将 MoE 的稀疏度定义为 S. 例如: - 如果从 8 个专家中选择 2 个, 则 S = 1/4. - 如果从 256 个专家中选择 8 个加上 1 个共享专家, 则 S = 9/256.

For MoE models, the ideal batch size for high MFU is:

对于 MoE 模型, 实现高 MFU 的理想 batch size 为:

B_MoE = B_dense / S

which can be several to tens of times larger than in dense models. Combined with the above equations, we get:

这比稠密模型大几倍到几十倍. 结合上述公式, 我们得到:

B_MoE >= FLOPs / (2 * S * Bandwidth)

### 5.4 最优 MoE 稀疏度与硬件

For contemporary models with hundreds of billions of parameters and long sequence inference, the memory capacity of a single machine often cannot support the appropriate batch size, necessitating distributed deployment. Whether using EP deployment [30] or AFD in this paper, the hardware running FFN computations needs to receive input hidden features (with dimension H) via the network and transmit the FFN computation results back via the network. Assuming 8-bit precision dispatch and 16-bit precision combine, and a batch size that meets high MFU requirements, the total transmission volume is:

对于拥有数千亿参数和长序列推理的当代模型, 单机的内存容量通常无法支持合适的 batch size, 需要分布式部署. 无论使用 EP 部署 [30] 还是本文的 AFD, 运行 FFN 计算的硬件需要通过网络接收输入隐藏特征 (维度为 H) 并通过网络传回 FFN 计算结果. 假设 8-bit 精度分发 (dispatch) 和 16-bit 精度合并 (combine), 且 batch size 满足高 MFU 需求, 总传输量为:

3 * H * B_MoE

With AFD and an ideal three-stage pipeline and the TPOT target of 50ms, we need to keep the network communication time below 50ms/3 = 16.6ms. We denote network bandwidth as Net, distinguished from memory bandwidth Bandwidth, we get:

在 AFD 和理想的三级流水线以及 50ms TPOT 目标下, 我们需要将网络通信时间保持在 50ms/3 = 16.6ms 以下. 我们将网络带宽记为 Net, 以区别于内存带宽 Bandwidth, 得到:

(3 * H * B_MoE) / Net <= 16.6ms / L

where L is the number of model layers. Substituting the expression for B_MoE, we obtain:

其中 L 为模型层数. 代入 B_MoE 的表达式, 得到:

(H * FLOPs * L) / (Net * S * Bandwidth) <= 16.6ms * 2/3 = 11.1ms

We can derive the "optimal MoE sparsity" acceptable by the hardware, referring to the sparsest MoE configuration that the hardware can support to achieve ideal MFU while perfectly hiding network communication:

我们可以推导出硬件可接受的 "最优 MoE 稀疏度", 指硬件在实现理想 MFU 同时完美隐藏网络通信的情况下所能支持的最稀疏 MoE 配置:

S >= (H * FLOPs * L) / (Net * Bandwidth * 11.1ms)

Next, we use Step-3's MoE architecture as an example. Its hidden feature size is 7168 and the number of layers L is 61. Those numbers are identical to DSv3. We substitute the hardware parameters for each accelerator. We assume H800 and H20 use 400Gbps x 8 NICs, while A800 and 910B use 200Gbps x 8 NICs. Table 7 shows the results.

接下来, 我们以 Step-3 的 MoE 架构为例. 其隐藏特征大小为 7168, 层数 L 为 61. 这些数字与 DSv3 相同. 我们代入每种加速器的硬件参数. 假设 H800 和 H20 使用 400Gbps x 8 网卡, A800 和 910B 使用 200Gbps x 8 网卡. 表 7 展示了结果.

Table 7: Minimum MoE sparsity for different hardware platforms to achieve good MFU, where H = 7168, L = 61.

表 7: 不同硬件平台实现良好 MFU 的最小 MoE 稀疏度, 其中 H = 7168, L = 61.

| 加速器 | 最小 S |
|:---|:---:|
| H800 | 0.058 |
| H20 | 0.007 |
| A800 | 0.031 |
| 910B | 0.034 |

It is clear that the optimal MoE sparsity varies significantly across hardware platforms. H20 can accommodate the sparsest MoE configuration due to its lower computational power and higher memory bandwidth, allowing it to achieve high MFU with a smaller batch size and better tolerate MoE sparsity. H800 is the least friendly to very sparse MoE. However, H800 has the most affordable unit cost per FLOP (Table 5).

显然, 最优 MoE 稀疏度在不同硬件平台之间差异显著. H20 由于其较低计算能力和较高内存带宽, 可以容纳最稀疏的 MoE 配置, 允许它以更小的 batch size 实现高 MFU 并更好地容忍 MoE 稀疏性. H800 对极稀疏 MoE 最不友好. 然而, H800 拥有最便宜的每 FLOP 单位成本 (表 5).

To ensure that Step-3 can leverage high-roofline hardware like H800, we make sure Step-3 is not sparser than 0.058.

为确保 Step-3 能够利用 H800 这类高 roofline 硬件, 我们确保 Step-3 的稀疏度不低于 0.058.

In contrast, DSv3, for example, would require (256 + 1) x 0.058^-1 = 14 MoE experts to be activated to achieve good MFU on H800, which is much larger than the official 8 activated experts. In other words, if DSv3 activates more experts, the decoding costs may not rise much. It means it may be leaving extra model performance on the table.

相比之下, 例如 DSv3 需要在 H800 上激活 (256 + 1) x 0.058^-1 = 14 个 MoE 专家才能实现良好 MFU, 这远大于官方公布的 8 个激活专家. 换句话说, 如果 DSv3 激活更多专家, 解码成本可能不会上升太多. 这意味着它可能放弃了额外的模型性能.

Even worse, unideal hardware efficiency may exaggerate the problem. For example, on the H800 platform with DeepEP [30], the measured average throughput per network card is 40GB/s instead of 50GB/s, which can lead to a 25% increase in the optimal sparsity, e.g., 0.073 for H800. Considering all these, Step-3 chooses a sparsity of around 0.08 (including shared expert).

更糟的是, 不理想的硬件效率可能加剧问题. 例如, 在 H800 平台上使用 DeepEP [30] 时, 实测每网卡平均吞吐为 40GB/s 而非 50GB/s, 这可能导致最优稀疏度增加 25%, 例如 H800 上为 0.073. 综合考虑这些因素, Step-3 选择了约 0.08 的稀疏度 (包含共享专家).

Being even sparser, Llama 4 Maverick and Kimi K2 will be even further from the high MFU region when running on H800.

Llama 4 Maverick 和 Kimi K2 更加稀疏, 在 H800 上运行时离高 MFU 区域更远.

To clarify, all the theoretical cost analysis in §4 ignores the network bottleneck by assuming all network communication can be overlapped and all FFNs can run in high MFU states. The network bottleneck and MoE sparsity problems discussed in this section will further increase the actual costs of over-sparse models like DSv3, Kimi K2, and Llama 4 Maverick.

需要澄清, §4 中的所有理论成本分析都通过假设所有网络通信可被重叠且所有 FFN 可在高 MFU 状态下运行来忽略网络瓶颈. 本节讨论的网络瓶颈和 MoE 稀疏性问题将进一步增加 DSv3, Kimi K2 和 Llama 4 Maverick 等过度稀疏模型的实际成本.

> 译者注: 本节的核心洞见是 "训练优化不等于推理优化". Pangu Pro MoE 为 910B 训练优化, 但其解码成本反而高于 Step-3; DSv3 和 Kimi K2 为追求纸面激活参数量最小化而过度稀疏, 导致在实际 H800 部署中因 batch size 不足和网络瓶颈而无法达到高 MFU. Step-3 将稀疏度刻意控制在 0.08 (含共享专家), 恰好满足 H800 的最小稀疏度要求 (0.058), 这种 "留有余地" 的设计哲学值得深思: 模型稀疏度不应由参数量最小化驱动, 而应由目标硬件的 roofline 和网络拓扑共同决定.

### 5.5 讨论: 过度稀疏性的变通方案

The above analysis regarding sparsity S is based on AFD's deployment philosophy - using just enough FFN instances and accumulating a large batch size for high MFU. In a relatively small TP or EP deployment, the MoE sparsity S on each FFN instance is the same as the whole model. For example, two FFN instances running DSv3's 8-in-256 with EP = 2 (in terms of servers) mean each instance runs 4-in-128. S remains the same for each server.

上述关于稀疏度 S 的分析基于 AFD 的部署理念 - 使用恰好足够的 FFN 实例并积累大 batch size 以实现高 MFU. 在相对较小的 TP 或 EP 部署中, 每个 FFN 实例上的 MoE 稀疏度 S 与整个模型相同. 例如, 两个 FFN 实例以 EP = 2 (以服务器计) 运行 DSv3 的 8-in-256, 意味着每个实例运行 4-in-128. 每个服务器的 S 保持不变.

However, there are workarounds that may increase S, to alleviate the network bottleneck, but at the cost of other aspects.

然而, 存在一些变通方案可以提高 S 以缓解网络瓶颈, 但会以其他方面为代价.

Workaround 1: Large EP. When EP (in terms of servers) is sufficiently large, especially exceeding K (the number of activated experts), the network traffic volume required by each FFN (or EP) server is reduced. This is the case for DSv3's official deployment that uses more than 10 servers as a giant EP deployment.

变通方案 1: 大型 EP. 当 EP (以服务器计) 足够大, 尤其超过 K (激活专家数量) 时, 每个 FFN (或 EP) 服务器所需的网络流量减少. DSv3 的官方部署就是这种情况, 使用超过 10 台服务器作为巨型 EP 部署.

Workaround 2: MoE Routing Restrictions. Limiting token routing to adjacent experts can also make each local portion of the model not as sparse as the entire model.

变通方案 2: MoE 路由限制. 将 token 路由限制到相邻专家也可以使模型的每个本地部分不如整个模型稀疏.

DSv3 employs both methods to mitigate the issue of its over-sparsity for the H800 platform. Kimi K2 follows DSv3 on Workaround 1, but removes Workaround 2. This may make the network bottleneck even worse than DSv3.

DSv3 采用两种方法来缓解其在 H800 平台上过度稀疏的问题. Kimi K2 在变通方案 1 上遵循 DSv3, 但去除了变通方案 2. 这可能使其网络瓶颈比 DSv3 更严重.

We must note that both approaches come with costs: 1) Workaround 1 is more susceptible to expert imbalance issues, reducing actual efficiency. 2) Workaround 2 adversely affects the model's expressiveness. The impact on model performance has not been well studied yet.

我们必须注意两种方法都有代价: 1) 变通方案 1 更容易受到专家不均衡问题的影响, 降低实际效率. 2) 变通方案 2 对模型表达能力产生不利影响. 对模型性能的影响尚未得到充分研究.

Step-3's design avoids this sparsity issue, allowing it to use small TP, EP or TP + EP hybrid approaches during AFD. This minimizes the performance impact of expert imbalance and eliminates the need for any routing restrictions.

Step-3 的设计避免了这种稀疏性问题, 允许其在 AFD 期间使用小型 TP, EP 或 TP + EP 混合方法. 这最小化了专家不均衡对性能的影响, 并消除了对任何路由限制的需求.


## 6 非旗舰硬件支持

With AFD, both the attention and FFN components can be easily scaled, respectively. This creates more opportunities to leverage non-flagship hardware for the attention part, or FFN part, or both.

通过 AFD, 注意力组件和 FFN 组件都可以分别轻松扩展. 这为利用非旗舰硬件运行注意力部分, FFN 部分, 或两者创造了更多机会.

For example, Step-3's MFA workload running on H800 is memory bandwidth bound. It can be replaced by four L20s, on which MFA is still memory bandwidth bound. L20's memory bandwidth is more than 25% of H800's, so in theory, with a 25% batch size on each L20, four L20s can run as fast as an H800 in a DP manner. Thanks to AFD, we do not need to worry about the FFN part - it can remain unchanged when we discuss the attention part. For network communication, an L20 server needs 25% of bandwidth compared with an H800 server, i.e., 4x200Gbps vs. 8x400Gbps. It is also easy to satisfy.

例如, Step-3 在 H800 上运行的 MFA 工作负载受内存带宽限制. 它可以被四张 L20 替代, 在 L20 上 MFA 仍然受内存带宽限制. L20 的内存带宽超过 H800 的 25%, 因此理论上, 每张 L20 上 25% 的 batch size, 四张 L20 以 DP 方式可以跑得和一张 H800 一样快. 得益于 AFD, 我们无需担心 FFN 部分 - 在讨论注意力部分时它可以保持不变. 对于网络通信, L20 服务器相比 H800 服务器只需要 25% 的带宽, 即 4x200Gbps 对比 8x400Gbps. 这也容易满足.

The main limitation is that, for both attention and FFN servers, weaker hardware must still meet the latency requirements for AFD's three or four-stage pipeline to meet SLA. For instance, a three-stage pipeline requires both attention and FFN computations to be kept within 16.6ms / 61 layers ≈ 272µs for Step-3. We illustrate this with L20.

主要限制在于, 对于注意力服务器和 FFN 服务器, 较弱硬件仍必须满足 AFD 三级或四级流水线的延迟要求以达成 SLA. 例如, 三级流水线要求 Step-3 的注意力和 FFN 计算都保持在 16.6ms / 61 层 ≈ 272µs 以内. 我们以 L20 为例说明.

Attention: We consider the memory access requirement as a necessary condition for satisfying the latency requirement. One L20 can access 864 GB/s x 272µs = 235 MB within 272µs. The linear parts require memory access of 67 MB in total. Thus, KV cache cannot exceed 235 - 67 = 168 MB. With each token's KV being 512 bytes, the total inference context length cannot exceed approximately 328K tokens. This means that if the average context length is 8K tokens, keeping the batch size below 41 is sufficient. The maximum context length for a single request is up to 328K, which is still reasonable. Of course, the hardware cannot always run at its peak memory bandwidth, and there is inter-GPU communication overhead we omit. But we think L20 in general is capable of running Step-3's attention part.

注意力: 我们将内存访问需求视为满足延迟要求的必要条件. 一张 L20 在 272µs 内可以访问 864 GB/s x 272µs = 235 MB. 线性部分总共需要 67 MB 内存访问. 因此, KV 缓存不能超过 235 - 67 = 168 MB. 每个 token 的 KV 为 512 字节, 总推理上下文长度不能超过约 328K tokens. 这意味着如果平均上下文长度为 8K tokens, 将 batch size 保持在 41 以下即可. 单个请求的最大上下文长度可达 328K, 这仍然合理. 当然, 硬件无法始终以峰值内存带宽运行, 且存在我们省略的 GPU 间通信开销. 但我们认为 L20 总体上能够运行 Step-3 的注意力部分.

> **译者注**: 这是 AFD 在硬件经济学上的关键洞察：通过解耦 attention 和 FFN，可以分别为它们选择 "性价比最优" 的硬件配置。例如，attention 侧需要高内存带宽(H20、L20)，而 FFN 侧需要高算力(H800)。传统同构部署被迫在所有层使用同一型号 GPU，导致某些层 "算力过剩"、另一些层 "带宽不足"。AFD 本质上实现了推理 serving 的 "专机专运"。

However, using even weaker accelerators like L4 with a memory bandwidth of 300 GB/s would spend most of the 272µs timeframe just to access the linear part's 67 MB. Consequently, L4 is unlikely usable for Step-3's attention. We recommend accelerators that are at least as powerful as L20.

然而, 使用像 L4 这样内存带宽仅 300 GB/s 的更弱加速器, 大部分 272µs 时间窗口将只够访问线性部分的 67 MB. 因此, L4 不太可能用于 Step-3 的注意力. 我们推荐至少与 L20 同等性能的加速器.

Given that Step-3's MFA has the smallest KV volume and moderate arithmetic intensity, it is relatively hardware-friendly for weaker hardware than other recent models with similar sizes.

鉴于 Step-3 的 MFA 具有最小的 KV 量和适中的算术强度, 相比其他类似规模的近期模型, 它对较弱硬件相对更友好.

FFN: Similarly to attention, each FFN layer must complete within 272µs. Both computation and memory access must finish within this timeframe. Computation scales with batch size, and we aim to maximize batch size to push FFN into the compute-bound (high MFU) region. For convenience, we assume an appropriate batch size pushes FFN into the compute-bound region, utilizing only 50% of the memory bandwidth. Real-world scenarios might vary, but we use this for illustration.

FFN: 与注意力类似, 每个 FFN 层必须在 272µs 内完成. 计算和内存访问都必须在此时间范围内完成. 计算随 batch size 扩展, 我们的目标是最大化 batch size 以将 FFN 推入计算受限 (高 MFU) 区域. 为方便起见, 我们假设适当的 batch size 将 FFN 推入计算受限区域, 仅利用 50% 的内存带宽. 实际场景可能有所不同, 但我们以此为例说明.

For an L20, this means it can support FFN up to 864 GB/s x 50% x 272µs = 117 MB. For 61 layers in Step-3, this totals 7.1 GB. There are eight L20s per server, which can accommodate 56.8 GB of FFN weights. For the size of Step-3 (around 300 GB FFN weights), we need six L20 servers, or 48 cards, to run in EP to meet the performance requirements. We consider this number reasonable, especially as it is still much smaller than DSv3's deployment.

对于 L20, 这意味着它可以支持最高 864 GB/s x 50% x 272µs = 117 MB 的 FFN. 对于 Step-3 的 61 层, 总计 7.1 GB. 每台服务器有八张 L20, 可容纳 56.8 GB 的 FFN 权重. 对于 Step-3 的规模 (约 300 GB FFN 权重), 我们需要六台 L20 服务器 (即 48 张卡) 以 EP 方式运行来满足性能要求. 我们认为这个数字合理, 尤其是因为它仍远小于 DSv3 的部署规模.

Again, we consider a weaker card L4, whose memory bandwidth is only one third of L20. It means we need 144 cards to meet the FFN latency requirement for Step-3. At this scale, we start to be concerned about other issues like expert imbalance, stability, etc.

再次, 我们考虑更弱的 L4 卡, 其内存带宽仅为 L20 的三分之一. 这意味着我们需要 144 张卡才能满足 Step-3 的 FFN 延迟要求. 在这个规模上, 我们开始担心专家不均衡, 稳定性等其他问题.

The primary influencing factor here is the total number of FFN parameters. The larger the total parameters, the less friendly it is to weaker hardware. Step-3 strikes a good balance at the level of L20 cards.

这里的主要影响因素是 FFN 参数总量. 总参数量越大, 对较弱硬件越不友好. Step-3 在 L20 卡级别上取得了良好平衡.

Summary: For models with hundreds of billions of parameters, using at least L20 or stronger cards is recommended. Stronger cards reduce the number of required FFN servers, benefiting system reliability and MoE load balancing.

总结: 对于数千亿参数规模的模型, 建议至少使用 L20 或更强的卡. 更强的卡减少了所需的 FFN 服务器数量, 有利于系统可靠性和 MoE 负载均衡.

Figure 6: Module disaggregation in AFD architecture. FFN can be deployed in TP-only, EP-only, or a hybrid TP+EP way, depending on hardware and model architecture.

图 6: AFD 架构中的模块解耦. FFN 可以根据硬件和模型架构以纯 TP, 纯 EP 或混合 TP+EP 方式部署.

## 7 实现与结果

### 7.1 系统工作流与优化

We describe our AFD system implementation details in this section. As shown in Figure 6, the AFD architecture is composed of two main components: (1) Attention instances: responsible for computing the attention modules, managing the KV cache, and performing the non-expert computation operations in MoE modules (e.g., routers). For Step-3, we employ a local DP attention mechanism in which each GPU handles a batch of independent data. (2) FFN instances: directly handle the pure MoE computation and multi-GPU communication necessary for TP or EP. Since FFN can be deployed in TP-only, or EP-only, or a hybrid TP+EP manner, the FFN instance is designed and implemented to be flexible and can be configured accordingly. We use TP-only FFN as an example, where the weights of all MoE experts are sharded in a tensor parallelism manner. As an FFN instance receives data from attention instances, it first performs an all-gather operation to collect the data from the TP region. After computation, it performs a reduce-scatter operation to aggregate and scatter the results back to the original GPUs, followed by the token transmission back to the attention instances.

我们在本节描述 AFD 系统的实现细节. 如图 6 所示, AFD 架构由两个主要组件组成: (1) 注意力实例: 负责计算注意力模块, 管理 KV 缓存, 并执行 MoE 模块中的非专家计算操作 (例如路由器). 对于 Step-3, 我们采用本地 DP 注意力机制, 每张 GPU 处理一批独立数据. (2) FFN 实例: 直接处理纯 MoE 计算以及 TP 或 EP 所需的多 GPU 通信. 由于 FFN 可以以纯 TP, 纯 EP 或混合 TP+EP 方式部署, FFN 实例被设计为实现灵活并可相应配置. 我们以纯 TP 的 FFN 为例, 其中所有 MoE 专家的权重以张量并行 (tensor parallelism) 方式分片. 当 FFN 实例从注意力实例接收数据时, 它首先执行 all-gather 操作以从 TP 区域收集数据. 计算完成后, 它执行 reduce-scatter 操作以聚合并将结果散射回原始 GPU, 然后将 token 传回注意力实例.

The system can be configured to support multiple attention and FFN instances simultaneously. During communication, the attention instances broadcast the FP8 tokens (quantized from the BF16 activation after the upstream normalization) to the FFN instances; conversely, the FFN instances return BF16 output to the attention instances to preserve high residual precision. For Step-3, since the FFN instances spans multiple machines in a hybrid EP+TP way, the attention instances introduce a reduction module to combine all partial EP results from multiple FFN nodes. In addition, the attention instances also need to transfer some small metadata, such as the expert distribution and FP8 tensor scale factors, to the FFN. The expert distribution is then used to dispatch the tokens and form an organized input for efficient expert computation. The metadata is typically small compared to the hidden state, and hence can be transferred with negligible overhead.

系统可配置为同时支持多个注意力实例和 FFN 实例. 在通信过程中, 注意力实例将 FP8 token (由上游归一化后的 BF16 激活量化而来) 广播到 FFN 实例; 反之, FFN 实例向注意力实例返回 BF16 输出以保持高残差精度. 对于 Step-3, 由于 FFN 实例以混合 EP+TP 方式跨多台机器, 注意力实例引入了一个归约模块来合并来自多个 FFN 节点的部分 EP 结果. 此外, 注意力实例还需要向 FFN 传输一些小型元数据, 例如专家分布和 FP8 张量缩放因子. 专家分布随后用于分发 token 并形成有序输入以进行高效的专家计算. 与隐藏状态相比, 元数据通常很小, 因此可以以可忽略的开销传输.

The design of our AFD system is simple, allowing for easy integration of different models and serving frameworks. For example, our attention instances are developed based on vLLM [12] with minimal changes, while FFN instances are implemented merely on top of a lightweight C++ communication library (will be introduced in §7.2) and simple PyTorch interfaces with no special dependencies.

我们的 AFD 系统设计简单, 便于集成不同模型和服务框架. 例如, 我们的注意力实例基于 vLLM [12] 开发, 改动极小, 而 FFN 实例仅在一个轻量级 C++ 通信库 (将在 §7.2 介绍) 和简单 PyTorch 接口之上实现, 无特殊依赖.

Multi-stages Pipeline. Step-3 adopts a multi-stages pipeline to hide communication overhead and thus maximize overall throughput. Figure 7 illustrates the data flow in the multi-stages pipeline. Starting from the attention instance, the system receives three input samples (D1, D2, D3). These samples are processed sequentially and then transmitted over the network to the FFN instance for computation. With careful workload orchestration, the computation time for each computation stage is made nearly identical, enabling efficient pipelining and minimizing idle periods. The communication topology enables direct RDMA between GPUs, allowing data to be streamed in parallel with minimal latency, which can be easily hidden by the computation. Note that the figure distinguishes A->F and F->A communication paths for simplicity. However, they represent two independent communication and do not compete for network bandwidth, allowing them to execute concurrently in practice. As (D1, D2, D3) returns to the attention instance sequentially, the system can start processing the next layer in a streaming way, noted as (D1', D2', D3') in Figure 7. This design allows the system to achieve high throughput while maintaining low latency, as the critical path does not delay the processing of each sample.

多级流水线. Step-3 采用多级流水线来隐藏通信开销, 从而最大化整体吞吐. 图 7 展示了多级流水线中的数据流. 从注意力实例开始, 系统接收三个输入样本 (D1, D2, D3). 这些样本被顺序处理, 然后通过网络传输到 FFN 实例进行计算. 通过精心编排工作负载, 每个计算阶段的计算时间被调整得几乎相同, 从而实现高效流水线并最小化空闲周期. 通信拓扑支持 GPU 之间的直接 RDMA, 允许数据以最小延迟并行传输, 这可以轻松被计算隐藏. 注意, 图中为简洁起见区分了 A->F 和 F->A 通信路径. 然而, 它们代表两个独立的通信且不竞争网络带宽, 允许它们在实践中并发执行. 当 (D1, D2, D3) 顺序返回到注意力实例时, 系统可以以流式方式开始处理下一层, 在图 7 中记为 (D1', D2', D3'). 这种设计使系统能够在保持低延迟的同时实现高吞吐, 因为关键路径不会延迟每个样本的处理.

Other Implementation Details. We place the embedding and the LM head layers together with the attention instances since they incur small computation overhead. We develop tailored kernel optimizations for most kernels in the critical path, such as the FP8 GEMM and Flash Attention. For efficient NVLink communication for TP or EP within a single node, we leverage the NVLS APIs to implement the all-gather and reduce-scatter operations that not only can saturate NVLink bandwidth, but also can significantly reduce the GPU SM usage (particularly, our all-gather op is SM-free). The low SM usage is crucial for efficient communication-computation overlap, as revealed in previous work [2,28].

其他实现细节. 我们将嵌入层 (embedding) 和 LM head 层与注意力实例放在一起, 因为它们带来的计算开销很小. 我们对关键路径中的大多数 kernel 开发了定制优化, 例如 FP8 GEMM 和 Flash Attention. 对于单节点内 TP 或 EP 的高效 NVLink 通信, 我们利用 NVLS API 实现 all-gather 和 reduce-scatter 操作, 这些操作不仅能饱和 NVLink 带宽, 还能显著降低 GPU SM 占用 (特别是我们的 all-gather 操作是无 SM 的). 低 SM 占用对高效的通信-计算重叠至关重要, 如先前工作 [2,28] 所揭示.

### 7.2 StepMesh: AFD 通信库

AFD presents stringent performance challenges for communication libraries. For a 3-stage pipeline, AFD demands to complete transmission of FP8 tokens, scales, expert distribution, and BF16 activation between all attention and FFN instances within 272 µs (§6). Existing communication libraries struggle to consistently meet the requirement. Moreover, current libraries like NCCL and DeepEP introduce additional GPU SM usage dedicated to communication, inherently compromising the computation speed of attention and FFN. AFD also introduces a novel communication pattern, distinct from existing collectives and not well-supported. While workarounds like ncclSend/ncclRecv can be employed, they inevitably sacrifice performance. Addressing these challenges, we develop StepMesh, a specialized communication library for AFD based on GPUDirect RDMA, offering ultra-low latency, zero SM usage, and flexible communication.

AFD 对通信库提出了严苛的性能挑战. 对于三级流水线, AFD 要求在所有注意力实例和 FFN 实例之间于 272 µs 内完成 FP8 token, 缩放因子, 专家分布和 BF16 激活的传输 (§6). 现有通信库难以持续满足该要求. 此外, NCCL 和 DeepEP 等当前库引入额外的 GPU SM 占用专用于通信, 这固有地损害了注意力和 FFN 的计算速度. AFD 还引入了一种与现有集合通信不同且支持不佳的新型通信模式. 虽然可以采用 ncclSend/ncclRecv 等变通方法, 但它们不可避免地牺牲性能. 为解决这些挑战, 我们开发了 StepMesh, 一个专为 AFD 设计的基于 GPUDirect RDMA 的通信库, 提供超低延迟, 零 SM 占用和灵活的通信能力.

Communication Workflow Tailored for AFD Pipelines. Figure 8 illustrates the design choices of StepMesh to optimally align with the AFD pipeline stages. 1) Asynchronous APIs and dedicated threads: StepMesh offers asynchronous APIs and utilizes independent threads for network receiving and sending. The CPU latency of each thread is meticulously designed to meet stringent latency requirements, ensuring smooth and efficient data flow. 2) CPU-Based operation execution: To avoid contention for GPU SM resources with computation threads, StepMesh executes all communication operations - such as RDMA PostSend - on CPUs. It leverages NUMA-aware CPU core binding to minimize processing jitters and ensure stable performance. However, we continue to observe certain jitters originating from GPU APIs, such as the GPU kernel synchronization API (cudaEventSync). In future iterations, we plan to explore IBGDA [9] to eliminate GPU kernel synchronization on CPUs, thereby further reducing communication latency. 3) Pre-registered tensors for efficient communication: StepMesh supports direct memory transmission for GPU tensors, eliminating the need for serialization/deserialization or memory copying. StepMesh requires users to register tensors, identified by unique tensor keys, before initiating communication. This registration process is flexible and can remove some time-consuming operations. For instance, FFN does not need to concatenate tensors from different attention instances. Instead, these tensors can be directly sliced from contiguous GPU memory that has been pre-registered, streamlining the communication process and improving efficiency.

为 AFD 流水线量身定制的通信工作流. 图 8 展示了 StepMesh 的设计选择, 以最佳对齐 AFD 流水线阶段. 1) 异步 API 与专用线程: StepMesh 提供异步 API 并利用独立线程进行网络接收和发送. 每个线程的 CPU 延迟都经过精心设计以满足严苛的延迟要求, 确保流畅高效的数据流. 2) 基于 CPU 的操作执行: 为避免与计算线程争夺 GPU SM 资源, StepMesh 在 CPU 上执行所有通信操作 - 例如 RDMA PostSend. 它利用 NUMA 感知的 CPU 核心绑定来最小化处理抖动并确保稳定性能. 然而, 我们仍观察到来自 GPU API (如 GPU kernel 同步 API cudaEventSync) 的某些抖动. 在未来迭代中, 我们计划探索 IBGDA [9] 以消除 CPU 上的 GPU kernel 同步, 从而进一步降低通信延迟. 3) 预注册张量实现高效通信: StepMesh 支持 GPU 张量的直接内存传输, 无需序列化/反序列化或内存拷贝. StepMesh 要求用户在启动通信前注册以唯一张量键标识的张量. 该注册过程灵活, 可以省去一些耗时的操作. 例如, FFN 不需要拼接来自不同注意力实例的张量. 相反, 这些张量可以直接从已预注册的连续 GPU 内存中切片获取, 简化通信过程并提高效率.

> 译者注: StepMesh 的设计体现了系统级优化的极致追求: 零 SM 占用意味着通信完全不挤占 GPU 计算资源; CPU 侧执行 RDMA PostSend 避免了 GPU 线程阻塞; 预注册张量消除了数据搬运开销. 这些在 272µs 预算下的微优化, 单独看可能只有几十微秒的改进, 但叠加起来决定了 AFD 流水线能否达到 50ms TPOT 的 SLA. 这也解释了为什么通用通信库 (NCCL/DeepEP) 难以直接满足 AFD 的严苛需求 - 它们为通用集合通信设计, 而非为这种细粒度、低延迟的跨节点流水线优化.

Figure 8: StepMesh communication workflow tailored for AFD.

图 8: 为 AFD 量身定制的 StepMesh 通信工作流.

Figure 9: StepMesh framework for multiple accelerators. AFTensorWorker and AFTensorServer APIs are for attention and FFN instances respectively.

图 9: 面向多种加速器的 StepMesh 框架. AFTensorWorker 和 AFTensorServer API 分别用于注意力实例和 FFN 实例.

Support Heterogeneous Accelerators. Figure 9 presents the StepMesh framework, designed to be highly extensible and capable of integrating new types of accelerators. This framework treats accelerators as backends and establishes a set of backend interfaces that are crucial for AFD communication. These interfaces encompass essential functionalities such as memory allocation and stream synchronization. By adhering to these well-defined interfaces, new accelerators can be effortlessly integrated into the StepMesh framework. This streamlined and future-proof integration process allows for the rapid adoption of emerging hardware technologies, ensuring that the system remains at the cutting edge of performance and efficiency. StepMesh enables seamless communication between heterogeneous accelerators, fostering an environment where different types of hardware can collaborate effectively. This capability is essential for building cost-effective AFD systems that leverage a mix of accelerators to achieve optimal performance and resource utilization.

支持异构加速器. 图 9 展示了 StepMesh 框架, 设计为高度可扩展并能集成新型加速器. 该框架将加速器视为后端, 并建立了一套对 AFD 通信至关重要的后端接口. 这些接口涵盖内存分配和流同步等基本功能. 通过遵循这些明确定义的接口, 新加速器可以轻松集成到 StepMesh 框架中. 这种精简且具有前瞻性的集成流程允许快速采用新兴硬件技术, 确保系统保持在性能和效率的前沿. StepMesh 实现了异构加速器之间的无缝通信, 营造了一个不同类型硬件可以有效协作的环境. 这种能力对于构建利用混合加速器实现最佳性能和资源利用的成本效益型 AFD 系统至关重要.

Co-evolution with Networks. Our AFD system operates on a Rail-Optimized RoCE network. The following optimizations have been implemented for deploying AFD over RoCE. 1) Topology-aware deployment: Attention and FFN instances are strategically connected to the same Top-of-Rack (ToR) switches. This deployment ensures that communication between any attention and FFN instance experiences uniform network latency, resulting in balanced communication costs and mitigating straggling issues, where certain nodes lag behind others, causing bottlenecks. 2) PFC-Only Transport: We disable congestion control and rely solely on ToR-NIC Priority Flow Control (PFC). PFC maintains a lossless network environment, crucial for the high-performance and low-latency requirements of AFD pipelines. 3) Balancing traffic between NIC ports: In our network, each GPU connects to the network through two NIC ports configured with link aggregation. To fully leverage the available bandwidth, for every communication pair (e.g., between an attention and FFN instance), we establish two RDMA Queue Pairs and assign them to the respective ports. This setup effectively balances traffic across both ports, optimizing data transmission efficiency and ensuring that the combined bandwidth is utilized effectively.

与网络协同演进. 我们的 AFD 系统在 Rail-Optimized RoCE 网络上运行. 以下优化已实施用于在 RoCE 上部署 AFD. 1) 拓扑感知部署: 注意力实例和 FFN 实例策略性地连接到相同的架顶 (Top-of-Rack, ToR) 交换机. 这种部署确保任何注意力实例与 FFN 实例之间的通信具有均匀的网络延迟, 从而实现均衡的通信成本并缓解掉队问题 (某些节点落后于其他节点造成瓶颈). 2) 仅 PFC 传输: 我们禁用拥塞控制, 仅依赖 ToR-NIC 优先级流控 (Priority Flow Control, PFC). PFC 维护了无损网络环境, 这对 AFD 流水线的高性能和低延迟要求至关重要. 3) NIC 端口间流量均衡: 在我们的网络中, 每个 GPU 通过两个配置为链路聚合的 NIC 端口连接到网络. 为充分利用可用带宽, 对于每个通信对 (例如注意力实例与 FFN 实例之间), 我们建立两个 RDMA 队列对 (Queue Pairs) 并将它们分配到 respective ports. 这种设置有效平衡了两个端口之间的流量, 优化了数据传输效率并确保组合带宽得到有效利用.

StepMesh is developed based on [10], and we also make it available as an open-source project. Interested developers can access, contribute to, and utilize the library by visiting https://github.com/stepfun-ai/StepMesh.

StepMesh 基于 [10] 开发, 我们也将其作为开源项目提供. 感兴趣的开发者可以通过访问 https://github.com/stepfun-ai/StepMesh 来获取, 贡献和使用该库.

### 7.3 性能结果

End-to-End Performance. We compare Step-3 with DSv3, since it proposed the most representative distributed inference solution. Its official blog reports sustained average decoding throughput of 1,850 tokens/GPU/s (TGS) on H800, with 4,989 context on average. A higher peak performance in profiling is reported in [3], at 2,324 TGS with 4,096 context length on H800. Both numbers are obtained under 20 tokens/s decoding SLA.

端到端性能. 我们将 Step-3 与 DSv3 进行比较, 因为后者提出了最具代表性的分布式推理方案. 其官方博客报告在 H800 上持续平均解码吞吐为 1,850 tokens/GPU/s (TGS), 平均上下文 4,989. 在 [3] 中报告的更高剖析峰值性能为 2,324 TGS, 在 H800 上上下文长度 4,096. 两个数字均在 20 tokens/s 解码 SLA 下获得.

We are also aware of higher numbers like [23]. However, we do not compare with them because they do not run with the same 20 tokens/s decoding SLA or have shorter context length.

我们也注意到 [23] 等更高的数字. 然而, 我们不与之比较, 因为它们不在相同的 20 tokens/s 解码 SLA 下运行, 或上下文长度更短.

Table 8: Performance comparison with reported number of DSv3 under 20 tokens/s decoding SLA. TGS: Tokens/GPU/s.

表 8: 在 20 tokens/s 解码 SLA 下与 DSv3 报告数字的性能比较. TGS: Tokens/GPU/s.

| 模型 | 平均上下文长度 | Hopper GPU 数量 | 峰值 TGS |
|:---|:---:|:---:|:---:|
| DSv3-blog [1] | 4989 | 144 | 1850 |
| DSv3-profile [3] | 4096 | 128 | 2324 |
| Step-3 (BF16 attention) | 4096 | 40 (3A2F) | 3321 |
| Step-3 (FP8 attention) | 4096 | 32 (2A2F) | 4039 |
| Step-3 (FP8 attention) | 8192 | 48 (4A2F) | 2643 |

To have a direct comparison, we also test Step-3's decoding with 4,096 average context length on latest Hopper GPUs. GEMM runs in FP8 precision. While adhering to 20 tokens/s decoding SLA, Step-3 achieves 3,910 TGS on long-term average and 4,039 TGS (with FP8 attention) in a peak minute, around 74% higher than DSv3. We summarize the results in Table 8. We acknowledge that there is room for further improving DSv3 with more quantization, kernel optimizations, or better Hopper GPUs. However, we are confident that with the same level of optimizations and hardware, Step-3 can still achieve significantly higher throughput than DSv3.

为进行直接比较, 我们也在最新 Hopper GPU 上测试了 Step-3 在平均上下文长度 4,096 下的解码. GEMM 以 FP8 精度运行. 在遵守 20 tokens/s 解码 SLA 的同时, Step-3 长期平均达到 3,910 TGS, 峰值分钟达到 4,039 TGS (FP8 注意力), 比 DSv3 高约 74%. 我们在表 8 中总结了结果. 我们承认 DSv3 仍有通过更多量化, kernel 优化或更好的 Hopper GPU 进一步提升的空间. 然而, 我们有信心在相同优化水平和硬件下, Step-3 仍能实现比 DSv3 显著更高的吞吐.

We are still working on a few implementation details to reduce jitter and bring the average throughput closer to the peak throughput. Those numbers are obtained without MTP. As §5.2 explained, Step-3 can benefit from MTP significantly on accelerators other than H20. A rough estimate is a 50% (or more, for longer context) improvement, given that the attention efficiency can double with MTP while FFN remains the same (MFU is already high without MTP).

我们仍在完善一些实现细节以减少抖动并将平均吞吐拉近峰值吞吐. 这些数字在未启用 MTP 的情况下获得. 如 §5.2 所述, Step-3 在 H20 以外的加速器上可以从 MTP 中显著受益. 粗略估计有 50% (或更长上下文时更多) 的提升, 因为注意力效率可以通过 MTP 翻倍而 FFN 保持不变 (无 MTP 时 MFU 已很高).

For the above 4K context length case, we use "2A2F" deployment, which means two attention instances plus two FFN instances, in total 32 GPUs. The total batch size is 6144, divided into three micro batches of 2,048 to fill the 3-stage pipeline. For different average context lengths, we can simply scale attention instances. For example, for 8K average context length, we can use "4A2F" and keep the same total batch size as 6144. The latency and MFU for each component and the total network traffic will remain the same, so the SLA still holds and total throughput remains the same. The peak TGS will fall to around 4039 x (2 + 2)/(4 + 2) = 2693. Readers can extrapolate the deployment solution and performance numbers for longer context, e.g., "16A2F" for average 32K context length with 898 TGS, etc.

对于上述 4K 上下文长度场景, 我们使用 "2A2F" 部署, 即两个注意力实例加两个 FFN 实例, 共 32 张 GPU. 总 batch size 为 6144, 分为三个 2,048 的 micro batch 以填满三级流水线. 对于不同的平均上下文长度, 我们可以简单扩展注意力实例. 例如, 对于 8K 平均上下文长度, 我们可以使用 "4A2F" 并保持相同的总 batch size 6144. 每个组件的延迟和 MFU 以及总网络流量将保持不变, 因此 SLA 仍然成立且总吞吐保持不变. 峰值 TGS 将降至约 4039 x (2 + 2)/(4 + 2) = 2693. 读者可以外推更长上下文的部署方案和性能数字, 例如 "16A2F" 对应平均 32K 上下文长度且 TGS 为 898 等.

Note that the above scenarios are where Step-3 has the least advantage in cost saving compared with DSv3 using EP deployment. Step-3's advantage will widen with longer context and on cheaper hardware than H800 (§4).

请注意, 上述场景是 Step-3 与使用 EP 部署的 DSv3 相比成本节约优势最小的场景. Step-3 的优势将随上下文变长和在比 H800 更便宜的硬件上而扩大 (§4).

Ablation: Attention Quantization. Our previous results on Step-3 are with FP8 attention. We also test BF16 attention to understand the gain from quantization. Since the attention cost increases, we use "3A2F" with a total batch size of 6048, close to the previous 6144. Each attention instance then processes 6048/3/3=672 samples for each micro batch. As shown in Table 8, the result is 3,321 TGS, around 18% lower than FP8 attention. But it still outperforms DSv3 by a large margin.

消融实验: 注意力量化. 我们之前对 Step-3 的结果使用 FP8 注意力. 我们还测试了 BF16 注意力以理解量化带来的收益. 由于注意力成本增加, 我们使用 "3A2F" 且总 batch size 为 6048, 接近之前的 6144. 每个注意力实例随后为每个 micro batch 处理 6048/3/3=672 个样本. 如表 8 所示, 结果为 3,321 TGS, 比 FP8 注意力低约 18%. 但它仍然大幅优于 DSv3.

Ablation: MFA. To further understand the performance gain, we conduct an ablation study on the attention layer of Step-3, DSv3 and Qwen3-235B. They represent three different attention designs - MFA, MLA and GQA, respectively. Since we only test the attention layer, the number also indicates the performance of an attention instance in real AFD deployment. As shown in Table 9, MFA-Step3 achieves the lowest latency, followed by MLA-DSv3 and GQA-Qwen3. The performance gap is widened on H20 and A800, indicating that MFA is more efficient on lower-end accelerators. Also, the gap is larger on longer context lengths, which aligns with our analysis in §5.

消融实验: MFA. 为进一步理解性能收益, 我们对 Step-3, DSv3 和 Qwen3-235B 的注意力层进行了消融研究. 它们分别代表三种不同的注意力设计 - MFA, MLA 和 GQA. 由于我们只测试注意力层, 该数字也指示了真实 AFD 部署中注意力实例的性能. 如表 9 所示, MFA-Step3 实现了最低延迟, 其次是 MLA-DSv3 和 GQA-Qwen3. 性能差距在 H20 和 A800 上扩大, 表明 MFA 在低端加速器上更高效. 此外, 差距在更长上下文长度上更大, 这与我们在 §5 中的分析一致.

Table 9: Performance comparison of MFA/MLA/GQA. For MLA, we use FlashMLA which does not have official SM80 implementation, so its A800 number is not tested. We use FA3 (SM90) and FA2 (SM80) for MFA/GQA. Here the attention layer includes the linear projection before and after the core attention op. Each experiment uses 4 GPUs and a total batch size of 256. Both MFA and MLA use DP attention, while GQA uses TP attention. GEMM runs with FP8 (SM90) or INT8 (SM80) while attention runs with BF16.

表 9: MFA/MLA/GQA 性能比较. 对于 MLA, 我们使用 FlashMLA, 它没有官方 SM80 实现, 因此其 A800 数字未测试. 我们对 MFA/GQA 使用 FA3 (SM90) 和 FA2 (SM80). 此处注意力层包含核心注意力操作前后的线性投影. 每个实验使用 4 张 GPU 和总 batch size 256. MFA 和 MLA 都使用 DP 注意力, 而 GQA 使用 TP 注意力. GEMM 以 FP8 (SM90) 或 INT8 (SM80) 运行, 注意力以 BF16 运行.

| 上下文长度 | 注意力类型 | H800 (µs) | H20 (µs) | A800 (µs) |
|:---|:---|:---:|:---:|:---:|
| 8k | MFA-Step3 | 281 | 438 | 531 |
| 8k | MLA-DSv3 | 372 | 1252 | - |
| 8k | GQA-Qwen3 | 382 | 812 | 791 |
| 32k | MFA-Step3 | 791 | 1452 | 1484 |
| 32k | MLA-DSv3 | 1125 | 4817 | - |
| 32k | GQA-Qwen3 | 1391 | 3042 | 3010 |

Ablation: Scaling Step-3 to > 600B. Readers may wonder how much Step-3's advantage is due to having fewer total parameters than DSv3. We consider the case to upcycle [6,11] Step-3's MoE FFN into the 600B parameters region, a similar size to DSv3. Since FFN is doubled, we will need "4F" instead of "2F" to keep per-token latency the same. However, suppose we do not increase activated parameters per token, upcycled Step-3 will have the same over-sparse problem as DSv3 and face network bandwidth limit. Calculation shows the 400Gbps x 8 network can only sustain a micro batch of 3,072 (8-bit dispatch, 16-bit combine) for each FFN instance. Thus, the final solution is "3A4F" running three micro batches of 3,072. Each A and F has the same or less load than the original Step-3, so the 50ms TPOT SLA still holds. In this case, the TGS is 3,291. It shows the impact of over-sparsity (§5.4),

消融实验: 将 Step-3 扩展至 > 600B. 读者可能想知道 Step-3 的优势有多少是由于总参数量少于 DSv3. 我们考虑将 Step-3 的 MoE FFN 升级 (upcycle) [6,11] 到 600B 参数级别, 与 DSv3 规模相近. 由于 FFN 翻倍, 我们需要 "4F" 而非 "2F" 来保持每 token 延迟相同. 然而, 假设我们不增加每 token 激活参数, 升级后的 Step-3 将与 DSv3 面临相同的过度稀疏问题和网络带宽限制. 计算显示 400Gbps x 8 网络每个 FFN 实例只能维持 3,072 的 micro batch (8-bit dispatch, 16-bit combine). 因此, 最终方案是 "3A4F" 运行三个 3,072 的 micro batch. 每个 A 和 F 的负载与原始 Step-3 相同或更小, 因此 50ms TPOT SLA 仍然成立. 在这种情况下, TGS 为 3,291. 它展示了过度稀疏性的影响 (§5.4),

> 译者注: 表 9 的消融实验是本文最具说服力的实证证据之一. 在 H20 和 A800 这类非旗舰硬件上, MFA-Step3 相比 MLA-DSv3 的延迟优势从 8K 上下文的 2.9x 扩大到 32K 上下文的 3.3x. 这直接验证了理论分析: 算术强度与硬件 roofline 的匹配程度决定了真实性能, 而非单纯的 KV 缓存大小. 值得注意的是, 即使在 H800 上, MFA 也优于 MLA, 说明 DSv3 的 MLA 即使在对其 "主场" 硬件上也未完全释放潜力, 因为其过高的算术强度 (512) 仍略低于 H800 的 roofline (591), 处于计算受限边缘.


compared with the original Step-3's 4,039. Nevertheless, it is still much higher than DSv3's 2,324 with DeepEP. If we further align with the official DSv3 on running attention with BF16, based on profiling we estimate such upcycled Step-3 will run at around 2,880 TGS - it shows the advantage of AFD over pure EP.

与原始 Step-3 的 4,039 相比. 尽管如此, 它仍远高于使用 DeepEP 的 DSv3 的 2,324. 如果我们进一步与官方 DSv3 对齐, 以 BF16 运行注意力, 基于剖析我们估计这种升级后的 Step-3 将运行在大约 2,880 TGS - 这展示了 AFD 相比纯 EP 的优势.

## 8 结论与未来工作

This paper presents Step-3, and how its model-system co-design achieves state-of-the-art level of decoding efficiency among LLMs of similar sizes. Meanwhile, we also explain how we leverage AFD for analysis and realize Step-3's potentials. The immediate next step for us is to enable MTP and evaluate its performance gain for decoding. In the future, we will work on exploring new attention variants that continue to push the Pareto frontier of model volume and system costs. We also analyzed that today's interconnect limits the sparsity of MoE FFN if the goal is efficient decoding. To mitigate this problem, we are working with hardware vendors on novel high bandwidth domain designs [19]. With appropriate interconnect, we will pursue more sparsity for FFN.

本文介绍了 Step-3, 以及其模型-系统协同设计如何在类似规模的 LLM 中实现最先进的解码效率水平. 同时, 我们还解释了如何利用 AFD 进行分析并实现 Step-3 的潜力. 我们的下一步是启用 MTP 并评估其对解码的性能增益. 未来, 我们将致力于探索新的注意力变体, 持续推动模型规模与系统成本的帕累托前沿. 我们还分析了, 如果目标是高效解码, 当今互连技术限制了 MoE FFN 的稀疏度. 为缓解这一问题, 我们正在与硬件供应商合作开发新型高带宽域设计 [19]. 在适当的互连条件下, 我们将追求 FFN 的更高稀疏度.

## 参考文献

[1] DeepSeek AI. Deepseek-v3 inference system. https://github.com/deepseek-ai/open-infra-index/blob/main/202502OpenSourceWeek/, 2025.

[2] Li-Wen Chang, Wenlei Bao, Qi Hou, Chengquan Jiang, Ningxin Zheng, Yinmin Zhong, Xuanrun Zhang, Zuquan Song, Chengji Yao, Ziheng Jiang, Haibin Lin, Xin Jin, and Xin Liu. Flux: Fast software-based communication overlap on gpus through kernel fusion, 2024.

[3] DeepSeek. Profiling data in deepseek infra. https://github.com/deepseek-ai/profile-data/, 2025.

[4] DeepSeek-AI. Deepseek-v3 technical report, 2025.

[5] Nelson Elhage, Neel Nanda, Catherine Olsson, Tom Henighan, Nicholas Joseph, Ben Mann, Amanda Askell, Yuntao Bai, Anna Chen, Tom Conerly, Nova DasSarma, Dawn Drain, Deep Ganguli, Zac Hatfield-Dodds, Danny Hernandez, Andy Jones, Jackson Kernion, Liane Lovitt, Kamal Ndousse, Dario Amodei, Tom Brown, Jack Clark, Jared Kaplan, Sam McCandlish, and Chris Olah. A mathematical framework for transformer circuits. Transformer Circuits Thread, 2021. https://transformer-circuits.pub/2021/framework/index.html.

[6] Ethan He, Abhinav Khattar, Ryan Prenger, Vijay Korthikanti, Zijie Yan, Tong Liu, Shiqing Fan, Ashwath Aithal, Mohammad Shoeybi, and Bryan Catanzaro. Upcycling large language models into mixture of experts. arXiv preprint arXiv:2410.07524, 2025.

[7] Jingcheng Hu, Houyi Li, Yinmin Zhang, Zili Wang, Shuigeng Zhou, Xiangyu Zhang, Heung-Yeung Shum, and Daxin Jiang. Multi-matrix factorization attention, 2025.

[8] Alibaba Inc. Qwen3: Think deeper, act faster, 2025.

[9] Nvidia Inc. Improving network performance of hpc systems using nvidia magnum io nvshmem and gpudirect async, 2025.

[10] Yimin Jiang, Yibo Zhu, Chang Lan, Bairen Yi, Yong Cui, and Chuanxiong Guo. A unified architecture for accelerating distributed DNN training in heterogeneous GPU/CPU clusters. In 14th USENIX Symposium on Operating Systems Design and Implementation (OSDI 20), pages 463-479, 2020.

[11] Aran Komatsuzaki, Joan Puigcerver, James Lee-Thorp, Carlos Riquelme Ruiz, Basil Mustafa, Joshua Ainslie, Yi Tay, Mostafa Dehghani, and Neil Houlsby. Sparse upcycling: Training mixture-of-experts from dense checkpoints. In ICLR, 2023.

[12] Woosuk Kwon, Zhuohan Li, Siyuan Zhuang, Ying Sheng, Lianmin Zheng, Cody Hao Yu, Joseph E. Gonzalez, Hao Zhang, and Ion Stoica. Efficient memory management for large language model serving with pagedattention, 2023.

[13] Jiamin Li, Yimin Jiang, Yibo Zhu, Cong Wang, and Hong Xu. Accelerating distributed MoE training and inference with lina. In 2023 USENIX Annual Technical Conference (USENIX ATC 23), pages 945-959, 2023.

[14] Juncai Liu, Jessie Hui Wang, and Yimin Jiang. Janus: A unified distributed training framework for sparse mixture-of-experts models. In Proceedings of the ACM SIGCOMM 2023 Conference, pages 486-498, 2023.

[15] Meta. Llama 4. https://www.llama.com/models/llama-4/, 2025.

[16] MiniMax. Minimax-m1: Scaling test-time compute efficiently with lightning attention, 2025.

[17] Moonshoot-AI. Kimi k2: Open agentic intelligence. https://moonshotai.github.io/Kimi-K2/, 2025.

[18] Pratyush Patel, Esha Choukse, Chaojie Zhang, Inigo Goiri, Aashaka Shah, Saeed Maleki, and Ricardo Bianchini. Splitwise: Efficient generative llm inference using phase splitting, 2023.

[19] Chenchen Shou, Guyue Liu, Hao Nie, Huaiyu Meng, Yu Zhou, Yimin Jiang, Wenqing Lv, Yelong Xu, Yuanwei Lu, Zhang Chen, et al. Infinitehbd: Building datacenter-scale high-bandwidth domain for llm with optical circuit switching transceivers. arXiv preprint arXiv:2502.03885, 2025.

[20] StepFun. Step 2. https://platform.stepfun.com/docs/llm/text, 2025.

[21] Yehui Tang, Xiaosong Li, Fangcheng Liu, Wei Guo, Hang Zhou, Yaoyuan Wang, Kai Han, Xianzhi Yu, Jinpeng Li, Hui Zang, Fei Mi, Xiaojun Meng, Zhicheng Liu, Hanting Chen, Binfan Zheng, Can Chen, Youliang Yan, Ruiming Tang, Peifeng Qin, Xinghao Chen, Dacheng Tao, and Yunhe Wang. Pangu pro moe: Mixture of grouped experts for efficient sparsity, 2025.

[22] ERNIE Team. Ernie 4.5 technical report, 2025.

[23] The SGLang Team. Deploying deepseek with pd disaggregation and large-scale expert parallelism on 96 h100 gpus. https://lmsys.org/blog/2025-05-05-large-scale-ep/, 2025.

[24] Ashish Vaswani, Noam Shazeer, Niki Parmar, Jakob Uszkoreit, Llion Jones, Aidan N Gomez, Lukasz Kaiser, and Illia Polosukhin. Attention is all you need. Neural Information Processing Systems, 2017.

[25] An Yang, Anfeng Li, Baosong Yang, Beichen Zhang, Binyuan Hui, Bo Zheng, Bowen Yu, Chang Gao, Chengen Huang, Chenxu Lv, Chujie Zheng, Dayiheng Liu, Fan Zhou, Fei Huang, Feng Hu, Hao Ge, Haoran Wei, Huan Lin, Jialong Tang, Jian Yang, Jianhong Tu, Jianwei Zhang, Jianxin Yang, Jiaxi Yang, Jing Zhou, Jingren Zhou, Junyang Lin, Kai Dang, Keqin Bao, Kexin Yang, Le Yu, Lianghao Deng, Mei Li, Mingfeng Xue, Mingze Li, Pei Zhang, Peng Wang, Qin Zhu, Rui Men, Ruize Gao, Shixuan Liu, Shuang Luo, Tianhao Li, Tianyi Tang, Wenbiao Yin, Xingzhang Ren, Xinyu Wang, Xinyu Zhang, Xuancheng Ren, Yang Fan, Yang Su, Yichang Zhang, Yinger Zhang, Yu Wan, Yuqiong Liu, Zekun Wang, Zeyu Cui, Zhenru Zhang, Zhipeng Zhou, and Zihan Qiu. Qwen3 technical report, 2025.

[26] Songlin Yang, Bailin Wang, Yikang Shen, Rameswar Panda, and Yoon Kim. Gated linear attention transformers with hardware-efficient training, 2024.

[27] Jingyang Yuan, Huazuo Gao, Damai Dai, Junyu Luo, Liang Zhao, Zhengyan Zhang, Zhenda Xie, Y. X. Wei, Lean Wang, Zhiping Xiao, Yuqing Wang, Chong Ruan, Ming Zhang, Wenfeng Liang, and Wangding Zeng. Native sparse attention: Hardware-aligned and natively trainable sparse attention, 2025.

[28] Zili Zhang, Yinmin Zhong, Ranchen Ming, Hanpeng Hu, Jianjian Sun, Zheng Ge, Yibo Zhu, and Xin Jin. Disttrain: Addressing model and data heterogeneity with disaggregated training for multimodal large language models, 2024.

[29] Chenggang Zhao, Chengqi Deng, Chong Ruan, Damai Dai, Huazuo Gao, Jiashi Li, Liyue Zhang, Panpan Huang, Shangyan Zhou, Shirong Ma, Wenfeng Liang, Ying He, Yuqing Wang, Yuxuan Liu, and Y.X. Wei. Insights into deepseek-v3: Scaling challenges and reflections on hardware for ai architectures. In Proceedings of the 52nd Annual International Symposium on Computer Architecture, ISCA '25, page 1731-1745, 2025.

[30] Chenggang Zhao, Shangyan Zhou, Liyue Zhang, Chengqi Deng, Zhean Xu, Yuxuan Liu, Kuai Yu, Jiashi Li, and Liang Zhao. Deepep: an efficient expert-parallel communication library. https://github.com/deepseek-ai/DeepEP, 2025.

[31] Yinmin Zhong, Shengyu Liu, Junda Chen, Jianbo Hu, Yibo Zhu, Xuanzhe Liu, Xin Jin, and Hao Zhang. DistServe: Disaggregating prefill and decoding for goodput-optimized large language model serving. In 18th USENIX Symposium on Operating Systems Design and Implementation (OSDI 24), pages 193-210, 2024.

[32] Ruidong Zhu, Ziheng Jiang, Chao Jin, Peng Wu, Cesar A. Stuardo, Dongyang Wang, Xinlei Zhang, Huaping Zhou, Haoran Wei, Yang Cheng, Jianzhe Xiao, Xinyi Zhang, Lingjun Liu, Haibin Lin, Li-Wen Chang, Jianxi Ye, Xiao Yu, Xuanzhe Liu, Xin Jin, and Xin Liu. Megascale-infer: Serving mixture-of-experts at scale with disaggregated expert parallelism, 2025.

[33] Pengfei Zuo, Huimin Lin, Junbo Deng, Nan Zou, Xingkun Yang, Yingyu Diao, Weifeng Gao, Ke Xu, Zhangyu Chen, Shirui Lu, Zhao Qiu, Peiyang Li, Xianyu Chang, Zhengzhong Yu, Fangzheng Miao, Jia Zheng, Ying Li, Yuan Feng, Bei Wang, Zaijian Zong, Mosong Zhou, Wenli Zhou, Houjiang Chen, Xingyu Liao, Yipeng Li, Wenxiao Zhang, Ping Zhu, Yinggang Wang, Chuanjie Xiao, Depeng Liang, Dong Cao, Juncheng Liu, Yongqiang Yang, Xiaolong Bai, Yi Li, Huaguo Xie, Huatao Wu, Zhibin Yu, Lv Chen, Hu Liu, Yujun Ding, Haipei Zhu, Jing Xia, Yi Xiong, Zhou Yu, and Heng Liao. Serving large language models on huawei cloud-matrix384, 2025.

All author lists are in alphabetical order.

所有作者列表按字母顺序排列.

### 核心系统贡献者

Bin Wang
Bojun Wang
Changyi Wan
Guanzhe Huang
Hanpeng Hu
Haonan Jia
Hao Nie
Mingliang Li
Nuo Chen
Siyu Chen
Song Yuan
Wuxun Xie
Xiaoniu Song
Xing Chen
Xingping Yang
Xuelin Zhang
Yanbo Yu
Yaoyu Wang
Yibo Zhu
Yimin Jiang
Yu Zhou
Yuanwei Lu

### 核心模型架构贡献者

Houyi Li
Jingcheng Hu
Ka Man Lo

Contributors (Pretrain, Post-train, Multi-modal, System, Data)

贡献者 (预训练, 后训练, 多模态, 系统, 数据)

Ailin Huang
Binxing Jiao
Bo Li
Boyu Chen
Changxin Miao
Chao Lou
Chen Hu
Chen Xu
Chenfeng Yu
Chengyuan Yao
Daokuan Lv
Dapeng Shi
Deshan Sun
Ding Huang
Dingyuan Hu
Dongqing Pang
Enle Liu
Fajie Zhang
Fanqi Wan
Gulin Yan
Han Zhang
Han Zhou
Hanghao Wu
Hangyu Guo
Hanqi Chen
Hanshan Zhang
Hao Wu
Haocheng Zhang
Haolong Yan
Haoran Lv
Haoran Wei
Hebin Zhou
Heng Wang
Heng Wang
Hongxin Li
Hongyu Zhou
Hongyuan Wang
Huiyong Guo
Jia Wang
Jiahao Gong
Jialing Xie
Jian Zhou
Jianjian Sun
Jiaoren Wu
Jiaran Zhang
Jiayu Liu
Jie Cheng
Jie Luo
Jie Yan
Jie Yang
Jieyi Hou
Jinguang Zhang
Jinlan Cao
Jisheng Yin
Junfeng Liu
Junhao Huang
Junzhe Lin
Kaijun Tan
Kaixiang Li
Kang An
Kangheng Lin
Kenkun Liu
Lei Yang
Liang Zhao
Liangyu Chen
Lieyu Shi
Liguo Tan
Lin Lin
Lin Zhang
Lina Chen
Liwen Huang
Liying Shi
Longlong Gu
Mei Chen
Mengqiang Ren
Ming Li
Mingzhe Chen
Na Wang
Nan Wu
Qi Han
Qian Zhao
Qiang Zhang
Qianni Liu
Qiaohui Chen
Qiling Wu
Qinglin He
Qinyuan Tan
Qiufeng Wang
Qiuping Wu
Qiuyan Liang
Quan Sun
Rui Li
Ruihang Miao
Ruosi Wan
Ruyan Guo
Shangwu Zhong
Shaoliang Pang
Shengjie Fan
Shijie Shang
Shilei Jiang
Shiliang Yang
Shiming Hao
Shuli Gao
Siming Huang
Siqi Liu
Tiancheng Cao
Tianhao Cheng
Tianhao Peng
Wang You
Wei Ji
Wen Sun
Wenjin Deng
Wenqing He
Wenzhen Zheng
Xi Chen
Xiangwen Kong
Xianzhen Luo
Xiaobo Yang
Xiaojia Liu
Xiaoxiao Ren
Xin Han
Xin Li
Xin Wu
Xu Zhao
Yanan Wei
Yang Li
Yangguang Li
Yangshijie Xu
Yanming Xu
Yaqiang Shi
Yeqing Shen
Yi Yang
Yifei Yang
Yifeng Gong
Yihan Chen
Yijing Yang
Yinmin Zhang
Yizhuang Zhou
Yuanhao Ding
Yuantao Fan
Yuanzhen Yang
Yuchu Luo
Yue Peng
Yufan Lu

Yuhang Deng
Yuhe Yin
Yujie Liu
Yukun Chen
Yuling Zhao
Yun Mou
Yunlong Li
Yunzhou Ju
Yusheng Li
Yuxiang Yang
Yuxiang Zhang
Yuyang Chen
Zejia Weng
Zhe Xie
Zheng Ge
Zheng Gong
Zhenyi Lu
Zhewei Huang
Zhichao Chang
Zhiguo Huang
Zhirui Wang
Zidong Yang
Zili Wang
Ziqi Wang
Zixin Zhang

### 赞助商


Binxing Jiao
Daxin Jiang
Heung-Yeung Shum
Xiangyu Zhang
Yibo Zhu
