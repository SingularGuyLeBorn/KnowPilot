---
title: "MiniCPM-4.1 技术报告精译"
---

# MiniCPM-4.1 技术报告精译

>  **[返回 14.18-MiniCPM 家族总览](../../14.18-MiniCPM.md)**


> 原文来源: OpenBMB GitHub 官方仓库 / InfLLM-V2 论文(arXiv:2509.24663) / HuggingFace 模型卡片
> 官方链接: https://github.com/OpenBMB/MiniCPM
> HuggingFace: https://huggingface.co/openbmb/MiniCPM4.1-8B
> 发布日期: 2025 年 9 月 5 日
> 发布机构: 清华大学面壁智能(OpenBMB)
> 模型规模: 8B 参数
> 说明: MiniCPM-4.1 无独立技术报告 PDF, 本文基于 GitHub README、InfLLM-V2 论文及官方公开信息综合整理精译

---

## 1 模型概述

MiniCPM-4.1 是面壁智能于 2025 年 9 月发布的端侧混合推理大语言模型(Hybrid Reasoning LLM),基于 MiniCPM-4.0 的架构演进而来,核心参数规模为 8B。该模型最大的差异化特征是**混合推理模式**(Hybrid Reasoning Mode)——用户可以在「深度思考模式」(deep reasoning mode)和「非思考模式」(non-reasoning mode)之间自由切换,而无需加载两个独立的模型权重。

与 MiniCPM-4.0 相比,4.1 版本进行了三项关键升级:

(1) **混合推理架构**: 单模型同时支持 reasoning 和 non-reasoning 输出,通过 `enable_thinking` 参数或 `/think` / `/no_think` 指令实现动态切换;
(2) **上下文长度扩展**: 预训练上下文长度从 32K 扩展至 64K,通过 YaRN 技术可外推至 128K;
(3) **推理速度优化**: 在 reasoning 场景下实现 **3x** 解码速度提升,长文本场景下维持与 4.0 相同的 **7x** 加速水平。

模型家族包含 8B 主模型和 0.5B 轻量模型,均支持稀疏注意力推理(dense 和 sparse 两种模式)。在端侧芯片 Jetson AGX Orin 和 RTX 4090 上,MiniCPM-4.1 的长文本处理效率显著优于同尺寸模型。

> 这里需要停下来想一下: 为什么要在端侧做混合推理？2025 年初 DeepSeek-R1 的发布证明了大语言模型可以通过强化学习获得强大的推理能力,但 R1 的「始终思考」模式带来了两个现实问题。第一,每个请求都要消耗大量推理 token(数万级别),在端侧设备上这意味着不可接受的延迟和电量消耗。第二,很多日常任务根本不需要深度推理——比如「明天天气怎么样」或「把这段文字翻译成英文」,强行思考只会浪费算力。MiniCPM-4.1 的混合推理模式本质上是在「能力」和「效率」之间做了一个可配置的平衡,让用户(或应用开发者)根据场景需求动态选择推理深度。这在端侧场景中尤为关键,因为端侧用户最敏感的是响应速度和续航时间。

---

## 2 核心架构

### 2.1 InfLLM-V2 可训练稀疏注意力

MiniCPM-4.1 沿用了 MiniCPM-4.0 的 InfLLM-V2 稀疏注意力架构。InfLLM-V2 的核心设计在于「密集-稀疏可切换注意力」(Dense-Sparse Switchable Attention),它在处理短序列时使用标准密集注意力,在处理长序列时平滑过渡为块稀疏注意力,且**无需引入任何额外参数**。

与 NSA(Natively Trainable Sparse Attention)相比,InfLLM-V2 的关键改进包括:

- **共享 KV 投影**: NSA 为三种注意力模式(Compressed、Selected、Sliding)各自维护独立的 KV 投影矩阵,而 InfLLM-V2 仅使用一组共享的 $W_K$ 和 $W_V$,直接用预训练 dense attention 的参数初始化;
- **统一稀疏注意力**: 将 Selected Attention 和 Sliding Attention 合并为一个统一的 Sparse Attention 模块,消除 Compressed Attention 的输出,计算流程更贴近标准 dense attention;
- **三阶段块压缩**: 采用 coarse-to-fine 的 3-stage 压缩策略(mean-pooling → block-wise sparse attention → max-pooling),在保持选择精度的同时降低 I/O 开销。

> 译者注: NSA 和 InfLLM-V2 的架构差异值得仔细对比。NSA 的设计思路是「为稀疏注意力专门设计一套模块」,这导致三个注意力分支 + gating MLP 的复杂结构,短序列处理时也不得不计算所有分支,引入显著 overhead。InfLLM-V2 的思路则是「让稀疏注意力复用密集注意力的全部参数」,通过架构改造而非参数增量的方式实现稀疏化。这个设计选择直接决定了两种方法在「短到长适配」场景中的适用性——NSA 更适合从头训练,InfLLM-V2 更适合在预训练 dense 模型基础上做继续训练。MiniCPM-4.1 选择在 4.0 的 dense 基座上通过 InfLLM-V2 做继续训练,只需要 **5B** 长文本 token 即可完成适配,这是一个非常经济的训练成本。

### 2.2 混合推理模式的工程实现

MiniCPM-4.1 的混合推理模式通过 tokenizer 级别的指令控制实现,而非在模型架构层面维护两个独立的前向路径。

**API 层切换方式**:

```python
# 启用思考模式
prompt_text = tokenizer.apply_chat_template(
    messages,
    tokenize=False,
    add_generation_prompt=True,
    enable_thinking=True
)

# 启用非思考模式
prompt_text = tokenizer.apply_chat_template(
    messages,
    tokenize=False,
    add_generation_prompt=True,
    enable_thinking=False
)
```

**用户指令层切换方式**:

用户可以在查询末尾添加 `/think` 强制启用思考模式,或添加 `/no_think` 强制禁用思考模式。若不添加任何特殊指令,模型默认启用思考模式。

> 这个实现方式非常聪明。从技术角度看,混合推理不是在模型内部维护两个独立的「推理头」或「非推理头",而是通过 chat template 在 prompt 中插入不同的系统级指令或特殊 token,引导模型进入不同的生成行为模式。这避免了模型权重的倍增(不需要两个 8B 模型),也避免了架构层面的复杂改造。代价是模型需要在 post-training 阶段学会识别这些特殊指令并调整生成策略——具体来说,就是在 SFT 和 RL 阶段同时暴露 reasoning 和 non-reasoning 的示例,让模型学会「看到 /think 就展开 CoT,看到 /no_think 就直接输出答案」。这本质上是一种通过 prompt engineering 实现的「软切换」,而不是硬编码的架构分支。

---

## 3 训练数据与策略

### 3.1 预训练数据

MiniCPM-4.1 的预训练数据延续了 MiniCPM-4.0 的 UltraClean 清洗策略,总量约 **8T tokens**。与 4.0 的关键差异在于长文本预训练阶段的上下文长度从 32K 提升到 **64K**,这一扩展使模型在原生训练阶段就能接触到更长的上下文依赖关系。

长度扩展通过 YaRN(Yet another RoPE extension method)技术实现,该技术通过对 RoPE 的旋转角度进行缩放和温度调整,在不修改模型参数的前提下扩展上下文窗口。在 128K「大海捞针」(Needle-in-a-Haystack)测试中,MiniCPM-4.1 表现优异,证明了其在超长上下文中的检索能力。

### 3.2 后训练数据

后训练阶段使用了 UltraChat v2 数据集,覆盖知识密集型数据、推理密集型数据、指令遵循数据、长文本理解数据和工具调用数据五个维度。

混合推理模式的后训练是关键难点。模型需要同时学习两种输出格式:

- **Reasoning 模式**: 输出格式为 `<think>...</think><answer>...</answer>`,中间包含完整的 Chain-of-Thought 推理链;
- **Non-reasoning 模式**: 直接输出 `<answer>...</answer>`,不包含显式思考过程。

训练数据需要按一定比例混合两种模式的样本,同时确保模型不会因为过度偏向某一种模式而导致另一种模式的性能退化。

> 混合推理的训练数据配比是一个没有标准答案的工程问题。如果 reasoning 样本比例过高,模型在非思考模式下可能会「忍不住」输出推理过程;如果 non-reasoning 样本比例过高,模型的推理深度可能不足。面壁智能没有公开具体的配比方案,但从工程实践推断,一个合理的策略是: 在 SFT 阶段保持大致 1:1 的配比,在 RL 阶段根据下游任务的表现动态调整。此外,推理样本的质量控制比数量更重要——低质量的 CoT(比如重复思考、逻辑跳跃)会对模型产生负面影响,因此需要专门的过滤机制来剔除劣质 reasoning 轨迹。

---

## 4 评估结果

### 4.1 综合性能评测

MiniCPM-4.1-8B 在深度思考模式下,在 15 项评测任务上超越了同尺寸模型,达到同类端侧模型的最佳水平。评测覆盖的维度包括:

| 能力维度 | 代表基准 | 对比模型 |
|---------|---------|---------|
| 通用知识 | MMLU, C-Eval | Qwen3-8B, Llama-3.1-8B |
| 数学推理 | GSM8K, MATH | DeepSeek-R1-Distill-Qwen-7B |
| 代码生成 | HumanEval, MBPP | CodeQwen-7B |
| 长文本理解 | LongBench, InfiniteBench | Qwen3-8B |
| 工具调用 | BFCL | GLM-4-9B, Qwen2.5-7B |

在非思考模式下,MiniCPM-4.1 的综合性能与同尺寸 dense 模型相当,响应速度显著快于思考模式。

### 4.2 推理速度评测

在典型端侧芯片上的推理加速表现如下:

| 平台 | 模型 | 长文本加速比 | 推理加速比 |
|------|------|------------|----------|
| Jetson AGX Orin | MiniCPM-4.1 vs Qwen3-8B | 约 7x | 约 3x |
| RTX 4090 | MiniCPM-4.1 vs Qwen3-8B | 约 7x | 约 3x |

> 需要注意加速比数据的解读方式。7x 长文本加速主要来自 InfLLM-V2 稀疏注意力带来的计算量减少(128K 场景下仅计算不到 5% 的 token 相关性)。3x 推理加速则是一个更复杂的数字——它既包含了稀疏注意力的贡献,也包含了 reasoning 场景下模型生成效率的优化(比如更短的平均 CoT 长度或更高效的投机采样)。但这里存在一个潜在的测量偏差: 如果对比基准是 Qwen3-8B 的 dense attention 推理,那么加速比中的一部分其实来自「稀疏 vs 密集」的结构性差异,而非 MiniCPM-4.1 本身的独特优化。一个更公平的对比应该是 MiniCPM-4.1 sparse vs MiniCPM-4.1 dense,这样可以分离出稀疏注意力单独的加速贡献。

### 4.3 长文本能力

MiniCPM-4.1 在 128K 长文本 Needle-in-a-Haystack 测试中表现优异,所有测试点均成功检索。预训练阶段使用 64K 上下文长度,通过 YaRN 扩展至 128K,这一配置使其成为端侧模型中少有的原生支持 128K 上下文的推理模型。

---

## 5 推理与部署

### 5.1 推理框架支持

MiniCPM-4.1 支持以下推理框架:

| 框架 | 密集注意力 | 稀疏注意力 | 混合推理 |
|------|----------|----------|---------|
| HuggingFace Transformers | 支持 | 支持 | 支持 |
| vLLM | 支持 | 不支持 | 支持 |
| SGLang | 支持 | 不支持 | 支持 |
| CPM.cu | 支持 | 支持 | 支持 |

对于追求极致推理速度的场景,官方推荐使用 CPM.cu——这是面壁智能自研的轻量级 CUDA 推理框架,集成了稀疏注意力、模型量化和投机采样,在端侧芯片上实现了高效的 prefill 和 decoding。

### 5.2 投机解码支持

MiniCPM-4.1 支持通过 EAGLE3 协议进行投机解码(Speculative Decoding),需要配合专门的 draft model 使用。在 vLLM 和 SGLang 中均可配置,配置流程包括: (1) 下载 MiniCPM-4.1 draft model; (2) 安装 EAGLE3-compatible 版本的推理框架; (3) 启动服务时指定 draft model 路径。

### 5.3 量化部署

通过 BitCPM 三值量化技术,MiniCPM-4.1 可实现 1.58-bit 参数精度,在保持与全精度模型相当性能的同时,将模型体积压缩至原来的约 10%。量化模型支持在 HuggingFace 框架中直接推理,无需专门的量化推理引擎。

> BitCPM 的 1.58-bit 量化是一个相当激进的方案。传统量化通常是 INT8(8-bit)或 INT4(4-bit),1.58-bit 意味着每个参数只有约 3 个可能取值(典型实现为 {-1, 0, 1})。这种极端压缩能在端侧节省大量存储和内存带宽,但代价是: 第一,量化感知训练(QAT)需要额外的训练周期; 第二,1.58-bit 的数值精度对注意力计算中的 softmax 和层归一化等操作可能引入累积误差; 第三,目前主流推理框架(vLLM、SGLang)对三值量化的原生支持仍然有限,实际部署时可能需要回退到 HuggingFace 或 CPM.cu。对于端侧应用,1.58-bit 的存储节省(约 5x)通常值得这些代价,但对于追求最高精度的场景,FP16 或 INT8 仍是更稳妥的选择。

---

## 6 模型家族与技术谱系

### 6.1 MiniCPM 系列演进

| 版本 | 发布时间 | 核心特征 | 上下文长度 |
|------|---------|---------|----------|
| MiniCPM-2B | 2024.02 | 端侧基座首发 | 4K |
| MiniCPM-4.0 | 2025.06 | InfLLM v2, 8T tokens | 128K(32K 预训练) |
| **MiniCPM-4.1** | **2025.09** | **混合推理, InfLLM-V2** | **128K(64K 预训练)** |
| MiniCPM-SALA | 2026.02 | 稀疏+线性注意力混合, 1M 上下文 | 1M+ |

### 6.2 推理模型家族定位

MiniCPM-4.1 在 2025 年的推理模型生态中占据独特的「端侧推理」 niche:

- **DeepSeek-R1** (671B): 云端超大规模推理模型,能力最强但无法端侧部署;
- **Kimi-K2** (32B): 长文本 + 推理,主要面向云端 API 服务;
- **Qwen3-8B**: 通用 dense 模型,支持思考模式但无稀疏注意力;
- **MiniCPM-4.1** (8B): **唯一同时具备「端侧可部署」+「可训练稀疏注意力」+「混合推理模式」的开源模型**。

> MiniCPM-4.1 的谱系定位非常有意思。它既不是 DeepSeek-R1 那样的「推理能力优先、部署成本不管」的云端模型,也不是 Qwen3-8B 那样的「通用能力优先、推理靠 brute-force」的 dense 模型。它的核心创新在于证明了: 在 8B 规模的端侧模型上,通过「可训练稀疏注意力 + 混合推理训练」,可以同时获得接近云端模型的推理能力和远低于云端模型的推理成本。InfLLM-V2 论文中的实验数据支撑了这一观点——稀疏注意力在 CoT 推理场景下保留了 99.7% 的 dense attention 性能,同时实现 4x 加速。这意味着端侧设备上的推理模型不再是「阉割版」,而是一个在特定约束(延迟、功耗、内存)下重新优化的独立品类。

---

## 附录 A: 术语表

| 英文术语 | 中文译名 | 首次出现位置 | 简要解释 |
|---------|---------|------------|---------|
| Hybrid Reasoning | 混合推理 | 1 模型概述 | 单模型同时支持深度思考模式和非思考模式的切换能力 |
| InfLLM-V2 | 可训练无限长上下文语言模型 v2 | 2.1 | 密集-稀疏可切换注意力框架,无需额外参数 |
| Dense-Sparse Switchable Attention | 密集-稀疏可切换注意力 | 2.1 | 短序列用 dense attention,长序列自动切换为 sparse attention |
| YaRN |  yet another RoPE extension method | 3.1 | 通过调整 RoPE 旋转角度实现上下文长度扩展的技术 |
| BitCPM | 三值量化模型 | 5.3 | 将模型参数量化至 1.58-bit(约 3 个取值)的极端压缩方案 |
| EAGLE3 | - | 5.2 | 投机解码协议,通过 draft model 预测后续 token 加速生成 |
| CPM.cu | - | 5.1 | 面壁智能自研的轻量级 CUDA 推理框架 |
| CoT | Chain-of-Thought,思维链 | 3.2 | 模型在输出答案前先输出中间推理步骤的技术 |
| Needle-in-a-Haystack | 大海捞针 | 3.1 | 在长文本中插入特定信息并测试模型能否准确检索的评测方法 |
| NSA | Natively Trainable Sparse Attention | 2.1 | 原生可训练稀疏注意力,使用三组分块注意力 + gating |
| GQA | Grouped-Query Attention | 2.1 | 分组查询注意力,Query 头分组共享 KV 头以节省显存 |
