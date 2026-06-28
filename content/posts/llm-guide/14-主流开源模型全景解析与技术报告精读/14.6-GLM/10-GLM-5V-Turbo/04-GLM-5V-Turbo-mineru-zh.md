---
title: "GLM-5V-Turbo Technical Report (MinerU 逐译+译者注)"
converted_by: PyMuPDF (MinerU fallback)
source_pdf: GLM-5V-Turbo.pdf
---


> 原始来源: GLM-5V-Turbo technical report PDF
> 提取方式: PyMuPDF 兜底提取 (MinerU 3.1.14 CLI 服务挂起)
> 翻译说明: 本文档为英中对照逐段翻译, 英文原文在前, 中文译文紧随其后. `> 译者注:` 为译者添加的技术点评与背景补充.
> GLM-5V-Turbo 是智谱 AI 推出的多模态 Agent 模型, 具备视觉理解、工具使用和长程任务执行能力.



GLM-5V-Turbo: Toward a Native Foundation Model
for Multimodal Agents
GLM-5V-Turbo Team
Z.ai & Tsinghua University
(For the complete list of authors, please refer to the Contribution section)
Abstract

GLM-5V-Turbo: 迈向面向多模态智能体的原生基础模型
GLM-5V-Turbo 团队
Z.ai & 清华大学
(完整作者列表请参阅 Contribution 章节)
摘要

We present GLM-5V-Turbo, a step toward native foundation models for multimodal agents. As foundation models are increasingly deployed in real environments, agentic capability depends not only on language reasoning, but also on the ability to perceive, interpret, and act over heterogeneous contexts such as images, videos, webpages, documents, GUIs. GLM-5V-Turbo is built around this objective: multimodal perception is integrated as a core component of reasoning, planning, tool use, and execution, rather than as an auxiliary interface to a language model. This report summarizes the main improvements behind GLM-5V-Turbo across model design, multimodal training, reinforcement learning, toolchain expansion, and integration with agent frameworks. These developments lead to strong performance in multimodal coding, visual tool use, and framework-based agentic tasks, while preserving competitive text-only coding capability. More importantly, our development process offers practical insights for building multimodal agents, highlighting the central role of multimodal perception, hierarchical optimization, and reliable end-to-end verification.

我们提出 GLM-5V-Turbo, 这是迈向面向多模态智能体(multimodal agents)的原生基础模型(native foundation model)的重要一步. 随着基础模型越来越多地被部署到真实环境中, 智能体能力(Agentic capability)不仅依赖于语言推理(language reasoning), 还依赖于对图像、视频、网页、文档、图形用户界面(GUI)等异构上下文(heterogeneous contexts)进行感知、解释和行动的能力. GLM-5V-Turbo 正是围绕这一目标构建的: 多模态感知(multimodal perception)被整合为推理、规划、工具使用和执行的核心组件, 而非仅仅是语言模型的辅助接口. 本报告总结了 GLM-5V-Turbo 在模型设计、多模态训练、强化学习(reinforcement learning)、工具链扩展以及与智能体框架集成方面的主要改进. 这些进展使其在多模态编程(multimodal coding)、视觉工具使用(visual tool use)和基于框架的智能体任务中取得了强劲表现, 同时保持了具有竞争力的纯文本编程能力. 更重要的是, 我们的开发过程为构建多模态智能体提供了实践洞察, 凸显了多模态感知、分层优化(hierarchical optimization)和可靠的端到端验证(end-to-end verification)的核心作用.

## 1 Overview

>  **[返回 14.6-GLM 家族总览](../../14.6-GLM.md)**

概述

Recent advances in foundation models have driven a shift from language understanding to agentic real-world interaction [4; 28; 49], opening up substantial opportunities for productivity gains in domains such as knowledge work [12; 27; 22], software engineering [20], and tasks that require interacting with graphical user interfaces [16; 43]. A general-purpose agentic model requires not only advanced intelligence, but also the ability to natively process complex multimodal context---including images, videos, text, webpages, and documents---and to integrate these heterogeneous inputs into a unified process of perception, reasoning, and decision-making [12; 5; 37].

基础模型的最新进展推动了从语言理解到智能体现实世界交互(agentic real-world interaction)的转变 [4; 28; 49], 在知识工作(knowledge work) [12; 27; 22]、软件工程(software engineering) [20]以及需要与图形用户界面交互的任务 [16; 43]等领域带来了显著的生产力提升机会. 一个通用的智能体模型(agentic model)不仅需要高级智能, 还需要原生处理复杂多模态上下文(multimodal context)的能力---包括图像、视频、文本、网页和文档---并将这些异构输入整合到统一的感知、推理和决策流程中 [12; 5; 37].

Toward this goal, we introduce a set of coordinated advances in model design, training, and infrastructure to enable more native multimodal modeling. In model design, we develop CogViT, a new vision encoder tailored for multimodal fine-grained understanding, and propose Multimodal Multi-Token Prediction, which supports both text-only and multimodal inputs while remaining friendly to large-scale infrastructure. In training, we deeply integrate vision and language throughout pre-training and supervised fine-tuning, and further perform joint reinforcement learning over more than 30 task categories spanning perception, reasoning, and agentic capabilities, supported by an optimized infrastructure stack for large-scale multimodal RL. Building on these advances, we further expand GLM-5V-Turbo's multimodal agentic capabilities through toolchain extension, framework integration, and ecosystem development. We present a vision-centric deep search benchmark ImageMining that evaluates models' ability to "think and deep search with image".

为实现这一目标, 我们在模型设计、训练和基础设施方面引入了一系列协同进展, 以实现更原生的多模态建模. 在模型设计上, 我们开发了 CogViT, 一种专为多模态细粒度理解(fine-grained understanding)量身定制的新型视觉编码器(vision encoder), 并提出了多模态多令牌预测(Multimodal Multi-Token Prediction, MMTP), 它同时支持纯文本和多模态输入, 且对大规模基础设施友好. 在训练方面, 我们在预训练(pre-training)和监督微调(supervised fine-tuning, SFT)阶段深度整合了视觉与语言, 并进一步在涵盖感知、推理和智能体能力的 30 多个任务类别上执行联合强化学习(joint reinforcement learning), 这得益于为大规模多模态 RL 优化的基础设施栈. 基于这些进展, 我们通过工具链扩展、框架集成和生态建设进一步增强了 GLM-5V-Turbo 的多模态智能体能力. 我们还提出了一个以视觉为中心的深度搜索基准(benchmark) ImageMining, 用于评估模型"以图像思考和深度搜索"(think and deep search with image)的能力.

These developments endow GLM-5V-Turbo with native multimodal agentic capability, while retaining strong text-based agentic and coding performance relative to its language-only base model GLM-5-Turbo. This is reflected both in benchmark results and in its effectiveness in practical agentic settings, including chatbot-style environments such as Z.ai and framework-based scenarios such as Claude Code [3] and OpenClaw [29]. GLM-5V-Turbo achieves strong results on multimodal agentic benchmarks, including multimodal tool use (30.7 on ImageMining, 51.9 on BrowseComp-VL [10], 72.9 on MMSearch [18], and 78.2 on SimpleVQA [7]), GUI agent tasks (75.7 on AndroidWorld [30] and 62.3 on OSWorld [44]), and Claw-based evaluations (87.0/80.7 on PinchBench [1], 57.7/75.0 on ClawEval [46], and 57.6 on ZClawBench [2]). GLM-5V-Turbo also demonstrates strong coding performance in both multimodal and text-only settings. For the multimodal setting, GLM-5V-Turbo achieves 94.8 on Design2Code [31], outperforming Claude Opus 4.6 [4]; for the text-only setting, GLM-5V-Turbo preserves the coding capability of its language-only base model GLM-5-Turbo and even surpasses it on CC-Backend (22.8), CC-Frontend (68.4), and CC-RepoExploration (72.2) [49].

这些进展赋予了 GLM-5V-Turbo 原生的多模态智能体能力, 同时相对于其纯文本基座模型 GLM-5-Turbo 保留了强大的基于文本的智能体和编程性能. 这既体现在基准测试结果中, 也体现在其在实际智能体场景中的有效性上, 包括 Z.ai 等聊天机器人风格环境以及 Claude Code [3] 和 OpenClaw [29] 等基于框架的场景. GLM-5V-Turbo 在多模态智能体基准测试中取得了强劲成绩, 包括多模态工具使用(ImageMining 30.7、BrowseComp-VL [10] 51.9、MMSearch [18] 72.9 和 SimpleVQA [7] 78.2)、GUI 智能体任务(AndroidWorld [30] 75.7 和 OSWorld [44] 62.3)以及基于 Claw 的评估(PinchBench [1] 87.0/80.7、ClawEval [46] 57.7/75.0 和 ZClawBench [2] 57.6). GLM-5V-Turbo 在多模态和纯文本设置下均展现出强劲的编程性能. 在多模态设置下, GLM-5V-Turbo 在 Design2Code [31] 上取得 94.8 分, 超越了 Claude Opus 4.6 [4]; 在纯文本设置下, GLM-5V-Turbo 保留了其纯文本基座模型 GLM-5-Turbo 的编程能力, 甚至在 CC-Backend (22.8)、CC-Frontend (68.4) 和 CC-RepoExploration (72.2) [49] 上超越了它.

Developing GLM-5V-Turbo also surfaced several broader lessons for agentic model development. Perception remains foundational to higher-level multimodal capability, while agentic competence is often acquired more effectively through hierarchical optimization than through monolithic end-to-end training. In addition, end-to-end agent tasks require clear specification, reliable verification, and carefully controlled evaluation for effective construction, assessment, and optimization. In this report, we summarize the main practices and lessons from developing GLM-5V-Turbo to inform future work on native multimodal agents.

开发 GLM-5V-Turbo 也为智能体模型开发揭示了几条更广泛的教训. 感知仍然是更高级多模态能力的基础, 而智能体能力(agentic competence)通常通过分层优化(hierarchical optimization)比通过单体端到端训练(monolithic end-to-end training)更有效地获得. 此外, 端到端智能体任务需要清晰的规范、可靠的验证以及严格控制的评估, 才能进行有效的构建、评估和优化. 在本报告中, 我们总结了开发 GLM-5V-Turbo 的主要实践和教训, 以期为未来的原生多模态智能体研究提供参考.

arXiv:2604.26752v3  [cs.CV]  12 May 2026

arXiv:2604.26752v3  [cs.CV]  2026年5月12日



settings, including chatbot-style environments such as Z.ai and framework-based scenarios such as Claude Code [3] and OpenClaw [29]. GLM-5V-Turbo achieves strong results on multimodal agentic benchmarks, including multimodal tool use (30.7 on ImageMining, 51.9 on BrowseComp-VL [10], 72.9 on MMSearch [18], and 78.2 on SimpleVQA [7]), GUI agent tasks (75.7 on AndroidWorld [30] and 62.3 on OSWorld [44]), and Claw-based evaluations (87.0/80.7 on PinchBench [1], 57.7/75.0 on ClawEval [46], and 57.6 on ZClawBench [2]). GLM-5V-Turbo also demonstrates strong coding performance in both multimodal and text-only settings. For the multimodal setting, GLM-5V-Turbo achieves 94.8 on Design2Code [31], outperforming Claude Opus 4.6 [4]; for the text-only setting, GLM-5V-Turbo preserves the coding capability of its language-only base model GLM-5-Turbo and even surpasses it on CC-Backend (22.8), CC-Frontend (68.4), and CC-RepoExploration (72.2) [49].

上述表现既体现在基准测试结果中, 也体现在实际智能体场景的有效性上, 包括 Z.ai 等聊天机器人风格环境以及 Claude Code [3] 和 OpenClaw [29] 等基于框架的场景. GLM-5V-Turbo 在多模态智能体基准测试中取得了强劲成绩, 包括多模态工具使用(ImageMining 30.7、BrowseComp-VL [10] 51.9、MMSearch [18] 72.9 和 SimpleVQA [7] 78.2)、GUI 智能体任务(AndroidWorld [30] 75.7 和 OSWorld [44] 62.3)以及基于 Claw 的评估(PinchBench [1] 87.0/80.7、ClawEval [46] 57.7/75.0 和 ZClawBench [2] 57.6). GLM-5V-Turbo 在多模态和纯文本设置下均展现出强劲的编程性能. 在多模态设置下, GLM-5V-Turbo 在 Design2Code [31] 上取得 94.8 分, 超越了 Claude Opus 4.6 [4]; 在纯文本设置下, GLM-5V-Turbo 保留了其纯文本基座模型 GLM-5-Turbo 的编程能力, 甚至在 CC-Backend (22.8)、CC-Frontend (68.4) 和 CC-RepoExploration (72.2) [49] 上超越了它.

Developing GLM-5V-Turbo also surfaced several broader lessons for agentic model development. Perception remains foundational to higher-level multimodal capability, while agentic competence is often acquired more effectively through hierarchical optimization than through monolithic end-to-end training. In addition, end-to-end agent tasks require clear specification, reliable verification, and carefully controlled evaluation for effective construction, assessment, and optimization. In this report, we summarize the main practices and lessons from developing GLM-5V-Turbo to inform future work on native multimodal agents.

开发 GLM-5V-Turbo 也为智能体模型开发揭示了几条更广泛的教训. 感知仍然是更高级多模态能力的基础, 而智能体能力通常通过分层优化比通过单体端到端训练更有效地获得. 此外, 端到端智能体任务需要清晰的规范、可靠的验证以及严格控制的评估, 才能进行有效的构建、评估和优化. 在本报告中, 我们总结了开发 GLM-5V-Turbo 的主要实践和教训, 以期为未来的原生多模态智能体研究提供参考.

## 2 Model, Training, and Infrastructure
模型、训练与基础设施

### 2.1 CogViT Vision Encoder

We develop CogViT, a novel parameter-efficient vision encoder tailored for multimodal perception and downstream agent-oriented tasks. It delivers strong capabilities in general object recognition, fine-grained understanding, as well as geometric and spatial perception. As illustrated in Figure 1, CogViT achieves competitive performance across these domains. To balance representation learning with cross-modal alignment, we employ a two-stage pretraining recipe.

我们开发了 CogViT, 一种新颖的参数量高效(parameter-efficient)的视觉编码器, 专为多模态感知和下游面向智能体的任务量身定制. 它在通用目标识别(general object recognition)、细粒度理解以及几何与空间感知方面具备强大能力. 如图 1 所示, CogViT 在这些领域均取得了具有竞争力的表现. 为了在表示学习(representation learning)与跨模态对齐(cross-modal alignment)之间取得平衡, 我们采用了一种两阶段预训练方案(two-stage pretraining recipe).

Figure 1: Performance comparison of CogViT with other state-of-the-art vision encoders across general and fine-grained multimodal tasks.

图 1: CogViT 与其他最先进(state-of-the-art)视觉编码器在通用和细粒度多模态任务上的性能对比.

In the first stage, we use distillation-based masked image modeling to strengthen visual representations. Specifically, we train the student ViT to reconstruct the masked regions (35% masking ratio, 224 x 224 resolution) in the feature spaces of dual teacher models: SigLIP2 [39] for semantic representations and DINOv3 [32] for texture features. The training data follows a quality-aware mixture strategy: 80% high-quality natural images, 10% instruction-following data, and 10% scientific imagery. We optimize with Muon [21] optimizer with a cosine decay schedule. Additionally, we introduce QK-Norm [15] to normalize query and key vectors before attention computation, effectively mitigating logit explosion and ensuring stability at scale.

在第一阶段, 我们使用基于蒸馏(distillation-based)的掩码图像建模(masked image modeling)来增强视觉表示. 具体来说, 我们训练学生 ViT 在双教师模型(dual teacher models)的特征空间中重建被掩码的区域(掩码比例 35%, 分辨率 224 x 224): SigLIP2 [39] 用于语义表示(semantic representations), DINOv3 [32] 用于纹理特征(texture features). 训练数据遵循质量感知的混合策略(quality-aware mixture strategy): 80% 高质量自然图像、10% 指令遵循数据(instruction-following data)和 10% 科学图像. 我们使用 Muon [21] 优化器配合余弦衰减调度(cosine decay schedule)进行优化. 此外, 我们引入 QK-Norm [15] 在注意力计算前对查询(query)和键(key)向量进行归一化, 有效缓解对数几率爆炸(logit explosion)并确保大规模训练时的稳定性.

The second stage shifts to contrastive image-text pretraining to align visual and textual features in a shared embedding space. Compared to the first stage, we introduce three key upgrades: (1) replacing the fixed 224 x 224 resolution with the NaFlex [39] scheme to process variable-size inputs while preserving original aspect ratios; (2) scaling the global batch size to 64K using the sigmoid-based SigLIP loss, combined with a bidirectional distributed implementation for efficiency; and (3) utilizing an 8-billion bilingual (Chinese-English) image-text corpus to enhance cross-lingual understanding. We continue to optimize with Muon, assigning module-specific learning rates and decay schedules to the vision, text, and projection components.

第二阶段转向对比式图像-文本预训练(contrastive image-text pretraining), 以在共享嵌入空间(shared embedding space)中对齐视觉和文本特征. 与第一阶段相比, 我们引入了三项关键升级: (1) 用 NaFlex [39] 方案替代固定的 224 x 224 分辨率, 以处理可变尺寸输入同时保持原始宽高比; (2) 使用基于 sigmoid 的 SigLIP 损失将全局批次大小(global batch size)扩展到 64K, 并结合双向分布式实现以提升效率; (3) 利用 80 亿规模的双语(中英)图像-文本语料库增强跨语言理解. 我们继续使用 Muon 优化, 为视觉、文本和投影组件分配模块特定的学习率和衰减调度.



replacing the fixed 224 x 224 resolution with the NaFlex [39] scheme to process variable-size inputs while preserving original aspect ratios; (2) scaling the global batch size to 64K using the sigmoid-based SigLIP loss, combined with a bidirectional distributed implementation for efficiency; and (3) utilizing an 8-billion bilingual (Chinese-English) image-text corpus to enhance cross-lingual understanding. We continue to optimize with Muon, assigning module-specific learning rates and decay schedules to the vision, text, and projection components.

用 NaFlex [39] 方案替代固定的 224 x 224 分辨率, 以处理可变尺寸输入同时保持原始宽高比; (2) 使用基于 sigmoid 的 SigLIP 损失将全局批次大小扩展到 64K, 并结合双向分布式实现以提升效率; (3) 利用 80 亿规模的双语(中英)图像-文本语料库增强跨语言理解. 我们继续使用 Muon 优化, 为视觉、文本和投影组件分配模块特定的学习率和衰减调度.

### 2.2 Multimodal Multi-Token Prediction

We propose Multimodal Multi-Token Prediction (MMTP), a multimodal extension of multi-token prediction (MTP) [11], designed to support both text-only and multimodal inputs while remaining friendly to large-scale infrastructure. The goal is to preserve acceptable length as well as training and inference efficiency in multimodal settings. In standard text-only MTP, prefix tokens can be passed into the MTP head directly through token IDs and embedded with the word embedding layer. Once MTP is extended to multimodal inputs, however, a central question arises: how should image tokens be passed to the MTP head? To answer this, we systematically compare three alternatives:

我们提出了多模态多令牌预测(Multimodal Multi-Token Prediction, MMTP), 它是多令牌预测(multi-token prediction, MTP) [11] 的多模态扩展, 旨在同时支持纯文本和多模态输入, 且对大规模基础设施友好. 其目标是在多模态设置下保持可接受的长度以及训练和推理效率. 在标准纯文本 MTP 中, 前缀令牌(prefix tokens)可以通过令牌 ID 直接传入 MTP 头(MTP head), 并通过词嵌入层(word embedding layer)进行嵌入. 然而, 一旦将 MTP 扩展到多模态输入, 一个核心问题便随之而来: 图像令牌(image tokens)应如何传递给 MTP 头? 为回答这一问题, 我们系统性地比较了三种替代方案:

The first directly passes the visual embeddings from the LLM backbone input to the MTP head; The second masks out all visual tokens at the MTP head input, reducing the design to text-only MTP; The third preserves visual positional information, but replaces all visual tokens with a shared learnable <|image|> special token as the visual input representation.

第一种方案直接将 LLM 主干(backbone)输入端的视觉嵌入(visual embeddings)传递给 MTP 头; 第二种方案在 MTP 头输入端掩码掉所有视觉令牌, 将设计退化为纯文本 MTP; 第三种方案保留视觉位置信息, 但将所有视觉令牌替换为一个共享的可学习 <|image|> 特殊令牌作为视觉输入表示.

Considering both optimization behavior and system efficiency, GLM-5V-Turbo ultimately adopts the third design. Compared with directly passing visual embeddings to the MTP head, using the <|image|> token removes the need to propagate visual embeddings across pipeline-parallel stages, substantially reducing communication complexity while improving system scalability and engineering maintainability. Empirically, according to the ablation study on a 0.5B model, the <|image|>-based design achieves lower training loss and more stable convergence than directly using visual embeddings. We hypothesize that this is because the MTP head is typically lightweight, and may not have sufficient modeling capacity to effectively absorb visual representations whose distribution differs substantially from that of text embeddings; by contrast, the <|image|> token presents the input in a more uniform form and thus alleviates this optimization difficulty. At the same time, compared with fully masking out visual tokens, this design remains naturally compatible with existing partitioning strategies such as sequence parallelism and context parallelism, without requiring additional handling for visual-embedding partitioning, alignment, or offset mapping, which reduces implementation complexity. Overall, the design gives GLM-5V-Turbo a more balanced trade-off among multimodal modeling capability, training stability, and system efficiency.

综合考虑优化行为和系统效率, GLM-5V-Turbo 最终采用了第三种设计. 与直接将视觉嵌入传递给 MTP 头相比, 使用 <|image|> 令牌消除了跨流水线并行(pipeline-parallel)阶段传播视觉嵌入的需求, 大幅降低了通信复杂度, 同时提升了系统可扩展性和工程可维护性. 经验上, 根据在 0.5B 模型上的消融实验(ablation study), 基于 <|image|> 的设计比直接使用视觉嵌入取得了更低的训练损失和更稳定的收敛. 我们假设这是因为 MTP 头通常是轻量级的, 可能没有足够的建模容量来有效吸收分布与文本嵌入差异较大的视觉表示; 相比之下, <|image|> 令牌以更统一的形式呈现输入, 从而缓解了这种优化困难. 同时, 与完全掩码视觉令牌相比, 该设计天然兼容现有的并行划分策略, 如序列并行(sequence parallelism)和上下文并行(context parallelism), 无需对视觉嵌入划分、对齐或偏移映射进行额外处理, 降低了实现复杂度. 总体而言, 该设计使 GLM-5V-Turbo 在多模态建模能力、训练稳定性和系统效率之间取得了更平衡的权衡.

> 译者注: MMTP 的设计选择体现了工程实现与优化目标的深度耦合. 使用 <|image|> 占位符而非直接传播视觉嵌入, 不仅降低了流水线并行中的通信开销, 也规避了轻量 MTP 头对异构分布(视觉 vs 文本)的建模不足. 这一折中方案值得在多模态基础设施设计中参考.

v!!
v!"
t!
t"
v"!
v""
t#
t$
t%
Option 1: Direct Vision Embeddings
v!!
v!"
t!
t"
v"!
v""
t#
t$
t%
Option 2: Masked Vision Tokens
t!
t"
t#
t$
t%
Option 3: <|image|> placeholder (Adopted)
<|image|>
<|image|>
MTP Module 3
MTP Module 2
MTP Module 1
Shared Parameters
Transformer Block x L
v!!
v!"
t!
t"
v"!
v""
t#
t$
t%
CogViT + MLP Adapter
Embedding Layer
Visual Inputs
Text Inputs
Figure 2: Illustration of our multimodal multi-token prediction (MMTP) design. Bottom-left: Training loss curves comparing Option 1 and Option 3, where the adopted design achieves lower loss.
v!"
t!
t"
v"!
v""
t#
t$
t%
方案 1: 直接视觉嵌入
v!!
v!"
t!
t"
v"!
v""
t#
t$
t%
方案 2: 掩码视觉令牌
t!
t"
t#
t$
t%
方案 3: <|image|> 占位符(已采用)
<|image|>
<|image|>
MTP 模块 3
MTP 模块 2
MTP 模块 1
共享参数
Transformer Block x L
v!!
v!"
t!
t"
v"!
v""
t#
t$
t%
CogViT + MLP 适配器(Adapter)
嵌入层(Embedding Layer)
视觉输入
文本输入
图 2: 我们的多模态多令牌预测(MMTP)设计示意图. 左下: 方案 1 与方案 3 的训练损失曲线对比, 其中被采用的设计取得了更低的损失.

### 2.3 Broad training across perception, reasoning, and agent capability
跨感知、推理与智能体能力的广泛训练

The practical performance of multimodal agents depends on the joint development of perception, reasoning, planning, and execution, making narrow, domain-specific optimization insufficient. To improve these capabilities, we deeply integrate vision and language starting from the pretraining stage, strengthening the model's native ability to represent and process multimodal context. During the pre-training phase, we utilize a mixture of plain text and multimodal data to foster a balanced development of diverse capabilities. The multimodal datasets encompass a wide array of categories, including world knowledge, interleaved image-text, OCR, coding, GUI, video, multimodal tool-use, spatial perception, grounding, and academic problem-solving. We place particular emphasis on multimodal coding data to better align visual understanding with code generation and to improve the model's performance in multimodal agentic tasks.

多模态智能体的实际性能依赖于感知、推理、规划和执行的协同发展, 这使得狭窄的、特定领域的优化变得不足. 为提升这些能力, 我们从预训练阶段开始就深度整合视觉与语言, 强化模型表示和处理多模态上下文的原生能力. 在预训练阶段, 我们使用纯文本和多模态数据的混合来促进多种能力的均衡发展. 多模态数据集涵盖广泛的类别, 包括世界知识、交错图文(interleaved image-text)、OCR、编程、GUI、视频、多模态工具使用、空间感知、定位(grounding)和学术问题求解. 我们特别重视多模态编程数据, 以更好地将视觉理解与代码生成对齐, 并提升模型在多模态智能体任务中的表现.

GLM-5V-Turbo further undergoes joint RL optimization over more than 30 task categories. We adopt several technical improvements such as relative visual policy optimization in UI-to-code tasks [45]. This broad training setup yields gains at multiple levels: on the perceptual side, the model improves on tasks such as 2D image grounding and pointing (compared to SFT, the RL stage achieves improvements of 4.8% and 3.2% On RefCOCO-avg [23] and PointBench [6] respectively), video understanding (+5.6% on MVBench [24]), 3D grounding (+7.7% on SUNRGBD [33]), OCR (+4.2% on OCRBench [25]), and chart understanding (+7.7% on CharXiv [40]); on reasoning-heavy tasks such as STEM (+1.8% on MMMU_Val [47], MMMU_Pro [48], MathVista [26] and LogicVista [42]), it exhibits greater stability in problem solving; and in agentic settings---including GUI agents (+4.9% on OSWorld [43]), coding agents (+0.2% on CC-Backend [49]), and general tool use (+3.5% on MMSearch [19] which demonstrates improved planning and execution). Importantly, these gains are not confined to a single task family, but remain relatively consistent across a broad set of tasks.

GLM-5V-Turbo 进一步在 30 多个任务类别上进行了联合 RL 优化. 我们采用了多项技术改进, 例如 UI-to-code 任务中的相对视觉策略优化(relative visual policy optimization) [45]. 这种广泛的训练设置在多个层面带来了提升: 在感知层面, 模型在 2D 图像定位和指向任务上取得进步(与 SFT 相比, RL 阶段在 RefCOCO-avg [23] 和 PointBench [6] 上分别提升了 4.8% 和 3.2%), 视频理解(MVBench [24] +5.6%)、3D 定位(SUNRGBD [33] +7.7%)、OCR (OCRBench [25] +4.2%)和图表理解(CharXiv [40] +7.7%); 在重推理任务如 STEM 上(MMMU_Val [47]、MMMU_Pro [48]、MathVista [26] 和 LogicVista [42] 平均 +1.8%), 模型在问题求解中展现出更强的稳定性; 在智能体场景中---包括 GUI 智能体(OSWorld [43] +4.9%)、编程智能体(CC-Backend [49] +0.2%)和通用工具使用(MMSearch [19] +3.5%, 体现了规划和执行能力的提升). 重要的是, 这些增益不局限于单一任务家族, 而是在广泛的任务集合中保持相对一致.

> 译者注: GLM-5V-Turbo 的训练范式展现了视觉-语言对齐(vision-language alignment)与强化学习的深度融合. 多任务 RL 不仅在单一领域有效, 更通过策略模式的跨任务迁移实现了协同增益, 这为构建统一的多模态能力结构提供了实证支持.

This multi-task RL setting also exhibits several properties that we have consistently observed in earlier explorations such as GLM-4.1V-Thinking and GLM-4.5V [37]. Compared with the cross-domain trade-offs often seen in SFT, RL tends to show weaker interference across domains, allowing multiple domains to improve together with stable gains. Interestingly, in domains with narrower distributions where single-task RL is often prone to oscillation, collaborative training can make optimization more stable by exposing the model to a richer distribution of strategies and steering it toward more robust solutions. Beyond this, we observe some transfer of thinking patterns across tasks: reasoning behaviors acquired in one domain can sometimes carry over to another and produce measurable benefits there as well. This suggests that the value of multi-task RL lies not only in covering a broader range of tasks, but also in inducing deeper sharing at the level of strategy patterns.

这种多任务 RL 设置还展现出我们在早期探索(如 GLM-4.1V-Thinking 和 GLM-4.5V [37])中持续观察到的若干特性. 与 SFT 中常见的跨领域权衡(cross-domain trade-offs)相比, RL 倾向于表现出更弱的跨领域干扰, 使多个领域能够同步提升并获得稳定的增益. 有趣的是, 在分布较窄的领域, 单任务 RL 往往容易出现震荡(oscillation), 而协作训练可以通过让模型接触更丰富的策略分布来使优化更加稳定, 并引导其走向更鲁棒的解决方案. 除此之外, 我们还观察到思维模式的跨任务迁移: 在一个领域获得的推理行为有时会迁移到另一领域并在那里产生可测量的收益. 这表明多任务 RL 的价值不仅在于覆盖更广泛的任务范围, 还在于在策略模式层面诱导更深层的共享.

At the same time, broad coverage in joint optimization does not mean that the problem is fully resolved. We do observe that capabilities left uncovered during RL can sometimes decline after post-training, especially those more orthogonal to the trained task distribution. One plausible explanation is that, as RL proceeds, both model capacity and learned thinking patterns become increasingly concentrated around the sampled task distribution, weakening the model's ability to retain performance in under-represented domains. This suggests that the scope of task coverage during RL is itself an important factor shaping the model's eventual generalization boundary. Even when a target capability cannot be easily formulated directly as an RL task, semantically or structurally related proxy tasks may provide useful optimization signals. For example, RL on single-turn UI-to-code generation can support more complex multi-turn coding ability. Taken together, these observations suggest that multi-task collaborative RL, including on-policy distillation, is not merely a tool for improving individual capabilities, but a central path toward shaping a more unified multimodal capability structure over a broader agentic distribution.

与此同时, 联合优化中的广泛覆盖并不意味着问题已完全解决. 我们确实观察到, 在 RL 中未被覆盖的能力有时会在训练后出现下降, 尤其是那些与训练任务分布更正交(orthogonal)的能力. 一个合理的解释是, 随着 RL 的进行, 模型容量和学到的思维模式都越来越集中在采样任务分布周围, 削弱了模型在代表性不足领域保持性能的能力. 这表明 RL 期间任务覆盖的范围本身就是塑造模型最终泛化边界(generalization boundary)的重要因素. 即使某项目标能力无法被直接表述为 RL 任务, 语义或结构上相关的代理任务(proxy tasks)也可能提供有用的优化信号. 例如, 在单轮 UI-to-code 生成上进行 RL 可以支持更复杂的多轮编程能力. 综合起来, 这些观察表明多任务协作 RL(包括策略蒸馏, on-policy distillation)不仅仅是提升单项能力的工具, 更是在更广泛的智能体分布上塑造更统一的多模态能力结构的核心路径.

### 2.4 Multimodal RL at Scale
大规模多模态强化学习

In the agent era, training infrastructure faces much stricter demands on both efficiency and stability, especially in large-scale multi-task multimodal reinforcement learning (RL). Compared with conventional training, this setting must handle wide variation in prompt and response lengths, support both single-step and multi-step tasks, and coordinate one or more rule-based or model-based verifiers for each task. To address these challenges, we systematically redesign the training stack along four dimensions: unified task and reward abstraction, end-to-end asynchrony and stage overlap, fine-grained memory management for multimodal workloads, and topology-aware partitioning and load balancing for visual inputs.

在智能体时代, 训练基础设施在效率和稳定性方面面临更严格的要求, 尤其是在大规模多任务多模态强化学习(RL)中. 与传统训练相比, 这种设置必须处理提示(prompt)和回复长度的巨大变化, 支持单步和多步任务, 并为每个任务协调一个或多个基于规则(rule-based)或基于模型(model-based)的验证器(verifiers). 为应对这些挑战, 我们从四个维度系统性地重新设计了训练栈(training stack): 统一的任务与奖励抽象(unified task and reward abstraction)、端到端异步与阶段重叠(end-to-end asynchrony and stage overlap)、面向多模态工作负载的细粒度内存管理(fine-grained memory management), 以及针对视觉输入的拓扑感知划分与负载均衡(topology-aware partitioning and load balancing).

Unified task and reward abstraction.
We build a unified VLM RL Gym that provides a consistent environment interface for both single-step and multi-step tasks, so that heterogeneous task types can be handled within the same training framework. In parallel, we introduce an independent reward system that centrally orchestrates multiple verifiers. Rule-based verifiers are executed locally and synchronously, while model-based judges are invoked asynchronously through APIs; their outputs are then combined into rewards through configurable aggregation strategies, without entangling verifier logic with the main training codepath. To improve observability in mixed-task training, each sample also carries a data-source tag, allowing source-specific metrics such as reward and pass@k to be aggregated across parallel groups and reported separately.

统一的任务与奖励抽象.
我们构建了一个统一的 VLM RL Gym, 为单步和多步任务提供一致的环境接口, 从而使异构任务类型可以在同一训练框架内处理. 同时, 我们引入了一个独立的奖励系统, 集中编排(orchestrate)多个验证器. 基于规则的验证器在本地同步执行, 而基于模型的评判器(judges)则通过 API 异步调用; 它们的输出随后通过可配置的聚合策略(aggregation strategies)组合成奖励, 无需将验证器逻辑与主训练代码路径纠缠在一起. 为提高混合任务训练中的可观测性(observability), 每个样本还携带数据源标签(data-source tag), 允许跨并行组聚合并单独报告特定来源的指标(如奖励和 pass@k).

Full-pipeline decoupling, asynchrony, and stage overlap.
We restructure the training pipeline to decouple rollout inference, reward evaluation, batch construction and weight transfer, to maximize overlap across these stages. Each inference request is registered with a completion callback, so reward computation can be triggered as soon as that request finishes, rather than waiting for the entire rollout batch to complete; this reduces pipeline idle time caused by long-tail requests. Batch construction is executed in parallel with CPU-GPU transfer of old-policy weights. For the reference model, parameters remain resident on CPU memory, are asynchronously prefetched to GPU immediately before reference forward, and are released right after use, allowing reference computation to overlap effectively with the main training step. The system also supports two early-abort modes, based on either completion count or time threshold. Aborted prompts can be cached and reused, which helps control long-tail latency without materially reducing data utilization.

全流水线解耦、异步与阶段重叠.
我们重构了训练流水线, 将 rollout 推理、奖励评估、批次构建和权重传输解耦, 以最大化这些阶段之间的重叠. 每个推理请求都注册了一个完成回调(completion callback), 因此奖励计算可以在该请求完成时立即触发, 而无需等待整个 rollout 批次完成; 这减少了由长尾请求(long-tail requests)导致的流水线空闲时间. 批次构建与旧策略权重的 CPU-GPU 传输并行执行. 对于参考模型(reference model), 参数常驻于 CPU 内存, 在参考前向(reference forward)之前异步预取(async prefetch)到 GPU, 并在使用后立即释放, 使参考计算能够有效与主训练步骤重叠. 系统还支持两种早期中止(early-abort)模式, 基于完成计数或时间阈值. 被中止的提示可以被缓存和重用, 这有助于控制长尾延迟而不实质降低数据利用率.

Fine-grained runtime memory management for multimodal workloads.
Standard recomputation schemes are largely designed around text-only training and do not adequately address the memory bottlenecks introduced by multimodal inputs. To address this, we design separate memory-management strategies for the vision-side ViT and projector modules, combining targeted recomputation with CPU offloading. This prevents activation memory from scaling linearly with the number of images in the naive way, and substantially reduces runtime memory pressure while preserving overall computational efficiency.

面向多模态工作负载的细粒度运行时内存管理.
标准的重计算(recomputation)方案主要围绕纯文本训练设计, 无法充分解决多模态输入带来的内存瓶颈. 为此, 我们为视觉侧的 ViT 和投影器(projector)模块设计了独立的内存管理策略, 结合有针对性的重计算与 CPU 卸载(CPU offloading). 这防止了激活内存(activation memory)以朴素方式随图像数量线性增长, 并在保持整体计算效率的同时大幅降低了运行时内存压力.

Topology-aware partitioning and dynamic load balancing for visual inputs.
For visual inputs such as long videos, where sequence lengths vary significantly, we further introduce a topology-aware partitioning and dynamic load-balancing scheme. In a conventional implementation, partitioning is performed during the forward pass, which means each rank must first hold the full patch tensor before redistribution, leading to unnecessary memory and communication overhead. To address this, we move CP and TP partitioning upstream into the data-loading stage and align partition boundaries with downsample groups, thereby eliminating the need for cross-rank patch aggregation. After load balancing across DP groups, precise dispatch is carried out through asynchronous all-to-all communication, so that each rank receives only the partition it actually needs. We further move large Python objects off the GPU communication path and onto the CPU path, which reduces GPU communication buffer overhead by about 7 GB in practice. For the variable-length sequences produced during rollout, we additionally perform joint bin-packing over both sequence length and ViT token count, leading to better-balanced micro-batches for both compute and memory pressure.

针对视觉输入的拓扑感知划分与动态负载均衡.
对于长视频等序列长度变化显著的视觉输入, 我们进一步引入了拓扑感知划分(topology-aware partitioning)和动态负载均衡方案. 在常规实现中, 划分在前向传播期间执行, 这意味着每个 rank 必须首先持有完整的 patch 张量再进行重新分配, 导致不必要的内存和通信开销. 为解决这一问题, 我们将 CP (上下文并行) 和 TP (张量并行) 划分上移至数据加载阶段, 并将划分边界与下采样组(downsample groups)对齐, 从而消除了跨 rank 的 patch 聚合需求. 在 DP (数据并行) 组间完成负载均衡后, 通过异步 all-to-all 通信执行精确分发, 使每个 rank 仅接收其实际需要的分区. 我们进一步将大型 Python 对象从 GPU 通信路径移至 CPU 路径, 这在实践中将 GPU 通信缓冲区开销减少了约 7 GB. 对于 rollout 过程中产生的变长序列, 我们还对序列长度和 ViT 令牌计数执行联合装箱(joint bin-packing), 从而在计算和内存压力两方面实现更均衡的微批次(micro-batches).

> 译者注: 大规模多模态 RL 的基础设施设计是 GLM-5V-Turbo 的工程亮点之一. 将 CP/TP 划分前移至数据加载阶段、联合装箱优化变长序列、以及分离规则验证与模型评判的异步奖励系统, 这些设计共同解决了视觉输入带来的内存爆炸和流水线气泡问题, 对工业级多模态训练栈具有重要参考价值.

## 3 Multimodal Agent Capabilities and Ecosystem
多模态智能体能力与生态

### 3.1 Multimodal Toolchain Expansion

GLM-5V-Turbo further expands its multimodal toolchain1, enabling the model to support a fuller perception-planning-execution loop in more realistic environments. In addition to expanding its repertoire of visual tools, the model demonstrates a sophisticated ability to maintain long-horizon engagement, frequently switching between multimodal search, annotation, screenshotting, and multimodal webpage reading tools to achieve thorough task resolution. Consequently, coding and task execution are no longer confined to textual interfaces but are instead iteratively grounded in a comprehensive, vision-based understanding of the environment.

GLM-5V-Turbo 进一步扩展了其多模态工具链1, 使模型能够在更真实的环境中支持更完整的感知-规划-执行(perception-planning-execution)循环. 除了扩展视觉工具库(repertoire)外, 模型还展现出维持长程交互(long-horizon engagement)的复杂能力, 频繁在多模态搜索、标注(annotation)、截图(screenshotting)和多模态网页阅读工具之间切换, 以实现彻底的任务解决. 因此, 编程和任务执行不再局限于文本界面, 而是基于对环境的全面视觉理解进行迭代式落地.

1The proprietary tools can be accessed and experienced through GLM-5V-Turbo model on https://chat.z.ai/.

1这些专有工具可通过 https://chat.z.ai/ 上的 GLM-5V-Turbo 模型访问和体验.

Table 1: Categorization of multimodal tools and processing functions based on application scenarios and tool sets. Tools prefixed with zai_ are proprietary developments, while the GLM-5V-Turbo model also maintains compatibility with other user-defined custom tools.
Scenarios
Tool Sets
Tool Names
General
Recognition Tools
zai_recognize_plant
zai_recognize_location
zai_recognize_person
Multimodal Search
zai_search_web_text
zai_search_web_by_image
zai_search_similar_images
zai_search_web_images
zai_search_scholar
Browser Tools
zai_load_image_from_url
zai_read_webpage
Image Processing
zai_crop_image
zai_draw_image_bounding_boxes
zai_draw_image_point_markers
zai_draw_image_geometry
zai_draw_image_3d_bounding_boxes
zai_draw_video_objects_tracking
Creation
Web Creation
submit_plan
apply_edits
zai_generate_web_html
zai_generate_web_outline
Slide Creation
zai_generate_slide_html
zai_generate_outline_ppt
Deep Research
Multimodal DR Tools
zai_dr_python
zai_dr_open_url_mm
zai_dr_visit_img
zai_dr_search
zai_dr_images_search
zai_dr_images_lens

表 1: 基于应用场景和工具集的多模态工具与处理功能分类. 以 zai_ 为前缀的工具为专有开发, GLM-5V-Turbo 模型同时保持与其他用户自定义工具的兼容性.

| 应用场景 (Scenarios) | 工具集 (Tool Sets) | 工具名称 (Tool Names) |
| --- | --- | --- |
| 通用 (General) | 识别工具 (Recognition Tools) | zai_recognize_plant, zai_recognize_location, zai_recognize_person |
| 多模态搜索 (Multimodal Search) | - | zai_search_web_text, zai_search_web_by_image, zai_search_similar_images, zai_search_web_images, zai_search_scholar |
| 浏览器工具 (Browser Tools) | - | zai_load_image_from_url, zai_read_webpage |
| 图像处理 (Image Processing) | - | zai_crop_image, zai_draw_image_bounding_boxes, zai_draw_image_point_markers, zai_draw_image_geometry, zai_draw_image_3d_bounding_boxes, zai_draw_video_objects_tracking |
| 创作 (Creation) | 网页创作 (Web Creation) | submit_plan, apply_edits, zai_generate_web_html, zai_generate_web_outline |
| 创作 (Creation) | 幻灯片创作 (Slide Creation) | zai_generate_slide_html, zai_generate_outline_ppt |
| 深度研究 (Deep Research) | 多模态深度研究工具 (Multimodal DR Tools) | zai_dr_python, zai_dr_open_url_mm, zai_dr_visit_img, zai_dr_search, zai_dr_images_search, zai_dr_images_lens |

These architectural advancements are validated by significant performance gains across specialized benchmarks. Compared to our recent model GLM-4.6V [37], GLM-5V-Turbo demonstrates a substantial leap in complex multimodal tasks; notably, it achieves a score of 30.0 on MMSearch-Plus [35], nearly an eightfold improvement over the previous generation. Strong growth is also evident in BrowseComp-VL [10] (51.9) and ImageMining (30.7), which specifically test the model's ability to navigate web interfaces and extract deep visual insights. By matching or exceeding the performance of industry benchmarks like Kimi K-2.5 [36] and Claude Opus 4.6 [4] in these categories, GLM-5V-Turbo proves its capability to handle the high-dimensional reasoning required for modern agentic workflows.

这些架构层面的进步在专门的基准测试中得到了显著性能提升的验证. 与我们近期的模型 GLM-4.6V [37] 相比, GLM-5V-Turbo 在复杂多模态任务中实现了质的飞跃;  notably, 它在 MMSearch-Plus [35] 上取得了 30.0 分, 几乎是前一代的八倍提升. BrowseComp-VL [10] (51.9) 和 ImageMining (30.7) 中也展现出强劲增长, 这些基准专门测试模型导航网页界面和提取深层视觉洞察的能力. 通过在这些类别中达到或超越 Kimi K-2.5 [36] 和 Claude Opus 4.6 [4] 等行业基准的性能, GLM-5V-Turbo 证明了其处理现代智能体工作流所需的高维推理能力.

This expansion is particularly important for multimodal agents. Many real-world tasks are not simply a matter of reading text and calling functions; they require the model to first interpret the visual environment, decide what to do next, and then continue adapting its behavior based on the outcome of its actions. For example, when reproducing a real website, the model can first use a multimodal GUI agent to explore the site through screenshots, interaction with page elements, and navigation across pages, building a richer understanding of layout, functionality, and interaction flow. It can then rely on its native UI-to-code capability to reproduce the site more faithfully. Likewise, when media assets such as images need to be incorporated, they can be processed directly through native tools such as cropping before being embedded into the final output.

这种扩展对多模态智能体尤为重要. 许多真实世界任务不仅仅是阅读文本和调用函数; 它们要求模型首先解释视觉环境, 决定下一步做什么, 然后根据其行动结果继续调整行为. 例如, 在复现真实网站时, 模型可以首先使用多模态 GUI 智能体通过截图、与页面元素交互以及跨页面导航来探索网站, 从而建立对布局、功能和交互流程的更丰富的理解. 然后它可以依靠其原生的 UI-to-code 能力更忠实地复现该网站. 同样, 当需要整合图像等媒体资源时, 可以通过裁剪等原生工具直接处理后再嵌入最终输出.

### 3.2 Integration with External Agent Frameworks: Claude Code and AutoClaw
与外部智能体框架集成: Claude Code 与 AutoClaw

A critical component of GLM-5V-Turbo's deployment strategy is its seamless integration with industry-standard external agent frameworks. By moving beyond isolated tool calls, the model serves as the cognitive core for systems like Claude Code and AutoClaw [50], bridging the gap between high-level reasoning and low-level system execution. The integration with Claude Code transforms GLM-5V-Turbo from a passive code generator into an active system-level collaborator. Within this framework, the model leverages its multimodal capabilities to navigate complex terminal environments and local file systems. While Claude Code handles the logic and environment, AutoClaw provides the "hands" for browser-based and GUI-centric automation. GLM-5V-Turbo acts as the vision-language controller for AutoClaw, enabling sophisticated agentic workflows.

GLM-5V-Turbo 部署策略的一个关键组成部分是其与行业标准外部智能体框架的无缝集成. 通过超越孤立的工具调用, 该模型充当 Claude Code 和 AutoClaw [50] 等系统的认知核心(cognitive core), 弥合高层推理与底层系统执行之间的鸿沟. 与 Claude Code 的集成将 GLM-5V-Turbo 从被动的代码生成器转变为积极的系统级协作者(system-level collaborator). 在该框架内, 模型利用其多模态能力来导航复杂的终端环境和本地文件系统. 当 Claude Code 处理逻辑和环境时, AutoClaw 为基于浏览器和以 GUI 为中心的自动化提供"双手". GLM-5V-Turbo 充当 AutoClaw 的视觉-语言控制器(vision-language controller), 实现复杂的智能体工作流.

The convergence of GLM-5V-Turbo with these frameworks facilitates a complete perception-planning-execution loop. By offloading specific execution logic to Claude Code and AutoClaw, the model can focus on high-dimensional reasoning. This transition marks a fundamental shift in the model's role: it is no longer just a text-based assistant, but a multimodal actor grounded in real-world environments, capable of autonomous task resolution across diverse digital interfaces.

GLM-5V-Turbo 与这些框架的融合促进了完整的感知-规划-执行循环. 通过将特定执行逻辑卸载(offload)给 Claude Code 和 AutoClaw, 模型可以专注于高维推理. 这一转变标志着模型角色的根本性转换: 它不再仅仅是基于文本的助手, 而是扎根于真实世界环境的多模态行动者(multimodal actor), 能够在多样化的数字界面上自主解决任务.

### 3.3 ImageMining: A Self-Collected Vision-Centric Deep Search Benchmark
ImageMining: 自研的以视觉为中心的深度搜索基准

The core potential of a multimodal agent lies in anchoring reasoning within visual contexts---a paradigm we term "think with image, deep search with image." To evaluate this, we introduce ImageMining2, a benchmark designed to test the integration of high-density visual understanding and autonomous multimodal search.

多模态智能体的核心潜力在于将推理锚定在视觉上下文中---我们将这种范式称为"以图像思考, 以图像深度搜索"(think with image, deep search with image). 为评估这一点, 我们引入了 ImageMining2, 这是一个旨在测试高密度视觉理解与自主多模态搜索整合的基准.

Unlike traditional VQA [10; 19; 35], ImageMining requires models to actively mine visual inputs through agentic behaviors. Success relies on multi-step tool calls, such as localized cropping or magnification of minute details to refine search queries. This "Deep-Wide-Search" spectrum evaluates models on their search breadth across sources and their depth in visual reasoning, where task performance correlates strongly with the precision of on-image tool usage.

与传统的视觉问答(VQA, Visual Question Answering) [10; 19; 35] 不同, ImageMining 要求模型通过智能体行为主动挖掘视觉输入. 成功依赖于多步工具调用, 例如局部裁剪或放大细微细节以细化搜索查询. 这种"深度-广度搜索"(Deep-Wide-Search)谱系评估模型在跨来源搜索广度(search breadth)和视觉推理深度(depth in visual reasoning)上的表现, 其中任务性能与图像上工具使用的精度密切相关.

ImageMining comprises 217 curated test cases derived from manually collected trace samples, spanning seven domains (Social, Entertainment, Products, Places, Rich Text, Nature, and Science) and five reasoning categories:

ImageMining 包含 217 个精心筛选的测试用例, 源自人工收集的轨迹样本(trace samples), 跨越七个领域(社交、娱乐、产品、地点、富文本、自然和科学)和五个推理类别:

- Universal Recognition: Fine-grained identification of flora, fauna, and artifacts.
- Spatio-Temporal Reasoning: Geographic deduction grounded in visual cues.
- Event Reasoning: Comprehension of news events and product launches.
- Text-based Reasoning: Reasoning over embedded rich text (e.g., academic papers, reports).
- Visual Search: Cross-referencing visual inputs to retrieve specific artworks or imagery.

- 通用识别(Universal Recognition): 对植物群、动物群和人造物品的细粒度识别.
- 时空推理(Spatio-Temporal Reasoning): 基于视觉线索的地理推断.
- 事件推理(Event Reasoning): 对新闻事件和产品发布的理解.
- 基于文本的推理(Text-based Reasoning): 对嵌入的富文本(如学术论文、报告)进行推理.
- 视觉搜索(Visual Search): 交叉引用视觉输入以检索特定的艺术作品或图像.

To equip GLM-5V-Turbo with these capabilities, we developed a multi-stage automated data pipeline covering knowledge discovery, QA reconstruction, and quality filtering. A pivotal constraint in this process is the "Visual Jump" (WEB_VISUAL): during discovery, intermediate reasoning hops must involve visual transitions, forcing the model to parse images rather than relying on textual shortcuts or parametric knowledge. Furthermore, we constructed specialized OCR Search data for charts, maps, and posters. This compels the model to perform entity隔离(entity isolation) and localized cropping before initiating search chains, transforming images from static inputs into interactive environments for deep exploration.

为使 GLM-5V-Turbo 具备这些能力, 我们开发了一个覆盖知识发现、QA 重构和质量过滤的多阶段自动化数据流水线(data pipeline). 该过程中的一个关键约束是"视觉跳跃"(Visual Jump, WEB_VISUAL): 在发现阶段, 中间推理跳数(hops)必须涉及视觉转换, 迫使模型解析图像而非依赖文本捷径或参数知识(parametric knowledge). 此外, 我们为图表、地图和海报构建了专门的 OCR 搜索数据. 这迫使模型在启动搜索链之前执行实体隔离(entity isolation)和局部裁剪, 将图像从静态输入转变为深度探索的交互环境.

### 3.4 Multimodal Deep Research and Content Creation

Leveraging its agentic capabilities, GLM-5V-Turbo facilitates a complete multimodal deep research workflow, encompassing iterative information gathering, evidence consolidation, and long-form synthesis from heterogeneous sources. Unlike traditional text-centric agents [12; 27], this workflow begins with open-ended objectives and proceeds through autonomous cycles of planning, multimodal reading, and state updating. By natively parsing visually rich webpages, charts, and structured documents, the model accesses high-value evidence---such as slides and figures---that is typically discarded in text-only pipelines.

利用其智能体能力, GLM-5V-Turbo 实现了完整的多模态深度研究(deep research)工作流, 涵盖迭代式信息收集、证据整合(evidence consolidation)以及来自异构来源的长文本合成(long-form synthesis). 与传统的以文本为中心的智能体(text-centric agents) [12; 27] 不同, 该工作流以开放式目标开始, 并通过自主的规划、多模态阅读和多模态阅读循环推进. 通过原生解析视觉丰富的网页、图表和结构化文档, 模型能够获取高价值证据---如幻灯片和图表---这些通常在纯文本流水线中被丢弃.

2https://github.com/zai-org/ImageMining

2https://github.com/zai-org/ImageMining

(a)
(b)
Figure 3: Examples of multimodal deep research and content creation. (a) A multimodal deep research report, where the visuals are harvested from the Internet via web search, and selected and complied by GLM-5V-Turbo (Query: Compare OpenClaw and Hermes agent systems and give a comprehensive report. Note that the output should be a text-image interleaved markdown.). (b) A technical blog excerpted from an academic paper [49], where the visual elements are cropped from the original paper and inserted into the output to compose a complete blog, fully automated by GLM-5V-Turbo.

(a)
(b)
图 3: 多模态深度研究与内容创作示例. (a) 一份多模态深度研究报告, 其中的视觉素材通过网络搜索从互联网收集, 并由 GLM-5V-Turbo 筛选和编排(查询: 比较 OpenClaw 和 Hermes 智能体系统并给出综合报告. 注意输出应为图文交错的 Markdown.). (b) 一篇从学术论文 [49] 摘录的技术博客, 其中的视觉元素从原文裁剪并插入输出中以组成完整的博客, 全部由 GLM-5V-Turbo 自动完成.

A defining characteristic of this system is its integrated multimodal reasoning. Rather than treating images as peripheral data, GLM-5V-Turbo extracts textual and visual evidence (e.g., table regions, screenshots) in tandem. This is crucial for realistic research environments where key insights are often distributed across document layouts and visual artifacts rather than isolated within text paragraphs. Beyond information acquisition, GLM-5V-Turbo supports diverse, presentation-oriented downstream formats:

该系统的一个决定性特征是其集成的多模态推理(integrated multimodal reasoning). GLM-5V-Turbo 不是将图像视为边缘数据, 而是同时提取文本和视觉证据(如表格区域、截图). 这对于真实的研究环境至关重要, 因为关键洞察往往分布在文档布局和视觉产物(visual artifacts)中, 而非孤立在文本段落内. 除了信息获取, GLM-5V-Turbo 还支持多样化的、面向展示的下游格式:

- Interleaved Reports: Generating text-image interleaved outputs (see Fig. 3 (a)) where visual evidence is embedded alongside grounded explanations---ideal for comparative analysis and literature reviews.
- Deep Research to PPT: Synthesizing gathered materials into structured slide decks, including page allocation and multimodal content organization, to mirror professional presentation workflows.
- Document-Style Write-ups: Creating blog-like interpretations or structured notes (see Fig. 3 (b)) that maintain the visual-textual integrity of the research findings.

- 交错报告(Interleaved Reports): 生成图文交错输出(见图 3 (a)), 将视觉证据与基于依据的解释并排嵌入---非常适合比较分析和文献综述.
- 深度研究转 PPT (Deep Research to PPT): 将收集的材料合成为结构化的幻灯片组, 包括页面分配和多模态内容组织, 以模拟专业演示工作流.
- 文档式撰写(Document-Style Write-ups): 创建博客式解读或结构化笔记(见图 3 (b)), 保持研究发现的视觉-文本完整性(visual-textual integrity).

These capabilities further extend to document-grounded generation. Users can provide complex source materials for the model to reorganize into structured slides or interleaved interpretations. By preserving the synergy between textual conclusions and supporting visual evidence, GLM-5V-Turbo marks a system-level transition from simple multimodal information retrieval to comprehensive multimodal transformation and presentation.

这些能力进一步延伸到基于文档的生成(document-grounded generation). 用户可以提供复杂的源材料, 由模型重新组织为结构化幻灯片或交错式解读. 通过保持文本结论与支持性视觉证据之间的协同作用(synergy), GLM-5V-Turbo 标志着从简单的多模态信息检索到全面的多模态转换与呈现的系统级转变.

### 3.5 Official Skills

As a foundation model adept at agentic and coding tasks, GLM-5V-Turbo can be readily integrated into general and coding agent frameworks (such as OpenClaw [34], AutoClaw [50] and Claude Code [3]), which are becoming increasingly popular in the community. To make it easier for users to utilize GLM-5V-Turbo within these agent systems, and to better leverage its strengths, we provide a set of official skills, which fall into two categories: one is built upon the native capabilities of the GLM-5V-Turbo model, and the other wraps GLM-5V-Turbo as an external tool (in the form of a MaaS API) for OpenClaw, AutoClaw and Claude Code to invoke. Additionally, we have developed 5 skills based on the previously released specialized models, GLM-OCR [8] and GLM-Image [38], to support a wider range of scenarios and tasks. To help users better understand, install, and use the official skills, we also provide a unified master skill (https://clawhub.ai/jaredforreal/glm-master-skill).

作为一款擅长智能体和编程任务的基础模型, GLM-5V-Turbo 可以方便地集成到通用和编程智能体框架中(如 OpenClaw [34]、AutoClaw [50] 和 Claude Code [3]), 这些框架在社区中越来越受欢迎. 为了让用户更容易在这些智能体系统中使用 GLM-5V-Turbo 并更好地发挥其优势, 我们提供了一套官方技能(official skills), 分为两类: 一类基于 GLM-5V-Turbo 模型的原生能力构建, 另一类将 GLM-5V-Turbo 封装为外部工具(以 MaaS API 的形式)供 OpenClaw、AutoClaw 和 Claude Code 调用. 此外, 我们基于先前发布的专用模型 GLM-OCR [8] 和 GLM-Image [38] 开发了 5 项技能, 以支持更广泛的应用场景和任务. 为了帮助用户更好地理解、安装和使用官方技能, 我们还提供了一个统一的主技能(master skill) (https://clawhub.ai/jaredforreal/glm-master-skill).

The official skills are listed in Tab. 2 and more details can be found in the Github repository: https://github.com/zai-org/GLM-skills.

官方技能列于表 2 中, 更多详情可参见 Github 仓库: https://github.com/zai-org/GLM-skills.

Table 2: Overview of official skills supported by GLM-5V-Turbo.
Skill
Type
URL
PDF-to-Web
Native
https://clawhub.ai/zai-org/glmv-pdf-to-web
PDF-to-PPT
Native
https://clawhub.ai/zai-org/glmv-pdf-to-ppt
Web Replication
Native
https://clawhub.ai/zai-org/glmv-web-replication
PRD-to-App
Native
https://clawhub.ai/zai-org/glmv-prd-to-app
Stock Analyst
Native
https://clawhub.ai/zai-org/glmv-stock-analyst
Image Captioning
External Tool
https://clawhub.ai/JaredforReal/glmv-caption
Visual Grounding
External Tool
https://clawhub.ai/jaredforreal/glmv-grounding
Doc-based Writing
External Tool
https://clawhub.ai/jaredforreal/glmv-doc-based-writing
Resume Screening
External Tool
https://clawhub.ai/JaredforReal/glmv-resume-screen
Prompt Generation
External Tool
https://clawhub.ai/JaredforReal/glmv-prompt-gen
General OCR
Specialized
https://clawhub.ai/JaredforReal/glmocr
Table Recognition
Specialized
https://clawhub.ai/JaredforReal/glmocr-table
Handwriting Recognition
Specialized
https://clawhub.ai/JaredforReal/glmocr-handwriting
Formula Recognition
Specialized
https://clawhub.ai/JaredforReal/glmocr-formula
Image Generation
Specialized
https://clawhub.ai/JaredforReal/glm-image-gen

表 2: GLM-5V-Turbo 支持的官方技能概览.

| 技能 (Skill) | 类型 (Type) | 链接 (URL) |
| --- | --- | --- |
| PDF-to-Web | 原生 (Native) | https://clawhub.ai/zai-org/glmv-pdf-to-web |
| PDF-to-PPT | 原生 (Native) | https://clawhub.ai/zai-org/glmv-pdf-to-ppt |
| Web Replication | 原生 (Native) | https://clawhub.ai/zai-org/glmv-web-replication |
| PRD-to-App | 原生 (Native) | https://clawhub.ai/zai-org/glmv-prd-to-app |
| Stock Analyst | 原生 (Native) | https://clawhub.ai/zai-org/glmv-stock-analyst |
| Image Captioning | 外部工具 (External Tool) | https://clawhub.ai/JaredforReal/glmv-caption |
| Visual Grounding | 外部工具 (External Tool) | https://clawhub.ai/jaredforreal/glmv-grounding |
| Doc-based Writing | 外部工具 (External Tool) | https://clawhub.ai/jaredforreal/glmv-doc-based-writing |
| Resume Screening | 外部工具 (External Tool) | https://clawhub.ai/JaredforReal/glmv-resume-screen |
| Prompt Generation | 外部工具 (External Tool) | https://clawhub.ai/JaredforReal/glmv-prompt-gen |
| General OCR | 专用 (Specialized) | https://clawhub.ai/JaredforReal/glmocr |
| Table Recognition | 专用 (Specialized) | https://clawhub.ai/JaredforReal/glmocr-table |
| Handwriting Recognition | 专用 (Specialized) | https://clawhub.ai/JaredforReal/glmocr-handwriting |
| Formula Recognition | 专用 (Specialized) | https://clawhub.ai/JaredforReal/glmocr-formula |
| Image Generation | 专用 (Specialized) | https://clawhub.ai/JaredforReal/glm-image-gen |

## 4 Design Lenses from Development
来自开发过程的设计视角

Beyond the developments described above, the process of building GLM-5V-Turbo also led us to several practical lenses for agentic model development. We present them not as universal rules, but as design perspectives that repeatedly proved useful in our development process.

除了上述进展, 构建 GLM-5V-Turbo 的过程还为我们带来了若干用于智能体模型开发的实用视角. 我们呈现它们并非作为普适规则, 而是作为在开发过程中反复证明有用的设计视角.

Lens 1: Perception remains foundational to higher-level multimodal capability.

视角 1: 感知仍然是更高级多模态能力的基础.

Recent work has placed increasing emphasis on higher-level abilities such as planning, reasoning, and reflection. Our observation, however, is that further gains in multimodal capability still depend critically on perception. Even among the strongest current VLMs, errors in fine-grained perception and spatial understanding remain common, and these often propagate into downstream reasoning, decision-making, and execution. Many failures that appear high-level, in other words, begin with the model not seeing the environment accurately enough.

近期工作越来越强调规划、推理和反思等更高层能力. 然而, 我们的观察是, 多模态能力的进一步提升仍然关键地依赖于感知. 即使在当前最强的视觉语言模型(VLM, Vision-Language Model)中, 细粒度感知和空间理解方面的错误仍然常见, 而这些错误往往会传播到下游的推理、决策和执行中. 换句话说, 许多看似高层的失败, 根源在于模型没有足够准确地"看见"环境.

In our development, multimodal coding and grounding proved to be useful proxy tasks for perceptual learning. Tasks such as frontend or SVG coding require the model to capture layout, structure, relative position, and local detail, rather than relying only on coarse semantics. We found that adding paired data between subject-specific images and their SVG representations during pretraining contributed positively to downstream STEM problem solving, while strengthening grounding-related training during RL also improved GUI-agent performance. These observations suggest that some seemingly downstream structured tasks can in fact provide a useful route to better perception.

在我们的开发中, 多模态编程和定位被证明是感知学习的有效代理任务(proxy tasks). 前端或 SVG 编码等任务要求模型捕捉布局、结构、相对位置和局部细节, 而非仅依赖粗略语义. 我们发现, 在预训练期间添加特定主题图像与其 SVG 表示之间的配对数据, 对下游 STEM 问题求解有积极贡献; 而在 RL 期间加强定位相关训练也能提升 GUI 智能体性能. 这些观察表明, 一些看似下游的结构化任务实际上可以为更好的感知提供有用的路径.

We also find that explicitly training the model to critique its own perception can help reduce hallucination during generation. In GUI-agent instruction tuning, we include a subset of critic data that targets errors in the reasoning process, such as misreading interface details, misidentifying target elements, and making incorrect decisions about the next action. This improves the model's observation quality on GUI details and reduces several recurring perception failure modes. More broadly, our view is that perception is not a low-level module that can simply be solved early and then left behind; it continues to shape the upper bound of higher-level multimodal capability.

我们还发现, 明确训练模型批判自身感知有助于减少生成过程中的幻觉(hallucination). 在 GUI 智能体指令微调(instruction tuning)中, 我们纳入了针对推理过程中错误的批评数据(critic data)子集, 例如误读界面细节、错误识别目标元素以及对下一步行动做出错误决策. 这提升了模型对 GUI 细节的观察质量, 并减少了若干反复出现的感知失败模式. 更广泛地说, 我们的观点是, 感知不是一个可以在早期解决然后抛在脑后的低层模块; 它持续塑造着更高级多模态能力的上限.

> 译者注: 这一设计视角强调了"感知-推理"的层级依赖关系. GLM-5V-Turbo 的经验表明, 前端编码、SVG 重建等看似下游的任务反而能有效提升细粒度感知, 而显式的感知自批判训练(self-critique)则是抑制幻觉的有力手段. 这对当前过度强调高层规划而忽视感知基础的 VLM 研发具有纠偏意义.

Lens 2: Agent capability can be more efficiently built through hierarchical optimization.

视角 2: 智能体能力可以通过分层优化更高效地构建.

Agent training is inherently resource-intensive: environment setup and task construction are costly, high-quality data is scarce, and reliable verification is often difficult. At the same time, agent tasks themselves are hard to optimize efficiently, since they typically involve complex compositions, long interaction trajectories, non-unique solution paths, and strong dependence on the evolving environment state. Under these conditions, a central question is how to maximize the return on data construction under limited resources.

智能体训练本质上是资源密集型的: 环境搭建和任务构建成本高昂, 高质量数据稀缺, 可靠的验证往往困难. 同时, 智能体任务本身难以高效优化, 因为它们通常涉及复杂的组合、长交互轨迹(long interaction trajectories)、非唯一 solution paths 以及对动态环境状态的强依赖. 在这些条件下, 一个核心问题是如何在有限资源下最大化数据构建的收益.

This led us to adopt a hierarchical optimization strategy. In our experience, agent capability is developed more effectively when optimization is distributed across multiple levels of the capability hierarchy, rather than concentrated primarily on high-level long-horizon tasks. In GUI-agent development, for example, this motivated us to build a multi-level task hierarchy spanning element perception, GUI grounding, single-step action prediction, and trajectory-level action prediction, and to use it in both SFT and RL. The appeal of this design is twofold: lower-level tasks are usually easier to construct, annotate, and verify than long-horizon ones under the same resource constraints; and when lower-level capabilities are still underdeveloped, pushing only on high-level tasks often fails to yield reliable gains and can instead make training less stable. Overall, hierarchical optimization serves not only as a way to improve efficiency, but also as a practical path toward more stable agent training.

这促使我们采用分层优化策略(hierarchical optimization strategy). 根据我们的经验, 当优化分布在能力层级的多个层次上, 而非主要集中在高层长程任务时, 智能体能力能得到更有效的发展. 例如, 在 GUI 智能体开发中, 这促使我们构建了一个多级任务层级, 涵盖元素感知、GUI 定位、单步动作预测和轨迹级动作预测, 并在 SFT 和 RL 中同时使用它. 这种设计的吸引力是双重的: 在相同资源约束下, 低层任务通常比长程任务更容易构建、标注和验证; 而且当低层能力尚不成熟时, 只推动高层任务往往无法产生可靠的增益, 反而可能使训练更不稳定. 总体而言, 分层优化不仅是提高效率的方式, 也是实现更稳定智能体训练的实用路径.

Lens 3: The key to constructing, evaluating, and optimizing end-to-end long-horizon tasks lies in clear task specification, reliable outcome verification, and controlled evaluation procedures.

视角 3: 构建、评估和优化端到端长程任务的关键在于清晰的任务规范、可靠的结果验证和受控的评估流程.

For multimodal agents, the real challenge is often not extending tasks to longer horizons, but making end-to-end tasks stable enough to serve as meaningful targets for evaluation and optimization. Many realistic agent settings are inherently open-ended, with underspecified goals, ambiguous execution boundaries, and outcomes that depend heavily on intermediate decisions. As a result, they are often difficult to compare consistently and even harder to turn into reusable optimization signals.

对于多模态智能体, 真正的挑战往往不是将任务扩展到更长的时间范围, 而是使端到端任务足够稳定, 从而成为有意义的评估和优化目标. 许多真实的智能体设置本质上是开放式的(open-ended), 目标 underspecified, 执行边界模糊, 结果严重依赖于中间决策. 因此, 它们往往难以进行一致的比较, 更难转化为可复用的优化信号.

This led us to a broader view: the value of an end-to-end task depends not only on how realistic it is, but also on whether it can be specified clearly enough, verified reliably enough, and evaluated under sufficient procedural control to produce stable and reusable feedback. This perspective shaped how we think about data construction, evaluation, and downstream optimization. In multimodal agent settings, task definition often depends on multiple sources of constraint rather than a single prompt alone, while evaluation needs structure not only at the level of final outcomes but also at the level of the verification process itself. Under this view, task definition, verification design, and feedback structure should be considered together rather than in isolation.

这使我们形成了更广泛的视角: 端到端任务的价值不仅取决于其真实程度, 还取决于它是否能被足够清晰地规范、足够可靠地验证, 并在充分的流程控制下进行评估以产生稳定且可复用的反馈. 这一视角塑造了我们对于数据构建、评估和下游优化的思考方式. 在多模态智能体设置中, 任务定义往往依赖于多个约束来源而非单一的提示, 而评估不仅需要在最终结果层面有结构, 在验证过程本身层面也需要有结构. 在这一视角下, 任务定义、验证设计和反馈结构应该被统筹考虑, 而非孤立对待.

Vision2Web [14], our benchmark for end-to-end visual website development, is one concrete instantiation of this view. Each task is grounded not just in a textual instruction, but in a richer specification that may include PRDs, mockups, reference pages, and resource assets, making the task definition better specified. On the evaluation side, rather than treating website development as a loosely specified open-ended problem, we use workflow-based verification so that execution is assessed through a controlled sequence of dependent steps rather than a single final state. This makes it easier to compare systems, attribute failures, and model different forms of signal separately --- for example, functional correctness during interactive execution and visual consistency in a more isolated comparison setting. In this sense, Vision2Web is not only a benchmark, but also a concrete attempt to align task construction, verification, and feedback design in a way that better supports reliable evaluation and optimization.

Vision2Web [14] 是我们用于端到端视觉网站开发的基准, 是这一视角的具体实例化(instantiation). 每个任务不仅基于文本指令, 还基于更丰富的规范, 可能包括 PRD (产品需求文档)、模型图(mockups)、参考页面和资源素材, 从而使任务定义更加明确. 在评估方面, 我们不是将网站开发视为一个 loosely specified 的开放式问题, 而是使用基于工作流的验证(workflow-based verification), 使执行通过一个受控的依赖步骤序列而非单一的最终状态来评估. 这使得比较系统、归因失败以及分别建模不同形式的信号变得更加容易---例如, 交互执行期间的功能正确性和更隔离的比较设置中的视觉一致性. 在这个意义上, Vision2Web 不仅是一个基准, 也是将任务构建、验证和反馈设计进行对齐以更好支持可靠评估和优化的具体尝试.

> 译者注: Vision2Web 的评估哲学对智能体基准设计具有范式意义. 它将"任务规范-验证流程-反馈结构"三位一体化, 通过工作流级验证替代单点打分, 使失败归因和信号分离成为可能. 这种受控评估思路对于解决当前智能体领域"开放式任务难以优化"的困境提供了可操作的框架.

## 5 Evaluation

We evaluate GLM-5V-Turbo across four categories:

我们在四个类别上评估 GLM-5V-Turbo:

- Multimodal Coding: Design2Code [31], Flame-VLM-Code [9], Vision2Web [14];
- Multimodal ToolUse: ImageMining, BrowseComp-VL [10], MMSearch [18], MMSearch-Plus [35], SimpleVQA [7], Facts [17], V* [41];
- GUI Agent: OSWorld [44], AndroidWorld [30], WebVoyager [13];
- Text-only Coding and Claw: CC-Bench-V2 [49], PinchBench [1], ClawEval [46], ZClawBench [2].

- 多模态编程(Multimodal Coding): Design2Code [31], Flame-VLM-Code [9], Vision2Web [14];
- 多模态工具使用(Multimodal ToolUse): ImageMining, BrowseComp-VL [10], MMSearch [18], MMSearch-Plus [35], SimpleVQA [7], Facts [17], V* [41];
- GUI 智能体(GUI Agent): OSWorld [44], AndroidWorld [30], WebVoyager [13];
- 纯文本编程与 Claw (Text-only Coding and Claw): CC-Bench-V2 [49], PinchBench [1], ClawEval [46], ZClawBench [2].

Across these dimensions, GLM-5V-Turbo exhibits a consistent pattern: it achieves strong performance on multimodal benchmarks for coding and agent-oriented tasks, while maintaining solid capability on text-only tasks. This balance aligns with our core objective for GLM-5V-Turbo: building foundational multimodal agentic capability without sacrificing the coding and reasoning ability required in text-first workflows.

跨这些维度, GLM-5V-Turbo 展现出一致的模式: 它在面向编程和智能体任务的多模态基准上表现强劲, 同时在纯文本任务上保持扎实的能力. 这种平衡与我们对 GLM-5V-Turbo 的核心目标一致: 构建基础性的多模态智能体能力, 同时不牺牲以文本为先的工作流所需的编程和推理能力.

On multimodal coding and tool-use benchmarks, GLM-5V-Turbo performs strongly on UI-to-code generation, visual website development, multimodal search, and visually grounded QA. It is also highly competitive on GUI-agent benchmarks such as AndroidWorld and WebVoyager, indicating that its visual understanding transfers effectively into grounded interaction and action. At the same time, on CC-Bench-V2 including CC-Backend, CC-Frontend, and CC-Repo-Exploration which evaluate model performance on Claude Code framework, the model remains solid in pure-text coding, suggesting that the addition of visual capability does not materially erode its underlying coding performance, which is a critical feature for the multimodal agentic foundations.

在多模态编程和工具使用基准上, GLM-5V-Turbo 在 UI-to-code 生成、视觉网站开发、多模态搜索和视觉 grounded QA 上表现强劲. 它在 AndroidWorld 和 WebVoyager 等 GUI 智能体基准上也极具竞争力, 表明其视觉理解能有效迁移到 grounded 交互和行动中. 同时, 在 CC-Bench-V2(包括评估 Claude Code 框架上模型性能的 CC-Backend、CC-Frontend 和 CC-Repo-Exploration)上, 该模型在纯文本编程方面保持扎实, 表明视觉能力的加入并未实质侵蚀其底层编程性能, 这是多模态智能体基础的关键特征.

Figure 4: Evaluation of GLM-5V-Turbo on multimodal coding, tool-use, and GUI agent benchmarks.

图 4: GLM-5V-Turbo 在多模态编程、工具使用和 GUI 智能体基准上的评估.

This led us to adopt a hierarchical optimization strategy. In our experience, agent capability is developed more effectively when optimization is distributed across multiple levels of the capability hierarchy, rather than concentrated primarily on high-level long-horizon tasks. In GUI-agent development, for example, this motivated us to build a multi-level task hierarchy spanning element perception, GUI grounding, single-step action prediction, and trajectory-level action prediction, and to use it in both SFT and RL. The appeal of this design is twofold: lower-level tasks are usually easier to construct, annotate, and verify than long-horizon ones under the same resource constraints; and when lower-level capabilities are still underdeveloped, pushing only on high-level tasks often fails to yield reliable gains and can instead make training less stable. Overall, hierarchical optimization serves not only as a way to improve efficiency, but also as a practical path toward more stable agent training.

这引导我们采用了一种分层优化策略. 根据我们的经验, 当优化分布在能力层级的多个层次上, 而非主要集中于高层级的长程任务时, agent 能力会得到更有效的开发. 例如, 在 GUI agent 的开发中, 这促使我们构建了一个多级任务层级, 涵盖元素感知, GUI grounding, 单步动作预测以及轨迹级动作预测, 并在 SFT 和 RL 中同时使用它. 这一设计的吸引力在于两方面: 在同等资源约束下, 低层级任务通常比长程任务更易于构建, 标注和验证; 且当低层级能力尚不成熟时, 仅推进高层任务往往难以带来可靠的提升, 反而可能使训练更不稳定. 总体而言, 分层优化不仅是提高效率的一种方式, 也是通向更稳定 agent 训练的实践路径.

Lens 3: The key to constructing, evaluating, and optimizing end-to-end long-horizon tasks lies in clear task specification, reliable outcome verification, and controlled evaluation procedures.

Lens 3: 构建, 评估和优化端到端长程任务的关键, 在于清晰的任务定义, 可靠的结果验证, 以及受控的评估流程.

For multimodal agents, the real challenge is often not extending tasks to longer horizons, but making end-to-end tasks stable enough to serve as meaningful targets for evaluation and optimization. Many realistic agent settings are inherently open-ended, with underspecified goals, ambiguous execution boundaries, and outcomes that depend heavily on intermediate decisions. As a result, they are often difficult to compare consistently and even harder to turn into reusable optimization signals.

对于多模态 agent 而言, 真正的挑战通常不在于将任务扩展到更长的时域, 而在于使端到端任务足够稳定, 从而能够作为评估和优化的有意义目标. 许多真实 agent 场景本质上是开放式的, 目标定义不足, 执行边界模糊, 且结果严重依赖于中间决策. 因此, 它们往往难以被一致地比较, 更难转化为可复用的优化信号.

This led us to a broader view: the value of an end-to-end task depends not only on how realistic it is, but also on whether it can be specified clearly enough, verified reliably enough, and evaluated under sufficient procedural control to produce stable and reusable feedback. This perspective shaped how we think about data construction, evaluation, and downstream optimization. In multimodal agent settings, task definition often depends on multiple sources of constraint rather than a single prompt alone, while evaluation needs structure not only at the level of final outcomes but also at the level of the verification process itself. Under this view, task definition, verification design, and feedback structure should be considered together rather than in isolation.

这让我们形成了更宏观的视角: 端到端任务的价值不仅取决于其真实程度, 还取决于它是否足够清晰, 是否能被可靠验证, 以及是否能在充分的流程控制下进行评估, 从而产生稳定且可复用的反馈. 这一视角塑造了我们对于数据构建, 评估和下游优化的思考方式. 在多模态 agent 场景中, 任务定义往往依赖于多种约束来源, 而非仅靠单一 prompt; 而评估不仅需要最终结果层面的结构, 还需要验证过程本身层面的结构. 在此视角下, 任务定义, 验证设计和反馈结构应当被统筹考虑, 而非孤立对待.

Vision2Web [14], our benchmark for end-to-end visual website development, is one concrete instantiation of this view. Each task is grounded not just in a textual instruction, but in a richer specification that may include PRDs, mockups, reference pages, and resource assets, making the task definition better specified. On the evaluation side, rather than treating website development as a loosely specified open-ended problem, we use workflow-based verification so that execution is assessed through a controlled sequence of dependent steps rather than a single final state. This makes it easier to compare systems, attribute failures, and model different forms of signal separately - for example, functional correctness during interactive execution and visual consistency in a more isolated comparison setting. In this sense, Vision2Web is not only a benchmark, but also a concrete attempt to align task construction, verification, and feedback design in a way that better supports reliable evaluation and optimization.

Vision2Web [14] 是我们用于端到端视觉网站开发的基准测试, 也是这一观点的具体体现. 每个任务不仅基于文本指令, 还基于更丰富的规范, 其中可能包括 PRD, 原型图, 参考页面和资源素材, 从而使任务定义更加明确. 在评估方面, 我们没有将网站开发视为一个定义松散的开放式问题, 而是采用基于工作流的验证方式, 使得执行通过一系列受控的依赖步骤来评估, 而非仅看单一最终状态. 这使得系统间的比较, 故障归因, 以及对不同信号形式的单独建模变得更加容易 - 例如, 交互执行过程中的功能正确性, 以及在一个更隔离的比较场景中的视觉一致性. 从这个意义上说, Vision2Web 不仅是一个基准测试, 也是一项将任务构建, 验证和反馈设计进行对齐的具体尝试, 从而更好地支持可靠的评估和优化.

> 译者注: PRD (Product Requirements Document) 即产品需求文档, 是软件工程中定义功能需求的常用文档.

> 译者注: 文中 SFT (Supervised Fine-Tuning) 与 RL (Reinforcement Learning) 分别指监督微调与强化学习, 是当前大模型后训练的两类核心范式.

## 6 Remaining Challenges

Despite the progress described above, several challenges remain central to future agentic model development. In our view, the hardest open problems increasingly lie not in isolated capability improvement, but in agentic strategy emergence, long-horizon multimodal context management, and the growing entanglement between model capability and harness design.

尽管上述进展显著, 若干挑战仍然是未来智能体模型开发的核心. 在我们看来, 最困难的开放问题 increasingly 不在于孤立的能力提升, 而在于智能体策略涌现(agentic strategy emergence)、长程多模态上下文管理(long-horizon multimodal context management), 以及模型能力与 harness 设计之间日益增长的纠缠(entanglement).

How to enable the emergence of better agentic strategies.
Agent training still depends heavily on hand-crafted or strongly filtered cold-start trajectories. This is effective for initialization, but it also narrows the space of reasoning and action patterns the model is likely to explore, so later improvement often remains local: the model becomes better at executing familiar paths, without discovering genuinely better ones. In our experiments, we found that increasing trajectory diversity at the cold-start stage can partially loosen this constraint, making it easier for RL to uncover nearby but improved variants. This suggests that trajectory diversity is not merely a matter of broader data coverage, but may be one of the conditions for strategy emergence itself. Still, this is only a first step. The more fundamental goal is to enable models to discover better reasoning and agentic strategies on their own, rather than remaining confined to variations of human-provided starting patterns. Beyond that lies an even harder challenge: enabling models to discover richer organizational forms, such as sub-agent decomposition, multi-agent collaboration, and more flexible hierarchical decision structures.

如何促成更优智能体策略的涌现.
智能体训练仍然严重依赖手工设计或强过滤的冷启动轨迹(cold-start trajectories). 这对初始化有效, 但也缩小了模型可能探索的推理和行动模式空间, 因此后续的改进往往仍是局部的: 模型变得更擅长执行熟悉的路径, 却未发现真正更优的路径. 在我们的实验中, 我们发现增加冷启动阶段的轨迹多样性可以部分放松这一约束, 使 RL 更容易发现邻近但改进的变体. 这表明轨迹多样性不仅仅是更广泛数据覆盖的问题, 而可能是策略涌现本身的条件之一. 尽管如此, 这只是第一步. 更根本的目标是使模型能够自主发现更好的推理和智能体策略, 而非局限于人类提供的起始模式的变体. 除此之外还有更难的挑战: 使模型能够发现更丰富的组织形式, 如子智能体分解(sub-agent decomposition)、多智能体协作(multi-agent collaboration)和更灵活的分层决策结构.

Multimodal context management remains a core bottleneck for long-horizon agents.
Compared with text, images and especially videos consume context budget much more aggressively, making them expensive to retain over long trajectories. In practice, many systems respond by dropping earlier visual observations as context grows. While being an understandable engineering compromise, it also discards information that may remain important for later reasoning, planning, or verification. The challenge becomes sharper as trajectories lengthen. In text-only settings, systems such as Claude Code often respond to growing context pressure by compacting or summarizing earlier interaction history once the context window starts to fill up; in multimodal settings, however, faithful compression is much harder, because what must be preserved is not only semantic content, but also visual detail that may later become important again, such as layout, spatial relations, or temporal change in video. Most current memory mechanisms remain fundamentally text-centric: they are better at compressing what was said than what was seen, or how visual states evolved over time. For long-horizon multimodal agents, simply adapting text memory mechanisms will therefore be insufficient. What is needed instead is a more multimodal-native approach to context and memory.

多模态上下文管理仍然是长程智能体的核心瓶颈.
与文本相比, 图像尤其是视频更激进地消耗上下文预算(context budget), 使得在长轨迹中保留它们的成本很高. 在实践中, 许多系统通过在上下文增长时丢弃较早的视觉观察来应对. 虽然这是可理解的工程折中, 但它也丢弃了对后续推理、规划或验证仍可能重要的信息. 随着轨迹延长, 这一挑战变得更加尖锐. 在纯文本设置中, Claude Code 等系统通常通过压缩或总结早期交互历史来应对日益增长的上下文压力; 然而, 在多模态设置中, 忠实的压缩(faithful compression)要困难得多, 因为必须保留的不仅是语义内容, 还有可能再次变得重要的视觉细节, 如布局、空间关系或视频中的时间变化. 大多数当前的内存机制本质上仍是以文本为中心的: 它们更擅长压缩"说了什么"而非"看到了什么", 或视觉状态如何随时间演变. 因此, 对于长程多模态智能体, 简单地适配文本内存机制是不够的. 需要的是一种更加多模态原生的上下文和内存方法.

> 译者注: 长程多模态上下文管理是制约当前智能体从"演示级"迈向"生产级"的关键瓶颈. 视觉信息的忠实压缩需要同时保留语义抽象和空间-时间细节, 这远超文本摘要的难度. 开发多模态原生的记忆机制(如视觉状态的关键帧提取、空间关系图(spatial relation graph)的显式维护)将是下一代智能体架构的重要研究方向.

Model and harness increasingly co-shape the system's capability boundary.
For agentic systems, the effective capability boundary is no longer determined by the model alone, but jointly shaped by the model and the harness around it. This greatly expands the design space: task decomposition, tool use, memory mechanisms, and verification loops can all affect what the system is able to do in practice. At the same time, it makes the development path substantially complex: the same model may behave very differently under different decomposition strategies, tool-use policies, memory designs, or verification workflows; conversely, what appears to be a model limitation may sometimes reflect a poor harness choice instead. More importantly, this dependence runs both ways: the usefulness of a harness often depends on the model's capability regime, and designs that are ineffective at one stage may become critical once the model crosses a threshold in reasoning, planning, or feedback utilization. This means the harness is not a stable external layer that can be optimized independently of the model. Its role, value, and optimal form shift as the model evolves. More broadly, this means that agentic model development can no longer be framed as model improvement alone: the effective capability boundary is increasingly co-shaped by the model and the harness, and so too are the objectives by which progress is optimized and evaluated.

模型与 harness 日益共同塑造系统的能力边界.
对于智能体系统, 有效的能力边界不再仅由模型单独决定, 而是由模型及其周围的 harness 共同塑造. 这极大地扩展了设计空间: 任务分解、工具使用、内存机制和验证循环都会影响系统实际能做什么. 同时, 这也使开发路径 substantially 复杂化: 同一模型在不同的分解策略、工具使用策略、内存设计或验证工作流下可能表现迥异; 反之, 看似模型局限的问题有时可能反映的是 harness 选择不当. 更重要的是, 这种依赖是双向的: harness 的有用性往往取决于模型的能力区间(capability regime), 在某个阶段无效的设计可能在模型跨越推理、规划或反馈利用的阈值后变得关键. 这意味着 harness 不是一个可以独立于模型优化的稳定外部层. 它的角色、价值和最优形式随模型演化而转变. 更广泛地说, 这意味着智能体模型开发不能再被框定为单纯的模型改进: 有效的能力边界 increasingly 由模型和 harness 共同塑造, 进步被优化和评估的目标也是如此.

improvement often remains local: the model becomes better at executing familiar paths, without discovering genuinely better ones. In our experiments, we found that increasing trajectory diversity at the cold-start stage can partially loosen this constraint, making it easier for RL to uncover nearby but improved variants. This suggests that trajectory diversity is not merely a matter of broader data coverage, but may be one of the conditions for strategy emergence itself. Still, this is only a first step. The more fundamental goal is to enable models to discover better reasoning and agentic strategies on their own, rather than remaining confined to variations of human-provided starting patterns. Beyond that lies an even harder challenge: enabling models to discover richer organizational forms, such as sub-agent decomposition, multi-agent collaboration, and more flexible hierarchical decision structures.

改进往往仍局限于局部: 模型变得更擅长执行熟悉的路径, 却无法发现真正更优的方案. 在我们的实验中, 我们发现增加 cold-start 阶段的轨迹多样性可以部分缓解这一约束, 使 RL 更容易发现附近但有所改进的变体. 这表明轨迹多样性不仅仅是更广泛的数据覆盖问题, 还可能是策略涌现本身的条件之一. 尽管如此, 这仅仅是第一步. 更根本的目标是让模型能够自主发现更优的推理和 agent 策略, 而非始终局限于人类提供的初始模式的变体. 在此之外还有一个更艰巨的挑战: 让模型发现更丰富的组织形式, 例如子 agent 分解, 多 agent 协作以及更灵活的分层决策结构.

Multimodal context management remains a core bottleneck for long-horizon agents. Compared with text, images and especially videos consume context budget much more aggressively, making them expensive to retain over long trajectories. In practice, many systems respond by dropping earlier visual observations as context grows. While being an understandable engineering compromise, it also discards information that may remain important for later reasoning, planning, or verification. The challenge becomes sharper as trajectories lengthen. In text-only settings, systems such as Claude Code often respond to growing context pressure by compacting or summarizing earlier interaction history once the context window starts to fill up; in multimodal settings, however, faithful compression is much harder, because what must be preserved is not only semantic content, but also visual detail that may later become important again, such as layout, spatial relations, or temporal change in video. Most current memory mechanisms remain fundamentally text-centric: they are better at compressing what was said than what was seen, or how visual states evolved over time. For long-horizon multimodal agents, simply adapting text memory mechanisms will therefore be insufficient. What is needed instead is a more multimodal-native approach to context and memory.

多模态上下文管理仍然是长程 agent 的核心瓶颈. 与文本相比, 图像尤其是视频会更快地消耗上下文预算, 使得它们在长轨迹中保留的成本很高. 在实践中, 许多系统采取的做法是在上下文增长时丢弃早期的视觉观测. 虽然这是一种可以理解的工程折中, 但它也丢弃了对于后续推理, 规划或验证仍然重要的信息. 随着轨迹变长, 这一挑战愈发尖锐. 在纯文本场景中, Claude Code 等系统通常会在上下文窗口即将填满时, 通过压缩或总结早期的交互历史来应对上下文压力; 然而, 在多模态场景中, 忠实的压缩要困难得多, 因为需要保留的不仅是语义内容, 还有可能再次变得重要的视觉细节, 例如布局, 空间关系或视频中的时序变化. 当前大多数记忆机制本质上仍是文本中心的: 它们更擅长压缩"说了什么", 而非"看到了什么"或视觉状态如何随时间演变. 因此, 对于长程多模态 agent 来说, 简单地改造文本记忆机制是不够的. 取而代之的是需要一种更加原生于多模态的上下文与记忆方法.

Model and harness increasingly co-shape the system's capability boundary. For agentic systems, the effective capability boundary is no longer determined by the model alone, but jointly shaped by the model and the harness around it. This greatly expands the design space: task decomposition, tool use, memory mechanisms, and verification loops can all affect what the system is able to do in practice. At the same time, it makes the development path substantially complex: the same model may behave very differently under different decomposition strategies, tool-use policies, memory designs, or verification workflows; conversely, what appears to be a model limitation may sometimes reflect a poor harness choice instead. More importantly, this dependence runs both ways: the usefulness of a harness often depends on the model's capability regime, and designs that are ineffective at one stage may become critical once the model crosses a threshold in reasoning, planning, or feedback utilization. This means the harness is not a stable external layer that can be optimized independently of the model. Its role, value, and optimal form shift as the model evolves. More broadly, this means that agentic model development can no longer be framed as model improvement alone: the effective capability boundary is increasingly co-shaped by the model and the harness, and so too are the objectives by which progress is optimized and evaluated.

模型与 harness 日益共同塑造系统的能力边界. 对于 agent 系统而言, 有效的能力边界不再仅由模型单独决定, 而是由模型及其周围的 harness 共同塑造. 这极大地扩展了设计空间: 任务分解, 工具使用, 记忆机制和验证回路都会影响系统在实际中能做什么. 与此同时, 这也使开发路径变得相当复杂: 同一模型在不同的分解策略, 工具使用策略, 记忆设计或验证工作流下可能表现得非常不同; 反之, 看似是模型局限之处有时可能反映的是 harness 选择不当. 更重要的是, 这种依赖关系是双向的: harness 的效用往往取决于模型的能力区间, 而在某一阶段无效的设计, 一旦模型在推理, 规划或反馈利用上跨越某个阈值, 就可能变得至关重要. 这意味着 harness 并非一个可以独立于模型进行优化的稳定外部层. 它的角色, 价值和最优形式会随着模型的演进而变化. 更广泛地说, 这意味着 agent 模型的开发不能再被框定为单纯的模型改进: 有效的能力边界日益由模型与 harness 共同塑造, 优化的目标和评估的准则同样如此.

> 译者注: 文中 harness 指围绕模型构建的任务分解, 工具调用, 记忆与验证等系统级框架, 与模型本身共同决定系统的有效能力边界.

> 译者注: cold-start 即冷启动, 指强化学习训练初期依赖人类标注或演示数据来启动模型策略学习的阶段.
## 7 Contribution

The contributors' names are listed in reverse alphabetical order (Z to A) by first name.

贡献者姓名按名字首字母逆序(从 Z 到 A)排列.

Core Contributors

核心贡献者

Ziyang Pan, Zhen Yang, Yuting Wang, Yue Wang, Yuanchang Yue, Yu Wang, Yanling Wang, Yan Wang, Xijun Liu, Wenmeng Yu, Weihan Wang, Wei Li, Shuaiqi Duan, Sheng Yang, Ruiliang Lv, Mingdao Liu, Lihang Pan, Ke Ning, Junhui Ji, Jinjiang Wang, Jing Chen, Jiazheng Xu, Jiale Zhu, Jiale Cheng, Ji Qi, Guobing Gan, Guo Wang, Cong Yao

Ziyang Pan, Zhen Yang, Yuting Wang, Yue Wang, Yuanchang Yue, Yu Wang, Yanling Wang, Yan Wang, Xijun Liu, Wenmeng Yu, Weihan Wang, Wei Li, Shuaiqi Duan, Sheng Yang, Ruiliang Lv, Mingdao Liu, Lihang Pan, Ke Ning, Junhui Ji, Jinjiang Wang, Jing Chen, Jiazheng Xu, Jiale Zhu, Jiale Cheng, Ji Qi, Guobing Gan, Guo Wang, Cong Yao

Contributors

贡献者

Zijun Dou, Zihao Zhou, Zihan Wang, Zhiqi Ge, Zhijie Li, Zhenyu Hou, Zhao Xue, Zehui Wang, Zehan Qi, Zehai He, Yutao Zhang, Yusen Liu, Yukuo Cen, Yuchen Li, Yuan Wang, Yu Yang, Yongbin Liu, Yijian Lu, Yifan Xu, Yanzi Wang, Yanxiao Zhao, Yanfeng Wang, Yadong Xue, Yabo Xu, Xinyu Zhang, Xinyu Liu, Xiao Liu, Wenyi Zhao, Wenkai Li, Tianyu Tong, Tianshu Zhang, Shudan Zhang, Shengdong Yan, Qinkai Zheng, Mingde Xu, Licheng Bao, lat Long long, Jiaxing Xu, Jiaxin Fan, Jiawen Qian, Jiali Chen, Jiahui Lin, Jiadai Sun, Haozhi Zheng, Haoran Wang, Haochen Li, Hanyu Lai, Han Xu, Fan Yang, Dan Zhang, Da Yin, Chuangxin Zhao, Chengcheng Wu, Boyan Shi, Bowen Lv, Bowei Jia, Bo Li, Bin Chen, Baoxu Wang

Zijun Dou, Zihao Zhou, Zihan Wang, Zhiqi Ge, Zhijie Li, Zhenyu Hou, Zhao Xue, Zehui Wang, Zehan Qi, Zehai He, Yutao Zhang, Yusen Liu, Yukuo Cen, Yuchen Li, Yuan Wang, Yu Yang, Yongbin Liu, Yijian Lu, Yifan Xu, Yanzi Wang, Yanxiao Zhao, Yanfeng Wang, Yadong Xue, Yabo Xu, Xinyu Zhang, Xinyu Liu, Xiao Liu, Wenyi Zhao, Wenkai Li, Tianyu Tong, Tianshu Zhang, Shudan Zhang, Shengdong Yan, Qinkai Zheng, Mingde Xu, Licheng Bao, lat Long long, Jiaxing Xu, Jiaxin Fan, Jiawen Qian, Jiali Chen, Jiahui Lin, Jiadai Sun, Haozhi Zheng, Haoran Wang, Haochen Li, Hanyu Lai, Han Xu, Fan Yang, Dan Zhang, Da Yin, Chuangxin Zhao, Chengcheng Wu, Boyan Shi, Bowen Lv, Bowei Jia, Bo Li, Bin Chen, Baoxu Wang

Tech Leads

技术负责人

Wenyi Hong, Xiaotao Gu

Wenyi Hong, Xiaotao Gu

Academic Advisors

学术顾问

Peng Zhang, Debing Liu, Bin Xu, Juanzi Li, Minlie Huang, Yuxiao Dong, Jie Tang

Peng Zhang, Debing Liu, Bin Xu, Juanzi Li, Minlie Huang, Yuxiao Dong, Jie Tang

References

参考文献

[1] Pinchbench. https://github.com/pinchbench/skill.

[1] Pinchbench. https://github.com/pinchbench/skill.

[2] Zclawbench. https://huggingface.co/datasets/zai-org/ZClawBench.

[2] Zclawbench. https://huggingface.co/datasets/zai-org/ZClawBench.

[3] Anthropic. Claude code: Ai-powered coding assistant, 2025. CLI tool and IDE extension for AI-assisted software development.

[3] Anthropic. Claude code: AI 驱动的编程助手, 2025. 用于 AI 辅助软件开发的 CLI 工具和 IDE 扩展.

[4] Anthropic. Introducing claude opus 4.6. https://www.anthropic.com/news/claude-opus-4-6, Feb. 2026. Accessed: 2026-04-15.

[4] Anthropic. 推出 Claude Opus 4.6. https://www.anthropic.com/news/claude-opus-4-6, 2026年2月. 访问日期: 2026-04-15.

[5] ByteDance Seed. Seed2.0 model card: Towards intelligence frontier for real-world complexity. https://lf3-static.bytednsdoc.com/obj/eden-cn/lapzild-tss/ljhwZthlaukjlkulzlp/seed2/0214/Seed2.0%20Model%20Card.pdf, 2026. Technical report / model card, accessed 2026-04-15.

[5] ByteDance Seed. Seed2.0 模型卡: 迈向真实世界复杂性的智能前沿. https://lf3-static.bytednsdoc.com/obj/eden-cn/lapzild-tss/ljhwZthlaukjlkulzlp/seed2/0214/Seed2.0%20Model%20Card.pdf, 2026. 技术报告/模型卡, 访问日期 2026-04-15.

[6] L. Cheng, J. Duan, Y. R. Wang, H. Fang, B. Li, Y. Huang, E. Wang, A. Eftekhar, J. Lee, W. Yuan, et al. Pointarena: Probing multimodal grounding through language-guided pointing. arXiv preprint arXiv:2505.09990, 2025.

[6] L. Cheng, J. Duan, Y. R. Wang, H. Fang, B. Li, Y. Huang, E. Wang, A. Eftekhar, J. Lee, W. Yuan, 等. Pointarena: 通过语言引导的指向探测多模态定位. arXiv 预印本 arXiv:2505.09990, 2025.

[7] X. Cheng, W. Zhang, S. Zhang, J. Yang, X. Guan, X. Wu, X. Li, G. Zhang, J. Liu, Y. Mai, et al. Simplevqa: Multimodal factuality evaluation for multimodal large language models. In Proceedings of the IEEE/CVF International Conference on Computer Vision, pages 4637--4646, 2025.

[7] X. Cheng, W. Zhang, S. Zhang, J. Yang, X. Guan, X. Wu, X. Li, G. Zhang, J. Liu, Y. Mai, 等. Simplevqa: 面向多模态大语言模型的多模态事实性评估. 载于 IEEE/CVF 国际计算机视觉会议论文集, 第 4637--4646 页, 2025.

[8] S. Duan, Y. Xue, W. Wang, Z. Su, H. Liu, S. Yang, G. Gan, G. Wang, Z. Wang, S. Yan, D. Jin, Y. Zhang, G. Wen, Y. Wang, Y. Zhang, X. Zhang, W. Hong, Y. Cen, D. Yin, B. Chen, W. Yu, X. Gu, and J. Tang. Glm-ocr technical report, 2026.

[8] S. Duan, Y. Xue, W. Wang, Z. Su, H. Liu, S. Yang, G. Gan, G. Wang, Z. Wang, S. Yan, D. Jin, Y. Zhang, G. Wen, Y. Wang, Y. Zhang, X. Zhang, W. Hong, Y. Cen, D. Yin, B. Chen, W. Yu, X. Gu, 和 J. Tang. GLM-OCR 技术报告, 2026.

[9] T. Ge, Y. Liu, J. Ye, T. Li, and C. Wang. Advancing vision-language models in front-end development via data synthesis. arXiv preprint arXiv:2503.01619, 2025.

[9] T. Ge, Y. Liu, J. Ye, T. Li, 和 C. Wang. 通过数据合成推进视觉语言模型在前端开发中的应用. arXiv 预印本 arXiv:2503.01619, 2025.

[10] X. Geng, P. Xia, Z. Zhang, X. Wang, Q. Wang, R. Ding, C. Wang, J. Wu, Y. Zhao, K. Li, Y. Jiang, P. Xie, F. Huang, and J. Zhou. Webwatcher: Breaking new frontier of vision-language deep research agent, 2025.

[10] X. Geng, P. Xia, Z. Zhang, X. Wang, Q. Wang, R. Ding, C. Wang, J. Wu, Y. Zhao, K. Li, Y. Jiang, P. Xie, F. Huang, 和 J. Zhou. Webwatcher: 打破视觉语言深度研究智能体的新前沿, 2025.

[11] F. Gloeckle, B. Y. Idrissi, B. Rozière, D. Lopez-Paz, and G. Synnaeve. Better & faster large language models via multi-token prediction. arXiv preprint arXiv:2404.19737, 2024.

[11] F. Gloeckle, B. Y. Idrissi, B. Rozière, D. Lopez-Paz, 和 G. Synnaeve. 通过多令牌预测实现更好更快的大语言模型. arXiv 预印本 arXiv:2404.19737, 2024.

[12] Google Workspace. The latest updates for Deep Research in Gemini. https://workspaceupdates.googleblog.com/2025/05/deep-research-updates-gemini-io-2025.html, May 2025. Accessed: 2026-04-15.

[12] Google Workspace. Gemini 中深度研究的最新更新. https://workspaceupdates.googleblog.com/2025/05/deep-research-updates-gemini-io-2025.html, 2025年5月. 访问日期: 2026-04-15.

[13] H. He, W. Yao, K. Ma, W. Yu, Y. Dai, H. Zhang, Z. Lan, and D. Yu. Webvoyager: Building an end-to-end web agent with large multimodal models. arXiv preprint arXiv:2401.13919, 2024.

[13] H. He, W. Yao, K. Ma, W. Yu, Y. Dai, H. Zhang, Z. Lan, 和 D. Yu. Webvoyager: 利用大型多模态模型构建端到端网页智能体. arXiv 预印本 arXiv:2401.13919, 2024.

[14] Z. He, W. Hong, Z. Yang, Z. Pan, M. Liu, X. Gu, and J. Tang. Vision2web: A hierarchical benchmark for visual website development with agent verification. arXiv preprint arXiv:2603.26648, 2026.

[14] Z. He, W. Hong, Z. Yang, Z. Pan, M. Liu, X. Gu, 和 J. Tang. Vision2web: 面向视觉网站开发的分层基准与智能体验证. arXiv 预印本 arXiv:2603.26648, 2026.

[15] A. Henry, P. R. Dachapally, S. S. Pawar, and Y. Chen. Query-key normalization for transformers. In Findings of the Association for Computational Linguistics: EMNLP 2020, pages 4246--4253, 2020.

[15] A. Henry, P. R. Dachapally, S. S. Pawar, 和 Y. Chen. Transformer 的查询-键归一化. 载于计算语言学协会发现: EMNLP 2020, 第 4246--4253 页, 2020.

[16] W. Hong, W. Wang, Q. Lv, J. Xu, W. Yu, J. Ji, Y. Wang, Z. Wang, Y. Dong, M. Ding, et al. Cogagent: A visual language model for gui agents. In Proceedings of the IEEE/CVF conference on computer vision and pattern recognition, pages 14281--14290, 2024.

[16] W. Hong, W. Wang, Q. Lv, J. Xu, W. Yu, J. Ji, Y. Wang, Z. Wang, Y. Dong, M. Ding, 等. Cogagent: 面向 GUI 智能体的视觉语言模型. 载于 IEEE/CVF 计算机视觉与模式识别会议论文集, 第 14281--14290 页, 2024.

[17] A. Jacovi, A. Wang, C. Alberti, J. L. Connie Tao, K. Olszewska, L. Haas, M. Liu, N. Keating, A. Bloniarz, C. Saroufim, C. Fry, D. Marcus, D. Kukliansky, G. S. Tomar, J. Swirhun, J. Xing, L. Wang, M. Aaron, M. Ambar, R. Fellinger, R. Wang, R. Sims, Z. Zhang, S. Goldshtein, Y. Matias, and D. Das. Facts leaderboard. https://kaggle.com/facts-leaderboard, 2024. Google DeepMind, Google Research, Google Cloud, Kaggle.

[17] A. Jacovi, A. Wang, C. Alberti, J. L. Connie Tao, K. Olszewska, L. Haas, M. Liu, N. Keating, A. Bloniarz, C. Saroufim, C. Fry, D. Marcus, D. Kukliansky, G. S. Tomar, J. Swirhun, J. Xing, L. Wang, M. Aaron, M. Ambar, R. Fellinger, R. Wang, R. Sims, Z. Zhang, S. Goldshtein, Y. Matias, 和 D. Das. Facts 排行榜. https://kaggle.com/facts-leaderboard, 2024. Google DeepMind, Google Research, Google Cloud, Kaggle.

[18] D. Jiang, R. Zhang, Z. Guo, Y. Wu, J. Lei, P. Qiu, P. Lu, Z. Chen, C. Fu, G. Song, et al. Mmsearch: Benchmarking the potential of large models as multi-modal search engines. arXiv preprint arXiv:2409.12959, 2024.

[18] D. Jiang, R. Zhang, Z. Guo, Y. Wu, J. Lei, P. Qiu, P. Lu, Z. Chen, C. Fu, G. Song, 等. MMSearch: 评估大模型作为多模态搜索引擎的潜力. arXiv 预印本 arXiv:2409.12959, 2024.

[19] D. Jiang, R. Zhang, Z. Guo, Y. Wu, J. Lei, P. Qiu, P. Lu, Z. Chen, C. Fu, G. Song, et al. Mmsearch: Benchmarking the potential of large models as multi-modal search engines. arXiv preprint arXiv:2409.12959, 2024.

[19] D. Jiang, R. Zhang, Z. Guo, Y. Wu, J. Lei, P. Qiu, P. Lu, Z. Chen, C. Fu, G. Song, 等. MMSearch: 评估大模型作为多模态搜索引擎的潜力. arXiv 预印本 arXiv:2409.12959, 2024.

[20] C. E. Jimenez, J. Yang, A. Wettig, S. Yao, K. Pei, O. Press, and K. Narasimhan. Swe-bench: Can language models resolve real-world github issues? arXiv preprint arXiv:2310.06770, 2023.

[20] C. E. Jimenez, J. Yang, A. Wettig, S. Yao, K. Pei, O. Press, 和 K. Narasimhan. SWE-bench: 语言模型能否解决真实世界的 GitHub 问题? arXiv 预印本 arXiv:2310.06770, 2023.

[21] K. Jordan et al. Muon: An optimizer for hidden layers in neural networks. https://kellerjordan.github.io/posts/muon/, 2024.

[21] K. Jordan 等. Muon: 神经网络隐藏层的优化器. https://kellerjordan.github.io/posts/muon/, 2024.

[22] A. Karpathy. Autoresearch: Ai agents running research, March 2026. AI agents running research on single-GPU nanochat training automatically.

[22] A. Karpathy. AutoResearch: AI 智能体运行研究, 2026年3月. 在单 GPU nanochat 训练上自动运行研究的 AI 智能体.

[23] S. Kazemzadeh, V. Ordonez, M. Matten, and T. Berg. Referitgame: Referring to objects in photographs of natural scenes. In Proceedings of the 2014 conference on empirical methods in natural language processing (EMNLP), pages 787--798, 2014.

[23] S. Kazemzadeh, V. Ordonez, M. Matten, 和 T. Berg. Referitgame: 指代自然场景照片中的物体. 载于 2014 年实证方法自然语言处理会议(EMNLP)论文集, 第 787--798 页, 2014.

[24] K. Li, Y. Wang, Y. He, Y. Li, Y. Wang, Y. Liu, Z. Wang, J. Xu, G. Chen, P. Luo, et al. Mvbench: A comprehensive multi-modal video understanding benchmark. In Proceedings of the IEEE/CVF Conference on Computer Vision and Pattern Recognition, pages 22195--22206, 2024.

[24] K. Li, Y. Wang, Y. He, Y. Li, Y. Wang, Y. Liu, Z. Wang, J. Xu, G. Chen, P. Luo, 等. MVBench: 综合多模态视频理解基准. 载于 IEEE/CVF 计算机视觉与模式识别会议论文集, 第 22195--22206 页, 2024.

[25] Y. Liu, Z. Li, M. Huang, B. Yang, W. Yu, C. Li, X.-C. Yin, C.-L. Liu, L. Jin, and X. Bai. Ocrbench: on the hidden mystery of ocr in large multimodal models. Science China Information Sciences, 67(12):220102, 2024.

[25] Y. Liu, Z. Li, M. Huang, B. Yang, W. Yu, C. Li, X.-C. Yin, C.-L. Liu, L. Jin, 和 X. Bai. OCRBench: 关于大型多模态模型中 OCR 的隐藏奥秘. 中国科学: 信息科学, 67(12):220102, 2024.

[26] P. Lu, H. Bansal, T. Xia, J. Liu, C. Li, H. Hajishirzi, H. Cheng, K.-W. Chang, M. Galley, and J. Gao. Mathvista: Evaluating mathematical reasoning of foundation models in visual contexts. arXiv preprint arXiv:2310.02255, 2023.

[26] P. Lu, H. Bansal, T. Xia, J. Liu, C. Li, H. Hajishirzi, H. Cheng, K.-W. Chang, M. Galley, 和 J. Gao. MathVista: 评估基础模型在视觉上下文中的数学推理能力. arXiv 预印本 arXiv:2310.02255, 2023.

[27] OpenAI. Introducing deep research. https://openai.com/index/introducing-deep-research, February 2025. Accessed: 2026-04-15.

[27] OpenAI. 推出深度研究(Deep Research). https://openai.com/index/introducing-deep-research, 2025年2月. 访问日期: 2026-04-15.

[28] OpenAI. Introducing gpt-5.4. https://openai.com/index/introducing-gpt-5-4/, Mar. 2026. Accessed: 2026-04-15.

[28] OpenAI. 推出 GPT-5.4. https://openai.com/index/introducing-gpt-5-4/, 2026年3月. 访问日期: 2026-04-15.

[29] OpenClaw. Openclaw. https://github.com/openclaw/openclaw, 2026. GitHub repository, accessed 2026-04-15.

[29] OpenClaw. OpenClaw. https://github.com/openclaw/openclaw, 2026. GitHub 仓库, 访问日期 2026-04-15.

[30] C. Rawles, S. Clinckemaillie, Y. Chang, J. Waltz, G. Lau, M. Fair, A. Li, W. Bishop, W. Li, F. Campbell-Ajala, et al. Androidworld: A dynamic benchmarking environment for autonomous agents. arXiv:2405.14573, 2024.

[30] C. Rawles, S. Clinckemaillie, Y. Chang, J. Waltz, G. Lau, M. Fair, A. Li, W. Bishop, W. Li, F. Campbell-Ajala, 等. AndroidWorld: 面向自主智能体的动态基准环境. arXiv:2405.14573, 2024.

[31] C. Si, Y. Zhang, R. Li, Z. Yang, R. Liu, and D. Yang. Design2code: Benchmarking multimodal code generation for automated front-end engineering. In Proceedings of the 2025 Conference of the Nations of the Americas Chapter of the Association for Computational Linguistics: Human Language Technologies (Volume 1: Long Papers), pages 3956--3974, 2025.

[31] C. Si, Y. Zhang, R. Li, Z. Yang, R. Liu, 和 D. Yang. Design2Code: 面向自动化前端工程的多模态代码生成基准. 载于 2025 年美洲计算语言学协会分会会议: 人类语言技术(第 1 卷: 长文)论文集, 第 3956--3974 页, 2025.

[32] O. Siméoni, H. V. Vo, M. Seitzer, F. Baldassarre, M. Oquab, C. Jose, V. Khalidov, M. Szafraniec, S. Yi, M. Ramamonjisoa, et al. Dinov3. arXiv preprint arXiv:2508.10104, 2025.

[32] O. Siméoni, H. V. Vo, M. Seitzer, F. Baldassarre, M. Oquab, C. Jose, V. Khalidov, M. Szafraniec, S. Yi, M. Ramamonjisoa, 等. DINOv3. arXiv 预印本 arXiv:2508.10104, 2025.

[33] S. Song, S. P. Lichtenberg, and J. Xiao. Sun rgb-d: A rgb-d scene understanding benchmark suite. In Proceedings of the IEEE conference on computer vision and pattern recognition, pages 567--576, 2015.

[33] S. Song, S. P. Lichtenberg, 和 J. Xiao. SUN RGB-D: RGB-D 场景理解基准套件. 载于 IEEE 计算机视觉与模式识别会议论文集, 第 567--576 页, 2015.

[34] P. Steinberger. Openclaw: Open-source personal ai agent framework, 2026. Open-source AI agent platform for building autonomous agents.

[34] P. Steinberger. OpenClaw: 开源个人 AI 智能体框架, 2026. 用于构建自主智能体的开源 AI 智能体平台.

[35] X. Tao, Y. Teng, X. Su, X. Fu, J. Wu, C. Tao, Z. Liu, H. Bai, R. Liu, and L. Kong. Mmsearch-plus: Benchmarking provenance-aware search for multimodal browsing agents. arXiv preprint arXiv:2508.21475, 2025.

[35] X. Tao, Y. Teng, X. Su, X. Fu, J. Wu, C. Tao, Z. Liu, H. Bai, R. Liu, 和 L. Kong. MMSearch-Plus: 面向多模态浏览智能体的来源感知搜索基准. arXiv 预印本 arXiv:2508.21475, 2025.

[36] K. Team, T. Bai, Y. Bai, Y. Bao, S. H. Cai, Y. Cao, Y. Charles, H. S. Che, C. Chen, G. Chen, H. Chen, J. Chen, J. Chen, J. Chen, J. Chen, K. Chen, L. Chen, R. Chen, X. Chen, Y. Chen, Y. Chen, Y. Chen, Y. Chen, Y. Chen, Y. Chen, Y. Chen, Y. Chen, Z. Chen, Z. Chen, D. Cheng, M. Chu, J. Cui, J. Deng, M. Diao, H. Ding, M. Dong, M. Dong, Y. Dong, Y. Dong, A. Du, C. Du, D. Du, L. Du, Y. Du, Y. Fan, S. Fang, Q. Feng, Y. Feng, G. Fu, K. Fu, H. Gao, T. Gao, Y. Ge, S. Geng, C. Gong, X. Gong, Z. Gongque, Q. Gu, X. Gu, Y. Gu, L. Guan, Y. Guo, X. Hao, W. He, W. He, Y. He, C. Hong, H. Hu, J. Hu, Y. Hu, Z. Hu, K. Huang, R. Huang, W. Huang, Z. Huang, T. Jiang, Z. Jiang, X. Jin, Y. Jing, G. Lai, A. Li, C. Li, C. Li, F. Li, G. Li, G. Li, H. Li, H. Li, J. Li, J. Li, J. Li, L. Li, M. Li, W. Li, W. Li, X. Li, X. Li, Y. Li, Y. Li, Y. Li, Y. Li, Z. Li, Z. Li, W. Liao, J. Lin, X. Lin, Z. Lin, Z. Lin, C. Liu, C. Liu, H. Liu, L. Liu, S. Liu, S. Liu, S. Liu, T. Liu, T. Liu, W. Liu, X. Liu, Y. Liu, Y. Liu, Y. Liu, Y. Liu, Y. Liu, Z. Liu, Z. Liu, E. Lu, H. Lu, Z. Lu, J. Luo, T. Luo, Y. Luo, L. Ma, Y. Ma, S. Mao, Y. Mei, X. Men, F. Meng, Z. Meng, Y. Miao, M. Ni, K. Ouyang, S. Pan, B. Pang, Y. Qian, R. Qin, Z. Qin, J. Qiu, B. Qu, Z. Shang, Y. Shao, T. Shen, Z. Shen, J. Shi, L. Shi, S. Shi, F. Song, P. Song, T. Song, X. Song, H. Su, J. Su, Z. Su, L. Sui, J. Sun, J. Sun, T. Sun, F. Sung, Y. Tai, C. Tang, H. Tang, X. Tang, Z. Tang, J. Tao, S. Teng, C. Tian, P. Tian, A. Wang, B. Wang, C. Wang, C. Wang, C. Wang, D. Wang, D. Wang, D. Wang, F. Wang, H. Wang, H. Wang, H. Wang, H. Wang, H. Wang, J. Wang, J. Wang, J. Wang, K. Wang, L. Wang, Q. Wang, S. Wang, S. Wang, S. Wang, W. Wang, X. Wang, X. Wang, Y. Wang, Y. Wang, Y. Wang, Y. Wang, Y. Wang, Y. Wang, Z. Wang, Z. Wang, Z. Wang, Z. Wang, Z. Wang, Z. Wang, C. Wei, M. Wei, C. Wen, Z. Wen, C. Wu, H. Wu, J. Wu, R. Wu, W. Wu, Y. Wu, Y. Wu, Y. Wu, Z. Wu, C. Xiao, J. Xie, X. Xie, Y. Xie, Y. Xin, B. Xing, B. Xu, J. Xu, J. Xu, J. Xu, L. H. Xu, L. Xu, S. Xu, W. Xu, X. Xu, X. Xu, Y. Xu, Y. Xu, Y. Xu, Z. Xu, Z. Xu, J. Yan, Y. Yan, G. Yang, H. Yang, J. Yang, K. Yang, N. Yang, R. Yang, X. Yang, X. Yang, Y. Yang, Y. Yang, Y. Yang, Z. Yang, Z. Yang, Z. Yang, H. Yao, D. Ye, W. Ye, Z. Ye, B. Yin, C. Yu, L. Yu, T. Yu, T. Yu, E. Yuan, M. Yuan, X. Yuan, Y. Yue, W. Zeng, D. Zha, H. Zhan, D. Zhang, H. Zhang, J. Zhang, P. Zhang, Q. Zhang, R. Zhang, X. Zhang, Y. Zhang, Y. Zhang, Y. Zhang, Y. Zhang, Y. Zhang, Y. Zhang, Y. Zhang, Y. Zhang, Z. Zhang, C. Zhao, F. Zhao, J. Zhao, S. Zhao, X. Zhao, Y. Zhao, Z. Zhao, H. Zheng, R. Zheng, S. Zheng, T. Zheng, J. Zhong, L. Zhong, W. Zhong, M. Zhou, R. Zhou, X. Zhou, Z. Zhou, J. Zhu, L. Zhu, X. Zhu, Y. Zhu, Z. Zhu, J. Zhuang, W. Zhuang, Y. Zou, and X. Zu. Kimi k2.5: Visual agentic intelligence, 2026.

[36] K. Team 等. Kimi K2.5: 视觉智能体智能, 2026.

[37] V. Team, W. Hong, W. Yu, X. Gu, G. Wang, G. Gan, H. Tang, J. Cheng, J. Qi, J. Ji, L. Pan, S. Duan, W. Wang, Y. Wang, Y. Cheng, Z. He, Z. Su, Z. Yang, Z. Pan, A. Zeng, B. Wang, B. Chen, B. Shi, C. Pang, C. Zhang, D. Yin, F. Yang, G. Chen, J. Xu, J. Zhu, J. Chen, J. Chen, J. Chen, J. Lin, J. Wang, J. Chen, L. Lei, L. Gong, L. Pan, M. Liu, M. Xu, M. Zhang, Q. Zheng, S. Yang, S. Zhong, S. Huang, S. Zhao, S. Xue, S. Tu, S. Meng, T. Zhang, T. Luo, T. Hao, T. Tong, W. Li, W. Jia, X. Liu, X. Zhang, X. Lyu, X. Fan, X. Huang, Y. Wang, Y. Xue, Y. Wang, Y. Wang, Y. An, Y. Du, Y. Shi, Y. Huang, Y. Niu, Y. Wang, Y. Yue, Y. Li, Y. Zhang, Y. Wang, Y. Wang, Y. Zhang, Z. Xue, Z. Hou, Z. Du, Z. Wang, P. Zhang, D. Liu, B. Xu, J. Li, M. Huang, Y. Dong, and J. Tang. Glm-4.5v and glm-4.1v-thinking: Towards versatile multimodal reasoning with scalable reinforcement learning, 2025.

[37] V. Team, W. Hong, W. Yu, X. Gu, G. Wang, G. Gan, H. Tang, J. Cheng, J. Qi, J. Ji, L. Pan, S. Duan, W. Wang, Y. Wang, Y. Cheng, Z. He, Z. Su, Z. Yang, Z. Pan, A. Zeng, B. Wang, B. Chen, B. Shi, C. Pang, C. Zhang, D. Yin, F. Yang, G. Chen, J. Xu, J. Zhu, J. Chen, J. Chen, J. Chen, J. Lin, J. Wang, J. Chen, L. Lei, L. Gong, L. Pan, M. Liu, M. Xu, M. Zhang, Q. Zheng, S. Yang, S. Zhong, S. Huang, S. Zhao, S. Xue, S. Tu, S. Meng, T. Zhang, T. Luo, T. Hao, T. Tong, W. Li, W. Jia, X. Liu, X. Zhang, X. Lyu, X. Fan, X. Huang, Y. Wang, Y. Xue, Y. Wang, Y. Wang, Y. An, Y. Du, Y. Shi, Y. Huang, Y. Niu, Y. Wang, Y. Yue, Y. Li, Y. Zhang, Y. Wang, Y. Wang, Y. Zhang, Z. Xue, Z. Hou, Z. Du, Z. Wang, P. Zhang, D. Liu, B. Xu, J. Li, M. Huang, Y. Dong, 和 J. Tang. GLM-4.5V 和 GLM-4.1V-Thinking: 迈向可扩展强化学习的通用多模态推理, 2025.

[38] Z. A. Team. Glm-image: Auto-regressive for dense-knowledge and high-fidelity image generation. Technical blog, Zhipu AI (Z.ai), January 2026. First open-source industrial-grade discrete autoregressive image generation model with hybrid AR+Diffusion architecture.

[38] Z. A. Team. GLM-Image: 面向密集知识和高保真图像生成的自回归模型. 技术博客, 智谱 AI (Z.ai), 2026年1月. 首个开源工业级离散自回归图像生成模型, 采用混合 AR+Diffusion 架构.

[39] M. Tschannen, A. Gritsenko, X. Wang, M. F. Naeem, I. Alabdulmohsin, N. Parthasarathy, T. Evans, L. Beyer, Y. Xia, B. Mustafa, et al. Siglip 2: Multilingual vision-language encoders with improved semantic understanding, localization, and dense features. arXiv preprint arXiv:2502.14786, 2025.

[39] M. Tschannen, A. Gritsenko, X. Wang, M. F. Naeem, I. Alabdulmohsin, N. Parthasarathy, T. Evans, L. Beyer, Y. Xia, B. Mustafa, 等. SigLIP 2: 具有改进语义理解、定位和密集特征的多语言视觉-语言编码器. arXiv 预印本 arXiv:2502.14786, 2025.

[40] Z. Wang, M. Xia, L. He, H. Chen, Y. Liu, R. Zhu, K. Liang, X. Wu, H. Liu, S. Malladi, et al. Charxiv: Charting gaps in realistic chart understanding in multimodal llms. Advances in Neural Information Processing Systems, 37:113569--113697, 2024.

[40] Z. Wang, M. Xia, L. He, H. Chen, Y. Liu, R. Zhu, K. Liang, X. Wu, H. Liu, S. Malladi, 等. CharXiv: 绘制多模态大语言模型在现实图表理解中的差距. 神经信息处理系统进展, 37:113569--113697, 2024.

[41] P. Wu and S. Xie. V*: Guided visual search as a core mechanism in multimodal llms, 2023.

[41] P. Wu 和 S. Xie. V*: 引导式视觉搜索作为多模态大语言模型的核心机制, 2023.

[42] Y. Xiao, E. Sun, T. Liu, and W. Wang. Logicvista: Multimodal llm logical reasoning benchmark in visual contexts. arXiv preprint arXiv:2407.04973, 2024.

[42] Y. Xiao, E. Sun, T. Liu, 和 W. Wang. LogicVista: 视觉上下文中的多模态大语言模型逻辑推理基准. arXiv 预印本 arXiv:2407.04973, 2024.

[43] T. Xie, D. Zhang, J. Chen, X. Li, S. Zhao, R. Cao, T. J. Hua, Z. Cheng, D. Shin, F. Lei, et al. Osworld: Benchmarking multimodal agents for open-ended tasks in real computer environments. Advances in Neural Information Processing Systems, 37:52040--52094, 2024.

[43] T. Xie, D. Zhang, J. Chen, X. Li, S. Zhao, R. Cao, T. J. Hua, Z. Cheng, D. Shin, F. Lei, 等. OSWorld: 在真实计算机环境中对开放式任务的多模态智能体进行基准测试. 神经信息处理系统进展, 37:52040--52094, 2024.

[44] T. Xie, D. Zhang, J. Chen, X. Li, S. Zhao, R. Cao, J. H. Toh, Z. Cheng, D. Shin, F. Lei, et al. Osworld: Benchmarking multimodal agents for open-ended tasks in real computer environments. Advances in Neural Information Processing Systems, 37:52040--52094, 2025.

[44] T. Xie, D. Zhang, J. Chen, X. Li, S. Zhao, R. Cao, J. H. Toh, Z. Cheng, D. Shin, F. Lei, 等. OSWorld: 在真实计算机环境中对开放式任务的多模态智能体进行基准测试. 神经信息处理系统进展, 37:52040--52094, 2025.

[45] Z. Yang, W. Hong, M. Xu, X. Fan, W. Wang, J. Cheng, X. Gu, and J. Tang. Ui2code^ n: Ui-to-code generation as interactive visual optimization. arXiv preprint arXiv:2511.08195, 2025.

[45] Z. Yang, W. Hong, M. Xu, X. Fan, W. Wang, J. Cheng, X. Gu, 和 J. Tang. UI2Code^n: UI-to-code 生成作为交互式视觉优化. arXiv 预印本 arXiv:2511.08195, 2025.

[46] B. Ye, R. Li, Q. Yang, Y. Liu, L. Yao, H. Lv, Z. Xie, C. An, L. Li, L. Kong, et al. Claw-eval: Toward trustworthy evaluation of autonomous agents. arXiv preprint arXiv:2604.06132, 2026.

[46] B. Ye, R. Li, Q. Yang, Y. Liu, L. Yao, H. Lv, Z. Xie, C. An, L. Li, L. Kong, 等. ClawEval: 迈向自主智能体的可信评估. arXiv 预印本 arXiv:2604.06132, 2026.

[47] X. Yue, Y. Ni, K. Zhang, T. Zheng, R. Liu, G. Zhang, S. Stevens, D. Jiang, W. Ren, Y. Sun, et al. Mmmu: A massive multi-discipline multimodal understanding and reasoning benchmark for expert agi. In Proceedings of the IEEE/CVF conference on computer vision and pattern recognition, pages 9556--9567, 2024.

[47] X. Yue, Y. Ni, K. Zhang, T. Zheng, R. Liu, G. Zhang, S. Stevens, D. Jiang, W. Ren, Y. Sun, 等. MMMU: 面向专家级 AGI 的大规模多学科多模态理解与推理基准. 载于 IEEE/CVF 计算机视觉与模式识别会议论文集, 第 9556--9567 页, 2024.

[48] X. Yue, T. Zheng, Y. Ni, Y. Wang, K. Zhang, S. Tong, Y. Sun, B. Yu, G. Zhang, H. Sun, et al. Mmmu-pro: A more robust multi-discipline multimodal understanding benchmark. In Proceedings of the 63rd Annual Meeting of the Association for Computational Linguistics (Volume 1: Long Papers), pages 15134--15186, 2025.

[48] X. Yue, T. Zheng, Y. Ni, Y. Wang, K. Zhang, S. Tong, Y. Sun, B. Yu, G. Zhang, H. Sun, 等. MMMU-Pro: 一个更鲁棒的多学科多模态理解基准. 载于第 63 届计算语言学协会年会(第 1 卷: 长文)论文集, 第 15134--15186 页, 2025.

[49] A. Zeng, X. Lv, Z. Hou, Z. Du, Q. Zheng, B. Chen, D. Yin, C. Ge, C. Huang, C. Xie, et al. Glm-5: from vibe coding to agentic engineering. arXiv preprint arXiv:2602.15763, 2026.

[49] A. Zeng, X. Lv, Z. Hou, Z. Du, Q. Zheng, B. Chen, D. Yin, C. Ge, C. Huang, C. Xie, 等. GLM-5: 从氛围编程(Vibe Coding)到智能体工程(Agentic Engineering). arXiv 预印本 arXiv:2602.15763, 2026.

[50] Zhipu AI Team. Autoclaw. https://autoglm.zhipuai.cn/autoclaw/, 2026. AI Assistant Tool Supporting Windows & macOS, Model Hot-Swapping, 50+ Skills, AutoGLM Browser Automation, accessed 2026-04-15.

[50] 智谱 AI 团队. AutoClaw. https://autoglm.zhipuai.cn/autoclaw/, 2026. 支持 Windows 和 macOS 的 AI 助手工具, 模型热切换, 50+ 技能, AutoGLM 浏览器自动化, 访问日期 2026-04-15.

A
Demo Cases

A
演示案例

We demonstrate the capabilities and advantages of GLM-5V-Turbo through typical qualitative examples from various scenarios.

我们通过来自各种场景的典型定性示例来展示 GLM-5V-Turbo 的能力和优势.

### A.1 In Combination with Agent Systems and Skills
与智能体系统和技能结合

Figure 6: A case showing the application of GLM-5V-Turbo to stock analysis, with OpenClaw and the official skill glmv-stock-analyst3. It gathers relevant information from multiple sources and produces a professional analysis report, including technical analysis, fundamental analysis, analyst sentiment and action plan. Query: Analyze NVIDIA's stock and give a English report.
3URL: https://clawhub.ai/zai-org/glmv-stock-analyst

图 6: 展示 GLM-5V-Turbo 应用于股票分析的案例, 配合 OpenClaw 和官方技能 glmv-stock-analyst3. 它从多个来源收集相关信息并生成专业分析报告, 包括技术分析、基本面分析、分析师情绪和行动计划. 查询: 分析 NVIDIA 的股票并给出一份英文报告.
3链接: https://clawhub.ai/zai-org/glmv-stock-analyst

Figure 7: A case showing the application of GLM-5V-Turbo to URL-based GUI exploration, asset collection, and webpage recreation, with Claude Code and the official skill glmv-web-replication4. Query: Given a target website URL: https: // webflow-path-three. webflow. io/ , please explore it via GUI, collect the necessary assets, and recreate the webpage in HTML code with high visual fidelity and functional completeness.

图 7: 展示 GLM-5V-Turbo 应用于基于 URL 的 GUI 探索、素材收集和网页复现的案例, 配合 Claude Code 和官方技能 glmv-web-replication4. 查询: 给定目标网站 URL: https://webflow-path-three.webflow.io/, 请通过 GUI 探索它, 收集必要的素材, 并以高视觉保真度和功能完整性用 HTML 代码复现该网页.

Figure 8: A case showing the application of GLM-5V-Turbo to PRD-driven website generation, with Claude Code and the official skill glmv-prd-to-app5. Given a product requirements document and the project contents under the act folder, the model uses the PRD skill to design and implement a website in the working directory ./act_workspace. Query: Based on my PRD document, please use your PRD skills to build a website for the project in the act folder. The working directory is ./act_workspace.
4URL: https://clawhub.ai/zai-org/glmv-web-replication
5URL: https://clawhub.ai/zai-org/glmv-prd-to-app

图 8: 展示 GLM-5V-Turbo 应用于 PRD 驱动网站生成的案例, 配合 Claude Code 和官方技能 glmv-prd-to-app5. 给定产品需求文档和 act 文件夹下的项目内容, 模型使用 PRD 技能在工作目录 ./act_workspace 中设计并实现一个网站. 查询: 基于我的 PRD 文档, 请使用你的 PRD 技能为 act 文件夹中的项目构建一个网站. 工作目录为 ./act_workspace.
4链接: https://clawhub.ai/zai-org/glmv-web-replication
5链接: https://clawhub.ai/zai-org/glmv-prd-to-app

### A.2 Multimodal Coding
多模态编程

Figure 9: A case showing the application of GLM-5V-Turbo to full-stack e-commerce website design and implementation, using our official website z.ai 6. Given a high-level product design request, the model generates a complete HTML-based shopping website with multiple functional pages, including a welcome page, shopping interface, brand-story page with parallax scrolling, dark-mode visual design, and a one-page checkout interface with dynamic shipping calculation and address suggestion. The model also completes interactive button behaviors across key pages such as Home, Products, About Brand, and Checkout. Query: You are a master of frontend recreation and web design. Please complete the following design tasks and implement everything in HTML code. 1. Recreate all pages of such a shopping website, using valid image URLs. 2. Create a welcome page and then transition into the shopping interface. 3. On the "About Brand" page, use parallax scrolling to tell the brand story, allowing text to appear rhythmically as the image background moves. 4. Design a color scheme that preserves a premium aesthetic in dark mode and resolves the issue of product images blending into dark backgrounds. 5. Design a one-page checkout interface to reduce user drop-off, including dynamic shipping calculation and address autocomplete. In addition to the above, also implement all button functionalities, such as Home, Products, About Brand, and Checkout.
6URL: https://chat.z.ai/

图 9: 展示 GLM-5V-Turbo 应用于全栈电商网站设计与实现的案例, 使用我们的官方网站 z.ai 6. 给定高层产品设计需求, 模型生成一个完整的基于 HTML 的购物网站, 包含多个功能页面, 包括欢迎页、购物界面、带视差滚动(parallax scrolling)的品牌故事页、暗色模式视觉设计, 以及带动态运费计算和地址建议的单页结账界面. 模型还完成了 Home、Products、About Brand 和 Checkout 等关键页面上的交互按钮行为. 查询: 你是前端复现和网页设计大师. 请完成以下设计任务并用 HTML 代码实现所有内容. 1. 复现该购物网站的所有页面, 使用有效的图片 URL. 2. 创建欢迎页, 然后过渡到购物界面. 3. 在"About Brand"页面, 使用视差滚动讲述品牌故事, 让文字随着背景图像移动而有节奏地出现. 4. 设计一种在暗色模式下保持高级美感的配色方案, 并解决产品图像融入暗色背景的问题. 5. 设计单页结账界面以减少用户流失, 包括动态运费计算和地址自动补全. 除上述内容外, 还请实现所有按钮功能, 如 Home、Products、About Brand 和 Checkout.
6链接: https://chat.z.ai/

Figure 10: A case showing the application of GLM-5V-Turbo to UI recreation and mock interface generation, using our official website z.ai. Given a reference image of a mobile mood-tracking application, the model reconstructs the interface in executable web code and further mocks additional plausible pages and interactions in a consistent visual style. Query: Please recreate the mobile app interface based on the provided image, and additionally mock several possible follow-up pages or user interactions that fit the same product design and functionality.

图 10: 展示 GLM-5V-Turbo 应用于 UI 复现和模拟界面生成的案例, 使用我们的官方网站 z.ai. 给定一张移动情绪追踪应用的参考图像, 模型用可执行的网页代码重建该界面, 并进一步以一致的视觉风格模拟额外的合理页面和交互. 查询: 请根据提供的图像复现移动应用界面, 并额外模拟几个符合相同产品设计和功能的可能后续页面或用户交互.

Figure 11: A case showing the application of GLM-5V-Turbo to agentic UI recreation, using our official website z.ai. Given a reference screenshot of a webpage, the model reconstructs the page in HTML while automatically retrieving the image assets appearing in the screenshot. This example highlights the agentic framework's ability to jointly perform visual understanding, asset collection, and faithful UI recreation. Query: Please recreate the webpage based on the reference screenshot, output the result in HTML, and retrieve the image assets appearing in the screenshot.

图 11: 展示 GLM-5V-Turbo 应用于智能体 UI 复现的案例, 使用我们的官方网站 z.ai. 给定一张网页的参考截图, 模型用 HTML 重建该页面, 同时自动检索截图中出现的图像素材. 该示例凸显了智能体框架联合执行视觉理解、素材收集和忠实 UI 复现的能力. 查询: 请根据参考截图复现网页, 以 HTML 输出结果, 并检索截图中出现的图像素材.

Figure 12: A case showing the application of GLM-5V-Turbo to automatic website generation for research paper, using our official website z.ai. Given the paper GLM-5: from Vibe Coding to Agentic Engineering, the model generates an English website that presents the paper's motivation, core ideas, system design, and key results in a clear and visually organized format with interleaved text and figures. Query: I am preparing an introduction website for the paper GLM-5: from Vibe Coding to Agentic Engineering. Please generate an English website that clearly presents the paper's background, methodology, main findings, and contributions.

图 12: 展示 GLM-5V-Turbo 应用于研究论文自动网站生成的案例, 使用我们的官方网站 z.ai. 给定论文 GLM-5: from Vibe Coding to Agentic Engineering, 模型生成一个英文网站, 以清晰且视觉有序的格式呈现论文的动机、核心思想、系统设计和关键结果, 并采用图文交错的形式. 查询: 我正在为论文 GLM-5: from Vibe Coding to Agentic Engineering 准备一个介绍网站. 请生成一个英文网站, 清晰地呈现该论文的背景、方法论、主要发现和贡献.

Figure 13: A case showing the application of GLM-5V-Turbo to automatic PowerPoint generation from a research paper, using our official website z.ai. Given the paper Attention Is All You Need, the model generates an English slide deck that summarizes the main motivation, method, architecture, and key findings in a presentation-ready format with interleaved text and figures. Query: I am preparing a presentation based on the paper Attention Is All You Need. Please generate an English PowerPoint that summarizes the paper clearly and professionally.

图 13: 展示 GLM-5V-Turbo 应用于从研究论文自动生成 PowerPoint 的案例, 使用我们的官方网站 z.ai. 给定论文 Attention Is All You Need, 模型生成一份英文幻灯片组, 以演示就绪的格式总结主要动机、方法、架构和关键发现, 并采用图文交错的形式. 查询: 我正在基于论文 Attention Is All You Need 准备一个演示文稿. 请生成一份清晰且专业的英文 PowerPoint, 总结该论文.

### A.3 Multimodal Deep Research
多模态深度研究

Figure 14: A case showing the application of GLM-5V-Turbo to image materials collection, using our official website z.ai. Note that the original source for each of the chosen images is cited. Query: I am preparing a feature report on Apple Wearables. Please help me collect image assets, ensuring the sources are authoritative and the image quality is high. Requirements: 1. Output in English. 2. Organize into an illustrated report with interleaved images and text.

图 14: 展示 GLM-5V-Turbo 应用于图像素材收集的案例, 使用我们的官方网站 z.ai. 请注意, 每张所选图像的原始来源均已标注. 查询: 我正在准备一篇关于 Apple Wearables 的专题报告. 请帮我收集图像素材, 确保来源权威且图像质量高. 要求: 1. 英文输出. 2. 组织成图文交错的图解报告.

### A.4 Document-Based Writing
基于文档的写作

(a)
(b)
Figure 15: A case showing the ability of document-based writing. (a) A travel guide of Beijing (in Chinese, 103 pages in total). (b) The commentary introducing must-visit attractions in Beijing. Query: Read this travel guide, summarize ten must-visit attractions for foreigners and write the commentary.

(a)
(b)
图 15: 展示基于文档的写作能力. (a) 一本北京旅游指南(中文, 共 103 页). (b) 介绍北京必游景点的评论文章. 查询: 阅读这本旅游指南, 为外国游客总结十个必游景点并撰写评论.

### A.5 OCR and Document Parsing
OCR 与文档解析

(a)
(b)
Figure 16: A case showing the ability of multilingual OCR. (a) Original image. (b) Recognized words/phrases and corresponding language type. Prompt: Recognize each word in the image and identify the language.

(a)
(b)
图 16: 展示多语言 OCR 能力的案例. (a) 原始图像. (b) 识别的单词/短语及对应的语言类型. 提示: 识别图像中的每个单词并确定其语言.

(a)
(b)
Figure 17: A case showing the ability of accurate document transcription. (a) Original page from a physics textbook. (b) Transcribed result, including text, table and figures, in Markdown format.

(a)
(b)
图 17: 展示精确文档转录能力的案例. (a) 物理教科书原页. (b) 转录结果, 包括文本、表格和图表, 以 Markdown 格式呈现.

### A.6 Visual Search and Reasoning
视觉搜索与推理

Figure 18: A case showing the ability of utilizing the information from the image and multimodal searching tools to solve a complex question, using our official website z.ai. Query: There is a novel written by a British author whose title contains a location where the animal shown in the image is distributed. This author has also written other novels featuring animal names---among them, one whose animal is relatively small in size and not part of the Chinese zodiac, how many people appear on the poster displayed on the Douban page for the film adaptation of this work?

图 18: 展示利用图像信息和多模态搜索工具解决复杂问题能力的案例, 使用我们的官方网站 z.ai. 查询: 有一位英国作家写了一部小说, 其标题包含图像中动物分布的地点. 这位作家还写过其他以动物命名的小说---其中一本的动物体型相对较小且不属于中国十二生肖, 该作品电影改编版豆瓣页面海报上有多少人出现?

Figure 19: A case showing the ability of locating the input image and search local hotel prices on specific dates provided by the user, using our official website z.ai. Query: I would like to book a hotel room from 5.1-5.5 in this town, give me a list of 3 hotels in order of total price, with total price, reviews, experience suggestion.

图 19: 展示定位输入图像并在用户提供的特定日期搜索当地酒店价格能力的案例, 使用我们的官方网站 z.ai. 查询: 我想在这个小镇预订 5.1-5.5 的酒店房间, 请按总价排序给我列出 3 家酒店, 包含总价、评论和体验建议.

### A.7 Visual Recognition and Grounding
视觉识别与定位

Figure 20: A case showing the ability of video objects tracking. Prompt: Output the per-second object tracking results for all people playing basketball in the video. Use valid JSON format, where each key is the second number, and the value is a list of detected objects in that frame.

图 20: 展示视频目标跟踪能力的案例. 提示: 输出视频中所有打篮球人员的每秒目标跟踪结果. 使用有效的 JSON 格式, 其中每个键为秒数, 值为该帧中检测到物体的列表.

Figure 21: A case showing the ability of video objects tracking. Prompt: Based on the description of the objects appearing in the video "person committing crime", please track the objects corresponding to this description at every second (tracks per second) of the given video, and provide the bounding box and a globally consistent label for each object.

图 21: 展示视频目标跟踪能力的案例. 提示: 基于视频"person committing crime"中出现物体的描述, 请在给定视频的每一秒(每秒跟踪)跟踪与该描述对应的物体, 并为每个物体提供边界框(bounding box)和全局一致的标签.

(a)
(b)
Figure 22: A case demonstrating recognition capability based on grounding and search tools. (a) Person recognition. Prompt: Box out all people and their names. (b) Prompt: This is a screenshot of a GPU circuit board. Search this image, frame each component along with its name, and write a parameter comparison report comparing it with the H100.

(a)
(b)
图 22: 展示基于定位和搜索工具的识别能力案例. (a) 人物识别. 提示: 框出所有人物及其姓名. (b) 提示: 这是一张 GPU 电路板截图. 搜索这张图像, 框出每个组件及其名称, 并撰写一份与 H100 的参数对比报告.

(a)
(b)
Figure 23: A case demonstrating the ability to grounding educational scene elements. (a) Grounding of student handwritten answers. Prompt: Find the bounding box of each student's handwritten answer for each blank. (b) Grounding of writing errors. Prompt: Identify the misspelled words or incorrectly used words/phrases in it.

(a)
(b)
图 23: 展示教育场景元素定位能力的案例. (a) 学生手写答案定位. 提示: 找出每个学生在每个空白处手写答案的边界框. (b) 书写错误定位. 提示: 识别其中拼写错误或用词不当的单词/短语.

(a)
(b)
Figure 24: A case demonstrating 3D grounding capability, where our model outputs a 3D bounding box defined by nine values: the center point coordinates (x, y, z) and the sizes (x_size, y_size, z_size) --- all in meters --- along with the three rotation angles in radians. (a) Prompt: Please identify all objects belonging to the category furniture and output their 3D bounding boxes in JSON format. (b) Prompt: Please locate the first potted plant's 3D bounding box and output it in JSON format, where the 9 coordinate values correspond to the center point (x, y, z) and the sizes (x_size, y_size, z_size) across three dimensions all in meters, and the three rotation angles in radians.

(a)
(b)
图 24: 展示 3D 定位能力的案例, 我们的模型输出由九个值定义的 3D 边界框: 中心点坐标 (x, y, z) 和尺寸 (x_size, y_size, z_size)---均以米为单位---以及三个以弧度为单位的旋转角. (a) 提示: 请识别所有属于家具类别的物体并以 JSON 格式输出它们的 3D 边界框. (b) 提示: 请定位第一个盆栽植物的 3D 边界框并以 JSON 格式输出, 其中 9 个坐标值对应三个维度的中心点 (x, y, z) 和尺寸 (x_size, y_size, z_size), 均以米为单位, 以及三个以弧度为单位的旋转角.

### A.8 Spatial Reasoning
空间推理

Figure 25: A case showing the ability of spatial reasoning and object counting. Prompt: How many fingers are there in the image? Please mark the positions of all fingers in the image using the [[x,y]] format.

图 25: 展示空间推理和物体计数能力的案例. 提示: 图像中有多少根手指? 请使用 [[x,y]] 格式标记图像中所有手指的位置.
