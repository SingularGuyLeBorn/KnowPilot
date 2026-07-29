# DPO: 从公式到代码的实现指南

本文档解释如何将DPO的数学公式转化为代码，以及关键的工程实现细节. 

---

## 1. 核心公式与代码对应

### 1.1 隐式奖励

**公式**: 
$$\hat{r}_\theta(x, y) = \beta \log \frac{\pi_\theta(y|x)}{\pi_{ref}(y|x)}$$

**代码实现**: 

```python
# 隐式奖励 = β * log(π_θ/π_ref) = β * (log π_θ - log π_ref)
implicit_reward = beta * (policy_log_probs - reference_log_probs)
```

**关键点**: 使用log概率相减，避免直接除法的数值问题. 

### 1.2 DPO损失

**公式**: 
$$\mathcal{L}_{DPO} = -\mathbb{E}\left[\log\sigma\left(\hat{r}(y_w) - \hat{r}(y_l)\right)\right]$$

**代码实现**: 

```python
def compute_dpo_loss(policy_chosen_logps, policy_rejected_logps,
                      ref_chosen_logps, ref_rejected_logps, beta):
    # 步骤1: 计算log ratio
    pi_logratios_chosen = policy_chosen_logps - ref_chosen_logps
    pi_logratios_rejected = policy_rejected_logps - ref_rejected_logps
    
    # 步骤2: 计算logits (隐式奖励差 * β)
    logits = beta * (pi_logratios_chosen - pi_logratios_rejected)
    
    # 步骤3: 二元交叉熵损失
    losses = -F.logsigmoid(logits)
    
    return losses.mean()
```

**公式与代码对应**: 

| 公式符号 | 代码变量 | 说明 |
|----------|----------|------|
| $\pi_\theta(y_w\|x)$ | `policy_chosen_logps` | 策略对chosen的log概率 |
| $\pi_{ref}(y_w\|x)$ | `ref_chosen_logps` | 参考模型对chosen的log概率 |
| $\hat{r}(y_w) - \hat{r}(y_l)$ | `logits` | 隐式奖励差 |
| $\log\sigma(\cdot)$ | `F.logsigmoid(logits)` | PyTorch内置函数 |

### 1.3 序列对数概率计算

**核心问题**: 如何从语言模型输出得到 $\log\pi_\theta(y|x)$？

**公式**: 
$$\log\pi_\theta(y|x) = \sum_{t=1}^{|y|} \log P_\theta(y_t | x, y_{<t})$$

**代码实现**: 

```python
def compute_log_probs(logits, labels, attention_mask):
    # 对齐: logits[t]预测labels[t+1]
    labels = labels[:, 1:]
    logits = logits[:, :-1, :]
    
    # 计算每个位置的log概率
    log_probs_all = F.log_softmax(logits, dim=-1)  # [B, T, V]
    
    # 提取目标token的log概率
    per_token_logps = torch.gather(
        log_probs_all, dim=2, index=labels.unsqueeze(-1)
    ).squeeze(-1)  # [B, T]
    
    # 求和得到序列log概率
    return (per_token_logps * attention_mask).sum(dim=-1)
```

**关键实现细节**: 

1. **对齐问题**: 语言模型的logits[t]预测的是token[t+1]
2. **掩码处理**: 忽略padding位置的贡献
3. **gather操作**: 高效提取指定token的概率

---

## 2. 与verl/TRL的代码对比

### 2.1 TRL的DPOTrainer

```python
# TRL风格
class DPOTrainer:
    def get_batch_loss_metrics(self, batch):
        policy_chosen_logps = self.compute_logps(model, chosen_ids)
        policy_rejected_logps = self.compute_logps(model, rejected_ids)
        
        with torch.no_grad():
            ref_chosen_logps = self.compute_logps(ref_model, chosen_ids)
            ref_rejected_logps = self.compute_logps(ref_model, rejected_ids)
        
        losses, metrics = self.dpo_loss(
            policy_chosen_logps, policy_rejected_logps,
            ref_chosen_logps, ref_rejected_logps
        )
        return losses.mean(), metrics
```

### 2.2 verl风格

verl使用更细粒度的分布式训练，但核心DPO损失计算相同. 

---

## 3. 工程优化技巧

### 3.1 参考模型处理

**问题**: 参考模型占用大量显存

**解决方案1**: 共享权重 + 梯度分离

```python
# 不需要单独的ref_model副本
# 在forward前保存log_probs即可
with torch.no_grad():
    ref_logps = model(...)  # 使用同一模型
# 然后更新模型
model.train()
policy_logps = model(...)  # 有梯度
```

**解决方案2**: SimPO(无参考模型)

```python
# SimPO: 不需要参考模型
logits = beta * (policy_chosen_logps - policy_rejected_logps) - gamma
loss = -F.logsigmoid(logits).mean()
```

### 3.2 批量处理

**问题**: chosen和rejected需要分别前传

**优化**: 合并成一个batch

```python
# 合并处理
all_input_ids = torch.cat([chosen_ids, rejected_ids], dim=0)
all_logits = model(all_input_ids)

# 分割结果
bs = chosen_ids.shape[0]
chosen_logits = all_logits[:bs]
rejected_logits = all_logits[bs:]
```

### 3.3 梯度累积

**问题**: DPO需要成对数据，有效batch_size减半

**解决**: 梯度累积

```python
for i, batch in enumerate(dataloader):
    loss, _ = compute_dpo_loss(batch)
    loss = loss / accumulation_steps
    loss.backward()
    
    if (i + 1) % accumulation_steps == 0:
        optimizer.step()
        optimizer.zero_grad()
```

---

## 4. DPO变体对比

### 4.1 代码差异

```python
# 原始DPO
loss = -F.logsigmoid(beta * logratios_diff)

# IPO (添加正则化)
loss = (beta * logratios_diff - 1/beta) ** 2

# SimPO (无参考模型 + margin)
loss = -F.logsigmoid(beta * (chosen_logps - rejected_logps) - gamma)

# ORPO (odds ratio)
def odds(logp):
    return torch.exp(logp) / (1 - torch.exp(logp))
loss = -F.logsigmoid(torch.log(odds(chosen) / odds(rejected)))
```

### 4.2 参数选择

| 变体 | β典型值 | 其他参数 |
|------|---------|----------|
| DPO | 0.1~0.5 | - |
| IPO | 0.1 | - |
| SimPO | 2.0~10.0 | γ=0.5 |
| ORPO | - | λ=0.1 (SFT权重) |

---

## 5. 常见问题排查

| 问题 | 可能原因 | 解决方案 |
|------|----------|----------|
| loss不下降 | β太小 | 增大β到0.2~0.5 |
| 过拟合 | 数据量小 | 添加label_smoothing |
| chosen/rejected差距大 | 数据质量问题 | 检查偏好数据 |
| 模型崩溃 | lr太大 | 降低lr到1e-7 |

---

## 6. 代码结构总结

```
DPO算法流程                    →  代码模块
───────────────────────────────────────────
收集偏好数据 (x, y_w, y_l)     →  数据加载器
计算序列log概率               →  compute_log_probs()
计算隐式奖励差                →  logits = β * diff
二元交叉熵损失                →  -F.logsigmoid()
梯度更新                      →  optimizer.step()
```
