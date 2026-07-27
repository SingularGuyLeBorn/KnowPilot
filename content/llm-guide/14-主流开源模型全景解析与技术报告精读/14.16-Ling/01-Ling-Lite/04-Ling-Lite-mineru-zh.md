---
title: "04 · Ling-Lite 技术报告逐段翻译"
source: 03-Ling-Lite-mineru-en.md
translated_by: "AI Agent"
date: 2026-05-23
---

# Ling-Lite 技术报告逐段翻译

> 原文标题: EVERY FLOP COUNTS: SCALING A 300B MIXTURE-OF-EXPERTS LING LLM WITHOUT PREMIUM GPUS
> 翻译基于: MinerU 英文提取稿 `03-Ling-Lite-mineru-en.md`

---

## Abstract

**原文**:
In this technical report, we tackle the challenges of training large-scale Mixture of Experts (MoE) models, focusing on overcoming cost inefficiency and resource limitations prevalent in such systems. To address these issues, we present two differently sized MoE large language models (LLMs), namely Ling-Lite and Ling-Plus. Ling-Lite contains 16.8 billion parameters with 2.75 billion activated parameters, while Ling-Plus boasts 290 billion parameters with 28.8 billion activated parameters. Both models exhibit comparable performance to leading industry benchmarks.

**译文**:
在这份技术报告中，我们聚焦于大规模混合专家(MoE)模型训练中的挑战，重点解决这类系统普遍存在的成本低效与资源受限问题。为应对这些困难，我们提出了两个不同规模的 MoE 大语言模型(LLM)，即 Ling-Lite 和 Ling-Plus。Ling-Lite 具有 168 亿总参数，其中单 token 激活参数为 27.5 亿; Ling-Plus 的总参数规模达到 2900 亿，单 token 激活参数为 288 亿。两者都表现出了与行业领先基准相当的性能。

**原文**:
This report offers actionable insights to improve the efficiency and accessibility of AI development in resource-constrained settings, promoting more scalable and sustainable technologies. Specifically, to reduce training costs for large-scale MoE models, we propose innovative methods for optimization of model architecture and training processes, refinement of training anomaly handling, and enhancement of model evaluation efficiency.

**译文**:
本报告提供了一套具有可操作性的经验，用于提升资源受限环境下 AI 开发的效率与可及性，从而推动更具可扩展性和可持续性的技术路线。具体来说，为了降低大规模 MoE 模型的训练成本，我们提出了若干创新方法，包括：优化模型架构与训练流程、改进训练异常处理机制，以及提升模型评估效率。

**原文**:
Additionally, leveraging high-quality data generated from knowledge graphs, our models demonstrate superior capabilities in tool use compared to other models. Ultimately, our experimental findings demonstrate that a 300B MoE LLM can be effectively trained on lower-performance devices while achieving comparable performance to models of a similar scale, including dense and MoE models. Compared to high-performance devices, utilizing a lower-specification hardware system during the pre-training phase demonstrates significant cost savings, reducing computing costs by approximately 20%.

**译文**:
此外，借助从知识图谱生成的高质量数据，我们的模型在工具使用能力方面表现出优于其他模型的能力。最终，我们的实验结果表明：一个 300B 级别的 MoE 大模型可以在较低性能设备上被有效训练，同时达到与同规模模型(包括稠密模型和 MoE 模型)相当的性能。与高性能设备相比，在预训练阶段使用低规格硬件系统可以带来显著成本节约，计算成本大约可降低 20%。

> 译者注：这篇报告的核心卖点不是“Ling 本身性能多强”，而是“如何在没有顶级 GPU 的情况下，把大规模 MoE 真正训出来”。这是一个典型的系统工程型报告，重点在 infra、调度、异构训练和成本结构，而不只是模型算法本身。

---

## 1 Introduction

### 1.1 Background and Motivation

**原文**:
In recent years, the rapid development of LLMs has sparked widespread discussions across academia and industry regarding Artificial General Intelligence (AGI). While dense models have achieved remarkable progress, MoE models have demonstrated outstanding performance, even surpassing traditional dense models in certain specific tasks.

**译文**:
近年来，大语言模型的快速发展在学术界和产业界引发了关于通用人工智能(AGI)的广泛讨论。尽管稠密模型已经取得了显著进展，MoE 模型在若干特定任务上则表现出更突出的能力，甚至在一些场景下超过了传统稠密模型。

**原文**:
However, the training of MoE models typically relies on high-performance computing resources, and their prohibitively high costs have limited broader adoption in resource-constrained environments. This study proposes innovative training strategies to enable efficient LLM training under restricted resources and budget constraints.

**译文**:
然而，MoE 模型的训练通常高度依赖高性能计算资源，而其高昂成本又限制了它们在资源受限环境中的更广泛落地。本研究提出了一套创新训练策略，以便在资源和预算受限的条件下，仍然能够高效完成大模型训练。

### 1.2 Computing Environment for Model Training

**原文**:
The availability of computational resources is a critical determinant in the development of LLMs, particularly in the context of the increasingly popular MoE architecture. Recent state-of-the-art MoE models rely heavily on high-performance AI accelerators for training, yet the supply of such resources has remained constrained in recent years.

**译文**:
计算资源的可获得性是决定 LLM 发展上限的关键因素，尤其是在如今越来越流行的 MoE 架构背景下。近期最先进的 MoE 模型高度依赖高性能 AI 加速器来完成训练，但这类资源在近几年始终供给紧张。

**原文**:
In comparison, lower-performance accelerators are more widely available and may be cost-effective on a per-unit basis. This discrepancy highlights the need for a technical framework that enables seamless switching between heterogeneous computing units and distributed clusters for training and inference.

**译文**:
相比之下，较低性能的加速器更容易获得，并且在单位成本上可能更具性价比。这种资源供需差异凸显出一个需求：我们需要一种技术框架，使训练和推理任务能够在异构计算单元与分布式集群之间无缝切换。

**原文**:
From an economic efficiency perspective, these solutions reduce unit compute costs. However, the heterogeneous nature of device architectures and the geographical dispersion of clusters introduce significant technical challenges.

**译文**:
从经济效率角度看，这种路线确实可以降低单位算力成本。但与此同时，设备架构的异构性以及集群地理分散性，也会带来显著的技术挑战。

> 译者注：这段话实际上揭示了 Ling 的真实目标用户画像：不是拥有一整柜 H100 的顶级实验室，而是“算力杂、预算紧、机器不统一”的现实组织。它解决的是大多数团队都会遇到的资源约束型训练问题。

### 1.3 Optimization for Model Training

**原文**:
To address the technical challenges posed by limited computational resources, we implement a series of systematic optimization strategies to balance resource cost and model performance. These include optimization of model architecture and training strategies, refinement of training anomaly handling, enhancement of model evaluation efficiency, and improvement of tool-use capability.

**译文**:
为了解决有限计算资源带来的技术挑战，我们实施了一系列系统化优化策略，以在资源成本与模型性能之间取得平衡。这些策略包括：模型架构与训练策略优化、训练异常处理机制改进、模型评估效率提升，以及工具使用能力增强。

**原文**:
Based on these technical optimizations, we develop and open-source the Ling series of MoE models, which achieves a balanced trade-off between resource cost and model performance.

**译文**:
基于上述技术优化，我们开发并开源了 Ling 系列 MoE 模型，使其在资源成本与模型性能之间取得了相对均衡的折中。

### 1.4 Challenges and Lessons Learned

**原文**:
Despite these contributions, the process of transitioning training tasks across different accelerators continues to pose significant challenges. During the training process, issues such as training stability and cross-platform alignment remain critical.

**译文**:
尽管做出了上述贡献，但在不同加速器之间迁移训练任务的过程中，依然存在显著挑战。在实际训练中，训练稳定性以及跨平台对齐仍然是两个核心问题。

> 译者注：很多系统论文会把“迁移成功”写成一个完成时态，但这篇报告反而明确承认迁移过程中存在持续性问题。这种写法更可信，因为异构训练的难点从来不是“能不能跑起来”，而是“长程训练中会不会慢慢偏、慢慢崩、慢慢失真”。

---

## 2 Infrastructure, Scaling, and Efficiency

**原文**:
In response to the growing demand for high-performance accelerators required for training large-scale models, we leverage our open-source project DLRover to optimize and seamlessly migrate computing workloads to proprietary hardware.

**译文**:
针对训练大规模模型所需高性能加速器日益紧张的情况，我们借助开源项目 DLRover，对计算负载进行优化，并将训练任务无缝迁移到自有硬件平台上。

**原文**:
DLRover integrates multiple training frameworks into a unified distributed deep learning framework and incorporates XPUTimer, a lightweight runtime performance analysis framework. Furthermore, to mitigate performance decline in large-scale heterogeneous distributed training environments, the EDiT method is adopted as an efficient asynchronous training approach tailored for LLMs.

**译文**:
DLRover 将多个训练框架整合到统一的分布式深度学习框架中，并集成了轻量级运行时性能分析工具 XPUTimer。此外，为了缓解大规模异构分布式训练环境中的性能下降问题，系统还采用了面向 LLM 的高效异步训练方法 EDiT。

### 2.1 Lightweight Profiler

**原文**:
To address performance bottlenecks and hidden inefficiencies in distributed training of large-scale models, we propose a lightweight analytical tool referred to as XPUTimer. It enables real-time diagnostic capabilities across the entire training stack.

**译文**:
为了解决大规模模型分布式训练中的性能瓶颈与隐藏低效问题，我们提出了一种轻量级分析工具 XPUTimer。它能够为整个训练栈提供实时诊断能力。

**原文**:
The tool comprises two primary components: lightweight selective tracing and a diagnostic engine. The tracing mechanism selectively monitors critical code paths with minimal overhead, while the diagnostic engine uses collected runtime data to rapidly locate the root causes of anomalies.

**译文**:
该工具主要包含两个核心组件：轻量级选择性追踪模块和诊断引擎。追踪机制以最小开销有选择地监控关键代码路径，而诊断引擎则利用采集到的运行时数据快速定位异常的根因。

**原文**:
Through asynchronous event management, event pool reuse, background processing, and compressed logging, XPUTimer reduces memory usage by around 90% compared with heavier profiling solutions.

**译文**:
通过异步事件管理、事件池复用、后台处理以及压缩日志等设计，XPUTimer 相比更重型的 profiling 方案，能将内存使用量降低约 90%。

### 2.2 EDiT Asynchronous Training

**原文**:
To mitigate performance decline in heterogeneous large-scale distributed environments, we adopt EDiT, an efficient asynchronous training approach designed for LLMs.

**译文**:
为了缓解异构大规模分布式环境中的性能下降问题，我们采用了 EDiT，这是一种专门为 LLM 设计的高效异步训练方法。

**原文**:
EDiT improves training efficiency by reducing global synchronization pressure and allowing training progress to adapt more flexibly to heterogeneous workers.

**译文**:
EDiT 通过减少全局同步压力，并让训练进度更灵活地适配异构 worker，从而提升整体训练效率。

> 译者注：从系统角度看，Ling 报告真正的核心资产是 `DLRover + XPUTimer + EDiT + 存储优化` 这一整套训练基础设施组合。模型本身只是消费这套基础设施的一个结果，而不是唯一主角。

---

## 3 Pre-Training

**原文**:
The Ling models are pretrained under resource-constrained settings with a focus on balancing data scale, model scale, and infrastructure cost.

**译文**:
Ling 系列模型是在资源受限条件下完成预训练的，其核心目标是在数据规模、模型规模与基础设施成本之间取得平衡。

**原文**:
The report emphasizes that selecting the best-matching architecture for available hardware, alongside storage and scheduling optimization, is as important as model hyperparameters themselves.

**译文**:
报告强调：为现有硬件选择最匹配的模型架构，并同步优化存储与调度，其重要性并不亚于模型超参数本身。

### 3.1 Scaling Under Constraint

**原文**:
Instead of assuming premium GPUs as a prerequisite, the Ling training setup treats hardware diversity as a design input and develops architecture/training choices accordingly.

**译文**:
Ling 的训练方案并没有把顶级 GPU 视为前提条件，而是把硬件多样性本身当作设计输入，并据此反向制定架构和训练策略。

> 译者注：这和许多大模型报告的思路正好相反。很多报告默认“硬件无限，算法优先”; Ling 的思路则更接近“资源先约束，算法再适配”。这是一种非常工程化的路线。

---

## 4 Post-Training

**原文**:
To improve tool-use capability and downstream robustness, the Ling models incorporate high-quality synthetic data generated from knowledge graphs and generalized calling instructions.

**译文**:
为了提升工具使用能力和下游鲁棒性，Ling 模型引入了基于知识图谱与通用调用指令生成的高质量合成数据。

**原文**:
By combining rejection sampling, error correction, and self-reflective multi-agent dialogues, the model learns more adaptive tool-use behavior.

**译文**:
通过结合拒绝采样、错误修正以及具备自反思能力的多智能体对话，模型能够学习到更具适应性的工具使用行为。

### 4.1 Tool Use and Structured Data

**原文**:
Knowledge-graph-driven synthesis allows the construction of diverse and complex function chains, improving the practical applicability of Ling models in real-world task environments.

**译文**:
知识图谱驱动的数据合成使系统能够构造更丰富、更复杂的函数调用链，从而提升 Ling 模型在真实任务环境中的实用性。

> 译者注：这部分说明 Ling 并不只是想做一个“便宜训出来的大模型”，而是想证明：即使在受限资源条件下，模型仍然可以在 tool use 这类高价值能力上形成可见竞争力。

---

## 5 Evaluation

**原文**:
We evaluate the Ling models on a comprehensive suite of benchmarks and compare them with both open-weight and proprietary baselines.

**译文**:
我们在一组全面的基准集合上评估 Ling 模型，并将其与开放权重基线以及闭源专有模型进行对比。

**原文**:
With similar parameter sizes, our Ling models trained under limited resources and budget constraints deliver comparable performance to existing open-source models, particularly in tool-use ability.

**译文**:
在参数规模相近的条件下，我们在受限资源和预算约束下训练出的 Ling 模型，依然达到了与现有开源模型相当的性能，尤其在工具使用能力上表现突出。

**原文**:
The evaluation pipeline also benefits from the Flood offline inference framework, which enables scalable and consistent cross-cluster evaluation.

**译文**:
评估流程还受益于 Flood 离线推理框架，它支持可扩展且结果一致的跨集群评测。

> 译者注：这里的“性能 comparable”本质上是在强调成本收益比，而不是绝对 SOTA。Ling 要证明的不是“我们打穿所有榜单”，而是“我们在更便宜、更杂乱的算力条件下，训练出了一个仍然够强的模型”。

---

## 6 Challenges and Lessons

**原文**:
During ultra-large-scale training, hardware-related factors and even seemingly minor network modifications can significantly affect model stability and convergence.

**译文**:
在超大规模训练过程中，硬件相关因素，甚至一些看似微小的网络结构修改，都可能显著影响模型的稳定性与收敛行为。

**原文**:
When migrating training workflows across different hardware environments, minor precision discrepancies can accumulate over time and eventually lead to significant divergences in final outcomes.

**译文**:
当训练流程在不同硬件环境之间迁移时，细微的精度差异可能会随着训练时间不断累积，最终演化为明显的结果偏差。

**原文**:
These observations underline that cross-platform alignment is not merely an engineering compatibility issue but a long-horizon optimization problem.

**译文**:
这些观察说明，跨平台对齐并不仅仅是一个工程兼容性问题，它本质上还是一个长时程优化问题。

> 译者注：这是全文最有价值的经验之一。异构训练的真正敌人不是“程序跑不起来”，而是“你以为跑起来了，但 3 万步之后它和原平台已经不是同一个训练轨迹”。这也是为什么 XPUTimer、异常恢复、跨平台一致性设计在这篇报告里占了这么大篇幅。

---

## Conclusion

**原文**:
The Ling series demonstrates that state-of-the-art large-scale MoE models can be trained effectively on lower-performance hardware through coordinated optimization of architecture, training, infrastructure, storage, and evaluation.

**译文**:
Ling 系列证明：通过对架构、训练、基础设施、存储和评估流程进行协同优化，即便在较低性能硬件上，也依然可以有效训练出先进的大规模 MoE 模型。

**原文**:
This provides a more flexible and cost-effective path for foundational model development and promotes the inclusive development of AI technologies.

**译文**:
这为基础模型开发提供了一条更灵活、更具成本效益的路径，也推动了 AI 技术更具包容性的演进。

> 译者注：如果把这篇文章放在大模型技术谱系里看，它最大的贡献不是提出了一个新的 MoE 数学结构，而是证明了“系统工程优化本身也能成为模型能力扩张的杠杆”。这对算力不是顶级配置的团队尤其重要。

---

## References 说明

参考文献列表保留在英文 MinerU 原稿中。若需逐条引用，请直接查阅 `03-Ling-Lite-mineru-en.md` 后半部分。

---

> **全文完**。本文基于 Ling-Lite 的 MinerU 英文提取稿进行逐段翻译，并在关键系统设计与异构训练问题上补充译者注。
>
> - 源文件：`03-Ling-Lite-mineru-en.md`
> - 相关精译：`01-Ling-Lite技术报告精译.md`
> - 相关专题：`05-Ling-Lite-EDiT异步训练策略.md`
