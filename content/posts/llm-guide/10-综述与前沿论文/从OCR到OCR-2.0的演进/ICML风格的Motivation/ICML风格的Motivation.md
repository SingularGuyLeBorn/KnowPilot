---
title: "ICML风格的Motivation"
date: 2026-05-11
tags: []
---

### **1. Motivation: 将OCR评估指标从确定性分数提升为可信赖的统计估计量**

#### **1.1 传统评估指标的统计学盲点**

在机器学习中, 一个鲁棒的评估指标不仅应提供一个点估计值 (point estimate), 更应具备进行统计推断的能力, 例如计算置信区间和进行假设检验. 当前OCR领域广泛使用的字符准确率 (CA) 等指标, 往往被当作一个确定性的、无方差的黄金标准来使用. 这种做法忽视了评估过程中的采样不确定性, 使得比较不同系统性能时缺乏统计学上的严谨性.

我们提出的新指标, **语义还原度** (SRD), 旨在更好地捕捉语义信息. 但更重要的是, 我们主张将其视为一个**统计估计量** (statistical estimator), 并为其构建一套完整的统计推断框架. 这将使我们能够量化其估计方差, 并在比较模型 A 和模型 B 的 SRD 得分时, 能够回答“模型 A 的提升是否在统计上显著?”这一关键问题.

#### **1.2 SRD 估计量及其方差的理论分析**

给定一个包含 $M$ 个样本的测试集 $\{(S^{(k)}, G^{(k)})\}_{k=1}^M$, SRD 的样本估计量 $\widehat{\text{SRD}}$ 自然地定义为样本均值:

$\widehat{\text{SRD}} = \frac{1}{M}\sum_{k=1}^M \text{SRD}\left(S^{(k)},G^{(k)}\right)
\quad(1)$

由于 SRD 是一个关于底层上下文嵌入 $\phi(\cdot)$ 和权重 $w_i$ 的复杂非线性函数, 直接推导其方差的闭式解是极其困难的. 尽管如此, 我们可以借助 **Delta 方法** (Delta method) 对其方差进行理论近似. 若将 SRD 视为嵌入向量均值 $\mu$ 和协方差 $\Sigma$ 的一个光滑函数 $f(\mu, \Sigma)$, 那么其方差可以近似为:

$\widehat{\text{Var}}\left(\widehat{\text{SRD}}\right) \approx \nabla f(\mu, \Sigma)^\top \text{Cov}(\mu, \Sigma) \nabla f(\mu, \Sigma)
\quad(2)$

这一分析虽然在实践中计算复杂, 但它为我们理解 SRD 估计量的稳定性以及不同权重设计 ($w_i$ 的来源) 如何影响其方差提供了理论洞见.

#### **1.3 基于 Bootstrap 的稳健统计推断**

在实践层面, 我们推荐使用**Bootstrap** 这一非参数方法来估计 $\widehat{\text{SRD}}$ 的置信区间并进行模型间的假设检验. 具体而言, 通过对测试集进行 $B$ 次有放回的重采样, 我们可以得到 $B$ 个自助样本集, 并计算出 $B$ 个相应的 $\widehat{\text{SRD}}_b$ 值. 这个经验分布 $\{ \widehat{\text{SRD}}_b \}_{b=1}^B$ 可以稳健地估计出原始估计量的方差和置信区间.

当比较两个系统 (系统 A vs. 系统 B) 时, **配对 Bootstrap** (paired bootstrap) 是一个尤为强大的工具. 通过在每次重采样时对两个系统在*相同样本*上的得分差异进行采样, 我们可以构建一个关于 SRD 差异的经验分布, 从而直接计算出 p-value, 以判断一个系统的优势是否具有统计显著性.

#### **1.4 Conclusion**

在 ICML 的视角下, 提出一个新指标是远远不够的. 我们必须将其建立在坚实的统计基础之上. 本文不仅提出了 SRD, 更重要的是倡导将其视为一个可进行统计推断的估计量, 并提供了一套基于 Delta 方法的理论分析和基于 Bootstrap 的实用推断流程. 这将推动 OCR 评估进入一个更严谨、更可信赖的阶段.

---

#### **English Version**

### **1. Motivation: Elevating OCR Evaluation Metrics from Deterministic Scores to Reliable Statistical Estimators**

#### **1.1 The Statistical Blind Spot of Traditional Metrics**

In machine learning, a robust evaluation metric should not only provide a point estimate but also enable statistical inference, such as the computation of confidence intervals and the execution of hypothesis tests. Metrics widely used in the OCR field, such as Character Accuracy (CA), are often treated as deterministic, variance-free gold standards. This practice overlooks the sampling uncertainty inherent in the evaluation process, leading to a lack of statistical rigor when comparing the performance of different systems.

While our proposed metric, the **Semantic Restoration Degree** (SRD), aims to better capture semantic information, we argue, more importantly, that it must be treated as a **statistical estimator**. We advocate for establishing a complete statistical inference framework around it. This will allow us to quantify its estimation variance and, when comparing the SRD scores of Model A and Model B, to answer the critical question: "Is the improvement of Model A statistically significant?"

#### **1.2 Theoretical Analysis of the SRD Estimator and its Variance**

Given a test set of $M$ samples $\{(S^{(k)}, G^{(k)})\}_{k=1}^M$, the sample estimator $\widehat{\text{SRD}}$ is naturally defined as the sample mean:

$\widehat{\text{SRD}} = \frac{1}{M}\sum_{k=1}^M \text{SRD}\left(S^{(k)},G^{(k)}\right)
\quad(1)$

As SRD is a complex nonlinear function of the underlying contextual embeddings $\phi(\cdot)$ and weights $w_i$, deriving a closed-form solution for its variance is intractable. Nevertheless, we can theoretically approximate its variance using the **Delta method**. By viewing SRD as a smooth function $f(\mu, \Sigma)$ of the embedding mean vector $\mu$ and covariance matrix $\Sigma$, its variance can be approximated as:

$\widehat{\text{Var}}\left(\widehat{\text{SRD}}\right) \approx \nabla f(\mu, \Sigma)^\top \text{Cov}(\mu, \Sigma) \nabla f(\mu, \Sigma)
\quad(2)$

While computationally intensive in practice, this analysis provides theoretical insight into the stability of the SRD estimator and how different weight designs (i.e., the sources for $w_i$) can affect its variance.

#### **1.3 Robust Statistical Inference via the Bootstrap Method**

On a practical level, we recommend the use of the **Bootstrap method**, a non-parametric technique, to estimate the confidence intervals of $\widehat{\text{SRD}}$ and to perform hypothesis testing between models. Specifically, by resampling the test set with replacement for $B$ times, we can obtain $B$ bootstrap samples and compute $B$ corresponding values, $\widehat{\text{SRD}}_b$. This empirical distribution $\{ \widehat{\text{SRD}}_b \}_{b=1}^B$ provides a robust estimate of the variance and confidence intervals of the original estimator.

When comparing two systems (System A vs. System B), the **paired bootstrap** is a particularly powerful tool. By sampling the differences in scores between the two systems on the *same instances* at each resampling iteration, we can construct an empirical distribution of the SRD difference. This directly allows for the calculation of a p-value to determine if the superiority of one system is statistically significant.

#### **1.4 Conclusion**

From an ICML perspective, proposing a new metric is insufficient. We must ground it in a solid statistical foundation. This paper not only introduces SRD but, more critically, advocates for its treatment as an estimator amenable to statistical inference. We provide both a theoretical analysis via the Delta method and a practical inference pipeline based on the Bootstrap method. This will advance OCR evaluation into a more rigorous and trustworthy era.