---
title: "05 · Llama-4架构迭代剖析"
---

# Llama 4 架构迭代与原生多模态设计剖析

>  **[返回 14.3-LLaMA 家族总览](../../14.3-LLaMA.md)**


> 信息来源: Meta 官方 Model Card、GitHub 开源代码(llama-models)、Meta AI 博客、arXiv:2601.11659(已撤回). Llama 4 暂未发布正式 arXiv 技术报告,本文基于官方已公开的技术细节与开源代码进行系统性架构剖析.
> 发布时间: 2025年4月

---

## 1. 设计动机: 为什么 Llama 4 选择了 MoE + 原生多模态

Llama 1~3 三代模型均基于 Dense Transformer 架构,这一选择在开源社区建立了 Llama 作为「可靠 Dense 基线」的声誉. 但 Llama 4 做出了两个根本性转向:全面采用 MoE(Mixture-of-Experts)架构,以及从纯文本扩展到原生多模态.

这一转向的驱动因素可以概括为三点:

| 动机 | Llama 3 的局限 | Llama 4 的解决方案 |
|------|--------------|------------------|
| 计算效率 | 405B Dense 模型推理成本极高,即使 FP8 量化也需要多台服务器 | MoE 17B 激活参数,以 Dense 17B 的计算成本获得 109B~400B 的模型容量 |
| 多模态能力 | Llama 3 为纯文本模型,视觉能力依赖后期添加的适配器 | Early Fusion 设计,预训练阶段即将视觉与文本 token 融合到统一主干 |
| 上下文长度 | Llama 3 最大 128K,难以支撑代码库级理解或整书翻译 | Scout 支持 10M token,通过 iRoPE 和注意力温度调节实现 |

这里需要停下来想一下. Meta 在 Llama 3 405B 上投入了大量资源——约 21M H100 GPU 小时的训练成本——但推理阶段的显存和计算需求使得 405B Dense 模型对绝大多数开发者而言「看得懂、用不起」. MoE 架构用「小激活、大容量」的思路解决了这一矛盾:每个 token 只激活约 4% 的总参数(17B/400B),但模型仍能利用全部 400B 参数中存储的知识. 这本质上是在 Transformer 的 FFN 层引入了条件计算(conditional computation),让不同 token 动态选择最匹配的计算路径.

不过,Meta 选择 MoE 的时机值得关注. DeepSeek-V2(2024.05)、Qwen3(2025.01)等模型已经验证了 MoE 在开源领域的可行性,Llama 4 的 MoE 转向更像是「跟随验证后的主流」而非「开创性探索」. 真正的差异化在于 Meta 将 MoE 与原生多模态、超长上下文捆绑发布,形成了一套完整的开源模型解决方案.

---

## 2. 架构演进: 从 Llama 3 Dense 到 Llama 4 MoE

### 2.1 参数规模与计算效率的重新平衡

Llama 4 包含三个模型变体,但只有 Scout 和 Maverick 已公开发布:

| 模型 | 总参数量 | 激活参数量 | 激活比例 | 专家数 | Top-K | 上下文长度 | 预训练 Token |
|------|---------|-----------|---------|--------|-------|-----------|-------------|
| Scout | 109B | 17B | 15.6% | 16 | 1 | 10M | ~40T |
| Maverick | 400B | 17B | 4.25% | 128 | 1 | 1M | ~22T |
| Behemoth(preview) | ~2T | 288B | ~14.4% | 16 | 1 | - | 训练中 |

一个值得注意的设计选择是:Scout 和 Maverick 的激活参数量相同(17B),但总参数量和专家数差异巨大. 这意味着两个模型的单次前向传播计算量(FLOPs)大致相当,但 Maverick 拥有更大的知识容量(400B vs 109B)和更细粒度的专家分工(128 vs 16).

这里的设计权衡非常清晰:在固定推理预算(17B 激活)下,通过调整专家数量和总参数量,可以在「知识广度」(Maverick 的 400B)和「长上下文能力」(Scout 的 10M)之间做产品级区分. Scout 选择更少的专家(16 个)和更多的训练数据(40T),可能意味着其路由网络更简单、训练更稳定,从而可以将更多计算预算分配给上下文扩展;Maverick 选择更多的专家(128 个)和较少的训练数据(22T),追求在固定推理成本下最大化模型容量.

### 2.2 交替 Dense/MoE 层: 一种务实的稀疏化策略

与 DeepSeek-V3(每层都是 MoE)或 Mixtral(每隔一层 MoE)不同,Llama 4 采用了更细粒度的交替策略——`interleave_moe_layer_step=1`,即严格地每隔一层设置一个 MoE 层:

```
Layer 1: Dense FFN
Layer 2: MoE (Router + Shared Expert + 1 Routed Expert)
Layer 3: Dense FFN
Layer 4: MoE
...
```

这种设计的工程考量是:

- **Dense 层保持全局模式捕获**: 全连接的 FFN 层在每个位置应用相同的变换,有利于学习跨位置的全局语言和视觉模式
- **MoE 层实现专业化分工**: 稀疏层让不同 token 路由到不同的专家,学习多样化的子空间表示
- **交替设计降低通信开销**: 相比每层都是 MoE,交替设计减少了分布式部署时的 all-to-all 通信频率

从 GitHub 源码 `args.py` 中提取的关键 MoE 超参数:

| 参数 | Scout | Maverick | 说明 |
|------|-------|----------|------|
| num_experts | 16 | 128 | 每层专家总数 |
| top_k | 1 | 1 | 每个 token 激活的路由专家数 |
| capacity_factor | 1.0 | 1.0 | 专家容量上限系数 |
| auto_scale_F | True | True | 自动调整 hidden_dim 以匹配 Dense 等效计算量 |
| interleave_moe_layer_step | 1 | 1 | 每隔一层设置 MoE |

**Top-K=1 的极端稀疏性**是一个值得深入分析的选择. 大多数 MoE 模型使用 top_k=2(Mixtral)或更高(DeepSeek-V3 使用 top_k=6+1 shared). Llama 4 选择 top_k=1 意味着:

- **推理时 KV Cache 最小化**: 每个 token 只需存储 1 个 routed expert + 1 个 shared expert 的 KV,而非多个专家的并集
- **路由决策容错率低**: 如果路由器选错了专家,没有第二个专家可以补偿,对路由器的准确性要求更高
- **与共享专家互补**: `shared expert` 始终激活,提供基础的全局计算能力,top_k=1 的 routed expert 则提供专业化补充

### 2.3 共享专家的设计逻辑

Llama 4 的每个 MoE 层包含两类专家:

- **Shared Expert**: 始终激活,负责提供全局性的基础变换
- **Routed Expert**: 由路由器动态选择(Top-1),负责专业化处理

这与 DeepSeekMoE 的共享专家设计有相似之处,但 Llama 4 只使用 1 个 shared expert 配合 1 个 routed expert(top_k=1),而 DeepSeek-V3 使用 1 个 shared expert 配合 6 个 routed expert.

共享专家的作用可以从两个角度理解:

1. **稳定性角度**: 始终激活的 shared expert 确保了无论路由决策如何,每层都有稳定的梯度传播路径,防止「死专家」问题
2. **容量角度**: shared expert 可以专注于学习通用的语言和视觉表示,让 routed expert 更专注于特定类型的输入(如代码、数学、多语言等)

---

## 3. 长上下文工程: 从 128K 到 10M 的技术路径

### 3.1 Scaled RoPE: 频率外推的平滑策略

Scout 支持 10M token 上下文,这是通过 Scaled Rotary Position Embedding 实现的. 源码中的关键参数:

- `rope_scaling_factor = 16`
- `rope_high_freq_factor = 1`
- `rope_theta = 500000`
- `use_scaled_rope = True`(仅 Scout)

Scaled RoPE 的核心思想是对 RoPE 的频率进行平滑插值:对高频分量(短波长,对应局部位置关系)不做处理,对低频分量(长波长,对应全局位置关系)按 scale_factor 压缩,中间频率区域做线性过渡.

数学上,给定原始频率 $freq$ 和波长 $wavelength = 2\pi / freq$,缩放后的新频率为:

$$
freq' = \begin{cases}
freq & \text{if } wavelength < high\_freq\_wavelength \\
freq / scale\_factor & \text{if } wavelength > low\_freq\_wavelength \\
(1 - smooth) \cdot freq / scale\_factor + smooth \cdot freq & \text{otherwise}
\end{cases}
$$

其中 $smooth = (old\_context\_len / wavelength - low\_freq\_factor) / (high\_freq\_factor - low\_freq\_factor)$.

这里需要停下来想一下. 传统的位置编码外推方法(如直接插值或 NTK-aware 缩放)通常对所有频率做统一处理,但 Scaled RoPE 的「选择性缩放」策略更具物理直觉:短距离依赖(高频)在人类语言和视觉中始终重要,不应被压缩;长距离依赖(低频)才是外推时需要调整的. 这种「保近压远」的策略与 YaRN 类似,但 Llama 4 将其与 NOPE 层和注意力温度调节结合,形成了更完整的长上下文解决方案.

### 3.2 NOPE 层: 去除位置编码的注意力层

源码中出现了 `nope_layer_interval` 参数,表明部分 attention 层不使用位置编码. 这与 DeepSeek-V2/V3 的 MLA 中去除位置编码的设计思路类似.

NOPE(No Position Encoding)层的动机是:在极长序列中,位置编码的累积噪声可能干扰注意力计算. 去除位置编码后,这些层仅依赖内容相似度进行注意力分配,类似于「内容路由」机制. 在 10M token 的尺度上,位置编码的数值稳定性确实是一个需要关注的问题——RoPE 的旋转矩阵在极长距离上可能出现数值漂移.

### 3.3 注意力温度调节: 防止 Softmax 过度锐化

当序列长度增加时,注意力分数的尺度会自然漂移,导致 Softmax 输出过度锐化——少数 token 获得接近 1 的注意力权重,其余接近 0. 这种现象在长序列中尤为明显,因为 query-key 点积的方差随维度增加而增大.

Llama 4 的注意力温度调节机制通过动态调整 attention temperature 来缓解这一问题:

```python
attn_temperature_tuning: bool = False  # 超长上下文时启用
floor_scale: float = 8192.0
attn_scale: float = 0.1
```

具体实现上,注意力分数在 Softmax 前会被一个与序列长度相关的温度因子缩放,防止注意力分布过于集中. 这是支持 10M 上下文稳定运行的关键技术之一,也是对「注意力稀释」问题的直接工程回应.

### 3.4 多阶段上下文扩展训练

Llama 4 的长上下文能力不是一次性训练到 10M 的,而是通过多阶段渐进扩展:

| 阶段 | 上下文长度 | 关键技术 | 目的 |
|------|-----------|---------|------|
| 初始预训练 | 8K~128K | 标准 RoPE | 建立基础语言和多模态能力 |
| Mid-training | 128K~1M | 长序列数据 + Scaled RoPE | 扩展上下文处理能力 |
| 超长上下文激活 | 1M → 10M | iRoPE + NOPE + 注意力温度调节 | 实现 10M 稳定运行 |
| 后训练 | 保持 | SFT + RL + DPO | 指令对齐和行为优化 |

Scout 的 `rope_scaling_factor=16` 和基础长度 8192 意味着理论外推长度约为 $8192 \times 16 = 131072$. 但实际支持 10M 说明还结合了 NOPE 层、注意力温度调节以及可能的循环或压缩机制. 10M 的 KV Cache 在 BF16 下即使对 17B 激活模型也需要数百 GB 显存,这意味着 10M 上下文的实际部署需要显存优化技术(如 KV Cache 压缩、分页注意力等)的配合.

---

## 4. 原生多模态: Early Fusion 的架构含义

### 4.1 从 Late Fusion 到 Early Fusion 的范式转移

传统多模态模型(如 LLaVA 系列)采用 Late Fusion 设计:先分别用独立的视觉Encoder 和文本Encoder 处理输入,再通过 projector(如 MLP 或 Q-Former)对齐后输入 LLM. 这种设计的优势是模块化和灵活性——可以单独更新视觉或语言模块——但存在信息瓶颈:视觉信息在被压缩为少量 query token 时可能丢失细节.

Llama 4 采用 Early Fusion 设计:在预训练阶段即将图像 patch token 与文本 token 混合到统一的序列中,共享同一个 Transformer 主干和注意力机制. 这种设计的架构含义是:

- **视觉和语言在注意力层面直接交互**: 图像 patch 可以直接 attend 到文本 token,反之亦然,无需通过 projector 间接通信
- **统一的表示空间**: 视觉和语言信息在同一高维空间中编码,理论上可以学习更深度的跨模态关联
- **任意模态组合**: 多图、图文交错、视频帧序列都可以统一处理为「混合模态 token 序列」

### 4.2 Tile-based 图像编码

Llama 4 使用特殊的 token 序列来表示图像输入:

- `<|image_start|>` / `<|image_end|>`: 包裹图像数据
- `<|patch|>`: 图像 patch
- `<|tile_x_separator|>` / `<|tile_y_separator|>`: 分隔不同 tile
- `<|image|>`: 分隔原始尺寸图像与下采样后的单 tile 版本

这种设计表明 Llama 4 采用了 **tile-based 图像编码**:高分辨率图像被切分为多个 tile,每个 tile 编码为一系列 patch token. 这与 Gemini 的「patch 化」策略类似,但 Llama 4 通过 separator token 显式标记 tile 边界,而不是依赖位置编码隐式区分.

从工程角度看,tile-based 编码的优势是:
- **处理任意分辨率**: 不受固定输入尺寸限制
- **局部细节保留**: 高分辨率区域通过更多 tile 覆盖
- **计算效率**: 每个 tile 独立编码,便于并行化

但代价是序列长度随图像分辨率线性增长——一张高分辨率图像可能产生数千个 patch token,对注意力计算的二次复杂度构成挑战.

### 4.3 Early Fusion 的工程代价

Early Fusion 虽然概念上更优雅,但工程复杂度远高于 Late Fusion:

| 维度 | Late Fusion (LLaVA) | Early Fusion (Llama 4) |
|------|-------------------|----------------------|
| 预训练数据 | 文本和图像可以分开预训练 | 必须同时处理文本和图像数据 |
| 数据配比 | 视觉数据比例灵活调整 | 需要精心设计视觉/文本 token 比例 |
| 训练稳定性 | 视觉和语言模块独立优化 | 统一优化,模态间的梯度冲突更复杂 |
| 推理效率 | 视觉编码一次性完成 | 视觉 patch 参与全程注意力计算 |
| 扩展性 | 容易替换视觉Encoder  | 视觉编码与语言主干深度耦合 |

Meta 选择在 Llama 4 上采用 Early Fusion,说明其内部基础设施已能支撑大规模多模态预训练. 但从 benchmark 结果来看,Maverick 的 MMMU 73.4 和 MathVista 73.7 虽然优秀,但与专门的 VLM(如 Qwen2.5-VL、Kimi-VL)相比并不占绝对优势. 这可能说明:原生多模态的优势需要更大规模(如 Behemoth 的 2T 参数)才能充分释放,或者在当前规模下,Late Fusion 配合高质量视觉Encoder 仍然是性价比更高的方案.

---

## 5. 训练策略与规模分析

### 5.1 数据规模与模型规模的非对称设计

Llama 4 的一个反直觉设计是:更小的模型(Scout, 109B 总参)使用了更多的训练数据(40T),而更大的模型(Maverick, 400B 总参)使用了更少的数据(22T).

| 模型 | 总参数量 | 预训练 Token | Token/Param 比率 |
|------|---------|-------------|-----------------|
| Scout | 109B | ~40T | ~367 |
| Maverick | 400B | ~22T | ~55 |
| Llama 3 8B | 8B | ~15T | ~1875 |
| Llama 3 70B | 70B | ~15T | ~214 |
| Llama 3 405B | 405B | ~15T | ~37 |

Chinchilla scaling law 建议的计算最优比率约为 20 token/参数(对大规模模型). Scout 的 367 远超这一比率,说明其训练是「数据过剩」的;Maverick 的 55 也超过了计算最优值. 这种超比例的数据训练通常是为了提升模型的知识覆盖和泛化能力,而非追求计算效率.

可能的原因包括:
- Scout 需要额外的长上下文数据进行 mid-training,这部分数据不计入常规预训练 token 统计
- Maverick 的 128 个专家需要更高质量而非更高数量的数据来训练路由器——低质量数据可能导致路由决策噪声
- Meta 可能使用了数据重复策略,40T 中的部分数据是高质量数据的重复采样

### 5.2 训练能耗与基础设施

| 指标 | Scout | Maverick | 合计 |
|------|-------|----------|------|
| GPU 训练时间 | 5.0M H100 小时 | 2.38M H100 小时 | 7.38M H100 小时 |
| GPU 类型 | H100-80GB | H100-80GB | - |
| 单卡功耗(TDP) | 700W | 700W | - |
| 位置基准碳排放 | 1,354 吨 CO2eq | 645 吨 CO2eq | 1,999 吨 CO2eq |

7.38M H100 GPU 小时的训练规模极为庞大. 作为对比,Llama 3 405B 据报道使用了约 16K H100 训练约 54 天(约 21M GPU 小时). Llama 4 两个模型的总训练量约为 Llama 3 405B 的 35%,但 Scout 和 Maverick 的激活参数仅 17B(对比 405B Dense). 这说明 MoE 架构在训练阶段也具备效率优势——用更少的激活计算量达到了更高的有效容量.

不过需要注意:Scout 的 5.0M H100 小时中,相当比例可能用于长上下文扩展训练(10M 上下文需要专门的长序列数据). 如果剔除这部分,MoE 的训练效率优势可能更为显著.

### 5.3 后训练的「轻量级」转向

与 Llama 3 的 6 轮 RS+SFT+DPO 迭代相比,Llama 4 的后训练流程被描述为更「轻量级」,包含:

1. 轻量级 SFT(Supervised Fine-Tuning)
2. 在线 RL(Reinforcement Learning)
3. 轻量级 DPO(Direct Preference Optimization)

这一转向可能反映了几个趋势:
- **预训练能力的提升**: 随着预训练数据规模和质量的增长,基座模型本身已具备更强的指令遵循能力,减少了对复杂后训练的依赖
- **合成数据的普及**: 使用合成数据替代人类标注,降低了对多轮迭代的依赖
- **计算成本控制**: 后训练阶段的计算开销在大规模模型中不可忽视,「轻量级」后训练可以显著降低总成本

---

## 6. 性能定位: 17B 激活如何碾压 405B Dense

### 6.1 核心推理基准对比

| Benchmark | 指标 | Llama 3.1 405B(Dense) | Scout(MoE, 17B act) | Maverick(MoE, 17B act) |
|-----------|------|----------------------|--------------------|----------------------|
| MMLU | 5-shot | 85.2 | 79.6 | **85.5** |
| MMLU-Pro | 5-shot | 61.6 | 58.2 | **62.9** |
| MATH | 4-shot | 53.5 | 50.3 | **61.2** |
| GPQA Diamond | 0-shot | 49.0 | 57.2 | **69.8** |
| LiveCodeBench | 0-shot | 27.7 | 32.8 | **43.4** |
| MBPP | 3-shot | 74.4 | 67.8 | **77.6** |

Maverick 以仅 17B 激活参数的 MoE 架构,在几乎所有核心推理基准上超越了 405B Dense 的 Llama 3.1. 这一结果对 Dense 架构的 scaling law 提出了直接挑战:当 MoE 可以用 1/24 的激活计算量达到更好的推理性能时,继续扩大 Dense 模型的意义何在?

需要注意两个细节:
1. **训练数据差异**: Llama 4 使用了 22T~40T token,远超 Llama 3 的 15T,部分性能提升可能来自数据规模而非架构本身
2. **后训练优化**: Llama 4 的「轻量级」后训练未必比 Llama 3 的 6 轮迭代弱,可能使用了更高质量的合成数据

### 6.2 多模态能力定位

| Benchmark | Llama 4 Maverick | GPT-4o | Gemini 2.0 Flash |
|-----------|-----------------|--------|-----------------|
| MMMU | **73.4** | 69.1 | 71.7 |
| MathVista | **73.7** | 63.8 | 73.1 |
| DocVQA | **94.4** | 92.8 | - |
| ChartQA | **90.0** | - | - |

Maverick 在视觉推理基准上与 GPT-4o 和 Gemini 2.0 Flash 处于同一梯队,甚至在部分指标上领先. 作为开源模型,这是显著成就. 但如前所述,其与专门 VLM 的差距并不明显,说明 Early Fusion 在当前规模下的优势尚未完全释放.

### 6.3 长上下文能力:MTOB 基准

MTOB(Massively Multilingual Translation of Books)测试整本书的翻译能力,是长上下文模型的专属基准:

| 任务 | Scout(10M ctx) | Maverick(1M ctx) |
|------|---------------|-----------------|
| Half book eng→kgv | 42.2 | **54.0** |
| Half book kgv→eng | 36.6 | **46.4** |
| Full book eng→kgv | 39.7 | **50.8** |
| Full book kgv→eng | 36.3 | **46.7** |

有趣的现象是:Maverick(1M 上下文)在 MTOB 上反而优于 Scout(10M 上下文). 这是因为 Maverick 的 400B 总参数提供了更强的翻译能力,而 MTOB 的「半本书」测试可能尚未触及 1M 上下文的上限. Scout 的 10M 上下文优势可能在更长的输入(如整系列书籍、大型代码库)中才能体现.

---

## 7. 部署策略与量化方案

### 7.1 量化方案与硬件需求

| 模型 | BF16 大小 | 量化方案 | 量化后大小 | 部署要求 |
|------|----------|---------|-----------|---------|
| Scout | ~218GB | Int4(on-the-fly) | ~55GB | **单张 H100 GPU** |
| Maverick | ~800GB | FP8 | ~400GB | **单台 H100 DGX host** |

Scout 的 Int4 量化后可在单张 H100 上运行,这是其作为「开发者友好模型」定位的关键. 相比之下,Llama 3 405B 即使 FP8 量化也需要多台服务器. MoE 的「小激活」特性在部署阶段的优势被充分发挥:KV Cache 大小与激活参数量(17B)成正比,而非总参数量(109B/400B).

不过,on-the-fly Int4 量化虽然方便,但在某些精度敏感任务上可能不如预量化(pre-quantized)模型稳定. 此外,MoE 推理还有额外的路由计算和潜在的 all-to-all 通信开销,这些在 benchmark 中通常不被计入.

### 7.2 推理效率的 trade-off

MoE 推理的效率优势与开销并存:

**优势**:
- 单次前向计算量与激活参数量(17B)成正比
- KV Cache 占用与激活参数量成正比
- 以 Dense 17B 的成本获得远超 17B Dense 的能力

**开销**:
- 路由计算:需要为每个 token 计算专家选择概率
- 通信开销:分布式部署时,不同专家可能位于不同 GPU,需要 all-to-all 通信
- 负载不均衡:某些专家被过度使用可能导致等待时间增加
- 内存带宽:虽然计算量减少,但加载 109B/400B 总参数需要更高的内存带宽

---

## 8. 局限与争议

### 8.1 无正式技术报告

与 Llama 1~3 均发布详细技术报告不同,Llama 4 截至发布时未提供正式论文. arXiv 上出现的第三方总结 "The Llama 4 Herd"(arXiv:2601.11659)后来被撤回. 这让研究社区难以深入理解:

- 训练数据的具体构成和配比
- 数据清洗和去污染策略
- 详细的超参数设置和调优过程
- 消融实验结果

从开放科学的角度看,这是一个退步. Meta 作为开源大模型的领导者,其技术透明度直接影响社区对模型的信任度和复现能力.

### 8.2 Benchmark 争议

发布初期有用户反映 Llama 4 在实际任务中的表现与 benchmark 分数存在差距. Meta GenAI 负责人 Ahmad Al-Dahle 回应称这是由于「实现需要稳定化」. 这一争议提醒我们:

- Benchmark 分数不等于实际用户体验
- 不同实现框架(vLLM、TensorRT-LLM、原生 PyTorch)可能对同一模型产生不同结果
- 量化策略(Int4 vs FP8 vs BF16)对性能的影响在不同任务上差异显著

### 8.3 Behemoth 的「画饼」质疑

作为 2T 参数(288B 激活/16 experts)的「教师模型」,Behemoth 目前仍在训练中,未公开发布. 如果 Behemoth 最终不发布,那么:

- 以 Behemoth 为蒸馏目标的训练策略将无法被社区复现
- Maverick 和 Scout 可能受益于 Behemoth 的知识蒸馏,这部分优势无法被独立验证
- 社区对 Meta 开源承诺的信任可能受损

### 8.4 10M 上下文的实际可用性

Scout 的 10M 上下文窗口在技术上令人印象深刻,但实际部署面临挑战:

- KV Cache 在 BF16 下需要数百 GB 显存,即使 Int4 量化也需要数十 GB
- 10M token 的注意力计算在单次前向传播中耗时极长
- 真实的「大海捞针」式长上下文推理能力尚未被独立第三方充分验证
- 注意力稀释问题:在 10M 尺度上,softmax 后的注意力权重可能极度稀疏,跨距离关联能力可能下降

---

## 9. 模型谱系定位

- **直接继承自**: Llama 3(Dense 架构基础、SwiGLU、RMSNorm、RoPE、GQA)
- **核心创新**:
  - 交替 Dense/MoE 层设计(每隔一层 MoE, Top-1 路由 + 共享专家)
  - 原生多模态 Early Fusion(统一主干处理视觉和文本 token)
  - 10M 上下文窗口(Scaled RoPE + NOPE + 注意力温度调节)
  - 产品级模型分化(Scout 专注长上下文,Maverick 专注推理能力)
- **同期可比模型**:
  - DeepSeek-V3(671B MoE, MLA, MTP)
  - Qwen3(多尺寸 Dense+MoE, Agent 能力)
  - Gemma 3(Google 轻量化多模态)
- **被后续工作影响**:
  - 验证了 MoE 在开源大模型中的主流地位
  - Early Fusion 多模态设计为后续模型提供参考
  - 10M 上下文推动了长上下文技术的工程化竞争

---

*本文档基于 Llama 4 官方 Model Card、GitHub 开源代码(meta-llama/llama-models)、Meta AI 博客及社区公开资料进行架构剖析. 由于 Llama 4 尚未发布正式技术报告,部分细节基于源码反推,可能存在理解偏差.*
