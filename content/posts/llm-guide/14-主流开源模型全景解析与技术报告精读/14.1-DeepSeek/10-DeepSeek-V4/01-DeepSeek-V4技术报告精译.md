---
title: "01 · DeepSeek-V4 技术报告精译"
---

# DeepSeek-V4: 面向高效百万 Token 上下文智能

>  **[返回 14.1-DeepSeek 家族总览](../../14.1-DeepSeek.md)**


> 原文标题: DeepSeek-V4: Towards Highly Efficient Million-Token Context Intelligence
> 作者: DeepSeek-AI
> 原文链接: https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro/blob/main/DeepSeek_V4.pdf
> 发布日期: 2026 年 4 月 24 日
> 精译日期: 2026 年 5 月 18 日

---

## 摘要

我们发布了 DeepSeek-V4 系列的预览版本,包括两个强大的混合专家(MoE)语言模型:DeepSeek-V4-Pro(1.6T 参数,49B 激活)和 DeepSeek-V4-Flash(284B 参数,13B 激活),两者均支持 100 万 token 的上下文长度。DeepSeek-V4 系列在架构和优化方面引入了若干关键升级:(1) 混合注意力架构,结合 Compressed Sparse Attention(CSA)和 Heavily Compressed Attention(HCA)以提升长上下文效率;(2) Manifold-Constrained Hyper-Connections(mHC),增强传统残差连接;(3) Muon 优化器,实现更快的收敛速度和更高的训练稳定性。我们在超过 32T 的高质量多样化 token 上预训练了这两个模型,随后通过全面的后训练流程解锁并进一步增强其能力。DeepSeek-V4-Pro-Max(DeepSeek-V4-Pro 的最大推理努力模式)重新定义了开源模型的最先进水平,在核心任务上超越了前代模型。同时,DeepSeek-V4 系列在长上下文场景中具有极高的效率。在 100 万 token 上下文设定下,DeepSeek-V4-Pro 仅需 DeepSeek-V3.2 单 token 推理 FLOPs 的 27% 和 KV Cache 的 10%。这使我们能够常规性地支持 100 万 token 上下文,从而让长程任务和进一步的测试时扩展变得更加可行。模型权重可在 https://huggingface.co/collections/deepseek-ai/deepseek-v4 获取。

---

## 1 引言

推理模型的出现(DeepSeek-AI, 2025; OpenAI, 2024c)确立了测试时扩展的新范式,为大语言模型(LLM)带来了显著的性能提升。然而,这一扩展范式从根本上受到标准注意力机制二次计算复杂度的制约(Vaswani et al., 2017),这在超长上下文和推理过程中形成了 prohibitive 的瓶颈。与此同时,长程场景和任务的出现——从复杂的 Agent 工作流到大规模的跨文档分析——也使得对超长上下文的高效支持成为未来进展的关键。尽管近期的开源努力(Bai et al., 2025a; DeepSeek-AI, 2024; MiniMax, 2025; Qwen, 2025)推进了通用能力,但处理超长序列的核心架构低效性仍然是一个关键障碍,限制了测试时扩展的进一步收益,并阻碍了对长程场景和任务的深入探索。

为打破超长上下文的效率壁垒,我们开发了 DeepSeek-V4 系列,包括预览版本的 DeepSeek-V4-Pro(1.6T 参数,49B 激活)和 DeepSeek-V4-Flash(284B 参数,13B 激活)。通过架构创新,DeepSeek-V4 系列在处理超长序列的计算效率上实现了飞跃式提升。这一突破使得高效支持 100 万 token 上下文长度成为可能,为下一代 LLM 开启了百万长度上下文的新时代。我们相信,高效处理超长序列的能力解锁了测试时扩展的下一个前沿,为长程任务的深入研究铺平了道路,并为探索在线学习等未来范式奠定了必要基础。

与 DeepSeek-V3 架构(DeepSeek-AI, 2024)相比,DeepSeek-V4 系列保留了 DeepSeekMoE 框架(Dai et al., 2024)和 Multi-Token Prediction(MTP)策略,同时在架构和优化方面引入了若干关键创新。为增强长上下文效率,我们设计了结合 Compressed Sparse Attention(CSA)和 Heavily Compressed Attention(HCA)的混合注意力机制。CSA 沿序列维度压缩 KV Cache,然后执行 DeepSeek Sparse Attention(DSA)(DeepSeek-AI, 2025);而 HCA 对 KV Cache 应用更激进的压缩,但保持稠密注意力。为增强建模能力,我们引入了 Manifold-Constrained Hyper-Connections(mHC)(Xie et al., 2026)以升级传统残差连接。此外,我们在 DeepSeek-V4 系列的训练中引入了 Muon 优化器(Jordan et al., 2024; Liu et al., 2025),带来更快的收敛速度和改进的训练稳定性。

> **译者思考：设计动机**
>
> DeepSeek-V4 的核心问题非常清晰:"如何在保持模型能力的同时,将上下文窗口扩展到 100 万 token,并让推理成本可控?"
>
> 这个问题的答案不是一个简单的技巧,而是一个系统性的工程决策链:
>
> **Step 1: 混合注意力架构**。标准 softmax attention 的二次复杂度是长上下文的主要瓶颈。DeepSeek-V4 没有选择单一的注意力机制,而是设计了 CSA + HCA 的混合架构。CSA 负责"精准找相关"(压缩 + 稀疏选择),HCA 负责"全局不遗漏"(极度压缩 + 稠密注意力)。这种分层压缩策略将注意力复杂度从 O(N^2) 降到接近 O(N)。
>
> **Step 2: 残差连接升级**。mHC 将残差映射约束到双随机矩阵流形(Birkhoff polytope),确保谱范数有界,从而增强深层网络的信号传播稳定性。这对于万亿参数规模的模型至关重要。
>
> **Step 3: 优化器革新**。Muon 优化器通过 Newton-Schulz 迭代近似正交化梯度更新矩阵,相比 AdamW 收敛更快、更稳定。在 32T+ token 的预训练规模下,优化器的稳定性直接决定训练能否成功。
>
> **Step 4: 精度优化**。FP4 量化感知训练用于 MoE 专家权重和 CSA 索引器 QK 路径,进一步减少内存占用和计算量。混合精度(BF16 for RoPE, FP8 for others)将 KV Cache  size 再砍半。
>
> **Step 5: 后训练范式**。两步后训练——先独立培育领域专家(数学/代码/Agent/指令遵循),再通过 on-policy distillation 统一融合。这避免了多目标 RL 的权衡问题。
>
> 一个关键的效率数字:在 1M token 上下文中,V4-Pro 的 KV Cache 仅为 V3.2 的 10%。这意味着同样的 GPU 可以服务 10 倍的并发长上下文请求——从"实验室演示"到"生产可用"的质变。

为支持 DeepSeek-V4 系列的高效训练与推理以及高效的开发,我们引入了若干基础设施优化。首先,我们设计并实现了 MoE 模块的单一融合内核,完全重叠计算、通信和内存访问。其次,我们采用 TileLang(Wang et al., 2026),一种领域特定语言(DSL),以平衡开发效率和运行效率。第三,我们提供高效的 batch-invariant 和确定性内核库,确保训练和推理之间的逐位可复现性。第四,对于训练框架,我们扩展了 autograd 框架以支持张量级别的 checkpointing,实现细粒度重计算控制;并通过 Muon 优化器的混合 ZeRO 策略、mHC 的低成本重计算和融合内核实现,以及管理压缩注意力的两阶段上下文并行,增强训练效率。第五,对于推理框架,我们设计了异构 KV Cache 结构以及磁盘存储策略,以实现高效共享前缀复用。此外,在后训练阶段,我们引入了对 MoE 专家权重和索引器 QK 路径的 FP4 量化感知训练,以减少内存和计算。

通过采用混合 CSA 和 HCA,以及计算和存储的精度优化,DeepSeek-V4 系列相比 DeepSeek-V3.2 实现了显著更低的推理 FLOPs 和大幅减少的 KV Cache  size,尤其在长上下文场景中。图 1 左侧展示了 DeepSeek-V4-Pro-Max 与同类模型的基准测试对比;右侧展示了 DeepSeek-V3.2 和 DeepSeek-V4 系列的估计单 token 推理 FLOPs 和累积 KV Cache  size。

![图 1: 左: DeepSeek-V4-Pro-Max 与同类模型在知识、推理和 Agent 能力上的基准测试对比。右: DeepSeek-V3.2 与 DeepSeek-V4 系列的单 token 推理 FLOPs 和累积 KV Cache  size 对比,在 1M token 上下文中 V4-Pro 的 FLOPs 仅为 V3.2 的 27%,KV Cache 仅为 10%。](./assets/figure_01.png)

> 图 1: 左: DeepSeek-V4-Pro-Max 与同类模型在知识、推理和 Agent 能力上的基准测试对比。右: DeepSeek-V3.2 与 DeepSeek-V4 系列的单 token 推理 FLOPs 和累积 KV Cache  size 对比,在 1M token 上下文中 V4-Pro 的 FLOPs 仅为 V3.2 的 27%,KV Cache 仅为 10%。在 1M token 上下文场景中,即使是激活参数更多的 DeepSeek-V4-Pro,也仅达到 DeepSeek-V3.2 单 token FLOPs(以等效 FP8 FLOPs 计)的 27% 和 KV Cache  size 的 10%。此外,激活参数更少的 DeepSeek-V4-Flash 将效率推向更高:在 1M token 上下文设定下,它仅达到 DeepSeek-V3.2 单 token FLOPs 的 10% 和 KV Cache  size 的 7%。另外,对于 DeepSeek-V4 系列,路由专家参数采用 FP4 精度。虽然现有硬件上 FP4 × FP8 操作的峰值 FLOPs 与 FP8 × FP8 相同,但理论上在未来硬件上可以实现 1/3 的效率提升,这将进一步增强 DeepSeek-V4 系列的效率。

在预训练期间,我们分别在 32T token 上训练 DeepSeek-V4-Flash,在 33T token 上训练 DeepSeek-V4-Pro。预训练后,这两个模型可以原生且高效地支持 1M 长度上下文。在我们的内部评估中,DeepSeek-V4-Flash-Base 已经以其更高效的参数设计在大多数基准上超越了 DeepSeek-V3.2-Base。DeepSeek-V4-Pro-Base 进一步扩展了这一优势,为 DeepSeek 基础模型树立了新的性能标准,在推理、编码、长上下文和世界知识任务上实现了全面的优越性。

DeepSeek-V4 系列的后训练流程采用两步范式:独立培养领域特定专家,然后通过 on-policy distillation 进行统一模型整合(Gu et al., 2024; Lu and Lab, 2025)。最初,对于每个目标领域——如数学、编码、Agent 和指令遵循——单独训练一个专家模型。基础模型首先在高质量领域特定数据上接受监督微调(SFT),建立基础能力。随后,使用 Group Relative Policy Optimization(GRPO)(DeepSeek-AI, 2025)应用强化学习(RL),在针对特定成功标准定制的奖励模型指导下,进一步优化模型的领域对齐行为。这一阶段产生了多样化的专业专家集合,每个都在其 respective 领域表现出色。最后,为了整合这些不同的专业能力,通过 on-policy distillation 训练一个统一模型,其中统一模型作为学生,学习优化与教师模型的 reverse KL  loss。

### 核心评估结果摘要

- **知识**: 在广泛世界知识评估中,DeepSeek-V4-Pro-Max 在 SimpleQA(OpenAI, 2024d)和 Chinese-SimpleQA(He et al., 2024)基准上显著超越领先的开源模型。在教育知识方面——通过 MMLU-Pro(Wang et al., 2024b)、HLE(Phan et al., 2025)和 GPQA(Rein et al., 2023)评估——DeepSeek-V4-Pro-Max 对其开源对手保持微弱领先。尽管仍有差距,DeepSeek-V4-Pro-Max 已显著缩小与领先闭源模型 Gemini-3.1-Pro 的差距。
- **推理**: 通过扩展推理 token,DeepSeek-V4-Pro-Max 在标准推理基准上相对于 GPT-5.2 和 Gemini-3.0-Pro 展示了优越性能。然而,其性能略低于 GPT-5.4 和 Gemini-3.1-Pro,暗示其发展轨迹落后最前沿模型约 3 到 6 个月。此外,DeepSeek-V4-Flash-Max 在分配更大思考预算时,在推理任务上取得了与 GPT-5.2 和 Gemini-3.0-Pro 相当的结果,成为复杂推理任务的高性价比架构。
- **Agent**: 在公共基准上,DeepSeek-V4-Pro-Max 与 Kimi-K2.6 和 GLM-5.1 等领先开源模型持平,但略逊于前沿闭源模型。在我们的内部评估中,DeepSeek-V4-Pro-Max 超越 Claude Sonnet 4.5,接近 Opus 4.5 的水平。
- **长上下文**: DeepSeek-V4-Pro-Max 在合成和真实用例中,以 100 万 token 上下文窗口交付强劲结果,在学术基准上甚至超越 Gemini-3.1-Pro。
- **DeepSeek-V4-Pro vs DeepSeek-V4-Flash**: DeepSeek-V4-Flash-Max 由于参数规模较小,在知识评估中表现较低。然而,在分配更大思考预算时,它在推理任务上取得了可比结果。在 Agent 评估中,虽然 DeepSeek-V4-Flash-Max 在若干基准上匹配 DeepSeek-V4-Pro-Max 的性能,但在更复杂的高难度任务上仍落后于其更大的 counterpart。

---

## 2 架构

总体而言,DeepSeek-V4 系列保留了 Transformer(Vaswani et al., 2017)架构和 Multi-Token Prediction(MTP)模块(DeepSeek-AI, 2024; Gloeckle et al., 2024),同时在 DeepSeek-V3 基础上引入了几个关键升级:(1) 首先,我们引入 Manifold-Constrained Hyper-Connections(mHC)(Xie et al., 2026)以增强传统残差连接;(2) 其次,我们设计了混合注意力架构,通过 Compressed Sparse Attention 和 Heavily Compressed Attention 大幅提升长上下文效率;(3) 第三,我们采用 Muon(Jordan et al., 2024; Liu et al., 2025)作为优化器。对于混合专家(MoE)组件,我们仍采用 DeepSeekMoE(Dai et al., 2024)架构,仅对 DeepSeek-V3 做了 minor 调整。Multi-Token Prediction(MTP)(DeepSeek-AI, 2024; Gloeckle et al., 2024; Li et al., 2024; Qi et al., 2020)配置与 DeepSeek-V3 保持一致。所有其他未指定的细节遵循 DeepSeek-V3(DeepSeek-AI, 2024)中确立的设置。图 2 展示了 DeepSeek-V4 的整体架构,细节描述如下。

![图 2: DeepSeek-V4 系列整体架构。注意力层采用混合 CSA(Compressed Sparse Attention)和 HCA(Heavily Compressed Attention),前馈层采用 DeepSeekMoE,残差连接通过 mHC(Manifold-Constrained Hyper-Connections)增强。](./assets/figure_02.png)

> 图 2: DeepSeek-V4 系列整体架构。注意力层采用混合 CSA(Compressed Sparse Attention)和 HCA(Heavily Compressed Attention),前馈层采用 DeepSeekMoE,残差连接通过 mHC(Manifold-Constrained Hyper-Connections)增强。

### 2.1 继承自 DeepSeek-V3 的设计

**混合专家**。与之前的 DeepSeek 系列模型(DeepSeek-AI, 2024; DeepSeek-AI, 2024)一样,DeepSeek-V4 系列也采用 DeepSeekMoE 范式(Dai et al., 2024)用于前馈网络(FFN),设置细粒度路由专家和共享专家。与 DeepSeek-V3 不同,我们将计算亲和度分数的激活函数从 Sigmoid(·)改为 Sqrt(Softplus(·))。对于负载均衡,我们仍采用辅助损失无关策略(DeepSeek-AI, 2024; Wang et al., 2024a),并辅以轻微的序列级均衡损失以防止单个序列内的极端不平衡。对于 DeepSeek-V4,我们移除了对路由目标节点数量的约束,并仔细重新设计了并行策略以保持训练效率。此外,与 DeepSeek-V3 相比,我们将初始若干 Transformer 块中的稠密 FFN 层替换为采用 Hash 路由(Roller et al., 2021)的 MoE 层。Hash 路由策略根据关于输入 token ID 的预定义哈希函数确定每个 token 的目标专家。

**多 Token 预测**。与 DeepSeek-V3 一样,DeepSeek-V4 系列也设置了 MTP 模块和目标。鉴于 MTP 策略已在 DeepSeek-V3 中得到验证,我们为 DeepSeek-V4 系列不加修改地采用相同策略。

### 2.2 Manifold-Constrained Hyper-Connections

如图 2 所示,DeepSeek-V4 系列引入 Manifold-Constrained Hyper-Connections(mHC)(Xie et al., 2026)以增强相邻 Transformer 块之间的传统残差连接。与 naive Hyper-Connections(HC)(Zhu et al., 2025)相比,mHC 的核心思想是将残差映射约束到特定流形,从而在保持模型表达能力的同时增强跨层信号传播的稳定性。本小节简要介绍标准 HC,并描述我们如何设计 mHC 以实现稳定训练。

**标准 Hyper-Connections**。标准 HC 将残差流的宽度扩展 hc 倍。具体而言,残差流的形状从 $R^d$ 扩展到 $R^{hc·d}$,其中 d 是实际层输入的隐藏大小。令 $r_l = [x_{l,1}; ...; x_{l,hc}] ∈ R^{hc·d}$ 为第 l 层之前的残差状态。HC 引入三个线性映射:输入映射 $W_{pre} ∈ R^{d×(hc·d)}$,残差变换 W_{res} ∈ R^{(hc·d)×(hc·d)},和输出映射 $W_{post} ∈ R^{(hc·d)×d}$。残差状态的更新公式为:

$$
r_{l+1} = W_{res} · r_l + W_{post}^T · F_l(W_{pre}^T · r_l)
$$

其中 $F_l$ 表示第 $l$ 层(例如 MoE 层),其输入和输出形状均为 $R^d$。注意实际层输入 $x_l ∈ R^d$ 也是 $d$ 维的,因此扩展的残差宽度不影响内部层的设计。HC 将残差宽度与实际隐藏大小解耦,提供了一个补充的扩展轴,计算开销极小,因为 $hc$ 通常远小于隐藏大小 $d$。然而,尽管 HC 在提升模型性能方面展示了潜力,我们发现当堆叠多层时训练经常表现出数值不稳定性,这阻碍了 HC 的扩展。

**流形约束残差映射**。mHC 的核心创新是将残差映射矩阵 W_{res} 约束到双随机矩阵流形(Birkhoff polytope)M,从而增强跨层信号传播的稳定性:

$$
W_{res} ∈ M \subseteq \{W ∈ R^{d×d} | W·1 = 1, 1^T·W = 1^T, W ≥ 0\}
$$

这一约束确保映射矩阵的谱范数 $||W_{res}||_2$ 被限制在 1 以内,因此残差变换是非扩张的,增加了前向传播和反向传播期间的数值稳定性。此外,集合 M 在乘法下封闭,这保证了 mHC 深层堆叠场景中的稳定性。另外,输入变换 $W_{pre}$ 和输出变换 $W_{post}$ 也通过 Sigmoid 函数约束为非负和有界,以避免信号抵消的风险。

**动态参数化**。三个线性映射的参数是动态生成的,分解为动态(输入相关)分量和静态(输入无关)分量。给定输入$ r_l ∈ R^{hc·d}$,首先将其展平并归一化: $r̂_l = RMSNorm(vec(r_l)) ∈ R^{1×(hc·d)}$。然后,我们遵循传统 HC 生成无约束的原始参数:

$$
\tilde{W}_{pre} = W_{pre}^{static} ⊙ σ(W_{pre}^{dynamic} · r̂_l^T) + b_{pre}
$$

$$
\tilde{W}_{res} = W_{res}^{static} ⊙ Mat(W_{res}^{dynamic} · r̂_l^T) + b_{res}
$$

$$
\tilde{W}_{post} = W_{post}^{static} ⊙ σ(W_{post}^{dynamic} · r̂_l^T) + b_{post}
$$

其中 $W^{static}$ 和 $W^{dynamic}$ 是可学习参数,$Mat(·)$ 将向量重塑为矩阵,$σ$ 是 Sigmoid 函数。

> **译者思考：架构细节**
>
> mHC 的设计非常精妙。标准残差连接 $x_{l+1} = x_l + F(x_l)$ 在深层网络中面临梯度退化问题。Hyper-Connections 通过扩展残差流宽度提供额外的信号通路,但引入了数值不稳定性。
>
> mHC 的解决方案是"约束":将残差变换矩阵限制在双随机矩阵流形上。双随机矩阵(每行每列和为 1,元素非负)的谱范数天然不超过 1,这意味着信号不会放大也不会消失——这是梯度稳定传播的数学保证。
>
> 动态参数化是另一个关键设计:残差连接的权重不是静态的,而是根据当前输入动态生成。这使得模型可以根据不同输入调整残差路径的强度,同时保持稳定性约束。输入相关的分量通过 Sigmoid 约束在 (0,1) 范围内,确保非扩张性。
>
> 从工程角度看,mHC 的计算开销很小:三个线性映射的维度由 hc(通常很小)控制,额外的计算量相对于万亿参数模型的前向传播可以忽略不计。但带来的稳定性收益是巨大的——没有 mHC,1.6T 参数模型的训练可能会频繁发散。

### 2.3 混合注意力:CSA 与 HCA

为提升长上下文效率,我们设计了一种混合注意力架构,交替使用 Compressed Sparse Attention(CSA)和 Heavily Compressed Attention(HCA)。CSA 通过 token 级压缩器将每 m 个 token 的 KV Cache 压缩为单个条目,然后应用 DeepSeek Sparse Attention(DSA)进行稀疏选择。HCA 对 KV Cache 应用更激进的压缩,但保持稠密注意力。CSA 和 HCA 的层输出维度与标准注意力完全相同,因此它们可以无缝交替堆叠。

#### 2.3.1 Compressed Sparse Attention

![图 3: CSA 核心架构。CSA 通过 token 级压缩器将每 m 个 token 的 KV Cache 压缩为单个条目,然后应用 DeepSeek Sparse Attention(DSA)进行稀疏选择。压缩块之间有一个 token 的重叠以确保因果性。](./assets/figure_03.png)

> 图 3: CSA 核心架构。CSA 通过 token 级压缩器将每 m 个 token 的 KV Cache 压缩为单个条目,然后应用 DeepSeek Sparse Attention(DSA)进行稀疏选择。压缩块之间有一个 token 的重叠以确保因果性。

CSA 的核心流程如下。对于输入隐藏状态 $h ∈ R^{n×d}$,CSA 首先生成两组压缩权重 $Z_a, Z_b ∈ R^{n×c}$ 和两组压缩 KV 条目 $C_a, C_b ∈ R^{n×c}$,其中 c 是压缩维度。然后,对于第 i 个压缩块(包含 m 个连续 token),压缩后的 KV 条目通过加权求和计算:

$$
\hat{K}_i = \sum_{j=(i-1)m+1}^{im} Z_{a,j} ⊙ C_{a,j}, \quad \hat{V}_i = \sum_{j=(i-1)m+1}^{im} Z_{b,j} ⊙ C_{b,j}
$$

其中 ⊙ 表示逐元素乘法。压缩后的 KV 条目数从 n 降至 n/m。

**重叠压缩机制**。为确保因果性,CSA 采用巧妙的重叠压缩策略。对于查询 $token_t$,它只能访问位置小于 $t$ 的 KV 条目。在压缩时,CSA 将序列划分为大小为 $m$ 的块,但相邻块之间有一个 token 的重叠。具体而言,用于生成 $Comp_t$(查询 $token _t$ 可访问的压缩 KV)的 token 索引与用于生成 $Comp_{t+1}$ 的 token 索引是重叠的。因此,CSA 实际上将序列长度压缩为约 $1/m$ 倍。

**Lightning Indexer 稀疏选择**。获得压缩 KV 条目后,CSA 应用 DSA 策略选择 top-k 压缩 KV 条目进行核心注意力计算。首先,CSA 对索引器键执行相同的压缩操作得到压缩索引器键 $I_K^{comp} ∈ R^{(n/m)×d_I}$,其中 $d_I$ 是索引器头维度。然后,对于查询 $token_t$,以低秩方式生成索引器查询:

$$
c_t = h_t · W_c, \quad [q_{t,1}; q_{t,2}; ...; q_{t,n_q}] = q_t = c_t · W_q
$$

其中 $h_t ∈ R^d$ 是查询 $token_t$ 的输入隐藏状态,$c_t ∈ R^{d_c}$ 是查询的压缩潜在向量,$d_c$ 是查询压缩维度,$n_q$ 是索引器查询头数,$W_c ∈ R^{d×d_c}$ 和 $W_q ∈R^{d_c×(n_q·d_I)}$分别是下投影和上投影矩阵。

接下来,查询 $token_t$ 与前面的压缩块 $b(b < Floor(t/m))$之间的索引分数 $s_{t,b} ∈ R $计算为:

$$
[s_{t,1}; s_{t,2}; ...; s_{t,n_q}] = w_t = h_t · W_w, \quad s_{t,b} = q_{t,b}^T · I_{K,b}^{comp}
$$

其中 $W_w ∈ R^{d×n_q}$ 是额外的可学习权重。然后,对索引分数应用 top-k 选择,只保留最相关的 k 个压缩块。对于被选中的块,执行标准的 MLA(Multi-head Latent Attention)计算。

#### 2.3.2 Heavily Compressed Attention

![图 4: HCA 核心架构。HCA 以更高的压缩率(m'=128)压缩 KV Cache,不做稀疏选择,直接对压缩后的全量 KV 条目执行稠密注意力,保证全局序列的整体语义建模。](./assets/figure_04.png)

> 图 4: HCA 核心架构。HCA 以更高的压缩率(m'=128)压缩 KV Cache,不做稀疏选择,直接对压缩后的全量 KV 条目执行稠密注意力,保证全局序列的整体语义建模。

HCA 采用与 CSA 类似的压缩机制,但压缩率更激进。HCA 使用 m' = 128 的压缩率(每 128 个 token 压缩为 1 个条目),且压缩过程没有重叠。对于 1M token 的序列,压缩后仅剩不到 8000 个条目,此时稠密注意力的计算量已完全在可接受范围内。因此,HCA 不做稀疏选择,直接对压缩后的全量 KV 条目执行稠密注意力计算,保证对全局序列的整体语义建模,避免稀疏注意力导致的全局信息丢失。

HCA 的具体计算过程与 CSA 类似:对输入隐藏状态进行压缩生成 KV 条目,然后对查询和压缩 KV 执行标准注意力。由于压缩后的序列长度极短,HCA 的计算开销很小。

#### 2.3.3 其他细节

**滑动窗口注意力**。由于压缩注意力保证严格因果性,一个查询 token 看不到自己压缩块内其他 token 的信息。为补偿近距离依赖,CSA 和 HCA 都额外增加了一个滑动窗口分支,每个查询除了看压缩 KV 之外,还能看最近 n_win 个 token 的未压缩 KV。

**部分 RoPE**。CSA 和 HCA 在核心注意力之前对查询和 KV 条目执行 RMSNorm,有效防止注意力 logits 爆炸。仅对查询和 KV 条目的最后 64 维施加旋转位置编码(RoPE),其余维度不动。由于 KV 条目既做 key 又做 value,naive 的 RoPE 会让输出带上绝对位置信息,因此在输出端也对应施加一个位置为 -i 的 RoPE 来抵消,只保留相对位置信息。

**Attention Sink**。借鉴 StreamingLLM 的思想,在注意力分母上加一个可学习的 sink logit,允许注意力分数总和不等于 1,甚至接近 0。这在长序列中尤其有用,能避免模型被迫把注意力均摊。

#### 2.3.4 效率讨论

由于采用混合 CSA 和 HCA,以及低精度计算和存储,DeepSeek-V4 系列的注意力模块在注意力 FLOPs 和 KV Cache  size 方面都实现了卓越效率,尤其在长上下文场景中。

首先,我们采用混合存储格式用于 KV 条目:RoPE 维度使用 BF16 精度,其余维度使用 FP8 精度。这种混合表示相比纯 BF16 存储减少了近一半的 KV Cache  size。其次,lightning indexer 内的注意力计算以 FP4 精度执行,在极长上下文下加速注意力操作。第三,相对于 DeepSeek-V3.2,DeepSeek-V4 系列选择了更小的注意力 top-k,从而提升短文本和中长文本上的模型效率。最后,也是最重要的,压缩注意力和混合注意力技术大幅减少了 KV Cache  size 和计算 FLOPs。

以 BF16 GQA8(Ainslie et al., 2023)头维度 128 为基准——这是 LLM 注意力的常见配置之一——DeepSeek-V4 系列在 1M 上下文设定下的 KV Cache  size 可以大幅降至该基准的约 2% 倍。

**表 1 | DeepSeek-V4 系列模型规格**

| 规格              | V4-Pro    | V4-Flash  |
| ----------------- | --------- | --------- |
| 总参数量          | 1.6T      | 284B      |
| 每 token 激活参数 | 49B       | 13B       |
| 上下文窗口        | 1M        | 1M        |
| 训练数据量        | 33T       | 32T       |
| 注意力机制        | CSA + HCA | CSA + HCA |
| 优化器            | Muon      | Muon      |
| 层数              | 61        | 43        |
| 隐藏维度          | 6144      | 5120      |
| 专家总数          | 256       | 256       |
| 路由专家数        | 8         | 8         |
| 共享专家数        | 1         | 1         |

### 2.4 Muon 优化器

我们对 DeepSeek-V4 系列的大部分模块采用 Muon(Jordan et al., 2024; Liu et al., 2025)优化器,因其更快的收敛速度和改进的训练稳定性。

**基本配置**。我们对嵌入模块、预测头模块、mHC 模块的静态偏置和门控因子,以及所有 RMSNorm 模块的权重保持 AdamW(Loshchilov and Hutter, 2017)优化器。所有其他模块使用 Muon 更新。遵循 Liu et al. (2025),我们也对 Muon 参数应用权重衰减,使用 Nesterov(Jordan et al., 2024; Nesterov, 1983)技巧,并重缩放更新矩阵的 RMS 以复用 AdamW 超参数。与他们的不同之处在于,我们使用混合 Newton-Schulz 迭代进行正交化。

**混合 Newton-Schulz 迭代**。对于给定矩阵 M,令其奇异值分解(SVD)为 $M = UΣV^T$。Newton-Schulz 迭代旨在将 M 近似正交化为 $UV^T$。通常,M 首先归一化为 $M_0 = M/\|M\|_2$ 以确保其最大奇异值不超过 1。然后,每次 Newton-Schulz 迭代执行以下操作:

$$
M_k = M_{k-1} + α · (M_{k-1} - M_{k-1} M_{k-1}^T M_{k-1}) + β · (M_{k-1} - M_{k-1} M_{k-1}^T M_{k-1})^2 + γ · M_{k-1}
$$

我们的混合 Newton-Schulz 在两个不同阶段执行 10 次迭代。在前 8 步,使用系数 $(α, β, γ) = (3.4445, -4.7750, 2.0315) $驱动快速收敛,将奇异值拉近 1。在最后 2 步,切换到系数 $(α, β, γ) = (2, -1.5, 0.5)$,将奇异值精确稳定在 1。

**避免注意力 Logits 爆炸**。DeepSeek-V4 系列的注意力架构允许我们直接在注意力查询和 KV 条目上应用 RMSNorm,有效防止注意力 logits 爆炸。因此,我们在 Muon 优化器中不采用 QK-Clip 技巧(Liu et al., 2025)。

> **译者思考：数据与实验**
>
> Muon 优化器的选择是一个值得关注的决策。AdamW 自 2017 年以来一直是 LLM 训练的事实标准,但 Muon 在 2024-2025 年逐渐受到关注。DeepSeek-V4 是 Muon 在万亿参数规模上的首次生产级部署。
>
> Muon 的核心洞察是:梯度更新矩阵往往高度相关,存在冗余。通过 Newton-Schulz 迭代将梯度矩阵近似正交化,可以消除这种冗余,使得每次更新都沿着"正交方向"进行,从而提高收敛效率。
>
> 但 Muon 并非万能。论文明确保留了 AdamW 用于嵌入层、预测头、mHC 静态偏置和 RMSNorm 权重——这些模块的梯度结构不适合 Muon 的正交化假设。这种"混合优化"策略是务实的:在适合的模块用 Muon,在不适合的模块保留 AdamW。
>
> 混合 Newton-Schulz 的两阶段设计也很有讲究:前 8 步用激进系数快速收敛,后 2 步用保守系数精确稳定。这类似于学习率调度中的 warmup + decay,但针对的是正交化过程本身。

---

## 3 通用基础设施

### 3.1 专家并行中的细粒度通信-计算重叠

![图 5: 细粒度 EP 方案与相关工作对比。Comet 重叠通信和计算但粒度较粗;Mega-Kernel 融合所有操作但灵活性差;DeepSeek-V4 的细粒度 wave 调度将专家分割为多个 wave,实现计算、通信和内存访问的完全重叠。](./assets/figure_05.png)

> 图 5: 细粒度 EP 方案与相关工作对比。Comet 重叠通信和计算但粒度较粗;Mega-Kernel 融合所有操作但灵活性差;DeepSeek-V4 的细粒度 wave 调度将专家分割为多个 wave,实现计算、通信和内存访问的完全重叠。

混合专家(MoE)可通过专家并行(EP)加速。然而,EP 需要复杂的节点间通信,对互连带宽和延迟提出了大量需求。为缓解 EP 中的通信瓶颈并在较低互连带宽要求下实现更高的端到端性能,我们提出了一种细粒度 EP 方案,将通信和计算融合为单个流水线内核以实现通信-计算重叠。

**通信延迟可以被隐藏**。我们 EP 方案的核心洞察是,MoE 层中的通信延迟可以被有效隐藏在计算之下。在 DeepSeek-V4 系列中,每个 MoE 层主要可分解为四个阶段:两个通信受限阶段 Dispatch 和 Combine,以及两个计算受限阶段 Linear-1 和 Linear-2。我们的分析揭示,在单个 MoE 层内,通信总时间小于计算时间。因此,将通信和计算融合为统一流水线后,计算仍是主导瓶颈,这意味着系统可以在不降低端到端性能的情况下容忍较低的互连带宽。

**细粒度 EP 方案**。为进一步降低互连带宽需求并放大重叠收益,我们引入了更细粒度的专家划分方案。受多项相关工作启发(Aimuyo et al., 2025; Zhang et al., 2025b),我们将专家分割并调度为 waves。每个 wave 包含一小部分专家。一旦 wave 内的所有专家完成通信,计算即可立即开始,无需等待其他专家。在稳态下,当前 wave 的计算、下一 wave 的 token 传输、以及已完成专家的结果发送全部并发进行。这形成了专家之间的细粒度流水线,使计算和通信在整个 wave 中保持连续。基于 wave 的调度在极端情况下(如 RL rollout 的长尾小 batch)加速了性能。

**性能与开源 Mega-Kernel**。我们在 NVIDIA GPU 和华为昇腾 NPU 平台上验证了细粒度 EP 方案。相比强非融合基线,它在通用推理负载上实现 1.50-1.73 倍加速,在 RL rollout 和高速 Agent 服务等延迟敏感场景下最高达 1.96 倍。我们已将基于 CUDA 的 mega-kernel 实现以 MegaMoE 的名义作为 DeepGEMM 的组件开源。

### 3.2 基于 TileLang 的灵活高效内核开发

在实践中,我们精细的模型架构会产生数百个细粒度的 Torch ATen 算子。我们采用 TileLang(Wang et al., 2026)开发一组融合内核,以平衡开发效率和运行时效率。TileLang 是一种基于 Python 的 DSL,用于编写高性能 GPU 内核,它抽象了复杂的 CUDA 编程细节,同时允许对内存布局和计算流水线进行精细控制。

### 3.3 高性能 Batch-Invariant 和确定性内核库

为确保训练和推理之间的逐位可复现性,我们提供高效的 batch-invariant 和确定性内核库。Batch-invariant 意味着内核的输出不依赖于输入 batch 的划分方式,这对于分布式训练中的数据并行至关重要。确定性则确保相同的输入总是产生相同的输出,这对于调试和模型复现至关重要。

### 3.4 训练框架

**Muon 的高效实现**。为高效实现 Muon 优化器,我们设计了混合 ZeRO 策略。对于 Muon 参数,我们在数据并行组之间分片正交化后的更新矩阵,而不是分片原始梯度。这减少了通信量,因为更新矩阵通常比梯度更紧凑。

**mHC 的成本效益和内存高效实现**。mHC 模块通过重计算和融合内核实现成本效益和内存高效。具体而言,我们在前向传播中计算 mHC 的动态参数,但在反向传播中重计算它们,而不是存储中间结果。此外,我们将 mHC 的三个线性映射融合为单个内核,减少内核启动开销和内存访问。

**长上下文注意力的上下文并行**。为支持百万 token 上下文,我们采用两阶段上下文并行策略。第一阶段将序列划分为多个 chunk,每个 GPU 处理一个 chunk。第二阶段在 chunk 之间同步压缩 KV 条目,然后执行全局注意力计算。这种两阶段策略平衡了计算和通信,避免了单一阶段策略中的通信瓶颈。

**扩展自动微分以支持灵活的激活 Checkpointing**。我们扩展了 autograd 框架以支持张量级别的 checkpointing,实现细粒度重计算控制。与层级别的 checkpointing 相比,张量级别 checkpointing 允许更灵活的重计算策略,可以针对特定张量启用或禁用重计算,从而在内存和计算之间取得更好的平衡。

### 3.5 推理框架

![图 6: DeepSeek-V4 的 KV Cache 布局。CSA 层存储压缩 KV 条目和未压缩的局部滑动窗口 KV;HCA 层存储极度压缩的全局 KV;磁盘 KV Cache 持久化共享前缀。](./assets/figure_06.png)

> 图 6: DeepSeek-V4 的 KV Cache 布局。CSA 层存储压缩 KV 条目和未压缩的局部滑动窗口 KV;HCA 层存储极度压缩的全局 KV;磁盘 KV Cache 持久化共享前缀。

**KV Cache 结构和管理**。我们设计了异构 KV Cache 结构以支持混合 CSA 和 HCA。对于 CSA 层,我们存储压缩 KV 条目和未压缩的局部滑动窗口 KV。对于 HCA 层,我们存储极度压缩的全局 KV。这种异构结构根据注意力类型的不同,以最紧凑的格式存储 KV,最小化内存占用。

**磁盘 KV Cache 存储**。为支持超大规模并发和长上下文,我们设计了磁盘 KV Cache 存储策略。对于共享前缀(如系统提示和对话历史),我们将 KV Cache 持久化到磁盘,在多个请求之间共享。这避免了重复计算前缀的 KV,显著降低了首 token 延迟和计算开销。

---

## 4 预训练

### 4.1 数据构建

我们在超过 32T 的高质量多样化 token 上预训练 DeepSeek-V4 系列。数据构建流程继承自 DeepSeek-V3,并做了若干改进。数据清洗 pipeline 包括去重、质量过滤、安全过滤和多样化混合。我们特别关注代码和数学数据的比例,因为 DeepSeek-V4 系列的目标之一是增强推理和 Agent 能力。

### 4.2 预训练设置

**模型设置**。DeepSeek-V4-Pro 采用 61 层 Transformer,隐藏维度 6144,256 个专家(8 个路由专家 + 1 个共享专家),每 token 激活 49B 参数。DeepSeek-V4-Flash 采用 43 层 Transformer,隐藏维度 5120,256 个专家,每 token 激活 13B 参数。两个模型均使用 154880 的词汇表大小。

**训练设置**。DeepSeek-V4-Pro 在 33T token 上训练,DeepSeek-V4-Flash 在 32T token 上训练。我们使用 Muon 优化器,学习率 warmup 到 2e-4,然后 cosine decay 到 4e-5。Batch size 从较小值逐渐 warmup,最终达到大规模。训练采用 FP8 混合精度,路由专家权重使用 FP4 量化感知训练。

**缓解训练不稳定性**。在大规模训练中,我们观察到若干不稳定性现象,包括损失尖峰和梯度爆炸。为缓解这些问题,我们采用了多种策略:梯度裁剪、学习率回退、以及 mHC 的稳定性约束。特别地,mHC 的流形约束显著减少了深层网络中的梯度爆炸问题。

### 4.3 评估

**评估基准**。我们在广泛的知识、推理、编码、长上下文和 Agent 基准上评估 DeepSeek-V4 系列。基准包括 MMLU-Pro、GPQA、HLE、SimpleQA、Chinese-SimpleQA、LiveCodeBench、Codeforces、HMMT、IMOAnswerBench、Apex、MRCR 1M、CorpusQA 1M、Terminal Bench 2.0、SWE-Verified、BrowseComp、MCPAtlas、Toolathlon 等。

**评估结果**。如表 2 所示,DeepSeek-V4-Pro-Max 在绝大多数基准上重新定义了开源模型的最先进水平。

**表 2 | DeepSeek-V4-Pro-Max 与闭源/开源模型对比**

| 基准(指标)                  | Opus-4.6 Max | GPT-5.4 xHigh | Gemini-3.1-Pro High | K2.6 Thinking | GLM-5.1 Thinking | DS-V4-Pro Max |
| --------------------------- | :----------: | :-----------: | :-----------------: | :-----------: | :--------------: | :-----------: |
| MMLU-Pro (EM)               |     89.1     |     87.5     |        91.0        |     87.1     |       86.0       |     87.5     |
| SimpleQA-Verified (Pass@1)  |     46.2     |     45.3     |        75.6        |     36.9     |       38.1       |     57.9     |
| Chinese-SimpleQA (Pass@1)   |     76.4     |     76.8     |        85.9        |     75.9     |       75.0       |     84.4     |
| GPQA Diamond (Pass@1)       |     91.3     |     93.0     |        94.3        |     90.5     |       86.2       |     90.1     |
| HLE (Pass@1)                |     40.0     |     39.8     |        44.4        |     36.4     |       34.7       |     37.7     |
| LiveCodeBench (Pass@1)      |     88.8     |       -       |        91.7        |     89.6     |        -        |     93.5     |
| Codeforces (Rating)         |      -      |     3168     |        3052        |       -       |        -        |     3206     |
| HMMT 2026 Feb (Pass@1)      |     96.2     |     97.7     |        94.7        |       -       |        -        |     92.7     |
| IMOAnswerBench (Pass@1)     |     75.3     |     91.4     |        81.0        |       -       |        -        |     89.4     |
| Apex (Pass@1)               |     34.5     |     54.1     |        60.9        |       -       |        -        |     95.2     |
| Apex Shortlist (Pass@1)     |     85.9     |     78.1     |        89.1        |       -       |        -        |     86.0     |
| MRCR 1M (MMR)               |     92.9     |       -       |        76.3        |       -       |        -        |     83.8     |
| CorpusQA 1M (ACC)           |     71.7     |       -       |        53.8        |       -       |        -        |     62.0     |
| Terminal Bench 2.0 (Acc)    |     65.4     |     75.1     |        68.5        |     66.7     |       63.5       |     67.9     |
| SWE Verified (Resolved)     |     80.8     |       -       |        80.6        |     80.2     |        -        |     80.6     |
| SWE Pro (Resolved)          |     57.3     |     57.7     |        54.2        |     58.6     |       58.4       |     55.4     |
| SWE Multilingual (Resolved) |     77.5     |       -       |        85.9        |     76.7     |       73.3       |     76.2     |
| BrowseComp (Pass@1)         |     83.7     |     82.7     |        51.6        |     83.2     |       79.3       |     83.4     |
| HLE w/ tools (Pass@1)       |     53.1     |     52.0     |        48.8        |     54.0     |       50.4       |     48.2     |
| GDPval-AA (Elo)             |     1619     |     1674     |        1314        |     1482     |       1535       |     1554     |
| MCPAtlas Public (Pass@1)    |     73.8     |     67.2     |        69.2        |     66.6     |       71.8       |     73.6     |
| Toolathlon (Pass@1)         |     47.2     |     54.6     |        48.8        |     50.0     |       40.7       |     51.8     |

> **译者思考：数据与实验**
>
> 表 2 的数据揭示了几个关键趋势:
>
> **第一,DeepSeek-V4-Pro-Max 在开源模型中全面领先**。在代码(LiveCodeBench 93.5)、数学(Apex 95.2)、长上下文(MRCR 1M 83.8)和 Agent(Toolathlon 51.8)等任务上,它都超越了之前的开源最佳模型(K2.6 和 GLM-5.1)。
>
> **第二,与闭源模型的差距正在缩小**。在 Codeforces 上,V4-Pro-Max 的 3206 分甚至超越了 GPT-5.4 的 3168 分。在 SimpleQA 上,57.9% 虽然仍低于 Gemini-3.1-Pro 的 75.6%,但相比前代已有大幅提升。
>
> **第三,长上下文是真正的差异化优势**。MRCR 1M(多针检索)上 83.8% 超越了 Gemini-3.1-Pro 的 76.3%,CorpusQA 1M 上 62.0% 也超越了 Gemini 的 53.8%。这说明 CSA+HCA 的混合注意力不仅在效率上领先,在质量上也经得起考验。
>
> **第四,Agent 能力仍有提升空间**。在 Terminal Bench 2.0(67.9)和 SWE Verified(80.6)上,V4-Pro-Max 与闭源最佳(Opus-4.6 的 80.8 和 75.1)仍有差距。这与论文中"开源模型在复杂 Agent 任务上仍落后于闭源模型"的结论一致。

---

## 5 后训练

### 5.1 后训练流程

DeepSeek-V4 系列的后训练采用两步范式:领域专家独立培育,然后通过 on-policy distillation 统一整合。

#### 5.1.1 专家训练

对于每个目标领域——数学、编码、Agent、指令遵循——我们独立训练一个专家模型。基础模型首先在高质量领域特定数据上接受 SFT,建立基础能力。随后,使用 GRPO 应用 RL,在针对特定成功标准定制的奖励模型指导下优化领域对齐行为。这一阶段产生多样化的专业专家集合。

**数学专家**。数学专家在大量数学推理数据上训练,包括竞赛题、教科书问题和形式化证明。奖励模型评估答案的正确性和推理过程的逻辑严密性。

**代码专家**。代码专家在代码补全、bug 修复、代码生成和软件工程任务上训练。奖励模型通过单元测试和代码质量评估来评分。

**Agent 专家**。Agent 专家在工具使用、多步推理和交互式任务上训练。奖励模型评估任务完成度和工具调用的正确性。

**指令遵循专家**。指令遵循专家在多样化的人类指令和对话数据上训练,优化模型的通用对话能力和指令遵循能力。

#### 5.1.2 On-Policy Distillation

为整合各专家的专业能力,我们通过 on-policy distillation 训练统一模型。统一模型作为学生,学习优化与多个教师模型(各领域专家)的 reverse KL  loss:

$$
L_{OPD} = \sum_{t} \sum_{teacher} π_{student}(w_t|w_{<t}) · \log \frac{π_{student}(w_t|w_{<t})}{π_{teacher}(w_t|w_{<t})}
$$

相比前向 KL,reverse KL 防止学生过度扩散,鼓励其保守地接近教师分布。计算 reverse KL  loss 产生更稳定的梯度估计,并确保对教师知识的忠实蒸馏。

> **译者思考：架构细节**
>
> 两步后训练范式("分化再统一")是对传统混合 RL 的深刻反思。传统方法(如 V3.2)在一个模型上同时优化多个目标(数学+代码+Agent+指令),导致多目标权衡和性能妥协。
>
> V4 的洞察是:与其让单一模型在多个目标之间妥协,不如先让每个目标独立优化到各自的最优,然后再将这些最优能力"合并"到一个统一模型中。
>
> On-policy distillation 是合并的关键技术。与标准的知识蒸馏(使用教师生成的离线数据)不同,on-policy distillation 让学生模型自己生成数据,然后用教师的评分指导优化。这确保了学生模型在其自身的分布下学习,避免了分布偏移问题。
>
> Reverse KL 的选择也很关键。前向 KL 会迫使学生覆盖教师的所有行为(包括教师的错误),导致学生过度扩散。Reverse KL 则让学生"保守地"接近教师,只在教师高概率的区域学习,保持行为的集中性。
>
> 从工程角度看,全词汇 OPD 是一个巨大的挑战。论文描述了高效的教师调度策略:教师权重卸载到分布式存储,按需加载;只缓存教师的最后一层隐藏状态而非完整 logits;按教师索引排序训练样本以最小化预测头的内存占用。这些优化使得同时蒸馏 10+ 个万亿参数教师模型成为可能。

### 5.2 后训练基础设施

#### 5.2.1 FP4 量化感知训练

为实现部署时的推理加速和内存流量减少,我们在后训练阶段引入量化感知训练(QAT)(Jacob et al., 2018),使模型(包括教师和参考模型)适应量化引入的精度退化。我们对两个组件应用 FP4(MXFP4)量化(Rouhani et al., 2023):(1) MoE 专家权重,这是 GPU 内存占用的主要来源;(2) CSA 索引器中的 QK 路径,其中 QK 激活完全以 FP4 缓存、加载和相乘,加速长上下文场景中的注意力分数计算。

对于 MoE 专家权重,遵循 QAT 的常见做法,优化器维护的 FP32 主权重首先量化为 FP4,然后反量化为 FP8 进行计算。值得注意的是,我们的 FP4 到 FP8 反量化是无损的。这是因为 FP8(E4M3)比 FP4(E2M1)多 2 个指数位,提供更大的动态范围。因此,只要 FP4 子块(1×32 tiles)内的最大和最小缩放因子之比不超过某个阈值,细粒度缩放信息就能被 FP8 扩展的动态范围完全吸收。

#### 5.2.2 全词汇 OPD 的高效教师调度

我们的框架支持全词汇 on-policy distillation,教师数量实际上无上限,每个教师可能包含万亿参数。为实现这一点,所有教师权重卸载到集中式分布式存储,在教师前向传播期间按需加载,采用 ZeRO 式的参数分片以缓解 I/O 和 DRAM 压力。

#### 5.2.3 可抢占和容错的 Rollout 服务

为最大化 GPU 资源利用率并支持高优先级任务的快速硬件调配,我们的 GPU 集群采用集群范围的可抢占任务调度器,任何运行中的任务都可能随时被抢占。此外,硬件故障在大规模 GPU 集群中很常见。为此,我们实现了可抢占和容错的 LLM 生成服务用于 RL/OPD rollout。

具体而言,我们为每个生成请求实现 token 粒度的预写日志(WAL)。每当为请求生成新 token 时,我们立即将其追加到该请求的 WAL 中。在抢占期间,我们暂停推理引擎并保存未完成请求的 KV Cache。恢复时,我们使用持久化的 WAL 和保存的 KV Cache 继续解码。

#### 5.2.4 百万 Token 上下文的扩展 RL 框架

我们引入针对性优化以在百万 token 序列上高效执行 RL 和 OPD。在 rollout 阶段,我们采用可抢占和容错的 rollout 服务。对于推理和训练阶段,我们将 rollout 数据格式分解为轻量级元数据和重量级逐 token 字段。

#### 5.2.5 Agentic AI 的沙盒基础设施

为满足后训练和评估期间 Agentic AI 的多样化执行需求,我们构建了生产级沙盒平台 DeepSeek Elastic Compute(DSec)。DSec 包含三个 Rust 组件——API 网关(Apiserver)、每主机代理(Edge)和集群监控(Watcher)——通过自定义 RPC 协议互联,并在 3FS 分布式文件系统(DeepSeek-AI, 2025)之上水平扩展。在生产环境中,单个 DSec 集群管理数十万个并发沙盒实例。

### 5.3 标准基准评估

#### 5.3.1 评估设置

**知识与推理**。知识推理数据集包括 MMLU-Pro、GPQA、HLE、SimpleQA-Verified、Chinese-SimpleQA、LiveCodeBench-v6、Codeforces、HMMT 2026 Feb、Apex、Apex Shortlist、IMOAnswerBench 和 PutnamBench。

**1M Token 上下文**。由于 DeepSeek-V4 系列支持 1M token 上下文,我们通过 OpenAI MRCR 和 CorpusQA 评估长上下文场景中的模型性能。

**Agent**。Agent 数据集包括 Terminal Bench 2.0、SWE-Verified、SWE Multilingual、SWE-Pro、BrowseComp、MCPAtlas、GDPval-AA 和 Tool-Decathlon。

#### 5.3.2 评估结果

**知识**。在一般世界知识评估中,DeepSeek-V4-Pro-Max 建立了开源大语言模型的新最先进水平。SimpleQA-Verified 上,DeepSeek-V4-Pro-Max 以 20 个绝对百分点的优势显著超越所有现有开源基线。尽管仍有进步空间,它目前仍落后于领先闭源模型 Gemini-3.1-Pro。

![图 8: DeepSeek-V4 系列在形式推理任务上的表现。左(Practical Regime): Putnam-200 Pass@8 在有界采样下,V4-Flash-Max 取得 81.00,远超 Seed-2.0-Pro 的 35.50。右(Frontier Regime): Putnam-2025 在混合形式-非形式推理下,V4 取得 120/120,与 Axiom 持平。](./assets/figure_08.png)

> 图 8: DeepSeek-V4 系列在形式推理任务上的表现。左(Practical Regime): Putnam-200 Pass@8 在有界采样下,V4-Flash-Max 取得 81.00,远超 Seed-2.0-Pro 的 35.50。右(Frontier Regime): Putnam-2025 在混合形式-非形式推理下,V4 取得 120/120,与 Axiom 持平。

**推理**。DeepSeek-V4-Pro-Max 在推理基准上超越所有先前的开源模型,在许多指标上匹配最先进水平闭源模型,而较小的 DeepSeek-V4-Flash-Max 也在代码和数学推理任务上超越了之前的最佳开源模型 K2.6-Thinking。

![图 10: DeepSeek-V4 系列在不同推理努力模式下的 HLE 和 TerminalBench 2.0 性能。None 模式(无推理)基线最低;Think 模式(基础推理)显著提升;High 模式(高级推理)进一步增长;Max 模式(最大推理努力)达到峰值。V4-Pro 的 Max 模式在 HLE 上达到 37.7%,在 TerminalBench 2.0 上达到 67.9%。](./assets/figure_10.png)

> 图 10: DeepSeek-V4 系列在不同推理努力模式下的 HLE 和 TerminalBench 2.0 性能。None 模式(无推理)基线最低;Think 模式(基础推理)显著提升;High 模式(高级推理)进一步增长;Max 模式(最大推理努力)达到峰值。V4-Pro 的 Max 模式在 HLE 上达到 37.7%,在 TerminalBench 2.0 上达到 67.9%。

**Agent**。DeepSeek-V4 系列在评估中展示了强劲的 Agent 性能。对于代码 Agent 任务,DeepSeek-V4-Pro 取得了与 K2.6 和 GLM-5.1 相当的结果,尽管这些开源模型仍落后于其闭源对手。

**1M Token 上下文**。DeepSeek-V4-Pro 在 MRCR 任务上超越 Gemini-3.1-Pro,但落后于 Claude Opus 4.6。如图 9 所示,检索性能在 128K 上下文窗口内保持高度稳定。虽然 128K 之后出现性能下降,但模型在 1M token 时的检索能力相比闭源和开源对手仍然非常强劲。

![图 9: DeepSeek-V4 系列在 MRCR 任务上的性能。检索性能在 128K 上下文窗口内保持高度稳定,128K 之后出现轻微下降,但 1M token 时仍显著优于对手。](./assets/figure_09.png)

> 图 9: DeepSeek-V4 系列在 MRCR 任务上的性能。检索性能在 128K 上下文窗口内保持高度稳定,128K 之后出现轻微下降,但 1M token 时仍显著优于对手。

**推理努力**。Max 模式在最具挑战性的任务上超越 High 模式。通过扩展测试时计算,DeepSeek-V4 系列相比前代实现了显著提升。

![图 7: DeepSeek-V4 系列的 Thinking 管理策略。上(a): 工具调用场景中,推理内容在整个对话中完全保留;下(b): 一般对话场景中,新用户消息到达时丢弃之前的推理内容以保持上下文简洁。](./assets/figure_07.png)

> 图 7: DeepSeek-V4 系列的 Thinking 管理策略。上(a): 工具调用场景中,推理内容在整个对话中完全保留;下(b): 一般对话场景中,新用户消息到达时丢弃之前的推理内容以保持上下文简洁。

### 5.4 真实世界任务性能

标准基准往往难以捕捉多样化真实任务的复杂性,在测试结果和实际用户体验之间造成差距。为弥合这一差距,我们开发了专有的内部指标,优先考虑真实使用模式而非传统基准。

#### 5.4.1 中文写作

![图 11 & 12: 左(Figure 11): DeepSeek-V4-Pro-Max 与 Opus-4.6-Max 在分析、生成、编辑任务及整体表现上的胜率对比。V4-Pro-Max 在 analysis(55.0%)、generation(52.0%) 和 overall(53.0%) 上均领先。右(Figure 12): 详细维度评分对比,包括任务完成度(Task Completion)、内容质量(Content Quality)、格式美观(Formatting Aesthetics)、指令遵循(Instruction Following)和总体评分(Overall)。](./assets/figure_11_12.png)

> 图 11 & 12: 左(Figure 11): DeepSeek-V4-Pro-Max 与 Opus-4.6-Max 在分析、生成、编辑任务及整体表现上的胜率对比。V4-Pro-Max 在 analysis(55.0%)、generation(52.0%) 和 overall(53.0%) 上均领先。右(Figure 12): 详细维度评分对比,包括任务完成度(Task Completion)、内容质量(Content Quality)、格式美观(Formatting Aesthetics)、指令遵循(Instruction Following)和总体评分(Overall)。

DeepSeek 的主要用例之一是中文写作。我们在功能写作和创意写作上进行了严格评估。DeepSeek-V4-Pro 在功能写作任务上相对于 Gemini-3.1-Pro 的整体胜率为 62.7% 对 34.1%。在创意写作方面,DeepSeek-V4-Pro 在指令遵循上实现 60.0% 胜率,在写作质量上实现 77.5% 胜率。

#### 5.4.2 搜索

搜索增强问答是 DeepSeek 聊天机器人的核心能力。DeepSeek-V4-Pro 相对于 DeepSeek-V3.2 在客观和主观问答类别上均有显著优势。Agentic 搜索在复杂任务上持续优于 RAG。

#### 5.4.3 白领任务

为严格评估模型在复杂企业生产力场景中的效用,我们构建了包含 30 个高级中文专业任务的综合套件。DeepSeek-V4-Pro-Max 在多样化中文白领任务上超越 Opus-4.6-Max,实现了 63% 的不败率。

#### 5.4.4 代码 Agent

在内部评估中,DeepSeek-V4-Pro-Max 超越 Claude Sonnet 4.5,接近 Opus 4.5 的水平。

---

**示例输出**

以下展示 DeepSeek-V4-Pro 在真实世界复杂任务上的示例输出:

![图 13: 示例输出:为一家知名奶茶品牌与北京地铁联合起草营销方案。输出包含 UGC 传播与社交裂变设计、全年营销排期总览、站点使用频次与全域覆盖分析、分波段投资拆解与资源配置等完整模块。](./assets/figure_13.png)

> 图 13: 示例输出:为一家知名奶茶品牌与北京地铁联合起草营销方案。输出包含 UGC 传播与社交裂变设计、全年营销排期总览、站点使用频次与全域覆盖分析、分波段投资拆解与资源配置等完整模块。

![图 14: 示例输出:对比分析两种纳斯达克指数基金定投策略。输出包含报告摘要、市场概况、策略说明、收益对比图、持仓市值与成本变化、累计盈亏对比、关键指标对比等完整投资分析报告。](./assets/figure_14.png)

> 图 14: 示例输出:对比分析两种纳斯达克指数基金定投策略。输出包含报告摘要、市场概况、策略说明、收益对比图、持仓市值与成本变化、累计盈亏对比、关键指标对比等完整投资分析报告。

![图 15: 示例输出:调研 2020-2025 年诺贝尔科学奖并生成分析性 PDF 报告。输出包含获奖者详细信息(按年份与奖项分类)、统计分析与可视化(获奖分布饼图)、总结与未来展望等完整研究报告。](./assets/figure_15.png)

> 图 15: 示例输出:调研 2020-2025 年诺贝尔科学奖并生成分析性 PDF 报告。输出包含获奖者详细信息(按年份与奖项分类)、统计分析与可视化(获奖分布饼图)、总结与未来展望等完整研究报告。

---

## 6 结论、局限性与未来方向

### 6.1 结论

DeepSeek-V4 系列通过架构创新和全栈优化,在超长上下文效率和模型能力之间取得了突破性平衡。主要贡献包括:

1. **混合注意力架构**: CSA + HCA 的交替设计将 1M 上下文的推理 FLOPs 降至 V3.2 的 27%(Pro)和 10%(Flash),KV Cache 降至 10%(Pro)和 7%(Flash),使百万 token 上下文从"实验室演示"变为"生产可用"。
2. **Manifold-Constrained Hyper-Connections**: 通过将残差映射约束到双随机矩阵流形,增强了万亿参数模型的训练稳定性,同时保持了模型表达能力。
3. **Muon 优化器**: 在万亿参数规模上验证了 Muon 优化器的有效性,实现了更快的收敛和更高的训练稳定性。
4. **两步后训练范式**: 先独立培育领域专家,再通过 on-policy distillation 统一整合,避免了多目标 RL 的性能妥协。
5. **全栈基础设施优化**: 从融合内核、TileLang DSL、确定性库到异构 KV Cache 和磁盘存储,为高效训练和推理提供了完整支撑。

### 6.2 局限性

1. **知识能力仍有差距**: 尽管 DeepSeek-V4-Pro-Max 在开源模型中领先,但在世界知识(SimpleQA)上仍显著落后于 Gemini-3.1-Pro(57.9% vs 75.6%)。
2. **复杂 Agent 任务**: 在 Terminal Bench 2.0 和 SWE Verified 等复杂 Agent 任务上,开源模型(包括 V4)仍落后于顶尖闭源模型。
3. **长上下文衰减**: 虽然 1M 上下文的检索能力令人印象深刻,但 128K 之后性能仍有可见下降,表明超长距离依赖的建模仍是挑战。
4. **硬件依赖**: FP4 量化的效率增益在当前硬件上尚未完全释放(当前 FP4×FP8 峰值与 FP8×FP8 相同),需要未来硬件支持。

### 6.3 未来方向

1. **进一步提升上下文长度**: 探索支持 10M 甚至更长上下文的技术,使模型能够处理整本书籍、大型代码库和长时间视频。
2. **缩小与闭源模型的差距**: 特别是在世界知识和复杂 Agent 任务上,通过更大规模的预训练和更精细的后训练策略追赶前沿闭源模型。
3. **多模态扩展**: 将 CSA+HCA 的混合注意力架构扩展到视觉和音频模态,实现真正的全模态长上下文理解。
4. **在线学习**: 利用高效的长上下文处理能力,探索在线学习和持续学习范式,使模型能够从交互中不断进化。

---

## 附录 A: 术语表

| 术语     | 解释                                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------- |
| CSA      | Compressed Sparse Attention,压缩稀疏注意力。先压缩 KV Cache,再对压缩后的块做稀疏选择。                     |
| HCA      | Heavily Compressed Attention,重度压缩注意力。以极高压缩率(128:1)压缩 KV Cache,对压缩后的全量做稠密注意力。 |
| mHC      | Manifold-Constrained Hyper-Connections,流形约束超连接。将残差映射约束到双随机矩阵流形以增强稳定性。        |
| Muon     | 一种优化器,通过 Newton-Schulz 迭代近似正交化梯度更新矩阵,实现更快收敛。                                    |
| MTP      | Multi-Token Prediction,多 token 预测。同时预测多个未来 token 以稠密化训练信号。                            |
| DSA      | DeepSeek Sparse Attention,DeepSeek 稀疏注意力。通过 Lightning Indexer 选择 top-k KV 块进行注意力计算。     |
| OPD      | On-Policy Distillation,同策略蒸馏。学生模型在自己生成的数据上学习,优化与教师的 reverse KL  loss。          |
| GRPO     | Group Relative Policy Optimization,组相对策略优化。一种 RL 算法,使用组内相对奖励减少方差。                 |
| QAT      | Quantization-Aware Training,量化感知训练。在训练过程中模拟量化效应,使模型适应低精度推理。                  |
| TileLang | 一种基于 Python 的 DSL,用于编写高性能 GPU 内核。                                                           |
| WAL      | Write-Ahead Log,预写日志。用于可抢占和容错推理的 token 粒度日志机制。                                      |

---

## 附录 B: 关键数据速查

**模型规格对比**

| 指标       | V4-Pro | V4-Flash | V3.2  |
| ---------- | ------ | -------- | ----- |
| 总参数量   | 1.6T   | 284B     | 671B  |
| 激活参数   | 49B    | 13B      | 37B   |
| 上下文窗口 | 1M     | 1M       | 128K  |
| 训练数据   | 33T    | 32T      | 14.8T |
| 层数       | 61     | 43       | 61    |
| 隐藏维度   | 6144   | 5120     | 7168  |
| 专家数     | 256    | 256      | 256   |

**1M 上下文效率对比(vs V3.2)**

| 指标           | V4-Pro | V4-Flash |
| -------------- | ------ | -------- |
| 单 token FLOPs | 27%    | 10%      |
| KV Cache       | 10%    | 7%       |

**核心基准性能**

| 基准               | V4-Pro-Max | 开源最佳 | 闭源最佳 |
| ------------------ | :--------: | :------: | :------: |
| LiveCodeBench      |    93.5    |   89.6   |   91.7   |
| Codeforces         |    3206    |    -    |   3168   |
| MMLU-Pro           |    87.5    |   87.1   |   91.0   |
| SimpleQA           |    57.9    |   38.1   |   75.6   |
| MRCR 1M            |    83.8    |    -    |   76.3   |
| Terminal Bench 2.0 |    67.9    |   66.7   |   75.1   |
| SWE Verified       |    80.6    |   80.2   |   80.8   |

---

> **译者注**:DeepSeek-V4 的论文展现了一种"实用主义前沿研究"的风格。它没有追求单一指标的绝对突破,而是围绕一个核心工程问题——"如何让 100 万 token 上下文在生产环境中可用"——进行了系统性的架构、基础设施和训练流程创新。CSA+HCA 的混合注意力是论文的技术核心,但 mHC、Muon、FP4 QAT、两步后训练、异构 KV Cache 等辅助创新共同构成了完整的解决方案。论文的评估也非常诚实:明确承认在 SimpleQA 和复杂 Agent 任务上仍落后于顶尖闭源模型,并给出了具体的差距数字。这种坦诚在业界论文中值得赞赏。
