---
title: "04 · GLM-130B Technical Report - Segment-by-Segment Translation with Translator's Notes"
source: 03-GLM-130B-mineru-en.md
model: GLM-130B
---

## Abstract

>  **[返回 14.6-GLM 家族总览](../../14.6-GLM.md)**

### 摘要

We introduce GLM-130B, a bilingual (English and Chinese) pre-trained language model with 130 billion parameters. It is an attempt to open-source a 100B-scale model at least as good as GPT-3 (davinci) and unveil how models of such a scale can be successfully pre-trained. Over the course of this effort, we face numerous unexpected technical and engineering challenges, particularly on loss spikes and divergence. In this paper, we introduce the training process of GLM-130B including its design choices, training strategies for both efficiency and stability, and engineering efforts. The resultant GLM-130B model offers significant outperformance over GPT-3 175B (davinci) on a wide range of popular English benchmarks while the performance advantage is not observed in OPT-175B and BLOOM-176B. It also consistently and significantly outperforms ERNIE TITAN 3.0 260B -- the largest Chinese language model -- across related benchmarks. Finally, we leverage a unique scaling property of GLM-130B to reach INT4 quantization without post training, with almost no performance loss, making it the first among 100B-scale models and more importantly, allowing its effective inference on 4xRTX 3090 (24G) or 8xRTX 2080 Ti (11G) GPUs, the most affordable GPUs required for using 100B-scale models. The GLM-130B model weights are publicly accessible and its code, training logs, related toolkit, and lessons learned are open-sourced at https://github.com/THUDM/GLM-130B/.

我们推出 GLM-130B,一个双语(英文和中文)预训练语言模型,拥有 1300 亿参数。这是一次开源 100B 规模模型的尝试,目标是至少达到 GPT-3 (davinci) 的水平,并揭示如此规模的模型如何成功预训练。在这一过程中,我们面临众多意想不到的技术和工程挑战,特别是损失尖峰和发散问题。在本文中,我们介绍了 GLM-130B 的训练过程,包括其设计选择、效率和稳定性训练策略以及工程努力。最终得到的 GLM-130B 模型在广泛的流行英语基准上显著优于 GPT-3 175B (davinci),而这种性能优势在 OPT-175B 和 BLOOM-176B 中并未观察到。它还在相关基准上一致且显著地超越 ERNIE TITAN 3.0 260B -- 最大的中文语言模型。最后,我们利用 GLM-130B 独特的缩放特性,实现了无需后训练的 INT4 量化,且几乎没有性能损失,使其成为 100B 规模模型中的首个,更重要的是,允许其在 4xRTX 3090 (24G) 或 8xRTX 2080 Ti (11G) GPU 上进行有效推理 -- 这是使用 100B 规模模型所需的最实惠 GPU。GLM-130B 模型权重公开可访问,其代码、训练日志、相关工具包和经验教训已在 https://github.com/THUDM/GLM-130B/ 开源。

> 译者注(设计动机): GLM-130B 是 2022-2023 年间开源大模型浪潮的标志性工作。1) 当时 GPT-3 175B 是闭源的,OPT-175B 和 BLOOM-176B 虽然开源但性能不及 GPT-3,GLM-130B 首次证明了开源 100B+ 模型可以超越 GPT-3;2) INT4 量化是本文的一个重要工程贡献: 100B 模型的 FP16 推理需要约 260GB 显存,而 INT4 仅需 65GB,这使消费级 GPU(如 RTX 3090)也能运行,极大地降低了研究门槛;3) 论文发表于 ICLR 2023,是少数以 100B+ 模型训练经验为核心贡献的顶会论文,其"训练稳定性"和"工程实践"的分享价值不亚于模型本身。

## 1 INTRODUCTION
### 引言

Large language models (LLMs), particularly those with over 100 billion (100B) parameters (Brown et al., 2020; Thoppilan et al., 2022; Rae et al., 2021; Chowdhery et al., 2022; Wang et al., 2021), have presented attractive scaling laws (Wei et al., 2022b), where emergent zero-shot and few-shot capabilities suddenly arose. Among them, GPT-3 (Brown et al., 2020) with 175B parameters pioneers the study of 100B-scale LLMs by strikingly generating better performance with 32 labeled examples than the fully-supervised BERT-Large model on a variety of benchmarks. However, both GPT-3 (and many other closed-sourced 100B-scale ones) -- the model itself -- and how it can be trained, have been thus far intransparent to the public. It is of critical value to train a high-quality LLM of such scale with both the model and training process shared with everyone.

大语言模型(LLM),特别是那些拥有超过 1000 亿(100B)参数的模型(Brown et al., 2020; Thoppilan et al., 2022; Rae et al., 2021; Chowdhery et al., 2022; Wang et al., 2021),展示了诱人的缩放定律(Wei et al., 2022b),其中涌现的零样本和少样本能力突然出现。其中,GPT-3 (Brown et al., 2020) 以 175B 参数开创了 100B 规模 LLM 的研究,通过仅 32 个标注样本就在多种基准上取得了比全监督 BERT-Large 模型更好的性能。然而,GPT-3(以及许多其他闭源 100B 规模模型) -- 模型本身以及它是如何训练的 -- 至今对公众不透明。训练如此规模的高质量 LLM 并与所有人共享模型和训练过程具有关键价值。

We thus aim to pre-train an open and highly-accurate 100B-scale model with ethical concerns in mind. Over the course of our attempt, we have come to realize that pre-training a dense LLM at such a scale raises numerous unexpected technical and engineering challenges compared to training 10B-scale models, in terms of pre-training efficiency, stability, and convergence. Similar difficulties have also been concurrently observed in training OPT-175B (Zhang et al., 2022) and BLOOM-176B (Scao et al., 2022), further demonstrating the significance of GPT-3 as a pioneer study.

因此,我们的目标是在考虑伦理问题的前提下预训练一个开放且高精度的 100B 规模模型。在我们的尝试过程中,我们逐渐意识到,与训练 10B 规模模型相比,在如此规模上预训练密集 LLM 在预训练效率、稳定性和收敛性方面带来了众多意想不到的技术和工程挑战。类似的困难在训练 OPT-175B (Zhang et al., 2022) 和 BLOOM-176B (Scao et al., 2022) 时也被同时观察到,进一步证明了 GPT-3 作为先驱研究的重要性。

> 译者注(技术谱系): GLM-130B 的出现处于大模型开源史上的关键节点。1) 2020 年 GPT-3 证明了 100B+ 模型的涌现能力,但闭源;2) 2022 年 Meta 推出 OPT-175B、HuggingFace 推出 BLOOM-176B,首次开源了 100B+ 模型,但两者在性能上都未能追上 GPT-3;3) GLM-130B (2022) 是第三个开源 100B+ 模型,也是第一个在性能上超越 GPT-3 的开源模型;4) 值得注意的是,GLM-130B 选择了与 GPT 不同的架构路线 -- GLM (General Language Model) 而非 GPT 的 decoder-only autoregressive,这在当时是一个大胆的选择。

## 2 THE DESIGN CHOICES OF GLM-130B
### GLM-130B 的设计选择

The architecture of a machine learning model defines its inductive bias. However, it has been realized that it is computationally unaffordable to explore various architectural designs for LLMs. We introduce and explain the unique design choices of GLM-130B.

机器学习模型的架构定义了其归纳偏置。然而,人们已经认识到,为 LLM 探索各种架构设计在计算上是不可承受的。我们介绍并解释 GLM-130B 的独特设计选择。

### 2.1 GLM-130B'S ARCHITECTURE
#### GLM-130B 的架构

**GLM as Backbone.** Most recent 100B-scale LLMs, such as GPT-3, PaLM, OPT, and BLOOM, follow the traditional GPT-style (Radford et al., 2019) architecture of decoder-only autoregressive language modeling. In GLM-130B, we instead make an attempt to explore the potential of a bidirectional GLM -- General Language Model (Du et al., 2022) -- as its backbone.

**GLM 作为主干。** 大多数近期的 100B 规模 LLM,如 GPT-3、PaLM、OPT 和 BLOOM,遵循传统的 GPT 风格(Radford et al., 2019)decoder-only 自回归语言建模架构。在 GLM-130B 中,我们转而尝试探索双向 GLM -- General Language Model (Du et al., 2022) -- 作为其主干的潜力。

GLM is a transformer-based language model that leverages autoregressive blank infilling as its training objective. Briefly, for a text sequence $x = [x_1, \cdots, x_n]$, text spans $\{s_1, \cdots, s_m\}$ are sampled from it, each of which $s_i$ denotes a span of consecutive tokens $[s_{i,1}, \cdots, s_{i,l_i}]$ and is replaced (i.e., corrupted) with a single mask token to form $x_{corrupt}$. The model is asked to recover them autoregressively. To allow interactions between corrupted spans, their visibility to each other is decided by a randomly sampled permutation on their order.

GLM 是一种基于 Transformer 的语言模型,利用自回归空白填充作为其训练目标。简而言之,对于文本序列 $x = [x_1, \cdots, x_n]$,从中采样文本片段 $\{s_1, \cdots, s_m\}$,每个 $s_i$ 表示一段连续 token $[s_{i,1}, \cdots, s_{i,l_i}]$,并用单个掩码 token 替换(即损坏)以形成 $x_{corrupt}$。模型被要求自回归地恢复它们。为允许损坏片段之间的交互,它们之间的可见性由随机采样的排列顺序决定。

GLM's bidirectional attention over unmasked (i.e., uncorrupted) contexts distinguishes GLM-130B from GPT-style LLMs in which the unidirectional attention is used. To support both understanding and generation, it mixes two corruption objectives, each indicated by a special mask token:

- [MASK]: short blanks in sentences whose lengths add up to a certain portion of the input.
- [gMASK]: random-length long blanks at the end of sentences with prefix contexts provided.

GLM 在未掩码(即未损坏)上下文上的双向注意力使 GLM-130B 有别于使用单向注意力的 GPT 风格 LLM。为同时支持理解和生成,它混合了两种损坏目标,每种由特殊掩码 token 指示:

- [MASK]: 句子中的短空白,其长度加起来占输入的一定比例。
- [gMASK]: 句子末尾的随机长度长空白,提供前缀上下文。

> 译者注(设计动机): GLM 的"自回归空白填充"目标是一个介于 BERT 的掩码语言建模和 GPT 的自回归语言建模之间的混合体。1) [MASK] 对应 BERT 风格的理解任务: 模型看到双向上下文,预测被掩码的短片段;2) [gMASK] 对应 GPT 风格的生成任务: 模型看到前缀,自回归地生成后续内容;3) 这种统一框架的优势是: 同一个模型既能做理解(如分类、抽取)又能做生成(如翻译、摘要),无需为不同任务训练不同模型;4) 但代价是训练复杂度更高: 需要为不同的掩码策略采样不同的数据分布,且推理时的注意力模式需要根据任务切换。

**Layer Normalization (LN, Ba et al. (2016)).** Training instability is one major challenge for training LLMs (Zhang et al., 2022; Scao et al., 2022; Chowdhery et al., 2022). A proper choice of LNs can help stabilize the training of LLMs. We experiment with existing practices, e.g., Pre-LN (Xiong et al., 2020), Post-LN (Ba et al., 2016), Sandwich-LN (Ding et al., 2021), which are unfortunately incapable of stabilizing our GLM-130B test runs.

**层归一化(LN, Ba et al. (2016))。** 训练不稳定性是训练 LLM 的主要挑战之一(Zhang et al., 2022; Scao et al., 2022; Chowdhery et al., 2022)。适当的 LN 选择可以帮助稳定 LLM 的训练。我们尝试了现有实践,如 Pre-LN (Xiong et al., 2020)、Post-LN (Ba et al., 2016)、Sandwich-LN (Ding et al., 2021),但遗憾的是它们都无法稳定我们的 GLM-130B 测试运行。

Our search is later focused on Post-LN due to its favorable downstream results in preliminary experiments though it does not stabilize GLM-130B. Fortunately, one of the attempts on Post-LN initialized with the newly-proposed DeepNorm (Wang et al., 2022b) generates promising training stability. Specifically, given the number of GLM-130B's layers $N$, we adopt $\text{DeepNorm}(x) = \text{LayerNorm}(\alpha \cdot x + \text{Network}(x))$, where $\alpha = (2N)^{\frac{1}{2}}$, and apply the Xavier normal initialization with the scaling factor of $(2N)^{-\frac{1}{2}}$ to ffn, v_proj and out_proj. Additionally, all bias terms are initialized to zero.

我们后来将搜索集中在 Post-LN 上,因为它在初步实验中展现出有利的下游结果,尽管它本身不能稳定 GLM-130B。幸运的是,用新提出的 DeepNorm (Wang et al., 2022b) 初始化的一次 Post-LN 尝试产生了有前景的训练稳定性。具体而言,给定 GLM-130B 的层数 $N$,我们采用 $\text{DeepNorm}(x) = \text{LayerNorm}(\alpha \cdot x + \text{Network}(x))$,其中 $\alpha = (2N)^{\frac{1}{2}}$,并对 ffn、v_proj 和 out_proj 应用缩放因子为 $(2N)^{-\frac{1}{2}}$ 的 Xavier 正态初始化。此外,所有偏置项初始化为零。

> 译者注(工程细节): DeepNorm 是本文的一个关键技术点。1) 在 100B+ 模型训练中,Pre-LN 因其训练稳定性而被广泛采用(如 GPT-3、OPT),但 Post-LN 通常有更好的下游性能;2) DeepNorm 是一种" Post-LN 变体",通过特殊的初始化缩放($\alpha = \sqrt{2N}$)和 Xavier 缩放因子($1/\sqrt{2N}$)来抑制梯度爆炸,从而使 Post-LN 也能稳定训练;3) 对于 GLM-130B (N=70 层),$\alpha = \sqrt{140} \approx 11.8$,这意味着残差连接的权重被显著放大,有助于梯度流动;4) 这一选择后来被多个后续模型验证: 尽管 Pre-LN 在训练稳定性上更可靠,但 Post-LN/DeepNorm 在最终性能上的优势使其成为大模型的主流选择(如 LLaMA-2/3 也采用了类似的策略)。

**Positional Encoding and FFNs.** We empirically test different options for positional encoding (PE) and FFN improvements in terms of both training stability and downstream performance. For PEs in GLM-130B, we adopt Rotary Positional Encoding (RoPE, Su et al. (2021)) rather than ALiBi (Press et al., 2021). To improve FFNs in Transformer, we pick GLU with the GeLU (Hendrycks & Gimpel, 2016) activation as the replacement.

**位置编码和 FFN。** 我们在训练稳定性和下游性能方面经验性地测试了位置编码(PE)和 FFN 改进的不同选项。对于 GLM-130B 中的 PE,我们采用旋转位置编码(RoPE, Su et al. (2021)) 而非 ALiBi (Press et al., 2021)。为改进 Transformer 中的 FFN,我们选择使用 GeLU (Hendrycks & Gimpel, 2016) 激活的 GLU 作为替代。

> 译者注(技术谱系): RoPE + GLU-GeLU 的组合在 2022 年是一个前沿选择。1) RoPE 通过旋转矩阵编码位置信息,相比绝对位置编码具有更好的外推性(extrapolation),这对于长文本任务至关重要;2) GLU (Gated Linear Unit) 变体在后续成为大模型的标配: PaLM 使用 SwiGLU,LLaMA 使用 SwiGLU,而 GLM-130B 使用的是早期的 GLU-GeLU;3) 论文附录中对 PE 和 FFN 选择做了详细的消融实验,这是当时少有的对 100B+ 模型架构组件进行系统比较的公开工作。


### 2.2 GLM-130B'S PRE-TRAINING SETUP
#### GLM-130B 的预训练设置

Inspired by recent works (Aribandi et al., 2022; Wei et al., 2022a; Sanh et al., 2022), the GLM-130B pre-training objective includes not only the self-supervised GLM autoregressive blank infilling but also multi-task learning for a small portion of tokens. This is expected to help boost its downstream zero-shot performance.

受近期工作启发(Aribandi et al., 2022; Wei et al., 2022a; Sanh et al., 2022),GLM-130B 的预训练目标不仅包括自监督 GLM 自回归空白填充,还包括对一小部分 token 的多任务学习。这有望帮助提升其下游零样本性能。

**Self-Supervised Blank Infilling (95% tokens).** Recall that GLM-130B uses both [MASK] and [gMASK] for this task. Each training sequence is applied with one of them independently at a time. Specifically, [MASK] is used to mask consecutive spans in 30% of training sequences for blank infilling. The lengths of spans follow a Poisson distribution ($\lambda = 3$) and add up to 15% of the input. For the other 70% sequences, the prefix of each sequence is kept as context and [gMASK] is used to mask the rest of it. The masked length is sampled from the Uniform distribution.

**自监督空白填充(95% token)。**  recall GLM-130B 使用 [MASK] 和 [gMASK] 执行此任务。每个训练序列一次独立应用其中之一。具体而言,[MASK] 用于在 30% 的训练序列中掩码连续片段以进行空白填充。片段长度服从泊松分布($\lambda = 3$),加起来占输入的 15%。对于其余 70% 的序列,每个序列的前缀保留为上下文,[gMASK] 用于掩码其余部分。掩码长度从均匀分布中采样。

The pre-training data includes 1.2T Pile (train split) (Gao et al., 2020) English, 1.0T Chinese Wudao-Corpora (Yuan et al., 2021), and 250G Chinese corpora (including online forums, encyclopedia, and QA) we crawl from the web, which form a balanced composition of English and Chinese contents.

预训练数据包括 1.2T Pile (训练集)(Gao et al., 2020) 英语、1.0T 中文悟道语料库(Yuan et al., 2021)和我们从网络爬取的 250G 中文语料(包括在线论坛、百科和问答),形成了中英文内容的均衡组合。

**Multi-Task Instruction Pre-Training (MIP, 5% tokens).** T5 (Raffel et al., 2020) and ExT5 (Aribandi et al., 2022) suggest that multi-task learning in pre-training can be more helpful than fine-tuning, we thus propose to include a variety of instruction prompted datasets including language understanding, generation, and information extraction in GLM-130B's pre-training. Compared to recent works (Wei et al., 2022a; Sanh et al., 2022) that leverage multi-task prompted fine-tuning to improve zero-shot task transfer, MIP only accounts for 5% tokens and is set in the pre-training stage to prevent spoiling LLMs' other general ability, e.g., unconditional free generation.

**多任务指令预训练(MIP, 5% token)。** T5 (Raffel et al., 2020) 和 ExT5 (Aribandi et al., 2022) 表明,预训练中的多任务学习可能比微调更有帮助,因此我们提出在 GLM-130B 的预训练中包含各种指令提示数据集,包括语言理解、生成和信息提取。与近期利用多任务提示微调来改善零样本任务迁移的工作(Wei et al., 2022a; Sanh et al., 2022)相比,MIP 仅占 5% 的 token,且设置在预训练阶段以防止破坏 LLM 的其他通用能力,如无条件自由生成。

> 译者注(设计动机): MIP 是 GLM-130B 中一个前瞻性的设计。1) 在 2022 年,指令微调(Instruction Tuning)还未成为 LLM 训练的标配(Flan-T5 和 InstructGPT 是早期工作),GLM-130B 在预训练阶段就引入指令数据是一个大胆的尝试;2) 仅 5% 的比例是一个精心设计的权衡: 太少则无法有效学习指令遵循,太多则会"污染"模型的无条件生成能力(模型可能总是期待指令格式);3) 这一设计与后来的"预训练 + SFT + RLHF"三阶段范式有共通之处: MIP 相当于在预训练阶段就注入了部分"指令意识",减少了后续对齐阶段的工作量。

### 2.3 PLATFORM-AWARE PARALLEL STRATEGIES AND MODEL CONFIGURATIONS
#### 平台感知并行策略与模型配置

GLM-130B is trained on a cluster of 96 DGX-A100 GPU (8x40G) servers with a 60-day access. The goal is to pass through as many tokens as possible, as a recent study (Hoffmann et al., 2022) suggests that most existing LLMs are largely under-trained.

GLM-130B 在 96 台 DGX-A100 GPU (8x40G) 服务器集群上训练,使用期限为 60 天。目标是处理尽可能多的 token,因为近期研究(Hoffmann et al., 2022)表明大多数现有 LLM 很大程度上训练不足。

**The 3D Parallel Strategy.** The data parallelism (Valiant, 1990) and tensor model parallelism (Shoeybi et al., 2019) are the de facto practices for training billion-scale models (Wang & Komatsuzaki, 2021; Du et al., 2022). To further handle the huge GPU memory requirement and the decrease in overall GPU utilization resulted from applying tensor parallel between nodes -- as 40G rather than 80G A100s are used for training GLM-130B, we combine the pipeline model parallelism with the other two strategies to form a 3D parallel strategy.

**3D 并行策略。** 数据并行(Valiant, 1990)和张量模型并行(Shoeybi et al., 2019)是训练十亿规模模型的事实标准做法(Wang & Komatsuzaki, 2021; Du et al., 2022)。为进一步处理巨大的 GPU 内存需求以及跨节点应用张量并行导致的整体 GPU 利用率下降 -- 由于 GLM-130B 训练使用的是 40G 而非 80G A100,我们将流水线模型并行与另外两种策略结合,形成 3D 并行策略。

The pipeline parallelism divides the model into sequential stages for each parallel group, and to further minimize bubbles introduced by pipeline, we leverage the PipeDream-Flush (Narayanan et al., 2021) implementation from DeepSpeed (Rasley et al., 2020) to train GLM-130B with a relative big global batch size (4,224) to reduce time and GPU memory wasting. Through both numerical and empirical examinations, we adopt 4-way tensor parallelism and 8-way pipeline parallelism. Following the calculation in (Chowdhery et al., 2022), we report hardware FLOPs utilization (HFU) of 43.3% and model FLOPs utilization (MFU) of 32.5% due to re-materialization.

流水线并行将模型划分为每个并行组的顺序阶段,为进一步最小化流水线引入的气泡,我们利用 DeepSpeed (Rasley et al., 2020) 的 PipeDream-Flush (Narayanan et al., 2021) 实现来训练 GLM-130B,使用相对较大的全局 batch size (4224) 以减少时间和 GPU 内存浪费。通过数值和经验检验,我们采用 4 路张量并行和 8 路流水线并行。按照 (Chowdhery et al., 2022) 中的计算,我们报告硬件 FLOPs 利用率(HFU)为 43.3%,模型 FLOPs 利用率(MFU)为 32.5%(由于重物化)。

> 译者注(工程细节): 3D 并行(数据并行 + 张量并行 + 流水线并行)是 100B+ 模型训练的工程基础。1) 4-way TP x 8-way PP x 3-way DP = 96 台服务器 x 8 GPU = 768 张 A100,这与训练集群规模完全匹配;2) MFU 32.5% 在 2022 年是一个不错的结果(OPT-175B 约 30%,GPT-3 未公开),但相比 2024 年的标准(DeepSeek-V3 达到 50%+)仍有差距;3) "平台感知"体现在: 由于使用 40G A100 而非 80G,内存更紧张,因此需要更精细的并行策略来平衡内存和计算;4) PipeDream-Flush 是一种"同步流水线"调度,相比异步调度(如 PipeDream-1F1B)更简单但气泡更大,这里选择 Flush 可能是为了稳定性优先。

**GLM-130B Configurations.** We aim to enable our 100B-scale LLM to run a single DGX-A100 (40G) node in FP16 precision. Based on the hidden state dimension of 12,288 we adopt from GPT-3, the resultant model size has to be no more than 130B parameters, thus GLM-130B. To maximize GPU utilization, we configure the model based on the platform and its corresponding parallel strategy. To avoid insufficient memory utilization in the middle stages due to the additional word embedding at both ends, we balance the pipeline partition by removing one layer from them, making 9x8-2=70 transformer layers in GLM-130B.

**GLM-130B 配置。** 我们的目标是使我们的 100B 规模 LLM 能够在单个 DGX-A100 (40G) 节点上以 FP16 精度运行。基于我们从 GPT-3 采用的 12,288 隐藏状态维度,结果模型大小必须不超过 130B 参数,因此得名 GLM-130B。为最大化 GPU 利用率,我们基于平台及其对应的并行策略配置模型。为避免两端额外词嵌入导致中间阶段内存利用不足,我们通过从它们各移除一层来平衡流水线分区,使 GLM-130B 具有 9x8-2=70 个 Transformer 层。

During the 60-day access to the cluster, we manage to train GLM-130B for 400 billion tokens (roughly 200 billion each for Chinese and English) with a fixed sequence length of 2,048 per sample. For the [gMASK] training objective, we use a context window of 2,048 tokens. For the [MASK] and multi-task objectives, we use a context window of 512 and concatenate four samples together to cater the 2,048-sequence-length. We warm-up the batch size from 192 to 4224 over the first 2.5% samples. We use AdamW (Loshchilov & Hutter, 2019) as our optimizer with $\beta_1$ and $\beta_2$ set to 0.9 and 0.95, and a weight decay value of 0.1. We warm up the learning rate from $10^{-7}$ to $8 \times 10^{-5}$ over the first 0.5% samples, then decay it by a 10x cosine schedule. We use a dropout rate of 0.1 and clip gradients using a clipping value of 1.0.

在 60 天的集群使用期内,我们成功将 GLM-130B 训练了 4000 亿 token(中英文各约 2000 亿),每个样本的固定序列长度为 2048。对于 [gMASK] 训练目标,我们使用 2048 token 的上下文窗口。对于 [MASK] 和多任务目标,我们使用 512 的上下文窗口并将四个样本拼接在一起以满足 2048 序列长度。我们在前 2.5% 的样本上将 batch size 从 192 预热到 4224。我们使用 AdamW (Loshchilov & Hutter, 2019) 作为优化器,$\beta_1$ 和 $\beta_2$ 设为 0.9 和 0.95,权重衰减值为 0.1。我们在前 0.5% 的样本上将学习率从 $10^{-7}$ 预热到 $8 \times 10^{-5}$,然后通过 10 倍余弦调度衰减。我们使用 0.1 的 dropout 率,并使用裁剪值 1.0 进行梯度裁剪。

## 3 THE TRAINING STABILITY OF GLM-130B
### GLM-130B 的训练稳定性

The training stability is the decisive factor in GLM-130B's quality, which is also largely impacted by the number of tokens it passes through (Hoffmann et al., 2022). Thus, given the computing usage constraint, there has to be a trade-off between efficiency and stability with regard to floating-point (FP) formats: low-precision FP formats (e.g., 16-bit precision -- FP16) improve computing efficiency but are prone to overflow and underflow errors, resulting in training collapses.

训练稳定性是 GLM-130B 质量的决定性因素,它也很大程度上受其处理 token 数量的影响(Hoffmann et al., 2022)。因此,鉴于计算使用限制,在浮点(FP)格式方面必须在效率和稳定性之间进行权衡: 低精度 FP 格式(如 16 位精度 -- FP16)提高计算效率但容易发生溢出和下溢错误,导致训练崩溃。

**Mixed-Precision.** We follow the common practice of a mixed-precision (Micikevicius et al., 2018) strategy (Apex O2), i.e., FP16 for forwards and backwards and FP32 for optimizer states and master weights, to reduce the GPU memory usage and improve training efficiency. Similar to OPT-175B and BLOOM-176B, the training of GLM-130B faces frequent loss spikes resulted from this choice, which tends to become increasingly frequent as the training goes on. The precision related spikes are often without clear reasons: some recover on their own; others come with a portent of suddenly soaring gradient norm and eventually a spike or even NaN in loss.

**混合精度。** 我们遵循混合精度(Micikevicius et al., 2018)策略(Apex O2)的通用做法,即前向和反向使用 FP16,优化器状态和主权重使用 FP32,以减少 GPU 内存使用并提高训练效率。与 OPT-175B 和 BLOOM-176B 类似,GLM-130B 的训练面临由这一选择导致的频繁损失尖峰,随着训练进行,这些尖峰倾向于变得越来越频繁。与精度相关的尖峰往往没有明确原因: 有些自行恢复; 另一些伴随着梯度范数突然飙升的预兆,最终导致损失尖峰甚至 NaN。

OPT-175B attempted to fix by manually skipping data and adjusting hyper-parameters; BLOOM-176B did so via the embedding norm technique (Dettmers et al., 2021). We spent months to empirically investigate the spikes and realize that a few issues emerge when transformers scale up:

OPT-175B 尝试通过手动跳过数据和调整超参数来修复; BLOOM-176B 通过嵌入归一化技术(Dettmers et al., 2021)来修复。我们花费数月时间经验性地调查这些尖峰,并意识到当 Transformer 扩大规模时会出现几个问题:

First, the transformer main branch's value scale can be extremely large in deeper layers if using Pre-LN. This is addressed in GLM-130B by using DeepNorm based Post-LN (Cf. Section 2.1), which makes the value scale always bounded.

首先,如果使用 Pre-LN,Transformer 主分支的值尺度在较深层可能非常大。GLM-130B 通过使用基于 DeepNorm 的 Post-LN(见第 2.1 节)解决了这一问题,使值尺度始终有界。

Second, the attention scores grow so large that they exceed FP16's range, as the model scales up.

其次,随着模型规模扩大,注意力分数变得如此之大,以至于超出 FP16 的范围。

**Embedding Layer Gradient Shrink (EGS).** Our empirical search identifies that the gradient norm can serve as an informative indicator of training collapses. Specifically, we find that a training collapse usually lags behind a "spike" in gradient norm by a few training steps. Such spikes are usually caused by the embedding layer's abnormal gradients, as we observe that its gradient norm is often several magnitude larger that those of other layers in GLM-130B's early stage training. In addition, it tends to fluctuate dramatically in the early training.

**嵌入层梯度收缩(EGS)。** 我们的经验搜索发现梯度范数可以作为训练崩溃的信息性指标。具体而言,我们发现训练崩溃通常滞后于梯度范数的"尖峰"几个训练步骤。这种尖峰通常由嵌入层的异常梯度引起,因为我们观察到在 GLM-130B 早期训练阶段,其梯度范数通常比其他层大几个数量级。此外,它在早期训练中倾向于剧烈波动。

Finally, we find the gradient shrink on embedding layers could overcome loss spikes and thus stabilize GLM-130B's training. It is first used in the multi-modal transformer CogView (Ding et al., 2021). Let $\alpha$ be the shrinking factor, the strategy can be easily implemented via $\text{word\_embedding} = \text{word\_embedding} * \alpha + \text{word\_embedding.detach()} * (1 - \alpha)$. Figure 4 (b) suggests that empirically, setting $\alpha = 0.1$ wipes out most spikes we would have met, with negligible latency.

最终,我们发现嵌入层上的梯度收缩可以克服损失尖峰从而稳定 GLM-130B 的训练。它首次在多模态 Transformer CogView (Ding et al., 2021) 中使用。令 $\alpha$ 为收缩因子,该策略可以通过 $\text{word\_embedding} = \text{word\_embedding} * \alpha + \text{word\_embedding.detach()} * (1 - \alpha)$ 轻松实现。图 4(b) 表明,经验上设置 $\alpha = 0.1$ 可以消除我们遇到的大多数尖峰,且延迟可忽略不计。

In fact, the final GLM-130B training run only experiences three late-stage loss divergence cases, though it fails numerous times due to hardware failures. For the three unexpected spikes, it turns out further shrinking the embedding gradient can still help stabilize the GLM-130B training.

事实上,最终的 GLM-130B 训练运行仅经历了三次后期损失发散案例,尽管由于硬件故障失败了许多次。对于三次意外的尖峰,进一步缩小嵌入梯度仍然有助于稳定 GLM-130B 训练。

> 译者注(工程细节): EGS 是本文解决训练稳定性问题的核心技巧之一。1) 公式中的 `.detach()` 是关键: 它切断了梯度回传,使得嵌入层只接收缩小的梯度($\alpha = 0.1$ 意味着梯度缩小为原来的 10%),而其他层正常回传;2) 这一发现的经验基础是"嵌入层梯度范数比其他层大几个数量级" -- 这可能是因为嵌入层连接输入和模型主干,任何输入分布的异常都会首先在这里放大;3) 有趣的是,BLOOM-176B 选择了 BF16 来解决类似问题,而 GLM-130B 坚持使用 FP16 + EGS,原因是 BF16 不支持 V100 等平台且内存开销更大;4) 这一经验为后续模型提供了重要参考: 在 100B+ 模型训练中,嵌入层的梯度管理是稳定性的关键瓶颈之一。

## 4 GLM-130B INFERENCE ON RTX 2080 TI
### GLM-130B 在 RTX 2080 TI 上的推理

One of the major goals of GLM-130B is to lower the hardware requirements for accessing 100B-scale LLMs without efficiency and effectiveness disadvantages. As mentioned, the model size of 130B is determined for running the full GLM-130B model on a single A100 (40Gx8) server, rather than the high-end A100 (80Gx8) machine required by OPT-175B and BLOOM-176B. To accelerate GLM-130B inference, we also leverage FasterTransformer (Timonin et al., 2022) to implement GLM-130B in C++. Compared to the PyTorch implementation of BLOOM-176B in Huggingface, GLM-130B's decoding inference is 7-8.4x faster on the same single A100 server.

GLM-130B 的主要目标之一是降低访问 100B 规模 LLM 的硬件要求,同时不牺牲效率和效果。如前所述,130B 的模型大小是为了在单个 A100 (40Gx8) 服务器上运行完整的 GLM-130B 模型,而非 OPT-175B 和 BLOOM-176B 所需的高端 A100 (80Gx8) 机器。为加速 GLM-130B 推理,我们还利用 FasterTransformer (Timonin et al., 2022) 以 C++ 实现 GLM-130B。与 Huggingface 中 BLOOM-176B 的 PyTorch 实现相比,GLM-130B 的解码推理在相同的单台 A100 服务器上快 7-8.4 倍。

**INT4 Quantization for RTX 3090s/2080s.** To further support popularized GPUs, we attempt to compress GLM-130B as much as possible while maintaining performance superiority, particularly via quantization (Zafrir et al., 2019; Shen et al., 2020; Tao et al., 2022), which introduces little task-agnostic performance drops for generative language models.

**RTX 3090/2080 的 INT4 量化。** 为进一步支持普及型 GPU,我们尝试在保持性能优势的同时尽可能压缩 GLM-130B,特别是通过量化(Zafrir et al., 2019; Shen et al., 2020; Tao et al., 2022),这对生成式语言模型引入的与任务无关的性能下降很小。

Typically, the practice is to quantize both model weights and activations to INT8. However, our analysis suggests that LLMs' activations may contain extreme outliers. Concurrently, the emergent outliers in OPT-175B and BLOOM-176B are also discovered (Dettmers et al., 2022), which influence only about 0.1% feature dimensions and are thus solved by matrix multiplication decomposition for the outlying dimensions. Differently, there exist about 30% outliers in GLM-130B's activations, making the technique above far less efficient. Thus, we decide to focus on the quantization of model weights (i.e., mostly linear layers) while keeping the FP16 precision for activations.

通常的做法是将模型权重和激活都量化到 INT8。然而,我们的分析表明 LLM 的激活可能包含极端异常值。同时,OPT-175B 和 BLOOM-176B 中也发现了新出现的异常值(Dettmers et al., 2022),它们仅影响约 0.1% 的特征维度,因此通过对异常维度进行矩阵乘法分解来解决。不同的是,GLM-130B 的激活中约有 30% 的异常值,使上述技术效率低得多。因此,我们决定专注于模型权重(即主要是线性层)的量化,同时保持激活的 FP16 精度。

**Table 2: Left: Quantized GLM-130B's performance on several benchmarks; Right: INT4 quantized GLM-130B's inference speed with FasterTransformer.**

**表 2: 左: 量化 GLM-130B 在几个基准上的性能; 右: INT4 量化 GLM-130B 使用 FasterTransformer 的推理速度。**

| Model | MMLU (acc, uparrow) | LAMBADA (acc, uparrow) | Pile (BPB, downarrow) |
|-------|---------------------|------------------------|----------------------|
| GLM-130B FP16 | 44.75 | 80.21 | 0.634 |
| GLM-130B INT8 | 44.71 | 80.21 | 0.638 |
| GLM-130B INT4 | 44.80 | 79.47 | 0.641 |
| GPT-3 FP16 | 43.9 | 76.2 | 0.74 |
| GPU Type | 128 Enc./De.

| 512 Enc./Dec. |
|----------|--------------|--------------|
| 8 x A100 (40G) | 0.15s / 4.29s | 0.18s / 17.7s |
| 8 x V100 (32G) | 0.31s / 6.97s | 0.67s / 28.1s |
| 4 x RTX 3090 (24G) | 0.37s / 8.16s | 1.30s / 32.3s |
| 8 x RTX 2080 Ti (11G) | 0.39s / 6.77s | 1.04s / 27.3s |

Excitingly, we manage to reach the INT4 weight quantization for GLM-130B while existing successes have thus far only come to the INT8. Memory-wise, by comparing to INT8, the INT4 version helps additionally save half of the required GPU memory to 70GB, thus allowing GLM-130B inference on 4 x RTX 3090 Ti (24G) or 8 x RTX 2080 Ti (11G). Performance-wise, Table 2 left indicates that without post-training at all, the INT4-version GLM-130B experiences almost no performance degradation, thus maintaining the performance advantages over GPT-3 on common benchmarks.

令人兴奋的是,我们成功实现了 GLM-130B 的 INT4 权重量化,而现有成功此前仅达到 INT8。内存方面,与 INT8 相比,INT4 版本额外节省了一半所需的 GPU 内存至 70GB,从而允许在 4 x RTX 3090 Ti (24G) 或 8 x RTX 2080 Ti (11G) 上进行 GLM-130B 推理。性能方面,表 2 左表明,完全无需后训练,INT4 版本 GLM-130B 几乎没有性能下降,从而在常见基准上保持了对 GPT-3 的性能优势。

**GLM's INT4 Weight Quantization Scaling Law.** We examine the underlying mechanism of this unique INT4 weight quantization scaling law. We plot the weight value distributions, which turns out to directly impact the quantization quality. Specifically, a wider-distributed linear layer needs to be quantized with larger bins, leading to more precision loss. Thus the wide-distributed attn-dense and w2 matrices explain the INT4 quantization failure for GPT-style BLOOM. Conversely, GLMs tend to have much narrower distributions than those of similar-sized GPTs, and the gap between INT4 and FP16 versions keeps further decreasing as the GLM model size scales up.

**GLM 的 INT4 权重量化缩放定律。** 我们研究了这种独特 INT4 权重量化缩放定律的底层机制。我们绘制了权重值分布,结果发现它直接影响量化质量。具体而言,分布更宽的线性层需要用更大的 bin 进行量化,导致更多精度损失。因此,分布较宽的 attn-dense 和 w2 矩阵解释了 GPT 风格 BLOOM 的 INT4 量化失败。相反,GLM 往往比相似规模的 GPT 具有更窄的分布,且随着 GLM 模型规模的扩大,INT4 和 FP16 版本之间的差距进一步缩小。

> 译者注(架构细节): GLM 的 INT4 友好性是一个意外的发现,揭示了架构选择对量化的深层影响。1) GPT 风格的decoder-only 模型中,attn-dense 和 FFN w2 层的权重分布较宽(可能是由于自回归生成的累积效应),而 GLM 的双向注意力使权重分布更集中;2) 这意味着 GLM-130B 不仅是"性能更好",而且是"部署更友好"的 100B+ 模型 -- 在边缘设备上运行成为可能;3) 这一发现对后续研究有重要启示: 模型架构不仅影响训练和推理质量,还影响压缩和量化的可行性;4) 表 2 的推理速度数据显示,INT4 在 RTX 3090 上的编码延迟(0.37s)与 A100 的 FP16(0.15s)相比差距不大,但解码延迟显著增加(8.16s vs 4.29s),这是因为解码是内存带宽受限的,量化减少了带宽需求但增加了反量化开销。


## 5 THE RESULTS
### 实验结果

We follow the common settings in LLMs such as GPT-3 and PaLM to evaluate GLM-130B for English. As a bilingual LLM with Chinese, GLM-130B is also evaluated on Chinese benchmarks.

我们遵循 GPT-3 和 PaLM 等 LLM 的常见设置来评估 GLM-130B 的英语能力。作为具有中文能力的双语 LLM,GLM-130B 也在中文基准上进行了评估。

**Discussion on the Scope of Zero-Shot Learning in GLM-130B.** Since GLM-130B has been trained with MIP, here we clarify its scope of zero-shot evaluation. In fact, "zero-shot" seems to have controversial interpretations without a consensus in the community. We follow one of the influential related surveys (Xian et al., 2018), which says "At test time, in zero-shot learning setting, the aim is to assign a test image to an unseen class label" where involving unseen class labels is a key. Therefore, we derive our criterion to pick GLM-130B's zero-shot (and few-shot) datasets as:

**GLM-130B 零样本学习范围的讨论。** 由于 GLM-130B 使用 MIP 训练,此处我们澄清其零样本评估的范围。事实上,"零样本"似乎在社区内存在争议性解释,没有共识。我们遵循一项有影响力的相关综述(Xian et al., 2018),其中提到"在测试时,在零样本学习设置中,目标是将测试图像分配给一个未见过的类别标签",其中涉及未见过的类别标签是关键。因此,我们得出选择 GLM-130B 零样本(和少样本)数据集的标准如下:

- **English:** 1) For tasks with fixed labels (e.g., natural language inference): no datasets in such tasks should be evaluated on; 2) For tasks without fixed labels (e.g., (multiple-choice) QA, topic classification): only datasets with an obvious domain transfer from those in MIP should be considered.
- **Chinese:** All datasets can be evaluated as there exists a zero-shot cross-lingual transfer.

- **英语:** 1) 对于具有固定标签的任务(如自然语言推理): 不应在此类任务上评估任何数据集; 2) 对于没有固定标签的任务(如(多项选择)QA、主题分类): 仅应考虑与 MIP 中的数据集有明显领域迁移的数据集。
- **中文:** 所有数据集都可以评估,因为存在零样本跨语言迁移。

**Filtering Test Datasets.** Following prior practices (Brown et al., 2020; Rae et al., 2021) and our criterion mentioned above, we filter and refrain to report potentially contaminated datasets' evaluation results. For LAMBADA and CLUE, we find minimal overlap under the 13-gram setting. Pile, MMLU, and BIG-bench are either held-out or released later than the crawling of corpora.

**过滤测试数据集。** 遵循先前做法(Brown et al., 2020; Rae et al., 2021)和我们上述标准,我们过滤并避免报告可能受污染数据集的评估结果。对于 LAMBADA 和 CLUE,我们在 13-gram 设置下发现最小重叠。Pile、MMLU 和 BIG-bench 要么是保留集,要么在语料爬取之后发布。

> 译者注(数据可信度): 零样本评估的数据污染控制是 LLM 评估中的关键问题。1) GLM-130B 明确声明了评估标准 -- 这在 2022 年是非常前瞻性的(当时很多模型并未充分讨论数据污染);2) 13-gram 重叠检测是一个相对宽松的标准(后续研究如 GPT-4 使用了更严格的 5-gram 或甚至字符级匹配),但这在当时已是最佳实践;3) 中英文的不同处理方式反映了一个重要假设: 中文任务不存在于 MIP 中,因此所有中文数据集都可以评估 -- 这一假设基本成立,因为 MIP 使用的 74 个数据集均为英文。

### 5.1 LANGUAGE MODELING
#### 语言建模

**LAMBADA.** LAMBADA (Paperno et al., 2016) is a dataset to test the last word language modeling capability. The results previously shown in Figure 2 suggest GLM-130B achieves a zero-shot accuracy of 80.2 with its bidirectional attention, setting up a new record on LAMBADA.

**LAMBADA。** LAMBADA (Paperno et al., 2016) 是一个测试最后一个词语言建模能力的数据集。图 2 中显示的结果表明,GLM-130B 凭借其双向注意力实现了 80.2 的零样本准确率,在 LAMBADA 上创造了新纪录。

**Pile.** The Pile test-set (Gao et al., 2020) includes a series of benchmarks for language modeling. On average, GLM-130B performs the best on its 18 shared test sets in terms of weighted BPB when compared to GPT-3 and Jurassic-1 (Lieber et al., 2021) whose results are directly adopted from the latter, demonstrating its strong language capability.

**Pile。** Pile 测试集(Gao et al., 2020) 包含一系列语言建模基准。平均而言,与 GPT-3 和 Jurassic-1 (Lieber et al., 2021) 相比,GLM-130B 在 18 个共享测试集上的加权 BPB 表现最佳(后者的结果直接采用),展示了其强大的语言能力。

### 5.2 MASSIVE MULTITASK LANGUAGE UNDERSTANDING (MMLU)
#### 大规模多任务语言理解

MMLU (Hendrycks et al., 2021) is a diverse benchmark including 57 multi-choice question answering tasks concerning human knowledge ranging from high-school-level to expert-level. It is released after the crawling of Pile and serves as an ideal test-bed for LLMs' few-shot learning.

MMLU (Hendrycks et al., 2021) 是一个多样化的基准,包含 57 个多选问答任务,涉及从高中水平到专家水平的人类知识。它在 Pile 爬取之后发布,是 LLM 少样本学习的理想测试平台。

GLM-130B's few-shot (5-shot) performance on MMLU approaches GPT-3 (43.9) after viewing about 300B tokens. It continues moving up as the training proceeds, achieving an accuracy of 44.8 when the training has to end (i.e., viewing 400B tokens in total). This aligns with the observation (Hoffmann et al., 2022) that most existing LLMs are far from adequately trained.

GLM-130B 在 MMLU 上的少样本(5-shot)性能在查看约 300B token 后接近 GPT-3 (43.9)。随着训练进行,它继续上升,当训练必须结束时(即总共查看 400B token)达到 44.8 的准确率。这与(Hoffmann et al., 2022)的观察一致,即大多数现有 LLM 远未得到充分训练。

### 5.3 BEYOND THE IMITATION GAME BENCHMARK (BIG-BENCH)
#### BIG-BENCH 基准

BIG-bench (Srivastava et al., 2022) benchmarks challenging tasks concerning models' ability on reasoning, knowledge, and commonsense. Given evaluating on its 150 tasks is time-consuming for LLMs, we report the BIG-bench-lite -- an official 24-task sub-collection -- for now.

BIG-bench (Srivastava et al., 2022) 对涉及模型推理、知识和常识能力的挑战性任务进行基准测试。鉴于对其 150 个任务的评估对 LLM 而言耗时,我们目前报告 BIG-bench-lite -- 一个官方的 24 任务子集。

Observed from Figure 7 and Table 4, GLM-130B outperforms GPT-3 175B and even PaLM 540B (4x larger) in zero-shot setting. This is probably owing to GLM-130B's bidirectional context attention and MIP, which has been proved to improve zero-shot results in unseen tasks. As the number of shots increases, GLM-130B's performance keeps going up, maintaining its outperformance over GPT-3.

从图 7 和表 4 观察,GLM-130B 在零样本设置中优于 GPT-3 175B 甚至 PaLM 540B(大 4 倍)。这可能归功于 GLM-130B 的双向上下文注意力和 MIP,后者已被证明可以改善未见任务的零样本结果。随着 shot 数量增加,GLM-130B 的性能持续上升,保持对 GPT-3 的优势。

> 译者注(结果分析): BIG-bench 零样本结果揭示了 GLM 架构的独特优势。1) 在零样本设置中击败 PaLM 540B(参数大四倍)是一个显著成就,说明架构选择(双向注意力 + 多任务预训练)可以部分弥补规模差距;2) 然而,随着 shot 增加,PaLM 的增长速度更快,这符合缩放定律的预期 -- 更大模型从上下文学习中获益更多;3) 作者对"少样本增长不如 GPT-3 显著"的分析值得注意: 他们认为双向模型本身的零样本性能已经接近少样本上限,而现有 MIP 范式只训练零样本预测,可能存在偏差;4) 这一反思直接启发了后续的改进方向 -- 在 MIP 中引入 varied shots 的训练。

**Limitations and Discussions.** In the experiments above, we observe that GLM-130B's performance growth (13.31 to 15.12) with the increase of few-shot samples is not as significant as GPT-3's (4.35 to 13.18). Here is our intuitive attempt to understand the phenomenon.

**局限性与讨论。** 在上述实验中,我们观察到 GLM-130B 的性能增长(13.31 到 15.12)随少样本数量增加不如 GPT-3(4.35 到 13.18)显著。以下是我们直观理解这一现象的尝试。

First, the bidirectional nature of GLM-130B could lead to strong zero-shot performance (as is indicated in zero-shot language modeling), thus getting closer to the few-shot "upper-bound" for models of similar scale (i.e., 100B-scale) than unidirectional LLMs. Second, it may be also attributed to a deficit of existing MIP paradigms (Wei et al., 2022a; Sanh et al., 2022), which only involve zero-shot prediction in the training and will be likely to bias GLM-130B for stronger zero-shot learning but relatively weaker in-context few-shot performance.

首先,GLM-130B 的双向性质可能导致强大的零样本性能(如零样本语言建模所示),因此比单向 LLM 更接近相似规模模型(即 100B 规模)的少样本"上限"。其次,这也可能归因于现有 MIP 范式(Wei et al., 2022a; Sanh et al., 2022)的缺陷,它们仅在训练中涉及零样本预测,可能使 GLM-130B 偏向于更强的零样本学习但相对较弱的上下文少样本性能。

### 5.4 CHINESE LANGUAGE UNDERSTANDING EVALUATION (CLUE)
#### 中文语言理解评估

We evaluate GLM-130B's Chinese zero-shot performance on established Chinese NLP benchmarks, CLUE (Xu et al., 2020) and FewCLUE (Xu et al., 2021). Note that we do not include any Chinese downstream tasks in MIP. To date, we have finished testing on part of the two benchmarks, including 7 CLUE and 5 FewCLUE datasets.

我们在成熟的中文 NLP 基准 CLUE (Xu et al., 2020) 和 FewCLUE (Xu et al., 2021) 上评估 GLM-130B 的中文零样本性能。注意我们在 MIP 中未包含任何中文下游任务。截至目前,我们已完成两个基准的部分测试,包括 7 个 CLUE 和 5 个 FewCLUE 数据集。

We compare GLM-130B to the largest existing Chinese monolingual language model -- the 260B ERNIE Titan 3.0 (Wang et al., 2021). We follow its setting to report zero-shot results on dev datasets. GLM-130B consistently outperforms ERNIE Titan 3.0 across 12 tasks. Interestingly, GLM-130B performs at least 260% better than ERNIE on two abstractive MRC datasets (DRCD and CMRC2018), possibly due to GLM-130B's pre-training objective that naturally resonates to abstractive MRC's form.

我们将 GLM-130B 与当时最大的中文单语语言模型 -- 260B ERNIE Titan 3.0 (Wang et al., 2021) -- 进行比较。我们遵循其设置报告 dev 数据集上的零样本结果。GLM-130B 在 12 个任务上始终优于 ERNIE Titan 3.0。有趣的是,GLM-130B 在两个抽象 MRC 数据集(DRCD 和 CMRC2018)上比 ERNIE 好至少 260%,这可能归因于 GLM-130B 的预训练目标与抽象 MRC 形式天然共鸣。

> 译者注(结果分析): CLUE 结果展示了 GLM-130B 双语能力的独特价值。1) 以 130B 参数击败 260B 的 ERNIE Titan 3.0,证明了双语联合预训练的效率 -- 中英文知识可以相互迁移和增强;2) 在抽象 MRC 任务上的压倒性优势(260%+)直接源于 GLM 的空白填充预训练目标: 模型本质上就是在做"从上下文中生成被掩码内容"的任务,这与阅读理解的形式高度一致;3) 值得注意的是,ERNIE 3.0 Titan 是百度在 2021 年发布的当时最大中文模型,GLM-130B 的结果表明开源社区模型可以匹敌甚至超越工业界闭源模型。

## 6 RELATED WORK
### 相关工作

In this section, we review related work to GLM-130B on topics of pre-training, transferring, and inference of pre-trained LLMs (Qiu et al., 2020; Bommasani et al., 2021).

在本节中,我们回顾与 GLM-130B 相关的预训练、迁移和预训练 LLM 推理方面的工作(Qiu et al., 2020; Bommasani et al., 2021)。

**Pre-Training.** Vanilla language modeling refers to decoder-only autoregressive models (e.g., GPT (Radford et al., 2018)), but it also recognizes any forms of self-supervised objectives on texts. Recently, transformer-based (Vaswani et al., 2017) language models present a fascinating scaling law: new abilities (Wei et al., 2022b) arise as models scale up, from 1.5B (Radford et al., 2019), 10B-scale language models (Raffel et al., 2020; Shoeybi et al., 2019; Black et al., 2022), to 100B-scale GPT-3 (Brown et al., 2020). Later, despite many 100B-scale LLMs (Lieber et al., 2021; Thoppilan et al., 2022; Rae et al., 2021; Smith et al., 2022; Chowdhery et al., 2022; Wu et al., 2021; Zeng et al., 2021; Wang et al., 2021) in both English and Chinese, they are not available to public or only accessible via limited APIs. The closeness of LLMs severely stymies its development. GLM-130B's efforts, along with recent ElutherAI, OPT-175B (Zhang et al., 2022), and BLOOM-176B (Scao et al., 2022), aim to offer high-quality open-sourced LLMs to our community.

**预训练。** 朴素语言建模指的是仅解码器自回归模型(如 GPT (Radford et al., 2018)),但它也承认文本上的任何形式的自监督目标。最近,基于 Transformer (Vaswani et al., 2017) 的语言模型呈现了一个迷人的缩放定律: 随着模型规模扩大,新能力(Wei et al., 2022b)涌现,从 1.5B (Radford et al., 2019)、10B 规模语言模型(Raffel et al., 2020; Shoeybi et al., 2019; Black et al., 2022)到 100B 规模 GPT-3 (Brown et al., 2020)。后来,尽管有许多 100B 规模的 LLM(Lieber et al., 2021; Thoppilan et al., 2022; Rae et al., 2021; Smith et al., 2022; Chowdhery et al., 2022; Wu et al., 2021; Zeng et al., 2021; Wang et al., 2021)涵盖英语和中文,但它们不向公众开放或仅通过有限 API 访问。LLM 的封闭性严重阻碍了其发展。GLM-130B 的努力,以及近期的 ElutherAI、OPT-175B (Zhang et al., 2022) 和 BLOOM-176B (Scao et al., 2022),旨在向社区提供高质量的开源 LLM。

**Transferring.** Though fine-tuning has been a de facto way for transfer learning, the evaluation for LLMs has been focused on prompting and in-context learning due to their tremendous sizes (Brown et al., 2020; Liu et al., 2021a). Nevertheless, some recent attempts has been on parameter-efficient learning on language models (Houlsby et al., 2019) and prompt tuning (i.e., P-tuning, Li & Liang (2021); Liu et al. (2021b); Lester et al. (2021); Liu et al. (2022)). For now we do not focus on them and will leave the comprehensive testing of them on GLM-130B in future study.

**迁移。** 虽然微调一直是迁移学习的事实标准方式,但由于 LLM 的巨大规模,其评估一直集中在提示和上下文学习上(Brown et al., 2020; Liu et al., 2021a)。然而,最近有一些尝试关注语言模型的参数高效学习(Houlsby et al., 2019)和提示调优(即 P-tuning, Li & Liang (2021); Liu et al. (2021b); Lester et al. (2021); Liu et al. (2022))。目前我们不关注这些,将把在 GLM-130B 上的全面测试留待未来研究。

**Inference.** Most public-accessible LLMs nowadays are providing their services via limited APIs. In this work, an important part of our endeavor has been on LLMs' efficient and fast inference. Related work may include distillation (Sanh et al., 2019; Jiao et al., 2020; Wang et al., 2020), quantization (Zafrir et al., 2019; Shen et al., 2020; Tao et al., 2022), and pruning (Michel et al., 2019; Fan et al., 2019). Very recent work (Dettmers et al., 2022) shows that LLMs such as OPT-175B and BLOOM-176B can be quantized to 8 bit due to special distribution of outlier dimensions. In this work, we demonstrate GLM's scaling law for INT4 weight quantization, which allows GLM-130B to inference on as few as 4xRTX 3090 (24G) GPUs or 8xRTX 2080 Ti (11G) GPUs.

**推理。** 如今大多数可公开访问的 LLM 通过有限 API 提供服务。在本工作中,我们努力的重要部分在于 LLM 的高效快速推理。相关工作可能包括蒸馏(Sanh et al., 2019; Jiao et al., 2020; Wang et al., 2020)、量化(Zafrir et al., 2019; Shen et al., 2020; Tao et al., 2022)和剪枝(Michel et al., 2019; Fan et al., 2019)。非常近期的工作(Dettmers et al., 2022)表明,由于异常值维度的特殊分布,OPT-175B 和 BLOOM-176B 等 LLM 可以量化到 8 位。在本工作中,我们展示了 GLM 的 INT4 权重量化缩放定律,使 GLM-130B 可以在少至 4xRTX 3090 (24G) GPU 或 8xRTX 2080 Ti (11G) GPU 上进行推理。

## 7 CONCLUSION AND LESSONS
### 结论与经验教训

We introduce GLM-130B, a bilingual pre-trained language model that aims to facilitate open and inclusive LLM research. GLM-130B's technical and engineering undertakings generate insight into LLMs' architectures, pre-training objectives, training stability and efficiency, and affordable inference. Altogether, it contributes to the high quality of GLM-130B in terms of both language performance on 112 tasks and ethical results on bias and toxicity benchmarks. Our experiences of both success and failure are condensed into the lessons for training 100B-scale LLMs, attached in the Appendix B.10.

我们介绍了 GLM-130B,一个旨在促进开放和包容性 LLM 研究的双语预训练语言模型。GLM-130B 的技术和工程实践为 LLM 的架构、预训练目标、训练稳定性和效率以及可负担的推理提供了深刻见解。总之,它在 112 个任务上的语言性能和偏见与毒性基准上的伦理结果方面,共同构成了 GLM-130B 的高质量。我们的成功和失败经验被浓缩为训练 100B 规模 LLM 的经验教训,附于附录 B.10 中。

> 译者注(总结性评价): GLM-130B 是 2022-2023 年开源 LLM 领域最重要的贡献之一。1) 它是当时唯一完全开源的 100B+ 双语模型(同时支持中英文),填补了一个关键空白;2) 技术上,GLM 架构(双向注意力 + 自回归空白填充)被证明是 GPT 风格 decoder-only 架构的有力竞争者,在零样本任务上尤其有优势;3) 工程上,DeepNorm + EGS 的训练稳定性方案、INT4 量化的可行性探索,为后续社区模型提供了宝贵经验;4) 伦理上,作者主动评估并公开了模型的偏见和毒性表现,并论证了开源对于 AI 安全研究的必要性;5) 局限性包括: 400B token 训练量按照 Chinchilla 最优计算仍然不足(130B 模型应训练约 2.6T token),这解释了为什么 GLM-130B 在部分任务上仍有提升空间。

---

## ACKNOWLEDGEMENT
### 致谢

This research was supported by Natural Science Foundation of China (NSFC) 61825602, 62276148 and Zhipu.AI. We thank all our collaborators and partners from the Knowledge Engineering Group (KEG), Parallel Architecture & Compiler technology of Mobile, Accelerated, and Networked systems Group (PACMAN), Natural Language Processing Group (THUNLP) at Tsinghua University, and Zhipu.AI.

本研究得到国家自然科学基金(NSFC) 61825602、62276148 和智谱.AI 的支持。我们感谢来自清华大学知识工程组(KEG)、移动加速网络系统并行架构与编译器技术组(PACMAN)、自然语言处理组(THUNLP)以及智谱.AI 的所有合作者和合作伙伴。

## ETHICS STATEMENT
### 伦理声明

We hereby acknowledge that all of the co-authors of this work are aware of the provided ICLR Code of Ethics and honor the code of conduct. This work introduces an open-source Large Language Model (LLM), which could be used to generate synthetic text for harmful applications, such as telemarketing fraud, political propaganda, and personal harassment as is discussed in (Weidinger et al., 2021; Sheng et al., 2021; Dev et al., 2021).

我们在此确认,本工作的所有合著者都了解 ICLR 伦理准则并遵守行为准则。本工作引入了一个开源大型语言模型(LLM),它可能被用于生成有害应用的合成文本,如电话营销欺诈、政治宣传和个人骚扰,如(Weidinger et al., 2021; Sheng et al., 2021; Dev et al., 2021)所讨论的。

**Open-Sourced LLMs for Ethical Risk Study.** While some people think that restricting the access of LLMs can prevent such harmful applications, we argue that promoting LLM inclusivity can lead to better defense against potential harms caused by LLMs. Currently, only governments和 large corporations can afford the considerable costs of pre-training LLMs. There is no guarantee that organizations having the substantial financial resources will not do harm using a LLM. Without access to such LLMs, individuals cannot even realize the role of LLMs in the harm. Conversely, releasing an open LLM can provide access and transparency to all the researchers and promote the research to reduce the potential harm of LLMs, like algorithms to identify the synthetic text (Gehrmann et al., 2019). Also, it is known that LLMs can suffer from problems in fairness, bias, privacy, and truthfulness (Zhang et al., 2021; Lin et al., 2022; Liang et al., 2021; Bender et al., 2021). An open LLM can reveal the model parameters and internal states corresponding to specific inputs instead of providing APIs to black-box models. In conclusion, researchers can conduct analysis of LLMs' flaws in depth and propose improved algorithms to solve the problems.

**用于伦理风险研究的开源 LLM。** 虽然有些人认为限制 LLM 的访问可以防止此类有害应用,但我们认为促进 LLM 的包容性可以更好地防御 LLM 造成的潜在伤害。目前,只有政府和大型企业才能负担得起预训练 LLM 的巨额成本。无法保证拥有大量财务资源的组织不会使用 LLM 造成伤害。如果无法访问此类 LLM,个人甚至无法意识到 LLM 在伤害中的作用。相反,发布开源 LLM 可以为所有研究人员提供访问和透明度,并促进研究以减少 LLM 的潜在伤害,如识别合成文本的算法(Gehrmann et al., 2019)。此外,众所周知,LLM 可能存在公平性、偏见、隐私和真实性问题(Zhang et al., 2021; Lin et al., 2022; Liang et al., 2021; Bender et al., 2021)。开源 LLM 可以揭示对应于特定输入的模型参数和内部状态,而不是为黑盒模型提供 API。总之,研究人员可以深入分析 LLM 的缺陷并提出改进算法来解决问题。

**Ethical Evaluation and Improvements.** We also evaluate our model over a wide range of English ethical evaluation benchmarks, including bias measurement (Nadeem et al., 2021; Nangia et al., 2020), hate speech detection (Mollas et al., 2020), and toxic generation estimation (Gehman et al., 2020). Notwithstanding their deficiency (Blodgett et al., 2021; Jacobs & Wallach, 2021), these datasets serve as a meaningful initial step towards an open quantitative evaluation LLMs. Our evaluation implies that our algorithm designs, especially the bilingual pre-training of a LLM, can significantly mitigate the biases and toxicity an LLM may present while keeping its strong language performance compared to other LLMs (Brown et al., 2020; Zhang et al., 2022) trained with monolingual English corpora.

**伦理评估与改进。** 我们还在广泛的英语伦理评估基准上评估了我们的模型,包括偏见测量(Nadeem et al., 2021; Nangia et al., 2020)、仇恨言论检测(Mollas et al., 2020)和毒性生成估计(Gehman et al., 2020)。尽管这些基准存在缺陷(Blodgett et al., 2021; Jacobs & Wallach, 2021),但它们作为 LLM 开放定量评估的有意义的初始步骤。我们的评估表明,我们的算法设计,特别是 LLM 的双语预训练,可以在保持强大语言性能的同时,显著缓解 LLM 可能呈现的偏见和毒性,与其他使用英语单语语料库训练的 LLM(Brown et al., 2020; Zhang et al., 2022)相比。

## REPRODUCIBILITY
### 可复现性

Compared to mainstream closed-sourced LLMs including GPT-3 175B (Brown et al., 2020), PaLM 540B (Chowdhery et al., 2022), Gopher (Rae et al., 2021), Chinchilla (Hoffmann et al., 2022), LaMDA (Thoppilan et al., 2022), FLAN (Wei et al., 2022a), and many others, GLM-130B is open-sourced and devotes to promote openness and inclusivity in LLM research from the very beginning.

与主流闭源 LLM 包括 GPT-3 175B (Brown et al., 2020)、PaLM 540B (Chowdhery et al., 2022)、Gopher (Rae et al., 2021)、Chinchilla (Hoffmann et al., 2022)、LaMDA (Thoppilan et al., 2022)、FLAN (Wei et al., 2022a)等相比,GLM-130B 是开源的,从一开始就致力于促进 LLM 研究的开放性和包容性。

We have paid great effort to ensure the reproducibility of our evaluation. For pre-training section, despite the unaffordable costs it needs to reproduce at present, we still make our best efforts to disclose the code, details, and the whole process of GLM-130B's pre-training. Our endeavor to allow GLM-130B inference on few popularized GPUs such as 3090/2080 Ti also aligns with the reproducibility undertaking, as it allows most academic研究人员 to reproduce GLM-130B's results on their offline machines. We also provide free APIs for individual users to test GLM-130B's ability.

我们付出了巨大努力来确保评估的可复现性。对于预训练部分,尽管目前复现所需成本不可承受,我们仍尽最大努力披露 GLM-130B 预训练的代码、细节和整个过程。我们致力于使 GLM-130B 能够在 3090/2080 Ti 等普及型 GPU 上推理,这也与可复现性目标一致,因为它允许大多数学术研究人员在其离线机器上复现 GLM-130B 的结果。我们还为个人用户提供免费 API 来测试 GLM-130B 的能力。

---

## APPENDIX A: ETHICAL EVALUATION DETAILS
### 附录 A: 伦理评估详情

*(Note: The original D3 file truncates after the start of references. For a complete Appendix A translation, the full source D3 would need to be processed. Below is a summary of Appendix A's scope based on the paper structure.)*

*(注意: 原始 D3 文件在参考文献开始处截断。如需完整的附录 A 翻译,需要处理完整的 D3 源文件。以下是基于论文结构的附录 A 范围概要。)*

According to the paper's table of contents, Appendix A contains detailed ethical evaluation results on:

根据论文目录,附录 A 包含以下详细伦理评估结果:

- **CrowS-Pairs** (Nadeem et al., 2021): Measuring stereotypical bias in masked language models
- **StereoSet** (Nangia et al., 2020): Measuring stereotypical bias across demographic groups  
- **ETHOS** (Mollas et al., 2020): Hate speech detection benchmark
- **RealToxicPrompts** (Gehman et al., 2020): Toxic generation estimation

The paper claims that bilingual pre-training significantly mitigates biases compared to monolingual English models, while maintaining strong language performance.

论文声称,与英语单语模型相比,双语预训练显著缓解了偏见,同时保持了强大的语言性能。

> 译者注(局限风险): 伦理评估是 GLM-130B 论文的一个亮点,但也有需要注意的地方。1) 这些伦理基准本身存在缺陷(如 CrowS-Pairs 被美国方言学会批评为过度简化社会偏见),论文作者也承认了这一点;2) "双语预训练减少偏见"的结论可能部分是因为中文语料的文化背景不同,而非算法本身消除了偏见;3) 2022 年的伦理评估标准相对初级(主要集中在显式偏见测量),对更隐蔽的价值观对齐和长期社会影响的评估仍然不足;4) 尽管如此,在 2022 年主动进行并公开伦理评估已是领先实践,为后续开源模型树立了榜样。

## 全文完

## 关联文件说明

| 文件 | 说明 |
| --- | --- |
| [03-GLM-130B-mineru-en.md](./03-GLM-130B-mineru-en.md) | MinerU 英文原文(D3), 含 36 张语义化插图 |
| [01-GLM-130B 顶会论文精译.md](./01-GLM-130B顶会论文精译.md) | ICLR 2023 中文精译主稿(D2) |
| [02-GLM-130B 二维 RoPE 数理推导.md](./02-GLM-130B二维RoPE数理推导.md) | 2D RoPE 数学推导(D2) |
| [05-GLM-130B-Index.md](./05-GLM-130B-Index.md) | 技术入口 Index(D5) |
| [05-GLM-130B-RoPE.md](./05-GLM-130B-RoPE.md) | RoPE 专题(D5) |
| [pdfs/GLM-130B.pdf](./pdfs/GLM-130B.pdf) | 官方论文 PDF(arXiv:2210.02414) |
| [images/](./images/) | 论文插图 |
