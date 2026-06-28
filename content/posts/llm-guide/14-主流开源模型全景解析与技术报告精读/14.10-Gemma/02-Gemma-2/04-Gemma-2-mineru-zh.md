---
title: "Gemma 2 技术报告逐译与译者注"
---

# Gemma 2 技术报告逐译与译者注

>  **[返回 14.10-Gemma 家族总览](../../14.10-Gemma.md)**


> 原文: Gemma 2: Improving Open Language Models at a Practical Size
> 译者注格式: `> 译者注: ...`

---

## 1 引言

**[EN]** Large language models (LLMs) have demonstrated strong capabilities in language understanding, generation, and reasoning (Radford et al., 2019; Raffel et al., 2019; Brown et al., 2020). Scaling has been key to this recent progress, with many new capabilities only emerging at scale (Brown et al., 2020). The newest large models not only reach unprecedented performance on reasoning benchmarks (Achiam et al., 2023), but they also demonstrate multimodal and multilingual capabilities (Gemini Team, 2024) and even the ability to use context lengths of over 1M tokens (Gemini Team, 2024).

**[ZH]** 大语言模型(LLMs)在语言理解、生成和推理方面展现出强大的能力. 规模扩展是近期进步的关键, 许多新能力只有在足够大的规模上才会涌现. 最新的大型模型不仅在推理基准测试上达到了前所未有的性能, 还展示了多模态和多语言能力, 甚至能够处理超过 100 万 token 的上下文长度.

**[EN]** Small-scale models have also shown a rapid increase in performance, but these gains are largely derived from increasing the length of training (Touvron et al., 2023; Jiang et al., 2023; Gemma Team, 2024). This approach only scales logarithmically with dataset size (Hoffmann et al., 2022), and the latest small models require up to 15T tokens to improve the state of the art by less than 1-2% (AI@Meta, 2024).

**[ZH]** 小规模模型的性能也在迅速提升, 但这些收益主要来源于延长训练时间. 这种方法仅随数据集大小对数增长, 而最新的小模型需要多达 15T token 才能将最先进性能提升不到 1-2%.

> 译者注: 这里作者指出了一个关键的效率瓶颈. 根据 Chinchilla  scaling laws, 模型性能随计算量(参数 x token)呈幂律增长, 但对于固定规模的小模型, 单纯增加数据量的边际收益急剧递减. Gemma-2 的切入点是: 与其继续堆砌数据, 不如改善每一步训练的信号质量.

**[EN]** Yet, these continued improvements provide evidence that small models are still under-trained. In this work, we explore alternatives to improve small model performance without solely increasing training length. One solution is to improve the quality of information received by the network at each training step by replacing the next token prediction task with a richer objective.

**[ZH]** 然而, 这些持续的改进表明小模型仍然处于欠训练状态. 在本工作中, 我们探索了不单纯增加训练长度来提升小模型性能的替代方案. 一种解决方案是通过用更丰富的目标替代下一个 token 预测任务, 从而改善网络在每一步训练中接收到的信息质量.

**[EN]** In particular, we focus our efforts on knowledge distillation (Hinton et al., 2015), which replaces the one-hot vector seen at each token with the distribution of potential next tokens computed from a large model. This approach is often used to reduce the training time of smaller models by giving them richer gradients. In this work, we instead train for large quantities of tokens with distillation in order to simulate training beyond the number of available tokens. Concretely, we use a large language model as a teacher to train small models, namely 2B and 9B models, on a quantity of tokens that is more than 50 times the compute-optimal quantity predicted by the theory (Hoffmann et al., 2022). Along with the models trained with distillation, we also release a 27B model trained from scratch for this work.

**[ZH]** 具体而言, 我们将精力集中在知识蒸馏上, 它用一个大模型计算出的潜在下一个 token 分布来替代每个 token 位置上看到的 one-hot 向量. 这种方法通常用于通过给予小模型更丰富的梯度来减少其训练时间. 而在本工作中, 我们转而使用蒸馏在大量 token 上进行训练, 以模拟超越可用 token 数量的训练效果. 具体地说, 我们使用一个大语言模型作为教师来训练小模型, 即分别在超过理论预测的计算最优数量 50 倍以上的 token 上训练 2B 和 9B 模型. 除了使用蒸馏训练的模型外, 我们还发布了一个为本工作从头训练的 27B 模型.

> 译者注: "超过计算最优量的 50 倍"是一个非常重要的数字. 根据 Hoffmann 等人的 Chinchilla 定律, 2B 模型的计算最优训练量约为 40B-100B token. Gemma-2 训练了 2T token, 确实是 20-50 倍的过训练. 但蒸馏提供的 soft target 相当于一种"数据增强"——教师在每个位置给出的不是单一正确答案, 而是一个概率分布, 这相当于将每个训练样本扩展为了多个软标签样本. 因此, 虽然物理 token 数量是 2T, 但有效学习信号的信息量远大于此.

**[EN]** We also leverage several known modifications of Transformers, namely the interleaving of global and local attention layers from Beltagy et al. (2020a), and the Grouped-Query Attention (GQA) mechanism of Ainslie et al. (2023).

**[ZH]** 我们还利用了 Transformer 的几个已知改进, 即 Beltagy 等人(2020a)提出的全局注意力与局部注意力层交错, 以及 Ainslie 等人(2023)提出的分组查询注意力(GQA)机制.

**[EN]** Overall, Gemma 2 significantly advances state-of-the-art performance relative to comparable-scale open models and are even competitive with some models more than twice their size (xAI, 2024; AI@Meta, 2024; Jiang et al., 2023; Almazrouei et al., 2023), across a variety of automated benchmarks and human evaluations. Example domains include question answering (Clark et al., 2019; Kwiatkowski et al., 2019), commonsense reasoning (Sakaguchi et al., 2019; Suzgun et al., 2022), mathematics and science (Cobbe et al., 2021; Hendrycks et al., 2020), and coding (Austin et al., 2021; Chen et al., 2021).

**[ZH]** 总体而言, 与同等规模的开源模型相比, Gemma-2 显著推进了最先进的性能, 甚至在一些模型两倍以上的规模上仍具有竞争力, 涵盖多种自动化基准测试和人工评估. 示例领域包括问答、常识推理、数学与科学以及编程.

---

## 2 模型架构

**[EN]** Similar to previous Gemma models (Gemma Team, 2024), the Gemma 2 models are based on a decoder-only transformer architecture (Vaswani et al., 2017). We summarize the main parameters and architecture choices in Table 1.

**[ZH]** 与之前的 Gemma 模型类似, Gemma-2 模型基于解码器-only 的 Transformer 架构. 我们在表 1 中总结了主要参数和架构选择.

**[EN]** A few architectural elements are similar to the first version of Gemma models; namely, a context length of 8192 tokens, the use of Rotary Position Embeddings (RoPE) (Su et al., 2021), and the approximated GeGLU non-linearity (Shazeer, 2020). A few elements differ between Gemma 1 and Gemma 2, including using deeper networks. We summarize the key differences below.

**[ZH]** 部分架构元素与 Gemma 第一版模型相似, 即 8192 token 的上下文长度、Rotary Position Embeddings(RoPE)的使用, 以及近似的 GeGLU 非线性. Gemma-1 和 Gemma-2 之间存在一些差异, 包括使用更深的网络. 我们在下面总结关键差异.

### 2.1 局部滑动窗口注意力与全局注意力

**[EN]** We alternate between a local sliding window attention (Beltagy et al., 2020b, a) and global attention (Luong et al., 2015) in every other layer. The sliding window size of local attention layers is set to 4096 tokens, while the span of the global attention layers is set to 8192 tokens.

**[ZH]** 我们在每隔一层的局部滑动窗口注意力和全局注意力之间交替. 局部注意力层的滑动窗口大小设置为 4096 token, 而全局注意力层的跨度设置为 8192 token.

> 译者注: 局部-全局注意力交错将自注意力的计算复杂度从 O(L^2) 降低到 O(L * w)(w 为窗口大小). 对于 8192 的上下文长度, 纯全局注意力的计算量约为 6700 万次操作 per head, 而 1:1 交错后降至约 3300 万次. 更重要的是 KV Cache 内存减半, 因为一半的层只需存储局部 KV. 这是端侧部署的关键优化.

### 2.2 Logit Soft-Capping

**[EN]** We cap logits (Bello et al., 2016) in each attention layer and the final layer such that the value of the logits stays between -soft_cap and +soft_cap. More specifically, we cap the logits with the following function: logits <- soft_cap * tanh(logits / soft_cap). We set the soft_cap parameter to 50.0 for the self-attention layers and to 30.0 for the final layer.

**[ZH]** 我们在每个注意力层和最终层中对 logits 进行限制, 使得 logits 的值保持在 -soft_cap 和 +soft_cap 之间. 更具体地说, 我们使用以下函数对 logits 进行限制: logits <- soft_cap * tanh(logits / soft_cap). 我们将自注意力层的 soft_cap 参数设置为 50.0, 最终层设置为 30.0.

> 译者注: Logit soft-capping 是 Google 的内部工程实践, 也用于 Gemini 系列. 其动机是防止极端 logits 值导致的数值不稳定. 注意力层的 cap(50.0)比输出层(30.0)更宽松, 因为注意力机制需要保留动态范围来区分不同位置的权重. 这种"软裁剪"比硬裁剪(如直接 clamp)更平滑, 保留了梯度信息.

### 2.3 Post-norm and pre-norm with RMSNorm

**[EN]** To stabilize training, we use RMSNorm (Zhang and Sennrich, 2019) to normalize the input and output of each transformer sub-layer, the attention layer, and the feedforward layer.

**[ZH]** 为了稳定训练, 我们使用 RMSNorm 对每个 Transformer 子层(注意力层和前馈层)的输入和输出进行归一化.

### 2.4 Grouped-Query Attention

**[EN]** We use GQA with num_groups=2, based on ablations showing increased speed at inference time while maintaining downstream performance.

**[ZH]** 我们使用 num_groups=2 的 GQA, 基于消融实验显示其在推理时速度提升的同时保持了下游性能.

> 译者注: GQA 的 num_groups=2 意味着 Query 头数量是 KV 头数量的 2 倍. 对于 2B 模型(8 个 Query 头, 4 个 KV 头), KV Cache 内存相比 MHA 减少 50%. 消融实验(表 8)显示 GQA 与 MHA 的性能差距不到 1%, 但推理速度显著提升. 这是推理效率与质量之间的一个实用平衡点.

---

## 3 预训练

### 3.1 训练数据

**[EN]** We train Gemma 2 27B on 13 trillion tokens of primarily-English data, the 9B model on 8 trillion tokens, and the 2B on 2 trillion tokens. These tokens come from a variety of data sources, including web documents, code, and science articles. Our models are not multimodal and are not trained specifically for state-of-the-art multilingual capabilities. The final data mixture was determined through ablations similar to the approach in Gemini 1.0 (Gemini Team, 2023).

**[ZH]** 我们在主要由英文数据组成的 13T token 上训练 Gemma-2 27B 模型, 9B 模型在 8T token 上训练, 2B 模型在 2T token 上训练. 这些 token 来自多种数据源, 包括网页文档、代码和科学文章. 我们的模型不是多模态的, 也没有专门为最先进的多语言能力而训练. 最终的数据混合比例通过与 Gemini 1.0 类似的方法通过消融实验确定.

**[EN]** Tokenizer. We use the same tokenizer as Gemma 1 and Gemini: a SentencePiece tokenizer with split digits, preserved whitespace, and byte-level encodings (Kudo and Richardson, 2018). The resulting vocabulary has 256k entries.

**[ZH]** Tokenizer. 我们使用与 Gemma-1 和 Gemini 相同的 tokenizer: 一个带有分割数字、保留空白和字节级编码的 SentencePiece tokenizer. 得到的词表有 256k 条目.

> 译者注: 256k 词表远大于 Llama-2 的 32k 或 Qwen2 的 152k. 大词表的优势是多语言支持更好(特别是非拉丁语系语言), 但代价是嵌入层参数量巨大——对于 2B 模型, 590M 参数中有约 25% 来自嵌入层(表 2). 这实际上减少了可用于 Transformer 主体的参数预算. Google 之所以这样做, 是因为 Gemma 继承了 Gemini 的多语言词表, 保持了家族一致性.

### 3.2 知识蒸馏

**[EN]** Given a large model used as a teacher, we learn smaller models by distilling from the probability given by the teacher of each token x given its context x_c, i.e., P_T(x | x_c). More precisely, we minimize the negative log-likelihood between the probabilities from the teacher and the student: min_{P_S} sum_x -P_T(x | x_c) log P_S(x | x_c), where P_S is the parameterized probability of the student. Note that knowledge distillation was also used in Gemini 1.5 (Gemini Team, 2024).

**[ZH]** 给定一个用作教师的大模型, 我们通过蒸馏教师对每个 token x 给定其上下文 x_c 的概率来学习小模型, 即 P_T(x | x_c). 更精确地说, 我们最小化教师概率与学生概率之间的负对数似然: min_{P_S} sum_x -P_T(x | x_c) log P_S(x | x_c), 其中 P_S 是学生的参数化概率. 注意, 知识蒸馏也在 Gemini 1.5 中使用过.

> 译者注: 这里使用的是正向 KL 散度(KL(P_T || P_S)). 与之对比, MiniLLM(Gu et al., 2024)提出使用反向 KL(KL(P_S || P_T)), 后者会导致学生更"自信"但可能遗漏教师的长尾知识. Gemma-2 选择正向 KL 意味着学生必须覆盖教师分布的所有支持区域, 产生更保守但更全面的模型. 此外, 公式中使用了完整的 256k 词表概率, 而非 top-k 截断, 这保证了信号完整性但增加了计算开销.

### 3.3 计算基础设施

**[EN]** We train our models with TPUv4, TPUv5e, and TPUv5p as outlined in Table 3. For the 2B model, we train on a 2x16x16 configuration of TPUv5e, totaling 512 chips, with 512-way data replication and 1-way model sharding. For the 9B model, we train on an 8x16x32 configuration of TPUv4, totaling 4096 chips, with 1024-way data replication and 4-way model sharding. For the 27B model, we train on an 8x24x32 configuration of TPUv5p, totaling 6144 chips, with 768-way data replication and 8-way model sharding.

**[ZH]** 我们使用 TPUv4、TPUv5e 和 TPUv5p 训练我们的模型, 如表 3 所述. 对于 2B 模型, 我们在 2x16x16 配置的 TPUv5e 上训练, 共 512 个芯片, 512 路数据复制和 1 路模型分片. 对于 9B 模型, 我们在 8x16x32 配置的 TPUv4 上训练, 共 4096 个芯片, 1024 路数据复制和 4 路模型分片. 对于 27B 模型, 我们在 8x24x32 配置的 TPUv5p 上训练, 共 6144 个芯片, 768 路数据复制和 8 路模型分片.

> 译者注: 数据并行度远大于模型并行度, 说明 Gemma-2 的训练瓶颈不在显存而在计算吞吐量. 27B 模型使用 6144 个 TPUv5p chip, 这是极其庞大的计算资源. 作为对比, DeepSeek-V3(671B)使用了约 2048 个 H800 GPU. Google 的 TPU 集群规模在业界属于顶级. 值得注意的是, 跨 pod 通信使用数据中心网络(DCN)而非 NVLink, 这意味着通信带宽可能是训练效率的瓶颈之一.

### 3.4 碳足迹

**[EN]** We estimate the carbon emissions from pre-training the Gemma models to be 1247.61 tCO2eq. As in Gemma 1 (Gemma Team, 2024), this value is calculated based on the hourly energy usage reported directly from our TPU data centers and scaled to account for the additional energy expended to create and maintain the data center. Importantly, Google data centers are carbon neutral, achieved through a combination of energy efficiency, renewable energy purchases, and carbon offsets.

**[ZH]** 我们估计 Gemma 模型预训练的碳排放量为 1247.61 tCO2eq. 与 Gemma-1 一样, 该值基于直接从我们的 TPU 数据中心报告的每小时能源使用量计算, 并缩放以考虑创建和维护数据中心所消耗的额外能源. 重要的是, Google 数据中心通过能源效率、可再生能源购买和碳抵消的组合实现了碳中和.

---

## 4 后训练

**[EN]** For post-training, we fine-tune our pre-trained models into instruction-tuned models. First, we apply supervised fine-tuning (SFT) on a mix of text-only, English-only synthetic and human-generated prompt-response pairs. We then apply RLHF on top of these models with the reward model trained on labelled English-only preference data and the policy based on the same prompts as the SFT phase. Finally, we average the models obtained after each phase to improve their overall performance.

**[ZH]** 对于后训练, 我们将预训练模型微调为指令微调模型. 首先, 我们在混合了纯文本、纯英文的合成和人工生成的提示-响应对上应用监督微调(SFT). 然后, 我们在这些模型之上应用 RLHF, 奖励模型在标注的纯英文偏好数据上训练, 策略基于与 SFT 阶段相同的提示. 最后, 我们对每个阶段后获得的模型进行平均以提高整体性能.

**[EN]** Supervised fine-tuning (SFT). We run behavioral cloning on synthetic and real prompts, and responses predominantly synthetically generated by the teacher, that is a larger model. We also run distillation from the teacher on the student's distribution (Agarwal et al., 2024; Gu et al., 2024).

**[ZH]** 监督微调(SFT). 我们在合成和真实提示以及主要由教师(即更大的模型)合成生成的响应上运行行为克隆. 我们还在学生分布上运行来自教师的蒸馏.

> 译者注: 后训练阶段也使用了蒸馏! 这意味着 SFT 阶段的响应不是由人工标注的, 而是由大模型(教师)生成的. 这是一种"双重蒸馏"策略: 预训练阶段蒸馏知识, 后训练阶段蒸馏行为. 这大幅降低了对昂贵人工标注的依赖, 但也意味着模型的对话风格和能力上限受限于教师模型.

**[EN]** Reinforcement Learning from Human Feedback (RLHF). We use a similar RLHF algorithm as Gemma 1.1 (Gemma Team, 2024) but a different reward model, which is an order of magnitude larger than the policy. The new reward model is also oriented more towards conversational capabilities, specifically multi-turn.

**[ZH]** 基于人类反馈的强化学习(RLHF). 我们使用与 Gemma-1.1 类似的 RLHF 算法, 但使用了一个不同的奖励模型, 该奖励模型比策略模型大一个数量级. 新的奖励模型也更侧重于对话能力, 特别是多轮对话.

> 译者注: 奖励模型比策略模型"大一个数量级"——如果策略是 9B, 奖励模型可能是 90B 甚至更大. 这是一个非常奢侈的配置. 更大的奖励模型意味着更准确的偏好判断, 但也显著增加了 RLHF 的训练成本. 这与 Llama-2(奖励模型与策略同规模)和 DeepSeek-R1(使用规则奖励而非模型奖励)形成鲜明对比.

**[EN]** Model merging. We average different models obtained by running our pipeline with different hyperparameters (Rame et al., 2024).

**[ZH]** 模型融合. 我们对使用不同超参数运行管道获得的不同模型进行平均.

---

## 5 消融实验

**[EN]** In this section, we focus on the main finding of this work, which is the impact of knowledge distillation on small language models.

**[ZH]** 在本节中, 我们关注本工作的主要发现, 即知识蒸馏对小语言模型的影响.

**[EN]** Distillation versus from scratch. In Table 6, we show that distilling from a larger model improves performance compared to training from scratch. Note that 500B is 10x more than the compute-optimal number of tokens for a 2B model. We distill from a 7B model to keep a ratio similar to our target distillation from 27B to 9B.

**[ZH]** 蒸馏与从头训练对比. 在表 6 中, 我们展示了从更大的模型蒸馏相比从头训练可以提高性能. 注意, 500B 是 2B 模型计算最优 token 数量的 10 倍. 我们从 7B 模型蒸馏以保持与最终目标(从 27B 蒸馏到 9B)相似的比率.

> 译者注: 消融实验的设计很有讲究. 500B token 已经是 2B 模型计算最优量的 10 倍, 但即便如此, 蒸馏仍带来 12.3% 的相对提升. 这说明即使在过训练区域, 蒸馏提供的信号质量优势依然显著. 如果使用计算最优量(如 50B token), 蒸馏的优势可能会更大——因为从头训练在小数据量下更容易欠拟合, 而蒸馏可以弥补数据不足.

**[EN]** Impact of distillation w.r.t. model size. In Table 7, we measure the impact of distillation as model size increases. We observe that the gain remains as the model size is scaled. In this ablation, we maintain the size of the teacher at 7B and train smaller models to simulate the same gap as between our final teacher and student sizes.

**[ZH]** 蒸馏对模型规模的影响. 在表 7 中, 我们测量了随着模型规模增加的蒸馏影响. 我们观察到, 随着模型规模扩展, 增益仍然存在. 在此消融实验中, 我们将教师的大小保持在 7B, 并训练更小的模型以模拟最终教师和学生规模之间的相同差距.

**[EN]** GQA versus MHA. In Table 8, we compare two instances of our 9B with MHA or GQA. We observe overall few changes in performance between both models as measured on several benchmarks. We choose GQA since it requires fewer parameters and is faster at inference time.

**[ZH]** GQA 与 MHA 对比. 在表 8 中, 我们比较了 9B 模型的两个实例, 分别使用 MHA 或 GQA. 我们观察到在两个模型之间, 在几个基准测试上测量的总体性能变化很小. 我们选择 GQA, 因为它需要更少的参数并且推理速度更快.

---

## 6 评估

### 6.1 预训练评估

**[EN]** In this set of evaluations, we evaluate the performance of our 27B model trained without distillation on 13T tokens. We report results in Table 12, where we compare with a model of similar size, Qwen1.5 34B (Team, 2024), and a model 2.5x larger, LLaMA-3 70B on the HuggingFace evaluation suite.

**[ZH]** 在这组评估中, 我们评估在没有蒸馏的情况下在 13T token 上训练的 27B 模型的性能. 我们在表 12 中报告结果, 将其与类似规模的模型 Qwen1.5 34B 以及大 2.5 倍的模型 LLaMA-3 70B 在 HuggingFace 评估套件上进行比较.

**[EN]** Overall, we observe that our model is the best in its size category and is even competitive with a larger model that is trained for longer. That being said, the performance of models trained in a similar fashion improves only logarithmically with their size and hence, our model is likely in the same Pareto curve as the LLaMA-3 models.

**[ZH]** 总体而言, 我们观察到我们的模型在其规模类别中表现最佳, 甚至与训练时间更长的更大模型具有竞争力. 尽管如此, 以类似方式训练的模型的性能仅随规模对数改善, 因此, 我们的模型可能与 LLaMA-3 模型处于相同的帕累托曲线上.

> 译者注: "帕累托曲线"的表述很关键. 作者承认 27B 模型并没有打破 scaling law——它只是在现有的 scaling curve 上占据了一个更优的位置. 这意味着 Gemma-2 27B 的优势主要来自数据质量和训练优化, 而非架构上的根本性突破. 这与 DeepSeek-V2(通过 MLA 改变 scaling 性质)或 Mamba(通过状态空间模型改变架构)不同.

**[EN]** We observe overall a massive improvement in our models compared to previous versions, by up to 10% in some benchmarks for the 9B model. The two 2B models were trained with a similar number of tokens (2T for Gemma 2 and 3T for Gemma 1) and we still observe a significant improvement for the new models. This confirms that distillation significantly improves the quality of models even when trained on the same number of tokens.

**[ZH]** 总体而言, 我们观察到与先前版本相比, 我们的模型取得了巨大改进, 9B 模型在某些基准测试上提高了多达 10%. 两个 2B 模型使用了相似数量的 token 训练(Gemma-2 为 2T, Gemma-1 为 3T), 我们仍然观察到新模型的显著改进. 这证实了即使在相同数量的 token 上训练, 蒸馏也能显著提高模型质量.

### 6.2 后训练评估

**[EN]** Gemma 2 Instruction Tuned models were evaluated on the Chatbot Arena (Chiang et al., 2024) in blind side by side evaluations by human raters against other state of the art models. We report Elo scores in Table 14. Gemma 2.6B, 9B and 27B strongly outperform all other open models in the same range of parameters, with notably: Gemma 27B (Elo 1218) ranked higher than Llama 3 70B (Elo 1206), Gemma 9B (Elo 1187) similar as GPT-4-0314 (Elo 1186), Gemma 2.6B (Elo 1126) ranked higher than GPT-3.5-Turbo-0613 (Elo 1116).

**[ZH]** Gemma-2 指令微调模型在 Chatbot Arena 上通过人工评分员与其他最先进模型进行盲测对比评估. 我们在表 14 中报告 Elo 分数. Gemma-2 2B、9B 和 27B 强烈优于所有其他同等参数范围的开源模型, 特别是: Gemma-27B(Elo 1218)排名高于 Llama-3 70B(Elo 1206), Gemma-9B(Elo 1187)与 GPT-4-0314(Elo 1186)相当, Gemma-2B(Elo 1126)排名高于 GPT-3.5-Turbo-0613(Elo 1116).

> 译者注: Chatbot Arena 的盲测结果极具说服力. Gemma-9B IT 与早期 GPT-4 相当, 这意味着一个可以在消费级 GPU 上运行的 9B 模型达到了 2023 年初闭源旗舰的对话水平. 但需要注意, Chatbot Arena 主要评估的是对话流畅度和指令遵循能力, 而非严格的推理或编程能力. 此外, Elo 分数的置信区间显示, 1218 vs 1206 的差距在统计上可能不显著. 但方向性的结论——Gemma-2 在同规模开源模型中领先——是可靠的.

---

## 7 记忆化与隐私

**[EN]** Large language models may, under particular circumstances, be vulnerable to attacks causing the model to produce memorized training data (Nasr et al., 2023). To study susceptibility to such attacks and quantify memorization, we evaluate models for verbatim and approximate memorization as was done in several prior studies.

**[ZH]** 大型语言模型在特定情况下可能容易受到攻击, 导致模型生成记忆化的训练数据. 为了研究对此类攻击的敏感性并量化记忆化, 我们按照之前几项研究的做法评估模型的逐字记忆化和近似记忆化.

**[EN]** We find that Gemma 2 memorizes significantly less than prior models at a similar size, with memorization rates below 0.1% (note the log y-axis). We further investigate how this memorization breaks down with respect to the data source. Similar to Gemma 1, we find that Gemma 2 memorizes more from code, wiki, and science sources, and also that it memorizes significantly less across the board.

**[ZH]** 我们发现 Gemma-2 的记忆化显著少于先前同等规模的模型, 记忆化率低于 0.1%(注意对数 y 轴). 我们进一步调查了这种记忆化如何按数据源分解. 与 Gemma-1 类似, 我们发现 Gemma-2 从代码、维基和科学来源记忆化更多, 而且在所有来源上的记忆化都显著更少.

> 译者注: 记忆化率低于 0.1% 是一个非常好的结果. 但需要注意评估方法: 他们使用 50 token 的提示来诱导 50 token 的记忆化输出, 这是一种"提取攻击"设置. 更强大的攻击(如 membership inference 或 decoding with higher temperature)可能会提取更多记忆内容. 此外, 代码来源的记忆化率更高是一个已知现象——代码的结构化性质使其更容易被模型记忆.

**[EN]** We found no instances of high-severity data being emitted, and found a very low rate of 0.00026% of memorized data to contain lower-severity personal information. We note that these automated tools are known to incur false positives because they do not account for context. This means our results are likely overestimates.

**[ZH]** 我们没有发现高严重度数据被发出的实例, 并且发现记忆化数据中包含低严重度个人信息的比例非常低, 为 0.00026%. 我们注意到, 这些自动化工具已知会产生误报, 因为它们不考虑上下文. 这意味着我们的结果很可能是高估的.

> 译者注: 0.00026% 的比率听起来极低, 但需要放在绝对数量上考虑. 如果模型生成了 1M 个 token, 这意味着约 2.6 个 token 可能包含低严重度个人信息. 虽然概率很低, 但在大规模部署中仍然不可忽视. 此外, "低严重度"的定义由 Google Cloud DLP 工具决定, 可能存在分类偏差.
