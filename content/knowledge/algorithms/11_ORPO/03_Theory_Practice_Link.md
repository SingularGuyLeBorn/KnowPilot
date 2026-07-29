# ORPO: 从公式到代码的实现指南

本文档解释如何将Odds Ratio Preference Optimization (ORPO) 的数学目标转化为可执行的PyTorch代码。

---

## 1. 核心挑战: 数值稳定性

### 1.1 Log Odds 公式

数学定义: 
$$ \text{odds}(p) = \frac{p}{1-p} $$

我们通常处理的是 Log Space: 
$$ \log \text{odds}(p) = \log p - \log(1-p) $$

在代码中，输入通常是 `log_p`。
如果直接计算 `1 - exp(log_p)`: 
- 当 `log_p` 很小(如 -100)，`exp` 接近0，没问题。
- 当 `log_p` 接近 0(如 -1e-7)，`exp` 接近 1，`1 - 1 = 0`，导致 `log(0) = -inf`。

### 1.2 解决方案: log1p

利用PyTorch的 `log1p(x)` 函数，它计算 $\log(1+x)$ 且在 x 接近0时非常精确。

我们将公式变形: 
$$ \log(1-p) = \log(1 - e^{\log p}) = \log(1 + (-e^{\log p})) $$
代码: 
```python
torch.log1p(-torch.exp(log_p))
```

此外，为了防止 $p=1$(虽然在生成模型中很少见)，我们可以截断 `log_p`: 
```python
log_p = torch.clamp(log_p, max=-1e-7)
```

---

## 2. ORPO vs DPO 实现对比

### DPO
需要两个模型(Policy和Ref)。
loss涉及到四个概率值: `pi_w`, `pi_l`, `ref_w`, `ref_l`。

```python
r_w = beta * (pi_w - ref_w)
r_l = beta * (pi_l - ref_l)
loss = -F.logsigmoid(r_w - r_l)
```

### ORPO
只需要一个模型(Policy)。
loss只涉及 policy 的 `pi_w`, `pi_l`，**加上 SFT Loss**。

```python
# Odds Ratio Part
odds_w = compute_log_odds(pi_w)
odds_l = compute_log_odds(pi_l)
or_loss = -F.logsigmoid(odds_w - odds_l)

# SFT Part
nll_loss = -sum(pi_w) # Traditional NLL

total_loss = nll_loss + lambda * or_loss
```

---

## 3. 概率归一化选择

ORPO论文特别指出，在计算 Odds 时，使用的是**Average Log Probability**(除以长度)。

$$ \text{Average LogP} = \frac{1}{T} \sum_{t=1}^T \log P(y_t | y_{<t}, x) $$

而在计算 SFT Loss (NLL) 时，当然是使用 **Sum Log Probability**。

**这一点在代码中必须区分**: 
```python
# SFT
get_batch_log_probs(..., average_log_prob=False)

# ORPO Odds
get_batch_log_probs(..., average_log_prob=True)
```

如果不除以长度，长回复的 $log\_p$ 会自然比短回复小(更负)，导致Odds Ratio偏向短回复，这是不期望的。

---

## 4. 显存优化

因为不需要参考模型，ORPO的显存占用几乎减半。这使得在单卡上微调更大的模型(如Llama-3-8B甚至70B qLoRA)成为可能。
