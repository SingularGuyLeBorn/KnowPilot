# 【范文】算法面经片段（写知识库时照抄格式）

> 来源：`content/uploads/llm-interview/2026-07-29/algorithms.md`（完整版）。下方是你落盘 Markdown 时必须对齐的公式写法。

## 1. Self-Attention 为什么除以 $\sqrt{d_k}$？

设 $q, k \in \mathbb{R}^{d_k}$，各分量独立服从 $\mathcal{N}(0,1)$。则

$$
q \cdot k = \sum_{i=1}^{d_k} q_i k_i
$$

每个 $q_i k_i$ 均值 $0$、方差 $1$，故 $\mathrm{Var}(q\cdot k)=d_k$。除以 $\sqrt{d_k}$ 后：

$$
\mathrm{Var}\left(\frac{q \cdot k}{\sqrt{d_k}}\right)=1
$$

完整公式：

$$
\mathrm{Attention}(Q,K,V)=\mathrm{softmax}\left(\frac{QK^{T}}{\sqrt{d_k}}\right)V
$$

**追问**：「$d_k=4096$ 不缩放？」→ Softmax 近 one-hot，梯度 $\approx 0$。

## 2. PPO-Clip（块级公式写法）

$$
L^{\mathrm{CLIP}}(\theta)=\mathbb{E}_{t}\Bigl[\min\bigl(r_t(\theta)\hat{A}_t,\;\mathrm{clip}(r_t(\theta),1-\varepsilon,1+\varepsilon)\hat{A}_t\bigr)\Bigr]
$$

其中 $r_t(\theta)=\pi_{\theta}(a_t|s_t)/\pi_{\theta_{\mathrm{old}}}(a_t|s_t)$，$\varepsilon$ 常取 $0.2$。

## ❌ 禁止写成这样（前端不渲染）

Self-Attention 除以 √d_k。Var(q·k)=d_k。当 d_k=4096 时梯度 ≈ 0。
PPO: L = E[min(r·A, clip(r,1-ε,1+ε)·A)]
