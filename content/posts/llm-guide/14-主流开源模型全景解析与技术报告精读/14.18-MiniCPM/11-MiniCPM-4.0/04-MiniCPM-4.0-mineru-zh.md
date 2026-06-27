---
title: "MiniCPM4 技术报告逐段精译"
---

# MiniCPM4: Ultra-Efficient LLMs on End Devices

> 🔙 **[返回 14.18-MiniCPM 家族总览](../../14.18-MiniCPM.md)**


> 本文基于 PyMuPDF 提取的原文进行逐段翻译，关键节点插入译者注。

---

## 1 Introduction

**[原文]**
Large language models (LLMs) (Brown et al., 2020; OpenAI, 2023), also known as foundation models (Bommasani et al., 2021), have become the core driving force in the field of artificial intelligence (AI) (Qiu et al., 2020; Han et al., 2021). These large models exhibit impressive abilities to handle diverse tasks, from helpful chatbot systems (Ouyang et al., 2022) to complex reasoning systems (OpenAI, 2024b; DeepSeek et al., 2025), significantly enhancing the quality and efficiency of human-machine interaction.

**[译文]**
大语言模型(LLMs)(Brown et al., 2020; OpenAI, 2023)，也称为基础模型(Bommasani et al., 2021)，已成为人工智能(AI)领域的核心驱动力(Qiu et al., 2020; Han et al., 2021)。这些大型模型展现出处理多样化任务的令人印象深刻的能力，从有用的聊天机器人系统(Ouyang et al., 2022)到复杂的推理系统(OpenAI, 2024b; DeepSeek et al., 2025)，显著提升了人机交互的质量和效率。

**[原文]**
However, as the size of models continues to expand (Kaplan et al., 2020; Hoffmann et al., 2022), the requirement for computational resources grows exponentially, resulting in these models being primarily deployed on cloud servers and accessed through API interfaces.

**[译文]**
然而，随着模型规模持续扩大(Kaplan et al., 2020; Hoffmann et al., 2022)，对计算资源的需求呈指数级增长，导致这些模型主要部署在云端服务器上，并通过 API 接口访问。

> 译者注: 这一段交代了端侧 AI 的核心矛盾——模型能力随规模增长，但部署成本也随之飙升。GPT-4 级别的模型需要数百 GB 显存，这从根本上排除了端侧部署的可能性。MiniCPM4 的出发点就是解决这个矛盾: 在保持相当能力的前提下，将模型缩小到端侧可承受的范围。

**[原文]**
The development of LLMs is currently facing an important trend toward miniaturization and increased efficiency. From the LLM application perspective, efficient models can reduce deployment costs and expand application scenarios, particularly in environments with limited computational resources such as end-side devices and mobile terminals (Gunter et al., 2024; OpenAI, 2024a). From the technical development perspective, as model sizes continue to grow, improving computational efficiency becomes crucial for overcoming performance bottlenecks with limited resources (DeepSeek et al., 2024).

**[译文]**
LLM 的发展目前正面临一个重要的趋势: 小型化和效率提升。从 LLM 应用的角度看，高效模型可以降低部署成本并扩展应用场景，特别是在计算资源有限的环境，如端侧设备和移动终端(Gunter et al., 2024; OpenAI, 2024a)。从技术发展的角度看，随着模型规模持续增长，提升计算效率对于克服有限资源下的性能瓶颈变得至关重要(DeepSeek et al., 2024)。

**[原文]**
Therefore, efficient model architectures and algorithms that maintain model capabilities while minimizing computational requirements are of considerable theoretical and practical significance.

**[译文]**
因此，在保持模型能力的同时最小化计算需求的高效模型架构和算法，具有相当重要的理论和实践意义。

**[原文]**
Aligning with this move towards more efficient LLMs, our team has consistently concentrated on building efficient end-side MiniCPM models (Hu et al., 2024; Yao et al., 2024). In this paper, we further boost model efficiency through systematic innovation in four key dimensions: model architecture, training data, training algorithms, and inference systems.

**[译文]**
顺应这一向更高效 LLM 发展的趋势，我们的团队始终专注于构建高效的端侧 MiniCPM 模型(Hu et al., 2024; Yao et al., 2024)。在本文中，我们通过在四个关键维度上进行系统性创新来进一步提升模型效率: 模型架构、训练数据、训练算法和推理系统。

> 译者注: 四个维度的系统性创新是 MiniCPM4 的核心方法论。大多数相关工作只关注单一维度(如只优化架构或只优化推理)，而 MiniCPM4 的做法是「全栈优化」——从数据到算法到系统，每个环节都追求极致效率。这种端到端的优化思路在工程上更有价值，因为单点优化往往会遇到「木桶效应」——最慢的环节决定了整体速度。

---

## 2 Efficient Architecture and Pre-training

### 2.1 InfLLM v2: Trainable Sparse Attention for Prefilling and Decoding

**[原文]**
With the widespread application of LLMs in long-context processing (OpenAI, 2025; Jimenez et al., 2023) and the drive for deep reasoning capabilities (DeepSeek et al., 2025; OpenAI, 2024b), the need for LLMs to comprehend and generate long sequences has become increasingly critical. However, the computational and memory demands of self-attention mechanisms pose significant challenges for efficiently processing lengthy documents on end-side devices.

**[译文]**
随着 LLM 在长文本处理(OpenAI, 2025; Jimenez et al., 2023)和深度推理能力(DeepSeek et al., 2025; OpenAI, 2024b)中的广泛应用，LLM 理解和生成长序列的需求变得越来越关键。然而，自注意力机制的计算和内存需求对端侧设备高效处理长文档构成了重大挑战。

**[原文]**
We propose a sparse attention architecture, enabling efficient long-context processing while maintaining model performance. Specifically, we introduce InfLLM v2, a trainable sparse attention mechanism that accelerates both prefilling and decoding phases.

**[译文]**
我们提出了一种稀疏注意力架构，在保持模型性能的同时实现高效的长文本处理。具体而言，我们引入了 InfLLM v2，一种可训练的稀疏注意力机制，能够加速预填充和解码两个阶段。

> 译者注: 「预填充 + 解码双阶段加速」是 InfLLM v2 相比前代的核心升级。大多数稀疏注意力方法只关注预填充阶段(因为预填充的并行度高，容易优化)，而解码阶段由于自回归特性(每次只生成一个 token)更难加速。InfLLM v2 能在解码阶段也实现加速，这对实际用户体验至关重要——预填充只发生一次(处理输入)，而解码发生在每个生成步骤。

#### 2.1.1 Overall Framework of InfLLM v2

**[原文]**
Building upon our dynamic sparse attention architecture, InfLLM (Xiao et al., 2024b), we introduce InfLLM v2, which features efficient kernel design and end-to-end specialized training. Its kernel facilitates token-level sparse attention computation at the query level, yielding significant speed improvements in both long-context prefilling and decoding phases.

**[译文]**
在我们动态稀疏注意力架构 InfLLM(Xiao et al., 2024b)的基础上，我们引入了 InfLLM v2，其特点是高效的 Kernel 设计和端到端专用训练。其 Kernel 在查询级别实现 token 级稀疏注意力计算，在长文本预填充和解码阶段都带来了显著的速度提升。

**[原文]**
Additionally, we develop a specialized training framework that further enhances the sparsity of the attention mechanism and improves long-context processing capabilities. In this section, we introduce the model architecture and training algorithms applied in MiniCPM4, which features efficient sparse attention layers and an efficient training pipeline.

**[译文]**
此外，我们开发了一个专门的训练框架，进一步增强了注意力机制的稀疏性并提升了长文本处理能力。在本节中，我们介绍了 MiniCPM4 中应用的模型架构和训练算法，其特点是高效的稀疏注意力层和高效的训练 pipeline。

**[原文]**
Specifically, InfLLM v2 enables MiniCPM4 to achieve comparable long-context processing ability with the full attention mechanism with 81% attention sparsity.

**[译文]**
具体而言，InfLLM v2 使 MiniCPM4 在 81% 的注意力稀疏度下，仍能达到与完整注意力机制相当的长文本处理能力。

> 译者注: 81% 稀疏度意味着模型只关注约 19% 的上下文 token。这是一个相当激进的稀疏水平——如果块选择机制有 5% 的误差率，遗漏的关键信息就可能显著影响输出质量。InfLLM v2 能在如此高的稀疏度下保持性能，说明其块选择机制具有高度的准确性。

#### 2.1.2 Dynamic Contextual Block Selection

**[原文]**
The sparse attention computation of InfLLM v2 consists of two stages. In the first stage, we dynamically select relevant blocks from B based on the query token $q_i$. To this end, we need to compute the relevance score $r_{block}(q_i, B_j)$ between the query token and each block, and then select the blocks with the highest relevance scores.

**[译文]**
InfLLM v2 的稀疏注意力计算包含两个阶段。在第一阶段，我们基于查询 token $q_i$ 从 $B$ 中动态选择相关块。为此，我们需要计算查询 token 与每个块之间的相关性得分 $r_{block}(q_i, B_j)$，然后选择相关性得分最高的块。

**[原文]**
In the second phase, based on the blocks selected in the first stage, we compute attention between $q_i$ and all tokens within these selected blocks.

**[译文]**
在第二阶段，基于第一阶段选中的块，我们计算 $q_i$ 与这些选中块内所有 token 之间的注意力。

> 译者注: 两阶段设计的关键权衡在于「选择开销 vs 计算节省」。阶段一的选择操作本身需要 $O(n^2/B)$ 的复杂度，当 $B$ 较小时，这部分开销不可忽视。InfLLM v2 通过语义核压缩和 LSE 近似来降低阶段一的开销，但优化的天花板取决于硬件的内存带宽和并行度。

#### 2.1.3 Design Principles for Trainable Sparse Attention

**[原文]**
With the development of those applications requiring long-context processing and deep reasoning abilities, trainable sparse attention mechanisms show great potential to improve the efficiency of pre-training and inference. In this section, we discuss several key features and design principles for InfLLM v2.

**[译文]**
随着需要长文本处理和深度推理能力的应用的发展，可训练稀疏注意力机制在提升预训练和推理效率方面展现出巨大潜力。在本节中，我们讨论了 InfLLM v2 的几个关键特性和设计原则。

**[原文]**
Complexity Analysis: InfLLM v2 enables each token to compute attention with only the top-k key-value blocks, significantly reducing the computational and memory access overhead of attention mechanisms. In stage 1, we need to calculate relevance scores between the query token and each semantic kernel. For a query token with the context length $l$, there are $\lfloor\frac{l}{2}\rfloor$ semantic kernels. Therefore, this query token requires $\lfloor\frac{l}{2}\rfloor$ vector multiplications and memory accesses.

**[译文]**
复杂度分析: InfLLM v2 使每个 token 只需与 top-k 个 key-value 块计算注意力，显著降低了注意力机制的计算和内存访问开销。在阶段一中，我们需要计算查询 token 与每个语义核之间的相关性得分。对于上下文长度为 $l$ 的查询 token，有 $\lfloor\frac{l}{2}\rfloor$ 个语义核。因此，该查询 token 需要 $\lfloor\frac{l}{2}\rfloor$ 次向量乘法和内存访问。

**[原文]**
In stage 2, we need to compute the relevance scores between the query token and $k$ key-value blocks. During this process, the query token requires $2km$ vector multiplications and memory accesses. Compared to dense attention mechanisms, which require $2l$ vector operations and memory accesses, when the sequence is very long $(l \gg m)$, InfLLM v2 can reduce computational overhead and memory accesses to $\frac{1}{2}$.

**[译文]**
在阶段二中，我们需要计算查询 token 与 $k$ 个 key-value 块之间的相关性得分。在此过程中，查询 token 需要 $2km$ 次向量乘法和内存访问。与需要 $2l$ 次向量操作和内存访问的稠密注意力机制相比，当序列非常长 $(l \gg m)$ 时，InfLLM v2 可以将计算开销和内存访问降低到约 $\frac{1}{2}$。

> 译者注: 论文中提到的「降低到 1/2」是相对于稠密注意力的总开销(包括阶段一和阶段二)而言的。这个结论的前提是「序列非常长」，对于中等长度(如 4K-8K)的序列，阶段一的开销占比更高，实际加速比会小于 2 倍。这也解释了为什么端到端加速(2.1x-2.3x)远低于算子级加速(7-9x)——非注意力层和阶段一的选择开销在总时间中占比较大。

---

### 2.2 UltraClean: High-Quality Pre-Training Data Filtering and Generation

**[原文]**
We propose UltraClean, an efficient and accurate pre-training data filtering and generation strategy. These datasets enable satisfactory model performance to be achieved using just 8 trillion training tokens.

**[译文]**
我们提出了 UltraClean，一种高效且准确的预训练数据过滤和生成策略。这些数据集使模型仅需 8 万亿训练 tokens 即可达到令人满意的性能。

> 译者注: 8T vs 36T 的对比(与 Qwen3-8B)是 UltraClean 最亮眼的数据。但需要注意，这个对比可能存在不公平因素: (1) Qwen3-8B 的训练数据截止日期和范围与 MiniCPM4 不同; (2) 评测基准可能存在数据污染差异; (3) 「相当性能」是在哪些具体基准上衡量的？论文中应该有详细的评测表格，但此处仅做概述。

---

### 2.3 ModelTunnel v2: Efficient Pre-Training Strategy Search

**[原文]**
We propose ModelTunnel v2 for efficient pre-training strategy search. Specifically, we first conduct efficient predictable scaling with improved performance indicator using small models. Then, we apply the searched optimal strategies to large models.

**[译文]**
我们提出了 ModelTunnel v2 用于高效预训练策略搜索。具体而言，我们首先使用小模型进行带有改进性能指标的高效可预测扩展。然后，将搜索到的最优策略应用于大模型。

> 译者注: ModelTunnel v2 的核心思想是「用小模型探路」，这与 Google 的 μTransfer 和 DeepMind 的 ChinChilla  scaling law 研究一脉相承。关键创新在于「改进性能指标」——传统的 loss 曲线可能无法准确预测下游任务性能，ModelTunnel v2 可能使用了与最终评测更相关的中间指标。

---

## 3 Efficient Post-Training

### 3.1 UltraChat v2: Foundational Capability Enhanced SFT Data Generation

**[原文]**
We propose UltraChat v2, a comprehensive supervised fine-tuning dataset covering knowledge-intensive data, reasoning-intensive data, instruction following data, long-context data, and tool use data.

**[译文]**
我们提出了 UltraChat v2，一个全面的监督微调数据集，涵盖知识密集型数据、推理密集型数据、指令遵循数据、长文本数据和工具使用数据。

### 3.2 Chunk-wise Rollout: Deep Reasoning with Load-Balanced Reinforcement Learning

**[原文]**
We improve existing post-training methods by introducing chunk-wise rollout for load-balanced reinforcement learning.

**[译文]**
我们通过引入分块 rollout 机制来改进现有的后训练方法，实现负载均衡的强化学习。

### 3.3 BitCPM4: Quantization-Aware Training for Ternary LLMs

**[原文]**
We propose BitCPM4, a data-efficient ternary LLM trained with quantization-aware training. By restricting weights to {-1, 0, +1}, BitCPM4 achieves extreme compression while maintaining acceptable performance.

**[译文]**
我们提出了 BitCPM4，一种通过量化感知训练得到的数据高效三值 LLM。通过将权重限制为 {-1, 0, +1}，BitCPM4 在保持可接受性能的同时实现了极端压缩。

---

## 4 Efficient Inference and Deployment

### 4.1 CPM.cu: Lightweight and Efficient CUDA Inference Framework

**[原文]**
We propose CPM.cu that integrates sparse attention, model quantization, and speculative sampling to achieve efficient prefilling and decoding.

**[译文]**
我们提出了 CPM.cu，它集成了稀疏注意力、模型量化和投机采样，以实现高效的预填充和解码。

**[原文]**
To meet diverse on-device requirements, MiniCPM4 is available in two versions, with 0.5B and 8B parameters, respectively.

**[译文]**
为了满足多样化的端侧需求，MiniCPM4 提供两个版本，分别为 0.5B 和 8B 参数。

### 4.2 ArkInfer: Cross-Platform Deployment System

**[原文]**
We propose ArkInfer, a cross-platform deployment system that supports NVIDIA, Intel, Qualcomm, MTK, and Ascend chips.

**[译文]**
我们提出了 ArkInfer，一个跨平台部署系统，支持 NVIDIA、Intel、高通、联发科和昇腾芯片。

---

## 5 Evaluations

### 5.1 Experimental Settings

**[原文]**
We evaluate MiniCPM4 and MiniCPM4.1 on multiple benchmarks covering standard capabilities, long-context understanding, and inference efficiency.

**[译文]**
我们在多个基准上评估了 MiniCPM4 和 MiniCPM4.1，涵盖标准能力、长文本理解和推理效率。

### 5.2 Standard Evaluation

**[原文]**
MiniCPM4-8B achieves comparable performance with Qwen3-8B while using only 22% of its training data. MiniCPM4-0.5B significantly outperforms Qwen3-0.6B across MMLU, CEval, and HumanEval benchmarks.

**[译文]**
MiniCPM4-8B 在使用仅 22% 训练数据的情况下达到了与 Qwen3-8B 相当的性能。MiniCPM4-0.5B 在 MMLU、CEval 和 HumanEval 基准上显著超越 Qwen3-0.6B。

> 译者注: 22% 的数据效率是 MiniCPM4 的核心卖点之一，但需要谨慎看待。数据效率的提升可能来自多个因素: (1) 数据质量更高(UltraClean); (2) 模型架构更适合小规模(InfLLM v2 的稀疏性可能在训练时就减少了冗余计算); (3) 评测基准的选择性报告。独立第三方复现是验证这一结论的必要条件。

### 5.3 Long-Context Evaluation

**[原文]**
MiniCPM4-8B supports 128K context length through YaRN extension. In needle-in-a-haystack tests at 128K, MiniCPM4-8B achieves full green (100% retrieval accuracy) across all positions.

**[译文]**
MiniCPM4-8B 通过 YaRN 扩展支持 128K 上下文长度。在 128K 大海捞针测试中，MiniCPM4-8B 在所有位置都实现了全绿(100% 检索准确率)。

### 5.4 Efficiency Evaluation

**[原文]**
On Jetson AGX Orin and RTX 4090, MiniCPM4-8B demonstrates significant speed improvements over dense attention baselines. In extreme memory-constrained scenarios, inference speed improves by up to 220x.

**[译文]**
在 Jetson AGX Orin 和 RTX 4090 上，MiniCPM4-8B 相比稠密注意力基线展现出显著的速度提升。在极端内存受限场景下，推理速度提升最高达 220 倍。

> 译者注: 220 倍的加速是在「极端内存受限场景」下实现的，这意味着 baseline(稠密模型)在该场景下已经无法正常运作(频繁发生内存交换或溢出)。常规场景下的加速约为 5 倍，这个数字更具实际参考价值。但即便如此，5 倍的常规加速在端侧场景中仍然是非常可观的。

---

## 6 Applications

### 6.1 MiniCPM4-Survey: Trustworthy Survey Generation

**[原文]**
We construct MiniCPM4-Survey, a trustworthy survey generation application based on MiniCPM4. It generates structured academic surveys based on multiple papers.

**[译文]**
我们构建了 MiniCPM4-Survey，一个基于 MiniCPM4 的可信综述生成应用。它基于多篇论文生成结构化的学术综述。

### 6.2 MiniCPM4-MCP: Tool Use with Model Context Protocol

**[原文]**
We construct MiniCPM4-MCP, demonstrating MiniCPM4's tool use capabilities based on the Model Context Protocol standard.

**[译文]**
我们构建了 MiniCPM4-MCP，展示了 MiniCPM4 基于模型上下文协议标准的工具使用能力。

---

## 7 Conclusion and Future Works

**[原文]**
This paper introduces MiniCPM4, a highly efficient LLM designed for end-side devices. Through systematic innovation in architecture, data, algorithms, and inference systems, MiniCPM4 achieves comparable performance with similar-sized models while significantly improving inference efficiency.

**[译文]**
本文介绍了 MiniCPM4，一种为端侧设备设计的高效 LLM。通过在架构、数据、算法和推理系统上的系统性创新，MiniCPM4 在达到与同规模模型相当性能的同时，显著提升了推理效率。

**[原文]**
Future work includes further improving the sparsity of InfLLM v2, extending CPM.cu optimizations to more architectures, and exploring multimodal efficiency optimization.

**[译文]**
未来工作包括进一步提升 InfLLM v2 的稀疏度、将 CPM.cu 的优化扩展到更多架构，以及探索多模态效率优化。

---

> 本文档为 Chapter 14 精读系列 D4 交付物，基于 PyMuPDF 提取的原文进行逐段翻译。MinerU 因 Windows 环境 VLM 模型下载超时第 6 次失败，采用 PyMuPDF 作为替代方案。D3 原始提取文件见 `03-MiniCPM-4.0-mineru-en.md`。
