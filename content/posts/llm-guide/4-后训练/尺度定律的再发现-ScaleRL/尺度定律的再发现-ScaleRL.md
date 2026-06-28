---
title: "4 尺度定律的再发现 ScaleRL"
date: 2026-05-11
tags: []
---

在 DeepSeek-R1 引爆了关于 RL 训练算力 (Training Compute) 的讨论之后,Meta 终于公布了他们的重磅研究. 他们消耗了超过 **400,000 个 H100/GB200 GPU 小时**,只为了回答一个核心的数学问题: **后训练阶段 (Post-Training) 的 RL 是否存在像预训练那样精确的 Scaling Laws？**

这篇论文的价值不在于提出了某个单一的新算法,而在于它建立了一套**预测性框架**,并提出了 **ScaleRL**——一个在 100k GPU Hours 级别依然稳定、且性能可预测的“最优解”.

![](https://arxiv.org/html/2510.13786v1/extracted/2510.13786v1/figures/main_pass_rate.png)

图 1: ScaleRL 在 8B Dense 模型和 17B MoE (Scout) 模型上的缩放曲线. 这里的关键在于**可预测性**: 利用早期数据 (虚线) 拟合的 Sigmoid 曲线,完美预测了 100k GPU Hours 后的最终性能 (实线).

## 1. RL 算力的热力学方程: Sigmoid Scaling Law

预训练的 Loss 通常服从 $L(C) \propto C^{-\alpha}$ 的无界幂律 (Power Law). 但 Meta 敏锐地指出,在 RL 中,我们关注的指标是 Pass Rate (通过率) $R_C$, 其上限受限于任务的贝叶斯误差界 (通常是 1.0). 因此,无界的幂律在数学上是不完备的.

Meta 提出了如下的 **Sigmoid 算力-收益方程**:

$\mathcal{R}(C) = R_0 + \frac{A - R_0}{1 + \left( \frac{C_{\text{mid}}}{C} \right)^B}$

其中 $C$ 是训练算力. 这个公式定义了 RL 扩展的三个物理量,这是理解全文的基石: 

1. $A$** (Asymptotic Performance)** : **渐近性能**. 当算力 $C \to \infty$ 时,模型能达到的极限奖励. 这是算法**上限**的体现.2. $B$** (Compute Efficiency)** : **缩放指数**. 决定了曲线变陡的速度. $B$ 越大,模型越快达到性能极限. 绝大多数 "Tricks" 只是在优化 $B$,而不改变 $A$.3. $C_{\text{mid}}$: 达到总收益一半所需的算力中点.

![](https://arxiv.org/html/2510.13786v1/extracted/2510.13786v1/figures/sigmoid_schematic.png)

图 2: Sigmoid 缩放定律的几何解释. $A$ 决定了天花板,$B$ 决定了爬升的斜率,$C_{\text{mid}}$ 决定了转折点.

**数学推论**:
在低算力区间 ($C \ll C_{\text{mid}}$),该公式退化为幂律形式. 这解释了为什么早期研究误以为 RL 也是幂律缩放. 但真正的战争发生在 $C \gg C_{\text{mid}}$ 的饱和区,这里区分了真正的 SOTA 和伪 SOTA.

---

## 2. 核心架构: PipelineRL 与异步流式更新

为了最大化吞吐量并维持数学上的无偏性,ScaleRL 摒弃了同步 PPO,采用了 **PipelineRL**.

### 2.1 异步更新的滞后性问题

- **生成器 (Generators)** : 持续采样,策略为 $\pi_{\text{old}}$.

- **训练器 (Trainers)** : 计算梯度,策略为 $\pi_{\text{new}}$.

定义 $K$ 为 Off-policyness (异策略度),即生成器落后于训练器的步数.
Meta 的实验 (Figure 4) 表明,$K=8$** 是数学上的甜蜜点 (Sweet Spot)** .

- $K$** 过小**: 接近 On-policy,生成器经常空转等待参数同步,计算效率 ($B$) 低.- $K$** 过大**: 重要性采样比率 $\rho_t$ 方差爆炸,导致梯度有偏,甚至训练崩溃.

![](https://arxiv.org/html/2510.13786v1/extracted/2510.13786v1/figures/pipeline_vs_ppo.png)

图 3: PipelineRL (绿色) 相比标准 PPO-off-policy (蓝色/橙色) 具有更高的计算效率 ($B$ 值更大),意味着它能更快地达到性能上限.

---

## 3. 损失函数之争: CISPO 的胜利

这是本文最具争议但也最坚实的结论. Meta 在极限算力下对比了 DAPO、GSPO 和 CISPO.

### 3.1 DAPO 的非对称裁剪 vs CISPO 的截断 IS

- **DAPO**: 引入非对称裁剪 $\text{clip}(\rho, 1-\epsilon, 1+\epsilon_{\text{high}})$. Meta 发现 DAPO 对超参数 $\epsilon_{\text{high}}$ **极度敏感**. 参数稍有偏差,渐近性能 $A$ 就会大幅下降.

- **GSPO**: 序列级重要性采样. 虽然解决了 Token 级方差,但在训练中期容易出现不稳定性.

- **CISPO (ScaleRL 的选择)** : 回归统计学本源——**截断重要性采样 (Truncated Importance Sampling)** .

**ScaleRL 的目标函数 (CISPO Kernel)** :

$\mathcal{J}(\theta) = \mathbb{E}_{\tau \sim \pi_{\text{old}}} \left[ \sum_{t=1}^T \text{sg}\left( \min(\rho_t, \epsilon_{\max}) \right) \hat{A}_t \log \pi_\theta(a_t | s_t, a_{<t}) \right]$

**结论**: CISPO 在极限算力下表现出最高的渐近性能 $A$ (0.61 vs DAPO 的 0.52) 和最强的鲁棒性. 它证明了**控制方差比引入复杂的 Bias (如 DAPO) 更重要**.

![](https://arxiv.org/html/2510.13786v1/extracted/2510.13786v1/figures/loss_comparison.png)

图 4: (a) CISPO (蓝色) 在渐近性能上显著优于 DAPO (绿色) 和 GSPO (橙色). (b) **FP32 Logits 的威力**: 仅仅将 Logits 计算从 BF16 转为 FP32,性能就从 0.52 飙升至 0.61.

### 3.2 数值精度的幽灵: FP32 Logits
这是一个极易被忽视的底层细节.
重要性比率 
$\rho_t = \exp(\text{logit}_\theta - \text{logit}_{\text{old}})$
. 在 BF16 精度下,微小的 Logit 误差经过指数放大和连乘,会导致 $\rho_t$ 严重失真.
Meta 实验表明: **必须在 FP32 精度下计算 Logits**. 这一改动带来的收益,甚至超过了更换算法本身.

---

## 4. 细节决定成败: ScaleRL 的完整配方

Meta 通过 Leave-One-Out (LOO) 实验,逐一验证了以下组件的必要性.

### 4.1 聚合与归一化 (Aggregation & Normalization)

- **Loss Aggregation**: **Prompt-level Average** (对每个 Prompt 的所有生成取平均) 优于 Token-level 或 Sample-level. 这保证了长短序列对梯度的贡献权重一致.

- **Advantage Normalization**: **Batch-level Normalization** (对整个 Batch 的优势归一化) 优于 Prompt-level. 因为 Batch 级的统计量更稳定,符合大数定律.

### 4.2 动态数据课程 (Data Curriculum)

为了解决样本效率问题,ScaleRL 引入了两大过滤器: 

1. **Zero-Variance Filtering (零方差过滤)** :
在一个 Batch 中,如果某个 Prompt 的所有 $G$ 个采样结果奖励完全相同 (例如全对或全错),则 $A_i = r_i - \bar{r} = 0$.
这些样本梯度为 0,只会占用显存. **直接剔除**它们.

2. **No-Positive-Resampling (去正例重采样)** :
如果一个 Prompt 的历史通过率 (Pass Rate) 超过 **0.9**,说明模型已经“学会”了. 继续训练会导致过拟合. ScaleRL 会**永久移除**这些 Prompt.

![](https://arxiv.org/html/2510.13786v1/extracted/2510.13786v1/figures/filtering.png)

图 5: (a) 剔除零方差样本显著提升了计算效率. (b) 移除已掌握的简单样本 (Pass Rate > 0.9) 进一步推高了渐近性能 $A$.

### 4.3 长度控制: 强制截断 (Interruption)

为了防止 Reward Hacking (模型输出长篇废话来骗取奖励),简单的长度惩罚 (Length Penalty) $R - \lambda L$ 并不鲁棒.
ScaleRL 采用**强制截断**: 一旦模型开始胡言乱语或超时,直接插入 `</think>` 强制结束并进行判分. 这种“硬约束”在数学上切断了低质量的长尾分布.

---

## 5. 验证: ScaleRL 的通用性

Meta 不仅在 8B 模型上验证了 ScaleRL,还将实验扩展到了更极端的场景,证明了 Sigmoid Scaling Law 的普适性.

### 5.1 跨越维度的稳定性

- **MoE 模型**: 在 **Llama-4 Scout (17B parameters)** 上,ScaleRL 依然完美贴合预测曲线.

- **长上下文**: 将推理长度从 16k 扩展到 **32k Tokens**,虽然初期学习变慢 (Efficiency $B$ 下降),但最终的渐近性能 $A$ 更高. 这验证了 "Longer Context = Higher Ceiling".

- **多任务学习**: 在 **Math + Code** 联合训练中,ScaleRL 展现出了任务间的正迁移,依然遵循预测曲线.

![](https://arxiv.org/html/2510.13786v1/extracted/2510.13786v1/figures/multitask_scaling.png)

图 6: ScaleRL 在 Math 和 Code 联合训练任务中,依然表现出完美的可预测性.

---

## 6. 总结: ScaleRL 的终极形态

将上述所有数学洞见结合,我们得到了 **ScaleRL** 的完整数学定义.

对于输入 $x$,旧策略生成 $G$ 个样本 $\{y_i\}$.
计算组内优势 $\hat{A}_i = r_i - \text{mean}(r)$,并进行 **Batch-level 标准化** 得到 $\hat{A}^{\text{norm}}_i$.

$\mathcal{J}_{\text{ScaleRL}}(\theta) = \mathbb{E}_{x \sim \mathcal{D}} \left[ \frac{1}{|\mathcal{B}_{\text{valid}}|} \sum_{x \in \mathcal{B}_{\text{valid}}} \frac{1}{G} \sum_{i=1}^G \sum_{t=1}^{|y_i|} \text{sg}\left( \min(\rho_{i,t}, \epsilon) \right) \hat{A}^{\text{norm}}_i \log \pi_\theta(y_{i,t} | x, y_{i,<t}) \right]$

**关键配置清单**:

- **Algorithm**: PipelineRL (K=8 async steps)

- **Loss**: CISPO (Truncated IS)

- **Precision**: **FP32 Logits** (Crucial!)

- **Filtering**: Zero-Variance Drop + No-Positive Resampling (PR > 0.9)

- **Control**: Hard Interruption (Explicit `</think>`)

- **Aggregation**: Prompt-level Average

Meta 的这项工作用 400k GPU Hours 告诉我们: **RL 没有魔法,只有精度、方差控制和严谨的统计学.** 只要配方正确,RL 的 Scaling 就像预训练一样,是精确、可预测且枯燥的科学.