---
title: "Kimi K2 - MinerU 原始转换(英文)"
source_pdf: pdfs/Kimi-K2.pdf
converted_by: MinerU (hybrid_auto)
arxiv: "2507.20534v2"
date: 2025-07
status: completed
---

# Kimi K2: Open Agentic Intelligence

>  **[返回 14.5-Kimi 家族总览](../../14.5-Kimi.md)**

![](images/figure_01_paper_header.jpg)


## Abstract

We introduce Kimi K2, a Mixture-of-Experts (MoE) large language model with 32 billion activated parameters and 1 trillion total parameters. We propose the MuonClip optimizer, which improves upon Muon with a novel QK-clip technique to address training instability while enjoying the advanced token efficiency of Muon. Based on MuonClip, K2 was pre-trained on 15.5 trillion tokens with zero loss spike. During post-training, K2 undergoes a multi-stage post-training process, highlighted by a large-scale agentic data synthesis pipeline and a joint reinforcement learning (RL) stage, where the model improves its capabilities through interactions with real and synthetic environments.

Kimi K2 achieves state-of-the-art performance among open-source non-thinking models, with strengths in agentic capabilities. Notably, K2 obtains 66.1 on Tau2-Bench, 76.5 on ACEBench (En), 65.8 on SWE-Bench Verified, and 47.3 on SWE-Bench Multilingual — surpassing most open and closed-sourced baselines in non-thinking settings. It also exhibits strong capabilities in coding, mathematics, and reasoning tasks, with a score of 53.7 on LiveCodeBench v6, 49.5 on AIME 2025, 75.1 on GPQA-Diamond, and 27.1 on OJBench, all without extended thinking. These results position Kimi K2 as one of the most capable open-source large language models to date, particularly in software engineering and agentic tasks. We release our base and post-trained model checkpoints1 to facilitate future research and applications of agentic intelligence.

![](images/figure_02_k2_main_results.jpg)
Figure 1: Kimi K2 main results.2

## 1 Introduction

The development of Large Language Models (LLMs) is undergoing a profound paradigm shift towards Agentic Intelligence – the capabilities for models to autonomously perceive, plan, reason, and act within complex and dynamic environments. This transition marks a departure from static imitation learning towards models that actively learn through interactions, acquire new skills beyond their training distribution, and adapt behavior through experiences [64]. It is believed that this approach allows an AI agent to go beyond the limitation of static human-generated data, and acquire superhuman capabilities through its own exploration and exploitation. Agentic intelligence is thus rapidly emerging as a defining capability for the next generation of foundation models, with wide-ranging implications across tool use, software development, and real-world autonomy.

Achieving agentic intelligence introduces challenges in both pre-training and post-training. Pre-training must endow models with broad general-purpose priors under constraints of limited high-quality data, elevating token efficiency—learning signal per token—as a critical scaling coefficient. Post-training must transform those priors into actionable behaviors, yet agentic capabilities such as multi-step reasoning, long-term planning, and tool use are rare in natural data and costly to scale. Scalable synthesis of structured, high-quality agentic trajectories, combined with general reinforcement learning (RL) techniques that incorporate preferences and self-critique, are essential to bridge this gap.

In this work, we introduce Kimi K2, a 1.04 trillion-parameter Mixture-of-Experts (MoE) LLM with 32 billion activated parameters, purposefully designed to address the core challenges and push the boundaries of agentic capability. Our contributions span both the pre-training and post-training frontiers:

• We present MuonClip, a novel optimizer that integrates the token-efficient Muon algorithm with a stabilityenhancing mechanism called QK-Clip. Using MuonClip, we successfully pre-trained Kimi K2 on 15.5 trillion tokens without a single loss spike.   
• We introduce a large-scale agentic data synthesis pipeline that systematically generates tool-use demonstrations via simulated and real-world environments. This system constructs diverse tools, agents, tasks, and trajectories to create high-fidelity, verifiably correct agentic interactions at scale.   
• We design a general reinforcement learning framework that combines verifiable rewards (RLVR) with a selfcritique rubric reward mechanism. The model learns not only from externally defined tasks but also from evaluating its own outputs, extending alignment from static into open-ended domains.

Kimi K2 demonstrates strong performance across a broad spectrum of agentic and frontier benchmarks. It achieves scores of 66.1 on Tau2-bench, 76.5 on ACEBench (en), 65.8 on SWE-bench Verified, and 47.3 on SWE-bench Multilingual, outperforming most open- and closed-weight baselines under non-thinking evaluation settings, closing the gap with Claude 4 Opus and Sonnet. In coding, mathematics, and broader STEM domains, Kimi K2 achieves 53.7 on LiveCodeBench v6, 27.1 on OJBench, 49.5 on AIME 2025, and 75.1 on GPQA-Diamond, further highlighting its capabilities in general tasks. On the LMSYS Arena leaderboard (July 17, 2025)3, Kimi K2 ranks as the top 1 open-source model and 5th overall based on over 3,000 user votes.

To spur further progress in Agentic Intelligence, we are open-sourcing our base and post-trained checkpoints, enabling the community to explore, refine, and deploy agentic intelligence at scale.

## 2 Pre-training

The base model of Kimi K2 is a trillion-parameter mixture-of-experts (MoE) transformer [73] model, pre-trained on 15.5 trillion high-quality tokens. Given the increasingly limited availability of high-quality human data, we posit that token efficiency is emerging as a critical coefficient in the scaling of large language models. To address this, we introduce a suite of pre-training techniques explicitly designed for maximizing token efficiency. Specifically, we employ the token-efficient Muon optimizer [34, 47] and mitigate its training instabilities through the introduction of QK-Clip. Additionally, we incorporate synthetic data generation to further squeeze the intelligence out of available high-quality tokens. The model architecture follows an ultra-sparse MoE with multi-head latent attention (MLA) similar to DeepSeek-V3 [11] , derived from empirical scaling law analysis. The underlying infrastructure is built to optimize both training efficiency and research efficiency.

### 2.1 MuonClip: Stable Training with Weight Clipping

We train Kimi K2 using the token-efficient Muon optimizer [34], incorporating weight decay and consistent update RMS scaling [47]. Experiments in our previous work Moonlight [47] show that, under the same compute budget and model size — and therefore the same amount of training data — Muon substantially outperforms AdamW [37, 49], making it an effective choice for improving token efficiency in large language model training.

Training instability when scaling Muon Despite its efficiency, scaling up Muon training reveals a challenge: training instability due to exploding attention logits, an issue that occurs more frequently with Muon but less with AdamW in our experiments. Existing mitigation strategies are insufficient. For instance, logit soft-cap [70] directly clips the attention logits, but the dot products between queries and keys can still grow excessively before capping is applied. On the other hand, Query-Key Normalization (QK-Norm) [12, 82] is not applicable to multi-head latent attention (MLA), because its Key matrices are not fully materialized during inference.

Taming Muon with QK-Clip To address this issue, we propose a novel weight-clipping mechanism QK-Clip to explicitly constrain attention logits. QK-Clip works by rescaling the query and key projection weights post-update to bound the growth of attention logits.

Let the input representation of a transformer layer be X. For each attention head $h ,$ its query, key, and value projections are computed as

$$
\mathbf {Q} ^ {h} = \mathbf {X} \mathbf {W} _ {q} ^ {h}, \quad \mathbf {K} ^ {h} = \mathbf {X} \mathbf {W} _ {k} ^ {h}, \quad \mathbf {V} ^ {h} = \mathbf {X} \mathbf {W} _ {v} ^ {h}.
$$

where ${ \mathbf W } _ { q } , { \mathbf W } _ { k } , { \mathbf W } _ { \nu }$ are model parameters. The attention output is:

$$
\mathbf {O} ^ {h} = \operatorname{softmax} \left(\frac {1}{\sqrt {d}} \mathbf {Q} ^ {h} \mathbf {K} ^ {h \top}\right) \mathbf {V} ^ {h}.
$$

We define the max logit, a per-head scalar, as the maximum input to softmax in this batch $B \colon$

$$
S _ {\max} ^ {h} = \frac {1}{\sqrt {d}} \max _ {\mathbf {X} \in B} \max _ {i, j} \mathbf {Q} _ {i} ^ {h} \mathbf {K} _ {j} ^ {h ^ {\top}}
$$

where $i , j$ are indices of different tokens in a training sample X.

The core idea of QK-Clip is to rescale $\mathbf { W } _ { k } , \mathbf { W } _ { q }$ whenever $S _ { \mathrm { m a x } } ^ { h }$ exceeds a target threshold τ. Importantly, this operation does not alter the forward/backward computation in the current step — we merely use the max logit as a guiding signal to determine the strength to control the weight growth.

A naïve implementation clips all heads at the same time:

$$
\mathbf {W} _ {q} ^ {h} \leftarrow \gamma^ {\alpha} \mathbf {W} _ {q} ^ {h} \qquad \mathbf {W} _ {k} ^ {h} \leftarrow \gamma^ {1 - \alpha} \mathbf {W} _ {k} ^ {h}
$$

where $\gamma = \operatorname* { m i n } ( 1 , \tau / S _ { \operatorname* { m a x } } )$ with $S _ { \operatorname* { m a x } } = \operatorname* { m a x } _ { h } S _ { \operatorname* { m a x } } ^ { h }$ , and α is a balancing parameter typically set to 0.5, applying equal scaling to queries and keys.

However, we observe that in practice, only a small subset of heads exhibit exploding logits. In order to minimize our intervention on model training, we determine a per-head scaling factor $\gamma _ { h } = \mathrm { { m i n } } ( 1 , \bar { \tau / } S _ { \mathrm { { m a x } } } ^ { h ^ { - } } )$ , and opt to apply per-head QK-Clip. Such clipping is straightforward for regular multi-head attention (MHA). For MLA, we apply clipping only on unshared attention head components:

• $\mathbf { q } ^ { C }$ and $\mathbf { k } ^ { C }$ (head-specific components): each scaled by $\sqrt { \gamma _ { h } }$   
• $\mathbf { q } ^ { R }$ (head-specific rotary): scaled by $\gamma _ { h }$ ,   
• $\mathbf { k } ^ { R }$ (shared rotary): left untouched to avoid effect across heads.

MuonClip: The New Optimizer We integrate Muon with weight decay, consistent RMS matching, and QK-Clip into a single optimizer, which we refer to as MuonClip (see Algorithm 1).

We demonstrate the effectiveness of MuonClip from several scaling experiments. First, we train a mid-scale 9B activated and 53B total parameters Mixture-of-Experts (MoE) model using the vanilla Muon. As shown in Figure 2 (Left), we observe that the maximum attention logits quickly exceed a magnitude of 1000, showing that attention logits explosion is already evident in Muon training to this scale. Max logits at this level usually result in instability during training, including significant loss spikes and occasional divergence.

Algorithm 1 MuonClip Optimizer   
1: for each training step t do
2:    // 1. Muon optimizer step
3:    for each weight $W \in R^{n \times m}$ do
4: $M_t = \mu M_{t-1} + G_t$ $\triangleright M_0 = 0$ , $G_t$ is the grad of $W_t$ , $\mu$ is momentum
5: $O_t = Newton-Schulz(M_t) \cdot \sqrt{\max(n, m)} \cdot 0.2$ $\triangleright$ Match Adam RMS
6: $W_t = W_{t-1} - \eta(O_t + \lambda W_{t-1})$ $\triangleright$ learning rate $\eta$ , weight decay $\lambda$ 7:    end for
8:    // 2. QK-Clip
9:    for each attention head h in every attention layer of the model do
10:    Obtain $S_{max}^h$ already computed during forward
11:    if $S_{max}^h > \tau$ then
12: $\gamma \leftarrow \tau / S_{max}^h$ 13: $W_{qc}^h \leftarrow W_{qc}^h \cdot \sqrt{\gamma}$ 14: $W_{kc}^h \leftarrow W_{kc}^h \cdot \sqrt{\gamma}$ 15: $W_{qr}^h \leftarrow W_{qr}^h \cdot \gamma$ 16:    end if
17:    end for
18: end for

![](images/figure_03_muon_logit_explosion_left.jpg)

<details>
<summary>line</summary>

| Training Steps | Max Logits |
| -------------- | ---------- |
| 0              | 0          |
| 2500           | 50         |
| 5000           | 100        |
| 7500           | 150        |
| 10000          | 200        |
| 12500          | 400        |
| 15000          | 800        |
| 16000          | 1200       |
</details>

![](images/figure_04_muonclip_k2_max_logits.jpg)

<details>
<summary>line</summary>

| Training Steps | Max Logits |
| -------------- | ---------- |
| 0              | 0          |
| 10000          | 100        |
| 50000          | 100        |
| 70000          | 80         |
| 100000         | 35         |
| 150000         | 30         |
| 200000         | 30         |
| 220000         | 30         |
</details>

Figure 2: Left: During a mid-scale training run, attention logits rapidly exceed 1000, which could lead to potential numerical instabilities and even training divergence. Right: Maximum logits for Kimi K2 with MuonClip and τ = 100 over the entire training run. The max logits rapidly increase to the capped value of 100, and only decay to a stable range after approximately 30% of the training steps, demonstrating the effective regulation effect of QK-Clip.

Next, we demonstrate that QK-Clip does not degrade model performance and confirm that the MuonClip optimizer preserves the optimization characteristics of Muon without adversely affecting the loss trajectory. A detailed discussion of the experiment designs and findings is provided in the Appendix D.

Finally, we train Kimi K2, a large-scale MoE model, using MuonClip with τ = 100 and monitor the maximum attention logits throughout the training run (Figure 2 (Right)). Initially, the logits are capped at 100 due to QK-Clip. Over the course of training, the maximum logits gradually decay to a typical operating range without requiring any adjustment to τ. Importantly, the training loss remains smooth and stable, with no observable spikes, as shown in Figure 3, validating that MuonClip provides robust and scalable control over attention dynamics in large-scale language model training.

### 2.2 Pre-training Data: Improving Token Utility with Rephrasing

Token efficiency in pre-training refers to how much performance improvement is achieved for each token consumed during training. Increasing token utility—the effective learning signal each token contributes—enhances the per-token impact on model updates, thereby directly improving token efficiency. This is particularly important when the supply of high-quality tokens is limited and must be maximally leveraged. A naive approach to increasing token utility is through repeated exposure to the same tokens, which can lead to overfitting and reduced generalization.

![](images/figure_05_training_loss_curve.jpg)

<details>
<summary>line</summary>

| Tokens (Trillion) | Loss  |
| ----------------- | ----- |
| 0                 | 2.0   |
| 2                 | 1.7   |
| 4                 | 1.6   |
| 6                 | 1.55  |
| 8                 | 1.5   |
| 10                | 1.45  |
| 12                | 1.4   |
| 14                | 1.35  |
| 16                | 1.3   |
</details>

Figure 3: Per-step training loss curve of Kimi K2, without smoothing or sub-sampling. It shows no spikes throughout the entire training process. Note that we omit the very beginning of training for clarity.

A key advancement in the pre-training data of Kimi K2 over Kimi K1.5 is the introduction of a synthetic data generation strategy to increase token utility. Specifically, a carefully designed rephrasing pipeline is employed to amplify the volume of high-quality tokens without inducing significant overfitting. In this report, we describe two domain-specialized rephrasing techniques—targeted respectively at the Knowledge and Mathematics domains—that enable this controlled data augmentation.

Knowledge Data Rephrasing Pre-training on natural, knowledge-intensive text presents a trade-off: a single epoch is insufficient for comprehensive knowledge absorption, while multi-epoch repetition yields diminishing returns and increases the risk of overfitting. To improve the token utility of high-quality knowledge tokens, we propose a synthetic rephrasing framework composed of the following key components:

• Style- and perspective-diverse prompting: Inspired by WRAP [50], we apply a range of carefully engineered prompts to enhance linguistic diversity while maintaining factual integrity. These prompts guide a large language model to generate faithful rephrasings of the original texts in varied styles and from different perspectives.   
• Chunk-wise autoregressive generation: To preserve global coherence and avoid information loss in long documents, we adopt a chunk-based autoregressive rewriting strategy. Texts are divided into segments, rephrased individually, and then stitched back together to form complete passages. This method mitigates implicit output length limitations that typically exist with LLMs. An overview of this pipeline is presented in Figure 4.   
• Fidelity verification: To ensure consistency between original and rewritten content, we perform fidelity checks that compare the semantic alignment of each rephrased passage with its source. This serves as an initial quality control step prior to training.

We compare data rephrasing with multi-epoch repetition by testing their corresponding accuracy on SimpleQA. We experiment with an early checkpoint of K2 and evaluate three training strategies: (1) repeating the original dataset for 10 epochs, (2) rephrasing the data once and repeating it for 10 epochs, and (3) rephrasing the data 10 times with a single training pass. As shown in Table 1, the accuracy consistently improves across these strategies, demonstrating the efficacy of our rephrasing-based augmentation. We extended this method to other large-scale knowledge corpora and observed similarly encouraging results, and each corpora is rephrased at most twice.

Table 1: SimpleQA Accuracy under three rephrasing-epoch configurations 

<table><tr><td># Rephrasings</td><td># Epochs</td><td>SimpleQA Accuracy</td></tr><tr><td>0 (raw wiki-text)</td><td>10</td><td>23.76</td></tr><tr><td>1</td><td>10</td><td>27.39</td></tr><tr><td>10</td><td>1</td><td>28.94</td></tr></table>

![](images/figure_06_chunk_rephrasing_pipeline.jpg)

<details>
<summary>flowchart</summary>

```mermaid
graph TD
    A["4096 tokens split"] --> B["full input excerpt"]
    A --> C["256 tokens split"]
    B --> D["+"]
    C --> E["+"]
    D --> F["+"]
    E --> G["+"]
    F --> H["+"]
    G --> I["+"]
    H --> J["+"]
    I --> K["+"]
    J --> L["+"]
    K --> M["+"]
    L --> N["+"]
    M --> O["+"]
    N --> P["+"]
    O --> Q["+"]
    P --> R["+"]
    Q --> S["+"]
    R --> T["+"]
    S --> U["+"]
    T --> V["+"]
    U --> W["+"]
    V --> X["+"]
    W --> Y["+"]
    X --> Z["+"]
    Y --> AA["+"]
    Z --> AB["+"]
    AA --> AC["+"]
    AB --> AD["+"]
    AC --> AE["+"]
    AD --> AF["+"]
    AE --> AG["+"]
    AF --> AH["+"]
    AG --> AI["+"]
    AH --> AJ["+"]
    AI --> AK["+"]
    AJ --> AL["+"]
    AK --> AM["+"]
    AL --> AN["+"]
    AM --> AO["+"]
    AN --> AP["+"]
    AO --> AQ["+"]
    AP --> AR["+"]
    AQ --> AS["+"]
    AR --> AT["+"]
    AS --> AU["+"]
    AT --> AV["+"]
    AU --> AW["+"]
    AV --> AX["+"]
    AW --> AY["+"]
    AX --> AZ["+"]
    AY --> BA["+"]
    AZ --> BB["+"]
    BA --> BC["+"]
    BB --> BD["+"]
    BC --> BE["+"]
    BD --> BF["+"]
    BE --> BG["+"]
    BF --> BH["+"]
    BG --> BI["+"]
    BH --> BJ["+"]
    BI --> BK["+"]
    BJ --> BL["+"]
    BK --> BM["+"]
    BL --> BN["+"]
    BM --> BO["+"]
    BN --> BP["+"]
    BO --> BQ["+"]
    BP --> BR["+"]
    BQ --> BS["+"]
    BR --> BT["+"]
    BS --> BU["+"]
    BT --> BV["+"]
    BU --> BW["+"]
    BV --> BX["+"]
    BW --> BY["+"]
    BX --> BZ["+"]
    BX --> BY["+"]
    BY --> BQ
    style A fill:#f9f,stroke:#333
    style B fill:#ccf,stroke:#333
    style C fill:#cfc,stroke:#333
    style D fill:#fcc,stroke:#333
    style E fill:#fcc,stroke:#333
    style F fill:#ffc,stroke:#333
    style G fill:#ffc,stroke:#333
    style H fill:#ffc,stroke:#333
    style I fill:#ffc,stroke:#333
    style J fill:#ffc,stroke:#333
    style K fill:#ffc,stroke:#333
    style L fill:#ffc,stroke:#333
    style M fill:#ffc,stroke:#333
    style N fill:#ffc,stroke:#333
    style O fill:#ffc,stroke:#333
    style P fill:#ffc,stroke:#333
    style Q fill:#ffc,stroke:#333
    style R fill:#ffc,stroke:#333
    style S fill:#ffc,stroke:#333
    style T fill:#ffc,stroke:#333
    style U fill:#ffc,stroke:#333
    style V fill:#ffc,stroke:#333
    style W fill:#ffc,stroke:#333
    style X fill:#ffc,stroke:#333
    style Y fill:#ffc,stroke:#333
    style Z fill:#ffc,stroke:#333
    style AA fill:#ffc,stroke:#333
    style AB fill:#ffc,stroke:#333
    style AC fill:#ffc,stroke:#333
    style AD fill:#ffc,stroke:#333
    style AE fill:#ffc,stroke:#333
    style AF fill:#ffc,stroke:#333
    style AG fill:#ffc,stroke:#333
    style AH fill:#ffc,stroke:#333
    style AI fill:#ffc,stroke:#333
    style AJ fill:#ffc,stroke:#333
    style AK fill:#ffc,stroke:#333
    style AL fill:#ffc,stroke:#333
    style AM fill:#ffc,stroke:#333
    style AN fill:#ffc,stroke:#333
    style AO fill:#ffc,stroke:#333
    style AP fill:#ffc,stroke:#333
    style AQ fill:#ffc,stroke:#333
    style AR fill:#ffc,stroke:#333
    style AS fill:#ffc,stroke:#333
    style AT fill:#ffc,stroke:#333
    style AU fill:#ffc,stroke:#333
    style AV fill:#ffc,stroke:#333
    style AW fill:#ffc,stroke:#333
    style AX fill:#ffc,stroke:#333
    style AY fill:#f9f,stroke:#333
    style AZ fill:#f9f,stroke:#333
    style BA fill:#f9f,stroke:#333
    style BB fill:#f9f,stroke:#333
    style BC fill:#f9f,stroke:#333
    style BD fill:#f9f,stroke:#333
    style BE fill:#f9f,stroke:#333
    style BF fill:#f9f,stroke:#333
    style BG fill:#f9f,stroke:#333
    style BH fill:#f9f,stroke:#333
    style BI fill:#f9f,stroke:#333
    style BJ fill:#f9f,stroke:#333
    style BK fill:#f9f,stroke:#333
    style BL fill:#f9f,stroke:#333
    style BM fill:#f9f,stroke:#333
    style BN fill:#f9f,stroke:#333
    style BO fill:#f9f,stroke:#333
    style BP fill:#f9f,stroke:#333
    style BQ fill:#ccf,stroke:#333
    style BRQ fill:#ccf,stroke:#333
    style CA fill:#ccf,stroke:#333
    style CB fill:#ccf,stroke:#333
    style CC fill:#ccf,stroke:#333
    style DD fill:#ccf,stroke:#333
    style EY fill:#ccf,stroke:#333
    style ZY fill:#ccf,stroke:#333
    style AAY fill:#ccf,stroke:#333
    style ABZ fill:#ccf,stroke:#333
    style ACY fill:#ccf,stroke:#333
    style ADZ fill:#ccf,stroke:#333
    style AEY fill:#ccf,stroke:#333
    style AFZ fill:#ccf,stroke:#333
    style BZY fill:#ccf,stroke:#333
    style YZY fill:#ccf,stroke:#333
    style ZYZ fill:#ccf,stroke:#333
    style AAZ fill:#ccf,stroke:#333
    style ABZ fill:#ccf,stroke:#333
    style ACZ fill:#ccf,stroke:#333
    style ADZ fill:#ccf,stroke:#333
    style AEY fill:#ccf,stroke:#333
    style AFY fill:#ccf,stroke:#333
    style ZYZ fill:#ccf,stroke:#333
    style YZY fill:#ccf,stroke:#333
    style ZYZ fill:#ccf,stroke:#333
    style AAZ fill:#ccf,stroke:#333
    style ABZ fill:#ccf,stroke:#333
    style ACZ fill:#ccf,stroke:#333
    style ADZ fill:#ccf,stroke:#�33
    style AEY fill:#ccf,stroke:#333
    style AFY fill:#ccf,stroke:#333
    style ZYZ fill:#ccf,stroke:#333
    style YZY fill:#ccf,stroke:#333
    style ZYZ fill:#ccf,stroke:#333
    style AAZ fill:#ccf,stroke:#333
    style AB2Z fill:#ccf,stroke:#333
    style ACZ fill:#ccf,stroke:#333
    style ADZ fill:#ccf,stroke:#333
    style AEY fill:#ccf,stroke:#333
    style AFY fill:#ccf,stroke:#333
    style ZYZ fill:#ccf,stroke:#333
    style YZY fill:#ccf,stroke#333
    style ZYZ fill:#ccf,stroke:#333
    style AAZ fill:#ccf,stroke:#333
    style ABZ fill:#ccf,stroke:#333
    style ACZ fill:#ccf,stroke:#333
    style ADZ fill:#ccf,stroke:#333
    style AEY fill:#ccf,stroke:#333
    style AFY | +1
    style ZYZ | +1
    style YZY | +1
    style ZYZ | +1
    style YZY | +1
    style ZYZ | +1
    style AAZ | +1
    style ABZ | +1
    style ACZ | +1
    style ADZ | +1
    style ZYZ | +1
    style YZY | +1
    style ZYZ | +1
    style AAZ | +1
    style ABZ | +1
    style ACZ | +1
    style ADZ | +1
    style ZYZ | +1
    style YZY | +1
    style ZYZ | +1
    style AAZ | +1
    note1["together as context"]
    note2["concat"]
    note3["auto-regressive"]
    note4["auto-regressive"]
    note5["auto-regressive"]
```
</details>

Figure 4: Auto-regressive chunk-wise rephrasing pipeline for long input excerpts. The input is split into smaller chunks with preserved context, rewritten sequentially, and then concatenated into a full rewritten passage.

Mathematics Data Rephrasing To enhance mathematical reasoning capabilities, we rewrite high-quality mathematical documents into a “learning-note” style, following the methodology introduced in SwallowMath [16]. In addition, we increased data diversity by translating high-quality mathematical materials from other languages into English.

Although initial experiments with rephrased subsets of our datasets show promising results, the use of synthetic data as a strategy for continued scaling remains an active area of investigation. Key challenges include generalizing the approach to diverse source domains without compromising factual accuracy, minimizing hallucinations and unintended toxicity, and ensuring scalability to large-scale datasets.

Pre-training Data Overall The Kimi K2 pre-training corpus comprises 15.5 trillion tokens of curated, high-quality data spanning four primary domains: Web Text, Code, Mathematics, and Knowledge. Most data processing pipelines follow the methodologies outlined in Kimi K1.5 [36]. For each domain, we performed rigorous correctness and quality validation and designed targeted data experiments to ensure the curated dataset achieved both high diversity and effectiveness.

### 2.3 Model Architecture

Kimi K2 is a 1.04 trillion-parameter Mixture-of-Experts (MoE) transformer model with 32 billion activated parameters. The architecture follows a similar design to DeepSeek-V3 [11] , employing Multi-head Latent Attention (MLA) [45] as the attention mechanism, with a model hidden dimension of 7168 and an MoE expert hidden dimension of 2048. Our scaling law analysis reveals that continued increases in sparsity yield substantial performance improvements, which motivated us to increase the number of experts to 384, compared to 256 in DeepSeek-V3. To reduce computational overhead during inference, we cut the number of attention heads to 64, as opposed to 128 in DeepSeek-V3. Table 2 presents a detailed comparison of architectural parameters between Kimi K2 and DeepSeek-V3.

Table 2: Architectural comparison between Kimi K2 and DeepSeek-V3 

<table><tr><td></td><td>DeepSeek-V3</td><td>Kimi K2</td><td> $\Delta$ </td></tr><tr><td>#Layers</td><td>61</td><td>61</td><td>=</td></tr><tr><td>Total Parameters</td><td>671B</td><td>1.04T</td><td> $\uparrow$ 54%</td></tr><tr><td>Activated Parameters</td><td>37B</td><td>32.6B</td><td> $\downarrow$ 13%</td></tr><tr><td>Experts (total)</td><td>256</td><td>384</td><td> $\uparrow$ 50%</td></tr><tr><td>Experts Active per Token</td><td>8</td><td>8</td><td>=</td></tr><tr><td>Shared Experts</td><td>1</td><td>1</td><td>=</td></tr><tr><td>Attention Heads</td><td>128</td><td>64</td><td> $\downarrow$ 50%</td></tr><tr><td>Number of Dense Layers</td><td>3</td><td>1</td><td> $\downarrow$ 67%</td></tr><tr><td>Expert Grouping</td><td>Yes</td><td>No</td><td>-</td></tr></table>

Sparsity Scaling Law We develop a sparsity scaling law tailored for the Mixture-of-Experts (MoE) model family using Muon. Sparsity is defined as the ratio of the total number of experts to the number of activated experts. Through carefully controlled small-scale experiments, we observe that — under a fixed number of activated parameters (i.e., constant FLOPs) — increasing the total number of experts (i.e., increasing sparsity) consistently lowers both the training and validation loss, thereby enhancing overall model performance (Figure 5). Concretely, under the compute-optimal sparsity scaling law, achieving the same validation loss of 1.5, sparsity 48 reduces FLOPs by 1.69×, 1.39×, and 1.15× compared to sparsity levels 8, 16, and 32, respectively. Though increasing sparsity leads to better performance, this gain comes with increased infrastructure complexity. To balance model performance with cost, we adopt a sparsity of 48 for Kimi K2, activating 8 out of 384 experts per forward pass.

![](images/figure_07_architecture_comparison_table.jpg)

<details>
<summary>line</summary>

| Training FLOPs | sparsity 8 | sparsity 16 | sparsity 32 | sparsity 48 | sparsity 64 |
| -------------- | ---------- | ----------- | ----------- | ----------- | ----------- |
| 10^20          | 1.75       | 1.80        | 1.70        | 1.75        | 1.70        |
| 10^20.5        | 1.65       | 1.68        | 1.60        | 1.65        | 1.60        |
| 10^21          | 1.45       | 1.40        | 1.35        | 1.40        | 1.35        |
</details>

Figure 5: Sparsity Scaling Law. Increasing sparsity leads to improved model performance. We fixed the number of activated experts to 8 and the number of shared experts to 1, and varied the total number of experts, resulting in models with different sparsity levels.

![](images/figure_08_sparsity_scaling_law.jpg)

<details>
<summary>line</summary>

| Training Tokens | 1.2e+20 FLOPs | 2.2e+20 FLOPs | 4.5e+20 FLOPs | 9.0e+20 FLOPs | models with number of attention heads equals to number of layers | counterparts with doubled attention heads |
| --------------- | ------------- | ------------- | ------------- | ------------- | ------------------------------------------------------------------ | ------------------------------------------ |
| 10^11           | 1.65          | 1.55          | 1.45          | 1.38          | 1.67                                                             | 1.40                                       |
</details>

Figure 6: Scaling curves for models with number of attention heads equals to number of layers and their counterparts with doubled attention heads. Doubling the number of attention heads leads to a reduction in validation loss of approximately 0.5% to 1.2%.

Number of Attention Heads DeepSeek-V3 [11] sets the number of attention heads to roughly twice the number of model layers to better utilize memory bandwidth and enhance computational efficiency. However, as the context length increases, doubling the number of attention heads leads to significant inference overhead, reducing efficiency at longer sequence lengths. This becomes a major limitation in agentic applications, where efficient long context processing is essential. For example, with a sequence length of 128k, increasing the number of attention heads from 64 to 128, while keeping the total expert count fixed at 384, leads to an 83% increase in inference FLOPs. To evaluate the impact of this design, we conduct controlled experiments comparing configurations where the number of attention heads equals the number of layers against those with double number of heads, under varying training FLOPs. Under iso-token training conditions, we observe that doubling the attention heads yields only modest improvements in validation loss (ranging from 0.5% to 1.2%) across different compute budgets (Figure 6). Given that sparsity 48 already offers strong performance, the marginal gains from doubling attention heads do not justify the inference cost. Therefore we choose to 64 attention heads.

### 2.4 Training Infrastructure

#### 2.4.1 Compute Cluster

Kimi K2 was trained on a cluster equipped with NVIDIA H800 GPUs. Each node in the H800 cluster contains 2 TB RAM and 8 GPUs connected by NVLink and NVSwitch within nodes. Across different nodes, 8×400 Gbps RoCE interconnects are utilized to facilitate communications.

#### 2.4.2 Parallelism for Model Scaling

Training of large language models often progresses under dynamic resource availability. Instead of optimizing one parallelism strategy that’s only applicable under specific amount of resources, we pursue a flexible strategy that allows Kimi K2 to be trained on any number of nodes that is a multiple of 32. Our strategy leverages a combination of 16-way

![](images/figure_09_attention_heads_scaling.jpg)

<details>
<summary>bar_stacked</summary>

| VPP + 1 warmup | Forward pass | Backward pass | PP communication | EP-D | EP-C | EP-D | EP-C | EP-D | EP-C | EP-D | EP-C | EP dispatch and combi... |
| -------------- | ------------ | ------------- | --------------- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ------------------------ |
| 1              | 2            | 3             | 4               | 1    | 2    | 3    | 4    | 5    | 6    | 7    | 8    | 9                        |
| 2              | 3            | 4             | 1               | 2    | 3    | 4    | 5    | 6    | 7    | 8    | 9    | 10                       |
| 3              | 4            | 1             | 2               | 3    | 4    | 5    | 6    | 7    | 8    | 9    | 10   | 11                       |
| 4              | 5            | 2             | 3               | 4    | 6    | 7    | 8    | 9    | 10   | 11   | 12   | 13                       |
| 5              | 6            | 3             | 4               | 7    | 8    | 9    | 10   | 11   | 12   | 13   | 14   | 15                       |
| 6              | 7            | 4             | 5               | 8    | 9    | 10   | 11   | 12   | 13   | 14   | 15   | 16                       |
| 7              | 8            | 5             | 6               | 9    | 10   | 11   | 12   | 13   | 14   | 15   | 16   | 17                       |
| 8              | 9            | 6             | 7               | 10   | 11   | 12   | 13   | 14   | 15   | 16   | 17   | 18                       |
</details>

Figure 7: Computation, communication and offloading overlapped in different PP phases.

Pipeline Parallelism (PP) with virtual stages [29, 54, 39, 58, 48, 22], 16-way Expert Parallelism (EP) [40], and ZeRO-1 Data Parallelism [61].

Under this setting, storing the model parameters in BF16 and their gradient accumulation buffer in FP32 requires approximately 6 TB of GPU memory, distributed over a model-parallel group of 256 GPUs. Placement of optimizer states depends on the training configurations. When the total number of training nodes is large, the optimizer states are distributed, reducing its per-device memory footprint to a negligible level. When the total number of training nodes is small (e.g., 32), we can offload some optimizer states to CPU.

This approach allows us to reuse an identical parallelism configuration for both small- and large-scale experiments, while letting each GPU hold approximately 30 GB of GPU memory for all states. The rest of the GPU memory are used for activations, as described in Sec. 2.4.3. Such a consistent design is important for research efficiency, as it simplifies the system and substantially accelerates experimental iteration.

EP communication overlap with interleaved 1F1B By increasing the number of warm-up micro-batches, we can overlap EP all-to-all communication with computation under the standard interleaved 1F1B schedule [22, 54]. In comparison, DualPipe [11] doubles the memory required for parameters and gradients, necessitating an increase in parallelism to compensate. Increasing PP introduces more bubbles, while increasing EP, as discussed below, incurs higher overhead. The additional costs are prohibitively high for training a large model with over 1 trillion parameters and thus we opted not to use DualPipe.

However, interleaved 1F1B splits the model into more stages, introducing non-trivial PP communication overhead. To mitigate this cost, we decouple the weight-gradient computation from each micro-batch’s backward pass and execute it in parallel with the corresponding PP communication. Consequently, all PP communications can be effectively overlapped except for the warm-up phase.

Smaller EP size To ensure full computation-communication overlap during the 1F1B stage, the reduced attention computation time in K2 (which has 64 attention heads compared to 128 heads in DeepSeek-V3) necessitates minimizing the time of EP operations. This is achieved by adopting the smallest feasible EP parallelization strategy, specifically EP = 16. Utilizing a smaller EP group also relaxes expert-balance constraints, allowing for near-optimal speed to be achieved without further tuning.

#### 2.4.3 Activation Reduction

After reserving space for parameters, gradient buffers, and optimizer states, the remaining GPU memory on each device is insufficient to hold the full MoE activations. To ensure the activation memory fits within the constraints, especially for the initial pipeline stages that accumulate the largest activations during the 1F1B warm-up phase, the following techniques are employed.

Selective recomputation Recomputation is applied to inexpensive, high-footprint stages, including LayerNorm, SwiGLU, and MLA up-projections [11]. Additionally, MoE down-projections are recomputed during training to further reduce activation memory. While optional, this recomputation maintains adequate GPU memory, preventing crashes caused by expert imbalance in early training stages.

FP8 storage for insensitive activations Inputs of MoE up-projections and SwiGLU are compressed to FP8-E4M3 in 1× 128 tiles with FP32 scales. Small-scale experiments show no measurable loss increase. Due to potential risks of performance degradation that we observed during preliminary study, we do not apply FP8 in computation.

Activation CPU offload All remaining activations are offloaded to CPU RAM. A copy engine is responsible for streaming the offload and onload, overlapping with both computation and communication kernels. During the 1F1B phase, we offload the forward activations of the previous micro-batch while prefetching the backward activations of the next. The warm-up and cool-down phases are handled similarly and the overall pattern is shown in Figure 7. Although offloading may slightly affect EP traffic due to PCIe traffic congestion, our tests show that EP communication remains fully overlapped.

### 2.5 Training recipe

We pre-trained the model with a 4,096-token context window using the MuonClip optimizer (Algorithm 1) and the WSD learning rate schedule [26], processing a total of 15.5T tokens. The first 10T tokens were trained with a constant learning rate of 2e-4 after a 500-step warm-up, followed by 5.5T tokens with a cosine decay from 2e-4 to 2e-5. Weight decay was set to 0.1 throughout, and the global batch size was held at 67M tokens. The overall training curve is shown in Figure 3.

Towards the end of pre-training, we conducted an annealing phase followed by a long-context activation stage. The batch size was kept constant at 67M tokens, while the learning rate was decayed from 2e-5 to 7e-6. In this phase, the model was trained on 400 billion tokens with a 4k sequence length, followed by an additional 60 billion tokens with a 32k sequence length. To extend the context window to 128k, we employed the YaRN method [56].

## 3 Post-Training

### 3.1 Supervised Fine-Tuning

We employ the Muon optimizer [34] in our post-training and recommend its use for fine-tuning with K2. This follows from the conclusion of our previous work [47] that a Muon-pre-trained checkpoint produces the best performance with Muon fine-tuning.

We construct a large-scale instruction-tuning dataset spanning diverse domains, guided by two core principles: maximizing prompt diversity and ensuring high response quality. To this end, we develop a suite of data generation pipelines tailored to different task domains, each utilizing a combination of human annotation, prompt engineering, and verification processes. We adopt K1.5 [36] and other in-house domain-specialized expert models to generate candidate responses for various tasks, followed by LLMs or human-based judges to perform automated quality evaluation and filtering. For agentic data, we create a data synthesis pipeline to teach models tool-use capabilities through multi-step, interactive reasoning.

#### 3.1.1 Large-Scale Agentic Data Synthesis for Tool Use Learning

A critical capability of modern LLM agents is their ability to autonomously use unfamiliar tools, interact with external environments, and iteratively refine their actions through reasoning, execution, and error correction. Agentic tool use capability is essential for solving complex, multi-step tasks that require dynamic interaction with real-world systems. Recent benchmarks such as ACEBench [7] and τ-bench [86] have highlighted the importance of comprehensive tool-use evaluation, while frameworks like ToolLLM [59] and ACEBench [7] have demonstrated the potential of teaching models to use thousands of tools effectively.

However, training such capabilities at scale presents a significant challenge: while real-world environments provide rich and authentic interaction signals, they are often difficult to construct at scale due to cost, complexity, privacy and accessibility constraints. Recent work on synthetic data generation (AgentInstruct [52]; Self-Instruct [76]; StableToolBench [21]; ZeroSearch [67]) has shown promising results in creating large-scale data without relying on real-world interactions. Building on these advances and inspired by ACEBench [7]’s comprehensive data synthesis framework, we developed a pipeline that simulates real-world tool-use scenarios at scale, enabling the generation of tens of thousands of diverse and high-quality training examples.

There are three stages in our data synthesis pipeline, depicted in Fig. 8.

• Tool spec generation: we first construct a large repository of tool specs from both real-world tools and LLMsynthetic tools;   
• Agent and task generation: for each tool-set sampled from the tool repository, we generate an agent to use the toolset and some corresponding tasks;   
• Trajectory generation: for each agent and task, we generate trajectories where the agent finishes the task by invoking tools.

![](images/figure_10_pp_overlap_pattern.jpg)

<details>
<summary>flowchart</summary>

```mermaid
graph TD
    A["Domains"] --> B["Applications"]
    B --> C["real-world tool specs"]
    B --> D["synthesized tool specs"]
    C --> E["Tool Repository"]
    D --> E
    E --> F["Agents"]
    F --> G["Tasks with rubrics"]
    G --> E
    H["MCP tools"] --> C
```
</details>

(a) Synthesizing tool specs, agents and tasks

![](images/figure_11_tool_synthesis_pipeline_a.jpg)

<details>
<summary>flowchart</summary>

```mermaid
graph TD
    A["User Agent"] -->|interaction| B["Agent"]
    B -->|observation| C["Tool Simulator"]
    B -->|call| C
    C -->|trajectories| D["Judge Agent"]
    D --> E["Filtered Data"]
    F["Task"] --> A
    G["Rubrics"] --> D
```
</details>

(b) Generating agent trajectories

Figure 8: Data synthesis pipeline for tool use. (a) Tool specs are from both real-world tools and LLMs; agents and tasks are the generated from the tool repo. (b) Multi-agent pipeline to generate and filter trajectories with tool calling.   
![](images/figure_12_tool_synthesis_pipeline_b.jpg)

<details>
<summary>scatter</summary>

| Category | t-SNE 1 | t-SNE 2 |
| -------- | ------- | ------- |
| databases | 10.2 | 1.5 |
| image-and-video-processing | 12.3 | 2.1 |
| cloud platforms | 11.8 | 1.9 |
| calendar-management | 13.5 | 2.3 |
| cryptocurrency | 14.1 | 2.5 |
| vector-databases | 15.0 | 2.7 |
| location-services | 16.2 | 2.9 |
| communication | 17.0 | 3.1 |
| shell-access | 18.5 | 3.3 |
| search | 19.0 | 3.5 |
| multimedia-processing | 20.5 | 3.7 |
| file-systems | 21.0 | 3.9 |
| web/scraping | 22.5 | 4.1 |
| ecommerce-and-retail | 23.0 | 4.3 |
| search | 24.5 | 4.5 |
| customer-data-platforms | 25.0 | 4.7 |
| app-automation | 26.5 | 4.9 |
| developer-tools | 27.0 | 5.1 |
| os-automation | 28.5 | 5.3 |
| health-and-wellness | 29.0 | 5.5 |
| virtualization | 30.5 | 5.7 |
| version-control | 31.0 | 5.9 |
| cloud storage | 32.5 | 6.1 |
| Research & Data | 33.0 | 6.3 |
| entertainment-and-media | 34.5 | 6.5 |
| other | 35.0 | 6.7 |
| games-and-gamification | 36.5 | 6.9 |
| AIGC | 37.0 | 7.1 |
| travel-and-transportation | 38.5 | 7.3 |
| note-taking | 39.0 | 7.5 |
| browser-automation | 40.5 | 7.7 |
| rag-systems | 41.0 | 7.9 |
| language-translation | 42.5 | 8.1 |
| social-media | 43.0 | 8.3 |
| security-and-ism | 44.5 | 8.5 |
| home-automation-and-rot | 45.0 | 8.7 |
| monitoring | 46.5 | 8.9 |
| aIGC | 47.0 | 9.1 |
| research-and-data | 48.5 | 9.3 |
| weather-services | 49.0 | 9.5 |
| art-and-culture | 50.5 | 9.7 |
| customer-support | 51.0 | 9.9 |
| blockchain | 52.5 | 10.1 |
| finance | 53.0 | 10.3 |
| knowledge-and-memory | 54.5 | 10.5 |
| speech-processing | 55.0 | 10.7 |
| marketing | 56.5 | 10.9 |
</details>

(a) t-SNE visualization of real MCP tools, colored by their original source categories

![](images/figure_13_tool_embeddings_tsne.jpg)

<details>
<summary>scatter</summary>

| Category                     | t-SNE 1 | t-SNE 2 |
| ---------------------------- | ------- | ------- |
| enterprise_business_infergience | 10      | 20      |
| transportation minus logistics  | 15      | 25      |
| iphone_android                 | 20      | 30      |
| smart_home                   | 25      | 35      |
| real_est Estate_property       | 30      | 40      |
| unknown                      | 35      | 45      |
| software_spgs                | 40      | 50      |
| legal_compliance              | 45      | 55      |
| education_skeaming           | 50      | 60      |
| robot_control                | 55      | 65      |
| agriculture_environmental      | 60      | 70      |
| healthcare_medical           | 65      | 75      |
| manufacturing_industrial_jet  | 70      | 80      |
| device_systems               | 75      | 85      |
| financial_training            | 80      | 90      |
| website_control              | 85      | 95      |
| gaming_entertainment         | 90      | 100     |
</details>

(b) t-SNE visualization of synthetic tools, colored by pre-defined domain categories   
Figure 9: t-SNE visualizations of tool embeddings. (a) Real-world MCP tools exhibit natural clustering based on their original source categories. (b) Synthetic tools are organized into pre-defined domain categories, providing systematic coverage of the tool space. Together, they ensure comprehensive representation across different tool functionalities.

Domain Evolution and Tool Generation. We construct a comprehensive tool repository through two complementary approaches. First, we directly fetch 3000+ real MCP (Model Context Protocol) tools from GitHub repositories, leveraging existing high-quality tool specs. Second, we systematically evolve [83] synthetic tools through a hierarchical domain generation process: we begin with key categories (e.g., financial trading, software applications, robot control), then evolve multiple specific application domains within each category. Specialized tools are then synthesized for each domain, with clear interfaces, descriptions, and operational semantics. This evolution process produces over 20,000 synthetic tools. Figure 9 visualizes the diversity of our tool collection through t-SNE embeddings, demonstrating that both MCP and synthetic tools cover complementary regions of the tool space.

Agent Diversification. We generate thousands of distinct agents by synthesizing various system prompts and equipping them with different combinations of tools from our repository. This creates a diverse population of agents with varied capabilities, areas of expertise, and behavioral patterns, ensuring a broad coverage of potential use cases.

Rubric-Based Task Generation. For each agent configuration, we generate tasks that range from simple to complex operations. Each task is paired with an explicit rubric that specifies success criteria, expected tool-use patterns, and evaluation checkpoints. This rubric-based approach ensures a consistent and objective evaluation of agent performance.

Multi-turn Trajectory Generation. We simulate realistic tool-use scenarios through several components:

• User Simulation: LLM-generated user personas with distinct communication styles and preferences engage in multi-turn dialogues with agents, creating naturalistic interaction patterns.

• Tool Execution Environment: A sophisticated tool simulator (functionally equivalent to a world model) executes tool calls and provides realistic feedback. The simulator maintains and updates state after each tool execution, enabling complex multi-step interactions with persistent effects. It introduces controlled stochasticity to produce varied outcomes including successes, partial failures, and edge cases.

Quality Evaluation and Filtering. An LLM-based judge evaluates each trajectory against the task rubrics. Only trajectories that meet the success criteria are retained for training, ensuring high-quality data while allowing natural variation in task-completion strategies.

Hybrid Approach with Real Execution Environments. While simulation provides scalability, we acknowledge the inherent limitation of simulation fidelity. To address this, we complement our simulated environments with real execution sandboxes for scenarios where authenticity is crucial, particularly in coding and software engineering tasks. These real sandboxes execute actual code, interact with genuine development environments, and provide ground-truth feedback through objective metrics such as test suite pass rates. This combination ensures that our models learn from both the diversity of simulated scenarios and the authenticity of real executions, significantly strengthening practical agent capabilities.

By leveraging this hybrid pipeline that combines scalable simulation with targeted real-world execution, we generate diverse, high-quality tool-use demonstrations that balance coverage and authenticity. The scale and automation of our synthetic data generation, coupled with the grounding provided by real execution environments, effectively implements large-scale rejection sampling [27, 88] through our quality filtering process. This high-quality synthetic data, when used for supervised fine-tuning, has demonstrated significant improvements in the model’s tool-use capabilities across a wide range of real-world applications.

### 3.2 Reinforcement Learning

Reinforcement learning (RL) is believed to have better token efficiency and generalization than SFT. Based on the work of K1.5 [36], we continue to scale RL in both task diversity and training FLOPs in K2. To support this, we develop a Gym-like extensible framework that facilitates RL across a wide range of scenarios. We extend the framework with a large number of tasks with verifiable rewards. For tasks that rely on subjective preferences, such as creative writing and open-ended question answering, we introduce a self-critic reward in which the model performs pairwise comparisons to judge its own outputs. This approach allows tasks from various domains to all benefit from the RL paradigm.

#### 3.2.1 Verifiable Rewards Gym

Math, STEM and Logical Tasks For math, stem and logical reasoning domains, our RL data preparation follows two key principles, diverse coverage and moderate difficulty.

Diverse Coverage. For math and stem tasks, we collect high-quality QA pairs using a combination of expert annotations, internal QA extraction pipelines, and open datasets [42, 53]. During the collection process, we leverage a tagging system to deliberately increase coverage of under-covered domains. For logical tasks, our dataset comprises a variety of formats, including structured data tasks (e.g., multi-hop tabular reasoning, cross-table aggregation) and logic puzzles (e.g., the 24-game, Sudoku, riddles, cryptarithms, and Morse-code decoding).

Moderate Difficulty. The RL prompt-set should be neither too easy nor too hard, both of which may produce little signal and reduce learning efficiency. We assess the difficulty of each problem using the SFT model’s pass@k accuracy and select only problems with moderate difficulty.

Complex Instruction Following Effective instruction following requires not only understanding explicit constraints but also navigating implicit requirements, handling edge cases, and maintaining consistency over extended dialogues. We address these challenges through a hybrid verification framework that combines automated verification with adversarial detection, coupled with a scalable curriculum generation pipeline. Our approach employs a dual-path system to ensure both precision and robustness:

Hybrid Rule Verification. We implement two verification mechanisms: (1) deterministic evaluation via code interpreters for instructions with verifiable outputs (e.g., length, style constraints), and (2) LLM-as-judge evaluation for instructions requiring nuanced understanding of constraints. To address potential adversarial behaviors where models might claim instruction fulfillment without actual compliance, we incorporate an additional hack-check layer that specifically detects such deceptive claims.

Multi-Source Instruction Generation. To construct our training data, we employ three distinct generation strategies to ensure comprehensive coverage: (1) expert-crafted complex conditional prompts and rubrics developed by our data team (2) agentic instruction augmentation inspired by AutoIF [13], and (3) a fine-tuned model specialized for generating additional instructions that probe specific failure modes or edge cases. This multipronged approach ensures both breadth and depth in instruction coverage.

Faithfulness Faithfulness is essential for an agentic model operating in scenarios such as multi-turn tool use, selfgenerated reasoning chains, and open-environment interactions. Inspired by the evaluation framework from FACTS Grounding [31], we train a sentence-level faithfulness judge model to perform automated verification. The judge is effective in detecting sentences that make a factual claim without supporting evidence in context. It serves as a reward model to enhance overall faithfulness performance.

Coding & Software Engineering To enhance our capability in tackling competition-level programming problems, we gather problems and their judges from both open-source datasets [28, 84] and synthetic sources. To ensure the diversity of the synthetic data and the correctness of reward signals, we incorporate high-quality human-written unit tests retrieved from pre-training data.

For software engineering tasks, we collect a vast amount of pull requests and issues from GitHub to build software development environment that consists of user prompts/issues and executable unit tests. This environment was built on a robust sandbox infrastructure, powered by Kubernetes for scalability and security. It supports over 10,000 concurrent sandbox instances with stable performance, making it ideal for both competitive coding and software engineering tasks.

Safety Our work to enhance the safety begins with a human-curated set of seed prompts, manually crafted to encompass prevalent risk categories such as violence, fraud, and discrimination.

To simulate sophisticated jailbreak attempts (e.g., role-playing, literary narratives, and academic discourse), we employ an automated prompt evolution pipeline with three key components:

• Attack Model: Iteratively generates adversarial prompts designed to elicit unsafe responses from the target LLM.   
• Target Model: Produces responses to these prompts, simulating potential vulnerabilities.   
• Judge Model: Evaluates the interaction to determine if the adversarial prompt successfully bypasses safety mechanisms.

Each interaction is assessed using a task-specific rubric, enabling the judge model to provide a binary success/failure label.

#### 3.2.2 Beyond Verification: Self-Critique Rubric Reward

To extend model alignment beyond tasks with verifiable reward, we introduce a framework for general reinforcement learning from self-critic feedbacks. This approach is designed to align LLMs with nuanced human preferences, including helpfulness, creativity, depth of reasoning, factuality, and safety, by extending the capabilities learned from verifiable scenarios to a broader range of subjective tasks. The framework operates using a Self-Critique Rubric Reward mechanism, where the model evaluates its own outputs to generate preference signals. To bootstrap K2 as a competent judge, we curated a mixture of open-source and in-house preference datasets and initialize its critic capability in the SFT stage.

Self-Critiqued Policy Optimization In the first core process of the learning loop, the K2 actor generates responses for general prompts that cover a wide range of use cases. The K2 critic then ranks all results by performing pairwise evaluations against a combination of rubrics, which incorporates both core rubrics (Appendix. F.1), which represent the fundamental values of our AI assistant that Kimi cherish, prescriptive rubrics (Appendix. F.2) that aim to eliminate reward hacking, and human-annotated rubrics crafted by our data team for specific instructional contexts. Although certain rubrics can be designated as mandatory, K2 retains the flexibility to weigh them against its internal priors. This capacity enables a dynamic and continuous alignment with its evolving on-policy behavior, ensuring that the model’s responses remain coherent with its core identity while adapting to specific instructions.

Closed-Loop Critic Refinement and Alignment During RL training, the critic model is refined using verifiable signals. On-policy rollouts generated from verifiable-reward prompts are used to continuously update the critic, a crucial step that distills objective performance signals from RLVR directly into its evaluation model. This transfer learning process grounds its more subjective judgments in verifiable data, allowing the performance gains from verifiable tasks to enhance the critic’s judgment on complex tasks that lack explicit reward signals. This closed-loop process ensures that the critic continuously recalibrates its evaluation standards in lockstep with the policy’s evolution. By grounding subjective evaluation in verifiable data, the framework enables robust and scalable alignment with complex, non-verifiable human objectives.

Consequently, this holistic alignment yields comprehensive performance improvements across a wide spectrum of domains, including user intent understanding, creative writing, complex reasoning, and nuanced language comprehension.

#### 3.2.3 RL Algorithm

We adopt the policy optimization algorithm introduced in K1.5 [36] as the foundation for K2. For each problem x, we sample K responses $\{ y _ { 1 } , \ldots , y _ { k } \}$ from the previous policy $\pi _ { \mathrm { o l d } }$ , and optimize the model $\pi _ { \theta }$ with respect to the following objective:

$$
L _ {\mathrm{RL}} (\boldsymbol {\theta}) = \mathbb {E} _ {x \sim \mathcal {D}} \left[ \frac {1}{K} \sum_ {i = 1} ^ {K} \left[ \left(r (x, y _ {i}) - \bar {r} (x) - \tau \log \frac {\pi_ {\boldsymbol {\theta}} (y _ {i} | x)}{\pi_ {\mathrm{old}} (y _ {i} | x)}\right) ^ {2} \right] \right],
$$

where $\begin{array} { r } { \bar { r } ( x ) = \frac { 1 } { k } \sum _ { i = 1 } ^ { k } r ( x , y _ { i } ) } \end{array}$ is the mean rewards of the sampled responses, $\tau > 0$ is a regularization parameter that promotes stable learning. As in SFT, we employ the Muon optimizer [34] to minimize this objective. As we scale RL training to encompass a broader range of tasks in K2, a primary challenge is achieving consistent performance improvements across all domains. To address this, we introduce several additions to the RL algorithm.

Budget Control It has been widely observed that RL often results in a substantial increase in the length of modelgenerated responses [36, 20]. While longer responses can enable the model to utilize additional test-time compute for improved performance on complex reasoning tasks, the benefits often do not justify its inference cost in non-reasoning domains. To encourage the model to properly distribute inference budget, we enforce a per-sample maximum token budget throughout RL training, where the budget is determined based on the type of task. Responses that exceed this token budget are truncated and assigned a penalty, which incentivizes the model to generate solutions within the specified limit. Empirically, this approach significantly enhances the model’s token efficiency, encouraging concise yet effective solutions across all domains.

PTX Loss To prevent the potential forgetting of valuable, high-quality data during joint RL training, we curate a dataset comprising hand-selected, high-quality samples and integrate it into the RL objective through an auxiliary PTX loss [55]. This strategy not only leverages the advantages of high-quality data, but also mitigates the risk of overfitting to the limited set of tasks explicitly present in the training regime. This augmentation substantially improves the model’s generalization across a broader range of domains.

Temperature Decay For tasks such as creative writing and complex reasoning, we find that promoting exploration via a high sampling temperature during the initial stages of training is crucial. A high temperature allow the model to generate diverse and innovative responses, thereby facilitating the discovery of effective strategies and reducing the risk of premature convergence to suboptimal solutions. However, retaining a high temperature in the later stages of training or during evaluation can be detrimental, as it introduces excessive randomness and compromises the reliability and consistency of the model’s outputs. To address this, we employ a temperature decay schedule, to shift from exploration to exploitation throughout the training. This strategy ensures that the model leverages exploration when it is most beneficial, while ultimately converge on stable and high-quality outputs.

### 3.3 RL Infrastructure

#### 3.3.1 Colocated Architecture

Similar to K1.5 [36], we adopt a hybrid colocated architecture for our synchronized RL training, where the training and inference engines live on the same workers. When one engine is actively working, the other engine releases or offloads its GPU resources to accommodate. In each iteration of RL training, a centralized controller first calls the inference engine to generate new data for training. It then notifies the training engine to train on the new data, and send updated parameters to the inference engine for the next iteration.

Each engine is heavily optimized for throughput. In addition, as the model scales to the size of $\mathrm { K } 2 ,$ , the latency of engine switching and failure recovery becomes significant. We present our system design considerations in these aspects.

![](images/figure_14_checkpoint_engine_update.jpg)

<details>
<summary>flowchart</summary>

```mermaid
graph TD
    pod --> checkpoint["checkpoint engine"]
    pod --> inference["inference"]
    checkpoint --> ckpt1["ckpt"]
    checkpoint --> ckpt2["ckpt"]
    ckpt1 --> inference1["inference"]
    ckpt2 --> inference2["inference"]
    ckpt1 <--> ckpt2
    subgraph pod
        train1["train"]
        train2["train"]
    end
    subgraph checkpoint
        ckpt1
        ckpt2
    end
    subgraph inference
        inference1["inference"]
        inference2["inference"]
    end
    subgraph broadcast
        ckpt1
        ckpt2
    end
    subgraph pod
        pod1
        pod2
    end
```
</details>

Figure 10: Parameter update utilizing a checkpoint engine

#### 3.3.2 Efficient Engine Switching

During rollout, the parameters of the training engine are offloaded to DRAM. Bringing up the training engine is therefore a simple step of H2D transmission. However, bringing up the inference engine is a bigger challenge, as it must obtain updated parameters from the training engine with a different sharding paradigm.

Given the scale of K2 and the vast number of devices involved, using a network file system for resharding and broadcasting parameters is impractical. The aggregate bandwidth required to keep overhead low reaches several petabytes per second. To address this challenge, we developed a distributed checkpoint engine co-located on training nodes to manage parameter states. To perform a parameter update, each checkpoint engine worker obtains a local copy of parameters from the training engine, then broadcasts the full parameter set across all checkpoint engine workers. Subsequently, the inference engine retrieves only the parameter shard it requires from the checkpoint engine. This process is illustrated in Figure 10. To enable this for a 1T model, updates are performed parameter-by-parameter in a pipelined manner, minimizing memory footprint (see Appendix G).

We opt to broadcast the full parameter set across the entire cluster, regardless of the specific sharding schemes on each inference worker. While this transfers several times more data than a theoretically optimal approach, it offers a simpler system design that is less intrusive to the training and inference engines. We chose to trade off this minor overhead to fully decouple the training engine and the inference engine, significantly simplifying maintenance and testing.

Notably, this approach outperforms the transfer-what-you-need method due to reduced synchronization overhead and higher network bandwidth utilization. Our system can complete a full parameter update for Kimi K2 with less than 30 seconds, a negligible duration for a typical RL training iteration. The source code for the checkpoint engine is available on Github4.

#### 3.3.3 Efficient System Startup

As large-scale training is prone to system failure, optimizing the startup time is crucial for models as large as Kimi K2.

To start the training engine, we let each training worker selectively read part or none of the parameters from disk, and broadcast necessary parameters to its peers. The design goal is to ensure all workers collectively read the checkpoint only once, minimizing expensive disk IO.

As the inference engines are independent replicas, we would like to avoid introducing extra synchronization barriers between them. Therefore, we opt to reuse checkpoint engine for startup: we let checkpoint engine collectively read the checkpoint from disk, similar to how the training engine starts. Then it updates the state of the uninitialized inference engine, using the approach introduced in the previous section. By leveraging the dedicated checkpoint engine, the system also becomes robust to single-point failures, because an inference replica can restart without communicating with other replicas.

#### 3.3.4 Agentic Rollout

Our RL infrastructure supports the training of long-horizon, multi-turn agentic tasks. During rollout, these tasks present distinct challenges, such as complex environmental interactions and prolonged rollout durations. Here we introduce a few optimizations to alleviate these issues.

Due to the diversity of environments, certain interactions may be blocked on waiting for environment feedback (e.g., a virtual machine or a code interpreter), leaving the GPUs idle. We employ two strategies to maximize GPU utilization: (i) we deploy heavy environments as dedicated services that can scale up more easily; (ii) we employ a large number of concurrent rollouts to amortize the latency induced by certain expensive interactions.

Another challenge in agentic rollout is that individual rollout trajectories can be extremely long. To prevent long-tail trajectories from blocking the entire rollout process, we employ the partial rollout [36] technique. This strategy allows long-tail unfinished tasks to be paused, and resumed in the next RL iteration.

To improve research efficiency, we also design a unified interface inspired by the OpenAI Gym framework [5] to streamline the integration of new environments. We hope to scale our RL infrastructure to more diverse interactive environments in the future.

## 4 Evaluations

This section begins with the post-training evaluation of Kimi-K2-Instruct, followed by a brief overview of the capabilities of Kimi-K2-Base. We conclude with a comprehensive safety evaluation.

### 4.1 Post-training Evaluations

#### 4.1.1 Evaluation Settings

Benchmarks We assess Kimi-K2-Instruct across different areas. For coding, we adopt LiveCodeBench v6 [32](questions from August 2024 to May 2025), OJBench [78], MultiPL-E [6], SWE-bench Verified [33, 85], TerminalBench [72], Multi-SWE-bench [87], SWE-Lancer [51], PaperBench [66], and Aider-Polyglot [17]. For tool use tasks, we evaluate performance on τ2-Bench [3] and AceBench [7], which emphasize multi-turn tool-calling capabilities. In reasoning, we include a wide range of mathematical, science and logical tasks: AIME 2024/2025, MATH-500, HMMT 2025, CNMO 2024, PolyMath-en, ZebraLogic [44], AutoLogi [92], GPQA-Diamond [62], SuperGPQA [14], and Humanity’s Last Exam (Text-Only) [57]. We benchmark the long-context capabilities on: MRCR5 for long-context retrieval, and DROP [15], FRAMES [38] and LongBench v2 [2] for long-context reasoning. For factuality, we evaluate FACTS Grounding [31], the Vectara Hallucination Leaderboard [74], and FaithJudge [69]. Finally, general capabilities are assessed using MMLU [24], MMLU-Redux [18], MMLU-Pro [77], IFEval [91], Multi-Challenge [65], SimpleQA [79], and LiveBench [81] (as of 2024-11-25).

Baselines We benchmark against both open-source and proprietary frontier models, ensuring every candidate is evaluated under its non-thinking configuration to eliminate additional gains from test-time compute. Open-source baselines: DeepSeek-V3-0324 and Qwen3-235B-A22B, with the latter run in the vendor-recommended no-thinking regime. Proprietary baselines: Claude Sonnet 4, Claude Opus 4, GPT-4.1, and Gemini 2.5 Flash Preview (2025-05-20). Each invoked in its respective non-thinking mode via official APIs under unified temperature and top-p settings.

Evaluation Configurations All runs query models in their non-thinking mode. Output token length is capped at 8192 tokens everywhere except SWE-bench Verified (Agentless), which is raised to 16384. For benchmarks with high per-question variance, we adopt repeated sampling k times and average the results to obtain stable scores, denoted as Avg@k. For long-context tasks, we set the context window size to 128K tokens during evaluation, truncating any input that exceeds this limit to fit within the window. SWE-bench Verified is evaluated in two modes: Agentless Coding via Single Patch without Test (Acc) and Agentic Coding via bash/editor tools under both Single Attempt (Acc) and Multiple Attempts (Acc) using best-of-N selection with an internal verifier; SWE-bench Multilingual is tested only in the single-attempt agentic setting. Some data points have been omitted due to prohibitively expensive evaluation costs.

#### 4.1.2 Evaluation Results

A comprehensive evaluation results of Kimi-K2-Instruct is shown in Table 3, with detailed explanation provided in the Appendix C. Below, we highlight key results across four core domains:

Agentic and Competitive Coding Kimi-K2-Instruct demonstrates state-of-the-art open-source performance on real-world SWE tasks. It outperforms most baselines on SWE-bench Verified (65.8%, 71.6% with multiple attemps), SWE-bench Multilingual (47.3%), and SWE-lancer (39.1%), significantly closing the gap with Claude 4 Opus and Sonnet. On competitive coding benchmarks (e.g., LiveCodeBench v6 53.7%, OJBench 27.1%), it also leads among all models, highlighting its practical coding proficiency across difficulty levels.

Table 3: Performance comparison of Kimi-K2-Instruct against leading open-source and proprietary models across diverse tasks. Bold denotes the global SOTA; underlined bold indicates the best open-source result. Data points marked with \* are taken directly from the model’s technical report or blog. 

<table><tr><td rowspan="2">Benchmark</td><td colspan="3">Open Source</td><td colspan="4">Proprietary</td></tr><tr><td>Kimi-K2-Instruct</td><td>DeepSeek-V3-0324</td><td>Qwen3-235B-A22B</td><td>Claude Sonnet 4</td><td>Claude Opus 4</td><td>GPT-4.1</td><td>Gemini 2.5 Flash</td></tr><tr><td colspan="8">Coding Tasks</td></tr><tr><td>LiveCodeBench v6 (Pass@1)</td><td>53.7</td><td>46.9</td><td>37.0</td><td>48.5</td><td>47.4</td><td>44.7</td><td>44.7</td></tr><tr><td>OJBench (Pass@1)</td><td>27.1</td><td>24.0</td><td>11.3</td><td>15.3</td><td>19.6</td><td>19.5</td><td>19.5</td></tr><tr><td>MultiPL-E (Pass@1)</td><td>85.7</td><td>83.1</td><td>78.2</td><td>88.6</td><td>89.6</td><td>86.7</td><td>85.6</td></tr><tr><td>SWE-bench Verified Agentless-Single-Patch (Pass@1)</td><td>51.8</td><td>36.6</td><td>39.4</td><td>50.2</td><td>53.0</td><td>40.8</td><td>32.6</td></tr><tr><td>SWE-bench Verified Agentic-Single-Attempt (Pass@1)</td><td>65.8</td><td>38.8</td><td>34.4</td><td>72.7*</td><td>72.5*</td><td>54.6</td><td>—</td></tr><tr><td>SWE-bench Verified Agentic-Multi-Attempt (Pass@1)</td><td>71.6</td><td>—</td><td>—</td><td>80.2*</td><td>79.4*</td><td>—</td><td>—</td></tr><tr><td>SWE-bench Multilingual (Pass@1)</td><td>47.3</td><td>25.8</td><td>20.9</td><td>51.0</td><td>—</td><td>31.5</td><td>—</td></tr><tr><td>Multi-SWE-bench (Pass@1)</td><td>18.3</td><td>8.0</td><td>9.0</td><td>29.2</td><td>—</td><td>11.7</td><td>14.0</td></tr><tr><td>SWE-Lancer (Pass@1)</td><td>39.1</td><td>30.5</td><td>24.1</td><td>40.8</td><td>—</td><td>23.0</td><td>38.5</td></tr><tr><td>Paper Bench Code-Dev (Acc.)</td><td>27.8</td><td>12.2</td><td>13.2</td><td>43.3</td><td>—</td><td>29.9</td><td>5.7</td></tr><tr><td>Terminal Bench In-House (Acc.)</td><td>30.0</td><td>—</td><td>—</td><td>35.5</td><td>43.2</td><td>8.3</td><td>—</td></tr><tr><td>Terminal Bench Terminus (Acc.)</td><td>25.0</td><td>16.3</td><td>6.6</td><td>—</td><td>—</td><td>30.3</td><td>16.8</td></tr><tr><td>Aider-Polyglot (Acc.)</td><td>60.0</td><td>55.1</td><td>61.8</td><td>56.4</td><td>70.7</td><td>52.4</td><td>44.0</td></tr><tr><td colspan="8">Tool Use Tasks</td></tr><tr><td>Tau2 retail (Avg@4)</td><td>70.6</td><td>69.1</td><td>57.0</td><td>75.0</td><td>81.8</td><td>74.8</td><td>64.3</td></tr><tr><td>Tau2 airline (Avg@4)</td><td>56.5</td><td>39.0</td><td>26.5</td><td>55.5</td><td>60.0</td><td>54.5</td><td>42.5</td></tr><tr><td>Tau2 telecom (Avg@4)</td><td>65.8</td><td>32.5</td><td>22.1</td><td>45.2</td><td>57.0</td><td>38.6</td><td>16.9</td></tr><tr><td>AceBench (Acc.)</td><td>76.5</td><td>72.7</td><td>70.5</td><td>76.2</td><td>75.6</td><td>80.1</td><td>74.5</td></tr><tr><td colspan="8">Math &amp; STEM Tasks</td></tr><tr><td>AIME 2024 (Avg@64)</td><td>69.6</td><td>59.4*</td><td>40.1*</td><td>43.4</td><td>48.2</td><td>46.5</td><td>61.3</td></tr><tr><td>AIME 2025 (Avg@64)</td><td>49.5</td><td>46.7</td><td>24.7*</td><td>33.1*</td><td>33.9*</td><td>37.0</td><td>46.6</td></tr><tr><td>MATH-500 (Acc.)</td><td>97.4</td><td>94.0*</td><td>91.2*</td><td>94.0</td><td>94.4</td><td>92.4</td><td>95.4</td></tr><tr><td>HMMT 2025 (Avg@32)</td><td>38.8</td><td>27.5</td><td>11.9</td><td>15.9</td><td>15.9</td><td>19.4</td><td>34.7</td></tr><tr><td>CNMO 2024 (Avg@16)</td><td>74.3</td><td>74.7</td><td>48.6</td><td>60.4</td><td>57.6</td><td>56.6</td><td>75.0</td></tr><tr><td>PolyMath-en (Avg@4)</td><td>65.1</td><td>59.5</td><td>51.9</td><td>52.8</td><td>49.8</td><td>54.0</td><td>49.9</td></tr><tr><td>ZebraLogic (Acc.)</td><td>89.0</td><td>84.0</td><td>37.7*</td><td>79.7</td><td>59.3</td><td>58.5</td><td>57.9</td></tr><tr><td>AutoLogi (Acc.)</td><td>89.5</td><td>88.9</td><td>83.3*</td><td>89.8</td><td>86.1</td><td>88.2</td><td>84.1</td></tr><tr><td>GPQA-Diamond (Avg@8)</td><td>75.1</td><td>68.4*</td><td>62.9*</td><td>70.0*</td><td>74.9*</td><td>66.3</td><td>68.2</td></tr><tr><td>SuperGPQA (Acc.)</td><td>57.2</td><td>53.7</td><td>50.2</td><td>55.7</td><td>56.5</td><td>50.8</td><td>49.6</td></tr><tr><td>Humanity&#x27;s Last Exam (Acc.)</td><td>4.7</td><td>5.2</td><td>5.7</td><td>5.8</td><td>7.1</td><td>3.7</td><td>5.6</td></tr><tr><td colspan="8">General Tasks</td></tr><tr><td>MMLU (EM)</td><td>89.5</td><td>89.4</td><td>87.0</td><td>91.5</td><td>92.9</td><td>90.4</td><td>90.1</td></tr><tr><td>MMLU-Redux (EM)</td><td>92.7</td><td>90.5</td><td>89.2*</td><td>93.6</td><td>94.2</td><td>92.4</td><td>90.6</td></tr><tr><td>MMLU-Pro (EM)</td><td>81.1</td><td>81.2*</td><td>77.3</td><td>83.7</td><td>86.6</td><td>81.8</td><td>79.4</td></tr><tr><td>IFEval (Prompt Strict)</td><td>89.8</td><td>81.1</td><td>83.2*</td><td>87.6</td><td>87.4</td><td>88.0</td><td>84.3</td></tr><tr><td>Multi-Challenge (Acc.)</td><td>54.1</td><td>31.4</td><td>34.0</td><td>46.8</td><td>49.0</td><td>36.4</td><td>39.5</td></tr><tr><td>SimpleQA (Correct)</td><td>31.0</td><td>27.7</td><td>13.2</td><td>15.9</td><td>22.8</td><td>42.3</td><td>23.3</td></tr><tr><td>Livebench (Pass@1)</td><td>76.4</td><td>72.4</td><td>67.6</td><td>74.8</td><td>74.6</td><td>69.8</td><td>67.8</td></tr><tr><td>Arena Hard v2.0</td><td>54.5</td><td>39.9</td><td>39.9</td><td>51.6</td><td>59.7</td><td>51.7</td><td>48.7</td></tr><tr><td>Hard Prompt (Win rate)</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr><tr><td>Arena Hard v2.0</td><td>85.0</td><td>59.3</td><td>59.8</td><td>54.6</td><td>68.5</td><td>61.5</td><td>72.8</td></tr><tr><td>Creative Writing (Win rate)</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr><tr><td>FACTS Grounding (Adjusted)</td><td>88.5</td><td>68.3</td><td>68.5</td><td>83.6</td><td>—</td><td>79.2</td><td>86.6</td></tr><tr><td>HHEM v2.1 (1-Hallu.)</td><td>98.9</td><td>88.9</td><td>94.5</td><td>94.5</td><td>—</td><td>96.7</td><td>97.8</td></tr><tr><td>FaithJudge (1-Hallu.)</td><td>92.6</td><td>83.4</td><td>75.7</td><td>83.0</td><td>—</td><td>91.0</td><td>93.2</td></tr><tr><td>LongBench v2 (Acc.)</td><td>49.1</td><td>51.1</td><td>—</td><td>52.5</td><td>—</td><td>54.3</td><td>55.5</td></tr><tr><td>FRAMES (Acc.)</td><td>77.1</td><td>79.2</td><td>—</td><td>76.3</td><td>—</td><td>87.4</td><td>72.9</td></tr><tr><td>MRCR (Acc.)</td><td>55.0</td><td>50.8</td><td>—</td><td>74.4</td><td>—</td><td>66.9</td><td>81.7</td></tr><tr><td>DROP (Acc.)</td><td>93.5</td><td>91.2</td><td>84.3</td><td>92.0</td><td>—</td><td>79.1</td><td>81.7</td></tr></table>

Agentic Tool Use On multi-turn tool-use benchmarks, Kimi-K2-Instruct sets a new standard. It achieves 66.1 Pass@1 on τ2-Bench and 76.5 on ACEBench, substantially outperforming all baselines. These results affirm its strength in grounded, controlled, and agent-driven tool orchestration across domains.

General Capabilities Kimi-K2-Instruct exhibits strong, balanced performance across general knowledge, math, instruction following, and long-context tasks. It surpasses open-source peers on SimpleQA (31.0%), MMLU (89.5%) and MMLU-Redux (92.7%), and leads all models on instruction benchmarks (IFEval: 89.8%, Multi-Challenge: 54.1%). In math and STEM, it achieves top-tier scores (AIME 2024: 69.6%, GPQA-Diamond: 75.1%), and remains competitive on long-context factuality and retrieval (DROP: 93.5%, MRCR: 55.0%). These results position Kimi-K2-Instruct as a well-rounded and capable generalist across both short- and long-context settings.

Open-Ended Evaluation On the LMSYS Arena leaderboard (July 17, 2025), Kimi-K2-Instruct ranks as the top-1 open-source model and 5th overall based on over 3,000 user votes. This real-world preference signal—across diverse, blind prompts—underscores Kimi-K2’s strengths in generating high-quality responses on open-ended tasks.

### 4.2 Pre-training Evaluations

#### 4.2.1 Evaluation Settings

Benchmarks We evaluate Kimi-K2-Base across diverse capability areas. For general capabilities, we assess on MMLU [24], MMLU-Pro [77], MMLU-Redux [18], BBH [68], TriviaQA [35], SuperGPQA [14], SimpleQA [79], HellaSwag [89], AGIEval [90], GPQA-Diamond [62], ARC-Challenge [9], and WinoGrande [63]. For coding capabilities, we employ EvalPlus [46] (averaging HumanEval [8], MBPP [1], HumanEval+, and MBPP+), LiveCodeBench v6 [32], and CRUXEval [19]. For mathematical reasoning, we utilize GSM8K [10], GSM8K-Platinum [75], MATH [25], and CMATH [80]. For Chinese language capabilities, we evaluate on C-Eval [30], CMMLU [41], and CSimpleQA [23].

Baselines We benchmark against leading open-source foundation models: DeepSeek-V3-Base [11], Qwen2.5-72B-Base [60] (Note that Qwen3-235B-A22B-Base is not open-sourced, and the largest open-sourced base model in the Qwen series is Qwen2.5-72B-Base), and Llama 4-Maverick [71] (Llama 4-Behemoth is also not open-sourced). All models are evaluated under identical configurations to ensure fair comparison.

Evaluation Configurations We employ perplexity-based evaluation for MMLU, MMLU-Redux, GPQA-Diamond, HellaSwag, ARC-Challenge, C-Eval, and CMMLU. Generation-based evaluation is used for MMLU-Pro, SuperGPQA, TriviaQA, BBH, CSimpleQA, MATH, CMATH, GSM8K, GSM8K-Platinum, CRUXEval, LiveCodeBench, and EvalPlus. To mitigate the high variance inherent to GPQA-Diamond, we report the mean score across eight independent runs. All evaluations are conducted using our internal framework derived from LM-Harness-Evaluation [4], ensuring consistent settings across all models.

#### 4.2.2 Evaluation Results

Table 4 presents a comprehensive comparison of Kimi-K2-Base against leading open-source foundation models across diverse evaluation benchmarks. The results demonstrate that Kimi-K2-Base achieves state-of-the-art performance across the majority of evaluated tasks, establishing it as a leading foundation model in the open-source landscape.

General Language Understanding Kimi-K2-Base achieves state-of-the-art performance on 10 out of 12 English language benchmarks. Notable results include MMLU (87.79%), MMLU-Pro (69.17%), MMLU-Redux (90.17%), SuperGPQA (44.67%), and SimpleQA (35.25%), significantly outperforming all baselines.

Coding Capabilities On coding benchmarks, Kimi-K2-Base sets new standards with leading performance across all metrics. It achieves 74.00% on CRUXEval-I-cot, 83.50% on CRUXEval-O-cot, 26.29% on LiveCodeBench v6, and 80.33% on EvalPlus, demonstrating superior code generation and comprehension abilities, particularly in scenarios requiring step-by-step reasoning.

Mathematical Reasoning Kimi-K2-Base exhibits exceptional mathematical capabilities, leading on three out of four benchmarks: MATH (70.22%), GSM8K (92.12%), and GSM8K-Platinum (94.21%). It maintains competitive performance on CMATH (90.26%), narrowly behind DeepSeek-V3-Base (90.53%). These results highlight the model’s robust mathematical problem-solving abilities across varying difficulty levels.

Chinese Language Understanding The model demonstrates superior multilingual capabilities, achieving state-of-theart results across all Chinese language benchmarks: C-Eval (92.50%), CMMLU (90.90%), and CSimpleQA (77.57%). These results establish Kimi-K2-Base as a leading model for Chinese language understanding while maintaining strong performance across other languages.

Table 4: Performance comparison of Kimi-K2-Base against leading open-source models across diverse tasks. 

<table><tr><td></td><td>Benchmark (Metric)</td><td>#Shots</td><td>Kimi-K2-Base</td><td>DeepSeek-V3-Base</td><td>Llama4-Maverick-Base</td><td>Qwen2.5-72B-Base</td></tr><tr><td rowspan="15">English</td><td>Architecture</td><td>-</td><td>MoE</td><td>MoE</td><td>MoE</td><td>Dense</td></tr><tr><td># Activated Params</td><td>-</td><td>32B</td><td>37B</td><td>17B</td><td>72B</td></tr><tr><td># Total Params</td><td>-</td><td>1043B</td><td>671B</td><td>400B</td><td>72B</td></tr><tr><td>MMLU</td><td>5-shots</td><td>87.79</td><td>87.10</td><td>84.87</td><td>86.08</td></tr><tr><td>MMLU-pro</td><td>5-shots</td><td>69.17</td><td>60.59</td><td>63.47</td><td>62.80</td></tr><tr><td>MMLU-redux</td><td>5-shots</td><td>90.17</td><td>89.53</td><td>88.18</td><td>87.77</td></tr><tr><td>SuperGPQA</td><td>5-shots</td><td>44.67</td><td>39.20</td><td>38.84</td><td>34.23</td></tr><tr><td>GPQA-Diamond(avg@8)</td><td>5-shots</td><td>48.11</td><td>50.51</td><td>49.43</td><td>40.78</td></tr><tr><td>SimpleQA</td><td>5-shots</td><td>35.25</td><td>26.49</td><td>23.74</td><td>10.31</td></tr><tr><td>TriviaQA</td><td>5-shots</td><td>85.09</td><td>84.11</td><td>79.25</td><td>76.03</td></tr><tr><td>BBH</td><td>3-shots</td><td>88.71</td><td>88.37</td><td>87.10</td><td>84.09</td></tr><tr><td>HellaSwag</td><td>5-shots</td><td>94.60</td><td>89.44</td><td>86.02</td><td>95.27</td></tr><tr><td>AGIEval</td><td>-</td><td>84.23</td><td>81.57</td><td>67.55</td><td>76.87</td></tr><tr><td>ARC-Challenge</td><td>0-shot</td><td>95.73</td><td>93.77</td><td>94.03</td><td>95.56</td></tr><tr><td>WinoGrande</td><td>5-shots</td><td>85.32</td><td>84.21</td><td>77.58</td><td>84.14</td></tr><tr><td rowspan="4">Code</td><td>CRUXEval-I-cot</td><td>0-shots</td><td>74.00</td><td>62.75</td><td>67.13</td><td>61.12</td></tr><tr><td>CRUXEval-O-cot</td><td>0-shots</td><td>83.50</td><td>75.25</td><td>75.88</td><td>66.13</td></tr><tr><td>LiveCodeBench(v6)</td><td>1-shots</td><td>26.29</td><td>24.57</td><td>25.14</td><td>22.29</td></tr><tr><td>EvalPlus</td><td>-</td><td>80.33</td><td>65.61</td><td>65.48</td><td>66.04</td></tr><tr><td rowspan="4">Math</td><td>MATH</td><td>4-shots</td><td>70.22</td><td>61.70</td><td>63.02</td><td>62.68</td></tr><tr><td>GSM8k</td><td>8-shots</td><td>92.12</td><td>91.66</td><td>86.35</td><td>90.37</td></tr><tr><td>GSM8k-platinum</td><td>8-shots</td><td>94.21</td><td>93.38</td><td>88.83</td><td>92.47</td></tr><tr><td>CMATH</td><td>6-shots</td><td>90.26</td><td>90.53</td><td>88.07</td><td>86.98</td></tr><tr><td rowspan="3">Chinese</td><td>C-Eval</td><td>5-shots</td><td>92.50</td><td>90.04</td><td>80.91</td><td>90.86</td></tr><tr><td>CMMLU</td><td>5-shots</td><td>90.90</td><td>88.84</td><td>81.24</td><td>90.55</td></tr><tr><td>CSimpleQA</td><td>5-shots</td><td>77.57</td><td>72.13</td><td>53.47</td><td>50.53</td></tr></table>

### 4.3 Safety Evaluation

#### 4.3.1 Experiment Settings

We conducted red-teaming evaluations on Kimi K2 compare with other open-source LLMs. The evaluation covered a range of attack scenarios—including harmful content, privacy content, and security content, as well as different attack strategies such as prompt injection and iterative jailbreak.

We choose Promptfoo6 to generate adversarial prompts and analyze the responses. By this way, we can evaluate model in a scalable ways.

Model Selection We compare Kimi K2 with three other open-source LLMs: DeepSeek-V3, DeepSeek-R1, and Qwen3.

Promptfoo Settings Table 5 lists plugins and strategies evaluated, with each plugin paired with all strategies to assess their performance.

Test Case Count Given the inherent non-determinism of large language model inference, single-pass outputs may exhibit variability. To account for this, we generated 3 attack prompts per plugin for each strategy.

Prompt Language Settings We pre-tested the language compatibility for each plugin-strategy combination. Some plugins support both English and Chinese, while others only support English. For combinations that support both, we generated 3 prompts in each language, resulting in 6 prompts per combination.

Table 5: Enabled Plugins and Strategies 

<table><tr><td rowspan="5">Plugin</td><td>Harmful</td><td>Graphic Content, Harassment and Bullying, Hate Speech, Insults, Profanity, Radicalization, Self Harm, Sexual Content, ToxicChat</td></tr><tr><td>Criminal</td><td>Chemical&amp;Biological Weapons, Child Exploitation, Copyright Violations, Cybercrime, Illegal Activities, Illegal Drugs, Indiscriminate Weapons, Intellectual Property Violation, Non-Violent Crime, Violent Crime, Sex Crimes</td></tr><tr><td>Misinformation</td><td>Competitor Endorsement, Unsupervised Contracts, Excessive Agency, Hallucination, Misinformation and Disinformation, Specialized Advice, Unsafe Practices, Imitation, Overreliance, Political Opinions, Religious Sensitivity</td></tr><tr><td>Privacy</td><td>Privacy Violation, PII in API/Database, Direct PII Exposure, PII in Session Data, PII via Social Engineering</td></tr><tr><td>Security</td><td>ASCII Smuggling, CyberSecEval, Harmbench, Debug Access, Divergent Repetition, DoNotAnswer, Malicious Code, Pliny, Prompt Extraction, Reasoning DoS, Tool Discovery</td></tr><tr><td>Strategy</td><td colspan="2">Basic, Prompt Injection, Iterative Jailbreak, Crescendo</td></tr></table>

Manual Review We incorporated human review into the evaluation process. To minimize subjectivity problem, we conducted multiple rounds of review and assigned the same reviewer to evaluate all cases within a given test set to ensure consistency and reduce variability in judgment.

#### 4.3.2 Safety Evaluation Results

Table 6 presents the passing rates of different models under various plugin–strategy combinations.

Table 6: Safety Evaluation Results 

<table><tr><td>Plugin</td><td>Strategy</td><td>Kimi-K2-Instruct</td><td>DeepSeek-V3-0324</td><td>DeepSeek-R1</td><td>Qwen3-235B-A22B</td></tr><tr><td rowspan="5">Harmful</td><td>Basic</td><td>98.04</td><td>90.45</td><td>99.02</td><td>98.53</td></tr><tr><td>Base64</td><td>100</td><td>90.20</td><td>100</td><td>100</td></tr><tr><td>Prompt Injection</td><td>93.14</td><td>100</td><td>95.10</td><td>99.02</td></tr><tr><td>Iterative Jailbreak</td><td>92.16</td><td>66.67</td><td>72.55</td><td>74.51</td></tr><tr><td>Crescendo</td><td>64.71</td><td>64.71</td><td>80.39</td><td>86.27</td></tr><tr><td rowspan="5">Criminal</td><td>Basic</td><td>100</td><td>99.62</td><td>95.45</td><td>99.24</td></tr><tr><td>Base64</td><td>96.97</td><td>89.39</td><td>84.85</td><td>98.48</td></tr><tr><td>Prompt Injection</td><td>75.76</td><td>91.67</td><td>69.70</td><td>98.47</td></tr><tr><td>Iterative Jailbreak</td><td>57.57</td><td>21.21</td><td>25.76</td><td>53.03</td></tr><tr><td>Crescendo</td><td>56.06</td><td>31.81</td><td>42.42</td><td>59.09</td></tr><tr><td rowspan="5">Misinformation</td><td>Basic</td><td>97.28</td><td>92.57</td><td>92.46</td><td>94.84</td></tr><tr><td>Base64</td><td>98.48</td><td>90.48</td><td>96.83</td><td>93.65</td></tr><tr><td>Prompt Injection</td><td>98.39</td><td>86.51</td><td>93.65</td><td>93.65</td></tr><tr><td>Iterative Jailbreak</td><td>63.97</td><td>53.97</td><td>84.13</td><td>69.84</td></tr><tr><td>Crescendo</td><td>85.71</td><td>55.56</td><td>88.89</td><td>84.13</td></tr><tr><td rowspan="5">Privacy</td><td>Basic</td><td>100</td><td>100</td><td>100</td><td>100</td></tr><tr><td>Base64</td><td>100</td><td>100</td><td>100</td><td>100</td></tr><tr><td>Prompt Injection</td><td>88.33</td><td>98.33</td><td>100</td><td>91.67</td></tr><tr><td>Iterative Jailbreak</td><td>76.67</td><td>100</td><td>93.33</td><td>96.67</td></tr><tr><td>Crescendo</td><td>96.67</td><td>100</td><td>96.67</td><td>100</td></tr><tr><td rowspan="5">Security</td><td>Basic</td><td>77.84</td><td>75.57</td><td>70.46</td><td>90.09</td></tr><tr><td>Base64</td><td>82.93</td><td>82.93</td><td>63.41</td><td>95.12</td></tr><tr><td>Prompt Injection</td><td>87.80</td><td>97.56</td><td>65.85</td><td>84.13</td></tr><tr><td>Iterative Jailbreak</td><td>43.90</td><td>60.97</td><td>43.90</td><td>78.04</td></tr><tr><td>Crescendo</td><td>68.29</td><td>87.80</td><td>68.29</td><td>87.80</td></tr></table>

Without targeted optimization for specific evaluation scenarios, the passing rate of some complex cases (e.g., Harmful–Iterative Jailbreak) was relatively higher compared to other models.

Across different attack strategies, the models exhibited varying trends. Under the Base64 strategy, passing rates generally approached or reached 100%, suggesting that encoding transformations had minimal impact on the models’ basic robustness. In contrast, the Crescendo strategy led to a general drop in passing rates, indicating stronger adversarial effectiveness.

In addition, complex attack strategies do not always outperform basic prompts. Some originally adversarial prompts may lose their intended meaning after multiple rounds of transformation, rendering the resulting model outputs less meaningful.

Automated Red-teaming Limitations Due to the involvement of human review, the evaluation results inevitably contain a degree of subjectivity. Additionally, certain plugin types involve API misuse or external tool invocation, which are more suitable for evaluating agent models with tool-calling capabilities. In the context of base LLMs, such tests may have limited relevance.

## 5 Limitations

In our internal tests, we have identified some limitations in current Kimi K2 models. When dealing with hard reasoning tasks or unclear tool definition, the model may generate excessive tokens, sometimes leading to truncated outputs or incomplete tool calls. Additionally, performance may decline on certain tasks if tool use is unnecessarily enabled. When building complete software projects, the success rate of one-shot prompting is not as good as using K2 under an agentic coding framework. We are working to address these issues in future releases and looking forward to more feedbacks.

## 6 Conclusions

We introduced Kimi K2, a 1T-parameter open-weight MoE model built for agentic intelligence. Leveraging the tokenefficient MuonClip optimizer and a 15.5T-token high-quality dataset, Kimi K2 achieves stable, scalable pre-training. Post-training combines large-scale synthetic tool-use data with a unified RL framework using both verifiable rewards and self-critic feedbacks. Kimi K2 sets new state-of-the-art on agentic and reasoning benchmarks, establishing itself as the most capable open-weight LLM to date.

## 7 Acknowledgments

We would like to acknowledge the valuable support provided by the OpenHands and Multi-SWE-bench teams in evaluating the SWE-bench Verified and Multi-SWE-bench experimental results.

## References

[1] Jacob Austin et al. Program Synthesis with Large Language Models. 2021. arXiv: 2108.07732 [cs.PL]. URL: https://arxiv.org/abs/2108.07732.   
[2] Yushi Bai et al. LongBench v2: Towards Deeper Understanding and Reasoning on Realistic Long-context Multitasks. 2025. arXiv: 2412.15204 [cs.CL]. URL: https://arxiv.org/abs/2412.15204.   
[3] Victor Barres et al. τ2-Bench: Evaluating Conversational Agents in a Dual-Control Environment. 2025. arXiv: 2506.07982 [cs.AI]. URL: https://arxiv.org/abs/2506.07982.   
[4] Stella Biderman et al. “Lessons from the trenches on reproducible evaluation of language models”. In: arXiv preprint arXiv:2405.14782 (2024).   
[5] Greg Brockman et al. OpenAI Gym. 2016. arXiv: 1606.01540 [cs.LG]. URL: https://arxiv.org/ abs/1606.01540.   
[6] Federico Cassano et al. “MultiPL-E: A Scalable and Polyglot Approach to Benchmarking Neural Code Generation”. In: IEEE Transactions on Software Engineering 49.7 (2023), pp. 3675–3691. DOI: 10.1109/TSE. 2023.3267446.   
[7] Chen Chen et al. “ACEBench: Who Wins the Match Point in Tool Learning?” In: arXiv e-prints (2025), arXiv– 2501.   
[8] Mark Chen et al. “Evaluating Large Language Models Trained on Code”. In: (2021). arXiv: 2107.03374 [cs.LG].   
[9] Peter Clark et al. “Think you have solved question answering? try arc, the ai2 reasoning challenge”. In: arXiv preprint arXiv:1803.05457 (2018).   
[10] Karl Cobbe et al. Training Verifiers to Solve Math Word Problems. 2021. arXiv: 2110.14168 [cs.LG]. URL: https://arxiv.org/abs/2110.14168.   
[11] DeepSeek-AI. DeepSeek-V3 Technical Report. 2024. arXiv: 2412 . 19437 [cs.CL]. URL: https : / / arxiv.org/abs/2412.19437.   
[12] Mostafa Dehghani et al. “Scaling vision transformers to 22 billion parameters”. In: International conference on machine learning. PMLR. 2023, pp. 7480–7512.   
[13] Guanting Dong et al. Self-play with Execution Feedback: Improving Instruction-following Capabilities of Large Language Models. 2024. arXiv: 2406.13542 [cs.CL]. URL: https://arxiv.org/abs/2406. 13542.   
[14] Xinrun Du et al. “Supergpqa: Scaling llm evaluation across 285 graduate disciplines”. In: arXiv preprint arXiv:2502.14739 (2025).   
[15] Dheeru Dua et al. “DROP: A Reading Comprehension Benchmark Requiring Discrete Reasoning Over Paragraphs”. In: CoRR abs/1903.00161 (2019). arXiv: 1903.00161. URL: http://arxiv.org/abs/1903. 00161.   
[16] Kazuki Fujii et al. Rewriting Pre-Training Data Boosts LLM Performance in Math and Code. 2025. arXiv: 2505.02881 [cs.LG]. URL: https://arxiv.org/abs/2505.02881.   
[17] Paul Gauthier. Aider LLM Leaderboards. https://aider.chat/docs/leaderboards/. 2025.   
[18] Aryo Pradipta Gema et al. “Are we done with mmlu?” In: arXiv preprint arXiv:2406.04127 (2024).   
[19] Alex Gu et al. “Cruxeval: A benchmark for code reasoning, understanding and execution”. In: arXiv preprint arXiv:2401.03065 (2024).   
[20] Daya Guo et al. “Deepseek-r1: Incentivizing reasoning capability in llms via reinforcement learning”. In: arXiv preprint arXiv:2501.12948 (2025).   
[21] Zhicheng Guo et al. “StableToolBench: Towards Stable Large-Scale Benchmarking on Tool Learning of Large Language Models”. In: arXiv preprint arXiv:2403.07714 (2025).   
[22] Aaron Harlap et al. “Pipedream: Fast and efficient pipeline parallel dnn training”. In: arXiv preprint arXiv:1806.03377 (2018).   
[23] Y He et al. “Chinese simpleqa: A chinese factuality evaluation for large language models, 2024a”. In: URL https://arxiv. org/abs/2411.07140 ().   
[24] Dan Hendrycks et al. “Measuring massive multitask language understanding”. In: arXiv preprint arXiv:2009.03300 (2020).   
[25] Dan Hendrycks et al. Measuring Mathematical Problem Solving With the MATH Dataset. 2021. arXiv: 2103. 03874 [cs.LG]. URL: https://arxiv.org/abs/2103.03874.   
[26] Shengding Hu et al. “Minicpm: Unveiling the potential of small language models with scalable training strategies”. In: arXiv preprint arXiv:2404.06395 (2024).

[27] Jiaxin Huang et al. “Large language models can self-improve”. In: arXiv preprint arXiv:2210.11610 (2022).   
[28] Siming Huang et al. OpenCoder: The Open Cookbook for Top-Tier Code Large Language Models. 2025. arXiv: 2411.04905 [cs.CL]. URL: https://arxiv.org/abs/2411.04905.   
[29] Yanping Huang et al. “Gpipe: Efficient training of giant neural networks using pipeline parallelism”. In: Advances in neural information processing systems 32 (2019).   
[30] Yuzhen Huang et al. C-Eval: A Multi-Level Multi-Discipline Chinese Evaluation Suite for Foundation Models. 2023. arXiv: 2305.08322 [cs.CL]. URL: https://arxiv.org/abs/2305.08322.   
[31] Alon Jacovi et al. The FACTS Grounding Leaderboard: Benchmarking LLMs’ Ability to Ground Responses to Long-Form Input. 2025. arXiv: 2501.03200 [cs.CL]. URL: https://arxiv.org/abs/2501. 03200.   
[32] Naman Jain et al. “Livecodebench: Holistic and contamination free evaluation of large language models for code”. In: arXiv preprint arXiv:2403.07974 (2024).   
[33] Carlos E Jimenez et al. “SWE-bench: Can Language Models Resolve Real-world Github Issues?” In: The Twelfth International Conference on Learning Representations. 2024. URL: https://openreview.net/forum? id=VTF8yNQM66.   
[34] Keller Jordan et al. Muon: An optimizer for hidden layers in neural networks. 2024. URL: https : / / kellerjordan.github.io/posts/muon/.   
[35] Mandar Joshi et al. TriviaQA: A Large Scale Distantly Supervised Challenge Dataset for Reading Comprehension. 2017. arXiv: 1705.03551 [cs.CL]. URL: https://arxiv.org/abs/1705.03551.   
[36] Kimi Team. “Kimi k1. 5: Scaling reinforcement learning with llms”. In: arXiv preprint arXiv:2501.12599 (2025).   
[37] Diederik P. Kingma and Jimmy Ba. “Adam: A Method for Stochastic Optimization”. In: 3rd International Conference on Learning Representations, ICLR 2015, San Diego, CA, USA, May 7-9, 2015, Conference Track Proceedings. Ed. by Yoshua Bengio and Yann LeCun. 2015. URL: http://arxiv.org/abs/1412.6980.   
[38] Satyapriya Krishna et al. Fact, Fetch, and Reason: A Unified Evaluation of Retrieval-Augmented Generation. 2025. arXiv: 2409.12941 [cs.CL]. URL: https://arxiv.org/abs/2409.12941.   
[39] Joel Lamy-Poirier. “Breadth-first pipeline parallelism”. In: Proceedings of Machine Learning and Systems 5 (2023), pp. 48–67.   
[40] Dmitry Lepikhin et al. “Gshard: Scaling giant models with conditional computation and automatic sharding”. In: arXiv preprint arXiv:2006.16668 (2020).   
[41] Haonan Li et al. CMMLU: Measuring massive multitask language understanding in Chinese. 2024. arXiv: 2306.09212 [cs.CL]. URL: https://arxiv.org/abs/2306.09212.   
[42] Jia Li et al. “Numinamath: The largest public dataset in ai4maths with 860k pairs of competition math problems and solutions”. In: Hugging Face repository 13.9 (2024), p. 9.   
[43] Tianle Li et al. “From Crowdsourced Data to High-Quality Benchmarks: Arena-Hard and BenchBuilder Pipeline”. In: arXiv preprint arXiv:2406.11939 (2024).   
[44] Bill Yuchen Lin et al. ZebraLogic: On the Scaling Limits of LLMs for Logical Reasoning. 2025. arXiv: 2502. 01100 [cs.AI]. URL: https://arxiv.org/abs/2502.01100.   
[45] Aixin Liu et al. “Deepseek-v2: A strong, economical, and efficient mixture-of-experts language model”. In: arXiv preprint arXiv:2405.04434 (2024).   
[46] Jiawei Liu et al. “Is your code generated by chatgpt really correct? rigorous evaluation of large language models for code generation”. In: Advances in Neural Information Processing Systems 36 (2023), pp. 21558–21572.   
[47] Jingyuan Liu et al. “Muon is scalable for LLM training”. In: arXiv preprint arXiv:2502.16982 (2025).   
[48] Ziming Liu et al. “Hanayo: Harnessing Wave-like Pipeline Parallelism for Enhanced Large Model Training Efficiency”. In: Proceedings of the International Conference for High Performance Computing, Networking, Storage and Analysis. SC ’23. ACM, Nov. 2023, pp. 1–13. DOI: 10.1145/3581784.3607073. URL: http://dx.doi.org/10.1145/3581784.3607073.   
[49] Ilya Loshchilov and Frank Hutter. “Decoupled Weight Decay Regularization”. In: International Conference on Learning Representations. 2019. URL: https://openreview.net/forum?id=Bkg6RiCqY7.   
[50] Pratyush Maini et al. Rephrasing the Web: A Recipe for Compute and Data-Efficient Language Modeling. 2024. arXiv: 2401.16380 [cs.CL]. URL: https://arxiv.org/abs/2401.16380.   
[51] Samuel Miserendino et al. “SWE-Lancer: Can Frontier LLMs Earn \$1 Million from Real-World Freelance Software Engineering?” In: arXiv preprint arXiv:2502.12115 (2025).   
[52] Arindam Mitra et al. “Agentinstruct: Toward generative teaching with agentic flows”. In: arXiv preprint arXiv:2407.03502 (2024).

[53] Ivan Moshkov et al. “Aimo-2 winning solution: Building state-of-the-art mathematical reasoning models with openmathreasoning dataset”. In: arXiv preprint arXiv:2504.16891 (2025).   
[54] Deepak Narayanan et al. “Efficient large-scale language model training on gpu clusters using megatron-lm”. In: Proceedings of the international conference for high performance computing, networking, storage and analysis. 2021, pp. 1–15.   
[55] Long Ouyang et al. “Training language models to follow instructions with human feedback”. In: Advances in neural information processing systems 35 (2022), pp. 27730–27744.   
[56] Bowen Peng et al. “Yarn: Efficient context window extension of large language models”. In: arXiv preprint arXiv:2309.00071 (2023).   
[57] Long Phan et al. Humanity’s Last Exam. 2025. arXiv: 2501.14249 [cs.LG]. URL: https://arxiv. org/abs/2501.14249.   
[58] Penghui Qi et al. “Zero bubble pipeline parallelism”. In: arXiv preprint arXiv:2401.10241 (2023).   
[59] Yujia Qin et al. “Toolllm: Facilitating large language models to master 16000+ real-world apis”. In: arXiv preprint arXiv:2307.16789 (2023).   
[60] Qwen et al. Qwen2.5 Technical Report. 2025. arXiv: 2412.15115 [cs.CL]. URL: https://arxiv. org/abs/2412.15115.   
[61] Samyam Rajbhandari et al. “Zero: Memory optimizations toward training trillion parameter models”. In: SC20: International Conference for High Performance Computing, Networking, Storage and Analysis. IEEE. 2020, pp. 1–16.   
[62] David Rein et al. “Gpqa: A graduate-level google-proof q&a benchmark”. In: First Conference on Language Modeling. 2024.   
[63] Keisuke Sakaguchi et al. “Winogrande: An adversarial winograd schema challenge at scale”. In: Communications of the ACM 64.9 (2021), pp. 99–106.   
[64] David Silver and Richard S Sutton. “Welcome to the era of experience”. In: Google AI 1 (2025).   
[65] Ved Sirdeshmukh et al. MultiChallenge: A Realistic Multi-Turn Conversation Evaluation Benchmark Challenging to Frontier LLMs. 2025. arXiv: 2501.17399 [cs.CL]. URL: https://arxiv.org/abs/2501. 17399.   
[66] Giulio Starace et al. “PaperBench: Evaluating AI’s Ability to Replicate AI Research”. In: arXiv preprint arXiv:2504.01848 (2025).   
[67] Hao Sun et al. ZeroSearch: Incentivize the Search Capability of LLMs without Searching. 2025. arXiv: 2505. 04588 [cs.CL]. URL: https://arxiv.org/abs/2505.04588.   
[68] Mirac Suzgun et al. Challenging BIG-Bench Tasks and Whether Chain-of-Thought Can Solve Them. 2022. arXiv: 2210.09261 [cs.CL]. URL: https://arxiv.org/abs/2210.09261.   
[69] Manveer Singh Tamber et al. “Benchmarking LLM Faithfulness in RAG with Evolving Leaderboards”. In: arXiv preprint arXiv:2505.04847 (2025).   
[70] Gemma Team et al. “Gemma 2: Improving open language models at a practical size”. In: arXiv preprint arXiv:2408.00118 (2024).   
[71] LlaMA Team. The Llama 4 herd: The beginning of a new era of natively multimodal AI innovation — ai.meta.com. https://ai.meta.com/blog/llama-4-multimodal-intelligence/. [Accessed 15-07-2025].   
[72] The Terminal-Bench Team. Terminal-Bench: A Benchmark for AI Agents in Terminal Environments. Apr. 2025. URL: https://github.com/laude-institute/terminal-bench.   
[73] Ashish Vaswani et al. “Attention is All you Need”. In: Advances in Neural Information Processing Systems. Ed. by I. Guyon et al. Vol. 30. Curran Associates, Inc., 2017. URL: https://proceedings.neurips. cc/paper\_files/paper/2017/file/3f5ee243547dee91fbd053c1c4a845aa-Paper.pdf.   
[74] Vectara. Hallucination Evaluation Model (Revision 7437011). 2024. URL: https://huggingface.co/ vectara/hallucination\_evaluation\_model.   
[75] Joshua Vendrow et al. “Do large language model benchmarks test reliability?” In: arXiv preprint arXiv:2502.03461 (2025).   
[76] Yizhong Wang et al. “Self-instruct: Aligning language models with self-generated instructions”. In: arXiv preprint arXiv:2212.10560 (2022).   
[77] Yubo Wang et al. MMLU-Pro: A More Robust and Challenging Multi-Task Language Understanding Benchmark. 2024. arXiv: 2406.01574 [cs.CL]. URL: https://arxiv.org/abs/2406.01574.   
[78] Zhexu Wang et al. OJBench: A Competition Level Code Benchmark For Large Language Models. 2025. arXiv: 2506.16395 [cs.CL]. URL: https://arxiv.org/abs/2506.16395.

[79] Jason Wei et al. “Measuring short-form factuality in large language models”. In: arXiv preprint arXiv:2411.04368 (2024).   
[80] Tianwen Wei et al. CMATH: Can Your Language Model Pass Chinese Elementary School Math Test? 2023. arXiv: 2306.16636 [cs.CL]. URL: https://arxiv.org/abs/2306.16636.   
[81] Colin White et al. “LiveBench: A Challenging, Contamination-Free LLM Benchmark”. In: The Thirteenth International Conference on Learning Representations. 2025.   
[82] Mitchell Wortsman et al. “Small-scale proxies for large-scale transformer training instabilities, 2023”. In: URL https://arxiv. org/abs/2309.14322 ().   
[83] Can Xu et al. WizardLM: Empowering large pre-trained language models to follow complex instructions. 2025. arXiv: 2304.12244 [cs.CL]. URL: https://arxiv.org/abs/2304.12244.   
[84] Zhangchen Xu et al. KodCode: A Diverse, Challenging, and Verifiable Synthetic Dataset for Coding. 2025. arXiv: 2503.02951 [cs.LG]. URL: https://arxiv.org/abs/2503.02951.   
[85] John Yang et al. SWE-smith: Scaling Data for Software Engineering Agents. 2025. arXiv: 2504 . 21798 [cs.SE]. URL: https://arxiv.org/abs/2504.21798.   
[86] Shunyu Yao et al. “tau-bench: A Benchmark for Tool-Agent-User Interaction in Real-World Domains”. In: arXiv preprint arXiv:2406.12045 (2024).   
[87] Daoguang Zan et al. “Multi-swe-bench: A multilingual benchmark for issue resolving”. In: arXiv preprint arXiv:2504.02605 (2025).   
[88] Eric Zelikman et al. “Star: Bootstrapping reasoning with reasoning”. In: Advances in Neural Information Processing Systems 35 (2022), pp. 15476–15488.   
[89] Rowan Zellers et al. “Hellaswag: Can a machine really finish your sentence?” In: arXiv preprint arXiv:1905.07830 (2019).   
[90] Wanjun Zhong et al. “Agieval: A human-centric benchmark for evaluating foundation models”. In: arXiv preprint arXiv:2304.06364 (2023).   
[91] Jeffrey Zhou et al. “Instruction-Following Evaluation for Large Language Models”. In: ArXiv abs/2311.07911 (2023). URL: https://arxiv.org/abs/2311.07911.   
[92] Qin Zhu et al. AutoLogi: Automated Generation of Logic Puzzles for Evaluating Reasoning Abilities of Large Language Models. 2025. arXiv: 2502.16906 [cs.CL]. URL: https://arxiv.org/abs/2502. 16906.

## Appendix

## A Contributions

The listing of authors is in alphabetical order based on their last names.

<table><tr><td>Yifan Bai</td><td>Yongsheng Kang</td><td>Zhengyuan Su</td><td>Junjie Yan</td></tr><tr><td>Yiping Bao</td><td>Guokun Lai</td><td>Lin Sui</td><td>Yuzi Yan</td></tr><tr><td>Y. Charles</td><td>Cheng Li</td><td>Xinjie Sun</td><td>Hao Yang</td></tr><tr><td>Cheng Chen</td><td>Fang Li</td><td>Flood Sung</td><td>Xiaofei Yang</td></tr><tr><td>Guanduo Chen</td><td>Haoyang Li</td><td>Yunpeng Tai</td><td>Yi Yang</td></tr><tr><td>Haiting Chen</td><td>Ming Li</td><td>Heyi Tang</td><td>Ying Yang</td></tr><tr><td>Huarong Chen</td><td>Wentao Li</td><td>Jiawen Tao</td><td>Zhen Yang</td></tr><tr><td>Jiahao Chen</td><td>Yang Li</td><td>Qifeng Teng</td><td>Zhilin Yang</td></tr><tr><td>Ningxin Chen</td><td>Yanhao Li</td><td>Chaoran Tian</td><td>Zonghan Yang</td></tr><tr><td>Ruijue Chen</td><td>Yiwei Li</td><td>Chensi Wang</td><td>Haotian Yao</td></tr><tr><td>Yanru Chen</td><td>Zhaowei Li</td><td>Dinglu Wang</td><td>Xingcheng Yao</td></tr><tr><td>Yuankun Chen</td><td>Zheming Li</td><td>Feng Wang</td><td>Wenjie Ye</td></tr><tr><td>Yutian Chen</td><td>Hongzhan Lin</td><td>Hailong Wang</td><td>Zhuorui Ye</td></tr><tr><td>Zhuofu Chen</td><td>Xiaohan Lin</td><td>Haiming Wang</td><td>Bohong Yin</td></tr><tr><td>Jialei Cui</td><td>Zongyu Lin</td><td>Jianzhou Wang</td><td>Longhui Yu</td></tr><tr><td>Hao Ding</td><td>Chengyin Liu</td><td>Jiaxing Wang</td><td>Enming Yuan</td></tr><tr><td>Mengnan Dong</td><td>Chenyu Liu</td><td>Jinhong Wang</td><td>Hongbang Yuan</td></tr><tr><td>Ang&#x27;ang Du</td><td>Hongzhang Liu</td><td>Shengjie Wang</td><td>Mengjie Yuan</td></tr><tr><td>Chenzhuang Du</td><td>Jingyuan Liu</td><td>Shuyi Wang</td><td>Siyu Yuan</td></tr><tr><td>Dikang Du</td><td>Junqi Liu</td><td>Si Wang</td><td>Haobing Zhan</td></tr><tr><td>Yulun Du</td><td>Liang Liu</td><td>Xinyuan Wang</td><td>Dehao Zhang</td></tr><tr><td>Yu Fan</td><td>Shaowei Liu</td><td>Yao Wang</td><td>Hao Zhang</td></tr><tr><td>Yichen Feng</td><td>T.Y. Liu</td><td>Yejie Wang</td><td>Wanlu Zhang</td></tr><tr><td>Kelin Fu</td><td>Tianwei Liu</td><td>Yiqin Wang</td><td>Xiaobin Zhang</td></tr><tr><td>Bofei Gao</td><td>Weizhou Liu</td><td>Yuxin Wang</td><td>Yadong Zhang</td></tr><tr><td>Chenxiao Gao</td><td>Yangyang Liu</td><td>Yuzhi Wang</td><td>Yangkun Zhang</td></tr><tr><td>Hongcheng Gao</td><td>Yibo Liu</td><td>Zhaoji Wang</td><td>Yichi Zhang</td></tr><tr><td>Peizhong Gao</td><td>Yiping Liu</td><td>Zhengtao Wang</td><td>Yizhi Zhang</td></tr><tr><td>Tong Gao</td><td>Yue Liu</td><td>Zhengtao Wang</td><td>Yongting Zhang</td></tr><tr><td>Yuyao Ge</td><td>Zhengying Liu</td><td>Zhexu Wang</td><td>Yu Zhang</td></tr><tr><td>Shangyi Geng</td><td>Enzhe Lu</td><td>Chu Wei</td><td>Yutao Zhang</td></tr><tr><td>Qizheng Gu</td><td>Haoyu Lu</td><td>Qianqian Wei</td><td>Yutong Zhang</td></tr><tr><td>Xinran Gu</td><td>Lijun Lu</td><td>Haoning Wu</td><td>Zheng Zhang</td></tr><tr><td>Longyu Guan</td><td>Yashuo Luo</td><td>Wenhao Wu</td><td>Haotian Zhao</td></tr><tr><td>Haiqing Guo</td><td>Shengling Ma</td><td>Xingzhe Wu</td><td>Yikai Zhao</td></tr><tr><td>Jianhang Guo</td><td>Xinyu Ma</td><td>Yuxin Wu</td><td>Zijia Zhao</td></tr><tr><td>Xiaoru Hao</td><td>Yingwei Ma</td><td>Chenjun Xiao</td><td>Huabin Zheng</td></tr><tr><td>Tianhong He</td><td>Shaoguang Mao</td><td>Jin Xie</td><td>Shaojie Zheng</td></tr><tr><td>Weiran He</td><td>Jie Mei</td><td>Xiaotong Xie</td><td>Longguang Zhong</td></tr><tr><td>Wenyang He</td><td>Xin Men</td><td>Weimin Xiong</td><td>Jianren Zhou</td></tr><tr><td>Yunjia He</td><td>Yibo Miao</td><td>Boyu Xu</td><td>Xinyu Zhou</td></tr><tr><td>Chao Hong</td><td>Siyuan Pan</td><td>Jinjing Xu</td><td>Zaida Zhou</td></tr><tr><td>Hao Hu</td><td>Yebo Peng</td><td>L.H. Xu</td><td>Jinguo Zhu</td></tr><tr><td>Yangyang Hu</td><td>Ruoyu Qin</td><td>Lin Xu</td><td>Zhen Zhu</td></tr><tr><td>Zhenxing Hu</td><td>Zeyu Qin</td><td>Suting Xu</td><td>Weiyu Zhuang</td></tr><tr><td>Weixiao Huang</td><td>Bowen Qu</td><td>Weixin Xu</td><td>Xinxing Zu</td></tr><tr><td>Zhiqi Huang</td><td>Zeyu Shang</td><td>Xinran Xu</td><td>Kimi K2</td></tr><tr><td>Zihao Huang</td><td>Lidong Shi</td><td>Yangchuan Xu</td><td></td></tr><tr><td>Tao Jiang</td><td>Shengyuan Shi</td><td>Ziyao Xu</td><td></td></tr><tr><td>Zhejun Jiang</td><td>Feifan Song</td><td>Jing Xu (徐)</td><td></td></tr><tr><td>Xinyi Jin</td><td>Jianlin Su</td><td>Jing Xu (许)</td><td></td></tr></table>

## B Token Template of Tool Calling

There are three components in the token structure for tool-calling:

• Tool declaration message: defines the list of available tools and the schema of the arguments;   
• Tool invoking section in assistant message: encodes the model’s request to invoke tools;   
• Tool result message: encapsulates the invoked tool’s execution result.

The raw tokens of the tool declaration message are formatted as follows:

```txt
<|im_begin|>
tool_declare
<|im_middle|>
### Tools
{{ tool declaration content }}
<|im_end|> 
```

The blue highlighted marks represent special tokens, and the green part, quoted by brackets, is the tool declaration content. We use TypeScript to express the tool declaration content, since TypeScript is a concise language with a comprehensive type system, able to express the types and constraints of tool parameters with brief text. The code 1 shows an example for two simple tools in JSON format compatible with OpenAI’s chat completion API, as a comparison, the same tools defined in TypeScript (listed in Code 2) is much shorter. To improve compatibility, part of our training data also uses JSON as the tool declaration language, so that 3rd-party frameworks need not additional development to support our tool calling scheme.

Listing 1: Tool definition with JSON in OpenAI compatible API   
```json
[{
    "type": "function",
    "function": {
    "name": "get_weather",
    "description": "Get weather for a location and date",
    "parameters": {
    "type": "object",
    "properties": {
    "location": {
    "type": "string",
    "description": "City and country e.g. Beijing, China"
    },
    "date": {
    "type": "string",
    "description": "Date to query, format in '%Y-%m-%d'"
    }
    },
    "required": [
    "location"
    ]
    }
},
{
    "type": "function",
    "function": {
    "name": "Calculator",
    "description": "Simple calculator",
    "parameters": {
    "properties": {
    "expr": {
    "type": "string",
    "description": "Arithmetic expression in javascript"
    }
    },
    }
} 
```

```txt
"type": "object"
}
}
} 
```

Listing 2: Tool definition in TypeScript   
```typescript
namespace functions {
    // Get weather for a location and date
    type get_weather = (_: {
    // City and country e.g. Beijing, China
    location: string,
    // Date to query, format in '%Y-%m-%d'
    date?: string
    }) => any;
    // Simple calculator
    type Calculator = (_: {
    // Arithmetic expression in javascript
    expr?: string
    }) => any;
} 
```

The token template of the tool invoking section in the model’s response messages is listed as follows:

```handlebars
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

As shown in the template, we support parallel tool calling by placing multiple tool calls in a single response turn. Each tool call has a unique call id, formatted as functions.{tool-name}:{counter}, where tool-name is the name of the tool, and counter is an auto-increasing counter of all tool calls starting from 0 in the dialog.

During inference, the model may occasionally generate unexpected tokens, leading to format errors when parsing a tool call. To solve this issue, we developed a constrained decoding module named enforcer, inspired by lm-format-enforcer7. When a <tool\_call\_section\_begin|> token is generated, it ensures that the upcoming tool-related tokens follow the predefined template, and the JSON argument string follows the declared schema.

The tool result message is simply a text message encoded with the tool’s call id and the corresponding results.

```txt
<|im_begin|>
tool
<|im_middle|>
## Results of {{call_id}}
{{ execution result content }}
<|im_end|> 
```

## C Evaluation Details

Coding Tasks. We evaluate Kimi-K2-Instruct’s capabilities on competitive coding benchmarks, LiveCodeBench and OJBench, where Kimi-K2-Instruct attains superior performance with scores of 53.7% and 27.1%, respectively. This excellence spans both medium-level coding challenges, such as LeetCode and AtCoder, and hard-level contests like NOI and ICPC, outperforming leading open-source and proprietary models. For multilingual programming proficiency, we employ MultiPL-E, covering languages including C++, C#, Java, JavaScript, PHP, Go, Kimi-K2-Instruct surpasses top open-source models with an accuracy of 85.7%, compared with 83.1% for DeepSeek-V3-0324 and 78.2% for Qwen3- 235B-A22B. In software engineering tasks, Kimi-K2-Instruct demonstrates robust performance on SWE-bench Verified (Python), SWE-lancer (Python), SWE-bench Multilingual, and Multi-SWE-bench datasets. It significantly outperforms open-source counterparts in resolving real-world code repository issues and notably narrows the performance gap with proprietary models. For example:

• SWE-bench Verified (multiple attempts): 71.6% (Kimi-K2-Instruct) vs. 80.2% (Claude 4 Sonnet)   
• SWE-bench Multilingual: 47.3% (Kimi-K2-Instruct) vs. 51.0% (Claude 4 Sonnet)   
• SWE-lancer: 39.1% (Kimi-K2-Instruct) vs. 40.8% (Claude 4 Sonnet)

On PaperBench, Kimi-K2-Instruct achieves an accuracy of 27.8%, closely matching GPT-4.1 and outperforming DeepSeek-V3-0324 (12.2%) and Qwen3-235B-A22B (8.2%) by a substantial margin. In terminal interaction tasks measured by TerminalBench, Kimi-K2-Instruct attains 25.0% using the default Terminus framework and rises to 30% within Moonshot’s in-house agentic framework, underscoring its capabilities in real-world agentic programming scenarios. Moreover, on the Aider-Polyglot benchmark, Kimi-K2-Instruct attains a 60.0% accuracy while employing rigorous decontamination procedures, further illustrating its strength and reliability across diverse coding environments.

Tool Use Tasks. We evaluate multi-turn tool use with two complementary suites: τ2-Bench and ACEBench. τ2-Bench extends the original τ-bench single-control setup to a dual-control environment in which both the agent and an LLMsimulated user have constrained tool affordances over a shared state, adding a realistic Telecom troubleshooting domain alongside the prior Airline/Retail TAU tasks and enabling analysis of coordination vs. pure reasoning. ACEBench is a large bilingual (En/Zh) API-grounded benchmark (4.5K APIs across 8 domains; 2K annotated eval items) partitioned into NORMAL (basic/personalized/atomic), SPECIAL (imperfect or out-of-scope inputs), and AGENT (scenario-driven multi-turn, multi-step sandbox) tracks with automated grading of calls and outcomes. All models run in non-thinking mode; we set the temperature to 0.0, use deterministic tool adapters, score τ2 Airline/Retail/Telecom under Avg@4 seeds with Pass@1/4, and report overall on ACEBench English. Kimi-K2-Instruct averages 66.1 micro Pass@1 across τ2 vs DeepSeek-V3-0324 48.8 / Qwen3-235B-A22B 37.3. On ACEBench Overall Kimi-K2-Instruct scores 76.5 vs DeepSeek 72.7 / Qwen 70.5 and remains competitive with GPT-4.1 (80.1).

Math & STEM & Logical Tasks. For Math tasks, Kimi-K2-Instruct achieves consistently strong performance, averaging over Geimini-2.5-Flash by 5.3 percentage points, over DeepSeek-V3-0324 by 5.5 points and over GPT4.1 by 15.8 points. For example, on AIME 2024, Kimi-K2-Instruct scores 69.6%, outperforming another two top open-source models by a large margin, DeepSeek-V3-0324 by 10.2 points and Qwen3-235B-A22B by 29.5 points. In STEM evaluations, Kimi-K2-Instruct achieves 75.1% on GPQA-Diamond, outperforming DeepSeek-V3-0324 (68.4%) and all non-thinking baselines by at least 5 percentage points. On SuperGPQA, it also exceeds the previous best open-source model, DeepSeek-V3-0324, by 3.5 points. Kimi-K2-Instruct also surpasses the other two leading models in logical reasoning. It achieves 89.0% on ZebraLogic and 89.5% on AutoLogi, exceeding DeepSeek-V3-0324 (84.0%, 88.9%) and substantially outperforming Qwen3-235B-A22B (37.7%, 83.3%).

General Tasks. Kimi-K2-Instruct ties DeepSeek-V3-0324 on MMLU and MMLU-Pro, and takes the lead on MMLU-Redux with a 92.7 EM score—slightly ahead of GPT-4.1 (92.4) and just 1.5 points behind Claude-Opus-4. Beyond multiple-choice tasks, the model achieves 31.0% accuracy on the short-answer SimpleQA—3.3 points above DeepSeek-V3-0324 and more than twice that of Qwen3-235B-A22B—though still below GPT-4.1 (42.3%). On the adversarial free-response LiveBench (2024-11-25 snapshot), it reaches 76.4%, surpassing Claude-Sonnet 4 (74.8%) and leading Gemini 2.5 Flash Preview by 8.6 points. Across this challenging triad measuring breadth, depth, and robustness of world knowledge, Kimi-K2-Instruct secures a top-tier position among open-source models. We evaluate instruction-following with IFEval and Multi-Challenge. On IFEval, Kimi-K2-Instruct scores 89.8%, higher than DeepSeek-V3-0324 (81.1%) and GPT-4.1 (88.0%). On Multi-Challenge, which involves multi-turn dialogues with conflicting instructions, it achieves 54.1%, outperforming DeepSeek-V3-0324 (31.4%), GPT-4.1 (36.4%), and Claude-Opus-4 (49.0%). These results demonstrate that Kimi-K2-Instruct integrates strong factual knowledge with consistent instruction adherence across both single- and multi-turn settings, supporting robust and reliable real-world deployment.

Long Context and Factuality Tasks. To evaluate the factuality of Kimi-K2-Instruct, we employ three benchmarks: FACTS Grounding, which measures adherence to provided documents using the proprietary models GPT-4o, Gemini 1.5 Pro and Claude 3.5 Sonnet; HHEM, which assesses summarization quality via the open-source HHEM-2.1-Open judge; and FaithJudge, which analyzes faithfulness in RAG tasks with o3-mini as the judge. Kimi-K2-Instruct scores 88.5 on FACTS Grounding, substantially outperforming all open-source rivals and even surpassing the closed-source Gemini 2.5 Flash. With HHEM-2.1-Open it achieves a hallucination rate of 1.1 %, reported in the tables as 1 minus the rate, i.e. 98.9. On FaithJudge’s RAG tasks the hallucination rate is 7.4 %, likewise present as 92.6 for table consistency. For long-context capabilities, Kimi-K2-Instruct outperforms all open source and proprietary models on DROP (93.5%), and exceeds DeepSeek-V3-0324 on retrieval task MRCR (55.0% vs 50.8%). For long-context reasoning tasks FRAMES and LongBench v2, Kimi-K2-Instruct (77.1%, 49.1%) lags slightly behind DeepSeek-V3-0324 by around 2%.

![](images/figure_15_chinese_inhouse_benchmark.jpg)

<details>
<summary>bar_stacked</summary>

| Comparison Group | Win (%) | Tie (%) | Loss (%) |
| --- | --- | --- | --- |
| Kimi-K2-Instruct vs DeepSeek-V3-0324 | 59.6 | 23.5 | 16.9 |
| Kimi-K2-Instruct vs Claude-Sonnet-4 | 64.6 | 18.8 | 16.6 |
| Kimi-K2-Instruct vs ChatGPT-4o-latest | 65.4 | 17.6 | 17.0 |
</details>

Figure 11: Chinese in-house benchmark evaluation.

Open-Ended Evaluation Beyond static, closed-ended benchmarks, we evaluate the model’s performance on openended, nuanced tasks that more closely resemble real-world usage.

For English scenarios, we leverage the Arena-Hard-Auto v2.0 benchmark, which use LLM-as-a-judge protocols to assess generation quality across diverse, open-ended prompts [43]. These evaluations cover a wide range of highdifficulty prompts and are widely recognized in the research community. On Arena-Hard-Auto v2.0, Kimi-K2-Instruct achieves state-of-the-art win-rate on both hard prompts (54.5%) and creative writing tasks (85.0%), outperforming all open-source models and rivaling top proprietary systems such as GPT-4.1 and Claude Sonnet. These results underscore the model’s strength in handling complex reasoning and nuanced generation under diverse, unconstrained settings.

However, Arena-Hard-Auto provides limited coverage of Chinese-specific tasks. To address this gap, we developed an in-house held-out benchmark grounded in authentic user queries. To safeguard the integrity of the evaluation, the benchmark data is access-restricted, thereby eliminating the risk of overfitting.

As shown in Figure 11, Kimi-K2-Instruct shows strong performance across all comparisons on Chinese in-house benchmarks. It outperforms ChatGPT-4o-latest with a 65.4% win rate, Claude Sonnet 4 with 64.6%, and DeepSeek-V3- 0324 with 59.6%. In all cases, the loss rate stays low (around 17%), indicating that Kimi-K2-Instruct rarely falls behind. The high win rates and consistent margins demonstrate its strong ability on open-ended Chinese tasks.

In addition to controlled evaluations, we also consider real-world user preference through public human assessments. As of July 17, 2025, Kimi-K2-Instruct ranked as the top open-source model and fifth overall on the LMSYS Arena leaderboard8, based on over 3,000 blind votes from real users. Unlike LLM-as-a-judge protocols, this leaderboard reflects direct human preference on diverse, user-submitted prompts, providing a complementary perspective on practical model performance.

The results on Arena-Hard-Auto, our in-house benchmark and votes from LMSYS Arena collectively offer a comprehensive view of Kimi-K2-Instruct’s open-ended capabilities, showing that it is a highly preferred model in real-world user experience across English and Chinese.

## D QK-Clip Does Not Impair Model Quality

The QK-Clip design follows a minimal intervention principle: it activates only when necessary, and deactivates after training stabilizes. Empirical evidence and analysis converge on its negligible impact on model quality.

![](images/figure_16_qkclip_ablation_loss.jpg)

<details>
<summary>line</summary>

| Training Steps | w/ QK-Clip | w/o QK-Clip |
| -------------- | ---------- | ----------- |
| 0              | 2.85       | 2.85        |
| 2000           | 2.15       | 2.15        |
| 4000           | 2.05       | 2.05        |
| 6000           | 1.98       | 1.98        |
| 8000           | 1.95       | 1.95        |
| 10000          | 1.88       | 1.88        |
| 12000          | 1.85       | 1.85        |
| 14000          | 1.82       | 1.82        |
| 16000          | 1.78       | 1.78        |
| 18000          | 1.75       | 1.75        |
| 20000          | 1.72       | 1.72        |
| 22000          | 1.70       | 1.70        |
| 24000          | 1.68       | 1.68        |
</details>

Figure 12: Applying QK-Clip to Muon in a small-scale setting with an aggresive threshold (τ = 30) has negligible impact on loss, indicating that it is a safe and effective method for constraining attention logits.

Small-Scale Ablations We train two small-scale 0.5B activated and 3B total parameters MoE models, one with vanilla Muon and the other with MuonClip using a low clipping threshold (τ = 30). As shown in Figure 12, applying MuonClip has negligible effects on the loss curve, indicating that even aggressive clipping does not impair convergence or training dynamics with MuonClip. This demonstrates that MuonClip is a safe and effective method for bounding attention logits without degrading model performance. Furthermore, evaluation on downstream tasks reveals no statistically significant degradation in performance. These results collectively demonstrate that MuonClip is a safe and effective method for bounding attention logits without compromising model quality.

Self-deactivation In Kimi K2, QK-Clip was only transiently active:

• Initial 70000 steps: 12.7% of attention heads triggered QK-Clip for at least once, clamping $S _ { \mathrm { m a x } }$ to 100.   
• Post-70000 steps: All heads at some point reduced their $S _ { \mathrm { m a x } }$ below 100, rendering QK-Clip inactive.

When QK-Clip is active, it is applied per-head (rather than per-layer) to minimize potential over-regularization on other heads. After training stabilizes, QK-clip is deactivated and has no effect at all.

## E Why Muon is More Prone to Logit Explosion

Logit explosion occurs when the largest pre-softmax attention score

$$
S _ {\max} = \max _ {i, j} \left(q _ {i} \cdot k _ {j}\right) \tag {1}
$$

grows unboundedly during training. Since

$$
\left| q _ {i} \cdot k _ {j} \right| \leq \left\| q _ {i} \right\| \left\| k _ {j} \right\| \leq \left\| x _ {i} \right\| \left\| x _ {j} \right\| \left\| \mathbf {W} _ {q} \right\| \left\| \mathbf {W} _ {k} \right\|, \tag {2}
$$

and RMS-Norm keeps $\| x _ { i } \| \| x _ { j } \|$ bounded, the phenomenon is primarily driven by the growing spectral-norm of ${ \mathbf { W } } _ { q }$ or $\mathbf { W } _ { k }$ . Empirically, we found that Muon is more susceptible to logit explosion. We give our hypothesis below.

Structural difference in updates Muon produces a weight update coming from the msign operation; as a result, all singular values of the update matrix are equal — its effective rank is full. In contrast, a typical update matrix produced by Adam exhibits a skewed spectrum: a few large singular values dominate, and the effective rank is low. This low-rank assumption for Adam is not new; higher-order muP makes the same assumption.

Such phenomenon is verified on the 16 B Moonlight model, which shows weights trained with Muon exhibit higher singular-value entropy (i.e. higher effective rank) than those trained with Adam, corroborating the theoretical intuition.

SVD formulation Let the parameter matrix at step t − 1 have the singular value decomposition

$$
\mathbf {W} _ {t - 1} = \sum_ {i} \sigma_ {i} u _ {i} v _ {i} ^ {\top} \tag {3}
$$

We write the update matrices as

$$
\Delta \mathbf {W} _ {t} = \sum_ {j} \bar {\sigma} \bar {u} _ {j} \bar {v} _ {j} ^ {\top} \tag {4}
$$

The next parameter update is therefore

$$
\mathbf {W} _ {t} \leftarrow \sum_ {i} \sigma_ {i} u _ {i} v _ {i} ^ {\top} + \sum_ {j} \bar {\sigma} \bar {u} _ {j} \bar {v} _ {j} ^ {\top} \tag {5}
$$

In Muon, as both the weights and the updates have a higher effective rank than Adam, we hypothesize there is a higher probability for singular-vector pair $u _ { i } \nu _ { i } ^ { \top }$ to align with $\bar { u } _ { j } \bar { \nu } _ { j } ^ { \top }$ . This could cause the corresponding singular value of $\mathbf { W } _ { t }$ to increase additively.

Attention-specific amplification Attention logits are computed via the bilinear form

$$
q _ {i} \cdot k _ {j} = (x _ {i} \mathbf {W} _ {q}) \cdot (x _ {j} \mathbf {W} _ {k}). \tag {6}
$$

The product $\mathbf { W } _ { q } \mathbf { W } _ { k } ^ { \top }$ squares the spectral norm, so any singular-value increase in either matrix is compounded. Muon’s tendency to enlarge singular values therefore translates into a higher risk of logit explosion.

## F K2 Critic Rubrics for General RL

### F.1 Core Rubrics

• Clarity and Relevance: Assesses the extent to which the response is succinct while fully addressing the user’s intent. The focus is on eliminating unnecessary detail, staying aligned with the central query, and using efficient formats such as brief paragraphs or compact lists. Unless specifically required, long itemizations should be avoided. When a choice is expected, the response should clearly offer a single, well-defined answer.   
• Conversational Fluency and Engagement: Evaluates the response’s contribution to a natural, flowing dialogue that extends beyond simple question-answering. This includes maintaining coherence, showing appropriate engagement with the topic, offering relevant observations or insights, potentially guiding the conversation constructively when appropriate, using follow-up questions judiciously, handling hypothetical or personal-analogy queries gracefully, and adapting tone effectively to suit the conversational context (e.g., empathetic, formal, casual).   
• Objective and Grounded Interaction: Assesses the response’s ability to maintain an objective and grounded tone, focusing squarely on the substance of the user’s request. It evaluates the avoidance of both metacommentary (analyzing the query’s structure, topic combination, perceived oddity, or the nature of the interaction itself) and unwarranted flattery or excessive praise directed at the user or their input. Excellent responses interact respectfully but neutrally, prioritizing direct, task-focused assistance over commentary on the conversational dynamics or attempts to curry favor through compliments.

### F.2 Prescriptive Rubrics

• Initial Praise: Responses must not begin with compliments directed at the user or the question (e.g., “That’s a beautiful question”, “Good question!”).   
• Explicit Justification: Any sentence or clause that explains why the response is good or how it successfully fulfilled the user’s request. This is different from simply describing the content.

### F.3 Limitations

One potential side effect of this evaluation framework is that it may favor responses that appear confident and assertive, even in contexts involving ambiguity or subjectivity. This stems from two key constraints in the current rubric:

• Avoidance of Self-Qualification: The prescriptive rules prohibit self-assessments, explicit disclaimers, or hedging language $( \mathrm { e . g . }$ , “this may not be accurate”, “I might be wrong”). While these phrases can reflect epistemic humility, they are often penalized as non-informative or performative.   
• Preference for Clarity and Singularity: The rubric reward direct, decisive answers when users ask for a recommendation or explanation. In complex or open-ended scenarios, this may disincentivize appropriately cautious or multi-perspective responses.

As a result, the model may occasionally overstate certainty in areas where ambiguity, nuance, or epistemic modesty would be more appropriate. Future iterations of the framework may incorporate more fine-grained handling of calibrated uncertainty.

## G Engine Switching Pipeline for RL Training

![](images/figure_17_rl_weight_update_3stage.jpg)

<details>
<summary>bar_stacked</summary>

| Device   | H2D   | IPC   | Broadcast (src) | Reload weights | Broadcast (dst) |
|----------|-------|-------|------------------|----------------|-----------------|
| Device 0 | 1     | 1     | 1                | 1              | 1               |
| Device 1 | 1     | 1     | 1                | 1              | 1               |
| Device 2 | 1     | 1     | 1                | 1              | 1               |
| Device 3 | 1     | 1     | 1                | 1              | 1               |
</details>

(a) Theoretical perfect three-stage pipeline weight update   
![](images/figure_18_rl_weight_update_2stage_pcie.jpg)

<details>
<summary>natural_image</summary>

Abstract diagram of interlocking rectangular blocks with blue and orange segments (no text or symbols)
</details>

(b) A PCIE bounded three-stage pipeline

![](images/figure_19_rl_weight_update_2stage_parallel.jpg)

<details>
<summary>natural_image</summary>

Abstract pattern of interlocking blue and orange squares (no text or symbols)
</details>

(c) Fixed two-stage pipeline   
Figure 13: pipeline for RL weight update

The checkpoint engine manages three equal-size device buffers on each GPU: an H2D buffer for loading the offloaded model parameters, and two IPC buffers for GPU-to-GPU broadcast. The IPC buffers are shared to inference engines, allowing it to directly access the same physical memory. These three buffers allow us to arrange the three steps in a pipeline.

Theoretical three-stage pipeline. As illustrated in Figure 13a, a three-stage pipeline is introduced. (1) H2D: a shard of the latest weights is copied into the H2D buffer asynchronously. (2) Broadcast: Once the copy completes, the shard will be copied to one IPC buffers and broadcast to all devices. (3) Reload: Inference engines simultaneously load parameters from the other IPC buffer.

Two-stage pipeline due to PCIe saturation. On NVIDIA H800 clusters, concurrent H2D and broadcast saturate the shared PCIe fabric, collapsing the three stages into a sequential procedure (Figure 13b). We therefore adopt a simpler, two-stage scheme (Figure 13c): (1) All devices perform a single, synchronous H2D transfer. (2) The broadcast and reload proceed in parallel.

The two-stage pipeline will be bound by multiple synchronous H2D copy operations. But in large scale devices, model will be split into small shards, the entire parameter set fits into the H2D buffer in one transfer, the overhead will disappear.

By overlapping H2D, Broadcast, and Reload weights, we can obtain a high bandwidth to reshard the weights from train engines to all inference engines.