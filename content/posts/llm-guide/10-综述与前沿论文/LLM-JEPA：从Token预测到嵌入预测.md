---
title: "LLM-JEPA: 从 Token 预测到嵌入预测的实现"
date: 2026-05-17
tags: [JEPA, LLM-JEPA, 嵌入预测, 自监督学习, 表示学习, Joint Embedding Predictive Architecture]
---

# LLM-JEPA: 从 Token 预测到嵌入预测的实现

> 本文介绍 LLM-JEPA(Large Language Models Meet Joint Embedding Predictive Architectures)的核心思想与实现: 不预测 token,而是预测被遮蔽片段的嵌入表示. 

---

## 1. 核心思想

### 1.1 从生成式到预测式

传统语言模型(如 GPT)采用**生成式目标**: 
- 预测下一个 token
- 自回归生成

JEPA 采用**预测式目标**: 
- 预测被遮蔽片段的**嵌入表示**
- 非生成式、非重建式

### 1.2 核心机制

对同一文本创建两个视图: 

| 视图 | 处理 | 作用 |
|:-----|:-----|:-----|
| **Context 视图** | 将某些片段替换为 [MASK] | 输入Encoder  |
| **Target 视图** | 保留原始文本 | 提供监督信号 |

**Context Encoder **: 可训练,负责预测 target Encoder 在遮蔽位置的表示. 

**Target Encoder **: Context Encoder 的 EMA 副本,不参与梯度计算. 

---

## 2. 损失函数

使用**表示对齐损失**: 预测嵌入和目标嵌入之间的余弦距离. 

$$
\mathcal{L} = 1 - \cos(\hat{z}, z)
$$

其中: 
- $\hat{z}$: Context Encoder 预测的嵌入
- $z$: Target Encoder 生成的目标嵌入

---

## 3. 与相关方法的对比

| 方法 | 预测目标 | 训练方式 |
|:-----|:---------|:---------|
| **GPT** | 下一个 token | 自回归生成 |
| **BERT** | 被遮蔽 token | 掩码语言建模 |
| **JEPA** | 被遮蔽片段的嵌入 | 表示对齐 |

### 3.1 优势

1. **更高层级的表示学习**: 不局限于 token 级别
2. **连续空间预测**: 在嵌入空间中进行,信息更丰富
3. **非生成式**: 不需要Decoder  ,训练更高效

---

## 4. 实现要点

### 4.1 数据构造

```python
# 对同一文本创建两个视图
context_view = mask_segments(text, mask_ratio=0.3)
target_view = text  # 保持原始
```

### 4.2 Encoder 设计

- **Context Encoder **: 标准 Transformer,可训练
- **Target Encoder **: EMA 更新,不参与梯度

```python
# Target Encoder  EMA 更新
for param_t, param_c in zip(target_encoder.parameters(), 
                             context_encoder.parameters()):
    param_t.data = momentum * param_t.data + (1 - momentum) * param_c.data
```

### 4.3 遮蔽策略

- 随机遮蔽连续片段(span masking)
- 遮蔽比例通常 15%-30%
- 遮蔽位置用于计算损失

---

## 5. 训练细节

### 5.1 超参数

| 参数 | 推荐值 |
|:-----|:-------|
| Mask Ratio | 0.3 |
| EMA Momentum | 0.996 |
| Batch Size | 8-32 |
| Learning Rate | 1e-4 |

### 5.2 运行示例

```bash
# 小型冒烟测试
python llm_jepa_train.py --smoke_test

# 使用 HF 模型骨干训练
python llm_jepa_train.py --model_name distilbert-base-uncased --steps 200
```

---

## 6. 应用场景

1. **表示学习**: 学习高质量的文本嵌入
2. **下游任务微调**: 在嵌入预测预训练基础上微调
3. **多模态扩展**: 扩展到图像-文本联合嵌入预测

---

## 7. 总结

LLM-JEPA 代表了一种新的自监督学习范式: 
- **不预测离散 token**,而是预测连续嵌入
- **不重建输入**,而是对齐表示
- **非生成式**,但学习效果优异

这一方向为语言模型的预训练提供了新的思路,特别是在表示学习和多模态场景中有广阔应用前景. 

> 参考来源: [用 PyTorch 实现 LLM-JEPA: 不预测 token,预测嵌入](https://zhuanlan.zhihu.com/p/2001043891273634657)
