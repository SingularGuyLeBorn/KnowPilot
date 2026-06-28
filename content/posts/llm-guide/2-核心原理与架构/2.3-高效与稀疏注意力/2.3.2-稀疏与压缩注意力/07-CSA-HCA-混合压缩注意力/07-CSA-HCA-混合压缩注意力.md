---
title: "07 · CSA-HCA：混合压缩注意力"
date: 2026-05-24
tags: [DeepSeek-V4, CSA, HCA, 长上下文, 稀疏注意力, DSA]
---

# 07 CSA-HCA：DeepSeek-V4 混合压缩注意力

> 系列索引：[2.3.2 稀疏与压缩注意力](../2.3.2-稀疏与压缩注意力.md) · [2.3 高效与稀疏注意力](../../2.3-高效与稀疏注意力.md)  
> 论文：[DeepSeek-V4 Technical Report](https://arxiv.org/abs/2601.0001)（项目内 MinerU 稿：[deepseek-v4.md](../../../../14-主流开源模型全景解析与技术报告精读/14.1-DeepSeek/10-DeepSeek-V4/pdfs/deepseek-v4/hybrid_auto/deepseek-v4.md)）

DeepSeek-V4 将上下文推至 **1M tokens**，核心不是替换 Transformer，而是 **混合压缩注意力**：**CSA（Compressed Sparse Attention）** 负责「精准找相关」，**HCA（Heavily Compressed Attention）** 负责「全局不遗漏」。在 1M 场景下，V4-Pro 相对 V3.2：**单 token FLOPs ≈ 27%，KV Cache ≈ 10%**（论文 Figure 1 右图）。

> **演进坐标**：MLA 解决「KV 存什么」；NSA/DSA/MoBA 解决「对谁算」；**CSA+HCA 把压缩率与稀疏选择组合成可生产的 1M 方案** — 与 [2.2.2 MLA](../../../2.2-基础注意力机制/2.2.2-多头注意力变体/04-MLA-低秩潜变量与解耦式注意力/04-MLA-低秩潜变量与解耦式注意力.md)、[02 NSA](../02-原生稀疏注意力机制NSA/02-原生稀疏注意力机制NSA.md)、[01 MoBA](../01-MoBA架构深度解析/01-MoBA架构深度解析.md) 同读效果最佳。

---

## 1. 设计动机：改「看到的序列长度」

| 瓶颈 | V3.2（MLA 稠密） | V4 思路 |
|------|------------------|---------|
| 1M 序列 FLOPs | 随有效长度仍高 | CSA 稀疏 + HCA 极压缩 |
| 全局语义 | 全序列 MLA 点积 | HCA：长度先压至 $n/128$ 再稠密 |
| 局部精细 | 标准 attention | CSA + **滑动窗口** 未压缩 KV |

**一句话**：与其改 Softmax 公式，不如 **改 attention 输入的有效序列长度**。

![DeepSeek-V4 整体架构：CSA/HCA 与 MoE、mHC 的层间排布](./images/fig-v4-hybrid-architecture.jpg)

> 图 1: DeepSeek-V4 层间排布——CSA/HCA 与 MoE、mHC 交错（论文 Figure 2）。

**图 1 解析**

- **纵轴**：Transformer 块堆叠；**横轴**：同一层内子模块分工。Attention 层不再全是「全长度 MLA」，而是 **CSA 层与 HCA 层交错**，形成「稀疏精检索 + 极压缩全局」的节拍。
- **CSA 层**：对历史做 $1/m$ 压缩后，再用 DSA（DeepSeek Sparse Attention）做 top-k 块选择 — 计算量随 $k$ 与窗口固定，而非随 1M 线性爆炸。
- **HCA 层**：用更大压缩率 $m' \gg m$（如 128）把序列压到数千级，再 **稠密** attention — 保证稀疏路由漏掉的信息仍有「兜底通道」。
- **mHC**：流形约束超连接，稳定超深 MoE 的信号传播；与注意力正交，但决定 1M 训练能否收敛。
- **DeepSeekMoE + MTP**：与 V3 同族，说明 V4 的效率增益主要来自 **注意力路径**，而非换掉 MoE 主干。

![V4 与 V3.2 在 1M 上下文下的 FLOPs 与 KV Cache 对比](./images/fig-v4-benchmark-flops-kv.jpg)

> 图 2: 1M 上下文下单 token FLOPs 与 KV 相对 V3.2 的比例（论文 Figure 1 右）。

**图 2 解析**

- 横轴通常是上下文长度；纵轴为 **单 decode token** 的等效 FLOPs 与 **累积 KV 字节数**。
- **V3.2 曲线**随长度近似线性爬升 — MLA 已压缩 KV，但 attention 仍要对「压缩后仍很长的序列」做稠密交互。
- **V4-Pro**：1M 点处 FLOPs ≈ V3.2 的 27%、KV ≈ 10% — 说明 **CSA/HCA 同时砍了计算图与缓存**，不是只省 Cache。
- **V4-Flash**：更小激活参数量，FLOPs/KV 进一步下探（约 10% / 7%）— 面向高吞吐推理 SKU。
- 读图时注意：这是 **等效 FP8 FLOPs** 与混合精度 KV 存储后的系统账，和纯理论 $O(n^2)$ 不同。

---

## 2. CSA：压缩 + 稀疏 + 局部窗口

![CSA 核心结构：块压缩、DSA 选块、滑动窗口与 MQA 核心注意力](./images/fig-csa-core-architecture.jpg)

> 图 3: CSA——块压缩、DSA top-k、滑动窗口与 MQA 核心 attention（论文 Figure 3）。

**图 3 解析**

- **左侧输入**：原始隐藏状态 $H \in \mathbb{R}^{n \times d}$ 沿序列维分块，块长 $m$。
- **Token 级压缩**：每块内用可学习权重 $Z^a, Z^b$ 与条目 $C^a, C^b$ 做 Hadamard 加权求和，得到压缩 KV 条目 $\hat{K}_i, \hat{V}_i$；**相邻块重叠 1 token** 保证因果连续，有效长度 $\approx n/m$。
- **Lightning Indexer + DSA**：对压缩条目再算 indexer 分数，**top-k** 选出 $\mathcal{C}_t^{SprsComp}$ — 这是「可微检索」：先粗压缩，再稀疏精排。
- **滑动窗口分支**：每个 query 额外 attend 最近 $n_{win}$ 个 **未压缩** KV — 补块边界与局部语法；与 NSA 的 win 分支同角色。
- **MQA 核心注意力**：选中压缩条目 **一对 KV 服务所有 query 头** — 与 MLA decode 的 MQA mode 一致，利于 KV 带宽。
- **Partial RoPE + Sink**：仅部分维施加 RoPE，输出端用 $-i$ 抵消；可学习 sink 缓解超长 softmax 分母问题。

### 2.1 压缩公式（块 $i$）

对块内 token $j \in [(i-1)m+1, im]$：

$$
\hat{K}_i = \sum_{j} Z^a_j \odot C^a_j, \quad
\hat{V}_i = \sum_{j} Z^b_j \odot C^b_j \tag{1}
$$

重叠块使 $C^{Comp}$ 序列长度 $\approx n/m$，且块边界不「硬切」语义单元。

### 2.2 DSA 选块

Indexer 对压缩键 $K^{IComp}$ 打分，top-k 得到稀疏集合，再执行：

$$
\mathbf{o}_t = \mathrm{CoreAttn}\bigl(\mathbf{q}_t,\; C_t^{SprsComp},\; C_t^{SprsComp}\bigr) \tag{2}
$$

**复杂度直觉**：$O(n/m)$ 次压缩 + $O(k \cdot c)$ 次核心 attention，$k \ll n/m$。

---

## 3. HCA：重度压缩 + 稠密全局

![HCA 核心结构：更大压缩率 $m'$、无重叠、稠密 MQA](./images/fig-hca-core-architecture.jpg)

> 图 4: HCA——$m'=128$ 重度压缩后对全部压缩条目做稠密 attention（论文 Figure 4）。

**图 4 解析**

- **压缩率 $m' \gg m$**（如 128）：1M token → 有效 KV 条目 $<8000$，使 **稠密** attention 在可承受范围内。
- **无重叠压缩**：HCA 追求极致压缩比，接受块边界处略粗的语义聚合；依赖 **相邻 CSA 层** 补细节。
- **无稀疏 top-k**：对 **全部** 压缩条目做 attention — 「全局概览层」，类似 NSA 的 cmp 分支但更重。
- **同样 MQA + 分组输出投影**：$c n_h$ 维输出若直接投影到 $d$ 会太贵；分组投影把 FFN 前维度拆开，是 V4 工程化关键之一。
- **滑动窗口**：与 CSA 相同，防止极压缩丢失最近邻 token 精度。

|  | CSA | HCA |
|--|-----|-----|
| 压缩率 | $m$（如 8） | $m'$（如 128） |
| 重叠 | 有 | 无 |
| 稀疏 | DSA top-k | 无（稠密） |
| 角色 | 精准检索 | 全局兜底 |

---

## 4. 层间混合与系统账

V4 **交错** CSA 与 HCA：浅层 CSA 抓局部与候选块，深层 HCA 维持全局一致性；避免「全稀疏」导致的路由崩塌。

**1M 上下文工程数据（相对 V3.2，论文摘要）**

| 指标 | V4-Pro | V4-Flash |
|------|--------|----------|
| 单 token FLOPs | ~27% | ~10% |
| KV Cache | ~10% | ~7% |

配合 **FP4 MoE 权重**、FP8/BF16 混合 KV，带宽瓶颈从「存不下」转为「算得动」。

---

## 5. 与 MLA / NSA / MoBA 的对比

```
MHA → MQA → GQA → MLA（V2/V3）
                      ↓
              NSA / DSA（可训练稀疏）
                      ↓
              CSA + HCA（V4，1M）
                      ↓
         MoBA（Kimi，块路由，另一条工业线）
```

| 机制 | 压缩对象 | 稀疏 | 代表 |
|------|---------|------|------|
| MLA | KV latent | 否 | V2/V3 |
| NSA | 块级 KV | 三分支原生稀疏 | V3.2-Exp |
| MoBA | 无 | 块 top-k 路由 | Kimi |
| **CSA** | 序列 $1/m$ + top-k | 是 | **V4** |
| **HCA** | 序列 $1/128$ | 否（稠密） | **V4** |

**选型提示**：已有 GQA checkpoint、只想扩上下文 → [DCA](../05-DCA-双块注意力/05-DCA-双块注意力.md)；要高效 SFT 长文 → [S²-Attn](../06-S2-Attn-移位稀疏注意力/06-S2-Attn-移位稀疏注意力.md)；从零做 1M 预训练 → CSA+HCA 路线。

---

## 6. 边界与失效

| 场景 | 风险 | 缓解 |
|------|------|------|
| 短序列（<32K） | CSA 压缩/索引开销 > 收益 | 框架回退稠密 MLA |
| top-k 过小 | 关键块未入选，硬删除信息 | 增大 $k$、加 win 分支 |
| 仅 HCA 无 CSA | 全局糊、局部糊 | 保持层间交错 |
| 事实检索（数字/日期） | 压缩湮灭高频细节 | 加大 $m$ 或 win |

---

## 7. 参考文献

1. DeepSeek-AI. (2026). DeepSeek-V4 Technical Report. arXiv.
2. DeepSeek-AI. (2025). Native Sparse Attention. [arXiv:2502.11089](https://arxiv.org/abs/2502.11089).
3. Moonshot AI. (2025). Mixture of Block Attention. [arXiv:2502.13189](https://arxiv.org/abs/2502.13189).
4. DeepSeek-AI. (2024). DeepSeek-V2. [arXiv:2405.04434](https://arxiv.org/abs/2405.04434).
