---
title: "02 · PagedAttention 与 vLLM: 虚拟内存思想终结 KV Cache 碎片"
date: 2026-05-16
tags: [PagedAttention, vLLM, KV Cache, 推理优化, 内存管理, Continuous Batching]
---

# 02 · PagedAttention 与 vLLM: 虚拟内存思想终结 KV Cache 碎片

## 1. 背景与核心痛点 (Background & Pain Points)

### 1.1 家谱定位: 从 Attention 到 KV Cache 的内存危机

Transformer 架构自 2017 年诞生以来, 其自注意力(Self-Attention)机制成为大语言模型(LLM)的核心. 在训练阶段, 我们可以通过一次前向传播并行计算整个序列的注意力权重, 因为所有 token 的 ground truth 都是已知的. 然而, 在**推理阶段(Inference)**, LLM 采用**自回归生成(Autoregressive Generation)** 模式模型每次只生成一个 token, 然后将这个新生成的 token 拼接到已生成序列的末尾, 再作为下一次输入的一部分, 如此循环往复, 直到生成结束符(EOS)或达到最大长度限制. 

这种逐 token 生成的模式, 带来了一个看似微小, 实则致命的工程问题: **每一次生成新 token 时, 模型都需要重新计算当前 token 与所有历史 token 之间的注意力分数**. 如果序列长度已经达到 4096, 那么生成第 4097 个 token 时, 模型需要重新执行 4097 次 Q-K 点积运算. 更为低效的是, 其中前 4096 次点积的结果与生成第 4096 个 token 时已经计算过的结果**完全一致**. 这种重复计算在长度达到数万甚至数十万的长文本场景中, 会直接导致推理延迟 unacceptable. 

**KV Cache(键值缓存)** 正是为了解决这一重复计算灾难而诞生的工程优化. 其核心思想极其朴素: **既然历史 token 的 Key 和 Value 向量在生成后续 token 时不会发生变化, 何不将它们缓存起来, 下次直接复用?**

在标准 Transformer 的每一层中, 当输入一个长度为 $s$ 的序列时, 我们会通过三个独立的线性投影分别得到 Query, Key 和 Value: 

$$
Q = X W_Q, \quad K = X W_K, \quad V = X W_V \tag{1}
$$

其中 $X \in \mathbb{R}^{s \times d_{model}}$ 是输入的隐藏状态矩阵. 在自回归推理中, 当生成第 $t$ 个新 token 时, 我们只需要计算当前 token 的 Query $q_t \in \mathbb{R}^{1 \times d_{head}}$, 然后将其与所有历史 Key $k_1, k_2, \ldots, k_t$ 计算点积, 再与所有历史 Value $v_1, v_2, \ldots, v_t$ 做加权求和：

$$
o_t = \text{softmax}\left(\frac{q_t K_{1:t}^T}{\sqrt{d_{head}}}\right) V_{1:t} \tag{2}
$$
如果没有 KV Cache, 每次生成都需要重新计算整个 $K$ 和 $V$ 矩阵, 时间复杂度是 $O(s \cdot d_{model}^2)$. 引入 KV Cache 后, 单步推理只需要计算当前 token 的 Q, K, V(其中 K 和 V 被追加到缓存中), 以及一次注意力操作, 时间复杂度降至 $O(d_{model}^2 + s \cdot d_{head})$, 其中 $s$ 是序列长度. **KV Cache 将二次增长的计算开销, 转化为线性增长的内存开销**这是典型的以空间换时间(Space-Time Tradeoff). 

然而, 历史无数次证明, **任何"以空间换时间"的优化, 最终都会在空间上撞上物理墙壁**. KV Cache 看似优雅的解决方案, 在 LLM 推理的实际工程场景中, 迅速演变为整个系统的首要瓶颈. 

### 1.2 内存爆炸公式推导: 当缓存消耗物理显存

让我们用一组现实的参数量, 来精确计算 KV Cache 的内存占用. 假设我们正在服务一个基于 Llama-3-70B 架构的模型(或类似规模的开源模型), 典型配置如下: 

- **Batch Size** $B = 64$: 同时处理 64 个并发请求. 在高吞吐推理服务中, 这是中等偏上的并发量. 

- **最大序列长度** $S_{max} = 4096$: 每个请求最多生成 4096 个 token. 长文本场景(如代码补全, 文档分析)中这个长度并不算极端. 

- **层数** $N_{layer} = 80$: 70B 级别模型通常采用 80 层 Transformer. 

- **注意力头数** $N_{head} = 64$(总头数, 若采用 GQA 则 Key/Value 头数会更少, 但为展示最坏情况, 我们按完整头数计算; 后续会修正为 GQA 场景). 

- **每个头的维度** $D_{head} = 128$. 

- **数据精度**: FP16(2 字节/元素), 这是推理阶段最常见的精度选择. 

KV Cache 为每一层的每个注意力头存储 Key 和 Value 两个张量. 对于单个请求, 在某一层的单个头上, 缓存一个长度为 $s$ 的序列需要存储 $s$ 个 Key 向量和 $s$ 个 Value 向量, 每个向量维度为 $D_{head}$. 

因此, **单个请求, 单一层, 所有注意力头的 KV Cache 大小**为: 

$$
M_{KV}^{(single, layer)} = 2 \times s \times N_{head} \times D_{head} \times \text{bytes} \tag{3}
$$

其中系数 2 代表 Key 和 Value 两个张量. 

扩展到所有层和所有 batch 中的请求, **总 KV Cache 内存占用**为：

$$
M_{KV} = 2 \times B \times S_{max} \times N_{layer} \times N_{head} \times D_{head} \times \text{bytes} \tag{4}
$$
代入上述数值: 

$$
M_{KV} = 2 \times 64 \times 4096 \times 80 \times 64 \times 128 \times 2 \text{ bytes} \tag{5}
$$

让我们逐步拆解这个乘积的物理含义：

- $64 \times 128 = 8192$：单个 token、单层、单头的 K+V 向量总元素数. 但由于有 64 个头, 实际是 $64 \times 128$ 每个 token 每层. 
- 更准确的理解方式是：$N_{head} \times D_{head} = 64 \times 128 = 8192$ 是每层单个 token 的 K(或 V)的向量维度. K 和 V 合起来就是 $2 \times 8192 = 16384$ 个元素. 
- 每层所有 token：$4096 \times 16384 = 67,108,864$ 个元素. 
- 80 层：$67,108,864 \times 80 = 5,368,709,120$ 个元素(约 50 亿, 对应单个请求). 
- Batch Size 64：$5,368,709,120 \times 64 = 343,597,383,680$ 个元素. 
- FP16(2 字节)：$343,597,383,680 \times 2 = 687,194,767,360$ 字节. 

将上述字节数换算为 GB 可得：

$$
M_{KV} = \frac{687,194,767,360}{1024^3} \approx 640 \text{ GB} \tag{6}
$$

等等, 这个数字似乎过于夸张. 让我们重新审视: 现代大模型(如 Llama-3-70B)普遍采用 **GQA(Grouped Query Attention)** 来减少 KV Cache 的内存压力. GQA 将 Key 和 Value 的头数减少到 $N_{KV\_head} = 8$(即每 8 个 Query 头共享 1 个 Key 头和 1 个 Value 头). 修正后的 GQA 内存需求公式为: 

$$
M_{KV}^{(GQA)} = 2 \times B \times S_{max} \times N_{layer} \times N_{KV\_head} \times D_{head} \times \text{bytes} \tag{7}
$$

下面代入 GQA 参数进行修正计算($N_{KV\_head} = 8$)：

$$
M_{KV}^{(GQA)} = 2 \times 64 \times 4096 \times 80 \times 8 \times 128 \times 2 \tag{8}
$$
$$
= 2 \times 64 \times 4096 \times 80 \times 8 \times 128 \times 2 = 137,438,953,472 \text{ bytes} \tag{9}
$$
$$
\approx \frac{137,438,953,472}{1024^3} \approx 128 \text{ GB} \tag{10}
$$
即便如此, **仅 KV Cache 就需要 128 GB 显存**. 而一张 NVIDIA A100 80GB 的显存容量也不过 80 GB. 这意味着即使使用 GQA, 单张 A100 也无法容纳 64 个并发请求的全长 KV Cache. 如果我们不使用 GQA(或采用更早期的 MHA, Multi-Head Attention), 内存需求直接飙升到 640 GB, 需要 8 张 A100 才能勉强装下. 

但这仅仅是**理论预分配**的开销. 实际工程中, 情况远比这个公式展现的更加恶劣. 因为此式假设每个请求都恰好占满 $S_{max} = 4096$ 的长度. 然而, 在真实的服务场景中, 请求的长度分布是极度不均匀的: 有的请求只有 10 个 token("你好"), 有的请求有 2000 个 token(一篇短文续写), 有的请求可能达到 8000 个 token(代码分析). 

这就引出了 KV Cache 管理的第二个核心噩梦: **内存碎片**. 

### 1.3 碎片问题: 内部碎片与外部碎片的双重绞杀

操作系统内存管理中的碎片问题在 LLM KV Cache 领域以更加极端的形式重现. 碎片分为两类: **内部碎片(Internal Fragmentation)** 和**外部碎片(External Fragmentation)**. 

**内部碎片**发生在系统为请求分配的内存空间**大于其实际需要**的空间时. 在 vLLM 出现之前, 主流的 LLM 推理框架(如 Hugging Face 的 `text-generation-inference` 早期版本, NVIDIA 的 FasterTransformer)通常采用**静态连续分配(Static Contiguous Allocation)** 策略: 当一个请求到达时, 调度器会根据预设的 `max_seq_len`(比如 4096)为该请求一次性分配一块足够容纳最大长度的**连续** KV Cache 内存块. 

假设一个用户发送了请求 "你好", 模型只需要生成 10 个 token 作为回复. 但按照静态连续分配策略, 系统依然会为其分配 4096 个 token 长度的 KV Cache 空间. 这 4096 个位置中, 实际只用了 10 个, 剩余的 4086 个位置被"预留"却无法被其他请求利用. 这种"大马拉小车"的分配模式导致**内部碎片率极高**. 根据 vLLM 论文中的实测数据, 在真实工作负载下, 内部碎片率可以达到 **30% 到 50%**, 甚至更高. 

为了将内部碎片问题形式化, 我们需要一种能量化"分配但未使用"内存占总分配内存比例的指标. 设第 $i$ 个请求被分配的内存大小为 $A_i$, 其实际使用的内存大小为 $U_i$, 则内部碎片率定义为: 

$$
\eta_{int} = \frac{\sum_i (A_i - U_i)}{\sum_i A_i} \tag{11}
$$

分子度量了所有请求浪费内存的总和, 分母则是系统为这些请求分配的总内存. 当 $A_i = S_{max}$ 对所有请求都成立时, 若平均实际使用长度仅为 $S_{avg} = 0.3 S_{max}$, 则内部碎片率直接达到 70%. 

**外部碎片**则是另一个更加隐蔽的杀手. 即使我们不采用静态预分配, 而是按需分配内存, 操作系统或 CUDA 内存分配器在多次分配和释放不同大小的内存块后, 会产生大量**不连续的小块空闲内存**. 这些空闲内存的总量可能足以容纳一个新的请求, 但由于它们彼此之间不连续, 无法被分配为一个完整的大块. 这就像一列火车有 100 个空座位, 但它们分散在 20 个不同的车厢且每个车厢的空座互不连续——虽然总数足够, 但没有一个连续区域能容纳一个需要 10 个连座的团体. 

外部碎片的数学描述可以借用操作系统理论中的经典模型. 设内存被划分为若干块, 空闲块的大小分别为 $f_1, f_2, \ldots, f_m$. 当一个大小为 $s$ 的请求到达时, 即使 $\sum_j f_j \geq s$, 也可能不存在某个 $f_j \geq s$, 导致分配失败. 外部碎片率的一种度量方式是：

$$
\eta_{ext} = 1 - \frac{\max_j f_j}{\sum_j f_j} \tag{12}
$$
当最大连续空闲块远小于总空闲内存时, 外部碎片率趋近于 1, 意味着内存虽然"空着", 却几乎无法使用. 

### 1.4 碎片如何绞杀 Batch Size 与吞吐量

碎片问题对 LLM 推理服务的杀伤力, 集中体现在对 **Batch Size** 和 **系统吞吐量** 的压制上. 

现代 GPU(尤其是 NVIDIA A100/H100)拥有极其强大的矩阵计算单元(Tensor Core), 其峰值计算吞吐量和内存带宽之间的差距巨大. 根据 Roofline 模型, 只有当计算密度(Arithmetic Intensity)足够高时, GPU 才能发挥出接近峰值的计算性能. 而 LLM 推理的 decode 阶段(逐 token 生成阶段)是**内存带宽密集型(Memory-Bound)** 操作: 每一步只需要计算一个 token 的 QKV 和一次注意力, 计算量极小, 但需要从显存中读取大量的模型权重和 KV Cache. 

在这种情况下, **扩大 Batch Size 是提升 GPU 利用率, 隐藏内存延迟的唯一有效手段**. 当 Batch Size 从 1 增加到 64 时, 虽然每个 token 的延迟略有上升, 但**单位时间内生成的总 token 数(吞吐量, throughput)** 会成倍增长, 因为 GPU 的并行计算单元被更充分地利用. 

然而, 碎片的存在直接限制了 Batch Size 的上限. 假设一张 A100 80GB 显存的 GPU, 模型权重(70B FP16)占用约 140 GB这已经超过了单卡容量, 需要模型并行(Model Parallelism, 如 2 张卡并行, 每张卡存 70GB 权重). 即使我们使用 4-bit 量化将权重压缩到约 40GB, 单张卡也只剩下约 40GB 给 KV Cache. 

如果采用静态连续分配, 每个请求预分配 4096 长度, GQA 下每个请求需要 $2 \times 80 \times 8 \times 128 \times 4096 \times 2 = 2,097,152,000$ 字节 $\approx 1.95$ GB. 40 GB 显存最多只能容纳约 20 个并发请求. 而如果考虑到 30% 到 50% 的内部碎片, 实际能容纳的请求数进一步下降到 10 到 14 个. 外部碎片则让这个数字更加不确定可能在某些时刻, 明明总空闲内存还有 5 GB, 但没有任何一块连续区域超过 2 GB, 导致新请求被拒绝, Batch Size 被迫降低. 

**Batch Size 的降低直接转化为 GPU 利用率的断崖式下跌**. 当 Batch Size 从 64 降到 10 时, GPU 的 Tensor Core 大部分时间在等待数据从 HBM(高带宽显存)加载, 计算单元空闲. 实测数据表明, 在碎片严重的场景下, GPU 利用率可能只有 30% 甚至更低, 而理想状态下应该达到 80% 以上. 这意味着企业需要购买 2 到 3 倍的 GPU 才能满足同样的业务需求, 推理成本成倍上升. 

更糟糕的是, 碎片问题随着序列长度的不均匀性加剧而恶化. 在真实对话场景中, 用户可能先发送一个短消息, 然后发送一个长文档. 短请求的 KV Cache 占据了大量预分配但不使用的空间, 而长请求则可能因为找不到足够大的连续内存块而被阻塞或延迟. 这种"短请求占着茅坑不拉屎, 长请求排队等不到坑"的局面, 是传统 KV Cache 管理无法解决的结构性矛盾. 

**核心动机**: 正是在这样的背景下, 2023 年来自加州大学伯克利分校的研究团队提出了 **PagedAttention** 及其工程实现 **vLLM**. 他们敏锐地意识到, KV Cache 的内存管理问题, 与操作系统数十年来的虚拟内存管理问题在数学结构上具有惊人的同构性. 通过引入操作系统中成熟的"分页(Paging)"和"虚拟地址到物理地址的映射"思想, PagedAttention 从根本上消除了内部碎片, 并将外部碎片降低到了几乎可以忽略的程度. 

## 2. 为什么重要 (Significance)

### 2.1 从学术成果到开源推理服务的事实标准

PagedAttention 的论文《Efficient Memory Management for Large Language Model Serving with PagedAttention》发表于操作系统领域的顶级会议 **SOSP 2023**. 在 LLM 推理优化这个 rapidly evolving 的领域中, 一项工作能在如此短的时间内被系统领域顶会接收, 本身就说明了其问题的根本性和解决方案的优雅性. 这篇论文不是一篇单纯的"加速论文"它解决的不是如何让矩阵乘法更快 10%, 而是如何让整个推理系统的内存利用效率从 50% 提升到接近 100%. 这种系统层面的优化, 其工程价值远超算法层面的局部改进. 

vLLM 作为 PagedAttention 的开源实现, 在 GitHub 上发布后迅速成为社区焦点. 截至 2025 年底, vLLM 的 GitHub Star 数已经突破数万, 被集成到从开源项目到商业产品的各个层面. 包括但不限于: 

- **Hugging Face TGI(Text Generation Inference)** 在后续版本中引入了与 PagedAttention 类似的内存管理策略; 

- **NVIDIA TensorRT-LLM** 在其 KV Cache 管理模块中吸收了分页管理的思想; 

- **国内的各大云厂商**(阿里云, 腾讯云, 火山引擎等)在其 LLM 推理服务中大量采用 vLLM 或其衍生版本; 

- **SGLang** 在 vLLM 的基础上进一步发展了 RadixAttention, 但其底层依然依赖 PagedAttention 的分页机制. 

可以说, 如果你今天在生产环境中部署一个开源 LLM 推理服务, 而不使用 vLLM 或受其思想启发的框架, 你的显存利用率和吞吐量将自动落后行业平均水平一倍以上. 

### 2.2 GPU 利用率从 30% 到 80%+: 算力经济学的降维打击

vLLM 论文中的基准测试结果令人印象深刻. 在保持相同延迟水平(Time-to-First-Token, TTFT 和 Time-Per-Output-Token, TPOT)的前提下, vLLM 相比当时最先进的推理引擎(如 FasterTransformer 和 Orca)在多个标准数据集上实现了 **2 到 4 倍的吞吐量提升**. 

让我们从算力经济学的角度来理解这个数字的恐怖之处. 假设一个 AI 创业公司需要支持每天 1 亿次 LLM API 调用, 每次调用平均生成 500 个 token. 使用传统推理引擎, 可能需要 100 张 A100 GPU 才能满足吞吐量需求. 而切换到 vLLM 后, 由于 GPU 利用率从 30% 提升到 80% 以上, 同等硬件下吞吐量提升 2.5 倍, 意味着只需要 **40 张 A100** 即可完成同样的业务负载. 按每张 A100 每小时 2 美元的云租赁价格计算, 每天的计算成本从 $100 \times 24 \times 2 = 4800$ 美元下降到 $40 \times 24 \times 2 = 1920$ 美元, **每年节省超过 100 万美元**. 

这种节省并不是通过更聪明的算法减少了计算量(PagedAttention 没有改变注意力机制本身的计算复杂度), 而是通过更聪明的内存管理让 GPU 的并行计算资源被更充分地利用. 这是一种"无代价的加速"你没有牺牲模型精度, 没有增加额外计算, 只是让硬件不再因为内存管理的愚蠢而空转. 

vLLM 的影响力还体现在它推动了整个 LLM 推理领域从"单卡优化"向"系统级优化"的范式转变. 在 PagedAttention 之前, 推理优化主要聚焦于算子融合(Kernel Fusion), 量化(Quantization), CUDA 核函数手写等"微观"技巧. 而 PagedAttention 证明, 在系统层面重新设计内存管理策略, 可以带来比所有这些微观优化加在一起还要大的收益. 

## 3. 直觉类比 (Intuition)

### 3.1 餐厅排座: 固定圆桌 vs 灵活拼桌

想象你是一家火爆火锅店的老板. 你的店里有 100 个座位, 但座位是固定的圆桌, 每桌 10 个人. 这就是**传统静态连续分配**的 KV Cache 管理. 

有一天晚上, 来了以下几组客人: 
- 第 1 组: 2 个人(一对情侣)
- 第 2 组: 3 个人(一家三口)
- 第 3 组: 8 个人(公司团建)
- 第 4 组: 1 个人(独自用餐的程序员)

按照固定圆桌的分配规则, 每组客人无论人数多少, 都必须独占一整张 10 人桌. 于是: 
- 2 人组占了 10 人桌, 浪费了 8 个座位(内部碎片)
- 3 人组占了 10 人桌, 浪费了 7 个座位
- 8 人组占了 10 人桌, 浪费了 2 个座位
- 1 人组占了 10 人桌, 浪费了 9 个座位

4 组客人总共只来了 14 个人, 但占用了 40 个座位, 浪费了 26 个座位, **座位利用率只有 35%**. 更糟的是, 如果有第 5 组 10 个人要来, 虽然店里实际上还有 60 个空座位, 但由于这些空座位分散在 6 张被部分占用的桌子上, 没有一整张空桌可以给第 5 组使用. 第 5 组只能在外面排队等待(外部碎片导致的新请求被拒绝). 

这就是传统 KV Cache 管理的真实写照: 每个请求预分配一块固定大小的连续显存, 不管实际用多少. 短请求大量浪费空间, 长请求找不到足够大的连续块. 

**PagedAttention 的做法则完全不同**. 它把 100 个座位拆分成 20 个"小方桌", 每桌 5 个人. 现在: 
- 2 人组: 分配 1 个小方桌(内部碎片: 5 - 2 = 3 个座位浪费)
- 3 人组: 分配 1 个小方桌(内部碎片: 5 - 3 = 2 个座位浪费)
- 8 人组: 分配 2 个小方桌(内部碎片: 10 - 8 = 2 个座位浪费)
- 1 人组: 分配 1 个小方桌(内部碎片: 5 - 1 = 4 个座位浪费)

4 组客人总共占用 5 个小方桌(25 个座位), 浪费 11 个座位, **座位利用率提升到 56%**. 更重要的是, 如果第 5 组 10 个人来了, 店里还有 15 个小方桌(75 个座位)完全空闲, 可以轻松分配 2 个小方桌给他们. 而且, 即使小方桌的分配变得零散, 只要总数足够, 总能找到连续的几个小方桌来满足需求因为"小方桌"本身就是最小的分配单元, 外部碎片被限制在单个方桌内部. 

这个类比中的"小方桌", 就是 PagedAttention 中的 **Block**(物理块). 通过将大块连续内存拆分为固定大小的小块进行分配, 内部碎片被限制在单个 block 内, 而外部碎片则被彻底消灭因为任何数量的空闲 block 都可以被组合起来分配给新的请求. 

### 3.2 操作系统虚拟内存: 页表, 逻辑地址与物理地址的解耦

PagedAttention 这个名字本身就暗示了它与操作系统虚拟内存(Virtual Memory)的深刻联系. 事实上, PagedAttention 的核心思想几乎完全借用了操作系统分页管理的成熟框架. 

在操作系统中, 每个进程看到的内存地址是**逻辑地址(Logical Address)** 或**虚拟地址(Virtual Address)**. 进程以为自己拥有一整块从零开始的连续内存空间. 但实际上, 操作系统通过**页表(Page Table)** 将逻辑页号(Virtual Page Number)映射到物理内存中的**物理页框(Physical Page Frame)**. 物理页框在内存中可以是任意排列的, 完全不连续, 但进程对此毫不知情它看到的始终是一个连续的虚拟地址空间. 

这种解耦带来了两个巨大的好处: 
1. **进程隔离**: 每个进程有自己独立的虚拟地址空间, 不会因为其他进程的内存分配而受到影响; 

2. **消除外部碎片**: 物理内存的分配以固定大小的页(通常是 4KB)为单位, 任何空闲页都可以被分配给任何进程, 不存在"不连续的空闲内存无法利用"的问题. 

PagedAttention 将这一思想完整地移植到了 KV Cache 管理中: 

- **逻辑块(Logical Block)**: 每个 LLM 请求看到的 KV Cache 是一个逻辑上连续的序列块序列(block 0, block 1, block 2,...). 请求只需要关心"我有第几个 block", 不需要关心这些 block 在物理显存中存放在哪里. 

- **物理块(Physical Block)**: 显存池被预先划分为固定大小的物理块(比如每个 block 容纳 16 个 token 的 KV Cache). 物理块在显存中的位置是固定的, 但彼此之间不需要连续. 

- **Block Table(块表)**: 相当于操作系统的页表, 记录每个请求的逻辑块到物理块的映射关系. 当一个请求需要追加新的 token 时, 调度器从空闲物理块池中分配一个新的物理块, 并在该请求的 Block Table 中添加一条映射记录. 

这种映射机制使得**同一个物理块可以被多个请求共享**. 在 LLM 推理中, 一个极为常见的场景是: **多个请求共享相同的前缀(Prefix)**. 例如, 在系统提示词(System Prompt)固定的聊天应用中, 所有用户请求都以相同的系统提示词开头. 传统方法中, 每个请求都需要独立存储这个系统提示词的 KV Cache. 而在 PagedAttention 中, 这些请求可以共享相同的物理块它们的 Block Table 中, 前几个逻辑块都映射到同一个物理块上. 

这种共享通过**引用计数(Reference Counting)** 实现: 每个物理块维护一个引用计数, 表示有多少个请求正在共享它. 只有当引用计数降为零时, 该物理块才会被释放回空闲池. 这与操作系统中 Copy-on-Write(写时复制)机制的精神完全一致共享直到有人需要修改为止. 

![传统连续分配与 PagedAttention 显存分配对比（vLLM 论文 Figure 1–3）](./images/fig-vllm-kv-fragmentation-problem.jpg)

**图 3.1** 传统连续 KV 分配 vs PagedAttention（Kwon et al., 2023）

**图 3.1 解析**

- **左侧**：每请求按 $L_{max}$ 连续预分配 → 大量 **reserved / internal fragmentation**，有效显存可低至 ~20%。
- **右侧**：逻辑块经 **Block Table** 映射到物理块池 — 与 OS 分页同构，碎片仅出现在末块 partial fill。
- 读图联系吞吐：碎片越少 → 同卡可并发请求越多 → decode 吞吐上升。


## 4. 数学推导与工程实现 (Mathematical Rigor)

### 4.1 KV Cache 内存公式的完整展开

让我们更严谨地推导 KV Cache 的内存占用公式, 并逐一解释每个变量的物理含义. 

对于一个基于 Transformer Decoder 架构的 LLM, 设: 

| 符号 | 含义 | 典型值(Llama-3-70B) |
|------|------|----------------------|
| $B$ | Batch Size, 同时处理的请求数量 | 64 |
| $S_i$ | 第 $i$ 个请求的当前序列长度 | 动态变化 |
| $S_{max}$ | 系统支持的最大序列长度 | 4096 或 8192 |
| $N_{layer}$ | Transformer 层数 | 80 |
| $N_{head}$ | 每个层的 Query 注意力头数 | 64 |
| $N_{KV\_head}$ | 每个层的 Key/Value 注意力头数(GQA) | 8 |
| $D_{head}$ | 每个注意力头的维度 | 128 |
| $D_{model}$ | 模型隐藏层维度, $D_{model} = N_{head} \times D_{head}$ | 8192 |
| $P$ | 精度(每个元素占用的字节数), FP16=2, FP32=4 | 2 |

在 GQA 架构下, 每一层只需要存储 $N_{KV\_head}$ 个 Key 头和 $N_{KV\_head}$ 个 Value 头. 对于单个请求, 在第 $l$ 层, 第 $h$ 个 KV 头, 序列长度为 $s$ 时: 

- Key Cache 张量的形状为: $(s, D_{head})$
- Value Cache 张量的形状为: $(s, D_{head})$

因此, 第 $l$ 层, 所有 $N_{KV\_head}$ 个头的 K+V Cache 总元素数为: 

$$
E_{layer} = 2 \times s \times N_{KV\_head} \times D_{head} \tag{13}
$$

其中系数 2 表示 Key 和 Value 两个张量. 

单个请求所有层的 KV Cache 元素数：

$$
E_{req} = N_{layer} \times E_{layer} = 2 \times N_{layer} \times s \times N_{KV\_head} \times D_{head} \tag{14}
$$
Batch Size 为 $B$ 时, 若所有请求的序列长度相同(均为 $S_{max}$), 总内存占用为: 

$$
M_{KV} = B \times E_{req} \times P = 2 \times B \times S_{max} \times N_{layer} \times N_{KV\_head} \times D_{head} \times P \tag{15}
$$

让我们重新代入更精确的现实参数. 以 Llama-3-70B 为例, 它实际使用 $N_{KV\_head} = 8$, $N_{layer} = 80$, $D_{head} = 128$. 当 $B = 64$, $S_{max} = 4096$, $P = 2$(FP16)时：

$$
M_{KV} = 2 \times 64 \times 4096 \times 80 \times 8 \times 128 \times 2 \tag{16}
$$

下面按照运算顺序逐步拆解计算过程: 
- $2 \times 64 = 128$(K+V 两个张量 × Batch Size)
- $128 \times 4096 = 524,288$(× 序列长度)
- $524,288 \times 80 = 41,943,040$(× 层数)
- $41,943,040 \times 8 = 335,544,320$(× KV 头数)
- $335,544,320 \times 128 = 42,949,672,960$(× 头维度)
- $42,949,672,960 \times 2 = 85,899,345,920$ 字节(× 精度)

将最终结果换算为 GB 可得: 

$$
M_{KV} = \frac{85,899,345,920}{1024^3} \approx 80 \text{ GB} \tag{17}
$$

这是在不使用 GQA 的情况下的计算？不, 上面已经使用了 $N_{KV\_head} = 8$. 等等, 让我重新核算. 实际上, 在 Llama-3-70B 的真实配置中, Batch Size=64, seq_len=4096, layers=80, kv_heads=8, head_dim=128, fp16=2：

$$
2 \times 64 \times 4096 \times 80 \times 8 \times 128 \times 2 = 137,438,953,472 \text{ bytes} \approx 128 \text{ GB} \tag{18}
$$
这与我之前的计算一致. 单张 A100 80GB 确实装不下, 需要两张卡或者使用更小的 Batch Size / 更短的序列长度. 

如果我们考虑到**每个请求的实际长度并不相同**, 设第 $i$ 个请求的实际长度为 $s_i$, 则动态分配下的"理论最小内存"应该是: 

$$
M_{KV}^{(ideal)} = 2 \times N_{layer} \times N_{KV\_head} \times D_{head} \times P \times \sum_{i=1}^{B} s_i \tag{19}
$$

而静态预分配下的内存占用是：

$$
M_{KV}^{(static)} = 2 \times B \times S_{max} \times N_{layer} \times N_{KV\_head} \times D_{head} \times P \tag{20}
$$
两者的比值揭示了静态分配的浪费程度: 

$$
\text{利用率} = \frac{M_{KV}^{(ideal)}}{M_{KV}^{(static)}} = \frac{\sum_{i=1}^{B} s_i}{B \times S_{max}} = \frac{\bar{s}}{S_{max}} \tag{21}
$$

其中 $\bar{s}$ 是平均序列长度. 如果真实场景中 $\bar{s} = 1000$ 而 $S_{max} = 4096$, 则利用率仅为 $1000/4096 \approx 24.4%$, 意味着超过 75% 的预分配内存被浪费了. 这就是内部碎片的数学本质. 

### 4.2 碎片率公式与 PagedAttention 的碎片消除

让我们更形式化地定义碎片率, 并推导 PagedAttention 如何将其降至接近零. 

#### 4.2.1 内部碎片率的传统定义

设系统中有 $N$ 个活跃请求. 对于第 $i$ 个请求：
- $A_i$：系统为该请求分配的内存总量
- $U_i$：该请求实际使用的内存量(与当前序列长度 $s_i$ 成正比)

**内部碎片(Internal Fragmentation)** 定义为已分配但未使用的内存：

$$
\text{Frag}_{int} = \sum_{i=1}^{N} (A_i - U_i) \tag{22}
$$
**内部碎片率**为: 

$$
\eta_{int} = \frac{\sum_{i=1}^{N} (A_i - U_i)}{\sum_{i=1}^{N} A_i} = 1 - \frac{\sum_{i=1}^{N} U_i}{\sum_{i=1}^{N} A_i} \tag{23}
$$
在静态连续分配中, $A_i = C_{max}$(常数, 通常为最大序列长度对应的内存量), 所以：

$$
\eta_{int}^{(static)} = 1 - \frac{\sum_{i=1}^{N} s_i}{N \times S_{max}} = 1 - \frac{\bar{s}}{S_{max}} \tag{24}
$$
如前所述, 若平均长度仅为最大长度的 30%, 如式 (3) 所示, 内部碎片率就高达 70%. 

#### 4.2.2 PagedAttention 下的内部碎片率

在 PagedAttention 中, 内存分配以固定大小的 **block** 为单位. 设每个 block 可以容纳 $K$ 个 token(例如 $K = 16$ 或 $K = 32$). 对于长度为 $s_i$ 的请求, 需要分配的 block 数量为: 

$$
n_i = \left\lceil \frac{s_i}{K} \right\rceil \tag{25}
$$
每个 block 实际使用的 token 数在最后一个 block 中可能不足 $K$ 个. 第 $i$ 个请求的内部碎片(以 token 数计)为：

$$
\text{waste}_i = n_i \times K - s_i \tag{26}
$$
由于 $n_i = \lceil s_i / K \rceil$, 我们有 $n_i - 1 < s_i / K \leq n_i$, 因此: 

$$
0 \leq \text{waste}_i < K \tag{27}
$$
也就是说, **每个请求的内部碎片严格小于一个 block 的大小 $K$**. 

所有请求的总内部碎片为各请求浪费空间之和：

$$
\text{Frag}_{int}^{(paged)} = \sum_{i=1}^{N} (n_i \times K - s_i) < N \times K \tag{28}
$$
PagedAttention 下的内部碎片率定义为浪费空间占分配空间的比例: 

$$
\eta_{int}^{(paged)} = \frac{\sum_{i=1}^{N} (n_i \times K - s_i)}{\sum_{i=1}^{N} n_i \times K} = 1 - \frac{\sum_{i=1}^{N} s_i}{K \times \sum_{i=1}^{N} \lceil s_i / K \rceil} \tag{29}
$$

为了分析这个碎片率的上界, 我们利用不等式 $\lceil x \rceil \leq x + 1$(对于 $x \geq 0$)：

$$
\sum_{i=1}^{N} \left\lceil \frac{s_i}{K} \right\rceil \leq \sum_{i=1}^{N} \left(\frac{s_i}{K} + 1\right) = \frac{1}{K}\sum_{i=1}^{N} s_i + N \tag{30}
$$

将上述不等式代入碎片率定义, 可以得到上界估计: 

$$
\eta_{int}^{(paged)} = 1 - \frac{\sum s_i}{K \sum \lceil s_i/K \rceil} \leq 1 - \frac{\sum s_i}{K \left(\frac{\sum s_i}{K} + N\right)} = 1 - \frac{\sum s_i}{\sum s_i + N \cdot K} \tag{31}
$$

进一步化简即可得到仅含平均序列长度的紧凑上界：

$$
= \frac{N \cdot K}{\sum s_i + N \cdot K} = \frac{K}{\bar{s} + K} \tag{32}
$$

其中 $\bar{s} = \frac{1}{N}\sum s_i$ 是平均序列长度. 

这个上界揭示了一个关键洞察: **PagedAttention 的内部碎片率上限仅取决于 block 大小 $K$ 与平均序列长度 $\bar{s}$ 的比值**, 如式 (11) 所示. 当 $\bar{s} \gg K$ 时(即请求普遍较长): 

$$
\eta_{int}^{(paged)} \approx \frac{K}{\bar{s}} \tag{33}
$$
若 $\bar{s} = 1000$, $K = 16$, 则碎片率上限约为 $16/1000 = 1.6%$. 相比静态分配的 70%, 这是两个数量级的改进. 

即使请求很短(例如 $\bar{s} = 50$), 碎片率也仅为 $16 / (50 + 16) \approx 24.2%$, 依然显著优于静态分配. 

**PagedAttention 将内部碎片率从 30%–50% 降低到 1%–5% 的区间**, 其核心原因正是将"一次大剂量浪费"转化为"多次小剂量浪费", 并通过让 block 足够小而将单次浪费控制在极低的水平. 

#### 4.2.3 外部碎片的彻底消除

外部碎片在 PagedAttention 中几乎被彻底消灭. 原因在于：

在 PagedAttention 的内存池中, 所有物理块具有**相同的大小**. 空闲块列表(Free List)维护着所有未被使用的物理块. 当一个新的请求需要 $m$ 个 block 时, 分配器只需要从空闲列表中取出任意 $m$ 个块即可. 由于所有块大小相同, **不存在"某个空闲块太小无法满足请求"的情况**. 只要空闲块的总数 $\geq m$, 分配就一定能成功. 

形式化地说, 设空闲块列表中有 $F$ 个块, 每个请求需要 $m$ 个块. 分配成功的条件是：

$$
F \geq m \tag{34}
$$

而在静态连续分配中, 分配成功的条件是: 存在一段**连续的**空闲内存, 其大小 $\geq$ 请求需要的内存. 这个条件严格更强, 因此失败概率也严格更高. 

### 4.3 PagedAttention 核心机制

#### 4.3.1 Block Table: 逻辑块到物理块的映射表

Block Table 是 PagedAttention 的数据结构核心. 对于每个正在处理的请求, vLLM 维护一个 Block Table, 它是一个一维数组(或列表), 其索引是**逻辑块编号**, 其值是**物理块编号**. 

假设系统中物理块的总数为 $N_{phy}$, 每个物理块的大小为 $K$ 个 token. 物理块池在系统初始化时被预先分配好, 所有物理块组成一个大的显存张量: 

$$
\text{Physical\_KV\_Cache} \in \mathbb{R}^{N_{phy} \times 2 \times N_{layer} \times N_{KV\_head} \times K \times D_{head}} \tag{35}
$$

这个六维张量的设计将物理块编号($N_{phy}$)、数据类型标识(2 表示 Key 与 Value 两个独立张量)、模型深度($N_{layer}$)、注意力头维度($N_{KV\_head}$)、块容量($K$ 个 token)以及头内维度($D_{head}$)在同一数据结构中线性展开. 其中 $N_{phy}$ 决定显存池的总容量, 第 1 维的系数 2 直接对应 Key 和 Value 的独立存储需求, 而 $K$ 与 $D_{head}$ 的乘积则给出单个物理块实际承载的浮点元素数量. 在 CUDA kernel 执行时, 通过 Block Table 中的物理块索引定位到第 0 维的特定切片, 即可直接索引到该 block 内所有层、所有头的 KV 数据, 无需在分散的内存区域间跳转. 

对于请求 $i$, 其 Block Table 可能长这样(以 $K = 16$ 为例)：

| 逻辑块索引 | 物理块编号 | 逻辑 token 范围 |
|-----------|-----------|---------------|
| 0 | phy_7 | [0, 15] |
| 1 | phy_23 | [16, 31] |
| 2 | phy_5 | [32, 47] |
| 3 | phy_41 | [48, 55] |

注意最后一个逻辑块(索引 3)只使用了 8 个 token 位置([48, 55]), 因为请求当前长度为 56. 逻辑块 3 还有 8 个空闲槽位([56, 63]), 可以供后续生成的新 token 填充. 当这 8 个槽位被填满后, 如果请求继续生成, 系统将分配一个新的物理块(比如 phy_12), 并在 Block Table 中追加一条新记录(逻辑块 4 → phy_12). 

在 CUDA kernel 层面执行注意力计算时, PagedAttention 需要一个特殊的 GPU kernel 来根据 Block Table 中指定的物理块索引, 从分散的物理内存中Gather出连续的 K 和 V 张量. 这个 kernel 是 vLLM 的核心工程贡献之一——它必须在保持高内存带宽利用率的同时, 处理不规则的内存访问模式. 

![Block Table 逻辑块到物理块映射与 prefix 共享（vLLM 论文 Figure 7）](./images/fig-vllm-paged-attention-blocks.jpg)

**图 4.1 解析**

- 两请求的 **逻辑块** 可映射到 **同一物理块**（共享 system prompt 前缀）。
- **引用计数** 归零才回收 — 与 Copy-on-Write 精神一致。
- 这是 vLLM 相对「每请求独立 KV 向量」的核心工程优势。

> **图 4.1 Block Table 逻辑块到物理块映射与共享机制**
> * **逻辑块(Logical Blocks 0-3)**：每个请求在逻辑上维护一个连续的 KV 缓存序列. 在生成新的 token 时, 新计算出的 $K_t$ 和 $V_t$ 向量被追加写入当前的逻辑块中(参见公式 47-50 对应的逻辑空间). 
> * **物理块(Physical Blocks)**：物理显存中实际分配的块(如 `phy_12`、`phy_41` 等), 各块独立分布在 GPU 的 HBM 显存中. 
> * **块表(Block Table)**：将每个请求的逻辑块索引(0, 1, 2...)映射到物理块索引(如 `phy_12` 等). 
> * **写时复制(Copy-on-Write)与引用计数**：
>   * 当 Request 1 与 Request 2 共享相同的前缀(如 System Prompt)时, 它们的逻辑块均映射到同一个物理块, 该物理块的**引用计数(Ref Count)**设为 2. 
>   * 如果 Request 1 在解码阶段需要写入共享块(如逻辑块 3), 系统会触发**写时复制(CoW)**：将该物理块复制一份到新的物理地址(如 `phy_41`, Ref Count 置为 1), 并将 Request 2 原物理块的 Ref Count 减 1. 这样既节省了前缀内存, 又保证了各个请求的独立写入. 


#### 4.3.2 Copy-on-Write：解码阶段的共享与复制

Copy-on-Write(CoW, 写时复制)是操作系统中的一项经典技术. 在 PagedAttention 的语境下, 它被用来处理**多请求共享前缀(Prefix Sharing)** 的场景. 

考虑一个典型的聊天应用. 系统提示词(System Prompt)对所有用户都是一样的, 例如：

```
You are a helpful AI assistant. Answer questions concisely and accurately.
```

假设这个系统提示词编码后有 50 个 token. 当 100 个用户同时发起对话时, 传统方法需要为每个用户独立存储这 50 个 token 的 KV Cache, 总共消耗 $100 \times 50 = 5000$ 个 token 的缓存空间. 

而 PagedAttention 允许这 100 个请求**共享相同的物理块**. 初始状态下, 所有 100 个请求的 Block Table 前几个逻辑块都指向相同的物理块. 每个物理块维护一个**引用计数(Reference Count)** , 记录当前有多少个正在执行的请求通过各自的 Block Table 指向该物理块. 只有当引用计数降为零时, 系统才会将该物理块回收到空闲池中重新分配. 

当一个请求生成新的 token 时, 它需要修改自己的 KV Cache(向当前逻辑块追加新 token 的 K 和 V). 但如果当前逻辑块被多个请求共享(引用计数 > 1), 直接修改会影响其他请求. 

此时触发 **Copy-on-Write**：
1. 系统从空闲池中分配一个新的物理块 $phy_{new}$; 
2. 将原物理块 $phy_{old}$ 中的数据复制到 $phy_{new}$; 
3. 将当前请求的 Block Table 中对应的逻辑块重新映射到 $phy_{new}$; 
4. 将 $phy_{old}$ 的引用计数减 1; 
5. 将 $phy_{new}$ 的引用计数设为 1; 
6. 现在当前请求可以安全地修改 $phy_{new}$, 而不会影响其他共享 $phy_{old}$ 的请求. 

为了量化前缀共享带来的内存收益, 我们对比传统独立存储与 PagedAttention 写时复制两种策略下的显存占用. 设共享前缀长度为 $L_{prefix}$, 用户数量为 $N_{user}$, 每个 token 的 KV Cache 大小为 $M_{per\_token}$, 第 $i$ 个用户请求的总长度为 $L_i$. 传统方法需要为每个用户独立存储完整前缀, 其 KV Cache 开销为：

$$
M_{trad} = N_{user} \times L_{prefix} \times M_{per\_token} \tag{36}
$$
PagedAttention 配合 Copy-on-Write 时, 前缀只需存储一份, 各用户仅在生成独有内容时才分配新物理块, 其总开销为: 

$$
M_{cow} = L_{prefix} \times M_{per\_token} + N_{user} \times (L_i - L_{prefix}) \times M_{per\_token} \tag{37}
$$

其中 $L_i$ 是第 $i$ 个用户请求的总长度. 两者的节省比例定义为：

$$
\text{Savings} = 1 - \frac{M_{cow}}{M_{trad}} = 1 - \frac{L_{prefix} + \sum_i (L_i - L_{prefix})}{N_{user} \times L_{prefix} + \sum_i (L_i - L_{prefix})} \tag{38}
$$
当共享前缀远大于各用户的独有内容($L_{prefix} \gg L_i - L_{prefix}$)且用户数量很大时, 节省比例趋近于 $1 - 1/N_{user}$. 例如, 100 个用户共享一个长前缀, 可以节省接近 99% 的前缀 KV Cache 内存. 

#### 4.3.3 物理块大小的数学权衡

PagedAttention 中物理块大小 $K$ 的选择是一个经典的工程权衡问题. $K$ 不能太大, 也不能太小. 

**情况一: $K$ 太小**

设 $K = 1$, 即每个 block 只存储 1 个 token. 此时内部碎片率趋近于 0(因为每个 token 都精确分配到只属于它的 block), 但会产生巨大的映射表开销. 

每个请求的长度为 $s$ 时, Block Table 中有 $s$ 个条目. 设系统中同时有 $N$ 个请求, 平均长度为 $\bar{s}$, 则 Block Table 的总条目数为 $N \times \bar{s}$. 

每个 Block Table 条目通常存储一个物理块索引(整数, 4 字节或 8 字节). 因此 Block Table 的内存开销为: 

$$
M_{table} = N \times \bar{s} \times \text{sizeof}(int) \tag{39}
$$

若 $N = 1000$, $\bar{s} = 1000$, 使用 4 字节整数：

$$
M_{table} = 1000 \times 1000 \times 4 = 4,000,000 \text{ bytes} = 4 \text{ MB} \tag{40}
$$
这看起来不大, 但别忘了, 在 GPU kernel 执行时, Block Table 需要被频繁访问. 如果 Block Table 太大无法放入高速缓存(Cache), 会导致严重的访存延迟. 更重要的是, 注意力 kernel 需要根据 Block Table 中的索引来 Gather 物理块, 如果 block 数量过多, kernel 内部的索引计算和内存访问模式会变得极其复杂, 严重影响 CUDA kernel 的效率. 

此外, 每个 block 在 CUDA 层面都有固定的元数据开销(如引用计数, 状态标记等). 设每个 block 的元数据为 $M_{meta}$ 字节, 则总元数据开销为: 

$$
M_{meta\_total} = N_{phy} \times M_{meta} = \frac{N \times \bar{s}}{K} \times M_{meta} \tag{41}
$$

当 $K$ 很小时, $N_{phy}$ 很大, 元数据开销线性增长. 

**情况二：$K$ 太大**

设 $K = 1024$. 此时 Block Table 的条目数很少, 映射开销很低, 但内部碎片率回升. 根据之前的推导：

$$
\eta_{int} \approx \frac{K}{\bar{s} + K} \tag{42}
$$
若平均序列长度较短而块很大, 例如 $\bar{s} = 100$, $K = 1024$, 则碎片率高得惊人: 

$$
\eta_{int} \approx \frac{1024}{1124} \approx 91% \tag{43}
$$

这意味着绝大多数分配的内存都被浪费了. 极端情况下, 一个只生成 1 个 token 的请求也会被分配 1024 个 token 的 block, 浪费 99.9% 的空间. 这与静态连续分配的问题如出一辙. 

**最优 block size 的推导**

为了找到最优的物理块大小, 我们建立一个兼顾数据存储、碎片浪费与映射开销的简化优化模型. 模型涉及五个核心量：活跃请求数 $N$、平均序列长度 $\bar{s}$、单个 token 的完整 KV Cache 大小 $M_{token}$(包含 Key 和 Value, 跨越所有层与所有头)、每个物理块的元数据开销 $M_{meta}$, 以及每访问一个 block 的 kernel 索引计算代价 $C_{access}$(与 block 总数成正比). 总内存开销由三部分耦合而成——第一部分是实际数据量 $M_{data} = N \bar{s} M_{token}$, 与 $K$ 无关; 第二部分来自内部碎片, 在最坏情况下每个请求会浪费接近一个完整 block 的容量, 即 $M_{waste} = N K M_{token}$; 第三部分是 block 元数据开销, 由于总 block 数为 $N\bar{s}/K$, 因此 $M_{meta\_total} = \frac{N \bar{s}}{K} M_{meta}$. 将三者相加, 得到关于 block size $K$ 的总开销函数：

$$
M_{total}(K) = N \bar{s} M_{token} + N K M_{token} + \frac{N \bar{s} M_{meta}}{K} \tag{44}
$$
第一项与 $K$ 无关(实际数据量), 我们对后两项求和求最小值: 

$$
f(K) = N K M_{token} + \frac{N \bar{s} M_{meta}}{K} \tag{45}
$$
对 $K$ 求导并令导数为零, 求解碎片浪费与元数据开销的最优权衡点：

$$
\frac{df}{dK} = N M_{token} - \frac{N \bar{s} M_{meta}}{K^2} = 0 \tag{46}
$$
$$
N M_{token} = \frac{N \bar{s} M_{meta}}{K^2} \tag{47}
$$
$$
K^2 = \frac{\bar{s} M_{meta}}{M_{token}} \tag{48}
$$
$$
K^* = \sqrt{\frac{\bar{s} \cdot M_{meta}}{M_{token}}} \tag{49}
$$
这是一个非常优美的结果：**最优 block size 与平均序列长度和元数据/数据开销比的平方根成正比**. 

让我们代入现实数值估算. 设 $M_{token} = 2 \times 80 \times 8 \times 128 \times 2 = 327,680$ 字节(约 320 KB, 这是 Llama-3-70B GQA FP16 下每个 token 的 KV Cache 大小). 设每个 block 的元数据(引用计数、状态位等)$M_{meta} \approx 64$ 字节, 平均序列长度 $\bar{s} = 500$：

$$
K^* = \sqrt{\frac{500 \times 64}{327680}} = \sqrt{\frac{32000}{327680}} = \sqrt{0.0977} \approx 0.31 \tag{50}
$$

这个结果表明, 如果纯粹从内存优化角度出发, block size 应该很小. 但这里的模型过于简化了它没有考虑 kernel 访问效率和 GPU 并行度的因素. 在实际的 CUDA kernel 中, 每个 block 对应一次 coalesced memory access 的单元, 过小的 block 会导致 warp 内的线程访问不连续的内存地址, 严重降低内存带宽利用率. 

vLLM 的工程实践表明, **$K = 16$ 或 $K = 32$ 是 Sweet Spot**. 以 $K = 16$ 为例: 
- 每个 block 存储的数据量为 $16 \times 320$ KB $= 5$ MB
- 对于 $\bar{s} = 500$, 每个请求平均需要 $500/16 \approx 32$ 个 block
- 内部碎片率上限约为 $16/500 = 3.2%$
- Block Table 条目数为 32, 完全在可接受范围内

这个工程选择是在内存效率, kernel 效率和实现复杂度之间的精妙平衡. 

### 4.4 vLLM 调度器: Continuous Batching, 抢占与交换

PagedAttention 解决了 KV Cache 的内存碎片问题, 但高效的 LLM 推理服务还需要一个智能的调度器来决定**何时, 以何种顺序, 用多大的 batch**来执行请求. vLLM 的调度器是 PagedAttention 内存管理策略与请求调度策略的完美结合. 

#### 4.4.1 Continuous Batching(动态批处理 / 迭代级调度)

传统的批处理(Batching)策略是**静态的(Static Batching)**: 等待一批请求全部到达后, 一次性送入模型推理, 等所有请求都生成完毕后, 再处理下一批. 这种策略的问题非常明显: 一批请求中, 有的可能只需要生成 10 个 token, 有的需要生成 1000 个 token. 当短请求已经结束时, 长请求还在继续生成, 但短请求占用的显存和计算资源无法被释放给新的请求使用. 

**Continuous Batching**, 也称为 **Iteration-Level Batching** 或 **In-Flight Batching**, 是 vLLM 调度器的核心策略. 其核心思想是: **在每个 decode step(每次生成一个 token)之后, 立即重新评估 batch 的组成**. 

具体来说: 
1. 在每个 iteration, 模型为当前 batch 中的所有活跃请求各生成一个 token; 
2. 如果某个请求生成了 EOS(结束符)或达到最大长度, 它立即从 batch 中移除, 释放其占用的物理块(引用计数降为零的块回收到空闲池); 
3. 如果有新的请求到达等待队列, 且当前空闲物理块足够, 就将新请求加入 batch; 
4. 进入下一个 iteration, 重复上述过程. 

这种细粒度的调度使得 GPU 在每个 iteration 都能保持尽可能满的 batch, 最大化计算资源的利用率. 数学上, 设第 $t$ 个 iteration 的 batch size 为 $B_t$, 则系统的平均吞吐量为: 

$$
\text{Throughput} = \frac{\sum_t B_t}{\sum_t T_{iter}(B_t)} \tag{51}
$$

其中 $T_{iter}(B_t)$ 是处理一个 iteration 的时间. 在 Memory-Bound 的 decode 阶段, $T_{iter}(B_t)$ 随 $B_t$ 增长缓慢(因为主要是带宽瓶颈, 更大的 batch 可以更好地隐藏延迟). 因此, 保持 $B_t$ 尽可能大对吞吐量至关重要. Continuous Batching 通过在每个 iteration 动态调整 batch 组成, 避免了静态 batching 中"短请求干等长请求"的资源浪费. 

#### 4.4.2 抢占(Preemption)与交换(Swapping)的决策逻辑

Continuous Batching 虽然高效, 但带来了一个新的问题：**显存可能不够**. 当新请求源源不断地到达, 而当前 batch 中的请求又迟迟没有完成时, 总显存需求可能超过 GPU 的物理容量. 

vLLM 提供了两种优雅的处理机制：**抢占(Preemption)** 和**交换(Swapping)** . 

**抢占**指的是：当显存不足时, 调度器选择一个(或多个)正在运行的请求, 暂停它的推理, 将其占用的物理块释放给其他更紧急的请求. 被抢占的请求及其 KV Cache 状态被保留, 等待后续资源可用时恢复执行. 在 PagedAttention 的框架下, 抢占的代价极低——只需要保存该请求的 Block Table(即逻辑块到物理块的映射关系), 而无需复制任何 KV Cache 数据. 被抢占请求的物理块被标记为"已分配但不可用于新请求", 或者如果启用了交换机制, 这些块可以被转移到 CPU 内存. 

**交换**是抢占的扩展：将被抢占请求的 KV Cache 物理块**从 GPU 显存复制到 CPU 内存**(通常是主机的 DRAM). 当该请求恢复执行时, 再将其 KV Cache 从 CPU 内存复制回 GPU 显存. 交换利用了 CPU 内存通常远大于 GPU 显存的特点, 将 GPU 显存作为"热缓存", CPU 内存作为"冷存储". 

抢占与交换的决策逻辑基于一个简单的成本模型, 涉及四个关键量：抢占请求的开销 $C_{preempt}$(在 PagedAttention 中主要是保存 Block Table 的映射状态, 代价几乎为零)、将 KV Cache 从 GPU 迁出到 CPU 的交换出开销 $C_{swap\_out}$(与请求长度成正比, 因为需要复制物理块数据)、将数据从 CPU 迁回 GPU 的交换入开销 $C_{swap\_in}$, 以及让新请求继续等待所带来的延迟成本 $W_{wait}$. 当显存不足时, 调度器面临三种选择：
1. 如果等待队列中的新请求的优先级高于某些正在运行的请求(例如, 新请求是交互式对话, 而运行中的请求是后台批处理任务), 则执行**抢占**; 
2. 如果 GPU 显存紧张但 CPU 内存充裕, 则执行**交换**, 将被抢占请求的 KV Cache 暂存到 CPU; 
3. 如果所有请求的优先级相似, 则让新请求在等待队列中排队, 直到现有请求完成释放显存. 

#### 4.4.3 何时应该抢占：到达率与完成率的排队论分析

我们可以用排队论(Queuing Theory)来形式化分析抢占的决策边界. 

设请求到达过程为泊松过程, **到达率**为 $\lambda$(每秒到达的请求数). 每个请求的生成长度服从某个分布, 设平均每个请求生成 $L$ 个 token, 每个 token 的生成时间为 $t_{token}$(decode step 时间), 则请求的**服务率**(完成率)为：

$$
\mu = \frac{1}{L \cdot t_{token}} \tag{52}
$$
在排队论中, 系统的负载因子为: 

$$
\rho = \frac{\lambda}{\mu} = \lambda \cdot L \cdot t_{token} \tag{53}
$$
当 $\rho < 1$ 时, 系统是稳定的——长期来看, 请求的处理速度能够跟上到达速度, 队列不会无限增长. 当 $\rho \geq 1$ 时, 系统不稳定, 队列长度将趋于无穷. 

但这个简单的模型没有考虑显存容量的约束. 设 GPU 显存最多能支持 $B_{max}$ 个并发请求(受限于 KV Cache 大小). 则系统的有效服务容量为 $B_{max} \cdot \mu$. 

显存约束下的系统稳定性条件为：

$$
\lambda \leq B_{max} \cdot \mu = \frac{B_{max}}{L \cdot t_{token}} \tag{54}
$$
PagedAttention 通过提高显存利用率, 将 $B_{max}$ 从传统方法的 $B_{max}^{(trad)}$ 提升到 $B_{max}^{(paged)} \approx 2 \sim 4 \times B_{max}^{(trad)}$, 从而显著扩展了系统的稳定运行区域. 

抢占的触发条件可以更精细地建模. 设当前系统中有 $N_{running}$ 个运行中的请求, 等待队列中有 $N_{waiting}$ 个请求. 如果不抢占, 等待请求需要等待的平均时间为: 

$$
T_{wait} = \frac{N_{waiting} + 1}{\mu_{eff}} \tag{55}
$$
其中 $\mu_{eff}$ 是当前系统的有效处理率. 如果抢占一个运行中的请求, 新请求可以立即开始执行, 但被抢占的请求后续需要恢复(可能伴随交换开销). 抢占的净收益取决于：

$$
\text{Benefit} = T_{wait} - T_{swap\_overhead} - T_{resume\_delay} \tag{56}
$$
当 Benefit > 0 时, 抢占是值得的. 在 vLLM 的默认调度策略中, 优先抢占那些已经生成了很多 token 但尚未完成的"长跑"请求, 因为它们的剩余服务时间较短(根据最小剩余时间优先的启发式), 或者根据用户自定义的优先级进行抢占. 

![vLLM 相对 HF/MII 等服务框架的吞吐对比（论文实验图）](./images/fig-vllm-throughput-comparison.jpg)

**图 5.1 解析**

- 纵轴通常为 **requests/s 或 tokens/s**；PagedAttention + continuous batching 在共享前缀场景优势最大。
- 与 FlashAttention 互补：FA 降 attention 算子耗时，PagedAttention 降 **KV 驻留与分配** 开销。

> **图 4.2 vLLM 调度器中请求的生命周期与状态转换模型**
> * **Waiting(等待中)**：新进入队列的请求在此状态等待调度. 当 GPU 空闲物理块充足时, 调度器开始对请求进行 **Prefill(预填充)** 并将其转换至 Running 状态. 
> * **Running(运行中)**：请求正在 GPU 上进行推理计算(Prefill 或 Decode 阶段), 持续申请和写入物理块. 
> * **Swapped(已交换/挂起)**：当 GPU 显存耗尽无法分配新块时, 为了防止 OOM, 调度器会触发**抢占机制(Preemption)**. 根据抢占策略, 部分 Running 状态的请求会被挂起, 它们的 KV Cache 物理块将被 **Swap Out(换出)** 至 CPU 内存(通过 PCIe 传输, 以物理块为单位). 
> * **状态转换逻辑**：
>   * **Preempt & Swap Out**：Running $\rightarrow$ Swapped. 发生显存极度紧张时, 挂起低优先级请求, 释放 GPU 块. 
>   * **Swap In & Resume**：Swapped $\rightarrow$ Running. 当 GPU 显存重新充裕时, 将 CPU 中的 KV Cache 重新加载回 GPU, 恢复解码过程. 
>   * **Finish**：Running $\rightarrow$ Finished. 生成结束(如遇到 `<｜endoftext｜>` 或达到最大长度), 释放其占用的所有物理块. 


## 5. 数值走查 (Numerical Example)

为了让 PagedAttention 的机制完全透明, 我们构造一个具体的数值走查. 假设系统中同时处理 3 个请求, Block Size $K = 16$, 每个物理块可以存储 16 个 token 的 KV Cache. 

### 5.1 初始状态

3 个请求的初始 prompt 长度分别为: 
- 请求 A(用户问"你好"): prompt 长度 = 10 个 token
- 请求 B(用户问"讲一个笑话"): prompt 长度 = 50 个 token
- 请求 C(用户粘贴了一篇短文, 要求总结): prompt 长度 = 100 个 token

系统初始化时, 物理块池中有 20 个空闲物理块, 编号为 P0, P1,..., P19. 

**Step 1: 分配 Prompt 阶段的 KV Cache**

在 Prefill 阶段(处理输入 prompt), 每个请求需要为其 prompt 长度分配足够的物理块. 

- **请求 A**: prompt 长度 10. 需要 $\lceil 10 / 16 \rceil = 1$ 个物理块. 
 - 分配 P0. 
 - Block Table A: [P0]
 - P0 使用情况: 10/16 token 已用, 6 个空闲槽位. 
 - 内部碎片: $16 - 10 = 6$ token. 

- **请求 B**: prompt 长度 50. 需要 $\lceil 50 / 16 \rceil = 4$ 个物理块($4 \times 16 = 64 \geq 50$). 
 - 分配 P1, P2, P3, P4. 
 - Block Table B: [P1, P2, P3, P4]
 - P1 满(16/16), P2 满(16/16), P3 满(16/16), P4 使用 2/16(因为 $50 - 3 \times 16 = 2$), 14 个空闲槽位. 
 - 内部碎片: $64 - 50 = 14$ token. 

- **请求 C**: prompt 长度 100. 需要 $\lceil 100 / 16 \rceil = 7$ 个物理块($7 \times 16 = 112 \geq 100$). 
 - 分配 P5, P6, P7, P8, P9, P10, P11. 
 - Block Table C: [P5, P6, P7, P8, P9, P10, P11]
 - P5~P10 满(各 16/16), P11 使用 4/16($100 - 6 \times 16 = 4$), 12 个空闲槽位. 
 - 内部碎片: $112 - 100 = 12$ token. 

**分配后的物理块状态汇总**: 

| 物理块 | 占用请求 | 已用 token | 空闲 token | 引用计数 |
|-------|---------|-----------|-----------|---------|
| P0 | A | 10 | 6 | 1 |
| P1 | B | 16 | 0 | 1 |
| P2 | B | 16 | 0 | 1 |
| P3 | B | 16 | 0 | 1 |
| P4 | B | 2 | 14 | 1 |
| P5 | C | 16 | 0 | 1 |
| P6 | C | 16 | 0 | 1 |
| P7 | C | 16 | 0 | 1 |
| P8 | C | 16 | 0 | 1 |
| P9 | C | 16 | 0 | 1 |
| P10 | C | 16 | 0 | 1 |
| P11 | C | 4 | 12 | 1 |
| P12~P19 | 空闲 | 0 | 16 | 0 |

**总内部碎片计算**: 

$$
\text{Frag}_{int} = 6 + 0 + 0 + 0 + 14 + 0 + 0 + 0 + 0 + 0 + 0 + 12 = 32 \text{ token} \tag{57}
$$

总分配 token 容量 = $12 \times 16 = 192$ token. 
实际使用 token 数 = $10 + 50 + 100 = 160$ token. 
内部碎片率 = $32 / 192 \approx 16.7%$. 

相比之下, 若采用静态连续分配(预分配 $S_{max} = 128$ 给每个请求)：
- 总分配容量 = $3 \times 128 = 384$ token
- 内部碎片 = $384 - 160 = 224$ token
- 内部碎片率 = $224 / 384 \approx 58.3%$

PagedAttention 将碎片率从 58.3% 降低到 16.7%. 

### 5.2 Decode 阶段：生成新 Token

现在进入自回归生成阶段. 假设经过若干步后：
- 请求 A 又生成了 6 个 token, 当前总长度 = 16. P0 刚好填满. 
- 请求 B 又生成了 14 个 token, 当前总长度 = 64. P4 刚好填满($2 + 14 = 16$). 
- 请求 C 又生成了 12 个 token, 当前总长度 = 112. P11 刚好填满($4 + 12 = 16$). 

此时各请求的 Block Table：
- A：[P0](满)
- B：[P1, P2, P3, P4](全满)
- C：[P5, P6, P7, P8, P9, P10, P11](全满)

**下一个 token 生成**：
- 请求 A 需要第 17 个位置 → 需要新 block. 分配 P12. Block Table A 变为 [P0, P12]. P12 使用 1/16. 
- 请求 B 需要第 65 个位置 → 需要新 block. 分配 P13. Block Table B 变为 [P1, P2, P3, P4, P13]. P13 使用 1/16. 
- 请求 C 需要第 113 个位置 → 需要新 block. 分配 P14. Block Table C 变为 [P5, P6, P7, P8, P9, P10, P11, P14]. P14 使用 1/16. 

**新的内部碎片**：
- A：P12 有 15 个空闲槽位
- B：P13 有 15 个空闲槽位
- C：P14 有 15 个空闲槽位
- 其他 block 全满, 碎片为 0

总内部碎片 = $15 + 15 + 15 = 45$ token. 
总分配容量 = $(12 + 3) \times 16 = 240$ token(使用了 P0~P14, 共 15 个 block). 
实际使用 token = $16 + 64 + 112 = 192$ token, 加上新生成的 3 个 = 195 token. 
内部碎片率 = $45 / 240 = 18.75%$. 

注意, 随着序列增长, 内部碎片率会自然下降, 因为每个请求浪费的"最后一个 block 的空闲部分"占总长度的比例越来越小. 

### 5.3 Prefix Sharing 与 Copy-on-Write

现在假设所有 3 个请求都使用相同的系统提示词(System Prompt), 长度为 40 个 token. 为了简化, 假设系统提示词恰好占 3 个 block($3 \times 16 = 48 \geq 40$). 

**初始分配(共享前缀)** ：
- 所有 3 个请求共享前缀 block：P0, P1, P2. 
- P0 使用 16/16(满), P1 使用 16/16(满), P2 使用 8/16($40 - 32 = 8$), 8 个空闲槽位. 
- 引用计数：ref_count(P0) = 3, ref_count(P1) = 3, ref_count(P2) = 3. 

各请求的 Block Table 初始状态：
- A：[P0, P1, P2]
- B：[P0, P1, P2]
- C：[P0, P1, P2]

**请求 A 的 Decode(生成新 token)** ：
请求 A 的系统提示词后接用户输入 "你好"(10 个 token). 注意系统提示词 40 token + 用户输入 10 token = 50 token. 

但在 Prefix Sharing 的场景下, 通常共享的是系统提示词的 KV Cache. 用户输入部分对每个请求是不同的, 因此不共享. 

为了更清晰地展示 CoW, 我们调整场景：3 个请求的系统提示词相同(40 token), 但用户 query 不同. 在 Prefill 阶段, 系统提示词的 KV Cache 被计算一次, 然后 3 个请求共享. 

现在假设请求 A 进入 decode 阶段, 生成新 token. 当它要写入第 41 个 token 的 K/V 时, 它需要修改 P2(当前 P2 已用 8/16, 还有 8 个空闲槽位). 但由于 P2 被 3 个请求共享(ref_count = 3), 不能直接修改. 

**触发 Copy-on-Write**：
1. 系统分配新物理块 P3; 
2. 将 P2 的数据复制到 P3; 
3. 请求 A 的 Block Table 更新为 [P0, P1, P3]; 
4. P2 的引用计数减为 2; 
5. P3 的引用计数设为 1; 
6. 请求 A 现在可以安全地向 P3 的第 9 个位置(逻辑 token 40)写入新 token 的 K/V. 

更新后的状态：
- A：[P0, P1, P3](P3 使用 9/16)
- B：[P0, P1, P2](P2 仍使用 8/16)
- C：[P0, P1, P2](P2 仍使用 8/16)
- ref_count(P0) = 3, ref_count(P1) = 3, ref_count(P2) = 2, ref_count(P3) = 1

**内存节省计算**：
传统方法下, 3 个请求各存 40 token 前缀：$3 \times 40 = 120$ token 的 KV Cache. 
PagedAttention + CoW 下：前缀只存一次 40 token, 加上 CoW 复制的 P3 中前 8 个 token(与 P2 重复)：$40 + 8 = 48$ token 等效存储. 
节省比例 = $(120 - 48) / 120 = 60%$. 

当共享前缀更长、请求数量更多时, 节省比例趋近于 $1 - 1/N_{user}$. 

### 5.4 请求完成与物理块回收

假设请求 A 已经生成完毕(输出 EOS), 当前长度为 45 token(系统提示词 40 + 用户输入 5 + 生成 0... 为简化设总长度 45). 它的 Block Table 为 [P0, P1, P3](假设 P3 使用了 13/16). 

请求 A 完成后：
1. 释放 A 的 Block Table; 
2. P0 引用计数：$3 - 1 = 2$(仍被 B、C 共享, 不回收); 
3. P1 引用计数：$3 - 1 = 2$(仍被 B、C 共享, 不回收); 
4. P3 引用计数：$1 - 1 = 0$(回收至空闲池). 

P3 被回收后, 可以被分配给新的请求 D 使用. 这正是 PagedAttention 消除外部碎片的核心体现——**任何空闲物理块都可以被任意请求使用, 无论它在显存中的位置如何**. 

## 6. 简化实现 (PyTorch Code)

以下是一个约 80 行的简化 Python 实现, 展示 PagedAttention 核心数据结构(BlockAllocator 和 BlockTable)的工作逻辑. 这不是可运行的 CUDA 代码, 而是用于理解核心算法机制的教育性实现. 

```python
import numpy as np
from typing import List, Optional, Dict

class BlockAllocator:
    """
    物理块分配器：管理物理块的分配、释放与引用计数. 
    对应数学概念：物理内存池 (Physical Memory Pool). 
    """
    def __init__(self, num_blocks: int, block_size: int):
        self.num_blocks = num_blocks      # 总物理块数
        self.block_size = block_size      # 每个块容纳的 token 数 (K)
        self.free_blocks = set(range(num_blocks))  # 空闲块集合
        # 引用计数: phy_block_id -> ref_count
        self.ref_count: Dict[int, int] = {}

    def allocate(self) -> Optional[int]:
        """
        分配一个空闲物理块. 
        对应公式: 从 Free List 中取出任意一个空闲块. 
        """
        if not self.free_blocks:
            return None
        block_id = self.free_blocks.pop()
        self.ref_count[block_id] = 1
        return block_id

    def free(self, block_id: int):
        """
        释放物理块. 仅在引用计数降为 0 时真正回收. 
        对应公式: 若 ref_count == 0, 则加入 Free List. 
        """
        if block_id not in self.ref_count:
            return
        self.ref_count[block_id] -= 1
        if self.ref_count[block_id] == 0:
            del self.ref_count[block_id]
            self.free_blocks.add(block_id)

    def incr_ref(self, block_id: int):
        """
        增加物理块的引用计数(用于 Prefix Sharing). 
        对应公式: ref_count(phy_j) += 1
        """
        if block_id in self.ref_count:
            self.ref_count[block_id] += 1

    def get_ref_count(self, block_id: int) -> int:
        return self.ref_count.get(block_id, 0)


class BlockTable:
    """
    块表：维护单个请求的逻辑块 -> 物理块映射. 
    对应数学概念: Block Table(页表). 
    """
    def __init__(self, block_size: int, allocator: BlockAllocator):
        self.block_size = block_size
        self.allocator = allocator
        # 逻辑块索引 -> 物理块编号的映射列表
        self.mapping: List[int] = []
        # 当前序列长度
        self.num_tokens = 0

    def append_token(self) -> bool:
        """
        为新生成的 token 分配 KV Cache 空间. 
        如果当前最后一个逻辑块已满或不存在, 分配新物理块. 
        对应公式: 若 s % K == 0, 则分配新 block. 
        """
        if self.num_tokens % self.block_size == 0:
            # 需要新物理块
            phy_block = self.allocator.allocate()
            if phy_block is None:
                return False  # 显存不足
            self.mapping.append(phy_block)
        self.num_tokens += 1
        return True

    def copy_on_write(self, logical_idx: int) -> bool:
        """
        对指定逻辑块执行 Copy-on-Write. 
        当多个请求共享一个物理块, 而当前请求需要写入时触发. 
        对应公式: 若 ref_count(phy_old) > 1, 分配 phy_new 并复制数据. 
        """
        if logical_idx >= len(self.mapping):
            return False
        phy_block = self.mapping[logical_idx]
        if self.allocator.get_ref_count(phy_block) > 1:
            # 分配新物理块
            new_phy = self.allocator.allocate()
            if new_phy is None:
                return False
            # 减少原块引用计数
            self.allocator.free(phy_block)
            # 更新映射
            self.mapping[logical_idx] = new_phy
        return True

    def free_all(self):
        """
        请求完成时释放所有占用的物理块. 
        """
        for phy_block in self.mapping:
            self.allocator.free(phy_block)
        self.mapping = []
        self.num_tokens = 0

    def get_physical_blocks(self) -> List[int]:
        """返回当前映射的所有物理块编号(用于 Gather KV Cache). """
        return self.mapping.copy()

    def internal_fragmentation(self) -> int:
        """
        计算当前请求的内部碎片(以 token 数计). 
        对应公式: waste = n * K - s
        """
        allocated_capacity = len(self.mapping) * self.block_size
        return allocated_capacity - self.num_tokens


# ========== 演示使用 ==========
if __name__ == "__main__":
    # 初始化：20 个物理块, 每块 16 个 token
    allocator = BlockAllocator(num_blocks=20, block_size=16)

    # 请求 A：prompt 长度 10
    table_a = BlockTable(block_size=16, allocator=allocator)
    for _ in range(10):
        table_a.append_token()
    print(f"Request A: {table_a.num_tokens} tokens, "
          f"blocks={table_a.get_physical_blocks()}, "
          f"waste={table_a.internal_fragmentation()}")
    # 输出: Request A: 10 tokens, blocks=[0], waste=6

    # 请求 B：prompt 长度 50
    table_b = BlockTable(block_size=16, allocator=allocator)
    for _ in range(50):
        table_b.append_token()
    print(f"Request B: {table_b.num_tokens} tokens, "
          f"blocks={table_b.get_physical_blocks()}, "
          f"waste={table_b.internal_fragmentation()}")
    # 输出: Request B: 50 tokens, blocks=[1,2,3,4], waste=14

    # 请求 C 与 A 共享前缀(模拟 Prefix Sharing)
    table_c = BlockTable(block_size=16, allocator=allocator)
    # 假设共享前缀占 10 个 token(与 A 相同), 直接映射到 A 的物理块
    table_c.mapping = table_a.get_physical_blocks()
    table_c.num_tokens = 10
    for phy in table_c.mapping:
        allocator.incr_ref(phy)

    # C 尝试生成新 token(触发 Copy-on-Write)
    table_c.copy_on_write(0)  # 逻辑块 0 的 ref_count > 1, 触发 CoW
    table_c.append_token()
    print(f"Request C after CoW: {table_c.num_tokens} tokens, "
          f"blocks={table_c.get_physical_blocks()}")
    # 输出: Request C after CoW: 11 tokens, blocks=[5, ...]
    # 注意: P0 被 A 独占, C 获得了新块 P5

    # 释放请求 A
    table_a.free_all()
    print(f"After freeing A, free blocks count: {len(allocator.free_blocks)}")
```

**代码与理论的对应关系**：
- `BlockAllocator.allocate()` 对应公式中的"从 Free List 取出一个空闲物理块"; 
- `BlockTable.append_token()` 对应公式 $\lceil s / K \rceil$ 的动态分配逻辑; 
- `BlockTable.copy_on_write()` 对应 CoW 机制：当 `ref_count > 1` 时分配新块并更新映射; 
- `internal_fragmentation()` 精确实现了碎片公式 $\text{waste} = n \cdot K - s$. 

## 7. 局限性与边界条件 (Limitations & Boundary Conditions)

PagedAttention 和 vLLM 虽然演进性地解决了 KV Cache 的内存碎片问题, 但世界上没有包治百病的算法. 在特定场景下, PagedAttention 会暴露出新的瓶颈和局限. 

### 7.1 Prefix Caching 的实现复杂度

虽然 PagedAttention 的 Block Table 天然支持前缀共享(Prefix Sharing), 但在实际工程中**精确地识别和复用前缀**远比理论描述复杂. 

首先, **前缀匹配的开销**. 当一个新的请求到达时, 系统需要判断它的 prompt 是否与当前已缓存的某个前缀匹配. 如果采用朴素的全字符串比对, 时间复杂度为 $O(L_{prefix})$, 在 prefix 很长(比如 10000+ token)或并发请求很多时, 这种比对本身会成为 CPU 瓶颈. 

更实用的方案是基于**哈希(Hashing)** ：为每个 block 的 token 序列计算一个哈希值, 通过哈希表快速查找可共享的块. vLLM 在后续版本中引入了这种基于哈希的 Prefix Caching. 但哈希碰撞的处理、增量哈希的计算、以及 block 粒度的匹配(只能匹配完整的 block, 不能匹配 block 内部的一部分)都增加了系统的工程复杂度. 

其次, **Prefix Caching 的命中率问题**. Prefix Caching 只有在多个请求共享大量相同前缀时才有效. 在以下场景中, 它的价值有限：
- 完全随机的用户输入, 没有共同前缀; 
- 系统提示词很短(比如只有 10 个 token), 而 block size = 16, 此时系统提示词甚至不足一个 block, 无法被有效共享; 
- 请求到达时间间隔很长, 之前缓存的物理块已经被释放. 

### 7.2 多模态模型的变长 Block 需求

PagedAttention 假设所有 token 的 KV Cache 具有**相同的大小**. 这对于纯文本 LLM 是成立的——每个 token 对应固定维度的 K 和 V 向量. 然而, 在多模态模型(如 GPT-4V、LLaVA、Qwen-VL)中, 输入不仅包含文本 token, 还包含图像 patch. 

图像的编码方式通常是将图片分割为 $N \times N$ 的 patch, 每个 patch 被编码为一个"视觉 token". 这些视觉 token 的数量可能因输入图片的分辨率而异：一张 $224 \times 224$ 的图片可能被编码为 196 个视觉 token, 而一张 $1024 \times 1024$ 的图片可能被编码为 1024 个视觉 token. 

更关键的是, 某些多模态架构(如 ViT-based 的Encoder )中, 不同 layer 的 KV Cache 大小可能不一致, 或者视觉 token 的维度与文本 token 不同. PagedAttention 固定大小 block 的假设在此被打破. 

一个可能的解决方案是**变长 block(Variable-Size Blocks)** , 但这会重新引入外部碎片的问题. 另一个方案是**为视觉和文本分别维护独立的 block allocator**, 但这增加了调度器的复杂度. 截至 2025 年, vLLM 对多模态的支持仍在快速演进中, 变长序列的内存管理依然是一个活跃的研究和工程课题. 

### 7.3 RadixAttention：SGLang 的改进与 vLLM 的回应

**SGLang** 是由斯坦福大学、加州大学伯克利分校等机构开发的开源 LLM 推理框架, 它在 vLLM 的基础上提出了 **RadixAttention** 机制, 进一步扩展了 Prefix Caching 的能力. 

RadixAttention 的核心洞察是：vLLM 的 Prefix Caching 本质上是"块级别的哈希匹配", 而 SGLang 将其提升为**"Radix Tree(基数树)级别的自动缓存与驱逐"**. 具体来说：
- SGLang 维护一个 Radix Tree, 其中每个节点代表一个 token(或一个 block 的 token 序列); 
- 当新的请求到达时, 它在 Radix Tree 中沿着最长公共前缀路径向下遍历; 
- 匹配到的节点对应的 KV Cache 直接复用, 未匹配的部分则新建分支; 
- 采用 LRU(Least Recently Used)策略驱逐不常用的分支, 释放物理块. 

RadixAttention 的优势在于：
1. **细粒度前缀匹配**：不仅限于 block 边界, 可以在 token 级别找到最长公共前缀; 

2. **自动缓存管理**：无需显式配置哪些前缀应该被缓存, 系统自动发现热点前缀; 

3. **对话历史复用**：在多轮对话中, 当前轮次可以复用之前轮次的大部分 KV Cache, 而 vLLM 的早期版本需要手动管理这种状态复用. 

作为回应, vLLM 在后续版本中也引入了越来越强大的 Prefix Caching 功能, 包括基于哈希的自动前缀匹配. 两者的竞争推动了整个 LLM 推理生态在内存管理上的快速进步. 

### 7.4 长上下文下 Block Table 的内存开销

虽然 PagedAttention 极大地减少了 KV Cache 的内存浪费, 但 Block Table 本身也占用内存. 对于**极长上下文**(如 100K、1M token)的场景, Block Table 的开销变得不可忽视. 

以 $K = 16$, 序列长度 $s = 1,000,000$ 为例：
- Block Table 条目数 = $\lceil 1,000,000 / 16 \rceil = 62,500$
- 每个条目存储一个物理块索引(4 字节整数)+ 可能的元数据(如是否已计算注意力)
- Block Table 内存 = $62,500 \times 8$ 字节 ≈ 500 KB 每个请求

这看起来不大, 但如果 Batch Size = 64, 总 Block Table 内存 = $64 \times 500$ KB = 32 MB. 32 MB 对于 GPU 显存来说可以忽略不计. 

然而, Block Table 在 GPU kernel 执行时通常需要被**频繁读取**. 在极长上下文的注意力计算中(如 FlashAttention 的变种), kernel 需要根据 Block Table 来 Gather KV Cache. 如果 Block Table 太大无法完全驻留在 L1/L2 Cache 中, 会导致**Cache Miss**, 从而增加内存访问延迟. 

更为根本的局限是, PagedAttention 的注意力 kernel 需要支持**不规则的内存访问模式**. 在标准 FlashAttention 中, Q、K、V 张量都是连续存储的, 可以通过高度优化的 coalesced memory access 模式达到接近峰值带宽的利用率. 而在 PagedAttention 中, K 和 V 分散在多个不连续的物理块中, kernel 需要通过 Block Table 中的索引进行间接寻址. 虽然 vLLM 的 CUDA kernel 已经做了大量优化(如将 Block Table 预加载到 shared memory), 但这种间接寻址的带宽利用率仍然略低于完全连续的情况. 

对于 100K+ 的长上下文, 一些新兴工作开始探索**分层分页(Hierarchical Paging)** 或**按需分页(On-Demand Paging)** 策略, 只在 GPU 上保留当前计算窗口附近的 KV Cache, 将远处的历史上下文卸载到 CPU 内存或 NVMe SSD, 通过 PCIe 或 NVLink 按需加载. 这些方法与 PagedAttention 并不矛盾, 而是对其在长上下文场景下的补充. 

### 7.5 调度器复杂度的边界

vLLM 的调度器虽然强大, 但其决策复杂度随着请求数量和服务等级目标(SLO)的增加而上升. 在极端高并发场景下：
- **抢占决策的延迟**：每次 iteration 结束后, 调度器需要快速决定哪些请求继续运行、哪些被抢占. 如果请求数达到数千, 调度算法的 $O(N)$ 或 $O(N \log N)$ 复杂度可能成为瓶颈. 

- **Starvation(饥饿)** ：如果系统持续高负载, 低优先级的长请求可能反复被抢占, 导致其完成时间无限延长. 需要设计公平的优先级调度策略(如 Aging)来防止饥饿. 

- **交换带宽瓶颈**：当大量请求的 KV Cache 被交换到 CPU 内存时, PCIe 带宽(通常 32-64 GB/s)可能成为瓶颈. GPU HBM 带宽(A100 为 2 TB/s)比 PCIe 快数十倍, 频繁的 swap-in/swap-out 会显著拖慢系统. 

## 8. 演进与承上启下 (Evolution & Segue)

### 8.1 从 PagedAttention 到 Prefix Caching 与 RadixAttention

PagedAttention 解决了 KV Cache 的"空间效率"问题, 但它并没有改变一个基本事实：**KV Cache 仍然随序列长度线性增长**. 对于极长上下文, 即使内存没有碎片,  sheer size 的 KV Cache 依然会压垮显存. 

这催生了两个方向的演进：

**方向一：更聪明的重用(Smarter Reuse)** 

vLLM 的 Prefix Caching 和 SGLang 的 RadixAttention 属于这一方向. 它们的核心思想是：**如果多个请求共享计算历史, 就不应该重复计算和存储**. 更形式化地描述, Prefix Caching 的本质是将原本每个请求独立存储的 KV Cache 转化为一个去重后的有效存储量. 设原始总需求为 $M_{KV}^{(raw)}$, 通过前缀共享实际节省的内存为 $M_{shared}$, 则系统真正需要承载的有效 KV Cache 规模为：

$$
M_{KV}^{(eff)} = M_{KV}^{(raw)} - M_{shared} \tag{58}
$$
RadixAttention 通过自动发现最长公共前缀, 最大化了 $M_{shared}$, 从而在数学上将 $M_{KV}^{(eff)}$ 压缩到接近理论下限. 

**方向二: KV Cache 压缩与量化(KV Cache Compression & Quantization)** 

另一个并行发展的方向是**对 KV Cache 本身进行压缩**. 既然 KV Cache 是内存瓶颈, 那为什么不把它存得更小? 这包括: 
- **KV Cache 量化(KV Cache Quantization)**: 将 FP16 的 K 和 V 压缩到 INT8, INT4, 甚至更低精度. 这可以将 KV Cache 内存占用直接减半或降至四分之一, 代价是微小的精度损失. 

- **低秩近似(Low-Rank Approximation)**: 利用 K 和 V 矩阵的低秩结构, 用更少的参数近似表示它们. 

- **逐层压缩(Layer-wise Compression)**: 对早期层的 KV Cache 做更激进的压缩, 因为早期层的信息通常更"粗糙". 

### 8.2 Speculative Decoding: 绕过 Decode 阶段的内存墙

PagedAttention 优化了内存利用率, 从而允许更大的 Batch Size, 间接提升了 GPU 计算利用率. 但 decode 阶段的**本质瓶颈**依然是内存带宽每个 iteration 的计算量极小, GPU 大部分时间在等待数据. 

**Speculative Decoding(推测解码)** 提供了一条绕过这一瓶颈的截然不同的路径. 其核心思想是: 与其让大模型一步一步地生成 token(每步一次前向传播), 不如让一个小模型(Draft Model)先"猜测"接下来几个 token 可能是什么, 然后让大模型(Target Model)一次性验证这一整串猜测. 如果猜测正确, 就一次 accept 多个 token; 如果猜测错误, 就回退到第一个错误的位置, 继续正常生成. 

从数学上看, 设小模型每次猜测 $K$ 个 token, 猜测的接受率为 $\alpha$(即大模型认可小模型猜测的比例), 则平均每次大模型前向传播可以生成 $1 + \alpha K$ 个 token. 如果 $\alpha = 0.8$, $K = 5$, 则平均每步生成 5 个 token, 相当于将 decode 速度提升了近 5 倍. 

PagedAttention 与 Speculative Decoding 是正交的优化PagedAttention 解决"如何高效存储 KV Cache", Speculative Decoding 解决"如何减少 decode steps 的数量". 在生产环境中, 两者通常结合使用, 达到 1+1 > 2 的效果. 

### 8.3 Disaggregated Serving: Prefill 与 Decode 的解耦

传统 LLM 推理服务中, 同一个 GPU 既负责 **Prefill 阶段**(处理输入 prompt, 计算量大, 并行度高, 计算密集型), 又负责 **Decode 阶段**(逐 token 生成, 计算量小, 串行度高, 内存带宽密集型). 这两个阶段对硬件资源的需求截然不同: 

| 阶段 | 计算类型 | 内存带宽需求 | 瓶颈 |
|-----|---------|------------|------|
| Prefill | 计算密集型(Compute-Bound) | 中等 | 峰值算力(FLOPS) |
| Decode | 内存带宽密集型(Memory-Bound) | 极高 | HBM 带宽 |

将两个阶段放在同一批 GPU 上运行, 导致资源利用的错配: 在 Prefill 阶段, 内存带宽有大量空闲; 在 Decode 阶段, Tensor Core 有大量空闲. 

**Disaggregated Serving(分离式服务)** 提出将 Prefill 和 Decode 分配到不同的 GPU 集群上: 
- **Prefill Workers**: 使用高算力, 中等带宽的 GPU 配置, 负责处理输入 prompt, 生成初始 KV Cache; 

- **Decode Workers**: 使用高带宽, 大显存的 GPU 配置, 负责逐 token 生成, 高效利用 PagedAttention 管理的大量 KV Cache; 
- 两个阶段之间通过高速网络(如 NVLink 或 InfiniBand)传递 KV Cache. 

这种架构将 PagedAttention 的内存管理从单节点扩展到了分布式场景. vLLM 的后续版本已经开始支持 Disaggregated Serving 的原型, 未来可能成为大规模推理服务的标准架构. 

### 8.4 未来的未解之谜

尽管 PagedAttention 已经取得了巨大的工程成功, LLM 推理的内存管理领域仍然存在诸多未解之谜: 

1. **超大规模上下文的 KV Cache 管理**: 当上下文长度达到百万级别(如处理整本书, 大型代码仓库), 即使 PagedAttention 消除了碎片, sheer volume 的 KV Cache 依然远超单节点显存. 如何在多节点之间高效分页, 迁移和压缩 KV Cache, 是一个开放的系统挑战. 

2. **动态 Block Size 的自适应**: 当前 vLLM 使用固定的 block size(16 或 32). 但工作负载的特征是动态变化的在高峰期请求短而多, 在低峰期请求长而少. 能否设计一个根据实时负载自适应调整 block size 的算法? 

3. **异构硬件上的 PagedAttention**: 随着 AI 加速器生态的多样化(AMD MI300, Google TPU, Intel Gaudi, 国产芯片), PagedAttention 的 CUDA 优化 kernel 需要被移植到不同的编程模型和内存架构上. 如何在保持性能的同时实现可移植性? 

## 9. 总结与参考文献 (References)

### 9.1 核心要点总结

1. **KV Cache 的内存爆炸**: 在 LLM 自回归推理中, 缓存历史 token 的 Key 和 Value 是将计算复杂度从 $O(S^2)$ 降至 $O(S)$ 的关键, 但代价是巨大的内存占用. 对于 Batch Size=64, 序列长度=4096, 80 层的 GQA 模型, KV Cache 可达 128 GB, 远超单张 GPU 的显存容量. 

2. **碎片的双重绞杀**: 传统静态连续分配策略导致严重的**内部碎片**(预分配远大于实际使用)和**外部碎片**(不连续空闲内存无法利用), 将 GPU 利用率压制在 30% 以下, 严重限制 Batch Size 和系统吞吐量. 

3. **PagedAttention 的核心思想**: 借鉴操作系统虚拟内存的分页机制, 将 KV Cache 划分为固定大小的物理块, 通过 **Block Table** 实现逻辑块到物理块的间接映射. 这种解耦彻底消除了外部碎片, 并将内部碎片率从 30%50% 降低到 1%5%. 

4. **Copy-on-Write 前缀共享**: 通过引用计数和写时复制机制, 多个请求可以共享相同的系统提示词前缀, 在典型场景下节省 50%90% 的前缀 KV Cache 内存. 

5. **vLLM 调度器**: 结合 **Continuous Batching**(迭代级动态批处理), **抢占**(Preemption)和**交换**(Swapping)机制, vLLM 在每个 decode step 都维持尽可能大的 batch, 将 GPU 利用率从 30% 提升至 80% 以上. 

6. **最优 Block Size 的权衡**: 物理块大小 $K$ 需要在内部碎片($K$ 越小越好)和映射开销($K$ 越大越好)之间取得平衡. 工程实践表明 $K = 16$ 或 $32$ 是 Sweet Spot. 

7. **局限与演进**: PagedAttention 在多模态变长输入, 极长上下文 Block Table 开销, 以及调度器复杂度等方面存在边界条件. 后续演进包括 Prefix Caching, RadixAttention, KV Cache 量化, Speculative Decoding 和 Disaggregated Serving. 

### 9.2 参考文献

- Kwon, W., Li, Z., Zhuang, S., Sheng, Y., Zheng, L., Yu, C. H., Gonzalez, J., Zhang, C., & Stoica, I. (2023). Efficient Memory Management for Large Language Model Serving with PagedAttention. *Proceedings of the 29th Symposium on Operating Systems Principles (SOSP 2023)*. https://arxiv.org/abs/2309.06180

- vLLM Documentation. https://docs.vllm.ai/

- vLLM GitHub Repository. https://github.com/vllm-project/vllm

- Zheng, L., Chiang, W. L., Sheng, Y., Zhuang, S., Wu, Z., Zhuang, Y., Lin, Z., Li, Z., Li, D., Xing, E. P., Zhang, H., Gonzalez, J. E., & Stoica, I. (2023). Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena. *NeurIPS 2023*. (vLLM 作为推理引擎的基准测试背景)

- Zheng, L., Yin, L., Xie, Z., Huang, J., Sun, C., Yu, C. H., Cao, S., Kozyrakis, C., Gonzalez, J. E., Barrett, C., & Stoica, I. (2024). SGLang: Efficient Execution of Structured Language Model Programs. https://arxiv.org/abs/2312.07104

- Miao, X., Oliaro, G., Zhang, Z., Cheng, X., Wang, Z., Wong, R. Y. Y., Zhu, A., Yang, L., Cai, S., & Cui, B. (2023). SpotServe: Serving Generative Large Language Models on Preemptible Instances. *ASPLOS 2024*. (抢占与调度相关)

- Patel, P., Choukse, E., Zhang, C., Shah, A., Goiri, I., Maleki, B., & Bianchini, R. (2024). Splitwise: Efficient generative LLM inference using phase splitting. *ISCA 2024*. (Disaggregated Serving 相关)

- Leviathan, Y., Kalman, M., & Matias, Y. (2023). Fast Inference from Transformers via Speculative Decoding. *ICML 2023*. (Speculative Decoding 基础)

- Hooper, C., Kim, S., Mohammadzadeh, H., Mahoney, M. W., Shao, Y. S., Keutzer, K., & Gholami, A. (2024). KVQuant: Towards 10 Million Context Length LLM Inference with KV Cache Quantization. https://arxiv.org/abs/2401.18079
