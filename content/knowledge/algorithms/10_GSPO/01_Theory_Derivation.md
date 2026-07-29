# 第10章: GSPO (Group Sequence Policy Optimization)

**论文信息**: 
- **标题**: Group Sequence Policy Optimization
- **作者**: Qwen Team, Alibaba Inc.
- **年份**: 2025
- **arXiv**: 2507.18071
- **验证**: Qwen3全系列模型(Instruct、Coder、Thinking)的核心训练算法
- **PDF**: 见 `papers/` 目录

**前置知识**: GRPO(第8章)、DAPO(第9章)

---

## 0. 本章目标

GSPO是**阿里巴巴Qwen团队**提出的LLM强化学习算法，解决了GRPO在MoE模型训练中的不稳定问题. 

> **GSPO核心思想**: 奖励是序列级的，优化也应该是序列级的. 

本章将: 

1. 分析GRPO的token级问题
2. 详细推导GSPO的序列级重要性比率
3. 解释为什么GSPO更稳定
4. 展示完整的代码实现

---

## 1. 动机: GRPO的隐患

### 1.1 Token级 vs 序列级的不匹配

**GRPO的矛盾**: 

| 组件 | 级别 | 说明 |
|------|------|------|
| 奖励 | **序列级** | 整个response一个分数 |
| 优化 | **Token级** | 每个token独立的概率比 |

**问题**: Token级概率比的乘积可能爆炸或坍缩: 

$$r^{seq} = \prod_{t=1}^T \frac{\pi_\theta(y_t|y_{<t})}{\pi_{old}(y_t|y_{<t})} = \prod_{t=1}^T r_t$$

当 $T$ 很大(长CoT推理)时: 
- 如果多数 $r_t > 1$: $r^{seq}$ 可能爆炸到 $10^{10}$
- 如果多数 $r_t < 1$: $r^{seq}$ 可能坍缩到 $10^{-10}$

### 1.2 MoE训练的特殊问题

Mixture-of-Experts (MoE) 模型在GRPO训练中经常崩溃: 

- **原因**: 专家路由的微小变化导致token级概率剧烈波动
- **现象**: 训练loss爆炸，模型崩溃
- **Qwen发现**: 这是token级优化的根本问题

---

## 2. GSPO的核心创新

### 2.1 序列级重要性比率

**GSPO的关键改变**: 在**log空间**定义序列级比率. 

$$\log r^{GSPO} = \sum_{t=1}^T \log \pi_\theta(y_t|y_{<t}) - \sum_{t=1}^T \log \pi_{old}(y_t|y_{<t})$$

等价于: 
$$r^{GSPO} = \exp\left(\log \pi_\theta(y) - \log \pi_{old}(y)\right)$$

**与GRPO的对比**: 

| 方法 | 公式 | 数值范围 |
|------|------|----------|
| GRPO | $r = \prod_t r_t$ | 可能 $10^{-10}$ 到 $10^{10}$ |
| GSPO | $r = \exp(\text{log\_diff})$ | 受控的有限范围 |

![Token级 vs 序列级](images/sequence_vs_token.png)

*图注: 左边是GRPO的token级方法(概率比相乘可能爆炸)，右边是GSPO的序列级方法(在log空间计算更稳定). *

### 2.2 序列级裁剪

GSPO在序列级别应用PPO裁剪: 

$$L^{GSPO} = -\mathbb{E}_{x, y}\left[\min(r^{GSPO} A, \text{clip}(r^{GSPO}, 1-\epsilon, 1+\epsilon) A)\right]$$

**关键点**: 
- 裁剪作用于整个序列的概率比
- 而不是每个token的概率比

### 2.3 序列级奖励对齐

> **Qwen的核心论点**: 奖励的单位应该与优化的单位一致. 

| 单位 | 奖励 | 优化 | GSPO |
|------|------|------|------|
| Token级 | ✗ | ✓ (GRPO) | ✗ |
| 序列级 | ✓ | ✓ (GSPO) | ✓ |

---

## 3. 数学推导

### 3.1 GRPO的问题分析

Token级概率比的乘积: 

$$r^{GRPO} = \prod_{t=1}^T r_t = \prod_{t=1}^T \exp(\log r_t) = \exp\left(\sum_{t=1}^T \log r_t\right)$$

其中 $\log r_t = \log \pi_\theta(y_t) - \log \pi_{old}(y_t)$. 

**问题**: 当 $T$ 很大，$\sum_t \log r_t$ 的方差线性增长，导致 $r^{GRPO}$ 的方差指数增长. 

### 3.2 GSPO的解决方案

**直接在log空间定义**: 

$$\log r^{GSPO} = \sum_t \log \pi_\theta(y_t) - \sum_t \log \pi_{old}(y_t)$$

这看起来和GRPO一样，但关键区别在于**裁剪方式**: 

**GRPO裁剪**: 
```python
# 每个token裁剪后再乘
clipped_ratio = [clip(r_t, 1-ε, 1+ε) for r_t in ratios]
seq_ratio = prod(clipped_ratio)  # 仍然可能爆炸
```

**GSPO裁剪**: 
```python
# 序列ratio上直接裁剪
seq_ratio = exp(sum_log_new - sum_log_old)
clipped_seq_ratio = clip(seq_ratio, 1-ε, 1+ε)  # 有界
```

### 3.3 数值稳定性分析

设每个token的 $\log r_t$ 服从均值为0、方差为 $\sigma^2$ 的分布. 

**GRPO(Token级乘积)** : 
$$\text{Var}[\log r^{GRPO}] = T \cdot \sigma^2$$

当 $T = 4096$，$r^{GRPO}$ 的范围可达 $e^{\pm 64\sigma}$. 

**GSPO(序列级裁剪)** : 
$$r^{GSPO} \in [1-\epsilon, 1+\epsilon]$$

始终有界. 

---

## 4. GSPO完整算法

### 4.1 伪代码

```
算法: GSPO

输入: 策略模型 π_θ, 参考模型 π_ref, Prompt集合 D, 组大小 G

重复:
  1. 组采样:
     对每个 prompt x ∈ D:
       采样 {y_1, ..., y_G} ~ π_θ
       计算奖励 {R_1, ..., R_G}
  
  2. 计算组优势:
     A_i = R_i - mean(R_1, ..., R_G)
  
  3. 计算序列级log概率:
     log_π_θ(y_i) = Σ_t log π_θ(y_t | y_{<t})
     log_π_old(y_i) = Σ_t log π_old(y_t | y_{<t})
  
  4. 计算序列级比率:
     r_i = exp(log_π_θ(y_i) - log_π_old(y_i))
  
  5. 序列级裁剪:
     clipped_r_i = clip(r_i, 1-ε, 1+ε)
  
  6. GSPO损失:
     L = -mean(min(r_i · A_i, clipped_r_i · A_i))
  
  7. 梯度更新:
     θ ← θ - α∇L
```

### 4.2 超参数

| 参数 | 值 | 说明 |
|------|----|----|
| clip_epsilon | 0.2 | 裁剪范围 |
| group_size | 8 | 每prompt采样数 |
| kl_coef | 0.01 | KL惩罚系数 |

---

## 5. GSPO vs GRPO vs DAPO

### 5.1 核心差异

| 特性 | GRPO | GSPO | DAPO |
|------|------|------|------|
| 比率级别 | Token级乘积 | 序列级 | Token级 |
| 裁剪方式 | Token级对称 | 序列级对称 | Token级解耦 |
| MoE稳定性 | ✗ | ✓ | 中 |
| 来源 | DeepSeek | Qwen | ByteDance |

### 5.2 公式对比

**GRPO**:
$$r^{GRPO} = \prod_t \frac{\pi_\theta(y_t)}{\pi_{old}(y_t)}$$

**GSPO**:
$$r^{GSPO} = \exp\left(\sum_t \log\pi_\theta(y_t) - \sum_t \log\pi_{old}(y_t)\right)$$

**数学上等价，但实现上有关键区别: GSPO在序列级裁剪！**

---

## 6. 本章总结

### 6.1 核心公式

| 组件 | 公式 |
|------|------|
| 序列log概率 | $\log\pi(y) = \sum_t \log\pi(y_t\|y_{<t})$ |
| 序列比率 | $r = \exp(\log\pi_\theta - \log\pi_{old})$ |
| GSPO损失 | $-\min(r \cdot A, \text{clip}(r) \cdot A)$ |

### 6.2 GSPO的贡献

1. **解决MoE不稳定**: 序列级优化避免token级方差爆炸
2. **奖励-优化对齐**: 序列级奖励匹配序列级优化
3. **Qwen3支柱**: 所有Qwen3变体的核心算法
4. **简化基础设施**: 减少精度敏感性

---

## 7. 开源实现参考

- **论文**: https://arxiv.org/abs/2507.18071
- **verl**: https://github.com/volcengine/verl (将支持GSPO)

---

**下一章预告**: [第16章: GMPO与几何均值](../16_GMPO/01_Theory_Derivation.md)
