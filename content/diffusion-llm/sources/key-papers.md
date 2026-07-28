---
title: "Diffusion LLM 关键论文摘要集"
category: null
tags:
  - "papers"
  - "survey"
  - "references"
published: true
excerpt: "Diffusion LLM 领域核心论文的速览摘要：D3PM、Diffusion-LM、SSD-LM、MDLM，每题一页，含问题、方法、结果、要点。"
---
# Diffusion LLM 关键论文摘要集

> 本页汇总 Diffusion LLM 领域的核心论文信息，供快速查阅与交叉引用。持续更新。

---

## 1. D3PM (2021)

| 项目 | 内容 |
|------|------|
| **标题** | Structured Denoising Diffusion Models in Discrete State-Spaces |
| **作者** | Jacob Austin, Daniel D. Johnson, Jonathan Ho, Daniel Tarlow, Rianne van den Berg |
| **发表** | NeurIPS 2021 |
| **链接** | [arXiv:2107.03006](https://arxiv.org/abs/2107.03006) |
| **问题** | 扩散模型在连续域（图像、音频）表现惊艳，但尚无通用框架处理离散数据（文本、整数序列） |
| **方法** | 提出 D3PM，用转移矩阵 Q_t 在离散状态空间定义前向扩散，支持均匀、吸收态、量化高斯三种转移矩阵 |
| **结果** | 字符级文本生成达到当时 SOTA；CIFAR-10 图像生成的对数似然超越连续 DDPM |
| **要点** | 离散扩散的奠基之作；证明**转移矩阵设计至关重要**；吸收态为后续 MDLM 奠定基础 |

---

## 2. Diffusion-LM (2022)

| 项目 | 内容 |
|------|------|
| **标题** | Diffusion-LM Improves Controllable Text Generation |
| **作者** | Xiang Lisa Li, John Thickstun, Ishaan Gulrajani, Percy Liang, Tatsunori B. Hashimoto |
| **发表** | NAACL 2022 / arXiv:2205.14217 |
| **链接** | [arXiv:2205.14217](https://arxiv.org/abs/2205.14217) |
| **问题** | 非训练状态下的细粒度可控文本生成是开放难题——AR 模型难以做梯度引导控制 |
| **方法** | 在连续词向量空间运行高斯扩散，去噪后通过 Rounding 层映射回 token；利用连续隐变量的梯度引导实现控制 |
| **结果** | 在 6 个细粒度控制任务上大幅超越此前 SOTA（情感、句法、时态、内容约束等） |
| **要点** | 首个实用扩散语言模型；**可控性是核心亮点**；连续空间+Round 的范式后来被 SSD-LM 改进 |

---

## 3. SSD-LM (2023)

| 项目 | 内容 |
|------|------|
| **标题** | SSD-LM: Semi-autoregressive Simplex-based Diffusion Language Model for Text Generation and Modular Control |
| **作者** | Xiaochuang Han, Sachin Kumar, Yulia Tsvetkov |
| **发表** | ACL 2023 (Long) |
| **链接** | [arXiv:2210.17432](https://arxiv.org/abs/2210.17432) |
| **问题** | Diffusion-LM 生成质量未达 AR 模型；Round 层有误差；推理效率低 |
| **方法** | 在自然词汇空间（simplex）做扩散（无需学习嵌入）；半自回归分块生成（块内双向、块间自回归）；支持即插即用的分类器控制 |
| **结果** | 在非受限文本生成质量上**匹敌甚至超越 GPT-2**；可控生成上也优于基线；模块化控制额外加分 |
| **要点** | 首次让扩散语言模型在**自由生成质量**上匹敌 AR 模型；Simplex 方法规避了 Rounding 误差 |

---

## 4. MDLM (NeurIPS 2024)

| 项目 | 内容 |
|------|------|
| **标题** | Simple and Effective Masked Diffusion Language Models |
| **作者** | Subham Sekhar Sahoo, Marianne Arriola, Yair Schiff, Aaron Gokaslan, Edgar Marroquin, Justin T. Chiu, Alexander M. Rush, Volodymyr Kuleshov |
| **发表** | NeurIPS 2024 |
| **链接** | [arXiv:2406.07524](https://arxiv.org/abs/2406.07524) |
| **代码** | [GitHub: kuleshov-group/mdlm](https://github.com/kuleshov-group/mdlm) |
| **问题** | 此前扩散语言模型与 AR 模型存在显著性能差距，被认为「不适合语言建模」 |
| **方法** | 简单掩码离散扩散 + 现代工程实践 + Rao-Blackwellized 目标函数（等价于加权 MLM 损失的混合） |
| **结果** | 扩散模型在语言建模上的**新 SOTA**，逼近 AR 模型困惑度；支持灵活的半自回归生成 |
| **要点** | 证明了**掩码扩散此前被低估**；训练目标简洁优雅；打开了扩散 LLM 实用化的可能性 |

---

## 5. 其他值得关注的工作（待补充）

- **Bit Diffusion** (Chen et al., 2022) — 把文本视为比特序列做扩散
- **DiffuSeq** (Gong et al., 2023) — 扩散模型用于 Seq2Seq
- **GENIE** (Lin et al., 2024) — 文本到文本的扩散模型
- **Block Diffusion** — 插值自回归与扩散的分块模型

## 来源

- 各论文原始 arXiv 链接如上
- [MDLM 项目主页](https://s-sahoo.com/mdlm/)
- [kuleshov-group/mdlm GitHub](https://github.com/kuleshov-group/mdlm)

## 相关

- [[01-overview/what-is-diffusion-llm]]
- [[02-models/diffusion-lm]]
- [[02-models/discrete-diffusion]]
- [[02-models/masked-and-ar]]

## 待补充

- [ ] 更新更多 2025 年工作的速览摘要
- [ ] 添加论文引用格式（BibTeX）
- [ ] 各论文链接到它们对应的详细文章页

