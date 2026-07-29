# 第19章: JustRL - 极简主义强化学习 (Simple RL Recipe)

**论文信息**: 
- **标题**: JustRL: Scaling a 1.5B LLM with a Simple RL Recipe
- **作者**: DeepSeek / Open Research (Simulated based on 2512.16649)
- **年份**: 2025 (December)
- **核心理念**: Simplicity is all you need. 复杂的 RL技巧 (Value Network, complex clipping, KL penalties) 往往是有害的. 

**前置知识**: GRPO, REINFORCE

---

## 0. 核心摘要

在 "JustRL" 出现之前，RLHF 被认为是一个极其复杂的流程，需要训练 4 个模型 (Actor, Critic, Ref, Reward)，调节十几个超参数 (KL coeff, Clip range, GAE lambda). 

JustRL 提出并验证了一个惊人的结论: **要激发小模型 (1.5B) 的推理能力，你只需要一个极其简单的“三无”配方**: 
1.  **无 Critic** (No Value Function): 使用 Group Relative Reward 替代. 
2.  **无 PPO Clipping** (No Clipping): 信任域 (Trust Region) 是多余的，如果你的 Step Size 足够小. 
3.  **无复杂重加权** (No Importance Sampling): 直接使用 On-policy 数据. 

JustRL 证明，在数学和代码任务上，这个简单的 "REINFORCE + Group Norm" 配方击败了高度复杂的 ProRL-V2 和 PPO. 

---

## 1. JustRL 的哲学: 奥卡姆剃刀

### 1.1 复杂度的诅咒
传统的 PPO 引入了 Critic 来减少方差. 但 Critic 本身极难训练(见第21章 Scaling Laws). 
如果 Critic 训练不好，它提供的 Advantage 信号就是噪声. 
**JustRL 的观点**: 既然 Critic 可能是瓶颈，不如直接扔掉. 

### 1.2 极简配方 (The Recipe)

算法核心非常简单，可以概括为一行公式: 

$$ \theta_{t+1} \leftarrow \theta_t + \alpha \cdot \frac{1}{G} \sum_{i=1}^G \nabla \log \pi(o_i|q) \cdot \mathbb{A}(o_i) $$

其中 Advantage $\mathbb{A}(o_i)$ 的计算仅依赖于当前 Group 的 Outcome Rewards: 

$$ \mathbb{A}(o_i) = \frac{R(o_i) - \mu_R}{\sigma_R + \epsilon} $$

这本质上就是 **GRPO** 的简化版，去掉了一切花哨的修饰(如 KL 惩罚项，JustRL 认为 Early Stopping 足够控制 KL). 

---

## 2. 关键发现: What Matters & What Doesn't

论文进行了大规模消融实验，发现: 

| 组件 | 传统 RL 观点 | JustRL 发现 | 建议 |
| :--- | :--- | :--- | :--- |
| **Critic Model** | 必须，减少方差 | 有害，引入偏差 | **删除** |
| **PPO Clipping** | 必须，防止跑偏 | 不必要，降低效率 | **删除** |
| **KL Penalty** | 必须，防止Mode Collapse | 阻碍探索 | **删除** (若发散则 Early Stop) |
| **G (Group Size)** | 4~8 即可 | 越大越好 (64+) | **增大** |
| **Length Penalty** | 防止刷长度 | 导致推理变笨 | **删除** |

### 2.1 长度惩罚的副作用
这是 JustRL 的一个重要发现. 过去人们常给长回复加负分. 
JustRL 发现，对于推理任务，**长思维链 (Chain-of-Thought)** 是必要的. 由此产生的 "Verbosity" (啰嗦) 是智能的副产品，不应刻意压制. 强行惩罚长度会导致模型"不敢思考"，从而降低准确率. 

---

## 3. 算法推导

JustRL 的损失函数: 

$$ L(\theta) = - \frac{1}{B} \sum_{q \in \text{Batch}} \frac{1}{G} \sum_{i=1}^G \left( \frac{R_i - \bar{R}}{\sigma_R} \right) \cdot \log \pi_\theta(o_i | q) $$

注意: 
- 没有 `clip(ratio, 1-e, 1+e)`. 
- 没有 `+ beta * KL`. 
- 没有 `+ gamma * ValueLoss`. 

这就使得 JustRL 的显存占用极低. 
对于 1.5B 模型，单卡即可训练. 

---

## 4. 实验结果

在 GSM8K 和 MATH 上，JustRL (1.5B) 达到了 50%+ 的 Pass@1. 
相比之下: 
- PPO (1.5B) 未能收敛或只有 30%. 
- SFT (1.5B) 只有 35%. 

这表明，**对于小模型，RL 的稳定性 (Stability) 比 算法的理论上限 (Theoretical Bound) 更重要**. PPO 虽然理论强，但太脆弱. JustRL 简单粗暴，反而能跑出结果. 

---

## 5. 总结

JustRL 是 RL Scaling 时代的一股清流. 
它告诉我们: **不要在 Infrastructure 上过度工程化**. 
Keep it Simple, Scale it Up.
