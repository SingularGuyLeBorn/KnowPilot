---
title: "Credal Transformer: 从 Softmax 的确定性暴政到证据理论的不确定性建模"
date: 2026-05-16
tags: [Credal Transformer, 幻觉, 不确定性, 证据理论, 狄利克雷分布, Softmax, 架构创新]
---

# Credal Transformer: 从 Softmax 的确定性暴政到证据理论的不确定性建模

> 本文介绍 NeurIPS 2025 论文 Credal Transformer 的核心思想——从数学基因层面重新审视 Transformer 的幻觉问题，分析 Softmax 的"确定性暴政"如何系统性湮灭模型内在的不确定性，以及证据理论和狄利克雷分布如何为不确定性建模提供新的架构基础. 

---

## 1. 问题的根源: Softmax 的确定性暴政

### 1.1 Softmax 的信息湮灭机制

现有 Transformer 架构的激活函数 Softmax，其数学本质是一个从 $\mathbb{R}^L$ 到概率单纯形 $\Delta^{L-1}$ 的映射: 

将上述约束转化为数学表达: 
$$
a_{ij} = \frac{\exp(s_{ij})}{\sum_k \exp(s_{ik})} \tag{1} \tag{1}
$$
此式给出了形式化的数学定义，建立了输入与输出之间的定量关系. 

无论输入的 logits $s_i$ 是多么平坦、多么接近均匀分布(代表着极度的不确定性)，Softmax 都会将其归一化，强行在所有选项上分配完 100% 的信念. 这个过程本身就是**信息的湮灭**——模型内在的犹豫、困惑、知识的边界感，在 Softmax 穿过的瞬间被彻底抹除. 

每一层、每一个注意力头都在重复这个过程. 这就像一场席卷整个网络的遗忘风暴，最终导致输出端那个看似自信的 token，实际上建立在一片被夷平了的不确定性废墟之上. 这就是 **Artificial Certainty**——一个架构性的原罪. 

### 1.2 幻觉的结构性成因

传统上，幻觉(Hallucination)被归因于训练数据不足、对齐偏差或解码策略问题. 但 Credal Transformer 的洞察更为深层: **幻觉不是训练不充分的结果，而是架构设计的选择**. 

当模型面对知识边界之外的问题时，其内部表征本应表现出高度的不确定性(平坦的 logit 分布). 但 Softmax 将这种不确定性强制转换为"虚假的自信"——某个 token 的概率被放大到 0.8 甚至 0.9，而模型实际上对这个答案毫无把握. 用户看到的是一个斩钉截铁的陈述，而模型内部是一片混乱. 

---

## 2. Credal Transformer 的核心设计

### 2.1 核心论点: 不确定性是信息，而非噪声

Credal Transformer 拒绝接受"不确定性必须被消除"的传统假设. 其核心论点是: 

> **不确定性不是需要被消除的噪声，而是一种必须被保留、被传递、被计算的关键信息. **

为此，Credal Transformer 引入了**证据理论(Dempster-Shafer Theory)** 和**狄利克雷分布(Dirichlet Distribution)** ，将模型的输出从"单一概率分布"扩展为"概率分布上的分布". 

### 2.2 狄利克雷分布: 分类分布上的不确定性

狄利克雷分布是分类分布的共轭先验. 在 Credal Transformer 中，模型不再直接输出 logits，而是输出狄利克雷分布的参数 $\boldsymbol{\alpha} = (\alpha_1, \dots, \alpha_L)$: 

基于上述分析，建立如下数学关系: 
$$
\mathbf{p} \sim \text{Dir}(\boldsymbol{\alpha}), \quad \mathbf{p} \in \Delta^{L-1} \tag{2} \tag{2}
$$

其中 $\alpha_i > 0$ 可以理解为对第 $i$ 个类别的"证据强度". 狄利克雷分布的均值和方差分别为: 

推导过程如下: 
$$
\mathbb{E}[p_i] = \frac{\alpha_i}{\alpha_0}, \quad \text{Var}[p_i] = \frac{\alpha_i (\alpha_0 - \alpha_i)}{\alpha_0^2 (\alpha_0 + 1)} \tag{3} \tag{3}
$$

其中 $\alpha_0 = \sum_i \alpha_i$ 为总证据量. **关键洞察**: 

- 当某个 $\alpha_i \gg \alpha_j$($j \neq i$)时，狄利克雷分布集中在第 $i$ 个类别附近——模型对该类别有高度确信
- 当所有 $\alpha_i$ 相近且总证据量 $\alpha_0$ 很小时，狄利克雷分布覆盖整个单纯形——模型表现出高度不确定性
- 当所有 $\alpha_i$ 相近但 $\alpha_0$ 很大时，狄利克雷分布集中在单纯形中心——模型确信"所有选项概率相近"

### 2.3 从点估计到集合估计

传统 Transformer 输出的是一个点估计(概率向量 $\mathbf{p}$)，而 Credal Transformer 输出的是一个**概率集合(Credal Set)** ——由狄利克雷分布支撑的所有可能概率分布的集合. 

这意味着: 
- 当模型不确定时，它不再"猜测"一个最可能的 token，而是明确地表达"我在这些选项之间不确定"
- 这种不确定性可以被上层模块(如推理链、工具调用、人类审核)利用，做出更保守或更积极的决策
- 在多轮对话中，不确定性可以累积和传播，避免早期错误被后续步骤固化

---

## 3. 架构实现与训练

### 3.1 替换 Softmax 为狄利克雷头

Credal Transformer 将传统的 LM Head(线性层 + Softmax)替换为**狄利克雷头(Dirichlet Head)** : 

1. 最后一层隐藏状态 $h$ 经过线性层映射到 $2L$ 维输出($L$ 为词汇表大小)
2. 前 $L$ 维通过 softplus 激活得到 $\alpha_i > 0$
3. 后 $L$ 维可选地输出"无知度"参数，表示模型对整体分布的不确定程度

### 3.2 损失函数设计

训练目标从最大化对数似然(交叉熵)转变为**证据学习(Evidential Learning)** : 

$$
\mathcal{L}(\boldsymbol{\alpha}, y) = \log \frac{\alpha_0}{\alpha_y} + \psi(\alpha_y + 1) - \psi(\alpha_0 + 1) \tag{4} \tag{4}
$$

其中 $\psi$ 为 digamma 函数. 该损失同时优化预测的准确性(第一项)和不确定性估计的校准性(后两项). 

### 3.3 不确定性引导的解码

在推理阶段，Credal Transformer 支持多种不确定性敏感的解码策略: 

| 策略 | 机制 | 适用场景 |
|:-----|:-----|:--------|
| **保守解码** | 当总证据量 $\alpha_0 < \tau$ 时，拒绝回答或请求澄清 | 高风险领域(医疗、法律) |
| **探索解码** | 从狄利克雷分布采样多个概率向量，生成多个候选答案 | 创意生成、头脑风暴 |
| **工具触发** | 当不确定性超过阈值时，自动触发搜索/计算工具 | Agent 任务、知识密集型查询 |

---

## 4. 实验结果与意义

### 4.1 幻觉率显著降低

在多个幻觉检测基准上，Credal Transformer 将幻觉率降低了 30-50%. 更重要的是，它提供了一种**可解释的幻觉预警机制**——模型在生成高不确定性回答时会明确标注，让用户可以自行决定是否信任. 

### 4.2 校准性提升

传统 Transformer 的概率校准性极差: 模型说"90% 确信"时，实际正确率可能只有 60%. Credal Transformer 的狄利克雷输出经过校准后，概率估计与实际准确率高度一致(ECE 从 0.15 降至 0.03). 

### 4.3 架构级反思的意义

Credal Transformer 的价值不仅在于一个具体的技术方案，更在于它提出了一种**架构级的设计哲学**: 

- 当前 AI 的"过度自信"不是可修复的 bug，而是架构选择的必然结果
- 真正的可信 AI 需要在最底层(概率输出层)保留和表达不确定性
- 不确定性不应被消除，而应被计算、传递和利用

---

## 5. 挑战与未来方向

### 5.1 计算开销

狄利克雷分布的采样和期望计算比 Softmax 更昂贵. 虽然可以通过解析近似加速，但在超大规模模型(100B+)上的效率仍需验证. 

### 5.2 生态兼容性

现有推理框架(vLLM、TensorRT-LLM)高度优化了 Softmax 的计算路径. 引入狄利克雷头需要重构这些优化，工程成本较高. 

### 5.3 人类交互设计

当模型表达"我不确定"时，用户如何解读和应对？这需要新的人机交互范式——从"AI 给答案"转变为"AI 给答案 + 置信度 + 替代选项". 

---

## 6. 参考文献

1. **Credal Transformer: Endowing Transformers with Uncertainty Awareness via Evidential Deep Learning**
   - NeurIPS 2025. OpenReview: https://openreview.net/forum?id=XTM1BKeZa8

2. **Evidential Deep Learning to Quantify Classification Uncertainty**
   - Sensoy et al., NeurIPS 2018. (证据学习理论基础)

3. **A Mathematical Theory of Evidence**
   - Shafer, 1976. (Dempster-Shafer 证据理论经典著作)

> 参考来源: [如何评价 NeurIPS 2025 论文 Credal Transformer 对幻觉问题的解决思路？](https://www.zhihu.com/question/1958640342082515039/answer/1958644955556840445)
