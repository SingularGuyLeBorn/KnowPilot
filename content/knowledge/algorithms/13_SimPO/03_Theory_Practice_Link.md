# SimPO: 代码实现细节与避坑指南

本文档解释SimPO实现中的关键细节，特别是关于长度归一化和超参数设置. 

---

## 1. 长度归一化的重要性

### 1.1 问题: Sum vs Average

- **DPO** 使用 `sum_log_probs`. 因为 DPO 有参考模型 $\pi_{ref}$. 
  $$ \log \frac{\pi}{\pi_{ref}} = \sum \log \pi - \sum \log \pi_{ref} $$
  参考模型充当了"长度惩罚"的角色(长句子在 Ref 中概率也低，相减抵消了). 

- **SimPO** 没有参考模型. 
  如果使用 `sum_log_probs`，长回复(更多负数相加)的值天然更小. 
  模型会学到: **"只要我闭嘴(输出短)，分数就高"**. 

### 1.2 代码实现对比

```python
# DPO (Sum)
token_logps.sum(dim=-1)

# SimPO (Average)
token_logps.sum(dim=-1) / attention_mask.sum(dim=-1)
```

**坑点**: 在计算长度时，一定要mask掉padding token！使用 `attention_mask.sum()` 是最准的. 

---

## 2. Beta 和 Gamma 的设置

SimPO的公式: 
$$ \mathcal{L} = -\log \sigma (\beta(r_w - r_l) - \gamma) $$

### 2.1 Beta 的量级

- **DPO**: $\beta$ 通常是 0.1. 因为 $Sum \log P$ 的量级很大(例如 -100 到 -200). $0.1 \times 100 = 10$. 
- **SimPO**: Average Log P 的量级很小(例如 -2.0 到 -0.5). 
  为了进入 Sigmoid 的敏感区(-2 到 2)，我们需要更大的 Beta. 
  **推荐**: $\beta \in [2.0, 2.5]$. 

### 2.2 Gamma 的作用

Gamma 是目标间隔. 
- 如果 $\gamma = 0$: 只要 $r_w > r_l$ 一点点，loss 就很小. 
- 如果 $\gamma = 1.0$: 必须 $r_w > r_l + 0.4$ (当 Beta=2.5)，模型才满足. 

这迫使模型不仅要区分好坏，还要**拉开显著差距**. 

---

## 3. 混合精度训练 (Mixed Precision)

SimPO计算涉及 $\log \pi$ 的平均值，这可能导致数值精度问题. 
在使用 `float16` 或 `bfloat16` 时，建议在计算 Log Softmax 和 Sum/Mean 时转换回 `float32`，然后再转回低精度. 

```python
# 推荐实践
logits = logits.float() # Upcast to fp32
log_probs = F.log_softmax(logits, dim=-1)
...
return avg_log_probs.to(dtype) # Cast back if needed
```
