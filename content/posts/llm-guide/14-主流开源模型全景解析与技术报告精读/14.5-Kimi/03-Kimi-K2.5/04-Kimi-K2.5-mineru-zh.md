---
title: "Kimi K2.5 Technical Report - Segment-by-Segment Translation with Translator's Notes"
source: 03-Kimi-K2.5-mineru-en.md
model: Kimi K2.5
---

## Abstract

>  **[返回 14.5-Kimi 家族总览](../../14.5-Kimi.md)**

### 摘要

We introduce Kimi K2.5, an open-source multimodal agentic model designed to advance general agentic intelligence. K2.5 emphasizes the joint optimization of text and vision so that two modalities enhance each other. This includes a series of techniques such as joint text-vision pre-training, zero-vision SFT, and joint text-vision reinforcement learning. Building on this multimodal foundation, K2.5 introduces Agent Swarm, a self-directed parallel agent orchestration framework that dynamically decomposes complex tasks into heterogeneous sub-problems and executes them concurrently. Extensive evaluations show that Kimi K2.5 achieves state-of-the-art results across various domains including coding, vision, reasoning, and agentic tasks. Agent Swarm also reduces latency by up to 4.5x over single-agent baselines. We release the post-trained Kimi K2.5 model checkpoint to facilitate future research and real-world applications of agentic intelligence.

我们推出 Kimi K2.5,一个为提升通用智能体智能而设计的开源多模态智能体模型。K2.5 强调文本与视觉的联合优化,使两种模态相互增强。这包括一系列技术,如联合文本-视觉预训练、零视觉 SFT 和联合文本-视觉强化学习。在这一多模态基础之上,K2.5 引入了 Agent Swarm,一种自导向的并行智能体编排框架,能够动态地将复杂任务分解为异构子问题并并发执行。广泛的评估表明,Kimi K2.5 在编程、视觉、推理和智能体任务等多个领域取得了 SOTA 结果。Agent Swarm 还将延迟降低至单智能体基线的 1/4.5。我们发布了后训练后的 Kimi K2.5 模型检查点,以促进智能体智能的未来研究和实际应用。

> 译者注(设计动机): Kimi K2.5 的核心定位是"多模态 + 智能体"的双重突破。1) 与 K2 的纯文本智能体不同,K2.5 将视觉能力深度整合到智能体工作流中,这意味着模型可以直接处理 UI 截图、图表、代码界面等视觉输入;2) "零视觉 SFT"(zero-vision SFT)是一个反直觉的发现: 仅通过文本 SFT 就能激活视觉推理能力,这说明联合预训练已经建立了足够强的跨模态对齐;3) Agent Swarm 的并行编排是应对复杂任务延迟瓶颈的关键创新,4.5 倍延迟降低意味着一个原本需要 10 分钟的任务可以缩短到 2 分钟出头,这对实际生产力工具至关重要。

## 1 Introduction
### 引言

Large Language Models (LLMs) are rapidly evolving toward agentic intelligence. Recent advances, such as GPT-5.2 [41], Claude Opus 4.5 [6], Gemini 3 Pro [20], and Kimi K2-Thinking [1], demonstrate substantial progress in agentic capabilities, particularly in tool calling and reasoning. These models increasingly exhibit the ability to decompose complex problems into multi-step plans and to execute long sequences of interleaved reasoning and actions.

大语言模型(LLM)正快速向智能体智能演进。近期进展如 GPT-5.2 [41]、Claude Opus 4.5 [6]、Gemini 3 Pro [20] 和 Kimi K2-Thinking [1] 展示了智能体能力的显著进步,特别是在工具调用和推理方面。这些模型越来越展现出将复杂问题分解为多步计划并执行交错推理与行动长序列的能力。

In this report, we introduce the training methods and evaluation results of Kimi K2.5. Concretely, we improve the training of K2.5 over previous models in the following two key aspects.

在本报告中,我们介绍了 Kimi K2.5 的训练方法和评估结果。具体而言,我们在以下两个关键方面改进了 K2.5 的训练。

**Joint Optimization of Text and Vision.** A key insight from the practice of K2.5 is that joint optimization of text and vision enhances both modalities and avoids the conflict. Specifically, we devise a set of techniques for this purpose. During pre-training, in contrast to conventional approaches that add visual tokens to a text backbone at a late stage [8, 21], we find early vision fusion with lower ratios tends to yield better results given the fixed total vision-text tokens. Therefore, K2.5 mixes text and vision tokens with a constant ratio throughout the entire training process.

**文本与视觉的联合优化。** K2.5 实践中的一个关键洞察是,文本与视觉的联合优化能够增强两种模态并避免冲突。具体而言,我们为此设计了一套技术。在预训练期间,与在晚期阶段将视觉 token 添加到文本主干上的传统方法 [8, 21] 不同,我们发现,在固定的总视觉-文本 token 量下,早期以较低比例融合视觉往往能产生更好的结果。因此,K2.5 在整个训练过程中以恒定比例混合文本和视觉 token。

Architecturally, Kimi K2.5 employs MoonViT-3D, a native-resolution vision encoder incorporating the NaViT packing strategy [15], enabling variable-resolution image inputs. For video understanding, we introduce a lightweight 3D ViT compression mechanism: consecutive frames are grouped in fours, processed through the shared MoonViT encoder, and temporally averaged at the patch level. This design allows Kimi K2.5 to process videos up to 4x longer within the same context window while maintaining complete weight sharing between image and video encoders.

架构上,Kimi K2.5 采用 MoonViT-3D,一种原生分辨率视觉编码器,整合了 NaViT packing 策略 [15],支持可变分辨率图像输入。对于视频理解,我们引入了一种轻量级 3D ViT 压缩机制: 连续帧按四个一组进行分组,通过共享的 MoonViT 编码器处理,并在 patch 级别进行时序平均。这一设计使 Kimi K2.5 能够在相同上下文窗口内处理长达 4 倍的视频,同时保持图像和视频编码器之间的完全权重共享。

During post-training, we introduce zero-vision SFT -- text-only SFT alone activates visual reasoning and tool use. We find that adding human-designed visual trajectories at this stage hurts generalization. In contrast, text-only SFT performs better -- likely because joint pretraining already establishes strong vision-text alignment, enabling capabilities to generalize naturally across modalities. We then apply joint RL on both text and vision tasks. Crucially, we find visual RL enhances textual performance rather than degrading it, with improvements on MMLU-Pro and GPQA-Diamond. This bidirectional enhancement -- text bootstraps vision, vision refines text -- represents superior cross-modal alignment in joint training.

在后训练阶段,我们引入了零视觉 SFT -- 仅文本 SFT 就能激活视觉推理和工具使用。我们发现,在这个阶段添加人工设计的视觉轨迹会损害泛化能力。相比之下,纯文本 SFT 表现更好 -- 这可能是因为联合预训练已经建立了强大的视觉-文本对齐,使能力能够自然地跨模态泛化。然后我们在文本和视觉任务上应用联合 RL。关键的是,我们发现视觉 RL 增强而非降低了文本性能,在 MMLU-Pro 和 GPQA-Diamond 上都有提升。这种双向增强 -- 文本引导视觉,视觉精炼文本 -- 代表了联合训练中卓越的跨模态对齐。

> 译者注(数据实验): "零视觉 SFT"是一个值得深入思考的发现。传统多模态模型的后训练通常需要大量配对的视觉-文本数据(如图像-描述对、视频-字幕对),而 K2.5 发现这反而是不必要的,甚至可能有害。1) 这说明预训练阶段的联合优化已经足够强大,后训练只需要"解锁"这些能力,而非重新学习;2) 人工设计的视觉轨迹可能过于局限(例如特定格式的标注),限制了模型在开放视觉场景中的泛化;3) 这一发现对数据工程有重大意义: 视觉数据的标注成本远高于文本,如果纯文本 SFT 就能激活视觉能力,将大幅降低多模态模型的训练成本。

**Agent Swarm: Parallel Agent Orchestration.** Most existing agentic models rely on sequential execution of tool calls. Even systems capable of hundreds of reasoning steps, such as Kimi K2-Thinking [1], suffer from linear scaling of inference time, leading to unacceptable latency and limiting task complexity. As agentic workloads grow in scope and heterogeneity -- e.g., building a complex project that involves massive-scale research, design, and development -- the sequential paradigm becomes increasingly inefficient.

**Agent Swarm: 并行智能体编排。** 大多数现有智能体模型依赖顺序执行工具调用。即使是能够执行数百步推理的系统,如 Kimi K2-Thinking [1],也受推理时间线性扩展的困扰,导致不可接受的延迟并限制了任务复杂度。随着智能体工作负载在范围和异构性上的增长 -- 例如,构建一个涉及大规模研究、设计和开发的复杂项目 -- 顺序范式变得越来越低效。

To overcome the latency and scalability limits of sequential agent execution, Kimi K2.5 introduces Agent Swarm, a dynamic framework for parallel agent orchestration. We propose a Parallel-Agent Reinforcement Learning (PARL) paradigm that departs from traditional agentic RL [2]. In addition to optimizing tool execution via verifiable rewards, the model is equipped with interfaces for sub-agent creation and task delegation. During training, sub-agents are frozen and their execution trajectories are excluded from the optimization objective; only the orchestrator is updated via reinforcement learning. This decoupling circumvents two challenges of end-to-end co-optimization: credit assignment ambiguity and training instability. Agent Swarm enables complex tasks to be decomposed into heterogeneous sub-problems and executed concurrently, reducing latency by up to 4.5x compared to single-agent baselines.

为克服顺序智能体执行的延迟和可扩展性限制,Kimi K2.5 引入了 Agent Swarm,一种动态并行智能体编排框架。我们提出了 Parallel-Agent Reinforcement Learning (PARL, 并行智能体强化学习)范式,区别于传统智能体 RL [2]。除了通过可验证奖励优化工具执行外,模型还配备了子智能体创建和任务委托的接口。在训练期间,子智能体被冻结,其执行轨迹被排除在优化目标之外;仅编排器通过强化学习更新。这种解耦规避了端到端联合优化的两个挑战: 信用分配模糊性和训练不稳定性。Agent Swarm 使复杂任务能够分解为异构子问题并并发执行,与单智能体基线相比延迟降低高达 4.5 倍。

> 译者注(架构细节): Agent Swarm 的设计包含几个关键的工程决策。1) "子智能体冻结"策略至关重要: 如果子智能体也参与梯度更新,信用分配问题会变得极其复杂(哪个子智能体对最终结果贡献了多少?),这是多智能体 RL 中的经典难题;2) 将子智能体输出视为"环境观察"而非可微决策点,简化了训练目标,但要求子智能体本身已经足够可靠 -- 这解释了为什么 K2.5 先训练强大的单智能体基线,再在此基础上构建 Swarm;3) 4.5 倍延迟降低来自 Amdahl 定律的乐观估计: 只有当任务能够充分并行化(分解为大量独立子任务)时才能达到这一上限,对于本质串行的任务(如依赖前一步结果的递归推理),加速比会显著降低。


## 2 Joint Optimization of Text and Vision
### 文本与视觉的联合优化

Kimi K2.5 is a native multimodal model built upon Kimi K2 through large-scale joint pre-training on approximately 15 trillion mixed visual and text tokens. Unlike vision-adapted models that compromise either linguistic or visual capabilities, our joint pre-training paradigm enhances both modalities simultaneously. This section describes the multimodal joint optimization methodology that extends Kimi K2 to Kimi K2.5.

Kimi K2.5 是一个原生多模态模型,通过在约 15 万亿混合视觉和文本 token 上进行大规模联合预训练,基于 Kimi K2 构建而成。与在语言或视觉能力上有所妥协的视觉适配模型不同,我们的联合预训练范式同时增强两种模态。本节描述了将 Kimi K2 扩展为 Kimi K2.5 的多模态联合优化方法。

### 2.1 Native Multimodal Pre-Training
#### 原生多模态预训练

A key design question for multimodal pre-training is: Given a fixed vision-text token budget, what is the optimal vision-text joint-training strategy. Conventional wisdom [8, 21] suggests introducing vision tokens predominantly in the later stages of LLM training at high ratios (e.g., 50% or higher) should accelerate multimodal capability acquisition, treating multimodal capability as a post-hoc add-on to linguistic competence.

多模态预训练的一个关键设计问题是: 在固定的视觉-文本 token 预算下,最优的视觉-文本联合训练策略是什么。传统观点 [8, 21] 认为,在 LLM 训练的后期阶段以高比例(如 50% 或更高)引入视觉 token 应该加速多模态能力获取,将多模态能力视为语言能力的事后附加组件。

However, our experiments (as shown in Table 1) reveal a different story. We conducted ablation studies varying the vision ratio and vision injection timing while keeping the total vision and text token budgets fixed. To strictly meet the targets for different ratios, we pre-trained the model with text-only tokens for a specifically calculated number of tokens before introducing vision data. Surprisingly, we found that the vision ratio has minimal impact on final multimodal performance. In fact, early fusion with a lower vision ratio yields better results given a fixed total vision-text token budget. This motivates our native multimodal pre-training strategy: rather than aggressive vision-heavy training concentrated at the end, we adopt a moderate vision ratio integrated early in the training process, allowing the model to naturally develop balanced multimodal representations while benefiting from extended co-optimization of both modalities.

然而,我们的实验(如表 1 所示)揭示了一个不同的故事。我们在保持总视觉和文本 token 预算固定的同时,进行了改变视觉比例和视觉注入时机的消融研究。为严格满足不同比例的目标,我们在引入视觉数据之前,用纯文本 token 对模型预训练了特定计算数量的 token。令人惊讶的是,我们发现视觉比例对最终多模态性能的影响极小。事实上,在固定的总视觉-文本 token 预算下,早期以较低比例融合视觉反而产生更好的结果。这启发了我们的原生多模态预训练策略: 而非集中在末期进行激进的视觉密集型训练,我们在训练早期就整合适度的视觉比例,使模型能够自然发展平衡的多模态表征,同时受益于两种模态的长期联合优化。

**Table 1: Performance comparison across different vision-text joint-training strategies. Early fusion with a lower vision ratio yields better results given a fixed total vision-text token budget.**

**表 1: 不同视觉-文本联合训练策略的性能对比。在固定的总视觉-文本 token 预算下,早期以较低比例融合视觉产生更好的结果。**

| Vision Injection Timing | Vision-Text Ratio | Vision Knowledge | Vision Reasoning | OCR | Text Knowledge | Text Reasoning | Code |
|------------------------|-------------------|-----------------|------------------|-----|---------------|----------------|------|
| Early | 10%:90% | 25.8 | 43.8 | 65.7 | 45.5 | 58.5 | 24.8 |
| Mid | 20%:80% | 25.0 | 40.7 | 64.1 | 43.9 | 58.6 | 24.0 |
| Late | 50%:50% | 24.2 | 39.0 | 61.5 | 43.1 | 57.8 | 24.0 |

> 译者注(数据可信度): 表 1 的消融结果揭示了一个反直觉的结论: 视觉比例越低,整体性能越好。1) 这直接挑战了"多模态能力需要大量视觉数据"的业界共识;2) 一个可能的解释是,视觉数据的信息密度远低于文本(一张图像可能只包含几十个"有效信息单元",而同等 token 量的文本包含数百个),因此过高的视觉比例实际上稀释了模型的语言基础能力;3) 但需要注意,这个实验是在"固定总预算"前提下进行的,如果总预算不受限,增加视觉数据仍可能提升视觉专项能力;4) 实验设计的一个潜在问题是,Early/Mid/Late 的划分标准没有精确定义(具体是在多少步注入?),这影响了结果的可复现性。

### 2.2 Zero-Vision SFT
#### 零视觉 SFT

Pretrained VLMs do not naturally perform vision-based tool-calling, which poses a cold-start problem for multimodal RL. Conventional approaches address this issue through manually annotated or prompt-engineered chain-of-thought (CoT) data [8], but such methods are limited in diversity, often restricting visual推理 to simple diagrams and primitive tool manipulations (crop, rotate, flip).

预训练的 VLM 不会自然地执行基于视觉的工具调用,这给多模态 RL 带来了冷启动问题。传统方法通过人工标注或提示工程的思维链(CoT)数据 [8] 来解决这一问题,但这类方法多样性有限,往往将视觉推理限制在简单图表和原始工具操作(裁剪、旋转、翻转)上。

An observation is that high-quality text SFT data are relatively abundant and diverse. We propose a novel approach, zero-vision SFT, that uses only text SFT data to activate the visual, agentic capabilities during post-training. In this approach, all image manipulations are proxied through programmatic operations in IPython, effectively serving as a generalization of traditional vision tool-use. This "zero-vision" activation enables diverse reasoning behaviors, including pixel-level operations such as object size estimation via binarization and counting, and generalizes to visually grounded tasks such as object localization, counting, and OCR.

一个观察是,高质量的文本 SFT 数据相对丰富且多样。我们提出了一种新方法 -- 零视觉 SFT,仅使用文本 SFT 数据来激活后训练期间的视觉和智能体能力。在这种方法中,所有图像操作都通过 IPython 中的程序化操作来代理,有效地充当了传统视觉工具使用的泛化。这种"零视觉"激活实现了多样化的推理行为,包括像素级操作(如通过二值化和计数进行物体大小估计),并泛化到视觉基础任务,如物体定位、计数和 OCR。

Figure 2 illustrates the RL training curves, where the starting points are obtained from zero-vision SFT. The results show that zero-vision SFT is sufficient for activating vision capabilities while ensuring generalization across modalities. This phenomenon is likely due to the joint pretraining of text and vision data as described in Section 2.1. Compared to zero-vision SFT, our preliminary experiments show that text-vision SFT yields much worse performance on visual, agentic tasks, possibly because of the lack of high-quality vision data.

图 2 展示了 RL 训练曲线,其中起点来自零视觉 SFT。结果表明,零视觉 SFT 足以激活视觉能力,同时确保跨模态泛化。这一现象可能是由于第 2.1 节所述的文本和视觉数据的联合预训练。与零视觉 SFT 相比,我们的初步实验显示,文本-视觉 SFT 在视觉和智能体任务上表现差得多,可能是由于缺乏高质量的视觉数据。

> 译者注(设计动机): 零视觉 SFT 的核心洞察非常深刻。1) 它将"视觉工具调用"重新定义为"文本代码生成": 模型不需要"看到"图像,而是生成操作图像的 Python 代码(bin2img、count_objects 等),这些代码在沙箱中执行后返回文本结果;2) 这种"代码即工具"的方法巧妙地规避了视觉数据稀缺的问题 -- 文本代码数据远比配对的视觉-动作数据丰富;3) 但这种方法也有局限: 它适用于可以程序化的视觉任务(OCR、计数、尺寸测量),但对需要语义理解的视觉任务(如"这张图片表达了什么情感?")可能效果有限;4) 图 2 显示,从零视觉 SFT 出发,随着视觉 RL FLOPs 的扩展,性能持续提升,这说明零视觉 SFT 提供的只是一个"启动信号",真正的视觉能力来自后续的 RL 精炼。

### 2.3 Joint Multimodal Reinforcement Learning (RL)
#### 联合多模态强化学习

In this section, we describe the methodology implemented in K2.5 that enables effective multimodal RL, from outcome-based visual RL to emergent cross-modal transfer that enhances textual performance.

在本节中,我们描述了 K2.5 中实现的有效多模态 RL 方法,从基于结果的视觉 RL 到增强文本性能的涌现跨模态迁移。

**Outcome-Based Visual RL.** Following the zero-vision SFT, the model requires further refinement to reliably incorporate visual inputs into reasoning. Text-initiated activation alone exhibits notable failure modes: visual inputs are sometimes ignored, and images may not be attended to when necessary. We employ outcome-based RL on tasks that explicitly require visual comprehension for correct solutions. We categorize these tasks into three domains:

**基于结果的视觉 RL。** 在零视觉 SFT 之后,模型需要进一步精炼以可靠地将视觉输入纳入推理。仅靠文本启动的激活表现出显著的失效模式: 视觉输入有时被忽略,图像在必要时可能未被关注。我们在明确要求视觉理解才能正确解决的任务上采用基于结果的 RL。我们将这些任务分为三个领域:

- Visual grounding and counting: Accurate localization and enumeration of objects within images;
- Chart and document understanding: Interpretation of structured visual information and text extraction;
- Vision-critical STEM problems: Mathematical and scientific questions filtered to require visual inputs.

- 视觉定位和计数: 图像中物体的准确定位和枚举;
- 图表和文档理解: 结构化视觉信息的解释和文本提取;
- 视觉关键型 STEM 问题: 筛选出的需要视觉输入的数学和科学问题。

Outcome-based RL on these tasks improves both basic visual capabilities and more complex agentic behaviors. Extracting these trajectories for rejection-sampling fine-tuning (RFT) enables a self-improving data pipeline, allowing subsequent joint RL stages to leverage richer multimodal reasoning traces.

在这些任务上的基于结果 RL 既提升了基本视觉能力,也提升了更复杂的智能体行为。提取这些轨迹用于拒绝采样微调(RFT)实现了自我改进的数据流水线,使后续联合 RL 阶段能够利用更丰富的多模态推理轨迹。

**Visual RL Improves Text Performance.** To investigate potential trade-offs between visual and textual performance, we evaluated text-only benchmarks before and after visual RL. Surprisingly, outcome-based visual RL produced measurable improvements in textual tasks, including MMLU-Pro (84.7% -> 86.4%), GPQA-Diamond (84.3% -> 86.4%), and LongBench v2 (56.7% -> 58.9%) (Table 2). Analysis suggests that visual RL enhances calibration in areas requiring structured information extraction, reducing uncertainty on queries that resemble visually grounded reasoning (e.g., counting, OCR). These findings indicate that visual RL can contribute to cross-modal generalization, improving textual reasoning without observable degradation of language capabilities.

**视觉 RL 提升文本性能。** 为调查视觉和文本性能之间的潜在权衡,我们在视觉 RL 前后评估了纯文本基准。令人惊讶的是,基于结果的视觉 RL 在文本任务上产生了可测量的改进,包括 MMLU-Pro (84.7% -> 86.4%)、GPQA-Diamond (84.3% -> 86.4%) 和 LongBench v2 (56.7% -> 58.9%)(表 2)。分析表明,视觉 RL 增强了需要结构化信息提取领域的校准,减少了类似视觉基础推理查询(如计数、OCR)的不确定性。这些发现表明,视觉 RL 可以促进跨模态泛化,在不观察到语言能力退化的情况下改善文本推理。

**Table 2: Cross-Modal Transfer: Vision RL Improves Textual Knowledge**

**表 2: 跨模态迁移: 视觉 RL 提升文本知识**

| Benchmark | Before Vision-RL | After Vision-RL | Improvement |
|-----------|-----------------|-----------------|-------------|
| MMLU-Pro | 84.7 | 86.4 | +1.7 |
| GPQA-Diamond | 84.3 | 86.4 | +2.1 |
| LongBench v2 | 56.7 | 58.9 | +2.2 |

> 译者注(技术谱系): 表 2 的发现 -- 视觉 RL 提升文本性能 -- 与深度学习史上的一个经典现象呼应: 多任务学习中的"正向迁移"。1) 从机制上看,视觉 RL 可能强化了模型对"结构化信息"的提取能力(如从图表中提取数据、从文档中定位关键段落),这种能力同样适用于纯文本场景(如从长文档中提取关键事实);2) 这与 K2 技术报告中提到的"联合 RL 框架"一脉相承: K2 的 RL 同时优化可验证奖励(数学、代码)和自批评评分(通用质量),K2.5 则将这一理念扩展到视觉-文本联合优化;3) 一个有趣的对比是,传统计算机视觉中的"预训练-微调"范式通常发现视觉预训练对 NLP 任务帮助有限,但 K2.5 的联合训练表明,当两种模态在足够深的层次上共享表示空间时,跨模态迁移可以非常显著。

**Joint Multimodal RL.** Motivated by the finding that robust visual capabilities can emerge from zero-vision SFT paired with vision RL -- which further enhances general text abilities -- we adopt a joint multimodal RL paradigm during Kimi K2.5's post-training. Departing from conventional modality-specific expert divisions, we organize RL domains not by input modality but by abilities -- knowledge, reasoning, coding, agentic, etc. These domain experts jointly learn from both pure-text and multimodal queries, while the Generative Reward Model (GRM) similarly optimizes across heterogeneous traces without modality barriers. This paradigm ensures that capability improvements acquired through either textual or visual inputs inherently generalize to enhance related abilities across the alternate modality, thereby maximizing cross-modal capability transfer.

**联合多模态 RL。** 受 robust 视觉能力可以从零视觉 SFT 配合视觉 RL 中涌现 -- 这进一步增强了通用文本能力 -- 这一发现的启发,我们在 Kimi K2.5 的后训练中采用了联合多模态 RL 范式。与传统按模态划分的专家分工不同,我们按能力而非输入模态来组织 RL 领域 -- 知识、推理、编程、智能体等。这些领域专家从纯文本和多模态查询中联合学习,而生成式奖励模型(GRM)同样在无模态壁垒的异构轨迹上进行优化。这一范式确保通过文本或视觉输入获得的能力改进内在地泛化到增强另一模态的相关能力,从而最大化跨模态能力迁移。


## 3 Agent Swarm
### Agent Swarm

The primary challenge of existing agent-based systems lies in their reliance on sequential execution of reasoning and tool-calling steps. While this structure may be effective for simpler, short-horizon tasks, it becomes inadequate as the complexity of the task increases and the accumulated context grows. As tasks evolve to contain broad information gathering and intricate, multi-branch reasoning, sequential systems often encounter significant bottlenecks [5, 6, 7].

现有基于智能体的系统的主要挑战在于它们依赖顺序执行推理和工具调用步骤。虽然这种结构对于较简单的短程任务可能有效,但随着任务复杂度增加和累积上下文增长,它变得不再适用。随着任务演变为包含广泛信息收集和复杂多分支推理,顺序系统经常遇到显著的瓶颈 [5, 6, 7]。

The limited capacity of a single agent working through each step one by one can lead to the exhaustion of practical reasoning depth and tool-call budgets, ultimately hindering the system's ability to handle more complex scenarios. To address this, we introduce Agent Swarm and Parallel Agent Reinforcement Learning (PARL). Instead of executing a task as a reasoning chain or relying on pre-specified parallelization heuristics, K2.5 initiates an Agent Swarm through dynamic task decomposition, subagent instantiation, and parallel subtask scheduling. Importantly, parallelism is not presumed to be inherently advantageous; decisions regarding whether, when, and how to parallelize are explicitly learned through environmental feedback and RL-driven exploration. As shown in Figure 4, the progression of performance demonstrates this adaptive capability, with the cumulative reward increasing smoothly as the orchestrator optimizes its parallelization strategy throughout training.

单个智能体一步一步处理每个步骤的有限能力可能导致实际推理深度和工具调用预算的耗尽,最终阻碍系统处理更复杂场景的能力。为解决此问题,我们引入了 Agent Swarm 和 Parallel Agent Reinforcement Learning (PARL)。K2.5 不是将任务执行为推理链或依赖预指定的并行化启发式规则,而是通过动态任务分解、子智能体实例化和并行子任务调度来启动 Agent Swarm。重要的是,并行性并非被假定为天生有利; 关于是否、何时以及如何并行的决策是通过环境反馈和 RL 驱动的探索显式学习的。如图 4 所示,性能的进展展示了这种自适应能力,随着编排器在训练过程中优化其并行化策略,累积奖励平稳增加。

**Architecture and Learning Setup.** The PARL framework adopts a decoupled architecture comprising a trainable orchestrator and frozen subagents instantiated from fixed intermediate policy checkpoints. This design deliberately avoids end-to-end co-optimization to circumvent two fundamental challenges: credit assignment ambiguity and training instability. In this multi-agent setting, outcome-based rewards are inherently sparse and noisy; a correct final answer does not guarantee flawless subagent execution, just as a failure does not imply universal subagent error. By freezing the subagents and treating their outputs as environmental observations rather than differentiable decision points, we disentangle high-level coordination logic from low-level execution proficiency, leading to more robust convergence. To improve efficiency, we first train the orchestrator using small-size subagents before transitioning to larger models. Our RL framework also supports dynamically adjusting the inference instance ratios between subagents and the orchestrator, thereby maximizing the resource usage across the cluster.

**架构与学习设置。** PARL 框架采用解耦架构,包含一个可训练的编排器和从固定中间策略检查点实例化的冻结子智能体。这一设计刻意避免端到端联合优化,以规避两个根本性挑战: 信用分配模糊性和训练不稳定性。在这种多智能体设置中,基于结果的奖励本质上是稀疏且嘈杂的; 正确的最终答案不能保证子智能体执行完美,正如失败不意味着所有子智能体都出错。通过冻结子智能体并将其输出视为环境观察而非可微决策点,我们将高层协调逻辑与低层执行能力解耦,实现更稳健的收敛。为提高效率,我们首先使用小型子智能体训练编排器,然后再过渡到更大的模型。我们的 RL 框架还支持动态调整子智能体和编排器之间的推理实例比例,从而最大化集群间的资源利用。

**PARL Reward.** Training a reliable parallel orchestrator is challenging due to the delayed, sparse, and non-stationary feedback inherent in independent subagent execution. To address this, we define the PARL reward as:

**PARL 奖励。** 由于独立子智能体执行中固有的延迟、稀疏和非平稳反馈,训练可靠的并行编排器具有挑战性。为解决此问题,我们将 PARL 奖励定义为:

$$
r_{PARL}(x, y) = \lambda_1 \cdot \underbrace{r_{parallel}}_{\text{instantiation reward}} + \lambda_2 \cdot \underbrace{r_{finish}}_{\text{sub-agent finish rate}} + \underbrace{r_{perf}(x, y)}_{\text{task-level outcome}}.
$$

The performance reward $r_{perf}$ evaluates the overall success and quality of the solution $y$ for a given task $x$. This is augmented by two auxiliary rewards, each addressing a distinct challenge in learning parallel orchestration. The reward $r_{parallel}$ is introduced to mitigate serial collapse -- a local optimum where the orchestrator defaults to single-agent execution. By incentivizing subagent instantiation, this term encourages the exploration of concurrent scheduling spaces. The $r_{finish}$ reward focuses on the successful completion of assigned subtasks. It is used to prevent spurious parallelism, a reward-hacking behavior in which the orchestrator increases parallel metrics dramatically by spawning many subagents without meaningful task decomposition. By rewarding completed subtasks, $r_{finish}$ enforces feasibility and guides the policy toward valid and effective decompositions. To ensure the final policy optimizes for the primary objective, the hyperparameters $\lambda_1$ and $\lambda_2$ are annealed to zero over the course of training.

性能奖励 $r_{perf}$ 评估给定任务 $x$ 的解决方案 $y$ 的整体成功和质量。这通过两个辅助奖励进行增强,每个奖励解决学习并行编排中的一个 distinct 挑战。奖励 $r_{parallel}$ 旨在缓解串行崩溃 -- 一种编排器默认退化为单智能体执行的局部最优。通过激励子智能体实例化,这一项鼓励探索并发调度空间。$r_{finish}$ 奖励关注分配子任务的成功完成。它用于防止虚假并行性,一种奖励黑客行为,其中编排器通过生成大量子智能体而无意义地分解任务来急剧增加并行指标。通过奖励已完成的子任务,$r_{finish}$ 强制执行可行性并引导策略走向有效且有效的分解。为确保最终策略优化主要目标,超参数 $\lambda_1$ 和 $\lambda_2$ 在训练过程中退火至零。

> 译者注(工程细节): PARL 的奖励设计是一个精妙的工程平衡。1) 三个奖励项分别解决三个不同的问题: $r_{perf}$ 保证最终质量,$r_{parallel}$ 防止退化为单智能体,$r_{finish}$ 防止无意义的过度并行;2) "退火至零"策略至关重要: 在训练早期,辅助奖励帮助探索并行策略空间,但随着训练进行,模型应逐渐依赖任务级结果奖励,避免对辅助奖励的过度拟合;3) "冻结子智能体"意味着子智能体的策略是固定的,只有编排器的策略被更新 -- 这大大简化了信用分配问题,但要求子智能体本身已经足够可靠;4) 公式中的 $x$ 和 $y$ 分别代表任务和解决方案,这与标准 RL 中的(state, action)范式略有不同,因为这里的"动作"是整个任务的分解和执行策略。

**Critical Steps as Resource Constraint.** To measure computational time cost in a parallel-agent setting, we define critical steps by analogy to the critical path in a computation graph. We model an episode as a sequence of execution stages indexed by $t = 1, ..., T$. In each stage, the main agent executes an action, which corresponds to either direct tool invocation or the instantiation of a group of subagents running in parallel. Let $S_{main}^{(t)}$ denote the number of steps taken by the main agent in stage $t$ (typically $S_{main}^{(t)} = 1$), and $S_{sub,i}^{(t)}$ denote the number of steps taken by the $i$-th subagent in that parallel group. The duration of stage $t$ is governed by the longest-running subagent within that cohort. Consequently, the total critical steps for an episode are defined as

**关键步骤作为资源约束。** 为衡量并行智能体设置中的计算时间成本,我们通过类比计算图中的关键路径来定义关键步骤。我们将一个 episode 建模为按 $t = 1, ..., T$ 索引的执行阶段序列。在每个阶段,主智能体执行一个动作,对应于直接工具调用或实例化一组并行运行的子智能体。令 $S_{main}^{(t)}$ 表示主智能体在阶段 $t$ 中采取的步骤数(通常 $S_{main}^{(t)} = 1$),$S_{sub,i}^{(t)}$ 表示该并行组中第 $i$ 个子智能体采取的步骤数。阶段 $t$ 的持续时间由该组中最长的子智能体决定。因此,一个 episode 的总关键步骤定义为

$$
\text{CriticalSteps} = \sum_{t=1}^{T} \left( S_{main}^{(t)} + \max_i S_{sub,i}^{(t)} \right).
$$

By constraining training and evaluation using critical steps rather than total steps, the framework explicitly incentivizes effective parallelization. Excessive subtask creation that does not reduce the maximum execution time of parallel groups yields little benefit under this metric, while well-balanced task decomposition that shortens the longest parallel branch directly reduces critical steps. As a result, the orchestrator is encouraged to allocate work across subagents in a way that minimizes end-to-end latency, rather than merely maximizing concurrency or total work performed.

通过使用关键步骤而非总步骤来约束训练和评估,框架显式地激励有效并行化。不减少并行组最大执行时间的过度子任务创建在此指标下收益甚微,而缩短最长并行分支的均衡任务分解直接减少关键步骤。因此,编排器被鼓励以最小化端到端延迟的方式在子智能体间分配工作,而非仅仅最大化并发度或总工作量。

> 译者注(架构细节): "关键步骤"的定义直接借鉴了项目管理中的关键路径法(CPM),这是将运筹学思想引入 RL 奖励设计的巧妙案例。1) 关键步骤公式中的 $\max_i S_{sub,i}^{(t)}$ 体现了 Amdahl 定律: 并行加速比受限于最慢的子任务;2) 这一指标直接惩罚"虚假并行" -- 如果一个编排器将任务分解为 10 个子任务,但 9 个在 1 步内完成而 1 个需要 100 步,关键步骤只计 101 步,而非 110 步;3) 与直接使用" wall-clock time"不同,关键步骤是抽象的计算单位,使奖励与具体硬件无关,便于在不同集群间迁移;4) 但这里有一个隐含假设: 子智能体之间没有通信开销。在真实系统中,子智能体间的协调(如共享状态、结果聚合)也会消耗时间,这部分未被纳入关键步骤计算。

**Prompt Construction for Parallel-agent Capability Induction.** To incentivize the orchestrator to leverage the advantages of parallelization, we construct a suite of synthetic prompts designed to stress the limits of sequential agentic execution. These prompts emphasize either wide search, requiring simultaneous exploration of many independent information sources, or deep search, requiring multiple reasoning branches with delayed aggregation. We additionally include tasks inspired by real-world workloads, such as long-context document analysis and large-scale file downloading. When executed sequentially, these tasks are difficult to complete within fixed reasoning-step and tool-call budgets. By construction, they encourage the orchestrator to allocate subtasks in parallel, enabling completion within fewer critical steps than would be feasible for a single sequential agent. Importantly, the prompts do not explicitly instruct the model to parallelize. Instead, they shape the task distribution such that parallel decomposition and scheduling strategies are naturally favored.

**用于并行智能体能力诱导的提示构建。** 为激励编排器利用并行化的优势,我们构建了一套合成提示,旨在挑战顺序智能体执行的极限。这些提示强调广度搜索(需要同时探索许多独立信息源)或深度搜索(需要多条推理分支并延迟聚合)。我们还额外包含了受真实工作负载启发的任务,如长上下文文档分析和大规模文件下载。当顺序执行时,这些任务难以在固定的推理步骤和工具调用预算内完成。通过构造,它们鼓励编排器并行分配子任务,使其能够在比单顺序智能体更少的临界步骤内完成。重要的是,提示并不显式指示模型并行化。相反,它们塑造任务分布,使并行分解和调度策略自然受到青睐。


## 4 Method Overview
### 方法概述

### 4.1 Foundation: Kimi K2 Base Model
#### 基础: Kimi K2 基座模型

The foundation of Kimi K2.5 is Kimi K2 [53], a trillion-parameter mixture-of-experts (MoE) transformer [59] model pre-trained on 15 trillion high-quality text tokens. Kimi K2 employs the token-efficient MuonClip optimizer [30, 34] with QK-Clip for training stability. The model comprises 1.04 trillion total parameters with 32 billion activated parameters, utilizing 384 experts with 8 activated per token (sparsity of 48). For detailed descriptions of MuonClip, architecture design, and training infrastructure, we refer to the Kimi K2 technical report [53].

Kimi K2.5 的基础是 Kimi K2 [53],一个万亿参数混合专家(MoE)Transformer [59] 模型,在 15 万亿高质量文本 token 上预训练。Kimi K2 采用 token 高效的 MuonClip 优化器 [30, 34] 配合 QK-Clip 以保证训练稳定性。模型包含 1.04 万亿总参数和 320 亿激活参数,利用 384 个专家,每个 token 激活 8 个(稀疏度 48)。关于 MuonClip、架构设计和训练基础设施的详细描述,请参阅 Kimi K2 技术报告 [53]。

**Table 3: Overview of training stages: data composition, token volumes, sequence lengths, and trainable components.**

**表 3: 训练阶段概览: 数据组成、token 量、序列长度和可训练组件。**

| Stages | Data | Sequence Length | Tokens | Training |
|--------|------|-----------------|--------|----------|
| ViT Training | Alt text, Synthesis Caption, Grounding, OCR, Video | 4096 | 1T | ViT |
| Joint Pre-training | Text, Knowledge, Interleaving, Video, OS Screenshot + High-quality Text & Multimodal | 4096 | 15T | ViT & LLM |
| Joint Long-context Mid-training | Long Text, Long Video, Reasoning, Long-CoT | 32768->262144 | 500B->200B | ViT & LLM |

> 译者注(工程细节): 表 3 的训练管线设计有几个值得注意的工程决策。1) 三阶段渐进式训练是行业主流做法,但 K2.5 的独特之处在于"联合" -- ViT 和 LLM 始终同时训练,而非先训 ViT 再冻结;2) 长上下文 mid-training 的序列长度从 32K 扩展到 262K,但 token 量从 500B 降到 200B,说明长序列训练的计算成本极高(注意力复杂度为 O(n^2));3) "High-quality Text & Multimodal"在 joint pre-training 阶段被强调,这与 2.1 节的发现一致: 早期以较低视觉比例融合高质量文本数据能产生更好的多模态基础;4) ViT 训练阶段使用 1T token 但仅训练 ViT,这是将 SigLIP 对齐到 K2 语义空间的关键步骤。

### 4.2 Model Architecture
#### 模型架构

The multimodal architecture of Kimi K2.5 consists of three components: a three-dimensional native-resolution vision encoder (MoonViT-3D), an MLP projector, and the Kimi K2 MoE language model, following the design principles established in Kimi-VL [54].

Kimi K2.5 的多模态架构包含三个组件: 一个三维原生分辨率视觉编码器(MoonViT-3D)、一个 MLP 投影器和 Kimi K2 MoE 语言模型,遵循 Kimi-VL [54] 中确立的设计原则。

**MoonViT-3D: Shared Embedding Space for Images and Videos.** In Kimi-VL, we employ MoonViT to natively process images at their original resolutions, eliminating the need for complex sub-image splitting and splicing operations. Initialized from SigLIP-SO-400M [77], MoonViT incorporates the patch packing strategy from NaViT [15], where single images are divided into patches, flattened, and sequentially concatenated into 1D sequences, thereby enabling efficient simultaneous training on images at varying resolutions.

**MoonViT-3D: 图像与视频的共享嵌入空间。** 在 Kimi-VL 中,我们采用 MoonViT 以原生分辨率处理图像,消除了复杂子图像拆分和拼接操作的需要。MoonViT 从 SigLIP-SO-400M [77] 初始化,整合了 NaViT [15] 的 patch packing 策略,其中单张图像被划分为 patch,展平并顺序拼接为 1D 序列,从而能够对可变分辨率图像进行高效同步训练。

To maximize the transfer of image understanding capabilities to video, we introduce MoonViT-3D with a unified architecture, fully shared parameters, and a consistent embedding space. By generalizing the "patch n' pack" philosophy to the temporal dimension, up to four consecutive frames are treated as a spatiotemporal volume: 2D patches from these frames are jointly flattened and packed into a single 1D sequence, allowing the identical attention mechanism to operate seamlessly across both space and time. While the extra temporal attention improves understanding on high-speed motions and visual effects, the sharing maximizes knowledge generalization from static images to dynamic videos, achieving strong video understanding performance (see in Tab. 4) without requiring specialized video modules or architectural bifurcation. Prior to the MLP projector, lightweight temporal pooling aggregates patches within each temporal chunk, yielding 4x temporal compression to significantly extend feasible video length. The result is a unified pipeline where knowledge and ability obtained from image pretraining transfers holistically to videos through one shared parameter space and feature representation.

为最大化图像理解能力向视频的迁移,我们引入了 MoonViT-3D,具有统一架构、完全共享的参数和一致的嵌入空间。通过将"patch n' pack"理念推广到时序维度,最多四个连续帧被视为一个时空体: 这些帧的 2D patch 被联合展平并打包为单个 1D 序列,使相同的注意力机制能够在空间和时间上无缝运行。虽然额外的时间注意力改善了对高速运动和视觉效果的理解,但共享最大化了从静态图像到动态视频的知识泛化,实现了强大的视频理解性能(见表 4),而无需专门的视频模块或架构分叉。在 MLP 投影器之前,轻量级时间池化在每个时间块内聚合 patch,产生 4 倍时间压缩,显著延长可行的视频长度。结果是一个统一的流水线,图像预训练获得的知识和能力通过共享的参数空间和特征表示整体迁移到视频。

> 译者注(设计动机): MoonViT-3D 的设计体现了"统一优于专用"的工程哲学。1) 传统视频理解模型通常采用双分支架构(图像编码器 + 视频编码器),但 K2.5 通过"时空 patch packing"实现了单编码器统一处理,这大幅降低了模型复杂度;2) "4 倍时间压缩"是关键: 将 4 帧打包为 1 个"超级帧",注意力计算量降低为 1/4,这使 262K 上下文窗口能够处理更长的视频;3) 但这里有一个工程权衡: 时序池化会丢失帧间细粒度运动信息,对于需要精确动作识别的任务(如体育运动分析)可能不够;4) 完全权重共享意味着图像和视频的能力是"绑定"的 -- 提升图像理解也会提升视频理解,反之亦然,这与 2.1 节的"联合优化"理念一致。

### 4.3 Pre-training Pipeline
#### 预训练流水线

As illustrated in Table 3, Kimi K2.5's pre-training builds upon the Kimi K2 language model checkpoint and processes approximately 15T tokens across three stages: first, standalone ViT training to establish a robust native-resolution visual encoder; second, joint pre-training to simultaneously enhance language and multimodal capabilities; and third, mid-training on high-quality data and long-context activation to refine capabilities and extend context windows.

如表 3 所示,Kimi K2.5 的预训练基于 Kimi K2 语言模型检查点,分三个阶段处理约 15T token: 首先,独立 ViT 训练以建立 robust 的原生分辨率视觉编码器; 其次,联合预训练以同时增强语言和多模态能力; 第三,在高质量数据和长上下文激活上进行 mid-training,以精炼能力并扩展上下文窗口。

**ViT Training Stage.** The MoonViT-3D is continual pre-trained from SigLIP [77] on image-text and video-text pairs, where the text components consist of a variety of targets: image alt texts, synthetic captions of images and videos, grounding bboxes, and OCR texts. Unlike the implementation in Kimi-VL [54], this continual pre-training does not include a contrastive loss, but incorporates solely cross-entropy loss $L_{caption}$ for caption generation conditioned on input images and videos. We adopt a two-stage alignment strategy. In the first stage, we update the MoonViT-3D to align it with Moonlight-16B-A3B [34] via the caption loss, consuming about 1T tokens with very few training FLOPs. This stage allows MoonViT-3D to primarily understand high-resolution images and videos. A very short second stage follows, updating only the MLP projector to bridge the ViT with the 1T LLM for smoother joint pre-training.

**ViT 训练阶段。** MoonViT-3D 从 SigLIP [77] 在图像-文本和视频-文本对上进行持续预训练,其中文本组件包含多种目标: 图像替代文本、图像和视频的合成字幕、定位边界框和 OCR 文本。与 Kimi-VL [54] 中的实现不同,这种持续预训练不包含对比损失,而是仅包含以输入图像和视频为条件的字幕生成的交叉熵损失 $L_{caption}$。我们采用两阶段对齐策略。第一阶段,我们通过字幕损失更新 MoonViT-3D 以将其与 Moonlight-16B-A3B [34] 对齐,消耗约 1T token 且训练 FLOPs 极少。这一阶段使 MoonViT-3D 主要理解高分辨率图像和视频。随后是一个非常短的第二阶段,仅更新 MLP 投影器以桥接 ViT 与 1T LLM,实现更平滑的联合预训练。

**Joint Training Stages.** The joint pre-training stage continues from a near-end Kimi K2 checkpoint over additional 15T vision-text tokens at 4K sequence length. The data recipe extends Kimi K2's pre-training distribution by introducing unique tokens, adjusting data proportions with increased weight on coding-related content, and controlling maximum epochs per data source. The third stage performs long-context activation with integrated higher-quality mid-training data, sequentially extending context length via YaRN [44] interpolation. This yields significant generalization improvements in long-context text understanding and long video comprehension.

**联合训练阶段。** 联合预训练阶段从接近末期的 Kimi K2 检查点继续,在 4K 序列长度上额外处理 15T 视觉-文本 token。数据配方通过引入独特 token、调整数据比例(增加编程相关内容权重)和控制每个数据源的最大 epoch 来扩展 Kimi K2 的预训练分布。第三阶段执行长上下文激活,整合更高质量的 mid-training 数据,通过 YaRN [44] 插值顺序扩展上下文长度。这在长上下文文本理解和长视频理解方面带来了显著的泛化改进。

### 4.4 Post-Training
#### 后训练

#### 4.4.1 Supervised Fine-Tuning
##### 监督微调

Following the SFT pipeline established by Kimi K2 [53], we developed K2.5 by synthesizing high-quality candidate responses from K2, K2 Thinking and a suite of proprietary in-house expert models. Our data generation strategy employs specialized pipelines tailored to specific domains, integrating human annotation with advanced prompt engineering and multi-stage verification. This methodology produced a large-scale instruction-tuning dataset featuring diverse prompts and intricate reasoning trajectories, ultimately training the model to prioritize interactive reasoning and precise tool-calling for complex, real-world applications.

遵循 Kimi K2 [53] 建立的 SFT 流水线,我们通过综合来自 K2、K2 Thinking 和一套专有内部专家模型的高质量候选响应来开发 K2.5。我们的数据生成策略采用针对特定领域定制的专用流水线,整合人工标注与高级提示工程和多阶段验证。这一方法产生了大规模指令微调数据集,包含多样化的提示和复杂的推理轨迹,最终训练模型优先处理交互式推理和精确的工具调用,以应对复杂的实际应用。

#### 4.4.2 Reinforcement Learning
##### 强化学习

Reinforcement learning constitutes a crucial phase of our post-training. To facilitate joint optimization across text and vision modalities, as well as to enable PARL for agent swarm, we develop a Unified Agentic Reinforcement Learning Environment (Appendix D) and optimize the RL algorithms. Both text-vision joint RL and PARL are built upon the algorithms described in this section.

强化学习构成了我们后训练的关键阶段。为促进跨文本和视觉模态的联合优化,以及为智能体集群启用 PARL,我们开发了统一智能体强化学习环境(附录 D)并优化了 RL 算法。文本-视觉联合 RL 和 PARL 都建立在本节描述的算法之上。

**Policy Optimization.** For each problem $x$ sampled from a dataset $D$, $K$ responses $\{y_1, ..., y_K\}$ are generated using the previous policy $\pi_{old}$. We optimize the model $\pi_\theta$ with respect to the following objective:

**策略优化。** 对于从数据集 $D$ 中采样的每个问题 $x$,使用先前策略 $\pi_{old}$ 生成 $K$ 个响应 $\{y_1, ..., y_K\}$。我们针对以下目标优化模型 $\pi_\theta$:

$$
\mathcal{L}_{RL}(\theta) = \mathbb{E}_{x \sim D} \left[ \frac{1}{N} \sum_{j=1}^{K} \sum_{i=1}^{|y_j|} \text{Clip}\left( \frac{\pi_\theta(y_j^i | x, y_j^{0:i})}{\pi_{old}(y_j^i | x, y_j^{0:i})}, \alpha, \beta \right) (r(x, y_j) - \bar{r}(x)) - \tau \log^2 \frac{\pi_\theta(y_j^i | x, y_j^{0:i})}{\pi_{old}(y_j^i | x, y_j^{0:i})} \right]. \tag{1}
$$

Here $\alpha, \beta, \tau > 0$ are hyperparameters, $y_j^{0:i}$ is the prefix up to the $i$-th token of the $j$-th response, $N = \sum_{i=1}^{K} |y_i|$ is the total number of generated tokens in a batch, $\bar{r}(x) = \frac{1}{K} \sum_{j=1}^{K} r(x, y_j)$ is the mean reward of all generated responses.

这里 $\alpha, \beta, \tau > 0$ 是超参数,$y_j^{0:i}$ 是第 $j$ 个响应的前 $i$ 个 token 的前缀,$N = \sum_{i=1}^{K} |y_i|$ 是一个批次中生成的总 token 数,$\bar{r}(x) = \frac{1}{K} \sum_{j=1}^{K} r(x, y_j)$ 是所有生成响应的平均奖励。

This loss function departs from the policy optimization algorithm used in K1.5 [31] by introducing a token-level clipping mechanism designed to mitigate the off-policy divergence amplified by discrepancies between training and inference frameworks. The mechanism functions as a simple gradient masking scheme: policy gradients are computed normally for tokens with log-ratios within the interval $[\alpha, \beta]$, while gradients for tokens falling outside this range are zeroed out. Notably, a key distinction from standard PPO clipping [50] is that our method relies strictly on the log-ratio to explicitly bound off-policy drift, regardless of the sign of the advantages. This approach aligns with recent strategies proposed to stabilize large-scale RL training [74, 78]. Empirically, we find this mechanism essential for maintaining training stability in complex domains requiring long-horizon, multi-step tool-use reasoning. We employ the MuonClip optimizer [30, 34] to minimize this objective.

该损失函数与 K1.5 [31] 使用的策略优化算法的不同之处在于引入了 token 级裁剪机制,旨在缓解由训练和推理框架差异放大的 off-policy 散度。该机制作为一个简单的梯度掩码方案运作: 对于 log-ratio 在区间 $[\alpha, \beta]$ 内的 token 正常计算策略梯度,而对于超出此范围的 token 的梯度被置零。值得注意的是,与标准 PPO 裁剪 [50] 的一个关键区别是,我们的方法严格依赖 log-ratio 来显式限制 off-policy 漂移,而不考虑优势的符号。这一方法与最近提出的稳定大规模 RL 训练的策略 [74, 78] 一致。实证上,我们发现这一机制对于在需要长程、多步工具使用推理的复杂领域中维持训练稳定性至关重要。我们采用 MuonClip 优化器 [30, 34] 来最小化此目标。

> 译者注(架构细节): K2.5 的 RL 目标函数(式 1)包含几个精妙的工程细节。1) Token 级裁剪(Clip)与标准 PPO 的"优势符号敏感"裁剪不同: 这里无论优势正负,只要 log-ratio 超出 $[\alpha, \beta]$ 就屏蔽梯度,这更严格地限制了策略更新幅度;2) 对数平方项 $\log^2(\pi_\theta/\pi_{old})$ 是 KL 散度的一种变体,但使用平方而非线性,对大偏差惩罚更重;3) 使用 MuonClip 而非 AdamW 作为 RL 优化器延续了 K2 的优化器选择,但 RL 中的策略梯度噪声远大于 SFT,这要求裁剪机制必须足够稳健;4) "训练-推理框架差异"指的是 RL 训练通常在某种并行配置下进行,而推理可能在不同配置下进行,这种差异会导致 off-policy 程度被低估。

**Reward Function.** We apply a rule-based outcome reward for tasks with verifiable solutions, such as reasoning and agentic tasks. To optimize resource consumption, we also incorporate a budget-control reward aimed at enhancing token efficiency. For general-purpose tasks, we employ Generative Reward Models (GRMs) that provide granular evaluations aligned with Kimi's internal value criteria. In addition, for visual tasks, we design task-specific reward functions to provide fine-grained supervision. For visual grounding and point localization tasks, we employ an F1-based reward with soft matching: grounding tasks derive soft matches from Intersection over Union (IoU) and point tasks derive soft matches from Gaussian-weighted distances under optimal matching. For polygon segmentation tasks, we rasterize the predicted polygon into a binary mask and compute the segmentation IoU against the ground-truth mask to assign the reward. For OCR tasks, we adopt normalized edit distance to quantify character-level alignment between predictions and ground-truth. For counting tasks, rewards are assigned based on the absolute difference between predictions and ground-truth. Furthermore, we synthesize complex visual puzzle problems and utilize an LLM verifier (Kimi K2) to provide feedback.

**奖励函数。** 我们对具有可验证解决方案的任务(如推理和智能体任务)应用基于规则的结果奖励。为优化资源消耗,我们还纳入了旨在提升 token 效率的预算控制奖励。对于通用任务,我们采用生成式奖励模型(GRM),提供与 Kimi 内部价值标准对齐的细粒度评估。此外,对于视觉任务,我们设计了任务特定的奖励函数以提供细粒度监督。对于视觉定位和点定位任务,我们采用基于 F1 的软匹配奖励: 定位任务从交并比(IoU)导出软匹配,点任务从最优匹配下的高斯加权距离导出软匹配。对于多边形分割任务,我们将预测的多边形光栅化为二值掩码,并计算与真实掩码的分割 IoU 来分配奖励。对于 OCR 任务,我们采用归一化编辑距离来量化预测与真实值之间的字符级对齐。对于计数任务,奖励基于预测与真实值之间的绝对差分配。此外,我们合成复杂的视觉谜题问题,并利用 LLM 验证器(Kimi K2)提供反馈。

**Generative Reward Models.** Kimi K2 leverages a self-critique rubric reward for open-ended generation [53], and K2.5 extends this line of work by systematically deploying Generative Reward Models (GRMs) across a broad range of agentic behaviors and multimodal trajectories. Rather than limiting reward modeling to conversational outputs, we apply GRMs on top of verified reward signals in diverse environments, including chat assistants, coding agents, search agents, and artifact-generating agents. Notably, GRMs function not as binary adjudicators, but as fine-grained evaluators aligned with Kimi's values that are critical to user experiences, such as helpfulness, response readiness, contextual relevance, appropriate level of detail, aesthetic quality of generated artifacts, and strict instruction following. This design allows the reward signal to capture nuanced preference gradients that are difficult to encode with purely rule-based or task-specific verifiers. To mitigate reward hacking and overfitting to a single preference signal, we employ multiple alternative GRM rubrics tailored to different task contexts.

**生成式奖励模型。** Kimi K2 利用自批评评分标准奖励进行开放式生成 [53],K2.5 通过系统地在广泛的智能体行为和多模态轨迹上部署生成式奖励模型(GRM)来扩展这一工作线。我们不将奖励建模限制在对话输出上,而是在多样化环境(包括聊天助手、编程智能体、搜索智能体和工件生成智能体)中的已验证奖励信号之上应用 GRM。值得注意的是,GRM 不是作为二元裁决者运作,而是作为与 Kimi 价值观对齐的细粒度评估器运作,这些价值观对用户体验至关重要,如有用性、响应准备度、上下文相关性、适当的细节水平、生成工件的美学质量和严格的指令遵循。这一设计使奖励信号能够捕捉细微的偏好梯度,这些梯度难以用纯基于规则或任务特定的验证器编码。为缓解奖励黑客行为和对单一偏好信号的过拟合,我们采用了针对不同任务上下文定制的多个替代 GRM 评分标准。

**Token Efficient Reinforcement Learning.** Token efficiency is central to LLMs with test-time scaling. While test-time scaling inherently trades computation for reasoning quality, practical gains require algorithmic innovations that actively navigate this trade-off. Our previous findings indicate that imposing a problem-dependent budget effectively constrains inference-time compute, incentivizing the model to generate more concise chain of thought reasoning patterns without unnecessary token expansion [31, 53]. However, we also observe a length-overfitting phenomenon: models trained under rigid budget constraints often fail to generalize to higher compute scales. Consequently, they cannot effectively leverage additional inference-time tokens to solve complex problems, instead defaulting to truncated reasoning patterns.

**Token 高效强化学习。** Token 效率对于具有测试时扩展的 LLM 至关重要。虽然测试时扩展本质上是用计算换取推理质量,但实际收益需要主动驾驭这种权衡的算法创新。我们此前的发现表明,施加问题相关的预算能有效约束推理时计算,激励模型生成更简洁的思维链推理模式,而无需不必要的 token 扩展 [31, 53]。然而,我们也观察到一个长度过拟合现象: 在严格预算约束下训练的模型往往无法泛化到更高计算规模。因此,它们不能有效利用额外的推理时 token 来解决复杂问题,而是默认退化为截断的推理模式。

To this end, we propose Toggle, a training heuristic that alternates between inference-time scaling and budget-constrained optimization: for learning iteration $t$, the reward function is defined by

为此,我们提出了 Toggle,一种训练启发式方法,在推理时扩展和预算约束优化之间交替: 对于学习迭代 $t$,奖励函数定义为

$$
\tilde{r}(x, y) = \begin{cases} r(x, y) \cdot \mathbb{I}\left[ \frac{1}{K} \sum_{i=1}^{K} r(x, y_i) < \lambda \text{ or } |y_i| \leq \text{budget}(x) \right] & \text{if } \lfloor t/m \rfloor \pmod{2} = 0 \text{ (Phase0)} \\ r(x, y) & \text{if } \lfloor t/m \rfloor \pmod{2} = 1 \text{ (Phase1)}. \end{cases}
$$

where $\lambda$ and $m$ are hyper-parameters of the algorithm and $K$ is the number of rollouts per problem. Specifically, the algorithm alternates between two optimization phases every $m$ iterations:

其中 $\lambda$ 和 $m$ 是算法的超参数,$K$ 是每个问题的 rollout 数量。具体而言,算法每 $m$ 次迭代在两个优化阶段之间交替:

- Phase0 (budget limited phase): The model is trained to solve the problem within a task-dependent token budget. To prevent a premature sacrifice of quality for efficiency, this constraint is conditionally applied: it is only enforced when the model's mean accuracy for a given problem exceeds the threshold $\lambda$.
- Phase1 (standard scaling phase): The model generates responses up to the maximum token limit, encouraging the model to leverage computation for better inference-time scaling.

- Phase0(预算限制阶段): 模型被训练在任务相关的 token 预算内解决问题。为防止过早为效率牺牲质量,此约束是条件应用的: 仅当模型对给定问题的平均准确率超过阈值 $\lambda$ 时才强制执行。
- Phase1(标准扩展阶段): 模型生成响应直至最大 token 限制,鼓励模型利用计算获得更好的推理时扩展。

The problem-dependent budget is estimated from the $\rho$-th percentile of token lengths among the subset of correct responses:

问题相关预算从正确响应子集中 token 长度的 $\rho$ 分位数估计:

$$
\text{budget}(x) = \text{Percentile}(\{|y_j| \mid r(x, y_i) = 1, i = 1, ..., K\}, \rho). \tag{2}
$$

This budget is estimated once at the beginning of training and remains fixed thereafter. Notably, Toggle functions as a stochastic alternating optimization for a bi-objective problem. It is specifically designed to reconcile reasoning capabilities with computational efficiency.

此预算在训练开始时估计一次,之后保持固定。值得注意的是,Toggle 作为一个双目标问题的随机交替优化器运作。它专门设计用于调和推理能力与计算效率。

We evaluate the effectiveness of Toggle on K2 Thinking [1]. As shown in Figure 5, we observe a consistent reduction in output length across nearly all benchmarks. On average, Toggle decreases output tokens by 25~30% with a negligible impact on performance. We also observe that redundant patterns in the chain-of-thought, such as repeated verifications and mechanical calculations, decrease substantially. Furthermore, Toggle shows strong domain generalization. For example, when trained exclusively on mathematics and programming tasks, the model still achieves consistent token reductions on GPQA and MMLU-Pro with only marginal degradation in performance (Figure 5).

我们在 K2 Thinking [1] 上评估了 Toggle 的有效性。如图 5 所示,我们在几乎所有基准上都观察到输出长度的一致减少。平均而言,Toggle 将输出 token 减少 25~30%,而对性能的影响可忽略不计。我们还观察到思维链中的冗余模式(如重复验证和机械计算)大幅减少。此外,Toggle 表现出强大的领域泛化能力。例如,当仅在数学和编程任务上训练时,模型在 GPQA 和 MMLU-Pro 上仍实现了持续的 token 减少,性能仅边际下降(图 5)。

> 译者注(设计动机): Toggle 是解决"测试时扩展"与"token 效率"之间经典权衡的创新方案。1) 传统方法要么固定预算(导致长度过拟合,无法利用额外计算),要么无限制(导致过度冗长),Toggle 的交替策略让模型同时学会两种模式;2) Phase0 的条件触发机制("仅当准确率超过 $\lambda$")防止了过早压缩: 模型先学会正确解题,再学会高效解题;3) 预算估计公式(式 2)使用正确响应的 $\rho$ 分位数是一个稳健设计: 它排除了异常长的正确解,同时保留了合理的余量;4) 25~30% 的 token 减少在推理成本上意味着显著节省: 对于一个每百万 token 0.50 美元的 API,这相当于推理成本降低 25~30%。

### 4.5 Training Infrastructure
#### 训练基础设施

Kimi K2.5 inherits the training infrastructure from Kimi K2 [53] with minimal modifications. For multimodal training, we propose Decoupled Encoder Process, where the vision encoder is incorporated into the existing pipeline with negligible additional overhead.

Kimi K2.5 继承了 Kimi K2 [53] 的训练基础设施,修改极少。对于多模态训练,我们提出了解耦编码器进程,将视觉编码器整合到现有流水线中,附加开销可忽略不计。

#### 4.5.1 Decoupled Encoder Process (DEP)
##### 解耦编码器进程 (DEP)

In a typical multimodal training paradigm utilizing Pipeline Parallelism (PP), the vision encoder and text embedding are co-located in the first stage of the pipeline (Stage-0). However, due to the inherent variations of multimodal input size (e.g., image counts and resolutions), Stage-0 suffers from drastic fluctuations in both computational load and memory usage. This forces existing solutions to adopt custom PP configurations for vision-language models -- for instance, [54] manually adjusts the number of text decoder layers in Stage-0 to reserve memory. While this compromise alleviates memory pressure, it does not fundamentally resolve the load imbalance caused by multimodal input sizes. More critically, it precludes the direct reuse of parallel策略 that have been highly optimized for text-only training.

在利用流水线并行(PP)的典型多模态训练范式中,视觉编码器和文本嵌入共同位于流水线的第一阶段(Stage-0)。然而,由于多模态输入大小的固有变化(如图像数量和分辨率),Stage-0 在计算负载和内存使用方面都遭受剧烈波动。这迫使现有解决方案为视觉-语言模型采用定制的 PP 配置 -- 例如,[54] 手动调整 Stage-0 中文本解码器层的数量以预留内存。虽然这种妥协缓解了内存压力,但它没有从根本上解决多模态输入大小导致的负载不平衡。更关键的是,它排除了直接复用已为纯文本训练高度优化的并行策略。

Leveraging the unique topological position of the visual encoder within the computation graph -- specifically, its role as the start of the forward pass and the end of the backward pass -- our training uses Decoupled Encoder Process (DEP), which is composed of three stages in each training step:

利用视觉编码器在计算图中的独特拓扑位置 -- 具体而言,它是前向传播的开始和反向传播的结束 -- 我们的训练使用了解耦编码器进程(DEP),每个训练步骤由三个阶段组成:

- **Balanced Vision Forward:** We first execute the forward pass for all visual data in the global batch. Because the vision encoder is small, we replicate it on all GPUs regardless of other parallelism strategies. During this phase, the forward computational workload is evenly distributed across all GPUs based on load metrics (e.g., image or patch counts). This eliminates load-imbalance caused by PP and visual token counts. To minimize peak memory usage, we discard all intermediate activations, retaining only the final output activations. The results are gathered back to PP Stage-0;
- **Backbone Training:** This phase performs the forward and backward passes for the main transformer backbone. By discarding intermediate activations in the preceding phase, we can now fully leverage any efficient parallel strategies validated in pure text training. After this phase, gradients are accumulated at the visual encoder output;
- **Vision Recomputation & Backward:** We re-compute the vision encoder forward pass, followed by a backward pass to compute gradients for parameters in the vision encoder;

- **均衡视觉前向:** 我们首先执行全局批次中所有视觉数据的前向传播。由于视觉编码器较小,我们在所有 GPU 上复制它,而不考虑其他并行策略。在此阶段,前向计算负载基于负载指标(如图像或 patch 数量)均匀分布在所有 GPU 上。这消除了 PP 和视觉 token 数量导致的负载不平衡。为最小化峰值内存使用,我们丢弃所有中间激活,仅保留最终输出激活。结果被收集回 PP Stage-0;
- **主干训练:** 此阶段执行主 Transformer 主干的前向和反向传播。通过在前一阶段丢弃中间激活,我们现在可以充分利用在纯文本训练中验证的任何高效并行策略。此阶段后,梯度在视觉编码器输出处累积;
- **视觉重计算与反向:** 我们重新计算视觉编码器前向传播,然后进行反向传播以计算视觉编码器参数的梯度;

DEP not only achieves load-balance, but also decouples the optimization strategy of the vision encoder and the main backbone. K2.5 seamlessly inherits the parallel strategy of K2, achieving a multimodal training efficiency of 90% relative to text-only training. We note a concurrent work, LongCat-Flash-Omni [55], shares a similar design philosophy.

DEP 不仅实现了负载均衡,还解耦了视觉编码器和主主干的优化策略。K2.5 无缝继承了 K2 的并行策略,实现了相对于纯文本训练 90% 的多模态训练效率。我们注意到一项同期工作 LongCat-Flash-Omni [55] 分享了类似的设计理念。

> 译者注(工程细节): DEP 是解决多模态训练中"视觉编码器瓶颈"的 elegant 方案。1) 核心洞察是视觉编码器在计算图中的特殊位置: 它是前向的起点和反向的终点,这意味着可以将其前向和反向"剥离"出来独立处理;2) "丢弃中间激活 + 重计算"是显存换计算的经典权衡: 视觉编码器通常比 LLM 主干小得多(如 400M vs 1T),重计算的开销远小于保留激活的显存压力;3) 90% 的多模态训练效率(相对于纯文本)是一个非常强的结果,说明 DEP 几乎消除了视觉编码器带来的并行化开销;4) 这一设计的局限在于: 它假设视觉编码器足够小以在所有 GPU 上复制,对于更大的视觉编码器(如 10B+ 参数),这种全复制策略可能不再可行。


## 5 Evaluations
### 评估

### 5.1 Main Results
#### 主要结果

#### 5.1.1 Evaluation Settings
##### 评估设置

**Benchmarks.** We evaluate Kimi K2.5 on a comprehensive benchmark suite spanning text-based reasoning, competitive and agentic coding, multimodal understanding (image and video), autonomous agentic execution, and computer use. Our benchmark taxonomy is organized along the following capability axes:

**基准测试。** 我们在全面的基准测试套件上评估 Kimi K2.5,涵盖基于文本的推理、竞赛和智能体编程、多模态理解(图像和视频)、自主智能体执行和计算机使用。我们的基准测试分类沿以下能力维度组织:

- **Reasoning & General:** Humanity's Last Exam (HLE) [46], AIME 2025 [4], HMMT 2025 (Feb) [58], IMO-AnswerBench [37], GPQA-Diamond [47], MMLU-Pro [64], SimpleQA Verified [22], AdvancedIF [23], and LongBench v2 [9].
- **Coding:** SWE-Bench Verified [29], SWE-Bench Pro (public) [16], SWE-Bench Multilingual [29], TerminalBench 2.0 [39], PaperBench (CodeDev) [52], CyberGym [66], SciCode [56], OJBench (cpp) [65], and LiveCodeBench (v6) [28].
- **Agentic Capabilities:** BrowseComp [68], WideSearch [69], DeepSearchQA [60], FinSearchComp (T2&T3) [26], Seal-0 [45], GDPVal [43].
- **Image Understanding:** (math & reasoning) MMMU-Pro [75], MMMU (val) [76], CharXiv (RQ) [67], MathVision [61] and MathVista (mini) [36]; (vision knowledge) SimpleVQA [13] and WorldVQA 2; (perception) ZeroBench [48], BabyVision [12], BLINK [18] and MMVP [57]; (OCR & document) OCRBench [35], OmniDocBench 1.5 [42] and InfoVQA [38].
- **Video Understanding:** VideoMMMU [25], MMVU [79], MotionBench [24], Video-MME [17] (with subtitles), LongVideoBench [70], and LVBench [62].
- **Computer Use:** OSWorld-Verified [72, 73], and WebArena [80].

**Baselines.** We benchmark against state-of-the-art proprietary and open-source models. For proprietary models, we compare against Claude Opus 4.5 (with extended thinking) [6], GPT-5.2 (with xhigh reasoning effort) [41], and Gemini 3 Pro (with high reasoning-level) [20]. For open-source models, we include DeepSeek-V3.2 (with thinking mode enabled) [14] for text benchmarks, while vision benchmarks report Qwen3-VL-235B-A22B-Thinking [8] instead.

**基线。** 我们对 SOTA 专有和开源模型进行基准测试。专有模型对比 Claude Opus 4.5(扩展思考)[6]、GPT-5.2(xhigh 推理 effort)[41] 和 Gemini 3 Pro(high 推理级别)[20]。开源模型包括文本基准的 DeepSeek-V3.2(启用思考模式)[14],视觉基准则报告 Qwen3-VL-235B-A22B-Thinking [8]。

**Evaluation Configurations.** Unless otherwise specified, all Kimi K2.5 evaluations use temperature = 1.0, top-p = 0.95, and a context length of 256k tokens. Benchmarks without publicly available scores were re-evaluated under identical conditions and marked with an asterisk (*).

**评估配置。** 除非另有说明,所有 Kimi K2.5 评估使用 temperature = 1.0,top-p = 0.95,上下文长度 256K token。无公开可用分数的基准在相同条件下重新评估并标记星号(*)。

#### 5.1.2 Evaluation Results
##### 评估结果

Comprehensive results comparing Kimi K2.5 against proprietary and open-source baselines are presented in Table 4.

Kimi K2.5 与专有和开源基线的综合对比结果见表 4。

**Table 4: Performance comparison of Kimi K2.5 against open-source and proprietary models. Bold denotes the global SOTA; Data points marked with * are taken from our internal evaluations.**

**表 4: Kimi K2.5 与开源和专有模型的性能对比。粗体表示全局 SOTA; 标 * 的数据点来自我们的内部评估。**

| Category | Benchmark | Kimi K2.5 | Claude Opus 4.5 | GPT-5.2 (xhigh) | Gemini 3 Pro | DeepSeek-V3.2 | Qwen3-VL-235B |
|----------|-----------|-----------|-----------------|-----------------|--------------|---------------|---------------|
| **Reasoning & General** | HLE-Full | 30.1 | 30.8 | 34.5 | **37.5** | 25.1dagger | - |
| | HLE-Full w/ tools | **50.2** | 43.2 | 45.5 | 45.8 | 40.8dagger | - |
| | AIME 2025 | 96.1 | 92.8 | **100** | 95.0 | 93.1 | - |
| | HMMT 2025 (Feb) | 95.4 | 92.9* | **99.4** | 97.3* | 92.5 | - |
| | IMO-AnswerBench | 81.8 | 78.5* | **86.3** | 83.1* | 78.3 | - |
| | GPQA-Diamond | 87.6 | 87.0 | **92.4** | 91.9 | 82.4 | - |
| | MMLU-Pro | 87.1 | 89.3* | 86.7* | **90.1** | 85.0 | - |
| | SimpleQA Verified | 36.9 | 44.1 | 38.9 | **72.1** | 27.5 | - |
| | AdvancedIF | 75.6 | 63.1 | **81.1** | 74.7 | 58.8 | - |
| | LongBench v2 | 61.0 | 64.4* | 54.5* | **68.2*** | 59.8* | - |
| **Coding** | SWE-Bench Verified | 76.8 | **80.9** | 80.0 | 76.2 | 73.1 | - |
| | SWE-Bench Pro | 50.7 | 55.4* | **55.6** | - | - | - |
| | SWE-Bench Multilingual | 73.0 | **77.5** | 72.0 | 65.0 | 70.2 | - |
| | TerminalBench 2.0 | 50.8 | **59.3** | 54.0 | 54.2 | 46.4 | - |
| | PaperBench (CodeDev) | 63.5 | 72.9* | 63.7* | - | 47.1 | - |
| | CyberGym | 41.3 | **50.6** | - | 39.9* | 17.3* | - |
| | SciCode | 48.7 | 49.5 | **52.1** | 56.1 | 38.9 | - |
| | OJBench (cpp) | 57.4 | 54.6* | - | 68.5* | 54.7* | - |
| | LiveCodeBench (v6) | **85.0** | 82.2* | - | 87.4* | 83.3 | - |
| **Agentic** | BrowseComp | **60.6** | 37.0 | 65.8 | 37.8 | 51.4 | - |
| | BrowseComp (w/ ctx) | **74.9** | 57.8 | 59.2 | 67.6 | - | - |
| | WideSearch | 72.7 | **76.2*** | - | 57.0 | 32.5* | - |
| | DeepSearchQA | **77.1** | 76.1* | 71.3* | 63.2* | 60.9* | - |
| | FinSearchComp T2&T3 | **67.8** | 66.2* | - | 49.9 | 59.1* | - |
| | Seal-0 | **57.4** | 47.7* | 45.0 | 45.5* | 49.5* | - |
| | GDPVal-AA | 41.0 | 45.0 | **48.0** | 35.0 | 34.0 | - |
| **Image** | MMMU-Pro | 78.5 | 74.0 | 79.5* | **81.0** | - | 69.3 |
| | MMMU (val) | 84.3 | 80.7 | 86.7* | **87.5*** | - | 80.6 |
| | CharXiv (RQ) | 77.5 | 67.2* | **82.1** | 81.4 | - | 66.1 |
| | MathVision | **84.2** | 77.1* | 83.0 | 86.1* | - | 74.6 |
| | MathVista (mini) | **90.1** | 80.2* | 82.8* | 89.8* | - | 85.8 |
| | SimpleVQA | **71.2** | 69.7* | 55.8* | 69.7* | - | 56.8* |
| | WorldVQA | **46.3** | 36.8 | 28.0 | 47.4 | - | 23.5 |
| | ZeroBench | **9** | 3* | 9* | 8* | - | 4* |
| | ZeroBench w/ tools | **11** | 9* | 7* | 12* | - | 3* |
| | BabyVision | 36.5 | 14.2 | 34.4 | **49.7** | - | 22.2 |
| | BLINK | **78.9** | 68.8* | - | 78.7* | - | 68.9 |
| | MMVP | 87.0 | 80.0* | 83.0* | **90.0*** | - | 84.3 |
| | OmniDocBench 1.5 | **88.8** | 87.7* | 85.7 | 88.5 | - | 82.0* |
| | OCRBench | **92.3** | 86.5* | 80.7* | 90.3* | - | 87.5 |
| | InfoVQA (test) | **92.6** | 76.9* | 84* | 57.2* | - | 89.5 |
| **Video** | VideoMMMU | 86.6 | 84.4* | 85.9 | **87.6** | - | 80.0 |
| | MMVU | 80.4 | 77.3* | 80.8* | 77.5* | - | 71.1 |
| | MotionBench | **70.4** | 60.3* | 64.8* | 70.3 | - | - |
| | Video-MME | **87.4** | 77.6* | 86.0* | 88.4* | - | 79.0 |
| | LongVideoBench | **79.8** | 67.2* | 76.5* | 77.7* | - | 65.6* |
| | LVBench | **75.9** | 57.3 | - | 73.5* | - | 63.6 |
| **Computer Use** | OSWorld-Verified | 63.3 | **66.3** | 8.6* | 20.7* | - | 38.1 |
| | WebArena | 58.9 | **63.4*** | - | - | - | 26.4* |

**Reasoning and General.** Kimi K2.5 achieves competitive performance with top-tier proprietary models on rigorous STEM benchmarks. On Math tasks, AIME 2025, K2.5 scores 96.1%, approaching GPT-5.2's perfect score while outperforming Claude Opus 4.5 (92.8%) and Gemini 3 Pro (95.0%). This high-level performance extends to the HMMT 2025 (95.4%) and IMO-AnswerBench (81.8%), demonstrating K2.5's superior reasoning depth. Kimi K2.5 also exhibits remarkable knowledge and scientific reasoning capabilities, scoring 36.9% on SimpleQA Verified, 87.1% on MMLU-Pro and 87.6% on GPQA. Notably, on HLE without the use of tools, K2.5 achieves an HLE-Full score of 30.1%, with component-wise scores of 31.5% on text subset and 21.3% on image subset. When tool-use is enabled, K2.5's HLE-Full score rises to 50.2%, with 51.8% (text) and 39.8% (image), significantly outperforming Gemini 3 Pro (45.8%) and GPT-5.2 (45.5%).

**推理与通用。** Kimi K2.5 在严格的 STEM 基准上与顶级专有模型保持竞争力。在数学任务 AIME 2025 上,K2.5 得分 96.1%,接近 GPT-5.2 的完美分数,同时超越 Claude Opus 4.5 (92.8%) 和 Gemini 3 Pro (95.0%)。这一高水平性能延伸至 HMMT 2025 (95.4%) 和 IMO-AnswerBench (81.8%),展示了 K2.5 卓越的推理深度。Kimi K2.5 还展现出卓越的知识和科学推理能力,SimpleQA Verified 36.9%、MMLU-Pro 87.1% 和 GPQA 87.6%。值得注意的是,在不使用工具的情况下,HLE-Full 得分 30.1%,文本子集 31.5%、图像子集 21.3%。启用工具使用后,K2.5 的 HLE-Full 得分上升至 50.2%,文本 51.8%、图像 39.8%,显著超越 Gemini 3 Pro (45.8%) 和 GPT-5.2 (45.5%)。

**Complex Coding and Software Engineering.** Kimi K2.5 exhibits strong software engineering capabilities, especially on realistic coding and maintenance tasks. It achieves 76.8% on SWE-Bench Verified and 73.0% on SWE-Bench Multilingual, outperforming Gemini 3 Pro while remaining competitive with Claude Opus 4.5 and GPT-5.2. On LiveCodeBench v6, Kimi K2.5 reaches 85.0%, surpassing DeepSeek-V3.2 (83.3%) and Claude Opus 4.5 (82.2%).

**复杂编程与软件工程。** Kimi K2.5 展现出强大的软件工程能力,特别是在现实编程和维护任务上。SWE-Bench Verified 76.8%、SWE-Bench Multilingual 73.0%,超越 Gemini 3 Pro,与 Claude Opus 4.5 和 GPT-5.2 保持竞争力。LiveCodeBench v6 达到 85.0%,超越 DeepSeek-V3.2 (83.3%) 和 Claude Opus 4.5 (82.2%)。

**Agentic Capabilities.** Kimi K2.5 establishes new state-of-the-art performance on complex agentic search and browsing tasks. On BrowseComp, K2.5 achieves 60.6% without context management techniques, 74.9% with Discard-all context management -- substantially outperforming GPT-5.2's reported 65.8%, Claude Opus 4.5 (37.0%) and Gemini 3 Pro (37.8%). On DeepSearchQA (77.1%), FinSearchComp T2&T3 (67.8%) and Seal-0 (57.4%), K2.5 leads all evaluated models.

**智能体能力。** Kimi K2.5 在复杂智能体搜索和浏览任务上树立了新的 SOTA。BrowseComp 上,K2.5 无上下文管理技术 60.6%,使用 Discard-all 上下文管理 74.9% -- 大幅超越 GPT-5.2 报告的 65.8%、Claude Opus 4.5 (37.0%) 和 Gemini 3 Pro (37.8%)。DeepSearchQA (77.1%)、FinSearchComp T2&T3 (67.8%) 和 Seal-0 (57.4%) 上,K2.5 领先所有评估模型。

> 译者注(数据可信度): 表 4 的评估结果需要在多个维度上谨慎解读。1) GPT-5.2 在 AIME 2025 上达到 100% 的完美分数,这几乎可以肯定使用了 thinking/xhigh 模式(测试时计算扩展),与 K2.5 的 96.1% 不完全可比;2) SimpleQA Verified 上 Gemini 3 Pro 的 72.1% 远高于 K2.5 的 36.9%,这可能是评估设置差异(如是否启用搜索工具)导致的,而非模型本身的知识差距;3) Computer Use 基准(OSWorld-Verified、WebArena)上 Claude Opus 4.5 仍然领先,说明在 GUI 操作精确性方面,K2.5 尚未达到专有模型的最高水平;4) 标 * 的内部评估分数需要谨慎对待,因为评估条件(如提示模板、采样参数)可能与官方报告不同。

**Vision Reasoning, Knowledge and Perception.** Kimi K2.5 demonstrates strong visual reasoning and world knowledge capabilities. It scores 78.5% on MMMU-Pro, 71.2% on SimpleVQA and 46.3% on WorldVQA. For visual reasoning, it achieves 84.2% on MathVision, 90.1% on MathVista (mini), and 36.5% on BabyVision. For OCR and document understanding, K2.5 delivers outstanding results with 77.5% on CharXiv (RQ), 92.3% on OCRBench, 88.8% on OmniDocBench 1.5, and 92.6% on InfoVQA (test).

**视觉推理、知识与感知。** Kimi K2.5 展现出强大的视觉推理和世界知识能力。MMMU-Pro 78.5%、SimpleVQA 71.2%、WorldVQA 46.3%。视觉推理方面,MathVision 84.2%、MathVista (mini) 90.1%、BabyVision 36.5%。OCR 和文档理解方面,K2.5 表现突出: CharXiv (RQ) 77.5%、OCRBench 92.3%、OmniDocBench 1.5 88.8%、InfoVQA (test) 92.6%。

**Video Understanding.** Kimi K2.5 achieves state-of-the-art performance across diverse video understanding tasks. It attains 86.6% on VideoMMMU and 80.4% on MMVU. With the context-compression and dense temporal understanding abilities of MoonViT-3D, Kimi K2.5 also establishes new global SOTA records in long-video comprehension with 75.9% on LVBench and 79.8% on LongVideoBench by feeding over 2,000 frames.

**视频理解。** Kimi K2.5 在多样化视频理解任务上达到 SOTA。VideoMMMU 86.6%、MMVU 80.4%。凭借 MoonViT-3D 的上下文压缩和密集时序理解能力,Kimi K2.5 还在长视频理解方面创下新的全局 SOTA 纪录: LVBench 75.9%、LongVideoBench 79.8%(输入超过 2000 帧)。

**Computer-Use Capability.** Kimi K2.5 demonstrates state-of-the-art computer-use capability on real-world tasks. On OSWorld-Verified, it achieves a 63.3% success rate relying solely on GUI actions without external tools, substantially outperforming Qwen3-VL-235B-A22B (38.1%) and OpenAI's Operator (o3-based) (42.9%). On WebArena, Kimi K2.5 achieves 58.9%, surpassing OpenAI's Operator (58.1%).

**计算机使用能力。** Kimi K2.5 在现实任务上展现出 SOTA 计算机使用能力。OSWorld-Verified 上,仅依靠 GUI 动作、无外部工具即达到 63.3% 成功率,大幅超越 Qwen3-VL-235B-A22B (38.1%) 和 OpenAI Operator (基于 o3)(42.9%)。WebArena 上,Kimi K2.5 达到 58.9%,超越 OpenAI Operator (58.1%)。

**Table 5: Performance and token efficiency of some reasoning models. Average output token counts (in thousands) are shown in parentheses.**

**表 5: 部分推理模型的性能和 token 效率。平均输出 token 数(以千为单位)显示在括号中。**

| Benchmark | Kimi K2.5 | Kimi K2 | Gemini-3.0 Pro | DeepSeek-V3.2 Thinking |
|-----------|-----------|---------|----------------|------------------------|
| AIME 2025 | 96.1 (25k) | 94.5 (30k) | 95.0 (15k) | 93.1 (16k) |
| HMMT Feb 2025 | 95.4 (27k) | 89.4 (35k) | 97.3 (16k) | 92.5 (19k) |
| HMMT Nov 2025 | 91.1 (24k) | 89.2 (32k) | 94.5 (15k) | 90.2 (18k) |
| IMO-AnswerBench | 81.8 (36k) | 78.6 (37k) | 83.1 (18k) | 78.3 (27k) |
| LiveCodeBench | 85.0 (18k) | 82.6 (25k) | 87.4 (13k) | 83.3 (16k) |
| GPQA Diamond | 87.6 (14k) | 84.5 (13k) | 91.9 (8k) | 82.4 (7k) |
| HLE-Text | 31.5 (24k) | 23.9 (29k) | 38.4 (13k) | 25.1 (21k) |

> 译者注(工程细节): 表 5 的 token 效率对比揭示了 Toggle 训练策略的实际效果。1) K2.5 相比 K2 在大多数基准上减少了 10~20% 的输出 token(AIME: 30k->25k, HMMT: 35k->27k),同时提升了准确率,验证了"压缩思维链而不牺牲质量"的可行性;2) 但 Gemini-3.0 Pro 在相同任务上使用更少的 token(如 AIME 15k vs K2.5 25k),说明 Google 可能在模型架构或推理策略上有额外的效率优势;3) K2.5 在 IMO-AnswerBench 上使用 36k token(所有模型中最高),但准确率 81.8% 仍然落后于 Gemini 的 83.1%(18k),这暗示 token 效率与最终性能之间并非单调关系 -- 有时"更多思考"确实能带来更好结果,但 Toggle 的优化目标是找到质量和效率的最佳平衡点。

### 5.2 Agent Swarm Results
#### Agent Swarm 结果

**Benchmarks.** To rigorously evaluate the effectiveness of the agent swarm framework, we select three representative benchmarks: BrowseComp (deep-research), WideSearch (broad information seeking), and In-house Swarm Bench (real-world high-complexity conditions covering WildSearch, Batch Download, WideRead, and Long-Form Writing).

**基准测试。** 为严格评估智能体集群框架的有效性,我们选择三个代表性基准: BrowseComp(深度研究)、WideSearch(广泛信息检索)和内部 Swarm Bench(现实高复杂度条件,涵盖 WildSearch、批量下载、WideRead 和长文写作)。

**Table 6: Performance comparison of Kimi K2.5 Agent Swarm against single-agent and proprietary baselines. Bold denotes the best result per benchmark.**

**表 6: Kimi K2.5 Agent Swarm 与单智能体和专有基线的性能对比。粗体表示每个基准的最佳结果。**

| Benchmark | K2.5 Agent Swarm | Kimi K2.5 | Claude Opus 4.5 | GPT-5.2 | GPT-5.2 Pro |
|-----------|-----------------|-----------|-----------------|---------|-------------|
| BrowseComp | **78.4** | 60.6 | 37.0 | 65.8 | 77.9 |
| WideSearch | **79.0** | 72.7 | 76.2 | - | - |
| In-house Swarm Bench | **58.3** | 41.6 | 45.8 | - | - |

**Performance.** On BrowseComp, Agent Swarm achieves 78.4%, representing a 17.8% absolute gain over the single-agent K2.5 (60.6%) and surpassing even GPT-5.2 Pro (77.9%). Similarly, WideSearch sees a 6.3% improvement (72.7% -> 79.0%). The gains are most pronounced on In-house Swarm bench (16.7%), where tasks are explicitly designed to reward parallel decomposition.

**性能。** BrowseComp 上,Agent Swarm 达到 78.4%,相比单智能体 K2.5 (60.6%) 绝对提升 17.8%,甚至超越 GPT-5.2 Pro (77.9%)。WideSearch 上提升 6.3%(72.7% -> 79.0%)。内部 Swarm Bench 上增益最显著(16.7%),这些任务明确设计为奖励并行分解。

**Execution Time Savings via Parallelism.** On the WideSearch benchmark, Agent Swarm reduces the execution time required to reach target performance by 3x~4.5x compared to a single-agent baseline. As shown in Figure 8, this efficiency gain scales with task complexity: as the target Item-F1 increases from 30% to 70%, the single agent's execution time grows from approximately 1.8x to over 7.0x the baseline, whereas Agent Swarm maintains near-constant low latency in the range of 0.6x~1.6x.

**通过并行化节省执行时间。** WideSearch 基准上,Agent Swarm 将达到目标性能所需的执行时间降低至单智能体基线的 1/3~1/4.5。如图 8 所示,这一效率增益随任务复杂度扩展: 当目标 Item-F1 从 30% 增加到 70% 时,单智能体执行时间从约 1.8 倍增长到超过 7.0 倍基线,而 Agent Swarm 保持在 0.6~1.6 倍的近恒定低延迟。

**Dynamic Subagent Creation and Scheduling.** Within an agent swarm, subagents are dynamically instantiated rather than pre-defined. Through PARL, the orchestrator learns adaptive policies to create and schedule self-hosted subagents in response to evolving task structures and problem states.

**动态子智能体创建与调度。** 在智能体集群内,子智能体是动态实例化的,而非预定义。通过 PARL,编排器学习自适应策略来创建和调度自托管子智能体,以响应不断演变的任务结构和问题状态。

**Agent Swarm as Proactive Context Management.** Agent Swarm is a kind of proactive and intelligent context management enabled by multi-agent architecture. This approach differs from test-time context truncation strategies such as Hide-Tool-Result, Summary, or Discard-all, which react to context overflow by compressing or discarding accumulated histories. In contrast, Agent Swarm enables proactive context control through explicit orchestration. Long-horizon tasks are decomposed into parallel, semantically isolated subtasks, each executed by a specialized subagent with a bounded local context. Only task-relevant outputs -- rather than full interaction traces -- are selectively routed back to the orchestrator. This design induces context sharding rather than context truncation.

**Agent Swarm 作为主动上下文管理。** Agent Swarm 是一种由多智能体架构实现的主动智能上下文管理。这与测试时上下文截断策略(如 Hide-Tool-Result、Summary 或 Discard-all)不同,后者通过压缩或丢弃累积历史来应对上下文溢出。相反,Agent Swarm 通过显式编排实现主动上下文控制。长程任务被分解为并行的、语义隔离的子任务,每个子任务由具有有界局部上下文的专业子智能体执行。只有任务相关的输出 -- 而非完整交互轨迹 -- 被选择性地路由回编排器。这一设计诱导上下文分片而非上下文截断。

> 译者注(设计动机): Agent Swarm 作为"上下文管理"的框架是一个深刻的洞察。1) 传统上下文截断(如 Discard-all)是"损失性"的: 被丢弃的信息无法恢复,可能导致关键推理步骤的丢失;2) Agent Swarm 的"上下文分片"是"结构性"的: 每个子智能体维护自己的局部上下文,编排器只接收聚合后的结果,信息不会丢失,只是被组织到不同的心理工作空间中;3) 这与人类团队协作惊人地相似: 项目经理(编排器)不需要知道每个工程师(子智能体)的每一行代码,只需要知道模块接口和交付结果;4) 图 7 显示,这种主动策略在 BrowseComp 上的效率和准确率都优于 Discard-all,证明"智能组织"优于"被动截断"。

## 6 Conclusions
### 结论

Kimi K2.5 shows that scalable and general agentic intelligence can be achieved through joint optimization of text and vision together with parallel agent execution. By unifying language and vision across pre-training and reinforcement learning, the model achieves strong cross-modal alignment and visual-text reasoning. Agent Swarm enables concurrent execution of heterogeneous sub-tasks, reducing inference latency while improving performance on complex agentic workloads. Grounded in vision-text intelligence and agent swarms, Kimi K2.5 demonstrates strong performance on benchmarks and real-world tasks. By open-sourcing the post-trained checkpoints, we aim to support the open-source community in building scalable and general-purpose agentic systems and to accelerate progress toward General Agentic Intelligence.

Kimi K2.5 表明,可扩展的通用智能体智能可以通过文本与视觉的联合优化以及并行智能体执行来实现。通过在预训练和强化学习中统一语言和视觉,模型实现了强大的跨模态对齐和视觉-文本推理。Agent Swarm 使异构子任务的并发执行成为可能,在降低推理延迟的同时提升复杂智能体工作负载上的性能。基于视觉-文本智能和智能体集群,Kimi K2.5 在基准测试和现实任务上展现出强劲性能。通过后训练检查点的开源,我们旨在支持开源社区构建可扩展的通用智能体系统,并加速向通用智能体智能的进展。

---

*D4 翻译完成。全文约 2800 行英文原文已逐段精译, 包含 16 处译者注。References 部分因篇幅原因略去, 完整引用列表见原文 D3。*

## 全文完

## 关联文件说明

| 文件 | 说明 |
| --- | --- |
| [03-Kimi-K2.5-mineru-en.md](./03-Kimi-K2.5-mineru-en.md) | MinerU 英文原文(D3), 含 46 张语义化插图 |
| [01-Kimi-K2.5技术报告精译.md](./01-Kimi-K2.5技术报告精译.md) | 中文精译主稿(D2) |
| [02-Kimi-K2.5推理架构剖析.md](./02-Kimi-K2.5推理架构剖析.md) | 推理架构与 Toggle 策略剖析(D2) |
| [05-Kimi-K2.5-Index.md](./05-Kimi-K2.5-Index.md) | 技术入口 Index(D5) |
| [05-Kimi-K2.5-Architecture-Overview.md](./05-Kimi-K2.5-Architecture-Overview.md) | 多模态 Agent Swarm 专题 |
| [pdfs/Kimi-K2.5-Technical-Report.pdf](./pdfs/Kimi-K2.5-Technical-Report.pdf) | 官方技术报告 PDF(arXiv:2602.02276) |
| [images/](./images/) | 论文插图 |

## Appendices
### 附录概要

**Appendix B: Pre-training Details.** 提供图 9 的完整训练曲线,展示不同视觉-文本比例(10:90, 20:80, 50:50)下视觉和语言任务的学习曲线。观察到中期融合和晚期融合阶段文本性能出现"下降-恢复"模式: 视觉数据首次引入时,文本能力最初下降后逐渐恢复,归因于模态域偏移。早期融合在整个训练过程中保持更健康稳定的文本性能曲线。

**Appendix B.2: Text Data.** Kimi K2.5 预训练文本语料库包含四个主要领域: Web Text、Code、Mathematics 和 Knowledge。增强了代码智能数据,包括(1)支持跨文件推理和架构理解的仓库级代码,(2)来自互联网的 issue、代码审查和提交历史,(3)从 PDF 和 webtext 语料库检索的代码相关文档。

**Appendix C: Vision Data.** 视觉数据包括图像-文本对(alt text、合成字幕、定位边界框、OCR 文本)和视频-文本对。采用两阶段对齐策略将 MoonViT-3D 与语言模型对齐。

**Appendix D: Unified Agentic RL Environment.** 标准化 Gym-like 接口支持统一智能体 RL,包括核心智能体循环、单智能体任务和用于 RL 的 API。

**Appendix E: Evaluation Details.** 详细评估协议,包括通用评估协议、智能体评估设置、Agent Swarm 配置等。

