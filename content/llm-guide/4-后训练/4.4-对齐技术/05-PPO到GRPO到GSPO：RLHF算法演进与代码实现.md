# PPO 到 GRPO 到 GSPO：RLHF 算法演进与代码实现

> 来源: 知乎专栏 (https://zhuanlan.zhihu.com/p/32059938961)
> 标签: #PPO #GRPO #GSPO #RLHF #重要性采样 #策略梯度

## 1. 演进脉络：为什么需要 GRPO 和 GSPO？

### 1.1 PPO 的四模型困境

OpenAI 的 InstructGPT 论文确立了 RLHF 的标准范式：使用 PPO(Proximal Policy Optimization)进行强化学习对齐. 但在 LLM 场景下，PPO 需要维护**四个模型**：

| 模型 | 作用 | 是否可训练 | 显存占用 |
|------|------|-----------|---------|
| **策略模型** $\pi_\theta$ | 生成回复，被训练对齐人类偏好 | 是 | 1x |
| **奖励模型** $R$ | 给策略模型生成的回复打分 | 否(预训练好) | 1x |
| **参考模型** $\pi_{\text{ref}}$ | SFT 模型，防止策略偏离太远 | 否 | 1x |
| **Critic 模型** $V_\phi$ | 估计状态价值，计算优势函数 baseline | 是 | 1x |

**核心痛点**：Critic 模型与策略模型同规模(如 70B)，带来额外的显存和计算负担，严重制约训练规模扩展. 

### 1.2 从 PPO 到 GSPO 的演进路线

```
PPO (2017)
  ├─ 四模型：策略 + 奖励 + 参考 + Critic
  ├─ Token-level 重要性采样
  └─ GAE 计算优势函数

GRPO (2024, DeepSeek)
  ├─ 三模型：去掉 Critic，用组内相对奖励作 baseline
  ├─ 仍保留 Token-level 重要性采样
  └─ KL 散度从 reward 移入 loss

GSPO (2025, Qwen)
  └─ 三模型：同 GRPO
     ├─ 序列级别重要性采样(替代 Token-level)
     └─ 解决 GRPO 中高方差噪声问题
```

### 1.3 工业价值

| 算法 | 代表模型 | 相对 PPO 显存节省 | 训练稳定性 |
|------|---------|------------------|-----------|
| PPO | InstructGPT, LLaMA-2 | 基线 | 中(Critic 训练不稳定) |
| GRPO | DeepSeek-R1, Qwen2.5 | **25%**(去掉 Critic) | 高(组内相对优势更稳定) |
| GSPO | Qwen3 | **25%** | 更高(序列级采样降低方差) |

---

## 2. PPO：RLHF 的基础框架

### 2.1 PPO 的四个模型与 Loss 结构

PPO 的核心目标：最大化期望奖励，同时限制策略更新幅度. 

**策略损失(Policy Loss)**：

$$
\mathcal{L}^{\text{CLIP}}(\theta) = \hat{\mathbb{E}}_t \left[ \min\left( r_t(\theta) \hat{A}_t, \; \text{clip}\left(r_t(\theta), 1-\epsilon, 1+\epsilon\right) \hat{A}_t \right) \right]
$$

其中：
- $r_t(\theta) = \frac{\pi_\theta(a_t|s_t)}{\pi_{\theta_{\text{old}}}(a_t|s_t)}$：重要性采样比率(当前策略 vs 采样策略)
- $\hat{A}_t$：优势函数估计
- $\epsilon$：裁剪超参数(通常 0.1-0.2)

**为什么需要 clip？**

在 off-policy 场景下，我们用旧策略采样的数据来更新新策略. 如果新旧策略差异过大，重要性采样比率 $r_t(\theta)$ 会剧烈波动，导致训练崩溃. clip 将比率限制在 $[1-\epsilon, 1+\epsilon]$ 范围内，确保每次更新的策略变化有限. 

**物理直觉**：clip 就像一个"安全带"——允许策略朝着优势方向前进，但禁止它迈太大的步子导致翻车. 

### 2.2 优势函数的计算：Critic 的核心作用

优势函数衡量"采取某个动作比平均水平好多少"：

$$
\hat{A}_t = Q(s_t, a_t) - V(s_t)
$$

在 PPO 中，Critic 模型 $V_\phi$ 估计状态价值 $V(s_t)$，而动作价值 $Q(s_t, a_t)$ 通过 reward 近似. 

**GAE(Generalized Advantage Estimation)**：

$$
\hat{A}_t^{\text{GAE}(\gamma,\lambda)} = \sum_{l=0}^{\infty} (\gamma\lambda)^l \delta_{t+l}^{V}
$$

其中 TD 残差：

$$
\delta_t^V = r_t + \gamma V(s_{t+1}) - V(s_t)
$$

**为什么 LLM 场景下 Critic 训练困难？**

GRPO 论文指出：*"在 LLM 上下文中，通常只有最后一个 token 被奖励模型分配分数，这使得训练一个在每个 token 都准确的 Critic 模型变得复杂. "*

因为 reward 是稀疏的(仅在序列末尾)，中间 token 的 value 估计缺乏直接监督信号，导致 Critic 训练不稳定. 

### 2.3 KL 散度惩罚：防止 Reward Hacking

为了防止策略模型过度优化 reward 模型(生成高 reward 但无意义的回复)，PPO 引入 KL 散度约束：

$$
r_t^{\text{token}} = \underbrace{r_t^{\text{reward}}}_{\text{奖励模型打分}} - \beta \underbrace{D_{\text{KL}}(\pi_\theta(\cdot|s_t) \| \pi_{\text{ref}}(\cdot|s_t))}_{\text{与参考模型的偏离程度}}
$$

**KL 散度的实现方式**：

在 token 级别，KL 散度可近似为：

$$
D_{\text{KL}} \approx \log \frac{\pi_\theta(a_t|s_t)}{\pi_{\text{ref}}(a_t|s_t)} = \log \pi_\theta(a_t|s_t) - \log \pi_{\text{ref}}(a_t|s_t)
$$

这正是 verl 中 `apply_kl_penalty` 函数的实现：

```python
def apply_kl_penalty(data, kl_ctrl, kl_penalty="kl"):
    """将 KL 惩罚应用到 token-level reward 上"""
    token_level_scores = data.batch["token_level_scores"]
    
    # 计算当前策略与参考策略的 KL 散度
    kld = kl_penalty(
        data.batch["old_log_probs"],      # 当前策略的 log_prob
        data.batch["ref_log_prob"],       # 参考策略的 log_prob
        kl_penalty=kl_penalty
    )  # shape: (batch_size, response_length)
    
    beta = kl_ctrl.value  # 自适应 KL 系数
    token_level_rewards = token_level_scores - beta * kld
    
    # 更新 KL 控制器(根据当前 KL 值动态调整 beta)
    kl_ctrl.update(current_kl=current_kl, n_steps=batch_size)
    
    return token_level_rewards
```

### 2.4 重要性采样与 Off-Policy 训练

PPO 的核心效率来源：**一次采样，多次更新**. 但这引入了 off-policy 问题——采样时的策略(old policy)与当前训练的策略(new policy)不同. 

**重要性采样比率**：

$$
r_t(\theta) = \frac{\pi_\theta(a_t|s_t)}{\pi_{\theta_{\text{old}}}(a_t|s_t)}
$$

**实现细节**：不需要维护两个模型. 在采样阶段计算 `old_log_probs`，在更新阶段重新计算 `log_probs`(更新后的策略)，二者相减即得重要性采样比率. 

```python
# PPO 训练伪代码
for step in range(max_steps):
    # 1. Rollout：用当前策略生成回复
    responses = model.generate(queries)
    
    # 2. 计算奖励模型得分
    scores = reward_model.score(queries, responses)
    
    # 3. 计算 old_log_probs(采样时的策略)和 ref_log_probs
    all_logprobs, values = model.batch_forward(queries, responses)
    ref_logprobs, _ = ref_model.batch_forward(queries, responses)
    
    # 4. 计算 advantages(需要 Critic 的 value 估计)
    rewards = compute_rewards(scores, all_logprobs, ref_logprobs)
    advantages, returns = compute_advantages(values, rewards)  # <-- 需要 Critic
    
    # 5. 多次更新(PPO epochs)
    for _ in range(ppo_epochs):
        logprobs, vpreds = model.batch_forward(queries, responses)
        ratio = torch.exp(logprobs - old_logprobs)  # 重要性采样比率
        policy_loss = ppo_clip_loss(ratio, advantages)
        value_loss = mse_loss(vpreds, returns)
        loss = policy_loss + value_loss
        loss.backward()
        optimizer.step()
```

---

## 3. GRPO：用组内相对优势替代 Critic

### 3.1 GRPO 的核心动机

DeepSeek 在 DeepSeekMath 论文中提出 GRPO(Group Relative Policy Optimization)，核心洞察：

> **Critic 模型本质上是在计算一个 baseline. 如果同一个问题生成多个回复，用这些回复的平均 reward 作为 baseline，就可以完全替代 Critic. **

**组内相对优势**：对于问题 $x$，策略模型生成 $G$ 个回复 $\{y_1, y_2, ..., y_G\}$，reward 模型分别打分 $\{R(y_1), R(y_2), ..., R(y_G)\}$. 

**优势函数**：

$$
\hat{A}_{i,t} = \frac{R(y_i) - \text{mean}(\{R(y_j)\}_{j=1}^G)}{\text{std}(\{R(y_j)\}_{j=1}^G)}
$$

**关键理解**：
- 分子 $R(y_i) - \text{mean}(\cdot)$：当前回复比组内平均水平好多少
- 分母 $\text{std}(\cdot)$：归一化，使优势值在不同问题间可比
- **所有 token 共享同一个优势值**(因为 reward 只在序列末尾)

### 3.2 GRPO 的 Loss 公式

GRPO 保留了 PPO 的 clip 机制，但优势计算方式完全不同：

$$
\mathcal{L}^{\text{GRPO}}(\theta) = \hat{\mathbb{E}} \left[ \frac{1}{G} \sum_{i=1}^G \frac{1}{|y_i|} \sum_{t=1}^{|y_i|} \min\left( r_{i,t}(\theta) \hat{A}_i, \; \text{clip}\left(r_{i,t}(\theta), 1-\epsilon, 1+\epsilon\right) \hat{A}_i \right) \right]
$$

其中 $r_{i,t}(\theta) = \frac{\pi_\theta(y_{i,t}|x, y_{i,<t})}{\pi_{\theta_{\text{old}}}(y_{i,t}|x, y_{i,<t})}$ 仍是 **token-level** 的重要性采样比率. 

**与 PPO 的关键区别**：

| 维度 | PPO | GRPO |
|------|-----|------|
| Baseline | Critic 模型 $V_\phi$ | 组内平均 reward |
| 优势计算 | GAE(需要 value 估计) | $(R_i - \bar{R}) / \sigma_R$ |
| 可训练模型 | 策略 + Critic | **仅策略** |
| 显存占用 | 4x 模型 | **3x 模型** |
| KL 位置 | Reward 中 | **Loss 中** |

### 3.3 KL 散度的位置变化

PPO 中，KL 散度是 reward 的一部分：

$$
r_t = r_t^{\text{reward}} - \beta \cdot D_{\text{KL}}
$$

GRPO 中，KL 散度移入 policy loss：

$$
\mathcal{L}^{\text{GRPO}} = \mathcal{L}^{\text{CLIP}} + \beta \cdot D_{\text{KL}}(\pi_\theta \| \pi_{\text{ref}})
$$

**为什么移动？** 因为 GRPO 的优势函数已经用组内相对 reward 计算，如果再在 reward 中扣减 KL，会导致优势估计混乱. 将 KL 直接加入 loss 更简洁. 

**KL 的计算方式**：使用 unbiased estimator(Schulman, 2020)，避免标准 KL 公式中的高方差问题. 

```python
# verl 中 GRPO 的 KL loss 计算
if config.use_kl_loss:
    ref_log_prob = model_inputs["ref_log_prob"]
    kld = kl_penalty(
        logprob=log_prob, 
        ref_logprob=ref_log_prob, 
        kl_penalty=config.kl_loss_type  # 如 "low_var_kl"
    )
    kl_loss = agg_loss(kld, response_mask, loss_agg_mode)
    policy_loss = policy_loss + kl_loss * config.kl_loss_coef
```

### 3.4 GRPO 的代码实现(verl 框架)

```python
def compute_grpo_outcome_advantage(
    token_level_rewards: torch.Tensor,
    response_mask: torch.Tensor,
    n_groups: int = 1,
):
    """计算 GRPO 的组内相对优势
    
    Args:
        token_level_rewards: (batch_size, response_length)，只有最后一个 token 有 reward
        response_mask: (batch_size, response_length)
        n_groups: 组数，batch_size 必须能被 n_groups 整除
    
    Returns:
        advantages: (batch_size, response_length)，所有 token 共享同一 advantage
    """
    batch_size = token_level_rewards.shape[0]
    assert batch_size % n_groups == 0, "batch_size must be divisible by n_groups"
    
    # 将 batch 分成 n_groups 组
    group_size = batch_size // n_groups
    
    # 计算每组的 mean 和 std
    rewards = token_level_rewards.sum(dim=-1)  # (batch_size,)
    rewards = rewards.view(n_groups, group_size)  # (n_groups, group_size)
    
    mean_rewards = rewards.mean(dim=1, keepdim=True)   # (n_groups, 1)
    std_rewards = rewards.std(dim=1, keepdim=True)     # (n_groups, 1)
    std_rewards = std_rewards.clamp(min=1e-8)  # 防止除零
    
    # 组内相对优势
    advantages = (rewards - mean_rewards) / std_rewards  # (n_groups, group_size)
    advantages = advantages.view(batch_size, 1).expand(-1, token_level_rewards.shape[1])
    
    # mask 掉 padding token
    advantages = advantages * response_mask
    
    return advantages
```

---

## 4. GSPO：从 Token-Level 到 Sequence-Level 的重要性采样

### 4.1 GRPO 的隐藏问题：Token-Level 重要性采样的方差爆炸

Qwen 团队指出 GRPO 的核心缺陷：

> **"重要性采样的单位应该与奖励的单位一致. "**

在 GRPO 中：
- **Reward 是序列级别的**(整个回复一个分数)
- **重要性采样却是 Token 级别的**(每个 token 一个比率 $r_{i,t}$)

这导致什么问题？

**方差累积**：对于长序列，token-level 比率会沿着序列累积误差. 假设每个 token 的比率有微小波动 $\delta$，$T$ 个 token 的累积波动约为 $\sqrt{T} \cdot \delta$. 当 $T=1024$ 时，方差放大 32 倍. 

**Clip 机制的副作用**：PPO 的 clip 是为了限制策略变化，但在 GRPO 中，token-level clip 会在长序列上过度惩罚合理的策略更新——因为只要有一个 token 的比率超出 $[1-\epsilon, 1+\epsilon]$，整个序列的梯度就被 clip. 

### 4.2 GSPO 的核心改进

GSPO(Group Sequence Policy Optimization)将重要性采样从 **Token 级别** 提升到 **序列级别**. 

**序列级别重要性采样比率**：

$$
s_i(\theta) = \left( \frac{\pi_\theta(y_i|x)}{\pi_{\theta_{\text{old}}}(y_i|x)} \right)^{\frac{1}{|y_i|}}
$$

取几何平均(而非算术平均)，使比率与序列长度无关. 

**对数形式**：

$$
\log s_i(\theta) = \frac{1}{|y_i|} \sum_{t=1}^{|y_i|} \log \frac{\pi_\theta(y_{i,t}|x, y_{i,<t})}{\pi_{\theta_{\text{old}}}(y_{i,t}|x, y_{i,<t})}
$$

**为什么用几何平均而非算术平均？**

几何平均更适合描述乘性关系(如比率). 举例：
- 投资第一年增长 50%(乘数 1.5)，第二年亏损 50%(乘数 0.5)
- 算术平均：$(1.5 + 0.5)/2 = 1.0$(错误地暗示不亏不赚)
- 几何平均：$(1.5 \times 0.5)^{0.5} \approx 0.866$(正确反映最终亏损 13.4%)

### 4.3 GSPO 的 Loss 公式

$$
\mathcal{L}^{\text{GSPO}}(\theta) = \hat{\mathbb{E}} \left[ \frac{1}{G} \sum_{i=1}^G \min\left( s_i(\theta) \hat{A}_i, \; \text{clip}\left(s_i(\theta), 1-\epsilon, 1+\epsilon\right) \hat{A}_i \right) \right]
$$

**关键区别**：

| 维度 | GRPO | GSPO |
|------|------|------|
| 重要性采样 | Token-level $r_{i,t}$ | Sequence-level $s_i$ |
| Clip 范围 | 每个 token 独立 clip | 整个序列统一 clip |
| 方差特性 | 随序列长度累积 | 与序列长度无关 |
| 与 reward 单位 | 不匹配 | **匹配** |

### 4.4 GSPO 的梯度推导

GSPO 的梯度推导展示了序列级采样的优雅性质. 

**对 $s_i(\theta)$ 求梯度**：

$$
\nabla_\theta s_i(\theta) = \nabla_\theta \exp(\log s_i(\theta)) = s_i(\theta) \cdot \nabla_\theta \log s_i(\theta)
$$

展开 $\log s_i(\theta)$：

$$
\nabla_\theta \log s_i(\theta) = \frac{1}{|y_i|} \sum_{t=1}^{|y_i|} \nabla_\theta \log \pi_\theta(y_{i,t}|x, y_{i,<t})
$$

**关键洞察**：$s_i(\theta)$ 作为整体从求和符号外提取，而 GRPO 的 $r_{i,t}$ 必须在求和内部(因为它是 token 对齐的). 这使得 GSPO 的梯度计算更稳定. 

### 4.5 GSPO 的代码实现(verl 框架)

```python
def compute_policy_loss_gspo(
    old_log_prob: torch.Tensor,      # (batch_size, response_length)
    log_prob: torch.Tensor,          # (batch_size, response_length)
    advantages: torch.Tensor,        # (batch_size, response_length)
    response_mask: torch.Tensor,     # (batch_size, response_length)
    config: ActorConfig,
):
    """GSPO 策略损失计算
    
    核心改进：将重要性采样从 token-level 提升到 sequence-level
    """
    clip_ratio_low = config.clip_ratio_low or config.clip_ratio
    clip_ratio_high = config.clip_ratio_high or config.clip_ratio
    
    # Step 1: 计算 token-level 的 log 比率
    negative_approx_kl = log_prob - old_log_prob  # (B, T)
    
    # Step 2: 聚合到序列级别(几何平均)
    seq_lengths = torch.sum(response_mask, dim=-1).clamp(min=1)  # (B,)
    negative_approx_kl_seq = torch.sum(
        negative_approx_kl * response_mask, dim=-1
    ) / seq_lengths  # (B,)
    
    # Step 3: 将序列级比率广播回 token 级别
    # s_i,t = sg[s_i] * (pi_theta / sg[pi_theta])
    # 即：token 级别的比率 = 序列级比率(停止梯度) × token 级别相对变化
    log_seq_importance_ratio = (
        negative_approx_kl_seq.detach().unsqueeze(-1)  # 序列级比率(停止梯度)
        + log_prob - log_prob.detach()                   # token 相对变化
    )
    log_seq_importance_ratio = torch.clamp(
        log_seq_importance_ratio, max=10.0  # 数值稳定性
    )
    
    # Step 4: 转换回线性空间
    seq_importance_ratio = torch.exp(log_seq_importance_ratio)
    
    # Step 5: PPO clip(与 GRPO 相同，但 clip 的是序列级比率)
    pg_losses1 = -advantages * seq_importance_ratio
    pg_losses2 = -advantages * torch.clamp(
        seq_importance_ratio, 
        1 - clip_ratio_low, 
        1 + clip_ratio_high
    )
    pg_losses = torch.maximum(pg_losses1, pg_losses2)
    
    # Step 6: 序列级聚合(seq-mean-token-mean)
    pg_loss = agg_loss(
        loss_mat=pg_losses, 
        loss_mask=response_mask, 
        loss_agg_mode="seq-mean-token-mean"
    )
    
    return pg_loss
```

**代码解析**：

1. `negative_approx_kl_seq = sum(kl * mask) / seq_lengths`：将 token-level KL 聚合为序列级几何平均
2. `log_seq_importance_ratio = seq_kl.detach() + log_prob - log_prob.detach()`：序列级比率(停止梯度)+ token 相对变化
3. `agg_mode="seq-mean-token-mean"`：先在 token 维度平均，再在序列维度平均——确保每个序列对 loss 的贡献相等

---

## 5. PPO / GRPO / GSPO 的完整对比

### 5.1 算法对比表

| 维度 | PPO | GRPO | GSPO |
|------|-----|------|------|
| **模型数量** | 4(策略+奖励+参考+Critic) | 3(策略+奖励+参考) | 3 |
| **Baseline** | Critic $V_\phi$ | 组内平均 reward | 组内平均 reward |
| **优势计算** | GAE | $(R_i - \bar{R})/\sigma_R$ | $(R_i - \bar{R})/\sigma_R$ |
| **重要性采样** | Token-level | Token-level | **Sequence-level** |
| **Clip 粒度** | Token | Token | **Sequence** |
| **KL 位置** | Reward | Loss | Loss |
| **显存节省** | 基线 | **25%** | **25%** |
| **长序列稳定性** | 中 | 低(方差累积) | **高** |

### 5.2 训练流程对比

**PPO 训练流程**：

```
1. Rollout → 生成回复
2. Reward Model → 打分
3. Critic → 估计 value
4. GAE → 计算 advantage
5. PPO Epochs → 更新策略 + Critic
```

**GRPO/GSPO 训练流程**：

```
1. Rollout → 同一问题生成 G 个回复
2. Reward Model → 给 G 个回复打分
3. 组内归一化 → mean / std 计算 advantage
4. PPO Epochs → 只更新策略
```

### 5.3 超参数设置建议

| 超参数 | PPO | GRPO | GSPO |
|--------|-----|------|------|
| 组大小 $G$ | — | 4-16 | 4-16 |
| Clip $\epsilon$ | 0.2 | 0.2 | 0.2 |
| KL 系数 $\beta$ | 0.01-0.05 | 0.01-0.1 | 0.01-0.1 |
| PPO Epochs | 1-4 | 1-2 | 1-2 |
| 学习率 | 1e-6 | 1e-6 | 1e-6 |

---

## 6. 边界条件与失效模式

| 场景 | 症状 | 根因 | 缓解 |
|------|------|------|------|
| 组大小 $G$ 过小 | 优势估计方差大，训练震荡 | 样本不足，mean/std 估计不准 | 增大 $G$ 至 8-16 |
| 序列长度过长 | GRPO 中重要性采样比率爆炸 | Token-level 比率累积误差 | **改用 GSPO** |
| KL 系数过大 | 模型输出与 SFT 几乎无差异 | 策略被过度约束 | 降低 $\beta$，使用自适应 KL 控制器 |
| KL 系数过小 | Reward hacking，生成无意义高 reward 文本 | 策略偏离参考模型太远 | 增大 $\beta$，增加 KL 惩罚 |
| Reward 模型偏见 | 模型偏向特定回答风格 | Reward 模型训练数据有 bias | 多 Reward 模型集成，RLAIF |
| 温度过低 | 生成多样性下降，陷入局部最优 | 采样过于贪婪 | 提高 temperature，增加 entropy bonus |

---

## 7. 技术前瞻

1. **无 Reward 模型的对齐**：DPO、KTO 等方法完全去掉 Reward 模型，直接用偏好数据训练，进一步降低复杂度
2. **多轮对话的 RLHF**：当前 GRPO/GSPO 针对单轮回复优化，多轮对话中的长期信用分配仍是开放问题
3. **推理时扩展(Test-Time Scaling)**：o1、R1 等模型表明，在推理阶段投入更多计算(如 CoT)可能比训练时扩展(Test Time Scaling, TTS)更有效
4. **在线 vs 离线 RL**：GRPO/GSPO 是在线 RL(每次采样新数据)，离线 RL(用固定数据集)在 LLM 中的应用仍在探索

---

## 8. 参考文献

1. Ouyang, L., et al. (2022). Training Language Models to Follow Instructions with Human Feedback. NeurIPS. (InstructGPT / PPO)
2. Shao, Z., et al. (2024). DeepSeekMath: Pushing the Limits of Mathematical Reasoning in Open Language Models. arXiv:2402.03300. (GRPO)
3. Qwen Team. (2025). Group Sequence Policy Optimization. arXiv:2507.18071. (GSPO)
4. Schulman, J., et al. (2017). Proximal Policy Optimization Algorithms. arXiv:1707.06347.
5. Schulman, J. (2020). Approximating KL Divergence. http://joschu.net/blog/kl-approx.html
6. veRL 框架文档. https://github.com/volcengine/verl
