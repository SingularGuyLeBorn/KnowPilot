# GRPO算法家族详细对比

本文档对比GRPO及其所有变体的核心公式差异，使用 $\textcolor{red}{红色}$ 和 $\textcolor{blue}{蓝色}$ 标注关键区别. 

---

## 1. 核心公式对比

### 1.1 优势计算

#### GRPO (原始)

$$A_i = \frac{R_i - \bar{R}}{\textcolor{red}{\sigma_R + \epsilon}}$$

#### Dr-GRPO (推荐)

$$A_i = R_i - \bar{R}$$

**差异说明**: 
- $\textcolor{red}{\sigma_R}$: GRPO除以标准差进行归一化
- Dr-GRPO**移除了标准差归一化**，避免方差坍缩问题

---

### 1.2 概率比率计算

#### GRPO (Token级乘积)

$$r^{GRPO} = \textcolor{red}{\prod_{t=1}^T} \frac{\pi_\theta(y_t)}{\pi_{old}(y_t)}$$

#### GSPO (序列级)

$$r^{GSPO} = \exp\left(\textcolor{blue}{\sum_{t=1}^T} \log\frac{\pi_\theta(y_t)}{\pi_{old}(y_t)}\right)$$

**差异说明**: 
- GRPO使用 $\textcolor{red}{\prod}$ **Token级乘积**，可能导致数值爆炸
- GSPO使用 $\textcolor{blue}{\sum}$ **在log空间求和**，更稳定
- 数学上等价，但**裁剪级别不同**(见1.3)

---

### 1.3 裁剪方式

#### GRPO/PPO (对称裁剪)

$$L = -\min\left(r \cdot A, \textcolor{red}{\text{clip}(r, 1-\epsilon, 1+\epsilon)} \cdot A\right)$$

#### DAPO (解耦裁剪)

$$L = -\min\left(r \cdot A, \textcolor{blue}{\text{clip}^{decoupled}(r, A)} \cdot A\right)$$

其中: 
$$\text{clip}^{decoupled}(r, A) = \begin{cases}
\min(r, 1+\textcolor{blue}{\epsilon_{high}}) & \text{if } A > 0 \\
\max(r, 1-\epsilon_{low}) & \text{if } A < 0
\end{cases}$$

**差异说明**: 
- GRPO使用 $\textcolor{red}{\text{对称裁剪}}$: $[1-\epsilon, 1+\epsilon]$，正负优势同等对待
- DAPO使用 $\textcolor{blue}{\text{解耦裁剪}}$: 正优势时 $\epsilon_{high}=0.28$，负优势时 $\epsilon_{low}=0.2$

---

### 1.4 损失级别

#### GRPO (序列级损失)

$$L^{GRPO} = -\sum_i \textcolor{red}{r_i^{seq}} \cdot A_i$$

#### DAPO (Token级损失)

$$L^{DAPO} = -\sum_i \textcolor{blue}{\sum_t r_{i,t}^{token}} \cdot A_i$$

**差异说明**: 
- GRPO使用 $\textcolor{red}{r^{seq}}$ **序列级概率比**
- DAPO使用 $\textcolor{blue}{\sum_t r_t}$ **Token级求和**，更细粒度的信用分配

---

### 1.5 几何均值 (GMPO)

#### GRPO (算术)

$$r^{GRPO} = \prod_t r_t$$

#### GMPO (几何均值)

$$r^{GMPO} = \left(\prod_t r_t\right)^{\textcolor{blue}{1/T}}$$

**差异说明**: 
- GRPO直接使用乘积
- GMPO取 $\textcolor{blue}{1/T}$ **次幂(几何均值)** ，对异常值更鲁棒

---

## 2. 完整公式汇总表

| 算法 | 优势计算 | 概率比率 | 裁剪方式 | 损失级别 |
|------|----------|----------|----------|----------|
| **GRPO** | $(R_i - \bar{R})/\sigma$ | $\prod_t r_t$ | 对称 | 序列级 |
| **Dr-GRPO** | $R_i - \bar{R}$ | $\prod_t r_t$ | 对称 | 序列级 |
| **GSPO** | $(R_i - \bar{R})/\sigma$ | $\exp(\sum \log r_t)$，序列级裁剪 | 对称 | 序列级 |
| **DAPO** | $R_i - \bar{R}$ | Token级 | 解耦 | Token级 |
| **GMPO** | $(R_i - \bar{R})/\sigma$ | $(\prod r_t)^{1/T}$ | 对称 | 序列级 |

---

## 3. 关键差异可视化

### 3.1 裁剪边界对比

```
PPO/GRPO:     [1-ε ─────┬───── 1+ε]
                        1
              
DAPO (A>0):   [无限制 ──┬───── 1+ε_high]  (ε_high=0.28)
                        1
                        
DAPO (A<0):   [1-ε_low ─┬───── 无限制]    (ε_low=0.2)
                        1
```

### 3.2 概率比率计算对比

```
GRPO:   r = r₁ × r₂ × r₃ × ... × rₜ     (Token级乘积，可能溢出)
        ↓
GSPO:   r = exp(log r₁ + log r₂ + ...)  (log空间求和，稳定)
        ↓ 裁剪
GSPO:   clip(r, 1-ε, 1+ε)               (序列级裁剪，有界)
```

---

## 4. 算法选择指南

| 场景 | 推荐算法 | 原因 |
|------|----------|------|
| 一般LLM训练 | **Dr-GRPO** | 简单稳定，移除std归一化 |
| MoE模型 | **GSPO** | 序列级裁剪解决MoE不稳定 |
| 长CoT推理 | **DAPO** | 解耦裁剪防止熵坍缩 |
| 数学推理 | **DAPO** | AIME 50分验证 |

---

## 5. 详细理论分析链接

- [GRPO理论推导](./01_Theory_Derivation.md)
- [DAPO理论推导](../09_DAPO/01_Theory_Derivation.md)
- [GSPO理论推导](../10_GSPO/01_Theory_Derivation.md)

---

## 6. 参考文献

| 算法 | 论文 | arXiv |
|------|------|-------|
| GRPO | DeepSeekMath | 2402.03300 |
| GSPO | Group Sequence Policy Optimization | 2507.18071 |
| DAPO | DAPO: An Open-Source LLM RL System | 2505.14953 |
| GMPO | Geometric-Mean Policy Optimization | ICLR 2026 |
