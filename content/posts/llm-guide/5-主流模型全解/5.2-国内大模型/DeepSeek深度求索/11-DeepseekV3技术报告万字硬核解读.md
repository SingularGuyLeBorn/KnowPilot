---
title: "11 · Deepseek v3 技术报告万字硬核解读"
date: 2026-05-11
tags: []
---

# 11 Deepseek v3 技术报告万字硬核解读

**作者: 学车辆算法工程师**

**原文: **[https://zhuanlan.zhihu.com/p/16323685381](https://zhuanlan.zhihu.com/p/16323685381)

## 1. 模型基本性能

![](https://www.yuque.com/attachments/yuque/0/2025/j/42982692/1754091351148-0c74c0d2-9892-450f-adf1-369d70d6f8e1.j)

deepseek 数学与代码能力

## 2. 模型架构层(无本质创新，这里引用讲解为主)

![](https://www.yuque.com/attachments/yuque/0/2025/j/42982692/1754091351221-e32c6a99-efd5-40c8-a6be-8f087ac31b6b.j)

deepseekv3 架构图

### 2.1 Config

### 2.2 分词

采用 **BBPE 技术** 
[zhuanlan.zhihu.com](https://zhuanlan.zhihu.com/p/3329211354?utm_psn=1857473827581349889)

### 2.3 MLA

关于MLA我在另外一篇文章中有详细的解读

[【薪火相传】MiniCPM的三代注意力演进 - 知乎](https://zhuanlan.zhihu.com/p/1319006717)

### 2.4 Share MOE

1. 专家头包括 **Share 专家** 和 **Router 专家**。

2. **Share 专家** 是一直激活的，即输入的 token 都会被 Share 专家头计算。

3. **Router 专家头** 会先和上图中的 u_{t} 计算亲和度(代码中直接用一个 Linear 层进行投影)，选择 top-k 各专家进行推理。(代码中推理计算 top-k 时，会先将 N 各专家进行分组为 n_groups，将每个组中 top-2 各专家的亲和力加起来，算出亲和力最高的 top_k_group 个组，然后在这些组里选 top-k 个专家)。4. 最终将所有的 Share 输出和 Router 专家进行亲和度加权相加，得到 MoE 层的输出。

![](https://www.yuque.com/attachments/yuque/0/2025/j/42982692/1754091351292-c80cbcff-6240-478d-872a-d1dbb0b71b07.j)

MOE前向DP与PP前向

---

## 3. 训练方法创新

### 3.1 MTP

![](https://www.yuque.com/attachments/yuque/0/2025/j/42982692/1754091351396-0070317b-9c5d-41eb-84de-1c4f5f17a0a1.j)

多token预测

MTP 代码复现

### 3.2 专家负载均衡

### 3.2.1 辅助函数

### 3.2.2 本文方案

1. 对于每一个专家的亲和度(值越高越容易激活)加上一个偏置 b，如下图所示：

![](https://www.yuque.com/attachments/yuque/0/2025/j/42982692/1754091351462-bd7b5512-91b2-4af1-a491-7d3e0f804de4.j)

亲和度计算

1. 训练过程中，记录每个专家的负载率，通过调整偏置 b 进行循环，最终保证专家负载率平衡。

### 3.3 训练成本

在同等模型总参数量级下，训练成本降低一个量级。主要来源于以下几点：

**3.1 混合精度**：

- FP8 训练与 BF16 相比，理论计算量与通信量降低一倍。

**3.2 MoE 层**：

以下对同参数量的MLP和MOE进行计算量和通信量的对比

**3.2.1原始 MLP 的计算量**

- **MLP 结构**：- 两个矩阵：- 第一个矩阵：[h, 2.5h]。- 第二个矩阵：[2.5h, h]。- 每个 token 向量的计算量为：

计算量=\(h×2.5h+2.5h×h=5h^2\) 
**3.2.2 MoE 的计算量**

- **MoE 结构**：- 假设有 n 各专家，每次选用 k 个专家。- 每个专家的两个矩阵：- 第一个矩阵： \([h/n^{1/2},2.5*h/n^{1/2}] 。\)- 第二个矩阵： \([2.5*h/n^{1/2},h/n^{1/2}]\)- 每个 token 每个专家的计算量为：

计算量=\(h/n^{1/2}×2.5h/n^{1/2}+2.5h/n^{1/2}×h/n^{1/2}=2.5h^2/n+2.5h^2/n=5h^2/n\)

- k 各专家的平均每 token 计算量为：

计算量=\(k×5h^2/n=5kh^2/n\) 
**3.2.3 MoE 与 MLP 的计算量对比**

- **MLP 计算量**：

\(MLP 计算量=5h^2\)

- **MoE 计算量**：

\(MoE 计算量=5kh^2/n\)

- **计算量比例**：

\(比例=MoE 计算量/MLP 计算量=5kh^2/5h^2/n=k/n\)

- 由于 \(k≪n\)，MoE 的计算量大大下降。

**3.2.4****分布式训练的通信量**

- **MLP 通信量**：- MLP 需要传输所有参数，通信量为 1(假设为单位通信量)。

- **MoE 通信量**：- MoE 每次仅选择 k 个专家，因此通信量下降到：- 通信量=k/n

**3.2.5****总结**

- **MLP**：- 计算量： \(5h^2\)- 通信量：1- **MoE**：- 计算量：\(5kh^2/n\)- 通信量：\(k/n\)

- **优势**：- MoE 通过选择部分专家(k 个)进行计算，显著降低了计算量和通信量。- 由于 k≪n，MoE 的计算量和通信量都大大下降。

**3.3.Dual 训练框架**：

- 精心设计的框架可以在通信与计算并行，减少了等待时间，并且降低了气泡占比。

### 3.4 **3.4 YARN 长文本拓展两阶段课程学习(非原创)** ：

- YARN 是目前最常见的长文本拓展技术，仅需 0.2% 的预训练量可以很好拓展文本长度。- YARN 是 NTK-aware 的一种进阶形式。- 具体是第一阶段将文本长度从 4k 拓展到 32k，第二阶段从 32k 拓展到 128k。

### 3.5 **3.5. 强化学习**

Reward Model

1. 如果是代码、数学、agent等等，使用规则和结果验证的方法获取Reward2. 如果是自由形式但是有明确答案的任务，Reward Model 提供与正式答案是否相同的反馈3. 如果是例如写作等等没有明确结果的任务，我们使用Reward model进行输入和结果的打分4. 奖励值应该分步给予，而不是只对FInal answer5. 从deep seek v3的Checkpoint初始化训练

RL

1. 使用GRPO算法进行在线-离线强化学习，丢弃了critc模型，减少显存并且加速

- 关于LLM的Critic一直困扰笔者，原因是Critic是用来估计Value的，也就是训练Critic的loss一直是用Critic的预测值和Value的mse

\(Critic_{-loss}=Mse(V^{\pi}(\Theta)-Value)\)

- 然而Value是由reward累加获得的，公式如下

\(V^\pi(s) = \mathbb{E}_\pi \left[ \sum_{t=0}^\infty \gamma^t R_{t+1} \mid S_0 = s \right]\)

- R在LLM的PPO中又是由Reward model计算出来的

\(R_{(t+1)}=Rw(t+1)\)

\(Critic_{-loss} = \text{Mse}(V^{\pi}(\Theta) - \text{Value}) = \mathbb{E}_\pi \left[ \text{Mse}\big(V^{\pi}(\Theta) - \sum_{t=0}^\infty \gamma^t Rw(t+1) \mid S_0 = s \big) \right]\)

- 因此Critic即在拟合Reward Model的期望值，笔者理解使用Critic Model的唯一作用，Reward Model是用来模拟环境反馈，一般难以得到很好的泛化，所以使用Critic进行拟合能够减少方差。- 2以下是GRPO使用组内相对优势进行优化的loss公式

![](https://www.yuque.com/attachments/yuque/0/2025/j/42982692/1754091351523-74c2d5a0-8163-4a25-b41d-9f1bd0f7c030.j)

GRPO损失函数

- 3以上GRPO不再计算Critic估计的优势函数，而是优化每个组_(每一个组代表ACTOR同输入下，不同的输出采样)_内的reward

1. 以下每次采样获得的优势，是该次采样的奖励减去组内奖励均值并且处以方差，即标准化过程2. 标准化过程的目的是：不同组内标准化有一个统一量纲:

- 举例如下第一组(代码任务)分数，5，4，3。第二组(作文任务)分数1，2，3。如果不做标准化，所有优势为正，更加重要的是，由于两组的整体均值为3，此时将导致第一组所有样本被奖励，第二组所有样本被惩罚。这种情况下完全不会使得模型变好。

![](https://www.yuque.com/attachments/yuque/0/2025/j/42982692/1754091351590-89610ce5-688a-4f65-a5b7-b1aec46581b4.j)

GRPO的优势函数计算

- 4使用了多种提示词进行强化学习，减少了对SFT数据的依赖。(个人认为需要一个[泛化能力](https://zhida.zhihu.com/search?content_id=252286914&content_type=Article&match_order=1&q=%E6%B3%9B%E5%8C%96%E8%83%BD%E5%8A%9B&zhida_source=entity)优秀的reward model)

---

## 4. 分布式训练

### 4.1 FP8 [混合精度训练](https://zhida.zhihu.com/search?content_id=252286914&content_type=Article&match_order=1&q=%E6%B7%B7%E5%90%88%E7%B2%BE%E5%BA%A6%E8%AE%AD%E7%BB%83&zhida_source=entity)

![](https://www.yuque.com/attachments/yuque/0/2025/j/42982692/1754091351652-07aa9359-8ae0-4bb2-b80d-da58a1af9f52.j)

前、后向传播时的流程及其混合精度

FP8 的表示精度都要优于 INT8。

### 4.2 **4.1.1 细粒度量化方法**

本文中 BF16、FP32 向 FP8 转换采用分组量化，Activation 采用 per-token per-channel [1, 128]，Weight 采用 per-tile [128, 128]。

- 被量化向量：Weight: [7168, 4/3 * 7168]- Per-tensor: [7168, 4/3 * 7168] ->共享一个 SCALE, BIAS(最粗粒度)- Per-token: [1, 7168 * 4/3] -> 共享一个SCALE, BIAS(粒度与 [per-channel](https://zhida.zhihu.com/search?content_id=252286914&content_type=Article&match_order=2&q=per-channel&zhida_source=entity)类似，适合weight)- Per-channel: [7168，1] -> 共享一个SCALE, BIAS(粒度与 per-token 类似，适合activation)- Per-tile: [128, 128] -> 共享一个SCALE, BIAS(粒度较细，精度较高)- Per-token per-channel: -> 共享一个[1, 128](粒度最细，128 个值量化一次)

![](https://www.yuque.com/attachments/yuque/0/2025/j/42982692/1754091351721-ceec02a7-c2fa-40d8-a1db-65abe1a80585.j)

deepseek 量化分组示意图

![](https://www.yuque.com/attachments/yuque/0/2025/j/42982692/1754091351782-799b8d53-fd4d-47bd-9fad-11f6be2ea96b.j)

原文量化图

- fp8的优势在于计算量与显存降低一倍

### 4.1.2 fp8精度下溢问题：

比如A(10000，4000)*B(4000，10000)，会得到一个C矩阵(10000，10000)，每个值都要进行4000次乘法与加法，这种情况很容易造成精度下溢，因为要对齐指数位，所以尾数位要后移。举例如下：

### 4.1.3 fp8大矩阵MMA算子精度下溢解决方案：

- 报告原文：

为了解决这一问题，我们采取了向[CUDA](https://zhida.zhihu.com/search?content_id=252286914&content_type=Article&match_order=1&q=CUDA&zhida_source=entity) Core升级以提高精度的策略 (Thakkar et al.，[2023年](https://link.zhihu.com/?target=https%3A//arxiv.org/html/2412.19437v1%23bib.bib89))。 该过程如图[7](https://link.zhihu.com/?target=https%3A//arxiv.org/html/2412.19437v1%23S3.F7)(B)所示。 具体地说，在[张量核](https://zhida.zhihu.com/search?content_id=252286914&content_type=Article&match_order=1&q=%E5%BC%A0%E9%87%8F%E6%A0%B8&zhida_source=entity)上执行MMA(矩阵乘法累加)期间，使用有限的位宽累加中间结果。 一旦达到间隔 NC ，这些部分结果将被复制到CUDA内核上的FP32寄存器，在那里执行全精度FP32累加。 如前所述，我们的细粒度量化沿内部维度K沿着应用每组 [缩放因子](https://zhida.zhihu.com/search?content_id=252286914&content_type=Article&match_order=1&q=%E7%BC%A9%E6%94%BE%E5%9B%A0%E5%AD%90&zhida_source=entity)。 这些缩放因子可以在CUDA内核上高效地相乘，作为具有最小附加计算成本的反量化过程。过程如下所示：

![](https://www.yuque.com/attachments/yuque/0/2025/j/42982692/1754091351854-194ebe73-73f7-42f0-a612-38547b53f267.j)

deepseek v3原图

- 个人理解：

![](https://www.yuque.com/attachments/yuque/0/2025/j/42982692/1754091351934-bae49053-64ac-4fee-a81b-88906e6d29bf.j)

fp8MMA防下溢算子及反量化过程

上图中右下角解读： 
黄色代表Tensor core 算子：速度快，并行计算，但是fp8累加存在精度下溢 
绿色代表Cuda core 算子：速度较慢，但是fp32的精度高，反量化和累加在这里做。 
总的来说：量化后的分块的activation和weight在tensor core中进行MMA计算，得到的小块放到cuda core里面做累加以及反量化到fp32

### 4.1.4 FP8 大矩阵 MMA防止精度下溢 操作步骤

1. **做 MMA 操作时**：

- 例如，fp8_A[1000, 2560] * fp_W[2560, 200]，NC(量化数)为 128。

**2.做**[矩阵分解](https://zhida.zhihu.com/search?content_id=252286914&content_type=Article&match_order=1&q=%E7%9F%A9%E9%98%B5%E5%88%86%E8%A7%A3&zhida_source=entity)** ，遍例**：

- 每个 A 中的 [1, 128] 和 W 中的 [128, 128]，先使用 FP8 在 Tensor 核上算出结果 C[1, 128]。- 因为fp8大矩阵累加精度丢失，此时的分块后的矩阵仅仅累计 128 次，精度丢失较少。

**3.存储中间结果**：

- 将 C[1, 128] 放到寄存器。- 将 fp8_A 和 fp8_W 量化是对应的 scalingA 和 scalingW 也放到寄存器中。

**4.在 CUDA 核中进行反量化**：

- 计算： 
Dfp32=scalingA×scalingB×Cfp8

**5.循环重复步骤 2-4，直到矩阵分块完**：

- 通过矩阵分解，重复前面的步骤 2-4。- 最终将获得高精度的： 
finalanswer_{[i,j]}=∑Dfp32

### 4.2 DualPipe 框架

本部分参考了[deepseek预训练](https://zhuanlan.zhihu.com/p/15073492309)

分布式训练的目的其实就一个：节省更多的资源，资源包括计算时间、显存、机器数量。总的来说应该是节省总的GPUhours。

![](https://www.yuque.com/attachments/yuque/0/2025/j/42982692/1754091351999-142d50d1-2873-48f7-a3c3-ae435d33a0cd.j)

通讯与计算同步示意图

上下图中的F(前向计算)、B(梯度计算)、W(跟新权重)含意一致

![](https://www.yuque.com/attachments/yuque/0/2025/j/42982692/1754091352060-bd93c864-a243-4bb7-b58c-697ca6176213.j)

模型前向后向图

在模型训练中，主要计算量来源于 **ATTENTION-O(L²)** 和 **MLP-O(H²)** 。

由于分布式训练，前向和后向计算均需要通信，通信包括 **dispatch**(将输入分到各个 weight、expert)和 **combine**(将各个 weight、expert 的输出结果聚合)两部分。

在同一个 batch 中，通信和计算是交替进行的，这会导致效率低下。为此，DeepSeek V3 提出了双管路的方法，使得通信与计算能够并行

1. 模型训练中主要计算量来源于ATTENTION-O(L2)，MLP-O(H2)。2. 由于分布式训练，导致前向后向计算均需要通信，通信包括dispatch(将输入分到各个weight、expert)、combine(将各个weight、expert的输出结果聚合)两部分。3. 由于在同一个batch中，通信和计算是交替进行的，这将导致效率低下。为此deepseek v3 提出双管路的方法，使得通信与计算能够并行。

前向图如下：

![](https://www.yuque.com/attachments/yuque/0/2025/j/42982692/1754091352138-c8d18927-48aa-4cf1-b324-4250bc6f4a40.j)

前向传播

反向传播如下：

![](https://www.yuque.com/attachments/yuque/0/2025/j/42982692/1754091352230-9f0f055d-63a4-49bf-ac00-989babf12610.j)

反向传播

1. 总体来说：2. 双路的流水线并行

- DeepSeek V3 的双向 PP 调度中，还是 8 PP 为例：- device 0 上有 Layer 0 以及 Layer 7 的权重- device 1 上有 Layer 1 以及 Layer 6 的权重- device 7 上有 Layer 7 以及 Layer0 的权重- 相当于有 2 份相同的模型副本切分在不同的层，Forward 的顺序可以从 device 0 到 7，也可以从 device 7 到 0。- 这么设计的目的在于，下图中间部分存在极大范围的overlap backward&forward，由上面前向图和后向图可知，这样做可以减少时间。本质就是在每个device都有同时进行的第i层的前向和n-i层的反向传播，比如图中蓝色框中是4号数据在device4上的layer4进行前向传播，同时10号数据在device4的layer3上进行反向传播。

![](https://www.yuque.com/attachments/yuque/0/2025/j/42982692/1754091352304-9b6d777e-9086-4e0f-a585-94ea30f5b85d.j)

dual pipe解读

### 4.3 节省显存

### 4.3.1 Gradient Checkpoint

通过梯度Checkpoint技术，减少显存占用。

### 4.3.2 将模型参数的指数移动平均值保存到 CPU

将模型参数的指数移动平均值保存到 CPU，减少 GPU 显存占用。

### 4.4 MTP 的 Share 模块

将 embedding、lmhead 等共享模块放在一起 PP 的 GPU 上，减少通信和显存占用。

## 5. 数据准备

### 5.1 预训练数据准备

准备预训练数据。

### 5.2 DeepSeek R1 蒸馏

1. 目标是平衡对于复杂问题的推理能力与对于一般问题过度思考，Deepseek R1是类似于gpt4 o1这种方法训练的复杂推理模型，运用了test time scaling技术2. 将Deepseek R1的数据蒸馏出来，然后根据这些数据，考虑格式、长度等进行sft和RL获得[data model](https://zhida.zhihu.com/search?content_id=252286914&content_type=Article&match_order=1&q=data+model&zhida_source=entity)3. Data model 的sft数据构造为以下两类：4. 普通模式：`<问题, 原始响应>`5. R1模式`<系统提示词, 问题, R1 响应>`6. 使用在线强化学习高温度对Data model进行采样，经过以上两种格式的sft后，就算高温度会生成融合两种形式的响应7. 对第四步生成的数据进行强化学习，便能在普通温度下融合R1模式和普通模式，获得完整的Data model8. 对于Data model做了一个拒绝采样的方式进行生成最终模型的sft数据，作为语言模型，非推理模型平衡了输出长度和复杂度。

## 6. 适配[推理引擎](https://zhida.zhihu.com/search?content_id=252286914&content_type=Article&match_order=1&q=%E6%8E%A8%E7%90%86%E5%BC%95%E6%93%8E&zhida_source=entity)

### 6.1 Prefilling(Compute Bound)

### 6.2 并行策略

- **Attention 模块**：TP4，8DP，SP(4000 的训练长度需要 SP？)- **MoE 模块**：- 32路ep并行，专家总数256/专家并行数32=8，即每个gpu有8+1(冗余专家)个专家：- 这样配置的原因是专家数一定时，专家并行数小，每张卡上专家数就大，那每张卡上获得的token计算就多，由于同一个卡内的专家计算过程中相互独立，此时可以做并行计算，从而达到充分利用算力的目的。- 另外需要注意的是Moe是特殊的MLP，在prefilling阶段是可以并行的，输入向量[B,L,H],可以看成一次型输入B*L个token，每个token占了[H]的向量，然后向Moe层的专家去分配这些token。

- **节点间通信**：infinite band- **节点内通信**：[NVLink](https://zhida.zhihu.com/search?content_id=252286914&content_type=Article&match_order=1&q=NVLink&zhida_source=entity)

- **浅层的 MLP**：仅使用 1TP 并行，因为 TP 的通信量最大，TP1 为最少通信量- **两个微批次同时进行**：一个微批次进行计算，一个微批次进行通信，从而覆盖通信时间

### 6.3 专家平衡策略

- 每张 GPU 部署 8 个专家，并加上一个额外的高负载(冗余)专家- 统计每个专家的负载，每个 10 分钟重新设置冗余专家

### 6.2 [Decoding](https://zhida.zhihu.com/search?content_id=252286914&content_type=Article&match_order=1&q=Decoding&zhida_source=entity)(I/O Bound)

### 6.3 并行策略

- 40 各节点、320 个 GPU 组成- **Attention 模块**：TP4、SP、DP80- **MoE 部分**：EP320，即每个 GPU 有一个专家- **两个微批次同时进行**：一个微批次进行 attention 计算，一个微批次进行通信，从而覆盖通信时间