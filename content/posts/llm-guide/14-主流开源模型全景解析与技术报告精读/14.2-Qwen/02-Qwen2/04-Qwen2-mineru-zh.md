---
title: "Qwen2 - 逐段精译与译者注"
source: 03-Qwen2-mineru-en.md
translated_by: "AI Agent"
date: 2026-05-19
---


An Yang, Baosong Yang, Binyuan Hui, Bo Zheng, Bowen Yu, Chang Zhou, Chengpeng Li, Chengyuan Li, Dayiheng Liu, Fei Huang, Guanting Dong, Haoran Wei, Huan Lin, Jialong Tang, Jialin Wang, Jian Yang, Jianhong Tu, Jianwei Zhang, Jianxin Ma, Jianxin Yang, Jin Xu, Jingren Zhou, Jinze Bai, Jinzheng He, Junyang Lin, Kai Dang, Keming Lu, Keqin Chen, Kexin Yang, Mei Li, Mingfeng Xue, Na Ni, Pei Zhang, Peng Wang, Ru Peng, Rui Men, Ruize Gao, Runji Lin, Shijie Wang, Shuai Bai, Sinan Tan, Tianhang Zhu, Tianhao Li, Tianyu Liu, Wenbin Ge, Xiaodong Deng, Xiaohuan Zhou, Xingzhang Ren, Xinyu Zhang, Xipin Wei, Xuancheng Ren, Xuejing Liu, Yang Fan, Yang Yao, Yichang Zhang, Yu Wan, Yunfei Chu, Yuqiong Liu, Zeyu Cui, Zhenru Zhang, Zhifang Guo, and Zhihao Fan

Qwen Team, Alibaba Group∗

# Qwen2 Technical Report

> 🔙 **[返回 14.2-Qwen 家族总览](../../14.2-Qwen.md)**


An Yang, Baosong Yang, Binyuan Hui, Bo Zheng, Bowen Yu, Chang Zhou, Chengpeng Li, Chengyuan Li, Dayiheng Liu, Fei Huang, Guanting Dong, Haoran Wei, Huan Lin, Jialong Tang, Jialin Wang, Jian Yang, Jianhong Tu, Jianwei Zhang, Jianxin Ma, Jianxin Yang, Jin Xu, Jingren Zhou, Jinze Bai, Jinzheng He, Junyang Lin, Kai Dang, Keming Lu, Keqin Chen, Kexin Yang, Mei Li, Mingfeng Xue, Na Ni, Pei Zhang, Peng Wang, Ru Peng, Rui Men, Ruize Gao, Runji Lin, Shijie Wang, Shuai Bai, Sinan Tan, Tianhang Zhu, Tianhao Li, Tianyu Liu, Wenbin Ge, Xiaodong Deng, Xiaohuan Zhou, Xingzhang Ren, Xinyu Zhang, Xipin Wei, Xuancheng Ren, Xuejing Liu, Yang Fan, Yang Yao, Yichang Zhang, Yu Wan, Yunfei Chu, Yuqiong Liu, Zeyu Cui, Zhenru Zhang, Zhifang Guo, and Zhihao Fan

通义千问团队，阿里巴巴集团∗

## ABSTRACT

This report introduces the Qwen2 series, the latest addition to our large language models and large multimodal models. We release a comprehensive suite of foundational and instruction-tuned language models, encompassing a parameter range from 0.5 to 72 billion, featuring dense models and a Mixture-of-Experts model. Qwen2 surpasses most prior open-weight models, including its predecessor Qwen1.5, and exhibits competitive performance relative to proprietary models across diverse benchmarks on language understanding, generation, multilingual proficiency, coding, mathematics, and reasoning.

本报告介绍了 Qwen2 系列，这是我们大型语言模型和大型多模态模型的最新成果。我们发布了一套全面的基础模型和指令微调模型，参数量范围从 5 亿到 720 亿，包含稠密模型和混合专家(MoE)模型。Qwen2 超越了多数此前的开放权重模型(包括其前身 Qwen1.5)，并在语言理解、生成、多语言能力、编程、数学和推理等多个基准测试上展现出与闭源专有模型相媲美的竞争力。

The flagship model, Qwen2-72B, showcases remarkable performance: 84.2 on MMLU, 37.9 on GPQA, 64.6 on HumanEval, 89.5 on GSM8K, and 82.4 on BBH as a base language model. The instruction-tuned variant, Qwen2-72B-Instruct, attains 9.1 on MT-Bench, 48.1 on Arena-Hard, and 35.7 on LiveCodeBench. Moreover, Qwen2 demonstrates robust multilingual capabilities, proficient in approximately 30 languages, spanning English, Chinese, Spanish, French, German, Arabic, Russian, Korean, Japanese, Thai, Vietnamese, and more, underscoring its versatility and global reach.

旗舰模型 Qwen2-72B 展现了出色的性能：作为基础语言模型，在 MMLU 上得分 84.2，GPQA 上 37.9，HumanEval 上 64.6，GSM8K 上 89.5，BBH 上 82.4。其指令微调版本 Qwen2-72B-Instruct 在 MT-Bench 上获得 9.1 分，Arena-Hard 上 48.1 分，LiveCodeBench 上 35.7 分。此外，Qwen2 展现出强大的多语言能力，精通约 30 种语言，涵盖英语、中文、西班牙语、法语、德语、阿拉伯语、俄语、韩语、日语、泰语、越南语等，凸显了其通用性和全球覆盖能力。

To foster community innovation and accessibility, we have made the Qwen2 model weights openly available on Hugging Face¹ and ModelScope², and the supplementary materials including example code on GitHub³. These platforms also include resources for quantization, fine-tuning, and deployment, facilitating a wide range of applications and research endeavors.

为促进社区创新和应用普及，我们已在 Hugging Face¹ 和 ModelScope² 上公开了 Qwen2 的模型权重，并在 GitHub³ 上发布了包括示例代码在内的补充材料。这些平台还提供了量化、微调和部署等相关资源，以支持广泛的应用和研究工作。

> **【译者注 · 数据可信度与性能定位】**
> 摘要中列出的基准测试分数(如 MMLU 84.2、Arena-Hard 48.1)直接引用自官方技术报告原文，建议读者结合第三方复测结果(如 OpenCompass、LMSYS Chatbot Arena 的同期排行)进行交叉验证。值得注意的是，Qwen2-72B 作为开源稠密模型，在发布时已在多项指标上逼近甚至超越部分闭源 API 模型，这一定位在当时(2024 年中)迅速拉升了开源社区对"开源 vs 闭源"差距缩小的预期。


1 Introduction 3  
2 Tokenizer & Model 3  
2.1 Tokenizer 3  
2.2 Model Architecture 4  
2.2.1 Qwen2 Dense Model . 4  
2.2.2 Qwen2 Mixture-of-experts Model 4  
2.2.3 Model Configuration 5  
3 Pre-training 5  
3.1 Pre-training Data 5  
3.2 Long-context Training 6  
4 Post-training 6  
4.1 Post-training Data . . 6  
4.1.1 Collaborative Data Annotation 7  
4.1.2 Automated Data Synthesis 7  
4.2 Supervised Fine-tuning . 8  
4.3 Reinforcement Learning from Human Feedback . 8  
5 Evaluation 8  
5.1 Base Language Models . 8  
5.1.1 Core Capabilities 8  
5.2 Instruction-tuned Model 12  
5.2.1 Open Benchmark Evaluation 12  
5.2.2 In-house Automatic Evaluation 14  
5.2.3 Long Context Capabilities 15  
5.2.4 Multilingual Evaluation 18  
5.2.5 Safety & Responsibility 18  
5.2.6 Contamination Analysis 19  
6 Conclusion 20


1 引言 3  
2 分词器与模型 3  
2.1 分词器 3  
2.2 模型架构 4  
2.2.1 Qwen2 稠密模型 4  
2.2.2 Qwen2 混合专家模型 4  
2.2.3 模型配置 5  
3 预训练 5  
3.1 预训练数据 5  
3.2 长上下文训练 6  
4 后训练 6  
4.1 后训练数据 6  
4.1.1 协作数据标注 7  
4.1.2 自动化数据合成 7  
4.2 监督微调 8  
4.3 基于人类反馈的强化学习 8  
5 评估 8  
5.1 基础语言模型 8  
5.1.1 核心能力 8  
5.2 指令微调模型 12  
5.2.1 开放基准评估 12  
5.2.2 内部自动评估 14  
5.2.3 长上下文能力 15  
5.2.4 多语言评估 18  
5.2.5 安全与责任 18  
5.2.6 数据污染分析 19  
6 结论 20

## 1 INTRODUCTION

Following the emergence of ChatGPT (OpenAI, 2022), enthusiasm for large language models (LLMs) has escalated globally. The release of the Llama series (Touvron et al., 2023) has further ignited interests within the open-source community, particularly regarding GPT-level local LLMs. Recently, Claude-3 Opus (Anthropic, 2024) and GPT-4o (omni) (OpenAI, 2024), the updated model for ChatGPT, have ascended to the pinnacle of the Chatbot Arena (Chiang et al., 2024) in quick succession. This platform is well-regarded for its human evaluations of LLMs. Moreover, Llama-3 (AI@Meta, 2024) has emerged as the state-of-the-art open-weight model series, narrowing the performance gap with leading proprietary models and widely acknowledged as GPT-4–level. An increasing number of competitive LLMs are now pursuing advancements similar to those made by the GPT series from OpenAI. Many of these models, including Qwen (Bai et al., 2023a), Mistral (Jiang et al., 2023a), Gemma (Mesnard et al., 2024), etc., have been released in an open-weight manner.

自 ChatGPT(OpenAI, 2022)问世以来，全球对大型语言模型(LLM)的热情持续高涨。Llama 系列(Touvron et al., 2023)的发布进一步点燃了开源社区对 GPT 级别本地部署 LLM 的兴趣。近期，Claude-3 Opus(Anthropic, 2024)和 ChatGPT 的升级版本 GPT-4o (omni)(OpenAI, 2024)相继登上 Chatbot Arena(Chiang et al., 2024)的榜首——该平台以人工评估 LLM 而闻名。此外，Llama-3(AI@Meta, 2024)已成为最先进的开放权重模型系列，缩小了与领先闭源模型的性能差距，并被广泛认为达到了 GPT-4 级别。越来越多具有竞争力的 LLM 正在追赶 OpenAI GPT 系列的进展，其中包括 Qwen(Bai et al., 2023a)、Mistral(Jiang et al., 2023a)、Gemma(Mesnard et al., 2024)等，这些模型均已以开放权重形式发布。

Over recent months, we have successively introduced the Qwen series (Bai et al., 2023a) and progressed to Qwen1.5 (Qwen Team, 2024a). In the meantime, we have unveiled the vision-language model Qwen-VL (Bai et al., 2023b), and launched the audio-language model Qwen-Audio (Chu et al., 2023). In this work, we introduce the newest addition to the Qwen family of large language models and large multimodal modles: Qwen2. Qwen2 is a series of LLMs, grounded in the Transformer architecture (Vaswani et al., 2017), trained using next-token prediction. The model series encompasses foundational, i.e., base language models, pre-trained but unaligned to human preferences, and instruction-tuned models, fine-tuned with single-turn and multi-turn instruction-following datasets suitable for chat and agent purposes. Our release comprises four dense models with parameter counts of 0.5 billion, 1.5 billion, 7 billion, and 72 billion, plus a Mixture-of-Experts (MoE) model with 57 billion parameters, of which 14 billion are activated for each token. The smaller models, specifically Qwen2-0.5B and Qwen2-1.5B, are designed for easy deployment on portable devices such as smartphones, earphones, and smart glasses. Conversely, the larger models cater to deployment across GPUs of varying scales.

近几个月来，我们相继推出了 Qwen 系列(Bai et al., 2023a)并演进至 Qwen1.5(Qwen Team, 2024a)。同期，我们还发布了视觉语言模型 Qwen-VL(Bai et al., 2023b)以及音频语言模型 Qwen-Audio(Chu et al., 2023)。在本工作中，我们介绍了 Qwen 大型语言模型与大型多模态模型家族的最新成员：Qwen2。Qwen2 是一系列基于 Transformer 架构(Vaswani et al., 2017)、采用 next-token prediction 训练的语言模型。该系列包含基础模型(即未经人类偏好对齐的预训练基座模型)以及指令微调模型(使用单轮和多轮指令跟随数据集进行微调，适用于对话和智能体场景)。本次发布包含四个稠密模型，参数量分别为 5 亿、15 亿、70 亿和 720 亿，外加一个总参数量 570 亿、单 token 激活 140 亿参数的混合专家(MoE)模型。较小的模型(Qwen2-0.5B 和 Qwen2-1.5B)专为智能手机、耳机、智能眼镜等便携设备上的轻量部署而设计; 较大的模型则面向不同规模 GPU 的部署需求。

All models were pre-trained on a high-quality, large-scale dataset comprising over 7 trillion tokens, covering a wide range of domains and languages. Compared to previous editions of Qwen, Qwen2 includes a broader spectrum of linguistic data, enhancing the quantity and quality of code and mathematics content. This enrichment is hypothesized to improve reasoning abilities of LLMs. Regarding post-training, all models underwent supervised fine-tuning and direct preference optimization (DPO, Rafailov et al., 2023), aligning them with human preferences through learning from human feedback. This process endows the models with the capability to follow instructions effectively.

所有模型均在高质量、大规模数据集上进行了预训练，数据规模超过 7 万亿 token，涵盖广泛的领域和语言。与此前版本的 Qwen 相比，Qwen2 纳入了更广泛的语言数据，并提升了代码和数学内容的数量与质量。这种丰富化被认为有助于提升 LLM 的推理能力。在后训练阶段，所有模型均经历了监督微调和直接偏好优化(DPO, Rafailov et al., 2023)，通过从人类反馈中学习来对齐人类偏好，从而使模型具备有效遵循指令的能力。

We have conducted a thorough evaluation of Qwen2, alongside a selection of baseline models including both open-weight and proprietary models accessible via API. Qwen2 outperforms competing models in evaluations of both fundamental language capabilities and instruction-tuned functionalities Specifically, Qwen2-72B-Instruct, our instruction-tuned variant, scores 9.1 on MT-Bench (Zheng et al., 2023), 48.1 on Arena-Hard (Chiang et al., 2024), and 35.7 on LiveCodeBench (Jain et al., 2024). Meanwhile, Qwen2-72B, the base language model, achieves 84.2 on MMLU (Hendrycks et al., 2021a), 37.9 on GPQA (Rein et al., 2023), 64.6 on HumanEval (Chen et al., 2021), 89.5 on GSM8K (Cobbe et al., 2021), and 82.4 on BBH (Suzgun et al., 2023).

我们对 Qwen2 以及一系列基线模型(包括开放权重模型和可通过 API 访问的专有模型)进行了全面评估。Qwen2 在基础语言能力和指令微调功能两项评估中均超越了竞争模型。具体而言，我们的指令微调版本 Qwen2-72B-Instruct 在 MT-Bench(Zheng et al., 2023)上获得 9.1 分，Arena-Hard(Chiang et al., 2024)上 48.1 分，LiveCodeBench(Jain et al., 2024)上 35.7 分; 同时，基础语言模型 Qwen2-72B 在 MMLU(Hendrycks et al., 2021a)上达到 84.2，GPQA(Rein et al., 2023)上 37.9，HumanEval(Chen et al., 2021)上 64.6，GSM8K(Cobbe et al., 2021)上 89.5，BBH(Suzgun et al., 2023)上 82.4。

> **【译者注 · 技术谱系与模型定位】**
> 引言清晰勾勒了 Qwen2 的技术谱系：从早期 Qwen 到 Qwen1.5，再到并行发展的 Qwen-VL 和 Qwen-Audio，最终汇聚为统一迭代的 Qwen2 语言模型家族。这种"底座统一、模态分支"的演进路径与业界主流(如 GPT-4V、Gemini)保持一致。文中提到的 7T token 预训练规模和 DPO 对齐策略，均属于 2024 年上半年开源大模型的标准配置，但 Qwen2 的差异化在于其极端的尺寸覆盖(0.5B 到 72B)以及对端侧部署(手机、耳机、眼镜)的明确产品化考量，这在当时同类开源模型中较为少见。

## 2 TOKENIZER & MODEL

This section introduces the tokenizer and model design of Qwen2. We detail the model architecture and configurations for different model sizes.

本节介绍 Qwen2 的分词器和模型设计。我们将详细阐述模型架构以及不同尺寸模型的配置信息。

### 2.1 TOKENIZER

Following Qwen (Bai et al., 2023a), we employ the identical tokenizer based on byte-level bytepair encoding. Notably, this tokenizer exhibits high encoding efficiency, as evidenced by its better compression rate relative to alternatives, facilitating the multilingual capabilities of Qwen2.

沿用 Qwen(Bai et al., 2023a)的设计，我们采用了相同的基于字节级字节对编码(byte-level byte-pair encoding)的分词器。值得注意的是，该分词器展现出极高的编码效率，其压缩率优于其他替代方案，这为 Qwen2 的多语言能力提供了有力支撑。

Models of all sizes employ a common vocabulary consisting of 151,643 regular tokens and 3 control tokens. For more information, please refer to Bai et al. (2023a). It should be noted that, owing to considerations in distributed training, the effective size for the embeddings is larger.

所有尺寸的模型均采用统一的词表，包含 151,643 个常规 token 和 3 个控制 token。更多细节请参阅 Bai et al. (2023a)。需要指出的是，出于分布式训练的考虑，嵌入层的实际有效尺寸更大。

> **【译者注 · 工程细节与分词策略】**
> Qwen2 坚持沿用初代 Qwen 的分词器，体现了"tokenizer 不变、模型迭代"的工程哲学。统一词表(约 15.2 万词)在多尺寸模型间共享，有利于知识蒸馏、模型合并及下游工具的复用。文中提到"嵌入层实际有效尺寸更大"，暗示了因张量并行(tensor parallelism)对齐而对词表维度做了填充(padding)，这是大规模分布式训练中常见的工程 trick，但报告未给出具体填充后尺寸，读者若需精确复现应注意此细节。

### 2.2 MODEL ARCHITECTURE

The Qwen2 series fundamentally constitute large language models based on the Transformer architecture, featuring self-attention with causal masks (Vaswani et al., 2017). Specifically, this series encompasses dense language models of 4 scales and a Mixture-of-Experts (MoE) model. We introduce the specifics of the dense models before delving into the MoE model’s distinctive attributes.

Qwen2 系列本质上基于 Transformer 架构构建，采用带有因果掩码的自注意力机制(Vaswani et al., 2017)。具体而言，该系列包含 4 种规模的稠密语言模型和一种混合专家(MoE)模型。我们将先介绍稠密模型的具体设计，再深入探讨 MoE 模型的独特特性。

#### 2.2.1 QWEN2 DENSE MODEL

The architecture of the Qwen2 dense models comprises multiple Transformer layers, each equipped with causal attention mechanisms and feed-forward neural networks (FFNs). Key differences from Qwen are described below:

Qwen2 稠密模型的架构由多层 Transformer 组成，每层均配备因果注意力机制和前馈神经网络(FFN)。与 Qwen 相比的关键差异如下：

**Grouped Query Attention** We adopt Grouped Query Attention (GQA, Ainslie et al., 2023) instead of conventional multi-head attention (MHA). GQA optimizes KV cache usage during inference, significantly enhancing throughput. Detailed KV head configurations for various model sizes are reported in Section 2.2.3.

**分组查询注意力(Grouped Query Attention)** 我们采用分组查询注意力(GQA, Ainslie et al., 2023)替代传统的多头注意力(MHA)。GQA 在推理过程中优化了 KV 缓存的使用，显著提升了吞吐率。各尺寸模型的 KV 头配置详见第 2.2.3 节。

**Dual Chunk Attention with YARN** To expand the context window of Qwen2, we implement Dual Chunk Attention (DCA, An et al., 2024), which segments long sequences into chunks of manageable lengths. If the input can be handled in a chunk, DCA produces the same result as the original attention. Otherwise, DCA facilitates effective capture of relative positional information between tokens within and across chunks, thereby improving long context performance. Moreover, we also employ YARN (Peng et al., 2023) to rescale the attention weights for better length extrapolation.

**结合 YARN 的双块注意力(Dual Chunk Attention)** 为扩展 Qwen2 的上下文窗口，我们实现了双块注意力(DCA, An et al., 2024)，它将长序列切分为可管理的块长度。若输入能在单块内处理，DCA 的输出与原始注意力一致; 否则，DCA 能够有效捕获块内及块间 token 的相对位置信息，从而提升长上下文性能。此外，我们还采用 YARN(Peng et al., 2023)重新缩放注意力权重，以实现更好的长度外推。

Moreover, we follow Qwen with the usage of SwiGLU (Dauphin et al., 2017) for activation, Rotary Positional Embeddings (RoPE, Su et al., 2024) for positional embedding, QKV bias (Su, 2023) for attention, RMSNorm (Jiang et al., 2023b) and pre-normalization for training stability.

此外，我们沿用 Qwen 的设计，使用 SwiGLU(Dauphin et al., 2017)作为激活函数，Rotary Positional Embeddings(RoPE, Su et al., 2024)作为位置编码，在注意力中引入 QKV 偏置(Su, 2023)，并采用 RMSNorm(Jiang et al., 2023b)和预归一化策略以保障训练稳定性。

> **【译者注 · 长上下文工程方案】**
> Qwen2 在长上下文扩展上采用了"DCA + YARN"的组合拳，而非单纯依赖位置编码插值(如 PI)或 ALiBi。DCA 的 chunk 切分策略在工程实现上兼顾了显存占用与注意力精度：短序列无开销，长序列通过块间相对位置保持全局一致性。YARN 则针对 RoPE 的衰减问题做了频率重缩放。值得注意的是，这两项技术均来自阿里巴巴自身及合作团队(DCA 的 An et al. 即 Qwen 团队成员)，显示出 Qwen 在长上下文方向上的自研技术闭环。

#### 2.2.2 QWEN2 MIXTURE-OF-EXPERTS MODEL

The architecture of Qwen2 MoE models closely mirrors that of Qwen1.5-MoE-A2.7B (Qwen Team, 2024c). As a substitute for the original FFN, the MoE FFN consists of n individual FFNs, each serving as an expert. Each token is directed to a specific expert $E _ { i }$ for computation based on probabilities assigned by a gated network G:

Qwen2 MoE 模型的架构与 Qwen1.5-MoE-A2.7B(Qwen Team, 2024c)高度相似。作为原始 FFN 的替代，MoE 中的 FFN 由 n 个独立的 FFN 组成，每个 FFN 即为一个专家。每个 token 根据门控网络 G 分配的概率被路由至特定专家 $E _ { i }$ 进行计算：

$$
\mathbf { p } = \operatorname { s o f t m a x } \left( G \left( \mathbf { x } \right) \right) ,\tag{1}
$$

$$
\mathbf { y } = \sum _ { i \in \mathrm { t o p } _ { k } ( \mathbf { p } ) } \mathbf { p } _ { i } E _ { i } ( \mathbf { x } ) .\tag{2}
$$

In the following, we present critical design considerations of Qwen2 MoE.

下文将介绍 Qwen2 MoE 的关键设计考量。

**Expert Granularity** The key structural difference between MoE models and dense models is that MoE layers incorporate multiple FFNs, each serving as an individual expert. Consequently, one straightforward strategy to transition from a dense architecture to an MoE architecture is to set the parameters of each expert equal to those of a single FFN from the original dense model. For example, transitioning from Mistral-7B (Jiang et al., 2023a) to Mixtral 8x7B (Jiang et al., 2024), involves activating two of the eight experts at a time. Differently, our model employs fine-grained experts (Dai et al., 2024), creating smaller-scale experts while activating a greater number of experts simultaneously. Given an equal total number of expert parameters and activated parameters, finegrained experts offer a richer set of expert combinations. By leveraging these fine-grained experts, Qwen2 MoE facilitates more diverse and dynamic expert utilization, thereby enhancing overall performance and adaptability.

**专家粒度** MoE 模型与稠密模型的关键结构差异在于，MoE 层包含多个 FFN，每个 FFN 作为一个独立专家。因此，从稠密架构过渡到 MoE 架构的一种直接策略是将每个专家的参数量设置为原始稠密模型单个 FFN 的参数量。例如，从 Mistral-7B(Jiang et al., 2023a)过渡到 Mixtral 8x7B(Jiang et al., 2024)，每次激活 8 个专家中的 2 个。不同的是，我们的模型采用了细粒度专家(Dai et al., 2024)，在创建更小规模专家的同时，每次激活更多的专家数量。在总专家参数量和激活参数量相等的前提下，细粒度专家提供了更丰富的专家组合。借助这些细粒度专家，Qwen2 MoE 实现了更多样、更动态的专家利用，从而提升了整体性能和适应性。

**Expert Routing** The design of expert routing mechanisms is crucial for enhancing the performance of MoE models. Recently, there has been a notable trend towards integrating both shared and routing-specific experts within MoE layers (Rajbhandari et al., 2022; Dai et al., 2024). We adopt this approach, as it facilitates the application of shared experts across various tasks while reserving others for selective use in specific routing scenarios. The introduction of shared and specialized experts offers a more adaptable and efficient method for developing MoE routing mechanisms.

**专家路由** 专家路由机制的设计对于提升 MoE 模型性能至关重要。近期，一个显著的趋势是在 MoE 层中同时整合共享专家和路由特定专家(Rajbhandari et al., 2022; Dai et al., 2024)。我们采用了这一方案，因为它便于将共享专家应用于各类任务，同时将其他专家保留给特定路由场景选择性使用。共享专家与专用专家的引入，为开发 MoE 路由机制提供了一种更具适应性和更高效的方法。

**Table 1: Architecture of Qwen2 dense and MoE models.** For MoE models, 57B-A14B denotes that the model has 57B parameters in total and for each token 14B parameters are active, the Intermediate size denotes that of each expert, and # Activated Experts excludes the shared experts.

**表 1：Qwen2 稠密模型与 MoE 模型架构。** 对于 MoE 模型，57B-A14B 表示模型总参数量为 570 亿，每个 token 激活 140 亿参数; 中间层尺寸指单个专家的尺寸; 激活专家数不含共享专家。

> **【表格概述】**
> 该表列出了 Qwen2 系列 5 种尺寸模型(0.5B、1.5B、7B、72B 稠密模型，以及 57B-A14B MoE 模型)的关键超参数，涵盖隐藏层维度、层数、Query/KV 头数、头尺寸、中间层尺寸、路由/共享/激活专家数量、嵌入是否共享、词表大小及预训练 token 量等。其中，MoE 模型的 57B-A14B 基于 7B 稠密模型扩展，隐藏层维度与层数与 7B 一致; 0.5B 小模型使用了 12T token 进行预训练，其余稠密模型(除 MoE 外)均使用 7T token。完整 HTML 表格及精确数值请参阅 D3 原文(`03-Qwen2-mineru-en.md` 第 107–108 行)。

**Expert Initialization** We initialize the experts in a similar way to upcycling (Komatsuzaki et al., 2023), leveraging the weights of a dense model. In contrast, our approach emphasizes diversification among fine-grained experts to enhance the model’s representational breadth. Given the designated expert intermediate size $h_E$, the number of experts n, and the original FFN intermediate size $h _ { \mathrm { F F N } }$ , the FFN is replicated $\lceil n \times h _ { \mathrm { E } } \big / h _ { \mathrm { F F N } } \rceil$ times. This replication ensures compatibility with the specified number of experts while accommodating any arbitrary expert intermediate size. To promote diversity within each FFN copy, parameters are shuffled along the intermediate dimension. This guarantees that each fine-grained expert exhibits unique characteristics, even across different FFN copies. Subsequently, these experts are extracted from the FFN copies, and the remaining dimensions are discarded. For each fine-grained expert, 50% of its parameters are randomly reinitialized. This process introduces additional stochasticity into expert initialization, potentially enhancing the model’s capacity for exploration during training.

**专家初始化** 我们采用类似于 upcycling(Komatsuzaki et al., 2023)的方式初始化专家，即利用稠密模型的权重。与之不同的是，我们的方法强调细粒度专家之间的多样化，以增强模型的表征广度。给定指定的专家中间层尺寸 $h_E$、专家数量 n 以及原始 FFN 中间层尺寸 $h _ { \mathrm { F F N } }$，FFN 将被复制 $\lceil n \times h _ { \mathrm { E } } \big / h _ { \mathrm { F F N } } \rceil$ 次。这种复制确保了与指定专家数量的兼容性，同时可容纳任意专家中间层尺寸。为促进每个 FFN 副本内部的多样性，参数沿中间维度进行 shuffle。这保证了每个细粒度专家都具有独特特征，即使在不同 FFN 副本之间也是如此。随后，这些专家从 FFN 副本中提取出来，剩余维度被丢弃。对于每个细粒度专家，其 50% 的参数被随机重新初始化。该过程为专家初始化引入了额外的随机性，可能增强模型在训练过程中的探索能力。

> **【译者注 · MoE 设计动机与工程创新】**
> Qwen2 的 MoE 方案在专家粒度上选择了"细粒度 + 多激活"路线(64 个路由专家中激活 8 个，外加 8 个共享专家)，与 Mixtral 的"粗粒度 + 少激活"(8 选 2)形成鲜明对比。细粒度设计在总参数量和激活参数量相同的约束下，理论上提供了更丰富的专家组合空间，但这也对路由学习的稳定性提出了更高要求。此外，初始化策略中的"shuffle + 50% 重初始化"是一种兼顾知识继承与探索空间的工程折中：利用稠密模型权重避免冷启动，又通过随机性打破专家同质化。值得关注的是，MoE 模型仅预训练 4.5T token(见表 1)，远低于稠密模型的 7T，这符合 upcycling 的低成本转换原则，但也意味着 MoE 的上限可能受限于基础稠密模型的质量。

#### 2.2.3 MODEL CONFIGURATION

In the following, we provide the key configuration and information for the Qwen2 series.

下文提供 Qwen2 系列的关键配置信息。

The Qwen2 series consists of models of 5 sizes, which are Qwen2-0.5B, Qwen2-1.5B, Qwen2-7B, Qwen2-57B-A14B, and Qwen2-72B. Table 1 lists the hyper-parameters and important information, e.g., the number of pre-trained tokens. Particularly, Qwen2-57B-A14B is upscaled from Qwen2-7B. Notably, Qwen2 models demonstrate a substantially lower Key-Value (KV) size per token relative to Qwen1.5 models. This characteristic translates into a reduced memory footprint, particularly advantageous in long-context inference tasks.

Qwen2 系列包含 5 种尺寸的模型：Qwen2-0.5B、Qwen2-1.5B、Qwen2-7B、Qwen2-57B-A14B 和 Qwen2-72B。表 1 列出了各模型的超参数及重要信息，例如预训练 token 数量。特别地，Qwen2-57B-A14B 是由 Qwen2-7B 扩展而来。值得注意的是，与 Qwen1.5 模型相比，Qwen2 模型的每 token Key-Value(KV)尺寸显著降低。这一特性转化为更小的内存占用，在长上下文推理任务中尤为有利。

> **【译者注 · 模型配置与尺寸规划】**
> Qwen2 的 5 级尺寸矩阵覆盖了从端侧(0.5B/1.5B)到数据中心级(72B)的全场景部署需求，其中 0.5B 模型甚至预训练了 12T token(超过其自身 7T 的"标准"配置)，暗示团队对端侧小模型做了额外的数据质量实验。KV 尺寸的缩减主要得益于 GQA 的引入(0.5B 用 2 个 KV 头，72B 用 8 个)，这直接降低了长文本生成时的显存峰值，对生产环境中的高并发服务至关重要。MoE 模型基于 7B 稠密模型 upcycle 而来，也解释了为何其隐藏层维度、层数与 7B 保持一致。

## 3 PRE-TRAINING

In the pre-training of Qwen2, our efforts were focused on refining the dataset and investigating methods to handle extended context lengths effectively.

在 Qwen2 的预训练阶段，我们的工作重点在于优化数据集，并研究如何有效处理更长的上下文长度。

### 3.1 PRE-TRAINING DATA

The pre-training of the Qwen2 models involves the development of a new, large-scale, high-quality multilingual dataset. This dataset represents an improvement over the corpora used in previous Qwen and Qwen1.5 models (Bai et al., 2023a; Qwen Team, 2024a), enhancing the scale, quality, and diversity of the pre-training data in several key areas:

Qwen2 模型的预训练基于一个全新构建的大规模、高质量多语言数据集。相较于此前 Qwen 和 Qwen1.5 所使用的语料(Bai et al., 2023a; Qwen Team, 2024a)，该数据集在以下几个关键维度上实现了提升：

Quality Enhancement The filtering algorithm has been refined with additional heuristic and modelbased methods, including the use of the Qwen models to filter out low-quality data. Moreover, these models are utilized to synthesize high-quality pre-training data.

**质量增强** 过滤算法通过引入额外的启发式规则和基于模型的方法进行了优化，包括使用 Qwen 模型来过滤低质量数据。此外，这些模型还被用于合成高质量的预训练数据。

Data Expansion Compared to Qwen1.5 (Qwen Team, 2024a), we have collected a significantly larger volume of high-quality code, mathematics, and multilingual data, enhancing the model's capabilities in respective areas. This new dataset supports approximately 30 languages, such as English, Chinese, Spanish, French, German, Arabic, Russian, Korean, Japanese, Thai, and Vietnamese.

**数据扩充** 与 Qwen1.5(Qwen Team, 2024a)相比，我们收集了大量高质量的代码、数学和多语言数据，显著增强了模型在相应领域的能力。新数据集支持约 30 种语言，包括英语、中文、西班牙语、法语、德语、阿拉伯语、俄语、韩语、日语、泰语和越南语等。

Distribution Improvement To ensure the model learns the distribution akin to human-like learning, we conduct experiments on scaled-down models to optimize the mixing of data from various sources and domains.

**分布优化** 为了确保模型学习到的分布更接近人类的学习方式，我们在缩小规模的模型上进行实验，以优化来自不同来源和领域的数据混合比例。

Based on these enhancements, the pre-training data was expanded from 3 trillion tokens in Qwen1.5 (Qwen Team, 2024a) to 7 trillion tokens. An attempt to further relax the quality threshold resulted in a 12 trillion token dataset. However, the model trained on this dataset did not show a significant performance improvement over the 7 trillion token model. It is suspected that increasing the volume of data does not necessarily benefit model pre-training. Considering training costs, we opted to use the higher-quality 7 trillion token dataset for training larger models, leaving further exploration for future model iterations.

基于上述改进，预训练数据规模从 Qwen1.5 的 3 万亿 token(Qwen Team, 2024a)扩展到了 7 万亿 token。我们进一步尝试放宽质量阈值，得到了一个 12 万亿 token 的数据集。然而，在该数据集上训练的模型相比 7 万亿 token 模型并未表现出显著的性能提升。这暗示单纯增加数据量未必对预训练有益。综合考虑训练成本，我们选择使用更高质量的 7 万亿 token 数据集来训练更大的模型，将进一步的探索留给后续迭代。

All Qwen2 dense models, excluding Qwen2-0.5B, were pre-trained on this large-scale dataset of over 7 trillion tokens. Qwen2-0.5B were pre-trained using the 12 trillion token dataset. The MoE model received an additional 4.5 trillion tokens of pre-training, in line with the principle of upcycling. Similar to previous Qwen models, high-quality multi-task instruction data is integrated into the Qwen2 pre-training process to enhance in-context learning and instruction-following abilities.

除 Qwen2-0.5B 外，所有 Qwen2 dense 模型均在该超过 7 万亿 token 的大规模数据集上进行了预训练。Qwen2-0.5B 则使用了 12 万亿 token 的数据集进行预训练。MoE 模型额外接受了 4.5 万亿 token 的预训练，遵循 upcycling 原则。与之前的 Qwen 模型类似，高质量的多任务指令数据也被整合进 Qwen2 的预训练过程中，以增强上下文学习和指令遵循能力。

> **【译者注 · 预训练数据的质量-规模权衡】**
> Qwen2 团队在数据扩展上做了明确的对比实验：3T → 7T 带来显著提升，但 7T → 12T(低质)却收效甚微。这一发现与同期其他实验室(如 Llama 3 选择 15T 高质量数据)的观点形成有趣的对照，暗示不同架构和训练配方对数据边际收益的敏感度存在差异。0.5B 小模型使用 12T 而非 7T 的细节也值得关注——可能团队认为小模型需要更多 token 才能充分收敛，或者小模型的训练成本足够低，值得用规模换质量。MoE 模型额外预训练 4.5T 的做法符合 upcycling 的低成本转换逻辑，但也意味着其预训练总量(从 7B base 转换后再训)可能仍低于直接从零训练的 MoE 模型，这在一定程度上解释了后文提到的 MoE 在知识理解上的短板。

### 3.2 LONG-CONTEXT TRAINING

To enhance the long-context capability of Qwen2, we augmented the context length from 4,096 tokens to 32,768 tokens during the concluding phase of pre-training. This expansion was complemented by the introduction of a significantly increased volume of high-quality, lengthy data. In conjunction with these enhancements, we modified the base frequency of RoPE from 10,000 to 1,000,000 to optimize performance in long-context scenarios (Xiong et al., 2023).

为了增强 Qwen2 的长上下文能力，我们在预训练的最后阶段将上下文长度从 4,096 token 扩展到了 32,768 token。这一扩展伴随着大量高质量长文本数据的引入。与此同时，我们将 RoPE 的基频从 10,000 调整到了 1,000,000，以优化长上下文场景下的性能(Xiong et al., 2023)。

> **【译者注 · RoPE 基频调整与长上下文外推】**
> RoPE 基频(base frequency)从 10,000 提升到 1,000,000 是一个常被忽视但极其关键的工程细节。低基频下，位置编码在远距离 token 上的区分度会迅速衰减，导致模型难以分辨长程依赖。基频提升后，旋转角度的变化更加平缓，有效缓解了长程位置混淆。这一做法在 Qwen2 中被验证有效，并配合 YARN(通过调整注意力温度系数适配扩展位置编码)和 DCA(Dual Chunk Attention，分块处理降低 KV cache 压力)机制，实现了从 32K 训练到 128K+ 外推的跨越。三者的组合体现了"预训练调基频 + 推理时加外推机制"的分层工程思路。

To fully leverage the model's length extrapolation potential, we adopted the YARN mechanism (Peng et al., 2023) and the Dual Chunk Attention mechanism (An et al., 2024). These strategies enable the model to process sequences of up to 131,072 tokens while maintaining high performance, as evidenced by minimal perplexity degradation in preliminary experiments.

为了充分利用模型的长度外推潜力，我们采用了 YARN 机制(Peng et al., 2023)和双块注意力机制(Dual Chunk Attention, An et al., 2024)。这些策略使模型能够处理长达 131,072 token 的序列，同时保持高性能——初步实验中困惑度(perplexity)的衰减极小。

## 4 POST-TRAINING

Following extensive large-scale pre-training, we engage in a post-training phase for Qwen2. This process is pivotal in enhancing its proficiency across a broad spectrum of domains, including coding, mathematics, logical reasoning, instruction following, and multilingual comprehension. Moreover, it ensures that the generation from the models is in harmony with human values, making it helpful, honest, and harmless. Unlike traditional methods that heavily rely on extensive human supervision, our approach focuses on scalable alignment with minimal human annotation (Cao et al., 2024). Specifically, we investigate methods to acquire high-quality demonstration and preference data for Supervised Fine-Tuning (SFT) and Reinforcement Learning from Human Feedback (RLHF), aiming to minimize the need for human labeling while maximizing the quality and reliability of the data.

在大规模预训练之后，我们对 Qwen2 进行后训练(post-training)。这一过程对于提升模型在代码、数学、逻辑推理、指令遵循和多语言理解等多个领域的熟练度至关重要。此外，它还确保模型的生成与人类价值观保持一致，使其具备 helpful(有用)、honest(诚实)和 harmless(无害)的特性。与传统严重依赖大量人工监督的方法不同，我们的方法聚焦于可扩展的对齐(scalable alignment)，以最少的人工标注实现目标(Cao et al., 2024)。具体而言，我们研究如何为监督微调(SFT)和基于人类反馈的强化学习(RLHF)获取高质量的演示数据和偏好数据，旨在最小化人工标注需求的同时，最大化数据的质量和可靠性。

> **【译者注 · 后训练的"可扩展对齐"理念】**
> Qwen2 后训练的核心理念是"scalable alignment"——用自动化手段替代昂贵的人工标注。这一思路与 Anthropic 的 Constitutional AI、Google 的 Self-Instruct 等方向一脉相承，但 Qwen2 的独特之处在于将拒绝采样、执行反馈、数据再利用、宪法反馈四种策略系统性地整合到统一流水线中。特别值得关注的是 Online Merging Optimizer 的引入，它试图缓解 RLHF 中著名的"alignment tax"(对齐税)问题，即模型在对齐人类偏好后在通用能力上出现下降。从后续评测结果看，Qwen2-72B-Instruct 在 Arena-Hard 和 AlignBench 等偏好基准上的大幅领先，证明了这一整套后训练方案的有效性。

### 4.1 POST-TRAINING DATA

The post-training data primarily consists of two components: demonstration data $\mathcal { D } = \{ ( x _ { i } , y _ { i } ) \}$ and preference data $\mathcal { P } = \{ ( x _ { i } , y _ { i } ^ { + } , y _ { i } ^ { - } ) \}$ }, where $x _ { i }$ represents the instruction, $y _ { i }$ represents a satisfactory response, and $y _ { i } ^ { + }$ and $y _ { i } ^ { - }$ are two responses to $x _ { i } ,$ , with $y _ { i } ^ { + }$ being the preferred choice over $y _ { i } ^ { - }$ . T he set D is utilized in SFT, whereas $\mathcal { P }$ is employed in RLHF.

后训练数据主要由两部分组成：演示数据(demonstration data)$\mathcal { D } = \{ ( x _ { i } , y _ { i } ) \}$ 和偏好数据(preference data)$\mathcal { P } = \{ ( x _ { i } , y _ { i } ^ { + } , y _ { i } ^ { - } ) \}$，其中 $x _ { i }$ 表示指令，$y _ { i }$ 表示一个令人满意的回复，而 $y _ { i } ^ { + }$ 和 $y _ { i } ^ { - }$ 是针对同一指令 $x _ { i }$ 的两个回复，且 $y _ { i } ^ { + }$ 优于 $y _ { i } ^ { - }$。集合 $\mathcal{D}$ 用于 SFT，而 $\mathcal{P}$ 用于 RLHF。

The construction of training data entails a two-step process: collaborative data annotation and automated data synthesis. First, we extract the data ontology from large-scale instruction corpora, leading to a broad and diverse set of high-quality instructions. These instructions are systematically enhanced to incorporate greater complexity. Through human annotation, we obtain the target response $y _ { i }$ and their positive and negative counterparts $\bar { ( } y _ { i } ^ { + } , y _ { i } ^ { - } )$ . Subsequently, a variety of automated alignment strategies are employed to synthesize a substantial volume of artificially annotated data across the domains of code, mathematics, instruction-following, creation, role-playing, and safety.

训练数据的构建包含两个步骤：协作数据标注和自动化数据合成。首先，我们从大规模指令语料库中提取数据本体(ontology)，得到一个广泛且多样化的高质量指令集合。这些指令被系统地增强以增加复杂度。通过人工标注，我们获得目标回复 $y _ { i }$ 及其正负样本对 $\bar { ( } y _ { i } ^ { + } , y _ { i } ^ { - } )$。随后，我们采用多种自动化对齐策略，在代码、数学、指令遵循、创作、角色扮演和安全等领域合成大量人工标注数据。

#### 4.1.1 COLLABORATIVE DATA ANNOTATION

Automatic Ontology Extraction The process initiates with the application of InsTag (Lu et al., 2024c), an open-set fine-grained tagger, to extract the underlying ontology from a large-scale instruction dataset. Subsequent manual refinement ensures the accuracy of the extracted ontology.

**自动本体提取** 该过程首先使用 InsTag(Lu et al., 2024c)——一个开放集的细粒度标签器——从大规模指令数据集中提取潜在的本体结构。随后通过人工精修确保提取结果准确。

Instruction Selection Each instruction, with tags annotated, is evaluated for tag diversity, semantic richness, complexity, and intent completeness. Based on these criteria, we select a set of representative instructions (Dong et al., 2023).

**指令筛选** 每条带有标签的指令都会从标签多样性、语义丰富度、复杂度和意图完整性等维度进行评估。基于这些标准，我们筛选出一组具有代表性的指令(Dong et al., 2023)。

Instruction Evolution To enrich the instruction dataset, a self-evolution strategy (Zhao et al., 2024) is employed, prompting the Qwen models to add constraints or requirements to existing instructions, thereby increasing their complexity and ensuring a diverse range of difficulty levels within the dataset.

**指令演化** 为了丰富指令数据集，我们采用自演化策略(Zhao et al., 2024)，通过提示 Qwen 模型为现有指令添加约束或要求，从而提升复杂度并确保数据集中难度分布的多样性。

Human Annotation Multiple responses to an instruction are obtained using diverse generation strategies and Qwen models of different scales. Annotators rank these responses based on their preferences, ensuring the best response meets established criteria, yielding both demonstration and preference data.

**人工标注** 通过多种生成策略和不同规模的 Qwen 模型获取同一指令的多个回复。标注者根据个人偏好对这些回复进行排序，确保最优回复满足既定标准，从而同时生成演示数据和偏好数据。

> **【译者注 · 协作数据标注的"人机协同"设计】**
> 协作数据标注流程体现了"机器规模化 + 人类质量把关"的分工理念：InsTag 负责从海量语料中自动提取本体结构，人类负责精修; 多模型生成回复后由人类排序偏好。InsTag 的引入是一个值得关注的工程选择——通过细粒度标签体系，团队可以系统性地控制数据分布，避免某些能力维度被过度或不足代表。这一做法相比早期的 Alpaca 和 Self-Instruct 等纯自动生成方法，在数据质量控制上有了质的飞跃。"指令演化"策略与后来的 Evol-Instruct、WizardLM 等"复杂性驱动"数据合成思路属于同一技术谱系，核心洞察是：让模型在更难的任务上训练，能激发更强的泛化能力。

#### 4.1.2 AUTOMATED DATA SYNTHESIS

Maintaining the quality of annotations for responses to instructions presents significant challenges on a large scale, particularly those that require expertise, experience, carefulness, or patience. To address these challenges, we devised various automated alignment strategies to synthesize data at scale.

在大规模场景下，维持指令回复的标注质量面临重大挑战，尤其是那些需要专业知识、经验、细心或耐心的任务。为应对这些挑战，我们设计了多种自动化对齐策略来实现大规模数据合成。

Rejection Sampling For mathematical or similar tasks with definitive final answers, rejection sampling (Yuan et al., 2023) is applied to improve the quality of solutions. Large language models (LLMs) are tasked to generate multiple responses, namely the reasoning paths, for each instruction. Paths that result in accurate conclusions and are considered reasonable by the model are preserved, serving as demonstration data. Preference data is generated by contrasting correct and incorrect paths.

**拒绝采样** 对于数学或类似具有确定最终答案的任务，我们采用拒绝采样(Yuan et al., 2023)来提升解答质量。大语言模型(LLM)被指派为每条指令生成多个回复(即推理路径)。那些得出准确结论且被模型自身判定为合理的路径被保留下来，作为演示数据。偏好数据则通过对比正确与错误路径生成。

Execution Feedback For coding tasks, LLMs are employed to generate solutions and associated test cases. The efficacy of these solutions is evaluated by compiling and executing them against the test cases, thereby creating demonstration and preference data. This methodology is also applicable to assessing instruction following (Dong et al., 2024). For each instruction with constraints, e.g., length limit, the LLM is tasked to generate a Python verification function to ensure the response aligns with the instruction requirements.

**执行反馈** 对于代码任务，LLM 被用于生成解决方案及相应的测试用例。通过编译并执行这些方案来验证其有效性，从而创建演示数据和偏好数据。这一方法同样适用于评估指令遵循能力(Dong et al., 2024)。对于带有约束条件(如长度限制)的指令，LLM 被指派生成 Python 验证函数，以确保回复符合指令要求。

Data Repurposing Creating skilled responses in literary writing tasks is challenging for annotators without specialized training. To tackle this problem, we aggregate high-quality literary works from the public domain and employ LLMs to develop instructions with varying levels of detail. These instructions, paired with the original works, serve as demonstration data. For example, to compile roleplay data with vivid and engaging responses, we source detailed character profiles from knowledge repositories such as Wikipedia and instruct LLMs to generate corresponding instructions and responses (Lu et al., 2024b). This process, similar to a reading comprehension task, ensures that the integrity of the character's profile is maintained.

**数据再利用** 对于文学写作任务，未经专业训练的标注者难以产出高质量的回复。为解决这一问题，我们聚合公共领域的高质量文学作品，并利用 LLM 开发不同详细程度的指令。这些指令与原文配对后作为演示数据。例如，为了构建包含生动有趣回复的角色扮演数据，我们从 Wikipedia 等知识库获取详细的角色档案，并指示 LLM 生成相应的指令和回复(Lu et al., 2024b)。这一过程类似于阅读理解任务，确保角色档案的完整性得以保持。

Constitutional Feedback Constitutional AI refers to the process of guiding LLMs to generate responses based on predefined sets of principles (Bai et al., 2022). To ensure adherence to guidelines such as safety and values, a constitution dataset was compiled. This dataset delineates principles to be followed and those to be avoided. It was used to instruct LLMs to produce responses that either are aligned with or deviated from these guidelines, serving as a reference for demonstration and preference data.

**宪法反馈** 宪法人工智能(Constitutional AI)是指基于预定义的原则集合来引导 LLM 生成回复的过程(Bai et al., 2022)。为了确保模型遵守安全和价值观等准则，我们编制了一个"宪法"数据集。该数据集明确列举了应遵循的原则和应避免的原则，并用于指示 LLM 生成符合或偏离这些准则的回复，作为演示数据和偏好数据的参考。

> **【译者注 · 自动化数据合成的四策略矩阵】**
> Qwen2 的四种自动化策略覆盖了不同类型的任务需求：拒绝采样适用于有明确答案的客观任务(数学、逻辑); 执行反馈将代码评估从"文本相似度"提升到"功能性正确性"，这是代码领域的关键突破; 数据再利用巧妙地将已有高质量文本资产转化为训练数据，避免了从零创作的高成本; 宪法反馈则是对齐模型价值观的系统性方法。这四种策略与同期 DeepSeek、LLaMA 等模型的后训练方案在理念上趋同，但 Qwen2 的独特之处在于将它们整合到统一流水线中，并特别强调了"可扩展性"——即随着模型能力提升，数据合成流程可以自我增强，形成正反馈循环。

### 4.2 SUPERVISED FINE-TUNING

We have assembled an extensive instruction dataset featuring more than 500,000 examples that cover skills such as instruction following, coding, mathematics, logical reasoning, role-playing, multilingualism, and safety. Our model was fine-tuned for two epochs with a sequence length of 32,768 tokens. To optimize learning, the learning rate was gradually decreased from $7 \times 1 0 ^ { - 6 }$ to $7 \times 1 0 ^ { - 7 }$ . To address overfitting, we applied a weight decay of 0.1 and gradients were clipped at a maximum value of 1.0.

我们构建了一个包含超过 50 万条样本的大规模指令数据集，涵盖指令遵循、代码、数学、逻辑推理、角色扮演、多语言和安全等技能。模型在序列长度为 32,768 token 的条件下微调了 2 个 epoch。为了优化学习效果，学习率从 $7 \times 10^{-6}$ 逐步降低至 $7 \times 10^{-7}$。为应对过拟合，我们采用了 0.1 的权重衰减(weight decay)，并将梯度裁剪(gradient clipping)的最大值设为 1.0。

> **【译者注 · SFT 超参数的工程含义】**
> 50 万条样本的规模在当时的开源模型中属于中等偏上(对比 Llama 2 的数万条和后来 Llama 3 的千万级)，说明 Qwen2 更依赖数据质量而非数量。学习率从 $7\times10^{-6}$ 降到 $7\times10^{-7}$ 恰好是一个数量级的衰减，这是 Cosine 退火或线性退火的典型配置。序列长度 32,768 与预训练最后阶段的长上下文扩展保持一致，确保 SFT 不会"遗忘"长上下文能力。权重衰减 0.1 和梯度裁剪 1.0 都是相对保守的正则化设置，暗示团队对过拟合风险有充分认识。2 个 epoch 的设置也表明团队倾向于"早停"策略，避免在相对较小的指令数据集上过度训练。

### 4.3 REINFORCEMENT LEARNING FROM HUMAN FEEDBACK

Our training regime for RLHF comprises two sequential stages: offline and online training. In the offline training stage, we use a pre-compiled preference dataset $\mathcal { P }$ to maximize the difference in likelihood between $y _ { i } ^ { + }$ and $\boldsymbol y _ { i } ^ { - }$ with Direct Preference Optimization (DPO, Rafailov et al., 2023). In the online training stage, the model iteratively refines its performance in real-time, leveraging reward models for immediate feedback. Specifically, we sample multiple responses from the current policy model, and the reward model selects the most and the least preferred responses, forming preference pairs that are used for DPO in each episode. Moreover, we employ Online Merging Optimizer (Lu et al., 2024a) to mitigate the alignment tax, i.e., the performance degradation associated with aligning model generation with human preferences.

我们的 RLHF 训练包含两个顺序阶段：离线训练和在线训练。在离线训练阶段，我们使用预先编译的偏好数据集 $\mathcal{P}$，通过直接偏好优化(Direct Preference Optimization, DPO, Rafailov et al., 2023)来最大化 $y _ { i } ^ { + }$ 和 $y _ { i } ^ { - }$ 之间的似然差异。在在线训练阶段，模型利用奖励模型提供的即时反馈实时迭代优化自身性能。具体而言，我们从当前策略模型中采样多个回复，奖励模型从中选出最受偏好和最不受偏好的回复，构成偏好对用于每个 episode 的 DPO 训练。此外，我们采用在线合并优化器(Online Merging Optimizer, Lu et al., 2024a)来缓解对齐税(alignment tax)，即模型生成内容与人类偏好对齐时伴随的性能下降。

> **【译者注 · 从 PPO 到 DPO 再到在线 DPO 的技术演进】**
> Qwen2 在 RLHF 阶段全面采用 DPO 而非传统 PPO，这是 2023–2024 年间开源社区的重要趋势。DPO 无需显式训练奖励模型，将偏好优化转化为分类问题，大幅降低了训练复杂度和内存开销。但 Qwen2 并未停留在离线 DPO，而是进一步引入了在线 DPO：让模型持续生成新回复，由奖励模型实时筛选偏好对，形成"自我对抗"式的迭代优化。Online Merging Optimizer 通过对齐前后模型参数的加权融合来保留通用能力，这一思路与后来的 Model Merging 和 Model Averaging 技术属于同一谱系。从结果看，这种"离线热身 + 在线精修"的两阶段策略在 Arena-Hard 和 AlignBench 等偏好基准上取得了显著成功。

---

> **全文完**。本文基于 Qwen2 官方技术报告(26 页 PDF)的 MinerU 英文原文进行逐段中英对照翻译。

## 5 EVALUATION

To thoroughly assess the Qwen2 models, consisting of both base and instruction-tuned models, we implement a comprehensive evaluation protocol. This protocol examines a range of competencies, including general knowledge understanding, language comprehension, generation, coding, mathematics, reasoning, and additional areas of expertise. Specifically, base models are assessed using established benchmark datasets for large language models (LLMs), with responses elicited through few-shot prompting, unless specified otherwise. For instruction-tuned models, in addition to benchmark evaluations, we prioritize human preference assessments.

为了全面评估 Qwen2 模型(包括基座模型和指令微调模型)，我们实施了一套综合评估协议。该协议考察了广泛的能力领域，包括通用知识理解、语言理解、生成、代码、数学、推理以及其他专业能力。具体而言，基座模型通过大语言模型(LLM)标准基准数据集进行评估，除非另有说明，否则均采用 few-shot prompting 方式获取回复。对于指令微调模型，除基准评测外，我们优先关注人类偏好评估。

> **【译者注 · Qwen2 评估体系的全面性】**
> Qwen2 的评估协议覆盖了当时几乎所有主流基准(MMLU、HumanEval、GSM8K 等)，并特别强调了多语言能力和安全性评估——这反映了通义千问作为阿里系模型的核心优势(中文/东南亚语言覆盖)。"基座模型用 few-shot，指令模型加偏好评估"的分层评估策略已成为行业共识，但 Qwen2 额外增加了 Needle in a Haystack、NeedleBench 等长上下文专项测试，以及多语言人工评测，这些在同期开源模型报告中并不常见。

### 5.1 BASE LANGUAGE MODELS

In this section, we illustrate the evaluation of the base language models of the Qwen2 series. Specifically, we evaluate the models on benchmark datasets for knowledge and basic capabilities and apply multilingual benchmark datasets to evaluate their support of languages. As there are multiple model sizes, we compare them with the state-of-the-art (SOTA) models of similar or larger sizes.

在本节中，我们展示 Qwen2 系列基座语言模型的评估结果。具体而言，我们在知识和基础能力的基准数据集上评估模型，并应用多语言基准数据集来评估其对各语言的支持程度。由于存在多个模型尺寸，我们将它们与相近或更大尺寸的当前最优(SOTA)模型进行比较。

#### 5.1.1 CORE CAPABILITIES

Benchmarks and Evaluation Protocol The common practice of evaluating the core capabilities of base language models is the implementation of benchmark dataset evaluation with few-shot or zero-shot prompting. The evaluation mainly focuses on the model performance of natural language understanding, general question answering, coding, mathematics, scientific knowledge, reasoning, etc. The datasets for evaluation include MMLU (Hendrycks et al., 2021a) (5-shot), MMLU-Pro (Wang et al., 2024) (5-shot), GPQA (Rein et al., 2023) (5shot), Theorem QA (Chen et al., 2023a) (5-shot), BBH (Suzgun et al., 2023) (3-shot), HellaSwag (Zellers et al., 2019) (10-shot), Winogrande (Sakaguchi et al., 2021) (5-shot), TruthfulQA (Lin et al., 2022a) (0-shot), ARC-C (Clark et al., 2018) (25-shot), HumanEval (Chen et al., 2021) (0-shot), MBPP (Austin et al., 2021) (0-shot), EvalPlus(Liu et al., 2023a) (0-shot), MultiPL-E (Cassano et al., 2023) (0-shot on Python, C++, Java, PHP, Type-Script, C#, Bash, and JavaScript), GSM8K (Cobbe et al., 2021) (5-shot), MATH (Hendrycks et al., 2021b) (4-shot), C-Eval (Huang et al., 2023) (5-shot), and CMMLU (Li et al., 2023) (5-shot). Multilingual datasets can be grouped into four categories: (a) Exam: M3Exam (5-shot, we only choose examples that require no image), IndoMMLU (Koto et al., 2023) (3-shot), ruMMLU (Fenogenova et al., 2024) (5-shot), and translated MMLU (Chen et al., 2023b) (5-shot on Arabic, Spanish, French, Portuguese, German, Italian, Japanese, and Korean); (b) Understanding: BELEBELE (Bandarkar et al., 2023) (5-shot), XCOPA (Ponti et al., 2020) (5-shot), XWinograd (Muennighoff et al., 2023) (5-shot), XStoryCloze (Lin et al., 2022b) (0-shot) and PAWS-X (Yang et al., 2019) (5-shot); (c) Mathematics: MGSM (Goyal et al., 2022) (8-shot CoT); and (d) Translation: Flores-101 (Goyal et al., 2022) (5-shot).

**基准与评估协议** 评估基座模型核心能力的常规做法是通过 few-shot 或 zero-shot prompting 进行基准数据集评测。评估主要关注模型在自然语言理解、通用问答、代码、数学、科学知识、推理等方面的表现。所使用的数据集包括：MMLU(5-shot)、MMLU-Pro(5-shot)、GPQA(5-shot)、Theorem QA(5-shot)、BBH(3-shot)、HellaSwag(10-shot)、Winogrande(5-shot)、TruthfulQA(0-shot)、ARC-C(25-shot)、HumanEval(0-shot)、MBPP(0-shot)、EvalPlus(0-shot)、MultiPL-E(0-shot，覆盖 Python、C++、Java、PHP、TypeScript、C#、Bash、JavaScript)、GSM8K(5-shot)、MATH(4-shot)、C-Eval(5-shot)、CMMLU(5-shot)。多语言数据集分为四类：(a) 考试类：M3Exam(5-shot，仅选无需图像的样例)、IndoMMLU(3-shot)、ruMMLU(5-shot)及翻译版 MMLU(5-shot，覆盖阿拉伯语、西班牙语、法语、葡萄牙语、德语、意大利语、日语、韩语); (b) 理解类：BELEBELE(5-shot)、XCOPA(5-shot)、XWinograd(5-shot)、XStoryCloze(0-shot)、PAWS-X(5-shot); (c) 数学类：MGSM(8-shot CoT); (d) 翻译类：Flores-101(5-shot)。

> **【译者注 · 基准选择背后的考量】**
> Qwen2 的基准选择非常全面，涵盖了从基础语言理解(MMLU)、推理(BBH、GPQA)到代码(HumanEval、MBPP、MultiPL-E)、数学(GSM8K、MATH)的完整能力谱系。特别值得注意的是多语言评估被单独成类，包括考试、理解、数学、翻译四个维度，这体现了通义千问"原生多语言"的定位。C-Eval 和 CMMLU 作为中文专属基准被纳入核心评估，而非仅放在"多语言"类别中，也反映了模型对中国市场的高度重视。

Qwen2-72B In terms of the largest model of Qwen2, we compare Qwen2-72B with competitive baseline open-weight models, including Mixtral-8x22B (Jiang et al., 2024), Llama-3-70B (AI@Meta, 2024), as well as Qwen1.5-72B (Qwen Team, 2024a) and Qwen1.5-110B (Qwen Team, 2024b). The results are reported in Table 2. Qwen2-72B outperforms Llama-3-70B in general knowledge understanding on both MMLU and MMLU-Pro, achieving accuracy improvements of 4.7 and 2.8, respectively. In scientific assessments, Qwen2-72B demonstrates superiority over Llama-3-70B with enhancements of 1.6 and 9.8 on GPQA and Theorem QA. Upon enrichment of coding data, Qwen2- 72B exhibits a significant 18.3 and 10.0 percentage point advantage over Qwen1.5-72B in HumanEval and MBPP evaluations. Enhanced mathematics-related data allows Qwen2-72B to outperform Qwen1.5-72B by 10.0 and 17.0 percentage points in the GSM8K and MATH benchmarks. Qwen2- 72B displays reasoning capabilities equivalent to Llama-3-70B, considering BBH, Winogrande, and ARC-C, attributable to its improved coding and mathematical data. In assessing language understanding in Chinese, Qwen2-72B significantly outperforms Mixtral-8x22B and Llama-3-70B, and also outperforms Qwen1.5-72B.

**Qwen2-72B** 就 Qwen2 系列中最大的模型而言，我们将 Qwen2-72B 与具有竞争力的开源基线模型进行比较，包括 Mixtral-8x22B、Llama-3-70B、Qwen1.5-72B 和 Qwen1.5-110B。结果报告于表 2。Qwen2-72B 在通用知识理解方面(MMLU 和 MMLU-Pro)均优于 Llama-3-70B，准确率分别提升了 4.7 和 2.8 个百分点。在科学评估中，Qwen2-72B 在 GPQA 和 Theorem QA 上分别领先 Llama-3-70B 1.6 和 9.8 个百分点。得益于代码数据的增强，Qwen2-72B 在 HumanEval 和 MBPP 上相比 Qwen1.5-72B 分别取得了 18.3 和 10.0 个百分点的显著提升。数学相关数据的增强使 Qwen2-72B 在 GSM8K 和 MATH 基准上分别超越 Qwen1.5-72B 10.0 和 17.0 个百分点。在 BBH、Winogrande 和 ARC-C 等推理任务上，Qwen2-72B 展现出与 Llama-3-70B 相当的能力，这归因于其代码和数学数据的改进。在中文语言理解评估中，Qwen2-72B 显著优于 Mixtral-8x22B 和 Llama-3-70B，同时也优于 Qwen1.5-72B。

> **【译者注 · Qwen2-72B 的跨代提升幅度】**
> 对比 Qwen1.5-72B，Qwen2-72B 在代码(+18.3pp HumanEval)和数学(+17.0pp MATH)上的提升最为惊人，这直接对应了预训练数据中代码和数学数据的大幅扩充。但值得注意的是，在 GSM8K 上 Qwen2-72B 的得分(89.5)甚至超过了 MATH(51.1)，说明模型在小学数学上表现优异但在高等数学上仍有较大差距。与 Llama-3-70B 的对比显示，Qwen2-72B 在知识理解和科学推理上占优，但在 HellaSwag 和 Winogrande 等常识推理上基本持平——这暗示两家的预训练数据分布可能导致了不同的能力偏向。

Qwen2-57B-A14B For the evaluation of the MoE model, Qwen2-57B-A14B is compared against baselines of similar sizes. These baselines include other MoE models, such as Mixtral-8x7B (Jiang et al., 2024) and Jamba (Lieber et al., 2024), and dense models, such as Yi-1.5-34B (Young et al., 2024) and Qwen1.5-32B (Qwen Team, 2024a), both of which have approximately 30 billion parameters. The results are shown in Table 3. We anticipate that Qwen2-57B-A14B, which activates 14 billion parameters, will match the performance of a 30 billion parameter dense equivalent Qwen2 model. Our evaluation reveals that Qwen2-57B-A14B performs comparably to Yi-1.5-34B in natural language understanding tasks. Moreover, it outperforms the baseline models in coding and mathematics tasks. Additionally, Qwen2-57B-A14B demonstrates robust Chinese language understanding capabilities, rivaling the larger Qwen2-72B model. In essence, Qwen2-57B-A14B is an efficient model that, while activating only 14 billion parameters per forward pass, maintains the performance level of a 30 billion parameter dense model.

**Qwen2-57B-A14B** 对于 MoE 模型的评估，我们将 Qwen2-57B-A14B 与相近尺寸的基线模型进行比较。这些基线包括其他 MoE 模型(如 Mixtral-8x7B 和 Jamba)以及稠密模型(如 Yi-1.5-34B 和 Qwen1.5-32B，两者均有约 300 亿参数)。结果见表 3。我们预期激活参数仅 140 亿的 Qwen2-57B-A14B 能够达到 300 亿参数稠密等效 Qwen2 模型的性能水平。评估结果表明，Qwen2-57B-A14B 在自然语言理解任务上与 Yi-1.5-34B 表现相当，在代码和数学任务上优于所有基线模型。此外，Qwen2-57B-A14B 展现出强劲的中文语言理解能力，可与大得多的 Qwen2-72B 模型媲美。本质上，Qwen2-57B-A14B 是一个高效模型：每次前向传播仅激活 140 亿参数，却能维持 300 亿参数稠密模型的性能水平。

> **【译者注 · MoE 的效率-性能权衡验证】**
> Qwen2-57B-A14B 是这篇报告中验证 MoE 架构效率的核心证据：57B 总参数 / 14B 激活参数 ≈ 4:1 的稀疏比，实现了与 30B+ 稠密模型相当的性能。但值得注意的是，在 MMLU-Pro、BBH 等需要深度推理的基准上，MoE 模型仍然落后于 Yi-1.5-34B(48.3 vs 43.0 on MMLU-Pro)，这说明稀疏架构在复杂推理任务上仍有优化空间。报告也坦诚提到 MoE 模型"预训练 token 数量不足"，暗示如果继续扩展预训练，MoE 的 scaling behavior 可能带来更大惊喜——这与 DeepSeek-MoE 的观察一致。

Qwen2-7B The 7B model is widely utilized, as it enables the execution in 16-bit floating points on accelerators equipped with 16GB memory. Our focus is on comparing this model with other leading 7B models, including Llama-3-8B, which has recently demonstrated exceptional performance in the Chatbot Arena (Chiang et al., 2024). This comparison also includes Mistral-7B-v0.2 (Jiang et al., 2023a), Gemma-7B (Mesnard et al., 2024), and our predecessor, Qwen1.5-7B (Qwen Team, 2024a). The results can be found in Table 4. Qwen2-7B demonstrates superior performance across most datasets compared to other models, particularly excelling in coding tasks, mathematics, and Chinese language tasks. It also shows strong performance in multilingual understanding and exams. This indicates that Qwen2-7B has been optimized for a wide range of language and logic-based tasks, showcasing its versatility and advanced capabilities.

**Qwen2-7B** 7B 模型因其可在配备 16GB 显存的加速器上以 16 位浮点数运行而被广泛使用。我们重点将其与其他领先 7B 模型进行比较，包括在 Chatbot Arena 中近期表现出色的 Llama-3-8B，以及 Mistral-7B-v0.2、Gemma-7B 和我们的前代模型 Qwen1.5-7B。结果见表 4。Qwen2-7B 在大多数数据集上均展现出优于其他模型的性能，尤其在代码任务、数学和中文任务上表现突出。它在多语言理解和考试类任务上也表现强劲。这表明 Qwen2-7B 已针对广泛的语言和逻辑任务进行了优化，展现出其多功能性和先进能力。

> **【译者注 · 7B 模型的竞争格局】**
> 7B-8B 尺寸是当前开源社区最活跃的竞技场。Qwen2-7B 在 MMLU(70.3)上大幅领先 Llama-3-8B(66.6)和 Mistral-7B(64.2)，在 HumanEval(51.2)上也明显优于 Mistral(29.3)和 Llama-3(33.5)，但在 HellaSwag 和 Winogrande 上却落后于 Mistral——这暗示 Qwen2 的训练数据更偏重知识和代码，而 Mistral 更偏重常识。最引人注目的是 MATH 基准：Qwen2-7B(44.2)几乎是 Llama-3-8B(20.5)的两倍，这说明 Qwen2 在数学数据上的投入产生了显著回报。

Qwen2-1.5B & Qwen2-0.5B To evaluate the performance of our smaller models, specifically Qwen2-1.5B and Qwen2-0.5B, we compare them against established baselines: Phi-2 (Abdin et al., 2024), Gemma-2B (Mesnard et al., 2024), and Qwen1.5-1.8B (Qwen Team, 2024a). The results are given in Table 5. In language understanding, Qwen2-1.5B outperforms Phi-2, a model trained on textbook-like data. For coding tasks, Qwen2-0.5B matches the performance of Gemma-2B and Qwen1.5-1.8B, while Qwen2-1.5B surpasses these baselines, except for Phi-2. Both Qwen2 models exhibit superior performance in mathematics compared to their competitors. In terms of general reasoning, we find that Phi-2 generally outperforms all others, which to some extent reflects the significance of textbook data for reasoning capabilities. In TruthfulQA, Qwen2-1.5B performs the best, demonstrating that smaller models does not necessarily suffer from hallucination. In Chinese language understanding, both Qwen2 models outperform all the others, a trend consistent with larger models in their respective comparisons.

In general, the Qwen2 series demonstrates superior performance against the baselines across different model sizes. Notably, Qwen2-72B exhibits the highest performance among all Qwen2 models, underscoring the efficacy of model size scaling.

**Qwen2-1.5B 与 Qwen2-0.5B** 为了评估小模型的性能，我们将 Qwen2-1.5B 和 Qwen2-0.5B 与已建立的基线进行比较：Phi-2(使用教科书式数据训练的模型)、Gemma-2B 和 Qwen1.5-1.8B。结果见表 5。在语言理解方面，Qwen2-1.5B 优于 Phi-2。在代码任务上，Qwen2-0.5B 与 Gemma-2B 和 Qwen1.5-1.8B 表现相当，而 Qwen2-1.5B 则超越这些基线(除 Phi-2 外)。两款 Qwen2 模型在数学方面均优于竞争对手。在通用推理方面，Phi-2 总体上表现最佳，这在一定程度上反映了教科书式数据对推理能力的重要性。在 TruthfulQA 上，Qwen2-1.5B 表现最佳，表明较小的模型未必存在幻觉问题。在中文语言理解方面，两款 Qwen2 模型均优于其他所有模型，这一趋势与更大尺寸模型的对比结果一致。

总体而言，Qwen2 系列在不同尺寸的模型上均展现出优于基线的性能。尤其值得注意的是，Qwen2-72B 在所有 Qwen2 模型中表现最佳，凸显了模型尺寸扩展的有效性。

> **【译者注 · 小模型的惊喜：数据质量 vs 数据规模】**
> Qwen2-0.5B(仅 3 亿非嵌入参数)在 MMLU(45.4)上接近 Gemma-2B(42.3)，在中文 C-Eval(58.2)和 CMMLU(55.1)上更是大幅领先。这说明即使在亚十亿参数级别，高质量的多语言预训练数据仍能产生显著优势。Phi-2 凭借"教科书式数据"在推理任务上的强势表现(BBH 43.4)提醒我们：数据质量(尤其是结构化、教育级内容)可能比数据数量更重要。Qwen2-1.5B 在 TruthfulQA 上的最佳表现也打破了"小模型更容易幻觉"的刻板印象。

### 5.2 INSTRUCTION-TUNED MODEL

To critically evaluate instruction-tuned models, we implement a multifaceted approach. Assessments of foundational skills and human preferences are conducted using open datasets and benchmarks. Our detailed in-house examinations further probe model competencies in key areas. A particular focus is placed on assessing long context capability. Safety measures include multilingual safety assessments and red teaming exercises. The following sections detail the evaluation methods and their outcomes.

为了严格评估指令微调模型，我们实施了多维度评估方法。使用公开数据集和基准对基础技能和人类偏好进行评估。我们的详细内部评测进一步探查模型在关键领域的能力。特别注重评估长上下文能力。安全措施包括多语言安全评估和红队测试。以下各节详述评估方法及其结果。

#### 5.2.1 OPEN BENCHMARK EVALUATION

To comprehensively evaluate the quality of instruction-tuned models, we compile automatic and human evaluation to assess the capabilities and human preference. For the evaluation of basic capabilities, we apply similar datasets in the pre-trained model evaluation, which target on natural language understanding, coding, mathematics, and reasoning. Specifically, we evaluate on MMLU, MMLU-Pro, GPQA, and Theorem QA for language understanding and knowledge, HumanEval, MBPP, MultiPL-E, and LiveCodeBench v1 (Jain et al., 2024) for coding, GSM8K and MATH for mathematics. Additionally, we assess the performance of human preference alignment and instruction following by evaluating on benchmarks including MT-Bench (Zheng et al., 2023), Arena-Hard (Li et al., 2024), AlignBench (Liu et al., 2023b), MixEval (Ni et al., 2024) whose results approximate those of Chatbot Arena, and IFEval (Zhou et al., 2023) for instruction following.

为了全面评估指令微调模型的质量，我们综合自动评估和人类评估来衡量模型能力和人类偏好。对于基础能力评估，我们采用与预训练模型评估类似的数据集，涵盖自然语言理解、代码、数学和推理。具体而言，在语言理解和知识方面评估 MMLU、MMLU-Pro、GPQA 和 Theorem QA; 在代码方面评估 HumanEval、MBPP、MultiPL-E 和 LiveCodeBench v1; 在数学方面评估 GSM8K 和 MATH。此外，我们通过 MT-Bench、Arena-Hard、AlignBench、MixEval(其结果近似 Chatbot Arena)以及 IFEval 等基准来评估人类偏好对齐和指令遵循能力。

Qwen2-72B-Instruct We compare Qwen2-72B-Instruct against the instruction-tuned models including Mixtral-8x22B-Instruct, Llama-3-70B-Instruct, as well as Qwen1.5-72B-Chat. The results are presented in Table 6. It can be found that a strong base language model can help boost the downstream performance of the instruction-tuned model. Specifically, Qwen2-72B-Instruct outshines its peers in areas such as language understanding, coding, and mathematics, with the exception of GPQA and MBPP. Regarding human preference alignment and instruction following, Qwen2-72B has significant advantages over the baselines. We assume this achievement is attributed to both the high-quality pre-trained model and improvements in both data and training techniques for post-training.

**Qwen2-72B-Instruct** 我们将 Qwen2-72B-Instruct 与 Mixtral-8x22B-Instruct、Llama-3-70B-Instruct 以及 Qwen1.5-72B-Chat 等指令微调模型进行比较。结果见表 6。可以发现，强大的基座语言模型有助于提升指令微调模型的下游性能。具体而言，Qwen2-72B-Instruct 在语言理解、代码和数学等领域均优于同类模型(除 GPQA 和 MBPP 外)。在人类偏好对齐和指令遵循方面，Qwen2-72B-Instruct 相比基线具有显著优势。我们认为这一成就归因于高质量的预训练模型，以及后训练阶段在数据和训练技术上的双重改进。

> **【译者注 · 偏好对齐的显著提升】**
> Qwen2-72B-Instruct 在 Arena-Hard(48.1)上大幅领先 Llama-3-70B-Instruct(41.1)，在 AlignBench(8.27)上也明显优于 Qwen1.5-110B-Chat(7.87)。这说明后训练阶段的"离线 DPO + 在线 DPO + Online Merging Optimizer"三件套在偏好对齐上产生了实质效果。但 GPQA(42.4 vs Llama-3 的 41.9)和 MBPP(80.2 vs Llama-3 的 82.3)上的微弱劣势表明，指令微调并不能完全弥补基座模型在某些领域的短板。

Qwen2-57B-A14B-Instruct For medium-size models, we compare Qwen2-57B-A14B-Instruct with Mixtral-8x7B-Instruct, another MoE baseline, as well as the dense SOTA models with over 30 billion parameters, e.g., Yi-1.5-34B-Chat and Qwen1.5-32B-Chat. The results are provided in Table 7. Compared with Qwen1.5-32B-Chat, Qwen2-57B-A14B-Instruct reaches superior performance in almost all benchmarks, and compared with the 30B SOTA model Yi-1.5-34B-Chat, Qwen2-57B-A14B-Instruct has gained advantages in most evaluations except for those for mathematics. In terms of the evaluation for alignment, the advantages of Qwen2-57B-A14B-Instruct are notably evident.

**Qwen2-57B-A14B-Instruct** 对于中等尺寸模型，我们将 Qwen2-57B-A14B-Instruct 与另一个 MoE 基线 Mixtral-8x7B-Instruct 以及超过 300 亿参数的稠密 SOTA 模型(如 Yi-1.5-34B-Chat 和 Qwen1.5-32B-Chat)进行比较。结果见表 7。与 Qwen1.5-32B-Chat 相比，Qwen2-57B-A14B-Instruct 在几乎所有基准上都达到了更优性能; 与 30B SOTA 模型 Yi-1.5-34B-Chat 相比，Qwen2-57B-A14B-Instruct 在大多数评估中取得优势(数学类基准除外)。在对齐评估方面，Qwen2-57B-A14B-Instruct 的优势尤为明显。

Qwen2-7B-Instruct Within the spectrum of 7B to 9B models, we compare Qwen2-7B-Instruct with Llama-3-8B-Instruct, Yi-1.5-9B-Chat, GLM-4-9B-Chat, and Qwen1.5-7B-Chat. The results can be found in Table 8. Qwen2-7B-Instruct demonstrates substantial advancements compared to its predecessor, Qwen1.5-7B-Chat, across comprehensive evaluations, notably achieving higher scores in coding and mathematics-related tasks. Compared with the recent SOTA model, Llama-3- 8B-Instruct, Qwen2-7B-Instruct demonstrates competitive performance and specifically it achieves superior performance in coding. Nonetheless, in terms of instruction following, Qwen2-7B-Instruct greatly falls behind the competitor. To address this limitation, we plan to augment the 7B model's instruction-following ability by enhancing the quality of post-training data, ensuring a more robust understanding and execution of complex commands.

**Qwen2-7B-Instruct** 在 7B 至 9B 模型范围内，我们将 Qwen2-7B-Instruct 与 Llama-3-8B-Instruct、Yi-1.5-9B-Chat、GLM-4-9B-Chat 和 Qwen1.5-7B-Chat 进行比较。结果见表 8。Qwen2-7B-Instruct 相比其前代 Qwen1.5-7B-Chat 在综合评估中展现出显著进步，尤其在代码和数学相关任务上得分更高。与近期 SOTA 模型 Llama-3-8B-Instruct 相比，Qwen2-7B-Instruct 展现出有竞争力的性能，尤其在代码方面表现更优。然而，在指令遵循方面，Qwen2-7B-Instruct 明显落后于竞争对手。为解决这一局限，我们计划通过提升后训练数据的质量来增强 7B 模型的指令遵循能力，确保对复杂命令的更稳健理解和执行。

> **【译者注 · 指令遵循的短板与自评】**
> Qwen2-7B-Instruct 在 IFEval strict-prompt(54.7)上大幅落后于 Llama-3-8B-Instruct(72.1)，这是报告罕见地自揭短板的时刻。团队将原因归结为"后训练数据的质量和多样性不足"，并承诺通过改进数据来解决——这种坦诚在开源模型报告中值得赞赏。有意思的是，在 HumanEval(79.9 vs Llama-3 的 62.2)和 MATH(52.9 vs Llama-3 的 30.0)上的大幅领先，与指令遵循上的明显落后形成鲜明对比，说明"能写代码"和"能听指令"是两个相对独立的能力维度。

Qwen2-1.5B-Instruct & Qwen2-0.5B-Instruct In the context of smaller models, we compare Qwen2-0.5B-Instruct with Qwen1.5-0.5B-Chat, and Qwen2-1.5B-Instruct with Qwen1.5-1.8B-Chat. Notably, the complexity of certain datasets designed for larger models exceeds the capabilities of these smaller models; thus, our analysis focuses on a selected subset. As detailed in Table 9, the Qwen2 models demonstrate a marked advantage over their predecessors in both core capabilities and instruction-following tasks. The achievement mainly attributes to the scaling of pre-training data. Consequently, our results affirm that data scaling remains an effective strategy for enhancing model performance, even in the domain of sub-billion parameter models.

**Qwen2-1.5B-Instruct 与 Qwen2-0.5B-Instruct** 在小模型语境下，我们将 Qwen2-0.5B-Instruct 与 Qwen1.5-0.5B-Chat 进行比较，将 Qwen2-1.5B-Instruct 与 Qwen1.5-1.8B-Chat 进行比较。值得注意的是，某些为更大模型设计的数据集复杂度超出了这些小模型的能力范围，因此我们的分析聚焦于选定的子集。如表 9 详述，Qwen2 模型在核心能力和指令遵循任务上均显著优于其前代。这一成就主要归因于预训练数据的扩展。因此，我们的结果证实：即使在亚十亿参数模型领域，数据扩展仍然是提升模型性能的有效策略。

#### 5.2.2 IN-HOUSE AUTOMATIC EVALUATION

Despite a number of open benchmark datasets for the evaluation, we believe that it is far from sufficient to fully comprehend the capabilities of LLMs. Specifically, we have made a series of in-house datasets that assess different capabilities of the models, e.g., knowledge understanding, text generation, coding, etc. The evaluation is in Chinese and English. The results are gathered in Table 10 and Table 11, respectively.

尽管已有大量公开基准数据集可供评估，但我们认为这远不足以全面理解 LLM 的能力。具体而言，我们构建了一系列内部数据集来评估模型的不同能力，如知识理解、文本生成、代码等。评估以中文和英文进行，结果分别汇总于表 10 和表 11。

Chinese Evaluation For the evaluations in Chinese, we focus on comparing the performance of Qwen2 models with the Qwen1.5 counterparts. For the small models, Qwen2-1.5B-Instruct generally outperforms Qwen1.5-1.8B-Chat in almost all the evaluations even with fewer parameters. In terms of the comparison of 7B models, the advantages of Qwen2 are more significant. Noteworthy is Qwen2- 72B's superior performance to Qwen1.5-110B-Chat, despite the latter's greatly more parameters. The MoE model displays superior performance across most domains relative to Qwen1.5-32B-Chat, excluding knowledge understanding. This discrepancy may be attributed to a short of pre-training tokens. In the near future, we are about to continue the pre-training of the MoE model to discover its scaling behaviors.

**中文评估** 在中文评估中，我们重点比较 Qwen2 模型与 Qwen1.5 对应型号的性能。对于小模型，Qwen2-1.5B-Instruct 在几乎所有评估中均优于 Qwen1.5-1.8B-Chat，尽管参数更少。在 7B 模型对比中，Qwen2 的优势更为显著。值得注意的是，Qwen2-72B 的表现优于参数大得多的 Qwen1.5-110B-Chat。MoE 模型在大多数领域相对于 Qwen1.5-32B-Chat 展现出更优性能，但在知识理解方面除外。这种差异可能归因于预训练 token 的不足。在不久的将来，我们计划继续对 MoE 模型进行预训练，以探索其扩展行为。

English Evaluation For English, we compare Qwen2 with both Qwen1.5 and Llama-3. Similarly, the small models of Qwen2 significantly outcompete the Qwen1.5 counterparts. However, in comparison with Llama-3-70B, Qwen2-72B-Instruct is falling behind by small margins especially in comprehension and coding. We assume both the amount of English tokens for pre-training and the quantity and diversity of data for post-training lead to the performance gap in English.

**英文评估** 在英文评估中，我们将 Qwen2 与 Qwen1.5 和 Llama-3 进行比较。类似地，Qwen2 的小模型显著优于 Qwen1.5 对应型号。然而，与 Llama-3-70B 相比，Qwen2-72B-Instruct 在理解和代码方面略有落后。我们认为，预训练中的英文 token 数量以及后训练数据的数量和多样性共同导致了英文方面的性能差距。

> **【译者注 · 内部评估揭示的真实差距】**
> 内部评估的坦诚程度令人印象深刻：Qwen2-72B-Instruct 在英文理解(63.09)和代码(36.41)上落后于 Llama-3-70B-Instruct(76.31 和 57.18)，团队将原因归结为"英文预训练 token 不足"和"后训练数据多样性不够"。这种自省式的分析比单纯罗列优势更有参考价值。表 10 中 Qwen2-72B-Instruct 的英文平均得分(62.23)甚至低于 Qwen-Max-0428(70.06)和 GPT-4o(76.11)，说明即便是旗舰模型，与闭源顶级模型仍有明显差距。

#### 5.2.3 LONG CONTEXT CAPABILITIES

Three methods to evaluate long context capabilities are employed: the Needle in a Haystack (NIAH, Kamradt, 2023), NeedleBench (OpenCompass Contributors, 2023), and LV-Eval (Yuan et al., 2024).

我们采用三种方法来评估长上下文能力：大海捞针(Needle in a Haystack, NIAH)、NeedleBench 和 LV-Eval。

Needle in a Haystack This experiment assesses a model's proficiency in pinpointing facts within voluminous texts. Texts with 8K, 16K, ..., 128K tokens in length were crafted, with facts strategically positioned at varying depths. Each depth interval, e.g., from 0% to 10%, encompassed two instances. For contexts over 32K, YARN (Peng et al., 2023) was applied in this evaluation. As illustrated in Figure 1, Qwen2-72B-Instruct exhibits exceptional accuracy in retrieving information from the entire 128K context. Coupled with its inherent strength, this model emerges as the optimal choice for processing extensive texts, assuming sufficient resources are accessible. Additionally, models within the same series showcases remarkable performance across different context lengths. Precisely, Qwen2- 7B-Instruct achieves a high level of accuracy in handling contexts up to 128K tokens. Meanwhile, Qwen2-57B-A14B-Instruct manages contexts up to 64K tokens proficiently, and the two smaller models in the Qwen2 series could support contexts of 32K tokens.

**大海捞针** 该实验评估模型在大量文本中精准定位事实的能力。我们构造了长度为 8K、16K、...、128K token 的文本，将事实策略性地放置在不同深度。每个深度区间(如 0% 至 10%)包含两个实例。对于超过 32K 的上下文，评估中应用了 YARN 机制。如图 1 所示，Qwen2-72B-Instruct 在整个 128K 上下文中展现出卓越的信息检索准确率。结合其固有优势，该模型成为处理大规模文本的最优选择(前提是资源充足)。此外，同系列模型在不同上下文长度上也展现出出色表现：Qwen2-7B-Instruct 在处理高达 128K token 的上下文时保持了高准确率; Qwen2-57B-A14B-Instruct 可熟练处理高达 64K token 的上下文; 两款更小的 Qwen2 模型则可支持 32K token 的上下文。

> **【译者注 · 长上下文的三级能力梯队】**
> Qwen2 系列形成了清晰的长上下文能力梯队：72B → 128K(全长度高精度)、7B → 128K( surprisingly 也能做到)、57B-A14B → 64K、0.5B/1.5B → 32K。这种差异化定位非常有策略性——大模型主打"全能长文本"，小模型主打"够用长文本"。YARN + DCA 的组合使 128K 扩展成为可能，而 32K 的基础上下文长度已经是预训练阶段就确定的能力基线。值得注意的是，超过 32K 后必须启用 YARN，这意味着 32K 是原生能力边界，更长上下文属于"外推增强"。

NeedleBench NeedleBench ups the challenge on NIAH by including multiple facts (two to five) in passages, necessitating simultaneous identification and multi-hop reasoning. Table 12 reveals that the integration of YARN and DCA (An et al., 2024) notably improves Qwen2 models' long-context abilities. Qwen2-7B-Instruct surpasses ChatGLM4-9B-1M (Zeng et al., 2024), which claims a 1M context length. Moreover, Qwen2-72B-Instruct demonstrates strong performance, with an accuracy reduction of just 6 points, compared to ChatGLM4-9B-1M, which shows a more pronounced decline of 11 points, particularly given its lower initial accuracy.

**NeedleBench** NeedleBench 通过在段落中包含多个事实(二至五个)来提升 NIAH 的挑战难度，要求模型同时识别并进行多跳推理。表 12 显示，YARN 和 DCA 的集成显著提升了 Qwen2 模型的长上下文能力。Qwen2-7B-Instruct 超越了声称支持 1M 上下文长度的 ChatGLM4-9B-1M。此外，Qwen2-72B-Instruct 展现出强劲性能，准确率仅下降 6 个百分点; 相比之下，ChatGLM4-9B-1M 的下降幅度更大(11 个百分点)，尤其考虑到其初始准确率更低。

LV-Eval LV-Eval comprises 11 diverse QA datasets that demand comprehension of multiple pieces of evidence at once. To rectify the shortcomings of its original metric, which was excessively stringent and led to a high rate of false negatives, we adopt the keyword recall as the reported score. As shown in Table 12, integrating YARN and DCA substantially bolsters the long-context competencies of Qwen2 models on LV-Eval. Qwen2-7B-Instruct achieves parity with ChatGLM4-9B-1M, albeit with a more noticeable decline at extended contexts. Moreover, Qwen2-72B-Instruct demonstrates strong performance across all lengths, confirming its proficiency in handling long-context tasks.

**LV-Eval** LV-Eval 包含 11 个多样化的 QA 数据集，要求模型同时理解多条证据。为修正其原始指标过于严格、导致大量假阴性的缺陷，我们采用关键词召回率作为报告分数。如表 12 所示，YARN 和 DCA 的集成显著增强了 Qwen2 模型在 LV-Eval 上的长上下文能力。Qwen2-7B-Instruct 与 ChatGLM4-9B-1M 表现相当，尽管在长上下文上的下降更为明显。此外，Qwen2-72B-Instruct 在所有长度上均展现出强劲性能，证实了其处理长上下文任务的熟练程度。

#### 5.2.4 MULTILINGUAL EVALUATION

For the multilingual evaluation, we implement a comprehensive human evaluation for the assessment of multilingual capabilities. Specifically, we design diverse test cases assessing different capabilities of large language models, and we have test cases that are in a number of languages. For the annotators, we invite one professional annotator for each language who majors in the language for the evaluation. For each test case, the annotator grades the response from model with a score from 1 to 5.

在多语言评估中，我们实施了全面的人工评估来衡量多语言能力。具体而言，我们设计了多样化的测试用例来评估大语言模型的不同能力，且测试用例涵盖多种语言。对于评估者，我们为每种语言邀请一名以该语言为专业的专业评估人员。对于每个测试用例，评估人员对模型回复进行 1 至 5 分的评分。

We report the results of our model and the baselines in the evaluation of different languages. From Table 13, it can be found that on average Qwen2-72B-Instruct significantly outperforms GPT-3.5- Turbo and it is competitive with GPT-4-Turbo and slightly falls behind Claude-3-Opus. This shows that our multilingual pre-training and instruction tuning data contribute to the multilingual capabilities of Qwen2-72B-Instruct and it is competitive with most state-of-the-art proprietary LLMs.

我们报告了模型和基线在不同语言评估中的结果。从表 13 可以看出，平均而言 Qwen2-72B-Instruct 显著优于 GPT-3.5-Turbo，与 GPT-4-Turbo 具有竞争力，并略逊于 Claude-3-Opus。这表明我们的多语言预训练和指令微调数据对 Qwen2-72B-Instruct 的多语言能力做出了贡献，使其能够与大多数当前最优的闭源 LLM 竞争。

> **【译者注 · 多语言能力的战略价值】**
> 表 13 覆盖阿拉伯语、法语、印尼语、日语、韩语、葡萄牙语、俄语、西班牙语、泰语、越南语共 10 种语言，平均得分 Qwen2-72B-Instruct(3.93)介于 GPT-4-Turbo(3.98)和 GPT-4o(4.09)之间。这一结果的战略意义在于：Qwen2 作为开源模型，其多语言能力与闭源顶级模型的差距已经很小，而成本差距却很大。对于东南亚、中东、拉美等非英语市场的开发者而言，Qwen2 可能是性价比最高的选择。越南语(3.91)和泰语(3.75)得分相对较低，说明低资源语言仍是挑战。

#### 5.2.5 SAFETY & RESPONSIBILITY

LLMs with openly accessible weights effectively accelerate the development of the research as well as their applications. Moreover, we believe that it is crucial to build safe and responsible LLMs so that the effect of the misuse of AI technologies could be significantly alleviated.

权重公开可访问的 LLM 有效加速了研究及其应用的发展。此外，我们认为构建安全且负责任的 LLM 至关重要，这样才能显著缓解 AI 技术被滥用带来的影响。

We implement a multilingual safety evaluation that tests the LLMs in different languages. Specifically, we assess the safety performance of the models in the topics about illegal behaviors, fraud, pornography, and privacy. We have collected prompts prone to jail-breaking and use them to test whether the models can provide safe responses by rejection.

我们实施了多语言安全评估，在不同语言中测试 LLM。具体而言，我们评估模型在非法行为、欺诈、色情和隐私等主题上的安全表现。我们收集了容易触发越狱(jail-breaking)的 prompt，并用它们测试模型是否能通过拒绝来提供安全的回复。

The results are presented in Table 14, where the proportion of harmful responses generated by the models are shown and the lower, the better. It can be observed that Qwen2-72B-Instruct performs better than the proprietary model, GPT-4, and significantly outperforms the open-weight model, Mixtral-8x22B-Instruct. However, we believe that there is still much room for our model to improve to be a safer and more responsible model, especially in terms of pornography, which is a conventionally difficult category to differentiate even for humans.

结果呈现于表 14，展示了模型生成的有害回复比例(越低越好)。可以观察到，Qwen2-72B-Instruct 优于闭源模型 GPT-4，并显著优于开源权重模型 Mixtral-8x22B-Instruct。然而，我们认为我们的模型在成为更安全、更负责任的模型方面仍有很大改进空间，尤其是在色情内容方面——这是一个即使对人类来说也传统上难以区分的类别。

> **【译者注 · 安全评估的诚实自省】**
> Qwen2-72B-Instruct 在安全拒绝率上表现优异：非法行为(0.00%，与 GPT-4 持平)、欺诈(2.41%，优于 GPT-4 的 3.40%)、隐私(2.47%，优于 GPT-4 的 3.37%)。但在色情内容上(22.91%)，虽然优于 Mixtral(33.82%)，却仅略优于 GPT-4(23.63%)。团队坦诚指出"色情内容是一个传统上即使对人类也难以区分的类别"——这种诚实比宣称"完美安全"更有价值。安全与有用性之间的 tension(过度拒绝 vs 不足拒绝)是 LLM 对齐领域的核心难题。

#### 5.2.6 CONTAMINATION ANALYSIS

For large language models, what counts as contamination and how to run contamination analysis remain an active area of research (Ravaut et al., 2024; Golchin & Surdeanu, 2024; Sainz et al., 2023). In the following, we first introduce how we try to decontaminate the training corpora against the evaluation datasets, and then estimate the extent to which benchmark scores are influenced by the remaining contamination.

对于大语言模型，什么构成数据污染、以及如何执行污染分析仍然是活跃的研究领域。在下文中，我们首先介绍如何尝试对训练语料进行去污染以应对评估数据集，然后评估剩余污染对基准分数的影响程度。

During the construction of the pre-training and post-training datasets, we exclude potentially contaminated data using n-gram matching. However, we found that this approach may lead to a high false negative rate, because there could be commonly used expressions, especially in mathematical and coding data. Therefore, we also applied another constraint based on the longest common subsequence (LCS). Specifically, we first remove all symbols and punctuation from both the test and training sequences and perform tokenization. For a training sequence $\mathbf { s } _ { t }$ , we remove it if there is a test sequence ${ \bf s } _ { e }$ such that $| \mathrm { LCS } ( \mathbf { s } _ { t } , \mathbf { s } _ { e } ) | \geq 1 3$ and $| \mathrm { LCS } ( \mathbf { \bar { s } } _ { t } , \mathbf { s } _ { e } ) | \geq 0 . 6 \times \operatorname* { m i n } ( | \mathbf { s } _ { t } | , | \mathbf { s } _ { e } | )$.

在构建预训练和后训练数据集时，我们使用 n-gram 匹配来排除潜在污染数据。然而，我们发现这种方法可能导致较高的假阴性率，因为存在常用表达式，尤其在数学和代码数据中。因此，我们还应用了基于最长公共子序列(Longest Common Subsequence, LCS)的另一约束条件。具体而言，我们首先从测试序列和训练序列中移除所有符号和标点并进行分词。对于训练序列 $\mathbf{s}_t$，如果存在测试序列 $\mathbf{s}_e$ 使得 $|\mathrm{LCS}(\mathbf{s}_t, \mathbf{s}_e)| \geq 13$ 且 $|\mathrm{LCS}(\bar{\mathbf{s}}_t, \mathbf{s}_e)| \geq 0.6 \times \min(|\mathbf{s}_t|, |\mathbf{s}_e|)$，则移除该训练序列。

To assess the potential effects of leaking data on the test performance, we follow OpenAI (2023) to construct a strict non-contaminated test set to check if there is a significant performance degradation after strict decontamination. Specifically, we construct the non-contaminated test set by excluding any sample which has 13-gram overlap with the pre-training or the post-training data (without constraint on LCS), and then compute the corresponding metric on the test set.

为评估数据泄露对测试性能的潜在影响，我们遵循 OpenAI(2023)的做法，构建严格的非污染测试集，以检查严格去污染后是否存在显著的性能下降。具体而言，我们通过排除任何与预训练或后训练数据存在 13-gram 重叠的样本来构建非污染测试集(不施加 LCS 约束)，然后在该测试集上计算相应指标。

The results are presented in Table 15. Although some datasets exhibit a high percentage of contamination under the strict criterion, we noticed that most of the identified contaminated samples are false positives, primarily stemming from the mathematics and coding datasets. It is likely that certain code snippets and mathematical equations are so common that they do not provide any meaningful advantage in solving the test data. Furthermore, our analysis shows that the performance of the Qwen2 models remains consistent between the original and non-contaminated test data, suggesting that the potential issue of data contamination does not significantly impact the model's performance.

结果呈现于表 15。尽管某些数据集在严格标准下显示出较高的污染比例，但我们注意到大多数被识别的污染样本是假阳性，主要源自数学和代码数据集。很可能某些代码片段和数学方程过于常见，以至于它们在解决测试数据时并不提供任何有意义的帮助。此外，我们的分析表明，Qwen2 模型在原始测试数据和非污染测试数据上的性能保持一致，说明数据污染的潜在问题并未对模型性能产生显著影响。

> **【译者注 · 污染分析的严谨方法论】**
> Qwen2 的污染分析采用了双层去污染策略(n-gram + LCS)，并参考了 OpenAI 的严格标准(13-gram 重叠)构建非污染测试集。最有趣的数据点是：HumanEval 的污染率高达 75.0%，但去污染后性能反而略有提升(86.0 → 87.0); MATH 污染率 31.7%，去污染后提升最大(69.0 → 74.6)。这说明代码和数学领域的"污染"大多是通用片段的重叠，而非真正的测试集泄露。团队对污染问题的透明处理为社区提供了宝贵的参考范式。

## 6 CONCLUSION

This technical report has presented the Qwen2 series, a versatile suite of foundational and instructiontuned language models, ranging from 0.5 to 72 billion parameters, including models of dense and Mixture-of-Experts architecture. Qwen2 outperforms previous open-weight models, notably its predecessor Qwen1.5, and displays competitive performance against proprietary models across a broad spectrum of benchmarks in language understanding, generation, multilingual capabilities, coding, mathematics, and reasoning. In this update, we have extra focus on long-context, multilingual, coding, mathematics capabilities and safety and responsibility. In a commitment to fostering innovation and accessibility within the community, we have made the Qwen2 model weights openly accessible, which enables researchers and developers to harness the full potential of Qwen2 in a variety of applications and research projects. Through these efforts, we aim to contribute to the advancement of AI technologies and their positive impact on society.

本技术报告介绍了 Qwen2 系列——一套多功能的基础模型和指令微调语言模型套件，参数规模从 0.5B 到 72B，涵盖稠密架构和混合专家(MoE)架构。Qwen2 超越了此前的开源权重模型，尤其是其前代 Qwen1.5，并在语言理解、生成、多语言能力、代码、数学和推理等广泛基准上展现出与闭源模型相竞争的业绩。在本次更新中，我们特别关注长上下文、多语言、代码、数学能力以及安全与责任。为了致力于促进社区内的创新与可及性，我们已公开 Qwen2 模型权重，使研究人员和开发者能够在各种应用和研究项目中充分利用 Qwen2 的全部潜力。通过这些努力，我们旨在为 AI 技术的进步及其对社会的积极影响做出贡献。

> **【译者注 · Qwen2 的历史定位与技术谱系】**
> Qwen2(2024 年 6 月发布)是中国大模型开源化的重要里程碑。从 Qwen(2023.09)→ Qwen1.5(2024.02)→ Qwen2(2024.06)的演进脉络清晰可见：每一步都在扩展模型尺寸范围、增强多语言能力、提升代码和数学性能。Qwen2 的 MoE 架构(57B-A14B)是阿里系首次在开源模型中系统性地验证稀疏架构的效率-性能权衡。后训练阶段从 PPO 全面转向 DPO(离线+在线)也是顺应 2023-2024 年开源社区的技术潮流。与同期 Llama-3(Meta，2024.04)相比，Qwen2 在多语言和中文能力上具有明显优势，在代码和数学上也实现了部分超越，但在英文理解和指令遵循上仍有追赶空间。Qwen2 的开放权重策略(Apache 2.0 许可)对中国乃至全球的 LLM 研究和应用生态产生了深远影响。

## REFERENCES

以下为 Qwen2 技术报告的参考文献列表(按原文顺序)。完整引用信息请参阅 D3 原文 `03-Qwen2-mineru-en.md` 第 327–485 行。

> 报告共引用约 70 篇文献，涵盖 Transformer 架构(Vaswani et al., 2017)、RoPE(Su et al., 2024)、RMSNorm(Zhang & Sennrich, 2019)、SwiGLU(Shazeer, 2020)、GQA(Ainslie et al., 2023)、MoE/Upcycling(Komatsuzaki et al., 2023)、YARN(Peng et al., 2023)、DCA(An et al., 2024)、DPO(Rafailov et al., 2023)、Online Merging Optimizer(Lu et al., 2024a)、Constitutional AI(Bai et al., 2022)等核心技术，以及 MMLU、HumanEval、GSM8K 等主流基准的原始论文。引用分布显示团队对代码/数学数据增强、长上下文扩展、偏好对齐等方向的最新进展保持紧密跟踪。

---

> **全文完**。本文基于 Qwen2 官方技术报告(26 页 PDF)的 MinerU 英文原文进行逐段中英对照翻译。
> - 翻译日期：2026-05-19
> - 源文件：`03-Qwen2-mineru-en.md`
> - 涵盖章节：Abstract → Introduction → Tokenizer & Model → Pre-Training → Post-Training → Evaluation → Conclusion → References
