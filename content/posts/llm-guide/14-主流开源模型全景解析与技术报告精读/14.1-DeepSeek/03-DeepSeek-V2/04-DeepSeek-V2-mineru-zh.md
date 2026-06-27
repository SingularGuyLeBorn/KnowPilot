---
title: "DeepSeek-V2 - 逐段精译与译者注"
source: 03-DeepSeek-V2-mineru-en.md
translated_by: "AI Agent"
date: 2026-05-19
---

> 译者注: 本文基于 MinerU 从原始 PDF 转换的英文 Markdown (D3) 进行逐段对照翻译. 译者注仅在关键设计动机、数据可信度、工程细节、局限风险、技术谱系节点插入, 不是每段都写.


# DeepSeek-V2: 一个强大、经济且高效的混合专家语言模型

> 原文标题: DeepSeek-V2: A Strong, Economical, and Efficient Mixture-of-Experts Language Model
> 原文文件: `03-DeepSeek-V2-mineru-en.md`
> 说明: 本文在保留英文原文结构、图示和关键公式的基础上补入中文译文与译者注.

## Abstract

> 🔙 **[返回 14.1-DeepSeek 家族总览](../../14.1-DeepSeek.md)**


We present DeepSeek-V2, a strong Mixture-of-Experts (MoE) language model characterized by economical training and efficient inference. It comprises 236B total parameters, of which 21B are activated for each token, and supports a context length of 128K tokens. DeepSeek-V2 adopts innovative architectures including Multi-head Latent Attention (MLA) and DeepSeekMoE. MLA guarantees efficient inference through significantly compressing the Key-Value (KV) cache into a latent vector, while DeepSeekMoE enables training strong models at an economical cost through sparse computation. Compared with DeepSeek 67B, DeepSeek-V2 achieves significantly stronger performance, and meanwhile saves 42.5% of training costs, reduces the KV cache by 93.3%, and boosts the maximum generation throughput to 5.76 times. We pretrain DeepSeek-V2 on a high-quality and multi-source corpus consisting of 8.1T tokens, and further perform Supervised Fine-Tuning (SFT) and Reinforcement Learning (RL) to fully unlock its potential. Evaluation results show that, even with only 21B activated parameters, DeepSeek-V2 and its chat versions still achieve top-tier performance among open-source models. The model checkpoints are available at https://github.com/deepseek-ai/DeepSeek-V2.

我们推出了 DeepSeek-V2, 一个强大的混合专家(MoE)语言模型, 其核心特点是训练成本低、推理效率高. 该模型总参数量为 236B, 每个 token 激活 21B 参数, 支持 128K tokens 的上下文长度. DeepSeek-V2 采用了创新的架构设计, 包括 Multi-head Latent Attention(MLA, 多头潜在注意力)和 DeepSeekMoE. MLA 通过将 Key-Value(KV)缓存显著压缩为一个潜在向量来保证高效的推理, 而 DeepSeekMoE 则通过稀疏计算以较低的成本训练出强大的模型. 与 DeepSeek 67B 相比, DeepSeek-V2 在性能上取得了显著提升, 同时节省了 42.5% 的训练成本, 将 KV 缓存减少了 93.3%, 并将最大生成吞吐量提升至 5.76 倍. 我们在一个包含 8.1T tokens 的高质量多源语料库上对 DeepSeek-V2 进行预训练, 并进一步执行 Supervised Fine-Tuning(SFT, 监督微调)和 Reinforcement Learning(RL, 强化学习)以充分释放其潜力. 评测结果表明, 即使仅有 21B 激活参数, DeepSeek-V2 及其对话版本仍然在开源模型中达到了顶级性能. 模型检查点可在 https://github.com/deepseek-ai/DeepSeek-V2 获取.

> 译者注: DeepSeek-V2 是 2024 年 5 月发布的模型, 它在开源社区的意义在于证明了 MoE 架构可以在保持甚至超越 Dense 模型性能的同时, 大幅降低训练和推理成本. 236B 总参数 / 21B 激活参数的配置意味着它在推理时只激活约 9% 的参数, 却能与 67B Dense 模型竞争. 这是 MoE 从"研究玩具"走向"工程实用"的关键里程碑.

![](images/fig01a_mmlu_accuracy.jpg)
(a)

![](images/fig01b_training_costs.jpg)

![](images/fig01c_kv_cache.jpg)

![](images/fig01d_throughput.jpg)
(b)
Figure 1 | (a) MMLU accuracy vs. activated parameters, among different open-source models. (b) Training costs and inference efficiency of DeepSeek 67B (Dense) and DeepSeek-V2.

> 图 1: (a) 不同开源模型的 MMLU 准确率与激活参数对比. (b) DeepSeek 67B(Dense)与 DeepSeek-V2 的训练成本和推理效率对比.

## Contents

> 译者注: 目录页保留原始结构, 便于对照 PDF 章节定位.


1 Introduction 4
2 Architecture 6
2.1 Multi-Head Latent Attention: Boosting Inference Efficiency . 6
2.1.1 Preliminaries: Standard Multi-Head Attention 6
2.1.2 Low-Rank Key-Value Joint Compression 7
2.1.3 Decoupled Rotary Position Embedding 8
2.1.4 Comparison of Key-Value Cache 8
2.2 DeepSeekMoE: Training Strong Models at Economical Costs 9
2.2.1 Basic Architecture 9
2.2.2 Device-Limited Routing 9
2.2.3 Auxiliary Loss for Load Balance 10
2.2.4 Token-Dropping Strategy 11
3 Pre-Training 11
3.1 Experimental Setups 11
3.1.1 Data Construction 11
3.1.2 Hyper-Parameters 12
3.1.3 Infrastructures 12
3.1.4 Long Context Extension 13
3.2 Evaluations 13
3.2.1 Evaluation Benchmarks 13
3.2.2 Evaluation Results 14
3.2.3 Training and Inference Efficiency 16
4 Alignment 16
4.1 Supervised Fine-Tuning 16
4.2 Reinforcement Learning 17
4.3 Evaluation Results 18
4.4 Discussion 20
5 Conclusion, Limitation, and Future Work 2 1
A Contributions and Acknowledgments 2 7
B DeepSeek-V2-Lite: A 16B Model Equipped with MLA and DeepSeekMoE 29
B.1 Model Description 29
B.2 Performance Evaluation 30
C Full Formulas of MLA 31
D Ablation of Attention Mechanisms 31
D.1 Ablation of MHA, GQA, and MQA . 31
D.2 Comparison Between MLA and MHA 31
E Discussion About Pre-Training Data Debiasing 32
F Additional Evaluations on Math and Code 32
G Evaluation Formats 3 3

## 1. Introduction

In the past few years, Large Language Models (LLMs) (Anthropic, 2023; Google, 2023; OpenAI, 2022, 2023) have undergone rapid development, offering a glimpse into the dawn of Artificial General Intelligence (AGI). In general, the intelligence of an LLM tends to improve as the number of parameters increases, allowing it to exhibit emergent capabilities across various tasks (Wei et al., 2022). However, the improvement comes at the cost of larger computing resources for training and a potential decrease in inference throughput. These constraints present significant challenges that impede the widespread adoption and utilization of LLMs. In order to tackle this problem, we introduce DeepSeek-V2, a strong open-source Mixture-of-Experts (MoE) language model, characterized by economical training and efficient inference through an innovative Transformer architecture. It is equipped with a total of 236B parameters, of which 21B are activated for each token, and supports a context length of 128K tokens.

过去几年, 大型语言模型(LLMs)(Anthropic, 2023; Google, 2023; OpenAI, 2022, 2023)经历了快速发展, 让我们得以一窥通用人工智能(AGI)的曙光. 一般来说, LLM 的智能水平往往随着参数量的增加而提升, 使其能够在各种任务上展现出涌现能力(Wei et al., 2022). 然而, 这种提升的代价是更大的训练计算资源需求和潜在的推理吞吐量下降. 这些限制给 LLM 的广泛普及和应用带来了重大挑战. 为了解决这一问题, 我们推出了 DeepSeek-V2, 一个强大的开源混合专家(MoE)语言模型, 它通过创新的 Transformer 架构实现了经济的训练和高效的推理. 该模型总参数量为 236B, 每个 token 激活 21B 参数, 并支持 128K tokens 的上下文长度.

> 译者注: 这里作者点明了 LLM 发展的核心矛盾: 参数规模增长带来性能提升, 但也带来训练和推理成本飙升. MoE 架构的提出正是为了解决这个矛盾——用稀疏激活的方式, 在保持大模型容量的同时降低实际计算开销. DeepSeek-V2 的 236B/21B 配置是这一思路的具体体现.

We optimize the attention modules and Feed-Forward Networks (FFNs) within the Transformer framework (Vaswani et al., 2017) with our proposed Multi-head Latent Attention (MLA) and DeepSeekMoE. (1) In the context of attention mechanisms, the Key-Value (KV) cache of the Multi-Head Attention (MHA) (Vaswani et al., 2017) poses a significant obstacle to the inference efficiency of LLMs. Various approaches have been explored to address this issue, including Grouped-Query Attention (GQA) (Ainslie et al., 2023) and Multi-Query Attention (MQA) (Shazeer, 2019). However, these methods often compromise performance in their attempt to reduce the KV cache. In order to achieve the best of both worlds, we introduce MLA, an attention mechanism equipped with low-rank key-value joint compression. Empirically, MLA achieves superior performance compared with MHA, and meanwhile significantly reduces the KV cache during inference, thus boosting the inference efficiency. (2) For Feed-Forward Networks (FFNs), we follow the DeepSeekMoE architecture (Dai et al., 2024), which adopts fine-grained expert segmentation and shared expert isolation for higher potential in expert specialization. The DeepSeekMoE architecture demonstrates great advantages compared with conventional MoE architectures like GShard (Lepikhin et al., 2021), enabling us to train strong models at an economical cost. As we employ expert parallelism during training, we also devise supplementary mechanisms to control communication overheads and ensure load balance. By combining these two techniques, DeepSeek-V2 features strong performance (Figure 1(a)), economical training costs, and efficient inference throughput (Figure 1(b)), simultaneously.

我们在 Transformer 框架(Vaswani et al., 2017)内, 用我们提出的 Multi-head Latent Attention(MLA)和 DeepSeekMoE 对注意力模块和前馈网络(FFNs)进行了优化. (1) 在注意力机制方面, Multi-Head Attention(MHA)(Vaswani et al., 2017)的 Key-Value(KV)缓存对 LLM 的推理效率构成了重大障碍. 已有多种方法被探索来解决这一问题, 包括 Grouped-Query Attention(GQA)(Ainslie et al., 2023)和 Multi-Query Attention(MQA)(Shazeer, 2019). 然而, 这些方法在试图减少 KV 缓存的同时往往会牺牲性能. 为了两全其美, 我们引入了 MLA, 一种配备低秩 key-value 联合压缩的注意力机制. 经验上, MLA 相比 MHA 实现了更优的性能, 同时在推理期间显著减少了 KV 缓存, 从而提升了推理效率. (2) 对于前馈网络(FFNs), 我们遵循 DeepSeekMoE 架构(Dai et al., 2024), 该架构采用细粒度专家分割和共享专家隔离, 以实现更高的专家专业化潜力. DeepSeekMoE 架构相比传统的 MoE 架构(如 GShard(Lepikhin et al., 2021))展现出巨大优势, 使我们能够以较低的成本训练出强大的模型. 由于我们在训练期间采用了专家并行(Expert Parallelism), 我们还设计了补充机制来控制通信开销并确保负载均衡. 通过结合这两种技术, DeepSeek-V2 同时具备强大的性能(图 1(a))、经济的训练成本和高效的推理吞吐量(图 1(b)).

> 译者注: 这是 DeepSeek-V2 的两大核心技术支柱. MLA 解决了推理时的 KV 缓存瓶颈, DeepSeekMoE 解决了训练时的计算成本问题. 值得注意的是, MLA 不仅不牺牲性能, 反而比 MHA 更强——这打破了"压缩必损质量"的常规认知. DeepSeekMoE 的"细粒度专家分割+共享专家隔离"设计影响了后续 Qwen2-MoE、GLM-5 等模型, 几乎成为 2024-2025 年 MoE 架构的事实标准.

We construct a high-quality and multi-source pre-training corpus consisting of 8.1T tokens. Compared with the corpus used in DeepSeek 67B (our previous release) (DeepSeek-AI, 2024), this corpus features an extended amount of data, especially Chinese data, and higher data quality. We first pretrain DeepSeek-V2 on the full pre-training corpus. Then, we collect 1.5M conversational sessions, which encompass various domains such as math, code, writing, reasoning, safety, and more, to perform Supervised Fine-Tuning (SFT) for DeepSeek-V2 Chat (SFT). Finally, we follow DeepSeekMath (Shao et al., 2024) to employ Group Relative Policy Optimization (GRPO) to further align the model with human preference and produce DeepSeek-V2 Chat (RL).

我们构建了一个包含 8.1T tokens 的高质量多源预训练语料库. 与 DeepSeek 67B(我们先前发布的版本)(DeepSeek-AI, 2024)使用的语料库相比, 该语料库的数据量更大, 尤其是中文数据更多, 且数据质量更高. 我们首先在完整的预训练语料库上对 DeepSeek-V2 进行预训练. 然后, 我们收集了 150 万轮对话会话, 涵盖数学、代码、写作、推理、安全等多个领域, 对 DeepSeek-V2 Chat (SFT) 进行监督微调(SFT). 最后, 我们遵循 DeepSeekMath(Shao et al., 2024)的做法, 采用 Group Relative Policy Optimization(GRPO, 组相对策略优化)进一步使模型与人类偏好对齐, 产出 DeepSeek-V2 Chat (RL).

> 译者注: 8.1T tokens 的预训练数据量和 1.5M 轮 SFT 对话量是重要的工程细节. 值得注意的是, DeepSeek-V2 的 RL 阶段使用的是 GRPO 而非传统的 PPO——GRPO 不需要单独训练价值模型, 这大大节省了显存开销. 这个选择在后续的 DeepSeek-R1 中被进一步发扬光大.

We evaluate DeepSeek-V2 on a wide range of benchmarks in English and Chinese, and compare it with representative open-source models. Evaluation results show that even with only 21B activated parameters, DeepSeek-V2 still achieves top-tier performance among open-source models and becomes the strongest open-source MoE language model. Figure 1(a) highlights that, on MMLU, DeepSeek-V2 achieves top-ranking performance with only a small number of activated parameters. In addition, as shown in Figure 1(b), compared with DeepSeek 67B, DeepSeek-V2 saves 42.5% of training costs, reduces the KV cache by 93.3%, and boosts the maximum generation throughput to 5.76 times. We also evaluate DeepSeek-V2 Chat (SFT) and

我们在英文和中文的广泛基准测试上对 DeepSeek-V2 进行了评测, 并将其与代表性开源模型进行了比较. 评测结果表明, 即使仅有 21B 激活参数, DeepSeek-V2 仍然在开源模型中达到了顶级性能, 成为最强的开源 MoE 语言模型. 图 1(a)突出显示, 在 MMLU 上, DeepSeek-V2 以较少的激活参数取得了顶级排名性能. 此外, 如图 1(b)所示, 与 DeepSeek 67B 相比, DeepSeek-V2 节省了 42.5% 的训练成本, 将 KV 缓存减少了 93.3%, 并将最大生成吞吐量提升至 5.76 倍. 我们还评测了 DeepSeek-V2 Chat (SFT) 和

![](images/fig02_architecture.jpg)
Figure 2 | Illustration of the architecture of DeepSeek-V2. MLA ensures efficient inference by significantly reducing the KV cache for generation, and DeepSeekMoE enables training strong models at an economical cost through the sparse architecture.

> 图 2: DeepSeek-V2 架构示意图. MLA 通过显著减少生成时的 KV 缓存确保高效推理, DeepSeekMoE 通过稀疏架构以较低成本训练强大模型.

DeepSeek-V2 Chat (RL) on open-ended benchmarks. Notably, DeepSeek-V2 Chat (RL) achieves 38.9 length-controlled win rate on AlpacaEval 2.0 (Dubois et al., 2024), 8.97 overall score on MT-Bench (Zheng et al., 2023), and 7.91 overall score on AlignBench (Liu et al., 2023). The English open-ended conversation evaluations demonstrate that DeepSeek-V2 Chat (RL) has top-tier performance among open-source chat models. In addition, the evaluation on AlignBench indicates that in Chinese, DeepSeek-V2 Chat (RL) outperforms all of open-source models, and even beats most of closed-source models.

DeepSeek-V2 Chat (RL) 在开放式基准测试上的表现. 值得注意的是, DeepSeek-V2 Chat (RL) 在 AlpacaEval 2.0(Dubois et al., 2024)上取得了 38.9 的长度控制胜率, 在 MT-Bench(Zheng et al., 2023)上取得 8.97 的总分, 在 AlignBench(Liu et al., 2023)上取得 7.91 的总分. 英文开放式对话评测表明, DeepSeek-V2 Chat (RL) 在开源对话模型中具有顶级性能. 此外, AlignBench 的评测结果显示, 在中文方面, DeepSeek-V2 Chat (RL) 超越了所有开源模型, 甚至击败了大多数闭源模型.

> 译者注: AlignBench 是中文对话质量评测基准, DeepSeek-V2 在该基准上超越闭源模型的结果值得注意. 这反映了 DeepSeek 在中文语料建设和中文偏好对齐上的投入. 不过需要谨慎看待: AlignBench 的测试数据是否出现在训练集中? DeepSeek 在报告中未明确披露数据截止日期, 这是所有开源模型评测的共同痛点.

## 过渡说明

In order to facilitate further research and development on MLA and DeepSeekMoE, we also release DeepSeek-V2-Lite, a smaller model equipped with MLA and DeepSeekMoE, for the open-source community. It has a total of 15.7B parameters, where 2.4B are activated for each token. Detailed descriptions about DeepSeek-V2-Lite can be found in Appendix B.

为了促进 MLA 和 DeepSeekMoE 的进一步研究与开发, 我们还发布了 DeepSeek-V2-Lite, 一个配备了 MLA 和 DeepSeekMoE 的较小模型, 供开源社区使用. 它总参数量为 15.7B, 每个 token 激活 2.4B 参数. 关于 DeepSeek-V2-Lite 的详细描述可在附录 B 中找到.

In the rest of this paper, we first provide a detailed description of the model architecture of DeepSeek-V2 (Section 2). Subsequently, we introduce our pre-training endeavors, including the training data construction, hyper-parameter settings, infrastructures, long context extension, and the evaluation of model performance and efficiency (Section 3). Following this, we demonstrate our efforts in alignment, encompassing Supervised Fine-Tuning (SFT), Reinforcement Learning (RL), the evaluation results, and other discussion (Section 4). Finally, we summarize the conclusion, deliberate on the current limitations of DeepSeek-V2, and outline our future work (Section 5).

在本文的其余部分, 我们首先详细介绍 DeepSeek-V2 的模型架构(第 2 节). 随后, 我们介绍预训练工作, 包括训练数据构建、超参数设置、基础设施、长上下文扩展, 以及模型性能和效率的评测(第 3 节). 接着, 我们展示对齐工作, 涵盖监督微调(SFT)、强化学习(RL)、评测结果及其他讨论(第 4 节). 最后, 我们总结结论, 深思 DeepSeek-V2 当前的局限性, 并概述未来工作(第 5 节).

## 2. Architecture

By and large, DeepSeek-V2 is still in the Transformer architecture (Vaswani et al., 2017), where each Transformer block consists of an attention module and a Feed-Forward Network (FFN). However, for both the attention module and the FFN, we design and employ innovative architectures. For attention, we design MLA, which utilizes low-rank key-value joint compression to eliminate the bottleneck of inference-time key-value cache, thus supporting efficient inference. For FFNs, we adopt the DeepSeekMoE architecture (Dai et al., 2024), a high-performance MoE architecture that enables training strong models at an economical cost. An illustration of the architecture of DeepSeek-V2 is presented in Figure 2, and we will introduce the details of MLA and DeepSeekMoE in this section. For other tiny details (e.g., layer normalization and the activation function in FFNs), unless specifically stated, DeepSeek-V2 follows the settings of DeepSeek 67B (DeepSeek-AI, 2024).

总体而言, DeepSeek-V2 仍然基于 Transformer 架构(Vaswani et al., 2017), 其中每个 Transformer 块由一个注意力模块和一个前馈网络(FFN)组成. 然而, 无论是注意力模块还是 FFN, 我们都设计并采用了创新的架构. 对于注意力, 我们设计了 MLA, 它利用低秩 key-value 联合压缩来消除推理时 key-value 缓存的瓶颈, 从而支持高效推理. 对于 FFN, 我们采用 DeepSeekMoE 架构(Dai et al., 2024), 一种高性能的 MoE 架构, 能够以较低成本训练出强大模型. DeepSeek-V2 的架构示意图如图 2 所示, 我们将在本节介绍 MLA 和 DeepSeekMoE 的细节. 对于其他细节(如层归一化和 FFN 中的激活函数), 除非特别说明, DeepSeek-V2 遵循 DeepSeek 67B(DeepSeek-AI, 2024)的设置.

> 译者注: 这里明确了两点: (1) DeepSeek-V2 不是推翻 Transformer 重做, 而是在标准 Transformer 块内替换 attention 和 FFN 两个子模块; (2) 其余设置(如 RMSNorm、SwiGLU 激活等)继承自 DeepSeek 67B. 这种"局部替换、整体兼容"的策略降低了工程迁移成本, 也是后续 V3 能在此基础上继续叠加 DualPipe、MTP 等创新的前提.

### 2.1. Multi-Head Latent Attention: Boosting Inference Efficiency

Conventional Transformer models usually adopts Multi-Head Attention (MHA) (Vaswani et al., 2017), but during generation, its heavy Key-Value (KV) cache will become the bottleneck that limit the inference efficiency. In order to reduce the KV cache, Multi-Query Attention (MQA) (Shazeer, 2019) and Grouped-Query Attention (GQA) (Ainslie et al., 2023) are proposed. They require a smaller magnitude of KV cache, but their performance does not match MHA (we provide the ablation of MHA, GQA and MQA in Appendix D.1).

传统的 Transformer 模型通常采用 Multi-Head Attention(MHA)(Vaswani et al., 2017), 但在生成阶段, 其庞大的 Key-Value(KV)缓存会成为限制推理效率的瓶颈. 为了减少 KV 缓存, Multi-Query Attention(MQA)(Shazeer, 2019)和 Grouped-Query Attention(GQA)(Ainslie et al., 2023)被提出. 它们需要更小规模的 KV 缓存, 但性能不及 MHA(我们在附录 D.1 中提供了 MHA、GQA 和 MQA 的消融实验).

> 译者注: KV 缓存瓶颈是 LLM 推理的核心痛点. 在自回归生成中, 每个新 token 都需要访问之前所有 token 的 Key 和 Value, 这导致缓存大小随序列长度线性增长. MQA 和 GQA 通过在多个 query 头之间共享 KV 头来减少缓存, 但共享意味着信息损失, 所以性能会下降. MLA 的核心创新在于: 不是共享 KV 头, 而是在特征维度上做低秩压缩——这保留了更多的信息冗余度.

For DeepSeek-V2, we design an innovative attention mechanism called Multi-head Latent Attention (MLA). Equipped with low-rank key-value joint compression, MLA achieves better performance than MHA, but requires a significantly smaller amount of KV cache. We introduce its architecture in the following, and also provide a comparison between MLA and MHA in Appendix D.2.

对于 DeepSeek-V2, 我们设计了一种创新的注意力机制, 称为 Multi-head Latent Attention(MLA, 多头潜在注意力). 配备了低秩 key-value 联合压缩, MLA 在性能上优于 MHA, 同时仅需显著更少的 KV 缓存. 我们将在下文介绍其架构, 并在附录 D.2 中提供 MLA 与 MHA 的对比.

#### 2.1.1. Preliminaries: Standard Multi-Head Attention

We first introduce the standard MHA mechanism as background. Let $d$ be the embedding dimension, $n_h$ be the number of attention heads, $d_h$ be the dimension per head, and $\mathbf{h}_t \in \mathbb{R}^d$ be the attention input of the $t$-th token at an attention layer. Standard MHA first produces $\mathbf{q}_t, \mathbf{k}_t, \mathbf{v}_t \in \mathbb{R}^{d_h n_h}$ through three matrices $W^Q, W^K, W^V \in \mathbb{R}^{d_h n_h \times d}$, respectively:

我们首先介绍标准 MHA 机制作为背景. 设 $d$ 为嵌入维度, $n_h$ 为注意力头数, $d_h$ 为每个头的维度, $\mathbf{h}_t \in \mathbb{R}^d$ 为注意力层中第 $t$ 个 token 的注意力输入. 标准 MHA 首先通过三个矩阵 $W^Q, W^K, W^V \in \mathbb{R}^{d_h n_h \times d}$ 分别生成 $\mathbf{q}_t, \mathbf{k}_t, \mathbf{v}_t \in \mathbb{R}^{d_h n_h}$:

$$
\mathbf{q}_t = W^Q \mathbf{h}_t, \tag{1}
$$

$$
\mathbf{k}_t = W^K \mathbf{h}_t, \tag{2}
$$

$$
\mathbf{v}_t = W^V \mathbf{h}_t, \tag{3}
$$

![](images/fig03_attention_comparison.jpg)
Figure 3 | Simplified illustration of Multi-Head Attention (MHA), Grouped-Query Attention (GQA), Multi-Query Attention (MQA), and Multi-head Latent Attention (MLA). Through jointly compressing the keys and values into a latent vector, MLA significantly reduces the KV cache during inference.

> 图 3: MHA、GQA、MQA 和 MLA 的简化示意图. MLA 通过将 keys 和 values 联合压缩为一个潜在向量, 在推理期间显著减少 KV 缓存.

Then, $\mathbf{q}_t, \mathbf{k}_t, \mathbf{v}_t$ will be sliced into $n_h$ heads for the multi-head attention computation:

然后, $\mathbf{q}_t, \mathbf{k}_t, \mathbf{v}_t$ 将被切分为 $n_h$ 个头以进行多头注意力计算:

$$
[\mathbf{q}_{t,1}; \mathbf{q}_{t,2}; ...; \mathbf{q}_{t,n_h}] = \mathbf{q}_t, \tag{4}
$$

$$
[\mathbf{k}_{t,1}; \mathbf{k}_{t,2}; ...; \mathbf{k}_{t,n_h}] = \mathbf{k}_t, \tag{5}
$$

$$
[\mathbf{v}_{t,1}; \mathbf{v}_{t,2}; ...; \mathbf{v}_{t,n_h}] = \mathbf{v}_t, \tag{6}
$$

$$
\mathbf{o}_{t,i} = \sum_{j=1}^{t} \text{Softmax}_j(\frac{\mathbf{q}_{t,i}^T \mathbf{k}_{j,i}}{\sqrt{d_h}}) \mathbf{v}_{j,i}, \tag{7}
$$

$$
\mathbf{u}_t = W^O [\mathbf{o}_{t,1}; \mathbf{o}_{t,2}; ...; \mathbf{o}_{t,n_h}], \tag{8}
$$

where $\mathbf{q}_{t,i}, \mathbf{k}_{t,i}, \mathbf{v}_{t,i} \in \mathbb{R}^{d_h}$ denote the query, key, and value of the $i$-th attention head, respectively; $W^O \in \mathbb{R}^{d \times d_h n_h}$ denotes the output projection matrix. During inference, all keys and values need to be cached to accelerate inference, so MHA needs to cache $2 n_h d_h l$ elements for each token. In model deployment, this heavy KV cache is a large bottleneck that limits the maximum batch size and sequence length.

其中 $\mathbf{q}_{t,i}, \mathbf{k}_{t,i}, \mathbf{v}_{t,i} \in \mathbb{R}^{d_h}$ 分别表示第 $i$ 个注意力头的 query、key 和 value; $W^O \in \mathbb{R}^{d \times d_h n_h}$ 表示输出投影矩阵. 在推理期间, 所有 keys 和 values 都需要被缓存以加速推理, 因此 MHA 需要为每个 token 缓存 $2 n_h d_h l$ 个元素. 在模型部署中, 这个庞大的 KV 缓存是一个重大瓶颈, 限制了最大批处理大小和序列长度.

> 译者注: 式(7)是标准的缩放点积注意力. MHA 的 KV 缓存公式 $2 n_h d_h l$ 直观地展示了缓存规模与头数、头维度、层数成正比. 以 DeepSeek 67B 为例, 如果 $n_h=64, d_h=128, l=96$, 则每个 token 的 KV 缓存约为 $2 \times 64 \times 128 \times 96 = 1.57M$ 个元素, 在 FP16 精度下约为 3MB. 对于 128K 上下文, 仅 KV 缓存就需要约 384GB——这几乎是单节点 GPU 显存的上限.

#### 2.1.2. Low-Rank Key-Value Joint Compression

The core of MLA is the low-rank joint compression for keys and values to reduce KV cache:

MLA 的核心是对 keys 和 values 进行低秩联合压缩以减少 KV 缓存:

$$
\mathbf{c}_t^{KV} = W^{DKV} \mathbf{h}_t, \tag{9}
$$

$$
\mathbf{k}_t^C = W^{UK} \mathbf{c}_t^{KV}, \tag{10}
$$

$$
\mathbf{v}_t^C = W^{UV} \mathbf{c}_t^{KV}, \tag{11}
$$

where $\mathbf{c}_t^{KV} \in \mathbb{R}^{d_c}$ is the compressed latent vector for keys and values; $d_c (\ll d_h n_h)$ denotes the KV compression dimension; $W^{DKV} \in \mathbb{R}^{d_c \times d}$ is the down-projection matrix; and $W^{UK}, W^{UV} \in \mathbb{R}^{d_h n_h \times d_c}$ are the up-projection matrices for keys and values, respectively. During inference, MLA only needs to cache $\mathbf{c}_t^{KV}$, so its KV cache has only $d_c l$ elements, where $l$ denotes the number of layers. In addition, during inference, since $W^{UK}$ can be absorbed into $W^Q$, and $W^{UV}$ can be absorbed into $W^O$, we even do not need to compute keys and values out for attention. Figure 3 intuitively illustrates how the KV joint compression in MLA reduces the KV cache.

其中 $\mathbf{c}_t^{KV} \in \mathbb{R}^{d_c}$ 是 keys 和 values 的压缩潜在向量; $d_c (\ll d_h n_h)$ 表示 KV 压缩维度; $W^{DKV} \in \mathbb{R}^{d_c \times d}$ 是下投影矩阵; $W^{UK}, W^{UV} \in \mathbb{R}^{d_h n_h \times d_c}$ 分别是 keys 和 values 的上投影矩阵. 在推理期间, MLA 只需缓存 $\mathbf{c}_t^{KV}$, 因此其 KV 缓存仅有 $d_c l$ 个元素, 其中 $l$ 表示层数. 此外, 在推理期间, 由于 $W^{UK}$ 可以被吸收进 $W^Q$, $W^{UV}$ 可以被吸收进 $W^O$, 我们甚至不需要为注意力计算显式展开 keys 和 values. 图 3 直观地展示了 MLA 中的 KV 联合压缩如何减少 KV 缓存.

> 译者注: 这是 MLA 的核心数学洞察. 式(9)将高维 KV ($d_h n_h$)压缩为低维潜在向量 $\mathbf{c}_t^{KV}$ ($d_c$). 对于 DeepSeek-V2, $d_c = 4d_h = 512$, 而 $d_h n_h = 8192$, 压缩比约为 16:1. 更重要的是, $W^{UK}$ 和 $W^{UV}$ 在推理时可以被"吸收"到相邻的线性层中——这意味着 MLA 在推理时只需要存储和计算 $\mathbf{c}_t^{KV}$, 而无需恢复完整的 key 和 value. 这是 MLA 相比 GQA/MQA 的根本优势: GQA 减少了 KV 头的数量, 但每个头仍需存储完整的维度; MLA 则在特征维度上做压缩, 两者可以叠加使用.

Moreover, in order to reduce the activation memory during training, we also perform low-rank compression for the queries, even if it cannot reduce the KV cache:

此外, 为了减少训练期间的激活内存, 我们对 queries 也执行低秩压缩, 尽管这不能减少 KV 缓存:

$$
\mathbf{c}_t^Q = W^{DQ} \mathbf{h}_t, \tag{12}
$$

$$
\mathbf{q}_t^C = W^{UQ} \mathbf{c}_t^Q, \tag{13}
$$

where $\mathbf{c}_t^Q \in \mathbb{R}^{d_c'}$ is the compressed latent vector for queries; $d_c' (\ll d_h n_h)$ denotes the query compression dimension; and $W^{DQ} \in \mathbb{R}^{d_c' \times d}, W^{UQ} \in \mathbb{R}^{d_h n_h \times d_c'}$ are the down-projection and up-projection matrices for queries, respectively.

其中 $\mathbf{c}_t^Q \in \mathbb{R}^{d_c'}$ 是 queries 的压缩潜在向量; $d_c' (\ll d_h n_h)$ 表示 query 压缩维度; $W^{DQ} \in \mathbb{R}^{d_c' \times d}, W^{UQ} \in \mathbb{R}^{d_h n_h \times d_c'}$ 分别是 queries 的下投影和上投影矩阵.

#### 2.1.3. Decoupled Rotary Position Embedding

Following DeepSeek 67B (DeepSeek-AI, 2024), we intend to use the Rotary Position Embedding (RoPE) (Su et al., 2024) for DeepSeek-V2. However, RoPE is incompatible with low-rank KV compression. To be specific, RoPE is position-sensitive for both keys and queries. If we apply RoPE for the keys $\mathbf{k}_t^C$, $W^{UK}$ in Equation 10 will be coupled with a position-sensitive RoPE matrix. In this way, $W^{UK}$ cannot be absorbed into $W^Q$ any more during inference, since a RoPE matrix related to the currently generating token will lie between $W^Q$ and $W^{UK}$ and matrix multiplication does not obey a commutative law. As a result, we must recompute the keys for all the prefix tokens during inference, which will significantly hinder the inference efficiency.

遵循 DeepSeek 67B(DeepSeek-AI, 2024)的做法, 我们打算在 DeepSeek-V2 中使用 Rotary Position Embedding(RoPE, 旋转位置编码)(Su et al., 2024). 然而, RoPE 与低秩 KV 压缩不兼容. 具体来说, RoPE 对 keys 和 queries 都是位置敏感的. 如果我们对 keys $\mathbf{k}_t^C$ 应用 RoPE, 式(10)中的 $W^{UK}$ 将与位置敏感的 RoPE 矩阵耦合. 这样一来, $W^{UK}$ 在推理期间就无法再被吸收进 $W^Q$, 因为一个与当前生成 token 相关的 RoPE 矩阵会位于 $W^Q$ 和 $W^{UK}$ 之间, 而矩阵乘法不满足交换律. 结果, 我们必须在推理期间重新计算所有前缀 token 的 keys, 这将严重阻碍推理效率.

> 译者注: 这里揭示了一个深刻的工程矛盾: RoPE 的位置敏感性(旋转矩阵与位置索引绑定)与低秩压缩的"权重吸收"策略互斥. 如果强行在压缩后的 key 上应用 RoPE, 就无法在推理前将上投影矩阵与 query 投影矩阵合并, 导致每次生成新 token 都要重新计算所有历史 key. 这是一个典型的"技术组合爆炸"问题——两个各自优秀的技术叠加时产生了意想不到的冲突.

As a solution, we propose the decoupled RoPE strategy that uses additional multi-head queries $\mathbf{q}_{t,i}^R \in \mathbb{R}^{d_h^R}$ and a shared key $\mathbf{k}_t^R \in \mathbb{R}^{d_h^R}$ to carry RoPE, where $d_h^R$ denotes the per-head dimension of the decoupled queries and key. Equipped with the decoupled RoPE strategy, MLA performs the following computation:

作为解决方案, 我们提出了解耦 RoPE 策略, 使用额外的多头 queries $\mathbf{q}_{t,i}^R \in \mathbb{R}^{d_h^R}$ 和一个共享的 key $\mathbf{k}_t^R \in \mathbb{R}^{d_h^R}$ 来承载 RoPE, 其中 $d_h^R$ 表示解耦 queries 和 key 的每头维度. 配备了解耦 RoPE 策略后, MLA 执行以下计算:

$$
[\mathbf{q}_{t,1}^R; \mathbf{q}_{t,2}^R; ...; \mathbf{q}_{t,n_h}^R] = \mathbf{q}_t^R = \text{RoPE}(W^{QR} \mathbf{c}_t^Q), \tag{14}
$$

$$
\mathbf{k}_t^R = \text{RoPE}(W^{KR} \mathbf{h}_t), \tag{15}
$$

$$
\mathbf{q}_{t,i} = [\mathbf{q}_{t,i}^C; \mathbf{q}_{t,i}^R], \tag{16}
$$

$$
\mathbf{k}_{t,i} = [\mathbf{k}_{t,i}^C; \mathbf{k}_t^R], \tag{17}
$$

$$
\mathbf{o}_{t,i} = \sum_{j=1}^{t} \text{Softmax}_j(\frac{\mathbf{q}_{t,i}^T \mathbf{k}_{j,i}}{\sqrt{d_h + d_h^R}}) \mathbf{v}_{j,i}^C, \tag{18}
$$

$$
\mathbf{u}_t = W^O [\mathbf{o}_{t,1}; \mathbf{o}_{t,2}; ...; \mathbf{o}_{t,n_h}], \tag{19}
$$

where $W^{QR} \in \mathbb{R}^{d_h^R n_h \times d_c'}$ and $W^{KR} \in \mathbb{R}^{d_h^R \times d}$ are matrices to produce the decoupled queries and key, respectively; RoPE($\cdot$) denotes the operation that applies RoPE matrices; and $[\cdot; \cdot]$ denotes the concatenation operation. During inference, the decoupled key should also be cached. Therefore, DeepSeek-V2 requires a total KV cache containing $(d_c + d_h^R) l$ elements.

其中 $W^{QR} \in \mathbb{R}^{d_h^R n_h \times d_c'}$ 和 $W^{KR} \in \mathbb{R}^{d_h^R \times d}$ 分别是生成解耦 queries 和 key 的矩阵; RoPE($\cdot$) 表示应用 RoPE 矩阵的操作; $[\cdot; \cdot]$ 表示拼接操作. 在推理期间, 解耦 key 也需要被缓存. 因此, DeepSeek-V2 需要总共包含 $(d_c + d_h^R) l$ 个元素的 KV 缓存.

> 译者注: 解耦 RoPE 是 MLA 的关键工程技巧. 核心思想是: 将位置信息从压缩的 KV 中分离出来, 用一小部分独立的 query/key 头($\mathbf{q}_{t,i}^R$ 和 $\mathbf{k}_t^R$)来承载 RoPE. 这样, 压缩的 KV $\mathbf{c}_t^{KV}$ 不包含位置信息, 可以在推理前被吸收到相邻的线性层中; 而位置信息通过额外的解耦头注入, 不影响权重吸收. 代价是每个 token 需要额外缓存 $d_h^R l$ 个元素, 但相比 MHA 的 $2 n_h d_h l$, 仍然大幅减少了. 对于 DeepSeek-V2, $d_c = 4d_h$, $d_h^R = d_h / 2$, 总 KV 缓存约为 $(4.5 d_h) l$, 而 MHA 为 $(2 n_h d_h) l = (128 d_h) l$——压缩比约为 28:1.

In order to demonstrate the complete computation process of MLA, we also organize and provide its full formulas in Appendix C.

为了展示 MLA 的完整计算过程, 我们还在附录 C 中整理并提供了其完整公式.

#### 2.1.4. Comparison of Key-Value Cache

We demonstrate a comparison of the KV cache per token among different attention mechanisms in Table 1. MLA requires only a small amount of KV cache, equal to GQA with only 2.25 groups, but can achieve stronger performance than MHA.

我们在表 1 中展示了不同注意力机制下每个 token 的 KV 缓存对比. MLA 仅需少量 KV 缓存, 相当于仅有 2.25 个组的 GQA, 但性能却比 MHA 更强.

| Attention Mechanism | KV Cache per Token (# Element) | Capability |
|---------------------|-------------------------------|------------|
| Multi-Head Attention (MHA) | $2 n_h d_h l$ | Strong |
| Grouped-Query Attention (GQA) | $2 n_g d_h l$ | Moderate |
| Multi-Query Attention (MQA) | $2 d_h l$ | Weak |
| MLA (Ours) | $(d_c + d_h^R) l \approx \frac{9}{2} d_h l$ | Stronger |

Table 1 
| Comparison of the KV cache per token among different attention mechanisms. $n_h$ denotes the number of attention heads, $d_h$ denotes the dimension per attention head, $l$ denotes the number of layers, $n_g$ denotes the number of groups in GQA, and $d_c$ and $d_h^R$ denote the KV compression dimension and the per-head dimension of the decoupled queries and key in MLA, respectively. The amount of KV cache is measured by the number of elements, regardless of the storage precision. For DeepSeek-V2, $d_c$ is set to $4 d_h$ and $d_h^R$ is set to $\frac{d_h}{2}$. So, its KV cache is equal to GQA with only 2.25 groups, but its performance is stronger than MHA.

表 1 | 不同注意力机制下每个 token 的 KV 缓存对比. $n_h$ 表示注意力头数, $d_h$ 表示每个注意力头的维度, $l$ 表示层数, $n_g$ 表示 GQA 中的组数, $d_c$ 和 $d_h^R$ 分别表示 MLA 中的 KV 压缩维度以及解耦 queries 和 key 的每头维度. KV 缓存量以元素数量计量, 不考虑存储精度. 对于 DeepSeek-V2, $d_c$ 设为 $4d_h$, $d_h^R$ 设为 $\frac{d_h}{2}$. 因此, 其 KV 缓存相当于仅有 2.25 个组的 GQA, 但性能强于 MHA.

> 译者注: 表 1 的对比非常直观. MLA 的 KV 缓存 $(d_c + d_h^R)l = 4.5 d_h l$, 而 MHA 为 $2 n_h d_h l$. 以 DeepSeek-V2 的配置($n_h=64$)计算, MLA 的缓存量约为 MHA 的 $4.5/128 \approx 3.5\%$, 即减少了约 96.5%——这与摘要中提到的 93.3%  reduction 基本吻合(差异来自具体实现细节). 更关键的是, MLA 不仅省缓存, 还"更强"——这在注意力机制设计史上是罕见的: 通常效率提升以性能下降为代价, 但 MLA 打破了这个 trade-off.

### 2.2. DeepSeekMoE: Training Strong Models at Economical Costs

#### 2.2.1. Basic Architecture

For FFNs, we employ the DeepSeekMoE architecture (Dai et al., 2024). DeepSeekMoE has two key ideas: segmenting experts into finer granularity for higher expert specialization and more accurate knowledge acquisition, and isolating some shared experts for mitigating knowledge redundancy among routed experts. With the same number of activated and total expert parameters, DeepSeekMoE can outperform conventional MoE architectures like GShard (Lepikhin et al., 2021) by a large margin.

对于 FFN, 我们采用 DeepSeekMoE 架构(Dai et al., 2024). DeepSeekMoE 有两个核心思想: 一是将专家分割为更细的粒度以实现更高的专家专业化和更准确的知识获取, 二是隔离一些共享专家以缓解路由专家之间的知识冗余. 在激活参数和总参数数量相同的情况下, DeepSeekMoE 可以大幅超越传统的 MoE 架构(如 GShard(Lepikhin et al., 2021)).

> 译者注: "细粒度专家分割+共享专家隔离"是 DeepSeekMoE 的两大设计创新. 细粒度分割让每个专家专注于更窄的知识领域, 避免了传统 MoE 中"一个专家什么都学一点"的泛化问题. 共享专家则负责学习所有 token 都需要的通用知识(如语法、常识), 防止路由专家重复学习这些基础内容. 这个设计在后续的 DeepSeek-V3 中被进一步放大: V3 的无辅助损失负载均衡策略就是基于 DeepSeekMoE 的负载均衡机制演化而来.

Let $\mathbf{u}_t$ be the FFN input of the $t$-th token, we compute the FFN output $\mathbf{h}_t'$ as follows:

设 $\mathbf{u}_t$ 为第 $t$ 个 token 的 FFN 输入, 我们按如下方式计算 FFN 输出 $\mathbf{h}_t'$:

$$
\mathbf{h}_t' = \mathbf{u}_t + \sum_{i=1}^{N_s} \text{FFN}_i^{(s)}(\mathbf{u}_t) + \sum_{i=1}^{N_r} g_{i,t} \text{FFN}_i^{(r)}(\mathbf{u}_t), \tag{20}
$$

$$
g_{i,t} = \begin{cases} s_{i,t}, & s_{i,t} \in \text{Topk}(\{s_{j,t} | 1 \leqslant j \leqslant N_r\}, K_r), \\ 0, & \text{otherwise}, \end{cases} \tag{21}
$$

$$
s_{i,t} = \text{Softmax}_i(\mathbf{u}_t^T \mathbf{e}_i), \tag{22}
$$

where $N_s$ and $N_r$ denote the numbers of shared experts and routed experts, respectively; $\text{FFN}_i^{(s)}(\cdot)$ and $\text{FFN}_i^{(r)}(\cdot)$ denote the $i$-th shared expert and the $i$-th routed expert, respectively; $K_r$ denotes the number of activated routed experts; $g_{i,t}$ is the gate value for the $i$-th expert; $s_{i,t}$ is the token-to-expert affinity; $\mathbf{e}_i$ is the centroid of the $i$-th routed expert in this layer; and Topk($\cdot$, $K$) denotes the set comprising $K$ highest scores among the affinity scores calculated for the $t$-th token and all routed experts.

其中 $N_s$ 和 $N_r$ 分别表示共享专家和路由专家的数量; $\text{FFN}_i^{(s)}(\cdot)$ 和 $\text{FFN}_i^{(r)}(\cdot)$ 分别表示第 $i$ 个共享专家和第 $i$ 个路由专家; $K_r$ 表示激活的路由专家数量; $g_{i,t}$ 是第 $i$ 个专家的门控值; $s_{i,t}$ 是 token 与专家之间的亲和度; $\mathbf{e}_i$ 是本层中第 $i$ 个路由专家的质心; Topk($\cdot$, $K$) 表示从第 $t$ 个 token 与所有路由专家计算的亲和度分数中选取 $K$ 个最高分数组成的集合.

> 译者注: 式(20)清晰地展示了 DeepSeekMoE 的计算流程: FFN 输出 = 输入 + 所有共享专家的输出之和 + 被激活的路由专家的加权输出之和. 共享专家($N_s$)不参与路由, 每个 token 都经过它们; 路由专家($N_r$)通过 Top-K 门控选择, 只有 $K_r$ 个被激活. 对于 DeepSeek-V2, $N_s=2$, $N_r=64$, $K_r=6$, 这意味着每个 token 经过 2 个共享专家 + 6 个路由专家, 共 8 个专家.

#### 2.2.2. Device-Limited Routing

We design a device-limited routing mechanism to bound MoE-related communication costs. When expert parallelism is employed, the routed experts will be distributed across multiple devices. For each token, its MoE-related communication frequency is proportional to the number of devices covered by its target experts. Due to the fine-grained expert segmentation in DeepSeekMoE, the number of activated experts can be large, so the MoE-related communication will be more costly if we apply expert parallelism.

我们设计了一种设备受限路由机制来限制 MoE 相关的通信成本. 当采用专家并行时, 路由专家将被分布在多个设备上. 对于每个 token, 其 MoE 相关通信频率与目标专家所覆盖的设备数量成正比. 由于 DeepSeekMoE 的细粒度专家分割, 激活的专家数量可能很大, 因此如果我们应用专家并行, MoE 相关通信将更加昂贵.

For DeepSeek-V2, beyond the naive top-K selection of routed experts, we additionally ensure that the target experts of each token will be distributed on at most $M$ devices. To be specific, for each token, we first select $M$ devices that have experts with the highest affinity scores in them. Then, we perform top-K selection among experts on these $M$ devices. In practice, we find that when $M \geqslant 3$, the device-limited routing can achieve a good performance roughly aligned with the unrestricted top-K routing.

对于 DeepSeek-V2, 除了朴素的路由专家 top-K 选择外, 我们还额外确保每个 token 的目标专家最多分布在 $M$ 个设备上. 具体来说, 对于每个 token, 我们首先选择 $M$ 个拥有最高亲和度分数专家的设备. 然后, 我们在这些 $M$ 个设备上的专家中进行 top-K 选择. 在实践中, 我们发现当 $M \geqslant 3$ 时, 设备受限路由可以达到与无限制 top-K 路由大致对齐的良好性能.

> 译者注: 设备受限路由是一个务实的工程折中. 如果不限制设备数, 每个 token 的 6 个路由专家可能分散在 6 个不同设备上, 导致 All-to-All 通信量爆炸. 限制为 $M=3$ 后, 通信量减半, 但性能几乎不受影响——这说明专家的选择存在一定的"局部性": 高亲和度的专家往往集中在少数设备上. 这个洞察对 MoE 的分布式训练部署至关重要.

#### 2.2.3. Auxiliary Loss for Load Balance

We take the load balance into consideration for automatically learned routing strategies. Firstly, unbalanced load will raise the risk of routing collapse (Shazeer et al., 2017), preventing some experts being fully trained and utilized. Secondly, when expert parallelism is employed, unbalanced load will diminish computation efficiency. During the training of DeepSeek-V2, we design three kinds of auxiliary losses, for controlling expert级负载均衡 $(\mathcal{L}_{\text{ExpBal}})$, 设备级负载均衡 $(\mathcal{L}_{\text{DevBal}})$, and 通信均衡 $(\mathcal{L}_{\text{CommBal}})$, respectively.

我们在自动学习的路由策略中考虑了负载均衡. 首先, 不均衡的负载会增加路由崩溃的风险(Shazeer et al., 2017), 导致某些专家无法被充分训练和利用. 其次, 当采用专家并行时, 不均衡的负载会降低计算效率. 在 DeepSeek-V2 的训练过程中, 我们设计了三种辅助损失, 分别用于控制专家级负载均衡 $(\mathcal{L}_{\text{ExpBal}})$、设备级负载均衡 $(\mathcal{L}_{\text{DevBal}})$ 和通信均衡 $(\mathcal{L}_{\text{CommBal}})$.

Expert-Level Balance Loss. We use an expert-level balance loss (Fedus et al., 2021; Lepikhin et al., 2021) to mitigate the risk of routing collapse:

专家级均衡损失. 我们使用专家级均衡损失(Fedus et al., 2021; Lepikhin et al., 2021)来缓解路由崩溃的风险:

$$
\mathcal{L}_{\text{ExpBal}} = \alpha_1 \sum_{i=1}^{N_r} f_i P_i, \tag{23}
$$

$$
f_i = \frac{N_r}{K_r T} \sum_{t=1}^{T} \mathbf{1}(\text{Token } t \text{ selects Expert } i), \tag{24}
$$

$$
P_i = \frac{1}{T} \sum_{t=1}^{T} s_{i,t}, \tag{25}
$$

where $\alpha_1$ is a hyper-parameter called expert-level balance factor; $\mathbf{1}(\cdot)$ denotes the indicator function; and $T$ denotes the number of tokens in a sequence.

其中 $\alpha_1$ 是一个称为专家级均衡因子的超参数; $\mathbf{1}(\cdot)$ 表示指示函数; $T$ 表示序列中的 token 数量.

> 译者注: 式(23)的专家级均衡损失是 MoE 训练的经典设计. $f_i$ 是专家 $i$ 的实际负载比例(被选中次数归一化), $P_i$ 是专家 $i$ 的期望负载比例(亲和度分数之和归一化). 损失函数 $\sum f_i P_i$ 在负载均衡时取最小值(所有 $f_i = P_i = 1/N_r$). 这个损失直接惩罚"某些专家过载、某些专家闲置"的情况, 是防止路由崩溃的第一道防线.

Device-Level Balance Loss. In addition to the expert-level balance loss, we additionally design a device-level balance loss to ensure balanced computation across different devices. In the training process of DeepSeek-V2, we partition all routed experts into $D$ groups $\{\mathcal{E}_1, \mathcal{E}_2, ..., \mathcal{E}_D\}$ and deploy each group on a single device. The device-level balance loss is computed as follows:

设备级均衡损失. 除了专家级均衡损失外, 我们还额外设计了设备级均衡损失以确保不同设备之间的计算均衡. 在 DeepSeek-V2 的训练过程中, 我们将所有路由专家划分为 $D$ 组 $\{\mathcal{E}_1, \mathcal{E}_2, ..., \mathcal{E}_D\}$, 并将每组部署在单个设备上. 设备级均衡损失计算如下:

$$
\mathcal{L}_{\text{DevBal}} = \alpha_2 \sum_{i=1}^{D} f_i' P_i', \tag{26}
$$

$$
f_i' = \frac{1}{|\mathcal{E}_i|} \sum_{j \in \mathcal{E}_i} f_j, \tag{27}
$$

$$
P_i' = \sum_{j \in \mathcal{E}_i} P_j, \tag{28}
$$

where $\alpha_2$ is a hyper-parameter called device-level balance factor.

其中 $\alpha_2$ 是一个称为设备级均衡因子的超参数.

Communication Balance Loss. Finally, we introduce a communication balance loss to ensure that the communication of each device is balanced. Although the device-limited routing mechanism guarantees that the sending communication of each device is bounded, if a certain device receives more tokens than other devices, the practical communication efficiency will also be affected. In order to mitigate this issue, we design a communication balance loss as follows:

通信均衡损失. 最后, 我们引入通信均衡损失以确保每个设备的通信是均衡的. 尽管设备受限路由机制保证了每个设备的发送通信是有界的, 但如果某个设备接收的 token 比其他设备多, 实际通信效率也会受到影响. 为了缓解这个问题, 我们设计了如下通信均衡损失:

$$
\mathcal{L}_{\text{CommBal}} = \alpha_3 \sum_{i=1}^{D} f_i'' P_i'', \tag{29}
$$

$$
f_i'' = \frac{D}{M T} \sum_{t=1}^{T} \mathbf{1}(\text{Token } t \text{ is sent to Device } i), \tag{30}
$$

$$
P_i'' = \sum_{j \in \mathcal{E}_i} P_j, \tag{31}
$$

where $\alpha_3$ is a hyper-parameter called communication balance factor. The device-limited routing mechanism operates on the principle of ensuring that each device transmits at most $\frac{K_r T}{D}$ hidden states to other devices. Simultaneously, the communication balance loss is employed to encourage each device to receive around $\frac{K_r T}{D}$ hidden states from other devices. The communication balance loss guarantees a balanced exchange of information among devices, promoting efficient communications.

其中 $\alpha_3$ 是一个称为通信均衡因子的超参数. 设备受限路由机制的运作原则是确保每个设备向其他设备传输的隐藏状态数量最多为 $\frac{K_r T}{D}$. 同时, 通信均衡损失被用于鼓励每个设备从其他设备接收约 $\frac{K_r T}{D}$ 个隐藏状态. 通信均衡损失保证了设备之间信息交换的均衡, 促进了高效通信.

> 译者注: 三种均衡损失的设计体现了 DeepSeek 对 MoE 分布式训练的系统性思考. 专家级均衡防止路由崩溃, 设备级均衡确保 GPU 利用率均衡, 通信均衡优化 All-to-All 带宽利用率. 这三层损失叠加, 构成了 DeepSeekMoE 训练的稳定基础. 值得注意的是, 在后续的 DeepSeek-V3 中, 这三层辅助损失被进一步优化为无辅助损失的负载均衡策略——通过偏置项动态调整路由分数, 避免了辅助损失对模型性能的潜在干扰.

#### 2.2.4. Token-Dropping Strategy

While balance losses aim to encourage a balanced load, it is important to acknowledge that they cannot guarantee a strict load balance. In order to further mitigate the computation wastage caused by unbalanced load, we introduce a device-level token-dropping strategy during training. This approach first computes the average computational budget for each device, which means that the capacity factor for each device is equivalent to 1.0. Then, inspired by Riquelme et al. (2021), we drop tokens with the lowest affinity scores on each device until reaching the computational budget. In addition, we ensure that the tokens belonging to approximately 10% of the training sequences will never be dropped. In this way, we can flexibly decide whether to drop tokens during inference according to the efficiency requirements, and always ensure consistency between training and inference.

虽然均衡损失旨在鼓励负载均衡, 但需要注意的是它们不能保证严格的负载均衡. 为了进一步缓解不均衡负载造成的计算浪费, 我们在训练期间引入了设备级 token 丢弃策略. 该方法首先计算每个设备的平均计算预算, 这意味着每个设备的容量因子等效为 1.0. 然后, 受 Riquelme et al. (2021) 启发, 我们丢弃每个设备上亲和度分数最低的 token, 直到达到计算预算. 此外, 我们确保属于约 10% 训练序列的 token 永远不会被丢弃. 这样, 我们可以根据效率需求灵活决定在推理期间是否丢弃 token, 并始终确保训练与推理之间的一致性.

> 译者注: Token 丢弃是 MoE 训练中常见的实践, 但 DeepSeek-V2 的做法有两个细节值得注意: (1) 保留 10% 序列的 token 不被丢弃, 确保模型始终看到完整的序列, 避免因频繁丢弃导致的学习不稳定; (2) 训练和推理的丢弃策略保持一致, 防止训练-推理分布偏移. 这个设计在后续的 V3 中被继承并进一步优化.

## 3. Pre-Training

### 3.1. Experimental Setups

#### 3.1.1. Data Construction

While maintaining the same data processing stages as for DeepSeek 67B (DeepSeek-AI, 2024), we extend the amount of data and elevate the data quality. In order to enlarge our pre-training corpus, we explore the potential of the internet data and optimize our cleaning processes, thus recovering a large amount of mistakenly deleted data. Moreover, we incorporate more Chinese data, aiming to better leverage the corpus available on the Chinese internet. In addition to the amount of data, we also focus on the data quality. We enrich our pre-training corpus with high-quality data from various sources, and meanwhile improve the quality-based filtering algorithm. The improved algorithm ensures that a large amount of non-beneficial data will be removed, while the valuable data will be mostly retained. In addition, we filter out the contentious content from our pre-training corpus to mitigate the data bias introduced from specific regional cultures. A detailed discussion about the influence of this filtering strategy is presented in Appendix E.

在保持与 DeepSeek 67B(DeepSeek-AI, 2024)相同的数据处理阶段的同时, 我们扩展了数据量并提升了数据质量. 为了扩大预训练语料库, 我们探索了互联网数据的潜力并优化了清洗流程, 从而恢复了大量被误删的数据. 此外, 我们引入了更多中文数据, 旨在更好地利用中文互联网上的语料. 除了数据量, 我们还关注数据质量. 我们用来自各种来源的高质量数据丰富了预训练语料库, 同时改进了基于质量的过滤算法. 改进后的算法确保大量无益数据被移除, 而有价值的数据大部分被保留. 此外, 我们从预训练语料库中过滤掉了有争议的内容, 以缓解特定区域文化引入的数据偏见. 关于该过滤策略影响的详细讨论见附录 E.

> 译者注: 数据工程是模型性能的基础, 但往往被技术报告轻描淡写. DeepSeek-V2 的语料库建设有几个值得注意的细节: (1) "恢复误删数据"暗示他们重新审视了之前的过滤策略, 发现过度清洗导致信息损失; (2) 中文数据占比提升(后文提到中文 token 比英文多 12%), 这是 DeepSeek 在中文能力上超越 LLaMA3 的关键; (3) 过滤"有争议内容"以减少区域文化偏见——这个策略的伦理影响在附录 E 中有讨论, 但本质上是一种价值对齐的前置操作.

We adopt the same tokenizer as used in DeepSeek 67B, which is built based on the Byte-level Byte-Pair Encoding (BBPE) algorithm and has a vocabulary size of 100K. Our tokenized pretraining corpus contains 8.1T tokens, where Chinese tokens are approximately 12% more than English ones.

我们采用与 DeepSeek 67B 相同的分词器, 它基于 Byte-level Byte-Pair Encoding(BBPE, 字节级字节对编码)算法构建, 词表大小为 100K. 我们分词后的预训练语料库包含 8.1T tokens, 其中中文 tokens 比英文多约 12%.

#### 3.1.2. Hyper-Parameters

Model Hyper-Parameters. We set the number of Transformer layers to 60 and the hidden dimension to 5120. All learnable parameters are randomly initialized with a standard deviation of 0.006. In MLA, we set the number of attention heads $n_h$ to 128 and the per-head dimension $d_h$ to 128. The KV compression dimension $d_c$ is set to 512, and the query compression dimension $d_c'$ is set to 1536. For the decoupled queries and key, we set the per-head dimension $d_h^R$ to 64. Following Dai et al. (2024), we substitute all FFNs except for the first layer with MoE layers. Each MoE layer consists of 2 shared experts and 160 routed experts, where the intermediate hidden dimension of each expert is 1536. Among the routed experts, 6 experts will be activated for each token. In addition, the low-rank compression and fine-grained expert segmentation will impact the output scale of a layer. Therefore, in practice, we employ additional RMS Norm layers after the compressed latent vectors, and multiply additional scaling factors at the width bottlenecks (i.e., the compressed latent vectors and the intermediate hidden states of routed experts) to ensure stable training. Under this configuration, DeepSeek-V2 comprises 236B total parameters, of which 21B are activated for each token.

模型超参数. 我们将 Transformer 层数设为 60, 隐藏维度设为 5120. 所有可学习参数以 0.006 的标准差随机初始化. 在 MLA 中, 我们将注意力头数 $n_h$ 设为 128, 每头维度 $d_h$ 设为 128. KV 压缩维度 $d_c$ 设为 512, query 压缩维度 $d_c'$ 设为 1536. 对于解耦 queries 和 key, 我们将每头维度 $d_h^R$ 设为 64. 遵循 Dai et al. (2024)的做法, 我们将除第一层外的所有 FFN 替换为 MoE 层. 每个 MoE 层由 2 个共享专家和 160 个路由专家组成, 每个专家的中间隐藏维度为 1536. 在路由专家中, 每个 token 激活 6 个专家. 此外, 低秩压缩和细粒度专家分割会影响层的输出尺度. 因此, 在实践中, 我们在压缩后的潜在向量后使用额外的 RMS Norm 层, 并在宽度瓶颈处(即压缩后的潜在向量和路由专家的中间隐藏状态)乘以额外的缩放因子以确保训练稳定. 在此配置下, DeepSeek-V2 总参数量为 236B, 每个 token 激活 21B 参数.

> 译者注: 这些超参数是复现 DeepSeek-V2 的关键. 特别值得注意: (1) 60 层 / 5120 隐藏维度 / 128 头, 这是一个相对"瘦高"的配置; (2) MLA 的压缩比: query 从 16384 维压缩到 1536 维(约 10:1), KV 从 16384 维压缩到 512 维(约 32:1); (3) MoE 配置: 160 路由专家中选 6 个, 加上 2 个共享专家, 每个 token 经过 8 个专家; (4) 额外的 RMS Norm 和缩放因子是训练稳定性的关键工程技巧, 否则低秩压缩后的数值范围可能导致梯度爆炸或消失.

Training Hyper-Parameters. We employ the AdamW optimizer (Loshchilov and Hutter, 2017) with hyper-parameters set to $\beta_1 = 0.9$, $\beta_2 = 0.95$, and weight_decay = 0.1. The learning rate is scheduled using a warmup-and-step-decay strategy (DeepSeek-AI, 2024). Initially, the learning rate linearly increases from 0 to the maximum value during the first 2K steps. Subsequently, the learning rate is multiplied by 0.316 after training about 60% of tokens, and again by 0.316 after training about 90% of tokens. The maximum learning rate is set to $2.4 \times 10^{-4}$, and the gradient clipping norm is set to 1.0. We also use a batch size scheduling strategy, where the batch size is gradually increased from 2304 to 9216 in the training of the first 225B tokens, and then keeps 9216 in the remaining training. We set the maximum sequence length to 4K, and train DeepSeek-V2 on 8.1T tokens. We leverage pipeline parallelism to deploy different layers of a model on different devices, and for each layer, the routed experts will be uniformly deployed on 8 devices ($D = 8$). As for the device-limited routing, each token will be sent to at most 3 devices ($M = 3$). As for balance losses, we set $\alpha_1$ to 0.003, $\alpha_2$ to 0.05, and $\alpha_3$ to 0.02. We employ the token-dropping strategy during training for acceleration, but do not drop any tokens for evaluation.

训练超参数. 我们采用 AdamW 优化器(Loshchilov and Hutter, 2017), 超参数设为 $\beta_1 = 0.9$, $\beta_2 = 0.95$, weight_decay = 0.1. 学习率使用 warmup-and-step-decay 策略调度(DeepSeek-AI, 2024). 初始阶段, 学习率在前 2K 步中线性增长至最大值. 随后, 在训练约 60% tokens 后学习率乘以 0.316, 在训练约 90% tokens 后再次乘以 0.316. 最大学习率设为 $2.4 \times 10^{-4}$, 梯度裁剪范数设为 1.0. 我们还使用了批大小调度策略, 在前 225B tokens 的训练中批大小从 2304 逐步增加到 9216, 然后在剩余训练中保持 9216. 我们将最大序列长度设为 4K, 在 8.1T tokens 上训练 DeepSeek-V2. 我们利用流水线并行将模型的不同层部署在不同设备上, 对于每一层, 路由专家将均匀部署在 8 个设备上($D = 8$). 对于设备受限路由, 每个 token 最多被发送到 3 个设备($M = 3$). 对于均衡损失, 我们将 $\alpha_1$ 设为 0.003, $\alpha_2$ 设为 0.05, $\alpha_3$ 设为 0.02. 我们在训练期间采用 token 丢弃策略以加速, 但在评测期间不丢弃任何 token.

> 译者注: 学习率调度中的 $0.316 \approx \sqrt{0.1}$, 即每次衰减约 10 倍(分两步). 批大小从 2304 增至 9216(4 倍)是大型模型训练的标准做法: 前期小 batch 稳定训练, 后期大 batch 提高吞吐量. 4K 序列长度用于预训练, 后续通过 YaRN 扩展到 128K——这种"先短后长"的策略避免了长序列预训练的高昂成本.

#### 3.1.3. Infrastructures

DeepSeek-V2 is trained based on the HAI-LLM framework (High-flyer, 2023), an efficient and light-weight training框架 developed internally by our engineers. It employs a 16-way zero-bubble pipeline parallelism (Qi et al., 2023), an 8-way expert parallelism (Lepikhin et al., 2021), and ZeRO-1 data parallelism (Rajbhandari et al., 2020). Given that DeepSeek-V2 has relatively few activated parameters, and a portion of the operators are recomputed to save activation内存, it can be trained without the necessity of tensor parallelism, thereby decreasing the communication overhead. Moreover, in order to further improve the training efficiency, we overlap the computation of shared experts with the expert parallel all-to-all communication. We also customize faster CUDA kernels for communications, routing algorithms, and fused linear computations across different experts. In addition, MLA is also optimized based on an improved version of FlashAttention-2 (Dao, 2023).

DeepSeek-V2 基于 HAI-LLM 框架(High-flyer, 2023)进行训练, 这是我们工程师内部开发的高效轻量级训练框架. 它采用 16 路 zero-bubble 流水线并行(Qi et al., 2023)、8 路专家并行(Lepikhin et al., 2021)和 ZeRO-1 数据并行(Rajbhandari et al., 2020). 鉴于 DeepSeek-V2 的激活参数相对较少, 且部分算子被重计算以节省激活内存, 它可以在不需要张量并行的情况下进行训练, 从而减少了通信开销. 此外, 为了进一步提高训练效率, 我们将共享专家的计算与专家并行的 all-to-all 通信重叠. 我们还为通信、路由算法和跨不同专家的融合线性计算定制了更快的 CUDA 内核. 此外, MLA 也基于改进版的 FlashAttention-2(Dao, 2023)进行了优化.

> 译者注: "不需要张量并行"是一个重要的工程决策. 张量并行(TP)虽然能分摊单层参数量, 但会带来频繁的跨 GPU 通信(每层的 attention 和 FFN 都需要 all-reduce). DeepSeek-V2 通过 MLA 的 KV 压缩和 MoE 的稀疏激活, 使得单层参数量足够小, 可以放在单个 GPU 上, 从而省去了 TP. 这直接减少了通信开销, 也是 DeepSeek-V2 能在 H800 集群上高效训练的原因之一. 后续的 V3 在此基础上引入了更激进的 DualPipe 流水线并行, 进一步消除了流水线气泡.

Pressure Testing DeepSeek-V2 Base 128K Context via "Needle In A HayStack"
![](images/fig04_niah_test.jpg)
Figure 4 | Evaluation results on the "Needle In A Haystack" (NIAH) tests. DeepSeek-V2 performs well across all context window lengths up to 128K.

> 图 4: "大海捞针"(NIAH)测试结果. DeepSeek-V2 在所有不超过 128K 的上下文窗口长度上表现良好.

We conduct all experiments on a cluster equipped with NVIDIA H800 GPUs. Each node in the H800 cluster contains 8 GPUs connected using NVLink and NVSwitch within nodes. Across nodes, InfiniBand interconnects are utilized to facilitate communications.

所有实验都在配备 NVIDIA H800 GPU 的集群上进行. H800 集群中的每个节点包含 8 个 GPU, 节点内通过 NVLink 和 NVSwitch 连接. 跨节点则使用 InfiniBand 互连来促进通信.

#### 3.1.4. Long Context Extension

After the initial pre-training of DeepSeek-V2, we employ YaRN (Peng et al., 2023) to extend the default context window length from 4K to 128K. YaRN was specifically applied to the decoupled shared key $\mathbf{k}_t^R$ as it is responsible for carrying RoPE (Su et al., 2024). For YaRN, we set the scale $s$ to 40, $\alpha$ to 1, $\beta$ to 32, and the target maximum context length to 160K. Under these settings, we can expect the model to respond well for a context length of 128K. Slightly diverging from original YaRN, due to our distinct attention mechanism, we adjust the length scaling factor to modulate the attention entropy. The factor $t$ is computed as $t = 0.0707 \ln s + 1$, aiming at minimizing the perplexity.

在 DeepSeek-V2 的初始预训练之后, 我们采用 YaRN(Peng et al., 2023)将默认上下文窗口长度从 4K 扩展到 128K. YaRN 专门应用于解耦共享 key $\mathbf{k}_t^R$, 因为它负责承载 RoPE(Su et al., 2024). 对于 YaRN, 我们将尺度 $s$ 设为 40, $\alpha$ 设为 1, $\beta$ 设为 32, 目标最大上下文长度设为 160K. 在这些设置下, 我们可以预期模型在 128K 上下文长度上表现良好. 由于我们的注意力机制与原始 YaRN 不同, 我们对长度缩放因子进行了微调以调节注意力熵. 因子 $t$ 计算为 $t = 0.0707 \ln s + 1$, 旨在最小化困惑度.

> 译者注: YaRN 是一种不需要重新预训练就能扩展上下文窗口的技术, 核心是通过调整 RoPE 的频率缩放来适配更长的位置索引. DeepSeek-V2 只训练了 1000 步(约 32K 长度)就完成了 128K 扩展, 这验证了 YaRN 的高效性. 但需要注意的是, NIAH 测试只是"大海捞针"——检测模型能否在超长序列中定位特定信息, 并不能完全代表真实的长文档推理能力.

We additionally train the model for 1000 steps, with a sequence length of 32K and a batch size of 576 sequences. Although the training is conducted solely at the sequence length of 32K, the model still demonstrates robust performance when being evaluated at a context length of 128K. As shown in Figure 4, the results on the "Needle In A Haystack" (NIAH) tests indicate that DeepSeek-V2 performs well across all context window lengths up to 128K.

我们额外训练了模型 1000 步, 序列长度为 32K, 批大小为 576 个序列. 尽管训练仅在 32K 序列长度上进行, 但模型在 128K 上下文长度评测时仍表现出稳健的性能. 如图 4 所示, "大海捞针"(NIAH)测试结果 indicate that DeepSeek-V2 在所有不超过 128K 的上下文窗口长度上表现良好.

### 3.2. Evaluations

#### 3.2.1. Evaluation Benchmarks

DeepSeek-V2 is pretrained on a bilingual corpus, so we evaluate it on a series of benchmarks in English and Chinese. Our evaluation is based on our internal evaluation framework integrated in our HAI-LLM framework. Included benchmarks are categorized and listed as follows, where underlined benchmarks are in Chinese:

DeepSeek-V2 在双语语料库上预训练, 因此我们在英文和中文的一系列基准测试上对其进行评测. 我们的评测基于集成在 HAI-LLM 框架中的内部评测框架. 包含的基准测试分类如下, 其中带下划线的为中文基准:

Multi-subject multiple-choice datasets include MMLU (Hendrycks et al., 2020), C-Eval (Huang et al., 2023), and CMMLU (Li et al., 2023).

多学科多选数据集包括 MMLU(Hendrycks et al., 2020)、C-Eval(Huang et al., 2023)和 CMMLU(Li et al., 2023).

Language understanding and reasoning datasets include HellaSwag (Zellers et al., 2019), PIQA (Bisk et al., 2020), ARC (Clark et al., 2018), and BigBench Hard (BBH) (Suzgun et al., 2022).

语言理解与推理数据集包括 HellaSwag(Zellers et al., 2019)、PIQA(Bisk et al., 2020)、ARC(Clark et al., 2018)和 BigBench Hard(BBH)(Suzgun et al., 2022).

Closed-book question answering datasets include TriviaQA (Joshi et al., 2017) and NaturalQuestions (Kwiatkowski et al., 2019).

闭卷问答数据集包括 TriviaQA(Joshi et al., 2017)和 NaturalQuestions(Kwiatkowski et al., 2019).

Reading comprehension datasets include RACE (Lai et al., 2017), DROP (Dua et al., 2019), C3 (Sun et al., 2019), and CMRC (Cui et al., 2019).

阅读理解数据集包括 RACE(Lai et al., 2017)、DROP(Dua et al., 2019)、C3(Sun et al., 2019)和 CMRC(Cui et al., 2019).

Reference disambiguation datasets include WinoGrande (Sakaguchi et al., 2019) and CLUEWSC (Xu et al., 2020).

指代消歧数据集包括 WinoGrande(Sakaguchi et al., 2019)和 CLUEWSC(Xu et al., 2020).

Language modeling datasets include Pile (Gao et al., 2020).

语言建模数据集包括 Pile(Gao et al., 2020).

Chinese understanding and culture datasets include CHID (Zheng et al., 2019) and CCPM (Li et al., 2021).

中文理解与文化数据集包括 CHID(Zheng et al., 2019)和 CCPM(Li et al., 2021).

Math datasets include GSM8K (Cobbe et al., 2021), MATH (Hendrycks et al., 2021), and CMath (Wei et al., 2023).

数学数据集包括 GSM8K(Cobbe et al., 2021)、MATH(Hendrycks et al., 2021)和 CMath(Wei et al., 2023).

Code datasets include HumanEval (Chen et al., 2021), MBPP (Austin et al., 2021), and CRUXEval (Gu et al., 2024).

代码数据集包括 HumanEval(Chen et al., 2021)、MBPP(Austin et al., 2021)和 CRUXEval(Gu et al., 2024).

Standardized exams include AGIEval (Zhong et al., 2023). Note that AGIEval includes both English and Chinese subsets.

标准化考试包括 AGIEval(Zhong et al., 2023). 注意 AGIEval 包含英文和中文子集.

Following our previous work (DeepSeek-AI, 2024), we adopt perplexity-based evaluation for datasets including HellaSwag, PIQA, WinoGrande, RACE-Middle, RACE-High, MMLU, ARC-Easy, ARC-Challenge, CHID, C-Eval, CMMLU, C3, and CCPM, and adopt generation-based evaluation for TriviaQA, NaturalQuestions, DROP, MATH, GSM8K, HumanEval, MBPP, CRUXEval, BBH, AGIEval, CLUEWSC, CMRC, and CMath. In addition, we perform language-modeling-based evaluation for Pile-test and use Bits-Per-Byte (BPB) as the metric to guarantee fair comparison among models with different tokenizers.

遵循我们先前的工作(DeepSeek-AI, 2024), 我们对 HellaSwag、PIQA、WinoGrande、RACE-Middle、RACE-High、MMLU、ARC-Easy、ARC-Challenge、CHID、C-Eval、CMMLU、C3 和 CCPM 等数据集采用基于困惑度的评测, 对 TriviaQA、NaturalQuestions、DROP、MATH、GSM8K、HumanEval、MBPP、CRUXEval、BBH、AGIEval、CLUEWSC、CMRC 和 CMath 采用基于生成的评测. 此外, 我们对 Pile-test 执行基于语言建模的评测, 并使用 Bits-Per-Byte(BPB, 每字节比特数)作为指标, 以保证不同分词器模型之间的公平比较.

For an intuitive overview of these benchmarks, we additionally provide our evaluation formats for each benchmark in Appendix G.

为了直观了解这些基准测试, 我们在附录 G 中额外提供了每个基准测试的评测格式.

#### 3.2.2. Evaluation Results

In Table 2, we compare DeepSeek-V2 with several representative open-source models, including DeepSeek 67B (DeepSeek-AI, 2024) (our previous release), Qwen1.5 72B (Bai et al., 2023), LLaMA3 70B (AI@Meta, 2024), and Mixtral 8x22B (Mistral, 2024). We evaluate all these models with our internal evaluation framework, and ensure that they share the same evaluation setting. Overall, with only 21B activated parameters, DeepSeek-V2 significantly outperforms DeepSeek 67B on almost all benchmarks, and achieves top-tier performance among open-source models.

在表 2 中, 我们将 DeepSeek-V2 与几个代表性开源模型进行了比较, 包括 DeepSeek 67B(DeepSeek-AI, 2024)(我们先前发布的版本)、Qwen1.5 72B(Bai et al., 2023)、LLaMA3 70B(AI@Meta, 2024)和 Mixtral 8x22B(Mistral, 2024). 我们在内部评测框架中评测了所有这些模型, 并确保它们使用相同的评测设置. 总体而言, 即使仅有 21B 激活参数, DeepSeek-V2 在几乎所有基准测试上都显著超越了 DeepSeek 67B, 并在开源模型中达到了顶级性能.

> 译者注: 评测结果的对比需要谨慎解读. DeepSeek 使用自己的内部框架评测所有模型, 虽然确保了"相同设置", 但不同框架的实现细节(如 prompt 模板、解码参数、后处理逻辑)可能导致分数差异. 例如, 同样的 MMLU 测试, 不同框架的 few-shot prompt 构造方式不同, 分数可能相差 1-2 个百分点. 最可靠的对比应该是第三方独立复现, 但开源模型评测生态目前缺乏这样的标准.

Further, we elaborately compare DeepSeek-V2 with its open-source counterparts one by one. (1) Compared with Qwen1.5 72B, another model that supports both Chinese and English, DeepSeek-V2 demonstrates overwhelming advantages on the majority of English、code、and math benchmarks. As for Chinese benchmarks, Qwen1.5 72B shows better performance on multi-subject multiple-choice tasks while DeepSeek-V2 is comparable or better on others. Note that for the CHID benchmark, the tokenizer of Qwen1.5 72B will encounter errors in our evaluation framework, so we leave the CHID score blank for Qwen1.5 72B. (2) Compared with Mixtral 8x22B, DeepSeek-V2 achieves comparable or better English performance, except for TriviaQA, NaturalQuestions, and HellaSwag, which are closely related to English commonsense knowledge. Notably, DeepSeek-V2 outperforms Mixtral 8x22B on MMLU. On code and math benchmarks, DeepSeek-V2 demonstrates comparable performance with Mixtral 8x22B. Since Mixtral 8x22B is not specifically trained on Chinese data, its Chinese capability lags far behind DeepSeek-V2. (3) Compared with LLaMA3 70B, DeepSeek-V2 is trained on fewer than a quarter of English tokens. Therefore, we acknowledge that DeepSeek-V2 still has a slight gap in basic English capabilities with LLaMA3 70B. However, even with much fewer training tokens and activated parameters, DeepSeek-V2 still demonstrates comparable code and math capability with LLaMA3 70B. Also, as a bilingual language model, DeepSeek-V2 outperforms LLaMA3 70B overwhelmingly on Chinese benchmarks.

进一步, 我们逐一详细比较 DeepSeek-V2 与其开源对手. (1) 与另一个支持中英双语的模型 Qwen1.5 72B 相比, DeepSeek-V2 在大多数英文、代码和数学基准测试上展现出压倒性优势. 在中文基准测试方面, Qwen1.5 72B 在多学科多选任务上表现更好, 而 DeepSeek-V2 在其他任务上相当或更好. 注意, 对于 CHID 基准测试, Qwen1.5 72B 的分词器在我们的评测框架中会遇到错误, 因此我们将 Qwen1.5 72B 的 CHID 分数留空. (2) 与 Mixtral 8x22B 相比, DeepSeek-V2 在英文性能上达到相当或更好的水平, 除了 TriviaQA、NaturalQuestions 和 HellaSwag——这些与英文常识知识密切相关. 值得注意的是, DeepSeek-V2 在 MMLU 上超越了 Mixtral 8x22B. 在代码和数学基准测试上, DeepSeek-V2 与 Mixtral 8x22B 表现相当. 由于 Mixtral 8x22B 未专门针对中文数据训练, 其中文能力远落后于 DeepSeek-V2. (3) 与 LLaMA3 70B 相比, DeepSeek-V2 使用的英文训练 tokens 不到其四分之一. 因此, 我们承认 DeepSeek-V2 在基础英文能力上与 LLaMA3 70B 仍有微小差距. 然而, 即使训练 tokens 和激活参数都少得多, DeepSeek-V2 在代码和数学能力上仍与 LLaMA3 70B 表现相当. 此外, 作为双语语言模型, DeepSeek-V2 在中文基准测试上大幅超越 LLaMA3 70B.

> 译者注: 这三组对比揭示了 DeepSeek-V2 的能力谱系: 中文 > 英文常识, 代码/数学 ~= LLaMA3, 整体 ~= Mixtral 8x22B. 作者诚实地承认了英文基础能力的差距——这源于训练数据量的差异(LLaMA3 使用了约 15T tokens, DeepSeek-V2 约 8.1T). 但 MoE 架构的优势在于: 用更少的激活参数和训练数据, 在特定领域(代码、数学)达到相当水平, 这验证了稀疏激活的样本效率.

Table 2 | Comparison among DeepSeek-V2 and other representative open-source models. All models are evaluated in our internal framework and share the same evaluation setting. Bold denotes the best and underline denotes the second-best. Scores with a gap smaller than 0.3 are regarded as at the same level. With only 21B activated parameters, DeepSeek-V2 achieves top-tier performance among open-source models.

表 2 | DeepSeek-V2 与其他代表性开源模型的比较. 所有模型均在我们的内部框架中评测并共享相同的评测设置. 粗体表示最佳, 下划线表示次佳. 差距小于 0.3 的分数被视为同一水平. 即使仅有 21B 激活参数, DeepSeek-V2 仍在开源模型中达到顶级性能.

Finally, it is worth mentioning that certain prior studies (Hu et al., 2024) incorporate SFT data during the pre-training stage, whereas DeepSeek-V2 has never been exposed to SFT data during pre-training.

最后值得一提的是, 某些先前研究(Hu et al., 2024)在预训练阶段就加入了 SFT 数据, 而 DeepSeek-V2 在预训练期间从未接触 SFT 数据.

> 译者注: 这句话是在回应当时社区对"预训练混入 SFT 数据以刷分"的质疑. 一些模型通过在预训练后期加入指令数据来提升 benchmark 分数, 但这种做法会污染评测结果. DeepSeek-V2 明确声明没有这样做, 增强了其评测结果的可信度.

#### 3.2.3. Training and Inference Efficiency

Training Costs. Since DeepSeek-V2 activates fewer parameters for each token and requires fewer FLOPs than DeepSeek 67B, training DeepSeek-V2 will be more economical than training DeepSeek 67B theoretically. Although training an MoE model will introduce additional communication overheads, through our operator and communication optimizations, the training for DeepSeek-V2 can attain a relatively high Model FLOPs Utilization (MFU). During our practical training on the H800 cluster, for training on each trillion tokens, DeepSeek 67B requires 300.6K GPU hours, while DeepSeek-V2 needs only 172.8K GPU hours, i.e., sparse DeepSeek-V2 can save 42.5% training costs compared with dense DeepSeek 67B.

训练成本. 由于 DeepSeek-V2 每个 token 激活的参数更少, 且所需的 FLOPs 低于 DeepSeek 67B, 理论上训练 DeepSeek-V2 比训练 DeepSeek 67B 更经济. 尽管训练 MoE 模型会引入额外的通信开销, 但通过我们的算子和通信优化, DeepSeek-V2 的训练可以达到相对较高的 Model FLOPs Utilization(MFU, 模型 FLOPs 利用率). 在 H800 集群上的实际训练中, 每训练 1T tokens, DeepSeek 67B 需要 300.6K GPU 小时, 而 DeepSeek-V2 仅需 172.8K GPU 小时, 即稀疏的 DeepSeek-V2 相比稠密的 DeepSeek 67B 可节省 42.5% 的训练成本.

> 译者注: 42.5% 的成本节省是理论优势(稀疏激活减少 FLOPs)和工程优化(高 MFU)共同作用的结果. 值得注意的是, MoE 的训练 MFU 通常低于 Dense 模型(因为 all-to-all 通信会打断计算流水线), 但 DeepSeek-V2 通过共享专家计算与通信重叠、定制 CUDA 内核等手段, 将 MFU 维持在了与 Dense 模型相当的水平. 这是 MoE 从"理论上省钱"到"实际上省钱"的关键.

Inference Efficiency. In order to efficiently deploy DeepSeek-V2 for service, we first convert its parameters into the precision of FP8. In addition, we also perform KV cache quantization (Hooper et al., 2024; Zhao et al., 2023) for DeepSeek-V2 to further compress each element in its KV cache into 6 bits on average. Benefiting from MLA and these optimizations, actually deployed DeepSeek-V2 requires significantly less KV cache than DeepSeek 67B, and thus can serve a much larger batch size. We evaluate the generation throughput of DeepSeek-V2 based on the prompt and generation length distribution from the actually deployed DeepSeek 67B service. On a single node with 8 H800 GPUs, DeepSeek-V2 achieves a generation throughput exceeding 50K tokens per second, which is 5.76 times the maximum generation throughput of DeepSeek 67B. In addition, the prompt input throughput of DeepSeek-V2 exceeds 100K tokens per second.

推理效率. 为了高效部署 DeepSeek-V2 用于服务, 我们首先将其参数转换为 FP8 精度. 此外, 我们还对 DeepSeek-V2 执行 KV 缓存量化(Hooper et al., 2024; Zhao et al., 2023), 以进一步将其 KV 缓存中的每个元素平均压缩到 6 比特. 受益于 MLA 和这些优化, 实际部署的 DeepSeek-V2 所需的 KV 缓存远小于 DeepSeek 67B, 因此可以服务更大的批处理大小. 我们基于实际部署的 DeepSeek 67B 服务的 prompt 和生成长度分布来评测 DeepSeek-V2 的生成吞吐量. 在配备 8 个 H800 GPU 的单个节点上, DeepSeek-V2 实现了超过 50K tokens/秒的生成吞吐量, 是 DeepSeek 67B 最大生成吞吐量的 5.76 倍. 此外, DeepSeek-V2 的 prompt 输入吞吐量超过 100K tokens/秒.

> 译者注: FP8 量化 + KV cache 6-bit 量化是推理部署的关键优化. FP8 将权重精度从 FP16/BF16 减半, 直接减少显存占用和内存带宽压力; 6-bit KV 量化则进一步压缩了 MLA 本已大幅减少的 KV 缓存. 50K tokens/秒的生成吞吐量意味着单节点可以支撑相当大的在线服务流量. 但需要注意: 这个吞吐量是在特定长度分布下测得的, 对于超长序列(如 128K), 由于 KV 缓存随序列线性增长, 实际吞吐量会显著下降.

## 4. Alignment

### 4.1. Supervised Fine-Tuning

Building upon our prior research (DeepSeek-AI, 2024), we curate our instruction tuning datasets to include 1.5M instances, comprising 1.2M instances for helpfulness and 0.3M instances for safety. In comparison to the initial version, we improve the data quality to mitigate hallucinatory responses and enhance writing proficiency. We fine-tune DeepSeek-V2 with 2 epochs, and the learning rate is set to $5 \times 10^{-6}$. For the evaluation of DeepSeek-V2 Chat (SFT), we mainly include generation-based benchmarks, except for several representative multiple-choice tasks (MMLU and ARC). We also conduct an instruction-following evaluation (IFEval) (Zhou et al., 2023) for DeepSeek-V2 Chat (SFT), using prompt-level loose accuracy as the metric. Moreover, we employ LiveCodeBench (Jain et al., 2024) questions from September 1st, 2023 to April 1st, 2024 to evaluate chat models. In addition to the standard benchmarks, we further evaluate our model on open-ended conversation benchmarks including MT-Bench (Zheng et al., 2023), AlpacaEval 2.0 (Dubois et al., 2024), and AlignBench (Liu et al., 2023). For comparison, we also evaluate Qwen1.5 72B Chat, LLaMA-3-70B Instruct, and Mistral-8x22B Instruct in our evaluation framework and settings. As for DeepSeek 67B Chat, we directly refer to the evaluation results reported in our previous release.

基于我们先前的研究(DeepSeek-AI, 2024), 我们策划了包含 150 万个实例的指令微调数据集, 其中 120 万个实例用于有用性(helpfulness), 30 万个实例用于安全性(safety). 与初始版本相比, 我们改进了数据质量以缓解幻觉回复并提升写作能力. 我们对 DeepSeek-V2 微调 2 个 epoch, 学习率设为 $5 \times 10^{-6}$. 对于 DeepSeek-V2 Chat (SFT) 的评测, 我们主要包含基于生成的基准测试, 除了几个代表性多选任务(MMLU 和 ARC). 我们还对 DeepSeek-V2 Chat (SFT) 执行指令遵循评测(IFEval)(Zhou et al., 2023), 使用 prompt 级宽松准确率作为指标. 此外, 我们采用 LiveCodeBench(Jain et al., 2024)中 2023 年 9 月 1 日至 2024 年 4 月 1 日的问题来评测对话模型. 除了标准基准测试, 我们还在开放式对话基准测试上进一步评测模型, 包括 MT-Bench(Zheng et al., 2023)、AlpacaEval 2.0(Dubois et al., 2024)和 AlignBench(Liu et al., 2023). 作为对比, 我们还在自己的评测框架和设置中评测了 Qwen1.5 72B Chat、LLaMA-3-70B Instruct 和 Mistral-8x22B Instruct. 对于 DeepSeek 67B Chat, 我们直接引用先前发布中报告的评测结果.

### 4.2. Reinforcement Learning

In order to further unlock the potential of DeepSeek-V2 and align it with human preference, we conduct Reinforcement Learning (RL) to adjust its preference.

为了进一步释放 DeepSeek-V2 的潜力并使其与人类偏好对齐, 我们进行强化学习(RL)来调整其偏好.

Reinforcement Learning Algorithm. In order to save the training costs of RL, we adopt Group Relative Policy Optimization (GRPO) (Shao et al., 2024), which foregoes the critic model that is typically with the same size as the policy model, and estimates the baseline from group scores instead. Specifically, for each question $q$, GRPO samples a group of outputs $\{o_1, o_2, \cdots, o_G\}$ from the old policy $\pi_{\theta_{old}}$ and then optimizes the policy model $\pi_\theta$ by maximizing the following objective:

强化学习算法. 为了节省 RL 的训练成本, 我们采用 Group Relative Policy Optimization(GRPO, 组相对策略优化)(Shao et al., 2024), 它放弃了通常与策略模型大小相同的价值模型(critic model), 转而从组分数中估计基线. 具体来说, 对于每个问题 $q$, GRPO 从旧策略 $\pi_{\theta_{old}}$ 中采样一组输出 $\{o_1, o_2, \cdots, o_G\}$, 然后通过最大化以下目标来优化策略模型 $\pi_\theta$:

$$
\mathcal{J}_{GRPO}(\theta) = \mathbb{E}[q \sim P(Q), \{o_i\}_{i=1}^G \sim \pi_{\theta_{old}}(O|q)] \\ \frac{1}{G} \sum_{i=1}^{G} \left( \min\left( \frac{\pi_\theta(o_i|q)}{\pi_{\theta_{old}}(o_i|q)} A_i, \text{clip}\left( \frac{\pi_\theta(o_i|q)}{\pi_{\theta_{old}}(o_i|q)}, 1-\varepsilon, 1+\varepsilon \right) A_i \right) - \beta \mathbb{D}_{KL}(\pi_\theta || \pi_{ref}) \right), \tag{32}
$$

$$
\mathbb{D}_{KL}(\pi_\theta || \pi_{ref}) = \frac{\pi_{ref}(o_i|q)}{\pi_\theta(o_i|q)} - \log \frac{\pi_{ref}(o_i|q)}{\pi_\theta(o_i|q)} - 1, \tag{33}
$$

where $\varepsilon$ and $\beta$ are hyper-parameters; and $A_i$ is the advantage, computed using a group of rewards $\{r_1, r_2, \ldots, r_G\}$ corresponding to the outputs within each group:

其中 $\varepsilon$ 和 $\beta$ 是超参数; $A_i$ 是优势值, 使用与每组内输出对应的一组奖励 $\{r_1, r_2, \ldots, r_G\}$ 计算:

$$
A_i = \frac{r_i - \text{mean}(\{r_1, r_2, \cdots, r_G\})}{\text{std}(\{r_1, r_2, \cdots, r_G\})}. \tag{34}
$$

> 译者注: GRPO 是 DeepSeek 在 RL 训练上的重要创新. 式(32)的结构与 PPO 类似(都使用 clipped surrogate objective 和 KL 惩罚), 但关键差异在于基线估计: PPO 需要一个与策略模型等大的价值模型来估计状态价值, 而 GRPO 直接用同一组样本的奖励均值作为基线. 这省去了价值模型的训练和存储开销, 对于 236B 参数的模型来说, 显存节省是巨大的. 式(34)的优势计算使用组内标准化, 使得奖励尺度不变, 增强了训练的稳定性. 这个设计在 DeepSeek-R1 中被进一步发扬光大, 成为纯 RL 训练推理能力的核心算法.

Training Strategy. In our preliminary experiments, we find that the RL training on reasoning data, such as code and math prompts, exhibits unique characteristics that are distinct from the training on general data. For example, the mathematical and coding abilities of our model can keep improving over a longer period of training steps. Therefore, we employ a two-stage RL training strategy, which first performs reasoning alignment, and then performs human preference alignment. In the first reasoning alignment stage, we train a reward model $RM_{reasoning}$ for code and math reasoning tasks, and optimize the policy model with the feedback of $RM_{reasoning}$:

训练策略. 在初步实验中, 我们发现 reasoning 数据(如代码和数学 prompt)上的 RL 训练表现出与一般数据训练不同的独特特征. 例如, 模型的数学和编码能力可以在更长的训练步数内持续提升. 因此, 我们采用两阶段 RL 训练策略, 首先执行 reasoning 对齐, 然后执行人类偏好对齐. 在第一阶段的 reasoning 对齐中, 我们为代码和数学 reasoning 任务训练一个奖励模型 $RM_{reasoning}$, 并用 $RM_{reasoning}$ 的反馈优化策略模型:

$$
r_i = RM_{reasoning}(o_i). \tag{35}
$$

In the second human preference alignment stage, we adopt a multi-reward framework, which acquires rewards from a helpful reward model $RM_{helpful}$, a safety reward model $RM_{safety}$, and a rule-based reward model $RM_{rule}$. The final reward of a response $o_i$ is

在第二阶段的人类偏好对齐中, 我们采用多奖励框架, 从有用性奖励模型 $RM_{helpful}$、安全性奖励模型 $RM_{safety}$ 和基于规则的奖励模型 $RM_{rule}$ 获取奖励. 回复 $o_i$ 的最终奖励为

$$
r_i = c_1 \cdot RM_{helpful}(o_i) + c_2 \cdot RM_{safety}(o_i) + c_3 \cdot RM_{rule}(o_i), \tag{36}
$$

where $c_1, c_2$, and $c_3$ are corresponding coefficients.

其中 $c_1, c_2$ 和 $c_3$ 是对应的系数.

> 译者注: 两阶段 RL 策略的设计动机很明确: reasoning 能力(代码、数学)需要专门的奖励信号来引导, 而通用偏好(有用性、安全性)需要另一套信号. 如果混在一起训练, reasoning 的稀疏奖励可能被通用偏好信号淹没. 分阶段训练确保模型先建立强大的推理基础, 再在此基础上对齐人类偏好. 这种"先专后泛"的策略在后续的 DeepSeek-R1 中被彻底颠覆: R1-Zero 完全摒弃了 SFT 和奖励模型, 用纯规则奖励驱动推理能力的涌现.

In order to obtain reliable reward models that play crucial roles in the RL training, we carefully collect preference data, and meticulously conduct quality filtering and proportion adjustments. We obtain code preference data based on compiler-feedback, and mathematical preference data based on the ground-truth labels. For reward model training, we initialize the reward models with DeepSeek-V2 Chat (SFT) and train them with either a point-wise or a pair-wise loss. In our experiments, we observe that the RL training can fully tap into and activate the potential of our model, enabling it to select the correct and satisfactory answer from possible responses.

为了获得在 RL 训练中发挥关键作用的可靠奖励模型, 我们仔细收集偏好数据, 并细致地进行质量过滤和比例调整. 我们基于编译器反馈获取代码偏好数据, 基于真实标签获取数学偏好数据. 对于奖励模型训练, 我们用 DeepSeek-V2 Chat (SFT) 初始化奖励模型, 并使用点式或成对损失训练它们. 在实验中, 我们观察到 RL 训练可以充分挖掘和激活模型的潜力, 使其能够从可能的回复中选择正确且令人满意的答案.

Optimizations for Training Efficiency. Conducting RL training on extremely large models places high demands on the training framework. It requires careful engineering optimization to manage the GPU memory and RAM pressure, and meanwhile maintain a fast training speed. For this goal, we implement the following engineering optimizations. (1) Firstly, we propose a hybrid engine that adopts different parallel strategies for training and inference respectively to achieve higher GPU utilization. (2) Secondly, we leverage vLLM (Kwon et al., 2023) with large batch sizes as our inference backend to accelerate the inference speed. (3) Thirdly, we carefully design a scheduling strategy for offloading models to CPUs and loading models back to GPUs, which achieves a near-optimal balance between the training speed and memory consumption.

训练效率优化. 在超大模型上进行 RL 训练对训练框架提出了很高要求. 它需要精心的工程优化来管理 GPU 内存和 RAM 压力, 同时保持快速的训练速度. 为此, 我们实现了以下工程优化. (1) 首先, 我们提出了一种混合引擎, 分别为训练和推理采用不同的并行策略以实现更高的 GPU 利用率. (2) 其次, 我们利用 vLLM(Kwon et al., 2023)以大批大小作为推理后端来加速推理速度. (3) 第三, 我们精心设计了一种将模型卸载到 CPU 并加载回 GPU 的调度策略, 在训练速度和内存消耗之间实现了接近最优的平衡.

> 译者注: RL 训练的工程挑战在于: 需要同时维护策略模型、参考模型、奖励模型(多个)和 value 模型(如果用 PPO), 这些模型的显存占用是巨大的. DeepSeek-V2 的解决方案包括: 混合并行策略(训练用 DP+PP+EP, 推理用更大的 batch)、vLLM 加速采样、CPU 卸载. 这些优化使得在 236B 模型上进行 RL 训练成为可能. 值得注意的是, 后续的 V3/R1 进一步发展了这些技术, 尤其是 V3 的 FP8 训练和 R1 的 GRPO(省去了 value 模型).

### 4.3. Evaluation Results

Evaluations on Standard Benchmarks. Initially, we evaluate DeepSeek-V2 Chat (SFT) and DeepSeek-V2 Chat (RL) on standard benchmarks. Notably, DeepSeek-V2 Chat (SFT) demonstrates substantial improvements in GSM8K, MATH, and HumanEval evaluations compared with its base version. This progress can be attributed to the inclusion of our SFT data, which comprises a considerable volume of math and code related content. In addition, DeepSeek-V2 Chat (RL) further boosts the performance on math and code benchmarks. We show more code and math evaluations in Appendix F.

标准基准测试评测. 首先, 我们在标准基准测试上评测 DeepSeek-V2 Chat (SFT) 和 DeepSeek-V2 Chat (RL). 值得注意的是, 与基座版本相比, DeepSeek-V2 Chat (SFT) 在 GSM8K、MATH 和 HumanEval 评测上取得了显著提升. 这一进步可归因于 SFT 数据中包含了大量数学和代码相关内容. 此外, DeepSeek-V2 Chat (RL) 进一步提升了数学和代码基准测试上的性能. 我们在附录 F 中展示了更多代码和数学评测.

As for the comparisons with other models, we first compare DeepSeek-V2 Chat (SFT) with Qwen1.5 72B Chat, and find that DeepSeek-V2 Chat (SFT) surpasses Qwen1.5 72B Chat on almost all of English, math, and code benchmarks. On Chinese benchmarks, DeepSeek-V2 Chat (SFT) demonstrates slightly lower scores than Qwen1.5 72B Chat on multi-subject multiple-choice tasks, consistent with the performance observed from their base versions. When compared with the state-of-the-art open-source MoE model, Mixtral 8x22B Instruct, DeepSeek-V2 Chat (SFT) exhibits better performance on most benchmarks, except for NaturalQuestions and IFEval. Furthermore, in comparison to the state-of-the-art open-source model LLaMA3 70B Chat, DeepSeek-V2 Chat (SFT) shows similar performance in code and math related benchmarks. LLaMA3 70B Chat exhibits better performance on MMLU and IFEval, while DeepSeek-V2 Chat (SFT) showcases stronger performance on Chinese tasks. Ultimately, DeepSeek-V2 Chat (RL) demonstrates further enhanced performance in both mathematical and coding tasks compared with DeepSeek-V2 Chat (SFT). These comparisons highlight the strengths of DeepSeek-V2 Chat in relation to other language models in various domains and languages.

与其他模型的对比方面, 我们首先将 DeepSeek-V2 Chat (SFT) 与 Qwen1.5 72B Chat 比较, 发现 DeepSeek-V2 Chat (SFT) 在几乎所有英文、数学和代码基准测试上都超越了 Qwen1.5 72B Chat. 在中文基准测试上, DeepSeek-V2 Chat (SFT) 在多学科多选任务上略低于 Qwen1.5 72B Chat, 与其基座版本观察到的性能一致. 与最先进的开源 MoE 模型 Mixtral 8x22B Instruct 相比, DeepSeek-V2 Chat (SFT) 在大多数基准测试上表现更好, 除了 NaturalQuestions 和 IFEval. 此外, 与最先进的开源模型 LLaMA3 70B Chat 相比, DeepSeek-V2 Chat (SFT) 在代码和数学相关基准测试上表现相似. LLaMA3 70B Chat 在 MMLU 和 IFEval 上表现更好, 而 DeepSeek-V2 Chat (SFT) 在中文任务上展现更强性能. 最终, 与 DeepSeek-V2 Chat (SFT) 相比, DeepSeek-V2 Chat (RL) 在数学和编码任务上进一步提升了性能. 这些对比突出了 DeepSeek-V2 Chat 在不同领域和语言中相对于其他语言模型的优势.

Evaluations on Open-Ended Generation. We proceed with additional evaluations of our models on open-ended conversation benchmarks. For English open-ended conversation generation, we utilize MT-Bench and AlpacaEval 2.0 as the benchmarks. Evaluation results presented in Table 4 demonstrate a significant performance advantage of DeepSeek-V2 Chat (RL) over DeepSeek-V2 Chat (SFT). This outcome showcases the effectiveness of our RL training in achieving improved alignment. In comparison to other open-source models, DeepSeek-V2 Chat (RL) demonstrates superior performance over Mistral 8x22B Instruct and Qwen1.5 72B Chat on both benchmarks. When compared with LLaMA3 70B Instruct, DeepSeek-V2 Chat (RL) showcases competitive performance on MT-Bench and notably outperforms it on AlpacaEval 2.0. These results highlight the strong performance of DeepSeek-V2 Chat (RL) in generating high-quality and contextually relevant responses, particularly in instruction-based conversation tasks.

开放式生成评测. 我们在开放式对话基准测试上进一步评测模型. 对于英文开放式对话生成, 我们使用 MT-Bench 和 AlpacaEval 2.0 作为基准. 表 4 中的评测结果显示, DeepSeek-V2 Chat (RL) 相比 DeepSeek-V2 Chat (SFT) 有显著的性能优势. 这一结果展示了我们 RL 训练在实现对齐方面的有效性. 与其他开源模型相比, DeepSeek-V2 Chat (RL) 在两个基准测试上都超越了 Mistral 8x22B Instruct 和 Qwen1.5 72B Chat. 与 LLaMA3 70B Instruct 相比, DeepSeek-V2 Chat (RL) 在 MT-Bench 上表现相当, 在 AlpacaEval 2.0 上显著超越. 这些结果突出了 DeepSeek-V2 Chat (RL) 在生成高质量和上下文相关回复方面的强大性能, 尤其是在基于指令的对话任务中.

Table 4 
| English open-ended conversation evaluations. For AlpacaEval 2.0, we use the length-controlled win rate as the metric.

表 4 | 英文开放式对话评测. 对于 AlpacaEval 2.0, 我们使用长度控制胜率作为指标.

| Model | MT-Bench | AlpacaEval 2.0 |
|-------|----------|----------------|
| DeepSeek 67B Chat | 8.35 | 16.6 |
| Mistral 8x22B Instruct v0.1 | 8.66 | 30.9 |
| Qwen1.5 72B Chat | 8.61 | 36.6 |
| LLaMA3 70B Instruct | 8.95 | 34.4 |
| DeepSeek-V2 Chat (SFT) | 8.62 | 30.0 |
| DeepSeek-V2 Chat (RL) | 8.97 | 38.9 |

In addition, we evaluate the Chinese open-ended generation capability based on AlignBench. As presented in Table 5, DeepSeek-V2 Chat (RL) exhibits a slight advantage over DeepSeek-V2 Chat (SFT). Notably, DeepSeek-V2 Chat (SFT) surpasses all open-source Chinese models by a significant margin. It significantly outperforms the second-best open-source model, Qwen1.5 72B Chat on both Chinese reasoning and language. Moreover, both DeepSeek-V2 Chat (SFT) and DeepSeek-V2 Chat (RL) outperform GPT-4-0613 and ERNIEBot 4.0, solidifying the position of our models in the top-tier LLMs that support Chinese. Specifically, DeepSeek-V2 Chat (RL) shows remarkable performance in Chinese language understanding, which outperforms all models including GPT-4-Turbo-1106-Preview. On the other hand, the reasoning capability of DeepSeek-V2 Chat (RL) still lags behind giant models, such as Erniebot-4.0 and GPT-4s.

此外, 我们基于 AlignBench 评测中文开放式生成能力. 如表 5 所示, DeepSeek-V2 Chat (RL) 相比 DeepSeek-V2 Chat (SFT) 展现出轻微优势. 值得注意的是, DeepSeek-V2 Chat (SFT) 以显著优势超越了所有开源中文模型. 它在中文推理和语言两方面都显著超越了第二好的开源模型 Qwen1.5 72B Chat. 此外, DeepSeek-V2 Chat (SFT) 和 DeepSeek-V2 Chat (RL) 都超越了 GPT-4-0613 和 ERNIEBot 4.0, 巩固了我们的模型在支持中文的顶级 LLM 中的地位. 具体来说, DeepSeek-V2 Chat (RL) 在中文语言理解方面表现出卓越性能, 超越了包括 GPT-4-Turbo-1106-Preview 在内的所有模型. 另一方面, DeepSeek-V2 Chat (RL) 的推理能力仍落后于大型模型, 如 Erniebot-4.0 和 GPT-4 系列.

Table 5 
| AlignBench leaderboard rated by GPT-4-0613. Models are ranked in descending order based on the overall score. Models marked with * represent that we evaluate them through their API service or open-weighted model, instead of referring to the results reported in their original papers.

表 5 | 由 GPT-4-0613 评分的 AlignBench 排行榜. 模型按总分降序排列. 标有 * 的模型表示我们通过其 API 服务或开放权重模型评测, 而非引用其原始论文报告的结果.

### 4.4. Discussion

Amount of SFT Data. The discussion surrounding the necessity of a large SFT corpus has been a topic of intense debate. Previous works (Young et al., 2024; Zhou et al., 2024) argue that fewer than 10K instances of SFT data are enough to produce satisfactory results. However, in our experiments, we observe a significant performance decline on the IFEval benchmark if we use fewer than 10K instances. A possible explanation is that, a language model necessitates a certain amount of data to develop specific skills. Although the requisite data amount may diminish with the model size increasing, it cannot be entirely eliminated. Our observation underscores the critical need for sufficient data to equip an LLM with desired capabilities. Moreover, the quality of SFT data is also crucial, especially for tasks involving writing或open-ended questions.

SFT 数据量. 关于大规模 SFT 语料库必要性的讨论一直是一个激烈争论的话题. 先前研究(Young et al., 2024; Zhou et al., 2024)认为少于 1 万个实例的 SFT 数据就足以产生满意的结果. 然而, 在我们的实验中, 如果使用少于 1 万个实例, 我们在 IFEval 基准测试上观察到显著的性能下降. 一种可能的解释是, 语言模型需要一定量的数据来发展特定技能. 尽管所需数据量可能随模型规模增大而减少, 但不能完全消除. 我们的观察强调了充足数据对于赋予 LLM 所需能力的关键需求. 此外, SFT 数据的质量也至关重要, 尤其是对于涉及写作或开放式问题的任务.

> 译者注: 这里 DeepSeek 对"SFT 数据量"的争论给出了一个务实的回答: 1 万条不够(至少在 IFEval 上), 150 万条是他们的选择. 但这个数字因任务而异: 指令遵循(IFEval)可能需要更多数据来学习格式约束, 而简单对话可能不需要那么多. 数据质量与数量的权衡是 SFT 的核心工程问题, 没有放之四海而皆准的答案.

Alignment Tax of Reinforcement Learning. During human preference alignment, we observe a significant performance enhancement on the open-ended generation benchmarks, in terms of the scores rated by both AI and human evaluators. However, we also notice a phenomenon of "alignment tax" (Ouyang et al., 2022), i.e., the alignment process can negatively impact the performance on some standard benchmarks such as BBH. In order to alleviate the alignment tax, during the RL stage, we make significant efforts in data处理和improving training strategies, finally achieving a tolerable trade-off between the performance on standard and open-ended benchmarks. Exploring how to align a model with human preferences without compromising its general performance presents a valuable direction for future research.

强化学习的对齐税. 在人类偏好对齐期间, 我们在开放式生成基准测试上观察到显著的性能提升, 无论是 AI 评分还是人类评分. 然而, 我们也注意到"对齐税"现象(Ouyang et al., 2022), 即对齐过程可能对某些标准基准测试(如 BBH)的性能产生负面影响. 为了缓解对齐税, 在 RL 阶段, 我们在数据处理和改进训练策略方面付出了巨大努力, 最终在标准基准测试和开放式基准测试的性能之间实现了可容忍的权衡. 探索如何在不对一般性能造成妥协的情况下使模型与人类偏好对齐, 是未来研究的一个有价值方向.

> 译者注: "对齐税"是 RLHF/RL 的已知问题: 让模型更"听话"、更"安全"往往会削弱其某些能力(如逻辑推理、创意写作). DeepSeek-V2 的做法是通过精心设计的训练策略来最小化这个 tax, 但没有完全消除. 在 DeepSeek-R1 中, 这个问题被彻底规避: R1-Zero 不使用人类偏好对齐, 而是用纯规则奖励驱动推理能力, 从而避免了对齐税——但也带来了可读性差、语言混杂等副作用.

Online Reinforcement Learning. In our preference alignment experiments, we find that the online approach significantly outperforms the offline approach. Therefore, we invest tremendous efforts in implementing an online RL framework for aligning DeepSeek-V2. The conclusion about online or offline preference alignment can vary in different contexts, and we reserve a more thorough comparison and analysis between them for future work.

在线强化学习. 在我们的偏好对齐实验中, 我们发现在线方法显著优于离线方法. 因此, 我们投入巨大努力实现了用于 DeepSeek-V2 对齐的在线 RL 框架. 关于在线或离线偏好对齐的结论可能在不同情境下有所不同, 我们将留待未来工作进行更彻底的比较和分析.

## 5. Conclusion, Limitation, and Future Work

In this paper, we introduce DeepSeek-V2, a large MoE language model that supports 128K context length. In addition to strong performance, it is also characterized by economical training and efficient inference, benefiting from its innovative architecture including MLA and DeepSeekMoE. In practice, compared with DeepSeek 67B, DeepSeek-V2 achieves significantly stronger performance, and meanwhile saves 42.5% of training costs, reduces the KV cache by 93.3%, and boosts the maximum generation throughput to 5.76 times. Evaluation results further demonstrate that with only 21B activated parameters, DeepSeek-V2 achieves top-tier performance among open-source models and becomes the strongest open-source MoE model.

在本文中, 我们介绍了 DeepSeek-V2, 一个支持 128K 上下文长度的大型 MoE 语言模型. 除了强大的性能外, 它还具有经济训练和高效推理的特点, 受益于其创新架构 MLA 和 DeepSeekMoE. 在实践中, 与 DeepSeek 67B 相比, DeepSeek-V2 实现了显著更强的性能, 同时节省 42.5% 的训练成本, 将 KV 缓存减少 93.3%, 并将最大生成吞吐量提升至 5.76 倍. 评测结果进一步表明, 即使仅有 21B 激活参数, DeepSeek-V2 仍在开源模型中达到顶级性能, 成为最强的开源 MoE 模型.

DeepSeek-V2 and its chat versions share the acknowledged limitations commonly found in other LLMs, including the lack of ongoing knowledge更新after pre-training, the possibility of generating non-factual information such as unverified advice, and a chance to produce hallucinations. In addition, since our data primarily consist of Chinese and English content, our model may exhibit limited proficiency in other languages. In scenarios beyond Chinese and English, it should be used with caution.

DeepSeek-V2 及其对话版本与其他 LLM 一样存在公认的局限性, 包括预训练后缺乏持续的知识更新、可能生成非事实信息(如未经证实的建议)以及产生幻觉的可能性. 此外, 由于我们的数据主要由中文和英文内容组成, 我们的模型在其他语言上可能表现出有限的能力. 在中文和英文以外的场景中, 应谨慎使用.

DeepSeek will continuously invest in open-source large models with long-termism, aiming to progressively approach the goal of artificial general intelligence.

DeepSeek 将持续以长期主义投入开源大模型, 旨在逐步接近通用人工智能的目标.

- In our ongoing exploration, we are dedicated to devising methods that enable further scaling up MoE models while maintaining economical training and inference costs. The goal of our next step is to achieve performance on par with GPT-4 in our upcoming release.

- 在我们持续的探索中, 我们致力于设计能够在保持经济训练和推理成本的同时进一步扩展 MoE 模型的方法. 我们下一步的目标是在即将发布的版本中实现与 GPT-4 相当的性能.

- Our alignment team continuously strives to enhance our models, aiming to develop a model that is not only helpful but also honest and safe for worldwide users. Our ultimate objective is to align the values of our model with human values, while minimizing the need for human supervision. By prioritizing ethical considerations and responsible development, we are dedicated to creating a positive and beneficial impact on society.

- 我们的对齐团队持续努力提升模型, 旨在开发一个不仅有用而且对全球用户诚实且安全的模型. 我们的最终目标是使模型的价值观与人类价值观对齐, 同时最小化对人类监督的需求. 通过优先考虑伦理考量和负责任的发展, 我们致力于为社会创造积极有益的影响.

- Currently, DeepSeek-V2 is designed to support the text modality exclusively. In our forward-looking agenda, we intend to enable our model to support multiple modalities, enhancing its versatility and utility in a wider range of scenarios.

- 目前, DeepSeek-V2 设计为仅支持文本模态. 在我们前瞻性的议程中, 我们打算使模型支持多种模态, 增强其在更广泛场景中的多功能性和实用性.

> 译者注: 这三项未来工作在后续都得到了兑现: (1) "与 GPT-4 相当的性能"在 DeepSeek-V3(2024 年 12 月)中实现; (2) "最小化人类监督"在 R1-Zero(2025 年 1 月)中通过纯 RL 训练得到验证; (3) "多模态支持"在 Janus 系列中实现. 从 V2 到 V3 到 R1 的技术演进脉络清晰可见: V2 奠定了 MLA + DeepSeekMoE 的基础, V3 在此基础上叠加了 MTP、DualPipe、FP8 训练等工程创新, R1 则彻底颠覆了传统对齐范式, 证明了纯 RL 可以驱动推理能力的涌现.

## References

以下参考文献列表保留原文, 未翻译. 如需查阅具体文献, 请参考原始 PDF 或对应 arXiv ID.

AI@Meta. Llama 3 model card, 2024. URL https://github.com/meta-llama/llama3/blob/main/MODEL_CARD.md.

J. Ainslie, J. Lee-Thorp, M. de Jong, Y. Zemlyanskiy, F. Lebron, and S. Sanghai. Gqa: Training generalized multi-query transformer models from multi-head checkpoints. arXiv preprint arXiv:2305.13245, 2023.

Anthropic. Introducing Claude, 2023. URL https://www.anthropic.com/index/introducing-claude.

J. Austin, A. Odena, M. Nye, M. Bosma, H. Michalewski, D. Dohan, E. Jiang, C. Cai, M. Terry, Q. Le, et al. Program synthesis with large language models. arXiv preprint arXiv:2108.07732, 2021.

J. Bai, S. Bai, Y. Chu, Z. Cui, K. Dang, X. Deng, Y. Fan, W. Ge, Y. Han, F. Huang, et al. Qwen technical report. arXiv preprint arXiv:2309.16609, 2023.

Y. Bisk, R. Zellers, R. L. Bras, J. Gao, and Y. Choi. PIQA: reasoning about physical commonsense in natural language. In AAAI 2020, pages 7432-7439. AAAI Press, 2020.

M. Chen, J. Tworek, H. Jun, Q. Yuan, H. P. de Oliveira Pinto, J. Kaplan, H. Edwards, Y. Burda, N. Joseph, G. Brockman, et al. Evaluating large language models trained on code. CoRR, abs/2107.03374, 2021.

P. Clark, I. Cowhey, O. Etzioni, T. Khot, A. Sabharwal, C. Schoenick, and O. Tafjord. Think you have solved question answering? try arc, the AI2 reasoning challenge. CoRR, abs/1803.05457, 2018.

K. Cobbe, V. Kosaraju, M. Bavarian, M. Chen, H. Jun, L. Kaiser, M. Plappert, J. Tworek, J. Hilton, R. Nakano, et al. Training verifiers to solve math word problems. arXiv preprint arXiv:2110.14168, 2021.

Y. Cui, T. Liu, W. Che, L. Xiao, Z. Chen, W. Ma, S. Wang, and G. Hu. A span-extraction dataset for Chinese machine reading comprehension. In EMNLP-IJCNLP 2019, pages 5883-5889. ACL, 2019.

D. Dai, C. Deng, C. Zhao, R. X. Xu, H. Gao, D. Chen, J. Li, W. Zeng, X. Yu, Y. Wu, et al. Deepseekmoe: Towards ultimate expert specialization in mixture-of-experts language models. CoRR, abs/2401.06066, 2024.

T. Dao. FlashAttention-2: Faster attention with better parallelism and work partitioning, 2023.

DeepSeek-AI. Deepseek LLM: scaling open-source language models with longtermism. CoRR, abs/2401.02954, 2024.

D. Dua, Y. Wang, P. Dasigi, G. Stanovsky, S. Singh, and M. Gardner. DROP: A reading comprehension benchmark requiring discrete reasoning over paragraphs. In NAACL-HLT 2019, pages 2368-2378. ACL, 2019.

Y. Dubois, B. Galambosi, P. Liang, and T. B. Hashimoto. Length-controlled alpacaeval: A simple way to debias automatic evaluators. arXiv preprint arXiv:2404.04475, 2024.

W. Fedus, B. Zoph, and N. Shazeer. Switch transformers: Scaling to trillion parameter models with simple and efficient sparsity. CoRR, abs/2101.03961, 2021.

L. Gao, S. Biderman, S. Black, L. Golding, T. Hoppe, C. Foster, J. Phang, H. He, A. Thite, N. Nabeshima, et al. The Pile: An 800GB dataset of diverse text for language modeling. arXiv preprint arXiv:2101.00027, 2020.

Google. Introducing gemini: our largest and most capable ai model, 2023.

A. Gu, B. Roziere, H. Leather, A. Solar-Lezama, G. Synnaeve, and S. I. Wang. Cruxeval: A benchmark for code reasoning, understanding and execution, 2024.

D. Hendrycks, C. Burns, S. Basart, A. Zou, M. Mazeika, D. Song, and J. Steinhardt. Measuring massive multitask language understanding. arXiv preprint arXiv:2009.03300, 2020.

D. Hendrycks, C. Burns, S. Kadavath, A. Arora, S. Basart, E. Tang, D. Song, and J. Steinhardt. Measuring mathematical problem solving with the math dataset. arXiv preprint arXiv:2103.03874, 2021.

High-flyer. HAI-LLM, 2023.

C. Hooper, S. Kim, H. Mohammadzadeh, M. W. Mahoney, Y. S. Shao, K. Keutzer, and A. Gholami. Kvquant: Towards 10 million context length LLM inference with KV cache quantization. CoRR, abs/2401.18079, 2024.

S. Hu, Y. Tu, X. Han, C. He, G. Cui, X. Long, Z. Zheng, Y. Fang, Y. Huang, W. Zhao, et al. Minicpm: Unveiling the potential of small language models with scalable training strategies. arXiv preprint arXiv:2404.06395, 2024.

Y. Huang, Y. Bai, Z. Zhu, J. Zhang, J. Zhang, T. Su, J. Liu, C. Lv, Y. Zhang, J. Lei, et al. C-Eval: A multi-level multi-discipline chinese evaluation suite for foundation models. arXiv preprint arXiv:2305.08322, 2023.

N. Jain, K. Han, A. Gu, W.-D. Li, F. Yan, T. Zhang, S. Wang, A. Solar-Lezama, K. Sen, and I. Stoica. Livecodebench: Holistic and contamination free evaluation of large language models for code. arXiv preprint arXiv:2403.07974, 2024.

M. Joshi, E. Choi, D. Weld, and L. Zettlemoyer. TriviaQA: A large scale distantly supervised challenge dataset for reading comprehension. In ACL 2017, pages 1601-1611. ACL, 2017.

T. Kwiatkowski, J. Palomaki, O. Redfield, M. Collins, A. P. Parikh, C. Alberti, D. Epstein, I. Polosukhin, J. Devlin, K. Lee, et al. Natural questions: a benchmark for question answering research. Trans. Assoc. Comput. Linguistics, 7:452-466, 2019.

W. Kwon, Z. Li, S. Zhuang, Y. Sheng, L. Zheng, C. H. Yu, J. E. Gonzalez, H. Zhang, and I. Stoica. Efficient memory management for large language model serving with pagedattention. In Proceedings of the ACM SIGOPS 29th Symposium on Operating Systems Principles, 2023.

G. Lai, Q. Xie, H. Liu, Y. Yang, and E. H. Hovy. RACE: large-scale reading comprehension dataset from examinations. In EMNLP 2017, pages 785-794. ACL, 2017.

D. Lepikhin, H. Lee, Y. Xu, D. Chen, O. Firat, Y. Huang, M. Krikun, N. Shazeer, and Z. Chen. Gshard: Scaling giant models with conditional computation and automatic sharding. In ICLR 2021. OpenReview.net, 2021.

H. Li, Y. Zhang, F. Koto, Y. Yang, H. Zhao, Y. Gong, N. Duan, and T. Baldwin. CMMLU: Measuring massive multitask language understanding in Chinese. arXiv preprint arXiv:2306.09212, 2023.

W. Li, F. Qi, M. Sun, X. Yi, and J. Zhang. Ccpm: A chinese classical poetry matching dataset, 2021.

X. Liu, X. Lei, S. Wang, Y. Huang, Z. Feng, B. Wen, J. Cheng, P. Ke, Y. Xu, W. L. Tam, et al. Alignbench: Benchmarking chinese alignment of large language models. CoRR, abs/2311.18743, 2023.

I. Loshchilov and F. Hutter. Decoupled weight decay regularization. arXiv preprint arXiv:1711.05101, 2017.

Mistral. Cheaper, better, faster, stronger: Continuing to push the frontier of ai and making it accessible to all, 2024.

OpenAI. Introducing ChatGPT, 2022.

OpenAI. GPT4 technical report. arXiv preprint arXiv:2303.08774, 2023.

L. Ouyang, J. Wu, X. Jiang, D. Almeida, C. Wainwright, P. Mishkin, C. Zhang, S. Agarwal, K. Slama, A. Ray, et al. Training language models to follow instructions with human feedback. Advances in neural information processing systems, 35:27730-27744, 2022.

B. Peng, J. Quesnelle, H. Fan, and E. Shippole. Yarn: Efficient context window extension of large language models. arXiv preprint arXiv:2309.00071, 2023.

P. Qi, X. Wan, G. Huang, and M. Lin. Zero bubble pipeline parallelism. arXiv preprint arXiv:2401.10241, 2023.

S. Rajbhandari, J. Rasley, O. Ruwase, and Y. He. Zero: Memory optimizations toward training trillion parameter models. In SC20, pages 1-16. IEEE, 2020.

C. Riquelme, J. Puigcerver, B. Mustafa, M. Neumann, R. Jenatton, A. S. Pinto, D. Keysers, and N. Houlsby. Scaling vision with sparse mixture of experts. In NeurIPS 2021, pages 8583-8595, 2021.

K. Sakaguchi, R. L. Bras, C. Bhagavatula, and Y. Choi. Winogrande: An adversarial winograd schema challenge at scale, 2019.

Z. Shao, P. Wang, Q. Zhu, R. Xu, J. Song, M. Zhang, Y. Li, Y. Wu, and D. Guo. Deepseekmath: Pushing the limits of mathematical reasoning in open language models. arXiv preprint arXiv:2402.03300, 2024.

N. Shazeer. Fast transformer decoding: One write-head is all you need. CoRR, abs/1911.02150, 2019.

N. Shazeer, A. Mirhoseini, K. Maziarz, A. Davis, Q. V. Le, G. E. Hinton, and J. Dean. Outrageously large neural networks: The sparsely-gated mixture-of-experts layer. In ICLR 2017. OpenReview.net, 2017.

J. Su, M. Ahmed, Y. Lu, S. Pan, W. Bo, and Y. Liu. Roformer: Enhanced transformer with rotary position embedding. Neurocomputing, 568:127063, 2024.

K. Sun, D. Yu, D. Yu, and C. Cardie. Investigating prior knowledge for challenging chinese machine reading comprehension, 2019.

M. Suzgun, N. Scales, N. Scharli, S. Gehrmann, Y. Tay, H. W. Chung, A. Chowdhery, Q. V. Le, E. H. Chi, D. Zhou, et al. Challenging big-bench tasks and whether chain-of-thought can solve them. arXiv preprint arXiv:2210.09261, 2022.

A. Vaswani, N. Shazeer, N. Parmar, J. Uszkoreit, L. Jones, A. N. Gomez, L. Kaiser, and I. Polosukhin. Attention is all you need. Advances in neural information processing systems, 30, 2017.

J. Wei, Y. Tay, R. Bommasani, C. Raffel, B. Zoph, S. Borgeaud, D. Yogatama, M. Bosma, D. Zhou, D. Metzler, et al. Emergent abilities of large language models. arXiv preprint arXiv:2206.07682, 2022.

T. Wei, J. Luan, W. Liu, S. Dong, and B. Wang. Cmath: Can your language model pass chinese elementary school math test?, 2023.

L. Xu, H. Hu, X. Zhang, L. Li, C. Cao, Y. Li, Y. Xu, K. Sun, D. Yu, C. Yu, et al. CLUE: A chinese language understanding evaluation benchmark. In COLING 2020, pages 4762-4772. ICCL, 2020.

A. Young, B. Chen, C. Li, C. Huang, G. Zhang, G. Zhang, H. Li, J. Zhu, J. Chen, J. Chang, et al. Yi: Open foundation models by 01. ai. arXiv preprint arXiv:2403.04652, 2024.

R. Zellers, A. Holtzman, Y. Bisk, A. Farhadi, and Y. Choi. HellaSwag: Can a machine really finish your sentence? In ACL 2019, pages 4791-4800. ACL, 2019.

Y. Zhao, C. Lin, K. Zhu, Z. Ye, L. Chen, S. Zheng, L. Ceze, A. Krishnamurthy, T. Chen, and B. Kasikci. Atom: Low-bit quantization for efficient and accurate LLM serving. CoRR, abs/2310.19102, 2023.

C. Zheng, M. Huang, and A. Sun. Chid: A large-scale chinese idiom dataset for cloze test. In ACL 2019, pages 778-787. ACL, 2019.

L. Zheng, W.-L. Chiang, Y. Sheng, S. Zhuang, Z. Wu, Y. Zhuang, Z. Lin, Z. Li, D. Li, E. P. Xing, et al. Judging llm-as-a-judge with mt-bench and chatbot arena, 2023.

W. Zhong, R. Cui, Y. Guo, Y. Liang, S. Lu, Y. Wang, A. Saied, W. Chen, and N. Duan. AGIEval: A human-centric benchmark for evaluating foundation models. CoRR, abs/2304.06364, 2023.

C. Zhou, P. Liu, P. Xu, S. Iyer, J. Sun, Y. Mao, X. Ma, A. Efrat, P. Yu, L. Yu, et al. Lima: Less is more for alignment. Advances in Neural Information Processing Systems, 36, 2024.

J. Zhou, T. Lu, S. Mishra, S. Brahma, S. Basu, Y. Luan, D. Zhou, and L. Hou. Instruction-following evaluation for large language models. arXiv preprint arXiv:2311.07911, 2023.

## Appendix

### A. Contributions and Acknowledgments

Research & Engineering contributors are listed alphabetically by first name. Especially, Huazuo Gao and Wangding Zeng have made key innovations in the research of the MLA architecture. Furthermore, we'd like to thank Jianlin Su for his helpful discussion on position embedding. We thank all those who have contributed to DeepSeek-V2 but are not mentioned in the paper. DeepSeek believes that innovation, novelty, and curiosity are essential in the path to AGI.

研究与工程贡献者按名字字母顺序排列. 特别地, Huazuo Gao 和 Wangding Zeng 在 MLA 架构研究中做出了关键创新. 此外, 我们要感谢 Jianlin Su 在位置编码方面的有益讨论. 我们感谢所有为 DeepSeek-V2 做出贡献但未在论文中提及的人. DeepSeek 相信创新、新颖和好奇是通往 AGI 之路的必备品质.

### B. DeepSeek-V2-Lite: A 16B Model Equipped with MLA and DeepSeekMoE

#### B.1. Model Description

Architectures. DeepSeek-V2-Lite has 27 layers and a hidden dimension of 2048. It also employs MLA and has 16 attention heads, where each head has a dimension of 128. Its KV compression dimension is 512, but slightly different from DeepSeek-V2, it does not compress the queries. For the decoupled queries and key, it has a per-head dimension of 64. DeepSeek-V2-Lite also employs DeepSeekMoE, and all FFNs except for the first layer are replaced with MoE layers. Each MoE layer consists of 2 shared experts and 64 routed experts, where the intermediate hidden dimension of each expert is 1408. Among the routed experts, 6 experts will be activated for each token. Under this configuration, DeepSeek-V2-Lite comprises 15.7B total parameters, of which 2.4B are activated for each token.

架构. DeepSeek-V2-Lite 有 27 层, 隐藏维度为 2048. 它也采用 MLA, 有 16 个注意力头, 每个头维度为 128. 其 KV 压缩维度为 512, 但与 DeepSeek-V2 略有不同, 它不压缩 queries. 对于解耦 queries 和 key, 其每头维度为 64. DeepSeek-V2-Lite 也采用 DeepSeekMoE, 除第一层外的所有 FFN 都被替换为 MoE 层. 每个 MoE 层由 2 个共享专家和 64 个路由专家组成, 每个专家的中间隐藏维度为 1408. 在路由专家中, 每个 token 激活 6 个专家. 在此配置下, DeepSeek-V2-Lite 总参数量为 15.7B, 每个 token 激活 2.4B 参数.

Training Details. DeepSeek-V2-Lite is also trained from scratch on the same pre-training corpus of DeepSeek-V2, which is not polluted by any SFT data. It uses the AdamW optimizer with hyper-parameters set to $\beta_1 = 0.9$, $\beta_2 = 0.95$, and weight_decay = 0.1. The learning rate is scheduled using a warmup-and-step-decay strategy. Initially, the learning rate linearly increases from 0 to the maximum value during the first 2K steps. Subsequently, the learning rate is multiplied by 0.316 after training about 80% of tokens, and again by 0.316 after training about 90% of tokens. The maximum learning rate is set to $4.2 \times 10^{-4}$, and the gradient clipping norm is set to 1.0. We do not employ the batch size scheduling strategy for it, and it is trained with a constant batch size of 4608 sequences. During pre-training, we set the maximum sequence length to 4K, and train DeepSeek-V2-Lite on 5.7T tokens. We leverage pipeline parallelism to deploy different layers of it on different devices, but for each layer, all experts will be deployed on the same device. Therefore, we only employ a small expert-level balance loss with $\alpha_1 = 0.001$ and do not employ device-level balance loss and communication balance loss for it. After pre-training, we also perform long context extension and SFT for DeepSeek-V2-Lite and get a chat model called DeepSeek-V2-Lite Chat.

训练细节. DeepSeek-V2-Lite 也在与 DeepSeek-V2 相同的预训练语料库上从头训练, 未被任何 SFT 数据污染. 它使用 AdamW 优化器, 超参数设为 $\beta_1 = 0.9$, $\beta_2 = 0.95$, weight_decay = 0.1. 学习率使用 warmup-and-step-decay 策略调度. 初始阶段, 学习率在前 2K 步中线性增长至最大值. 随后, 在训练约 80% tokens 后学习率乘以 0.316, 在训练约 90% tokens 后再次乘以 0.316. 最大学习率设为 $4.2 \times 10^{-4}$, 梯度裁剪范数设为 1.0. 我们不使用批大小调度策略, 以恒定的 4608 序列批大小训练. 预训练期间, 我们将最大序列长度设为 4K, 在 5.7T tokens 上训练 DeepSeek-V2-Lite. 我们利用流水线并行将不同层部署在不同设备上, 但对于每一层, 所有专家都部署在同一设备上. 因此, 我们只使用较小的专家级均衡损失($\alpha_1 = 0.001$), 不使用设备级均衡损失和通信均衡损失. 预训练后, 我们还对 DeepSeek-V2-Lite 执行长上下文扩展和 SFT, 得到名为 DeepSeek-V2-Lite Chat 的对话模型.

> 译者注: V2-Lite 的设计目的很明确: 让研究社区能够在消费级硬件上复现和验证 MLA + DeepSeekMoE 的效果. 15.7B 总参数 / 2.4B 激活参数的配置, 意味着推理时只需约 2.4B Dense 模型的显存, 单卡 24GB 即可运行. 这大大降低了技术门槛, 是 DeepSeek 开源策略的务实体现.

#### B.2. Performance Evaluation

Base Model. We evaluate the performance of DeepSeek-V2-Lite and compare it with our previous small-size base models in Table 6. DeepSeek-V2-Lite exhibits overwhelming performance advantages, especially in reasoning, coding, and math.

基座模型. 我们在表 6 中评测了 DeepSeek-V2-Lite 的性能, 并将其与先前的小型基座模型进行了比较. DeepSeek-V2-Lite 展现出压倒性的性能优势, 尤其是在推理、编码和数学方面.

Chat Model. We evaluate the performance of DeepSeek-V2-Lite Chat and compare it with our previous small-size chat models in Table 7. DeepSeek-V2-Lite also outperforms our previous small-size chat models by a large margin.

对话模型. 我们在表 7 中评测了 DeepSeek-V2-Lite Chat 的性能, 并将其与先前的小型对话模型进行了比较. DeepSeek-V2-Lite 也以大幅优势超越了先前的小型对话模型.

### C. Full Formulas of MLA

In order to demonstrate the complete computation process of MLA, we provide its full formulas in the following:

为了展示 MLA 的完整计算过程, 我们在下方提供其完整公式:

$$
\mathbf{c}_t^Q = W^{DQ} \mathbf{h}_t, \tag{37}
$$

$$
[\mathbf{q}_{t,1}^C; \mathbf{q}_{t,2}^C; ...; \mathbf{q}_{t,n_h}^C] = \mathbf{q}_t^C = W^{UQ} \mathbf{c}_t^Q, \tag{38}
$$

$$
[\mathbf{q}_{t,1}^R; \mathbf{q}_{t,2}^R; ...; \mathbf{q}_{t,n_h}^R] = \mathbf{q}_t^R = \text{RoPE}(W^{QR} \mathbf{c}_t^Q), \tag{39}
$$

$$
\mathbf{q}_{t,i} = [\mathbf{q}_{t,i}^C; \mathbf{q}_{t,i}^R], \tag{40}
$$

$$
\mathbf{c}_t^{KV} = W^{DKV} \mathbf{h}_t, \tag{41}
$$

$$
[\mathbf{k}_{t,1}^C; \mathbf{k}_{t,2}^C; ...; \mathbf{k}_{t,n_h}^C] = \mathbf{k}_t^C = W^{UK} \mathbf{c}_t^{KV}, \tag{42}
$$

$$
\mathbf{k}_t^R = \text{RoPE}(W^{KR} \mathbf{h}_t), \tag{43}
$$

$$
\mathbf{k}_{t,i} = [\mathbf{k}_{t,i}^C; \mathbf{k}_t^R], \tag{44}
$$

$$
[\mathbf{v}_{t,1}^C; \mathbf{v}_{t,2}^C; ...; \mathbf{v}_{t,n_h}^C] = \mathbf{v}_t^C = W^{UV} \mathbf{c}_t^{KV}, \tag{45}
$$

$$
\mathbf{o}_{t,i} = \sum_{j=1}^{t} \text{Softmax}_j(\frac{\mathbf{q}_{t,i}^T \mathbf{k}_{j,i}}{\sqrt{d_h + d_h^R}}) \mathbf{v}_{j,i}^C, \tag{46}
$$

$$
\mathbf{u}_t = W^O [\mathbf{o}_{t,1}; \mathbf{o}_{t,2}; ...; \mathbf{o}_{t,n_h}], \tag{47}
$$

where the boxed vectors in blue need to be cached for generation. During inference, the naive formula needs to recover $\mathbf{k}_t^C$ and $\mathbf{v}_t^C$ from $\mathbf{c}_t^{KV}$ for attention. Fortunately, due to the associative law of matrix multiplication, we can absorb $W^{UK}$ into $W^{UQ}$, and $W^{UV}$ into $W^O$. Therefore, we do not need to compute keys and values out for each query. Through this optimization, we avoid the computational overhead for recomputing $\mathbf{k}_t^C$ and $\mathbf{v}_t^C$ during inference.

其中蓝色框出的向量需要在生成时缓存. 在推理期间, 朴素公式需要从 $\mathbf{c}_t^{KV}$ 恢复 $\mathbf{k}_t^C$ 和 $\mathbf{v}_t^C$ 以进行注意力计算. 幸运的是, 由于矩阵乘法的结合律, 我们可以将 $W^{UK}$ 吸收进 $W^{UQ}$, 将 $W^{UV}$ 吸收进 $W^O$. 因此, 我们不需要为每个 query 显式计算 keys 和 values. 通过这种优化, 我们避免了在推理期间重新计算 $\mathbf{k}_t^C$ 和 $\mathbf{v}_t^C$ 的计算开销.

> 译者注: 附录 C 的完整公式是理解 MLA 推理优化的关键. 式(41)中的 $\mathbf{c}_t^{KV}$ 是推理时唯一需要缓存的 KV 相关量(加上式(43)的 $\mathbf{k}_t^R$). 式(42)(45)中的 $W^{UK}$ 和 $W^{UV}$ 在推理前被"吸收"到相邻的投影矩阵中, 这意味着注意力计算可以直接在压缩空间中进行, 无需恢复完整的 key 和 value. 这是 MLA 相比 GQA/MQA 的根本效率优势.

### D. Ablation of Attention Mechanisms

#### D.1. Ablation of MHA, GQA, and MQA

We show the evaluation results for 7B dense models with MHA, GQA, and MQA on four hard benchmarks in Table 8. All of these three models are trained on 1.33T tokens, and share the same architecture except for the attention mechanisms. In addition, for a fair comparison, we align the number of parameters of them to around 7B by adjusting the number of layers. From the table, we can find that MHA demonstrates significant advantages over GQA and MQA on these benchmarks.

我们在表 8 中展示了配备 MHA、GQA 和 MQA 的 7B Dense 模型在四个困难基准测试上的评测结果. 这三个模型都在 1.33T tokens 上训练, 除注意力机制外共享相同的架构. 此外, 为了公平比较, 我们通过调整层数将它们的参数量对齐到约 7B. 从表中可以发现, MHA 在这些基准测试上相比 GQA 和 MQA 展现出显著优势.

| Benchmark (Metric) | # Shots | Dense 7B w/ MQA | Dense 7B w/ GQA (8 Groups) | Dense 7B w/ MHA |
|--------------------|---------|-----------------|---------------------------|-----------------|
| # Params | | 7.1B | 6.9B | 6.9B |
| BBH (EM) | 3-shot | 33.2 | 35.6 | 37.0 |
| MMLU (Acc.) | 5-shot | 37.9 | 41.2 | 45.2 |
| C-Eval (Acc.) | 5-shot | 30.0 | 37.7 | 42.9 |
| CMMLU (Acc.) | 5-shot | 34.6 | 38.4 | 43.5 |

Table 8 
| 配备 MHA、GQA 和 MQA 的 7B Dense 模型对比. MHA 在困难基准测试上相比 GQA 和 MQA 展现显著优势.

#### D.2. Comparison Between MLA and MHA

In Table 9, we show the evaluation results for MoE models equipped with MLA and MHA, respectively, on four hard benchmarks. For a solid conclusion, we train and evaluate models across two scales. Two small MoE models comprise about 16B total parameters, and we train them on 1.33T tokens. Two large MoE models comprise about 250B total parameters, and we train them on 420B tokens. Also, two small MoE models and two large MoE models respectively share the same architecture except for the attention mechanisms. From the table, we can observe that MLA shows better performance than MHA. More importantly, MLA requires a significantly smaller amount of KV cache (14% for small MoE models and 4% for large MoE models) than MHA.

在表 9 中, 我们展示了分别配备 MLA 和 MHA 的 MoE 模型在四个困难基准测试上的评测结果. 为了得出可靠结论, 我们在两个规模上训练和评测模型. 两个小型 MoE 模型总参数量约 16B, 在 1.33T tokens 上训练. 两个大型 MoE 模型总参数量约 250B, 在 420B tokens 上训练. 此外, 两个小型 MoE 模型和两个大型 MoE 模型分别除注意力机制外共享相同的架构. 从表中可以观察到, MLA 相比 MHA 展现出更好的性能. 更重要的是, MLA 所需的 KV 缓存量显著小于 MHA(小型 MoE 模型为 14%, 大型 MoE 模型为 4%).

| Benchmark (Metric) | # Shots | Small MoE w/ MHA | Small MoE w/ MLA | Large MoE w/ MHA | Large MoE w/ MLA |
|--------------------|---------|------------------|------------------|------------------|------------------|
| # Activated Params | - | 2.5B | 2.4B | 25.0B | 21.5B |
| # Total Params | | 15.8B | 15.7B | 250.8B | 247.4B |
| KV Cache per Token (# Element) | - | 110.6K | 15.6K | 860.2K | 34.6K |
| BBH (EM) | 3-shot | 37.9 | 39.0 | 46.6 | 50.7 |
| MMLU (Acc.) | 5-shot | 48.7 | 50.0 | 57.5 | 59.0 |
| C-Eval (Acc.) | 5-shot | 51.6 | 50.9 | 57.9 | 59.2 |
| CMMLU (Acc.) | 5-shot | 52.3 | 53.4 | 60.7 | 62.5 |

Table 9 
| MLA 与 MHA 在困难基准测试上的对比. DeepSeek-V2 相比 MHA 表现更好, 但所需 KV 缓存显著更少.

> 译者注: 表 9 是 MLA 最核心的实验证据. 在小规模(16B)和大型(250B)两种设置下, MLA 不仅性能优于 MHA, KV 缓存还分别减少到 14% 和 4%. 大型模型上的 4% 意味着压缩比高达 25:1——这与表 1 中理论计算的 28:1 基本吻合. 这个实验彻底证明了 MLA 的"鱼与熊掌兼得": 既提升性能, 又大幅减少缓存.

### E. Discussion About Pre-Training Data Debiasing

During pre-training data preparation, we identify and filter out contentious content, such as values influenced by regional cultures, to avoid our model exhibiting unnecessary subjective biases on these controversial topics. Consequently, we observe that DeepSeek-V2 performs slightly worse on the test sets that are closely associated with specific regional cultures. For example, when evaluated on MMLU, although DeepSeek-V2 achieves comparable or superior performance on the majority of testsets compared with its competitors like Mixtral 8x22B, it still lags behind on the Humanity-Moral subset, which is mainly associated with American values.

在预训练数据准备期间, 我们识别并过滤掉了有争议的内容, 如受区域文化影响的价值观, 以避免我们的模型在这些争议性话题上表现出不必要的主观偏见. 结果, 我们观察到 DeepSeek-V2 在与特定区域文化密切相关的测试集上表现略差. 例如, 在 MMLU 评测中, 尽管 DeepSeek-V2 在大多数测试集上与其竞争对手(如 Mixtral 8x22B)达到相当或更优的性能, 但在主要与美国价值观相关的 Humanity-Moral 子集上仍然落后.

Further, we conduct a manual analysis on this subset. Three well-educated human annotators conduct independent annotations on 420 moral scenarios from the MMLU Humanity-Moral subset. Then, we compute the agreement among their annotations and the ground-truth label. As shown in Table 10, three human annotators and the ground-truth label exhibit a low agreement with each other. Therefore, we attribute the abnormal performance of DeepSeek-V2 on these value-sensitive test sets to our efforts in debiasing the pre-training corpus.

进一步, 我们对该子集进行了人工分析. 三名受过良好教育的人类标注员对 MMLU Humanity-Moral 子集中的 420 个道德场景进行了独立标注. 然后, 我们计算了他们标注之间以及标注与真实标签之间的一致性. 如表 10 所示, 三名人类标注员和真实标签彼此之间的一致性较低. 因此, 我们将 DeepSeek-V2 在这些价值观敏感测试集上的异常表现归因于我们对预训练语料库去偏的努力.

> 译者注: 这是一个罕见的技术报告自我反思. DeepSeek 主动承认: 为了去偏而过滤有争议内容, 导致模型在特定价值观测试(如美国道德观)上表现下降. 他们用人工标注实验证明: 即使是人类标注员, 对这些道德问题的判断也高度不一致(一致性最低仅 42.1%). 这暗示这类测试本身的"标准答案"就存在文化偏见, 模型的"低分"反而可能是去偏成功的信号. 这种坦诚在 AI 论文中非常少见.

### F. Additional Evaluations on Math and Code

The evaluation employs the SC-Math6 corpus, which consists of thousands of Chinese math problems. DeepSeek-V2 Chat (RL) outperforms all Chinese LLMs, including both open-source and close-source models.

该评测使用 SC-Math6 语料库, 包含数千道中文数学题. DeepSeek-V2 Chat (RL) 超越了所有中文 LLM, 包括开源和闭源模型.

We further share more results in Figure 5 on HumanEval and LiveCodeBench, where the questions of LiveCodeBench are selected from the period between September 1st, 2023, and April 1st, 2024. As shown in the figure, DeepSeek-V2 Chat (RL) demonstrates considerable proficiency in LiveCodeBench, achieving a Pass@1 score that even surpasses some giant models. This performance highlights the strong capability of DeepSeek-V2 Chat (RL) in tackling live coding tasks.

我们在图 5 中进一步分享了 HumanEval 和 LiveCodeBench 的更多结果, 其中 LiveCodeBench 的问题选自 2023 年 9 月 1 日至 2024 年 4 月 1 日期间. 如图所示, DeepSeek-V2 Chat (RL) 在 LiveCodeBench 上展现出相当高的熟练度, 取得的 Pass@1 分数甚至超越了一些巨型模型. 这一性能突出了 DeepSeek-V2 Chat (RL) 在处理实时编码任务方面的强大能力.

### G. Evaluation Formats

We present our evaluation formats for each benchmark in Table 12-37, respectively.

我们在表 12-37 中分别展示了每个基准测试的评测格式.

> 译者注: 附录 G 包含大量评测 prompt 示例和表格(表 12-37), 主要用于复现评测条件. 这些内容以原始英文保留在 D3 中, 此处不再逐段翻译. 如需了解具体评测格式, 请参考原始 PDF 或 D3 文件.

## 全文完

## 关联文件说明

- 原始英文 MinerU 文档: `03-DeepSeek-V2-mineru-en.md`
- 既有精译/导读: `01-DeepSeek-V2技术报告精译.md`
- 核心架构剖析: `02-DeepSeek-V2核心架构剖析.md`
- D5 主题专题: `05-DeepSeek-V2-MLA.md`、`05-DeepSeek-V2-DeepSeekMoE.md`、`05-DeepSeek-V2-Index.md`
