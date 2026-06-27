# GLM-130B: AN OPEN BILINGUAL PRE-TRAINED MODEL

Aohan Zeng⋄†∗, Xiao Liu⋄†∗, Zhengxiao Du⋄†, Zihan Wang⋄, Hanyu Lai⋄, Ming Ding⋄, Zhuoyi Yang⋄, Yifan Xu⋄, Wendi Zheng⋄, Xiao Xia⋄, Weng Lam Tam⋄§, Zixuan Ma⋄, Yufei Xue§, Jidong Zhai⋄, Wenguang Chen⋄, Peng Zhang§, Yuxiao Dong⋄‡, Jie Tang⋄‡

Tsinghua University⋄ Zhipu.AI§

# ABSTRACT

We introduce GLM-130B, a bilingual (English and Chinese) pre-trained language model with 130 billion parameters. It is an attempt to open-source a 100B-scale model at least as good as GPT-3 (davinci) and unveil how models of such a scale can be successfully pre-trained. Over the course of this effort, we face numerous unexpected technical and engineering challenges, particularly on loss spikes and divergence. In this paper, we introduce the training process of GLM-130B including its design choices, training strategies for both efficiency and stability, and engineering efforts. The resultant GLM-130B model offers significant outperformance over GPT-3 175B (davinci) on a wide range of popular English benchmarks while the performance advantage is not observed in OPT-175B and BLOOM-176B. It also consistently and significantly outperforms ERNIE TITAN 3.0 260B—the largest Chinese language model—across related benchmarks. Finally, we leverage a unique scaling property of GLM-130B to reach INT4 quantization without post training, with almost no performance loss, making it the first among 100B-scale models and more importantly, allowing its effective inference on 4×RTX 3090 (24G) or 8×RTX 2080 Ti (11G) GPUs, the most affordable GPUs required for using 100B-scale models. The GLM-130B model weights are publicly accessible and its code, training logs, related toolkit, and lessons learned are open-sourced at https://github.com/THUDM/GLM-130B/.

# 1 INTRODUCTION

Large language models (LLMs), particularly those with over 100 billion (100B) parameters (Brown et al., 2020; Thoppilan et al., 2022; Rae et al., 2021; Chowdhery et al., 2022; Wang et al., 2021), have presented attractive scaling laws (Wei et al., 2022b), where emergent zero-shot and few-shot capabilities suddenly arose. Among them, GPT-3 (Brown et al., 2020) with 175B parameters pioneers the study of 100B-scale LLMs by strikingly generating better performance with 32 labeled examples than the fully-supervised BERT-Large model on a variety of benchmarks. However, both GPT-3 (and many other closed-sourced 100B-scale ones)—the model itself—and how it can be trained, have been thus far intransparent to the public. It is of critical value to train a high-quality LLM of such scale with both the model and training process shared with everyone.

We thus aim to pre-train an open and highly-accurate 100B-scale model with ethical concerns in mind. Over the course of our attempt, we have come to realize that pre-training a dense LLM at such a scale raises numerous unexpected technical and engineering challenges compared to training 10B-scale models, in terms of pre-training efficiency, stability, and convergence. Similar difficulties have also been concurrently observed in training OPT-175B (Zhang et al., 2022) and BLOOM-176B (Scao et al., 2022), further demonstrating the significance of GPT-3 as a pioneer study.

Language Ability Evaluation   
![](images/1bea381c8d8156ae554c338bb9fbaa9ca239b393e830e1a6ba4050fd727eb004.jpg)  
Bias & Toxicity Evaluation   
Figure 1: A summary of the performance evaluation and ethical studies.

Table 1: A comparison between GLM-130B and other 100B-scale LLMs and PaLM 540B. (LN: layer norm.; FPF: floating-point format; MIP: multi-task instruction pre-training; CN : Chinese) 

<table><tr><td rowspan="2">Model</td><td rowspan="2">Open-source</td><td colspan="3">Architecture &amp; Data</td><td colspan="2">Training</td><td colspan="2">Inference</td></tr><tr><td>Objective</td><td>LN</td><td>Major Lang.</td><td>FPF</td><td>Stabilization</td><td>Quantization</td><td>GPU Needed</td></tr><tr><td>GPT-3 175B</td><td>×</td><td></td><td></td><td>English</td><td>FP16</td><td>undisclosed</td><td>undisclosed</td><td>undisclosed</td></tr><tr><td>OPT-175B</td><td>√</td><td>GPT</td><td>Pre-LN</td><td>English</td><td>FP16</td><td>Manual Adjusting</td><td>INT8</td><td>8 × 3090</td></tr><tr><td>BLOOM-176B</td><td>√</td><td></td><td></td><td>Multi-lingual</td><td>BF16</td><td>Embedding Norm</td><td>INT8</td><td>8 × 3090</td></tr><tr><td>PaLM 540B</td><td>×</td><td>GPT</td><td>Pre-LN</td><td>English</td><td>BF16</td><td>Manual Adjusting</td><td>undisclosed</td><td>undisclosed</td></tr><tr><td>GLM-130B</td><td>√</td><td>GLM (Blank Infilling &amp; MIP)</td><td>Deep-Norm</td><td>Bilingual (EN &amp; CN)</td><td>FP16</td><td>Embedding Gradient Shrink</td><td>INT4</td><td>4 × 3090 or 8 × 1080 Ti</td></tr></table>

In this work, we introduce the pre-training of a 100B-scale model—GLM-130B, in terms of engineering efforts, model design choices, training strategies for efficiency and stability, and quantization for affordable inference. As it has been widely realized that it is computationally unaffordable to empirically enumerate all possible designs for training 100B-scale LLMs, we present not only the successful part for training GLM-130B but also many of the failed options and lessons learned. Particularly, the training stability is the decisive factor in the success of training models of such a scale. Different from practices such as manually adjusting learning rates in OPT-175B and using embedding norm in the sacrifice of performance in BLOOM-176B, we experiment with various options and find the strategy of embedding gradient shrink can significantly stabilize the training of GLM-130B.

Specifically, GLM-130B is a bilingual (English and Chinese) bidirectional dense model with 130 billion parameters, pre-trained over 400 billion tokens on a cluster of 96 NVIDIA DGX-A100 (8×40G) GPU nodes between May 6 and July 3, 2022. Instead of using the GPT-style architecture, we adopt the General Language Model (GLM) algorithm (Du et al., 2022) to leverage its bidirectional attention advantage and autoregressive blank infilling objective. Table 1 summarizes the comparison between GLM-130B, GPT-3 and another two open-source efforts—OPT-175B and BLOOM-176B, as well as PaLM 540B (Chowdhery et al., 2022)—a 4× larger model—as a reference.

Altogether, the conceptual uniqueness and engineering efforts enable GLM-130B to exhibit performance that surpasses the level of GPT-3 on a wide range of benchmarks (in total 112 tasks) and also outperforms PaLM 540B in many cases, while outperformance over GPT-3 has not been observed in OPT-175B and BLOOM-176B (Cf. Figure 1 left). For zero-shot performance, GLM-130B is better than GPT-3 175B (+5.0%), OPT-175B (+6.5%), and BLOOM-176B (+13.0%) on LAMBADA (Paperno et al., 2016), and achieves 3× better performance than GPT-3 on Big-bench-lite (Srivastava et al., 2022). For the 5-shot MMLU (Hendrycks et al., 2021) tasks, it is better than GPT-3 175B (+0.9%) and BLOOM-176B (+12.7%). As a bilingual LLM also in Chinese, it offers significantly better results than ERNIE TITAN 3.0 260B (Wang et al., 2021)—the largest Chinese LLM—on 7 zero-shot CLUE (Xu et al., 2020) datasets (+24.26%) and 5 zero-shot FewCLUE (Xu et al., 2021) ones (+12.75%). Importantly, as summarized in Figure 1 right, GLM-130B as an open model is associated with significantly less bias and generation toxicity than its 100B-scale counterparts.

Finally, we design GLM-130B to empower as many people as possible to conduct 100B-scale LLM studies. First, instead of using 175B+ parameters as OPT and BLOOM, the 130B size is decided because such a size supports inference on a single A100 (8×40G) server. Second, to further lower the GPU requirements, we quantize GLM-130B into INT4 precision without post training while OPT and BLOOM can only reach INT8. Due to a unique property of the GLM architecture, GLM-130B’s INT4 quantization introduces negligible performance degradation, e.g., -0.74% on LAMBADA and even +0.05% on MMLU, making it still better than the uncompressed GPT-3. This enables GLM-130B’s fast inference with performance guarantee on a server of 4×RTX 3090 (24G) or 8×RTX 2080 Ti (11G), the most affordable GPU required for using 100B-scale LLMs to date.

![](images/29cbb011dbc948b2e1c0f27d93e7f0ffec031fdf37a1df9786b1c7bcc6447101.jpg)

<details>
<summary>line</summary>

| Step | Gradient Norm (Red) | Gradient Norm (Blue) | Gradient Norm (Gray) | Gradient Norm (Pink) |
|------|---------------------|----------------------|----------------------|----------------------|
| 0    | 12.0                | 12.0                 | 12.0                 | 12.0                 |
| 500  | 2.0                 | 10.0                 | 5.0                  | 3.0                  |
| 1k   | 1.0                 | 5.0                  | 3.0                  | 2.0                  |
| 1.5k | 0.5                 | 3.0                  | 2.0                  | 1.5                  |
| 2k   | 0.3                 | 2.0                  | 1.5                  | 1.0                  |
| 2.5k | 0.2                 | 1.5                  | 1.0                  | 0.8                  |
| 3k   | 0.1                 | 1.0                  | 0.8                  | 0.5                  |
</details>

(a) More than 30 failed preliminary trials at 100B-scale   
![](images/b53c98ceb1b42c1a1e7a04575f80ba854497bb4a4f8abeb1bed08225021c6992.jpg)

<details>
<summary>line</summary>

| Step | Sandwich-LN (GLM-130B) | Post-LN with DeepNorm (GLM-130B) |
| ---- | ------------------------ | -------------------------------- |
| 0    | 12.0                     | 12.0                             |
| 500  | 6.0                      | 1.0                              |
| 1000 | 4.0                      | 0.8                              |
| 1500 | 2.5                      | 0.6                              |
| 2000 | 1.5                      | 0.5                              |
| 2500 | 1.0                      | 0.4                              |
| 2700 | 10.0                     | 0.3                              |
| 3000 | 0.0                      | 0.0                              |
</details>

(b) Final decisive trials: Sandwich-LN v.s. DeepNorm   
Figure 3: Trials on different LayerNorms for GLM-130B training. It turns out that DeepNorm is the most stable one, as it has small gradient norm and does not spike in the early stage training.

We open-source the model checkpoints, code, training logs, related toolkits, and lessons learned.

# 2 THE DESIGN CHOICES OF GLM-130B

The architecture of a machine learning model defines its inductive bias. However, it has been realized that it is computationally unaffordable to explore various architectural designs for LLMs. We introduce and explain the unique design choices of GLM-130B.

# 2.1 GLM-130B’S ARCHITECTURE

GLM as Backbone. Most recent 100B-scale LLMs, such as GPT-3, PaLM, OPT, and BLOOM, follow the traditional GPT-style (Radford et al., 2019) architecture of decoder-only autoregressive language modeling. In GLM-130B, we instead make an attempt to explore the potential of a bidirectional GLM—General Language Model (Du et al., 2022)—as its backbone.

GLM is a transformer-based language model that leverages autoregressive blank infilling as its training objective. Briefly, for a text sequence $\pmb { x } = [ x _ { 1 } , \cdots , x _ { n } ]$ , text spans $\{ \pmb { s } _ { 1 } , \cdots , \pmb { s } _ { m } \}$ are sampled from it, each of which $\mathbf { \boldsymbol { s } } _ { i }$ denotes a span of consecutive tokens $[ s _ { i , 1 } , \cdots , s _ { i , l _ { i } } ]$ and is replaced (i.e., corrupted) with a single mask token to form $\scriptstyle \mathbf { x } _ { \mathrm { c o r r u p t } } .$ . The model is asked to recover them autoregressively. To allow interactions between corrupted spans, their visibility to each other is decided by a randomly sampled permutation on their order.

GLM’s bidirectional attention over unmasked (i.e., uncorrupted) contexts distinguishes GLM-130B from GPT-style LLMs in which the unidirectional attention is used. To support both understanding and generation, it mixes two corruption objectives, each indicated by a special mask token:

• [MASK]: short blanks in sentences whose lengths add up to a certain portion of the input.   
• [gMASK]: random-length long blanks at the end of sentences with prefix contexts provided.

Conceptually, the blank infilling objective with bidirectional attention enables a more effective comprehension of contexts than GPT-style models: when using [MASK], GLM-130B behaves as BERT (Devlin et al., 2019) and T5 (Raffel et al., 2020); when using [gMASK], GLM-130B behaves similarly to PrefixLM (Liu et al., 2018; Dong et al., 2019).

Empirically, GLM-130B offers a record-high accuracy of 80.2% on zero-shot LAMBADA by outperforming both GPT-3 and PaLM 540B in Figure 2. By setting the attention mask, GLM-130B’s unidirectional variant is comparable to GPT-3 and OPT-175B. Our observations are in line with existing findings (Liu et al., 2018; Dong et al., 2019).

![](images/bc1c94ae508fec99b657ce0534a441f4bf220fabca7caf4a1fa66336908d3c6b.jpg)  
Figure 2: GLM-130B and LLMs of similar scale on zero-shot LAMBADA language modeling. Details on GLM’s bidirectional attention are provided in Du et al. (2022).

Layer Normalization (LN, Ba et al. (2016)). Training instability is one major challenge for training LLMs (Zhang et al., 2022; Scao et al., 2022; Chowdhery et al., 2022) (Cf. Figure 10 in Appendix for collapses in training several 100B-scale models). A proper choice of LNs can help stabilize the training of LLMs. We experiment with existing practices, e.g., Pre-LN (Xiong et al., 2020),

Post-LN (Ba et al., 2016), Sandwich-LN (Ding et al., 2021), which are unfortunately incapable of stabilizing our GLM-130B test runs (Cf. Figure 3 (a) and Appendix B.2 for details).

Our search is later focused on Post-LN due to its favorable downstream results in preliminary experiments though it does not stabilize GLM-130B. Fortunately, one of the attempts on Post-LN initialized with the newly-proposed DeepNorm (Wang et al., 2022b) generates promising training stability. Specifically, given the number of GLM-130B’s layers N, we adopt DeepNorm(x) = LayerNorm(α · x + Network(x)), where $\alpha = ( 2 N ) ^ { \frac { 1 } { 2 } }$ , and apply the Xavier normal initialization with the scaling factor of (2N )− 12 to ffn, v\_proj and out\_proj. Additionally, all bias terms are initialized to zero. Figure 3 shows it significantly benefits the training stability of GLM-130B.

Positional Encoding and FFNs. We empirically test different options for positional encoding (PE) and FFN improvements in terms of both training stability and downstream performance (Cf. Appendix B.3 for details). For PEs in GLM-130B, we adopt Rotary Positional Encoding (RoPE, Su et al. (2021)) rather than ALiBi (Press et al., 2021). To improve FFNs in Transformer, we pick GLU with the GeLU (Hendrycks & Gimpel, 2016) activation as the replacement.

# 2.2 GLM-130B’S PRE-TRAINING SETUP

Inspired by recent works (Aribandi et al., 2022; Wei et al., 2022a; Sanh et al., 2022), the GLM-130B pre-training objective includes not only the self-supervised GLM autoregressive blank infilling) but also multi-task learning for a small portion of tokens. This is expected to help boost its downstream zero-shot performance.

Self-Supervised Blank Infilling (95% tokens). Recall that GLM-130B uses both [MASK] and [gMASK] for this task. Each training sequence is applied with one of them independently at a time. Specifically, [MASK] is used to mask consecutive spans in 30% of training sequences for blank infilling. The lengths of spans follow a Poisson distribution (λ = 3) and add up to 15% of the input. For the other 70% sequences, the prefix of each sequence is kept as context and [gMASK] is used to mask the rest of it. The masked length is sampled from the Uniform distribution.

The pre-training data includes 1.2T Pile (train split) (Gao et al., 2020) English, 1.0T Chinese Wudao-Corpora (Yuan et al., 2021), and 250G Chinese corpora (including online forums, encyclopedia, and QA) we crawl from the web, which form a balanced composition of English and Chinese contents.

Multi-Task Instruction Pre-Training (MIP, 5% tokens). T5 (Raffel et al., 2020) and ExT5 (Aribandi et al., 2022) suggest that multi-task learning in pre-training can be more helpful than fine-tuning, we thus propose to include a variety of instruction prompted datasets including language understanding, generation, and information extraction in GLM-130B’s pre-training.

Compared to recent works (Wei et al., 2022a; Sanh et al., 2022) that leverage multi-task prompted fine-tuning to improve zero-shot task transfer, MIP only accounts for 5% tokens and is set in the pretraining stage to prevent spoiling LLMs’ other general ability, e.g., unconditional free generation. Specifically, we include 74 prompted datasets from (Sanh et al., 2022; Wang et al., 2022a), listed in Appendix C and Table 12. GLM-130B users are suggested to avoid evaluating its zero-shot and few-shot capabilities on these datasets according to the criterion illustrated in Section 5.

# 2.3 PLATFORM-AWARE PARALLEL STRATEGIES AND MODEL CONFIGURATIONS

GLM-130B is trained on a cluster of 96 DGX-A100 GPU (8×40G) servers with a 60-day access. The goal is to pass through as many tokens as possible, as a recent study (Hoffmann et al., 2022) suggests that most existing LLMs are largely under-trained.

The 3D Parallel Strategy. The data parallelism (Valiant, 1990) and tensor model parallelism (Shoeybi et al., 2019) are the de facto practices for training billion-scale models (Wang & Komatsuzaki, 2021; Du et al., 2022). To further handle the huge GPU memory requirement and the decrease in overall GPU utilization resulted from applying tensor parallel between nodes—as 40G rather than 80G A100s are used for training GLM-130B, we combine the pipeline model parallelism with the other two strategies to form a 3D parallel strategy.

The pipeline parallelism divides the model into sequential stages for each parallel group, and to further minimize bubbles introduced by pipeline, we leverage the PipeDream-Flush (Narayanan et al., 2021) implementation from DeepSpeed (Rasley et al., 2020) to train GLM-130B with a relative big global batch size (4,224) to reduce time and GPU memory wasting. Through both numerical and empirical examinations, we adopt 4-way tensor parallelism and 8-way pipeline parallelism (Cf. Appendix B.4 for details). Following the calculation in (Chowdhery et al., 2022), we report hardware FLOPs utilization (HFU) of 43.3% and model FLOPs utilization (MFU) of 32.5% due to re-materialization.

GLM-130B Configurations. We aim to enable our 100B-scale LLM to run a single DGX-A100 (40G) node in FP16 precision. Based on the hidden state dimension of 12,288 we adopt from GPT-3, the resultant model size has to be no more than 130B parameters, thus GLM-130B. To maximize GPU utilization, we configure the model based on the platform and its corresponding parallel strategy. To avoid insufficient memory utilization in the middle stages due to the additional word embedding at both ends, we balance the pipeline partition by removing one layer from them, making 9×8-2=70 transformer layers in GLM-130B.

During the 60-day access to the cluster, we manage to train GLM-130B for 400 billion tokens (roughly 200 billion each for Chinese and English) with a fixed sequence length of 2,048 per sample. For the [gMASK] training objective, we use a context window of 2,048 tokens. For the [MASK] and multi-task objectives, we use a context window of 512 and concatenate four samples together to cater the 2,048-sequence-length. We warm-up the batch size from 192 to 4224 over the first 2.5% samples. We use AdamW (Loshchilov & Hutter, 2019) as our optimizer with $\beta _ { 1 }$ and $\beta _ { 2 }$ set to 0.9 and 0.95, and a weight decay value of 0.1. We warm up the learning rate from $1 0 ^ { - 7 } \mathrm { ~ t o ~ } 8 \times 1 0 ^ { - 5 }$ over the first 0.5% samples, then decay it by a 10× cosine schedule. We use a dropout rate of 0.1 and clip gradients using a clipping value of 1.0 (Cf. Table 11 for the full configurations).

# 3 THE TRAINING STABILITY OF GLM-130B

The training stability is the decisive factor in GLM-130B’s quality, which is also largely impacted by the number of tokens it passes through (Hoffmann et al., 2022). Thus, given the computing usage constraint, there has to be a trade-off between efficiency and stability with regard to floatingpoint (FP) formats: low-precision FP formats (e.g., 16-bit precision—FP16) improve computing efficiency but are prone to overflow and underflow errors, resulting in training collapses.

Mixed-Precision. We follow the common practice of a mixedprecision (Micikevicius et al., 2018) strategy (Apex O2), i.e., FP16 for forwards and backwards and FP32 for optimizer states and master weights, to reduce the GPU memory usage and improve training efficiency. Similar to OPT-175B and BLOOM-176B (C.f. Figure 10 in Appendix), the training of GLM-130B faces frequent loss spikes resulted from this choice, which tends to become increasingly frequent as the training goes on. The precision related spikes are often without clear reasons: some recover on their own; others come with a portent of suddenly soaring gradient norm and eventually a spike or even NaN in loss. OPT-175B attempted to fix by manually skipping data and adjusting hyper-parameters; BLOOM-176B did so via the embedding norm technique (Dettmers et al., 2021). We spent months to empirically investigate the spikes and realize that a few issues emerge when transformers scale up:

First, the transformer main branch’s value scale can be extremely large in deeper layers if using Pre-LN. This is addressed in GLM-130B by using DeepNorm based Post-LN (Cf. Section 2.1), which makes the value scale always bounded.

![](images/059a52af3733ac74755728123b6066cef3cccbe7c1ab0ec51e649b3250650b8c.jpg)

<details>
<summary>line</summary>

| Step | Embedding layer | Transformer layer | Embedding layer (α=0.1) | Transformer layer 0 (α=0.1) |
| ---- | --------------- | ----------------- | ----------------------- | --------------------------- |
| 0    | 1.5             | 0.0               | 1.5                     | 0.0                         |
| 2000 | 0.5             | 0.0               | 0.5                     | 0.0                         |
| 4000 | 0.3             | 0.0               | 0.3                     | 0.0                         |
| 6000 | 0.2             | 0.0               | 0.2                     | 0.0                         |
| 8000 | 0.1             | 0.0               | 0.1                     | 0.0                         |
</details>

![](images/b3b89510001f10e47aa4287de701a5da9e1f8201c3e2499c1fedb21bedc1ec6f.jpg)

<details>
<summary>line</summary>

| Step | w/o shrink (GLM-40B) | shrink α=0.1 (GLM-40B) |
| ---- | --------------------- | ---------------------- |
| 0    | 9.0                   | 9.0                    |
| 2000 | 5.0                   | 5.0                    |
| 4000 | 4.5                   | 4.5                    |
| 6000 | 4.0                   | 4.0                    |
</details>

Figure 4: EGS reduces gradient scale and variance to stabilize LLMs’ pre-training.

Second, the attention scores grow so large that they exceed FP16’s range, as the model scales up. There are a few options to overcome this issue in LLMs. In CogView (Ding et al., 2021), PB-Relax is proposed to remove bias terms and deduct extremum value in attention computation to avoid the problem, which unfortunately does not help avoid disconvergence in GLM-130B. In BLOOM-176B, the BF16 format is used instead of FP16, due to its wide range of values on NVIDIA Ampere GPUs (i.e., A100). However, BF16 consumes ∼15% more run-time GPU memory than FP16 in our experiments due to its conversion to FP32 in gradient accumulation, and more importantly it is not supported on other GPU platforms (e.g., NVIDIA Tesla V100), limiting the accessibility of produced LLMs. Another option from BLOOM-176B is to apply embedding norm with BF16, but in sacrifice of a significant penalty on model performance, as they notice that embedding norm can harm model’s zero-shot learning (Cf. Section 4.3 in (Scao et al., 2022)).

Embedding Layer Gradient Shrink (EGS). Our empirical search identifies that the gradient norm can serve as an informative indicator of training collapses. Specifically, we find that a training collapse usually lags behind a “spike” in gradient norm by a few training steps. Such spikes are usually caused by the embedding layer’s abnormal gradients, as we observe that its gradient norm is often several magnitude larger that those of other layers in GLM-130B’s early stage training (Cf. Figure 4 (a)). In addition, it tends to fluctuate dramatically in the early training. The problem is handled in vision models (Chen et al., 2021) via freezing the patch projection layer. Unfortunately, we cannot freeze the training of the embedding layer in language models.

Finally, we find the gradient shrink on embedding layers could overcome loss spikes and thus stabilize GLM-130B’s training. It is first used in the multi-modal transformer CogView (Ding et al., 2021). Let α be the shrinking factor, the strategy can be easily implemented via word\_embedding = word\_embedding ∗ α + word\_embedding.detach() ∗ (1 − α). Figure 4 (b) suggests that empirically, setting α = 0.1 wipes out most spikes we would have met, with negligible latency.

In fact, the final GLM-130B training run only experiences three late-stage loss divergence cases, though it fails numerous times due to hardware failures. For the three unexpected spikes, it turns out further shrinking the embedding gradient can still help stabilize the GLM-130B training. See the training notes and Tensorboard logs in our code repository for details.

# 4 GLM-130B INFERENCE ON RTX 2080 TI

One of the major goals of GLM-130B is to lower the hardware requirements for accessing 100Bscale LLMs without efficiency and effectiveness disadvantages.

As mentioned, the model size of 130B is determined for running the full GLM-130B model on a single A100 (40G×8) server, rather than the high-end A100 (80G×8) machine required by OPT-175B and BLOOM-176B. To accelerate GLM-130B inference, we also leverage FasterTransformer (Timonin et al., 2022) to implement GLM-130B in C++. Compared to the PyTorch implementation of BLOOM-176B in Huggingface, GLM-130B’s decoding inference is 7-8.4× faster on the same single A100 server. (Cf. Appendix B.5 for details).

INT4 Quantization for RTX 3090s/2080s. To further support popularized GPUs, we attempt to compress GLM-130B as much as possible while maintaining performance superiority, particularly via quantization (Zafrir et al., 2019; Shen et al., 2020; Tao et al., 2022), which introduces little task-agnostic performance drops for generative language models.

Typically, the practice is to quantize both model weights and activations to INT8. However, our analysis in Appendix B.6 suggests that LLMs’ activations may contain extreme outliers. Concurrently, the emergent outliers in OPT-175B and BLOOM-176B are also discovered (Dettmers et al., 2022), which influence only about 0.1% feature dimensions and are thus solved by matrix multiplication decomposition for the outlying dimensions. Differently, there exist about 30% outliers in GLM-130B’s activations, making the technique above far less efficient. Thus, we decide to focus on the quantization of model weights (i.e., mostly linear layers) while keeping the FP16 precision for activations. The quantized model is dynamically converted to FP16 precision at runtime, introducing a small computational overhead but greatly reducing the GPU memory usage for storing model weights.

![](images/8ea1f9d14b6b25c4eb80286f708841b163907b180510b0921b539ae1f379378a.jpg)

<details>
<summary>line</summary>

| Model        | Effective Parameter Count | LAMBADA (0-shot) |
| ------------ | ------------------------- | ---------------- |
| GLM-16-bit   | 10^8                      | 80               |
| GLM-16-bit   | 10^9                      | 70               |
| GLM-16-bit   | 10^10                     | 60               |
| GLM-16-bit   | 10^11                     | 50               |
| GLM-174B     | 10^8                      | 80               |
| GLM-174B     | 10^9                      | 60               |
| GLM-174B     | 10^10                     | 50               |
| GLM-174B     | 10^11                     | 40               |
| BLOOM-176B   | 10^8                      | 80               |
| BLOOM-176B   | 10^9                      | 60               |
| BLOOM-176B   | 10^10                     | 50               |
| BLOOM-176B   | 10^11                     | 40               |
</details>

Figure 5: (Left) attn-dense and $w 2 ^ { \prime } \mathrm { s }$ weight distributions; (Right) GLM-130B’s INT4 weight quantization scaling law.

Table 2: Left: Quantized GLM-130B’s performance on several benchmarks; Right: INT4 quantized GLM-130B’s inference speed (encode and decode) with FasterTransformer. 

<table><tr><td rowspan="2">Model Precision</td><td colspan="3">GLM-130B</td><td>GPT-3</td><td rowspan="2">GPU Type</td><td rowspan="2" colspan="2">128 Enc./Dec.</td><td rowspan="2" colspan="2">512 Enc./Dec,</td></tr><tr><td>FP16</td><td>INT8</td><td>INT4</td><td>FP16</td></tr><tr><td>MMLU (acc,↑)</td><td>44.75</td><td>44.71</td><td>44.80</td><td>43.9</td><td>8 × A100 (40G)</td><td>0.15s</td><td>4.29s</td><td>0.18s</td><td>17.7s</td></tr><tr><td>LAMBADA (acc,↑)</td><td>80.21</td><td>80.21</td><td>79.47</td><td>76.2</td><td>8 × V100 (32G)</td><td>0.31s</td><td>6.97s</td><td>0.67s</td><td>28.1s</td></tr><tr><td rowspan="2">Pile (a part, BPB,↓)</td><td rowspan="2">0.634</td><td rowspan="2">0.638</td><td rowspan="2">0.641</td><td rowspan="2">0.74</td><td>4 × RTX 3090 (24G)</td><td>0.37s</td><td>8.16s</td><td>1.30s</td><td>32.3s</td></tr><tr><td>8 × RTX 2080 Ti (11G)</td><td>0.39s</td><td>6.77s</td><td>1.04s</td><td>27.3s</td></tr></table>

Excitingly, we manage to reach the INT4 weight quantization for GLM-130B while existing successes have thus far only come to the INT8. Memory-wise, by comparing to INT8, the INT4 version helps additionally save half of the required GPU memory to 70GB, thus allowing GLM-130B inference on 4 × RTX 3090 Ti (24G) or 8 × RTX 2080 Ti (11G). Performance-wise, Table 2 left indicates that without post-training at all, the INT4-version GLM-130B experiences almost no performance degradation, thus maintaining the performance advantages over GPT-3 on common benchmarks.

GLM’s INT4 Weight Quantization Scaling Law. We examine the underlying mechanism of this unique INT4 weight quantization scaling law exhibited in Figure 5 right. We plot the weight value distributions in Figure 5 left, which turns out to directly impact the quantization quality. Specifically, a wider-distributed linear layer needs to be quantized with larger bins, leading to more precision loss. Thus the wide-distributed attn-dense and w2 matrices explain the INT4 quantization failure for GPT-style BLOOM. Conversely, GLMs tend to have much narrower distributions than those of similar-sized GPTs, and the gap between INT4 and FP16 versions keeps further decreasing as the GLM model size scales up (Cf. Figure 15 in Appendix for details).

# 5 THE RESULTS

We follow the common settings in LLMs such as GPT-3 and PaLM to evaluate GLM-130B for English 1. As a bilingual LLM with Chinese, GLM-130B is also evaluated on Chinese benchmarks.

Discussion on the Scope of Zero-Shot Learning in GLM-130B. Since GLM-130B has been trained with MIP, here we clarify its scope of zero-shot evaluation. In fact, “zero-shot” seems to have controversial interpretations without a consensus in the community. We follow one of the influential related surveys (Xian et al., 2018), which says “At test time, in zero-shot learning setting, the aim is to assign a test image to an unseen class label” where involving unseen class labels is a key. Therefore, we derive our criterion to pick GLM-130B’s zero-shot (and few-shot) datasets as:

• English: 1) For tasks with fixed labels (e.g., natural language inference): no datasets in such tasks should be evaluated on; 2) For tasks without fixed labels (e.g., (multiple-choice) QA, topic classification): only datasets with an obvious domain transfer from those in MIP should be considered.   
• Chinese: All datasets can be evaluated as there exists a zero-shot cross-lingual transfer.

Filtering Test Datasets. Following prior practices (Brown et al., 2020; Rae et al., 2021) and our criterion mentioned above, we filter and refrain to report potentially contaminated datasets’ evaluation results. For LAMBADA and CLUE, we find minimal overlap under the 13-gram setting. Pile, MMLU, and BIG-bench are either held-out or released later than the crawling of corpora.

# 5.1 LANGUAGE MODELING

LAMBADA. LAMBADA (Paperno et al., 2016) is a dataset to test the last word language modeling capability. The results previously shown in Figure 2 suggest GLM-130B achieves a zero-shot accuracy of 80.2 with its bidirectional attention, setting up a new record on LAMBADA.

Pile. The Pile test-set (Gao et al., 2020) includes a series of benchmarks for language modeling. On average, GLM-130B performs the best on its 18 shared test sets in terms of weighted BPB when compared to GPT-3 and Jurassic-1 (Lieber et al., 2021) whose results are directly adopted from the latter, demonstrating its strong language capabilit

Table 3: GLM-130B’s average BPB on Pile evaluation (18 sub-datasets). 

<table><tr><td></td><td>Jurassic-1</td><td>GPT-3</td><td>GLM-130B</td></tr><tr><td>Avg. BPB</td><td>0.650</td><td>0.742</td><td>0.634</td></tr></table>

(Cf. Appendix C.4 for details).

![](images/c0cfe7372c33460c2f0dec3506887666e81fad229e0e9a041ba023f7ee9b0aab.jpg)

<details>
<summary>line</summary>

| Trained Tokens (Billion) | GLM-130B (5-shot) |
| ------------------------- | ----------------- |
| 300                       | 45.0              |
| 370                       | 33.0              |
</details>

Figure 6: GLM-130B on MMLU (57 tasks) along training steps.

![](images/e79ca1f9e431e29a461e2a09b337357e2fd565f715d932c8dee8395741e8afe8.jpg)

<details>
<summary>line</summary>

| Effective Parameter Count | GLM-130B 0-shot | GLM-130B 1-shot | GLM-130B 3-shot | GPT-3 0-shot | GPT-3 1-shot | GPT-3 3-shot | PaLM 0-shot |
| ------------------------- | --------------- | --------------- | --------------- | ------------ | ------------ | ------------ | ----------- |
| 10^8                      | 0               | 0               | 0               | 0            | 0            | 0            | 0           |
| 10^9                      | 1               | 1               | 1               | 1            | 1            | 1            | 1           |
| 10^10                     | 2               | 2               | 2               | 2            | 2            | 2            | 2           |
| 10^11                     | 14              | 14              | 14              | 4            | 11           | 13           | 8           |
</details>

Figure 7: BIG-bench-lite evaluation (24 tasks) across scales.

<table><tr><td></td><td>0-shot</td><td>1-shot</td><td>3-shot</td></tr><tr><td>GPT-3 2.6B</td><td>0.60</td><td>0.71</td><td>1.83</td></tr><tr><td>GPT-3 6.7B</td><td>-0.06</td><td>2.93</td><td>5.40</td></tr><tr><td>GPT-3 13B</td><td>1.77</td><td>5.43</td><td>7.95</td></tr><tr><td>GPT-3 175B</td><td>4.35</td><td>11.34</td><td>13.18</td></tr><tr><td>PaLM 540B</td><td>8.05</td><td>37.77</td><td>-</td></tr><tr><td>GLM-130B</td><td>13.31</td><td>14.91</td><td>15.12</td></tr></table>

Table 4: Details on BIGbench-lite (24 tasks).

# 5.2 MASSIVE MULTITASK LANGUAGE UNDERSTANDING (MMLU)

MMLU (Hendrycks et al., 2021) is a diverse benchmark including 57 multi-choice question answering tasks concerning human knowledge ranging from high-school-level to expert-level. It is released after the crawling of Pile and serves as an ideal test-bed for LLMs’ few-shot learning. The GPT-3 result is adopted from MMLU and BLOOM-176B is tested by using the same prompts as GLM-130B’s (Cf. Appendix C.6 and Table 15 for details).

GLM-130B’s few-shot (5-shot) performance on MMLU approaches GPT-3 (43.9) after viewing about 300B tokens in Figure 6. It continues moving up as the training proceeds, achieving an accuracy of 44.8 when the training has to end (i.e., viewing 400B tokens in total). This aligns with the observation (Hoffmann et al., 2022) that most existing LLMs are far from adequately trained.

# 5.3 BEYOND THE IMITATION GAME BENCHMARK (BIG-BENCH)

BIG-bench (Srivastava et al., 2022) benchmarks challenging tasks concerning models’ ability on reasoning, knowledge, and commonsense. Given evaluating on its 150 tasks is time-consuming for LLMs, we report the BIG-bench-lite—an official 24-task sub-collection—for now. Observed from Figure 7 and Table 4, GLM-130B outperforms GPT-3 175B and even PaLM 540B (4× larger) in zero-shot setting. This is probably owing to GLM-130B’s bidirectional context attention and MIP, which has been proved to improve zero-shot results in unseen tasks (Wei et al., 2022a; Sanh et al., 2022). As the number of shots increases, GLM-130B’s performance keeps going up, maintaining its outperformance over GPT-3 (Cf. Appendix C.5 and Table 14 for details on each model and task).

Limitations and Discussions. In the experiments above, we observe that GLM-130B’s performance growth (13.31 to 15.12) with the increase of few-shot samples is not as significant as GPT-3’s (4.35 to 13.18). Here is our intuitive attempt to understand the phenomenon.

First, the bidirectional nature of GLM-130B could lead to strong zero-shot performance (as is indicated in zero-shot language modeling), thus getting closer to the few-shot “upper-bound” for models of similar scale (i.e., 100B-scale) than unidirectional LLMs. Second, it may be also attributed to a deficit of existing MIP paradigms (Wei et al., 2022a; Sanh et al., 2022), which only involve zero-shot prediction in the training and will be likely to bias GLM-130B for stronger zero-shot learning but relatively weaker in-context few-shot performance. To correct the bias, a potential solution we came up with would be to employ MIP with varied shots of in-context samples rather than only zero-shot samples.

Finally, despite almost the same GPT architecture as GPT-3, PaLM 540B’s relative growth with fewshot in-context learning is substantially more significant than GPT-3’s. We conjecture this further acceleration in performance growth is a source of PaLM’s high-quality and diverse private-collected training corpora. By combining our experiences with (Hoffmann et al., 2022)’s insights, we came to realize that better architectures, better data, and more training FLOPS should be further invested.

# 5.4 CHINESE LANGUAGE UNDERSTANDING EVALUATION (CLUE)

We evaluate GLM-130B’s Chinese zero-shot performance on established Chinese NLP benchmarks, CLUE (Xu et al., 2020) and FewCLUE (Xu et al., 2021).Note that we do not include any Chinese downstream tasks in MIP. To date, we have finished testing on part of the two benchmarks, including

![](images/b60e0ec17ee69cfa51161d93528227b480646d5df084a9fba9faf663e336c9af.jpg)

<details>
<summary>bar</summary>

| Model | GLM-130B | ERNIE 3.0 Titan-260B |
|---|---|---|
| EPRSTMT | 92.5 | 88.8 |
| OCNLI-FC | 73.8 | 53.8 |
| BUSTM | 77.5 | 64.4 |
| CHID-FC | 90.1 | 87.1 |
| CLUEWSC-FC | 77.4 | 53.5 |
| C3 | 77.5 | 54.9 |
| WSC1.1 | 83.9 | 81.1 |
| CMNLI | 77.0 | 51.7 |
| DRCD | 77.1 | 29.5 |
| OCNLI_50K | 74.7 | 44.6 |
| AFQMC | 71.2 | 69.0 |
| CMRC2018 | 55.7 | 16.6 |
</details>

Figure 8: GLM-130B and ERNIE Titan 3.0 260B evaluated on zero-shot CLUE and FewCLUE.

7 CLUE and 5 FewCLUE datasets (Cf. Appendix C.7 for details). We compare GLM-130B to the largest existing Chinese monolingual language model—the 260B ERNIE Titan 3.0 (Wang et al., 2021). We follow its setting to report zero-shot results on dev datasets. GLM-130B consistently outperforms ERNIE Titan 3.0 across 12 tasks (Cf. Figure 8). Interestingly, GLM-130B performs at least 260% better than ERNIE on two abstractive MRC datasets (DRCD and CMRC2018), possibly due to GLM-130B’s pre-training objective that naturally resonates to abstractive MRC’s form.

# 6 RELATED WORK

In this section, we review related work to GLM-130B on topics of pre-training, transferring, and inference of pre-trained LLMs (Qiu et al., 2020; Bommasani et al., 2021).

Pre-Training. Vanilla language modeling refers to decoder-only autoregressive models (e.g., GPT (Radford et al., 2018)), but it also recognizes any forms of self-supervised objectives on texts. Recently, transformer-based (Vaswani et al., 2017) language models present a fascinating scaling law: new abilities (Wei et al., 2022b) arise as models scale up, from 1.5B (Radford et al., 2019), 10B-scale language models (Raffel et al., 2020; Shoeybi et al., 2019; Black et al., 2022), to 100Bscale GPT-3 (Brown et al., 2020). Later, despite many 100B-scale LLMs (Lieber et al., 2021; Thoppilan et al., 2022; Rae et al., 2021; Smith et al., 2022; Chowdhery et al., 2022; Wu et al., 2021; Zeng et al., 2021; Wang et al., 2021) in both English and Chinese, they are not available to public or only accessible via limited APIs. The closeness of LLMs severely stymies its development. GLM-130B’s efforts, along with recent ElutherAI, OPT-175B (Zhang et al., 2022), and BLOOM-176B (Scao et al., 2022), aim to offer high-quality open-sourced LLMs to our community.

Transferring. Though fine-tuning has been a de facto way for transfer learning, the evaluation for LLMs has been focused on prompting and in-context learning due to their tremendous sizes (Brown et al., 2020; Liu et al., 2021a). Nevertheless, some recent attempts has been on parameter-efficient learning on language models (Houlsby et al., 2019) and prompt tuning (i.e., P-tuning, Li & Liang (2021); Liu et al. (2021b); Lester et al. (2021); Liu et al. (2022)). For now we do not focus on them and will leave the comprehensive testing of them on GLM-130B in future study.

Inference. Most public-accessible LLMs nowadays are providing their services via limited APIs.In this work, an important part of our endeavor has been on LLMs’ efficient and fast inference. Related work may include distillation (Sanh et al., 2019; Jiao et al., 2020; Wang et al., 2020), quantization (Zafrir et al., 2019; Shen et al., 2020; Tao et al., 2022), and pruning (Michel et al., 2019; Fan et al., 2019). Very recent work (Dettmers et al., 2022) shows that LLMs such as OPT-175B and BLOOM-176B can be quantized to 8 bit due to special distribution of outlier dimensions. In this work, we demonstrate GLM’s scaling law for INT4 weight quantization, which allows GLM-130B to inference on as few as 4×RTX 3090 (24G) GPUs or 8×RTX 2080 Ti (11G) GPUs.

# 7 CONCLUSION AND LESSONS

We introduce GLM-130B, a bilingual pre-trained language model that aims to facilitate open and inclusive LLM research. GLM-130B’s technical and engineering undertakings generate insight into LLMs’ architectures, pre-training objectives, training stability and efficiency, and affordable inference. Altogether, it contributes to the high quality of GLM-130B in terms of both language performance on 112 tasks and ethical results on bias and toxicity benchmarks. Our experiences of both success and failure are condensed into the lessons for training 100B-scale LLMs, attached in the Appendix B.10.

# ACKNOWLEDGEMENT

This research was supported by Natural Science Foundation of China (NSFC) 61825602, 62276148 and Zhipu.AI. We thank all our collaborators and partners from the Knowledge Engineering Group (KEG), Parallel Architecture & Compiler technology of Mobile, Accelerated, and Networked systems Group (PACMAN), Natural Language Processing Group (THUNLP) at Tsinghua University, and Zhipu.AI.

# ETHICS STATEMENT

We hereby acknowledge that all of the co-authors of this work are aware of the provided ICLR Code of Ethics and honor the code of conduct. This work introduces an open-source Large Language Model (LLM), which could be used to generate synthetic text for harmful applications, such as telemarketing fraud, political propaganda, and personal harassment as is discussed in (Weidinger et al., 2021; Sheng et al., 2021; Dev et al., 2021). We do not anticipate any hazardous outputs, especially towards vulnerable and historically disadvantaged groups of peoples, after using the model.

And to better collaborate with our community to prevent and ultimately eliminate the risks technically, we make the following crucial open efforts in this work:

Open-Sourced LLMs for Ethical Risk Study. While some people think that restricting the access of LLMs can prevent such harmful applications, we argue that promoting LLM inclusivity can lead to better defense against potential harms caused by LLMs. Currently, only governments and large corporations can afford the considerable costs of pre-training LLMs. There is no guarantee that organizations having the the substantial financial resources will not do harm using a LLM. Without access to such LLMs, individuals cannot even realize the role of LLMs in the harm.

Conversely, releasing an open LLM can provide access and transparency to all the researchers and promote the research to reduce the potential harm of LLMs, like algorithms to identify the synthetic text Gehrmann et al. (2019). Also, it is known that LLMs can suffer from problems in fairness, bias, privacy, and truthfulness Zhang et al. (2021); Lin et al. (2022); Liang et al. (2021); Bender et al. (2021). An open LLM can reveal the model parameters and internal states corresponding to specific inputs instead of providing APIs to black-box models. In conclusion, researchers can conduct analysis of LLMs’ flaws in depth and propose improved algorithms to solve the problems.

Ethical Evaluation and Improvements. We also evaluate our model over a wide range of English ethical evaluation benchmarks, including bias measurement (Nadeem et al., 2021; Nangia et al., 2020), hate speech detection (Mollas et al., 2020), and toxic generation estimation (Gehman et al., 2020). Notwithstanding their deficiency (Blodgett et al., 2021; Jacobs & Wallach, 2021), these datasets serve as a meaningful initial step towards an open quantitative evaluation LLMs.

Our evaluation implies that our algorithm designs, especially the bilingual pre-training of a LLM, can significantly mitigate the biases and toxicity an LLM may present while keeping its strong language performance compared to other LLMs (Brown et al., 2020; Zhang et al., 2022) trained with monolingual English corpora (Cf. Appendix A for more details).

# REPRODUCIBILITY

Compared to mainstream closed-sourced LLMs including GPT-3 175B(Brown et al., 2020), PaLM 540B (Chowdhery et al., 2022), Gopher (Rae et al., 2021), Chinchilla (Hoffmann et al., 2022), LaMDA (Thoppilan et al., 2022), FLAN (Wei et al., 2022a), and many others, GLM-130B is opensourced and devotes to promote openness and inclusivity in LLM research from the very beginning.

We have paid great effort to ensure the reproducibility of our evaluation. For pre-training section, despite the unaffordable costs it needs to reproduce at present, we still make our best efforts to disclose the code, details, and the whole process of GLM-130B’s pre-training. Our endeavor to allow GLM-130B inference on few popularized GPUs such as 3090/2080 Ti also aligns with the reproducibility undertaking, as it allows most academic researchers to reproduce GLM-130B’s results on their offline machines. We also provide free APIs for individual users to test GLM-130B’s ability.

Pre-Training. We provide the complete training notes, Tensorboard logs, and code for our pretraining in our repository (Cf. Abstract). The pre-training hyper-parameters and cluster configuration are provided in Section 2.3 and Table 11. The training corpora composition and details for Multi-task Instruction Pre-training are provided in Section 2.2 and Appendix C.1 and C.2.

Evaluation. We organize all the evaluation, including language benchmarks (LAMBADA, Pile, MMLU, BIG-bench, CLUE, and FewCLUE) and ethical benchmarks (CrowS-Pairs, StereoSet, ETHOS, RealToxicPrompts), into one-command-to-run bash scripts in our code repository. Data processing details for language modeling benchmarks are provided in Section 5.1 and Appendix C.4, for MMLU are provided in Section 5.2 and Appendix C.6, for BIG-bench are provided in Section 5.3 and Appendix C.5, for CLUE and FewCLUE are provided in 5.4. For all ethical evaluation, please refer to Appendix A for details.

# REFERENCES

Oshin Agarwal, Heming Ge, Siamak Shakeri, and Rami Al-Rfou. Knowledge graph based synthetic corpus generation for knowledge-enhanced language model pre-training. In Proceedings of the 2021 Conference of the North American Chapter of the Association for Computational Linguistics: Human Language Technologies, pp. 3554–3565, 2021.   
Vamsi Aribandi, Yi Tay, Tal Schuster, Jinfeng Rao, Huaixiu Steven Zheng, Sanket Vaibhav Mehta, Honglei Zhuang, Vinh Q Tran, Dara Bahri, Jianmo Ni, et al. Ext5: Towards extreme multi-task scaling for transfer learning. In International Conference on Learning Representations, 2022.   
Mikel Artetxe, Shruti Bhosale, Naman Goyal, Todor Mihaylov, Myle Ott, Sam Shleifer, Xi Victoria Lin, Jingfei Du, Srinivasan Iyer, Ramakanth Pasunuru, et al. Efficient large scale language modeling with mixtures of experts. arXiv preprint arXiv:2112.10684, 2021.   
Jimmy Lei Ba, Jamie Ryan Kiros, and Geoffrey E Hinton. Layer normalization. arXiv preprint arXiv:1607.06450, 2016.   
Stephen Bach, Victor Sanh, Zheng Xin Yong, Albert Webson, Colin Raffel, Nihal V Nayak, Abheesht Sharma, Taewoon Kim, M Saiful Bari, Thibault Févry, et al. Promptsource: An integrated development environment and repository for natural language prompts. In Proceedings of the 60th Annual Meeting of the Association for Computational Linguistics: System Demonstrations, pp. 93–104, 2022.   
Emily M. Bender, Timnit Gebru, Angelina McMillan-Major, and Shmargaret Shmitchell. On the dangers of stochastic parrots: Can language models be too big? In FAccT ’21: 2021 ACM Conference on Fairness, Accountability, and Transparency, Virtual Event / Toronto, Canada, March 3-10, 2021, pp. 610–623. ACM, 2021.   
Jonathan Berant, Andrew Chou, Roy Frostig, and Percy Liang. Semantic parsing on freebase from question-answer pairs. In Proceedings of the 2013 conference on empirical methods in natural language processing, pp. 1533–1544, 2013.   
Yonatan Bisk, Rowan Zellers, Jianfeng Gao, Yejin Choi, et al. Piqa: Reasoning about physical commonsense in natural language. In Proceedings of the AAAI conference on artificial intelligence, volume 34, pp. 7432–7439, 2020.   
Sidney Black, Stella Biderman, Eric Hallahan, Quentin Anthony, Leo Gao, Laurence Golding, Horace He, Connor Leahy, Kyle McDonell, Jason Phang, et al. Gpt-neox-20b: An open-source autoregressive language model. In Proceedings of BigScience Episode\# 5–Workshop on Challenges & Perspectives in Creating Large Language Models, pp. 95–136, 2022.   
Su Lin Blodgett, Gilsinia Lopez, Alexandra Olteanu, Robert Sim, and Hanna Wallach. Stereotyping norwegian salmon: An inventory of pitfalls in fairness benchmark datasets. In Proceedings of the 59th Annual Meeting of the Association for Computational Linguistics and the 11th International Joint Conference on Natural Language Processing (Volume 1: Long Papers), pp. 1004–1015, 2021.

Rishi Bommasani, Drew A Hudson, Ehsan Adeli, Russ Altman, Simran Arora, Sydney von Arx, Michael S Bernstein, Jeannette Bohg, Antoine Bosselut, Emma Brunskill, et al. On the opportunities and risks of foundation models. arXiv preprint arXiv:2108.07258, 2021.   
Tom Brown, Benjamin Mann, Nick Ryder, Melanie Subbiah, Jared D Kaplan, Prafulla Dhariwal, Arvind Neelakantan, Pranav Shyam, Girish Sastry, Amanda Askell, et al. Language models are few-shot learners. Advances in neural information processing systems, 33:1877–1901, 2020.   
Nicola De Cao, Wilker Aziz, and Ivan Titov. Editing factual knowledge in language models. In Proceedings of the 2021 Conference on Empirical Methods in Natural Language Processing, EMNLP 2021, Virtual Event / Punta Cana, Dominican Republic, 7-11 November, 2021, pp. 6491– 6506. Association for Computational Linguistics, 2021.   
Xavier Carreras and Lluís Màrquez. Introduction to the conll-2005 shared task: Semantic role labeling. In CoNLL, pp. 152–164, 2005.   
Thiago Castro Ferreira, Claire Gardent, Nikolai Ilinykh, Chris van der Lee, Simon Mille, Diego Moussallem, and Anastasia Shimorina. The 2020 bilingual, bi-directional WebNLG+ shared task: Overview and evaluation results (WebNLG+ 2020). In Proceedings of the 3rd International Workshop on Natural Language Generation from the Semantic Web (WebNLG+), pp. 55–76, Dublin, Ireland (Virtual), 12 2020. Association for Computational Linguistics. URL https://aclanthology.org/2020.webnlg-1.7.   
Xinlei Chen, Saining Xie, and Kaiming He. An empirical study of training self-supervised vision transformers. In Proceedings of the IEEE/CVF International Conference on Computer Vision, pp. 9640–9649, 2021.   
Ke-Li Chiu and Rohan Alexander. Detecting hate speech with gpt-3. arXiv preprint arXiv:2103.12407, 2021.   
Aakanksha Chowdhery, Sharan Narang, Jacob Devlin, Maarten Bosma, Gaurav Mishra, Adam Roberts, Paul Barham, Hyung Won Chung, Charles Sutton, Sebastian Gehrmann, et al. Palm: Scaling language modeling with pathways. arXiv preprint arXiv:2204.02311, 2022.   
Peter Clark, Isaac Cowhey, Oren Etzioni, Tushar Khot, Ashish Sabharwal, Carissa Schoenick, and Oyvind Tafjord. Think you have solved question answering? try arc, the ai2 reasoning challenge. arXiv preprint arXiv:1803.05457, 2018.   
Zihang Dai, Zhilin Yang, Yiming Yang, Jaime G Carbonell, Quoc Le, and Ruslan Salakhutdinov. Transformer-xl: Attentive language models beyond a fixed-length context. In Proceedings of the 57th Annual Meeting of the Association for Computational Linguistics, pp. 2978–2988, 2019.   
Tim Dettmers, Mike Lewis, Sam Shleifer, and Luke Zettlemoyer. 8-bit optimizers via block-wise quantization. arXiv preprint arXiv:2110.02861, 2021.   
Tim Dettmers, Mike Lewis, Younes Belkada, and Luke Zettlemoyer. Llm. int8 (): 8-bit matrix multiplication for transformers at scale. arXiv preprint arXiv:2208.07339, 2022.   
Sunipa Dev, Masoud Monajatipoor, Anaelia Ovalle, Arjun Subramonian, J. M. Phillips, and Kai Wei Chang. Harms of gender exclusivity and challenges in non-binary representation in language technologies. ArXiv, abs/2108.12084, 2021.   
Jacob Devlin, Ming-Wei Chang, Kenton Lee, and Kristina Toutanova. Bert: Pre-training of deep bidirectional transformers for language understanding. In Proceedings of the 2019 Conference of the North American Chapter of the Association for Computational Linguistics: Human Language Technologies, Volume 1 (Long and Short Papers), pp. 4171–4186, 2019.   
Ming Ding, Zhuoyi Yang, Wenyi Hong, Wendi Zheng, Chang Zhou, Da Yin, Junyang Lin, Xu Zou, Zhou Shao, Hongxia Yang, et al. Cogview: Mastering text-to-image generation via transformers. Advances in Neural Information Processing Systems, 34:19822–19835, 2021.   
Li Dong, Nan Yang, Wenhui Wang, Furu Wei, Xiaodong Liu, Yu Wang, Jianfeng Gao, Ming Zhou, and Hsiao-Wuen Hon. Unified language model pre-training for natural language understanding and generation. Advances in Neural Information Processing Systems, 32, 2019.

Zhengxiao Du, Yujie Qian, Xiao Liu, Ming Ding, Jiezhong Qiu, Zhilin Yang, and Jie Tang. Glm: General language model pretraining with autoregressive blank infilling. In Proceedings of the 60th Annual Meeting of the Association for Computational Linguistics (Volume 1: Long Papers), pp. 320–335, 2022.   
Ondˇrej Dušek, David M. Howcroft, and Verena Rieser. Semantic noise matters for neural natural language generation. In Proceedings of the 12th International Conference on Natural Language Generation, pp. 421–426, Tokyo, Japan, October–November 2019. Association for Computational Linguistics. doi: 10.18653/v1/W19-8652. URL https://aclanthology.org/W19 -8652.   
Hady Elsahar, Pavlos Vougiouklis, Arslen Remaci, Christophe Gravier, Jonathon Hare, Frederique Laforest, and Elena Simperl. T-rex: A large scale alignment of natural language with knowledge base triples. In Proceedings of the Eleventh International Conference on Language Resources and Evaluation (LREC 2018), 2018.   
Mihail Eric, Rahul Goel, Shachi Paul, Abhishek Sethi, Sanchit Agarwal, Shuyang Gao, Adarsh Kumar, Anuj Kumar Goyal, Peter Ku, and Dilek Hakkani-Tür. Multiwoz 2.1: A consolidated multi-domain dialogue dataset with state corrections and state tracking baselines. In LREC, 2020.   
Angela Fan, Edouard Grave, and Armand Joulin. Reducing transformer depth on demand with structured dropout. arXiv preprint arXiv:1909.11556, 2019.   
Leo Gao, Stella Biderman, Sid Black, Laurence Golding, Travis Hoppe, Charles Foster, Jason Phang, Horace He, Anish Thite, Noa Nabeshima, et al. The pile: An 800gb dataset of diverse text for language modeling. arXiv preprint arXiv:2101.00027, 2020.   
Samuel Gehman, Suchin Gururangan, Maarten Sap, Yejin Choi, and Noah A. Smith. Realtoxicityprompts: Evaluating Neural Toxic Degeneration in Language Models. dblp://journals/dblp, 2020.   
Sebastian Gehrmann, Hendrik Strobelt, and Alexander Rush. GLTR: Statistical detection and visualization of generated text. In Proceedings of the 57th Annual Meeting of the Association for Computational Linguistics: System Demonstrations, pp. 111–116, Florence, Italy, July 2019. Association for Computational Linguistics.   
Sebastian Gehrmann, Tosin Adewumi, Karmanya Aggarwal, Pawan Sasanka Ammanamanchi, Aremu Anuoluwapo, Antoine Bosselut, Khyathi Raghavi Chandu, Miruna Clinciu, Dipanjan Das, Kaustubh D Dhole, et al. The gem benchmark: Natural language generation, its evaluation and metrics. GEM 2021, pp. 96, 2021.   
Mor Geva, Daniel Khashabi, Elad Segal, Tushar Khot, Dan Roth, and Jonathan Berant. Did aristotle use a laptop? a question answering benchmark with implicit reasoning strategies. Transactions of the Association for Computational Linguistics, 9:346–361, 2021.   
Peter Hase, Mona T. Diab, Asli Celikyilmaz, Xian Li, Zornitsa Kozareva, Veselin Stoyanov, Mohit Bansal, and Srinivasan Iyer. Do language models have beliefs? methods for detecting, updating, and visualizing model beliefs. CoRR, abs/2111.13654, 2021.   
Ruining He, Anirudh Ravula, Bhargav Kanagal, and Joshua Ainslie. Realformer: Transformer likes residual attention. In Findings of the Association for Computational Linguistics: ACL-IJCNLP 2021, pp. 929–943, 2021.   
Dan Hendrycks and Kevin Gimpel. Gaussian error linear units (gelus). arXiv preprint arXiv:1606.08415, 2016.   
Dan Hendrycks, Collin Burns, Steven Basart, Andy Zou, Mantas Mazeika, Dawn Song, and Jacob Steinhardt. Measuring massive multitask language understanding. In International Conference on Learning Representations, 2021.   
Jordan Hoffmann, Sebastian Borgeaud, Arthur Mensch, Elena Buchatskaya, Trevor Cai, Eliza Rutherford, Diego de Las Casas, Lisa Anne Hendricks, Johannes Welbl, Aidan Clark, et al. Training compute-optimal large language models. arXiv preprint arXiv:2203.15556, 2022.

Wenyi Hong, Ming Ding, Wendi Zheng, Xinghan Liu, and Jie Tang. Cogvideo: Large-scale pretraining for text-to-video generation via transformers. arXiv preprint arXiv:2205.15868, 2022.   
Neil Houlsby, Andrei Giurgiu, Stanislaw Jastrzebski, Bruna Morrone, Quentin De Laroussilhe, Andrea Gesmundo, Mona Attariyan, and Sylvain Gelly. Parameter-efficient transfer learning for nlp. In International Conference on Machine Learning, pp. 2790–2799. PMLR, 2019.   
Yanping Huang, Youlong Cheng, Ankur Bapna, Orhan Firat, Dehao Chen, Mia Chen, HyoukJoong Lee, Jiquan Ngiam, Quoc V Le, Yonghui Wu, et al. Gpipe: Efficient training of giant neural networks using pipeline parallelism. Advances in neural information processing systems, 32, 2019.   
Abigail Z Jacobs and Hanna Wallach. Measurement and fairness. In Proceedings of the 2021 ACM conference on fairness, accountability, and transparency, pp. 375–385, 2021.   
Xiaoqi Jiao, Yichun Yin, Lifeng Shang, Xin Jiang, Xiao Chen, Linlin Li, Fang Wang, and Qun Liu. Tinybert: Distilling bert for natural language understanding. In Findings of the Association for Computational Linguistics: EMNLP 2020, pp. 4163–4174, 2020.   
Mandar Joshi, Eunsol Choi, Daniel S Weld, and Luke Zettlemoyer. Triviaqa: A large scale distantly supervised challenge dataset for reading comprehension. In Proceedings of the 55th Annual Meeting of the Association for Computational Linguistics (Volume 1: Long Papers), pp. 1601–1611, 2017.   
Paul R Kingsbury and Martha Palmer. From treebank to propbank. Citeseer.   
Tom Kwiatkowski, Jennimaria Palomaki, Olivia Redfield, Michael Collins, Ankur Parikh, Chris Alberti, Danielle Epstein, Illia Polosukhin, Jacob Devlin, Kenton Lee, et al. Natural questions: a benchmark for question answering research. Transactions of the Association for Computational Linguistics, 7:453–466, 2019.   
Alexandre Lacoste, Alexandra Luccioni, Victor Schmidt, and Thomas Dandres. Quantifying the carbon emissions of machine learning. CoRR, abs/1910.09700, 2019.   
Brian Lester, Rami Al-Rfou, and Noah Constant. The power of scale for parameter-efficient prompt tuning. In Proceedings of the 2021 Conference on Empirical Methods in Natural Language Processing, pp. 3045–3059, 2021.   
Hector Levesque, Ernest Davis, and Leora Morgenstern. The winograd schema challenge. In Thirteenth international conference on the principles of knowledge representation and reasoning, 2012.   
Xiang Lisa Li and Percy Liang. Prefix-tuning: Optimizing continuous prompts for generation. In Proceedings of the 59th Annual Meeting of the Association for Computational Linguistics and the 11th International Joint Conference on Natural Language Processing (Volume 1: Long Papers), pp. 4582–4597, 2021.   
Xiangyang Li, Yu Xia, Xiang Long, Zheng Li, and Sujian Li. Exploring text-transformers in aaai 2021 shared task: Covid-19 fake news detection in english. In CONSTRAINT@AAAI, 2021.   
Paul Pu Liang, Chiyu Wu, Louis-Philippe Morency, and Ruslan Salakhutdinov. Towards understanding and mitigating social biases in language models. In Proceedings of the 38th International Conference on Machine Learning, ICML 2021, 18-24 July 2021, Virtual Event, volume 139 of Proceedings of Machine Learning Research, pp. 6565–6576. PMLR, 2021.   
Opher Lieber, Or Sharir, Barak Lenz, and Yoav Shoham. Jurassic-1: Technical details and evaluation. White Paper. AI21 Labs, 2021.   
Chin-Yew Lin. ROUGE: A package for automatic evaluation of summaries. In Text Summarization Branches Out, pp. 74–81, Barcelona, Spain, July 2004. Association for Computational Linguistics. URL https://aclanthology.org/W04-1013.

Stephanie Lin, Jacob Hilton, and Owain Evans. TruthfulQA: Measuring how models mimic human falsehoods. In Proceedings of the 60th Annual Meeting of the Association for Computational Linguistics (Volume 1: Long Papers), pp. 3214–3252, Dublin, Ireland, May 2022. Association for Computational Linguistics.   
Pengfei Liu, Weizhe Yuan, Jinlan Fu, Zhengbao Jiang, Hiroaki Hayashi, and Graham Neubig. Pretrain, prompt, and predict: A systematic survey of prompting methods in natural language processing. arXiv preprint arXiv:2107.13586, 2021a.   
Peter J Liu, Mohammad Saleh, Etienne Pot, Ben Goodrich, Ryan Sepassi, Lukasz Kaiser, and Noam Shazeer. Generating wikipedia by summarizing long sequences. In International Conference on Learning Representations, 2018.   
Xiao Liu, Yanan Zheng, Zhengxiao Du, Ming Ding, Yujie Qian, Zhilin Yang, and Jie Tang. Gpt understands, too. arXiv preprint arXiv:2103.10385, 2021b.   
Xiao Liu, Kaixuan Ji, Yicheng Fu, Weng Tam, Zhengxiao Du, Zhilin Yang, and Jie Tang. P-tuning: Prompt tuning can be comparable to fine-tuning across scales and tasks. In Proceedings of the 60th Annual Meeting of the Association for Computational Linguistics (Volume 2: Short Papers), pp. 61–68, 2022.   
Ilya Loshchilov and Frank Hutter. Decoupled weight decay regularization. In 7th International Conference on Learning Representations, ICLR 2019, New Orleans, LA, USA, May 6-9, 2019, 2019.   
Paul Michel, Omer Levy, and Graham Neubig. Are sixteen heads really better than one? Advances in neural information processing systems, 32, 2019.   
Paulius Micikevicius, Sharan Narang, Jonah Alben, Gregory Diamos, Erich Elsen, David Garcia, Boris Ginsburg, Michael Houston, Oleksii Kuchaiev, Ganesh Venkatesh, and Hao Wu. Mixed precision training. In International Conference on Learning Representations, 2018.   
Todor Mihaylov, Peter Clark, Tushar Khot, and Ashish Sabharwal. Can a suit of armor conduct electricity? a new dataset for open book question answering. In Proceedings of the 2018 Conference on Empirical Methods in Natural Language Processing, pp. 2381–2391, 2018.   
Eric Mitchell, Charles Lin, Antoine Bosselut, Christopher D. Manning, and Chelsea Finn. Memorybased model editing at scale. In International Conference on Machine Learning, ICML 2022, 17-23 July 2022, Baltimore, Maryland, USA, volume 162 of Proceedings of Machine Learning Research, pp. 15817–15831. PMLR, 2022.   
Ioannis Mollas, Zoe Chrysopoulou, Stamatis Karlos, and Grigorios Tsoumakas. Ethos: an online hate speech detection dataset. arXiv preprint arXiv:2006.08328, 2020.   
Moin Nadeem, Anna Bethke, and Siva Reddy. Stereoset: Measuring stereotypical bias in pretrained language models. In Proceedings of the 59th Annual Meeting of the Association for Computational Linguistics and the 11th International Joint Conference on Natural Language Processing (Volume 1: Long Papers), pp. 5356–5371, 2021.   
Nikita Nangia, Clara Vania, Rasika Bhalerao, and Samuel Bowman. Crows-pairs: A challenge dataset for measuring social biases in masked language models. In Proceedings of the 2020 Conference on Empirical Methods in Natural Language Processing (EMNLP), pp. 1953–1967, 2020.   
Deepak Narayanan, Amar Phanishayee, Kaiyu Shi, Xie Chen, and Matei Zaharia. Memory-efficient pipeline-parallel dnn training. In International Conference on Machine Learning, pp. 7937–7947. PMLR, 2021.   
Tomoko Ohta, Yuka Tateisi, and Jin-Dong Kim. The genia corpus: An annotated research abstract corpus in molecular biology domain. In HLT, pp. 82–86, 2002.

Denis Paperno, Germán Kruszewski, Angeliki Lazaridou, Ngoc-Quan Pham, Raffaella Bernardi, Sandro Pezzelle, Marco Baroni, Gemma Boleda, and Raquel Fernández. The lambada dataset: Word prediction requiring a broad discourse context. In Proceedings of the 54th Annual Meeting of the Association for Computational Linguistics (Volume 1: Long Papers), pp. 1525–1534, 2016.   
David A. Patterson, Joseph Gonzalez, Quoc V. Le, Chen Liang, Lluis-Miquel Munguia, Daniel Rothchild, David R. So, Maud Texier, and Jeff Dean. Carbon emissions and large neural network training. CoRR, abs/2104.10350, 2021.   
Sameer Pradhan, Alessandro Moschitti, Nianwen Xue, Hwee Tou Ng, Anders Björkelund, Olga Uryupina, Yuchen Zhang, and Zhi Zhong. Towards robust linguistic analysis using ontonotes. In CoNLL, pp. 143–152, 2013.   
Ofir Press, Noah Smith, and Mike Lewis. Train short, test long: Attention with linear biases enables input length extrapolation. In International Conference on Learning Representations, 2021.   
Amy Pu, Hyung Won Chung, Ankur Parikh, Sebastian Gehrmann, and Thibault Sellam. Learning compact metrics for MT. In Proceedings of the 2021 Conference on Empirical Methods in Natural Language Processing, pp. 751–762, Online and Punta Cana, Dominican Republic, November 2021. Association for Computational Linguistics. doi: 10.18653/v1/2021.emnlp-main.58. URL https://aclanthology.org/2021.emnlp-main.58.   
Xipeng Qiu, Tianxiang Sun, Yige Xu, Yunfan Shao, Ning Dai, and Xuanjing Huang. Pre-trained models for natural language processing: A survey. Science China Technological Sciences, 63(10): 1872–1897, 2020.   
Alec Radford, Karthik Narasimhan, Tim Salimans, and Ilya Sutskever. Improving language understanding with unsupervised learning. 2018.   
Alec Radford, Jeffrey Wu, Rewon Child, David Luan, Dario Amodei, Ilya Sutskever, et al. Language models are unsupervised multitask learners. OpenAI blog, 1(8):9, 2019.   
Jack W Rae, Sebastian Borgeaud, Trevor Cai, Katie Millican, Jordan Hoffmann, Francis Song, John Aslanides, Sarah Henderson, Roman Ring, Susannah Young, et al. Scaling language models: Methods, analysis & insights from training gopher. arXiv preprint arXiv:2112.11446, 2021.   
Colin Raffel, Noam Shazeer, Adam Roberts, Katherine Lee, Sharan Narang, Michael Matena, Yanqi Zhou, Wei Li, Peter J Liu, et al. Exploring the limits of transfer learning with a unified text-to-text transformer. J. Mach. Learn. Res., 21(140):1–67, 2020.   
Aditya Ramesh, Mikhail Pavlov, Gabriel Goh, Scott Gray, Chelsea Voss, Alec Radford, Mark Chen, and Ilya Sutskever. Zero-shot text-to-image generation. In International Conference on Machine Learning, pp. 8821–8831. PMLR, 2021.   
Jeff Rasley, Samyam Rajbhandari, Olatunji Ruwase, and Yuxiong He. Deepspeed: System optimizations enable training deep learning models with over 100 billion parameters. In Proceedings of the 26th ACM SIGKDD International Conference on Knowledge Discovery & Data Mining, pp. 3505–3506, 2020.   
Sebastian Riedel, Limin Yao, and Andrew McCallum. Modeling relations and their mentions without labeled text. In ECML-PKDD, pp. 148–163, 2010.   
Adam Roberts, Colin Raffel, and Noam Shazeer. How much knowledge can you pack into the parameters of a language model? In Proceedings of the 2020 Conference on Empirical Methods in Natural Language Processing (EMNLP), pp. 5418–5426, 2020.   
Dan Roth and Wen-tau Yih. A linear programming formulation for global inference in natural language tasks. In HLT-NAACL, pp. 1–8, 2004.   
Rachel Rudinger, Jason Naradowsky, Brian Leonard, and Benjamin Van Durme. Gender bias in coreference resolution. In NAACL-HLT (2), 2018.

Chitwan Saharia, William Chan, Saurabh Saxena, Lala Li, Jay Whang, Emily Denton, Seyed Kamyar Seyed Ghasemipour, Raphael Gontijo-Lopes, Burcu Karagol Ayan, Tim Salimans, et al. Photorealistic text-to-image diffusion models with deep language understanding. In Advances in Neural Information Processing Systems.   
Keisuke Sakaguchi, Ronan Le Bras, Chandra Bhagavatula, and Yejin Choi. Winogrande: An adversarial winograd schema challenge at scale. Communications of the ACM, 64(9):99–106, 2021.   
Erik F. Tjong Kim Sang and Fien De Meulder. Introduction to the conll-2003 shared task: Languageindependent named entity recognition. In HLT-NAACL, pp. 142–147, 2003.   
Victor Sanh, Lysandre Debut, Julien Chaumond, and Thomas Wolf. Distilbert, a distilled version of bert: smaller, faster, cheaper and lighter. arXiv preprint arXiv:1910.01108, 2019.   
Victor Sanh, Albert Webson, Colin Raffel, Stephen Bach, Lintang Sutawika, Zaid Alyafeai, Antoine Chaffin, Arnaud Stiegler, Teven Le Scao, Arun Raja, et al. Multitask prompted training enables zero-shot task generalization. In The Tenth International Conference on Learning Representations, 2022.   
Teven Le Scao, Angela Fan, Christopher Akiki, Ellie Pavlick, Suzana Ilic, Daniel Hesslow, Roman ´ Castagné, Alexandra Sasha Luccioni, François Yvon, Matthias Gallé, et al. Bloom: A 176bparameter open-access multilingual language model. arXiv preprint arXiv:2211.05100, 2022.   
Timo Schick, Sahana Udupa, and Hinrich Schütze. Self-diagnosis and self-debiasing: A proposal for reducing corpus-based bias in nlp. Transactions of the Association for Computational Linguistics, 9:1408–1424, 2021.   
Thomas Scialom, Paul-Alexis Dray, Sylvain Lamprier, Benjamin Piwowarski, and Jacopo Staiano. MLSUM: The multilingual summarization corpus. In Proceedings of the 2020 Conference on Empirical Methods in Natural Language Processing (EMNLP), pp. 8051–8067, Online, November 2020. Association for Computational Linguistics. doi: 10.18653/v1/2020.emnlp-main.647. URL https://aclanthology.org/2020.emnlp-main.647.   
Sheng Shen, Zhen Dong, Jiayu Ye, Linjian Ma, Zhewei Yao, Amir Gholami, Michael W Mahoney, and Kurt Keutzer. Q-bert: Hessian based ultra low precision quantization of bert. In Proceedings of the AAAI Conference on Artificial Intelligence, volume 34, pp. 8815–8821, 2020.   
Emily Sheng, Kai-Wei Chang, P. Natarajan, and Nanyun Peng. Societal biases in language generation: Progress and challenges. In ACL, 2021.   
Sam Shleifer, Jason Weston, and Myle Ott. Normformer: Improved transformer pretraining with extra normalization. arXiv preprint arXiv:2110.09456, 2021.   
Mohammad Shoeybi, Mostofa Patwary, Raul Puri, Patrick LeGresley, Jared Casper, and Bryan Catanzaro. Megatron-lm: Training multi-billion parameter language models using model parallelism. arXiv preprint arXiv:1909.08053, 2019.   
Shaden Smith, Mostofa Patwary, Brandon Norick, Patrick LeGresley, Samyam Rajbhandari, Jared Casper, Zhun Liu, Shrimai Prabhumoye, George Zerveas, Vijay Korthikanti, et al. Using deepspeed and megatron to train megatron-turing nlg 530b, a large-scale generative language model. arXiv preprint arXiv:2201.11990, 2022.   
Aarohi Srivastava, Abhinav Rastogi, Abhishek Rao, Abu Awal Md Shoeb, Abubakar Abid, Adam Fisch, Adam R Brown, Adam Santoro, Aditya Gupta, Adrià Garriga-Alonso, et al. Beyond the imitation game: Quantifying and extrapolating the capabilities of language models. arXiv preprint arXiv:2206.04615, 2022.   
Emma Strubell, Ananya Ganesh, and Andrew McCallum. Energy and policy considerations for deep learning in NLP. In Proceedings of the 57th Conference of the Association for Computational Linguistics, ACL 2019, Florence, Italy, July 28- August 2, 2019, Volume 1: Long Papers, pp. 3645–3650. Association for Computational Linguistics, 2019.   
Jianlin Su, Yu Lu, Shengfeng Pan, Bo Wen, and Yunfeng Liu. Roformer: Enhanced transformer with rotary position embedding. arXiv preprint arXiv:2104.09864, 2021.

Alon Talmor, Jonathan Herzig, Nicholas Lourie, and Jonathan Berant. Commonsenseqa: A question answering challenge targeting commonsense knowledge. In Proceedings of the 2019 Conference of the North American Chapter of the Association for Computational Linguistics: Human Language Technologies, Volume 1 (Long and Short Papers), pp. 4149–4158, 2019.   
Chaofan Tao, Lu Hou, Wei Zhang, Lifeng Shang, Xin Jiang, Qun Liu, Ping Luo, and Ngai Wong. Compression of generative pre-trained language models via quantization. In Proceedings of the 60th Annual Meeting of the Association for Computational Linguistics (Volume 1: Long Papers), pp. 4821–4836, 2022.   
Romal Thoppilan, Daniel De Freitas, Jamie Hall, Noam Shazeer, Apoorv Kulshreshtha, Heng-Tze Cheng, Alicia Jin, Taylor Bos, Leslie Baker, Yu Du, et al. Lamda: Language models for dialog applications. arXiv preprint arXiv:2201.08239, 2022.   
Denis Timonin, Bo Yang Hsueh, and Vinh Nguyen. Accelerated inference for large transformer models using nvidia triton inference server. NVIDIA blog, 2022.   
Leslie G Valiant. A bridging model for parallel computation. Communications of the ACM, 33(8): 103–111, 1990.   
Ashish Vaswani, Noam Shazeer, Niki Parmar, Jakob Uszkoreit, Llion Jones, Aidan N Gomez, Łukasz Kaiser, and Illia Polosukhin. Attention is all you need. Advances in neural information processing systems, 30, 2017.   
David Wadden, Ulme Wennberg, Yi Luan, and Hannaneh Hajishirzi. Entity, relation, and event extraction with contextualized span representations. In Proceedings of the 2019 Conference on Empirical Methods in Natural Language Processing and the 9th International Joint Conference on Natural Language Processing (EMNLP-IJCNLP), pp. 5784–5789, 2019.   
C. Walker and Linguistic Data Consortium. ACE 2005 Multilingual Training Corpus. Linguistic Data Consortium, 2005. ISBN 9781585633760.   
Alex Wang, Yada Pruksachatkun, Nikita Nangia, Amanpreet Singh, Julian Michael, Felix Hill, Omer Levy, and Samuel R. Bowman. SuperGLUE: A Stickier Benchmark for General-Purpose Language Understanding Systems. In NeurIPS 2019, pp. 3261–3275, 2019.   
Ben Wang and Aran Komatsuzaki. GPT-J-6B: A 6 Billion Parameter Autoregressive Language Model. https://github.com/kingoflolz/mesh-transformer-jax, May 2021.   
Chenguang Wang, Xiao Liu, Zui Chen, Haoyun Hong, Jie Tang, and Dawn Song. Deepstruct: Pretraining of language models for structure prediction. In Findings of the Association for Computational Linguistics: ACL 2022, pp. 803–823, 2022a.   
Hongyu Wang, Shuming Ma, Li Dong, Shaohan Huang, Dongdong Zhang, and Furu Wei. Deepnet: Scaling transformers to 1,000 layers. arXiv preprint arXiv:2203.00555, 2022b.   
Shuohuan Wang, Yu Sun, Yang Xiang, Zhihua Wu, Siyu Ding, Weibao Gong, Shikun Feng, Junyuan Shang, Yanbin Zhao, Chao Pang, et al. Ernie 3.0 titan: Exploring larger-scale knowledge enhanced pre-training for language understanding and generation. arXiv preprint arXiv:2112.12731, 2021.   
Wenhui Wang, Furu Wei, Li Dong, Hangbo Bao, Nan Yang, and Ming Zhou. Minilm: Deep selfattention distillation for task-agnostic compression of pre-trained transformers. Advances in Neural Information Processing Systems, 33:5776–5788, 2020.   
Xuezhi Wang, Jason Wei, Dale Schuurmans, Quoc Le, Ed Chi, and Denny Zhou. Rationaleaugmented ensembles in language models. arXiv preprint arXiv:2207.00747, 2022c.   
Jason Wei, Maarten Bosma, Vincent Zhao, Kelvin Guu, Adams Wei Yu, Brian Lester, Nan Du, Andrew M Dai, and Quoc V Le. Finetuned language models are zero-shot learners. In International Conference on Learning Representations, 2022a.

Jason Wei, Yi Tay, Rishi Bommasani, Colin Raffel, Barret Zoph, Sebastian Borgeaud, Dani Yogatama, Maarten Bosma, Denny Zhou, Donald Metzler, et al. Emergent abilities of large language models. arXiv preprint arXiv:2206.07682, 2022b.   
Jason Wei, Xuezhi Wang, Dale Schuurmans, Maarten Bosma, Ed Chi, Quoc Le, and Denny Zhou. Chain of thought prompting elicits reasoning in large language models. arXiv preprint arXiv:2201.11903, 2022c.   
Laura Weidinger, John Mellor, Maribeth Rauh, Conor Griffin, Jonathan Uesato, Po-Sen Huang, Myra Cheng, Mia Glaese, Borja Balle, Atoosa Kasirzadeh, et al. Ethical and social risks of harm from language models. arXiv preprint arXiv:2112.04359, 2021.   
Shaohua Wu, Xudong Zhao, Tong Yu, Rongguo Zhang, Chong Shen, Hongli Liu, Feng Li, Hong Zhu, Jiangang Luo, Liang Xu, et al. Yuan 1.0: Large-scale pre-trained language model in zeroshot and few-shot learning. arXiv preprint arXiv:2110.04725, 2021.   
Yongqin Xian, Christoph H Lampert, Bernt Schiele, and Zeynep Akata. Zero-shot learning—a comprehensive evaluation of the good, the bad and the ugly. IEEE transactions on pattern analysis and machine intelligence, 41(9):2251–2265, 2018.   
Ruibin Xiong, Yunchang Yang, Di He, Kai Zheng, Shuxin Zheng, Chen Xing, Huishuai Zhang, Yanyan Lan, Liwei Wang, and Tieyan Liu. On layer normalization in the transformer architecture. In International Conference on Machine Learning, pp. 10524–10533. PMLR, 2020.   
Liang Xu, Hai Hu, Xuanwei Zhang, Lu Li, Chenjie Cao, Yudong Li, Yechen Xu, Kai Sun, Dian Yu, Cong Yu, et al. Clue: A chinese language understanding evaluation benchmark. In Proceedings of the 28th International Conference on Computational Linguistics, pp. 4762–4772, 2020.   
Liang Xu, Xiaojing Lu, Chenyang Yuan, Xuanwei Zhang, Huilin Xu, Hu Yuan, Guoao Wei, Xiang Pan, Xin Tian, Libo Qin, et al. Fewclue: A chinese few-shot learning evaluation benchmark. arXiv preprint arXiv:2107.07498, 2021.   
Sha Yuan, Hanyu Zhao, Zhengxiao Du, Ming Ding, Xiao Liu, Yukuo Cen, Xu Zou, Zhilin Yang, and Jie Tang. Wudaocorpora: A super large-scale chinese corpora for pre-training language models. AI Open, 2:65–68, 2021.   
Ofir Zafrir, Guy Boudoukh, Peter Izsak, and Moshe Wasserblat. Q8bert: Quantized 8bit bert. In 2019 Fifth Workshop on Energy Efficient Machine Learning and Cognitive Computing-NeurIPS Edition (EMC2-NIPS), pp. 36–39. IEEE, 2019.   
Wei Zeng, Xiaozhe Ren, Teng Su, Hui Wang, Yi Liao, Zhiwei Wang, Xin Jiang, ZhenZhang Yang, Kaisheng Wang, Xiaoda Zhang, et al. Pangu-\α: Large-scale autoregressive pretrained chinese language models with auto-parallel computation. arXiv preprint arXiv:2104.12369, 2021.   
Chiyuan Zhang, Daphne Ippolito, Katherine Lee, Matthew Jagielski, Florian Tramèr, and Nicholas Carlini. Counterfactual memorization in neural language models. CoRR, abs/2112.12938, 2021.   
Susan Zhang, Stephen Roller, Naman Goyal, Mikel Artetxe, Moya Chen, Shuohui Chen, Christopher Dewan, Mona Diab, Xian Li, Xi Victoria Lin, et al. Opt: Open pre-trained transformer language models. arXiv preprint arXiv:2205.01068, 2022.   
Yuhao Zhang, Victor Zhong, Danqi Chen, Gabor Angeli, and Christopher D. Manning. Positionaware attention and supervised data improve slot filling. In EMNLP, pp. 35–45, 2017.   
Ben Zhou, Daniel Khashabi, Qiang Ning, and Dan Roth. “going on a vacation” takes longer than “going for a walk”: A study of temporal commonsense understanding. In Proceedings of the 2019 Conference on Empirical Methods in Natural Language Processing and the 9th International Joint Conference on Natural Language Processing (EMNLP-IJCNLP), pp. 3363–3369, 2019.   
Chen Zhu, Ankit Singh Rawat, Manzil Zaheer, Srinadh Bhojanapalli, Daliang Li, Felix X. Yu, and Sanjiv Kumar. Modifying memories in transformer models. CoRR, abs/2012.00363, 2020.

# Part I

# Appendix

# Table of Contents

# A Ethics: Evaluation on Biases and Toxicity 21

A.1 Bias Measurement: CrowS-Pairs . . . 21   
A.2 Bias Measurement: StereoSet . . . 21   
A.3 Hate Speech Detection: ETHOS . 22   
A.4 Toxic Genearation: RealToxicPrompts 22

# B Technical Details 23

B.1 Tokenization 23   
B.2 Layer Normalization . 24   
B.3 Positional Encoding and Feed-forward Network 24   
B.4 Pipeline Parallel Analysis . . . 25   
B.5 Inference Acceleration 27   
B.6 Activation Outlier Analysis . . . 27   
B.7 Weight Quantization . . . 28   
B.8 Quantization settings 28   
B.9 Ablation on Contribution Attribution 29   
B.10 Lessons Learned 30

# C Dataset and Evaluation Details 32

C.1 Multi-task Instruction Pre-training (MIP) 32   
C.2 Data and prompts in MIP for DeepStruct 32   
C.3 Result Sources for GPT-3, BLOOM-176B, and OPT-175B 39   
C.4 Pile Test-set Evaluation . . . 39   
C.5 BIG-bench-lite Evaluation . 40   
C.6 MMLU Evaluation 40   
C.7 Chinese Language Understanding Evaluation 40   
C.8 Natural Language Generation 41   
C.9 Winograd-Style Tasks 43   
C.10 Closed-book Question Answering . 43   
C.11 Commonsense Reasoning 44   
C.12 Fixed Label Datasets: A Case Study in Natural Language Inference 44   
C.13 SuperGLUE 44   
C.14 Chain-of-Thought Prompting . . . 45

# D Scaling and Emergent Abilities in GLM-130B 46

# E Contributions 52

E.1 Preparation 52   
E.2 Model Training 52   
E.3 Post Training 52   
E.4 Project Management 52   
E.5 Computation Sponsor 52

# F A Brief History of GLM-130B 53

# G Broader Impact 55

G.1 Impact on AI Research 55   
G.2 Impact on Individual Developers and Small Companies . . . . 55

G.3 Social Impact 55

H Environmental Impact 56

# A ETHICS: EVALUATION ON BIASES AND TOXICITY

Albeit LLMs’ strong abilities in language and beyond, which could bring substantial welfare to human beings, they can potentially produce toxic and illegal contents for evil use (Weidinger et al., 2021; Sheng et al., 2021; Dev et al., 2021; Bommasani et al., 2021). In GLM-130B, before granting model weight to applicants, in the model license we demand them to agree that they will not use it for any deeds that may be harmful to society and human beings.

Additionally, from a technical perspective, we argue that we must also understand LLMs’ toxic and biased behaviors and ultimately eliminate them. This aligns with our commitment to “LLM Inclusivity”, as it is necessary to include more people in the open-sourced LLM research to facilitate the process. Moreover, if an LLM is shown to be good at identifying toxic and biased content, techniques such as self-diagnoses (Schick et al., 2021) can help to reduce the harmful generation in a self-consistent post-processing procedure. Therefore, as an initial step, we evaluate GLM-130B over a variety of related benchmarks to shed light on the challenging topic. Despite their limitations (Blodgett et al., 2021; Jacobs & Wallach, 2021) which should be addressed in future work, they still serve as a good start to arouse the community’s awareness of the problem.

# A.1 BIAS MEASUREMENT: CROWS-PAIRS

CrowS-Pairs (Nangia et al., 2020), or namely Crowdsourced Stereotype Pairs benchmark, is widely used for measuring biases for masked language models. It collects 1508 examples with nine different conventional biases and adopts a probing-based approach to compare the pseudolog-likelihood of a pair of stereotypical and antistereotypical sentences. Since GLM-130B is pre-trained with autoregressive blanking infilling, CrowS-Pairs evaluation is directly applicable. We compare the GPT-3 Davinci and OPT-175B’s results on CrowS-Pairs reported in (Zhang et al., 2022) with GLM-130B.

Table 5: CrowS-Pairs (Nangia et al., 2020) Bias Measurement. The lower scores the better. 

<table><tr><td>Category</td><td>GPT-3</td><td>OPT-175B</td><td>GLM-130B</td></tr><tr><td>Gender</td><td>62.6</td><td>65.7</td><td>55.7</td></tr><tr><td>Religion</td><td>73.3</td><td>68.6</td><td>73.3</td></tr><tr><td>Race/Color</td><td>64.7</td><td>68.6</td><td>58.5</td></tr><tr><td>Sexual orientation</td><td>76.2</td><td>78.6</td><td>60.7</td></tr><tr><td>Age</td><td>64.4</td><td>67.8</td><td>63.2</td></tr><tr><td>Nationality</td><td>61.6</td><td>62.9</td><td>64.1</td></tr><tr><td>Disability</td><td>76.7</td><td>76.7</td><td>71.6</td></tr><tr><td>Physical appearance</td><td>74.6</td><td>76.2</td><td>74.6</td></tr><tr><td>Socioeconomic status</td><td>73.8</td><td>76.2</td><td>70.9</td></tr><tr><td>Overall</td><td>67.2</td><td>69.5</td><td>65.8</td></tr></table>

Our results are presented in Table 5. GLM-130B shows fewer biases on almost all kinds of stereotypes except for religion and nationality. We speculate that it is because GLM-130B is a bilingual pre-trained LLM that learns the semantics for certain content from both English and Chinese corpora. Since CrowsS-Pairs’ stereotypes mainly draw from the US Equal Employment Opportunities Commission’s list2, the bias distributions in two different cultures and languages may be different and consequently reconcile social biases in GLM-130B on a benchmark originally designed for English-language society. We think this is an interesting finding, as multi-lingual pre-training may help LLMs to present less harmful biases for better fairness. Finally, we also admit that GLM-130B may in turn presents some special Chinese biases which currently lack testing benchmarks and require considerable future efforts to detect and prevent.

# A.2 BIAS MEASUREMENT: STEREOSET

Another widely used bias and stereotype evaluation benchmark is StereoSet (Nadeem et al., 2021), which is also adopted in (Lieber et al., 2021; Artetxe et al., 2021; Zhang et al., 2022). To balance the evaluation between bias detecting and language modeling quality, StereoSet reports a series of metrics including Language Modeling Scores (LMS), Stereotype Score (SS), and Idealized Context Association Test Score (ICAT) as an overall averaged metric. For example, given the premise “She is the twin’s mother”, StereoSet provides three candidate hypothesis: 1) “the water is deep”, 2) “she is a lazy, unkind person”, and 3) “she is a kind, caring woman”. The first option servers as a distractor to test models’ language capability and calculate LMS; the second and third statements are anti-stereotypical and stereotypical respectively and used for calculating SS. A widely-adopted technique here is to calibrate the likelihood of an option according to its length (Lieber et al., 2021; Zhang et al., 2022), as the distractor term is particularly short.

Following (Zhang et al., 2022), we normalize scores over tokens rather than characters (Lieber et al., 2021) to yield model predictions for calculating the metrics. The results are shown in Table 6. As we observe, GLM-130B exceedingly outperforms GPT-3 Davinci and OPT-175B on all metrics. Such results accurately align with our discoveries in language modeling experiments and CrowS-Pairs bias evaluation, that GLM-130B has a high quality in both language modeling and social fairness.

Table 6: StereoSet (Nadeem et al., 2021) Bias Measurement with LMS (↑), SS (↓), and ICAT (↑). 

<table><tr><td rowspan="2">Category</td><td colspan="3">Profession</td><td colspan="3">Gender</td><td colspan="3">Religion</td><td colspan="3">Race</td><td colspan="3">Overall</td></tr><tr><td>LMS</td><td>SS</td><td>ICAT</td><td>LMS</td><td>SS</td><td>ICAT</td><td>LMS</td><td>SS</td><td>ICAT</td><td>LMS</td><td>SS</td><td>ICAT</td><td>LMS</td><td>SS</td><td>ICAT</td></tr><tr><td>GPT-3</td><td>78.4</td><td>63.4</td><td>57.5</td><td>75.6</td><td>66.5</td><td>50.6</td><td>80.8</td><td>59.0</td><td>66.3</td><td>77.0</td><td>57.4</td><td>65.7</td><td>77.6</td><td>60.8</td><td>60.8</td></tr><tr><td>OPT-175B</td><td>74.1</td><td>62.6</td><td>55.4</td><td>74.0</td><td>63.6</td><td>53.8</td><td>84.0</td><td>59.0</td><td>68.9</td><td>74.9</td><td>56.8</td><td>64.8</td><td>74.8</td><td>59.9</td><td>60.0</td></tr><tr><td>GLM-130B</td><td>86.5</td><td>59.6</td><td>69.9</td><td>83.9</td><td>63.5</td><td>61.2</td><td>91.0</td><td>53.5</td><td>84.6</td><td>85.7</td><td>54.1</td><td>78.7</td><td>86.0</td><td>57.3</td><td>73.5</td></tr></table>

# A.3 HATE SPEECH DETECTION: ETHOS

Social media corpus may contain hate speeches, and to investigate to what extent LLMs know and can help to identify them is crucial. We adopt the ETHOS dataset originally proposed in (Mollas et al., 2020) to detect sexism and racism speech on zero-shot or few-shot datasets created by (Chiu & Alexander, 2021). GPT-3 Davinci (a public-accessible variant of GPT-3 175B) and OPT 175B are also tested on the benchmark (whose results are reported in (Zhang et al., 2022)). For binary classification including Zero-shot, One-shot, and Few-shot (binary) (which answers “yes” or “no”), we report binary F1; for multiclass classification (which answers “yes”, “no”, or “neither”), we report micro F1. We adopt almost the same prompts as in (Chiu & Alexander, 2021), except aligning the Few-shot (binary) prompt to the form used in One-shot and adding the word “Classification” before the colon in the original Few-shot (multiclass) prompt.

Results are shown in Table 7. We find that GLM-130B outperforms two other LLMs among four different settings. On one hand, GLM-130B’s pre-training over unsupervised diverse corpora from online forums and social media including sections such as “hackernews”, “stackexchange”, and “pile\_cc” can endow our model with the background knowledge to identify those speeches. On the other hand, the MIP training may also improve GLM-130B’s zero-shot and few-shot capabilities.

Table 7: ETHOS (Mollas et al., 2020) Hate speech detection. “(bi)” and “(mul)” denote binary and multiclass classification respectively. All scores are F1 and the higher the better. 

<table><tr><td></td><td>GPT-3</td><td>OPT-175B</td><td>GLM-130B</td></tr><tr><td>Zero-shot</td><td>62.8</td><td>66.7</td><td>68.8</td></tr><tr><td>One-shot</td><td>61.6</td><td>71.3</td><td>79.1</td></tr><tr><td>Few-shot (bi)</td><td>35.4</td><td>75.9</td><td>79.7</td></tr><tr><td>Few-shot (mul)</td><td>67.2</td><td>81.2</td><td>85.8</td></tr></table>

# A.4 TOXIC GENEARATION: REALTOXICPROMPTS

Evaluating the toxicity of generation by given prompts is an important part of a model’s safe deployment. We evaluate the toxic generation of GLM-130B on the RealToxicPrompts (Gehman et al., 2020) dataset. Following its settings, we use nucleus sampling (p = 0.9) to generate 25 continuations for each of the 10K random sampled prompts, limiting the maximum generated length to 128 tokens. Then we report the mean toxicity probabilities of 25 continuations evaluated by Perspective API3. In order to make a fair comparison under different tokenization methods, we only report

![](images/55231294ed80791d44233688ea8a82dc19f702dec9a0fc51584a96062dce486f.jpg)

<details>
<summary>line</summary>

| Prompt Toxicity Probability (binned) | GLM-130B | GPT-3 Davinci |
| ------------------------------------ | -------- | ------------- |
| 0.0                                  | 0.05     | 0.08          |
| 0.1                                  | 0.07     | 0.10          |
| 0.2                                  | 0.10     | 0.13          |
| 0.3                                  | 0.11     | 0.15          |
| 0.4                                  | 0.13     | 0.17          |
| 0.5                                  | 0.15     | 0.18          |
| 0.6                                  | 0.16     | 0.19          |
| 0.7                                  | 0.14     | 0.20          |
| 0.8                                  | 0.18     | 0.21          |
| 0.9                                  | 0.20     | 0.21          |
| 1.0                                  | 0.25     | 0.26          |
</details>

Figure 9: RealToxicPrompts (Gehman et al., 2020) evaluation. Lower continuation toxicity probability is better.

![](images/7106a76b6471d54fb4860d1b83b15f24111d333e304a046bfa60762036bd528b.jpg)

<details>
<summary>line</summary>

| Iterations | Learning Rate |
| ---------- | ------------- |
| 0k         | 1.2e-4        |
| 20k        | 1.0e-4        |
| 40k        | 0.6e-4        |
| 60k        | 0.4e-4        |
| 80k        | 0.2e-4        |
| 100k       | 0.1e-4        |
| 120k       | 0.05e-4       |
| 140k       | 0.02e-4       |
</details>

(a) OPT 175B’s experiments

![](images/ecca7337740737f039b7cbae14d020a850b089e416868ffbbdc7a3d7cd2b9b57.jpg)

<details>
<summary>line</summary>

| x    | y     |
| ---- | ----- |
| 0    | 7.5   |
| 4G   | 3.5   |
| 8G   | 2.5   |
| 16G  | 2.5   |
| 20G  | 7.5   |
| 24G  | 4.5   |
</details>

(b) BLOOM 176B’s experiments

![](images/1ec09019c24aa290501c66cd58e8d3c173bc46158af22dd11e95ec62f117409c.jpg)

<details>
<summary>line</summary>

| Step  | Line 1 | Line 2 | Line 3 | Line 4 | Line 5 |
|-------|--------|--------|--------|--------|--------|
| 0     | 10.0   | 10.0   | 10.0   | 10.0   | 10.0   |
| 500   | 7.0    | 6.5    | 6.0    | 5.5    | 5.0    |
| 1.5k  | 5.0    | 4.5    | 4.0    | 3.5    | 3.0    |
| 2k    | 4.0    | 3.5    | 3.0    | 2.5    | 2.0    |
| 2.5k  | 3.5    | 3.0    | 2.5    | 2.0    | 1.5    |
| 3k    | 3.0    | 2.5    | 2.0    | 1.5    | 1.0    |
| 3.5k  | 2.5    | 2.0    | 1.5    | 1.0    | 0.5    |
| 4k    | 2.0    | 1.5    | 1.0    | 0.5    | 0.0    |
</details>

(c) GLM 130B’s experiments

![](images/8feb4dcc5c9897e03b425dafb6a5a606be33d40c39b0dc2bf6f52caed5fa769d.jpg)

<details>
<summary>line</summary>

| Step  | Im-loss-training/Im loss |
| ----- | ------------------------ |
| 0     | 4.0                      |
| 5k    | 2.4                      |
| 10k   | 2.0                      |
| 15k   | 1.9                      |
| 20k   | 1.85                     |
| 25k   | 1.8                      |
| 30k   | 1.75                     |
| 35k   | 1.7                      |
| 40k   | 1.7                      |
| 45k   | 1.7                      |
| 50k   | 1.7                      |
</details>

(d) GLM 130B’s real training   
Figure 10: Handling training collapses and instability is the first priority when training LLMs.

the toxicity score of the first complete sentence of a

continuation as we found that the score returned by the Perspective API seems to increase with sentence length.

Results are shown in Figure 9. Generally, as the toxicity of the given prompt increases, the toxicity probability of the continuation increases accordingly in both models. Compared to GPT-3 Davinci, GLM-130B has a lower toxicity rate in all cases, indicating that GLM-130B is less prone to generating toxic content.

# B TECHNICAL DETAILS

In this section, we introduce additional details about the technical issues we have identified and solved throughout the GLM-130B training. Along with concurrent open-source LLM efforts, we believe that those published details could serve as great cornerstones to future LLM training.

# B.1 TOKENIZATION

For the tokenization of the corpus, we implement a text tokenizer based on the package icetk with several adjustments. As an image-text unified tokenizer, the vocabulary size of icetk is 150000. The first 20000 tokens are image tokens and the rest are text tokens. The text tokenizer of icetk is formulated and trained by sentencepiece4, on a 25GB bilingual corpus equally distributed with English and Chinese contents. We divide tokens recognized by the tokenizer into four categories. The common tokens are assigned from No.20000 to No.20099, consisting of punctuations, numbers and spaces free of extended definition. No.20100 to No.83822 are English tokens and No.83823 to

No.145653 are Chinese tokens. Tokens after No.145653 are other special tokens including concatenated punctuations and pieces from other languages, etc.

During our implementation, We ignore the first 20000 image tokens and simply utilize the latter 130000 intended for text tokenization. we disable the ignoring of linebreak to tokenize the linebreak mark \n into No. 20004 token <n>. On the basis of inherent tokens, we add special tokens [MASK] and [gMASK] for model prediction. We also add special tokens <sop>, <eop>, <eos> for sentence and passage separation.

# B.2 LAYER NORMALIZATION

Here we briefly introduce the history of layer normalization in language modeling problems, and how its variants perform in recent LLMs including our experiments for them on GLM-130B.

Post-LN (Vaswani et al., 2017). Post-LN is jointly proposed with the transformer architecture and is placed between the residual blocks. It is then adopted by BERT (Devlin et al., 2019) for bidirectional language model pre-training. Nevertheless, Post-LN was later accused of transformers’ slow and vulnerable converging (Xiong et al., 2020) and the Pre-LN emerged as a substitute.

Pre-LN (Xiong et al., 2020). On the contrary, Pre-LN is located in the residual blocks to reduce exploding gradients and becomes dominant in existing language models, including all recent LLMs. However, OPT-175B (Zhang et al., 2022), BLOOM (Scao et al., 2022), and text-to-image model CogView Ding et al. (2021) later observe that Pre-LN is still unable to handle the vulnerable training when models scale up to 100B or meet multi-modal data. This is also justified in GLM-130B’s preliminary experiments, where Pre-LN consistently crashes in its early stage training.

Additionally, another problem rooted in Pre-LN transformers is that it may harm the model performance after tuning compared to Post-LN. This is observed in (He et al., 2021).

Sandwich-LN (Ding et al., 2021). As a remedy, on top of Pre-LN, CogView (later in Normformer (Shleifer et al., 2021)) develops Sandwich-LN which appends extra normalization to the end of each residual branch. Accompanied with PB-Relax (Precision-Bottleneck Relaxation) techniques, they stabilize the training of a 4-billion text-to-image generation model. Despite its superiority over Pre-LN, sadly Sandwich-LN is also proved to collapse in GLM-130B training; let alone the potential consequent weaker tuning performance caused by its Pre-LN nature.

# B.3 POSITIONAL ENCODING AND FEED-FORWARD NETWORK

Positional Encoding Vanilla transformer adopts absolute (or sinuous) position encoding, and is later evolved into relative positional encoding (Dai et al., 2019). Relative PEs can capture word relevance better than absolute positional encoding. Rotary Positional Embedding (RoPE) (Su et al., 2021) is a relative position encoding implemented in the form of absolute position encoding, and its core idea is shown in the following equation.

$$
\left(\boldsymbol {R} _ {m} q\right) ^ {\top} \left(\boldsymbol {R} _ {n} k\right) = q ^ {\top} \boldsymbol {R} _ {m} ^ {\top} \boldsymbol {R} _ {n} k = q ^ {\top} \boldsymbol {R} _ {n - m} k \tag {1}
$$

The product of q at position m and k at position n is related to their distance n − m, which reflects the relativity of the position encoding. The definition of R in the above equation is

$$
\boldsymbol {R} _ {\theta , m} ^ {d} = \left( \begin{array}{c c c c c c c} \cos m \theta_ {1} & - \sin m \theta_ {1} & 0 & 0 & \dots & 0 & 0 \\ \sin m \theta_ {1} & \cos m \theta_ {1} & 0 & 0 & \dots & 0 & 0 \\ 0 & 0 & \cos m \theta_ {2} & - \sin m \theta_ {2} & \dots & 0 & 0 \\ 0 & 0 & \sin m \theta_ {2} & \cos m \theta_ {2} & \dots & 0 & 0 \\ \vdots & \vdots & \vdots & \vdots & \ddots & \vdots & \vdots \\ 0 & 0 & 0 & 0 & \dots & \cos m \theta_ {d / 2} & - \sin m \theta_ {d / 2} \\ 0 & 0 & 0 & 0 & \dots & \sin m \theta_ {d / 2} & \cos m \theta_ {d / 2} \end{array} \right) \tag {2}
$$

To allow its value to decay as the distance increases, θ takes the value

$$
\theta = \left\{\theta_ {i} = 1 0 0 0 0 ^ {\frac {- 2 (i - 1)}{d}}, \quad i \in \left[ 1, 2, \dots , \frac {d}{2} \right] \right\} \tag {3}
$$

A two-dimensional absolute position encoding method is proposed in vanilla GLM for modeling both intra- and inter-span position information. In GLM-130B, different from the two-dimensional positional encoding used in vanilla GLM, we turn back to conventional one-dimensional positional encoding. However, we originally thought that two-dimensional form cannot be directly applied to RoPE5. As a substitute plan, in GLM-130B we simply remove the second dimension used in the original GLM as we find that the unidirectional attention mask sub-matrices for [MASK] generation indicate the token order as well. This observation results in our transforming GLM-130B’s positional encoding into a one-dimensional one according to the following strategies:

• For sequences corrupted by short spans, we discard the second-dimensional position encoding.   
• For sequences corrupted by a long span at the end, we change the positional ids to one-dimensional $0 , 1 , \cdots , s - 1$ , and generated tokens will just prolong the first-dimensional positional encoding from the last context token s − 1.

Feed-forward Network Some recent efforts to improve transformer architecture have been on the FFN, including replacing it with GLU (adopted in PaLM). Research shows that using GLU can improve model performance, which is consistent with our experimental results (Cf. Table 8). Specifically, we use GLU with the GeLU (Hendrycks & Gimpel, 2016) activation. as

$$
\mathrm{FFN} _ {\mathrm{GeGLU}} \left(\boldsymbol {x}; \boldsymbol {W} _ {1}, \boldsymbol {V}, \boldsymbol {W} _ {2}\right) = \left(\mathrm{GeLU} \left(\boldsymbol {x} \boldsymbol {W} _ {1}\right) \otimes \boldsymbol {x} \boldsymbol {V}\right) \boldsymbol {W} _ {2} \tag {4}
$$

In order to keep the same parameter as the vanilla FFN, the feed-forward size $d _ { \mathrm { { f f n } } }$ (which is usually 4dH, where $d _ { \mathrm { H } }$ is the hidden dimension) is reduced to $\textstyle { \frac { 8 } { 3 } } d _ { \mathrm { H } }$ as the V is additionally introduced.

Ablation Study on PE and FFN In order to validate our PE and FFN choices, we test them in our experiments by pre-training GL $\mathbf { M } _ { \mathrm { B a s e } }$ (110M) over a random 50G Chinese and English mixed corpus. We compare absolute PE with two recent popular relative PE variants, RoPE (Chowdhery et al., 2022) and ALiBi (Press et al., 2021). For FFN, we compare vanilla FFN with Gate Linear Unit with GeLU activations. Results from Table 8 show that both ALiBi and RoPE improve perplexity on the test set, and the improvement is more significant with RoPE while using GeGLU can further improve the model’s performance.

Table 8: Ablation Study for PE and FFN on $\mathbf { G L M _ { B a s e } }$ 

<table><tr><td>Model</td><td>Test PPL</td></tr><tr><td>GLMBase</td><td>24.58</td></tr><tr><td>+ ALiBi</td><td>24.14</td></tr><tr><td>+ RoPE</td><td>22.95</td></tr><tr><td>+ RoPE + GeGLU</td><td>22.31</td></tr></table>

# B.4 PIPELINE PARALLEL ANALYSIS

In pipeline parallelism, each stage consists of three operations (Cf. Figure 11(a)): forward (denoted as F), backward (denoted as B), and optimizer step (denoted as U). However, naive sequential pipeline implementation leads to an unbearable amount of bubbles. The improved Gpipe (Huang et al., 2019) (Cf. Figure 11(b)) strategy reduces bubbles drastically via splitting data into microbatches; the more micro-batches there are, the more stages can compute simultaneously in an iteration. The recent PipeDream-Flush (Narayanan et al., 2021) (Cf. Figure 11(c)) additionally optimizes the GPU memory usage by interweaving forward and backward from different stages to reduce forward activation’s memory occupation.

We analyze the bubble share in GLM-130B’s pre-training by assuming that the number of pipeline segments is $p ,$ the number of micro-batches is m, and the time for forward and backward per microbatch are $t _ { f }$ and $t _ { b } .$ . In ideal case, forward and backward take $t _ { \mathrm { i d e a l } } = m ( t _ { f } + t _ { b } )$ ). But in practice, the default pipeline delivery strategy causes $p - 1$ forward propagation and $p - 1$ backward propagation bubbles, respectively, for a total time of ${ \bar { t } } _ { \mathrm { b u b b l e } } = ( p - 1 ) { \bar { ( } } t _ { f } ^ { - } + t _ { b } )$ , so that the bubble occupancy is

$$
\text { bubble   -   ratio } = \frac {t _ {\text { bubble }}}{t _ {\text { ideal }} + t _ {\text { bubble }}} = \frac {p - 1}{m + p - 1} \tag {5}
$$

For larger numbers of micro-batches, the bubble percentage will be reduced to an acceptable level. In particular, experiments in GPipe Huang et al. (2019) show that when $m \geq 4 p ,$ , the total percentage of pipeline bubble time is reduced to a negligible level due to the forward recomputation technique in backpropagation that allows some overlap in computational communication, thus showing that the bubbles introduced in parallel by the pipeline model do not seriously deplete the training efficiency.

![](images/9fa7404a7797475a9af2e986cc91ee6b8be239e2daf2c0fd6472c76e134d24d8.jpg)

<details>
<summary>bar_stacked</summary>

| GPU   | Forward | Backward | Optimizer Step |
|-------|---------|----------|----------------|
| GPU 0 | F₀      |          |                |
| GPU 1 | F₀      |          |                |
| GPU 2 | F₀      | B₀       |                |
| GPU 3 | F₀      | B₀       |                |
</details>

(a) Naive pipeline implementation, which can be extremely inefficient.

![](images/f679e7be4488a083e647d0b5341858da3b366415a8ccb597c9e961549d900720.jpg)

<details>
<summary>bar_stacked</summary>

| GPU    | Forward | Backward | Optimizer Step |
|--------|---------|----------|----------------|
| GPU 0  | F0      | F1       | U0             |
| GPU 1  | F0      | F1       | U0             |
| GPU 2  | F0      | F1       | U0             |
| GPU 3  | F0      | F1       | U0             |
</details>

(b) GPipe (Huang et al., 2019) implementation.

![](images/fbdf742b3b3c6f48efb02ce9f5eba313825be470f4437c40b47b10b926e3aa7a.jpg)

<details>
<summary>heatmap</summary>

| GPU Model | Time | Forward | Backward | Optimizer Step |
|-----------|------|---------|----------|----------------|
| GPU 3     | F0   | B0      | B0       | U0             |
| GPU 3     | F1   | B0      | B0       | U0             |
| GPU 3     | F2   | B0      | B0       | U0             |
| GPU 3     | F3   | B0      | B0       | U0             |
| GPU 2     | F0   | B0      | B0       | U0             |
| GPU 2     | F1   | B0      | B0       | U0             |
| GPU 2     | F2   | B0      | B0       | U0             |
| GPU 2     | F3   | B0      | B0       | U0             |
| GPU 1     | F0   | B0      | B0       | U0             |
| GPU 1     | F1   | B0      | B0       | U0             |
| GPU 1     | F2   | B0      | B0       | U0             |
| GPU 1     | F3   | B0      | B0       | U0             |
| GPU 0     | F0   | B0      | B0       | U0             |
| GPU 0     | F1   | B0      | B0       | U0             |
| GPU 0     | F2   | B0      | B0       | U0             |
| GPU 0     | F3   | B0      | B0       | U0             |
</details>

(c) Pipedream (Narayanan et al., 2021) implementation (used in GLM-130B).   
Figure 11: Different pipeline strategies and their conceptual comparison.

In general, in order to make full use of the hardware, it is common to place models into model parallel groups consisting of multiple nodes and try to use the full memory of each node. In this case, we can freely adjust the ratio of pipeline model parallelism and tensor model parallelism. Since data parallelism hardly affects the computation time, we assume that the scale of data parallelism is $d = 1$ , the total number of nodes is n, the scale of tensor model parallelism is t, and the scale of pipeline model parallelism is p, and satisfies $n = t \times p ,$ , the bubble share in this case is

$$
\text { bubble - ratio } = \frac {n / t - 1}{m + n / t - 1} \tag {6}
$$

From the above equation, we can see that increasing the size of tensor parallelism will further reduce the bubble ratio. However, the tensor parallelism scale cannot be increased indefinitely, which would lead to a reduction in computational granularity and greatly increase the communication cost across a certain threshold. Therefore, we can conclude that the size of tensor model parallelism should increase slowly as the model size increases, but not more than the number of graphics cards in a single machine. In the training of GLM-130B, the experiments show that the optimal tensor parallelism scale is t = 4 and does not scale up to the scale of t = 8 in the DGX-A100 system. The other parameters are $m = 1 7 6 , p = 8$ , and the bubble share is calculated to be only 3.8%, which is sufficient to demonstrate the efficiency of pipeline model parallelism.

Table 9: Decoding speed in our real trials between BLOOM-176B (Scao et al., 2022) (from Huggingface Transformers) and GLM-130B’s implementation in 16-bit precision with 8 × A100 (80G). 

<table><tr><td>Decode Tokens</td><td>128</td><td>512</td><td>1024</td><td>2048</td></tr><tr><td>BLOOM-176B</td><td>36.76s</td><td>137.91s</td><td>287.93s</td><td>631.81s</td></tr><tr><td>GLM-130B</td><td>4.40s (×8.4)</td><td>18.77s (×7.3)</td><td>39.81s (×7.2)</td><td>89.88s (×7.0)</td></tr></table>

![](images/88fd79d8da8b09702a14ac69bc0080c8a8c376ea2c6d087c08ce814769bbd3ac.jpg)

<details>
<summary>heatmap</summary>

| token position of the sentence | 0    | 100  | 200  | 300  | 400  | 500  |
| ------------------------------ | ---- | ---- | ---- | ---- | ---- | ---- |
| 0                              | 0    | 0    | 0    | 0    | 0    | 0    |
| 500                            | 0    | 0    | 0    | 0    | 0    | 0    |
| 1000                           | 0    | 0    | 0    | 0    | 0    | 0    |
| 1500                           | 0    | 0    | 0    | 0    | 0    | 0    |
| 2000                           | 0    | 0    | 0    | 0    | 0    | 0    |
| 2500                           | 0    | 0    | 0    | 0    | 0    | 0    |
| 3000                           | 0    | 0    | 0    | 0    | 0    | 0    |
| 3500                           | 0    | 0    | 0    | 0    | 0    | 0    |
| 4000                           | 0    | 0    | 0    | 0    | 0    | 0    |
</details>

![](images/7f8542be0869567c9798b349f162eca0c44072aff30426fef789b3aceb2acd2d.jpg)

<details>
<summary>heatmap</summary>

| token position of the sentence | sorted hidden state dimensions | counts in bin |
| ------------------------------ | ------------------------------ | ------------- |
| 0                              | 0                              | 0             |
| 100                            | 1000                           | 8             |
| 200                            | 1500                           | 10            |
| 300                            | 2000                           | 12            |
| 400                            | 2500                           | 14            |
| 500                            | 3000                           | 12            |
</details>

Figure 12: Distribution of outliers in GLM-130B’s activations. The vertical axis denotes the hidden state dimensions (4,096 rather than 12,288 as this is a parallel segment), and the horizontal denotes tokens in a input sentence. Using a 128×128 2D histogram to get a better view of the distribution of outliers. The figure on the right swaps some of the vertical coordinates so that it can be clearly seen that the outlier occur about 30% of its dimensions.

# B.5 INFERENCE ACCELERATION

A model’s plain PyTorch implementation is easy to read and run, but it can be intolerably slow for LLMs. Based on NVIDIA’s FasterTransformer6 we spend two months implementing GLM-130B into C++ to speed up inference, including the following main optimizations:

• Optimize time-costing operations such as GeGLU, Layer Normalization, and SoftMax.   
• Reduce the number of GPU kernel calls (e.g., fuse MultiheadAttention into one computation kernel).   
• Specify the algorithm of the best performance when calling cuBLAS.   
• Improve the computing efficiency by transposing the model parameters in advance.   
• Use half2 in FP16 computation to double the half’s access bandwidth and computing throughput.

We currently pack up the full FasterTransformer implementation for GLM-130B into a plug-andplay docker image for users’ convenience, and we are still working on adapting it to our Pytorch implementation by only changing one line of code. A comparison between our speeding up GLM-130B implementation and the so far default available BLOOM-176B implementation in Huggingface Transformers7 is shown in Table 9. Our implementation for GLM-130B can be 7.0 to 8.4 times faster than BLOOM-176B’s Pytorch implementation. The exertion to accelerate LLM for tolerable response speed could be extremely crucial to its popularization.

# B.6 ACTIVATION OUTLIER ANALYSIS

As is described in prior sections, GLM-130B’s weight can be quantized into INT4 to drastically cut down parameter redundancy in the inference. However, we also find that GLM-130B’s activations (i.e., hidden states between layers) cannot be properly quantized, as they contain value outliers as is also suggested in concurrent literature (Dettmers et al., 2022).

What is special in GLM-130B is that 30% of its dimensions may present value outliers (Cf. Figure 12), while other GPT-based LLMs (e.g., OPT-175B and BLOOM 176B) only has very few outlying dimensions (Dettmers et al., 2022). Therefore, the solution to decompose matrix multiplication for higher-precision computation in outlying dimensions proposed in (Dettmers et al., 2022) is not applicable to GLM-130B.

We study whether these outliers can be ignored in LLM quantization, and the answer is interestingly “no”. These values can be several orders of magnitude larger than ordinary activation values (Cf. Figure 13). While most values (accounts for 99.98% dimensions in a hidden state) stay less them 6, those two outlying dimensions can reach 50 or even over 100. They are speculated to be some important clues for GLM-130B and potentially other LLMs to memorize some fixed world or language knowledge, and thus removing or omitting them in quantization can lead to significant performance degradation.

![](images/ff3898a2bc59116fa9a63c0f77565064f8d442a0af8a6b7cbe30b243eb668af0.jpg)

<details>
<summary>bar</summary>

| Bin Range | Frequency |
|---|---|
| 0 - 5 | 10000 |
| 5 - 10 | 1000 |
| 10 - 15 | 10 |
| 15 - 20 | 1 |
| 20 - 25 | 0 |
| 25 - 30 | 0 |
| 30 - 35 | 0 |
| 35 - 40 | 0 |
| 40 - 45 | 0 |
| 45 - 50 | 0 |
| 50 - 55 | 0 |
| 55 - 60 | 1 |
| 60 - 65 | 0 |
| 65 - 70 | 0 |
| 70 - 75 | 0 |
| 75 - 80 | 0 |
| 80 - 85 | 0 |
| 85 - 90 | 0 |
| 90 - 95 | 0 |
| 95 - 100 | 1 |
</details>

Figure 13: GLM-130B’s activation outliers’ absolute value scale.

# B.7 WEIGHT QUANTIZATION

# B.7.1 PRELIMINARIES

Absmax Quantization is a symmetric quantization that a range of [−absmax(x), absmax(x)] is mapped to $[ - ( 2 ^ { b } - 1 ) , 2 ^ { b } - 1 ]$ for x.

$$
s _ {x} = \frac {\operatorname{absmax} (x)}{2 ^ {b - 1} - 1} \tag {7}
$$

$$
x _ {q} = \operatorname{round} \left(x / s _ {x}\right) \tag {8}
$$

where $s _ { x }$ is the scaling factor, $x _ { q }$ is the quantization result and b is the bit width.

Zeropoint Quantization is an asymmetric quantization that a range of [min(x), max(x)] is mapped to $[ - ( 2 ^ { b } - 1 ) , 2 ^ { b } - 1 ]$ .

$$
s _ {x} = \frac {\max (x) - \min (x)}{2 ^ {b} - 2} \tag {9}
$$

$$
z _ {x} = \operatorname{round} \left(\min (x) / s _ {x}\right) + 2 ^ {b - 1} - 1 \tag {10}
$$

$$
x _ {q} = \operatorname{round} (x / s _ {x}) - z _ {x} \tag {11}
$$

where $z _ { x }$ is the zero point.

Col/Row-wise Quantization Using a single scaling factor for the weight matrix often leads to more quantization errors because one single outlier leads to a decrease in the quantization precision of all other elements. A common workaround is to group the weight matrix by rows or by columns, with each group being quantized separately and having independent scaling factors.

# B.8 QUANTIZATION SETTINGS

Our goal is to save GPU memory as much as possible without hurting model performance. In practice, we only quantize linear layers, which take up most of the transformer parameters, and leave input/output embedding, layer normalization, and bias terms unchanged. At the quantization precision of INT4, two INT4 weights are compressed into one INT8 weight for saving GPU memory usage. Absmax quantization is adopted since we found it enough to maintain model performance, and it is more computationally efficient than zeropoint quantization. During inference, only quantized weights are stored in GPU memory, the FP16 weights for linear layers will be dequantized at runtime.

# B.8.1 QUANTIZATION RESULTS AT SCALES

GLM models at 110M to 10B scale are from GLM’s original paper(Du et al., 2022). Although the architecture of smaller scale GLMs are not the same as GLM-130B, we believe that the training objective is the key factor for quantization. Table 10 shows the performance of GLM and BLOOM family models at different scales on the LAMBADA dataset with different quantization methods. Almost all models maintain performance at INT8 precision. In general, GLM maintains better performance than BLOOM at INT4 precision as it scales.

Table 10: Accuracy on LAMBADA dataset for GLM and BLOOM family at 100M to 176B scales across different quantization precision. 

<table><tr><td></td><td>BLOOM-560M</td><td>BLOOM-1B1</td><td>BLOOM-3B</td><td>BLOOM-7B</td><td>BLOOM-176B</td></tr><tr><td>Original</td><td>31.40%</td><td>40.68%</td><td>48.30%</td><td>54.91%</td><td>64.37%</td></tr><tr><td>Absmax INT8, col-wise</td><td>26.12%</td><td>40.69%</td><td>48.83%</td><td>55.33%</td><td>65.03%</td></tr><tr><td>Absmax INT4, col-wise</td><td>9.30%</td><td>17.43%</td><td>37.88%</td><td>38.04%</td><td>34.83%</td></tr><tr><td>Absmax INT4, row-wise</td><td>21.37%</td><td>35.80%</td><td>40.95%</td><td>46.75%</td><td>NaN</td></tr><tr><td>Zeropoint INT4, col-wise</td><td>11.51%</td><td>26.51%</td><td>41.65%</td><td>46.63%</td><td>48.26%</td></tr><tr><td>Zeropoint INT4, row-wise</td><td>24.95%</td><td>33.05%</td><td>43.63%</td><td>49.41%</td><td>NaN</td></tr><tr><td></td><td>GLM-110M</td><td>GLM-335M</td><td>GLM-2B</td><td>GLM-10B</td><td>GLM-130B</td></tr><tr><td>Original</td><td>29.36%</td><td>48.51%</td><td>68.19%</td><td>72.35%</td><td>80.21%</td></tr><tr><td>Absmax INT8, row-wise</td><td>29.25%</td><td>48.69%</td><td>68.12%</td><td>72.37%</td><td>80.21%</td></tr><tr><td>Absmax INT4, row-wise</td><td>3.26%</td><td>38.25%</td><td>62.62%</td><td>71.03%</td><td>79.47%</td></tr><tr><td>Zeropoint INT4, row-wise</td><td>5.45%</td><td>42.64%</td><td>64.74%</td><td>70.50%</td><td>80.63%</td></tr></table>

![](images/42c7c4689e3261839d109cb84cb4dca96a0b1dbedd29d7f98f2e13d5104d9f07.jpg)

<details>
<summary>bar</summary>

| Model | GLM (uni) | GLM (bi) | GLM + MIP (bi) |
| :--- | :--- | :--- | :--- |
| LAMBADA | 67.3 | 72.7 | 74.8 |
| MMLU | 26.3 | 33.7 | 34.5 |
| WiC | 51.7 | 56.1 | 52.5 |
| ReCoRD | 65.4 | 66.4 | 50.7 |
| Hellaswag | 27.3 | 27.7 | 27.3 |
| WSC | 63.5 | 63.5 | 67.3 |
| BoolQ | 64.1 | 71.2 | 78.3 |
| ANLI R1 | 35.0 | 35.6 | 40.0 |
</details>

Figure 14: Contribution attribution analysis on GLM objective and MIP training. We take GLM-10B (English only) as an example in the ablation. Generally, GLM objective’s bidirectional attention accounts for 70% of the improvements, while MIP’s major contribution lies in text similarity tasks.

# B.8.2 WEIGHT DISTRIBUTION ANALYSIS

To achieve INT4 weight quantization, we analyze the weight value distribution of major linear layers in GLM-130B and a counterpart BLOOM-176B in a histogram (Cf. Figure 15). The horizontal axis denotes the weight value, and the vertical axis denotes the number of weights of such value in log scale. As we can see, it is majorly the w2 linear layers in BLOOM-176B that present skewed distributions, which would hinder the symmetrical quantization. On the contrary, GLM-130B’s w2 is well-shaped without many outliers and skewed distribution, and thus paces the way for its INT4 quantization with little performance loss.

# B.9 ABLATION ON CONTRIBUTION ATTRIBUTION

We analyze the contribution attribution of techniques leveraged in GLM-130B. A series of ablation studies have been presented in the paper, and for the convenience of reading, they were originally scattered around the whole passage. Here we summarize them here into the following list for readers’ reference:

• Ablation on ordinary PostLN and DeepNorm: Figure 3.   
• Ablation on Bidirectional/Unidirectional Attention: Figure 2 (LAMBADA), Table 16 (Conditional NLG), Figure 17 (SuperGLUE).   
• Ablation on Embedding Layer Gradient Shrink (EGS): Figure 4.   
• Ablation on Positional Encodings and FFN: Appendix B.3 Table 8.

Additionally, we conduct the following study to justify the contribution of the two most influential techniques–GLM Objective and Multi-task Instruction Pre-training (MIP)–used in GLM-130B.

GLM Objective and MIP. Ablating a 100B-scale LLM from scratch can be too expensive. As a substitute, we try our best to conduct the comparison between GLM objective and MIP on GLM-10B (an English-only version released in (Du et al., 2022), without MIP). We additionally train a GLM-10B initialized from a middle-stage original checkpoint with MIP (5%) to match the same training tokens of the original self-supervision-only GLM-130B. The MIP, this time, follows the exact dataset setting in T0 (Sanh et al., 2022) and the information extraction datasets in GLM-130B to allow the correct evaluation on some types of tasks (e.g., NLI).

Figure 14 shows the ablation results. On the 8 datasets we test, we find that the GLM objective is a major contributor to the improvement (from GLM (uni) to GLM + MIP (bi)). For example, it accounts for 73% improvement in LAMBADA and 90% improvement in MMLU, which are very widely adopted challenging benchmarks for LLMs. As for MIP, on some datasets (e.g., WiC, ReCoRD, Hellaswag), MIP may even harm the performance. While for datasets related to text similarity and coreference (e.g., WSC, BoolQ, ANLI R1), MIP is the main contributor. It is likely because the text similarity and coreference challenges, which people usually construct intentionally to test language models’ ability, are seldom seen in the self-supervised corpus that makes up people’s daily written texts. Thus, MIP training mainly helps to bridge the gap between self-supervised pre-training and these tasks.

# B.10 LESSONS LEARNED

Lesson 1 (Bidirectional Architecture). The bidirectional-attention GLM is a strong architecture alternative, in addition to GPTs.

Lesson 2 (Platform-aware Configuration). Configure LLMs based on the cluster and parallel strategy used to squeeze hardware potential.

Lesson 3 (Improved Post-LN). Counter-stereotypically, DeepNorm, a type of Post-LN, is the option to stabilize GLM-130B.

Lesson 4 (Training Stability Categorization). Unexpected training instability that LLMs suffer from arouses systematically and numerically.

Lesson 5 (Systematical Instability: FP16). Though FP16 induces more instability, it enables training and inference on diverse platforms.

Lesson 6 (Numerical Instability: Embedding Gradient Shrink). Shrinking embedding layer’s gradient to its 0.1 can solve most numerical instability problems.

Lesson 7 (GLM’s INT4 Quantization Scaling Law). GLM has a unique INT4 weight quantization scaling law unobserved in GPT-style BLOOM.

Lesson 8 (Future Direction). To create powerful LLMs, the main focus can be on 1) more and better data, 2) better architectures and pre-training objectives, and 3) more sufficient training.

![](images/f3214d4e7e1cfc9bb303e13fcd33472c3e2a059f2fbe501cf00b3a86262ce3d1.jpg)

<details>
<summary>histogram</summary>

| Layer | attn-dense | attn-qkv | w1 | w2 | attn-dense | attn-qkv | w1 | w2 |
|-------|------------|----------|----|----|------------|----------|----|----|
| Layer 0 | 10^7 | 10^7 | 10^4 | 10^6 | 10^7 | 10^7 | 10^8 | 10^8 |
| Layer 2 | 10^7 | 10^7 | 10^4 | 10^6 | 10^7 | 10^7 | 10^8 | 10^8 |
| Layer 4 | 10^7 | 10^7 | 10^4 | 10^6 | 10^7 | 10^7 | 10^8 | 10^8 |
| Layer 6 | 10^7 | 10^7 | 10^4 | 10^6 | 10^7 | 10^7 | 10^8 | 10^8 |
| Layer 8 | 10^7 | 10^7 | 10^4 | 10^6 | 10^7 | 10^7 | 10^8 | 10^8 |
| Layer 10 | 10^7 | 10^7 | 10^4 | 10^6 | 10^7 | 10^7 | 10^8 | 10^8 |
| Layer 12 | 10^7 | 10^7 | 10^4 | 10^6 | 10^7 | 10^7 | 10^8 | 10^8 |
| Layer 14 | 10^7 | 10^7 | 10^4 | 10^6 | 10^7 | 10^7 | 10^8 | 10^8 |
| Layer 15 | 10^7 | 10^7 | 10^4 | 10^6 | 10^7 | 10^7 | 10^8 | 10^8 |
| Layer 16 | 10^7 | 10^7 | 10^4 | 10^6 | 10^7 | 10^7 | 10^8 | 10^8 |
| Layer 18 | 10^7 | 10^7 | 10^4 | 10^6 | 10^7 | 10^7 | 10^8 | 10^8 |
| Layer 20 | 10^7 | 10^7 | 10^4 | 10^6 | 10^7 | 10^7 | 10^8 | 10^8 |
| Layer 22 | 10^7 | 10^7 | 10^4 | 10^6 | 10^7 | 10^7 | 10^8 | 10^8 |
| Layer 24 | 10^7 | 10^7 | 10^4 | 10^6 | 10^7 | 10^7 | 10^8 | 10^8 |
| Layer 26 | 10^7 | 10^7 | 10^4 | 10^6 | 10^7 | 10^7 | 10^8 | 10^8 |
</details>

Figure 15: Weight value distribution of linear layers in GLM-130B (in orange, attn-dense, attn-qkv, glu-w1, glu-w2) and BLOOM-176B (in blue, attn-dense, attn-qkv, ffn-w1, ffn-w2)’s first 28 transformer layers. Generally for GLM-130B it is attn-dense and w2 that may present narrow value distributions. attn-qkv and w1 may also be a reason for enabling INT4 quantization in middle layers of GLM-130B.

# C DATASET AND EVALUATION DETAILS

# C.1 MULTI-TASK INSTRUCTION PRE-TRAINING (MIP)

Following practices in (Raffel et al., 2020; Wei et al., 2022a; Sanh et al., 2022; Aribandi et al., 2022), we include a number of prompted instruction datasets in GLM-130B’s MIP training, which accounts for 5% of the training tokens. All prompts for T0 datasets are from PromptSource (Bach et al., 2022) and prompts for DeepStruct datasets are newly created. Their composition is shown in Table 12, which makes up natural language understanding and generation datasets from T0 (Sanh et al., 2022) and promptsource (Bach et al., 2022), and information extraction datasets from DeepStruct (Wang et al., 2022a). In GLM-130B’s training, we calculate that approximately 36% of the samples in each dataset has been seen.

T0 originally splits datasets for 1) multi-task prompted training and 2) zero-shot task transfer two sections. We initially planed to only include training sets of T0’s multi-task prompted training section and DeepStruct (Wang et al., 2022a), but by a mistake we included both multi-task prompted training and zero-shot task transfer sections’ datasets in MIP and excluded DeepStruct datasets. The mistake was fixed at around 23k steps and our model continued to train on the correct version.

Natural Language Understanding and Generation. We adopt datasets and corresponding prompts from promptsource (Bach et al., 2022). For all prompted samples in each dataset, we set a truncation of maximal 10,0000 samples per dataset and combine them together as the MIP dataset. Details of the prompted samples and datasets are provided in promptsource’s GitHub repository8.

Information Extraction. Based on the datasets from DeepStruct (Wang et al., 2022a), a multitask language model pre-training approach for information extraction tasks, we create instructions and prompts for part of its datasets (as is shown in Table 12). We reformulate information extraction tasks into instruction tuning formats to allow zero-shot generalization to new extraction schema. For all prompted samples in each dataset, we set a truncation of maximal 20,0000 samples per dataset as there are fewer information extraction datasets than common language understanding and generation ones. For KELM (Agarwal et al., 2021) and PropBank (Kingsbury & Palmer) datasets, since their original size is gigantic, we sample 50,0000 samples for each of them from their prompted samples.

# C.2 DATA AND PROMPTS IN MIP FOR DEEPSTRUCT

Prompts and instructions for all datasets in DeepStruct (Wang et al., 2022a) are newly created by authors manually. The introduction, task description, and full prompts for each dataset are attached in the following sections. To allow template infilling, all prompts are written into Jinja9 templates. When a dataset sample is provided in our format, Joinja engine will render it into a prompted sample with instruction.

A more systematic evaluation on GLM-130B’s information extraction ability is left for a future work, as the concentration in this work is on the training and designing details of an LLM.

# C.2.1 DIALOGUE STATE TRACKING

We adopt Multiwoz 2.1 (Eric et al., 2020) dialogue state tracking dataset. The dataset is reformulated into two tasks, each with one prompt correspondingly:

• Dialogue state tracking: which asks the model to extract information from dialogues given a list of certain slots, e.g., taxi\_arrival\_time and destination.   
• Slot filling: which model should fill in one provided slot and identify situations without answer.

(Dialogue State Tracking, Prompt 0)   
```txt
Read the dialogues between "[User]" and "[Agent]",
{{text}}
identify and extract the information related to the following categories
(from top to down):
- {{allowed_relations | join("\n- ")}
in the form of "([User] ; Y ; Z)": ||{{format_triple(relations, allowed_relations) | join(" ")}} 
```

(Slot Filling, Prompt 0)   
```jinja
Given the following dialogue:
{{text}}
please answer the question: has "[User]" mentioned "{{allowed_relations[ relation_idx].split(': ') | join"'s "}}"? If yes, please write down the answer from the dialogue; if not, please answer "not given".
Answer: || {| % if filter_relation(relations, allowed_relations[ relation_idx]).__len__() > 0 %}{{filter_relation(relations, allowed_relations[ relation_idx])[0]['tail']}{{% else %}not given{% endif %}} 
```

# C.2.2 EVENT EXTRACTION

We adopt ACE05 (Walker & Consortium, 2005) event extraction datasets following the setting in (Wadden et al., 2019). The dataset is reformulated into two tasks with three prompts as follows:

• Event Argument Extraction: given a trigger in text and a list of its argument roles, the model is asked to extract the arguments from the provided text.   
• Argument Identification: given a trigger and a certain argument role, the model is asked to extract the argument if it exists in the provided text; otherwise, the model should generate nothing.

(Event Argument Extraction, Prompt 0)   
```txt
For the task of "Event Extraction", given a trigger one should extract its related arguments conditioned on a list of potential roles.

Given the following list of roles:
- {{shuffle(allowed_arguments[trigger['event_type']].values()) | join("\n- ")}}

extract related arguments of the trigger "{{trigger['text']}}{{ allowed_triggers[trigger['event_type']}}} " in the following sentence: {{text}}

Extractions: ||{{format_triple(relations, "") | join(" ")}} 
```

(Event Argument Extraction, Prompt 1)   
```txt
TEST
1. (Event Extraction) {{text}}
Please write down ALL event arguments related to the trigger "{{trigger['text']}}{{({allowed_triggers[trigger['event_type']]})" marked with "[]", given the following categories:
- {{shuffle(allowed_arguments[trigger['event_type']].values()) | join("\n- ")}}
Answer: ||{{format_triple(relations, "") | join(" ")}} 
```

(Argument Identification, Prompt 0)   
```txt
Let extract event related arguments!

In the following passage, an argument with the type "{{query_arg}}" is related to the event trigger "{{trigger['text']}} ({{{allowed_triggers[ trigger['event_type']]}})":
{{text}}
The argument should be (copy from the context if you find it; if not, do not generate): ||{{filter_type(relations, query_arg) | join(" ")}} 
```

# C.2.3 JOINT ENTITY AND RELATION EXTRACTION

Joint entity and relation extraction aims to recognize named entities in a piece of text and judge the relationships between them. It is closely related to knowledge acquisition, where the ultimate target is to structuring the unstructured web contents into knowledge triples (e.g., (London, capital\_of, Britain)). The task can be formulated into either a pipeline framework (a combination of named entity recognition and relation extraction), or end-to-end training.

In this work, we adopt three classical joint entity and relation extraction datasets: CoNLL04 (Roth & Yih, 2004), NYT (Riedel et al., 2010), and ACE2005 (Walker & Consortium, 2005). In GLM-130B, we follow (Wang et al., 2022a) to formulate such challenges into sequence-to-sequence generation, where our inputs are raw texts and outputs are triples. We only conduct relation-related tasks for these datasets here, and leave the entity-related ones to the named entity recognition section.

• Relation Extraction: here we extract knowledge triples consisting of “head entity”, “relation”, and “tail entity”, given a list of relation candidates. For example, given the input “In Kunming the 800-some faculty and student established the National Southwestern Associated University.”, the model output could be (National Southwestern Associated University, location of formation, Kunming).   
• Conditional Relation Extraction: given a single relation candidate, judge if the input text contains the relation. If so, extraction all related triples; if not, do not generate.   
• Knowledge Slot Filling: assign a certain entity from text, and ask the model to extract all triples that takes the entity as the head.   
• Relation Classification: given two entities from texts, ask the model to judge the relation between them based on a list of candidate relations.

(Relation Extraction, Prompt 0)   
```txt
Can you figure out all triples regarding the relations of "{{shuffle(allowed_relations) | join ('", '')}" from the sentence? List them in the shape of "(X;Y;Z)":
{{text}} => ||{{format_triple(relations, allowed_relations) | join("")}} 
```

(Conditional Relation Extraction, Prompt 0)   
```txt
Conditioned on the relation "{{allowed_relations[relation_idx]}}", what knowledge triples can be extracted from:
{{text}}
Please write them down here: ||{{format_triple(relations, [allowed_relations[relation_idx]]) | join(" ")}} 
```

(Knowledge Slot Filling, Prompt 0)   
```jinja
{% if entity_types.__len__() > 0 %}
In the sentence
{{text}}
the X = "{{entities[entity_idx]}}" is an entity of the type "{{entity_types[entity_idx]}". Extract all possible triples contains "{{entities[entity_idx]}}" in the form of (X ; Y ; Z ), given the following candidate properties Y:
{% for r in allowed_relations %}- {{r}}
{% endfor %}
Answer: || {| % for r in relations %}{% if r['head'][0] == entities[entity_idx] %}{format_triple([r], allowed_relations) | join(" ")}}{% endif %}{% endfor %}
{% endif %} 
```

(Relation Classification, Prompt 0)   
```handlebars
QUIZ
1. Given the candidate relations:
- {{shuffle(allowed_relations) | join("\n- ")}}
what is the relation between "{{relations[triple_idx]['head'][0]}}" and "{{relations[triple_idx]['tail'][0]}}" in the following sentence?
{{text}}
Answer: ||{{relations[triple_idx]['relation']}} 
```

Nevertheless, existing joint entity and relation extraction datasets have very limited relation schema. For example, CoNLL04 only contains five different relations; the most diverse NYT dataset contains 24 Freebase predicates. To allow the model to capture a diverse range of potential verbalized predicates, we extend the task with automatically generated knowledge-text aligned data from KELM (Agarwal et al., 2021). We do not include other distantly supervised dataset (e.g., T-Rex (Elsahar et al., 2018)) since they can be extremely noisy.

For KELM data, since it is based on the full Wikidata schema (which contains too many relations to be enumerated), we create two KELM-specific prompts for the task of Relation Extraction and Knowledge Slot Filling:

(Relation Extraction, Prompt 1, KELM ONLY)   
```jinja
{# kelm #}
Can you figure out all knowledge triples regarding whole Wikidata properties from the sentence? List them in the shape of " ( X ; Y ; Z )":
{{text}} => || { {format_triple(relations, "") | join(" ")}} 
```

(Knowledge Slot Filling, Prompt 1, KELM ONLY)   
```jinja
{# kelm #}
Given the entity "{{entities[entity_idx]}}" marked with "[" and "]" in the context:
{{text}}
please list all triples related to it (do not generate if there is no answer): || {| % for r in relations %}{% if r['head'][0] == entities[entity_idx] %}{{format_triple([r], "") | join(" ")}}{% endif %}{% endfor %} 
```

# C.2.4 NAMED ENTITY RECOGNITION

Named entity recognition is a task which targets identifying named entities from raw text corpus and assign them with proper entity types. For example, in the sentence “In 1916 GM was reincorporated in Detroit as "General Motors Corporation".”, General Motors Corporation could be of entity type organization. We design two different types of tasks based on named entity recognition datasets CoNLL03 (Sang & Meulder, 2003), OntoNotes 5.0 (Pradhan et al., 2013), and GENIA (Ohta et al., 2002). We also include named entity recognition sub-tasks from joint entity and relation datasets.

• Named Entity Recognition: given a certain list of possible entity types (e.g., location, person, organization), extract all related entities from the provided text content.   
• Entity Typing: entity typing is one of the important derivative tasks from named entity recognition. It aims to classify the correct type of an entity mention (without entity types), and is often appended to the entity mention extraction as post-processing.

(Named Entity Recognition, Prompt 0)   
```jinja
Given the following list of entity types:
Z = {{shuffle(allowed_types) | join(", ")}}
please extract all mentioned entities from left to right in the sentence, in the form of "(X; instance of; Z)".{{text}} => || {|% for entity, type in zip(entities, entity_types) %}({entity}}; instance of; {{type}}) { % endfor %} 
```

(Entity Typing, Prompt 0)   
```jinja
Extract all entity mentioned in the sentence with entity type "{{ allowed_types[type_idx]}}" in the form of " ( X ; instance of ; {{ allowed_types[type_idx]}} )"

{{text}} => || {| % for entity, type in zip(entities, entity_types) %}{% if type == allowed_types[type_idx] %}({{entity}} ; instance of ; {{type}}) { % endif %}{% endfor %} 
```

(Entity Typing, Prompt 1)   
```txt
List all "{{allowed_types[type_idx]}}" entities appeared in the following passage, joined by " | ":  
{{text}} => ||{{filter_type(zip(entities, entity_types), allowed_types[type_idx]) | join(" | ")}} 
```

(Entity Typing, Prompt 2)   
```jinja
{% if entity_types.__len__() > 0 %}
Based on the list of potential entity types and ignore their order:
- {{shuffle(allowed_types) | join("\n- ")}}
the entity "{{entities[entity_idx]}}" marked with "[" and "]" in the following sentence:
{{text}}
belongs to ||{{entity_types[entity_idx]}}{{% endif %}} 
```

# C.2.5 RELATION CLASSIFICATION

Relation classification is a fundamental task in information extraction, which identifies the relationships from a list of candidates between two given entities. The problem is a long standing one as it suffers from outrageous cost of data labeling, since manual labeling on knowledge-intensive tasks requires educated annotators that charges high. A de facto data creation method in relation extraction relies on distant supervision, which aligns existing knowledge triples in knowledge bases to text contents automatically, and assume that such alignments are correct in certain conditions. Here we only include TacRED (Zhang et al., 2017) dataset and create several different tasks based on it.

• Relation Classification: the most traditional task formulation. Given two entities from text and classify their relation from a list of candidates. The form can be either answering the relation directly or in the form of a triple (similar to relation extraction).   
• Knowledge Slot Filling: change the task into given head entity and relation, to identify whether the tail entity exists in the input text. If not, generate nothing.   
• Yes or No Question: turn the problem into a task similar to natural language inference. For example, given the sentence “The series focuses on the life of Carnie Wilson, daughter of Brian Wilson, founder of the Beach Boys.”, the model will be asked to judge the correctness of a triple such as Carnie Wilson, father, Brian Wilson by answering “yes” or “no”.

(Relation Classification, Prompt 0)   
```jinja
{% if entity_types.__len__() > 0 %}
Given the following categories of relations:
- {{shuffle(allowed_relations.values()) | join("\n- ")})
predict the relation between "{{relations[0]['head']}}" and "{{relations[0]['tail']}}" in the following sentence:
{{text}}
The relation should be : ||{{allowed_relations[relations[0]['relation']]}}
{% endif %} 
```

(Relation Classification, Prompt 1)   
```txt
1. (Relation Extraction) Answer the relation between entities in the form of "(X;Y;Z)":
{{text}}
The relation between "{{relations[0]['head']}}" and "{{relations[0]['tail']}}" is: ||| ( {{relations[0]['head']}}; {{allowed_relations[relations[0]['relation']]}}; {{relations[0]['tail']}}} ) 
```

(Knowledge Slot Filling, Prompt 0)   
```handlebars
Based on the sentence provided below, infer the missing argument asked by the question:
{{text}}
Question: What/Who/Where is "{{relations[0]['head']}}" {{ allowed_relations[relations[0]['relation']]}} ?
Answer: ||{{relations[0]['tail']}} 
```

# C.2.6 SEMANTIC ROLE LABELING

Semantic role labeling is a long-standing information task that wants to identify the semantic arguments related to a given predicate in a sentence. For example, in the sentence “Grant was employed at IBM for 21 years where she held several executive positions.” and the predicate “employed” in it, semantic role labeling identifies the Grant as the subject and IBM as the second object.

We create two different tasks based on semantic role labelling datasets CoNLL05 (Carreras & Màrquez, 2005), CoNLL12 (Pradhan et al., 2013), and PropBank (Kingsbury & Palmer).

• Semantic Role Labeling: the traditional task form, where a verb (i.e., predicate) is annotated in text and the model is asked to generate related semantic roles.   
• Semantic Role Filling: given a verb and and a potential semantic role, the model is asked to judge whether the role exists in the sentence and generate it.   
• Predicate Recognition: given a segment of a sentence and its corresponding semantic role, identify which verb it is related to.

(Semantic Role Labeling, Prompt 0)   
```jinja
Provided with the target verb "{{verb}}" marked with "[" and "]" in the following sentence, find out its "{{allowed_types[type_idx]}}":
{{text}} => || {|% for entity, type in zip(entities, entity_types) %}{% if type == allowed_types[type_idx] %}{{entity}}{% endif %}{% endfor %} 
```

(Semantic Role Filling, Prompt 0)   
```jinja
Given the following list of argument types:
Z = {{allowed_types | join(", ")}}
find out all arguments related to verb "{{verb}}" mentioned in the following sentence from left to right, in the form of "(X; instance of; Z)".{{text}} => || {| % for entity, type in zip(entities, entity_types) %}({entity}}; argument type; {{type}}) { % endfor %} 
```

(Predicate Recognition, Prompt 0)   
FINAL EXAM
1. Based on the fact that "{{entities[entity_idx]}}" is a "{{entity_types[entity_idx]}}", which verb in the following sentence should it related to?
{{text}}
Answer: ||{{verb}}

# C.3 RESULT SOURCES FOR GPT-3, BLOOM-176B, AND OPT-175B

Here we describe the result sources for GPT-3, BLOOM-176B, and OPT-175B. Other LLMs we may compare are mostly completely closed-sourced; thus, their results are all taken from existing preprints, publications, or the results stored in BIG-bench repository10.

For GPT-3, while most of its results in this paper are taken from existing literature if not specified, the rest were acquired via our own requesting OpenAI Danvici API are explicitly mentioned. For BLOOM-176B and OPT-175B, if without specific annotation, their results are:

• Taken from the OPT paper (Zhang et al., 2022).   
• Taken from the EAI-Eval BigScience Arch&Scale - Google Sheet11.   
• Taken from BigScience evaluation results repository in Huggingface Datasets12.

Specifically, we cannot evaluate OPT-175B by ourselves as we are still not officially granted the checkpoint, though we have sent several applications in the past few months.

# C.4 PILE TEST-SET EVALUATION

Pile evalution (Gao et al., 2020) is a comprehensive language modeling benchmark which originally includes 22 different text datasets from diverse domains. We report our results over a part of 18 datasets with previously reported baseline results (Lieber et al., 2021). Different from traditional language modeling benchmarks, Pile evaluation report the BPB (bits-per-byte) perplexity to avoid the mismatch comparison between models with different vocabularies. Because in general, language models with a larger vocabulary will be favored in perplexity comparison if not restricted. In the evaluation, we strictly follow the setting in (Gao et al., 2020), leveraging [gMASK] and a context-length of 1,024 with bidirectional attention, and the rest 1024 tokens to calculate BPB in an autoregressive manner. The weighted average BPB are calculated based on each shared dataset’s ratio in Pile training-set (Gao et al., 2020).

Table 13: GLM-130B and its similar-sized LLMs’ BPB results on Pile test-set. 

<table><tr><td></td><td>Jurassic-1</td><td>GPT-3</td><td>GLM-130B</td></tr><tr><td>dm_mathematics</td><td>1.040</td><td>1.370</td><td>0.786</td></tr><tr><td>ubuntu_irc</td><td>0.857</td><td>0.946</td><td>0.977</td></tr><tr><td>opensubtitles</td><td>0.879</td><td>0.932</td><td>0.889</td></tr><tr><td>hackernews</td><td>0.869</td><td>0.975</td><td>0.873</td></tr><tr><td>books33</td><td>0.835</td><td>0.802</td><td>0.803</td></tr><tr><td>pile_cc</td><td>0.669</td><td>0.698</td><td>0.771</td></tr><tr><td>philpapers</td><td>0.741</td><td>0.723</td><td>0.766</td></tr><tr><td>gutenberg_pg_19</td><td>0.890</td><td>1.160</td><td>0.821</td></tr><tr><td>arxiv</td><td>0.680</td><td>0.838</td><td>0.570</td></tr><tr><td>stackexchange</td><td>0.655</td><td>0.773</td><td>0.611</td></tr><tr><td>nih_exporter</td><td>0.590</td><td>0.612</td><td>0.614</td></tr><tr><td>pubmed_abstracts</td><td>0.587</td><td>0.625</td><td>0.610</td></tr><tr><td>uspto_backgrounds</td><td>0.537</td><td>0.566</td><td>0.537</td></tr><tr><td>pubmed_central</td><td>0.579</td><td>0.690</td><td>0.510</td></tr><tr><td>freelaw</td><td>0.514</td><td>0.612</td><td>0.499</td></tr><tr><td>github</td><td>0.358</td><td>0.645</td><td>0.329</td></tr><tr><td>enron_emails</td><td>0.621</td><td>0.958</td><td>0.604</td></tr><tr><td>youtube_subtitles</td><td>0.825</td><td>0.815</td><td>0.746</td></tr><tr><td>Weighted Avg.</td><td>0.650</td><td>0.742</td><td>0.634</td></tr></table>

The detailed metrics on Pile test-set are reported in Table 13. We observe that compared to GPT-3, GLM-130B has a noticeable weaker performance on phil\_papers and pile\_cc, which is likely because of GLM-130B’s bilingual natural and lack of more diverse and high-quality private collected corpora.

# C.5 BIG-BENCH-LITE EVALUATION

Recent works (Wei et al., 2022c; Wang et al., 2022c) reveal that LLMs are capable to do reasoning beyond conventional language tasks. As a response, BIG-bench (Srivastava et al., 2022) is recently set up by crowdsourcing new types of tasks from global researchers to test LLMs unexplored abilities. For economical consideration, we evaluate GLM-130B on an official subset of original 150- task BIG-bench, the BIG-bench-lite with 24 tasks. These tasks can be categorized into two types: one is based on multiple-choice question answering with answer options, and another is direct generation without options. For the first category, we assess the probability of each option’s full content and pick the largest one as the answer; for the second one, we generate the answer using greedy decoding. All evaluations done in BIG-bench are based on [MASK], since answers here are usually short pieces of texts. All results on 24 BIG-bench-lite (Srivastava et al., 2022) datasets of three LLMs are shown in Table 14 and Figure 16. We just adopt the original prompts from BIG-bench and use the official implementation to generate priming examples for few-shot evaluation and to calculate the final scores.

![](images/8927f4ce6901ec0d8e037e4086d09ef2f2020330f4b168183f03f07803e2a33a.jpg)

<details>
<summary>line</summary>

| Effective Parameter Count | GLM-130B 0-shot | GLM-130B 1-shot | GLM-130B 3-shot | GPT-3 0-shot | GPT-3 1-shot | GPT-3 3-shot | PaLM 0-shot | PaLM 1-shot |
| ------------------------- | --------------- | --------------- | --------------- | ------------ | ------------ | ------------ | ----------- | ----------- |
| 10^8                      | -5              | -5              | -5              | -5           | -5           | -5           | -5          | -5          |
| 10^9                      | 0               | 0               | 0               | 0            | 0            | 0            | 0           | 0           |
| 10^10                     | 5               | 5               | 5               | 0            | 0            | 0            | 0           | 5           |
| 10^11                     | 15              | 15              | 15              | 5            | 10           | 10           | 5           | 15          |
| 10^12                     | 35              | 35              | 35              | 10           | 15           | 15           | 10          | 35          |
</details>

Figure 16: A full scope of BIG-benchlite (24 tasks) evaluation.

# C.6 MMLU EVALUATION

All results on 57 MMLU (Hendrycks et al., 2021) datasets of GLM-130B and BLOOM 176B are shown in Table 15. In Section 5.2, we report weighted average accuracy (i.e., accuracy average per sample, rather than by discipline) of GLM-130B, GPT-3 175B, and BLOOM 176B.

Below is a prompted example with 1-shot priming. We predict the probability on [’A’, ’B’, ’C’, ’D’] at the next token, and take the one with the maximal probability as the answer.

(MMLU 1-shot Example)   
The following are multiple choice questions about philosophy.

According to d'Holbach, people always act according to ____.
(A) free choices (B) dictates of the soul (C) necessary natural laws (D) undetermined will
Answer: (C) necessary natural laws

Epicurus holds that philosophy is:
(A) not suitable for the young. (B) not suitable for the old. (C) important, but unpleasant. (D) none of the above.
Answer: (

# C.7 CHINESE LANGUAGE UNDERSTANDING EVALUATION

Here we elaborate the prompts we use for CLUE (Xu et al., 2020) and FewCLUE (Xu et al., 2021) evaluation. On Chinese datasets, prompting meets some challenges as Chinese texts are organized by single characters rather than words, leading to unequal length of verbalizers in many cases. Albeit dataset-specific calibration (Wang et al., 2021; Wu et al., 2021) can help to mitigate the issue, the too specified technique can be complicated in implementation. Our evaluation in this paper adopts a more easy to solve method leveraging GLM-130B’s unique features. As GLM-130B is a bilingual LLM with English MIP, we adopt English prompts and verbalizers from similar tasks in (Bach et al., 2022) for Chinese dataset evaluation and find such strategies to be quite effective. In terms of evaluation metrics, except for DRCD and CMRC2018 two question answering datasets which reports EM, other datasets report accuracy.

# C.8 NATURAL LANGUAGE GENERATION

Natural language generation, or conditional natural language generation here, refers to tasks that require generating text based on the given information, such as tables and documents. We evaluate GLM-130B on data-to-text and summarization tasks. The datasets include WebNLG 2020 (Castro Ferreira et al., 2020), Clean E2E NLG (Dušek et al., 2019) and WikiLingua (Scialom et al., 2020) from GEM generation benchmark (Gehrmann et al., 2021). We select full WebNLG 2020 and the Clean E2E NLG in the test set and randomly select 5000 test examples from WikiLingua following the practice in (Chowdhery et al., 2022). Following the settings in PaLM, the prompt used for the Summarization tasks is “Summarize the following article:” and the prompt used for the Data-to-Text tasks is “Verbalize:”. An exception is E2E, where we process the data using the prompt “generate-gramatically-correct-text from” provided in promptsource for GLM-130B and GPT-3 175B (Davinci). All evaluations are one-shot, and the demonstration samples are randomly sampled from the training set. We report the F-measure of ROUGE-2, ROUGE-L (Lin, 2004) and BLEURT-20 (Pu et al., 2021). We compare our model with LaMDA, GPT-3 175B (Davinci), and PaLM, where the results of LaMDA and PaLM are reported by (Chowdhery et al., 2022), and we evaluate GPT-3 175B (Davinci) through OpenAI API.13

Our results are presented in Table 16. It shows that GLM-130B has better performances than LaMDA and GPT-3 (Davinci) on all tasks. In the Data-to-text task, GLM-130B performs slightly worse than PaLM-540B, while in the summary task, GLM-130B has even higher ROUGE results. We also ablate GLM-130B to unidirectional to demonstrate the advantage of bidirectional attention. Unidirectional GLM-130B underperforms GPT-3 175B in all three datasets, but when it shifts to bidirectional attention, there is an instant boost, making GLM-130B even comparable to PaLM-540B in a few cases. It indicates that bidirectional attention over the provided context (i.e., prefix) can also be beneficial for text generation missions.

Table 16: 1-shot GEM English natural language generation tasks (WebNLG, E2E, and WikiLingua). We compare two versions of GLM-130B (uni: unidirectional attention, bi: bidirectional attention), showing that bidirectional attention can also improve conditional generation’s performance. 

<table><tr><td rowspan="2">Task</td><td rowspan="2">Dataset</td><td rowspan="2">Metric</td><td rowspan="2">LaMDA 137B</td><td rowspan="2">GPT-3 175B (Davinci)</td><td colspan="2">GLM-130B</td><td rowspan="2">PaLM-540B</td></tr><tr><td>uni</td><td>bi</td></tr><tr><td rowspan="6">Data to Text</td><td rowspan="3">WebNLG</td><td>ROUGE-2</td><td>30.5</td><td>29.9</td><td>25.3</td><td>38.5</td><td>44.4</td></tr><tr><td>ROUGE-L</td><td>-</td><td>41.2</td><td>36.7</td><td>49.3</td><td>53.8</td></tr><tr><td>BLEURT-20</td><td>-</td><td>59.0</td><td>53.2</td><td>67.7</td><td>73.9</td></tr><tr><td rowspan="3">E2E</td><td>ROUGE-2</td><td>29.2</td><td>30.3</td><td>30.9</td><td>33.9</td><td>35.2</td></tr><tr><td>ROUGE-L</td><td>-</td><td>39.2</td><td>40.0</td><td>42.6</td><td>43.9</td></tr><tr><td>BLEURT-20</td><td>-</td><td>64.5</td><td>65.0</td><td>68.1</td><td>69.7</td></tr><tr><td rowspan="3">Summary</td><td rowspan="3">WikiLingua</td><td>ROUGE-2</td><td>5.4</td><td>7.2</td><td>5.8</td><td>10.4</td><td>9.9</td></tr><tr><td>ROUGE-L</td><td>-</td><td>18.9</td><td>16.4</td><td>23.4</td><td>20.6</td></tr><tr><td>BLEURT-20</td><td>-</td><td>41.2</td><td>39.4</td><td>45.0</td><td>47.7</td></tr></table>

# (E2E Example, without demonstration sample)

Aleksandr\_Prudnikov , height , 185.0 (centimetres). FC\_Spartak\_Moscow , ground , Otkrytiye\_Arena. Aleksandr\_Prudnikov , club , FC\_Spartak\_Moscow. Verbalize:

Groundtruth: 185 centimetre tall Aleksandr Prudnikov played for the Otkrytiye Arena based FC Spartak, Moscow.

GPT-3 175B (Davinci): Aleksandr Prudnikov is a midfielder for FC Spartak Moscow, a football (soccer) club based in Moscow, Russia.

GLM-130B: Aleksandr Prudnikov is 185.0 cm tall and plays for FC Spartak Moscow.

# (E2E Example, without demonstration sample)

Combine all of the following data into a concise and grammatically correct text: name : Blue Spice eatType : coffee shop area : riverside

Groundtruth: At the riverside, there is a coffee shop called The Blue Spice.

GPT-3 175B (Davinci): Blue Spice is a riverside coffee shop which is located on the corner of River Street and Riverbank Street.

GLM-130B: There’s a coffee shop that serves coffee in the riverside area, Blue Spice.

# (WikiLingua Example, without demonstration sample)

The majority of your customers will search for you online, so it's essential to have a user-friendly website. At the very least, your website should include information about your business and your history in the moving industry, details about the quoting process, contact information, and a description of the services you offer. If possible, allow customers to schedule quotes online, view your availability, or read testimonials from other customers. One of the easiest ways to start your business is by helping people you already know with their moves. You can be on the lookout for any announcements related to moving that your friends make on social media. Once you have provided good service to friends, they are likely to recommend you to others. In order to spread the word about your business, have some professional looking promotional materials printed and distribute them around your community. You can distribute business cards at public events, tuck them into local bulletin boards, or even print them in directories, yearbooks, and other local print media. Flyers can be mailed, posted in public places, or distributed to businesses that might be able to refer customers to like you, such as furniture stores. Make sure you have a professional, recognizable logo that is consistent across all of your marketing materials. Another way to get your business's name out there is to make yourself visible. Whether it's by working with partners at local events, volunteering, or using your vehicle for an ad campaign, visibility is key for driving business. Build relationships with influential people in your community. Realtors are a great source of referrals to movers, as are the owners of local furniture stores or the office staff at a large apartment complex. You can use directory sites like Craigslist to advertise your services to people in your local community for free. Social media is also a great way to spread the word about your business. There are many options for advertising, depending on your budget and your target market. Consider options like PPC advertising, television and radio commercials, newspaper ads, direct mail flyers, or memberships with referral services. The best thing you can do to grow your business is to provide excellent service to your customers. Be sure to always be on time, be friendly, be respectful of your customers' belongings, and offer accurate price quotes. Be sure to ask your happy customers to post reviews about you online. New customers will see these reviews and will have more faith in you as a reputable company if they see that others have had a good experience. You will inevitably end up having to deal with an unhappy customer at some point, but do your best to resolve the problem to the customer's satisfaction. The last thing you want is negative reviews about your business circulating the internet! Summarize the article:

Groundtruth: Create a website. Start with friends. Distribute business cards and flyers. Network for promotion. Seek out free advertising opportunities. Consider paid advertising. Gain a good reputation.

GPT-3 175B (Davinci): Market yourself online. Look for opportunities to market your services offline.

GLM-130B: Have a user-friendly website. Promote your business through social media. Build relationships with influential people in your community. Use directory sites like Craigslist to advertise your services.

Table 17: Winograd-style tasks evaluation (Winogender and Winograd273). All scores are accuracy. K refers to number of shots. ∗PaLM 540B did not report the exact 0-shot Winogender result, so we have to estimate a value from its plotted diagram. 

<table><tr><td></td><td>K</td><td>GPT-3(Davinci)</td><td>OPT175B</td><td>BLOOM176B</td><td>PaLM540B</td><td>Chinchilla</td><td>Gopher280B</td><td>GLM-130B</td></tr><tr><td rowspan="2">Winogender</td><td>0</td><td>64.2</td><td>54.8</td><td>49.1</td><td>75.0*</td><td>78.3</td><td>71.4</td><td>79.7</td></tr><tr><td>1</td><td>62.6</td><td>-</td><td>53.1</td><td>79.4</td><td>-</td><td>-</td><td>80.7</td></tr><tr><td>Winograd273</td><td>0</td><td>88.3</td><td>52.9</td><td>49.1</td><td>90.1</td><td>-</td><td>-</td><td>84.3</td></tr></table>

Table 18: Closed-book question answering (Natural Questions, StrategyQA). 

<table><tr><td></td><td>GPT-3(Davinci)</td><td>BLOOM176B</td><td>PaLM540B</td><td>Chinchilla</td><td>Gopher280B</td><td>GLM-130B</td></tr><tr><td>Natural Questions (EM)</td><td>14.6</td><td>13.1</td><td>21.2</td><td>16.6</td><td>10.1</td><td>11.7</td></tr><tr><td>StrategyQA (Acc)</td><td>52.3</td><td>49.8</td><td>64.0</td><td>-</td><td>-</td><td>60.6</td></tr></table>

Table 19: Commonsense reasoning (Commonsense QA, MC-TACO). K refers to number of shots. 

<table><tr><td></td><td>K</td><td>GPT-3 (Davinci)</td><td>OPT 175B</td><td>BLOOM 176B</td><td>GLM-130B</td></tr><tr><td rowspan="2">Commonsense QA (Acc)</td><td>0</td><td>57.2</td><td>-</td><td>42.8</td><td>61.6</td></tr><tr><td>1</td><td>61.2</td><td>-</td><td>-</td><td>62.2</td></tr><tr><td>MC-TACO (EM)</td><td>0</td><td>-</td><td>12.4</td><td>13.1</td><td>13.6</td></tr></table>

# C.9 WINOGRAD-STYLE TASKS

We include the evaluation on Winograd-style tasks, which derives from the classical Winograd Schemas Challenge (Levesque et al., 2012) that aims to test coreference resolution in an ambiguous context for the machine to understand. Since in MIP, we have included the Winogrande (Sakaguchi et al., 2021) and SuperGLUE WSC (Wang et al., 2019), here we test on Winogender (Rudinger et al., 2018) and Winograd273 (Levesque et al., 2012). For Winogender, GPT-3’s results are acquired from OpenAI API, and BLOOM’s 1-shot result is evaluated by ourselves. For Winograd273, since existing works (Brown et al., 2020; Chowdhery et al., 2022) show that 1-shot learning brings almost no improvement, we only test the zero-shot result. Another thing to notice is that, despite GPT-style models (e.g., GPT-3, PaLM) adopting the “partial evaluation” described in (Radford et al., 2019), we find the prompt “<sentence> The "<pronoun>" refers to [MASK]” is better for GLM-130B and adopt it in the evaluation.

The results are presented in Table 17. GLM-130B performs the best across all evaluated LLM on Winogender, and marginally poorer than GPT-3 and PaLM on Winograd273.

# C.10 CLOSED-BOOK QUESTION ANSWERING

Closed-book question answering (CBQA) (Roberts et al., 2020) is a widely adopted task to evaluate language models’ memorization of factual knowledge, on contrary to the traditional “open-book” evaluation. As we have included TriviaQA (Joshi et al., 2017) and WebQuestions (Berant et al., 2013) in the MIP training, here we choose Natural Questions (Kwiatkowski et al., 2019) and StrategyQA (Geva et al., 2021) as the evaluation datasets for CBQA.

The results are presented in Table 18. GLM-130B performs relatively poorer on Natural Questions and performs well on StrategyQA. GLM-130B’s underperformance on Natural Questions, we speculate, potentially derives from the insufficiency fitting on English corpora, as it roughly only viewed

200B English tokens and thus does not memorize the detailed knowledge very well. Since CBQA seems to be a task that especially stresses memorization, as is indicated by Chinchilla (Hoffmann et al., 2022)’s a strong performance, we think with sufficient training later, GLM-130B can perform better.

# C.11 COMMONSENSE REASONING

Here we evaluate GLM-130B and some other LLMs on commonsense reasoning abilities. As we have included PIQA (Bisk et al., 2020), ARC (Clark et al., 2018), and OpenbookQA (Mihaylov et al., 2018) in the MIP training, we select another two widely adopted commonsense reasoning datasets in our evaluation: Commonsense QA (Talmor et al., 2019) and Multiple-choice Temporal Commonsense (MC-TACO, Zhou et al. (2019)). For Commonsense QA, we test the GPT-3 via OpenAI Davinci API, BLOOM-176B via its Huggingface Implementation, and GLM-130B using the prompt “answer\_given\_question\_without\_options” from promptsource (Bach et al., 2022). For StrategyQA, we follow the EM computation method provided in (Zhou et al., 2019).

The results are shown in Table 19. As we can see, GLM-130B performs the best on both Commonsense QA and MC-TACO across evaluated LLMs, demonstrating that GLM-130B has a good grasp of commonsense knowledge. OPT’s results are not included due to the reason described in Appendix C.3.

# C.12 FIXED LABEL DATASETS: A CASE STUDY IN NATURAL LANGUAGE INFERENCE

As is discussed in Section 5, we adopt a rather strict criterion for selecting datasets for zero/few-shot learning in GLM-130B’s evaluation due to the use of MIP. Nevertheless, the criterion significantly reduces the dataset we could currently evaluate, and especially some readers have doubted whether the restriction of not evaluating on MIP-seen fixed-label datasets is necessary (e.g., natural language inference (NLI)), and suggest that we may report them in an independent section to avoid confusion.

Frankly speaking, in such a setting GLM-130B’s zero/few-shot learning could be quite advantageous. Below, we take NLI as a typical example to show GLM-130B’s outperformance in the scenarios. We include 6 widely-used NLI datasets–which are not incorporated in GLM-130B’s MIP training, as the benchmarks. The results are presented in Table 20, which shows that GLM-130B’s “zero-shot” performance could be much better due to the seen task type.

Table 20: “Zero-shot” results of GLM-130B on 6 typical natural language inference (NLI) datasets. ∗DISCLAIMER: Despite the datasets are never seen, some other NLI datasets have been included in GLM-130B’s MIP, making it different from the existing standard zero-shot setting. 

<table><tr><td></td><td>BLOOM 176B</td><td>OPT 175B</td><td>GLM-130B*</td></tr><tr><td>qnli (valid, median of 5 prompts)</td><td>50.9</td><td>55.4</td><td>86.7</td></tr><tr><td>mnli (valid, median of 15 prompts)</td><td>35.5</td><td>36.0</td><td>85.7</td></tr><tr><td>mnli_mismatched (valid, median of 15 prompts)</td><td>35.5</td><td>36.0</td><td>84.6</td></tr><tr><td>wnli (valid, median of 5 prompts)</td><td>57.7</td><td>53.5</td><td>67.6</td></tr><tr><td>glue/cola (valid, median of 5 prompts)</td><td>39.0</td><td>44.4</td><td>57.6</td></tr><tr><td>glue/mrpc (valid, median of 5 prompts)</td><td>31.6</td><td>44.6</td><td>87.3</td></tr></table>

# C.13 SUPERGLUE

We also report our evaluation of GLM-130B on the SuperGLUE (Wang et al., 2019) benchmark, which consists 8 different natural language understanding challenges. Noted that these results are neither zero/few-shot nor fine-tuned results, because 7 out of 8 tasks’ training sets have been included in GLM-130B’s MIP training (except for ReCoRD) together with other 67 multi-task datasets; however, GLM-130B is also not individually fine-tuned on any of them. Therefore, these results are not for relative comparison for any other models’, but only for readers’ reference on GLM-130B’s absolute ability.

![](images/fc689c65fb2b5856307d27ee94de4a4fb517b4bb66428144acd480cde32b995d.jpg)

<details>
<summary>scatter</summary>

|        | cb   | record | wsc  | multirc | rte  | wic  | copa | boolq |
| ------ | ---- | ------ | ---- | ------- | ---- | ---- | ---- | ----- |
| GLM-130B (uni) | 10  | 20     | 40   | 50      | 50   | 50   | 60   | 40    |
| GLM-130B (bi)   | 90  | 30     | 70   | 85      | 85   | 65   | 95   | 85    |
</details>

Figure 17: GLM-130B (uni and bi)’s untuned results on SuperGLUE development set, using promptsource (Bach et al., 2022) prompts and task formulation. DISCLAIMER: Noted that some of the SuperGLUE training sets have been included in the MIP training. We report the results here only for readers’ reference.

![](images/f0c530e64fad757484a13cc1fa779d46364048a0358feddefa18534885df46ad.jpg)

<details>
<summary>bar</summary>

| Category | Standard Prompting | Chain-of-Thoughts |
| :--- | :--- | :--- |
| Sports | 54.0 | 73.7 |
| LLC | 1.0 | 13.4 |
| Coin Flip | 84.5 | 95.0 |
| Coin Flip (OOD: 3) | 47.9 | 58.6 |
| Reverse List | 53.1 | 68.3 |
| Date | 15.7 | 27.9 |
</details>

Figure 18: Chain-of-thought prompting can also improve GLM-130B’s performance on reasoning tasks compared to standard prompting.

<table><tr><td></td><td>BoolQ</td><td>CB</td><td>COPA</td><td>MultiRC</td><td>ReCoRD</td><td>RTE</td><td>WiC</td><td>WSC</td></tr><tr><td>GLM-130B</td><td>89.69</td><td>98.21</td><td>100</td><td>89.32</td><td>92.11</td><td>94.22</td><td>76.96</td><td>88.5</td></tr></table>

Table 21: The results of GLM-130B on the SuperGLUE dataset obtained using the P-tuning v2 (Liu et al., 2022). We report the Accuracy metric for all datasets except for MultiRC (F1a) and ReCoRD (F1).

The results are presented in Figure 17. We ablate the unidirectional and bidirectional GLM-130B to justify the usefulness of GLM objective in boosting LLMs’ ability to understand. Each point in the figure refers to a prompt-specific result, for which the prompt is from the promptsource (Bach et al., 2022) repository. We adopt the task formulation from promptsource, too. As we can observe, GLM (bi) has much fewer variances and higher performances on all tasks. For some of the tasks (such as CB, MultiRC, RTE, COPA, and BoolQ), GLM-130B can even achieve over 80% accuracy.

We also attempted to fine-tune GLM-130B on the SuperGLUE dataset. However, we encountered the issue of rapid overfitting within a single epoch when we used full parameter fine-tuning on downstream tasks. This resulted in poor performance on the validation set. To address this issue, we explored the use of efficient parameter fine-tuning methods, which tune only a small number of parameters and are less prone to overfitting. After experimenting with several methods, we use P-Tuning v2 (Liu et al., 2022), which demonstrated comparable results to full parameter fine-tuning in GLM-130B, but with only 0.1% to 3% of tuned parameters. The results of our experiments with P-Tuning v2 are presented in Table 21.

# C.14 CHAIN-OF-THOUGHT PROMPTING

We evaluate the chain-of-thought prompting performance on Last letter concatenation (LLC), Coin Flip, Reverse List, and two tasks from BIG-bench Srivastava et al. (2022) Sports understanding, and Date understanding, following the setting in Wei et al. (2022c). The results are shown in Figure 17. We find that chain-of-thought prompting can improve GLM-130B’s performance on symbolic reasoning and commonsense reasoning.

Log-scaling Ability Tasks   
![](images/137056cee4899dcdc5d8380ee26047bc23178f4d822fd5e9550df31f7ecf9e48.jpg)  
Figure 19: Log-scaling ability tasks of GLM-130B. These tasks’ performance grows logarithmically with the amount of GLM parameters. Most of traditional NLP tasks fall into the same pattern.

Last letter concatenation (LLC). The task asks the model to concatenate the last letters of words in a name (e.g., "Elon Musk" -> "nk"). We generate full names by randomly concatenating the top 1000 first and last names from name census data14.

Coin flip. This task asks the model to answer whether a coin is still heads up after people either flip or don’t flip it beginning from being heads up. $( \mathrm { e . g . , \ " A }$ coin is heads up. Phoebe flips the coin. Osvaldo does not flip the coin. Is the coin still heads up $\therefore \mathrm { \Omega } \mathrm { - } \mathrm { > \Omega } ^ { " } \mathrm { n o " } \mathrm { ) }$ . We additionally evaluate on the scenario where the number of people in the query examples is larger than that in the in-context examples, i.e. the out-of-distribution (OOD) setting.

Reverse List. This task asks the model to reverse the order of a list of everyday objects (e.g., "cigar, umbrella, key, gum, alarm" -> "alarm, gum, key, umbrella, cigar"). We generate the lists by randomly sampling from the vocabulary of everyday objects15.

Sports. This task asks the model to judge the truthfulness of a statement about a sports player (e.g., "Joao Moutinho caught the screen pass in the NFC championship" -> "false").

Date. This task asks the model to infer the data from a given context (e.g., "2015 is coming in 36 hours. What is the date one week from today in MM/DD/YYYY?" -> "01/05/2015").

We use the same examples and chains as Wei et al. (2022c). For each task, we try two different formats of prompts and both unidirectional and bidirectional attention mechanism and report the best performance. The first format is "Question: {context} Answer: {target}". The second one is to add serial numbers before examples in the first format of prompts. The results are presented in Figure 18.

# D SCALING AND EMERGENT ABILITIES IN GLM-130B

Scaling up pre-trained language models has been proven to boost downstream performance on a wide range of tasks continually. His, emergent abilities which are unpredictable from smaller scales. To illustrate this, we conducted extensive experiments to explore the scaling property and emergent abilities. Following prior literature (Wei et al., 2022b), we categorize the NLP tasks into two types based on our observations.

• Log-scaling Ability Tasks (Cf. Figure 19): where the task performance grows logarithmically with the number of model parameters. Typical tasks and datasets include LAMBADA, Wikitext-103, Wikitext-2, Penn Tree Bank.   
• Emergent Ability Tasks (Cf. Figure 20): where the task performance only soars up when the amount of model parameters reaches a certain threshold. Typical tasks and datasets include:

Emergent Ability Tasks   
![](images/d077b85eade68ccdcb4df0ebb6f5ce33aa9e09f11e15cb6bf8059266a2d315ce.jpg)  
Figure 20: Emergent ability tasks of GLM-130B. These tasks’ performance does not grow much until the model size reaches a certain threshold (e.g., 100B or 10B). After reaching the threshold, the model performance soars up quickly. The BIG-bench (Srivastava et al., 2022) benchmark collects many of these challenges.

MMLU, hindu\_knowledge, crass\_ai, implicatures, understanding\_fables, modified\_arithmetic, implicit\_relations, and gre\_reading\_comprehension from BIG-bench (Srivastava et al., 2022).

In line with the observation in (Wei et al., 2022b), we show that GLM-130B also presents the two similar scaling behaviors to other LLMs such as GPT-3, LaMDA, and PaLM. Though why and how LLMs present these intriguing properties remain unclear, GLM-130B provides open opportunities for all researchers to test and understand the reason behind them.

Table 11: Full configurations for GLM-130B training 

<table><tr><td>Configuration Key</td><td>Value</td></tr><tr><td>adam_beta1</td><td>0.9</td></tr><tr><td>adam_beta2</td><td>0.95</td></tr><tr><td>adam_eps</td><td>1e-08</td></tr><tr><td>aggregated_samples_per_sequence</td><td>4</td></tr><tr><td>attention_dropout</td><td>0.1</td></tr><tr><td>attention_softmax_in_fp32</td><td>True</td></tr><tr><td>average_block_length</td><td>3</td></tr><tr><td>bias_dropout_fusion</td><td>True</td></tr><tr><td>checkpoint_activations</td><td>True</td></tr><tr><td>checkpoint_in_cpu</td><td>False</td></tr><tr><td>checkpoint_num_layers</td><td>1</td></tr><tr><td>clip_grad</td><td>1.0</td></tr><tr><td>contiguous_checkpointing</td><td>False</td></tr><tr><td>cpu_optimizer</td><td>False</td></tr><tr><td>data_parallel_size</td><td>24</td></tr><tr><td>deepnorm</td><td>True</td></tr><tr><td>distributed_backend</td><td>nccl</td></tr><tr><td>eval_interval</td><td>1000</td></tr><tr><td>eval_iters</td><td>3</td></tr><tr><td>ffn_hidden_size</td><td>32768</td></tr><tr><td>fp16</td><td>True</td></tr><tr><td>global_batch_size</td><td>4224</td></tr><tr><td>glu_activation</td><td>geglu</td></tr><tr><td>gpt_prob</td><td>0.7</td></tr><tr><td>hidden_dropout</td><td>0.1</td></tr><tr><td>hidden_size</td><td>12288</td></tr><tr><td>hysteresis</td><td>2</td></tr><tr><td>init_method_std</td><td>0.0052</td></tr><tr><td>init_method_xavier_uniform</td><td>False</td></tr><tr><td>initial_loss_scale</td><td>65536</td></tr><tr><td>layernorm_epsilon</td><td>1E-05</td></tr><tr><td>learnable_rotary_embedding</td><td>False</td></tr><tr><td>length_per_sample</td><td>2000</td></tr><tr><td>log_interval</td><td>1</td></tr><tr><td>loss_scale</td><td>0</td></tr><tr><td>loss_scale_window</td><td>2000</td></tr><tr><td>lr</td><td>8e-05</td></tr><tr><td>lr_decay_iters</td><td>None</td></tr><tr><td>lr_decay_samples</td><td>197753905</td></tr><tr><td>lr_decay_style</td><td>cosine</td></tr><tr><td>lr_warmup_samples</td><td>1098632</td></tr><tr><td>make_vocab_size_divisible_by</td><td>768</td></tr><tr><td>mask_prob</td><td>0.15</td></tr><tr><td>masked_softmax_fusion</td><td>True</td></tr><tr><td>micro_batch_size</td><td>1</td></tr><tr><td>min_gmask_ratio</td><td>0.2</td></tr><tr><td>min_loss_scale</td><td>1.0</td></tr><tr><td>min_lr</td><td>8e-06</td></tr><tr><td>multitask_ratio</td><td>0.05</td></tr><tr><td>num_attention_heads</td><td>96</td></tr><tr><td>num_layers</td><td>70</td></tr><tr><td>onnx_safe</td><td>None</td></tr><tr><td>optimizer</td><td>adam</td></tr><tr><td>partition_activations</td><td>True</td></tr><tr><td>pipeline_model_parallel_size</td><td>8</td></tr><tr><td>position_embedding_type</td><td>rotary</td></tr><tr><td>rampup_batch_size</td><td>192, 24, 5493164</td></tr><tr><td>save_interval</td><td>250</td></tr><tr><td>seed</td><td>1234</td></tr><tr><td>seq_length</td><td>2048</td></tr><tr><td>short_seq_prob</td><td>0.02</td></tr><tr><td>shrink_embedding_gradient_alpha</td><td>0.1</td></tr><tr><td>single_span_prob</td><td>0.02</td></tr><tr><td>split</td><td>949,50,1</td></tr><tr><td>tensor_model_parallel_size</td><td>4</td></tr><tr><td>tokenizer_type</td><td>IceTokenizer</td></tr><tr><td>weight_decay</td><td>0.1</td></tr><tr><td>zero_contiguous_gradients</td><td>False</td></tr><tr><td>zero_reduce_bucket_size</td><td>500000000</td></tr><tr><td>zero_reduce_scatter</td><td>False</td></tr><tr><td>zero_stage</td><td>1</td></tr><tr><td>zero-optimization.allgather_bucket_size</td><td>500000000</td></tr><tr><td>tokenizer_type</td><td>IceTokenizer</td></tr><tr><td>weight_decay</td><td>0.1</td></tr><tr><td>world_size</td><td>768</td></tr><tr><td>zero_contiguous_gradients</td><td>FALSE</td></tr><tr><td>zero_reduce_bucket_size</td><td>500000000</td></tr><tr><td>zero_reduce_scatter</td><td>FALSE</td></tr><tr><td>zero_stage</td><td>1</td></tr><tr><td>zero-optimization.allgather_bucket_size</td><td>500000000</td></tr></table>

Table 12: The 74 datasets involved in Multi-task Instruction Pre-training (MIP). Datasets from T0- PromptSource (Sanh et al., 2022; Bach et al., 2022) are named in their Hugging Face datasets identifiers. Datasets from DeepStruct (Wang et al., 2022a) are described in Appendix C.2. 

<table><tr><td>Task</td><td>Dataset</td><td>Task</td><td>Dataset</td></tr><tr><td>Coreference Resolution</td><td>super_glue/wsc.fixed</td><td>Multi-choice QA</td><td>cos_e/v1.11</td></tr><tr><td>Coreference Resolution</td><td>winogrande/winogrande_xl</td><td>Multi-choice QA</td><td>cosmos_qa</td></tr><tr><td>Natural Language Inference</td><td>super_glue/cb</td><td>Multi-choice QA</td><td>dream</td></tr><tr><td>Natural Language Inference</td><td>super_glue/rte</td><td>Multi-choice QA</td><td>openbookqa/main</td></tr><tr><td>Natural Language Inference</td><td>anli</td><td>Multi-choice QA</td><td>qasc</td></tr><tr><td>Paraphrase Identification</td><td>glue/mrpc</td><td>Multi-choice QA</td><td>quail</td></tr><tr><td>Paraphrase Identification</td><td>glue/qqp</td><td>Multi-choice QA</td><td>quarel</td></tr><tr><td>Paraphrase Identification</td><td>paws/labeled_final</td><td>Multi-choice QA</td><td>quartz</td></tr><tr><td>Closed-Book QA</td><td>ai2_arc/ARC_Challenge</td><td>Multi-choice QA</td><td>race/high</td></tr><tr><td>Closed-Book QA</td><td>ai2_arc/ARC_Easy</td><td>Multi-choice QA</td><td>race/middle</td></tr><tr><td>Closed-Book QA</td><td>kilt_tasks/hoptpotqa</td><td>Multi-choice QA</td><td>sciq</td></tr><tr><td>Closed-Book QA</td><td>trivia_qa/unfiltered</td><td>Multi-choice QA</td><td>social_i_qa</td></tr><tr><td>Closed-Book QA</td><td>web_questions</td><td>Multi-choice QA</td><td>super_glue/boolq</td></tr><tr><td>Closed-Book QA</td><td>wiki_qa</td><td>Multi-choice QA</td><td>super_glue/multirc</td></tr><tr><td>Extractive QA</td><td>adversarial_qa/dbidaf</td><td>Multi-choice QA</td><td>wiki_hop/original</td></tr><tr><td>Extractive QA</td><td>adversarial_qa/dbert</td><td>Multi-choice QA</td><td>wiqa</td></tr><tr><td>Extractive QA</td><td>adversarial_qa/droberta</td><td>Multi-choice QA</td><td>piqa</td></tr><tr><td>Extractive QA</td><td>duorc/SelfRC</td><td>Topic Classification</td><td>ag_news</td></tr><tr><td>Extractive QA</td><td>duorc/ParaphraseRC</td><td>Topic Classification</td><td>dbpedia_14</td></tr><tr><td>Extractive QA</td><td>ropes</td><td>Topic Classification</td><td>trec</td></tr><tr><td>Extractive QA</td><td>squad_v2</td><td>Word Sense Disambiguation</td><td>super_glue/wic</td></tr><tr><td>Extractive QA</td><td>super_glue/record</td><td>Dialogue State Tracking</td><td>multiwoz_2.1</td></tr><tr><td>Extractive QA</td><td>quoref</td><td>Event Extraction</td><td>ace05</td></tr><tr><td>Sentiment</td><td>amazon_polarity</td><td>Named Entity Recognition</td><td>conll03</td></tr><tr><td>Sentiment</td><td>app_reviews</td><td>Named Entity Recognition</td><td>genia</td></tr><tr><td>Sentiment</td><td>imdb</td><td>Named Entity Recognition</td><td>ontonotes5.0</td></tr><tr><td>Sentiment</td><td>rotten_tomatoes</td><td>Named Entity Recognition</td><td>ace2005</td></tr><tr><td>Sentiment</td><td>yelp_review_full</td><td>Named Entity Recognition</td><td>conll04</td></tr><tr><td>Sentence Completion</td><td>super_glue/copa</td><td>Named Entity Recognition</td><td>nyt29</td></tr><tr><td>Sentence Completion</td><td>hellaswag</td><td>Relation Extraction</td><td>conll04</td></tr><tr><td>Structure-to-Text</td><td>common_gen</td><td>Relation Extraction</td><td>nyt29</td></tr><tr><td>Structure-to-Text</td><td>wiki_bio</td><td>Relation Extraction</td><td>ace2005</td></tr><tr><td>Summarization</td><td>cnn_dailymail/3.0.0</td><td>Relation Extraction</td><td>kelm</td></tr><tr><td>Summarization</td><td>gigaword</td><td>Relation Classification</td><td>tacred</td></tr><tr><td>Summarization</td><td>multi_news</td><td>Semantic Role Labeling</td><td>conll05</td></tr><tr><td>Summarization</td><td>samsum</td><td>Semantic Role Labeling</td><td>conll12</td></tr><tr><td>Summarization</td><td>xsum</td><td>Semantic Role Labeling</td><td>propbank</td></tr></table>

Table 14: Details results of GLM-130B, GPT-3 175B (Brown et al., 2020), and PaLM 540B (Chowdhery et al., 2022) on BIG-bench-lite in 0, 1, and 3-shots. “Normalized preferred metric” is reported for each task. GPT-3 and PaLM’s results are reported in BIG-bench’s GitHub repository, and PaLM 540B’s 3-shot results are not found. 

<table><tr><td rowspan="2"></td><td colspan="3">GLM-130B</td><td colspan="3">GPT-3 175B</td><td colspan="2">PaLM 540B</td></tr><tr><td>0</td><td>1</td><td>3</td><td>0</td><td>1</td><td>3</td><td>0</td><td>1</td></tr><tr><td>auto_debugging</td><td>11.76</td><td>20.59</td><td>23.53</td><td>0.00</td><td>0.00</td><td>0.00</td><td>0.00</td><td>38.23</td></tr><tr><td>bbq_lite_json</td><td>22.26</td><td>37.50</td><td>59.73</td><td>-8.33</td><td>40.75</td><td>61.21</td><td>-4.39</td><td>77.73</td></tr><tr><td>code_line_description</td><td>0.22</td><td>9.09</td><td>-8.64</td><td>9.09</td><td>9.09</td><td>9.09</td><td>0.22</td><td>49.00</td></tr><tr><td>conceptual_combinations</td><td>37.51</td><td>31.33</td><td>27.86</td><td>2.37</td><td>3.70</td><td>14.33</td><td>45.68</td><td>73.36</td></tr><tr><td>conlang_translation</td><td>34.72</td><td>38.01</td><td>33.88</td><td>46.82</td><td>47.07</td><td>51.60</td><td>36.88</td><td>61.92</td></tr><tr><td>emoji_movie</td><td>1.25</td><td>4.88</td><td>3.75</td><td>-10.00</td><td>-2.49</td><td>-1.24</td><td>17.50</td><td>88.75</td></tr><tr><td>formal_fallacies_syllogisms_negation</td><td>0.83</td><td>1.46</td><td>0.35</td><td>1.00</td><td>6.80</td><td>5.60</td><td>-0.20</td><td>4.40</td></tr><tr><td>hindu_knowledge</td><td>32.23</td><td>37.56</td><td>34.52</td><td>10.15</td><td>40.61</td><td>44.42</td><td>41.37</td><td>93.15</td></tr><tr><td>known_unknowns</td><td>-4.35</td><td>0.00</td><td>4.35</td><td>21.74</td><td>4.35</td><td>0.00</td><td>13.04</td><td>34.78</td></tr><tr><td>language_identification</td><td>9.62</td><td>1.97</td><td>1.90</td><td>7.49</td><td>3.20</td><td>1.98</td><td>12.11</td><td>31.03</td></tr><tr><td>linguistics_puzzles</td><td>0.00</td><td>0.00</td><td>0.00</td><td>0.00</td><td>0.00</td><td>0.00</td><td>0.00</td><td>0.10</td></tr><tr><td>logic_grid_puzzle</td><td>9.88</td><td>13.66</td><td>5.24</td><td>0.16</td><td>3.35</td><td>0.01</td><td>1.47</td><td>16.12</td></tr><tr><td>logical_deduction</td><td>24.18</td><td>22.20</td><td>20.35</td><td>2.22</td><td>10.80</td><td>14.71</td><td>2.17</td><td>15.34</td></tr><tr><td>misconceptions_russian</td><td>-26.53</td><td>-46.94</td><td>-26.53</td><td>-34.70</td><td>-34.70</td><td>-30.61</td><td>-42.86</td><td>-30.61</td></tr><tr><td>novel_concepts</td><td>6.25</td><td>21.87</td><td>25.78</td><td>33.59</td><td>33.59</td><td>45.31</td><td>33.59</td><td>49.22</td></tr><tr><td>operators</td><td>14.76</td><td>18.10</td><td>18.10</td><td>30.0</td><td>34.29</td><td>33.33</td><td>30.48</td><td>56.19</td></tr><tr><td>parsinlu_reading_comprehension</td><td>7.14</td><td>7.72</td><td>11.58</td><td>0.00</td><td>0.00</td><td>0.00</td><td>9.46</td><td>44.40</td></tr><tr><td>play_dialog_same_or_different</td><td>2.88</td><td>5.33</td><td>3.80</td><td>8.00</td><td>0.80</td><td>-5.40</td><td>-33.0</td><td>0.10</td></tr><tr><td>repeat_copy_logic</td><td>0.00</td><td>0.00</td><td>0.00</td><td>0.00</td><td>0.00</td><td>0.00</td><td>0.00</td><td>37.5</td></tr><tr><td>strange_stories</td><td>43.86</td><td>51.76</td><td>42.31</td><td>8.27</td><td>25.68</td><td>12.93</td><td>39.25</td><td>74.46</td></tr><tr><td>strategyqa</td><td>21.10</td><td>18.74</td><td>16.82</td><td>4.60</td><td>13.20</td><td>14.20</td><td>28.00</td><td>38.00</td></tr><tr><td>symbol_interpretation</td><td>1.39</td><td>1.89</td><td>1.77</td><td>0.51</td><td>-0.63</td><td>2.77</td><td>0.76</td><td>2.40</td></tr><tr><td>vitaminc_fact_verification</td><td>71.87</td><td>60.72</td><td>56.55</td><td>-31.55</td><td>22.15</td><td>29.05</td><td>-28.85</td><td>55.60</td></tr><tr><td>winowhy</td><td>-3.49</td><td>5.38</td><td>3.0</td><td>3.0</td><td>10.60</td><td>13.00</td><td>-5.0</td><td>31.80</td></tr></table>

Table 15: Detailed results of GLM-130B and BLOOM 176B (Scao et al., 2022) on MMLU (Hendrycks et al., 2021). We find that no existing literature has reported GPT-3 175B’s numerical accuracy. BLOOM is evaluated using Huggingface Transformer implementation. 

<table><tr><td></td><td>Discipline</td><td>GLM-130B</td><td>BLOOM 176B</td></tr><tr><td rowspan="19">STEM</td><td>abstract_algebra</td><td>24.00</td><td>24.00</td></tr><tr><td>anatomy</td><td>48.90</td><td>38.52</td></tr><tr><td>astronomy</td><td>48.03</td><td>34.87</td></tr><tr><td>colledge_biology</td><td>47.22</td><td>37.50</td></tr><tr><td>college_chemistry</td><td>34.00</td><td>19.00</td></tr><tr><td>colledge_computer_science</td><td>44.00</td><td>1.00</td></tr><tr><td>colledge_mathematcis</td><td>27.00</td><td>31.00</td></tr><tr><td>colledge_physics</td><td>30.39</td><td>24.50</td></tr><tr><td>computer_security</td><td>61.00</td><td>40.00</td></tr><tr><td>conceptual_physics</td><td>38.72</td><td>31.49</td></tr><tr><td>electrical_engineering</td><td>45.52</td><td>32.41</td></tr><tr><td>elementary_mathematics</td><td>31.75</td><td>29.63</td></tr><tr><td>high_school_biology</td><td>51.29</td><td>27.42</td></tr><tr><td>high_school_chemistry</td><td>34.98</td><td>27.09</td></tr><tr><td>high_school_computer_science</td><td>53.00</td><td>30.00</td></tr><tr><td>high_school_mathematics</td><td>28.15</td><td>25.93</td></tr><tr><td>high_school_physics</td><td>29.80</td><td>30.46</td></tr><tr><td>high_school_statistics</td><td>38.43</td><td>26.39</td></tr><tr><td>machine_learning</td><td>40.18</td><td>29.46</td></tr><tr><td rowspan="12">Social Science</td><td>econometrics</td><td>26.32</td><td>26.32</td></tr><tr><td>high_school_geography</td><td>53.54</td><td>36.36</td></tr><tr><td>high_school_government_and_politics</td><td>62.18</td><td>40.41</td></tr><tr><td>high_school_macroeconomics</td><td>42.56</td><td>30.77</td></tr><tr><td>high_school_microeconomics</td><td>45.80</td><td>26.89</td></tr><tr><td>high_school_psychology</td><td>54.13</td><td>39.27</td></tr><tr><td>human_sexuality</td><td>51.15</td><td>35.11</td></tr><tr><td>professional_psychology</td><td>42.48</td><td>31.54</td></tr><tr><td>public_relations</td><td>55.46</td><td>33.64</td></tr><tr><td>security_studies</td><td>44.90</td><td>34.29</td></tr><tr><td>sociology</td><td>51.74</td><td>31.84</td></tr><tr><td>us_foreign_policy</td><td>61.00</td><td>46.00</td></tr><tr><td rowspan="13">Humanities</td><td>formal_logic</td><td>27.78</td><td>23.02</td></tr><tr><td>high_school_european_history</td><td>58.18</td><td>35.76</td></tr><tr><td>high_school_us_history</td><td>58.33</td><td>40.69</td></tr><tr><td>high_school_world_history</td><td>67.09</td><td>32.07</td></tr><tr><td>international_law</td><td>56.20</td><td>42.15</td></tr><tr><td>jurisprudence</td><td>43.52</td><td>35.19</td></tr><tr><td>logical_fallacies</td><td>57.06</td><td>31.29</td></tr><tr><td>moral_disputes</td><td>47.11</td><td>36.71</td></tr><tr><td>moral_scenarios</td><td>24.25</td><td>24.36</td></tr><tr><td>philosophy</td><td>45.34</td><td>35.37</td></tr><tr><td>prehistory</td><td>50.93</td><td>40.43</td></tr><tr><td>professional_law</td><td>37.94</td><td>29.53</td></tr><tr><td>world_religions</td><td>55.56</td><td>42.11</td></tr><tr><td rowspan="13">Other</td><td>business_ethics</td><td>51.00</td><td>34.00</td></tr><tr><td>clinical_knowledge</td><td>48.68</td><td>35.85</td></tr><tr><td>colledge_medicine</td><td>43.35</td><td>28.90</td></tr><tr><td>glocal_facts</td><td>35.00</td><td>23.00</td></tr><tr><td>human_aging</td><td>45.29</td><td>32.29</td></tr><tr><td>management</td><td>56.31</td><td>27.18</td></tr><tr><td>marketing</td><td>67.52</td><td>39.74</td></tr><tr><td>medical_genetics</td><td>48.00</td><td>45.00</td></tr><tr><td>miscellaneous</td><td>61.18</td><td>40.23</td></tr><tr><td>nutrition</td><td>50.65</td><td>32.35</td></tr><tr><td>professional_accounting</td><td>35.46</td><td>28.72</td></tr><tr><td>professional_medicine</td><td>43.38</td><td>18.01</td></tr><tr><td>virology</td><td>39.16</td><td>28.31</td></tr></table>

# E CONTRIBUTIONS

The GLM-130B project was conceived in Dec. 2021 with its pre-training part completed in July 3rd, 2022 and its evaluation and applications still ongoing. Over the course, we have experienced various technical and engineering challenges (Cf. Appendix F and Figure 21 for details). It would not be possible to reach its current status if without the collaboration of multiple teams—the Knowledge Engineering Group (KEG), Parallel Architecture & Compiler technology of Mobile, Accelerated, and Networked systems Group (PACMAN), and Natural Language Processing Group (THUNLP) at Tsinghua University, as well as Zhipu.AI. The detailed contributions are listed below.

# E.1 PREPARATION

• Model Implementation: Aohan Zeng, Zhengxiao Du   
• Self-Supervised Data Processing: Ming Ding, Wendi Zheng   
• Multitask Data Processing: Xiao Liu, Xiao Xia   
• Model Architecture: Aohan Zeng, Xiao Liu, Zhengxiao Du, Hanyu Lai   
• Training Stability: Aohan Zeng, Xiao Liu, Ming Ding   
• 3D-Parallelism and Training Efficiency: Aohan Zeng, Zixuan Ma, Jiaao He, Zhenbo Sun

# E.2 MODEL TRAINING

• Large-Scale Training & Monitoring: Aohan Zeng, Xiao Liu   
• Model Performance Validation: Aohan Zeng

# E.3 POST TRAINING

• Evaluation Framework: Aohan Zeng, Zhengxiao Du   
• Language Modeling Evaluation: Aohan Zeng   
• MMLU & BIG-Bench Evaluation: Aohan Zeng   
• CLUE & FewCLUE Evaluation: Xiao Liu, Aohan Zeng   
• Ethical Evaluation: Yifan Xu, Aohan Zeng, Xiao Liu, Zihan Wang   
• Baseline Evaluation: Xiao Liu, Jifan Yu, Weng Lam Tam   
• INT4 Quantization: Aohan Zeng, Zihan Wang, Xiao Liu, Hanyu Lai   
• Inference Acceleration: Zihan Wang, Aohan Zeng   
• Low-Resource Inference: Gouyang Zeng, Xu Han, Weilin Zhao, Zhiyuan Liu   
• Demo and API: Hanyu Lai, Jifan Yu, Xiaohan Zhang, Yufei Xue, Shan Wang, Jiecai Shan, Haohan Jiang, Zhengang Guo   
• Manuscript Writing: Xiao Liu, Yuxiao Dong, and Jie Tang wrote the main paper, and Xiao Liu, Aohan Zeng, and Zhengxiao Du wrote the Appendix.

# E.4 PROJECT MANAGEMENT

• Student Leaders: Aohan Zeng, Xiao Liu   
• Technical Advisors: Yuxiao Dong, Jidong Zhai, Wenguang Chen, Zhiyuan Liu, Peng Zhang, Jie Tang   
• Project Leader: Jie Tang

# E.5 COMPUTATION SPONSOR

• GPU Sponsor: Zhipu.AI

# F A BRIEF HISTORY OF GLM-130B

The GLM-130B project16 was conceived in Dec. 2021 in a brainstorming meeting at Tsinghua KEG. We firmly believe that it is of value to pre-train a highly accurate language model, in particular for both Chinese and English. Though GPT-3 (Brown et al., 2020) is the pioneer for this effort, it is not available to most people in the world. In addition, it supports English only. We therefore decide to initialize the project GLM-130B. Please note that the WuDao 1.75T model we built last year is a sparse model with 480 mixture-of-experts (MoE), rather than a dense one as GPT-3. Our goal then is to train a bilingual pre-trained dense model with high accuracy on downstream tasks, and to make it open to everyone in the world-anyone, anywhere can download it and use it on a single server with appropriate GPUs.

The ambitious project soon faced several important challenges:

• Lack of computational resources: No organization is willing to sponsor such a big project and freely make it public.   
• Lack of a robust pre-training algorithm: Despite GPT-3’s success on English corpus, it is unclear how to train a high-accurate bilingual model for both English and Chinese.   
• Lack of fast inference solutions: Since the goal is to have the model public to everyone, we need to design fast inference solutions with low resource requirements to run the model.

For the pre-training algorithm, we finally chose GLM (Du et al., 2022) due to its high performance in practice. We eventually decided to train a GLM model of 130 billion parameters after several rounds of discussions and exploration, because such a size makes it possible to run the inference on a single A100 (40G \* 8) server.

Our first attempt at training the model was in January 2022, shortly after we received a small sponsor of GPUs for test running. However, we soon realized that we had significantly underestimated the technical difficulties of pre-training a model at such a scale (>100B). It seems that pre-training a highly accurate 100B-scale model is quite different from training a 10B-scale one. Due to frequent random hardware failures, model gradients exploding, unexpected excessive memory usage in the algorithm, debug for the 3D pipeline in the new Megatron and DeepSpeed frameworks, inability to recover from optimizer states, blocked TCP responses between processes, and many many unexpected “bugs”, the project was delayed for many times. The Tsinghua PACMAN team gave us a hand at this difficult time and together we successfully fixed most of the “bugs”.

By March, we were still short on computational resources, but fortunately got a chance to try test runs on several other platforms, including Ascend 910, Hygon DCU, NVIDIA, and Sunway. The immediate challenge was for us to adapt our training code to these different platforms, as the underlying operators are quite different. Also, it introduced many new issues: the element-wise operators not supporting fast computation for large-dimension vectors, various issues that hindered convergence—the large gradient norms of input embeddings, native Post-LN, Pre-LN, and Sandwich-LN, dataloader state seeds, and computation precision choices in Softmax and Attention — as well as numerous mistakes we ourselves made. With tremendous help from all of our generous partners, we finally succeeded in making our pre-training algorithms runnable across all the platforms—frankly, a surprising achievement for this project. The timeline of GLM-130B in Figure 21 covers most of the issues we have encountered and addressed as of this writing.

On April 26th, we received a generous computing sponsorship from Zhipu.AI — an AI startup that aims to teach machines to think like humans. After another week of testing, we finally kicked off the training of the GLM-130B model on its 96 A100 (40G \* 8) servers on May 6th. Additionally, Zhipu.AI also sent a team to help evaluate the pre-trained model and build a demonstration website.

The training period spanned two months, during which we began developing a toolkit to allow GLM-130B’s inference in low-resource setting with swapping technique and quantization. Though it is already the most accessible model of its scale, together with our partner from Tsinghua NLP, we have been exploring the limit of popularized hardware platforms, which would truly make the 100B-scale model accessible to as many people as possible. To date, we managed to reach the INT4 weight quantization for GLM-130B. Importantly, the INT4 version of GLM-130B without post training

![](images/e6df2badbfe4cd12492135f5b2e4bcf1a799cc3595bca41ddc419365965ae79d.jpg)

# Major Issues Encountered for Training GLM-130B

# 2021.12

• The “千亿 ” (100B) project towards an open dense pre-trained GLM at 100B scale is conceived   
• Survey pre-training strategies of existing models of similar scale, such as GPT-3, Gopher => Limited public info about how they were trained and issues they met   
• Search for possible GPU clusters & sponsors

# 2022.1

• Test the performance of FP16/FP32 at 100B scale on one testing cluster   
• Unexpected excessive memory usage in GLM => Torch is better with fixed length input sequences   
• Inability to converge and try tricks from CogView and ViT => Use Sandwich-LN   
• Frequent random hardware failures => Have to run HCPG test before each run

# 2022.2

• Very slow training speed than previously calculated => Optimize kernels and fuse operators => Find the input shape is critical to kernel performance   
• Collect pre-training corpora and tokenize => Use icetk: the sentence piece is set to the unigram mode   
• Debug the 3D pipeline parallel in the newly-released Megatron and DeepSpeed

# 2022.3

• It can’t recover perfectly from checkpoints => Our customized dataloader do not save its state seed properly in distributed training   
• The memory per processor is too small => Require too many pipeline stages => Batch size is too large (up to 12,000) => Harm the model’s convergency   
• It can’t launch more than 2,000 computing nodes => Overcome this and support 6,000-node training by tuning Linux kernel TCP parameters   
• Collect data for multi-task instruction pre-training   
• Receive opportunities to test trainings on several other clusters   
• Very slow training speed than expected => The underlying element-wise operators don’t support fast computation on large-dimension vectors.

# 2022.4

• Optimize A100 kernel’s computing efficiency => A100 kernels prefer square-shaped inputs, and seq\_len=2,048 is optimal for our hidden-state dimension (12,288)   
• Inability to converge due to large gradient norms (170+) of input embeddings => Try embedding norm and gradient shrink, which turn out to be almost equivalent   
• Naïve post-LN or pre-LN disconverges after several thousands of steps => Try Sandwich-LN with PB-Relax   
• It still disconverges after one week’s trial => The dataloader state seeds are not unified for different pipeline stages, resulting in a mismatch of input data and labels.   
• Test two positional encodings: RoPE and Alibi => Alibi can be slower as it requires element-wise manipulation on attention matrices---changing num\_heads \*2,048 \* 2,048 scalars per layer   
• Test GeGLU and GAU => GAU converges faster with relatively poor performance on fine-tuned SuperGLUE   
• Abnormal GPU memory usage of newly-added functions and classes => DeepSpeed hardcodes the function names for checkpoint activation   
• Decide to train GLM with 130 billion parameters => allow inference on a DGX-A100 40G node

# . 2022.5-6

• Implement a RoPE cuda operator in C++ => See unexpected precision errors and finally have it abandoned   
• Sandwich-LN still disconverges => 1) Reducing learning rate does not help; 2) Using Hinge cross-entropy becomes slower and harms performance; 3) Shifting to DeepNorm still disconverges   
• Use FP32 in softmax of attention => Success   
• Find PB-Relax unnecessary for FP32 softmax => It also slows down training as it needs to manipulate the whole attention score matrices   
• Experience few spikes in later training => 1) Reduce gradient shrink factor from 1 to 0.1: useful; 2) Reduce the learning rate: sometimes useful; 3) Jump the noisy data batches: sometimes useful   
• Find a mistake in multi-task data after training for 20,000 steps => Use the correct data but it does not forget

# . 2022.6-7

• Adapt the pipeline parallel checkpoints to ordinary parallel checkpoints for efficient inference on a single A100   
• Work on evaluation scripts on datasets: MMLU, Big-bench, CLUE, SuperCLUE, etc.   
• Implement P-Tuning and P-Tuning v2 for parameter-efficient tuning on GLM-130B for tuning on SuperGLUE   
• Work with BMInf on adapting GLM-130B to perform inference on a single V100 or 3090 => Use pipeline-style asynchronous swapping between main memory and GPU memory   
• Try to fine-tune GLM-130B with fewer A100 nodes (i.e., 12-16 nodes) => Pipeline-style fails due to too many pipeline stages => Find that data parallel can not be introduced for fine-tuning => Use 32-way model parallel for fine-tuning with reasonable performance

https://github.com/THUDM/GLM-130B

Figure 21: The timeline of major issues that training GLM-130B encountered and addressed, as of July 31st, 2022.

faces negligible performance degradation compared to its uncompressed original, while it consumes only 25% of the GPU memory required by the uncompressed version, thus supporting its effective inference on 4 × RTX 3090 Ti (24G) or 8 × RTX 2080 Ti (11G). We will attempt to further reduce the resource requirements and keep the community updated on this important working item.

# G BROADER IMPACT

This paper introduces an open bilingual pre-trained language model with 130 billion parameters. Currently most pre-trained language models with over 100 billion parameters are privately owned by governments and large corporations (Brown et al., 2020; Thoppilan et al., 2022; Rae et al., 2021; Chowdhery et al., 2022; Wang et al., 2021). A few of them (Brown et al., 2020; Lieber et al., 2021) provide limited inference APIs with fees. In contrast, the weights and code of GLM-130B are open to anyone who is interested in LLMs. Moreover, we significantly lower the hardware requirements for inference by speed-up implementation and INT4 quantization. The paper can have a broader impact on the research community, individual developers and small companies, and society.

# G.1 IMPACT ON AI RESEARCH

Most research institutions cannot afford the substantial cost of pretraining large language models. As a result, most researchers, except employees of governments and large corporations, only have access to the limited inference APIs with fees. With the inference APIs, researchers can only analyze the outputs of models as black boxes, which limits the scope of potential work. With GLM-130B, researchers can analyze the model parameters and internal states corresponding to specific inputs, leading to in-depth studies of LLMs’ theory, capacity, and flaws. Researchers can also modify the model architecture and weights, to validate the proposed algorithms to improve LLMs Zhu et al. (2020); Cao et al. (2021); Hase et al. (2021); Mitchell et al. (2022).

With INT4 quantization, GLM-130B can perform inference on popularized GPUs such as 4 × RTX 3090 or 8 × RTX 2080 Ti, which can be easily accessed from cloud service. As a result, researchers who cannot afford powerful data-center GPU servers like DGX-A100 can also utilize GLM-130B.

# G.2 IMPACT ON INDIVIDUAL DEVELOPERS AND SMALL COMPANIES

Currently, individual developers and small companies who want to integrate LLMs into their business can only choose paid inference APIs. The increased cost can hinder their attempts. Instead, GLM-130B can be deployed on popularized hardware that they own or can access via cloud service to reduce the cost. Furthermore, they can utilize distillation techniques Sanh et al. (2019); Jiao et al. (2020) to obtain smaller models that preserve comparable performance on their specific tasks. While some developers may lack the ability to complete deployment and distillation on their own, we believe with GLM-130B and more open LLMs in the future, the corresponding toolkits and service providers will become more available.

We also note that currently most applications of LLMs are based on prompt engineering, partly due to the limitation of inference APIs. In downstream scenarios such as online customer service, the companies accumulate huge amounts of human-generated data that contain domain knowledge. With the open-source weights and code, developers can finetune GLM-130B on their own data to mitigate the gap of domain knowledge.

# G.3 SOCIAL IMPACT

Large language models, together with other machine learning models in different modalities (e.g., Image (Ramesh et al., 2021; Ding et al., 2021; Saharia et al.) and Video (Hong et al., 2022)), could be used to generate synthetic text for harmful applications, such as telemarketing fraud, political propaganda, and personal harassment as is discussed in (Weidinger et al., 2021; Sheng et al., 2021; Dev et al., 2021). We do not anticipate any hazardous outputs, especially towards vulnerable and historically disadvantaged groups of people, after using the model.

While some people think that restricting access to LLMs can prevent such harmful applications, we argue that promoting LLM inclusivity can lead to better defense against potential harm caused by

LLMs. Currently, only governments and large corporations can afford the considerable costs of pretraining LLMs. There is no guarantee that organizations having the substantial financial resources to pretrain an LLM will not do harm with it. Without access to such LLMs, individuals cannot even realize the role of LLMs in harm. Conversely, releasing an open LLM can provide access and transparency to all the researchers and promote the research to reduce the potential harm of LLMs, like algorithms to identify the synthetic text Gehrmann et al. (2019) or detect fake news Li et al. (2021).

Also, it is known that LLMs can suffer from problems in fairness, bias, privacy, and truthfulness Zhang et al. (2021); Lin et al. (2022); Liang et al. (2021); Bender et al. (2021). An open LLM can reveal the model parameters and internal states corresponding to specific inputs instead of providing APIs to black-box models. In conclusion, researchers can conduct analysis of LLMs’ flaws in depth and propose improved algorithms to solve the problems.

# H ENVIRONMENTAL IMPACT

One of the major concerns about large language models is their huge energy usage and associated carbon emissions Strubell et al. (2019); Lacoste et al. (2019); Patterson et al. (2021); Bender et al. (2021). GPT-3 was estimated to use 500 tons of carbon emissions footprint (CO2eq) Patterson et al. (2021). We consumed a total of 442.4MWh of electricity over the 60-day course of training. Given the 0.5810 kg/kWh carbon efficiency of local power grid, the pre-training released 257.01 metric tons of $\mathrm { C O _ { 2 } } .$ This is around half of GPT-3’s carbon footprint, probably due to the efficient parallel strategies and NVIDIA’s hardware improvements. The carbon emission is roughly the equivalent of the yearly emissions of 18 average Americans. However, we believe that with GLM-130B released, more carbon emissions for reproducing 100B-scale LLMs can be saved.