---
title: "Tool-integrated Reasoning RL 与 Agentic RL 前沿进展"
date: 2026-05-16
tags: [Agentic RL, Tool-integrated Reasoning, TIR, Search-R1, Multi-turn RL, 综述]
---

# Tool-integrated Reasoning RL 与 Agentic RL 前沿进展

> 本文梳理 2025 年 Tool-integrated Reasoning(TIR)和 Agentic RL 领域的代表性工作，涵盖 Search-R1、ToRL、OTC、RAGEN、SimpleTIR、Memento 和 rStar2-Agent，分析多轮工具调用与强化学习的结合范式、核心挑战与未来方向. 

---

## 1. 领域背景: 从单轮 RL 到多轮 Agentic RL

传统 RLHF/RLVR 训练的是单轮问答策略 $\pi_\theta(y|x)$——给定输入 $x$，模型生成回答 $y$，奖励函数根据 $y$ 的质量打分. 然而，当模型需要与外部工具(搜索引擎、代码解释器、数据库)进行多轮交互时，策略的定义扩展为: 

$$
\pi_\theta(a_t | s_t), \quad s_t = (x, a_1, o_1, \dots, a_{t-1}, o_{t-1}) \tag{1}
$$

其中 $a_t$ 为第 $t$ 步的动作(生成文本或调用工具)，$o_t$ 为环境/工具的观测反馈. 这种多轮交互引入了三个新挑战: 

1. **信用分配**: 最终任务成功时，哪一步的决策(搜索关键词、工具调用时机)应获得正信用？
2. **稀疏奖励**: 只有任务完成时才有反馈，中间步骤缺乏密集监督信号. 
3. **工具噪声**: 工具返回结果的质量不稳定(搜索可能返回无关内容、代码可能执行失败)，噪声会通过信用分配污染策略更新. 

---

## 2. 代表性工作

### 2.1 Search-R1: 训练 LLM 利用搜索引擎推理(UIUC, 2025.03)

Search-R1 是较早将 DeepSeek-R1 的 RL 方法扩展到搜索工具的完整框架. 核心贡献: 

- **搜索与推理的交替训练**: 模型在推理过程中可以调用 `<search>` 工具，搜索结果插入到上下文后继续推理. RL 优化同时作用于"何时搜索"、"搜索什么"和"如何利用搜索结果". 
- **稳定性保障**: 针对搜索引擎返回结果不稳定的问题，引入结果重采样和置信度过滤，降低工具噪声对策略更新的影响. 
- **端到端优化**: 不同于先训练推理能力再叠加工具的模块化方案，Search-R1 从初始阶段就将搜索调用纳入 RL 的优化目标. 

### 2.2 ToRL: Scaling Tool-Integrated RL(SJTU, 2025.03)

ToRL 聚焦 TIR 的规模扩展问题. 核心发现: 

- **工具调用的涌现**: 当模型规模超过 7B 且训练步数足够时，模型自发学会"在不确定时主动调用工具"的行为，无需显式监督. 
- **多工具协同**: ToRL 训练模型同时管理多个工具(搜索 + 计算器 + 代码解释器)，模型学会根据问题类型自动选择最合适的工具组合. 

### 2.3 OTC: Optimal Tool Calls via RL(2025.03)

OTC 从最优控制的角度分析工具调用策略. 将工具调用建模为**部分可观察马尔可夫决策过程(POMDP)** ，其中工具返回结果为观察值，真实世界状态对模型不可见. OTC 引入信息增益作为辅助奖励信号: 

$$
R_{\text{info}}(a_t) = H(s_t) - \mathbb{E}_{o_t}[H(s_t | o_t)] \tag{2}
$$
此式将上述直觉形式化，各项分别对应输入变换、非线性激活与输出生成. 

即鼓励模型选择能够最大程度减少状态不确定性的工具调用. 这使得模型在信息不足时主动探索(调用工具)，在信息充分时停止探索(直接回答). 

### 2.4 RAGEN: 理解 LLM Agent 的自我进化(2025.05)

RAGEN 的核心贡献是**多轮 RL 中的自我进化分析**. 通过大规模实验，作者发现: 

- **能力涌现曲线**: Agent 的工具使用能力不是线性增长的，而是在训练约 60% 总步数时出现相变——此前模型主要依赖内部知识，此后主动工具调用频率急剧上升. 
- **策略多样性崩溃**: 若不加约束，多轮 RL 容易收敛到单一策略(如"所有问题都搜索")，损失策略多样性. RAGEN 通过熵正则化和探索奖励维持策略多样性. 

### 2.5 SimpleTIR: 端到端多轮 TIR(NTU, 2025.07)

SimpleTIR 强调**简化即强大**. 与 Search-R1 等复杂框架不同，SimpleTIR 证明: 仅需二元奖励(最终答案正确/错误)和基础 GRPO，即可训练出有效的多轮工具调用策略. 其极简配方包括: 

- 单阶段训练，无课程学习
- 固定超参数，无动态调度
- 严格二元奖励，无中间步骤奖励

实验表明，SimpleTIR 在多个 TIR 基准上与复杂基线持平或更优，验证了"基础配方足够好"的假设. 

### 2.6 Memento: 不微调 LLM 的 Agent 微调(UCL & Huawei, 2025.08)

Memento 提出了一种反直觉的方案: **不更新 LLM 权重，仅微调工具调用策略**. 其核心洞察是: 大模型的内部知识已足够强大，Agent 能力的瓶颈不在于模型本身，而在于"何时、如何调用工具"的决策策略. 

Memento 将工具调用策略参数化为一个小型适配器(Adapter)，冻结 LLM 权重，仅通过 RL 训练适配器. 这不仅大幅降低了训练成本，还避免了微调 LLM 可能导致的通用能力退化. 

### 2.7 rStar2-Agent: Agentic 推理技术报告(MSRA, 2025.08)

rStar2-Agent 将微软的 rStar(推理自举)方法扩展到 Agent 场景. 核心设计: 

- **多路径探索**: 在每一步生成多个候选动作(不同工具调用 + 不同参数)，并行执行并评估结果
- **回溯机制**: 当某条路径进入死胡同时，自动回溯到最近的分叉点尝试替代路径
- **策略蒸馏**: 将多路径探索中表现最佳的轨迹蒸馏为单路径策略，提升推理效率

---

## 3. 技术趋势总结

| 方向 | 核心进展 | 开放问题 |
|:-----|:--------|:--------|
| **单工具 → 多工具** | 模型学会管理工具组合 | 工具间冲突如何解决？ |
| **端到端训练 → 模块化训练** | Memento 冻结 LLM 仅训策略 | 适配器的表达能力上限？ |
| **复杂奖励 → 极简奖励** | SimpleTIR 证明二元奖励足够 | 极简配方在多模态上的泛化性？ |
| **单路径 → 多路径探索** | rStar2 的并行探索 + 回溯 | 计算成本与探索深度的权衡？ |
| **工具调用 → 自我进化** | RAGEN 的相变现象 | 自我进化的可控性与安全性？ |

---

## 4. 未来方向

**工具创造(Tool Creation)** . 当前 TIR 假设工具集合是固定的，未来模型可能自主学习何时需要新工具、如何设计工具接口、甚至自动生成工具实现(如编写 Python 函数). 这从"使用工具"跃迁到"创造工具"，是 Agent 能力质变的标志. 

**跨模态工具调用**. 将 TIR 从文本工具(搜索、代码)扩展到视觉工具(图像生成、视频编辑)和物理工具(机器人控制、实验设备)，实现真正意义上的"多模态 Agent". 

**社会性工具调用**. 多 Agent 共享工具池，通过工具调用的协调实现协作(如一个 Agent 搜索、另一个 Agent 分析、第三个 Agent 总结). 工具从个人能力的延伸转变为社会协作的媒介. 

---

## 5. 参考文献

1. **Search-R1: Training LLMs to Reason and Leverage Search Engines with Reinforcement Learning**
   - UIUC, 2025.03.

2. **ToRL: Scaling Tool-Integrated RL**
   - SJTU, 2025.03.

3. **OTC: Optimal Tool Calls via Reinforcement Learning**
   - 2025.03.

4. **RAGEN: Understanding Self-Evolution in LLM Agents via Multi-Turn Reinforcement Learning**
   - 2025.05.

5. **SimpleTIR: End-to-End Reinforcement Learning for Multi-Turn Tool-Integrated Reasoning**
   - NTU, 2025.07.

6. **Memento: Fine-tuning LLM Agents without Fine-tuning LLMs**
   - UCL & Huawei, 2025.08.

7. **rStar2-Agent: Agentic Reasoning Technical Report**
   - MSRA, 2025.08.

> 参考来源: [2025 年 Tool-integrated Reasoning RL 及 Agentic RL 论文总结](https://zhuanlan.zhihu.com/p/1946169580193055874)
