---
title: "01 · 视频生成与 DiT 架构: 时空 Patch 压缩与扩散 Transformer"
date: 2026-05-16
tags: [视频生成, DiT, 扩散模型, Sora, 时空注意力, 多模态]
---

# 01 · 视频生成与 DiT 架构: 时空 Patch 压缩与扩散 Transformer

## 1. 背景与核心痛点 (Background & Pain Points)

### 1.1 图像生成的黄金时代

2022 年到 2024 年,可以被毫不夸张地称为**图像生成模型的黄金时代**. 以 Stable Diffusion、DALL-E 3 和 Midjourney 为代表的文本到图像生成系统,已经在视觉质量、文本遵循能力和艺术表现力上达到了令人惊叹的高度. 用户只需要输入一段自然语言描述——比如"一只戴着宇航员头盔的猫在月球表面弹吉他"——这些模型就能在数秒内生成一张细节丰富、构图合理、光影逼真的高分辨率图像. 

图像生成的成功并非偶然,它建立在三个技术支柱之上: 

**第一,扩散模型(Diffusion Models)的理论成熟**. Ho 等人于 2020 年提出的 DDPM(Denoising Diffusion Probabilistic Models)证明了通过逐步去噪的方式,可以从纯高斯噪声中生成高质量数据. 这一框架具有坚实的概率论基础,训练稳定,生成质量远超同时期的 GAN. 

**第二,潜在扩散模型(Latent Diffusion Models, LDM)的工程突破**. Stable Diffusion 将扩散过程从像素空间转移到了 VAE 压缩后的潜在空间(latent space),将计算复杂度从 $O(H \times W \times 3)$ 降低到了 $O(H' \times W' \times C)$,其中 $H', W'$ 通常只有原始分辨率的 $1/8$. 这使得在消费级 GPU 上生成 512×512 甚至 1024×1024 的图像成为可能. 

**第三,大规模图文对齐数据的积累**. LAION-5B 等数据集提供了数十亿级别的图像-文本对,配合 CLIP 等视觉-语言Encoder ,模型学会了将文本语义映射到视觉特征空间,实现了真正意义上的"文本到图像"生成. 

然而,**视频生成却迟迟未能复制图像生成的成功**. 尽管在 2023 年之前已有 Make-A-Video、Imagen Video、VideoLDM 等先驱工作,但这些早期方法生成的视频普遍存在一个致命缺陷: 它们更像是"会动的图片"——每一帧单独看可能还不错,但连续播放时,画面中的物体会闪烁、变形、甚至凭空消失. 一只在视频中奔跑的狗,可能在第三帧变成了另一只品种完全不同的狗,或者跑着跑着腿的数量从四条变成了三条. 

### 1.2 视频生成的三重诅咒

视频生成之所以比图像生成困难得多,根源在于视频数据本身携带了图像所不具备的额外维度——**时间**. 这个看似简单的扩展,实际上在算法层面引发了三个相互交织的核心痛点,我们称之为"三重诅咒". 

**第一重诅咒: 时序一致性(Temporal Consistency)** . 

视频不是独立图片的简单堆叠. 一个三分钟、每秒 24 帧的视频包含 4320 帧,这些帧之间必须满足严格的时序约束: 同一个物体在相邻帧之间的位置变化必须连续且平滑(运动连贯性),物体的外观属性(颜色、纹理、形状)不能帧帧突变(外观一致性),场景中的光照和阴影变化也必须遵循物理规律(光照一致性). 

图像生成模型完全没有这些约束. Stable Diffusion 生成两张"同一只猫"的图片,实际上是两次独立的随机采样,模型不保证这两张图中的猫具有相同的面部花纹、相同的眼睛颜色,甚至不保证是同一只品种. 当我们把这样的模型直接扩展到视频——比如逐帧独立生成——就会得到每帧都"换了一只猫"的恐怖视频. 早期方法尝试通过后处理(如光流估计、时序平滑)来缓解这个问题,但这些方法本质上是在修补一个先天缺陷,无法从根本上解决时序一致性问题. 

**第二重诅咒: 计算量的指数级爆炸(Computational Explosion)** . 

让我们做一个简单的数量级估算. 一张 1024×1024 的 RGB 图像有 $1024 \times 1024 \times 3 \approx 3.1 \times 10^6$ 个像素值. 一个 5 秒、24fps、1024×1024 的视频有 $5 \times 24 \times 1024 \times 1024 \times 3 \approx 3.8 \times 10^8$ 个像素值——是单张图像的 **120 倍**. 

如果扩散模型在像素空间直接操作,每一步去噪都需要处理这 3.8 亿个数值. 更糟糕的是,扩散模型的核心操作——自注意力(Self-Attention)——的计算复杂度与 token 数量的平方成正比. 对于一张 $32 \times 32$ latent 特征图(Stable Diffusion 的常用分辨率),注意力需要在 $(32 \times 32)^2 = 1,048,576$ 个点对之间计算相似度; 而对于一个 5 秒视频在 latent 空间中可能达到的 $T \times H \times W = 16 \times 32 \times 32 = 16384$ 个时空 token,联合注意力的计算量将飙升到 $(16384)^2 \approx 2.68 \times 10^8$——是图像的 **256 倍**. 

这意味着,如果图像生成需要一块 A100 GPU,视频生成在同等分辨率下可能需要 **256 块 A100**. 这种计算量的爆炸性增长使得 naive 的视频扩散模型在工程上完全不可行. 

**第三重诅咒: 物理规律的隐式学习(Physical Plausibility)** . 

视频是人类观察世界动态过程的主要媒介. 一段"杯子从桌上掉落并破碎"的视频,不仅仅是一系列像素值的变化,它背后蕴含着丰富的物理规律: 重力加速度、刚体碰撞、脆性材料的断裂力学、碎片的抛物线轨迹. 人类观看视频时,会本能地运用这些物理直觉来理解场景. 

然而,早期的视频生成模型只是学习了像素层面的统计相关性. 它们可以生成"看起来像杯子掉落"的画面,但杯子可能穿透桌面、碎片可能逆着重力向上飞、液体的流动可能完全不遵守流体力学. 这种"物理不真实"在静态图像中几乎不可见(一张碎在地上的杯子的照片不需要你理解它掉落的轨迹),但在动态视频中却极其刺眼. 

**家谱定位**: 视频生成处于"多模态生成"技术树的深水区. 它继承了图像扩散模型的概率论框架,但必须在时序维度上进行根本性扩展. DiT(Diffusion Transformer)架构正是为了同时解决这三重诅咒而被提出的: 用 Transformer 的全局建模能力替代 U-Net 的局部卷积,通过时空 patch 压缩降低计算复杂度,并借助规模效应(Scaling Law)隐式学习物理规律. 

### 1.3 传统方法的局限

在 DiT 和 Sora 出现之前,视频生成领域主要探索过三条技术路线,但每条都有其无法逾越的天花板. 

**GAN 路线**: 以 DVD-GAN、MoCoGAN 为代表. GAN 的生成器-判别器对抗框架在图像生成中已被扩散模型全面超越,在视频生成中劣势更加明显: 训练不稳定(模式崩溃在视频维度上更加严重)、生成多样性差、难以扩展到高分辨率长视频. 

**自回归路线**: 以 VideoGPT、NÜWA 为代表. 这些方法将视频逐帧或逐 patch 地作为序列生成,使用 Transformer 或 3D 自回归模型进行下一个 token 的预测. 问题在于,视频的序列长度极其惊人——一个 256×256、4 秒、8fps 的视频有 $4 \times 8 \times 256 \times 256 = 2,097,152$ 个像素,即使压缩到 latent 空间,序列长度仍然远超语言模型处理的文本 token 数量. 自回归的逐 token 生成方式使得推理速度极慢,且误差会在序列中累积. 

**2D 扩散 + 时序扩展路线**: 以 VideoLDM、AnimateDiff 为代表. 这些方法先在图像数据上训练一个 2D 扩散模型,然后通过插入时序层(如 1D 时序卷积、时序注意力)将其扩展到视频. 这种"2D + T"的方式是一种折中: 它利用了图像扩散模型的成熟成果,但时序层通常只是在 2D 特征图上做轻量级的时序融合,无法真正建模复杂的时空依赖关系. 生成的视频往往只有轻微的局部运动(如风吹草动),难以呈现复杂的场景变化. 

## 2. 为什么重要 (Significance)

### 2.1 从"玩具"到"生产力工具"的跨越

2024 年初,OpenAI 发布了 Sora 的技术报告和演示视频,整个 AI 社区为之震动. Sora 展示的能力远远超出了当时任何公开可用的视频生成模型: 它能够生成长达 60 秒、1080p 分辨率、具有复杂镜头运动和物理交互的视频. 一个女孩走在东京雨后的街道上,地面反射着霓虹灯光,她的头发随风飘动,镜框上的水珠随着她的步伐微微颤动——这些视频在视觉质量、时序连贯性和物理真实性上达到了前所未有的高度. 

几乎在同一时间,中国的可灵(Kling)和美国的 Runway Gen-3 也展示了相近水准的视频生成能力. 可灵特别擅长处理大幅度的物理运动和复杂的人物动作,Gen-3 则在艺术风格和镜头语言上表现出色. 这三款产品标志着一个历史性的转折点: **视频生成从研究领域的"技术玩具",正式进入了可以产生商业价值的"生产力工具"阶段**. 

电影制作人开始使用这些工具制作概念预览(Pre-visualization); 广告公司用它快速生成多版本视频素材; 游戏开发者用它创建动态过场动画; 教育工作者用它生成可视化的科学模拟. 据行业分析,2025 年全球 AI 视频生成市场规模已突破 50 亿美元,并预计在 2028 年达到 300 亿美元. 

### 2.2 DiT 成为新的事实标准

Sora 的技术报告虽然刻意模糊了许多工程细节,但明确指出了一个关键架构选择: **DiT(Diffusion Transformer)** . 这不是一个渐进式的改进,而是一场范式转移. 

在此之前,视频扩散模型的 backbone 几乎全部是 U-Net 或其 3D 变体(如 3D U-Net). U-Net 通过Encoder-Decoder结构和跳跃连接,能够有效地融合多尺度空间特征. 但 U-Net 有一个根本性的限制: 它的感受野(receptive field)受限于卷积核的大小和网络深度. 一个 $3 \times 3$ 卷积层的感受野只有 3×3,即使通过多层堆叠,要达到全局感受野也需要 $O(\log(HW))$ 层. 对于视频来说,这意味着远处的时空区域之间很难直接交互. 

**DiT 用 Transformer 替代了 U-Net**. Transformer 的自注意力机制天然具有全局感受野——任何一个时空位置都可以直接关注到其他所有位置. 这种全局建模能力对于视频生成至关重要: 一个位于画面左上角的光源,需要直接影响右下角的阴影; 一个在第 1 帧抛出的球,其轨迹需要在所有后续帧中被一致地建模. 

2024 年之后发布的几乎所有重要视频生成模型——无论是开源的 CogVideoX、Open-Sora,还是闭源的 Sora、可灵、Gen-3、Luma Dream Machine——都采用了 DiT 或其变体作为核心架构. DiT 已经成为视频生成领域的事实标准,就像 Transformer 在 NLP 领域那样. 

### 2.3 规模效应的惊人显现

Sora 最深刻的启示之一是: **视频生成同样遵循 Scaling Law**. 在语言模型中,我们已经看到模型参数量、训练数据量和计算量的增加会带来能力的质变(涌现能力). Sora 证明,在视频生成领域,这种规模效应同样存在,而且更加惊人. 

OpenAI 的技术报告暗示,Sora 是一个"大规模训练"的模型——虽然没有透露具体参数,但业界推测其规模在数十亿到数百亿参数之间,训练数据涵盖了数百万小时的视频. 正是这种规模,使得 Sora 能够: 

- 理解复杂的三维场景几何(3D consistency),生成的视频具有合理的深度感和透视关系; 
- 隐式学习物理规律,物体碰撞、液体流动、布料飘动都符合直觉; 
- 维持长达 60 秒的时序一致性,人物外观、场景光照在长期跨度上保持稳定. 

这与小模型形成了鲜明对比. 一个 1B 参数的视频扩散模型可能只能生成 2 秒、有明显闪烁的短视频; 而扩展到 10B+ 参数后,同样的架构能够生成长达 10 秒、质量显著提升的视频. **这种质的飞跃不是架构改进带来的,而是纯粹的规模效应**. 

这意味着视频生成正在沿着与大语言模型相似的路径前进: 2025-2026 年,我们正处于视频生成的"GPT-2 时刻"——模型已经展示了惊人的潜力,但在可控性、生成速度和长视频一致性上仍有不足. 未来 2-3 年内,随着算力的进一步投入和算法的持续优化,视频生成将进入真正的"GPT-4 时刻",成为创意产业不可或缺的基础设施. 

## 3. 直觉类比 (Intuition)

### 3.1 传统扩散模型: 从噪声中雕刻单张图片

想象你走进一间工作室,看到一位雕塑家正在创作. 他的工作方式非常独特: 面前是一块完全被大理石覆盖的巨大石料——你完全看不到里面是什么. 雕塑家的工作不是像传统雕塑那样从无到有地添加材料,而是**一点点地去除多余的大理石**,逐渐显露出藏在石料内部的雕像. 

这就是传统扩散模型在做的事情. **纯噪声就像那块完全被大理石覆盖的石料**——没有任何结构,没有任何信息,只有随机的高斯分布. 扩散模型的"去噪"过程,就是雕塑家一点点敲掉多余石头的过程. 每一步去噪,模型都在说: "这里的噪声不应该存在,让我把它去掉,露出下面应该有的图像结构. "

经过数百甚至上千步的"雕刻",原本一片混沌的噪声逐渐显现出一幅清晰的图像. 这个类比的关键在于: 雕塑家每次只面对**一块石料**——对应扩散模型每次只生成**一张图片**. 

### 3.2 视频扩散: 同时雕刻一叠连贯的图片

现在,让我们把场景升级. 雕塑家不再只雕刻一块石料,而是要同时雕刻**一整叠 24 块石料**. 这 24 块石料堆叠在一起,对应视频中的 24 帧. 他的目标不是让每块石料各自成为一幅独立的杰作,而是要让这 24 幅雕刻作品连起来讲述一个**连续的故事**——比如一只鸟从画面左侧飞到右侧. 

这里的挑战瞬间提升了几个数量级: 

**第一,单帧质量仍然重要**. 每一块石料的雕刻质量不能下降——鸟的羽毛纹理、眼神光泽、翅膀细节都必须精美. 

**第二,帧间连贯性必须严格保证**. 如果第一块石料上的鸟在画面左侧,第二块石料上的鸟必须在稍微偏右的位置——不能突然跳到右侧,也不能飞着飞着变成了一只鸽子. 雕塑家在雕刻每一块石料时,必须同时参考上下相邻的石料,确保鸟的位置、姿态、外观的连续变化. 

**第三,运动必须符合物理直觉**. 鸟不能突然加速到超音速,不能穿过固体障碍物,翅膀的扇动频率必须与飞行速度匹配. 这些物理约束不是显式编码在模型中的,而是需要从海量训练视频中隐式学习. 

这就是视频扩散模型的核心直觉: **它不是在 24 次独立的去噪过程中生成 24 张图片,而是在一个统一的时空去噪过程中,同时雕刻出 24 张相互关联的图片**. 

### 3.3 DiT: 把雕刻工艺从 U-Net 换成 Transformer

现在让我们深入"雕刻工艺"本身. 传统视频扩散模型使用的 U-Net,可以想象成一位**局部工匠**. 这位工匠非常擅长处理细节: 他能用精细的工具在很小的范围内雕琢纹理、刻画局部特征. 但他的视野是有限的——当他站在第 5 块石料上雕刻鸟的翅膀时,他很难直接看到第 20 块石料上鸟的尾巴是什么样的,也很难同时关注到画面左上角的光源如何影响右下角的阴影. 

U-Net 的卷积操作本质上是局部的. 一个 $3 \times 3$ 的卷积核只能看到周围 8 个像素的信息. 虽然通过深层网络堆叠,信息可以间接传播到远处,但这种间接传播是低效的: 每一层只能传递有限距离,深层网络中的梯度消失问题使得远距离依赖很难被有效建模. 

**DiT 做的事情,是把这位局部工匠换成了一支全局协作的团队**. 想象不再是单个人在雕刻,而是有数百名工匠同时站在不同的石料上工作. 他们之间有一个神奇的通信系统: **任何一个工匠都可以在一瞬间与所有其他工匠直接对话**. 

站在第 1 块石料左上角负责雕刻光源的工匠,可以直接告诉站在第 24 块石料右下角负责雕刻阴影的工匠: "光从这边来,角度是这样,你的阴影应该往那边偏. "负责第 3 帧鸟翅膀的工匠,可以直接询问负责第 4 帧鸟翅膀的工匠: "你那边翅膀的角度是多少？我要确保我们的运动连贯. "

这就是 Transformer 自注意力的物理直觉: **全局、直接的通信**. 在 DiT 中,时空中的每一个位置(每一个时空 patch)都可以直接与其他所有位置交互,无需通过中间层间接传递信息. 这种全局建模能力使得 DiT 在处理长距离时空依赖时具有 U-Net 无法比拟的优势. 

当然,这种全局通信也是有代价的——如果让 1000 个工匠同时两两对话,对话的总数会是 $1000 \times 1000 = 1,000,000$ 次. 这就是为什么我们需要**分解时空注意力**——把全局对话拆分成"空间层内对话"和"时间层内对话",从而将对话次数从百万级降低到万级. 我们稍后在数学推导中会严格量化这种效率提升. 

![不同扩散模型架构与去噪机制概念对比](images/dit_backbone_comparison.png)

> **图 6.1 传统图像扩散、U-Net 视频扩散与 DiT 时空注意力机制类比**
> * **单帧图像雕刻(左侧)**：传统图像扩散模型(如 Stable Diffusion)单次只处理单一的 2D 静态图像, 不涉及时间轴的时序约束. 
> * **背对背独立雕刻(中间)**：传统的 2D 卷积 + 时序扩展视频扩散模型(如早期基于 U-Net 的架构)在处理多帧时, 帧间的时序交互受限, 缺乏深层的全局通信, 容易导致画面闪烁和时序不连贯. 
> * **全局协作通信网络(右侧)**：基于 Transformer 的 DiT(Diffusion Transformer)架构. 时空中的每一个 Token(时空 patch)都可以通过自注意力机制与所有其他 Token 进行全局、直接的跨帧跨位置交互, 极大提升了建模时序一致性的能力. 


## 4. 数学推导与公式对比 (Mathematical Rigor)

### 4.1 扩散模型基础回顾

在深入视频扩散和 DiT 之前,我们必须先严格回顾扩散模型的数学基础. 扩散模型的核心思想源于非平衡热力学: 它定义了一个**前向过程**(Forward Process),逐步向数据中添加噪声,直到数据完全退化为纯高斯噪声; 然后学习一个**反向过程**(Reverse Process),从噪声中逐步恢复原始数据. 

#### 4.1.1 前向过程: 从数据到噪声

设原始数据为 $x_0 \sim q(x_0)$,其中 $q(x_0)$ 是真实数据分布. 前向过程是一个马尔可夫链,在每一步 $t$ 中,向数据添加少量的高斯噪声: 

$$q(x_t | x_{t-1}) = \mathcal{N}(x_t; \sqrt{1 - \beta_t} \, x_{t-1}, \beta_t \mathbf{I}) \tag{1} $$

这里,$\beta_t \in (0, 1)$ 是一个预先设定的噪声调度(noise schedule),通常随 $t$ 单调递增. $\beta_t$ 越小,每一步添加的噪声越少,但累积到最终步 $T$ 时,$x_T$ 会趋近于标准高斯分布 $\mathcal{N}(0, \mathbf{I})$. 

这个公式告诉我们: 给定上一时刻的 $x_{t-1}$,当前时刻的 $x_t$ 服从一个以 $\sqrt{1-\beta_t} x_{t-1}$ 为均值、$\beta_t \mathbf{I}$ 为方差的正态分布. 注意均值中的缩放因子 $\sqrt{1-\beta_t}$——它的作用是在添加噪声的同时对信号进行衰减,确保当 $t \to T$ 时信号完全消失. 

由于前向过程的每一步都是条件高斯,我们可以利用重参数化技巧,直接从 $x_0$ 采样任意时刻 $t$ 的 $x_t$,而无需逐步模拟: 

利用 $\bar{\alpha}_t = \prod_{s=1}^{t} (1 - \beta_s)$ 的累积形式,前向加噪过程可以一步到位地表达为: 

$$q(x_t | x_0) = \mathcal{N}(x_t; \sqrt{\bar{\alpha}_t} \, x_0, (1 - \bar{\alpha}_t) \mathbf{I}) \tag{2} $$
这个公式极其重要——它意味着我们可以通过一次采样得到任意加噪程度的数据: 

$$x_t = \sqrt{\bar{\alpha}_t} \, x_0 + \sqrt{1 - \bar{\alpha}_t} \, \epsilon, \quad \text{其中 } \epsilon \sim \mathcal{N}(0, \mathbf{I}) \tag{3} $$

这里,$\sqrt{\bar{\alpha}_t}$ 可以看作是信号保留率,$\sqrt{1 - \bar{\alpha}_t}$ 是噪声注入率. 当 $t$ 很小时(接近 0),$\bar{\alpha}_t \approx 1$,$x_t \approx x_0$,数据几乎完好; 当 $t$ 很大(接近 $T$),$\bar{\alpha}_t \approx 0$,$x_t \approx \epsilon$,数据完全退化为噪声. 

#### 4.1.2 反向过程: 从噪声中恢复数据

前向过程是预先定义好的、不需要学习的. 扩散模型的真正学习目标是从 $x_T$ 逐步恢复 $x_0$. 理论上,如果前向过程的每一步添加的噪声足够小,反向过程也是高斯的: 

$$p_\theta(x_{t-1} | x_t) = \mathcal{N}(x_{t-1}; \mu_\theta(x_t, t), \Sigma_\theta(x_t, t)) \tag{4} $$
这里 $\mu_\theta$ 和 $\Sigma_\theta$ 是需要神经网络来近似的均值和方差. Ho 等人(DDPM)做了一个关键的简化: 他们让网络预测噪声 $\epsilon$,并固定方差为 $\tilde{\beta}_t \mathbf{I}$(或 $ \beta_t \mathbf{I}$). 在这种参数化下,均值可以表示为: 

$$\mu_\theta(x_t, t) = \frac{1}{\sqrt{\alpha_t}} \left( x_t - \frac{1 - \alpha_t}{\sqrt{1 - \bar{\alpha}_t}} \epsilon_\theta(x_t, t) \right) \tag{5} $$

其中 $\alpha_t = 1 - \beta_t$. 这个公式告诉我们: 如果我们能准确预测出加到 $x_t$ 上的噪声 $\epsilon$,就可以通过减去这个噪声来估计 $x_{t-1}$ 的均值. 

#### 4.1.3 训练目标: 噪声预测

DDPM 的训练目标出奇地简洁. 对于每一个训练样本 $x_0$,我们随机采样一个时间步 $t \sim \text{Uniform}(\{1, ..., T\})$,采样一个噪声 $\epsilon \sim \mathcal{N}(0, \mathbf{I})$,构造加噪数据 $x_t$,然后训练神经网络去预测这个噪声: 

$$\mathcal{L}_{\text{DDPM}} = \mathbb{E}_{x_0, \epsilon, t} \left[ \| \epsilon - \epsilon_\theta(x_t, t) \|^2 \right] \tag{6} $$
这个均方误差损失(MSE Loss)的物理意义非常清晰: 神经网络 $\epsilon_\theta$ 接收一个被噪声污染的数据 $x_t$ 和时间步信息 $t$,试图还原出当时加入的噪声 $\epsilon$. 预测得越准确,去噪的方向就越正确,生成的数据质量就越高. 

值得注意的是,这个目标函数等价于最大化变分下界(ELBO),也等价于最小化前向和反向过程之间的 KL 散度. DDPM 论文证明了,在这种简化的噪声预测参数化下,模型可以生成与 GAN 相当甚至更高质量的图像,同时训练更加稳定. 

### 4.2 从 Latent Diffusion 到视频 Latent Diffusion

#### 4.2.1 图像 LDM: 在压缩空间中扩散

扩散模型直接在像素空间操作的一个主要问题是维度灾难. 一张 256×256 的 RGB 图像有 196,608 个维度,每一步去噪都需要在这个高维空间中进行计算. Latent Diffusion Model(LDM)通过引入一个预训练的变分自Encoder (VAE)来解决这个问题. 

VAE 由Encoder  $\mathcal{E}$ 和Decoder   $\mathcal{D}$ 组成. Encoder 将图像 $x \in \mathbb{R}^{3 \times H \times W}$ 压缩到低维潜在空间: 

$$z = \mathcal{E}(x), \quad z \in \mathbb{R}^{C \times H' \times W'} \tag{7} $$

对于 Stable Diffusion,$H' = H/8$,$W' = W/8$,$C = 4$. 一张 512×512 的图像被压缩为 $4 \times 64 \times 64$ 的 latent 张量,维度从 786,432 降到了 16,384——压缩了 **48 倍**. 

扩散过程不再在像素空间 $x$ 上进行,而是在 latent 空间 $z$ 上进行: 

- 前向过程: $z_t = \sqrt{\bar{\alpha}_t} z_0 + \sqrt{1 - \bar{\alpha}_t} \epsilon$
- 反向过程: 训练网络 $\epsilon_\theta(z_t, t, c)$ 预测噪声,其中 $c$ 是条件信息(如文本 embedding)
- 生成时: 从 $z_T \sim \mathcal{N}(0, \mathbf{I})$ 开始,逐步去噪得到 $z_0$,再用Decoder   $\mathcal{D}(z_0)$ 恢复为像素图像

这种设计有三个巨大的优势: 
1. **计算效率**: 注意力计算在更低维的空间进行; 

2. **感知压缩**: VAE 移除了像素空间中的高频冗余信息(人眼难以察觉的细微噪声),让扩散模型专注于学习语义信息; 

3. **模块化**: Encoder 和Decoder  可以独立预训练,扩散模型只负责学习潜在空间的分布. 

#### 4.2.2 视频 LDM: 时序维度的加入

将 LDM 扩展到视频,直观的做法是将视频的每一帧分别编码,然后在时空 latent 上进行扩散. 设输入视频为 $x \in \mathbb{R}^{3 \times T \times H \times W}$,其中 $T$ 是帧数. 

视频的 VAE Encoder 通常是一个**时空卷积网络**,它在空间维度($H, W$)和时间维度($T$)上同时进行下采样. 例如,一个典型的视频 VAE 可能将 $3 \times T \times H \times W$ 的输入压缩为: 

$$z = \mathcal{E}_{\text{video}}(x), \quad z \in \mathbb{R}^{C \times T' \times H' \times W'} \tag{8} $$
其中 $T' = T/s_t$,$H' = H/s_h$,$W' = W/s_w$. 对于 Sora 使用的 VAE,空间压缩率通常为 8($s_h = s_w = 8$),时间压缩率通常为 4 或 8($s_t = 4$ 或 $8$). 一个 5 秒、24fps、1080p 的视频($3 \times 120 \times 1080 \times 1920$)可以被压缩到 $C \times 15 \times 135 \times 240$(假设 $C=16$,时空压缩率分别为 8 和 8),维度压缩了约 **576 倍**. 

现在,扩散过程在这个 4D latent 张量 $z \in \mathbb{R}^{C \times T' \times H' \times W'}$ 上进行: 

- 前向过程: $z_t = \sqrt{\bar{\alpha}_t} z_0 + \sqrt{1 - \bar{\alpha}_t} \epsilon$,其中 $\epsilon \sim \mathcal{N}(0, \mathbf{I})$ 的维度与 $z_0$ 相同
- 反向过程: 训练网络 $\epsilon_\theta(z_t, t, c)$ 预测噪声

#### 4.2.3 计算挑战: 注意力的爆炸性增长

虽然 VAE 压缩极大地降低了维度,但扩散模型核心的自注意力操作仍然面临严峻的挑战. 在图像 LDM 中,latent 特征图被展平为一系列空间 token. 对于 $H' \times W'$ 的特征图,token 数量 $N_{\text{spatial}} = H' \times W'$,自注意力的计算复杂度为 $O(N_{\text{spatial}}^2) = O((H'W')^2)$. 

在视频 LDM 中,latent 张量增加了时间维度 $T'$. 如果我们将所有时空位置展平为 token,token 数量变为: 

$$N_{\text{spacetime}} = T' \times H' \times W' \tag{9} $$

自注意力的计算复杂度变为: 

$$O(N_{\text{spacetime}}^2) = O((T' \times H' \times W')^2) \tag{10} $$
让我们代入一个 Sora 量级的具体数字. 假设生成一个 5 秒、24fps 的视频,VAE 时间压缩率为 4,空间压缩率为 8: 
- $T' = 5 \times 24 / 4 = 30$
- $H' = 1080 / 8 = 135$
- $W' = 1920 / 8 = 240$
- $N_{\text{spacetime}} = 30 \times 135 \times 240 = 972,000$

注意力复杂度为 $O(972000^2) \approx 9.45 \times 10^{11}$——近万亿次操作！这即使对于最先进的 GPU 集群也是不可承受的. 

更直观的对比: 假设单张 1080p 图像在 latent 空间中的 token 数为 $135 \times 240 = 32,400$,注意力复杂度为 $O(3.2 \times 10^8)$. 加入 30 个时间步后,复杂度增长了约 **3000 倍**. 这就是视频扩散面临的根本性计算瓶颈. 

### 4.3 DiT(Diffusion Transformer)架构

2022 年底,Peebles 和 Xie 发表了《Scalable Diffusion Models with Transformers》(DiT),提出了一个在当时颇具争议的观点: U-Net 并不是扩散模型的必需品,一个标准的 Vision Transformer(ViT)可以在扩散任务上达到甚至超越 U-Net 的性能. 这篇论文为后来 Sora 的出现奠定了架构基础. 

#### 4.3.1 核心思想: 用 Transformer 替代 U-Net

DiT 的核心主张可以概括为一句话: **将扩散模型的 backbone 从 U-Net 替换为 Transformer**. 

在图像扩散模型中,U-Net 的架构包含以下关键组件: 
- **Encoder 路径**: 通过下采样卷积层逐步降低空间分辨率,同时增加通道数; 

- **瓶颈层**: 最低分辨率处的特征处理; 

- **Decoder  路径**: 通过上采样卷积层恢复空间分辨率; 

- **跳跃连接(Skip Connections)** : 将Encoder 各层的特征直接连接到Decoder  对应层,保留高频细节; 

- **时间/条件嵌入**: 通过 AdaGN(Adaptive Group Normalization)等机制将时间步 $t$ 和条件 $c$ 注入网络. 

U-Net 的优势在于其归纳偏置(inductive bias): 卷积操作天然具有平移等变性和局部性,非常适合处理图像数据. 跳跃连接有效地保留了多尺度信息. 这些偏置使得 U-Net 在数据量有限时表现优异. 

但 U-Net 也有根本性弱点: 
- **感受野受限**: 如前所述,卷积的感受野需要多层堆叠才能覆盖全图; 

- **扩展性受限**: U-Net 的架构设计(通道数、层数)相对固定,难以像 Transformer 那样通过简单地增加深度和宽度来扩大规模; 

- **全局交互弱**: 远距离空间位置之间的信息交互效率低下. 

DiT 认为,随着训练数据量达到数亿级别,模型可以从数据中学习到所需的空间结构知识,而不需要依赖卷积的强归纳偏置. 此时,Transformer 的**全局建模能力**和**优异的扩展性**将展现出更大的优势. 

#### 4.3.2 Patchify: 从连续信号到离散 Token

Transformer 的输入必须是离散的 token 序列. DiT 的第一步是将连续的 latent 张量转换为 token 序列,这个过程称为 **Patchify**. 

对于图像,DiT 将 latent 张量 $z \in \mathbb{R}^{C \times H' \times W'}$ 切分成不重叠的二维 patch. 设 patch 大小为 $p \times p$,则: 

- Patch 数量: $N = \frac{H'}{p} \times \frac{W'}{p}$
- 每个 patch 的维度: $D = C \times p \times p$
- 展平后: $x \in \mathbb{R}^{N \times D}$

例如,对于 $z \in \mathbb{R}^{4 \times 32 \times 32}$,设 $p = 2$,则: 
- $N = (32/2) \times (32/2) = 16 \times 16 = 256$ 个 patch
- $D = 4 \times 2 \times 2 = 16$
- 输出序列维度: $256 \times 16$

每个 patch 会通过一个线性投影层映射到 Transformer 的 hidden dimension(如 $D_{\text{model}} = 768$ 或 1152). 同时,每个 patch 还会加上位置编码(positional embedding),让模型知道每个 token 在原始空间中的位置. 

对于视频,Patchify 自然地从 2D 扩展到 3D. **时空 Patchify** 将 4D latent 张量 $z \in \mathbb{R}^{C \times T' \times H' \times W'}$ 切分成不重叠的三维时空 patch: 

- 设时间 patch 大小为 $p_t$,空间 patch 大小为 $p_h \times p_w$
- Patch 数量: $N = \frac{T'}{p_t} \times \frac{H'}{p_h} \times \frac{W'}{p_w}$
- 每个 patch 的维度: $D = C \times p_t \times p_h \times p_w$
- 展平后: $x \in \mathbb{R}^{N \times D}$

假设 $z \in \mathbb{R}^{16 \times 16 \times 32 \times 32}$($C=16, T'=16, H'=32, W'=32$),设 $(p_t, p_h, p_w) = (2, 4, 4)$: 
- $N = (16/2) \times (32/4) \times (32/4) = 8 \times 8 \times 8 = 512$ 个时空 patch
- $D = 16 \times 2 \times 4 \times 4 = 512$
- 输出序列维度: $512 \times 512$

![时空 Patchify 机制与 Token 化过程](images/spacetime_patchify_flow.png)

> **图 6.2 视频潜在空间的时空 Patchify 机制**
> * **视频潜在空间(左侧)**：输入视频经由 3D VAE 编码后, 得到形状为 $C \times T' \times H' \times W'$ 的 4D 时空潜在张量. 
> * **时空 Patch 提取(右侧)**：使用大小为 $p_t \times p_h \times p_w$ 的 3D 卷积以不重叠的方式在潜在张量上滑动, 将其切分成离散的 3D 时空立方体(Patches), 每个 patch 都带有明确的时空位置标识 $(t, h, w)$. 
> * **展平 Token 序列(下方)**：提取出的 3D patches 被展平并线性投影映射到 $d$-dimensional 的连续向量空间中, 成为 Transformer 能够直接接收的输入 Token 序列. 


#### 4.3.3 Transformer 处理: 标准自注意力 + FFN

Patchify 之后,DiT 的处理完全遵循标准的 Transformer 架构. 输入 token 序列 $x \in \mathbb{R}^{N \times D_{\text{model}}}$ 经过 $L$ 个 Transformer block 的处理,每个 block 包含: 

**LayerNorm + 多头自注意力(MSA)** : 

$$\text{Attention}(Q, K, V) = \text{softmax}\left(\frac{QK^T}{\sqrt{d_k}}\right) V \tag{11} $$

其中 $Q = x W_Q$,$K = x W_K$,$V = x W_V$. 自注意力的计算复杂度为 $O(N^2 \cdot d_k)$,其中 $N$ 是序列长度(patch 数量),$d_k$ 是每个头的维度. 

自注意力的物理意义在于: 每个 patch 都可以"看到"其他所有 patch,并根据内容相关性(通过 $QK^T$ 计算)决定关注哪些 patch. 这意味着: 
- 空间上相距很远的物体可以直接交互(如光源和阴影); 
- 时间上相隔很远的帧可以直接对齐(如视频开头和结尾的同一物体); 
- 语义上相关的区域可以聚合信息(如一个人的头和手). 

**LayerNorm + 前馈网络(FFN)** 对经过注意力交互的 token 特征进行逐位置的非线性变换: 

$$\text{FFN}(x) = \sigma(x W_1 + b_1) W_2 + b_2 \tag{12} $$
FFN 对每个 token 独立地进行非线性变换,通常将维度先扩展 4 倍再投影回来(如 $D_{\text{model}} \to 4 D_{\text{model}} \to D_{\text{model}}$). 它为模型提供了逐位置的表达能力,与自注意力的全局交互形成互补. 

**残差连接(Residual Connection)** : 

每个子层(注意力和 FFN)的输出都会与输入相加: 

$$x_{\text{out}} = x_{\text{in}} + \text{Sublayer}(\text{LayerNorm}(x_{\text{in}})) \tag{13} $$

残差连接缓解了深层网络的梯度消失问题,使得 DiT 可以堆叠数十甚至上百层而不退化. 

#### 4.3.4 AdaLN-Zero: 条件注入的精妙设计

扩散模型需要接收两个关键条件: **时间步 $t$**(告诉模型当前去噪到哪一步了)和**文本/类别条件 $c$**(告诉模型应该生成什么内容). 在 U-Net 中,条件通常通过 AdaGN(Adaptive Group Normalization)或 cross-attention 注入. 

DiT 采用了一种更加简洁优雅的条件注入机制: **AdaLN-Zero(Adaptive Layer Normalization with Zero Initialization)** . 

标准的 LayerNorm 将输入归一化为零均值、单位方差: 

$$\text{LayerNorm}(h) = \gamma \odot \frac{h - \mu}{\sqrt{\sigma^2 + \epsilon}} + \beta \tag{14} $$
其中 $\gamma$ 和 $\beta$ 是可学习的缩放和平移参数,$\mu$ 和 $\sigma^2$ 是输入的均值和方差. 在 AdaLN-Zero 中,这些参数不再是固定的可学习参数,而是**由时间步和条件的 embedding 动态生成**. 

具体来说,DiT 将时间步 $t$ 和条件 $c$ 分别编码为 embedding $e_t$ 和 $e_c$,将它们拼接后通过一个小型 MLP,输出六个参数: 

$$(\gamma_1, \beta_1, \alpha_1, \gamma_2, \beta_2, \alpha_2) = \text{MLP}(\text{concat}(e_t, e_c)) \tag{15} $$

其中 $(\gamma_1, \beta_1, \alpha_1)$ 用于调制第一个 LayerNorm(在自注意力之前),$(\gamma_2, \beta_2, \alpha_2)$ 用于调制第二个 LayerNorm(在 FFN 之前). 调制公式为: 

$$\text{AdaLN}(h, c) = \gamma(c) \odot \text{LayerNorm}(h) + \beta(c) \tag{16} $$
而 $\alpha(c)$ 用于缩放残差分支的输出: 

$$x_{\text{out}} = x_{\text{in}} + \alpha(c) \odot \text{Sublayer}(\text{AdaLN}(x_{\text{in}}, c)) \tag{17} $$

**为什么叫 Zero Initialization？** DiT 在训练开始时将所有 $\alpha$ 参数初始化为零. 这意味着在训练初期,每个 Transformer block 几乎等价于恒等映射($x_{\text{out}} \approx x_{\text{in}}$),模型先学习浅层特征,再随着训练深入逐渐激活深层残差路径. 这种设计极大地稳定了深层 DiT 的训练. 

AdaLN-Zero 相比 U-Net 的 AdaGN 有几个优势: 
1. **计算效率**: 不需要额外的 group normalization 计算,直接复用 LayerNorm; 

2. **表达能力**: MLP 可以根据复杂的条件组合生成精细的调制参数; 

3. **架构简洁**: 避免了 U-Net 中复杂的跨层条件注入逻辑. 

#### 4.3.5 U-Net vs DiT: 高亮差异

让我们用一个对比表来总结 U-Net 和 DiT 作为扩散 backbone 的核心差异: 

| 维度 | U-Net | DiT |
|------|-------|-----|
| **核心操作** | 局部卷积 + 下/上采样 | 全局自注意力 + FFN |
| **感受野** | 局部,需多层堆叠扩展 | 全局,单层覆盖全部 token |
| **扩展方式** | 增加通道/深度,设计复杂 | 增加层数/宽度/头数,简单粗暴 |
| **条件注入** | AdaGN / Cross-Attention | AdaLN-Zero |
| **归纳偏置** | 强(平移等变、局部性) | 弱(主要靠数据学习) |
| **Scaling Law** | 不明显,收益递减快 | 明显,规模增大显著改善质量 |
| **计算复杂度** | $O(N \cdot k^2 \cdot C^2)$(卷积) | $O(N^2 \cdot d)$(注意力) |

这里 $N$ 是空间/时空 token 数,$k$ 是卷积核大小,$C$ 是通道数,$d$ 是 hidden dimension. 注意虽然自注意力的 $O(N^2)$ 看起来比卷积的 $O(N)$ 更差,但在实际中,DiT 可以通过调整 patch size 来控制 $N$,而 U-Net 的下采样会丢失细粒度信息. 

### 4.4 时空注意力设计: 联合 vs 分解

DiT 的全局自注意力为视频生成提供了强大的建模能力,但同时也带来了计算量的爆炸. 如何在保持建模能力的同时控制计算成本,是视频 DiT 架构设计的核心问题. 目前主流的方案有两种: **联合时空注意力(Joint Spatio-Temporal Attention)** 和**分解时空注意力(Factorized Spatio-Temporal Attention)** . 

#### 4.4.1 联合时空注意力: 全局精确但昂贵

联合时空注意力是最直接的方案: 将所有时空 patch 展平为一个序列,然后在这个序列上执行标准的自注意力. 

设输入 latent 经过 Patchify 后有 $N = T' \times H' \times W'$ 个时空 token. 联合注意力的计算为: 

$$\text{Attention}_{\text{joint}}(Q, K, V) = \text{softmax}\left(\frac{QK^T}{\sqrt{d_k}}\right) V \tag{18} $$
其中 $Q, K, V \in \mathbb{R}^{N \times d_k}$. 注意力矩阵 $QK^T$ 的形状为 $N \times N$,计算量为 $O(N^2 \cdot d_k)$. 

在这种设计中,任何一个时空位置都可以直接关注到其他所有时空位置. 第 1 帧左上角的 patch 可以直接与第 30 帧右下角的 patch 交互,无需通过中间 patch 传递信息. 这种全局精确性使得模型能够捕捉最远距离的时空依赖关系——比如一个物体在视频开头出现,在结尾再次出现,模型可以直接建立它们的对应关系. 

**计算代价**: 如前所述,当 $N = T' \times H' \times W'$ 很大时,$O(N^2)$ 的复杂度是不可承受的. 即使对于中等分辨率的短视频,联合注意力的显存占用和计算量也迅速超出单块 GPU 的容量. 

#### 4.4.2 分解时空注意力: 空间 + 时间分离

分解时空注意力是联合注意力的实用替代方案. 它的核心洞察是: **空间交互和时间交互可以分开进行,而不损失太多的建模能力**. 

分解注意力的基本架构是在每个 Transformer block 中交替或级联两种注意力: 

**空间注意力(Spatial Attention)** : 对所有时间步的所有空间位置做注意力,但**每个时间步独立计算**. 

具体来说,将 token 序列重新排列为 $(T', H' \times W', D)$ 的形状. 空间注意力在第二个维度($H' \times W'$)上计算: 

$$\text{Attention}_{\text{spatial}}(Q_{\text{sp}}, K_{\text{sp}}, V_{\text{sp}}) = \text{softmax}\left(\frac{Q_{\text{sp}} K_{\text{sp}}^T}{\sqrt{d_k}}\right) V_{\text{sp}} \tag{19} $$

这里 $Q_{\text{sp}}, K_{\text{sp}}, V_{\text{sp}}$ 的形状为 $(T', H'W', d_k)$. 注意力矩阵的形状为 $(H'W') \times (H'W')$,需要计算 $T'$ 次(每个时间步一次). 总计算量为 $O(T' \cdot (H'W')^2 \cdot d_k)$. 

**时间注意力(Temporal Attention)** : 对所有空间位置的每个像素做时间维度上的注意力. 

将 token 序列重新排列为 $(H' \times W', T', D)$ 的形状. 时间注意力在第二个维度($T'$)上计算: 

$$\text{Attention}_{\text{temporal}}(Q_{\text{temp}}, K_{\text{temp}}, V_{\text{temp}}) = \text{softmax}\left(\frac{Q_{\text{temp}} K_{\text{temp}}^T}{\sqrt{d_k}}\right) V_{\text{temp}} \tag{20} $$
这里 $Q_{\text{temp}}, K_{\text{temp}}, V_{\text{temp}}$ 的形状为 $(H'W', T', d_k)$. 注意力矩阵的形状为 $T' \times T'$,需要计算 $H'W'$ 次(每个空间位置一次). 总计算量为 $O(H'W' \cdot (T')^2 \cdot d_k)$. 

**总计算量对比**: 

- 联合注意力: $O_{\text{joint}} = O((T' \cdot H' \cdot W')^2 \cdot d_k)$
- 分解注意力: $O_{\text{factorized}} = O(T' \cdot (H'W')^2 \cdot d_k + HW' \cdot (T')^2 \cdot d_k)$

让我们代入具体数字进行比较. 设 $T' = 16$,$H' = W' = 32$: 

- 联合注意力: $N = 16 \times 32 \times 32 = 16384$,$N^2 = 268,435,456$
- 空间注意力: $T' \times (H'W')^2 = 16 \times 1024^2 = 16,777,216$
- 时间注意力: $H'W' \times (T')^2 = 1024 \times 256 = 262,144$
- 分解总和: $16,777,216 + 262,144 = 17,039,360$

分解注意力的总计算量约为联合注意力的 **6.3%**——节省了约 **16 倍** 的计算！

这种效率提升的来源在数学上非常清晰. 联合注意力的复杂度是 $O((THW)^2) = O(T^2 H^2 W^2)$,而分解注意力是 $O(TH^2 W^2 + T^2 HW)$. 当 $T, H, W$ 都很大时,$T^2 H^2 W^2$ 的增长速度远快于后两者之和. 

#### 4.4.3 高亮差异: 联合 = 全局精确但 $O(N^4)$; 分解 = 近似但 $O(N^3)$

如果我们把 $N$ 定义为空间 token 数($N = HW$),把 $T$ 作为独立的时间维度,则: 

- 联合注意力复杂度为 $O((TN)^2) = O(T^2 N^2)$. 如果 $T \approx N$(时间维度和空间维度相当),则为 $O(N^4)$. 
- 分解注意力复杂度为 $O(TN^2 + TN^2) = O(TN^2)$(当 $T$ 和 $N$ 同阶时). 如果 $T \approx N$,则为 $O(N^3)$. 

从 $O(N^4)$ 到 $O(N^3)$,这是分解注意力带来的理论收益. 

**但分解注意力的代价是什么？** 代价是模型无法在一次注意力操作中对所有时空位置进行直接的全局交互. 信息必须通过"空间注意力层 → 时间注意力层 → 空间注意力层 → ..."这样的交替堆叠来间接传递. 对于某些需要精细时空对齐的任务(如高速运动物体的精确轨迹跟踪),这种间接交互可能不如联合注意力精确. 

在实践中,大多数视频 DiT 采用**混合策略**: 在模型的浅层使用分解注意力(捕捉局部时空特征),在深层偶尔插入联合注意力(建立全局对应关系),或者采用**窗口化联合注意力**(只在一个局部时空窗口内计算联合注意力). Sora 的具体方案并未完全公开,但业界推测其采用了某种高效的分解注意力变体. 

### 4.5 Sora 的核心机制

2024 年 2 月,OpenAI 发布的 Sora 技术报告虽然刻意省略了大量工程细节,但仍然揭示了 DiT 架构在视频生成领域的终极形态. 理解 Sora 的关键设计,有助于我们把握整个领域的技术方向. 

#### 4.5.1 时空 Patch 压缩: 统一表示的野心

Sora 的核心流程可以概括为三步压缩: 

**原始视频 → VAE Latent → 时空 Patch**

第一步,原始视频(像素空间)通过一个**视频压缩网络**(Video Compression Network,本质上是时空 VAE Encoder )被压缩到低维 latent 空间. 这个过程同时压缩了空间分辨率(通常 8 倍)和时间分辨率(通常 4-8 倍),将原始视频从 $3 \times T \times H \times W$ 压缩到 $C \times T' \times H' \times W'$. 

第二步,压缩后的 latent 张量被切成**时空 patch**. 这是 Sora 最具标志性的设计之一——它将视频、图像、甚至任意维度的视觉数据,都统一表示为**时空 patch 的集合**. 一张静态图像可以看作是只有一帧的视频; 一个低分辨率视频和高分辨率视频的区别只是 patch 数量和每个 patch 对应的原像素区域大小不同. 

这种统一表示的野心在于: **Sora 的训练数据不需要严格区分"图像"和"视频"**. 它可以同时在大规模图像数据集(如 LAION)和视频数据集(如 InternVid)上进行训练. 图像数据为模型提供了丰富的空间细节先验,视频数据则教会了模型时序动态. 这种联合训练策略极大地提升了数据效率和生成质量. 

#### 4.5.2 视频作为"世界模拟器"

Sora 技术报告中一个备受关注的表述是: 视频生成模型可以被理解为一种**"世界模拟器"(World Simulator)** . 

传统的计算机图形学(CG)通过显式建模物理规律来生成视频: 定义物体的三维几何形状、材质属性、光照条件,然后用光线追踪或光栅化算法渲染每一帧. 这种方法精确可控,但需要大量的人工建模工作,且对于复杂自然场景(如烟雾、火焰、水流)的模拟极其困难. 

Sora 走了一条完全不同的路: **它不是显式地编码物理规律,而是在 latent 空间中隐式地学习这些规律**. 通过在海量真实视频数据上进行训练,模型"观察"到了无数物理过程的实例: 物体如何下落、水如何流动、光如何反射、布料如何飘动. 这些观察被压缩进数十亿参数的神经网络权重中,形成了对物理世界的统计性理解. 

当 Sora 生成一段"杯子掉落并破碎"的视频时,它并不是在运行刚体动力学和断裂力学的数值模拟——它是在 latent 空间中,基于学习到的统计模式,逐步去噪出一个符合物理直觉的时空张量. 这种方式的优势在于**通用性**: 同一个模型可以处理无数种不同的物理现象,而不需要为每种现象单独编写物理引擎. 

但这种方式也有局限性: 模型学到的只是**统计相关性**,而不是**因果律**. 它可以生成"看起来像杯子破碎"的视频,但不能保证在任意初始条件下都严格遵守能量守恒或动量守恒. 当遇到训练数据中很少见的物理场景时,模型可能会产生不符合物理直觉的结果. 

#### 4.5.3 规模效应: 视频生成的 Scaling Law

Sora 最重要的启示,是视频生成领域**Scaling Law**的显现. Scaling Law 最初在大语言模型中被观察到: 当模型参数量、训练数据量和计算量按一定比例同时增加时,模型的能力会出现**非线性的、质的飞跃**. 

Sora 证明,在视频生成中,同样的规律成立: 

- **小模型(< 1B 参数)** : 能够生成短片段(2-4 秒),但时序一致性差,物体容易闪烁变形,物理交互不真实; 

- **中等模型(1B - 10B 参数)** : 能够生成中等长度(5-10 秒)的视频,时序一致性明显改善,但复杂运动仍有瑕疵; 

- **大模型(> 10B 参数,训练数据 > 百万小时)** : 能够生成高质量的长视频(30-60 秒),具有合理的三维一致性、物理真实性和长期时序稳定性. 

这种规模效应的物理根源在于: 视频数据中的时空依赖关系极其复杂,小模型的容量不足以捕捉这些依赖. 只有足够大的模型,才能在参数空间中编码跨越数十帧、覆盖整个画面的长距离时空关联. 

OpenAI 没有公开 Sora 的具体参数规模,但据业界推测,Sora 的参数量在数十亿到数百亿之间,训练数据涵盖了数百万到数千万小时的视频. 这种规模的训练需要数千块顶级 GPU 运行数月,成本估计在数千万到数亿美元级别. 这解释了为什么直到 2024 年,才出现 Sora 级别的视频生成能力——**它不是算法上的单点突破,而是算力和数据规模达到临界点后涌现的质变**. 

## 5. 数值走查 (Numerical Example)

为了让上述数学公式更加具体可感,让我们构造一个极简但完整的数值例子,一步一步地走查视频 DiT 中的核心计算流程. 

### 5.1 构造小例子

**场景设定**: 我们要训练一个简化的视频扩散模型来生成一个极短视频. 

**输入参数**: 
- 视频帧数: $T = 4$ 帧
- 每帧空间分辨率: $H = W = 8$ 像素(极简设置,便于手工计算)
- 颜色通道: 假设已经在 latent 空间,$C = 2$ 个通道
- 因此 latent 视频张量维度: $z \in \mathbb{R}^{2 \times 4 \times 8 \times 8}$

**Patchify 参数**: 
- 时间 patch 大小: $p_t = 2$
- 空间 patch 大小: $p_h = p_w = 4$

### 5.2 计算 Patch 数量

Patch 数量 $N$ 的计算公式为: 

$$N = \frac{T}{p_t} \times \frac{H}{p_h} \times \frac{W}{p_w} = \frac{4}{2} \times \frac{8}{4} \times \frac{8}{4} = 2 \times 2 \times 2 = 8 \tag{21} $$

每个 patch 的维度为: 

$$D = C \times p_t \times p_h \times p_w = 2 \times 2 \times 4 \times 4 = 64 \tag{22} $$
所以 Patchify 后,我们得到一个包含 8 个 token 的序列,每个 token 维度为 64. 假设通过线性投影映射到 hidden dimension $d = 8$(同样是为了便于计算),则 Transformer 的输入为 $x \in \mathbb{R}^{8 \times 8}$. 

我们将 4 帧 8×8 的视频切成了 8 个时空立方体. 每个时空立方体覆盖 2 帧时间跨度和 4×4 的空间区域. 前 4 个 patch 覆盖第 1-2 帧,后 4 个 patch 覆盖第 3-4 帧. 

### 5.3 注意力计算走查

设我们已经通过线性投影得到了 query、key、value 矩阵,每个头的维度 $d_k = 2$(使用 4 个注意力头). 为了简化,我们只展示单个头的计算. 

假设 8 个 token 的 query 矩阵为(随机生成的小数字): 

$$Q = K = V = \begin{bmatrix}
0.1 & 0.2 \\
0.3 & 0.4 \\
0.5 & 0.1 \\
0.2 & 0.3 \\
0.4 & 0.5 \\
0.1 & 0.1 \\
0.3 & 0.2 \\
0.5 & 0.4 \\
\end{bmatrix} \in \mathbb{R}^{8 \times 2} \tag{23} $$
此式描述了变量之间的定量关系,其中每一项对应特定的物理操作. 
**步骤 1: 计算注意力分数矩阵 $S = QK^T / \sqrt{d_k}$**

首先计算 $QK^T$. 由于 $Q = K$,这是 token 之间的自相关矩阵. $QK^T$ 的 $(i, j)$ 元素是第 $i$ 个 token 和第 $j$ 个 token 的点积: 

$$QK^T = \begin{bmatrix}
0.05 & 0.11 & 0.07 & 0.08 & 0.14 & 0.03 & 0.07 & 0.13 \\
0.11 & 0.25 & 0.19 & 0.18 & 0.32 & 0.07 & 0.17 & 0.31 \\
0.07 & 0.19 & 0.26 & 0.13 & 0.25 & 0.06 & 0.17 & 0.23 \\
0.08 & 0.18 & 0.13 & 0.13 & 0.23 & 0.05 & 0.12 & 0.22 \\
0.14 & 0.32 & 0.25 & 0.23 & 0.41 & 0.09 & 0.22 & 0.40 \\
0.03 & 0.07 & 0.06 & 0.05 & 0.09 & 0.02 & 0.05 & 0.09 \\
0.07 & 0.17 & 0.17 & 0.12 & 0.22 & 0.05 & 0.13 & 0.23 \\
0.13 & 0.31 & 0.23 & 0.22 & 0.40 & 0.09 & 0.23 & 0.41 \\
\end{bmatrix} \tag{24} $$
此式描述了变量之间的定量关系,其中每一项对应特定的物理操作. 

除以 $\sqrt{d_k} = \sqrt{2} \approx 1.414$: 

基于上述分析,建立如下数学关系: 
$$S = \frac{QK^T}{\sqrt{2}} \approx \begin{bmatrix}
0.035 & 0.078 & 0.050 & 0.057 & 0.099 & 0.021 & 0.050 & 0.092 \\
0.078 & 0.177 & 0.134 & 0.127 & 0.226 & 0.050 & 0.120 & 0.219 \\
0.050 & 0.134 & 0.184 & 0.092 & 0.177 & 0.042 & 0.120 & 0.163 \\
0.057 & 0.127 & 0.092 & 0.092 & 0.163 & 0.035 & 0.085 & 0.156 \\
0.099 & 0.226 & 0.177 & 0.163 & 0.290 & 0.064 & 0.156 & 0.283 \\
0.021 & 0.050 & 0.042 & 0.035 & 0.064 & 0.014 & 0.035 & 0.064 \\
0.050 & 0.120 & 0.120 & 0.085 & 0.156 & 0.035 & 0.092 & 0.163 \\
0.092 & 0.219 & 0.163 & 0.156 & 0.283 & 0.064 & 0.163 & 0.290 \\
\end{bmatrix} \tag{25} $$
**步骤 2: Softmax 归一化**

对 $S$ 的每一行应用 softmax(为简洁展示,取两位小数): 

基于前述物理直觉,给出数学形式: 
$$A = \text{softmax}(S) \approx \begin{bmatrix}
0.12 & 0.13 & 0.12 & 0.12 & 0.13 & 0.11 & 0.12 & 0.13 \\
0.11 & 0.14 & 0.13 & 0.13 & 0.15 & 0.11 & 0.12 & 0.15 \\
0.11 & 0.13 & 0.14 & 0.12 & 0.13 & 0.11 & 0.12 & 0.13 \\
0.11 & 0.13 & 0.12 & 0.12 & 0.14 & 0.11 & 0.12 & 0.14 \\
0.11 & 0.14 & 0.13 & 0.13 & 0.15 & 0.11 & 0.12 & 0.15 \\
0.12 & 0.13 & 0.12 & 0.12 & 0.13 & 0.11 & 0.12 & 0.13 \\
0.11 & 0.13 & 0.13 & 0.12 & 0.14 & 0.11 & 0.12 & 0.13 \\
0.11 & 0.14 & 0.13 & 0.13 & 0.15 & 0.11 & 0.13 & 0.15 \\
\end{bmatrix} \tag{26} $$
此式将物理直觉转化为精确的数学语言,可直接用于算法实现. 
此式给出了精确的数学定义,为算法实现提供了理论基础. 
在这个极度简化的例子中,由于所有 token 的 embedding 值比较接近,注意力分布几乎均匀. 在实际训练中,经过学习的模型会使得语义相关的 patch 之间具有更高的注意力权重(如物体的不同部分之间、同一物体在不同帧之间). 

**步骤 3: 加权聚合 $O = AV$**

将上述约束转化为数学表达: 
$$O = AV \approx \begin{bmatrix}
0.29 & 0.31 \\
0.30 & 0.33 \\
0.29 & 0.31 \\
0.29 & 0.32 \\
0.30 & 0.33 \\
0.29 & 0.31 \\
0.29 & 0.31 \\
0.30 & 0.33 \\
\end{bmatrix} \tag{27} $$
输出 $O$ 的每一行是输入 token 的加权平均,权重由注意力矩阵 $A$ 决定. 这就是自注意力的核心: 每个输出位置都是所有输入位置的**内容自适应加权组合**. 

### 5.4 联合注意力 vs 分解注意力计算量对比

现在让我们在这个小例子的尺度上,严格对比联合注意力和分解注意力的浮点运算次数(FLOPs). 

**假设**: 
- $T = 4$,$H = W = 8$
- Patch size: $(p_t, p_h, p_w) = (2, 4, 4)$
- Patch 数量 $N = 8$
- Hidden dimension $d = 8$,单头维度 $d_k = 2$,共 4 个头

**联合注意力**: 
- $Q, K, V$ 的投影: $3 \times N \times d \times d_k \times h = 3 \times 8 \times 8 \times 2 \times 4 = 1536$ FLOPs
  - 注: 这里 $h$ 是头数,实际实现中 $d_k \times h = d$,所以更简洁的计算是 $3 \times N \times d^2 = 3 \times 8 \times 64 = 1536$
- $QK^T$ 计算: $N \times N \times d_k \times h = 8 \times 8 \times 2 \times 4 = 512$ FLOPs(矩阵乘法内部)
  - 更精确地: 对于每个头,$QK^T$ 是 $(N \times d_k) \times (d_k \times N) \to (N \times N)$,每头需要 $N \times N \times d_k = 8 \times 8 \times 2 = 128$ FLOPs,4 个头共 512
- Softmax: 忽略(计算量远小于矩阵乘法)
- $AV$ 计算: $N \times N \times d_k \times h = 512$ FLOPs
- 输出投影: $N \times d \times d = 8 \times 8 \times 8 = 512$ FLOPs
- **联合注意力总计**: $1536 + 512 + 512 + 512 = 3072$ FLOPs

**分解注意力——空间注意力**: 
- 将 8 个 token 排列为 $(T_{\text{patches}}, H_{\text{patches}} \times W_{\text{patches}}) = (2, 4)$
  - 即 2 个时间步,每个时间步 4 个空间 patch
- 空间注意力在 4 个空间 patch 之间计算,执行 2 次(每个时间步一次)
- 每次空间注意力: $QK^T$ 为 $4 \times 4$,$d_k = 2$,4 个头
  - $Q,K,V$ 投影: $3 \times 4 \times 8 \times 2 \times 4 = 768$ FLOPs(单次)
  - $QK^T$: $4 \times 4 \times 2 \times 4 = 128$ FLOPs(单次)
  - $AV$: $4 \times 4 \times 2 \times 4 = 128$ FLOPs(单次)
  - 输出投影: $4 \times 8 \times 8 = 256$ FLOPs(单次)
  - 单次总计: $768 + 128 + 128 + 256 = 1280$ FLOPs
- 2 次空间注意力: $1280 \times 2 = 2560$ FLOPs

**分解注意力——时间注意力**: 
- 将 8 个 token 排列为 $(H_{\text{patches}} \times W_{\text{patches}}, T_{\text{patches}}) = (4, 2)$
  - 即 4 个空间位置,每个空间位置 2 个时间 patch
- 时间注意力在 2 个时间 patch 之间计算,执行 4 次(每个空间位置一次)
- 每次时间注意力: $QK^T$ 为 $2 \times 2$,$d_k = 2$,4 个头
  - $Q,K,V$ 投影: $3 \times 2 \times 8 \times 2 \times 4 = 384$ FLOPs(单次)
  - $QK^T$: $2 \times 2 \times 2 \times 4 = 32$ FLOPs(单次)
  - $AV$: $2 \times 2 \times 2 \times 4 = 32$ FLOPs(单次)
  - 输出投影: $2 \times 8 \times 8 = 128$ FLOPs(单次)
  - 单次总计: $384 + 32 + 32 + 128 = 576$ FLOPs
- 4 次时间注意力: $576 \times 4 = 2304$ FLOPs

**分解注意力总计**: $2560 + 2304 = 4864$ FLOPs

等等,在这个极小的例子中,分解注意力的计算量反而比联合注意力高(4864 vs 3072)！这是为什么？

**关键洞察**: 在这个 $N=8$ 的极小例子中,联合注意力的 $N^2 = 64$,而分解注意力需要额外的重新排列和多次小规模注意力计算, overhead 占主导. 但让我们看当规模放大时会发生什么. 

**规模化对比**: 设 $T = 32$,$H = W = 64$,$(p_t, p_h, p_w) = (2, 4, 4)$: 
- $N = (32/2) \times (64/4) \times (64/4) = 16 \times 16 \times 16 = 4096$
- 联合注意力: $O(N^2) = O(4096^2) \approx 1.68 \times 10^7$
- 空间注意力: $T_{\text{patches}} = 16$,每步 $(H'W')^2 = 256^2 = 65536$,$16 \times 65536 = 1,048,576$
- 时间注意力: $H'W' = 256$,每步 $T_{\text{patches}}^2 = 16^2 = 256$,$256 \times 256 = 65536$
- 分解总计: $1,048,576 + 65,536 = 1,114,112$

在这个更现实的规模下,分解注意力约为联合注意力的 **6.6%**——节省了约 **15 倍** 的计算！

**结论**: 分解注意力的优势只有在 $N$ 足够大时才显现. 对于小规模问题,分解带来的额外 overhead 可能抵消甚至超过节省; 但对于 Sora 级别的视频生成($N \sim 10^5$),分解注意力的效率优势是压倒性的. 

| 注意力类型 | $N=8$ (玩具示例) | $N=4096$ (现实尺度) |
|-----------|------------------|-------------------|
| 联合注意力 | 3072 FLOPs | $1.68 \times 10^7$ FLOPs |
| 分解注意力 | 4864 FLOPs | $1.11 \times 10^6$ FLOPs |
| 分解/联合比值 | **158%** (更差) | **6.6%** (更好) |

这个表格揭示了一个重要的工程实践原则: **算法选择必须考虑实际运行尺度**. 在研究和原型阶段使用小规模数据进行快速验证时,分解注意力的优势可能不明显; 但在部署到生产环境、处理高分辨率长视频时,分解注意力是从"不可能"到"可行"的关键. 

## 6. 简化实现 (PyTorch Code)

以下是一个约 100 行的简化 PyTorch 实现,展示了视频 DiT 的核心组件: 时空 Patchify、DiT Block(包含 AdaLN-Zero、分解时空注意力、FFN),以及单步扩散训练逻辑. 

```python
import torch
import torch.nn as nn
import torch.nn.functional as F
import math

class PatchEmbed3D(nn.Module):
    """
    3D 时空 Patchify 模块
    输入: (B, C, T, H, W) 的 latent 视频张量
    输出: (B, N, D) 的 patch token 序列
    对应公式: z -> x, N = (T/pt)*(H/ph)*(W/pw), D = C*pt*ph*pw
    """
    def __init__(self, in_channels=4, patch_size=(2, 4, 4), embed_dim=768):
        super().__init__()
        self.pt, self.ph, self.pw = patch_size
        self.embed_dim = embed_dim
        # 使用 3D 卷积实现不重叠的 patch 提取 + 线性投影
        self.proj = nn.Conv3d(
            in_channels, embed_dim,
            kernel_size=patch_size, stride=patch_size
        )

    def forward(self, x):
        # x: (B, C, T, H, W)
        x = self.proj(x)  # (B, embed_dim, T', H', W')
        x = x.flatten(2).transpose(1, 2)  # (B, N, embed_dim)
        return x


class TimestepEmbedder(nn.Module):
    """
    时间步 embedding,使用正弦位置编码 + MLP
    对应公式: t -> e_t
    """
    def __init__(self, hidden_dim, embed_dim):
        super().__init__()
        self.mlp = nn.Sequential(
            nn.Linear(hidden_dim, embed_dim),
            nn.SiLU(),
            nn.Linear(embed_dim, embed_dim),
        )

    def forward(self, t):
        # 正弦位置编码 (B,) -> (B, hidden_dim)
        half_dim = self.mlp[0].in_features // 2
        emb = math.log(10000) / (half_dim - 1)
        emb = torch.exp(torch.arange(half_dim, device=t.device) * -emb)
        emb = t[:, None] * emb[None, :]
        emb = torch.cat([torch.sin(emb), torch.cos(emb)], dim=-1)
        return self.mlp(emb)  # (B, embed_dim)


class DiTBlock(nn.Module):
    """
    DiT 的核心构建块: AdaLN-Zero + 分解时空注意力 + FFN
    对应公式中的 Transformer block + AdaLN(h, c)
    """
    def __init__(self, dim, num_heads=8, mlp_ratio=4.0):
        super().__init__()
        self.norm1 = nn.LayerNorm(dim, elementwise_affine=False)
        self.norm2 = nn.LayerNorm(dim, elementwise_affine=False)
        
        # 多头自注意力,不使用偏置以节省参数量
        self.attn_spatial = nn.MultiheadAttention(
            dim, num_heads, batch_first=True, bias=False
        )
        self.attn_temporal = nn.MultiheadAttention(
            dim, num_heads, batch_first=True, bias=False
        )
        
        # FFN
        mlp_hidden_dim = int(dim * mlp_ratio)
        self.mlp = nn.Sequential(
            nn.Linear(dim, mlp_hidden_dim),
            nn.GELU(),
            nn.Linear(mlp_hidden_dim, dim),
        )
        
        # AdaLN-Zero: 为 2 个 norm + 2 个残差分支生成 gamma, beta, alpha
        # 共 6 * dim 个输出参数
        self.adaLN_modulation = nn.Sequential(
            nn.SiLU(),
            nn.Linear(dim, 6 * dim, bias=True)
        )
        # 将 alpha 初始化为零 (Zero Initialization)
        nn.init.zeros_(self.adaLN_modulation[-1].weight)
        nn.init.zeros_(self.adaLN_modulation[-1].bias)

    def forward(self, x, c, T, H, W):
        """
        x: (B, N, D) patch tokens, N = T*H*W (在 patch 后的维度)
        c: (B, D) 条件 embedding (时间步 + 文本条件融合)
        T, H, W: 时空 patch 网格尺寸
        """
        B, N, D = x.shape
        # 生成 AdaLN 参数: (B, 6*D)
        shift_msa, scale_msa, gate_msa, shift_mlp, scale_mlp, gate_mlp = \
            self.adaLN_modulation(c).chunk(6, dim=-1)
        
        # ---- 空间注意力 ----
        # 重排为 (B, T, H*W, D),对 H*W 维度做自注意力
        x_spatial = x.reshape(B, T, H * W, D)
        # 应用 AdaLN: gamma * LN(x) + beta
        norm_x = self.norm1(x_spatial) * (1 + scale_msa[:, None, None, :]) + \
                 shift_msa[:, None, None, :]
        # 展平为 (B*T, H*W, D) 用于注意力
        norm_x = norm_x.reshape(B * T, H * W, D)
        attn_out, _ = self.attn_spatial(norm_x, norm_x, norm_x)
        attn_out = attn_out.reshape(B, T, H * W, D)
        # 残差连接 + gate scaling (alpha)
        x = x + gate_msa[:, None, None, :] * attn_out.reshape(B, N, D)
        
        # ---- 时间注意力 ----
        # 重排为 (B, H*W, T, D),对 T 维度做自注意力
        x_temp = x.reshape(B, T, H * W, D).transpose(1, 2)  # (B, H*W, T, D)
        # 同样应用 AdaLN (复用相同的 shift/scale/gate 以简化)
        norm_x_t = self.norm1(x_temp) * (1 + scale_msa[:, None, None, :]) + \
                   shift_msa[:, None, None, :]
        norm_x_t = norm_x_t.reshape(B * H * W, T, D)
        attn_out_t, _ = self.attn_temporal(norm_x_t, norm_x_t, norm_x_t)
        attn_out_t = attn_out_t.reshape(B, H * W, T, D).transpose(1, 2)  # (B, T, H*W, D)
        x = x + gate_msa[:, None, None, :] * attn_out_t.reshape(B, N, D)
        
        # ---- FFN ----
        # 重排回 (B, N, D)
        norm_x_ffn = self.norm2(x) * (1 + scale_mlp[:, None, :]) + \
                     shift_mlp[:, None, :]
        x = x + gate_mlp[:, None, :] * self.mlp(norm_x_ffn)
        
        return x


class SimpleVideoDiT(nn.Module):
    """
    简化版视频 DiT 模型
    对应完整的 epsilon_theta(z_t, t, c) 网络
    """
    def __init__(self, in_channels=4, patch_size=(2, 4, 4), 
                 embed_dim=768, depth=12, num_heads=12):
        super().__init__()
        self.patch_embed = PatchEmbed3D(in_channels, patch_size, embed_dim)
        self.t_embedder = TimestepEmbedder(embed_dim, embed_dim)
        
        # 假设文本条件已通过外部 CLIP/T5 编码为 (B, D) 的向量
        # 这里简化处理,将文本 embedding 维度设为 embed_dim
        self.text_proj = nn.Linear(768, embed_dim)  # 假设文本Encoder 输出 768 维
        
        # DiT blocks
        self.blocks = nn.ModuleList([
            DiTBlock(embed_dim, num_heads) for _ in range(depth)
        ])
        
        self.final_norm = nn.LayerNorm(embed_dim)
        # 输出投影: 将 token 映射回 patch 的通道维度
        self.final_proj = nn.Linear(embed_dim, 
                                     in_channels * patch_size[0] * patch_size[1] * patch_size[2])
        
        self.patch_size = patch_size

    def unpatchify(self, x, T, H, W):
        """将 patch tokens 恢复为 4D latent 张量"""
        pt, ph, pw = self.patch_size
        x = x.reshape(x.shape[0], T, H, W, -1)
        x = x.permute(0, 4, 1, 2, 3)  # (B, C*pt*ph*pw, T, H, W)
        # 通过 pixel shuffle 式重排恢复原始维度 (B, C, T*pt, H*ph, W*pw)
        C_out = x.shape[1]
        x = x.reshape(x.shape[0], -1, pt, ph, pw, T, H, W)
        x = x.permute(0, 1, 5, 2, 6, 3, 7, 4)
        x = x.reshape(x.shape[0], -1, T * pt, H * ph, W * pw)
        return x

    def forward(self, z_t, t, text_emb, T_patches, H_patches, W_patches):
        """
        z_t: (B, C, T, H, W) 加噪后的 latent
        t: (B,) 扩散时间步
        text_emb: (B, text_dim) 文本条件 embedding
        T_patches, H_patches, W_patches: patch 网格尺寸
        """
        # 1. Patchify
        x = self.patch_embed(z_t)  # (B, N, D)
        
        # 2. 条件 embedding 融合
        t_emb = self.t_embedder(t)  # (B, D)
        c_emb = self.text_proj(text_emb)  # (B, D)
        c = t_emb + c_emb  # 简单相加融合
        
        # 3. 通过 DiT blocks
        for block in self.blocks:
            x = block(x, c, T_patches, H_patches, W_patches)
        
        # 4. 输出投影和 unpatchify
        x = self.final_norm(x)
        x = self.final_proj(x)  # (B, N, C*pt*ph*pw)
        epsilon_pred = self.unpatchify(x, T_patches, H_patches, W_patches)
        
        return epsilon_pred


def video_dit_train_step(model, vae, text_encoder, 
                         videos, prompts, optimizer, device):
    """
    单次视频 DiT 训练步
    对应数学公式: L = E[||epsilon - epsilon_theta(z_t, t, c)||^2]
    """
    model.train()
    B = videos.shape[0]
    
    # Step 1: VAE 编码到 latent 空间
    # 对应: z_0 = E(x)
    with torch.no_grad():
        z_0 = vae.encode(videos).latent_dist.sample()
        z_0 = z_0 * 0.18215  # Stable Diffusion 的标准缩放因子
        
        # 文本编码 (简化,实际使用 T5/CLIP)
        text_emb = text_encoder(prompts)  # (B, text_dim)
    
    # Step 2: 前向加噪
    # 对应: z_t = sqrt(alpha_bar_t) * z_0 + sqrt(1 - alpha_bar_t) * epsilon
    t = torch.randint(0, 1000, (B,), device=device).long()
    noise = torch.randn_like(z_0)
    
    # 简化的线性噪声调度
    alpha_bar = 1 - (t.float() / 1000.0).view(B, 1, 1, 1, 1)
    alpha_bar = alpha_bar.to(device)
    
    z_t = torch.sqrt(alpha_bar) * z_0 + torch.sqrt(1 - alpha_bar) * noise
    
    # Step 3: 模型预测噪声
    # 计算 patch 网格尺寸
    T, H, W = z_0.shape[2], z_0.shape[3], z_0.shape[4]
    pt, ph, pw = model.patch_size
    T_p, H_p, W_p = T // pt, H // ph, W // pw
    
    epsilon_pred = model(z_t, t, text_emb, T_p, H_p, W_p)
    
    # Step 4: 计算 MSE Loss
    # 对应: L = ||epsilon - epsilon_pred||^2
    loss = F.mse_loss(epsilon_pred, noise)
    
    # Step 5: 反向传播
    optimizer.zero_grad()
    loss.backward()
    torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
    optimizer.step()
    
    return loss.item()
```

> **代码与理论的对应关系**: 
> - `PatchEmbed3D` 严格实现了时空 Patchify,用 3D 卷积高效地提取不重叠 patch 并投影到 embedding 空间. 
> - `TimestepEmbedder` 实现了 DDPM 中的时间步编码,使用正弦位置编码保证时间步的相对关系可被模型感知. 
> - `DiTBlock` 中的 `adaLN_modulation` 实现了 AdaLN-Zero,生成 6 个调制参数(scale_msa, shift_msa, gate_msa, scale_mlp, shift_mlp, gate_mlp). 注意最后一层被显式初始化为零,对应论文中的 Zero Initialization. 
> - 分解时空注意力通过 `reshape` 和 `transpose` 操作实现,空间注意力在 $(B \cdot T, H \cdot W, D)$ 上计算,时间注意力在 $(B \cdot H \cdot W, T, D)$ 上计算. 
> - `video_dit_train_step` 完整对应了扩散模型的训练目标 $\mathcal{L} = \mathbb{E}[\|\epsilon - \epsilon_\theta(z_t, t, c)\|^2]$. 

## 7. 局限性与边界条件 (Limitations & Boundary Conditions)

世界上没有包治百病的算法. 尽管 DiT 架构在视频生成领域取得了革命性突破,但它仍然面临着一系列深刻的工程挑战和理论边界. 理解这些局限性,不仅有助于我们更客观地评估当前技术,也能为未来的研究方向提供指引. 

### 7.1 计算成本: 民主化的障碍

视频 DiT 最非常明显的局限性是**天文数字般的计算成本**. 让我们做一个冷酷的数量级估算. 

**训练成本**: 一个 Sora 级别的视频 DiT 模型,参数量假设为 30B,训练数据为 500 万小时视频,训练轮数为数个 epoch. 在 A100/H100 级别 GPU 上,这样的训练需要数千块 GPU 运行数月. 按照当前云算力价格(每 H100 每小时约 2-4 美元),单次训练的成本在 **数千万到数亿美元** 级别. 

这使得视频 DiT 成为了少数拥有超大规模算力资源的公司(OpenAI、Google、字节跳动等)的专属游戏. 学术界和小型创业团队几乎不可能从零训练一个 Sora 级别的模型. 这种"算力壁垒"严重制约了技术的民主化和创新速度. 

**推理成本**: 即使使用预训练模型,生成视频的成本也高得惊人. 生成一段 5 秒、1080p 的视频需要数百到上千步的去噪迭代,每步都需要对数十亿参数的网络进行前向传播. 在单块 A100 上,生成这样一段视频可能需要数分钟甚至更长时间. 这与"实时生成"的目标相差甚远. 

**根本原因**: Transformer 的自注意力计算复杂度为 $O(N^2)$,其中 $N$ 是时空 patch 数量. 视频天然具有极高的 $N$(时空维度的乘积),使得注意力的计算量随着视频长度和分辨率的增加呈平方级增长. 即使采用分解注意力,$O(TN^2 + TN^2)$ 的复杂度仍然远高于图像生成的 $O(N^2)$. 

### 7.2 时序一致性: 长视频的"阿喀琉斯之踵"

虽然 DiT 的全局注意力在理论上可以建模任意距离的时空依赖,但在实践中,**长视频的时序一致性仍然是一个未完全解决的问题**. 

**闪烁与变形**: 在生成的视频中,物体的外观属性(颜色、纹理、细节)可能在短时间内发生微妙但可见的变化. 人物的面部特征可能帧帧漂移,衣服的图案可能逐渐变形,场景的光照可能缓慢但持续地偏移. 这些问题在短片段(< 5 秒)中可能不易察觉,但在长视频(> 15 秒)中会变得非常明显. 

**根本原因分析**: 从数学上看,扩散模型的去噪过程是一个随机过程. 每一步去噪都引入了一定的随机性(即使使用确定性采样器,早期步骤的微小差异也会在后续被放大). 对于长视频,模型需要在数百甚至数千个时间步上保持一致的决策,这种累积误差使得完美的一致性极其困难. 

从架构上看,虽然自注意力在理论上具有全局感受野,但**注意力的有效范围受限于训练数据的分布**. 如果训练数据中的视频 mostly 是短片段,模型就没有学到如何维持超长期的时序一致性. 此外,位置编码对超长序列的外推能力也存在理论限制. 

### 7.3 物理规律理解: 统计相关性 vs 因果律

正如我们在 4.5.2 节中讨论的,Sora 和类似的视频 DiT 模型并不是真正的"物理引擎"——它们学习的是像素层面的统计相关性,而不是物理定律的因果表示. 

**失效场景**: 
- **流体动力学**: 水的流动、烟雾的扩散、火焰的跳动,这些复杂流体现象在统计上很难被精确建模. 模型可以生成"看起来像水"的视频,但水流的速度场可能不遵守纳维-斯托克斯方程. 

- **刚体碰撞**: 物体碰撞后的反弹角度和速度可能不符合动量守恒. 一个球以 45 度角撞击墙壁后,可能以任意角度弹开. 

- **材料断裂**: 玻璃破碎、布料撕裂等脆性/塑性变形过程具有高度的随机性和路径依赖性,统计模型难以捕捉这种多样性. 

- **重力一致性**: 物体下落的加速度可能不一致,或者不同物体的重力感不同. 

**物理根因**: 扩散模型的训练目标是像素层面的均方误差(或类似的分布匹配目标). 这个目标函数**不区分"看起来正确"和"物理上正确"**. 如果训练数据中有足够多的"杯子掉落"视频,模型可以学到统计平均的下落轨迹; 但如果要求模型在任意初始条件下(如不同高度、不同角度、不同材质)都严格遵守物理定律,仅靠像素层面的损失函数是不够的. 

这引出了一个更深层次的开放问题: **如何在生成模型中注入物理约束？** 目前的方向包括: 在损失函数中加入物理一致性正则项、使用神经辐射场(NeRF)等显式 3D 表示作为中间层、或者将传统物理引擎与生成模型相结合. 

### 7.4 可控性: 从"文本"到"精确控制"的鸿沟

文本到视频生成(Text-to-Video, T2V)虽然已经展示了惊人的视觉效果,但**可控性仍然是一个巨大的挑战**. 

**文本的模糊性**: 自然语言本身就是模糊的. "一只狗在公园里奔跑"——这只狗是什么品种？什么颜色？公园里有树木还是花坛？奔跑的速度是多快？镜头是跟随狗移动还是固定机位？文本条件无法精确指定这些视觉细节,导致生成的结果具有高度的随机性. 

**时间维度的控制困难**: 在图像生成中,用户可以通过 ControlNet、Inpainting 等技术对空间布局进行精确控制. 但在视频中,控制需求增加了一个维度: **时间**. 用户可能希望精确控制"狗在第 3 秒跳起来"、"镜头在第 5 秒开始 zoom in"、"背景中的鸟在第 8 秒飞走". 目前的文本条件无法表达这种精细的时间控制. 

**根本原因**: 视频 DiT 的条件注入主要通过 AdaLN 和 cross-attention 实现. 这些机制将全局条件信息(文本 embedding)以一种"软"的方式注入网络,影响所有位置的去噪方向. 但这种方式缺乏**空间-时间上的精确定位能力**. 模型知道"要有狗",但不知道"狗应该在这里、在这个时间、以这个姿态出现". 

解决方向包括: 
- **结构化条件**: 使用布局(layout)、轨迹(trajectory)、骨骼关键点(skeleton)等结构化信号作为额外条件; 

- **视频编辑**: 不从头生成,而是对已有视频进行编辑(Video Editing),保留原始视频的结构信息; 

- **流匹配与更精细的控制机制**: 如 Flow Matching 框架配合更灵活的条件注入方式. 

### 7.5 训练数据的偏见与伦理边界

视频 DiT 的训练需要海量的视频数据,这带来了一系列非技术性的边界条件. 

**数据偏见**: 训练数据来自互联网,不可避免地包含社会文化偏见. 模型可能学习并放大了这些偏见——比如特定职业与特定性别的刻板关联、特定文化背景的过度代表或代表不足. 

**版权与隐私**: 训练数据中可能包含受版权保护的内容(电影片段、音乐视频)和个人隐私信息(未经同意的面部图像). 模型可能"记忆"这些内容并在生成时复现,引发法律和伦理争议. 

**深度伪造风险**: 高质量视频生成技术的普及,使得制作以假乱真的深度伪造视频(Deepfake)变得前所未有的容易. 这带来了严重的信息安全和信任危机. 

这些边界条件不是算法本身的数学局限,但它们同样制约着技术的部署和社会接受度. 解决这些问题需要在数据筛选、模型对齐(Alignment)、水印技术、检测技术等方面进行大量的工程和社会学投入. 

## 8. 演进与承上启下 (Evolution & Segue)

视频 DiT 架构已经展示了惊人的能力,但上述局限性也清晰地指向了未来的演进方向. 本节将梳理当前最前沿的技术趋势,并自然引出下一阶段的探索主题. 

### 8.1 世界模型(World Model)与视频生成的融合

视频生成的终极愿景,不只是"生成好看的视频",而是构建一个能够理解、预测和交互的**世界模型(World Model)** . 

世界模型的核心思想是: 智能体(Agent)应该拥有一个内部的环境模拟器,能够在脑中"想象"不同行动的后果,从而进行规划和决策. 视频生成模型天然具备这种潜力——它们已经在 latent 空间中学习了丰富的物理和视觉先验. 

**当前趋势**: 
- **交互式视频生成**: 模型不仅接收文本条件,还接收动作指令(如"将相机向左移动"、"让球向右滚动"),并生成对应的视频. 这使得视频生成从"一次性生成"向"可交互模拟"演进. 

- **3D 一致性生成**: 通过结合 NeRF(Neural Radiance Fields)或 3D Gaussian Splatting,先生成具有 3D 几何一致性的场景表示,再渲染为视频. 这从根本上解决了 2D 视频生成中的视角一致性问题. 

- **物理信息注入**: 在训练或推理阶段显式地引入物理约束(如通过可微分物理引擎、物理一致性损失函数),使生成的视频不仅"看起来像真的",而且"遵守物理定律". 

世界模型与视频生成的融合,可能在未来 3-5 年内催生出新一代 AI 系统: 它们不仅能生成视频,还能在虚拟世界中进行推理、规划和决策——这是通向通用人工智能(AGI)的关键一步. 

### 8.2 实时视频生成: 蒸馏加速与一致性模型

当前视频 DiT 的推理速度远不能满足实时应用的需求. 解决这个问题的主流方向有两个: 

**蒸馏(Distillation)** : 通过知识蒸馏,将大模型的生成能力迁移到更小、更快的模型中. 例如,使用一个大型教师 DiT 来指导一个小型学生模型的训练,使学生模型在更少的时间步内达到相近的生成质量. 最新进展如 **SDXL-Turbo**、**LCM(Latent Consistency Models)** 已经展示了在 1-4 步内生成高质量图像的可能性,同样的思路正在向视频领域扩展. 

**一致性模型(Consistency Models)** : Consistency Models 是扩散模型的一个重大理论突破. 其核心思想是: 学习一个函数 $f$,使得对于任意时间步 $t$ 的加噪数据 $x_t$,$f(x_t, t)$ 都直接输出去噪后的最终结果 $x_0$. 这样,生成只需要**单步前向传播**,而不需要数百步的迭代去噪. 虽然单步一致性模型的质量目前仍略逊于多步扩散模型,但其速度优势是数量级的,代表了实时生成的终极方向. 

在视频领域,**视频一致性模型(Video Consistency Models)** 和 **流匹配(Flow Matching)** 框架正在被积极探索. 流匹配将扩散过程重新参数化为概率流 ODE,使得可以使用更高效的数值积分方法,在更少的步骤内达到相同的生成质量. 

### 8.3 承上启下: Agentic 视频工作流

从应用层面看,视频生成技术正在从"单工具"向"工作流"演进. 

**Agentic 视频工作流** 是指: AI Agent 不再只是执行单一的视频生成指令,而是能够自主规划、调用多种工具、迭代优化,最终完成复杂的视频制作任务. 例如: 

1. **剧本生成**: Agent 根据主题生成完整的分镜脚本; 

2. **素材生成**: 调用视频 DiT 生成每个分镜的 raw 视频; 

3. **质量控制**: 自动检测生成视频中的瑕疵(闪烁、变形、物理不一致),标记需要重生成的片段; 

4. **后期编辑**: 调用视频编辑工具进行剪辑、调色、配音、加字幕; 

5. **迭代优化**: 根据用户反馈调整提示词和参数,重新生成不满意的部分. 

这种 Agentic 工作流将视频生成从"一次性抽奖"(生成一次,好坏听天由命)转变为"可迭代的、可控的生产流程",是视频生成技术真正落地为生产力工具的关键. 

在下一节中,我们将深入探讨**Agentic 视频工作流的架构设计**,包括多 Agent 协作框架、工具调用接口、以及如何将视频生成模型集成到更大的 AI 应用生态中. 

## 9. 总结与参考文献 (References)

### 核心要点总结

1. **视频生成的三重诅咒**: 时序一致性、计算量爆炸、物理规律理解,这三大挑战使得视频生成远比图像生成困难. 

2. **DiT 架构的核心创新**: 用 Transformer 的全局自注意力替代 U-Net 的局部卷积,通过时空 Patchify 将视频统一表示为 token 序列,借助 AdaLN-Zero 实现高效的条件注入. DiT 已经成为视频生成领域的事实标准. 

3. **分解时空注意力的效率革命**: 将联合注意力的 $O((THW)^2)$ 复杂度降低到 $O(T(HW)^2 + HW \cdot T^2)$,在规模化场景下节省约 15 倍计算量,使得高分辨率长视频生成成为可能. 

4. **规模效应(Scaling Law)** : Sora 证明视频生成同样遵循 Scaling Law. 数十亿参数 + 数百万小时训练数据带来的不仅是量的提升,更是质的飞跃(3D 一致性、物理真实性、长期时序稳定性). 

5. **当前局限与未来方向**: 计算成本、时序一致性、物理精确性和可控性仍是主要瓶颈. 未来演进方向包括世界模型融合、实时生成(蒸馏/一致性模型)、以及 Agentic 视频工作流. 

### 参考文献

1. **Ho, J., Jain, A., & Abbeel, P.** (2020). Denoising Diffusion Probabilistic Models. *NeurIPS 2020*. https://arxiv.org/abs/2006.11239
   - 扩散模型的奠基性论文,提出了 DDPM 的前向/反向过程和噪声预测训练目标. 

2. **Rombach, R., Blattmann, A., Lorenz, D., Esser, P., & Ommer, B.** (2022). High-Resolution Image Synthesis with Latent Diffusion Models. *CVPR 2022*. https://arxiv.org/abs/2112.10752
   - 提出了 Latent Diffusion Model(LDM),将扩散过程从像素空间转移到 latent 空间,奠定了 Stable Diffusion 的架构基础. 

3. **Peebles, W., & Xie, S.** (2023). Scalable Diffusion Models with Transformers. *ICCV 2023*. https://arxiv.org/abs/2212.09748
   - DiT 的原始论文,证明了 Transformer 可以替代 U-Net 作为扩散模型的 backbone,并展示了优异的扩展性. 

4. **OpenAI.** (2024). Video generation models as world simulators. *Sora Technical Report*. https://openai.com/research/video-generation-models-as-world-simulators
   - Sora 的技术报告,揭示了时空 patch 压缩、统一视觉表示和 Scaling Law 在视频生成中的关键作用. 

5. **Ho, J., Salimans, T., Gritsenko, A., Chan, W., Norouzi, M., & Fleet, D. J.** (2022). Video Diffusion Models. *NeurIPS 2022 Workshop*. https://arxiv.org/abs/2204.03458
   - 早期将扩散模型扩展到视频的重要工作,提出了分解时空注意力的核心思想. 

6. **Singer, U., Polyak, A., Hayes, T., Yin, X., An, J., Zhang, S., ... & Parikh, D.** (2023). Make-A-Video: Text-to-Video Generation without Text-Video Data. *ICLR 2023*. https://arxiv.org/abs/2209.14792
   - Meta 的早期视频生成工作,展示了利用图像扩散模型扩展到时序维度的可行性. 

7. **Blattmann, A., Rombach, R., Ling, H., Dockhorn, T., Kim, S. W., Fidler, S., & Kreis, K.** (2023). Align your Latents: High-Resolution Video Synthesis with Latent Diffusion Models. *CVPR 2023*. https://arxiv.org/abs/2304.08818
   - Video LDM 论文,系统地将 LDM 框架扩展到视频生成,提出了高效的时间层插入策略. 

8. **Song, Y., Dhariwal, P., Chen, M., & Sutskever, I.** (2023). Consistency Models. *ICML 2023*. https://arxiv.org/abs/2303.01469
   - 一致性模型的原始论文,提出了单步生成的理论框架,是实时视频生成的关键方向. 

9. **Lipman, Y., Chen, R. T. Q., Ben-Hamu, H., Nickel, M., & Le, M.** (2023). Flow Matching for Generative Modeling. *ICLR 2023*. https://arxiv.org/abs/2210.02747
   - 流匹配框架,为扩散模型提供了更简洁的数学表述和更高效的采样方法. 

10. **Zheng, Y., Zhang, C., Zhang, Z., Lin, S., & Li, C.** (2024). CogVideoX: Text-to-Video Diffusion Models with An Expert Transformer. https://arxiv.org/abs/2408.06072
    - 开源视频 DiT 模型的重要代表,展示了在开源社区中复现 Sora 级别能力的技术路径. 
