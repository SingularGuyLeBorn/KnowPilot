# Ling 2.5 技术报告精译

>  **[返回 14.16-Ling 家族总览](../../14.16-Ling.md)**


> **来源**: Inclusion AI 官方博客、HuggingFace Model Card、技术社区分析  
> **发布日期**: 2026-02-17  
> **模型**: [Ling-2.5-1T](https://huggingface.co/inclusionAI/Ling-2.5-1T) | [Ring-2.5-1T](https://huggingface.co/inclusionAI/Ring-2.5-1T)  
> **系列定位**: 面向通用智能体(General Agent)时代的万亿参数混合线性注意力架构

---

## 一、模型概览与定位

Ling 2.5 是 Inclusion AI 在 Ling 2.0 基础上的**架构升级版本**，核心目标是从"推理导向基座"进化为"智能体时代基础设施"。随着通用智能体(General Agent)逐步成为大模型的核心应用形态，**深度推理能力**与**超长上下文建模能力**成为新代模型的关键指标。这对模型在长视野推理解码阶段的**吞吐效率、显存占用与时延稳定性**提出了远高于以往的要求。

Ling 2.5 包含两个变体：

| 模型 | 类型 | 总参数 | 激活参数 | 核心特色 |
|------|------|--------|---------|---------|
| **Ling-2.5-1T** | Instruct(非思考) | 1T | ~63B | 混合线性注意力，长上下文高效推理 |
| **Ring-2.5-1T** | Thinking(思考) | 1T | ~63B | 全球首个基于混合线性架构的万亿参数推理模型 |

> **命名说明**: "Ring" 系列是 Ling 家族的思考型(thinking)变体，与 Ling 系列的非思考型(non-thinking/instruct)形成互补。Ring-2.5-1T 是全球首个基于混合线性架构的万亿参数推理模型。

---

## 二、核心架构创新：混合线性注意力(Hybrid Linear Attention)

### 2.1 架构演进路线

Ling 2.5 并非从零训练，而是在已训练好的 **Ling-2.0-1T** 基础上，通过**增量式结构迁移**完成架构升级：

```
Ling 2.0 (GQA + MoE) 
    ↓ 增量训练 Stage A
Ling 2.5 Stage A (Lightning Attention + GQA 混合)
    ↓ 增量训练 Stage B (线性 warmup)
Ling 2.5 Stage B (稳定过渡)
    ↓ 增量训练 Stage C (GQA → MLA 转换)
Ling 2.5 Stage C (MLA + Lightning 混合)
    ↓ 全参数训练 Stage D
Ling 2.5 Final (1:7 MLA + Lightning Linear)
```

### 2.2 1:7 混合比例设计

Ling 2.5 的核心创新是将 Ling 2.0 的 GQA(Grouped Query Attention)注意力机制升级为 **MLA + Lightning Linear 按 1:7 比例混合** 的结构：

- **1 层 MLA(Multi-head Latent Attention)**：承担精确检索和长程依赖建模，保留传统 attention 的表达能力
- **7 层 Lightning Linear Attention**：承担高吞吐解码路径，以接近线性的时间复杂度处理长序列

**为什么 1:7？** 这一比例基于 Inclusion AI 此前发布的 **Ring-Flash-Linear-2.0** 技术路线中的大量实验验证。其核心权衡是：

| 维度 | 纯 MLA | 纯 Lightning Linear | 1:7 混合 |
|------|--------|---------------------|---------|
| 表达能力 | 强 | 较弱 | 强(MLA 层补偿)|
| 长序列吞吐 | 中等 | 极高 | 高 |
| KV Cache 占用 | 中等 | 极低 | 低 |
| 训练稳定性 | 高 | 中等 | 高(渐进迁移)|

> **与 Qwen3.5 / Kimi Linear 的对比**：Ling 2.5、Qwen3.5 和 Kimi Linear 都属于"线性注意力混合架构"这一新兴范式，但三者在"轻量侧"和"重量侧"的选择不同：
> - Qwen3.5：Gated DeltaNet + Gated Attention
> - Kimi Linear：Kimi Delta Attention(Gated DeltaNet 改进)+ Gated MLA
> - **Ling 2.5**：Lightning Attention + MLA(来自 DeepSeek)

### 2.3 Lightning Linear Attention

Lightning Attention 是 Ling 2.5 在"轻量侧"采用的具体机制。它是一种**循环线性注意力变体**(recurrent linear attention variant)，比 Gated DeltaNet 更简单，但在长序列上仍能保持极高的计算效率。

线性注意力的核心思想是将标准 attention 的 softmax 替换为核函数点积，使注意力计算从 $O(n^2)$ 降至 $O(n)$：

$$
\text{Standard Attention: } O(n^2 \cdot d) \quad \rightarrow \quad \text{Linear Attention: } O(n \cdot d^2)
$$

对于长序列($n \gg d$)，线性注意力的优势极为显著。

### 2.4 MLA 的引入与适配

Ling 2.5 在"重量侧"采用 DeepSeek 提出的 MLA(Multi-head Latent Attention)机制，以进一步压缩 KV Cache：

**从 GQA 到 MLA 的转换挑战**：

1. **QK Norm 非线性**：Ling 2.0 引入的 QKNorm 会阻碍 MLA 推理阶段的高效 KV absorption。解决方案：通过采样校准将 QKNorm 吸收到 q_proj / k_proj 权重中。

2. **Partial RoPE 不兼容**：Ling 2.0 使用的 Partial RoPE(仅前 64 维应用位置编码)与 Full RoPE 假设的转换方法不兼容。解决方案：仅对 RoPE 相关维度进行操作，然后重新组合。

**转换效果**：在 Ling-mini/flash 规模上的消融实验表明，转换并持续训练后，性能快速恢复并可超越 GQA 基线。

### 2.5 长上下文能力

Ling 2.5 的上下文窗口从 Ling 2.0 的 128K 扩展到 **256K → 1M tokens**。混合线性注意力架构在这一尺度上的优势尤为明显：

- 在 **32K tokens** 序列长度下，Ling-2.5-1T 的吞吐量比同规模(1T 参数)的 Kimi-K2 高 **3.5 倍**
- KV Cache 资源消耗大幅降低，使长文本推理的显存压力显著缓解

---

## 三、训练策略：增量式结构迁移

### 3.1 四阶段迁移流程

**Stage A: GQA → Lightning Attention + GQA 混合**
- 扩展 linear_qkv 的头维度
- 初始化新引入的门控参数
- 早期过渡阶段保留 QK Norm 和 Partial RoPE 以确保稳定性

**Stage B: 线性 Warmup**
- 冻结大部分参数，仅解冻 attention 关键转换部分
- 使用 LR warmup + 有限持续训练快速恢复转换前的 loss 水平

**Stage C: GQA → MLA 转换**
- 通过采样校准将 QK Norm 吸收到 q_proj / k_proj
- 应用 Partial-RoPE 兼容的转换
- 短 warmup 恢复临时 PPL 增长

**Stage D: 全参数训练**
- 确认稳定性后解冻所有参数
- 在目标规模下继续全量训练

### 3.2 训练规模

Ling 2.5 的总训练数据量达到 **29T tokens**，超越 Ling 2.0 的 20T tokens。

---

## 四、模型表现与效率分析

### 4.1 效率对比

| 模型 | 规模 | 32K 吞吐(相对)| 上下文长度 | 架构 |
|------|------|----------------|-----------|------|
| Kimi-K2 | 1T | 1.0× (baseline) | 128K | Dense + MLA |
| **Ling-2.5-1T** | **1T** | **3.5×** | **256K→1M** | **MoE + MLA + Lightning** |
| Qwen3.5 | ~235B | ~2.0× (估计) | 128K→1M | Dense/MoE + Gated DeltaNet |

> **注**：3.5× 吞吐量提升来自 Ling 2.5 官方 model hub 页面报告，在相同 1T 参数规模下对比。

### 4.2 定位说明

Ling 2.5 的绝对 benchmark 性能并非其首要卖点。Sebastian Raschka 的技术分析指出：

> "Ling 2.5 is not the strongest model in terms of absolute benchmark performance, but its selling point is very good efficiency in long contexts (due to the hybrid attention)."

换言之，Ling 2.5 选择了一条与 DeepSeek-V3(追求精度)和 Kimi-K2(追求 Agent 能力)不同的路线——**追求长上下文场景下的极致效率**。

---

## 五、智能体能力

Ling 2.5 面向 General Agent 时代设计，在以下 Agent 相关能力上进行了重点优化：

- **长视野推理**：支持多轮思考、长程规划和复杂任务分解
- **工具调用**：与主流 Agent 框架(如 OpenClaw、CodeBuddy)兼容
- **代码生成**：继承 Ling 2.0 的代码推理优势，在长代码上下文中保持高效

---

## 六、开源策略

Ling 2.5 采用**全系列开源**策略：
- Ling-2.5-1T 和 Ring-2.5-1T 的权重和代码均已开源
- HuggingFace 模型卡提供详细的技术规格和使用说明
- 与 Ling 2.0 一样，遵循开放的许可协议

---

## 七、技术谱系与演进逻辑

| 代际 | 时间 | 核心架构 | 关键创新 | 定位 |
|------|------|---------|---------|------|
| Ling-Lite/Plus | 2025-03 | MoE + GQA | EDiT 异步训练、跨平台对齐 | 普惠训练 |
| Ling 2.0 | 2025-10 | MoE + GQA + MTP | Evo-CoT、LPO、FP8 全训练 | 推理导向基座 |
| **Ling 2.5** | **2026-02** | **MoE + MLA + Lightning** | **混合线性注意力、增量迁移** | **Agent 时代基础设施** |

Ling 2.5 的演进逻辑清晰：在保持 MoE 稀疏激活优势的同时，将注意力机制从 $O(n^2)$ 的 GQA 升级为 $O(n)$ 的混合线性架构，以应对 Agent 时代长上下文、多轮交互的核心需求。这不是对 Ling 2.0 的否定，而是**面向新应用场景的架构适配**。

---

## 八、关键数据速查

| 指标 | 数值 |
|------|------|
| 总参数 | 1T |
| 激活参数 | ~63B |
| 注意力混合比例 | 1:7 (MLA : Lightning Linear) |
| 上下文窗口 | 256K → 1M |
| 训练数据 | 29T tokens |
| 32K 吞吐提升 | 3.5× (vs Kimi-K2) |
| 发布日期 | 2026-02-17 |
| 开源策略 | 全系列开源 |
