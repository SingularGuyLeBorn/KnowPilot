---
title: "02 · Gemini"
date: 2026-05-11
tags: []
---

### **Gemini 系列技术核心档案**

**核心技术报告**:

- [**Gemini 2.5: Pushing the Frontier with Advanced Reasoning, Multimodality, Long Context, and Next Generation Agentic Capabilities**](https://storage.googleapis.com/deepmind-media/gemini/gemini_v2_5_report.pdf) (Gemini Team, 2025)- [**Gemini 1.5: Unlocking multimodal understanding across millions of tokens of context**](https://storage.googleapis.com/deepmind-media/gemini/gemini_1_5_report.pdf) (Gemini Team, 2024)- [**Gemini: A Family of Highly Capable Multimodal Models**](https://storage.googleapis.com/deepmind-media/gemini/gemini_1_report.pdf) (Gemini Team, 2023)

---

#### **1. 技术规格速查表 (Technical Datasheet)** 

| 参数 (Parameter) | Gemini 1.0 (Pro/Ultra) | Gemini 1.5 Flash | Gemini 1.5 Pro | Gemini 2.0 (Flash/Lite) | Gemini 2.5 (Flash/Lite) | Gemini 2.5 Pro |
| **架构范式** | Multimodal, **Dense** | Multimodal, **Dense** | Multimodal, **Sparse (MoE)** | Multimodal, **Dense** | Multimodal, **Dense** | Multimodal, **Sparse (MoE)** |
| **参数量** | 未公开 (Ultra > Pro) | 未公开 | 未公开 | 未公开 | 未公开 | 未公开 |
| **模型总深度 (L)** | 未公开 | 未公开 | 未公开 | 未公开 | 未公开 | 未公开 |
| **隐藏层维度 (H)** | 未公开 | 未公开 | 未公开 | 未公开 | 未公开 | 未公开 |
| **注意力头数 (A)** | 未公开 | 未公开 | 未公开 | 未公开 | 未公开 | 未公开 |
| **注意力机制** | **Multi-Query Attention (MQA)** | MQA 或 Grouped-Query (推测) | MQA 或 Grouped-Query (推测) | 先进 MQA/GQA | 先进 MQA/GQA | 先进 MQA/GQA |
| **FFN 类型** | GeLU Gated Linear Unit (推测) | SwiGLU (推测) | SwiGLU (推测) | SwiGLU (推测) | SwiGLU (推测) | SwiGLU (推测) |
| **位置编码** | Learned Absolute | **Rotary (RoPE)** (推测) | **Rotary (RoPE)** (推测) | **Rotary (RoPE)** (推测) | **Rotary (RoPE)** (推测) | **Rotary (RoPE)** (推测) |
| **归一化类型** | Post-LN (推测) | **Pre-LN** (推测) | **Pre-LN** (推测) | **Pre-LN** (推测) | **Pre-LN** (推测) | **Pre-LN** (推测) |
| **训练数据量** | 未公开 | 在 1.0 基础上增量训练 | 在 1.0 基础上增量训练 | > Gemini 1.5 | > Gemini 2.0 | > Gemini 2.0 |
| **硬件平台** | TPU v4 | TPU v4 / v5e | TPU v4 / v5e | **TPU v5p** | **TPU v5p** | **TPU v5p** |
---

#### **2. 架构深度解析 (Architectural Deep Dive)** 

##### **2.1 核心架构演进：从稠密到稀疏**

- **Gemini 1.0 与所有 Flash/Lite 系列**: 采用**稠密 (Dense) Transformer** 架构。这意味着在处理每个 Token 时，模型的所有参数都会参与计算。Flash 系列通过**在线蒸馏 (Online Distillation)** 技术，从更强大的 Pro 模型中学习知识，旨在以更小的模型尺寸和计算成本，实现接近 Pro 模型的性能，从而优化推理延迟和成本。

- **Gemini 1.5 Pro & 2.5 Pro**: 采用**稀疏专家混合 (Sparse Mixture-of-Experts, MoE)** 架构。

- **技术渊源**: Established Technique (源自 Shazeer et al., 2017)。

- **实现细节**: MoE 架构包含一个**路由网络 (Router)** 和大量的**专家网络 (Experts)** ，其中每个专家通常是一个 FFN。当一个 Token 输入时，路由网络会动态地为其选择一小部分(通常是 2-4 个)最相关的专家进行激活和计算，而其他专家则保持不活动。

- **技术优势**: 这种“条件计算”机制允许模型的总参数量可以扩展到极大(远超稠密模型)，但处理单个 Token 的实际计算量 (FLOPs) 却保持不变。这是 Gemini Pro 系列能够同时实现巨大模型容量、超长上下文处理和相对高效推理的关键。

##### **2.2 关键组件细节**

- **注意力机制 (Attention Mechanism)** :

- **Gemini 1.0**: 明确采用了 **Multi-Query Attention (MQA)** 。在 MQA 中，所有的注意力头共享同一组**键 (Key)** 和**值 (Value)** 的投影矩阵，但保留各自独立的**查询 (Query)** 投影。这大大减少了推理时 KV Cache 的内存占用，从而在不显著影响性能的情况下加快了自回归解码速度。

- **Gemini 1.5 及之后**: 报告未明确指出，但为了支持百万级 Token 上下文，极有可能沿用并优化了 MQA 或采用了其变体 **Grouped-Query Attention (GQA)** ，以在性能和效率之间取得更好的平衡。

- **位置编码 (Positional Encoding)** :

- **Gemini 1.0**: 采用**可学习的绝对位置编码 (Learned Absolute PE)** ，这与 BERT 类似，将其有效上下文限制在了 32K。

- **Gemini 1.5 及之后**: 为了支持超长上下文并具备外推能力，模型**必须**采用相对位置编码方案。业界最主流且性能最好的选择是**旋转位置编码 (Rotary Positional Embedding, RoPE)** ，因此可以高置信度地推断 Gemini 1.5 及后续版本采用了 RoPE 或其改进版本。

- **归一化与激活函数 (Normalization & Activation)** :

- **归一化**: 现代大规模 Transformer 为了训练稳定性，已普遍从 BERT 时代的 **Post-LN** 转向 **Pre-LN**。Gemini 1.5/2.5 Pro 这种深度的 MoE 模型几乎必然采用 **Pre-LN** 结构。

- **激活函数**: FFN 中的激活函数也从 GeLU 演进到了更高效的 **SwiGLU (Swish-Gated Linear Unit)** ，它在众多现代 LLM 中被证明可以带来性能提升。

---

#### **3. 后训练方案 (Post-Training Regimen)** 

Gemini 的后训练是一个复杂的多阶段对齐过程，旨在提升模型的有用性、无害性和真实性。

- **全参数指令微调 (Full-Parameter SFT)** :

- **核心思想**: 在大规模、高质量、多样化的多模态指令数据集上进行全参数微调。这与 **LoRA** 等参数高效微调 (PEFT) 方法不同。LoRA 是用户在下游任务中为了节省资源而采用的方法，而谷歌在进行基础模型对齐时，采用的是**全参数微调**，以最大化地将对齐知识注入到模型权重中。

- **数据构成**: SFT 数据集包含人类编写的、模型生成的、以及半合成的数据，覆盖了对话、推理、编码、安全等多个维度。

- **强化学习对齐 (RL Alignment)** :

- **Gemini 1.0/1.5**: 主要采用标准的 **RLHF (Reinforcement Learning from Human Feedback)** 。收集人类对不同模型输出的偏好数据(如 A > B)，训练一个**奖励模型 (Reward Model)** ，然后使用 **PPO (Proximal Policy Optimization)** 等强化学习算法，将奖励模型作为信号来优化语言模型本身。

- **Gemini 2.0/2.5**: 演进为 **RL*********F (Reinforcement Learning from Human and Critic Feedback)** 。除了人类偏好数据外，还引入了一个或多个**评论家模型 (Critic Model)** 。这些评论家模型可以基于一系列预定义的规则(如事实性、安全性、简洁性)为模型的输出打分。这种“AI 反馈”与人类反馈相结合，使得对齐过程更高效、更可控，并且能够针对特定维度(如减少啰嗦)进行优化。

---

#### **4. 关键基准性能剖析 (Key Benchmark Performance)** 

| 基准测试 (Benchmark) | 任务类型 | Gemini 1.5 Pro | Gemini 2.5 Pro | 业界顶尖水平 (SOTA) |
| **MMLU** | 综合知识 | 80.8% (Lite) | **89.2% (Lite)** | Gemini 2.5 Pro 领先 |
| **GPQA (diamond)** | 研究生水平推理 | 58.1% | **86.4%** | Gemini 2.5 Pro 领先 |
| **AIME 2025** | 竞赛级数学 | 17.5% | **88.0%** | Gemini 2.5 Pro 领先 |
| **LiveCodeBench** | 真实世界编码 | 29.7% | **74.2%** | **GPT-4o (75.8%)** 略优 |
| **SWE-bench Verified** | 软件工程 | 34.2% (多尝试) | **67.2% (多尝试)** | **GPT-4o (80.2%)** 领先 |
| **LOFT (hard, 1M)** | 长上下文检索 | 47.1% | **69.8%** | Gemini 2.5 Pro SOTA |
| **MRCR-V2 (8-needle, 1M)** | 长上下文推理 | 12.1% | **16.4%** | Gemini 2.5 Pro SOTA |
**性能解读**:

- **推理与知识**: Gemini 2.5 Pro 在需要深度推理和专业知识的基准 (MMLU, GPQA, AIME) 上表现出**统治级**的性能，这直接得益于其庞大的模型规模 (MoE) 和创新的 "Thinking" 机制。

- **编码能力**: Gemini 2.5 Pro 的编码能力相较于 1.5 有了巨大飞跃，在 LiveCodeBench 等任务上已与业界最顶尖的模型处于同一水平线，但在更复杂的软件工程任务 (SWE-bench) 上，与最新的 GPT-4o 仍有一定差距。

- **长上下文**: Gemini 1.5 Pro 开创了百万级上下文的先河，而 2.5 Pro 在此基础上进一步优化了**长程推理**能力 (如 MRCR-V2)，而不仅仅是信息检索。

---

#### **5. 实用性细节与伪代码**

- **Gemini 2.0 原生图像生成 (Native Image Generation)** :

- 这是 2.0 Flash 实验版本的一个独特功能，允许模型在对话中直接生成和编辑图像，实现了真正的多模态输入与**多模态输出**。

- **与其他模型对比**: 这与 Stable Diffusion 等专用文生图模型，或通过工具调用图像生成模型的流程有本质区别。Gemini 2.0 将其整合在同一个模型中，可以实现更流畅的图文交互编辑。

- **伪代码 (Gemini 2.5 Pro Thinking API 高级用法)** :