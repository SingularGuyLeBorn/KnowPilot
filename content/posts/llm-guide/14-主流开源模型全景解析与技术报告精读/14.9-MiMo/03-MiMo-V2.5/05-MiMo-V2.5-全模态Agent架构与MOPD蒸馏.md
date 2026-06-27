---
title: "MiMo-V2.5全模态Agent架构剖析"
---

# MiMo-V2.5 全模态 Agent 架构剖析

> 🔙 **[返回 14.9-MiMo 家族总览](../../14.9-MiMo.md)**


> 信息来源: MiMo-V2.5 / MiMo-V2.5-Pro Technical Blog (Xiaomi AI Lab, 2026-04-22/27)
> 发布日期: 2026-04-22(V2.5 Standard) / 2026-04-27(V2.5-Pro)
> 发布机构: Xiaomi AI Lab
> 开源协议: MIT License

---

## 1. 设计动机:统一多模态与 Token 效率的兼得

MiMo-V2.5 是 MiMo 家族的首个多模态模型,在 V2-Flash 的纯文本能力基础上增加了原生视觉和音频理解能力.与市场上常见的「文本模型 + 外挂视觉模块」方案不同,MiMo-V2.5 采用统一架构:自研的视觉 Encoder 和音频 Encoder 通过轻量 projector 连接到语言 backbone,三种模态从底层共享同一个推理引擎.

发布两个版本:

| 版本 | 总参数 | 激活参数 | 训练数据 | 上下文 | 定位 |
|:---|:---:|:---:|:---:|:---:|:---|
| **MiMo-V2.5** | **310B** | **15B** | **48T** | **1M** | **效率优先,多模态 Agent** |
| **MiMo-V2.5-Pro** | **1.02T** | **42B** | **27T** | **1M** | **性能优先,前沿 Agent** |

> **译者注**: Standard 版本的 48T 训练数据量非常可观——约为 DeepSeek-V3(14.8T)的 3.2 倍.Pro 版本虽然总参数和激活参数更多,但训练数据反而更少(27T),可能使用了更高质量、更精选的数据,或通过 MOPD 蒸馏获取能力.原文没有解释这个数据量差异的原因,最可能的解释是 Pro 版本使用了更高质量的数据,同时通过后训练蒸馏来弥补预训练数据量的差距.

MiMo-V2.5 的独特之处在于**它是少数完全开源的多模态 Agent 模型之一**,且在 token 效率和长程任务执行上展现出差异化优势.但多模态能力的定量验证仍是关键缺口——技术博客中缺乏多模态 benchmark 的具体分数.

---

## 2. 核心架构:Hybrid Attention 与渐进式上下文扩展

### 2.1 五阶段训练流程

| 阶段 | 内容 | 上下文 |
|:---:|:---|:---:|
| 1 | Text pre-training: 构建 LLM backbone | 32K |
| 2 | Projector warmup: 对齐视觉/音频 projector | 32K |
| 3 | Multimodal pre-training: 跨模态数据训练 | 32K |
| 4 | SFT + Agentic post-training | **32K → 256K → 1M** |
| 5 | RL + MOPD: 强化感知、推理和 Agentic 能力 | 1M |

大多数模型的长上下文扩展采用两阶段方法(预训练固定 + 后训练扩展).MiMo-V2.5 的独特之处在于**在 SFT + Agentic post-training 阶段就进行渐进式扩展**:

| 阶段 | 上下文 | 模型在学习什么 |
|:---:|:---:|:---|
| 32K | 基础指令遵循 | 基本工具使用 |
| 256K | 中长程 Agent 任务 | 多轮 tool call 轨迹管理 |
| **1M** | **长程复杂任务** | **在百万级上下文中保持连贯性** |

> **译者注**: Agentic 任务天然需要长上下文——多轮 tool call 的轨迹累积、历史经验引用、大代码库理解.MiMo-V2.5 在训练时就习惯了百万级上下文,这意味着它在真实 Agent 场景中的长程连贯性可能比「先短后长」训练方式的模型更可靠.但渐进式扩展也增加了训练复杂度,每个阶段都需要重新调整位置编码和注意力机制.

### 2.2 Hybrid Attention:6:1 局部与全局的交错

MiMo-V2.5-Pro 继承自 MiMo-V2-Flash 的 **hybrid attention** 和 **Multi-Token Prediction(MTP)** 设计.Local Sliding Window Attention(SWA)和 Global Attention(GA)以 6:1 的比例交错,使用 128-token 窗口.

这种「大部分廉价 + 少部分昂贵」的设计在降低 KV Cache 的同时,通过 attention-sink bias 来缓解长距离信息丢失——bias 的作用是强制少数 token(通常是序列开头的几个)始终参与全局注意力,作为信息的「锚点」.配备 dense FFNs 的轻量 MTP 模块原生集成于训练和推理中,大致将输出吞吐量提升 3 倍,并加速 RL rollout.

| 注意力类型 | 比例 | 计算复杂度 | 作用 |
|:---|:---:|:---:|:---|
| Local SWA | 6/7 | O(n) | 捕获局部依赖,降低 KV Cache |
| Global Attention | 1/7 | O(n^2) | 保留长距离连接,全局信息聚合 |

> **译者注**: 6:1 的 Local:Global attention 比例是一个有趣的工程选择.大部分注意力层使用高效的局部窗口,只有少部分层需要全局视野.这种设计在降低 KV Cache 的同时,通过 attention-sink bias 来缓解长距离信息丢失——bias 的作用是强制少数 token 始终参与全局注意力,作为信息的「锚点」.但 128-token 的窗口对于某些需要中长距离依赖的任务(如跨段落指代)可能仍然不足,1/7 的全局层是否足够,需要更多消融实验来验证.

---

## 3. 关键创新:MOPD 蒸馏与 Harness Awareness

### 3.1 MOPD:多教师在线策略蒸馏

MiMo-V2.5-Pro 后训练阶段的核心创新是 MOPD(Multi-Teacher On-Policy Distillation).传统的多教师蒸馏通常采用「离线」方式:每个学生从每个教师的静态输出中学习.MOPD 的「on-policy」意味着学生模型先生成自己的输出,然后教师模型对这些输出进行评分和指导.

后训练遵循三阶段范式:
1. **Supervised Fine-Tuning**: 在精选的数据对上建立基础指令遵循能力
2. **Domain-Specialized Training**: 通过特定领域的 RL 分别优化多个教师模型,涵盖数学、安全、agentic tool-use 等领域
3. **MOPD**: 单一学生模型在自身的 rollout 下向每个专家教师学习,在 token 级别接受每位专家教师的指导,将他们的能力融合到一个统一模型中

> **译者注**: MOPD 的挑战在于多个教师的反馈信号可能存在冲突.例如,安全教师可能倾向于保守回答,而数学教师可能鼓励精确推理.原文没有披露如何处理这些冲突,但 token 级别的指导暗示了一种细粒度的融合机制——不同 token 位置可能接受不同教师的指导.

### 3.2 Harness Awareness:模型-环境接口的元认知

MiMo-V2.5-Pro 展现出**主动利用 harness 功能来优化执行效率**的能力,这被称为「harness awareness」:

| 能力 | 表现 | 意义 |
|:---|:---|:---|
| 上下文管理 | 主动请求特定上下文格式 | 减少无效 token 消耗 |
| 记忆利用 | 利用 harness 记忆机制避免重复计算 | 提升长程任务效率 |
| 工作流适应 | 调整自身工作流以适应 harness 约束 | 在受限环境中最大化产出 |
| 状态塑造 | 塑造上下文填充方式以服务最终目标 | **元认知级别的策略优化** |

传统 Agent 模型通常将 harness 视为被动容器——模型只关心生成正确的 tool call,而不关心 harness 如何管理状态、如何组织上下文.MiMo-V2.5-Pro 的 harness awareness 意味着它能够主动利用 harness 的功能来优化自己的执行效率.

> **译者注**: Harness Awareness 是 MiMo-V2.5-Pro 的一个独特卖点.原文未披露具体实现,但可以从行为反推:训练数据中可能包含 harness 元数据,模型学会解析;RL 奖励函数可能包含「效率」维度,激励最优路径;自注意力机制可能学习识别 harness 状态标记.如果 Harness Awareness 确实可靠,它可能改变 Agent 系统设计范式:从「为固定模型设计最优 harness」转向「让模型自适应地利用 harness」.

### 3.3 Token 效率:智能的隐性维度

在 ClawEval 上,MiMo-V2.5-Pro 以仅约 **70K tokens per trajectory** 达到 64% Pass^3:

| 模型 | Pass^3 | Tokens/轨迹 | 效率 |
|:---|:---:|:---:|:---|
| MiMo-V2.5-Pro | 64% | **~70K** | **最高** |
| Claude Opus 4.6 | ~64% | ~120K | 中等 |
| Gemini 3.1 Pro | ~64% | ~110K | 中等 |
| GPT-5.4 | ~64% | ~140K | 较低 |

> **译者注**: Token 效率是 2026 年 agentic 模型竞争的关键隐性维度,但它的重要性容易被低估.40-60% 的 token 节省在长程 agentic 任务中是复合的——如果一条轨迹包含 100 次 tool call,每次节省 40% 的 token,总节省可能达到数十万美元(大规模部署时).但这里有一个重要的 caveat:ClawEval 的「per trajectory」token 计数是否包含了 tool call 返回的上下文?如果只计模型输出而忽略工具返回的大型上下文(如代码文件、日志内容),那么「70K tokens」可能低估了真实的成本.

---

## 4. 横向对比:性能全景与竞争定位

### 4.1 MiMo-V2.5-Pro 横向对比

| 基准 | V2.5-Pro | V2-Pro | K2.6 | GLM 5.1 | Claude Opus 4.6 |
|:---|:---:|:---:|:---:|:---:|:---:|
| GDPVal-AA(ELO) | **1581** | 1426 | 1480 | 1535 | 1606 |
| tau^3-bench | 72.9 | 64.5 | 71.0 | 70.6 | 72.4 |
| Claw-Eval | 63.8 | 57.8 | 62.3 | 62.7 | **70.4** |
| SWE-Bench Pro | 57.2 | 55.0 | **58.6** | 58.4 | 57.3 |
| Terminal-Bench 2.0 | **68.4** | 57.1 | 66.7 | 63.5 | 65.4 |

GDPVal-AA ELO 1581 比前代 V2-Pro(1426)提升 155 分,超越 GLM 5.1(1535)和 Kimi K2.6(1480).SWE-Bench Pro 57.2% 与 Claude Opus 4.6(57.3%)几乎持平.Terminal-Bench 2.0 68.4% 超过了 Claude Opus 4.6(65.4%).

### 4.2 与闭源模型的差距

| 基准 | V2.5-Pro | GPT-5.4 | 差距 |
|:---|:---:|:---:|:---:|
| HLE(w/o tools) | 48.0 | 58.7 | -10.7 |
| HLE(with tools) | 34.0 | 42.7 | -8.7 |
| FrontierSWE(rank) | #3.4 | #1.9 | — |

闭源模型在极端难度任务上仍有优势,但差距正在缩小.

### 4.3 Standard vs Pro 选择指南

| 应用场景 | 推荐版本 | 理由 |
|:---|:---|:---|
| 日常编码 | Standard | 成本一半,能力接近 |
| 复杂软件工程 | Pro | SWE-Pro 57.2%,Terminal-Bench 68.4% |
| 长程 Agent 任务 | Pro | 1000+ tool call 稳定性 |
| 多模态理解 | Standard/Pro | 两者均支持,Pro 能力更强 |
| 实时交互 | Standard | 15B 激活参数延迟更低 |
| 成本敏感批处理 | Standard | 1x 倍率 vs 2x |
| 研究/实验 | Standard | 开源权重,MIT 许可 |

---

## 5. 局限性与风险

**多模态能力的技术报告缺失.** MiMo-V2.5 强调「原生视觉和音频理解」,但技术博客中缺乏多模态能力的定量评估:

| 能力 | 声称 | 缺失 |
|:---|:---|:---|
| 视觉推理 | 「与前沿闭源模型同一水平」 | 具体 benchmark 分数 |
| 视频理解 | 「追平 Gemini 3 Pro」 | 视频 benchmark 数据 |
| 音频理解 | 提及但未展开 | 音频 benchmark 数据 |
| 多模态 Agent | 提及但未展开 | 多模态 Agent 基准 |

这种「定性声称 + 定量缺失」的组合降低了多模态能力的可信度.需要等待独立的第三方评测来验证.

**Pro 版本 27T vs Standard 48T 的数据量差异.** Pro 版本虽然总参数和激活参数更多,但训练数据反而更少(27T vs 48T).这个差异可能反映了两种训练策略,但原文没有给出明确解释.如果 Pro 版本的能力提升主要来自后训练而非预训练,那么其泛化能力是否受限于预训练数据的广度,是一个未解问题.

**视频编辑器案例的评估模糊性.** 视频编辑器案例(8,192 行代码,11.5 小时,1,868 次 tool call)缺乏明确的测试套件定义质量边界.「可用的桌面应用」是主观判断,大而有 bug 的系统可能不如小而精的工具.此外,按 $3/1M output tokens 的定价,单次运行可能数百美元,成本结构需要优化.

**Pro 版本 42B 激活参数的推理成本.** MiMo-V2.5-Pro 的 42B 激活参数是 Standard(15B)的 2.8 倍,但 API 倍率仅为 2x.这意味着小米可能在补贴 Pro 版本的使用.对于成本敏感的应用,Standard 版本的 15B 激活参数可能已足够.

**信息来源限制.** MiMo-V2.5 的信息来源是官方博客而非学术论文,技术细节披露有限.五阶段训练的具体数据配比、MOPD 的教师冲突处理机制、Harness Awareness 的具体实现等关键信息未公开,限制了社区的精确复现.

---

## 6. 在多模态 Agent 演进中的位置

2026 年 Q2 的多模态 Agent 竞争格局:

| 模型 | 模态 | 核心优势 | Agentic 能力 |
|:---|:---|:---|:---|
| **MiMo-V2.5** | **文本+视觉+音频** | **Token 效率,Harness Awareness** | **长程 Agent(1000+ tool call)** |
| Gemini 3.1 Pro | 文本+视觉+音频+视频 | 全面领先 | 强 |
| Kimi K2.6 | 文本+视觉 | Agent Swarm | 强(300 子 Agent) |
| GLM-5.1 | 文本 | 长程持续优化 | 强(数百轮迭代) |
| Claude Opus 4.6 | 文本+视觉 | 通用能力 | 强 |

MiMo-V2.5 的独特价值在于:**它是少数完全开源的多模态 Agent 模型之一**,且在 token 效率和长程任务执行上展现出差异化优势.但多模态能力的定量验证仍是关键缺口.

---

> **参考引用**
> - 原文: MiMo-V2.5 / MiMo-V2.5-Pro Technical Blog, Xiaomi AI Lab, 2026-04-22/27
> - 前置阅读: [01-MiMo-V2.5技术博客精译](01-MiMo-V2.5技术博客精译.md)
> - 前代模型: MiMo-V2-Flash 技术报告精译(见 02-MiMo-V2-Flash 目录)
> - 开源仓库: https://github.com/XiaomiMiMo/MiMo-V2-Flash
