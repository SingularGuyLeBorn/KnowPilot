---
title: "GLM/ChatGLM 系列技术报告深度研读"
date: 2026-05-11
tags: []
---

# GLM/ChatGLM 系列技术报告深度研读

## 2. GLM 预训练框架

### 2.1 自回归空白填充的核心思想

GLM 的预训练目标可以概括为：对于输入文本 $\bm{x} = [x_1, x_2, ..., x_n]$，从中采样多个文本片段 $\{\bm{s}_1, \bm{s}_2, ..., \bm{s}_m\}$，每个片段 $\bm{s}_i$ 对应 $\bm{x}$ 中的一系列连续 token。每个片段被替换为一个单独的 [MASK] 符号，形成损坏的文本 $\bm{x}_{\text{corrupt}}$。模型以**自回归方式**从损坏的文本中预测缺失的词。

目标函数为：

$$\underset{\theta}{\text{max}} \; \mathbb{E}_{z \sim Z_m} \left[ \sum_{i=1}^{m} \log p_\theta(\bm{s}_{z_i} | \bm{x}_{\text{corrupt}}, \bm{s}_{z_{<i}}) \right] \tag{1} $$

其中 $Z_m$ 是所有可能的排列顺序的集合，片段顺序被随机打乱以捕捉不同片段之间的相互依赖关系。

### 2.2 二维位置编码

GLM 实现了独特的二维位置编码设计。每个 token 被赋予两个位置 ID：

- **Position 1(跨片段位置)** ：Part A 中的 token 取其在原始文本中的绝对位置; Part B 中的 token 取对应 [MASK] 在 Part A 中的位置
- **Position 2(片段内位置)** ：Part A 中的 token 均为 0; Part B 中的 token 从 1 开始在各自片段内递增

这种编码的关键意义在于：**模型在重建片段时无法预知被替换片段的长度**，从而必须学习真正的文本理解能力而非利用长度线索。

### 2.3 注意力掩码机制

GLM 的注意力掩码是其架构的核心创新。输入被分为两部分：

- **Part A(损坏的文本)** ：双向注意力——所有 token 彼此可见，但不能看到 Part B 中的任何 token
- **Part B(被遮盖的片段)** ：单向(因果)注意力——每个 token 可以看到 Part A 中的所有 token，以及 Part B 中之前已预测的 token，但不能看到 Part B 中未来的 token

这种设计使模型在 Part A 上表现为双向Encoder (类似 BERT)，在 Part B 上表现为单向Decoder  (类似 GPT)，从而在单一模型中实现了 encoder-decoder 架构的功能。

### 2.4 多任务预训练

通过改变被遮盖片段的长度和数量，GLM 能够针对不同类型的任务进行预训练：

- **文档级别(长跨度 50%~100%)** ：采样一个长片段，覆盖原始文本的 50% 到 100%，用于无条件生成
- **句子级别(短跨度 15%)** ：采样多个完整的句子片段，覆盖 15% 的 token，用于条件生成和 NLU

这种多任务设计使得 GLM 在三种任务上都能表现出色。

## 3. GLM 模型架构详解

### 3.1 基础架构

GLM 基于 Transformer 架构，但做了以下修改：

1. **层归一化**：采用 DeepNorm(Post Norm 的改进版)，解决了深层网络中的梯度不稳定性
2. **激活函数**：使用 GELU 替代 ReLU
3. **位置编码**：使用 RoPE(旋转位置编码)
4. **输出层**：使用单个线性层预测输出 token

### 3.2 GLMBlock 组成

每个 GLMBlock 包含：

1. **Layer Normalization** → **Self-Attention** → **残差连接**
2. **Layer Normalization** → **GLU(门控线性单元)** → **残差连接**

GLU 层首先将输入通过线性变换扩展到 4 倍维度，应用 GELU 激活函数，再压缩回原始维度。

### 3.3 预训练任务统一

GLM 将所有下游任务统一为生成式填空格式：

- **分类任务**：将输入 $x$ 构造成填空问题 $c(x)$，将模型生成的答案映射到标签 $y$
- **生成任务**：直接使用自回归生成方式
- **理解任务**：通过生成式回答完成理解

## 4. ChatGLM 系列的演进

### 4.1 ChatGLM-6B(初代)

ChatGLM-6B 基于 GLM 架构，参数量 62 亿，经过约 1T token 的中英双语预训练。它引入了以下技术：

1. **监督微调(SFT)** ：使用高质量对话数据微调
2. **反馈自助(RM)** ：训练奖励模型
3. **RLHF**：基于人类反馈的强化学习对齐
4. **P-Tuning v2 高效微调**：INT4 量化下仅需 7GB 显存即可微调

### 4.2 ChatGLM2-6B

ChatGLM2-6B 是第一代与第二代之间的分水岭，关键变化包括：

1. **从 GLM 架构转向 Decoder-Only 架构**：全新的注意力掩码设计，不再区分 Part A 和 Part B，完全使用因果注意力。这是最根本的架构变革。

2. **RoPE 替换二维位置编码**：虽然 GLM 的二维位置编码是原创贡献，但大势所趋，ChatGLM2 跟随主流使用了 RoPE
3. **FlashAttention 支持**：通过 FlashAttention 技术将上下文长度从 2K 扩展到 32K
4. **Multi-Query Attention(MQA)** ：Query 保持多头，Key 和 Value 共享单个头，通过 expand/repeat 填充到与 Query 相同维度。推理速度提升 42%。

5. **词表缩小**：从 150,528 缩小到 65,024，加载速度显著提升
6. **激活函数升级**：从 GELU 换为 SwiGLU(与 LLaMA 相同)

ChatGLM2 在 MMLU(+23%)、CEval(+33%)、GSM8K(+571%)等基准上相比初代取得大幅提升。

### 4.3 ChatGLM3-6B

**ChatGLM3 与 ChatGLM2 的模型架构完全一致**，没有架构层面的改进。主要变化在于训练数据和对齐策略的优化。

### 4.4 GLM-4

GLM-4 是智谱 AI 在 2024 年初发布的旗舰模型，整体性能相比 GLM-3 全面提升 60%，接近 GPT-4：

| 基准 | GLM-4 vs GPT-4 |
|:----|:---------------|
| MMLU | 94% |
| GSM8K | 95% |
| MATH | 91% |
| BBH | 99% |
| HellaSwag | 90% |
| HumanEval | 100% |

核心能力包括：

1. **128K 上下文**：在 LongBench(128K)和海量长文本测试中实现 100% 精准召回
2. **All Tools**：自动理解用户意图、规划复杂指令，自由调用网页浏览器、代码解释器、文生图模型：
   - **文生图**：CogView3 达到 DALLE 3 的 91.4%~99.3%
   - **代码解释器**：支持复杂方程、微积分等，在 GSM8K/MATH 接近 GPT-4 All Tools
   - **网页浏览**：准确率 78.08，为 GPT-4 All Tools 的 116%
   - **Function Call**：与 GPT-4 Turbo 相当
3. **多模态**：支持图像理解和生成

### 4.5 GLM-5(2025-2026)

GLM-5 系列延续了 ChatGLM2 开启的 decoder-only 架构路线，在模型规模、上下文长度和多模态能力上进一步提升。

架构总结对比：

| 特性 | ChatGLM-6B | ChatGLM2-6B | ChatGLM3-6B | GLM-4 |
|:----|:----------|:-----------|:-----------|:------|
| 架构 | GLM(双向+单向) | Decoder-Only | Decoder-Only | Decoder-Only |
| 位置编码 | 2D Position | RoPE | RoPE | RoPE |
| 注意力 | 标准 MHA | Multi-Query Attn | Multi-Query Attn | FlashAttention |
| 激活函数 | GELU | SwiGLU | SwiGLU | SwiGLU |
| 词表大小 | 150,528 | 65,024 | 65,024 | ~100K |
| 上下文 | 2K | 32K | 32K | 128K |

## 5. GLM 与主流架构对比

### 5.1 GLM vs GPT(Decoder-Only 路线)

GPT 系列采用纯自回归方式，只能从左到右单向编码。GLM 初代通过自回归空白填充实现了双向编码，在 NLU 任务上具有天然优势。但 ChatGLM2 之后的版本也转向了 Decoder-Only 架构，表明**在大规模参数下，Decoder-Only 的简洁性和可扩展性最终胜出**。

GLM 初代的洞见仍然有价值：它为理解"如何统一双向理解与单向生成"这一核心问题提供了一个优雅的理论框架。但工程实践中，Decoder-Only 的简洁性使其在分布式训练、推理优化等方面具有显著优势。

### 5.2 GLM vs BERT

BERT 的 MLM 任务假设被 mask 的 token 之间相互独立，这在自然语言中是不合理的。GLM 的自回归填空允许被 mask 的 token 之间相互依赖，更符合语言的序列特性。

### 5.3 GLM vs T5

T5 采用标准的 encoder-decoder 架构，Encoder 和Decoder  使用不同的参数。GLM 则在单一 Transformer 中通过注意力掩码实现 encoder-decoder 功能，参数效率更高。

## 6. 参考文献

1. GLM: General Language Model Pretraining with Autoregressive Blank Infilling (arXiv 2103.10360)
2. ChatGLM-6B 技术博客 (https://chatglm.cn/blog)
3. ChatGLM2-6B 技术博客 (https://chatglm.cn/blog)
4. GLM-4 技术报告 (2024)
5. GLM-130B: An Open Bilingual Pre-trained Model (arXiv 2210.02414)
