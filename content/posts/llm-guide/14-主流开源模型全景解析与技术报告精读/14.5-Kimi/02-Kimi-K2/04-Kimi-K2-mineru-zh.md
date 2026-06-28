---
title: "04 · Kimi K2 Technical Report - Segment-by-Segment Translation with Translator's Notes"
---

## 1 Introduction

>  **[返回 14.5-Kimi 家族总览](../../14.5-Kimi.md)**

### 引言

The development of Large Language Models (LLMs) is undergoing a profound paradigm shift towards Agentic Intelligence - the capabilities for models to autonomously perceive, plan, reason, and act within complex and dynamic environments. This transition marks a departure from static imitation learning towards models that actively learn through interactions, acquire new skills beyond their training distribution, and adapt behavior through experiences [64]. It is believed that this approach allows an AI agent to go beyond the limitation of static human-generated data, and acquire superhuman capabilities through its own exploration and exploitation. Agentic intelligence is thus rapidly emerging as a defining capability for the next generation of foundation models, with wide-ranging implications across tool use, software development, and real-world autonomy.

大型语言模型(LLMs)的发展正在经历一场深刻的范式转变，朝向 Agentic Intelligence(智能体智能)演进——即模型在复杂动态环境中自主感知、规划、推理和行动的能力。这一转变标志着从静态模仿学习向通过交互主动学习、获取训练分布之外的新技能、并通过经验调整行为的模型的过渡 [64]。人们相信，这种方法使 AI 智能体能够超越静态人类生成数据的限制，通过自身的探索与利用获得超人类能力。因此，智能体智能正迅速成为下一代基础模型的标志性能力，在工具使用、软件开发和现实世界自主性等领域具有广泛影响。

Achieving agentic intelligence introduces challenges in both pre-training and post-training. Pre-training must endow models with broad general-purpose priors under constraints of limited high-quality data, elevating token efficiency - learning signal per token - as a critical scaling coefficient. Post-training must transform those priors into actionable behaviors, yet agentic capabilities such as multi-step reasoning, long-term planning, and tool use are rare in natural data and costly to scale. Scalable synthesis of structured, high-quality agentic trajectories, combined with general reinforcement learning (RL) techniques that incorporate preferences and self-critique, are essential to bridge this gap.

实现智能体智能在预训练和后训练两个阶段都带来了挑战。预训练必须在高质量数据有限的约束下，赋予模型广泛的通用先验知识，这使得 token 效率——每个 token 的学习信号——成为一个关键的缩放系数。后训练必须将这些先验转化为可执行的行为，然而多步推理、长期规划和工具使用等智能体能力在自然数据中十分罕见，且扩展成本高昂。结构化、高质量智能体轨迹的可扩展合成，结合融入偏好和自我批评的通用强化学习(RL)技术，是弥合这一鸿沟的关键。

In this work, we introduce Kimi K2, a 1.04 trillion-parameter Mixture-of-Experts (MoE) LLM with 32 billion activated parameters, purposefully designed to address the core challenges and push the boundaries of agentic capability. Our contributions span both the pre-training and post-training frontiers:

在本工作中，我们介绍了 Kimi K2，一个拥有 1.04 万亿参数、320 亿激活参数的混合专家(MoE)大型语言模型，专为应对核心挑战并推动智能体能力的边界而设计。我们的贡献横跨预训练和后训练两个前沿：

- We present MuonClip, a novel optimizer that integrates the token-efficient Muon algorithm with a stability-enhancing mechanism called QK-Clip. Using MuonClip, we successfully pre-trained Kimi K2 on 15.5 trillion tokens without a single loss spike.

- 我们提出了 MuonClip，一种新型优化器，它将 token 高效的 Muon 算法与一种称为 QK-Clip 的稳定性增强机制相结合。使用 MuonClip，我们成功地在 15.5 万亿 token 上预训练了 Kimi K2，且未出现任何 loss spike(损失尖峰)。

- We introduce a large-scale agentic data synthesis pipeline that systematically generates tool-use demonstrations via simulated and real-world environments. This system constructs diverse tools, agents, tasks, and trajectories to create high-fidelity, verifiably correct agentic interactions at scale.

- 我们引入了一个大规模智能体数据合成流水线，通过模拟和真实世界环境系统地生成工具使用演示。该系统构建多样化的工具、智能体、任务和轨迹，以大规模创建高保真、可验证正确的智能体交互。

- We design a general reinforcement learning framework that combines verifiable rewards (RLVR) with a self-critique rubric reward mechanism. The model learns not only from externally defined tasks but also from evaluating its own outputs, extending alignment from static into open-ended domains.

- 我们设计了一个通用强化学习框架，结合了可验证奖励(RLVR, Reinforcement Learning with Verifiable Rewards)和自我批评评分表奖励机制。模型不仅从外部定义的任务中学习，还从评估自身输出中学习，将对齐从静态领域扩展到开放式领域。

Kimi K2 demonstrates strong performance across a broad spectrum of agentic and frontier benchmarks. It achieves scores of 66.1 on Tau2-bench, 76.5 on ACEBench (en), 65.8 on SWE-bench Verified, and 47.3 on SWE-bench Multilingual, outperforming most open- and closed-weight baselines under non-thinking evaluation settings, closing the gap with Claude 4 Opus and Sonnet. In coding, mathematics, and broader STEM domains, Kimi K2 achieves 53.7 on LiveCodeBench v6, 27.1 on OJBench, 49.5 on AIME 2025, and 75.1 on GPQA-Diamond, further highlighting its capabilities in general tasks. On the LMSYS Arena leaderboard (July 17, 2025), Kimi K2 ranks as the top 1 open-source model and 5th overall based on over 3,000 user votes.

Kimi K2 在广泛的智能体和前沿基准测试中表现出强劲性能。它在 Tau2-bench 上取得 66.1 分，ACEBench (en) 上 76.5 分，SWE-bench Verified 上 65.8 分，SWE-bench Multilingual 上 47.3 分，在非思考评估设置下超越了大多数开放权重和闭权基线，缩小了与 Claude 4 Opus 和 Sonnet 的差距。在编程、数学和更广泛的 STEM 领域，Kimi K2 在 LiveCodeBench v6 上取得 53.7 分，OJBench 上 27.1 分，AIME 2025 上 49.5 分，GPQA-Diamond 上 75.1 分，进一步凸显了其在通用任务上的能力。在 LMSYS Arena 排行榜上(2025 年 7 月 17 日)，Kimi K2 基于超过 3000 张用户投票，排名开源模型第一、总排名第五。

To spur further progress in Agentic Intelligence, we are open-sourcing our base and post-trained checkpoints, enabling the community to explore, refine, and deploy agentic intelligence at scale.

为推动智能体智能的进一步发展，我们开源了基座和后训练检查点，使社区能够大规模探索、优化和部署智能体智能。

> 译者注(设计动机与技术谱系): Kimi K2 的核心定位非常明确——它不是又一个追求通用能力的基座模型，而是专门面向"智能体智能"(Agentic Intelligence)的定向优化模型。这一设计动机体现在三个层面：1) 预训练层面，通过 MuonClip 优化器解决 MoE 大模型训练中的 loss spike 问题，实现了 15.5T token 零尖峰训练，这是此前很少有模型能做到的; 2) 数据层面，构建了大规模智能体数据合成流水线，解决了智能体能力数据稀缺的核心瓶颈; 3) 后训练层面，设计了结合可验证奖励(RLVR)和自我批评的通用 RL 框架。从技术谱系看，MuonClip 是对 Muon 优化器的改进(Muon 本身是对 AdamW 的替代)，QK-Clip 则与 Qwen3 等模型中使用的梯度裁剪技术有相似之处，但针对 MoE 的稀疏激活特性做了专门设计。


## 2 Pre-training
### 预训练

The base model of Kimi K2 is a trillion-parameter mixture-of-experts (MoE) transformer [73] model, pre-trained on 15.5 trillion high-quality tokens. Given the increasingly limited availability of high-quality human data, we posit that token efficiency is emerging as a critical coefficient in the scaling of large language models. To address this, we introduce a suite of pre-training techniques explicitly designed for maximizing token efficiency. Specifically, we employ the token-efficient Muon optimizer [34, 47] and mitigate its training instabilities through the introduction of QK-Clip. Additionally, we incorporate synthetic data generation to further squeeze the intelligence out of available high-quality tokens. The model architecture follows an ultra-sparse MoE with multi-head latent attention (MLA) similar to DeepSeek-V3 [11], derived from empirical scaling law analysis. The underlying infrastructure is built to optimize both training efficiency and research efficiency.

Kimi K2 的基座模型是一个万亿参数的混合专家(MoE) transformer [73] 模型，在 15.5 万亿高质量 token 上进行了预训练。鉴于高质量人类数据日益有限，我们认为 token 效率正在成为大型语言模型缩放中的一个关键系数。为解决这一问题，我们引入了一套专门用于最大化 token 效率的预训练技术。具体而言，我们采用了 token 高效的 Muon 优化器 [34, 47]，并通过引入 QK-Clip 来缓解其训练不稳定性。此外，我们引入了合成数据生成，以进一步从可用的高质量 token 中榨取智能。模型架构遵循与 DeepSeek-V3 [11] 类似的超稀疏 MoE 与多头潜在注意力(MLA, Multi-Head Latent Attention)，这来源于经验缩放定律分析。底层基础设施旨在同时优化训练效率和研究效率。

### 2.1 MuonClip: Stable Training with Weight Clipping
#### MuonClip: 带权重裁剪的稳定训练

We train Kimi K2 using the token-efficient Muon optimizer [34], incorporating weight decay and consistent update RMS scaling [47]. Experiments in our previous work Moonlight [47] show that, under the same compute budget and model size — and therefore the same amount of training data — Muon substantially outperforms AdamW [37, 49], making it an effective choice for improving token efficiency in large language model training.

我们使用 token 高效的 Muon 优化器 [34] 训练 Kimi K2，结合了权重衰减和一致的更新 RMS 缩放 [47]。我们在先前工作 Moonlight [47] 中的实验表明，在相同的计算预算和模型规模下——因此也是相同数量的训练数据——Muon 显著优于 AdamW [37, 49]，这使其成为提高大型语言模型训练 token 效率的有效选择。

**Training instability when scaling Muon**

**扩展 Muon 时的训练不稳定性**

Despite its efficiency, scaling up Muon training reveals a challenge: training instability due to exploding attention logits, an issue that occurs more frequently with Muon but less with AdamW in our experiments. Existing mitigation strategies are insufficient. For instance, logit soft-cap [70] directly clips the attention logits, but the dot products between queries and keys can still grow excessively before capping is applied. On the other hand, Query-Key Normalization (QK-Norm) [12, 82] is not applicable to multi-head latent attention (MLA), because its Key matrices are not fully materialized during inference.

尽管 Muon 效率很高，但扩大 Muon 训练规模揭示了一个挑战：由于注意力 logits 爆炸导致的训练不稳定性，这个问题在我们的实验中 Muon 比 AdamW 更频繁地发生。现有的缓解策略不足。例如，logit soft-cap [70] 直接裁剪注意力 logits，但 query 和 key 之间的点积在裁剪应用之前仍可能过度增长。另一方面，Query-Key Normalization (QK-Norm) [12, 82] 不适用于多头潜在注意力(MLA)，因为其 Key 矩阵在推理期间并未完全物化。

**Taming Muon with QK-Clip**

**用 QK-Clip 驯服 Muon**

To address this issue, we propose a novel weight-clipping mechanism QK-Clip to explicitly constrain attention logits. QK-Clip works by rescaling the query and key projection weights post-update to bound the growth of attention logits.

为解决这一问题，我们提出了一种新颖的权重裁剪机制 QK-Clip，以显式约束注意力 logits。QK-Clip 通过在更新后重新缩放 query 和 key 投影权重来限制注意力 logits 的增长。

Let the input representation of a transformer layer be X. For each attention head h, its query, key, and value projections are computed as

设 transformer 层的输入表示为 X。对于每个注意力头 h，其 query、key 和 value 投影计算如下：

$$
Q_h = X W_h^q, \quad K_h = X W_h^k, \quad V_h = X W_h^v,
$$

where W_q, W_k, W_v are model parameters. The attention output is:

其中 W_q, W_k, W_v 是模型参数。注意力输出为：

$$
O_h = \text{softmax}\left(\frac{1}{\sqrt{d}} Q_h K_h^\top\right) V_h.
$$

We define the max logit, a per-head scalar, as the maximum input to softmax in this batch B:

我们定义 max logit(每头标量)为该批次 B 中 softmax 的最大输入：

$$
S_{\max}^h = \frac{1}{\sqrt{d}} \max_{X \in B} \max_{i,j} Q_{h,i} K_{h,j}^\top,
$$

where i, j are indices of different tokens in a training sample X.

其中 i, j 是训练样本 X 中不同 token 的索引。

The core idea of QK-Clip is to rescale W_k, W_q whenever S_max^h exceeds a target threshold tau. Importantly, this operation does not alter the forward/backward computation in the current step — we merely use the max logit as a guiding signal to determine the strength to control the weight growth.

QK-Clip 的核心思想是：每当 S_max^h 超过目标阈值 tau 时，重新缩放 W_k 和 W_q。重要的是，此操作不会改变当前步骤的前向/反向计算——我们仅使用 max logit 作为指导信号来确定控制权重增长的强度。

A naive implementation clips all heads at the same time:

一种简单的实现同时裁剪所有头：

$$
W_h^q \leftarrow \gamma^\alpha W_h^q, \quad W_h^k \leftarrow \gamma^{1-\alpha} W_h^k,
$$

where gamma = min(1, tau/S_max) with S_max = max_h S_max^h, and alpha is a balancing parameter typically set to 0.5, applying equal scaling to queries and keys.

其中 gamma = min(1, tau/S_max)，S_max = max_h S_max^h，alpha 是平衡参数，通常设为 0.5，对 query 和 key 应用相等的缩放。

However, we observe that in practice, only a small subset of heads exhibit exploding logits. In order to minimize our intervention on model training, we determine a per-head scaling factor gamma_h = min(1, tau/S_max^h), and opt to apply per-head QK-Clip. Such clipping is straightforward for regular multi-head attention (MHA). For MLA, we apply clipping only on unshared attention head components:

然而，我们观察到在实践中，只有一小部分头表现出 logits 爆炸。为了最小化对模型训练的干预，我们确定每头缩放因子 gamma_h = min(1, tau/S_max^h)，并选择应用每头 QK-Clip。这种裁剪对于常规多头注意力(MHA)很直接。对于 MLA，我们仅在非共享注意力头组件上应用裁剪：

- q_C and k_C (head-specific components): each scaled by sqrt(gamma_h)
- q_R (head-specific rotary): scaled by gamma_h,
- k_R (shared rotary): left untouched to avoid effect across heads.

- q_C 和 k_C(头特定组件)：各缩放 sqrt(gamma_h)
- q_R(头特定旋转)：缩放 gamma_h
- k_R(共享旋转)：保持不变以避免跨头影响

**MuonClip: The New Optimizer**

**MuonClip: 新优化器**

We integrate Muon with weight decay, consistent RMS matching, and QK-Clip into a single optimizer, which we refer to as MuonClip (see Algorithm 1).

我们将 Muon 与权重衰减、一致 RMS 匹配和 QK-Clip 整合为单一优化器，称之为 MuonClip(见算法 1)。

> 译者注(架构细节): QK-Clip 的设计体现了对 MoE + MLA 架构的深入理解。QK-Norm [12, 82] 不能用于 MLA，因为 MLA 的 Key 矩阵在推理时并未完全物化——这是 MLA 压缩 KV Cache 的核心机制，也是它无法直接应用 QK-Norm 的根本原因。QK-Clip 的巧妙之处在于：它不修改前向/反向计算，仅在优化器步骤后通过 rescaling 权重来间接约束 logits。这种"事后约束"策略避免了在注意力计算路径中引入额外的归一化操作，对 MLA 特别友好。此外，per-head 的细粒度裁剪(而非全局裁剪)体现了最小干预原则——只修复出问题的头，不干扰正常训练的头。alpha=0.5 的对称缩放也是经过深思熟虑的，因为 query 和 key 在注意力计算中是对称的，不对称缩放可能破坏它们的平衡关系。

We demonstrate the effectiveness of MuonClip from several scaling experiments. First, we train a mid-scale 9B activated and 53B total parameters Mixture-of-Experts (MoE) model using the vanilla Muon. As shown in Figure 2 (Left), we observe that the maximum attention logits quickly exceed a magnitude of 1000, showing that attention logits explosion is already evident in Muon training to this scale. Max logits at this level usually result in instability during training, including significant loss spikes and occasional divergence.

我们通过几项缩放实验展示了 MuonClip 的有效性。首先，我们使用原始 Muon 训练了一个中等规模的 9B 激活、53B 总参数的 MoE 模型。如图 2(左)所示，我们观察到最大注意力 logits 迅速超过 1000 的量级，表明注意力 logits 爆炸在 Muon 训练到这一规模时已经很明显。此量级的最大 logits 通常会导致训练中的不稳定性，包括显著的 loss spike 和偶尔的发散。

**Algorithm 1 MuonClip Optimizer**

**算法 1 MuonClip 优化器**

```
1: for each training step t do
2:   // 1. Muon optimizer step
3:   for each weight W in R^{n x m} do
4:     M_t = mu * M_{t-1} + G_t           // M_0 = 0, G_t is grad of W_t, mu is momentum
5:     O_t = Newton-Schulz(M_t) * sqrt(max(n,m)) * 0.2   // Match Adam RMS
6:     W_t = W_{t-1} - eta * (O_t + lambda * W_{t-1})     // learning rate eta, weight decay lambda
7:   end for
8:   // 2. QK-Clip
9:   for each attention head h in every attention layer of the model do
10:    Obtain S_max^h already computed during forward
11:    if S_max^h > tau then
12:      gamma <- tau / S_max^h
13:      W_{h,qc} <- W_{h,qc} * sqrt(gamma)
14:      W_{h,kc} <- W_{h,kc} * sqrt(gamma)
15:      W_{h,qr} <- W_{h,qr} * gamma
16:    end if
17:  end for
18: end for
```

> 图 2 描述：左图：在中等规模训练运行中，注意力 logits 迅速超过 1000，可能导致数值不稳定性甚至训练发散。右图：Kimi K2 使用 MuonClip 且 tau = 100 时的最大 logits。最大 logits 迅速增加到上限值 100，仅在约 30% 的训练步骤后衰减到稳定范围，展示了 QK-Clip 的有效调节作用。

Next, we demonstrate that QK-Clip does not degrade model performance and confirm that the MuonClip optimizer preserves the optimization characteristics of Muon without adversely affecting the loss trajectory. A detailed discussion of the experiment designs and findings is provided in the Appendix D.

接下来，我们证明 QK-Clip 不会降低模型性能，并确认 MuonClip 优化器保留了 Muon 的优化特性，而不会不利影响 loss 轨迹。实验设计和发现的详细讨论见附录 D。

Finally, we train Kimi K2, a large-scale MoE model, using MuonClip with tau = 100 and monitor the maximum attention logits throughout the training run (Figure 2 (Right)). Initially, the logits are capped at 100 due to QK-Clip. Over the course of training, the maximum logits gradually decay to a typical operating range without requiring any adjustment to tau. Importantly, the training loss remains smooth and stable, with no observable spikes, as shown in Figure 3, validating that MuonClip provides robust and scalable control over attention dynamics in large-scale language model training.

最后，我们使用 MuonClip(tau = 100)训练了 Kimi K2——一个大规模 MoE 模型，并在整个训练过程中监控最大注意力 logits(图 2(右))。最初，由于 QK-Clip，logits 被限制在 100。在训练过程中，最大 logits 逐渐衰减到典型工作范围，无需对 tau 进行任何调整。重要的是，训练 loss 保持平滑稳定，没有可观察到的尖峰，如图 3 所示，验证了 MuonClip 在大规模语言模型训练中提供了稳健且可扩展的注意力动态控制。

> 图 3 描述：Kimi K2 的每步训练 loss 曲线，未经过平滑或子采样。显示整个训练过程中没有尖峰。为清晰起见，省略了训练的最初阶段。

### 2.2 Pre-training Data: Improving Token Utility with Rephrasing
#### 预训练数据：通过改写提升 Token 效用

Token efficiency in pre-training refers to how much performance improvement is achieved for each token consumed during training. Increasing token utility — the effective learning signal each token contributes — enhances the per-token impact on model updates, thereby directly improving token efficiency. This is particularly important when the supply of high-quality tokens is limited and must be maximally leveraged. A naive approach to increasing token utility is through repeated exposure to the same tokens, which can lead to overfitting and reduced generalization.

预训练中的 token 效率指的是训练期间每消耗一个 token 所获得的性能提升。增加 token 效用——每个 token 贡献的有效学习信号——增强了对模型更新的每 token 影响，从而直接提高 token 效率。当高质量 token 的供应有限且必须最大限度利用时，这一点尤为重要。增加 token 效用的一种简单方法是重复暴露于相同的 token，但这可能导致过拟合和泛化能力下降。

A key advancement in the pre-training data of Kimi K2 over Kimi K1.5 is the introduction of a synthetic data generation strategy to increase token utility. Specifically, a carefully designed rephrasing pipeline is employed to amplify the volume of high-quality tokens without inducing significant overfitting. In this report, we describe two domain-specialized rephrasing techniques — targeted respectively at the Knowledge and Mathematics domains — that enable this controlled data augmentation.

Kimi K2 相对于 Kimi K1.5 在预训练数据方面的一个关键进步是引入了合成数据生成策略以增加 token 效用。具体而言，我们采用了一个精心设计的改写流水线来扩增高质量 token 的体积，而不引起显著的过拟合。在本报告中，我们描述了两种领域专业化的改写技术——分别针对知识和数学领域——它们实现了这种受控的数据增强。

**Knowledge Data Rephrasing**

**知识数据改写**

Pre-training on natural, knowledge-intensive text presents a trade-off: a single epoch

在自然的、知识密集型文本上进行预训练存在一个权衡：单轮 epoch

Pre-training on natural, knowledge-intensive text presents a trade-off: a single epoch is insufficient for comprehensive knowledge absorption, while multi-epoch repetition yields diminishing returns and increases the risk of overfitting. To improve the token utility of high-quality knowledge tokens, we propose a synthetic rephrasing framework composed of the following key components:

在自然的、知识密集型文本上进行预训练存在一个权衡：单轮 epoch 不足以全面吸收知识，而多轮重复则收益递减并增加过拟合风险。为提高高质量知识 token 的 token 效用，我们提出了一个合成改写框架，包含以下关键组件：

- Style- and perspective-diverse prompting: Inspired by WRAP [50], we apply a range of carefully engineered prompts to enhance linguistic diversity while maintaining factual integrity. These prompts guide a large language model to generate faithful rephrasings of the original texts in varied styles and from different perspectives.

- 风格与视角多样化提示：受 WRAP [50] 启发，我们应用一系列精心设计的提示来增强语言多样性，同时保持事实完整性。这些提示引导大型语言模型以不同风格和从不同视角生成对原文的忠实改写。

- Chunk-wise autoregressive generation: To preserve global coherence and avoid information loss in long documents, we adopt a chunk-based autoregressive rewriting strategy. Texts are divided into segments, rephrased individually, and then stitched back together to form complete passages. This method mitigates implicit output length limitations that typically exist with LLMs. An overview of this pipeline is presented in Figure 4.

- 分块自回归生成：为保持全局连贯性并避免长文档中的信息丢失，我们采用基于分块的自回归改写策略。文本被分割为段落，分别改写，然后拼接回完整段落。这种方法缓解了 LLM 通常存在的隐式输出长度限制。该流水线的概览见图 4。

- Fidelity verification: To ensure consistency between original and rewritten content, we perform fidelity checks that compare the semantic alignment of each rephrased passage with its source. This serves as an initial quality control step prior to training.

- 保真度验证：为确保原始内容与改写内容的一致性，我们进行保真度检查，比较每个改写段落与其来源的语义对齐度。这作为训练前的初始质量控制步骤。

We compare data rephrasing with multi-epoch repetition by testing their corresponding accuracy on SimpleQA. We experiment with an early checkpoint of K2 and evaluate three training strategies: (1) repeating the original dataset for 10 epochs, (2) rephrasing the data once and repeating it for 10 epochs, and (3) rephrasing the data 10 times with a single training pass. As shown in Table 1, the accuracy consistently improves across these strategies, demonstrating the efficacy of our rephrasing-based augmentation. We extended this method to other large-scale knowledge corpora and observed similarly encouraging results, and each corpora is rephrased at most twice.

我们通过在 SimpleQA 上测试其相应准确率来比较数据改写与多轮重复。我们使用 K2 的早期检查点进行实验，评估三种训练策略：(1) 原始数据集重复 10 轮，(2) 改写一次后重复 10 轮，(3) 改写 10 次后单轮训练。如表 1 所示，准确率在这些策略中持续提升，证明了基于改写的增强的有效性。我们将此方法扩展到其他大规模知识语料库，观察到同样令人鼓舞的结果，每个语料库最多改写两次。

**Table 1: SimpleQA Accuracy under three rephrasing-epoch configurations**

**表 1：三种改写-轮次配置下的 SimpleQA 准确率**

| # Rephrasings | # Epochs | SimpleQA Accuracy |
|--------------|---------|-------------------|
| 0 (raw wiki-text) | 10 | 23.76 |
| 1 | 10 | 27.39 |
| 10 | 1 | 28.94 |

> 图 4 描述：长输入摘录的自回归分块改写流水线。输入被分割为保留上下文的小块，顺序改写，然后拼接为完整改写段落。

**Mathematics Data Rephrasing**

**数学数据改写**

To enhance mathematical reasoning capabilities, we rewrite high-quality mathematical documents into a "learning-note" style, following the methodology introduced in SwallowMath [16]. In addition, we increased data diversity by translating high-quality mathematical materials from other languages into English. Although initial experiments with rephrased subsets of our datasets show promising results, the use of synthetic data as a strategy for continued scaling remains an active area of investigation. Key challenges include generalizing the approach to diverse source domains without compromising factual accuracy, minimizing hallucinations and unintended toxicity, and ensuring scalability to large-scale datasets.

为增强数学推理能力，我们将高质量数学文档改写为"学习笔记"风格，遵循 SwallowMath [16] 中介绍的方法论。此外，我们通过将其他语言的高质量数学材料翻译为英语来增加数据多样性。尽管使用改写数据子集的初步实验显示出有希望的结果，但将合成数据作为持续扩展策略的使用仍是一个活跃的研究领域。关键挑战包括将方法推广到多样化的来源领域而不损害事实准确性、最小化幻觉和意外毒性，以及确保对大规模数据集的可扩展性。

**Pre-training Data Overall**

**预训练数据总体**

The Kimi K2 pre-training corpus comprises 15.5 trillion tokens of curated, high-quality data spanning four primary domains: Web Text, Code, Mathematics, and Knowledge. Most data processing pipelines follow the methodologies outlined in Kimi K1.5 [36]. For each domain, we performed rigorous correctness and quality validation and designed targeted data experiments to ensure the curated dataset achieved both high diversity and effectiveness.

Kimi K2 的预训练语料库包含 15.5 万亿经过筛选的高质量 token，涵盖四个主要领域：网页文本、代码、数学和知识。大多数数据处理流水线遵循 Kimi K1.5 [36] 中概述的方法论。对于每个领域，我们进行了严格正确性和质量验证，并设计了针对性的数据实验，以确保筛选后的数据集兼具高多样性和有效性。

### 2.3 Model Architecture
#### 模型架构

Kimi K2 is a 1.04 trillion-parameter Mixture-of-Experts (MoE) transformer model with 32 billion activated parameters. The architecture follows a similar design to DeepSeek-V3 [11], employing Multi-head Latent Attention (MLA) [45] as the attention mechanism, with a model hidden dimension of 7168 and an MoE expert hidden dimension of 2048. Our scaling law analysis reveals that continued increases in sparsity yield substantial performance improvements, which motivated us to increase the number of experts to 384, compared to 256 in DeepSeek-V3. To reduce computational overhead during inference, we cut the number of attention heads to 64, as opposed to 128 in DeepSeek-V3. Table 2 presents a detailed comparison of architectural parameters between Kimi K2 and DeepSeek-V3.

Kimi K2 是一个 1.04 万亿参数、320 亿激活参数的混合专家(MoE) transformer 模型。架构遵循与 DeepSeek-V3 [11] 相似的设计，采用多头潜在注意力(MLA) [45] 作为注意力机制，模型隐藏维度为 7168，MoE 专家隐藏维度为 2048。我们的缩放定律分析表明，稀疏度的持续增加带来显著的性能提升，这促使我们将专家数量增加到 384(DeepSeek-V3 为 256)。为降低推理期间的计算开销，我们将注意力头数量减少到 64(DeepSeek-V3 为 128)。表 2 展示了 Kimi K2 与 DeepSeek-V3 之间架构参数的详细对比。

**Table 2: Architectural comparison between Kimi K2 and DeepSeek-V3**

**表 2：Kimi K2 与 DeepSeek-V3 的架构对比**

| Parameter | DeepSeek-V3 | Kimi K2 | Change |
|-----------|-------------|---------|--------|
| # Layers | 61 | 61 | = |
| Total Parameters | 671B | 1.04T | up 54% |
| Activated Parameters | 37B | 32.6B | down 13% |
| Experts (total) | 256 | 384 | up 50% |
| Experts Active per Token | 8 | 8 | = |
| Shared Experts | 1 | 1 | = |
| Attention Heads | 128 | 64 | down 50% |
| Number of Dense Layers | 3 | 1 | down 67% |
| Expert Grouping | Yes | No | - |

**Sparsity Scaling Law**

**稀疏度缩放定律**

We develop a sparsity scaling law tailored for the Mixture-of-Experts (MoE) model family using Muon. Sparsity is defined as the ratio of the total number of experts to the number of activated experts. Through carefully controlled small-scale experiments, we observe that — under a fixed number of activated parameters (i.e., constant FLOPs) — increasing the total number of experts (i.e., increasing sparsity) consistently lowers both the training and validation loss, thereby enhancing overall model performance (Figure 5). Concretely, under the compute-optimal sparsity scaling law, achieving the same validation loss of 1.5, sparsity 48 reduces FLOPs by 1.69x, 1.39x, and 1.15x compared to sparsity levels 8, 16, and 32, respectively. Though increasing sparsity leads to better performance, this gain comes with increased infrastructure complexity. To balance model performance with cost, we adopt a sparsity of 48 for Kimi K2, activating 8 out of 384 experts per forward pass.

我们开发了一个专门为使用 Muon 的混合专家(MoE)模型家族定制的稀疏度缩放定律。稀疏度定义为专家总数与激活专家数的比值。通过精心设计的小规模实验，我们观察到——在固定激活参数数量(即恒定 FLOPs)下——增加专家总数(即增加稀疏度)持续降低训练和验证 loss，从而提升整体模型性能(图 5)。具体而言，在计算最优稀疏度缩放定律下，达到相同的验证 loss 1.5，稀疏度 48 相比稀疏度 8、16、32 分别减少 FLOPs 1.69 倍、1.39 倍和 1.15 倍。尽管增加稀疏度带来更好的性能，但这种收益伴随着基础设施复杂度的增加。为平衡模型性能与成本，我们为 Kimi K2 采用稀疏度 48，每次前向传播激活 384 个专家中的 8 个。

> 图 5 描述：稀疏度缩放定律。增加稀疏度提升模型性能。我们固定激活专家数为 8、共享专家数为 1，改变专家总数，得到不同稀疏度水平的模型。

> 图 6 描述：注意力头数量等于层数的模型与其注意力头翻倍对应模型的缩放曲线。翻倍注意力头数量使验证 loss 降低约 0.5% 到 1.2%。

**Number of Attention Heads**

**注意力头数量**

DeepSeek-V3 [11] sets the number of attention heads to roughly twice the number of model layers to better utilize memory bandwidth and enhance computational efficiency. However, as the context length increases, doubling the number of attention heads leads to significant inference overhead, reducing efficiency at longer sequence lengths. This becomes a major limitation in agentic applications, where efficient long context processing is essential. For example, with a sequence length of 128k, increasing the number of attention heads from 64 to 128, while keeping the total expert count fixed at 384, leads to an 83% increase in inference FLOPs. To evaluate the impact of this design, we conduct controlled experiments comparing configurations where the number of attention heads equals the number of layers against those with double number of heads, under varying training FLOPs. Under iso-token training conditions, we observe that doubling the attention heads yields only modest improvements in validation loss (ranging from 0.5% to 1.2%) across different compute budgets (Figure 6). Given that sparsity 48 already offers strong performance, the marginal gains from doubling attention heads do not justify the inference cost. Therefore we choose to 64 attention heads.

DeepSeek-V3 [11] 将注意力头数量设为约层数的两倍，以更好地利用内存带宽并提高计算效率。然而，随着上下文长度增加，翻倍注意力头数量导致显著的推理开销，降低了较长序列长度下的效率。这在智能体应用中成为一个主要限制，因为高效的长上下文处理至关重要。例如，在序列长度为 128k 时，将注意力头数量从 64 增加到 128(同时保持专家总数固定为 384)，导致推理 FLOPs 增加 83%。为评估这种设计的影响，我们在不同训练 FLOPs 下进行了对照实验，比较注意力头数量等于层数的配置与头数翻倍的配置。在等 token 训练条件下，我们观察到翻倍注意力头仅带来验证 loss 的适度改善(在不同计算预算下为 0.5% 到 1.2%，图 6)。鉴于稀疏度 48 已提供强劲性能，翻倍注意力头的边际收益无法证明推理成本的合理性。因此，我们选择 64 个注意力头。

> 译者注(架构细节与工程权衡): Kimi K2 的架构选择体现了明确的工程权衡思维。1) 稀疏度 48(384 专家/8 激活)vs DeepSeek-V3 的稀疏度 32(256/8)：通过缩放定律实验验证，更高的稀疏度在相同 FLOPs 下获得更好的 loss，但基础设施复杂度增加。2) 注意力头从 128 减到 64：这是一个"反直觉"的决策——通常更多头意味着更好性能，但 Kimi 团队发现 128k 上下文下翻倍头数使推理 FLOPs 增加 83%，而训练收益仅 0.5%-1.2%。对于以 Agent 场景为主的模型，推理效率比训练时的微小 loss 改善更重要。3) 密集层从 3 减到 1：进一步减少激活参数。这些决策共同将激活参数从 37B 降到 32.6B，在保持性能的同时降低了推理成本。

### 2.4 Training Infrastructure
#### 训练基础设施

#### 2.4.1 Compute Cluster
##### 计算集群

Kimi K2 was trained on a cluster equipped with NVIDIA H800 GPUs. Each node in the H800 cluster contains 2 TB RAM and 8 GPUs connected by NVLink and NVSwitch within nodes. Across different nodes, 8x400 Gbps RoCE interconnects are utilized to facilitate communications.

Kimi K2 在配备 NVIDIA H800 GPU 的集群上训练。H800 集群的每个节点包含 2TB RAM 和 8 个 GPU，节点内通过 NVLink 和 NVSwitch 连接。跨节点之间，使用 8x400 Gbps RoCE 互连来促进通信。

#### 2.4.2 Parallelism for Model Scaling
##### 模型缩放的并行策略

Training of large language models often progresses under dynamic resource availability. Instead of optimizing one parallelism strategy that's only applicable under specific amount of resources, we pursue a flexible strategy that allows Kimi K2 to be trained on any number of nodes that is a multiple of 32. Our strategy leverages a combination of 16-way Pipeline Parallelism (PP) with virtual stages [29, 54, 39, 58, 48, 22], 16-way Expert Parallelism (EP) [40], and ZeRO-1 Data Parallelism [61].

大型语言模型的训练通常在动态资源可用性下进行。我们不优化仅适用于特定资源量的单一并行策略，而是追求一种灵活的策略，允许 Kimi K2 在任意 32 的倍数节点数上训练。我们的策略 leveraging 16 路流水线并行(PP)与虚拟阶段 [29, 54, 39, 58, 48, 22]、16 路专家并行(EP) [40] 和 ZeRO-1 数据并行 [61] 的组合。

Under this setting, storing the model parameters in BF16 and their gradient accumulation buffer in FP32 requires approximately 6 TB of GPU memory, distributed over a model-parallel group of 256 GPUs. Placement of optimizer states depends on the training configurations. When the total number of training nodes is large, the optimizer states are distributed, reducing its per-device memory footprint to a negligible level. When the total number of training nodes is small (e.g., 32), we can offload some optimizer states to CPU.

在此设置下，以 BF16 存储模型参数、以 FP32 存储梯度累积缓冲区需要约 6TB GPU 内存，分布在 256 个 GPU 的模型并行组上。优化器状态的放置取决于训练配置。当训练节点总数较大时，优化器状态被分布，将其每设备内存占用降至可忽略水平。当训练节点总数较小(如 32)时，我们可以将部分优化器状态卸载到 CPU。

This approach allows us to reuse an identical parallelism configuration for both small- and large-scale experiments, while letting each GPU hold approximately 30 GB of GPU memory for all states. The rest of the GPU memory are used for activations, as described in Sec. 2.4.3. Such a consistent design is important for research efficiency, as it simplifies the system and substantially accelerates experimental iteration.

这种方法使我们能够对小规模和大规模实验重用相同的并行配置，同时让每个 GPU 为所有状态持有约 30GB GPU 内存。剩余的 GPU 内存用于激活，如第 2.4.3 节所述。这种一致的设计对研究效率很重要，因为它简化了系统并大幅加速了实验迭代。

**EP communication overlap with interleaved 1F1B**

**交错 1F1B 下的 EP 通信重叠**

By increasing the number of warm-up micro-batches, we can overlap EP all-to-all communication with computation under the standard interleaved 1F1B schedule [22, 54]. In comparison, DualPipe [11] doubles the memory required for parameters and gradients, necessitating an increase in parallelism to compensate. Increasing PP introduces more bubbles, while increasing EP, as discussed below, incurs higher overhead. The additional costs are prohibitively high for training a large model with over 1 trillion parameters and thus we opted not to use DualPipe.

通过增加预热微批次数，我们可以在标准交错 1F1B 调度 [22, 54] 下将 EP all-to-all 通信与计算重叠。相比之下，DualPipe [11] 使参数和梯度所需的内存翻倍，需要增加并行度来补偿。增加 PP 引入更多气泡，而增加 EP(如下所述)产生更高开销。对于训练超过 1 万亿参数的大型模型，这些额外成本高得令人望而却步，因此我们选择不使用 DualPipe。

However, interleaved 1F1B splits the model into more stages, introducing non-trivial PP communication overhead. To mitigate this cost, we decouple the weight-gradient computation from each micro-batch's backward pass and execute it in parallel with the corresponding PP communication. Consequently, all PP communications can be effectively overlapped except for the warm-up phase.

然而，交错 1F1B 将模型分割为更多阶段，引入了不可忽视的 PP 通信开销。为缓解这一成本，我们将权重梯度计算从每个微批次的反向传播中解耦，并与相应的 PP 通信并行执行。因此，除预热阶段外，所有 PP 通信都可以有效重叠。

**Smaller EP size**

**更小的 EP 规模**

To ensure full computation-communication overlap during the 1F1B stage, the reduced attention computation time in K2 (which has 64 attention heads compared to 128 heads in DeepSeek-V3) necessitates minimizing the time of EP operations. This is achieved by adopting the smallest feasible EP parallelization strategy, specifically EP = 16. Utilizing a smaller EP group also relaxes expert-balance constraints, allowing for near-optimal speed to be achieved without further tuning.

为确保 1F1B 阶段的完全计算-通信重叠，K2 中减少的注意力计算时间(K2 有 64 个注意力头，而 DeepSeek-V3 有 128 个)需要最小化 EP 操作的时间。这通过采用最小可行的 EP 并行化策略实现，具体为 EP = 16。使用更小的 EP 组还放松了专家平衡约束，无需进一步调优即可达到接近最优的速度。

#### 2.4.3 Activation Reduction
##### 激活减少

After reserving space for parameters, gradient buffers, and optimizer states, the remaining GPU memory on each device is insufficient to hold the full MoE activations. To ensure the activation memory fits within the constraints, especially for the initial pipeline stages that accumulate the largest activations during the 1F1B warm-up phase, the following techniques are employed.

为参数、梯度缓冲区和优化器状态预留空间后，每个设备上剩余的 GPU 内存不足以容纳完整的 MoE 激活。为确保激活内存符合约束，特别是对于在 1F1B 预热阶段累积最大激活的初始流水线阶段，采用了以下技术。

**Selective recomputation**

**选择性重计算**

Recomputation is applied to inexpensive, high-footprint stages, including LayerNorm, SwiGLU, and MLA up-projections [11]. Additionally, MoE down-projections are recomputed during training to further reduce activation memory. While optional, this recomputation maintains adequate GPU memory, preventing crashes caused by expert imbalance in early training stages.

重计算应用于开销低、内存占用大的阶段，包括 LayerNorm、SwiGLU 和 MLA 上投影 [11]。此外，MoE 下投影在训练期间被重计算以进一步减少激活内存。虽然是可选的，但这种重计算保持足够的 GPU 内存，防止早期训练阶段由专家不平衡导致的崩溃。

**FP8 storage for insensitive activations**

**不敏感激活的 FP8 存储**

Inputs of MoE up-projections and SwiGLU are compressed to FP8-E4M3 in 1x128 tiles with FP32 scales. Small-scale experiments show no measurable loss increase. Due to potential risks of performance degradation that we observed during preliminary study, we do not apply FP8 in computation.

MoE 上投影和 SwiGLU 的输入以 FP8-E4M3 格式在 1x128 tile 中压缩，使用 FP32 缩放因子。小规模实验显示没有可测量的 loss 增加。由于在初步研究中观察到的性能退化潜在风险，我们不在计算中应用 FP8。

**Activation CPU offload**

**激活 CPU 卸载**

All remaining activations are offloaded to CPU RAM. A copy engine is responsible for streaming the offload and onload, overlapping with both computation and communication kernels. During the 1F1B phase, we offload the forward activations of the previous micro-batch while prefetching the backward activations of the next. The warm-up and cool-down phases are handled similarly and the overall pattern is shown in Figure 7. Although offloading may slightly affect EP traffic due to PCIe traffic congestion, our tests show that EP communication remains fully overlapped.

所有剩余激活被卸载到 CPU RAM。复制引擎负责流式传输卸载和加载，与计算和通信内核重叠。在 1F1B 阶段，我们在预取下一个微批次的反向激活的同时卸载上一个微批次的前向激活。预热和冷却阶段以类似方式处理，整体模式见图 7。尽管由于 PCIe 流量拥塞，卸载可能轻微影响 EP 流量，但我们的测试显示 EP 通信仍保持完全重叠。

> 图 7 描述：不同 PP 阶段中重叠的计算、通信和卸载。

### 2.5 Training recipe
#### 训练配方

We pre-trained the model with a 4,096-token context window using the MuonClip optimizer (Algorithm 1) and the WSD learning rate schedule [26], processing a total of 15.5T tokens. The first 10T tokens were trained with a constant learning rate of 2e-4 after a 500-step warm-up, followed by 5.5T tokens with a cosine decay from 2e-4 to 2e-5. Weight decay was set to 0.1 throughout, and the global batch size was held at 67M tokens. The overall training curve is shown in Figure 3.

我们使用 MuonClip 优化器(算法 1)和 WSD 学习率调度 [26]，以 4096 token 上下文窗口预训练模型，共处理 15.5T token。前 10T token 在 500 步预热后以恒定学习率 2e-4 训练，随后 5.5T token 以从 2e-4 到 2e-5 的余弦衰减训练。权重衰减始终设为 0.1，全局批次大小保持在 67M token。整体训练曲线见图 3。

Towards the end of pre-training, we conducted an annealing phase followed by a long-context activation stage. The batch size was kept constant at 67M tokens, while the learning rate was decayed from 2e-5 to 7e-6. In this phase, the model was trained on 400 billion tokens with a 4k sequence length, followed by an additional 60 billion tokens with a 32k sequence length. To extend the context window to 128k, we employed the YaRN method [56].

在预训练接近尾声时，我们进行了退火阶段，然后是长上下文激活阶段。批次大小保持在 67M token，学习率从 2e-5 衰减到 7e-6。在此阶段，模型在 4k 序列长度的 4000 亿 token 上训练，随后在 32k 序列长度的 600 亿 token 上训练。为将上下文窗口扩展到 128k，我们采用了 YaRN 方法 [56]。

> 译者注(工程细节): §2 的训练基础设施设计展现了极强的工程务实精神。几个亮点：1) "灵活并行策略"——不绑定特定资源量，32 到任意节点数都能训练，这大幅加速了实验迭代; 2) 放弃 DualPipe 选择交错 1F1B——虽然 DualPipe 在 DeepSeek-V3 中表现出色，但其内存翻倍对于 1T 参数的 K2 来说成本过高; 3) EP=16 的最小可行策略——配合 64 注意力头的设计，确保 EP all-to-all 能被计算完全掩盖; 4) CPU 激活卸载——这是显存不足时的经典策略，但通过 copy engine 实现了与计算/通信的重叠。这些设计共同支撑了在 H800 集群上高效训练 1T 参数模型的工程目标。


## 3 Post-Training
### 后训练

### 3.1 Supervised Fine-Tuning
#### 监督微调

We employ the Muon optimizer [34] in our post-training and recommend its use for fine-tuning with K2. This follows from the conclusion of our previous work [47] that a Muon-pre-trained checkpoint produces the best performance with Muon fine-tuning.

我们在后训练中使用 Muon 优化器 [34]，并推荐将其用于 K2 的微调。这源于我们先前工作 [47] 的结论：Muon 预训练的检查点与 Muon 微调结合能产生最佳性能。

We construct a large-scale instruction-tuning dataset spanning diverse domains, guided by two core principles: maximizing prompt diversity and ensuring high response quality. To this end, we develop a suite of data generation pipelines tailored to different task domains, each utilizing a combination of human annotation, prompt engineering, and verification processes. We adopt K1.5 [36] and other in-house domain-specialized expert models to generate candidate responses for various tasks, followed by LLMs or human-based judges to perform automated quality evaluation and filtering. For agentic data, we create a data synthesis pipeline to teach models tool-use capabilities through multi-step, interactive reasoning.

我们构建了一个跨越多样化领域的大规模指令微调数据集，遵循两个核心原则：最大化提示多样性和确保高响应质量。为此，我们开发了一套针对不同任务领域定制的数据生成流水线，每个流水线结合人工标注、提示工程和验证流程。我们采用 K1.5 [36] 和其他内部领域专家模型为各种任务生成候选响应，随后由 LLM 或人工评判者进行自动化质量评估和过滤。对于智能体数据，我们创建了数据合成流水线，通过多步交互推理教授模型工具使用能力。

#### 3.1.1 Large-Scale Agentic Data Synthesis for Tool Use Learning
##### 面向工具学习的大规模智能体数据合成

A critical capability of modern LLM agents is their ability to autonomously use unfamiliar tools, interact with external environments, and iteratively refine their actions through reasoning, execution, and error correction. Agentic tool use capability is essential for solving complex, multi-step tasks that require dynamic interaction with real-world systems. Recent benchmarks such as ACEBench [7] and tau-bench [86] have highlighted the importance of comprehensive tool-use evaluation, while frameworks like ToolLLM [59] and ACEBench [7] have demonstrated the potential of teaching models to use thousands of tools effectively.

现代 LLM 智能体的一个关键能力是自主使用不熟悉的工具、与外部环境交互，并通过推理、执行和错误纠正迭代优化其行动。智能体工具使用能力对于解决需要与现实世界系统动态交互的复杂多步任务至关重要。近期基准测试如 ACEBench [7] 和 tau-bench [86] 凸显了全面工具使用评估的重要性，而 ToolLLM [59] 和 ACEBench [7] 等框架已展示了教授模型有效使用数千种工具的潜力。

However, training such capabilities at scale presents a significant challenge: while real-world environments provide rich and authentic interaction signals, they are often difficult to construct at scale due to cost, complexity, privacy and accessibility constraints. Recent work on synthetic data generation (AgentInstruct [52]; Self-Instruct [76]; StableToolBench [21]; ZeroSearch [67]) has shown promising results in creating large-scale data without relying on real-world interactions. Building on these advances and inspired by ACEBench [7]'s comprehensive data synthesis framework, we developed a pipeline that simulates real-world tool-use scenarios at scale, enabling the generation of tens of thousands of diverse and high-quality training examples.

然而，大规模训练此类能力面临重大挑战：虽然真实环境提供丰富真实的交互信号，但由于成本、复杂度、隐私和可访问性限制，它们往往难以大规模构建。近期关于合成数据生成的工作(AgentInstruct [52]、Self-Instruct [76]、StableToolBench [21]、ZeroSearch [67])在不依赖真实世界交互的情况下创建大规模数据方面显示出有希望的结果。基于这些进展并受 ACEBench [7] 综合数据合成框架的启发，我们开发了一个大规模模拟真实世界工具使用场景的流水线，能够生成数万个多样化且高质量的训练样本。

There are three stages in our data synthesis pipeline, depicted in Fig. 8.

我们的数据合成流水线有三个阶段，见图 8。

- Tool spec generation: we first construct a large repository of tool specs from both real-world tools and LLM-synthetic tools;
- Agent and task generation: for each tool-set sampled from the tool repository, we generate an agent to use the toolset and some corresponding tasks;
- Trajectory generation: for each agent and task, we generate trajectories where the agent finishes the task by invoking tools.

- 工具规格生成：我们首先从真实世界工具和 LLM 合成工具构建大型工具规格仓库; 
- 智能体和任务生成：对于从工具仓库采样的每个工具集，我们生成一个使用该工具集的智能体和一些相应任务; 
- 轨迹生成：对于每个智能体和任务，我们生成智能体通过调用工具完成任务的轨迹。

> 图 8 描述：工具使用的数据合成流水线。(a) 工具规格来自真实世界工具和 LLM; 智能体和任务从工具仓库生成。(b) 多智能体流水线生成和过滤带工具调用的轨迹。

> 图 9 描述：工具嵌入的 t-SNE 可视化。(a) 真实世界 MCP 工具按原始来源类别呈现自然聚类。(b) 合成工具按预定义领域类别组织，系统覆盖工具空间。两者共同确保不同工具功能的全面表征。

**Domain Evolution and Tool Generation.** We construct a comprehensive tool repository through two complementary approaches. First, we directly fetch 3000+ real MCP (Model Context Protocol) tools from GitHub repositories, leveraging existing high-quality tool specs. Second, we systematically evolve [83] synthetic tools through a hierarchical domain generation process: we begin with key categories (e.g., financial trading, software applications, robot control), then evolve multiple specific application domains within each category. Specialized tools are then synthesized for each domain, with clear interfaces, descriptions, and operational semantics. This evolution process produces over 20,000 synthetic tools.

**领域演化与工具生成。** 我们通过两种互补方法构建综合工具仓库。首先，我们直接从 GitHub 仓库获取 3000+ 真实 MCP(Model Context Protocol，模型上下文协议) 工具，利用现有高质量工具规格。其次，我们通过层次化领域生成过程系统地演化 [83] 合成工具：从关键类别开始(如金融交易、软件应用、机器人控制)，然后在每个类别内演化多个特定应用领域。随后为每个领域合成专门工具，具有清晰的接口、描述和操作语义。这一演化过程产生超过 20,000 个合成工具。

**Agent Diversification.** We generate thousands of distinct agents by synthesizing various system prompts and equipping them with different combinations of tools from our repository. This creates a diverse population of agents with varied capabilities, areas of expertise, and behavioral patterns, ensuring a broad coverage of potential use cases.

**智能体多样化。** 我们通过合成各种系统提示并为其配备来自我们仓库的不同工具组合，生成数千个不同的智能体。这创建了具有不同能力、专长领域和行为模式的多样化智能体群体，确保广泛覆盖潜在用例。

**Rubric-Based Task Generation.** For each agent configuration, we generate tasks that range from simple to complex operations. Each task is paired with an explicit rubric that specifies success criteria, expected tool-use patterns, and evaluation checkpoints. This rubric-based approach ensures a consistent and objective evaluation of agent performance.

**基于评分表的任务生成。** 对于每个智能体配置，我们生成从简单到复杂操作的任务。每个任务配有一个明确的评分表，规定成功标准、预期工具使用模式和评估检查点。这种基于评分表的方法确保对智能体性能的一致和客观评估。

**Multi-turn Trajectory Generation.** We simulate realistic tool-use scenarios through several components:

**多轮轨迹生成。** 我们通过几个组件模拟真实的工具使用场景：

- User Simulation: LLM-generated user personas with distinct communication styles and preferences engage in multi-turn dialogues with agents, creating naturalistic interaction patterns.
- Tool Execution Environment: A sophisticated tool simulator (functionally equivalent to a world model) executes tool calls and provides realistic feedback. The simulator maintains and updates state after each tool execution, enabling complex multi-step interactions with persistent effects. It introduces controlled stochasticity to produce varied outcomes including successes, partial failures, and edge cases.

- 用户模拟：具有不同沟通风格和偏好的 LLM 生成用户角色与智能体进行多轮对话，创建自然交互模式。
- 工具执行环境：复杂的工具模拟器(功能上等同于世界模型)执行工具调用并提供真实反馈。模拟器在每次工具执行后维护和更新状态，支持具有持久效应的复杂多步交互。它引入受控的随机性以产生包括成功、部分失败和边界案例在内的多样化结果。

**Quality Evaluation and Filtering.** An LLM-based judge evaluates each trajectory against the task rubrics. Only trajectories that meet the success criteria are retained for training, ensuring high-quality data while allowing natural variation in task-completion strategies.

**质量评估与过滤。** 基于 LLM 的评判者根据任务评分表评估每个轨迹。只有满足成功标准的轨迹被保留用于训练，确保高质量数据，同时允许任务完成策略中的自然变化。

**Hybrid Approach with Real Execution Environments.** While simulation provides scalability, we acknowledge the inherent limitation of simulation fidelity. To address this, we complement our simulated environments with real execution sandboxes for scenarios where authenticity is crucial, particularly in coding and software engineering tasks. These real sandboxes execute actual code, interact with genuine development environments, and provide ground-truth feedback through objective metrics such as test suite pass rates. This combination ensures that our models learn from both the diversity of simulated scenarios and the authenticity of real executions, significantly strengthening practical agent capabilities.

**结合真实执行环境的混合方法。** 虽然模拟提供可扩展性，但我们承认模拟保真度的固有局限性。为解决这一问题，我们在模拟环境之外补充了真实执行沙箱，用于真实性至关重要的场景，特别是编程和软件工程任务。这些真实沙箱执行实际代码，与真实开发环境交互，并通过测试套件通过率等客观指标提供真实反馈。这种组合确保我们的模型从模拟场景的多样性和真实执行的真实性中学习，显著增强实际智能体能力。

By leveraging this hybrid pipeline that combines scalable simulation with targeted real-world execution, we generate diverse, high-quality tool-use demonstrations that balance coverage and authenticity. The scale and automation of our synthetic data generation, coupled with the grounding provided by real execution environments, effectively implements large-scale rejection sampling [27, 88] through our quality filtering process. This high-quality synthetic data, when used for supervised fine-tuning, has demonstrated significant improvements in the model's tool-use capabilities across a wide range of real-world applications.

通过利用这种结合可扩展模拟与针对性真实世界执行的混合流水线，我们生成了平衡覆盖度和真实性的多样化、高质量工具使用演示。我们合成数据生成的规模和自动化，加上真实执行环境提供的基础，通过质量过滤过程有效实现了大规模拒绝采样 [27, 88]。这种高质量合成数据用于监督微调时，已在广泛的现实应用中显著改善了模型的工具使用能力。

### 3.2 Reinforcement Learning
#### 强化学习

Reinforcement learning (RL) is believed to have better token efficiency and generalization than SFT. Based on the work of K1.5 [36], we continue to scale RL in both task diversity and training FLOPs in K2. To support this, we develop a Gym-like extensible framework that facilitates RL across a wide range of scenarios. We extend the framework with a large number of tasks with verifiable rewards. For tasks that rely on subjective preferences, such as creative writing and open-ended question answering, we introduce a self-critic reward in which the model performs pairwise comparisons to judge its own outputs. This approach allows tasks from various domains to all benefit from the RL paradigm.

强化学习(RL)被认为比 SFT 具有更好的 token 效率和泛化能力。基于 K1.5 [36] 的工作，我们在 K2 中继续在任务多样性和训练 FLOPs 两方面扩展 RL。为支持这一点，我们开发了一个类似 Gym 的可扩展框架，促进跨广泛场景的 RL。我们用大量具有可验证奖励的任务扩展该框架。对于依赖主观偏好的任务，如创意写作和开放式问答，我们引入了自我批评奖励，模型通过成对比较来评判自己的输出。这种方法使来自各个领域的任务都能从 RL 范式中受益。

#### 3.2.1 Verifiable Rewards Gym
##### 可验证奖励 Gym

**Math, STEM and Logical Tasks.** For math, STEM and logical reasoning domains, our RL data preparation follows two key principles, diverse coverage and moderate difficulty.

**数学、STEM 和逻辑任务。** 对于数学、STEM 和逻辑推理领域，我们的 RL 数据准备遵循两个关键原则：多样化覆盖和适度难度。

**Diverse Coverage.** For math and STEM tasks, we collect high-quality QA pairs using a combination of expert annotations, internal QA extraction pipelines, and open datasets [42, 53]. During the collection process, we leverage a tagging system to deliberately increase coverage of under-covered domains. For logical tasks, our dataset comprises a variety of formats, including structured data tasks (e.g., multi-hop tabular reasoning, cross-table aggregation) and logic puzzles (e.g., the 24-game, Sudoku, riddles, cryptarithms, and Morse-code decoding).

**多样化覆盖。** 对于数学和 STEM 任务，我们结合专家标注、内部 QA 提取流水线和开放数据集 [42, 53] 收集高质量 QA 对。在收集过程中，我们利用标签系统有意识地增加未被充分覆盖领域的覆盖度。对于逻辑任务，我们的数据集包含多种格式，包括结构化数据任务(如多跳表格推理、跨表聚合)和逻辑谜题(如 24 点游戏、数独、谜语、密码算术和莫尔斯电码解码)。

**Moderate Difficulty.** The RL prompt-set should be neither too easy nor too hard, both of which may produce little signal and reduce learning efficiency. We assess the difficulty of each problem using the SFT model's pass@k accuracy and select only problems with moderate difficulty.

**适度难度。** RL 提示集不应太简单也不应太难，两者都可能产生很少的信号并降低学习效率。我们使用 SFT 模型的 pass@k 准确率评估每个问题的难度，并仅选择难度适中的问题。

**Complex Instruction Following.** Effective instruction following requires not only understanding explicit constraints but also navigating implicit requirements, handling edge cases, and maintaining consistency over extended dialogues. We address these challenges through a hybrid verification framework that combines automated verification with adversarial detection, coupled with a scalable curriculum generation pipeline.

**复杂指令遵循。** 有效的指令遵循不仅需要理解显式约束，还需要处理隐式要求、处理边界案例，并在扩展对话中保持一致性。我们通过结合自动化验证与对抗检测的混合验证框架来解决这些挑战，并配以可扩展的课程生成流水线。

**Faithfulness.** Faithfulness is essential for an agentic model operating in scenarios such as multi-turn tool use, self-generated reasoning chains, and open-environment interactions. Inspired by the evaluation framework from FACTS Grounding [31], we train a sentence-level faithfulness judge model to perform automated verification. The judge is effective in detecting sentences that make a factual claim without supporting evidence in context. It serves as a reward model to enhance overall faithfulness performance.

**忠实度。** 忠实度对于在多轮工具使用、自生成推理链和开放环境交互等场景中运行的智能体模型至关重要。受 FACTS Grounding [31] 评估框架的启发，我们训练了一个句子级忠实度评判模型来执行自动化验证。该评判者擅长检测在上下文中没有支持证据就提出事实声明的句子。它作为奖励模型来增强整体忠实度性能。

**Coding & Software Engineering.** To enhance our capability in tackling competition-level programming problems, we gather problems and their judges from both open-source datasets [28, 84] and synthetic sources. To ensure the diversity of the synthetic data and the correctness of reward signals, we incorporate high-quality human-written unit tests retrieved from pre-training data. For software engineering tasks, we collect a vast amount of pull requests and issues from GitHub to build software development environment that consists of user prompts/issues and executable unit tests. This environment was built on a robust sandbox infrastructure, powered by Kubernetes for scalability and security. It supports over 10,000 concurrent sandbox instances with stable performance, making it ideal for both competitive coding and software engineering tasks.

**编程与软件工程。** 为增强我们解决竞赛级编程问题的能力，我们从开源数据集 [28, 84] 和合成来源收集问题及其评判器。为确保合成数据的多样性和奖励信号的正确性，我们纳入了从预训练数据中检索的高质量人工编写单元测试。对于软件工程任务，我们从 GitHub 收集大量 pull request 和 issue，构建由用户提示/issue 和可执行单元测试组成的软件开发环境。该环境建立在强大的沙箱基础设施之上，由 Kubernetes 驱动以实现可扩展性和安全性。它支持超过 10,000 个并发沙箱实例，性能稳定，非常适合竞赛编程和软件工程任务。

**Safety.** Our work to enhance the safety begins with a human-curated set of seed prompts, manually crafted to encompass prevalent risk categories such as violence, fraud, and discrimination. To simulate sophisticated jailbreak attempts (e.g., role-playing, literary narratives, and academic discourse), we employ an automated prompt evolution pipeline with three key components: Attack Model (iteratively generates adversarial prompts), Target Model (produces responses to these prompts), and Judge Model (evaluates the interaction to determine if the adversarial prompt successfully bypasses safety mechanisms). Each interaction is assessed using a task-specific rubric, enabling the judge model to provide a binary success/failure label.

**安全性。** 我们增强安全性的工作始于人工策划的种子提示集，手工制作以涵盖暴力、欺诈和歧视等普遍风险类别。为模拟复杂的越狱尝试(如角色扮演、文学叙事和学术论述)，我们采用自动化提示演化流水线，包含三个关键组件：攻击模型(迭代生成对抗性提示)、目标模型(生成对这些提示的响应)和评判模型(评估交互以确定对抗性提示是否成功绕过安全机制)。每个交互使用任务特定的评分表进行评估，使评判模型能够提供二元成功/失败标签。

#### 3.2.2 Beyond Verification: Self-Critique Rubric Reward
##### 超越验证：自我批评评分表奖励

To extend model alignment beyond tasks with verifiable reward, we introduce a framework for general reinforcement learning from self-critic feedbacks. This approach is designed to align LLMs with nuanced human preferences, including helpfulness, creativity, depth of reasoning, factuality, and safety, by extending the capabilities learned from verifiable scenarios to a broader range of subjective tasks. The framework operates using a Self-Critique Rubric Reward mechanism, where the model evaluates its own outputs to generate preference signals. To bootstrap K2 as a competent judge, we curated a mixture of open-source and in-house preference datasets and initialize its critic capability in the SFT stage.

为将模型对齐扩展到具有可验证奖励的任务之外，我们引入了从自我批评反馈中进行通用强化学习的框架。这种方法旨在通过将从可验证场景中学到的能力扩展到更广泛的主观任务，使 LLM 与微妙的人类偏好对齐，包括有用性、创造性、推理深度、事实性和安全性。该框架使用自我批评评分表奖励机制运作，模型评估自己的输出来生成偏好信号。为使 K2 成为有能力的评判者，我们策划了开源和内部偏好数据集的混合，并在 SFT 阶段初始化其批评能力。

**Self-Critiqued Policy Optimization.** In the first core process of the learning loop, the K2 actor generates responses for general prompts that cover a wide range of use cases. The K2 critic then ranks all results by performing pairwise evaluations against a combination of rubrics, which incorporates both core rubrics (Appendix F.1), which represent the fundamental values of our AI assistant that Kimi cherish, prescriptive rubrics (Appendix F.2) that aim to eliminate reward hacking, and human-annotated rubrics crafted by our data team for specific instructional contexts. Although certain rubrics can be designated as mandatory, K2 retains the flexibility to weigh them against its internal priors. This capacity enables a dynamic and continuous alignment with its evolving on-policy behavior, ensuring that the model's responses remain coherent with its core identity while adapting to specific instructions.

**自我批评策略优化。** 在学习循环的第一个核心过程中，K2 actor 为涵盖广泛用例的通用提示生成响应。然后 K2 critic 通过成对评估对所有结果进行排名，评估依据一组评分表的组合，包括核心评分表(附录 F.1，代表 Kimi 珍视的 AI 助手的基本价值观)、规定性评分表(附录 F.2，旨在消除奖励黑客)以及数据团队为特定指令上下文手工标注的评分表。虽然某些评分表可被指定为强制性，但 K2 保留根据内部先验权衡它们的灵活性。这种能力使其能够与不断演进的 on-policy 行为进行动态和持续的对齐，确保模型的响应在适应特定指令的同时保持与其核心身份的一致性。

**Closed-Loop Critic Refinement and Alignment.** During RL training, the critic model is refined using verifiable signals. On-policy rollouts generated from verifiable-reward prompts are used to continuously update the critic, a crucial step that distills objective performance signals from RLVR directly into its evaluation model. This transfer learning process grounds its more subjective judgments in verifiable data, allowing the performance gains from verifiable tasks to enhance the critic's judgment on complex tasks that lack explicit reward signals. This closed-loop process ensures that the critic continuously recalibrates its evaluation standards in lockstep with the policy's evolution. By grounding subjective evaluation in verifiable data, the framework enables robust and scalable alignment with complex, non-verifiable human objectives.

**闭环批评者精炼与对齐。** 在 RL 训练期间，critic 模型使用可验证信号进行精炼。从可验证奖励提示生成的 on-policy rollout 用于持续更新 critic，这是将 RLVR 的客观性能信号直接提炼到其评估模型中的关键步骤。这种迁移学习过程将其更主观的判断建立在可验证数据之上，使可验证任务的性能增益能够增强 critic 对缺乏明确奖励信号的复杂任务的判断。这种闭环过程确保 critic 与策略的演进同步持续重新校准其评估标准。通过将主观评估建立在可验证数据之上，该框架实现了与复杂、不可验证的人类目标的稳健且可扩展的对齐。

Consequently, this holistic alignment yields comprehensive performance improvements across a wide spectrum of domains, including user intent understanding, creative writing, complex reasoning, and nuanced language comprehension.

因此，这种整体对齐在广泛的领域产生了全面的性能提升，包括用户意图理解、创意写作、复杂推理和微妙的语言理解。

#### 3.2.3 RL Algorithm
##### RL 算法

We adopt the policy optimization algorithm introduced in K1.5 [36] as the foundation for K2. For each problem x, we sample K responses {y_1,...,y_K} from the previous policy pi_old, and optimize the model pi_theta with respect to the following objective:

我们采用 K1.5 [36] 中引入的策略优化算法作为 K2 的基础。对于每个问题 x，我们从先前策略 pi_old 中采样 K 个响应 {y_1,...,y_K}，并针对以下目标优化模型 pi_theta：

$$
L_{RL}(\theta) = \mathbb{E}_{x \sim D} \left[ \frac{1}{K} \sum_{i=1}^{K} \left( r(x, y_i) - \bar{r}(x) - \tau \log \frac{\pi_\theta(y_i|x)}{\pi_{old}(y_i|x)} \right)^2 \right],
$$

where r_bar(x) = (1/k) sum_{i=1}^k r(x, y_i) is the mean rewards of the sampled responses, tau > 0 is a regularization parameter that promotes stable learning. As in SFT, we employ the Muon optimizer [34] to minimize this objective. As we scale RL training to encompass a broader range of tasks in K2, a primary challenge is achieving consistent performance improvements across all domains. To address this, we introduce several additions to the RL algorithm.

其中 r_bar(x) = (1/k) sum_{i=1}^k r(x, y_i) 是采样响应的平均奖励，tau > 0 是促进稳定学习的正则化参数。与 SFT 一样，我们采用 Muon 优化器 [34] 来最小化该目标。随着我们将 RL 训练扩展到涵盖 K2 中更广泛的任务，一个主要挑战是在所有领域实现一致的性能提升。为解决这一问题，我们对 RL 算法引入了若干补充。

**Budget Control.** It has been widely observed that RL often results in a substantial increase in the length of model-generated responses [36, 20]. While longer responses can enable the model to utilize additional test-time compute for improved performance on complex reasoning tasks, the benefits often do not justify its inference cost in non-reasoning domains. To encourage the model to properly distribute inference budget, we enforce a per-sample maximum token budget throughout RL training, where the budget is determined based on the type of task. Responses that exceed this token budget are truncated and assigned a penalty, which incentivizes the model to generate solutions within the specified limit. Empirically, this approach significantly enhances the model's token efficiency, encouraging concise yet effective solutions across all domains.

**预算控制。** 人们广泛观察到 RL 通常导致模型生成响应长度大幅增加 [36, 20]。虽然更长的响应可以使模型利用额外的测试时计算来改善复杂推理任务的性能，但这些收益往往无法证明其在非推理领域的推理成本。为鼓励模型合理分配推理预算，我们在整个 RL 训练中强制执行每个样本的最大 token 预算，预算根据任务类型确定。超过此 token 预算的响应被截断并分配惩罚，激励模型在指定限制内生成解决方案。经验上，这种方法显著提高了模型的 token 效率，鼓励在所有领域生成简洁而有效的解决方案。

**PTX Loss.** To prevent the potential forgetting of valuable, high-quality data during joint RL training, we curate a dataset comprising hand-selected, high-quality samples and integrate it into the RL objective through an auxiliary PTX loss [55]. This strategy not only leverages the advantages of high-quality data, but also mitigates the risk of overfitting to the limited set of tasks explicitly present in the training regime. This augmentation substantially improves the model's generalization across a broader range of domains.

**PTX 损失。** 为防止联合 RL 训练期间可能遗忘宝贵的高质量数据，我们策划了一个包含手工挑选的高质量样本的数据集，并通过辅助 PTX 损失 [55] 将其整合到 RL 目标中。这种策略不仅利用高质量数据的优势，还缓解了过拟合到训练体制中明确存在的有限任务集的风险。这种增强大幅改善了模型在更广泛领域上的泛化能力。

**Temperature Decay.** For tasks such as creative writing and complex reasoning, we find that promoting exploration via a high sampling temperature during the initial stages of training is crucial. A high temperature allow the model to generate diverse and innovative responses, thereby facilitating the discovery of effective strategies and reducing the risk of premature convergence to suboptimal solutions. However, retaining a high temperature in the later stages of training or during evaluation can be detrimental, as it introduces excessive randomness and compromises the reliability and consistency of the model's outputs. To address this, we employ a temperature decay schedule, to shift from exploration to exploitation throughout the training. This strategy ensures that the model leverages exploration when it is most beneficial, while ultimately converge on stable and high-quality outputs.

**温度衰减。** 对于创意写作和复杂推理等任务，我们发现通过在训练初始阶段使用高采样温度促进探索至关重要。高温度允许模型生成多样化和创新的响应，从而促进发现有效策略并降低过早收敛到次优解决方案的风险。然而，在训练后期或评估期间保持高温度可能是有害的，因为它引入过多的随机性并损害模型输出的可靠性和一致性。为解决这一问题，我们采用温度衰减调度，在整个训练过程中从探索转向利用。这种策略确保模型在最有利时利用探索，同时最终收敛到稳定且高质量的输出。

### 3.3 RL Infrastructure
#### RL 基础设施

#### 3.3.1 Colocated Architecture
##### 同地架构

Similar to K1.5 [36], we adopt a hybrid colocated architecture for our synchronized RL training, where the training and inference engines live on the same workers. When one engine is actively working, the other engine releases or offloads its GPU resources to accommodate. In each iteration of RL training, a centralized controller first calls the inference engine to generate new data for training. It then notifies the training engine to train on the new data, and send updated parameters to the inference engine for the next iteration.

与 K1.5 [36] 类似，我们采用混合同地架构进行同步 RL 训练，训练和推理引擎位于同一组工作者上。当一个引擎 actively 工作时，另一个引擎释放或卸载其 GPU 资源以适应。在 RL 训练的每次迭代中，集中式控制器首先调用推理引擎生成新的训练数据。然后通知训练引擎在新数据上训练，并将更新后的参数发送给推理引擎用于下一次迭代。

Each engine is heavily optimized for throughput. In addition, as the model scales to the size of K2, the latency of engine switching and failure recovery becomes significant. We present our system design considerations in these aspects.

每个引擎都针对吞吐量进行了重度优化。此外，随着模型扩展到 K2 的规模，引擎切换和故障恢复的延迟变得显著。我们在这些方面介绍系统设计考虑。

#### 3.3.2 Efficient Engine Switching
##### 高效引擎切换

During rollout, the parameters of the training engine are offloaded to DRAM. Bringing up the training engine is therefore a simple step of H2D transmission. However, bringing up the inference engine is a bigger challenge, as it must obtain updated parameters from the training engine with a different sharding paradigm.

在 rollout 期间，训练引擎的参数被卸载到 DRAM。启动训练引擎因此只是简单的 H2D(Host-to-Device) 传输步骤。然而，启动推理引擎是一个更大的挑战，因为它必须从具有不同分片范式的训练引擎获取更新后的参数。

Given the scale of K2 and the vast number of devices involved, using a network file system for resharding and broadcasting parameters is impractical. The aggregate bandwidth required to keep overhead low reaches several petabytes per second. To address this challenge, we developed a distributed checkpoint engine co-located on training nodes to manage parameter状态. To perform a parameter update, each checkpoint engine worker obtains a local copy of parameters from the training engine, then broadcasts the full parameter set across all checkpoint engine workers. Subsequently, the inference engine retrieves only the parameter shard it requires from the checkpoint engine. This process is illustrated in Figure 10. To enable this for a 1T model, updates are performed parameter-by-parameter in a pipelined manner, minimizing memory footprint (see Appendix G).

鉴于 K2 的规模和涉及的庞大设备数量，使用网络文件系统进行重新分片和广播参数是不切实际的。保持低开销所需的总带宽达到每秒数 PB。为解决这一挑战，我们开发了一个分布在训练节点上的检查点引擎来管理参数状态。为执行参数更新，每个检查点引擎工作者从训练引擎获取参数的本地副本，然后在所有检查点引擎工作者之间广播完整参数集。随后，推理引擎仅从检查点引擎检索其所需的参数分片。这一过程见图 10。为使 1T 模型能够实现这一点，更新以流水线方式逐个参数执行，最小化内存占用(见附录 G)。

> 图 10 描述：利用检查点引擎进行参数更新。

We opt to broadcast the full parameter set across the entire cluster, regardless of the specific sharding schemes on each inference worker. While this transfers several times more data than a theoretically最优 approach, it offers a simpler system design that is less intrusive to the training and inference engines. We chose to trade off this minor overhead to fully decouple the training engine and the inference engine, significantly simplifying maintenance and testing. Notably, this approach outperforms the transfer-what-you-need method due to reduced synchronization overhead and higher network bandwidth utilization. Our system can complete a full parameter update for Kimi K2 with less than 30 seconds, a negligible duration for a typical RL training iteration.

我们选择在整个集群中广播完整参数集，而不考虑每个推理工作者上的具体分片方案。虽然这比理论上的最优方法传输数倍的数据，但它提供了更简单的系统设计，对训练和推理引擎的侵入性更小。我们选择用这一微小开销来完全解耦训练引擎和推理引擎，大幅简化了维护和测试。值得注意的是，由于减少了同步开销并提高了网络带宽利用率，这种方法优于"按需传输"方法。我们的系统可以在不到 30 秒内完成 Kimi K2 的完整参数更新，这对于典型的 RL 训练迭代来说是可忽略的时间。

#### 3.3.3 Efficient System Startup
##### 高效系统启动

As large-scale training is prone to system failure, optimizing the startup time is crucial for models as large as Kimi K2. To start the training engine, we let each training worker selectively read part or none of the parameters from disk, and broadcast necessary parameters to its peers. The design goal is to ensure all workers collectively read the checkpoint only once, minimizing expensive disk IO.

由于大规模训练容易出现系统故障，优化启动时间对于 Kimi K2 这样规模的模型至关重要。为启动训练引擎，我们让每个训练工作者选择性地从磁盘读取部分或全部不读取参数，并向其对等节点广播必要参数。设计目标是确保所有工作者集体只读取一次检查点，最小化昂贵的磁盘 IO。

As the inference engines are independent replicas, we would like to avoid introducing extra synchronization barriers between them. Therefore, we opt to reuse checkpoint engine for startup: we let checkpoint engine collectively read the checkpoint from disk, similar to how the training engine starts. Then it updates the state of the uninitialized inference engine, using the approach introduced in the previous section. By leveraging the dedicated checkpoint engine, the system also becomes robust to single-point failures, because an inference replica can restart without communicating with other replicas.

由于推理引擎是独立的副本，我们希望避免在它们之间引入额外的同步屏障。因此，我们选择重用检查点引擎进行启动：让检查点引擎集体从磁盘读取检查点，类似于训练引擎的启动方式。然后它使用上一节介绍的方法更新未初始化推理引擎的状态。通过利用专用检查点引擎，系统也对单点故障具有鲁棒性，因为推理副本可以在不与其他副本通信的情况下重新启动。

#### 3.3.4 Agentic Rollout
##### 智能体 Rollout

Our RL infrastructure supports the training of long-horizon, multi-turn agentic tasks. During rollout, these tasks present distinct challenges, such as complex environmental interactions and prolonged rollout durations. Here we introduce a few optimizations to alleviate these issues.

我们的 RL 基础设施支持长时程、多轮智能体任务的训练。在 rollout 期间，这些任务呈现出独特的挑战，如复杂的环境交互和 prolonged rollout 持续时间。在此我们介绍一些优化来缓解这些问题。

Due to the diversity of environments, certain interactions may be blocked on waiting for environment feedback (e.g., a virtual machine or a code interpreter), leaving the GPUs idle. We employ two strategies to maximize GPU utilization: (i) we deploy heavy environments as dedicated services that can scale up more easily; (ii) we employ a large number of concurrent rollouts to amortize the latency induced by certain expensive interactions.

由于环境的多样性，某些交互可能因等待环境反馈(如虚拟机或代码解释器)而被阻塞，导致 GPU 空闲。我们采用两种策略来最大化 GPU 利用率：(i) 将重型环境部署为可更轻松扩展的专用服务; (ii) 采用大量并发 rollout 来摊销某些昂贵交互引起的延迟。

Another challenge in agentic rollout is that individual rollout trajectories can be extremely long. To prevent long-tail trajectories from blocking the entire rollout process, we employ the partial rollout [36] technique. This strategy allows long-tail unfinished tasks to be paused, and resumed in the next RL iteration.

智能体 rollout 中的另一个挑战是单个 rollout 轨迹可能极长。为防止长尾轨迹阻塞整个 rollout 过程，我们采用 partial rollout [36] 技术。这种策略允许长尾未完成任务被暂停，并在下一次 RL 迭代中恢复。

To improve research efficiency, we also design a unified interface inspired by the OpenAI Gym framework [5] to streamline the integration of new environments. We hope to scale our RL infrastructure to more diverse interactive environments in the future.

为提高研究效率，我们还设计了一个受 OpenAI Gym 框架 [5] 启发的统一接口，以简化新环境的集成。我们希望将来将 RL 基础设施扩展到更多样化的交互环境。

> 译者注(工程细节与局限风险): §3 的后训练设计展现了 Kimi 团队在 Agentic AI 上的深厚积累。几个核心设计值得注意：1) "混合方法"(模拟+真实沙箱)——这是解决合成数据保真度问题的务实方案，真实沙箱支持 10,000+ 并发实例，在 SWE-bench 类任务中提供真实反馈; 2) 自我批评评分表奖励——将 RLVR 的客观信号通过迁移学习注入 critic，使主观任务也能受益于可验证任务的性能增益，这是一个巧妙的闭环设计; 3) 预算控制——直接限制响应长度以防止 RL 导致的"话痨"现象，这是对推理成本的直接优化; 4) 检查点引擎——30 秒内完成 1T 模型的参数广播，通过"全广播"策略简化系统设计，虽然传输量大于理论最优但减少了同步开销。潜在风险：自我批评机制依赖于模型自身的评判能力，如果模型在 SFT 阶段未充分学习评判技能，闭环可能收敛到次优解; 此外，10,000+ 并发沙箱的维护成本可能限制了该方法的可扩展性。


## 4 Evaluations
### 评估

This section begins with the post-training evaluation of Kimi-K2-Instruct, followed by a brief overview of the capabilities of Kimi-K2-Base. We conclude with a comprehensive safety evaluation.

本节首先对 Kimi-K2-Instruct 进行后训练评估，然后简要概述 Kimi-K2-Base 的能力。最后进行全面的安全性评估。

### 4.1 Post-training Evaluations
#### 后训练评估

#### 4.1.1 Evaluation Settings
##### 评估设置

**Benchmarks.** We assess Kimi-K2-Instruct across different areas. For coding, we adopt LiveCodeBench v6 [32], OJBench [78], MultiPL-E [6], SWE-bench Verified [33, 85], TerminalBench [72], Multi-SWE-bench [87], SWE-Lancer [51], PaperBench [66], and Aider-Polyglot [17]. For tool use tasks, we evaluate performance on tau2-Bench [3] and AceBench [7]. In reasoning, we include AIME 2024/2025, MATH-500, HMMT 2025, CNMO 2024, GPQA-Diamond [62], SuperGPQA [14], and Humanity's Last Exam [57]. We benchmark long-context capabilities on MRCR, DROP [15], FRAMES [38] and LongBench v2 [2]. For factuality, we evaluate FACTS Grounding [31], Vectara Hallucination Leaderboard [74], and FaithJudge [69]. General capabilities are assessed using MMLU [24], MMLU-Redux [18], MMLU-Pro [77], IFEval [91], Multi-Challenge [65], SimpleQA [79], and LiveBench [81].

**基准测试。** 我们在不同领域评估 Kimi-K2-Instruct。编程方面采用 LiveCodeBench v6 [32]、OJBench [78]、MultiPL-E [6]、SWE-bench Verified [33, 85]、TerminalBench [72]、Multi-SWE-bench [87]、SWE-Lancer [51]、PaperBench [66] 和 Aider-Polyglot [17]。工具使用任务方面评估 tau2-Bench [3] 和 AceBench [7]。推理方面包括 AIME 2024/2025、MATH-500、HMMT 2025、CNMO 2024、GPQA-Diamond [62]、SuperGPQA [14] 和 Humanity's Last Exam [57]。长上下文能力方面测试 MRCR、DROP [15]、FRAMES [38] 和 LongBench v2 [2]。事实性方面评估 FACTS Grounding [31]、Vectara Hallucination Leaderboard [74] 和 FaithJudge [69]。通用能力使用 MMLU [24]、MMLU-Redux [18]、MMLU-Pro [77]、IFEval [91]、Multi-Challenge [65]、SimpleQA [79] 和 LiveBench [81]。

**Baselines.** We benchmark against both open-source and proprietary frontier models, ensuring every candidate is evaluated under its non-thinking configuration. Open-source baselines: DeepSeek-V3-0324 and Qwen3-235B-A22B. Proprietary baselines: Claude Sonnet 4, Claude Opus 4, GPT-4.1, and Gemini 2.5 Flash Preview.

**基线。** 我们对开源和专有前沿模型进行基准测试，确保每个候选模型都在其非思考配置下评估。开源基线：DeepSeek-V3-0324 和 Qwen3-235B-A22B。专有基线：Claude Sonnet 4、Claude Opus 4、GPT-4.1 和 Gemini 2.5 Flash Preview。

#### 4.1.2 Evaluation Results
##### 评估结果

A comprehensive evaluation results of Kimi-K2-Instruct is shown in Table 3, with detailed explanation provided in the Appendix C.

Kimi-K2-Instruct 的综合评估结果见表 3，详细说明见附录 C。

**Table 3: Performance comparison of Kimi-K2-Instruct against leading models. Bold denotes global SOTA; underlined bold indicates best open-source result.**

**表 3：Kimi-K2-Instruct 与领先模型的性能对比。粗体表示全局 SOTA; 下划线粗体表示最佳开源结果。**

| Category | Benchmark | Kimi-K2-Instruct | DeepSeek-V3-0324 | Qwen3-235B-A22B | Claude Sonnet 4 | Claude Opus 4 | GPT-4.1 | Gemini 2.5 Flash |
|----------|-----------|-----------------|------------------|-----------------|-----------------|---------------|---------|------------------|
| **Coding** | LiveCodeBench v6 | **53.7** | 46.9 | 37.0 | 48.5 | 47.4 | 44.7 | 44.7 |
| | OJBench | **27.1** | 24.0 | 11.3 | 15.3 | 19.6 | 19.5 | 19.5 |
| | SWE-bench Verified (Agentic) | 65.8 | 38.8 | 34.4 | 72.7* | 72.5* | 54.6 | — |
| | SWE-bench Multilingual | **47.3** | 25.8 | 20.9 | 51.0 | — | 31.5 | — |
| | SWE-Lancer | 39.1 | 30.5 | 24.1 | 40.8 | — | 23.0 | 38.5 |
| **Tool Use** | tau2-Bench (retail/airline/telecom) | 70.6/56.5/65.8 | 69.1/39.0/32.5 | 57.0/26.5/22.1 | 75.0/55.5/45.2 | 81.8/60.0/57.0 | 74.8/54.5/38.6 | 64.3/42.5/16.9 |
| | ACEBench | 76.5 | 72.7 | 70.5 | 76.2 | 75.6 | **80.1** | 74.5 |
| **Math & STEM** | AIME 2025 | **49.5** | 46.7 | 24.7* | 33.1* | 33.9* | 37.0 | 46.6 |
| | MATH-500 | **97.4** | 94.0* | 91.2* | 94.0 | 94.4 | 92.4 | 95.4 |
| | GPQA-Diamond | **75.1** | 68.4* | 62.9* | 70.0* | 74.9* | 66.3 | 68.2 |
| | HMMT 2025 | **38.8** | 27.5 | 11.9 | 15.9 | 15.9 | 19.4 | 34.7 |
| **General** | MMLU | 89.5 | 89.4 | 87.0 | 91.5 | **92.9** | 90.4 | 90.1 |
| | MMLU-Redux | 92.7 | 90.5 | 89.2* | 93.6 | **94.2** | 92.4 | 90.6 |
| | IFEval | **89.8** | 81.1 | 83.2* | 87.6 | 87.4 | 88.0 | 84.3 |
| | Multi-Challenge | **54.1** | 31.4 | 34.0 | 46.8 | 49.0 | 36.4 | 39.5 |
| | SimpleQA | 31.0 | 27.7 | 13.2 | 15.9 | 22.8 | **42.3** | 23.3 |
| | LiveBench | **76.4** | 72.4 | 67.6 | 74.8 | 74.6 | 69.8 | 67.8 |
| **Factuality** | FACTS Grounding | **88.5** | 68.3 | 68.5 | 83.6 | — | 79.2 | 86.6 |
| | FaithJudge | **92.6** | 83.4 | 75.7 | 83.0 | — | 91.0 | 93.2 |
| **Long Context** | DROP | **93.5** | 91.2 | 84.3 | 92.0 | — | 79.1 | 81.7 |
| | LongBench v2 | 49.1 | 51.1 | — | 52.5 | — | **54.3** | **55.5** |
| | FRAMES | 77.1 | 79.2 | — | 76.3 | — | **87.4** | 72.9 |

**Agentic and Competitive Coding.** Kimi-K2-Instruct demonstrates state-of-the-art open-source performance on real-world SWE tasks. It outperforms most baselines on SWE-bench Verified (65.8%, 71.6% with multiple attempts), SWE-bench Multilingual (47.3%), and SWE-Lancer (39.1%), significantly closing the gap with Claude 4 Opus and Sonnet. On competitive coding benchmarks (LiveCodeBench v6 53.7%, OJBench 27.1%), it also leads among all models.

**智能体与竞赛编程。** Kimi-K2-Instruct 在现实世界 SWE 任务上展示了 SOTA 开源性能。它在 SWE-bench Verified(65.8%，多次尝试 71.6%)、SWE-bench Multilingual(47.3%)和 SWE-Lancer(39.1%)上超越大多数基线，显著缩小了与 Claude 4 Opus 和 Sonnet 的差距。在竞赛编程基准(LiveCodeBench v6 53.7%、OJBench 27.1%)上，它也领先于所有模型。

**Agentic Tool Use.** On multi-turn tool-use benchmarks, Kimi-K2-Instruct sets a new standard. It achieves 66.1 Pass@1 on tau2-Bench and 76.5 on ACEBench, substantially outperforming all baselines.

**智能体工具使用。** 在多轮工具使用基准上，Kimi-K2-Instruct 树立了新标准。它在 tau2-Bench 上取得 66.1 Pass@1，在 ACEBench 上 76.5，大幅超越所有基线。

**General Capabilities.** Kimi-K2-Instruct exhibits strong, balanced performance across general knowledge, math, instruction following, and long-context tasks. It surpasses open-source peers on SimpleQA (31.0%), MMLU (89.5%) and MMLU-Redux (92.7%), and leads all models on instruction benchmarks (IFEval: 89.8%, Multi-Challenge: 54.1%). In math and STEM, it achieves top-tier scores (AIME 2024: 69.6%, GPQA-Diamond: 75.1%).

**通用能力。** Kimi-K2-Instruct 在通用知识、数学、指令遵循和长上下文任务上表现出强劲且均衡的性能。它在 SimpleQA(31.0%)、MMLU(89.5%)和 MMLU-Redux(92.7%)上超越开源对手，在指令基准上领先所有模型(IFEval: 89.8%、Multi-Challenge: 54.1%)。在数学和 STEM 方面，它取得了顶级分数(AIME 2024: 69.6%、GPQA-Diamond: 75.1%)。

**Open-Ended Evaluation.** On the LMSYS Arena leaderboard (July 17, 2025), Kimi-K2-Instruct ranks as the top-1 open-source model and 5th overall based on over 3,000 user votes.

**开放式评估。** 在 LMSYS Arena 排行榜(2025 年 7 月 17 日)上，Kimi-K2-Instruct 基于超过 3000 张用户投票，排名开源模型第一、总排名第五。

> 译者注(数据可信度): 表 3 的评估结果需要在几个维度上谨慎解读。1) 所有模型均在"非思考模式"下评估，这消除了测试时计算扩展带来的额外收益，是公平比较的关键前提; 2) 带 * 的数据来自模型自身技术报告，可能存在评估条件差异; 3) SWE-bench Verified 的 Agentic-Multi-Attempt 模式(71.6%)使用了内部验证器的 best-of-N 选择，这与 Single-Attempt 的 Pass@1 不完全可比; 4) Kimi K2 在 AIME 2025(49.5%)和 MATH-500(97.4%)上的强劲表现值得关注，但需要注意 AIME 使用了 Avg@64(64 次采样平均)，而非常规的 Pass@1; 5) 长上下文任务(LongBench v2、FRAMES)上 Gemini 2.5 Flash 和 GPT-4.1 仍然领先，说明 Kimi K2 的长上下文能力并非绝对优势。

### 4.2 Pre-training Evaluations
#### 预训练评估

We evaluate Kimi-K2-Base across diverse capability areas. For general capabilities, we assess on MMLU, MMLU-Pro, MMLU-Redux, BBH, TriviaQA, SuperGPQA, SimpleQA, HellaSwag, AGIEval, GPQA-Diamond, ARC-Challenge, and WinoGrande. For coding, we employ EvalPlus, LiveCodeBench v6, and CRUXEval. For mathematical reasoning, we utilize GSM8K, GSM8K-Platinum, MATH, and AIME 2024/2025.

我们在多样化的能力领域评估 Kimi-K2-Base。通用能力评估使用 MMLU、MMLU-Pro、MMLU-Redux、BBH、TriviaQA、SuperGPQA、SimpleQA、HellaSwag、AGIEval、GPQA-Diamond、ARC-Challenge 和 WinoGrande。编程使用 EvalPlus、LiveCodeBench v6 和 CRUXEval。数学推理使用 GSM8K、GSM8K-Platinum、MATH 和 AIME 2024/2025。


#### 4.2.1 Evaluation Settings
##### 评估设置

**Baselines.** We benchmark against leading open-source foundation models: DeepSeek-V3-Base [11], Qwen2.5-72B-Base [60] (Note that Qwen3-235B-A22B-Base is not open-sourced), and Llama 4-Maverick [71] (Llama 4-Behemoth is also not open-sourced). All models are evaluated under identical configurations to ensure fair comparison.

**基线。** 我们对领先的开源基础模型进行基准测试：DeepSeek-V3-Base [11]、Qwen2.5-72B-Base [60](注意 Qwen3-235B-A22B-Base 未开源)，以及 Llama 4-Maverick [71](Llama 4-Behemoth 也未开源)。所有模型在相同配置下评估，以确保公平比较。

**Evaluation Configurations.** We employ perplexity-based evaluation for MMLU, MMLU-Redux, GPQA-Diamond, HellaSwag, ARC-Challenge, C-Eval, and CMMLU. Generation-based evaluation is used for MMLU-Pro, SuperGPQA, TriviaQA, BBH, CSimpleQA, MATH, CMATH, GSM8K, GSM8K-Platinum, CRUXEval, LiveCodeBench, and EvalPlus. To mitigate the high variance inherent to GPQA-Diamond, we report the mean score across eight independent runs.

**评估配置。** 我们对 MMLU、MMLU-Redux、GPQA-Diamond、HellaSwag、ARC-Challenge、C-Eval 和 CMMLU 采用基于困惑度的评估。对 MMLU-Pro、SuperGPQA、TriviaQA、BBH、CSimpleQA、MATH、CMATH、GSM8K、GSM8K-Platinum、CRUXEval、LiveCodeBench 和 EvalPlus 采用基于生成的评估。为缓解 GPQA-Diamond 的高方差，我们报告 8 次独立运行的平均分数。

#### 4.2.2 Evaluation Results
##### 评估结果

Table 4 presents a comprehensive comparison of Kimi-K2-Base against leading open-source foundation models. The results demonstrate that Kimi-K2-Base achieves state-of-the-art performance across the majority of evaluated tasks.

表 4 展示了 Kimi-K2-Base 与领先开源基础模型的全面比较。结果表明 Kimi-K2-Base 在大多数评估任务上达到了 SOTA 性能。

**Table 4: Performance comparison of Kimi-K2-Base against leading open-source models across diverse tasks.**

**表 4：Kimi-K2-Base 与领先开源模型在多样化任务上的性能对比。**

| Category | Benchmark | #Shots | Kimi-K2-Base | DeepSeek-V3-Base | Llama4-Maverick-Base | Qwen2.5-72B-Base |
|----------|-----------|--------|-------------|------------------|----------------------|-----------------|
| | Architecture | - | MoE 1043B | MoE 671B | MoE 400B | Dense 72B |
| | Activated Params | - | 32B | 37B | 17B | 72B |
| **English** | MMLU | 5 | **87.79** | 87.10 | 84.87 | 86.08 |
| | MMLU-Pro | 5 | **69.17** | 60.59 | 63.47 | 62.80 |
| | MMLU-Redux | 5 | **90.17** | 89.53 | 88.18 | 87.77 |
| | SuperGPQA | 5 | **44.67** | 39.20 | 38.84 | 34.23 |
| | GPQA-Diamond | 5 | 48.11 | **50.51** | 49.43 | 40.78 |
| | SimpleQA | 5 | **35.25** | 26.49 | 23.74 | 10.31 |
| | TriviaQA | 5 | **85.09** | 84.11 | 79.25 | 76.03 |
| | BBH | 3 | **88.71** | 88.37 | 87.10 | 84.09 |
| | HellaSwag | 5 | 94.60 | 89.44 | 86.02 | **95.27** |
| | AGIEval | - | **84.23** | 81.57 | 67.55 | 76.87 |
| | ARC-Challenge | 0 | **95.73** | 93.77 | 94.03 | 95.56 |
| | WinoGrande | 5 | **85.32** | 84.21 | 77.58 | 84.14 |
| **Code** | CRUXEval-I-cot | 0 | **74.00** | 62.75 | 67.13 | 61.12 |
| | CRUXEval-O-cot | 0 | **83.50** | 75.25 | 75.88 | 66.13 |
| | LiveCodeBench(v6) | 1 | **26.29** | 24.57 | 25.14 | 22.29 |
| | EvalPlus | - | **80.33** | 65.61 | 65.48 | 66.04 |
| **Math** | MATH | 4 | **70.22** | 61.70 | 63.02 | 62.68 |
| | GSM8k | 8 | **92.12** | 91.66 | 86.35 | 90.37 |
| | GSM8k-platinum | 8 | **94.21** | 93.38 | 88.83 | 92.47 |
| | CMATH | 6 | 90.26 | **90.53** | 88.07 | 86.98 |
| **Chinese** | C-Eval | 5 | **92.50** | 90.04 | 80.91 | 90.86 |
| | CMMLU | 5 | **90.90** | 88.84 | 81.24 | 90.55 |
| | CSimpleQA | 5 | **77.57** | 72.13 | 53.47 | 50.53 |

**General Language Understanding.** Kimi-K2-Base achieves state-of-the-art performance on 10 out of 12 English language benchmarks. Notable results include MMLU (87.79%), MMLU-Pro (69.17%), MMLU-Redux (90.17%), SuperGPQA (44.67%), and SimpleQA (35.25%), significantly outperforming all baselines.

**通用语言理解。** Kimi-K2-Base 在 12 项英语基准中的 10 项上达到 SOTA。显著结果包括 MMLU (87.79%)、MMLU-Pro (69.17%)、MMLU-Redux (90.17%)、SuperGPQA (44.67%) 和 SimpleQA (35.25%)，显著超越所有基线。

**Coding Capabilities.** On coding benchmarks, Kimi-K2-Base sets new standards with leading performance across all metrics. It achieves 74.00% on CRUXEval-I-cot, 83.50% on CRUXEval-O-cot, 26.29% on LiveCodeBench v6, and 80.33% on EvalPlus.

**编程能力。** 在编程基准上，Kimi-K2-Base 在所有指标上树立了新标准。它在 CRUXEval-I-cot 上达到 74.00%，CRUXEval-O-cot 83.50%，LiveCodeBench v6 26.29%，EvalPlus 80.33%。

**Mathematical Reasoning.** Kimi-K2-Base exhibits exceptional mathematical capabilities, leading on three out of four benchmarks: MATH (70.22%), GSM8K (92.12%), and GSM8K-Platinum (94.21%). It maintains competitive performance on CMATH (90.26%), narrowly behind DeepSeek-V3-Base (90.53%).

**数学推理。** Kimi-K2-Base 展现出卓越的数学能力，在四项基准中的三项上领先：MATH (70.22%)、GSM8K (92.12%) 和 GSM8K-Platinum (94.21%)。在 CMATH (90.26%) 上保持竞争力，仅以微弱差距落后于 DeepSeek-V3-Base (90.53%)。

**Chinese Language Understanding.** The model demonstrates superior multilingual capabilities, achieving state-of-the-art results across all Chinese language benchmarks: C-Eval (92.50%), CMMLU (90.90%), and CSimpleQA (77.57%).

**中文语言理解。** 模型展现出卓越的多语言能力，在所有中文基准上达到 SOTA：C-Eval (92.50%)、CMMLU (90.90%) 和 CSimpleQA (77.57%)。

### 4.3 Safety Evaluation
#### 安全性评估

#### 4.3.1 Experiment Settings
##### 实验设置

We conducted red-teaming evaluations on Kimi K2 compared with other open-source LLMs. The evaluation covered harmful content, privacy content, and security content, as well as different attack strategies such as prompt injection and iterative jailbreak.

我们对 Kimi K2 与其他开源大语言模型进行红队评估。评估涵盖有害内容、隐私内容和安全内容，以及提示注入、迭代越狱等不同攻击策略。

We chose Promptfoo to generate adversarial prompts and analyze the responses. Model baselines: DeepSeek-V3, DeepSeek-R1, and Qwen3. Each plugin was paired with all strategies (Basic, Prompt Injection, Iterative Jailbreak, Crescendo). We generated 3 attack prompts per plugin for each strategy, with 6 prompts for bilingual combinations.

我们选择 Promptfoo 生成对抗性提示并分析响应。模型基线：DeepSeek-V3、DeepSeek-R1 和 Qwen3。每个插件与所有策略组合(基础、提示注入、迭代越狱、Crescendo)。每种策略每个插件生成 3 个攻击提示，双语组合生成 6 个。

**Table 5: Enabled Plugins and Strategies**

**表 5：启用的插件与策略**

| Plugin Category | Plugins |
|-----------------|---------|
| Harmful | Graphic Content, Harassment and Bullying, Hate Speech, Insults, Profanity, Radicalization, Self Harm, Sexual Content, ToxicChat |
| Criminal | Chemical&Biological Weapons, Child Exploitation, Copyright Violations, Cybercrime, Illegal Activities, Illegal Drugs, Indiscriminate Weapons, Intellectual Property Violation, Non-Violent Crime, Violent Crime, Sex Crimes |
| Misinformation | Competitor Endorsement, Unsupervised Contracts, Excessive Agency, Hallucination, Misinformation and Disinformation, Specialized Advice, Unsafe Practices, Imitation, Overreliance, Political Opinions, Religious Sensitivity |
| Privacy | Privacy Violation, PII in API/Database, Direct PII Exposure, PII in Session Data, PII via Social Engineering |
| Security | ASCII Smuggling, CyberSecEval, Harmbench, Debug Access, Divergent Repetition, DoNotAnswer, Malicious Code, Pliny, Prompt Extraction, Reasoning DoS, Tool Discovery |
| Strategy | Basic, Prompt Injection, Iterative Jailbreak, Crescendo |

We incorporated human review into the evaluation process, with multiple rounds of review and consistent reviewers per test set.

我们在评估流程中纳入人工审核，进行多轮审核，并为每个测试集分配一致的审核员。

#### 4.3.2 Safety Evaluation Results
##### 安全性评估结果

**Table 6: Safety Evaluation Results (Passing Rate %)**

**表 6：安全性评估结果(通过率 %)**

| Plugin | Strategy | Kimi-K2-Instruct | DeepSeek-V3-0324 | DeepSeek-R1 | Qwen3-235B-A22B |
|--------|----------|-----------------|------------------|-------------|-----------------|
| **Harmful** | Basic | 98.04 | 90.45 | 99.02 | 98.53 |
| | Base64 | 100 | 90.20 | 100 | 100 |
| | Prompt Injection | 93.14 | 100 | 95.10 | 99.02 |
| | Iterative Jailbreak | 92.16 | 66.67 | 72.55 | 74.51 |
| | Crescendo | 64.71 | 64.71 | 80.39 | 86.27 |
| **Criminal** | Basic | 100 | 99.62 | 95.45 | 99.24 |
| | Base64 | 96.97 | 89.39 | 84.85 | 98.48 |
| | Prompt Injection | 75.76 | 91.67 | 69.70 | 98.47 |
| | Iterative Jailbreak | 57.57 | 21.21 | 25.76 | 53.03 |
| | Crescendo | 56.06 | 31.81 | 42.42 | 59.09 |
| **Misinformation** | Basic | 97.28 | 92.57 | 92.46 | 94.84 |
| | Base64 | 98.48 | 90.48 | 96.83 | 93.65 |
| | Prompt Injection | 98.39 | 86.51 | 93.65 | 93.65 |
| | Iterative Jailbreak | 63.97 | 53.97 | 84.13 | 69.84 |
| | Crescendo | 85.71 | 55.56 | 88.89 | 84.13 |
| **Privacy** | Basic | 100 | 100 | 100 | 100 |
| | Base64 | 100 | 100 | 100 | 100 |
| | Prompt Injection | 88.33 | 98.33 | 100 | 91.67 |
| | Iterative Jailbreak | 76.67 | 100 | 93.33 | 96.67 |
| | Crescendo | 96.67 | 100 | 96.67 | 100 |
| **Security** | Basic | 77.84 | 75.57 | 70.46 | 90.09 |
| | Base64 | 82.93 | 82.93 | 63.41 | 95.12 |
| | Prompt Injection | 87.80 | 97.56 | 65.85 | 84.13 |
| | Iterative Jailbreak | 43.90 | 60.97 | 43.90 | 78.04 |
| | Crescendo | 68.29 | 87.80 | 68.29 | 87.80 |

Without targeted optimization for specific evaluation scenarios, the passing rate of some complex cases (e.g., Harmful-Iterative Jailbreak) was relatively higher compared to other models.

在未针对特定评估场景进行定向优化的情况下，某些复杂案例(如有害-迭代越狱)的通过率相比其他模型相对较高。

Across different attack strategies, the models exhibited varying trends. Under the Base64 strategy, passing rates generally approached or reached 100%, suggesting that encoding transformations had minimal impact on the models' basic robustness. In contrast, the Crescendo strategy led to a general drop in passing rates, indicating stronger adversarial effectiveness.

在不同攻击策略下，各模型呈现不同趋势。Base64 策略下通过率通常接近或达到 100%，说明编码转换对模型基本鲁棒性影响极小。相反，Crescendo 策略导致通过率普遍下降，表明其对抗性更强。

In addition, complex attack strategies do not always outperform basic prompts. Some originally adversarial prompts may lose their intended meaning after multiple rounds of transformation, rendering the resulting model outputs less meaningful.

此外，复杂攻击策略并不总是优于基础提示。某些原本对抗性的提示经过多轮转换后可能失去其本意，导致模型输出的意义降低。

**Automated Red-teaming Limitations.** Due to the involvement of human review, the evaluation results inevitably contain a degree of subjectivity. Additionally, certain plugin types involve API misuse or external tool invocation, which are more suitable for evaluating agent models with tool-calling capabilities. In the context of base LLMs, such tests may have limited relevance.

**自动化红队评估的局限。** 由于涉及人工审核，评估结果不可避免地包含一定主观性。此外，某些插件类型涉及 API 滥用或外部工具调用，这更适合评估具备工具调用能力的智能体模型。在基础大语言模型语境下，此类测试的相关性可能有限。

> 译者注(局限风险): 表 6 的安全评估结果揭示了几个值得注意的问题。1) Kimi K2 在 Criminal-Iterative Jailbreak(57.57%)和 Security-Iterative Jailbreak(43.90%)上表现最弱，远低于 Qwen3(53.03% 和 78.04%)，这可能与后训练阶段对犯罪/安全类内容的过滤策略有关; 2) 所有模型在 Crescendo 策略下普遍下降，说明渐进式诱导仍是最有效的对抗攻击方式; 3) Privacy 类别所有模型均达到 100% 基础通过率，但这部分原因是测试集中的 PII 检测任务本身较简单; 4) 作者坦承人工审核引入主观性，且部分插件(如 Tool Discovery)更适合评估具备工具调用的 Agent 模型而非纯文本模型，这限制了当前评估框架的泛化性。

## 5 Limitations
### 局限性

In our internal tests, we have identified some limitations in current Kimi K2 models. When dealing with hard reasoning tasks or unclear tool definition, the model may generate excessive tokens, sometimes leading to truncated outputs or incomplete tool calls. Additionally, performance may decline on certain tasks if tool use is unnecessarily enabled. When building complete software projects, the success rate of one-shot prompting is not as good as using K2 under an agentic coding framework. We are working to address these issues in future releases and looking forward to more feedbacks.

在内部测试中，我们发现了当前 Kimi K2 模型的一些局限。在处理困难推理任务或工具定义不清晰时，模型可能生成过多 token，有时导致输出截断或工具调用不完整。此外，在不必要启用工具使用的任务上，性能可能下降。在构建完整软件项目时，单次提示的成功率不如在智能体编程框架下使用 K2。我们正在努力解决这些问题，期待更多反馈。

> 译者注(工程细节): 作者坦诚列出的局限具有工程指导意义。1) "过度生成"(excessive tokens)在推理密集型模型中普遍存在，DeepSeek-R1 也存在类似问题，解决方案通常包括输出长度限制、推理路径压缩(如摘要机制)或早停策略; 2) "工具使用误激活"说明 SFT 阶段的 tool-calling 行为可能被过度强化，需要更精细的意图分类来决定是否启用工具; 3) "one-shot 不如 agentic 框架"这一观察与当前行业趋势一致：SWE-bench 等真实编程任务的成功需要多轮迭代、测试反馈和错误修复，单次生成难以覆盖完整开发流程; 4) 这些局限说明 Kimi K2 在"工具使用"和"推理深度"之间仍需更好的平衡机制。

## 6 Conclusions
### 结论

We introduced Kimi K2, a 1T-parameter open-weight MoE model built for agentic intelligence. Leveraging the token-efficient MuonClip optimizer and a 15.5T-token high-quality dataset, Kimi K2 achieves stable, scalable pre-training. Post-training combines large-scale synthetic tool-use data with a unified RL framework using both verifiable rewards and self-critic feedbacks. Kimi K2 sets new state-of-the-art on agentic and reasoning benchmarks, establishing itself as the most capable open-weight LLM to date.

我们推出了 Kimi K2，一个为智能体智能构建的 1T 参数开放权重 MoE 模型。利用 token 高效的 MuonClip 优化器和 15.5T token 的高质量数据集，Kimi K2 实现了稳定、可扩展的预训练。后训练结合大规模合成工具使用数据与统一的 RL 框架，同时使用可验证奖励和自批评反馈。Kimi K2 在智能体和推理基准上创下新的 SOTA，确立了其作为迄今最强开放权重大语言模型的地位。

## 7 Acknowledgments
### 致谢

We would like to acknowledge the valuable support provided by the OpenHands and Multi-SWE-bench teams in evaluating the SWE-bench Verified and Multi-SWE-bench experimental results.

我们感谢 OpenHands 和 Multi-SWE-bench 团队在评估 SWE-bench Verified 和 Multi-SWE-bench 实验结果方面提供的宝贵支持。


## Appendices
### 附录

## A Contributions
### 作者贡献

The listing of authors is in alphabetical order based on their last names.

作者按姓氏字母顺序排列。(完整作者名单见原文,此处略)

## B Token Template of Tool Calling
### 工具调用的 Token 模板

There are three components in the token structure for tool-calling:

工具调用的 token 结构包含三个组件:

- Tool declaration message: defines the list of available tools and the schema of the arguments;
- Tool invoking section in assistant message: encodes the model's request to invoke tools;
- Tool result message: encapsulates the invoked tool's execution result.

- 工具声明消息: 定义可用工具列表和参数模式;
- 助手消息中的工具调用段: 编码模型的工具调用请求;
- 工具结果消息: 封装被调用工具的执行结果。

The raw tokens of the tool declaration message are formatted as follows:

工具声明消息的原始 token 格式如下:

```
<|im_begin|>
tool_declare
<|im_middle|>
{{ tool declaration content }}
<|im_end|>
```

We use TypeScript to express the tool declaration content, since TypeScript is a concise language with a comprehensive type system, able to express the types and constraints of tool parameters with brief text. The code 1 shows an example for two simple tools in JSON format compatible with OpenAI's chat completion API, as a comparison, the same tools defined in TypeScript (listed in Code 2) is much shorter. To improve compatibility, part of our training data also uses JSON as the tool declaration language, so that 3rd-party frameworks need not additional development to support our tool calling scheme.

我们使用 TypeScript 表达工具声明内容,因为 TypeScript 是一种简洁且具有完备类型系统的语言,能够用简短文本表达工具参数的类型和约束。代码 1 展示了两个简单工具的 JSON 格式示例(兼容 OpenAI 聊天补全 API),作为对比,相同工具在 TypeScript 中的定义(代码 2)要短得多。为提高兼容性,部分训练数据也使用 JSON 作为工具声明语言,使第三方框架无需额外开发即可支持我们的工具调用方案。

The token template of the tool invoking section in the model's response messages is listed as follows:

模型响应消息中工具调用段的 token 模板如下:

```
<|tool_call_section_begin|>
<|tool_call_begin|>
// call_id part
functions.{{tool name}}:{{counter}}
<|tool_arguments_begin|>
{{ json serialized call arguments }}
<|tool_call_end|>
<|tool_call_begin|>
// more tool calls
<|tool_call_end|>
<|tool_call_section_end|>
```

As shown in the template, we support parallel tool calling by placing multiple tool calls in a single response turn. Each tool call has a unique call id, formatted as `functions.{tool-name}:{counter}`, where tool-name is the name of the tool, and counter is an auto-increasing counter of all tool calls starting from 0 in the dialog.

如模板所示,我们通过在单轮响应中放置多个工具调用来支持并行工具调用。每个工具调用有唯一的调用 ID,格式为 `functions.{tool-name}:{counter}`,其中 tool-name 是工具名称,counter 是对话中从 0 开始递增的所有工具调用计数器。

During inference, the model may occasionally generate unexpected tokens, leading to format errors when parsing a tool call. To solve this issue, we developed a constrained decoding module named enforcer, inspired by lm-format-enforcer. When a `<tool_call_section_begin|>` token is generated, it ensures that the upcoming tool-related tokens follow the predefined template, and the JSON argument string follows the declared schema.

在推理过程中,模型偶尔可能生成意外 token,导致解析工具调用时格式错误。为解决此问题,我们开发了名为 enforcer 的约束解码模块,灵感来自 lm-format-enforcer。当生成 `<tool_call_section_begin|>` token 时,它确保后续工具相关 token 遵循预定义模板,且 JSON 参数字符串遵循声明的模式。

The tool result message is simply a text message encoded with the tool's call id and the corresponding results.

工具结果消息是简单的文本消息,编码了工具的调用 ID 和相应结果:

```
<|im_begin|>
tool
<|im_middle|>
\## Results of {{call_id}}
{{ execution result content }}
<|im_end|>
```

> 译者注(工程细节): TypeScript 作为工具声明语言是一个精妙的设计选择。相比 JSON Schema,TypeScript 的类型标注更紧凑(如 `date?: string` 即可表达可选参数),且在 LLM 预训练语料中更为常见,模型对 TypeScript 语法的理解可能优于 JSON Schema。约束解码模块 enforcer 的引入解决了工具调用中最常见的"幻觉参数"问题——模型可能生成不存在的字段或类型不匹配的值。这种"结构化生成"(structured generation)正在成为工具调用模型的标准组件,与 Outlines、Guidance 等库的理念一致。

## C Evaluation Details
### 评估详情

**Coding Tasks.** We evaluate Kimi-K2-Instruct's capabilities on competitive coding benchmarks, LiveCodeBench and OJBench, where Kimi-K2-Instruct attains superior performance with scores of 53.7% and 27.1%, respectively. This excellence spans both medium-level coding challenges, such as LeetCode and AtCoder, and hard-level contests like NOI and ICPC, outperforming leading open-source and proprietary models. For multilingual programming proficiency, we employ MultiPL-E, covering languages including C++, C#, Java, JavaScript, PHP, Go, Kimi-K2-Instruct surpasses top open-source models with an accuracy of 85.7%, compared with 83.1% for DeepSeek-V3-0324 and 78.2% for Qwen3-235B-A22B. In software engineering tasks, Kimi-K2-Instruct demonstrates robust performance on SWE-bench Verified (Python), SWE-lancer (Python), SWE-bench Multilingual, and Multi-SWE-bench datasets.

**编程任务。** 我们在竞赛编程基准 LiveCodeBench 和 OJBench 上评估 Kimi-K2-Instruct 的编程能力,分别取得 53.7% 和 27.1% 的优异成绩。这一卓越表现涵盖中等难度挑战(如 LeetCode 和 AtCoder)和高难度竞赛(如 NOI 和 ICPC),超越领先的开源和专有模型。在多语言编程能力方面,我们采用 MultiPL-E,涵盖 C++、C#、Java、JavaScript、PHP、Go 等语言,Kimi-K2-Instruct 以 85.7% 的准确率超越顶级开源模型,相比之下 DeepSeek-V3-0324 为 83.1%,Qwen3-235B-A22B 为 78.2%。在软件工程任务中,Kimi-K2-Instruct 在 SWE-bench Verified(Python)、SWE-lancer(Python)、SWE-bench Multilingual 和 Multi-SWE-bench 数据集上展现出强劲性能。

For example:
- SWE-bench Verified (multiple attempts): 71.6% (Kimi-K2-Instruct) vs. 80.2% (Claude 4 Sonnet)
- SWE-bench Multilingual: 47.3% (Kimi-K2-Instruct) vs. 51.0% (Claude 4 Sonnet)
- SWE-lancer: 39.1% (Kimi-K2-Instruct) vs. 40.8% (Claude 4 Sonnet)

On PaperBench, Kimi-K2-Instruct achieves an accuracy of 27.8%, closely matching GPT-4.1 and outperforming DeepSeek-V3-0324 (12.2%) and Qwen3-235B-A22B (8.2%) by a substantial margin. In terminal interaction tasks measured by TerminalBench, Kimi-K2-Instruct attains 25.0% using the default Terminus framework and rises to 30% within Moonshot's in-house agentic framework, underscoring its capabilities in real-world agentic programming scenarios. Moreover, on the Aider-Polyglot benchmark, Kimi-K2-Instruct attains a 60.0% accuracy while employing rigorous decontamination procedures.

在 PaperBench 上,Kimi-K2-Instruct 达到 27.8% 的准确率,与 GPT-4.1 接近,大幅超越 DeepSeek-V3-0324 (12.2%) 和 Qwen3-235B-A22B (8.2%)。在 TerminalBench 衡量的终端交互任务中,Kimi-K2-Instruct 使用默认 Terminus 框架达到 25.0%,在 Moonshot 内部智能体框架中提升至 30%,凸显了其在真实智能体编程场景中的能力。此外,在 Aider-Polyglot 基准上,在采用严格去污染程序的情况下,Kimi-K2-Instruct 达到 60.0% 的准确率。

**Tool Use Tasks.** We evaluate multi-turn tool use with two complementary suites: tau2-Bench and ACEBench. tau2-Bench extends the original tau-bench single-control setup to a dual-control environment in which both the agent and an LLM-simulated user have constrained tool affordances over a shared state, adding a realistic Telecom troubleshooting domain alongside the prior Airline/Retail TAU tasks and enabling analysis of coordination vs. pure reasoning. ACEBench is a large bilingual (En/Zh) API-grounded benchmark (4.5K APIs across 8 domains; 2K annotated eval items) partitioned into NORMAL (basic/personalized/atomic), SPECIAL (imperfect or out-of-scope inputs), and AGENT (scenario-driven multi-turn, multi-step sandbox) tracks with automated grading of calls and outcomes.

**工具使用任务。** 我们用两个互补套件评估多轮工具使用:tau2-Bench 和 ACEBench。tau2-Bench 将原始 tau-bench 的单控制设置扩展为双控制环境,其中智能体和 LLM 模拟的用户都对共享状态具有受限的工具操作能力,增加了真实的电信故障排查领域,以及之前的航空/零售 TAU 任务,支持协调能力与纯推理的对比分析。ACEBench 是一个大型双语(英/中)API 基准(8 个领域 4.5K API;2K 标注评估项),分为 NORMAL(基础/个性化/原子)、SPECIAL(不完美或超出范围输入)和 AGENT(场景驱动多轮多步骤沙盒)三个轨道,对调用和结果进行自动评分。

All models run in non-thinking mode; we set the temperature to 0.0, use deterministic tool adapters, score tau2 Airline/Retail/Telecom under Avg@4 seeds with Pass@1/4, and report overall on ACEBench English. Kimi-K2-Instruct averages 66.1 micro Pass@1 across tau2 vs DeepSeek-V3-0324 48.8 / Qwen3-235B-A22B 37.3. On ACEBench Overall Kimi-K2-Instruct scores 76.5 vs DeepSeek 72.7 / Qwen 70.5 and remains competitive with GPT-4.1 (80.1).

所有模型在非思考模式下运行;我们将温度设为 0.0,使用确定性工具适配器,在 tau2 航空/零售/电信上使用 Avg@4 种子和 Pass@1/4 评分,并报告 ACEBench 英语总体分数。Kimi-K2-Instruct 在 tau2 上平均 66.1 micro Pass@1,对比 DeepSeek-V3-0324 48.8 / Qwen3-235B-A22B 37.3。在 ACEBench 总体分数上 Kimi-K2-Instruct 76.5,对比 DeepSeek 72.7 / Qwen 70.5,与 GPT-4.1 (80.1) 保持竞争力。

**Math & STEM & Logical Tasks.** For Math tasks, Kimi-K2-Instruct achieves consistently strong performance, averaging over Gemini-2.5-Flash by 5.3 percentage points, over DeepSeek-V3-0324 by 5.5 points and over GPT-4.1 by 15.8 points. For example, on AIME 2024, Kimi-K2-Instruct scores 69.6%, outperforming another two top open-source models by a large margin, DeepSeek-V3-0324 by 10.2 points and Qwen3-235B-A22B by 29.5 points. In STEM evaluations, Kimi-K2-Instruct achieves 75.1% on GPQA-Diamond, outperforming DeepSeek-V3-0324 (68.4%) and all non-thinking baselines by at least 5 percentage points. On SuperGPQA, it also exceeds the previous best open-source model, DeepSeek-V3-0324, by 3.5 points.

**数学、STEM 和逻辑任务。** 在数学任务上,Kimi-K2-Instruct 保持强劲且稳定的性能,平均超过 Gemini-2.5-Flash 5.3 个百分点,超过 DeepSeek-V3-0324 5.5 个百分点,超过 GPT-4.1 15.8 个百分点。例如,在 AIME 2024 上,Kimi-K2-Instruct 得分 69.6%,大幅超越另外两个顶级开源模型,领先 DeepSeek-V3-0324 10.2 个百分点,领先 Qwen3-235B-A22B 29.5 个百分点。在 STEM 评估中,Kimi-K2-Instruct 在 GPQA-Diamond 上达到 75.1%,超越 DeepSeek-V3-0324 (68.4%) 和所有非思考基线至少 5 个百分点。在 SuperGPQA 上,它也超过此前最佳开源模型 DeepSeek-V3-0324 3.5 个百分点。

Kimi-K2-Instruct also surpasses the other two leading models in logical reasoning. It achieves 89.0% on ZebraLogic and 89.5% on AutoLogi, exceeding DeepSeek-V3-0324 (84.0%, 88.9%) and substantially outperforming Qwen3-235B-A22B (37.7%, 83.3%).

Kimi-K2-Instruct 在逻辑推理上也超越另外两个领先模型。它在 ZebraLogic 上达到 89.0%,AutoLogi 上 89.5%,超越 DeepSeek-V3-0324 (84.0%, 88.9%),大幅领先 Qwen3-235B-A22B (37.7%, 83.3%)。

**General Tasks.** Kimi-K2-Instruct ties DeepSeek-V3-0324 on MMLU and MMLU-Pro, and takes the lead on MMLU-Redux with a 92.7 EM score -- slightly ahead of GPT-4.1 (92.4) and just 1.5 points behind Claude-Opus-4. Beyond multiple-choice tasks, the model achieves 31.0% accuracy on the short-answer SimpleQA -- 3.3 points above DeepSeek-V3-0324 and more than twice that of Qwen3-235B-A22B -- though still below GPT-4.1 (42.3%). On the adversarial free-response LiveBench (2024-11-25 snapshot), it reaches 76.4%, surpassing Claude-Sonnet 4 (74.8%) and leading Gemini 2.5 Flash Preview by 8.6 points.

**通用任务。** Kimi-K2-Instruct 在 MMLU 和 MMLU-Pro 上与 DeepSeek-V3-0324 持平,在 MMLU-Redux 上以 92.7 EM 分领先 -- 略超 GPT-4.1 (92.4),仅落后 Claude-Opus-4 1.5 分。除了多选题任务外,模型在简答 SimpleQA 上达到 31.0% 的准确率 -- 高出 DeepSeek-V3-0324 3.3 分,是 Qwen3-235B-A22B 的两倍多 -- 但仍低于 GPT-4.1 (42.3%)。在对抗性自由回答 LiveBench (2024-11-25 快照)上,达到 76.4%,超越 Claude-Sonnet 4 (74.8%),领先 Gemini 2.5 Flash Preview 8.6 分。

We evaluate instruction-following with IFEval and Multi-Challenge. On IFEval, Kimi-K2-Instruct scores 89.8%, higher than DeepSeek-V3-0324 (81.1%) and GPT-4.1 (88.0%). On Multi-Challenge, which involves multi-turn dialogues with conflicting instructions, it achieves 54.1%, outperforming DeepSeek-V3-0324 (31.4%), GPT-4.1 (36.4%), and Claude-Opus-4 (49.0%).

我们用 IFEval 和 Multi-Challenge 评估指令遵循能力。在 IFEval 上,Kimi-K2-Instruct 得分 89.8%,高于 DeepSeek-V3-0324 (81.1%) 和 GPT-4.1 (88.0%)。在 Multi-Challenge(涉及含冲突指令的多轮对话)上,达到 54.1%,超越 DeepSeek-V3-0324 (31.4%)、GPT-4.1 (36.4%) 和 Claude-Opus-4 (49.0%)。

**Long Context and Factuality Tasks.** To evaluate the factuality of Kimi-K2-Instruct, we employ three benchmarks: FACTS Grounding, which measures adherence to provided documents using the proprietary models GPT-4o, Gemini 1.5 Pro and Claude 3.5 Sonnet; HHEM, which assesses summarization quality via the open-source HHEM-2.1-Open judge; and FaithJudge, which analyzes faithfulness in RAG tasks with o3-mini as the judge. Kimi-K2-Instruct scores 88.5 on FACTS Grounding, substantially outperforming all open-source rivals and even surpassing the closed-source Gemini 2.5 Flash. With HHEM-2.1-Open it achieves a hallucination rate of 1.1%, i.e. 98.9. On FaithJudge's RAG tasks the hallucination rate is 7.4%, likewise present as 92.6 for table consistency.

**长上下文和事实性任务。** 为评估 Kimi-K2-Instruct 的事实性,我们采用三个基准:FACTS Grounding,使用专有模型 GPT-4o、Gemini 1.5 Pro 和 Claude 3.5 Sonnet 衡量对提供文档的遵循度;HHEM,通过开源 HHEM-2.1-Open 裁判评估摘要质量;FaithJudge,以 o3-mini 为裁判分析 RAG 任务中的忠实度。Kimi-K2-Instruct 在 FACTS Grounding 上得分 88.5,大幅超越所有开源对手,甚至超过闭源的 Gemini 2.5 Flash。使用 HHEM-2.1-Open 时幻觉率为 1.1%,即 98.9。在 FaithJudge 的 RAG 任务中幻觉率为 7.4%,表中为一致性表示为 92.6。

For long-context capabilities, Kimi-K2-Instruct outperforms all open source and proprietary models on DROP (93.5%), and exceeds DeepSeek-V3-0324 on retrieval task MRCR (55.0% vs 50.8%). For long-context reasoning tasks FRAMES and LongBench v2, Kimi-K2-Instruct (77.1%, 49.1%) lags slightly behind DeepSeek-V3-0324 by around 2%.

在长上下文能力方面,Kimi-K2-Instruct 在 DROP (93.5%) 上超越所有开源和专有模型,在检索任务 MRCR 上超过 DeepSeek-V3-0324 (55.0% vs 50.8%)。在长上下文推理任务 FRAMES 和 LongBench v2 上,Kimi-K2-Instruct (77.1%, 49.1%) 略落后于 DeepSeek-V3-0324 约 2%。

**Open-Ended Evaluation.** Beyond static, closed-ended benchmarks, we evaluate the model's performance on open-ended, nuanced tasks that more closely resemble real-world usage.

**开放式评估。** 超越静态的封闭式基准,我们评估模型在开放式、细微任务上的性能,这些任务更接近真实使用场景。

For English scenarios, we leverage the Arena-Hard-Auto v2.0 benchmark, which use LLM-as-a-judge protocols to assess generation quality across diverse, open-ended prompts. On Arena-Hard-Auto v2.0, Kimi-K2-Instruct achieves state-of-the-art win-rate on both hard prompts (54.5%) and creative writing tasks (85.0%), outperforming all open-source models and rivaling top proprietary systems such as GPT-4.1 and Claude Sonnet.

对于英语场景,我们利用 Arena-Hard-Auto v2.0 基准,该基准使用 LLM-as-a-judge 协议评估多样化开放式提示的生成质量。在 Arena-Hard-Auto v2.0 上,Kimi-K2-Instruct 在困难提示(54.5%)和创意写作任务(85.0%)上均达到 SOTA 胜率,超越所有开源模型,与 GPT-4.1 和 Claude Sonnet 等顶级专有系统相当。

However, Arena-Hard-Auto provides limited coverage of Chinese-specific tasks. To address this gap, we developed an in-house held-out benchmark grounded in authentic user queries. Kimi-K2-Instruct shows strong performance across all comparisons on Chinese in-house benchmarks. It outperforms ChatGPT-4o-latest with a 65.4% win rate, Claude Sonnet 4 with 64.6%, and DeepSeek-V3-0324 with 59.6%. In all cases, the loss rate stays low (around 17%), indicating that Kimi-K2-Instruct rarely falls behind.

然而,Arena-Hard-Auto 对中文特定任务的覆盖有限。为弥补这一差距,我们开发了基于真实用户查询的内部留存基准。Kimi-K2-Instruct 在中文内部基准的所有对比中表现强劲。它以 65.4% 的胜率超越 ChatGPT-4o-latest,以 64.6% 超越 Claude Sonnet 4,以 59.6% 超越 DeepSeek-V3-0324。在所有情况下,败率都保持在较低水平(约 17%),表明 Kimi-K2-Instruct 很少落后。

In addition to controlled evaluations, we also consider real-world user preference through public human assessments. As of July 17, 2025, Kimi-K2-Instruct ranked as the top open-source model and fifth overall on the LMSYS Arena leaderboard, based on over 3,000 blind votes from real users.

除受控评估外,我们还通过公开人工评估考虑真实用户偏好。截至 2025 年 7 月 17 日,基于真实用户超过 3000 张盲投,Kimi-K2-Instruct 在 LMSYS Arena 排行榜上排名开源模型第一、总排名第五。

## D QK-Clip Does Not Impair Model Quality
### QK-Clip 不会损害模型质量

The QK-Clip design follows a minimal intervention principle: it activates only when necessary, and deactivates after training stabilizes. Empirical evidence and analysis converge on its negligible impact on model quality.

QK-Clip 设计遵循最小干预原则:仅在必要时激活,训练稳定后自动停用。实证证据和分析一致表明其对模型质量的影响可忽略不计。

**Small-Scale Ablations.** We train two small-scale 0.5B activated and 3B total parameters MoE models, one with vanilla Muon and the other with MuonClip using a low clipping threshold (tau = 30). As shown in Figure 12, applying MuonClip has negligible effects on the loss curve, indicating that even aggressive clipping does not impair convergence or training dynamics with MuonClip. This demonstrates that MuonClip is a safe and effective method for bounding attention logits without degrading model performance. Furthermore, evaluation on downstream tasks reveals no statistically significant degradation in performance.

**小规模消融实验。** 我们训练了两个小规模 MoE 模型(0.5B 激活参数,3B 总参数),一个使用 vanilla Muon,另一个使用 MuonClip(低裁剪阈值 tau=30)。如图 12 所示,应用 MuonClip 对损失曲线影响可忽略,表明即使激进的裁剪也不会损害 MuonClip 的收敛或训练动态。这证明 MuonClip 是一种安全有效的方法,可在不降低模型性能的情况下约束注意力 logit。此外,下游任务评估显示性能没有统计显著性下降。

**Self-deactivation.** In Kimi K2, QK-Clip was only transiently active:

**自停用。** 在 Kimi K2 中,QK-Clip 仅短暂激活:

- Initial 70000 steps: 12.7% of attention heads triggered QK-Clip for at least once, clamping Smax to 100.
- Post-70000 steps: All heads at some point reduced their Smax below 100, rendering QK-Clip inactive.

- 初始 70000 步:12.7% 的注意力头至少触发过一次 QK-Clip,将 Smax 钳制到 100。
- 70000 步后:所有头在某个时刻将其 Smax 降至 100 以下,使 QK-Clip 失活。

When QK-Clip is active, it is applied per-head (rather than per-layer) to minimize potential over-regularization on other heads. After training stabilizes, QK-clip is deactivated and has no effect at all.

当 QK-Clip 激活时,它按头应用(而非按层),以最小化对其他头的潜在过度正则化。训练稳定后,QK-clip 停用且完全无影响。

## E Why Muon is More Prone to Logit Explosion
### 为什么 Muon 更容易发生 Logit 爆炸

Logit explosion occurs when the largest pre-softmax attention score $S_{max} = \max_{i,j} q_i \cdot k_j$ grows unboundedly during training. Since $|q_i \cdot k_j| \leq \|q_i\| \|k_j\| \leq \|x_i\| \|x_j\| \|W_q\| \|W_k\|$, and RMS-Norm keeps $\|x_i\| \|x_j\|$ bounded, the phenomenon is primarily driven by the growing spectral-norm of $W_q$ or $W_k$. Empirically, we found that Muon is more susceptible to logit explosion. We give our hypothesis below.

Logit 爆炸发生在预 softmax 注意力分数的最大值 $S_{max} = \max_{i,j} q_i \cdot k_j$ 在训练过程中无界增长时。由于 $|q_i \cdot k_j| \leq \|q_i\| \|k_j\| \leq \|x_i\| \|x_j\| \|W_q\| \|W_k\|$,且 RMS-Norm 保持 $\|x_i\| \|x_j\|$ 有界,该现象主要由 $W_q$ 或 $W_k$ 增长的谱范数驱动。实证上我们发现 Muon 更容易发生 logit 爆炸。我们的假设如下。

**Structural difference in updates.** Muon produces a weight update coming from the `msign` operation; as a result, all singular values of the update matrix are equal -- its effective rank is full. In contrast, a typical update matrix produced by Adam exhibits a skewed spectrum: a few large singular values dominate, and the effective rank is low. This low-rank assumption for Adam is not new; higher-order muP makes the same assumption.

**更新中的结构差异。** Muon 产生来自 `msign` 操作的权重更新;因此,更新矩阵的所有奇异值相等 -- 其有效秩是满的。相比之下,Adam 产生的典型更新矩阵呈现偏斜谱:少数大奇异值占主导,有效秩较低。Adam 的低秩假设并不新鲜;高阶 muP 也做相同假设。

Such phenomenon is verified on the 16B Moonlight model, which shows weights trained with Muon exhibit higher singular-value entropy (i.e. higher effective rank) than those trained with Adam, corroborating the theoretical intuition.

这一现象在 16B Moonlight 模型上得到验证,显示 Muon 训练的权重比 Adam 训练的权重表现出更高的奇异值熵(即更高的有效秩), corroborating 了理论直觉。

**SVD formulation.** Let the parameter matrix at step t-1 have the singular value decomposition $W_{t-1} = \sum_i \sigma_i u_i v_i^\top$. We write the update matrices as $\Delta W_t = \sum_j \bar{\sigma} \bar{u}_j \bar{v}_j^\top$. The next parameter update is therefore $W_t \leftarrow \sum_i \sigma_i u_i v_i^\top + \sum_j \bar{\sigma} \bar{u}_j \bar{v}_j^\top$. In Muon, as both the weights and the updates have a higher effective rank than Adam, we hypothesize there is a higher probability for singular-vector pair $u_i v_i^\top$ to align with $\bar{u}_j \bar{v}_j^\top$. This could cause the corresponding singular value of $W_t$ to increase additively.

**SVD 公式化。** 设 t-1 步的参数矩阵具有奇异值分解 $W_{t-1} = \sum_i \sigma_i u_i v_i^\top$。我们将更新矩阵写为 $\Delta W_t = \sum_j \bar{\sigma} \bar{u}_j \bar{v}_j^\top$。因此下一步参数更新为 $W_t \leftarrow \sum_i \sigma_i u_i v_i^\top + \sum_j \bar{\sigma} \bar{u}_j \bar{v}_j^\top$。在 Muon 中,由于权重和更新都具有比 Adam 更高的有效秩,我们假设奇异向量对 $u_i v_i^\top$ 与 $\bar{u}_j \bar{v}_j^\top$ 对齐的概率更高。这可能导致 $W_t$ 的相应奇异值叠加增长。

**Attention-specific amplification.** Attention logits are computed via the bilinear form $q_i \cdot k_j = (x_i W_q) \cdot (x_j W_k)$. The product $W_q W_k^\top$ squares the spectral norm, so any singular-value increase in either matrix is compounded. Muon's tendency to enlarge singular values therefore translates into a higher risk of logit explosion.

**注意力特异性放大。** 注意力 logit 通过双线性形式 $q_i \cdot k_j = (x_i W_q) \cdot (x_j W_k)$ 计算。乘积 $W_q W_k^\top$ 将谱范数平方,因此任一矩阵的奇异值增长都会复合放大。Muon 放大奇异值的趋势因此转化为更高的 logit 爆炸风险。

> 译者注(设计动机): 附录 E 对 Muon 导致 logit 爆炸的数学机理提供了深刻的洞见。核心在于 Muon 的 `msign` 操作产生全秩更新矩阵,而 Adam 产生低秩更新矩阵。全秩更新意味着奇异向量对齐的概率更高,导致奇异值叠加增长。注意力机制中 $W_q W_k^\top$ 将谱范数平方,进一步放大了这一效应。这一分析不仅解释了为什么 QK-Clip 是必要的,也揭示了优化器选择对注意力机制稳定性的深层影响。值得注意的是,作者明确提到"高阶 muP 也做相同假设"(Adam 的低秩假设),这说明 Muon 的全秩特性与 muP 理论框架之间存在张力。

## F K2 Critic Rubrics for General RL
### K2 通用 RL 的批评评分标准

### F.1 Core Rubrics
#### 核心评分标准

- **Clarity and Relevance:** Assesses the extent to which the response is succinct while fully addressing the user's intent. The focus is on eliminating unnecessary detail, staying aligned with the central query, and using efficient formats such as brief paragraphs or compact lists. Unless specifically required, long itemizations should be avoided. When a choice is expected, the response should clearly offer a single, well-defined answer.

- **清晰与相关性:** 评估响应在简洁的同时充分满足用户意图的程度。重点是消除不必要的细节,保持与核心查询的对齐,使用高效的格式如简短段落或紧凑列表。除非特别要求,应避免冗长列举。当需要做出选择时,响应应清晰地提供单一、明确的答案。

- **Conversational Fluency and Engagement:** Evaluates the response's contribution to a natural, flowing dialogue that extends beyond simple question-answering. This includes maintaining coherence, showing appropriate engagement with the topic, offering relevant observations or insights, potentially guiding the conversation constructively when appropriate, using follow-up questions judiciously, handling hypothetical or personal-analogy queries gracefully, and adapting tone effectively to suit the conversational context (e.g., empathetic, formal, casual).

- **对话流畅度与参与度:** 评估响应对自然流畅对话的贡献,超越简单问答。这包括保持一致性、对话题展现适当的参与度、提供相关观察或见解、在适当时建设性地引导对话、审慎使用追问、优雅处理假设或个人类比查询、有效调整语气以适应对话语境(如同理心、正式、随意)。

- **Objective and Grounded Interaction:** Assesses the response's ability to maintain an objective and grounded tone, focusing squarely on the substance of the user's request. It evaluates the avoidance of both metacommentary (analyzing the query's structure, topic combination, perceived oddity, or the nature of the interaction itself) and unwarranted flattery or excessive praise directed at the user or their input. Excellent responses interact respectfully but neutrally, prioritizing direct, task-focused assistance over commentary on the conversational dynamics or attempts to curry favor through compliments.

- **客观与扎实的交互:** 评估响应保持客观、扎实语气的能力,专注于用户请求的本质。评估避免元评论(分析查询结构、话题组合、感知到的奇特性或交互本身的性质)以及针对用户或其输入的无端奉承或过度赞扬。优秀的响应以尊重但中立的方式交互,优先直接、以任务为中心的协助,而非对对话动态的点评或通过赞美讨好对方的企图。

### F.2 Prescriptive Rubrics
#### 规定性评分标准

- **Initial Praise:** Responses must not begin with compliments directed at the user or the question (e.g., "That's a beautiful question", "Good question!").

- **开场赞美:** 响应不得以针对用户或问题的赞美开头(如"这是个好问题"、"问得好!")。

- **Explicit Justification:** Any sentence or clause that explains why the response is good or how it successfully fulfilled the user's request. This is different from simply describing the content.

- **显式辩解:** 任何解释响应为什么好或如何成功满足用户请求的句子或从句。这与单纯描述内容不同。

### F.3 Limitations
#### 局限

One potential side effect of this evaluation framework is that it may favor responses that appear confident and assertive, even in contexts involving ambiguity or subjectivity. This stems from two key constraints in the current rubric:

该评估框架的一个潜在副作用是,它可能偏爱显得自信和果断的响应,即使在涉及模糊性或主观性的语境中也是如此。这源于当前评分标准中的两个关键约束:

- **Avoidance of Self-Qualification:** The prescriptive rules prohibit self-assessments, explicit disclaimers, or hedging language (e.g., "this may not be accurate", "I might be wrong"). While these phrases can reflect epistemic humility, they are often penalized as non-informative or performative.

- **避免自我限定:** 规定性规则禁止自我评估、明确免责声明或对冲语言(如"这可能不准确"、"我可能是错的")。虽然这些短语可以反映认识论上的谦逊,但它们常因非信息性或表演性而被惩罚。

- **Preference for Clarity and Singularity:** The rubric reward direct, decisive answers when users ask for a recommendation or explanation. In complex or open-ended scenarios, this may disincentivize appropriately cautious or multi-perspective responses.

- **偏好清晰与单一性:** 当用户请求建议或解释时,评分标准奖励直接、果断的答案。在复杂或开放式场景中,这可能不利于适当地谨慎或多视角的响应。

As a result, the model may occasionally overstate certainty in areas where ambiguity, nuance, or epistemic modesty would be more appropriate. Future iterations of the framework may incorporate more fine-grained handling of calibrated uncertainty.

因此,模型可能偶尔在模糊性、细微差别或认识论谦逊更为适当的领域过度表达确定性。框架的未来迭代可能纳入更精细的校准不确定性处理。

> 译者注(局限风险): 附录 F 的批评评分标准揭示了 RLHF/RL 奖励设计中的一个经典困境:过度优化可能导致"过度自信"(overconfidence)偏差。1) 禁止自我限定语言(如"我不确定")虽然使模型输出更果断,但在医学、法律等高风险领域可能产生危险后果;2) 对"清晰单一答案"的偏好抑制了多视角分析,这与当前学术界提倡的"校准不确定性"(calibrated uncertainty)背道而驰;3) 有趣的是,作者在最后一段明确承认了这一局限,并指出"未来迭代可能纳入更精细的校准不确定性处理",这种自我批评的态度值得肯定;4) 从更宏观的角度看,这反映了当前大模型对齐技术的一个根本张力:用户偏好(想要确定、简洁的答案)与真实世界(充满不确定性)之间的冲突。

## G Engine Switching Pipeline for RL Training
### RL 训练的引擎切换流水线

The checkpoint engine manages three equal-size device buffers on each GPU: an H2D buffer for loading the offloaded model parameters, and two IPC buffers for GPU-to-GPU broadcast. The IPC buffers are shared to inference engines, allowing it to directly access the same physical memory. These three buffers allow us to arrange the three steps in a pipeline.

检查点引擎在每个 GPU 上管理三个等大小设备缓冲区:一个 H2D 缓冲区用于加载卸载的模型参数,两个 IPC 缓冲区用于 GPU 间广播。IPC 缓冲区与推理引擎共享,使其可直接访问相同的物理内存。这三个缓冲区使我们能将三个步骤排列成流水线。

**Theoretical three-stage pipeline.** As illustrated in Figure 13a, a three-stage pipeline is introduced. (1) H2D: a shard of the latest weights is copied into the H2D buffer asynchronously. (2) Broadcast: Once the copy completes, the shard will be copied to one IPC buffer and broadcast to all devices. (3) Reload: Inference engines simultaneously load parameters from the other IPC buffer.

**理论三阶段流水线。** 如图 13a 所示,引入三阶段流水线。(1) H2D: 最新权重的分片被异步复制到 H2D 缓冲区。(2) 广播: 复制完成后,分片被复制到一个 IPC 缓冲区并广播到所有设备。(3) 重载: 推理引擎同时从另一个 IPC 缓冲区加载参数。

**Two-stage pipeline due to PCIe saturation.** On NVIDIA H800 clusters, concurrent H2D and broadcast saturate the shared PCIe fabric, collapsing the three stages into a sequential procedure (Figure 13b). We therefore adopt a simpler, two-stage scheme (Figure 13c): (1) All devices perform a single, synchronous H2D transfer. (2) The broadcast and reload proceed in parallel.

**因 PCIe 饱和退化的两阶段流水线。** 在 NVIDIA H800 集群上,并发的 H2D 和广播使共享 PCIe 结构饱和,将三阶段塌缩为串行过程(图 13b)。因此我们采用更简单的两阶段方案(图 13c):(1) 所有设备执行单次同步 H2D 传输。(2) 广播和重载并行进行。

The two-stage pipeline will be bound by multiple synchronous H2D copy operations. But in large scale devices, model will be split into small shards, the entire parameter set fits into the H2D buffer in one transfer, the overhead will disappear.

两阶段流水线将受到多次同步 H2D 复制操作的限制。但在大规模设备上,模型被分成小分片,整个参数集可在一次传输中放入 H2D 缓冲区,开销将消失。

By overlapping H2D, Broadcast, and Reload weights, we can obtain a high bandwidth to reshard the weights from train engines to all inference engines.

通过重叠 H2D、广播和重载权重,我们可以获得高带宽,将权重从训练引擎重新分片到所有推理引擎。

> 译者注(工程细节): 附录 G 描述的引擎切换流水线是 RL 训练中常被忽视但至关重要的工程组件。核心挑战在于:训练引擎(需要梯度更新)和推理引擎(需要生成 rollout)使用不同的并行策略(TP/EP/PP 配置不同),每次策略更新后需要将权重从训练引擎重新分片到推理引擎。1) 三阶段流水线的理论效率受限于 H800 的 PCIe 带宽瓶颈,说明硬件互连带宽是 RL 扩展的关键约束;2) 作者巧妙利用双 IPC 缓冲区实现乒乓缓冲(broadcast 和 reload 并行),避免读写冲突;3) "整个参数集一次传输"的假设在大规模设备上成立,说明 1T 模型分片后单个分片足够小,可放入 H2D 缓冲区;4) 这种 weight reshard 的开销直接影响了 RL 训练的效率,如果每次更新需要数秒传输,那么短序列 RL 的吞吐量将严重受限。

---

*D4 翻译完成。全文约 6000 行英文原文已逐段精译, 包含 10 处译者注。References 部分因篇幅原因略去, 完整引用列表见原文 D3。*

## 全文完

## 关联文件说明

| 文件 | 说明 |
| --- | --- |
| [03-Kimi-K2-mineru-en.md](./03-Kimi-K2-mineru-en.md) | MinerU 英文原文(D3), 含 19 张语义化插图 |
| [02-Kimi-K2核心演化剖析.md](./02-Kimi-K2核心演化剖析.md) | 中文架构演化剖析(D2) |
| [01-Kimi-K2技术报告精译.md](./01-Kimi-K2技术报告精译.md) | 技术报告中文精译主稿(D2) |
| [05-Kimi-K2-Index.md](./05-Kimi-K2-Index.md) | 技术入口 Index(D5) |
| [05-Kimi-K2-Architecture-Overview.md](./05-Kimi-K2-Architecture-Overview.md) | MuonClip / MoE / Agentic 训练体系专题 |
| [pdfs/Kimi-K2.pdf](./pdfs/Kimi-K2.pdf) | 官方技术报告 PDF(arXiv:2507.20534) |
| [images/](./images/) | 论文插图(figure_01–figure_19) |
