---
title: "算法与数学推导"
category: null
tags:
  - "算法"
  - "数学推导"
  - "Self-Attention"
  - "RoPE"
  - "FlashAttention"
  - "MoE"
  - "PPO"
  - "采样"
published: true
excerpt: "面经范文：公式一律用 $…$ / $$…$$（KaTeX），禁止 √d_k / Q·Kᵀ 等 Unicode 伪公式。"
---
# 算法与数学推导

> ⚠️ **时效性说明**：本专题收录需要数学推导能力的面试题。每题标注元数据，涵盖 2024-2026 年考点。
>
> **来源**：Bojie Li《图解大模型》200问、kk笔记、知乎面经、AgentGuide、掘金
>
> **写法铁律（给作者 / Agent）**：凡公式必须用 LaTeX 定界——行内 `$…$`、块级 `$$…$$`。禁止 `√d_k`、`dₖ`、`Q·Kᵀ`、`Σ`、`≈` 当公式。

---

## 1. Self-Attention 为什么除以 $\sqrt{d_k}$？（数学推导 + 几何解释）

- **元数据**：`{topic: "算法·数学推导", subtopic: "Attention机制", source: "图解大模型200问+掘金", quality: 5, year: "经典题·持续有效", difficulty: mid}`

**数学推导**：

设 $q, k \in \mathbb{R}^{d_k}$，各分量独立服从 $\mathcal{N}(0,1)$。则

$$
q \cdot k = \sum_{i=1}^{d_k} q_i k_i
$$

每个 $q_i k_i$ 的均值为 $0$、方差为 $1$，因此

$$
\mathrm{Var}(q \cdot k) = d_k
$$

若不做缩放直接 Softmax，当 $d_k$ 很大时输入方差极大，Softmax 落入极端区域（几乎 one-hot），梯度趋于 $0$。

除以 $\sqrt{d_k}$ 后：

$$
\mathrm{Var}\left(\frac{q \cdot k}{\sqrt{d_k}}\right) = \frac{d_k}{d_k} = 1
$$

方差稳定在 $1$，Softmax 梯度正常流通。完整 Attention：

$$
\mathrm{Attention}(Q,K,V)=\mathrm{softmax}\left(\frac{QK^{T}}{\sqrt{d_k}}\right)V
$$

**几何解释**：在 $d_k$ 维空间中，随机向量模长约 $\sqrt{d_k}$。除以 $\sqrt{d_k}$ 相当于把 $Q$、$K$ 缩放到单位球面附近，使点积不受维度膨胀影响。

**追问**：「$d_k=4096$ 不缩放会怎样？」→ 点积方差为 $4096$，Softmax 近 one-hot，反向梯度 $\approx 0$，模型无法训练。

---

## 2. RoPE 位置编码的核心公式推导

- **元数据**：`{topic: "算法·位置编码", subtopic: "RoPE推导", source: "图解大模型200问+小林笔记", quality: 5, year: "经典题·持续有效", difficulty: senior}`

**核心思想**：在 $Q$、$K$ 上施加旋转变换，使内积只与相对位置差 $(m-n)$ 有关。

**二维情况**：设 $q=[x_1,x_2]$，位置 $m$ 的旋转：

$$
\mathrm{RoPE}(q,m)=\begin{pmatrix}\cos m\theta & -\sin m\theta \\ \sin m\theta & \cos m\theta\end{pmatrix}\begin{pmatrix}x_1\\x_2\end{pmatrix}
$$

即 $q$ 左乘旋转矩阵 $R(m)$。性质：

$$
\langle \mathrm{RoPE}(q,m),\mathrm{RoPE}(k,n)\rangle = \langle q,\, R(n-m)\, k\rangle
$$

只与位置差有关。

**扩展到高维**：将 $d$ 维分成 $d/2$ 个二维子空间，频率

$$
\theta_j = \mathrm{base}^{-2j/d}
$$

**为什么能外推**：旋转连续；超长位置只是转角更大，形式不变，不会 OOD。可再配合 NTK-aware 插值。

**追问**：「Partial RoPE？」→ 只对部分维度旋转，其余 NoPE；DeepSeek MLA 推理常用此方案。

---

## 3. FlashAttention 的分块策略与 IO 复杂度分析

- **元数据**：`{topic: "算法·工程优化", subtopic: "FlashAttention", source: "图解大模型200问+vLLM文档", quality: 5, year: "2025-2026", difficulty: senior}`

**核心思想**：分块（tiling）+ 重计算（recomputation），减少 HBM 读写。

**分块策略**：
1. 将 $Q$、$K$、$V$ 切为 $B_r \times B_c$ 块
2. 每块载入 SRAM（约 $192\,\mathrm{KB}$）算局部 Attention
3. 在线更新 Softmax 归一化因子（local max / sum → 合并全局）

**IO 复杂度对比**（$M$ = SRAM 大小）：

| 方法 | HBM 读写复杂度 | 加速比 |
|---|---|---|
| 标准 Attention | $O(N^{2}\cdot d)$ | $1\times$ |
| FlashAttention-1 | $O(N^{2}\cdot d^{2}/M)$ | $\sim 2\text{–}4\times$ |
| FlashAttention-2 | 同阶 + 并行优化 | 优于 v1 约 $2\text{–}3\times$ |
| FlashAttention-3 (Hopper FP8) | Tensor Core + 异步拷贝 | 优于 v2 约 $2\times$ |

当 $N>8\mathrm{K}$ 时加速更明显。

**追问**：「backward 为何不存完整 Attention 矩阵？」→ 反向时按块重算前向（recompute），用时间换显存。

---

## 4. MoE 门控网络与负载均衡 Loss

- **元数据**：`{topic: "算法·架构", subtopic: "MoE", source: "图解大模型200问+DeepSeek技术报告", quality: 5, year: "2025-2026", difficulty: senior}`

**门控网络**：

$$
G(x)=\mathrm{softmax}\bigl(\mathrm{TopK}(W_g x)\bigr)
$$

$W_g$ 为门控权重，$\mathrm{TopK}$ 选得分最高的 $K$ 个专家。

**负载均衡 Loss**（辅助 loss）：

$$
\mathcal{L}_{\mathrm{balance}}=\alpha\cdot K\cdot\sum_{i=1}^{E} f_i P_i
$$

其中：
- $f_i$：分给专家 $i$ 的 token 比例
- $P_i$：门控分给专家 $i$ 的概率
- $\alpha$：平衡系数（常取 $0.01$）
- 均匀时 $f_i\approx 1/E$、$P_i\approx 1/E$，loss 最小

**DeepSeek MoE**：细粒度 expert 分裂、共享专家、token 级负载均衡。

**追问**：「Expert Capacity？」→ 每专家最大 token 数；超出则残差 bypass，防 OOM。

---

## 5. PPO 的 Clip 目标函数推导

- **元数据**：`{topic: "算法·强化学习", subtopic: "PPO-Clip", source: "图解大模型200问+掘金+PPO论文", quality: 5, year: "2025-2026", difficulty: senior}`

**优化目标**：

$$
L^{\mathrm{CLIP}}(\theta)=\mathbb{E}_{t}\Bigl[\min\bigl(r_t(\theta)\hat{A}_t,\;\mathrm{clip}(r_t(\theta),1-\varepsilon,1+\varepsilon)\hat{A}_t\bigr)\Bigr]
$$

重要性采样比率：

$$
r_t(\theta)=\frac{\pi_{\theta}(a_t|s_t)}{\pi_{\theta_{\mathrm{old}}}(a_t|s_t)}
$$

**推导思路**：
1. 策略梯度：步子太大 → 性能崩
2. TRPO 用 KL 约束，算力重
3. PPO-Clip：把 $r_t(\theta)$ 限制在 $[1-\varepsilon,1+\varepsilon]$

**$\min$ 的几何意义**：
- $\hat{A}_t>0$（好动作）：上限 $1+\varepsilon$，防过度抬高概率
- $\hat{A}_t<0$（差动作）：下限 $1-\varepsilon$，防大幅压低概率

**RLHF**：$\hat{A}_t$ 由 Reward Model + GAE 得到；clip 使 policy 不偏离 SFT 太远。

**追问**：「$\varepsilon$ 取多少？」→ 常取 $0.2$。太小更新慢；太大失去约束。

---

## 6. Top-p / Top-k 采样原理

- **元数据**：`{topic: "算法·解码策略", subtopic: "采样方法", source: "图解大模型200问+KK笔记", quality: 4, year: "经典题·持续有效", difficulty: junior}`

**Top-$k$**：从概率最高的 $k$ 个 token 中采样（重归一化）。$k$ 太小缺多样性；$k$ 太大质量掉。

**Top-$p$（Nucleus）**：取累积概率超过 $p$ 的最小集合再采样。分布尖锐时集合小，平坦时集合大。

**Temperature**：对 logits 做 $\mathrm{softmax}(z/\tau)$。$\tau\to 0$ 趋近 greedy；$\tau\to\infty$ 趋近均匀；$\tau=1$ 为原始分布。

**组合**：先 temperature，再 top-$p$。

**追问**：「能否只用 $\mathrm{argmax}$？」→ 易重复、单调；采样引入多样性。

---

## 7. 解码策略：Greedy vs Beam vs 采样

- **元数据**：`{topic: "算法·解码策略", subtopic: "序列生成", source: "图解大模型200问+小林笔记", quality: 4, year: "经典题·持续有效", difficulty: mid}`

| 策略 | 原理 | 多样性 | 质量 | 成本 |
|---|---|---|---|---|
| Greedy | 每步 $\mathrm{argmax}$ | 低 | 一般 | 最低 |
| Beam Search | 维护 $B$ 条路径 | 低 | 较高 | 较高 |
| Top-$k$ | 从 Top-$k$ 采样 | 中 | 中 | 低 |
| Top-$p$ | 从核集合采样 | 高 | 高 | 低 |
| Contrastive Search | 对比惩罚重复 | 高 | 高 | 中 |

**场景**：翻译/摘要 → Beam；对话/故事 → Top-$p$；代码 → $\tau\approx 0.1$ + Top-$p$。

---

## 8. 激活函数：ReLU vs GELU vs SwiGLU

- **元数据**：`{topic: "算法·架构", subtopic: "激活函数", source: "图解大模型200问", quality: 4, year: "2024-2026", difficulty: mid}`

| 函数 | 特点 | 代表 |
|---|---|---|
| ReLU | 简单快，易死神经元 | 早期 Transformer |
| GELU | 平滑近似 ReLU | BERT, GPT-3 |
| SwiGLU | 门控 + Swish，效果更好 | LLaMA, PaLM, Qwen |

$$
\mathrm{Swish}(x)=x\cdot\sigma(x),\qquad
\mathrm{SwiGLU}(x)=\mathrm{Swish}(W_1 x)\odot (W_2 x)
$$

SwiGLU 相对 GELU 约 $1.5\times$ 参数（$W_1,W_2,W_3$）；同等算力下常把 FFN 隐层缩到 $2/3$ 保持总参不变。

---

## 来源汇总

- Bojie Li《图解大模型》面试 200 问（01.me）
- 知乎面经汇总 / 掘金大模型面试题
- KK 笔记 / 小林笔记
- AgentGuide 面经（12-company-interview-cases）
- DeepSeek V2/V3/R1 技术报告
- vLLM 官方文档

**🔍 补充方向**：GQA 与 MLA 的矩阵运算量对比、FlashAttention-3 Hopper 优化细节、Mamba/SSM 数学推导
