---
title: DeepSeek DSpark 原理推导：置信度调度的半自回归投机解码
category: 推理加速
published: true
excerpt: >-
  DeepSeek
  DSpark（arXiv:2607.05147）是置信度调度的半自回归投机解码框架：并行主干+轻量顺序修正提升接受率，置信度头+硬件感知调度器动态决定验证长度，让
  V4 系列推理提速 60-85% 且无损、不重训。本文从投机解码数学原理出发，完整推导接受率、期望接受长度、加速比上限与调度目标函数。
tags:
  - DSpark
  - DeepSeek
  - 投机解码
  - Speculative Decoding
  - 推理加速
  - 半自回归
  - 原理推导
---
# DeepSeek DSpark 原理推导：置信度调度的半自回归投机解码

> **论文**：*DSpark: Confidence-Scheduled Speculative Decoding with Semi-Autoregressive Generation*（DeepSeek-AI + 北京大学，arXiv:2607.05147，2026-07）
> **开源**：训练框架 DeepSpec（MIT 协议，预设支持 Qwen3 / Gemma4，不绑定 DeepSeek 自家模型）
> **生产**：2026-06-27 上线 DeepSeek-V4-Flash / V4-Pro，单用户生成速度提升 60%–85%（Flash）/ 57%–78%（Pro）
> **一句话**：DSpark 用「重并行主干 + 轻量顺序修正」的半自回归草稿生成，配合按置信度与系统负载动态调度的验证长度，把投机解码的草稿质量与验证开销同时优化到极致——**不重训、不改权重**，只是给现成模型挂上一个推理模块。

---

## 1. 背景：自回归解码为什么慢？

LLM 生成文本是自回归的：给定前缀 $x_{1:t}$，一次只预测一个 token，

$$
x_{t+1} \sim p_{\theta}(\cdot \mid x_{1:t})
$$

每生成一个 token 都要做一次完整的前向传播。设模型单步前向延迟为 $T_{\mathrm{step}}$，生成长度为 $L$ 的序列总延迟为

$$
T_{\mathrm{AR}} = L \cdot T_{\mathrm{step}}
$$

其根本瓶颈在于**内存带宽**而非算力：Transformer 权重巨大，而每步只消费一个 token 的激活，计算量远小于权重搬运量，GPU 处于严重「memory-bound」状态——大量算力在等待权重读出中空转。这正是投机解码（Speculative Decoding，Chen et al. 2023；Leviathan et al. 2023）要解决的问题。

---

## 2. 投机解码：数学原理与无损性

### 2.1 机制

用一个**轻量草稿模型（draft model）** $q$ 自回归地生成一段候选块 $\tilde{x}_{1:\gamma}$，再用**完整目标模型（target model）** $p$ 在**一次前向**中并行验证整块，通过**拒绝采样**决定接受前缀长度：

$$
\alpha_t = \min\left(1, \frac{p(\tilde{x}_t \mid x_{1:t-1})}{q(\tilde{x}_t \mid x_{1:t-1})}\right)
$$

采样 $u_t \sim \mathrm{Uniform}[0,1]$，若 $u_t \leq \alpha_t$ 则接受 $\tilde{x}_t$，继续验证 $t+1$；否则在第一个被拒位置 $t$ 处以修正分布采样补偿 token：

$$
p_{\mathrm{corr}}(x) \propto \max\left(0, p(x \mid x_{1:t-1}) - q(x \mid x_{1:t-1})\right)
$$

### 2.2 为什么无损？

标准投机解码的关键性质：**输出分布与原自回归采样分布完全一致（lossless）**。直观证明：接受概率 $\alpha_t$ 正是「两个分布在该 token 上一致程度」的度量，拒绝时以二者差分布回采样，恰好补偿了被拒绝的质量损失。形式化地，对任意位置，接受事件的联合分布满足

$$
p_{\mathrm{SD}}(x_{1:\tau}) = p_{\mathrm{AR}}(x_{1:\tau}), \quad \forall \tau
$$

其中 $p_{\mathrm{AR}}$ 是纯自回归采样分布。因此投机解码**永远不降低输出质量**，只是把「串行验证」变成「猜一串 + 并行验证」。

### 2.3 加速比推导

设草稿模型与目标模型单步延迟分别为 $T_q$、$T_p$（一般 $T_q \ll T_p$）。一轮循环：草稿模型串行生成 $\gamma$ 个 token（耗时 $\gamma T_q$），目标模型并行验证整块（耗时 $T_p$）。设 $\tau$ 为本轮被接受的长度，则

$$
\mathbb{P}(\tau \geq t) = \prod_{i=1}^{t} \alpha_i
$$

期望接受长度（含补偿 token，因此 $\tau$ 至少为 1）：

$$
\mathbb{E}[\tau] = 1 + \sum_{t=1}^{\gamma} \prod_{i=1}^{t} \alpha_i
$$

每一轮平均产出 $\mathbb{E}[\tau]$ 个 token、耗时 $T_p + \gamma T_q$，于是加速比

$$
\text{Speedup} = \frac{\mathbb{E}[\tau] \cdot T_{\mathrm{step}}}{T_p + \gamma T_q}
$$

其中 $T_{\mathrm{step}}$ 是无投机时每 token 的目标模型延迟（$=T_p$）。当接受率高（$\alpha_i \approx 1$、$\mathbb{E}[\tau] \approx \gamma+1$）且草稿很便宜（$T_q \ll T_p/\gamma$）时，

$$
\text{Speedup} \approx \frac{\gamma + 1}{1 + \gamma \cdot T_q / T_p} \to \gamma + 1
$$

这就是投机解码理论上限：**接受率越高、块越长、草稿越便宜，加速越接近 $\gamma+1$ 倍**。DSpark 的全部设计都围绕两个杠杆展开——把 $\alpha_i$ 做高（草稿质量），把浪费在低 $\alpha_i$ token 上的验证算力省下来（动态调度）。

---

## 3. 草稿生成的两难：自回归 vs 并行

### 3.1 自回归 drafter（如 EAGLE-3）

草稿模型自己也逐 token 生成，质量高、条件依赖完整：

$$
q(\tilde{x}_t) = q(\tilde{x}_t \mid \tilde{x}_{1:t-1}, x_{1:n})
$$

但代价是草稿阶段本身是**串行**的，$\gamma T_q$ 随块长线性增长，吃掉加速。

### 3.2 并行 drafter（如 Medusa、DFlash）

一次前向并行产出整块草稿，各位置**条件独立**于彼此：

$$
q(\tilde{x}_1, \ldots, \tilde{x}_\gamma) = \prod_{t=1}^{\gamma} q_t(\tilde{x}_t \mid x_{1:n})
$$

草稿阶段一步完成（$\gamma T_q \approx T_q$），但**每个位置都缺失了「块内前缀」信息**——位置 $t$ 的预测不知道位置 $1..t-1$ 猜了什么。后果是**接受率随位置快速衰减（suffix decay）**：

$$
\alpha_1 \gg \alpha_2 \gg \cdots \gg \alpha_\gamma
$$

数学上，令 $p_t^{\star}$ 为真实条件分布，则并行草稿的接受率

$$
\alpha_t = \mathbb{E}_{\tilde{x}_{<t} \sim q}\left[\min\left(1, \frac{p(\tilde{x}_t \mid x_{1:n}, \tilde{x}_{<t})}{q_t(\tilde{x}_t \mid x_{1:n})}\right)\right]
$$

由于 $q_t$ 没有以 $\tilde{x}_{<t}$ 为条件，$q_t$ 与 $p(\cdot \mid \tilde{x}_{<t})$ 的 KL 散度随 $t$ 增大而增大，接受率递减；块尾部 token 的验证几乎必然失败——**把宝贵的目标模型算力浪费在注定要死的后缀上**。

---

## 4. DSpark 核心一：半自回归（Semi-Autoregressive）草稿

DSpark 的做法是**两头都要**：

### 4.1 架构

$$
\underbrace{\text{Heavy Parallel Backbone}}_{\text{一步并行产出整块表示}} + \underbrace{\text{Lightweight Sequential Module}}_{\text{逐 token 微调局部连贯性}}
$$

1. **并行主干**：与 DFlash 一样，单次前向为整块位置并行生成草稿表示（draft representations），速度与并行 drafter 持平；
2. **轻量顺序修正模块**：在草稿表示之上逐位置走一遍，只看「前一个位置猜了什么」，把每个 token 向「真正的前缀依赖」方向修正。

形式化：设并行主干输出块内隐藏表示 $H = [h_1, \ldots, h_\gamma]$，顺序修正模块逐位置计算

$$
\tilde{x}_t \sim \mathrm{softmax}\left(W_o \cdot f(h_t, \phi(\tilde{x}_{t-1}))\right)
$$

其中 $\phi$ 是 token 嵌入（与主干共享），$f$ 是一个极轻量的映射（如单层 MLP），$W_o$ 是共享的语言模型头。

### 4.2 为什么几乎免费？

因为并行主干已经捕获了大范围上下文，顺序模块**不需要在每个位置都是完整 Transformer**，只需消费「前一个预测 token」做局部修正。实测修正模块给整体延迟只带来 **0.6%–1.3%** 的增量，却基本消灭了 suffix decay：

- 继承 DFlash「第一个位置准确率高」的优势（并行主干强）；
- 同时获得 EAGLE-3「后部位置不衰减」的优势（顺序模块注入块内依赖）。

论文中有一个漂亮的对照实验：**2 层 DSpark 在所有任务上打败 5 层 DFlash**——加一个轻量修正模块的效果，比把并行模型堆厚 2.5 倍还好。

---

## 5. DSpark 核心二：置信度调度验证

草稿质量再高，也总会有低置信度后缀。与其固定验证整块 $\gamma$，不如**动态决定验证多长**。

### 5.1 置信度头（Confidence Head）

给每个草稿 token 一个置信度分数 $c_t$，估计「在前缀全部被接受的条件下，该 token 在验证中存活的概率」：

$$
c_t \approx \mathbb{P}\bigl(\text{token } t \text{ 通过验证} \mid \tilde{x}_{<t} \text{ 全部被接受}, x_{1:n}\bigr)
$$

置信度头与顺序修正模块共享输入、并行输出，训练目标为二分类式损失（对每个位置预测「存活/死亡」），损失函数取交叉熵：

$$
\mathcal{L}_{\mathrm{conf}} = -\sum_{t=1}^{\gamma} \Bigl[ y_t \log c_t + (1 - y_t) \log(1 - c_t) \Bigr]
$$

其中 $y_t \in \{0,1\}$ 是「该草稿 token 最终是否被 target 验证接受」的标签（可从训练数据中真实跑一遍投机解码获得）。

### 5.2 硬件感知前缀调度器（Hardware-Aware Prefix Scheduler）

固定验证长度会踩中两个坑：
- **低负载时**：验证太少，浪费并行验证能力；
- **高负载时**：验证太多，把 GPU 吞吐拖垮（这正是生产基线 MTP-1 在高并发下性能悬崖的原因）。

DSpark 把验证长度选择形式化为**全局吞吐最大化问题**。设当前有 $R$ 个活跃请求，请求 $r$ 的每位置置信度为 $c_{r,1}, \ldots, c_{r,\gamma}$，调度验证长度 $\ell_r \in \{0, \ldots, \gamma\}$。系统吞吐（每秒产出 token 数）可写成：

$$
\mathrm{Throughput}(\ell_1, \ldots, \ell_R) = \frac{\sum_{r=1}^{R} \mathbb{E}[\tau_r(\ell_r)]}{T_{\mathrm{cycle}}(\ell_1, \ldots, \ell_R)}
$$

调度器在每轮选择验证长度向量，求解

$$
(\ell_1^{\star}, \ldots, \ell_R^{\star}) = \arg\max_{(\ell_1,\ldots,\ell_R)} \; \mathrm{Throughput}(\ell_1, \ldots, \ell_R)
$$

其中约束由硬件容量曲线 $\mathrm{SPS}(\cdot)$（每 GPU 每秒可处理的 token 数）给出——真实硬件容量是**离散、阶梯式下降**的，而非平滑曲线，因此调度器按「贪心准入路径」评估：沿置信度从高到低逐个位置准入验证，直到边际收益（多验证一个 token 带来的期望接受增量）低于边际成本（占用 GPU 验证能力导致的系统吞吐损失）：

$$
\text{准入位置 } t \iff \underbrace{\Delta \mathbb{E}[\tau]}_{\text{期望多接受 } \approx c_t} > \underbrace{\frac{\partial T_{\mathrm{cycle}}}{\partial \ell} \cdot \frac{\mathrm{Throughput}}{R}}_{\text{系统级边际代价}}
$$

一句话：**忙的时候少验证，闲的时候多验证；置信度低的 token 干脆不验证，把算力留给有把握的请求**。

### 5.3 训练目标（论文 3.3 节）

- 从每条目标序列中**随机采样多个锚点（anchor）位置**，取后续 $\gamma$-token 块作为训练数据；
- **目标模型全程冻结**；草稿模型**共享目标模型的 embedding 层与语言模型头且保持冻结**，只更新中间（主干 + 顺序修正 + 置信度头）参数；
- 联合优化草稿的 next-token 预测损失与置信度头的二分类损失。

---

## 6. 实验效果与工程洞察

| 指标 | 结果 |
|---|---|
| 单用户生成速度（V4-Flash） | **+60%–85%**（匹配聚合吞吐） |
| 单用户生成速度（V4-Pro） | **+57%–78%** |
| 一般负载系统吞吐 | +51% |
| 极端负载吞吐（相对 MTP-1） | 最高 +661%（注：分母塌缩放大，非 6 倍加速） |
| 修正模块延迟开销 | 仅 +0.6%–1.3% |
| 严格 SLA（120 TPS Flash / 50 TPS Pro） | 基线容量严重退化，DSpark 维持稳健吞吐 |
| 跨模型迁移 | Qwen3、Gemma4 上每轮平均接受 token 数全面领先 |

**工程洞察**：
1. **模型越大收益越高**：投机解码的收益来自「大模型验证的边际成本低」——target 越大、drafter 与 target 速度差距越大，收益越明显；小模型（7B 以下）上 drafter 本身的开销可能吃掉大部分收益。
2. **DSpark 在生产上替换了 MTP-1**：V4-preview 发布两周后就上线替换，说明静态多 token drafter（MTP-3/5）在高并发下因验证开销过大而严格劣化吞吐，DSpark 的置信度调度正是为此而生。
3. **不绑定自家模型**：DeepSpec 预设支持 Qwen3、Gemma4——「Draft Better. Verify Smarter.」是通用方法论。
4. **局限**：硬件感知调度器未完整开源（绑定 DeepSeek 自家 serving stack），vLLM/SGLang 整合需额外工程；对极难预测的查询（接受率低），并行主干的前期固定计算仍会浪费。

---

## 7. 总结：三个数学要点的再提炼

1. **无损性**：投机解码的接受/修正机制保证输出分布与自回归一致（$p_{\mathrm{SD}} = p_{\mathrm{AR}}$），加速不损质量；
2. **质量杠杆**：半自回归架构在并行主干上叠一个几乎免费的顺序修正模块，把接受率 $\alpha_t$ 从「随位置衰减」拉回「近常数」，$\mathbb{E}[\tau]$ 显著提升；
3. **效率杠杆**：置信度调度把「验证多长」从静态超参变成逐请求、逐时刻的吞吐优化问题，用置信度 $c_t$ 与硬件容量 $\mathrm{SPS}(\cdot)$ 精确求解，避免把算力浪费在注定被拒的后缀上。

**Draft Better. Verify Smarter.** —— 这就是 DSpark 的全部哲学。

---

*本文基于 DSpark 论文（arXiv:2607.05147）摘要、方法与多篇深度解析整理推导；公式均按 LaTeX 规范书写，KaTeX 渲染。*
