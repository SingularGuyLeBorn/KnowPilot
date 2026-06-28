---
title: "04 · Radial Attention：O(n log n) 复杂度的稀疏注意力"
date: 2026-05-24
tags: [Radial Attention, 稀疏注意力, 视频生成, DiT, 能量衰减, 时空稀疏性]
---

# Radial Attention：O(n log n) 复杂度的稀疏注意力

> 本文介绍 MIT HAN Lab 提出的 Radial Attention（[arXiv:2506.19852](https://arxiv.org/abs/2506.19852)），通过时空能量衰减现象设计径向稀疏掩码，将视频 DiT 的注意力复杂度从 $O(n^2)$ 降低到 $O(n \log n)$。  
> 系列索引：[2.3.2 稀疏与压缩注意力](../2.3.2-稀疏与压缩注意力.md) · [2.3 进度](../roadmap/进度.md)

![Radial Attention 在 HunyuanVideo 上的加速与画质（论文 Figure 1）](./images/fig-radial-01-teaser-hunyuan-speedup.jpg)

> 图 1: 默认长度 1.9× 推理加速、4× 外推长度下 4.4× 降训练成本与 3.7× 推理加速（论文 Figure 1）。

**图 1 解析**

- **左/上**：Dense vs Radial 同 prompt 视频帧 — 视觉质量相当，延迟显著下降。
- **117 帧默认长度**：HunyuanVideo 上约 **1.9×** 端到端加速（PSNR 仍 ~27）。
- **509 帧 4× 外推**：Radial + LoRA 的 Vision Reward **不低于** Dense+LoRA，且 GPU 小时与延迟双降。
- **赛道**：视频扩散 **3D Full Attention**，非文本 LLM；与 MoBA/NSA 方法论同属「稀疏掩码」但目标模态不同。
- **工程**：静态掩码 + 轻量 LoRA 即可外推长度，无需全量重训。

---

## 1. 背景：视频 DiT 的注意力瓶颈

### 1.1 3D Full Attention 的代价

视频扩散模型通过 3D Full Attention 捕捉时空关联性。以 HunyuanVideo 为例：

- 帧时长 33 × 宽高 3600 + 文本 226 ≈ **~120k 序列长度**
- Attention 占端到端耗时的 **82%**

### 1.2 稀疏注意力的两种路线

- **静态方法**（如 STA）：预定义稀疏模式，表达能力有限
- **动态方法**（如 SVG）：按 head 在线 profiling 选空间/时间掩码，推理可加速但 **长视频训练易误分类、难外推**

![SVG 动态 profiling vs Radial 静态统一掩码（论文 Figure 3）](./images/fig-radial-03-svg-vs-radial-pipeline.jpg)

> 图 2: SVG 每 head 二选一空间/时间稀疏；Radial 用单一静态 $O(n\log n)$ 掩码统一二者（论文 Figure 3）。

**图 2 解析**

- **SVG (a)**：推理时 profiling → 空间 **或** 时间 attention，无法覆盖训练分布外的更长视频。
- **Radial (b)**：静态径向掩码同时编码时空衰减，**可 LoRA 微调外推**。
- **复杂度**：二者均可做到次二次方，但 Radial 的掩码由物理衰减模型导出，非纯启发式窗口。
- **与 2.3.2 其他篇关系**：MoBA/NSA 是 **LLM token 路由**；Radial 是 **视频 DiT 帧-空间块掩码**。
- **实现**：均可用 128×128 块稀疏 + FlashAttention 类内核。

---

## 2. 核心洞察：时空能量衰减

### 2.1 现象观察

在视频扩散模型的 Attention Map 中，注意力分数随 token 之间**空间和时间距离**增大而减弱，作者称为 **Spatiotemporal Energy Decay（时空能量衰减）**。

### 2.2 两种注意力模态

| 模态 | 特征 | 衰减特性 |
|:-----|:-----|:--------|
| **空间注意力** | 主要关注同帧或相邻帧附近 token | 高时间衰减、低空间衰减 |
| **时间注意力** | 主要关注跨帧同空间位置 | 低时间衰减、高空间衰减 |

![HunyuanVideo 上空间/时间 attention map 与衰减曲线（论文 Figure 4）](./images/fig-radial-04-spatiotemporal-energy-decay.jpg)

> 图 3: 空间 head 随时间距离快速衰减；时间 head 随空间距离衰减更明显（论文 Figure 4）。

**图 3 解析**

- **(a)**：从 HunyuanVideo 抽样的 post-softmax map — 左偏空间局部、右偏时间对齐。
- **(b1)**：同空间位置、时间距增大 → 分数指数下降。
- **(b2)**：同帧内、空间距增大 → 同样衰减，曲线可拟合 $R^2>0.98$。
- **设计含义**：应用 **统一径向掩码**，而非 SVG 式硬拆 head 类型。
- **参数 $\alpha,\beta$**：分别控制时间/空间衰减率，高 $\beta$ 低 $\alpha$ 偏空间局部。

### 2.3 指数衰减模型

对于第 $i_0$ 帧、空间位置 $k_0$ 的 query，注意力分数满足：

$$
p(i, k) \propto \exp(-\alpha |i - i_0| - \beta |k - k_0|) \tag{1}
$$

---

## 3. Radial Attention 设计

### 3.1 时间维度的密度衰减

- 帧 $i,j$ 间计算密度：$(1/2)^{\lfloor \log_2(\max(|i-j|, 1)) \rfloor}$
- 中心带（band 0）100% 密度；向外每带密度减半、带宽倍增（band ±1 除外）
- 每带总计算量近似 **常数** → 总长 $n$ 时总和 $O(n\log n)$

### 3.2 空间维度的密度衰减

- 帧 $i,j$ 块内对角线宽度：$\lfloor s / 2^{\lfloor \log_2 \max(|i-j|, 1) \rfloor} \rfloor$
- 宽度 $<1$ 时降低对角线频率（模运算抽稀），保持块内 FLOPs 下界

### 3.3 掩码与 Attention Sink

4D 掩码 $\widetilde{M} \in \{-\infty, 0\}^{f \times f \times s \times s}$，展平为 $M_{is+k,\,js+l}=\widetilde{M}_{i,j,k,l}$。

![径向带、掩码与 HunyuanVideo 实例（论文 Figure 5）](./images/fig-radial-05-radial-mask-bands.jpg)

> 图 4: 时间带密度减半 + 远帧空间对角线收窄；首帧 attention sink（论文 Figure 5）。

**图 4 解析**

- **(a)**：$f=12$ 示意 — 主对角 band 0 全密度，外带宽度×2、密度÷2。
- **(b)**：与 (a) 对应的 0/−∞ 二值掩码；远帧块仅保留稀疏对角。
- **(c)**：253 帧 720p HunyuanVideo 真实掩码 — 含 **首帧 sink**（全体 attend 帧 0）。
- **与 SVG**：中心带已含密空间交互；远帧不再浪费算力在低相关 token。
- **块大小 128×128**：与 FlashAttention 分块策略对齐。

### 3.4 Attention Sink

每个 token **关注第一帧**（与 StreamingLLM / SVG 的 sink 同类）；3D Causal VAE 常单独处理首帧。

---

## 4. 复杂度与误差

![长视频 attention 计算量与加速（论文 Figure 2）](./images/fig-radial-02-complexity-9x-speedup.jpg)

> 图 5: 509 帧 720p HunyuanVideo 上 attention 计算约 **9×** 减少、3.7× 加速（论文 Figure 2）。

**图 5 解析**

- 横轴序列长度/帧数增加时，Dense $O(n^2)$ 陡升，Radial 近 $O(n\log n)$ 斜率。
- **9×**：论文在 4× 长度设定下测得的 attention FLOPs 比（非端到端唯一指标）。
- $\ell_1$ 误差界：随 $\alpha,\beta$ 增大，掩码与全注意力分数差异 **指数缩小**。
- 相对 SVG：统一衰减 → 更小理论误差（论文 §4.2）。
- 实现：块稀疏 + FA2（论文用 FA2；换 FA3 为正交优化）。

---

## 5. 长视频 LoRA 与实验

### 5.1 动机与实现

- 预训练短视频模型 + Radial 掩码 → 权重大部分可保留
- **LoRA rank 128** 作用于 q/k/v/o；每扩展长度采样 2k 高质量视频
- HunyuanVideo 约 16–21 GPU·hour（8×H100）

### 5.2 定量结果（论文 Table 1–2 摘要）

| 指标 | Dense | Radial |
|:-----|:------|:-------|
| 视觉质量 (Vision Reward) | 基准 | **相当或略优** |
| PSNR/SSIM/LPIPS | 基准 | **优于 STA/PA，≈ SVG** |
| HunyuanVideo 端到端 | 1× | **~1.8×** |
| Wan2.1 端到端 | 1× | **~1.9×** |

![Wan2.1 默认长度生成对比（论文 Figure 6）](./images/fig-radial-06-wan21-video-quality.jpg)

> 图 6: Wan2.1-14B 上 Radial 与原版画质对齐（论文 Figure 6）。

**图 6 解析**

- Training-free 设定：不改权重，只换稀疏掩码 + 系统优化（与 SVG 同栈）。
- 相似度指标上优于 STA；STA 虽更快但画质掉点明显。
- PA 同为 $O(n\log n)$ 但忽略时空局部性 → 实践不如 Radial。

![HunyuanVideo 4× 长度外推视觉对比（论文 Figure 7）](./images/fig-radial-07-hunyuan-4x-extension.jpg)

> 图 7: 509 帧外推 — Radial+LoRA Vision Reward **≥** Dense+LoRA（论文 Figure 7）。

**图 7 解析**

- 4× 长度下 Dense 无微调明显退化；RIFLEx 外推有限。
- Radial+LoRA：**0.134 vs 0.133**（Vision Reward），且 **3.7×** 推理、**4.4×** 训练成本下降。
- 说明静态掩码 + 短 LoRA 即可 **外推长度** 而不毁分布。

![LoRA 有效性 & 衰减曲线拟合（论文 Figure 8）](./images/fig-radial-08-lora-effectiveness-decay-fit.jpg)

> 图 8: 长序列上 Radial+LoRA 可匹配全微调；$\exp(-ax+b)$ 拟合衰减 $R^2>0.985$（论文 Figure 8）。

**图 8 解析**

- **(a)**：帧数增加时 Radial+LoRA 的 Vision Reward 不低于 Dense 全量微调。
- **(b)**：实证曲线与式 (1) 指数模型一致 → 掩码设计有数据支撑而非纯画图。
- 可与 **风格 LoRA** 叠加做 4× 长度风格化（论文 §5.3）。
- 代码：[mit-han-lab/radial-attention](https://github.com/mit-han-lab/radial-attention)。

---

## 6. 与 SVG / STA 对比

| 特性 | Radial | SVG | STA |
|:-----|:-------|:----|:----|
| 复杂度 | **$O(n \log n)$** | $O(n \log n)$ | $O(n)$ |
| 时间衰减 |  指数 |  |  固定窗 |
| 空间衰减 |  对角收窄 |  固定模式 |  |
| 训练/外推 |  静态掩码 + LoRA | 推理 profiling |  |
| 误差 | **较小** | 中等 | 较大 |

Radial 将 **能量衰减** 转为 **计算密度衰减**，在质量与加速之间取得论文验证的平衡。

---

## 7. 为何在 LLM 圈较少听到？

面向 **视频 DiT（HunyuanVideo / Wan2.1 / Mochi）**，不是 Llama 长文本主线；2.3.2 收录是为对比 **稀疏掩码设计空间**（静态径向 vs 动态 SVG vs 块路由 MoBA）。

---

## 8. 参考文献

- Li, X., et al. (2025). Radial Attention: $\mathcal{O}(n\log n)$ Sparse Attention with Energy Decay for Long Video Generation. *arXiv:2506.19852*.
- 代码：https://github.com/mit-han-lab/radial-attention
