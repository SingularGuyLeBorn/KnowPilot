---
title: "01 · Qwen2.5-Math 技术报告精译"
---

# Qwen2.5-Math 技术报告精译

>  **[返回 14.2-Qwen 家族总览](../../14.2-Qwen.md)**


> **原文**: Qwen2.5-Math Technical Report (arXiv:2409.12122)
> **翻译说明**: 以下内容为技术报告全文逐段精译,保留所有公式、表格结构与实验数据.英文术语首次出现时附原文,后续直接使用缩写.

---

## 1. 引言 (Introduction)

过去一年中,我们投入了大量精力研究和提升大语言模型的推理能力,尤其关注其解决算术与数学问题的能力.本报告介绍了一系列数学专用大语言模型:Qwen2.5-Math、Qwen2.5-Math-RM 以及 Qwen2.5-Math-Instruct-1.5B/7B/72B.为帮助读者全面理解 Qwen2.5-Math 背后的技术演进,我们还将对其前代模型 Qwen2-Math 进行详细概述.

![Qwen2.5-Math-72B-Instruct 在 MATH 基准上通过 Chain-of-Thought 推理的 pass@1 性能](images/flagship.png)

> **图 1**: Qwen2.5-Math-72B-Instruct 在 MATH 基准上通过 Chain-of-Thought 推理的 pass@1 性能.

我们在 Qwen2-Math 的基础上,引入了一系列自提升(self-improvement)技术来开发 Qwen2.5-Math 系列模型.自提升技术利用大语言模型自身的监督信号来迭代增强模型能力.具体而言,我们在 Qwen2.5-Math 的训练过程中从三个维度应用自提升:

- **预训练阶段**: 我们使用 Qwen2-Math-Instruct 大规模合成数学问题及其对应解答,以丰富 Qwen2.5-Math 的预训练语料.
- **后训练阶段**: 我们在海量采样数据上训练奖励模型(reward model),并将其应用于监督微调(SFT)中数据的迭代进化.
- 由此训练出的更优数学模型进一步催生了更强大的奖励模型 Qwen2.5-Math-RM,该奖励模型随后在强化学习(reinforcement learning)和推理时的 best-of-N 采样中发挥关键作用.

与前代模型相比,合成数据与评判机制在 Qwen2.5-Math 的提升中扮演了至关重要的角色.

![Qwen2-Math 与 Qwen2.5-Math 的开发流程](images/qwen2.5-math-pipeline.jpeg)

> **图 2**: Qwen2-Math 与 Qwen2.5-Math 的开发流程.

具体而言,Qwen2-Math 与 Qwen2.5-Math 的整体开发流程如图 2 所示:

1. **Qwen2-Math Base 模型训练**: 首先,Qwen2-Math Base 模型在一个名为 **Qwen Math Corpus v1** 的高质量数学预训练数据集上进行训练,该数据集包含约 7000 亿 token.
2. **Qwen2-Math-Instruct 模型训练**: 我们基于 Qwen2-Math-72B 训练了一个数学专用奖励模型 Qwen2-Math-RM,用于通过 Rejection Sampling 构建 SFT 数据;该奖励模型在 SFT 之后的强化学习阶段同样扮演关键角色,我们采用 Group Relative Policy Optimization (GRPO) 进行训练.
3. **Qwen Math Corpus v2 构建**: 利用 Qwen2-Math-72B-Instruct 模型,我们合成了额外的高质量数学预训练数据,构成了 **Qwen Math Corpus v2**,包含超过 1 万亿 token,用于预训练 Qwen2.5-Math 模型.
4. **Qwen2.5-Math 模型训练**: 最后,类似于 Qwen2-Math-Instruct 的训练流程,我们构建了 Qwen2.5-Math-RM 和 Qwen2.5-Math-Instruct 模型.这一阶段的重要区别在于,Qwen2.5-Math-Instruct 的训练同时包含了英中文 Chain-of-Thought (CoT) 推理数据以及 Tool-Integrated Reasoning (TIR) 数据,而 Qwen2-Math-Instruct 仅使用了英文 CoT 数据.

我们在八个英中文数学基准上评估了数学专用模型.值得注意的是,Qwen2.5-Math-7B Base 模型在 GSM8K、MATH 和 GaoKao Math Cloze 上分别取得 91.6、55.4 和 57.6 的分数,超过了 Qwen2-72B 通用模型在同数据集上的 89.5、51.1 和 55.9.此外,Qwen2.5-Math-72B Base 模型在 MATH 基准上创造了新的 SOTA,达到 66.8 分——比 Qwen2-Math-72B 提升了 5.3 分,比 Qwen2-72B 提升了 15.7 分.

对于 Instruct 模型,在 CoT 模式下,Qwen2.5-Math-1.5B-Instruct 在大多数指标上超过了当前所有开源模型,包括参数量高达 70B 的模型.Qwen2.5-Math-7B-Instruct 的性能几乎与 Qwen2-Math-72B-Instruct 持平,表明训练数据与策略的改进在一定程度上可以弥补参数规模的差距.Qwen2.5-Math-72B-Instruct 在英文和中文基准上分别比 Qwen2-Math-72B-Instruct 平均高出 4.4 分和 6.1 分,确立了当前最佳开源数学模型的地位.此外,所有尺寸的模型在中文数学解题能力上均有显著提升.

在我们新引入的 TIR 模式下,性能相比 CoT 进一步跃升.例如,72B 模型在 MATH 基准上接近 90 分,即使 1.5B 模型也达到了约 80 分,这表明 Qwen2.5-Math 已经非常擅长利用 Python 解释器进行精确的数学计算.

---

## 2. Qwen2.5-Math 预训练 (Pre-training)

在数学预训练中,我们的核心关注点是构建一个富含数学内容的高质量数据集.该数据集涵盖多种来源,包括数学相关网页文本、代码片段、百科全书、考试题目,以及由 Qwen2 生成的合成数学数据.组装这一预训练数据集涉及多个关键步骤:数据召回、去重、过滤、数据合成以及数据混合比例的优化.最终构建的精选数据集称为 **Qwen Math Corpus v1**,Qwen2-Math Base 模型以 Qwen2-1.5B/7B/72B 为初始化,在该语料上进行持续预训练.

### 2.1 数据召回与去重

在构建 Qwen Math Corpus v1 之前,我们观察到通用语言模型在数学推理上表现不佳的根源在于预训练阶段数学数据的不足.此前将大语言模型预训练为数学专用模型的努力已经明确证明了从数字数据库中提取大规模数学文本语料的价值.

我们的初始策略是从网页来源(如 Common Crawl)召回数学数据以扩大数据量.具体而言,我们使用高质量数学种子数据和通用文本数据训练一个 FastText 分类器,并通过每轮迭代增加更多数学数据来持续提升分类器性能.为了识别语料池中缺失的数学相关数据,我们利用召回数据的元信息(如 URL)来扩展数学数据检索的数据池.随后,采用 MinHash 等去重技术过滤掉相似的数学文档.

### 2.2 质量过滤与数据合成

在收集到大量数学数据后,我们的重点转向提升数据质量.为此,我们实现了基于语言模型的过滤技术来进一步精选数据集.

具体而言,我们使用 Qwen2-0.5B-Instruct 模型,配合提示工程(prompt engineering)来评估候选数据条目的质量.获得更高分数(即被语言模型判定为更高质量)的数据被优先纳入最终数据集.

除了召回多样化的数学文档并过滤低质量数据外,我们还借鉴了此前合成数学数据的工作经验.我们使用 Qwen2-72B-Instruct 模型大规模合成数学预训练语料.在这一阶段,已收集到的高质量数学数据被用作参考材料.利用 Qwen2-72B-Instruct 模型,我们执行两项任务:

1. 从这些参考材料中提取并精炼现有的数学问答数据;
2. 直接生成新的数学问答对.

### 2.3 数据混合与模型初始化

在最后阶段,我们使用小型数学专用语言模型 Qwen2-Math-1.5B 对数据混合比例进行了消融实验.基于实验结果,我们构建了总计 7000 亿 token 的 Qwen Math Corpus v1.Qwen2-Math-1.5B/7B/72B 的预训练以对应 Qwen2-1.5B/7B/72B Base 模型的中间Checkpoint为初始化,在 4K 上下文长度下对 Qwen Math Corpus v1 进行持续预训练.

### 2.4 从 Qwen2-Math 升级到 Qwen2.5-Math

在 Qwen2-Math Base 模型训练完成后,我们通过三条主要路径将其升级为 Qwen2.5-Math:

1. **合成数据扩充**: 我们使用经过后训练(见第 3 节)的 Qwen2-Math-72B-Instruct 模型合成额外的高质量数学预训练数据.
2. **多轮召回扩充**: 我们在多个召回周期中聚合了更多高质量数学数据,尤其是中文数据,来源包括网页文档、书籍和代码仓库.由此编译出用于 Qwen2.5-Math-1.5B/7B/72B 预训练的 **Qwen Math Corpus v2**,上下文长度保持 4K.相比 Qwen Math Corpus v1,Qwen Math Corpus v2 的总 token 数从 700B 提升至超过 1T.
3. **更强的基座初始化**: 我们不再从 Qwen2 系列初始化,而是使用 Qwen2.5 系列 Base 模型进行参数初始化,因为后者在语言理解、代码生成和文本推理方面表现出更强的能力.Qwen2.5-Math 模型在与 Qwen2-Math 类似的数学预训练设置下,基于 Qwen Math Corpus v2 进行持续预训练.

得益于数据集和基座模型的双重改进,Qwen2.5-Math 模型在数学推理能力上超越了 Qwen2-Math.

---

## 3. Qwen2.5-Math 后训练 (Post-training)

在完成大规模数学预训练后,我们进行后训练以进一步提升 Qwen-Math 的数学逻辑推理能力,特别关注 Chain-of-Thought (CoT) 和 Tool-Integrated Reasoning (TIR).我们的研究聚焦于两个核心挑战:

1. 如何自动生成大量高质量且可靠的 CoT 和 TIR 标注数据;
2. 如何有效利用这些标注数据进行监督微调(Supervised Fine-Tuning)和强化学习(Reinforcement Learning).

### 3.1 监督微调 (Supervised Fine-tuning)

我们的目标是使 Qwen-Math 在两项核心能力上表现出色:一是通过逐步自然语言推理解决数学问题,二是利用外部工具(如 Python 解释器)处理复杂数学或算法推理任务.我们为 Chain-of-Thought (CoT) 和 Tool-integrated Reasoning (TIR) 分别构建了专用数据集,并将两者合并进行联合训练.

所有模型均训练 3 个 epoch,序列长度为 4096 token.对于 72B 模型,批次大小(batch size)为 256,学习率为 $5 \times 10^{-6}$;对于 1.5B 和 7B 模型,批次大小为 128,学习率为 $2 \times 10^{-5}$.训练过程中学习率逐渐衰减至最终值 $7 \times 10^{-7}$.

#### 3.1.1 CoT 数据合成

**问题构建 (Query Construction)**

CoT 数据集包含 58 万条英文和 50 万条中文数学问题,涵盖既有标注数据和合成数据.标注问题来源于 GSM8K、MATH 和 NuminaMath 的训练集等成熟来源.为增强 Qwen2.5-Math 的中文推理能力,我们还从独家 K-12 题库中补充了额外的中文数学问题.合成问题通过 MuggleMath 方法从标注问题演化而来.为保持不同难度级别的问题分布均衡,我们使用难度评分模型对问题集进行有效分类.

**解答构建 (Response Construction)**

我们采用一种迭代方法,利用基于奖励模型和标注答案的拒绝采样(rejection sampling)来逐步提升解答质量.在每次迭代中,当前最优模型为给定问题生成多条推理路径,扩充候选解答池.

- 对于有标注答案的问题,我们从候选池中选择最终答案正确的 top-$k$ 条推理路径.
- 对于没有确定答案的合成问题,我们采用加权多数投票(weighted majority voting)机制来推断最可能正确的推理路径,并从中选择获得最高奖励分数的 top-$k$ 条路径.

在 Qwen2.5-Math 的开发中,我们还使用 Qwen2-Math-Instruct 模型额外进行了一次迭代,以进一步打磨解答质量.最终的 CoT 训练集包含 200 万条英文样本和 50 万条中文样本.

#### 3.1.2 TIR 数据合成

需要认识到,虽然 CoT 提示在提升大语言模型推理能力方面至关重要,但它在实现计算精确度和处理复杂数学或算法问题(如求二次方程的根或计算矩阵特征值)方面面临挑战.为克服这些局限并提升模型在精确计算、符号操作和算法推理方面的熟练度,我们开发了一个融入工具集成推理格式的数据集.这种创新格式使模型能够将 Python 解释器作为推理任务的辅助资源.

**问题构建 (Query Construction)**

TIR 数据集包含 19 万条标注问题和 20.5 万条合成问题.标注问题来源于 GSM8K、MATH、CollegeMath 和 NuminaMath 的训练集等成熟基准.合成问题通过 MuggleMath 和 DotaMath 的技术在 GSM8K 和 MATH 训练集上进行问题演化生成.此外,我们选取了 7.5 万条标注问题,使用 Qwen2-72B 模型翻译成中文,以增强模型的中文推理能力.

**解答构建 (Response Construction)**

对于标注问题,我们采用在线 Rejection Fine-Tuning (RFT) 方法迭代生成与参考答案最终答案一致的工具集成推理路径.在每次 RFT 迭代中,我们使用当前最优模型在不同温度下进行多次核采样(nucleus sampling),对于特别困难的问题增加采样数量.每次迭代后,为增强数据多样性,我们对解答进行去重处理,清洗后的数据集用于下一轮微调.

对于合成问题,我们使用在线 RFT 过程中获得的最优模型生成推理样本,通过多数投票选择最可能正确的推理路径,并将其纳入整体数据集.

### 3.2 奖励模型训练 (Reward Model Training)

为了在 SFT 数据选择和后续强化学习训练阶段提供超越最终答案正确性的监督信号,我们为 Qwen2-Math 和 Qwen2.5-Math 开发了数学专用奖励模型,分别称为 Qwen2-Math-RM 和 Qwen2.5-Math-RM.这些奖励模型旨在通过为推理过程和中间步骤提供更细粒度的反馈来指导整个训练过程,最终促成更稳健的模型改进.

#### 3.2.1 数据合成

在 Qwen2-Math-RM 的开发中,我们使用了 20.6 万条英文数学问题,每个问题搭配从中期版本 Qwen2-Math 采样的 6 条候选解答.对于 Qwen2.5-Math-RM,我们进一步增强了其对中文语言和 TIR 模式的支持,使用更多样化的 36.1 万条英文和 25.7 万条中文数学问题进行训练,每个问题搭配从 Qwen2.5-Math 采样的 6 条解答.

为建立解答之间的偏好信号,我们检查解答的最终答案以判定其正确性.答案正确的解答标记为 positive,答案错误的标记为 negative,由此在解答之间自然形成了排序关系.随后我们过滤掉所有解答全部正确或全部错误的 case.为避免仅保留过于简单的数据,我们用不同中间版本和不同尺寸的模型生成的解答来丰富数据集,确保问题难度的分布更加均衡,并保持正负样本比例均等.

#### 3.2.2 训练策略

奖励模型从监督微调模型初始化.在架构上,我们将原本用于下一 token 预测的语言建模头替换为一个由两个线性层组成的标量值头(scalar-value head).

如前所述,奖励模型训练数据集中的每个 query 搭配 6 条解答,包含 positive 和 negative 候选.如果有 $k$ 条 positive 解答,则剩余的 $6-k$ 条为 negative.遵循前人工作,奖励模型的损失函数定义如下:

$$
\mathcal{L}_{rm}(\theta) = -\frac{1}{k \times (6-k)} E_{(x,y_{pos},y_{neg}) \sim D} \left[ \log \left( \sigma \left( r_{\theta}(x,y_{pos}) - r_{\theta}(x,y_{neg}) \right) \right) \right]
$$

其中 $r_{\theta}(x,y)$ 表示奖励模型的输出,$x$ 代表问题,$y$ 为对应解答.我们不将这些拆分为多个独立 pair 进行逐对计算损失,而是采用 listwise 方法直接在有效 pair 上计算排序损失,这种方法同时提升了训练效率和效果.

### 3.3 强化学习 (Reinforcement Learning)

**Query 选择**

强化学习训练的 query 从奖励模型的训练集中选取.我们使用不同尺寸的 SFT 模型为每个 query 重新采样 8 条解答,通过与标准答案比对将每条解答判定为正确或错误.

在强化学习阶段,我们的首要目标是确保模型对于存在正确解答可能的 query 能够持续产出正确答案.因此,我们只保留其中有 2 至 5 条解答正确的 query:

- 正确解答少于 2 条的 query 被排除,因为这意味着当前数学模型尚不具备从中学习的基础能力;
- 正确解答超过 5 条的 query 也被省略,因为模型在这些 case 上已经展现出足够能力,无需进一步训练.

最终,我们保留了 6.6 万条 query 用于训练.

**Group Relative Policy Optimization (GRPO)**

如 DeepSeekMath 所介绍,GRPO 是一种专为大型语言模型设计的强化学习方法,免除了 PPO 中额外价值函数近似的需求.GRPO 使用一组采样输出的平均奖励作为 baseline 来计算每个输出的优势(advantage).GRPO 的目标函数定义如下:

$$
\mathcal{J}_{GRPO}(\theta) = \mathbb{E}_{[q\sim P(Q),\{o_i\}_{i=1}^G\sim \pi_{\theta_{old}}(O|q)]} \frac{1}{G}\sum_{i=1}^G\frac{1}{|o_i|}\sum_{t=1}^{|o_i|}\{\min[\frac{\pi_{\theta}^{i,t}}{\pi_{\theta_{old}}^{i,t}}\hat{A}_{i,t},\textrm{clip}(\frac{\pi_{\theta}^{i,t}}{\pi_{\theta_{old}}^{i,t}}, 1-\epsilon, 1+\epsilon)\hat{A}_{i,t}]-\beta\mathbb{D}_{KL}[\pi_{\theta}||\pi_{\textrm{ref}}]\}
$$

其中 $\pi^{i,t}=\pi(o_{i,t}|q, o_{i,<t})$,$G$ 为一组中的解答数量.$\pi_{ref}$、$\pi_{\theta}$ 和 $\pi_{old}$ 分别为参考模型、训练模型和采样模型.$q$ 和 $\{o_i\}_{i=1}^G$ 为训练中的问题和生成解答集合.每条解答的优势 $\hat{A}_i$ 通过 $\hat{A}_i=\frac{r_i - \text{mean}(r_i)}{\text{std}(r_i)}$ 计算,随后该序列级优势被应用于解答中的每个 token 作为 $\hat{A}_{i,t}$.

**Reward Shaping**

我们结合基于规则的验证器(rule-based verifier)和奖励模型的反馈来塑造整体奖励信号.基于规则的验证器从每条解答中提取潜在答案并与标准答案进行比对.

给定奖励模型的输出为 $r_m \in \mathbb{R}$,基于规则验证器的稀疏奖励为 $r_v \in \{0, 1\}$,整体奖励计算如下:

$$
r = \sigma(\alpha \cdot r_m) + (r_v - 1)
$$

其中 $\alpha$ 在所有实验中设为 0.5.

这一 shaping 机制确保正确解答相比错误解答始终获得更高的整体奖励.在正确和错误两组内部,解答根据奖励模型的分数进行排序,尤其在困难样本中能有效区分解答质量.

**实现细节**

我们的实验基于开源 RLHF 框架 ChatLearn 实现.基于规则验证器的核心实现与我们的评估代码类似.所有不同参数尺寸的策略模型均使用同一个奖励模型进行训练.我们为每个 query 采样 32 条解答.将一对 query 和解答视为一个 sample,7B 模型每轮(episode)的 sample 数量为 4096,72B 模型为 2048.所有模型均以 512 的全局批次大小(global batch size)进行训练.7B 和 72B 的学习率分别为 $1 \times 10^{-5}$ 和 $5 \times 10^{-6}$.所有训练的 KL 系数为 $1 \times 10^{-3}$.在 TIR 的强化学习中,我们将 Python 执行器提供的所有输出 token 进行掩码(mask).

### 3.4 数据去污 (Decontamination)

数据去污对于确保模型性能评估的无偏性至关重要.遵循前人工作,我们使用 13-gram 匹配排除可能受污染的 training sample.为提高匹配精度,我们执行文本归一化,去除无关的标点符号.为进一步降低假阴性(false negatives),尤其对于常见数学表达式,我们引入额外判据:最长公共子序列(longest common subsequence)的比例必须超过 0.6 才判定为受污染.

对于预训练数据,我们针对 GSM8K 和 MATH 等数据集过滤可能受污染的 sample.对于后训练数据(包括 SFT 数据、RM 训练数据和 RL query 集),我们在所有报告的评估数据集上排除可能受污染的问题或解答.这些评估数据集包括 GSM8K、MATH、Minerva Math、Gaokao 2023 En、Olympiad Bench、College Math、MMLU STEM、GaoKao、CMATH、CN Middle School 24、AIME 24 和 AMC 23.

在分析受污染 sample 时,我们发现一些现有训练数据集(如 MATH 训练集)中包含大量与测试集问题在概念或结构上高度相似的问题.尽管这些变体并非完全重复,但它们可能损害评估的完整性.因此,我们继续从训练语料中排除此类 sample.

---

## 4. 评估 (Evaluation)

### 4.1 Base 模型

我们在三个广泛使用的英文数学基准 GSM8K、MATH 和 MMLU-STEM 上评估 Qwen2-Math 和 Qwen2.5-Math Base 模型.此外,我们还评估了三个中文数学基准 CMATH、GaoKao Math Cloze 和 GaoKao Math QA.所有评估均采用 few-shot chain-of-thought 提示.对于通用模型,我们报告 LLama-3.1-8B/70B/405B 和 Qwen2-1.5B/7B/72B 的结果.对于专用模型,我们使用 DeepSeekMath-Base-7B、DeepSeek-Coder-V2-Lite-Base 和 Intermln2-Math-Base-20B 作为基线.

**表 1: Base 模型在英文和中文数学基准上的结果**

| 模型 | GSM8K (8-shot) | MATH (4-shot) | MMLU-STEM (4-shot) | CMATH (6-shot) | GaoKao Math Cloze (5-shot) | GaoKao Math QA (4-shot) |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|
| **通用模型** |
| Llama-3.1-8B | 56.7 | 20.3 | 53.1 | 51.5 | 8.5 | 28.5 |
| Llama-3.1-70B | 85.5 | 41.4 | 78.1 | 75.5 | 11.9 | 43.3 |
| Llama-3.1-405B | 89.0 | 53.8 | - | - | - | - |
| Qwen2-1.5B | 58.5 | 21.7 | 44.8 | 55.6 | 12.7 | 35.6 |
| Qwen2-7B | 79.9 | 44.2 | 67.6 | 76.7 | 37.3 | 51.6 |
| Qwen2-72B | 89.5 | 51.1 | 79.9 | 85.4 | 55.9 | 72.6 |
| **专用模型** |
| DeepSeekMath-Base-7B | 64.2 | 36.2 | 56.5 | 71.7 | 20.3 | 40.7 |
| DeepSeek-Coder-V2-Lite-Base | 68.3 | 38.1 | 59.5 | 77.8 | 25.4 | 51.3 |
| Internlm2-Math-Base-20B | 68.2 | 30.4 | 63.0 | 65.9 | 16.9 | 40.2 |
| Qwen2-Math-1.5B | 71.3 | 44.4 | 50.4 | 79.6 | 37.3 | 50.7 |
| Qwen2-Math-7B | 80.4 | 50.4 | 65.7 | 83.2 | 48.3 | 57.3 |
| Qwen2-Math-72B | 89.1 | 60.5 | 79.1 | 86.4 | 72.9 | 69.5 |
| **Qwen2.5-Math-1.5B** | 76.8 | 49.8 | 51.3 | 83.0 | 47.5 | 54.1 |
| **Qwen2.5-Math-7B** | **91.6** | 55.4 | 67.8 | 85.0 | 57.6 | 69.5 |
| **Qwen2.5-Math-72B** | 90.8 | **66.8** | **82.8** | **89.7** | **72.9** | **86.3** |

> 注: 模型均采用 few-shot chain-of-thought 提示进行评估.Bold 表示该列最优值.

如表 1 所示,Qwen2.5-Math 系列中最小的模型 Qwen2.5-Math-1.5B 在 GSM8K、MATH、CMATH、GaoKao Math Cloze 和 Gaokao Math QA 上均超过了所有专用基线模型.中型模型 Qwen2.5-Math-7B 在 GSM8K 和 MATH 上分别获得 91.6 和 55.4 分,超过了 Qwen2-72B 的 89.5 和 51.1 分,以及 Llama-3.1-405B 的 89.0 和 53.8 分.旗舰模型 Qwen2.5-Math-72B 在 MATH、CMATH、Gaokao Math Cloze 和 Gaokao Math QA 上创造了新的 SOTA,其中 MATH 达到 66.8 分.相比 Qwen2-Math-1.5B/7B/72B,Qwen2.5-Math-1.5B/7B/72B 在所有基准上均有显著提升,例如在 MATH 上分别提升了 5.4、5.0 和 6.3 分,在 Gaokao Math QA 上分别提升了 3.4、12.2 和 19.8 分,充分证明了 Qwen Math Corpus v2 的有效性.

### 4.2 Instruct 模型

我们在英文和中文数学基准上评估 Qwen2-Math-Instruct 和 Qwen2.5-Math-Instruct.除 GSM8K 和 MATH 等广泛使用的基准外,我们还引入了更具挑战性的考试基准以全面检验模型能力,包括 OlympiadBench、CollegeMath、GaoKao 2023 En、AIME2024 和 AMC2023.中文数学基准包括 CMATH、GaoKao(含 GaoKao I/II 2024、GaoKao-Math-QA、GaoKao-Math-Cloze 和收集的 91 道 2024 年 GaoKao 题目)以及 CN Middle School 24(收集的 101 道 2024 年中国中考题目).

我们在 zero-shot 设置下报告所有基准的 greedy、Maj@8 和 RM@8 性能,多选题基准(包括 MMLU STEM 和 GaoKao、CN Middle School 24 中的选择题)采用 5-shot 设置.

通用模型基线包括 Qwen2-1.5/7/72B-Instruct、Llama-3.1-8/70B-Instruct 和 GPT4o-2024-08-06.专用模型基线包括 DeepSeekMath-7B-RL、DeepSeek-Coder-V2-Lite-Instruct、Interlm2-math-plus-7B/20B/mixtral8x7B、Mathstral-7B-v0.1、NuminaMath-7/72B-CoT.

**表 2: Instruct 模型在英文基准上的结果 (CoT 与 TIR)**

| 模型 | GSM8K | MATH | Minerva Math | GaoKao 2023 En | Olympiad Bench | College Math | MMLU STEM | Avg. |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **CoT 模式** |
| GPT-4o-2024-08-06 | 92.9 | 81.1 | 36.8 | 67.5 | 43.3 | 48.5 | 64.2 | 62.0 |
| DeepSeekMath-7B-RL | 88.2 | 52.4 | 20.6 | 43.6 | 19.0 | 37.5 | 64.8 | 46.6 |
| DeepSeek-Coder-V2-Lite-Instruct | 87.6 | 61.0 | 29.4 | 56.1 | 26.4 | 39.8 | 68.6 | 52.7 |
| Internlm2-math-plus-7B | 84.0 | 54.4 | 17.3 | 50.1 | 18.8 | 36.2 | 55.2 | 45.1 |
| Internlm2-math-plus-20B | 87.9 | 56.5 | 20.2 | 51.9 | 23.1 | 37.5 | 63.5 | 48.7 |
| Internlm2-math-plus-mixtral8x7B | 92.1 | 59.4 | 26.8 | 49.6 | 25.0 | 37.5 | 71.9 | 51.8 |
| Mathstral-7B-v0.1 | 84.9 | 56.6 | 16.2 | 46.0 | 21.5 | 33.7 | 64.0 | 46.1 |
| NuminaMath-7B-CoT | 75.4 | 55.2 | 19.1 | 47.5 | 19.9 | 36.9 | 60.8 | 45.0 |
| NuminaMath-72B-CoT | 90.8 | 66.7 | 25.0 | 58.4 | 32.6 | 39.7 | 64.5 | 54.0 |
| Llama-3.1-8B-Instruct | 76.6 | 47.2 | 21.7 | 38.4 | 15.4 | 33.8 | 60.5 | 41.9 |
| Llama-3.1-70B-Instruct | 94.1 | 65.7 | 34.2 | 54.0 | 27.7 | 42.5 | 80.4 | 56.9 |
| Qwen2-1.5B-Instruct | 64.1 | 25.1 | 5.5 | 19.7 | 4.1 | 10.4 | 46.2 | 25.0 |
| Qwen2-7B-Instruct | 85.7 | 52.9 | 19.5 | 36.4 | 21.3 | 24.5 | 68.2 | 44.1 |
| Qwen2-72B-Instruct | 93.2 | 69.0 | 31.6 | 58.7 | 33.2 | 43.2 | **84.4** | 59.0 |
| Qwen2-Math-1.5B-Instruct | 84.2 | 69.4 | 29.4 | 59.7 | 31.3 | 44.2 | 54.9 | 53.3 |
| Qwen2-Math-7B-Instruct | 89.9 | 75.1 | 34.6 | 62.1 | 38.2 | 45.9 | 63.8 | 58.5 |
| Qwen2-Math-72B-Instruct | **96.7** | 84.0 | 40.1 | 68.3 | 43.0 | 47.9 | 79.9 | 65.7 |
| **Qwen2.5-Math-1.5B-Instruct** | 84.8 | 75.8 | 29.4 | 65.5 | 38.1 | 47.7 | 57.5 | 56.9 |
| **Qwen2.5-Math-7B-Instruct** | 95.2 | 83.6 | 37.1 | 66.8 | 41.6 | 46.8 | 71.9 | 62.9 |
| **Qwen2.5-Math-72B-Instruct** | 95.9 | **85.9** | **44.1** | **71.9** | **49.0** | **49.5** | 80.8 | **68.2** |
| **TIR 模式** |
| **Qwen2.5-Math-1.5B-Instruct** | 83.7 | 79.9 | 33.5 | 67.8 | 49.2 | 54.8 | 56.9 | 60.8 |
| **Qwen2.5-Math-7B-Instruct** | 94.6 | 85.2 | 39.0 | 71.4 | 55.6 | 56.0 | 70.1 | 67.4 |
| **Qwen2.5-Math-72B-Instruct** | **95.8** | **88.1** | **48.2** | **75.3** | **60.6** | **57.7** | **82.3** | **72.6** |

> 注: CoT 模式下,MMLU(STEM) 为 few-shot pass@1,其余为零样本 pass@1.TIR 模式下所有基准均为零样本.Bold 表示 CoT 和 TIR 各自模式下的最优 pass@1.除 pass@1 分数外,我们还提供了 majority voting (Maj@8) 和 reward model best-of-N (RM@8) 在 8 条采样解答中的性能.

**表 3: Instruct 模型在中文基准上的结果 (CoT 与 TIR)**

| 模型 | GaoKao | CMATH | CN Middle School 24 | Avg. |
|:---|:---:|:---:|:---:|:---:|
| **CoT 模式** |
| GPT-4o-2024-08-06 | 42.6 | 92.5 | 60.4 | 65.2 |
| DeepSeekMath-7B-RL | 33.6 | 86.7 | 67.3 | 62.5 |
| DeepSeek-Coder-V2-Lite-Instruct | 51.1 | 89.8 | 66.3 | 69.1 |
| Internlm2-math-plus-7B | 34.5 | 82.7 | 32.7 | 50.0 |
| Internlm2-math-plus-20B | 36.1 | 81.3 | 33.7 | 50.4 |
| Internlm2-math-plus-mixtral8x7B | 37.3 | 85.7 | 39.6 | 54.2 |
| Mathstral-7B-v0.1 | 31.6 | 76.7 | 42.6 | 50.3 |
| NuminaMath-7B-CoT | 36.4 | 78.2 | 60.4 | 58.3 |
| NuminaMath-72B-CoT | 47.9 | 87.3 | 75.2 | 70.1 |
| Llama-3.1-8B-Instruct | 30.4 | 64.8 | 43.6 | 46.3 |
| Llama-3.1-70B-Instruct | 41.7 | 86.7 | 59.4 | 62.6 |
| Qwen2-1.5B-Instruct | 17.0 | 65.5 | 31.7 | 38.1 |
| Qwen2-7B-Instruct | 35.1 | 83.5 | 54.5 | 57.7 |
| Qwen2-72B-Instruct | 54.6 | 92.2 | 74.3 | 73.7 |
| Qwen2-Math-1.5B-Instruct | 46.5 | 84.2 | 66.3 | 65.7 |
| Qwen2-Math-7B-Instruct | 49.0 | 90.0 | 69.3 | 69.4 |
| Qwen2-Math-72B-Instruct | 59.8 | 92.8 | 77.2 | 76.6 |
| **Qwen2.5-Math-1.5B-Instruct** | 62.4 | 89.7 | 76.2 | 76.1 |
| **Qwen2.5-Math-7B-Instruct** | 66.3 | 91.8 | 73.3 | 77.1 |
| **Qwen2.5-Math-72B-Instruct** | **68.6** | **94.3** | **79.2** | **82.7** |
| **TIR 模式** |
| **Qwen2.5-Math-1.5B-Instruct** | 59.6 | 89.3 | 71.3 | 73.4 |
| **Qwen2.5-Math-7B-Instruct** | 62.9 | 90.5 | 75.2 | 76.2 |
| **Qwen2.5-Math-72B-Instruct** | **68.5** | **93.0** | **78.2** | **79.9** |

#### 4.2.1 英文基准分析

如表 2 所示,我们可以得出以下结论:

1. **Qwen2-Math-Instruct 已展现出卓越能力**: 1.5B 模型的平均得分超过了当前所有参数量低于 70B 的模型;7B 模型与 Qwen2-72B-Instruct 性能持平;Qwen2-Math-72B-Instruct 超过最新版 GPT-4o 3.7 分.
2. **Qwen2.5-Math-Instruct 实现进一步升级**: 在传统的 CoT 模式下,1.5B 和 7B Qwen2.5-Math-Instruct 分别达到了与 7B 和 72B Qwen2-Math-Instruct 相当的结果,展现了跨尺寸的性能跃迁.Qwen2.5-Math-72B-Instruct 的平均得分比当前最佳模型高出 2.5 分,比 GPT-4o 高出 6.2 分.这表明训练数据与策略的改进可以作为单纯扩大模型尺寸之外的另一条性能提升路径.
3. **TIR 模式极具成效**: 借助 Python 解释器,7B 模型在 TIR 模式下已经匹配了 Qwen2.5-Math-72B-Instruct 在 CoT 模式下的性能.这说明通过外部工具进行精确的数学计算可以显著辅助 LLM 的推理——在很多情况下,LLM 的推理过程是合理的,但计算错误会引入偏差.
4. **奖励模型表现极为出色**: 在几乎所有基准和模型上,RM@N 分数都显著优于 Maj@N 分数,这为未来改进强化学习策略提供了可靠的性能 oracle.我们很可能很快就能看到在 MATH 上通过贪婪解码(greedy decoding)超过 90 分的模型,即使对于 7B 尺寸.

![Qwen2.5-Math-Instruct 在 CoT 与 TIR 模式下的性能对比](images/COT_vs_TIR.pdf)

> **图 3**: Qwen2.5-Math-1.5/7/72B-Instruct 使用 TIR 与 CoT 的性能对比.蓝色代表 TIR 性能,橙色代表 CoT 性能.可见 TIR 相比 CoT 可进一步实现性能提升.

#### 4.2.2 中文基准分析

如表 3 所示,对于 Qwen2-Math-Instruct,虽然没有专门加入中文数学相关的训练数据,但得益于 Qwen2 强大的语言迁移能力,Qwen2-Math-1.5B-Instruct 在中文平均分上已经超过 GPT-4o.

在 Qwen2.5-Math-Instruct 的开发中,我们有意识地整合了中文数学后训练数据,使得中文性能获得了大幅提升.Qwen2.5-Math-1.5B-Instruct 达到了与 Qwen2-Math-72B-Instruct 相近的结果,而 Qwen2.5-Math-72B-Instruct 则以令人印象深刻的 17.5 分优势超越了 GPT-4o.

我们的奖励模型在中文基准上同样表现出色.与英文结果类似,RM@N 分数始终优于 Maj@N 分数,凸显了其有效性.然而,与英文结果的一个关键差异是,TIR 模式在中文上并未展现出相比 CoT 模式的显著性能优势,我们将在未来研究中继续探索这一方面.

### 4.3 数学竞赛问题

最后,我们评估了模型在极具挑战性的竞赛基准 AIME 2024 和 AMC 2023 上解决复杂数学问题的能力.

**表 4: 数学竞赛问题上的结果**

| 模型 | AIME24 | AMC23 |
|:---|:---:|:---:|
| **CoT 模式** |
| Claude 3 Opus | 2/30 | - |
| GPT-4 Turbo | 1/30 | - |
| Gemini 1.5 Pro | 2/30 | - |
| Gemini Math-Specialized 1.5 Pro | 7/30 | - |
| NuminaMath-72B CoT | 1/30 | 21/40 |
| Qwen2-Math-1.5B-Instruct | 1/30 | 18/40 |
| Qwen2-Math-7B-Instruct | 4/30 | 25/40 |
| Qwen2-Math-72B-Instruct | 6/30 | 24/40 |
| **Qwen2.5-Math-1.5B-Instruct** | 3/30 | 24/40 |
| **Qwen2.5-Math-7B-Instruct** | 5/30 | 25/40 |
| **Qwen2.5-Math-72B-Instruct** | **9/30** | **28/40** |
| **TIR 模式** |
| **Qwen2.5-Math-1.5B-Instruct** | 7/30 | 20/40 |
| **Qwen2.5-Math-7B-Instruct** | 6/30 | 27/40 |
| **Qwen2.5-Math-72B-Instruct** | **12/30** | **28/40** |

如表 4 所示,相比 Qwen2-Math-Instruct,Qwen2.5-Math-Instruct 在难题上的性能获得了显著提升.

在 AMC 2023 上,借助奖励模型,Qwen2.5-Math-1.5B-Instruct 使用 CoT 模式下 RM@256 成功解出了 40 题中的 29 题,显著优于 NuminaMath-72B CoT.Qwen2.5-Math-72B-Instruct 在 TIR 模式下几乎取得了满分,几乎解出了所有问题.我们将这一令人印象深刻的表现归功于预训练阶段收集和合成的海量高难度数学数据.

在极其困难的 AIME 2024 基准上,Claude3 Opus、GPT-4 Turbo 和 Gemini 1.5 Pro 在 30 题中仅解出 1 至 2 题.相比之下,Qwen2.5-Math-72B-Instruct 在 CoT 模式下通过贪婪解码解出 9 题,在 TIR 模式下解出 12 题.借助奖励模型,Qwen2.5-Math-7B-Instruct 甚至能够解出多达 21 题,进一步证明了 Qwen2.5-Math-Instruct 卓越的数学解题能力.

---

## 5. 附录: Qwen2-Math 奥林匹克级别问题案例研究

本附录展示 Qwen2-Math-72B-Instruct 在多个奥林匹克级别数学问题上的解题表现,涵盖数论、代数、组合与概率、几何四大领域.

### 5.1 数论 (Number Theory)

**问题 1** (IMO Shortlist 2002): 求最小正整数 $t$,使得存在整数 $x_1, x_2, \ldots, x_t$ 满足

$$
x_1^3 + x_2^3 + \cdots + x_t^3 = 2002^{2002}
$$

**Qwen2-Math-72B-Instruct 解答思路**: 通过分析立方数模 9 的性质($0^3 \equiv 0$, $1^3 \equiv 1$, $2^3 \equiv -1 \pmod 9$),确定 $2002^{2002} \equiv 4 \pmod 9$.进而证明至少需要 4 个立方数之和才能模 9 余 4.最终答案: $t = 4$.

**问题 2** (IMO Shortlist 2022): 对正整数 $n$,记 $s(n)$ 为 $n$ 的各位数字之和.设 $P(x) = x^n + a_{n-1}x^{n-1} + \cdots + a_1x + a_0$ 是一个多项式,其中 $n \geq 2$ 且所有 $a_i$ 均为正整数.是否可能对所有正整数 $k$,$s(k)$ 与 $s(P(k))$ 具有相同的奇偶性?

**Qwen2-Math-72B-Instruct 解答思路**: 利用 $s(k) \equiv k \pmod 2$ 的性质,将问题转化为是否存在多项式 $P$ 使得 $P(k) \equiv k \pmod 2$ 对所有 $k$ 成立.通过分析 $k \equiv 0$ 和 $k \equiv 1 \pmod 2$ 两种情况,推导出矛盾条件.最终答案: **不可能**.

### 5.2 代数 (Algebra)

**问题 3** (IMO 2022): 设 $\mathbb{R}^+$ 为正实数集.求所有函数 $f: \mathbb{R}^+ \to \mathbb{R}^+$ 使得对每个 $x \in \mathbb{R}^+$ 恰好存在一个 $y \in \mathbb{R}^+$ 满足

$$
xf(y) + yf(x) \leq 2
$$

**Qwen2-Math-72B-Instruct 解答思路**: 首先令 $x = y$ 得到 $xf(x) \leq 1$,即 $f(x) \leq \frac{1}{x}$.然后验证 $f(x) = \frac{1}{x}$ 满足条件:由 AM-GM 不等式,$\frac{x}{y} + \frac{y}{x} \geq 2$,等号当且仅当 $x = y$ 时成立,恰好满足「恰好存在一个 $y$」的条件.最终答案: $f(x) = \frac{1}{x}$.

**问题 4** (International Zhautykov Olympiad 2020): 设 $Z$ 为所有整数集合.求所有函数 $f: Z \to Z$ 使得对所有整数 $x, y$ 有

$$
f(4x + 3y) = f(3x + y) + f(x + 2y)
$$

**Qwen2-Math-72B-Instruct 解答思路**: 通过代入特殊值($x=0$, $y=0$ 等)推导函数方程的性质,猜测 $f$ 为线性函数.设 $f(x) = kx$ 并验证其满足原方程.最终答案: $f(x) = kx$,$k$ 为任意整数.

**问题 5** (Baltic Way 2023): 求所有函数 $f: \mathbb{R} \to \mathbb{R}$ 使得对所有实数 $x, y$ 有

$$
f(f(x) + y) + xf(y) = f(xy + y) + f(x)
$$

**Qwen2-Math-72B-Instruct 解答思路**: 令 $y = 0$ 得到 $f(f(x)) = f(x) + c - xc$;令 $x = 0$ 得到 $f(c + y) = f(y) + c$.通过进一步代入和分析,结合验证 $f(x) = 0$ 和 $f(x) = x$ 均满足方程,得出最终答案: $f(x) = 0$ 或 $f(x) = x$.

### 5.3 组合与概率 (Counting & Probability)

**问题 6** (Lusophon Mathematical Olympiad 2023): 很久以前,火星人分为红、绿、蓝三种颜色.由于星际战争,每种颜色仅剩 2 名火星人.为重建种群,他们使用一种机器:将两种不同颜色的火星人放入机器,会产出 4 个第三种颜色的火星人.

a) 是否可能通过有限次操作后得到 2022 红、2022 绿、2022 蓝?
b) 是否可能通过有限次操作后得到 2021 红、2022 绿、2023 蓝?

**Qwen2-Math-72B-Instruct 解答思路**: 分析每种颜色火星人数量的奇偶性不变量(invariant).初始状态三种颜色均为偶数(2, 2, 2).每次操作会使两种颜色各减 1(奇偶性翻转),第三种颜色加 4(奇偶性不变).因此三种颜色数量的奇偶性同步翻转,始终保持「全偶」或「全奇」.由于初始为全偶,操作后始终全偶.a) 2022 为偶数,可能;b) 2021 和 2023 为奇数,不可能.

**问题 7** (Balkan MO 2023): Joe 和 Penny 玩游戏.初始有 5000 颗石子,两人轮流取石.第 $k$ 轮可以取 1 至 $k$ 颗石子.Joe 进行奇数轮操作,Penny 进行偶数轮操作.取走最后一颗石子者获胜.若双方都采用最优策略,谁获胜?

**Qwen2-Math-72B-Instruct 解答思路**: 总操作轮数恰好为 5000 轮(每轮至少取 1 颗).第 5000 轮为偶数轮,由 Penny 执行.由于 Penny 执行最后一轮,她必然取走最后一颗石子.最终答案: **Penny**.

**问题 8** (Math Odyssey): 学校开设 10 门选修课,每名学生可选任意数量的课程.校长选出 $k$ 名学生,虽然每名学生的选课组合不同,但任意两名学生至少有一门共同课程.此时发现,这 $k$ 名学生之外的任何学生无论如何选课都无法与这 $k$ 名学生都成为同学(只要有一门共同课即为同学).求 $k$ 的最大值.

**Qwen2-Math-72B-Instruct 解答思路**: 将问题建模为集合覆盖问题.10 门课的非空子集共有 $2^{10} - 1 = 1023$ 个.条件要求选出的 $k$ 个集合两两相交,且形成 dominating set.最大独立集大小为 $2^9 = 512$(取所有含某固定课程的集合的补集).因此 $k_{max} = 1023 - 511 = 512$.最终答案: $k = 512$.

### 5.4 几何 (Geometry)

**问题 9** (USAMO 2010): 设 $\triangle ABC$ 中 $\angle A = 90^\circ$.点 $D$ 和 $E$ 分别位于边 $AC$ 和 $AB$ 上,满足 $\angle ABD = \angle DBC$ 和 $\angle ACE = \angle ECB$.线段 $BD$ 和 $CE$ 交于 $I$.判断 $AB$、$AC$、$BI$、$ID$、$CI$、$IE$ 是否可能同时为整数.

**Qwen2-Math-72B-Instruct 解答思路**: 设 $A$ 为原点, $B = (a, 0)$, $C = (0, b)$.则内心 $I = (\frac{a}{2}, \frac{b}{2})$,$BI = CI = \frac{\sqrt{a^2+b^2}}{2}$,$ID = IE = r = \frac{a+b-\sqrt{a^2+b^2}}{2}$.要使 $BI$ 为整数,$\sqrt{a^2+b^2}$ 必须为偶数.但即使取 $(3,4,5)$ 勾股数组,$BI = 2.5$ 仍非整数.结论: **不可能**.

**问题 10** (JBMO Shortlist 2011): 设 $AD$、$BF$ 和 $CE$ 为 $\triangle ABC$ 的三条高.过 $D$ 作平行于 $AB$ 的直线交 $EF$ 于 $G$.若 $H$ 为 $\triangle ABC$ 的垂心,求 $\angle CGH$.

**Qwen2-Math-72B-Instruct 解答思路**: 利用垂心性质和 cyclic quadrilateral $AEHF$ 的性质.由于 $DG \parallel AB$,$\angle DGE = \angle BAE = \angle EAF = \angle EHF = 90^\circ$.因此 $\angle CGH = 90^\circ$.最终答案: $\boxed{90^\circ}$.

---

## 6. 评估中使用的 Prompt

本报告附录中还包含了完整的评估 prompt 设计,涵盖 Base 模型和 Instruct 模型在 CoT 与 TIR 模式下的各种 prompt 模板.由于篇幅限制,具体 prompt 文本可参考原论文附录 Fig. A1-A10.

---

## 7. 技术思考节点 (Technical Thinking Nodes)

以下按「设计动机」「数据实验」「架构细节」「训练策略」「局限与展望」五类整理本报告中的关键技术思考节点.

### 7.1 设计动机 (Design Rationale)

> **思考 1: 为什么需要数学专用模型而非通用模型的数学能力增强?**

报告明确指出,通用语言模型在数学推理上的次优表现根源在于预训练阶段数学数据的不足.此前 DeepSeekMath、InternLM-Math 等工作已证明从数字数据库中提取大规模数学文本语料的价值.专用数学模型的价值不仅在于聚焦数据分布,更在于可以引入数学特有的训练范式(如拒绝采样、奖励模型、工具集成推理)——这些范式在通用模型的训练中难以获得足够关注和资源倾斜.

> **思考 2: 自提升(self-improvement)闭环的核心设计逻辑**

Qwen2.5-Math 的核心创新在于构建了一个「更强模型 → 更强合成数据 → 更强奖励模型 → 更强 RL 训练 → 更强模型」的自提升闭环:

- **预训练**: 用 Qwen2-Math-72B-Instruct 合成 Qwen Math Corpus v2
- **SFT**: 用拒绝采样迭代进化 CoT/TIR 数据
- **RM**: 在大量采样数据上训练细粒度奖励模型
- **RL**: 用 GRPO + reward shaping 持续优化策略
- **推理**: 用 RM 进行 best-of-N 采样

这一闭环的本质是将模型自身作为「数据生成器」和「质量评判者」,在人工标注极为昂贵的数学领域实现了规模化数据自给.

### 7.2 数据实验 (Data Experiments)

> **思考 3: Qwen Math Corpus v2 相比 v1 的关键增量来源**

| 维度 | Corpus v1 | Corpus v2 |
|:---|:---|:---|
| 总 token 量 | ~700B | >1T |
| 合成数据 | Qwen2-72B-Instruct 生成 | Qwen2-Math-72B-Instruct 生成(更强基座) |
| 中文数据 | 较少 | 多轮召回扩充,显著增加 |
| 基座初始化 | Qwen2 系列 | Qwen2.5 系列(更强的语言/代码/推理能力) |
| 上下文长度 | 4K | 4K |

> **思考 4: CoT 与 TIR 数据合成策略的差异**

| 维度 | CoT 数据 | TIR 数据 |
|:---|:---|:---|
| 问题来源 | GSM8K/MATH/NuminaMath + K-12 中文题库 | GSM8K/MATH/CollegeMath/NuminaMath + 中文翻译 |
| 问题演化 | MuggleMath | MuggleMath + DotaMath |
| 解答生成 | 迭代拒绝采样,基于 RM 和标注答案筛选 | 在线 RFT,多温度核采样 + 迭代去重 |
| 数据规模 | 200万英文 + 50万中文 | 19.5万英文 + 中文翻译 |
| 核心挑战 | 推理路径质量 | 工具调用格式与计算精确度 |

### 7.3 架构细节 (Architecture Details)

> **思考 5: 奖励模型的 listwise 损失设计**

Qwen2.5-Math-RM 采用 listwise 而非 pairwise 损失计算:

$$
\mathcal{L}_{rm}(\theta) = -\frac{1}{k(6-k)} \sum \log \sigma(r_\theta(x, y_{pos}) - r_\theta(x, y_{neg}))
$$

这一设计的优势在于:
- 每个 query 的 6 条解答被整体处理,保留了完整的偏好排序信息
- 避免了将 $k \times (6-k)$ 对拆分为独立样本带来的信息损失
- 训练效率和效果均优于朴素的 pairwise 方法

> **思考 6: GRPO 的 group-level baseline 机制**

GRPO 相比 PPO 的核心改进在于消除了价值函数近似的需求:

$$
\hat{A}_i = \frac{r_i - \text{mean}(r_i)}{\text{std}(r_i)}
$$

这一设计特别适合数学推理场景,因为:
- 同一组(group)内解答的难度相近,相对排序比绝对分数更有意义
- 省去了训练独立 value model 的计算开销
- 对 reward model 的绝对校准要求降低,更关注相对排序

### 7.4 训练策略 (Training Strategy)

> **思考 7: RL query 筛选的「Goldilocks 原则」**

报告明确只保留有 2 至 5 条正确解答(共采样 8 条)的 query:

- **< 2 条正确**: 模型缺乏基本解题能力,RL 难以收敛
- **> 5 条正确**: 模型已掌握该问题,RL 无提升空间
- **2-5 条正确**: 「刚好够难」——模型有解题基础但不够稳定,RL 能带来最大边际收益

这一筛选策略体现了对 RL 训练动态的深刻理解:RL 不是万能的,它只能在「模型已经部分掌握但需要进一步巩固」的问题上发挥作用.

> **思考 8: Reward Shaping 的双重信号融合**

$$
r = \sigma(\alpha \cdot r_m) + (r_v - 1)
$$

这一公式的精妙之处:
- $\sigma(\alpha \cdot r_m) \in (0, 1)$: 将连续型奖励模型输出压缩到 $(0,1)$ 区间,提供细粒度质量排序
- $(r_v - 1) \in \{-1, 0\}$: 基于规则验证器提供强烈的正确性信号,确保正确解答始终获得更高总奖励
- 正确组内按 $r_m$ 排序,错误组内也按 $r_m$ 排序,实现了「先分对错,再比质量」的两层区分

### 7.5 局限与展望 (Limitations & Outlook)

> **思考 9: TIR 模式在中文上的「失效」现象**

报告坦诚指出:TIR 模式在中文基准上并未展现出相比 CoT 的显著优势,这与英文基准上 TIR 大幅超越 CoT 的现象形成对比.可能的原因包括:

- 中文数学题以「填空/解答」为主,对精确数值计算的需求不如英文竞赛题强烈
- 中文 TIR 数据的规模和质量可能不及英文 TIR 数据
- Python 解释器处理中文文本输出时的格式兼容性问题

这一观察提醒我们:工具集成推理的价值高度依赖于任务类型和语言特性,不能盲目推广.

> **思考 10: 数据去污的双层判据设计**

报告采用 13-gram 匹配 + 最长公共子序列比例(> 0.6)的双层判据:

- **13-gram**: 捕获精确或近精确复制,但对改写变体敏感度过低
- **LCS 比例 > 0.6**: 捕获结构相似但表述不同的变体问题,弥补了 n-gram 的不足

表 5 展示了 MATH 训练集中被过滤的样本与测试集的相似案例,证明了双层判据的必要性:

| MATH 训练集(已过滤) | MATH 测试集 |
|:---|:---|
| $1+2+3+\cdots+9+10$ 除以 8 的余数? | $1+2+3+\cdots+9+10$ 除以 9 的余数? |
| $n/1400$ 小数终止的整数 $n$ (1-1000) 个数? | $n/1375$ 小数终止的整数 $n$ (1-1000) 个数? |
| 每天翻倍存钱,总金额先超过 $2 的是星期几? | 每天翻倍存钱,总金额先超过 $5 的是星期几? |

这些案例表明,即使问题参数发生微小变化,核心解题思路也完全相同,若保留在训练集中将严重高估模型真实能力.

> **思考 11: 跨尺寸性能跃迁的启示**

Qwen2.5-Math-7B-Instruct 几乎达到 Qwen2-Math-72B-Instruct 的性能,1.5B 模型超过了所有低于 70B 参数的开源模型.这一现象揭示了一个重要趋势:

- **数据质量与训练策略的改进可以作为参数规模扩展的替代路径**
- 在特定领域(如数学),精心设计的合成数据 pipeline 和 RL 训练流程可能比单纯增大模型尺寸更具成本效益
- 然而,这一结论是否能推广到通用能力仍存疑——数学问题的结构化和可验证性使其特别适合合成数据驱动的方法

> **思考 12: RM@N 与 Maj@N 的差距意味着什么?**

在几乎所有基准上,RM@8 显著优于 Maj@8,这一差距揭示了两个关键信息:

1. **奖励模型已具备高度可靠的排序能力**: 能够从 8 条采样中选出最优解答
2. **生成模型仍有巨大提升空间**: 如果生成模型能通过 RL 更好地对齐奖励模型的偏好,greedy 解码的性能将大幅提升
3. **未来方向**: 更强的 RL 策略(如更长的训练、更大的批次、更精细的 reward shaping)有望将 RM@N 的优势转化为 greedy 性能的提升

---

## 8. 总结

Qwen2.5-Math 通过「自提升」范式的三轮迭代——预训练合成数据 → SFT 拒绝采样 → RM + RL 强化学习——在数学推理领域树立了开源模型的新标杆.其核心贡献包括:

1. **规模化的数学预训练语料**: Qwen Math Corpus v2 超过 1T token,通过更强模型迭代合成
2. **双语 CoT + TIR 联合训练**: 首次在数学模型中系统性地整合中文推理数据和工具集成推理
3. **精细化的奖励模型与 RL**: listwise RM + GRPO + reward shaping 的三层优化体系
4. **卓越的性能表现**: 72B 模型在 MATH 上达 85.9 (CoT) / 88.1 (TIR),1.5B 模型即可超越 70B 级竞品

该系列模型的发布不仅提供了当前最强的开源数学模型,更为「如何通过合成数据和自提升闭环构建领域专家模型」提供了一个可复现的完整技术蓝图.

---

> **参考引用**
> - 原文: Qwen2.5-Math Technical Report, arXiv:2409.12122
> - 代码与模型: https://github.com/QwenLM/Qwen2.5-Math
