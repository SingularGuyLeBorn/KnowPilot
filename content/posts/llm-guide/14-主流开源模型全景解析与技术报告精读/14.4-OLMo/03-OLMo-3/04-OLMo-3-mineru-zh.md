---
title: "OLMo-3 (OLMoE) Technical Report - Segment-by-Segment Translation with Translator's Notes"
---

## 1 引言 (Introduction)

>  **[返回 14.4-OLMo 家族总览](../../14.4-OLMo.md)**


Despite significant advances in Large Language Models (LMs) on various tasks, there remains a clear trade-off between performance and cost in both training and inference. High-performing LMs are inaccessible for many academics and open-source developers as they are prohibitively expensive to build and deploy. One approach to improve the cost-performance trade-off lies in using sparsely-activated Mixture-of-Experts (MoEs). MoEs have several experts in each layer, only a subset of which is activated at a time (see Figure 2). This makes MoEs significantly more efficient than dense models with a similar number of total parameters, which activate all parameters for every input. For this reason, industry frontier models use MoEs including Gemini-1.5 and reportedly GPT-4.

尽管大语言模型 (LMs) 在各项任务上取得了显著进展，但在训练和推理中，性能与成本之间仍然存在明显的权衡。高性能语言模型对许多学术界和开源开发者来说是不可及的，因为它们的构建和部署成本过高。改善成本-性能权衡的一种方法是使用稀疏激活的混合专家 (MoE, Mixture-of-Experts) 模型。MoE 在每个层中有多个专家，每次只激活其中的一个子集(见图 2)。这使得 MoE 比具有相似总参数量的稠密模型显著更高效，后者为每个输入激活所有参数。因此，业界前沿模型使用 MoE，包括 Gemini-1.5 和 reportedly GPT-4。

Most MoE models, however, are closed-source: While some have publicly released model weights, they offer limited to no information about their training data, code, or recipes (see Figure 1). While there have been prior efforts to make language modeling research fully accessible, they have been largely limited to dense LMs. This comes despite MoEs requiring more openness as they add complex new design questions to LMs, such as how many total versus active parameters to use, whether to use many small or few large experts, if experts should be shared, and what routing algorithm to use. The lack of open resources and findings about these details prevents the field from building cost-efficient open MoEs that approach the capabilities of closed-source frontier models.

然而，大多数 MoE 模型是闭源的：虽然一些已公开发布模型权重，但它们对训练数据、代码或配方提供的信息有限或完全没有(见图 1)。虽然之前有努力使语言建模研究完全可访问，但它们主要局限于稠密语言模型。尽管 MoE 需要更多开放性，因为它们为语言模型增加了复杂的新设计问题，例如使用多少总参数与激活参数、使用许多小专家还是少数大专家、专家是否应该共享、使用什么路由算法。关于这些细节的开放资源和发现的缺乏阻碍了该领域构建接近闭源前沿模型能力的成本效益开放 MoE。

To address these issues, we introduce OLMOE, a fully open Mixture-of-Experts language model with state-of-the-art performance among similarly-sized models. In particular, we pretrain OLMOE-1B-7B for 5.1 trillion tokens with 6.9B total parameters, of which only 1.3B are activated for each input token. This leads to a similar inference cost as using dense models with around 1B parameters, such as OLMo 1B or TinyLlama 1B, but requires more GPU memory to store its 7B total parameters. Our experiments show that MoEs train ~2x faster than dense LMs with equivalent active parameters. In Figure 1, we show that OLMOE-1B-7B significantly outperforms all open 1B models and displays competitive performance to dense models with significantly higher inference costs and memory storage (e.g., similar MMLU scores to Llama2-13B, which is ~10x more costly). Via instruction- and preference tuning, we create OLMOE-1B-7B-INSTRUCT, which we find exceeds various larger instruct models including Llama2-13B-Chat, OLMo-7B-Instruct (0724), and DeepSeekMoE-16B on common benchmarks (MMLU, GSM8k, HumanEval, etc.).

为了解决这些问题，我们介绍了 OLMOE，一个完全开源的混合专家语言模型，在相似规模的模型中具有最先进的性能。具体而言，我们在 5.1 万亿个 token 上预训练了 OLMOE-1B-7B，总参数量为 69 亿，其中每个输入 token 仅激活 13 亿。这导致与使用约 10 亿参数的稠密模型(如 OLMo 1B 或 TinyLlama 1B)相似的推理成本，但需要更多 GPU 内存来存储其 70 亿总参数。我们的实验表明，MoE 比具有等效激活参数的稠密语言模型训练速度快约 2 倍。在图 1 中，我们展示了 OLMOE-1B-7B 显著优于所有开源 1B 模型，并显示出与推理成本和内存存储显著更高的稠密模型相当的性能(例如，与 Llama2-13B 相似的 MMLU 分数，后者成本约 10 倍)。通过指令微调 (Instruction Tuning) 和偏好微调 (Preference Tuning)，我们创建了 OLMOE-1B-7B-INSTRUCT，我们发现它在常见基准测试(MMLU、GSM8k、HumanEval 等)上超越了各种更大的指令模型，包括 Llama2-13B-Chat、OLMo-7B-Instruct (0724) 和 DeepSeekMoE-16B。

Our comprehensive set of controlled experiments highlights key design choices for MoEs (see Table 1) and LMs in general. One critical design decision for making MoEs performant is the use of fine-grained routing with granular experts: we employ 64 small experts in each layer with 8 being activated. The choice of routing algorithm is also important: we find dropless token-based routing outperforms expert-based routing. Our findings also include those that challenge prior work, such as the ineffectiveness of shared experts and the limited benefits of sparsely upcycling a pretrained dense LM into an MoE unless under small compute budgets. Finally, we analyze the routing behavior in OLMOE-1B-7B, finding that routing saturates early in pretraining, experts are rarely co-activated, and experts exhibit domain and vocabulary specialization.

我们全面的受控实验突出了 MoE(见表 1)和一般语言模型的关键设计选择。使 MoE 高性能的一个关键设计决策是使用细粒度路由与细粒度专家：我们在每层使用 64 个小专家，其中 8 个被激活。路由算法的选择也很重要：我们发现 dropless 基于 token 的路由优于基于专家的路由。我们的发现还包括挑战先前工作的结论，例如共享专家无效，以及在较小计算预算之外，将预训练的稠密语言模型稀疏升级为 MoE 的收益有限。最后，我们分析了 OLMOE-1B-7B 中的路由行为，发现路由在预训练早期就饱和了，专家很少被共同激活，且专家表现出领域和词汇专业化。

We hope our fully open MoE facilitates more research and analysis to improve our understanding of these models. We release training code, intermediate checkpoints (every 5000 steps), training logs, and training data under open-source licenses (Apache 2.0 or ODC-By 1.0).

我们希望我们完全开源的 MoE 能促进更多研究和分析，以改善我们对这些模型的理解。我们在开源许可证(Apache 2.0 或 ODC-By 1.0)下发布训练代码、中间检查点(每 5000 步)、训练日志和训练数据。

> 译者注(设计动机): OLMoE 的核心定位非常清晰：用 1.3B 激活参数达到接近 7B 稠密模型的性能，同时保持与 1B 稠密模型相当的推理成本。这是 MoE 架构的经典价值主张——用内存换速度。OLMoE 的关键工程决策包括：1) 细粒度路由(64 专家/层，激活 8 个)，这比传统 MoE 的粗粒度设计(如 8 专家/层)提供了更高的专家专业化潜力; 2) dropless token-based 路由，避免了 token 被丢弃的问题; 3) 挑战了共享专家和稀疏升级两个先前被认为有效的技术。值得注意的是，OLMoE 在 5.1T token 上训练，远超许多同类模型的数据量——这反映了 AI2 "数据驱动"的开放科学哲学。

---

---

## 2 预训练与适配 (Pretraining and Adaptation)

### 预训练架构 (Pretraining architecture)

OLMOE is a decoder-only LM consisting of NL transformer layers. The feedforward network (FFN) in dense models like OLMo, is replaced with an MoE module consisting of NE smaller FFN modules called experts, of which a subset of k experts is activated for each processed input token x (also see Figure 2):

OLMOE 是一个仅解码器的语言模型，由 $N_L$ 个 Transformer 层组成。像 OLMo 这样的稠密模型中的前馈网络 (FFN) 被替换为 MoE 模块，该模块由 $N_E$ 个较小的 FFN 模块(称为专家)组成，每个处理的输入 token x 激活其中的 k 个专家子集(也见图 2)：

$$
\text{MoE module}(x) = \sum_{i \in \text{Top-}k(r(x))} \text{softmax}(r(x))_i \cdot E_i(x) \tag{1}
$$

where r, called the router, is a learned linear layer mapping from the input logits to the chosen k experts. A softmax is applied to the router outputs to compute routing probabilities for all NE experts. Each selected expert Ei processes the input x, the output of which is then multiplied with its respective routing probability. The results are then summed across all chosen Top-k experts to constitute the output of the MoE module for a single layer of the model out of its NL total layers.

其中 r(称为路由器)是一个学习的线性层，将输入 logits 映射到选定的 k 个专家。对路由器输出应用 softmax 来计算所有 $N_E$ 个专家的路由概率。每个选定的专家 $E_i$ 处理输入 x，其输出然后乘以各自的路由概率。结果在所有选定的 Top-k 专家上求和，构成模型总共 $N_L$ 层中单层的 MoE 模块输出。

> **表 1** 基于我们实验的 OLMOE-1B-7B 关键 MoE 设计选择。OLMOE-1B-7B 的完整配置见附录 B。

| 设计选择 | 描述 | 实验 | OLMOE-1B-7B |
|----------|------|------|---------------|
| 激活参数 | 每个输入 token 的激活参数数量 | §4.1.1 | 1.3B 激活 |
| 总参数 | 模型中的总参数量 | §4.1.1 | 6.9B 总计 |
| 专家粒度 | 使用细粒度小专家 vs. 少数大专家 | §4.1.2 | 64 小专家，激活 8 个 |
| 专家共享 | 是否包含共享专家 | §4.1.3 | 无共享专家 |
| 路由算法 | 输入如何分配给专家 | §4.1.4 | Dropless token choice |
| 稀疏升级 | 是否从稠密模型开始 | §4.1.5 | 未使用 |
| 负载平衡损失 | 惩罚专家分配不均的辅助损失 | §4.1.6 | 使用，权重 0.01 |
| 路由器 z-loss | 惩罚路由器大 logits 的辅助损失 | §4.1.7 | 使用，权重 0.001 |

Key decisions in designing an MoE model include determining the number of activated and total parameters, the design of the experts (e.g., granularity, whether or not to include shared experts), and the choice of the routing algorithm. Moreover, training an MoE model can involve initializing from a dense model (sparse upcycling) and changing the training objective, such as including auxiliary load balancing and router z-losses. Experiments related to these design choices are in §4.1; Table 1 shows our final decisions.

设计 MoE 模型的关键决策包括确定激活参数和总参数的数量、专家的设计(例如粒度、是否包含共享专家)以及路由算法的选择。此外，训练 MoE 模型可能涉及从稠密模型初始化(稀疏升级)和改变训练目标，例如包含辅助负载平衡和路由器 z-loss。与这些设计选择相关的实验见 §4.1; 表 1 展示了我们的最终决策。

In summary, we use 1.3B active parameters out of a total of 6.9B, with 8 activated experts out of 64 per layer. We use dropless token choice routing: For each input token, the learned router network determines 8 experts to process it. We train OLMOE-1B-7B from scratch with two auxiliary losses: load balancing loss ($L_{\text{LB}}$) and router z-loss ($L_{\text{RZ}}$), which we define and experiment with in §4.1.6 and §4.1.7, respectively. We multiply them with respective loss weights, $\alpha$ and $\beta$, and sum them linearly with the cross entropy loss ($L_{\text{CE}}$) to arrive at our final training loss:

总之，我们在总计 69 亿参数中使用 13 亿激活参数，每层 64 个专家中激活 8 个。我们使用 dropless token choice 路由：对于每个输入 token，学习的路由器网络确定 8 个专家来处理它。我们从零开始训练 OLMOE-1B-7B，使用两个辅助损失：负载平衡损失 ($L_{\text{LB}}$) 和路由器 z-loss ($L_{\text{RZ}}$)，我们分别在 §4.1.6 和 §4.1.7 中定义和实验。我们将它们乘以各自的损失权重 $\alpha$ 和 $\beta$，并与交叉熵损失 ($L_{\text{CE}}$) 线性求和，得到最终的训练损失：

$$
L = L_{\text{CE}} + \alpha L_{\text{LB}} + \beta L_{\text{RZ}} \tag{2}
$$

Our full pretraining configuration for OLMOE-1B-7B is in Appendix B.

OLMOE-1B-7B 的完整预训练配置见附录 B。

---

### 预训练数据 (Pretraining data)

We mix data from DCLM and Dolma 1.7, which includes: (1) a quality-filtered subset of Common Crawl, referred to as DCLM-Baseline, (2) StarCoder, Algebraic Stack and arXiv, used in both DCLM and Dolma 1.7, and (3) peS2o and Wikipedia from Dolma 1.7. We refer to our pretraining dataset as OLMOE-MIX.

我们混合来自 DCLM 和 Dolma 1.7 的数据，包括：(1) Common Crawl 的质量过滤子集，称为 DCLM-Baseline，(2) StarCoder、Algebraic Stack 和 arXiv，在 DCLM 和 Dolma 1.7 中都有使用，以及 (3) 来自 Dolma 1.7 的 peS2o 和 Wikipedia。我们将预训练数据集称为 OLMOE-MIX。

To all sources above, we apply a filter that removes all documents with a sequence of 32 or more repeated n-grams, where an n-gram is any span of 1 to 13 tokens. For the StarCoder subset, we also remove any document from a repository with fewer than 2 stars on GitHub, whose most frequent word constitutes over 30% of the document, or whose top-2 most frequent words constitute over 50% of the document.

我们对上述所有来源应用一个过滤器，移除包含 32 个或更多重复 n-gram 序列的所有文档，其中 n-gram 是 1 到 13 个 token 的任意跨度。对于 StarCoder 子集，我们还移除来自 GitHub 上少于 2 个 star 的仓库的任何文档，其最频繁词占文档的 30% 以上，或其前 2 个最频繁词占文档的 50% 以上。

We shuffle all samples randomly at the beginning of each epoch and train for a total of 5.133T tokens (1.3 epochs following Muennighoff et al.). During our annealing phase (final 100B tokens) we first reshuffle the entire dataset and then linearly decay the learning rate to 0, following prior work. Our pretraining data statistics are in Table 2.

我们在每个 epoch 开始时随机打乱所有样本，总共训练 5.133T token(按照 Muennighoff 等人的方法为 1.3 个 epoch)。在退火阶段(最后 100B token)，我们首先重新打乱整个数据集，然后将学习率线性衰减到 0，遵循先前的工作。我们的预训练数据统计见表 2。

> **表 2** OLMOE-1B-7B 预训练数据组成。StarCoder、peS2o 和 Wikipedia 部分来自 Dolma 1.7。数据链接见附录 A。

| 来源 | 文档类型 | 词数 (B) | 文档数 (M) | Token 数 (B) | 字节数 (GB) |
|------|----------|----------|------------|--------------|-------------|
| DCLM-Baseline | 网页 | 3,860 | 3,380 | 16,700 | 2,950 |
| StarCoder | 代码 | 101 | 63.9 | 325 | 78.7 |
| peS2o | STEM 论文 | 57.2 | 51.3 | 268 | 38.8 |
| arXiv | STEM 论文 | 21.1 | 23.5 | 88.8 | 1.55 |
| OpenWebMath | 数学网页 | 12.7 | 10.2 | 42.4 | 2.91 |
| Algebraic Stack | 数学证明代码 | 12.6 | 9.6 | 39.3 | 2.83 |
| English Wikipedia & Wikibooks | 百科全书 | 3.69 | 3.16 | 16.2 | 6.17 |
| **Total** | - | **4,060** | **3,530** | **17,400** | **3,080** |

---

### 适配 (Adaptation)

We create OLMOE-1B-7B-INSTRUCT by following a standard adaptation recipe split into instruction tuning followed by preference tuning building on prior open models. In our instruction tuning dataset, we add more code and math data to boost performance on downstream coding and math applications. Other models, such as GPT-4 and Llama 3 similarly include samples from math datasets like GSM8k or MATH during pretraining. We also include No Robots and a subset of Daring Anteater as they are of high quality and add diversity, two key factors for successful adaptation. We describe our adaptation datasets in Table 3 and hyperparameters in Appendix B.

我们通过遵循标准的适配配方创建 OLMOE-1B-7B-INSTRUCT，该配方分为指令微调，然后是偏好微调，建立在先前的开源模型之上。在我们的指令微调数据集中，我们添加了更多代码和数学数据，以提升下游代码和数学应用的性能。其他模型(如 GPT-4 和 Llama 3)同样在预训练期间包含来自 GSM8k 或 MATH 等数学数据集的样本。我们还包含 No Robots 和 Daring Anteater 的子集，因为它们质量高且增加了多样性——这是成功适配的两个关键因素。我们的适配数据集见表 3，超参数见附录 B。

> **表 3** OLMOE-1B-7B 的适配训练数据。数据链接见附录 A。

| 来源 | 领域 | 样本数 | 训练阶段 |
|------|------|--------|----------|
| Tulu 2 SFT Mix | 各种 | 326,154 | 指令微调 |
| No Robots | 各种 | 9,500 | 指令微调 |
| CodeFeedback-Filtered-Instruction | 代码 | 156,526 | 指令微调 |
| MetaMathQA | 数学 | 98,750 | 指令微调 |
| Advanced (non-chat) subset of Daring Anteater | 各种 | 17,082 | 指令微调 |
| UltraFeedback (filtered for TruthfulQA contamination) | 各种 | 60,800 | 偏好微调 (DPO) |

> 译者注(架构细节): 第 2 节揭示了 OLMoE 的核心架构公式。公式 (1) 是标准的 MoE 前向传播：路由器 r 输出概率分布，Top-k 选择专家，加权求和。公式 (2) 展示了最终训练损失由三部分组成：交叉熵损失 + $\alpha$·负载平衡损失 + $\beta$·路由器 z-loss。负载平衡损失确保专家利用率均衡(防止某些专家被过度使用)，路由器 z-loss 防止路由器输出过大的 logits(避免数值不稳定)。这两个辅助损失是 MoE 训练的标配。表 1 清晰展示了 OLMoE 的 8 项关键设计决策，其中最值得关注的是：1) 64 专家/层的细粒度设计(远超 Mixtral 的 8 专家/层); 2) dropless token choice 路由(避免 token 被丢弃导致信息丢失); 3) 不使用共享专家(挑战了 DeepSeekMoE 的设计); 4) 从零训练而非稀疏升级(挑战了先前认为稀疏升级有效的结论)。

---

---

## 3 结果 (Results)

Our evaluation procedure consists of three parts: During pretraining, After pretraining, and After adaptation. We detail the setup for each in Appendix C.

我们的评测流程包含三个部分：预训练期间、预训练后和适配后。每个部分的详细设置见附录 C。

> **图 3** 预训练期间对 OLMOE-1B-7B 和当前最佳 OLMo 模型的评测。OLMOE-1B-7B 与 OLMo 模型在 MoE 架构、多个训练超参数和训练数据集方面有所不同，见 §2。此图的 token 为 x 轴版本及退火开始标记见附录 E。更多结果、日志和配置：https://wandb.ai/ai2-llm/olmoe/

### 预训练期间 (During pretraining)

In Figure 3 we benchmark the performance of OLMOE-1B-7B during pretraining with the current best OLMo models on commonly used downstream tasks. We find that across all tasks OLMOE-1B-7B reaches better performance with less compute (FLOPs) than the dense OLMo models. OLMOE-1B-7B matches or outperforms OLMo-7B at the end of training despite OLMOE-1B-7B having used less than half as many FLOPs for training and using only 1B active parameters. This is likely a result of the dataset and modeling changes we make to the OLMo setup including MoE-related changes, stability, and performance improvements, outlined in Appendix B. Appendix E contains training and validation loss plots showing very smooth loss curves without major loss spikes during the 5T tokens of our pretraining.

在图 3 中，我们在常用的下游任务上对 OLMOE-1B-7B 预训练期间的性能与当前最佳 OLMo 模型进行基准测试。我们发现，在所有任务上，OLMOE-1B-7B 用更少的计算量(FLOPs)达到了比稠密 OLMo 模型更好的性能。OLMOE-1B-7B 在训练结束时达到与 OLMo-7B 相当或更好的性能，尽管 OLMOE-1B-7B 使用的训练 FLOPs 不到一半，且仅使用 1B 激活参数。这可能是我们对 OLMo 设置所做的数据集和建模更改的结果，包括 MoE 相关更改、稳定性和性能改进，详见附录 B。附录 E 包含训练和验证损失曲线图，显示在 5T token 的预训练期间损失曲线非常平滑，没有重大损失尖峰。

### 预训练后 (After pretraining)

In Table 4 we benchmark OLMOE-1B-7B on common downstream tasks. We find that OLMOE-1B-7B performs best among models that use less than 2B active parameters, making it the most economical option for many use cases of LMs. For larger budgets, Qwen1.5-3B-14B has stronger performance but has more than double the active and total parameters than OLMOE-1B-7B. We find that despite requiring ~6-7x less compute per forward pass, OLMOE-1B-7B outperforms some dense LMs with 7B parameters such as Llama2-7B, but falls short of others like Llama3.1-8B. Figure 1 compares MMLU performance with active parameters, a proxy for the value of a model given its cost, of OLMOE-1B-7B and other LMs. OLMOE-1B-7B is the state of the art in its cost regime.

在表 4 中，我们在常见的下游任务上对 OLMOE-1B-7B 进行基准测试。我们发现，OLMOE-1B-7B 在使用少于 2B 激活参数的模型中表现最佳，使其成为许多语言模型用例中最经济的选择。对于更大的预算，Qwen1.5-3B-14B 具有更强的性能，但其激活参数和总参数都超过 OLMOE-1B-7B 的两倍以上。我们发现，尽管每次前向传播需要的计算量约少 6-7 倍，OLMOE-1B-7B 仍优于某些 7B 参数的稠密语言模型(如 Llama2-7B)，但不及其他模型(如 Llama3.1-8B)。图 1 比较了 OLMOE-1B-7B 与其他语言模型的 MMLU 性能与激活参数的关系(激活参数是模型给定成本下价值的代理指标)。OLMOE-1B-7B 在其成本区间内是最先进的。

> **表 4** 预训练后的 OLMOE-1B-7B 与更大的 MoE 和稠密语言模型对比。我们与在激活参数(约 1B，近似速度和成本)或总参数(约 7B，近似内存需求)方面接近 OLMOE-1B-7B 的稠密语言模型进行比较。模型名称包含四舍五入的参数计数：MoE 为 model-active-total，稠密模型为 model-total。Chall. = Challenge。所有评测均为 5-shot，详见附录 C。
>
> 注：由于 MinerU 转换后的列对齐丢失，以下呈现精简版。完整 18 行 × 7 列见原始技术报告。

| 模型 | 激活参数 | MMLU | HellaSwag | ARC-C | ARC-E | PIQA | WinoG |
|------|---------|------|-----------|-------|-------|------|-------|
| **~7-9B 激活参数** |
| Llama2-7B | 6.7B | 46.2 | 78.9 | 54.2 | 84.0 | 77.5 | 71.7 |
| OLMo-7B (0724) | 6.9B | 54.9 | 80.5 | 68.0 | 85.7 | 79.3 | 73.2 |
| Mistral-7B | 7.3B | 64.0 | 83.0 | 78.6 | 90.8 | 82.8 | 77.9 |
| Llama3.1-8B | 8.0B | 66.9 | 81.6 | 79.5 | 91.7 | 81.1 | 76.6 |
| Gemma2-9B | 9.2B | 70.6 | 87.3 | 89.5 | 95.5 | 86.1 | 78.8 |
| **~2-3B 激活参数** |
| DeepSeek-3B-16B | 2.9B | 45.5 | 80.4 | 53.4 | 82.7 | 80.1 | 73.2 |
| JetMoE-2B-9B | 2.2B | 49.1 | 81.7 | 61.4 | 81.9 | 80.3 | 70.7 |
| Qwen1.5-3B-14B | 2.7B | 62.4 | 80.0 | 77.4 | 91.6 | 81.0 | 72.3 |
| **~1B 激活参数** |
| OLMo-1B (0724) | 1.3B | 32.1 | 67.5 | 36.4 | 53.5 | 74.0 | 62.9 |
| DCLM-1B | 1.4B | 48.5 | 75.1 | 57.6 | 79.5 | 76.6 | 68.1 |
| **OLMOE-1B-7B** | **1.3B** | **54.1** | **80.0** | **62.1** | **84.2** | **79.8** | **70.2** |

### 适配后 (After adaptation)

In Table 5, we benchmark our instruction (SFT) and preference (DPO) tuning of OLMOE-1B-7B. SFT improves our model on all tasks measured. We observe a >10x gain on GSM8k, likely due to our inclusion of additional math data to account for the relatively small amounts of math data during pretraining (§2). DPO helps on most tasks, especially AlpacaEval which aligns with findings from prior work. Our DPO model, which we refer to as OLMOE-1B-7B-INSTRUCT, has the highest average among all models benchmarked. We find it to outperform the chat version of Qwen1.5-3B-14B despite Qwen having >2x more parameters and its pretrained model outperforming OLMOE-1B-7B in Table 4. The 84% score on AlpacaEval also outperforms much larger dense models on the leaderboard, such as Llama2-13B-Chat.

在表 5 中，我们对 OLMOE-1B-7B 的指令微调 (SFT) 和偏好微调 (DPO) 进行基准测试。SFT 在我们测量的所有任务上都提升了模型性能。我们在 GSM8k 上观察到超过 10 倍的提升，这可能是由于我们包含了额外的数学数据来弥补预训练期间数学数据相对较少的问题(§2)。DPO 在大多数任务上都有帮助，特别是 AlpacaEval，这与先前工作的发现一致。我们的 DPO 模型(称为 OLMOE-1B-7B-INSTRUCT)在所有基准测试模型中平均分数最高。我们发现它优于 Qwen1.5-3B-14B 的 chat 版本，尽管 Qwen 的参数多 2 倍以上，且其预训练模型在表 4 中优于 OLMOE-1B-7B。AlpacaEval 上 84% 的分数也优于排行榜上更大的稠密模型，如 Llama2-13B-Chat。

> **表 5** 适配后的 OLMOE-1B-7B 与其他模型对比。JetMoE chat 模型有随机分数因此排除。模型名称包含四舍五入的参数计数。所有评测均为我们自己运行(附录 C)。
>
> 注：由于 MinerU 转换后的列对齐丢失，以下呈现精简版。完整 15 行 × 8 列见原始技术报告。

| 模型 | MMLU | GSM8k | BBH | HumanEval | AlpacaEval | XSTest | IFEval | Avg |
|------|------|-------|-----|-----------|------------|--------|--------|-----|
| OLMo-1B (0724) +DPO | 36.7 | 12.5 | 30.6 | 22.0 | 50.9 | 79.8 | 24.2 | 37.4 |
| OLMo-7B (0724) +DPO | 52.8 | 9.0 | 16.6 | 35.0 | 83.5 | 87.5 | 37.9 | 49.1 |
| JetMoE-2B-9B +SFT | 46.1 | 53.5 | 35.6 | 64.8 | 69.3 | 55.6 | 30.5 | 50.4 |
| DeepSeek-3B-16B +Chat | 48.5 | 46.5 | 40.8 | 70.1 | 74.8 | 85.6 | 32.3 | 57.0 |
| Qwen1.5-3B-14B +Chat | 58.9 | 55.5 | 21.3 | 59.7 | 83.9 | 85.6 | 36.2 | 57.3 |
| **OLMOE-1B-7B** | **49.8** | **3.0** | **33.6** | **22.4** | **-** | **59.7** | **16.6** | **-** |
| **+SFT** | **51.4** | **40.5** | **38.0** | **51.6** | **69.2** | **84.1** | **43.3** | **54.0** |
| **+DPO (INSTRUCT)** | **51.9** | **45.5** | **37.0** | **54.8** | **84.0** | **82.6** | **48.1** | **57.7** |

> 译者注(数据实验): 第 3 节的结果揭示了 OLMOE 的核心竞争力：在 1B 激活参数的成本区间内实现 SOTA。表 4 的关键发现：OLMOE-1B-7B 在 MMLU 上达到 54.1，不仅远超同类 1B 模型(OLMo-1B 32.1、DCLM-1B 48.5)，甚至超过了 7B 的 Llama2-7B(46.2)。表 5 更展示了适配后的惊人提升：SFT 使 GSM8k 从 3.0 飙升到 40.5(13.5 倍提升)，这证明了预训练+适配的两阶段策略对 MoE 同样有效。DPO 进一步将 AlpacaEval 提升到 84.0，超越了 Llama2-13B-Chat。一个有趣的对比是 Qwen1.5-3B-14B：其预训练模型在表 4 中全面优于 OLMOE，但适配后 OLMOE-INSTRUCT 的平均分(57.7)反而超过了 Qwen(57.3)——这说明 OLMOE 的适配配方非常高效，以小博大。

---

---

## 4 替代设计选择的实验 (Experimenting with Alternative Design Choices)

In this section, we present pretraining and adaptation experiments that have led to OLMOE-1B-7B. We group them into experiments on settings specific to Mixture-of-Experts (§4.1), experiments on settings applicable to both dense LMs and MoEs (§4.2), and adaptation experiments (§4.3). In pretraining experiments, we often use MMLU Var, a version of MMLU with varying few-shots and a different format that provides signal earlier during training. We describe our full evaluation setup in Appendix C and provide additional experiments in Appendix F. Each experiment links to a Weights & Biases report with more validation and downstream results, and the full configurations of the runs. To isolate the impact of changes and minimize confounders, we vary only one hyperparameter for each experiment. Nevertheless, due to the large number of hyperparameters, some results may change under different configurations and we cannot guarantee the correctness of each of our hyperparameter choices. Models are not comparable across different experiments, as we vary the base model to incorporate successful findings.

在本节中，我们展示了导致 OLMOE-1B-7B 的预训练和适配实验。我们将它们分为针对混合专家的设置实验(§4.1)、适用于稠密语言模型和 MoE 的设置实验(§4.2)以及适配实验(§4.3)。在预训练实验中，我们经常使用 MMLU Var，这是 MMLU 的一个版本，具有变化的 few-shot 和不同的格式，可在训练早期提供信号。我们的完整评测设置见附录 C，附加实验见附录 F。每个实验链接到一个 Weights & Biases 报告，包含更多验证和下游结果以及运行的完整配置。为了隔离更改的影响并最小化混淆因素，我们在每个实验中只改变一个超参数。然而，由于超参数数量庞大，某些结果可能在不同配置下发生变化，我们无法保证每个超参数选择的正确性。不同实验之间的模型不可比较，因为我们改变基础模型以纳入成功的发现。

---

### 4.1 MoE 特定的预训练设置 (MoE-specific Pretraining Settings)

#### 4.1.1 混合专家 vs. 稠密模型 (Mixture-of-Experts vs. Dense)

Prior work reports various speed-ups of MoEs over dense models: Artetxe et al. report that MoEs require 2-4x less compute to match dense models, MoMa exhibits 2.6x FLOP savings for language tasks, Arctic yields 4x FLOP savings but for very different dense and MoE configurations, and Switch Transformers train 2-7x faster with MoEs but for encoder-decoder models while the other works study decoder-only LMs.

先前的工作报告了 MoE 相对于稠密模型的各种加速：Artetxe 等人报告 MoE 需要 2-4 倍更少的计算量来匹配稠密模型，MoMa 在语言任务上展示了 2.6 倍 FLOP 节省，Arctic 实现了 4 倍 FLOP 节省但针对非常不同的稠密和 MoE 配置，Switch Transformers 使用 MoE 训练速度快 2-7 倍但针对编码器-解码器模型，而其他工作研究仅解码器语言模型。

In Figure 4, we compare MoEs and dense models in a controlled setup. We find that our MoE reaches the performance of the dense model with ~3x fewer tokens equivalent to ~3x less compute measured in FLOPs. However, due to the additional memory overhead of training the MoE with its 7B total parameters, it processes fewer tokens per second than the dense model (23,600 tokens per second per GPU for the MoE vs. 37,500 for dense). Thus, in terms of training time, it reaches the performance of the dense model only ~2x faster. There are likely optimizations possible that would bring the speed-up closer to the 3x token speed-up, which we leave to future work. Based on these results, we select an MoE configuration with 6.9B total and 1.3B active parameters matching OLMo-7B in total and OLMo-1B in active parameter count, respectively.

在图 4 中，我们在受控设置中比较了 MoE 和稠密模型。我们发现，我们的 MoE 用约 3 倍更少的 token(相当于以 FLOPs 衡量的约 3 倍更少的计算量)达到了稠密模型的性能。然而，由于训练具有 70 亿总参数的 MoE 的额外内存开销，它每秒处理的 token 比稠密模型少(MoE 为每 GPU 每秒 23,600 个 token，稠密模型为 37,500)。因此，就训练时间而言，它达到稠密模型性能的速度仅快约 2 倍。可能存在优化可以将加速接近 3 倍的 token 加速，这留待未来工作。基于这些结果，我们选择总参数 69 亿、激活参数 13 亿的 MoE 配置，分别匹配 OLMo-7B 的总参数和 OLMo-1B 的激活参数。

> **图 4** MoE vs. 稠密模型。我们在 128 个 H100 GPU 上训练一个 1.3B 参数的稠密模型和一个 1.3B 激活、6.9B 总参数的 MoE 模型。除 MoE 相关更改外，两者使用相同的配置训练 130B token。MoE 包含 64 个专家，其中 8 个被激活，FFN 维度为 1,024，而稠密模型的 FFN 维度为 8,192。因此两者具有相同数量的激活参数。上图：MoE 用约 3 倍更少的 token(或 FLOPs)达到稠密模型的最终性能。下图：由于一些内存开销，这相当于约 2 倍更快的训练。

#### 4.1.2 专家粒度 (Expert Granularity)

Dai et al. propose to use small fine-grained experts to allow more combinations of experts and thus make the model more flexible. For example, the Mixtral model uses the common configuration of 8 experts per layer, 2 of which are activated. This allows for C(8,2) = 28 combinations per layer. By halving the size of each expert and therefore doubling the number of experts to maintain the same compute and parameter budget, we can increase the possible combinations to C(16,4) = 1,820. Krajewski et al. investigate compute-optimal granularity configurations finding that higher compute budgets warrant more granular experts.

Dai 等人提出使用小的细粒度专家以允许更多专家组合，从而使模型更灵活。例如，Mixtral 模型使用每层 8 个专家的常见配置，其中 2 个被激活。这允许每层 C(8,2) = 28 种组合。通过将每个专家的大小减半，从而将专家数量加倍以保持相同的计算和参数预算，我们可以将可能的组合增加到 C(16,4) = 1,820。Krajewski 等人研究了计算最优粒度配置，发现更高的计算预算需要更多的细粒度专家。

In Figure 5, we observe that more granular experts improve training loss, validation loss, and downstream performance. The 8-expert configuration uses 1 active expert, which yields C(8,1) = 8 combinations. By quartering the size of each expert but increasing the number to 32 with 4 active ones (C(32,4) = 35,960 combinations), we observe an improvement of around 10% on HellaSwag and MMLU at around 130 billion tokens. However, we find that there are diminishing returns to granularity. The additional increase to 64 experts with 8 active ones (C(64,8) = 4,426,165,368 combinations) improves downstream metrics by a smaller amount of 1-2%. For our OLMOE-1B-7B compute budget of 3 x 10^22, Krajewski et al. predict an optimal number of experts of 256. However, their predictions are for compute-optimal models, while we train for 5T tokens, which is orders of magnitude beyond what would be conventionally considered optimal for our model size. Thus, their predictions may not extend to our setup, and we stick with 64 experts for OLMOE-1B-7B, also due to the diminishing returns in Figure 5.

在图 5 中，我们观察到更细粒度的专家改善了训练损失、验证损失和下游性能。8 专家配置使用 1 个激活专家，产生 C(8,1) = 8 种组合。通过将每个专家的大小减为四分之一但将数量增加到 32 个并激活 4 个(C(32,4) = 35,960 种组合)，我们在约 1300 亿 token 时在 HellaSwag 和 MMLU 上观察到约 10% 的改进。然而，我们发现粒度存在收益递减。进一步增加到 64 个专家并激活 8 个(C(64,8) = 4,426,165,368 种组合)仅将下游指标改善了 1-2% 的较小幅度。对于 OLMOE-1B-7B 的 3 x 10^22 计算预算，Krajewski 等人预测最优专家数量为 256。然而，他们的预测是针对计算最优模型，而我们在 5T token 上训练，这远超传统上认为对我们模型大小最优的量级。因此，他们的预测可能不适用于我们的设置，我们坚持为 OLMOE-1B-7B 使用 64 个专家，也由于图 5 中的收益递减。

> **图 5** 专家粒度。我们同时改变专家数量和 FFN 维度以确保激活和总参数以及计算成本保持不变。例如，对于 64 个专家，FFN 维度为 1,024 并激活 8 个专家; 对于 32 个专家，FFN 维度为 2,048 并激活 4 个专家。

#### 4.1.3 共享专家 (Shared Experts)

Dai et al. propose training with a shared/fixed expert that is always used in addition to the routed experts. The intuition is to encourage the shared expert to learn common information and allow the other routed experts to learn more specialized knowledge. This should reduce redundancy among experts and thus lead to a better model as it can store more total information.

Dai 等人提出使用一个共享/固定专家进行训练，该专家始终与路由专家一起使用。直觉是鼓励共享专家学习通用信息，并允许其他路由专家学习更专业化的知识。这应该减少专家之间的冗余，从而使模型更好，因为它可以存储更多总信息。

In Figure 6, we benchmark having a single shared and a single routed expert versus two routed experts. While both settings lead to similar performance, sharing an expert performs slightly worse. Sharing an expert removes flexibility from the model and thus goes against the findings in §4.1.2 suggesting that allowing for more expert combinations improves performance. Specifically, the two models in Figure 6 have C(32,4) = 35,960 and C(31,3) = 4,495 possible combinations per layer. Thus, removing one of the routed experts and turning it into a shared one eliminates almost 90% of possible combinations. This likely acts as a counterforce to the potential benefits of isolating common knowledge in a shared expert. Based on these results, we do not use shared experts in OLMOE-1B-7B, but we do think that there is merit to the idea of experts that are activated more often or even always. However, rather than enforcing this behavior via a shared expert, we believe that it should be learned by the model. This is difficult with current setups due to the necessity of a load balancing loss (§4.1.6) penalizing the model if tokens are not distributed equally among experts. Potential future work can explore removing the load balancing loss to allow for more flexible usage of experts.

在图 6 中，我们对使用一个共享专家和一个路由专家与两个路由专家进行基准测试。虽然两种设置导致相似的性能，但共享专家的表现略差。共享专家消除了模型的灵活性，因此与 §4.1.2 的发现相矛盾，该发现表明允许更多专家组合可以提高性能。具体而言，图 6 中的两个模型每层分别有 C(32,4) = 35,960 和 C(31,3) = 4,495 种可能的组合。因此，移除一个路由专家并将其变为共享专家消除了近 90% 的可能组合。这可能抵消了将通用知识隔离在共享专家中的潜在好处。基于这些结果，我们在 OLMOE-1B-7B 中不使用共享专家，但我们确实认为更频繁甚至始终激活专家的想法有价值。然而，我们认为这应该由模型学习，而不是通过共享专家强制执行。在当前设置中这很困难，因为需要负载平衡损失(§4.1.6)来惩罚 token 未在专家之间均匀分布的情况。潜在的未来工作可以探索移除负载平衡损失以允许更灵活地使用专家。

> **图 6** 共享专家。两种设置具有相同数量的激活和总参数并使用相同数量的 FLOPs。32 个路由专家中激活 4 个，而另一个模型的 31 个路由专家中激活 3 个，因为它有 1 个始终激活的共享专家。

#### 4.1.4 专家选择 vs. Token 选择 (Expert Choice vs. Token Choice)

The MoE router determines which experts process each input token (§2). There are two common types: expert choice (EC) and token choice (TC). For EC, each expert selects a fixed number of tokens from the incoming sequence. By design, this leads to each expert processing the same number of tokens. This is the main benefit of EC as it ensures perfect load balance, which improves training throughput and removes the need for a load balancing loss. The main downside of EC is that it is not easily usable for autoregressive generation where a single token is processed at each step rather than the entire sequence in one. Another potential downside is that EC can lead to token dropping, where some tokens are not selected by any expert, which can hurt performance. At the same time, it can lead to some tokens being processed by multiple experts, which could also be beneficial as it allows the model to allocate more compute to some tokens. For TC, each token selects a fixed number of experts. This can lead to many tokens choosing the same expert, hurting training efficiency. Therefore it is common to use TC with a load balancing loss to encourage equal distribution.

MoE 路由器决定哪些专家处理每个输入 token(§2)。有两种常见类型：专家选择 (EC, Expert Choice) 和 token 选择 (TC, Token Choice)。对于 EC，每个专家从输入序列中选择固定数量的 token。根据设计，这导致每个专家处理相同数量的 token。这是 EC 的主要好处，因为它确保完美的负载平衡，提高训练吞吐并消除对负载平衡损失的需求。EC 的主要缺点是它不容易用于自回归生成，其中每个步骤处理单个 token 而不是一次处理整个序列。另一个潜在缺点是 EC 可能导致 token 丢弃，即某些 token 未被任何专家选择，这可能损害性能。同时，它可能导致某些 token 被多个专家处理，这也可能是有益的，因为它允许模型为某些 token 分配更多计算。对于 TC，每个 token 选择固定数量的专家。这可能导致许多 token 选择同一个专家，损害训练效率。因此，通常使用 TC 配合负载平衡损失来鼓励均匀分布。

In Figure 7, we benchmark EC and TC. We find that TC outperforms EC for the same token budget for all tasks depicted as well as other tasks like PIQA, SciQ, etc. While Zhou et al. find EC to be better, our configuration slightly differs in that we use dropless MoEs with a load balancing loss. Thus, our TC variant is expected to perform better than the TC variant in Zhou et al. We confirm findings that EC runs around 20% faster at 29,400 tokens per second per device versus 24,400 for TC. EC may be more beneficial in a multimodal setup as dropping noisy image tokens is likely less harmful than text tokens. Thus, while we stick with TC for this release of OLMOE, we may revisit EC for future multimodal models.

在图 7 中，我们对 EC 和 TC 进行基准测试。我们发现，对于相同的 token 预算，TC 在所有展示的任务以及其他任务(如 PIQA、SciQ 等)上都优于 EC。虽然 Zhou 等人发现 EC 更好，但我们的配置略有不同，因为我们使用带有负载平衡损失的 dropless MoE。因此，我们的 TC 变体预计比 Zhou 等人中的 TC 变体表现更好。我们确认了 EC 运行速度快约 20%(每台设备每秒 29,400 个 token，而 TC 为 24,400)。EC 在多模态设置中可能更有益，因为丢弃噪声图像 token 可能比文本 token 危害更小。因此，虽然我们在本次 OLMOE 发布中坚持使用 TC，但我们可能会在未来的多模态模型中重新考虑 EC。

> **图 7** 专家选择 (EC) vs. token 选择 (TC)。两个模型都在每第 2 层有一个 8 专家 MoE。对于 TC，每个 token 激活 2 个专家; 对于 EC，容量因子为 2。因此两个模型使用相同数量的激活参数。

#### 4.1.5 稀疏升级 (Sparse Upcycling)

Komatsuzaki et al. propose turning a dense model into a Mixture-of-Experts model via sparse upcycling: (1) The dense MLP is cloned for each desired expert to constitute MoE layers. (2) A newly initialized router is added in front of each MoE layer. (3) Pretraining continues with the new model so that the cloned MLPs can gradually specialize in different things and the router can be learned. They find that the upcycling approach maintains a performance advantage over a language model trained from scratch for up to 120% of the compute budget of the original dense checkpoint that the sparse model was upcycled from.

Komatsuzaki 等人提出通过稀疏升级将稠密模型转变为混合专家模型：(1) 为每个期望的专家克隆稠密 MLP 以构成 MoE 层。(2) 在每个 MoE 层前添加一个新初始化的路由器。(3) 继续用新模型预训练，使克隆的 MLP 逐渐专业化于不同事物，路由器可以被学习。他们发现，升级方法在相对于原始稠密检查点(稀疏模型从中升级)的计算预算的 120% 以内，保持对从零训练的语言模型的性能优势。

In Figure 8, we compare sparse upcycling OLMo-1B (0724) with training an MoE from scratch. We find that after 500B tokens, an otherwise equivalent MoE trained from scratch already catches up with the upcycled model, both on the metrics in Figure 8 and our additional metrics. At around 600B tokens, the MoE from scratch starts outperforming the upcycled MoE. Thus, it only requires 25% of the compute budget of the original dense model to catch up as opposed to the 120% reported in Komatsuzaki et al. However, they use expert choice routing and study encoder-decoder models. Meanwhile, we use token choice routing (§4.1.4) and decoder-only models (§2). Further, we upcycle a model that has already been significantly overtrained, i.e., a 1B model trained for 2T tokens. Its parameters are likely already in a very optimal range for a dense model, which may limit the amount of additional exploration possible after upcycling. This motivates us to experiment with adding noise to the upcycled weights outlined in Appendix F, but we do not find it to lead to better performance. A large disadvantage of upcycling is that the upcycled MoE is constrained by some hyperparameters of the dense model. Specifically, OLMo-1B (0724) was trained without QK-Norm and normal initialization, both of which hurt stability in our experiments (§4.2.5, §4.2.2). While it may be possible to simply add new QK-Norms and train them from scratch similar to the new router layer trained from scratch, it is impossible to change the initialization of the original dense model when upcycling it. Thus, as we want to change these hyperparameters and also train OLMOE-1B-7B for around 250% of the compute budget of the dense model (5T vs. 2T tokens), we do not use upcycling.

在图 8 中，我们将稀疏升级 OLMo-1B (0724) 与从零训练 MoE 进行比较。我们发现，在 500B token 后，一个其他方面等效的从零训练的 MoE 已经赶上了升级模型，无论是在图 8 的指标上还是我们的附加指标上。在大约 600B token 时，从零训练的 MoE 开始超越升级的 MoE。因此，它只需要原始稠密模型计算预算的 25% 就能赶上，而不是 Komatsuzaki 等人报告的 120%。然而，他们使用专家选择路由并研究编码器-解码器模型。同时，我们使用 token 选择路由(§4.1.4)和仅解码器模型(§2)。此外，我们升级了一个已经显著过度训练的模型，即在 2T token 上训练的 1B 模型。其参数可能已经在稠密模型的非常最优范围内，这可能限制了升级后可能的额外探索量。这促使我们尝试向升级权重添加噪声(概述见附录 F)，但我们发现这并不能带来更好的性能。升级的一个重大缺点是升级的 MoE 受稠密模型某些超参数的约束。具体而言，OLMo-1B (0724) 在没有 QK-Norm 和普通初始化的情况下训练，这两者都在我们的实验中损害了稳定性(§4.2.5、§4.2.2)。虽然可能可以简单地添加新的 QK-Norm 并从零训练它们(类似于从零训练的新路由器层)，但在升级时不可能改变原始稠密模型的初始化。因此，由于我们想要更改这些超参数，并且还要为 OLMOE-1B-7B 训练约稠密模型计算预算的 250%(5T vs. 2T token)，我们不使用升级。

> **图 8** 稀疏升级。我们在 2T token 时将 OLMo-1B (0724) 升级为具有 8 个总专家(其中 2 个被激活)的 MoE，并额外训练 610B token。我们将其与从零训练 610B token 的模型进行比较。除这一差异外，两个模型使用相同的配置。

#### 4.1.6 负载平衡损失 (Load Balancing Loss)

Shazeer et al. propose the load balancing loss to penalize the model if it is unbalanced, i.e., if it routes all tokens to only a few experts. This is based on the observation that without such penalty, models tend to update only a select few experts in each layer. To compute the load balancing loss ($L_{\text{LB}}$) we multiply the fraction of tokens $f_i$ routed to one expert $E_i$ with the total routing probability $P_i$ allocated to $E_i$ for one batch and sum it across the number of experts $N_E$:

Shazeer 等人提出负载平衡损失来惩罚模型如果它不平衡，即如果它将所有 token 路由到仅少数几个专家。这是基于观察：如果没有这样的惩罚，模型倾向于只更新每层中少数几个专家。为了计算负载平衡损失 ($L_{\text{LB}}$)，我们将路由到一个专家 $E_i$ 的 token 比例 $f_i$ 与分配给 $E_i$ 的总路由概率 $P_i$ 相乘，并在专家数量 $N_E$ 上求和：

$$
L_{\text{LB}} = N_E \cdot \sum_{i=1}^{N_E} f_i \cdot P_i \tag{3}
$$

The loss is further scaled by $N_E$ and a loss weight $\alpha$ (see Equation 2), which is an optional weight to determine the magnitude of the loss commonly set to 0.01. We do not experiment with changing the weight of 0.01.

损失进一步按 $N_E$ 和损失权重 $\alpha$ 缩放(见公式 2)，这是一个可选权重，用于确定损失的幅度，通常设置为 0.01。我们没有尝试改变 0.01 的权重。

In Figure 9 we investigate the performance impact of using the auxiliary load balancing loss. We find that across training loss and validation losses, using the load balancing loss leads to better performance even after only a few billion tokens. We still measure the load balancing loss even when it is not used ("No LBL") and find that while it spikes initially, it slowly decreases over the next few billion tokens. This behavior is also visible in Figure 10 (left), where initially all tokens in the first layer are assigned to the 6th expert. Eventually, the model also starts assigning some tokens to the 1st expert. However, all other experts remain largely flat and are thus "dead weights" that take up GPU memory but are not used. Given these results, we use the auxiliary load balancing loss with a weight of 0.01 following prior work. However, getting rid of the load balancing loss is an important direction for future research as it constrains the flexibility of the model by forcing it to use all experts approximately equally. This could prevent the experts from specializing in certain data domains and may be a reason prior work has failed to find strong evidence of expert specialization.

在图 9 中，我们研究了使用辅助负载平衡损失的性能影响。我们发现，在训练损失和验证损失方面，即使仅在几十亿 token 后，使用负载平衡损失也能带来更好的性能。即使不使用负载平衡损失("No LBL")，我们仍然测量它，发现虽然它最初会尖峰，但在接下来的几十亿 token 中缓慢下降。这种行为在图 10(左)中也可见，其中最初第一层的所有 token 都被分配给第 6 个专家。最终，模型也开始将一些 token 分配给第 1 个专家。然而，所有其他专家基本保持平坦，因此是占用 GPU 内存但未被使用的"死权重"。鉴于这些结果，我们遵循先前的工作使用权重为 0.01 的辅助负载平衡损失。然而，摆脱负载平衡损失是未来研究的一个重要方向，因为它通过强制模型大致均匀地使用所有专家来约束模型的灵活性。这可能阻止专家在特定数据域中专业化，也可能是先前工作未能找到专家专业化强证据的原因。

> **图 9** 应用负载平衡损失 (LBL) 的影响。训练损失图排除了两个模型的负载平衡损失。

> **图 10** 使用或不使用负载平衡损失时训练期间的专家分配。针对第一个 MoE 层。

#### 4.1.7 路由器 Z-loss (Router Z-loss)

Zoph et al. propose the router z-loss to improve both the stability and quality of MoE models. This auxiliary loss penalizes large logits coming into the gating network. Such large logits can lead to numeric overflows in the large matrix multiplications happening in the MoE layer. It is computed by exponentiating the logits $x_j$ right before the router layer summed across the number of experts $N_E$ and averaged across the batch $B$, thereby making larger logits lead to a larger loss:

Zoph 等人提出路由器 z-loss 来改善 MoE 模型的稳定性和质量。这个辅助损失惩罚进入门控网络的大 logits。如此大的 logits 可能导致 MoE 层中大矩阵乘法中的数值溢出。它通过将路由器层之前的 logits $x_j$ 取指数，在专家数量 $N_E$ 上求和，并在批次 $B$ 上取平均来计算，从而使更大的 logits 导致更大的损失：

$$
L_{\text{RZ}}(x) = \frac{1}{B} \sum_{i=1}^{B} \left( \log \sum_{j=1}^{N_E} \exp(x_j^{(i)}) \right)^2 \tag{4}
$$

The loss is further multiplied with an optional loss weight, $\beta$ (see Equation 2), to determine the magnitude of the loss commonly set to 0.001. We do not experiment with changing the weight of 0.001.

损失进一步乘以可选的损失权重 $\beta$(见公式 2)，以确定通常设置为 0.001 的损失幅度。我们没有尝试改变 0.001 的权重。

In Figure 11, we confirm that across training loss, validation loss, and downstream performance adding the router z-loss improves stability (less spikes) and quality (lower loss and higher downstream performance). Thus, despite it reducing throughput by ~2% we use the router z-loss for OLMOE-1B-7B with a weight of 0.001 as in Zoph et al.

在图 11 中，我们确认，在训练损失、验证损失和下游性能方面，添加路由器 z-loss 提高了稳定性(更少的尖峰)和质量(更低的损失和更高的下游性能)。因此，尽管它将吞吐降低了约 2%，我们仍为 OLMOE-1B-7B 使用权重为 0.001 的路由器 z-loss，与 Zoph 等人一致。

> **图 11** 路由器 z-loss。我们比较添加权重为 0.001 的路由器 z-loss 与无额外 z-loss。

> 译者注(数据实验): 第 4.1 节的 7 项消融实验构成了 OLMoE 的核心设计决策。值得注意的发现：1) MoE 比稠密模型训练快 ~2 倍(时间)到 ~3 倍(FLOPs)，但内存开销是瓶颈; 2) 专家粒度从 8 增加到 32 带来约 10% 的显著改进，但从 32 到 64 仅 1-2%，说明收益递减; 3) 共享专家实际上损害了性能(减少 90% 的组合灵活性)，挑战了 DeepSeekMoE 的核心假设; 4) Token Choice 优于 Expert Choice，但 EC 速度快 20%——这是质量与速度的权衡; 5) 稀疏升级的收益被高估：从零训练仅需 25% 的计算预算就能赶上，而非先前声称的 120%; 6) 负载平衡损失至关重要(防止"死权重"专家)，但也是专家专业化的障碍; 7) 路由器 z-loss 以 2% 的吞吐代价换取更好的稳定性和质量。这些发现中，共享专家无效和稀疏升级收益有限两项最具颠覆性，直接挑战了先前 MoE 领域的共识。

---

---

### 4.2 通用预训练设置 (General Pretraining Settings)

#### 4.2.1 数据集实验 (Dataset Experiments)

Li et al. release the DCLM-Baseline dataset and establish that it leads to better language models than Dolma 1.7 and other datasets as measured on common benchmarks like MMLU. This motivates us to mix their DCLM dataset with some components from Dolma 1.7 that we deem to be high-quality; see §2. In Figure 12, we compare our mix, OLMOE-MIX, with Dolma 1.7 in a controlled setup. We find that OLMOE-MIX leads to clear gains on all three downstream metrics, especially MMLU. DCLM-Baseline has been created through a series of dataset ablations targeting MMLU and other downstream metrics, which explains these results. We also compare adding Reddit and FLAN to our mix as detailed in Appendix F, but do not find consistent performance gains. We do not have a strong intuition for why adding these datasets does not help and a more automatic approach to dataset mixing may be desirable for future iterations. We pretrain using our mix of DCLM-Baseline and Dolma 1.7 dubbed OLMOE-MIX.

Li 等人发布了 DCLM-Baseline 数据集，并证明它在 MMLU 等常见基准测试上比 Dolma 1.7 和其他数据集产生更好的语言模型。这促使我们将他们的 DCLM 数据集与我们认为高质量的 Dolma 1.7 的一些组件混合; 见 §2。在图 12 中，我们在受控设置中比较了我们的混合数据集 OLMOE-MIX 与 Dolma 1.7。我们发现 OLMOE-MIX 在所有三个下游指标上都有明显提升，特别是 MMLU。DCLM-Baseline 是通过一系列针对 MMLU 和其他下游指标的数据集消融创建的，这解释了这些结果。我们还尝试向我们的混合中添加 Reddit 和 FLAN(详见附录 F)，但没有发现一致的性能提升。我们没有强烈的直觉来解释为什么添加这些数据集没有帮助，未来迭代可能需要更自动化的数据集混合方法。我们使用 DCLM-Baseline 和 Dolma 1.7 的混合数据集(称为 OLMOE-MIX)进行预训练。

> **图 12** OLMOE-MIX vs. Dolma 1.7。我们将 §2 中描述的数据混合与用于训练先前 OLMo 模型的 Dolma 1.7 进行比较。较低的训练损失并不意味着一个数据集更好，而是表明哪个数据集对模型来说更容易学习。

#### 4.2.2 初始化 (Initialization)

Few prior works on Mixture-of-Experts share their initialization strategy. Even the most open MoEs prior to this work, JetMoE and OpenMoE, do not mention their initialization scheme. For DeepSeekMoE and DeepSeekV2, the authors share that they use a normal initialization with a standard deviation (std) of 0.006. For dense language models, a normal initialization with an std of 0.02 has been commonly used as popularized by Shoeybi et al.

关于混合专家的先前工作很少分享它们的初始化策略。即使是这项工作之前最开放的 MoE(JetMoE 和 OpenMoE)，也没有提及它们的初始化方案。对于 DeepSeekMoE 和 DeepSeekV2，作者分享他们使用标准差 (std) 为 0.006 的普通初始化。对于稠密语言模型，标准差为 0.02 的普通初始化已被广泛使用，如 Shoeybi 等人推广的那样。

In Figure 13, we find a truncated normal initialization leads to more stable training and better performance than a regular normal initialization. The difference between the two initializations only becomes clear at around 450 billion tokens, where the model with the normal initialization starts to diverge. This is despite both models using the same configuration except for the difference in weight initialization. Having to train for hundreds of billions of tokens until an experiment provides a clear signal is one of the key challenges of pretraining ablations. We use the truncated normal initialization for OLMOE-1B-7B.

在图 13 中，我们发现截断正态初始化比普通正态初始化带来更稳定的训练和更好的性能。两种初始化之间的差异仅在约 4500 亿 token 时才变得明显，此时使用普通正态初始化的模型开始发散。尽管两个模型使用相同的配置，除了权重初始化的差异。必须训练数千亿 token 直到实验提供明确信号，这是预训练消融的关键挑战之一。我们为 OLMOE-1B-7B 使用截断正态初始化。

> **图 13** 初始化。我们比较标准差 (std) 为 0.02 的普通初始化与最大(最小)截断为 0.06(-0.06)的截断正态初始化(对应三个 std)。

#### 4.2.3 RMSNorm

OLMo uses non-parametric layer normalization, mainly as it is significantly faster than the commonly used RMSNorm. This is an unusual choice as most LMs use RMSNorm, such as the Llama, Gemma, and Qwen model families. In Figure 14, we observe that replacing the non-parametric layer normalization in OLMo with a parametric RMSNorm leads to better performance. This is likely because the non-parametric layer normalization leads to a large number of spikes in the gradients as seen in Figure 16. We clip gradients at 1.0, which prevents these spikes from leading to very large and potentially disruptive parameter updates. However, the clipped gradients may still harm the performance of the model as they are no longer the true gradients. Thus, despite RMSNorm lowering our training throughput by 15%, we train our final model with RMSNorm. We include the RMSNorm parameters in weight decay as we find that it performs slightly better even though it is common practice to exclude them.

OLMo 使用非参数化层归一化，主要是因为它比常用的 RMSNorm 快得多。这是一个不寻常的选择，因为大多数语言模型使用 RMSNorm，如 Llama、Gemma 和 Qwen 模型家族。在图 14 中，我们观察到将 OLMo 中的非参数化层归一化替换为参数化 RMSNorm 会带来更好的性能。这可能是因为非参数化层归一化导致梯度中出现大量尖峰，如图 16 所示。我们将梯度裁剪为 1.0，这防止这些尖峰导致非常大且可能具有破坏性的参数更新。然而，裁剪的梯度仍可能损害模型性能，因为它们不再是真实的梯度。因此，尽管 RMSNorm 将我们的训练吞吐降低了 15%，我们仍使用 RMSNorm 训练最终模型。我们将 RMSNorm 参数包含在权重衰减中，因为我们发现它的表现略好，尽管通常的做法是将它们排除在外。

> **图 14** 非参数化层归一化 vs. RMSNorm。

> **图 16** 使用 RMS 或非参数化归一化训练时的梯度总范数。

#### 4.2.4 衰减嵌入参数 (Decaying Embedding Parameters)

Similar to the RMSNorm parameters (§4.2.3), embedding parameters are commonly excluded from weight decay. In Figure 17 we find that whether or not they are decayed has only a minor impact on performance, with decaying being slightly better. Thus for simplicity, we weight decay all parameters in OLMOE-1B-7B including embedding and RMSNorm.

与 RMSNorm 参数(§4.2.3)类似，嵌入参数通常被排除在权重衰减之外。在图 17 中，我们发现无论是否衰减它们，对性能的影响都很小，但衰减略好。因此为简单起见，我们对 OLMOE-1B-7B 中的所有参数进行权重衰减，包括嵌入和 RMSNorm。

> **图 15** 衰减 RMSNorm 参数。

> **图 17** 衰减嵌入参数。

#### 4.2.5 QK-Norm

Some works have reported stability improvements from adding layer normalization after the query and key projections ("QK-Norm"). QK-Norm can prevent the subsequent attention operation from leading to very large logits that may lead to numeric overflows and destabilize the network, especially when training in low precision. Like layer normalization at other places in the model, the QK-Norm could be non-parametric or use the parametric RMSNorm (§4.2.3).

一些工作报告了在 query 和 key 投影后添加层归一化("QK-Norm")带来的稳定性改进。QK-Norm 可以防止随后的注意力操作产生非常大的 logits，这可能导致数值溢出并使网络不稳定，特别是在低精度训练时。与模型中其他位置的层归一化一样，QK-Norm 可以是非参数化的或使用参数化 RMSNorm(§4.2.3)。

In Figure 18, we compare using QK-Norm with no normalization after the query and key projections. We find that QK-Norm leads to some stability and performance improvements. We perform this experiment with non-parametric layer normalization as used in OLMo, while we used parametric RMS layer normalization for OLMOE-1B-7B (§4.2.3). To ensure the benefit of QK-Norm is not an artifact of comparing with non-parametric layer normalization, we run another experiment with RMS layer normalization and still find QK-Norm to lead to slightly better training loss and to prevent a large grad norm spike. Thus, we use QK-Norm for OLMOE-1B-7B despite it reducing throughput by almost 10%.

在图 18 中，我们比较了使用 QK-Norm 与在 query 和 key 投影后不使用归一化。我们发现 QK-Norm 带来一些稳定性和性能改进。我们使用 OLMo 中使用的非参数化层归一化进行此实验，而为 OLMOE-1B-7B 使用参数化 RMS 层归一化(§4.2.3)。为确保 QK-Norm 的好处不是与非参数化层归一化比较的人工产物，我们用 RMS 层归一化运行了另一个实验，仍然发现 QK-Norm 带来略好的训练损失并防止大的梯度范数尖峰。因此，尽管 QK-Norm 将吞吐降低近 10%，我们仍为 OLMOE-1B-7B 使用 QK-Norm。

> **图 18** Query-Key 层归一化 (QK-Norm)。两个模型都使用非参数化层归一化。QK-Norm 对应于对 query 和 key 投影的额外层归一化。

#### 4.2.6 AdamW Epsilon

Groeneveld et al. use an epsilon ("eps") value of 1E-05 in the AdamW optimizer for training OLMo. A larger eps value leads to smaller steps of the optimizer but can be more stable. In Figure 19, we find that decreasing eps to the recommended default of 1E-08 significantly improves performance while the run remains stable. Thus, we set eps to 1E-08 for our final run.

Groeneveld 等人在训练 OLMo 的 AdamW 优化器中使用 epsilon ("eps") 值 1E-05。较大的 eps 值导致优化器的步长更小，但可能更稳定。在图 19 中，我们发现将 eps 降低到推荐的默认值 1E-08 显著改善了性能，同时运行保持稳定。因此，我们将最终运行的 eps 设置为 1E-08。

> **图 19** AdamW epsilon。

---

### 4.3 适配设置 (Adaptation Settings)

We experiment with small design choices for adaptation using our evaluation setup described in Appendix C.

我们使用附录 C 中描述的评测设置对适配的小设计选择进行实验。

**(1) Auxiliary losses**: Zoph et al. find that using the auxiliary load balancing loss (§4.1.6) during regular finetuning leads to small performance gains. For instruction tuning, however, Shen et al. do not find conclusive evidence in favor of using the load balancing or router z-loss with only small differences in performance, both in support of and against the auxiliary losses. In Table 7 we display experiments with the load balancing loss during adaptation and find that not using it leads to better performance (54.0 vs. 52.8 after instruction tuning (SFT) and 57.7 vs. 57.1 after preference tuning (DPO)). One potential problem of deactivating the load balancing loss is that it may harm balance among experts and turn some into dead weights as observed during pretraining in §4.1.6. However, when measuring the load balancing loss in Table 6 on our SFT data (§2), we find that the loss actually decreases slightly during SFT (12.16 vs. 12.22). This is likely because which experts certain tokens get routed to is determined early during pretraining, as we find later in the analysis section (§5.1). We also visualize the activation patterns of experts of the model after pretraining, and the models after SFT and DPO trained without load balancing in Appendix G (Figure 33) finding that the distribution remains around the same. Thus, as our models adapted without load balancing perform better and we find it not to impact routing substantially, we do not use load balancing during adaptation.

**(1) 辅助损失**：Zoph 等人发现在常规微调期间使用辅助负载平衡损失(§4.1.6)会带来小的性能提升。然而，对于指令微调，Shen 等人没有发现使用负载平衡或路由器 z-loss 的有利的确凿证据，性能差异很小，既有支持也有反对辅助损失的。在表 7 中，我们展示了适配期间使用负载平衡损失的实验，发现不使用它会导致更好的性能(指令微调 (SFT) 后 54.0 vs. 52.8，偏好微调 (DPO) 后 57.7 vs. 57.1)。停用负载平衡损失的一个潜在问题是它可能损害专家之间的平衡，并使一些专家变成死权重，如 §4.1.6 中预训练期间观察到的。然而，当我们在表 6 中在 SFT 数据(§2)上测量负载平衡损失时，我们发现损失在 SFT 期间实际上略有下降(12.16 vs. 12.22)。这可能是因为某些 token 被路由到哪些专家是在预训练早期确定的，如我们在后续分析部分(§5.1)中发现的那样。我们还在附录 G(图 33)中可视化了预训练后模型的专家激活模式，以及不使用负载平衡训练的 SFT 和 DPO 后的模型，发现分布基本保持不变。因此，由于我们的模型在不使用负载平衡的情况下适配性能更好，且我们发现它对路由影响不大，我们在适配期间不使用负载平衡。

> **表 6** 负载平衡损失(公式 3)在各自语料子集上的值(在使用负载平衡损失权重 $\alpha$ 缩放之前)。虽然我们在预训练期间使用负载平衡损失，但在 SFT 期间不使用。

| 数据 | 预训练后 | SFT 后 |
|------|---------|--------|
| SFT 数据 | 12.22 | 12.16 |
| Github | 13.85 | 14.85 |
| Wikipedia | 14.48 | 14.24 |
| C4 | 9.09 | 9.13 |

**(2) Annealing checkpoint**: We also experiment with using the checkpoint pre-annealing (§2) for adaptation and find the checkpoint post-annealing leads to better performance (53.8 vs. 54.0 after SFT and 56.3 vs 57.7 after DPO), thus we use the post-annealing checkpoint.

**(2) 退火检查点**：我们还尝试使用退火前检查点(§2)进行适配，发现退火后检查点带来更好的性能(SFT 后 53.8 vs. 54.0，DPO 后 56.3 vs. 57.7)，因此我们使用退火后检查点。

**(3) Preference algorithm**: Since the release of DPO (Direct Preference Optimization), a variety of preference algorithms have been proposed. We experiment with KTO and find that it matches DPO in Table 7 for our setup (Appendix B). While we release both models, we use DPO for our final OLMOE-1B-7B-INSTRUCT model, as it scores higher on AlpacaEval, which has a smaller chance of data contamination than our other benchmarks.

**(3) 偏好算法**：自 DPO(直接偏好优化)发布以来，各种偏好算法被提出。我们尝试 KTO 并发现在表 7 中它对我们的设置与 DPO 匹配(附录 B)。虽然我们发布了两个模型，但我们为最终的 OLMOE-1B-7B-INSTRUCT 模型使用 DPO，因为它在 AlpacaEval 上得分更高，而 AlpacaEval 的数据污染概率比我们的其他基准测试更小。

> **表 7** 适配期间的消融实验。我们比较退火、负载平衡损失和偏好算法。完整配置见附录 B。

| 配置 | MMLU | GSM8k | BBH | HumanEval | AlpacaEval | XSTest | IFEval | Avg |
|------|------|-------|-----|-----------|------------|--------|--------|-----|
| w/o annealing +SFT | 50.2 | 43.0 | 35.6 | 55.5 | 68.9 | 83.8 | 39.7 | 53.8 |
| w/o annealing +DPO | 50.9 | 36.0 | 35.8 | 58.8 | 81.7 | 83.2 | 47.9 | 56.3 |
| **+SFT (annealed)** | **51.4** | **40.5** | **38.0** | **51.6** | **69.2** | **84.1** | **43.3** | **54.0** |
| **+DPO (annealed)** | **51.9** | **45.5** | **37.0** | **54.8** | **84.0** | **82.6** | **48.1** | **57.7** |
| +KTO (annealed) | 51.2 | 45.5 | 34.1 | 57.1 | 81.6 | 86.6 | 47.5 | 57.7 |
| +SFT (load balancing) | 50.9 | 36.5 | 35.7 | 52.4 | 66.9 | 84.8 | 42.3 | 52.8 |
| +DPO (load balancing) | 51.1 | 42.5 | 39.3 | 55.6 | - | - | - | - |

> 译者注(工程细节): 第 4.2 节的 6 项通用设置消融揭示了几个关键工程决策：1) 数据集选择至关重要——DCLM-Baseline 混合优于 Dolma 1.7，特别是在 MMLU 上; 2) 截断正态初始化优于普通初始化，但差异在 450B token 后才显现，说明预训练消融需要极长时间才能获得信号; 3) RMSNorm 虽降低 15% 吞吐，但消除了非参数化层归一化的梯度尖峰问题; 4) QK-Norm 以 10% 吞吐代价换取稳定性; 5) AdamW eps 从 1E-05 降到 1E-08 显著改善性能。第 4.3 节的适配实验则表明：退火后检查点优于退火前(DPO 后 57.7 vs 56.3)，不使用负载平衡损失优于使用(DPO 后 57.7 vs 57.1)，KTO 与 DPO 性能相当但 DPO 在 AlpacaEval 上更高。这些微调层面的决策虽然影响不如架构层面显著，但累积起来可以产生 1-2 个百分点的平均提升——在竞争激烈的开源模型排行榜上，这往往就是 SOTA 与第二名的差距。

---

[待续: 第 5 节 MoE Analysis 及后续章节将在后续交互中继续翻译]

## 5 MoE Analysis
### MoE 分析

By advancing open and cost-efficient models (§1), OLMOE-1B-7B enables new research into LMs and MoEs. Making use of our released intermediate checkpoints, data, and code, we define and analyze four properties specific to MoEs: Router saturation (§5.1), Expert co-activation (§5.2), Domain specialization (§5.3), and Vocabulary specialization (§5.4).

通过推进开放且成本高效的模型(§1)，OLMOE-1B-7B 为语言模型和 MoE 的研究开辟了新方向。借助我们发布的中间检查点、数据和代码，我们定义并分析了 MoE 特有的四种性质：路由饱和(§5.1)、专家共激活(§5.2)、领域专业化(§5.3)和词汇专业化(§5.4)。

### 5.1 Router Saturation
#### 路由饱和

We define router saturation as the proportion of expert activations at some intermediary checkpoint at time t that matches the expert IDs activated at some final checkpoint over the same dataset:

我们将路由饱和定义为：在某个中间检查点 t 时刻的专家激活，与同一数据集上最终检查点的专家 ID 匹配的比例：

$$
\text{Router Saturation}(t) = \frac{1}{N} \sum_{i=1}^{N} \frac{|E_i^{(t)} \cap E_i^{(T)}|}{k}, \tag{5}
$$

where:

- N: The total number of tokens in the dataset.
- k: The number of top-k experts activated per input token. While we train with k = 8 (§2), we also analyze k = 1 by only looking at the expert with the highest routing probability.
- E_i^(t): The set of k experts activated for the ith token at the tth checkpoint.
- E_i^(T): The set of k experts activated for the ith token at the final checkpoint T.
- |E_i^(t) ∩ E_i^(T)|: The number of common experts activated for the ith token between the tth and final checkpoints.

其中：

- N：数据集中的总 token 数。
- k：每个输入 token 激活的 top-k 专家数量。虽然我们用 k = 8 训练(§2)，但也分析 k = 1 的情况，即只看路由概率最高的那个专家。
- E_i^(t)：第 t 个检查点上第 i 个 token 激活的 k 个专家集合。
- E_i^(T)：最终检查点 T 上第 i 个 token 激活的 k 个专家集合。
- |E_i^(t) ∩ E_i^(T)|：第 i 个 token 在中间检查点与最终检查点之间共同激活的专家数量。

Router saturation thus corresponds to whether the router weights are still learning which expert will process certain data. A value of 100% indicates that the router at the intermediate checkpoint will route to the same experts as the final checkpoint router. However, even at 100% saturation the router weight can still change and adapt the exact router probability for each expert. These probabilities are used to scale the output of the respective expert in the model. For OLMOE-1B-7B with its 64 experts, random routing equals a saturation of 1/64 = 1.6% for k = 1 and 8/64 = 12.5% for k = 8.

路由饱和反映了路由权重是否仍在学习将特定数据分配给哪个专家。100% 的饱和值表示中间检查点的路由与最终检查点的路由完全一致。但即使在 100% 饱和时，路由权重仍可能继续变化，调整每个专家的精确路由概率。这些概率用于缩放模型中相应专家的输出。对于具有 64 个专家的 OLMOE-1B-7B，随机路由对应的饱和值为：k = 1 时是 1/64 = 1.6%，k = 8 时是 8/64 = 12.5%。

In Figure 20 we find that after 1% of pretraining (5000 steps or 20B tokens), up to ~60% of routing to the top-8 activated experts has already saturated (right). Thus the model already uses the same 8 experts for given input data as it will at the end of pretraining. This early saturation aligns with prior work [199]. At 40% of pretraining, saturation reaches up to ~80%. However, which top-1 expert has the highest routing probability saturates slower (left). We find that routing in later layers saturates earlier during pretraining. Layer 0 is an outlier saturating significantly more slowly than other layers. Dai et al. [39] do not use an MoE in the first layer as they find that load balancing converges more slowly for the first layer. This is likely linked to our findings on saturation. Because routing in the first layer saturates slower, the experts that certain input data get routed to frequently change. These changes may lead to one expert suddenly getting significantly more data than others thereby impairing load balancing. We are excited about future work further investigating what happens in the first layer by building on our open release.

图 20 显示，在预训练的 1% 之后(5000 步或 20B token)，top-8 激活专家的路由已有约 60% 达到饱和(右图)。这说明模型在预训练初期就已经对给定输入数据使用了与最终相同的 8 个专家。这种早期饱和与先前工作 [199] 一致。在预训练的 40% 处，饱和率达到约 80%。然而，哪个 top-1 专家具有最高路由概率的饱和则慢得多(左图)。我们发现，越靠后的层在预训练中越早饱和。第 0 层是个例外，饱和速度明显慢于其他层。Dai 等人 [39] 不在第一层使用 MoE，因为他们发现第一层的负载平衡收敛更慢。这可能与我们的饱和发现有关。由于第一层的路由饱和更慢，特定输入数据被路由到的专家会频繁变化。这些变化可能导致某个专家突然获得远超其他专家的数据量，从而损害负载平衡。我们期待未来基于我们的开放发布进一步研究第一层中发生的现象。

> 图 20 描述：预训练期间的路由饱和，在 C4 验证集随机 0.5% 数据上测量。通过将四个中间检查点(预训练的 1%、10%、20%、40%)的 top-k 专家路由与最终检查点(公式 5)比较来计算饱和率。左图为 top-k=1，右图为 top-k=8，横轴为层 ID(0-15)，纵轴为路由饱和率(%)。可见 top-8 饱和率显著高于 top-1，且深层比浅层更早饱和; 第 0 层在两种设置下均为异常值，饱和最慢。

### 5.2 Expert Co-activation
#### 专家共激活

We define expert co-activation as the proportion of times two specific experts, Ei and Ej, are simultaneously activated out of the total number of activations of one of those experts:

我们将专家共激活定义为：两个特定专家 Ei 和 Ej 同时被激活的次数，占其中一个专家总激活次数的比例：

$$
\text{Expert co-activation}(E_i, E_j) = \frac{N_{E_i,E_j}}{N_{E_i}}, \tag{6}
$$

where:

- Ei: The first expert.
- Ej: The second expert.
- NEi,Ej: The number of times experts Ei and Ej are activated together.
- NEi: The total number of times expert Ei is activated.

其中：

- Ei：第一个专家。
- Ej：第二个专家。
- N_{E_i,E_j}：专家 Ei 和 Ej 同时被激活的次数。
- N_{E_i}：专家 Ei 被激活的总次数。

A co-activation of 100% indicates that if Ei is activated, Ej is also always activated. A value of 0% indicates that the experts never co-occur. If multiple expert pairs have high co-activation, it may suggest that these experts could be merged, benefiting less from keeping them separate. In a distributed setup, we could place highly co-activated experts on the same device to reduce communication costs during model inference.

100% 的共激活表示只要 Ei 被激活，Ej 也必然被激活。0% 表示这两个专家从不同时出现。如果多个专家对具有高共激活，则可能表明这些专家可以合并，分开保留的收益不大。在分布式部署中，可以将高共激活专家放在同一设备上，以降低推理时的通信开销。

In Figure 21, we find that there is no strong co-activation among experts in one layer, with only few exceptions. This may indicate that there is little redundancy across different experts. Overall, layers 7 and 15 show similar co-activation patterns with several groups of 3 or 2 experts that tend to get activated together. We investigate tokens that activate these experts in §5.4. Further, in Appendix G (Figure 35), we investigate whether experts across layers, rather than within one layer, tend to process tokens together.

图 21 显示，同一层内的专家之间没有强烈的共激活关系，仅有少数例外。这可能表明不同专家之间的冗余很小。总体而言，第 7 层和第 15 层表现出相似的共激活模式，存在若干由 3 个或 2 个专家组成的小组倾向于共同激活。我们将在 §5.4 中调查激活这些专家的 token。此外，在附录 G(图 35)中，我们还研究了跨层专家(而非同一层内)是否倾向于共同处理 token。

> 图 21 描述：OLMOE-1B-7B 在 C4 验证集随机 0.5% 数据上的专家共激活热图。展示了第 0 层、第 7 层和第 15 层中最大共激活分数最高的 32 个专家(通过专家 ID 标识)。可见大多数专家对的共激活较弱，但第 7 层和第 15 层各存在若干小规模专家簇(2-3 个专家)倾向于共同激活。

### 5.3 Domain Specialization
#### 领域专业化

We define domain specialization as the proportion of tokens from a particular domain D that get routed to a particular expert Ei:

我们将领域专业化定义为：来自特定领域 D 的 token 中，被路由到特定专家 Ei 的比例：

$$
\text{Domain specialization}(E_i, D) = \frac{N^{(k)}_{E_i,D}}{N_D}, \tag{7}
$$

where:

- Ei: The ith expert in the model.
- D: The domain from which the data originates.
- k: The number of experts considered (e.g., k = 8 means considering the top 8 experts with the highest routing probabilities).
- N^(k)Ei,D: The number of tokens from domain D for which Ei is among the top-k selected experts.
- ND: The total number of tokens from domain D processed by the MoE.

其中：

- Ei：模型中的第 i 个专家。
- D：数据来源的领域。
- k：考虑的专家数量(例如，k = 8 表示考虑路由概率最高的 8 个专家)。
- N^{(k)}_{E_i,D}：来自领域 D 且 Ei 属于 top-k 选中专家的 token 数量。
- N_D：MoE 处理的来自领域 D 的总 token 数。

Domain specialization thus refers to the specialization of expert Ei to domain D. A value of 100% indicates that all data from that domain is routed to Ei, whereas 0% indicates the expert is never used for that domain and can be removed from the model without affecting performance in that domain.

领域专业化表示专家 Ei 对领域 D 的专业化程度。100% 表示该领域的所有数据都被路由到 Ei; 0% 表示该专家从未被用于该领域，可以从模型中移除而不影响该领域的性能。

In Figure 22 (top) we find many examples of experts that are activated significantly above or below random chance for specific domains. E.g., for arXiv, which has a very specific distribution with lots of scientific text, the first expert in layer 0 is nearly 100% specialized. This suggests that there is little redundancy in the knowledge of the experts in OLMOE-1B-7B, as they specialize in different kinds of data. GitHub and arXiv are often activated together in layer 7, which we explore furthe
r in §5.4. For generic domains, such as C4 [139], which is a web crawl containing various kinds of data, expert activations in OLMOE-1B-7B are much more balanced. This highlights that the load balancing (§4.1.6) works as intended and the model makes proper use of all experts for generic data.

图 22(上)显示，许多专家在特定领域上的激活率显著高于或低于随机概率。例如，对于具有大量科学文本且分布高度特异的 arXiv 领域，第 0 层的第一个专家几乎 100% 专业化。这表明 OLMOE-1B-7B 中专家的知识冗余很小，因为它们各自专业化于不同类型的数据。GitHub 和 arXiv 在第 7 层经常被一起激活，我们将在 §5.4 中进一步探讨。对于通用领域，如 C4 [139](包含各种数据的网页爬取)，OLMOE-1B-7B 的专家激活要均衡得多。这说明负载平衡(§4.1.6)按预期工作，模型对通用数据能够合理利用所有专家。

Mixtral-8x7B [79] in Figure 22 (bottom), however, exhibits little domain specialization across both unique and generic domains. Experts are activated close to the uniform routing baseline for all layers and domains. Thus, there may be more redundancy across experts in Mixtral, as they likely contain similar knowledge. We hypothesize that this is due to Mixtral being upcycled from Mistral [25]. The initialization from a dense model may limit the amount of possible specialization in the experts as they all start from the same local optimum. This is likely why training from scratch eventually outperforms upcycling in our pretraining experiments (§4.1.5).

然而，图 22(下)中的 Mixtral-8x7B [79] 在特异性和通用性领域上都几乎没有表现出领域专业化。所有层和所有领域的专家激活都接近均匀路由基线。因此，Mixtral 的专家之间可能存在更多冗余，因为它们可能包含相似的知识。我们假设这是因为 Mixtral 是从 Mistral [25] 升级而来的。从密集模型初始化可能限制了专家可能的专业化程度，因为它们都从同一个局部最优开始。这很可能就是为什么在我们的预训练实验中(§4.1.5)，从头训练最终优于升级训练的原因。

> 图 22 描述：OLMOE-1B-7B(上)与 Mixtral-8x7B(下)的领域专业化对比。展示了预训练结束时不同领域的 token 被路由到 64 个(OLMOE)或 8 个(Mixtral)专家的频率，考虑 k = 8(OLMOE)或 k = 2(Mixtral)的活跃专家(公式 7)。灰色横线表示随机概率(OLMOE-1B-7B 为 8/64 = 12.5%，Mixtral 为 2/8 = 25%)。可见 OLMOE 的专家在 arXiv、GitHub 等特异领域表现出强烈专业化，而 C4 等通用领域更均衡; Mixtral 则几乎无专业化，所有领域均接近随机基线。

### 5.4 Vocabulary Specialization
#### 词汇专业化

We define vocabulary specialization as the proportion of tokens with a token ID x (also called vocabulary element) that are routed to one particular expert Ei out of all experts in that layer:

我们将词汇专业化定义为：具有特定 token ID x(也称词汇元素)的 token 中，被路由到某一层内特定专家 Ei 的比例：

$$
\text{Vocabulary specialization}(E_i, x) = \frac{N^{(k)}_{x,E_i}}{N_x}, \tag{8}
$$

where:

- Ei: The ith expert in the model.
- x: The token ID being analyzed.
- k: The number of experts considered (e.g., k = 8 means considering the top 8 experts with the highest routing probabilities).
- Nx,Ei: The number of times input data is routed to Ei for x.
- Nx: The total number of times input data is routed across all experts for x.

其中：

- Ei：模型中的第 i 个专家。
- x：被分析的 token ID。
- k：考虑的专家数量(例如，k = 8 表示考虑路由概率最高的 8 个专家)。
- N_{x,E_i}：输入数据因 x 被路由到 Ei 的次数。
- N_x：输入数据因 x 被路由到该层所有专家的总次数。

Vocabulary specialization thus refers to how specialized a particular expert is on some vocabulary item. We distinguish input and output variants of this specialization, where x is either the input token ID or the next output token ID (either the ground-truth next token ID or the token ID predicted by the model). A value of 100% indicates that for all occurrences of that vocabulary element, input data is routed to Ei, whereas 0% indicates an expert that is fully irrelevant for that vocabulary element and can be effectively removed from the model without affecting performance whenever the token ID appears.

词汇专业化表示特定专家在某一词汇项上的专业化程度。我们区分这种专业化的输入和输出变体，其中 x 可以是输入 token ID 或下一个输出 token ID(真实下一个 token ID 或模型预测的 token ID)。100% 表示该词汇元素的所有出现都被路由到 Ei; 0% 表示该专家对该词汇元素完全无关，可以在该 token ID 出现时从模型中有效移除而不影响性能。

In Figure 23 we find that vocabulary specialization is higher in later layers, similar to how later layers saturate earlier (§5.1). Later layers also specialize more on predicted output token IDs rather than input token IDs, i.e., the routing is decided more by the token the model is about to predict rather than the original input token. This is intuitive as in earlier layers there is more uncertainty about which token the model will predict. At ~90%, expert 27 specializes the most, which we find in Table 8 to activate for many non-alphabetic tokens, such as Cyrillic and Devanagari letters.

图 23 显示，词汇专业化在较深层更高，这与较深层更早饱和的现象一致(§5.1)。较深层也更倾向于在预测的输出 token ID 上专业化，而非输入 token ID，即路由更多由模型即将预测的 token 决定，而非原始输入 token。这符合直觉，因为在较浅层，模型对将预测哪个 token 存在更大的不确定性。专家 27 的专业化程度最高，约为 90%，我们从表 8 中发现它激活于许多非字母 token，如西里尔字母和天城文。

> 图 23 描述：OLMOE-1B-7B 跨层和跨专家的词汇专业化。左图计算每层的平均专业化程度; 右图虚线对应左图中第 7 层的平均值，展示了 64 个专家中的前 32 个(横轴为专家 ID，纵轴为词汇专业化率)。本图针对 k = 1(公式 8)，附录 G 提供 k = 8 及与 Mixtral-8x7B 的对比。可见深层专业化显著高于浅层，且输出 token 的专业化高于输入 token。

Expert 43 shows specialization on geographic terms in both input and output tokens. Experts 48 and 23 both focus on connector words, such as "Then" and "Therefore". This is likely because they commonly process tokens together with a high co-activation of 60% in Figure 21 (middle). Based on our findings in §5.3 that for GitHub and arXiv often the same experts in layer 7 activate, we display one such expert (expert ID 4) in Table 8. It seems to specialize in measurements, such as "sq", "YR" (year), and "GHz". These are common terms in scientific papers corresponding to the arXiv domain and likely also in GitHub code for computations related to measurements. They are less likely to appear in books, which explains the low activation of expert ID 4 in layer 7 for book data in Figure 22. Expert 3 is among the three most active experts of layer 7 for book data in Figure 22 (fourth yellow bar for layer 7). This resonates when looking at its specialization on family terms in Table 8, which are far more common in books than scientific papers or code. Overall, domain specialization and vocabulary specialization are closely linked to one another, as domains are usually characterized by their distinct word distribution. In Appendix G (Figure 32), we link them more closely by comparing the extent of vocabulary specialization across domains and expert IDs. In Appendix G (Figure 30, Figure 31) we also find that OLMOE-1B-7B exhibits stronger vocabulary specialization than Mixtral-8x7B.

专家 43 在输入和输出 token 上都表现出地理术语专业化。专家 48 和 23 都专注于连接词，如 "Then" 和 "Therefore"。这可能是因为它们通常在图 21(中)中以 60% 的高共激活率共同处理 token。基于我们在 §5.3 中的发现——GitHub 和 arXiv 在第 7 层经常激活相同的专家——我们在表 8 中展示了这样一个专家(专家 ID 4)。它似乎专业化于度量单位，如 "sq"、"YR"(year)和 "GHz"。这些是科学论文(对应 arXiv 领域)中的常见术语，也可能出现在 GitHub 代码中用于与度量相关的计算。它们不太可能出现在书籍中，这解释了图 22 中第 7 层专家 ID 4 对书籍数据的低激活。专家 3 是图 22 中第 7 层书籍数据最活跃的三个专家之一(第 7 层的第四个黄色柱)。这与表 8 中它在家族术语上的专业化相呼应——家族术语在书籍中远比科学论文或代码中常见。总体而言，领域专业化和词汇专业化紧密相连，因为领域通常由其独特的词分布来表征。在附录 G(图 32)中，我们通过比较跨领域和专家 ID 的词汇专业化程度，更紧密地将两者联系起来。在附录 G(图 30、图 31)中，我们还发现 OLMOE-1B-7B 表现出比 Mixtral-8x7B 更强的词汇专业化。

**Table 8: Vocabulary specialization in the 7th layer of OLMOE-1B-7B. We use k = 1 (Equation 8) and a random 0.5% of the C4 validation data excluding token IDs with <10 appearances.**

**表 8：OLMOE-1B-7B 第 7 层的词汇专业化。使用 k = 1(公式 8)和 C4 验证集随机 0.5% 数据，排除出现次数 <10 的 token ID。**

| Expert ID | Input token IDs | Predicted output token IDs |
|-----------|----------------|---------------------------|
| 27 | § (100%) | (100%) |
| 58 | " (100%), " (100%), ' (94%), ' (92%), " (92%), ( (92%), " (90%), ' (89%), " (88%), $ (87%), [ (87%), £ (86%) | such (100%), 486 (100%), see (95%), which (91%), driving (91%), UK (90%), who (88%), including (88%), normal (88%) |
| 7 | Him (100%), inde (100%), Jesus (98%), God (90%), pray (81%), Holy (80%), Quran (80%), God (77%), Lord (76%), glory (75%), Spirit (66%), Christ (65%) | rella (100%), Him (94%), sin (90%), prince (80%), glory (72%), Jesus (69%), Lord (68%), Christ (65%), Spirit (55%), Holy (53%), God (50%), Prayer (50%) |
| 37 | Sunday (100%), Tuesday (100%), Thursday (100%), Olympic (100%), Christmas (100%), rugby (100%), Championship (100%), weekends (100%), days (91%), anniversary (90%), month (88%), week (84%), mpi (83%), semester (81%), mand (80%), Olympics (78%), cent (76%), season (76%), perm (75%) | - |
| 43 | Armenian (100%), ijan (100%), enia (96%), Iraq (95%), Iranian (92%), Iran (92%), Saudi (90%), northern (90%), Lebanon (90%), Singapore (88%), Turkey (88%), Asia (87%), Egypt (86%), western (86%) | enia (90%), invasion (80%), Arabia (76%), irregular (66%), regions (64%), border (63%), Kong (61%), ians (61%), bases (60%), Republic (59%), Ireland (58%), Korea (58%), War (55%), Carolina (52%) |
| 4 | sq (89%), Main (70%), reversal (69%), YR (63%), GC (56%), Overall (50%), 79 (50%), main (50%), RE (46%), PCR (46%), tomb (45%), normal (43%), intensity (41%), Overall (41%), median (41%) | YR (90%), Character (88%), sq (77%), Os (76%), GHz (71%), fluence (60%), amycin (60%), pixels (56%), = (53%), arc (52%), Story (52%), = (51%), anth (50%), GHz (50%), cm (46%) |
| 0 | ESM (100%), icillin (100%), agra (98%), aust (96%), asa (93%), pills (92%), mg (85%), uk (82%), login (82%), doc (81%), generic (81%), cd (81%), Essay (81%), password (81%), Content (80%) | *, (100%), sil (96%), pills (91%), vi (90%), xen (87%), pharmacy (87%), gener (85%), aust (82%), mg (75%), Content (75%), uk (73%), THAT (73%), dispens (68%), icillin (68%), generic (66%) |
| 3 | grandmother (92%), brother (91%), Daisy (83%), daughter (78%), mum (75%), father (72%), wife (70%), husband (70%), lady (63%), dad (62%), boy (61%) | hood (36%), mother (35%), inde (31%), boy (29%), girl (28%), married (27%), tri (21%), Gab (20%), died (18%), taught (14%), lived (13%), knew (10%) |
| 48 | compared (42%), !) (41%), Then (41%), ', (40%), ), (35%), ", (35%), instead (33%) | except (60%), tennis (41%), Marks (40%), Dunn (33%), tears (30%), Arizona (30%) |
| 23 | .... (58%), Therefore (55%), So (46%), !!! (46%), And (44%), According (41%), ." (41%), !! (40%), ?" (38%), But (38%) | - |
| 53 | (53%), Republican (50%), Jack (47%), THIS (40%), Democratic (40%), according (39%), So (38%), Step (33%) | - |

> 译者注(技术谱系与发现): §5 的四大分析揭示了 MoE 的核心内部机制。路由饱和(§5.1)的发现极具工程价值：训练仅 1%(20B token)后 top-8 路由就达 60% 饱和，40% 时达 80%——这意味着 MoE 的路由决策在极早期就已"定型"，后续训练主要是微调概率而非重新分配专家。第一层路由饱和异常缓慢，这解释了为什么有些实现(如 Dai et al. [39])选择不在第一层放置 MoE。专家共激活(§5.2)分析则表明专家冗余度很低——除少数 2-3 人小组外，大多数专家对很少共同激活，这与 Mixtral 的升级初始化导致的高冗余形成鲜明对比(§5.3)。领域专业化(§5.3)和词汇专业化(§5.4)的发现相辅相成：OLMOE 的专家对 arXiv、GitHub 等特异领域表现出强烈专业化，而 Mixtral 几乎无专业化; 深层更专业化于输出 token(而非输入 token)，说明深层路由已由"理解当前 token"转向"预测下一个 token"。表 8 中的具体案例(专家 37 专业化于星期/节日名称，专家 7 专业化于宗教词汇)生动展示了 MoE 的可解释性潜力。这些发现共同支持了"从头训练优于升级训练"的结论(§4.1.5)：升级初始化限制了专家分化，而从头训练允许专家充分专业化。

## 6 Related Work
### 相关工作

Advances in MoEs

MoE 进展

Current LMs still largely follow the transformer architecture [185] with only few architectural changes that have been widely adopted, such as decoder-only training [137], SwiGLU activations [153, 41], RoPE [166], MQA/GQA [152, 3] and RMSNorm [208]. Model sparsity via Mixture-of-Experts is one modification still under active exploration with some early adoption but most LMs, including Llama 3 [50], still rely on a dense architecture. There has been a lot of progress in improving the sparsely-gated MoE layer since its introduction [154]: New routing techniques [89, 146, 222, 66, 77, 49, 215, 195, 124], fine-grained expert segmentation [39, 69], stability [221] and efficiency [88, 141, 48, 218, 91, 168, 129, 145] improvements. In this work, we perform many experiments to provide insights into training Mixture-of-Experts LMs. Subsequently, we train OLMOE-1B-7B for 5T tokens. No prior MoE has been overtrained [57] to this extent to our knowledge making OLMOE-1B-7B the best testbed to research performance saturation of MoEs vs. dense models. With OLMOE we hope to facilitate such and other research to help the field uncover whether MoEs should make it into all future LMs and with what precise configuration.

当前语言模型仍主要遵循 transformer 架构 [185]，仅有少数架构改动被广泛采用，如仅解码器训练 [137]、SwiGLU 激活 [153, 41]、RoPE [166]、MQA/GQA [152, 3] 和 RMSNorm [208]。通过混合专家实现的模型稀疏性仍是一个正在积极探索的修改方向，虽然已有一些早期采用，但包括 Llama 3 [50] 在内的大多数语言模型仍依赖密集架构。自稀疏门控 MoE 层提出以来 [154]，该领域取得了大量进展：新的路由技术 [89, 146, 222, 66, 77, 49, 215, 195, 124]、细粒度专家分割 [39, 69]、稳定性 [221] 和效率 [88, 141, 48, 218, 91, 168, 129, 145] 改进。在本工作中，我们进行了大量实验以提供训练混合专家语言模型的洞察。随后，我们将 OLMOE-1B-7B 训练了 5T token。据我们所知，此前没有任何 MoE 被过度训练 [57] 到这种程度，这使得 OLMOE-1B-7B 成为研究 MoE 与密集模型性能饱和的最佳试验平台。我们希望借助 OLMOE 促进此类及其他研究，帮助学界探索 MoE 是否应该应用于所有未来的语言模型，以及应采用何种精确配置。

Open LMs

开放语言模型

A variety of model families have been proposed under varying degrees of openness commonly categorized based on whether model weights are available. Closed-weight models include GPT [24, 128], Gemini [174, 175], PaLM [30, 9], Reka [181], and open-weight ones include Llama [182, 183, 50], Mistral [78, 79], Gemma [176, 177], Falcon [8, 132], MPT [179], Qwen [13, 201], GLM [61], Yi [2], DeepSeek [42, 43, 39], Nemotron [130, 126], Zamba [62], InternLM [26], Baichuan [200], Phi [68, 94, 1], StableLM [16], OPT [212]. However, besides model weights, training data and code are key to enabling scientific research of these models [105, 106] and distributing their benefits broadly [23]. There have been few releases also including data and code in addition to model weights which we refer to as "fully open-source": BLOOM [193, 151, 123, 203], GPT-NeoX [21, 22, 186], StarCoder [92, 109, 5, 120, 220], Pythia [18], OLMo [65], LLM360 [103], Cerebras-GPT [46], DCLM [90], MAP-Neo [209], RWKV [133, 134], and SmolLM [6]. For Mixture-of-Experts only OpenMoE [199] aims to be fully open-source, however, its poor performance limits its usefulness. We release OLMOE-1B-7B as the first state-of-the-art Mixture-of-Experts LM that is fully open-source: model weights, data, code, and logs.

已提出多种模型家族，其开放程度各异，通常根据模型权重是否可获取来分类。闭权模型包括 GPT [24, 128]、Gemini [174, 175]、PaLM [30, 9]、Reka [181] 等; 开放权重模型包括 Llama [182, 183, 50]、Mistral [78, 79]、Gemma [176, 177]、Falcon [8, 132]、MPT [179]、Qwen [13, 201]、GLM [61]、Yi [2]、DeepSeek [42, 43, 39]、Nemotron [130, 126]、Zamba [62]、InternLM [26]、Baichuan [200]、Phi [68, 94, 1]、StableLM [16]、OPT [212] 等。然而，除模型权重外，训练数据和代码对于实现这些模型的科学研究 [105, 106] 并广泛传播其收益 [23] 至关重要。仅有少数发布同时包含模型权重、数据和代码，我们称之为"完全开源"：BLOOM [193, 151, 123, 203]、GPT-NeoX [21, 22, 186]、StarCoder [92, 109, 5, 120, 220]、Pythia [18]、OLMo [65]、LLM360 [103]、Cerebras-GPT [46]、DCLM [90]、MAP-Neo [209]、RWKV [133, 134] 和 SmolLM [6]。在混合专家领域，仅 OpenMoE [199] 致力于完全开源，但其性能不佳限制了其实用性。我们发布的 OLMOE-1B-7B 是首个达到 SOTA 性能的完全开源混合专家语言模型：包含模型权重、数据、代码和日志。

> 译者注(技术谱系): §6 将相关工作分为两条主线：MoE 架构进展和开放语言模型生态。在 MoE 方面，OLMOE-1B-7B 的核心贡献是首次将 MoE 过度训练到 5T token 级别，此前没有任何 MoE 做到这一点——这使得它成为研究 MoE 性能饱和规律的最佳平台。在开放模型方面，作者严格区分了"开放权重"(仅权重)和"完全开源"(权重+数据+代码)两个层次，并将 OLMOE 定位为首个达到 SOTA 的完全开源 MoE，填补了 OpenMoE [199] 性能不足的空白。这一分类框架对理解当前 LLM 开放生态的演进具有重要参考价值。

## 7 Conclusion
### 结论

We open-source OLMOE-1B-7B and OLMOE-1B-7B-INSTRUCT including model, data, code, and logs. At 1B active and 7B total parameters, our models yield state-of-the-art performance among models with a similar amount of active parameters even outperforming larger models including DeepSeekMoE-16B and Llama2-13B-Chat. We share various training experiments and define and analyze router saturation, expert co-activation, domain and vocabulary specialization of our model. Through our fully open release, we seek to help the field build better MoEs. We are excited about more iterations of OLMOE to close the gap between frontier models and fully open models.

我们开源了 OLMOE-1B-7B 和 OLMOE-1B-7B-INSTRUCT，包括模型、数据、代码和日志。在 1B 活跃参数和 7B 总参数的规模下，我们的模型在具有相似活跃参数量的模型中达到了 SOTA 性能，甚至超过了包括 DeepSeekMoE-16B 和 Llama2-13B-Chat 在内的更大模型。我们分享了各种训练实验，并定义和分析了模型的路由饱和、专家共激活、领域专业化和词汇专业化。通过我们的完全开放发布，我们旨在帮助学界构建更好的 MoE。我们期待 OLMOE 的更多迭代，以缩小前沿模型与完全开放模型之间的差距。

---

## References
### 参考文献

以下为原文参考文献列表，保留英文原文以供溯源。OLMOE 技术报告共引用约 220 篇文献，覆盖 MoE 架构、路由算法、训练稳定性、开放语言模型、数据筛选、评估基准等广泛领域。值得注意的是，文献 [199] (OpenMoE) 作为唯一的完全开源 MoE 先驱被多次引用，而 [39] (DeepSeekMoE) 和 [79] (Mixtral) 则是与 OLMoE 对比最频繁的两个 MoE 架构。

> [1] 至 [220] 的完整参考文献列表参见英文原文 `03-OLMo-3-mineru-en.md` 第 2669-3674 行。本 D4 文档聚焦于技术内容逐段精译，参考文献保留原文不重复翻译。

---

## Appendices
### 附录

以下为原文附录章节列表，涵盖模型实现细节、训练配置、评估设置、额外可视化等。附录 A-J 共约 2400 行，包含丰富的工程细节。本 D4 文档附录部分保留原文结构，提供各附录内容概要。

> 译者注(附录导航): OLMoE 报告的附录体系非常完整，包含：A) 工件清单(model/data/code); B) 训练基础设施与超参数; C) 评估基准细节; D) 额外预训练实验; E) 额外适配实验; F) 数据混合细节; G) 额外 MoE 分析可视化(图 30-35); H) 提示模板; I) 模型卡; J) 许可证信息。这些附录对于复现工作和深入理解模型行为至关重要，建议有复现需求的读者直接阅读原文附录。特别推荐附录 G，其中包含 k=8 和 Mixtral 对比的词汇专业化可视化，是对 §5.4 的重要补充。

