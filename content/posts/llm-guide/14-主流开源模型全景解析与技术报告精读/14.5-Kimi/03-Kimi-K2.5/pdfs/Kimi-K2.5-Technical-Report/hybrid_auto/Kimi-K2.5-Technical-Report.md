# TECHNICAL REPORT OF KIMI K2.5

# Kimi Team

# ABSTRACT

We introduce Kimi K2.5, an open-source multimodal agentic model designed to advance general agentic intelligence. K2.5 emphasizes the joint optimization of text and vision so that two modalities enhance each other. This includes a series of techniques such as joint text-vision pre-training, zero-vision SFT, and joint text-vision reinforcement learning. Building on this multimodal foundation, K2.5 introduces Agent Swarm, a self-directed parallel agent orchestration framework that dynamically decomposes complex tasks into heterogeneous sub-problems and executes them concurrently. Extensive evaluations show that Kimi K2.5 achieves state-of-the-art results across various domains including coding, vision, reasoning, and agentic tasks. Agent Swarm also reduces latency by up to 4.5× over single-agent baselines. We release the post-trained Kimi K2.5 model checkpoint to facilitate future research and real-world applications of agentic intelligence.

![](images/ac5e91780a8e694cd33f5e0ae52607827e6e0ec18d6632f9907bd9d3799b5e54.jpg)

<details>
<summary>bar</summary>

| Category | K2.5 | GPT-5.2 (xhigh) | Claude Opus 4.5 | Gemini 3 Pro |
| :--- | :--- | :--- | :--- | :--- |
| Agents Humanity's Last Exam (Full) | 50.2 | 45.5 | 43.2 | 45.8 |
| Agents BrowseComp | 74.9 | 65.8 | 57.8 | 59.2 |
| Agents DeepSearchQA | 77.1 | 71.3 | 76.1 | 63.2 |
| Coding SWE-bench Verified | 76.8 | 80.0 | 80.9 | 76.2 |
| Coding SWE-bench Multilingual | 73.0 | 72.0 | 77.5 | 65.0 |
</details>

![](images/f6858f44ef47e4675f8ddd3a7c389f18c5c9530124b4bc098d3628045dc7103a.jpg)

<details>
<summary>bar</summary>

| Category | Method 1 | Method 2 | Method 3 |
| :--- | :--- | :--- | :--- |
| Image MMMU Pro | 78.5 | 79.5 | 74.0 |
| Image MathVision | 84.2 | 83.0 | 77.1 |
| Image OmniDocBench 1.5* | 88.8 | 85.7 | 87.7 |
| Video Video MMMU | 86.6 | 85.9 | 84.4 |
| Video LongVideoBench | 79.8 | 76.5 | 67.2 |
| Image MMMU Pro + Image MathVision + Image OmniDocBench 1.5* | 81.0 | 86.1 | 88.5 |
| Video Video MMMU + Video LongVideoBench | 87.6 | 84.4 | 77.7 |
</details>

# 1 Introduction

Large Language Models (LLMs) are rapidly evolving toward agentic intelligence. Recent advances, such as GPT-5.2 [41], Claude Opus 4.5 [6], Gemini 3 Pro [20], and Kimi K2-Thinking [1], demonstrate substantial progress in agentic capabilities, particularly in tool calling and reasoning. These models increasingly exhibit the ability to decompose complex problems into multi-step plans and to execute long sequences of interleaved reasoning and actions.

In this report, we introduce the training methods and evaluation results of Kimi K2.5. Concretely, we improve the training of K2.5 over previous models in the following two key aspects.

Joint Optimization of Text and Vision. A key insight from the practice of K2.5 is that joint optimization of text and vision enhances both modalities and avoids the conflict. Specifically, we devise a set of techniques for this purpose. During pre-training, in contrast to conventional approaches that add visual tokens to a text backbone at a late stage [8, 21], we find early vision fusion with lower ratios tends to yield better results given the fixed total vision-text tokens. Therefore, K2.5 mixes text and vision tokens with a constant ratio throughout the entire training process.

Architecturally, Kimi K2.5 employs MoonViT-3D, a native-resolution vision encoder incorporating the NaViT packing strategy [15], enabling variable-resolution image inputs. For video understanding, we introduce a lightweight 3D ViT compression mechanism: consecutive frames are grouped in fours, processed through the shared MoonViT encoder, and temporally averaged at the patch level. This design allows Kimi K2.5 to process videos up to 4 × longer within the same context window while maintaining complete weight sharing between image and video encoders.

During post-training, we introduce zero-vision SFT—text-only SFT alone activates visual reasoning and tool use. We find that adding human-designed visual trajectories at this stage hurts generalization. In contrast, text-only SFT performs better—likely because joint pretraining already establishes strong vision-text alignment, enabling capabilities to generalize naturally across modalities. We then apply joint RL on both text and vision tasks. Crucially, we find visual RL enhances textual performance rather than degrading it, with improvements on MMLU-Pro and GPQA-Diamond. This bidirectional enhancement—text bootstraps vision, vision refines text—represents superior crossmodal alignment in joint training.

Agent Swarm: Parallel Agent Orchestration. Most existing agentic models rely on sequential execution of tool calls. Even systems capable of hundreds of reasoning steps, such as Kimi K2-Thinking [1], suffer from linear scaling of inference time, leading to unacceptable latency and limiting task complexity. As agentic workloads grow in scope and heterogeneity—e.g., building a complex project that involves massive-scale research, design, and development—the sequential paradigm becomes increasingly inefficient.

To overcome the latency and scalability limits of sequential agent execution, Kimi K2.5 introduces Agent Swarm, a dynamic framework for parallel agent orchestration. We propose a Parallel-Agent Reinforcement Learning (PARL) paradigm that departs from traditional agentic RL [2]. In addition to optimizing tool execution via verifiable rewards, the model is equipped with interfaces for sub-agent creation and task delegation. During training, sub-agents are frozen and their execution trajectories are excluded from the optimization objective; only the orchestrator is updated via reinforcement learning. This decoupling circumvents two challenges of end-to-end co-optimization: credit assignment ambiguity and training instability. Agent Swarm enables complex tasks to be decomposed into heterogeneous subproblems executed concurrently by domain-specialized agents, transforming task complexity from linear scaling to parallel processing. In wide-search scenarios, Agent Swarm reduces inference latency by up to 4.5× while improving item-level F1 from 72.8% to 79.0% compared to single-agent baselines.

Kimi K2.5 represents a unified architecture for general-purpose agentic intelligence, integrating vision and language, thinking and instant modes, chats and agents. It achieves strong performance across a broad range of agentic and frontier benchmarks, including state-of-the-art results in visual-to-code generation (image/video-to-code) and realworld software engineering in our internal evaluations, while scaling both the diversity of specialized agents and the degree of parallelism. To accelerate community progress toward General Agentic Intelligence, we open-source our post-trained checkpoints of Kimi K2.5, enabling researchers and developers to explore, refine, and deploy scalable agentic intelligence.

# 2 Joint Optimization of Text and Vision

Kimi K2.5 is a native multimodal model built upon Kimi K2 through large-scale joint pre-training on approximately 15 trillion mixed visual and text tokens. Unlike vision-adapted models that compromise either linguistic or visual capabilities, our joint pre-training paradigm enhances both modalities simultaneously. This section describes the multimodal joint optimization methodology that extends Kimi K2 to Kimi K2.5.

# 2.1 Native Multimodal Pre-Training

A key design question for multimodal pre-training is: Given a fixed vision-text token budget, what is the optimal vision-text joint-training strategy. Conventional wisdom [8, 21] suggests introducing vision tokens predominantly in the later stages of LLM training at high ratios (e.g., 50% or higher) should accelerate multimodal capability acquisition, treating multimodal capability as a post-hoc add-on to linguistic competence.

Table 1: Performance comparison across different vision-text joint-training strategies. Early fusion with a lower vision ratio yields better results given a fixed total vision-text token budget. 

<table><tr><td></td><td>Vision Injection Timing</td><td>Vision-Text Ratio</td><td>Vision Knowledge</td><td>Vision Reasoning</td><td>OCR</td><td>Text Knowledge</td><td>Text Reasoning</td><td>Code</td></tr><tr><td>Early</td><td>0%</td><td>10%:90%</td><td>25.8</td><td>43.8</td><td>65.7</td><td>45.5</td><td>58.5</td><td>24.8</td></tr><tr><td>Mid</td><td>50%</td><td>20%:80%</td><td>25.0</td><td>40.7</td><td>64.1</td><td>43.9</td><td>58.6</td><td>24.0</td></tr><tr><td>Late</td><td>80%</td><td>50%:50%</td><td>24.2</td><td>39.0</td><td>61.5</td><td>43.1</td><td>57.8</td><td>24.0</td></tr></table>

However, our experiments (as shown in Table 1 Figure 9) reveal a different story. We conducted ablation studies varying the vision ratio and vision injection timing while keeping the total vision and text token budgets fixed. To strictly meet the targets for different ratios, we pre-trained the model with text-only tokens for a specifically calculated number of tokens before introducing vision data. Surprisingly, we found that the vision ratio has minimal impact on final multimodal performance. In fact, early fusion with a lower vision ratio yields better results given a fixed total vision-text token budget. This motivates our native multimodal pre-training strategy: rather than aggressive vision-heavy training concentrated at the end, we adopt a moderate vision ratio integrated early in the training process, allowing the model to naturally develop balanced multimodal representations while benefiting from extended cooptimization of both modalities.

# 2.2 Zero-Vision SFT

Pretrained VLMs do not naturally perform vision-based tool-calling, which poses a cold-start problem for multimodal RL. Conventional approaches address this issue through manually annotated or prompt-engineered chain-of-thought (CoT) data [8], but such methods are limited in diversity, often restricting visual reasoning to simple diagrams and primitive tool manipulations (crop, rotate, flip).

An observation is that high-quality text SFT data are relatively abundant and diverse. We propose a novel approach, zero-vision SFT, that uses only text SFT data to activate the visual, agentic capabilities during post-training. In this approach, all image manipulations are proxied through programmatic operations in IPython, effectively serving as a generalization of traditional vision tool-use. This "zero-vision" activation enables diverse reasoning behaviors, including pixel-level operations such as object size estimation via binarization and counting, and generalizes to visually grounded tasks such as object localization, counting, and OCR.

Figure 2 illustrates the RL training curves, where the starting points are obtained from zero-vision SFT. The results show that zero-vision SFT is sufficient for activating vision capabilities while ensuring generalization across modalities. This phenomenon is likely due to the joint pretraining of text and vision data as described in Section 2.1. Compared to zero-vision SFT, our preliminary experiments show that text-vision SFT yields much worse performance on visual, agentic tasks, possibly because of the lack of high-quality vision data.

# 2.3 Joint Multimodal Reinforcement Learning (RL)

In this section, we describe the methodology implemented in K2.5 that enables effective multimodal RL, from outcome-based visual RL to emergent cross-modal transfer that enhances textual performance.

Outcome-Based Visual RL Following the zero-vision SFT, the model requires further refinement to reliably incorporate visual inputs into reasoning. Text-initiated activation alone exhibits notable failure modes: visual inputs are sometimes ignored, and images may not be attended to when necessary. We employ outcome-based RL on tasks that explicitly require visual comprehension for correct solutions. We categorize these tasks into three domains:

• Visual grounding and counting: Accurate localization and enumeration of objects within images;   
• Chart and document understanding: Interpretation of structured visual information and text extraction;   
• Vision-critical STEM problems: Mathematical and scientific questions filtered to require visual inputs.

Outcome-based RL on these tasks improves both basic visual capabilities and more complex agentic behaviors. Extracting these trajectories for rejection-sampling fine-tuning (RFT) enables a self-improving data pipeline, allowing subsequent joint RL stages to leverage richer multimodal reasoning traces.

![](images/44ee2fc78e34883606c665f8a3e28fdb9be58de507609afc4bb5678d4cacae89.jpg)

<details>
<summary>line</summary>

| RL flops | Accuracy |
| -------- | -------- |
| 0        | 0.71     |
| 10       | 0.715    |
| 20       | 0.718    |
| 30       | 0.72     |
| 40       | 0.725    |
| 50       | 0.73     |
| 60       | 0.735    |
| 70       | 0.74     |
| 80       | 0.745    |
| 90       | 0.75     |
| 100      | 0.755    |
| 110      | 0.76     |
| 120      | 0.755    |
| 130      | 0.75     |
| 140      | 0.745    |
| 150      | 0.74     |
| 160      | 0.735    |
| 170      | 0.73     |
| 180      | 0.725    |
| 190      | 0.72     |
| 200      | 0.715    |
| 210      | 0.71     |
| 220      | 0.715    |
| 230      | 0.72     |
| 240      | 0.725    |
| 250      | 0.73     |
| 260      | 0.735    |
| 270      | 0.74     |
| 280      | 0.745    |
| 290      | 0.75     |
| 300      | 0.755    |
| 310      | 0.76     |
| 320      | 0.755    |
| 330      | 0.75     |
| 340      | 0.745    |
| 350      | 0.74     |
| 360      | 0.735    |
| 370      | 0.73     |
| 380      | 0.725    |
| 390      | 0.72     |
| 400      | 0.715    |
| 410      | 0.71     |
| 420      | 0.715    |
| 430      | 0.72     |
| 440      | 0.725    |
| 450      | 0.73     |
| 460      | 0.735    |
| 470      | 0.74     |
| 480      | 0.745    |
| 490      | 0.75     |
| 500      | 0.755    |
| 510      | 0.76     |
| 520      | 0.755    |
| 530      | 0.75     |
| 540      | 0.745    |
| 550      | 0.74     |
| 560      | 0.735    |
| 570      | 0.73     |
| 580      | 0.725    |
| 590      | 0.72     |
| 600      | 0.715    |
| 610      | 0.71     |
| 620      | 0.715    |
| 630      | 0.72     |
| 640      | 0.725    |
| 650      | 0.73     |
| 660      | 0.735    |
| 670      | 0.74     |
| 680      | 0.745    |
| 690      | 0.75     |
| 700      | 0.755    |
| 710      | 0.76     |
| 720      | 0.755    |
| 730      | 0.75     |
| 740      | 0.745    |
| 750      | 0.74     |
| 760      | 0.735    |
| 770      | 0.73     |
| 780      | 0.725    |
| 790      | 0.72     |
| 800      | 0.715    |
| 810      | 0.71     |
| 820      | 0.715    |
| 830      | 0.72     |
| 840      | 0.725    |
| 850      | 0.73     |
| 860      | 0.735    |
| 870      | 0.74     |
| 880      | 0.745    |
| 890      | 0.75     |
| 900      | 0.755    |
| 910      | 0.76     |
| 920      | 0.755    |
| 930      | 0.75     |
| 940      | 0.745    |
| 950      | 0.74     |
| 960      | 0.735    |
| 970      | 0.73     |
| 980      | 0.725    |
| 990      | 0.72     |
| 1000     | 0.715    |
</details>

![](images/e6323a07ef1befd38f2021a7c616dfcb5132bd29e0c2684412cc62cdd93e58a1.jpg)

<details>
<summary>line</summary>

| RL flops | Accuracy |
| -------- | -------- |
| 0        | 0.70     |
| 10       | 0.69     |
| 20       | 0.71     |
| 30       | 0.72     |
| 40       | 0.73     |
| 50       | 0.74     |
| 60       | 0.75     |
| 70       | 0.76     |
| 80       | 0.77     |
| 90       | 0.78     |
| 100      | 0.78     |
| 110      | 0.78     |
| 120      | 0.78     |
| 130      | 0.78     |
| 140      | 0.78     |
| 150      | 0.78     |
| 160      | 0.78     |
| 170      | 0.78     |
| 180      | 0.78     |
| 190      | 0.78     |
| 200      | 0.78     |
| 210      | 0.78     |
| 220      | 0.78     |
| 230      | 0.78     |
| 240      | 0.78     |
| 250      | 0.78     |
| 260      | 0.78     |
| 270      | 0.78     |
| 280      | 0.78     |
| 290      | 0.78     |
| 300      | 0.78     |
| 310      | 0.78     |
| 320      | 0.78     |
| 330      | 0.78     |
| 340      | 0.78     |
| 350      | 0.78     |
| 360      | 0.78     |
| 370      | 0.78     |
| 380      | 0.78     |
| 390      | 0.78     |
| 400      | 0.78     |
| 410      | 0.78     |
| 420      | 0.78     |
| 430      | 0.78     |
| 440      | 0.78     |
| 450      | 0.78     |
| 460      | 0.78     |
| 470      | 0.78     |
| 480      | 0.78     |
| 490      | 0.78     |
| 500      | 0.78     |
| 510      | 0.78     |
| 520      | 0.78     |
| 530      | 0.78     |
| 540      | 0.78     |
| 550      | 0.78     |
| 560      | 0.78     |
| 570      | 0.78     |
| 580      | 0.78     |
| 590      | 0.78     |
| 600      | 0.78     |
| 610      | 0.78     |
| 620      | 0.78     |
| 630      | 0.78     |
| 640      | 0.78     |
| 650      | 0.78     |
| 660      | 0.78     |
| 670      | 0.78     |
| 680      | 0.78     |
| 690      | 0.78     |
| 700      | 0.78     |
| 710      | 0.78     |
| 720      | 0.78     |
| 730      | 0.78     |
| 740      | 0.78     |
| 750      | 0.78     |
| 760      | 0.78     |
| 770      | 0.78     |
| 780      | 0.78     |
| 790      | 0.78     |
| 800      | 0.78     |
| 810      | 0.78     |
| 820      | 0.78     |
| 830      | 0.78     |
| 840      | 0.78     |
| 850      | 0.78     |
| 860      | 0.78     |
| 870      | 0.78     |
| 880      | 0.78     |
| 890      | 0.78     |
| 900      | 0.78     |
| 910      | 0.78     |
| 920      | 0.78     |
| 930      | 0.78     |
| 940      | 0.78     |
| 950      | 0.78     |
| 960      | 0.78     |
| 970      | 0.78     |
| 980      | 0.78     |
| 990      | 0.78     |
| 1000     | 0.78     |
</details>

![](images/01aeb5d98b63a0a566d9e394154346fd60681fc66392db0b947f759c0deeb256.jpg)

<details>
<summary>line</summary>

| RL flops | Accuracy |
| -------- | -------- |
| 0        | 0.64     |
| 10       | 0.65     |
| 20       | 0.66     |
| 30       | 0.67     |
| 40       | 0.68     |
| 50       | 0.69     |
| 60       | 0.70     |
| 70       | 0.71     |
| 80       | 0.72     |
| 90       | 0.73     |
| 100      | 0.74     |
| 110      | 0.75     |
| 120      | 0.76     |
| 130      | 0.77     |
| 140      | 0.78     |
| 150      | 0.77     |
| 160      | 0.76     |
| 170      | 0.75     |
| 180      | 0.74     |
| 190      | 0.73     |
| 200      | 0.72     |
| 210      | 0.71     |
| 220      | 0.70     |
| 230      | 0.69     |
| 240      | 0.68     |
| 250      | 0.67     |
| 260      | 0.66     |
| 270      | 0.65     |
| 280      | 0.64     |
| 290      | 0.63     |
| 300      | 0.62     |
</details>

![](images/ecad76b2cdcf11ed3c6fb142439f9742c273df99d7732439da37a50c069c0df2.jpg)

<details>
<summary>line</summary>

| RL flops | Accuracy |
| -------- | -------- |
| 0        | 0.79     |
| 10       | 0.81     |
| 20       | 0.83     |
| 30       | 0.85     |
| 40       | 0.87     |
| 50       | 0.88     |
| 60       | 0.89     |
| 70       | 0.90     |
| 80       | 0.90     |
| 90       | 0.90     |
| 100      | 0.90     |
| 110      | 0.90     |
| 120      | 0.90     |
| 130      | 0.90     |
| 140      | 0.90     |
| 150      | 0.90     |
| 160      | 0.90     |
| 170      | 0.90     |
| 180      | 0.90     |
| 190      | 0.90     |
| 200      | 0.90     |
| 210      | 0.90     |
| 220      | 0.90     |
| 230      | 0.90     |
| 240      | 0.90     |
| 250      | 0.90     |
| 260      | 0.90     |
| 270      | 0.90     |
| 280      | 0.90     |
| 290      | 0.90     |
| 300      | 0.90     |
| 310      | 0.90     |
| 320      | 0.90     |
| 330      | 0.90     |
| 340      | 0.90     |
| 350      | 0.90     |
| 360      | 0.90     |
| 370      | 0.90     |
| 380      | 0.90     |
| 390      | 0.90     |
| 400      | 0.90     |
| 410      | 0.90     |
| 420      | 0.90     |
| 430      | 0.90     |
| 440      | 0.90     |
| 450      | 0.90     |
| 460      | 0.90     |
| 470      | 0.90     |
| 480      | 0.90     |
| 490      | 0.90     |
| 500      | 0.90     |
| 510      | 0.90     |
| 520      | 0.90     |
| 530      | 0.90     |
| 540      | 0.90     |
| 550      | 0.90     |
| 560      | 0.90     |
| 570      | 0.90     |
| 580      | 0.90     |
| 590      | 0.90     |
| 600      | 0.90     |
| 610      | 0.90     |
| 620      | 0.90     |
| 630      | 0.90     |
| 640      | 0.90     |
| 650      | 0.90     |
| 660      | 0.90     |
| 670      | 0.90     |
| 680      | 0.90     |
| 690      | 0.90     |
| 700      | 0.90     |
| 710      | 0.90     |
| 720      | 0.90     |
| 730      | 0.90     |
| 740      | 0.90     |
| 750      | 0.90     |
| 760      | 0.90     |
| 770      | 0.90     |
| 780      | 0.90     |
| 790      | 0.90     |
| 800      | 0.90     |
| 810      | 0.90     |
| 820      | 0.90     |
| 830      | 0.90     |
| 840      | 0.90     |
| 850      | 0.90     |
| 860      | 0.90     |
| 870      | 0.90     |
| 880      | 0.90     |
| 890      | 0.90     |
| 900      | 0.90     |
| 910      | 0.90     |
| 920      | 0.90     |
| 930      | 0.90     |
| 940      | 0.90     |
| 950      | 0.90     |
| 960      | 0.90     |
| 970      | 0.90     |
| 980      | 0.90     |
| 990      | 0.90     |
| 1000     | 0.90     |
</details>

Figure 2: Vision RL training curves on vision benchmarks starting from minimal zero-vision SFT. By scaling vision RL FLOPs, the performance continues to improve, demonstrating that zero-vision activation paired with long-running RL is sufficient for acquiring robust visual capabilities.

Table 2: Cross-Modal Transfer: Vision RL Improves Textual Knowledge 

<table><tr><td>Benchmark</td><td>Before Vision-RL</td><td>After Vision-RL</td><td>Improvement</td></tr><tr><td>MMLU-Pro</td><td>84.7</td><td>86.4</td><td>+1.7</td></tr><tr><td>GPQA-Diamond</td><td>84.3</td><td>86.4</td><td>+2.1</td></tr><tr><td>LongBench v2</td><td>56.7</td><td>58.9</td><td>+2.2</td></tr></table>

Visual RL Improves Text Performance To investigate potential trade-offs between visual and textual performance, we evaluated text-only benchmarks before and after visual RL. Surprisingly, outcome-based visual RL produced mea surable improvements in textual tasks, including MMLU-Pro (84.7% → 86.4%), GPQA-Diamond (84.3% → 86.4%), and LongBench v2 (56.7% → 58.9%) (Table 2). Analysis suggests that visual RL enhances calibration in areas requiring structured information extraction, reducing uncertainty on queries that resemble visually grounded reasoning (e.g., counting, OCR). These findings indicate that visual RL can contribute to cross-modal generalization, improving textual reasoning without observable degradation of language capabilities.

Joint Multimodal RL Motivated by the finding that robust visual capabilities can emerge from zero-vision SFT paired with vision RL—which further enhances general text abilities—we adopt a joint multimodal RL paradigm during Kimi K2.5’s post-training. Departing from conventional modality-specific expert divisions, we organize RL domains not by input modality but by abilities—knowledge, reasoning, coding, agentic, etc. These domain experts jointly learn from both pure-text and multimodal queries, while the Generative Reward Model (GRM) similarly optimizes across heterogeneous traces without modality barriers. This pardaigm ensures that capability improvements acquired through either textual or visual inputs inherently generalize to enhance related abilities across the alternate modality, thereby maximizing cross-modal capability transfer.

# 3 Agent Swarm

The primary challenge of existing agent-based systems lies in their reliance on sequential execution of reasoning and tool-calling steps. While this structure may be effective for simpler, short-horizon tasks, it becomes inadequate as the complexity of the task increases and the accumulated context grows. As tasks evolve to contain broad information gathering and intricate, multi-branch reasoning, sequential systems often encounter significant bottlenecks [5, 6, 7].

![](images/fea953ad5bfff997ef4f8dc65183b01300a0c2b0a62e01bee2b0931e55310376.jpg)  
Figure 3: An agent swarm has a trainable orchestrator that dynamically creates specialized frozen subagents and decomposes complex tasks into parallelizable subtasks for efficient distributed execution.

The limited capacity of a single agent working through each step one by one can lead to the exhaustion of practical reasoning depth and tool-call budgets, ultimately hindering the system’s ability to handle more complex scenarios.

To address this, we introduce Agent Swarm and Parallel Agent Reinforcement Learning (PARL). Instead of executing a task as a reasoning chain or relying on pre-specified parallelization heuristics, K2.5 initiates an Agent Swarm through dynamic task decomposition, subagent instantiation, and parallel subtask scheduling. Importantly, parallelism is not presumed to be inherently advantageous; decisions regarding whether, when, and how to parallelize are explicitly learned through environmental feedback and RL-driven exploration. As shown in Figure 4, the progression of performance demonstrates this adaptive capability, with the cumulative reward increasing smoothly as the orchestrator optimizes its parallelization strategy throughout training.

Architecture and Learning Setup The PARL framework adopts a decoupled architecture comprising a trainable orchestrator and frozen subagents instantiated from fixed intermediate policy checkpoints. This design deliberately avoids end-to-end co-optimization to circumvent two fundamental challenges: credit assignment ambiguity and training instability. In this multi-agent setting, outcome-based rewards are inherently sparse and noisy; a correct final answer does not guarantee flawless subagent execution, just as a failure does not imply universal subagent error. By freezing the subagents and treating their outputs as environmental observations rather than differentiable decision points, we disentangle high-level coordination logic from low-level execution proficiency, leading to more robust convergence. To improve efficiency, we first train the orchestrator using small-size subagents before transitioning to larger models. Our RL framework also supports dynamically adjusting the inference instance ratios between subagents and the orchestrator, thereby maximizing the resource usage across the cluster.

PARL Reward Training a reliable parallel orchestrator is challenging due to the delayed, sparse, and non-stationary feedback inherent in independent subagent execution. To address this, we define the PARL reward as:

$$
r _ {\text { PARL }} (x, y) = \lambda_ {1} \cdot \underbrace {r _ {\text { parallel }}} _ {\text { instantiation   reward }} + \lambda_ {2} \cdot \underbrace {r _ {\text { finish }}} _ {\text { sub - agent   finish   rate }} + \underbrace {r _ {\text { perf }} (x , y)} _ {\text { task - level   outcome }}.
$$

The performance reward $r _ { \mathrm { p e r f } }$ evaluates the overall success and quality of the solution y for a given task x. This is augmented by two auxiliary rewards, each addressing a distinct challenge in learning parallel orchestration. The reward $r _ { \mathrm { p a r a l l e l } }$ is introduced to mitigate serial collapse—a local optimum where the orchestrator defaults to singleagent execution. By incentivizing subagent instantiation, this term encourages the exploration of concurrent scheduling spaces. The $r _ { \mathrm { f i n i s h } }$ reward focuses on the successful completion of assigned subtasks. It is used to prevent spurious parallelism, a reward-hacking behavior in which the orchestrator increases parallel metrics dramatically by spawning many subagents without meaningful task decomposition. By rewarding completed subtasks, $r _ { \mathrm { f i n i s h } }$ enforces feasibility and guides the policy toward valid and effective decompositions.

![](images/94795904f5983e36e9b3eb6dd41434ee64bc3a5b0265d739edc16f69e8e093c3.jpg)

<details>
<summary>line</summary>

| RL flops | Training Accuracy | Smoothed Curve |
| -------- | ----------------- | -------------- |
| 0        | 36.0%             | 36.0%          |
| 10       | 37.0%             | 37.0%          |
| 20       | 38.0%             | 38.0%          |
| 30       | 39.0%             | 39.0%          |
| 40       | 40.0%             | 40.0%          |
| 50       | 41.0%             | 41.0%          |
| 60       | 42.0%             | 42.0%          |
| 70       | 43.0%             | 43.0%          |
| 80       | 44.0%             | 44.0%          |
| 90       | 45.0%             | 45.0%          |
| 100      | 46.0%             | 46.0%          |
| 110      | 47.0%             | 47.0%          |
| 120      | 48.0%             | 48.0%          |
| 130      | 49.0%             | 49.0%          |
| 140      | 50.0%             | 50.0%          |
| 150      | 51.0%             | 51.0%          |
| 160      | 52.0%             | 52.0%          |
| 170      | 53.0%             | 53.0%          |
| 180      | 54.0%             | 54.0%          |
| 190      | 55.0%             | 55.0%          |
| 200      | 56.0%             | 56.0%          |
| 210      | 57.0%             | 57.0%          |
| 220      | 58.0%             | 58.0%          |
| 230      | 59.0%             | 59.0%          |
| 240      | 60.0%             | 60.0%          |
| 250      | 61.0%             | 61.0%          |
| 260      | 62.0%             | 62.0%          |
| 270      | 63.0%             | 63.0%          |
| 280      | 64.0%             | 64.0%          |
| 290      | 65.0%             | 65.0%          |
| 300      | 66.0%             | 66.0%          |
| 310      | 67.0%             | 67.0%          |
| 320      | 68.0%             | 68.0%          |
| 330      | 69.0%             | 69.0%          |
| 340      | 70.0%             | 70.0%          |
| 350      | 71.0%             | 71.0%          |
| 360      | 72.0%             | 72.0%          |
| 370      | 73.0%             | 73.0%          |
| 380      | 74.0%             | 74.0%          |
| 390      | 75.0%             | 75.0%          |
| 400      | 76.0%             | 76.0%          |
| 410      | 77.0%             | 77.0%          |
| 420      | 78.0%             | 78.0%          |
| 430      | 79.0%             | 79.0%          |
| 440      | 80.0%             | 80.0%          |
| 450      | 81.0%             | 81.0%          |
| 460      | 82.0%             | 82.0%          |
| 470      | 83.0%             | 83.0%          |
| 480      | 84.0%             | 84.0%          |
| 490      | 85.0%             | 85.0%          |
| 500      | 86.0%             | 86.0%          |
| 510      | 87.0%             | 87.0%          |
| 520      | 88.0%             | 88.0%          |
| 530      | 89.0%             | 89.0%          |
| 540      | 90.0%             | 90.0%          |
| 550      | 91.0%             | 91.0%          |
| 560      | 92.0%             | 92.0%          |
| 570      | 93.0%             | 93.0%          |
| 580      | 94.0%             | 94.0%          |
| 590      | 95.0%             | 95.0%          |
| 600      | 96.0%             | 96.0%          |
| 610      | 97.0%             | 97.0%          |
| 620      | 98.0%             | 98.0%          |
| 630      | 99.0%             | 99.0%          |
| 640      | 100.0%            | 100.0%         |
| 650      | 101.0%            | 101.0%         |
| 660      | 102.0%            | 102.0%         |
| 670      | 103.0%            | 103.0%         |
| 680      | 104.0%            | 104.0%         |
| 690      | 105.0%            | 105.0%         |
| 700      | 106.0%            | 106.0%         |
| 710      | 107.0%            | 107.0%         |
| 720      | 108.0%            | 108.0%         |
| 730      | 109.0%            | 109.0%         |
| 740      | 110.0%            | 110.0%         |
| 750      | 111.0%            | 111.0%         |
| 760      | 112.0%            | 112.0%         |
| 770      | 113.0%            | 113.0%         |
| 780      | 114.0%            | 114.0%         |
| 790      | 115.0%            | 115.0%         |
| 800      | 116.0%            | 116.0%         |
| 810      | 117.0%            | 117.0%         |
| 820      | 118.0%            | 118.0%         |
| 830      | 119.0%            | 119.0%         |
| 840      | 120.0%            | 120.0%         |
| 850      | 121.0%            | 121.0%         |
| 860      | 122.0%            | 122.0%         |
| 870      | 123.0%            | 123.0%         |
| 880      | 124.0%            | 124.0%         |
| 890      | 125.0%            | 125.0%         |
| 900      | 126.0%            | 126.0%         |
| 910      | 127.0%            | 127.0%         |
| 920      | 128.0%            | 128.0%         |
| 930      | 129.0%            | 129.0%         |
| 940      | 130.0%            | 130.0%         |
| 950      | 131.0%            | 131.0%         |
| 960      | 132.0%            | 132.0%         |
| 970      | 133.0%            | 133.0%         |
| 980      | 134.0%            | 134.0%         |
| 990      | 135.0%            | 135.0%         |
| 1000     | 136.0%            | 136.0%         |
</details>

![](images/07e61d74d970bf42b01ed13810bbd756b1fefba66893b07bc0ccc06883049fef.jpg)

<details>
<summary>line</summary>

| RL flops | Average Parallelism |
| -------- | ------------------- |
| 1        | 8.5                 |
| 2        | 8.7                 |
| 3        | 8.6                 |
| 4        | 8.8                 |
| 5        | 8.9                 |
| 6        | 8.7                 |
| 7        | 8.5                 |
| 8        | 8.3                 |
| 9        | 8.1                 |
| 10       | 7.9                 |
| 11       | 7.7                 |
| 12       | 7.5                 |
| 13       | 7.3                 |
| 14       | 7.1                 |
| 15       | 6.9                 |
| 16       | 7.1                 |
| 17       | 7.3                 |
| 18       | 7.5                 |
| 19       | 7.7                 |
| 20       | 7.9                 |
| 21       | 8.1                 |
| 22       | 8.3                 |
| 23       | 8.5                 |
| 24       | 8.7                 |
| 25       | 8.9                 |
| 26       | 9.1                 |
| 27       | 9.3                 |
| 28       | 9.5                 |
| 29       | 9.7                 |
| 30       | 9.9                 |
| 31       | 10.1                |
| 32       | 10.3                |
| 33       | 10.5                |
| 34       | 10.7                |
| 35       | 10.9                |
| 36       | 11.1                |
| 37       | 11.3                |
| 38       | 11.5                |
| 39       | 11.7                |
| 40       | 11.9                |
| 41       | 12.1                |
| 42       | 12.3                |
| 43       | 12.5                |
| 44       | 12.7                |
| 45       | 12.9                |
| 46       | 13.1                |
| 47       | 13.3                |
| 48       | 13.5                |
| 49       | 13.7                |
| 50       | 13.9                |
| 51       | 14.1                |
</details>

Figure 4: In our parallel-agent reinforcement learning environment, the training accuracy increases smoothly as training progresses. At the same time, the level of parallelism during training also gradually increases.

To ensure the final policy optimizes for the primary objective, the hyperparameters $\lambda _ { 1 }$ and $\lambda _ { 2 }$ are annealed to zero over the course of training.

Critical Steps as Resource Constraint To measure computational time cost in a parallel-agent setting, we define critical steps by analogy to the critical path in a computation graph. We model an episode as a sequence of execution stages indexed by $t = 1 , \ldots , T$ . In each stage, the main agent executes an action, which corresponds to either direct tool $S _ { \mathrm { m a i n } } ^ { ( t ) }$ $S _ { \mathrm { m a i n } } ^ { ( t ) } = 1 )$ $S _ { \mathrm { s u b } , i } ^ { ( t ) }$ denote the number of steps taken by the i-th subagent in that parallel group. The duration of stage t is governed by the longest-running subagent within that cohort. Consequently, the total critical steps for an episode are defined as

$$
\text { CriticalSteps } = \sum_ {t = 1} ^ {T} \left(S _ {\text { main }} ^ {(t)} + \max _ {i} S _ {\text { sub }, i} ^ {(t)}\right).
$$

By constraining training and evaluation using critical steps rather than total steps, the framework explicitly incentivizes effective parallelization. Excessive subtask creation that does not reduce the maximum execution time of parallel groups yields little benefit under this metric, while well-balanced task decomposition that shortens the longest parallel branch directly reduces critical steps. As a result, the orchestrator is encouraged to allocate work across subagents in a way that minimizes end-to-end latency, rather than merely maximizing concurrency or total work performed.

Prompt Construction for Parallel-agent Capability Induction To incentivize the orchestrator to leverage the advantages of parallelization, we construct a suite of synthetic prompts designed to stress the limits of sequential agentic execution. These prompts emphasize either wide search, requiring simultaneous exploration of many independent information sources, or deep search, requiring multiple reasoning branches with delayed aggregation. We additionally include tasks inspired by real-world workloads, such as long-context document analysis and large-scale file downloading. When executed sequentially, these tasks are difficult to complete within fixed reasoning-step and tool-call budgets. By construction, they encourage the orchestrator to allocate subtasks in parallel, enabling completion within fewer critical steps than would be feasible for a single sequential agent. Importantly, the prompts do not explicitly instruct the model to parallelize. Instead, they shape the task distribution such that parallel decomposition and scheduling strategies are naturally favored.

# 4 Method Overview

# 4.1 Foundation: Kimi K2 Base Model

The foundation of Kimi K2.5 is Kimi K2 [53], a trillion-parameter mixture-of-experts (MoE) transformer [59] model pre-trained on 15 trillion high-quality text tokens. Kimi K2 employs the token-efficient MuonClip optimizer [30, 34] with QK-Clip for training stability. The model comprises 1.04 trillion total parameters with 32 billion activated parameters, utilizing 384 experts with 8 activated per token (sparsity of 48). For detailed descriptions of MuonClip, architecture design, and training infrastructure, we refer to the Kimi K2 technical report [53].

Table 3: Overview of training stages: data composition, token volumes, sequence lengths, and trainable components. 

<table><tr><td>Stages</td><td>ViT Training</td><td>Joint Pre-training</td><td>Joint Long-context Mid-training</td></tr><tr><td>Data</td><td>Alt textSynthesis CaptionGrounding, OCR, Video</td><td>+Text, Knowledge InterleavingVideo, OS Screenshot</td><td>+High-quality Text &amp; MultimodalLong Text, Long VideoReasoning, Long-CoT</td></tr><tr><td>Sequence length</td><td>4096</td><td>4096</td><td>32768→262144</td></tr><tr><td>Tokens</td><td>1T</td><td>15T</td><td>500B→200B</td></tr><tr><td>Training</td><td>ViT</td><td>ViT &amp; LLM</td><td>ViT &amp; LLM</td></tr></table>

# 4.2 Model Architecture

The multimodal architecture of Kimi K2.5 consists of three components: a three-dimensional native-resolution vision encoder (MoonViT-3D), an MLP projector, and the Kimi K2 MoE language model, following the design principles established in Kimi-VL [54].

MoonViT-3D: Shared Embedding Space for Images and Videos In Kimi-VL, we employ MoonViT to natively process images at their original resolutions, eliminating the need for complex sub-image splitting and splicing operations. Initialized from SigLIP-SO-400M [77], MoonViT incorporates the patch packing strategy from NaViT [15], where single images are divided into patches, flattened, and sequentially concatenated into 1D sequences, thereby enabling efficient simultaneous training on images at varying resolutions.

To maximize the transfer of image understanding capabilities to video, we introduce MoonViT-3D with a unified architecture, fully shared parameters, and a consistent embedding space. By generalizing the “patch n’ pack“ philosophy to the temporal dimension, up to four consecutive frames are treated as a spatiotemporal volume: 2D patches from these frames are jointly flattened and packed into a single 1D sequence, allowing the identical attention mechanism to operate seamlessly across both space and time. While the extra temporal attention improves understanding on high-speed motions and visual effects, the sharing maximizes knowledge generalization from static images to dynamic videos, achieving strong video understanding performance (see in Tab. 4) without requiring specialized video modules or architectural bifurcation. Prior to the MLP projector, lightweight temporal pooling aggregates patches within each temporal chunk, yielding 4× temporal compression to significantly extend feasible video length. The result is a unified pipeline where knowledge and ability obtained from image pretraining transfers holistically to videos through one shared parameter space and feature representation.

# 4.3 Pre-training Pipeline

As illustrated in Table 3, Kimi K2.5’s pre-training builds upon the Kimi K2 language model checkpoint and processes approximately 15T tokens across three stages: first, standalone ViT training to establish a robust native-resolution visual encoder; second, joint pre-training to simultaneously enhance language and multimodal capabilities; and third, mid-training on high-quality data and long-context activation to refine capabilities and extend context windows.

ViT Training Stage The MoonViT-3D is continual pre-trained from SigLIP [77] on image-text and video-text pairs, where the text components consist of a variety of targets: image alt texts, synthetic captions of images and videos, grounding bboxes, and OCR texts. Unlike the implementation in Kimi-VL [54], this continual pre-training does not include a contrastive loss, but incorporates solely cross-entropy loss $L _ { c a p t i o n }$ for caption generation conditioned on input images and videos. We adopt a two-stage alignment strategy. In the first stage, we update the MoonViT-3D to align it with Moonlight-16B-A3B [34] via the caption loss, consuming about 1T tokens with very few training FLOPs. This stage allows MoonViT-3D to primarily understand high-resolution images and videos. A very short second stage follows, updating only the MLP projector to bridge the ViT with the 1T LLM for smoother joint pre-training.

Joint Training Stages The joint pre-training stage continues from a near-end Kimi K2 checkpoint over additional 15T vision-text tokens at 4K sequence length. The data recipe extends Kimi K2’s pre-training distribution by introducing unique tokens, adjusting data proportions with increased weight on coding-related content, and controlling maximum epochs per data source. The third stage performs long-context activation with integrated higher-quality midtraining data, sequentially extending context length via YaRN [44] interpolation. This yields significant generalization improvements in long-context text understanding and long video comprehension.

# 4.4 Post-Training

# 4.4.1 Supervised Fine-Tuning

Following the SFT pipeline established by Kimi K2 [53], we developed K2.5 by synthesizing high-quality candidate responses from K2, K2 Thinking and a suite of proprietary in-house expert models. Our data generation strategy employs specialized pipelines tailored to specific domains, integrating human annotation with advanced prompt engineering and multi-stage verification. This methodology produced a large-scale instruction-tuning dataset featuring diverse prompts and intricate reasoning trajectories, ultimately training the model to prioritize interactive reasoning and precise tool-calling for complex, real-world applications.

# 4.4.2 Reinforcement Learning

Reinforcement learning constitutes a crucial phase of our post-training. To facilitate joint optimization across text and vision modalities, as well as to enable PARL for agent swarm, we develop a Unified Agentic Reinforcement Learning Environment (Appendix D) and optimize the RL algorithms. Both text-vision joint RL and PARL are built upon the algorithms described in this section.

Policy Optimization For each problem x sampled from a dataset ${ \mathcal { D } } _ { : }$ , K responses $\left\{ y _ { 1 } , \dots , y _ { K } \right\}$ are generated using the previous policy $\pi _ { \mathrm { o l d } }$ . We optimize the model $\pi _ { \theta }$ with respect to the following objective:

$$
L _ {\mathrm{RL}} (\boldsymbol {\theta}) = \mathbb {E} _ {x \sim \mathscr {D}} \left[ \frac {1}{N} \sum_ {j = 1} ^ {K} \sum_ {i = 1} ^ {| y _ {j} |} \operatorname{Clip} \left(\frac {\pi_ {\boldsymbol {\theta}} \left(y _ {j} ^ {i} \mid x , y _ {j} ^ {0 : i}\right)}{\pi_ {\text {old}} \left(y _ {j} ^ {i} \mid x , y _ {j} ^ {0 : i}\right)}, \alpha , \beta\right) (r (x, y _ {j}) - \bar {r} (x)) - \tau \left(\log \frac {\pi_ {\boldsymbol {\theta}} \left(y _ {j} ^ {i} \mid x , y _ {j} ^ {0 : i}\right)}{\pi_ {\text {old}} \left(y _ {j} ^ {i} \mid x , y _ {j} ^ {0 : i}\right)}\right) ^ {2} \right]. \tag {1}
$$

Here $\alpha , \beta , \tau > 0$ are hyperparameters, $y _ { 0 : i } ^ { j }$ is the prefix up to the i-th token of the j-th response, $\begin{array} { r } { N = \sum _ { i = 1 } ^ { K } | y _ { i } | } \end{array}$ is the total number of generated tokens in a batch, $\begin{array} { r } { \bar { r } ( x ) = \frac { 1 } { K } \sum _ { j = 1 } ^ { K } r ( x , y _ { j } ) } \end{array}$ is the mean reward of all generated responses.

This loss function departs from the policy optimization algorithm used in K1.5 [31] by introducing a token-level clipping mechanism designed to mitigate the off-policy divergence amplified by discrepancies between training and inference frameworks. The mechanism functions as a simple gradient masking scheme: policy gradients are computed normally for tokens with log-ratios within the interval [α, β ], while gradients for tokens falling outside this range are zeroed out. Notably, a key distinction from standard PPO clipping [50] is that our method relies strictly on the log-ratio to explicitly bound off-policy drift, regardless of the sign of the advantages. This approach aligns with recent strategies proposed to stabilize large-scale RL training [74, 78]. Empirically, we find this mechanism essential for maintaining training stability in complex domains requiring long-horizon, multi-step tool-use reasoning. We employ the MuonClip optimizer [30, 34] to minimize this objective.

Reward Function We apply a rule-based outcome reward for tasks with verifiable solutions, such as reasoning and agentic tasks. To optimize resource consumption, we also incorporate a budget-control reward aimed at enhancing token efficiency. For general-purpose tasks, we employ Generative Reward Models (GRMs) that provide granular evaluations aligned with Kimi’s internal value criteria. In addition, for visual tasks, we design task-specific reward functions to provide fine-grained supervision. For visual grounding and point localization tasks, we employ an F1- based reward with soft matching: grounding tasks derive soft matches from Intersection over Union (IoU) and point tasks derive soft matches from Gaussian-weighted distances under optimal matching. For polygon segmentation tasks, we rasterize the predicted polygon into a binary mask and compute the segmentation IoU against the ground-truth mask to assign the reward. For OCR tasks, we adopt normalized edit distance to quantify character-level alignment between predictions and ground-truth. For counting tasks, rewards are assigned based on the absolute difference between predictions and ground-truth. Furthermore, we synthesize complex visual puzzle problems and utilize an LLM verifier (Kimi K2) to provide feedback.

Generative Reward Models Kimi K2 leverages a self-critique rubric reward for open-ended generation [53], and K2.5 extends this line of work by systematically deploying Generative Reward Models (GRMs) across a broad range of agentic behaviors and multimodal trajectories. Rather than limiting reward modeling to conversational outputs, we apply GRMs on top of verified reward signals in diverse environments, including chat assistants, coding agents, search agents, and artifact-generating agents. Notably, GRMs function not as binary adjudicators, but as fine-grained evaluators aligned with Kimi’s values that are critical to user experiences, such as helpfulness, response readiness, contextual relevance, appropriate level of detail, aesthetic quality of generated artifacts, and strict instruction following. This design allows the reward signal to capture nuanced preference gradients that are difficult to encode with purely rule-based or task-specific verifiers. To mitigate reward hacking and overfitting to a single preference signal, we employ multiple alternative GRM rubrics tailored to different task contexts.

Token Efficient Reinforcement Learning Token efficiency is central to LLMs with test-time scaling. While testtime scaling inherently trades computation for reasoning quality, practical gains require algorithmic innovations that actively navigate this trade-off. Our previous findings indicate that imposing a problem-dependent budget effectively constrains inference-time compute, incentivizing the model to generate more concise chain of thought reasoning patterns without unnecessary token expansion [31, 53]. However, we also observe a length-overfitting phenomenon: models trained under rigid budget constraints often fail to generalize to higher compute scales. Consequently, they cannot effectively leverage additional inference-time tokens to solve complex problems, instead defaulting to truncated reasoning patterns.

To this end, we propose Toggle, a training heuristic that alternates between inference-time scaling and budgetconstrained optimization: for learning iteration t, the reward function is defined by

$$
\tilde {r} (x, y) = \left\{ \begin{array}{l l} r (x, y) \cdot \mathbb {I} \left\{\frac {1}{K} \sum_ {i = 1} ^ {K} r (x, y _ {i}) <   \lambda \text {   or   } | y _ {i} | \leq \text { budget } (x) \right\} & \text { if   } \lfloor t / m \rfloor \pmod {2} = 0 \text {   (Phase0) } \\ r (x, y) & \text { if   } \lfloor t / m \rfloor \pmod {2} = 1 \text {   (Phase1) } \end{array} \right..
$$

where λ and m are hyper-parameters of the algorithm and K is the number of rollouts per problem. Specifically, the algorithm alternates between two optimization phases every m iterations:

• Phase0 (budget limited phase): The model is trained to solve the problem within a task-dependent token budget. To prevent a premature sacrifice of quality for efficiency, this constraint is conditionally applied: it is only enforced when the model’s mean accuracy for a given problem exceeds the threshold λ .   
• Phase1 (standard scaling phase): The model generates responses up to the maximum token limit, encouraging the model to leverage computation for better inference-time scaling.

The problem-dependent budget is estimated from the ρ-th percentile of token lengths among the subset of correct responses:

$$
\operatorname{budget} (x) = \text { Percentile } \left(\left\{\left| y _ {j} \right| \mid r \left(x, y _ {i}\right) = 1, i = 1, \dots , K \right\}, \rho\right). \tag {2}
$$

This budget is estimated once at the beginning of training and remains fixed thereafter. Notably, Toggle functions as a stochastic alternating optimization for a bi-objective problem. It is specifically designed to reconcile reasoning capabilities with computational efficiency.

We evaluate the effectiveness of Toggle on K2 Thinking [1]. As shown in Figure 5, we observe a consistent reduction in output length across nearly all benchmarks. On average, Toggle decreases output tokens by 25∼30% with a negligible impact on performance. We also observe that redundant patterns in the chain-of-thought, such as repeated verifications and mechanical calculations, decrease substantially. Furthermore, Toggle shows strong domain generalization. For example, when trained exclusively on mathematics and programming tasks, the model still achieves consistent token reductions on GPQA and MMLU-Pro with only marginal degradation in performance (Figure 5).

# 4.5 Training Infrastructure

Kimi K2.5 inherits the training infrastructure from Kimi K2 [53] with minimal modifications. For multimodal training, we propose Decoupled Encoder Process, where the vision encoder is incorporated into the existing pipeline with negligible additional overhead.

# 4.5.1 Decoupled Encoder Process (DEP)

In a typical multimodal training paradigm utilizing Pipeline Parallelism (PP), the vision encoder and text embedding are co-located in the first stage of the pipeline (Stage-0). However, due to the inherent variations of multimodal input size (e.g., image counts and resolutions), Stage-0 suffers from drastic fluctuations in both computational load and memory usage. This forces existing solutions to adopt custom PP configurations for vision-language models — for instance, [54] manually adjusts the number of text decoder layers in Stage-0 to reserve memory. While this compromise alleviates memory pressure, it does not fundamentally resolve the load imbalance caused by multimodal input sizes. More critically, it precludes the direct reuse of parallel strategies that have been highly optimized for text-only training.

![](images/48de6f4e44dd176b7b27e12005cf9fb6cd0929fc10444e40840276db4caaa700.jpg)

<details>
<summary>radar</summary>

| Benchmark        | Before Toggle | After Toggle | Improvement (%) | Degradation (%) |
| ---------------- | ------------- | ------------ | --------------- | --------------- |
| HMMT25_Feb       | 80.6          | 80.9         | 80.6            | 3.0             |
| GPQADIAMOND      | 80.9          | 80.9         | 80.9            | 3.0             |
| AIME2025         | 90.1          | 90.1         | 90.1            | 3.0             |
| Overall          | 80.9          | 80.9         | 80.9            | 3.0             |
| LiveCodeBenchV6  | 80.9          | 80.9         | 80.9            | 3.0             |
| MMLUPro          | 80.9          | 80.9         | 80.9            | 3.0             |
| HMMT25_Nov       | 80.9          | 80.9         | 80.9            | 3.0             |
| Overall          | 80.9          | 80.9         | 80.9            | 3.0             |
</details>

Figure 5: Comparison of model performance and token usage for Kimi K2 Thinking following token-efficient RL.

Leveraging the unique topological position of the visual encoder within the computation graph — specifically, its role as the start of the forward pass and the end of the backward pass — our training uses Decoupled Encoder Process (DEP), which is composed of three stages in each training step:

• Balanced Vision Forward: We first execute the forward pass for all visual data in the global batch. Because the vision encoder is small, we replicate it on all GPUs regardless of other parallelism strategies. During this phase, the forward computational workload is evenly distributed across all GPUs based on load metrics (e.g., image or patch counts). This eliminates load-imbalance caused by PP and visual token counts. To minimize peak memory usage, we discard all intermediate activations, retaining only the final output activations. The results are gathered back to PP Stage-0;   
• Backbone Training: This phase performs the forward and backward passes for the main transformer backbone. By discarding intermediate activations in the preceding phase, we can now fully leverage any efficient parallel strategies validated in pure text training. After this phase, gradients are accumulated at the visual encoder output;   
• Vision Recomputation & Backward: We re-compute the vision encoder forward pass, followed by a backward pass to compute gradients for parameters in the vision encoder;

DEP not only achieves load-balance, but also decouples the optimization strategy of the vision encoder and the main backbone. K2.5 seamlessly inherits the parallel strategy of K2, achieving a multimodal training efficiency of 90% relative to text-only training. We note a concurrent work, LongCat-Flash-Omni [55], shares a similar design philosophy.

# 5 Evaluations

# 5.1 Main Results

# 5.1.1 Evaluation Settings

Benchmarks We evaluate Kimi K2.5 on a comprehensive benchmark suite spanning text-based reasoning, competitive and agentic coding, multimodal understanding (image and video), autonomous agentic execution, and computer use. Our benchmark taxonomy is organized along the following capability axes:

• Reasoning & General: Humanity’s Last Exam (HLE) [46], AIME 2025 [4], HMMT 2025 (Feb) [58], IMO AnswerBench [37], GPQA-Diamond [47], MMLU-Pro [64], SimpleQA Verified [22], AdvancedIF [23], and LongBench v2 [9].

• Coding: SWE-Bench Verified [29], SWE-Bench Pro (public) [16], SWE-Bench Multilingual [29], Terminal Bench 2.0 [39], PaperBench (CodeDev) [52], CyberGym [66], SciCode [56], OJBench (cpp) [65], and Live-CodeBench (v6) [28].   
• Agentic Capabilities: BrowseComp [68], WideSearch [69],DeepSearchQA [60], FinSearchComp (T2&T3) [26], Seal-0 [45], GDPVal [43].   
• Image Understanding: (math & reasoning) MMMU-Pro [75], MMMU (val) [76], CharXiv (RQ) [67], Math-Vision [61] and MathVista (mini) [36]; (vision knowledge) SimpleVQA [13] and WorldVQA 2; (perception) ZeroBench (w/ and w/o tools) [48], BabyVision [12], BLINK [18] and MMVP [57]; (OCR & document) OCR-Bench [35], OmniDocBench 1.5 [42] and InfoVQA [38].   
• Video Understanding: VideoMMMU [25], MMVU [79], MotionBench [24], Video-MME [17] (with subtitles), LongVideoBench [70], and LVBench [62].   
• Computer Use: OSWorld-Verified [72, 73], and WebArena [80].

Baselines We benchmark against state-of-the-art proprietary and open-source models. For proprietary models, we compare against Claude Opus 4.5 (with extended thinking) [6], GPT-5.2 (with xhigh reasoning effort) [41], and Gemini 3 Pro (with high reasoning-level) [20]. For open-source models, we include DeepSeek-V3.2 (with thinking mode enabled) [14] for text benchmarks, while vision benchmarks report Qwen3-VL-235B-A22B-Thinking [8] instead.

Evaluation Configurations Unless otherwise specified, all Kimi K2.5 evaluations use temperature = 1.0, top-p = 0.95, and a context length of 256k tokens. Benchmarks without publicly available scores were re-evaluated under identical conditions and marked with an asterisk (\*). The full evaluation settings can be found in appendix E.

# 5.1.2 Evaluation Results

Comprehensive results comparing Kimi K2.5 against proprietary and open-source baselines are presented in Table 4. We highlight key observations across core capability domains:

Reasoning and General Kimi K2.5 achieves competitive performance with top-tier proprietary models on rigorous STEM benchmarks. On Math tasks, AIME 2025, K2.5 scores 96.1%, approaching GPT-5.2’s perfect score while outperforming Claude Opus 4.5 (92.8%) and Gemini 3 Pro (95.0%). This high-level performance extends to the HMMT 2025 (95.4%) and IMO-AnswerBench (81.8%), demonstrating K2.5’s superior reasoning depth. Kimi K2.5 also exhibits remarkable knowledge and scientific reasoning capabilities, scoring 36.9% on SimpleQA Verified, 87.1% on MMLU-Pro and 87.6% on GPQA. Notably, on HLE without the use of tools, K2.5 achieves an HLE-Full score of 30.1%, with component-wise scores of 31.5% on text subset and 21.3% on image subset. When tool-use is enabled, K2.5’s HLE-Full score rises to 50.2%, with 51.8% (text) and 39.8% (image), significantly outperforming Gemini 3 Pro (45.8%) and GPT-5.2 (45.5%). In addition to reasoning and knowledge, K2.5 shows strong instruction-following performance (75.6% on AdvancedIF) and competitive long-context abilities, achieving 61.0% on LongBench v2 compared to both proprietary and open-source models.

Complex Coding and Software Engineering Kimi K2.5 exhibits strong software engineering capabilities, especially on realistic coding and maintenance tasks. It achieves 76.8% on SWE-Bench Verified and 73.0% on SWE-Bench Multilingual, outperforming Gemini 3 Pro while remaining competitive with Claude Opus 4.5 and GPT-5.2. On LiveCodeBench v6, Kimi K2.5 reaches 85.0%, surpassing DeepSeek-V3.2 (83.3%) and Claude Opus 4.5 (82.2%), highlighting its robustness on live, continuously updated coding challenges. On TerminalBench 2.0, PaperBench, and SciCode, it scores 50.8%, 63.5%, and 48.7% respectively, demonstrating stable competition-level performance in automated software engineering and problem solving across diverse domains. In addition, K2.5 attains a score of 41.3 on CyberGym, on the task of finding previously discovered vulnerabilities in real open-source software projects given only a high-level description of the weakness, further underscoring its effectiveness in security-oriented software analysis.

Agentic Capabilities Kimi K2.5 establishes new state-of-the-art performance on complex agentic search and browsing tasks. On BrowseComp, K2.5 achieves 60.6% without context management techniques, 74.9% with Discard-all context management [14] — substantially outperforming GPT-5.2’s reported 65.8%, Claude Opus 4.5 (37.0%) and Gemini 3 Pro (37.8%). Similarly, WideSearch reaches 72.7% on item-f1. On DeepSearchQA (77.1%), FinSearch-CompT2&T3 (67.8%) and Seal-0 (57.4%), K2.5 leads all evaluated models, demonstrating superior capacity for agentic deep research, information synthesis, and multi-step tool orchestration.

Table 4: Performance comparison of Kimi K2.5 against open-source and proprietary models. Bold denotes the global SOTA; Data points marked with \* are taken from our internal evaluations. † refers to their scores of text-only subset. 

<table><tr><td rowspan="2">Benchmark</td><td rowspan="2">Kimi K2.5</td><td colspan="3">Proprietary</td><td colspan="2">Open Source</td></tr><tr><td>Claude Opus 4.5</td><td>GPT-5.2 (xhigh)</td><td>Gemini 3 Pro</td><td>DeepSeek-V3.2</td><td>Qwen3-VL-235B-A22B</td></tr><tr><td colspan="7">Reasoning &amp; General</td></tr><tr><td>HLE-Full</td><td>30.1</td><td>30.8</td><td>34.5</td><td>37.5</td><td>25.1†</td><td>-</td></tr><tr><td>HLE-Full w/ tools</td><td>50.2</td><td>43.2</td><td>45.5</td><td>45.8</td><td>40.8†</td><td>-</td></tr><tr><td>AIME 2025</td><td>96.1</td><td>92.8</td><td>100</td><td>95.0</td><td>93.1</td><td>-</td></tr><tr><td>HMMT 2025 (Feb)</td><td>95.4</td><td>92.9*</td><td>99.4</td><td>97.3*</td><td>92.5</td><td>-</td></tr><tr><td>IMO-AnswerBench</td><td>81.8</td><td>78.5*</td><td>86.3</td><td>83.1*</td><td>78.3</td><td>-</td></tr><tr><td>GPQA-Diamond</td><td>87.6</td><td>87.0</td><td>92.4</td><td>91.9</td><td>82.4</td><td>-</td></tr><tr><td>MMLU-Pro</td><td>87.1</td><td>89.3*</td><td>86.7*</td><td>90.1</td><td>85.0</td><td>-</td></tr><tr><td>SimpleQA Verified</td><td>36.9</td><td>44.1</td><td>38.9</td><td>72.1</td><td>27.5</td><td>-</td></tr><tr><td>AdvancedIF</td><td>75.6</td><td>63.1</td><td>81.1</td><td>74.7</td><td>58.8</td><td>-</td></tr><tr><td>LongBench v2</td><td>61.0</td><td>64.4*</td><td>54.5*</td><td>68.2*</td><td>59.8*</td><td>-</td></tr><tr><td colspan="7">Coding</td></tr><tr><td>SWE-Bench Verified</td><td>76.8</td><td>80.9</td><td>80.0</td><td>76.2</td><td>73.1</td><td>-</td></tr><tr><td>SWE-Bench Pro (public)</td><td>50.7</td><td>55.4*</td><td>55.6</td><td>-</td><td>-</td><td>-</td></tr><tr><td>SWE-Bench Multilingual</td><td>73.0</td><td>77.5</td><td>72.0</td><td>65.0</td><td>70.2</td><td>-</td></tr><tr><td>Terminal Bench 2.0</td><td>50.8</td><td>59.3</td><td>54.0</td><td>54.2</td><td>46.4</td><td>-</td></tr><tr><td>PaperBench (CodeDev)</td><td>63.5</td><td>72.9*</td><td>63.7*</td><td>-</td><td>47.1</td><td>-</td></tr><tr><td>CyberGym</td><td>41.3</td><td>50.6</td><td>-</td><td>39.9*</td><td>17.3*</td><td>-</td></tr><tr><td>SciCode</td><td>48.7</td><td>49.5</td><td>52.1</td><td>56.1</td><td>38.9</td><td>-</td></tr><tr><td>OJBench (cpp)</td><td>57.4</td><td>54.6*</td><td>-</td><td>68.5*</td><td>54.7*</td><td>-</td></tr><tr><td>LiveCodeBench (v6)</td><td>85.0</td><td>82.2*</td><td>-</td><td>87.4*</td><td>83.3</td><td>-</td></tr><tr><td colspan="7">Agentic</td></tr><tr><td>BrowseComp</td><td>60.6</td><td>37.0</td><td>65.8</td><td>37.8</td><td>51.4</td><td>-</td></tr><tr><td>BrowseComp (w/ ctx manage)</td><td>74.9</td><td>57.8</td><td>-</td><td>59.2</td><td>67.6</td><td>-</td></tr><tr><td>BrowseComp (Agent Swarm)</td><td>78.4</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td></tr><tr><td>WideSearch</td><td>72.7</td><td>76.2*</td><td>-</td><td>57.0</td><td>32.5*</td><td>-</td></tr><tr><td>WideSearch (Agent Swarm)</td><td>79.0</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td></tr><tr><td>DeepSearchQA</td><td>77.1</td><td>76.1*</td><td>71.3*</td><td>63.2*</td><td>60.9*</td><td>-</td></tr><tr><td>FinSearchCompT2&amp;T3</td><td>67.8</td><td>66.2*</td><td>-</td><td>49.9</td><td>59.1*</td><td>-</td></tr><tr><td>Seal-0</td><td>57.4</td><td>47.7*</td><td>45.0</td><td>45.5*</td><td>49.5*</td><td>-</td></tr><tr><td>GDPVal-AA</td><td>41.0</td><td>45.0</td><td>48.0</td><td>35.0</td><td>34.0</td><td>-</td></tr><tr><td colspan="7">Image</td></tr><tr><td>MMMU-Pro</td><td>78.5</td><td>74.0</td><td>79.5*</td><td>81.0</td><td>-</td><td>69.3</td></tr><tr><td>MMMU (val)</td><td>84.3</td><td>80.7</td><td>86.7*</td><td>87.5*</td><td>-</td><td>80.6</td></tr><tr><td>CharXiv (RQ)</td><td>77.5</td><td>67.2*</td><td>82.1</td><td>81.4</td><td>-</td><td>66.1</td></tr><tr><td>MathVision</td><td>84.2</td><td>77.1*</td><td>83.0</td><td>86.1*</td><td>-</td><td>74.6</td></tr><tr><td>MathVista (mini)</td><td>90.1</td><td>80.2*</td><td>82.8*</td><td>89.8*</td><td>-</td><td>85.8</td></tr><tr><td>SimpleVQA</td><td>71.2</td><td>69.7*</td><td>55.8*</td><td>69.7*</td><td>-</td><td>56.8*</td></tr><tr><td>WorldVQA</td><td>46.3</td><td>36.8</td><td>28.0</td><td>47.4</td><td>-</td><td>23.5</td></tr><tr><td>ZeroBench</td><td>9</td><td>3*</td><td>9*</td><td>8*</td><td>-</td><td>4*</td></tr><tr><td>ZeroBench w/ tools</td><td>11</td><td>9*</td><td>7*</td><td>12*</td><td>-</td><td>3*</td></tr><tr><td>BabyVision</td><td>36.5</td><td>14.2</td><td>34.4</td><td>49.7</td><td>-</td><td>22.2</td></tr><tr><td>BLINK</td><td>78.9</td><td>68.8*</td><td>-</td><td>78.7*</td><td>-</td><td>68.9</td></tr><tr><td>MMVP</td><td>87.0</td><td>80.0*</td><td>83.0*</td><td>90.0*</td><td>-</td><td>84.3</td></tr><tr><td>OmniDocBench 1.5</td><td>88.8</td><td>87.7*</td><td>85.7</td><td>88.5</td><td>-</td><td>82.0*</td></tr><tr><td>OCRBench</td><td>92.3</td><td>86.5*</td><td>80.7*</td><td>90.3*</td><td>-</td><td>87.5</td></tr><tr><td>InfoVQA (test)</td><td>92.6</td><td>76.9*</td><td>84*</td><td>57.2*</td><td>-</td><td>89.5</td></tr><tr><td colspan="7">Video</td></tr><tr><td>VideoMMMU</td><td>86.6</td><td>84.4*</td><td>85.9</td><td>87.6</td><td>-</td><td>80.0</td></tr><tr><td>MMVU</td><td>80.4</td><td>77.3*</td><td>80.8*</td><td>77.5*</td><td>-</td><td>71.1</td></tr><tr><td>MotionBench</td><td>70.4</td><td>60.3*</td><td>64.8*</td><td>70.3</td><td>-</td><td>-</td></tr><tr><td>Video-MME</td><td>87.4</td><td>77.6*</td><td>86.0*</td><td>88.4*</td><td>-</td><td>79.0</td></tr><tr><td>LongVideoBench</td><td>79.8</td><td>67.2*</td><td>76.5*</td><td>77.7*</td><td>-</td><td>65.6*</td></tr><tr><td>LVBench</td><td>75.9</td><td>57.3</td><td>-</td><td>73.5*</td><td>-</td><td>63.6</td></tr><tr><td colspan="7">Computer Use</td></tr><tr><td>OSWorld-Verified</td><td>63.3</td><td>66.3</td><td>8.6*</td><td>20.7*</td><td>-</td><td>38.1</td></tr><tr><td>WebArena</td><td>58.9</td><td>63.4*</td><td>-</td><td>-</td><td>-</td><td>26.4*</td></tr></table>

Table 5: Performance and token efficiency of some reasoning models. Average output token counts (in thousands) are shown in parentheses. 

<table><tr><td>Benchmark</td><td>Kimi K2.5</td><td>Kimi K2 Thinking</td><td>Gemini-3.0 Pro</td><td>DeepSeek-V3.2 Thinking</td></tr><tr><td>AIME 2025</td><td>96.1 (25k)</td><td>94.5 (30k)</td><td>95.0 (15k)</td><td>93.1 (16k)</td></tr><tr><td>HMMT Feb 2025</td><td>95.4 (27k)</td><td>89.4 (35k)</td><td>97.3 (16k)</td><td>92.5 (19k)</td></tr><tr><td>HMMT Nov 2025</td><td>91.1 (24k)</td><td>89.2 (32k)</td><td>94.5 (15k)</td><td>90.2 (18k)</td></tr><tr><td>IMO-AnswerBench</td><td>81.8 (36k)</td><td>78.6 (37k)</td><td>83.1 (18k)</td><td>78.3 (27k)</td></tr><tr><td>LiveCodeBench</td><td>85.0 (18k)</td><td>82.6 (25k)</td><td>87.4 (13k)</td><td>83.3 (16k)</td></tr><tr><td>GPQA Diamond</td><td>87.6 (14k)</td><td>84.5 (13k)</td><td>91.9 (8k)</td><td>82.4 (7k)</td></tr><tr><td>HLE-Text</td><td>31.5 (24k)</td><td>23.9 (29k)</td><td>38.4 (13k)</td><td>25.1 (21k)</td></tr></table>

Vision Reasoning, Knowledge and Perception Kimi K2.5 demonstrates strong visual reasoning and world knowledge capabilities. It scores 78.5% on MMMU-Pro, spanning multi-disciplinary multimodal tasks. For world knowledge question answering, K2.5 achieves 71.2% on SimpleVQA and 46.3% on WorldVQA. For visual reasoning, it achieves 84.2% on MathVision, 90.1% on MathVista (mini), and 36.5% on BabyVision. For OCR and document understanding, K2.5 delivers outstanding results with 77.5% on CharXiv (RQ), 92.3% on OCRBench, 88.8% on OmniDocBench 1.5, and 92.6% on InfoVQA (test). On the challenging ZeroBench, Kimi K2.5 achieves 9% and 11% with tool augmentation, substantially ahead of competing models. On basic visual perception benchmarks BLINK (78.9%) and MMVP (87.0%), we also observe competitive performance of Kimi K2.5, demonstrating its robust real-world visual perceptions.

Video Understanding Kimi K2.5 achieves state-of-the-art performance across diverse video understanding tasks. It attains 86.6% on VideoMMMU and 80.4% on MMVU, rivaling frontier leaderships. With the context-compression and dense temporal understanding abilities of MoonViT-3D, Kimi K2.5 also establishes new global SOTA records in long-video comprehension with 75.9% on LVBench and 79.8% on LongVideoBench by feeding over 2,000 frames, while demonstrating robust dense-motion understanding at 70.4% on the highly-dimensional MotionBench.

Computer-Use Capability Kimi K2.5 demonstrates state-of-the-art computer-use capability on real-world tasks. On the computer-use benchmark OSWorld-Verified [72, 73], it achieves a 63.3% success rate relying solely on GUI actions without external tools. This substantially outperforms open-source models such as Qwen3-VL-235B-A22B (38.1%) and OpenAI’s computer-use agent framework Operator (o3-based) (42.9%), while remaining competitive with the current leading CUA model, Claude Opus 4.5 (66.3%). On WebArena [80], an established benchmark for GUI-based web browsing, Kimi K2.5 achieves a 58.9% success rate, surpassing OpenAI’s Operator (58.1%) and approaching the performance of Claude Opus 4.5 (63.4%).

# 5.2 Agent Swarm Results

Benchmarks To rigorously evaluate the effectiveness of the agent swarm framework, we select three representative benchmarks that collectively cover deep reasoning, large-scale retrieval, and real-world complexity:

• BrowseComp: A challenging deep-research benchmark that requires multi-step reasoning and complex information synthesis.   
• WideSearch: A benchmark designed to evaluate the ability to perform broad, multi-step information seeking and reasoning across diverse sources.   
• In-house Swarm Bench: An internally developed Swarm benchmark, designed to evaluate the agent swarm performance under real-world, high-complexity conditions. It covers four domains: WildSearch (unconstrained, real world information retrieval over the open web), Batch Download (large-scale acquisition of diverse resources), WideRead (large-scale document comprehension involving more than 100 input documents), and Long-Form Writing (coherent generation of extensive content exceeding 100k words). This benchmark incorporates extreme-scale scenarios that stress-test the orchestration, scalability, and coordination capabilities of agent-based systems.

Performance Table 6 presents the performance of Kimi K2.5 Agent Swarm against single-agent configurations and proprietary baselines. The results demonstrate substantial performance improvements from multi-agent orchestration. On BrowseComp, Agent Swarm achieves 78.4%, representing a 17.8% absolute gain over the single-agent K2.5 (60.6%) and surpassing even GPT-5.2 Pro (77.9%). Similarly, WideSearch sees a 6.3% improvement (72.7% → 79.0%) on Item-F1, enabling K2.5 Agent Swarm to outperform Claude Opus 4.5 (76.2%) and establish a new stateof-the-art. The gains are most pronounced on In-house Swarm bench (16.7%), where tasks are explicitly designed to reward parallel decomposition. These consistent improvements across benchmarks validate that Agent Swarm effectively converts computational parallelism into qualitative capability gains, particularly for problems requiring broad exploration, multi-source verification, or simultaneous handling of independent sub-tasks.

Table 6: Performance comparison of Kimi K2.5 Agent Swarm against single-agent and proprietary baselines on agentic search benchmarks. Bold denotes the best result per benchmark. 

<table><tr><td>Benchmark</td><td>K2.5 Agent Swarm</td><td>Kimi K2.5</td><td>Claude Opus 4.5</td><td>GPT-5.2</td><td>GPT-5.2 Pro</td></tr><tr><td>BrowseComp</td><td>78.4</td><td>60.6</td><td>37.0</td><td>65.8</td><td>77.9</td></tr><tr><td>WideSearch</td><td>79.0</td><td>72.7</td><td>76.2</td><td>-</td><td>-</td></tr><tr><td>In-house Swarm Bench</td><td>58.3</td><td>41.6</td><td>45.8</td><td>-</td><td>-</td></tr></table>

![](images/e1b0bfa473e48e92abf3e9d6c04e295e28d2849b0cbba2ce6d5eac5d0a184036.jpg)

<details>
<summary>text_image</summary>

Cross reference specialist
Award Researcher
Historical Researcher
Biographical researcher
Verification Researcher
Cross Reference researcher
Timeline Investigator
Timeline analyst
Biography Researcher
Publication Researcher
Timeline Researcher
Verification Specialist
Thesis Researcher
Academic Researcher
Cross Reference Investigator
Verification Agent
Cross Reference Analyst
Data Verifier verifier
Film Researcher
University Researcher
author investigator
Biography Investigator
Book Researcher
Article Researcher
Article Finder
Literacy researcher
University investigator
</details>

Figure 6: The word cloud visualizes heterogeneous K2.5-based sub-agents dynamically instantiated by the Orchestrator across tests.

![](images/bab07e335505bdc7ce906dc9a7dfd507a2da2ee34346defff0d6a0e5057c3195.jpg)

<details>
<summary>line</summary>

| log(steps) | Discard-all Context Management | Agent Swarm |
| ---------- | ------------------------------ | ----------- |
| 100        | 60.0%                          | 47.0%       |
| 200        | 61.0%                          | 58.0%       |
| 300        | 62.0%                          | 65.0%       |
| 400        | 63.0%                          | 70.0%       |
| 500        | 64.0%                          | 72.0%       |
| 600        | 65.0%                          | 74.0%       |
| 700        | 66.0%                          | 75.0%       |
| 800        | 67.0%                          | 76.0%       |
| 900        | 68.0%                          | 77.0%       |
| 1000       | 69.0%                          | 78.0%       |
| 1100       | 70.0%                          | 78.5%       |
| 1200       | 71.0%                          | 78.5%       |
| 1300       | 72.0%                          | 78.5%       |
| 1400       | 73.0%                          | 78.5%       |
| 1500       | 74.0%                          | 78.5%       |
| 1600       | 75.0%                          | 78.5%       |
| 1700       | 75.5%                          | 78.5%       |
| 1800       | 76.0%                          | 78.5%       |
| 1900       | 76.5%                          | 78.5%       |
| 2000       | 77.0%                          | 78.5%       |
</details>

Figure 7: Comparison of Kimi K2.5 performance under Agent Swarm and Discard-all context management in BrowseComp.

Execution Time Savings via Parallelism Beyond improved task performance, Agent Swarm achieves substantial wall-clock time reductions through parallel subagent execution. On the WideSearch benchmark, it reduces the execution time required to reach target performance by 3× ∼ 4.5× compared to a single-agent baseline. As shown in Figure 8, this efficiency gain scales with task complexity: as the target Item-F1 increases from 30% to 70%, the single agent’s execution time grows from approximately 1.8× to over 7.0× the baseline, whereas Agent Swarm maintains near-constant low latency in the range of 0.6× ∼ 1.6×. These results indicate that Agent Swarm effectively transforms sequential tool invocations into parallel operations, preventing the linear growth in completion time typically observed as task difficulty increases.

Dynamic Subagent Creation and Scheduling Within an agent swarm, subagents are dynamically instantiated rather than pre-defined. Through PARL, the orchestrator learns adaptive policies to create and schedule self-hosted subagents in response to evolving task structures and problem states. Unlike static decomposition approaches, this learned policy enables the Orchestrator to reason about the requisite number, timing, and specialization of subagents based on query. Consequently, a heterogeneous agent group emerges organically from this adaptive allocation strategy (Figure 6).

Agent Swarm as Proactive Context Management Beyond better performance and runtime acceleration, an agent swarm is a kind of proactive and intelligent context management enabled by multi-agent architecture [5]. This approach differs from test-time context truncation strategies such as Hide-Tool-Result [2], Summary [71], or Discard-all [14], which react to context overflow by compressing or discarding accumulated histories. While effective at reducing token usage, these methods are inherently reactive and often sacrifice structural information or intermediate reasoning.

In contrast, Agent Swarm enables proactive context control through explicit orchestration. Long-horizon tasks are decomposed into parallel, semantically isolated subtasks, each executed by a specialized subagent with a bounded local context. Crucially, these subagents maintain independent working memories and perform local reasoning without directly mutating or contaminating the global context of the central orchestrator. Only task-relevant outputs—rather than full interaction traces—are selectively routed back to the orchestrator. This design induces context sharding rather than context truncation, allowing the system to scale effective context length along an additional architectural dimension while preserving modularity, information locality, and reasoning integrity.

![](images/ff5eef485c461368386c04acdd5fc7993386ab4ea2cdca7c418dd51cfd451cd7.jpg)

<details>
<summary>line</summary>

| Target Item-F1 | Agent Swarm | Single Agent |
| -------------- | ----------- | ------------ |
| 30.0%          | 0.6x        | 1.8x         |
| 35.0%          | 0.8x        | 2.0x         |
| 40.0%          | 0.9x        | 2.4x         |
| 45.0%          | 0.9x        | 2.8x         |
| 50.0%          | 1.0x        | 3.2x         |
| 55.0%          | 1.0x        | 3.8x         |
| 60.0%          | 1.2x        | 4.4x         |
| 65.0%          | 1.4x        | 5.2x         |
| 70.0%          | 1.6x        | 7.2x         |
</details>

Figure 8: Agent Swarm achieves 3×–4.5× faster execution time compared to single-agent baselines as target Item-F1 increases from 30% to 70% in WideSearch testing.

As shown in Figure 7, this proactive strategy outperforms Discard-all in both efficiency and accuracy on BrowseComp. By preserving task-level coherence at the orchestrator level while keeping subagent contexts tightly bounded, Agent Swarm enables parallel execution with selective context persistence, retaining only high-level coordination signals or essential intermediate results. Consequently, Agent Swarm operates as an active, structured context manager, achieving higher accuracy with substantially fewer critical steps than uniform context truncation.

# 6 Conclusions

Kimi K2.5 shows that scalable and general agentic intelligence can be achieved through joint optimization of text and vision together with parallel agent execution. By unifying language and vision across pre-training and reinforcement learning, the model achieves strong cross-modal alignment and visual–text reasoning. Agent Swarm enables concurrent execution of heterogeneous sub-tasks, reducing inference latency while improving performance on complex agentic workloads. Grounded in vision–text intelligence and agent swarms, Kimi K2.5 demonstrates strong performance on benchmarks and real-world tasks. By open-sourcing the post-trained checkpoints, we aim to support the open-source community in building scalable and general-purpose agentic systems and to accelerate progress toward General Agentic Intelligence.

# References

[1] Moonshot AI. Introducing Kimi K2 Thinking. 2025. URL: https://moonshotai.github.io/Kimi K2/thinking.html.   
[2] Moonshot AI. Kimi-Researcher End-to-End RL Training for Emerging Agentic Capabilities. 2025. URL: https://moonshotai.github.io/Kimi-Researcher/.   
[3] Amazon Web Services. Amazon Simple Storage Service (Amazon S3). Web. Available at: https://aws. amazon.com/s3/. 2023. URL: https://aws.amazon.com/s3/ (visited on 12/15/2023).   
[4] Mathematical Association of America. 2025 American Invitational Mathematics Examination I. Held on February 6, 2025. 2025. URL: https://artofproblemsolving.com/wiki/index.php/2025\_AIME I.   
[5] Anthropic. Building multi-agent systems: when and how to use them. 2026. URL: https://claude.com/ blog/building-multi-agent-systems-when-and-how-to-use-them.   
[6] Anthropic. Claude Opus 4.5 System Card. 2025. URL: https : / / www - cdn . anthropic . com / bf10f64990cfda0ba858290be7b8cc6317685f47.pdf.   
[7] Anthropic. How we built our multi-agent research system. 2025. URL: https://www.anthropic.com/ engineering/multi-agent-research-system.   
[8] Shuai Bai et al. Qwen3-VL Technical Report. 2025. arXiv: 2511 . 21631 [cs.CV]. URL: https : / / arxiv.org/abs/2511.21631.   
[9] Yushi Bai et al. LongBench v2: Towards Deeper Understanding and Reasoning on Realistic Long-context Multitasks. 2025. arXiv: 2412.15204 [cs.CL]. URL: https://arxiv.org/abs/2412.15204.   
[10] Greg Brockman et al. OpenAI Gym. 2016. arXiv: 1606.01540 [cs.LG]. URL: https://arxiv.org/ abs/1606.01540.   
[11] Tom B. Brown et al. Language Models are Few-Shot Learners. 2020. arXiv: 2005.14165 [cs.CL]. URL: https://arxiv.org/abs/2005.14165.   
[12] Liang Chen et al. BabyVision: Visual Reasoning Beyond Language. 2026. arXiv: 2601.06521 [cs.CV]. URL: https://arxiv.org/abs/2601.06521.   
[13] Xianfu Cheng et al. SimpleVQA: Multimodal Factuality Evaluation for Multimodal Large Language Models. 2025. arXiv: 2502.13059 [cs.CL]. URL: https://arxiv.org/abs/2502.13059.   
[14] DeepSeek-AI et al. DeepSeek-V3.2: Pushing the Frontier of Open Large Language Models. 2025. arXiv: 2512. 02556 [cs.CL]. URL: https://arxiv.org/abs/2512.02556.   
[15] Mostafa Dehghani et al. Patch n’ Pack: NaViT, a Vision Transformer for any Aspect Ratio and Resolution. 2023. arXiv: 2307.06304 [cs.CV]. URL: https://arxiv.org/abs/2307.06304.   
[16] Xiang Deng et al. “SWE-Bench Pro: Can AI Agents Solve Long-Horizon Software Engineering Tasks?” In: arXiv preprint arXiv:2509.16941 (2025).   
[17] Chaoyou Fu et al. Video-MME: The First-Ever Comprehensive Evaluation Benchmark of Multi-modal LLMs in Video Analysis. 2025. arXiv: 2405.21075 [cs.CV]. URL: https://arxiv.org/abs/2405.21075.   
[18] Xingyu Fu et al. BLINK: Multimodal Large Language Models Can See but Not Perceive. 2024. arXiv: 2404. 12390 [cs.CV]. URL: https://arxiv.org/abs/2404.12390.   
[19] Samir Yitzhak Gadre et al. “Datacomp: In search of the next generation of multimodal datasets”. In: Advances in Neural Information Processing Systems 36 (2024).   
[20] Google. Gemini 3 Pro. 2025. URL: https://deepmind.google/models/gemini/pro/.   
[21] Dong Guo et al. Seed1.5-VL Technical Report. 2025. arXiv: 2505 . 07062 [cs.CV]. URL: https : / / arxiv.org/abs/2505.07062.   
[22] Lukas Haas et al. SimpleQA Verified: A Reliable Factuality Benchmark to Measure Parametric Knowledge. 2025. arXiv: 2509.07968 [cs.CL]. URL: https://arxiv.org/abs/2509.07968.   
[23] Yun He et al. AdvancedIF: Rubric-Based Benchmarking and Reinforcement Learning for Advancing LLM Instruction Following. 2025. arXiv: 2511.10507 [cs.CL]. URL: https://arxiv.org/abs/2511. 10507.   
[24] Wenyi Hong et al. MotionBench: Benchmarking and Improving Fine-grained Video Motion Understanding for Vision Language Models. 2025. arXiv: 2501 . 02955 [cs.CV]. URL: https : / / arxiv . org / abs 2501.02955.   
[25] Kairui Hu et al. Video-MMMU: Evaluating Knowledge Acquisition from Multi-Discipline Professional Videos. 2025. arXiv: 2501.13826 [cs.CV]. URL: https://arxiv.org/abs/2501.13826.

[26] Liang Hu et al. FinSearchComp: Towards a Realistic, Expert-Level Evaluation of Financial Search and Reasoning. 2025. arXiv: 2509.13160 [cs.CL]. URL: https://arxiv.org/abs/2509.13160.   
[27] Yanping Huang et al. GPipe: Efficient Training of Giant Neural Networks using Pipeline Parallelism. 2019. arXiv: 1811.06965 [cs.CV]. URL: https://arxiv.org/abs/1811.06965.   
[28] Naman Jain et al. “Livecodebench: Holistic and contamination free evaluation of large language models for code”. In: arXiv preprint arXiv:2403.07974 (2024).   
[29] Carlos E Jimenez et al. “Swe-bench: Can language models resolve real-world github issues?” In: arXiv preprint arXiv:2310.06770 (2023).   
[30] Keller Jordan et al. Muon: An optimizer for hidden layers in neural networks. 2024. URL: https : / kellerjordan.github.io/posts/muon/.   
[31] Kimi Team. “Kimi k1. 5: Scaling reinforcement learning with llms”. In: arXiv preprint arXiv:2501.12599 (2025).   
[32] Hugo Laurençon et al. “Obelics: An open web-scale filtered dataset of interleaved image-text documents”. In: Advances in Neural Information Processing Systems 36 (2024).   
[33] Dmitry Lepikhin et al. “Gshard: Scaling giant models with conditional computation and automatic sharding”. In: arXiv preprint arXiv:2006.16668 (2020).   
[34] Jingyuan Liu et al. “Muon is Scalable for LLM Training”. In: arXiv preprint arXiv:2502.16982 (2025).   
[35] Yuliang Liu et al. “OCRBench: on the hidden mystery of OCR in large multimodal models”. In: Science China Information Sciences 67.12 (Dec. 2024). ISSN: 1869-1919. DOI: 10.1007/s11432-024-4235-6. URL: http://dx.doi.org/10.1007/s11432-024-4235-6.   
[36] Pan Lu et al. MathVista: Evaluating Mathematical Reasoning of Foundation Models in Visual Contexts. 2024. arXiv: 2310.02255 [cs.CV]. URL: https://arxiv.org/abs/2310.02255.   
[37] Thang Luong et al. “Towards Robust Mathematical Reasoning”. In: Proceedings of the 2025 Conference on Empirical Methods in Natural Language Processing. Ed. by Christos Christodoulopoulos et al. Suzhou, China: Association for Computational Linguistics, Nov. 2025, pp. 35418–35442. ISBN: 979-8-89176-332-6. DOI: 10. 18653/v1/2025.emnlp- main.1794. URL: https://aclanthology.org/2025.emnlpmain.1794/.   
[38] Minesh Mathew et al. InfographicVQA. 2021. arXiv: 2104.12756 [cs.CV]. URL: https://arxiv. org/abs/2104.12756.   
[39] Mike A Merrill et al. “Terminal-Bench: Benchmarking Agents on Hard, Realistic Tasks in Command Line Interfaces”. In: arXiv preprint arXiv:2601.11868 (2026).   
[40] Deepak Narayanan et al. Efficient Large-Scale Language Model Training on GPU Clusters Using Megatron-LM. 2021. arXiv: 2104.04473 [cs.CL]. URL: https://arxiv.org/abs/2104.04473.   
[41] OpenAI. Introducing GPT 5.2. 2025. URL: https://openai.com/index/introducing-gpt-5- 2/.   
[42] Linke Ouyang et al. OmniDocBench: Benchmarking Diverse PDF Document Parsing with Comprehensive Annotations. 2025. arXiv: 2412.07626 [cs.CV]. URL: https://arxiv.org/abs/2412.07626.   
[43] Tejal Patwardhan et al. GDPval: Evaluating AI Model Performance on Real-World Economically Valuable Tasks. 2025. arXiv: 2510.04374 [cs.LG]. URL: https://arxiv.org/abs/2510.04374.   
[44] Bowen Peng et al. “Yarn: Efficient context window extension of large language models”. In: arXiv preprint arXiv:2309.00071 (2023).   
[45] Thinh Pham et al. SealQA: Raising the Bar for Reasoning in Search-Augmented Language Models. Seal-0 is the main subset of this benchmark. 2025. arXiv: 2506.01062 [cs.CL]. URL: https://arxiv.org abs/2506.01062.   
[46] Long Phan et al. Humanity’s Last Exam. 2025. arXiv: 2501.14249 [cs.LG]. URL: https://arxiv. org/abs/2501.14249.   
[47] David Rein et al. “Gpqa: A graduate-level google-proof q&a benchmark”. In: First Conference on Language Modeling. 2024.   
[48] Jonathan Roberts et al. ZeroBench: An Impossible Visual Benchmark for Contemporary Large Multimodal Models. 2025. arXiv: 2502.09696 [cs.CV]. URL: https://arxiv.org/abs/2502.09696.   
[49] Christoph Schuhmann et al. “Laion-5b: An open large-scale dataset for training next generation image-text models”. In: Advances in Neural Information Processing Systems 35 (2022), pp. 25278–25294.   
[50] John Schulman et al. “Proximal Policy Optimization Algorithms”. In: arXiv preprint arXiv:1707.06347 (2017). URL: https://arxiv.org/abs/1707.06347.

[51] Tianhui Song et al. Towards Pixel-Level VLM Perception via Simple Points Prediction. 2026. arXiv: 2601. 19228 [cs.CV]. URL: https://arxiv.org/abs/2601.19228.   
[52] Giulio Starace et al. “PaperBench: Evaluating AI’s Ability to Replicate AI Research”. In: arXiv preprint arXiv:2504.01848 (2025).   
[53] Kimi Team et al. “Kimi k2: Open agentic intelligence”. In: arXiv preprint arXiv:2507.20534 (2025).   
[54] Kimi Team et al. “Kimi-vl technical report”. In: arXiv preprint arXiv:2504.07491 (2025).   
[55] Meituan LongCat Team et al. “Longcat-flash-omni technical report”. In: arXiv preprint arXiv:2511.00279 (2025).   
[56] Minyang Tian et al. “Scicode: A research coding benchmark curated by scientists”. In: Advances in Neural Information Processing Systems 37 (2024), pp. 30624–30650.   
[57] Shengbang Tong et al. Eyes Wide Shut? Exploring the Visual Shortcomings of Multimodal LLMs. 2024. arXiv: 2401.06209 [cs.CV]. URL: https://arxiv.org/abs/2401.06209.   
[58] Harvard-MIT Mathematics Tournament. Harvard-MIT Mathematics Tournament, February 2025. Held on February 15, 2025. 2025. URL: https://www.hmmt.org/www/archive/282.   
[59] Ashish Vaswani et al. “Attention is All you Need”. In: Advances in Neural Information Processing Systems. Ed. by I. Guyon et al. Vol. 30. Curran Associates, Inc., 2017. URL: https://proceedings.neurips. cc/paper\_files/paper/2017/file/3f5ee243547dee91fbd053c1c4a845aa-Paper.pdf.   
[60] Nikhita Vedula et al. DeepSearchQA: Bridging the Comprehensiveness Gap for Deep Research Agents. 2025. URL: https : / / storage . googleapis . com / deepmind - media / DeepSearchQA / DeepSearchQA\_benchmark\_paper.pdf.   
[61] Ke Wang et al. Measuring Multimodal Mathematical Reasoning with MATH-Vision Dataset. 2024. arXiv: 2402.14804 [cs.CV]. URL: https://arxiv.org/abs/2402.14804.   
[62] Weihan Wang et al. LVBench: An Extreme Long Video Understanding Benchmark. 2025. arXiv: 2406.08035 [cs.CV]. URL: https://arxiv.org/abs/2406.08035.   
[63] Xinyuan Wang et al. OpenCUA: Open Foundations for Computer-Use Agents. 2025. arXiv: 2508.09123 [cs.AI]. URL: https://arxiv.org/abs/2508.09123.   
[64] Yubo Wang et al. MMLU-Pro: A More Robust and Challenging Multi-Task Language Understanding Benchmark. 2024. arXiv: 2406.01574 [cs.CL]. URL: https://arxiv.org/abs/2406.01574.   
[65] Zhexu Wang et al. “OJBench: A Competition Level Code Benchmark For Large Language Models”. In: arXiv preprint arXiv:2506.16395 (2025).   
[66] Zhun Wang et al. “CyberGym: Evaluating AI Agents’ Cybersecurity Capabilities with Real-World Vulnerabilities at Scale”. In: arXiv preprint arXiv:2506.02548 (2025).   
[67] Zirui Wang et al. CharXiv: Charting Gaps in Realistic Chart Understanding in Multimodal LLMs. 2024. arXiv: 2406.18521 [cs.CL]. URL: https://arxiv.org/abs/2406.18521.   
[68] Jason Wei et al. BrowseComp: A Simple Yet Challenging Benchmark for Browsing Agents. 2025. arXiv: 2504. 12516 [cs.CL]. URL: https://arxiv.org/abs/2504.12516.   
[69] Ryan Wong et al. WideSearch: Benchmarking Agentic Broad Info-Seeking. 2025. arXiv: 2508 . 07999 [cs.CL]. URL: https://arxiv.org/abs/2508.07999.   
[70] Haoning Wu et al. LongVideoBench: A Benchmark for Long-context Interleaved Video-Language Understanding. 2024. arXiv: 2407.15754 [cs.CV]. URL: https://arxiv.org/abs/2407.15754.   
[71] Xixi Wu et al. ReSum: Unlocking Long-Horizon Search Intelligence via Context Summarization. 2025. arXiv: 2509.13313 [cs.CL]. URL: https://arxiv.org/abs/2509.13313.   
[72] Tianbao Xie et al. “Introducing OSWorld-Verified”. In: xlang.ai (July 2025). URL: https://xlang.ai/ blog/osworld-verified.   
[73] Tianbao Xie et al. OSWorld: Benchmarking Multimodal Agents for Open-Ended Tasks in Real Computer Environments. 2024. arXiv: 2404.07972 [cs.AI].   
[74] Feng Yao et al. Your Efficient RL Framework Secretly Brings You Off-Policy RL Training. Aug. 2025. URL: https://fengyao.notion.site/off-policy-rl.   
[75] Xiang Yue et al. MMMU-Pro: A More Robust Multi-discipline Multimodal Understanding Benchmark. 2025. arXiv: 2409.02813 [cs.CL]. URL: https://arxiv.org/abs/2409.02813.   
[76] Xiang Yue et al. “MMMU: A Massive Multi-discipline Multimodal Understanding and Reasoning Benchmark for Expert AGI”. In: Proceedings of CVPR. 2024.   
[77] Xiaohua Zhai et al. Sigmoid Loss for Language Image Pre-Training. 2023. arXiv: 2303.15343 [cs.CV]. URL: https://arxiv.org/abs/2303.15343.

[78] Xin Zhao et al. Small Leak Can Sink a Great Ship–Boost RL Training on MoE with IcePop! Sept. 2025. URL: https://ringtech.notion.site/icepop.   
[79] Yilun Zhao et al. MMVU: Measuring Expert-Level Multi-Discipline Video Understanding. 2025. arXiv: 2501. 12380 [cs.CV]. URL: https://arxiv.org/abs/2501.12380.   
[80] Shuyan Zhou et al. “WebArena: A Realistic Web Environment for Building Autonomous Agents”. In: arXiv preprint arXiv:2307.13854 (2023). URL: https://webarena.dev.   
[81] Wanrong Zhu et al. “Multimodal c4: An open, billion-scale corpus of images interleaved with text”. In: Advances in Neural Information Processing Systems 36 (2024).

A Contributors 

<table><tr><td>Tongtong Bai</td><td>Zhuoma Gongque</td><td>Liang Liu</td><td>Tongyu Sun</td><td>Junyan Wu</td><td>Xiaokun Yuan</td></tr><tr><td>Yifan Bai</td><td>Qizheng Gu</td><td>Shaowei Liu</td><td>Flood Sung</td><td>Rucong Wu</td><td>Yang Yue</td></tr><tr><td>Yiping Bao</td><td>Xinran Gu</td><td>Shudong Liu</td><td>Yunpeng Tai</td><td>Wenhao Wu</td><td>Weihao Zeng</td></tr><tr><td>S.H. Cai</td><td>Yicheng Gu</td><td>Shuran Liu</td><td>Chuning Tang</td><td>Yuefeng Wu</td><td>Dunyuan Zha</td></tr><tr><td>Yuan Cao</td><td>Longyu Guan</td><td>Tianwei Liu</td><td>Heyi Tang</td><td>Yuhao Wu</td><td>Haobing Zhan</td></tr><tr><td>Y. Charles</td><td>Yuanying Guo</td><td>Tianyu Liu</td><td>Xiaojuan Tang</td><td>Yuxin Wu</td><td>Dehao Zhang</td></tr><tr><td>H.S. Che</td><td>Xiaoru Hao</td><td>Weizhou Liu</td><td>Zhengyang Tang</td><td>Zijian Wu</td><td>Hao Zhang</td></tr><tr><td>Cheng Chen</td><td>Weiran He</td><td>Xiangyan Liu</td><td>Jiawen Tao</td><td>Chenjun Xiao</td><td>Jin Zhang</td></tr><tr><td>Guanduo Chen</td><td>Wenyang He</td><td>Yangyang Liu</td><td>Shiyuan Teng</td><td>Jin Xie</td><td>Puqi Zhang</td></tr><tr><td>Huarong Chen</td><td>Yunjia He</td><td>Yanming Liu</td><td>Chaoran Tian</td><td>Xiaotong Xie</td><td>Qiao Zhang</td></tr><tr><td>Jia Chen</td><td>Chao Hong</td><td>Yibo Liu</td><td>Pengfei Tian</td><td>Yuchong Xie</td><td>Rui Zhang</td></tr><tr><td>Jiahao Chen</td><td>Hao Hu</td><td>Yuanxin Liu</td><td>Ao Wang</td><td>Yifei Xin</td><td>Xiaobin Zhang</td></tr><tr><td>Jianlong Chen</td><td>Jiaxi Hu</td><td>Yue Liu</td><td>Bowen Wang</td><td>Bowei Xing</td><td>Y. Zhang</td></tr><tr><td>Jun Chen</td><td>Yangyang Hu</td><td>Zhengying Liu</td><td>Chensi Wang</td><td>Boyu Xu</td><td>Yadong Zhang</td></tr><tr><td>Kefan Chen</td><td>Zhenxing Hu</td><td>Zhongnuo Liu</td><td>Chuang Wang</td><td>Jianfan Xu</td><td>Yangkun Zhang</td></tr><tr><td>Liang Chen</td><td>Ke Huang</td><td>Enzhe Lu</td><td>Congcong Wang</td><td>Jing Xu</td><td>Yichi Zhang</td></tr><tr><td>Ruijue Chen</td><td>Ruiyuan Huang</td><td>Haoyu Lu</td><td>Dingkun Wang</td><td>Jinjing Xu</td><td>Yizhi Zhang</td></tr><tr><td>Xinhao Chen</td><td>Weixiao Huang</td><td>Zhiyuan Lu</td><td>Dinglu Wang</td><td>L.H. Xu</td><td>Yongting Zhang</td></tr><tr><td>Yanru Chen</td><td>Zhiqi Huang</td><td>Junyu Luo</td><td>Dongliang Wang</td><td>Lin Xu</td><td>Yu Zhang</td></tr><tr><td>Yanxu Chen</td><td>Tao Jiang</td><td>Tongxu Luo</td><td>Feng Wang</td><td>Suting Xu</td><td>Yushun Zhang</td></tr><tr><td>Yicun Chen</td><td>Zhejun Jiang</td><td>Yashuo Luo</td><td>Hailong Wang</td><td>Weixin Xu</td><td>Yutao Zhang</td></tr><tr><td>Yimin Chen</td><td>Xinyi Jin</td><td>Long Ma</td><td>Haiming Wang</td><td>Xinbo Xu</td><td>Yutong Zhang</td></tr><tr><td>Yingjiang Chen</td><td>Yu Jing</td><td>Yingwei Ma</td><td>Hengzhi Wang</td><td>Xinran Xu</td><td>Zheng Zhang</td></tr><tr><td>Yuankun Chen</td><td>Guokun Lai</td><td>Shaoguang Mao</td><td>Huaqing Wang</td><td>Yangchuan Xu</td><td>Chenguang Zhao</td></tr><tr><td>Yujie Chen</td><td>Aidi Li</td><td>Yuan Mei</td><td>Hui Wang</td><td>Yichang Xu</td><td>Feifan Zhao</td></tr><tr><td>Yutian Chen</td><td>C. Li</td><td>Xin Men</td><td>Jiahao Wang</td><td>Yuemeng Xu</td><td>Jinxiang Zhao</td></tr><tr><td>Zhirong Chen</td><td>Cheng Li</td><td>Fanqing Meng</td><td>Jinhong Wang</td><td>Zelai Xu</td><td>Shuai Zhao</td></tr><tr><td>Ziwei Chen</td><td>Fang Li</td><td>Zhiyong Meng</td><td>Jiuzheng Wang</td><td>Ziyao Xu</td><td>Xiangyu Zhao</td></tr><tr><td>Dazhi Cheng</td><td>Guanghe Li</td><td>Yibo Miao</td><td>Kaixin Wang</td><td>Junjie Yan</td><td>Yikai Zhao</td></tr><tr><td>Minghan Chu</td><td>Guanyu Li</td><td>Minqing Ni</td><td>Linian Wang</td><td>Yuzi Yan</td><td>Zijia Zhao</td></tr><tr><td>Jialei Cui</td><td>Haitao Li</td><td>Kun Ouyang</td><td>Qibin Wang</td><td>Guangyao Yang</td><td>Huabin Zheng</td></tr><tr><td>Jiaqi Deng</td><td>Haoyang Li</td><td>Siyuan Pan</td><td>Shengjie Wang</td><td>Hao Yang</td><td>Ruihan Zheng</td></tr><tr><td>Muxi Diao</td><td>Jia Li</td><td>Bo Pang</td><td>Shuyi Wang</td><td>Junwei Yang</td><td>Shaojie Zheng</td></tr><tr><td>Hao Ding</td><td>Jingwei Li</td><td>Yuchao Qian</td><td>Si Wang</td><td>Kai Yang</td><td>Tengyang Zheng</td></tr><tr><td>Mengfan Dong</td><td>Junxiong Li</td><td>Ruoyu Qin</td><td>Wei Wang</td><td>Ningyuan Yang</td><td>Junfeng Zhong</td></tr><tr><td>Mengnan Dong</td><td>Lincan Li</td><td>Zeyu Qin</td><td>Xiaochen Wang</td><td>Ruihan Yang</td><td>Longguang Zhong</td></tr><tr><td>Yuxin Dong</td><td>Mo Li</td><td>Jiezhong Qiu</td><td>Xinyuan Wang</td><td>Xiaofei Yang</td><td>Weiming Zhong</td></tr><tr><td>Yuhao Dong</td><td>Weihong Li</td><td>Bowen Qu</td><td>Yao Wang</td><td>Xinlong Yang</td><td>M. Zhou</td></tr><tr><td>Ang&#x27;ang Du</td><td>Wentao Li</td><td>Zeyu Shang</td><td>Yejie Wang</td><td>Ying Yang</td><td>Runjie Zhou</td></tr><tr><td>Chenzhuang Du</td><td>Xinhang Li</td><td>Youbo Shao</td><td>Yipu Wang</td><td>Yi (弋) Yang</td><td>Xinyu Zhou</td></tr><tr><td>Dikang Du</td><td>Xinhao Li</td><td>Tianxiao Shen</td><td>Yiqin Wang</td><td>Yi (翌) Yang</td><td>Zaida Zhou</td></tr><tr><td>Lingxiao Du</td><td>Yang Li</td><td>Zhennan Shen</td><td>Yucheng Wang</td><td>Zhen Yang</td><td>Jinguo Zhu</td></tr><tr><td>Yulun Du</td><td>Yanhao Li</td><td>Juanfeng Shi</td><td>Yuzhi Wang</td><td>Zhilin Yang</td><td>Liya Zhu</td></tr><tr><td>Yu Fan</td><td>Yiwei Li</td><td>Lidong Shi</td><td>Zhaoji Wang</td><td>Zonghan Yang</td><td>Xinhao Zhu</td></tr><tr><td>Shengjun Fang</td><td>Yuxiao Li</td><td>Shengyuan Shi</td><td>Zhaowei Wang</td><td>Haotian Yao</td><td>Yuxuan Zhu</td></tr><tr><td>Qiulin Feng</td><td>Zhaowei Li</td><td>Feifan Song</td><td>Zhengtao Wang</td><td>Dan Ye</td><td>Zhen Zhu</td></tr><tr><td>Yichen Feng</td><td>Zheming Li</td><td>Pengwei Song</td><td>Zhexu Wang</td><td>Wenjie Ye</td><td>Jingze Zhuang</td></tr><tr><td>Garimugai Fu</td><td>Weilong Liao</td><td>Tianhui Song</td><td>Zihan Wang</td><td>Zhuorui Ye</td><td>Weiyu Zhuang</td></tr><tr><td>Kelin Fu</td><td>Jiawei Lin</td><td>Xiaoxi Song</td><td>Zizhe Wang</td><td>Bohong Yin</td><td>Ying Zou</td></tr><tr><td>Hongcheng Gao</td><td>Xiaohan Lin</td><td>Hongjin Su</td><td>Chu Wei</td><td>Chengzhen Yu</td><td>Xinxing Zu</td></tr><tr><td>Tong Gao</td><td>Zhishan Lin</td><td>Jianlin Su</td><td>Ming Wei</td><td>Longhui Yu</td><td>Kimi K2</td></tr><tr><td>Yuyao Ge</td><td>Zichao Lin</td><td>Zhaochen Su</td><td>Chuan Wen</td><td>Tao Yu $^{ \dagger }$ </td><td>Kimi K2.5</td></tr><tr><td>Shangyi Geng</td><td>Cheng Liu</td><td>Lin Sui</td><td>Zichen Wen</td><td>Tianxiang Yu</td><td></td></tr><tr><td>Chengyang Gong</td><td>Chenyu Liu</td><td>Jinsong Sun</td><td>Chengjie Wu</td><td>Enming Yuan</td><td></td></tr><tr><td>Xiaochen Gong</td><td>Hongzhang Liu</td><td>Junyao Sun</td><td>Haoning Wu</td><td>Mengjie Yuan</td><td></td></tr></table>

![](images/4597ae934cdf48a6d45944bdce2efb0f8213378e155d52701f6f3034bf8eb86b.jpg)

<details>
<summary>line</summary>

| Steps | Vision:Text = 10%:90% | Vision:Text = 20%:80% | Vision:Text = 50%:50% |
| ----- | --------------------- | --------------------- | --------------------- |
| 0     | 0.0                   | 0.0                   | 0.0                   |
| 10    | 0.5                   | 0.3                   | 0.1                   |
| 20    | 0.8                   | 0.6                   | 0.3                   |
| 30    | 1.0                   | 0.8                   | 0.5                   |
| 40    | 1.2                   | 1.0                   | 0.7                   |
| 50    | 1.5                   | 1.2                   | 0.9                   |
| 60    | 1.8                   | 1.5                   | 1.1                   |
| 70    | 2.0                   | 1.8                   | 1.3                   |
| 80    | 2.2                   | 2.0                   | 1.5                   |
| 90    | 2.5                   | 2.2                   | 1.7                   |
| 100   | 2.8                   | 2.5                   | 1.9                   |
| 110   | 3.0                   | 2.8                   | 2.1                   |
| 120   | 3.2                   | 3.0                   | 2.3                   |
| 130   | 3.5                   | 3.2                   | 2.5                   |
| 140   | 3.8                   | 3.5                   | 2.7                   |
| 150   | 4.0                   | 3.8                   | 2.9                   |
| 160   | 4.2                   | 4.0                   | 3.1                   |
| 170   | 4.5                   | 4.2                   | 3.3                   |
| 180   | 4.8                   | 4.5                   | 3.5                   |
| 190   | 5.0                   | 4.8                   | 3.7                   |
| 200   | 5.2                   | 5.0                   | 3.9                   |
| 210   | 5.5                   | 5.2                   | 4.1                   |
| 220   | 5.8                   | 5.5                   | 4.3                   |
| 230   | 6.0                   | 5.8                   | 4.5                   |
| 240   | 6.2                   | 6.0                   | 4.7                   |
| 250   | 6.5                   | 6.2                   | 4.9                   |
| 260   | 6.8                   | 6.5                   | 5.1                   |
| 270   | 7.0                   | 6.8                   | 5.3                   |
| 280   | 7.2                   | 7.0                   | 5.5                   |
| 290   | 7.5                   | 7.2                   | 5.7                   |
| 300   | 7.8                   | 7.5                   | 5.9                   |
| 310   | 8.0                   | 7.8                   | 6.1                   |
| 320   | 8.2                   | 8.0                   | 6.3                   |
| 330   | 8.5                   | 8.2                   | 6.5                   |
| 340   | 8.8                   | 8.5                   | 6.7                   |
| 350   | 9.0                   | 8.8                   | 6.9                   |
| 360   | 9.2                   | 9.0                   | 7.1                   |
| 370   | 9.5                   | 9.2                   | 7.3                   |
| 380   | 9.8                   | 9.5                   | 7.5                   |
| 390   | 10.0                  | 9.8                   | 7.7                   |
| 400   | 10.2                  | 10.0                  | 7.9                   |
| 410   | 10.5                  | 10.2                  | 8.1                   |
| 420   | 10.8                  | 10.5                  | 8.3                   |
| 430   | 11.0                  | 10.8                  | 8.5                   |
| 440   | 11.2                  | 11.0                  | 8.7                   |
| 450   | 11.5                  | 11.2                  | 8.9                   |
| 460   | 11.8                  | 11.5                  | 9.1                   |
| 470   | 12.0                  | 11.8                  | 9.3                   |
| 480   | 12.2                  | 12.0                  | 9.5                   |
| 490   | 12.5                  | 12.2                  | 9.7                   |
| 500   | 12.8                  | 12.5                  | 9.9                   |
</details>

![](images/6cd611d44928fab90dd9e24e967d9ea7d0e4dc4dda4d5d83910d2e3b2b4bc61b.jpg)

<details>
<summary>line</summary>

| Steps | Vision:Text = 10%:90% | Vision:Text = 20%:80% | Vision:Text = 50%:50% |
| ----- | --------------------- | --------------------- | --------------------- |
| 0     | 0.0                   | 0.0                   | 0.0                   |
| 10    | 0.5                   | 0.3                   | 0.2                   |
| 20    | 1.0                   | 0.6                   | 0.4                   |
| 30    | 1.5                   | 0.9                   | 0.6                   |
| 40    | 2.0                   | 1.2                   | 0.8                   |
| 50    | 2.5                   | 1.5                   | 1.0                   |
| 60    | 3.0                   | 1.8                   | 1.2                   |
| 70    | 3.5                   | 2.1                   | 1.4                   |
| 80    | 4.0                   | 2.4                   | 1.6                   |
| 90    | 4.5                   | 2.7                   | 1.8                   |
| 100   | 5.0                   | 3.0                   | 2.0                   |
</details>

![](images/b77f071ae9b5be55a7cfb5a0f6fa7ab5cabf6f68dff193671c5e883cca52052d.jpg)

<details>
<summary>line</summary>

| Steps | Vision:Text = 10% | Vision:Text = 20% | Vision:Text = 50% |
|-------|-------------------|-------------------|-------------------|
| 0     | 0                 | 0                 | 0                 |
| 10    | 10                | 5                 | 0                 |
| 20    | 20                | 10                | 0                 |
| 30    | 30                | 15                | 0                 |
| 40    | 40                | 20                | 0                 |
| 50    | 50                | 25                | 0                 |
| 60    | 60                | 30                | 0                 |
| 70    | 70                | 35                | 0                 |
| 80    | 80                | 40                | 0                 |
| 90    | 90                | 45                | 0                 |
| 100   | 100               | 50                | 0                 |
</details>

![](images/7fb90fe4420b8cb2af863166624534d61a6df636fa41e647cf68738f62f80201.jpg)

<details>
<summary>line</summary>

| Steps | Vision:Text = 10% | Vision:Text = 20% | Vision:Text = 50% |
| ----- | ----------------- | ----------------- | ----------------- |
| 0     | 0.0               | 0.0               | 0.0               |
| 10    | 0.5               | 0.4               | 0.3               |
| 20    | 0.8               | 0.7               | 0.6               |
| 30    | 1.0               | 0.9               | 0.8               |
| 40    | 1.2               | 1.1               | 1.0               |
| 50    | 1.5               | 1.4               | 1.3               |
| 60    | 1.8               | 1.7               | 1.6               |
| 70    | 2.0               | 1.9               | 1.8               |
| 80    | 2.2               | 2.1               | 1.9               |
| 90    | 2.5               | 2.4               | 2.3               |
| 100   | 2.8               | 2.7               | 2.6               |
</details>

![](images/49b62a1141fc062a12bc7e3ea3a9e11b1c26b23e9e96f786866c9259b65f2508.jpg)

<details>
<summary>line</summary>

| Steps | Vision:Text = 10%:90% | Vision:Text = 20%:80% | Vision:Text = 50%:50% |
| ----- | --------------------- | --------------------- | --------------------- |
| 0     | 0.0                   | 0.0                   | 0.0                   |
| 10    | 0.5                   | 0.4                   | 0.3                   |
| 20    | 0.8                   | 0.7                   | 0.6                   |
| 30    | 1.0                   | 0.9                   | 0.8                   |
| 40    | 1.2                   | 1.1                   | 1.0                   |
| 50    | 1.4                   | 1.3                   | 1.2                   |
| 60    | 1.6                   | 1.5                   | 1.4                   |
| 70    | 1.8                   | 1.7                   | 1.6                   |
| 80    | 2.0                   | 1.9                   | 1.8                   |
| 90    | 2.2                   | 2.1                   | 2.0                   |
| 100   | 2.4                   | 2.3                   | 2.2                   |
</details>

![](images/b5e41ca5f5368b6ff6c183bccd455e32848546ca6c3353d55af62a548e4bd2bf.jpg)

<details>
<summary>line</summary>

| Steps | Vision:Text = 10% | Vision:Text = 20% | Vision:Text = 50% |
|-------|-------------------|-------------------|-------------------|
| 0     | 0.0               | 0.0               | 0.0               |
| 10    | 0.5               | 0.4               | 0.3               |
| 20    | 0.8               | 0.7               | 0.6               |
| 30    | 0.6               | 0.5               | 0.4               |
| 40    | 0.7               | 0.6               | 0.5               |
| 50    | 0.9               | 0.8               | 0.7               |
| 60    | 0.8               | 0.7               | 0.6               |
| 70    | 0.9               | 0.8               | 0.7               |
| 80    | 0.7               | 0.6               | 0.5               |
| 90    | 0.8               | 0.7               | 0.6               |
| 100   | 0.9               | 0.8               | 0.7               |
</details>

Figure 9: Learning curves comparing vision-to-text ratios (10:90, 20:80, 50:50) under fixed vision-text token budget across vision and language tasks. Early fusion with lower vision ratios tend to yield better results.

# B Pre-training

# B.1 Joint-Training

We further provide the full training curves for all configurations in Figure 9. Notably, we observe a "dip-and-recover" pattern in text performance during mid-fusion and late-fusion stages: when vision data is first introduced, text capability initially degrades before gradually recovering. We attribute this to the modality domain shift—the sudden introduction of vision tokens disrupts the established linguistic representation space, forcing the model to temporarily sacrifice text-specific competence for cross-modal alignment.

In contrast, early fusion maintains a healthier and more stable text performance curve throughout training. By cooptimizing vision and language from the outset, the model naturally evolves unified multimodal representations without the shock of late-stage domain migration. This suggests that early exposure not only prevents the representation collapse observed in late fusion but also facilitates smoother gradient landscapes for both modalities. Collectively, these findings reinforce our proposal of native multimodal pre-training: moderate vision ratios combined with early fusion yield superior convergence properties and more robust bi-modal competence under fixed token budgets.

# B.2 Text data

The Kimi K2.5 pre-training text corpus comprises curated, high-quality data spanning four primary domains: Web Text, Code, Mathematics, and Knowledge. Most data processing pipelines follow the methodologies outlined in Kimi K2 [53]. For each domain, we performed rigorous correctness and quality validation and designed targeted data experiments to ensure the curated dataset achieved both high diversity and effectiveness.

Enhanced Code Intelligence We upweighted code-centric data, significantly expanding (1) repository-level code supporting cross-file reasoning and architectural understanding, (2) issues, code reviews and commit histories from the internet capturing real-world development patterns, and (3) code-related documents retrieved from PDF and webtext corpora. These efforts strengthen repository-level comprehension for complex coding tasks, improve performance on agentic coding subtasks such as patch generation and unit test writing, and enhance code-related knowledge capabilities.

# B.3 Vision data

Our multimodal pre-training corpus includes seven categories: caption, interleaving, OCR, knowledge, perception, video, and agent data. Caption data [49, 19] provides fundamental modality alignment, with strict limits on synthetic captions to mitigate hallucination. Image-text interleaving data from books, web pages, and tutorials [81, 32] enables multi-image comprehension and longer context learning. OCR data spans multilingual text, dense layouts, and multipage documents. Knowledge data incorporates academic materials processed via layout parsers to develop visual reasoning capabilities.

Furthermore, we curate a specialized multimodal problem-solving corpus to bolster reasoning within Science, Technology, Engineering, and Mathematics domains. This data is aggregated through targeted retrieval and web crawling; for informational content lacking explicit query formats, we employ in-context learning [11] to automatically reformulate raw materials into structured academic problems spanning K-12 to university levels. To bridge the modality gap between visual layouts and code data, we incorporate extensive image-code paired data. This includes a diverse array of code formats—such as HTML, React, and SVG, among others—paired with their corresponding rendered screenshots, enabling the model to align abstract structural logic with concrete visual geometry.

For agentic and temporal understanding, we collect GUI screenshots and action trajectories across desktop, mobile, and web environments, including human-annotated demonstrations. Video data from diverse sources enables both hourlong video comprehension and fine-grained spatio-temporal perception. Additionally, we incorporate grounding data to enhance fine-grained visual localization, including perception annotations (bounding boxes), point-based references. We also introduce a new contour-level segmentation task [51] for pixel-level perception learning. All data undergoes rigorous filtering, deduplication, and quality control to ensure high diversity and effectiveness.

# C Infra

Kimi K2.5 is trained on NVIDIA H800 GPU clusters with 8×400 Gbps RoCE interconnects across nodes. We employ a flexible parallelism strategy combining 16-way Pipeline Parallelism (PP) with virtual stages [27, 40], 16-way Expert Parallelism (EP) [33], and ZeRO-1 Data Parallelism, enabling training on any number of nodes that is a multiple of 32. EP all-to-all communication is overlapped with computation under interleaved 1F1B scheduling. To fit activations within GPU memory constraints, we apply selective recomputation for LayerNorm, SwiGLU, and MLA up-projections, compress insensitive activations to FP8-E4M3, and offload remaining activations to CPU with overlapped streaming.

# C.1 Data Storage and Loading

We employ S3 [3] compatible object storage solutions from cloud providers to house our VLM datasets. To bridge the gap between data preparation and model training, we retain visual data in its native format and have engineered a highly efficient and adaptable data loading infrastructure. This infrastructure offers several critical advantages:

• Flexibility: Facilitates dynamic data shuffling, blending, tokenization, loss masking, and sequence packing throughout the training process, enabling adjustable data ratios as requirements evolve;   
• Augmentation: Allows for stochastic augmentation of both visual and textual modalities, while maintaining the integrity of 2D spatial coordinates and orientation metadata during geometric transformations;   
• Determinism: Guarantees fully deterministic training through meticulous management of random seeds and worker states, ensuring that any training interruption can be resumed seamlessly — the data sequence after resumption remains identical to an uninterrupted run;   
• Scalability: Achieves superior data loading throughput via tiered caching mechanisms, robustly scaling to large distributed clusters while regulating request frequency to object storage within acceptable bounds.

Furthermore, to uphold uniform dataset quality standards, we have built a unified platform overseeing data registration, visualization, statistical analysis, cross-cloud synchronization, and lifecycle governance.

# D Unified Agentic Reinforcement Learning Environment

Environment To support unified Agentic RL, our RL framework features a standardized Gym-like [10] interface to streamline the implementation of diverse environments. Such design empowers users to implement and customize environments with minimal overhead. Our design prioritizes compositional modularity by integrating a suite of pluggable components, such as a Toolset module for supporting various tools with sandboxes, a Judge module for multifaceted reward signals, and specialized modules for prompt diversification and instruction-following enhancement. These components can be dynamically composed with core agent loops, offering high flexibility and enhancing model generalization.

![](images/973c77cc24c0185d2c470f7948ec525aede2887961fd0694568a8af282e90040.jpg)

<details>
<summary>flowchart</summary>

```mermaid
graph TD
    A["Rollout Manager"] --> B["Single Agent Task"]
    B --> C["Core Agent Loop"]
    C --> D["Inference Engine Service"]
    D --> E["Training Engine Service"]
    E --> F["Recessive Call"]
    F --> C
    C --> G["Black-Box Env"]
    C --> H["White-Box Env"]
    G --> I["LLM Gateway"]
    H --> J["Env Pool"]
    I --> G
    J --> G
    G --> K["Obs Act"]
    H --> L["Obs Act"]
    K --> C
    L --> C
    C --> M["Token-in"]
    C --> N["Token-out"]
    M --> D
    N --> E
```
</details>

Figure 10: Overview of our agentic RL framework.

At the execution level, our RL framework treats every agent task as an independent asynchronous coroutine. Each task can recursively trigger sub-task rollouts, simplifying the implementation of complex multi-agent paradigms such as Parallel-Agent RL and Agent-as-Judge. As shown in the figure 10, a dedicated Rollout Manager orchestrates up to 100,000 concurrent agent tasks during the RL process, providing fine-grained control to enable features like partial rollout [31]. Upon activation, each task acquires an environment instance from a managed pool, equipped with a sandbox and specialized tools.

Inference Engine Co-design Our framework strictly follows a Token-in-Token-out paradigm. We also record log probabilities for all inference engine outputs to perform train-inference mismatch correction, ensuring stable RL training. A co-design of inference engine for RL requirements has allowed us to support these features by custom inference APIs for RL.

Besides a comprehensive suite of built-in white-box environments, there are also black-box environments that can only run under standard LLM API protocol, missing the opportunity to use advanced features offered by our custom API protocol. To facilitate model optimization under black-box environments, we developed LLM Gateway, which is a proxy service that keeps detailed records of rollout requests and responses under our custom protocol.

Monitoring and debugging It is a challenging task to optimize performance of a highly-parallel asynchronous execution system, while ensuring correctness. We develop a series of tools for performance monitoring, profiling, data visualization and data verification. We found these to be instrumental in debugging and ensuring both the efficiency and correctness of our Agentic RL.

# E Evaluation Settings

This section provides comprehensive configuration details and testing protocols for all benchmarks reported in Table 4.

# E.1 General Evaluation Protocol

Unless explicitly stated otherwise, all experiments for Kimi-K2.5 adhere to the following hyperparameter configuration:

• Temperature: 1.0   
• Top-p: 0.95   
• Context Length: 256k tokens

# E.2 Baselines

For baseline models, we report results under their respective high-performance reasoning configurations:

• Claude Opus 4.5: Extended thinking mode   
• GPT-5.2: Maximum reasoning effort (xhigh)   
• Gemini 3 Pro: High thinking level   
• DeepSeek-V3.2: Thinking mode enabled (for text-only benchmarks)   
• Qwen3-VL-235B-A22B: Thinking mode (for vision benchmarks only)

For vision and multimodal benchmarks, GPT-5.2-xhigh exhibited an approximate 10% failure rate (i.e., no output generated despite three retry attempts) during vision evaluations. These failures were treated as incorrect predictions, meaning that the reported scores may be conservative lower bounds of the model’s true capability.

In addition, because we were unable to consistently access a stable GPT-5.2 API, we skipped some benchmarks with high evaluation costs, such as WideSearch.

# E.3 Text Benchmarks

Reasoning Benchmarks. For high-complexity reasoning benchmarks, including HLE-Full, AIME 2025, HMMT 2025, GPQA-Diamond, and IMO-AnswerBench, we enforce a maximum completion budget of 96k tokens to ensure sufficient reasoning depth. To reduce variance arising from stochastic reasoning paths, results on AIME 2025 and HMMT 2025 (Feb) are averaged over 64 independent runs (Avg@64), while GPQA-Diamond is averaged over 8 runs (Avg@8).

LongBench v2. For a fair comparison, we standardize all input contexts to approximately 128k tokens using the same truncation strategy as in [9]. We observe that GPT5.2-xhigh frequently produces free-form question–answer style responses rather than the required multiple-choice format. Therefore, we report results using GPT5.2-high, which consistently adheres to the expected output format.

# E.4 Image and Video Benchmarks

All image and video understanding evaluations utilize the following configuration:

• Maximum Tokens: 64k   
• Sampling: Averaged over 3 independent runs (Avg@3)

ZeroBench (w/ tools). Multi-step reasoning evaluations use constrained step-wise generation:

• Max Tokens per Step: 24k   
• Maximum Steps: 30

MMMU-Pro. We adhere strictly to the official evaluation protocol: input order is preserved for all modalities, with images prepended to text sequences as specified in the benchmark guidelines.

Sampling Strategies for Video Benchmarks. For short video benchmarks (VideoMMMU, MMVU & Motion-Bench), we sample 128 uniform input frames with a maximum spatial resolution at 896; 2048 uniform frames are sampled for long video benchmarks (Video-MME, LongVideoBench & LVBench) with 448 spatial resolution.

# Specialized Metrics.

• OmniDocBench 1.5: Scores are computed as (1 − normalized Levenshtein distance) × 100, where higher values indicate superior OCR and document understanding accuracy.   
• WorldVQA: Access available at https://github.com/MoonshotAI/WorldVQA. This benchmark eval uates atomic, vision-centric world knowledge requiring fine-grained visual recognition and geographic under standing.

# E.5 Coding and Software Engineering

Terminal Bench 2.0. All scores are obtained using the default Terminus-2 agent framework with the provided JSON parser. Notably, we evaluate under non-thinking mode because our current context management implementation for thinking mode is technically incompatible with Terminus-2’s conversation state handling.

SWE-Bench Series. We employ an internally developed evaluation framework featuring a minimal tool set: bash, create\_file, insert, view, str\_replace, and submit. System prompts are specifically tailored for repository-level code manipulation. Peak performance is achieved under non-thinking mode across all SWE-Bench variants (Verified, Multilingual, and Pro).

CyberGym. Claude Opus 4.5 results for this benchmark are reported under non-thinking settings as specified in their technical documentation. We report scores in the difficulty level 1 (the primary setting).

PaperBench. We report the scores under the CodeDev setting.

Sampling. All coding task results are averaged over 5 independent runs (Avg@5) to ensure stability across environment initialization and non-deterministic test case ordering.

# E.6 Agentic Evaluation

Tool Setting. Kimi-K2.5 is equipped with web search tool, code interpreter (Python execution environment), and web browsing tools for all agentic evaluations, including HLE with tools and agentic search benchmarks (BrowseComp, WideSearch, DeepSearchQA, FinSearchComp T2&T3 and Seal-0).

Context Management Strategies. To handle the extended trajectory lengths inherent in complex agentic tasks, we implement domain-specific context management protocols. Unless otherwise specified below, no context management is applied to agentic evaluations; tasks exceeding the model’s supported context window are directly counted as failures rather than truncated.

Humanity’s Last Exam (HLE). For the HLE tool-augmented setting, we employ a Hide-Tool-Result Context Management strategy: when the context length exceeds predefined thresholds, only the most recent round of tool messages (observations and return values) is retained, while the reasoning chain and thinking processes from all previous steps are preserved in full.   
• BrowseComp. For BrowseComp evaluations, our evaluation contains both with and without context management settings. Under the context management setting, we adopt the same discard-all strategy proposed by DeepSeek, where all history is truncated once token thresholds are exceeded.

System Prompt. All agentic search and HLE evaluations utilize the following unified system prompt, where DATE is dynamically set to the current timestamp:

You are Kimi, today’s date: DATE.

Your task is to help the user with their questions by using various tools, thinking deeply, and ultimately answering the user’s questions.

Please follow the following principles strictly during the deep research:

1. Always focus on the user’s original question during the research process, avoiding deviating from the topic.   
2. When facing uncertain information, use search tools to confirm.   
3. When searching, filter high-trust sources (such as authoritative websites, academic databases, and professional media) and maintain a critical mindset towards low-trust sources.   
4. When performing numerical calculations, prioritize using programming tools to ensure accuracy.   
5. Please use the format [^index^] to cite any information you use.   
6. This is a \*\*Very Difficult\*\* problem--do not underestimate it. You must use tools to help your reasoning and then solve the problem.   
7. Before you finally give your answer, please recall what the question is asking for.

Sampling Protocol. To account for the inherent stochasticity in search engine result rankings and dynamic web content availability, results for Seal-0 and WideSearch are averaged over 4 independent runs (Avg@4). All other agentic benchmarks are evaluated under single-run protocols unless explicitly stated otherwise.

# E.7 Computer-Use Evaluation

Hyperparameter Settings. We set max\_steps\_per\_episode = 100 for all experiments, with temperature = 0 for OSWorld-Verified and temperature = 0.1 for WebArena. Due to resource constraints, all models are evaluated in a one-shot setting. Adhering to the OpenCUA configuration [63], the agent context includes the last 3 history images, the complete thought history, and the task instruction. For WebArena, we manually corrected errors in the evaluation scripts and employed GPT-4o as the judge model for the fuzzy\_match function. To ensure fair comparison, Claude Opus 4.5 is evaluated solely with computer-use tools (excluding browser tools), a departure from the System Card configuration [6].

# System Prompt We utilize a unified system prompt for all computer use tasks:

You are a GUI agent. You are given an instruction, a screenshot of the screen and your previous interactions with the computer. You need to perform a series of actions to complete the task. The password of the computer is {password}.

```txt
For each step, provide your response in this format:
{thought}
## Action:
{action}
## Code:
{code} 
```

```jsonl
In the code section, the code should be either pyautogui code or one of the following functions wrapped in the code block:
- {"name": "computer.wait", "description": "Make the computer wait for 20 seconds for installation, running code, etc.", "parameters": {"type": "object", "properties": {}, "required": []}}
- {"name": "computer.terminate", "description": "Terminate the current task and report its completion status", "parameters": {"type": "object", "properties": {"status": {"type": "string", "enum": ["success", "failure"], "description": "The status of the task"}, "answer": {"type": "string", "description": "The answer of the task"}}, "required": ["status"]}} 
```

# E.8 Agent Swarm Configuration

Tool Setting. In addition to the core toolset described in Appendix E.6 (web search, code interpreter, and web browsing), the orchestrator is equipped with two specialized tools for sub-agent creation and scheduling:

• create\_subagent: Instantiates a specialized sub-agent with a custom system prompt and identifier for reuse across tasks.   
• assign\_task: Dispatches assignments to created sub-agents.

The tool schemas are provided below:

```json
{
    "name": "create_subagent",
    "description": "Create a custom subagent with specific system prompt and name for reuse.",
    "parameters": {
    "type": "object",
    "properties": {
    "name": {
    "type": "string",
    "description": "Unique name for this agent configuration"
    },
    "system_prompt": {
    "type": "string"
    }
    }
    }
} 
```

```json
{
    "description": "System prompt defining the agent's role,
    capabilities, and boundaries"
    }
},
"required": ["name", "system_prompt"]
}
{
    "name": "assign_task",
    "description": "Launch a new agent.\nUsage notes:\n
    1. You can launch multiple agents concurrently whenever possible,
    to maximize performance;\n
    2. When the agent is done, it will return a single message back to you.",
    "parameters": {
    "type": "object",
    "properties": {
    "agent": {
    "type": "string",
    "description": "Specify which created agent to use."
    },
    "prompt": {
    "type": "string",
    "description": "The task for the agent to perform"
    }
    },
    "required": ["agent", "prompt"]
    }
} 
```

Step Limits. When operating in Agent Swarm mode, we set computational budgets for the orchestrator and subagents. Step limits apply to the aggregate count of tool invocations and environment interactions.

• BrowseComp: The orchestrator is constrained to a maximum of 15 steps. Each spawned sub-agent operates under a limit of 100 steps (i.e., up to 100 tool calls per sub-agent).   
• WideSearch: Both the orchestrator and each sub-agent are allocated a maximum budget of 100 steps.   
• In-house Bench: The orchestrator is constrained to a maximum of 100 steps. Each spawned sub-agent operates under a limit of 50 steps .

# System Prompt.

You are Kimi, a professional and meticulous expert in information collection and organization. You fully understand user needs, skillfully use various tools, and complete tasks with the highest efficiency.

```txt
# Task Description
After receiving users' questions, you need to fully understand their needs and think about and plan how to complete the tasks efficiently and quickly.
# Available Tools
To help you complete tasks better and faster, I have provided you with the following tools:
1. Search tool: You can use the search engine to retrieve information, supporting multiple queries in parallel.
2. Browser tools: You can visit web links (web pages, PDFs, etc.), get page content, and perform interactions such as clicking, inputting, finding, and scrolling.
3. Sub Agent tools:
- 'create_subagent': Create a new sub-agent with a unique name and clear, specific system prompt.
- 'assign_task': Delegate tasks to created sub-agents. Sub-agents can also use search and browser tools.
4. Other tools: Including code execution (IPython, Shell). 
```

# E.9 GDPVal

We cite the GDPVal-AA evaluation by Artificial Analysis, and the scores reported in Table 4 reflect the official leaderboard metrics as of January 28, 2026.

# USER

As a video web master, please analyze all these files (in ./video/wukong/) and create a cool HTML page:

1. Clarify the chronological timeline of video events

2. Identify the timestamps when player levels are upgraded.

3. demonstrate your (k2.5 agent's) powerful long-video understanding and web-page design capability.

Output results to ./yideo/wukong-result-video-web-master/

![](images/8112b5b48aa462db8b5b065596ccd2da7d11793af18c4b405112c2f2c5b76509.jpg)

![](images/f330111981a68c542c6c9d576164505f81bb953fc92361db6162f2db5a20a8b4.jpg)

![](images/089292e237dc07446d9bd6dd024e198ab4c54d7ceb2b4c01c32b23dc30cd7654.jpg)

![](images/ab8873a45dae8cd35a733245d992e7ff22735e9a63c49d6db15f7c7f8175d2c2.jpg)  
32Parts, 24Hours, 40G

![](images/f15064bd234a28244f2a8272b288c5430b4443063f184056dd290d42e6c757f3.jpg)

![](images/b339ed50396e8a4a7c4f888fa32bcc897bae58a3e5c17c42bc9211e0c337c166.jpg)

![](images/11864709ab602428b1d8259c2150752039b861b144e1e60dd06c3a9845301aae.jpg)

# THINK

<Think> The user wants me to analyze video files in \`./video/wukong/\` and create a cool HTML page that

1. Clarifies the chronological timeline of video events

2. Identifies timestamps when player levels are upgraded

3. Demonstrates my long-video understanding and web-page design capabilit

Let me first explore the directory to understand what files we're working with. </Think>

# SUMMARY

I'll analyze the video files in the specified directory and create HTML page. Let me start by exploring what we have.

# TOOL

ls -la ./video/wukong

# THINK

<Think> We have 32 video files totaling about 40GB! These are gameplay videos of "Black Myth: Wukong" - a Chinese action RPG. Let me check the file sizes:

\- Most files are 700MB - 2GB in size

\- Total is 40GB

According to the AGENTS.md, for large videos (≥2 5MB), I should use subagents in parallel. Each subagent should handle frame extraction and analysis independently.

Let me create a strategy:

1. Each video is quite large (all >25MB), so I'll use subagents for each

2. Each subagent will analyze one video for:

\- Timeline of events

\- Level up timestamps

\- Key moments/scenes

3. Then I'll aggregate the results and create an HTML page

Given the scale (32 large videos), I should spawn multiple subagents in parallel. Let me create subagents to analyze each video. </Think>

# SUMMARY

This is a massive project! 32 gameplay videos of "Black Myth: Wukong" (\~40GB total). I'll deploy a parallel analysis strategy using subagents for each video, then create a stunning HTML showcase.

# TOOL

<Create Subagent x 32>

# THINK

<Think> Good, I can see all the analysis files are created. Now let me extract some key video clips/GIFs from important moments across the videos. I'll select key boss fights and level-up moments to create short clips for the HTML page.

Let me:

1. Extract some key video clips using ffmpeg

2. Create the comprehensive HTML page

3. Let me first read a few analysis files to identify the best moments to extract. </Think>

# SUMMARY

Let me read some analysis files to identify the best moments for video clips, then extract them in parallel

# TOOL

<Read File x 32>

# THINK

<Think> Now I have a good understanding of the content. Let me extract some key video clips for the HTML page. I'll extract:

1. Prologue - Epic battle with Erlang Shen (0:05:40-0:06:10)

2. Chapter 1 boss fight - Black Wind King (0:27:00-0:27:30)

6. Final Chapter - Flying on Somersault Cloud (0:12:30-0:13:00)

Let me spawn subagents to extract these clips in parallel. </Think>

# SUMMARY

Now let me extract key video clips for the HTML showcase. I'll spawn subagents to create short clips from the most epic moments.

# TOOL

<Create Subagent x 9>

# THINK

<Think> I now have enough data. Let me also get a few more analysis files and then compile everything into a stunning HTML showcase. </Think>

# SUMMARY

Let me gather a few more key analysis files and then build the comprehensive HTML page.

# TOOL

<Build Frontend>

# SUB AGENT 32

.\*

# SUB AGENT 3

# SUB AGENT 2

# SUB AGENT 1

# MAIN AGENT

Analyze this Black Myth: Wukong gameplay video: ./video/wukong/01-25895506462\_Prologue.mp4 This is Video #01 - Prologue (320MB, \~5-8 minutes)

Save your analysis to:./video/wukong-result-video-web-master/analysis\_01.json

# THINK

<Think> The user wants me to analyze a Black Myth: Wukong gameplay video

Let me start by exploring the file and extracting frames.

# SUMMARY

I'll analyze this Black Myth: Wukong gameplay video. Let me start by checking the video and··· extracting key frames for analysis.

# TOOI

<Analyze Video> & <Extract Frames with FFMPEG> & <Read Media File x N>

![](images/7cfe94ffe6db776d8644fee4b7cba9c2057d5b62b481ae339645ca62ec7413bb.jpg)

![](images/d3cc5c650f93422cd53ae093f9781fe7f93f2d0be1083c180d4f0a3c363ae444.jpg)

# SUMMARY

\## Analysis Complete

I've successfully analyzed the Black Myth: Wukong Prologue video and created the structured analysis file.

\*\*Eiles Created:\*\*

\_ \*\*Analysis JSoN:\*\* /yideo/wukong-result-video-web-master/analysis 01.ison

\- \*\*Extracted Frames:\*\* 82 frames at "/yideo/wukong-result-video-web-master/frames 01/

# SUB AGENT 1

# MAIN AGENT

Extract a 10-second video clip from:

Source: ./video/wukong/01-25895506462\_Prologue.mp4

Time: 00:05:40 to 00:05:50

Output: ./video/wukong-result-video-web-master/clips/01\_prologue\_battle.mp4

Use ffmpeg to extract this clip with high quality. This shows the epic tutorial battle with Erlang Shen starting.

Command format

ffmpeg -ss 00:05:40 -t 10 -i ./video/wukong/01-25895506462\_Prologue.mp4 -c:v libx264 -crf 23 - preset fast -an ./video/wukong-result-video-web-master/clips/01\_prologue\_battle.mp4

Create the output directory first if needed.

# THINK

...<Think> The user wants me to extract a 10-second video clip from a specific video file using ffmpeg. Let me first create the output directory if it doesn't exist, then run the ffmpeg command to extract the clip. </Think>

# TOOL

<Extract Video Clip with FFMPEG>

![](images/c6b2421268142e252353e3c59bbca73004f6fe4f85c81e63470a35e7dfb90fee.jpg)

![](images/8a977f6e2b60270b9c40d0bb317fce0fe29249070a90c5b09e27551c46c2ac1c.jpg)

![](images/42f30e5c7a5e889008826642c079e103af9a305ea99c6f1add6ad9505d7545bb.jpg)

# THINK

The video clip was successfully extracted. Let me summarize the results for the main agent.

# SUMMARY

 \*\*Video clip extracted successfully!\*\*

\*\*Output file:\*\* \`./video/wukong-result-video-web-master/clips/01\_prologue\_battle.mp4\`

\*\*Clin details:\*\*

……

The 10-second clip showing the epic tutorial battle with Erlang Shen has been extracted with high quality settings (CRF 23, fast preset) and saved to the output directory.

# THINK

All tasks are complete. Let me provide a comprehensive summary to the user about what was accomplished.

# SUMMARY

\##  Analysis Complete! Black Myth: Wukong Journey Showcase

\### How to View

Open \`./video/wukong-result-video-web-master/index.html\` in a web browser to experience the full interactive showcase with embedded video clips, animated charts, and the complete chronological timeline of the epic Black Myth: Wukong journey!

Figure 11: Qualitative example of Kimi K2.5 analyzing a complete playthrough of Black Myth: Wukong (24 hours of continuous gameplay across 32 videos at 1080p) using parallel visual agents. See generated webpage and source videos (all rights reserved by source authors).

# USER

Please help the ant walk through the maze. Do not cross walls

![](images/c4264700b1715756be08564ced498efa45918d600160c356d68dea61fc5c5135.jpg)

# THINK

The user uploaded a maze image and asked me to help find a path from the start to the

end without crossing walls, using the ipython tool for assistance.

First, I need to examine the maze image to determine the start and end posit

There is an ant or insect character on the right, which is likely the end

The maze itself is an underground tunnel structure.

Let me use ipython to analyze this maze image and find the path.

Steps:

1. Analyze the maze structure (binarization, identify walls and paths).

# SUMMARY

The little bell on the left is the starting point, and the little ant on the right is the finish line. Now, let me convert the maze into a computable format and find the path:

# TOOL

<nython: Binarization aleorithm>

![](images/dc967036d4afd31b33872e37d3546f4826f92acfeb9da82392967be3fa555071.jpg)

# THINK

The binarization process worked well. Now I need to:

1. Manually mark the positions of the start (bell) and the end (ant).

2. Implement the BFS algorithm to find the path.

Based on the image:

1. The starting point (bell) is on the left, roughly around (50, 250)

2. The endpoint (ant) is on the right, roughly around (980, 450).

# SUMMARY

Now, let me determine the coordinates for the start and end points, and use the BFS (Breadth-First Search) algorithm to find the shortest path:

# TOOL

<python: Draw point and BFS>

![](images/cd63009a6a6767075fb3caddf81f7a65cc61205afc6c039940372d2ae886d237.jpg)

The path contains 3,288 points.

# THINK

Great! The path has been found, consisting of 3,288 points. Now I need to visualize it for the user. Let me create a colored path map and overlay the red path on the origina image.

# SUMMARY

The entire route consists of 3 288 stens. Now. let me plot the nath onto the maze:

# TOOL

<python: Draw path>

![](images/ff36ca81fbcc2119ea76bfb7286249fb96983e8263e0f97ecf940e2b4be939f5.jpg)

# THINK

Perfect! The path has been successfully found and visualized.

# SUMMARY

Final Path Characteristics

? Total Length: 3,288 pixels

? Route: Enters from the left → heads down → traverses right across the underground

maze → winds upward → reaches the exit on the righ

? Algorithm: BFS guarantees this is the shortest path with no backtracking.

? Constraints: Strictly followed the corridors with no wall-clipping.

The maze path is clearly marked in the image above; the red line represents the

walking route!

# USER

What is the total percentage of the green and blue areas?

![](images/1b2343b8b27dffb9183e90de8418ea31ae59f7adb4831a6278cba4906c0bf499.jpg)

# THINK

The user is asking for the total percentage of the green and blue areas in the image. The image shows a pie chart with three parts: Section 1 (Red), Section 2 (Blue), and Section 3 (Green).

Let me write code to

1. Load the image

2. Identify the colored sectors

3. Calculate the percentage of each color

4. Sum green and blue

Actually, since this is a simnle nie chart with distinct colors. I'll convert to Hsy color space for better color segmentation, then mask each color and calculate the pixe counts.

# SUMMARY

I’ll help you analyze the percentage of the green and blue areas in this pie chart.

# TOOL

<python: Sample color algorithm>

\# Convert to HSy for better color seementation

hsv = cv2.cvtColor(img, cv2.COLOR\_BGR2HSV)

\# Define color ranges for each section

![](images/938df2da30ef85a97953f1aaf07adb22889724ba60f6e7a49d494fdc8ddaff53.jpg)

<details>
<summary>text_image</summary>

RedPink Mask (Section 1)
Blue Mask (Section 2)
Green Mask (Section 3)
</details>

Total colored nixels: 61609

Red/Pink pixels: 26994

Blue pixels: 13752

Green pixels: 18032

Sum of all colors: 58778

# THINK

Good, I can see the masks are working but there's some discrepancy (58778 vs 61609 total pixels, probably due to black borders or anti-aliasing). Let me calculate the percentages based on the sum of the three detected colors, which should give us the relative proportions.

# TOOL

<python: Visualization Results>

\# Calculate percentages based on sum of detected colored pixels

total\_detected = red\_pixels + blue\_pixels + green\_pixel

red\_pct = (red\_pixels / total\_detected) \* 100

blue\_pct = (blue\_pixels / total\_detected) \* 100

green\_pct = (green\_pixels / total\_detected) \* 100

![](images/987807d28aee5dd4d2facb94943e084e702b46b856ba61e0bf989ed782fc98a3.jpg)

<details>
<summary>pie</summary>

| Section | Percentage |
| ------- | ---------- |
| Section 1 (Red) | 45.9% |
| Section 2 (Blue) | 23.4% |
| Section 3 (Green) | 30.7% |
</details>

Green + Blue   
54.1%

# THINK

Perfect! I've successfully analyzed the pie chart using image processing techniques. The results show:

Section 1 (Red/Pink): 45.9%

Section 2 (Blue): 23.4%

Section 3 (Green): 30.7

Total of Green + Blue = 54.1%

Given the standard pie chart proportions, this looks like roughly:

Red: \~46% (close to 50% or half)

Blue: \~23% (close to 25% or a quarter)

Green: \~31% (close to 30%)

So Green + Blue = \~54%, which is slightly more than half the pie chart

The analysis is complete and I've provided both the detailed breakdown and the final answer.

# SUMMARY

Based on the image analysis using Python, here are the results:

Individual Percentages:

Section 1 (Red/Pink): 45.9%

Section 2 (Blue): 23.4%

Section 3 (Green): 30.7%

Answe

54.1%

(Green 30.7% + Blue 23.4% = 54.1%)

This means the green and blue sections combined make up slightly more than half of TOOLthe entire pie chart.

# USER

Find the differences in th picture

![](images/5164ed1a90afbe4dd8cd0a63ce4b22b09f859abf4db16ab65af46b14ac738ad4.jpg)

![](images/2cc9aaf905990a80e990997fcbe60e58877d7bd87992523bd7c0c7a1c859b25c.jpg)

# THINK

This is a "Spot the Difference" game. The image shows the Flash the Sloth scene from Zootopia.

Task: Analyze the differences between the top and bottom images. I need to load the image for pixel-level difference analysis.

# SUMMARY

Now conducting a pixel-wise comparison to find all differences accurately:

# TOOL

<python: Difference map>

![](images/49a2fd756dfda0fa06a06eae08377967b9716b670cbbca042a1e9944ba108079.jpg)

![](images/fe59cce8e39281af710c5e0e6bf813dcca75df821cfb94c70f377874c111297e.jpg)

# THINK

Now I can see the obvious difference regions. Let me convert the contours into bounding boxes and normalize the coordinates to the original image dimensions.

# SUMMARY

Extracting bounding boxes from the detected differences and transforming them to normalized coordinates.

# TOOL

<python: Filter with threshold>

![](images/837ce9c7ed6df6927762f687a8648ca47ef61836c6236b9aeb4ab37f751a42e0.jpg)

![](images/6eb3383e96e0473cceb183a87ef1cf9c9571fc9c85aabba7878d4844f0aaaa4f.jpg)

# THINK

The automated detection identified 27 regions, but some may overlap or contain multiple differences. I will manually refine the primary points of interest based on visual observation and provide more precise coordinates.

# SUMMARY

27 change regions were auto-detected, though many overlap. Let me manually refine these into the 8 major differences and output more accurate coordinates.

# TOOL

<python: Filter main difference>

![](images/bc0d097e88148fc1e8ba891591186b551c1bfad7e0968e838fe8de80cc1fc83c.jpg)

# THINK

I have now identified all the differences and labeled their coordinates. Let me double check for any other obvious discrepancies.

Upon further comparison, I also noticed

The sloth's hair/fur is different (smoother in the top image, more frizzy in the bottom). There are subtle differences in the leaves of the background plants.

The paper next to the stamp on the desk.

However. the 10 main differences should cover the most prominent changes. 1et me summarize the final answer.

# SUMMARY

After a thorough comparative analysis, a total of 10 major differences have been identified

1. DMV vs EMV sign;

2. Calendar image variation;

3. Sloth expression: Closed vs Open mouth;

4. Nick's eye state: Squinting vs Open;

5. Judy's facial adjustments;

6. Crumpled paper vs Paper airplane;

8. Mug text change: 'YOU WA

10. File folder position/shape

Figure 12: Qualitative examples of Kimi K2.5 solving visual reasoning tasks via tool use.

# F Visualization

Figure 11 demonstrates our Agent Swarm tackling a challenging long-form video understanding task: analyzing a complete playthrough of Black Myth: Wukong (24 hours of continuous gameplay across 32 videos, totaling 40GB). The system employs a hierarchical multi-agent architecture where a Main Agent orchestrates parallel Sub Agents to process individual video segments independently. Each sub agent performs frame extraction, temporal event analysis, and key moment identification (e.g., boss fights, level-ups). The Main Agent subsequently aggregates these distributed analyses to synthesize a comprehensive HTML showcase featuring chronological timelines, embedded video clips, and interactive visualizations. This example demonstrates the system’s ability to handle massive-scale multimodal content through parallelization while maintaining coherent long-context understanding.

Figure 12 presents qualitative examples of Kimi K2.5 solving diverse visual reasoning tasks via tool-augmented reasoning. The model demonstrates: (1) Maze Solving—processing binary image segmentation and implementing pathfinding algorithms (BFS) to navigate complex mazes; (2) Pie Chart Analysis—performing pixel-level color segmentation and geometric calculations to determine precise area proportions; and (3) Spot-the-Difference—employing computer vision techniques to detect pixel-level discrepancies between image pairs. These examples highlight the model’s capability to decompose complex visual problems into executable code, iteratively refine strategies based on intermediate results, and synthesize precise answers through quantitative visual analysis.