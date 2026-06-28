---
title: "05 · Qwen2 核心架构剖析"
---

# Qwen2 核心架构剖析

>  **[返回 14.2-Qwen 家族总览](../../14.2-Qwen.md)**


> 本文聚焦 Qwen2 的四大架构选择 —— GQA、DCA+YARN 长上下文方案、MoE 细粒度专家设计与 RoPE 基频扩展 —— 的工程动机、数学原理与技术谱系定位.

---

## 1 Grouped Query Attention 的 KV Cache 压缩

### 1.1 从 MHA 到 GQA 的演进

标准多头注意力(MHA)中, 每个查询头(query head)对应独立的键头(key head)与值头(value head). 设层数为 $l$, 头数为 $n_h$, 每个头的维度为 $d_h$, 则每 token 的 KV Cache 大小为:

$$
 \text{KV Cache}_{\text{MHA}} = 2 \times n_h \times d_h \times l
$$

以 Qwen2-72B 的配置($n_h=64, d_h=128, l=80$)为例:

$$
 \text{KV Cache}_{\text{MHA}} = 2 \times 64 \times 128 \times 80 = 1{,}310{,}720 \text{ 元素/token}
$$

Grouped Query Attention(GQA)将多个查询头共享同一组 KV 头. Qwen2-72B 采用 8 个 KV 头(表 1), 即每 8 个查询头共享 1 个键头和 1 个值头:

$$
 \text{KV Cache}_{\text{GQA}} = 2 \times n_{\text{kv}} \times d_h \times l = 2 \times 8 \times 128 \times 80 = 163{,}840 \text{ 元素/token}
$$

压缩比:

$$
 \text{压缩比} = \frac{1{,}310{,}720}{163{,}840} = 8 \times
$$

对于 Qwen2-7B($n_h=28, n_{\text{kv}}=4, l=28$):

$$
 \text{KV Cache}_{\text{MHA}} = 2 \times 28 \times 128 \times 28 = 200{,}704 \quad \text{vs} \quad \text{KV Cache}_{\text{GQA}} = 2 \times 4 \times 128 \times 28 = 28{,}672
$$

同样实现 8 倍压缩. 这正是论文所称「Qwen2 模型的每 token KV 尺寸相较于 Qwen1.5 模型显著降低」的量化依据.

### 1.2 GQA 与 MQA 的权衡

Multi-Query Attention(MQA)是 GQA 的极端形式 —— 所有查询头共享单一的 KV 头, 压缩比达到 $n_h$ 倍, 但可能导致表征能力显著下降. GQA 可视为 MHA 与 MQA 之间的连续谱:

- **MHA**: $n_{\text{kv}} = n_h$, 无压缩, 性能上限最高
- **GQA**: $1 < n_{\text{kv}} < n_h$, 可调压缩比, 平衡性能与内存
- **MQA**: $n_{\text{kv}} = 1$, 最大压缩, 性能损失风险最高

Qwen2 的选择($n_{\text{kv}} = n_h / 8$)与 Llama-3-70B($n_h=64, n_{\text{kv}}=8$)一致, 表明业界在 70B 级别模型上已收敛到「8:1 的查询-KV 头比」作为经验最优解. 较小模型如 Qwen2-7B($28 \to 4$, 即 7:1)和 Qwen2-1.5B($12 \to 2$, 即 6:1)采用略低的比值, 可能是因为小模型的头数本身较少, 过度压缩会损害表征多样性.

> **技术思考 1.1 | 设计动机**: GQA 的核心价值不在于训练阶段(训练时所有头的 KV 都需计算), 而在于**推理阶段的内存瓶颈缓解**. 在 long-context 场景中, KV Cache 往往占 GPU 显存的大头. 以 batch_size=1、seq_len=128K 为例, Qwen2-72B 的 GQA KV Cache 仅需约 256MB(FP16), 而 MHA 需约 2GB. 这一 8 倍压缩直接决定了模型能否在单卡/双卡上处理长上下文. GQA 的代价是注意力矩阵的秩降低 —— 从 $n_h$ 个独立的注意力模式降至 $n_{\text{kv}}$ 个, 但实践表明在 $n_h/n_{\text{kv}} \leq 8$ 时性能损失可忽略.

---

## 2 Dual Chunk Attention + YARN 的长上下文方案

### 2.1 问题设定: RoPE 的外推困境

RoPE(Rotary Positional Embedding)将位置信息编码为旋转矩阵:

$$
 \text{RoPE}(\mathbf{x}, m) = \mathbf{x} \odot e^{i m \theta_j}
$$

其中 $m$ 为位置索引, $\theta_j = b^{-2j/d}$ 为旋转基频, $b$ 为基频常数(传统为 10,000). 当序列长度超过预训练时的最大长度 $L_{\text{train}}$ 时, 外推性能急剧下降, 原因在于高频分量的旋转角度过大导致注意力分布紊乱.

Qwen2 的预训练最大长度为 32,768, 但目标是支持 131,072. 这需要同时解决两个问题:
1. **长度扩展**: 从 32K 到 128K 的有效扩展
2. **细粒度定位**: 在长序列中精确定位关键信息

### 2.2 YARN: 注意力温度缩放

YARN(Yet another RoPE extensioN method, Peng et al., 2023)通过缩放注意力温度来修正外推时的注意力分布. 核心思想是: 当序列长度从 $L_{\text{train}}$ 扩展到 $L_{\text{test}}$ 时, 注意力 logit 被缩放因子 $s$ 调节:

$$
 s = \frac{L_{\text{train}}}{L_{\text{test}}} \cdot \frac{1}{t}
$$

其中 $t$ 为附加的温度超参数. YARN 还微调了 RoPE 的频率(将部分高频分量的基频缩小), 以减少长距离上的旋转角度跳跃.

Qwen2 将 RoPE 基频从 10,000 提升至 1,000,000, 这是 YARN 建议的「NTK-aware」扩展策略: 更大的基频使旋转角度随位置的衰减速率更慢, 从而在长距离上保持更平缓的变化曲线.

### 2.3 DCA: 块间相对位置编码

Dual Chunk Attention(DCA, An et al., 2024)将长序列分割为固定长度的块(chunk), 每个块内部使用标准注意力, 块间使用特殊的相对位置编码.

设块大小为 $C$, 序列位置 $m$ 可分解为:

$$
 m = m_{\text{chunk}} \cdot C + m_{\text{offset}}
$$

DCA 的关键设计在于:
- **块内(intra-chunk)**: 标准 RoPE, 位置差 $\Delta m < C$, 计算精确
- **块间(inter-chunk)**: 修正的相对位置编码, 捕获跨块 token 之间的关系

DCA 的理论保证是: 若输入可在单个块内处理, DCA 产生与原始注意力**完全相同**的结果. 只有在跨块时才激活近似机制. 这种「精确-近似」的分层策略使 DCA 兼具短程精度与长程扩展性.

### 2.4 YARN + DCA 的协同效应

单独使用 YARN 可将上下文扩展到约 64K-128K, 但长程精度下降明显. 单独使用 DCA 可处理任意长度, 但块间近似引入误差. Qwen2 将两者结合:

- **YARN 负责「扩展」**: 通过温度缩放与基频调整, 使 32K 预训练模型在 128K 上保持可用注意力分布
- **DCA 负责「定位」**: 通过块分割, 在 128K 中实现细粒度的信息检索(如 Needle in a Haystack 中的精确事实定位)

实测数据(表 11)验证了这一组合的有效性: Qwen2-72B-Instruct 在 NeedleBench 128K 上, 仅用 YARN 时从 32K 的 92.0 骤降至 73.1, 加入 DCA 后回升至 90.3; LV-Eval 128K 上从 31.8 提升至 48.8.

> **技术思考 2.1 | 局限性**: DCA 的块大小 $C$ 是一个关键超参数, 但 Qwen2 技术报告未披露具体取值. 块过大则失去分割意义, 块过小则块间注意力开销增加. 此外, DCA 的块间编码公式相对复杂, 在某些推理框架(如 vLLM、TensorRT-LLM)中的高效实现仍具挑战. 与 Llama-3.1 的「预训练直扩 128K」相比, Qwen2 的 YARN+DCA 方案在**实现成本**上占优(无需重训到 128K), 但在**理论保证**上略逊(依赖近似机制).

---

## 3 MoE 细粒度专家设计

### 3.1 从稠密到 MoE 的迁移公式

Qwen2 MoE(57B-A14B)由 Qwen2-7B 稠密模型上采样而来. 设稠密模型的 FFN 中间维度为 $h_{\text{FFN}} = 18{,}944$(表 1), MoE 的专家中间维度为 $h_{\text{E}} = 2{,}560$, 专家总数 $n = 64$(路由专家) + 8(共享专家) = 72, 每次激活 8 个路由专家 + 8 个共享专家.

上采样(upcycling)的复制次数为:

$$
 \text{副本数} = \left\lceil \frac{n_{\text{routed}} \times h_{\text{E}}}{h_{\text{FFN}}} \right\rceil = \left\lceil \frac{64 \times 2{,}560}{18{,}944} \right\rceil = \left\lceil 8.65 \right\rceil = 9
$$

即每个原始 FFN 被复制 9 次, 然后沿中间维度 shuffle, 从中提取 64 个细粒度专家, 每个专家 50% 参数随机重初始化.

### 3.2 细粒度专家的优势量化

传统 MoE(如 Mixtral 8x7B)采用「粗粒度」专家: 8 个专家, 每个专家参数量等于原始 FFN, 激活 2 个. 细粒度专家(如 Qwen2 MoE)采用「细粒度」专家: 64 个专家, 每个专家参数量仅为原始 FFN 的 $2{,}560 / 18{,}944 \approx 13.5\%$, 激活 8 个.

在总专家参数量与激活参数量相等的前提下, 细粒度专家的理论优势在于组合空间的大小:

- **Mixtral 8x7B**: 组合空间 $C(8, 2) = 28$
- **Qwen2 MoE**: 组合空间 $C(64, 8) \approx 4.4 \times 10^9$

这意味着细粒度专家可以表达远更丰富的功能组合. 实践中, 这种丰富性转化为更灵活的路由决策与更平滑的专家负载分布.

### 3.3 共享专家 vs 纯路由专家

Qwen2 MoE 将 72 个专家分为两类:
- **8 个共享专家(shared experts)**: 所有 token 强制激活, 负责学习通用特征
- **64 个路由专家(routed experts)**: 由门控网络动态选择, 每次激活 8 个, 负责学习任务专用特征

共享专家的引入解决了纯路由 MoE 的两个问题:
1. **负载不均衡**: 部分专家可能被过度使用, 其他专家几乎闲置. 共享专家固定承担通用负载, 减轻路由压力
2. **知识遗忘**: 路由专家频繁切换可能导致通用知识存储不稳定. 共享专家作为「知识锚点」保持稳定性

共享专家的参数量占比为 $8 / 72 \approx 11.1\%$, 与 DeepSeek-V2 的 shared expert 设计(1 个共享专家 + 63 个路由专家)思路一致, 但比例更高. 这反映了 Qwen2 对「通用知识稳定性」的偏好.

> **技术思考 3.1 | 架构细节**: Qwen2 MoE 的 upcycling 初始化策略包含三个步骤 —— **复制**、**shuffle**、**50% 重初始化** —— 每一步都有明确的工程意图. 复制确保专家初始化不偏离已学到的稠密表征太远; shuffle 打破副本间的对称性, 防止所有专家收敛到相同功能; 50% 重初始化引入额外探索空间, 补偿细粒度专家可能因规模过小而导致的表征不足. 这一策略与 DeepSeek-V2 的「随机初始化 + 负载均衡辅助损失」形成对比: Qwen2 依赖初始化多样性来促进专家分化, DeepSeek-V2 则依赖训练时的负载均衡约束. 两种路径在最终效果上趋同, 但 Qwen2 的方案更轻量(无需辅助损失的超参调优).

> **技术思考 3.2 | 局限性**: Qwen2 MoE 仅训练 4.5T token, 远低于稠密模型的 7T. 论文承认这在知识理解方面造成性能短板. 从 scaling law 的角度, MoE 的「有效训练量」不应只看总 token 数, 而应按激活参数量折算: 57B-A14B 的等效稠密训练量为 $4.5T \times (14B / 57B) \approx 1.1T$「57B 等效 token」, 而 72B 稠密模型训练了 7T. 这一巨大差距解释了为何 MoE 在知识密集型任务(MMLU: 76.5 vs 84.2)上落后. 这也为后续 Qwen2.5 的 MoE 版本提供了明确优化方向: 增加预训练 token 或增大激活比例.

---

## 4 RoPE 基频扩展的数学分析

### 4.1 基频对长度外推的影响

RoPE 的旋转角度为:

$$
 \theta_j = b^{-2j/d}
$$

其中 $b$ 为基频(base frequency), $d$ 为 head dimension, $j$ 为维度索引. 对于长序列位置 $m$, 旋转矩阵为:

$$
 \text{RoPE}(\mathbf{x}, m)_j = x_j \cdot e^{i m \theta_j} = x_j \cdot \cos(m \theta_j) + i x_j \cdot \sin(m \theta_j)
$$

当 $m$ 很大时, $\cos(m \theta_j)$ 与 $\sin(m \theta_j)$ 在高低频维度上的表现截然不同:
- **低频维度**($j$ 小, $\theta_j$ 大): 周期短, 大 $m$ 导致高频震荡, 注意力分布紊乱
- **高频维度**($j$ 大, $\theta_j$ 小): 周期长, 大 $m$ 仍保持平缓变化

Qwen2 将基频从 10,000 提升至 1,000,000, 使所有维度的旋转角度按因子 $\log(10^6) / \log(10^4) = 1.5$ 重新分布. 具体而言, 对于同一位置 $m$ 和维度 $j$:

$$
 \frac{\theta_j^{\text{new}}}{\theta_j^{\text{old}}} = \left(\frac{10^6}{10^4}\right)^{-2j/d} = 100^{-2j/d}
$$

当 $j/d$ 较小时(低频端), 比值接近 1; 当 $j/d$ 较大时(高频端), 比值显著缩小. 这意味着基频提升主要**压缩了高频维度的旋转速率**, 使其在长距离上保持更稳定的注意力权重.

### 4.2 基频扩展与预训练长度的耦合

基频扩展并非独立的「魔术开关」—— 它必须与预训练时的最大长度协同设计. Qwen2 在预训练最后阶段将长度扩展到 32K, 同时配合基频提升至 1M. 这一耦合确保模型在 32K 范围内「见过」修正后的旋转角度分布, 从而在外推到 128K 时具备统计基础.

若仅在推理时提升基频而不在预训练中适配, 模型将面临分布偏移: 预训练时学到的注意力模式基于 $b=10{,}000$, 而推理时突然切换到 $b=1{,}000{,}000$, 导致注意力权重重新校准失败.

> **技术思考 4.1 | 技术谱系**: RoPE 基频调整策略可追溯到 "NTK-by-parts" 与 "YaRN" 系列工作. Qwen2 的选择($b=10^6$)与 Llama-3 系列($b=500{,}000$)处于同一数量级, 但 Qwen2 更激进. 这种激进性的合理性在于: Qwen2 的预训练长度(32K)短于 Llama-3.1(128K), 需要更强的外推补偿. 基频选择本质上是一个「预训练长度 - 目标长度 - 基频」的三元权衡: 预训练越长, 基频可越保守; 目标越长, 基频需越激进. Qwen2 的 $(32K, 128K, 10^6)$ 组合与 Llama-3.1 的 $(128K, 128K, 5 \times 10^5)$ 组合验证了这一定律.

---

## 5 架构选择的技术谱系总结

| 技术组件 | Qwen2 选择 | 直接来源 | 与竞品对比 |
|:---|:---|:---|:---|
| 注意力机制 | GQA ($n_h : n_{\text{kv}} = 8:1$) | Ainslie et al., 2023 | 与 Llama-3 一致, 优于 Mistral(MQA) |
| 激活函数 | SwiGLU | Shazeer, 2020 | 与 Llama/Gemma/DeepSeek 一致 |
| 位置编码 | RoPE + 基频 1M + YARN | Su et al., 2021; Peng et al., 2023 | 比 Llama-3 更激进, 需配合 DCA |
| 长上下文 | DCA + YARN | An et al., 2024; Peng et al., 2023 | 成本低于预训练直扩, 精度略逊 |
| 归一化 | RMSNorm + Pre-Norm | Zhang & Sennrich, 2019 | 行业标准 |
| MoE 专家粒度 | 64 路由 + 8 共享, 细粒度 | DeepSeek-MoE(Dai et al., 2024) | 比 Mixtral 更细, 比 DeepSeek-V2 更粗 |
| MoE 初始化 | Upcycling + Shuffle + 50% 重初始化 | Komatsuzaki et al., 2023 | 独特组合, 轻量高效 |

Qwen2 的架构哲学是「**成熟技术的系统性集成**」而非「单一突破性创新」. 每个组件(GQA、SwiGLU、RoPE、RMSNorm)都是经社区验证的最佳实践, Qwen2 的贡献在于:(1) 将它们覆盖到从 0.5B 到 72B 的全尺寸矩阵;(2) 通过 DCA+YARN 解决长上下文问题;(3) 通过细粒度 MoE 探索效率边界. 这种「稳健集成」策略与 DeepSeek-V2/V3 的「激进重构」(MLA、DualPipe、FP8)形成鲜明对比, 各有其适用场景: 前者适合快速产品化与生态建设, 后者适合追求极致效率的前沿探索.
