# Agentic 能力训练：从 GLM-5 看基座大模型的完整链路

> 来源: 知乎专栏 (https://zhuanlan.zhihu.com/p/32098458322)
> 标签: #AgenticRL #GLM-5 #数据合成 #训推一致 #AgentSwarm

## 1. 演进脉络：现代大模型训练的"分阶段建模"趋势

### 1.1 从"一阶段解决所有问题"到"分阶段收敛"

传统 LLM 训练常被简化为"预训练 + SFT + RLHF"三阶段. 但 GLM-5、MiniMax M2、Kimi K2.5 等前沿模型的实践表明，**一个真正具备 Reasoning、Coding 和 Agent 能力的现代大模型，需要更细粒度的分阶段训练**：

```
海量通用语料打底
    ↓
长上下文 + Agent 数据强化(Mid-Training)
    ↓
监督学习塑形(SFT)
    ↓
多阶段 RL 提升推理与执行能力
    ↓
跨阶段蒸馏"缝合"能力，避免遗忘
```

这种"分阶段建模、分阶段强化、最后统一收敛"的范式，反映出大模型训练从"粗放式堆数据"向"精细化能力编排"的演进. 

### 1.2 GLM-5 的七阶段训练流程

| 阶段 | 子阶段 | 核心目标 | 关键动作 |
|------|--------|---------|---------|
| **Base** | Pre-Training | 通用语言、知识、代码基础 | 28.5T tokens，Web + Code + Math |
| **Base** | Mid-Training | 定向增强长上下文与 Agent 适配 | 上下文扩展至 200K，repo-level code |
| **Post** | SFT | 建立任务遵循、工具使用行为先验 | General Chat + Reasoning + Coding + Agent |
| **Post** | Reasoning RL | 提升复杂推理正确性 | 数学、科学、代码可验证任务 |
| **Post** | Agentic RL | 多步决策、工具调用、环境执行 | SWE、Search、Terminal 可验证环境 |
| **Post** | General RL | 通用场景正确性与人类偏好 | 正确性 + 情感智能 + 任务质量 |
| **Post** | OPD | 融合各阶段能力，防止遗忘 | On-policy 跨阶段蒸馏 |

---

## 2. Agentic RL：让模型在真实环境里"把事情做出来"

### 2.1 Agentic RL 与 Reasoning RL 的本质区别

| 维度 | Reasoning RL | Agentic RL |
|------|-------------|-----------|
| 核心问题 | "能不能想清楚" | "能不能在真实环境里一步一步做出来" |
| 训练目标 | 生成更好的答案 | 在复杂任务中具备稳定的行动能力 |
| 典型场景 | 数学证明、代码生成 | 软件工程修复、多步搜索、终端操作 |
| 反馈来源 | 结果正确性(pass/fail) | 环境执行结果(测试通过、任务完成度) |
| 轨迹长度 | 通常较短(数百 token) | 通常很长(数千至数万 token) |

### 2.2 Agentic RL 的四步训练流程

**Step 1：准备任务和可验证环境**

Agentic RL 的前提是"可验证"——任务必须有明确的完成标准和自动化验证手段：

- **SWE 环境**：基于真实 GitHub Issue-PR 对构建修复任务，自动搭建 repo 环境，用 test script 验证
- **Terminal 环境**：构造需要在 shell / Docker / 文件系统中操作的任务
- **Search 环境**：构造多跳搜索问题，需要 search / open / extract / python 等工具调用

**Step 2：Rollout 生成 Agent 轨迹**

模型不是一次性输出答案，而是生成整条交互轨迹：

$$
y = (r_1, a_1, o_1, r_2, a_2, o_2, ..., r_n, a_n, o_n)
$$

其中：
- $r_i$：reasoning / thinking(模型内部思考)
- $a_i$：action / tool call(工具调用)
- $o_i$：observation / 环境反馈

**Step 3：环境打分**

任务结束后，环境根据结果给 reward：

- SWE：测试是否通过(F2P + P2P tests)
- Search：答案是否正确
- Terminal：脚本是否通过

所有 reward 都是**规则化、可验证的**，不依赖人工标注或奖励模型. 

**Step 4：Group-wise Policy Optimization**

对同一个问题 $x$，采样 $K$ 条轨迹 $\{y_1, ..., y_K\}$，构造组内相对优势：

$$
A(x, y_i) = r(x, y_i) - \bar{r}(x), \quad \bar{r}(x) = \frac{1}{K}\sum_{i=1}^{K} r(x, y_i)
$$

这与 GRPO 的核心思想一致：用组内统计替代 Critic，降低训练成本. 

---

## 3. On-Policy Distillation：跨阶段能力融合与防遗忘

### 3.1 为什么需要 OPD？

多阶段训练的核心矛盾：**新阶段提升特定能力时，会遗忘前阶段已习得的能力**. 

| 方法 | 问题 |
|------|------|
| 传统 SFT | 直接拟合新任务分布，参数被过度拉向新数据，灾难性遗忘 |
| 一般 RL | 依赖稀疏奖励，擅长"让模型做得更对"，不擅长细粒度知识传递 |
| **OPD** | 结合 on-policy 采样的防遗忘特性 + 蒸馏的高密度知识传递 |

### 3.2 OPD 的核心机制

OPD(On-Policy Distillation)的本质是：**让学生模型在自己的轨迹上学习，由教师提供逐 token 的纠错信号**. 

**流程**：

1. Student 按自己的当前策略生成轨迹 $y \sim \pi_{\text{student}}$
2. 多个教师模型(各阶段最优 checkpoint)对同一轨迹打分
3. 构造 advantage：

$$
\text{adv}_t = \log \pi_{\text{teacher}}(y_t|x, y_{<t}) - \log \pi_{\text{student}}(y_t|x, y_{<t})
$$

4. 用该 advantage 替换策略优化损失中的优势项，更新 student

**直觉解释**：

- $\text{adv}_t > 0$：teacher 比 student 更认可这个 token → 提高该 token 概率
- $\text{adv}_t < 0$：student 已经比 teacher 更高 → 降低该 token 概率

**关键优势**：

- **On-policy**：student 在自己的轨迹上学习，避免 off-policy 的分布偏移
- **Dense signal**：逐 token 的梯度，比稀疏 reward 更精细
- **Multi-teacher**：融合 SFT、Reasoning RL、General RL 各阶段能力

---

## 4. Agentic 数据合成：不是合成文本，而是合成任务+环境+反馈+轨迹

### 4.1 数据合成的标准流水线

Agentic 数据合成的核心目标：构造**真实可执行的任务环境**，让模型在环境中真实交互，产生可验证的长轨迹. 

**六步流水线**：

```
选择种子任务(GitHub Issue、真实终端场景、网页语料)
    ↓
转化为可执行任务(搭建环境、编写测试脚本)
    ↓
执行与轨迹采集(Agent 在环境中真实交互)
    ↓
结果验证与反馈(测试通过、答案正确)
    ↓
数据筛选与过滤(去重、难度分层、exploit 检查)
    ↓
转化为训练数据(SFT 轨迹 或 RL 任务+环境+奖励)
```

### 4.2 三类典型 Agent 任务的数据合成

#### 4.2.1 SWE(软件工程)

- **种子**：真实 GitHub Issue-PR 对
- **转化**：提取 issue 描述，基于 PR 前的 repo 状态搭建环境
- **验证**：F2P(fix-to-pass)测试 + P2P(pass-to-pass)回归测试
- **防 exploit**：检查是否通过删代码、禁用测试等"假修复"

#### 4.2.2 Terminal(终端操作)

- **种子**：真实终端操作场景、系统管理任务
- **转化**：在 Docker 容器中构造可执行操作序列
- **验证**：脚本执行结果、文件状态检查

#### 4.2.3 Search(多跳搜索)

**核心挑战**：构造模型不能靠记忆或一次搜索就答对的问题. 

**方法**：

1. **从网页抽取知识图谱**：识别实体和关系
2. **采样低频实体作为起点**，向外扩展多跳邻域
3. **改写成自然语言问题**，使问题隐含多跳关系链
4. **过滤**：去掉"不用搜索也能答"和"一次搜索就能解决"的题
5. **验证**：答案唯一性、证据链闭合、跨页面一致性

**示例**：

> "2022 年带领阿根廷赢得世界杯冠军的队长，目前效力于哪家俱乐部？这家俱乐部所在城市的 NBA 球队主场球馆叫什么名字？"

多跳链条：世界杯队长 → 梅西 → 迈阿密国际 → 迈阿密 → 热火 → Kaseya Center

### 4.3 数据质量控制：从"有数据"到"有好数据"

| 检查项 | 目的 |
|--------|------|
| 结果正确性验证 | 确认目标测试通过 |
| 环境稳定性检查 | 确保结果不是偶发成功 |
| 捷径 / exploit 检查 | 避免 Agent 通过 bypass 逻辑"假修复" |
| 一致性检查 | 轨迹中的分析、修改与测试结果彼此一致 |
| 难度过滤 | 剔除过于简单或无法稳定评测的任务 |
| 样本去重 | 避免高度相似任务影响训练分布 |
| 轨迹修复 | 局部噪声可裁剪或 masking |

---

## 5. 训练挑战与工程解法

### 5.1 训练-推理不一致(Train-Inference Mismatch)

**问题**：训练时模型更新参数用的是一种分布，采样生成时轨迹却来自另一种分布，导致梯度估计偏差. 

**GLM-5 解法：IcePop**

显式区分训练策略 $\pi_{\text{train}}$ 和推理策略 $\pi_{\text{infer}}$，定义不匹配比率：

$$
\rho_{i,t} = \frac{\pi_{\theta_{\text{old}}}^{\text{train}}(y_{i,t}|x, y_{i,<t})}{\pi_{\theta_{\text{old}}}^{\text{infer}}(y_{i,t}|x, y_{i,<t})}
$$

通过 pop 函数抑制偏离过大的样本：

$$
\text{pop}(\rho, 1/\beta, \beta) = \begin{cases} \rho, & 1/\beta \le \rho \le \beta \\ 0, & \text{otherwise} \end{cases}
$$

**效果**：过滤训练和推理严重不一致的 token，减少异常梯度和训练震荡. 

### 5.2 DSA 带来的额外不一致

**问题**：DSA 的 top-k 检索结果决定模型"看到哪些上下文"，训练和推理时 top-k 不一致会放大分布偏移. 

**GLM-5 解法**：

1. **确定性 top-k**：使用 `torch.topk` 替代非确定性 CUDA 实现，保证相同输入下输出一致
2. **冻结 Indexer**：RL 阶段不更新 indexer 参数，避免检索模块本身漂移

**实验现象**：非确定性 top-k 导致 RL 训练几步后出现性能下降 + 熵快速下滑; 切换为确定性后训练稳定. 

### 5.3 异步框架的 Off-Policy 问题

**问题**：推理引擎和训练引擎解耦后，rollout 用的模型版本与训练时的当前模型不一致，甚至同一条轨迹内部可能混杂多个策略版本. 

**GLM-5 的三层解法**：

| 层级 | 方法 | 原理 |
|------|------|------|
| **权重同步** | 每隔 K 次梯度更新同步权重 + 重置优化器动量 | 让 rollout policy 与 current policy 不要差太远 |
| **重要性采样裁剪** | 双边裁剪 $[1-\epsilon_l, 1+\epsilon_h]$，超出范围的 token mask 掉 | 丢弃严重过时的数据 |
| **样本 freshness 控制** | 记录轨迹经历的模型版本 $(w_0, ..., w_k)$，若 $w' - w_0 > \tau$ 则丢弃 | 主动过滤陈旧轨迹 |

**核心思想**：不是追求理论上最完美的 off-policy 校正，而是"能救的就救，太偏的直接丢掉"，追求大规模 Agent 训练中的稳定和可落地. 

### 5.4 Kimi K2.5 的 Agent Swarm：并行降低延迟

**动机**：复杂任务中串行执行的推理时间随任务长度线性增长，延迟难以接受. 

**核心设计**：

- **可训练的 Orchestrator** + **冻结的 Subagents**
- Orchestrator 负责拆任务、创建子代理、分配任务
- Subagents 来自固定 checkpoint，不随训练更新

**为什么不端到端训练所有 agent？**

1. **信用分配模糊**：最终结果好不代表每个 subagent 都做对
2. **训练不稳定**：多智能体联合优化 credit 难以分清

**奖励设计(PARL)**：

$$
r_{\text{PARL}}(x,y) = \lambda_1 \cdot r_{\text{parallel}} + \lambda_2 \cdot r_{\text{finish}} + r_{\text{perf}}(x,y)
$$

| 奖励项 | 作用 |
|--------|------|
| $r_{\text{parallel}}$ | 鼓励实例化 subagent，防止退化为单 agent 串行 |
| $r_{\text{finish}}$ | 奖励子任务真正完成，防止无效并行 |
| $r_{\text{perf}}$ | 任务层面的最终结果奖励 |

**训练后期**：辅助奖励 $r_{\text{parallel}}$ 和 $r_{\text{finish}}$ 逐渐衰减至 0，最终回到核心任务目标. 

**Context Management**：

传统方法(Hide-Tool-Result、Summary、Discard-all)是上下文太长后的**被动裁剪**. Agent Swarm 在一开始就把长任务拆成多个语义隔离的子任务，每个 subagent 在局部上下文工作，是**主动的上下文管理**. 

---

## 6. 边界条件与失效模式

| 场景 | 症状 | 根因 | 缓解 |
|------|------|------|------|
| Agentic 任务不可验证 | 奖励信号不可靠，RL 训练失效 | 缺乏明确的完成标准和自动化测试 | 只选择有明确 pass/fail 标准的任务 |
| 轨迹过长 | 训练极慢，GPU 空转 | 长链路的工具调用和环境执行 | 异步 RL 框架 + 轨迹截断 + 难度分层 |
| 数据分布偏移 | Agent 在新环境中表现差 | 训练环境覆盖不足 | 持续扩展环境类型，动态更新任务库 |
| 并行奖励过度 | "乱开 agent"，无效并行 | $r_{\text{parallel}}$ 权重过高 | 配合 $r_{\text{finish}}$ 和后期衰减 |
| 多阶段遗忘 | 新阶段训练后旧能力下降 | 参数被过度拉向新任务 | OPD 跨阶段蒸馏 + 周期性能力评估 |
| DSA top-k 不一致 | RL 训练几步后性能骤降 | 非确定性 top-k 导致上下文不一致 | 确定性 top-k + 冻结 indexer |

---

## 7. 技术前瞻

1. **可验证任务的自动扩展**：当前 Agentic 数据合成依赖人工设计环境和验证器，未来可能通过 LLM 自动生成可验证任务
2. **世界模型(World Model)**：让模型学习环境的内部模拟，在"想象"中规划而非真实交互，降低 rollout 成本
3. **多模态 Agentic RL**：从纯文本扩展到视觉-语言-行动的统一 Agent，在 GUI、机器人等环境中训练
4. **持续学习新范式**：OPD 有望成为持续学习的标准方法，统一"减少遗忘"和"吸收新知识"两个目标

---

## 8. 参考文献

1. GLM-5 Technical Report. (2025). https://www.zhipu.ai/
2. MiniMax M2 Technical Report. (2025).
3. Kimi K2.5 Technical Report. (2025).
4. Shao, Z., et al. (2024). DeepSeekMath: Pushing the Limits of Mathematical Reasoning in Open Language Models. arXiv:2402.03300.
5. IcePop: Mitigating Train-Inference Mismatch in LLM RL. (2025).
