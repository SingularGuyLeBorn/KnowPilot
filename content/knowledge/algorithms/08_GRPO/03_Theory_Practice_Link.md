# GRPO: 从公式到代码的实现指南

本文档解释如何将GRPO的数学公式转化为代码，参考verl等开源框架的实现. 

---

## 1. 核心公式与代码对应

### 1.1 组优势计算

**公式** (Dr. GRPO版本): 
$$A_i = R_i - \bar{R} \quad \text{其中} \quad \bar{R} = \frac{1}{G}\sum_{j=1}^G R_j$$

**代码实现**: 

```python
def compute_grpo_advantages(rewards, group_size):
    # rewards: [B] 假设连续G个属于同一个prompt
    batch_size = rewards.shape[0]
    num_prompts = batch_size // group_size
    
    # 重塑为 [num_prompts, group_size]
    rewards = rewards.view(num_prompts, group_size)
    
    # 组内均值作为基线
    mean_rewards = rewards.mean(dim=1, keepdim=True)  # [num_prompts, 1]
    
    # 优势 = 奖励 - 基线
    advantages = rewards - mean_rewards
    
    return advantages.view(-1)  # [B]
```

**关键实现细节**: 
- 假设batch中连续的`group_size`个样本属于同一个prompt
- 使用`view`重塑来高效计算组统计量

### 1.2 序列概率比

**公式**: 
$$r(\theta) = \frac{\pi_\theta(y|x)}{\pi_{old}(y|x)} = \exp\left(\sum_t \log\pi_\theta(y_t) - \sum_t \log\pi_{old}(y_t)\right)$$

**代码实现**: 

```python
# 序列级log概率
seq_policy_logp = (policy_log_probs * attention_mask).sum(dim=-1)
seq_old_logp = (old_log_probs * attention_mask).sum(dim=-1)

# 概率比
ratio = torch.exp(seq_policy_logp - seq_old_logp)
```

### 1.3 裁剪损失

**公式**: 
$$L = -\mathbb{E}[\min(r \cdot A, \text{clip}(r, 1-\epsilon, 1+\epsilon) \cdot A)]$$

**代码**: 

```python
clipped_ratio = torch.clamp(ratio, 1 - clip_epsilon, 1 + clip_epsilon)
surr1 = ratio * advantages
surr2 = clipped_ratio * advantages
loss = -torch.min(surr1, surr2).mean()
```

---

## 2. verl框架参考

### 2.1 verl的GRPO实现结构

```
verl/
├── trainer/
│   └── grpo_trainer.py       # GRPO训练器
├── algorithms/
│   └── grpo/
│       ├── advantage.py      # 优势计算
│       └── loss.py           # 损失计算
```

### 2.2 verl风格代码

```python
# verl风格的优势计算
def compute_advantages_grpo(rewards, group_size):
    rewards = rewards.reshape(-1, group_size)
    baseline = rewards.mean(axis=-1, keepdims=True)
    advantages = rewards - baseline
    return advantages.reshape(-1)
```

---

## 3. 与PPO的对比

### 3.1 代码差异

```python
# PPO: 使用价值网络
def ppo_advantage(rewards, values, gamma, lambda_):
    # GAE计算
    deltas = rewards + gamma * values[1:] - values[:-1]
    advantages = gae(deltas, gamma * lambda_)
    return advantages

# GRPO: 使用组均值
def grpo_advantage(rewards, group_size):
    # 简单得多!
    rewards = rewards.view(-1, group_size)
    return (rewards - rewards.mean(dim=1, keepdim=True)).view(-1)
```

### 3.2 优势对比

| 方面 | PPO | GRPO |
|------|-----|------|
| 基线来源 | 价值网络V(s) | 组均值 |
| 额外参数 | 需要训练V网络 | 无 |
| 显存占用 | 高(2x模型) | 低(1x模型) |
| 采样方式 | 单轨迹 | 组采样 |

---

## 4. 工程优化

### 4.1 组采样并行化

```python
def parallel_group_sample(model, prompts, group_size):
    """并行生成多个response"""
    # 扩展prompts: [P] → [P*G]
    expanded_prompts = prompts.repeat_interleave(group_size)
    
    # 一次性生成所有response
    all_responses = model.generate(
        expanded_prompts,
        do_sample=True,
        num_return_sequences=1
    )
    
    return all_responses  # [P*G]
```

### 4.2 奖励类型处理

GRPO支持多种奖励来源: 

```python
def compute_rewards(responses, reward_type):
    if reward_type == "reward_model":
        return reward_model(responses)
    elif reward_type == "math_verifier":
        # 二元奖励: 答案对/错
        return [1.0 if verify(r) else 0.0 for r in responses]
    elif reward_type == "code_executor":
        # 测试通过率
        return [run_tests(r) for r in responses]
```

### 4.3 内存优化

```python
# 使用梯度Checkpoint
model.gradient_checkpointing_enable()

# 分批计算log概率
def batched_logprobs(model, input_ids, batch_size=4):
    all_logps = []
    for i in range(0, len(input_ids), batch_size):
        batch = input_ids[i:i+batch_size]
        logps = compute_log_probs(model, batch)
        all_logps.append(logps.detach())
    return torch.cat(all_logps)
```

---

## 5. 常见问题

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 优势全为0 | 所有奖励相同 | 检查奖励函数 |
| 训练不稳定 | std归一化问题 | 使用Dr. GRPO |
| 梯度爆炸 | clip_epsilon太大 | 减小到0.1 |
| 收敛慢 | group_size太小 | 增大到8-16 |

---

## 6. 代码结构总结

```
GRPO算法流程                    →  代码模块
────────────────────────────────────────────
组采样 (G个response/prompt)     →  group_sample()
获取奖励 R_1...R_G             →  reward_model() / verifier()
计算组优势 A_i = R_i - mean(R) →  compute_grpo_advantages()
计算概率比 r(θ)                →  exp(new_logp - old_logp)
PPO裁剪损失                    →  compute_grpo_loss()
KL惩罚 (可选)                  →  kl_coef * KL
梯度更新                       →  optimizer.step()
```
