---
title: "01 · CLIP 与视觉Encoder : InfoNCE、对比学习与 SigLIP 改进"
date: 2026-05-16
tags: [CLIP, 视觉Encoder , 对比学习, InfoNCE, SigLIP, 多模态]
---

# 01 · CLIP 与视觉Encoder : InfoNCE、对比学习与 SigLIP 改进

## 1. 背景与核心痛点 (Background & Pain Points)

### 1.1 视觉理解的旧世界: 被标注数据锁死的笼子

在 2020 年以前, 计算机视觉领域的主流范式几乎完全被**监督学习(Supervised Learning)** 所统治. 如果你让一台机器理解图像, 标准操作是: 收集数万张甚至数百万张图片, 雇人用 bounding box 或类别标签逐一标注, 然后用这些数据训练一个深度卷积神经网络(CNN), 例如 AlexNet、VGG、ResNet. ImageNet 数据集——包含约 128 万张图片和 1000 个类别——成为了这个时代的事实标准. 

这套范式的核心逻辑是: 

1. **定义一个固定的类别集合**(如 1000 个 ImageNet 类别). 

2. **为每张图片分配一个独热标签**(One-Hot Label). 

3. **训练分类器**, 使得网络输出的 logits 在正确类别上概率最大. 

4. **迁移学习**: 将预训练好的 CNN backbone 提取的特征, 迁移到下游的检测、分割、检索等任务. 

这套方法在工程上取得了巨大的成功, 但它有一个致命的结构性缺陷——**语义天花板极低**. 一个用 ImageNet 训练的分类器, 它的全部"世界观"被压缩在那 1000 个类别里. 你问它 "这张图片里有一只金毛犬在草地上奔跑", 它最多只能说 "这是狗". 你问它 "这只狗在干什么", 它完全无法回答. 因为分类任务的输出空间是一个有限的、预先定义好的离散集合, 模型从未被训练过去理解图像中蕴含的**开放语义(Open-Vocabulary Semantics)** . 

更致命的是**标注成本**. ImageNet 1000 类已经耗费了数以千计的人年. 如果你想让模型理解 "一只穿着宇航服的猫在月球上弹吉他" 这样的复杂概念, 你几乎需要从头构建一个全新的大规模标注数据集. 每一个新类别、每一种新关系, 都需要人工去定义和标注. 这种对标注数据的贪婪需求, 形成了一个几乎无法打破的瓶颈——模型能力的上限, 被标注预算的上限死死锁住. 

此外, 传统的视觉监督学习还有一个深层的问题: **它从未真正教会模型"理解"图像, 而只是教会了模型"记忆"人工定义的分类边界**. 模型学到的特征表示, 本质上是围绕着那 1000 个分类决策面组织的. 这些特征在判别 "哈士奇" 和 "狼" 时也许很有效, 但在描述 "一只孤独的狼站在雪原上仰望星空" 这种充满叙事性和情感色彩的语义时, 它们几乎是一片空白. 

### 1.2 语言模型的觉醒: 自监督学习的范式革命

几乎在同一时期, 自然语言处理(NLP)领域发生了一场静悄悄的革命. 2017 年 Transformer 架构的出现, 为语言模型提供了前所未有的并行计算能力和长程依赖建模能力. 但真正让 NLP 甩开 CV 几条街的, 是**自监督学习(Self-Supervised Learning)** 范式的成熟. 

2018 年, BERT 横空出世. 它的核心思想极其优雅: 不再依赖昂贵的人工标注, 而是利用文本自身的结构来构造监督信号. 对于语言来说, 这种结构是天然的——句子中的词与词之间存在着语法、语义和逻辑上的强相关性. BERT 的预训练任务包括: 

- **Masked Language Modeling(MLM)** : 随机遮住句子中的一些词, 让模型根据上下文预测被遮住的词是什么. 

- **Next Sentence Prediction(NSP)** : 给定两个句子, 让模型判断它们在原文中是否是相邻的. 

这些任务完全不需要人工标注. 模型在海量的无标注文本(如 Wikipedia、BookCorpus)上进行预训练, 自然而然地学会了语言的深层结构、语法规则、语义关联乃至世界知识. 

随后在 2019-2020 年, GPT 系列将这一思想推向了极致. GPT 采用**自回归(Autoregressive)** 的语言建模目标: 给定一个前缀, 预测下一个 token. 这个目标虽然简单到近乎简陋, 但当模型参数量扩展到数十亿乃至千亿级别, 当训练数据覆盖了整个互联网的文本, 模型涌现出了惊人的能力——它不仅能生成流畅的文本, 还能回答事实性问题、进行推理、翻译语言、甚至编写代码. 

语言模型成功的核心启示在于: **数据本身就是一种监督信号**. 文本的序列结构蕴含了丰富的语义信息, 模型只需要学会"预测", 就能在过程中习得表示. 这就提出了一个令人振奋的问题: 图像是否也存在类似的"自监督结构"？我们能否像语言模型一样, 用海量的无标注图像来训练出强大的视觉表示？

### 1.3 模态鸿沟: 为什么视觉和语言难以对齐

视觉和语言, 是人类认知世界的两种基本媒介, 但它们在数学结构上存在着根本性的差异, 这种差异构成了多模态学习中最核心的挑战——**模态鸿沟(Modality Gap)** . 

**文本空间是离散的、高语义密度的**. 文本由词汇表中的 token 组成, 每个 token 都携带着明确的语义指称. "猫" 这个词直接对应了一个概念, 与 "狗"、"汽车"、"天空" 之间的语义关系可以通过大量的语料统计来建模. 文本的表示空间虽然是高维的(如 768 维或 4096 维的 embedding), 但它的基础元素是离散的、语义明确的符号. 

**图像空间是连续的、低语义密度的**. 一张图片是一个 $H \times W \times 3$ 的张量, 每个像素只是一个 0-255 的标量值. 单独看一个像素(RGB: [120, 85, 200]), 它没有任何语义意义——它可能是猫的耳朵, 也可能是天空的一角, 还可能是桌布的花纹. 图像的语义是"涌现"出来的, 只有在看了足够多的像素、捕捉到足够的空间结构之后, "猫"这个概念才浮现出来. 

这种差异带来了三个层面的对齐难题: 

**第一, 粒度不对齐**. 在文本中, 最小的语义单位是 token(通常是子词或词). 在图像中, 最小的处理单位是像素, 但单个像素几乎没有语义. 视觉语义的基本单元通常是"对象"或"区域", 这与文本 token 的粒度完全不同. 

**第二, 结构不对齐**. 文本天然具有序列结构, 词与词之间的顺序关系编码了语法和逻辑. 图像具有二维的空间结构, 物体之间的位置关系、遮挡关系、尺度关系构成了视觉理解的骨架. 这两种结构之间没有天然的对应映射. 

**第三, 语义密度不对齐**. 一段文本中的每个词都承载着信息. 但一张图片中的大量像素可能是冗余的(例如纯色的背景、重复的纹理). 反过来, 一个视觉概念可能需要很长的文本描述才能精确表达(例如 "那只戴着红色项圈、趴在蓝色沙发上、眼睛半睁半闭的橘猫"). 

因此, 将图像和文本映射到同一语义空间, 本质上是一个**异构空间的对齐问题**. 你不能简单地把图像展平成一个向量, 然后和文本的 embedding 做内积. 你需要设计一种学习机制, 让模型在海量的图像-文本对中, 自动发现两种模态之间的语义对应关系. 

### 1.4 核心痛点: 如何在无逐像素标注的情况下学习视觉-语言对齐

在 CLIP 出现之前, 视觉-语言预训练(Vision-Language Pre-training, VLP)的主流方法是各种形式的**监督对齐**. 例如, 在图像描述(Image Captioning)任务中, 模型需要逐词生成与图片匹配的文本描述. 这需要成对的图像-描述数据, 而高质量的人工描述依然昂贵. 

更根本的问题是, 即使是图像描述这样的任务, 它的监督信号也是**"弱"**的. 模型看到的只是一个图片和一句描述, 但它不知道图片中的哪些区域对应描述中的哪些词. 这种"弱监督"虽然比人工标注 bounding box 便宜, 但仍然需要大量的人工撰写描述文本. 

业界真正渴望的是一种**完全不需要人工细粒度标注**的视觉-语言预训练方法. 它应该像语言模型的自监督学习一样, 利用互联网上已有的、天然存在的图像-文本对(例如网页上的图片和它的 alt 文本、社交媒体上的图片和配文)作为训练数据. 这些数据的规模可以达到数十亿对, 而且完全免费. 

但问题在于: 如果我们只有图片和配文, 而没有它们之间的逐元素对应关系, 我们能学到什么？如果我们只知道"这张图和这句话是相关的", 我们能否训练出一个强大的视觉表示？

OpenAI 在 2021 年发布的 CLIP(Contrastive Language-Image Pre-training)给出了一个响亮的**是**. CLIP 的核心洞察是: 你不需要知道"图片的左上角对应文本的第一个词", 你只需要知道"这张图片和这句话是匹配的, 而和其他句子不匹配的"——这就足够了. 这种**对比学习(Contrastive Learning)** 的范式, 彻底打破了视觉理解对人工标注的依赖, 开启了大模型时代的多模态革命. 

## 2. 为什么重要 (Significance)

### 2.1 CLIP: 所有现代视觉语言模型的视觉基石

如果你打开任何一个 2024-2026 年主流的多模态大模型(VLM)的技术报告——无论是 LLaVA、Qwen-VL、InternVL、DeepSeek-VL 还是 GPT-4o——你会发现它们的视觉模块几乎无一例外地基于 CLIP 或其改进版本. CLIP 已经成为了现代 VLM 的**事实标准视觉Encoder **. 

这种统治地位不是偶然的. 在 VLM 的架构中, 通常存在两个核心组件: 

1. **视觉Encoder (Vision Encoder)** : 负责将输入图像编码成一个紧凑的视觉特征向量序列. 

2. **语言模型(LLM)** : 负责接收视觉特征(通常通过某种 adapter 或 projection 层)并生成文本输出. 

在这个架构中, 视觉Encoder 的质量直接决定了整个 VLM 的"视力". 如果视觉Encoder 无法准确提取图像中的语义信息, 后面的语言模型再强大也无济于事——巧妇难为无米之炊. 

CLIP 提供的正是一个**在海量互联网数据上预训练好的、具有强大开放词汇语义理解能力的视觉Encoder **. 它不需要针对特定任务进行微调, 就能提取出对多种下游任务都有用的通用视觉特征. 这使得研究人员可以"即插即用"地将 CLIP 作为视觉 backbone, 极大地降低了 VLM 的开发门槛. 

### 2.2 Zero-Shot 分类: 打破分类任务的类别边界

CLIP 在发布时展示了一个令业界震惊的能力: **Zero-Shot 图像分类**. 传统的图像分类器被锁定在预定义的类别集合中, 而 CLIP 可以处理任意自然语言描述的类别. 

具体做法极为简洁: 假设你想对一张图片进行分类, 但你不想局限于 ImageNet 的 1000 个类别. 你可以用任意文本描述作为类别名称, 例如: 

- "a photo of a cat"
- "a photo of a dog"
- "a photo of a person riding a bicycle"
- "a photo of a solar eclipse"

CLIP 会分别计算图像与每个文本描述之间的相似度, 然后选择相似度最高的那个作为分类结果. 这意味着 CLIP 的分类能力**不受训练时见过的类别限制**——只要你能用自然语言描述一个概念, CLIP 就有可能识别它. 

在 ImageNet 上的 Zero-Shot 测试中, CLIP 取得了与在 ImageNet 全量数据上监督训练的 ResNet-50 相当的准确率. 而 ResNet-50 是用了 128 万张标注图片训练出来的, CLIP 在训练时**一张 ImageNet 的标注图片都没见过**. 这种从"有监督分类"到"零样本分类"的范式转换, 彻底颠覆了计算机视觉领域对分类任务的基本认知. 

### 2.3 图像检索与多模态表征的标准方案

除了分类, CLIP 还在图像检索、文本检索、跨模态检索等任务中成为了事实上的标准方案. 

在图像检索场景中, 你可以将所有图片库中的图像通过 CLIP 的视觉Encoder 编码成向量, 存储在向量数据库中. 当用户输入一个文本查询(如 "黄昏时分的埃菲尔铁塔"), 你将查询文本编码成向量, 然后在向量空间中进行最近邻搜索. 由于 CLIP 将图像和文本映射到了同一语义空间, 这种跨模态检索在效果上远超传统的基于标签或人工标注的检索方法. 

在更广泛的**多模态表征学习**领域, CLIP 训练出的联合嵌入空间(Joint Embedding Space)成为了后续研究的基石. 任何需要将不同模态(图像、文本、甚至音频、视频)映射到统一语义空间的工作, 几乎都会以 CLIP 的设计作为起点或参照. 

### 2.4 SigLIP 与后续改进: 2024-2026 年 VLM 的默认选择

CLIP 的原始设计虽然开创性的, 但并非没有缺陷. 其中一个关键问题在于它的训练目标——基于 softmax 的对比损失——对 batch size 极其敏感, 且要求图像和文本的数量严格相等(对称 batch). 这在实际的大规模训练中带来了工程上的挑战. 

2023 年, Google DeepMind 提出了 **SigLIP(Sigmoid Loss for Language Image Pre-Training)** . SigLIP 的核心改动看似简单: 将 CLIP 的 softmax-based 对比损失替换为 sigmoid-based 二元交叉熵损失. 但这个小改动带来了巨大的工程收益: 

- **不再需要全局归一化**: sigmoid 是逐对计算的, 不需要在整个 batch 上做 softmax 归一化. 

- **对 batch size 不敏感**: 训练稳定性不再强依赖于巨大的 batch size. 

- **支持非对称 batch**: 图像和文本的数量可以不相等, 这为数据加载和分布式训练提供了极大的灵活性. 

- **训练效率更高**: 实验表明, SigLIP 在相同数据量下可以取得与 CLIP 相当甚至更优的效果, 同时训练速度更快、内存占用更低. 

因此, 在 2024-2026 年的主流 VLM 中, SigLIP 或其变体(如 SigLIP 2)已经取代原始 CLIP, 成为了视觉Encoder 的默认选择. 例如, Google 的 Gemini 系列、PaliGemma, 以及多个开源 VLM 的最新版本, 都采用了 SigLIP 作为视觉 backbone. 

理解 CLIP 和 SigLIP, 不仅是理解一个算法, 更是理解整个现代多模态 AI 大厦的地基. 

## 3. 直觉类比 (Intuition)

### 3.1 图像是视觉的"语言"

在深入数学之前, 让我们先用一个直觉类比来建立对 CLIP 核心思想的物理感知. 

想象世界上存在两种描述现实的方式: 

- **第一种是文字**. 当你说 "一只橘猫趴在窗台上晒太阳", 你用一串离散的符号(汉字)精确地描述了一个场景. 每个词都有明确的语义: "橘猫" 指代一种动物, "窗台" 指代一个位置, "晒太阳" 指代一个动作. 

- **第二种是图像**. 一位画家画下了这个场景——橘色的毛发、窗台的木质纹理、阳光在地板上投下的光斑. 这幅画是连续的、像素级的, 没有一个符号直接写着 "猫", 但任何看到这幅画的人都能瞬间识别出 "这是一只猫, 它在窗台上". 

文字和图像, 本质上是**同一个世界的两种"语言"**. 它们描述的是同一组语义实体和关系, 只是表达方式不同. 如果你是一位精通多门语言的语言学家, 你会说: 英语、中文、法语虽然语法不同, 但它们都可以表达 "我爱你" 这个意思. 同样, 一张照片和一段文字描述虽然"语法"完全不同, 但它们也可以表达同一个语义. 

CLIP 的核心任务, 就是训练一个**精通"图像语"和"文本语"的翻译官**. 但这个翻译官有一个特殊之处: 它不需要逐词对照地翻译. 你不需要教它 "图片左上角的像素 [120, 85, 200] 对应文本中的第一个字'一'"——这种细粒度的对齐数据既昂贵又难以获取. 

### 3.2 对比学习 = 在一堆干扰项中找到自己的搭档

那么, 如果不教逐词对照, 我们怎么训练这个翻译官呢？

想象一个语言学习班. 老师拿着一张图片走进教室, 同时念出一段描述. 然后老师说: "同学们, 这张图片对应这段描述. 现在我要给你们做一个小测试——我会给你们看一堆图片和一堆描述, 你们要把匹配的图片和描述连起来. "

这就是**对比学习(Contrastive Learning)** 的直觉核心. 

具体来说, 假设你的 batch 里有 $N$ 张图片和 $N$ 段文本(它们一一对应). 在训练过程中, 模型会看到所有的图片和所有的文本. 对于每一张图片, 模型需要回答一个问题: "在这 $N$ 段文本中, 哪一段是和这张图片匹配的？" 同样, 对于每一段文本, 模型也要回答: "在这 $N$ 张图片中, 哪一张是和这段文本匹配的？"

对角线上的配对(第 $i$ 张图片和第 $i$ 段文本)是"正样本"——它们确实是对应的. 而所有非对角线的配对(第 $i$ 张图片和第 $j$ 段文本, $j \neq i$)是"负样本"——它们是不相关的. 

**关键在于, 模型在学习的过程中, 从来没有被明确地告知"图片的哪一部分对应文本的哪个词". 它只被告诉"这张图和这句话是一对". ** 但就是这种"弱监督"信号, 当数据规模达到数亿对时, 模型竟然能够自动学会将语义相关的图像和文本拉得更近, 将不相关的推得更远. 

### 3.3 为什么"弱监督"反而有效？

这看似违反直觉: 只告诉模型"这是一对", 而不告诉它"具体怎么对应", 模型怎么可能学会精确的对齐？

答案在于**规模(Scale)** 和**统计规律(Statistical Regularity)** . 

当训练数据只有 1000 对时, "弱监督"确实太弱了. 模型可能学到一些表面的、虚假的相关性(例如所有"猫"的图片碰巧都有某种特定的色调). 但当数据规模达到 4 亿对(CLIP 使用的 WebImageText 数据集)时, 统计规律开始占据主导地位. 

在 4 亿对数据中: 

- 凡是描述中包含 "cat" 的文本, 几乎总是和包含猫的图片配对. 
- 凡是描述中包含 "red" 的文本, 配对的图片中大概率有红色物体. 
- 凡是描述中包含 "running" 的文本, 配对的图片中大概率有运动的物体. 

虽然模型看不到"这个词对应这个区域"的标注, 但通过在海量数据上的对比学习, **"语义共现"的统计信号足够强**, 使得模型能够自动推断出哪些视觉特征与哪些文本概念相关联. 

这就像让一个婴儿学语言: 你不需要指着每一个物体教婴儿"这是杯子"、"这是桌子". 你只要在日常生活中自然地说话, 婴儿通过观察什么词在什么情境下出现, 就能逐渐建立词汇与世界的映射. CLIP 的学习过程, 本质上也是这种"统计浸泡式学习"的机器学习版本. 

![对比学习匹配与干扰项对比示意图](images/contrastive_learning_partner.png)

> **图 1.1 对比学习：在一堆干扰项中找到自己的搭档**
> * **正样本配对(粗红线)**：对角线上的输入对 $(x_i, y_i)$ 对应了匹配的图像与文本语义(例如：猫的图片 $\leftrightarrow$ "a photo of a cat"). 模型被训练来最大化这些对的点积(相似度), 将它们拉近. 
> * **负样本配对(细灰线)**：非对角线上的异构配对 $(x_i, y_j)$(例如：猫的图片 $\leftrightarrow$ "a photo of a dog")是无关或干扰的, 代表负样本. 对比学习不仅要拉近正样本, 还要将负样本推远, 让模型在排除干扰项的过程中学习到本质的语义分类特征. 


## 4. 数学推导与公式对比 (Mathematical Rigor)

### 4.1 对比学习框架的形式化定义

现在我们将直觉翻译成严格的数学语言. 

CLIP 的目标是同时学习两个Encoder : 

- **图像Encoder ** $f_I: \mathcal{X} \to \mathbb{R}^d$: 将输入图像 $x$ 映射到一个 $d$ 维的向量表示. 

- **文本Encoder ** $f_T: \mathcal{Y} \to \mathbb{R}^d$: 将输入文本 $y$ 映射到一个 $d$ 维的向量表示. 

两个Encoder 输出的向量维度相同(例如 $d = 512$ 或 $768$), 这使得它们可以被直接比较. 

训练数据是一个包含 $N$ 个样本的 batch: $\{(x_1, y_1), (x_2, y_2), \ldots, (x_N, y_N)\}$, 其中 $(x_i, y_i)$ 是一对匹配的图像和文本. 

**核心优化目标**是: 对于任意匹配对 $(x_i, y_i)$, 它们的嵌入向量在空间中应该足够接近; 对于任意非匹配对 $(x_i, y_j)$($j \neq i$), 它们的嵌入向量应该足够远离. 

为了量化"接近"和"远离", CLIP 使用**余弦相似度(Cosine Similarity)** . 给定两个向量 $u, v \in \mathbb{R}^d$, 它们的余弦相似度定义为: 

$$
 \text{sim}(u, v) = \frac{u^\top v}{\|u\| \|v\|} \tag{1}
$$

在实际实现中, CLIP 会对Encoder 的输出进行 L2 归一化, 使得 $\|f_I(x_i)\| = \|f_T(y_j)\| = 1$. 此时余弦相似度简化为简单的**点积**: 

$$
 \text{sim}(f_I(x_i), f_T(y_j)) = f_I(x_i)^\top f_T(y_j) \tag{2}
$$
这种归一化不仅简化了计算, 还有一个重要的几何意义: 它将所有表示向量限制在单位超球面上, 使得相似度天然有界在 $[-1, 1]$ 之间. 

### 4.2 InfoNCE Loss 的完整推导

CLIP 使用的核心损失函数是 **InfoNCE(Noise Contrastive Estimation)** . 这是整个算法家族的灵魂所在, 我们必须从第一性原理出发, 完整推导它的数学形式和物理意义. 

#### 4.2.1 从互信息(Mutual Information)出发

对比学习的理论根基是**互信息(Mutual Information, MI)** . 互信息衡量了两个随机变量之间的统计依赖性: 

$$
 I(X; Y) = \mathbb{E}_{p(x,y)} \left[ \log \frac{p(x, y)}{p(x)p(y)} \right] \tag{3}
$$

其中 $p(x, y)$ 是联合分布, $p(x)$ 和 $p(y)$ 是边缘分布. 互信息越大, 说明 $X$ 和 $Y$ 的关联越强. 

我们的目标是学习Encoder  $f_I$ 和 $f_T$, 使得编码后的表示 $Z_I = f_I(X)$ 和 $Z_T = f_T(Y)$ 之间的互信息最大化. 但直接计算互信息是困难的, 因为它需要对联合分布和边缘分布做积分或求和, 这在高维空间中几乎不可行. 

InfoNCE 的核心思想是: 我们不直接估计互信息, 而是估计互信息的**下界**. 有一个重要的不等式: 

$$
 I(X; Y) \geq \mathbb{E}_{p(x,y)} \left[ \log \frac{f(x, y)}{a(x, y)} \right] \tag{4}
$$
其中 $f(x, y)$ 是一个待学习的评分函数, 而 $a(x, y)$ 是一个归一化项. InfoNCE 选择了一种特殊的 $a(x, y)$ 形式, 使得这个下界变得可计算且具有优良的优化性质. 

#### 4.2.2 InfoNCE 的精确数学定义

考虑一个 batch 包含 $N$ 对样本 $\{(x_1, y_1), \ldots, (x_N, y_N)\}$. 对于第 $i$ 对样本 $(x_i, y_i)$, 我们定义其**正样本**为 $y_i$, 而**负样本**为 batch 中所有其他的文本 $\{y_j : j \neq i\}$. 

为了将"匹配样本靠近、非匹配样本远离"的直觉转化为可优化的目标, InfoNCE 对每一张图片 $x_i$ 都在整个 batch 的文本上构建一个 softmax 概率分布, 并要求真实匹配文本 $y_i$ 占据最大概率. 图像到文本方向的损失具体写为: 

$$
 \mathcal{L}_{I \to T} = -\frac{1}{N} \sum_{i=1}^{N} \log \frac{\exp(\text{sim}(f_I(x_i), f_T(y_i)) / \tau)}{\sum_{j=1}^{N} \exp(\text{sim}(f_I(x_i), f_T(y_j)) / \tau)} \tag{5}
$$

从优化机制来看, 分子中的 $\text{sim}(f_I(x_i), f_T(y_i))$ 被放在指数位置, 模型被鼓励不断增大正样本对的相似度; 分母则对 batch 中所有文本(正样本和负样本一起)的相似度做指数求和, 形成归一化竞争, 确保正样本的得分是在全部候选中"赢出来"的相对优势. 温度参数 $\tau$ 控制着概率分布的尖锐程度——较小的 $\tau$ 会放大正负差距, 使训练更关注难以区分的负样本; 较大的 $\tau$ 则让分布更平缓, 对所有负样本一视同仁. 前面的负号将对数概率转换为需要最小化的损失. 在实际训练场景中, 当 batch 里同时出现"猫的图片—猫的描述"正样本和"猫的图片—汽车的描述"负样本时, 损失会同时驱动猫图向猫文靠拢、向车文远离, 从而在联合嵌入空间中形成清晰的语义聚类. 

#### 4.2.3 对称损失: 图像到文本 + 文本到图像

上述损失只考虑了"给定一张图片, 找到匹配的文本"这个方向. 但对比学习的框架天然是对称的——我们也可以考虑"给定一段文本, 找到匹配的图片"这个方向: 

$$
 \mathcal{L}_{T \to I} = -\frac{1}{N} \sum_{i=1}^{N} \log \frac{\exp(\text{sim}(f_I(x_i), f_T(y_i)) / \tau)}{\sum_{j=1}^{N} \exp(\text{sim}(f_I(x_j), f_T(y_i)) / \tau)} \tag{6}
$$
注意分母的变化: 对于第 $i$ 段文本 $y_i$, 我们需要在所有 $N$ 张图片中找到匹配的那一张. 

CLIP 的最终损失是这两个方向损失的**平均值**: 

$$
 \mathcal{L}_{\text{CLIP}} = \frac{1}{2} \left( \mathcal{L}_{I \to T} + \mathcal{L}_{T \to I} \right) \tag{7}
$$

这种对称设计有两个好处: 

1. **无偏性**: 不假设某个模态比另一个更重要, 让两个Encoder 平等地参与学习. 

2. **信号增强**: 每个 batch 提供了 $2N$ 个训练信号($N$ 个图像到文本, $N$ 个文本到图像), 而不是 $N$ 个. 

#### 4.2.4 温度参数 $\tau$ 的物理意义

温度参数 $\tau$ 是 InfoNCE 中一个极易被忽视但极其重要的超参数. 它的取值直接决定了模型的行为. 

**当 $\tau \to 0^+$ 时**: 

指数函数 $\exp(z/\tau)$ 会变成一个极其陡峭的函数. 分母中最大的那个相似度项会主导整个求和. 在极限情况下, softmax 退化为**硬最大值(hard max)** : 

$$
 \lim_{\tau \to 0} \frac{\exp(z_i / \tau)}{\sum_j \exp(z_j / \tau)} = \begin{cases} 1 & \text{if } z_i = \max_j z_j \\ 0 & \text{otherwise} \end{cases} \tag{8}
$$
这意味着损失只关注" hardest 的负样本"——即与查询图片最相似的那个负样本文本. 模型会被迫去"惩罚"那些难以区分的负样本, 而对容易的负样本几乎不施加梯度. 这种极端情况下的训练类似于 hard negative mining, 梯度方差可能较大, 但区分能力可能更强. 

**当 $\tau \to +\infty$ 时**: 

指数函数趋近于线性. softmax 趋向于**均匀分布**: 

$$
 \lim_{\tau \to \infty} \frac{\exp(z_i / \tau)}{\sum_j \exp(z_j / \tau)} = \frac{1}{N} \tag{9}
$$

这意味着所有负样本都被赋予相同的权重, 无论它们与查询的相似度如何. 损失函数趋向于一个"平均"的对比目标, 忽略了负样本之间的难度差异. 梯度变得更平滑, 但可能无法充分学习细粒度的区分. 

**实际选择**: CLIP 在实验中发现的"甜点"温度大约在 $\tau \approx 0.07$(不可学习的固定值)附近. 值得注意的是, CLIP 原始论文中将 $\tau$ 设为**可学习参数**, 让模型在训练过程中自动发现最优温度. 后续的 SigLIP 等工作中, 温度通常作为可学习参数或固定超参数处理. 

温度参数还可以从另一个角度理解: 它控制了表示空间中相似度分布的"熵". 较低的 $\tau$ 使得相似度分布更尖锐, 模型更"自信"; 较高的 $\tau$ 使得分布更平坦, 模型更"保守". 在多模态学习中, 由于正负样本的判别难度不同, 温度参数实际上充当了**自适应难度调节器**的角色. 

#### 4.2.5 InfoNCE 与 Softmax 分类的等价视角

InfoNCE 有一个极为优雅的解释: **它本质上是将对比学习视为一个 batch 内的多分类问题**. 

考虑图像到文本方向. 对于第 $i$ 张图片 $x_i$, 我们有 $N$ 个候选文本 $\{y_1, y_2, \ldots, y_N\}$. 其中只有 $y_i$ 是正确的匹配(正类), 其余 $N-1$ 个文本都是错误的匹配(负类). 

如果我们把这看作一个 $N$ 类分类问题, 第 $i$ 类的 logit 为 $\text{sim}(f_I(x_i), f_T(y_j)) / \tau$, 那么标准的多类交叉熵损失恰好就是: 

$$
 \mathcal{L}_{\text{CE}} = -\log \frac{\exp(\text{sim}(f_I(x_i), f_T(y_i)) / \tau)}{\sum_{j=1}^{N} \exp(\text{sim}(f_I(x_i), f_T(y_j)) / \tau)} \tag{10}
$$
这正是 InfoNCE！

这个等价视角的深刻意义在于: 

1. **对比学习 = 分类学习**: 它不需要特殊的新理论, 而是将问题转化为一个在每个 batch 内部进行的分类问题. 

2. **类别数 = batch size**: 类别的数量不是预先固定的(如 ImageNet 的 1000 类), 而是等于当前 batch 的大小 $N$. 这意味着"类别"在每一步训练时都在变化, 模型需要学会一种**开放集分类**的能力. 

3. **负样本即类别**: batch 中的每一个其他样本都充当了一个"负类别". 因此, batch size 越大, "类别"越多, 分类任务越难, 但学习到的表示也越具有判别性. 

### 4.3 正负样本相似度矩阵(核心)

让我们将 InfoNCE 的计算过程用矩阵形式表示, 这在实现和理解上都更加直观. 

#### 4.3.1 相似度矩阵的构造

给定一个 batch 的 $N$ 对样本, 我们首先计算图像特征矩阵 $I \in \mathbb{R}^{N \times d}$ 和文本特征矩阵 $T \in \mathbb{R}^{N \times d}$: 

$$
 I = \begin{bmatrix} f_I(x_1)^\top \\ f_I(x_2)^\top \\ \vdots \\ f_I(x_N)^\top \end{bmatrix}, \quad T = \begin{bmatrix} f_T(y_1)^\top \\ f_T(y_2)^\top \\ \vdots \\ f_T(y_N)^\top \end{bmatrix} \tag{11}
$$

然后计算**相似度矩阵** $S \in \mathbb{R}^{N \times N}$: 

$$
 S = I \cdot T^\top \tag{12}
$$
展开写, 矩阵的第 $i$ 行第 $j$ 列元素为: 

$$
 S_{ij} = f_I(x_i)^\top f_T(y_j) = \text{sim}(x_i, y_j) \tag{13}
$$

这个矩阵具有极其清晰的几何结构: 

- **对角线元素** $S_{ii} = f_I(x_i)^\top f_T(y_i)$: 第 $i$ 张图片与其匹配文本的相似度, 即**正样本相似度**. 

- **非对角线元素** $S_{ij}$($j \neq i$): 第 $i$ 张图片与不匹配文本的相似度, 即**负样本相似度**. 

![对比学习正负样本相似度矩阵热力图](images/clip_similarity_matrix.png)

> **图 1.2 对比学习相似度矩阵 $S = I \cdot T^\top$ 几何映射**
> * **对角线高亮(正样本)**：对角线处的元素 $S_{ii} = f_I(x_i)^\top f_T(y_i)$ 对应配对相似度, 由于梯度上升优化, 表现为高相似度(热力图中的亮黄色/橙红色). 
> * **非对角线暗色(负样本)**：其余位置 $S_{ij} = f_I(x_i)^\top f_T(y_j)$(其中 $j \neq i$)对应 batch 内不匹配的跨模态输入, 相似度被强力压制在低分区间(深蓝色/黑色). 该矩阵展示了 CLIP 损失计算如何在一次前向传播中同时建立 $N$ 对正样本对与 $N(N-1)$ 对负样本对的对比. 


#### 4.3.2 从矩阵视角理解 InfoNCE

有了相似度矩阵 $S$, InfoNCE 损失可以非常紧凑地写成矩阵运算. 

**图像到文本方向**: 对 $S$ 的每一行做 softmax(沿列方向), 然后取对角线元素的对数平均: 

$$
 \mathcal{L}_{I \to T} = -\frac{1}{N} \sum_{i=1}^{N} \log \left( \text{softmax}\left(\frac{S_{i,:}}{\tau}\right)_i \right) \tag{14}
$$
这里 $S_{i,:}$ 表示 $S$ 的第 $i$ 行, $\text{softmax}(\cdot)_i$ 表示该行 softmax 后的第 $i$ 个元素(即对角线位置). 

**文本到图像方向**: 对 $S$ 的每一列做 softmax(沿行方向), 然后取对角线元素的对数平均: 

$$
 \mathcal{L}_{T \to I} = -\frac{1}{N} \sum_{i=1}^{N} \log \left( \text{softmax}\left(\frac{S_{:,i}}{\tau}\right)_i \right) \tag{15}
$$

这个矩阵视角揭示了对比学习的一个关键特性: **一次前向传播, 生成 $N \times N$ 个相似度计算, 但只需要 $2N$ 个Encoder 前向传播**($N$ 个图像编码 + $N$ 个文本编码). 这种计算效率是 InfoNCE 能够在大规模数据上高效训练的重要原因. 

#### 4.3.3 有效 Batch Size 与负样本数量

对比学习的一个核心概念是**有效 batch size(Effective Batch Size)** . 在 InfoNCE 中, 每个正样本的对比对象是整个 batch 中的其他 $N-1$ 个负样本. 因此: 

- 如果 batch size 为 $N$, 每个训练样本利用了 $N-1$ 个负样本. 
- 总训练信号的数量为 $N \times (N-1)$ 个负样本对 + $N$ 个正样本对 = $N^2$ 对. 

这意味着对比学习是**二次于 batch size**的. batch size 增加一倍, 负样本数量增加四倍, 训练信号的丰富程度显著提升. 

从梯度估计的角度分析: InfoNCE 的梯度可以看作是基于负样本采样的蒙特卡洛估计. 更多的负样本意味着对分母中归一化项的更准确估计, 从而导致梯度的方差更小, 训练更稳定. 

为了更直观地理解 batch size 的重要性, 我们来分析两个极端情况: 

**极端情况 1: $N = 2$**

Batch 中只有 2 对样本: $(x_1, y_1)$ 和 $(x_2, y_2)$. 

相似度矩阵为: 

$$
 S = \begin{bmatrix} S_{11} & S_{12} \\ S_{21} & S_{22} \end{bmatrix} \tag{16}
$$
对于图像到文本方向: 
- $x_1$ 只有 1 个负样本 $y_2$. 
- $x_2$ 只有 1 个负样本 $y_1$. 

模型需要区分 $S_{11}$ vs $S_{12}$, 以及 $S_{22}$ vs $S_{21}$. 但每个查询只有一个负样本, 如果碰巧这个负样本与查询非常不相似(例如 $y_2$ 描述"一辆红色跑车", 而 $x_1$ 是"一只白色小狗"), 那么区分任务太容易了, 模型几乎学不到什么有用的梯度. 反之, 如果负样本碰巧与查询很相似(例如 $y_2$ 描述"一只白色小猫"), 那么这一个负样本又可能过于困难, 导致梯度不稳定. 

**结论**: $N = 2$ 时, 对比信号极度稀疏, 训练几乎不可能有效进行. 

**极端情况 2: $N = 32768$(CLIP 的大规模训练配置)** 

Batch 中有 32768 对样本. 每个查询有 32767 个负样本, 覆盖了极其丰富的语义空间——从动物到风景, 从抽象概念到具体物体. 在这种情况下: 

- **容易的负样本**(如 "狗" 的图片与 "埃菲尔铁塔" 的文本)提供了稳定的基础信号, 确保模型能学会最基本的语义区分. 

- **困难的负样本**(如 "狗" 的图片与 "狼" 的文本, 或 "金毛犬" 的图片与 "拉布拉多犬" 的文本)提供了精细的判别信号, 迫使模型学习更细粒度的语义差异. 

- **梯度方差极小**: 大量负样本的采样使得分母中的归一化项估计非常准确, 梯度方向稳定. 

这就是 CLIP 的原始论文中强调必须使用**超大 batch size**(最初在 256 张 V100 GPU 上训练, 总 batch size 达到 32768)的根本原因. 没有足够的负样本, 对比学习就失去了"对比"的意义. 

#### 4.3.4 归一化与表示几何

在 CLIP 中, 图像和文本的嵌入在计算相似度之前会经过 L2 归一化: 

$$
 z_I = \frac{f_I(x)}{\|f_I(x)\|_2}, \quad z_T = \frac{f_T(y)}{\|f_T(y)\|_2} \tag{17}
$$

这一步在数学上看似简单, 但在几何上具有深刻的意义. 

**归一化后的点积 = 余弦相似度**: 

$$
 z_I^\top z_T = \frac{f_I(x)^\top f_T(y)}{\|f_I(x)\| \|f_T(y)\|} = \cos(\theta) \tag{18}
$$
其中 $\theta$ 是两个向量之间的夹角. 这意味着模型只关心方向的相似性, 而不关心向量的模长. 

**为什么这很重要？**

如果没有归一化, 模型可能会通过简单地**增大所有向量的模长**来人为地提高相似度. 例如, 将 $f_I(x)$ 和 $f_T(y)$ 都乘以 10, 所有相似度都会变成原来的 100 倍, 但语义关系完全没有改变. 归一化消除了这种"作弊"的可能性, 迫使模型真正去学习有意义的**方向对齐**. 

此外, 归一化将所有表示映射到 $d$ 维单位超球面上. 在这个球面上, "相似"的几何意义非常清晰: 相似的样本在球面上聚集成簇, 不相似的样本彼此远离. 这种几何结构不仅优化了目标, 也为下游任务(如最近邻检索)提供了良好的空间结构. 

### 4.4 CLIP 的完整训练架构

#### 4.4.1 图像Encoder : 从 ResNet 到 ViT

CLIP 在图像侧支持两种骨干网络: 

**ResNet 系列**: 包括 ResNet-50、ResNet-101, 以及基于 EfficientNet 思想改进的 RN50x4、RN50x16、RN50x64(通过增加 width 和分辨率来 scaling). 

在 ResNet 变体中, CLIP 做了几个关键的修改: 
- 将最后的全局平均池化层替换为**注意力池化层(Attention Pooling)** . 具体来说, 它增加了一个可学习的查询向量(query token), 对 ResNet 输出的空间特征图做注意力聚合, 输出一个固定维度的全局特征. 
- 使用 **Modified ResNet**, 将 BatchNorm 替换为 GroupNorm, 并在卷积层中使用了 GeLU 激活函数. 

**Vision Transformer (ViT)** : 包括 ViT-B/32、ViT-B/16、ViT-L/14、ViT-L/14@336px 等. 这些变体直接使用标准的 ViT 架构, 将图像切分为固定大小的 patch(如 $16 \times 16$ 像素), 将每个 patch 线性映射为 embedding, 然后输入 Transformer Encoder. 

CLIP 的实验发现, **ViT 变体在大多数任务上优于 ResNet 变体**, 尤其是在大规模数据集上. 这与整个视觉领域从 CNN 向 ViT 迁移的趋势一致. 

#### 4.4.2 文本Encoder : Transformer

CLIP 的文本Encoder 是一个标准的**Transformer Encoder**(与 GPT 的 Decoder-only 架构不同, CLIP 使用双向注意力). 

具体配置: 
- 词表大小约 49,000(基于 Byte Pair Encoding, BPE). 
- 最大序列长度 76 个 token. 
- 模型维度、层数等与图像Encoder 相匹配(例如, ViT-B/32 对应 Transformer 宽度 512, 层数 12). 
- 在序列末尾添加一个 `[EOS]` token, 其最终的隐藏状态被提取作为整个序列的全局文本表示. 

值得注意的是, CLIP 的文本Encoder 不是自回归的. 它不需要逐词生成文本, 只需要将整个文本序列编码成一个固定维度的向量. 这种双向Encoder 的设计, 使得文本表示能够充分融合整个句子的上下文信息. 

#### 4.4.3 投影层与温度参数

图像Encoder 和文本Encoder 输出的原始表示, 可能具有不同的维度分布特性(即使维度数相同). 为了促进跨模态对齐, CLIP 在Encoder 之后添加了**投影层(Projection Layer)** : 

- 图像投影层: $g_I: \mathbb{R}^{d_{\text{enc}}} \to \mathbb{R}^{d_{\text{proj}}}$
- 文本投影层: $g_T: \mathbb{R}^{d_{\text{enc}}} \to \mathbb{R}^{d_{\text{proj}}}$

在 CLIP 原始论文中, 投影层通常是一个**线性变换**(无偏置的矩阵乘法), 将Encoder 输出映射到共享的联合嵌入空间. 

然后, 投影后的向量经过 L2 归一化: 

$$
 z_I = \frac{g_I(f_I(x))}{\|g_I(f_I(x))\|}, \quad z_T = \frac{g_T(f_T(y))}{\|g_T(f_T(y))\|} \tag{19}
$$

最后计算归一化后的点积, 并除以温度参数 $\tau$: 

$$
 \text{logits}_{ij} = \frac{z_I_i^\top z_T_j}{\tau} \tag{20}
$$
这个 logits 矩阵直接输入 softmax 计算交叉熵损失. 

温度参数 $\tau$ 在 CLIP 中是一个**可学习参数**(初始值约为 0.07), 这意味着模型在训练过程中会自动调整"判别难度"的阈值. 

### 4.5 SigLIP 的改进: 从 Softmax 到 Sigmoid

SigLIP 是 CLIP 之后最具影响力的改进之一. 它虽然只改动了损失函数的形式, 但这个改动在理论和工程上都带来了深刻的影响. 

#### 4.5.1 CLIP 的 Softmax 瓶颈

回顾 CLIP 的 InfoNCE 损失(图像到文本方向): 

$$
 \mathcal{L}_{\text{CLIP}} = -\frac{1}{N} \sum_{i=1}^{N} \log \frac{\exp(z_i^\top z_i^+ / \tau)}{\sum_{j=1}^{N} \exp(z_i^\top z_j / \tau)} \tag{21}
$$

这个公式有一个隐含的假设: **batch 中每个图像恰好对应一个正样本文本, 且每个文本恰好对应一个正样本图像**. 这要求: 

1. **对称 batch**: 图像数量和文本数量必须严格相等. 

2. **单对单结构**: 第 $i$ 个图像的正样本必须是第 $i$ 个文本. 

3. **全局归一化**: 分母中的求和覆盖整个 batch, 这在分布式训练中需要跨 GPU 的 all-gather 操作. 

这些限制在大规模训练中带来了工程复杂性: 
- 数据加载器必须保证图像和文本的完美配对和同步. 
- 在模型并行或数据并行训练中, 跨设备的 all-gather 通信可能成为瓶颈. 
- 如果某些样本因过滤或预处理问题被丢弃, batch 的对称性会被破坏. 

#### 4.5.2 SigLIP 的核心改动: 逐对 Sigmoid

SigLIP 提出的替代方案是: 不再将整个 batch 视为一个多分类问题, 而是将每一对 $(i, j)$ 视为一个**独立的二元分类问题**. 

具体地, SigLIP 定义损失为: 

$$
 \mathcal{L}_{\text{SigLIP}} = -\sum_{i,j} \left[ y_{ij} \log \sigma\left(\frac{z_i^\top z_j}{\tau}\right) + (1 - y_{ij}) \log \left(1 - \sigma\left(\frac{z_i^\top z_j}{\tau}\right)\right) \right] \tag{22}
$$

这里 $y_{ij} \in \{0, 1\}$ 是匹配标签, 当第 $i$ 张图片与第 $j$ 段文本确实对应时取 $1$, 否则取 $0$. $\sigma(x) = \frac{1}{1 + \exp(-x)}$ 将相似度映射为 $(0, 1)$ 区间的概率, 可理解为"该图像-文本对匹配的可能性". 与 CLIP 的 softmax 不同, SigLIP 对每一对 $(i, j)$ 独立计算二元交叉熵, 求和遍历所有 $N \times N$ 组合. 这种设计的直接工程收益是: 即使一个 batch 里图像和文本数量不相等, 或者某些样本被过滤掉导致 batch 结构不规则, 损失函数依然能够无缝计算, 无需像 CLIP 那样维护严格的对称结构和全局归一化分母. 

**<u>高亮差异项 1: 从全局 softmax 到逐对 sigmoid</u>**

CLIP 的 softmax 需要在整个 batch 上计算归一化分母 $\sum_j \exp(\cdot)$, 这是一个全局操作. 而 SigLIP 的 sigmoid 是**逐对独立计算**的: 对于每一对 $(i, j)$, 只需要计算 $\sigma(z_i^\top z_j / \tau)$, 不需要知道 batch 中其他样本的信息. 

**<u>高亮差异项 2: 从多分类到二元分类</u>**

CLIP 将每个查询(如一张图片)面对 $N$ 个候选文本的问题视为一个 $N$ 类分类问题. SigLIP 则将每一对 $(i, j)$ 的匹配与否视为一个独立的二分类问题. 这意味着: 

- 正样本的损失项: $-y_{ij} \log \sigma(\cdot)$, 鼓励匹配对的相似度接近 1. 
- 负样本的损失项: $-(1-y_{ij}) \log(1 - \sigma(\cdot))$, 鼓励非匹配对的相似度接近 0. 

#### 4.5.3 为什么 Sigmoid 更适合大规模训练

**优势 1: 无需全局归一化**

Sigmoid 损失不需要跨整个 batch 做 softmax 归一化. 每个 $(i, j)$ 对的损失是独立计算的. 这消除了分布式训练中跨 GPU all-gather 的需求, 极大简化了工程实现. 

**优势 2: 支持非对称 batch**

在 CLIP 中, 如果图像数量 $N_I$ 不等于文本数量 $N_T$, 相似度矩阵 $S$ 变为 $N_I \times N_T$ 的矩形矩阵, softmax 的方向变得不明确. 而在 SigLIP 中, 无论 $N_I$ 和 $N_T$ 是否相等, 我们只需要遍历所有 $N_I \times N_T$ 对组合计算二元损失即可. 这允许更灵活的数据采样策略, 例如当一个 batch 中的文本描述远多于图像时(或反之), SigLIP 仍能无缝处理. 

**优势 3: 对 batch size 的敏感性更低**

在 CLIP 中, batch size 直接决定了"类别数", 因此 batch size 过小(如 $N < 256$)会导致严重的性能下降. SigLIP 中没有"类别数"的概念, 每个样本的损失只依赖于它自身的正负对. 实验表明, SigLIP 在较小的 batch size 下也能稳定训练, 并取得良好效果. 

**优势 4: 假阴性问题的缓解**

在 CLIP 的 softmax 框架中, batch 内所有非对角线元素都被强制标记为负样本. 但实际情况是, 一个 batch 中可能存在语义相关的样本对(例如两张不同的猫的图片, 或 "a dog" 和 "a puppy" 的文本). 这些**假阴性(False Negatives)** 会在 softmax 中受到强烈的"惩罚", 因为模型被迫将它们推向零概率. 而在 SigLIP 中, 虽然假阴性仍然存在问题, 但由于 sigmoid 是独立计算的, 一个假阴性对的梯度不会与其他样本互相干扰, 影响相对更小. 

**数学根源**: Sigmoid 的梯度为 $\sigma(x)(1-\sigma(x))$, 当 $x$ 很大(正样本已经很好区分)时梯度自动衰减. Softmax 的梯度涉及所有类别的竞争, 即使某个负样本是假阴性, 它也会参与分母的竞争, 对其他样本产生影响. 

#### 4.5.4 两种损失的深度对比

| 特性 | CLIP (Softmax + CE) | SigLIP (Sigmoid + BCE) |
|------|---------------------|------------------------|
| 归一化 | 全局 softmax, 跨 batch 归一化 | 逐对 sigmoid, 无需全局归一化 |
| Batch 对称性 | 要求图像数 = 文本数 | 支持非对称 batch |
| 分布式训练 | 需要 all-gather 通信 | 每个 pair 独立计算, 通信更少 |
| Batch size 敏感性 | 高(需要大 batch 提供足够负样本) | 中(对 batch size 相对鲁棒) |
| 假阴性处理 | 假阴性会严重干扰 softmax 归一化 | 影响相对较小, 独立计算 |
| 梯度特性 | 所有负样本通过分母耦合 | 正负样本梯度独立 |
| 温度参数 | 通常可学习 | 通常可学习 |

## 5. 数值走查 (Numerical Example)

数学公式虽然精确, 但有时候具体数字的走查能带给我们最直观的理解. 本节我们用一个极简的 batch($N = 3$)来手动计算 CLIP 的 InfoNCE 损失和 SigLIP 的 sigmoid 损失, 并对比它们的行为差异. 

### 5.1 构造 $N = 3$ 的相似度矩阵

假设我们有 3 对图像-文本样本: 

- $(x_1, y_1)$: 一张猫的图片, 文本为 "a photo of a cat"
- $(x_2, y_2)$: 一张狗的图片, 文本为 "a photo of a dog"
- $(x_3, y_3)$: 一张车的图片, 文本为 "a photo of a car"

经过 L2 归一化后的嵌入向量, 我们假设它们的点积(即余弦相似度)构成的相似度矩阵为: 

$$
 S = \begin{bmatrix} 0.90 & 0.30 & 0.10 \\ 0.25 & 0.85 & 0.15 \\ 0.12 & 0.18 & 0.88 \end{bmatrix} \tag{23}
$$

解读这个矩阵: 
- 对角线 $S_{11} = 0.90$: 猫图与猫文本的相似度很高(正样本, 应该被强化). 
- 非对角线 $S_{12} = 0.30$: 猫图与狗文本有一定相似度(都是动物), 但这是负样本, 应该被压低. 
- $S_{13} = 0.10$: 猫图与车文本的相似度很低(负样本, 容易区分). 
- 温度参数设为 $\tau = 0.07$(CLIP 的典型值). 

### 5.2 手动计算 CLIP 的 InfoNCE Loss

#### 5.2.1 图像到文本方向 $\mathcal{L}_{I \to T}$

首先计算温度缩放后的 logits: $L_{ij} = S_{ij} / \tau = S_{ij} / 0.07$

$$
 L = \begin{bmatrix} 12.857 & 4.286 & 1.429 \\ 3.571 & 12.143 & 2.143 \\ 1.714 & 2.571 & 12.571 \end{bmatrix} \tag{24}
$$
**第 1 个样本(猫图)** : 

Softmax 分母: $\exp(12.857) + \exp(4.286) + \exp(1.429)$

计算各项(保留主要有效数字): 
- $\exp(12.857) \approx 3.84 \times 10^5$
- $\exp(4.286) \approx 72.7$
- $\exp(1.429) \approx 4.17$

分母 $\approx 3.84 \times 10^5 + 72.7 + 4.17 \approx 384076.9$

正样本概率: $P_{11} = \frac{3.84 \times 10^5}{384076.9} \approx 0.99980$

损失贡献: $-\log(0.99980) \approx 0.00020$

**第 2 个样本(狗图)** : 

- $\exp(3.571) \approx 35.6$
- $\exp(12.143) \approx 1.87 \times 10^5$
- $\exp(2.143) \approx 8.53$

分母 $\approx 187035.1$

正样本概率: $P_{22} = \frac{1.87 \times 10^5}{187035.1} \approx 0.99981$

损失贡献: $-\log(0.99981) \approx 0.00019$

**第 3 个样本(车图)** : 

- $\exp(1.714) \approx 5.55$
- $\exp(2.571) \approx 13.08$
- $\exp(12.571) \approx 2.89 \times 10^5$

分母 $\approx 289018.6$

正样本概率: $P_{33} = \frac{2.89 \times 10^5}{289018.6} \approx 0.99994$

损失贡献: $-\log(0.99994) \approx 0.00006$

汇总三个样本的图像到文本损失, 取平均得到该方向的总损失: 

$$
 \mathcal{L}_{I \to T} = \frac{1}{3}(0.00020 + 0.00019 + 0.00006) \approx 0.00015 \tag{25}
$$

图像到文本方向的损失是三个正样本对数概率的负平均. 由于正样本的相似度远高于负样本, softmax 几乎将概率质量全部分配给对角线, 损失值非常小, 说明模型在此批次上已能很好区分正负样本. 

#### 5.2.2 文本到图像方向 $\mathcal{L}_{T \to I}$

这与图像到文本方向在数学上完全对称(因为我们使用了相同的相似度矩阵, 只是转置后相同). 因此: 

$$
 \mathcal{L}_{T \to I} = \mathcal{L}_{I \to T} \approx 0.00015 \tag{26}
$$
此式描述了变量之间的定量关系, 其物理意义将在下文详细阐述. 
#### 5.2.3 CLIP 总损失

将图像到文本和文本到图像两个方向的损失取平均, 得到完整的 CLIP 训练目标: 

$$
 \mathcal{L}_{\text{CLIP}} = \frac{1}{2}(\mathcal{L}_{I \to T} + \mathcal{L}_{T \to I}) = 0.00015 \tag{27}
$$

**观察**: 这个损失值非常小. 为什么？因为在这个构造的矩阵中, 对角线元素(正样本)远大于非对角线元素(负样本), softmax 几乎将所有概率质量都分配给了正样本. 这说明模型已经能很好地区分这些样本了. 但如果存在某个非对角线元素接近对角线(例如 $S_{12} = 0.80$ 而 $S_{11} = 0.90$), softmax 的概率分配会变得更有挑战性, 损失也会更大. 

### 5.3 手动计算 SigLIP 的 Sigmoid Loss

SigLIP 使用逐对的二元交叉熵. 标签矩阵为: 

$$
 Y = \begin{bmatrix} 1 & 0 & 0 \\ 0 & 1 & 0 \\ 0 & 0 & 1 \end{bmatrix} \tag{28}
$$
温度缩放后的相似度仍为 $L_{ij} = S_{ij} / \tau$. 

Sigmoid 函数定义为 $\sigma(x) = \frac{1}{1 + \exp(-x)}$. 

逐对计算损失 $-y_{ij} \log \sigma(L_{ij}) - (1-y_{ij}) \log(1 - \sigma(L_{ij}))$: 

**对角线(正样本, $y_{ij} = 1$)** : 

| 对 | $L_{ij}$ | $\sigma(L_{ij})$ | $-\log \sigma(\cdot)$ |
|----|----------|------------------|----------------------|
| $(1,1)$ | 12.857 | $\approx 0.999997$ | $\approx 0.000003$ |
| $(2,2)$ | 12.143 | $\approx 0.999995$ | $\approx 0.000005$ |
| $(3,3)$ | 12.571 | $\approx 0.999996$ | $\approx 0.000004$ |

**非对角线(负样本, $y_{ij} = 0$)** : 

| 对 | $L_{ij}$ | $\sigma(L_{ij})$ | $-\log(1 - \sigma(\cdot))$ |
|----|----------|------------------|---------------------------|
| $(1,2)$ | 4.286 | $\approx 0.986$ | $-\log(0.014) \approx 4.27$ |
| $(1,3)$ | 1.429 | $\approx 0.807$ | $-\log(0.193) \approx 1.65$ |
| $(2,1)$ | 3.571 | $\approx 0.973$ | $-\log(0.027) \approx 3.61$ |
| $(2,3)$ | 2.143 | $\approx 0.895$ | $-\log(0.105) \approx 2.25$ |
| $(3,1)$ | 1.714 | $\approx 0.848$ | $-\log(0.152) \approx 1.88$ |
| $(3,2)$ | 2.571 | $\approx 0.929$ | $-\log(0.071) \approx 2.65$ |

将所有损失项相加: 

$$
 \mathcal{L}_{\text{SigLIP}} = (0.000003 + 0.000005 + 0.000004) + (4.27 + 1.65 + 3.61 + 2.25 + 1.88 + 2.65) \tag{29}
$$

SigLIP 的损失由两部分组成: 正样本对的 sigmoid 损失(极小)和负样本对的 sigmoid 损失(主导). 其中第一括号是三个正样本项, 第二括号是六个负样本项, 负样本贡献了绝大部分损失值. 

$$
 \mathcal{L}_{\text{SigLIP}} \approx 0.000012 + 16.31 \approx 16.31 \tag{30}
$$

与 CLIP 的损失值($0.00015$)相比, SigLIP 的总损失明显更大, 这是因为它独立惩罚了所有 $N^2$ 个样本对, 而非像 softmax 那样将概率质量几乎全部推给对角线后使损失趋近于零. 在工程实践中, 这种"密集梯度"意味着即使 batch size 较小, 每个训练 step 仍有充足的对比信号驱动模型学习细粒度区分, 从而降低了对超大 batch 的依赖. 

### 5.4 两种损失的对比分析

| 指标 | CLIP (InfoNCE) | SigLIP (Sigmoid) |
|------|----------------|------------------|
| 总损失值 | $\approx 0.00015$ | $\approx 16.31$ |
| 损失来源 | 主要来自对角线 softmax 概率 | 来自所有 $N^2$ 对的二元分类 |
| 归一化方式 | 每行 softmax | 无全局归一化 |
| 负样本权重 | 通过分母竞争自动分配 | 每个负样本独立计算 |

**关键洞察 1**: CLIP 的损失值非常小(接近 0), 因为 softmax 已经将对角线概率推到了接近 1. SigLIP 的损失值很大, 因为它累加了所有 $N^2 = 9$ 个二元分类的损失, 而且负样本的损失并不小. 

**关键洞察 2**: 在 CLIP 中, 一个"容易"的负样本(如 $S_{13} = 0.10$)对 softmax 分母的贡献很小($\exp(1.429) \approx 4.17$), 因此它几乎不影响训练. 但在 SigLIP 中, 这个负样本仍然有独立的损失项 $-\log(1 - \sigma(1.429)) \approx 1.65$, 模型仍然会被明确地"提醒": 这对是不匹配的. 

**关键洞察 3**: SigLIP 的梯度更"密集"——每个 batch 中有 $N^2$ 个独立的梯度信号, 而 CLIP 只有 $2N$ 个(每行/列一个 softmax). 这使得 SigLIP 在每个 step 中利用了更多的对比信号, 这在某种程度上补偿了它对 batch size 的较低敏感性. 

**关键洞察 4**: 如果我们引入一个假阴性——假设 $(x_1, y_2)$ 实际上是匹配的(都是关于宠物的), 但被错误标记为负样本——在 CLIP 中, 由于 $S_{12} = 0.30$ 在 softmax 分母中是一个相对较大的竞争者($\exp(4.286) \approx 72.7$), 它会严重干扰 $x_1$ 的 softmax 归一化, 导致 $P_{11}$ 无法进一步接近 1. 而在 SigLIP 中, 虽然 $(1,2)$ 仍然会受到负样本损失的影响, 但它不会"拖累" $(1,1)$ 和 $(1,3)$ 的学习. 

![CLIP 的 Softmax 概率与 SigLIP 的 Sigmoid 相似度响应矩阵对比](images/clip_vs_siglip_matrix.png)

> **图 1.3 CLIP 与 SigLIP 输出激活特性对比**
> * **CLIP(左侧, Softmax 归一化)**：由于 Softmax 执行全局分母归一化竞争, 对角线概率被极致推高(趋近 1.0), 而非对角线被极致压低(趋近 0.0). 负样本通过分母高度耦合, 使得模型对假阴性非常敏感且高度依赖巨大的 Batch Size. 
> * **SigLIP(右侧, Sigmoid 独立二分类)**：由于每个 pair $(i, j)$ 是完全解耦的二元交叉熵损失, 对角线输出相似度大, 而非对角线可以在 0.1-0.3 等合理区间内柔和分布, 不受 Softmax 竞争牵连. 这大幅缓解了假阴性带来的惩罚冲突, 并消除了分布式训练中的全局 all-gather 通信开销. 


## 6. 简化实现 (PyTorch Code)

理论推导终究要落地为可运行的代码. 本节提供一个约 100 行的简化 PyTorch 实现, 涵盖 CLIP 风格的对比损失、SigLIP 损失, 以及图像/文本Encoder 的骨架. 

```python
import torch
import torch.nn as nn
import torch.nn.functional as F
import math


class ImageEncoder(nn.Module):
    """
    简化的图像Encoder 骨架(基于 ViT 风格)
    对应论文中的 f_I: 图像 -> d维向量
    """
    def __init__(self, img_size=224, patch_size=16, in_chans=3, embed_dim=512, depth=6):
        super().__init__()
        self.patch_embed = nn.Conv2d(in_chans, embed_dim, kernel_size=patch_size, stride=patch_size)
        # 可学习的 CLS token, 用于聚合全局图像表示
        self.cls_token = nn.Parameter(torch.zeros(1, 1, embed_dim))
        num_patches = (img_size // patch_size) ** 2
        self.pos_embed = nn.Parameter(torch.zeros(1, num_patches + 1, embed_dim))
        self.blocks = nn.ModuleList([
            nn.TransformerEncoderLayer(d_model=embed_dim, nhead=8, dim_feedforward=embed_dim*4, batch_first=True)
            for _ in range(depth)
        ])
        self.norm = nn.LayerNorm(embed_dim)
        
    def forward(self, x):
        # x: (B, 3, H, W)
        B = x.shape[0]
        # 切分 patch 并映射: (B, num_patches, embed_dim)
        x = self.patch_embed(x).flatten(2).transpose(1, 2)
        # 拼接 CLS token: (B, num_patches+1, embed_dim)
        cls_tokens = self.cls_token.expand(B, -1, -1)
        x = torch.cat([cls_tokens, x], dim=1)
        x = x + self.pos_embed
        # 通过 Transformer blocks
        for block in self.blocks:
            x = block(x)
        x = self.norm(x)
        # 提取 CLS token 作为全局图像表示: (B, embed_dim)
        return x[:, 0]


class TextEncoder(nn.Module):
    """
    简化的文本Encoder 骨架(基于 Transformer Encoder)
    对应论文中的 f_T: 文本 -> d维向量
    """
    def __init__(self, vocab_size=49408, embed_dim=512, depth=6, max_length=77):
        super().__init__()
        self.token_embedding = nn.Embedding(vocab_size, embed_dim)
        self.pos_embedding = nn.Parameter(torch.zeros(1, max_length, embed_dim))
        self.blocks = nn.ModuleList([
            nn.TransformerEncoderLayer(d_model=embed_dim, nhead=8, dim_feedforward=embed_dim*4, batch_first=True)
            for _ in range(depth)
        ])
        self.norm = nn.LayerNorm(embed_dim)
        
    def forward(self, text_tokens):
        # text_tokens: (B, seq_len)
        x = self.token_embedding(text_tokens)
        x = x + self.pos_embedding[:, :x.size(1), :]
        for block in self.blocks:
            x = block(x)
        x = self.norm(x)
        # 提取序列最后一个位置(或 EOS 位置)的表示
        # 这里简化处理, 取 mean pooling
        return x.mean(dim=1)


class CLIPLoss(nn.Module):
    """
    CLIP 风格的对比损失 (InfoNCE)
    对应数学公式: L_CLIP = 0.5 * (L_{I->T} + L_{T->I})
    """
    def __init__(self, temperature=0.07, learnable_temp=True):
        super().__init__()
        if learnable_temp:
            # 可学习的温度参数, 如原始 CLIP 论文
            self.logit_scale = nn.Parameter(torch.ones([]) * math.log(1.0 / temperature))
        else:
            self.register_buffer('logit_scale', torch.ones([]) * math.log(1.0 / temperature))
    
    def forward(self, image_features, text_features):
        """
        image_features: (N, d), 已 L2 归一化
        text_features: (N, d), 已 L2 归一化
        """
        N = image_features.shape[0]
        # 计算相似度矩阵: S_{ij} = f_I(x_i)^T f_T(y_j)
        # 对应公式 4.3 节中的 S = I * T^T
        logits_per_image = image_features @ text_features.t()
        logits_per_text = logits_per_image.t()
        
        # 应用温度缩放: logit_scale = 1 / tau
        logit_scale = self.logit_scale.exp().clamp(max=100)
        logits_per_image = logits_per_image * logit_scale
        logits_per_text = logits_per_text * logit_scale
        
        # 标签: 对角线为正样本, label = [0, 1, 2, ..., N-1]
        labels = torch.arange(N, device=image_features.device)
        
        # 图像到文本方向的交叉熵
        # 对应公式: L_{I->T} = -1/N * sum_i log(softmax(S_{i,:})_i)
        loss_i2t = F.cross_entropy(logits_per_image, labels)
        
        # 文本到图像方向的交叉熵
        # 对应公式: L_{T->I} = -1/N * sum_i log(softmax(S_{:,i})_i)
        loss_t2i = F.cross_entropy(logits_per_text, labels)
        
        # 对称损失
        # 对应公式: L_CLIP = 0.5 * (L_{I->T} + L_{T->I})
        loss = (loss_i2t + loss_t2i) / 2
        return loss


class SigLIPLoss(nn.Module):
    """
    SigLIP 风格的 sigmoid 二元交叉熵损失
    对应数学公式: L_SigLIP = -sum_{i,j} [y_{ij} log sigma(z_i^T z_j/tau) + (1-y_{ij}) log(1-sigma(...))]
    """
    def __init__(self, temperature=0.07, learnable_temp=True):
        super().__init__()
        if learnable_temp:
            self.logit_scale = nn.Parameter(torch.ones([]) * math.log(1.0 / temperature))
        else:
            self.register_buffer('logit_scale', torch.ones([]) * math.log(1.0 / temperature))
    
    def forward(self, image_features, text_features):
        """
        image_features: (N_I, d), 已 L2 归一化
        text_features: (N_T, d), 已 L2 归一化
        注意: SigLIP 支持 N_I != N_T
        """
        N_I = image_features.shape[0]
        N_T = text_features.shape[0]
        
        # 计算所有 pair 的相似度: (N_I, N_T)
        logits = image_features @ text_features.t()
        
        # 温度缩放
        logit_scale = self.logit_scale.exp().clamp(max=100)
        logits = logits * logit_scale
        
        # 构造标签矩阵: 对角线为 1(如果 N_I == N_T), 否则需要根据实际配对构造
        # 这里假设 N_I == N_T 且第 i 个图像对应第 i 个文本
        labels = torch.eye(N_I, N_T, device=image_features.device)
        
        # 二元交叉熵(逐元素)
        # F.binary_cross_entropy_with_logits 等价于 sigmoid + BCE, 但数值更稳定
        # 对应公式 4.5 节中的逐对 sigmoid 损失
        loss = F.binary_cross_entropy_with_logits(logits, labels, reduction='sum')
        
        # 归一化: 平均到每个 pair
        loss = loss / (N_I * N_T)
        return loss


class CLIPModel(nn.Module):
    """
    完整的 CLIP 风格模型骨架
    """
    def __init__(self, embed_dim=512, projection_dim=512):
        super().__init__()
        self.image_encoder = ImageEncoder(embed_dim=embed_dim)
        self.text_encoder = TextEncoder(embed_dim=embed_dim)
        
        # 投影层: 将Encoder 输出映射到联合嵌入空间
        # 对应 4.4.3 节的 g_I 和 g_T
        self.image_projection = nn.Linear(embed_dim, projection_dim, bias=False)
        self.text_projection = nn.Linear(embed_dim, projection_dim, bias=False)
        
    def encode_image(self, images):
        x = self.image_encoder(images)
        x = self.image_projection(x)
        # L2 归一化, 使得点积等价于余弦相似度
        return F.normalize(x, dim=-1)
    
    def encode_text(self, text_tokens):
        x = self.text_encoder(text_tokens)
        x = self.text_projection(x)
        return F.normalize(x, dim=-1)
    
    def forward(self, images, text_tokens):
        image_features = self.encode_image(images)
        text_features = self.encode_text(text_tokens)
        return image_features, text_features


# ============ 使用示例 ============
if __name__ == "__main__":
    device = "cuda" if torch.cuda.is_available() else "cpu"
    
    # 初始化模型
    model = CLIPModel(embed_dim=512, projection_dim=512).to(device)
    clip_loss = CLIPLoss(temperature=0.07).to(device)
    siglip_loss = SigLIPLoss(temperature=0.07).to(device)
    
    # 构造虚拟数据: batch_size = 4
    batch_size = 4
    dummy_images = torch.randn(batch_size, 3, 224, 224).to(device)
    dummy_texts = torch.randint(0, 49408, (batch_size, 32)).to(device)  # 随机 token
    
    # 前向传播
    img_feats, txt_feats = model(dummy_images, dummy_texts)
    
    # 计算 CLIP 损失
    loss_clip = clip_loss(img_feats, txt_feats)
    print(f"CLIP Loss: {loss_clip.item():.4f}")
    
    # 计算 SigLIP 损失
    loss_siglip = siglip_loss(img_feats, txt_feats)
    print(f"SigLIP Loss: {loss_siglip.item():.4f}")
```

### 代码注释与公式对照

| 代码段 | 对应公式 | 说明 |
|--------|----------|------|
| `ImageEncoder` + `TextEncoder` | $f_I, f_T$ | 两个模态的Encoder 骨架 |
| `self.image_projection` / `text_projection` | $g_I, g_T$ | 将Encoder 输出映射到联合嵌入空间 |
| `F.normalize(x, dim=-1)` | $z = g / \|g\|$ | L2 归一化, 点积等价于余弦相似度 |
| `image_features @ text_features.t()` | $S = I \cdot T^\top$ | 相似度矩阵计算 |
| `F.cross_entropy(logits_per_image, labels)` | $\mathcal{L}_{I \to T}$ | 图像到文本方向的 softmax + CE |
| `F.binary_cross_entropy_with_logits(logits, labels)` | $\mathcal{L}_{\text{SigLIP}}$ | 逐对 sigmoid + BCE |
| `self.logit_scale` | $1/\tau$ | 可学习的温度参数 |

![CLIP 双塔多模态对齐网络架构示意图](images/clip_architecture_pipeline.png)

> **图 1.4 CLIP 统一语义对齐网络架构流程**
> * **图像编码分支(左侧)**：原始图像输入通过 **Image Encoder(如 ViT 或 CNN)** 提取高维空间特征, 然后经由 **Projection(线性投影)** 层映射到共享维度, 最后进行 L2 归一化得到单位球面的视觉向量 $z_I$. 
> * **文本编码分支(右侧)**：原始文本输入通过 **Text Encoder(Transformer)** 提取全局语义, 再经过相同的投影与归一化流程, 生成对应的文本向量 $z_T$. 
> * **联合嵌入空间(Joint Embedding Space, 中心)**：归一化后的异构特征 $z_I, z_T$ 汇聚于此, 使用简单的点积(余弦相似度)计算相互之间的相似度矩阵, 并通过温度参数 $\tau$ 缩放后进入损失函数计算, 完成端到端参数对齐. 


## 7. 局限性与边界条件 (Limitations & Boundary Conditions)

CLIP 和对比学习虽然在多模态领域取得了革命性的突破, 但世界上不存在包治百病的算法. 深入理解它们的局限性和失效边界, 是工程实践中避免踩坑的关键. 

### 7.1 负样本质量: 假阴性的幽灵

对比学习的核心假设是: **batch 中的非对角线元素都是负样本**. 但这个假设在真实数据中几乎总是不成立的. 

想象一个 batch 中有以下样本: 

- $x_1$: 一张金毛犬在草地上的照片, 文本 $y_1$ = "a golden retriever playing in the park"
- $x_2$: 一只拉布拉多犬在海滩上的照片, 文本 $y_2$ = "a labrador running on the beach"
- $x_3$: 一只小猫在沙发上的照片, 文本 $y_3$ = "a cute kitten sleeping on the sofa"

在 CLIP 的训练中, $(x_1, y_2)$ 被标记为负样本. 但从语义上看, $x_1$ 和 $y_2$ 都是关于狗的——它们共享了大量高层语义(动物、犬科、宠物、四足、毛茸茸). 强迫模型将它们的相似度压低到接近 0, 实际上是在要求模型**忽略真实的语义关联**. 这种在训练中被错误标记为负样本、但实际上语义相关的配对, 被称为**假阴性(False Negatives)** . 

假阴性的影响在数学上表现为: 

- 在 CLIP 的 softmax 框架中, 假阴性会参与分母的竞争. 如果 $S_{12}$(狗图与狗文本的相似度)被迫压低, 而 $S_{13}$(狗图与猫文本的相似度)也很低, 那么 softmax 的分母主要由 $S_{11}$ 和 $S_{12}$ 决定. 模型可能会在优化过程中产生矛盾的梯度信号. 
- 在 SigLIP 中, 虽然假阴性仍然会带来独立的负样本损失, 但由于 sigmoid 的逐对独立性, 它不会像 CLIP 那样通过 softmax 分母"拖累"正样本的学习. 

**物理根因**: 对比学习的监督信号本质上是一种"相对关系"(谁比谁更近), 而不是"绝对语义"(这个东西是什么). 当 batch 内的语义分布不均匀时(例如某个 batch 碰巧全是狗的照片), 负样本的质量会急剧下降. 

**缓解策略**: 
1. **更大的 batch size**: 从统计上降低 batch 内语义重复的概率. 

2. **去重和语义过滤**: 在数据预处理阶段, 通过文本或图像特征去除过于相似的样本. 

3. **使用更细粒度的标签**: 如果能获得样本间的部分层次标签(如 "狗" 是 "动物" 的子类), 可以设计层次化的对比损失. 

4. **无负样本的替代方法**: 如 DINO 等自蒸馏方法, 虽然不在本文讨论范围内, 但它们为无负样本的视觉表示学习提供了另一条路径. 

### 7.2 数据偏见: 训练集即世界观

CLIP 的训练数据来自互联网上的图像-文本对. 互联网不是中立的——它反映了特定文化、特定地区、特定人群在特定历史时期的偏见和倾向. 这些偏见会被编码进 CLIP 的表示空间中. 

例如: 

- **职业偏见**: 当查询 "doctor" 时, CLIP 检索出的图片中男性面孔的比例远高于女性, 即使现实中女性医生的比例并不低. 这是因为训练数据中 "doctor" 配文的图片本身就存在性别偏向. 

- **地域偏见**: "wedding" 这个概念在 CLIP 的表示中可能更倾向于西方婚礼(白色婚纱、教堂), 而对其他文化中的婚礼形式(如中式红色礼服、印度传统婚礼)的表征较弱. 

- **种族与肤色偏见**: 多项独立审计研究表明, CLIP 在处理涉及肤色、种族的查询时, 表现出与训练数据分布一致的系统性偏差. 

**数学根源**: 对比学习的目标是让"匹配的"图像-文本对在表示空间中更近. 但"匹配"的定义来自数据本身. 如果数据中的"匹配"关系已经包含了社会的刻板印象, 模型没有理由、也没有机制去纠正这些印象. CLIP 不是在"理解"世界, 而是在"复现"训练数据中的统计关联. 

**工程影响**: 在将 CLIP 用于下游产品(如搜索引擎、推荐系统、内容审核)时, 这些偏见会被直接放大和传播. 例如, 一个基于 CLIP 的图像搜索系统, 可能在用户搜索 "CEO" 时返回大量男性照片, 从而加剧性别刻板印象. 

**缓解策略**: 
1. **数据平衡与去偏**: 在数据收集阶段, 有意识地增加代表性不足群体的样本比例. 

2. **事后干预**: 在表示空间中对特定维度进行投影去除(Projection-based Debiasing). 

3. **透明与评估**: 发布模型时附带偏见评估报告(如 CLIP 原始论文所做的), 让用户了解模型的局限性. 

### 7.3 细粒度理解弱: 从整体语义到局部细节

CLIP 的另一个根本性局限在于它的**判别粒度**. CLIP 被训练来匹配"整张图片"与"整段文本", 它的损失函数只关心全局语义是否对齐, 而完全不关心局部对应关系. 

这意味着 CLIP 擅长回答: 
- "这张图是不是关于猫的？" ✓
- "这张图和'一只橘猫在草地上'这句话是否匹配？" ✓

但 CLIP 很不擅长回答: 
- "猫在图片的哪个位置？" ✗
- "图片中有几只猫？" ✗
- "这只猫的左耳上有没有一个缺口？" ✗

**物理根源**: CLIP 的图像Encoder (无论是 ResNet 还是 ViT)最终输出的是一个**全局向量**(global vector). 虽然 ViT 的中间层保留了 patch 级别的信息, 但 CLIP 的训练目标从未要求模型去学习"词与区域的对应". 文本端同样如此——最终的文本表示是一个全局句子向量, 没有显式地与图像的空间位置建立联系. 

这种"全局对全局"的匹配方式, 导致 CLIP 在以下任务上表现不佳: 
- **目标检测(Object Detection)** : 需要定位物体的边界框. 

- **实例分割(Instance Segmentation)** : 需要像素级的物体轮廓. 

- **细粒度属性识别**: 例如区分 "一只成年金毛犬" 和 "一只幼年金毛犬". 

- **视觉问答(VQA)** : 当问题涉及空间关系("左边的那个人手里拿着什么？")时, CLIP 几乎无法回答. 

**缓解策略与演进方向**: 
1. **引入局部特征**: 如 ViT 的 patch token 可以作为局部特征, 后续通过注意力机制与文本 token 交互. 

2. ** grounding 预训练**: 如 GLIP、Grounding DINO 等工作, 在预训练阶段引入 phrase-region 对齐目标. 

3. **与定位模型结合**: 如 SAM(Segment Anything Model)提供通用的图像分割能力, 与 CLIP 的语义能力互补. 

4. **稠密预测**: 如 CLIP-DINOv2 的混合方法, 结合 CLIP 的语义表示与 DINOv2 的局部特征. 

### 7.4 分辨率限制: 小图的诅咒

CLIP 的视觉Encoder 通常在较低分辨率下预训练. 例如: 
- CLIP 的 ViT-B/32 和 ViT-B/16 变体在 $224 \times 224$ 分辨率下训练. 
- 即使是 ViT-L/14@336px, 分辨率也只有 $336 \times 336$. 

在 2024-2026 年的视觉任务中, 输入图像的分辨率往往远高于这个数值(例如 $1024 \times 1024$ 甚至更高). 当 CLIP 被用作 VLM 的视觉Encoder 时, 输入图像通常需要被 resize 或 crop 到预训练分辨率, 这会导致**信息丢失**. 

具体来说: 
- 小物体(如远处的行人、图片角落的文字)在 resize 后可能只剩下几个像素, 视觉Encoder 几乎无法提取有效特征. 
- 细粒度的纹理和结构(如皮肤毛孔、织物纹理)在高分辨率下可见, 但在低分辨率输入下被模糊掉. 
- 长宽比差异大的图像(如长条形截图、全景图)在强制 resize 为正方形时会严重变形. 

**数学根源**: ViT 的 patch size 是固定的(如 $14 \times 14$ 像素). 在 $224 \times 224$ 分辨率下, 一张图片被切分为 $(224/14)^2 = 256$ 个 patch. 如果原始图像是 $1024 \times 1024$, resize 到 $224 \times 224$ 意味着每个 patch 对应的原始区域约为 $57 \times 57$ 像素——大量的细节被压缩进了单个 patch 中, Transformer 的自注意力机制难以恢复这些丢失的信息. 

**缓解策略**: 
1. **高分辨率微调**: 在预训练后, 使用更高分辨率的图像对Encoder 进行微调. 

2. **任意分辨率处理**: 如 NaViT(Native Resolution ViT)和 CLIP 的后续改进版本, 支持在训练和推理阶段处理任意分辨率和长宽比的图像. 

3. **多尺度特征融合**: 将不同分辨率的图像分别编码, 然后融合多尺度特征. 

4. **切片与全局结合**: 将高分辨率图像切成多个 patch 分别编码, 同时保留全局缩略图的编码, 通过注意力机制融合. 

## 8. 演进与承上启下 (Evolution & Segue)

### 8.1 CLIP 作为 VLM 的视觉 backbone

CLIP 最重要的"遗产", 是它为**视觉语言模型(Vision-Language Model, VLM)** 提供了一个即插即用的视觉Encoder . 

典型的 VLM 架构如下: 

```
图像输入 -> [CLIP 视觉Encoder ] -> 视觉特征序列
                                            |
                                            v
文本输入 -> [Tokenizer] -> [LLM] <-----> [Projection/Adapter]
                                            |
                                            v
                                      文本输出
```

在这个架构中: 
1. CLIP(或其改进版如 SigLIP)将输入图像编码为一系列视觉 token(例如 ViT 的 patch embeddings). 
2. 通过一个可学习的 projection 层(如简单的线性层, 或更复杂的 MLP/Transformer adapter), 将视觉特征映射到语言模型的 embedding 空间. 
3. 语言模型(如 LLaMA、Qwen、DeepSeek)接收拼接后的 "视觉 token + 文本 token", 进行自回归生成. 

CLIP 在这个架构中的角色是**"眼睛"**——它负责将原始像素转化为语义丰富的向量表示, 供语言模型"阅读". 没有 CLIP, VLM 就需要从头训练视觉模块, 这在数据和算力上都是极其昂贵的. 

### 8.2 从 CLIP 到 SigLIP: 训练范式的工程演进

SigLIP 不是唯一一个改进 CLIP 的工作. 在 2022-2024 年间, 研究界围绕对比学习的损失函数和数据效率展开了密集的创新: 

- **LiT(Locked-image Tuning)** : 固定预训练好的图像Encoder (如 ViT), 只训练文本Encoder . 实验证明, 当图像Encoder 已经在大量数据上训练得很好时, 锁定它并只优化文本端, 可以在更小的数据量和更短的训练时间内取得优异效果. 

- **FLAVA**: 一个更加通用的多模态预训练框架, 除了对比学习外, 还引入了 masked modeling 等预训练目标, 试图统一单模态和多模态表示学习. 

- **OpenCLIP**: 一个开源的 CLIP 复现项目, 通过公开的数据集(如 LAION-5B)训练出了与 OpenAI 原版 CLIP 效果相当的模型, 并探索了不同架构、不同数据规模下的 scaling 规律. 

- **SigLIP 2**: 在原始 SigLIP 的基础上进一步改进, 引入了更丰富的训练目标(如基于定位的预训练)和更大的模型规模, 成为 2025-2026 年 Google 多模态模型的默认视觉Encoder . 

这些演进的核心趋势是: 
1. **损失函数从 softmax 向 sigmoid 转移**: 工程效率的胜利. 

2. **训练数据从 curated 向 raw web data 扩展**: 规模效应的持续验证. 

3. **模型架构从单一Encoder 向Encoder +adapter 演进**: 更灵活的 VLM 集成. 

### 8.3 自监督视觉表示的新范式: DINOv2 与 EVA-CLIP

CLIP 虽然是视觉-语言预训练的标杆, 但它不是学习视觉表示的唯一路径. 在纯视觉领域(不依赖文本监督), **自监督学习(Self-Supervised Learning)** 也取得了惊人的进展. 

**DINOv2(Meta, 2023)** : 
- 不使用任何文本标注, 仅通过图像自身的视觉一致性来训练 ViT. 
- 采用自蒸馏(self-distillation)框架: 一个学生网络预测教师网络的输出, 教师通过学生参数的指数移动平均(EMA)更新. 
- DINOv2 学到的视觉特征在密集预测任务(分割、深度估计)上表现优异, 弥补了 CLIP 在局部特征上的不足. 
- 实际工程中, 很多 VLM 会同时融合 CLIP 的语义特征和 DINOv2 的空间特征, 以达到"既看得懂语义, 又看得清细节"的效果. 

**EVA-CLIP(BAAI, 2023)** : 
- 发现将视觉Encoder 用纯视觉自监督(如 MAE, Masked Autoencoder)预训练初始化, 再用对比学习微调, 可以取得比从零开始训练 CLIP 更好的效果. 
- 这验证了"视觉表示的预训练可以利用自监督, 跨模态对齐可以用对比学习"的分阶段策略. 

### 8.4 视觉Encoder 的 Scaling Law

大模型领域的一个核心发现是 **Scaling Law**——模型性能随模型规模、数据规模、计算量的增加而呈现可预测的幂律提升. CLIP 和后续的视觉Encoder 研究也验证了这一定律在视觉领域的适用性. 

具体来说: 
- **模型规模**: 从 CLIP 的 ViT-B(约 86M 参数)到 EVA-02-CLIP(约 1B 参数), 再到更大的模型, Zero-Shot 分类和跨模态检索的性能持续提升. 

- **数据规模**: 从 CLIP 的 4 亿对到 LAION-5B 的 50 亿对, 再到更大的内部数据集, 性能随数据量对数增长. 

- **计算规模**: 训练更大的模型需要更多的 GPU 小时, 但性能的提升是可预测的. 

然而, 视觉Encoder 的 Scaling 也面临着与语言模型类似的挑战: 
- **数据质量瓶颈**: 互联网数据中存在大量噪声(无关的图片-文本对、低质量图像、无意义文本), 单纯增加数据量可能会引入更多噪声. 

- **分辨率 Scaling**: 更高分辨率意味着更长的序列长度(更多的 patch token), 计算量呈平方级增长. 

- **多模态对齐的饱和**: 当模型已经足够大时, 进一步提升纯视觉Encoder 的能力, 对 VLM 整体能力的边际贡献可能会递减. 

**未来的未解之谜**: 
1. 视觉Encoder 是否需要一个与 LLM 统一的架构(如原生多模态 Transformer), 还是保持分离的Encoder +adapter 模式更优？
2. 当视觉Encoder 的分辨率和上下文窗口持续扩大, 传统的 patch-based ViT 是否是最佳选择, 还是像 Mamba、RWKV 这样的线性复杂度架构会取而代之？
3. 视觉表示学习能否完全摆脱对比学习, 仅靠生成式目标(如自回归图像建模)达到同等甚至更好的效果？

这些问题的探索, 将定义 2026 年之后多模态 AI 的发展方向. 

## 9. 总结与参考文献 (References)

### 核心要点总结

1. **对比学习打破了视觉理解的标注瓶颈**: CLIP 通过在海量互联网图像-文本对上进行对比学习, 实现了无需逐像素标注的开放词汇视觉理解, 彻底颠覆了传统 ImageNet 分类范式. 

2. **InfoNCE 是理论基石**: 从互信息下界出发, InfoNCE 将视觉-语言对齐转化为一个 batch 内的多分类问题. 温度参数 $\tau$ 控制着判别难度, 对称损失确保了双模态的平等学习. 

3. **相似度矩阵揭示了几何本质**: $N \times N$ 的相似度矩阵中, 对角线为正样本、非对角线为负样本. 有效 batch size 直接决定了负样本的丰富度和梯度的稳定性. 

4. **SigLIP 的工程突破**: 将 softmax + cross-entropy 替换为 sigmoid + binary cross-entropy, 消除了全局归一化的依赖, 支持非对称 batch, 对假阴性更鲁棒, 已成为 2024-2026 年 VLM 的主流选择. 

5. **局限催生演进**: 假阴性、数据偏见、细粒度理解弱、分辨率限制等问题, 推动了从 CLIP 到 SigLIP、从全局特征到局部特征、从低分辨率到任意分辨率的持续演进. 

### 参考文献

- Radford, A., Kim, J. W., Hallacy, C., Ramesh, A., Goh, G., Agarwal, S., ... & Sutskever, I. (2021). **Learning Transferable Visual Models From Natural Language Supervision**. In International Conference on Machine Learning (ICML). URL: https://arxiv.org/abs/2103.00020

- Zhai, X., Mustafa, B., Kolesnikov, A., & Beyer, L. (2023). **Sigmoid Loss for Language Image Pre-Training**. In IEEE/CVF International Conference on Computer Vision (ICCV). URL: https://arxiv.org/abs/2303.15343

- Zhai, X., et al. (2024). **SigLIP 2: Multilingual Vision-Language Encoders with Improved Semantic Understanding, Localization, and Dense Features**. URL: https://arxiv.org/abs/2501.05736

- Jia, C., Yang, Y., Xia, Y., Chen, Y. T., Parekh, Z., Pham, H., ... & Duerig, T. (2021). **Scaling Up Visual and Vision-Language Representation Learning With Noisy Text Supervision**. In International Conference on Machine Learning (ICML). URL: https://arxiv.org/abs/2102.05918

- Singh, A., Hu, R., Goswami, V., Couairon, G., Galuba, W., & Rohrbach, M. (2022). **FLAVA: A Foundational Language And Vision Alignment Model**. In IEEE/CVF Conference on Computer Vision and Pattern Recognition (CVPR). URL: https://arxiv.org/abs/2112.04482

- Oquab, M., Darcet, T., Moutakanni, T., Vo, H. V., Szafraniec, M., Khalidov, V., ... & Bojanowski, P. (2023). **DINOv2: Learning Robust Visual Features without Supervision**. URL: https://arxiv.org/abs/2304.07193

- Sun, Q., Yu, Q., Cui, Y., Zhang, F., Yu, Z., Wang, Y., ... & Wang, J. (2023). **EVA-CLIP: Improved Training Techniques for CLIP at Scale**. URL: https://arxiv.org/abs/2303.15389

- Ilharco, G., Wortsman, M., Carlini, N., Taori, R., Dave, A., Shankar, V., ... & Schmidt, L. (2021). **OpenCLIP**. URL: https://arxiv.org/abs/2210.03448
