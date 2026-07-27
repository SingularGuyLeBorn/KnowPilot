---
title: "02 · 原生稀疏注意力(NSA): 长上下文大模型的高效与高性能之道"
date: 2026-05-11
tags: []
---

# 02 原生稀疏注意力(NSA): 长上下文大模型的高效与高性能之道

## 1. 引言

在人工智能飞速发展的今天,大型语言模型(LLM)已成为诸多应用的核心驱动力. 然而,随着模型处理上下文长度的不断增长——从最初的几千个令牌到如今的数十万甚至上百万个令牌——它们在处理超长序列任务时面临着巨大的计算和内存瓶颈. 传统的Transformer架构中,核心的注意力机制其计算复杂度随序列长度呈平方增长(O(N²)),这使得长文本处理在部署和训练阶段都变得成本高昂,甚至难以实现. 例如,在处理64k上下文长度的场景下,高达70%-80%的计算延迟都集中在注意力机制上. 

面对这一挑战,各种高效注意力机制应运而生. 原生稀疏注意力(Native Sparse Attention, NSA)便是DeepSeek团队提出的一种前沿解决方案. NSA的灵感来源于人类处理复杂信息的认知模式: 我们并非逐字逐句地给予同等关注,而是策略性地在不同粒度上分配注意力,例如关注近期信息、把握全局梗概,以及筛选出关键细节. NSA将这一认知模式转化为一种分层、动态的计算架构,并结合了深入的硬件优化,旨在从根本上解决长序列处理的效率问题. 

本文将作为一篇百科全书式的深度技术指南,全面剖析NSA的设计理念、核心算法、硬件优化策略,并通过公式推导、数值示例和代码片段,详细阐述其工作原理,旨在使读者对其有完整、自洽的理解. 

## 2. 问题分析与现有稀疏注意力方法的局限性

为了理解NSA的创新之处,我们首先需要深入分析大模型在处理长上下文时面临的挑战,并审视现有稀疏注意力方法的不足. 

### 2.1 推理阶段的性能瓶颈分析

大型自回归语言模型(LLM)的推理通常分为两个关键阶段: 

- **2.1.1. 预填充(Prefilling)阶段**: 根据用户输入的提示(Prompt),模型并行计算每个注意力层的键(Key)和值(Value)向量,并填充KV缓存(KV-Cache). 例如,对于一个数学竞赛题目,其题目本身通常比较简短,这个阶段的任务是快速处理整个输入提示.

- **2.1.2. 解码(Decoding)阶段**: 在预填充之后,模型开始逐个生成(解码)令牌. 这个过程是串行的. 特别是在需要长链式思考(LongCoT)来解决复杂问题时,解码阶段会产生更长的文本生成. 

这两个阶段的计算成本是不同的. 在同等处理令牌数量的情况下,解码阶段通常更为昂贵,因为它涉及连续的内存访问和KV缓存的累积. 

我们可以从两个主要方面来分析推理效率的瓶颈: 

- **2.1.2.1. 空间(内存)瓶颈**: 在解码过程中,为了支持多请求并行解码(continue-batch),KV缓存的管理变得至关重要. KV缓存存储了历史令牌的键值向量,其大小随序列长度线性增长. 对于超长上下文,KV缓存的存储可能导致内存爆炸. 尽管一些方法如多查询注意力(MQA)或分组查询注意力(GQA)可以通过共享KV头来减少KV缓存的存储,但它们并非直接减少注意力计算量.

- **2.1.2.2. 计算(算力)瓶颈**: 随着上下文长度的增长,标准注意力机制所需的计算复杂度呈平方增长. 如何有效减少计算量是关键. 例如,FlashAttention通过I/O优化而非减少计算量来加速注意力. 

为了减少计算量,传统方法通常通过控制计算序列长度实现: 

- **循环神经网络(RNN)/线性注意力**: 将过去的状态压缩成隐状态.

- **窗口注意力**: 限制注意力计算的可视范围.

- **稀疏化**: 根据特定规则筛选有限的令牌进行注意力计算. 

### 2.2 现有稀疏注意力方法的局限性

尽管稀疏注意力机制展现出巨大潜力,但现有方法在实际部署中往往存在以下不足,这也是NSA设计的出发点: 

- **2.2.1. 阶段限制(Phase-Restricted Sparsity)** : 许多稀疏化优化方法只关注推理阶段的优化(如H2O主要优化自回归解码,infLLM侧重预填充),而缺乏对训练阶段的支持. 这种局部优化可能导致在多阶段工作负载中出现瓶颈,并且由于训练与推理架构的不一致,可能影响推理性能.

- **2.2.2. 性能退化(Performance Degradation)** : 在预训练模型上进行后处理稀疏化(例如,在已预训练好的稳定模型上做稀疏化处理)常常导致性能严重退化. 研究表明,即使保留20%的注意力分数,也可能仅恢复70%的总注意力分数,使得模型结构变得脆弱. 这表明,原生的稀疏设计,即模型从预训练阶段就采用稀疏注意力结构,是必要的.

- **2.2.3. 与先进注意力架构的不兼容性**: 一些稀疏化方法无法与现代高效注意力结构(如MQA/GQA)完美适配. 例如,某些查询感知方法虽然减少了计算量,但导致分散的内存访问模式,与GQA的高效批处理设计相冲突,无法充分发挥硬件优势.

- **2.2.4. 不可训练组件与反向传播效率低下**: 部分稀疏化方法引入了非连续或非可微的组件(如K-means聚类),阻碍了梯度反向传播,使其难以进行端到端训练. 另一些方法虽然理论上可导,但因其策略限制(如需要加载大量令牌导致内存访问不连续),导致反向传播效率低下. 

DeepSeek团队通过“原生(Native)”设计,意味着模型在预训练时就采用稀疏注意力结构,解决了性能退化问题. 通过“推断特性导向(Inference-characteristic-driven)”设计,NSA旨在减轻长上下文的注意力计算负担,筛选更少的KV对,从而降低部署成本. 

## 3. 原生稀疏注意力(NSA)的核心设计理念与算法

NSA的设计灵感来源于对人类处理长篇文本时认知过程的模拟. 人类在阅读长文档时并非平均分配注意力,而是采用一种多层次、动态的策略: 既关注当前的局部细节,也理解全局的宏观结构,同时还能动态地识别和提取关键信息. NSA将这种分层认知转化为三个并行的注意力分支,并通过一个智能门控机制进行融合. 

### 3.1 NSA整体结构与门控融合机制

NSA的计算过程可以概括为以下步骤: 对于每个查询令牌 $q_t$,它不再与整个序列的键值对 $(K_{:t}, V_{:t})$ 计算注意力,而是与三个经过特定处理的键值子集 $(\tilde{K}_t^c, \tilde{V}_t^c)$ 进行注意力计算. 这三个子集分别对应了三种注意力策略: 压缩(cmp)、选择(slc)和滑动窗口(win). 

最终,这三个分支的输出 $Attn(q_t, \tilde{K}_t^c, \tilde{V}_t^c)$ 通过一个可学习的门控机制动态融合,得到最终的输出 $o^*_t$. 

$\mathbf{o}^*_t = \sum_{c \in \mathcal{C}} g_t^c \cdot \text{Attn}(\mathbf{q}_t, \tilde{K}_t^c, \tilde{V}_t^c)$

其中,$\mathcal{C} = \{cmp, slc, win\}$ 代表三种注意力方法. $g_t^c \in$ 是对应策略 $c$ 的门控得分,由输入特征 $x_t$ 经过一个多层感知器(MLP)和Sigmoid激活函数计算得出. 

![NSA 整体稀疏框架（论文 Figure 2）](./images/fig-nsa-02-three-branch-framework.jpg)

> 图 1: NSA 三分支稀疏框架——压缩、选择、滑动窗口并行（论文 Figure 2）。

**图 1 解析**

- **左侧面板**：输入序列的 KV 被组织成时间块；三支路并行 — **cmp** 压缩粗粒度、**slc** 选择细粒度块、**win** 滑动窗口局部上下文。
- **右侧面板**：绿色区域 = 需要算 attention 的位置，白色 = 可跳过 — 直观看到 **稀疏模式因分支而异**，最终由门控 $g_t^c$ 加权融合。
- **与 Full Attention 对比**：Full 为下三角全绿；NSA 大部分区域留白 — 理论 FLOPs 与 HBM 访问量同步下降。
- **训练原生性**：三支路均可微 — 非「推理时剪枝」；从预训练起学习 $g_t^c$ 与压缩 MLP $\phi$，避免 post-hoc 稀疏掉点。
- **读图顺序**：先理解三支路 **各管什么尺度**，再读 §3.2–3.4 的分支公式；内核实现见 §3.5 与图 4。

### 3.2 性能与效率总览（论文 Figure 1）

![NSA 相对 Full Attention 的性能与效率（论文 Figure 1）](./images/fig-nsa-01-performance-efficiency.jpg)

> 图 2: NSA 相对 Full 的基准分数与 64K 三阶段加速（论文 Figure 1）。

**图 2 解析**

- **左栏（General / LongBench / Reasoning）**：稀疏 NSA 在多项基准上 **持平或超过** Full — 说明原生稀疏训练没有牺牲通用能力；Reasoning 子项提升最明显（论文解释为「强制聚焦关键信息」）。
- **右栏（Decoding / Forward / Backward @64K）**：相对 Full 的加速比 — **Decode ~11.6×** > Forward ~9× > Backward ~6×；decode 最吃 KV 带宽，NSA 稀疏读 KV 收益最大。
- **与 FlashAttention 区分**：FA 不降 FLOPs，只降 HBM 往返；NSA **同时减计算与访存** — 左栏证质量，右栏证效率。
- **序列长度阈值**：短序列区 NSA 路由/压缩有固定开销 — 部署应对 $<L_{\min}$ 回退 Full（论文实验主要在 8K 预训练 + 32K 续训）。
- **工程含义**：左栏是「能不能用」，右栏是「值不值得用」— 长上下文服务应同时监控质量与 TTFT/TPOT。

### 3.3 滑动窗口注意力(Sliding Window Attention)

**设计目标: ** 滑动窗口分支旨在精确捕捉并保留当前令牌最近的本地上下文中的细粒度信息. 它确保模型对当前位置附近词语之间的语义关系有高精度的理解,并避免本地高频模式干扰其他分支学习长程依赖. 

**实现机制: ** 该分支采用最直接的方式,将注意力计算严格限制在当前查询令牌前 $w$ 个令牌的范围内. 例如,如果滑动窗口大小 $w=8$,那么 $q_t$ 只会与 $K_{t-8:t}$ 和 $V_{t-8:t}$ 计算注意力. 

**公式推导与代码示例: **

标准的注意力计算公式为: 

$\mathbf{Attn}(\mathbf{Q}, \mathbf{K}, \mathbf{V}) = \text{Softmax}\left(\frac{\mathbf{Q}\mathbf{K}^\top}{\sqrt{d_k}}\right)\mathbf{V}$

对于滑动窗口注意力,我们只需在计算注意力分数矩阵后,应用一个窗口掩码 (mask) 来屏蔽掉窗口外的键值对. 

**计算复杂度分析**: 处理单个令牌的计算成本为 $O(w)$,其中 $w$ 是窗口大小,这是一个与整体序列长度 $N$ 无关的常数. 整个序列的总计算成本为 $O(N \cdot w)$,相比标准注意力的 $O(N^2)$ 复杂度实现了显著的线性化改进. 

### 3.4 令牌压缩注意力(Token Compression Attention)

**设计目标: ** 快速高效地构建整个序列历史的粗粒度全局视图,以理解文档的整体结构和主题,同时大幅减少计算量. 

**实现机制: ** 压缩机制并非简单采样,而是通过将连续的令牌块聚合成单个“摘要”令牌.

- **块划分与重叠: ** 系统在序列上滑动大小为 $l$ 的处理窗口,每次前进 $d$ 个令牌位置,形成重叠覆盖. 这种重叠(当 $d < l$ 时)对于减轻块边界处的信息碎片化至关重要,确保生成的摘要具有良好的连续性. 

- 例如,序列长度 $t=32$,压缩块长度 $l=8$,步长 $d=8$(无重叠),那么将划分为 $32/8 = 4$ 个块. 若 $t=32$, $l=8$,步长 $d=4$(有重叠),则块数为 
$\lfloor (t-l)/d \rfloor + 1 = \lfloor (32-8)/4 \rfloor + 1 = 6 + 1 = 7$
 个块.

- **摘要令牌生成: ** 每个摘要令牌通过一个小型的可学习多层感知器(MLP,论文中记为 $\phi(\cdot)$)生成. 该MLP将一个块内所有键向量(形状为 $l \times d_{model}$)映射成一个单一的压缩键向量(形状为 $1 \times d_{model}$). 值向量也通过类似的方式进行压缩. 

**公式推导与代码示例: **

压缩键 $\tilde{K}_t^{cmp}$ 的生成方式可以表示为: 

$\tilde{K}^\text{cmp}_t = \left\{ \phi(\mathbf{k}_{id+1:id+l}) \middle| 1 \leq i \leq \left\lfloor\frac{t-l}{d}\right\rfloor \right\}$
其中 
$\phi(\cdot): \mathbb{R}^{l \times d_{model}} \rightarrow \mathbb{R}^{1 \times d_{model}}$
 是一个带有块内位置编码的可学习MLP.

- **数值示例: ** 假设原始序列长度 $t=32768$,压缩块大小 $l=32$,步长 $d=16$. 

生成的压缩令牌数量 = 
$\lfloor (t-d)/l \rfloor = \lfloor (32768-16)/16 \rfloor \approx 2047$
 个块(这里与原文稍有出入,原文是 $(t-l)/d$, 但DeepSeek的计算是 $\lfloor t/d \rfloor$ 或 $\lfloor (t-d)/d \rfloor$). 按照原文的计算 $65536 / (128+8 \times 512 + 4096) = 65536/8320 \approx 7.88$ 的压缩倍数,可以反推其压缩块数量. 若以 $t=32$ 为例,块长度 $l=8$,步长 $d=8$,则有 4 个块. 若 $d=4$, 块数 $\lfloor (32-8)/4 \rfloor + 1 = 7$ 个. - 通过此过程,原始32768个令牌序列被转换为约2047个令牌的紧凑摘要表示. 

**效率优势分析**: 这种“摘要先于注意力”的策略是关键. 系统首先通过线性扫描(复杂度 $O(N)$)创建规模更小的摘要表示,而非直接对所有 $N$ 个令牌执行注意力计算. 通过MLP进行的压缩操作具有高度可并行化的特性,相比注意力操作的计算开销很小. 这个过程将序列长度按步长因子 $d$ 进行缩减,例如从32768个令牌降至约2047个可管理的令牌规模,将原本的 $O(N^2)$ 问题转换为更易处理的 $O(N \cdot (N/d))$ 问题,进一步简化为该分支的线性 $O(N)$ 总体复杂度. 

### 3.5 令牌选择注意力(Token Selection Attention)

**设计目标: ** 令牌选择分支专注于捕获关键的长程细粒度依赖关系,通过将计算资源集中于文本中最相关的部分来实现这一目标. 它旨在弥补纯粹压缩可能丢失的细节信息. 

**实现机制: **

- **细节块重要性推断: ** 为高效估计细粒度块的重要性,NSA重用了压缩注意力分支中生成的中间注意力分数 $p_t^{cmp}$. 这些分数代表了每个查询令牌对各个压缩块的注意力强度.

- **重要性分数聚合: ** 对于每个细粒度选择块 $j$(例如,块大小 $l'=64$),其重要性分数 $p_t^{slc}[j]$ 通过对与该选择块空间重叠的多个压缩块的 $p_t^{cmp}$ 分数进行聚合(求和)来计算. 这避免了新的计算密集型操作. - 当压缩块和选择块共享相同的分块方案时(即 $l'=l=d$),$p_t^{slc}$ 可以直接取 $p_t^{cmp}$ 的值. 

$\mathbf{p}_t^\text{slc}[j] = \sum_{m=0}^{\frac{l'}{d}-1}\sum_{n=0}^{\frac{l}{d} -1} \mathbf{p}_t^\text{cmp}\left[\frac{l'}{d}j+m +n \right]$

聚合后的重要性分数可以在头部维度上进行合并(求和): 

${\mathbf{p}_t^{\text{slc}}}' = \sum_{h=1}^{H} \mathbf{p}_{t}^{\text{slc}, (h)}$

- **Top-N块选择: ** 在获得每个细粒度块的重要性分数后,系统根据这些分数选择前 $n$ 个最具重要性的块(例如 $n=2$). 这些被选中的块对应的原始键值对 $(\mathbf{K}, \mathbf{V})$ 将被用于后续的细粒度注意力计算. 

**公式推导与代码示例: **

我们从上一步计算得到的 p_cmp (形状 [batch_size, heads, q_len, k_cmp_len]) 开始. 

**效率优势分析**: 令牌选择是NSA设计的精髓. 系统避免了对完整 $N$ 个令牌的注意力矩阵计算,转而仅对 $n \cdot l'$ ($16 \times 64 = 1024$)个最有潜力的令牌执行小规模但密集的注意力计算. 在内存访问方面,该步骤利用「收集」操作模式,内核不加载完整的键值矩阵,而是从高带宽内存(HBM)执行分散读取,仅将所需的1024个向量拉入SRAM. 尽管分散读取可能比单次顺序读取慢,但数据量的巨大缩减(1024对比32768向量,约32倍减少)带来了性能的显著净收益. 

### 3.6 NSA的内核优化与硬件对齐

优秀的算法设计如果不考虑底层硬件特性,在实际执行中仍可能表现不佳. NSA不仅仅是算法创新,更在于其深度硬件对齐的内核设计,主要通过Triton(一种基于Python的DSL,用于编写高性能GPU内核)实现. 

![NSA Triton 内核设计（论文 Figure 3）](./images/fig-nsa-03-kernel-design.jpg)

> 图 3: Triton 内核——按 GQA 组加载 query、按稀疏块取 KV（论文 Figure 3）。

**图 3 解析**

- **Grid Loop（外循环）**：按 **GQA 组** 加载同一 query 位置的所有 head — 因同组 head 共享稀疏 KV 块索引 $\mathcal{I}_t$，避免 per-head 重复选块。
- **Inner Loop**：顺序拉取 $\mathcal{I}_t$ 中的 **连续 KV 块** 进 SRAM（绿色 = 片上，蓝色 = HBM）— 块内合并访存，块间仍稀疏。
- **与 FlashAttention-2 差异**：cmp/win 分支可直接复用 FA2；**slc 分支** 因每 query 的 KV 块索引不同，不能按「连续 Q 块」加载 — NSA 改为 **按 GQA 组 + 稀疏块索引** 调度。
- **算术强度**：目标是在稀疏率与 Tensor Core 利用率间平衡 — 块太小则 GEMM 不够「胖」，太大则 recall 下降。
- **Backward**：论文提供匹配的训练感知反向算子 — 原生训练的关键，非 inference-only patch。

**核心问题**: GPU强大的计算核心常常将大部分时间消耗在等待数据从低速全局内存(HBM)传输上,而非进行实际计算(即内存带宽受限). 

NSA的内核设计通过以下三个关键策略解决这一问题: 

- **3.6.1. 组中心化加载机制(Group-Centric Data Loading)** : 

- **背景**: 在现代GQA架构中,多个查询头共享相同的键和值矩阵.

- **实现**: NSA的内核专门针对这一特性进行优化. 系统为每个查询位置一次性加载其GQA组内的所有查询头. 由于这些头都将访问相同的选定键值块,内核可以从HBM为整个GQA组仅执行一次数据获取操作.

- **技术优势**: 这种设计有效消除了冗余的内存传输操作,显著提升了内存访问效率. 通过将单头KV复制成多头并送到SRAM计算(常规),变为单头KV送到SRAM,并通过某种共享内存策略让多头访问同一个KV,从而减少了SRAM的访存.

- **3.6.2. 分块处理与SRAM优化(Tiled Processing & SRAM Optimization)** : 

- **背景**: GPU在小容量但超高速的片上SRAM上操作数据时能够达到最佳性能.

- **实现**: NSA内核将大规模注意力问题分解为能够适配SRAM容量的小规模“分块”. 系统将Q、K、V数据的小块加载到SRAM“工作区”,在其上完成所有必要的计算操作,仅在需要新数据时才返回HBM“存储区”获取.

- **性能优势**: 这种设计最大化了数据重用效率,最小化了对低速HBM的访问次数.

- **3.6.3. 融合操作与在线Softmax(Fused Operations & Online Softmax)** : 

- **背景**: 在GPU上启动独立操作会产生额外的调度开销.

- **实现**: NSA的选择注意力内核采用“融合内核”设计,将多个计算步骤合并为单一的连续操作. 这在Softmax计算中表现最为明显: 系统不存储完整的 $(H \times N_{selected})$ 分数矩阵,而是采用类似FlashAttention的“在线”计算方法,避免了中间结果的HBM写入,进一步减少了内存流量.

- **性能优势**: 这种融合策略减少了不必要的内存访问和内核启动开销,从而提升了整体计算效率. 

这些硬件感知的设计使得NSA能够在理论性能提升的同时,在实际A100/H100等现代GPU上实现显著的加速. 

## 4. 性能评估与应用效果

NSA的算法创新与硬件优化结合,使其在实际应用中取得了显著的性能提升和模型表现. 

### 4.1 计算效率表现

![NSA vs FlashAttention-2 内核延迟（论文 Figure 6）](./images/fig-nsa-06-triton-speedup.jpg)

> 图 4: NSA vs FlashAttention-2 内核延迟随序列长度变化（论文 Figure 6）。

**图 4 解析**

- **横轴**：序列长度；纵轴：单算子延迟 — 同用 Triton 后端，排除 cuDNN/CUDA 实现差异。
- **趋势**：长度越长，NSA 相对 FA2 的加速比 **越大** — 64K 附近 Forward ~9×、Backward ~6×（与图 2 右栏一致）。
- **Backward 低于 Forward**：反向需重算/保存更多中间态，稀疏模式在 slc 分支的 gather 不规则性对反向更敏感。
- **短序列交叉点**：极短序列 NSA 可能慢于 FA2 — 固定压缩/选块开销占主导；生产环境应设 $L_{\min}$。
- **与 MoBA 对比**：MoBA 是块级 MoE 路由；NSA 是 **固定三分支 + 可训练门控** — 二者都可与 FA 块内内核叠加，但 NSA 更强调 **端到端训练**。

- **速度提升**: 论文的基准测试结果显示,对于64k长度的序列,NSA相对于高度优化的FlashAttention-2基线实现了惊人的加速效果: 

- 解码阶段: 11.6倍速度提升. - 前向传播: 9.0倍加速. - 反向传播: 6.0倍性能改进.

- **内存效率**: 解码阶段的加速直接源于内存访问量的显著减少. NSA大幅降低了需要从HBM加载的键值缓存数据量,有效缓解了内存带宽瓶颈. 

### 4.2 模型性能验证

仅仅追求速度而牺牲模型能力是不可接受的. NSA通过实验证明了其在实现性能与效率双重优化的同时,保持甚至超越了全注意力模型的性能: 

![NSA 预训练损失曲线（论文 Figure 4）](./images/fig-nsa-04-pretrain-loss.jpg)

> 图 5: 27B 预训练 loss——NSA 平滑且略优于 Full（论文 Figure 4）。

**图 5 解析**

- **曲线形态**：两条 loss 均平滑下降 — 原生稀疏 **无训练不稳定**（对比需 auxiliary loss 的 Quest 类方法）。
- **NSA 略低于 Full**：说明稀疏 inductive bias 在预训练阶段即带来 **正则/去噪** 效应，而非单纯省算力。
- **公平对比**：相同 270B token、8K 预训练 + 32K YaRN 续训、训练至收敛 — 读图时勿与不同数据规模曲线比较。
- **超参锚点**：$l=32, d=16, l'=64, n=16, w=512$ — 与 §3 公式符号一致；调 $n$ 或 $w$ 会同时动 FLOPs 与 recall。
- **失败信号**：若 NSA loss 高于 Full 且震荡 — 常见原因是 slc top-$n$ 过小或压缩 MLP 容量不足，而非稀疏本身不可训。

- **通用语言评估**: 在涵盖通用知识(如MMLU)、推理能力和编程任务的综合基准测试中,NSA训练的模型达到或超越了全注意力基线的表现水平. 在9个指标中的7个上优于包括Full Attention在内的所有基线.

- **长文本评估**: 在LongBench基准测试中,NSA显著优于其他稀疏方法和全注意力基线. 特别值得关注的是,NSA在64k上下文长度的“大海捞针”(Needle-in-a-Haystack)测试中达到了完美的准确率,证明了其在保持细粒度信息方面的卓越能力.

![NSA 64K Needle-in-a-Haystack（论文 Figure 5）](./images/fig-nsa-05-niah-results.jpg)

> 图 6: 64K NIAH 全深度高召回热力图（论文 Figure 5）。

**图 6 解析**

- **热力图坐标**：横轴为上下文长度（至 64K），纵轴为 needle 插入深度（0–100%）；全图高亮表示 **全深度全长度完美召回**。
- **机制归因**：cmp 分支做全局粗扫，slc 分支在高分块上做细粒度 attention，win 分支保底局部 — 单针事实不会被压缩 alone 抹掉。
- **与图 5 损失对照**：预训练 loss 略优 + NIAH 满分 — 证明稀疏模式学到了 **可用的长程检索**，非过拟合 benchmark。
- **局限**：NIAH 是单针、单跳；真实 RAG 多针多跳时仍需调大 $n$ 或 $w$ — LongBench 子项可交叉验证。
- **部署**：若生产 NIAH 探针出现远端条带 — 优先检查 **slc 块大小 $l'$** 与 **固定激活的首块/本地块** 配置是否过 aggressive。

- **推理能力提升**: NSA不仅在效率方面表现出色,在复杂推理任务中更是展现了超越基线方法的能力. 例如,在GSM8K数学应用题基准测试中,NSA获得了0.520的分数,相比全注意力方法的0.486实现了显著提升. 在AIME竞赛数学任务中,经过数学推理监督微调的NSA-R模型大幅超越了全注意力-R模型,在16k生成限制下分别获得0.146和0.092的分数. 

论文分析认为,这种性能提升源于稀疏机制强制模型专注于最重要的信息,有效过滤了噪声信息并增强了推理路径的质量. 

## 5. 总结

原生稀疏注意力(NSA)机制远超传统的渐进式技术改进,代表了高效AI模型设计的根本性范式转变. 它通过将直观的算法设计与深度硬件优化相结合,在保持模型性能的同时实现了显著的效率提升. 

NSA的成功可以归结为两个核心技术原则: 

- **算法智能化设计原则**: NSA避免了暴力计算的简单路径,通过构建本地(滑动窗口)、摘要(令牌压缩)和详细(令牌选择)三个层次的分层视图,在最适合的粒度级别高效处理信息. 计算资源的重用策略,特别是摘要分数指导详细搜索的机制,成为其设计理念的重要特征.

- **算法与硬件的协同优化原则**: 算法的实际性能完全取决于其实现质量. NSA的技术成功源于其计算步骤与现代GPU架构优势的完美匹配——通过最小化低速内存访问并保持强大计算核心的高利用率,实现了理论优势向实际性能的有效转化. 

通过同时掌握这两个关键要素,NSA实现了技术发展的最终目标: 以极小的计算成本处理大规模上下文信息,同时达到最先进的性能水平. 这为未来的技术发展提供了强有力的指导框架,证明了构建更强大和更可扩展AI系统的路径不仅在于增大模型规模,更在于构建更智能、更高效的技术架构. 

## 6. 可运行参考实现（NumPy）

`project/experiments/nsa-sparse-attention/` 对齐论文式 (5)(7)(8)(9)(11)(12)：**MLP $\phi$ 块压缩**、$p^{\mathrm{cmp}}\!\to\!p^{\mathrm{slc}}$、top-$n$ 选块、滑动窗口、$\mathrm{sigmoid}(\mathrm{MLP}(x_t))$ 门控后 **三支路各自 softmax 再加权**（见 `README.md` 中「未实现」列表，不含 Triton/GQA cache）。

```powershell
cd project/experiments/nsa-sparse-attention
pip install -r requirements.txt
python run_demo.py
```

`run_demo.py` 校验 win/cmp 单支路与 $p^{\mathrm{slc}}=p^{\mathrm{cmp}}$（$l'=l=d$）；与 Full Attention 不同属预期。

## 7. 参考文献

- Yuan, J., Gao, H., Dai, D., et al. (2025). Native Sparse Attention: Hardware-Aligned and Natively Trainable Sparse Attention. *arXiv:2502.11089v2*.

## 8. DeepSeek Sparse Attention (DSA)：NSA 的推理侧插件式变体

> 延伸阅读：DSA 为 DeepSeek-V3.2-Exp 等模型在 **MLA 之上** 的推理稀疏插件，与上文 NSA（原生三分支稀疏训练）路线不同。技术细节以官方报告为准：[DeepSeek-V3.2-Exp](https://github.com/deepseek-ai/DeepSeek-V3.2-Exp)。

### 1. 演进脉络：从 NSA 到 DSA

### 1.1 DeepSeek 的稀疏注意力路线

| 阶段 | 方法 | 状态 | 特点 |
|------|------|------|------|
| 2024 | NSA (Native Sparse Attention) | 论文发表 | 硬件对齐的稀疏注意力, 训练感知 |
| 2025 | **DSA** (DeepSeek Sparse Attention) | **实战部署** | 基于 MLA 的插件式稀疏选择, 推理优化 |

DSA 的核心定位：**不降显存、降计算**——通过 Indexer 模块计算 KV 重要性分数, 筛选 Top-K 参与 Attention, 将复杂度从 $O(L^2)$ 降至 $O(L \cdot k)$. 

### 1.2 与早期稀疏注意力的区别

| 维度 | 早期方法 (Longformer/BigBird) | DSA |
|------|------------------------------|-----|
| 稀疏模式 | 预定义(局部+全局+随机) | 动态选择(基于内容相关性) |
| 与 Attention 关系 | 替代 Attention | **插件式增强**(包裹 MLA) |
| 训练需求 | 需从头训练 | 可插入预训练模型 |
| 位置编码 | 复杂适配 | 复用 MLA 的解耦 RoPE |

---

## 2. DSA 架构设计

### 2.1 整体结构

DSA 在 MLA 基础上新增 **Lightning Indexer** 模块, 形成两级结构：

```
Input Hidden States
    ├─→ Indexer(轻量选择器)
    │   ├─→ 计算 Q^I, K^I, W^I
    │   ├─→ FP8 量化 + Hadamard 变换
    │   ├─→ 计算 Index Score
    │   └─→ Top-K 选择 → topk_indices
    │
    └─→ MLA(核心注意力)
        ├─→ 标准 MLA 计算 Q, K, V
        ├─→ 用 topk_indices 筛选 KV
        └─→ 稀疏 Attention 输出
```

### 2.2 Indexer 模块详解

**输入**：
- $x$：当前层的 hidden states(维度 7168)
- $q_r$：MLA 的 latent query(经过 $W^{DQ}$ 降维后的 $c_t^Q$, 维度 1536)

**三条计算通道**：

$$
q^I = W^{Q,I} \cdot q_r \quad \text{(从 MLA latent 升维, 64 heads × 128 dim)}
$$

$$
k^I = W^{K,I} \cdot x \quad \text{(从 hidden states 投影, 1 head × 128 dim)}
$$

$$
w^I = W^{W,I} \cdot x \quad \text{(重要性权重, 64 heads)}
$$

**RoPE 处理**：与 MLA 一致的解耦方式——$q^I$ 和 $k^I$ 均分为 PE/Nope 两部分, 仅对 PE 分量应用旋转编码. 

**核心公式：Index Score**

$$
I_{t,s} = \sum_{j=1}^{H^I} w_{t,j}^I \cdot \text{ReLU}(q_{t,j}^I \cdot k_s^I)
$$

其中 $H^I = 64$ 是 Indexer 的 head 数, $k_s^I$ 是历史位置 $s$ 的 Key. 

**物理意义**：对当前 token 的每个 Indexer head, 计算其与所有历史 token 的相关性, 加权求和得到重要性分数. 没有 softmax, 计算轻量. 

### 2.3 FP8 量化与 Hadamard 变换

**量化动机**：Index Score 涉及 $[q_{\text{seq}}, 64, 128] \times [k_{\text{cache}}, 128]$ 的矩阵乘法, 长序列下计算量和显存占用大. 

**实现细节**：
- $q, k$ 量化到 FP8(E4M3 格式)
- 通过 **Hadamard 变换** 处理 outliers：对 $q, k$ 施加随机正交变换, 使数据分布更均匀, 减少量化误差
- scale 按 block(64 tokens)存储, 与数据分离

```python

q_fp8, q_scale = act_quant(q, block_size=64, scale_fmt="ue8m0")
k_fp8, k_scale = act_quant(k, block_size=64, scale_fmt="ue8m0")


index_score = fp8_index(q_fp8, weights, k_fp8, k_scale)
```

### 2.4 Top-K 选择与稀疏 Attention

**Top-K 阈值**：默认 $k = 2048$. 当序列长度 $< 2048$ 时, 跳过 Indexer, 直接使用完整 MLA. 

**稀疏实现方式**：

| 方式 | 原理 | 计算节省 | 实现复杂度 |
|------|------|---------|-----------|
| **Mask 修改** | 将未选中位置的 attention score 设为 $-\infty$ | 无(仅减少 softmax 后的有效值) | 低 |
| **选择数据加载**(推荐) | 仅加载 Top-K 的 KV 进入 Attention 计算 | 是($O(L^2) \to O(Lk)$) | 中 |

Prefill 阶段(MHA 模式)：每个 head 独立计算, $Q = [1, \text{head\_dim}]$, $K = [k, \text{head\_dim}]$

Decode 阶段(MQA 模式)：seq_len = 1, $Q = [\text{heads}, 1, \text{head\_dim}]$, $K = [k, \text{head\_dim}]$

---

## 3. 性能分析

### 3.1 计算量对比

**MLA 的 Attention FLOPs**：

$$
\text{KV\_scores} = 2 \cdot bs \cdot heads \cdot seq \cdot (seq + cache) \cdot (qk\_dim) / 2
$$

$$
\text{QKV} = 2 \cdot bs \cdot heads \cdot seq \cdot (seq + cache) \cdot v\_dim / 2
$$

**DSA 的 Attention FLOPs**(将 $seq + cache$ 替换为 $top\_k$)：

$$
\text{KV\_scores\_DSA} = 2 \cdot bs \cdot heads \cdot seq \cdot top\_k \cdot qk\_dim / 2
$$

$$
\text{QKV\_DSA} = 2 \cdot bs \cdot heads \cdot seq \cdot top\_k \cdot v\_dim / 2
$$

**Indexer 额外 FLOPs**：

| 计算 | 复杂度 | 说明 |
|------|--------|------|
| Q/K/W 线性投影 | $O(L)$ | 与序列长度线性相关 |
| FP8 Logits 计算 | $O(L^2)$ | 当序列 $> 6.2K$ 时占主导 |
| Top-K 排序 | $O(L \cdot k)$ | 快速选择算法 |

### 3.2 Prefill 阶段

- **序列 $< 6.2K$**：Indexer 计算量占比 $< 20\%$, DSA 整体算力显著低于 MLA
- **序列 $> 6.2K$**：Logits 运算成为瓶颈, 但 Attention 部分仍保持 $O(Lk)$
- **趋势**：随着序列增长, DSA 算力需求近似线性增长, 而 MLA 呈平方增长

### 3.3 Decode 阶段

- **核心优势**：当序列超过 $top\_k$(2048)后, MLA 部分计算量**不再增加**
- **Indexer 开销**：seq_len = 1, 计算量恒定, 与 cache 长度线性相关
- **整体趋势**：DSA 基本维持恒定, MLA 线性增加

### 3.4 显存分析

**静态显存增加**：

Indexer 权重存储(FP16)：

$$
\text{Mem} = 2 \times (7168 \times 64 + 1536 \times 64 \times 128 + 7168 \times 128) \text{ bytes} \approx 26.6 \text{ MB}
$$

**激活值峰值**(Prefill 阶段)：

| 张量 | 形状 | 128K 序列 FP32 | 128K 序列 FP8 |
|------|------|---------------|--------------|
| Logits | $[64, 128K, 128K]$ | 3906 GB | 977 GB |
| Index Scores | $[128K, 128K]$ | 30.5 GB | 7.6 GB |

**关键洞察**：超长序列(128K)下, Indexer 的 logits 激活值是显存杀手. 实际部署中需采用：
- FP8/FP16 存储
- TP(Tensor Parallel)按 head 切分
- 序列并行(SP)分散数据

**KV Cache 变化**：

| 组件 | MLA | DSA 额外 | 变化 |
|------|-----|---------|------|
| KV Cache | $c_t^{KV}, k_t^R$ | 不变 | — |
| Indexer K Cache | — | $k_{fp8}^I, k_{scale}^I$ | +129 bytes/token |

Indexer 不降低 KV Cache 存储, 但降低访存量(仅加载 Top-K). 

---

## 4. 推理优化策略

### 4.1 计算优化

| 优化点 | 方法 | 收益 |
|--------|------|------|
| 算子融合 | MLA 的 QKV 下采样与 Indexer 的 $W^K$ 采样合并 | 减少一次 Linear 运算 |
| 量化合并 | Q/K 量化与 logits 运算合并 | 减少算子下发次数 |
| TP 并行 | Indexer logits 按 head 切分 | 线性扩展 |
| 短路逻辑 | 序列 $< top\_k$ 时跳过 Indexer | 避免无效计算 |

### 4.2 显存优化

| 优化点 | 方法 | 收益 |
|--------|------|------|
| 存储格式 | Index scores 用 FP8/FP16 | 降低 2-4x |
| 原地操作 | Top-K 排序采用原地算法 | 避免额外内存分配 |
| 避免 Mask 构造 | 不生成完整掩码张量 | 减少临时变量 |
| 动态切换 | 超长序列显存不足时回退 MLA | 保证服务稳定性 |

### 4.3 分布式推理

- **TP(Tensor Parallel)**：Indexer 的 logits 运算天然可按 head 切分, sum 运算替换为 all-reduce
- **SP(Sequence Parallel)**：Indexer 无序列维度耦合, 与整体 SP 兼容
- **PD 分离**：Indexer 的 K Cache 与 MLA 的 KV Cache 在物理层独立存储, prefix cache 逻辑保持一致

---

## 5. 源码解析

### 5.1 Indexer 核心实现

```python
class Indexer(torch.nn.Module):
    def __init__(self, args: ModelArgs):
        super().__init__()
        self.n_heads = args.index_n_heads      # 64
        self.head_dim = args.index_head_dim    # 128
        self.index_topk = args.index_topk      # 2048
        self.rope_head_dim = args.qk_rope_head_dim  # 64
        
        # 三条投影通道
        self.wq_b = Linear(args.q_lora_rank, self.n_heads * self.head_dim)
        self.wk = Linear(args.dim, self.head_dim)
        self.weights_proj = Linear(args.dim, self.n_heads)
        
        # FP8 Cache: k_fp8 (128 bytes/token) + k_scale (1 byte/token)
        self.register_buffer("k_cache", 
            torch.zeros(args.max_batch_size, args.max_seq_len, self.head_dim, 
                       dtype=torch.float8_e4m3fn), persistent=False)
        self.register_buffer("k_scale_cache",
            torch.zeros(args.max_batch_size, args.max_seq_len, self.head_dim // 64,
                       dtype=torch.float32), persistent=False)

    def forward(self, x, qr, start_pos, freqs_cis, mask=None):
        bsz, seqlen, _ = x.size()
        end_pos = start_pos + seqlen
        
        # Q 路径：从 MLA latent 升维
        q = self.wq_b(qr)
        q = rearrange(q, 'b s (h d) -> b s h d', d=self.head_dim)
        q_pe, q_nope = torch.split(q, [self.rope_head_dim, self.head_dim - self.rope_head_dim], dim=-1)
        q_pe = apply_rotary_emb(q_pe, freqs_cis)
        q = torch.cat([q_pe, q_nope], dim=-1)
        
        # K 路径：从 hidden states 投影
        k = self.wk(x)
        k = self.k_norm(k)
        k_pe, k_nope = torch.split(k, [self.rope_head_dim, self.head_dim - self.rope_head_dim], dim=-1)
        k_pe = apply_rotary_emb(k_pe.unsqueeze(2), freqs_cis).squeeze(2)
        k = torch.cat([k_pe, k_nope], dim=-1)
        
        # Hadamard 变换 + FP8 量化
        q = rotate_activation(q)
        k = rotate_activation(k)
        q_fp8, q_scale = act_quant(q, block_size=64, scale_fmt="ue8m0")
        k_fp8, k_scale = act_quant(k, block_size=64, scale_fmt="ue8m0")
        
        # 缓存量化后的 K
        self.k_cache[:bsz, start_pos:end_pos] = k_fp8
        self.k_scale_cache[:bsz, start_pos:end_pos] = k_scale
        
        # 计算重要性权重
        weights = self.weights_proj(x) * self.n_heads ** -0.5
        weights = weights.unsqueeze(-1) * q_scale * self.softmax_scale
        
        # FP8 Index Score 计算
        index_score = fp8_index(q_fp8, weights, 
                               self.k_cache[:bsz, :end_pos],
                               self.k_scale_cache[:bsz, :end_pos])
        if mask is not None:
            index_score += mask
        
        # Top-K 选择
        topk_indices = index_score.topk(min(self.index_topk, end_pos), dim=-1)[1]
        return topk_indices
```

### 5.2 MLA + Indexer 的协同

```python

if mask is not None:
    # 标准 MLA Attention 计算
    scores = torch.einsum("bshd,bthd->bsht", q, k) * self.softmax_scale
    
    # Indexer 选择 Top-K
    topk_indices = self.indexer(x, qr, start_pos, freqs_cis, mask)
    
    # 构造稀疏掩码：未选中位置设为 -inf
    index_mask = torch.full((bsz, seqlen, seqlen), float("-inf"), device=x.device)
    index_mask = index_mask.scatter_(-1, topk_indices, 0)
    index_mask += mask
    scores += index_mask.unsqueeze(2)
    
    scores = scores.softmax(dim=-1, dtype=torch.float32)
    output = torch.einsum("bsht,bthd->bshd", scores, v)


else:
    # 矩阵吸收版本 MLA
    q_nope = torch.einsum("bshd,hdc->bshc", q_nope, wkv_b[:, :self.qk_nope_head_dim])
    scores = (torch.einsum("bshc,btc->bsht", q_nope, self.kv_cache[:bsz, :end_pos]) +
              torch.einsum("bshr,btr->bsht", q_pe, self.pe_cache[:bsz, :end_pos])) * self.softmax_scale
    
    # Indexer 稀疏化
    topk_indices = self.indexer(x, qr, start_pos, freqs_cis, mask)
    index_mask = torch.full((bsz, 1, end_pos), float("-inf"), device=x.device)
    index_mask = index_mask.scatter_(-1, topk_indices, 0)
    scores += index_mask.unsqueeze(2)
    
    scores = scores.softmax(dim=-1, dtype=torch.float32)
    output = torch.einsum("bsht,btc->bshc", scores, self.kv_cache[:bsz, :end_pos])
    output = torch.einsum("bshc,hdc->bshd", output, wkv_b[:, -self.v_head_dim:])
```

---

## 6. 边界条件与失效模式

| 场景 | 症状 | 根因 | 缓解 |
|------|------|------|------|
| 序列 $< top\_k$ | Indexer 纯开销, 无收益 | 短序列无需稀疏选择 | 短路逻辑：直接跳过 Indexer |
| Indexer 占比 $> 20\%$ | 整体性能不升反降 | Top-K 过小或序列过长导致 logits 计算 dominant | 放弃 DSA, 回退 MLA |
| FP8 量化误差大 | Top-K 选择错误, Attention 质量下降 | Outliers 导致量化精度损失 | Hadamard 变换 + 动态 scale |
| 超长序列显存溢出 | OOM | Logits 激活值 $O(L^2)$ | TP 切分 + FP8 存储 + 序列并行 |
| 分布式一致性 | Top-K 结果在不同 rank 间不一致 | 浮点精度差异 | 广播 rank-0 的 topk_indices 并校验 |

---

## 7. 技术前瞻

1. **Indexer 与 MLA 的深度融合**：当前 DSA 是插件式架构, 未来可能将 Indexer 的投影矩阵与 MLA 的降维矩阵合并, 进一步减少计算冗余
2. **动态 Top-K**：固定 $k=2048$ 对所有层和 token 一视同仁, 未来可能引入输入相关的动态 $k$
3. **与线性注意力的结合**：DSA 的稀疏选择 + Linear Attention 的 $O(L)$ 复杂度, 可能实现超长效推理
4. **训练时稀疏**：当前 DSA 主要优化推理, 训练时仍用 Full Attention. 未来探索训练感知的稀疏策略

---

## 8. 工程细节补充

### 8.1 Hadamard 变换与 FP8 量化

**为什么需要 `rotate_activation`？**

Indexer 中的 $q, k$ 在量化前经过 Hadamard 变换：

$$
\tilde{q} = q \cdot H / \sqrt{n}, \quad \tilde{k} = k \cdot H / \sqrt{n}
$$

其中 $H$ 是 Hadamard 矩阵, 满足 $HH^T = H^TH = nI$. 

**正确性保证**：

$$
(qH)(kH)^T = qHH^Tk^T = q(nI)k^T = n \cdot qk^T
$$

除以 $\sqrt{n}$ 后, 内积结果不变. 

**量化收益**：Hadamard 变换将输入维度上的相关性打散, 使各分量更接近独立均匀分布, **显著降低 outliers**, 提升 FP8 量化精度. 

### 8.2 显存占用精确计算

以 DeepSeek-V3.2-671B 配置为例：

| 组件 | 每 token 存储 | 数据类型 |
|------|-------------|---------|
| MLA KV Cache | $(512 + 64) \times 4 = 2304$ bytes | FP32(Attention 需高精度) |
| Indexer K Cache | $128$ bytes | FP8 |
| Indexer K Scale | $128 / 64 = 2$ bytes | FP32(按 block 存储) |
| **Indexer 总计** | **130 bytes** | — |

**新增显存占比**：$130 / 2304 \approx 5.6\%$——新增 Indexer 的存储开销极小. 

### 8.3 训练方法

在已有 MLA 预训练模型基础上, 新增 Indexer 进行**继续训练**：

**Phase 1：Indexer 预热**
- 冻结 MLA 及其他所有参数
- 只训练 Indexer
- 不选取 Top-K(使用全部 token)
- Loss：$\mathcal{L} = \sum_t D_{KL}(p_{t,:} || \text{softmax}(I_{t,:}))$
  - $p_{t,:} = \text{softmax}(QK^T)$：MLA 的真实注意力分布
  - $I_{t,:}$：Indexer 预测的重要性分数
- 目标：让 Indexer 学会预测哪些 token 是重要的

**Phase 2：全量微调**
- 解冻所有参数
- Indexer 选取 Top-K = 2048
- Loss 相同, 但只计算 Top-K token 上的 KL 散度
- 使模型适应稀疏 Attention 的分布

**后训练**：
- 专家蒸馏(Specialist Distillation)：为数学、竞赛编程、逻辑推理等任务训练专家模型
- 混合 RL 训练：使用 GRPO 算法进行强化学习

### 8.4 MHA Mode vs MQA Mode 的选择

| 阶段 | 模式 | 原因 |
|------|------|------|
| **Prefill / Training** | MHA | 序列并行度高, 矩阵乘法形状利于 Tensor Core; 短序列下效率更高 |
| **Decode** | MQA | seq_len = 1, MQA 减少 KV Cache 访存; 长序列下计算量恒定 |

**短序列 Prefill 的特殊处理**：当序列长度 $< 2048$ 时, 使用 masked MHA mode 模拟 DSA(无需 Indexer, 直接全量计算). 

**长序列 Prefill 流程**：
1. Indexer 并行计算所有 token 的 score($O(L^2)$ 但 head 数少)
2. 每个 token 独立取 Top-2048(GPU warp 并行)
3. Gather 收集每个 token 的 2048 个 KV(稀疏→稠密小块)
4. 对连续的 $K_{sel}, V_{sel}$ 做标准 Attention 计算

### 8.5 计算成本对比(671B 模型)

**FFN(MoE)层**(58 层 MoE + 3 层 Dense)：

$$
\text{FFN\_FLOPs} = 58 \times (8 \times 3 \times 7168 \times 2048 + 3 \times 7168 \times 2048) + 3 \times 3 \times 7168 \times 18432 \approx 24.3 \text{ GFLOPs/token}
$$

**Attention 层**(61 层)：

| 模式 | FLOPs/token |
|------|------------|
| MLA (MQA) | $61 \times (11M + 37M + 8M + 4M + 8M + 117M) \approx 11.4$ GFLOPs |
| MLA (MHA) | 与 MQA 相同(低秩压缩后计算量一致) |
| **DSA (稀疏后)** | **显著降低**(随序列长度超过 2048 后恒定) |

**核心结论**：DSA 将 Attention 复杂度从 $O(L^2)$ 降至 $O(L \cdot k)$, 虽然 Indexer 仍有 $O(L^2)$ 计算, 但其 head 数(64)和 head_dim(128)远小于 MLA(128 heads, 192 dim), 实际计算量占比 $< 20\%$. 

---

## 9. 参考文献（DSA 延伸阅读）

1. DeepSeek-AI. (2025). DeepSeek-V3.2-Exp Technical Report. https://github.com/deepseek-ai/DeepSeek-V3.2-Exp
2. Yuan, J., et al. (2025). Native Sparse Attention. arXiv:2502.11089 — 见上文 §6