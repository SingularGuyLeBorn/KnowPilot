---
title: "GLM-5 Technical Report - Segment-by-Segment Translation with Translator's Notes"
description: GLM-5 技术报告逐段精译,含译者注
---


> 原文: GLM-5 Technical Report, Zhipu AI & Tsinghua University, arXiv:2602.15763v2, 2026-02-24
> 译者注: 本文是智谱 AI 与清华大学联合发布的 GLM-5 技术报告,代表了 2026 年初开源大模型的最高水平。GLM-5 的核心定位是"Agentic Engineering"(智能体工程),即从单纯的代码生成(vibe coding)转向能够自主完成端到端软件工程任务的智能体能力。

## Abstract

> 🔙 **[返回 14.6-GLM 家族总览](../../14.6-GLM.md)**

### 摘要

We present GLM-5, a next-generation foundation model designed to transition the paradigm of vibe coding to agentic engineering. Building upon the agentic, reasoning, and coding (ARC) capabilities of its predecessor, GLM-5 adopts DSA to significantly reduce training and inference costs while maintaining long-context fidelity. To advance model alignment and autonomy, we implement a new asynchronous reinforcement learning infrastructure that drastically improves post-training efficiency by decoupling generation from training. Furthermore, we propose novel asynchronous agent RL algorithms that further improve RL quality, enabling the model to learn from complex, long-horizon interactions more effectively. Through these innovations, GLM-5 achieves state-of-the-art performance on major open benchmarks. Most critically, GLM-5 demonstrates unprecedented capability in real-world coding tasks, surpassing previous baselines in handling end-to-end software engineering challenges.

我们介绍 GLM-5,一个旨在将 vibe coding 范式转变为 agentic engineering 的下一代基础模型。在其前代模型的 agentic、推理和编码(ARC)能力基础上,GLM-5 采用 DSA 以显著降低训练和推理成本,同时保持长上下文保真度。为推进模型对齐和自主性,我们实现了一种新的异步强化学习基础设施,通过解耦生成与训练来大幅提高后训练效率。此外,我们提出了新颖的异步智能体 RL 算法以进一步提升 RL 质量,使模型能够更有效地从复杂的长期交互中学习。通过这些创新,GLM-5 在主要开放基准上达到了最先进的性能。最关键的是,GLM-5 在真实世界编码任务中展示了前所未有的能力,超越了先前处理端到端软件工程挑战的基线。

> 译者注(技术谱系): "vibe coding"是 2025-2026 年兴起的概念,指开发者通过自然语言描述"氛围"或意图,让 AI 自动生成代码的编程范式。GLM-5 的目标是从这种"被动代码生成"升级到"主动工程智能体"(agentic engineering),即 AI 不仅能写代码,还能自主规划、调试、测试和部署完整项目。这一转变反映了 LLM 从"知识库"到"行动者"的演进趋势。

---

## 1 Introduction
### 引言

The pursuit of Artificial General Intelligence (AGI) requires not only scaling model parameters but also fundamentally rethinking the efficiency of intelligence and the architecture of autonomous improvement. With the release of GLM-4.5, we demonstrated that uniting Agentic, Reasoning, and Coding (ARC) capabilities into a single Model-of-Experts (MoE) architecture could yield state-of-the-art results across diverse benchmarks. However, as Large Language Models (LLMs) transition from passive knowledge repositories to active problem solvers, the dual challenges of computational cost and real-world adaptability -- particularly in complex software engineering -- have become the primary bottlenecks.

对通用人工智能(AGI)的追求不仅需要扩展模型参数,还需要从根本上重新思考智能的效率和自主改进的架构。随着 GLM-4.5 的发布,我们展示了将 Agentic、推理和编码(ARC)能力统一到一个混合专家(MoE)架构中可以在各种基准上产生最先进的结果。然而,随着大型语言模型(LLM)从被动知识库转变为主动问题解决者,计算成本和真实世界适应性(特别是在复杂软件工程中)的双重挑战已成为主要瓶颈。

We present GLM-5, our next-generation flagship model designed to overcome these barriers. GLM-5 represents a paradigm shift in both performance and efficiency, achieving state-of-the-art status on major open leaderboards, including ArtificialAnalysis.ai, the LMArena Text, and the LMArena Code.

我们推出 GLM-5,我们旨在克服这些障碍的下一代旗舰模型。GLM-5 在性能和效率方面都代表了范式转变,在主要开放排行榜上达到了最先进地位,包括 ArtificialAnalysis.ai、LMArena Text 和 LMArena Code。

More significantly, GLM-5 redefines the standard for real-world coding, demonstrating an unprecedented ability to handle complex, end-to-end software development tasks that go far beyond the scope of traditional static benchmarks like SWE-bench.

更重要的是,GLM-5 重新定义了真实世界编码的标准,展示了处理复杂端到端软件开发任务的空前能力,这些任务远远超出了 SWE-bench 等传统静态基准的范围。

> 译者注(设计动机): GLM-5 的发布标志着开源模型在 2026 年初达到了一个新的里程碑。1) Artificial Analysis Intelligence Index v4.0 得分 50 是首个开源模型突破 50 分大关;2) 与 GLM-4.5 相比,核心改进集中在四个维度: DSA 架构效率、异步 RL 基础设施、异步 Agent RL 算法、国产芯片全栈适配;3) "真实世界编码"(real-world coding)的概念超越了对静态基准的优化,强调在动态、长时程、多步骤的软件工程任务中的表现;4) 28.5T token 的训练量(相比 GLM-4.5 的未知量级)和 744B 总参数量(40B 激活)展示了智谱在规模和效率上的持续投入。

**Results.** Figure 1 shows the results of GLM-5, GLM-4.7, Claude Opus 4.5, Gemini 3 Pro, and GPT-5.2 (xhigh) on 8 agentic, reasoning, and coding benchmarks: Humanity's Last Exam, SWE-bench Verified, SWE-bench Multilingual, Terminal-Bench 2.0, BrowseComp, MCP-Atlas, tau^2-Bench, Vending Bench 2. On average, GLM-5 achieves about 20% improvement over our last version GLM-4.7, and is comparable to Claude Opus 4.5 and GPT-5.2 (xhigh), and better than Gemini 3 Pro.

**结果。** 图 1 展示了 GLM-5、GLM-4.7、Claude Opus 4.5、Gemini 3 Pro 和 GPT-5.2 (xhigh) 在 8 个 agentic、推理和编码基准上的结果: Humanity's Last Exam、SWE-bench Verified、SWE-bench Multilingual、Terminal-Bench 2.0、BrowseComp、MCP-Atlas、tau^2-Bench、Vending Bench 2。平均而言,GLM-5 比我们的上一个版本 GLM-4.7 提高了约 20%,与 Claude Opus 4.5 和 GPT-5.2 (xhigh) 相当,且优于 Gemini 3 Pro。

GLM-5 scores 50 on the Intelligence Index v4.0 and is the new open weights leader, up from GLM-4.7's score of 42 -- an 8 point jump driven by improvements across agentic performance and knowledge/hallucination. This is the first time an open weights model has achieved a score of 50 on the Artificial Analysis Intelligence Index v4.0.

GLM-5 在 Intelligence Index v4.0 上得分 50,成为新的开放权重领导者,高于 GLM-4.7 的 42 分 -- 这一 8 分的跃升由 agentic 性能和知识/幻觉方面的改进驱动。这是开放权重模型首次在 Artificial Analysis Intelligence Index v4.0 上达到 50 分。

**Methods.** Our Base Model training began with a massive 27 trillion token corpus, prioritizing code and reasoning early on. We then employed a distinct Mid-training phase to progressively extend context length from 4K to 200K, focusing specifically on long-context agentic data to ensure stability in complex workflows. In Post-Training, we moved beyond standard SFT. We implemented a sequential Reinforcement Learning pipeline -- starting with Reasoning RL, followed by Agentic RL, and finishing with General RL. Crucially, we utilized On-Policy Cross-Stage Distillation throughout this process to prevent catastrophic forgetting, ensuring the model retains its sharp reasoning edge while becoming a robust generalist.

**方法。** 我们的基础模型训练从一个庞大的 27 万亿 token 语料库开始,早期优先关注代码和推理。然后我们采用了一个独特的中期训练阶段,逐步将上下文长度从 4K 扩展到 200K,专门关注长上下文 agentic 数据以确保复杂工作流的稳定性。在后训练中,我们超越了标准 SFT。我们实现了一个顺序强化学习流程 -- 从推理 RL 开始,然后是 Agentic RL,最后以通用 RL 结束。至关重要的是,我们在整个过程中利用策略内跨阶段蒸馏来防止灾难性遗忘,确保模型在成为鲁棒通才的同时保持其敏锐的推理优势。

In summary, the leap in GLM-5's performance is driven by the following technical contributions:

总之,GLM-5 性能的飞跃由以下技术贡献驱动:

First, we adopt DSA (DeepSeek Sparse Attention), a novel architectural innovation that significantly reduces both training and inference costs. While GLM-4.5 improved efficiency through a standard MoE architecture, DSA allows GLM-5 to dynamically allocate attention resources based on token importance, drastically lowering the computational overhead without compromising long-context understanding or reasoning depth. With DSA, we scale the model parameters up to 744B and extend the training token budget to 28.5T tokens.

首先,我们采用 DSA (DeepSeek Sparse Attention),一种显著降低训练和推理成本的新颖架构创新。虽然 GLM-4.5 通过标准 MoE 架构提高了效率,但 DSA 允许 GLM-5 基于 token 重要性动态分配注意力资源,在不损害长上下文理解或推理深度的情况下大幅降低计算开销。借助 DSA,我们将模型参数扩展到 744B,并将训练 token 预算扩展到 28.5T。

Second, we have engineered a new asynchronous reinforcement learning infrastructure. Building on the "slime" framework and the decoupled rollout engines initialized in GLM-4.5, our new infrastructure further decouples generation from training to maximize GPU utilization. This system allows for massive-scale exploration of agent trajectories without the synchronization bottlenecks that previously hampered iteration speed, significantly improving the efficiency of our RL post-training pipeline.

其次,我们构建了一个新的异步强化学习基础设施。基于 GLM-4.5 中初始化的 "slime" 框架和解耦 rollout 引擎,我们的新基础设施进一步解耦生成与训练以最大化 GPU 利用率。该系统允许大规模探索智能体轨迹,而不会出现以前阻碍迭代速度的同步瓶颈,显著提高了我们 RL 后训练流程的效率。

Third, we present novel asynchronous Agent RL algorithms designed to enhance the quality of autonomous decision-making. In GLM-4.5, we utilized iterative self-distillation and outcome supervision to train agents. For GLM-5, we have developed asynchronous algorithms that allow the model to learn from diverse, long-horizon interactions continuously. These algorithms are specifically optimized to improve the model's planning and self-correction capabilities in dynamic environments, directly contributing to our dominance in real-world coding scenarios.

第三,我们提出了新颖的异步 Agent RL 算法,旨在提高自主决策的质量。在 GLM-4.5 中,我们利用迭代自蒸馏和结果监督来训练智能体。对于 GLM-5,我们开发了异步算法,允许模型持续从多样化的长期交互中学习。这些算法专门优化以改善模型在动态环境中的规划和自我纠正能力,直接促成了我们在真实世界编码场景中的主导地位。

Last, one more technical contribution lies in the fact that, from the first day, GLM-5 is full-stack adapted to Chinese GPU ecosystems. We have successfully completed deep optimization -- spanning from underlying kernels to upper-level inference frameworks -- across seven mainstream domestic chip platforms, including Huawei Ascend, Moore Threads, Hygon, Cambricon, Kunlunxin, MetaX, and Enflame.

最后,另一项技术贡献在于,从第一天起,GLM-5 就全栈适配中文 GPU 生态系统。我们已成功完成深度优化 -- 从底层内核到上层推理框架 -- 跨越七个主流国产芯片平台,包括华为昇腾、摩尔线程、海光、寒武纪、昆仑芯、沐曦和燧原。

> 译者注(工程细节): GLM-5 的四大技术贡献揭示了 2026 年 LLM 研发的几个关键趋势。1) DSA 采用是"站在巨人肩膀上"的典型案例: DeepSeek-V3.2 开源了稀疏注意力架构,智谱在此基础上快速跟进并整合到自研模型中,体现了开源社区的知识扩散效应;2) 异步 RL 基础设施(slime 框架)是工程上的重大突破: 传统 RL 中生成和训练是同步的,GPU 在等待生成完成时处于空闲状态,解耦后可以将 GPU 利用率提升到接近 100%;3) 国产芯片适配是一个具有战略意义的工程: 在中美芯片管制背景下,能够在 7 个国产平台上实现"从内核到框架"的优化,不仅确保了供应链安全,也为国内 AI 生态的独立发展提供了基础;4) 28.5T token 训练量和 744B/40B 的参数配置遵循了 Chinchilla 最优计算原则(约 20 token/参数),是一个相对均衡的设计。

## 2 Pre-Training
### 预训练

Similar to GLM-4.5, the base model of GLM-5 goes through two stages: pre-training for general language and coding capacity, and mid-training for agentic and long-context capacity. We extend the training token budget for all the training stages of GLM-5, totaling 28.5 trillion tokens for the base model.

与 GLM-4.5 类似,GLM-5 的基础模型经历两个阶段: 预训练以获得通用语言和编码能力,以及中期训练以获得 agentic 和长上下文能力。我们扩展了 GLM-5 所有训练阶段的训练 token 预算,基础模型总计 28.5 万亿 token。

### 2.1 Architecture
#### 架构

**Model size scaling.** GLM-5 scales to 256 experts and reduces its layer count to 80 to minimize expert parallelism communication overhead. This results in a 744B parameter model (40B active parameters), doubling the total size of GLM-4.5, which utilized 355B total and 32B active parameters.

**模型规模扩展。** GLM-5 扩展到 256 个专家并将层数减少到 80,以最小化专家并行通信开销。这产生了一个 744B 参数的模型(40B 激活参数),是 GLM-4.5 总规模的两倍,后者使用了 355B 总参数和 32B 激活参数。

**Multi-latent Attention.** By employing reduced key-value vectors, Multi-latent attention (MLA) matches the effectiveness of Grouped-Query Attention (GQA) but offers superior GPU memory savings and faster processing for long-context sequences. However, in our experiments with Muon optimizer, we find that MLA with a 576-dimension latent KV-cache cannot match the performance of GQA with 8 query groups (denoted as GQA-8, 2048-dimension KV-cache).

**多潜在注意力(MLA)。** 通过使用缩减的键值向量,多潜在注意力(MLA)与分组查询注意力(GQA)的效果相当,但为长上下文序列提供了更优的 GPU 内存节省和更快的处理速度。然而,在我们使用 Muon 优化器的实验中,我们发现具有 576 维潜在 KV 缓存的 MLA 无法匹配具有 8 个查询组(GQA-8, 2048 维 KV 缓存)的 GQA 性能。

To overcome the performance gap, we propose an adaptation to the recipe of Muon optimizer in GLM-4.5. In the original recipe, we apply matrix orthogonalization to the up-projection matrices W_UQ, W_UK, W_UV for multi-head queries, keys, and values. Instead, we split these matrices into smaller matrices for different heads and apply matrix orthogonalization to these independent matrices. The method, denoted as Muon Split, enables projection weights for different attention heads to update at different scales.

为克服性能差距,我们对 GLM-4.5 中 Muon 优化器的方案提出了改进。在原始方案中,我们对多头查询、键和值的上投影矩阵 W_UQ、W_UK、W_UV 应用矩阵正交化。相反,我们将这些矩阵分割为针对不同注意力头的更小矩阵,并对这些独立矩阵应用矩阵正交化。该方法称为 Muon Split,使不同注意力头的投影权重能够以不同尺度更新。

**Table 1: Evaluation results for GQA-8 and variants of MLA.**

**表 1: GQA-8 和 MLA 变体的评估结果。**

| Dataset | GQA-8 | MLA | MLA + Muon Split | MLA-256 + Muon Split |
|---------|-------|-----|------------------|---------------------|
| Hellaswag | 77.3 | 77.3 | 77.8 | 77.4 |
| MMLU | 61.2 | 61.5 | 62.5 | 62.0 |
| C-Eval | 60.0 | 59.7 | 62.1 | 59.9 |
| RACE | 79.6 | 77.8 | 79.9 | 79.6 |
| BBH | 53.3 | 48.9 | 51.8 | 51.3 |
| GSM8K | 47.6 | 46.2 | 45.0 | 47.5 |
| HumanEval | 38.5 | 33.5 | 36.7 | 36.6 |

As shown in Table 1, the method effectively improves the performance of MLA to match that of GQA-8. In practice, we also find that with Muon Split, the scale of attention logits of GLM-5 remains stable during pre-training without any clipping strategy.

如表 1 所示,该方法有效提升了 MLA 的性能以匹配 GQA-8。在实践中,我们还发现使用 Muon Split 时,GLM-5 的注意力 logit 尺度在预训练期间保持稳定,无需任何裁剪策略。

Another disadvantage of MLA is its high computational cost during decoding. In decoding, MLA performs a 576-dimensional dot product, higher than the 128-dimensional computation of GQA. While the number of attention heads in DeepSeek-V3 is selected according to the roofline of H800, it is inappropriate for other hardware. Given the Multi-head Attention (MHA) style of MLA during training and prefilling, we increase the head dimension from 192 to 256 and decrease the number of attention heads by 1/3. This keeps the training computation and the number of parameters constant while decreasing the decoding computation. The variant, denoted as MLA-256 in Table 1, matches the performance of MLA under Muon Split.

MLA 的另一个缺点是解码期间的高计算成本。在解码中,MLA 执行 576 维点积,高于 GQA 的 128 维计算。虽然 DeepSeek-V3 中的注意力头数量是根据 H800 的 roofline 选择的,但这不适用于其他硬件。鉴于 MLA 在训练和预填充期间的多头注意力(MHA)风格,我们将头维度从 192 增加到 256,并将注意力头数量减少 1/3。这在保持训练计算量和参数数量不变的同时减少了解码计算量。表 1 中称为 MLA-256 的变体,在 Muon Split 下与 MLA 的性能匹配。

> 译者注(架构细节): GLM-5 的 MLA 适配展示了工程上的精细权衡。1) 原始 MLA(576 维压缩 KV)在 Muon 优化器下性能不如 GQA-8,这是因为 Muon 的矩阵正交化对注意力权重的更新方式与 MLA 的压缩表示不兼容;2) Muon Split 的核心洞察是: 不同注意力头应该有不同的学习率/更新尺度,因为不同头关注的特征模式不同;3) MLA-256 的修改(头维度 192->256,头数减少 1/3)是一个硬件感知的设计: DeepSeek-V3 针对 H800 优化,而 GLM-5 需要支持更广泛的硬件(包括国产芯片),因此选择更大的头维度以降低解码计算量;4) 表 1 显示 MLA + Muon Split 在 C-Eval(62.1)和 RACE(79.9)上甚至超过了 GQA-8,说明这一改进不仅弥补了差距,还在某些任务上实现了超越。

**Multi-token Prediction with Parameter Sharing.** Multi-token prediction (MTP) increases the performance of base models and acts as draft models for speculative decoding. However, during training, to predict the next n tokens, n MTP layers are required. As a result, the memory usage of MTP parameters and the kv cache scales linearly with the number of speculative steps. Instead, DeepSeek-V3 is trained with a single MTP layer and predicts the next 2 tokens during inference. The training-inference discrepancy reduces the acceptance rate of the second token.

**参数共享的多 token 预测(MTP)。** 多 token 预测(MTP)提高了基础模型的性能,并作为投机解码的草稿模型。然而,在训练期间,要预测接下来的 n 个 token,需要 n 个 MTP 层。结果,MTP 参数和 kv 缓存的内存使用量随投机步数线性扩展。相反,DeepSeek-V3 使用单个 MTP 层训练,在推理期间预测接下来的 2 个 token。训练-推理差异降低了第二个 token 的接受率。

Therefore, we propose sharing the parameters of 3 MTP layers during training. This keeps the memory cost of the draft model consistent with DeepSeek-V3 while increasing the acceptance rate. In Table 2, we show that the acceptance length of GLM-5 is longer than DeepSeek-V3.2, given the same number of speculative steps (4) in our private prompt set.

因此,我们提出在训练期间共享 3 个 MTP 层的参数。这使草稿模型的内存成本与 DeepSeek-V3 保持一致,同时提高了接受率。在表 2 中,我们展示了在我们的私有提示集上使用相同数量的投机步数(4)时,GLM-5 的接受长度比 DeepSeek-V3.2 更长。

**Table 2: Comparison of accept lengths of DeepSeek-V3.2 and GLM-5.**

**表 2: DeepSeek-V3.2 和 GLM-5 的接受长度比较。**

| Model | Accept Length |
|-------|--------------|
| DeepSeek-V3.2 | 2.55 |
| GLM-5 | 2.76 |

**Continued Pre-Training with DeepSeek Sparse Attention (DSA).** We use DSA in our training. The core philosophy of DSA is to replace the traditional dense O(L^2) attention -- which becomes prohibitively expensive at 128K contexts -- with a dynamic, fine-grained selection mechanism. Unlike fixed patterns (like sliding windows), DSA "looks" at the content to decide which tokens are important.

**使用 DeepSeek 稀疏注意力(DSA)的持续预训练。** 我们在训练中使用 DSA。DSA 的核心思想是用动态、细粒度选择机制替代传统的稠密 O(L^2) 注意力 -- 后者在 128K 上下文中变得极其昂贵。与固定模式(如滑动窗口)不同,DSA "查看"内容以决定哪些 token 重要。

What makes DSA particularly interesting from a researcher's perspective is how it was introduced via Continued Pre-Training from a dense base model. This avoided the "astronomical" cost of training from scratch. The transition follows a two-stage "dense warm-up and sparse training adaptation" strategy.

从研究者的角度来看,DSA 的特别有趣之处在于它是如何通过从稠密基础模型进行持续预训练引入的。这避免了从头训练的"天文数字"成本。转换遵循两阶段"稠密预热和稀疏训练适应"策略。

**Table 3: Comparison of long-context benchmarks between MLA and DSA base models.**

**表 3: MLA 和 DSA 基础模型的长上下文基准比较。**

| Benchmark | MLA | DSA |
|-----------|-----|-----|
| MQ-NIAH-128k | 100.0 | 100.0 |
| MV-NIAH-128k | 95.5 | 97.0 |
| SQuAD-128k | 79.7 | 86.0 |
| HotpotQA-128k | 66.3 | 63.0 |

> 译者注(技术谱系): DSA 的采用是 GLM-5 架构上最重要的决策。1) DSA (DeepSeek Sparse Attention) 是 DeepSeek-V3.2 开源的核心创新,通过动态选择关键 token 来替代全量注意力,将 128K 上下文的注意力复杂度从 O(n^2) 降低到近似 O(n);2) "持续预训练"(Continued Pre-Training)而非从头训练是一个务实的选择: 在稠密模型上预训练到一定阶段后再切换到稀疏注意力,既保留了前期积累的知识,又避免了全周期稀疏训练的不稳定性;3) 表 3 显示 DSA 在大多数长上下文任务上优于 MLA(MQ-NIAH 持平,MV-NIAH 和 SQuAD 提升明显),但 HotpotQA 略有下降(66.3 vs 63.0),这可能是因为 HotpotQA 需要多文档联合推理,而 DSA 的 token 选择机制可能遗漏了某些跨文档关联;4) MTP 参数共享是一个巧妙的工程: 3 层共享参数既保持了训练时多步预测的能力,又没有增加内存开销,接受长度 2.76 > 2.55 证明其有效性。


### 2.2 Pre-training Data
#### 预训练数据

**Web.** Building upon the GLM-4.5 data pipeline, we refined our selection criteria for massive web datasets. We introduced another DCLM classifier based on sentence embeddings to identify and aggregate additional high-quality data beyond standard classifiers. To address the challenge of long-tail knowledge, we utilized a World Knowledge classifier -- optimized via Wikipedia entries and LLM-labeled data -- to distill valuable information from otherwise medium-low-quality data.

**网页数据。** 在 GLM-4.5 数据流程的基础上,我们细化了大规模网页数据集的选择标准。我们引入了另一个基于句子嵌入的 DCLM 分类器,以识别和聚合标准分类器之外的额外高质量数据。为解决长尾知识挑战,我们利用一个世界知识分类器 -- 通过维基百科条目和 LLM 标注数据优化 -- 从中低质量数据中提炼有价值的信息。

**Code.** We expand the code pre-training corpus with refreshed snapshots from major code hosting platforms and a larger collection of code-containing web pages, resulting in a 28% increase in fuzzily deduplicated unique tokens. To improve corpus integrity and reduce noise, we fix metadata alignment issues in Software Heritage code files and adopt a more accurate language classification pipeline. We follow GLM-4.5's quality-aware sampling strategy for source code and code-related web documents. In addition, we train dedicated classifiers for a broader set of low-resource programming languages (e.g., Scala, Swift, Lua, etc.), improving sampling quality for these languages.

**代码。** 我们用主要代码托管平台的最新快照和更多包含代码的网页来扩展代码预训练语料库,模糊去重后的唯一 token 增加了 28%。为提高语料库完整性并减少噪声,我们修复了 Software Heritage 代码文件中的元数据对齐问题,并采用更精确的语言分类流程。我们遵循 GLM-4.5 的源码和代码相关网页文档的质量感知采样策略。此外,我们为更多低资源编程语言(如 Scala、Swift、Lua 等)训练了专用分类器,提高了这些语言的采样质量。

**Math & Science.** We collect high-quality math & science data from webpages, books, and papers to further increase the reasoning abilities. Specifically, the content extraction pipelines for webpages and PDF parsing mechanisms for books and papers are refined to increase data quality. We adopt large language models to score candidate documents and only retain the most educational content. For long-context documents, we develop a chunk-and-aggregate scoring algorithm to increase scoring accuracy. Filtering pipelines are conducted to strictly avoid the use of synthetic, AI-generated, or template-based data.

**数学与科学。** 我们从网页、书籍和论文中收集高质量的数学与科学数据,以进一步提升推理能力。具体而言,网页的内容提取流程和书籍论文的 PDF 解析机制都经过改进以提高数据质量。我们采用大型语言模型对候选文档进行评分,仅保留最具教育价值的内容。对于长上下文文档,我们开发了分块聚合评分算法以提高评分准确性。过滤流程严格执行,严格避免使用合成、AI 生成或基于模板的数据。

> 译者注(数据可信度): GLM-5 的数据策略有几个值得注意的细节。1) "严格避免合成数据"的声明是一个重要立场: 在 2025-2026 年,许多模型大量使用合成数据来扩充训练集,但 GLM-5 明确选择限制合成数据,可能是因为过度依赖合成数据会导致模型坍塌(model collapse);2) DCLM 分类器 + 句子嵌入 + 世界知识分类器的三级过滤体系展示了数据质量工程的专业化;3) 低资源编程语言(Scala、Swift、Lua)的专用分类器表明 GLM-5 不仅追求"代码量大",还追求"语言覆盖广";4) 28% 的代码 token 增量结合 27T 总训练量,说明代码在预训练中的比重显著增加,这与 GLM-5 强调编码能力的定位一致。

### 2.3 Mid-Training
#### 中期训练

Building upon the mid-training framework introduced in GLM-4.5, we scale up both the training volume and the maximum context length in GLM-5 to further strengthen the model's reasoning, long-context, and agentic capabilities.

在 GLM-4.5 引入的中期训练框架基础上,我们扩大了 GLM-5 的训练量和最大上下文长度,以进一步增强模型的推理、长上下文和 agentic 能力。

**Extended context and training scale.** We progressively extend the context window across three stages: 32K (1T tokens), 128K (500B tokens), and 200K (50B tokens). Compared to the 128K maximum in GLM-4.5, the additional 200K stage substantially improves the model's ability to process ultra-long documents and complex multi-file codebases. Long documents and synthetic agent trajectories are up-sampled at the later stages accordingly.

**扩展上下文和训练规模。** 我们在三个阶段逐步扩展上下文窗口: 32K (1T token)、128K (500B token) 和 200K (50B token)。与 GLM-4.5 的 128K 最大值相比,额外的 200K 阶段显著提高了模型处理超长文档和复杂多文件代码库的能力。长文档和合成智能体轨迹在后续阶段相应地进行上采样。

**Software engineering data.** We retain the paradigm of concatenating repo-level code files, commit diffs, GitHub issues, pull requests, and relevant source files into unified training sequences. In GLM-5, we relax the repository-level filtering criteria to broaden the pool of eligible repositories, yielding approximately 10 million issue-PR pairs, while strengthening quality filtering at the individual issue level to reduce noise. After filtering, the issue-PR portion of the dataset comprises approximately 160B unique tokens.

**软件工程数据。** 我们保留了将仓库级代码文件、提交差异、GitHub issue、pull request 和相关源文件拼接为统一训练序列的范式。在 GLM-5 中,我们放宽了仓库级过滤标准以扩大合格仓库池,产生了约 1000 万个 issue-PR 对,同时在单个 issue 层面加强质量过滤以减少噪声。过滤后,数据集的 issue-PR 部分包含约 160B 唯一 token。

**Long-context data.** Our long-context training set comprises both natural and synthetic data. Natural data is curated from books, academic papers, and documents from general pre-training corpora employing multi-stage filtering (PPL, deduplication, length) and upsampling knowledge-intensive domains. In synthetic data construction, inspired by NextLong and EntropyLong, we employed diverse techniques to build long-range dependencies. Highly similar texts were aggregated via interleaved packing to produce sequences, aiming to mitigate the lost-in-the-middle phenomenon and improve performance across a range of long-context tasks. At the 200K stage, we additionally incorporated a small proportion of MRCR-like data to strengthen recall in extended multi-turn dialogues.

**长上下文数据。** 我们的长上下文训练集包括自然数据和合成数据。自然数据来自书籍、学术论文和通用预训练语料库中的文档,采用多级过滤(PPL、去重、长度)和知识密集型领域上采样。在合成数据构建中,受 NextLong 和 EntropyLong 启发,我们采用多种技术构建长程依赖。高度相似的文本通过交错打包聚合成序列,旨在缓解"中间丢失"现象并提高一系列长上下文任务的性能。在 200K 阶段,我们额外加入了少量类似 MRCR 的数据以增强扩展多轮对话中的召回能力。

> 译者注(工程细节): 中期训练是 GLM-5 的一个关键差异化设计。1) 三阶段上下文扩展(32K->128K->200K)总共 1.55T token,占总训练量(28.5T)的约 5.4%,这个比例是精心设计的 -- 太少则长上下文能力不足,太多则影响通用能力;2) 160B issue-PR token 的软件工程数据是 GLM-5 编码能力的核心基础,这解释了为什么 GLM-5 在 SWE-bench 等真实工程任务上表现突出;3) "中间丢失"(lost-in-the-middle)是长上下文模型中的经典问题,即模型对上下文中间部分的信息召回较弱,交错打包(interleaved packing)是一种有效的缓解策略;4) 200K 上下文能力使 GLM-5 能够处理整个代码仓库级别的输入,而不仅仅是单个文件。

### 2.4 Training Infrastructure
#### 训练基础设施

**Memory Efficiency.** Flexible MTP placement. Under interleaved pipeline parallelism, model components are flexibly assigned to stages. The MTP module spans embedding, transformer, and output components. It incurs substantially higher memory usage than other modules, leading to stage-level imbalance. We co-locate the MTP output layer with the main output layer on the final stage to enable parameter sharing, while placing its embedding and transformer components on the preceding stage. This reduces memory pressure on the final stage and improves balance across pipeline ranks.

**内存效率。** 灵活的 MTP 放置。在交错流水线并行下,模型组件被灵活地分配到不同阶段。MTP 模块跨越嵌入、Transformer 和输出组件。它的内存使用量比其他模块高得多,导致阶段级不平衡。我们将 MTP 输出层与主输出层共同放置在最后阶段以实现参数共享,同时将其嵌入和 Transformer 组件放置在前一阶段。这减少了最后阶段的内存压力并改善了流水线秩之间的平衡。

Pipeline ZeRO2 gradient sharding. Each pipeline rank maintains multiple stages, and naively each stage requires a full gradient buffer for accumulation and optimizer updates. Inspired by ZeRO2, we shard gradients across data-parallel ranks so that each stage stores only a 1/dp fraction of the full gradients. In addition, we retain full accumulation buffers for only two stages at a time and reuse them via double buffering.

Pipeline ZeRO2 梯度分片。每个流水线秩维护多个阶段,朴素地每个阶段都需要完整的梯度缓冲区来进行累积和优化器更新。受 ZeRO2 启发,我们在数据并行秩之间分片梯度,使每个阶段仅存储完整梯度的 1/dp 部分。此外,我们一次仅保留两个阶段的完整累积缓冲区,并通过双缓冲重用它们。

Zero-redundant communication for the Muon distributed optimizer. Naive Muon implementations all-gather full model parameters on each data-parallel rank, causing transient memory spikes and redundant communication. We restrict all-gather to parameter shards owned by each rank and overlap local computation with shard communication. This eliminates redundant communication and significantly reduces optimizer-related peak memory overhead.

Muon 分布式优化器的零冗余通信。朴素的 Muon 实现在每个数据并行秩上 all-gather 完整的模型参数,导致瞬态内存峰值和冗余通信。我们将 all-gather 限制为每个秩拥有的参数分片,并将本地计算与分片通信重叠。这消除了冗余通信并显著降低了与优化器相关的峰值内存开销。

Pipeline activation offloading. During pipeline warmup, forward execution advances ahead of backpropagation, prolonging the lifetime of intermediate activations. We offload the activations to CPU memory and prefetch them back to GPU just before they are needed for backward computation. This hides most of the data-movement latency behind computation and substantially reduces peak activation memory.

流水线激活卸载。在流水线预热期间,前向执行先于反向传播,延长了中间激活的生命周期。我们将激活卸载到 CPU 内存,并在反向计算需要它们之前将其预取回 GPU。这将大部分数据移动延迟隐藏在计算之后,并大幅降低了峰值激活内存。

> 译者注(工程细节): GLM-5 的训练基础设施优化展示了 100B+ 模型工程的前沿实践。1) MTP 模块的跨阶段放置是一个精妙的内存优化: 通过将输出层与主输出层共享,避免了最后一阶段的内存瓶颈;2) Pipeline ZeRO2 将梯度分片与双缓冲结合,在不影响同步开销的情况下将梯度内存减少了 dp 倍;3) Muon 优化器的冗余通信消除尤为重要: Muon 是一个正交化优化器,需要 all-gather 操作,传统的实现会在每个训练步骤产生巨大的通信开销,GLM-5 的改进使其能够扩展到更大规模;4) 激活卸载到 CPU 是一个经典但有效的技术,在流水线并行中尤其重要,因为流水线会导致激活生命周期的显著延长。

## 3 Post-Training
### 后训练

The post-training phase of GLM-5 aims to transform the base model into a highly capable assistant with robust reasoning, coding, and agentic abilities. As illustrated in Figure 5, our pipeline follows a progressive alignment strategy: starting with multi-task Supervised Fine-Tuning (SFT) that introduces sophisticated interleaved thinking modes, followed by specialized Reinforcement Learning (RL) stages for reasoning and agentic tasks, and concluding with a general RL stage for human-style alignment. By leveraging on-policy cross-stage distillation as the final refinement, GLM-5 effectively mitigates catastrophic forgetting while harnessing the performance gains from each training stage.

GLM-5 的后训练阶段旨在将基础模型转变为具有强大推理、编码和 agentic 能力的高能力助手。如图 5 所示,我们的流程遵循渐进对齐策略: 从引入复杂交错思考模式的多任务监督微调(SFT)开始,然后是针对推理和 agentic 任务的专门强化学习(RL)阶段,最后以用于类人风格对齐的通用 RL 阶段结束。通过利用策略内跨阶段蒸馏作为最终精修,GLM-5 有效缓解了灾难性遗忘,同时利用了每个训练阶段的性能增益。

### 3.1 Supervised Fine-Tuning
#### 监督微调

Compared with GLM-4.5, GLM-5 significantly expands the scale of Agent and Coding data during the SFT stage. The SFT corpus of GLM-5 covers three major categories:

与 GLM-4.5 相比,GLM-5 在 SFT 阶段显著扩展了 Agent 和 Coding 数据的规模。GLM-5 的 SFT 语料库涵盖三个主要类别:

- **General Chat:** question answering, writing, role-playing, translation, multi-turn dialogue, and long-context interactions;
- **Reasoning:** mathematical, programming, and scientific reasoning;
- **Coding & Agent:** frontend and backend engineering code, tool calling, coding agents, search agents, and general-purpose agents.

- **通用聊天:** 问答、写作、角色扮演、翻译、多轮对话和长上下文交互;
- **推理:** 数学、编程和科学推理;
- **编码与智能体:** 前端和后端工程代码、工具调用、编码智能体、搜索智能体和通用智能体。

Additionally, GLM-5 extends the maximum context length to 202,752 tokens during SFT. Along with an updated chat template, the model supports three distinct thinking characteristics:

此外,GLM-5 在 SFT 期间将最大上下文长度扩展到 202,752 token。配合更新的聊天模板,模型支持三种不同的思考特性:

- **Interleaved Thinking:** the model thinks before every response and tool call, improving instruction following and the quality of generation.
- **Preserved Thinking:** in coding agent scenarios, the model automatically retains all thinking blocks across multi-turn conversations, reusing existing reasoning instead of re-deriving it from scratch. This reduces information loss and inconsistencies, and is well-suited for long-horizon, complex tasks.
- **Turn-level Thinking:** the model supports per-turn control over reasoning within a session -- disable thinking for lightweight requests to reduce latency/cost, enable it for complex tasks to improve accuracy and stability.

- **交错思考(Interleaved Thinking):** 模型在每次响应和工具调用之前进行思考,改善指令遵循和生成质量。
- **保留思考(Preserved Thinking):** 在编码智能体场景中,模型自动保留多轮对话中的所有思考块,重用现有推理而非从头重新推导。这减少了信息损失和不一致性,非常适合长时程复杂任务。
- **轮级思考(Turn-level Thinking):** 模型支持在会话中对推理进行每轮控制 -- 对轻量级请求禁用思考以减少延迟/成本,对复杂任务启用思考以提高准确性和稳定性。

> 译者注(设计动机): GLM-5 的三种思考模式代表了对话模型交互设计的精细化。1) "交错思考"借鉴了 Claude 3.7 Sonnet 的 extended thinking 模式,在每次行动前加入显式推理步骤,这对 agentic 任务至关重要;2) "保留思考"解决了长时程任务中的信息丢失问题: 当编码智能体在 10+ 轮对话中工作时,如果每轮都重新推导所有推理,既耗时又容易出错,保留思考块使模型能够"记住"之前的推理路径;3) "轮级思考"是一个成本控制机制: 简单问答不需要深度思考,复杂编程任务需要,让用户/系统能够按需切换;4) 202,752 token 的 SFT 上下文长度(约 200K)与中期训练的 200K 阶段一致,确保了对齐后的模型能够充分利用基础模型的长上下文能力。

### 3.2 Reasoning RL
#### 推理强化学习

**RL algorithm backbone.** Our RL algorithm builds upon GRPO and incorporates the IcePop technique to mitigate the training-inference mismatch, i.e., the discrepancy between the inference distribution and the training distribution during RL optimization. We explicitly distinguish between the training policy pi_train, used for gradient updates, and the inference policy pi_infer, used for trajectory sampling. Compared to the original IcePop formulation, we remove the KL regularization term to accelerate RL improvement.

**RL 算法骨干。** 我们的 RL 算法基于 GRPO 并引入 IcePop 技术来缓解训练-推理不匹配,即 RL 优化期间推理分布与训练分布之间的差异。我们明确区分用于梯度更新的训练策略 pi_train 和用于轨迹采样的推理策略 pi_infer。与原始 IcePop 公式相比,我们移除了 KL 正则化项以加速 RL 改进。

**DSA RL insights.** We conduct a very large-scale RL training on a model based on the DSA architecture. Compared with MLA, DSA introduces an additional indexer that retrieves the top-k most relevant key-value entries and computes attention sparsely over the retrieved subset. The retrieved top-k results are critical for RL stability. This is analogous to how MoE models use routing replay to preserve the activated top-k experts to ensure training-inference consistency.

**DSA RL 洞察。** 我们在基于 DSA 架构的模型上进行了非常大型的 RL 训练。与 MLA 相比,DSA 引入了一个额外的索引器,检索 top-k 最相关的键值条目并在检索到的子集上稀疏计算注意力。检索到的 top-k 结果对 RL 稳定性至关重要。这类似于 MoE 模型如何使用路由重播来保留激活的 top-k 专家以确保训练-推理一致性。

We find that adopting a deterministic top-k operator effectively resolves the training-inference mismatch in DSA indexer token selection. Compared with the non-deterministic CUDA-based top-k implementation used in SGLang's DSA Indexer, directly using the naive torch.topk is slightly slower but deterministic. It produces more consistent outputs and yields substantial RL gains. Therefore, throughout our RL stages, we use torch.topk as the default top-k operator in the DSA Indexer in our training engine. We also freeze the indexer parameters by default during RL to accelerate training and prevent unstable learning in the indexer.

我们发现采用确定性 top-k 算子有效解决 DSA 索引器 token 选择中的训练-推理不匹配。与 SGLang 的 DSA 索引器中使用的非确定性 CUDA top-k 实现相比,直接使用朴素的 torch.topk 稍慢但具有确定性。它产生更一致的输出并带来显著的 RL 增益。因此,在我们的 RL 阶段中,我们在训练引擎的 DSA 索引器中使用 torch.topk 作为默认 top-k 算子。我们还在 RL 期间默认冻结索引器参数以加速训练并防止索引器中的不稳定学习。

> 译者注(工程细节): DSA 索引器的确定性 top-k 是一个关键的稳定性发现。1) 非确定性 top-k (如 CUDA 实现)在不同运行中可能返回相同的 top-k 元素但顺序不同,或者在边界情况下选择不同的元素,这种微小差异在 RL 的迭代过程中会被放大,导致策略崩溃;2) torch.topk 的确定性保证了训练-推理的一致性,这是 RL 稳定性的必要条件;3) 冻结索引器参数是一个务实的选择: 索引器负责 token 路由,如果在 RL 中同时更新,其梯度可能与主策略的梯度冲突,导致不稳定;4) 移除 KL 正则化项以加速 RL 改进是一个激进的决策: KL 约束通常用于防止策略偏离太远,但 GLM-5 认为 IcePop 的 pop 算子已提供了足够的约束。

**Mixed domain reasoning RL.** In the Reasoning RL stage, we perform mixed RL training over four domains: mathematics, science, code, and tool-integrated reasoning (TIR). For mathematics and science, we curate data from both open-source datasets and co-developed collections with external annotation vendors. We further apply difficulty filtering to focus training on problems that GLM-4.7 solves correctly only rarely or fails consistently, while remaining solvable by stronger teacher models. For code, we cover both competitive programming style tasks and scientific coding tasks. For TIR, we reuse the more challenging subset of mathematics and science RL data, and additionally co-build STEM questions with annotation vendors that are explicitly designed to be answered with external tools. During RL training, we assign domain and source-specific judge models or evaluation systems to produce binary outcome rewards.

**混合领域推理 RL。** 在推理 RL 阶段,我们在四个领域进行混合 RL 训练: 数学、科学、代码和工具集成推理(TIR)。对于数学和科学,我们从开源数据集和与外部标注供应商共同开发的集合中策划数据。我们进一步应用难度过滤,将训练集中在 GLM-4.7 很少正确解决或持续失败的问题上,同时这些问题仍可由更强的教师模型解决。对于代码,我们涵盖竞赛编程风格任务和科学编码任务。对于 TIR,我们重用数学和科学 RL 数据中更具挑战性的子集,并与标注供应商共同构建明确设计为使用外部工具回答的 STEM 问题。在 RL 训练期间,我们分配领域和源特定的评判模型或评估系统来产生二元结果奖励。

### 3.3 Agentic RL
#### Agentic 强化学习

To facilitate agentic performance of GLM-5, we develop a fully asynchronous and decoupled RL framework and optimize GLM-5 in coding and search agent tasks. Naive synchronous RL suffers from severe GPU idle time during long-horizon agent rollouts. By decoupling inference and training engines via a central Multi-Task Rollout Orchestrator, we achieve high-throughput joint training across diverse agentic workloads.

为促进 GLM-5 的 agentic 性能,我们开发了一个完全异步和解耦的 RL 框架,并在编码和搜索智能体任务中优化 GLM-5。朴素同步 RL 在长时程智能体 rollout 期间遭受严重的 GPU 空闲时间。通过中央多任务 Rollout 编排器解耦推理和训练引擎,我们在各种 agentic 工作负载上实现了高吞吐量联合训练。

To maintain training stability under asynchronous off-policy conditions, we introduce two key mechanisms. First, a Token-in-Token-out (TITO) gateway eliminates re-tokenization mismatches by directly passing token IDs between inference and training engines. Second, we employ direct double-sided importance sampling for token clipping: instead of tracking exact behavior probabilities across multiple policy versions, we reuse the log-probabilities generated during rollout as a direct behavior proxy, and apply a symmetric trust-region clipping to prevent extreme policy divergence.

为了在异步离策略条件下保持训练稳定性,我们引入了两种关键机制。首先,Token-in-Token-out (TITO) 网关通过在推理和训练引擎之间直接传递 token ID 来消除重新 token 化不匹配。其次,我们采用直接双边重要性采样进行 token 裁剪: 不跟踪多个策略版本的确切行为概率,而是重用 rollout 期间生成的对数概率作为直接行为代理,并应用对称信任区域裁剪以防止极端策略发散。

> 译者注(工程细节): Agentic RL 是 GLM-5 最具创新性的工程贡献之一。1) TITO (Token-in-Token-out) 解决了异步 RL 中的一个隐蔽但致命的问题: 如果推理引擎生成文本,训练引擎重新 token 化,由于 tokenizer 的边界差异(如空格处理、特殊 token 放置),可能导致 action-reward 对齐错误;2) 直接双边重要性采样是对标准 PPO 的简化: 传统 PPO 需要维护旧策略 pi_old 来计算重要性比率,但在异步设置中,一个轨迹生成期间推理引擎可能已更新多次,追踪 pi_old 不现实,GLM-5 直接用 rollout 时的 log-prob 作为行为代理;3) "对称信任区域"([1-eps_low, 1+eps_high]) 与标准 PPO 的非对称裁剪不同,它完全屏蔽区间外的 token,而不是裁剪其梯度,这提供了更强的稳定性保证。

## 4 Agentic Engineering
### Agentic 工程

We describe the transition from vibe coding (human prompting) to agentic engineering. In vibe coding, a human prompts an AI model to write code. In agentic engineering, AI agents write the code themselves. They plan, implement, and iterate. To support these long-horizon tasks, GLM-5 utilizes a fully asynchronous and decoupled RL framework to significantly boost GPU utilization by reducing idle time during agent rollouts. To scaling agent environments, we have developed environment-building pipelines. For coding tasks, we set up real-world software engineering issues and terminal tasks by creating over 10,000 verifiable training scenarios. For search agents, we develop an automatic and scalable complex multi-step reasoning data synthesis pipeline to build data for agentic training.

我们描述从 vibe coding(人类提示)到 agentic engineering 的转变。在 vibe coding 中,人类提示 AI 模型编写代码。在 agentic engineering 中,AI 智能体自己编写代码。它们规划、实现和迭代。为支持这些长时程任务,GLM-5 利用完全异步和解耦的 RL 框架,通过减少智能体 rollout 期间的空闲时间来显著提高 GPU 利用率。为扩展智能体环境,我们开发了环境构建流程。对于编码任务,我们通过创建超过 10,000 个可验证的训练场景来设置真实世界软件工程问题和终端任务。对于搜索智能体,我们开发了自动且可扩展的复杂多步推理数据合成流程来构建 agentic 训练数据。

### 4.1 Asynchronous RL for Agentic Tasks
#### Agentic 任务的异步 RL

To conduct RL for agent tasks, we design a fully asynchronous and decoupled RL infrastructure that efficiently handles long-horizon agent rollouts and supports flexible multi-task RL training across diverse agent frameworks.

为对智能体任务进行 RL,我们设计了一个完全异步和解耦的 RL 基础设施,高效处理长时程智能体 rollout,并支持跨多样化智能体框架的灵活多任务 RL 训练。

We adopt the group-wise policy optimization algorithm for RL training. For each problem x, we sample K agent traces {y_1, ..., y_K} from the previous policy pi_old, and optimize the model pi_theta with respect to the following objective: maximize the expected advantage of model-generated tokens over the mean reward of the sampled responses. It is noted that only model-generated tokens are used for optimization, and the environment feedback is ignored in loss computation.

我们采用组级策略优化算法进行 RL 训练。对于每个问题 x,我们从先前策略 pi_old 采样 K 个智能体轨迹 {y_1, ..., y_K},并相对于以下目标优化模型 pi_theta: 最大化模型生成 token 相对于采样响应平均奖励的预期优势。注意,仅模型生成的 token 用于优化,环境反馈在损失计算中被忽略。

**Asynchronous RL Design for Agentic Training.** Due to the long-tail nature of the rollout process, naive synchronous RL training introduces substantial bubbles during the rollout stage because of the severely imbalanced generation of agentic tasks, which can cause large GPU idle time. To improve training throughput, we adopt a fully asynchronous training paradigm for Agentic RL to boost GPU utilization and training efficiency. Concretely, we decouple the training engine and the inference engine onto different GPU devices. The inference engine continuously generates trajectories. Once the number of generated trajectories reaches a predefined threshold, the batch is sent to the training engine to update the model.

**Agentic 训练的异步 RL 设计。** 由于 rollout 过程的长尾性质,朴素同步 RL 训练在 rollout 阶段引入大量气泡,因为智能体任务的生成严重不平衡,可能导致大量 GPU 空闲时间。为提高训练吞吐量,我们对 Agentic RL 采用完全异步训练范式以提高 GPU 利用率和训练效率。具体而言,我们将训练引擎和推理引擎解耦到不同的 GPU 设备上。推理引擎持续生成轨迹。一旦生成的轨迹数量达到预定义阈值,批次就被发送到训练引擎以更新模型。

**Server-based multi-task training design.** To address the heterogeneity of trajectory generation in multi-task RL, where different tasks typically rely on distinct tool sets and task-specific rollout logic, we introduce a server-based Multi-Task Rollout Orchestrator for multi-task RL training. This component is designed to ensure seamless compatibility between the slime RL training framework and diverse downstream tasks through a central orchestrator with multiple registered task services. Specifically, each task implements its own rollout and reward logic as an independent microservice, which is registered with the central orchestrator for management and scheduling. Serving as the backbone of the GLM-5 training infrastructure, this orchestrator supports over 1k concurrent rollouts and enables automated, dynamic adjustment of task sampling ratios.

**基于服务器的多任务训练设计。** 为解决多任务 RL 中轨迹生成的异构性(不同任务通常依赖不同的工具集和任务特定 rollout 逻辑),我们引入了基于服务器的多任务 Rollout 编排器用于多任务 RL 训练。该组件旨在通过具有多个注册任务服务的中央编排器,确保 slime RL 训练框架与多样化下游任务之间的无缝兼容。具体而言,每个任务将自己的 rollout 和奖励逻辑实现为独立微服务,注册到中央编排器进行管理和调度。作为 GLM-5 训练基础设施的骨干,该编排器支持超过 1k 个并发 rollout,并实现任务采样比例的自动动态调整。

> 译者注(工程细节): GLM-5 的异步 RL 基础设施(slime 框架)代表了 LLM 后训练工程的最新水平。1) 训练-推理解耦到不同 GPU 是核心架构决策: 推理 GPU 持续生成轨迹(可充分利用其内存带宽),训练 GPU 专注于梯度计算(可充分利用其 Tensor Core),两者通过中央编排器协调;2) 1k+ 并发 rollout 是一个巨大的规模: 传统同步 RL 可能只有 32-64 个并发环境,1k 意味着约 30 倍的并行度提升;3) 微服务架构的任务注册机制使新任务能够快速接入训练流程,无需修改核心训练代码,这对于快速迭代 agentic 能力至关重要;4) "环境反馈在损失计算中被忽略"是一个重要细节: 只有模型生成的 token 参与策略梯度计算,环境返回的奖励仅用于优势估计,这确保了策略优化专注于改进模型自身的生成质量,而非学习利用环境漏洞。


### 4.2 Environment Scaling for Agents
#### 智能体环境扩展

To support reinforcement learning across diverse agentic tasks, we construct verifiable, executable environments that provide grounded feedback for both code-centric and content-generation workflows. For agentic coding tasks, we develop two environment-building pipelines that construct verifiable executable environments: an environment setup pipeline built upon real-world software engineering issues, and a synthesis pipeline for terminal-agent environments.

为支持跨多样化 agentic 任务的强化学习,我们构建可验证、可执行的环境,为以代码为中心和内容生成工作流提供基于事实的反馈。对于 agentic 编码任务,我们开发了两个构建可验证可执行环境的环境构建流程: 一个基于真实世界软件工程问题的环境设置流程,以及一个终端智能体环境的合成流程。

**Software Engineering (SWE) Environments.** Before constructing executable environments, we collect a large corpus of real-world Issue-Pull Request (PR) pairs and apply rigorous rule-based and LLM-based filtering to ensure the acquisition of authentic, high-quality issue statements. We categorize these instances into different task types -- bug fixing, feature implementation, refactoring, and others -- and include the necessary task requirements to ensure that the model's implementation is consistent with the test patch. We employ an environment setup pipeline based on the RepoLaunch framework that scales the construction of executable environments from real-world SWE issues. Using this pipeline, we construct over 10k verifiable environments across thousands of repositories spanning 9 programming languages, including Python, Java, Go, C, CPP, JavaScript, TypeScript, PHP, and Ruby.

**软件工程(SWE)环境。** 在构建可执行环境之前,我们收集大量真实世界的 Issue-Pull Request (PR) 对,并应用严格的基于规则和基于 LLM 的过滤以确保获取真实、高质量的 issue 陈述。我们将这些实例分类为不同的任务类型 -- bug 修复、功能实现、重构等 -- 并包含必要的任务要求以确保模型的实现与测试补丁一致。我们采用基于 RepoLaunch 框架的环境设置流程,该流程可扩展地从真实世界 SWE 问题构建可执行环境。使用该流程,我们在跨越 9 种编程语言(包括 Python、Java、Go、C、C++、JavaScript、TypeScript、PHP 和 Ruby)的数千个仓库中构建了超过 10k 个可验证环境。

**Terminal Environments.** To build verifiable terminal-agent environments at scale, we design an agentic data synthesis pipeline comprising three phases: task draft generation, concrete task implementation, and iterative task optimization. Starting from a set of seed tasks collected from real-world software engineering and terminal-based computer-use scenarios, we leveraged LLM to brainstorm and generate a large pool of verifiable terminal-task drafts. These drafts are then instantiated by a construction agent into concrete tasks in the Harbor format, including structured task descriptions, Dockerized execution environments, and corresponding test scripts. Subsequently, a refine agent inspects and iteratively refines the generated tasks according to manually defined rubrics. Overall, the pipeline yields thousands of diverse and verifiable terminal-agent environments with Docker construction accuracy exceeding 90%.

**终端环境。** 为大规模构建可验证的终端智能体环境,我们设计了一个包含三个阶段的 agentic 数据合成流程: 任务草案生成、具体任务实现和迭代任务优化。从收集自真实世界软件工程和基于终端的计算机使用场景的种子任务集开始,我们利用 LLM 头脑风暴并生成大量可验证的终端任务草案。然后,构建智能体将这些草案实例化为 Harbor 格式的具体任务,包括结构化任务描述、Docker 化执行环境和相应的测试脚本。随后,精修智能体根据手动定义的评分标准检查并迭代优化生成的任务。总体而言,该流程产生了数千个多样化且可验证的终端智能体环境,Docker 构建准确率超过 90%。

**Search Tasks.** For deep-search information-seeking tasks, we build a data-synthesis pipeline that produces challenging multi-hop QA pairs. Each question requires multi-step reasoning grounded in evidence aggregated from multiple web sources. Starting from trajectories of an early-stage search agent, we collect and deduplicate all encountered URLs, retaining over two million high-information web pages across diverse domains. The LLM performs semantic parsing for entity recognition, noise filtering, and structured information extraction. The Web Knowledge Graph (WKG) is continuously updated with new pages and refined using downstream verification signals. Based on the WKG, we sample low- to mid-frequency entities as seed nodes and expand their multi-hop neighborhoods to form complete subgraphs. Using prompts targeting high-difficulty, multi-domain reasoning, we convert each subgraph into a question that implicitly encodes multi-entity relational chains.

**搜索任务。** 对于深度搜索信息检索任务,我们构建了一个数据合成流程,产生具有挑战性的多跳 QA 对。每个问题需要基于从多个网络来源聚合的证据进行多步推理。从早期搜索智能体的轨迹开始,我们收集并去重所有遇到的 URL,保留跨越多个领域的超过 200 万个高信息网页。LLM 执行语义解析进行实体识别、噪声过滤和结构化信息提取。网络知识图谱(WKG)持续用新页面更新,并使用下游验证信号进行精修。基于 WKG,我们采样中低频实体作为种子节点并扩展其多跳邻域以形成完整子图。使用针对高难度、多领域推理的提示,我们将每个子图转换为一个隐式编码多实体关系链的问题。

> 译者注(工程细节): GLM-5 的环境构建体系展示了规模化 agentic 训练的基础设施要求。1) 10k+ SWE 环境跨越 9 种语言,覆盖了真实软件工程的多样性 -- 这比 SWE-bench 的约 2000 个问题规模大了 5 倍;2) Harbor 框架作为容器化任务标准,使不同任务类型能够统一接入 RL 训练流程;3) 搜索任务的 WKG 构建是一个被低估的创新: 大多数搜索智能体评估使用静态数据集,而 GLM-5 构建了动态更新的知识图谱,使训练数据能够反映网络知识的演变;4) "精修智能体"(refine agent)的自我验证循环是确保合成数据质量的关键: 只有能够通过自动检查的任务才会进入最终数据集,这过滤掉了约 10% 的无效任务。

## 5 Adapting GLM-5 to Chinese Chip Infrastructure
### GLM-5 适配国产芯片基础设施

Adapting GLM-5 to diverse Chinese chip infrastructures presents significant challenges due to the heterogeneity of hardware ecosystems, which often complicates high-performance deployment. Despite these hurdles, we have successfully achieved full-stack adaptation for GLM-5 through close collaboration with seven mainstream Chinese chip platforms, including Huawei Ascend, Moore Threads, Hygon, Cambricon, Kunlunxin, MetaX, and Enflame. In this section, we use the Ascend Atlas series as a case study to demonstrate our adaptation methodology, focusing on three core pillars: extreme quantization, high-performance kernel fusion, and advanced inference engine scheduling.

将 GLM-5 适配到多样化的国产芯片基础设施面临重大挑战,因为硬件生态系统的异构性常常使高性能部署复杂化。尽管存在这些障碍,我们通过与七个主流国产芯片平台(包括华为昇腾、摩尔线程、海光、寒武纪、昆仑芯、沐曦和燧原)的紧密合作,成功实现了 GLM-5 的全栈适配。在本节中,我们以昇腾 Atlas 系列为案例研究来展示我们的适配方法,聚焦于三个核心支柱: 极致量化、高性能算子融合和先进推理引擎调度。

**Mixed-Precision W4A8 quantization.** To fit the 750B parameter GLM-5 model onto a single Atlas 800T A3 machine, we implemented a sophisticated W4A8 mixed-precision quantization strategy. Utilizing the msModelSlim tool, we applied specific precisions to different model components: standard Attention and MLP blocks use W8A8 (INT8), while the MoE experts are compressed to W4A8 (INT4) to drastically reduce memory footprint without significant accuracy loss. Advanced algorithms like QuaRot for outlier suppression and Flex_AWQ_SSZ for scaling calibration were employed to maintain stability in low-bit deployment.

**混合精度 W4A8 量化。** 为使 750B 参数的 GLM-5 模型适配到单台 Atlas 800T A3 机器,我们实现了复杂的 W4A8 混合精度量化策略。利用 msModelSlim 工具,我们对不同模型组件应用特定精度: 标准 Attention 和 MLP 块使用 W8A8 (INT8),而 MoE 专家被压缩到 W4A8 (INT4) 以在不显著损失精度的情况下大幅减少内存占用。采用 QuaRot 等高级算法进行异常值抑制,以及 Flex_AWQ_SSZ 进行尺度校准,以保持低位部署的稳定性。

**High-Performance fusion kernels.** To overcome the computational bottlenecks of sparse attention on Ascend NPUs, we developed a suite of customized fusion kernels: Lightning Indexer, Sparse Flash Attention, and MLAPO (Multi-head Latent Attention Pre-processing Optimization). Lightning Indexer integrates score calculation, ReLU, and TopK operations into a single kernel, allowing the NPU to overlap computation with memory access. For the Sparse Flash Attention kernel, we specifically optimized for GLM-5's sparse patterns. This kernel handles the selection of TopK tokens from the KV cache and sparse attention computation in parallel. Last, MLAPO fuses 13 small pre-processing operators into one "super operator", utilizing parallel processing between Vector and Cube units to boost end-to-end efficiency.

**高性能融合算子。** 为克服昇腾 NPU 上稀疏注意力的计算瓶颈,我们开发了一套定制融合算子: Lightning Indexer、Sparse Flash Attention 和 MLAPO(多头潜在注意力预处理优化)。Lightning Indexer 将分数计算、ReLU 和 TopK 操作集成到单个算子中,使 NPU 能够将计算与内存访问重叠。对于 Sparse Flash Attention 算子,我们专门针对 GLM-5 的稀疏模式进行了优化。该算子并行处理从 KV 缓存中选择 TopK token 和稀疏注意力计算。最后,MLAPO 将 13 个小预处理算子融合为一个"超级算子",利用 Vector 和 Cube 单元之间的并行处理来提升端到端效率。

**Specialized inference engine optimizations.** We adapted two leading inference engines, vLLM-Ascend and SGLang, to maximize hardware utilization:

**专用推理引擎优化。** 我们适配了两个领先推理引擎 vLLM-Ascend 和 SGLang,以最大化硬件利用率:

- **Asynchronous Scheduling:** Within vLLM, we implemented a mechanism to overlap the "Device-to-Host" (D2H) sampling copies with the preparation of the next decode step, effectively eliminating scheduling "bubbles."
- **Context Management:** Features like RadixCache (prefix sharing) and Prefix Cache (extending KV storage to system RAM) enable efficient reuse of KV entries, which is critical for long-context performance.
- **Parallel Strategy:** We utilized a hybrid approach combining Attention Data Parallelism (DP) and MoE Expert Parallelism (EP), alongside FlashComm, which splits AllReduce operations to hide communication latency behind computation.
- **Multi-Token Prediction (MTP):** By generating multiple tokens per inference step, we significantly increased NPU computation density and reduced total sequence generation time.

- **异步调度:** 在 vLLM 中,我们实现了将"设备到主机"(D2H)采样拷贝与下一步解码准备重叠的机制,有效消除了调度"气泡"。
- **上下文管理:** RadixCache(前缀共享)和 Prefix Cache(将 KV 存储扩展到系统内存)等功能实现了 KV 条目的高效重用,这对长上下文性能至关重要。
- **并行策略:** 我们采用混合方法结合注意力数据并行(DP)和 MoE 专家并行(EP),以及 FlashComm,后者拆分 AllReduce 操作以将通信延迟隐藏在计算之后。
- **多 token 预测(MTP):** 通过每推理步生成多个 token,我们显著提高了 NPU 计算密度并减少了总序列生成时间。

Through these hardware-level co-optimizations, GLM-5 on a single Chinese node achieves performance comparable to dual-GPU international clusters, while reducing deployment costs in long-sequence scenarios by 50%.

通过这些硬件级协同优化,单节点国产平台上的 GLM-5 实现了与双 GPU 国际集群相当的性能,同时在长序列场景中将部署成本降低了 50%。

> 译者注(工程细节): 国产芯片适配是 GLM-5 最具战略意义的工程贡献。1) W4A8 混合精度策略是一个精心设计的量化方案: Attention/MLP 使用 INT8 以保持精度,MoE 专家使用 INT4 以减少内存(专家数量多,内存占用大),这种差异化量化比统一量化更高效;2) Lightning Indexer、Sparse Flash Attention 和 MLAPO 三个定制算子分别解决了 DSA 架构在昇腾 NPU 上的三个瓶颈: 索引计算、稀疏注意力和预处理;3) "单节点国产平台 vs 双 GPU 国际集群"的对比具有象征意义: 它表明通过深度优化,国产芯片在性价比上可以匹敌甚至超越国际同类产品;4) 7 个国产平台的覆盖范围(昇腾、摩尔线程、海光、寒武纪、昆仑芯、沐曦、燧原)几乎涵盖了中国所有主流 AI 芯片,这种"全栈适配"为模型的国内部署消除了障碍。

## 6 Evaluation
### 评估

As illustrated above, GLM-5 marks the transition from vibe coding to a new era of agentic engineering. We first assess GLM-5 with frontier models on agentic, reasoning, and coding (ARC) benchmarks. To fully evaluate the performance of GLM-5 in real-world agentic engineering scenarios, we propose a new internal evaluation suite, CC-Bench-V2, which includes frontend, backend, and long-horizon tasks. Finally, we evaluate the general abilities of GLM-5 in five common real-world scenarios.

如上所述,GLM-5 标志着从 vibe coding 到 agentic engineering 新时代的过渡。我们首先在前沿模型上评估 GLM-5 的 agentic、推理和编码(ARC)基准。为全面评估 GLM-5 在真实世界 agentic 工程场景中的性能,我们提出了一个新的内部评估套件 CC-Bench-V2,包括前端、后端和长时程任务。最后,我们在五个常见真实世界场景中评估 GLM-5 的通用能力。

### 6.1 Evaluation of ARC Benchmarks
#### ARC 基准评估

We report the main results of the ARC benchmarks in Table 7 that compare GLM-5 with GLM-4.7, DeepSeek-V3.2, Kimi-K2.5, Claude Opus 4.5, Gemini 3 Pro, and GPT-5.2 (xhigh). In general, GLM-5 delivers a significant improvement over GLM-4.7 and achieves state-of-the-art performance among open-source models, narrowing the gap to proprietary models such as Claude Opus 4.5.

我们在表 7 中报告了 ARC 基准的主要结果,比较了 GLM-5 与 GLM-4.7、DeepSeek-V3.2、Kimi-K2.5、Claude Opus 4.5、Gemini 3 Pro 和 GPT-5.2 (xhigh)。总体而言,GLM-5 相比 GLM-4.7 有显著提升,并在开源模型中达到最先进性能,缩小了与 Claude Opus 4.5 等闭源模型的差距。

**Table 7: Main results on ARC benchmarks.**

**表 7: ARC 基准主要结果。**

| Category | Benchmark | GLM-5 | GLM-4.7 | DeepSeek-V3.2 | Kimi-K2.5 | Claude Opus 4.5 | Gemini 3 Pro | GPT-5.2 |
|----------|-----------|-------|---------|---------------|-----------|-----------------|--------------|---------|
| Reasoning | HLE (w/ Tools) | 50.4 | 35.4 | 40.8 | 43.4 | 45.8 | 45.5 | 30.5 |
| | HMMT Nov. 2025 | 75.9 | 51.4 | - | 67.8 | 59.2 | 65.8 | - |
| | IMO-AnswerBench | 99.4 | 97.1 | - | 86.3 | - | 92.4 | - |
| | GPQA-Diamond | 86.3 | - | - | - | - | - | - |
| | LongBench v2 | 92.4 | 80.0 | - | 72.0 | - | - | - |
| Coding | SWE-bench Verified | 77.8 | 73.8 | 73.1 | 76.8 | 80.9 | 76.2 | 80.0 |
| | SWE-bench Multilingual | 73.3 | 66.7 | 70.2 | 73.0 | 77.5 | 65.0 | 72.0 |
| | Terminal-Bench 2.0 | 56.2 | 41.0 | 39.3 | 50.8 | 59.3 | 54.2 | 54.0 |
| | CyberGym | 43.2 | 23.5 | 17.3 | 41.3 | 50.6 | 39.9 | - |
| Agentic | BrowseComp | 62.0 | 52.0 | 51.4 | 60.6 | 37.0 | 37.8 | - |
| | BrowseComp (w/ CM) | 75.9 | 67.5 | 67.6 | 74.9 | 57.8 | 59.2 | 65.8 |
| | tau^2-Bench | 89.7 | 87.4 | 85.3 | 80.2 | 91.6 | 90.7 | 85.5 |
| | MCP-Atlas | 67.8 | 52.0 | 62.2 | 63.8 | 65.2 | 66.6 | 68.0 |
| | Tool-Decathlon | 39.2 | 23.8 | 35.2 | 27.8 | 43.5 | 36.4 | 46.3 |
| | Vending Bench 2 | $4,432 | $2,377 | $1,034 | $1,198 | $4,967 | $5,478 | $3,591 |

*(Note: "-" indicates results not reported. CM = Context Management. Monetary values for Vending Bench 2 represent final account balance, higher is better.)*

*(注: "-" 表示未报告结果。CM = 上下文管理。Vending Bench 2 的货币值代表最终账户余额,越高越好。)*

> 译者注(结果分析): 表 7 的结果揭示了 GLM-5 的定位和优势领域。1) 在推理基准上,GLM-5 的 Humanity's Last Exam (50.4) 超越了所有对比模型(包括闭源),这是一个历史性突破;2) 编码能力方面,SWE-bench Verified (77.8) 接近 Claude Opus 4.5 (80.9) 和 GPT-5.2 (80.0),在开源模型中领先;3) Agentic 能力方面,tau^2-Bench (89.7) 接近 Claude (91.6) 和 Gemini (90.7),BrowseComp 在启用上下文管理后(75.9)大幅领先所有对比模型;4) Vending Bench 2 的 $4,432 余额在开源模型中排名第一,接近 Claude 的 $4,967,展示了强大的长期规划和资源管理能力;5) 值得注意的是 GLM-5 在 CyberGym (43.2) 和 Tool-Decathlon (39.2) 上仍有提升空间,这些是多工具协同的复杂任务,可能是下一代改进的方向。

### 6.2 Evaluation of Real-world Agentic Engineering Experience
#### 真实世界 Agentic 工程体验评估

To evaluate GLM-5 in real-world coding scenarios, we develop CC-Bench-V2, an internal evaluation suite comprising frontend, backend, and long-horizon tasks. All tasks are evaluated in an end-to-end manner with a standard agent framework.

为在真实世界编码场景中评估 GLM-5,我们开发了 CC-Bench-V2,一个包含前端、后端和长时程任务的内部评估套件。所有任务都使用标准智能体框架以端到端方式评估。

For frontend tasks, we evaluate the model's ability to build functional web applications from design images or natural language descriptions. The evaluation covers six sub-categories: Web Games, SVG/Canvas, Creative Tools, Showcase Pages, Forms & Tables, and Data Visualization. For backend tasks, we evaluate API development, database design, and service architecture implementation. For long-horizon tasks, we evaluate multi-step workflows that require sustained reasoning and tool use over extended interactions.

对于前端任务,我们评估模型从设计图像或自然语言描述构建功能 Web 应用的能力。评估涵盖六个子类别: Web 游戏、SVG/Canvas、创意工具、展示页面、表单与表格、数据可视化。对于后端任务,我们评估 API 开发、数据库设计和服务架构实现。对于长时程任务,我们评估需要在扩展交互中持续推理和工具使用的多步骤工作流。

### 6.3 Evaluation of Real-world General Abilities
#### 真实世界通用能力评估

Beyond agentic and coding capabilities, we evaluate GLM-5's general abilities across five real-world scenarios: instruction following, world knowledge, tool calling, multilingual dialogue, and translation. GLM-5 demonstrates strong performance across all these dimensions, with particularly notable improvements in tool calling accuracy and multilingual capabilities compared to GLM-4.7.

除 agentic 和编码能力外,我们在五个真实世界场景中评估 GLM-5 的通用能力: 指令遵循、世界知识、工具调用、多语言对话和翻译。GLM-5 在所有这些维度上都展示了强大性能,相比 GLM-4.7,在工具调用准确性和多语言能力方面有特别显著的改进。

## 7 Conclusion
### 结论

In this report, we have introduced GLM-5, a next-generation foundation model that fundamentally bridges the gap between high-performance reasoning and extreme computational efficiency. By transitioning from the paradigm of "vibe coding" to true "agentic engineering", GLM-5 demonstrates that open-weight models can now rival the capabilities of top-tier proprietary systems in complex, real-world workflows. GLM-5 represents a paradigm shift in practical AI utility. By open-sourcing the model, we aim to empower the community to move beyond static benchmarks and explore the frontiers of efficient, agentic general intelligence, fostering a new era where AI agents autonomously plan, implement, and iterate on complex tasks.

在本报告中,我们介绍了 GLM-5,一个从根本上弥合高性能推理与极致计算效率之间差距的下一代基础模型。通过从"vibe coding"范式转变为真正的"agentic engineering",GLM-5 证明了开放权重模型现在可以在复杂的真实世界工作流中媲美顶级闭源系统的能力。GLM-5 代表了实用 AI 效用的范式转变。通过开源该模型,我们旨在赋能社区超越静态基准,探索高效、agentic 通用智能的前沿,促进一个 AI 智能体自主规划、实现和迭代复杂任务的新时代。

## 8 Easter Eggs
### 彩蛋

The "Pony Alpha" experiment was indeed a pivotal moment for us. It was a bold decision to release GLM-5 anonymously on OpenRouter, but the results have been incredibly validating. By stripping away our brand name, we allowed the model's intrinsic capabilities to speak for themselves, ensuring the feedback we received was pure and unbiased.

"Pony Alpha"实验对我们来说确实是一个关键时刻。在 OpenRouter 上匿名发布 GLM-5 是一个大胆的决定,但结果令人难以置信地验证了我们的工作。通过剥离品牌名称,我们让模型的内在能力为自己说话,确保我们收到的反馈是纯粹且无偏见的。

Within days, Pony Alpha became a sensation. Developers in the OpenRouter community began to notice its exceptional performance, particularly in complex coding tasks, agentic workflows, and roleplay scenarios. Speculation was rampant, with many users guessing it was a leaked update from labs like Anthropic (Claude Sonnet 5), a secret Grok release, or DeepSeek V4. A preliminary statistic shows that 25% of the users guessed it was Claude Sonnet 5, 20% DeepSeek, 10% Grok, and the rest GLM-5.

几天之内,Pony Alpha 成为了轰动。OpenRouter 社区的开发人员开始注意到其卓越的性能,特别是在复杂编码任务、agentic 工作流和角色扮演场景中。猜测 rampant,许多用户猜测它是 Anthropic (Claude Sonnet 5) 等实验室的泄露更新、秘密 Grok 发布或 DeepSeek V4。初步统计显示,25% 的用户猜测它是 Claude Sonnet 5,20% DeepSeek,10% Grok,其余猜测 GLM-5。

The eventual confirmation that it was indeed our GLM-5 was a profound moment for us, effectively silencing doubts about whether Chinese LLMs could compete at the frontier level. The success of Pony Alpha (GLM-5) is not just about raw benchmarks; it signifies a shift in our focus towards engineering-level reliability. This anonymous release allowed us to transcend geopolitical biases. The community embraced the model because it worked.

最终确认它确实是我们的 GLM-5,对我们来说是一个深刻时刻,有效消除了对中国 LLM 是否能在前沿水平竞争的怀疑。Pony Alpha (GLM-5) 的成功不仅仅是原始基准;它标志着我们向工程级可靠性转变的重点。这次匿名发布使我们超越了地缘政治偏见。社区接受了该模型,因为它确实有效。

> 译者注(背景补充): Pony Alpha 是 2026 年初 AI 社区最著名的"盲测"事件之一。1) OpenRouter 是一个 AI 模型路由平台,用户可以在不知道模型身份的情况下使用不同模型;2) GLM-5 以"Pony Alpha"代号匿名上线后,社区用户对其编码和 agentic 能力给予了极高评价,许多人误以为它是 Claude 或 Grok 的下一代版本;3) 只有 45% 的用户猜测正确(其余 55% 认为是其他模型),这说明 GLM-5 的质量已经达到了让用户"分不清来源"的水平;4) 这一实验的战略意义在于: 在中美 AI 竞争的地缘政治背景下,中国模型往往面临额外的审视偏见,匿名发布证明了当偏见被移除时,中国模型完全可以站在世界最前沿。

## 9 Contribution
### 贡献者

Contributors' names are listed in alphabetical order by first name.

贡献者姓名按名字首字母顺序排列。

**Core Contributors:** Chendi Ge, Chenghua Huang, Chengxing Xie, Chenzheng Zhu, Congfeng Yin, Cunxiang Wang, Gengzheng Pan, Hao Zeng, Haoke Zhang, Haoran Wang, Huilong Chen, Jiajie Zhang, Jian Jiao, Jiaqi Guo, Jingsen Wang, Jingzhao Du, Jinzhu Wu, Kedong Wang, Lei Li, Lin Fan, Lucen Zhong, Mingdao Liu, Mingming Zhao, Pengfan Du, Qian Dong, Rui Lu, Shuang Li, Shulin Cao, Song Liu, Ting Jiang, Xiaodong Chen, Xiaohan Zhang, Xuancheng Huang, Xuezhen Dong, Yabo Xu, Yao Wei, Yifan An, Yilin Niu, Yitong Zhu, Yuanhao Wen, Yukuo Cen, Yushi Bai, Zhongpei Qiao, Zihan Wang, Zikang Wang, Zilin Zhu, Ziqiang Liu, Zixuan Li

**核心贡献者:** 葛晨迪、黄成华、谢承星、朱晨征、殷丛峰、王存翔、潘庚正、曾浩、张浩科、王浩然、陈惠龙、张家杰、焦健、郭嘉琪、王景森、杜竞超、武金柱、王克东、李磊、范琳、钟路岑、刘明道、赵明明、杜鹏帆、董倩、卢睿、李爽、曹书林、刘松、江庭、陈晓东、张骁涵、黄炫丞、董学振、徐亚博、魏瑶、安一凡、牛一霖、朱奕潼、温元浩、岑玉阔、白雨石、乔忠沛、王子涵、王子康、朱子麟、刘自强、李子轩

*(Note: Full contributor list including Tech Leads and Advisors is available in the original paper.)*

*(注: 完整贡献者名单包括技术负责人和顾问,可在原始论文中查看。)*

---

## References
### 参考文献

*(Note: The original paper contains 50+ references. Key citations are summarized below.)*

*(注: 原始论文包含 50+ 条参考文献。关键引用总结如下。)*

- [1] Anthropic. System card: Claude opus 4.5, 2025.
- [2] Ashkboos et al. Quarot: Outlier-free 4-bit inference in rotated llms, 2024.
- [6] Bandi et al. MCP-atlas: A large-scale benchmark for tool-use competency with real mcp servers, 2026.
- [9] DeepSeek-AI. Deepseek-v3.2: Pushing the frontier of open large language models, 2025.
- [13] Gloeckle et al. Better & faster large language models via multi-token prediction, 2024.
- [19] Jimenez et al. Swe-bench: Can language models resolve real-world github issues?, 2023.
- [24] Liu et al. Deepseek-v2: A strong, economical, and efficient mixture-of-experts language model, 2024.
- [26] Liu et al. Deepseek-v3.2: Pushing the frontier of open large language models, 2025.
- [32] OpenAI. Introducing gpt 5.2, 2025.
- [34] Phan et al. Humanity's last exam, 2025.
- [40] Shao et al. Deepseekmath: Pushing the limits of mathematical reasoning in open language models, 2024.
- [43] Kimi Team. Kimi k2.5: Visual agentic intelligence, 2026.
- [44] Li Team. Every step evolves: Scaling reinforcement learning for trillion-scale thinking model, 2025.

> 译者注(总结性评价): GLM-5 是 2026 年初开源 LLM 领域的里程碑式成果。1) 它是首个在 Artificial Analysis Intelligence Index v4.0 上得分 50 的开放权重模型,在 Humanity's Last Exam (50.4) 和 SWE-bench Verified (77.8) 等关键基准上达到或接近闭源前沿水平;2) 技术上,DSA 架构、异步 RL 基础设施(slime)、Agentic RL 算法和国产芯片全栈适配四大创新相辅相成,构成了一个完整的"高效 agentic 智能"技术体系;3) 工程上,从 27T token 预训练到 200K 上下文扩展,从三阶段中期训练到四阶段 RL 后训练(推理 RL -> Agentic RL -> 通用 RL -> 跨阶段蒸馏),整个训练流程展现了极高的工程成熟度;4) Pony Alpha 匿名发布实验具有超越技术层面的意义,它证明了当去除品牌偏见后,中国 LLM 完全可以与世界最顶尖模型竞争;5) 局限性包括: 在 Tool-Decathlon 等多工具协同任务上仍有提升空间,部分极端长上下文场景(200K+)的性能可能不如 128K 稳定,以及 744B 总参数量对推理硬件的要求仍然较高(尽管 DSA 和量化已大幅降低了这一门槛)。

