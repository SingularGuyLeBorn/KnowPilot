---
title: "04 · Qwen2.5 Technical Report (MinerU 中文精译与译者注)"
source: 03-Qwen2.5-mineru-en.md
source_pdf: pdfs/Qwen2.5.pdf
date: 2026-05-23
---

# Qwen2.5 Technical Report 中文精译与译者注

>  **[返回 14.2-Qwen 家族总览](../../14.2-Qwen.md)**

## 原文标题说明

- 原文标题: Qwen2.5 Technical Report
- 原文作者: Qwen Team
- 原文来源: arXiv:2412.15115
- 逐译底稿: `03-Qwen2.5-mineru-en.md`
- 关联精译: `01-Qwen2.5技术报告精译.md`
- 关联专题: `05-Qwen2.5-Architecture-Overview.md`
- 关联专题: `05-Qwen2.5-Training-System.md`

## 分节结构

1. 摘要与版本定位
2. 引言: 从 Qwen2 到 Qwen2.5 的迭代方向
3. 架构与 Tokenizer
4. 预训练: 数据、超参与长上下文
5. 后训练: SFT、离线 RL、在线 RL
6. 评测、长上下文实验与结论

---

## 1. 摘要与版本定位

### 原文

In this report, we introduce Qwen2.5, a comprehensive series of large language models (LLMs) designed to meet diverse needs.

### 译文

本文介绍 Qwen2.5，这是一组面向多种需求而设计的大语言模型系列。

### 原文

Compared to previous iterations, Qwen 2.5 has been significantly improved during both the pre-training and post-training stages.

### 译文

与前代版本相比，Qwen2.5 在预训练和后训练两个阶段都获得了显著提升。

### 原文

In terms of pre-training, we have scaled the high-quality pre-training datasets from the previous 7 trillion tokens to 18 trillion tokens.

### 译文

在预训练方面，作者把高质量预训练数据从此前的 7 万亿 token 扩展到了 18 万亿 token。

> 译者注: 这个版本最核心的信号不是“参数更多”，而是“数据体系更重”。Qwen2.5 延续了 Qwen2 的架构底座，但把主要创新资源投入到更高质量、更大规模的数据工程和后训练流程里，这是一条非常典型的工业化 LLM 迭代路径。

### 原文

In terms of post-training, we implement intricate supervised finetuning with over 1 million samples, as well as multistage reinforcement learning, including offline learning DPO and online learning GRPO.

### 译文

在后训练方面，作者使用了超过 100 万条样本进行精细化监督微调，并引入多阶段强化学习，包括离线学习阶段的 DPO 和在线学习阶段的 GRPO。

### 原文

The open-weight offerings include base models and instruction-tuned models in sizes of 0.5B, 1.5B, 3B, 7B, 14B, 32B, and 72B parameters.

### 译文

开源权重部分覆盖基础模型与指令模型，参数规模包括 0.5B、1.5B、3B、7B、14B、32B 和 72B。

### 原文

For hosted solutions, the proprietary models currently include two mixture-of-experts (MoE) variants: Qwen2.5-Turbo and Qwen2.5-Plus.

### 译文

对于托管服务方案，作者同时提供两个专有的 MoE 变体：Qwen2.5-Turbo 与 Qwen2.5-Plus。

> 译者注: 这里已经能看出 Qwen2.5 的产品线思路非常清晰：开源稠密模型覆盖开发者生态，商业化侧则通过 Turbo/Plus 提供更高的成本性能比和更长上下文能力。它不是单一模型，而是完整的产品矩阵。

---

## 2. 引言: 从 Qwen2 到 Qwen2.5 的迭代方向

### 原文

The continuous advancement in model and data scaling, combined with the paradigm of large-scale pre-training followed by high-quality supervised fine-tuning (SFT) and reinforcement learning from human feedback (RLHF), has enabled large language models (LLMs) to develop emergent capabilities.

### 译文

模型与数据规模的持续扩展，加上“大规模预训练 + 高质量 SFT + RLHF”的训练范式，使得大语言模型出现了越来越多的涌现能力。

### 原文

The open-weight models have democratized the access of large language models to common users and developers.

### 译文

开源权重模型让普通用户和开发者更容易接触并使用大语言模型，也由此推动了更广泛的研究参与和应用创新。

### 原文

Recently, we release the details of our latest version of the Qwen series, Qwen2.5.

### 译文

在这篇报告中，作者系统公开了 Qwen 系列最新版本 Qwen2.5 的技术细节。

### 原文

Below, we show the key features of the latest version of Qwen.

### 译文

作者随后把 Qwen2.5 的升级总结为三个方向：尺寸更丰富、数据更优、使用体验更好。

> 译者注: 这三个方向对应的是三种不同的工程目标。尺寸矩阵解决部署覆盖面，数据升级解决能力上限，使用体验优化则面向真实产品可用性。Qwen2.5 的报告很明显不是只为学术 benchmark 写的，而是围绕“如何把一个系列模型做成可交付产品”展开的。

---

## 3. 架构与 Tokenizer

### 原文

For dense models, we maintain the Transformer-based decoder architecture as Qwen2.

### 译文

在稠密模型部分，Qwen2.5 延续了与 Qwen2 相同的 Transformer Decoder 架构。

### 原文

The architecture incorporates several key components: Grouped Query Attention (GQA), SwiGLU activation function, Rotary Positional Embeddings (RoPE), QKV bias and RMSNorm with pre-normalization.

### 译文

其核心组件包括 GQA、SwiGLU 激活函数、RoPE 位置编码、注意力中的 QKV bias，以及采用 pre-normalization 的 RMSNorm。

### 原文

Building upon the dense model architectures, we extend it to MoE model architectures.

### 译文

在稠密模型架构的基础上，作者进一步把它扩展到了 MoE 架构。

### 原文

We implement fine-grained expert segmentation and shared experts routing.

### 译文

具体做法包括细粒度专家切分和共享专家路由。

### 原文

We have expanded the set of control tokens from 3 to 22 compared to previous Qwen versions.

### 译文

与之前的 Qwen 版本相比，Qwen2.5 把控制 token 的数量从 3 个扩展到了 22 个。

> 译者注: 这说明 Qwen2.5 虽然没有做激进的底层架构革命，但在“控制接口”层面变得更工程化了。控制 token 的扩展，本质上是在为工具调用、结构化输出和系统行为控制提供统一的协议接口。

---

## 4. 预训练: 数据、超参与长上下文

### 原文

Qwen2.5 demonstrates significant enhancements in pre-training data quality compared to its predecessor Qwen2.

### 译文

与前代 Qwen2 相比，Qwen2.5 在预训练数据质量上有明显提升。

### 原文

These improvements stem from several key aspects: better data filtering, better math and code data, better synthetic data, and better data mixture.

### 译文

这些提升主要来自四个方面：更好的数据过滤、更好的数学与代码数据、更好的合成数据，以及更好的数据混合策略。

### 原文

Building on these techniques, we have developed a larger and higher-quality pre-training dataset, expanding from the 7 trillion tokens used in Qwen2 to 18 trillion tokens.

### 译文

在这些技术基础上，作者构建了一个更大、质量也更高的预训练数据集，把规模从 Qwen2 的 7 万亿 token 扩展到 18 万亿 token。

### 原文

We develop scaling laws for hyper-parameter based on the pre-training data of Qwen2.5.

### 译文

作者进一步基于 Qwen2.5 的预训练数据构建了用于预测超参数的 scaling law。

### 原文

Our scaling laws help determine key training parameters like batch size and learning rate for both dense models and MoE models of varying sizes.

### 译文

这些 scaling law 用于预测不同尺寸稠密模型和 MoE 模型的关键训练超参数，例如 batch size 和学习率。

> 译者注: 把 scaling law 从“决定模型多大”扩展到“决定模型怎么训”，是很典型的工业化升级。它的意义不在论文层面的新奇，而在于能显著减少大模型超参搜索的试错成本。

### 原文

For optimal training efficiency, Qwen2.5 employs a two-phase pre-training approach.

### 译文

为了兼顾训练效率和长上下文能力，Qwen2.5 采用两阶段预训练：先在较短上下文上训练，再在后期扩展到更长序列。

### 原文

Qwen2.5-Turbo implements a progressive context length expansion strategy during training, advancing through four stages.

### 译文

Qwen2.5-Turbo 则采用更激进的渐进式上下文扩展策略，在训练中分四个阶段逐步拉长上下文。

### 原文

Through these innovations, we achieve a four-fold increase in sequence length capacity, enabling Qwen2.5-Turbo to handle up to 1 million tokens and other models to process up to 131,072 tokens.

### 译文

借助这些方法，Qwen2.5-Turbo 的上下文能力被扩展到最高 100 万 token，其他模型则支持最高 131,072 token。

> 译者注: 这里的重点不是“1M token 很大”，而是 Turbo 通过渐进式训练、RoPE 基频调整、YARN 和 DCA 组合，把超长上下文从单纯宣传口径变成了可运行的产品能力。这和很多只在配置文件里声明大窗口的模型不一样。

---

## 5. 后训练: SFT、离线 RL、在线 RL

### 原文

Qwen 2.5 introduces two significant advancements in its post-training design compared to Qwen 2.

### 译文

与 Qwen2 相比，Qwen2.5 在后训练设计上有两个显著升级：更大规模的 SFT 数据覆盖，以及两阶段强化学习。

### 原文

The supervised fine-tuning process leverages a massive dataset comprising millions of high-quality examples.

### 译文

监督微调阶段使用了由数百万高质量样本构成的大规模数据集。

### 原文

The reinforcement learning process in Qwen 2.5 is divided into two distinct stages: Offline RL and Online RL.

### 译文

强化学习阶段被拆分为两个不同步骤：离线 RL 与在线 RL。

### 原文

Offline RL focuses on developing capabilities that are challenging for the reward model to evaluate, such as reasoning, factuality, and instruction-following.

### 译文

离线 RL 主要针对那些奖励模型难以稳定评估、但又非常关键的能力，例如推理、事实性和指令遵循。

### 原文

Online RL leverages the reward model’s ability to detect nuances in output quality, including truthfulness, helpfulness, conciseness, relevance, harmlessness and debiasing.

### 译文

在线 RL 则利用奖励模型去捕捉输出质量中的细粒度差别，例如真实性、有用性、简洁性、相关性、无害性和去偏能力。

### 原文

The Online RL phase uses Group Relative Policy Optimization (GRPO).

### 译文

在线 RL 阶段采用的是 Group Relative Policy Optimization，也就是 GRPO。

> 译者注: 这是 Qwen2.5 在方法论上的一个关键转折。它不再只停留在 DPO 这种离线偏好优化上，而是把 RL 正式纳入主训练链路，说明团队已经把“在线偏好迭代”当成可以稳定工程化的能力。

### 原文

During the RL stage, we use a training strategy similar to that used for the other Qwen2.5 models, focusing solely on short instructions.

### 译文

在 RL 阶段，作者仍然主要使用短指令数据进行训练，而没有直接在超长上下文上做大规模 RL。

### 原文

We find that adopting RL on short instructions alone can still significantly enhance the model’s alignment with human preferences in long context tasks.

### 译文

作者观察到，即便只在短指令上做 RL，也能显著改善模型在长上下文任务中的人类偏好对齐表现。

> 译者注: 这说明“偏好对齐”具备一定的跨长度迁移性。它是很实用的工程结论，因为长上下文 RL 的成本极高，如果短指令 RL 就能带来泛化收益，工业团队就没必要一开始就把训练预算砸到最贵的那部分。

---

## 6. 评测、长上下文实验与结论

### 原文

To prevent test data leakage, we exclude potentially contaminated data using n-gram matching when constructing the pre-training and post-training datasets.

### 译文

为了避免测试集污染，作者在构建预训练和后训练数据时使用 n-gram 匹配规则来排除潜在泄漏样本。

### 原文

The Qwen2.5-72B base model significantly outperforms its peers in the same category across a wide range of tasks.

### 译文

在基础模型评测中，Qwen2.5-72B 在大量任务上都明显优于同级别对手。

### 原文

The Qwen2.5-72B-Instruct model delivers exceptional performance, even surpassing the larger Llama-3.1-405B-Instruct in several critical benchmarks.

### 译文

在指令模型评测中，Qwen2.5-72B-Instruct 在多个关键 benchmark 上甚至超过了体量更大的 Llama-3.1-405B-Instruct。

### 原文

Qwen2.5-Turbo achieves 100% accuracy in the 1M-token passkey retrieval task.

### 译文

在 100 万 token 的 passkey retrieval 测试中，Qwen2.5-Turbo 达到了 100% 的准确率。

### 原文

For sequences of 1M tokens, this approach reduces the computational load of the attention mechanism by 12.5 times.

### 译文

对于 100 万 token 长度的输入，这套稀疏注意力推理方案把注意力计算负载降低了 12.5 倍。

### 原文

In the future, we will focus on advancing robust foundational models.

### 译文

在结论部分，作者表示后续将继续推进更稳健的基础模型，包括更高质量的数据、更统一的多模态框架，以及更强的推理能力。

> 译者注: Qwen2.5 的结论很能说明它在整个 Qwen 谱系中的位置。它不是靠单一架构创新取胜，而是通过“数据系统 + 后训练系统 + 长上下文系统”三个工程面同时升级，把 Qwen 从一个强模型系列推进成一个更成熟的产品化平台。

---

## 全文完

## 关联文件说明

- 英文底稿: `03-Qwen2.5-mineru-en.md`
- 前序精译: `01-Qwen2.5技术报告精译.md`
- 架构专题: `05-Qwen2.5-Architecture-Overview.md`
- 工程专题: `05-Qwen2.5-Training-System.md`
- 目录索引: `05-Qwen2.5-Index.md`
