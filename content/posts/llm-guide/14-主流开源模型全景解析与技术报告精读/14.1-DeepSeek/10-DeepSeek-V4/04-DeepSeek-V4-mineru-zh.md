---
title: "DeepSeek-V4 - 逐段精译与译者注"
source: 03-DeepSeek-V4-mineru-en.md
translated_by: "AI Agent"
date: 2026-05-19
---



# DeepSeek-V4: Towards Highly Efficient Million-Token Context Intelligence

>  **[返回 14.1-DeepSeek 家族总览](../../14.1-DeepSeek.md)**


DeepSeek-AI research@deepseek.com

## Abstract

## 摘要

We present a preview version of DeepSeek-V4 series, including two strong Mixture-of-Experts (MoE) language models — DeepSeek-V4-Pro with 1.6T parameters (49B activated) and DeepSeek-V4-Flash with 284B parameters (13B activated) — both supporting a context length of one million tokens. DeepSeek-V4 series incorporate several key upgrades in architecture and optimization: (1) a hybrid attention architecture that combines Compressed Sparse Attention (CSA) and Heavily Compressed Attention (HCA) to improve long-context efficiency; (2) Manifold-Constrained Hyper-Connections (mHC) that enhance conventional residual connections; (3) and the Muon optimizer for faster convergence and greater training stability. We pre-train both models on more than 32T diverse and high-quality tokens, followed by a comprehensive post-training pipeline that unlocks and further enhances their capabilities. DeepSeek-V4-Pro-Max, the maximum reasoning effort mode of DeepSeek-V4-Pro, redefines the state-of-the-art for open models, outperforming its predecessors in core tasks. Meanwhile, DeepSeek-V4 series are highly efficient in long-context scenarios. In the one-million-token context setting, DeepSeek-V4-Pro requires only 27% of single-token inference FLOPs and 10% of KV cache compared with DeepSeek-V3.2. This enables us to routinely support one-million-token contexts, thereby making long-horizon tasks and further test-time scaling more feasible. The model checkpoints are available at https://huggingface.co/collections/deepseek-ai/deepseek-v4.

我们推出了 DeepSeek-V4 系列的预览版, 包括两个强大的混合专家 (MoE) 语言模型——DeepSeek-V4-Pro(1.6T 参数, 49B 激活)和 DeepSeek-V4-Flash(284B 参数, 13B 激活)——两者均支持一百万 token 的上下文长度。DeepSeek-V4 系列在架构和优化方面引入了多项关键升级：(1) 结合压缩稀疏注意力 (CSA) 和重度压缩注意力 (HCA) 的混合注意力架构, 以提升长上下文效率; (2) 流形约束超连接 (mHC), 增强传统的残差连接; (3) Muon 优化器, 实现更快的收敛和更高的训练稳定性。我们在超过 32T 的多样化高质量 token 上预训练了两个模型, 随后通过全面的后训练流水线解锁并进一步增强其能力。DeepSeek-V4-Pro-Max(DeepSeek-V4-Pro 的最大推理 effort 模式)重新定义了开源模型的最先进水平, 在核心任务上超越了前代。同时, DeepSeek-V4 系列在长上下文场景中具有极高的效率。在一百万 token 上下文设置中, DeepSeek-V4-Pro 仅需 DeepSeek-V3.2 的 27% 单 token 推理 FLOPs 和 10% 的 KV 缓存。这使我们能够常规支持一百万 token 上下文, 从而使长程任务和进一步的测试时扩展更加可行。模型检查点可在 https://huggingface.co/collections/deepseek-ai/deepseek-v4 获取。

> 译者注: DeepSeek-V4 是 DeepSeek 家族迄今为止最大的模型——1.6T 总参数 / 49B 激活参数(V3 是 671B 总参数 / 37B 激活)。两个变体(Pro 和 Flash)覆盖了不同的效率-性能权衡点：Pro 追求极致性能, Flash 追求极致效率。"百万 token 上下文"是本文最核心的卖点——相比 V3.2 的 128K, V4 将上下文长度扩展了 8 倍。三大架构创新中, CSA/HCA 是对 V3.2 DSA 的进一步升级, mHC 是对残差连接的重新思考, Muon 优化器则来自独立的研究社区(Jordan et al., 2024)。

## 1. Introduction

## 1. 引言

The emergence of reasoning models (DeepSeek-AI, 2025; OpenAI, 2024c) has established a new paradigm of test-time scaling, driving substantial performance gains for Large Language Models (LLMs). However, this scaling paradigm is fundamentally constrained by the quadratic computational complexity of the vanilla attention mechanism (Vaswani et al., 2017), which creates a prohibitive bottleneck for ultra-long contexts and reasoning processes. Concurrently, the emergence of long-horizon scenarios and tasks — from complex agentic workflows to massive cross-document analysis — has also made efficient support for ultra-long contexts critical for future progress. While recent open-source efforts (Bai et al., 2025a; DeepSeek-AI, 2024; MiniMax, 2025; Qwen, 2025) have advanced general capabilities, this core architectural inefficiency in handling ultra-long sequences remains a key impediment, limiting further gains from test-time scaling and hindering further exploration into long-horizon scenarios and tasks.

推理模型的出现 (DeepSeek-AI, 2025; OpenAI, 2024c) 确立了测试时扩展的新范式, 推动了大语言模型 (LLM) 的性能大幅提升。然而, 这种扩展范式从根本上受到标准注意力机制 (Vaswani et al., 2017) 二次方计算复杂度的约束, 这为超长上下文和推理过程带来了 prohibitive 瓶颈。同时, 长程场景和任务的出现——从复杂的智能体工作流到大规模的跨文档分析——也使对超长上下文的高效支持成为未来发展的关键。尽管最近的开源努力 (Bai et al., 2025a; DeepSeek-AI, 2024; MiniMax, 2025; Qwen, 2025) 提升了通用能力, 但这种处理超长序列的核心架构低效率仍然是一个关键障碍, 限制了测试时扩展的进一步收益, 并阻碍了对长程场景和任务的进一步探索。

> 译者注: 论文开篇直接点出了当前 LLM 发展的核心矛盾：测试时扩展(让模型推理更多步)带来了性能提升, 但标准注意力的 O(n²) 复杂度使得这种扩展在长序列上不可持续。当上下文达到 1M token 时, 注意力计算量将达到 128K 时的约 64 倍。如果不对注意力机制做根本性改进, 测试时扩展的效益会被计算成本迅速吞噬。这正是 V4 投入大量精力设计 CSA/HCA 的动机。

In order to break the efficiency barrier in ultra-long contexts, we develop the DeepSeek-V4 series, including the preview versions of DeepSeek-V4-Pro with 1.6T parameters (49B activated) and DeepSeek-V4-Flash with 284B parameters (13B activated). Through architectural innovations, DeepSeek-V4 series achieve a dramatic leap in computational efficiency for processing ultra-long sequences. This breakthrough enables efficient support for a context length of one million tokens, ushering in a new era of million-length contexts for next-generation LLMs. We believe our capability to efficiently handle ultra-long sequences unlocks the next frontier of test-time scaling, paves the way for deeper research into long-horizon tasks, and establishes a necessary foundation for exploring future paradigms like online learning.

为了打破超长上下文中的效率障碍, 我们开发了 DeepSeek-V4 系列, 包括预览版 DeepSeek-V4-Pro(1.6T 参数, 49B 激活)和 DeepSeek-V4-Flash(284B 参数, 13B 激活)。通过架构创新, DeepSeek-V4 系列在处理超长序列的计算效率上实现了巨大飞跃。这一突破使得高效支持一百万 token 的上下文长度成为可能, 为下一代 LLM 开启了百万长度上下文的新时代。我们相信, 我们高效处理超长序列的能力解锁了测试时扩展的下一个前沿, 为长程任务的深入研究铺平了道路, 并为探索在线学习等未来范式奠定了必要基础。

Compared with the DeepSeek-V3 architecture (DeepSeek-AI, 2024), DeepSeek-V4 series retain the DeepSeekMoE framework (Dai et al., 2024) and Multi-Token Prediction (MTP) strategy, while introducing several key innovations in architecture and optimization. To enhance longcontext efficiency, we design a hybrid attention mechanism combining Compressed Sparse Attention (CSA) and Heavily Compressed Attention (HCA). CSA compresses the KV caches along the sequence dimension and then performs DeepSeek Sparse Attention (DSA) (DeepSeek-AI, 2025), whereas HCA applies more aggressive compression to the KV caches but keeps dense attention. To strengthen modeling capability, we incorporate Manifold-Constrained Hyper-Connections (mHC) (Xie et al., 2026) that upgrade conventional residual connections. Additionally, we introduce the Muon (Jordan et al., 2024; Liu et al., 2025) optimizer to the training of DeepSeek-V4 series, leading to faster convergence and improved training stability.

与 DeepSeek-V3 架构 (DeepSeek-AI, 2024) 相比, DeepSeek-V4 系列保留了 DeepSeekMoE 框架 (Dai et al., 2024) 和多 Token 预测 (MTP) 策略, 同时在架构和优化方面引入了多项关键创新。为了增强长上下文效率, 我们设计了结合压缩稀疏注意力 (CSA) 和重度压缩注意力 (HCA) 的混合注意力机制。CSA 沿序列维度压缩 KV 缓存, 然后执行 DeepSeek 稀疏注意力 (DSA) (DeepSeek-AI, 2025), 而 HCA 对 KV 缓存应用更激进的压缩但保持稠密注意力。为了增强建模能力, 我们引入了流形约束超连接 (mHC) (Xie et al., 2026), 升级传统的残差连接。此外, 我们在 DeepSeek-V4 系列的训练中引入了 Muon (Jordan et al., 2024; Liu et al., 2025) 优化器, 实现了更快的收敛和改进的训练稳定性。

> 译者注: V4 的架构演进遵循"继承 + 创新"的原则。继承自 V3：MoE 框架、MTP、MLA(在 CSA 中使用)。创新点：
1. **CSA** = KV 压缩 + DSA(V3.2 的稀疏注意力), 是 DSA 的增强版——先压缩再稀疏选择。
2. **HCA** = 更激进的 KV 压缩 + 稠密注意力, 用于那些不适合稀疏注意力的层或场景。
3. **mHC** 替代残差连接, 允许更复杂的特征路径组合。
4. **Muon** 是一个较新的优化器, 通过正交化梯度更新来加速收敛。

To enable efficient training and inference for DeepSeek-V4 series as well as productive development, we introduce several infrastructure optimizations. First, we design and implement a single fused kernel for MoE modules that fully overlaps computation, communication, and memory access. Second, we employ TileLang (Wang et al., 2026), a Domain-Specific Language (DSL) to balance development productivity and runtime efficiency. Third, we provide efficient batch-invariant and deterministic kernel libraries to ensure bitwise reproducibility across training and inference. Fourth, for the training framework, we extend the autograd framework with tensor-level checkpointing for fine-grained recomputation control; and we enhance training efficiency with a hybrid ZeRO strategy for the Muon optimizer, cost-effective mHC implementations via recomputation and fused kernels, and two-stage contextual parallelism to manage compressed attention. Fifth, for the inference framework, we design a heterogeneous KV cache structure with on-disk storage strategies to enable efficient shared-prefix reuse.

为了实现 DeepSeek-V4 系列的高效训练和推理以及高效的开发, 我们引入了多项基础设施优化。第一, 我们设计并实现了 MoE 模块的单一融合内核, 完全重叠计算、通信和内存访问。第二, 我们采用 TileLang (Wang et al., 2026), 一种领域特定语言 (DSL), 以平衡开发生产力和运行时效率。第三, 我们提供高效的批不变和确定性内核库, 以确保训练和推理之间的位级可复现性。第四, 对于训练框架, 我们用张量级检查点扩展了自动微分框架以实现细粒度的重计算控制; 并通过 Muon 优化器的混合 ZeRO 策略、通过重计算和融合内核的成本效益 mHC 实现、以及两阶段上下文并行来管理压缩注意力, 从而增强训练效率。第五, 对于推理框架, 我们设计了具有磁盘存储策略的异构 KV 缓存结构, 以实现高效的前缀共享重用。

By employing hybrid CSA and HCA, along with precision optimizations on computation and storage, DeepSeek-V4 series achieve significantly lower inference FLOPs and a substantially reduced KV cache size compared with DeepSeek-V3.2, especially in long-context settings. The right part of Figure 1 demonstrates the estimated single-token inference FLOPs and accumulated KV cache size of DeepSeek-V3.2 and DeepSeek-V4 series. In the scenario of 1M-token context, even DeepSeek-V4-Pro, which has a larger number of activated parameters, attains only 27% of the single-token FLOPs (measured in equivalent FP8 FLOPs) and 10% of the KV cache size relative to DeepSeek-V3.2. Furthermore, DeepSeek-V4-Flash, with its smaller number of activated parameters, pushes efficiency even further: in the 1M-token context setting, it achieves only 10% of the single-token FLOPs and 7% of the KV cache size compared with DeepSeek-V3.2. Additionally, for DeepSeek-V4 series, the routed expert parameters utilize FP4 precision. While the peak FLOPs for FP4 × FP8 operations are currently the same as FP8 × FP8 on existing硬件, they can theoretically be implemented to be 1/3 more efficient on future硬件, which will further enhance the efficiency of DeepSeek-V4 series.

通过采用混合 CSA 和 HCA, 以及计算和存储上的精度优化, DeepSeek-V4 系列相比 DeepSeek-V3.2 实现了显著更低的推理 FLOPs 和大幅缩小的 KV 缓存大小, 特别是在长上下文设置中。图 1 右侧展示了 DeepSeek-V3.2 和 DeepSeek-V4 系列的估计单 token 推理 FLOPs 和累积 KV 缓存大小。在 1M token 上下文场景中, 即使激活参数更多的 DeepSeek-V4-Pro, 也仅达到 DeepSeek-V3.2 的 27% 单 token FLOPs(以等效 FP8 FLOPs 衡量)和 10% 的 KV 缓存大小。此外, 激活参数更少的 DeepSeek-V4-Flash 将效率推得更远：在 1M token 上下文设置中, 它仅达到 DeepSeek-V3.2 的 10% 单 token FLOPs 和 7% 的 KV 缓存大小。此外, 对于 DeepSeek-V4 系列, 路由专家参数使用 FP4 精度。虽然 FP4 × FP8 操作的峰值 FLOPs 目前在现有硬件上与 FP8 × FP8 相同, 但在未来硬件上理论上可以实现 1/3 更高的效率, 这将进一步增强 DeepSeek-V4 系列的效率。

> 译者注: 效率数字非常惊人。在 1M 上下文下, V4-Pro(49B 激活)的 KV 缓存只有 V3.2(37B 激活)的 10%。这意味着尽管 V4-Pro 的激活参数更多, 它的长序列推理成本反而远低于 V3.2。这一效率提升来自三个层面：1) CSA/HCA 的稀疏/压缩注意力减少了 KV 存储; 2) MLA 的低秩 KV 压缩; 3) 路由专家使用 FP4 精度(虽然当前硬件不支持 FP4 矩阵乘法的加速, 但为未来硬件预留了优化空间)。

During pre-training, we train DeepSeek-V4-Flash on 32T tokens and DeepSeek-V4-Pro on 33T tokens, respectively. After pre-training, these two models can natively and efficiently support 1M-length contexts. In our internal evaluations, DeepSeek-V4-Flash-Base already surpasses DeepSeek-V3.2-Base across a majority of benchmarks with its more parameter-efficient design. DeepSeek-V4-Pro-Base further extends this advantage to set a new performance standard among DeepSeek foundation models, achieving comprehensive superiority across reasoning, coding, long-context, and world knowledge tasks.

在预训练期间, 我们分别在 32T token 上训练 DeepSeek-V4-Flash, 在 33T token 上训练 DeepSeek-V4-Pro。预训练后, 这两个模型可以原生且高效地支持 1M 长度上下文。在我们的内部评估中, DeepSeek-V4-Flash-Base 已经以其更高效的参数设计在大多数基准上超越了 DeepSeek-V3.2-Base。DeepSeek-V4-Pro-Base 进一步扩展了这一优势, 在 DeepSeek 基础模型中树立了新的性能标准, 在推理、编程、长上下文和世界知识任务上实现了全面领先。

The post-training pipeline of DeepSeek-V4 series features a two-stage paradigm: the independent cultivation of domain-specific experts, followed by unified model consolidation via on-policy distillation (Gu et al., 2024; Lu and Lab, 2025). Initially, for each target domain — such as mathematics, coding, agent, and instruction following — a separate expert model is trained independently. The base model first undergoes Supervised Fine-Tuning (SFT) on high-quality, domain-specific data to建立 foundational capabilities. Subsequently, Reinforcement Learning (RL) is applied using Group Relative Policy Optimization (GRPO) (DeepSeek-AI, 2025), which further optimizes the model for domain-aligned behaviors guided by reward models tailored to specific成功 criteria. This phase yields a diverse set of specialized experts, each excelling in its respective field. Finally, to integrate these distinct proficiencies, a single unified model is trained through on-policy distillation, wherein the unified model acts as the student learning to optimize the reverse KL loss with teacher models.

DeepSeek-V4 系列的后训练流水线采用两阶段范式：独立培养领域特定专家, 然后通过 on-policy 蒸馏 (Gu et al., 2024; Lu and Lab, 2025) 进行统一模型整合。最初, 对于每个目标领域——如数学、编程、智能体和指令遵循——独立训练一个单独的专家模型。基座模型首先在经过高质量、领域特定的数据上进行监督微调 (SFT) 以建立基础能力。随后, 使用 Group Relative Policy Optimization (GRPO) (DeepSeek-AI, 2025) 应用强化学习 (RL), 通过针对特定成功标准定制的奖励模型进一步优化模型的领域对齐行为。这一阶段产生了一组多样化的专业专家, 各自在其领域表现出色。最后, 为了整合这些不同的专长, 通过 on-policy 蒸馏训练一个统一的模型, 其中统一模型作为学生, 学习优化与教师模型的反向 KL 损失。

> 译者注: V4 的后训练策略与 V3.2 类似, 都是"专家蒸馏 + 统一整合"。关键差异在于 V4 明确提到了"on-policy distillation"——学生模型使用自己的策略(而非教师模型的策略)来采样回复, 然后优化与教师模型的 KL 散度。这与传统的 off-policy 蒸馏(学生从教师或固定数据集采样)相比, 可以更好地保持学生模型的探索能力。V3.2 的论文中虽然也使用了专家蒸馏, 但没有明确区分 on-policy/off-policy。

## Summary of Core Evaluation Results

## 核心评估结果摘要

• Knowledge: In assessments of broad world knowledge, DeepSeek-V4-Pro-Max, the maximum reasoning effort mode of DeepSeek-V4-Pro, significantly outperforms leading opensource models on the SimpleQA (OpenAI, 2024d) and Chinese-SimpleQA (He et al., 2024) benchmarks. Regarding educational knowledge — evaluated via MMLU-Pro (Wang et al., 2024b), HLE (Phan et al., 2025), and GPQA (Rein et al., 2023) — DeepSeek-V4-Pro-Max shows a marginal lead over its open-source counterparts. DeepSeek-V4-Pro-Max has significantly closed the gap with the leading proprietary model, Gemini-3.1-Pro, despite still trailing it in these knowledge-based evaluations.

• 知识：在广泛的世界知识评估中, DeepSeek-V4-Pro-Max(DeepSeek-V4-Pro 的最大推理 effort 模式)在 SimpleQA (OpenAI, 2024d) 和 Chinese-SimpleQA (He et al., 2024) 基准上显著优于领先的开源模型。关于教育知识——通过 MMLU-Pro (Wang et al., 2024b)、HLE (Phan et al., 2025) 和 GPQA (Rein et al., 2023) 评估——DeepSeek-V4-Pro-Max 相比其开源对手显示出微弱领先。DeepSeek-V4-Pro-Max 已显著缩小与领先专有模型 Gemini-3.1-Pro 的差距, 尽管在这些基于知识的评估中仍然落后。

• Reasoning: Through the expansion of reasoning tokens, DeepSeek-V4-Pro-Max demonstrates superior performance relative to GPT-5.2 and Gemini-3.0-Pro on standard reasoning benchmarks. Nevertheless, its performance falls marginally short of GPT-5.4 and Gemini-3.1-Pro, suggesting a developmental trajectory that trails state-of-the-art frontier models by approximately 3 to 6 months. Furthermore, DeepSeek-V4-Flash-Max achieves comparable performance to GPT-5.2 and Gemini-3.0-Pro, establishing itself as a highly cost-effective architecture for complex reasoning tasks.

• 推理：通过扩展推理 token, DeepSeek-V4-Pro-Max 在标准推理基准上展示了相对于 GPT-5.2 和 Gemini-3.0-Pro 的优越性能。然而, 其性能略逊于 GPT-5.4 和 Gemini-3.1-Pro, 表明其发展轨迹比最先进的前沿模型落后约 3 到 6 个月。此外, DeepSeek-V4-Flash-Max 达到了与 GPT-5.2 和 Gemini-3.0-Pro 相当的性能, 确立了自己作为复杂推理任务的高性价比架构。

> 译者注: "落后前沿模型 3-6 个月"是一个坦诚的自我评估。按论文时间线(2025 年 4 月发布), 3-6 个月的差距意味着 V4-Pro-Max 大致相当于 2024 年底到 2025 年初的闭源模型水平。这反映了开源社区在计算资源和数据获取上的结构性劣势——即使是 DeepSeek 这样资金充裕的团队, 也难以完全追平 OpenAI 和 Google 的前沿模型。

• Agent: On public benchmarks, DeepSeek-V4-Pro-Max is on par with leading open-source models, such as Kimi-K2.6 and GLM-5.1, but slightly worse than frontier closed models. In our internal evaluation, DeepSeek-V4-Pro-Max outperforms Claude Sonnet 4.5 and approaches the level of Opus 4.5.

• 智能体：在公共基准上, DeepSeek-V4-Pro-Max 与领先的开源模型(如 Kimi-K2.6 和 GLM-5.1)相当, 但略逊于前沿闭源模型。在我们的内部评估中, DeepSeek-V4-Pro-Max 超越了 Claude Sonnet 4.5, 并接近 Opus 4.5 的水平。

• Long-Context: DeepSeek-V4-Pro-Max delivers strong results on synthetic and real use cases with a 1-million-token context window, surpassing even Gemini-3.1-Pro on academic benchmarks.

• 长上下文：DeepSeek-V4-Pro-Max 在合成和真实用例中具有一百万 token 上下文窗口的强大表现, 在学术基准上甚至超越了 Gemini-3.1-Pro。

• DeepSeek-V4-Pro v.s. DeepSeek-V4-Flash: DeepSeek-V4-Flash-Max exhibits lower performance in knowledge evaluations due to its smaller parameter scale. However, it achieves comparable results on reasoning tasks when allocated a larger thinking budget. In agent evaluations, while DeepSeek-V4-Flash-Max matches the performance of DeepSeek-V4-Pro-Max on several benchmarks, it still trails its larger counterpart on more complex, high-difficulty tasks.

• DeepSeek-V4-Pro 对比 DeepSeek-V4-Flash：DeepSeek-V4-Flash-Max 由于参数规模较小, 在知识评估中表现较低。然而, 当分配更大的思考预算时, 它在推理任务上取得了可比较的结果。在智能体评估中, 虽然 DeepSeek-V4-Flash-Max 在几个基准上与 DeepSeek-V4-Pro-Max 表现相当, 但在更复杂、高难度的任务上仍然落后于其更大的对应模型。

## 2. Architecture

## 2. 架构

Overall, DeepSeek-V4 series retain the Transformer (Vaswani et al., 2017) architecture and Multi-Token Prediction (MTP) modules (DeepSeek-AI, 2024; Gloeckle et al., 2024), while introducing several key upgrades over DeepSeek-V3: (1) firstly, we introduce the Manifold-Constrained Hyper-Connections (mHC) (Xie et al., 2026) to strengthen conventional residual connections; (2) secondly, we design a hybrid attention architecture, which greatly improves long-context efficiency through Compressed Sparse Attention and Heavily Compressed Attention. (3) thirdly, we employ Muon (Jordan et al., 2024; Liu et al., 2025) as the optimizer. For the Mixture-of-Experts (MoE) components, we still adopt the DeepSeekMoE (Dai et al., 2024) architecture, with only minor adjustments from DeepSeek-V3. The Multi-Token Prediction (MTP) (DeepSeek-AI, 2024; Gloeckle et al., 2024; Li et al., 2024; Qi et al., 2020) configuration remains identical to that of DeepSeek-V3. All other unspecified details follow the settings established in DeepSeek-V3 (DeepSeek-AI, 2024). Figure 2 illustrates the overall architecture of DeepSeek-V4, and the details are described below.

总体而言, DeepSeek-V4 系列保留了 Transformer (Vaswani et al., 2017) 架构和多 Token 预测 (MTP) 模块 (DeepSeek-AI, 2024; Gloeckle et al., 2024), 同时引入了相对于 DeepSeek-V3 的几项关键升级：(1) 首先, 我们引入流形约束超连接 (mHC) (Xie et al., 2026) 来增强传统的残差连接; (2) 其次, 我们设计了混合注意力架构, 通过压缩稀疏注意力和重度压缩注意力大幅提高长上下文效率; (3) 第三, 我们采用 Muon (Jordan et al., 2024; Liu et al., 2025) 作为优化器。对于混合专家 (MoE) 组件, 我们仍然采用 DeepSeekMoE (Dai et al., 2024) 架构, 仅对 DeepSeek-V3 做了微小调整。多 Token 预测 (MTP) (DeepSeek-AI, 2024; Gloeckle et al., 2024; Li et al., 2024; Qi et al., 2020) 配置与 DeepSeek-V3 保持一致。所有其他未指定的细节遵循 DeepSeek-V3 (DeepSeek-AI, 2024) 中建立的设置。图 2 展示了 DeepSeek-V4 的整体架构, 细节描述如下。

> 译者注: V4 的架构升级策略非常清晰：保留经过验证的组件(Transformer、MTP、DeepSeekMoE), 替换有明确改进空间的组件(残差连接 → mHC, 标准注意力 → CSA/HCA, AdamW → Muon)。这种"最小改动、最大收益"的进化策略与 V2→V3→V3.2 一脉相承。值得注意的是, MoE 架构仅做了"微小调整"(激活函数从 Sigmoid 改为 Sqrt(Softplus), Hash 路由用于初始层), 说明 DeepSeek 对 MoE 设计已经非常自信。

### 2.1. Designs Inherited from DeepSeek-V3

### 2.1. 继承自 DeepSeek-V3 的设计

Mixture-of-Experts. As previous DeepSeek-series models (DeepSeek-AI, 2024; DeepSeek-AI, 2024), DeepSeek-V4 series also adopt the DeepSeekMoE paradigm (Dai et al., 2024) for Feed-Forward Networks (FFNs), which sets fine-grained routed experts and shared experts. Different from DeepSeek-V3, we change the activation function that computes the affinity scores from Sigmoid(·) into Sqrt(Softplus(·)). For load balancing, we also employ the auxiliary-loss-free strategy (DeepSeek-AI, 2024; Wang et al., 2024a), augmented by a slight sequence-wise balance loss that prevents极端 imbalance within individual sequences. For DeepSeek-V4, we remove the constraint on the number of routing target nodes, and carefully redesign the parallelism strategy to maintain training efficiency. Furthermore, compared with DeepSeek-V3, we replace the dense FFN layers in the initial several Transformer blocks with MoE layers that employ Hash routing (Roller et al., 2021). The Hash routing strategy determines the target experts of each token according to a predefined hash function with regard to the input token ID.

混合专家。与之前的 DeepSeek 系列模型 (DeepSeek-AI, 2024; DeepSeek-AI, 2024) 一样, DeepSeek-V4 系列也采用 DeepSeekMoE 范式 (Dai et al., 2024) 用于前馈网络 (FFN), 设置细粒度路由专家和共享专家。与 DeepSeek-V3 不同, 我们将计算亲和分数的激活函数从 Sigmoid(·) 改为 Sqrt(Softplus(·))。对于负载均衡, 我们也采用无辅助损失策略 (DeepSeek-AI, 2024; Wang et al., 2024a), 并辅以轻微的序列级平衡损失以防止单个序列内的极端不平衡。对于 DeepSeek-V4, 我们移除了对路由目标节点数量的约束, 并仔细重新设计了并行策略以保持训练效率。此外, 与 DeepSeek-V3 相比, 我们用采用 Hash 路由 (Roller et al., 2021) 的 MoE 层替换了初始几个 Transformer 块中的稠密 FFN 层。Hash 路由策略根据预定义的哈希函数和输入 token ID 来确定每个 token 的目标专家。

> 译者注: MoE 的几个微调值得关注：
1. **Sqrt(Softplus)** 替代 Sigmoid：Softplus 是 ReLU 的平滑版本, sqrt 操作可能有助于控制亲和分数的尺度。这个改动很小, 但可能影响路由的稀疏性。
2. **Hash 路由用于初始层**：这是一个有趣的工程选择。传统 MoE 用可学习的路由网络, Hash 路由是确定性的(基于 token ID 的哈希)。将 Hash 路由用于初始层可以减少早期层的计算开销, 因为初始层通常处理的是更通用的特征, 不需要复杂的路由决策。

Multi-Token Prediction. As DeepSeek-V3, DeepSeek-V4 series also set MTP modules and objectives. Given that the MTP strategy has been validated in DeepSeek-V3, we adopt the same strategy for DeepSeek-V4 series without modification.

多 Token 预测。与 DeepSeek-V3 一样, DeepSeek-V4 系列也设置了 MTP 模块和目标。鉴于 MTP 策略已在 DeepSeek-V3 中得到验证, 我们对 DeepSeek-V4 系列采用相同的策略, 不做修改。


### 2.2. Manifold-Constrained Hyper-Connections

### 2.2. 流形约束超连接

As shown in Figure 2, DeepSeek-V4 series incorporate Manifold-Constrained Hyper-Connections (mHC) (Xie et al., 2026) to strengthen the conventional residual connections between adjacent Transformer blocks. Compared with naive Hyper-Connections (HC) (Zhu et al., 2025), the core idea of mHC is to constrain the residual mapping onto a specific manifold, and thus enhance the stability of signal propagation across layers while preserving model expressivity. This subsection briefly introduces the standard HC and describes how we design mHC for stable training.

如图 2 所示, DeepSeek-V4 系列引入流形约束超连接 (mHC) (Xie et al., 2026) 来强化相邻 Transformer 块之间的传统残差连接。与朴素的超连接 (HC) (Zhu et al., 2025) 相比, mHC 的核心思想是将残差映射约束到特定的流形上, 从而在保持模型表达能力的同时增强跨层信号传播的稳定性。本小节简要介绍标准 HC, 并描述我们如何设计 mHC 以实现稳定训练。

> 译者注: mHC 是 Hyper-Connections 的改进版本, 核心改进在于通过数学约束(双随机矩阵流形)解决原始 HC 在深层堆叠时的数值不稳定性问题。这是一个典型的"理论驱动工程"案例——先发现问题(HC 训练不稳定), 再用数学工具(Birkhoff 多面体、Sinkhorn-Knopp 算法)给出解决方案。值得注意的是, mHC 的动态参数化(输入依赖 + 输入无关组件)与门控机制, 与 DeepSeek 在 MoE 路由中的设计哲学一脉相承。

Standard Hyper-Connections. The standard HC expands the width of the residual stream by a factor of $n _ { \mathrm { h c } } .$ . Specifically, the shape of the residual stream is expanded from $\mathbb { R } ^ { d }$ to $\mathbb { R } ^ { n _ { \mathrm { h c } } \times d }$ where ?? is the hidden size of the actual layer input. Let $X _ { l } = [ \mathbf { x } _ { l , 1 } ; \ldots ; \mathbf { x } _ { l , n _ { \mathrm { h c } } } ] ^ { T } \in \mathbb { R } ^ { n _ { \mathrm { h c } } \times d }$ be the residual state before the ??-th layer. HC introduces three线性映射: an input mapping $A _ { l } \in \mathbb { R } ^ { 1 \times n _ { \mathrm { h c } } }$ , a residual transformation $B _ { l } \in \mathbb { R } ^ { n _ { \mathrm { h c } } \times n _ { \mathrm { h c } } }$ , and an output mapping $\bar { C _ { l } } \bar { \in } \mathbb { R } ^ { n _ { \mathrm { h c } } \times \hat { 1 } }$ . The update of the residual state is then formulated as:

标准超连接。标准 HC 将残差流的宽度扩展 $n _ { \mathrm { h c } }$ 倍。具体而言, 残差流的形状从 $\mathbb { R } ^ { d }$ 扩展到 $\mathbb { R } ^ { n _ { \mathrm { h c } } \times d }$, 其中 ?? 是实际层输入的隐藏大小。令 $X _ { l } = [ \mathbf { x } _ { l , 1 } ; \ldots ; \mathbf { x } _ { l , n _ { \mathrm { h c } } } ] ^ { T } \in \mathbb { R } ^ { n _ { \mathrm { h c } } \times d }$ 为第 ?? 层之前的残差状态。HC 引入三个线性映射：输入映射 $A _ { l } \in \mathbb { R } ^ { 1 \times n _ { \mathrm { h c } } }$、残差变换 $B _ { l } \in \mathbb { R } ^ { n _ { \mathrm { h c } } \times n _ { \mathrm { h c } } }$ 和输出映射 $\bar { C _ { l } } \bar { \in } \mathbb { R } ^ { n _ { \mathrm { h c } } \times \hat { 1 } }$。残差状态的更新公式为：

$$
X _ { l + 1 } = B _ { l } X _ { l } + C _ { l } { \mathcal { F } } _ { l } ( A _ { l } X _ { l } ) ,\tag{1}
$$

where $\mathcal { F } _ { l }$ denotes the ??-th layer $( \mathrm { e . g . } ,$ an MoE layer), whose input and output shapes are both $\mathbb { R } ^ { d }$ . Note that the actual layer input $A _ { l } X _ { l } \in \mathbb { R } ^ { d }$ is also ??-dimensional, so the expanded residual width does not influence the design of the inner layers. HC decouples the residual width from the actual hidden size, offering a complementary scaling axis with minimal computational overhead, as $n _ { \mathrm { h c } }$ is typically much smaller than the hidden size ??. However, even though HC has demonstrated potential in improving model performance, we find that the training will frequently exhibit numerical instability when stacking multiple layers, which hinders the scaling of HC.

其中 $\mathcal { F } _ { l }$ 表示第 ?? 层(例如, 一个 MoE 层), 其输入和输出形状均为 $\mathbb { R } ^ { d }$。注意实际层输入 $A _ { l } X _ { l } \in \mathbb { R } ^ { d }$ 也是 ?? 维的, 因此扩展的残差宽度不影响内部层的设计。HC 将残差宽度与实际隐藏大小解耦, 提供了一个补充的扩展维度, 且计算开销极小, 因为 $n _ { \mathrm { h c } }$ 通常远小于隐藏大小 ??。然而, 尽管 HC 在提升模型性能方面已展现出潜力, 我们发现当堆叠多层时训练会频繁出现数值不稳定性, 这阻碍了 HC 的扩展。

Manifold-Constrained Residual Mapping. The core innovation of mHC is to constrain the residual mapping matrix $B _ { l }$ to the manifold of doubly stochastic matrices (the Birkhoff polytope) M, and thus enhance the stability of signal propagation across layers:

流形约束残差映射。mHC 的核心创新是将残差映射矩阵 $B _ { l }$ 约束到双随机矩阵流形(Birkhoff 多面体)$\mathcal{M}$ 上, 从而增强跨层信号传播的稳定性：

$$
B _ { l } \in { \mathcal { M } } : = \{ M \in \mathbb { R } ^ { n \times n } ~ | ~ M { \bf 1 } _ { n } = { \bf 1 } _ { n } , ~ { \bf 1 } _ { n } ^ { T } M = { \bf 1 } _ { n } ^ { T } , ~ M \geqslant 0 \} .\tag{2}
$$

This constraint ensures that the spectral norm of the mapping matrix $\| B _ { l } \| _ { 2 }$ is bounded by 1, so the residual transformation is non-expansive, which increases the numerical stability during both the forward pass and backpropagation. Besides, the set M is closed under multiplication, which guarantees stability in the scenarios of deep stacks of mHC. In addition, the input transformation $A _ { l }$ and output transformation $C _ { l }$ are also constrained to be non-negative and bounded via a Sigmoid function to avoid the risk of signal cancellation.

该约束确保映射矩阵的谱范数 $\| B _ { l } \| _ { 2 }$ 被限制在 1 以内, 因此残差变换是非扩张的, 这增加了前向传播和反向传播期间的数值稳定性。此外, 集合 $\mathcal{M}$ 在乘法下封闭, 这保证了 mHC 深层堆叠场景下的稳定性。另外, 输入变换 $A _ { l }$ 和输出变换 $C _ { l }$ 也通过 Sigmoid 函数约束为非负且有界, 以避免信号抵消的风险。

Dynamic Parameterization. The parameters of three linear mappings are dynamically generated, which are decomposed into a dynamic (input-dependent) component and a static (input-independent) component. Given the input $\bar { X _ { l } } \in \mathbb { R } ^ { n _ { \mathrm { h c } } \times d }$ , it is first flattened and normalized: $\hat { X } _ { l } = \mathrm { R M S N o r m } ( \mathrm { v e c } ( \bar { X _ { l } } ) ) \in \mathbb { R } ^ { 1 \times n _ { \mathrm { h c } } d }$ . Then, we follow the conventional HC to generate the unconstrained raw parameters $\tilde { A } _ { l } \in \mathbb { R } ^ { 1 \times n _ { \mathrm { h c } } } , \tilde { B } _ { l } \in \mathbb { R } ^ { n _ { \mathrm { h c } } \times n _ { \mathrm { h c } } }$ , and $\tilde { C } _ { l } \in \mathbb { R } ^ { n _ { \mathrm { h c } } \times 1 }$ :

动态参数化。三个线性映射的参数是动态生成的, 分解为动态(输入依赖)分量和静态(输入无关)分量。给定输入 $\bar { X _ { l } } \in \mathbb { R } ^ { n _ { \mathrm { h c } } \times d }$, 首先将其展平并归一化：$\hat { X } _ { l } = \mathrm { R M S N o r m } ( \mathrm { v e c } ( \bar { X _ { l } } ) ) \in \mathbb { R } ^ { 1 \times n _ { \mathrm { h c } } d }$。然后, 我们遵循传统 HC 生成无约束的原始参数 $\tilde { A } _ { l } \in \mathbb { R } ^ { 1 \times n _ { \mathrm { h c } } }$、$\tilde { B } _ { l } \in \mathbb { R } ^ { n _ { \mathrm { h c } } \times n _ { \mathrm { h c } } }$ 和 $\tilde { C } _ { l } \in \mathbb { R } ^ { n _ { \mathrm { h c } } \times 1 }$：

$$
\tilde { A } _ { l } = \alpha _ { l } ^ { \mathrm { p r e } } \cdot ( \hat { X } _ { l } W _ { l } ^ { \mathrm { p r e } } ) + S _ { l } ^ { \mathrm { p r e } } ,\tag{3}
$$

$$
\tilde { B } _ { l } = \alpha _ { l } ^ { \mathrm { r e s } } \cdot \mathrm { M a t } ( \hat { X } _ { l } W _ { l } ^ { \mathrm { r e s } } ) + S _ { l } ^ { \mathrm { r e s } } ,\tag{4}
$$

$$
\tilde { C } _ { l } = \alpha _ { l } ^ { \mathrm { p o s t } } \cdot ( \hat { X } _ { l } W _ { l } ^ { \mathrm { p o s t } } ) ^ { T } + S _ { l } ^ { \mathrm { p o s t } } ,\tag{5}
$$

where $W _ { \jmath } ^ { \mathrm { p r e } } , W _ { \jmath } ^ { \mathrm { p o s t } } \in \mathbb { R } ^ { n _ { \mathrm { h c } } d \times n _ { \mathrm { h c } } }$ and $W _ { l } ^ { \mathrm { r e s } } \in \mathbb { R } ^ { n _ { \mathrm { h c } } d \times n _ { \mathrm { h c } } ^ { 2 } }$ are learnable parameters for generating the dynamic components; Mat(·) reshapes a vector of size $1 \times n _ { \mathrm { h c } } ^ { 2 }$ into a matrix of size $n _ { \mathrm { h c } } \times n _ { \mathrm { h c } } ;$ $S _ { l } ^ { \mathrm { p r e } } \in \mathbb { R } ^ { 1 \times n _ { \mathrm { h c } } } , S _ { l } ^ { \mathrm { p o s t } } \in \mathbb { R } ^ { n _ { \mathrm { h c } } \times 1 }$ , and $S _ { \boldsymbol { I } } ^ { \mathrm { r e s } } \in \mathbb { R } ^ { n _ { \mathrm { h c } } \times n _ { \mathrm { h c } } }$ are learnable static biases; and $\alpha _ { l } ^ { \mathrm { p r e } } , \alpha _ { l } ^ { \mathrm { r e s } } , \alpha _ { l } ^ { \mathrm { p o s t } } \in \mathbb { R }$ are learnable gating factors initialized to small values.

其中 $W _ { \jmath } ^ { \mathrm { p r e } } , W _ { \jmath } ^ { \mathrm { p o s t } } \in \mathbb { R } ^ { n _ { \mathrm { h c } } d \times n _ { \mathrm { h c } } }$ 和 $W _ { l } ^ { \mathrm { r e s } } \in \mathbb { R } ^ { n _ { \mathrm { h c } } d \times n _ { \mathrm { h c } } ^ { 2 } }$ 是用于生成动态分量的可学习参数; Mat(·) 将大小为 $1 \times n _ { \mathrm { h c } } ^ { 2 }$ 的向量重塑为大小为 $n _ { \mathrm { h c } } \times n _ { \mathrm { h c } }$ 的矩阵; $S _ { l } ^ { \mathrm { p r e } } \in \mathbb { R } ^ { 1 \times n _ { \mathrm { h c } } }$、$S _ { l } ^ { \mathrm { p o s t } } \in \mathbb { R } ^ { n _ { \mathrm { h c } } \times 1 }$ 和 $S _ { \boldsymbol { I } } ^ { \mathrm { r e s } } \in \mathbb { R } ^ { n _ { \mathrm { h c } } \times n _ { \mathrm { h c } } }$ 是可学习的静态偏置; $\alpha _ { l } ^ { \mathrm { p r e } } , \alpha _ { l } ^ { \mathrm { r e s } } , \alpha _ { l } ^ { \mathrm { p o s t } } \in \mathbb { R }$ 是初始化为小值的可学习门控因子。

Applying Parameter Constraints. After obtaining the unconstrained raw parameters $\tilde { A } _ { l } , \tilde { B } _ { l } , \tilde { C } _ { l } ,$ we then apply constraints described earlier to them to enhance the numerical stability. To be specific, for the input and output mappings, we employ a Sigmoid function $\sigma ( \cdot )$ to ensure their non-negativity and boundedness:

应用参数约束。获得无约束原始参数 $\tilde { A } _ { l } , \tilde { B } _ { l } , \tilde { C } _ { l }$ 后, 我们对它们应用前述约束以增强数值稳定性。具体而言, 对于输入和输出映射, 我们采用 Sigmoid 函数 $\sigma ( \cdot )$ 确保其非负性和有界性：

$$
A _ { l } = \sigma ( \tilde { A } _ { l } ) ,\tag{6}
$$

$$
C _ { l } = 2 \sigma ( \tilde { C } _ { l } ) .\tag{7}
$$

As for the residual mapping $\tilde { B } _ { l } ,$ , we project it onto the manifold of doubly stochastic matrices M. This is achieved by the Sinkhorn-Knopp algorithm, which first applies an exponential function to $\tilde { B } _ { l }$ to ensure positivity, getting $M ^ { ( 0 ) } = \exp ( \tilde { B } _ { l } )$ , and then iteratively performs column and row normalization:

对于残差映射 $\tilde { B } _ { l }$, 我们将其投影到双随机矩阵流形 $\mathcal{M}$ 上。这通过 Sinkhorn-Knopp 算法实现：首先对 $\tilde { B } _ { l }$ 应用指数函数以确保正性, 得到 $M ^ { ( 0 ) } = \exp ( \tilde { B } _ { l } )$, 然后迭代执行列和行归一化：

$$
\boldsymbol { M } ^ { ( t ) } = \mathcal { T } ( \mathcal { T } _ { c } ( \boldsymbol { M } ^ { ( t - 1 ) } ) ) ,\tag{8}
$$

where $\mathcal { T } _ { r }$ and $\mathcal { T } _ { c }$ denote row and column normalization, respectively. This iteration converges to a constrained doubly stochastic matrix $B _ { l } = M ^ { ( t _ { \operatorname* { m a x } } ) }$ . We choose $t _ { \mathrm { m a x } } = 2 0$ as a practical value.

其中 $\mathcal { T } _ { r }$ 和 $\mathcal { T } _ { c }$ 分别表示行归一化和列归一化。该迭代收敛到一个受约束的双随机矩阵 $B _ { l } = M ^ { ( t _ { \operatorname* { m a x } } )}$。我们选择 $t _ { \mathrm { m a x } } = 2 0$ 作为实用值。

> 译者注: Sinkhorn-Knopp 算法是计算最优传输问题的经典迭代方法, 这里被巧妙地用于将任意矩阵投影到双随机矩阵集合。选择 20 步迭代是一个工程权衡——足够接近收敛, 又不会引入过多的计算开销。值得注意的细节是：1) 输入/输出映射使用 Sigmoid(输出范围 [0,1] 和 [0,2]), 而残差映射使用双随机约束; 2) 动态分量通过输入状态生成, 使每个 token 都能获得定制的残差路径, 这增加了模型的表达能力但保持计算高效。

### 2.3. Hybrid Attention with CSA and HCA

### 2.3. 基于 CSA 和 HCA 的混合注意力

As the context length reaches extreme scales, the attention mechanism emerges as the dominant computational bottleneck in a model. For DeepSeek-V4, we design two efficient attention architectures — Compressed Sparse Attention (CSA) and Heavily Compressed Attention (HCA) — and employ their interleaved hybrid configuration, which substantially reduces the computational cost of attention in long-text scenarios. CSA integrates both compression and sparse attention strategies: it first compresses the Key-Value (KV) cache of every ?? tokens into one entry, and then applies DeepSeek Sparse Attention (DSA) (DeepSeek-AI, 2025) where each query token attends to only ?? compressed KV entries. HCA aims for extreme compression by consolidating the KV cache of every ??′ (≫ ??) tokens into a single entry. The hybrid architecture of CSA and HCA remarkably improves the long-context efficiency of DeepSeek-V4 series, making one-million-token context feasible in practice. This subsection describes the core techniques of our hybrid attention architecture, and we also provide an open-source implementation1 to specify more details unambiguously.

当上下文长度达到极端规模时, 注意力机制成为模型中主导的计算瓶颈。对于 DeepSeek-V4, 我们设计了两种高效的注意力架构——压缩稀疏注意力 (CSA) 和重度压缩注意力 (HCA)——并采用它们的交错混合配置, 大幅降低了长文本场景中注意力的计算成本。CSA 结合了压缩和稀疏注意力策略：首先将每 ?? 个 token 的键值 (KV) 缓存压缩为一个 entry, 然后应用 DeepSeek 稀疏注意力 (DSA) (DeepSeek-AI, 2025), 其中每个查询 token 只关注 ?? 个压缩 KV entry。HCA 旨在通过将每 ??′ (≫ ??) 个 token 的 KV 缓存合并为单个 entry 来实现极端压缩。CSA 和 HCA 的混合架构显著提高了 DeepSeek-V4 系列的长上下文效率, 使百万 token 上下文在实践中可行。本小节描述我们混合注意力架构的核心技术, 我们还提供了开源实现以明确更多细节。

> 译者注: 混合注意力是 V4 最核心的架构创新。CSA 和 HCA 的"交错混合配置"意味着模型在不同层使用不同的注意力类型——某些层用 CSA(压缩+稀疏), 某些层用 HCA(仅重度压缩)。这种设计反映了 DeepSeek 对注意力任务的深刻理解：并非所有层都需要同等的注意力精度。浅层可能更需要局部细节(HCA 的稠密注意力), 深层可能更需要全局筛选(CSA 的稀疏注意力)。值得注意的是, 论文明确提到"开源实现", 这与 DeepSeek 一贯的开放策略一致。

#### 2.3.1. Compressed Sparse Attention

#### 2.3.1. 压缩稀疏注意力

The core architecture of CSA is illustrated in Figure 3, which first compresses the KV cache of each ?? tokens into one entry, and then applies DeepSeek Sparse Attention for further acceleration.

CSA 的核心架构如图 3 所示, 首先将每 ?? 个 token 的 KV 缓存压缩为一个 entry, 然后应用 DeepSeek 稀疏注意力以进一步加速。

Compressed Key-Value Entries. Let $H \in \mathbb { R } ^ { n \times d }$ be a sequence of input hidden states, where ?? is the sequence length and ?? is the hidden size. CSA first computes two series of KV entries $C ^ { a } , C ^ { b } \in \mathbb { R } ^ { \bar { n } \times c }$ and their corresponding compression weights $Z ^ { a } , { \bar { Z } } ^ { b } \in \mathbb { R } ^ { n \times c }$ , where ?? is the head dimension:

压缩键值 Entry。令 $H \in \mathbb { R } ^ { n \times d }$ 为输入隐藏状态序列, 其中 ?? 为序列长度, ?? 为隐藏大小。CSA 首先计算两组 KV entry $C ^ { a } , C ^ { b } \in \mathbb { R } ^ { \bar { n } \times c }$ 及其对应的压缩权重 $Z ^ { a } , { \bar { Z } } ^ { b } \in \mathbb { R } ^ { n \times c }$, 其中 ?? 为 head 维度：

$$
C ^ { a } = H \cdot W ^ { a K V } , \quad C ^ { b } = H \cdot W ^ { b K V } ,\tag{9}
$$

$$
Z ^ { a } = H \cdot W ^ { a Z } , ~ Z ^ { b } = H \cdot W ^ { b Z } ,\tag{10}
$$

where $W ^ { a K V } , W ^ { b K V } , W ^ { a Z } , W ^ { b Z } \in \mathbb { R } ^ { d \times c }$ are trainable parameters. Next, each ?? KV entries in $C ^ { a }$ and $C ^ { b }$ will be compressed into one entry according to their compression weights and learnable positional biases $B ^ { a } , B ^ { b } \in \mathbb { R } ^ { m \times c }$ , producing $C ^ { \mathsf { C o m p } } \in \mathbb { R } ^ { \frac { n } { m } \times c }$ . Each compressed entry $C _ { i } ^ { \mathrm { C o m p } } \in \mathbb { R } ^ { c }$ is computed by

其中 $W ^ { a K V } , W ^ { b K V } , W ^ { a Z } , W ^ { b Z } \in \mathbb { R } ^ { d \times c }$ 为可训练参数。接下来, $C ^ { a }$ 和 $C ^ { b }$ 中每 ?? 个 KV entry 将根据其压缩权重和可学习的位置偏置 $B ^ { a } , B ^ { b } \in \mathbb { R } ^ { m \times c }$ 压缩为一个 entry, 生成 $C ^ { \mathsf { C o m p } } \in \mathbb { R } ^ { \frac { n } { m } \times c }$。每个压缩 entry $C _ { i } ^ { \mathrm { C o m p } } \in \mathbb { R } ^ { c }$ 的计算方式为

$$
\begin{array} { r } { [ S _ { m i : m ( i + 1 ) - 1 } ^ { a } ; S _ { m ( i - 1 ) : m i - 1 } ^ { b } ] = \mathrm { { S o f t m a x } _ { r o w } } ( [ Z _ { m i : m ( i + 1 ) - 1 } ^ { a } + B ^ { a } ; Z _ { m ( i - 1 ) : m i - 1 } ^ { b } + B ^ { b } ] ) , } \end{array}\tag{11}
$$

$$
C _ { i } ^ { \mathrm { C o m p } } = \sum _ { j = m i } ^ { m ( i + 1 ) - 1 } S _ { j } ^ { a } \odot C _ { j } ^ { a } + \sum _ { j = m ( i - 1 ) } ^ { m i - 1 } S _ { j } ^ { b } \odot C _ { j } ^ { b } ,\tag{12}
$$

where $\odot$ denotes the Hadamard product; $\mathrm { S o f t m a x } _ { \mathrm { r o w } } ( \cdot )$ denotes the softmax operation along the row dimension, which performs normalization across the total of 2?? elements from both $Z ^ { a }$ and $Z ^ { b }$ . When $i = 0 , Z _ { m ( i - 1 ) : m i - 1 } ^ { b }$ is padded with negative infinity and $C _ { m ( i - 1 ) : m i - 1 } ^ { b }$ is padded with zeros. Note that each $C _ { i } ^ { \mathrm { C o m p } }$ is derived from 2?? KV entries, but the indexes of $C ^ { b }$ used for $C _ { i } ^ { \mathrm { C o m p } }$ and the indexes of $C ^ { a }$ used for $C _ { i - 1 } ^ { \mathsf { C o m p } }$ are overlapped. Therefore, CSA in fact compresses the sequence length to $\frac { 1 } { m }$ times.

其中 $\odot$ 表示 Hadamard 积; $\mathrm { S o f t m a x } _ { \mathrm { r o w } } ( \cdot )$ 表示沿行维度的 softmax 操作, 对来自 $Z ^ { a }$ 和 $Z ^ { b }$ 的共 2?? 个元素进行归一化。当 $i = 0$ 时, $Z _ { m ( i - 1 ) : m i - 1 } ^ { b }$ 用负无穷填充, $C _ { m ( i - 1 ) : m i - 1 } ^ { b }$ 用零填充。注意每个 $C _ { i } ^ { \mathrm { C o m p } }$ 来自 2?? 个 KV entry, 但用于 $C _ { i } ^ { \mathrm { C o m p } }$ 的 $C ^ { b }$ 索引与用于 $C _ { i - 1 } ^ { \mathsf { C o m p } }$ 的 $C ^ { a }$ 索引存在重叠。因此, CSA 实际上将序列长度压缩到 $\frac { 1 } { m }$ 倍。

> 译者注: CSA 的压缩策略有一个精巧的设计细节：使用两组 KV entry ($C^a$ 和 $C^b$) 并让它们相邻块之间重叠($C^b$ 的当前块与 $C^a$ 的前一个块共享索引)。这种"滑动窗口式"的压缩确保了块边界处的信息不会丢失, 是一种在压缩率和信息保留之间的工程权衡。Softmax 沿行维度对 2m 个元素操作(来自两个序列的拼接), 这意味着每个压缩 entry 的权重是在局部窗口内竞争产生的。

Lightning Indexer for Sparse Selection. After obtaining the compressed KV entries $C ^ { \mathrm { C o m p } }$ , CSA applies the DSA strategy to select top-k compressed KV entries for core attention. First, CSA performs the same compression operation used for $C ^ { \mathrm { C o m p } }$ to get compressed indexer keys $K ^ { \mathrm { I C o m } { \bar { \mathrm { p } } } } \in \mathbb { R } ^ { { \frac { n } { m } } \times c ^ { I } }$ , where $c ^ { I }$ is the indexer head dimension. Then, for a query token ??, we produce the indexer queries $\{ \mathbf { q } _ { t , 1 } ^ { I } ; \mathbf { q } _ { t , 2 } ^ { I } ; . . . ; \mathbf { q } _ { t , n _ { h } ^ { I } } ^ { I } \}$ in a low-rank manner:

闪电索引器用于稀疏选择。获得压缩 KV entry $C ^ { \mathrm { C o m p } }$ 后, CSA 应用 DSA 策略选择 top-k 压缩 KV entry 用于核心注意力。首先, CSA 对 $C ^ { \mathrm { C o m p } }$ 执行相同的压缩操作以获得压缩索引键 $K ^ { \mathrm { I C o m } { \bar { \mathrm { p } } } } \in \mathbb { R } ^ { { \frac { n } { m } } \times c ^ { I } }$, 其中 $c ^ { I }$ 为索引器 head 维度。然后, 对于查询 token ??, 我们以低秩方式生成索引查询 $\{ \mathbf { q } _ { t , 1 } ^ { I } ; \mathbf { q } _ { t , 2 } ^ { I } ; . . . ; \mathbf { q } _ { t , n _ { h } ^ { I } } ^ { I } \}$：

$$
\begin{array} { r } { \mathbf { c } _ { t } ^ { Q } = \mathbf { h } _ { t } \cdot W ^ { D Q } , } \end{array}\tag{13}
$$

$$
\begin{array} { r } { [ \ P _ { t , 1 } ^ { I } ; \ P _ { t , 2 } ^ { I } ; . . . ; \ P _ { t , n _ { h } ^ { I } } ^ { I } ] = \ P _ { t } ^ { I } = \mathbf { c } _ { t } ^ { Q } \cdot W ^ { I U Q } , } \end{array}\tag{14}
$$

where $\mathbf { h } _ { t } \ \in \ \mathbb { R } ^ { d }$ is the input hidden state of the query token ??; $\mathbf { c } _ { t } ^ { Q } \in \mathbb { R } ^ { d _ { c } }$ is the compressed latent vector for queries; $d _ { c }$ denotes the query compression dimension; $n _ { h } ^ { I }$ denotes the number of indexer query heads; $W ^ { D Q } \in \mathbb { R } ^ { d \times d _ { c } }$ and $W ^ { I U Q } \in \mathbb { R } ^ { d _ { c } \times c ^ { I } n _ { h } ^ { I } }$ are the down-projection and upprojection matrices for indexer queries, respectively. Next, the index score $I _ { t , s } \in \mathbb { R }$ between the query token ?? and a preceding compressed block $\hat { \cdot } ( s < \mathrm { F l o o r } ( \frac { t } { m } ) )$ is computed by

其中 $\mathbf { h } _ { t } \ \in \ \mathbb { R } ^ { d }$ 为查询 token ?? 的输入隐藏状态; $\mathbf { c } _ { t } ^ { Q } \in \mathbb { R } ^ { d _ { c } }$ 为查询的压缩潜向量; $d _ { c }$ 表示查询压缩维度; $n _ { h } ^ { I }$ 表示索引器查询 head 数; $W ^ { D Q } \in \mathbb { R } ^ { d \times d _ { c } }$ 和 $W ^ { I U Q } \in \mathbb { R } ^ { d _ { c } \times c ^ { I } n _ { h } ^ { I } }$ 分别为索引器查询的下投影和上投影矩阵。接下来, 查询 token ?? 与前面的压缩块 $\hat { \cdot } ( s < \mathrm { F l o o r } ( \frac { t } { m } ) )$ 之间的索引分数 $I _ { t , s } \in \mathbb { R }$ 计算如下：

$$
\begin{array} { r } { [ { w _ { t , 1 } ^ { I } } ; { w _ { t , 2 } ^ { I } } ; . . . ; { w _ { t , { n _ { h } ^ { I } } } ^ { I } } ] = \mathbf { w } _ { t } ^ { I } = \mathbf { h } _ { t } \cdot W ^ { w } , } \end{array}\tag{15}
$$

$$
I _ { t , s } = \sum _ { h = 1 } ^ { n _ { h } ^ { I } } \boldsymbol { w } _ { t , h } ^ { I } \cdot \mathrm { R e L U } \left( \mathbf { q } _ { t , h } ^ { I } \cdot K _ { s } ^ { \mathrm { I C o m p } } \right) ,\tag{16}
$$

where $W ^ { w } \in \mathbb { R } ^ { d \times n _ { h } ^ { I } }$ is a learnable matrix; $w _ { t , h } ^ { I } \in \mathbb { R }$ is the weight of the ℎ-th indexer head. For a query token ??, given its index scores $I _ { t , : } ,$ we employ a top-k selector to selectively retain a subset of compressed KV entries $C _ { t } ^ { \mathsf { S p r s C o m p } }$ for subsequent core attention:

其中 $W ^ { w } \in \mathbb { R } ^ { d \times n _ { h } ^ { I } }$ 为可学习矩阵; $w _ { t , h } ^ { I } \in \mathbb { R }$ 为第 ℎ 个索引器 head 的权重。对于查询 token ??, 给定其索引分数 $I _ { t , : }$, 我们采用 top-k 选择器有选择地保留一部分压缩 KV entry $C _ { t } ^ { \mathsf { S p r s C o m p } }$ 用于后续核心注意力：

$$
C _ { t } ^ { S \mathrm { p r s C o m p } } = \left\{ C _ { s } ^ { \mathrm { C o m p } } \ : \middle| \ : I _ { t , s } \in \mathrm { T o p - k } ( I _ { t , : } ) \right\} .\tag{17}
$$

> 译者注: "Lightning Indexer"(闪电索引器)是 CSA 的核心创新之一, 其设计目标是高效地从海量压缩 KV 中筛选出相关的块。关键工程细节包括：1) 索引器使用低秩分解(先下投影到 $d_c$ 维, 再上投影到索引维度), 大幅降低计算量; 2) 索引分数使用 ReLU 而非 Softmax, 这意味着分数可以为零(表示完全不相关), 提供了更稀疏的选择信号; 3) 每个索引 head 有独立的学习权重 $w_{t,h}^I$, 允许模型学习多视角的筛选策略。这与 V3.2 的 DSA 索引机制一脉相承, 但针对压缩后的 KV 做了适配。

Shared Key-Value MQA. After selecting the sparse KV entries, CSA then performs core attention in a Multi-Query Attention (MQA) (Shazeer, 2019) manner, where each compressed KV entry in $C _ { t } ^ { \mathsf { S p r s C o m p } }$ serves as both attention key and value. To be specific, for a query token $t ,$ we first produce attention queries $\{ \mathbf { q } _ { t , 1 } ; \mathbf { q } _ { t , 2 } ; . . . ; \mathbf { q } _ { t , n _ { h } } \}$ from the compressed latent vector $\mathbf { c } _ { t } ^ { Q } ;$

共享键值 MQA。选择稀疏 KV entry 后, CSA 以多查询注意力 (MQA) (Shazeer, 2019) 方式执行核心注意力, 其中 $C _ { t } ^ { \mathsf { S p r s C o m p } }$ 中的每个压缩 KV entry 同时作为注意力键和值。具体而言, 对于查询 token $t$, 我们首先从压缩潜向量 $\mathbf { c } _ { t } ^ { Q }$ 生成注意力查询 $\{ \mathbf { q } _ { t , 1 } ; \mathbf { q } _ { t , 2 } ; . . . ; \mathbf { q } _ { t , n _ { h } } \}$：

$$
[ \mathbf { q } _ { t , 1 } ; \mathbf { q } _ { t , 2 } ; . . . ; \mathbf { q } _ { t , n _ { h } } ] = \mathbf { q } _ { t } = \mathbf { c } _ { t } ^ { Q } \cdot W ^ { U Q } ,\tag{18}
$$

where $n _ { h }$ denotes the number of query heads; $W ^ { U Q } \in \mathbb { R } ^ { d _ { c } \times c n _ { h } }$ is the up-projection matrices for queries. Note that the latent query vector $\mathbf { c } _ { t } ^ { Q }$ is shared with that used for the indexer queries. Next, we perform MQA on $\{ \pmb q _ { t , i } \}$ and $C _ { t } ^ { \mathsf { S p r s C o m p } }$ :

其中 $n _ { h }$ 表示查询 head 数; $W ^ { U Q } \in \mathbb { R } ^ { d _ { c } \times c n _ { h } }$ 为查询的上投影矩阵。注意潜查询向量 $\mathbf { c } _ { t } ^ { Q }$ 与索引器查询中使用的向量共享。接下来, 我们对 $\{ \pmb q _ { t , i } \}$ 和 $C _ { t } ^ { \mathsf { S p r s C o m p } }$ 执行 MQA：

$$
\mathbf { o } _ { t , i } = \mathrm { C o r e A t t i n } \left( \mathtt { q u e r y } = \mathbf { q } _ { t , i } , \mathtt { k e y } = C _ { t } ^ { \mathrm { S p r s C o m p } } , \mathtt { v a l u e } = C _ { t } ^ { \mathrm { S p r s C o m p } } \right) ,\tag{19}
$$

where $\mathbf { o } _ { t , i } \in \mathbb { R } ^ { c }$ is the core attention output of the ??-th head at the ??-th token; CoreAttn(·) denotes the core attention operation.

其中 $\mathbf { o } _ { t , i } \in \mathbb { R } ^ { c }$ 为第 ?? 个 token 处第 ?? 个 head 的核心注意力输出; CoreAttn(·) 表示核心注意力操作。

Grouped Output Projection. In the configuration of DeepSeek-V4, $c n _ { h }$ is quite large. Therefore, directly projecting the outputs of the core attention operation $\left[ \mathbf { o } _ { t , 1 } ; \mathbf { o } _ { t , 2 } ; . . . ; \mathbf { o } _ { t , n _ { h } } \right] = \mathbf { o } _ { t } \in \mathbb { R } ^ { c n _ { h } }$ to a ??-dimensional hidden state will impose a substantial computational burden. To mitigate this cost, we design a grouped output projection strategy. To be specific, we first split $n _ { h }$ outputs into ?? groups, and then for each group of output ${ \bf o } _ { t , i } ^ { G } \in \mathbb { R } ^ { c \frac { n _ { h } } { g } }$ , we project it to a $d _ { g } .$ -dimensional intermediate output ${ \bf o } _ { t , i } ^ { G ^ { \prime } } \in \mathbb { R } ^ { d _ { g } }$ , where $d _ { g } \ < \ c \frac { n _ { h } } { g }$ . Finally, we project the intermediate output $[ \mathbf { o } _ { t , 1 } ^ { G ^ { \prime } } ; \mathbf { o } _ { t , 2 } ^ { G ^ { \prime } } ; . . . ; \mathbf { o } _ { t , g } ^ { G ^ { \prime } } ] \in \mathbb { R } ^ { d _ { g } g }$ to the final attention output $\hat { \mathbf { o } } _ { t } \in \mathbb { R } ^ { d }$

分组输出投影。在 DeepSeek-V4 的配置中, $c n _ { h }$ 相当大。因此, 直接将核心注意力操作的输出 $\left[ \mathbf { o } _ { t , 1 } ; \mathbf { o } _ { t , 2 } ; . . . ; \mathbf { o } _ { t , n _ { h } } \right] = \mathbf { o } _ { t } \in \mathbb { R } ^ { c n _ { h } }$ 投影到 ?? 维隐藏状态将带来大量计算负担。为缓解这一开销, 我们设计了分组输出投影策略。具体而言, 首先将 $n _ { h }$ 个输出分为 ?? 组, 然后对每组输出 ${ \bf o } _ { t , i } ^ { G } \in \mathbb { R } ^ { c \frac { n _ { h } } { g } }$ 投影到 $d _ { g }$ 维中间输出 ${ \bf o } _ { t , i } ^ { G ^ { \prime } } \in \mathbb { R } ^ { d _ { g } }$, 其中 $d _ { g } < c \frac { n _ { h } } { g }$。最后, 将中间输出 $[ \mathbf { o } _ { t , 1 } ^ { G ^ { \prime } } ; \mathbf { o } _ { t , 2 } ^ { G ^ { \prime } } ; . . . ; \mathbf { o } _ { t , g } ^ { G ^ { \prime } } ] \in \mathbb { R } ^ { d _ { g } g }$ 投影到最终注意力输出 $\hat { \mathbf { o } } _ { t } \in \mathbb { R } ^ { d }$。


#### 2.3.2. Heavily Compressed Attention

#### 2.3.2. 重度压缩注意力

The core architecture of HCA is illustrated in Figure 4, which compresses the KV cache in a heavier manner, but does not employ sparse attention.

HCA 的核心架构如图 4 所示, 它以更重的方式压缩 KV 缓存, 但不采用稀疏注意力。

Compressed Key-Value Entries. By and large, the compression strategy of HCA is similar to that of CSA, but employs a larger compression rate $m ^ { \prime } \left( \gg m \right)$ and does not perform overlapped compression. Let $H \in \mathbb { R } ^ { n \times d }$ be a sequence of input hidden states, HCA first computes the original KV entries $C \in \mathbb { R } ^ { n \times c }$ and their corresponding compression weights $Z \in \mathbb { R } ^ { n \times c }$ :

压缩键值 Entry。总体而言, HCA 的压缩策略与 CSA 相似, 但采用更大的压缩率 $m ^ { \prime } \left( \gg m \right)$ 且不执行重叠压缩。令 $H \in \mathbb { R } ^ { n \times d }$ 为输入隐藏状态序列, HCA 首先计算原始 KV entry $C \in \mathbb { R } ^ { n \times c }$ 及其对应的压缩权重 $Z \in \mathbb { R } ^ { n \times c }$：

$$
C = H \cdot W ^ { K V } ,\tag{20}
$$

$$
Z = H \cdot W ^ { Z } ,\tag{21}
$$

where $W ^ { K V } , W ^ { Z } \in \mathbb { R } ^ { d \times c }$ are trainable parameters. Next, each ??′ KV entries in ?? will be compressed into one according to the compression weights and learnable positional biases $B \in \mathbb { R } ^ { m ^ { \prime } \times c }$ V producing $C ^ { \mathsf { C o m p } } \in \mathbb { R } ^ { \frac { n } { m ^ { \prime } } \times c }$ . Each compressed entry $C _ { i } ^ { \mathrm { C o m p } } \in \mathbb { R } ^ { c }$ is computed by

其中 $W ^ { K V } , W ^ { Z } \in \mathbb { R } ^ { d \times c }$ 为可训练参数。接下来, ?? 中每 ??′ 个 KV entry 将根据压缩权重和可学习的位置偏置 $B \in \mathbb { R } ^ { m ^ { \prime } \times c }$ 压缩为一个, 生成 $C ^ { \mathsf { C o m p } } \in \mathbb { R } ^ { \frac { n } { m ^ { \prime } } \times c }$。每个压缩 entry $C _ { i } ^ { \mathrm { C o m p } } \in \mathbb { R } ^ { c }$ 的计算方式为

$$
\begin{array} { r } { S _ { m ^ { \prime } i : m ^ { \prime } ( i + 1 ) - 1 } = \mathrm { S o f t m a x } _ { \mathrm { r o w } } ( Z _ { m ^ { \prime } i : m ^ { \prime } ( i + 1 ) - 1 } + B ) , } \end{array}\tag{22}
$$

$$
C _ { i } ^ { \mathrm { C o m p } } = \sum _ { j = m ^ { \prime } i } ^ { m ^ { \prime } ( i + 1 ) - 1 } S _ { j } \odot C _ { j } .\tag{23}
$$

Through this compression operation, HCA compresses the sequence length to $\scriptstyle { \frac { 1 } { m ^ { \prime } } }$ times.

通过该压缩操作, HCA 将序列长度压缩到 $\scriptstyle { \frac { 1 } { m ^ { \prime } } }$ 倍。

> 译者注: HCA 是 CSA 的"简化版"——去除了重叠压缩和稀疏选择, 只保留最基础的重度压缩。这种设计选择反映了工程上的清晰分工：CSA 负责"筛选重要信息"(压缩+稀疏), HCA 负责"极致压缩全量信息"(仅压缩, 不筛选)。$m' \gg m$ 意味着 HCA 的压缩率远高于 CSA, 但因为没有稀疏选择, HCA 仍然需要对所有压缩后的 entry 做稠密注意力。因此 HCA 更适合那些对全局上下文敏感但局部细节要求不高的层。

Shared Key-Value MQA and Grouped Output Projection. HCA also employs the shared KV MQA and grouped output projection strategies as CSA does. After the KV compression, for a query token ??, HCA first produces attention queries $\{ \mathbf { q } _ { t , 1 } ; \mathbf { q } _ { t , 2 } ; . . . ; \mathbf { q } _ { t , n _ { h } } \}$ in a low-rank manner:

共享键值 MQA 与分组输出投影。HCA 同样采用 CSA 的共享 KV MQA 和分组输出投影策略。KV 压缩后, 对于查询 token ??, HCA 首先以低秩方式生成注意力查询 $\{ \mathbf { q } _ { t , 1 } ; \mathbf { q } _ { t , 2 } ; . . . ; \mathbf { q } _ { t , n _ { h } } \}$：

$$
\begin{array} { r } { \mathbf { c } _ { t } ^ { Q } = \mathbf { h } _ { t } \cdot W ^ { D Q } , } \end{array}\tag{24}
$$

$$
[ \mathbf { q } _ { t , 1 } ; \mathbf { q } _ { t , 2 } ; . . . ; \mathbf { q } _ { t , n _ { h } } ] = \mathbf { q } _ { t } = \mathbf { c } _ { t } ^ { Q } \cdot W ^ { U Q } ,\tag{25}
$$

where $\mathbf h _ { t } \in \mathbb R ^ { d }$ is the input hidden state of the query token $t ; n _ { h }$ denotes the number of query heads; $W ^ { D Q } \in \mathbb { R } ^ { d \times d _ { c } }$ and $W ^ { U Q } \in \mathbb { R } ^ { d _ { c } \times c n _ { h } }$ are the down-projection and up-projection matrices for queries, respectively. Next, we perform MQA on $\{ \mathbf { q } _ { t , i } \}$ and $C ^ { \mathrm { C o m p } }$ :

其中 $\mathbf h _ { t } \in \mathbb R ^ { d }$ 为查询 token $t$ 的输入隐藏状态; $n _ { h }$ 表示查询 head 数; $W ^ { D Q } \in \mathbb { R } ^ { d \times d _ { c } }$ 和 $W ^ { U Q } \in \mathbb { R } ^ { d _ { c } \times c n _ { h } }$ 分别为查询的下投影和上投影矩阵。接下来, 我们对 $\{ \mathbf { q } _ { t , i } \}$ 和 $C ^ { \mathrm { C o m p } }$ 执行 MQA：

$$
{ \bf o } _ { t , i } = \mathrm { C o r e A t t n } \left( { \tt q u e r y = { q } } _ { t , i } , \tt k e y = \it C ^ { \mathrm { C o m p } } , \tt v a l u e = \it C ^ { \mathrm { C o m p } } \right) ,\tag{26}
$$

where $\mathbf { o } _ { t , i } \in \mathbb { R } ^ { c }$ is the core attention output of the ??-th head at the ??-th token. Next, as CSA does, HCA splits $n _ { h }$ outputs into ?? groups, and for each group of output ${ \bf o } _ { t , i } ^ { G } \in \mathbb { R } ^ { c \frac { n _ { h } } { g } }$ , HCA projects it to a $d _ { g }$ -dimensional intermediate output ${ \bf o } _ { t , i } ^ { G ^ { \prime } } \in \mathbb { R } ^ { d _ { g } }$ , where $d _ { g } < c \frac { n _ { h } } { g }$ . Finally, HCA projects the intermediate output $[ \mathbf { o } _ { t , 1 } ^ { G ^ { \prime } } ; \mathbf { o } _ { t , 2 } ^ { G ^ { \prime } } ; . . . ; \mathbf { o } _ { t , g } ^ { G ^ { \prime } } ] \in \mathbb { R } ^ { d _ { g } g }$ to the final attention output $ { \hat { \mathbf { o } } } _ { t } \in \mathbb { R } ^ { d }$

其中 $\mathbf { o } _ { t , i } \in \mathbb { R } ^ { c }$ 为第 ?? 个 token 处第 ?? 个 head 的核心注意力输出。接下来, 与 CSA 一样, HCA 将 $n _ { h }$ 个输出分为 ?? 组, 对每组输出 ${ \bf o } _ { t , i } ^ { G } \in \mathbb { R } ^ { c \frac { n _ { h } } { g } }$ 投影到 $d _ { g }$ 维中间输出 ${ \bf o } _ { t , i } ^ { G ^ { \prime } } \in \mathbb { R } ^ { d _ { g } }$, 其中 $d _ { g } < c \frac { n _ { h } } { g }$。最后, HCA 将中间输出 $[ \mathbf { o } _ { t , 1 } ^ { G ^ { \prime } } ; \mathbf { o } _ { t , 2 } ^ { G ^ { \prime } } ; . . . ; \mathbf { o } _ { t , g } ^ { G ^ { \prime } } ] \in \mathbb { R } ^ { d _ { g } g }$ 投影到最终注意力输出 $ { \hat { \mathbf { o } } } _ { t } \in \mathbb { R } ^ { d }$。

#### 2.3.3. Other Details

#### 2.3.3. 其他细节

In addition to the core architectures of CSA and HCA described above, our hybrid attention incorporates several other techniques. For writing clarity, we omit these additional techniques from the above introduction and will briefly describe them in this subsection. Also, this subsection focuses only on the core ideas of them and may omit some tiny details for simplicity. We encourage the readers to refer to our open-source implementation for unambiguous details.

除了上述 CSA 和 HCA 的核心架构外, 我们的混合注意力还包含了几项其他技术。为行文清晰, 我们在上文介绍中省略了这些附加技术, 并将在本小节简要描述。此外, 本小节仅关注它们的核心思想, 为简洁起见可能省略一些小细节。我们鼓励读者参考我们的开源实现以获取明确的细节。

Query and Key-Value Entry Normalization. For both CSA and HCA, we perform an additional RMSNorm operation on each head of the queries and the only head of the compressed KV entries, just before the core attention operation. This normalization avoids exploding attention logits and may improve training stability.

查询与键值 Entry 归一化。对于 CSA 和 HCA, 我们在核心注意力操作之前, 对查询的每个 head 和压缩 KV entry 的唯一 head 执行额外的 RMSNorm 操作。该归一化避免了注意力 logit 的爆炸, 并可能改善训练稳定性。

Partial Rotary Positional Embedding. For both CSA and HCA, we partially employ the Rotary Positional Embedding (RoPE) (Su et al., 2024) to the attention queries, KV entries, and the core attention outputs. To be specific, for each query vector and KV entry vector used in CSA and HCA, we apply RoPE to its last 64 dimensions. Since the KV entries serve as both attention keys and values, the naive core attention outputs $\left\{ \mathbf { o } _ { t , i } \right\}$ will carry absolute位置嵌入, derived from the weighted sum of KV entries. As a countermeasure, we also apply RoPE with position −?? on the last 64 dimensions of each $\mathbf { o } _ { t , i }$ . In this way, the output of the core attention will also carry相对位置嵌入 — the contribution of each KV entry to the core attention outputs will also be related to the distance between the query and the KV entry.

部分旋转位置嵌入。对于 CSA 和 HCA, 我们部分地将旋转位置嵌入 (RoPE) (Su et al., 2024) 应用于注意力查询、KV entry 和核心注意力输出。具体而言, 对于 CSA 和 HCA 中使用的每个查询向量和 KV entry 向量, 我们对其最后 64 维应用 RoPE。由于 KV entry 同时作为注意力键和值, 朴素的核心注意力输出 $\left\{ \mathbf { o } _ { t , i } \right\}$ 将携带来自 KV entry 加权和的绝对位置嵌入。作为对策, 我们还在每个 $\mathbf { o } _ { t , i }$ 的最后 64 维上应用位置为 −?? 的 RoPE。这样, 核心注意力的输出也将携带相对位置嵌入——每个 KV entry 对核心注意力输出的贡献也将与查询和 KV entry 之间的距离相关。

> 译者注: "部分 RoPE"(只应用于最后 64 维)是一个重要但容易被忽略的细节。完整的 RoPE 会应用于所有维度, 但 CSA/HCA 中只选 64 维, 原因可能是：1) 压缩后的 KV entry 维度 $c$ 较小, 全维 RoPE 可能过度限制表达能力; 2) 保留部分维度不施加 RoPE, 让模型学习更灵活的位置无关特征。更值得玩味的是对输出 $\mathbf{o}_{t,i}$ 施加 "−t" 位置的 RoPE——这本质上是一种"位置去嵌入"操作, 抵消了 KV entry 带来的绝对位置信息, 使最终输出只保留相对位置关系。这种精细的位置处理体现了 DeepSeek 对注意力机制的深刻理解。

Additional Branch of Sliding Window Attention. In order to strictly preserve causality in CSA and HCA, each query attends to only preceding compressed KV blocks. Consequently, a query cannot access information from other tokens within its own compressed block. Meanwhile, recent tokens usually possess greater relevance to the query token in language modeling. For these reasons, we introduce a supplementary attention branch to both CSA and HCA in a sliding window manner, for better modeling of local dependencies. To be specific, for each query token, we additionally produce $n _ { \mathrm { w i n } }$ uncompressed KV entries corresponding to the recent $n _ { \mathrm { w i n } }$ tokens. In the core attention of CSA and HCA, these KV entries in the sliding window will be used along with the compressed KV entries.

滑动窗口注意力的附加分支。为了在 CSA 和 HCA 中严格保持因果性, 每个查询只关注前面的压缩 KV 块。因此, 查询无法访问其自身压缩块内其他 token 的信息。同时, 在语言建模中, 最近的 token 通常与查询 token 具有更大的相关性。基于这些原因, 我们以滑动窗口方式为 CSA 和 HCA 引入了一个补充注意力分支, 以更好地建模局部依赖。具体而言, 对于每个查询 token, 我们额外生成对应最近 $n _ { \mathrm { w i n } }$ 个 token 的 $n _ { \mathrm { w i n } }$ 个未压缩 KV entry。在 CSA 和 HCA 的核心注意力中, 滑动窗口中的这些 KV entry 将与压缩 KV entry 一起使用。

Attention Sink. In the core attention of CSA and HCA, we employ the trick of attention sink (OpenAI, 2025; Xiao et al., 2024). To be specific, we set a series of learnable sink logits $\{ z _ { 1 } ^ { \prime } , z _ { 2 } ^ { \prime } , . . . , z _ { n _ { h } } ^ { \prime } \}$ . For the ℎ-th attention head, Ex $\mathsf { p } ( z _ { h } ^ { \prime } )$ will be added to the denominator of the attention score:

注意力汇聚 (Attention Sink)。在 CSA 和 HCA 的核心注意力中, 我们采用了 attention sink 技巧 (OpenAI, 2025; Xiao et al., 2024)。具体而言, 我们设置了一系列可学习的汇聚 logit $\{ z _ { 1 } ^ { \prime } , z _ { 2 } ^ { \prime } , . . . , z _ { n _ { h } } ^ { \prime } \}$。对于第 ℎ 个注意力 head, Ex $\mathsf { p } ( z _ { h } ^ { \prime } )$ 将被加到注意力分数的分母中：

$$
s _ { h , i , j } = \frac { \mathrm { E x p } ( z _ { h , i , j } ) } { \sum _ { k } \mathrm { E x p } ( z _ { h , i , k } ) + \mathrm { E x p } ( z _ { h } ^ { \prime } ) } ,\tag{27}
$$

where $s _ { h , i , j } , z _ { h , i , j } \in \mathbb { R }$ denote the attention score and attention logit of the ℎ-th attention head between the ??-th query token and the ??-th preceding token or compressed block. This technique allows each query head to adjust its total attention scores to be not equal to 1, and even to be near 0.

其中 $s _ { h , i , j } , z _ { h , i , j } \in \mathbb { R }$ 表示第 ℎ 个注意力 head 在第 ?? 个查询 token 和第 ?? 个前面 token 或压缩块之间的注意力分数和注意力 logit。该技术允许每个查询 head 调整其总注意力分数不等于 1, 甚至接近 0。

> 译者注: Attention Sink 最初由 Xiao et al. (2024) 提出, 用于解决流式 LLM 中因 KV 缓存截断导致的性能崩溃——模型倾向于将大量注意力分配给初始的几个 token("汇聚 token")。在 CSA/HCA 中, 可学习的汇聚 logit 提供了一种更灵活的控制机制：每个 head 可以独立学习是否以及多大程度上"忽略"部分上下文(通过让总注意力接近 0)。这与标准 Softmax 的"注意力必须总和为 1"约束形成对比, 给予模型更大的自由度。注意这里引用了 OpenAI (2025), 暗示该技巧可能已被 GPT-4o/o3 等模型采用。

#### 2.3.4. Efficiency Discussion

#### 2.3.4. 效率讨论

Due to the employment of hybrid CSA and HCA, together with low-precision computation and storage, the attention module of DeepSeek-V4 series achieves remarkable efficiency in both attention FLOPs and KV cache size, especially in long-context scenarios. First, we adopt a mixed storage format for KV entries: BF16 precision is used for the rotary positional embedding (RoPE) dimensions, while FP8 precision is applied to the remaining dimensions. This hybrid representation reduces the KV cache size by nearly half compared with pure BF16 storage. Second, attention computation within the lightning indexer is performed in FP4 precision, which accelerates the attention operation under extremely long contexts. Third, relative to DeepSeek-V3.2, a smaller attention top-k is chosen in DeepSeek-V4 series, thereby improving model efficiency on short- and medium-length texts. Finally, and most importantly, compressed attention and hybrid attention techniques substantially reduce both the KV cache size and the computational FLOPs.

由于采用了混合 CSA 和 HCA, 以及低精度计算和存储, DeepSeek-V4 系列的注意力模块在注意力 FLOPs 和 KV 缓存大小方面均实现了显著的效率提升, 尤其是在长上下文场景中。首先, 我们对 KV entry 采用混合存储格式：旋转位置嵌入 (RoPE) 维度使用 BF16 精度, 其余维度使用 FP8 精度。与纯 BF16 存储相比, 这种混合表示将 KV 缓存大小减少了近一半。其次, 闪电索引器内的注意力计算以 FP4 精度执行, 这在极长上下文下加速了注意力操作。第三, 相对于 DeepSeek-V3.2, DeepSeek-V4 系列选择了更小的 attention top-k, 从而提高了模型在短文本和中长文本上的效率。最后, 也是最重要的, 压缩注意力和混合注意力技术大幅减少了 KV 缓存大小和计算 FLOPs。

Taking BF16 GQA8 (Ainslie et al., 2023) with a head dimension of 128 as the baseline — one of the common configurations of LLM attention — the KV cache size of DeepSeek-V4 series can be dramatically reduced to approximately 2% times of that baseline in the 1M-context setting.

以 head 维度为 128 的 BF16 GQA8 (Ainslie et al., 2023) 为基线——这是 LLM 注意力的常见配置之一——在 1M 上下文设置中, DeepSeek-V4 系列的 KV 缓存大小可大幅缩减至该基线的约 2%。

> 译者注: 效率数据极为惊人。从基线 GQA8 到 V4 的 2% KV 缓存, 意味着压缩率达到了 50 倍。这一收益来自四个层面的叠加：1) KV 压缩(CSA/HCA 将序列长度分别压缩到 1/m 和 1/m'); 2) MLA 的低秩分解(V3 引入, V4 继承); 3) 混合精度存储(BF16→FP8 节省一半); 4) FP4 索引计算(索引器 attention 用更低精度)。值得注意的是, 论文提到"在短文本和中长文本上也提高了效率", 这说明 CSA/HCA 的设计并非只在极端长上下文有效, 而是全序列长度范围内的改进。FP4 的使用目前主要用于索引器(而非核心 attention), 这是一个务实的工程选择——在精度敏感的核心计算保留较高精度, 在粗筛阶段使用最低精度。

Algorithm 1 Muon Optimizer for DeepSeek-V4   
Require: Learning rate ??, momentum ??, weight decay ??, update rescaling factor ??   
1: for each training step ?? do   
2: for each logically independent weight $W \in \mathbb { R } ^ { n \times m }$ do   
3: $G _ { t } = \nabla _ { W } \mathcal { L } _ { t } ( W _ { t - 1 } )$ ⊲ Compute gradients   
4: $M _ { t } = \mu M _ { t - 1 } + G _ { t }$ ⊲ Accumulate momentum buffer   
5: ??′?? = HybridNewtonSchulz $\left( \mu M _ { t } + G _ { t } \right)$ ⊲ Nesterov trick and hybrid Newton-Schulz   
6: $O _ { t } = O _ { t } ^ { \prime } \cdot \sqrt { \operatorname* { m a x } ( n , m ) } \cdot \gamma$ ⊲ Rescale the update RMS   
7: $W _ { t } = W _ { t - 1 } \cdot ( 1 - \eta \lambda ) - \eta O _ { t }$ ⊲ Perform weight decay and update   
8: end for   
9: end for

算法 1 DeepSeek-V4 的 Muon 优化器  
输入: 学习率 ??, 动量 ??, 权重衰减 ??, 更新重缩放因子 ??  
1: 对每个训练步 ?? 执行  
2: 对每个逻辑独立的权重 $W \in \mathbb { R } ^ { n \times m }$ 执行  
3: $G _ { t } = \nabla _ { W } \mathcal { L } _ { t } ( W _ { t - 1 } )$ ⊲ 计算梯度  
4: $M _ { t } = \mu M _ { t - 1 } + G _ { t }$ ⊲ 累积动量缓冲区  
5: ??′?? = HybridNewtonSchulz $\left( \mu M _ { t } + G _ { t } \right)$ ⊲ Nesterov 技巧与混合 Newton-Schulz  
6: $O _ { t } = O _ { t } ^ { \prime } \cdot \sqrt { \operatorname* { m a x } ( n , m ) } \cdot \gamma$ ⊲ 重缩放更新 RMS  
7: $W _ { t } = W _ { t - 1 } \cdot ( 1 - \eta \lambda ) - \eta O _ { t }$ ⊲ 执行权重衰减与更新  
8: 结束循环  
9: 结束循环

Moreover, even when compared with DeepSeek-V3.2 (DeepSeek-AI, 2025) — already an efficient baseline — DeepSeek-V4 series still exhibits substantial advantages in efficiency. A comparison of their inference FLOPs and KV cache size is provided in the right part of Figure 1.

此外, 即使与 DeepSeek-V3.2 (DeepSeek-AI, 2025)——一个已经高效的基线——相比, DeepSeek-V4 系列在效率方面仍然展现出显著优势。它们的推理 FLOPs 和 KV 缓存大小的对比见图 1 右侧。

> 译者注: 算法 1 在这里被提前引用(属于 2.4 节的内容), 是因为论文排版将其放在 2.3.4 和 2.4 之间。从内容结构看, 这是 Muon 优化器的伪代码, 展示了其核心流程：梯度计算→动量累积→混合 Newton-Schulz 正交化→RMS 重缩放→权重衰减与更新。Newton-Schulz 迭代是 Muon 的关键——它用矩阵乘法迭代逼近正交矩阵, 避免了显式 SVD 的高开销。算法中的 "hybrid" 指的是分两阶段使用不同系数：前 8 步快速收敛, 后 2 步精确稳定。这将在 2.4 节详细展开。

### 2.4. Muon Optimizer

### 2.4. Muon 优化器

We employ the Muon (Jordan et al., 2024; Liu et al., 2025) optimizer for the majority of modules in DeepSeek-V4 series due to its faster convergence and improved training stability. The full algorithm of our Muon optimization is summarized in Algorithm 1.

由于 Muon (Jordan et al., 2024; Liu et al., 2025) 优化器具有更快的收敛速度和改进的训练稳定性, 我们将其用于 DeepSeek-V4 系列的大部分模块。我们的 Muon 优化完整算法总结在算法 1 中。

Basic Configurations. We maintain the AdamW (Loshchilov and Hutter, 2017) optimizer for the embedding module, the prediction head module, the static biases and gating factors of mHC modules, and the weights of all RMSNorm modules. All other modules are updated with Muon. Following Liu et al. (2025), we also apply weight decay to Muon parameters, use the Nesterov (Jordan et al., 2024; Nesterov, 1983) trick, and rescale the Root Mean Square (RMS) of the update matrix for reutilization of our AdamW hyper-parameters. Different from them, we use hybrid Newton-Schulz iterations for orthogonalization.

基本配置。我们对嵌入模块、预测头模块、mHC 模块的静态偏置和门控因子, 以及所有 RMSNorm 模块的权重保持使用 AdamW (Loshchilov and Hutter, 2017) 优化器。所有其他模块使用 Muon 更新。遵循 Liu et al. (2025), 我们也对 Muon 参数应用权重衰减, 使用 Nesterov (Jordan et al., 2024; Nesterov, 1983) 技巧, 并重新缩放更新矩阵的均方根 (RMS) 以复用我们的 AdamW 超参数。与他们的不同之处在于, 我们使用混合 Newton-Schulz 迭代进行正交化。

Hybrid Newton-Schulz Iterations. For a given matrix ??, let its Singular Value Decomposition (SVD) be $M = U \Sigma V ^ { T }$ . The Newton-Schulz iterations aim to approximately orthogonalize ?? to be ?????? . Usually, ?? will be first normalized as $M _ { 0 } = M / | | \boldsymbol { M } | | _ { F }$ to ensure its maximum singular value does not exceed 1. Then, each Newton-Schulz iteration performs the following operation:

混合 Newton-Schulz 迭代。对于给定矩阵 ??, 设其奇异值分解 (SVD) 为 $M = U \Sigma V ^ { T }$。Newton-Schulz 迭代旨在将 ?? 近似正交化为 ??????。通常, ?? 首先会被归一化为 $M _ { 0 } = M / | | \boldsymbol { M } | | _ { F }$, 以确保其最大奇异值不超过 1。然后, 每次 Newton-Schulz 迭代执行以下操作：

$$
M _ { k } = a M _ { k - 1 } + b ( M _ { k - 1 } M _ { k - 1 } ^ { T } ) M _ { k - 1 } + c ( M _ { k - 1 } M _ { k - 1 } ^ { T } ) ^ { 2 } M _ { k - 1 } .\tag{28}
$$

Our hybrid Newton-Schulz performs 10 iterations over two distinct stages. During the first 8 steps, we use coefficients $( a , b , c ) = ( 3 . 4 4 4 5 , - 4 . 7 7 5 0 , 2 . 0 3 1 5 )$ to drive rapid convergence, bringing the singular values close to 1. In the final 2 steps, we switch to coefficients $( a , b , c ) = ( 2 , - 1 . 5 , 0 . 5 )$ , which stabilize the singular values precisely at 1.

我们的混合 Newton-Schulz 在两个不同阶段执行 10 次迭代。在前 8 步中, 我们使用系数 $( a , b , c ) = ( 3 . 4 4 4 5 , - 4 . 7 7 5 0 , 2 . 0 3 1 5 )$ 来驱动快速收敛, 使奇异值接近 1。在最后 2 步中, 我们切换到系数 $( a , b , c ) = ( 2 , - 1 . 5 , 0 . 5 )$, 将奇异值精确稳定在 1。

Avoiding Exploding Attention Logits. The attention architecture of DeepSeek-V4 series allows us to directly apply RMSNorm on the attention queries and KV entries, which effectively prevents attention logits from exploding. Consequently, we do not employ the QK-Clip technique (Liu et al., 2025) in our Muon optimizer.

避免注意力 Logits 爆炸。DeepSeek-V4 系列的注意力架构使我们能够直接在注意力查询和 KV 条目上应用 RMSNorm, 这有效防止了注意力 logits 爆炸。因此, 我们在 Muon 优化器中不采用 QK-Clip 技术 (Liu et al., 2025)。

> 译者注: Muon 优化器是 V4 训练效率提升的关键之一。其核心思想是通过正交化梯度更新矩阵来改善优化轨迹, 而 Newton-Schulz 迭代是一种无需完整 SVD 的近似正交化方法, 计算成本远低于 SVD。DeepSeek 的"混合"策略很聪明：前 8 步用激进系数快速收敛, 后 2 步用保守系数精确稳定, 这是典型的工程折中。保留 AdamW 用于特定模块(嵌入、RMSNorm 等)也是经验之谈——这些模块的梯度结构不适合 Muon 的矩阵级处理。
## 3. General Infrastructures

## 3. 通用基础设施

### 3.1. Fine-Grained Communication-Computation Overlap in Expert Parallelism

### 3.1. 专家并行中的细粒度通信-计算重叠

Mixture-of-Experts (MoE) can be accelerated via Expert Parallelism (EP). However, EP requires complex inter-node communication and imposes substantial demands on interconnect bandwidth and latency. To alleviate the communication bottleneck in EP and achieve higher end-to-end performance under lower interconnection bandwidth requirements, we propose a fine-grained EP scheme that fuses communication and computation into a single pipelined kernel for communication-computation overlapping.

混合专家 (MoE) 可以通过专家并行 (EP) 加速。然而, EP 需要复杂的节点间通信, 并对互连带宽和延迟提出了很高要求。为了缓解 EP 中的通信瓶颈, 并在较低的互连带宽要求下实现更高的端到端性能, 我们提出了一种细粒度的 EP 方案, 将通信和计算融合到一个流水线内核中, 以实现通信-计算重叠。

Communication Latency Can Be Hidden. The key insight of our EP scheme is that the communication latency can be effectively hidden beneath computation in MoE layers. As shown in Figure 5, in DeepSeek-V4 series, each MoE layer can be decomposed mainly into four stages: two communication-bound stages, Dispatch and Combine, and two computation-bound stages, Linear-1 and Linear-2. Our profiling reveals that within a single MoE layer, the total time of communication is less than that of the computation. Therefore, after fusing communication and computation into a unified pipeline, computation remains the dominant bottleneck, implying that the system can tolerate lower interconnect bandwidth without degrading end-to-end performance.

通信延迟可以被隐藏。我们 EP 方案的关键洞察是, 在 MoE 层中, 通信延迟可以有效地被计算所隐藏。如图 5 所示, 在 DeepSeek-V4 系列中, 每个 MoE 层主要可分解为四个阶段：两个通信受限阶段(Dispatch 和 Combine)和两个计算受限阶段(Linear-1 和 Linear-2)。我们的分析表明, 在单个 MoE 层内, 通信总时间小于计算总时间。因此, 将通信和计算融合到统一流水线后, 计算仍然是主导瓶颈, 这意味着系统可以容忍较低的互连带宽而不降低端到端性能。

![](images/fig05_ep_scheme.jpg)  
Figure 5 | Illustration of our EP scheme with related works. Comet (Zhang et al., 2025b) overlaps Dispatch with Linear-1, and Linear-2 with Combine, separately. Our EP scheme achieves a finergrained overlapping by splitting and scheduling experts into waves. The theoretical speedup is evaluated in the configuration of the DeepSeek-V4-Flash architecture.

图 5 | 我们的 EP 方案及相关工作的示意图。Comet (Zhang et al., 2025b) 分别将 Dispatch 与 Linear-1 重叠、Linear-2 与 Combine 重叠。我们的 EP 方案通过将专家分割和调度为 waves 来实现更细粒度的重叠。理论加速比是在 DeepSeek-V4-Flash 架构配置下评估的。

Fine-Grained EP Scheme. To further lower the interconnect bandwidth requirement and amplify the benefits of overlapping, we introduce a finer-grained expert partitioning scheme. Inspired by many related works (Aimuyo et al., 2025; Zhang et al., 2025b), we split and schedule the experts into waves. Each wave consists of a small portion of experts. As soon as all experts within the wave have completed their communication, computation can commence immediately without waiting for other experts. In steady state, computation of current wave, token transfer for the next wave, and result sending of completed experts all proceed concurrently, as demonstrated in Figure 5. This forms a fine-grained pipeline among experts, keeping both computation and communication continuous throughout the wave. The wave-based scheduling speeds up the performance on extreme cases such as Reinforcement Learning (RL) rollout, which usually encounters long-tail small batches.

细粒度 EP 方案。为了进一步降低互连带宽要求并放大重叠的收益, 我们引入了更细粒度的专家分区方案。受许多相关工作 (Aimuyo et al., 2025; Zhang et al., 2025b) 的启发, 我们将专家分割并调度为 waves。每个 wave 包含一小部分专家。一旦 wave 内的所有专家完成了通信, 计算就可以立即开始, 无需等待其他专家。在稳态下, 当前 wave 的计算、下一 wave 的 token 传输、已完成专家的结果发送都可以并发进行, 如图 5 所示。这在专家之间形成了细粒度流水线, 使整个 wave 中的计算和通信都保持连续。基于 wave 的调度加速了极端情况的性能, 例如强化学习 (RL) rollout, 这类场景通常会遇到长尾小批量。

Performance and Open-Sourced Mega-Kernel. We validated the fine-grained EP scheme on both NVIDIA GPUs and HUAWEI Ascend NPUs platforms. Compared against strong non-fused baselines, it achieves 1.50 ∼ 1.73× speedup for general inference workloads, and up to 1.96× for latency-sensitive scenarios such as RL rollouts and high-speed agent serving. We have open-sourced the CUDA-based mega-kernel implementation named $\mathbf { M e g a M o E } ^ { 2 }$ as a component of DeepGEMM.

性能与开源 Mega-Kernel。我们在 NVIDIA GPU 和华为昇腾 NPU 平台上验证了细粒度 EP 方案。与强非融合基线相比, 它在一般推理工作负载上实现了 1.50 ∼ 1.73 倍的加速, 在延迟敏感场景(如 RL rollout 和高速智能体服务)中最高可达 1.96 倍。我们已将基于 CUDA 的 mega-kernel 实现(命名为 $\mathbf { M e g a M o E } ^ { 2 }$)作为 DeepGEMM 的组件开源。

Observations and Proposals. We share observations and lessons from kernel development and offer some proposals to hardware vendors, in the hope of aiding efficient hardware design and achieving better software-hardware co-design:

观察与建议。我们分享内核开发中的观察和经验教训, 并向硬件厂商提出一些建议, 以期帮助高效硬件设计并实现更好的软硬件协同设计：

• Computation-Communication Ratio. Full communication-computation overlap hinges on the computation-communication ratio, rather than the bandwidth solely. Denoting peak compute throughput as ?? and interconnect bandwidth as ??, communication can be fully hidden when $C / B \leqslant V _ { \mathrm { c o m p } } / V _ { \mathrm { c o m m } } ,$ where $V _ { \mathrm { c o m p } }$ denotes the computation volume and ??comm refers to the communication volume. For DeepSeek-V4-Pro, where each token-expert pair requires 6ℎ?? FLOPs (SwiGLU gate, up, and down projections) but only 3ℎ bytes of communication (FP8 Dispatch + BF16 Combine), this simplifies to:

• 计算-通信比。完全的通信-计算重叠取决于计算-通信比, 而非仅取决于带宽。设峰值计算吞吐量为 ??, 互连带宽为 ??, 当 $C / B \leqslant V _ { \mathrm { c o m p } } / V _ { \mathrm { c o m m } }$ 时通信可以被完全隐藏, 其中 $V _ { \mathrm { c o m p } }$ 表示计算量, ??comm 表示通信量。对于 DeepSeek-V4-Pro, 每个 token-专家 对需要 6ℎ?? FLOPs(SwiGLU 门、上投影和下投影), 但仅需 3ℎ 字节通信(FP8 Dispatch + BF16 Combine), 这简化为：

$$
{ \frac { C } { B } } \leqslant 2 d = 6 1 4 4 { \mathrm { ~ F L O P s / B y t e } } .
$$

That is, each GBps of interconnect bandwidth suffices to hide the communication for 6.1 TFLOP/s of compute. Once bandwidth meets this threshold, it ceases to be the bottleneck, and devoting additional silicon area to further bandwidth brings diminishing returns. We encourage future hardware designs to target such balance points rather than scale bandwidth unconditionally.

也就是说, 每 GBps 的互连带宽足以隐藏 6.1 TFLOP/s 计算的通信。一旦带宽达到此阈值, 它就不再是瓶颈, 将额外的硅片面积投入到进一步增加带宽将带来边际收益递减。我们鼓励未来的硬件设计瞄准这样的平衡点, 而不是无条件地扩展带宽。

• Power Budget. Extreme kernel fusion drives compute, memory, and network to high load simultaneously, making power throttling a key performance limiter. We suggest that future hardware designs provide sufficient power headroom for such fully concurrent workloads.

• 功率预算。极端内核融合使计算、内存和网络同时处于高负载, 使功率节流成为关键性能限制因素。我们建议未来的硬件设计为这种完全并发的工作负载提供足够的功率余量。

• Communication Primitives. In the dispatch stage, we adopt a pull-based approach where each GPU actively reads activations from remote GPUs, avoiding the high notification latency that fine-grained push entails. Future hardware with lower-latency cross-GPU signaling would make push viable and enable more natural通信 patterns.

• 通信原语。在 dispatch 阶段, 我们采用基于 pull 的方法, 每个 GPU 主动从远程 GPU 读取激活值, 避免了细粒度 push 带来的高通知延迟。具有更低延迟跨 GPU 信号传输的未来硬件将使 push 变得可行, 并实现更自然的通信模式。

• Activation Function. We propose replacing SwiGLU with a low-cost element-wise activation that involves no exponential or division operations. This directly reduces the overhead of post-GEMM processing, preventing the GEMM pipeline from being stalled by activation函数 computation, thereby enhancing overall computational throughput and resource utilization.

• 激活函数。我们建议用低成本的逐元素激活函数替代 SwiGLU, 该激活函数不涉及指数或除法运算。这直接减少了 GEMM 后处理的开销, 防止 GEMM 流水线被激活函数计算阻塞, 从而提高整体计算吞吐量和资源利用率。

> 译者注: EP 通信-计算重叠是 MoE 训练/推理效率的核心瓶颈。DeepSeek 的 wave-based 调度比 Comet 的粗粒度重叠更进一步, 将专家切分为更小的 wave 以实现三级并发(当前 wave 计算、下一 wave 传输、已完成 wave 结果发送)。更令人印象深刻的是他们对硬件厂商的"喊话"：明确指出计算-通信比 6144 FLOPs/Byte 是硬件设计的甜蜜点, 超过此阈值后带宽投资的回报递减。这种基于实际工作负载的硬件设计建议, 体现了从软件定义硬件的趋势。

### 3.2. Flexible and Efficient Kernel Development with TileLang

### 3.2. 使用 TileLang 进行灵活高效的内核开发

In practice, our elaborate model architecture would have resulted in hundreds of fine-grained Torch ATen operators. We adopt TileLang (Wang et al., 2026) to develop a set of fused kernels to replace the vast majority of them, delivering optimal performance with minimal effort. It also allows us to quickly prototype operators like attention variants during validation. These kernels play critical roles in model architecture development, large-scale training, and ultimately production deployment of inference services. As a Domain-Specific Language (DSL), TileLang balances development productivity with runtime efficiency, enabling rapid development while supporting deep, iterative optimizations within the same codebase. Additionally, we collaborate closely with the TileLang community to foster a more agile, efficient, and stable kernel development workflow.

在实践中, 我们精心设计的模型架构会产生数百个细粒度的 Torch ATen 算子。我们采用 TileLang (Wang et al., 2026) 开发了一组融合内核来替代其中绝大多数, 以最小的努力提供最优性能。它还允许我们在验证期间快速原型化注意力变体等算子。这些内核在模型架构开发、大规模训练以及最终的推理服务生产部署中发挥着关键作用。作为领域特定语言 (DSL), TileLang 平衡了开发生产力和运行时效率, 支持快速开发的同时在同一代码库中支持深度迭代优化。此外, 我们与 TileLang 社区密切合作, 以促进更敏捷、高效和稳定的内核开发工作流。

Reducing Invocation Overhead with Host Codegen. As accelerators continue to grow in performance, CPU-side orchestration overhead becomes increasingly prominent. For small, highly optimized kernels, such fixed host overhead can easily cap utilization and throughput. A common source of this overhead is that host-side logic, such as runtime contract checks, is typically written in Python for flexibility and thus incurs a fixed per-invocation cost.

通过 Host Codegen 减少调用开销。随着加速器性能不断提升, CPU 端的编排开销变得越来越突出。对于小型高度优化的内核, 这种固定的 host 开销很容易限制利用率和吞吐量。这种开销的一个常见来源是 host 端逻辑(如运行时契约检查)通常为了灵活性而用 Python 编写, 因此每次调用都产生固定成本。

We mitigate this overhead with Host Codegen, which moves most host-side logic into generated host code. Specifically, we first co-generate the device kernel and a lightweight host launcher at the IR (Intermediate Representation) level,嵌入必要的元数据——如数据类型、秩/形状约束、步长/布局假设——从语言前端解析得到。然后, 启动器被下译为基于 TVM-FFI (Chen et al., 2018) 框架的 host 源代码, 其紧凑的调用约定和零拷贝张量互操作共同最小化了 host 端开销。在运行时, 生成的 host 代码执行验证和参数编排, 将所有每次调用检查移出 Python 执行路径。我们的测量表明, CPU 端验证开销从每次调用数十或数百微秒降至不到一微秒。

SMT-Solver-Assisted Formal Integer Analysis. TileLang kernels involve complex tensor index arithmetic that requires strong formal integer analysis. During compilation passes such as layout推断, memory hazard detection, and bound analysis, the compiler must verify whether integer expressions satisfy specific properties to enable the corresponding optimizations. Therefore, stronger formal analysis capabilities can unlock more advanced and complex optimization opportunities.

SMT 求解器辅助的形式化整数分析。TileLang 内核涉及复杂的张量索引运算, 需要强大的形式化整数分析。在布局推断、内存冲突检测和边界分析等编译阶段, 编译器必须验证整数表达式是否满足特定属性以启用相应优化。因此, 更强的形式化分析能力可以解锁更先进和复杂的优化机会。

To this end, we integrate the Z3 SMT solver (De Moura and Bjørner, 2008) into TileLang's algebraic system, providing formal analysis capability for most integer expressions in tensor programs. We strike a balance between computational overhead and formal expressiveness by translating TileLang's integer expressions into Z3's quantifier-free non-linear integer arithmetic (QF\_NIA). Based on Integer Linear Programming (ILP) solvers, QF\_NIA seamlessly resolves standard linear integer expressions common in kernels. Furthermore, its inherent non-linear reasoning capacity effectively addresses advanced challenges like vectorization over variable tensor shapes. Under reasonable resource limits, Z3 elevates overall optimization performance while restricting compilation time overhead to just a few seconds. The impact is substantial across multiple passes, including vectorization, barrier insertion, and code simplification.

为此, 我们将 Z3 SMT 求解器 (De Moura and Bjørner, 2008) 集成到 TileLang 的代数系统中, 为张量程序中的大多数整数表达式提供形式化分析能力。我们通过将 TileLang 的整数表达式翻译为 Z3 的量化自由非线性整数算术 (QF\_NIA), 在计算开销和形式化表达能力之间取得平衡。基于整数线性规划 (ILP) 求解器, QF\_NIA 无缝解决了内核中常见的标准线性整数表达式。此外, 其固有的非线性推理能力有效解决了可变张量形状上的向量化等高级挑战。在合理的资源限制下, Z3 提升了整体优化性能, 同时将编译时间开销限制在几秒钟内。其影响在多个编译阶段都很显著, 包括向量化、屏障插入和代码简化。

Numerical Precision and Bitwise Reproducibility. In production settings, numerical correctness and reproducibility are as critical as raw throughput. We therefore prioritize accuracy by default: fast-math optimizations are disabled at the compiler level, and precision-affecting approximations are provided only as explicit、opt-in frontend operators (e.g., T.\_\_exp, T.\_\_log, and T.\_\_sin). Conversely, when strict IEEE-754 semantics are required, TileLang provides

数值精度与位级可复现性。在生产环境中, 数值正确性和可复现性与原始吞吐量同样关键。因此, 我们默认优先保证精度：在编译器级别禁用快速数学优化, 仅将影响精度的近似作为显式的 opt-in 前端算子提供(例如 T.\_\_exp、T.\_\_log 和 T.\_\_sin)。相反, 当需要严格的 IEEE-754 语义时, TileLang 提供

IEEE-compliant intrinsics with explicit rounding modes (e.g., T.ieee\_fsqrt, T.ieee\_fdiv, and T.ieee\_add), enabling developers to precisely specify numerical behavior.

符合 IEEE 标准的内建函数, 具有显式的舍入模式(例如 T.ieee\_fsqrt、T.ieee\_fdiv 和 T.ieee\_add), 使开发者能够精确指定数值行为。

We also target bitwise reproducibility for validating kernels against hand-written CUDA baselines. We align TileLang's algebraic simplification and lowering rules with mainstream CUDA toolchains (e.g., NVCC) to avoid transformations that introduce unintended bit-level differences. Layout annotations (e.g., T.annotate\_layout) further allow users to pin down layout-dependent lowering decisions, keeping evaluation and accumulation order consistent with the reference CUDA implementation and thus enabling bit-identical outputs when desired.

我们还针对位级可复现性, 以验证内核与手写 CUDA 基线的一致性。我们将 TileLang 的代数简化和下译规则与主流 CUDA 工具链(例如 NVCC)对齐, 以避免引入意外的位级差异的变换。布局注释(例如 T.annotate\_layout)进一步允许用户固定布局相关的下译决策, 使求值和累加顺序与参考 CUDA 实现保持一致, 从而在需要时实现位级相同的输出。

Our evaluation shows that these accuracy- and reproducibility-oriented design choices do not sacrifice performance: under conservative defaults, TileLang kernels remain competitive, while exposing knobs to selectively relax numerical constraints for higher speed.

我们的评估表明, 这些以精度和可复现性为导向的设计选择不会牺牲性能：在保守默认设置下, TileLang 内核仍具有竞争力, 同时提供旋钮以选择性地放松数值约束以换取更高速度。

> 译者注: TileLang 是 DeepSeek 选择的内核开发 DSL, 类似于 Triton 但基于 TVM 生态。三个技术亮点值得关注：(1) Host Codegen 将 Python 编排开销从"百微秒级"降到"亚微秒级", 解决了小内核的 CPU 瓶颈; (2) 集成 Z3 SMT 求解器进行形式化整数分析, 这是编译器领域的硬核操作, 可自动验证复杂的张量索引安全性; (3) 默认关闭 fast-math、提供显式精度控制开关, 体现了对生产级数值稳定性的重视——这与很多追求 benchmark 分数而默认开启激进近似的研究代码形成鲜明对比。

![](images/fig03_csa_architecture.jpg)  
Figure 3 | Core architectures of CSA. It compresses the number of KV entries to $\textstyle { \frac { 1 } { m } }$ times, and then applies DeepSeek Sparse Attention for further acceleration. Additionally, a small set of sliding window KV entries is combined with the selected compressed KV entries to enhance local fine-grained dependencies.

![](images/fig03_csa_architecture.jpg)  
图 3 | CSA 的核心架构。它将 KV entry 数量压缩到 $\textstyle { \frac { 1 } { m } }$ 倍, 然后应用 DeepSeek 稀疏注意力以进一步加速。此外, 一小部分滑动窗口 KV entry 与选中的压缩 KV entry 结合, 以增强局部细粒度依赖。

### 3.3. High-Performance Batch-Invariant and Deterministic Kernel Libraries

### 3.3. 高性能批不变和确定性内核库

To enable efficient training and inference, we develop a comprehensive set of high-performance computational kernels. Beyond basic functionalities and maximizing hardware utilization, another pivotal design goal is to ensure training reproducibility and bitwise alignment among pre-training, post-training, and inference pipelines. Therefore, we implement end-to-end, bitwise batch-invariant, and deterministic kernels with minimal performance overhead. These kernels are helpful for debugging, stability analysis, and consistent post-training behavior.

为了实现高效训练和推理, 我们开发了一套全面的高性能计算内核。除了基本功能和最大化硬件利用率之外, 另一个关键设计目标是确保预训练、后训练和推理流水线之间的训练可复现性和位级对齐。因此, 我们实现了端到端的、位级批不变的、确定性的内核, 且性能开销极小。这些内核有助于调试、稳定性分析和一致的后训练行为。

Batch Invariance. Batch invariance ensures that the output of any given token remains bitwise identical, regardless of its position within a batch. To implement batch invariance, the primary challenges are listed as follows:

批不变性。批不变性确保任何给定 token 的输出保持位级相同, 无论其在批次中的位置如何。为了实现批不变性, 主要挑战如下：

• Attention. To achieve batch invariance, we cannot use the split-KV method (Dao et al., 2023), which distributes the attention computation for a single sequence across multiple Stream Multiprocessors (SMs) to balance the load of SMs. However, abandoning this technique will lead to severe wave-quantization problems3, which can adversely affect GPU utilization. To address this, we develop a dual-kernel strategy for batch-invariant decoding. The first kernel computes the attention output for an entire sequence within a single SM,确保 fully occupied waves 的高吞吐量。The second kernel, to minimize the latency of the final partially-filled wave and thus alleviate wave-quantization, uses multiple SMs for a single sequence. For the bitwise identity of these two kernels, we carefully design the calculation path of the second kernel to ensure its accumulation order is the same as that of the first kernel. Additionally, the second kernel utilizes distributed shared memory4 within thread-block clusters, enabling high-speed data exchange across SMs. This dual-kernel method effectively confines the overhead of batch-invariant decoding to be negligible.

• 注意力。为了实现批不变性, 我们不能使用 split-KV 方法 (Dao et al., 2023), 该方法将单个序列的注意力计算分布到多个流式多处理器 (SM) 上以平衡 SM 负载。然而, 放弃这项技术将导致严重的 wave-quantization 问题3, 这可能对 GPU 利用率产生不利影响。为此, 我们开发了一种用于批不变解码的双内核策略。第一个内核在单个 SM 内计算整个序列的注意力输出, 确保完全占用 wave 的高吞吐量。第二个内核为了最小化最终部分填充 wave 的延迟从而缓解 wave-quantization, 对单个序列使用多个 SM。为了保证这两个内核的位级一致性, 我们仔细设计了第二个内核的计算路径, 确保其累加顺序与第一个内核相同。此外, 第二个内核利用线程块集群内的分布式共享内存4, 实现跨 SM 的高速数据交换。这种双内核方法有效地将批不变解码的开销限制在可忽略不计的水平。

• Matrix Multiplication. Traditional cuBLAS library (NVIDIA Corporation, 2024) cannot achieve batch invariance. Therefore, we replace it end-to-end with DeepGEMM (Zhao et al., 2025). Furthermore, for very small batch sizes, conventional implementation usually employs split-k (Osama et al., 2023) techniques to improve performance. Unfortunately, split-k techniques cannot guarantee batch invariance, a pivotal feature in DeepSeek-V4.

• 矩阵乘法。传统的 cuBLAS 库 (NVIDIA Corporation, 2024) 无法实现批不变性。因此, 我们端到端地将其替换为 DeepGEMM (Zhao et al., 2025)。此外, 对于非常小的批量大小, 传统实现通常采用 split-k (Osama et al., 2023) 技术来提高性能。不幸的是, split-k 技术无法保证批不变性, 而这是 DeepSeek-V4 的一个关键特性。

Therefore, we abandon split-k in most scenarios, which, however, may cause performance degradation. To address this, we introduce a set of optimizations that enable our implementation of matrix multiplication to match or even surpass the performance of standard split-k in most major scenarios.

因此, 我们在大多数场景中放弃了 split-k, 但这可能导致性能下降。为了解决这个问题, 我们引入了一组优化, 使我们的矩阵乘法实现在大多数主要场景中达到甚至超越标准 split-k 的性能。

Determinism. Deterministic training is highly beneficial for debugging hardware or software issues. Moreover, when training exhibits anomalies such as loss spikes, determinism enables researchers to more easily pinpoint numerical causes and further refine the model design. Nondeterminism in training typically stems from non-deterministic accumulation order, often due to the use of atomic addition instructions. This issue primarily occurs during the backward pass, notably at the following parts:

确定性。确定性训练对调试硬件或软件问题非常有益。此外, 当训练出现诸如损失尖峰等异常时, 确定性使研究人员能够更容易地定位数值原因并进一步优化模型设计。训练中的非确定性通常源于非确定性的累加顺序, 这通常是由于使用了原子加法指令。该问题主要发生在反向传播期间, 特别是在以下部分：

• Attention Backward. In conventional implementations of backward propagation for sparse attention, we use atomicAdd to accumulate gradients for the KV tokens. This introduces non-determinism due to the non-associativity of floating-point addition. To address this problem, we allocate separate accumulation buffers for each SM, followed by a global deterministic summation across all buffers.

• 注意力反向传播。在稀疏注意力反向传播的传统实现中, 我们使用 atomicAdd 来累加 KV token 的梯度。由于浮点加法不满足结合律, 这引入了非确定性。为了解决这个问题, 我们为每个 SM 分配独立的累加缓冲区, 然后对所有缓冲区执行全局确定性求和。

• MoE Backward. When multiple SMs from different ranks concurrently write data to the same buffer on a receiving rank, negotiating writing positions also introduces nondeterminism. To resolve this, we design a token order pre-processing mechanism within each single rank, combined with buffer isolation across multiple ranks. This strategy ensures determinism of both the send results of expert parallelism and the accumulation order in the MoE backward pass.

• MoE 反向传播。当来自不同 rank 的多个 SM 并发地向接收 rank 上的同一个缓冲区写入数据时, 协商写入位置也会引入非确定性。为了解决这一问题, 我们设计了每个 rank 内的 token 顺序预处理机制, 并结合跨多个 rank 的缓冲区隔离。该策略确保了专家并行发送结果和 MoE 反向传播累加顺序的确定性。

• Matrix Multiplication in mHC. mHC involves a matrix multiplication with an output dimension of only 24. For very small batch sizes, we are compelled to use the split-k (Osama et al., 2023) algorithm, whose naive implementation will cause non-determinism. To overcome this, we output each split part separately and perform a deterministic reduction in a subsequent kernel, thereby preserving both performance and determinism.

• mHC 中的矩阵乘法。mHC 涉及输出维度仅为 24 的矩阵乘法。对于非常小的批量大小, 我们不得不使用 split-k (Osama et al., 2023) 算法, 其朴素实现会导致非确定性。为了克服这一点, 我们分别输出每个 split 部分, 并在后续内核中执行确定性规约, 从而同时保持性能和确定性。

> 译者注: 批不变性和确定性听起来像是"工程洁癖", 但对于万亿参数模型的训练来说, 这是生死攸关的特性。当损失出现尖峰时, 如果训练是非确定性的, 你无法判断这是数据问题、硬件故障还是算法缺陷。DeepSeek 为此放弃了 split-KV 和 split-k 等成熟优化, 重新设计了双内核注意力、SM 隔离缓冲区、确定性规约等方案。这种"为了可调试性牺牲峰值性能"的选择, 体现了大规模训练系统工程中"可观测性优先于性能"的成熟理念。

### 3.4. Training Framework

### 3.4. 训练框架

Our training framework is built upon the scalable and efficient infrastructure developed for DeepSeek-V3 (DeepSeek-AI, 2024). In training DeepSeek-V4, we inherit this robust foundation while introducing several key innovations to accommodate its novel architectural components — specifically the Muon optimizer, mHC, and the hybrid attention mechanism — while maintaining high training efficiency and stability.

我们的训练框架建立在为 DeepSeek-V3 (DeepSeek-AI, 2024) 开发的可扩展且高效的基础设施之上。在训练 DeepSeek-V4 时, 我们继承了这一坚实的基础, 同时引入了几项关键创新以适应其新颖的架构组件——特别是 Muon 优化器、mHC 和混合注意力机制——同时保持高训练效率和稳定性。

#### 3.4.1. Efficient Implementation of Muon

#### 3.4.1. Muon 的高效实现

The Muon optimizer requires the full gradient matrix to compute parameter updates, which presents a challenge when combined with the Zero Redundancy Optimizer (ZeRO) (Rajbhandari et al., 2020). Traditional ZeRO is designed for element-wise optimizers like AdamW, where a single parameter matrix can be partitioned and updated across multiple ranks. To address this conflict, we design a hybrid strategy of ZeRO bucket assignment for Muon.

Muon 优化器需要完整的梯度矩阵来计算参数更新, 这与零冗余优化器 (ZeRO) (Rajbhandari et al., 2020) 结合时带来了挑战。传统 ZeRO 是为逐元素优化器(如 AdamW)设计的, 单个参数矩阵可以跨多个 rank 分区并更新。为了解决这一冲突, 我们为 Muon 设计了 ZeRO 桶分配的混合策略。

For dense parameters, we limit the maximum size of ZeRO parallelism and employ a knapsack algorithm to assign parameter矩阵 to these ranks, ensuring each rank manages a roughly balanced load. The bucket on each rank is padded to match the size of the largest bucket across ranks, facilitating efficient reduce-scatter operations. This padding typically incurs less than 10% memory overhead in our setup, where each rank manages no more than five parameter matrices. When the overall size of data parallelism exceeds the limit for ZeRO, we compute the Muon update redundantly across the extra data-parallel groups, trading computation for reduced total bucket memory.

对于稠密参数, 我们限制 ZeRO 并行的最大规模, 并采用背包算法将参数矩阵分配给这些 rank, 确保每个 rank 管理的负载大致均衡。每个 rank 上的桶被填充以匹配跨 rank 的最大桶大小, 从而促进高效的 reduce-scatter 操作。在我们的设置中, 每个 rank 管理的参数矩阵不超过五个, 这种填充通常产生不到 10% 的内存开销。当数据并行的总体规模超过 ZeRO 的限制时, 我们在额外的数据并行组上冗余计算 Muon 更新, 以计算换取减少的总桶内存。

For MoE parameters, we optimize each expert independently. We first flatten all down projection matrices in SwiGLU (Shazeer, 2020) of all experts across all layers, followed by flattened up projection matrices and gate matrices. Then, we pad the flattened vector to ensure we can evenly distribute this vector across all ranks without splitting any logically independent matrix. Given the large number of experts, we do not impose a limit of ZeRO parallelism for MoE parameters, and the padding overhead is also negligible.

对于 MoE 参数, 我们独立优化每个专家。我们首先展平所有层中所有专家的 SwiGLU (Shazeer, 2020) 下投影矩阵, 然后是展平的上投影矩阵和门控矩阵。然后, 我们填充展平后的向量, 以确保可以在不拆分任何逻辑独立矩阵的情况下将其均匀分布到所有 rank。鉴于专家数量众多, 我们不对 MoE 参数施加 ZeRO 并行限制, 填充开销也可忽略不计。

Additionally, on each rank, consecutive parameters of identical shape will be automatically merged, enabling batched execution of the Newton-Schulz iterations for better hardware utilization. Furthermore, we observe that the Newton-Schulz iterations in Muon remain stable when computed with BF16 matrix multiplications. Leveraging this, we further quantize, in a stochastic rounding manner, the MoE gradients to be synchronized across data-parallel ranks to the BF16 precision, halving the communication volume. To avoid accumulation errors introduced by low-precision adders, we replace conventional tree- or ring-based reduce-scatter collectives with a two-phase approach. First, an all-to-all operation exchanges local gradients across ranks, and then each rank performs a local sum in FP32. This design maintains numerical robustness.

此外, 在每个 rank 上, 相同形状的连续参数将自动合并, 从而能够批量执行 Newton-Schulz 迭代以获得更好的硬件利用率。此外, 我们观察到 Muon 中的 Newton-Schulz 迭代在使用 BF16 矩阵乘法计算时保持稳定。利用这一点, 我们进一步以随机舍入方式将跨数据并行 rank 同步的 MoE 梯度量化到 BF16 精度, 将通信量减半。为了避免低精度加法器引入的累加误差, 我们用两阶段方法替代了传统的树状或环形 reduce-scatter 集合通信。首先, all-to-all 操作跨 rank 交换局部梯度, 然后每个 rank 在 FP32 中执行局部求和。这种设计保持了数值稳健性。

#### 3.4.2. Cost-Effective and Memory-Efficient Implementation of mHC

#### 3.4.2. mHC 的成本效益和内存高效实现

The introduction of mHC increases both activation memory consumption and communication volume between pipeline stages, compared with conventional residual connections. To mitigate these costs, we implement several optimization strategies.

与传统的残差连接相比, mHC 的引入增加了激活内存消耗和流水线阶段之间的通信量。为了缓解这些成本, 我们实施了多项优化策略。

Firstly, we carefully design and implement fused kernels of mHC for both training and inference. Secondly, we introduce a recomputation strategy that selectively checkpoints intermediate tensors. Specifically, we recompute most hidden states between layers and all normalized layer inputs, while avoiding recomputation of compute-intensive operations. This achieves a balance between memory saving and computational overhead. Thirdly, we adjust the DualPipe 1F1B overlapping scheme to accommodate the increased pipeline communication and enable concurrent execution of some operations in mHC.

首先, 我们仔细设计并实现了用于训练和推理的 mHC 融合内核。其次, 我们引入了一种重计算策略, 有选择地对中间张量进行检查点。具体来说, 我们重计算层间的大多数隐藏状态和所有归一化的层输入, 同时避免重计算计算密集型操作。这在内存节省和计算开销之间取得了平衡。第三, 我们调整了 DualPipe 1F1B 重叠方案以适应增加的流水线通信, 并启用 mHC 中某些操作的并发执行。

Collectively, these optimizations constrain the wall-time overhead of mHC to only 6.7% of the overlapped 1F1B pipeline stage. More details of the engineering optimization can be found in the dedicated mHC paper (Xie et al., 2026).

综合起来, 这些优化将 mHC 的 wall-time 开销限制在重叠 1F1B 流水线阶段的仅 6.7%。工程优化的更多细节可在专门的 mHC 论文 (Xie et al., 2026) 中找到。

#### 3.4.3. Contextual Parallelism for Long-Context Attention

#### 3.4.3. 长上下文注意力的上下文并行

Conventional Context Parallelism (CP) partitions the sequence dimension, with each rank maintaining contiguous ?? tokens. This introduces two challenges to our compressed attention mechanisms (i.e., CSA and HCA). On the one hand, training samples are packed from multiple sequences, and each sequence is compressed independently by a factor of ?? (or ??′), with any trailing tokens fewer than ?? being discarded. Consequently, the compressed KV lengths are typically less than $\frac { s } { m }$ and vary across ranks. On the other hand, the compression requires ?? consecutive KV entries, which may straddle the boundary between two neighboring CP ranks.

传统的上下文并行 (CP) 对序列维度进行分区, 每个 rank 维护连续的 ?? 个 token。这给我们的压缩注意力机制(即 CSA 和 HCA)带来了两个挑战。一方面, 训练样本由多个序列打包而成, 每个序列独立压缩, 压缩因子为 ??(或 ??′), 少于 ?? 的尾部 token 被丢弃。因此, 压缩后的 KV 长度通常小于 $\frac { s } { m }$ 且跨 rank 变化。另一方面, 压缩需要 ?? 个连续的 KV 条目, 这可能跨越两个相邻 CP rank 之间的边界。

To address these challenges, we design a two-stage communication approach. In the first stage, each rank ?? sends its last ?? uncompressed KV entries to rank $i + 1$ . Then, rank ?? + 1 compresses some of these received entries together with its local ?? uncompressed KV entries, producing a fixed length of $\textstyle { \frac { s } { m } } + 1$ compressed entries, in which exist some padding entries. In the second stage, an all-gather operation across all CP ranks collects the locally compressed KV entries. Then, a fused select-and-pad operator reorganizes them into the full set of compressed KV entries with a total length of $\mathtt { c p \_ s i z e } \cdot \frac { s } { m }$ . Any padding entries are placed at the tail. For HCA and the indexer in $\mathrm { C S A , }$ the visible range of compressed KV entries for each query token can be precomputed by rules. For the sparse attention in CSA, the top-?? selector explicitly specifies the indices of visible compressed KV entries for each query.

为了解决这些挑战, 我们设计了一种两阶段通信方法。在第一阶段, 每个 rank ?? 将其最后 ?? 个未压缩 KV 条目发送给 rank $i + 1$。然后, rank ?? + 1 将部分接收到的条目与其本地的 ?? 个未压缩 KV 条目一起压缩, 生成固定长度 $\textstyle { \frac { s } { m } } + 1$ 的压缩条目, 其中存在一些填充条目。在第二阶段, 跨所有 CP rank 的 all-gather 操作收集本地压缩的 KV 条目。然后, 一个融合的选择-填充算子将它们重组为总长度 $\mathtt { c p \_ s i z e } \cdot \frac { s } { m }$ 的完整压缩 KV 条目集合。任何填充条目都放置在尾部。对于 HCA 和 $\mathrm { C S A }$ 中的索引器, 每个查询 token 的可见压缩 KV 条目范围可以通过规则预先计算。对于 CSA 中的稀疏注意力, top-?? 选择器显式指定每个查询的可见压缩 KV 条目索引。

#### 3.4.4. Extended Automatic Differentiation for Flexible Activation Checkpointing

#### 3.4.4. 用于灵活激活检查点的扩展自动微分

Conventional activation checkpointing implementations operate at the granularity of an entire module, deciding whether to retain or recompute its output activations during the backward pass. This coarse granularity often leads to suboptimal trade-offs between recomputation cost and activation memory footprint. An alternative approach is to manually implement the forward and backward logic of an entire layer, explicitly managing tensor checkpointing states. While enabling fine-grained control, this method loses the convenience of the automatic differentiation framework, substantially increasing development complexity.

传统的激活检查点实现以整个模块为粒度运行, 决定在反向传播期间保留还是重计算其输出激活。这种粗粒度通常导致重计算成本和激活内存占用之间的次优权衡。另一种方法是手动实现整个层的前向和反向逻辑, 显式管理张量检查点状态。虽然这种方法实现了细粒度控制, 但失去了自动微分框架的便利, 大幅增加了开发复杂度。

To achieve fine-grained control without sacrificing programming efficiency, we implement a tensor-level activation checkpointing mechanism with automatic differentiation support. With this mechanism, developers only need to implement the forward pass and selectively annotate individual tensors for automatic checkpointing and recomputation. Our framework leverages TorchFX (Reed et al., 2022) to trace the full computation graph. For each annotated tensor, it performs a backward traversal to identify the minimal subgraph required for its recomputation. We define these minimal subgraphs as recomputation graphs and insert them into the backward logic just before the corresponding gradient computation.

为了在不牺牲编程效率的情况下实现细粒度控制, 我们实现了一种支持自动微分的张量级激活检查点机制。借助这种机制, 开发者只需实现前向传播, 并选择性地标注单个张量以进行自动检查点和重计算。我们的框架利用 TorchFX (Reed et al., 2022) 来追踪完整的计算图。对于每个标注的张量, 它执行反向遍历以识别其重计算所需的最小子图。我们将这些最小子图定义为重计算图, 并将它们插入到相应梯度计算之前的反向逻辑中。

Compared with the manual implementation, this design introduces no additional overhead during training. Recomputation in this framework is implemented by directly freeing the GPU memory of the annotated tensor and reusing the storage pointer from the recomputed tensor, without any GPU memory copy. Furthermore, since graph tracing executes the model concretely, we can track the underlying storage pointer of each tensor, which enables automatic deduplication of recomputation for tensors that share storage (例如, reshape 操作的输入和输出). This relieves developers from reasoning about low-level memory details when annotating recomputation.

与手动实现相比, 这种设计在训练期间不引入额外开销。该框架中的重计算通过直接释放标注张量的 GPU 内存并重用来自重计算张量的存储指针来实现, 无需任何 GPU 内存拷贝。此外, 由于图追踪具体执行模型, 我们可以追踪每个张量的底层存储指针, 这使得对共享存储的张量(例如 reshape 操作的输入和输出)的重计算自动去重。这使开发者在标注重计算时无需考虑底层内存细节。

> 译者注: 训练框架的四个子节展示了 DeepSeek 在系统工程上的深度：(1) Muon + ZeRO 的混合策略通过背包算法和冗余计算解决了矩阵级优化器与数据并行的冲突; (2) mHC 通过选择性重计算和 DualPipe 调度将 wall-time 开销压到 6.7%; (3) 两阶段上下文并行巧妙地处理了压缩注意力在序列边界上的连续性要求; (4) 张量级检查点基于 TorchFX 图追踪自动推导最小重计算子图, 并通过存储指针重用实现零开销去重。这些创新不是孤立的"技巧", 而是围绕"在保持效率的前提下支持新架构"这一核心目标的系统化工程。

### 3.5. Inference Framework

### 3.5. 推理框架

Our inference framework largely inherits from that of DeepSeek-V3, with some differences in KV Cache management.

我们的推理框架在很大程度上继承了 DeepSeek-V3 的框架, 在 KV 缓存管理方面存在一些差异。

#### 3.5.1. KV Cache Structure and Management

#### 3.5.1. KV 缓存结构与管理

To efficiently manage the heterogeneous KV caches arising from the hybrid attention mechanism in DeepSeek-V4, we design a customized KV cache layout. The layout is illustrated in Figure 6, and we will elaborate on it in detail as follows.

为了有效管理 DeepSeek-V4 混合注意力机制产生的异构 KV 缓存, 我们设计了一种定制的 KV 缓存布局。该布局如图 6 所示, 我们将在下面详细阐述。

Heterogeneous KV Entries in DeepSeek-V4. The hybrid attention mechanism in DeepSeek-V4 series introduces multiple types of KV entries with different Key-Value (KV) cache sizes and update rules. The lightning indexer for sparse selection introduces additional dimensions into the KV cache that possess embedding sizes distinct from those in the primary attention. The compression techniques employed in CSA and HCA reduce the sequence length by factors of $\frac { 1 } { m }$ and $\scriptstyle { \frac { 1 } { m ^ { \prime } } }$ , respectively, thereby decreasing the overall KV cache size. As a result, KV cache sizes vary across different layers. Furthermore, Sliding Window Attention (SWA) layers also operate with distinct KV cache sizes, as well as separate cache hit and eviction policies. In the compression branch, one KV entry is generated for every ?? tokens. When the number of remaining tokens is insufficient for compression, all pending tokens and their associated hidden states must be retained in a buffer until the compression operation can be executed. These buffered tokens represent a sequence state determined by positional context and are also managed within the KV cache framework.

DeepSeek-V4 中的异构 KV 条目。DeepSeek-V4 系列的混合注意力机制引入了多种类型的 KV 条目, 具有不同的键值 (KV) 缓存大小和更新规则。用于稀疏选择的 lightning 索引器为 KV 缓存引入了额外的维度, 其嵌入大小与主注意力中的不同。CSA 和 HCA 采用的压缩技术分别将序列长度减少为原来的 $\frac { 1 } { m }$ 和 $\scriptstyle { \frac { 1 } { m ^ { \prime } } }$, 从而减小了整体 KV 缓存大小。因此, KV 缓存大小因层而异。此外, 滑动窗口注意力 (SWA) 层也以不同的 KV 缓存大小运行, 并具有独立的缓存命中和驱逐策略。在压缩分支中, 每 ?? 个 token 生成一个 KV 条目。当剩余 token 数量不足以进行压缩时, 所有待处理的 token 及其关联的隐藏状态必须保留在缓冲区中, 直到可以执行压缩操作。这些缓冲的 token 代表由位置上下文决定的序列状态, 也在 KV 缓存框架内进行管理。

![](images/fig06_kv_cache_layout.jpg)  
Figure 6 | Illustration of the KV cache Layout for DeepSeek-V4. The KV cache is organized into two primary components: a classical KV cache for CSA/HCA, and a state cache for SWA and unready-for-compression tokens in CSA/HCA. In the state cache, each request is assigned a fixed-size cache block. Within this block, the SWA segment stores the KV entries corresponding to the most recent $n _ { \mathrm { w i n } }$ tokens, while the CSA/HCA segment stores uncompressed tail states that are not yet ready for compression. In the classical KV cache, we allocate multiple blocks per request. Each cache block covers lcm $( m , m ^ { \prime } )$ original tokens, producing $\begin{array} { r } { k _ { 1 } = \frac { \operatorname { l c m } \tilde { ( } m , m ^ { \prime } ) } { m } } \end{array}$ CSA compressed tokens and $\begin{array} { r } { k _ { 2 } = \frac { \operatorname { l c m } ( m , m ^ { \prime } ) } { m ^ { \prime } } } \end{array}$ HCA compressed tokens.

图 6 | DeepSeek-V4 的 KV 缓存布局示意图。KV 缓存被组织为两个主要组件：用于 CSA/HCA 的经典 KV 缓存, 以及用于 SWA 和 CSA/HCA 中尚未准备好压缩的 token 的状态缓存。在状态缓存中, 每个请求被分配一个固定大小的缓存块。在此块内, SWA 段存储对应于最近 $n _ { \mathrm { w i n } }$ 个 token 的 KV 条目, 而 CSA/HCA 段存储尚未准备好压缩的未压缩尾部状态。在经典 KV 缓存中, 我们为每个请求分配多个块。每个缓存块覆盖 lcm $( m , m ^ { \prime } )$ 个原始 token, 生成 $\begin{array} { r } { k _ { 1 } = \frac { \operatorname { l c m } \tilde { ( } m , m ^ { \prime } ) } { m } } \end{array}$ 个 CSA 压缩 token 和 $\begin{array} { r } { k _ { 2 } = \frac { \operatorname { l c m } ( m , m ^ { \prime } ) } { m ^ { \prime } } } \end{array}$ 个 HCA 压缩 token。

Challenges in Managing Hybrid Attention KV Cache. The hybrid attention mechanism violates fundamental assumptions behind PagedAttention and its variants. Although recent hybrid KV cache managing algorithms (e.g., Jenga (Zhang et al., 2025a), Hymba (Dong et al., 2025)) target general hybrid attention models or specific structures, two principal obstacles prevent consolidating KV caches across all layers under the PagedAttention framework:

管理混合注意力 KV 缓存的挑战。混合注意力机制违反了 PagedAttention 及其变体背后的基本假设。尽管最近出现了混合 KV 缓存管理算法(例如 Jenga (Zhang et al., 2025a)、Hymba (Dong et al., 2025))针对通用混合注意力模型或特定结构, 但两个主要障碍阻止了在 PagedAttention 框架下整合所有层的 KV 缓存：

• Diverse cache policies, such as those used in Sliding Window Attention.

• 多样的缓存策略, 例如滑动窗口注意力中使用的策略。

• Constraints imposed by high-performance attention kernels, including alignment requirements.

• 高性能注意力内核施加的约束, 包括对齐要求。

For efficient KV cache management of DeepSeek-V4, we design corresponding strategies to overcome these two challenges.

为了实现 DeepSeek-V4 的高效 KV 缓存管理, 我们设计了相应的策略来克服这两个挑战。

State Cache for SWA and Uncompressed Tail Tokens. To address the first obstacle, we adopt an alternative cache management mechanism. Since SWA is designed to enhance performance under a limited KV cache size, it is reasonable to treat it, along with the uncompressed tail tokens from the compression branch, as a state-space model. The corresponding KV cache can thus be regarded as a sequence-specific state that depends solely on the current position. Accordingly, we pre-allocate a fixed- and limited-size pool of state caches, and dynamically assign it to each sequence.

用于 SWA 和未压缩尾部 token 的状态缓存。为了解决第一个障碍, 我们采用了一种替代的缓存管理机制。由于 SWA 旨在有限的 KV 缓存大小下增强性能, 因此将其与来自压缩分支的未压缩尾部 token 一起视为状态空间模型是合理的。相应的 KV 缓存因此可以被视为仅依赖于当前位置的序列特定状态。据此, 我们预分配一个固定且有限大小的状态缓存池, 并动态将其分配给每个序列。

Sparse Attention Kernel Co-Design. Regarding the second obstacle, conventional highperformance attention kernels typically assume a fixed number ?? of tokens per block to optimize performance, corresponding to ?? · ?? original tokens in CSA and $B \cdot m ^ { \prime }$ in HCA. Through employing a high-performance sparse-attention kernel, different layers can accommodate variable tokens per block without performance degradation. Achieving this requires co-designing the KV cache layout and the sparse attention kernel. For instance, padding blocks to align with cache lines can improve performance. Thus, for CSA with compression ratio ?? and HCA with ratio ??′, the number of original tokens per block can be any multiple of lcm(??, ??′), the least common multiple of these two compression ratios.

稀疏注意力内核协同设计。关于第二个障碍, 传统的高性能注意力内核通常假设每个块有固定数量 ?? 的 token 以优化性能, 对应于 CSA 中的 ?? · ?? 个原始 token 和 HCA 中的 $B \cdot m ^ { \prime }$ 个。通过采用高性能稀疏注意力内核, 不同层可以在不降低性能的情况下容纳每个块的可变 token 数量。实现这一点需要协同设计 KV 缓存布局和稀疏注意力内核。例如, 将块填充以与缓存行对齐可以提高性能。因此, 对于压缩比为 ?? 的 CSA 和压缩比为 ??′ 的 HCA, 每个块的原始 token 数量可以是 lcm(??, ??′) 的任意倍数, 即这两个压缩比的最小公倍数。

#### 3.5.2. On-Disk KV Cache Storage

#### 3.5.2. 磁盘 KV 缓存存储

When serving DeepSeek-V4, we leverage an on-disk KV cache storage mechanism to eliminate repeated prefilling for shared-prefix requests. For the compressed KV entries in CSA/HCA and the uncompressed KV entries in Sliding Window Attention (SWA), we design separate solutions for storage management.

在部署 DeepSeek-V4 时, 我们利用磁盘 KV 缓存存储机制来消除共享前缀请求的重复预填充。对于 CSA/HCA 中的压缩 KV 条目和滑动窗口注意力 (SWA) 中的未压缩 KV 条目, 我们设计了独立的存储管理方案。

For CSA and HCA, we simply store all of the compressed KV entries to the disk. When a request hits a stored prefix, we read and reuse the compressed KV entries corresponding to the prefix, until the last complete compression block. Specially, for prefix tokens in the tail incomplete block, we still need to recompute them to restore the uncompressed KV entries, as uncompressed KV entries in CSA and HCA are not stored.

对于 CSA 和 HCA, 我们只需将所有压缩后的 KV 条目存储到磁盘。当请求命中已存储的前缀时, 我们读取并重用对应于该前缀的压缩 KV 条目, 直到最后一个完整的压缩块。特别地, 对于尾部不完整块中的前缀 token, 我们仍需要重计算它们以恢复未压缩的 KV 条目, 因为 CSA 和 HCA 中的未压缩 KV 条目不会被存储。

For the SWA KV entries, since they are not compressed and exist in every layer, their volume is approximately 8 times larger than the compressed CSA and HCA KV entries. To handle these large SWA KV entries efficiently, we propose and implement three distinct strategies for managing on-disk SWA KV entries, each offering a different trade-off between storage overhead and computational redundancy:

对于 SWA KV 条目, 由于它们未被压缩且存在于每一层, 其体积大约是压缩后的 CSA 和 HCA KV 条目的 8 倍。为了高效处理这些大型 SWA KV 条目, 我们提出并实现了三种不同的磁盘 SWA KV 条目管理策略, 每种策略在存储开销和计算冗余之间提供不同的权衡：

• Full SWA Caching. This strategy stores the complete SWA KV entries for all tokens, ensuring computational zero-redundancy. Under this strategy, the SWA KV entries of the hitting prefix can be reconstructed by just reading the on-disk cache of the last $n _ { \mathrm { W i n } }$ tokens within that prefix. Despite computational zero-redundancy, this strategy is inefficient for modern SSD-based storage systems — only a small subset of the stored SWA KV cache will be accessed for each hitting request, which leads to an unbalanced write-intensive access pattern.

• 完整 SWA 缓存。该策略存储所有 token 的完整 SWA KV 条目, 确保计算零冗余。在此策略下, 命中前缀的 SWA KV 条目可以通过仅读取该前缀内最后 $n _ { \mathrm { W i n } }$ 个 token 的磁盘缓存来重建。尽管计算零冗余, 但该策略对于现代基于 SSD 的存储系统来说效率低下——每个命中请求只会访问已存储 SWA KV 缓存的一小部分, 这导致了不平衡的写密集型访问模式。

• Periodic Checkpointing. This strategy checkpoints SWA KV entries of the last $n _ { \mathrm { w i n } }$ tokens within every ?? tokens, where ?? is a tunable parameter. For a hitting prefix, we load the most recent checkpointed state, and then recompute the remaining tail tokens. Through tuning ??, this strategy enables an on-demand trade-off between storage and computation.

• 周期性检查点。该策略每 ?? 个 token 对最后 $n _ { \mathrm { w i n } }$ 个 token 的 SWA KV 条目进行一次检查点, 其中 ?? 是可调参数。对于命中前缀, 我们加载最近的检查点状态, 然后重计算剩余的尾部 token。通过调节 ??, 该策略实现了存储和计算之间的按需权衡。

• Zero SWA Caching. This strategy does not store any SWA KV entries. For a hitting prefix, we need to perform more recomputation to restore the SWA KV entries. To be specific, in each attention layer, the SWA KV entry of each token depends on the SWA KV entries of only the most recent $n _ { \mathrm { w i n } }$ tokens from the previous layer. Therefore, leveraging cached CSA and HCA KV entries, recomputing the last $n _ { \mathrm { w i n } }$ · ?? tokens is enough to restore the last $n _ { \mathrm { W i n } }$ SWA KV entries for an ??-layer model.

• 零 SWA 缓存。该策略不存储任何 SWA KV 条目。对于命中前缀, 我们需要执行更多的重计算来恢复 SWA KV 条目。具体来说, 在每个注意力层中, 每个 token 的 SWA KV 条目仅依赖于前一层最近 $n _ { \mathrm { w i n } }$ 个 token 的 SWA KV 条目。因此, 利用已缓存的 CSA 和 HCA KV 条目, 重计算最后 $n _ { \mathrm { w i n } }$ · ?? 个 token 就足以恢复 ?? 层模型最后 $n _ { \mathrm { W i n } }$ 个 SWA KV 条目。

Depending on specific deployment scenarios, we select the most suitable strategy to achieve the desired trade-off between storage and computation.

根据具体的部署场景, 我们选择最合适的策略以实现存储和计算之间所需的权衡。

> 译者注: 推理框架的 KV 缓存管理是 V4 支持 1M 上下文的关键工程。三个设计亮点：(1) 将 SWA 和未压缩尾部 token 视为"状态空间模型"而非传统 KV 缓存, 使用固定大小的预分配池, 避免了 PagedAttention 的碎片化问题; (2) 通过稀疏注意力内核与缓存布局的协同设计, 使不同层可以灵活使用可变块大小; (3) 磁盘 KV 存储提供了三种 SWA 策略(全缓存、周期性检查点、零缓存), 允许部署者根据 SSD 容量和延迟要求灵活选择。这种"分层管理 + 弹性策略"的思路, 体现了推理系统设计中"没有银弹, 只有权衡"的工程哲学。


![](images/fig04_hca_architecture.jpg)  
Figure 4 | Core architectures of HCA. It performs heavier compression, where the KV entries of $m ^ { \prime } \left( \gg m \right)$ tokens will be consolidated into one. Also, we additionally introduce a small set of sliding window KV entries to enhance local fine-grained dependencies.

![](images/fig04_hca_architecture.jpg)  
图 4 | HCA 的核心架构。它执行更重的压缩, 其中 $m ^ { \prime } \left( \gg m \right)$ 个 token 的 KV entry 将被合并为一个。此外, 我们额外引入了一小部分滑动窗口 KV entry 以增强局部细粒度依赖。

## 4. Pre-Training

## 4. 预训练

### 4.1. Data Construction

### 4.1. 数据构建

On top of the pre-training data of DeepSeek-V3, we endeavor to construct a more diverse and higher-quality training corpus with longer effective contexts. We continually refine our data construction pipelines. For web-sourced data, we implement filtering strategies to remove batched auto-generated and templated content, thereby mitigating the risk of model collapse (Zhu et al., 2024). Mathematical and programming corpora still remain core components of our training data, and we further enhance the coding capabilities of DeepSeek-V4 series by incorporating agentic data during the mid-training phase. For multilingual data, we build a larger corpus for DeepSeek-V4, improving its capture of long-tail knowledge across different cultures. For DeepSeek-V4, we place a particular emphasis on long-document data curation, prioritizing scientific papers, technical reports, and other materials that reflect unique academic values. Combining all the above, our pre-training corpus comprises more than 32T tokens, containing mathematical contents, codes, web pages, long documents, and other high-quality categories.

在 DeepSeek-V3 预训练数据的基础上, 我们努力构建更多样化、更高质量且有效上下文更长的训练语料库。我们不断改进数据构建流水线。对于网络来源的数据, 我们实施过滤策略以去除批量自动生成的模板化内容, 从而缓解模型崩溃 (Zhu et al., 2024) 的风险。数学和编程语料库仍然是我们训练数据的核心组成部分, 我们还通过在 mid-training 阶段引入智能体数据来进一步增强 DeepSeek-V4 系列的编程能力。对于多语言数据, 我们为 DeepSeek-V4 构建了更大的语料库, 提高其对不同文化长尾知识的捕获能力。对于 DeepSeek-V4, 我们特别重视长文档数据整理, 优先选择科学论文、技术报告和其他反映独特学术价值的材料。综合以上所有内容, 我们的预训练语料库包含超过 32T token, 涵盖数学内容、代码、网页、长文档和其他高质量类别。

For pre-training data, we largely follow the same pre-processing strategies of DeepSeek-V3. For tokenization, on top of the DeepSeek-V3 tokenizer, we introduce a few special tokens for context construction, and still remain the vocabulary size to be 128K. We also inherit the token-splitting (DeepSeek-AI, 2024) and Fill-in-Middle (FIM) (DeepSeek-AI, 2024) strategies from DeepSeek-V3. Inspired by Ding et al. (2024), we pack documents from different sources into appropriate sequences to minimize sample truncation. Different from DeepSeek-V3, we employ sample-level attention masking during pre-training.

对于预训练数据, 我们在很大程度上遵循 DeepSeek-V3 相同的预处理策略。对于分词, 在 DeepSeek-V3 分词器的基础上, 我们引入了一些用于上下文构建的特殊 token, 词汇量仍保持为 128K。我们还继承了来自 DeepSeek-V3 的 token-splitting (DeepSeek-AI, 2024) 和 Fill-in-Middle (FIM) (DeepSeek-AI, 2024) 策略。受 Ding et al. (2024) 启发, 我们将来自不同来源的文档打包到适当的序列中, 以最小化样本截断。与 DeepSeek-V3 不同, 我们在预训练期间采用样本级注意力掩码。

> 译者注: V4 的数据策略延续了 V3 的成功经验, 并在三个维度上扩展：(1) 更积极的去重和过滤, 应对模型崩溃风险; (2) 引入智能体数据增强代码能力, 这与当前 Agentic AI 的趋势一致; (3) 特别强调长文档(科学论文、技术报告), 直接服务于 1M 上下文的目标。"样本级注意力掩码"是一个关键细节——在文档打包时, 不同文档的 token 不会相互 attended, 这防止了无关文档之间的信息泄漏。

### 4.2. Pre-Training Setups

### 4.2. 预训练设置

#### 4.2.1. Model Setups

#### 4.2.1. 模型设置

DeepSeek-V4-Flash. We set the number of Transformer layers to 43 and the hidden dimension ?? to 4096. For the first two layers, we use pure sliding window attention. For the subsequent layers, CSA and HCA are used in an interleaved manner. For CSA, we set the compression rate ?? to 4, the number of indexer query heads $n _ { h } ^ { I }$ to 64, the indexer head dimension $\hat { c ^ { I } }$ to 128, and the number of KV entries selected for sparse attention (i.e., attention top-k) to 512. For HCA, we set the compression rate $m ^ { \prime }$ to 128. For both CSA and HCA, we set the number of query heads $n _ { h }$ to 64, the head dimension ?? to 512, and the query compression dimension $d _ { c }$ to 1024. The number of output projection groups ?? is set to 8, and the dimension of each intermediate attention output $d _ { g }$ is set to 1024. For the additional branch of sliding window attention, the window size $n _ { \mathrm { w i n } }$ is set to 128. We employ MoE layers in all Transformer blocks, but use the Hash routing strategy for the first 3 MoE layers. Each MoE layer consists of 1 shared expert and 256 routed experts, where the intermediate hidden dimension of each expert is 2048. Among the routed experts, 6 experts will be activated for each token. The multi-token prediction depth is set to 1. As for $m { \mathrm { H C } } ,$ the expansion factor $n _ { \mathrm { h c } }$ is set to $^ { 4 , }$ and the number of Sinkhorn-Knopp iterations $t _ { \mathrm { m a x } }$ is set to 20. Under this configuration, DeepSeek-V4-Flash comprises 284B total parameters, of which 13B are activated for each token.

DeepSeek-V4-Flash。我们将 Transformer 层数设置为 43, 隐藏维度 ?? 为 4096。对于前两层的模型设置, 我们使用纯滑动窗口注意力。对于后续层, CSA 和 HCA 以交错方式使用。对于 CSA, 我们将压缩率 ?? 设为 4, 索引器查询头数 $n _ { h } ^ { I }$ 设为 64, 索引器头维度 $\hat { c ^ { I } }$ 设为 128, 稀疏注意力选择的 KV 条目数(即注意力 top-k)设为 512。对于 HCA, 我们将压缩率 $m ^ { \prime }$ 设为 128。对于 CSA 和 HCA, 我们将查询头数 $n _ { h }$ 设为 64, 头维度 ?? 设为 512, 查询压缩维度 $d _ { c }$ 设为 1024。输出投影组数 ?? 设为 8, 每个中间注意力输出维度 $d _ { g }$ 设为 1024。对于滑动窗口注意力的额外分支, 窗口大小 $n _ { \mathrm { w i n } }$ 设为 128。我们在所有 Transformer 块中使用 MoE 层, 但前 3 个 MoE 层使用 Hash 路由策略。每个 MoE 层由 1 个共享专家和 256 个路由专家组成, 其中每个专家的中间隐藏维度为 2048。在路由专家中, 每个 token 激活 6 个专家。多 token 预测深度设为 1。至于 $m { \mathrm { H C } }$, 扩展因子 $n _ { \mathrm { h c } }$ 设为 $^ { 4 , }$, Sinkhorn-Knopp 迭代次数 $t _ { \mathrm { m a x } }$ 设为 20。在此配置下, DeepSeek-V4-Flash 共包含 284B 总参数, 其中每个 token 激活 13B 参数。

DeepSeek-V4-Pro. We set the number of Transformer layers to 61 and the hidden dimension ?? to 7168. For the first two layers, we use HCA. For the subsequent layers, CSA and HCA are used in an interleaved manner. For CSA, we set the compression rate ?? to 4, the number of indexer query heads $n _ { h } ^ { I }$ to 64, the indexer head dimension $c ^ { I }$ to 128, and the number of KV entries selected for sparse attention $( \mathrm { i . e . , }$ attention top-k) to 1024. For HCA, we set the compression rate $m ^ { \prime }$ to 128. For both CSA and HCA, we set the number of query heads $n _ { h }$ to 128, the head dimension ?? to 512, and the query compression dimension $d _ { c }$ to 1536. The number of output projection groups ?? is set to $^ { 1 6 , }$ and the dimension of each intermediate attention output $d _ { g }$ is set to 1024. For the additional branch of sliding window attention, the window size $n _ { \mathrm { w i n } }$ is set to 128. We employ MoE layers in all Transformer blocks, but use the Hash routing strategy for the first 3 MoE layers. Each MoE layer consists of 1 shared expert and 384 routed experts, where the intermediate hidden dimension of each expert is 3072. Among the routed experts, 6 experts will be activated for each token. The multi-token prediction depth is set to 1. As for mHC, the expansion factor $n _ { \mathrm { h c } }$ is set to $^ { 4 , }$ and the number of Sinkhorn-Knopp iterations $t _ { \mathrm { m a x } }$ is set to 20. Under this configuration, DeepSeek-V4-Pro comprises 1.6T total parameters, of which 49B are activated for each token.

DeepSeek-V4-Pro。我们将 Transformer 层数设置为 61, 隐藏维度 ?? 为 7168。对于前两层的模型设置, 我们使用 HCA。对于后续层, CSA 和 HCA 以交错方式使用。对于 CSA, 我们将压缩率 ?? 设为 4, 索引器查询头数 $n _ { h } ^ { I }$ 设为 64, 索引器头维度 $c ^ { I }$ 设为 128, 稀疏注意力选择的 KV 条目数(即注意力 top-k)设为 1024。对于 HCA, 我们将压缩率 $m ^ { \prime }$ 设为 128。对于 CSA 和 HCA, 我们将查询头数 $n _ { h }$ 设为 128, 头维度 ?? 设为 512, 查询压缩维度 $d _ { c }$ 设为 1536。输出投影组数 ?? 设为 $^ { 1 6 , }$, 每个中间注意力输出维度 $d _ { g }$ 设为 1024。对于滑动窗口注意力的额外分支, 窗口大小 $n _ { \mathrm { w i n } }$ 设为 128。我们在所有 Transformer 块中使用 MoE 层, 但前 3 个 MoE 层使用 Hash 路由策略。每个 MoE 层由 1 个共享专家和 384 个路由专家组成, 其中每个专家的中间隐藏维度为 3072。在路由专家中, 每个 token 激活 6 个专家。多 token 预测深度设为 1。至于 mHC, 扩展因子 $n _ { \mathrm { h c } }$ 设为 $^ { 4 , }$, Sinkhorn-Knopp 迭代次数 $t _ { \mathrm { m a x } }$ 设为 20。在此配置下, DeepSeek-V4-Pro 共包含 1.6T 总参数, 其中每个 token 激活 49B 参数。

#### 4.2.2. Training Setups

#### 4.2.2. 训练设置

DeepSeek-V4-Flash. We employ the Muon optimizer (Jordan et al., 2024; Liu et al., 2025) for the majority of parameters, but use the AdamW optimizer (Loshchilov and Hutter, 2017) for the embedding module, the prediction head module, and the weights of all RMSNorm modules. For AdamW, we set its hyper-parameters to $\beta _ { 1 } = 0 . 9 , \beta _ { 2 } = 0 . 9 5 , \bar { \varepsilon } = 1 0 ^ { - 2 0 }$ , and weight\_decay = 0.1. For Muon, we set the momentum to 0.95 and the weight decay to 0.1, and rescale the RMS of each update matrix to 0.18 for reutilization of the AdamW learning rate. We train DeepSeek-V4-Flash on 32T tokens, and as in DeepSeek-V3, we also employ a batch size scheduling strategy that increases the batch size (in tokens) from a small size to 75.5M and then keeps it at 75.5M during most of the training. The learning rate is linearly warmed up in the first 2000 steps, maintained at $2 . 7 \times 1 0 ^ { - 4 }$ for most of the training. Near the end of the training, we finally decay the learning rate to $2 . 7 \times 1 0 ^ { - 5 }$ following a cosine schedule. The training starts with a sequence length of 4K, and we gradually extend the training sequence length to 16K, 64K, and 1M. As for the setups of sparse attention, we first warmup the model with dense attention for the first 1T tokens, and introduce sparse attention at the sequence length of 64K and keep sparse attention during the rest of the training. When introducing attention sparsity, we first set a short stage to warm up the lightning indexer in CSA, and then train the model with sparse attention for most of the training. For auxiliary-loss-free load balancing, we set the bias update speed to 0.001. For the balance loss, we set its loss weight to 0.0001 to avoid extreme imbalance within single sequences. The MTP loss weight is set to 0.3 for most of the training, and to 0.1 upon the start of learning rate decay.

DeepSeek-V4-Flash。我们对大部分参数使用 Muon 优化器 (Jordan et al., 2024; Liu et al., 2025), 但对嵌入模块、预测头模块和所有 RMSNorm 模块的权重使用 AdamW 优化器 (Loshchilov and Hutter, 2017)。对于 AdamW, 我们将超参数设置为 $\beta _ { 1 } = 0 . 9 , \beta _ { 2 } = 0 . 9 5 , \bar { \varepsilon } = 1 0 ^ { - 2 0 }$, weight\_decay = 0.1。对于 Muon, 我们将动量设为 0.95, 权重衰减设为 0.1, 并将每个更新矩阵的 RMS 重新缩放为 0.18 以复用 AdamW 学习率。我们在 32T token 上训练 DeepSeek-V4-Flash, 与 DeepSeek-V3 一样, 我们也采用批量大小调度策略, 将批量大小(以 token 计)从小尺寸增加到 75.5M, 然后在大部分训练期间保持 75.5M。学习率在前 2000 步线性预热, 在大部分训练期间维持在 $2 . 7 \times 1 0 ^ { - 4 }$。在训练接近尾声时, 我们最终按照余弦调度将学习率衰减到 $2 . 7 \times 1 0 ^ { - 5 }$。训练以 4K 的序列长度开始, 我们逐步将训练序列长度扩展到 16K、64K 和 1M。关于稀疏注意力的设置, 我们首先用稠密注意力对前 1T token 进行模型预热, 然后在 64K 序列长度处引入稀疏注意力, 并在其余训练中保持稀疏注意力。引入注意力稀疏性时, 我们首先设置一个短阶段来预热 CSA 中的 lightning 索引器, 然后在大部分训练中使用稀疏注意力训练模型。对于无辅助损失的负载均衡, 我们将偏置更新速度设为 0.001。对于平衡损失, 我们将其损失权重设为 0.0001 以避免单个序列内的极端不平衡。MTP 损失权重在大部分训练期间设为 0.3, 在学习率衰减开始时设为 0.1。

DeepSeek-V4-Pro. Except for specific values of hyper-parameters, the training setup of DeepSeek-V4-Pro is largely consistent with that of DeepSeek-V4-Flash. We employ the Muon optimizer for the majority of parameters, but use the AdamW optimizer for the embedding module, the prediction head module, and the weights of all RMSNorm modules. The hyper-parameters of AdamW and Muon are the same as those of DeepSeek-V4-Flash. We train DeepSeek-V4-Pro on 33T tokens, and also employ a batch size scheduling strategy, with the maximum batch size being 94.4M tokens. The learning rate scheduling strategy is largely the same as that of DeepSeek-V4-Flash, but the peak learning rate is set to $2 . 0 \times 1 0 ^ { - 4 }$ and the end learning rate is set to $2 . { \overset { \cdot } { 0 } } \times 1 0 ^ { - 5 }$ . The training also starts with a sequence length of 4K, and the length is gradually extended to 16K, 64K, and 1M. Compared with DeepSeek-V4-Flash, DeepSeek-V4-Pro starts with a longer stage of dense attention, and the strategy of introducing sparse attention is the same as DeepSeek-V4-Flash, following a two-stage training method. For auxiliary-loss-free load balancing, we set the bias update speed to 0.001. For the balance loss, we set its loss weight to 0.0001 to avoid extreme imbalance within single sequences. The MTP loss weight is set to 0.3 for most of the training, and to 0.1 upon the start of learning rate decay.

DeepSeek-V4-Pro。除了特定的超参数值外, DeepSeek-V4-Pro 的训练设置与 DeepSeek-V4-Flash 大体一致。我们对大部分参数使用 Muon 优化器, 但对嵌入模块、预测头模块和所有 RMSNorm 模块的权重使用 AdamW 优化器。AdamW 和 Muon 的超参数与 DeepSeek-V4-Flash 相同。我们在 33T token 上训练 DeepSeek-V4-Pro, 并同样采用批量大小调度策略, 最大批量大小为 94.4M token。学习率调度策略与 DeepSeek-V4-Flash 大体相同, 但峰值学习率设为 $2 . 0 \times 1 0 ^ { - 4 }$, 最终学习率设为 $2 . { \overset { \cdot } { 0 } } \times 1 0 ^ { - 5 }$。训练同样以 4K 序列长度开始, 逐步扩展到 16K、64K 和 1M。与 DeepSeek-V4-Flash 相比, DeepSeek-V4-Pro 以更长的稠密注意力阶段开始, 引入稀疏注意力的策略与 DeepSeek-V4-Flash 相同, 遵循两阶段训练方法。对于无辅助损失的负载均衡, 我们将偏置更新速度设为 0.001。对于平衡损失, 我们将其损失权重设为 0.0001 以避免单个序列内的极端不平衡。MTP 损失权重在大部分训练期间设为 0.3, 在学习率衰减开始时设为 0.1。

#### 4.2.3. Mitigating Training Instability

#### 4.2.3. 缓解训练不稳定性

Training trillion-parameter MoE models presents significant stability challenges, and DeepSeek-V4 series are no exception. We encountered notable instability challenges during training. While simple rollbacks could temporarily restore the training state, they proved inadequate as a long-term solution because they do not prevent the recurrence of loss spikes. Empirically, we identified that the occurrence of spikes is consistently tied to outliers in the MoE layers, and the routing mechanism itself appears to exacerbate the emergence of these outliers. Therefore, we sought to tackle this issue from two dimensions: breaking the vicious cycle induced by routing, and directly suppressing anomalous values. Fortunately, we discovered two practical techniques that effectively maintain training stability. Although a comprehensive theoretical understanding of their underlying mechanisms remains an open question for now, we are sharing them openly to foster further exploration by the community.

训练万亿参数 MoE 模型带来了显著的稳定性挑战, DeepSeek-V4 系列也不例外。我们在训练期间遇到了明显的不稳定性挑战。虽然简单的回滚可以暂时恢复训练状态, 但它们作为长期解决方案被证明是不足的, 因为它们无法防止损失尖峰的复发。根据经验, 我们发现尖峰的发生始终与 MoE 层中的异常值相关, 而路由机制本身似乎加剧了这些异常值的出现。因此, 我们试图从两个维度解决这个问题：打破路由引发的恶性循环, 以及直接抑制异常值。幸运的是, 我们发现了两种有效维持训练稳定性的实用技术。尽管对其底层机制的全面理论理解目前仍是一个开放问题, 但我们公开分享它们以促进社区的进一步探索。

Anticipatory Routing. We found that decoupling the synchronous updates of the backbone network and the routing network significantly improves training稳定性. Consequently, at step $t ,$ we use the current network parameters $\theta _ { t }$ for feature computation, but the routing indices are computed and applied using the historical network parameters $\theta _ { t - \Delta t }$ . In practice, to circumvent the overhead of loading model parameters twice, we fetch the data for step ?? in advance at step ?? − Δ??. We "anticipatorily" compute and cache the routing indices to be used later at step ??, which is why we name this approach Anticipatory Routing. We also heavily optimized this at the infrastructure level. First, given that pre-computing the routing indices only requires a single forward pass over the data, we carefully orchestrated the pipeline execution and the overlapping of computation with Expert Parallelism (EP) communication, successfully bounding the additional wall-clock time overhead of Anticipatory Routing to approximately 20%. Second, we introduced an automatic detection mechanism that triggers a short rollback and activates Anticipatory Routing exclusively when a loss spike occurs; after operating in this mode for a certain period, the system reverts to standard training. Ultimately, this dynamic application allows us to avert loss spikes with negligible overall additional training开销, all without compromising model performance.

预判路由。我们发现解耦骨干网络和路由网络的同步更新可以显著改善训练稳定性。因此, 在步骤 $t$, 我们使用当前网络参数 $\theta _ { t }$ 进行特征计算, 但路由索引的计算和应用使用历史网络参数 $\theta _ { t - \Delta t }$。在实践中, 为了规避两次加载模型参数的开销, 我们在步骤 ?? − Δ?? 提前获取步骤 ?? 的数据。我们"预判地"计算并缓存将在步骤 ?? 使用的路由索引, 这就是我们将此方法命名为 Anticipatory Routing(预判路由)的原因。我们还在基础设施层面大量优化了这一点。首先, 鉴于预计算路由索引仅需要对数据执行单次前向传播, 我们仔细编排了流水线执行以及计算与专家并行 (EP) 通信的重叠, 成功将 Anticipatory Routing 的额外 wall-clock 时间开销限制在约 20%。其次, 我们引入了自动检测机制, 仅在发生损失尖峰时触发短回滚并激活 Anticipatory Routing; 在此模式下运行一段时间后, 系统恢复标准训练。最终, 这种动态应用使我们能够以可忽略的总体额外训练开销避免损失尖峰, 同时不损害模型性能。

SwiGLU Clamping. In previous literature (Bello et al., 2017; Riviere et al., 2024), clamping has been explicitly utilized to constrain numerical ranges, thereby enhancing training稳定性. In our actual training runs, we empirically found that applying SwiGLU clamping (OpenAI, 2025) effectively eliminates outliers and substantially aids in stabilizing the training process, without compromising performance. Throughout the training of both DeepSeek-V4-Flash and DeepSeek-V4-Pro, we clamped the linear component of SwiGLU to the range of [−10, 10], while capping the upper bound of the gate component at 10.

SwiGLU 截断。在先前的文献 (Bello et al., 2017; Riviere et al., 2024) 中, 截断已被明确用于约束数值范围, 从而增强训练稳定性。在我们的实际训练运行中, 我们根据经验发现应用 SwiGLU 截断 (OpenAI, 2025) 可以有效消除异常值并大幅有助于稳定训练过程, 且不会损害性能。在 DeepSeek-V4-Flash 和 DeepSeek-V4-Pro 的整个训练过程中, 我们将 SwiGLU 的线性分量截断到 [−10, 10] 范围, 同时将门控分量的上限限制为 10。

> 译者注: 训练不稳定性是万亿参数 MoE 模型的"阿喀琉斯之踵"。DeepSeek 的两种解决方案极具工程智慧：(1) **Anticipatory Routing** 通过时间解耦(用历史参数计算路由、当前参数计算特征)打破了"异常值 → 路由偏差 → 更异常"的恶性循环。20% 的 wall-time 开销通过流水线重叠来消化, 且只在检测到尖峰时自动启用, 属于"按需防御"。(2) **SwiGLU Clamping** 则是一种简单直接的数值保险——将线性分量限制在 [−10, 10]、门控上限设为 10, 直接剪除极端激活值。两者都不需要修改模型架构, 属于"训练时技巧", 这也解释了为什么论文说"全面理论理解仍是开放问题"。

### 4.3. Evaluations

### 4.3. 评估

#### 4.3.1. Evaluation Benchmarks

#### 4.3.1. 评估基准

For the evaluation of the base models, we consider benchmarks spanning four key dimensions: world knowledge, language understanding and reasoning, coding and mathematics, and longcontext processing.

对于基座模型的评估, 我们考虑了跨越四个关键维度的基准：世界知识、语言理解与推理、编程与数学, 以及长上下文处理。

World knowledge benchmarks include AGIEval (Zhong et al., 2023), C-Eval (Huang et al., 2023), CMMLU (Li et al., 2023) MMLU (Hendrycks et al., 2020), MMLU-Redux (Gema et al., 2024), MMLU-Pro (Wang et al., 2024b), MMMLU (OpenAI, 2024a), MultiLoKo (Hupkes and Bogoychev, 2025), Simple-QA verified (Haas et al., 2025), SuperGPQA (Du et al., 2025), FACTS Parametric (Cheng et al., 2025), and TriviaQA (Joshi et al., 2017).

世界知识基准包括 AGIEval (Zhong et al., 2023)、C-Eval (Huang et al., 2023)、CMMLU (Li et al., 2023)、MMLU (Hendrycks et al., 2020)、MMLU-Redux (Gema et al., 2024)、MMLU-Pro (Wang et al., 2024b)、MMMLU (OpenAI, 2024a)、MultiLoKo (Hupkes and Bogoychev, 2025)、Simple-QA verified (Haas et al., 2025)、SuperGPQA (Du et al., 2025)、FACTS Parametric (Cheng et al., 2025) 和 TriviaQA (Joshi et al., 2017)。

Language understanding and reasoning benchmarks include BigBench Hard (BBH) (Suzgun et al., 2022), DROP (Dua et al., 2019), HellaSwag (Zellers et al., 2019), CLUEWSC (Xu et al., 2020), and WinoGrande (Sakaguchi et al., 2019).

语言理解与推理基准包括 BigBench Hard (BBH) (Suzgun et al., 2022)、DROP (Dua et al., 2019)、HellaSwag (Zellers et al., 2019)、CLUEWSC (Xu et al., 2020) 和 WinoGrande (Sakaguchi et al., 2019)。

Coding and mathematical benchmarks include BigCodeBench (Zhuo et al., 2025), HumanEval (Chen et al., 2021), GSM8K (Cobbe et al., 2021), MATH (Hendrycks et al., 2021), MGSM (Shi et al., 2023), and CMath (Wei et al., 2023).

编程和数学基准包括 BigCodeBench (Zhuo et al., 2025)、HumanEval (Chen et al., 2021)、GSM8K (Cobbe et al., 2021)、MATH (Hendrycks et al., 2021)、MGSM (Shi et al., 2023) 和 CMath (Wei et al., 2023)。

Long context benchmarks include LongBench-V2 (Bai et al., 2025b).

长上下文基准包括 LongBench-V2 (Bai et al., 2025b)。

#### 4.3.2. Evaluation Results

#### 4.3.2. 评估结果

In Table 1, we provide a detailed comparison of the base models for DeepSeek-V3.2, DeepSeek-V4-Flash, and DeepSeek-V4-Pro, all evaluated under a unified internal framework with strictly consistent settings.

在表 1 中, 我们对 DeepSeek-V3.2、DeepSeek-V4-Flash 和 DeepSeek-V4-Pro 的基座模型进行了详细比较, 所有模型均在统一的内部框架下以严格一致的设置进行评估。

Comparing DeepSeek-V4-Flash-Base with DeepSeek-V3.2-Base reveals a compelling efficiency story. Despite utilizing a substantially smaller number of both activated and total parameters, DeepSeek-V4-Flash-Base outperforms DeepSeek-V3.2-Base across a wide array of benchmarks. This advantage is especially evident in world knowledge tasks and challenging long-context scenarios. These results underscore that architectural improvements, refined data quality, and training optimizations in DeepSeek-V4-Flash-Base yield superior performance even with a more compact parameter budget, effectively surpassing the larger DeepSeek-V3.2-Base on the majority of evaluations.

将 DeepSeek-V4-Flash-Base 与 DeepSeek-V3.2-Base 进行比较, 揭示了一个引人注目的效率故事。尽管使用的激活参数和总参数数量都大幅减少, DeepSeek-V4-Flash-Base 在广泛的基准测试中仍优于 DeepSeek-V3.2-Base。这一优势在世界知识任务和具有挑战性的长上下文场景中尤为明显。这些结果强调, DeepSeek-V4-Flash-Base 的架构改进、精炼的数据质量和训练优化即使在更紧凑的参数预算下也能产生更优越的性能, 在大多数评估中有效超越了更大的 DeepSeek-V3.2-Base。

Furthermore, DeepSeek-V4-Pro-Base demonstrates a further, decisive leap in capability, establishing near-universal dominance over both DeepSeek-V3.2-Base and DeepSeek-V4-Flash-Base. With improvements across almost all categories, DeepSeek-V4-Pro-Base reaches new performance highs among DeepSeek base models on the most demanding benchmarks. On knowledge-intensive evaluations, it delivers dramatic gains, while also substantially advancing long-context understanding. On most reasoning and code benchmarks, DeepSeek-V4-Pro-Base also exceeds both previous models. This comprehensive uplift confirms DeepSeek-V4-Pro-Base as the strongest foundation model in the DeepSeek series, outperforming its predecessors across the spectrum of knowledge、reasoning、coding、and long-context capabilities.

此外, DeepSeek-V4-Pro-Base 展示了进一步的决定性能力飞跃, 对 DeepSeek-V3.2-Base 和 DeepSeek-V4-Flash-Base 都建立了近乎全面的优势。在几乎所有类别上都有改进, DeepSeek-V4-Pro-Base 在最苛刻的基准上达到了 DeepSeek 基座模型中的新性能高度。在知识密集型评估中, 它带来了显著提升, 同时大幅推进了长上下文理解。在大多数推理和代码基准上, DeepSeek-V4-Pro-Base 也超越了前两个模型。这种全面的提升确认了 DeepSeek-V4-Pro-Base 是 DeepSeek 系列中最强大的基础模型, 在知识、推理、编程和长上下文能力谱系上均优于其前辈。

Table 1 
| Comparison among DeepSeek-V3.2-Base, DeepSeek-V4-Flash-Base, and DeepSeek-V4- Pro-Base. All models are evaluated in our internal framework and share the same evaluation setting. Scores with a gap not exceeding 0.3 are considered to be at the same level. The highest score in each row is in bold font, and the second is underlined.

表 1 | DeepSeek-V3.2-Base、DeepSeek-V4-Flash-Base 和 DeepSeek-V4-Pro-Base 的比较。所有模型均在我们的内部框架中评估, 并共享相同的评估设置。差距不超过 0.3 的分数被视为同一水平。每行中的最高分以粗体显示, 第二高分以下划线显示。

> **表格数据概述**：表 1 以 HTML 表格形式呈现在原文中(参见 D3 原文：`docs/sections/llm-guide/14-主流开源模型全景解析与技术报告精读/14.1-DeepSeek/10-DeepSeek-V4/03-DeepSeek-V4-mineru-en.md`, 约第 562–563 行)。该表从世界知识(World Knowl.)、语言与推理(Lang. & Reas.)、编程与数学(Code & Math)等维度, 对比了三个基座模型在 20+ 项基准上的零样本/少样本表现。数据要点如下：
> 1. **架构与规模**：V3.2-Base 为 671B 总参 / 37B 激活; V4-Flash-Base 为 284B 总参 / 13B 激活; V4-Pro-Base 为 1.6T 总参 / 49B 激活。
> 2. **V4-Flash-Base 的效率优势**：在激活参数不到 V3.2-Base 一半(13B vs 37B)、总参不到一半(284B vs 671B)的情况下, V4-Flash-Base 在 AGIEval、MMLU、C-Eval、CMMLU 等多项基准上超过 V3.2-Base, 长上下文(LongBench-V2)优势尤为显著。
> 3. **V4-Pro-Base 的全面领先**：在 FACTS Parametric(62.6 vs 27.1)、Simple-QA verified(55.2 vs 28.3)、MMLU-Pro(73.5 vs 65.5)等知识密集型任务上, V4-Pro-Base 相对 V3.2-Base 取得了巨大提升; 在 DROP、HellaSwag、WinoGrande 等推理任务以及 HumanEval、GSM8K、MATH 等代码/数学任务上也全面领先。
> 4. **数据来源与可信度**：所有分数均来自 DeepSeek 内部评估框架, 非第三方独立评测。虽然设置"严格一致", 但读者应注意潜在的利益相关偏差。建议在参考时结合公开基准的第三方复现结果。

> 译者注: 评估结果验证了 V4 架构创新的有效性。最令人惊讶的是 V4-Flash——以不到 V3.2 一半的激活参数, 在多数任务上实现超越。这说明架构效率的提升(CSA/HCA、mHC、Muon、数据质量)可以完全抵消参数规模的劣势。V4-Pro 则在知识密集型任务上展现了"大力出奇迹"的威力, FACTS Parametric 和 Simple-QA 的翻倍式提升表明 1.6T 总参数在长尾事实记忆上具有结构性优势。但需要警惕：这些均为内部评测分数, 且"差距不超过 0.3 视为同级"的设定可能平滑了部分真实差异。


## 5. Post-Training

### 5.1. Post-Training Pipeline

Following pre-training, we conducted a post-training phase to yield the final models of DeepSeek-V4 series. Although the training pipeline largely mirrored that of DeepSeek-V3.2, a critical methodological substitution was made: the mixed Reinforcement Learning (RL) stage was entirely replaced by On-Policy Distillation (OPD; Gu et al., 2024; Lu and Lab, 2025).

预训练之后, 我们进行了后训练阶段, 以得到 DeepSeek-V4 系列的最终模型。虽然训练流程大体上与 DeepSeek-V3.2 相似, 但一项关键的方法论替换被引入：混合强化学习(RL)阶段被完全替换为在线策略蒸馏(OPD; Gu et al., 2024; Lu and Lab, 2025)。

> 译者注：DeepSeek 在此处做出了一个大胆的技术路线切换——用 OPD 完全取代混合 RL。混合 RL 是 V3/V3.2 时代将多个领域专家通过强化学习合并的核心手段, 但存在训练不稳定、奖励 hacking、专家间冲突等问题。OPD 通过在策略轨迹上进行 logits 级别的知识蒸馏, 实现了更稳定的梯度估计和更忠实的知识迁移。这种"以蒸馏代合并"的思路, 反映了后训练社区从"硬优化"向"软对齐"演进的一种趋势。不过, OPD 依赖高质量的教师模型和充足的蒸馏数据, 其最终效果是否在所有场景下都优于混合 RL, 仍需更多第三方验证。

#### 5.1.1. Specialist Training

The development of domain specialists was conducted by adapting the DeepSeek-V3.2 training pipeline. Specifically, each model was sequentially optimized through an initial fine-tuning phase and subsequent Reinforcement Learning (RL) guided by domain-specific prompts and reward signals. For the RL stage, we implemented the Group Relative Policy Optimization (GRPO) algorithm, maintaining hyper-parameters closely aligned with our prior research (DeepSeek-AI, 2025; DeepSeek-AI, 2025).

领域专家模型的开发基于 DeepSeek-V3.2 训练流程进行适配。具体而言, 每个模型依次经过初始微调阶段和随后的强化学习(RL)优化, RL 阶段由领域特定的提示和奖励信号引导。在 RL 阶段, 我们采用了组相对策略优化(GRPO)算法, 超参数设置与我们先前的工作保持一致(DeepSeek-AI, 2025; DeepSeek-AI, 2025)。

Reasoning Efforts. It is widely recognized that a model's performance on reasoning tasks is fundamentally governed by the computational effort expended. Consequently, we trained distinct specialist models under divergent RL configurations to facilitate the development of models optimized for varying reasoning capacities. As detailed in Table 2, DeepSeek-V4-Pro and DeepSeek-V4-Flash both support three specific reasoning effort modes. For each mode, we apply distinct length penalties and context windows during RL training, which results in varying output token lengths for reasoning. To integrate these distinct reasoning modes, we utilize specialized response formats demarcated by the `<think>` and `</think>` tokens. Furthermore, for the "Think Max" mode, we prepend a specific instruction to the beginning of the system prompt to guide the model's reasoning process, as shown in Table 3.

推理投入。模型在推理任务上的表现从根本上由其消耗的计算量决定, 这是广泛认可的共识。因此, 我们在不同的 RL 配置下训练了不同的专家模型, 以促进针对各种推理能力进行优化的模型开发。如表 2 所述, DeepSeek-V4-Pro 和 DeepSeek-V4-Flash 均支持三种特定的推理投入模式。每种模式在 RL 训练中应用不同的长度惩罚和上下文窗口, 从而导致推理输出长度不同。为了整合这些不同的推理模式, 我们使用以 `<think>` 和 `</think>` 标记分隔的专用响应格式。此外, 对于"Think Max"模式, 我们在系统提示的开头前置一条特定指令来引导模型的推理过程, 如表 3 所示。

Table 2 | Comparison of three reasoning modes

表 2 | 三种推理模式的比较

> **表格概述**：表 2 以 HTML 表格形式呈现在原文中(参见 D3 原文, 约第 577–578 行)。该表对比了三种推理模式：
> 1. **Non-think(不思考)**：快速、直觉式的响应, 基于应急反应、习惯或简单的低风险决策。典型场景：日常例行任务。响应格式：直接输出总结, 不包含 `<think>` 块。
> 2. **Think High(深度思考)**：有意识的逻辑分析, 速度较慢但更准确。典型场景：复杂问题求解、规划、中等风险决策。响应格式：`<think>` 推理 token `</think>` 总结。
> 3. **Think Max(极限思考)**：将推理推向极致, 缓慢但强大。典型场景：探索模型推理能力的边界。响应格式：1) 在系统提示开头注入特殊指令; 2) `<think>` 推理 token `</think>` 总结。

Table 3 
| Instruction injected into the system prompt for the "Think Max" mode.

表 3 | "Think Max" 模式下注入系统提示的指令

> **表格概述**：表 3 以 HTML 表格形式呈现在原文中(参见 D3 原文, 约第 580–581 行)。注入的指令核心内容为："推理投入：绝对最高级别, 不允许任何捷径。你必须在思考中做到极为详尽, 全面分解问题以解决根本原因, 针对所有潜在路径、边界情况和对抗性场景对你的逻辑进行严格的压力测试。明确写出你的整个审议过程, 记录每一个中间步骤、考虑过的替代方案和已被排除的假设, 以确保没有任何假设未经检验。" 这段指令的设计明显受到了 OpenAI o1 系列"展开全部思维链"策略的启发, 通过显式要求模型暴露完整推理过程来压榨极限性能。

Generative Reward Model. Typically, easy-to-verify tasks can be effectively optimized using simple rule-based verifiers or test cases. In contrast, hard-to-verify tasks traditionally rely on Reinforcement Learning from Human Feedback (RLHF), which necessitates extensive human annotation to train a scalar reward model. In the post-training phase of DeepSeek-V4 series, however, we dispense with these conventional scalar-based reward models. Instead, to address hard-to-verify tasks, we curate rubric-guided RL data and employ a Generative Reward Model (GRM) to evaluate policy trajectories. Crucially, we apply RL optimization directly to the GRM itself. In this paradigm, the actor network natively functions as the GRM, enabling the joint optimization of the model's evaluative (judging) proficiency alongside its standard generative capabilities. By unifying these roles, the model's internal reasoning capabilities are inherently fused into its evaluative process, resulting in highly robust scoring. Furthermore, this approach achieves superior performance with only a minimal set of diverse human annotations, as the model leverages its own logic to generalize across complex tasks.

生成式奖励模型。通常, 易于验证的任务可以通过简单的基于规则的验证器或测试用例有效优化。相比之下, 难以验证的任务传统上依赖基于人类反馈的强化学习(RLHF), 这需要大量人工标注来训练标量奖励模型。然而, 在 DeepSeek-V4 系列的后训练阶段, 我们摒弃了这些传统的基于标量的奖励模型。取而代之, 为了处理难以验证的任务, 我们策划了基于评分标准的 RL 数据, 并采用生成式奖励模型(GRM)来评估策略轨迹。至关重要的是, 我们直接对 GRM 本身应用 RL 优化。在这种范式下, 演员网络原生地充当 GRM, 使得模型的评估(判断)能力能够与其标准生成能力进行联合优化。通过统一这些角色, 模型内部的推理能力被固有地融合到评估过程中, 从而产生高度稳健的评分。此外, 由于模型利用自身的逻辑在复杂任务上进行泛化, 这种方法仅需极少量的多样化人工标注即可实现卓越性能。

> 译者注：GRM 是 V4 后训练中一个值得关注的创新。传统 RLHF 需要训练一个独立的标量奖励模型(通常是一个额外的分类头), 这不仅需要大量偏好数据, 还存在奖励 hacking 和分布外泛化差的问题。V4 的做法是让模型自己充当裁判——利用同一个模型的生成能力来产出评估判断, 并通过 RL 同时优化"生成"和"评判"两种能力。这与 Kimi K1.5 报告中的"自引用奖励"以及 DeepSeek-R1 中的"基于规则的验证"形成了有趣的技术谱系对比。其优势在于减少了对人类标注的依赖, 但风险在于模型可能学会"自我欺骗"式的评分, 尤其是在缺乏外部真值锚定的开放式任务上。

Table 4 
| Tool-call schema for DeepSeek-V4 series.

表 4 | DeepSeek-V4 系列的工具调用 schema

![](images/fig07a_toolcall_schema.jpg)

Tool-Call Schema and Special Token. Consistent with our previous version, we utilize a dedicated `<think></think>` tag to delineate the reasoning path. In DeepSeek-V4 series, we introduce a new tool-call schema that employs a special "|DSML|" token and utilizes an XML-based format for tool invocations, as demonstrated in Table 4. Our experiments demonstrate that the XML format effectively mitigates escaping failures and reduces tool-call errors, providing a more robust interface for model-tool interactions.

工具调用 Schema 与特殊 Token。与前一版本保持一致, 我们使用专用的 `<think></think>` 标签来界定推理路径。在 DeepSeek-V4 系列中, 我们引入了一种新的工具调用 schema, 它使用特殊的 `|DSML|` token, 并采用基于 XML 的格式进行工具调用, 如表 4 所示。我们的实验表明, XML 格式有效缓解了转义失败问题并减少了工具调用错误, 为模型与工具的交互提供了更稳健的接口。

![](images/fig07b_thinking_with_tools.jpg)

a) Thinking with tools  
![](images/fig07c_thinking_without_tools.jpg)  
b) Thinking without tools  
Figure 7 | Thinking management of DeepSeek-V4 series.

a) 带工具的推理  
b) 不带工具的推理  
图 7 | DeepSeek-V4 系列的推理管理

Interleaved Thinking. DeepSeek-V3.2 introduced a context management strategy that retains reasoning traces across tool-result rounds but discards them upon the arrival of new user messages. While effective, this still caused unnecessary token waste in complex agentic workflows — each new user turn would flush all accumulated reasoning content, forcing the model to reconstruct its problem-solving state from scratch. Leveraging the expanded 1M-token context window of DeepSeek-V4 series, we further refine this mechanism to maximize the effectiveness of interleaved thinking in agentic environments:

交错式推理。DeepSeek-V3.2 引入了一种上下文管理策略：在工具结果轮次之间保留推理痕迹, 但在收到新的用户消息时将其丢弃。虽然有效, 但这在复杂的智能体工作流中仍造成了不必要的 token 浪费——每次新的用户轮次都会清空所有已累积的推理内容, 迫使模型从头重建其问题求解状态。利用 DeepSeek-V4 系列扩展的 1M token 上下文窗口, 我们进一步细化了这一机制, 以最大化智能体环境中交错式推理的有效性：

• Tool-Calling Scenarios. As illustrated in Figure 7(a), all reasoning content is fully preserved throughout the entire conversation. Unlike DeepSeek-V3.2, which discarded thinking traces upon each new user turn, DeepSeek-V4 series retain the complete reasoning history across all rounds, including across user message boundaries. This allows the model to maintain a coherent, cumulative chain of thought over long-horizon agent tasks.

• 工具调用场景。如图 7(a) 所示, 所有推理内容在整个对话过程中被完整保留。与 DeepSeek-V3.2 不同——后者在每次新的用户轮次时丢弃思考痕迹——DeepSeek-V4 系列在所有轮次中保留完整的推理历史, 包括跨越用户消息边界的情况。这使得模型能够在长程智能体任务上保持连贯、累积的思维链。

• General Conversational Scenarios. As illustrated in Figure 7(b), the original strategy is preserved: reasoning content from previous turns is discarded when a new user message arrives, keeping the context concise for settings where persistent reasoning traces provide limited benefit.

• 一般对话场景。如图 7(b) 所示, 原始策略被保留下来：当新的用户消息到达时, 之前轮次的推理内容被丢弃, 从而在持久化推理痕迹收益有限的场景中保持上下文简洁。

As with DeepSeek-V3.2, agent frameworks that simulate tool interactions via user messages (e.g., Terminus) may not trigger the tool-calling context path and thus may not benefit from enhanced reasoning persistence. We continue to recommend non-think models for such architectures.

与 DeepSeek-V3.2 一样, 通过用户消息模拟工具交互的智能体框架(例如 Terminus)可能不会触发工具调用的上下文路径, 因此可能无法受益于增强的推理持久化。对于此类架构, 我们继续推荐使用 non-think 模型。

Table 5 
| Quick Instruction special tokens for auxiliary tasks.

表 5 | 辅助任务的 Quick Instruction 特殊 Token

> **表格概述**：表 5 以 HTML 表格形式呈现在原文中(参见 D3 原文, 约第 606–607 行)。该表列举了用于辅助任务的 Quick Instruction 特殊 token, 包括：
> - `<|action|>`：判断用户提示是否需要网络搜索或可直接回答。
> - `<|title|>`：在首次助手响应后生成简洁的对话标题。
> - `<|query|>`：为用户提示生成搜索查询。
> - `<|authority|>`：对用户提示的权威来源需求进行分类。
> - `<|domain|>`：识别用户提示所属领域。
> - `<|extracted_url|>` / `<|read_url|>`：判断用户提示中的 URL 是否需要抓取和阅读。
> 每种 token 均有对应的输入格式模板, 模型通过在已有 KV cache 后直接追加这些 token 来完成辅助任务, 避免了冗余的预填充计算。

Quick Instruction. In chatbot scenarios, a number of auxiliary tasks (e.g., determining whether to trigger a web search, intent recognition, etc.) must be executed before generating the response. Conventionally, these tasks are handled by a separate small model, requiring redundant prefilling since it cannot reuse the existing KV cache. To overcome this limitation, we introduce Quick Instruction. We append a set of dedicated special tokens directly to the input sequence, where each token corresponds to a specific auxiliary task. By directly reusing the already-computed KV cache, this mechanism completely avoids redundant prefilling and allows certain tasks, such as generating search queries and determining authority and domain, to be executed in parallel. Consequently, this approach significantly reduces the user-perceived time-to-first-token (TTFT) and eliminates the engineering overhead of maintaining and iterating an extra small model. The supported Quick Instruction tokens are summarized in Table 5.

Quick Instruction。在聊天机器人场景中, 若干辅助任务(例如判断是否触发网络搜索、意图识别等)必须在生成响应之前执行。传统上, 这些任务由一个独立的小模型处理, 由于无法复用已有的 KV cache, 需要冗余的预填充计算。为了克服这一限制, 我们引入了 Quick Instruction。我们直接在输入序列后追加一组专用的特殊 token, 每个 token 对应一个特定的辅助任务。通过直接复用已计算的 KV cache, 该机制完全避免了冗余预填充, 并允许某些任务(如生成搜索查询、判断权威性和领域)并行执行。因此, 这种方法显著降低了用户感知的首次 token 时间(TTFT), 并消除了维护和迭代额外小模型的工程开销。支持的 Quick Instruction token 汇总于表 5。

> 译者注：Quick Instruction 是一个精妙的工程优化, 其本质是将"小模型做前置任务"改为"在大模型已计算的 KV cache 上追加特殊 token 做并行预测"。这避免了为辅助任务重新预填充 prompt 的开销, 在降低 TTFT 的同时简化了系统架构。不过, 这种设计依赖于 base model 本身对辅助任务的理解能力足够强, 否则直接在主模型上预测可能比专用小模型准确率更低。DeepSeek 没有公开 Quick Instruction 的准确率对比数据, 这是一个值得关注的遗漏。

#### 5.1.2. On-Policy Distillation

After training multiple domain-specific experts via specialized fine-tuning and reinforcement learning, we employ multi-teacher On-Policy Distillation (OPD; Gu et al. 2024; Lu and Lab 2025) as the primary technique for merging expert capabilities into the final model. OPD has emerged as an effective post-training paradigm for efficiently transferring the knowledge and capabilities of domain experts to a single, unified model. This is achieved by having the student learn from the output distributions of teacher models on its own generated trajectories. Formally, given a set of ?? expert models $\{ \pi _ { E _ { 1 } } , \pi _ { E _ { 2 } } , \ldots , \pi _ { E _ { N } } \}$ , the OPD objective function is defined as:

通过在专用微调和强化学习训练多个领域专家后, 我们采用多教师在线策略蒸馏(OPD; Gu et al. 2024; Lu and Lab 2025)作为主要技术, 将专家能力合并到最终模型中。OPD 已成为一种有效的后训练范式, 用于高效地将领域专家的知识和能力迁移到单一统一模型中。这通过让学生模型在自己的生成轨迹上学习教师模型的输出分布来实现。形式上, 给定一组 ?? 个专家模型 $\{ \pi _ { E _ { 1 } } , \pi _ { E _ { 2 } } , \ldots , \pi _ { E _ { N } } \}$, OPD 目标函数定义为：

$$
\mathcal { L } _ { \mathrm { O P D } } ( \boldsymbol { \theta } ) = \sum _ { i = 1 } ^ { N } w _ { i } \cdot \operatorname { D } _ { \mathrm { K L } } \left( \pi _ { \boldsymbol { \theta } } \parallel \pi _ { E _ { i } } \right) .\tag{29}
$$

In this formulation, ???? represents the assigned weight for each expert, typically determined by the relative importance of the expert. Computing the reverse KL loss $\operatorname{D}_{\mathrm{KL}}\left( \pi _ { \theta } \parallel \pi _ { E _ { i } } \right)$ requires sampling training trajectories from the student $\pi _ { \theta }$ to maintain on-policy learning. The underlying logic ensures that the unified policy $\pi _ { \theta }$ selectively learns from the specialized expert relevant to the current task context (e.g., aligning with the mathematics expert for math reasoning tasks and the coding expert for programming tasks). Through this mechanism, the knowledge from physically distinct expert weights is consolidated into a unified parameter space via logits-level alignment, practically circumventing the performance degradation often encountered in traditional weight-merging or mixed RL techniques. In this stage, more than ten teacher models covering various domains are employed to distill a single student model.

在该公式中, ???? 表示为每个专家分配的权重, 通常由专家的相对重要性决定。计算反向 KL 损失 $\operatorname{D}_{\mathrm{KL}}\left(\pi_{\theta} \parallel \pi_{E_{i}}\right)$ 需要从学生模型 $\pi_{\theta}$ 采样训练轨迹以保持在线策略学习。其底层逻辑确保统一策略 $\pi_{\theta}$ 选择性地从与当前任务上下文相关的专家处学习(例如, 数学推理任务对齐数学专家, 编程任务对齐代码专家)。通过这一机制, 物理上分离的专家权重中的知识通过 logits 级别的对齐被整合到统一的参数空间中, 实际规避了传统权重合并或混合 RL 技术中经常遇到的性能下降问题。在此阶段, 采用了覆盖多个领域的十余个教师模型来蒸馏单一学生模型。

In handling the above OPD objective, prior works usually simplify the full-vocabulary KL loss into a token-level KL estimate at each token position, and reuse RL framework by replacing $\begin{array} { r } { \mathbf { s g } \big [ \log \frac { \pi _ { E _ { i } } ( y _ { t } | x , y _ { < t } ) } { \pi _ { \theta } ( y _ { t } | x , y _ { < t } ) } \big ] } \end{array}$ (sg represents the stop gradient operation) as the per-token advantage estimate in the policy loss calculation. Although this approach is resource-efficient, it leads to high variance in gradient estimation and often causes training instability. Therefore, we adopt full-vocabulary logit distillation in our OPD. Preserving the complete logit distribution in calculating reverse KL loss yields more stable gradient estimates and ensures faithful distillation of the teachers' knowledge. In the following subsection, we describe the engineering efforts that make full-vocabulary OPD feasible at scale.

在处理上述 OPD 目标时, 先前工作通常将全词表 KL 损失简化为每个 token 位置的 token 级 KL 估计, 并通过将 $\begin{array}{r} \mathbf{sg}\big[\log \frac{\pi_{E_{i}}(y_{t}|x,y_{<t})}{\pi_{\theta}(y_{t}|x,y_{<t})}\big] \end{array}$(sg 表示停止梯度操作)替换为策略损失计算中的逐 token 优势估计来复用 RL 框架。虽然这种方法在资源利用上更高效, 但它导致梯度估计的高方差, 并经常引发训练不稳定。因此, 我们在 OPD 中采用全词表 logit 蒸馏。在计算反向 KL 损失时保留完整的 logit 分布, 可以产生更稳定的梯度估计, 并确保对教师知识的忠实蒸馏。在下一小节中, 我们将描述使全词表 OPD 在大规模上可行的工程努力。

> 译者注：全词表 logit 蒸馏与 token 级 KL 的核心差异在于信息粒度。token 级方法只比较每个位置上的单个概率值, 计算量小但方差大; 全词表方法比较整个词汇表上的分布, 计算量巨大但梯度更稳定、蒸馏更忠实。V4 声称采用了全词表蒸馏, 这需要极大的工程投入——后面 5.2.2 节描述的"教师调度系统"正是为此而设。值得注意的是, "十余个教师模型"覆盖多个领域, 这与传统 MoE 中"一个模型内多个专家"的思路不同：OPD 是在后训练阶段将多个独立训练的专家蒸馏到统一模型中, 属于"模型级别的知识融合"而非"子模块级别的路由选择"。

### 5.2. Post-Training Infrastructures

Our post-training infrastructure is built upon the scalable framework developed for DeepSeek-V3.2. Specifically, we integrate the same distributed training stack described in Section 3.4 and the rollout engine introduced earlier for efficient auto-regressive sampling. Building on this foundation, we introduce the following principal enhancements in the present work. These designs enable efficient execution of ultra-long-context RL and OPD merging tasks involving over ten distinct teacher models, thereby substantially accelerating the iteration cycle for model releases.

我们的后训练基础设施建立在为 DeepSeek-V3.2 开发的可扩展框架之上。具体而言, 我们集成了第 3.4 节中描述的相同分布式训练栈, 以及前面介绍的用于高效自回归采样的 rollout 引擎。在此基础上, 我们在本工作中引入了以下主要增强。这些设计使得超长上下文 RL 和涉及十余个不同教师模型的 OPD 合并任务能够高效执行, 从而大幅加速了模型发布的迭代周期。

#### 5.2.1. FP4 Quantization-Aware Training

To achieve inference acceleration and reducing memory traffic at deployment, we introduce Quantization-Aware Training (QAT) (Jacob et al., 2018) during the post-training stage, enabling the model, including those of teacher and reference models, to adapt to the precision degradation introduced by quantization. We apply FP4 (MXFP4) quantization (Rouhani et al., 2023) to two components: (1) MoE expert weights, which are a major source of GPU memory occupancy (OpenAI, 2025), and (2) the Query-Key (QK) path in the indexer of CSA, where QK activations are cached, loaded, and multiplied entirely in FP4, accelerating attention score computation in long-context scenarios. In addition, we further quantize the index scores $I _ { : , : }$ from FP32 to BF16 during this QAT process. This optimization achieves a 2× speedup for the top-k selector, while preserving a 99.7% recall rate of KV entries.

为了实现推理加速并减少部署时的内存流量, 我们在后训练阶段引入了量化感知训练(QAT)(Jacob et al., 2018), 使模型(包括教师模型和参考模型)能够适应量化引入的精度退化。我们将 FP4(MXFP4)量化(Rouhani et al., 2023)应用于两个组件：(1) MoE 专家权重, 这是 GPU 内存占用的主要来源(OpenAI, 2025); (2) CSA 索引器中的 Query-Key(QK)路径, 其中 QK 激活完全以 FP4 进行缓存、加载和相乘, 从而加速长上下文场景下的注意力分数计算。此外, 我们在该 QAT 过程中进一步将索引分数 $I_{:,:}$ 从 FP32 量化为 BF16。这一优化为 top-k 选择器实现了 2 倍加速, 同时保持了 99.7% 的 KV 条目召回率。

For MoE expert weights, following the common practice of QAT, the FP32 master weights maintained by the optimizer are first quantized to FP4, then dequantized back to FP8 for computation. Notably, our FP4-to-FP8 dequantization is lossless. This is because FP8 (E4M3) has 2 additional exponent bits compared with FP4 (E2M1), offering a larger dynamic range. Consequently, as long as the ratio between the maximum and minimum scale factors of the FP4 sub-blocks (1 × 32 tiles) within each FP8 quantization block (128 × 128 tiles) does not exceed a certain threshold, the fine-grained scale information can be fully absorbed by the extended dynamic range of FP8. We empirically verify that current weights satisfy this condition. This allows the entire QAT pipeline to fully reuse the existing FP8 training framework without any modification. In the backward pass, gradients are computed with respect to the same FP8 weights in the forward pass and directly propagated back to the FP32 master weights, equivalent to applying the Straight-Through Estimator (STE) through the quantization operation. This also avoids the need to re-quantize transposed weights.

对于 MoE 专家权重, 按照 QAT 的常规做法, 优化器维护的 FP32 主权重首先被量化为 FP4, 然后反量化回 FP8 进行计算。值得注意的是, 我们的 FP4 到 FP8 反量化是无损的。这是因为 FP8(E4M3)相比 FP4(E2M1)有 2 个额外的指数位, 提供了更大的动态范围。因此, 只要每个 FP8 量化块(128 × 128 tiles)内 FP4 子块(1 × 32 tiles)的最大与最小缩放因子之比不超过某一阈值, 精细的缩放信息就能被 FP8 扩展的动态范围完全吸收。我们经验性地验证了当前权重满足这一条件。这使得整个 QAT 流程能够完全复用现有的 FP8 训练框架而无需任何修改。在反向传播中, 梯度相对于前向传播中相同的 FP8 权重计算, 并直接回传到 FP32 主权重, 这等价于通过量化操作应用直通估计器(STE)。这也避免了对转置权重进行重新量化的需要。

During the inference and rollout phases of RL training, which do not involve backward passes, we directly use native FP4 quantized weights instead of simulated quantization. This ensures that model behavior during sampling is fully consistent with online deployment, while also reducing kernel memory loading for actual speedup and significantly lowering memory consumption. We process the QK path in the indexer of CSA similarly.

在 RL 训练的推理和 rollout 阶段(不涉及反向传播), 我们直接使用原生 FP4 量化权重而非模拟量化。这确保了采样期间的模型行为与在线部署完全一致, 同时减少了内核内存加载以实现实际加速, 并显著降低了内存消耗。我们对 CSA 索引器中的 QK 路径进行类似的处理。

#### 5.2.2. Efficient Teacher Scheduling for Full-Vocabulary OPD

Our framework supports full-vocabulary On-Policy Distillation (OPD) with an effectively unbounded number of teachers, each potentially comprising trillions of parameters. To enable this, all teacher weights are offloaded to a centralized distributed storage and are loaded on demand during the teacher forward pass with ZeRO-like parameter sharding to alleviate both I/O and DRAM pressure. Furthermore, naively materializing logits for a vocabulary size $|??| > 100\text{k}$ across all teachers is prohibitive, even when spooled to disk. We address this by caching only the last-layer teacher hidden states in a centralized buffer during the forward pass. At training time, these cached states are retrieved and passed through the corresponding prediction head module to reconstruct the full logits on the fly. This design incurs negligible recomputation overhead while completely circumventing the memory burden associated with explicit logits materialization. To mitigate the GPU memory footprint of the teacher prediction head, we order training samples by teacher index during data dispatching. This arrangement ensures that each distinct teacher head is loaded only once per mini-batch and that at most one teacher head resides in device memory at any given time. All parameters and hidden state loading/offloading operations proceed asynchronously in the background, without blocking computation on the critical path. Finally, the exact KL divergences between teacher and student logits are computed using a specialized TileLang kernel, which accelerates the computation and curtails dynamic memory allocation.

我们的框架支持全词表在线策略蒸馏(OPD), 教师数量实际上无上限, 每个教师可能包含数万亿参数。为实现这一点, 所有教师权重被卸载到集中式分布式存储中, 并在教师前向传播期间按需加载, 采用类似 ZeRO 的参数分片以缓解 I/O 和 DRAM 压力。此外, 简单地为所有教师物化词汇量 $|??| > 100\text{k}$ 的 logit 是不可行的, 即使转储到磁盘也是如此。我们通过在前向传播期间仅将教师最后一层的隐藏状态缓存到集中式缓冲区来解决这一问题。在训练时, 这些缓存的状态被取出并通过对应的预测头模块来即时重建完整的 logit。这种设计产生了可忽略不计的重计算开销, 同时完全规避了与显式 logit 物化相关的内存负担。为了缓解教师预测头的 GPU 内存占用, 我们在数据分发期间按教师索引对训练样本进行排序。这种安排确保每个不同的教师头每 mini-batch 仅加载一次, 且在任意时刻设备内存中最多只有一个教师头。所有参数和隐藏状态的加载/卸载操作在后台异步进行, 不会阻塞关键路径上的计算。最后, 教师与学生 logit 之间的精确 KL 散度使用专用的 TileLang 内核计算, 该内核加速了计算并减少了动态内存分配。

#### 5.2.3. Preemptible and Fault-Tolerant Rollout Service

To maximize GPU resource utilization while enabling rapid hardware provisioning for high-priority tasks, our GPU cluster employs a cluster-wide preemptive task scheduler, where any running task may be preempted at any time. Also, hardware failures are prevalent in large-scale GPU clusters. To this end, we implement a preemptible and fault-tolerant LLM generation service for RL/OPD rollout.

为了在最大化 GPU 资源利用率的同时为高优先级任务实现快速的硬件供应, 我们的 GPU 集群采用了一个集群范围内的抢占式任务调度器, 任何正在运行的任务都可能随时被抢占。此外, 硬件故障在大规模 GPU 集群中十分常见。为此, 我们为 RL/OPD rollout 实现了一个可抢占且容错的 LLM 生成服务。

Specifically, we implement a token-granular Write-Ahead Log (WAL) for each generation request. Whenever a new token is generated for a request, we immediately append it to that request's WAL. During preemption, we pause the inference engine and save the KV cache of unfinished requests. Upon resumption, we use the persisted WALs and saved KV cache to continue decoding. Even when a fatal hardware error occurs, we can re-run the prefill phase using the persisted tokens in WAL to reconstruct the KV cache.

具体而言, 我们为每个生成请求实现了 token 粒度的预写日志(WAL)。每当为一个请求生成新 token 时, 我们立即将其追加到该请求的 WAL 中。在发生抢占时, 我们暂停推理引擎并保存未完成请求的 KV cache。恢复时, 我们使用持久化的 WAL 和保存的 KV cache 继续解码。即使发生致命硬件错误, 我们也可以使用 WAL 中持久化的 token 重新运行预填充阶段来重建 KV cache。

Importantly, it is mathematically incorrect to regenerate unfinished requests from scratch, as this introduces length bias. Because shorter responses are more likely to survive interruption, regenerating from scratch makes the model more prone to producing shorter sequences whenever an interruption occurs. If the inference stack is batch-invariant and deterministic, this correctness issue could also be addressed by regenerating with a consistent seed for the pseudorandom number generator used in the sampler. However, this approach still incurs the extra cost of re-running the decoding phase, making it far less efficient than our token-granular WAL method.

重要的是, 从头重新生成未完成的请求在数学上是不正确的, 因为这会引入长度偏差。由于较短的响应更有可能在中断中存活下来, 从头重新生成会使模型在中断发生时更倾向于产生更短的序列。如果推理栈是批次不变且确定性的, 这一正确性问题也可以通过使用采样器中伪随机数生成器的一致种子重新生成来解决。然而, 这种方法仍会产生重新运行解码阶段的额外开销, 使其远比我们的 token 粒度 WAL 方法低效。

#### 5.2.4. Scaling RL Framework for Million-Token Context

We introduce targeted optimizations for efficient RL and OPD on million-token sequences. During the rollout phase, we adopt a preemptible and fault-tolerant rollout service, detailed in Section 5.2.3. For the inference and training phase, we decompose the rollout data format into lightweight metadata and heavy per-token fields. During data dispatching, the metadata for the entire rollout data can be loaded to perform global shuffling and packing layout computation. Heavy per-token fields are loaded via a shared-memory data loader to eliminate intra-node data redundancy and are released immediately upon consumption at the mini-batch granularity, substantially reducing both CPU and GPU memory pressure. The number of on-device minibatches is dynamically determined based on workload, allowing an efficient trade-off between computational throughput and I/O overlap.

我们引入了针对性的优化, 以在百万 token 序列上实现高效的 RL 和 OPD。在 rollout 阶段, 我们采用第 5.2.3 节中详细描述的可抢占且容错的 rollout 服务。在推理和训练阶段, 我们将 rollout 数据格式分解为轻量级元数据和重型逐 token 字段。在数据分发期间, 可以加载整个 rollout 数据的元数据以执行全局混洗和打包布局计算。重型逐 token 字段通过共享内存数据加载器加载, 以消除节点内数据冗余, 并在 mini-batch 粒度上消费后立即释放, 从而大幅降低 CPU 和 GPU 的内存压力。设备上的 mini-batch 数量根据工作负载动态确定, 允许在计算吞吐量和 I/O 重叠之间进行高效权衡。

#### 5.2.5. Sandbox Infrastructure for Agentic AI

To meet the diverse execution demands of agentic AI during post-training and evaluation, we build a production-grade sandbox platform, DeepSeek Elastic Compute (DSec). DSec comprises three Rust components — the API gateway (Apiserver), per-host agent (Edge), and the cluster monitor (Watcher) — that are interconnected by a custom RPC protocol and scale horizontally atop the 3FS distributed filesystem (DeepSeek-AI, 2025). In production, a single DSec cluster manages hundreds of thousands of concurrent sandbox instances.

为了满足智能体 AI 在后训练和评估期间多样化的执行需求, 我们构建了一个生产级沙箱平台——DeepSeek Elastic Compute(DSec)。DSec 由三个 Rust 组件组成——API 网关(Apiserver)、每主机代理(Edge)和集群监视器(Watcher)——它们通过自定义 RPC 协议互连, 并在 3FS 分布式文件系统(DeepSeek-AI, 2025)之上水平扩展。在生产环境中, 单个 DSec 集群管理数十万个并发沙箱实例。

The design of DSec is motivated by four observations: (1) agentic workloads are highly heterogeneous, spanning lightweight function calls to full software-engineering pipelines with diverse OS and security requirements; (2) environment images are numerous and large, yet must load quickly and support iterative customization; (3) high-density deployment demands efficient CPU and memory utilization; (4) sandbox lifecycles must coordinate with GPU training schedules, including preemption and checkpoint-based resumption. Based on these observations, we elaborate on the four core designs of DSec individually in the following.

DSec 的设计源于四个观察：(1) 智能体工作负载高度异构, 从轻量级函数调用到具有多样化操作系统和安全要求的完整软件工程流水线; (2) 环境镜像数量众多且体积庞大, 但必须快速加载并支持迭代定制; (3) 高密度部署要求高效的 CPU 和内存利用率; (4) 沙箱生命周期必须与 GPU 训练调度协调, 包括抢占和基于检查点的恢复。基于这些观察, 我们在下文逐一详述 DSec 的四个核心设计。

Four Execution Substrates Behind One Unified Interface. DSec exposes a single Python SDK (libdsec) that abstracts four execution substrates. Function Call dispatches stateless invocations to a pre-warmed container pool, eliminating cold-start overhead. Container is fully Docker-compatible and leverages EROFS (Gao et al., 2019) on-demand loading for efficient image assembly. microVM, built on Firecracker (Agache et al., 2020), adds VM-level isolation for security-sensitive, high-density deployments. fullVM, built on QEMU (Bellard, 2005), supports arbitrary guest operating systems. All four share a common API surface — command execution, file transfer, and TTY access — and switching between them requires only a parameter change.

统一接口背后的四种执行底层。DSec 提供了一个 Python SDK(libdsec), 抽象了四种执行底层。Function Call 将无状态调用分派到预热的容器池, 消除了冷启动开销。Container 完全兼容 Docker, 并利用 EROFS(Gao et al., 2019)按需加载以实现高效的镜像组装。microVM 基于 Firecracker(Agache et al., 2020)构建, 为安全敏感的高密度部署增加了 VM 级隔离。fullVM 基于 QEMU(Bellard, 2005)构建, 支持任意客户操作系统。这四种底层共享统一的 API 接口——命令执行、文件传输和 TTY 访问——且它们之间的切换只需修改一个参数。

Fast Image Loading via Layered Storage. DSec reconciles fast startup with a large and growing corpus of environment images through layered, on-demand loading. For containers, base images and filesystem commits are stored as 3FS-backed readonly EROFS layers mounted directly into overlay lowerdirs. We keep file metadata readily available on the local disk at mount time; meanwhile, data blocks are fetched from 3FS upon request. For microVMs, DSec uses the overlaybd (Li et al., 2020) disk format: the read-only base layer resides on 3FS for cross-instance sharing, while writes go to a local copy-on-write layer. Such snapshots are chainable, facilitating efficient versioning and millisecond-scale resumption.

通过分层存储实现快速镜像加载。DSec 通过分层按需加载, 在快速启动与大量且不断增长的环境镜像之间取得平衡。对于容器, 基础镜像和文件系统提交被存储为 3FS 支持的只读 EROFS 层, 直接挂载到 overlay lowerdirs 中。我们在挂载时将文件元数据保存在本地磁盘上随时可用; 同时, 数据块在请求时从 3FS 获取。对于 microVM, DSec 使用 overlaybd(Li et al., 2020)磁盘格式：只读基础层驻留在 3FS 上以供跨实例共享, 写入则进入本地写时复制层。此类快照可链式组合, 便于高效版本控制和毫秒级恢复。

Density Optimizations Under Massive Concurrency. To accommodate hundreds of thousands of sandboxes per cluster, DSec tackles two resource bottlenecks. First, it mitigates duplicate page-cache footprints in virtualized environments and applies memory reclamation to enable safe overcommitment. Second, it alleviates spinlock contention in the container runtime and therefore, reduces per-sandbox CPU overhead, significantly increasing per-host packing density.

大规模并发下的密度优化。为了容纳每个集群数十万个沙箱, DSec 解决了两个资源瓶颈。首先, 它缓解了虚拟化环境中的重复页缓存占用, 并应用内存回收以实现安全的超分配。其次, 它减轻了容器运行时中的自旋锁争用, 从而降低了每个沙箱的 CPU 开销, 显著增加了每主机的打包密度。

Trajectory Logging and Preemption-Safe Resumption. DSec maintains a globally ordered trajectory log for each sandbox, persistently recording every command invocation and its results. The trajectory serves three purposes: (1) client fast-forwarding — when a training task is preempted, sandbox resources are retained nonetheless; upon resumption, DSec replays cached results for previously completed commands, accelerating task recovery whilst also preventing errors from re-execution of non-idempotent operations; (2) fine-grained provenance — the origin and corresponding outcomes of each state change are traceable; (3) deterministic replay — any historical session can be faithfully reproduced from its trajectory.

轨迹日志与抢占安全恢复。DSec 为每个沙箱维护一个全局有序的轨迹日志, 持久化记录每一次命令调用及其结果。该轨迹服务于三个目的：(1) 客户端快进——当训练任务被抢占时, 沙箱资源仍然被保留; 恢复时, DSec 回放先前已完成命令的缓存结果, 加速任务恢复, 同时防止非幂等操作重新执行导致的错误; (2) 细粒度溯源——每次状态变更的来源和对应结果都可追溯; (3) 确定性回放——任何历史会话都可以从其轨迹忠实再现。

> 译者注：DSec 的设计展现了 DeepSeek 在"训练基础设施即产品"方面的工程成熟度。将沙箱平台从简单的 Docker 封装升级为支持四种执行底层(Function Call / Container / microVM / fullVM)、并与 3FS 和 GPU 训练调度深度集成的系统, 这背后是大量生产环境的血泪经验。尤其值得称道的是"轨迹日志 + 抢占安全恢复"机制——在 RL 训练中, 智能体与环境的交互是非幂等的(例如执行 `rm -rf` 或调用外部 API), 如果抢占后直接重放而非快进, 会导致状态不一致。DSec 的全局有序日志和缓存结果回放, 本质上为智能体交互提供了一个"可回滚、可恢复"的确定性执行层。不过, 文中提到"生产环境单集群管理数十万个并发沙箱实例", 这个数字非常惊人, 其背后的 CPU/内存开销和网络拓扑细节未被披露, 读者应保持审慎。

### 5.3. Standard Benchmark Evaluation

#### 5.3.1. Evaluation Setup

Knowledge and Reasoning. Knowledge and reasoning datasets include MMLU-Pro (Wang et al., 2024b), GPQA (Rein et al., 2023), Human Last Exam (Phan et al., 2025), Simple-QA Verified (Haas et al., 2025), Chinese-SimpleQA (He et al., 2024), LiveCodeBench-v6 (Jain et al., 2024), CodeForces (Internal Benchmark), HMMT 2026 Feb, Apex (Balunovi´c et al., 2025), Apex Shortlist (Balunovi´c et al., 2025), IMOAnswerBench (Luong et al., 2025), and PutnamBench (Tsoukalas et al., 2024).

知识与推理。知识与推理数据集包括 MMLU-Pro(Wang et al., 2024b)、GPQA(Rein et al., 2023)、Human Last Exam(Phan et al., 2025)、Simple-QA Verified(Haas et al., 2025)、Chinese-SimpleQA(He et al., 2024)、LiveCodeBench-v6(Jain et al., 2024)、CodeForces(内部基准)、HMMT 2026 Feb、Apex(Balunovi´c et al., 2025)、Apex Shortlist(Balunovi´c et al., 2025)、IMOAnswerBench(Luong et al., 2025)和 PutnamBench(Tsoukalas et al., 2024)。

For code, we evaluate DeepSeek-V4 series on LiveCodeBench-v6 and an internal Codeforces benchmark. For Codeforces, we collect 14 Codeforces Division 1 contests comprising 114 problems (May 2025 - November 2025). The Elo rating is computed as follows. For each contest, we generate 32 candidate solutions per problem. For each problem independently, we sample 10 of these solutions without replacement and arrange them in a random order to form the submission sequence. Each submission is judged against a test suite constructed by domain experts. The score for a solved problem follows the penalty scheme of OpenAI (2025): the model receives the median score of human participants who solved the same problem with the same number of prior failed attempts. This yields a total contest score for each sampled submission sequence, which is then converted into a contest rank and subsequently into an estimated rating via the standard Codeforces rating system. The contest-level expected rating is defined as the expectation of this estimated rating over all possible random selections and orderings of the 10 submissions per problem. The model's overall rating is the average of these contest-level expected ratings across all 14 contests.

对于代码任务, 我们在 LiveCodeBench-v6 和一个内部 Codeforces 基准上评估 DeepSeek-V4 系列。对于 Codeforces, 我们收集了 14 场 Codeforces Division 1 比赛, 共 114 道题目(2025 年 5 月至 2025 年 11 月)。Elo 评分计算方式如下。对于每场比赛, 我们为每道题目生成 32 个候选解决方案。对于每道题目独立地, 我们从中无放回地采样 10 个解决方案, 并按随机顺序排列形成提交序列。每个提交由领域专家构建的测试套件进行评判。已解决题目的得分遵循 OpenAI(2025)的惩罚方案：模型获得与其在相同先前失败尝试次数下解决同一问题的人类参赛者的中位数得分。这为每个采样的提交序列产生一个比赛总分, 随后被转换为比赛排名, 再通过标准 Codeforces 评分系统转换为估计评分。比赛级期望评分定义为对每道题目 10 个提交的所有可能随机选择和排列下该估计评分的期望。模型的总体评分是 14 场比赛比赛级期望评分的平均值。

For reasoning and knowledge tasks, we set the temperature to 1.0 and the context window to 8K, 128K, and 384K tokens for the Non-think, High, and Max modes, respectively. For math tasks (e.g., HMMT, IMOAnswerBench, Apex, and HLE), we evaluate using the following template: "{question}\\nPlease reason step by step, and put your final answer within \\boxed{}." For DeepSeek-V4-Pro-Max on math tasks, we use the following template to elicit deeper reasoning: "Solve the following problem. The problem may ask you to prove a statement, or ask for an answer. If finding an answer is required, you should come up with the answer, and your final solution should also be a rigorous proof of that answer being valid.\\n\\n{question}".

对于推理和知识任务, 我们将温度设为 1.0, Non-think、High 和 Max 模式的上下文窗口分别设为 8K、128K 和 384K token。对于数学任务(例如 HMMT、IMOAnswerBench、Apex 和 HLE), 我们使用以下模板进行评估："{question}\\n请逐步推理, 并将最终答案放在 \\boxed{} 中。" 对于数学任务上的 DeepSeek-V4-Pro-Max, 我们使用以下模板来激发更深层次的推理："求解以下问题。该问题可能要求你证明一个命题, 或要求一个答案。如果需要找到答案, 你应该给出答案, 并且你的最终解决方案也应是该答案有效性的严格证明。\\n\\n{question}"。

For formal math tasks, we evaluate in an agentic setting on Lean v4.28.0-rc1 (Moura and Ullrich, 2021), with access to the Lean compiler and a semantic tactic search engine, running up to 500 tool calls with max reasoning effort. In addition, we evaluate a more compute-intensive pipeline in which candidate natural-language solutions are first generated and filtered by self-verification(Shao et al., 2025), and the retained solutions are then provided as guidance to a formal agent for proving the corresponding Lean statement. This design uses informal reasoning to improve exploration while preserving strict correctness through formal verification. A submission is counted as correct only if the strict verifier Comparator accepts it for both settings.

对于形式化数学任务, 我们在 Lean v4.28.0-rc1(Moura and Ullrich, 2021)的智能体环境中进行评估, 可访问 Lean 编译器和语义战术搜索引擎, 最多运行 500 次工具调用并使用最大推理投入。此外, 我们还评估了一个计算更密集的流水线：首先通过自验证(Shao et al., 2025)生成并筛选候选自然语言解决方案, 然后将保留的解决方案作为指导提供给形式化智能体, 以证明对应的 Lean 命题。这种设计利用非形式化推理来改进探索, 同时通过形式化验证保持严格正确性。只有当严格验证器 Comparator 在两种设置下都接受时, 提交才被视为正确。

We have left some entries blank for K2.6 and GLM-5.1, as their APIs were too busy to return responses to our queries.

对于 K2.6 和 GLM-5.1, 我们留空了一些条目, 因为它们的 API 过于繁忙, 无法返回我们的查询响应。

1M-Token Context. Since DeepSeek-V4 series supports 1M-token contexts, we evaluate model performance in a long context scenario by selecting OpenAI MRCR (OpenAI, 2024b) and CorpusQA (Lu et al., 2026) as the benchmarks. We re-evaluate Claude Opus 4.6 and Gemini 3.1 Pro on these tasks with the goal of standardizing the configuration across all models. We did not evaluate GPT-5.4 because its API failed to respond to a large portion of our queries.

1M Token 上下文。由于 DeepSeek-V4 系列支持 1M token 上下文, 我们通过选择 OpenAI MRCR(OpenAI, 2024b)和 CorpusQA(Lu et al., 2026)作为基准, 在长上下文场景中评估模型性能。我们重新评估了 Claude Opus 4.6 和 Gemini 3.1 Pro 在这些任务上的表现, 目标是在所有模型之间标准化配置。我们没有评估 GPT-5.4, 因为其 API 未能响应我们的大部分查询。

Agent. Agent datasets include Terminal Bench 2.0 (Merrill et al., 2026), SWE-Verified (OpenAI, 2024e), SWE Multilingual (Yang et al., 2025), SWE-Pro (Deng et al., 2025), BrowseComp (Wei et al., 2025), the public evaluation set of MCPAtlas (Bandi et al., 2026), GDPval-AA (AA, 2025; Patwardhan et al., 2025), and Tool-Decathlon (Li et al., 2025).

智能体。智能体数据集包括 Terminal Bench 2.0(Merrill et al., 2026)、SWE-Verified(OpenAI, 2024e)、SWE Multilingual(Yang et al., 2025)、SWE-Pro(Deng et al., 2025)、BrowseComp(Wei et al., 2025)、MCPAtlas 的公开评估集(Bandi et al., 2026)、GDPval-AA(AA, 2025; Patwardhan et al., 2025)和 Tool-Decathlon(Li et al., 2025)。

For code agent tasks (SWE-Verified, Terminal-Bench, SWE-Pro, SWE Multilingual), we evaluate DeepSeek-V4 series using an internally developed evaluation framework. This framework provides a minimal set of tools — a bash tool and a file-edit tool. The maximum number of interaction steps is set to 500, and the maximum context length is set to 512K tokens. Regarding Terminal-Bench 2.0, we acknowledge the environment-related issues noted by GLM-5.1. Nevertheless, we report our performance on the original Terminal-Bench 2.0 dataset for consistency. On the Terminal-Bench 2.0 Verified subset, DeepSeek-V4-Pro achieves a score of approximately 72.0.

对于代码智能体任务(SWE-Verified、Terminal-Bench、SWE-Pro、SWE Multilingual), 我们使用内部开发的评估框架评估 DeepSeek-V4 系列。该框架提供了一组最小化的工具——一个 bash 工具和一个文件编辑工具。最大交互步数设为 500, 最大上下文长度设为 512K token。关于 Terminal-Bench 2.0, 我们承认 GLM-5.1 指出的环境相关问题。尽管如此, 为了保持一致性, 我们报告了在原始 Terminal-Bench 2.0 数据集上的性能。在 Terminal-Bench 2.0 Verified 子集上, DeepSeek-V4-Pro 取得了约 72.0 的分数。

For search agent tasks (BrowseComp, HLE w/ tool), we also use an in-house harness with websearch and Python tool, and set maximum interaction steps to 500 and the maximum context length to 512K tokens. For BrowseComp, we use the same discard-all context management strategy as DeepSeek-V3.2 (DeepSeek-AI, 2025).

对于搜索智能体任务(BrowseComp、HLE w/ tool), 我们也使用内部 harness, 配备网络搜索和 Python 工具, 最大交互步数设为 500, 最大上下文长度设为 512K token。对于 BrowseComp, 我们使用与 DeepSeek-V3.2(DeepSeek-AI, 2025)相同的丢弃全部上下文管理策略。

#### 5.3.2. Evaluation Results

The comparison of DeepSeek-V4-Pro-Max and other closed/open source models is presented in Table 6. Also, we evaluate different modes of DeepSeek-V4-Flash and DeepSeek-V4-Pro and show the results in Table 7.

DeepSeek-V4-Pro-Max 与其他闭源/开源模型的比较呈现在表 6 中。此外, 我们评估了 DeepSeek-V4-Flash 和 DeepSeek-V4-Pro 的不同模式, 结果展示于表 7 中。

Table 6 
| Comparison between DeepSeek-V4-Pro-Max and closed/open source models. "Max", "xHigh", and "High" denote reasoning effort. The best results are highlighted in bold; the second-best results are underlined.

表 6 | DeepSeek-V4-Pro-Max 与闭源/开源模型的比较。"Max"、"xHigh" 和 "High" 表示推理投入。最佳结果以粗体显示; 次佳结果以下划线显示。

> **表格数据概述**：表 6 以复杂 HTML 表格形式呈现在原文中(参见 D3 原文, 约第 693–694 行)。该表在 15+ 项基准上对比了 Opus-4.6(Max/xHigh/High)、GPT-5.4(High)、Gemini-3.1-Pro(High)、K2.6、GLM-5.1(Thinking)和 DeepSeek-V4-Pro(Max/High)的表现, 涵盖知识(MMLU-Pro、SimpleQA、GPQA、HLE)、代码(LiveCodeBench、Codeforces)、数学(HMMT、IMO、Apex)和智能体(Terminal Bench、SWE、BrowseComp 等)类别。数据要点如下：
> 1. **知识类**：V4-Pro-Max 在 SimpleQA-Verified(57.9%)上大幅领先所有开源基线, 但低于 Gemini-3.1-Pro(91.0%); 在 MMLU-Pro(87.5%)和 GPQA Diamond(84.4%)上领先 Kimi/GLM, 但略低于 GPT-5.4 和 Gemini-3.1-Pro。
> 2. **代码竞赛**：V4-Pro-Max 的 Codeforces 评分达到 3206, 与 GPT-5.4(3052)和 Gemini-3.1-Pro(3168)处于同一梯队, 在人类选手中排名第 23 位。这是首次有开源模型在 Codeforces 上匹敌闭源前沿模型。
> 3. **数学推理**：V4-Pro-Max 在 HMMT 2026 Feb(95.2%)、IMOAnswerBench(89.8%)和 Apex(38.3%)上均创下开源模型新纪录。形式化数学(PutnamBench)方面, V4 在 agentic 设置和计算密集型流水线中均达到 SOTA。
> 4. **长上下文**：V4-Pro-Max 在 CorpusQA 1M(83.5%)上优于 Gemini-3.1-Pro(76.3%), 但在 MRCR 1M 上落后于 Claude Opus-4.6(92.9% vs 90.2%)。
> 5. **智能体**：在 Terminal Bench 2.0(67.9%)和 SWE-Verified(79.0%)上, V4-Pro-Max 落后于闭源模型, 但在 MCPAtlas 和 Toolathlon 上表现优异, 说明工具泛化能力较强。
> 6. **数据可信度**：K2.6 和 GLM-5.1 的部分条目因 API 繁忙而缺失; GPT-5.4 未参与 1M 上下文评测。评测由 DeepSeek 内部完成, 非第三方独立测试。

Knowledge. In the evaluation of general world knowledge, DeepSeek-V4-Pro-Max, the maximum reasoning effort mode of DeepSeek-V4-Pro, establishes a new state-of-the-art among open-source large language models. As demonstrated by the SimpleQA-Verified, DeepSeek-V4-Pro-Max significantly outperforms all existing open-source baselines by a margin of 20 absolute percentage points. Despite these advances, it currently trails the leading proprietary model, Gemini-3.1-Pro. In the domain of educational knowledge and reasoning, DeepSeek-V4-Pro-Max marginally outperforms Kimi and GLM across the MMLU-Pro, GPQA, and HLE benchmarks, although it lags behind leading proprietary models. Broadly, DeepSeek-V4-Pro-Max marks a significant milestone in enhancing the world knowledge capabilities of open-source models.

知识。在通用世界知识评估中, DeepSeek-V4-Pro-Max——即 DeepSeek-V4-Pro 的最大推理投入模式——在开源大语言模型中建立了新的最先进水平。如 SimpleQA-Verified 所示, DeepSeek-V4-Pro-Max 以 20 个绝对百分点的优势显著超越了所有现有开源基线。尽管取得了这些进展, 它目前仍落后于领先的专有模型 Gemini-3.1-Pro。在教育知识与推理领域, DeepSeek-V4-Pro-Max 在 MMLU-Pro、GPQA 和 HLE 基准上略微优于 Kimi 和 GLM, 但仍落后于领先的专有模型。总体而言, DeepSeek-V4-Pro-Max 标志着开源模型世界知识能力提升的一个重要里程碑。

In addition, a significant performance gap exists between DeepSeek-V4-Flash and DeepSeek-V4-Pro on knowledge-based tasks; this is anticipated, as larger parameter counts facilitate greater knowledge retention during pre-training. Notably, both models demonstrate improved results on knowledge benchmarks when allocated higher reasoning effort.

此外, DeepSeek-V4-Flash 和 DeepSeek-V4-Pro 在知识类任务上存在显著的性能差距; 这是预期的, 因为更大的参数量有助于在预训练期间保留更多知识。值得注意的是, 当分配更高的推理投入时, 两个模型在知识基准上都展现出改进的结果。

Reasoning. DeepSeek-V4-Pro-Max outperforms all prior open models across reasoning benchmarks, and matches state-of-the-art closed models on many metrics, while the smaller DeepSeek-V4-Flash-Max also surpasses the previous best open-source model, K2.6-Thinking, on code and math reasoning tasks. Meanwhile, DeepSeek-V4-Pro and DeepSeek-V4-Flash excel in coding competitions. According to our evaluation, their performance is comparable to GPT-5.4, making this the first time an open model has matched a closed model on this task. On the Codeforces leaderboard, DeepSeek-V4-Pro-Max currently ranks 23rd among human candidates. DeepSeek-V4 also demonstrates strong performance on formal mathematical task under both agentic and compute-intensive settings. Under an agentic setup, it achieves state-of-the-art results, shown in Figure 8, outperforming prior models such as Seed Prover (Chen et al., 2025). With a more compute-intensive pipeline, performance further improves, surpassing systems including Aristotle(Achim et al., 2025) and matching the best known results under this setting.

推理。DeepSeek-V4-Pro-Max 在推理基准上超越了所有先前的开源模型, 并在许多指标上与最先进水平闭源模型匹敌; 而较小的 DeepSeek-V4-Flash-Max 在代码和数学推理任务上也超越了之前的最佳开源模型 K2.6-Thinking。同时, DeepSeek-V4-Pro 和 DeepSeek-V4-Flash 在编程竞赛中表现出色。根据我们的评估, 它们的性能与 GPT-5.4 相当, 这是开源模型首次在该任务上匹敌闭源模型。在 Codeforces 排行榜上, DeepSeek-V4-Pro-Max 目前在人类选手中排名第 23 位。DeepSeek-V4 在智能体和计算密集型两种设置下都展现了强大的形式化数学任务性能。在智能体设置下, 它达到了最先进的结果, 如图 8 所示, 超越了 Seed Prover(Chen et al., 2025)等先前模型。在计算更密集的流水线中, 性能进一步提升, 超越了包括 Aristotle(Achim et al., 2025)在内的系统, 并匹敌该设置下的最佳已知结果。

Table 7 
| Comparison among different sizes and modes of DeepSeek-V4 series. "Non-Think", "High", and "Max" denote reasoning effort.

表 7 | DeepSeek-V4 系列不同规模和模式的比较。"Non-Think"、"High" 和 "Max" 表示推理投入。

> **表格数据概述**：表 7 以复杂 HTML 表格形式呈现在原文中(参见 D3 原文, 约第 702–703 行)。该表对比了 DeepSeek-V4-Flash(Non-Think / High / Max)和 DeepSeek-V4-Pro(Non-Think / High / Max)在知识(MMLU-Pro、SimpleQA、GPQA、HLE)、代码(LiveCodeBench、Codeforces)、数学(HMMT、IMO、Apex)和智能体(Terminal Bench、SWE、BrowseComp 等)等多类基准上的表现。数据要点如下：
> 1. **推理投入效应**：Max 模式在绝大多数挑战性任务上优于 High 模式, 尤其在 HLE(V4-Pro: 37.7% vs 34.5%)、Apex(38.3% vs 27.4%)和 Terminal Bench(67.9% vs 63.3%)上差距明显。这说明增加测试时计算(test-time compute)确实能解锁模型更强的推理深度。
> 2. **Flash vs Pro**：V4-Pro 在知识密集型任务(SimpleQA-Verified: 57.9% vs 34.1% Max)上大幅领先 V4-Flash, 符合"参数越多、知识越多"的直觉; 但在代码和数学推理上, V4-Flash-Max 已非常接近 V4-Pro-Max(LiveCodeBench: 91.6% vs 93.5%; IMOAnswerBench: 88.4% vs 95.2%), 显示架构效率的重要性。
> 3. **长上下文**：V4-Pro-Max 在 MRCR 1M(90.2%)和 CorpusQA 1M(83.5%)上表现优异, CorpusQA 上显著优于 Pro-High(83.3%), 说明极限上下文长度对文档问答类任务有直接收益。

Agent. The DeepSeek-V4 series demonstrates strong agent performance in evaluations. For code agent tasks, DeepSeek-V4-Pro achieves results comparable to K2.6 and GLM-5.1, though all these open models still lag behind their closed-source counterparts. DeepSeek-V4-Flash underperforms DeepSeek-V4-Pro on coding tasks, particularly on Terminal Bench 2.0. A similar trend is observed across other agent evaluations. It is worth noting that DeepSeek-V4-Pro performs well on MCPAtlas and Toolathlon—two evaluation test sets that include a wide range of tools and MCP services—indicating that our model has excellent generalization capability and does not perform well only on internal frameworks.

智能体。DeepSeek-V4 系列在评估中展现了强大的智能体性能。对于代码智能体任务, DeepSeek-V4-Pro 取得了与 K2.6 和 GLM-5.1 相当的结果, 尽管所有这些开源模型仍落后于其闭源对手。DeepSeek-V4-Flash 在编码任务上不及 DeepSeek-V4-Pro, 尤其在 Terminal Bench 2.0 上。在其他智能体评估中也观察到了类似的趋势。值得注意的是, DeepSeek-V4-Pro 在 MCPAtlas 和 Toolathlon 上表现出色——这两个评估测试集包含广泛的工具和 MCP 服务——表明我们的模型具有优异的泛化能力, 并非只在内部框架上表现良好。

1M-Token Context. DeepSeek-V4-Pro outperforms Gemini-3.1-Pro on the MRCR task, which measures in-context retrieval, but remains behind Claude Opus 4.6. As illustrated in Figure 9, retrieval performance remains highly stable within a 128K context window. While a performance degradation becomes visible beyond the 128K mark, the model's retrieval capabilities at 1M tokens remain remarkably strong compared to both proprietary and open-source counterparts. Unlike MRCR, CorpusQA is similar to real scenarios. The evaluation results also indicate that DeepSeek-V4-Pro is better than Gemini-3.1-Pro.

1M Token 上下文。DeepSeek-V4-Pro 在衡量上下文内检索能力的 MRCR 任务上优于 Gemini-3.1-Pro, 但仍落后于 Claude Opus 4.6。如图 9 所示, 检索性能在 128K 上下文窗口内保持高度稳定。虽然超过 128K 阈值后性能下降变得可见, 但模型在 1M token 处的检索能力与闭源和开源对手相比仍然异常强大。与 MRCR 不同, CorpusQA 更接近真实场景。评估结果也表明 DeepSeek-V4-Pro 优于 Gemini-3.1-Pro。

![](images/fig08_formal_reasoning.jpg)  
Figure 8 | Formal reasoning under practical and frontier regimes. Left: Putnam-200 Pass@8 evaluates a fixed random subset of PutnamBench (Tsoukalas et al., 2024) following the setup introduced by Seed-Prover; all models are tested on the same problem set. We follow the Seed-Prover protocol but replace proprietary search tools with the open-source LeanExplore (Asher, 2025), yielding a lightweight setting with minimal agent tools and bounded sampling. Right: Putnam-2025 probes the frontier of mathematical reasoning in a scaled hybrid formal-informal regime, where informal reasoning is combined with formal verification to expose gaps and improve rigor; DeepSeek-V4 reaches a proof-perfect 120/120.

图 8 | 实用体制与前沿体制下的形式化推理。左：Putnam-200 Pass@8 按照 Seed-Prover 引入的设置评估 PutnamBench(Tsoukalas et al., 2024)的一个固定随机子集; 所有模型在同一问题集上测试。我们遵循 Seed-Prover 协议, 但将专有搜索工具替换为开源的 LeanExplore(Asher, 2025), 形成一个工具最少、采样有界轻量级设置。右：Putnam-2025 在规模化混合形式化-非形式化体制下探查数学推理的前沿, 其中非形式化推理与形式化验证相结合以暴露差距并提高严谨性; DeepSeek-V4 达到了完美的 120/120 证明率。

![](images/fig09_mrcr_task.jpg)  
Figure 9 | DeepSeek-V4 series performance on the MRCR task.

图 9 | DeepSeek-V4 系列在 MRCR 任务上的性能

Reasoning Effort. As shown in Table 7, the Max mode, which employs longer contexts and reduced length penalties in RL, outperforms the High mode on the most challenging tasks. Figure 10 presents a comparison of performance and cost among DeepSeek-V4-Pro, DeepSeek-V4-Flash, and DeepSeek-V3.2 on representative reasoning and agentic tasks. By scaling test-time compute, DeepSeek-V4 series achieve substantial improvements over the predecessor. Furthermore, on reasoning tasks like HLE, DeepSeek-V4-Pro demonstrates higher token efficiency than DeepSeek-V3.2.

推理投入。如表 7 所示, Max 模式在 RL 中使用更长的上下文和更小的长度惩罚, 在最困难的任务上优于 High 模式。图 10 展示了 DeepSeek-V4-Pro、DeepSeek-V4-Flash 和 DeepSeek-V3.2 在代表性推理和智能体任务上的性能与成本比较。通过扩展测试时计算, DeepSeek-V4 系列相比前代取得了显著改进。此外, 在 HLE 等推理任务上, DeepSeek-V4-Pro 展现出比 DeepSeek-V3.2 更高的 token 效率。

![](images/fig10a_hle_terminalbench.jpg)

![](images/fig10b_hle_terminalbench_b.jpg)  
Figure 10 | HLE and Terminal Bench 2.0 performance by reasoning effort. "None" indicates Non-think mode, and "Speciale" indicates DeepSeek-V3.2-Speciale model.

图 10 | 不同推理投入下的 HLE 和 Terminal Bench 2.0 性能。"None" 表示 Non-think 模式, "Speciale" 表示 DeepSeek-V3.2-Speciale 模型。

> 译者注：标准基准评估的结果需要批判性解读。V4-Pro-Max 在多个维度上确实达到了开源 SOTA, 尤其在 SimpleQA(事实记忆)和 Codeforces(编程竞赛)上的突破具有里程碑意义。但有几个值得注意的细节：首先, 所有对比模型的评测均由 DeepSeek 内部完成, 非第三方独立测试, 存在"自家裁判"的潜在偏差——例如 GPT-5.4 在 1M 上下文和大量查询中"API 未响应", 这可能导致对比不完整。其次, Codeforces 的评测方案(32 候选解中选 10 个无放回采样、按中位数人类得分惩罚)虽然详细, 但与真实竞赛环境仍有差异。最后, 形式化数学的"120/120 完美证明"是在特定设置下(LeanExplore + 自验证过滤)实现的, 而非普适性的自动定理证明能力。读者在引用这些数据时应结合外部复现和社区评测。

### 5.4. Performance on Real-World Tasks

Standardized benchmarks often struggle to capture the complexities of diverse, real-world tasks, creating a gap between test results and actual user experience. To bridge this, we have developed proprietary internal metrics that prioritize real-world usage patterns over traditional benchmarks. This approach ensures that our optimizations translate into tangible benefits. Our evaluation framework specifically targets the primary use cases of the DeepSeek API and Chatbot, aligning model performance with practical demands.

标准基准通常难以捕捉多样化真实世界任务的复杂性, 在测试结果与实际用户体验之间存在差距。为了弥合这一差距, 我们开发了优先关注真实世界使用模式而非传统基准的专有内部指标。这种方法确保我们的优化能够转化为切实的收益。我们的评估框架专门针对 DeepSeek API 和聊天机器人的主要用例, 使模型性能与实际需求对齐。

#### 5.4.1. Chinese Writing

One of the primary use cases for DeepSeek is Chinese writing. We conducted a rigorous evaluation on functional writing and creative writing. Table 12 presents a pairwise comparison between DeepSeek-V4-Pro and Gemini-3.1-Pro on functional writing tasks. These tasks consist of common daily writing queries, where prompts are typically concise and straightforward. Gemini-3.1-Pro was selected as the baseline, as it stands as the top-performing external model for Chinese writing in our evaluations. The results indicate that DeepSeek-V4-Pro outperforms the baseline with an overall win rate of 62.7% versus 34.1%; this is primarily because Gemini occasionally allows its inherent stylistic preferences to override the user's explicit requirements in Chinese writing scenarios.

中文写作是 DeepSeek 的主要用例之一。我们对功能性写作和创意写作进行了严格评估。表 12 展示了 DeepSeek-V4-Pro 与 Gemini-3.1-Pro 在功能性写作任务上的成对比较。这些任务由常见的日常写作查询组成, 提示通常简洁明了。Gemini-3.1-Pro 被选为基线, 因为它是我们评估中中文写作表现最佳的外部模型。结果表明, DeepSeek-V4-Pro 以 62.7% 对 34.1% 的总体胜率优于基线; 这主要是因为 Gemini 偶尔会让其固有的风格偏好凌驾于中文写作场景中用户的明确要求之上。

Table 13 presents the creative writing comparison, which is evaluated along two axes: instruction following and writing quality. Compared with Gemini-3.1-Pro, DeepSeek-V4-Pro achieves a 60.0% win rate in instruction following and 77.5% in writing quality, demonstrating a marginal improvement in instruction following and a substantial gain in writing quality. Although DeepSeek-V4-Pro yields superior results in aggregate user case analysis, an evaluation restricted to the most challenging prompts — specifically those involving high-complexity constraints or multi-turn scenarios — reveals that Claude Opus 4.5 retains a performance advantage over DeepSeek-V4-Pro. As shown in Table 14, Claude Opus 4.5 achieves a 52.0% win rate versus 45.9%.

表 13 展示了创意写作比较, 沿两个维度进行评估：指令遵循和写作质量。与 Gemini-3.1-Pro 相比, DeepSeek-V4-Pro 在指令遵循上达到 60.0% 的胜率, 在写作质量上达到 77.5%, 显示出指令遵循方面的边际改进和写作质量方面的显著提升。尽管 DeepSeek-V4-Pro 在总体用户案例分析中取得了更优结果, 但将评估限制在最困难的提示——特别是涉及高复杂度约束或多轮场景的提示——时发现 Claude Opus 4.5 仍对 DeepSeek-V4-Pro 保持性能优势。如表 14 所示, Claude Opus 4.5 实现了 52.0% 对 45.9% 的胜率。

#### 5.4.2. Search

Search-augmented question answering is a core capability of the DeepSeek chatbot. On the DeepSeek web and app, the "non-think" mode employs Retrieval-Augmented Search (RAG), whereas the "thinking" mode utilizes agentic search.

搜索增强问答是 DeepSeek 聊天机器人的核心能力。在 DeepSeek 网页版和应用中, "non-think" 模式采用检索增强搜索(RAG), 而"thinking" 模式则使用智能体搜索。

Retrieval Augmented Search. We conducted a pairwise evaluation comparing DeepSeek-V4-Pro and DeepSeek-V3.2 across both objective and subjective Q&A categories. As presented in Table 11, DeepSeek-V4-Pro outperforms DeepSeek-V3.2 by a substantial margin, demonstrating a consistent advantage across both categories. The most pronounced gains are observed in single-value search and planning & strategy tasks, suggesting that DeepSeek-V4-Pro excels at locating precise factual answers and synthesizing structured plans from retrieved context. However, DeepSeek-V3.2 remains relatively competitive on comparison and recommendation tasks, indicating potential room for improvement for DeepSeek-V4-Pro in scenarios requiring balanced, multi-perspective reasoning over search results.

检索增强搜索。我们对 DeepSeek-V4-Pro 和 DeepSeek-V3.2 进行了成对评估, 涵盖客观问答和主观问答两类。如表 11 所示, DeepSeek-V4-Pro 以显著优势优于 DeepSeek-V3.2, 在两类任务中都展现出一致的优势。最显著的收益出现在单值搜索和规划与策略任务中, 表明 DeepSeek-V4-Pro 擅长定位精确的事实答案并从检索上下文中综合结构化计划。然而, DeepSeek-V3.2 在比较和推荐任务上仍具有相对竞争力, 表明 DeepSeek-V4-Pro 在需要对搜索结果进行平衡的、多视角推理的场景中仍有改进空间。

Agentic Search. Unlike standard RAG, agentic search empowers the model to iteratively invoke search and fetch tools per query, significantly enhancing overall search performance. For the thinking mode in DeepSeek-Chat, we optimized the agentic search function to maximize response accuracy within a predefined "thinking budget". As shown in Table 9, agentic search consistently outperforms RAG, particularly on complex tasks. Furthermore, its cost remains highly efficient, with agentic search being only marginally more expensive than standard RAG (see Table 10).

智能体搜索。与标准 RAG 不同, 智能体搜索使模型能够针对每个查询迭代调用搜索和获取工具, 显著提升了整体搜索性能。对于 DeepSeek-Chat 的 thinking 模式, 我们优化了智能体搜索功能, 以在预定义的"思考预算"内最大化响应准确性。如表 9 所示, 智能体搜索始终优于 RAG, 尤其在复杂任务上。此外, 其成本仍然非常高效, 智能体搜索仅比标准 RAG 略贵(见表 10)。

#### 5.4.3. White-Collar Task

To rigorously evaluate the model's utility in sophisticated enterprise productivity scenarios, we constructed a comprehensive suite of 30 advanced Chinese professional tasks. These workflows deliberately encompass high-level cognitive demands, including in-depth information analysis, comprehensive document generation, and nuanced document editing, spanning a diverse spectrum of 13 critical industries (e.g., finance, education, law, and technology). The evaluation was conducted within an in-house agent harness equipped with basic tools, including Bash and web search.

为了严格评估模型在复杂企业生产力场景中的实用性, 我们构建了一套包含 30 项高级中文专业任务的综合性评测集。这些工作流刻意涵盖高层次的认知需求, 包括深度信息分析、综合文档生成和细腻的文档编辑, 跨越 13 个关键行业的多样化谱系(例如金融、教育、法律和技术)。评估在一个配备基本工具(包括 Bash 和网络搜索)的内部智能体 harness 中进行。

Given the open-ended nature of these tasks, automated metrics usually fall short in capturing the nuances of a high-quality response. Therefore, we conducted human evaluations to compare the performance of DeepSeek-V4-Pro-Max against Opus-4.6-Max. Annotators blindly assessed the model outputs across four dimensions:

鉴于这些任务的开放式性质, 自动化指标通常难以捕捉高质量响应的细微差别。因此, 我们进行了人工评估, 比较 DeepSeek-V4-Pro-Max 与 Opus-4.6-Max 的表现。标注员从四个维度对模型输出进行盲评：

• Task Completion: Whether the core problem was successfully resolved.

• 任务完成度：核心问题是否成功解决。

• Instruction Following: Adherence to specific constraints and directives.

• 指令遵循：对特定约束和指令的遵守程度。

• Content Quality: Factual accuracy, logical coherence, and professional tone.

• 内容质量：事实准确性、逻辑连贯性和专业语气。

• Formatting Aesthetics: Layout readability and visual presentation.

• 格式美观度：布局可读性和视觉呈现。

As illustrated in Figure 11, DeepSeek-V4-Pro-Max outperforms Opus-4.6-Max on diverse Chinese white-collar tasks, achieving an impressive non-loss rate of 63%, and demonstrating consistent advantages across analysis, generation, and editing tasks. The detailed dimension scores shown in Figure 12 highlight the model's primary strengths in Task Completion and Content Quality. Specifically, DeepSeek-V4-Pro-Max proactively anticipates implicit user intents by frequently providing supplementary insights and self-verification steps. It also excels in long-form generation, delivering in-depth, coherent narratives rather than relying on the overly simplistic bullet points frequently produced by Opus-4.6-Max. Additionally, the model strictly conforms to formal professional conventions, such as standardized Chinese hierarchical numbering. However, in terms of Instruction Following, it occasionally overlooks specific formatting constraints and slightly trails Opus. Furthermore, the model is less proficient at condensing extensive text inputs into succinct summaries. Finally, its Formatting Aesthetics still have substantial room for improvement regarding the overall visual design of presentation slides. Figure 13, 14, and 15 present several test cases; due to the extensive length of certain outputs, only partial pages are displayed.

如图 11 所示, DeepSeek-V4-Pro-Max 在多样化的中文白领任务上优于 Opus-4.6-Max, 实现了令人印象深刻的 63% 非败率, 并在分析、生成和编辑任务上展现了持续的优势。图 12 展示的详细维度得分凸显了该模型在任务完成度和内容质量上的主要优势。具体而言, DeepSeek-V4-Pro-Max 通过频繁提供补充见解和自验证步骤, 主动预判用户的隐含意图。它在长篇生成方面也表现出色, 提供深入、连贯的叙述, 而非依赖 Opus-4.6-Max 经常产生的过于简化的要点列表。此外, 该模型严格遵守正式的专业惯例, 例如标准化的中文层级编号。然而, 在指令遵循方面, 它偶尔会忽略特定的格式约束, 略微落后于 Opus。此外, 该模型在将大量文本输入浓缩为简洁摘要方面能力较弱。最后, 其格式美观度在演示文稿的整体视觉设计方面仍有相当大的改进空间。图 13、14 和 15 展示了若干测试用例; 由于某些输出篇幅过长, 仅显示部分页面。

![](images/fig11_winrate_comparison.jpg)  
Figure 11 | Win-rate comparison across analysis, generation, editing tasks, and the overall performance.

图 11 | 分析、生成、编辑任务及总体性能的胜率比较

![](images/fig12_dimension_scores.jpg)  
Figure 12 | Detailed dimension scores including Task Completion, Content Quality, Formatting Aesthetics, and Instruction Following.

图 12 | 详细维度得分, 包括任务完成度、内容质量、格式美观度和指令遵循

![](images/fig13_example_marketing_proposal.jpg)  
Figure 13 | Example output of a task which requires drafting a joint marketing proposal for a popular bubble tea brand and the Beijing Subway.

图 13 | 一项任务输出的示例, 该任务要求为一家热门奶茶品牌和北京地铁起草联合营销方案

#### 5.4.4. Code Agent

To benchmark our coding agent capability, we curate tasks from real internal R&D workloads We collect ∼200 challenging tasks from 50+ internal engineers, spanning feature development, bug fixing, refactoring, and diagnostics across diverse technology stacks including PyTorch, CUDA, Rust, and C++. Each task is accompanied by its original repository, the corresponding execution environment, and human-annotated scoring rubrics; after rigorous quality filtering, 30 tasks are retained as the evaluation set. As shown in Table 8, DeepSeek-V4-Pro significantly outperforms Claude Sonnet 4.5 and approaches the level of Claude Opus 4.5.

为了对我们的代码智能体能力进行基准测试, 我们从真实内部研发工作负载中策划任务。我们从 50 多位内部工程师处收集了约 200 项具有挑战性的任务, 涵盖 PyTorch、CUDA、Rust 和 C++ 等多样化技术栈中的功能开发、缺陷修复、重构和诊断。每项任务附带其原始代码仓库、对应的执行环境和人工标注的评分标准; 经过严格的质量筛选后, 30 项任务被保留为评估集。如表 8 所示, DeepSeek-V4-Pro 显著优于 Claude Sonnet 4.5, 并接近 Claude Opus 4.5 的水平。

Table 8 
| Comparison on R&D Coding Benchmark (external models included strictly for evaluation purposes).

表 8 | 研发代码基准比较(纳入外部模型严格用于评估目的)

> **表格数据概述**：表 8 以 HTML 表格形式呈现在原文中(参见 D3 原文, 约第 771–772 行)。该表在内部研发代码基准上对比了多个模型的通过率(Pass Rate)：
> | 模型 | Haiku 4.5 | Sonnet 4.5 | DeepSeek-V4-Pro-Max | Opus 4.5 | Opus 4.5 Thinking | Opus 4.6 Thinking |
> |------|-----------|------------|---------------------|----------|-------------------|-------------------|
> | 通过率 (%) | 13 | 47 | 67 | 70 | 73 | 80 |
> 数据要点：V4-Pro-Max(67%)介于 Sonnet 4.5(47%)和 Opus 4.5(70%)之间, 与 Opus 4.5 Thinking(73%)和 Opus 4.6 Thinking(80%)仍有差距。需要注意的是, 这是 DeepSeek 内部筛选的 30 项高难度任务, 样本量较小且任务分布偏向内部技术栈(PyTorch/CUDA), 可能存在选择偏差。

In a survey asking DeepSeek developers and researchers (?? = 85) — all with experience of using DeepSeek-V4-Pro for agentic coding in their daily work — whether DeepSeek-V4-Pro is ready to serve as their default and primary coding model compared to other frontier models, 52% said yes, 39% leaned toward yes, and fewer than 9% said no. Respondents find DeepSeek-V4-Pro to deliver satisfactory results across most tasks, but note trivial mistakes, misinterpretation of vague prompts, and occasional over-thinking.

在一项针对 DeepSeek 开发者和研究人员(?? = 85)的调查中——他们都有在日常工作中使用 DeepSeek-V4-Pro 进行智能体编码的经验——询问与其他前沿模型相比, DeepSeek-V4-Pro 是否已准备好作为他们的默认和主要编码模型, 52% 的人回答是, 39% 的人倾向于同意, 不到 9% 的人回答否。受访者认为 DeepSeek-V4-Pro 在大多数任务上都能交付令人满意的结果, 但也指出了琐碎错误、对模糊提示的误解以及偶尔的过度思考。

> 译者注：真实世界任务评估是 DeepSeek-V4 报告中最具"接地气"色彩的部分。与标准基准不同, 这些评测直接反映了产品团队的实际关注点：中文写作的胜率对比、搜索增强问答的主观评价、白领任务的四维度人工盲评、以及内部工程师对代码智能体的满意度调查。这些指标的设计本身就有助于理解 DeepSeek 的产品策略——将模型能力从"考试分数"转化为"用户留存"。但需要注意几个偏差来源：白领任务的评估由 DeepSeek 内部标注员完成, 可能存在文化背景和评估标准的一致性偏差; 代码智能体调查样本仅 85 人且全部为 DeepSeek 员工, 存在明显的内部拥护者偏差; 内部 R&D 基准的 30 题样本量过小, 难以泛化到更广泛的代码库。尽管如此, 这些真实场景评测提供了标准基准无法覆盖的宝贵洞察, 尤其是关于模型在指令遵循、格式美观度和摘要能力上的具体短板。
## 6. Conclusion, Limitations, and Future Directions

## 6. 结论、局限性与未来方向

In this work, we present a preview version of DeepSeek-V4 series, aiming at next-generation large language models that break the efficiency barrier of ultra-long-context processing. By combining a hybrid attention architecture that integrates CSA and HCA, DeepSeek-V4 series achieve a dramatic leap in long-sequence efficiency. The architectural innovations, together with extensive infrastructure optimization, enable efficient native support for million-token contexts and establish a necessary foundation for future test-time scaling, long-horizon tasks, and emerging paradigms such as online learning. Evaluation results demonstrate that DeepSeek-V4-Pro-Max, the maximum reasoning effort mode of DeepSeek-V4-Pro, redefines the state-of-the-art for open models. It substantially outperforms prior open-source models on knowledge benchmarks, achieves superior reasoning performance close to the frontier proprietary models, and delivers competitive agent capabilities. Meanwhile, DeepSeek-V4-Flash-Max attains comparable reasoning performance to leading closed models while maintaining a highly cost-efficient architecture. We believe DeepSeek-V4 series usher in a new era of million-length contexts for open models and pave the way toward better efficiency, scale, and intelligence.

本工作中, 我们展示了 DeepSeek-V4 系列的预览版本, 旨在打造突破超长上下文处理效率壁垒的下一代大语言模型。通过融合 CSA 与 HCA 的混合注意力架构, DeepSeek-V4 系列在长序列效率上实现了飞跃式提升。这些架构创新结合广泛的基础设施优化, 使模型能够高效地原生支持百万 token 级别的上下文, 并为未来的测试时扩展(test-time scaling)、长程任务以及在线学习等新兴范式奠定了必要基础。评估结果表明, DeepSeek-V4-Pro-Max(DeepSeek-V4-Pro 的最高推理强度模式)重新定义了开源模型的最先进水平：它在知识类基准上大幅超越此前的开源模型, 在推理性能上接近前沿闭源模型, 并展现出具有竞争力的智能体能力。与此同时, DeepSeek-V4-Flash-Max 在保持高度成本效益的架构下, 取得了与领先闭源模型可比的推理性能。我们相信 DeepSeek-V4 系列将为开源模型开启百万长度上下文的新纪元, 并为迈向更高的效率、规模与智能铺平道路。

> 译者注: 本节是技术报告的总结陈词, 其措辞值得细细品味。作者将 V4 系列定位为"打破效率壁垒"的下一代模型, 而非单纯追求参数规模的扩展。这种表述策略反映了当前 LLM 领域从"scale is all you need"向"efficiency matters"的范式转移。CSA+HCA 的混合注意力被置于架构创新的核心位置, 而百万 token 原生支持则被锚定为"新纪元"的标志。需要留意的是, 这里的"close to the frontier proprietary models"是一个相对模糊的表述——未指明具体对标的是哪一家闭源模型, 也未给出量化差距, 这是一种既展示信心又留有余地的修辞策略。

In pursuit of extreme long-context efficiency, DeepSeek-V4 series adopted a bold architectural design. To minimize risk, we retained many preliminarily validated components and tricks, which, while effective, made the architecture relatively complex. In future iterations, we will carry out more comprehensive and principled investigations to distill the architecture down to its most essential designs, making it more elegant without sacrificing performance. Meanwhile, although Anticipatory Routing and SwiGLU Clamping have been proven effective in mitigating training instabilities, their underlying principles remain insufficiently understood. We will actively study foundational problems on training stability and strengthen internal metric monitoring, aiming for a more principled and predictive approach to stable large-scale training.

为了追求极致的长上下文效率, DeepSeek-V4 系列采用了一种大胆的架构设计。为降低风险, 我们保留了许多经初步验证有效的组件和技巧, 但这也使架构相对复杂。在未来的迭代中, 我们将开展更全面、更具原理性的研究, 将架构提炼至其最本质的设计, 使其在不牺牲性能的前提下更加简洁优雅。与此同时, 尽管 Anticipatory Routing(预判式路由)和 SwiGLU Clamping(SwiGLU 截断)已被证明在缓解训练不稳定性方面有效, 但其底层原理尚未被充分理解。我们将积极研究训练稳定性的基础问题, 并加强内部指标监控, 以期建立更具原理性和可预测性的大规模稳定训练方法。

> 译者注: 这是本节最有价值的段落之一——研究团队罕见地坦承了当前架构的"复杂"与部分技术的"黑箱"性质。Anticipatory Routing 和 SwiGLU Clamping 作为两项关键的训练稳定性干预措施, 其有效性已被验证但机理不明, 这揭示了一个有趣的工程现实：在大模型训练中, "有效但不知为何有效"的 trick 并不罕见。作者承诺未来将"蒸馏至最本质设计", 暗示 V4 的当前架构可能是一个"过度工程化"的中间态, 未来版本有望大幅简化。这种自我批判性的坦诚在产业界技术报告中较为少见, 体现了 DeepSeek 团队的技术自信。

In addition, beyond the MoE and sparse attention architecture, we will also proactively explore model sparsity along new dimensions — such as more sparse embedding modules (Cheng et al., 2026) — to further improve computational and memory efficiency without compromising capability. We will also continuously investigate low-latency architectures and system techniques to make long-context部署和交互更具响应性. Furthermore, we recognize the importance and practical value of long-horizon, multi-round agentic tasks, and will continue to iterate and explore in this direction. We are also working on incorporating multimodal capabilities to our models. Finally, we are committed to developing better data curation and synthesis strategies to consistently enhance model intelligence, robustness, and practical usability across an increasingly broad range of scenarios and tasks.

此外, 除了 MoE 和稀疏注意力架构之外, 我们还将积极探索新维度的模型稀疏性——例如更稀疏的嵌入模块(Cheng et al., 2026)——以在不损害能力的前提下进一步提升计算和内存效率。我们还将持续研究低延迟架构和系统技术, 使长上下文部署和交互更具响应性。此外, 我们认识到长程、多轮智能体任务的重要性和实践价值, 并将继续在该方向上迭代和探索。我们也正在努力为模型融入多模态能力。最后, 我们致力于开发更好的数据整理与合成策略, 以在日益广泛的场景和任务中持续提升模型的智能水平、鲁棒性和实际可用性。

> 译者注: 这段未来路线图透露了 DeepSeek 的多个战略方向。值得注意的几点：(1) "更稀疏的嵌入模块"引用了 Cheng et al., 2026 的预印本, 说明团队已关注条件记忆/稀疏查找等新兴稀疏化技术; (2) "低延迟架构和系统技术"的提法表明, 当前 V4 在长上下文推理延迟上仍有优化空间; (3) "多轮智能体任务"被列为重点方向, 与当前 Agent 赛道的热度一致; (4) "多模态能力"被提及, 暗示 V4 目前仍是纯文本模型, 未来版本将拓展至视觉/音频模态。这段内容本质上是一份公开的长期技术路线图。

## References

## 参考文献

The reference list of this technical report spans approximately 200 entries, covering the following major categories:

本技术报告的参考文献列表包含约 200 条引用, 涵盖以下主要类别：

1. **Foundational Model Architectures and Attention Mechanisms**: Includes seminal works such as Vaswani et al. (2017, "Attention Is All You Need"), Shazeer (2019, "Fast Transformer Decoding: One Write-Head Is All You Need"), and Shazeer (2020, "GLU Variants Improve Transformer"), as well as the RoPE position embedding paper (Su et al., 2024) and the GQA paper (Ainslie et al., 2023).

1. **基础模型架构与注意力机制**：包括开创性工作如 Vaswani 等(2017, "Attention Is All You Need")、Shazeer(2019, "Fast Transformer Decoding: One Write-Head Is All You Need")和 Shazeer(2020, "GLU Variants Improve Transformer"), 以及 RoPE 位置编码论文(Su 等, 2024)和 GQA 论文(Ainslie 等, 2023)。

2. **Mixture-of-Experts (MoE) and Sparsity**: Encompasses Hash Layers (Roller et al., 2021), DeepSeekMoE (Dai et al., 2024), the auxiliary-loss-free load balancing strategy (Wang et al., 2024a), and hyper-connections / manifold-constrained hyper-connections (Zhu et al., 2025; Xie et al., 2026), as well as conditional memory lookup (Cheng et al., 2026).

2. **混合专家(MoE)与稀疏性**：涵盖 Hash Layers(Roller 等, 2021)、DeepSeekMoE(Dai 等, 2024)、无辅助损失负载均衡策略(Wang 等, 2024a)、超连接/流形约束超连接(Zhu 等, 2025; Xie 等, 2026), 以及条件记忆查找(Cheng 等, 2026)。

3. **DeepSeek Series Works**: Includes DeepSeek-V2, DeepSeek-V3, DeepSeek-V3.2, DeepSeek-Coder-V2, DeepSeek-R1, and other internal publications from DeepSeek-AI.

3. **DeepSeek 系列工作**：包括 DeepSeek-V2、DeepSeek-V3、DeepSeek-V3.2、DeepSeek-Coder-V2、DeepSeek-R1 等 DeepSeek-AI 的内部出版物。

4. **Optimization and Training Stability**: Covers Nesterov acceleration (Nesterov, 1983), AdamW (Loshchilov and Hutter, 2017), the Muon optimizer (Jordan et al., 2024; Liu et al., 2025), multi-token prediction (Gloeckle et al., 2024), and on-policy distillation (Lu and Lab, 2025).

4. **优化与训练稳定性**：涵盖 Nesterov 加速(Nesterov, 1983)、AdamW(Loshchilov 和 Hutter, 2017)、Muon 优化器(Jordan 等, 2024; Liu 等, 2025)、多 token 预测(Gloeckle 等, 2024)和策略内蒸馏(Lu 和 Lab, 2025)。

5. **Evaluation Benchmarks**: Covers MMLU (Hendrycks et al., 2020), DROP (Dua et al., 2019), HellaSwag (Zellers et al., 2019), TriviaQA (Joshi et al., 2017), HumanEval (Chen et al., 2021), GPQA (Rein et al., 2023), MMLU-Pro (Wang et al., 2024b), C-Eval (Huang et al., 2023), CMMLU (Li et al., 2023), AGIEval (Zhong et al., 2023), CLUE (Xu et al., 2020), SimpleQA (OpenAI, 2024d; Haas et al., 2025; He et al., 2024), LongBench-V2 (Bai et al., 2025b), CorpusQA (Lu et al., 2026), MultiLoko (Hupkes and Bogoychev, 2025), LiveCodeBench (Jain et al., 2024), BigCodeBench (Zhuo et al., 2025), SWE-bench (Deng et al., 2025; Yang et al., 2025), GDPval (Patwardhan et al., 2025; AA, 2025), MCR (OpenAI, 2024b), Humanity's Last Exam (Phan et al., 2025), MathArena (Balunovi´c et al., 2025), PutnamBench (Tsoukalas et al., 2024), and many others.

5. **评估基准**：涵盖 MMLU(Hendrycks 等, 2020)、DROP(Dua 等, 2019)、HellaSwag(Zellers 等, 2019)、TriviaQA(Joshi 等, 2017)、HumanEval(Chen 等, 2021)、GPQA(Rein 等, 2023)、MMLU-Pro(Wang 等, 2024b)、C-Eval(Huang 等, 2023)、CMMLU(Li 等, 2023)、AGIEval(Zhong 等, 2023)、CLUE(Xu 等, 2020)、SimpleQA(OpenAI, 2024d; Haas 等, 2025; He 等, 2024)、LongBench-V2(Bai 等, 2025b)、CorpusQA(Lu 等, 2026)、MultiLoko(Hupkes 和 Bogoychev, 2025)、LiveCodeBench(Jain 等, 2024)、BigCodeBench(Zhuo 等, 2025)、SWE-bench(Deng 等, 2025; Yang 等, 2025)、GDPval(Patwardhan 等, 2025; AA, 2025)、MCR(OpenAI, 2024b)、Humanity's Last Exam(Phan 等, 2025)、MathArena(Balunovi´c 等, 2025)、PutnamBench(Tsoukalas 等, 2024)等大量基准测试。

6. **Mathematical and Formal Reasoning**: Includes the MATH dataset (Hendrycks et al., 2021), GSM8K (Cobbe et al., 2021), CMath (Wei et al., 2023), Seed-Prover (Chen et al., 2025), Aristotle (Achim et al., 2025), DeepSeekMath-V2 (Shao et al., 2025), Lean 4 (de Moura and Ullrich, 2021), LeanExplore (Asher, 2025), Z3 (De Moura and Bjørner, 2008), and math reasoning robustness (Luong et al., 2025).

6. **数学与形式推理**：包括 MATH 数据集(Hendrycks 等, 2021)、GSM8K(Cobbe 等, 2021)、CMath(Wei 等, 2023)、Seed-Prover(Chen 等, 2025)、Aristotle(Achim 等, 2025)、DeepSeekMath-V2(Shao 等, 2025)、Lean 4(de Moura 和 Ullrich, 2021)、LeanExplore(Asher, 2025)、Z3(De Moura 和 Bjørner, 2008)以及数学推理鲁棒性(Luong 等, 2025)。

7. **Competing Models and Industry Reports**: Cites works from OpenAI (GPT-4, o1, o3, SWE-bench verified, SimpleQA), Google (Gemma 2), Kimi (Kimi K2), MiniMax (M2), Qwen (Qwen3), and others.

7. **竞争模型与行业报告**：引用了 OpenAI(GPT-4、o1、o3、SWE-bench verified、SimpleQA)、Google(Gemma 2)、Kimi(Kimi K2)、MiniMax(M2)、Qwen(Qwen3)等机构的工作。

8. **Systems and Infrastructure**: Includes Firecracker (Agache et al., 2020), QEMU (Bellard, 2005), EROFS (Gao et al., 2019), TVM (Chen et al., 2018), Zero (Rajbhandari et al., 2020), Flash-Decoding (Dao et al., 2023), Stream-K (Osama et al., 2023), Torch.FX (Reed et al., 2022), DADI (Li et al., 2020), 3FS (DeepSeek-AI, 2025), DeepGEMM (Zhao et al., 2025), TileLang (Wang et al., 2026), Jenga (Zhang et al., 2025a), Comet (Zhang et al., 2025b), quantization (Jacob et al., 2018), microscaling (Rouhani et al., 2023), and EAGLE speculative decoding (Li et al., 2024).

8. **系统与基础设施**：包括 Firecracker(Agache 等, 2020)、QEMU(Bellard, 2005)、EROFS(Gao 等, 2019)、TVM(Chen 等, 2018)、Zero(Rajbhandari 等, 2020)、Flash-Decoding(Dao 等, 2023)、Stream-K(Osama 等, 2023)、Torch.FX(Reed 等, 2022)、DADI(Li 等, 2020)、3FS(DeepSeek-AI, 2025)、DeepGEMM(Zhao 等, 2025)、TileLang(Wang 等, 2026)、Jenga(Zhang 等, 2025a)、Comet(Zhang 等, 2025b)、量化(Jacob 等, 2018)、微缩放(Rouhani 等, 2023)和 EAGLE 投机解码(Li 等, 2024)。

9. **Agent and Tool-Use Benchmarks**: Includes BrowseComp (Wei et al., 2025), MCP-Atlas (Bandi et al., 2026), Terminal-Bench (Merrill et al., 2026), and The Tool Decathlon (Li et al., 2025).

9. **智能体与工具使用基准**：包括 BrowseComp(Wei 等, 2025)、MCP-Atlas(Bandi 等, 2026)、Terminal-Bench(Merrill 等, 2026)和 The Tool Decathlon(Li 等, 2025)。

10. **Factuality and Data Quality**: Includes Fewer Truncations Improve Language Modeling (Ding et al., 2024), How to Synthesize Text Data Without Model Collapse? (Zhu et al., 2024), FACTS Leaderboard (Cheng et al., 2025), and Are We Done with MMLU? (Gema et al., 2024).

10. **事实性与数据质量**：包括 Fewer Truncations Improve Language Modeling(Ding 等, 2024)、How to Synthesize Text Data Without Model Collapse?(Zhu 等, 2024)、FACTS Leaderboard(Cheng 等, 2025)和 Are We Done with MMLU?(Gema 等, 2024)。

11. **Other Related Works**: Covers knowledge distillation (Gu et al., 2024), Hymba hybrid-head architecture (Dong et al., 2025), SuperGPQA (Du et al., 2025), FlashMoE (Aimuyo et al., 2025), MiniLLM (Gu et al., 2024), neural combinatorial optimization (Bello et al., 2017), Winogrande (Sakaguchi et al., 2019), attention sinks (Xiao et al., 2024), Big-Bench (Suzgun et al., 2022), and multilingual CoT (Shi et al., 2023).

11. **其他相关工作**：涵盖知识蒸馏(Gu 等, 2024)、Hymba 混合头架构(Dong 等, 2025)、SuperGPQA(Du 等, 2025)、FlashMoE(Aimuyo 等, 2025)、MiniLLM(Gu 等, 2024)、神经组合优化(Bello 等, 2017)、Winogrande(Sakaguchi 等, 2019)、attention sinks(Xiao 等, 2024)、Big-Bench(Suzgun 等, 2022)和多语言 CoT(Shi 等, 2023)。

> 译者注: 参考文献的技术谱系揭示了 DeepSeek-V4 的知识根基。值得注意的是：(1) 内部自引占比极高——DeepSeek-V2/V3/V3.2/MoE/R1 等内部工作构成了方法论的连续谱系; (2) 系统层引用异常丰富——从虚拟化(Firecracker)、文件系统(EROFS/3FS)到编译器(TVM/TileLang)、通信优化(Comet/Jenga), 反映了团队对"训练效率"的全栈追求; (3) 数学/形式推理的引用密度明显高于一般 LLM 报告, 与 DeepSeek 在数学推理上的强项一致; (4) 引用了一篇 2026 年的预印本(Cheng et al., 2026), 说明团队在引用上采用了"未来出版"的惯例, 这在 arXiv 文化中并不罕见。

## Appendix

## 附录

### A. Author List and Acknowledgment

### A. 作者列表与致谢

#### A.1. Author List

#### A.1. 作者列表

Authors are listed alphabetically by their first name. Names marked with \* denote individuals who have departed from our team.

作者按名字字母顺序排列。标有 \* 的名字表示已离开团队的成员。

Research & Engineering: Anyi Xu, Bangcai Lin, Bing Xue, Bingxuan Wang\*, Bingzheng Xu, Bochao Wu, Bowei Zhang, Chaofan Lin, Chen Dong, Chengda Lu, Chenggang Zhao, Chengqi Deng, Chenhao Xu, Chenze Shao, Chong Ruan\*, Conner Sun, Damai Dai, Daya Guo\*, Dejian Yang, Deli Chen, Donghao Li, Erhang Li, Fangyun Lin, Fangzhou Yuan, Feiyu Xia, Fucong Dai, Guangbo Hao, Guanting Chen, Guoai Cao, Guolai Meng, Guowei Li, Han Yu, Han Zhang, Hanwei Xu, Hao Li, Haofen Liang, Haoling Zhang, Haoming Luo, Haoran Wei\*, Haotian Yuan, Haowei Zhang\*, Haowen Luo, Haoyu Chen, Haozhe Ji, Honghui Ding, Hongxuan Tang, Huanqi Cao, Huazuo Gao, Hui Qu, Hui Zeng, J. Yang, J.Q. Zhu, Jia Yu, Jialiang Huang, Jiasheng Ye, Jiashi Li, Jiaxin Xu, Jiewen Hu, Jin Yan, Jingchang Chen, Jingli Zhou, Jingting Xiang, Jingyang Yuan, Jingyuan Cheng, Jinhua Zhu, Jiping Yu, Joseph Sun, Jun Ran\*, Junguang Jiang, Junjie Qiu, Junlong Li\*, Junxiao Song, Kai Dong, Kaige Gao, Kang Guan, Kexing Zhou, Kezhao Huang\*, Kuai Yu, Lean Wang, Lecong Zhang, Lei Wang, Li Zhang, Liang Zhao, Lihua Guo, Lingxiao Luo, Linwang Ma, Litong Wang, Liyu Cai, Liyue Zhang, Longhao Chen, M.S. Di, M.Y Xu, Max Mei, Mingchuan Zhang, Minghua Zhang, Minghui Tang, Mingxu Zhou, Panpan Huang, Peixin Cong, Peiyi Wang, Qiancheng Wang, Qihao Zhu, Qingyang Li, Qinyu Chen, Qiushi Du, Qiwei Jiang, Rui Tian, Ruifan Xu, Ruijie Lu, Ruiling Xu, Ruiqi Ge, Ruisong Zhang, Ruizhe Pan, Runji Wang, Runqian Chen, Runqiu Yin, Runxin Xu, Ruomeng Shen, Ruoyu Zhang, S.H. Liu, Shanghao Lu, Shangyan Zhou, Shanhuang Chen, Shaofei Cai, Shaoheng Nie, Shaoyuan Chen, Shengding Hu, Shengyu Liu, Shiqiang Hu, Shirong Ma, Shiyu Wang, Shuiping Yu, Shunfeng Zhou, Shuting Pan, Shuying Yu, Songyang Zhou, Tao Ni, Tao Yun, Tian Jin, Tian Pei, Tian Ye, Tianle Lin, Tianran Ji, Tianyi Cui, Tianyuan Yue, Tingting Yu, Tun Wang, W. Zhang, Wangding Zeng, Weilin Zhao, Wen Liu, Wenfeng Liang, Wenjie Pang, Wenjing Luo, Wenjing Yao, Wenjun Gao, Wenkai Yang, Wenlve Huang, Wentao Zhang, Wentin... (and many more)

研究与工程：Anyi Xu、Bangcai Lin、Bing Xue、Bingxuan Wang\*、Bingzheng Xu、Bochao Wu、Bowei Zhang、Chaofan Lin、Chen Dong、Chengda Lu、Chenggang Zhao、Chengqi Deng、Chenhao Xu、Chenze Shao、Chong Ruan\*、Conner Sun、Damai Dai、Daya Guo\*、Dejian Yang、Deli Chen、Donghao Li、Erhang Li、Fangyun Lin、Fangzhou Yuan、Feiyu Xia、Fucong Dai、Guangbo Hao、Guanting Chen、Guoai Cao、Guolai Meng、Guowei Li、Han Yu、Han Zhang、Hanwei Xu、Hao Li、Haofen Liang、Haoling Zhang、Haoming Luo、Haoran Wei\*、Haotian Yuan、Haowei Zhang\*、Haowen Luo、Haoyu Chen、Haozhe Ji、Honghui Ding、Hongxuan Tang、Huanqi Cao、Huazuo Gao、Hui Qu、Hui Zeng、J. Yang、J.Q. Zhu、Jia Yu、Jialiang Huang、Jiasheng Ye、Jiashi Li、Jiaxin Xu、Jiewen Hu、Jin Yan、Jingchang Chen、Jingli Zhou、Jingting Xiang、Jingyang Yuan、Jingyuan Cheng、Jinhua Zhu、Jiping Yu、Joseph Sun、Jun Ran\*、Junguang Jiang、Junjie Qiu、Junlong Li\*、Junxiao Song、Kai Dong、Kaige Gao、Kang Guan、Kexing Zhou、Kezhao Huang\*、Kuai Yu、Lean Wang、Lecong Zhang、Lei Wang、Li Zhang、Liang Zhao、Lihua Guo、Lingxiao Luo、Linwang Ma、Litong Wang、Liyu Cai、Liyue Zhang、Longhao Chen、M.S. Di、M.Y Xu、Max Mei、Mingchuan Zhang、Minghua Zhang、Minghui Tang、Mingxu Zhou、Panpan Huang、Peixin Cong、Peiyi Wang、Qiancheng Wang、Qihao Zhu、Qingyang Li、Qinyu Chen、Qiushi Du、Qiwei Jiang、Rui Tian、Ruifan Xu、Ruijie Lu、Ruiling Xu、Ruiqi Ge、Ruisong Zhang、Ruizhe Pan、Runji Wang、Runqian Chen、Runqiu Yin、Runxin Xu、Ruomeng Shen、Ruoyu Zhang、S.H. Liu、Shanghao Lu、Shangyan Zhou、Shanhuang Chen、Shaofei Cai、Shaoheng Nie、Shaoyuan Chen、Shengding Hu、Shengyu Liu、Shiqiang Hu、Shirong Ma、Shiyu Wang、Shuiping Yu、Shunfeng Zhou、Shuting Pan、Shuying Yu、Songyang Zhou、Tao Ni、Tao Yun、Tian Jin、Tian Pei、Tian Ye、Tianle Lin、Tianran Ji、Tianyi Cui、Tianyuan Yue、Tingting Yu、Tun Wang、W. Zhang、Wangding Zeng、Weilin Zhao、Wen Liu、Wenfeng Liang、Wenjie Pang、Wenjing Luo、Wenjing Yao、Wenjun Gao、Wenkai Yang、Wenlve Huang、Wentao Zhang、Wentin...(以及更多)

Business & Compliance: Chenchen Ling, Chengyu Hou, Dongjie Ji, Fang Wei, Hengqing Zhang, Jia Luo, Jia Song, Jialu Cai, Jian Liang, Jiangting Zhou, Jieyu Yang, Jin Chen, Jingzi Zhou, Junmin Zheng, Leyi Xia, Linyan Zhu, Miaojun Wang, Mingming Li, Minmin Han, Ning Wang, Panpan Wang, Peng Zhang, Ruyi Chen, Shangmian Sun, Shaoqing Wu, W.L. Xiao, Wei An, Wenqing Hou, Xianzu Wang, Xiaowen Sun, Xiaoxiang Wang, Xinyu Zhang, Xueyin Chen, Yao Xu, Yi Shao, Yiling Ma, Ying Tang, Yuehan Yang, Yuer Xu, Yukun Zha, Yuping Lin, Yuting Yan, Zekai Zhang, Zhe Ju, Zheren Gao, Zhongyu Wu, Zihua Qu, Ziyi Wan.

商务与合规：Chenchen Ling、Chengyu Hou、Dongjie Ji、Fang Wei、Hengqing Zhang、Jia Luo、Jia Song、Jialu Cai、Jian Liang、Jiangting Zhou、Jieyu Yang、Jin Chen、Jingzi Zhou、Junmin Zheng、Leyi Xia、Linyan Zhu、Miaojun Wang、Mingming Li、Minmin Han、Ning Wang、Panpan Wang、Peng Zhang、Ruyi Chen、Shangmian Sun、Shaoqing Wu、W.L. Xiao、Wei An、Wenqing Hou、Xianzu Wang、Xiaowen Sun、Xiaoxiang Wang、Xinyu Zhang、Xueyin Chen、Yao Xu、Yi Shao、Yiling Ma、Ying Tang、Yuehan Yang、Yuer Xu、Yukun Zha、Yuping Lin、Yuting Yan、Zekai Zhang、Zhe Ju、Zheren Gao、Zhongyu Wu、Zihua Qu、Ziyi Wan。

> 译者注: 作者名单揭示了几个值得注意的信息：(1) 总人数超过 200 人, 其中研究与工程人员占绝对多数, 商务与合规团队约 40 人; (2) 标有 \* 的离职人员包括 Chong Ruan(阮翀, 可能是核心架构师之一)、Daya Guo(郭达雅, Code 方向的关键人物)、Bingxuan Wang、Haoran Wei、Haowei Zhang、Jun Ran、Junlong Li、Kezhao Huang 等, 离职名单中有若干可能涉及核心技术的人员; (3) 名单中出现了 Damai Dai、Chengqi Deng、Lean Wang、Wenfeng Liang 等多次出现在 DeepSeek 此前论文中的"元老级"作者; (4) 按名字首字母排序而非按贡献排序, 是一种学术界常见的去等级化做法, 但在产业报告中采用此格式较为少见。

#### A.2. Acknowledgment

#### A.2. 致谢

We would like to thank Dolly Deng and other testers for their valuable suggestions and feedback regarding the capabilities of DeepSeek-V4 series models.

我们要感谢 Dolly Deng 和其他测试人员对 DeepSeek-V4 系列模型能力提出的宝贵建议和反馈。


### B. Evaluation Details

### B. 评估详情

Table 9 
| Agentic Search vs. Retrieval Augmented Search for DeepSeek-V4-Pro.

表 9 | DeepSeek-V4-Pro 的智能体搜索与检索增强搜索对比。

<table><tr><td>Difficulty</td><td>Category</td><td># Agent Win</td><td>RAG Win</td><td>Tie</td><td>Agent%</td><td>RAG%</td><td>Tie%</td></tr><tr><td rowspan="2">Easy</td><td>Objective Q&amp;A ()</td><td>196</td><td>110</td><td>43</td><td>43 56.1</td><td>21.9</td><td>21.9</td></tr><tr><td>Subjective Q&amp;A (</td><td>321</td><td>198</td><td>56 67</td><td>61.7</td><td>17.4</td><td>20.9</td></tr><tr><td rowspan="2">Hard</td><td>Objective Q&amp;A ()</td><td>168</td><td>102</td><td>33</td><td>33 60.7</td><td>19.6</td><td>19.6</td></tr><tr><td>Subjective Q&amp;A (</td><td>184</td><td>126</td><td>27</td><td>31 68.5</td><td>14.7</td><td>16.8</td></tr><tr><td></td><td>Total (</td><td>869</td><td>536</td><td>159</td><td>174 61.7</td><td>18.3</td><td>20.0</td></tr></table>

> **表格数据概述**：表 9 对比了 DeepSeek-V4-Pro 在智能体搜索(Agentic Search)和检索增强搜索(RAG)两种模式下的表现。在总计 1,564 个测试样本中, 智能体搜索以 61.7% 的胜率大幅领先 RAG 的 18.3%, 平局率为 20.0%。细分来看, 主观问答(Subjective Q&A)中智能体搜索的优势(Easy 61.7%、Hard 68.5%)大于客观问答(Objective Q&A, Easy 56.1%、Hard 60.7%), 说明智能体搜索在处理需要分析、判断和综合的开放性问题上有更强的能力。

Table 10 
| Cost Comparison:Agentic Search vs. Retrieval Augmented Search (Mean) for DeepSeek-V4-Pro. Most of the tool calls are parallel for Agentic Search.

表 10 | 成本对比：DeepSeek-V4-Pro 的智能体搜索 vs. 检索增强搜索(均值)。智能体搜索的大部分工具调用是并行执行的。

<table><tr><td>Version</td><td>Tool Calls</td><td>Prefill (tokens)</td><td>Output (tokens)</td></tr><tr><td>V4 Agentic Search</td><td>16.2</td><td>13649</td><td>1526</td></tr><tr><td>V4 Retrieval Augmented Search</td><td></td><td>10453</td><td>1308</td></tr></table>

> **表格数据概述**：表 10 显示, 尽管智能体搜索平均调用 16.2 次工具(且多为并行), 其预填充 token 数(13,649)和输出 token 数(1,526)仅略高于 RAG(10,453 / 1,308)。这表明智能体搜索在显著提升准确率的同时, 并未带来过高的额外成本, 并行工具调用策略有效控制了延迟和开销。

Table 11 
| Comparative Evaluation of DeepSeek-V4-Pro and DeepSeek-V3.2 on Search Q&A Tasks.

表 11 | DeepSeek-V4-Pro 与 DeepSeek-V3.2 搜索问答任务对比评估。

<table><tr><td rowspan="2">Category Subcategory</td><td rowspan="2"></td><td rowspan="2">#</td><td colspan="6">Internal Evaluation (</td></tr><tr><td>V4 win</td><td>V3.2 win</td><td>tie</td><td>V4%</td><td>V3.2%</td><td>tie%</td></tr><tr><td rowspan="4">Objective Q&amp;A (</td><td>Single-value Search ()</td><td>95</td><td>36</td><td>10</td><td>49</td><td>37.9</td><td>10.5</td><td>51.6</td></tr><tr><td>Entity Search (</td><td>99</td><td>24</td><td>7</td><td>68</td><td>24.2</td><td>7.1</td><td>68.7</td></tr><tr><td>Enumerative Search (</td><td>95</td><td>19</td><td>8</td><td>68</td><td>20.0</td><td>8.4</td><td>71.6</td></tr><tr><td>Subtotal (it)</td><td>289</td><td>79</td><td>25</td><td>185</td><td>27.3</td><td>8.7</td><td>64.0</td></tr><tr><td rowspan="8">Subjective Q&amp;A ()</td><td>Causal Analysis (</td><td>100</td><td>28</td><td>5</td><td>67</td><td>28.0</td><td>5.0</td><td>67.0</td></tr><tr><td>Comparison ()</td><td>96</td><td>28</td><td>20</td><td>48</td><td>29.2</td><td>20.8</td><td>50.0</td></tr><tr><td>Advice Seeking ()</td><td>92</td><td>23</td><td>8</td><td>61</td><td>25.0</td><td>8.7</td><td>66.3</td></tr><tr><td>Recommendation ()</td><td>95</td><td>26</td><td>19</td><td>50</td><td>27.4</td><td>20.0</td><td>52.6</td></tr><tr><td>Planning &amp; Strategy ()</td><td>92</td><td>32</td><td>11</td><td>49</td><td>34.8</td><td>12.0</td><td>53.3</td></tr><tr><td>Opinion &amp; Evaluation (i)</td><td>96</td><td>30</td><td>8</td><td>58</td><td>31.2</td><td>8.3</td><td>60.4</td></tr><tr><td>Trend Analysis ()</td><td>96</td><td>23</td><td>3</td><td>70</td><td>24.0</td><td>3.1</td><td>72.9</td></tr><tr><td>Subtotal (t)</td><td>667</td><td>190</td><td>74</td><td>403</td><td>28.5</td><td>11.1</td><td>60.4</td></tr><tr><td></td><td>TOTAL ()</td><td>956</td><td>269</td><td>99</td><td>588</td><td>28.1</td><td>10.4</td><td>61.5</td></tr></table>

> **表格数据概述**：表 11 展示了 V4-Pro 相对 V3.2 在搜索问答任务上的全面优势。在总计 956 个样本中, V4-Pro 以 28.1% 的胜率领先 V3.2 的 10.4%, 平局率为 61.5%。客观问答(Objective Q&A)中, V4-Pro 在枚举搜索(Enumerative Search, 20.0% vs 8.4%)和实体搜索(Entity Search, 24.2% vs 7.1%)上优势最为明显; 主观问答(Subjective Q&A)中, 趋势分析(Trend Analysis, 24.0% vs 3.1%)和因果分析(Causal Analysis, 28.0% vs 5.0%)差距最大。这表明 V4-Pro 在长上下文理解和复杂信息综合上的提升对搜索类任务有直接增益。

![](images/fig14_example_nasdaq_investment.jpg)  
Figure 14 | Example output of a task that requires comparing two regular investment strategies for the NASDAQ.

图 14 | 一项需要比较纳斯达克两种定期投资策略的任务输出示例。

![](images/fig15a_example_nobel_report.jpg)

![](images/fig15b_example_nobel_report.jpg)

![](images/fig15c_example_nobel_report.jpg)

![](images/fig15d_example_nobel_report.jpg)  
Figure 15 | Example output of a task which requires researching 2020-2025 Nobel Science Prizes and generating an analytical PDF report.

图 15 | 一项需要研究 2020-2025 年诺贝尔科学奖并生成分析性 PDF 报告的任务输出示例。

Table 12 
| Comparative Analysis of DeepSeek-V4-Pro and Gemini-3.1-Pro in Chinese Functional Writing.

表 12 | DeepSeek-V4-Pro 与 Gemini-3.1-Pro 中文功能性写作对比分析。

<table><tr><td colspan="3"></td><td colspan="6">Internal Evaluation (</td></tr><tr><td>Category</td><td>Subcategory</td><td>#</td><td>DS win</td><td>Gem win</td><td>Tie</td><td>DS%</td><td>Gem%</td><td>Tie%</td></tr><tr><td rowspan="11">Business Writing (</td><td>Report ()</td><td>527</td><td>350</td><td>162</td><td>15 7</td><td>66.41</td><td>30.74</td><td>2.85</td></tr><tr><td>Proposal ()</td><td>291</td><td>181</td><td>103</td><td></td><td>62.20</td><td>35.40</td><td>2.41</td></tr><tr><td>Education ()</td><td>159</td><td>100</td><td>56</td><td>3</td><td>62.89</td><td>35.22</td><td>1.89</td></tr><tr><td>Email &amp; Letter (</td><td>146</td><td>107</td><td>37</td><td>2</td><td>73.29</td><td>25.34</td><td>1.37</td></tr><tr><td>Notice (</td><td>72</td><td>43</td><td>24</td><td>5</td><td>59.72</td><td>33.33</td><td>6.94</td></tr><tr><td>Professional (≠)</td><td>63</td><td>34</td><td>27</td><td>2</td><td>53.97</td><td>42.86</td><td>3.17</td></tr><tr><td>Recruitment ()</td><td>42</td><td>27</td><td>15</td><td>0</td><td>64.29</td><td>35.71</td><td>0.00</td></tr><tr><td>Technical ()</td><td>29</td><td>22</td><td>7</td><td>0</td><td>75.86</td><td>24.14</td><td>0.00</td></tr><tr><td>Review (</td><td>20</td><td>15</td><td>5</td><td>0</td><td>75.00</td><td>25.00</td><td>0.00</td></tr><tr><td>Subtotal (t)</td><td>1349</td><td>879</td><td>436</td><td>34</td><td>65.16</td><td>32.32</td><td>2.52</td></tr><tr><td rowspan="9">Media Writing</td><td>Social Media ()</td><td>267</td><td>156</td><td>101</td><td>10</td><td>58.43</td><td>37.83</td><td>3.75</td></tr><tr><td>Ad Copy (</td><td>214</td><td>109</td><td>98</td><td>7</td><td>50.93</td><td>45.79</td><td>3.27</td></tr><tr><td>Long-form Content ()</td><td>99</td><td>71</td><td>25</td><td>3</td><td>71.72</td><td>25.25</td><td>3.03</td></tr><tr><td>News Report (</td><td>51</td><td>27</td><td>22</td><td>2</td><td>52.94</td><td>43.14</td><td>3.92</td></tr><tr><td>Advertorial</td><td>17</td><td>12</td><td>4</td><td>1</td><td>70.59</td><td>23.53</td><td>5.88</td></tr><tr><td>Headline (</td><td>11</td><td>7</td><td>4</td><td>0</td><td>63.64</td><td>36.36</td><td>0.00</td></tr><tr><td>Narration Script (</td><td>4</td><td>2</td><td>1</td><td>1</td><td>50.00</td><td>25.00</td><td>25.00</td></tr><tr><td>Comment (i)</td><td>3</td><td>2</td><td>1</td><td>0</td><td>66.67</td><td>33.33</td><td>0.00</td></tr><tr><td>Subtotal (it)</td><td>666</td><td>386</td><td>256</td><td>24</td><td>57.96</td><td>38.44</td><td>3.60</td></tr><tr><td rowspan="6">Everyday Writing ($)</td><td>Congratulatory ()</td><td>101</td><td>54</td><td>41</td><td>6</td><td>53.47</td><td>40.59</td><td>5.94</td></tr><tr><td>Communication (</td><td>100</td><td>71</td><td>26</td><td>3</td><td>71.00</td><td>26.00</td><td>3.00</td></tr><tr><td>Reflection (</td><td>90</td><td>68</td><td>17</td><td>5</td><td>75.56</td><td>18.89</td><td>5.56</td></tr><tr><td>Review ()</td><td>55</td><td>44</td><td>9</td><td>2</td><td>80.00</td><td>16.36</td><td>3.64</td></tr><tr><td>Comment ()</td><td>44</td><td>34</td><td>8</td><td>2</td><td>77.27</td><td>18.18</td><td>4.55</td></tr><tr><td>Subtotal (t)</td><td>390</td><td>271</td><td>101</td><td>18</td><td>69.49</td><td>25.90</td><td>4.62</td></tr><tr><td rowspan="6">Oral Writing ()</td><td>Speech ()</td><td>226</td><td></td><td>85</td><td></td><td>59.73</td><td>37.61</td><td>2.65</td></tr><tr><td>Narration Script (</td><td>51</td><td>135 25</td><td>23</td><td>6 3</td><td>49.02</td><td>45.10</td><td>5.88</td></tr><tr><td>Sales Script ()</td><td>31</td><td>22</td><td>6</td><td>3</td><td>70.97</td><td>19.35</td><td>9.68</td></tr><tr><td>Dialogue ()</td><td>10</td><td>4</td><td>6</td><td>0</td><td>40.00</td><td>60.00</td><td>0.00</td></tr><tr><td>Congratulatory)</td><td>1</td><td>1</td><td>0</td><td>0</td><td>100.00</td><td>0.00</td><td>0.00</td></tr><tr><td>Subtotal (|it)</td><td>319</td><td>187</td><td>120</td><td>12</td><td>58.62</td><td>37.62</td><td>3.76</td></tr><tr><td rowspan="6">Official Document ()</td><td>Administrative Doc (#)</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr><tr><td>Personal Doc (#)</td><td>117</td><td>60</td><td>53</td><td>4 1</td><td>51.28 61.64</td><td>45.30</td><td>3.42 1.37</td></tr><tr><td>Government Doc </td><td>73 34</td><td>45 19</td><td>27 14</td><td>1</td><td>55.88</td><td>36.99 41.18</td><td>2.94</td></tr><tr><td>Speech (</td><td>3</td><td>1</td><td>2</td><td>0</td><td>33.33</td><td>66.67</td><td>0.00</td></tr><tr><td>Essay Writing ()</td><td>3</td><td>1</td><td>1</td><td>1</td><td>33.33</td><td>33.33</td><td>33.33</td></tr><tr><td>Subtotal (t)</td><td></td><td></td><td></td><td>7</td><td></td><td></td><td></td></tr><tr><td rowspan="6">Academic Writing ()</td><td></td><td>230</td><td>126</td><td>97</td><td></td><td>54.78</td><td>42.17</td><td>3.04</td></tr><tr><td>Research Paper ()</td><td>104</td><td>67</td><td>32</td><td>5</td><td>64.42</td><td>30.77</td><td>4.81</td></tr><tr><td>Coursework ()</td><td>90</td><td>53</td><td>35</td><td>2</td><td>58.89</td><td>38.89</td><td>2.22</td></tr><tr><td>Academic Support (</td><td>15</td><td>11</td><td>3</td><td>1</td><td>73.33</td><td>20.00</td><td>6.67</td></tr><tr><td>Science Outreach (</td><td>7</td><td>6</td><td>1</td><td>0</td><td>85.71</td><td>14.29</td><td>0.00</td></tr><tr><td>Subtotal (†)</td><td>216</td><td>137</td><td>71</td><td>8</td><td>63.43</td><td>32.87</td><td>3.70</td></tr><tr><td>Total (</td><td></td><td>3170</td><td>1986</td><td>1081 103</td><td></td><td>62.65</td><td>34.10</td><td>3.25</td></tr></table>


> **表格数据概述**：表 12 评估了 V4-Pro 与 Gemini-3.1-Pro 在中文功能性写作上的表现。在商业写作(Business Writing)大类中, V4-Pro 以 65.16% 的总胜率领先(Gemini 32.32%), 其中邮件与信函(Email & Letter, 73.29%)、技术文档(Technical, 75.86%)和评论(Review, 75.00%)优势最大; 但在专业写作(Professional, 53.97% vs 42.86%)和通知(Notice, 59.72%)上优势相对较小。在媒体写作(Media Writing)大类中, 长篇内容(Long-form Content, 71.72%)和软文(Advertorial)领先明显, 但广告文案(Ad Copy, 50.93%)接近平局。总体而言, V4-Pro 在中文功能性写作的多数子类上均占优, 但在广告创意类文本上与 Gemini-3.1-Pro 差距最小。

Table 13 
| Comparative Analysis of DeepSeek-V4-Pro and Gemini-3.1-Pro in Chinese Creative Writing.

表 13 | DeepSeek-V4-Pro 与 Gemini-3.1-Pro 中文创意写作对比分析。

<table><tr><td rowspan="2">Subcategory ()</td><td rowspan="2"># |</td><td colspan="6">Instruction Following(</td><td colspan="6">Writing Quality ()</td></tr><tr><td>DS Gem Tie</td><td></td><td></td><td>DS% Gem% Tie%</td><td></td><td></td><td></td><td>DS Gem</td><td>Tie</td><td></td><td>DS% Gem% Tie%</td><td></td></tr><tr><td>Fiction (#)</td><td>836</td><td>504</td><td>323</td><td>5</td><td>60.58</td><td>38.82</td><td>0.60</td><td>672</td><td>157</td><td>3</td><td>80.77</td><td>18.87</td><td>0.36</td></tr><tr><td>General Fiction (/#)</td><td>662</td><td>368</td><td>290</td><td>3</td><td>55.67</td><td>43.87</td><td>0.45</td><td>467</td><td>194</td><td>0</td><td>70.65</td><td>29.35</td><td>0.00</td></tr><tr><td>Fan Fiction (</td><td>410</td><td>253</td><td>150</td><td>3</td><td>62.32</td><td>36.95</td><td>0.74</td><td>338</td><td>67</td><td>1</td><td>83.25</td><td>16.50</td><td>0.25</td></tr><tr><td>General Fan Fic. </td><td>202</td><td>111</td><td>90</td><td>1</td><td>54.95</td><td>44.55</td><td>0.50</td><td>161</td><td>40</td><td>1</td><td>79.70</td><td>19.80</td><td>0.50</td></tr><tr><td>Narrative ()</td><td>171</td><td>115</td><td>54</td><td>2</td><td>67.25</td><td>31.58</td><td>1.17</td><td>141</td><td>30</td><td>0</td><td>82.46</td><td>17.54</td><td>0.00</td></tr><tr><td>General Prose ()</td><td>124</td><td>83</td><td>40</td><td>1</td><td>66.94</td><td>32.26</td><td>0.81</td><td>88</td><td>36</td><td>0</td><td>70.97</td><td>29.03</td><td>0.00</td></tr><tr><td>Prose ()</td><td>112</td><td>74</td><td>38</td><td>0</td><td>66.07</td><td>33.93</td><td>0.00</td><td>92</td><td>20</td><td>0</td><td>82.14</td><td>17.86</td><td>0.00</td></tr><tr><td>Writing Style (</td><td>112</td><td>81</td><td>31</td><td>0</td><td>72.32</td><td>27.68</td><td>0.00</td><td>86</td><td>26</td><td>0</td><td>76.79</td><td>23.21</td><td>0.00</td></tr><tr><td>Classical Poetry (</td><td>48</td><td>24</td><td>24</td><td>0</td><td>50.00</td><td>50.00</td><td>0.00</td><td>39</td><td>9</td><td>0</td><td>81.25</td><td>18.75</td><td>0.00</td></tr><tr><td>Modern Poetry (</td><td>43</td><td>23</td><td>20</td><td>0</td><td>53.49</td><td>46.51</td><td>0.00</td><td>32</td><td>11</td><td>0</td><td>74.42</td><td>25.58</td><td>0.00</td></tr><tr><td>Lyrics ( )</td><td>30</td><td>8</td><td>22</td><td>0</td><td>26.67</td><td>73.33</td><td>0.00</td><td>16</td><td>14</td><td>0</td><td>53.33</td><td>46.67</td><td>0.00</td></tr><tr><td>Literary Appreciation (</td><td>27</td><td>20</td><td>7</td><td>0</td><td>74.07</td><td>25.93</td><td>0.00</td><td>18</td><td>9</td><td>0</td><td>66.67</td><td>33.33</td><td>0.00</td></tr><tr><td>General Argument. (</td><td>24</td><td>15</td><td>9</td><td>0</td><td>62.50</td><td>37.50</td><td>0.00</td><td>17</td><td>7</td><td>0</td><td>70.83</td><td>29.17</td><td>0.00</td></tr><tr><td>General Narrative </td><td>23</td><td>11</td><td>12</td><td>0</td><td>47.83</td><td>52.17</td><td>0.00</td><td>15</td><td>8</td><td>0</td><td>65.22</td><td>34.78</td><td>0.00</td></tr><tr><td>General Classical (</td><td></td><td>5</td><td>4</td><td>0</td><td>55.56</td><td>44.44</td><td>0.00</td><td>5</td><td>4</td><td>0</td><td>55.56</td><td>44.44</td><td>0.00</td></tr><tr><td>Creative Writing ()</td><td>96</td><td>2</td><td>4</td><td>0</td><td>33.33</td><td>66.67</td><td>0.00</td><td>4</td><td>2</td><td>0</td><td>66.67</td><td>33.33</td><td>0.00</td></tr><tr><td>Argumentative ()</td><td>502</td><td>5</td><td>0 1</td><td>0</td><td>100.00</td><td>0.00</td><td>0.00</td><td>5</td><td>0</td><td>0</td><td>100.00</td><td>0.00</td><td>0.00</td></tr><tr><td>General Mod. Poetry (</td><td></td><td>1</td><td></td><td>0</td><td>50.00</td><td>50.00</td><td>0.00</td><td>2</td><td>0</td><td></td><td>0 100.00</td><td>0.00</td><td>0.00</td></tr><tr><td>Total ()</td><td>2837</td><td>| 1703</td><td>1119</td><td>15</td><td>60.03</td><td>39.44</td><td>0.53</td><td>| 2198</td><td>634</td><td>5</td><td>77.48</td><td>22.35</td><td>0.18</td></tr></table>


> **表格数据概述**：表 13 从指令遵循(Instruction Following)和写作质量(Writing Quality)两个维度对比了 V4-Pro 与 Gemini-3.1-Pro 在中文创意写作上的表现。在写作质量维度上, V4-Pro 的优势极为显著：小说类(Fiction)80.77% vs 18.87%、同人文(Fan Fiction)83.25% vs 16.50%、叙事(Narrative)82.46% vs 17.54%, 几乎所有子类都超过 70% 胜率。指令遵循维度上, V4-Pro 同样全面领先, 但差距略小于写作质量维度。值得注意的是, 古典诗词(Classical Poetry)在两个维度上均为 50% 平局, 说明双方在这一极具文化特异性的领域旗鼓相当。整体数据表明 V4-Pro 在中文创意写作的质量层面具有压倒性优势。

Table 14 
| DeepSeek-V4-Pro vs. Claude-Opus-4.5 on Complex Instruction Following and Multi-Turn Writing.

表 14 | DeepSeek-V4-Pro 与 Claude-Opus-4.5 在复杂指令遵循与多轮写作上的对比。

<table><tr><td rowspan="2">Category</td><td rowspan="2"></td><td colspan="5">Internal Evaluation (</td></tr><tr><td># DS Opus Tie</td><td></td><td>DS% −</td><td>Opus% Tie%</td><td></td></tr><tr><td>Complex Inst. Following (</td><td>49</td><td>23</td><td>26 0</td><td>46.9%</td><td>53.1%</td><td>0.0%</td></tr><tr><td>Multi-Turn Writing ()</td><td>147</td><td>67</td><td>76</td><td>4 45.6%</td><td>51.7%</td><td>2.7%</td></tr><tr><td>Total (</td><td>196</td><td>90</td><td>102</td><td>4 45.9%</td><td>52.0%</td><td>2.0%</td></tr></table>

> **表格数据概述**：表 14 显示, 在与 Claude-Opus-4.5 的对比中, V4-Pro 在复杂指令遵循和多轮写作上略处下风：总计 196 个样本中, V4-Pro 胜率 45.9%, Claude-Opus-4.5 胜率 52.0%, 平局 2.0%。细分来看, 复杂指令遵循(Complex Instruction Following)差距较小(46.9% vs 53.1%), 多轮写作(Multi-Turn Writing)差距类似(45.6% vs 51.7%)。这是报告中少数 V4-Pro 未占优势的对比之一, 说明 Claude-Opus-4.5 在超长多轮交互和精细指令遵循上仍有竞争力。

> 译者注: 附录 B 的六张表格揭示了 V4-Pro 在智能体/搜索/写作等应用层能力的内部评测细节。数据可信度方面需关注：(1) 所有对比均为 DeepSeek 内部评估, 非第三方独立评测, 存在方法论和样本选择偏差的可能; (2) 与 Claude-Opus-4.5 的对比中 V4-Pro 略处下风, 这种"自曝其短"的呈现方式反而增加了报告的可信度; (3) 中文写作评测(表 12、13)的样本量和标注一致性未披露, 且内部评估的评分标准可能存在文化偏向; (4) 图 14 和图 15 展示了智能体执行投资分析和研究报告生成的多步骤输出, 属于定性示例而非定量评测, 其代表性需谨慎解读。

---

## 全文完

## 关联文件说明

- 英文 MinerU 原文: `03-DeepSeek-V4-mineru-en.md`
- 中文精译主稿: `01-DeepSeek-V4-技术报告精译.md`
- D5 Index: `05-DeepSeek-V4-Index.md`
- 源 PDF / MinerU 输出: `pdfs/`
- 图片目录: `images/`(语义化命名 `figure_*`)

