---
title: "DeepSeek-V2 技术报告精读"
status: completed
date: 2026-05-19
---

# DeepSeek-V2: 一个强大、经济且高效的混合专家语言模型

> 🔙 **[返回 14.1-DeepSeek 家族总览](../../14.1-DeepSeek.md)**


> 原文标题: DeepSeek-V2: A Strong, Economical, and Efficient Mixture-of-Experts Language Model
> 原文链接: https://arxiv.org/abs/2405.04434
> 发布日期: 2024 年 5 月 7 日
> 发布机构: DeepSeek-AI

---

## 摘要

我们提出了 DeepSeek-V2, 一个具有经济性训练和高效推理特点的强大的混合专家(MoE)语言模型. 它包含 236B 总参数, 其中每个 token 激活 21B 参数, 支持 128K token 的上下文长度. DeepSeek-V2 采用了创新架构, 包括 Multi-head Latent Attention(MLA, 多头潜在注意力)和 DeepSeekMoE. MLA 通过将 Key-Value(KV)缓存显著压缩为潜在向量来保证高效推理, 而 DeepSeekMoE 则通过稀疏计算以经济成本训练强大模型. 与 DeepSeek 67B 相比, DeepSeek-V2 在实现显著更强性能的同时, 节省了 42.5% 的训练成本, 减少了 93.3% 的 KV 缓存, 并将最大生成吞吐量提升了 5.76 倍. 我们在一个包含 8.1T token 的高质量、多源语料库上预训练了 DeepSeek-V2, 并进一步进行了监督微调(SFT)和强化学习(RL), 以充分释放其潜力. 评估结果显示, 即使仅激活 21B 参数, DeepSeek-V2 及其聊天版本在开源模型中仍达到顶尖性能.

> 译者注: DeepSeek-V2 是 MLA 和 DeepSeekMoE 两大架构创新的首次亮相. 与后来的 V3 相比, V2 的规模更小(236B vs 671B), 但核心架构设计已经完整确立. 值得注意的是, V2 使用传统的辅助损失(auxiliary loss)来做负载均衡, 而 V3 后来改进为 auxiliary-loss-free 方法. 这个演进轨迹展示了 DeepSeek 团队在 MoE 训练稳定性上的持续迭代.

---

## 1. 引言

在过去几年中, 大语言模型(LLM)经历了快速发展, 为通用人工智能(AGI)的曙光提供了一瞥. 一般而言, LLM 的智能随着参数量的增加而提升, 使其能够在各种任务上展现出涌现能力. 然而, 这种提升以更大的训练计算资源和潜在的推理吞吐量下降为代价. 这些限制对 LLM 的广泛采用和利用构成了重大挑战.

为了解决这一问题, 我们引入了 DeepSeek-V2, 一个强大的开源混合专家(MoE)语言模型, 通过创新的 Transformer 架构实现经济性训练和高效推理. 它配备了 236B 总参数, 其中每个 token 激活 21B 参数, 支持 128K token 的上下文长度.

我们在 Transformer 框架内对注意力模块和前馈网络(FFN)进行了优化, 采用了我们提出的 Multi-head Latent Attention(MLA)和 DeepSeekMoE.

**(1) 注意力机制方面**, Multi-Head Attention(MHA)的 Key-Value(KV)缓存对 LLM 的推理效率构成了重大障碍. 各种方法被探索来解决这一问题, 包括 Grouped-Query Attention(GQA)和 Multi-Query Attention(MQA). 然而, 这些方法在减少 KV 缓存的同时往往会牺牲性能. 为了实现两全其美, 我们引入了 MLA, 一种配备低秩键值联合压缩的注意力机制. 经验上, MLA 相比 MHA 实现了更优的性能, 同时在推理期间显著减少了 KV 缓存, 从而提升了推理效率.

**(2) 前馈网络方面**, 我们采用 DeepSeekMoE 架构, 该架构采用细粒度专家分割和共享专家隔离, 以实现更高的专家专业化潜力. DeepSeekMoE 架构相比传统的 MoE 架构(如 GShard)展现出巨大优势, 使我们能够以经济性成本训练强大模型. 由于我们在训练期间采用专家并行, 我们还设计了补充机制来控制通信开销并确保负载均衡.

通过结合这两种技术, DeepSeek-V2 同时具备强大的性能、经济的训练成本和高效的推理吞吐量.

我们构建了一个包含 8.1T token 的高质量多源预训练语料库. 与 DeepSeek 67B(我们之前的发布)使用的语料库相比, 该语料库具有更大的数据量, 特别是中文数据, 以及更高的数据质量. 我们首先在全量预训练语料库上预训练 DeepSeek-V2. 然后, 我们收集了 150 万轮对话会话, 涵盖数学、代码、写作、推理、安全等多个领域, 对 DeepSeek-V2 Chat (SFT)进行监督微调. 最后, 我们遵循 DeepSeekMath 采用 Group Relative Policy Optimization(GRPO)来进一步将模型与人类偏好对齐, 产出 DeepSeek-V2 Chat (RL).

> 译者注: V2 是 DeepSeek 从稠密模型(67B)向 MoE 架构转型的关键节点. 这个转型的核心驱动力是「经济性」: 在保持或提升性能的同时, 大幅降低训练和推理成本. 236B 总参数、21B 激活参数的配置是一个精心计算的结果 —— 激活参数与 67B 稠密模型相当(保证了质量不下降), 但总参数量更大(通过 MoE 的稀疏性来扩展模型容量). 42.5% 的训练成本节省和 5.76 倍的吞吐量提升, 证明了这个配置在工程上是成功的.

---

## 2. 架构

大体上, DeepSeek-V2 仍然采用 Transformer 架构, 其中每个 Transformer 块包含一个注意力模块和一个前馈网络(FFN). 然而, 针对注意力模块和 FFN, 我们设计并采用了创新架构. 对于注意力部分, 我们设计了 MLA, 它利用低秩键值联合压缩来消除推理时键值缓存的瓶颈, 从而支持高效推理. 对于 FFN, 我们采用 DeepSeekMoE 架构, 这是一种高性能的 MoE 架构, 能够以经济成本训练强大模型. 图 2 展示了 DeepSeek-V2 的架构概览.

> 图 2: DeepSeek-V2 架构示意图. MLA 通过显著减少生成时的 KV 缓存来确保高效推理, 而 DeepSeekMoE 则通过稀疏架构以经济成本实现强模型的训练.

### 2.1 Multi-head Latent Attention: 提升推理效率

传统的 Transformer 模型通常采用 Multi-Head Attention(MHA), 但在生成过程中, 其沉重的 Key-Value(KV)缓存会成为限制推理效率的瓶颈. 为了减少 KV 缓存, Multi-Query Attention(MQA)和 Grouped-Query Attention(GQA)被提出. 它们需要更小幅度的 KV 缓存, 但性能无法与 MHA 匹敌.

对于 DeepSeek-V2, 我们设计了一种创新的注意力机制, 称为 Multi-head Latent Attention(MLA). 配备低秩键值联合压缩, MLA 实现了比 MHA 更好的性能, 但只需要显著更少量的 KV 缓存.

#### 2.1.1 预备知识: 标准 Multi-Head Attention

我们首先介绍标准 MHA 机制作为背景. 设 $d$ 为嵌入维度, $n_h$ 为注意力头数, $d_h$ 为每头维度, $\mathbf{h}_t \in \mathbb{R}^d$ 为注意力层中第 $t$ 个 token 的注意力输入. 标准 MHA 首先通过三个矩阵 $W^Q, W^K, W^V \in \mathbb{R}^{d_h n_h \times d}$ 分别产生 $\mathbf{q}_t, \mathbf{k}_t, \mathbf{v}_t \in \mathbb{R}^{d_h n_h}$:

$$ \mathbf{q}_t = W^Q \mathbf{h}_t \tag{1} $$
$$ \mathbf{k}_t = W^K \mathbf{h}_t \tag{2} $$
$$ \mathbf{v}_t = W^V \mathbf{h}_t \tag{3} $$

然后, $\mathbf{q}_t, \mathbf{k}_t, \mathbf{v}_t$ 被切分为 $n_h$ 个头以进行多头注意力计算:

$$ [\mathbf{q}_{t,1}; \mathbf{q}_{t,2}; ...; \mathbf{q}_{t,n_h}] = \mathbf{q}_t \tag{4} $$
$$ [\mathbf{k}_{t,1}; \mathbf{k}_{t,2}; ...; \mathbf{k}_{t,n_h}] = \mathbf{k}_t \tag{5} $$
$$ [\mathbf{v}_{t,1}; \mathbf{v}_{t,2}; ...; \mathbf{v}_{t,n_h}] = \mathbf{v}_t \tag{6} $$
$$ \mathbf{o}_{t,i} = \sum_{j=1}^{t} \text{Softmax}_j\left(\frac{\mathbf{q}_{t,i}^T \mathbf{k}_{j,i}}{\sqrt{d_h}}\right) \mathbf{v}_{j,i} \tag{7} $$
$$ \mathbf{u}_t = W^O [\mathbf{o}_{t,1}; \mathbf{o}_{t,2}; ...; \mathbf{o}_{t,n_h}] \tag{8} $$

其中 $\mathbf{q}_{t,i}, \mathbf{k}_{t,i}, \mathbf{v}_{t,i} \in \mathbb{R}^{d_h}$ 分别表示第 $i$ 个注意力头的 query、key 和 value; $W^O \in \mathbb{R}^{d \times d_h n_h}$ 表示输出投影矩阵. 在推理期间, 所有 key 和 value 都需要被缓存以加速推理, 因此 MHA 每个 token 需要缓存 $2 n_h d_h l$ 个元素($l$ 为层数). 在模型部署中, 这个沉重的 KV 缓存是限制最大 batch size 和序列长度的一大瓶颈.

#### 2.1.2 低秩键值联合压缩

MLA 的核心是键值的低秩联合压缩, 以减少 KV 缓存:

$$ \mathbf{c}_t^{KV} = W^{DKV} \mathbf{h}_t \tag{9} $$
$$ \mathbf{k}_t^C = W^{UK} \mathbf{c}_t^{KV} \tag{10} $$
$$ \mathbf{v}_t^C = W^{UV} \mathbf{c}_t^{KV} \tag{11} $$

其中 $\mathbf{c}_t^{KV} \in \mathbb{R}^{d_c}$ 是键和值的压缩潜在向量; $d_c (\ll d_h n_h)$ 表示 KV 压缩维度; $W^{DKV} \in \mathbb{R}^{d_c \times d}$ 是下投影矩阵; $W^{UK}, W^{UV} \in \mathbb{R}^{d_h n_h \times d_c}$ 分别是键和值的上投影矩阵. 在推理期间, MLA 只需要缓存 $\mathbf{c}_t^{KV}$, 因此其 KV 缓存仅有 $d_c l$ 个元素. 此外, 在推理期间, 由于 $W^{UK}$ 可以吸收进 $W^Q$, $W^{UV}$ 可以吸收进 $W^O$, 我们甚至不需要为注意力计算显式地恢复 key 和 value.

此外, 为了减少训练期间的激活内存, 我们还对 query 进行低秩压缩, 尽管这不能减少 KV 缓存:

$$ \mathbf{c}_t^Q = W^{DQ} \mathbf{h}_t \tag{12} $$
$$ \mathbf{q}_t^C = W^{UQ} \mathbf{c}_t^Q \tag{13} $$

其中 $\mathbf{c}_t^Q \in \mathbb{R}^{d_c^{\prime}}$ 是 query 的压缩潜在向量; $d_c^{\prime} (\ll d_h n_h)$ 表示 query 压缩维度; $W^{DQ} \in \mathbb{R}^{d_c^{\prime} \times d}, W^{UQ} \in \mathbb{R}^{d_h n_h \times d_c^{\prime}}$ 分别是 query 的下投影和上投影矩阵.

#### 2.1.3 解耦的旋转位置编码

遵循 DeepSeek 67B, 我们打算对 DeepSeek-V2 使用 Rotary Position Embedding(RoPE). 然而, RoPE 与低秩 KV 压缩不兼容. 具体而言, RoPE 对 key 和 query 都是位置敏感的. 如果我们对 key $\mathbf{k}_t^C$ 应用 RoPE, $W^{UK}$ 将与位置敏感的 RoPE 矩阵耦合. 这样, $W^{UK}$ 在推理期间不能再被吸收进 $W^Q$, 因为与当前生成 token 相关的 RoPE 矩阵会位于 $W^Q$ 和 $W^{UK}$ 之间, 而矩阵乘法不满足交换律. 结果, 我们必须在推理期间重新计算所有前缀 token 的 key, 这将严重阻碍推理效率.

作为解决方案, 我们提出了解耦 RoPE 策略, 使用额外的多头 query $\mathbf{q}_{t,i}^R \in \mathbb{R}^{d_h^R}$ 和共享的 key $\mathbf{k}_t^R \in \mathbb{R}^{d_h^R}$ 来承载 RoPE, 其中 $d_h^R$ 表示解耦 query 和 key 的每头维度. 配备解耦 RoPE 策略后, MLA 执行以下计算:

$$ [\mathbf{q}_{t,1}^R; \mathbf{q}_{t,2}^R; ...; \mathbf{q}_{t,n_h}^R] = \mathbf{q}_t^R = \text{RoPE}(W^{QR} \mathbf{c}_t^Q) \tag{14} $$
$$ \mathbf{k}_t^R = \text{RoPE}(W^{KR} \mathbf{h}_t) \tag{15} $$
$$ \mathbf{q}_{t,i} = [\mathbf{q}_{t,i}^C; \mathbf{q}_{t,i}^R] \tag{16} $$
$$ \mathbf{k}_{t,i} = [\mathbf{k}_{t,i}^C; \mathbf{k}_t^R] \tag{17} $$
$$ \mathbf{o}_{t,i} = \sum_{j=1}^{t} \text{Softmax}_j\left(\frac{\mathbf{q}_{t,i}^T \mathbf{k}_{j,i}}{\sqrt{d_h + d_h^R}}\right) \mathbf{v}_{j,i}^C \tag{18} $$
$$ \mathbf{u}_t = W^O [\mathbf{o}_{t,1}; \mathbf{o}_{t,2}; ...; \mathbf{o}_{t,n_h}] \tag{19} $$

其中 $W^{QR} \in \mathbb{R}^{d_h^R n_h \times d_c^{\prime}}$ 和 $W^{KR} \in \mathbb{R}^{d_h^R \times d}$ 分别是产生解耦 query 和 key 的矩阵; $\text{RoPE}(\cdot)$ 表示应用 RoPE 矩阵的操作; $[\cdot; \cdot]$ 表示拼接操作. 在推理期间, 解耦的 key 也需要被缓存. 因此, DeepSeek-V2 每个 token 需要缓存的 KV 元素总数为 $(d_c + d_h^R)l$.

> 译者注: 解耦 RoPE 是 MLA 能够被实际部署的关键. 没有这一设计, MLA 的低秩压缩在推理时会因为 RoPE 的位置耦合而失效 —— 每次生成都需要重新计算所有前缀的 key, 这完全抵消了 KV 缓存节省的收益. 解耦 RoPE 的巧妙之处在于: 将「位置信息」和「语义信息」分离到不同的向量中, 语义部分可以压缩缓存, 位置部分直接携带 RoPE. 这种「信息解耦」的思想在后续 V3 中被保留, 并成为 MLA 的标准实现方式.

#### 2.1.4 KV 缓存对比

表 1 展示了不同注意力机制每个 token 的 KV 缓存对比.

> 表 1: 不同注意力机制的 KV 缓存对比.

| 注意力机制 | 每 Token KV 缓存(元素数) | 能力 |
|-----------|------------------------|------|
| Multi-Head Attention (MHA) | $2 n_h d_h l$ | 强 |
| Grouped-Query Attention (GQA) | $2 n_g d_h l$ | 中等 |
| Multi-Query Attention (MQA) | $2 d_h l$ | 弱 |
| MLA (Ours) | $(d_c + d_h^R)l \approx \frac{9}{2} d_h l$ | 更强 |

对于 DeepSeek-V2, $d_c$ 设为 $4d_h$, $d_h^R$ 设为 $\frac{d_h}{2}$. 因此, 其 KV 缓存等于仅有 2.25 个组的 GQA, 但性能比 MHA 更强.

### 2.2 DeepSeekMoE: 以经济成本训练强大模型

#### 2.2.1 基本架构

对于 FFN, 我们采用 DeepSeekMoE 架构. DeepSeekMoE 有两个核心思想: 将专家分割为更细的粒度以实现更高的专家专业化和更准确的知识获取, 以及隔离一些共享专家来缓解路由专家之间的知识冗余. 在相同数量的激活和总专家参数下, DeepSeekMoE 能够大幅超越传统的 MoE 架构(如 GShard).

设 $\mathbf{u}_t$ 为第 $t$ 个 token 的 FFN 输入, 我们计算 FFN 输出 $\mathbf{h}_t^{\prime}$ 如下:

$$ \mathbf{h}_t^{\prime} = \mathbf{u}_t + \sum_{i=1}^{N_s} \text{FFN}_i^{(s)}(\mathbf{u}_t) + \sum_{i=1}^{N_r} g_{i,t} \text{FFN}_i^{(r)}(\mathbf{u}_t) \tag{20} $$

$$ g_{i,t} = \begin{cases} s_{i,t}, & s_{i,t} \in \text{Topk}(\{s_{j,t} | 1 \leq j \leq N_r\}, K_r) \\ 0, & \text{otherwise} \end{cases} \tag{21} $$

$$ s_{i,t} = \text{Softmax}_i(\mathbf{u}_t^T \mathbf{e}_i) \tag{22} $$

其中 $N_s$ 和 $N_r$ 分别表示共享专家和路由专家的数量; $\text{FFN}_i^{(s)}(\cdot)$ 和 $\text{FFN}_i^{(r)}(\cdot)$ 分别表示第 $i$ 个共享专家和第 $i$ 个路由专家; $K_r$ 表示激活的路由专家数量; $g_{i,t}$ 是第 $i$ 个专家的门控值; $s_{i,t}$ 是 token 到专家的亲和度; $\mathbf{e}_i$ 是该层中第 $i$ 个路由专家的质心; $\text{Topk}(\cdot, K)$ 表示在第 $t$ 个 token 与所有路由专家计算的亲和度分数中, 取最高的 $K$ 个分数组成的集合.

#### 2.2.2 设备限制路由

我们设计了一种设备限制路由机制来限制 MoE 相关的通信成本. 当采用专家并行时, 路由专家将分布在多个设备上. 对于每个 token, 其 MoE 相关通信频率与其目标专家所覆盖的设备数量成正比. 由于 DeepSeekMoE 的细粒度专家分割, 激活的专家数量可能较大, 因此如果我们应用专家并行, MoE 相关通信将更为昂贵.

对于 DeepSeek-V2, 除了朴素的路由专家 top-K 选择外, 我们还额外确保每个 token 的目标专家最多分布在 $M$ 个设备上. 具体而言, 对于每个 token, 我们首先选择具有最高亲和度分数的 $M$ 个设备. 然后, 我们在这些 $M$ 个设备的专家中进行 top-K 选择. 在实践中, 我们发现当 $M \geq 3$ 时, 设备限制路由可以实现与无限制 top-K 路由大致对齐的良好性能.

#### 2.2.3 负载均衡的辅助损失

我们将负载均衡纳入自动学习的路由策略中. 首先, 不平衡的负载会增加路由崩溃的风险, 阻止一些专家被充分训练和利用. 其次, 当采用专家并行时, 不平衡的负载会降低计算效率.

在 DeepSeek-V2 的训练期间, 我们设计了三种辅助损失, 分别用于控制专家级负载均衡($\mathcal{L}_{\text{ExpBal}}$)、设备级负载均衡($\mathcal{L}_{\text{DevBal}}$)和通信均衡($\mathcal{L}_{\text{CommBal}}$).

**专家级均衡损失.** 我们使用专家级均衡损失来缓解路由崩溃的风险:

$$ \mathcal{L}_{\text{ExpBal}} = \alpha_1 \sum_{i=1}^{N_r} f_i P_i \tag{23} $$

$$ f_i = \frac{N_r}{K_r T} \sum_{t=1}^{T} \mathbb{1}(\text{Token } t \text{ selects Expert } i) \tag{24} $$

$$ P_i = \frac{1}{T} \sum_{t=1}^{T} s_{i,t} \tag{25} $$

其中 $\alpha_1$ 是称为专家级均衡因子的超参数; $\mathbb{1}(\cdot)$ 表示指示函数; $T$ 表示序列中的 token 数量.

**设备级均衡损失.** 除了专家级均衡损失外, 我们还额外设计了设备级均衡损失来确保不同设备之间的计算均衡:

$$ \mathcal{L}_{\text{DevBal}} = \alpha_2 \sum_{i=1}^{D} f_i^{\prime} P_i^{\prime} \tag{26} $$

$$ f_i^{\prime} = \frac{1}{|\mathcal{E}_i|} \sum_{j \in \mathcal{E}_i} f_j \tag{27} $$

$$ P_i^{\prime} = \sum_{j \in \mathcal{E}_i} P_j \tag{28} $$

其中 $\alpha_2$ 是称为设备级均衡因子的超参数. 在 DeepSeek-V2 的训练过程中, 我们将所有路由专家划分为 $D$ 组 $\{\mathcal{E}_1, \mathcal{E}_2, ..., \mathcal{E}_D\}$, 并将每组部署在单个设备上.

**通信均衡损失.** 最后, 我们引入通信均衡损失来确保每个设备的通信是均衡的. 尽管设备限制路由机制保证了每个设备的发送通信是有界的, 但如果某个设备接收的 token 比其他设备多, 实际通信效率也会受到影响. 为此, 我们设计通信均衡损失如下:

$$ \mathcal{L}_{\text{CommBal}} = \alpha_3 \sum_{i=1}^{D} f_i^{\prime\prime} P_i^{\prime\prime} \tag{29} $$

$$ f_i^{\prime\prime} = \frac{D}{MT} \sum_{t=1}^{T} \mathbb{1}(\text{Token } t \text{ is sent to Device } i) \tag{30} $$

$$ P_i^{\prime\prime} = \sum_{j \in \mathcal{E}_i} P_j \tag{31} $$

其中 $\alpha_3$ 是称为通信均衡因子的超参数.

> 译者注: V2 使用了三重辅助损失来做负载均衡, 这是与 V3 的关键区别. V3 后来改进为 auxiliary-loss-free 方法, 通过动态偏置调整来替代辅助损失. 为什么 V2 需要三重损失? 因为细粒度专家分割(160 个路由专家)带来了更复杂的路由模式: 专家级崩溃、设备间计算倾斜、通信不均衡是三个独立的问题. 这三重损失的设计反映了团队对 MoE 训练稳定性的深刻理解 —— 负载均衡不是单一指标, 而是需要从多个维度同时优化. 但辅助损失的代价是干扰了语言建模的梯度信号, 这也是 V3 放弃辅助损失的根本原因.

#### 2.2.4 Token 丢弃策略

虽然均衡损失旨在鼓励负载均衡, 但必须承认它们不能保证严格的负载均衡. 为了进一步缓解由负载不均衡造成的计算浪费, 我们在训练期间引入了设备级 token 丢弃策略. 该方法首先计算每个设备的平均计算预算, 即每个设备的容量因子等价于 1.0. 然后, 受启发于相关工作, 我们丢弃每个设备上亲和度分数最低的 token, 直到达到计算预算. 此外, 我们确保属于约 10% 训练序列的 token 永远不会被丢弃. 这样, 我们可以根据效率需求灵活决定是否在推理期间丢弃 token, 并始终确保训练与推理之间的一致性.

---

## 3. 预训练

### 3.1 实验设置

#### 3.1.1 数据构建

在保持与 DeepSeek 67B 相同的数据处理阶段的同时, 我们扩展了数据量并提升了数据质量. 为了扩大预训练语料库, 我们探索了互联网数据的潜力并优化了清洗流程, 从而恢复了大量被误删的数据. 此外, 我们纳入了更多中文数据, 旨在更好地利用中文互联网上可用的语料. 除了数据量之外, 我们还关注数据质量. 我们用来自各种来源的高质量数据丰富了预训练语料库, 同时改进了基于质量的过滤算法. 改进后的算法确保大量非有益数据被移除, 而有价值的数据大部分被保留. 此外, 我们从预训练语料库中过滤掉争议性内容, 以减轻来自特定区域文化的数据偏差.

我们采用与 DeepSeek 67B 相同的 tokenizer, 它基于 Byte-level Byte-Pair Encoding(BBPE)算法构建, 词汇量为 100K. 我们的 tokenized 预训练语料库包含 8.1T token, 其中中文 token 比英文 token 多约 12%.

> 译者注: 数据构建中的一个关键决策是「过滤争议性内容」. 附录中的分析表明, 这一过滤策略导致模型在 MMLU 的 Humanity-Moral 子集上表现稍弱(与美国价值观相关), 但在其他子集上不受影响. 三位人类标注者对 420 个道德场景进行独立标注, 发现他们之间的一致性很低. 这说明「道德判断」本身就是高度主观的, 而模型的「去偏」必然会在某些价值观测试上付出代价. 这是一个重要的产品权衡: 选择「不偏不倚」还是「与某一方对齐」.

#### 3.1.2 超参数

**模型超参数.** 我们将 Transformer 层数设为 60, 隐藏维度设为 5120. 所有可学习参数以标准差 0.006 随机初始化. 在 MLA 中, 我们将注意力头数 $n_h$ 设为 128, 每头维度 $d_h$ 设为 128. KV 压缩维度 $d_c$ 设为 512, query 压缩维度 $d_c^{\prime}$ 设为 1536. 对于解耦的 query 和 key, 我们将每头维度 $d_h^R$ 设为 64. 遵循 DeepSeekMoE 的工作, 我们将除第一层外的所有 FFN 替换为 MoE 层. 每个 MoE 层由 2 个共享专家和 160 个路由专家组成, 每个专家的中间隐藏维度为 1536. 在路由专家中, 每个 token 激活 6 个专家. 此外, 低秩压缩和细粒度专家分割会影响层的输出尺度. 因此, 在实践中, 我们在压缩潜在向量后使用额外的 RMS Norm 层, 并在宽度瓶颈处(即压缩潜在向量和路由专家的中间隐藏状态)乘以额外的缩放因子, 以确保训练稳定. 在此配置下, DeepSeek-V2 包含 236B 总参数, 其中每个 token 激活 21B 参数.

**训练超参数.** 我们采用 AdamW 优化器, 超参数设为 $\beta_1=0.9$, $\beta_2=0.95$, weight_decay=0.1. 学习率使用 warmup-and-step-decay 策略调度. 初始阶段, 学习率在前 2K 步内从 0 线性增加到最大值. 随后, 在训练约 60% 的 token 后, 学习率乘以 0.316; 在训练约 90% 的 token 后, 再次乘以 0.316. 最大学习率设为 $2.4 \times 10^{-4}$, 梯度裁剪范数设为 1.0. 我们还使用 batch size 调度策略, 在前 225B token 的训练中, batch size 从 2304 逐渐增加到 9216, 然后在剩余训练中保持 9216. 我们将最大序列长度设为 4K, 在 8.1T token 上训练 DeepSeek-V2. 我们利用流水线并行将模型的不同层部署在不同设备上, 对于每一层, 路由专家均匀部署在 8 个设备上($D=8$). 对于设备限制路由, 每个 token 最多被发送到 3 个设备($M=3$). 对于均衡损失, 我们将 $\alpha_1$ 设为 0.003, $\alpha_2$ 设为 0.05, $\alpha_3$ 设为 0.02. 我们在训练期间采用 token 丢弃策略来加速, 但在评估期间不丢弃任何 token.

#### 3.1.3 基础设施

DeepSeek-V2 基于 HAI-LLM 框架训练, 这是一个由我们工程师内部开发的高效轻量级训练框架. 它采用 16-way zero-bubble 流水线并行、8-way 专家并行和 ZeRO-1 数据并行. 鉴于 DeepSeek-V2 的激活参数相对较少, 且部分算子被重计算以节省激活内存, 它可以在不需要张量并行的情况下训练, 从而减少通信开销. 此外, 为了进一步提高训练效率, 我们将共享专家的计算与专家并行的 all-to-all 通信重叠. 我们还为通信、路由算法和跨不同专家的融合线性计算定制了更快的 CUDA kernel. 此外, MLA 也基于改进版的 FlashAttention-2 进行了优化.

我们在配备 NVIDIA H800 GPU 的集群上进行所有实验. H800 集群中的每个节点包含 8 个 GPU, 节点内使用 NVLink 和 NVSwitch 连接. 跨节点则利用 InfiniBand 互连来促进通信.

#### 3.1.4 长上下文扩展

在 DeepSeek-V2 的初始预训练后, 我们采用 YaRN 将默认上下文窗口长度从 4K 扩展到 128K. YaRN 专门应用于解耦的共享 key $\mathbf{k}_t^R$, 因为它负责承载 RoPE. 对于 YaRN, 我们将 scale $s$ 设为 40, $\alpha$ 设为 1, $\beta$ 设为 32, 目标最大上下文长度设为 160K. 在这些设置下, 我们可以预期模型对 128K 的上下文长度响应良好. 与原始 YaRN 略有不同, 由于我们独特的注意力机制, 我们调整长度缩放因子来调节注意力熵. 因子 $\sqrt{t}$ 计算为 $\sqrt{t} = 0.0707 \ln{s} + 1$, 旨在最小化困惑度.

我们额外训练模型 1000 步, 序列长度为 32K, batch size 为 576 个序列. 尽管训练仅在 32K 的序列长度上进行, 模型在 128K 的上下文长度下评估时仍表现出稳健的性能. 如图 3 所示, 「Needle In A Haystack」(NIAH)测试结果表明, DeepSeek-V2 在所有长达 128K 的上下文窗口长度上表现良好.

> 图 3: 「Needle In A Haystack」(NIAH)测试的评估结果. DeepSeek-V2 在所有长达 128K 的上下文窗口长度上表现良好.

### 3.2 评估

#### 3.2.1 评估基准

DeepSeek-V2 在双语语料库上预训练, 因此我们在一系列英文和中文基准上对其进行评估. 评估基于我们集成在 HAI-LLM 框架中的内部评估框架. 包含的基准按类别列出如下, 其中下划线标注的基准为中文基准:

- **多主题多选** 数据集: MMLU、C-Eval、CMMLU
- **语言理解与推理** 数据集: HellaSwag、PIQA、ARC、BigBench Hard(BBH)
- **闭卷问答** 数据集: TriviaQA、NaturalQuestions
- **阅读理解** 数据集: RACE、DROP、C3、CMRC
- **指代消歧** 数据集: WinoGrande、CLUEWSC
- **语言建模** 数据集: Pile
- **中文理解与文化** 数据集: CHID、CCPM
- **数学** 数据集: GSM8K、MATH、CMath
- **代码** 数据集: HumanEval、MBPP、CRUXEval
- **标准化考试** 数据集: AGIEval(包含英文和中文子集)

#### 3.2.2 评估结果

表 2 将 DeepSeek-V2 与几个代表性开源模型进行了对比, 包括 DeepSeek 67B(我们之前的发布)、Qwen1.5 72B、LLaMA3 70B 和 Mixtral 8x22B. 我们使用内部评估框架对所有这些模型进行评估, 确保它们共享相同的评估设置.

> 表 2: DeepSeek-V2 与其他代表性开源模型的对比. 加粗表示最佳, 下划线表示次佳. 差距小于 0.3 的分数被视为同一水平. 仅激活 21B 参数, DeepSeek-V2 在开源模型中实现了顶尖性能.

| 领域 | 基准测试(指标) | # Shots | DeepSeek 67B | Qwen1.5 72B | Mixtral 8x22B | LLaMA 3 70B | DeepSeek-V2 |
|------|--------------|---------|-------------|------------|--------------|------------|-------------|
| | 架构 | - | Dense | Dense | MoE | Dense | MoE |
| | 激活参数 | - | 67B | 72B | 39B | 70B | 21B |
| | 总参数 | - | 67B | 72B | 141B | 70B | 236B |
| 英文 | Pile-test(BPB) | - | 0.642 | 0.637 | 0.623 | **0.602** | 0.606 |
| 英文 | BBH(EM) | 3-shot | 68.7 | 59.9 | 78.9 | **81.0** | 78.9 |
| 英文 | MMLU(Acc.) | 5-shot | 71.3 | 77.2 | 77.6 | **78.9** | 78.5 |
| 英文 | DROP(F1) | 3-shot | 69.7 | 71.5 | 80.4 | **82.5** | 80.1 |
| 英文 | ARC-Easy(Acc.) | 25-shot | 95.3 | 97.1 | 97.3 | **97.9** | 97.6 |
| 英文 | ARC-Challenge(Acc.) | 25-shot | 86.4 | 92.8 | 91.2 | **93.3** | 92.4 |
| 英文 | HellaSwag(Acc.) | 10-shot | 86.3 | 85.8 | 86.6 | **87.9** | 84.2 |
| 英文 | PIQA(Acc.) | 0-shot | 83.6 | 83.3 | 83.6 | **85.0** | 83.7 |
| 英文 | WinoGrande(Acc.) | 5-shot | 84.9 | 82.4 | 83.7 | **85.7** | 84.9 |
| 英文 | RACE-Middle(Acc.) | 5-shot | 69.9 | 63.4 | **73.3** | **73.3** | 73.1 |
| 英文 | RACE-High(Acc.) | 5-shot | 50.7 | 47.0 | 56.7 | **57.9** | 52.7 |
| 英文 | TriviaQA(EM) | 5-shot | 78.9 | 73.1 | **82.1** | 81.6 | 79.9 |
| 英文 | NaturalQuestions(EM) | 5-shot | 36.6 | 35.6 | 39.6 | **40.2** | 38.7 |
| 英文 | AGIEval(Acc.) | 0-shot | 41.3 | **64.4** | 43.4 | 49.8 | 51.2 |
| 代码 | HumanEval(Pass@1) | 0-shot | 45.1 | 43.9 | **53.1** | 48.2 | 48.8 |
| 代码 | MBPP(Pass@1) | 3-shot | 57.4 | 53.6 | 64.2 | **68.6** | 66.6 |
| 代码 | CRUXEval-I(Acc.) | 2-shot | 42.5 | 44.3 | 52.4 | 49.4 | **52.8** |
| 代码 | CRUXEval-O(Acc.) | 2-shot | 41.0 | 42.3 | 52.8 | **54.3** | 49.8 |
| 数学 | GSM8K(EM) | 8-shot | 63.4 | 77.9 | 80.3 | **83.0** | 79.2 |
| 数学 | MATH(EM) | 4-shot | 18.7 | 41.4 | 42.5 | 42.2 | **43.6** |
| 数学 | CMath(EM) | 3-shot | 63.0 | 77.8 | 72.3 | 73.9 | **78.7** |
| 中文 | CLUEWSC(EM) | 5-shot | 81.0 | 80.5 | 77.5 | 78.3 | **82.2** |
| 中文 | C-Eval(Acc.) | 5-shot | 66.1 | **83.7** | 59.6 | 67.5 | 81.7 |
| 中文 | CMMLU(Acc.) | 5-shot | 70.8 | **84.3** | 60.0 | 69.3 | 84.0 |
| 中文 | CMRC(EM) | 1-shot | 73.4 | 66.6 | 73.1 | 73.3 | **77.5** |
| 中文 | C3(Acc.) | 0-shot | 75.3 | **78.2** | 71.4 | 74.0 | 77.4 |
| 中文 | CHID(Acc.) | 0-shot | 92.1 | - | 57.0 | 83.2 | **92.7** |
| 中文 | CCPM(Acc.) | 0-shot | 88.5 | 88.1 | 61.0 | 68.1 | **93.1** |

总体而言, 仅激活 21B 参数, DeepSeek-V2 在几乎所有基准上都显著优于 DeepSeek 67B, 并在开源模型中实现了顶尖性能.

与 Qwen1.5 72B(另一个支持中英文的模型)相比, DeepSeek-V2 在大多数英文、代码和数学基准上展现出压倒性优势. 在中文基准上, Qwen1.5 72B 在多主题多选任务上表现更好, 而 DeepSeek-V2 在其他任务上相当或更好.

与 Mixtral 8x22B 相比, DeepSeek-V2 在英文性能上实现了相当或更好的表现, 除了 TriviaQA、NaturalQuestions 和 HellaSwag(与英文常识知识密切相关). 值得注意的是, DeepSeek-V2 在 MMLU 上超越了 Mixtral 8x22B. 在代码和数学基准上, DeepSeek-V2 展现出与 Mixtral 8x22B 相当的性能. 由于 Mixtral 8x22B 没有专门在中文数据上训练, 其中文能力远落后于 DeepSeek-V2.

与 LLaMA3 70B 相比, DeepSeek-V2 在少于四分之一的英文 token 上训练. 因此, 我们承认 DeepSeek-V2 在基础英文能力上仍与 LLaMA3 70B 有轻微差距. 然而, 即使使用更少的训练 token 和激活参数, DeepSeek-V2 仍在代码和数学能力上展现出与 LLaMA3 70B 相当的性能. 此外, 作为双语语言模型, DeepSeek-V2 在中文基准上大幅超越 LLaMA3 70B.

> 译者注: 表 2 的数据揭示了一个重要现象: 在 21B 激活参数下, DeepSeek-V2 的性能接近甚至超越了 70B+ 的稠密模型. 这验证了 MoE 架构的核心假设 —— 通过稀疏激活, 可以用更少的计算获得相当的性能. 但 MoE 的优势不是免费的: 236B 的总参数意味着推理时需要加载更大的模型权重(尽管只激活 21B). 实际的吞吐量优势来自于 MLA 的 KV 缓存压缩(减少 93.3%)和 MoE 的计算稀疏性共同作用. 如果没有 MLA, 236B 模型的推理成本可能反而高于 67B 稠密模型.

#### 3.2.3 训练与推理效率

**训练成本.** 由于 DeepSeek-V2 对每个 token 激活的参数更少, 且所需 FLOPs 低于 DeepSeek 67B, 理论上训练 DeepSeek-V2 将比训练 DeepSeek 67B 更经济. 尽管训练 MoE 模型会引入额外的通信开销, 但通过我们的算子和通信优化, DeepSeek-V2 的训练可以达到相对较高的模型 FLOPs 利用率(MFU). 在实际的 H800 集群训练中, 每训练一万亿个 token, DeepSeek 67B 需要 300.6K GPU 小时, 而 DeepSeek-V2 仅需 172.8K GPU 小时, 即稀疏的 DeepSeek-V2 相比稠密的 DeepSeek 67B 可节省 42.5% 的训练成本.

**推理效率.** 为了高效部署 DeepSeek-V2 提供服务, 我们首先将其参数转换为 FP8 精度. 此外, 我们对 DeepSeek-V2 进行了 KV 缓存量化, 将其 KV 缓存中的每个元素平均压缩至 6 bit. 得益于 MLA 及这些优化, 实际部署的 DeepSeek-V2 所需的 KV 缓存显著少于 DeepSeek 67B, 从而能够支持更大的批处理规模. 我们基于实际部署的 DeepSeek 67B 服务的提示词与生成长度分布, 评估了 DeepSeek-V2 的生成吞吐量. 在配备 8 块 H800 GPU 的单节点上, DeepSeek-V2 的生成吞吐量超过每秒 5 万 token, 是 DeepSeek 67B 最大生成吞吐量的 5.76 倍. 此外, DeepSeek-V2 的提示词输入吞吐量超过每秒 10 万 token.

---

## 4. 对齐

### 4.1 监督微调

基于我们先前的研究, 我们策划了包含 150 万条实例的指令微调数据集, 其中 120 万条用于有用性, 30 万条用于安全性. 与初始版本相比, 我们提高了数据质量以减轻幻觉响应并提升写作能力. 我们以 2 个 epoch 微调 DeepSeek-V2, 学习率设为 $5 \times 10^{-6}$.

### 4.2 强化学习

为了进一步释放 DeepSeek-V2 的潜力并将其与人类偏好对齐, 我们进行强化学习(RL)来调整其偏好.

**RL 算法.** 为了节省 RL 的训练成本, 我们采用 Group Relative Policy Optimization(GRPO), 它省去了通常与策略模型同等规模的 critic 模型, 而是从组分数中估计基线. 对于每个问题 $q$, GRPO 从旧策略 $\pi_{\theta_{old}}$ 中采样一组输出 $\{o_1, o_2, \cdots, o_G\}$, 然后通过最大化以下目标来优化策略模型 $\pi_\theta$:

$$ \mathcal{J}_{GRPO}(\theta) = \mathbb{E}_{[q \sim P(Q), \{o_i\}_{i=1}^G \sim \pi_{\theta_{old}}(O|q)]} \frac{1}{G}\sum_{i=1}^G \left( \min \left( \frac{\pi_\theta(o_i|q)}{\pi_{\theta_{old}}(o_i|q)} A_i, \text{clip}\left(\frac{\pi_\theta(o_i|q)}{\pi_{\theta_{old}}(o_i|q)}, 1-\epsilon, 1+\epsilon\right) A_i \right) - \beta \mathbb{D}_{KL}(\pi_\theta \|\| \pi_{ref}) \right) \tag{32} $$

$$ \mathbb{D}_{KL}(\pi_\theta \|\| \pi_{ref}) = \frac{\pi_{ref}(o_i|q)}{\pi_\theta(o_i|q)} - \log\frac{\pi_{ref}(o_i|q)}{\pi_\theta(o_i|q)} - 1 \tag{33} $$

$$ A_i = \frac{r_i - \text{mean}(\{r_1, r_2, \cdots, r_G\})}{\text{std}(\{r_1, r_2, \cdots, r_G\})} \tag{34} $$

**训练策略.** 在我们的初步实验中, 我们发现推理数据(如代码和数学提示)上的 RL 训练展现出与通用数据训练不同的独特特征. 例如, 模型的数学和编码能力可以在更长的训练步数内持续提升. 因此, 我们采用两阶段 RL 训练策略, 首先进行推理对齐, 然后进行人类偏好对齐.

在第一阶段推理对齐中, 我们为代码和数学推理任务训练奖励模型 $RM_{reasoning}$, 并使用 $RM_{reasoning}$ 的反馈优化策略模型:

$$ r_i = RM_{reasoning}(o_i) \tag{35} $$

在第二阶段人类偏好对齐中, 我们采用多奖励框架, 从有用性奖励模型 $RM_{helpful}$、安全性奖励模型 $RM_{safety}$ 和基于规则的奖励模型 $RM_{rule}$ 获取奖励. 响应 $o_i$ 的最终奖励为:

$$ r_i = c_1 \cdot RM_{helpful}(o_i) + c_2 \cdot RM_{safety}(o_i) + c_3 \cdot RM_{rule}(o_i) \tag{36} $$

其中 $c_1$, $c_2$, $c_3$ 为相应系数.

**训练效率优化.** 在极大模型上进行 RL 训练对训练框架提出了很高的要求. 我们实现了以下工程优化: (1) 采用混合引擎, 分别为训练和推理采用不同的并行策略以实现更高的 GPU 利用率; (2) 利用 vLLM 以大 batch size 作为推理后端来加速推理速度; (3) 精心设计模型卸载到 CPU 和加载回 GPU 的调度策略, 在训练速度和内存消耗之间实现近最优平衡.

### 4.3 评估结果

**标准基准评估.** DeepSeek-V2 Chat (SFT)在 GSM8K、MATH 和 HumanEval 评估中相比其基础版本展现出显著提升, 这可以归因于 SFT 数据中包含大量数学和代码相关内容. 此外, DeepSeek-V2 Chat (RL)进一步提升了数学和代码基准上的性能.

与其他模型相比, DeepSeek-V2 Chat (SFT)在几乎所有英文、数学和代码基准上都超越了 Qwen1.5 72B Chat. 与最先进的开源 MoE 模型 Mixtral 8x22B Instruct 相比, DeepSeek-V2 Chat (SFT)在大多数基准上表现更好, 除了 NaturalQuestions 和 IFEval. 与最先进的开源模型 LLaMA3 70B Chat 相比, DeepSeek-V2 Chat (SFT)在代码和数学相关基准上表现相似. LLaMA3 70B Chat 在 MMLU 和 IFEval 上表现更好, 而 DeepSeek-V2 Chat (SFT)在中文任务上展现更强的性能.

**开放式生成评估.** 对于英文开放式对话生成, 我们利用 MT-Bench 和 AlpacaEval 2.0 作为基准. 如表 3 所示, DeepSeek-V2 Chat (RL)相比 DeepSeek-V2 Chat (SFT)展现出显著的性能优势.

> 表 3: 英文开放式对话评估. AlpacaEval 2.0 使用长度控制胜率作为指标.

| 模型 | MT-Bench | AlpacaEval 2.0 |
|------|---------|---------------|
| DeepSeek 67B Chat | 8.35 | 16.6 |
| Mistral 8x22B Instruct v0.1 | 8.66 | 30.9 |
| Qwen1.5 72B Chat | 8.61 | 36.6 |
| LLaMA3 70B Instruct | **8.95** | 34.4 |
| DeepSeek-V2 Chat (SFT) | 8.62 | 30.0 |
| DeepSeek-V2 Chat (RL) | **8.97** | **38.9** |

DeepSeek-V2 Chat (RL)在两项基准上都优于 Mistral 8x22B Instruct 和 Qwen1.5 72B Chat. 与 LLaMA3 70B Instruct 相比, DeepSeek-V2 Chat (RL)在 MT-Bench 上展现竞争性性能, 在 AlpacaEval 2.0 上显著超越它.

此外, 我们基于 AlignBench 评估中文开放式生成能力. DeepSeek-V2 Chat (SFT)以显著优势超越所有开源中文模型. 它在中文推理和语言上都显著优于第二好的开源模型 Qwen1.5 72B Chat. 此外, DeepSeek-V2 Chat (SFT)和 DeepSeek-V2 Chat (RL)都超越了 GPT-4-0613 和 ERNIEBot 4.0. 具体而言, DeepSeek-V2 Chat (RL)在中文语言理解上表现出卓越性能, 超越了包括 GPT-4-Turbo-1106-Preview 在内的所有模型.

### 4.4 讨论

**SFT 数据量的讨论.** 关于大 SFT 语料库必要性的讨论一直是一个激烈争论的话题. 先前工作认为少于 10K 条实例的 SFT 数据就足以产生令人满意的结果. 然而, 在我们的实验中, 如果使用少于 10K 条实例, 我们在 IFEval 基准上观察到显著的性能下降. 一个可能的解释是, 语言模型需要一定量的数据来发展特定技能. 尽管所需数据量可能随着模型规模增加而减少, 但它不能被完全消除. 我们的观察强调了充足数据对于使 LLM 获得期望能力的关键需求. 此外, SFT 数据的质量也至关重要, 特别是对于涉及写作或开放式问题的任务.

**RL 的对齐税.** 在人类偏好对齐期间, 我们观察到开放式生成基准上的显著性能提升, 无论是 AI 还是人类评估者给出的分数. 然而, 我们也注意到「对齐税」现象, 即对齐过程可能对某些标准基准(如 BBH)的性能产生负面影响. 为了缓解对齐税, 在 RL 阶段, 我们在数据处理和改进训练策略方面做出了大量努力, 最终在标准基准和开放式基准的性能之间实现了可容忍的权衡.

**在线强化学习.** 在我们的偏好对齐实验中, 我们发现在线方法显著优于离线方法. 因此, 我们投入巨大努力实现了用于对齐 DeepSeek-V2 的在线 RL 框架. 关于在线或离线偏好对齐的结论在不同情境下可能有所不同, 我们将更深入的比较和分析留给未来工作.

> 译者注: V2 的 RL 方案是 R1 的前身. 两阶段策略(先推理对齐、后偏好对齐)在 R1 中被进一步发展为四阶段流水线. GRPO 算法在 V2 中首次被用于大规模聊天模型对齐, 随后在 DeepSeekMath 和 R1 中被持续改进. 值得注意的是, V2 的 RL 使用了神经奖励模型(包括代码/数学的专用 RM 和通用 RM), 而 R1-Zero 后来完全放弃了神经 RM, 转向基于规则的奖励. 这个演进反映了团队对「奖励可靠性」问题的深入理解 —— 神经 RM 虽然更通用, 但在大规模 RL 中容易被黑客.

---

## 5. 结论、局限性与未来工作

在本文中, 我们介绍了 DeepSeek-V2, 一个支持 128K 上下文长度的大型 MoE 语言模型. 除了强大的性能外, 得益于其创新架构(包括 MLA 和 DeepSeekMoE), 该模型还具有经济高效的训练和推理效率. 在实际应用中, 与 DeepSeek 67B 相比, DeepSeek-V2 实现了显著更强的性能, 同时节省了 42.5% 的训练成本, 减少了 93.3% 的 KV 缓存, 并将最大生成吞吐量提升至 5.76 倍. 评估结果进一步表明, 仅激活 21B 参数的 DeepSeek-V2, 在开源模型中达到了顶级性能, 并成为最强的开源 MoE 模型.

DeepSeek-V2 及其聊天版本存在其他大型语言模型中常见的公认局限性, 包括预训练后缺乏持续的知识更新、可能生成未经核实建议等非事实信息, 以及存在产生幻觉的可能性. 此外, 由于我们的数据主要由中文和英文内容构成, 我们的模型在其他语言中的能力可能有限. 在中英文以外的场景中, 应谨慎使用.

DeepSeek 将以长期主义精神持续投入开源大模型, 致力于逐步接近通用人工智能的目标.

- 在我们正在进行的探索中, 我们致力于设计方法, 在保持经济训练和推理成本的同时, 进一步扩展 MoE 模型. 我们下一步的目标是在 upcoming release 中实现与 GPT-4 相当的性能.
- 我们的对齐团队持续努力增强模型, 旨在开发一个不仅对用户有帮助, 而且诚实且安全的模型. 我们的最终目标是将模型的价值观与人类价值观对齐, 同时最小化对人类监督的需求.
- 目前, DeepSeek-V2 设计为仅支持文本模态. 在我们的前瞻性议程中, 我们打算使模型支持多种模态, 增强其在更广泛场景中的多功能性和实用性.

---

## 附录 A: DeepSeek-V2-Lite

为促进对 MLA 和 DeepSeekMoE 的进一步研究与开发, 我们还面向开源社区发布了 DeepSeek-V2-Lite, 这是一个配备 MLA 和 DeepSeekMoE 的较小模型. 它共有 15.7B 参数, 每个 token 激活 2.4B 参数.

**架构.** DeepSeek-V2-Lite 有 27 层, 隐藏维度为 2048. 它也采用 MLA, 有 16 个注意力头, 每头维度为 128. 其 KV 压缩维度为 512, 但与 DeepSeek-V2 略有不同, 它不压缩 query. 对于解耦的 query 和 key, 其每头维度为 64. DeepSeek-V2-Lite 也采用 DeepSeekMoE, 除第一层外的所有 FFN 都被替换为 MoE 层. 每个 MoE 层由 2 个共享专家和 64 个路由专家组成, 每个专家的中间隐藏维度为 1408. 在路由专家中, 每个 token 激活 6 个专家. 在此配置下, DeepSeek-V2-Lite 包含 15.7B 总参数, 其中每个 token 激活 2.4B 参数.

**训练细节.** DeepSeek-V2-Lite 在与 DeepSeek-V2 相同的预训练语料库上从头训练, 该语料库未被任何 SFT 数据污染. 它使用 AdamW 优化器, 超参数设为 $\beta_1=0.9$, $\beta_2=0.95$, weight_decay=0.1. 学习率使用 warmup-and-step-decay 策略调度. 最大学习率设为 $4.2 \times 10^{-4}$, 梯度裁剪范数设为 1.0. 我们不为它采用 batch size 调度策略, 而是使用恒定的 4608 序列 batch size 进行训练. 预训练期间, 最大序列长度设为 4K, 在 5.7T token 上训练 DeepSeek-V2-Lite. 我们利用流水线并行将不同层部署在不同设备上, 但对于每一层, 所有专家都部署在同一设备上. 因此, 我们只采用较小的专家级均衡损失($\alpha_1=0.001$), 不为它采用设备级均衡损失和通信均衡损失.

表 4 和表 5 分别展示了 DeepSeek-V2-Lite 基础模型和聊天模型的性能. DeepSeek-V2-Lite 在推理、编码和数学方面表现出压倒性的性能优势.

> 表 4: DeepSeek-V2-Lite、DeepSeekMoE 16B 和 DeepSeek 7B 的性能对比.

| 领域 | 基准测试 | DeepSeek 7B | DeepSeekMoE 16B | DeepSeek-V2-Lite |
|------|---------|------------|----------------|-----------------|
| | 架构 | MHA+Dense | MHA+MoE | MLA+MoE |
| | 上下文长度 | 4K | 4K | 32K |
| | 激活参数 | 6.9B | 2.8B | 2.4B |
| | 总参数 | 6.9B | 16.4B | 15.7B |
| | 训练 Token | 2T | 2T | 5.7T |
| 英文 | MMLU | 48.2 | 45.0 | **58.3** |
| 英文 | BBH | 39.5 | 38.9 | **44.1** |
| 英文 | TriviaQA | 59.7 | **64.8** | 64.2 |
| 英文 | NaturalQuestions | 22.2 | 25.5 | **26.0** |
| 英文 | ARC-Easy | 67.9 | 68.1 | **70.9** |
| 英文 | ARC-Challenge | 48.1 | 49.8 | **51.2** |
| 英文 | AGIEval | 26.4 | 17.4 | **33.2** |
| 代码 | HumanEval | 26.2 | 26.8 | **29.9** |
| 代码 | MBPP | 39.0 | 39.2 | **43.2** |
| 数学 | GSM8K | 17.4 | 18.8 | **41.1** |
| 数学 | MATH | 3.3 | 4.3 | **17.1** |
| 数学 | CMath | 34.5 | 40.4 | **58.4** |
| 中文 | CLUEWSC | 73.1 | 72.1 | **74.3** |
| 中文 | C-Eval | 45.0 | 40.6 | **60.3** |
| 中文 | CMMLU | 47.2 | 42.5 | **64.3** |

> 表 5: DeepSeek-V2-Lite Chat、DeepSeekMoE 16B Chat 和 DeepSeek 7B Chat 的性能对比.

| 领域 | 基准测试 | DeepSeek 7B Chat | DeepSeekMoE 16B Chat | DeepSeek-V2-Lite Chat |
|------|---------|-----------------|---------------------|----------------------|
| | 架构 | MHA+Dense | MHA+MoE | MLA+MoE |
| | 上下文长度 | 4K | 4K | 32K |
| | 激活参数 | 6.9B | 2.8B | 2.4B |
| | 总参数 | 6.9B | 16.4B | 15.7B |
| | 训练 Token | 2T | 2T | 5.7T |
| 英文 | MMLU | 49.7 | 47.2 | **55.7** |
| 英文 | BBH | 43.1 | 42.2 | **48.1** |
| 英文 | TriviaQA | 59.5 | 63.3 | **65.2** |
| 英文 | NaturalQuestions | 32.7 | 35.1 | **35.5** |
| 英文 | ARC-Easy | 70.2 | 69.9 | **74.3** |
| 英文 | ARC-Challenge | 50.2 | 50.0 | **51.5** |
| 英文 | AGIEval | 17.6 | 19.7 | **42.8** |
| 代码 | HumanEval | 45.1 | 45.7 | **57.3** |
| 代码 | MBPP | 39.0 | **46.2** | 45.8 |
| 数学 | GSM8K | 62.6 | 62.2 | **72.0** |
| 数学 | MATH | 14.7 | 15.2 | **27.9** |
| 数学 | CMath | 66.4 | 67.9 | **71.7** |
| 中文 | CLUEWSC | 66.2 | 68.2 | **80.0** |
| 中文 | C-Eval | 44.7 | 40.0 | **60.1** |
| 中文 | CMMLU | 51.2 | 49.3 | **62.5** |

---

## 附录 B: 注意力机制消融实验

### B.1 MHA、GQA 和 MQA 的消融

表 6 展示了 7B 稠密模型分别配备 MHA、GQA 和 MQA 在四个困难基准上的评估结果. 所有三个模型都在 1.33T token 上训练, 除注意力机制外共享相同的架构. 此外, 为公平比较, 我们通过调整层数将它们的参数量对齐到约 7B. 从表中可以发现, MHA 在这些基准上相比 GQA 和 MQA 展现出显著优势.

> 表 6: 配备 MHA、GQA 和 MQA 的 7B 稠密模型对比. MHA 在困难基准上相比 GQA 和 MQA 展现出显著优势.

| 基准测试(指标) | # Shots | Dense 7B w/ MQA | Dense 7B w/ GQA(8 Groups) | Dense 7B w/ MHA |
|--------------|---------|----------------|--------------------------|----------------|
| 参数量 | - | 7.1B | 6.9B | 6.9B |
| BBH(EM) | 3-shot | 33.2 | 35.6 | **37.0** |
| MMLU(Acc.) | 5-shot | 37.9 | 41.2 | **45.2** |
| C-Eval(Acc.) | 5-shot | 30.0 | 37.7 | **42.9** |
| CMMLU(Acc.) | 5-shot | 34.6 | 38.4 | **43.5** |

### B.2 MLA 与 MHA 的对比

表 7 展示了配备 MLA 和 MHA 的 MoE 模型在四个困难基准上的评估结果. 为得出可靠结论, 我们在两个规模上训练和评估模型. 两个小型 MoE 模型包含约 16B 总参数, 在 1.33T token 上训练. 两个大型 MoE 模型包含约 250B 总参数, 在 420B token 上训练. 两个小型 MoE 模型和两个大型 MoE 模型分别共享相同的架构, 除注意力机制外.

> 表 7: MLA 与 MHA 在困难基准上的对比. MLA 展现出比 MHA 更好的性能, 但需要的 KV 缓存显著更少.

| 基准测试(指标) | # Shots | Small MoE w/ MHA | Small MoE w/ MLA | Large MoE w/ MHA | Large MoE w/ MLA |
|--------------|---------|-----------------|-----------------|-----------------|-----------------|
| 激活参数 | - | 2.5B | 2.4B | 25.0B | 21.5B |
| 总参数 | - | 15.8B | 15.7B | 250.8B | 247.4B |
| 每 Token KV 缓存(元素数) | - | 110.6K | 15.6K | 860.2K | 34.6K |
| BBH(EM) | 3-shot | 37.9 | **39.0** | 46.6 | **50.7** |
| MMLU(Acc.) | 5-shot | 48.7 | **50.0** | 57.5 | **59.0** |
| C-Eval(Acc.) | 5-shot | **51.6** | 50.9 | 57.9 | **59.2** |
| CMMLU(Acc.) | 5-shot | 52.3 | **53.4** | 60.7 | **62.5** |

从表中可以观察到, MLA 展现出比 MHA 更好的性能. 更重要的是, MLA 需要的 KV 缓存显著更少(小型 MoE 模型为 14%, 大型 MoE 模型为 4%).

> 译者注: 表 7 的数据非常关键. 它直接证明了 MLA 的「双重优势」: 在性能上超越 MHA, 在 KV 缓存上大幅减少. 小型 MoE 模型的 KV 缓存从 110.6K 降到 15.6K(约 7 倍压缩), 大型 MoE 模型从 860.2K 降到 34.6K(约 25 倍压缩). 大型模型的压缩比更高, 这是因为 V2 的 MLA 配置中 $d_c=512$ 是固定的, 不随模型规模增长, 而 MHA 的 KV 缓存随层数和头数线性增长. 这意味着 MLA 的优势在更大的模型上更加显著 —— 这正是 V3 能够支持 128K 上下文的关键因素.

---

## 附录 C: 术语表

| 英文术语 | 中文译名 | 首次出现位置 | 简要解释 |
|---------|---------|------------|---------|
| MLA | 多头潜在注意力 | 摘要 | 通过低秩联合压缩 KV 来减少缓存的注意力机制 |
| DeepSeekMoE | DeepSeek 混合专家 | 摘要 | 细粒度专家分割 + 共享专家隔离的 MoE 架构 |
| MoE | 混合专家 | 摘要 | 稀疏激活的大规模神经网络架构 |
| MHA | 多头注意力 | 第 2.1.1 节 | 标准 Transformer 注意力机制 |
| GQA | 分组查询注意力 | 第 2.1 节 | 多组共享 KV 头的注意力机制 |
| MQA | 多查询注意力 | 第 2.1 节 | 所有头共享单组 KV 的注意力机制 |
| RoPE | 旋转位置编码 | 第 2.1.3 节 | 通过旋转矩阵编码位置信息的位置编码方案 |
| GRPO | 群组相对策略优化 | 第 4.2 节 | 无需价值模型的 RL 算法 |
| YaRN |  yet another RoPE extension method | 第 3.1.4 节 | 扩展上下文窗口的位置编码外推方法 |
| MFU | 模型 FLOPs 利用率 | 第 3.2.3 节 | 实际训练吞吐量与理论峰值的比例 |

---

## 附录 D: 核心公式索引

| 编号 | 公式 | 所在章节 | 说明 |
|------|------|---------|------|
| (1)-(8) | 标准 MHA | 第 2.1.1 节 | Multi-Head Attention 的完整计算流程 |
| (9)-(11) | 低秩 KV 联合压缩 | 第 2.1.2 节 | MLA 的核心压缩机制 |
| (12)-(13) | Query 低秩压缩 | 第 2.1.2 节 | 减少训练激活内存 |
| (14)-(19) | 解耦 RoPE + MLA | 第 2.1.3 节 | MLA 的完整推理计算流程 |
| (20)-(22) | DeepSeekMoE | 第 2.2.1 节 | 共享专家 + 路由专家的 FFN 计算 |
| (23)-(25) | 专家级均衡损失 | 第 2.2.3 节 | 防止路由崩溃 |
| (26)-(28) | 设备级均衡损失 | 第 2.2.3 节 | 跨设备计算均衡 |
| (29)-(31) | 通信均衡损失 | 第 2.2.3 节 | All-to-All 通信均衡 |
| (32)-(34) | GRPO | 第 4.2 节 | 群组相对策略优化目标函数 |
| (35) | 推理奖励 | 第 4.2 节 | 代码/数学推理奖励模型 |
| (36) | 综合奖励 | 第 4.2 节 | 多奖励框架组合 |

---

## 附录 E: 模型谱系定位

- **直接继承自**: DeepSeek 67B(稠密模型, 2024 年初发布)、DeepSeekMoE(专家架构, 2024 年 1 月)、DeepSeekMath(GRPO 算法)
- **核心创新**:
  1. MLA(Multi-head Latent Attention): 低秩 KV 联合压缩 + 解耦 RoPE, 推理 KV 缓存减少 93.3%
  2. DeepSeekMoE 大规模应用: 236B 总参数 / 21B 激活参数, 细粒度 160 路由专家
  3. 三重辅助损失: 专家级 + 设备级 + 通信级负载均衡
  4. 设备限制路由: 每个 token 最多发送到 3 个设备, 控制通信成本
  5. Token 丢弃策略: 灵活处理负载不均衡
- **被后续工作引用/影响**:
  - DeepSeek-V3 直接继承并扩展了 MLA 和 DeepSeekMoE
  - V3 将辅助损失改进为 auxiliary-loss-free 方法
  - MLA 成为后续开源模型(Qwen3、GLM-5 等)的参考架构
  - DeepSeek-V2-Lite 为社区提供了可快速实验的小规模 MLA+MoE 模型

---

*本文档为 DeepSeek-V2 技术报告的逐字精读翻译. 所有数据、公式和实验结果均忠实于原文. 技术思考段落以「译者注」标识, 供读者参考.*
