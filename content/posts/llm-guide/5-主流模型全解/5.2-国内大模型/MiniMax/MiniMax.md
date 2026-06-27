---
title: "MiniMax 技术报告深度研读"
date: 2026-05-11
tags: []
---

# MiniMax 技术报告深度研读

## 2. MiniMax-01：线性注意力的"临门一脚"

### 2.1 混合架构的设计哲学

MiniMax-01 的核心理念是：**既然线性注意力在中等规模(7B-13B)已被反复验证(Jamba、Hybrid Mamba2、Bamba 等)，为什么不把它 scale up 到真正的生产规模？**

这个"临门一脚"式的选择，使得 MiniMax-01 成为了首个在大规模(456B/45.9B 激活)上验证混合架构的模型。

模型架构的核心参数：

| 参数 | 数值 |
|:-----|:-----:|
| 总参数量 | 456B |
| 激活参数量 | 45.9B |
| 专家数 | 32(Top-2 路由) |
| 层数 | 80 层 |
| 注意力头数 | 64 头，每头 128 维 |
| 混合比例 | 每 7 层 Linear Attention + 1 层 Softmax Attention |
| 上下文窗口 | 4,000,000 token |
| MoE 路由策略 | 全局路由器(Global Router) |

### 2.2 Lightning Attention：核心技术创新

Lightning Attention 是 MiniMax-01 真正的技术灵魂。它属于 **data-independent decay 的线性注意力架构**(第一代 modern linear attention)，与同期工作的关系如下：

- **第一代(data-independent decay)** ：Lightning Attention(MiniMax)、RetNet(Microsoft)、Transnormer
- **第二代(data-dependent decay)** ：GLA、Mamba2、RWKV6
- **第三代(更 expressive 的 update rule)** ：DeltaNet、RWKV7

MiniMax 选择第一代路线的原因非常务实：**在混合架构中，Softmax Attention 可以承担局部信息建模的任务，因此线性注意力部分可以用更简单的 data-independent decay**。

#### 2.2.1 核心技术要素

1. **分块计算(Chunkwise Computation)** ：Lightning Attention 将 Q、K、V 矩阵沿行维度划分块，块内使用左积(左乘累积)，块间使用右积(右乘累积)，避免了全局 softmax 的 O(n²) 复杂度。

2. **层次化衰减分布**：低层使用较大的衰减速率(聚焦局部信息)，高层使用较小的衰减速率(关注全局信息)。顶层退化为无衰减的 vanilla linear attention，确保长距离依赖不被指数衰减抹杀。

3. **I/O 感知优化**：通过 CUDA 内核融合、分离预填充和解码执行、多级填充(padding)等工程手段，在 H20 GPU 上实现了超过 **75% 的模型浮点运算利用率(MFU)** ，其中 Lightning Attention 仅占不到 12% 的推理延迟。

### 2.3 长上下文能力的工程支撑

MiniMax-01 的 400 万 token 上下文窗口是 GPT-4o 的 32 倍、Claude 3.5 Sonnet 的 20 倍。支撑这一能力的工程创新包括：

- **变长环形注意力(Varlen Ring Attention)** ：对 Softmax Attention 部分的优化，支持数据打包格式下的无限扩展
- **LASP+**：改进的线性注意力序列并行算法，通过本地前缀和 + AllGather 全局同步消除了原始 LASP 的顺序依赖
- **三阶段长上下文扩展**：从 8K → 32K → 100K → 1M 逐步扩展

### 2.4 开源策略与影响

MiniMax-01 是完全开源的，这在当时的国产模型中相当罕见。模型的评价非常两极化：

- **支持者**：认为 Lightning Attention 开辟了与 DeepSeek MLA 并列的另一条架构创新道路，长上下文能力是真正的差异化优势
- **质疑者**：MMLU/BBH 等标准基准上的表现与 GPT-4o 仍有差距，"创新但不领先"

## 3. MiniMax-M2：从 Linear Attention 回归 Full Attention

### 3.1 为什么回调？

M2 的决定令社区震惊——**从线性注意力全面回归 Full Attention**。M2 的研发者(知乎答主 Haohai.Sun)给出了非常坦诚的解释：

> *"如果你有无限算力，你会选择研究 linear attention 或者 sparse attention 吗？"*

核心问题是 **评测的局限性和观测的高成本**：

1. **Benchmark 不够全面**：在 MiniMax-01 研发时(2024)，大家主要看 MMLU/BBH/Math/LongBench。混合架构在这些榜单上完全不输 Full Attention。但 scale 到更大模型后，**复杂多跳推理任务出现了明显缺陷**。

2. **"没有免费午餐"**：降低 Attention 复杂度，付出的代价在更大规模下才暴露出来。小规模实验中无法观测的问题，到了 456B 规模才显现。

3. **精度问题**：Lightning Attention 在 RL 训练中暴露出严重的低精度数值问题，这在 M1 的 RL 训练中被发现，回过头去做数值收敛性分析才找到根因。

### 3.2 M2 的定位转变

M2 标志着 MiniMax 从"架构创新驱动"向"产品场景驱动"的战略转变：

- **专注 Agent 场景**：代码生成、工具调用、多步推理成为核心优化方向
- **Full Attention 回归**：在 Agent 所需的多跳推理、复杂指令遵循等任务上，Full Attention 仍然不可替代
- **推理效率的实用主义**：虽然 Full Attention 理论复杂度高，但通过 PagedAttention、Prefix Cache、投机解码等工程手段，实际推理成本可以被有效控制

### 3.3 M2 的反思价值

M2 的回调选择，实际上为整个行业提供了一个极其有价值的教训：

> **线性注意力/稀疏注意力的基建远远落后于 Full Attention。** 要真正拿到收益，需要补的课非常多：
> - States 的低精度存储(Linear Attention 对精度要求远高于 Full Attention)
> - Prefix Cache 支持(正常业务中 Cache 命中率极高)
> - 投机解码适配
> - 在线 RL 训练的稳定性

MiniMax 的坦诚("发现 Linear Attention 在更大规模有缺陷，决定先回归 Full Attention 把产品做好")，远比那些"我们有新架构但不敢 scale up"的公司要诚实得多。

## 4. M2.5 → M2.7：Agent 能力的进化

### 4.1 M2.5：Agent 能力跃升

M2.5(2026 年 2 月)是 MiniMax 在 Agent 方向的重要里程碑：

- **数十万个真实复杂环境中的大规模强化学习训练**
- **编程与工具调用能力的大幅提升**——在 SWE-bench、LiveCodeBench 等编码基准上进入第一梯队
- **Office Agent 能力**：Word/Excel/PDF 等文档处理 Agent

> ⚠️ 需要注意的是，M2.5 的 Office Skill 被 Kimi 指控抄袭(代码结构高度相似，详见 Kimi 部分的分析)，这对 MiniMax 的技术声誉造成了一定影响。

### 4.2 M2.7：编码 Agent 的最新迭代

M2.7(2026 年 3 月)进一步强化了编码 Agent 能力：

- 定位为 **Claude 平替**，主打编程场景
- 在 M2.5 的基础上继续强化代码生成、Debug 和项目管理能力
- 定价策略激进(Starter 29 元/月，Plus 49 元/月)，面向个人开发者

## 5. MiniMax 的技术演进图谱

```
MiniMax-01 (2025.1)          MiniMax-M2 (2025.10)
  ├ 架构: Linear+Softmax        ├ 架构: Full Attention
  ├ 参数: 456B/45.9B           ├ 定位: Agent 场景
  ├ 上下文: 4M token            ├ 多跳推理: ✅ 显著提升
  ├ 开源: ✅ Apache 2.0         ├ 开源: ❌ 闭源
  └ 核心创新: Lightning Attn    └ 核心决策: 务实回调

MiniMax-M1 (2025)              MiniMax-M2.5 (2026.2)
  ├ 架构: Lightning Attention    ├ 架构: Full Attention
  ├ 核心: Test-Time Compute      ├ 强化学习: 数十万真实场景
  └ 发现: RL 精度问题            └ Agent 能力大幅提升

                               MiniMax-M2.7 (2026.3)
                                 ├ 编码 Agent 深度优化
                                 └ Claude 平替定位
```

## 6. 与同行的全面对比

| 维度 | MiniMax | DeepSeek | Kimi | GLM |
|:-----|:--------|:---------|:-----|:-----|
| **核心创新** | Lightning Attention + MoE | MLA + DeepSeekMoE + MTP | MoE + MLA + MuonClip | 自回归填空 + 2D PE |
| **架构路线** | Linear Attention → Full Attention | 持续优化 Full Attention + MoE | 持续 MoE 路线 | Decoder-only + MoE |
| **上下文** | 4M token(MiniMax-01) | 128K(V3)/ 1M(V4) | 128K(K2)/ 256K(K2.5) | 128K(GLM-4) |
| **开源策略** | 01 开源，M2 闭源 | 全面开源(MIT) | K2 开源(Apache 2.0) | 部分开源 |
| **差异化优势** | 线性注意力工程实践 | 架构创新+成本极致 | 长上下文+医学场景 | 全栈能力+企业服务 |
| **主要局限** | 多跳推理(已修复) | 推理成本(V4) | 多模态偏弱 | 上下文受限 |

## 7. 总结：MiniMax 的技术遗产

MiniMax 的技术路线在中国 AI 大模型竞赛中独树一帜，核心启示有三：

1. **Lightning Attention 的工程验证无价**：MiniMax-01 是业界首个在大规模(456B)上验证线性注意力混合架构的模型。虽然最终因为多跳推理的缺陷而回归 Full Attention，但这一实验本身为整个行业提供了宝贵的经验。如果没有 MiniMax-01 的"临门一脚"，我们对线性注意力在大规模下的行为理解会更加有限。

2. **"没有免费的午餐"的生动证明**：降低 Attention 复杂度是有代价的——它在某些能力维度上会带来不可预见的退化。这一问题可能只在更大规模、更复杂任务上才会暴露。MiniMax 从线性注意力回归 Full Attention 的"回调"，比那些一直走 Full Attention 路线的公司提供了更多的认知价值。

3. **务实的产品导向**：从 M2 开始，MiniMax 不再追求架构上的标新立异，而是专注于 Agent 场景的实际交付。这种"用产品验证技术"的思路，对于一家资源有限的创业公司来说，可能是最理性的选择。

MiniMax 的技术故事告诉我们：**在 AI 领域，最勇敢的创新未必是走一条全新的路，而是在走了一条新路后发现行不通，然后坦诚地退回来选另一条路。** 这种敢于实验、敢于承认、敢于调整的勇气，远胜于那些永远在 paper 里宣称 SOTA、永远不敢 scale up 的"创新"。
