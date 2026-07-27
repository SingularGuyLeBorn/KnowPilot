---
title: "4.4 · On-Policy Distillation (OPD) 深度解析"
date: 2026-05-16
tags: [OPD, On-Policy Distillation, 知识蒸馏, RL, Reverse KL, MiniLLM, GKD]
---

# On-Policy Distillation (OPD) 深度解析

> 本文深入解析 On-Policy Distillation 的数学原理、实现变体(sampled-token / top-k / full-vocab)及其与 MiniLLM、GKD、DeepSeek V4 等实现的对应关系. 

---

## 1. OPD 的核心定义

**一句话定义**：学生模型先用自己当前的策略生成回答，再让教师模型在这些学生自己生成的轨迹上提供监督信号，学生据此更新. 

形式上：
- y ~ pi_theta(.|x)：学生采样轨迹
- c_t = (x, y_<t)：第 t 个位置的前缀
- 教师提供：sampled token 的 logprob / top-k 分布 / full-vocab logits
- 学生更新参数

## 2. OPD 与普通 SFT/KD 的区别

| 方法 | 采样方式 | 监督信号 | 状态分布 |
|:-----|:--------|:--------|:--------|
| SFT / Off-policy KD | 教师生成 | Dense(逐 token)| d_teacher |
| RL | 学生生成 | Sparse(序列级奖励)| d_pi_theta |
| **OPD** | **学生生成** | **Dense(逐 token)** | **d_pi_theta** |

OPD 兼具 RL 的 on-policy 特性和蒸馏的 dense supervision. 

## 3. 数学目标：逐 token 的 Reverse KL

### 3.1 精确 Reverse KL

KL(pi_theta(.|s_t) || pi_teacher(.|s_t)) = sum_{a in V} pi_theta(a|s_t) log(pi_theta(a|s_t) / pi_teacher(a|s_t))

### 3.2 单样本估计

实际实现中，先采样一个 token：a_t ~ pi_theta(.|s_t)

单样本 reverse-KL 估计量：
k_hat_t = log pi_theta(a_t|s_t) - log pi_teacher(a_t|s_t)

对应的 reward：r_t = -k_hat_t = log pi_teacher(a_t|s_t) - log pi_theta(a_t|s_t)

### 3.3 训练目标

max J_OPD(theta) = E[q~D, y~pi_theta(.|q)] [sum_t r_t]

取 discount factor gamma = 0，则 G_t = r_t. 

## 4. 三种实现变体

### 4.1 Sampled-Token OPD

- 学生采样一个 token
- 教师只计算该 token 的 logprob
- 最简单、开销最小
- 对应实现：MiniLLM、基础 OPD

### 4.2 Top-k OPD

- 学生采样一个 token
- 教师计算 top-k 个最高概率 token 的分布
- 在局部分布上计算 KL
- 平衡了计算开销和信息量

### 4.3 Full-Vocabulary OPD

- 学生采样一个 token
- 教师计算完整词表的 logits
- 信息最完整，计算开销最大
- 对应实现：GKD、DeepSeek V4 的 Full-Vocabulary OPD

## 5. 为什么 Reverse KL 适合 OPD

1. **Mode-seeking**：倾向于逼近教师的某个具体高质量行为，而非分散概率
2. **缓解 Exposure Bias**：训练发生在学生自己采样的前缀上
3. **不容易被 Hack**：低 KL 直接意味着更接近教师的高概率行为
4. **高惩罚在分叉 token**：真正受惩罚的是把推理方向带偏的关键 token

## 6. 与现有工作的关系

| 工作 | 对应 OPD 变体 | 关键特点 |
|:-----|:-------------|:--------|
| MiniLLM | Sampled-token | 首个开源生成式 LLM 蒸馏 |
| GKD | Full-vocab | 学生自生成 + 教师反馈 |
| DeepSeek V4 | Full-vocab OPD | 教师按需加载、隐状态缓存 |
| SWIFT | Sampled-token | 高效推理部署 |
| verl | Full-vocab | 分布式训练框架 |

## 7. 工程实现要点

```python
# 简化的 OPD 伪代码
teacher_client = create_sampling_client(teacher_config)

# 1. 学生采样轨迹
trajectories = do_rollout(student_client)
sampled_logprobs = trajectories.logprobs

# 2. 教师计算轨迹上的 logprobs
teacher_logprobs = teacher_client.compute_logprobs(trajectories)

# 3. 计算逐 token reverse KL
reverse_kl = sampled_logprobs - teacher_logprobs
trajectories.advantages = -reverse_kl

# 4. RL 更新
training_client.forward_backward(trajectories, loss_fn="importance_sampling")
```

## 8. 实验效果

以 Qwen3-8B 学生、Qwen3-32B 教师、数学推理任务为例：

| 方法 | AIME'24 | GPU Hours |
|:-----|:--------|:----------|
| Off-policy distillation | 55.0% | - |
| + RL | 67.6% | 17,920 |
| + OPD | 74.4% | 1,800 |

OPD 用约 1/10 的 RL 成本，实现了更高的性能. 

---

## 9. 总结

OPD 的核心优势在于**把学生自己会走到的状态和教师密集的逐 token 监督结合起来**，既避免了 off-policy 的 compounding error，又解决了 RL 反馈稀疏的问题. 

> 参考来源：[On-Policy Distillation 深度解析](https://zhuanlan.zhihu.com/p/2033212181823608430)
