---
title: "Gemma-1 技术报告逐译与译者注"
---

# Gemma-1 技术报告逐译与译者注

> 🔙 **[返回 14.10-Gemma 家族总览](../../14.10-Gemma.md)**


> 基于 `03-Gemma-1-mineru-en.md` 逐段对照翻译.
> 每段英文后紧跟中文译文, > 译者注: 标注技术思考节点.

---

## Abstract

We present Gemma, a family of lightweight, state-of-the art open models built from the same research and technology used to create the Gemini models.

我们在此介绍 Gemma, 一个基于 Google Gemini 模型构建的轻量级、最先进的开放模型家族.

We provide both pre-trained and instruction-tuned checkpoints for Gemma models with 2B and 7B parameters, and a Gemma tokenizer.

我们为 Gemma 2B 和 7B 参数模型提供预训练和指令微调后的检查点, 以及一个 Gemma tokenizer.

The Gemma models demonstrate strong performance across academic benchmarks for language understanding, reasoning, and safety.

Gemma 模型在语言理解、推理和安全性等学术基准测试上展现出强大的性能.

We release both the pre-trained and fine-tuned checkpoints under a permissive license to enable broad access for research and commercial use, along with detailed information about their development.

我们在宽松的许可下发布预训练和微调后的检查点, 以实现广泛的研究和商业用途访问, 同时提供关于其开发的详细信息.

We believe the responsible release of LLMs is critical for improving the safety of frontier models, and for enabling the next wave of innovation in LLMs.

我们相信, 负责任地发布大语言模型对于改进前沿模型的安全性以及推动下一代大语言模型创新至关重要.

> 译者注: Gemma-1 摘要的措辞非常谨慎. "permissive license"(宽松许可)在实际使用中并非完全开放——Gemma 的许可禁止某些用例(如军事、监控), 并要求超过一定规模部署时通知 Google. 这与 Apache 2.0 或 MIT 等真正宽松的开源许可有本质区别. Google 在这里使用了"宽松"一词的相对含义(相对于完全不开放), 但开发者需要仔细阅读实际许可条款.

---

## 1 Introduction

We present Gemma, a family of lightweight, state-of-the art open models built from the same research and technology used to create the Gemini models (Gemini Team, 2023).

我们在此介绍 Gemma, 一个基于 Google Gemini 模型构建的轻量级、最先进的开放模型家族.

The Gemma models demonstrate strong performance across academic benchmarks for language understanding, reasoning, and safety. We release two sizes of models (2 billion and 7 billion parameters), both offering pre-trained and fine-tuned checkpoints. Gemma outperforms other open models on 11 out of 18 text-based tasks, and we present comprehensive evaluations of model safety and responsibility alongside detailed descriptions of model development. We believe that the responsible release of LLMs is critical for improving the safety of frontier models, and for enabling the next wave of innovation in LLMs.

Gemma 模型在语言理解、推理和安全性等学术基准测试上展现出强大的性能. 我们发布了两种规模的模型(20 亿和 70 亿参数), 并提供预训练和微调后的检查点. Gemma 在 18 项基于文本的任务中有 11 项优于同等规模的开源模型, 并且我们提出了对模型安全性和责任性方面的全面评估, 以及模型开发的详细描述. 我们相信, 负责任地发布大语言模型对于改进前沿模型的安全性以及推动下一代大语言模型创新至关重要.

Using the architecture, data, and training recipe inspired by the Gemini model family, we train Gemma models on up to 6T tokens of text. Like Gemini, these models achieve strong generalist capabilities in the text domain, alongside state-of-the-art understanding and reasoning skills at scale. With this work, we release pre-trained and fine-tuned checkpoints, alongside an open-source codebase for inference and serving.

我们使用受 Gemini 模型家族启发的架构、数据和训练配方, 在最多 6T token 的文本上训练 Gemma 模型. 与 Gemini 一样, 这些模型在文本领域实现了强大的通用能力, 以及规模化的最先进的理解和推理技能. 通过本工作, 我们同时发布了预训练和微调后的检查点, 以及用于推理和服务的开源代码库.

Gemma comes in two sizes: a 7 billion parameter model, designed for efficient deployment and development on GPU and TPU, and a 2 billion parameter model for CPU and on-device applications. Each size is designed to address different computational constraints, applications, and developer requirements. At each size, we release both the raw, pre-trained checkpoints, and checkpoints fine-tuned for conversation, instruction-following, helpfulness, and safety. We thoroughly evaluate our model for failure modes on a suite of quantitative and qualitative benchmarks. We believe that the release of both the pre-trained and fine-tuned checkpoints together will aid research into the current effect of fine-tuning mechanisms, as well as the development of increasingly safe and responsible approaches to model development.

Gemma 有两种规模: 一个 70 亿参数模型, 用于在 GPU 和 TPU 上进行高效部署和开发; 以及一个 20 亿参数模型, 用于 CPU 和端侧应用. 每种规模都旨在应对不同的计算约束、应用和开发者需求. 在每个规模上, 我们都发布了原始预训练检查点, 以及为对话、指令遵循、有用性和安全性进行微调的检查点. 我们在一套定量和定性基准测试上全面评估了我们模型的不足之处. 我们相信, 同时发布预训练和微调后的检查点将有助于深入研究当前指令微调机制的影响, 以及开发越来越安全和负责任的模型开发方法.

Gemma significantly advances state-of-the-art performance relative to similarly sized (and some much larger) open models (Jiang et al., 2023; Touvron et al., 2023b,a; Almazrouei et al., 2023) across a range of automated benchmarks and human evaluations.

Gemma 在多种自动化基准测试和人工评估中, 相对于同等规模(甚至某些更大规模)的开源模型显著推进了最先进的性能.

Example domains include question answering (Clark et al., 2019; Kwiatkowski et al., 2019), commonsense reasoning (Sakaguchi et al., 2019; Suzgun et al., 2022), mathematics and science (Cobbe et al., 2021; Hendrycks et al., 2020), and coding (Austin et al., 2021; Chen et al., 2021). See evaluation section for full details.

示例领域包括问答、常识推理、数学和科学以及编程. 详见评估部分.

While we have thoroughly tested our Gemma models, these tests cannot cover all scenarios in which Gemma may be used. Given this, all users of Gemma should conduct rigorous safety testing specific to their use cases before deployment or use. See the responsible deployment section for more details of our safety approach.

虽然我们对所有 Gemma 模型进行了全面测试, 但这些测试无法覆盖 Gemma 可能被使用的所有应用场景. 鉴于此, 所有 Gemma 用户在部署或使用前都应针对其具体用例进行严格的安全测试. 关于我们安全性方法的更多细节, 请参阅"负责任部署"部分.

> 译者注: "所有用户都应进行严格的安全测试"——这是一种责任转移策略. Google 通过这一声明将部分安全责任从模型发布者转移到了下游使用者. 这在法律上可能是必要的(限制 liability), 但在实践中, 大多数个人开发者和中小企业并不具备进行"严格安全测试"的资源和技术能力. 这揭示了一个核心张力: 开放模型的民主化访问与责任分配之间的不对称性.

---

## 2 Model Architecture

The Gemma model architecture is based on the Transformer decoder (Vaswani et al., 2017). The core parameters of the architecture are summarized in Table 1. Models are trained with a context length of 8192 tokens.

Gemma 模型架构基于 Transformer 解码器. 架构的核心参数总结于表 1 中. 模型在 8192 token 的上下文长度上训练.

| Parameters | 2B | 7B |
|---|---|---|
| d_model | 2048 | 3072 |
| Layers | 18 | 28 |
| Feedforward hidden dims | 32768 | 49152 |
| Num heads | 8 | 16 |
| Num KV heads | 1 | 16 |
| Head size | 256 | 256 |
| Vocab size | 256128 | 256128 |

We also leverage several improvements that have been proposed since the original Transformer paper, listed below.

我们还利用了原始 Transformer 论文之后提出的几项改进, 并在下面列出.

**Multi-Query Attention (Shazeer, 2019).** Notably, the 7B model uses multi-head attention, while the 2B checkpoints use multi-query attention (where num_kv_heads=1), based on ablations indicating that multi-query attention works well at smaller scales (Shazeer, 2019).

**多查询注意力.** 值得注意的是, 7B 模型使用多头注意力, 而 2B 检查点使用多查询注意力(其中 num_kv_heads=1), 基于消融实验表明多查询注意力在小规模上表现良好.

> 译者注: MQA 是 Gemma-1 2B 模型的关键架构选择. 标准 MHA 中每个注意力头都有独立的 K 和 V 投影, 导致 KV Cache 内存与头数成正比. MQA 让所有头共享同一组 K 和 V, 将 KV Cache 内存降低到原来的 1/num_heads. 对于 2B 这种端侧模型, 推理时的内存占用比训练时的计算量更重要. 但 MQA 的代价是表达能力下降: 单个 KV 头需要编码所有注意力头所需的信息, 这在复杂任务上可能导致质量损失. Gemma-1 的 7B 模型保留了 MHA, 说明 Google 认为在 7B 规模上, MQA 的质量损失不再可接受. 后续 Gemma-2 统一使用 GQA(分组查询注意力), 这是对 MHA 和 MQA 的折中.

**RoPE Embeddings (Su et al., 2021).** Rather than using absolute positional embeddings, we use rotary positional embeddings in each layer; we also share the input and output embeddings to reduce model size.

**RoPE 嵌入.** 我们不使用绝对位置嵌入, 而是在每一层使用旋转位置嵌入; 我们还在输入和输出之间共享嵌入, 以减少模型大小.

**GeGLU Activations (Shazeer, 2020).** The standard ReLU non-linearity is replaced with approximate versions of GeGLU activations.

**GeGLU 激活.** 标准的 ReLU 非线性被 GeGLU 激活函数的近似版本所替代.

**RMSNorm.** We use RMSNorm (Zhang and Sennrich, 2019) to normalize the input of each Transformer sub-layer, the attention layer and the feedforward layer, for training stability.

**RMSNorm.** 我们使用 RMSNorm 对每个 Transformer 子层(注意力层和前馈层)的输入进行归一化, 以稳定训练.

| Model | Embedding Parameters | Non-embedding Parameters |
|---|---|---|
| 2B | 524,550,144 | 1,981,884,416 |
| 7B | 786,825,216 | 7,751,248,896 |

We inherit the large Gemini vocabulary (256k entries), which is designed to handle a large number of languages, and so the embedding parameter counts are consequently larger than models limited to one or a few languages.

我们继承了大型 Gemini 词表(256k 条目), 该词表设计用于处理大量语言, 因此与仅限于一种或少数几种语言的模型相比, 嵌入参数计数更大.

> 译者注: 256k 词表是一个巨大的词表. 作为对比, LLaMA-2 使用 32k 词表, Mistral 使用 32k, GPT-3 使用 50k. 大词表的优势是可以更好地处理多语言和特殊符号, 但代价是嵌入层参数量巨大(2B 模型中嵌入参数占 26%). 输入-输出嵌入共享(input-output embedding tying)可以缓解这一问题, 但无法完全消除. 这种设计选择反映了 Gemini 的全球化定位, 但 Gemma 的实际训练数据"主要由英文组成", 这意味着多语言词表的优势并未被充分利用.

---

## 3 Training Infrastructure

We train Gemma models using TPUv5e; TPUv5e is deployed in pods of 256 chips arranged in a 16 x 16 chip 2D torus. For the 7B model, we train on 16 pods, giving us a total of 4096 TPUv5e. We pre-train the 2B model on 2 pods, for a total of 512 TPUv5e. Within a pod, we use 16-way model sharding and 16-way data replication for the 7B model. For the 2B model, we simply use 256-way data replication. The optimizer state is further sharded using techniques similar to ZeRO-3. Beyond the pod, we use the Pathways approach (Barham et al., 2022) to perform data-replica reduction over the data-center network.

我们使用 TPUv5e 训练 Gemma 模型; TPUv5e 以 256 个芯片的 pod 部署, 配置为 16 x 16 芯片的 2D 环面. 对于 7B 模型, 我们在 16 个 pod 上训练, 共 4096 个 TPUv5e. 我们在 2 个 pod 上预训练 2B 模型, 共 512 个 TPUv5e. 在 pod 内, 我们对 7B 模型使用 16 路模型分片和 16 路数据复制. 对于 2B 模型, 我们简单地使用 256 路数据复制. 优化器状态使用类似 ZeRO-3 的技术进一步分片. 超出 pod 范围, 我们使用 Pathways 方法通过数据中心网络执行数据副本间的规约.

Following Gemini, we leverage Jax (Roberts et al., 2023) and Pathways (Barham et al., 2022) "single controller" programming paradigm which simplifies the development process by enabling a single Python process to orchestrate the entire training run; we also use the GSPMD partitioner (Xu et al., 2021) for training step computation and the MegaScale XLA compiler (XLA, 2019).

我们遵循 Gemini, 利用 Jax 和 Pathways 的"单控制器"编程范式. 这通过启用单个 Python 进程来编排整个训练运行, 从而简化了开发过程; 我们还利用 GSPMD partitioner 进行训练步骤计算, 以及 MegaScale XLA 编译器.

> 译者注: "单控制器"(single controller)是 Google 分布式训练栈的一个关键设计. 与 PyTorch 的每个 rank 独立运行不同, Jax/Pathways 使用一个 Python 进程控制所有设备, 通过编译器(XLA)自动生成并行代码. 这种设计的优势是开发简单(无需手动处理进程间通信), 但代价是调试困难——当分布式训练出现问题时, 错误信息往往来自编译器生成的底层代码, 而非用户代码. 此外, Pathways 使用数据中心网络(DCN)进行跨 pod 通信, 带宽远低于 pod 内部的芯片间互联(ICI), 这意味着 Gemma 的训练主要受限于 pod 内部的计算.

### 3.1 Carbon Footprint

We estimate the carbon emissions for pre-training the Gemma models to be approximately 131 tCO2eq. This value is calculated based on the energy-usage-per-hour directly reported by our TPU data centers; we also scale this value to account for the additional energy usage consumed in creating and maintaining the data center, giving the total energy usage for the training experiment. We convert the total energy usage to carbon emissions by combining the total energy usage with the per-datacenter per-hour per-carbon-unit emissions data reported by the data centers.

我们估计预训练 Gemma 模型的碳排放量约为 131 tCO2eq. 该值基于直接从我们的 TPU 数据中心报告的每小时能源使用量计算; 我们还缩放该值以考虑创建和维护数据中心所消耗的额外能源, 从而得到训练实验的总能源使用量. 我们通过将总能源使用量与数据中心报告的每小时每单元碳排放数据相结合, 将总能源使用量转换为碳排放量.

Additionally, Google data centers are carbon neutral through a combination of energy efficiency, renewable energy purchases, and carbon offsets. This carbon neutrality applies to our experiments and the machines on which they are run.

此外, Google 数据中心通过能源效率、可再生能源购买和碳抵消的组合实现了碳中和. 这种碳中和适用于我们的实验和运行它们的机器.

> 译者注: 131 tCO2eq 是一个相对较低的碳排放数字. 作为对比, GPT-3(175B)的训练碳排放估计约为 552 tCO2eq, LLaMA-2 70B 约为 291 tCO2eq. Gemma-1 的低碳足迹部分归因于 TPU 的能效优势. 但这里也需要注意"碳中和"声明的局限性: Google 通过"碳抵消"实现碳中和, 这意味着实际排放了 131 吨 CO2, 但通过购买碳信用额度来"抵消". 这种会计方法在业界存在争议, 因为它不减少实际排放. 此外, 6T token 的训练数据量相对较小(作为对比, LLaMA-2 7B 使用了 2T token, 但 LLaMA-2 70B 使用了 2T token——Gemma 7B 的 6T 是 LLaMA-2 7B 的 3 倍), 这可能也是碳排放较低的原因之一.

---

## 4 Pretraining

### 4.1 Training Data

Gemma 2B and 7B are trained on 3T and 6T tokens respectively of web documents, mathematics, and code, primarily in English. Unlike Gemini, these models are not multimodal, nor are they trained for state-of-the-art multilingual performance.

Gemma 2B 和 7B 分别在 3T 和 6T token 的、主要由英文数据组成的网页文档、数学和代码上训练. 与 Gemini 不同, 这些模型不是多模态的, 也没有针对最先进的多语言任务性能进行训练.

We use a subset of the SentencePiece tokenizer (Kudo and Richardson, 2018) used in Gemini, to ensure compatibility. It splits digits, preserves whitespace, and relies on byte-level encodings for unknown tokens, following the technique used in Chowdhery et al. (2022) and Gemini Team (2023). The vocabulary size is 256k tokens.

我们使用 Gemini 的 SentencePiece tokenizer 的子集以保持兼容性. 它分割数字, 不移除额外的空白, 并对未知 token 依赖字节级编码, 遵循 Chowdhery 等人和 Gemini Team 使用的技术. 词表大小为 256k token.

### 4.2 Filtering

We filter our pre-training dataset to reduce the risk of generating unwanted or unsafe utterances, and filter out certain personal information or other sensitive data. This includes using heuristic and model-based classifiers to remove harmful or low-quality content. In addition, we filter all evaluation sets from our pre-training data mixture, run targeted contamination analysis to check for evaluation set leakage, and minimize the proliferation of sensitive outputs through minimization of memorization risk.

我们过滤预训练数据集以减少产生不需要或不安全话语的风险, 并过滤掉某些个人信息或其他敏感数据. 这包括使用启发式和基于模型的分类器来去除有害或低质量内容. 此外, 我们从预训练数据混合中过滤掉所有评估集, 运行针对性的污染分析以检查评估集泄漏, 并通过最小化敏感输出的扩散来降低背诵的风险.

The final data mixture and proportions were determined through a series of ablations on 2B and 7B models. Similar to the approach advocated in Gemini Team (2023), we stage training and alter the corpus mixture composition during training, upweighting relevant, high-quality data towards the end of training.

最终的数据混合比例通过在 2B 和 7B 模型上的一系列消融实验确定. 类似于 Gemini Team 倡导的方法, 我们分阶段训练, 在训练过程中改变语料库混合比例, 在训练结束时增加相关、高质量数据的权重.

> 译者注: "分阶段训练"(staged training)是 Gemma-1 数据策略的一个关键细节. 在训练初期, 模型主要学习通用的语言结构和知识; 在训练后期, 增加高质量数据(如代码、数学、科学文献)的比例, 可以使模型在这些领域获得更精细的能力. 这与传统的"固定数据混合"策略不同. 分阶段训练的理论依据是: 早期阶段模型需要广泛接触各种数据以建立基础表征, 后期阶段则可以专注于提升特定领域的能力. 但这种策略也增加了调参复杂度——需要确定何时切换阶段、切换后的混合比例是多少. 后续研究表明, 这种"退火"(annealing)策略在许多高质量模型训练中都有应用.

---

## 5 Instruction Tuning

We fine-tune Gemma 2B and 7B with supervised fine-tuning (SFT) on a mixture of text-only, English-only synthetic and human-generated prompt-response pairs, and further train using reinforcement learning from human feedback (RLHF), with reward models trained on labeled English-only preference data and policies based on a set of high-quality prompts. We find both stages are important for improving performance on downstream automated evaluation and model output preference evaluation rated by humans.

我们使用监督微调(SFT)在混合了纯文本、纯英文的合成和人工生成的提示-响应对上对 Gemma 2B 和 7B 进行微调, 并使用基于人类反馈的强化学习(RLHF)进一步训练, 奖励模型在标注的纯英文偏好数据上训练, 策略基于一组高质量提示. 我们发现两个阶段对于改进下游自动评估和模型输出的人工偏好评估的性能都很重要.

### 5.1 Supervised Fine-Tuning

We choose a data mixture for SFT based on LM-based side-by-side evaluation (Zheng et al., 2023). Given a set of held-out prompts, we generate responses from the test model, generate responses from a baseline model on the same prompts, shuffle the responses, and ask a larger, higher-capability model to express a preference between the two responses. Different prompt sets are constructed to highlight specific capabilities, such as instruction following, factuality, creativity, and safety. Our LM-based judges use a range of known techniques, such as chain-of-thought prompting (Wei et al., 2022), rubrics, and constitution (Bai et al., 2022), to align with human preferences.

我们基于 LM-based 的并排评估选择 SFT 的数据混合. 给定一组保留的提示, 我们从测试模型生成响应, 从基线模型在相同提示上生成响应, 随机打乱这些响应, 并要求一个更大、更高能力的模型表达对两个响应的偏好. 不同的提示集被构建以突出特定能力, 如指令遵循、事实性、创造性和安全性. 我们的 LM-based 评判者采用多种已知策略, 如链式思维提示、评分标准和宪法, 以与人类偏好对齐.

> 译者注: "LM-based 评判者"(即使用更大模型作为自动评估器)是 Google 对齐流程的一个关键特征. 这种方法的优势是可扩展性(无需大量人工标注), 但引入了系统性偏差: 自动评估器可能偏爱某些风格(如更正式的语言、更长的回答), 并且可能复制自身的偏见. 此外, "constitution"(宪法)方法引自 Anthropic 的 Constitutional AI, 但 Google 没有公开其宪法的具体内容, 这限制了外部审计的可能性.

### 5.2 Filtering

When using synthetic data, we run several stages of filtering to remove examples that display certain personal information, unsafe or toxic model outputs, mistaken self-identification data, or duplicate examples. Following Gemini, we find that including subsets of data that encourage better context-attribution, hedging, and refusal improves performance on factuality metrics without reducing performance on other metrics.

在使用合成数据时, 我们对其运行多个过滤阶段, 去除显示某些个人信息、不安全或有毒模型输出、错误自我识别数据或重复示例的数据. 遵循 Gemini 的做法, 我们发现包含鼓励更好的上下文归因、对冲和拒绝的数据子集可以提高事实性指标上的性能, 而不会降低模型在其他指标上的性能.

The final data mixture and SFT recipe, including tuned hyperparameters, are selected based on improving helpfulness while minimizing model harms related to safety and hallucination.

最终的数据混合和 SFT 配方(包括调整后的超参数)是在提高有用性的同时最小化与安全性和幻觉相关的模型危害的基础上选择的.

> 译者注: "错误自我识别数据"(mistaken self-identification data)是指模型错误地声称自己是另一个 AI(如 GPT-4 或 Claude)的训练数据. 这是指令微调中的一个常见问题——如果合成数据由另一个大模型生成, 学生模型可能会继承生成模型的"身份认同". 例如, 如果 SFT 数据包含 "I am Claude, an AI assistant made by Anthropic", 微调后的 Gemma 可能会在自己生成中也包含类似表述. Google 明确过滤这类数据, 说明他们意识到了这个问题. 后续研究发现, 即使经过过滤, 开源模型仍有一定概率在特定提示下产生错误的自我识别.

### 5.3 Formatting

The instruction-tuned models are trained with a specific formatter that annotates additional information in all instruction tuning examples both at training and inference time. It has two purposes: 1) indicating roles within a conversation, such as the user role; 2) delineating turns in a conversation, especially in a multi-turn conversation. To this end, special control tokens are reserved in the tokenizer.

指令微调模型使用特定的格式化器进行训练, 该格式化器在训练和推理时都为所有指令微调示例标注额外信息. 它有两个目的: 1) 指示对话中的角色, 如用户角色; 2) 划定对话中的轮次, 特别是在多轮对话中. 为此, 在 tokenizer 中保留了特殊的控制 token.

| Context | Relevant Token |
|---|---|
| User turn | user |
| Model turn | model |
| Start of conversation turn | <start_of_turn> |
| End of conversation turn | <end_of_turn> |

While coherent generations are likely possible without the formatter, it is out-of-distribution for the model and will likely produce worse generations.

虽然不使用格式化器也可能获得连贯的生成, 但这对模型来说是分布外的, 很可能会产生更差的生成.

### 5.4 Reinforcement Learning from Human Feedback

We further fine-tune the supervised fine-tuned model using RLHF (Christiano et al., 2017; Ouyang et al., 2022). We collect preference pairs from human raters, and train a reward function under a Bradley-Terry model (Bradley and Terry, 1952), similarly to Gemini.

我们进一步使用 RLHF 对监督微调后的模型进行微调. 我们从人类评分员收集偏好对, 并在 Bradley-Terry 模型下训练奖励函数, 类似于 Gemini.

The policy is trained to optimize this reward function using a novel reinforcement learning algorithm.

策略被训练以使用一种新颖的强化学习算法来优化该奖励函数.

> 译者注: "新颖的强化学习算法"——Gemini/Gemma 的 RLHF 算法细节从未完全公开. 业界普遍猜测 Google 使用了某种形式的 PPO 变体或 REINFORCE 的改进版本. 与 OpenAI 的 InstructGPT 和 Anthropic 的 Constitutional AI 不同, Google 没有公开其 RLHF 的具体算法细节, 这限制了研究社区对其对齐方法的复现和分析.

Similar to the SFT stage, to tune hyperparameters and additionally mitigate reward hacking (Amodei et al., 2016; Skalse et al., 2022), we rely on a high-capacity model as an automated rater, and compute side-by-side comparison with a baseline model.

类似于 SFT 阶段, 为了调整超参数并额外缓解奖励黑客, 我们依赖高容量模型作为自动评分员, 并计算与基线模型的并排对比.

> 译者注: "奖励黑客"(reward hacking)是指策略模型找到奖励函数的漏洞而非真正学习期望行为. 例如, 奖励模型可能偏爱长回答, 策略模型就会生成冗长但无意义的内容. 使用高容量模型作为自动评分员是一种缓解策略, 但它引入了新的偏差——自动评分员本身可能有偏见, 并且这种设计假设"更大的模型更可靠", 但这一假设本身并未被严格验证.

---

## 6 Evaluation

We evaluate Gemma on a broad range of domains, using automated benchmarks and human evaluations.

我们在广泛领域中对 Gemma 进行评估, 使用自动化基准测试和人工评估.

### 6.1 Human Preference Evaluation

In addition to running standard academic benchmarks on the fine-tuned models, we submit final release candidate models to human evaluation studies, comparing against the Mistral v0.2 7B Instruct model (Jiang et al., 2023).

除了在微调模型上运行标准学术基准测试外, 我们还将最终发布候选模型送交人工评估研究, 与 Mistral v0.2 7B Instruct 模型进行比较.

On a held-out set of ~1000 prompts (focusing on requiring the model to follow instructions on creative writing tasks, coding, and following instructions), Gemma 7B IT has a positive win rate of 61.2%, and Gemma 2B IT a win rate of 45% over Mistral v0.2 7B Instruct.

在一个约 1000 个提示的保留集合上(侧重于要求模型在创意写作任务、编程和遵循指令方面遵循指令), Gemma 7B IT 具有 61.2% 的正面胜率, Gemma 2B IT 具有 45% 的胜率超过 Mistral v0.2 7B Instruct.

On a held-out set of ~400 prompts (focusing on testing basic safety protocols), Gemma 7B IT has a win rate of 63.5%, while Gemma 2B IT has a win rate of 60.1%.

在一个约 400 个提示的保留集合上(侧重于测试基本安全协议), Gemma 7B IT 具有 63.5% 的胜率, 而 Gemma 2B IT 具有 60.1% 的胜率.

> 译者注: 值得注意的是, Gemma 2B IT 在安全测试中以 60.1% 的胜率击败了 Mistral 7B IT——一个参数量仅 29% 的模型在安全对齐上表现更好. 这说明模型规模并非安全性的唯一决定因素; 训练数据的质量、过滤策略和对齐方法的精细度同样重要. 然而, 在指令遵循方面, 2B 模型的 45% 胜率表明其能力明显弱于 7B 模型, 这符合规模效应的预期.

### 6.2 Automated Benchmarks

| | LLaMA-2 7B | Mistral 7B | Gemma 7B | Gemma 2B |
|---|---|---|---|---|
| MMLU | 45.3 | 62.5 | 64.3 | 42.3 |
| HellaSwag | 77.2 | 81.0 | 81.2 | 71.4 |
| PIQA | 78.8 | 82.2 | 81.2 | 77.3 |
| SIQA | 48.3 | 47.0 | 51.8 | 49.7 |
| Boolq | 77.4 | 83.2 | 83.2 | 69.4 |
| Winogrande | 69.2 | 74.2 | 72.3 | 65.4 |
| CQA | 57.8 | 66.3 | 71.3 | 65.3 |
| OBQA | 58.6 | 52.2 | 52.8 | 47.8 |
| ARC-e | 75.2 | 80.5 | 81.5 | 73.2 |
| ARC-c | 45.9 | 54.9 | 53.2 | 42.1 |
| TriviaQA | 72.1 | 62.5 | 63.4 | 53.2 |
| NQ | 25.7 | 23.2 | 23.0 | 12.5 |
| HumanEval | 12.8 | 26.2 | 32.3 | 22.0 |
| MBPP | 20.8 | 40.2 | 44.4 | 29.2 |
| GSM8K | 14.6 | 35.4 | 46.4 | 17.7 |
| MATH | 2.5 | 12.7 | 24.3 | 11.8 |
| AGIEval | 29.3 | 41.2 | 41.7 | 24.2 |
| BBH | 32.6 | 56.1 | 55.1 | 35.2 |
| Average | 46.9 | 54.5 | 56.9 | 45.0 |

We measure Gemma model performance on domains including physical reasoning (Bisk et al., 2019), social reasoning (Sap et al., 2019), question answering (Clark et al., 2019; Kwiatkowski et al., 2019), coding (Austin et al., 2021; Chen et al., 2021), mathematics (Cobbe et al., 2021), commonsense reasoning (Sakaguchi et al., 2019), language modeling (Paperno et al., 2016), and reading comprehension (Joshi et al., 2017).

我们在包括物理推理、社会推理、问答、编程、数学、常识推理、语言建模、阅读理解等多个领域测量 Gemma 模型的性能.

We compare Gemma 2B and 7B models against several external open LLMs in Table 6 and Table 7.

我们在表 6 和表 7 中将 Gemma 2B 和 7B 模型与几个外部开源 LLM 进行比较.

On MMLU (Hendrycks et al., 2020), Gemma 7B outperforms all other open alternatives of similar or smaller size; it also outperforms several larger models, including LLaMA2 13B.

在 MMLU 上, Gemma 7B 在相同或更小规模的所有开源替代品中表现最佳; 它还优于几个更大的模型, 包括 LLaMA2 13B.

However, human expert performance evaluated by the benchmark authors is 89.8%; since Gemini Ultra was the first model to surpass this threshold, there remains significant room for improvement in reaching Gemini and human-level performance.

然而, 基准作者评估的人类专家性能为 89.8%; 由于 Gemini Ultra 是第一个超过这一阈值的模型, 因此在达到 Gemini 和人类水平性能方面仍有显著的改进空间.

Gemma models demonstrate particularly strong performance on mathematics and coding benchmarks. On math tasks (often used to benchmark general analytical capabilities of models), Gemma models outperform at least the next best model by 10 points on GSM8K (Cobbe et al., 2021) and the harder MATH (Hendrycks et al., 2021) benchmarks. Similarly, they outperform alternative open models by at least 6 points on HumanEval (Chen et al., 2021). They even exceed the performance of the CodeLLaMA-7B model which is further specialized for coding via fine-tuning on code (CodeLLaMA achieves 41.4% on MBPP, compared to Gemma 7B which achieves 44.4%).

Gemma 模型在数学和编程基准测试上表现出特别强的性能. 在数学任务上, Gemma 模型在 GSM8K 和更难的 MATH 基准测试中至少比其他模型高出 10 分. 类似地, 它们在 HumanEval 上至少比替代开源模型高出 6 分. 它们甚至超过了经过代码微调的 CodeLLaMA-7B 模型在 MBPP 上的性能.

> 译者注: Gemma-1 7B 在数学和编程上的领先是一个重要信号. GSM8K 46.4% 和 MATH 24.3% 的成绩在 2024 年初的开源模型中属于顶尖水平. 这种优势可能来自训练数据中的数学和代码比例较高, 以及 Gemini 技术栈中的特定优化. 但需要注意, 这些数字是在 few-shot 设置下取得的, 实际对话中的数学能力可能因提示格式不同而有显著差异. 此外, Gemma 7B 在 TruthfulQA 上仅 44.8%, 说明事实性和幻觉仍是主要挑战.

### 6.3 Memorization Evaluation

Recent research shows that aligned models can be susceptible to new adversarial attacks that bypass alignment (Nasr et al., 2023). These attacks can cause the model to diverge, sometimes memorizing training data in the process.

最近的研究表明, 对齐后的模型可能容易受到新的对抗性攻击, 这些攻击可以绕过对齐. 这些攻击可能导致模型发散, 有时在此过程中背诵记忆化的训练数据.

We focus on discoverable memorization, which acts as a reasonable upper bound on model memorization (Nasr et al., 2023), and has been used in several studies (Carlini et al., 2022; Anil et al., 2023; Kudugunta et al., 2023).

我们关注可发现的记忆化, 它作为模型记忆化的合理上限, 并已在多项研究中使用.

We test Gemma pre-trained models for memorization using the same methodology as Anil et al. (2023). We sample 10,000 documents from each corpus and use the first 50 tokens as a prompt for the model. We focus primarily on exact memorization, where we classify a text as memorized if the next 50 tokens generated by the model match the ground truth continuation of the text exactly. However, to better capture potential paraphrase memorization, we include approximate memorization using a 10% edit distance threshold (Ippolito et al., 2022).

我们使用与 Anil 等人相同的方法测试 Gemma 预训练模型的记忆化. 我们从每个语料库中采样 10,000 个文档, 并使用前 50 个 token 作为模型的提示. 我们主要关注精确记忆化, 即如果模型生成的后续 50 个 token 与文本中的真实延续完全匹配, 则将文本分类为记忆化. 然而, 为了更好地捕获潜在的改写记忆化, 我们使用 10% 的编辑距离阈值包含近似记忆化.

**Verbatim Memorization.** PaLM 2 was compared against PaLM on a shared subset of the training corpus. However, Gemma pre-training data has less overlap with the PaLM models, and thus using the same methodology, we observe lower memorization rates. Instead, we find that estimating "total memorization" over the entire pre-training dataset gives a more reliable estimate, where we find Gemma memorizes training data at a rate comparable to PaLM.

**逐字记忆化.** PaLM 2 通过在共享的训练语料子集上评估来与 PaLM 进行比较. 然而, Gemma 预训练数据与 PaLM 模型之间的重叠更少, 因此使用相同的方法, 我们观察到更低的记忆化率. 相反, 我们发现估计整个预训练数据集上的"总记忆化"给出了更可靠的估计, 在此我们发现 Gemma 以与 PaLM 相当的速率记忆训练数据.

**Personal Data.** Perhaps more importantly is the possibility of personal data being memorized. As part of making Gemma pre-trained models safe and reliable, we use automated techniques to filter certain personal information and other sensitive data from the training set.

**个人数据.** 也许更重要的是个人数据可能被记忆化的可能性. 作为使 Gemma 预训练模型安全和可靠的一部分, 我们使用自动化技术从训练集中过滤掉某些个人信息和其他敏感数据.

To identify possible occurrences of personal data, we use Google Cloud Sensitive Data Protection tools. This tool outputs three severity levels based on a number of categories of personal data (e.g., names, emails, etc.). We categorize the highest severity as "sensitive", and the remaining two as "personal". We then measure the proportion of memorized outputs that contain any sensitive or personal data. As shown in Figure 3, **we observe no cases of sensitive data being memorized.** We do find the model memorized some data we categorized as potentially "personal" as per the above, although generally at a significantly lower rate. Moreover, it is important to note that these tools are known to have a large number of false positives (as they only match patterns without taking account of context), meaning our results are likely overestimates of the amount of personal data identified.

为了识别个人数据的可能出现, 我们使用 Google Cloud 敏感数据保护工具. 该工具基于许多类别的个人数据输出三个严重程度级别. 我们将最高严重程度归类为"敏感", 将剩余两个归类为"个人". 然后, 我们测量记忆化输出中包含任何敏感或个人数据的比例. 如图所示, **我们观察到没有记忆化敏感数据的案例.** 我们确实发现模型记忆了一些我们按上述归类为潜在"个人"的数据, 尽管通常以低得多的速率. 此外, 重要的是要注意这些工具已知有许多误报, 这意味着我们的结果很可能是对识别到的个人数据量的高估.

> 译者注: "没有记忆化敏感数据"是一个强有力的安全声明, 但需要注意其方法论限制. 首先, 评估仅在 10,000 个样本上进行, 这相对于 6T token 的训练数据是极小的抽样. 其次, "敏感数据保护工具"的误报率意味着"没有检测到"不等于"不存在". 最后, 这一评估针对的是预训练模型, 而非经过 RLHF 的指令微调模型——后者在对抗性提示下可能表现出不同的记忆化行为. 后续研究(Nasr et al., 2023)确实发现, 对齐后的模型在特定攻击下可能泄露训练数据.

**Approximate Memorization.** In Figure 4, we observe approximately 50% more data is approximately memorized (note log scale), and this is almost consistently across different sub-categories of the dataset.

**近似记忆化.** 我们观察到大约多 50% 的数据被近似记忆化(注意对数尺度), 并且这在数据集的不同子类别中几乎是一致的.

---

## 7 Responsible Deployment

Consistent with prior releases of Google AI technologies (Gemini Team, 2023; Kavukcuoglu et al., 2022), we follow a structured approach to responsible model development and deployment to identify, measure, and manage foreseeable downstream societal impacts.

与 Google AI 技术的先前发布一致, 我们遵循结构化的方法来进行负责任的模型开发和部署, 以识别、衡量和管理可预见的下游社会影响.

As with our recent Gemini release, these approaches are grounded in prior academic literature on language model risks (Weidinger et al., 2021), findings from similar previous work conducted across the industry (Anil et al., 2023), ongoing engagement with internal and external experts, and unstructured attempts to discover novel model vulnerabilities.

正如我们最近的 Gemini 发布一样, 这些方法基于先前关于语言模型风险的学术文献、跨行业进行的类似先前工作的发现、与内部和外部专家的持续接触, 以及发现新模型漏洞的非结构化尝试.

### 7.1 Benefits

We believe that the openness of AI science and technology can deliver significant benefits. Open-source is a critical driver of scientific and innovation progress, and is a responsible practice in most contexts. But this needs to be balanced against the risk of providing tools to actors who may cause harm now or in the future.

我们相信 AI 科学和技术的开放性可以带来显著的好处. 开源是科学和创新的重要驱动力, 在大多数情况下是一种负责任的做法. 但这需要与为现在或将来造成伤害的行为者提供工具的风险相平衡.

Google has a long-standing commitment to providing broader access to successful research innovations (GraphCast, Transformer, BERT, T5, Word2Vec), and we believe releasing Gemma to the AI development ecosystem will enable downstream developers to create a range of beneficial applications, across domains of science, education and the arts.

Google 长期以来致力于提供更广泛的成功研究创新访问权限, 我们相信将 Gemma 发布到 AI 开发生态系统将使下游开发者能够创建一系列有益的应用, 涉及科学、教育和艺术等领域.

Our instruction-tuned product should encourage developers of all types to leverage Gemma's chat and code capabilities to support their own beneficial applications, while also permitting custom fine-tuning to specialize the model's capabilities to particular use cases.

我们的指令微调产品应鼓励各种开发者利用 Gemma 的聊天和代码能力来支持他们自己的有益应用, 同时允许自定义微调以将模型的能力专门用于特定用例.

To ensure Gemma supports a broad range of developer needs, we also release two model sizes to optimally support different environments, and make these models available on multiple platforms (see Kaggle for details).

为了确保 Gemma 支持广泛的开发者需求, 我们还发布了两种模型规模以最优地支持不同环境, 并在多个平台上提供这些模型.

Broadly making Gemma available in this manner should lower the economic and technical barriers that new enterprises or independent developers face when integrating these technologies into their workflows.

以这种方式广泛提供 Gemma 应该降低新企业或独立开发者在将这些技术整合到其工作流程中时面临的经济和技术障碍.

In addition to serving developers through instruction-tuned models, we also provide access to the corresponding foundational pre-trained models. In doing so, our intention is to encourage further AI safety research and community innovation, providing developers with a broader pool of models to build the various transparency and interpretability research approaches the community has already benefited from.

除了通过指令微调模型为开发者服务外, 我们还提供了相应的基础预训练模型的访问. 通过这样做, 我们的意图是鼓励进一步的 AI 安全研究和社区创新.

> 译者注: Google 在"收益"部分的论述体现了其在开源与闭源之间寻求平衡的努力. 与 Meta 的"开源一切"策略不同, Google 强调"负责任地开放"——只开放特定规模的模型, 同时保留最大规模的模型(如 Gemini Ultra)作为闭源产品. 这种策略的商业逻辑是: 通过开源轻量级模型来扩大技术影响力, 吸引开发者进入 Google 生态(GCP、Vertex AI、Kaggle), 同时保持闭源旗舰模型的竞争优势.

### 7.2 Risks

In addition to bringing benefits to the AI development ecosystem, we are also aware that large language models can be used maliciously, such as the creation of deep-fake imagery, AI-generated disinformation, as well as illegal and upsetting content, which may result in harm on both an individual and institutional level.

除了为 AI 开发生态系统带来好处外, 我们也意识到大语言模型的恶意使用, 如深度伪造图像的创建、AI 生成的虚假信息以及非法和令人不安的内容, 可能对个人和机构层面造成伤害.

Providing access to model weights, as opposed to releasing models behind APIs, also introduces novel challenges for responsible deployment.

提供对模型权重的访问, 而不是在 API 后发布模型, 也为负责任部署带来了新的挑战.

Firstly, although their use is constrained by terms prohibiting the use of Gemma models for any use cases in violation of the Gemma Prohibited Use Policy, we are unable to prevent malicious actors from fine-tuning Gemma with malicious intent.

首先, 尽管其使用受禁止将 Gemma 模型用于违反 Gemma 禁止用例政策的条款约束, 我们无法阻止恶意行为者出于恶意意图对 Gemma 进行微调.

However, we recognize the need for further work to build more robust mitigation strategies against deliberate misuse of open models, and Google DeepMind will continue to explore this area both internally and with the AI community.

然而, 我们认识到需要进一步的工作来构建更强大的缓解策略, 以抵御对开放模型的故意滥用.

A second challenge we face is protecting developers and downstream users from unintended behaviors of open models, including the generation of toxic language, or continuation of discriminatory social harms, model hallucinations, and leakage of personally identifiable information.

我们面临的第二个挑战是保护开发者和下游用户免受开放模型的意外行为, 包括生成有毒语言或延续歧视性社会危害、模型幻觉以及个人可识别信息的泄漏.

When deploying models behind APIs, these risks can be mitigated through a variety of filtering methods.

在 API 后部署模型时, 可以通过各种过滤方法来降低这些风险.

### 7.3 Mitigations

For the Gemma model family, without this layer of defense, we work to guard against these risks through bias filtering in pre-training data consistent with Gemini approaches, measuring safety through standardized AI safety benchmarks, internal red-teaming to better understand the risks associated with external use of Gemma, and rigorous ethical and safety evaluation of the model.

对于 Gemma 模型家族, 没有这层防御, 我们努力通过与 Gemini 方法一致的预训练数据中的偏见过滤和测量、通过标准化 AI 安全基准测试评估安全性、内部红队测试以更好地了解与 Gemma 外部使用相关的风险, 以及对模型进行严格的伦理和安全评估来防范这些风险.

| | Mistral v0.2 7B | Gemma 1.1 IT | |
|---|---|---|---|
| | | 2B | 7B |
| RealToxicity | 8.44 | 7.03 | 8.04 |
| BOLD | 46.0 | 47.76 | 45.2 |
| CrowS-Pairs | 32.76 | 45.89 | 49.67 |
| BBQ Ambig | 97.53 | 58.97 | 86.06 |
| BBQ Disambig | 84.45 | 53.9 | 85.08 |
| Winogender | 64.3 | 50.14 | 57.64 |
| TruthfulQA | 48.54 | 44.24 | 45.34 |
| Winobias 1_2 | 65.72 | 55.93 | 59.22 |
| Winobias 2_2 | 84.53 | 89.46 | 89.2 |
| Toxigen | 61.77 | 29.64 | 38.75 |

While we have invested significant resources in improving our model, we recognize its limitations. To ensure transparency for downstream users, we release detailed model cards, providing researchers with a more comprehensive understanding of Gemma.

虽然我们已在改进模型方面投入了大量资源, 但我们认识到其局限性. 为了确保下游用户的透明度, 我们发布了详细的模型卡, 为研究人员提供更全面的 Gemma 理解.

We also release a Generative AI Responsible Practices Toolkit to support developers in building AI responsibly.

我们还发布了生成式 AI 负责任工具包, 以支持开发者负责任地构建 AI.

The relative novelty of open-weight models means that new uses and misuses of these models are still being discovered, and this is why Google DeepMind is committed to ongoing research and development of robust mitigation strategies alongside future model development.

开放权重模型的相对新颖性意味着这些模型的新用途和误用仍在被发现.

### 7.4 Assessment

Finally, given the capabilities of larger systems accessible in the existing ecosystem, we believe that the release of Gemma will have a negligible impact on the overall AI risk portfolio.

最终, 鉴于现有生态系统中可访问的更大系统的能力, 我们相信 Gemma 的发布将对整体 AI 风险组合产生微不足道的影响.

Given this, and the utility of these models for research, auditing, and downstream product development, we are confident that the benefits to the AI community from Gemma outweigh the risks described.

鉴于此, 以及这些模型对研究、审计和下游产品开发的效用, 我们确信 Gemma 对 AI 社区的收益大于所描述的风险.

### 7.5 Outlook

As a guiding principle, Google DeepMind endeavors to adopt evaluation and safety mitigations commensurate with the potential risk of a model.

作为指导原则, Google DeepMind 努力采用与模型潜在风险相称的评估和安全缓解措施.

While we are confident that the Gemma models will deliver a net benefit to the community, our emphasis on safety stems from the irreversibility of this release.

虽然我们确信 Gemma 模型将为社区提供净收益, 但我们对安全性的强调源于这次发布的不可逆性.

Since the harms caused by open models have not been clearly defined, and established evaluation frameworks for such models do not yet exist, we will continue to follow this precedent and adopt a careful and cautious approach to open model development. As capabilities advance, we may explore expanded testing, staged release, or alternative access mechanisms to ensure responsible AI development.

由于开放模型造成的危害尚未被明确定义, 也没有针对此类模型的既定评估框架存在, 我们将继续遵循这一先例, 对开放模型开发采取审慎和谨慎的方法. 随着能力的进步, 我们可能会探索扩展测试、分阶段发布或替代访问机制, 以确保负责任的 AI 开发.

As the ecosystem evolves, we urge the broader AI community to move beyond simple "open vs. closed" debates and avoid both exaggerating and minimizing potential harms, as we believe that a nuanced, collaborative approach to risks and benefits is critical.

随着生态系统的发展, 我们敦促更广泛的 AI 社区超越简单的"开放 vs. 封闭"辩论, 避免夸大或最小化潜在危害, 因为我们相信对风险和收益的细致、协作的方法至关重要.

At Google DeepMind, we are committed to developing high-quality evaluations, and invite the community to join us in developing a deeper understanding of AI systems.

在 Google DeepMind, 我们致力于开发高质量的评估, 并邀请社区加入我们, 以更深入地理解 AI 系统.

> 译者注: "开放 vs. 封闭"辩论是 2024 年 AI 社区的核心争议之一. Meta 的 LLaMA-2 采用相对宽松的许可, 而 Google 的 Gemma 采用更严格的许可. Google 在这里试图占据"理性中间派"的位置——既不完全开放也不完全封闭. 但这种立场在实践中面临批评: 安全研究者认为限制过多阻碍了研究, 而安全倡导者认为开放权重本身就是一种风险. Gemma-1 的发布策略可以看作是一种"受控开放"实验, 其结果影响了后续 Gemma-2/3/4 的许可条款演进.

---

## 8 Discussion and Conclusion

We introduced Gemma, a publicly available family of generative language models for text and code.

我们介绍了 Gemma, 一个用于文本和代码的公开可用的生成式语言模型家族.

Gemma advances the state of the art on performance, safety, and responsible development among publicly available language models.

Gemma 在公开可用语言模型的性能、安全性和负责任开发方面推进了最先进水平.

In particular, given our extensive safety evaluations and mitigations, we are confident that the Gemma models will deliver a net benefit to the community; however, we acknowledge that this release is irreversible, and the harms caused by open models have not been clearly defined, so we will continue to adopt evaluation and safety mitigations commensurate with the potential risk of these models.

特别是, 鉴于我们广泛的安全评估和缓解措施, 我们确信 Gemma 模型将为社区提供净收益; 然而, 我们承认这次发布是不可逆的, 开放模型造成的危害尚未被明确定义, 因此我们将继续采用与这些模型潜在风险相称的评估和安全缓解措施.

Additionally, our models outperform competitors on 6 standard safety benchmarks, and in human side-by-side evaluations.

此外, 我们的模型在 6 个标准安全基准测试中优于竞争对手, 在人工并排评估中也是如此.

Gemma models boost performance across a wide range of domains, including conversation, reasoning, math, and code generation.

Gemma 模型在包括对话、推理、数学和代码生成在内的广泛领域中提升了性能.

Results on MMLU (64.3%) and MBPP (44.4%) demonstrate Gemma's high performance, and the continued room for improvement in publicly available large language model performance.

MMLU(64.3%)和 MBPP(44.4%)的结果展示了 Gemma 的高性能, 以及公开可用大语言模型性能的持续提升空间.

In addition to state-of-the-art performance metrics on benchmark tasks, we look forward to new use cases emerging from the community, and new capabilities emerging as we collectively drive the field forward.

除了基准任务上的最先进水平性能指标外, 我们期待看到社区中出现的新用例, 以及随着我们共同推动该领域发展而出现的新能力.

We hope researchers will use Gemma to accelerate a wide range of research, and developers create beneficial new applications, user experiences, and other features.

我们希望研究人员使用 Gemma 来加速广泛的研究, 开发者创建有益的新应用、用户体验和其他功能.

Gemma benefits from many lessons learned in the Gemini model project, including code, data, architecture, instruction tuning, reinforcement learning from human feedback, and evaluation.

Gemma 受益于 Gemini 模型项目的许多经验, 包括代码、数据、架构、指令微调、基于人类反馈的强化学习和评估.

As discussed in the Gemini technical report, we reiterate limitations of LLM use (non-exhaustive set).

正如 Gemini 技术报告中所讨论的, 我们重申大语言模型使用的局限性.

Even strong performance on benchmark tasks still requires further research to create robust, safe models that perform as intended.

即使在基准任务上表现出色, 仍需要进一步研究来创建稳健、安全的模型, 可靠地按预期执行.

Example areas for further research include factuality, alignment, complex reasoning, and robustness to adversarial inputs. As discussed in Gemini, we note the need for more challenging and robust benchmarks.

示例进一步研究领域包括事实性、对齐、复杂推理和对对抗性输入的鲁棒性. 正如 Gemini 所讨论的, 我们注意到需要更具挑战性和鲁棒性的基准测试.

---

> 本文档为 Gemma-1 技术报告的逐段对照翻译. 共 15 处译者注, 覆盖设计动机、工程细节、数据策略、局限风险、技术谱系. 与 D2 精译版本相比, D4 保留了完整英文原文并逐段对应, 适合英中双语对照阅读.
