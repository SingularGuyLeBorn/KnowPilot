---
title: "Gemma-1 Multi-Query Attention 深度解析"
---

# Gemma-1 Multi-Query Attention 深度解析

> 🔙 **[返回 14.10-Gemma 家族总览](../../14.10-Gemma.md)**


> 原文定位: Gemma-1 技术报告第 2 节 "Model Architecture"
> 关联文档: `01-Gemma-1技术报告精译.md` 第 2 节; `04-Gemma-1-mineru-zh.md` 第 2 节译者注

---

## 1 问题背景: KV Cache 的内存瓶颈

Transformer 解码器在自回归生成过程中, 为了避免重复计算, 通常将历史 token 的 Key 和 Value 张量缓存起来, 称为 KV Cache. 对于标准的多头注意力(Multi-Head Attention, MHA), 设:

- 批大小为 b
- 序列长度为 s
- 注意力头数为 h
- 每个头的维度为 d_h
- 层数为 L

则每层 KV Cache 的显存占用为:

```
Memory_KV = 2 * b * s * h * d_h * sizeof(dtype)
```

其中因子 2 对应 Key 和 Value 两个张量. 以 Gemma-1 7B 模型为例:
- h = 16, d_h = 256, L = 28
- 在 FP16 下, 每层 KV Cache = 2 * 1 * s * 16 * 256 * 2 = 16,384 * s bytes
- 28 层总计 = 458,752 * s bytes ≈ 0.44 * s MB

对于 8192 的上下文长度, 7B 模型的 KV Cache 约为 3.6GB——这几乎与模型权重本身(7B * 2B = 14GB FP16)相当. 对于端侧部署(手机、嵌入式设备), 这一内存开销是不可接受的.

> 思考节点: KV Cache 内存问题是端侧大模型部署的核心瓶颈, 而非计算量. 训练时的 FLOPs 与推理时的内存占用是两个独立的优化目标. Gemma-1 的 2B 模型专为"CPU 和端侧应用"设计, 这意味着推理内存比训练效率更重要. Google 因此选择了牺牲一定表达能力来换取内存效率的架构方案.

---

## 2 原理: 从 MHA 到 MQA

### 2.1 标准多头注意力 (MHA)

标准 Transformer 中, 每个注意力头 i 独立计算其 Query、Key、Value:

```
Q_i = X * W_Q_i    (shape: [b, s, d_h])
K_i = X * W_K_i    (shape: [b, s, d_h])
V_i = X * W_V_i    (shape: [b, s, d_h])

Attention_i = softmax(Q_i * K_i^T / sqrt(d_h)) * V_i
```

所有 h 个头的输出拼接后通过线性投影:

```
Output = Concat(Attention_1, ..., Attention_h) * W_O
```

MHA 的优势是表达能力: 每个头可以独立关注不同的语义子空间. 但代价是 KV Cache 与头数 h 成正比.

### 2.2 多查询注意力 (MQA)

MQA(Shazeer, 2019)的核心思想是: 让所有注意力头共享同一组 Key 和 Value, 仅保留独立的 Query 投影:

```
Q_i = X * W_Q_i    (shape: [b, s, d_h])  -- 每个头独立
K   = X * W_K      (shape: [b, s, d_h])  -- 所有头共享
V   = X * W_V      (shape: [b, s, d_h])  -- 所有头共享

Attention_i = softmax(Q_i * K^T / sqrt(d_h)) * V
```

KV Cache 内存从 `2 * b * s * h * d_h` 降低到 `2 * b * s * d_h`, 即减少了 h 倍.

以 Gemma-1 2B 模型为例:
- h = 8, d_h = 256, L = 18
- MQA 每层 KV Cache = 2 * 1 * s * 1 * 256 * 2 = 1,024 * s bytes
- 18 层总计 = 18,432 * s bytes ≈ 0.018 * s MB

对于 8192 上下文, 2B 模型的 KV Cache 仅为约 150MB——相比同等参数规模的 MHA 方案(约 1.2GB)减少了 8 倍.

### 2.3 数学等价性分析

MQA 可以视为 MHA 的一种结构化约束: 强制所有头的 K 和 V 投影矩阵相同. 从信息论角度, MHA 的 KV 总参数量为 `2 * h * d_model * d_h`, 而 MQA 为 `2 * d_model * d_h`, 即减少了 h 倍.

这种约束的直观解释是: 单个共享的 KV 表示需要编码所有注意力头所需的信息. 如果不同头关注的信息子空间高度正交, 这种共享会造成信息瓶颈; 但如果子空间之间存在冗余(经验上通常如此), 共享带来的损失有限.

---

## 3 Gemma-1 的设计动机

### 3.1 规模依赖的架构选择

Gemma-1 采用了**规模依赖的注意力策略**:

| 模型 | 注意力类型 | num_kv_heads | 设计理由 |
|---|---|---|---|
| 2B | MQA | 1 | 端侧内存约束优先 |
| 7B | MHA | 16 | 表达能力优先 |

Google 明确说明这一选择"基于消融实验表明多查询注意力在小规模上表现良好". 这暗示了一个关键的规模阈值效应: 当模型容量足够大时(7B), MHA 的表达能力优势超过了 MQA 的内存优势; 但当模型需要极度压缩时(2B), MQA 的质量损失在可接受范围内.

> 思考节点: 这一"规模阈值"的存在说明架构选择不是绝对的, 而是与部署约束和模型容量共同决定. 后续 Gemma-2 统一采用 GQA(分组查询注意力, num_kv_heads = num_heads / 2), 表明 Google 认为 GQA 是在 2B-27B 范围内更优的通用解. GQA 可以视为 MHA 和 MQA 之间的连续谱, 通过调整 num_kv_heads 来平衡内存和表达能力.

### 3.2 端侧部署的工程约束

Gemma-1 2B 模型的目标场景明确为"CPU 和端侧应用". 在这一场景下:

1. **内存是首要约束**: 手机通常只有 4-12GB RAM, 需要为操作系统和其他应用保留空间
2. **延迟敏感度**: 端侧用户期望近乎即时的响应, KV Cache 的内存带宽成为瓶颈
3. **功耗限制**: 移动设备的散热和电池限制了持续高负载计算

MQA 同时缓解了这三个约束: 更小的 KV Cache 减少内存占用和带宽压力, 更低参数量的注意力层也减少了计算量.

---

## 4 同类对比: MHA vs. MQA vs. GQA

| 维度 | MHA | MQA | GQA |
|---|---|---|---|
| KV Cache 内存 | O(h) | O(1) | O(g) |
| 表达能力 | 最强 | 最弱 | 中等 |
| 训练稳定性 | 标准 | 需调整 | 中等 |
| 推理吞吐量 | 低 | 高 | 中-高 |
| 代表模型 | Gemma-1 7B, LLaMA-2 | Gemma-1 2B, PaLM | Gemma-2, LLaMA-3, Mistral |

其中 g 为 KV 组数, GQA 中 `1 < g < h`. GQA(Ainslie et al., 2023)将 h 个查询头分为 g 组, 每组共享一组 KV, 是 MHA 和 MQA 的连续插值.

### 4.1 与 PaLM 的对比

PaLM(Chowdhery et al., 2022)是 MQA 的早期采用者之一, 在 540B 规模上使用了 MQA. 这一选择在当时引发讨论: 为什么最大的模型反而使用最"压缩"的注意力? 答案是 PaLM 的训练目标是最大化训练吞吐量(TPU pod 上的 FLOPs 利用率), 而非推理效率. MQA 减少了参数通信量, 在大规模分布式训练中提升了效率.

Gemma-1 2B 使用 MQA 的动机则完全不同: 推理内存约束而非训练效率. 同一架构选择, 不同优化目标.

### 4.2 与 LLaMA-2/3 的对比

LLaMA-2(Touvron et al., 2023b)在所有规模上坚持使用 MHA, 未采用 MQA 或 GQA. LLaMA-3(Dubey et al., 2024)则全面转向 GQA. 这一演进表明 Meta 的立场变化: 从"表达能力优先"到"推理效率优先".

Gemma-1 的 2B-MQA/7B-MHA 混合策略可以视为这一演进的中间态——Google 在 2024 年初已经意识到推理效率的重要性, 但尚未找到统一方案(GQA), 因此采用了规模依赖的折中.

### 4.3 与 Mistral 的对比

Mistral-7B(Jiang et al., 2023)使用 GQA(8 KV heads, 32 query heads), 是 GQA 的早期推广者之一. Mistral 的 GQA 配置(g=8)与 Gemma-2 的 GQA 类似, 表明 1/4 到 1/2 的 KV 压缩率在 7B 规模上是经验最优的.

---

## 5 工程实现细节

### 5.1 缓存布局优化

MQA 的 KV Cache 布局与 MHA 不同. 在 MHA 中, K 和 V 通常按 `[batch, heads, seq, head_dim]` 布局; 在 MQA 中, 可以简化为 `[batch, seq, head_dim]`, 省略 heads 维度.

这种简化带来的额外好处:
- **内存连续性**: 更紧凑的布局提高了缓存命中率
- **注意力计算简化**: 无需在每个头间重复加载共享的 K/V
- **批处理效率**: 小 batch 时内存碎片更少

### 5.2 与 FlashAttention 的兼容性

FlashAttention(Dao et al., 2022)通过分块计算和 SRAM 优化减少 HBM 访问. MQA 与 FlashAttention 天然兼容: 共享的 K/V 可以在分块计算中只加载一次, 进一步减少内存带宽.

在 Gemma-1 2B 的推理中, MQA + FlashAttention 的组合可以实现:
- 序列长度线性扩展(而非二次方)
- 接近计算瓶颈的理论最大吞吐量
- 端侧设备上的实时交互体验

---

## 6 局限与风险

### 6.1 表达能力损失

MQA 的结构性约束限制了注意力机制的表达能力. 在需要多头协作的复杂任务(如多步推理、跨文档信息整合)上, MQA 模型的性能可能显著低于同等规模的 MHA 模型.

Gemma-1 2B 在 MATH 基准上仅 11.8%, 而 7B(MHA)达到 24.3%——这一差距(超过 2 倍)不能完全用参数规模解释(7B 是 2B 的 3.5 倍, 但 MATH 提升超过 2 倍), 暗示 MQA 可能限制了数学推理能力.

### 6.2 长上下文退化

虽然 MQA 减少了 KV Cache 内存, 但长上下文下的注意力质量仍可能退化. 共享的 K/V 需要编码整个长序列的信息, 当序列长度超过训练时的分布时, 注意力权重可能变得扁平化, 导致"注意力消散".

### 6.3 与后续架构的不兼容

Gemma-1 的 MQA 是一个过渡性方案. 从 Gemma-2 开始, Google 全面采用 GQA, 这意味着:
- Gemma-1 2B 的 MQA 权重无法直接迁移到 GQA 架构
- 针对 MQA 优化的推理代码需要为 GQA 重写
- 社区基于 Gemma-1 2B 的微调和适配工作需要考虑这一架构特殊性

---

## 7 技术谱系与影响

MQA 的思想起源于 Shazeer(2019), 最初是为了加速 Transformer 解码器的推理. 其发展路径如下:

```
2019: MQA 提出 (Shazeer)
  |
2022: PaLM 540B 采用 MQA (Chowdhery et al.)
  |
2023: GQA 提出, 作为 MHA-MQA 的连续插值 (Ainslie et al.)
  |
2024.02: Gemma-1 2B 采用 MQA, 7B 保留 MHA
  |
2024.06: Gemma-2 全面采用 GQA (2B-27B)
  |
2024+: MQA 逐渐被 GQA 取代, 但在极端压缩场景(如 1B 以下)仍有价值
```

MQA 的遗产在于它首次系统性地证明了"注意力头的 KV 共享"是可行的, 为 GQA 和后续的 KV Cache 压缩方法(如 KV Cache 量化、动态缓存驱逐)开辟了道路.

---

## 8 结论

Multi-Query Attention 是 Gemma-1 2B 模型的核心架构创新, 也是 Google 在端侧大模型部署上的首次系统尝试. 它通过让所有注意力头共享 K/V 投影, 将 KV Cache 内存降低到头数的倒数倍, 使 2B 模型能够在消费级 CPU 上高效运行.

然而, MQA 的表达能力损失在复杂推理任务上表现明显, 且与后续 GQA 方案相比, 其压缩效率-质量权衡并非最优. Gemma-1 的 MQA 可以视为大模型架构从"训练优先"向"推理优先"转变过程中的一个关键实验节点——它验证了端侧部署的可行性, 同时也揭示了需要更精细的折中方案(GQA), 从而直接影响了 Gemma-2 及整个行业的架构演进.

---

> **知识库同步**
>
> 本文档同步至: `docs/guide/llm/attention/mqa-gemma1.md`
> 本文档来源: `docs/sections/llm-guide/14-主流开源模型全景解析与技术报告精读/14.10-Gemma/01-Gemma-1/05-Gemma-1-Multi-Query-Attention.md`
