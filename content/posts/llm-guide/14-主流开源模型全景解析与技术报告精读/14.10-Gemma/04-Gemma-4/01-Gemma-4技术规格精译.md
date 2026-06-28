---
title: "Gemma-4技术规格精译"
---

# Gemma 4 技术规格精译

>  **[返回 14.10-Gemma 家族总览](../../14.10-Gemma.md)**


> 原文标题: Gemma 4: Byte for byte, the most capable open models
> 原文链接: https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/
> Model Card: https://ai.google.dev/gemma/docs/core/model_card_4
> 发布日期: 2026.04.02
> 发布机构: Google DeepMind
> 许可证: Apache 2.0

---

## 目录

- [摘要](#摘要)
- [1 发布背景与定位](#1-发布背景与定位)
- [2 模型家族总览](#2-模型家族总览)
- [3 架构创新](#3-架构创新)
  - [3.1 Per-Layer Embeddings (PLE)](#31-per-layer-embeddings-ple)
  - [3.2 Mixture-of-Experts (MoE)](#32-mixture-of-experts-moe)
  - [3.3 多模态设计](#33-多模态设计)
  - [3.4 长上下文扩展](#34-长上下文扩展)
- [4 训练与数据](#4-训练与数据)
- [5 后训练与能力](#5-后训练与能力)
- [6 性能评估](#6-性能评估)
  - [6.1 标准基准测试](#61-标准基准测试)
  - [6.2 Arena AI 排名](#62-arena-ai-排名)
- [7 部署与硬件](#7-部署与硬件)
- [8 许可证与生态](#8-许可证与生态)
- [9 讨论与结论](#9-讨论与结论)

---

## 摘要

2026 年 4 月 2 日,Google DeepMind 发布 Gemma 4,这是 Gemma 开放模型家族迄今为止最智能的版本.Gemma 4 专为高级推理与 agentic 工作流设计,在「每参数智能密度」(intelligence-per-parameter) 上达到前所未有的水平.整个家族包含四个尺寸:E2B(Effective 2B)、E4B(Effective 4B)、26B A4B(MoE)和 31B Dense,覆盖从数十亿台 Android 手机到开发者工作站的完整硬件谱系.所有模型均采用 Apache 2.0 许可证发布,这是 Gemma 家族首次使用标准开源许可,标志着 Google 开放模型战略的重大转向.

---

## 1 发布背景与定位

Gemma 4 与 Gemini 3 共享世界级的研究基础与技术栈,但定位为「可在本地硬件上运行的最强模型家族」.自 2024 年 2 月首代 Gemma 发布以来,开发者已下载 Gemma 模型超过 4 亿次,衍生出超过 10 万个社区变体.Gemma 4 是 Google 对这一社区反馈的直接回应:更强的推理能力、更开放的使用条款、更广泛的多模态支持,以及对 agentic 工作流的原生支持.

> **[战略思考]** 为什么 Gemma 4 改用 Apache 2.0?
> 
> Gemma 1/2/3 均采用自定义的 Gemma Terms of Use,包含月活跃用户(MAU)上限、可接受使用政策等商业限制.这些条款虽然比闭源模型宽松,但仍给企业在 redistribution、合规审查和长期部署灵活性方面带来不确定性.Gemma 4 改用 Apache 2.0,意味着:无 MAU 上限、无商业用途限制、可自由修改和再分发.对许多实践者而言,这一许可证变更的重要性几乎与基准测试提升相当.它直接将 Gemma 4 置于与 Llama、Qwen、DeepSeek 同一竞争平面,消除了法律层面的入场障碍.

Gemma 4 的发布也反映了 Google 对开放模型生态的重新定位:不再将开放模型视为专有模型的「降级版」,而是作为互补战略——Gemini 负责云端前沿能力,Gemma 负责端侧可部署性与开发者自由度.

---

## 2 模型家族总览

Gemma 4 家族按部署场景分为两个层级:边缘层(edge)和工作站层(workstation).

| 模型 | 有效/激活参数 | 总参数 | 上下文窗口 | 支持模态 | 目标硬件 |
|------|-------------|--------|-----------|---------|---------|
| E2B | 2.3B | 5.1B(含 PLE embeddings) | 128K | 文本、图像、音频 | 手机、Raspberry Pi、Jetson Orin Nano |
| E4B | 4.5B | 8B(含 PLE embeddings) | 128K | 文本、图像、音频 | 笔记本电脑、T4 GPU |
| 26B A4B | 3.8B | 25.2B | 256K | 文本、图像、视频 | RTX 4090/5090、消费级 GPU |
| 31B Dense | 30.7B | 30.7B | 256K | 文本、图像、视频 | H100 80GB、工作站 |

> **[命名解码]** E、A、Dense 分别代表什么?
> 
> - **E(Effective)**: E2B/E4B 的 "E" 表示「有效参数」,即推理时实际参与计算的参数量.这些模型采用 Per-Layer Embeddings(PLE)技术,每层拥有独立的嵌入表,因此总参数量(含 embeddings)远大于有效参数,但推理 FLOPs 与有效参数一致.
> - **A(Active)**: 26B A4B 的 "A" 表示「激活参数」.该模型为 MoE 架构,总参数量 25.2B,但每 token 仅激活 3.8B 参数.「26B」告诉你存储需求,「A4B」告诉你计算成本.
> - **Dense**: 31B 为传统稠密架构,每个前向传播激活全部 30.7B 参数.行为最简单,质量天花板最高,微调预期最清晰.

### 2.1 边缘层:E2B 与 E4B

E2B 和 E4B 是专为端侧计算从头设计的模型,与 Google Pixel 团队及移动硬件领导者 Qualcomm、MediaTek 深度合作优化.它们支持 128K 上下文窗口,可完全离线运行,延迟接近零.

> **[架构细节]** PLE 的工程本质
> 
> 标准 Transformer 在每个 token 进入 decoder 前计算一次嵌入,之后所有层共享该表示.PLE(Per-Layer Embeddings)为每一层 decoder 增加一个专用的条件向量(conditioning vector),通过残差连接注入该层的计算.这些 per-layer embedding tables 在磁盘上占用较大空间(因此总参数量达到 5.1B/8B),但在推理时仅读取当前层所需的一小部分,计算开销极低.这使得 E2B 在 2-bit 量化下可运行在 1.5GB 内存内,同时携带比纯 2B 模型更深的表征能力.

音频能力是边缘模型独有的:E2B/E4B 支持原生音频输入(语音识别与音频理解),最长 30 秒.这是 Gemma 家族首次支持音频模态.

### 2.2 工作站层:26B A4B 与 31B Dense

工作站层模型面向开发者 GPU 和云基础设施,提供前沿级推理能力.

**26B A4B(MoE)** 是延迟敏感场景的最优解.它采用 128 个小型专家(expert)加 1 个共享专家(shared expert)的设计,每 token 路由激活 8 个专家.这意味着:
- 存储需求:约 25.2B 参数(约 50GB bfloat16)
- 计算需求:每 token 仅 3.8B 激活参数,推理速度接近 4B 稠密模型
- 质量:在多数基准上达到 31B Dense 的 95%+ 水平

> **[技术权衡]** MoE 的「内存-计算」双账单问题
> 
> MoE 模型常被误解为「免费午餐」:总参数大但激活参数小,似乎同时获得大模型质量和小模型速度.但实际情况更复杂:虽然每 token 的计算 FLOPs 确实由激活参数决定,但**存储全部专家权重所需的 GPU 内存并未减少**.26B A4B 需要约 50GB bfloat16 显存(或约 16-18GB 4-bit 量化),与加载一个 26B 稠密模型的成本相当.真正的收益在于**计算延迟**而非**内存占用**.对于 latency-sensitive 应用(如交互式编程助手、实时 OCR 流水线),这是正确的优化方向;但对于 memory-constrained 部署(如单卡 24GB 消费级 GPU),MoE 的优势被削弱.

**31B Dense** 是家族中的质量旗舰.无路由、无 tricks,每个层每次前向传播全部参与.在 Arena AI 文本排行榜上位列全球开放模型第 3 名,与云侧前沿模型的对话质量相当.未量化的 bfloat16 权重可高效装入单张 80GB NVIDIA H100 GPU.

---

## 3 架构创新

### 3.1 Per-Layer Embeddings (PLE)

PLE 是 Gemma 4 边缘模型的核心架构创新.设标准 Transformer 的输入嵌入为 $E \in \mathbb{R}^{V \times d}$,其中 $V$ 为词表大小,$d$ 为隐藏维度.在标准架构中,token $t$ 的嵌入为 $e_t = E[t] \in \mathbb{R}^d$,之后该向量通过 $L$ 层 decoder,每层执行:

$$
x_{l+1} = x_l + \text{Attention}(\text{LN}(x_l)) + \text{FFN}(\text{LN}(x_l))
$$

PLE 为每一层 $l$ 引入独立的嵌入表 $E_l \in \mathbb{R}^{V \times d_l}$,其中 $d_l$ 通常较小.在第 $l$ 层,token $t$ 的条件向量为 $c_{t,l} = E_l[t]$,通过残差连接注入:

$$
x_{l+1} = x_l + \text{Attention}(\text{LN}(x_l + c_{:,l})) + \text{FFN}(\text{LN}(x_l + c_{:,l}))
$$

> **[工程分析]** 为什么 PLE 不是简单的参数膨胀?
> 
> PLE 的关键洞察在于**计算-存储分离**.embedding tables 是 lookup 操作,不依赖输入序列长度,且每层仅读取当前层所需的一小部分权重.相比增加隐藏维度或层数,PLE 以极低的推理开销换取了表征能力的深度.这类似于 MoE 的「存储大、计算小」哲学,但应用于嵌入层而非 FFN 层.对于边缘设备,这种设计特别有价值:闪存(存储)通常比算力更充裕.

### 3.2 Mixture-of-Experts (MoE)

26B A4B 的 MoE 设计遵循现代稀疏 Transformer 的标准范式.设输入 token 的隐藏状态为 $h \in \mathbb{R}^d$:

1. **路由(Router)**: 学习的路由网络计算每个专家的门控分数:
   $$
g = \text{Softmax}(W_r \cdot h) \in \mathbb{R}^{N_e}
$$
   其中 $N_e = 128$ 为专家总数,$W_r \in \mathbb{R}^{N_e \times d}$.

2. **专家选择**: 选择 top-$k$ 专家(此处 $k=8$),并应用负载均衡(load balancing):
   $$
g'_i = g_i \cdot \mathbb{1}_{i \in \text{top-}k(g)}
$$

3. **共享专家**: 1 个共享专家始终激活,确保基础语言知识不依赖路由决策.

4. **输出聚合**:
   $$
h' = \text{SharedExpert}(h) + \sum_{i \in \text{top-}k} g'_i \cdot \text{Expert}_i(h)
$$

> **[设计比较]** Gemma 4 MoE vs DeepSeekMoE vs OLMoE
> 
> | 维度 | Gemma 4(26B A4B) | DeepSeek-V3 | OLMoE |
> |------|-----------------|-------------|-------|
> | 总专家数 | 128 | 256 | 64 |
> | 激活专家数 | 8 + 1 shared | 8 + 1 shared | 8 |
> | 总参数 | 25.2B | 671B | 6.9B |
> | 激活参数 | 3.8B | 37B | 1.3B |
> | 路由粒度 | token-level | token-level | token-level |
> | 负载均衡 | 隐式(未公开细节) | 辅助损失 | 辅助损失 + Z-loss |
> | dropless | 未明确 | 是 | 是 |
> 
> Gemma 4 的 MoE 规模介于 OLMoE(研究导向)和 DeepSeek-V3(生产级)之间.一个值得注意的细节是 Google 未公开其负载均衡机制的具体实现(是否有显式辅助损失、容量因子等),这与 DeepSeek 和 OLMoE 的完全透明形成对比.

### 3.3 多模态设计

Gemma 4 继承了 Gemma 3 的多模态基础,并在工作站层扩展了视频支持.

**视觉**:所有模型均原生处理图像,支持变量分辨率,擅长 OCR 和图表理解.视觉Encoder 细节未在公开材料中完整披露,但基于 Gemma 3 的技术 lineage,推测仍基于 SigLIP 400M 视觉Encoder ,将图像压缩为固定数量的视觉 token.

**音频(仅 E2B/E4B)**:边缘模型支持原生音频输入,最长 30 秒.这代表 Gemma 家族首次进入音频模态, likely 通过轻量化的音频Encoder (如 SoundStream 或更简单的频谱特征提取)将音频转换为与文本共享的嵌入空间.

**视频(仅 26B/31B)**:工作站层模型支持视频输入,推测采用「视频作为帧序列」的策略:将视频采样为关键帧,每帧由视觉Encoder 独立处理,然后在时间维度上拼接为长序列.这与 Gemma 3 的 Pan & Scan 自适应分辨率方法兼容.

> **[架构思考]** 为什么音频仅支持边缘模型?
> 
> 一个有趣的模态分配策略:音频能力仅限于 E2B/E4B,而工作站层(26B/31B)不支持音频.这与通常的「大模型支持更多模态」直觉相反.可能的原因包括:(1)音频-文本对齐在较小模型上更容易实现高质量;(2)边缘场景(语音助手、实时转录)对音频需求更强烈;(3)工作站层的目标用例(代码生成、长文档分析)对音频需求较低.这种「按需分配模态」的策略比「一刀切全模态」更具工程理性.

### 3.4 长上下文扩展

| 模型 | 上下文窗口 | 技术推测 |
|------|-----------|---------|
| E2B/E4B | 128K | 可能延续 Gemma 3 的 5:1 Local:Global 注意力交错策略 |
| 26B/31B | 256K | 可能采用更激进的长上下文技术,YaRN 或类似 RoPE 重标定 |

Gemma 4 工作站层模型的 256K 上下文窗口是 Gemma 3(128K)的两倍.在长上下文检索基准上,Gemma 4 31B 达到 66.4%,而 Gemma 3 27B 仅为 13.5%,表明长上下文能力不仅是窗口尺寸的增加,更是注意力机制或位置编码的根本改进.

---

## 4 训练与数据

Gemma 4 基于 Gemini 3 的研究基础训练,具体训练数据细节未完全公开,但 Model Card 提供了以下关键信息:

- **数据截止**: 2025 年 1 月
- **语言覆盖**: 140+ 语言原生训练
- **知识蒸馏**: 推测延续 Gemma 2/3 的蒸馏策略,以 Gemini 3 或更大的内部模型作为教师
- **预训练规模**: 未公开具体 token 数(Gemma 3 为 2T-14T 视模型大小而定)

> **[数据思考]** 训练数据透明度仍是 Gemma 的弱项
> 
> 与 OLMo 家族(公开完整数据管道、去重策略、质量过滤代码)和 DeepSeek(公开数据构成比例)相比,Gemma 4 在训练数据方面仍保持较高的黑盒性. Model Card 仅提供数据截止时间和语言数量,未披露数据来源、去重方法、数据混合比例或质量过滤策略.对于研究社区而言,这意味着难以复现训练结果或深入分析模型行为的根源.

---

## 5 后训练与能力

Gemma 4 引入了多项后训练能力,这些能力在所有尺寸上均可用:

**原生 Function Calling**:模型可直接输出结构化工具调用,支持构建与外部 API、数据库和工具交互的 autonomous agent.这不同于通过 prompt engineering 模拟的 function calling,而是模型在训练阶段就学会的行为模式.

**结构化 JSON 输出**:原生支持约束解码生成符合 JSON Schema 的输出,无需外部验证器或重试机制.

**Thinking Mode(推理模式)**:可配置的思考模式允许用户在速度和深度推理之间做 trade-off.推测这通过训练时的「思考 token」(如 `<think>` 标签)或 test-time compute scaling 实现,类似于 DeepSeek-R1 的推理链生成,但可能更轻量.

**系统指令**:原生支持系统级指令,可在不污染用户提示的前提下设定模型行为准则、安全约束和角色定义.

> **[能力分析]** Agentic 能力的代际跨越
> 
> 在 τ2-bench(agentic 工具使用基准)上,Gemma 3 27B 仅得分 6.6%,而 Gemma 4 31B 达到 86.4%.这不是渐进式改进,而是能力涌现.这一跨越可能源于:(1)训练数据中有意增加了多步工具调用轨迹;(2)后训练阶段引入了专门针对 agentic 场景的 RL;(3)Function calling 的原生支持消除了 prompt 模拟的误差累积.Google 在博客中明确将 agentic workflows 列为 Gemma 4 的核心定位,这一基准结果验证了其训练投入的有效性.

---

## 6 性能评估

### 6.1 标准基准测试

下表汇总 Gemma 4 全家族在主要基准上的表现,并与 Gemma 3 27B 对比:

| 基准 | 测试类型 | Gemma 3 27B | Gemma 4 E2B | Gemma 4 E4B | Gemma 4 26B A4B | Gemma 4 31B |
|------|---------|------------|------------|------------|-----------------|------------|
| AIME 2026 | 数学推理 | 20.8% | 37.5% | 42.5% | 88.3% | 89.2% |
| LiveCodeBench v6 | 代码生成 | 29.1% | 44.0% | 52.0% | 77.1% | 80.0% |
| GPQA Diamond | 科学问答 | 42.4% | - | - | 82.3% | 84.3% |
| MMLU Pro | 综合知识 | - | ~60.0% | ~69.4% | 82.6% | 85.2% |
| MMMU Pro | 多模态推理 | - | - | - | 73.8% | 76.9% |
| MATH-Vision | 视觉数学 | - | - | - | 82.4% | 85.6% |
| τ2-bench | Agentic 工具使用 | 6.6% | - | - | - | 86.4% |
| 长上下文检索 | 128K/256K | 13.5% | - | - | - | 66.4% |

> **[性能解读]** 三个显著的模式
> 
> 1. **推理能力的代际飞跃**:AIME 2026 从 Gemma 3 27B 的 20.8% 提升到 Gemma 4 31B 的 89.2%,提升超过 4 倍.这一跨越远超参数规模增长所能解释的范围(27B → 31B 仅增加 15% 参数),表明训练方法论(可能包括 test-time scaling、更优的蒸馏策略或专门的多步推理数据)发生了根本性变化.
> 
> 2. **MoE 的效率验证**:26B A4B 在 AIME 2026(88.3% vs 89.2%)、LiveCodeBench v6(77.1% vs 80.0%)、MMLU Pro(82.6% vs 85.2%)上均接近 31B Dense 的水平,但激活参数仅为后者的 12.4%(3.8B vs 30.7B).这验证了 MoE 「以存储换计算」的效率承诺——在实际质量损失 <5% 的前提下,计算成本降低约 87%.
> 
> 3. **边缘模型的可用性突破**:E4B 的 AIME 2026 得分(42.5%)已超过 Gemma 3 27B(20.8%)的两倍,尽管其有效参数仅为 4.5B.PLE 架构的有效性在此得到验证:一个 4.5B 有效参数的模型通过更聪明的嵌入设计,击败了 27B 的传统稠密模型.

### 6.2 Arena AI 排名

Arena AI 是人类评估者通过盲测对战评分的行业标杆,测量的是模型的对话质量、指令遵循能力和创造性输出.

| 模型 | Arena ELO | 全球开放模型排名 | 参数规模 |
|------|-----------|----------------|---------|
| Gemma 4 31B | 1452 | #3 | 30.7B Dense |
| Gemma 4 26B A4B | 1441 | #6 | 25.2B MoE(3.8B active) |
| Qwen 3.5 27B | 1403 | - | 27B |
| DeepSeek-V3.2 | ~1425 | - | 约 320B MoE |
| Gemma 3 27B | 1365 | - | 27B |

> **[竞争分析]** 参数效率的重新定义
> 
> Gemma 4 31B 的 ELO 1452 不仅超过了参数规模相当的 Qwen 3.5 27B(ELO 1403),也逼近了参数量 10 倍以上的 DeepSeek-V3.2(~1425).在性能-参数散点图上,Gemma 4 的两个工作站模型位于「左上」最优区域:高 ELO、低参数.这一定位验证了 Google 的「intelligence-per-parameter」策略——不追求最大模型,追求最高效率.对于本地部署者和中小型企业而言,这意味着可以用消费级硬件获得接近前沿模型的对话体验.

---

## 7 部署与硬件

### 7.1 边缘部署

E2B 和 E4B 通过与 Google Pixel、Qualcomm、MediaTek 的深度合作,实现了跨平台优化:

| 模型 | 量化格式 | 内存占用 | 目标设备 |
|------|---------|---------|---------|
| E2B | 2-bit GGUF | ~1.5GB | Raspberry Pi 5、Android 手机 |
| E4B | 4-bit GGUF | ~5GB | 笔记本、Jetson Orin Nano |
| E4B | 8-bit | ~8GB | 高端笔记本、T4 GPU |

Android 开发者可通过 AICore Developer Preview 在设备端 prototype agentic 工作流,并确保与 Gemini Nano 4 的前向兼容性.

### 7.2 工作站部署

| 模型 | 精度 | 显存需求 | 目标硬件 |
|------|------|---------|---------|
| 26B A4B | 4-bit(Q4_K_M) | ~16-18GB | RTX 4090(24GB)、Mac Studio |
| 26B A4B | NVFP4 | ~16GB | H100/B200 |
| 31B | 4-bit | ~20GB | RTX 4090(24GB) |
| 31B | 8-bit | ~34GB | H100 40GB |
| 31B | bfloat16 | ~62GB | H100 80GB |

> **[部署建议]** 如何选择模型?
> 
> - **手机/IoT/语音助手** → E2B:唯一支持音频且能在 <2GB 内存运行的选项
> - **笔记本/本地助手** → E4B:如果硬件支持 5-8GB,选择 E4B 而非 E2B,推理能力提升显著
> - **开发工作站/消费级 GPU** → 26B A4B:性价比最优解,在 24GB 显存内运行,质量接近 31B
> - **研究/微调/最高质量** → 31B Dense:最佳微调基底,行为最可预测,质量天花板最高
> - **latency 敏感型应用** → 26B A4B:MoE 的激活参数优势在交互式场景(代码补全、实时对话)中最为明显

---

## 8 许可证与生态

### 8.1 Apache 2.0 的战略意义

Gemma 4 是 Gemma 家族首次采用 Apache 2.0 许可证.与此前 Gemma Terms 的关键差异:

| 维度 | Gemma 1/2/3 Terms | Gemma 4 Apache 2.0 |
|------|------------------|-------------------|
| 商业使用 | 允许,但受 MAU 上限约束 | 完全自由,无上限 |
| Redistribution | 允许,但需遵守使用政策 | 完全自由 |
| 修改与衍生 | 允许,但需保留声明 | 完全自由 |
| 专利授权 | 未明确 | 明确包含 |
| 合规审查 | 需评估可接受使用政策 | 标准 Apache 2.0 条款 |

> **[生态影响]** 许可证变更的涟漪效应
> 
> 开放模型的许可证选择直接影响其生态系统的广度和深度.Llama 系列(社区许可)和 Qwen 系列(多许可证)的成功部分归功于许可条款的清晰度.Gemma 1/2/3 的自定义条款曾阻碍部分企业和云服务提供商(如某些 AWS/Azure 托管服务)无缝集成 Gemma.Apache 2.0 消除了这些摩擦,预计将加速 Gemma 4 在以下领域的采用:(1)企业私有化部署;(2)云服务商的托管模型即服务;(3)开源社区的二次开发(如 Unsloth 微调、Candle 推理引擎);(4)垂直领域微调(如医疗、法律、金融).

### 8.2 生态系统支持

Gemma 4 发布当天即获得广泛的工具链支持:

- **推理引擎**: vLLM、llama.cpp、MLX(Ollama、LM Studio)、SGLang、LiteRT-LM
- **微调框架**: Hugging Face TRL、Unsloth、NVIDIA NeMo、MaxText
- **云服务**: Google Cloud Vertex AI、Cloud Run、GKE、TPU 加速推理
- **硬件优化**: NVIDIA Jetson(Orin Nano 到 Blackwell)、AMD ROCm、Google TPU(Trillium/Ironwood)
- **开发者工具**: Google AI Studio(31B/26B)、AI Edge Gallery(E4B/E2B)、Android Studio Agent Mode、ML Kit GenAI Prompt API

---

## 9 讨论与结论

### 9.1 Gemma 4 的四个「第一」

1. **首个 Apache 2.0 Gemma**:许可证变更消除了 Gemma 在企业级部署中的最大障碍.
2. **首个音频 Gemma**:E2B/E4B 的原生音频支持将开放模型带入语音交互领域.
3. **首个 MoE Gemma**:26B A4B 引入 MoE 架构,在 Gemma 家族中首次实现「存储-计算分离」.
4. **首个视频工作站 Gemma**:26B/31B 支持视频输入,将多模态从图像扩展到时间维度.

### 9.2 局限性

- **无独立技术报告**:Gemma 4 仅有 Model Card 和博客发布,未发布如 Gemma 3(arXiv:2503.19786)那样的独立技术报告.这导致许多架构细节(如 PLE 的确切实现、MoE 的路由算法、训练数据构成)无法完全验证.
- **数据透明度不足**:训练数据来源、混合比例、过滤策略未公开,限制了研究复现.
- **边缘模型无视频**:E2B/E4B 不支持视频,工作站模型不支持音频,模态分配存在断层.
- **长上下文机制未公开**:256K 窗口的具体实现(是否采用 YaRN、NTK-aware 插值或其他技术)未在公开材料中说明.

### 9.3 总结

Gemma 4 代表了 Google 开放模型战略的成熟化:从「轻量级 Gemini 衍生品」进化为「独立定位的开放模型家族」.其核心价值主张可概括为三个关键词:

- **密度**(Density):在 31B 参数内实现全球开放模型第 3 名的对话质量,在 3.8B 激活参数内实现接近 31B 的推理能力.
- **覆盖**(Coverage):从 1.5GB 内存的 Raspberry Pi 到 80GB H100,四个模型覆盖完整的部署谱系.
- **开放**(Openness):Apache 2.0 许可证终于让 Gemma 与 Llama、Qwen、DeepSeek 站在同一起跑线.

对于实践者,Gemma 4 的最重要启示是:**模型选择应基于激活参数和部署约束,而非总参数**.26B A4B 的「26B」是存储标签,「A4B」才是计算真相;E2B 的「2.3B」是推理标签,「5.1B」才是能力深度.理解这些命名背后的工程权衡,是正确使用 Gemma 4 家族的前提.

---

## 附录

### A. 术语表

| 术语 | 解释 |
|------|------|
| PLE | Per-Layer Embeddings,每层独立的嵌入表技术 |
| MoE | Mixture-of-Experts,混合专家架构 |
| E(Effective) | 有效参数,推理时实际参与计算的参数量 |
| A(Active) | 激活参数,MoE 模型每 token 实际路由到的专家参数量 |
| Dense | 稠密架构,所有参数在每轮前向传播中均激活 |
| Arena AI | LMSYS Chatbot Arena,基于人类偏好对战的模型排名平台 |
| Agentic | 具备自主规划、工具调用和多步执行能力的 AI 系统 |
| τ2-bench | 评估模型 agentic 工具使用能力的基准测试 |

### B. 参考链接

- 官方博客: https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/
- Model Card: https://ai.google.dev/gemma/docs/core/model_card_4
- DeepMind 页面: https://deepmind.google/models/gemma/gemma-4/
- Hugging Face 发布: https://huggingface.co/blog/gemma4
- Google Developers Blog: https://developers.googleblog.com/bring-state-of-the-art-agentic-skills-to-the-edge-with-gemma-4/
- Function Calling 文档: https://ai.google.dev/gemma/docs/capabilities/text/function-calling-gemma4
- Thinking Mode 文档: https://ai.google.dev/gemma/docs/capabilities/thinking
