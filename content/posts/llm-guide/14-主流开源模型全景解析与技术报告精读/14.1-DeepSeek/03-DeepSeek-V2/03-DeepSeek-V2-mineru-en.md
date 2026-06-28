---
title: "03 · DeepSeek-V2 - MinerU 原始转换(英文)"
source_pdf: pdfs/DeepSeek-V2-Technical-Report.pdf
converted_by: MinerU
date: 2026-05-19
---

# DeepSeek-V2: A Strong, Economical, and Efficient Mixture-of-Experts Language Model

>  **[返回 14.1-DeepSeek 家族总览](../../14.1-DeepSeek.md)**


DeepSeek-AI

research@deepseek.com

## Abstract

We present DeepSeek-V2, a strong Mixture-of-Experts (MoE) language model characterized by economical training and efficient inference. It comprises 236B total parameters, of which 21B are activated for each token, and supports a context length of 128K tokens. DeepSeek-V2 adopts innovative architectures including Multi-head Latent Attention (MLA) and DeepSeekMoE. MLA guarantees efficient inference through significantly compressing the Key-Value (KV) cache into a latent vector, while DeepSeekMoE enables training strong models at an economical cost through sparse computation. Compared with DeepSeek 67B, DeepSeek-V2 achieves significantly stronger performance, and meanwhile saves 42.5% of training costs, reduces the KV cache by 93.3%, and boosts the maximum generation throughput to 5.76 times. We pretrain DeepSeek-V2 on a high-quality and multi-source corpus consisting of 8.1T tokens, and further perform Supervised Fine-Tuning (SFT) and Reinforcement Learning (RL) to fully unlock its potential. Evaluation results show that, even with only 21B activated parameters, DeepSeek-V2 and its chat versions still achieve top-tier performance among open-source models. The model checkpoints are available at https://github.com/deepseek-ai/DeepSeek-V2.

![](images/fig01a_mmlu_accuracy.jpg)
(a)

![](images/fig01b_training_costs.jpg)

![](images/fig01c_kv_cache.jpg)

![](images/fig01d_throughput.jpg)
(b)
Figure 1 | (a) MMLU accuracy vs. activated parameters, among different open-source models. (b) Training costs and inference efficiency of DeepSeek 67B (Dense) and DeepSeek-V2.

## Contents

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

We optimize the attention modules and Feed-Forward Networks (FFNs) within the Transformer framework (Vaswani et al., 2017) with our proposed Multi-head Latent Attention (MLA) and DeepSeekMoE. (1) In the context of attention mechanisms, the Key-Value (KV) cache of the Multi-Head Attention (MHA) (Vaswani et al., 2017) poses a significant obstacle to the inference efficiency of LLMs. Various approaches have been explored to address this issue, including Grouped-Query Attention (GQA) (Ainslie et al., 2023) and Multi-Query Attention (MQA) (Shazeer, 2019). However, these methods often compromise performance in their attempt to reduce the KV cache. In order to achieve the best of both worlds, we introduce MLA, an attention mechanism equipped with low-rank key-value joint compression. Empirically, MLA achieves superior performance compared with MHA, and meanwhile significantly reduces the KV cache during inference, thus boosting the inference efficiency. (2) For Feed-Forward Networks (FFNs), we follow the DeepSeekMoE architecture (Dai et al., 2024), which adopts fine-grained expert segmentation and shared expert isolation for higher potential in expert specialization. The DeepSeekMoE architecture demonstrates great advantages compared with conventional MoE architectures like GShard (Lepikhin et al., 2021), enabling us to train strong models at an economical cost. As we employ expert parallelism during training, we also devise supplementary mechanisms to control communication overheads and ensure load balance. By combining these two techniques, DeepSeek-V2 features strong performance (Figure 1(a)), economical training costs, and efficient inference throughput (Figure 1(b)), simultaneously.

We construct a high-quality and multi-source pre-training corpus consisting of 8.1T tokens. Compared with the corpus used in DeepSeek 67B (our previous release) (DeepSeek-AI, 2024), this corpus features an extended amount of data, especially Chinese data, and higher data quality. We first pretrain DeepSeek-V2 on the full pre-training corpus. Then, we collect 1.5M conversational sessions, which encompass various domains such as math, code, writing, reasoning, safety, and more, to perform Supervised Fine-Tuning (SFT) for DeepSeek-V2 Chat (SFT). Finally, we follow DeepSeekMath (Shao et al., 2024) to employ Group Relative Policy Optimization (GRPO) to further align the model with human preference and produce DeepSeek-V2 Chat (RL).

We evaluate DeepSeek-V2 on a wide range of benchmarks in English and Chinese, and compare it with representative open-source models. Evaluation results show that even with only 21B activated parameters, DeepSeek-V2 still achieves top-tier performance among open-source models and becomes the strongest open-source MoE language model. Figure 1(a) highlights that, on MMLU, DeepSeek-V2 achieves top-ranking performance with only a small number of activated parameters. In addition, as shown in Figure 1(b), compared with DeepSeek 67B, DeepSeek-V2 saves 42.5% of training costs, reduces the KV cache by 93.3%, and boosts the maximum generation throughput to 5.76 times. We also evaluate DeepSeek-V2 Chat (SFT) and

![](images/fig02_architecture.jpg)
Figure 2 | Illustration of the architecture of DeepSeek-V2. MLA ensures efficient inference by significantly reducing the KV cache for generation, and DeepSeekMoE enables training strong models at an economical cost through the sparse architecture.

DeepSeek-V2 Chat (RL) on open-ended benchmarks. Notably, DeepSeek-V2 Chat (RL) achieves 38.9 length-controlled win rate on AlpacaEval 2.0 (Dubois et al., 2024), 8.97 overall score on MT-Bench (Zheng et al., 2023), and 7.91 overall score on AlignBench (Liu et al., 2023). The English open-ended conversation evaluations demonstrate that DeepSeek-V2 Chat (RL) has top-tier performance among open-source chat models. In addition, the evaluation on AlignBench indicates that in Chinese, DeepSeek-V2 Chat (RL) outperforms all of open-source models, and even beats most of closed-source models.

In order to facilitate further research and development on MLA and DeepSeekMoE, we also release DeepSeek-V2-Lite, a smaller model equipped with MLA and DeepSeekMoE, for the open-source community. It has a total of 15.7B parameters, where 2.4B are activated for each token. Detailed descriptions about DeepSeek-V2-Lite can be found in Appendix B.

In the rest of this paper, we first provide a detailed description of the model architecture of DeepSeek-V2 (Section 2). Subsequently, we introduce our pre-training endeavors, including the training data construction, hyper-parameter settings, infrastructures, long context extension, and the evaluation of model performance and efficiency (Section 3). Following this, we demonstrate our efforts in alignment, encompassing Supervised Fine-Tuning (SFT), Reinforcement

Learning (RL), the evaluation results, and other discussion (Section 4). Finally, we summarize the conclusion, deliberate on the current limitations of DeepSeek-V2, and outline our future work (Section 5).

## 2. Architecture

By and large, DeepSeek-V2 is still in the Transformer architecture (Vaswani et al., 2017), where each Transformer block consists of an attention module and a Feed-Forward Network (FFN). However, for both the attention module and the FFN, we design and employ innovative architectures. For attention, we design MLA, which utilizes low-rank key-value joint compression to eliminate the bottleneck of inference-time key-value cache, thus supporting efficient inference. For FFNs, we adopt the DeepSeekMoE architecture (Dai et al., 2024), a high-performance MoE architecture that enables training strong models at an economical cost. An illustration of the architecture of DeepSeek-V2 is presented in Figure 2, and we will introduce the details of MLA and DeepSeekMoE in this section. For other tiny details (e.g., layer normalization and the activation function in FFNs), unless specifically stated, DeepSeek-V2 follows the settings of DeepSeek 67B (DeepSeek-AI, 2024).

### 2.1. Multi-Head Latent Attention: Boosting Inference Efficiency

Conventional Transformer models usually adopts Multi-Head Attention (MHA) (Vaswani et al., 2017), but during generation, its heavy Key-Value (KV) cache will become the bottleneck that limit the inference efficiency. In order to reduce the KV cache, Multi-Query Attention (MQA) (Shazeer, 2019) and Grouped-Query Attention (GQA) (Ainslie et al., 2023) are proposed. They require a smaller magnitude of KV cache, but their performance does not match MHA (we provide the ablation of MHA, GQA and MQA in Appendix D.1).

For DeepSeek-V2, we design an innovative attention mechanism called Multi-head Latent Attention (MLA). Equipped with low-rank key-value joint compression, MLA achieves better performance than MHA, but requires a significantly smaller amount of KV cache. We introduce its architecture in the following, and also provide a comparison between MLA and MHA in Appendix D.2.

#### 2.1.1. Preliminaries: Standard Multi-Head Attention

We first introduce the standard MHA mechanism as background. Let $d$ be the embedding dimension, $n_h$ be the number of attention heads, $d_h$ be the dimension per head, and $\mathbf{h}_t \in \mathbb{R}^d$ be the attention input of the $t$-th token at an attention layer. Standard MHA first produces $\mathbf { q } _ { t } , \mathbf { k } _ { t } , \mathbf { v } _ { t } \in \mathbb { R } ^ { d _ { h } n _ { h } }$ through three matrices $W ^ { Q } , W ^ { K } , W ^ { V } \in \mathbb { R } ^ { d _ { h } n _ { h } \times d }$ , respectively:

$$
\mathbf { q } _ { t } = W ^ { Q } \mathbf { h } _ { t } ,\tag{1}
$$

$$
\mathbf { k } _ { t } = W ^ { K } \mathbf { h } _ { t } ,\tag{2}
$$

$$
\mathbf { v } _ { t } = W ^ { V } \mathbf { h } _ { t } ,\tag{3}
$$

![](images/fig03_attention_comparison.jpg)
Figure 3 | Simplified illustration of Multi-Head Attention (MHA), Grouped-Query Attention (GQA), Multi-Query Attention (MQA), and Multi-head Latent Attention (MLA). Through jointly compressing the keys and values into a latent vector, MLA significantly reduces the KV cache during inference.

Then, $\mathbf { q } _ { t } , \mathbf { k } _ { t } , \mathbf { v } _ { t }$ will be sliced into $n _ { h }$ heads for the multi-head attention computation:

$$
[ \mathbf { q } _ { t , 1 } ; \mathbf { q } _ { t , 2 } ; . . . ; \mathbf { q } _ { t , n _ { h } } ] = \mathbf { q } _ { t } ,\tag{4}
$$

$$
[ { \bf k } _ { t , 1 } ; { \bf k } _ { t , 2 } ; . . . ; { \bf k } _ { t , n _ { h } } ] = { \bf k } _ { t } ,\tag{5}
$$

$$
\left[ \mathbf { v } _ { t , 1 } ; \mathbf { v } _ { t , 2 } ; . . . ; \mathbf { v } _ { t , n _ { h } } \right] = \mathbf { v } _ { t } ,\tag{6}
$$

$$
\mathbf { 0 } _ { t , i } = \sum _ { j = 1 } ^ { t } S \mathrm { o f t m a x } _ { j } ( \frac { \mathbf { q } _ { t , i } ^ { T } \mathbf { k } _ { j , i } } { \sqrt { d _ { h } } } ) \mathbf { v } _ { j , i } ,\tag{7}
$$

$$
\mathbf { u } _ { t } = W ^ { O } [ \mathbf { o } _ { t , 1 } ; \mathbf { o } _ { t , 2 } ; . . . ; \mathbf { o } _ { t , n _ { h } } ] ,\tag{8}
$$

where $\mathbf{q}_{t,i}, \mathbf{k}_{t,i}, \mathbf{v}_{t,i} \in \mathbb{R}^{d_h}$ denote the query, key, and value of the $i$-th attention head, respectively; $W^O \in \mathbb{R}^{d \times d_h n_h}$ denotes the output projection matrix. During inference, all keys and values need to be cached to accelerate inference, so MHA needs to cache $2 n _ { h } d _ { h } l$ elements for each token. In model deployment, this heavy KV cache is a large bottleneck that limits the maximum batch size and sequence length.

#### 2.1.2. Low-Rank Key-Value Joint Compression

The core of MLA is the low-rank joint compression for keys and values to reduce KV cache:

$$
\mathbf { c } _ { t } ^ { K V } = W ^ { D K V } \mathbf { h } _ { t } ,\tag{9}
$$

$$
\mathbf { k } _ { t } ^ { C } = W ^ { U K } \mathbf { c } _ { t } ^ { K V } ,\tag{10}
$$

$$
\mathbf { v } _ { t } ^ { C } = W ^ { U V } \mathbf { c } _ { t } ^ { K V } ,\tag{11}
$$

where $\mathbf{c}_t^{KV} \in \mathbb{R}^{d_c}$ is the compressed latent vector for keys and values; $d_c (\ll d_h n_h)$ denotes the KV compression dimension; $W^{DKV} \in \mathbb{R}^{d_c \times d}$ is the down-projection matrix; and $W^{UK}, W^{UV} \in \mathbb{R}^{d_h n_h \times d_c}$ are the up-projection matrices for keys and values, respectively. During inference, MLA only needs to cache $\mathbf{c}_t^{KV}$, so its KV cache has only $d_c l$ elements, where $l$ denotes the number of layers. In addition, during inference, since $W^{UK}$ can be absorbed into $W^Q$, and $W^{UV}$ can be absorbed into $W^O$, we even do not need to compute keys and values out for attention. Figure 3 intuitively illustrates how the KV joint compression in MLA reduces the KV cache.

Moreover, in order to reduce the activation memory during training, we also perform

low-rank compression for the queries, even if it cannot reduce the KV cache:

$$
\begin{array} { r } { \mathbf { c } _ { t } ^ { Q } = { W } ^ { { D Q } } \mathbf { h } _ { t } , } \end{array}\tag{12}
$$

$$
\mathbf { q } _ { t } ^ { C } = W ^ { U Q } \mathbf { c } _ { t } ^ { Q } ,\tag{13}
$$

where $\mathbf { c } _ { t } ^ { Q } \in \mathbb { R } ^ { d _ { c } ^ { \prime } }$ is the compressed latent vector for queries; $d _ { c } ^ { \prime } ( \ll \ d _ { h } n _ { h } )$ denotes the query compression dimension; and $W ^ { D Q } \in \mathbb { R } ^ { d _ { c } ^ { \prime } \times d } , W ^ { U Q } \in \mathbb { R } ^ { \hat { d _ { h } } n _ { h } \times d _ { c } ^ { \prime } }$ are the down-projection and upprojection matrices for queries, respectively.

#### 2.1.3. Decoupled Rotary Position Embedding

Following DeepSeek 67B (DeepSeek-AI, 2024), we intend to use the Rotary Position Embedding (RoPE) (Su et al., 2024) for DeepSeek-V2. However, RoPE is incompatible with low-rank KV compression. To be specific, RoPE is position-sensitive for both keys and queries. If we apply RoPE for the keys $\mathbf { k } _ { t } ^ { C } , W ^ { \tilde { U } K }$ in Equation 10 will be coupled with a position-sensitive RoPE matrix. In this way, $W ^ { U { \bf { \breve { K } } } }$ cannot be absorbed into $W ^ { Q }$ any more during inference, since a RoPE matrix related to the currently generating token will lie between $W ^ { Q }$ and $W ^ { U K }$ and matrix multiplication does not obey a commutative law. As a result, we must recompute the keys for all the prefix tokens during inference, which will significantly hinder the inference efficiency.

As a solution, we propose the decoupled RoPE strategy that uses additional multi-head queries $\mathbf { q } _ { t , i } ^ { R } \in \mathbb { R } ^ { d _ { h } ^ { R } }$ and a shared key $\mathbf { k } _ { t } ^ { R } \in \mathbb { R } ^ { d _ { h } ^ { R } }$ to carry RoPE, where $d _ { h } ^ { R }$ denotes the per-head dimension of the decoupled queries and key. Equipped with the decoupled RoPE strategy, MLA performs the following computation:

$$
[ \mathbf { q } _ { t , 1 } ^ { R } ; \mathbf { q } _ { t , 2 } ^ { R } ; . . . ; \mathbf { q } _ { t , n _ { h } } ^ { R } ] = \mathbf { q } _ { t } ^ { R } = \mathrm { R o P E } ( W ^ { Q R } \mathbf { c } _ { t } ^ { Q } ) ,\tag{14}
$$

$$
\mathbf { k } _ { t } ^ { R } = \mathrm { R o P E } ( W ^ { K R } \mathbf { h } _ { t } ) ,\tag{15}
$$

$$
\mathbf { q } _ { t , i } = [ \mathbf { q } _ { t , i } ^ { C } ; \mathbf { q } _ { t , i } ^ { R } ] ,\tag{16}
$$

$$
\mathbf { k } _ { t , i } = [ \mathbf { k } _ { t , i } ^ { C } ; \mathbf { k } _ { t } ^ { R } ] ,\tag{17}
$$

$$
{ \bf 0 } _ { t , i } = \sum _ { j = 1 } ^ { t } { \cal S } \mathrm { o f t m a x } _ { j } ( \frac { { \bf q } _ { t , i } ^ { T } { \bf k } _ { j , i } } { \sqrt { d _ { h } + d _ { h } ^ { R } } } ) { \bf v } _ { j , i } ^ { C } ,\tag{18}
$$

$$
\mathbf { u } _ { t } = W ^ { O } [ \mathbf { o } _ { t , 1 } ; \mathbf { o } _ { t , 2 } ; . . . ; \mathbf { o } _ { t , n _ { h } } ] ,\tag{19}
$$

where $W ^ { Q R } \in \mathbb { R } ^ { d _ { h } ^ { R } n _ { h } \times d _ { c } ^ { \prime } }$ and $W ^ { K R } \in \mathbb { R } ^ { d _ { h } ^ { R } \times d }$ are matrices to produce the decouples queries and key, respectively; RoPE(·) denotes the operation that applies RoPE matrices; and $[ \cdot ; \cdot ]$ denotes the concatenation operation. During inference, the decoupled key should also be cached. Therefore, DeepSeek-V2 requires a total KV cache containing $( d _ { c } + d _ { h } ^ { R } ) l$ elements.

In order to demonstrate the complete computation process of MLA, we also organize and provide its full formulas in Appendix C.

#### 2.1.4. Comparison of Key-Value Cache

We demonstrate a comparison of the KV cache per token among different attention mechanisms in Table 1. MLA requires only a small amount of KV cache, equal to GQA with only 2.25 groups, but can achieve stronger performance than MHA.

<table><tr><td>Attention Mechanism</td><td>KV Cache per Token (# Element)</td><td>Capability</td></tr><tr><td>Multi-Head Attention (MHA)</td><td> $2 n _ { h } d _ { h } l$ </td><td>Strong</td></tr><tr><td>Grouped-Query Attention (GQA)</td><td> $2 n _ { g } d _ { h } l$ </td><td>Moderate</td></tr><tr><td>Multi-Query Attention (MQA)</td><td> $2 d _ { h } l$ </td><td>Weak</td></tr><tr><td>MLA (Ours)</td><td> $\begin{array} { r } { ( d _ { c } + d _ { h } ^ { R } ) l \approx \frac { 9 } { 2 } d _ { h } l } \end{array}$ </td><td>Stronger</td></tr></table>

Table 1 
| Comparison of the KV cache per token among different attention mechanisms. $n_h$ denotes the number of attention heads, $d_h$ denotes the dimension per attention head, $l$ denotes the number of layers, $n_g$ denotes the number of groups in GQA, and $d_c$ and $d_h^R$ denote the KV compression dimension and the per-head dimension of the decoupled queries and key in MLA, respectively. The amount of KV cache is measured by the number of elements, regardless of the storage precision. For DeepSeek-V2, $d_c$ is set to $4 d_h$ and $d_h^R$ is set to $\frac{d_h}{2}$. So, its KV cache is equal to GQA with only 2.25 groups, but its performance is stronger than MHA.

### 2.2. DeepSeekMoE: Training Strong Models at Economical Costs

#### 2.2.1. Basic Architecture

For FFNs, we employ the DeepSeekMoE architecture (Dai et al., 2024). DeepSeekMoE has two key ideas: segmenting experts into finer granularity for higher expert specialization and more accurate knowledge acquisition, and isolating some shared experts for mitigating knowledge redundancy among routed experts. With the same number of activated and total expert parameters, DeepSeekMoE can outperform conventional MoE architectures like GShard (Lepikhin et al., 2021) by a large margin.

Let $\mathbf{u}_t$ be the FFN input of the $t$-th token, we compute the FFN output $\mathbf{h}_t^\prime$ as follows:

$$
\mathbf { h } _ { t } ^ { \prime } = \mathbf { u } _ { t } + \sum _ { i = 1 } ^ { N _ { s } } \mathrm { F F N } _ { i } ^ { ( s ) } \left( \mathbf { u } _ { t } \right) + \sum _ { i = 1 } ^ { N _ { r } } g _ { i , t } \mathrm { F F N } _ { i } ^ { ( r ) } \left( \mathbf { u } _ { t } \right) ,\tag{20}
$$

$$
g _ { i , t } = \left\{ \begin{array} { l l } { s _ { i , t } , } & { s _ { i , t } \in \mathrm { T o p k } ( \{ s _ { j , t } | 1 \leqslant j \leqslant N _ { r } \} , K _ { r } ) , } \\ { 0 , } & { \mathrm { o t h e r w i s e } , } \end{array} \right.\tag{21}
$$

$$
{ s } _ { i , t } = \mathrm { S o f t m a x } _ { i } \left( \mathbf { u } _ { t } ^ { { T } } \mathbf { e } _ { i } \right) ,\tag{22}
$$

where $N_s$ and $N_r$ denote the numbers of shared experts and routed experts, respectively; $\mathrm{FFN}_i^{(s)}(\cdot)$ and $\mathrm{FFN}_i^{(r)}(\cdot)$ denote the $i$-th shared expert and the $i$-th routed expert, respectively; $K_r$ denotes the number of activated routed experts; $g_{i,t}$ is the gate value for the $i$-th expert; $s_{i,t}$ is the token-to-expert affinity; $\mathbf{e}_i$ is the centroid of the $i$-th routed expert in this layer; and Topk(·, $K$) denotes the set comprising $K$ highest scores among the affinity scores calculated for the $t$-th token and all routed experts.

#### 2.2.2. Device-Limited Routing

We design a device-limited routing mechanism to bound MoE-related communication costs. When expert parallelism is employed, the routed experts will be distributed across multiple devices. For each token, its MoE-related communication frequency is proportional to the number of devices covered by its target experts. Due to the fine-grained expert segmentation in DeepSeekMoE, the number of activated experts can be large, so the MoE-related communication will be more costly if we apply expert parallelism.

For DeepSeek-V2, beyond the naive top-K selection of routed experts, we additionally ensure that the target experts of each token will be distributed on at most $M$ devices. To be specific, for each token, we first select $M$ devices that have experts with the highest affinity scores in them. Then, we perform top-K selection among experts on these $M$ devices. In practice, we find that when $M \geqslant 3$, the device-limited routing can achieve a good performance roughly aligned with the unrestricted top-K routing.

#### 2.2.3. Auxiliary Loss for Load Balance

We take the load balance into consideration for automatically learned routing strategies. Firstly, unbalanced load will raise the risk of routing collapse (Shazeer et al., 2017), preventing some experts being fully trained and utilized. Secondly, when expert parallelism is employed, unbalanced load will diminish computation efficiency. During the training of DeepSeek-V2, we design three kinds of auxiliary losses, for controlling expert-level load balance $( \mathcal { L } _ { \mathrm { E x p B a l } } )$ , device-level load balance $( \mathcal { L } _ { \mathrm { D e v B a l } } )$ , and communication balance $\left( \mathcal { L } _ { \mathrm { { C o m m B a l } } } \right)$ , respectively.

Expert-Level Balance Loss. We use an expert-level balance loss (Fedus et al., 2021; Lepikhin et al., 2021) to mitigate the risk of routing collapse:

$$
\mathcal { L } _ { \mathrm { E x p B a l } } = \alpha _ { 1 } \sum _ { i = 1 } ^ { N _ { r } } f _ { i } P _ { i } ,\tag{23}
$$

$$
f _ { i } = \frac { { N _ { r } } } { { K _ { r } } T } \sum _ { t = 1 } ^ { T } { 1 \left( { \mathrm { T o k e n } } t { \mathrm { s e l e c t s } } \mathrm { E x p e r t } i \right) } ,\tag{24}
$$

$$
P _ { i } = \frac { 1 } { T } \sum _ { t = 1 } ^ { T } s _ { i , t } ,\tag{25}
$$

where $\alpha_1$ is a hyper-parameter called expert-level balance factor; $\mathbf{1}(\cdot)$ denotes the indicator function; and $T$ denotes the number of tokens in a sequence.

Device-Level Balance Loss. In addition to the expert-level balance loss, we additionally design a device-level balance loss to ensure balanced computation across different devices. In the training process of DeepSeek-V2, we partition all routed experts into $D$ groups $\{\mathcal{E}_1, \mathcal{E}_2, ..., \mathcal{E}_D\}$ and deploy each group on a single device. The device-level balance loss is computed as follows:

$$
\mathcal { L } _ { \mathrm { { D e v B a l } } } = \alpha _ { 2 } \sum _ { i = 1 } ^ { D } f _ { i } ^ { \prime } P _ { i } ^ { \prime } ,\tag{26}
$$

$$
f _ { i } ^ { \prime } = \frac { 1 } { \left| \mathcal { E } _ { i } \right| } \sum _ { j \in \mathcal { E } _ { i } } f _ { j } ,\tag{27}
$$

$$
P _ { i } ^ { \prime } = \sum _ { j \in \mathscr { E } _ { i } } P _ { j } ,\tag{28}
$$

where $\alpha _ { 2 }$ is a hyper-parameter called device-level balance factor.

Communication Balance Loss. Finally, we introduce a communication balance loss to ensure that the communication of each device is balanced. Although the device-limited routing mechanism guarantees that the sending communication of each device is bounded, if a certain device

receives more tokens than other devices, the practical communication efficiency will also be affected. In order to mitigate this issue, we design a communication balance loss as follows:

$$
\mathcal { L } _ { \mathrm { C o m m B a l } } = \alpha _ { 3 } \sum _ { i = 1 } ^ { D } f _ { i } ^ { \prime \prime } P _ { i } ^ { \prime \prime } ,\tag{29}
$$

$$
f _ { i } ^ { \prime \prime } = \frac { D } { M T } \sum _ { t = 1 } ^ { T } 1 1 ( \mathrm { T o k e n } t \mathrm { i s ~ s e n t ~ t o ~ D e v i c e } \ i ) ,\tag{30}
$$

$$
P _ { i } ^ { \prime \prime } = \sum _ { j \in \mathscr { E } _ { i } } P _ { j } ,\tag{31}
$$

where $\alpha_3$ is a hyper-parameter called communication balance factor. The device-limited routing mechanism operates on the principle of ensuring that each device transmits at most $\frac{K_r T}{D}$ hidden states to other devices. Simultaneously, the communication balance loss is employed to encourage each device to receive around $\frac{K_r T}{D}$ hidden states from other devices. The communication balance loss guarantees a balanced exchange of information among devices, promoting efficient communications.

#### 2.2.4. Token-Dropping Strategy

While balance losses aim to encourage a balanced load, it is important to acknowledge that they cannot guarantee a strict load balance. In order to further mitigate the computation wastage caused by unbalanced load, we introduce a device-level token-dropping strategy during training. This approach first computes the average computational budget for each device, which means that the capacity factor for each device is equivalent to 1.0. Then, inspired by Riquelme et al. (2021), we drop tokens with the lowest affinity scores on each device until reaching the computational budget. In addition, we ensure that the tokens belonging to approximately 10% of the training sequences will never be dropped. In this way, we can flexibly decide whether to drop tokens during inference according to the efficiency requirements, and always ensure consistency between training and inference.

## 3. Pre-Training

### 3.1. Experimental Setups

#### 3.1.1. Data Construction

While maintaining the same data processing stages as for DeepSeek 67B (DeepSeek-AI, 2024), we extend the amount of data and elevate the data quality. In order to enlarge our pre-training corpus, we explore the potential of the internet data and optimize our cleaning processes, thus recovering a large amount of mistakenly deleted data. Moreover, we incorporate more Chinese data, aiming to better leverage the corpus available on the Chinese internet. In addition to the amount of data, we also focus on the data quality. We enrich our pre-training corpus with high-quality data from various sources, and meanwhile improve the quality-based filtering algorithm. The improved algorithm ensures that a large amount of non-beneficial data will be removed, while the valuable data will be mostly retained. In addition, we filter out the contentious content from our pre-training corpus to mitigate the data bias introduced from specific regional cultures. A detailed discussion about the influence of this filtering strategy is presented in Appendix E.

We adopt the same tokenizer as used in DeepSeek 67B, which is built based on the Byte-level Byte-Pair Encoding (BBPE) algorithm and has a vocabulary size of 100K. Our tokenized pretraining corpus contains 8.1T tokens, where Chinese tokens are approximately 12% more than English ones.

#### 3.1.2. Hyper-Parameters

Model Hyper-Parameters. We set the number of Transformer layers to 60 and the hidden dimension to 5120. All learnable parameters are randomly initialized with a standard deviation of 0.006. In MLA, we set the number of attention heads $n _ { h }$ to 128 and the per-head dimension $d _ { h }$ to 128. The KV compression dimension $d _ { c }$ is set to 512, and the query compression dimension $d _ { c } ^ { \prime }$ is set to 1536. For the decoupled queries and key, we set the per-head dimension $d _ { h } ^ { R }$ to 64. Following Dai et al. (2024), we substitute all FFNs except for the first layer with MoE layers. Each MoE layer consists of 2 shared experts and 160 routed experts, where the intermediate hidden dimension of each expert is 1536. Among the routed experts, 6 experts will be activated for each token. In addition, the low-rank compression and fine-grained expert segmentation will impact the output scale of a layer. Therefore, in practice, we employ additional RMS Norm layers after the compressed latent vectors, and multiply additional scaling factors at the width bottlenecks (i.e., the compressed latent vectors and the intermediate hidden states of routed experts) to ensure stable training. Under this configuration, DeepSeek-V2 comprises 236B total parameters, of which 21B are activated for each token.

Training Hyper-Parameters. We employ the AdamW optimizer (Loshchilov and Hutter, 2017) with hyper-parameters set to $\beta_1 = 0.9$, $\beta_2 = 0.95$, and weight\_decay = 0.1. The learning rate is scheduled using a warmup-and-step-decay strategy (DeepSeek-AI, 2024). Initially, the learning rate linearly increases from 0 to the maximum value during the first 2K steps. Subsequently, the learning rate is multiplied by 0.316 after training about 60% of tokens, and again by 0.316 after training about 90% of tokens. The maximum learning rate is set to $2.4 \times 10^{-4}$, and the gradient clipping norm is set to 1.0. We also use a batch size scheduling strategy, where the batch size is gradually increased from 2304 to 9216 in the training of the first 225B tokens, and then keeps 9216 in the remaining training. We set the maximum sequence length to 4K, and train DeepSeek-V2 on 8.1T tokens. We leverage pipeline parallelism to deploy different layers of a model on different devices, and for each layer, the routed experts will be uniformly deployed on 8 devices ($D = 8$). As for the device-limited routing, each token will be sent to at most 3 devices ($M = 3$). As for balance losses, we set $\alpha_1$ to 0.003, $\alpha_2$ to 0.05, and $\alpha_3$ to 0.02. We employ the token-dropping strategy during training for acceleration, but do not drop any tokens for evaluation.

#### 3.1.3. Infrastructures

DeepSeek-V2 is trained based on the HAI-LLM framework (High-flyer, 2023), an efficient and light-weight training framework developed internally by our engineers. It employs a 16-way zero-bubble pipeline parallelism (Qi et al., 2023), an 8-way expert parallelism (Lepikhin et al., 2021), and ZeRO-1 data parallelism (Rajbhandari et al., 2020). Given that DeepSeek-V2 has relatively few activated parameters, and a portion of the operators are recomputed to save activation memory, it can be trained without the necessity of tensor parallelism, thereby decreasing the communication overhead. Moreover, in order to further improve the training efficiency, we overlap the computation of shared experts with the expert parallel all-to-all communication. We also customize faster CUDA kernels for communications, routing algorithms, and fused linear computations across different experts. In addition, MLA is also optimized based on an improved version of FlashAttention-2 (Dao, 2023).

Pressure Testing DeepSeek-V2 Base 128K Context via "Needle In A HayStack"  
![](images/fig04_niah_test.jpg)
Figure 4 | Evaluation results on the “Needle In A Haystack” (NIAH) tests. DeepSeek-V2 performs well across all context window lengths up to 128K.

We conduct all experiments on a cluster equipped with NVIDIA H800 GPUs. Each node in the H800 cluster contains 8 GPUs connected using NVLink and NVSwitch within nodes. Across nodes, InfiniBand interconnects are utilized to facilitate communications.

#### 3.1.4. Long Context Extension

After the initial pre-training of DeepSeek-V2, we employ YaRN (Peng et al., 2023) to extend the default context window length from 4K to 128K. YaRN was specifically applied to the decoupled shared key $\mathbf{k}_t^R$ as it is responsible for carrying RoPE (Su et al., 2024). For YaRN, we set the scale $s$ to 40, $\alpha$ to 1, $\beta$ to 32, and the target maximum context length to 160K. Under these settings, we can expect the model to respond well for a context length of 128K. Slightly diverging from original YaRN, due to our distinct attention mechanism, we adjust the length scaling factor to modulate the attention entropy. The factor $t$ is computed as $t = 0.0707 \ln s + 1$, aiming at minimizing the perplexity.

We additionally train the model for 1000 steps, with a sequence length of 32K and a batch size of 576 sequences. Although the training is conducted solely at the sequence length of 32K, the model still demonstrates robust performance when being evaluated at a context length of 128K. As shown in Figure 4, the results on the “Needle In A Haystack” (NIAH) tests indicate that DeepSeek-V2 performs well across all context window lengths up to 128K.

### 3.2. Evaluations

#### 3.2.1. Evaluation Benchmarks

DeepSeek-V2 is pretrained on a bilingual corpus, so we evaluate it on a series of benchmarks in English and Chinese. Our evaluation is based on our internal evaluation framework integrated in our HAI-LLM framework. Included benchmarks are categorized and listed as follows, where underlined benchmarks are in Chinese:

Multi-subject multiple-choice datasets include MMLU (Hendrycks et al., 2020), C-Eval (Huang et al., 2023), and CMMLU (Li et al., 2023).

Language understanding and reasoning datasets include HellaSwag (Zellers et al., 2019), PIQA (Bisk et al., 2020), ARC (Clark et al., 2018), and BigBench Hard (BBH) (Suzgun et al., 2022).

Closed-book question answering datasets include TriviaQA (Joshi et al., 2017) and NaturalQuestions (Kwiatkowski et al., 2019).

Reading comprehension datasets include RACE (Lai et al., 2017), DROP (Dua et al., 2019), C3 (Sun et al., 2019), and CMRC (Cui et al., 2019).

Reference disambiguation datasets include WinoGrande (Sakaguchi et al., 2019) and CLUEWSC (Xu et al., 2020).

Language modeling datasets include Pile (Gao et al., 2020).

Chinese understanding and culture datasets include CHID (Zheng et al., 2019) and CCPM (Li et al., 2021).

Math datasets include GSM8K (Cobbe et al., 2021), MATH (Hendrycks et al., 2021), and CMath (Wei et al., 2023).

Code datasets include HumanEval (Chen et al., 2021), MBPP (Austin et al., 2021), and CRUXEval (Gu et al., 2024).

Standardized exams include AGIEval (Zhong et al., 2023). Note that AGIEval includes both English and Chinese subsets.

Following our previous work (DeepSeek-AI, 2024), we adopt perplexity-based evaluation for datasets including HellaSwag, PIQA, WinoGrande, RACE-Middle, RACE-High, MMLU, ARC-Easy, ARC-Challenge, CHID, C-Eval, CMMLU, C3, and CCPM, and adopt generation-based evaluation for TriviaQA, NaturalQuestions, DROP, MATH, GSM8K, HumanEval, MBPP, CRUXEval, BBH, AGIEval, CLUEWSC, CMRC, and CMath. In addition, we perform language-modeling-based evaluation for Pile-test and use Bits-Per-Byte (BPB) as the metric to guarantee fair comparison among models with different tokenizers.

For an intuitive overview of these benchmarks, we additionally provide our evaluation formats for each benchmark in Appendix G.

#### 3.2.2. Evaluation Results

In Table 2, we compare DeepSeek-V2 with several representative open-source models, including DeepSeek 67B (DeepSeek-AI, 2024) (our previous release), Qwen1.5 72B (Bai et al., 2023), LLaMA3 70B (AI@Meta, 2024), and Mixtral 8x22B (Mistral, 2024). We evaluate all these models with our internal evaluation framework, and ensure that they share the same evaluation setting. Overall, with only 21B activated parameters, DeepSeek-V2 significantly outperforms DeepSeek 67B on almost all benchmarks, and achieves top-tier performance among open-source models.

Further, we elaborately compare DeepSeek-V2 with its open-source counterparts one by one. (1) Compared with Qwen1.5 72B, another model that supports both Chinese and English, DeepSeek-V2 demonstrates overwhelming advantages on the majority of English, code, and math benchmarks. As for Chinese benchmarks, Qwen1.5 72B shows better performance on multi-subject multiple-choice tasks while DeepSeek-V2 is comparable or better on others. Note that for the CHID benchmark, the tokenizer of Qwen1.5 72B will encounter errors in our evaluation framework, so we leave the CHID score blank for Qwen1.5 72B. (2) Compared with Mixtral 8x22B, DeepSeek-V2 achieves comparable or better English performance, except for TriviaQA, NaturalQuestions, and HellaSwag, which are closely related to English commonsense knowledge. Notably, DeepSeek-V2 outperforms Mixtral 8x22B on MMLU. On code and math benchmarks, DeepSeek-V2 demonstrates comparable performance with Mixtral 8x22B. Since Mixtral 8x22B is not specifically trained on Chinese data, its Chinese capability lags far behind DeepSeek-V2. (3) Compared with LLaMA3 70B, DeepSeek-V2 is trained on fewer than a quarter of English tokens. Therefore, we acknowledge that DeepSeek-V2 still has a slight gap in basic English capabilities with LLaMA3 70B. However, even with much fewer training tokens and activated parameters, DeepSeek-V2 still demonstrates comparable code and math capability with LLaMA3 70B. Also, as a bilingual language model, DeepSeek-V2 outperforms LLaMA3

<table><tr><td rowspan=1 colspan=2>Benchmark (Metric)    # Shots</td><td rowspan=1 colspan=1>DeepSeek67B</td><td rowspan=1 colspan=1>Qwen1.5 Mixtral LLaMA 372B     8x22B     70B</td><td rowspan=1 colspan=1>DeepSeek-V2</td></tr><tr><td rowspan=2 colspan=2>Architecture# Activated Params# Total Params</td><td rowspan=2 colspan=1>Dense67B67B</td><td rowspan=1 colspan=1>Dense     MoE     Dense72B      39B      70B</td><td rowspan=2 colspan=1>MoE21B236B</td></tr><tr><td rowspan=1 colspan=1>72B      141B      70B</td></tr><tr><td rowspan=1 colspan=2>Pile-test (BPB)</td><td rowspan=1 colspan=1>0.642</td><td rowspan=1 colspan=1>0.637     0.623     0.602</td><td rowspan=1 colspan=1>0.606</td></tr><tr><td rowspan=1 colspan=2>BBH (EM)                3-shot</td><td rowspan=1 colspan=1>68.7</td><td rowspan=1 colspan=1>59.9      78.9      81.0</td><td rowspan=1 colspan=1>78.9</td></tr><tr><td rowspan=1 colspan=2>MMLU (Åcc.)             5-shot</td><td rowspan=1 colspan=1>71.3</td><td rowspan=1 colspan=1>77.2      77.6      78.9</td><td rowspan=1 colspan=1>78.5</td></tr><tr><td rowspan=1 colspan=2>DROP (F1)                3-shot</td><td rowspan=1 colspan=1>69.7</td><td rowspan=1 colspan=1>71.5      80.4      82.5</td><td rowspan=1 colspan=1>80.1</td></tr><tr><td rowspan=1 colspan=2>ARC-Easy (Acc.)         25-shot</td><td rowspan=1 colspan=1>95.3</td><td rowspan=1 colspan=1>97.1      97.3      97.9</td><td rowspan=1 colspan=1>97.6</td></tr><tr><td rowspan=2 colspan=2>ARC-Challenge (Acc.)   25-shotHellaSwag (Acc.)        10-shot</td><td rowspan=1 colspan=1>86.4</td><td rowspan=1 colspan=1>92.8      91.2      93.3</td><td rowspan=1 colspan=1>92.4</td></tr><tr><td rowspan=1 colspan=1>86.3</td><td rowspan=1 colspan=1>85.8      86.6      87.9</td><td rowspan=1 colspan=1>84.2</td></tr><tr><td rowspan=2 colspan=2>PIQA (Acc.)              0-shotEnglishWinoGrande (Acc.)      5-shot</td><td rowspan=1 colspan=1>83.6</td><td rowspan=1 colspan=1>83.3      83.6      85.0</td><td rowspan=1 colspan=1>83.7</td></tr><tr><td rowspan=1 colspan=1>84.9</td><td rowspan=1 colspan=1>82.4      83.7      85.7</td><td rowspan=1 colspan=1>84.9</td></tr><tr><td rowspan=1 colspan=2>RACE-Middle (Acc.)     5-shot</td><td rowspan=1 colspan=1>69.9</td><td rowspan=1 colspan=1>63.4      73.3      73.3</td><td rowspan=1 colspan=1>73.1</td></tr><tr><td rowspan=1 colspan=2>RACE-High (Acc.)       5-shot</td><td rowspan=1 colspan=1>50.7</td><td rowspan=1 colspan=1>47.0      56.7      57.9</td><td rowspan=1 colspan=1>52.7</td></tr><tr><td rowspan=1 colspan=2>TriviaQA (EM)           5-shot</td><td rowspan=1 colspan=1>78.9</td><td rowspan=1 colspan=1>73.1      82.1      81.6</td><td rowspan=1 colspan=1>79.9</td></tr><tr><td rowspan=2 colspan=2>NaturalQuestions (EM)  5-shotAGIEval (Acc.)           0-shot</td><td rowspan=1 colspan=1>36.6</td><td rowspan=1 colspan=1>35.6      39.6      40.2</td><td rowspan=1 colspan=1>38.7</td></tr><tr><td rowspan=1 colspan=1>41.3</td><td rowspan=1 colspan=1>64.4      43.4      49.8</td><td rowspan=1 colspan=1>51.2</td></tr><tr><td rowspan=3 colspan=2>HumanEval (Pass@1)    0-shotMBPP (Pass@1)          3-shotCodeCRUXEval-I (Acc.)       2-shotCRUXEval-O (Acc.)      2-shot</td><td rowspan=1 colspan=1>45.1</td><td rowspan=3 colspan=1>43.9      53.1      48.253.6      64.2      68.644.3      52.4      49.442.3      52.8      54.3</td><td rowspan=3 colspan=1>48.866.652.849.8</td></tr><tr><td rowspan=1 colspan=1>57.4</td></tr><tr><td rowspan=1 colspan=1>42.541.0</td></tr><tr><td rowspan=2 colspan=2>GSM8K (EM)             8-shotMath   MATH (EM)              4-shotCMath (EM)              3-shot</td><td rowspan=1 colspan=1>63.4</td><td rowspan=2 colspan=1>77.9      80.3      83.041.4      42.5      42.277.8      72.3      73.9</td><td rowspan=2 colspan=1>79.243.678.7</td></tr><tr><td rowspan=1 colspan=1>18.763.0</td></tr><tr><td rowspan=7 colspan=2>CLUEWSC (EM)         5-shotC-Eval (Acc.)             5-shotCMMLU (Acc.)Chinese CMRC (EM)              1-shotC3 (Acc.)                  0-shotCHID (Acc.)              0-shotCCPM (Acc.)             0-shot</td><td rowspan=1 colspan=1>81.0</td><td rowspan=1 colspan=1>80.5      77.5      78.3</td><td rowspan=7 colspan=1>82.281.784.077.577.492.793.1</td></tr><tr><td rowspan=1 colspan=1>66.1</td><td rowspan=1 colspan=1>83.7      59.6      67.5</td></tr><tr><td rowspan=1 colspan=1>5-shot</td><td rowspan=1 colspan=1>70.8</td><td rowspan=4 colspan=1>84.3      60.0      69.366.6      73.1      73.378.2      71.4      74.0-       57.0      83.2</td></tr><tr><td rowspan=1 colspan=1>73.4</td></tr><tr><td rowspan=1 colspan=1>75.3</td></tr><tr><td rowspan=1 colspan=1>92.1</td></tr><tr><td rowspan=1 colspan=1>88.5</td><td rowspan=1 colspan=1>88.1      61.0      68.1</td></tr></table>

Table 2 | Comparison among DeepSeek-V2 and other representative open-source models. All models are evaluated in our internal framework and share the same evaluation setting. Bold denotes the best and underline denotes the second-best. Scores with a gap smaller than 0.3 are regarded as at the same level. With only 21B activated parameters, DeepSeek-V2 achieves top-tier performance among open-source models.

70B overwhelmingly on Chinese benchmarks.

Finally, it is worth mentioning that certain prior studies (Hu et al., 2024) incorporate SFT data during the pre-training stage, whereas DeepSeek-V2 has never been exposed to SFT data during pre-training.

#### 3.2.3. Training and Inference Efficiency

Training Costs. Since DeepSeek-V2 activates fewer parameters for each token and requires fewer FLOPs than DeepSeek 67B, training DeepSeek-V2 will be more economical than training DeepSeek 67B theoretically. Although training an MoE model will introduce additional communication overheads, through our operator and communication optimizations, the training for DeepSeek-V2 can attain a relatively high Model FLOPs Utilization (MFU). During our practical training on the H800 cluster, for training on each trillion tokens, DeepSeek 67B requires 300.6K GPU hours, while DeepSeek-V2 needs only 172.8K GPU hours, i.e., sparse DeepSeek-V2 can save 42.5% training costs compared with dense DeepSeek 67B.

Inference Efficiency. In order to efficiently deploy DeepSeek-V2 for service, we first convert its parameters into the precision of FP8. In addition, we also perform KV cache quantization (Hooper et al., 2024; Zhao et al., 2023) for DeepSeek-V2 to further compress each element in its KV cache into 6 bits on average. Benefiting from MLA and these optimizations, actually deployed DeepSeek-V2 requires significantly less KV cache than DeepSeek 67B, and thus can serve a much larger batch size. We evaluate the generation throughput of DeepSeek-V2 based on the prompt and generation length distribution from the actually deployed DeepSeek 67B service. On a single node with 8 H800 GPUs, DeepSeek-V2 achieves a generation throughput exceeding 50K tokens per second, which is 5.76 times the maximum generation throughput of DeepSeek 67B. In addition, the prompt input throughput of DeepSeek-V2 exceeds 100K tokens per second.

## 4. Alignment

### 4.1. Supervised Fine-Tuning

Building upon our prior research (DeepSeek-AI, 2024), we curate our instruction tuning datasets to include 1.5M instances, comprising 1.2M instances for helpfulness and 0.3M instances for safety. In comparison to the initial version, we improve the data quality to mitigate hallucinatory responses and enhance writing proficiency. We fine-tune DeepSeek-V2 with 2 epochs, and the learning rate is set to $5 \times 1 0 ^ { - \bar { 6 } }$ . For the evaluation of DeepSeek-V2 Chat (SFT), we mainly include generation-based benchmarks, except for several representative multiple-choice tasks (MMLU and ARC). We also conduct an instruction-following evaluation (IFEval) (Zhou et al., 2023) for DeepSeek-V2 Chat (SFT), using prompt-level loose accuracy as the metric. Moreover, we employ LiveCodeBench (Jain et al., 2024) questions from September 1st, 2023 to April 1st, 2024 to evaluate chat models. In addition to the standard benchmarks, we further evaluate our model on open-ended conversation benchmarks including MT-Bench (Zheng et al., 2023), AlpacaEval 2.0 (Dubois et al., 2024), and AlignBench (Liu et al., 2023). For comparison, we also evaluate Qwen1.5 72B Chat, LLaMA-3-70B Instruct, and Mistral-8x22B Instruct in our evaluation framework and settings. As for DeepSeek 67B Chat, we directly refer to the evaluation results reported in our previous release.

### 4.2. Reinforcement Learning

In order to further unlock the potential of DeepSeek-V2 and align it with human preference, we conduct Reinforcement Learning (RL) to adjust its preference.

Reinforcement Learning Algorithm. In order to save the training costs of $\mathrm{RL}$, we adopt Group Relative Policy Optimization (GRPO) (Shao et al., 2024), which foregoes the critic model that is typically with the same size as the policy model, and estimates the baseline from group scores instead. Specifically, for each question $q$, GRPO samples a group of outputs $\{o_1, o_2, \cdots, o_G\}$ from the old policy $\pi_{\theta_{old}}$ and then optimizes the policy model $\pi_\theta$ by maximizing the following objective:

$$
\begin{array} { l } { \displaystyle \mathcal { J } _ { G R P O } ( \theta ) = \mathbb { E } [ q \sim P ( Q ) , \{ o _ { i } \} _ { i = 1 } ^ { G } \sim \pi _ { \theta \ a d } ( O | q ) ] } \\ { \displaystyle \frac { 1 } { G } \sum _ { i = 1 } ^ { G } \left( \operatorname* { m i n } \left( \frac { \pi _ { \theta } ( o _ { i } | q ) } { \pi _ { \theta _ { o d d } } ( o _ { i } | q ) } A _ { i } , \mathrm { c l i p } \left( \frac { \pi _ { \theta } ( o _ { i } | q ) } { \pi _ { \theta _ { o d d } } ( o _ { i } | q ) } , 1 - \varepsilon , 1 + \varepsilon \right) A _ { i } \right) - \beta \mathbb { D } _ { K L } \left( \pi _ { \theta } | | \pi _ { r e f } \right) \right) , } \end{array}\tag{32}
$$

$$
\mathbb { D } _ { K L } \left( \pi _ { \theta } | | \pi _ { r e f } \right) = \frac { \pi _ { r e f } ( o _ { i } | q ) } { \pi _ { \theta } ( o _ { i } | q ) } - \log \frac { \pi _ { r e f } ( o _ { i } | q ) } { \pi _ { \theta } ( o _ { i } | q ) } - 1 ,\tag{33}
$$

where $\varepsilon$ and $\beta$ are hyper-parameters; and $A_i$ is the advantage, computed using a group of rewards $\{r_1, r_2, \ldots, r_G\}$ corresponding to the outputs within each group:

$$
A _ { i } = { \frac { r _ { i } - \mathrm { m } e a n ( \{ r _ { 1 } , r _ { 2 } , \cdot \cdot \cdot , r _ { G } \} ) } { s t d ( \{ r _ { 1 } , r _ { 2 } , \cdot \cdot \cdot , r _ { G } \} ) } } .\tag{34}
$$

Training Strategy. In our preliminary experiments, we find that the RL training on reasoning data, such as code and math prompts, exhibits unique characteristics that are distinct from the training on general data. For example, the mathematical and coding abilities of our model can keep improving over a longer period of training steps. Therefore, we employ a two-stage RL training strategy, which first performs reasoning alignment, and then performs human preference alignment. In the first reasoning alignment stage, we train a reward model $RM_{reasoning}$ for code and math reasoning tasks, and optimize the policy model with the feedback of $RM_{reasoning}$:

$$
r _ { i } = R M _ { r e a s o n i n g } ( o _ { i } ) .\tag{35}
$$

In the second human preference alignment stage, we adopt a multi-reward framework, which acquires rewards from a helpful reward model $R M _ { h e l p f u l } .$ , a safety reward model $R M _ { s a f e t y }$ , and a rule-based reward model $R M _ { r u l e }$ . The final reward of a response $o _ { i }$ is

$$
r _ { i } = c _ { 1 } \cdot R M _ { h e l p f u l } ( o _ { i } ) + c _ { 2 } \cdot R M _ { s a f e t y } ( o _ { i } ) + c _ { 3 } \cdot R M _ { r u l e } ( o _ { i } ) ,\tag{36}
$$

where $c _ { 1 } , c _ { 2 }$ , and $c _ { 3 }$ are corresponding coefficients.

In order to obtain reliable reward models that play crucial roles in the RL training, we carefully collect preference data, and meticulously conduct quality filtering and proportion adjustments. We obtain code preference data based on compiler-feedback, and mathematical preference data based on the ground-truth labels. For reward model training, we initialize the reward models with DeepSeek-V2 Chat (SFT) and train them with either a point-wise or a pair-wise loss. In our experiments, we observe that the RL training can fully tap into and activate the potential of our model, enabling it to select the correct and satisfactory answer from possible responses.

Optimizations for Training Efficiency. Conducting RL training on extremely large models places high demands on the training framework. It requires careful engineering optimization to manage the GPU memory and RAM pressure, and meanwhile maintain a fast training speed. For this goal, we implement the following engineering optimizations. (1) Firstly, we propose a hybrid engine that adopts different parallel strategies for training and inference respectively to achieve higher GPU utilization. (2) Secondly, we leverage vLLM (Kwon et al., 2023) with large batch sizes as our inference backend to accelerate the inference speed. (3) Thirdly, we carefully design a scheduling strategy for offloading models to CPUs and loading models back to GPUs, which achieves a near-optimal balance between the training speed and memory consumption.

### 4.3. Evaluation Results

Evaluations on Standard Benchmarks. Initially, we evaluate DeepSeek-V2 Chat (SFT) and DeepSeek-V2 Chat (RL) on standard benchmarks. Notably, DeepSeek-V2 Chat (SFT) demonstrates substantial improvements in GSM8K, MATH, and HumanEval evaluations compared with its base version. This progress can be attributed to the inclusion of our SFT data, which comprises a considerable volume of math and code related content. In addition, DeepSeek-V2 Chat (RL) further boosts the performance on math and code benchmarks. We show more code and math evaluations in Appendix F.

As for the comparisons with other models, we first compare DeepSeek-V2 Chat (SFT) with Qwen1.5 72B Chat, and find that DeepSeek-V2 Chat (SFT) surpasses Qwen1.5 72B Chat on almost all of English, math, and code benchmarks. On Chinese benchmarks, DeepSeek-V2 Chat (SFT) demonstrates slightly lower scores than Qwen1.5 72B Chat on multi-subject multiple-choice tasks, consistent with the performance observed from their base versions. When compared with the state-of-the-art open-source MoE model, Mixtral 8x22B Instruct, DeepSeek-V2 Chat (SFT) exhibits better performance on most benchmarks, except for NaturalQuestions and IFEval. Furthermore, in comparison to the state-of-the-art open-source model LLaMA3 70B Chat, DeepSeek-V2 Chat (SFT) shows similar performance in code and math related benchmarks. LLaMA3 70B Chat exhibits better performance on MMLU and IFEval, while DeepSeek-V2 Chat (SFT) showcases stronger performance on Chinese tasks. Ultimately, DeepSeek-V2 Chat (RL) demonstrates further enhanced performance in both mathematical and coding tasks compared with DeepSeek-V2 Chat (SFT). These comparisons highlight the strengths of DeepSeek-V2 Chat in relation to other language models in various domains and languages.

Evaluations on Open-Ended Generation. We proceed with additional evaluations of our models on open-ended conversation benchmarks. For English open-ended conversation generation, we utilize MT-Bench and AlpacaEval 2.0 as the benchmarks. Evaluation results presented in Table 4 demonstrate a significant performance advantage of DeepSeek-V2 Chat (RL) over DeepSeek-V2 Chat (SFT). This outcome showcases the effectiveness of our RL training in achieving improved alignment. In comparison to other open-source models, DeepSeek-V2 Chat (RL) demonstrates superior performance over Mistral 8x22B Instruct and Qwen1.5 72B Chat on both benchmarks. When compared with LLaMA3 70B Instruct, DeepSeek-V2 Chat (RL) showcases competitive performance on MT-Bench and notably outperforms it on AlpacaEval 2.0. These results highlight the strong performance of DeepSeek-V2 Chat (RL) in generating high-quality and contextually relevant responses, particularly in instruction-based conversation tasks.

In addition, we evaluate the Chinese open-ended generation capability based on AlignBench. As presented in Table 5, DeepSeek-V2 Chat (RL) exhibits a slight advantage over DeepSeek-V2 Chat (SFT). Notably, DeepSeek-V2 Chat (SFT) surpasses all open-source Chinese models by a significant margin. It significantly outperforms the second-best open-source model, Qwen1.5

<table><tr><td rowspan="2"></td><td rowspan="2">Benchmark</td><td rowspan="2"># Shots</td><td rowspan="2">DeepSeek 67B Chat</td><td colspan="2">Qwen 1.5 LLaMA3 72B Chat 70B Inst. 8x22B Inst.</td><td rowspan="2">Mixtral</td><td colspan="2">DeepSeek-V2 DeepSeek-V2</td></tr><tr><td></td><td></td><td>Chat (SFT)</td><td>Chat (RL)</td></tr><tr><td rowspan="3"></td><td>Context Length</td><td></td><td>4K</td><td>32K</td><td>8K</td><td>64K</td><td>128K</td><td>128K</td></tr><tr><td>Architecture</td><td></td><td>Dense</td><td>Dense</td><td>Dense</td><td>MoE</td><td>MoE</td><td>MoE</td></tr><tr><td># Activated Params - # Total Params</td><td></td><td>67B</td><td>72B</td><td>70B</td><td>39B</td><td>21B</td><td>21B</td></tr><tr><td colspan="2"></td><td></td><td>67B</td><td>72B</td><td>70B</td><td>141B</td><td>236B</td><td>236B</td></tr><tr><td rowspan="8">English</td><td>TriviaQA</td><td>5-shot</td><td>81.5</td><td>79.6</td><td>69.1</td><td>80.0</td><td>85.4</td><td>86.7</td></tr><tr><td>NaturalQuestions</td><td>5-shot</td><td>47.0</td><td>46.9</td><td>44.6</td><td>54.9</td><td>51.9</td><td>53.4</td></tr><tr><td>MMLU</td><td>5-shot</td><td>71.1</td><td>76.2</td><td>80.3</td><td>77.8</td><td>78.4</td><td>77.8</td></tr><tr><td>ARC-Easy</td><td>25-shot</td><td>96.6</td><td>96.8</td><td>96.9</td><td>97.1</td><td>97.6</td><td>98.1</td></tr><tr><td>ARC-Challenge</td><td>25-shot</td><td>88.9</td><td>91.7</td><td>92.6</td><td>90.0</td><td>92.5</td><td>92.3</td></tr><tr><td>BBH</td><td>3-shot</td><td>71.7</td><td>65.9</td><td>80.1</td><td>78.4</td><td>81.3</td><td>79.7</td></tr><tr><td>AGIEval</td><td>0-shot</td><td>46.4</td><td>62.8</td><td>56.6</td><td>41.4</td><td>63.2</td><td>61.4</td></tr><tr><td>IFEval</td><td>0-shot</td><td>55.5</td><td>57.3</td><td>79.7</td><td>72.1</td><td>64.1</td><td>63.8</td></tr><tr><td rowspan="5">Code</td><td>HumanEval</td><td>0-shot</td><td>73.8</td><td>68.9</td><td>76.2</td><td>75.0</td><td>76.8</td><td>81.1</td></tr><tr><td>MBPP</td><td>3-shot</td><td>61.4</td><td>52.2</td><td>69.8</td><td>64.4</td><td>70.4</td><td>72.0</td></tr><tr><td>CRUXEval-I-COT</td><td>2-shot</td><td>49.1</td><td>51.4</td><td>61.1</td><td>59.4</td><td>59.5</td><td>61.5</td></tr><tr><td>CRUXEval-O-COT</td><td>2-shot</td><td>50.9</td><td>56.5</td><td>63.6</td><td>63.6</td><td>60.7</td><td>63.0</td></tr><tr><td>LiveCodeBench</td><td>0-shot</td><td>18.3</td><td>18.8</td><td>30.5</td><td>25.0</td><td>28.7</td><td>32.5</td></tr><tr><td rowspan="3">Math</td><td>GSM8K</td><td>8-shot</td><td>84.1</td><td>81.9</td><td>93.2</td><td>87.9</td><td>90.8</td><td>92.2</td></tr><tr><td>MATH</td><td>4-shot</td><td>32.6</td><td>40.6</td><td>48.5</td><td>49.8</td><td>52.7</td><td>53.9</td></tr><tr><td>CMath</td><td>0-shot</td><td>80.3</td><td>82.8</td><td>79.2</td><td>75.1</td><td>82.0</td><td>81.9</td></tr><tr><td rowspan="3">Chinese</td><td>CLUEWSC</td><td>5-shot</td><td>78.5</td><td>90.1</td><td>85.4</td><td>75.8</td><td>88.6</td><td>89.9</td></tr><tr><td>C-Eval</td><td>5-shot</td><td>65.2</td><td>82.2</td><td>67.9</td><td>60.0</td><td>80.9</td><td>78.0</td></tr><tr><td>CMMLU</td><td>5-shot</td><td>67.8</td><td>82.9</td><td>70.7</td><td>61.0</td><td>82.4</td><td>81.6</td></tr></table>

Table 3 
| Comparison among DeepSeek-V2 Chat (SFT), DeepSeek-V2 Chat (RL), and other representative open-source chat models. Regarding TriviaQA and NaturalQuestions, it is worth noting that chat models, such as LLaMA3 70B Instruct, might not strictly adhere to the format constraints typically specified in the few-shot setting. Consequently, this can lead to underestimation of certain models in our evaluation framework.
<table><tr><td>Model</td><td>MT-Bench</td><td>AlpacaEval 2.0</td></tr><tr><td>DeepSeek 67B Chat</td><td>8.35</td><td>16.6</td></tr><tr><td>Mistral 8x22B Instruct v0.1</td><td>8.66</td><td>30.9</td></tr><tr><td>Qwen1.5 72B Chat</td><td>8.61</td><td>36.6</td></tr><tr><td>LLaMA3 70B Instruct</td><td>8.95</td><td>34.4</td></tr><tr><td>DeepSeek-V2 Chat (SFT)</td><td>8.62</td><td>30.0</td></tr><tr><td>DeepSeek-V2 Chat (RL)</td><td>8.97</td><td>38.9</td></tr></table>

Table 4 
| English open-ended conversation evaluations. For AlpacaEval 2.0, we use the lengthcontrolled win rate as the metric.

72B Chat on both Chinese reasoning and language. Moreover, both DeepSeek-V2 Chat (SFT) and DeepSeek-V2 Chat (RL) outperform GPT-4-0613 and ERNIEBot 4.0, solidifying the position of our models in the top-tier LLMs that support Chinese. Specifically, DeepSeek-V2 Chat (RL) shows remarkable performance in Chinese language understanding, which outperforms all models including GPT-4-Turbo-1106-Preview. On the other hand, the reasoning capability of DeepSeek-V2 Chat (RL) still lags behind giant models, such as Erniebot-4.0 and GPT-4s.

<table><tr><td rowspan="2">Model</td><td rowspan="2">Overall U</td><td colspan="3">Reasoning</td><td colspan="8">Language</td></tr><tr><td>Avg. </td><td>Math. ¥</td><td>Logi. </td><td>Avg. </td><td>Fund. # 1</td><td>Chi. $</td><td></td><td>Open. SA </td><td>Writ. S1F</td><td>Role. # H</td><td>Pro. $\</td></tr><tr><td></td><td></td><td>E 7.73</td><td>it¥ 7.80</td><td>H 7.66</td><td>E</td><td>7.99</td><td>7.33</td><td></td><td></td><td></td><td></td><td>BE </td></tr><tr><td>GPT-4-1106-Preview DeepSeek-V2 Chat (RL)</td><td>8.01 7.91</td><td>7.45</td><td>7.77</td><td>7.14</td><td>8.29 8.36</td><td>8.10</td><td>8.28</td><td></td><td>8.61 8.37</td><td>8.67 8.53</td><td>8.47 8.33</td><td>8.65 8.53</td></tr><tr><td>ERNIEBot-4.0-202404*(—)</td><td>7.89</td><td>7.61</td><td>7.81</td><td>7.41</td><td>8.17</td><td>7.56</td><td></td><td>8.53</td><td>8.13</td><td>8.45</td><td>8.24</td><td>8.09</td></tr><tr><td>DeepSeek-V2 Chat (SFT)</td><td>7.74</td><td>7.30</td><td>7.34</td><td>7.26</td><td>8.17</td><td>8.04</td><td></td><td>8.26</td><td>8.13</td><td>8.00</td><td>8.10</td><td>8.49</td></tr><tr><td>GPT-4-0613</td><td>7.53</td><td>7.47</td><td>7.56</td><td>7.37</td><td>7.59</td><td>7.81</td><td></td><td>6.93</td><td>7.42</td><td>7.93</td><td>7.51</td><td>7.94</td></tr><tr><td>ERNIEBot-4.0-202312*(—)</td><td>7.36</td><td>6.84</td><td>7.00</td><td>6.67</td><td>7.88</td><td></td><td>7.47</td><td>7.88</td><td>8.05</td><td>8.19</td><td>7.84</td><td>7.85</td></tr><tr><td>Moonshot-v1-32k-202404*</td><td>7.22</td><td>6.42</td><td>6.41</td><td>6.43</td><td>8.02</td><td></td><td>7.82</td><td>7.58</td><td>8.00</td><td>8.22</td><td>8.19</td><td>8.29</td></tr><tr><td>Qwen1.5-72B-Chat*</td><td>7.19</td><td>6.45</td><td>6.58</td><td>6.31</td><td>7.93</td><td></td><td>7.38</td><td>7.77</td><td>8.15</td><td>8.02</td><td>8.05</td><td>8.24</td></tr><tr><td>DeepSeek-67B-Chat</td><td>6.43</td><td>5.75</td><td>5.71</td><td>5.79</td><td>7.11</td><td></td><td>7.12</td><td>6.52</td><td>7.58</td><td>7.20</td><td>6.91</td><td>7.37</td></tr><tr><td>ChatGLM-Turbo</td><td>6.24</td><td>5.00</td><td>4.74</td><td>5.26</td><td>7.49</td><td></td><td>6.82</td><td>7.17</td><td>8.16</td><td>7.77</td><td>7.76</td><td>7.24</td></tr><tr><td>ERNIEBot-3.5—)</td><td>6.14</td><td>5.15</td><td>5.03</td><td>5.27</td><td>7.13</td><td></td><td>6.62</td><td>7.60</td><td>7.26</td><td>7.56</td><td>6.83</td><td>6.90</td></tr><tr><td>Yi-34B-Chat*</td><td>6.12</td><td>4.86</td><td>4.97</td><td>4.74</td><td>7.38</td><td></td><td>6.72</td><td>7.28</td><td>7.76</td><td>7.44</td><td>7.58</td><td>7.53</td></tr><tr><td>GPT-3.5-Turbo-0613</td><td>6.08</td><td>5.35</td><td>5.68</td><td>5.02</td><td>6.82</td><td></td><td>6.71</td><td>5.81</td><td>7.29</td><td>7.03</td><td>7.28</td><td>6.77</td></tr><tr><td>ChatGLM-Pro )</td><td>5.83</td><td>4.65</td><td>4.54</td><td>4.75</td><td>7.01</td><td></td><td>6.51</td><td>6.76</td><td>7.47</td><td>7.07</td><td>7.34</td><td>6.89</td></tr><tr><td>SparkDesk-V2(F)</td><td>5.74</td><td>4.73</td><td>4.71</td><td>4.74</td><td>6.76</td><td></td><td>5.84</td><td>6.97</td><td>7.29</td><td>7.18</td><td>6.92</td><td>6.34</td></tr><tr><td>Qwen-14B-Chat</td><td>5.72</td><td>4.81</td><td>4.91</td><td>4.71</td><td>6.63</td><td></td><td>6.90</td><td>6.36</td><td>6.74</td><td>6.64</td><td>6.59</td><td>6.56</td></tr><tr><td>Baichuan2-13B-Chat</td><td>5.25</td><td>3.92</td><td>3.76</td><td>4.07</td><td>6.59</td><td></td><td>6.22</td><td>6.05</td><td>7.11</td><td>6.97</td><td>6.75</td><td>6.43</td></tr><tr><td>ChatGLM3-6B</td><td>4.97</td><td>3.85</td><td>3.55</td><td>4.14</td><td>6.10</td><td></td><td>5.75</td><td>5.29</td><td>6.71</td><td>6.83</td><td>6.28</td><td>5.73</td></tr><tr><td>Baichuan2-7B-Chat</td><td>4.97</td><td>3.66</td><td>3.56</td><td>3.75</td><td>6.28</td><td></td><td>5.81</td><td>5.50</td><td>7.13</td><td>6.84</td><td>6.53</td><td>5.84</td></tr><tr><td>InternLM-20B</td><td>4.96</td><td>3.66</td><td>3.39</td><td>3.92</td><td></td><td>6.26</td><td>5.96</td><td>5.50</td><td>7.18</td><td>6.19</td><td>6.49</td><td>6.22</td></tr><tr><td>Qwen-7B-Chat</td><td>4.91</td><td>3.73</td><td>3.62</td><td>3.83</td><td></td><td>6.09</td><td>6.40</td><td>5.74</td><td>6.26</td><td>6.31</td><td>6.19</td><td>5.66</td></tr><tr><td>ChatGLM2-6B</td><td>4.48</td><td>3.39</td><td>3.16</td><td>3.61</td><td></td><td>5.58</td><td>4.91</td><td>4.52</td><td>6.66</td><td>6.25</td><td>6.08</td><td>5.08</td></tr><tr><td>InternLM-Chat-7B</td><td>3.65</td><td>2.56</td><td>2.45</td><td>2.66</td><td></td><td>4.75</td><td>4.34</td><td>4.09</td><td>5.82</td><td>4.89</td><td>5.32</td><td>4.06</td></tr><tr><td>Chinese-LLaMA-2-7B-Chat</td><td>3.57</td><td>2.68</td><td>2.29</td><td>3.07</td><td></td><td>4.46</td><td>4.31</td><td>4.26</td><td>4.50</td><td>4.63</td><td>4.91</td><td>4.13</td></tr><tr><td>LLaMA-2-13B-Chinese-Chat</td><td>3.35</td><td>2.47</td><td>2.21</td><td>2.73</td><td></td><td>4.23</td><td>4.13</td><td>3.31</td><td>4.79</td><td>3.93</td><td>4.53</td><td>4.71</td></tr></table>

Table 5 
| AlignBench leaderboard rated by GPT-4-0613. Models are ranked in descending order based on the overall score. Models marked with \* represent that we evaluate them through their API service or open-weighted model, instead of referring to the results reported in their original papers. Suffixes of Erniebot-4.0 and Moonshot denote the timestamps when we called their API.

### 4.4. Discussion

Amount of SFT Data. The discussion surrounding the necessity of a large SFT corpus has been a topic of intense debate. Previous works (Young et al., 2024; Zhou et al., 2024) argue that fewer than 10K instances of SFT data are enough to produce satisfactory results. However, in our experiments, we observe a significant performance decline on the IFEval benchmark if we use fewer than 10K instances. A possible explanation is that, a language model necessitates a certain amount of data to develop specific skills. Although the requisite data amount may diminish with the model size increasing, it cannot be entirely eliminated. Our observation underscores the critical need for sufficient data to equip an LLM with desired capabilities. Moreover, the quality of SFT data is also crucial, especially for tasks involving writing or open-ended questions.

Alignment Tax of Reinforcement Learning. During human preference alignment, we observe a significant performance enhancement on the open-ended generation benchmarks, in terms of the scores rated by both AI and human evaluators. However, we also notice a phenomenon of “alignment tax” (Ouyang et al., 2022), i.e., the alignment process can negatively impact the performance on some standard benchmarks such as BBH. In order to alleviate the alignment tax, during the RL stage, we make significant efforts in data processing and improving training strategies, finally achieving a tolerable trade-off between the performance on standard and open-ended benchmarks. Exploring how to align a model with human preferences without compromising its general performance presents a valuable direction for future research.

Online Reinforcement Learning. In our preference alignment experiments, we find that the online approach significantly outperforms the offline approach. Therefore, we invest tremendous efforts in implementing an online RL framework for aligning DeepSeek-V2. The conclusion about online or offline preference alignment can vary in different contexts, and we reserve a more thorough comparison and analysis between them for future work.

## 5. Conclusion, Limitation, and Future Work

In this paper, we introduce DeepSeek-V2, a large MoE language model that supports 128K context length. In addition to strong performance, it is also characterized by economical training and efficient inference, benefiting from its innovative architecture including MLA and DeepSeekMoE. In practice, compared with DeepSeek 67B, DeepSeek-V2 achieves significantly stronger performance, and meanwhile saves 42.5% of training costs, reduces the KV cache by 93.3%, and boosts the maximum generation throughput to 5.76 times. Evaluation results further demonstrate that with only 21B activated parameters, DeepSeek-V2 achieves top-tier performance among open-source models and becomes the strongest open-source MoE model.

DeepSeek-V2 and its chat versions share the acknowledged limitations commonly found in other LLMs, including the lack of ongoing knowledge updates after pre-training, the possibility of generating non-factual information such as unverified advice, and a chance to produce hallucinations. In addition, since our data primarily consist of Chinese and English content, our model may exhibit limited proficiency in other languages. In scenarios beyond Chinese and English, it should be used with caution.

DeepSeek will continuously invest in open-source large models with longtermism, aiming to progressively approach the goal of artificial general intelligence.

• In our ongoing exploration, we are dedicated to devising methods that enable further scaling up MoE models while maintaining economical training and inference costs. The goal of our next step is to achieve performance on par with GPT-4 in our upcoming release.

• Our alignment team continuously strives to enhance our models, aiming to develop a model that is not only helpful but also honest and safe for worldwide users. Our ultimate objective is to align the values of our model with human values, while minimizing the need for human supervision. By prioritizing ethical considerations and responsible development, we are dedicated to creating a positive and beneficial impact on society.

• Currently, DeepSeek-V2 is designed to support the text modality exclusively. In our forward-looking agenda, we intend to enable our model to support multiple modalities, enhancing its versatility and utility in a wider range of scenarios.

## References

AI@Meta. Llama 3 model card, 2024. URL https://github.com/meta-llama/llama3/bl ob/main/MODEL\_CARD.md.

J. Ainslie, J. Lee-Thorp, M. de Jong, Y. Zemlyanskiy, F. Lebrón, and S. Sanghai. Gqa: Training generalized multi-query transformer models from multi-head checkpoints. arXiv preprint arXiv:2305.13245, 2023.

Anthropic. Introducing Claude, 2023. URL https://www.anthropic.com/index/introd ucing-claude.

J. Austin, A. Odena, M. Nye, M. Bosma, H. Michalewski, D. Dohan, E. Jiang, C. Cai, M. Terry, Q. Le, et al. Program synthesis with large language models. arXiv preprint arXiv:2108.07732, 2021.

J. Bai, S. Bai, Y. Chu, Z. Cui, K. Dang, X. Deng, Y. Fan, W. Ge, Y. Han, F. Huang, B. Hui, L. Ji, M. Li, J. Lin, R. Lin, D. Liu, G. Liu, C. Lu, K. Lu, J. Ma, R. Men, X. Ren, X. Ren, C. Tan, S. Tan, J. Tu, P. Wang, S. Wang, W. Wang, S. Wu, B. Xu, J. Xu, A. Yang, H. Yang, J. Yang, S. Yang, Y. Yao, B. Yu, H. Yuan, Z. Yuan, J. Zhang, X. Zhang, Y. Zhang, Z. Zhang, C. Zhou, J. Zhou, X. Zhou, and T. Zhu. Qwen technical report. arXiv preprint arXiv:2309.16609, 2023.

Y. Bisk, R. Zellers, R. L. Bras, J. Gao, and Y. Choi. PIQA: reasoning about physical commonsense in natural language. In The Thirty-Fourth AAAI Conference on Artificial Intelligence, AAAI 2020, The Thirty-Second Innovative Applications of Artificial Intelligence Conference, IAAI 2020, The Tenth AAAI Symposium on Educational Advances in Artificial Intelligence, EAAI 2020, New York, NY, USA, February 7-12, 2020, pages 7432–7439. AAAI Press, 2020. doi: 10.1609/aaai.v34i05.6239. URL https://doi.org/10.1609/aaai.v34i05.6239.

M. Chen, J. Tworek, H. Jun, Q. Yuan, H. P. de Oliveira Pinto, J. Kaplan, H. Edwards, Y. Burda, N. Joseph, G. Brockman, A. Ray, R. Puri, G. Krueger, M. Petrov, H. Khlaaf, G. Sastry, P. Mishkin, B. Chan, S. Gray, N. Ryder, M. Pavlov, A. Power, L. Kaiser, M. Bavarian, C. Winter, P. Tillet, F. P. Such, D. Cummings, M. Plappert, F. Chantzis, E. Barnes, A. Herbert-Voss, W. H. Guss, A. Nichol, A. Paino, N. Tezak, J. Tang, I. Babuschkin, S. Balaji, S. Jain, W. Saunders, C. Hesse, A. N. Carr, J. Leike, J. Achiam, V. Misra, E. Morikawa, A. Radford, M. Knight, M. Brundage, M. Murati, K. Mayer, P. Welinder, B. McGrew, D. Amodei, S. McCandlish, I. Sutskever, and W. Zaremba. Evaluating large language models trained on code. CoRR, abs/2107.03374, 2021. URL https://arxiv.org/abs/2107.03374.

P. Clark, I. Cowhey, O. Etzioni, T. Khot, A. Sabharwal, C. Schoenick, and O. Tafjord. Think you have solved question answering? try arc, the AI2 reasoning challenge. CoRR, abs/1803.05457, 2018. URL http://arxiv.org/abs/1803.05457.

K. Cobbe, V. Kosaraju, M. Bavarian, M. Chen, H. Jun, L. Kaiser, M. Plappert, J. Tworek, J. Hilton, R. Nakano, et al. Training verifiers to solve math word problems. arXiv preprint arXiv:2110.14168, 2021.

Y. Cui, T. Liu, W. Che, L. Xiao, Z. Chen, W. Ma, S. Wang, and G. Hu. A span-extraction dataset for Chinese machine reading comprehension. In K. Inui, J. Jiang, V. Ng, and X. Wan, editors, Proceedings of the 2019 Conference on Empirical Methods in Natural Language Processing and the 9th International Joint Conference on Natural Language Processing (EMNLP-IJCNLP), pages 5883–5889, Hong Kong, China, Nov. 2019. Association for Computational Linguistics. doi: 10.18653/v1/D19-1600. URL https://aclanthology.org/D19-1 600.

D. Dai, C. Deng, C. Zhao, R. X. Xu, H. Gao, D. Chen, J. Li, W. Zeng, X. Yu, Y. Wu, Z. Xie, Y. K. Li, P. Huang, F. Luo, C. Ruan, Z. Sui, and W. Liang. Deepseekmoe: Towards ultimate expert specialization in mixture-of-experts language models. CoRR, abs/2401.06066, 2024. URL https://doi.org/10.48550/arXiv.2401.06066.

T. Dao. FlashAttention-2: Faster attention with better parallelism and work partitioning, 2023.

DeepSeek-AI. Deepseek LLM: scaling open-source language models with longtermism. CoRR, abs/2401.02954, 2024. URL https://doi.org/10.48550/arXiv.2401.02954.

D. Dua, Y. Wang, P. Dasigi, G. Stanovsky, S. Singh, and M. Gardner. DROP: A reading comprehension benchmark requiring discrete reasoning over paragraphs. In J. Burstein, C. Doran, and T. Solorio, editors, Proceedings of the 2019 Conference of the North American Chapter of the Association for Computational Linguistics: Human Language Technologies, NAACL-HLT 2019, Minneapolis, MN, USA, June 2-7, 2019, Volume 1 (Long and Short Papers), pages 2368– 2378. Association for Computational Linguistics, 2019. doi: 10.18653/V1/N19-1246. URL https://doi.org/10.18653/v1/n19-1246.

Y. Dubois, B. Galambosi, P. Liang, and T. B. Hashimoto. Length-controlled alpacaeval: A simple way to debias automatic evaluators. arXiv preprint arXiv:2404.04475, 2024.

W. Fedus, B. Zoph, and N. Shazeer. Switch transformers: Scaling to trillion parameter models with simple and efficient sparsity. CoRR, abs/2101.03961, 2021. URL https://arxiv.org/ abs/2101.03961.

L. Gao, S. Biderman, S. Black, L. Golding, T. Hoppe, C. Foster, J. Phang, H. He, A. Thite, N. Nabeshima, et al. The Pile: An 800GB dataset of diverse text for language modeling. arXiv preprint arXiv:2101.00027, 2020.

Google. Introducing gemini: our largest and most capable ai model, 2023. URL https: //blog.google/technology/ai/google-gemini-ai/.

A. Gu, B. Rozière, H. Leather, A. Solar-Lezama, G. Synnaeve, and S. I. Wang. Cruxeval: A benchmark for code reasoning, understanding and execution, 2024.

D. Hendrycks, C. Burns, S. Basart, A. Zou, M. Mazeika, D. Song, and J. Steinhardt. Measuring massive multitask language understanding. arXiv preprint arXiv:2009.03300, 2020.

D. Hendrycks, C. Burns, S. Kadavath, A. Arora, S. Basart, E. Tang, D. Song, and J. Steinhardt. Measuring mathematical problem solving with the math dataset. arXiv preprint arXiv:2103.03874, 2021.

High-flyer. Hai-llm: 效且轻 的 型训练工具, 2023. URL https://www.high-flyer.c高n/en/blog/hai-llm.

C. Hooper, S. Kim, H. Mohammadzadeh, M. W. Mahoney, Y. S. Shao, K. Keutzer, and A. Gholami. Kvquant: Towards 10 million context length LLM inference with KV cache quantization. CoRR, abs/2401.18079, 2024. URL https://doi.org/10.48550/arXiv.2401.18079.

S. Hu, Y. Tu, X. Han, C. He, G. Cui, X. Long, Z. Zheng, Y. Fang, Y. Huang, W. Zhao, et al. Minicpm: Unveiling the potential of small language models with scalable training strategies. arXiv preprint arXiv:2404.06395, 2024.

Y. Huang, Y. Bai, Z. Zhu, J. Zhang, J. Zhang, T. Su, J. Liu, C. Lv, Y. Zhang, J. Lei, et al. C-Eval: A multi-level multi-discipline chinese evaluation suite for foundation models. arXiv preprint arXiv:2305.08322, 2023.

N. Jain, K. Han, A. Gu, W.-D. Li, F. Yan, T. Zhang, S. Wang, A. Solar-Lezama, K. Sen, and I. Stoica. Livecodebench: Holistic and contamination free evaluation of large language models for code. arXiv preprint arXiv:2403.07974, 2024.

M. Joshi, E. Choi, D. Weld, and L. Zettlemoyer. TriviaQA: A large scale distantly supervised challenge dataset for reading comprehension. In R. Barzilay and M.-Y. Kan, editors, Proceedings of the 55th Annual Meeting of the Association for Computational Linguistics (Volume 1: Long Papers), pages 1601–1611, Vancouver, Canada, July 2017. Association for Computational Linguistics. doi: 10.18653/v1/P17-1147. URL https://aclanthology.org/P17-1147.

T. Kwiatkowski, J. Palomaki, O. Redfield, M. Collins, A. P. Parikh, C. Alberti, D. Epstein, I. Polosukhin, J. Devlin, K. Lee, K. Toutanova, L. Jones, M. Kelcey, M. Chang, A. M. Dai, J. Uszkoreit, Q. Le, and S. Petrov. Natural questions: a benchmark for question answering research. Trans. Assoc. Comput. Linguistics, 7:452–466, 2019. doi: 10.1162/tacl\_a\_00276. URL https://doi.org/10.1162/tacl\_a\_00276.

W. Kwon, Z. Li, S. Zhuang, Y. Sheng, L. Zheng, C. H. Yu, J. E. Gonzalez, H. Zhang, and I. Stoica. Efficient memory management for large language model serving with pagedattention. In Proceedings of the ACM SIGOPS 29th Symposium on Operating Systems Principles, 2023.

G. Lai, Q. Xie, H. Liu, Y. Yang, and E. H. Hovy. RACE: large-scale reading comprehension dataset from examinations. In M. Palmer, R. Hwa, and S. Riedel, editors, Proceedings of the 2017 Conference on Empirical Methods in Natural Language Processing, EMNLP 2017, Copenhagen, Denmark, September 9-11, 2017, pages 785–794. Association for Computational Linguistics, 2017. doi: 10.18653/V1/D17-1082. URL https://doi.org/10.18653/v1/d1 7-1082.

D. Lepikhin, H. Lee, Y. Xu, D. Chen, O. Firat, Y. Huang, M. Krikun, N. Shazeer, and Z. Chen. Gshard: Scaling giant models with conditional computation and automatic sharding. In 9th International Conference on Learning Representations, ICLR 2021. OpenReview.net, 2021. URL https://openreview.net/forum?id=qrwe7XHTmYb.

H. Li, Y. Zhang, F. Koto, Y. Yang, H. Zhao, Y. Gong, N. Duan, and T. Baldwin. CMMLU: Measuring massive multitask language understanding in Chinese. arXiv preprint arXiv:2306.09212, 2023.

W. Li, F. Qi, M. Sun, X. Yi, and J. Zhang. Ccpm: A chinese classical poetry matching dataset, 2021.

X. Liu, X. Lei, S. Wang, Y. Huang, Z. Feng, B. Wen, J. Cheng, P. Ke, Y. Xu, W. L. Tam, X. Zhang, L. Sun, H. Wang, J. Zhang, M. Huang, Y. Dong, and J. Tang. Alignbench: Benchmarking chinese alignment of large language models. CoRR, abs/2311.18743, 2023. doi: 10.48550/A RXIV.2311.18743. URL https://doi.org/10.48550/arXiv.2311.18743.

I. Loshchilov and F. Hutter. Decoupled weight decay regularization. arXiv preprint arXiv:1711.05101, 2017.

Mistral. Cheaper, better, faster, stronger: Continuing to push the frontier of ai and making it accessible to all, 2024. URL https://mistral.ai/news/mixtral-8x22b.

OpenAI. Introducing ChatGPT, 2022. URL https://openai.com/blog/chatgpt.

OpenAI. GPT4 technical report. arXiv preprint arXiv:2303.08774, 2023.

L. Ouyang, J. Wu, X. Jiang, D. Almeida, C. Wainwright, P. Mishkin, C. Zhang, S. Agarwal, K. Slama, A. Ray, et al. Training language models to follow instructions with human feedback. Advances in neural information processing systems, 35:27730–27744, 2022.

B. Peng, J. Quesnelle, H. Fan, and E. Shippole. Yarn: Efficient context window extension of large language models. arXiv preprint arXiv:2309.00071, 2023.

P. Qi, X. Wan, G. Huang, and M. Lin. Zero bubble pipeline parallelism. arXiv preprint arXiv:2401.10241, 2023.

S. Rajbhandari, J. Rasley, O. Ruwase, and Y. He. Zero: Memory optimizations toward training trillion parameter models. In SC20: International Conference for High Performance Computing, Networking, Storage and Analysis, pages 1–16. IEEE, 2020.

C. Riquelme, J. Puigcerver, B. Mustafa, M. Neumann, R. Jenatton, A. S. Pinto, D. Keysers, and N. Houlsby. Scaling vision with sparse mixture of experts. In Advances in Neural Information Processing Systems 34: Annual Conference on Neural Information Processing Systems 2021, NeurIPS 2021, pages 8583–8595, 2021. URL https://proceedings.neurips.cc/paper /2021/hash/48237d9f2dea8c74c2a72126cf63d933-Abstract.html.

K. Sakaguchi, R. L. Bras, C. Bhagavatula, and Y. Choi. Winogrande: An adversarial winograd schema challenge at scale, 2019.

Z. Shao, P. Wang, Q. Zhu, R. Xu, J. Song, M. Zhang, Y. Li, Y. Wu, and D. Guo. Deepseekmath: Pushing the limits of mathematical reasoning in open language models. arXiv preprint arXiv:2402.03300, 2024.

N. Shazeer. Fast transformer decoding: One write-head is all you need. CoRR, abs/1911.02150, 2019. URL http://arxiv.org/abs/1911.02150.

N. Shazeer, A. Mirhoseini, K. Maziarz, A. Davis, Q. V. Le, G. E. Hinton, and J. Dean. Outrageously large neural networks: The sparsely-gated mixture-of-experts layer. In 5th International Conference on Learning Representations, ICLR 2017. OpenReview.net, 2017. URL https: //openreview.net/forum?id=B1ckMDqlg.

J. Su, M. Ahmed, Y. Lu, S. Pan, W. Bo, and Y. Liu. Roformer: Enhanced transformer with rotary position embedding. Neurocomputing, 568:127063, 2024.

K. Sun, D. Yu, D. Yu, and C. Cardie. Investigating prior knowledge for challenging chinese machine reading comprehension, 2019.

M. Suzgun, N. Scales, N. Schärli, S. Gehrmann, Y. Tay, H. W. Chung, A. Chowdhery, Q. V. Le, E. H. Chi, D. Zhou, et al. Challenging big-bench tasks and whether chain-of-thought can solve them. arXiv preprint arXiv:2210.09261, 2022.

A. Vaswani, N. Shazeer, N. Parmar, J. Uszkoreit, L. Jones, A. N. Gomez, Ł. Kaiser, and I. Polosukhin. Attention is all you need. Advances in neural information processing systems, 30, 2017.

J. Wei, Y. Tay, R. Bommasani, C. Raffel, B. Zoph, S. Borgeaud, D. Yogatama, M. Bosma, D. Zhou, D. Metzler, et al. Emergent abilities of large language models. arXiv preprint arXiv:2206.07682, 2022.

T. Wei, J. Luan, W. Liu, S. Dong, and B. Wang. Cmath: Can your language model pass chinese elementary school math test?, 2023.

L. Xu, H. Hu, X. Zhang, L. Li, C. Cao, Y. Li, Y. Xu, K. Sun, D. Yu, C. Yu, Y. Tian, Q. Dong, W. Liu, B. Shi, Y. Cui, J. Li, J. Zeng, R. Wang, W. Xie, Y. Li, Y. Patterson, Z. Tian, Y. Zhang, H. Zhou,

S. Liu, Z. Zhao, Q. Zhao, C. Yue, X. Zhang, Z. Yang, K. Richardson, and Z. Lan. CLUE: A chinese language understanding evaluation benchmark. In D. Scott, N. Bel, and C. Zong, editors, Proceedings of the 28th International Conference on Computational Linguistics, COLING 2020, Barcelona, Spain (Online), December 8-13, 2020, pages 4762–4772. International Committee on Computational Linguistics, 2020. doi: 10.18653/V1/2020.COLING-MAIN.419. URL https://doi.org/10.18653/v1/2020.coling-main.419.

A. Young, B. Chen, C. Li, C. Huang, G. Zhang, G. Zhang, H. Li, J. Zhu, J. Chen, J. Chang, et al. Yi: Open foundation models by 01. ai. arXiv preprint arXiv:2403.04652, 2024.

R. Zellers, A. Holtzman, Y. Bisk, A. Farhadi, and Y. Choi. HellaSwag: Can a machine really finish your sentence? In A. Korhonen, D. R. Traum, and L. Màrquez, editors, Proceedings of the 57th Conference of the Association for Computational Linguistics, ACL 2019, Florence, Italy, July 28- August 2, 2019, Volume 1: Long Papers, pages 4791–4800. Association for Computational Linguistics, 2019. doi: 10.18653/v1/p19-1472. URL https://doi.org/10.18653/v1/p1 9-1472.

Y. Zhao, C. Lin, K. Zhu, Z. Ye, L. Chen, S. Zheng, L. Ceze, A. Krishnamurthy, T. Chen, and B. Kasikci. Atom: Low-bit quantization for efficient and accurate LLM serving. CoRR, abs/2310.19102, 2023. URL https://doi.org/10.48550/arXiv.2310.19102.

C. Zheng, M. Huang, and A. Sun. Chid: A large-scale chinese idiom dataset for cloze test. In A. Korhonen, D. R. Traum, and L. Màrquez, editors, Proceedings of the 57th Conference of the Association for Computational Linguistics, ACL 2019, Florence, Italy, July 28- August 2, 2019, Volume 1: Long Papers, pages 778–787. Association for Computational Linguistics, 2019. doi: 10.18653/V1/P19-1075. URL https://doi.org/10.18653/v1/p19-1075.

L. Zheng, W.-L. Chiang, Y. Sheng, S. Zhuang, Z. Wu, Y. Zhuang, Z. Lin, Z. Li, D. Li, E. P. Xing, H. Zhang, J. E. Gonzalez, and I. Stoica. Judging llm-as-a-judge with mt-bench and chatbot arena, 2023.

W. Zhong, R. Cui, Y. Guo, Y. Liang, S. Lu, Y. Wang, A. Saied, W. Chen, and N. Duan. AGIEval: A human-centric benchmark for evaluating foundation models. CoRR, abs/2304.06364, 2023. doi: 10.48550/arXiv.2304.06364. URL https://doi.org/10.48550/arXiv.2304.06364.

C. Zhou, P. Liu, P. Xu, S. Iyer, J. Sun, Y. Mao, X. Ma, A. Efrat, P. Yu, L. Yu, et al. Lima: Less is more for alignment. Advances in Neural Information Processing Systems, 36, 2024.

J. Zhou, T. Lu, S. Mishra, S. Brahma, S. Basu, Y. Luan, D. Zhou, and L. Hou. Instruction-following evaluation for large language models. arXiv preprint arXiv:2311.07911, 2023.

## Appendix

### A. Contributions and Acknowledgments

Research & Engineering Ruiqi Ge Aixin Liu Ruizhe Pan Bingxuan Wang Runxin Xu Bo Liu Shanghao Lu Chenggang Zhao Shangyan Zhou Chengqi Deng Shanhuang Chen Chong Ruan Shengfeng Ye Damai Dai Shirong Ma Daya Guo Shiyu Wang Dejian Yang Shuiping Yu Deli Chen Shunfeng Zhou Erhang Li Size Zheng Fangyun Lin Tian Pei Fuli Luo Wangding Zeng Guangbo Hao Wen Liu Guanting Chen Wenfeng Liang Guowei Li Wenjun Gao H. Zhang Wentao Zhang Hanwei Xu Xiao Bi Hao Yang Xiaohan Wang Haowei Zhang Xiaodong Liu Honghui Ding Xiaokang Chen Huajian Xin Xiaotao Nie Huazuo Gao Xin Liu Hui Qu Xin Xie Jianzhong Guo Xingkai Yu Jiashi Li Xinyu Yang Jingyang Yuan Xuan Lu Junjie Qiu Xuecheng Su Junxiao Song Y. Wu Kai Dong Y.K. Li Kaige Gao Y.X. Wei Kang Guan Yanhong Xu Lean Wang Yao Li Lecong Zhang Yao Zhao Liang Zhao Yaofeng Sun Liyue Zhang Yaohui Wang Mingchuan Zhang Yichao Zhang Minghua Zhang Yiliang Xiong Minghui Tang Yilong Zhao Panpan Huang Ying He Peiyi Wang Yishi Piao Qihao Zhu Yixin Dong Qinyu Chen Yixuan Tan Qiushi Du Yiyuan Liu

<table><tr><td>Yongji Wang Yongqiang Guo Yuduan Wang</td><td>Xiaosha Chen Xiaowen Sun Xiaoxiang Wang</td></tr><tr><td>Yuheng Zou Yuxiang You Yuxuan Liu</td><td>Xinnan Song Xinyi Zhou Y.X. Zhu</td></tr><tr><td>Z.Z. Ren Zehui Ren Zhangli Sha</td><td>Yanhong Xu Yanping Huang Yaohui Li</td></tr><tr><td>Zhe Fu</td><td>Yi Zheng</td></tr><tr><td></td><td>Yuchen Zhu Yunxian Ma Zhen Huang</td></tr><tr><td>Zhenda Xie Zhewen Hao Zhihong Shao Zhuoshu Li Zihan Wang Zihui Gu</td><td>Zhipeng Xu</td></tr></table>

Within each role, authors are listed alphabetically by first name. Especially, Huazuo Gao and Wangding Zeng have made key innovations in the research of the MLA architecture. Furthermore, we’d like to thank Jianlin Su for his helpful discussion on position embedding. We thank all those who have contributed to DeepSeek-V2 but are not mentioned in the paper. DeepSeek believes that innovation, novelty, and curiosity are essential in the path to AGI.

### B. DeepSeek-V2-Lite: A 16B Model Equipped with MLA and DeepSeekMoE

#### B.1. Model Description

Architectures. DeepSeek-V2-Lite has 27 layers and a hidden dimension of 2048. It also employs MLA and has 16 attention heads, where each head has a dimension of 128. Its KV compression dimension is 512, but slightly different from DeepSeek-V2, it does not compress the queries. For the decoupled queries and key, it has a per-head dimension of 64. DeepSeek-V2-Lite also employs DeepSeekMoE, and all FFNs except for the first layer are replaced with MoE layers. Each MoE layer consists of 2 shared experts and 64 routed experts, where the intermediate hidden dimension of each expert is 1408. Among the routed experts, 6 experts will be activated for each token. Under this configuration, DeepSeek-V2-Lite comprises 15.7B total parameters, of which 2.4B are activated for each token.

<table><tr><td>Benchmark</td><td>DeepSeek 7B</td><td>DeepSeekMoE 16B</td><td>DeepSeek-V2-Lite</td></tr><tr><td>Architecture</td><td>MHA+Dense</td><td>MHA+MoE</td><td>MLA+MoE</td></tr><tr><td>Context Length</td><td>4K</td><td>4K</td><td>32K</td></tr><tr><td># Activated Params</td><td>6.9B</td><td>2.8B</td><td>2.4B</td></tr><tr><td># Total Params</td><td>6.9B</td><td>16.4B</td><td>15.7B</td></tr><tr><td># Training Tokens</td><td>2T</td><td>2T</td><td>5.7T</td></tr><tr><td rowspan="7">English</td><td>MMLU</td><td>48.2</td><td>45.0 58.3</td></tr><tr><td>BBH</td><td>39.5</td><td>38.9 44.1</td></tr><tr><td>TriviaQA</td><td>59.7</td><td>64.8 64.2</td></tr><tr><td>NaturalQuestions</td><td>22.2</td><td>25.5 26.0</td></tr><tr><td>ARC-Easy</td><td>67.9</td><td>68.1 70.9</td></tr><tr><td>ARC-Challenge</td><td>48.1</td><td>49.8 51.2</td></tr><tr><td>AGIEval</td><td>26.4</td><td>17.4 33.2</td></tr><tr><td rowspan="2">Code</td><td>HumanEval</td><td>26.2 26.8</td><td>29.9</td></tr><tr><td>MBPP</td><td>39.0</td><td>39.2 43.2</td></tr><tr><td rowspan="2">Math</td><td>GSM8K</td><td>17.4 18.8</td><td>41.1</td></tr><tr><td>MATH</td><td>3.3</td><td>4.3 17.1</td></tr><tr><td rowspan="3">Chinese</td><td>CMath</td><td>34.5</td><td>40.4 58.4</td></tr><tr><td>CLUEWSC</td><td>73.1</td><td>72.1 74.3</td></tr><tr><td>C-Eval</td><td>45.0</td><td>40.6 60.3</td></tr><tr><td></td><td>CMMLU</td><td>47.2</td><td>42.5 64.3</td></tr></table>

Table 6 
| Performance of DeepSeek-V2-Lite, DeepSeekMoE 16B, and DeepSeek 7B.

Training Details. DeepSeek-V2-Lite is also trained from scratch on the same pre-training corpus of DeepSeek-V2, which is not polluted by any SFT data. It uses the AdamW optimizer with hyper-parameters set to $\beta _ { 1 } = 0 . 9 , \beta _ { 2 } = 0 . 9 5$ , and weight\_decay = 0.1. The learning rate is scheduled using a warmup-and-step-decay strategy. Initially, the learning rate linearly increases from 0 to the maximum value during the first 2K steps. Subsequently, the learning rate is multiplied by 0.316 after training about 80% of tokens, and again by 0.316 after training about 90% of tokens. The maximum learning rate is set to $4 . 2 \times 1 0 ^ { - 4 } ,$ , and the gradient clipping norm is set to 1.0. We do not employ the batch size scheduling strategy for it, and it is trained with a constant batch size of 4608 sequences. During pre-training, we set the maximum sequence

length to 4K, and train DeepSeek-V2-Lite on 5.7T tokens. We leverage pipeline parallelism to deploy different layers of it on different devices, but for each layer, all experts will be deployed on the same device. Therefore, we only employ a small expert-level balance loss with $\alpha _ { 1 } = 0 . 0 0 1$ and do not employ device-level balance loss and communication balance loss for it. After pre-training, we also perform long context extension and SFT for DeepSeek-V2-Lite and get a chat model called DeepSeek-V2-Lite Chat.
<table><tr><td rowspan="2">Benchmark</td><td rowspan="2">DeepSeek 7B Chat</td><td rowspan="2">DeepSeekMoE 16B Chat</td><td rowspan="2">DeepSeek-V2-Lite</td></tr><tr><td>Chat</td></tr><tr><td>Context Length</td><td>Architecture</td><td>MHA+Dense</td><td>MHA+MoE</td><td>MLA+MoE</td></tr><tr><td rowspan="2"></td><td></td><td>4K</td><td>4K</td><td>32K</td></tr><tr><td># Activated Params</td><td>6.9B</td><td>2.8B</td><td>2.4B</td></tr><tr><td rowspan="2"></td><td># Total Params</td><td>6.9B</td><td>16.4B</td><td>15.7B</td></tr><tr><td># Training Tokens</td><td>2T</td><td>2T</td><td>5.7T</td></tr><tr><td rowspan="8">English</td><td>MMLU</td><td>49.7</td><td>47.2</td><td>55.7</td></tr><tr><td>BBH</td><td>43.1</td><td>42.2</td><td>48.1</td></tr><tr><td>TriviaQA</td><td>59.5</td><td>63.3</td><td>65.2</td></tr><tr><td>NaturalQuestions</td><td>32.7</td><td>35.1</td><td>35.5</td></tr><tr><td>ARC-Easy</td><td>70.2</td><td>69.9</td><td>74.3</td></tr><tr><td>ARC-Challenge</td><td>50.2</td><td>50.0</td><td>51.5</td></tr><tr><td>AGIEval</td><td>17.6</td><td>19.7</td><td>42.8</td></tr><tr><td>HumanEval</td><td>45.1</td><td>45.7</td><td>57.3</td></tr><tr><td rowspan="2">Code</td><td>MBPP</td><td>39.0</td><td>46.2</td><td>45.8</td></tr><tr><td>GSM8K</td><td>62.6</td><td>62.2</td><td>72.0</td></tr><tr><td rowspan="3">Math</td><td>MATH</td><td>14.7</td><td>15.2</td><td>27.9</td></tr><tr><td>CMath</td><td>66.4</td><td>67.9</td><td>71.7</td></tr><tr><td>CLUEWSC</td><td>66.2</td><td>68.2</td><td>80.0</td></tr><tr><td rowspan="3">Chinese</td><td>C-Eval</td><td>44.7</td><td>40.0</td><td>60.1</td></tr><tr><td>CMMLU</td><td>51.2</td><td>49.3</td><td>62.5</td></tr><tr><td></td><td></td><td></td><td></td></tr></table>

Table 7 
| Performance of DeepSeek-V2-Lite Chat, DeepSeekMoE 16B Chat, and DeepSeek 7B Chat.

#### B.2. Performance Evaluation

Base Model. We evaluate the performance of DeepSeek-V2-Lite and compare it with our previous small-size base models in Table 6. DeepSeek-V2-Lite exhibits overwhelming performance advantages, especially in reasoning, coding, and math.

Chat Model. We evaluate the performance of DeepSeek-V2-Lite Chat and compare it with our previous small-size chat models in Table 7. DeepSeek-V2-Lite also outperforms our previous small-size chat models by a large margin.

### C. Full Formulas of MLA

In order to demonstrate the complete computation process of MLA, we provide its full formulas in the following:

$$
\begin{array} { r } { \mathbf { c } _ { t } ^ { Q } = { W } ^ { { D Q } } \mathbf { h } _ { t } , } \end{array}\tag{37}
$$

$$
[ \mathbf { q } _ { t , 1 } ^ { C } ; \mathbf { q } _ { t , 2 } ^ { C } ; . . . ; \mathbf { q } _ { t , n _ { h } } ^ { C } ] = \mathbf { q } _ { t } ^ { C } = W ^ { U Q } \mathbf { c } _ { t } ^ { Q } ,\tag{38}
$$

$$
[ \mathbf { q } _ { t , 1 } ^ { R } ; \mathbf { q } _ { t , 2 } ^ { R } ; . . . ; \mathbf { q } _ { t , n _ { h } } ^ { R } ] = \mathbf { q } _ { t } ^ { R } = \mathrm { R o P E } ( W ^ { Q R } \mathbf { c } _ { t } ^ { Q } ) ,\tag{39}
$$

$$
\mathbf { q } _ { t , i } = [ \mathbf { q } _ { t , i } ^ { C } ; \mathbf { q } _ { t , i } ^ { R } ] ,\tag{40}
$$

$$
\left\lceil \mathbf { c } _ { t } ^ { K V } \right\rceil = W ^ { D K V } \mathbf { h } _ { t } ,\tag{41}
$$

$$
[ \mathbf { k } _ { t , 1 } ^ { C } ; \mathbf { k } _ { t , 2 } ^ { C } ; . . . ; \mathbf { k } _ { t , n _ { h } } ^ { C } ] = \mathbf { k } _ { t } ^ { C } = W ^ { U K } \mathbf { c } _ { t } ^ { K V } ,\tag{42}
$$

$$
\boxed { \mathbf { k } _ { t } ^ { R } } = \mathrm { R o P E } ( W ^ { K R } \mathbf { h } _ { t } ) ,\tag{43}
$$

$$
\mathbf { k } _ { t , i } = [ \mathbf { k } _ { t , i } ^ { C } ; \mathbf { k } _ { t } ^ { R } ] ,\tag{44}
$$

$$
[ \mathbf { v } _ { t , 1 } ^ { C } ; \mathbf { v } _ { t , 2 } ^ { C } ; . . . ; \mathbf { v } _ { t , n _ { h } } ^ { C } ] = \mathbf { v } _ { t } ^ { C } = W ^ { U V } \mathbf { c } _ { t } ^ { K V } ,\tag{45}
$$

$$
{ \bf 0 } _ { t , i } = \sum _ { j = 1 } ^ { t } { \cal S } \mathrm { o f t m a x } _ { j } ( \frac { { \bf q } _ { t , i } ^ { T } { \bf k } _ { j , i } } { \sqrt { d _ { h } + d _ { h } ^ { R } } } ) { \bf v } _ { j , i } ^ { C } ,\tag{46}
$$

$$
\mathbf { u } _ { t } = W ^ { O } [ \mathbf { o } _ { t , 1 } ; \mathbf { o } _ { t , 2 } ; . . . ; \mathbf { o } _ { t , n _ { h } } ] ,\tag{47}
$$

where the boxed vectors in blue need to be cached for generation. During inference, the naive formula needs to recover $\mathbf { k } _ { t } ^ { C }$ and $\mathbf { v } _ { t } ^ { C }$ from $\mathbf { c } _ { t } ^ { K V }$ for attention. Fortunately, due to the associative law of matrix multiplication, we can absorb $W ^ { U K }$ into $W ^ { U Q } ,$ and $W ^ { U V }$ into $W ^ { O }$ . Therefore, we do not need to compute keys and values out for each query. Through this optimization, we avoid the computational overhead for recomputing $\mathbf { k } _ { t } ^ { C }$ and $\mathbf { v } _ { t } ^ { \dot { C } }$ during inference.

### D. Ablation of Attention Mechanisms

#### D.1. Ablation of MHA, GQA, and MQA

We show the evaluation results for 7B dense models with MHA, GQA, and MQA on four hard benchmarks in Table 8. All of these three models are trained on 1.33T tokens, and share the same architecture except for the attention mechanisms. In addition, for a fair comparison, we align the number of parameters of them to around 7B by adjusting the number of layers. From the table, we can find that MHA demonstrates significant advantages over GQA and MQA on these benchmarks.

#### D.2. Comparison Between MLA and MHA

In Table 9, we show the evaluation results for MoE models equipped with MLA and MHA, respectively, on four hard benchmarks. For a solid conclusion, we train and evaluate models across two scales. Two small MoE models comprise about 16B total parameters, and we train them on 1.33T tokens. Two large MoE models comprise about 250B total parameters, and we train them on 420B tokens. Also, two small MoE models and two large MoE models respectively share the same architecture except for the attention mechanisms. From the table, we can observe that MLA shows better performance than MHA. More importantly, MLA requires a significantly smaller amount of KV cache (14% for small MoE models and 4% for large MoE models) than MHA.

<table><tr><td>Benchmark (Metric)</td><td># Shots</td><td>Dense 7B w/ MQA</td><td>Dense 7B w/ GQA (8 Groups)</td><td>Dense 7B w/ MHA</td></tr><tr><td># Params</td><td></td><td>7.1B</td><td>6.9B</td><td>6.9B</td></tr><tr><td>BBH (EM)</td><td>3-shot</td><td>33.2</td><td>35.6</td><td>37.0</td></tr><tr><td>MMLU (Acc.)</td><td>5-shot</td><td>37.9</td><td>41.2</td><td>45.2</td></tr><tr><td>C-Eval (Acc.)</td><td>5-shot</td><td>30.0</td><td>37.7</td><td>42.9</td></tr><tr><td>CMMLU (Acc.)</td><td>5-shot</td><td>34.6</td><td>38.4</td><td>43.5</td></tr></table>

Table 8 
| Comparison among 7B dense models with MHA, GQA, and MQA, respectively. MHA demonstrates significant advantages over GQA and MQA on hard benchmarks.
<table><tr><td>Benchmark (Metric)</td><td># Shots</td><td>Small MoE w/ MHA</td><td>Small MoE w/ MLA</td><td>Large MoE w/ MHA</td><td>Large MoE w/ MLA</td></tr><tr><td># Activated Params</td><td>-</td><td>2.5B</td><td>2.4B</td><td>25.0B</td><td>21.5B</td></tr><tr><td># Total Params</td><td></td><td>15.8B</td><td>15.7B</td><td>250.8B</td><td>247.4B</td></tr><tr><td>KV Cache per Token (# Element)</td><td>-</td><td>110.6K</td><td>15.6K</td><td>860.2K</td><td>34.6K</td></tr><tr><td>BBH (EM)</td><td>3-shot</td><td>37.9</td><td>39.0</td><td>46.6</td><td>50.7</td></tr><tr><td>MMLU (Acc.)</td><td>5-shot</td><td>48.7</td><td>50.0</td><td>57.5</td><td>59.0</td></tr><tr><td>C-Eval (Acc.)</td><td>5-shot</td><td>51.6</td><td>50.9</td><td>57.9</td><td>59.2</td></tr><tr><td>CMMLU (Acc.)</td><td>5-shot</td><td>52.3</td><td>53.4</td><td>60.7</td><td>62.5</td></tr></table>

Table 9 
| Comparison between MLA and MHA on hard benchmarks. DeepSeek-V2 shows better performance than MHA, but requires a significantly smaller amount of KV cache.

### E. Discussion About Pre-Training Data Debiasing

During pre-training data preparation, we identify and filter out contentious content, such as values influenced by regional cultures, to avoid our model exhibiting unnecessary subjective biases on these controversial topics. Consequently, we observe that DeepSeek-V2 performs slightly worse on the test sets that are closely associated with specific regional cultures. For example, when evaluated on MMLU, although DeepSeek-V2 achieves comparable or superior performance on the majority of testsets compared with its competitors like Mixtral 8x22B, it still lags behind on the Humanity-Moral subset, which is mainly associated with American values.

Further, we conduct a manual analysis on this subset. Three well-educated human annotators conduct independent annotations on 420 moral scenarios from the MMLU Humanity-Moral subset. Then, we compute the agreement among their annotations and the ground-truth label. As shown in Table 10, three human annotators and the ground-truth label exhibit a low agreement with each other. Therefore, we attribute the abnormal performance of DeepSeek-V2 on these value-sensitive test sets to our efforts in debiasing the pre-training corpus.

### F. Additional Evaluations on Math and Code

The evaluation employs the SC-Math6 corpus, which consists of thousands of Chinese math problems. DeepSeek-V2 Chat (RL) outperforms all Chinese LLMs, including both open-source and close-source models.

We further share more results in Figure 5 on HumanEval and LiveCodeBench, where the questions of LiveCodeBench are selected from the period between September 1st, 2023, and April 1st, 2024. As shown in the figure, DeepSeek-V2 Chat (RL) demonstrates considerable proficiency in LiveCodeBench, achieving a Pass@1 score that even surpasses some giant models. This performance highlights the strong capability of DeepSeek-V2 Chat (RL) in tackling live coding tasks.

<table><tr><td>Agreement</td><td>Ground-Truth Label</td><td>Annotator 1</td><td>Annotator 2</td><td>Annotator 3</td></tr><tr><td>Ground-Truth Label</td><td>100.0%</td><td>66.7%</td><td>59.8%</td><td>42.1%</td></tr><tr><td>Annotator 1</td><td>66.7%</td><td>100.0%</td><td>57.9%</td><td>69.0%</td></tr><tr><td>Annotator 2</td><td>59.8%</td><td>57.9%</td><td>100.0%</td><td>65.5%</td></tr><tr><td>Annotator 3</td><td>42.1%</td><td>69.0%</td><td>65.5%</td><td>100.0%</td></tr></table>

Table 10 
| Three well-educated human annotators conduct independent annotations on 420 moral scenarios from the MMLU Humanity-Moral subset, on which DeepSeek-V2 and its competitive models demonstrate performance inconsistency. Three annotators and the ground-truth label exhibit a low agreement with each other. This indicates that the answers to the Humanity-Moral subset can be contentious according to specific regional cultures.
<table><tr><td>Model Name</td><td>R Level</td><td>Comp. Score</td><td>Reas. Steps Score</td><td>OvrAcc Score</td></tr><tr><td>GPT-4-1106-Preview</td><td>5</td><td>90.71</td><td>91.65</td><td>89.77</td></tr><tr><td>GPT-4</td><td>5</td><td>88.40</td><td>89.10</td><td>87.71</td></tr><tr><td>DeepSeek-V2 Chat (RL)</td><td>5</td><td>83.35</td><td>85.73</td><td>84.54</td></tr><tr><td>Ernie-bot 4.0</td><td>5</td><td>85.60</td><td>86.82</td><td>84.38</td></tr><tr><td>Qwen-110B-Chat</td><td>5</td><td>83.25</td><td>84.93</td><td>84.09</td></tr><tr><td>GLM-4</td><td>5</td><td>84.24</td><td>85.72</td><td>82.77</td></tr><tr><td>Xinghuo 3.5</td><td>5</td><td>83.73</td><td>85.37</td><td>82.09</td></tr><tr><td>Qwen-72B-Chat</td><td>4</td><td>78.42</td><td>80.07</td><td>79.25</td></tr><tr><td>ChatGLM-Turbo</td><td>4</td><td>57.70</td><td>60.32</td><td>55.09</td></tr><tr><td>GPT-3.5-Turbo</td><td>4</td><td>57.05</td><td>59.61</td><td>54.50</td></tr><tr><td>Qwen-14B-Chat</td><td>4</td><td>53.12</td><td>55.99</td><td>50.26</td></tr><tr><td>ChatGLM3-6B</td><td>3</td><td>40.90</td><td>44.20</td><td>37.60</td></tr><tr><td>Xinghuo 3.0</td><td>3</td><td>40.08</td><td>45.27</td><td>34.89</td></tr><tr><td>Baichuan2-13B-Chat</td><td>3</td><td>39.40</td><td>42.63</td><td>36.18</td></tr><tr><td>Ernie-3.5-turbo</td><td>2</td><td>25.19</td><td>27.70</td><td>22.67</td></tr><tr><td>Chinese-Alpaca2-13B</td><td>2</td><td>20.55</td><td>22.52</td><td>18.58</td></tr></table>

Table 11 
| SC-Math6 Model Reasoning Level. “R Level” stands for Reasoning Level, “Comp. Score” stands for Comprehensive Score, “Reas. Steps Score” stands for Reasoning Steps Score, and “OvrAcc Score” stands for Overall Accuracy Score.

### G. Evaluation Formats

We present our evaluation formats for each benchmark in Table 12-37, respectively.

![](images/fig05_code_benchmark.jpg)
Figure 5 | Evaluation results on HumanEval and LiveCodeBench. The questions of Live-CodeBench are selected from the period between September 1st, 2023 and April 1st, 2024.

<table><tr><td>PROMPT</td></tr><tr><td>UTEEE</td></tr><tr><td>#A)¥</td></tr><tr><td>(DNACATP(</td></tr><tr><td>M</td></tr><tr><td></td></tr></table>

Table 12 
| An example of AGIEval.

![](images/table13_arc_example.jpg)  
Table 13 
| An example of ARC.

![](images/table14_bbh_example.jpg)  
Table 14 
| An example of BBH.

PROMPT  
以下是中国关于教育学考试的单 选 ，请选出其中的 确 案。根据 国 理学家冯 良教授的学习分类，培养学 品 要通过 o我 心A. 知识的学习  
B. 能的学习  
技C. 行为规范的学习  
D. 态度的学习  
案：C  
设跨学科课 建 跨学科专业体现了 教育课 发 的  
开A. 综合化趋势  
B. 样化趋势  
多C. 人文化趋势  
D. 科学化趋势  
案：A智 能的 点有  
心 技 特A. 质性、 显性、 缩性物 外 简B.观 性、内潜性、 缩性念 简C. 质性、 显性、 性物 外 展开D.观 性、内潜性、 性念案：B  
下列关于 学 的情绪与理智关系的说法中 确的是  
大 生A.能冷静控制 己情绪  
自B.感情 事，难以 理智控制情绪  
用 用C. 遇事能坚持 己 确认识  
自 正D.已发 到不为 事而发怒和怄气  
展案：B在学完一 逻辑结构严密的课文以后，勾 出课文的论点论据的逻辑关系图以篇帮助理解和记 。这种学习方法 于\_ 。  
忆A.精细加工  
B. 组织  
策略C. 述  
复 策略D.做 记  
笔案：B  
有学者 ，教育要根据一个民族固有的 来定，这种观点体现了  
强调A. 产力对教育的 响和制约  
生 影B. 政治制度对教育的 响和制约  
影C. 文化对教育的 响和制约  
影D. 经济制度对教育的 响和制约  
案：  
OPTIONS  
- A  
- B  
- C  
- D

Table 15 
| An example of C-Eval.

![](images/table16_c3_example.jpg)  
Table 16 
| An example of C3.

![](images/table17_ccpm_example.jpg)  
Table 17 
| An example of CCPM.

<table><tr><td>PROMPT Q:-# 8000E#1500-200= 160035.? A: - # 1500 π  E  -E  #200 F = # 1500+200=1700-#8000  = —     000-10-  $1 7 0 0 - 1 6 0 0 { = } 3 2 0 0 { \overline { { \mathcal { T } } } }$  ,:5,  $\scriptstyle \int 3 2 0 0 / ( 3 + 5 ) ^ { * } 3 = 1 2 0 0 { \overline { { \mathcal { D } } } }$  . FU:1200.</td></tr><tr><td>Q0 -? A: -=100100+800=900 AE 900 Q:AB5/.</td></tr><tr><td>135B 165FZ? A:A/BB A5/A/Z135B/ E165  $= 5 x + 5 y = 1 3 5 + 8 x = 1 6 5 + 8 y$  :  $1 0 ( \mathrm { x + y } ) { = } 3 0 0 { + } 8 ( \mathrm { x + y } )$  , F+y=150,ZE5(x+y)=750 *.FU:750.</td></tr><tr><td>Q: -10,10, 46 *? A:</td></tr></table>

Table 18 
| An example of CMATH.

![](images/table19_cmmlu_example.jpg)  
Table 19 
| An example of CMMLU.

![](images/table20_chinese_reading_example.jpg)

![](images/table21_drop_example.jpg)  
Table 21 
| An example of DROP.

![](images/table22_chid_example.jpg)  
Table 22 
| An example of CHID.

<table><tr><td>PROMPT " HHTE</td></tr><tr><td>HEJ </td></tr><tr><td>JulesTellier TEL### TT" "" E</td></tr><tr><td>-# E-#</td></tr><tr><td>T#1 AET "" A</td></tr><tr><td>1962 ?" "</td></tr><tr><td>PROMPT Q: Max can mow the lawn in 40 minutes. If it takes him twice that long to fertilize the lawn, how long will it take him to both mow and fertilize the lawn? A: Let's think step by step. It takes Max 2 * 40 minutes = 80 minutes to fertilize</td></tr><tr><td>the lawn. In total, Max takes 80 minutes + 40 minutes = 120 minutes to both mow and fertilize the lawn. The answer is 120. Q: The bagels cost $2.25 each, or a dozen for $24. How much is saved, per bagel, in cents, by buying a dozen at a time? A: Let's think step by step. They cost 2.25*100=225 cents each. At the bulk rate,</td></tr><tr><td>they are 24/12=2 dollar each. They cost 2*100=200 cents each. 225-200=25 cents are saved per bagel. The answer is 25. Q: Tim is 5 years old. His cousin, Rommel, is thrice as old as he is. His other cousin, Jenny, is 2 years older than Rommel. How many years younger is Tim</td></tr><tr><td>than Jenny? A: Let's think step by step. Rommel is 5 x 3 = 15 years old. Jenny is  $1 5 + 2 = 1 7$  years old. So, Tim is  $1 7 - 5 = 1 2$  years younger than Jenny. The answer is 12.</td></tr><tr><td>Q: The school has 14 boys and 10 girls. If 4 boys and 3 girls drop out, how many boys and girls are left? A: Let's think step by step. There are 14 boys - 4 boys = 10 boys left. There are 10 girls - 3 girls = 7 girls left. In total there are 10 boys + 7 girls = 17 boys and girls left. The answer is 17.</td></tr><tr><td>Q: Building one birdhouse requires 7 planks and 20 nails. If 1 nail costs 0.05, and one plank costs 3, what is the cost, in dollars, to build 4 birdhouses? A: Let's think step by step. The cost of the planks for one birdhouse is  $7 ^ { * } 3 =$  21. And the nails are a cost of  $2 0 ^ { * } 0 . 0 5 = 1$  for each birdhouse. So to build one</td></tr><tr><td>birdhouse one will need  $2 1 + 1 = 2 2$  So the cost of building 4 birdhouses is at 4  ${ } ^ { * } 2 2 = 8 8 .$  The answer is 88. Q: Danny brings 3 watermelons to his family picnic. He cuts each watermelon</td></tr><tr><td>into 10 slices. His sister brings 1 watermelon to the family picnic, and she cuts the watermelon into 15 slices. How many watermelon slices are there in total at the picnic? A: Let's think step by step. From Danny, there are 3 * 10 = 30 watermelon slices.</td></tr><tr><td>From his sister, there are 1 * 15 = 15 watermelon slices. There are a total of 30 + 15 = 45 watermelon slices. The answer is 45.</td></tr><tr><td>Q: Angela is a bike messenger in New York. She needs to deliver 8 times as many packages as meals. If she needs to deliver 27 meals and packages combined, how many meals does she deliver? A: Let's think step by step. Let p be the number of packages Angela delivers and m be the number of meals. We know that p  $+ \mathbf { m } = 2 7$  and p = 8m. Substituting the second equation into the first equation, we get 8m + m = 27. Combining</td></tr><tr><td>PROMPT Playing piano: A man is seated at a piano. He</td></tr><tr><td>OPTIONS</td></tr><tr><td>- is playing the piano with his hands and his face.</td></tr><tr><td>- bigins to play a song by timbaland on the piano.</td></tr><tr><td>- plays slowly, and pauses to snap his fingers. - is playing a song in front of him.</td></tr></table>

Table 23 
| An example of CLUEWSC.

Table 25 
| An example of HellaSwag.

![](images/table26_humaneval_example.jpg)  
Table 26 
| An example of HumanEval.

![](images/table27_math_example.jpg)  
Table 27 
| An example of MATH.

```julia
PROMPT
You are an expert Python programmer, and here is your task: Write a function
to find the similar elements from the given two tuple lists. Your code should
pass these tests:
assert similar_elements((3, 4, 5, 6),(5, 7, 4, 10)) == (4, 5)
assert similar_elements((1, 2, 3, 4),(5, 4, 3, 7)) == (3, 4)
assert similar_elements((11, 12, 14, 13),(17, 15, 14, 13)) == (13, 14)
[BEGIN]
def similar_elements(test_tup1, test_tup2):
res = tuple(set(test_tup1) & set(test_tup2))
return (res)
[DONE]
You are an expert Python programmer, and here is your task: Write a python
function to identify non-prime numbers. Your code should pass these tests:
assert is_not_prime(2) == False
assert is_not_prime(10) == True
assert is_not_prime(35) == True
[BEGIN]
import math
def is_not_prime(n):
result = False
for i in range(2,int(math.sqrt(n)) + 1):
if n % i == 0:
result = True
return result
[DONE]
You are an expert Python programmer, and here is your task: Write a function
to find the largest integers from a given list of numbers using heap queue
algorithm. Your code should pass these tests:
assert heap_queue_largest( [25, 35, 22, 85, 14, 65, 75, 22, 58],3)==[85, 75, 65]
assert heap_queue_largest( [25, 35, 22, 85, 14, 65, 75, 22, 58],2)==[85, 75]
assert heap_queue_largest( [25, 35, 22, 85, 14, 65, 75, 22, 58],5)==[85, 75, 65, 58,
35]
[BEGIN]
import heapq as hq
def heap_queue_largest(nums,n):
largest_nums = hq.nlargest(n, nums)
return largest_nums
[DONE]
You are an expert Python programmer, and here is your task: Write a function
to return the sum of all divisors of a number. Your code should pass these tests:
assert sum_div(8)==7
assert sum_div(12)==16
assert sum_div(7)==1
[BEGIN]
```  
Table 28 | An example of MBPP.

PROMPT   
The following are multiple choice questions (with answers) about miscellaneous.   
How many axles does a standard automobile have?   
A. one   
B. two   
C. four   
D. eight   
Answer: B   
What place is named in the title of the 1979 live album by rock legends Cheap   
Trick?   
A. Budapest   
B. Budokan   
C. Bhutan   
D. Britain   
Answer: B   
Who is the shortest man to ever win an NBA slam dunk competition?   
A. Anthony ’Spud’ Webb   
B. Michael ’Air’ Jordan   
C. Tyrone ’Muggsy’ Bogues   
D. Julius ’Dr J’ Erving   
Answer: A   
What is produced during photosynthesis?   
A. hydrogen   
B. nylon   
C. oxygen   
D. light   
Answer: C   
Which of these songs was a Top 10 hit for the rock band The Police?   
A. ’Radio $_ \mathrm { G a - G a ^ { \prime } }$   
B. ’Ob-la-di Ob-la-da’   
C. ’De Do Do Do De Da Da Da’   
D. ’In-a-Gadda-Da-Vida’   
Answer: C   
Which of the Three Stooges was not related to the others?   
A. Moe   
B. Larry   
C. Curly   
D. Shemp   
Answer:

Table 29 | An example of MMLU.

![](images/table30_naturalquestions_example.jpg)  
Table 30 | An example of NaturalQuestions.

![](images/table31_openbookqa_example.jpg)  
Table 31 | An example of OpenBookQA.

![](images/table32_piqa_example.jpg)  
Table 32 | An example of PIQA.

**PROMPT**

Article:

When you read an article you will understand and remember it better if you can work out how the writer has put the ideas together. Sometimes a writer puts ideas together by asking questions and then answering them.For example, if the article is about groundhogs, the set of questions in the writer’s head might be:   
What does a groundhog look like?   
Where do groundhogs live?   
What do they eat?...   
In the article,the author might answer those questions. Sometimes an author writes out her questions in the article.These questions give you signals.They tell you what the author is going to write next.Often an author has a question in her head but she doesn’t write it out for you.You have to work out her question for yourself.Here’s a sample reading for you to practice this method.   
t1

The best time to see earthworms is at night,especially a cool,damp night.That’s when they come up from their burrows to hunt for food.Earthworms don’t like to be in the sun.That’s because they breathe through their skin,and they can’t breathe if their skin gets too dry.Earthworms must come out of the earth if it rains a lot,because they can’t breathe in their flooded burrows.What a dangerous life!

Earthworms don’t have eyes,so how can they tell when it’s dark? They have special places on their skin that are sensitive to light.These spots tell whether it’s light or dark.If you shine a flashlight on an earthworm at night,it will quickly disappear into the ground.

Earthworms don’t have ears either,but they can hear by feeling movements in the earth.If you want to hear like an earthworm,lie on the ground with your fingers in your ears.Then have a friend stamp his or her feet near you.This is how earthworms feel birds and people walking,and moles digging,near them. Earthworms are useful.Farmers and gardeners like having lots of earthworms in their land because the worms help to make better soil when they dig.That digging keeps the soil loose and airy .In one year earthworms can pile up as much as 23,000 kg of castings in an area about the size of a football field.

OPTIONS - One way to help with understanding - One way to practice with a new idea - One way to learn to be a wise writer49 - One way to be clearer about worms

![](images/table34_triviaqa_example.jpg)  
Table 34 | An example of TriviaQA.

![](images/table35_winogrande_example.jpg)  
Table 35 | An example of WinoGrande. Note that there are multiple prefixes and only one completion for WinoGrande, and we choose the predicted prefix with the lowest perplexity of the completion.

Prompt   
You will be given a function f and an output in the form f(??) == output. Find   
any input such that executing f on the input leads to the given output. There   
may be multiple answers, but you should only output one. In [ANSWER] and   
[/ANSWER] tags, complete the assertion with one such input that will produce   
the output when executing the function.   
[PYTHON]   
def f(my\_list):   
count = 0   
for i in my\_list:   
if len(i) % 2 == 0:   
count += 1   
return count   
assert f(??) == 3   
[/PYTHON]   
[ANSWER]   
assert f( ["mq", "px", "zy"]) == 3   
[/ANSWER]   
[PYTHON]   
def f(s1, s2):   
return s1 + s2   
assert f(??) == "banana"   
[/PYTHON]   
[ANSWER]   
assert f("ba", "nana") == "banana"   
[/ANSWER]   
[PYTHON]   
def f(a, b, c):   
result = {}   
for d in a, b, c:   
result.update(dict.fromkeys(d))   
return result   
assert f(??) == {1: None, 2: None}   
[/PYTHON]   
[ANSWER]  
Table 36 | An example of CRUXEval-I.

Prompt   
You are given a Python function and an assertion containing an input to the   
function. Complete the assertion with a literal (no unsimplified expressions,   
no function calls) containing the output when executing the provided code on   
the given input, even if the function is incorrect or incomplete. Do NOT output   
any extra information. Provide the full assertion with the correct output in   
[ANSWER] and [/ANSWER] tags, following the examples.   
[PYTHON]   
def f(n):   
return n   
assert f(17) == ??   
[/PYTHON]   
[ANSWER]   
assert f(17) == 17   
[/ANSWER]   
[PYTHON]   
def f(s):   
return s + "a"   
assert f("x9j") == ??   
[/PYTHON]   
[ANSWER]   
assert f("x9j") == "x9ja"   
[/ANSWER]   
[PYTHON]   
def f(nums):   
output = []   
for n in nums:   
output.append((nums.count(n), n))   
output.sort(reverse=True)   
return output   
assert f( [1, 1, 3, 1, 3, 1]) == ??   
[/PYTHON]   
[ANSWER]  
Table 37 | An example of CRUXEval-O.
