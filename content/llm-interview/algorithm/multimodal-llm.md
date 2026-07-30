---
title: "多模态大模型（MLLM）面试题"
category: null
tags:
  - "多模态"
  - "MLLM"
  - "CLIP"
  - "Qwen-VL"
  - "LLaVA"
  - "BLIP"
  - "Q-Former"
published: true
excerpt: null
---
# 多模态大模型（MLLM）面试题

> ⚠️ **时效性说明**：多模态大模型是 2025-2026 面试增长最快的方向之一。CLIP/LLaVA 为基础必问，Qwen-VL、BLIP-2 为进阶重点，视频理解与生成（Sora 等）为 2026 新题。
>
> **来源**：知乎「大模型面试118题」、CSDN 多模态面试题汇总、图解大模型200问、牛客面经

---

## 1. 多模态大模型的常见架构对比（CLIP / Flamingo / LLaVA / Qwen-VL）

- **元数据**：`{topic: "多模态·架构", quality: ⭐⭐⭐⭐⭐, year: "2025-2026", difficulty: mid}`
- **来源**：知乎118题、CSDN 面试题

**核心考点**：面试官常要求对比主流架构设计思路。

| 模型 | 架构类型 | 视觉-语言连接方式 | 特点 |
|---|---|---|---|
| **CLIP** | 双编码器 | 对比学习（无跨注意力） | 图文匹配、零样本分类 |
| **Flamingo** | 编码器-解码器 | Perceiver Resampler + GATED XATTN-DENSE | 冻结 LLM，few-shot 能力强 |
| **LLaVA** | 编码器-LLM | 简单 MLP Projector | 训练高效，两阶段训练 |
| **Qwen-VL** | 编码器-LLM | MLP + 位置感知适配器（ViT-bigG） | 多图推理、文本阅读与定位 |

**追问**：「LLaVA 为什么只用 MLP 连接？」→ 作者发现视觉特征与语言嵌入的"对齐"不需要复杂结构，一个线性层足够，大幅降低训练成本。

> ✅ **时效判断**：2025-2026 高频基础题，几乎所有多模态面试都会问。

---

## 2. Vision Encoder 与 LLM 的连接方式对比

- **元数据**：`{topic: "多模态·连接器", quality: ⭐⭐⭐⭐⭐, year: "2025-2026", difficulty: senior}`
- **来源**：知乎118题、CSDN 面试题

**三种主流方案**：

### 2.1 MLP Projector（线性投影）
最简单，将视觉特征通过 MLP 映射到 LLM 的 embedding 空间。LLaVA 使用。
- 优点：参数量少，训练快
- 缺点：表达能力有限

### 2.2 Q-Former（Query Transformer）
BLIP-2 提出，用可学习的 query 向量通过 Cross-Attention 从视觉特征中提取信息。
- 优点：更灵活，能压缩视觉信息
- 缺点：结构复杂，训练开销大

### 2.3 Cross-Attention
在 LLM 的 Transformer Block 中插入 Cross-Attention 层，直接关注视觉特征。Flamingo 使用。
- 优点：信息传递充分
- 缺点：需要修改 LLM 架构，对已有模型不友好

**追问**：「如果选一个方案做生产部署你选哪个？」→ MLP Projector。简单、兼容性好、并且 LLaVA 等开源模型已经验证了效果。

> ✅ **时效判断**：2025-2026 进阶题，在需要深入多模态面试中高频出现。

---

## 3. CLIP 的双塔架构与对比学习训练目标详解

- **元数据**：`{topic: "多模态·预训练", quality: ⭐⭐⭐⭐, year: "经典题·持续有效", difficulty: mid}`
- **来源**：CSDN 面试题、CLIP 论文

**架构**：双编码器 — 图像编码器（ViT/ResNet）+ 文本编码器（Transformer）。

**训练目标**（InfoNCE Contrastive Loss）：

$$
\mathcal{L} = -\log \frac{\exp(\mathrm{sim}(I,T)/\tau)}{\sum_{j=1}^{N} \exp(\mathrm{sim}(I,T_j)/\tau)}
$$

最大化配对图像-文本的余弦相似度，最小化负样本相似度。

**关键能力**：
- 零样本分类：通过文本提示（如"狗的照片"）直接分类图像，无需微调
- 跨模态检索：图文互搜

**局限性**：CLIP 不是生成式模型，不能直接做图像描述。

> ✅ **时效判断**：经典题，持续有效。CLIP 作为多模态基础模型，面经常问。

---

## 4. 多模态模型的训练策略：预训练对齐 → 多模态 SFT → RLHF-V

- **元数据**：`{topic: "多模态·训练", quality: ⭐⭐⭐⭐, year: "2025-2026", difficulty: senior}`
- **来源**：知乎118题、图解大模型200问

**三阶段流程**：

| 阶段 | 目标 | 数据 | 方法 |
|---|---|---|---|
| **预训练对齐** | 对齐视觉与语言表示 | 海量图文对（如 LAION-5B） | Contrastive Loss / LM Loss |
| **多模态 SFT** | 遵循图文混合指令 | 多模态指令数据（LLaVA-Instruct） | 监督微调 |
| **RLHF-V** | 视觉任务偏好对齐 | 多模态偏好数据 | PPO / DPO 扩展到视觉域 |

**追问**：「多模态预训练阶段为什么比纯文本预训练更复杂？」→ 需要同时处理视觉编码器和连接模块的梯度，且"图文对齐"没有单一正确答案（一图胜千言），对比学习比 NTP 更合适。

> ✅ **时效判断**：2025-2026 进阶题，常与纯文本 RLHF 对比。

---

## 5. BLIP-2 的 Q-Former 如何工作？与 LLaVA 的 MLP 有什么区别？

- **元数据**：`{topic: "多模态·BLIP", quality: ⭐⭐⭐⭐, year: "2025-2026", difficulty: senior}`
- **来源**：CSDN 面试题、图解大模型200问

**Q-Former 核心设计**：
- 可学习的 $N$ 个 query 向量（如 32 个）
- 每个 query 通过 Cross-Attention 从视觉编码器的输出中"提取"信息
- 输出固定长度的视觉 token 序列供 LLM 使用

**与 MLP 的区别**：
- Q-Former 能主动"查询"视觉信息，MLP 只是被动映射
- Q-Former 有信息压缩能力（$N$ 个 query 可远小于视觉 token 数）
- 但 Q-Former 参数量大，训练复杂

**追问**：「Q-Former 中 query 是怎么初始化的？为什么能学到有用的视觉特征？」→ query 是随机初始化的可学习参数，通过 Language Modeling Loss 反向传播，迫使 query 学会提取对文本生成有用的视觉信息。

> ✅ **时效判断**：2025-2026 进阶题。

---

## 来源汇总

- 知乎「大模型面试118题（十八）：多模态架构」— 多模态架构对比、连接器、训练策略
- CSDN「大模型与多模态方向高频面试题及详解」— CLIP、LoRA、模型对比
- 01.me「图解大模型面试题200问」— 多模态整体题库
- 牛客面经「淘天多模态大模型面经」— 真实面试流程
- CLIP / BLIP-2 / LLaVA 论文

**🔍 下次搜索关键词**：Sora DiT 架构面试题、视频理解模型 Video-LLaMA 细节、多模态 RLHF 数据构造方法

