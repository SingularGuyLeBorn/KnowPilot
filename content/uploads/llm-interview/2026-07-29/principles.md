---
title: "原理与机制"
category: null
tags:
  - "原理"
  - "预训练"
  - "SFT"
  - "RLHF"
  - "KV Cache"
  - "反转诅咒"
  - "涌现"
  - "Scaling Law"
  - "Agent框架"
published: true
excerpt: null
---
# 原理与机制

> ⚠️ **时效性说明**：本专题收录 LLM 核心原理题。2024-2026 年有效，前沿题（反转诅咒、Agent 框架）已标注年份。
>
> **来源**：图解大模型200问、掘金面经、AgentGuide、知乎、论文阅读

---

## 1. 预训练 → SFT → RLHF 三阶段的关系与区别

- **元数据**：`{topic: "原理·训练流程", subtopic: "三阶段", source: "图解大模型200问+掘金", quality: 5, year: "经典题·持续有效", difficulty: mid}`

**三个阶段的核心定位**：

| 阶段 | 目标 | 数据规模 | 数据类型 | 损失函数 | 代表模型状态 |
|---|---|---|---|---|---|
| 预训练 | 学习通用语言知识 | TB 级 | 网页/书籍/代码 | NTP (CrossEntropy) | base model |
| SFT | 学会指令遵循 | 万~十万级 | (指令, 回答) 对 | CrossEntropy | chat model |
| RLHF | 价值观对齐 | 万级偏好排序 | 回答 A > B | PPO/DPO/GRPO | aligned model |

**高频追问**：
- 「为什么不能直接用 RLHF 不用 SFT？」→ SFT 提供了"回答格式"的先验知识，否则 RL 搜索空间过大，模型容易发散
- 「三阶段是否可以合并？」→ 尝试过，目前效果都不如分离式好
- 「DPO 跳过 RM 是否一定优于 PPO？」→ DPO 省显存但表达能力有限，PPO + 好的 RM 效果上限更高

---

## 2. KV Cache 为什么能加速推理？Q 为什么不能 cache？

- **元数据**：`{topic: "原理·推理优化", subtopic: "KV Cache", source: "图解大模型200问+AgentGuide", quality: 5, year: "经典题·持续有效", difficulty: mid}`

**核心原理**：自回归生成中，每个新 token 的注意力计算需要所有历史 token 的 K 和 V。历史 token 的 K/V 只依赖于此前 token，对所有未来位置不变 → 可缓存。

**Q 为什么不能 cache**：当前要生成的 token 的 query 每次不同（Q = x_new · W_Q），x_new 是新 token 的 embedding，每次生成都变化。

**优化效果对比**（以 LLaMA-7B, 输入1024, 输出1024 为例）：
| 推理方式 | 每步计算量 | 总时间 |
|---|---|---|
| 无 KV Cache（每步重算全序列） | O(N²) | ~10× 慢 |
| 有 KV Cache | O(N) | 1× |

**显存计算公式**：2 × n_layers × n_heads × seq_len × head_dim × bytes_per_param（2 表示 K 和 V）

---

## 3. 反转诅咒（Reversal Curse）是什么？扩散模型为什么免疫？

- **元数据**：`{topic: "原理·模型缺陷", subtopic: "Reversal Curse", source: "论文+知乎面经", quality: 4, year: "2025-2026", difficulty: senior}`

**定义**：自回归（AR）语言模型能从「A 是 B」学到事实，但不能反向推出「B 是 A」。这是因为因果注意力中，位置 m 只能看到位置 < m 的 token，信息流有严格方向性。

**实验验证**：
- 训练数据含「姚明的妻子是叶莉」
- 测试「叶莉的丈夫是谁」
- AR 模型失败（<10%），非 AR 模型（如扩散模型）成功（>80%）

**扩散模型为什么免疫**：扩散模型（如 D3PM、MDLM、LLaDA）的去噪过程在所有位置同时进行，每个位置都能看到完整的上下文，不存在单向信息流，因此不受到反转诅咒影响。

**追问**：「这说明了自回归架构的什么根本问题？」→ AR 模型本质上是一个方向性的概率链 P(x₁)·P(x₂|x₁)·...，不建模双向依赖。这是因果架构的天花板而非数据或规模问题。

---

## 4. 涌现能力的产生原因与 Scaling Law

- **元数据**：`{topic: "原理·理论", subtopic: "涌现与Scaling", source: "图解大模型200问+掘金", quality: 4, year: "2024-2026", difficulty: mid}`

**涌现现象**：模型达到某参数量（~10B+）后，突然出现此前没有的能力（如数学推理、代码生成）。

**主流解释**：
1. **非线性指标假说**：用离散/非线性指标（如准确率）评测，阈值附近看起来"涌现"。若用连续指标（如交叉熵），实际上是平滑提升
2. **能力组合假说**：小模型有子能力但不会组合，大模型学会组合子能力
3. **数据覆盖假说**：训练数据中存在关键模式，小模型参数量不足以记忆，大模型刚好能记住

**Scaling Law 现状（2026版）**：
- 经典定律（OpenAI 2020）：Loss = a·N^(-α) + b·D^(-β)
- Chinchilla 最优配比：~20 tokens / 参数
- **2025-2026 新方向**：
  - 数据墙（Data Wall）：人类文本数据即将耗尽
  - 推理时 Scaling（Test-time Compute）：o1 系列通过增加推理思维链 token 提升质量
  - 合成数据 + RL 的 Scaling：DeepSeek R1 展示的路线

**追问**：「Scaling Law 是否已到尽头？」→ 预训练 scaling 趋缓，但推理时 scaling 和 RL 训练时 scaling 才刚刚开始。

---

## 5. Agent = LLM + Planning + Tool + Memory 框架解析

- **元数据**：`{topic: "原理·Agent框架", subtopic: "Agent架构", source: "AgentGuide+菜鸟教程+知乎", quality: 5, year: "2025-2026", difficulty: mid}`

**四要素框架**：
```
Agent = LLM (大脑) + Planning (规划) + Tool Use (执行) + Memory (记忆)
```

| 组件 | 作用 | 技术实现 |
|---|---|---|
| **LLM** | 理解、推理、生成 | GPT/Qwen/DeepSeek/LLaMA |
| **Planning** | 拆解任务、制定步骤 | ReAct、Plan & Execute、Tree-of-Thought |
| **Tool Use** | 调用外部工具/API | Function Calling、MCP、自定义API |
| **Memory** | 短期/长期记忆 | Context window、向量DB（长期）、摘要记忆 |

**Agent 循环（典型 ReAct）**：
```
User Input → Thought → Action → Observation → Thought → ... → Final Answer
```

**追问**：「Memory 怎么分层的？」→ Working Memory（当前上下文 ~128K）→ Episodic Memory（历史对话摘要）→ Semantic Memory（知识库检索）。

---

## 6. 大模型为什么需要对齐？RLHF 与 DPO 的本质区别

- **元数据**：`{topic: "原理·对齐", subtopic: "RLHF vs DPO", source: "图解大模型200问+DeepSeek报告", quality: 5, year: "2025-2026", difficulty: senior}`

**对齐的必要性**：预训练模型学的是"语料中的统计规律"，不是"人类想要的回答"。对齐让模型变得有用、诚实、无害（HHH）。

**RLHF 流程**：
1. SFT 基座 → 2. 人类标注偏好 → 3. 训练 Reward Model → 4. PPO 优化策略

**DPO 核心创新**：跳过显式 RM，将偏好直接转化为策略优化目标：
```
L_DPO = -E[log σ(β·log(π_θ(y_w|x)/π_ref(y_w|x)) - β·log(π_θ(y_l|x)/π_ref(y_l|x)))]
```

**本质区别**：
| 维度 | RLHF (PPO) | DPO |
|---|---|---|
| 算法类别 | On-policy + 重要性采样 | Offline 偏好优化 |
| Reward Model | ✅ 需要额外训练 | ❌ 不需要 |
| 显存需求 | 极高（4个模型） | 低（2个模型） |
| 训练稳定性 | 敏感，需调参 | 较稳定 |
| 上限潜力 | 更高（有独立RM） | 受限于偏好数据 |
| 代表应用 | ChatGPT/GPT-4 | 小团队微调场景 |

**2026 年趋势**：GRPO（DeepSeek R1）不需要 RM，用组内奖励代替，兼顾了 DPO 的简洁和 PPO 的效果。

---

## 7. GQA 和 MLA 如何解决 MHA 的推理瓶颈？

- **元数据**：`{topic: "原理·注意力机制", subtopic: "GQA vs MLA", source: "图解大模型200问+DeepSeek报告", quality: 5, year: "2025-2026", difficulty: senior}`

**MHA 的瓶颈**：每个 head 独立 K/V → KV Cache 随 n_heads 线性增长（如 70B 模型 ~64 heads），推理时显存爆炸。

**GQA（分组查询注意力）**：
- 将 heads 分成 G 组，每组共享一组 K/V
- LLaMA 2-70B：64 Q-heads, 8 KV-heads → KV Cache 压缩 8×
- 效果损失很小（K/V 编码内容信息，多样性主要来自 Q）

**MLA（多头潜在注意力 - DeepSeek）**：
- 核心：对 K/V 做低秩投影（类似 LoRA 风格）
- 将 K/V 压缩到低维 latent space，计算时再恢复
- 配合 Partial RoPE（部分维度旋转，部分不做）
- KV Cache 压缩比可达 30× 以上

**对比**：
| | MHA | MQA | GQA | MLA |
|---|---|---|---|---|
| KV Cache 压缩 | 1× | ~8× | ~4× | ~30× |
| 效果损失 | 基线 | 略微 | 极小 | 无（甚至更好）|
| 代表模型 | 原始Transformer | PaLM | LLaMA 2/3 | DeepSeek V2/V3 |

---

## 来源汇总

- Bojie Li《图解大模型》面试 200 问
- AgentGuide 面经 + 技术博客
- 掘金·大模型面试题讲解
- DeepSeek V2/V3/R1 技术报告
- LLaDA / MDLM 扩散语言模型论文
- Chinchilla / OpenAI Scaling Law 论文
