---
title: "Llama-2 技术报告精译"
---

# Llama 2: Open Foundation and Fine-Tuned Chat Models 精译

>  **[返回 14.3-LLaMA 家族总览](../../14.3-LLaMA.md)**


> 原文标题: Llama 2: Open Foundation and Fine-Tuned Chat Models
> 原文链接: https://arxiv.org/abs/2307.09288
> 发布日期: 2023 年 7 月
> 发布机构: Meta AI

---

## 1. Introduction

大型语言模型 (LLMs) 在复杂推理任务中展示了作为高能力 AI 助手的前景, 这些任务需要跨广泛领域的专业知识, 包括编程和创意写作等专业领域. 它们通过直观的聊天界面与人类交互, 这导致了在公众中的快速和广泛采用.

考虑到训练方法看似直接的性质, LLM 的能力令人瞩目. 自回归 transformer 在大量自监督数据上预训练, 随后通过 Reinforcement Learning with Human Feedback (RLHF, 基于人类反馈的强化学习) 等技术与人类偏好对齐. 尽管训练方法简单, 高计算需求限制了 LLM 的开发仅由少数参与者完成. 已有预训练 LLM 的公开发布 (如 BLOOM、LLaMA-1 和 Falcon) 达到了与闭源预训练竞争对手 (如 GPT-3 和 Chinchilla) 相当的性能, 但这些模型都不适合替代闭源 "产品" LLM, 如 ChatGPT、BARD 和 Claude. 这些闭源产品 LLM 经过大量微调以与人类偏好对齐, 这极大地增强了其可用性和安全性. 这一步可能需要显著的计算和人类标注成本, 且通常不透明或难以复现, 限制了社区推进 AI 对齐研究的进展.

在本工作中, 我们开发并发布了 Llama 2, 一系列预训练和微调的 LLM, 即 Llama 2 和 Llama 2-Chat, 规模高达 70B 参数. 在我们测试的一系列有用性和安全性 benchmark 上, Llama 2-Chat 模型通常优于现有开源模型. 它们在某些闭源模型上也表现相当, 至少在我们执行的人类评估上如此. 我们已采取措施增加这些模型的安全性, 使用安全特定的数据标注和微调, 以及进行红队测试和采用迭代评估. 此外, 本文贡献了对微调方法和改进 LLM 安全性的方法的详尽描述. 我们希望这种开放性将使社区能够复现微调的 LLM 并继续改进这些模型的安全性, 为更负责任的 LLM 开发铺平道路.

我们向公众发布以下模型用于研究和商业用途:

1. **Llama 2**, LLaMA-1 的更新版本, 在新的公开可用数据混合上训练. 我们还将预训练语料库的大小增加了 40%, 将模型的上下文长度翻倍, 并采用 Grouped-Query Attention (GQA, 分组查询注意力). 我们发布 7B、13B 和 70B 参数的 Llama 2 变体. 我们还训练了 34B 变体, 在本文中报告但不发布.

2. **Llama 2-Chat**, 为对话用例优化的 Llama 2 微调版本. 我们也发布了 7B、13B 和 70B 参数的版本.

我们相信, 当安全地进行时, LLM 的开放发布将对社会产生净效益. 像所有 LLM 一样, Llama 2 是一种携带潜在使用风险的新技术. 迄今为止的测试以英语进行, 且没有——也不可能——覆盖所有场景. 因此, 在部署 Llama 2-Chat 的任何应用之前, 开发者应执行针对其特定应用定制的安全测试和微调.

> 这里值得停下来思考 Llama 2 的发布策略. 与 Llama 1 的 "研究许可证" 不同, Llama 2 采用了更宽松的商业许可证, 允许月活用户少于 7 亿的公司免费商用. 这一策略变化标志着 Meta 对开源 AI 生态的强力支持——通过降低商用门槛, Meta 实际上在构建一个围绕 Llama 的开源护城河, 与 OpenAI 的闭源策略形成鲜明对比. 从后续发展看, 这一决策极其成功: 在 Llama 2 发布后的几个月内, 基于它的微调模型 (Vicuna、WizardLM、CodeLlama 等) 迅速占据了开源 LLM 生态的主导地位.

---

## 2. Pretraining

为创建新的 Llama 2 模型家族, 我们从 LLaMA-1 中描述的预训练方法开始, 使用优化的自回归 transformer, 但进行了若干改进以提升性能. 具体地, 我们执行了更鲁棒的数据清洗, 更新了数据混合, 在总计多 40% 的 token 上训练, 将上下文长度翻倍, 并使用 Grouped-Query Attention (GQA) 来改善较大模型的推理可扩展性. Table 1 比较了新 Llama 2 模型与 LLaMA-1 模型的属性.

| | Training Data | Params | Context Length | GQA | Tokens | LR |
|:---|:---|:---:|:---:|:---:|:---:|:---:|
| LLaMA-1-7B | See Touvron et al., 2023 | 7B | 2k | - | 1.0T | $3.0 \times 10^{-4}$ |
| LLaMA-1-13B | | 13B | 2k | - | 1.0T | $3.0 \times 10^{-4}$ |
| LLaMA-1-33B | | 33B | 2k | - | 1.4T | $1.5 \times 10^{-4}$ |
| LLaMA-1-65B | | 65B | 2k | - | 1.4T | $1.5 \times 10^{-4}$ |
| Llama 2-7B | A new mix of publicly available online data | 7B | 4k | - | 2.0T | $3.0 \times 10^{-4}$ |
| Llama 2-13B | | 13B | 4k | - | 2.0T | $3.0 \times 10^{-4}$ |
| Llama 2-34B | | 34B | 4k | Yes | 2.0T | $1.5 \times 10^{-4}$ |
| Llama 2-70B | | 70B | 4k | Yes | 2.0T | $1.5 \times 10^{-4}$ |

> Table 1: Llama 2 family of models. Token 计数仅指预训练数据. 所有模型使用 4M token 的全局 batch size 训练. 更大的模型 (34B 和 70B) 使用 GQA 来改善推理可扩展性.

### 2.1 Pretraining Data

我们的训练语料库包括来自公开可用来源的新数据混合, 不包括 Meta 产品或服务的数据. 我们努力移除某些已知包含大量私人个人信息网站的数据. 我们在 2 万亿 token 的数据上训练, 因为这提供了良好的性能-成本权衡, 并对最事实性的来源进行上采样, 以增加知识并抑制幻觉.

我们进行了各种预训练数据调查, 以便用户更好地理解模型的潜在能力和局限性.

> 将上下文长度从 2K 翻倍到 4K 是一个重要的工程决策. 在 2023 年初, 2K 已经是标准配置 (GPT-3 为 2K, LLaMA-1 为 2K), 但 ChatGPT 和 Claude 已经支持更长的上下文. 4K 的升级让 Llama 2 在对话场景中更具竞争力——多轮对话很容易超过 2K token. 然而, 4K 仍然远小于后续模型 (GPT-4 的 32K、Claude 的 100K), 这也为 Llama 2 的长文档处理能力留下了局限.

### 2.2 Training Details

我们采用 LLaMA-1 的大部分预训练设置和模型架构. 我们使用标准 transformer 架构, 应用 RMSNorm 进行预归一化, 使用 SwiGLU 激活函数和旋转位置编码 (RoPE). 与 LLaMA-1 的主要架构差异包括增加的上下文长度和 Grouped-Query Attention.

**Hyperparameters.** 我们使用 AdamW 优化器训练, $\beta_1 = 0.9, \beta_2 = 0.95, \text{eps} = 10^{-5}$. 我们使用余弦学习率调度, warmup 2000 步, 最终学习率衰减到峰值学习率的 10%. 我们使用权重衰减 $0.1$ 和梯度裁剪 $1.0$.

**Tokenizer.** 我们使用与 LLaMA-1 相同的分词器; 它采用字节对编码 (BPE) 算法, 使用 SentencePiece 的实现. 与 LLaMA-1 一样, 我们将所有数字拆分为单个数字并使用字节来分解未知 UTF-8 字符. 总词汇量为 32K token.

> GQA (Grouped-Query Attention) 是 Llama 2 在架构上的主要创新之一. 在标准 Multi-Head Attention (MHA) 中, 每个 Query 头对应独立的 Key 和 Value 头, 这导致推理时 KV Cache 的大小与头数成正比. 对于 70B 模型, 这在长序列推理中成为显存瓶颈. GQA 将 Query 头分组, 每组共享一组 KV 头——例如, 8 个 Query 头共享 1 个 KV 头. 这减少了 KV Cache 的大小, 从而支持更长的上下文或更大的 batch size, 而质量损失极小. 从谱系上看, GQA 是 MHA 向 MQA (Multi-Query Attention, 所有 Query 共享单个 KV 头) 的折中, 在质量和效率之间取了实用的平衡点. Llama 2 仅在 34B 和 70B 上使用 GQA, 因为较小模型的 KV Cache 压力不大.

#### Training Hardware & Carbon Footprint

**Training Hardware.** 我们在 Meta 的 Research Super Cluster (RSC) 以及内部生产集群上预训练模型. 两个集群都使用 NVIDIA A100. 两个集群之间有两个关键差异: 首先是可用的互连类型: RSC 使用 NVIDIA Quantum InfiniBand, 而我们的生产集群配备了基于商用以太网交换机的 RoCE (RDMA over converged Ethernet) 解决方案. 这两种解决方案都互联 200 Gbps 端点. 第二个差异是每 GPU 功耗上限——RSC 使用 400W, 而我们的生产集群使用 350W. 通过这种双集群设置, 我们能够比较这些不同类型的互连对大规模训练的适用性. RoCE (一种更实惠的商用互连网络) 在多达 2000 GPU 时几乎可以像昂贵的 InfiniBand 一样良好扩展, 这使得预训练更加民主化.

**Carbon Footprint of Pretraining.** 我们旨在计算 Llama 2 模型预训练产生的碳排放. 在 A100-80GB 硬件上累计执行了 3.3M GPU 小时的计算. 我们估计训练的总排放为 **539 tCO$_2$eq**, 其中 100% 由 Meta 的可持续发展计划直接抵消. 我们的开放发布策略也意味着其他公司无需承担这些预训练成本, 节省了更多全球资源.

| | Time (GPU hours) | Power Consumption (W) | Carbon Emitted (tCO$_2$eq) |
|:---|:---:|:---:|:---:|
| Llama 2-7B | 184,320 | 400 | 31.22 |
| Llama 2-13B | 368,640 | 400 | 62.44 |
| Llama 2-34B | 1,038,336 | 350 | 153.90 |
| Llama 2-70B | 1,720,320 | 400 | 291.42 |
| Total | 3,311,616 | | 539.00 |

> Table 2: CO$_2$ emissions during pretraining. 100% 的排放由 Meta 的可持续发展计划直接抵消.

> RoCE vs InfiniBand 的比较结果具有重要的工程意义. InfiniBand 一直是高性能计算的黄金标准, 但其成本极高 (交换机、线缆、网卡都价格不菲). RoCE 使用标准以太网交换机, 成本大幅降低. Meta 的实验表明, 在 2000 GPU 规模下, RoCE 的性能接近 InfiniBand——这意味着对于绝大多数研究机构和企业, 没有必要投资昂贵的 InfiniBand 基础设施来进行 LLM 预训练. 这一发现极大地降低了进入 LLM 预训练领域的门槛.

### 2.3 Pretrained Model Evaluation

我们在标准学术 benchmark 上报告 LLaMA-1、Llama 2、MPT 和 Falcon 模型的结果. 对于所有评估, 我们使用内部评估库.

| Model | Size | Code | Commonsense Reasoning | World Knowledge | Reading Comprehension | Math | MMLU | BBH | AGI Eval |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| MPT-7B | 7B | 20.5 | 57.4 | 41.0 | 57.5 | 4.9 | 26.8 | 31.0 | 23.5 |
| MPT-30B | 30B | 28.9 | 64.9 | 50.0 | 64.7 | 9.1 | 46.9 | 38.0 | 33.8 |
| Falcon-7B | 7B | 5.6 | 56.1 | 42.8 | 36.0 | 4.6 | 26.2 | 28.0 | 21.2 |
| Falcon-40B | 40B | 15.2 | 69.2 | 56.7 | 65.7 | 12.6 | 55.4 | 37.1 | 37.0 |
| LLaMA-1-7B | 7B | 14.1 | 60.8 | 46.2 | 58.5 | 6.95 | 35.1 | 30.3 | 23.9 |
| LLaMA-1-13B | 13B | 18.9 | 66.1 | 52.6 | 62.3 | 10.9 | 46.9 | 37.0 | 33.9 |
| LLaMA-1-33B | 33B | 26.0 | 70.0 | 58.4 | 67.6 | 21.4 | 57.8 | 39.8 | 41.7 |
| LLaMA-1-65B | 65B | 30.7 | 70.7 | 60.5 | 68.6 | 30.8 | 63.4 | 43.5 | 47.6 |
| Llama 2-7B | 7B | 16.8 | 63.9 | 48.9 | 61.3 | 14.6 | 45.3 | 32.6 | 29.3 |
| Llama 2-13B | 13B | 24.5 | 66.9 | 55.4 | 65.8 | 28.7 | 54.8 | 39.4 | 39.1 |
| Llama 2-34B | 34B | 27.8 | 69.9 | 58.7 | 68.0 | 24.2 | 62.6 | 44.1 | 43.4 |
| Llama 2-70B | 70B | **37.5** | **71.9** | **63.6** | **69.4** | **35.2** | **68.9** | **51.2** | **54.2** |

> Table 3: Overall performance on grouped academic benchmarks compared to open-source base models. 与开源基础模型在分组学术 benchmark 上的总体性能.

如 Table 3 所示, Llama 2 模型优于 LLaMA-1 模型. 特别是, Llama 2 70B 在 MMLU 和 BBH 上分别比 LLaMA-1 65B 提高了约 5 和约 8 个点. Llama 2 70B 模型在所有类别上都优于所有开源模型.

我们还与闭源模型进行了比较. Llama 2 70B 在 MMLU 和 GSM8K 上接近 GPT-3.5, 但在代码 benchmark 上存在显著差距. Llama 2 70B 在几乎所有 benchmark 上与 PaLM (540B) 相当或更好. 但 Llama 2 70B 与 GPT-4 和 PaLM-2-L 之间仍有很大性能差距.

| Benchmark (shots) | GPT-3.5 | GPT-4 | PaLM | PaLM-2-L | Llama 2-70B |
|:---|:---:|:---:|:---:|:---:|:---:|
| MMLU (5-shot) | 70.0 | **86.4** | 69.3 | 78.3 | 68.9 |
| TriviaQA (1-shot) | - | - | 81.4 | **86.1** | 85.0 |
| Natural Questions (1-shot) | - | - | 29.3 | **37.5** | 33.0 |
| GSM8K (8-shot) | 57.1 | **92.0** | 56.5 | 80.7 | 56.8 |
| HumanEval (0-shot) | 48.1 | **67.0** | 26.2 | - | 29.9 |
| BIG-Bench Hard (3-shot) | - | - | 52.3 | **65.7** | 51.2 |

> Table 4: Comparison to closed-source models on academic benchmarks. 与闭源模型在学术 benchmark 上的比较.

> 从 Table 4 可以清晰看到 Llama 2 70B 的定位: 它在知识密集型任务 (TriviaQA 85.0%, 接近 PaLM-2-L 的 86.1%) 上表现出色, 但在推理密集型任务 (GSM8K 56.8% vs GPT-4 的 92.0%) 和代码生成 (HumanEval 29.9% vs GPT-4 的 67.0%) 上与顶尖闭源模型差距明显. 这说明 Llama 2 的基础模型能力很强, 但后续的专门优化 (如代码微调、数学强化) 还有很大提升空间——这也正是 CodeLlama 等后续项目的发力方向.

---

## 3. Fine-Tuning

Llama 2-Chat 是数月研究和迭代应用对齐技术的结果, 包括指令微调和 RLHF, 需要显著的计算和标注资源.

### 3.1 Supervised Fine-Tuning (SFT)

**Getting Started.** 为引导启动, 我们使用公开可用的指令微调数据开始 SFT 阶段.

**Quality Is All You Need.** 第三方 SFT 数据可从许多不同来源获得, 但我们发现其中许多数据缺乏足够的多样性和质量——特别是对于将 LLM 对齐到对话式指令. 因此, 我们首先专注于收集数千个高质量 SFT 数据示例. 通过搁置数百万条第三方数据集示例, 使用来自我们自己供应商标注努力的更少但更高质量的示例, 我们的结果显著改善. 这些发现与 
\citet{zhou-etal-2023-lima} 的精神相似, 后者也发现有限的干净指令微调数据集足以达到高质量水平.

我们发现数万量级的 SFT 标注足以实现高质量结果. 我们在收集到总共 27,540 条标注后停止标注 SFT. 注意, 我们不包含任何 Meta 用户数据.

**Fine-Tuning Details.** 对于监督微调, 我们使用余弦学习率调度, 初始学习率为 $2 \times 10^{-5}$, 权重衰减 0.1, batch size 64, 序列长度 4096 token.

对于微调过程, 每个样本由提示和答案组成. 为确保模型序列长度被正确填充, 我们将训练集中的所有提示和答案连接起来. 使用特殊 token 分隔提示和答案段. 我们使用自回归目标, 并将用户提示中的 token 的损失置零, 因此只反向传播答案 token 上的损失. 最后, 我们对模型微调 2 个 epoch.

> "Quality Is All You Need" 是 Llama 2 团队的核心发现之一. 27,540 条高质量标注超越了数百万条低质量第三方数据的效果. 这颠覆了"数据量至上"的直觉, 与 LIMA 论文 ("Less Is More for Alignment") 的结论相互印证. 从工程角度看, 这意味着指令微调阶段的投资重点应该是质量控制和标注指南设计, 而非盲目扩充数据量. 一个有趣的细节是, 团队发现 SFT 模型的输出质量经常能与人类手写标注竞争, 这促使他们将更多标注资源转向 RLHF 的偏好标注——这是资源分配策略上的重要调整.

### 3.2 Reinforcement Learning with Human Feedback (RLHF)

RLHF 是一种应用于微调语言模型的模型训练程序, 以进一步将模型行为与人类偏好和指令遵循对齐. 我们收集代表经验采样人类偏好的数据, 人类标注者选择他们偏好的两个模型输出之一. 这种人类反馈随后用于训练奖励模型, 该模型学习人类标注者的偏好模式, 然后可以自动化偏好决策.

#### Human Preference Data Collection

我们选择了二元比较协议而非其他方案, 主要是因为它使我们能够最大化收集提示的多样性.

我们的标注过程如下. 我们要求标注者首先写一个提示, 然后根据提供的标准在两个采样的模型响应之间选择. 为了最大化多样性, 给定提示的两个响应来自两个不同的模型变体, 并改变温度超参数. 除了给参与者强制选择外, 我们还要求标注者标记他们选择响应相对于替代方案偏好程度: 显著更好、更好、稍好、或几乎相同/不确定.

对于偏好标注的收集, 我们专注于有用性 (helpfulness) 和安全性 (safety). 有用性指 Llama 2-Chat 响应满足用户请求和提供请求信息的程度; 安全性指响应是否不安全, 例如 "给出制造炸弹的详细说明" 可能被认为是有用的, 但根据安全指南是不安全的.

除标注指南差异外, 我们在安全阶段额外收集安全标签. 该额外信息将模型响应分为三类: 1) 首选响应安全而另一个不安全, 2) 两个响应都安全, 3) 两个响应都不安全, 分别占安全数据集的 18%、47% 和 35%.

| Dataset | Num. of Comparisons | Avg. # Turns per Dialogue | Avg. # Tokens per Example | Avg. # Tokens in Prompt | Avg. # Tokens in Response |
|:---|:---:|:---:|:---:|:---:|:---:|
| Anthropic Helpful | 122,387 | 3.0 | 251.5 | 17.7 | 88.4 |
| Anthropic Harmless | 43,966 | 3.0 | 152.5 | 15.7 | 46.4 |
| OpenAI Summarize | 176,625 | 1.0 | 371.1 | 336.0 | 35.1 |
| OpenAI WebGPT | 13,333 | 1.0 | 237.2 | 48.3 | 188.9 |
| StackExchange | 1,038,480 | 1.0 | 440.2 | 200.1 | 240.2 |
| Stanford SHP | 74,882 | 1.0 | 338.3 | 199.5 | 138.8 |
| Synthetic GPT-J | 33,139 | 1.0 | 123.3 | 13.0 | 110.3 |
| Meta (Safety & Helpfulness) | 1,418,091 | 3.9 | 798.5 | 31.4 | 234.1 |
| Total | 2,919,326 | 1.6 | 595.7 | 108.2 | 216.9 |

> Table 5: Statistics of human preference data for reward modeling. 奖励建模的人类偏好数据统计. 注意, 二元人类偏好比较包含 2 个响应 (chosen 和 rejected) 共享相同的提示.

如 Table 5 所示, 我们收集了一个超过 100 万二元比较的大型数据集, 称为 Meta 奖励建模数据. 与现有开源数据集相比, 我们的偏好数据具有更多的对话轮次, 平均长度更长.

#### Reward Modeling

奖励模型将模型响应及其对应提示 (包括前几轮的上下文) 作为输入, 输出标量分数以指示模型生成的质量 (如有用性和安全性). 利用这种响应分数作为奖励, 我们可以在 RLHF 期间优化 Llama 2-Chat 以更好对齐人类偏好并改进有用性和安全性.

其他人发现有用性和安全性有时存在权衡, 这使得单个奖励模型难以在两者上都表现良好. 为解决此问题, 我们训练两个独立的奖励模型, 一个针对有用性优化 (Helpfulness RM), 另一个针对安全性优化 (Safety RM).

我们从预训练聊天模型Checkpoint初始化奖励模型, 这确保两个模型都从预训练中获得的知识中受益. 简而言之, 奖励模型 "知道" 聊天模型知道什么. 这防止了两模型信息不匹配的情况, 例如可能导致偏向幻觉.

**Training Objectives.** 为训练奖励模型, 我们将收集的成对人类偏好数据转换为二元排名标签格式 (chosen & rejected), 并强制选择的响应具有比其对应项更高的分数. 我们使用与 
\citet{ouyang2022training} 一致的二元排名损失:

$$
\mathcal{L}_{\text{ranking}} = -\log(\sigma(r_\theta(x,y_{c}) - r_\theta(x,y_{r}))) \tag{1}
$$

其中 $r_\theta(x, y)$ 是提示 $x$ 和补全 $y$ 的标量分数输出, $y_{c}$ 是标注者选择的偏好响应, $y_{r}$ 是被拒绝的对应项.

在此二元排名损失之上, 我们进一步修改它以更好地用于有用性和安全性奖励模型. 鉴于偏好评级分解为四个点的量表 (显著更好等), 利用这些信息来显式地教奖励模型为差异更大的生成分配更差异的分数是有用的. 为此, 我们在损失中添加一个 margin 组件:

$$
\mathcal{L}_{\text{ranking}} = -\log(\sigma(r_\theta(x,y_{c}) - r_\theta(x,y_{r}) - m(r))) \tag{2}
$$

其中 margin $m(r)$ 是偏好评级的离散函数. 自然地, 我们对差异明显的响应对使用较大的 margin, 对相似的响应对使用较小的 margin.

> 带 margin 的排名损失是一个精巧的设计. 标准二元排名损失只关心 $y_c$ 的分数是否高于 $y_r$, 不关心高多少. 但人类标注的四级评级 (显著更好/更好/稍好/几乎相同) 包含了丰富的信号: 如果两个响应差异很大, 奖励模型应该给出一个大的分数差距; 如果几乎相同, 分数差距应该很小. 通过引入与偏好强度成正比的 margin, 损失函数强制奖励模型学习"置信度"——不仅知道哪个更好, 还知道好多少. 这提高了奖励模型的判别能力和稳定性.

**Data Composition.** 我们将新收集的数据与现有开源偏好数据集结合形成更大的训练数据集. Helpfulness 奖励模型最终在所有 Meta Helpfulness 数据上训练, 结合等量的从 Meta Safety 和开源数据集均匀采样的剩余数据. Safety 奖励模型在所有 Meta Safety 和 Anthropic Harmless 数据上训练, 与 Meta Helpfulness 和开源有用性数据按 90/10 比例混合.

**Reward Model Results.** 我们在多样化的人类偏好 benchmark 集上评估最终的有用性和安全性奖励模型. 如 Table 6 所示, 我们自己的奖励模型在我们基于 Llama 2-Chat 收集的内部测试集上表现最佳. 总体而言, 我们的奖励模型优于所有基线, 包括 GPT-4.

| | Meta Helpfu.

| Meta Safety | Anthropic Helpful | Anthropic Harmless | OpenAI Sum.

| Stanford SHP | Avg |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| SteamSHP-XL | 52.8 | 43.8 | 66.8 | 34.2 | 54.7 | 75.7 | 55.3 |
| Open Assistant | 53.8 | 53.4 | 67.7 | 68.4 | 71.7 | 55.0 | 63.0 |
| GPT4 | 58.6 | 58.1 | - | - | - | - | - |
| Safety RM | 56.2 | **64.5** | 55.4 | **74.7** | 71.7 | 65.2 | 64.3 |
| Helpfulness RM | **63.2** | 62.8 | **72.0** | 71.0 | **75.5** | **80.0** | **70.6** |

> Table 6: Reward model results. 我们最终的有用性和安全性奖励模型在多样化人类偏好 benchmark 集上的性能.

**Scaling Trends.** 我们研究了奖励模型在数据和模型大小方面的缩放趋势, 在每周收集的奖励模型数据 increasing 量上微调不同模型大小. 结果表明更大的模型在相似数据量下获得更高性能, 且缩放性能尚未 plateau, 表明还有更多改进空间.

#### Iterative Fine-Tuning

随着收到更多批人类偏好数据标注, 我们能够训练更好的奖励模型并收集更多提示. 因此我们训练了 RLHF 模型的连续版本, 称为 RLHF-V1, ..., RLHF-V5.

我们探索了两种主要算法进行 RLHF 微调:

- **Proximal Policy Optimization (PPO)**, RLHF 文献中的标准算法.
- **Rejection Sampling fine-tuning**. 我们从模型采样 $K$ 个输出, 并使用奖励选择最佳候选. 然后使用选定的输出进行梯度更新. 对于每个提示, 获得最高奖励分数的样本被视为新的 gold standard.

两种 RL 算法的主要区别在于:
- *广度* — 在 Rejection Sampling 中, 模型为给定提示探索 $K$ 个样本, 而 PPO 只进行一次生成.
- *深度* — 在 PPO 中, 训练步骤 $t$ 的样本是模型从 $t-1$ 步更新后的策略的函数. 在 Rejection Sampling 中, 我们在应用微调之前从模型的初始策略采样所有输出.

直到 RLHF-V4, 我们只使用 Rejection Sampling 微调, 之后我们按顺序组合两种算法, 在 Rejection Sampling Checkpoint上应用 PPO 后再采样.

**Rejection Sampling.** 我们只对最大的 70B Llama 2-Chat 执行拒绝采样. 所有较小模型在较大模型的拒绝采样数据上微调, 从而将大模型能力蒸馏到小模型中.

在每次迭代阶段, 我们从最新模型为每个提示采样 $K$ 个答案. 我们使用实验时可访问的最佳奖励模型为每个样本打分, 然后为给定提示选择最佳答案. 在 RLHF-V3 之前的早期版本中, 我们的方法仅将答案选择限制从前一次迭代收集的 "bag" 中. 然而, 尽管持续改进, 这种方法导致某些能力退化. 例如, RLHF-V3 在写诗时比先前版本更难以押韵, 表明遗忘可能是需要进一步研究的领域. 在后续迭代中, 我们修改策略, 纳入所有先前迭代的顶级样本. 这一调整显著提升了性能并有效解决了上述问题.

温度参数在探索中起重要作用, 更高的温度使我们能够采样更多样化的输出. 我们发现最优温度在迭代模型更新期间不是恒定的: RLHF 直接影响温度重缩放. 对于 Llama 2-Chat-RLHF, 在 10 到 100 个输出之间采样时的最优温度为 $T \in [1.2, 1.3]$.

**PPO.** 我们遵循 
\citet{stienon2020learning} 的 RL 方案, 使用奖励模型作为真实奖励函数 (人类偏好) 的估计, 预训练语言模型作为要优化的策略. 在此期间, 我们寻求优化以下目标:

$$
\arg \max _\pi \mathbb{E}_{p \sim \mathcal{D}, g \sim \pi}[R(g \mid p)] \tag{3}
$$

我们迭代改进策略, 从数据集 $\mathcal{D}$ 采样提示 $p$ 和从策略 $\pi$ 采样生成 $g$, 并使用 PPO 算法和损失函数实现此目标.

我们在优化期间使用的最终奖励函数:

$$
R(g \mid p) = \tilde{R}_{c}(g \mid p) - \beta D_{KL}(\pi_{\theta}(g \mid p) \parallel \pi_{0}(g \mid p)) \tag{4}
$$

包含偏离原始策略 $\pi_{0}$ 的惩罚项. 如其他工作观察到的, 我们发现此约束对训练稳定性和减少 reward hacking 有用.

我们将 $R_c$ 定义为安全性 ($R_s$) 和有用性 ($R_h$) 奖励模型的分段组合. 我们在数据集中标记可能引发潜在不安全响应的提示, 并优先使用安全模型的分数. 过滤不安全响应的阈值选择为 $0.15$, 对应于 Meta Safety 测试集上精确率 0.89 和召回率 0.55.

$$
R_c(g \mid p) = \begin{cases} R_s(g \mid p) & \text{if } \textsc{is\_safety}(p) \text{ or } R_s(g \mid p) < 0.15 \\ R_h(g \mid p) & \text{otherwise} \end{cases}
$$

$$
\tilde{R}_c(g \mid p) = \textsc{whiten}(\textsc{logit}(R_c(g \mid p)))
$$

对于所有模型, 我们使用 AdamW 优化器, $\beta_1 = 0.9, \beta_2 = 0.95, \text{eps} = 10^{-5}$, 权重衰减 $0.1$, 梯度裁剪 $1.0$, 恒定学习率 $10^{-6}$. 对于 7B 和 13B 模型, 我们设置 $\beta = 0.01$ (KL penalty), 对于 34B 和 70B 模型设置 $\beta = 0.005$. 我们对所有模型训练 200 到 400 次迭代, 并使用 held-out 提示上的评估进行早停.

> 分段奖励函数 $R_c$ 是 Llama 2 RLHF 的一个关键设计. 它解决了有用性和安全性之间的根本性 tension: 最 "有用" 的响应可能包含危险信息 (如炸弹制作), 而最 "安全" 的响应可能过度拒绝合法请求. 通过为对抗性提示优先使用 Safety RM, 为正常提示使用 Helpfulness RM, 系统实现了自适应的平衡. 阈值 0.15 的选择 (精确率 0.89, 召回率 0.55) 是一个偏向保守的设置——宁可误杀 (将安全响应标记为不安全) 也不放过真正的有害内容. 这种保守主义虽然提升了安全性, 但也导致了后续用户抱怨的 "过度拒绝" 问题.

### 3.3 System Message for Multi-Turn Consistency

在对话设置中, 某些指令应适用于所有对话轮次, 例如简洁回复或 "扮演" 某个公众人物. 当我们向 Llama 2-Chat 提供此类指令时, 后续响应应始终遵守约束. 然而, 我们的初始 RLHF 模型倾向于在几轮对话后忘记初始指令.

为解决这些限制, 我们提出 **Ghost Attention (GAtt)**, 一种受 Context Distillation 启发的非常简单的方法, 通过微调数据来帮助注意力在多轮过程中聚焦. GAtt 实现了跨多轮对话控制.

**GAtt Method.** 假设我们有一个两人之间的多轮对话数据集, 消息列表为 $[u_1, a_1, \ldots, u_n, a_n]$, 其中 $u_n$ 和 $a_n$ 分别对应第 $n$ 轮的用户和助手消息. 然后我们定义一个应在整个对话中遵守的指令 $inst$, 例如 "扮演...". 我们可以将此指令合成连接到对话的所有用户消息.

接下来, 我们使用最新的 RLHF 模型从此合成数据中采样. 我们现在有了上下文对话和用于微调模型的样本, 类似于 Rejection Sampling. 我们不是在所有上下文对话轮次中增强指令, 而是在除第一轮外的所有轮次中丢弃它, 但这会导致训练时系统消息与样本之间的不匹配. 为解决此问题, 我们简单地将前几轮所有 token 的损失设为 0, 包括助手消息.

**GAtt Evaluation.** 我们在 RLHF-V3 后应用了 GAtt. 定量分析表明 GAtt 在多达 20+ 轮中保持一致, 直到达到最大上下文长度. 我们尝试在推理时设置 GAtt 训练中不存在的约束, 例如 "始终用俳句回答", 模型仍然保持一致.

> GAtt 的设计非常巧妙且反直觉: 它在训练时将指令添加到所有用户消息中, 但在损失计算中屏蔽了中间轮次的指令 token. 这创造了一个 "幽灵" 效果——模型在训练时看到指令无处不在, 但只在第一轮显式地优化指令遵循, 后续轮次通过注意力机制隐式地保持对指令的 "记忆". 从注意力可视化的结果看, GAtt 模型在对话后期仍对系统消息保持高注意力激活, 而无 GAtt 模型在几轮后就 "遗忘" 了系统消息. 这是一个低成本但高回报的解决方案, 不需要修改模型架构, 只需要巧妙地构造训练数据.

### 3.4 RLHF Results

#### Model-Based Evaluation

为选择 RLHF-V1 到 V5 每次迭代中的最佳模型, 我们首先观察最新奖励模型的奖励改进, 以节省成本并提高迭代速度. 我们后来用人类评估验证主要模型版本.

如 Figure 2 所示, 在内部 Safety 和 Helpfulness 奖励模型的评估集上, 我们在 RLHF-V3 后在两个轴上都超越了 ChatGPT. 为公平比较, 我们额外使用 GPT-4 评估哪个生成更受偏好, 随机交换输出顺序以避免偏差. 我们最新的 Llama 2-Chat 获得了超过 60% 的胜率.

> 图 1: Llama 2-Chat 与其他开源和闭源模型的有用性人类评估结果. 人类评分者在约 4K 提示上比较模型生成.

> 图 2: Llama 2-Chat 与其他开源和闭源模型的安全性人类评估结果. 人类评分者在约 2,000 对抗性提示上评判模型生成.

#### Human Evaluation

人类评估通常被视为判断自然语言生成模型 (包括对话模型) 的黄金标准. 为评估主要模型版本的质量, 我们要求人类评估者在有用性和安全性上对它们进行评分. 我们在超过 4,000 个单轮和多轮提示上将 Llama 2-Chat 模型与开源模型 (Falcon、MPT、Vicuna) 以及闭源模型 (ChatGPT 和 PaLM) 进行比较.

如 Figure 3 所示, Llama 2-Chat 模型在单轮和多轮提示上都以显著优势超越开源模型. 特别是, Llama 2-Chat 7B 模型在 60% 的提示上超越 MPT-7B-chat. Llama 2-Chat 34B 对同等规模的 Vicuna-33B 和 Falcon 40B 模型的总体胜率超过 75%.

最大的 Llama 2-Chat 模型与 ChatGPT 竞争. Llama 2-Chat 70B 模型相对于 ChatGPT 的胜率为 36%, 平局率为 31.5%. Llama 2-Chat 70B 模型在我们的提示集上以很大百分比超越 PaLM-bison chat 模型.

> 图 3: 人类评估结果. Llama 2-Chat 模型与开源和闭源模型在约 4,000 个有用性提示上的比较.

---

## 4. Safety

### 4.1 Safety in Pretraining

**Steps Taken to Pretrain Responsibly.** 我们遵循 Meta 的标准隐私和法律审查流程. 我们没有在训练中使用任何 Meta 用户数据. 我们排除了某些已知包含大量私人个人信息网站的数据. 我们没有对数据集进行额外过滤, 以允许 Llama 2 在更多任务中更广泛可用, 同时避免过度清洗有时导致的人口统计抹除.

**Demographic Representation: Pronouns.** 在我们英语训练语料库中, 我们计算了最常见英语代词的频率. 我们观察到 He 代词在文档中通常比 She 代词过度代表. 这可能意味着模型在预训练期间学到的关于提到 She 代词的上下文较少.

**Demographic Representation: Identities.** 我们还通过测量 HolisticBias 数据集中人口统计身份词的使用率来分析预训练数据中不同人口统计群体的代表性. 我们观察到西方倾斜: 例如, "American" 在 69.4% 的参考文献中被提及, "European" 比其他种族更普遍, "Christian" 是最具代表性的宗教.

**Data Toxicity.** 我们使用在 ToxiGen 数据集上微调的 HateBERT 分类器测量预训练语料库英语部分中毒性的普遍程度. 约 0.2% 的文档被分配 0.5 或更高的毒性似然分数, 意味着预训练数据中有少量毒性.

**Language Identification.** 虽然预训练数据主要是英语, 但也包含少量其他语言的文本. 英语占 89.70%, 其余语言占比均低于 0.2%.

### 4.2 Safety Fine-Tuning

**Safety Categories and Annotation Guidelines.** 我们为安全标注定义了三个类别: 非法和犯罪行为、仇恨和有害活动、以及不合格的建议.

**Safety Supervised Fine-Tuning.** 我们从人类收集的安全提示开始, 要求 annotator 写他们认为可能诱发潜在不安全模型行为的提示. 然后要求 annotator 写安全和不安全的响应. 安全响应通常是期望的: 承认请求、提供有用的相关信息、提供其他相关建议, 或在不安全请求的情况下拒绝回答.

**Safety RLHF.** 我们遵循与有用性相同的 RLHF 流程, 但专注于安全性. 我们使用不同的数据分布来训练安全奖励模型. 我们收集具有潜在安全风险的对抗性提示, 并要求 annotator 根据安全指南提供安全和不安全的响应. 然后训练安全奖励模型识别偏好 (安全) 和非偏好 (不安全) 响应.

**Context Distillation for Safety.** 我们使用一种称为 Context Distillation 的技术来进一步增强安全性. 我们在安全系统提示 (例如 "你是一个有帮助且安全的 AI 助手...") 的存在下从模型采样, 然后在没有系统提示的情况下微调模型以生成相同的输出. 这有效地将系统提示的约束蒸馏到模型本身中, 使其在没有显式系统提示的情况下也能表现出安全行为.

### 4.3 Red Teaming

我们与外部供应商合作进行红队测试, 以从具有不同背景和专业知识的个人那里获得对抗性输入. 红队测试者被指示尝试使模型产生有害输出. 我们收集了约 2,000 个对抗性提示, 用于安全微调和评估.

### 4.4 Safety Evaluation of Llama 2-Chat

我们在安全 benchmark 上评估 Llama 2-Chat, 包括内部收集的对抗性提示和公开的安全 benchmark. Llama 2-Chat 在安全性上显著优于开源模型, 与 ChatGPT 相当.

---

## 5. Discussion

### 5.1 Learnings and Observations

**Beyond Human Supervision.** 在项目初期, 许多人偏好监督标注, 而被认为不稳定的强化学习对 NLP 研究者似乎是一个阴暗领域. 然而, 强化学习被证明非常有效, 特别是在成本和时间效率方面. 我们的发现强调, RLHF 成功的关键决定因素在于它在标注过程中促进了人类与 LLM 之间的协同作用.

即使熟练的标注者, 每个人写作风格也有显著差异. 在 SFT 标注上微调的模型学习了这种多样性, 包括不幸的是 poorly executed 标注的尾部. 此外, 模型的性能上限由最熟练标注者的写作能力决定. 人类标注者在比较两个输出的偏好标注时, 差异较小. 因此, 奖励机制迅速学会给不希望的尾部分布分配低分, 并向人类偏好对齐. 这引出了一个深刻的观点: **监督数据可能不再是黄金标准**.

**In-Context Temperature Rescaling.** 我们观察到一个与 RLHF 相关的有趣现象: 温度根据上下文动态重缩放. 对于创造性提示 (如 "写一首诗"), 温度升高继续在各 RLHF 迭代中生成多样性. 但对于事实性提示 (如 "什么是...的首都"), Self-BLEU 斜率随时间下降, 表明尽管温度升高, 模型学会对事实性提示始终提供相同响应.

**Llama 2-Chat Temporal Perception.** 我们的模型展示了令人印象深刻的泛化能力. 我们手动测试了数十个示例, 一致观察到模型展示了以时间方式组织其知识的强大能力, 即使提供极少数据. 为向 Llama 2-Chat 灌输时间概念, 我们收集了 1,000 个与特定日期相关的 SFT 示例. 观察表明, LLM 内化了时间概念, 尽管训练仅基于随机打乱而不考虑时间顺序的下一 token 预测.

**Tool Use Emergence.** 我们的实验表明, 工具使用可以从对齐中自发出现, 以 zero-shot 方式. 尽管我们从未显式标注工具使用, 模型展示了在 zero-shot 上下文中使用工具序列的能力. 此外, 我们在数学数据集上评估了带有计算器访问权限的 Llama 2-Chat, 结果显著优于 Toolformer 基线.

| Model | ASDiv | SVAMP | MAWPS |
|:---|:---:|:---:|:---:|
| OPT-66B | 6.0 | 4.9 | 7.9 |
| GPT-J | 7.5 | 5.2 | 9.9 |
| GPT-J + CC | 9.6 | 5.0 | 9.3 |
| GPT-3 | 14.0 | 10.0 | 19.8 |
| Toolformer | 40.4 | 29.4 | 44.0 |
| Llama 2-Chat | **67.1** | **69.2** | **82.4** |

> Table 7: Performance with tool use. 在 Toolformer 使用的数学数据集上的评估.

> 工具使用的自发出现是 LLM 领域最引人注目的发现之一. Llama 2-Chat 从未在工具使用数据上训练, 却能理解工具的语义、API 参数, 并能在 zero-shot 上下文中使用工具序列. 这暗示了一个深刻的可能性: 足够强大的语言模型可能不需要专门的工具训练——对齐过程本身就能激发模型利用外部资源的倾向. 这与 "涌现能力" (emergent abilities) 的文献一致: 某些能力不是通过显式训练获得的, 而是在模型规模和对齐程度达到某个阈值后自然出现的. 然而, 这也带来了安全担忧: 如果模型能自发学会使用工具, 它也可能学会使用危险工具或被恶意利用.

### 5.2 Limitations and Ethical Considerations

Llama 2-Chat 受制于与其他 LLM 相同的公认限制, 包括预训练后知识更新的停止、非事实生成的潜力 (如不合格的建议) 以及幻觉倾向.

此外, 我们初始版本的 Llama 2-Chat 主要集中于英语数据. 虽然实验观察表明模型在其他语言中获得了一定熟练度, 但其熟练度有限, 主要是由于非英语语言的预训练数据量有限. 因此, 模型在非英语语言中的性能仍然脆弱, 应谨慎使用.

与其他 LLM 一样, Llama 2 可能生成有害、冒犯或有偏见的内容. 我们尝试通过微调来缓解此问题, 但某些问题可能仍然存在.

虽然试图在安全性与有用性之间取得合理平衡, 但在某些情况下, 我们的安全微调可能过度. Llama 2-Chat 的用户可能观察到过于谨慎的方法, 模型倾向于拒绝某些请求或用太多安全细节响应.

### 5.3 Responsible Release Strategy

我们使 Llama 2 可用于研究和商业用途. 使用 Llama 2 的人必须遵守提供许可证的条款和我们的 Acceptable Use Policy, 该政策禁止任何会违反适用政策、法律、规则和法规的使用.

我们还提供代码示例来帮助开发者复现我们的安全生成, 并在用户输入和模型输出层应用基本安全技术.

---

## 6. Related Work

**Large Language Models.** 近年来, LLM 领域经历了实质性的发展. 从 GPT-3 到 Gopher 或专门模型 (如 Galactica), 规模不断扩展. Chinchilla 用 70B 参数重新定义了这些缩放定律, 强调 token 数量而非模型权重. 在此过程中, Llama 因其专注于推理期间的计算效率而受到认可. 关于开源与闭源模型的动态并行展开. 开源发布如 BLOOM、OPT 和 Falcon 已经崛起挑战闭源对手. 然而, 当涉及 "生产就绪" LLM 如 ChatGPT、Bard 和 Claude 时, 在性能和可用性上存在明显区别.

**Instruction Tuning.** 
\citet{weifinetuned} 通过在多个数据集上微调 LLM 获得了 unseen 任务的 zero-shot 性能. RLHF 已成为微调大型语言模型的强大策略, 使性能显著提升. 
\citet{ouyang2022training} 证明指令微调和 RLHF 的组合可以帮助修复事实性、毒性和有用性问题.

**Known LLM Safety Challenges.** 近期文献广泛探索了与 LLM 相关的风险和挑战, 包括偏见、毒性、私人数据泄露和恶意使用潜力. 红队测试研究揭示了微调 LLM 中的具体挑战.

---

## 7. Conclusion

在本文中, 我们介绍了 Llama 2, 一系列预训练和微调的语言模型, 规模高达 70B 参数, 以及 Llama 2-Chat 的变体, 为对话应用微调. 这些模型在测试的公开可用模型上展示了强劲性能. 我们分享了我们的微调方法论和安全方法, 希望为社区提供参考并加速 LLM 的负责任开发.

---

## 附录 A: 术语表

| 英文术语 | 中文译名 | 首次出现 | 简要解释 |
|:---|:---|:---|:---|
| RLHF | 基于人类反馈的强化学习 | Introduction | 通过人类偏好反馈训练奖励模型来优化语言模型的方法 |
| GQA | 分组查询注意力 | Section 2 | 将 Query 头分组共享 KV 头的注意力机制, 减少推理 KV Cache |
| SFT | 监督微调 | Section 3.1 | 在标注数据上微调预训练模型 |
| PPO | 近端策略优化 | Section 3.2 | 一种强化学习算法, 限制策略更新幅度以提高稳定性 |
| Rejection Sampling | 拒绝采样 | Section 3.2 | 从模型采样多个输出, 用奖励模型选择最佳进行微调 |
| RM | 奖励模型 | Section 3.2 | 评估模型输出质量的标量评分模型 |
| GAtt | 幽灵注意力 | Section 3.3 | 通过数据构造实现多轮对话中系统消息一致性的技术 |
| Context Distillation | 上下文蒸馏 | Section 4.2 | 将系统提示的约束蒸馏到模型本身的技术 |
| Red Teaming | 红队测试 | Section 4.3 | 邀请专家尝试使模型产生有害输出的对抗性测试 |
| Self-BLEU | 自 BLEU | Section 5.1 | 衡量模型输出多样性的指标, 越低表示多样性越高 |

---

## 附录 B: 核心公式索引

| 编号 | 公式 | 所在章节 | 说明 |
|:---|:---|:---|:---|
| (1) | $\mathcal{L}_{\text{ranking}} = -\log(\sigma(r_\theta(x,y_{c}) - r_\theta(x,y_{r})))$ | Reward Modeling | 标准二元排名损失 |
| (2) | $\mathcal{L}_{\text{ranking}} = -\log(\sigma(r_\theta(x,y_{c}) - r_\theta(x,y_{r}) - m(r)))$ | Reward Modeling | 带 margin 的改进排名损失 |
| (3) | $\arg \max _\pi \mathbb{E}_{p \sim \mathcal{D}, g \sim \pi}[R(g \mid p)]$ | PPO | RLHF 优化目标 |
| (4) | $R(g \mid p) = \tilde{R}_{c}(g \mid p) - \beta D_{KL}(\pi_{\theta} \parallel \pi_{0})$ | PPO | 带 KL 惩罚的最终奖励函数 |

---

## 附录 C: 模型谱系定位

- **直接继承自**: LLaMA-1 (架构基础), InstructGPT/ChatGPT (RLHF 流程), LIMA (质量>数量的 SFT 理念)
- **核心创新**: (1) 双奖励模型分离有用性与安全性; (2) Rejection Sampling + PPO 迭代 RLHF; (3) GAtt 多轮一致性; (4) Context Distillation 安全增强; (5) 纯公开数据 + 商用许可
- **被后续工作引用**: CodeLlama, Llama 3/4, Mistral, 整个开源对话模型生态
