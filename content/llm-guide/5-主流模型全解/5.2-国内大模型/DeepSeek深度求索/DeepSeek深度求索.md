---
title: "5.2 · DeepSeek 深度求索 — V3/R1 技术报告深度研读"
date: 2026-05-11
tags: []
---

# DeepSeek 深度求索 — V3/R1 技术报告深度研读

> 本文为 DeepSeek V3 与 R1 的技术报告深度研读，整合原论文核心内容与社区高质量解读，涵盖 MLA、DeepSeekMoE、MTP、FP8 训练、GRPO、纯 RL 推理激发等关键技术创新。

---

## 2. DeepSeek-V3：架构创新的三部曲

DeepSeek-V3 是一个 **671B 总参数、37B 激活参数** 的 MoE 模型，在 14.8T tokens 上完成训练。它的核心架构创新可以概括为"三部曲"：MLA 重塑注意力机制、DeepSeekMoE 重塑前馈网络、MTP 重塑训练目标。

### 2.1 MLA(Multi-head Latent Attention)— 注意力机制的"瘦身革命"

MLA 是 DeepSeek-V3 最核心的架构创新，它从根本上解决了标准多头注意力(MHA)在推理时的 KV 缓存瓶颈。

**标准 MHA 的问题**：在推理时，每个 Transformer 层需要缓存所有注意力头的 Key 和 Value 矩阵。对于一个 h 头、每头维度 d 的模型，每层需要缓存 $2 \times h \times d$ 个值。随着序列长度增长，KV 缓存成为显存瓶颈，限制了长序列推理的效率。

**MLA 的核心思想**：通过**低秩联合压缩**，将 Key 和 Value 的表示压缩到一个低维潜在空间中。具体而言：

1. 对于每个 token，计算一个**潜在向量** $c_t \in \mathbb{R}^{d_c}$(其中 $d_c \ll h \times d$)
2. 从潜在向量中分别恢复出 Key 和 Value 的低秩近似
3. 在推理时只需要缓存这个低维的潜在向量，而非完整的 KV 矩阵

数学上，MLA 的压缩过程可以表示为：

$$
c_t = W_{DKV} \cdot h_t \tag{1}
$$

其中 $W_{DKV} \in \mathbb{R}^{d_c \times d}$ 是压缩矩阵，$h_t$ 是第 t 个 token 的隐藏状态。然后通过上投影矩阵恢复：

$$
k_t = W_{UK} \cdot c_t, \quad v_t = W_{UV} \cdot c_t \tag{2}
$$
其中 $W_{UK} \in \mathbb{R}^{h d \times d_c}$ 和 $W_{UV} \in \mathbb{R}^{h d \times d_c}$ 是上投影矩阵。

**MLA 的关键优势**：

| 方面 | 标准 MHA | MLA |
|:----|:---------|:----|
| KV 缓存大小 | $2 \times n_h \times d_h$ | $n \times d_c$(压缩比约 4~8×) |
| 计算复杂度 | 随头数线性增长 | 固定潜在维度，头数无关 |
| 长序列推理 | 显存瓶颈严重 | 显存友好，支持更长上下文 |
| 质量损失 | — | 可忽略(低秩近似充分) |

在 DeepSeek-V3 中，MLA 的 KV 缓存压缩比约为 **4~8 倍**，这使得模型在长序列推理场景下具有显著的显存优势。

### 2.2 DeepSeekMoE — 细粒度专家的艺术

DeepSeekMoE 是对标准 MoE(Mixture of Experts)架构的一次重要改进，其核心设计理念是**细粒度专家分割 + 共享专家隔离**。

**标准 MoE 的问题**：传统 MoE 通常使用少量(8~16 个)粗粒度专家，每个专家覆盖广泛的知识领域。这导致两个问题：一是专家间的负载不均衡严重，二是每个专家的专业化程度不够。

**DeepSeekMoE 的两个核心改进**：

**改进一：细粒度专家分割**

将传统的粗粒度专家拆分为更多细粒度专家。DeepSeek-V3 使用了 **256 个路由专家**(routed experts)，每个 token 激活 **8 个专家**。相比传统 MoE(如 Mixtral 8×7B 使用 8 个专家激活 2 个)，DeepSeekMoE 的专家粒度更细，路由更灵活。

**改进二：共享专家隔离**

除了 256 个路由专家外，DeepSeek-V3 还设置了 **1 个共享专家**(shared expert)，所有 token 都必须经过这个共享专家。这确保了基础知识在所有 token 间共享，而路由专家则专注于专业化知识。

数学上，DeepSeekMoE 的前向计算可以表示为：

$$
y = \text{SharedExpert}(x) + \sum_{i=1}^{8} g_i \cdot \text{Expert}_i(x) \tag{3}
$$

其中 $g_i$ 是路由权重，通过 Sigmoid 函数计算：

$$
g_i = \text{Sigmoid}(\text{Router}(x)_i) \cdot \text{TopK}(\text{Softmax}(\text{Router}(x)), 8) \tag{4}
$$
**Sigmoid 路由 vs Softmax 路由**：DeepSeek-V3 使用 Sigmoid 而非传统的 Softmax 来路由。Sigmoid 路由的优势在于各专家的激活是独立的(互不影响)，而 Softmax 会强制专家间的竞争关系。这使得 DeepSeekMoE 的路由更加灵活，专家可以同时被多个 token 激活而不相互挤压。

### 2.3 辅助无损负载均衡

MoE 模型训练中的一个核心挑战是**专家负载不均衡**问题——少数"热门"专家被频繁选择，而其他专家几乎不被使用。这不仅降低了计算效率，也导致模型容量无法充分利用。

DeepSeek-V3 提出了一种**辅助无损负载均衡策略**：通过动态调整每个专家的偏置(bias)项，在不影响模型质量的前提下促进负载均衡。

具体而言，每个专家维护一个偏置项 $b_i$，在路由计算时加入到 expert 的 score 中：

$$
g_i = \text{Sigmoid}(\text{Router}(x)_i + b_i) \cdot \text{TopK}(\text{Softmax}(\text{Router}(x)), 8) \tag{5}
$$

在训练过程中，监控每个专家的负载情况，动态调整偏置：负载过高的专家降低偏置，负载过低的专家提高偏置。调整幅度通过一个**序列级辅助损失**(sequence-wise auxiliary loss)来控制：

$$
\mathcal{L}_{\text{bal}} = \alpha \sum_{i=1}^{N} \frac{f_i}{T} \cdot \frac{P_i}{T} \tag{6}
$$
其中 $f_i$ 是序列中分配给专家 i 的 token 数，$P_i$ 是分配给专家 i 的路由概率之和，$T$ 是序列中的 token 总数，$\alpha$ 是平衡系数(DeepSeek-V3 中取极小值，确保不影响主损失)。

这种策略的巧妙之处在于：辅助损失在序列级别计算(而非全局)，与主损失相比权重极小，因此**不会影响模型的主任务性能**，同时又能有效促进负载均衡。

### 2.4 MTP(Multi-Token Prediction)— 让模型学会"往前看三步"

MTP 是 DeepSeek-V3 在训练目标上的一个重要创新。传统的因果语言模型每次只预测下一个 token，而 MTP 让模型同时预测未来 k 个 token。

**MTP 的实现方式**：DeepSeek-V3 在主干网络之上增加了 k-1 个独立的预测头(prediction heads)，每个预测头负责预测第 i 步之后的 token。这些预测头共享主干网络的表示，但有自己的输出层。

MTP 的关键设计包括：

1. **因果链保持**：每个预测头只使用当前位置之前的 token 进行预测，不会泄露未来信息
2. **联合训练**：主任务的 next-token prediction 损失和 MTP 的辅助损失联合优化
3. **推测解码加速**：在推理时，MTP head 可以用于推测解码(speculative decoding)，显著提升生成速度

**MTP 的收益**：

| 收益 | 说明 |
|:----|:------|
| 更强的表示学习 | 迫使模型学习更长距离的依赖关系 |
| 更丰富的训练信号 | 每个 token 位置产生 k 个监督信号 |
| 推理加速 | 支持推测解码，生成速度提升 1.5~2× |
| 与架构正交 | 可以应用于任何因果语言模型 |

---

## 3. 训练系统工程：把 671B 模型训到极致

### 3.1 FP8 混合精度训练

DeepSeek-V3 是首个在大规模模型训练中成功应用 FP8 混合精度的模型。传统上，大模型训练使用 FP16/BF16 作为主流精度，FP8 因其动态范围有限而难以稳定训练。

DeepSeek-V3 的 FP8 训练方案包括：

1. **细粒度量化**：对不同的张量(激活、权重、梯度)采用不同的量化策略和缩放因子
2. **在线量化**：量化参数在训练过程中动态调整，而非静态预设
3. **块级量化**：将大张量分为多个块，每个块独立量化，减少量化误差的累积

FP8 训练带来的收益是巨大的：**显存占用降低约 50%，计算吞吐提升约 2 倍**，同时保持了与 BF16 训练相当的模型质量。

### 3.2 DualPipe 与通信优化

DualPipe 是 DeepSeek-V3 的分布式训练框架的核心创新。标准的 3D 并行(数据并行 + 张量并行 + 流水线并行)在处理 671B 参数的 MoE 模型时面临严重的通信瓶颈。

**DualPipe 的核心思想**：通过**双向流水线调度**和**计算-通信重叠**，最大化 GPU 利用率。

具体而言，DualPipe 采用 16 路流水线并行(PP)× 64 路专家并行(EP)× ZeRO-1 数据并行(DP)的三维并行策略。其中：专家并行专门用于 MoE 层——不同的 expert 分布在不同 GPU 上，通过 all-to-all 通信实现跨节点的专家路由。

DualPipe 的通信优化包括：

1. **双向流水线**：前向和反向传播同时进行，消除流水线气泡
2. **异步通信**：计算和通信重叠，GPU 在等待通信时执行其他计算
3. **跨节点优化**：使用 InfiniBand 高速互联，优化跨节点的 all-to-all 通信模式

### 3.3 训练成本与稳定性

DeepSeek-V3 的训练成本数据令人瞩目：

| 指标 | 数据 |
|:----|:----:|
| 模型参数 | 671B 总参 / 37B 激活 |
| 训练数据 | 14.8T tokens |
| 硬件 | 2,048 块 NVIDIA H800 GPU |
| 总训练时间 | ~2.788M H800 GPU hours |
| 训练稳定性 | **0 个 loss spikes**(需要重启的损失尖峰) |
| 训练成本 | ~$5.576M(按 $2/GPU hour 估算)|

**0 loss spikes** 这一数据尤为惊人。在大模型训练中，loss spike(损失值突然飙升)是常见问题，往往需要中断训练并从最近的 checkpoint 恢复。DeepSeek-V3 在整个训练过程中实现了零 loss spikes，这得益于其稳定的 FP8 训练策略和精心设计的训练流程。

---

## 4. DeepSeek-R1：推理能力的"纯 RL 涌现"

DeepSeek-R1 是 2025 年初最受关注的推理模型之一。它的核心创新在于**证明了纯强化学习可以激发 LLM 的推理能力**，而无需依赖大规模人工标注的推理轨迹数据。

### 4.1 R1-Zero：纯粹强化学习的实验

R1-Zero 是 DeepSeek-R1 的前身，它的训练流程极其简洁：

1. **基础模型**：DeepSeek-V3-Base(未经过 SFT 的基础模型)
2. **训练方法**：仅使用强化学习(GRPO 算法)，没有任何监督微调(SFT)冷启动
3. **奖励信号**：仅基于答案正确性的简单位置奖励(verifiable reward)

实验结果显示了一个令人震惊的现象：**仅通过 RL 训练，模型自发涌现了推理能力**——包括自我反思(self-reflection)、验证(verification)、自适应策略调整等高阶推理行为。

#### 4.1.1 "Aha Moment"：推理能力的涌现

在 R1-Zero 的训练过程中，观察到了一个被研究者称为 **"Aha Moment"** 的现象：模型在训练到某个临界点后，突然学会了"重新审视"自己的推理过程。

具体表现为：
- 模型开始在回答前主动生成**思考标记**(thinking tokens)
- 模型会**回溯**之前的推理步骤，发现错误并修正
- 模型学会了**验证**自己的中间结论

这些行为**没有在任何训练数据中显式出现过**，完全是 RL 训练中涌现出来的。这证明了：

> **对于足够强大的基础模型，正确的奖励信号 + 充分的 RL 探索，可以在没有人工示范的情况下演化出复杂的推理策略。**

### 4.2 GRPO 算法

GRPO(Group Relative Policy Optimization)是 DeepSeek 提出的强化学习算法，作为 PPO 的替代方案。其核心创新是**用组内相对优势替代价值模型(Critic)** 。

**GRPO 的核心公式**：

$$
\mathcal{L}_{GRPO}(\theta) = -\mathbb{E}_{q \sim P(Q), \{o_i\}_{i=1}^{G} \sim \pi_{\theta_{old}}(O|q)} \left[ \frac{1}{G} \sum_{i=1}^{G} \min\left(\frac{\pi_\theta(o_i|q)}{\pi_{\theta_{old}}(o_i|q)} A_i, \text{clip}\left(\frac{\pi_\theta(o_i|q)}{\pi_{\theta_{old}}(o_i|q)}, 1-\epsilon, 1+\epsilon\right) A_i\right) - \beta D_{KL}(\pi_\theta \| \pi_{ref}) \right] \tag{7}
$$

其中 $A_i$ 是组内相对优势：

$$
A_i = \frac{r_i - \text{mean}(\{r_1, r_2, ..., r_G\})}{\text{std}(\{r_1, r_2, ..., r_G\})} \tag{8}
$$
**GRPO vs PPO 的核心区别**：

| 维度 | PPO | GRPO |
|:----|:----|:-----|
| 优势估计 | 需要 Value Model (Critic) | 通过组内采样计算相对优势 |
| 模型数量 | 4 个(Actor/Critic/RM/Reference) | 3 个(Actor/RM/Reference) |
| 训练资源 | 更高(需要维护 Critic) | 更低(去掉 Critic) |
| 实现复杂度 | 复杂(需要 GAE、TD-error 等) | 简洁(组内归一化) |
| 适用场景 | 通用 RLHF | 推理任务(reward 可验证) |

GRPO 的优势在于：当 reward 信号可以直接从任务结果中获得(如数学题的正确性)时，不需要额外的 Value Model 来估计优势，从而简化了训练流程、降低了资源需求。

### 4.3 R1 的完整训练流程

DeepSeek-R1 的完整训练流程比 R1-Zero 多了"冷启动"阶段，整体流程为：

```
第一阶段：冷启动 SFT
  ├ 收集少量高质量推理数据(数千条)
  ├ 使用这些数据对 V3-Base 进行监督微调
  └ 目的：为 RL 训练提供稳定的起点

第二阶段：大规模 RL 训练
  ├ 使用 GRPO 算法进行强化学习
  ├ 奖励信号 = 格式奖励(CoT 格式) + 结果奖励(答案正确性)
  └ 训练至推理能力的涌现 → R1 模型

第三阶段：蒸馏
  ├ 使用 R1 的推理轨迹对其他模型进行 SFT
  ├ DeepSeek-R1-Distill-Qwen-7B/14B/32B 等
  └ 小模型也能具备强大的推理能力
```

这种"冷启动 SFT → 大规模 RL → 蒸馏"的三阶段流程，平衡了训练效率和模型质量：
- 冷启动避免了纯 RL 训练的探索成本过高
- 大规模 RL 激发了真正的推理能力
- 蒸馏确保了能力的广泛传播

### 4.4 R1 的开源影响

DeepSeek-R1 的开源对 AI 社区产生了深远影响：

1. **打破了推理模型的神秘感**：证明了 o1 类模型的推理能力可以通过开源技术路线实现
2. **验证了"RL + 基础模型 = 推理"的范式**：为后续的推理模型研究提供了清晰的方向
3. **推动了推理模型的平民化**：通过蒸馏，小团队也可以在自己的模型上实现推理能力

---

## 5. DeepSeek V4 预览：下一代的进化方向

> 本节基于 2026 年 4 月的 DeepSeek V4 预览版信息，最终细节可能随正式版本有所调整。

DeepSeek V4 代表了 DeepSeek 在架构上的又一次重大进化，其核心创新是 **CSA/HCA 混合注意力架构**。

### 5.1 CSA(Compressed Sparse Attention)

CSA 是一种**压缩稀疏注意力**机制，它融合了两种互补的策略：

1. **压缩策略**：对历史 token 进行压缩表示(类似 MLA 的潜在向量思想)，减少需要参与注意力计算的 token 数量
2. **稀疏策略**：选择性地关注关键 token，而非全部历史 token

这两种策略的结合使得 CSA 能够在不显著降低模型质量的前提下，大幅降低注意力计算的计算量和内存需求。

### 5.2 HCA(Highly Compressed Attention)

HCA 是比 CSA 更极致的压缩版本，适用于对精度要求不那么苛刻的场景。它通过更强的压缩比率，实现了更高效的上下文处理。

**CSA 与 HCA 的配合**：在实际推理中，模型可以根据任务需求动态切换——需要高精度时用 CSA，需要高效率时用 HCA。这种灵活性使得 V4 能够支持高达 **1M token 的上下文窗口**。

### 5.3 两段式 Post-training

V4 的 Post-training 流程也进行了创新性的改进：

```
第一阶段：独立专家训练
  ├ 通用对话专家 → Chat
  ├ 编程专家 → Coder
  ├ 推理专家 → Reasoner
  └ 各专家独立优化

第二阶段：统一蒸馏
  └ 将所有专家的能力蒸馏回一个统一的模型
```

这种"分而治之"的策略使得 V4 能够在保持模型规模不变的前提下，获得更专业化的能力。V4 提供了两个版本：
- **V4-Flash(284B 总参 / 13B 激活)** ：MIT 协议开源，面向社区
- **V4-Pro(1.6T 总参 / 49B 激活)** ：闭源，面向企业级应用

---

Zero → R1 → 蒸馏 | 独立专家 → 统一蒸馏 |
| **结果** | 671B/37B，2.788M GPU hours | 推理能力涌现 | 1M 上下文，1.6T/49B |

DeekSeek 的技术哲学可以概括为：**用架构创新降低计算成本，用系统工程提升训练效率，用 RL 激发模型潜力。** 这条路线证明了，在大模型竞争中，**效率优先**的策略同样可以产出世界级的模型。

---

## 6. 参考文献

1. DeepSeek-V3 Technical Report, arXiv:2412.19437, 2024
2. DeepSeek-R1: Incentivizing Reasoning Capability in LLMs via Reinforcement Learning, arXiv:2501.12948, 2025
3. DeepSeek-V4 Preview Report, 2026
4. poplyx, "文献阅读：DeepSeek-V3 Technical Report", 知乎, 2025.2
5. zhangzhe.space, "DeepSeek-V3 Technical Report 精读", 2025.2
6. 桔了个仔, "DeepSeek V4 预览版解读", 知乎, 2026.4
