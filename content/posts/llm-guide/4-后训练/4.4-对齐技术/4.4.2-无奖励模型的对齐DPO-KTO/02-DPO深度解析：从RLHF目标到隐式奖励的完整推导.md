# DPO 深度解析：从 RLHF 目标到隐式奖励的完整推导

> 来源: 知乎专栏 (https://zhuanlan.zhihu.com/p/32098458322)
> 标签: #DPO #RLHF #隐式奖励 #Bradley-Terry #偏好优化

## 1. 演进脉络：为什么需要 DPO？

### 1.1 RLHF 的三步复杂性

标准 RLHF 流程需要三个独立阶段：

```
收集偏好数据 → 训练奖励模型 → 用 PPO 优化策略
```

**痛点**：
- **计算成本高**：PPO 需维护策略、参考、奖励、Critic 四个模型副本
- **训练不稳定**：PPO 的 clip、GAE、重要性采样等超参敏感
- **奖励 hacking**：模型可能学会欺骗奖励模型而非真正对齐人类偏好

### 1.2 DPO 的核心洞察

DPO(Direct Preference Optimization)的突破性发现：

> **"你的语言模型本身就是秘密的奖励模型. "**

DPO 证明：RLHF 的最优策略可以写成**闭式解析解**，从中可反解出奖励函数——这个"隐式奖励"完全由策略和参考策略的概率比值决定，**无需单独训练奖励模型**. 

### 1.3 DPO vs RLHF 对比

| 维度 | RLHF (PPO) | DPO |
|------|-----------|-----|
| **训练阶段** | 3 步(数据→奖励模型→RL) | 1 步(端到端偏好学习) |
| **模型副本** | 4 个(策略+参考+奖励+Critic) | 2 个(策略+参考) |
| **算法类型** | 在线 RL | 离线监督学习 |
| **损失函数** | PPO clip + value loss | 二元交叉熵( ranking loss) |
| **超参敏感度** | 高(clip、GAE、KL 系数) | 低(主要调 $\beta$) |
| **代表性模型** | InstructGPT, LLaMA-2 | Zephyr, Llama-3-Instruct |

---

## 2. 理论推导：四步从 RLHF 到 DPO

### 2.1 第一步：RLHF 的最优策略解析解

标准 RLHF 的优化目标：

$$\max_{\pi_\theta} \mathbb{E}_{x \sim \mathcal{D}, y \sim \pi_\theta(y|x)} \left[ r(x,y) \right] - \beta D_{\text{KL}}(\pi_\theta(y|x) \| \pi_{\text{ref}}(y|x))$$

**目标解读**：
- 第一项：最大化期望奖励
- 第二项：KL 散度约束，防止策略偏离参考模型太远
- $\beta$：控制对齐强度($\beta$ 越小，策略越激进)

**变分求解**：

对目标函数关于 $\pi_\theta(y|x)$ 求变分导数并令其为零，可得**最优策略的闭式解**：

$$\pi^*(y|x) = \frac{1}{Z(x)} \pi_{\text{ref}}(y|x) \exp\left( \frac{1}{\beta} r(x,y) \right)$$

其中 $Z(x) = \sum_y \pi_{\text{ref}}(y|x) \exp\left( \frac{1}{\beta} r(x,y) \right)$ 是配分函数，确保概率归一化. 

**关键理解**：

最优策略由参考策略按奖励**指数加权**得到. 奖励越高的回复，获得的概率提升越大; $\beta$ 控制提升的"锐度"——$\beta \to 0$ 时只有最高奖励的回复获得所有概率，$\beta \to \infty$ 时退回到参考策略. 

**配分函数的验证**：

$$\sum_y \pi^*(y|x) = \frac{1}{Z(x)} \sum_y \pi_{\text{ref}}(y|x) \exp\left( \frac{1}{\beta} r(x,y) \right) = \frac{Z(x)}{Z(x)} = 1$$

满足概率分布的基本要求. 

### 2.2 第二步：从最优策略反解隐式奖励

对最优策略的表达式取对数并整理：

$$\log \pi^*(y|x) = \log \pi_{\text{ref}}(y|x) + \frac{1}{\beta} r(x,y) - \log Z(x)$$

$$r(x,y) = \beta \log\left( \frac{\pi^*(y|x)}{\pi_{\text{ref}}(y|x)} \right) + \beta \log Z(x)$$

**隐式奖励的定义**：

$$\tilde{r}(x,y) = \beta \log\left( \frac{\pi_\theta(y|x)}{\pi_{\text{ref}}(y|x)} \right)$$

**关键洞察**：

- 奖励函数**完全由策略比值**决定，无需显式奖励模型
- $\beta \log Z(x)$ 只依赖于 $x$，对于同一 $x$ 下的不同 $y$ 是常数——在后续比较偏好时会消去
- 策略网络同时扮演了语言模型和(隐式)奖励模型的双重角色

### 2.3 第三步：Bradley-Terry 偏好模型

人类偏好的标准建模方式：给定两个回复 $y_w$(被偏好)和 $y_l$(被拒绝)，被偏好的概率为：

$$P(y_w \succ y_l | x) = \sigma(r(x, y_w) - r(x, y_l))$$

其中 $\sigma(z) = \frac{1}{1 + \exp(-z)}$ 是 sigmoid 函数. 

**代入隐式奖励**：

$$P(y_w \succ y_l | x) = \sigma\left( \beta \log\left( \frac{\pi_\theta(y_w|x)}{\pi_{\text{ref}}(y_w|x)} \right) - \beta \log\left( \frac{\pi_\theta(y_l|x)}{\pi_{\text{ref}}(y_l|x)} \right) \right)$$

$$= \sigma\left( \beta \log\left( \frac{\pi_\theta(y_w|x) \pi_{\text{ref}}(y_l|x)}{\pi_\theta(y_l|x) \pi_{\text{ref}}(y_w|x)} \right) \right)$$

**配分函数的消去**：

注意到隐式奖励中的 $\beta \log Z(x)$ 在相减时被消去，这正是 DPO 能避免计算配分函数的关键. 

### 2.4 第四步：DPO 损失函数

**训练目标**：最大化偏好数据的似然——即让模型对真实观察到的偏好排序给出高概率. 

对于数据集 $\mathcal{D} = \{(x, y_w, y_l)\}$，负对数似然损失：

$$\mathcal{L}_{\text{DPO}}(\theta) = -\mathbb{E}_{(x, y_w, y_l) \sim \mathcal{D}} \left[ \log \sigma\left( \beta \log\left( \frac{\pi_\theta(y_w|x)}{\pi_{\text{ref}}(y_w|x)} \right) - \beta \log\left( \frac{\pi_\theta(y_l|x)}{\pi_{\text{ref}}(y_l|x)} \right) \right) \right]$$

**简记形式**：

定义隐式奖励差 $\Delta \tilde{r} = \tilde{r}(x, y_w) - \tilde{r}(x, y_l)$，则：

$$\mathcal{L}_{\text{DPO}}(\theta) = -\mathbb{E} \left[ \log \sigma(\Delta \tilde{r}) \right]$$

这与标准奖励模型的训练目标**形式完全一致**，只是将显式奖励替换为隐式奖励. 

---

## 3. 梯度分析：DPO 为什么有效？

### 3.1 损失函数的梯度结构

对 DPO 损失求梯度，可分解为三个关键部分：

$$\nabla_\theta \mathcal{L}_{\text{DPO}} = -\mathbb{E} \left[ \underbrace{\sigma(\Delta \tilde{r}_{\text{wrong}})}_{\text{权重项}} \cdot \left( \underbrace{\nabla_\theta \log \pi_\theta(y_w|x)}_{\text{提升被偏好回复}} - \underbrace{\nabla_\theta \log \pi_\theta(y_l|x)}_{\text{降低被拒绝回复}} \right) \right]$$

其中 $\Delta \tilde{r}_{\text{wrong}} = \tilde{r}(x, y_l) - \tilde{r}(x, y_w)$ 表示模型排序错误的程度. 

### 3.2 三项的协同作用

| 项 | 作用 | 物理意义 |
|----|------|---------|
| **权重项** $\sigma(\Delta \tilde{r}_{\text{wrong}})$ | 动态调整更新幅度 | 模型排序错误越严重(被拒绝回复的隐式奖励反而更高)，权重越大 |
| **正梯度** $\nabla \log \pi_\theta(y_w|x)$ | 提高被偏好回复的概率 | "这个好回答应该多生成" |
| **负梯度** $-\nabla \log \pi_\theta(y_l|x)$ | 降低被拒绝回复的概率 | "这个差回答应该少生成" |

**为什么权重项至关重要？**

如果移除权重项(即对所有样本使用相同权重)，算法退化为"unlikelihood training"——均匀提升所有被偏好回复、降低所有被拒绝回复. 实验表明这会导致策略退化，生成质量极差. 

权重项的巧妙之处在于：**它让模型更关注自己"犯错严重"的样本**. 对于那些模型已经正确排序的偏好对，权重接近 0，几乎不更新; 对于那些模型严重误判的偏好对，权重接近 1，进行大幅修正. 

### 3.3 与奖励模型训练的等价性

DPO 的核心证明：通过优化隐式奖励的偏好似然，得到的策略与 RLHF 的最优策略**完全相同**. 

**等价性证明概要**：

1. 任意奖励函数 $r(x,y)$ 与 $r(x,y) - f(x)$ 产生相同的最优策略($f(x)$ 只依赖 $x$，在偏好比较中消去)
2. DPO 的隐式奖励 $\tilde{r}(x,y) = \beta \log(\pi_\theta/\pi_{\text{ref}})$ 与真实奖励 $r(x,y)$ 满足上述等价关系
3. 因此 DPO 训练出的策略与 RLHF 的最优策略一致

---

## 4. 工程实现

### 4.1 核心代码

```python
def compute_dpo_loss(
    policy_chosen_logps: torch.Tensor,      # [B] 策略对被偏好回复的 log prob
    policy_rejected_logps: torch.Tensor,    # [B] 策略对被拒绝回复的 log prob
    reference_chosen_logps: torch.Tensor,   # [B] 参考策略对被偏好回复的 log prob
    reference_rejected_logps: torch.Tensor, # [B] 参考策略对被拒绝回复的 log prob
    beta: float = 0.1,
) -> torch.Tensor:
    """计算 DPO 损失
    
    Args:
        policy_chosen_logps: 当前策略的 chosen log probs
        policy_rejected_logps: 当前策略的 rejected log probs
        reference_chosen_logps: 参考策略的 chosen log probs
        reference_rejected_logps: 参考策略的 rejected log probs
        beta: 温度系数，控制对齐强度
    
    Returns:
        DPO 损失标量
    """
    # 计算隐式奖励
    chosen_rewards = beta * (policy_chosen_logps - reference_chosen_logps)
    rejected_rewards = beta * (policy_rejected_logps - reference_rejected_logps)
    
    # 奖励差
    reward_margin = chosen_rewards - rejected_rewards
    
    # DPO 损失 = -log(sigmoid(reward_margin))
    loss = -F.logsigmoid(reward_margin).mean()
    
    return loss
```

### 4.2 关键超参数 $\beta$

| $\beta$ 值 | 效果 | 适用场景 |
|-----------|------|---------|
| 0.1-0.2 | 温和对齐，保留参考模型特性 | 通用场景，推荐默认值 |
| 0.5 | 较强对齐，策略偏离参考模型较远 | 偏好数据质量高、分布一致 |
| 1.0+ | 激进对齐，可能导致过拟合 | 小规模实验、特定领域强化 |

**$\beta$ 的物理意义**：

$\beta$ 是 RLHF 目标中 KL 散度约束的逆温度. $\beta \to 0$ 时模型完全追求奖励最大化(可能 hacking); $\beta \to \infty$ 时模型不偏离参考策略. 

### 4.3 分布偏移问题与缓解

**问题**：偏好数据集通常由某个参考模型生成，但 DPO 训练中使用的参考模型可能与数据生成时的模型不同，导致分布偏移. 

**缓解策略**：

1. **参考模型初始化**：优先使用生成偏好数据的 SFT 模型作为参考
2. **SFT 预热**：若参考模型不可用，先在偏好数据集的 chosen 回复上对参考模型做 SFT，使其分布对齐
3. **数据筛选**：剔除与参考模型分布差异过大的偏好对

---

## 5. DPO 的局限与改进方向

### 5.1 DPO 的已知局限

| 局限 | 根因 | 影响 |
|------|------|------|
| **离线算法** | 只在静态偏好数据上训练，无法探索新回复 | 可能错过比数据集中更好的回复 |
| **偏好数据质量敏感** | 损失直接拟合观察到的偏好 | 噪声偏好会被直接学习 |
| **长回复惩罚** | 长回复的 log prob 绝对值通常更小 | 模型可能倾向于生成更短的回复 |
| **与在线 RL 的性能差距** | 缺乏探索机制 | 在复杂任务上可能不如 PPO/GRPO |

### 5.2 DPO 的改进变体

| 变体 | 核心改进 | 代表工作 |
|------|---------|---------|
| **IPO** | 将 DPO 损失中的 log-sigmoid 替换为平方损失，更稳定 | Azar et al., 2023 |
| **KTO** | 无需成对偏好，只需二元反馈(好/坏) | Ethayarajh et al., 2024 |
| **rDPO** | 引入长度正则化，缓解短回复偏好 | Park et al., 2024 |
| **DNO** | 结合 DPO 与 NLL，防止策略退化 | \
n| **Online DPO** | 在线生成偏好对，迭代更新 | Xuet al., 2024 |

---

## 6. 边界条件与失效模式

| 场景 | 症状 | 根因 | 缓解 |
|------|------|------|------|
| $\beta$ 过小 | 策略退化，生成无意义文本 | KL 约束太弱，过度优化 | 增大 $\beta$ 至 0.1-0.5 |
| $\beta$ 过大 | 策略与参考模型几乎无差异 | KL 约束太强，不敢偏离 | 减小 $\beta$ 至 0.05-0.2 |
| 偏好数据有噪声 | 模型学会错误偏好 | DPO 直接拟合所有观察到的偏好 | 数据清洗 + 置信度过滤 |
| 参考模型与数据分布偏移 | 隐式奖励估计不准 | 数据由不同模型生成 | SFT 预热参考模型 |
| 长回复任务 | 模型倾向于生成短回复 | 长回复的 log prob 惩罚 | 引入长度正则化(rDPO) |
| 分布外泛化差 | 新领域表现不佳 | 离线训练缺乏探索 | 结合在线采样(Online DPO) |

---

## 7. 技术前瞻

1. **在线 DPO**：将 DPO 与在线探索结合——策略生成新回复，用奖励模型或规则自动标注偏好，迭代更新
2. **多目标 DPO**：同时优化多个偏好维度(有用性、安全性、风格)，学习帕累托前沿策略
3. **DPO + 过程奖励**：不仅比较最终回复，还比较推理过程中的中间步骤(类似 PRM + DPO)
4. **DPO 的理论深化**：理解 DPO 在什么条件下严格等价于 RLHF，什么条件下存在性能差距

---

## 8. 参考文献

1. Rafailov, R., et al. (2023). Direct Preference Optimization: Your Language Model is Secretly a Reward Model. NeurIPS.
2. Ouyang, L., et al. (2022). Training Language Models to Follow Instructions with Human Feedback. NeurIPS.
3. Tunstall, L., et al. (2023). Zephyr: Direct Distillation of LM Alignment. arXiv:2310.16944.
4. Cui, G., et al. (2023). UltraFeedback: Boosting Language Models with High-quality Feedback. arXiv:2310.01377.
5. Azar, M. G., et al. (2023). A General Theoretical Paradigm to Understand Learning from Human Preferences. arXiv:2310.12036. (IPO)
6. Ethayarajh, K., et al. (2024). KTO: Model Alignment as Prospect Theoretic Optimization. arXiv:2402.01306.
