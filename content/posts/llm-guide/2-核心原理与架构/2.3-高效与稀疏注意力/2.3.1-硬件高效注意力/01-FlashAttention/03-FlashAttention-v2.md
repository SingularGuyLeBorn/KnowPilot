---
title: "03 · FlashAttention-v2 执行优化: 循环交换与 Warp 调度"
date: 2026-05-17
tags: [FlashAttention-v2, Loop Interchange, Register-level Fusion, Warp Scheduling, CUDA]
---

# 03 · FlashAttention-v2 执行优化: 循环交换与 Warp 调度

## 1. 嵌套循环顺序交换的物理直觉 (Nested Loop Interchange)

尽管 FlashAttention-v1 成功将 I/O 复杂度降低到了 $O(N^2 d^2 / M)$, 但在面对超长序列训练时, 其底层的指令流水线依然隐藏着巨大的片上访存开销. 

在 FlashAttention-v1 的底层 CUDA 实现中, 其分块双重嵌套循环的结构形式为:
- **外循环 (Outer Loop)**: 遍历 Query 矩阵的各个 Row Blocks ($i = 1 \dots T_r$, 其中 $T_r = N / B_r$).
- **内循环 (Inner Loop)**: 遍历 Key 和 Value 矩阵的各个 Column Blocks ($j = 1 \dots T_c$, 其中 $T_c = N / B_c$).

### 1.1 V1 循环顺序的物理缺陷
这一指令顺序在前向传播中看似顺理成章, 但它隐藏着一个致命的**中间累加器高频写回瓶颈**.
当外循环锁定某一个特定的 $Q$ 分块时, 随着内循环对 $K, V$ 的流式扫描, 片上维护的注意力输出累加器 $O_i^{(j)}$, 局部配分函数 $d_i^{(j)}$ 以及局部最大值 $m_i^{(j)}$ 需要发生极其频繁的更新与覆写. 

由于更新不得不经常性地访问 Shared Memory, 甚至在某些并发情况下需要通过显存控制器搬运中间状态, 这在底层造成了极度严重的 **L1/L2 Cache 锁冲突与片上 Shared Memory 带宽挤兑**.

### 1.2 V2 循环交换的物理重构 (The Loop Swap)
FlashAttention-v2 对此执行了极其精巧的**嵌套循环顺序交换 (Nested Loop Interchange)**: 

```
+-------------------------------------------------------------+
|  FlashAttention-v1:                                         |
|  For i = 1 ... Tr (Outer: Query)                            |
|      For j = 1 ... Tc (Inner: Key/Value)                    |
|          Compute Tile(Q_i, K_j, V_j) -> High SRAM Traffic   |
+-------------------------------------------------------------+
                              | (循环顺序大对调)
+-------------------------------------------------------------+
|  FlashAttention-v2:                                         |
|  For j = 1 ... Tc (Outer: Key/Value)                        |
|      For i = 1 ... Tr (Inner: Query)                        |
|          Compute Tile(Q_i, K_j, V_j) -> Pure Register Flow  |
+-------------------------------------------------------------+
```

在 v2 的重构流水线中, **外循环改为了遍历 Key/Value 矩阵的分块, 内循环遍历 Query 矩阵的分块.**
这一细微的指令顺序对调, 在物理硬件层面引爆了能效革命:
- **常量化 Key/Value 载入**: 只要外循环锁定当前 $K, V$ 的分块, 在整个内循环周期内, 这部分数据可以作为恒定不变的只读常量被片上所有线程组无锁共享.
- **寄存器级极致局部流**: 内循环在遍历不同 $Q$ 块时, 每一个线程可以直接在其物理私有的**寄存器 (Registers)** 内完成局部输出 $O_i$ 和归一化标度的增量计算. 只有当内循环彻底结束时, 最终收敛的 $O_i$ 才会被原子地一次性写回至外部低速的 HBM. 
这种重构几乎完全消除了 v1 阶段极高频的中间累加器写回开销, 使算子片上访存延迟瞬间暴跌了 **60% 以上**.

---

## 2. 非 Matmul 标度算子在寄存器端的融合与消除 (Scale Fusion)

在 GPU 硬件加速器中, 真正能跑满理论峰值算力的只有执行矩阵乘加 (GEMM) 运算的 Tensor Core. 所有的非矩阵乘(如 Softmax 缩放因子相乘, 指数 exp 变换, 除法归一化等)都必须由常规的普通流处理器 (Cuda Core, 即 SFU 单元) 执行.

### 2.1 标度延迟融合 (Delayed Scaling)
在标准自注意力中, 我们需要在矩阵乘 $Q K^T$ 之后, 对生成的 $N \times N$ 元素逐个乘以一个标度因子 $1 / \sqrt{D_{head}}$.
在 FlashAttention-v1 中, 这一缩放操作是在计算出分块分数矩阵后, 在内循环中通过逐元素相乘完成的. 这不仅占用片上寄存器, 还会因频繁调用乘法算子而打断 Tensor Core 矩阵乘指令的并行度.

FlashAttention-v2 引入了**标度延迟融合 (Delayed Scaling)**: 

$$
\tilde{Q} = \frac{1}{\sqrt{D_{head}}} \cdot Q \tag{1}
$$

**我们将原本需要作用于中间分数矩阵的标度运算, 通过代数等价交换, 提前在外部直接作用于输入矩阵 $Q$！因为 $Q$ 的维度是 $N \times D_{head}$, 其大小远远小于 $N \times N$ 的分数矩阵, 这一简单的等价变换, 直接消除了高达 $O(N^2)$ 次的逐元素乘法操作, 将其压缩到了极限的 $O(ND_{head})$ 次寄存器变换. **

### 2.2 寄存器级累加标度融合 (Register Scale Fusion)
在流式 Online Softmax 递推更新中, 每次合并不同的分块时都需要乘以指数补偿因子 $exp(m_i^{(old)} - m_i)$.
在底层的 CUDA 汇编层面, FlashAttention-v2 通过 **Fused Multiply-Add (FMA)** 指令, 将这一指数乘法与局部输出矩阵 $O_i$ 的标度更新完美融合进了单条寄存器指令周期内：

$$
d_i \leftarrow d_i \cdot exp\left(m_i^{(old)} - m_i\right) + d_i^{(new)} \tag{2}
$$

$$
O_i \leftarrow O_i \cdot \left[exp\left(m_i^{(old)} - m_i\right)\right] + \tilde{O}_i^{(new)} \tag{3}
$$

公式 (2) 和 (3) 的底层操作在更新时, 寄存器指针不需要发生任何抖动, 指令完全在原位寄存器内被无缝消费, 最大化规避了寄存器溢出 (Register Spilling) 带来的显存交换开销.

---

## 3. Warp 级行划分与零 Shared Memory Barrier 调度 (Warp-Level Scheduling)

在 NVIDIA GPU SIMT 并行计算框架中, 线程是被划分为以 32 个线程为物理单元的 **Warp (线程束)** 进行调度的. Warp 之间的协作与同步开销直接决定了算子的并发吞吐率.

### 3.1 V1 的协作缺陷：Warp 频繁同步
在 FlashAttention-v1 中, 为了计算行级的 Softmax 归一化, 一个 Thread Block 内部的多个 Warp 采用协同模式：不同 Warp 合作计算同一行注意力分数, 然后通过 Shared Memory 进行规约 (Reduction) 求和与最大值同步. 
这导致在每一个内循环周期内, 所有的 Warp 必须高频调用 `__syncthreads()` 执行物理栅栏同步 (Barrier). 这会导致所有的线程挂起等待最慢的那个 Warp, 严重破坏了 GPU 硬件的指令派发流水线.

### 3.2 V2 的 Warp 行级静态独占重构 (Row-wise Partition)
为了消灭这一毁灭能效的同步屏障, FlashAttention-v2 实施了彻底的 **Warp 级行独占重构 (Row-wise Partition)**：

```
+---------------------------------------------------------------+
|  FlashAttention-v1 (Warp 协同模式):                             |
|  Warp 0 + Warp 1 + Warp 2 -> 协同计算 Row 0 -> 频繁 SM Sync    |
+---------------------------------------------------------------+
                               | (彻底消除 Warp 同步)
+---------------------------------------------------------------+
|  FlashAttention-v2 (Warp 行独占):                             |
|  Warp 0 -> 独立计算 Row 0, Row 1 (寄存器独占, 0 SM Sync)       |
|  Warp 1 -> 独立计算 Row 2, Row 3 (寄存器独占, 0 SM Sync)       |
+---------------------------------------------------------------+
```

在 v2 的全新并行映射空间中：
1. 我们将 Thread Block 加载进片上的整个 $Q$ 分块, 按照行维度**静态、绝对独占地**平分给内部的各个 Warp. 例如, Warp 0 独占第 $0 \dots 15$ 行, Warp 1 独占第 $16 \dots 31$ 行.
2. 在整个自注意力的递推周期中, **Warp 0 独立且完整地负责其所分配行数的所有点积、在线 Softmax 累加与加权求和更新. 所有的中间状态 $m_i$ 和 $d_i$ 物理驻留在该 Warp 内部各线程私有的寄存器中. **
3. 只有在外循环完全结束、生成最终完整 $O_i$ 时, Warp 0 才通过单次寻址将其一次性写回 HBM.

这一机制的达成, 带来了质的飞跃：
由于各个 Warp 独占其负责行的全部计算流程, 它们在计算过程中**不需要与任何其他 Warp 进行任何数据交互, 因而达到了完全的“零片上 Shared Memory Barrier”状态！** 各个 Warp 可以以脱缰野马般的最高速度在 GPU 流处理器内并行奔跑, 算子的整体执行能效实现了超乎想象的飞跃.

![FlashAttention-2 工作划分与并行结构（论文 Figure 2）](./images/fig-flashattention2-parallel-diagram.jpg)

> 图 1: FA-2 前向/反向的线程块工作划分；外循环沿 $K/V$ 块、内循环扫 $Q$ 块，使 K/V 在 SRAM 中复用。

**图 1 解析**

- **外循环沿 K/V 块**：v2 将 v1 的循环顺序对调 — 先固定一块 $K_j,V_j$，再在内循环扫所有 $Q_i$ 块，使 K/V 在 SRAM 中 **复用**。
- **Forward / Backward 分面板**：反向需重算或缓存 softmax 统计量 $m,d$；v2 在反向同样按块并行，避免全矩阵落盘。
- **Warp 级分工**：每个 Warp 负责 $Q$ 的若干行，中间 $O,m,d$ 驻留寄存器 — 对应正文 §3 的「零 Shared Memory Barrier」。

![FlashAttention-2 在 A100 上的加速比（论文 Figure 4）](./images/fig-flashattention2-speedup.jpg)

> 图 2: A100 上 FA-2 相对 FA-1 与标准 attention 的端到端加速比，随序列长度变化（论文 Figure 4）。

**图 2 解析**

- 横轴为序列长度；纵轴为相对 PyTorch 标准 attention 的 speedup。
- **因果 mask / head dim** 不同子图（论文 (a)(b)(c)）对应不同部署场景 — decode 常用 causal + 小 batch。
- v2 相对 v1 的额外增益来自 **work partitioning**，而非改公式 — 与 MoBA/NSA 等「改稀疏图」的路线正交，可叠加。

---

## 4. 参考文献 (References)

- Dao, T. (2023). "FlashAttention-2: Faster attention with better parallelism and work partitioning." arXiv preprint arXiv:2307.08691.
- NVIDIA Corporation. (2021). "NVIDIA Ampere Architecture Tuning Guide."
