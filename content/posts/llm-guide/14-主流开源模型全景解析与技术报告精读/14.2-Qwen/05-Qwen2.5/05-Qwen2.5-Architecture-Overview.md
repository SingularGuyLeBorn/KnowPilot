---
title: "Qwen2.5 核心架构剖析"
---

# Qwen2.5 核心架构剖析

>  **[返回 14.2-Qwen 家族总览](../../14.2-Qwen.md)**


> 本文聚焦 Qwen2.5 相较 Qwen2 的三项核心进化 —— Scaling Law 驱动的超参预测、GRPO 的组内相对优化机制、以及 Turbo 模型的渐进式百万上下文方案 —— 的数学原理与工程权衡.

---

## 1 Scaling Law 用于超参数预测

### 1.1 从模型尺寸预测到超参预测

传统 Scaling Law(Chinchilla, Kaplan et al.)主要回答: 给定计算预算 $C$, 最优模型参数量 $N_{\text{opt}}$ 与数据量 $D_{\text{opt}}$ 是多少? 其经典形式为:

$$
 L(N, D) = E + \frac{A}{N^\alpha} + \frac{B}{D^\beta}
$$

Qwen2.5 将 Scaling Law 的应用范围从 $(N, D)$ 扩展到 $(N, D, \mu, B)$, 即同时预测最优学习率 $\mu_{\text{opt}}$ 与 batch size $B_{\text{opt}}$. 这一扩展的工程动机是: 不同架构(层数/头数/FFN 比)的模型在同一 $(N, D)$ 下可能有不同的最优超参, 固定超参会导致 sub-optimal 训练.

### 1.2 Proxy 实验设计

Qwen2.5 的 proxy 实验覆盖:
- 稠密模型: 44M → 14B 参数
- MoE 模型: 44M → 1B 激活参数
- 数据量: 0.8B → 600B token

对每个 $(N, D)$ 组合, 在小规模上 grid search 学习率与 batch size, 记录最优 loss. 然后拟合:

$$
 \mu_{\text{opt}} = f_\mu(N, D), \quad B_{\text{opt}} = f_B(N, D)
$$

经验上, 学习率通常随模型尺寸增大而衰减(更大的模型需要更保守的更新步长), batch size 则随模型与数据量增大而增加(更大的 batch 提供更稳定的梯度估计). 典型形式为:

$$
 \mu_{\text{opt}} \propto N^{-0.5}, \quad B_{\text{opt}} \propto N^{0.5} D^{0.5}
$$

> **技术思考 1.1 | 工程权衡**: 超参预测的 proxy 实验需要权衡「搜索空间密度」与「计算成本」. Qwen2.5 选择 44M-14B 的稠密模型作为 proxy, 这意味着 proxy 与目标(72B)之间存在约 5 倍参数差距. 外推的可靠性取决于 scaling law 的「幂律假设」在跨数量级时是否成立. 论文未披露外推误差, 但社区经验表明, 学习率的外推通常比 batch size 更稳健, 因为 batch size 还受硬件内存约束(如 GPU 显存限制最大 batch), 而硬件约束不遵循幂律.

---

## 2 GRPO: 组内相对策略优化

### 2.1 PPO 的 Critic 瓶颈

标准 PPO 在 RLHF 中的目标为:

$$
 \mathcal{L}_{\text{PPO}} = -\mathbb{E} \left[ \min\left( r_t(\theta) \hat{A}_t, \text{clip}(r_t(\theta), 1-\epsilon, 1+\epsilon) \hat{A}_t \right) \right]
$$

其中 $r_t(\theta) = \pi_\theta(a_t|s_t) / \pi_{\text{old}}(a_t|s_t)$ 为重要性采样比, $\hat{A}_t$ 为优势函数估计. 优势函数通常由独立的 critic 网络 $V_\phi(s_t)$ 估计:

$$
 \hat{A}_t = \delta_t + (\gamma\lambda) \delta_{t+1} + \cdots, \quad \delta_t = r_t + \gamma V_\phi(s_{t+1}) - V_\phi(s_t)
$$

Critic 网络的训练增加了约 50% 的显存开销(与策略模型同等规模), 且 critic 本身的估计误差会传播到策略更新中.

### 2.2 GRPO 的组内基线

GRPO(Shao et al., 2024, DeepSeek-Math) 摒弃 critic 网络, 通过「组采样」估计基线. 对每个查询 $q$, 从当前策略采样一组回复 $\{o_1, o_2, ..., o_G\}$(Qwen2.5 中 $G=8$), 用奖励模型打分 $\{r_1, r_2, ..., r_G\}$. 组内均值为基线:

$$
 \text{baseline} = \frac{1}{G} \sum_{i=1}^{G} r_i
$$

每条回复的优势函数为:

$$
 \hat{A}_i = \frac{r_i - \text{baseline}}{\text{std}(\{r_j\})}
$$

分母的标准差归一化确保不同查询的优势值处于可比尺度. GRPO 的损失函数为:

$$
 \mathcal{L}_{\text{GRPO}} = -\frac{1}{G} \sum_{i=1}^{G} \left[ \min\left( \frac{\pi_\theta(o_i|q)}{\pi_{\text{old}}(o_i|q)} \hat{A}_i, \text{clip}\left(\frac{\pi_\theta(o_i|q)}{\pi_{\text{old}}(o_i|q)}, 1-\epsilon, 1+\epsilon\right) \hat{A}_i \right) - \beta \text{KL}(\pi_\theta \| \pi_{\text{ref}}) \right]
$$

KL 散度项约束策略不偏离参考模型(SFT checkpoint)太远.

### 2.3 GRPO 的方差-效率权衡

GRPO 的组内基线估计是有偏的(除非 $G \to \infty$), 但方差低于 single-sample 估计. 偏差-方差分解:

$$
 \mathbb{E}[(\hat{A} - A)^2] = \underbrace{(\mathbb{E}[\hat{A}] - A)^2}_{\text{bias}^2} + \underbrace{\text{Var}(\hat{A})}_{\text{variance}}
$$

- **偏差**: 当 $G$ 较小时, 组内均值可能系统性偏离真实期望回报. 例如, 若某查询的 8 条回复恰好都质量偏低, 基线被低估, 导致所有回复获得正优势(相对「差中的较好」), 误导策略优化.
- **方差**: 相比 PPO 的 critic(利用时序差分降低方差), GRPO 的组内估计方差更高, 但免除了 critic 的训练成本.

Qwen2.5 通过「按方差排序查询」来缓解偏差问题: 优先处理奖励模型打分方差高的查询, 这些查询的组内差异更大, 基线估计更可靠. 这是一种「主动学习」策略 —— 将计算资源集中在「最具信息量」的查询上.

> **技术思考 2.1 | 架构细节**: GRPO 的 $G=8$ 是一个关键超参数. 较小的 $G$(如 4)降低采样成本但增加基线估计方差; 较大的 $G$(如 16 或 32)提升估计质量但增加内存与计算开销. Qwen2.5 选择 8 是计算效率与估计精度的平衡点. 值得注意的是, DeepSeek-R1 的后续工作将 $G$ 扩展到 64 甚至更高, 配合规则驱动奖励(无需奖励模型), 实现了纯 RL 的极致探索. Qwen2.5 仍依赖奖励模型, 因此 $G$ 受限于奖励模型的推理吞吐 —— 每条回复都需要一次奖励模型前向传播, $G=8$ 意味着每个查询需要 8 次 RM 推理, 这在计算上已相当昂贵.

> **技术思考 2.2 | 技术谱系**: GRPO 的演化路径清晰可辨: DeepSeek-Math(2024.02)发明 GRPO 用于数学推理 → Qwen2.5(2024.12)将 GRPO 引入通用 LLM 的在线 RL → DeepSeek-R1(2025.01)将 GRPO 与纯 RL(无 SFT/RM)结合达到推理 SOTA. 这一链条揭示了 GRPO 的通用性 —— 它不仅适用于数学, 也适用于通用偏好优化, 关键在于奖励信号的设计. Qwen2.5 的 6 维度奖励模型(真实性/有用性/简洁性/相关性/无害性/去偏)比 DeepSeek-Math 的规则驱动奖励(答案正确性)更复杂, 但也更通用.

---

## 3 Turbo 的渐进式百万上下文方案

### 3.1 渐进式扩展 vs 一步到位

Qwen2.5-Turbo 的上下文扩展采用四阶段渐进策略:

$$
 32{,}768 \xrightarrow{\text{Stage 1}} 65{,}536 \xrightarrow{\text{Stage 2}} 131{,}072 \xrightarrow{\text{Stage 3}} 262{,}144 \xrightarrow{\text{DCA+YARN}} 1{,}000{,}000
$$

每阶段的数据配比为: 40% 当前最大长度序列 + 60% 较短序列. 这种「渐进爬坡」的设计基于一个关键观察: 模型在学习 $L_{i+1}$ 长度时, 若完全丢弃 $L_i$ 的数据, 会遗忘已习得的短程能力. 混合配比确保模型在「攀登」新长度的同时不「滑落」旧能力.

RoPE 基频从 Qwen2 的 1,000,000 进一步提升至 **10,000,000**, 对应更平缓的旋转角度曲线. 基频选择遵循「目标长度 - 预训练长度」的比例关系:

| 模型 | 预训练长度 | 目标长度 | 基频 | 比例(目标/预训练) |
|:---|:---:|:---:|:---:|:---:|
| Qwen2 | 32K | 128K | 1M | 4x |
| Qwen2.5 稠密 | 32K | 128K | 1M | 4x |
| Qwen2.5-Turbo | 262K | 1M | 10M | ~4x |

基频与长度扩展倍数的耦合关系验证了「更长的外推距离需要更激进的基频调整」这一规律.

### 3.2 Minference 稀疏注意力

处理 1M token 的全注意力计算复杂度为 $O(L^2) = O(10^{12})$, 在消费级硬件上不可行. Qwen2.5-Turbo 采用基于 Minference 的稀疏注意力机制, 将 1M token 的注意力计算负载降低 **12.5 倍**.

Minference 的核心思想是: 长序列注意力矩阵具有稀疏性 —— 每个 token 只需关注一小部分关键前缀 token, 而非全部. 具体实现可能包括:
- **局部窗口注意力**: 每个 token 只关注邻近的 $W$ 个 token
- **全局稀疏注意力**: 保留少数全局 token(如段落首句)供所有 token 关注
- **动态稀疏**: 根据内容重要性动态选择关注的 token

Qwen2.5 未披露具体稀疏模式, 但 12.5 倍的加速比暗示了较为激进的稀疏策略. 实测 TTFT(Time To First Token)加速 3.2-4.3 倍, 低于 12.5 倍的理论值, 原因在于稀疏注意力之外的计算(如 FFN、embedding)并未减少.

> **技术思考 3.1 | 局限性**: 稀疏注意力的 12.5 倍加速是有代价的 —— 它改变了注意力图的拓扑结构, 可能损害需要「全局依赖」的任务(如跨文档推理、长距离指代消解). Qwen2.5 的 RULER 测试显示 Turbo 在 128K 上平均 93.1, 低于 72B 稠密模型的 95.1, 这暗示稀疏性确实带来了一定的精度损失. 然而, 在 1M 级别上, 全注意力在物理上不可行, 稀疏化是唯一的工程出路. 未来的优化方向可能包括「自适应稀疏」—— 根据输入内容动态调整稀疏程度(简单文档用高稀疏, 复杂推理用低稀疏).

---

## 4 架构演进的技术谱系

| 技术组件 | Qwen2 | Qwen2.5 | 变化 |
|:---|:---|:---|:---|
| 预训练数据 | 7T | 18T | +157%, 合成数据占比提升 |
| SFT 数据 | 500K+ | 1M+ | +100%, 9 个专项领域 |
| 离线 RL | DPO | DPO | 不变, 150K pairs |
| 在线 RL | DPO + OMO | **GRPO** | 方法论升级 |
| 最大上下文 | 128K | 128K / **1M(Turbo)** | Turbo 渐进扩展 |
| RoPE 基频 | 1M | 1M / **10M(Turbo)** | Turbo 更激进 |
| 稀疏注意力 | 无 | **Minference(Turbo)** | 1M 必需 |
| 超参调优 | 经验 | **Scaling Law 预测** | 工业化升级 |
| 控制 token | 3 | 22 | 工具/结构化输出支持 |

Qwen2.5 的架构哲学是「**在成熟框架内做极致优化**」. 与 Qwen2 相比, 没有颠覆性架构创新, 但每个组件都经历了显著的工程深化: 数据量翻倍、后训练引入 GRPO、长上下文引入稀疏注意力、超参引入 scaling law. 这种「渐进式工程优化」与 DeepSeek 系列的「激进架构重构」(MLA、DualPipe、FP8)形成鲜明对比, 反映了两种截然不同的技术路线: 前者追求「稳健交付与生态覆盖」, 后者追求「单点突破与效率极限」.
