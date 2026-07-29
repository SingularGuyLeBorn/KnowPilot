# 第20章: RLHF 完整训练流水线 (Reinforcement Learning from Human Feedback)

**论文信息**: 
- **标题**: Training language models to follow instructions with human feedback (InstructGPT)
- **作者**: Long Ouyang, Jeff Wu, et al. (OpenAI)
- **年份**: 2022
- **arXiv**: 2203.02155

**前置知识**: PPO(第5章)、SFT、RM

---

## 0. 本章摘要

RLHF (Reinforcement Learning from Human Feedback) 并非一个单一的算法，而是一个**分阶段的系统工程**. 它是 ChatGPT 成功的基石. 

尽管最近涌现了 DPO、KTO 等 Simplified 方法，但标准的 **PPO-based RLHF** 依然是目前上限最高、最灵活(支持 Token 级奖励和过程监督)的方法. 

本章将详细拆解 RLHF 的三个标准阶段，并探讨工程实现中的关键细节(如 Tokenization 对齐、分布式训练挑战). 

---

## 1. RLHF 的三阶段 (Three Steps)

### 1.1 Step 1: 监督微调 (Supervised Fine-Tuning, SFT)

- **数据**: 高质量的 (Prompt, Response) 演示数据. 
- **目标**: 让模型学会"通过图灵测试"，掌握基本的问答格式和指令遵循能力. 
- **损失函数**: Next Token Prediction (Cross Entropy). 
- **产出**: SFT 模型 $\pi_{SFT}$. 
  - *注*: 这个模型通常也是后续 RL 阶段的参考模型 $\pi_{ref}$(为了防止遗忘). 

### 1.2 Step 2: 奖励模型训练 (Reward Modeling, RM)

- **数据**: 成对的比较数据 (Prompt, Win, Loss). 
  - 为什么用比较数据而不用打分？因为不同标注者对分数的理解差异很大(校准难)，但比较好坏的一致性很高. 
- **目标**: 训练一个模型 $R_\phi(x, y)$，使得 $R(x, y_w) > R(x, y_l)$. 
- **架构**: 通常是把 SFT 模型最后一层去掉，换成一个输出标量的 Linear Head. 
- **损失函数**: Pairwise Ranking Loss. 
  $$ L(\phi) = -\mathbb{E}_{(x, y_w, y_l) \sim D} [\log \sigma(R_\phi(x, y_w) - R_\phi(x, y_l))] $$
- **产出**: 奖励模型 $R_\phi$. 

### 1.3 Step 3: 强化学习微调 (Reinforcement Learning, PPO)

- **数据**: 只有 Prompts $x$，没有标签. 
- **流程**: 
  1. Actor ($\pi_\theta$, 初始化自 $\pi_{SFT}$) 根据 $x$ 生成 $y$. 
  2. Reward Model 计算奖励 $r = R_\phi(x, y)$. 
  3. 加上 KL 惩罚: $R_{total} = r - \beta \log \frac{\pi_\theta(y|x)}{\pi_{ref}(y|x)}$. 
  4. 使用 PPO 算法更新 $\pi_\theta$ 以最大化 $R_{total}$. 
- **产出**: 最终的 RLHF 模型. 

---

## 2. 工程挑战与细节

### 2.1 奖励黑客 (Reward Hacking)

随着 PPO 训练的进行，Reward 分数会不断上升. 但也可能出现**模型利用 RM 的漏洞**刷分. 
例如: 
- 疯狂重复无意义的词(如果 RM 对长度敏感). 
- 输出极端的立场. 

**解决方案**: 
1. **KL 约束**: 这是最重要的防线. 
2. **Reward Clipping**: 限制单次奖励的范围(如 -5 到 +5). 
3. **Reward Scaling**: 通常对 Reward 进行归一化(减均值除标准差)，使其保持稳定分布. 

### 2.2 Tokenizer 对齐问题

Actor 模型和 Reward 模型必须使用**完全相同**的 Tokenizer. 
如果一个是 Llama-2，一个是 Mistral，它们的词表不同，切词方式不同，导致 Reward Model 看到的 Token 序列和 Actor 生成的对应不上，训练必挂. 

### 2.3 分布式训练架构 (Architecture)

RLHF 需要同时加载 4 个模型: 
1. **Actor** (Trainable)
2. **Critic** (Trainable, for Value Function)
3. **Ref Model** (Frozen)
4. **Reward Model** (Frozen)

对于 70B 的模型，这需要巨大的显存. 
**Offload 策略**: 
- Ref Model 和 Reward Model 只在生成阶段和奖励计算阶段使用，用完可以暂时切到 CPU 或 NVMe. 
- 或者使用 **LoRA**，这样 Actor 和 Ref 共享 Base weights，只保存不同的 Adapter，极大地节省显存. 

---

## 3. 标准化与预处理

### 3.1 奖励标准化 (Reward Normalization)

Reward Model 的输出范围是不确定的. 有的 RM 输出 [-10, 10]，有的 [-100, 100]. 
PPO 对 Advantage 的数值范围敏感. 
通常在训练 PPO 前，会对 Reward 进行 **Whitening** (减均值，除标准差)，甚至对 Advantage 也做 Whitening. 

### 3.2 长度惩罚 (Length Penalty)

尽管 RM 可能会给长回复高分，我们可以在最终 Reward 中显式加入长度惩罚项: 
$$ R_{final} = R_{RM} - \alpha \cdot \text{len}(y) $$
这对于控制生成的啰嗦程度很有效. 

---

## 4. 扩展: Process Reward Model (PRM)

传统的 RM 只给整个回答打分 (Outcome Reward). 
OpenAI 在 Let's Verify Step by Step 论文中提出 **Process Reward**. 
- 对思维链 (CoT) 的每一个步骤打分. 
- PPO 变成了 Dense Reward RL. 
- 这极大地提升了数学推理能力 (DeepSeek-Prover). 

---

## 5. 代码架构 (伪代码)

```python
# 伪代码: RLHF Trainer Loop
for epoch in range(ppo_epochs):
    # 1. 采样 (Rollout)
    prompts = next(dataloader)
    with torch.no_grad():
        responses = actor.generate(prompts)
        ref_logprobs = ref_model.compute_logprobs(prompts, responses)
        rewards = reward_model.compute_score(prompts, responses)
        
    # 2. 计算优势 (GAE)
    values = critic(prompts, responses)
    # R_total = reward - beta * (logp - ref_logp)
    kl_penalty = beta * (actor_logprobs - ref_logprobs)
    total_rewards = rewards - kl_penalty
    advantages, returns = compute_gae(total_rewards, values)
    
    # 3. PPO 更新
    for mini_batch in dataset:
        # Actor Update
        new_logprobs = actor(mini_batch)
        ratio = exp(new_logprobs - old_logprobs)
        pg_loss = -min(ratio*adv, clip(ratio)*adv).mean()
        
        # Critic Update
        v_pred = critic(mini_batch)
        vf_loss = (v_pred - returns).mean()** 2
        
        loss = pg_loss + 0.5 * vf_loss
        loss.backward()
        optimizer.step()
```

---

## 6. 本章总结

RLHF 是一个系统工程，涉及数据、模型、系统优化等多个层面. 
虽然复杂，但它提供了对模型行为最细粒度的控制能力. 

**下一章**: 至此，我们已经完成了从基础到前沿再到系统实现的强化学习算法全景. 建议回顾目录或开始实践. 
