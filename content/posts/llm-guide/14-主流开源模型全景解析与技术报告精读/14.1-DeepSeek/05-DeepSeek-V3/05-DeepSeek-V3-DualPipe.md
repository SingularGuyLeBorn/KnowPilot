---
title: "DualPipe: 双向流水线并行的设计与工程实现"
---

# DualPipe: 双向流水线并行的设计与工程实现

>  **[返回 14.1-DeepSeek 家族总览](../../14.1-DeepSeek.md)**


> 本文聚焦 DeepSeek-V3 中 DualPipe 算法的核心设计原理、数学分析、工程实现细节,以及与 MoE + EP 架构的协同机制.

---

## 1 引言: 为什么需要 DualPipe

在大规模 Transformer 的训练中,流水线并行(Pipeline Parallelism, PP)是将模型按层切分到多个 GPU 上的标准做法. 然而,传统流水线存在一个根本性的效率瓶颈: **气泡时间(bubble time)**.

当 micro-batch 依次通过流水线阶段时,第一个 micro-batch 到达最后一个阶段之前,后续阶段处于空闲状态;同样,在反向传播阶段,当最后一个 micro-batch 完成反向传播后,前面的阶段也处于空闲. 这种空闲时间就是气泡.

对于 DeepSeek-V3 这样 671B 参数的 MoE 模型,训练时的挑战更加严峻:

1. **MoE 引入大量跨节点通信**: 专家并行(Expert Parallelism, EP)需要将每个 token 路由到持有目标专家的 GPU,产生频繁的 all-to-all 通信. 在跨节点场景下,计算-通信比约为 1:1.
2. **流水线阶段多**: 16 路 PP 意味着 16 个阶段,传统 1F1B 的气泡占比高达 $(PP-1)(F+B)$.
3. **不能用 TP 缓解**: DeepSeek-V3 刻意避免使用张量并行(TP),因为 TP 的频繁同步会分割注意力头的计算,降低效率.

DualPipe 的设计目标是:**在不用 TP 的前提下,通过双向流水线和计算-通信重叠,将气泡时间压缩到接近理论下限,同时将跨节点 all-to-all 通信几乎完全隐藏**.

> 这里的设计权衡值得仔细分析. 为什么不直接用 TP + 更少的 PP 阶段? TP 虽然减少了每卡的参数量,但其 all-reduce 通信在每个层内发生,且需要分割注意力头的计算,导致 SM(Streaming Multiprocessor)利用率下降. 相比之下,EP 的 all-to-all 虽然通信量更大,但发生在层与层之间,可以通过流水线调度来重叠. DualPipe 的核心洞察是:**通信的位置比通信的量更重要** —— 层间的 all-to-all 可以被流水线隐藏,而层内的 all-reduce 无法被隐藏.

---

## 2 流水线并行的演进谱系

### 2.1 GPipe: 填充-排空模式

GPipe(Narayanan et al., 2019)采用简单的填充-排空策略: 先让所有 micro-batch 完成前向传播,再让所有 micro-batch 完成反向传播.

气泡比例为:

$$
 \text{Bubble}_{\text{GPipe}} = (PP - 1)(F + B)
$$

其中 $F$ 是前向块执行时间, $B$ 是完整反向块执行时间. 对于 $PP=16$, 气泡时间为 $15(F+B)$,效率极低.

### 2.2 1F1B: 一前向一反向

1F1B(Harlap et al., 2018)采用交错调度: 每完成一个 micro-batch 的前向传播,立即启动该 micro-batch 的反向传播.

气泡比例与 GPipe 相同:

$$
 \text{Bubble}_{\text{1F1B}} = (PP - 1)(F + B)
$$

但 1F1B 的峰值激活内存仅为 $PP \times$ 单个 micro-batch 的激活,远小于 GPipe 的 $m \times PP$($m$ 为 micro-batch 数量).

### 2.3 ZB1P: ZeroBubble 一阶段

ZeroBubble(Qi et al., 2023)将反向块拆分为「输入反向」和「权重反向」两部分. 输入反向计算梯度相对于输入的导数(需要立即传递给前一层),权重反向计算梯度相对于权重的导数(可以延迟).

$$
 \text{Bubble}_{\text{ZB1P}} = (PP - 1)(F + B - 2W)
$$

其中 $W$ 是权重反向块的执行时间. 由于 $W < B$, ZB1P 的气泡比 1F1B 更小,但代价是增加了激活内存的保存时间.

### 2.4 Chimera: 双向流水线先驱

Chimera(Li et al., 2021)采用双向流水线,从流水线两端同时喂入 micro-batch,将参数内存翻倍以换取更少的气泡.

$$
 \text{Bubble}_{\text{Chimera}} \approx \frac{PP}{2}(F + B)
$$

Chimera 的局限在于: 要求 micro-batch 数量能被流水线阶段数 $PP$ 整除,这在实际中常常不满足. 此外,其激活内存为 $2 \times PP$,内存开销较大.

---

## 3 DualPipe 的核心设计

### 3.1 双向调度原理

DualPipe 的核心思想是在**一对独立的前向和反向块内重叠计算和通信**.

每个块被分成四个组件:

1. `attention`: 自注意力计算
2. `all-to-all dispatch`: 将 token 发送到目标专家所在的 GPU
3. `MLP`: 专家网络的 Feed-Forward 计算
4. `all-to-all combine`: 从专家 GPU 收集计算结果

对于反向块,`attention` 和 `MLP` 都被进一步分成两部分:
- **输入反向**: 计算梯度相对于输入的导数
- **权重反向**: 计算梯度相对于权重的导数

这与 ZeroBubble 的思路一致. 此外还有一个 `PP communication` 组件处理流水线阶段间的激活传递.

### 3.2 计算-通信重叠的时序编排

DualPipe 的关键创新在于**手动调整专用于通信与计算的 GPU SM 比例**.

对于一对前向和反向块,DualPipe 重新排列这些组件,使得:
- 当正向流执行 `all-to-all dispatch` 通信时,反向流恰好执行 `attention` 或 `MLP` 计算
- 当反向流执行 `all-to-all combine` 通信时,正向流恰好执行计算

这种重叠策略确保 all-to-all 和 PP 通信在执行期间都可以被完全隐藏.

> 译者注: 这种「手动编排」是 DualPipe 的工程精髓. 在 PyTorch 的默认调度中,计算和通信由 CUDA stream 自动管理,但调度粒度较粗,无法实现微秒级的精确同步. DeepSeek 团队编写了定制的 CUDA 内核,直接控制 warp 的调度,确保计算 SM 和通信 SM 的负载均衡. 这种底层优化在传统框架中很难实现,需要对 GPU 架构有极深的理解.

### 3.3 双向流水线的调度图

完整的 DualPipe 调度采用**双向流水线**: 正向流从输入层到输出层执行前向传播,反向流从输出层到输入层执行反向传播.

以 8 个 PP 秩和 20 个 micro-batch 为例:
- 正向方向的 micro-batch 从秩 0 向秩 7 流动
- 反向方向的 micro-batch 从秩 7 向秩 0 流动
- 共享黑色边框的两个单元格具有相互重叠的计算和通信

这种双向调度使得流水线中的大部分阶段在任何时刻都有计算在进行,而不是等待通信完成.

---

## 4 数学分析

### 4.1 气泡公式对比

| 方法 | 气泡公式 | 参数内存 | 激活内存 | 约束条件 |
|------|---------|---------|---------|---------|
| 1F1B | $(PP - 1)(F + B)$ | $1\times$ | $PP$ | 无 |
| ZB1P | $(PP - 1)(F + B - 2W)$ | $1\times$ | $PP$ | 无 |
| Chimera | 约 $\frac{PP}{2}(F + B)$ | $2\times$ | $2 \times PP$ | micro-batch 能被 $PP$ 整除 |
| **DualPipe** | $(\frac{PP}{2} - 1)(F\&B + B - 3W)$ | $2\times$ | $PP + 1$ | 阶段和 micro-batch 能被 2 整除 |

其中:
- $F$: 前向块执行时间
- $B$: 完整反向块执行时间
- $W$: 权重反向块执行时间
- $F\&B$: 两个相互重叠的前向和反向块的执行时间

### 4.2 数值对比

对于 $PP = 16$:

- **1F1B 气泡**: $15(F + B)$
- **ZB1P 气泡**: $15(F + B - 2W)$
- **Chimera 气泡**: 约 $8(F + B)$
- **DualPipe 气泡**: $7(F\&B + B - 3W)$

由于 $F\&B$ 是重叠后的时间(远小于 $F+B$),且 $W$ 通常约为 $B$ 的一半:

$$
 F\&B \approx \max(F, B_{\text{input}}) \ll F + B
$$

因此:

$$
 \text{Bubble}_{\text{DualPipe}} \approx 7(B_{\text{input}} + B - 3W) \approx 7 \times 0.5B = 3.5B
$$

$$
 \text{Bubble}_{\text{1F1B}} = 15(F + B) \approx 15 \times 2F = 30F \approx 30B
$$

DualPipe 的气泡约为 1F1B 的 **1/8 到 1/10**.

### 4.3 内存开销分析

DualPipe 的内存开销主要来自两个方面:

**参数内存**: 需要保存两份模型参数($2\times$),因为反向传播需要同时访问前向的参数.

> 在 DeepSeek-V3 的场景下,这是可接受的: EP 已经将专家参数分散到大量 GPU 上,单卡参数量不大. 具体而言,总参数 671B 中,37B 为激活参数,专家参数分布在 64 个 EP 组上,每组约 10B 参数. 即使保存两份,也仅约 20B,在 H800 的 80GB 显存中只占 25%.

**激活内存**: 峰值激活内存为 $PP + 1$,比 Chimera 的 $2 \times PP$ 更省.

> 这里需要澄清一个常见的误解: $PP + 1$ 不是 $PP$ 的 micro-batch 加上 1 个额外的 micro-batch,而是指在峰值时刻需要同时保存 $PP$ 个正向激活和 1 个反向激活. 与 1F1B 的 $PP$ 相比,仅增加了 $\frac{1}{PP}$ 的比例 —— 对于 $PP=16$,仅增加 6.25%.

---

## 5 工程实现细节

### 5.1 SM 的划分策略

DualPipe 要求对 GPU 的 SM 进行精细划分. 在 H800 上,每个 GPU 有 132 个 SM.

DeepSeek 的划分策略:
- **计算 SM**: 约 112 个,负责 attention、MLP 和反向计算
- **通信 SM**: 约 20 个,负责 all-to-all dispatch/combine 和 PP communication

通信 SM 使用 **warp specialization** 技术: 将 20 个 SM 分成 10 个通道,每个通道 2 个 SM,分别处理 IB(InfiniBand)和 NVLink 的通信. 这种设计使得 IB 和 NVLink 的传输可以完全重叠.

### 5.2 定制 CUDA 通信内核

为了确保 DualPipe 有足够的计算性能,DeepSeek 定制了高效的跨节点 all-to-all 通信内核.

内核的实现与以下因素协同设计:
- **MoE 门控算法**: 路由决策决定了 token 需要发送到哪些 GPU
- **集群网络拓扑**: IB(50GB/s)和 NVLink(160GB/s)的分层传输策略
- **SM 分配**: 通信内核只占用 20 个 SM,其余留给计算

### 5.3 与 MTP 的物理参数共享

DualPipe 的另一个工程巧思是将模型的**最浅层**(嵌入层)和**最深层**(输出头)部署在同一个 PP 秩上.

这种安排使得 MTP(Multi-Token Prediction)模块和主模型之间可以**物理共享**嵌入和输出头的参数和梯度. 如果没有这种物理共享,MTP 模块需要独立的嵌入和输出头参数,显存开销会翻倍.

> 译者注: 这种「首尾相连」的布局不是偶然的. 在标准流水线中,嵌入层在秩 0,输出头在秩 $PP-1$,两者相距最远. DualPipe 的双向调度天然允许将两端折叠到同一个秩上,因为正向流从秩 0 开始,反向流从秩 $PP-1$ 开始,在 DualPipe 中两者同时活跃. 这种布局使得 MTP —— 一个额外的预测头 —— 可以零额外显存开销地附加到主模型上.

---

## 6 DualPipe × MoE × EP 的协同效应

DualPipe 不是孤立的技术,它与 DeepSeek-V3 的其他设计形成了紧密的协同:

### 6.1 与 MLA 的协同

MLA 将 KV Cache 压缩了约 57 倍(从 $d_{kv}=128$ 维压缩到 $d_c=512$ 维的低秩向量),显著减少了内存带宽压力. 当内存带宽不再是瓶颈后,FP8 的计算加速效果更容易被充分利用.

### 6.2 与 FP8 的协同

FP8 训练将矩阵乘法的吞吐量提升了约 2 倍(H100 Tensor Core 的 FP8 峰值是 FP16 的两倍). 更高的计算吞吐量意味着每个块的执行时间 $F$ 和 $B$ 缩短,进一步压缩了气泡的绝对时间.

### 6.3 与 MoE + EP 的协同

MoE 的稀疏激活减少了每个 token 的计算量,但增加了 all-to-all 通信. DualPipe 通过计算-通信重叠隐藏了这部分开销. 三者结合的结果是:

| 因素 | 优化效果 |
|------|---------|
| MLA | KV Cache 压缩 57 倍,减少内存带宽瓶颈 |
| MoE | 每个 token 只激活 37B/671B ≈ 5.5% 参数,减少计算量 |
| FP8 | 矩阵乘法吞吐翻倍,加速计算 |
| DualPipe | 隐藏 95% 跨节点通信,等效加速约 1.9 倍 |

> 译者注: 上述各因素的加速倍数不是简单相乘的关系,因为它们作用于不同的瓶颈. MLA 主要缓解内存带宽瓶颈,MoE 减少计算量,FP8 提升计算吞吐量,DualPipe 隐藏通信延迟. 在实际的训练流水线中,这些优化是协同作用的: 当 MLA 减少了内存带宽压力后,FP8 的计算加速效果更容易被充分利用; 当 DualPipe 隐藏了通信后,MoE 的稀疏激活才能真正发挥计算节省的优势. 这种「算法-框架-硬件」的协同设计是 DeepSeek-V3 训练成本极低的核心原因,而非任何单一技术的突破.

---

## 7 局限性与适用边界

### 7.1 内存代价

DualPipe 需要保存两份模型参数,这对小显存 GPU 不友好. 在单卡显存 < 40GB 的场景下,双份参数可能无法容纳.

### 7.2 约束条件

DualPipe 要求流水线阶段数 $PP$ 和 micro-batch 数量都能被 2 整除. 虽然比 Chimera 的「能被 $PP$ 整除」更宽松,但仍然对超参数选择有一定限制.

### 7.3 实现复杂度

DualPipe 的 SM 手动调度和定制 CUDA 内核需要极高的工程投入. 对于没有专门 CUDA 团队的研究者来说,复现 DualPipe 的完整性能是很困难的.

### 7.4 不适用场景

- **非 MoE 模型**: 对于 Dense 模型,EP 带来的 all-to-all 通信不存在,DualPipe 的优势不那么明显
- **小规模集群**: 在节点数少、IB 带宽充足的场景下,通信本身就不是瓶颈
- **需要 TP 的场景**: 如果模型层太宽(如 Llama-3.1 405B 的 16K 隐藏维度),不用 TP 会导致单卡放不下单层参数

---

## 8 技术谱系与影响

### 8.1 直接继承自

- **ZeroBubble**(Qi et al., 2023): 反向块拆分(输入反向/权重反向)
- **Chimera**(Li et al., 2021): 双向流水线调度
- **1F1B**(Harlap et al., 2018): 基本的流水线交错策略

### 8.2 核心创新

1. **双向 + 计算通信重叠**: 不是简单的双向流水线,而是将通信和计算在 SM 级别精确重叠
2. **SM 手动调度**: 绕过 PyTorch 自动调度,直接控制 warp 分配
3. **首尾相连布局**: 将嵌入层和输出头放在同一秩,支持 MTP 零开销共享

### 8.3 被后续工作引用/影响

- DeepSeek-V3.1/V3.2 继续沿用 DualPipe
- 社区出现了多个开源复现尝试(如 Megatron-LM 的 DualPipe 适配)
- 影响了后续模型对「不用 TP」路线的信心

---

## 附录 A: 术语表

| 英文术语 | 中文译名 | 说明 |
|---------|---------|------|
| PP | 流水线并行 | 将模型按层切分到多个 GPU |
| EP | 专家并行 | 将专家网络分布到多个 GPU |
| TP | 张量并行 | 将层内参数切分到多个 GPU |
| SM | 流式多处理器 | GPU 的计算单元 |
| IB | InfiniBand | 高速网络互连技术 |
| NVLink | NVIDIA 高速互联 | GPU 间直连通信 |
| Bubble | 气泡时间 | 流水线中的空闲等待时间 |
| Micro-batch | 微批次 | 流水线的最小调度单元 |
| Warp | 线程束 | GPU 调度的基本单位(32 线程) |

## 附录 B: 核心公式索引

| 编号 | 公式 | 说明 |
|------|------|------|
| (1) | $\text{Bubble}_{\text{1F1B}} = (PP - 1)(F + B)$ | 1F1B 气泡公式 |
| (2) | $\text{Bubble}_{\text{ZB1P}} = (PP - 1)(F + B - 2W)$ | ZB1P 气泡公式 |
| (3) | $\text{Bubble}_{\text{Chimera}} \approx \frac{PP}{2}(F + B)$ | Chimera 气泡公式 |
| (4) | $\text{Bubble}_{\text{DualPipe}} = (\frac{PP}{2} - 1)(F\&B + B - 3W)$ | DualPipe 气泡公式 |
| (5) | $\text{Mem}_{\text{param}} = 2\times$ | DualPipe 参数内存 |
| (6) | $\text{Mem}_{\text{act}} = PP + 1$ | DualPipe 激活内存 |

---

*本文档基于《01-DeepSeek-V3技术报告精译.md》的 DualPipe 章节进行深度剖析与独立整理.*
