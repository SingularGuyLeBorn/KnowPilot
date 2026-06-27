---
title: "DeepSeek-V3 核心架构剖析"
---

# DeepSeek-V3 核心架构剖析

> 🔙 **[返回 14.1-DeepSeek 家族总览](../../14.1-DeepSeek.md)**


> 本文基于《DeepSeek-V3 技术报告精译》的架构章节, 对 MLA、DeepSeekMoE、MTP 三大核心创新进行数理推导、谱系定位与横向对比. 目标是不仅回答「DeepSeek-V3 做了什么」, 更回答「为什么这样做」以及「代价是什么」.

---

## 1 MLA 的数理本质与谱系定位

### 1.1 从 MHA 到 MLA: KV Cache 压缩的极限

标准 Multi-Head Attention(MHA)中, 每个 token 的 KV Cache 大小为:

$$ \text{KV Cache}_{\text{MHA}} = 2 \times n_h \times d_h \times L $$

其中 $L$ 为序列长度. 在 DeepSeek-V3 的配置下($n_h=128, d_h=128$):

$$ \text{KV Cache}_{\text{MHA}} = 2 \times 128 \times 128 \times L = 32768L \text{ (浮点数)} $$

MLA 通过低秩联合压缩将 Key 和 Value 压缩为潜在向量:

$$ \text{KV Cache}_{\text{MLA}} = (d_c + d_h^R) \times L = (512 + 64) \times L = 576L \text{ (浮点数)} $$

压缩比:

$$ \text{压缩比} = \frac{32768}{576} \approx 56.9\times $$

这意味着在 128K 上下文、BF16 精度下, MLA 的 KV Cache 仅需约 144 MB, 而 MHA 需要约 8.2 GB. 从服务成本的角度看, 这是 DeepSeek-V3 API 定价(输入 $0.14/百万 token)能够远低于 GPT-4o(输入 $2.50/百万 token)的直接技术基础.

> 译者注: 57 倍的 KV Cache 压缩不是免费午餐. MLA 需要在推理时执行额外的矩阵投影: 先从缓存的 $\mathbf{c}_t^{KV}$ 恢复出每个头的 Key 和 Value($W^{UK}$ 和 $W^{UV}$ 上投影), 这引入了额外的计算开销. 但在现代 GPU 上, 矩阵乘法的计算密度远高于内存访问, 因此「减少内存带宽消耗」带来的收益通常超过「增加计算量」的代价. 具体来说, 在解码阶段(decoding), 瓶颈是内存带宽(加载 KV Cache)而非计算, MLA 的压缩直接缓解了带宽瓶颈. 在预填充阶段(prefilling), 计算是瓶颈, MLA 的额外投影开销相对较小. 这种「显存换计算」的权衡在长序列场景下几乎总是划算的.

### 1.2 低秩压缩的信息论解释

MLA 的核心假设是: Key 和 Value 在特征维度上存在高度冗余. 通过下投影矩阵 $W^{DKV} \in \mathbb{R}^{d_c \times d}$ 将 $d=7168$ 维的隐藏状态压缩到 $d_c=512$ 维, 这相当于在 7168 维空间中寻找一个 512 维的子空间, 使得注意力计算在该子空间上的投影损失最小.

从信息论角度看, 这类似于对 Key-Value 对进行有损压缩, 压缩率 $r = d/d_c = 7168/512 = 14$. 但实验表明, 这种压缩几乎不损失模型质量, 说明注意力头之间的 Key-Value 信息确实高度冗余. 一个直觉性的解释是: 不同的注意力头虽然关注不同的语义模式(如句法、指代、语义关系), 但这些模式在低维潜在空间中是可分离的, 不需要为每个头单独存储完整的 Key-Value 表示.

Query 的低秩压缩($d_c^{\prime}=1536$)则更为激进:

$$ \text{Q 压缩率} = \frac{d_h n_h}{d_c^{\prime}} = \frac{128 \times 128}{1536} = \frac{16384}{1536} \approx 10.7 $$

Query 压缩只在训练期间有效(减少激活显存), 推理时 Query 不需要缓存, 因此不影响推理成本.

### 1.3 解耦 RoPE 的数学本质

标准 RoPE 将位置编码直接施加在 Key 向量上. 如果 MLA 对所有 Key 进行联合低秩压缩, 位置信息会在压缩过程中丢失或混淆. DeepSeek 的解决方案是「解耦 RoPE」:

- 压缩向量 $\mathbf{c}_t^{KV}$ 不携带位置信息
- 单独的 $\mathbf{k}_t^R$ 携带 RoPE, 且所有注意力头共享

这样, 每个头的完整 Key 为 $[\mathbf{k}_{t,i}^C; \mathbf{k}_t^R]$, 其中 $\mathbf{k}_{t,i}^C$ 从压缩向量恢复, $\mathbf{k}_t^R$ 直接提供位置信息. 注意力分数计算时的有效维度为 $d_h + d_h^R = 128 + 64 = 192$, 因此式 (10) 中的分母为 $\sqrt{192}$ 而非 $\sqrt{128}$.

> 译者注: 解耦 RoPE 是 MLA 能够工作的关键. 如果没有解耦设计, RoPE 会「污染」低秩压缩向量, 使得不同位置上的压缩向量无法共享相同的子空间. 另一个常被忽视的细节是: 解耦 RoPE 只作用于 $\mathbf{k}_t^R$ 而不作用于 $\mathbf{c}_t^{KV}$, 这意味着在推理缓存时, 只需要存储 $d_c=512$ 维的压缩向量和 $d_h^R=64$ 维的解耦键, 总共 576 维, 而不是存储每个头独立的 RoPE 键. 此外, DeepSeek-V3 在长上下文扩展(4K→32K→128K)时, 只将 YaRN 应用于解耦的共享键 $\mathbf{k}_t^R$, 而不应用于压缩潜在向量中的键 $\mathbf{k}_{t,i}^C$, 这简化了位置外推的实现.

### 1.4 MLA 与 GQA/MQA 的对比矩阵

MLA 不是第一个试图压缩 KV Cache 的方案. 下表将 MLA 与 GQA(Grouped-Query Attention)和 MQA(Multi-Query Attention)进行对比:

| 维度 | MHA | MQA | GQA | MLA |
|:---|:---|:---|:---|:---|
| KV 存储/头 | $2 \times d_h$ | $2 \times d_h / n_h$ | $2 \times d_h / g$ | $(d_c + d_h^R) / n_h$ |
| 总 KV Cache | $2 n_h d_h L$ | $2 d_h L$ | $2 n_h d_h L / g$ | $(d_c + d_h^R) L$ |
| DeepSeek-V3 配置下的 Cache | $32768L$ | $256L$ | $1024L$(g=4) | $576L$ |
| 压缩位置 | 无 | 头维度 | 头维度 | 特征维度 |
| 与 MHA 质量差距 | 0% | 较大 | 中等 | 接近 0% |
| 额外计算 | 无 | 无 | 无 | 低秩投影 |
| 谱系位置 | 基础 | MQA(GQA 的前身) | MHA→MQA 折中 | GQA 之上的进一步压缩 |

其中 $g$ 为 GQA 的组数. MLA 在 DeepSeek-V3 上的 KV Cache($576L$)介于 MQA($256L$)和 GQA($1024L$)之间, 但质量损失远小于 MQA, 与 MHA 几乎持平.

从谱系上看, 注意力压缩的演进路线是:

```
MHA (2017, Vaswani) → MQA (2019, Shazeer) → GQA (2023, Ainslie) → MLA (2024, DeepSeek)
```

每个方案都是在「压缩比」和「质量损失」之间寻找更优的帕累托前沿. MLA 的独特之处在于它不是在「头的维度」上做压缩(如 MQA/GQA), 而是在「特征维度」上做低秩压缩, 这使得它可以与 GQA 叠加使用(如 Qwen3 同时采用 GQA + MLA).

---

## 2 DeepSeekMoE 的架构演进

### 2.1 细粒度专家与共享专家隔离

DeepSeekMoE 的 FFN 输出:

$$ \mathbf{h}_t^{\prime} = \mathbf{u}_t + \underbrace{\sum_{i=1}^{N_s} \operatorname{FFN}_i^{(s)}(\mathbf{u}_t)}_{\text{共享专家}} + \underbrace{\sum_{i=1}^{N_r} g_{i,t} \operatorname{FFN}_i^{(r)}(\mathbf{u}_t)}_{\text{路由专家}} $$

共享专家的设计确保核心能力(如基础语法、常识推理)不会被路由随机性影响. 在 DeepSeek-V3 中, $N_s=1, N_r=256, K_r=8$, 即每个 token 经过 1 个共享专家 + 8 个路由专家, 激活率仅 $(1+8)/256 = 3.52\%$, 这是稀疏性的极致.

每个专家的中间隐藏维度为 2048, 远小于标准 Dense FFN 的 $4 \times d = 28672$. 这意味着单个路由专家的参数量约为标准 FFN 的 $2048/28672 \approx 7.1\%$. 256 个路由专家的总参数量约为 $256 \times 7.1\% \approx 18.2$ 个标准 FFN, 加上共享专家, 每个 MoE 层的总参数量约等于 19 个标准 FFN. 但由于每个 token 只激活 9 个专家, 实际计算量仅相当于 9 个标准 FFN 的 7.1%, 即约 0.64 个标准 FFN.

> 译者注: 前三层保持 Dense FFN(非 MoE)是一个容易被忽视但非常重要的设计选择. 浅层负责提取最基础的局部特征(如词边界、基本句法), 这些特征对所有 token 都是通用的, 不需要稀疏路由. 如果在浅层就引入 MoE, 某些基础特征可能因为路由的随机性而丢失. 此外, 浅层的计算量相对较小, 引入 MoE 的收益有限, 但会增加通信开销和实现复杂度. 这种「浅层 dense + 深层 MoE」的分层策略在后续模型(如 Qwen2-MoE、MiniMax-M2)中被广泛借鉴.

### 2.2 Auxiliary-Loss-Free: 从优化问题到工程实现

传统辅助损失将负载均衡作为约束加入优化目标:

$$ \mathcal{L}_{\text{total}} = \mathcal{L}_{\text{LM}} + \alpha \mathcal{L}_{\text{aux}} $$

这等价于在原始损失函数上增加了一个拉格朗日乘子项. 问题是, 这个乘子会干扰语言建模的梯度信号, 当 $\alpha$ 较大时, 模型被迫牺牲部分语言能力来满足负载均衡.

Auxiliary-loss-free 方法将负载均衡从「损失约束」转移到「路由策略」:

$$ g_{i,t}^{\prime} = \mathbb{1}\left[s_{i,t} + b_i \in \text{Top-}K(\{s_{j,t} + b_j\})\right] $$

偏置 $b_i$ 通过一个简单的反馈规则更新:

$$ b_i \leftarrow b_i - \gamma \cdot \text{sign}(\text{load}_i - \text{target}) $$

这实际上是一个在线控制问题: 通过调整偏置来控制系统(专家负载)的输出, 使其跟踪目标(均衡负载). 由于偏置只影响路由决策, 不影响门控值 $g_{i,t}$(即不影响实际计算的加权和), 模型的学习信号保持纯净.

> 译者注: Auxiliary-loss-free 的本质优势在于「batch-wise 均衡」比「sequence-wise 均衡」更灵活. 序列级辅助损失强制每个序列内部必须均衡, 这导致专家无法根据序列的域特性进行深度专业化. 例如, 一个数学序列可能自然倾向于路由到某些擅长数学的专家, 而序列级辅助损失会惩罚这种倾向. Batch-wise 均衡则允许数学序列集中使用数学专家, 只要整个 batch 的负载最终均衡即可. 原文中的消融实验(表 5)表明, 即使使用 batch-wise 辅助损失(而非完全无辅助损失的偏置方法), 也能达到与 auxiliary-loss-free 相似的性能, 这进一步验证了「batch-wise」是性能提升的关键.

### 2.3 专家专业化模式分析

Auxiliary-loss-free 方法的一个附带效应是增强了专家的专业化程度. 在 Pile 测试集不同领域上的专家负载分析显示, auxiliary-loss-free 模型的专家专业化模式明显大于基于辅助损失的模型.

这意味着某些专家专门负责处理代码 token, 某些专家专门处理数学公式, 某些专家专门处理叙事文本. 这种专业化使得 MoE 模型在特定领域上的表现可以超越同等激活参数量的 Dense 模型, 因为每个领域都可以由最擅长该领域的专家组来处理.

然而, 专家专业化也带来了部署时的负载不均衡问题: 在推理阶段, 如果输入主要是代码, 那么负责代码的专家会过载, 而其他专家则空闲. DeepSeek-V3 的解决方案是「冗余专家部署」(prefilling 阶段设置 32 个冗余专家)和「动态冗余」(每 GPU 托管 16 个专家但只激活 9 个), 这些策略在 03-工程落地精读中有详细讨论.

### 2.4 与 Switch Transformer/GShard 的对比

| 维度 | GShard | Switch Transformer | DeepSeekMoE |
|:---|:---|:---|:---|
| 专家粒度 | 粗(每层 1-2 个专家) | 粗(每层 1 个专家) | 细(256 个路由专家) |
| 共享专家 | 无 | 无 | 有(1 个) |
| 负载均衡 | 辅助损失 | 辅助损失 + Token Dropping | Auxiliary-Loss-Free |
| 丢弃 Token | 是(容量限制) | 是 | 否 |
| 激活专家数 | 1-2 | 1 | 8+1 |
| 路由函数 | Softmax | Softmax | Sigmoid + Top-K |
| 专家容量 | 固定 | 固定 | 动态(冗余专家) |

DeepSeekMoE 的细粒度设计和 auxiliary-loss-free 策略使其在保持高稀疏性的同时避免了传统 MoE 的两大问题: 负载不均衡导致的 token 丢弃, 以及辅助损失对模型质量的损害.

---

## 3 MTP 的训练动力学与推理应用

### 3.1 多 token 预测作为稠化目标

标准 next-token prediction 的损失:

$$ \mathcal{L}_{\text{NT}} = -\frac{1}{T} \sum_{t=1}^{T} \log P(t_{t+1} | t_{1:t}) $$

MTP 增加了一个额外深度($D=1$)的损失:

$$ \mathcal{L}_{\text{MTP}} = \frac{\lambda}{D} \sum_{k=1}^{D} \mathcal{L}_{\text{MTP}}^k $$

其中:

$$ \mathcal{L}_{\text{MTP}}^1 = -\frac{1}{T} \sum_{t=1}^{T} \log P(t_{t+2} | t_{1:t}, \text{MTP}_1) $$

总损失变为 $\mathcal{L} = \mathcal{L}_{\text{NT}} + \mathcal{L}_{\text{MTP}}$. 这相当于为每个训练位置增加了额外的监督信号, 信号密度提升了 $(1+\lambda)$ 倍(在 $D=1$ 时, $\lambda$ 从 0.3 降至 0.1).

> 译者注: MTP 的训练收益在消融实验(表 4)中得到了验证: 在小型 MoE 模型上, HumanEval 从 20.7 提升到 26.8(+29%), GSM8K 从 25.4 提升到 31.4(+24%). 有趣的是, 大规模模型上的增益相对温和, 这可能是因为大模型本身的数据效率已经较高, 从稠化信号中获益较少. 另一个值得思考的问题是: 为什么 DeepSeek-V3 只使用 $D=1$(预测 1 个额外 token), 而不是更大的 $D$? 原因有三: (1) 更大的 $D$ 显著增加训练内存; (2) 额外预测 token 的边际收益递减; (3) 推理时 MTP 模块可直接丢弃, $D=1$ 已经是「零推理成本」的最小单元.

### 3.2 因果链保持的重要性

Meta 的原始 MTP 使用独立输出头并行预测 $D$ 个未来 token. DeepSeek 指出这种方法破坏了因果链: 预测 $t+2$ 时没有考虑 $t+1$ 的预测结果.

DeepSeek 的 MTP 通过顺序模块保持完整因果链:

$$ \mathbf{h}_i^{\prime 1} = M_1[\text{RMSNorm}(\mathbf{h}_i^0); \text{RMSNorm}(\text{Emb}(t_{i+1}))] $$

$$ \mathbf{h}_i^1 = \text{TRM}_1(\mathbf{h}_i^{\prime 1}) $$

$$ P_{i+2}^1 = \text{OutHead}(\mathbf{h}_i^1) $$

这里 $\mathbf{h}_i^0$ 是主模型输出, $t_{i+1}$ 是真实 token. 第 1 个 MTP 模块的输入明确包含了第 $t+1$ 个 token 的信息, 确保预测 $t+2$ 时遵循正确的因果关系. 这与 EAGLE 的投机解码实现类似, 但 DeepSeek 的目标是改善训练而非加速推理.

### 3.3 MTP 在推理中的双重角色

MTP 模块在推理阶段有两种用法:

**验证模式**: 并行预测第 2 个 token, 主模型预测第 1 个 token. 如果 MTP 预测正确, 直接接受, 节省一次前向传播.

**投机解码模式**: MTP 生成候选序列, 主模型并行验证. 由于 MTP 与主模型共享嵌入层和输出头, 其分布与主模型高度一致, 接受率(85%-90%)显著高于传统独立 draft model.

在 DeepSeek-V3 的部署中, MTP 的投机解码可将解码速度提升至 1.8 倍 TPS.

---

## 4 整体架构配置与横向对比

### 4.1 模型超参数配置

| 超参数 | DeepSeek-V3 | Llama-3.1 405B | Qwen2.5 72B |
|:---|:---|:---|:---|
| 架构 | MoE | Dense | Dense |
| 总参数 | 671B | 405B | 72B |
| 激活参数/token | 37B | 405B | 72B |
| Transformer 层数 | 61 | 126 | 80 |
| 隐藏维度 | 7168 | 16384 | 8192 |
| 注意力头数 $n_h$ | 128 | 128 | 64 |
| 每头维度 $d_h$ | 128 | 128 | 128 |
| KV 压缩维度 $d_c$ | 512 | 无(MHA) | 无(GQA) |
| FFN/MoE 中间维度 | 2048(专家) | 53248 | 29568 |
| 共享专家数 $N_s$ | 1 | 无 | 无 |
| 路由专家数 $N_r$ | 256 | 无 | 无 |
| 激活路由专家数 $K_r$ | 8 | 无 | 无 |
| 上下文窗口 | 128K | 128K | 128K |
| 位置编码 | RoPE(解耦) | RoPE | RoPE |
| 注意力类型 | MLA | MHA | GQA |

从上表可以看出, DeepSeek-V3 的隐藏维度(7168)和层数(61)介于 Qwen2.5 72B 和 Llama-3.1 405B 之间, 但由于 MoE 的稀疏激活, 实际计算量(37B)远低于两者. 61 层的深度设计使得模型具有较大的感受野, 但每层的计算量相对较小.

### 4.2 参数分布分析

DeepSeek-V3 的 671B 总参数主要分布在以下模块:

| 模块 | 参数量估算 | 占比 | 说明 |
|:---|:---|:---|:---|
| 嵌入层 | 128K × 7168 ≈ 0.9B | 0.13% | 词表 × 隐藏维度 |
| 注意力层(61层) | ≈ 40B | 6.0% | 包含 MLA 投影矩阵 |
| 共享专家(61层) | ≈ 15B | 2.2% | 每层 1 个专家 |
| 路由专家(61层) | ≈ 590B | 87.9% | 每层 256 个专家 |
| 输出头 | 7168 × 128K ≈ 0.9B | 0.13% | 共享嵌入 |
| 其他(RMSNorm 等) | ≈ 24B | 3.6% | 可忽略 |
| **总计** | **≈ 671B** | **100%** | |

87.9% 的参数集中在路由专家上, 但这些参数中只有 3.5% 在每次前向传播中被激活. 这是 MoE 架构的核心特征: 巨大的参数容量(知识存储)与可控的计算成本(推理开销).

### 4.3 计算-通信比分析

在 DeepSeek-V3 的训练中, 跨节点专家并行引入的 all-to-all 通信开销与计算开销之比约为 1:1. 这意味着如果没有通信优化, 50% 的时间会被通信消耗.

DualPipe 通过双向流水线和计算-通信重叠, 将实际通信开销降低到接近零. 这要求:

1. 计算单元粒度足够小, 能够填充通信间隙
2. 通信内核与计算内核在独立的 SM 上并行执行
3. IB 和 NVLink 的带宽被充分利用

在 H800 集群上, 仅需 20 个 SM(约 15%)用于通信, 剩余 112 个 SM 用于计算. 这与 DeepSeek 对硬件设计建议中提出的「将通信任务卸载到专用协处理器」形成呼应: 如果未来 GPU 集成了通信协处理器, 这 20 个 SM 可以全部用于计算, 训练效率还能再提升约 15%.

---

## 5 架构谱系定位

### 5.1 技术继承关系

| 组件 | 直接继承自 | 核心创新 | 被后续工作引用 |
|:---|:---|:---|:---|
| MLA | DeepSeek-V2 (2024) | 低秩联合压缩 + 解耦 RoPE | Qwen3, GLM-5, MiniMax-M2, Kimi-K2 |
| DeepSeekMoE | DeepSeek-V2 (2024) | 细粒度专家(256个) + 共享专家隔离 | 几乎成为 2024-2025 MoE 标准 |
| Aux-Loss-Free | Wang et al. (2024a) | 偏置动态调整, 无梯度干扰 | 被广泛采用于 MoE 训练 |
| MTP | Meta (2024) | 顺序预测保持因果链, 共享嵌入/输出头 | 后续投机解码工作 |
| FP8 Training | 业界探索(2023) | 细粒度量化 + CUDA Core 累加 | 影响 Blackwell 架构设计 |
| DualPipe | ZeroBubble (2023) + Chimera | 双向调度 + 双向流水线 | DeepSeek-V4, 业界广泛借鉴 |

### 5.2 在算法家族树中的位置

DeepSeek-V3 的架构可以被视为 2024 年开源模型工程优化的集大成者:

```
Transformer (2017)
  |
  +--> 注意力压缩路线:
  |      MHA → MQA → GQA → MLA (DeepSeek-V2/3, 2024)
  |
  +--> MoE 路线:
  |      GShard → Switch Transformer → DeepSeekMoE (2024)
  |      (粗粒度专家)   (细粒度 + 共享专家)
  |
  +--> 训练效率路线:
  |      FP16 → BF16 → FP8 (DeepSeek-V3, 2024)
  |      (细粒度量化 + CUDA Core 累加)
  |
  +--> 流水线并行路线:
         GPipe → PipeDream → ZeroBubble → DualPipe (DeepSeek-V3, 2024)
```

DeepSeek-V3 的独特贡献不在于发明了全新的架构组件, 而在于将这些组件以最优的方式组合在一起, 并在 671B 规模上验证了其可行性和经济性. 从后续影响看, DeepSeek-V3 的 MLA + DeepSeekMoE + FP8 + DualPipe 组合几乎成为 2025-2026 年开源 MoE 模型的标准配置.

---

## 6 局限性与工程权衡

### 6.1 部署门槛

DeepSeek-V3 的推荐部署单元较大: prefilling 阶段最小 32 块 GPU, decoding 阶段最小 320 块 GPU. 这意味着小型团队或个人开发者无法在单卡或单机环境下部署完整模型. 虽然社区通过量化(INT4/INT8)和 offloading 技术降低了部署门槛, 但这些方案都会牺牲推理速度.

### 6.2 专家并行通信依赖

DualPipe 的通信优化严重依赖 InfiniBand 和 NVLink 的高速互连. 在缺乏高速互联的环境中(如公有云上的分散 GPU 实例), all-to-all 通信的开销无法被完全隐藏, MoE 的推理效率会显著下降. 这意味着 DeepSeek-V3 的最优部署场景是拥有自有 GPU 集群的大型企业, 而非按需使用公有云的中小团队.

### 6.3 静态路由 vs 动态路由

DeepSeek-V3 在训练期间使用固定的路由网络(虽然偏置 $b_i$ 动态调整, 但路由网络本身的权重是静态的). 这意味着模型无法根据输入的实时特性自适应地创建或重组专家. 动态路由(如根据输入动态调整专家数量或专家结构)是未来 MoE 架构的一个潜在改进方向.

---

## 7 关键实验数据汇总

| 指标 | DeepSeek-V3 | Llama-3.1 405B | Qwen2.5 72B | 说明 |
|:---|:---|:---|:---|:---|
| 总参数 | 671B | 405B | 72B | MoE 稀疏架构 |
| 激活参数 | 37B | 405B | 72B | 仅 5.5% 参数参与计算 |
| KV Cache(128K, BF16) | ~144 MB | ~8.2 GB | ~2.0 GB | MLA 压缩约 57 倍 |
| 预训练成本 | 2664K H800 GPUh | ~5800 万美元 | - | 仅 557.6 万美元 |
| 每万亿 token 成本 | 180K H800 GPUh | - | - | 约 36 万美元 |
| 训练稳定性 | 零损失尖峰, 零回滚 | 行业常见多次回滚 | - | 工程优化成果 |
| MATH-500(基础模型) | 61.6 | 49.0 | 54.4 | 基础模型已很强 |
| MATH-500(后训练) | 90.2 | 73.8 | 80.0 | R1 蒸馏效果 |
| Codeforces 百分位 | 51.6 | 25.3 | 24.8 | 首次突破 50% |
| HumanEval(Pass@1) | 65.2 | 54.9 | 53.0 | 代码能力领先 |
| MMLU(EM) | 88.5 | 88.6 | 85.3 | 知识能力持平 |

---

## 附录 A: 核心公式索引

| 编号 | 公式 | 所在章节 | 说明 |
|:---|:---|:---|:---|
| (1) | $\mathbf{c}_t^{KV} = W^{DKV} \mathbf{h}_t$ | 2.1.1 | KV 联合压缩下投影 |
| (2) | $\mathbf{k}_t^C = W^{UK} \mathbf{c}_t^{KV}$ | 2.1.1 | Key 上投影恢复 |
| (3) | $\mathbf{k}_t^R = \operatorname{RoPE}(W^{KR} \mathbf{h}_t)$ | 2.1.1 | 解耦 RoPE 键 |
| (10) | $\mathbf{o}_{t,i} = \sum_{j=1}^{t} \text{Softmax}_j(\frac{\mathbf{q}_{t,i}^T \mathbf{k}_{j,i}}{\sqrt{d_h + d_h^R}}) \mathbf{v}_{j,i}^C$ | 2.1.1 | MLA 注意力输出 |
| (12) | $\mathbf{h}_t^{\prime} = \mathbf{u}_t + \sum_{i=1}^{N_s} \text{FFN}_i^{(s)}(\mathbf{u}_t) + \sum_{i=1}^{N_r} g_{i,t} \text{FFN}_i^{(r)}(\mathbf{u}_t)$ | 2.1.2 | DeepSeekMoE FFN 输出 |
| (16) | $g_{i,t}^{\prime} = \mathbb{1}[s_{i,t} + b_i \in \text{Top-K}]$ | 2.1.2 | Auxiliary-Loss-Free 路由 |
| (21) | $\mathbf{h}_i^{\prime k} = M_k[\text{RMSNorm}(\mathbf{h}_i^{k-1}); \text{RMSNorm}(\text{Emb}(t_{i+k}))]$ | 2.2 | MTP 模块输入组合 |
| (25) | $\mathcal{L}_{\text{MTP}} = \frac{\lambda}{D} \sum_{k=1}^{D} \mathcal{L}_{\text{MTP}}^k$ | 2.2 | MTP 总损失 |

---

> 本文档为架构总览, 详细精译见《01-DeepSeek-V3技术报告精译.md》, 工程落地细节见《05-DeepSeek-V3-Training-System.md》.
