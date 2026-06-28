---
title: "Attention 实现方式全景对比: 从手动实现到 FlashAttention"
date: 2026-05-17
tags: [Attention, SDPA, FlashAttention, xFormers, 性能优化, CUDA, GPU]
---

# 04 Attention 实现方式全景对比: 从手动实现到 FlashAttention

> 来源: 知乎专栏 (https://zhuanlan.zhihu.com/p/2029243648827467520)
> 标签: #Attention #SDPA #FlashAttention #xFormers #性能优化

---

## 1. 引言: 同样的 Attention, 不同的实现, 显著的效率

Attention 机制的数学定义是唯一的对于查询矩阵 $Q \in \mathbb{R}^{B \times N \times H \times D}$, 键矩阵 $K$ 和值矩阵 $V$, 输出由式 (1) 计算: 

$$
\text{Attention}(Q, K, V) = \text{softmax}\left(\frac{QK^T}{\sqrt{D}}\right)V \tag{1}
$$

式 (1) 中 $B$ 为批次大小, $N$ 为序列长度, $H$ 为注意力头数, $D$ 为每个头的维度. 然而, **实现这一公式的代码路径有数十种**, 从最朴素的 PyTorch 逐行实现到高度优化的 CUDA kernel, 性能差距可达 **10 倍以上**, 显存占用差距可达 **20 倍以上**. 

本文基于 H800 GPU 的实测数据, 系统对比四种主流实现方式: 手动实现, PyTorch SDPA, FlashAttention 和 xFormers. 我们将从计算复杂度, 内存访问模式, 硬件利用率三个维度展开分析, 并给出工业级的选型建议. 

---

## 2. 四种实现方式: 原理与适用场景

### 2.1 手动实现(Naïve PyTorch)

手动实现严格遵循式 (1) 的三步计算流程: 

**Step 1 计算注意力分数**: 

$$
S = \frac{QK^T}{\sqrt{D}} \tag{2}
$$

式 (2) 中 $S \in \mathbb{R}^{B \times H \times N \times N}$ 为注意力分数矩阵, 其计算量(FLOPs)为 $2 \cdot B \cdot H \cdot N^2 \cdot D$(每次乘加运算计 2 FLOPs). 

**Step 2 Softmax 归一化**: 

$$
A_{ij} = \frac{\exp(S_{ij})}{\sum_{k=1}^{N} \exp(S_{ik})} \tag{3}
$$

式 (3) 对每一行进行指数归一化, 产生注意力权重矩阵 $A \in \mathbb{R}^{B \times H \times N \times N}$. 

**Step 3 加权求和**: 

$$
O = AV \tag{4}
$$

式 (4) 的 FLOPs 同样为 $2 \cdot B \cdot H \cdot N^2 \cdot D$. 

**核心缺陷**: 
- **显存物化 $S$ 和 $A$**: $S$ 和 $A$ 均为 $B \times H \times N \times N$ 的浮点矩阵, 显存占用为 $2 \cdot B \cdot H \cdot N^2 \cdot 4\text{ bytes}$(FP32)或 $2 \cdot B \cdot H \cdot N^2 \cdot 2\text{ bytes}$(FP16)
- **三次独立的 HBM 读写**: $Q,K \to S$, $S \to A$, $A,V \to O$, 每次都要经过高延迟的 GPU 全局内存(HBM)
- **无算子融合**: PyTorch Eager 模式下的三个操作各自启动 CUDA kernel, 每次启动都有固定开销

### 2.2 SDPA(PyTorch 官方 `scaled_dot_product_attention`)

PyTorch 2.0+ 引入的 `F.scaled_dot_product_attention` 是一个**调度层(Dispatch Layer)**, 它根据输入参数和设备条件自动选择最优后端: 

| 后端 | 触发条件 | 技术特点 |
|:-----|:--------|:--------|
| FlashAttention-2 | CUDA + head_dim 128 + sm80+ | 内存重计算 + tiling |
| Memory-Efficient Attention | CUDA + 特定 shape | xFormers 风格的融合 kernel |
| CUBLAS | fallback | 标准矩阵乘法 |
| Math | CPU / 不支持的配置 | 标准 PyTorch 实现 |

SDPA 的核心价值在于**自动选择**: 开发者无需手动判断当前配置适合哪种实现, 框架自动完成调度. 其内部通过 CUDA Graph 或算子融合技术, 将式 (2)-(4) 的三步合并为一个 fused kernel, 消除了中间矩阵的 HBM 物化. 

### 2.3 FlashAttention

FlashAttention 的核心思想不是降低 FLOPs(式 (1) 的计算量下限不可突破), 而是**降低内存访问开销(Memory Access Cost, MAC)**. 其关键创新包括: 

**Tiling 分块策略**: 

将 $Q, K, V$ 按序列维度切分为小块(tile), 每块加载到快速的 SRAM(Shared Memory)中, 计算局部 softmax 后只输出聚合结果, 不存储中间注意力矩阵. 

**Online Softmax**: 

FlashAttention 采用 streaming 方式计算 softmax. 设当前已处理 $j$ 个 key, 累积的指数和为 $L_j = \sum_{k=1}^{j} \exp(m_k - m_j)$, 其中 $m_j = \max_{k \leq j} s_k$ 为当前最大值. 当新的 key $j+1$ 到来时: 

$$
m_{j+1} = \max(m_j, s_{j+1}) \tag{5}
$$

$$
L_{j+1} = L_j \cdot \exp(m_j - m_{j+1}) + \exp(s_{j+1} - m_{j+1}) \tag{6}
$$

式 (5)(6) 使得 softmax 可以在流式扫描中增量计算, 无需存储完整的 $N \times N$ 分数矩阵. 

**限制**: 
- head_dim 不能超过 256(当前版本)
- 需要 CUDA 11.6+ 和 sm80+(A100/H100)
- 不支持所有 Attention 变体(如局部 Attention, 稀疏 Attention)

### 2.4 xFormers

Meta 开源的 xFormers 库提供了**多种 Attention 变体的统一接口**: 

- `memory_efficient_attention`: 基于 CUTLASS 的通用融合 kernel
- `local_attention`: 滑动窗口 Attention
- `linformer_attention`: 低秩近似 Attention
- `nystrom_attention`: Nyström 方法近似

xFormers 的优势在于**灵活性**当 FlashAttention 不支持特定配置时, xFormers 通常有对应的实现. 但通用性带来的代价是: 在标准配置下, 其性能通常略低于专门优化的 FlashAttention 或 SDPA. 

---

## 3. 性能实测: H800 GPU 全维度对比

### 3.1 实验配置

| 参数 | 值 |
|:-----|:---|
| GPU | NVIDIA H800 (80GB) |
| CUDA | 12.2 |
| PyTorch | 2.3.1 |
| flash-attn | 2.7.4.post1 |
| xformers | 0.0.27 |
| 基准配置 | B=64, N=1024, H=16, D=64 |

### 3.2 变量一: Batch Size(固定 N=1024, H=16, D=64)

**计算耗时对比**: 

| batch_size | 手动实现 (s) | SDPA (s) | FlashAttention (s) | xFormers (s) | SDPA 加速比 |
|:----------|:------------|:---------|:-------------------|:-------------|:-----------|
| 1 | 0.00012 | 0.000037 | 0.000048 | 0.000084 | 3.2× |
| 8 | 0.00083 | 0.000134 | 0.000164 | 0.000186 | 6.2× |
| 64 | 0.00617 | 0.000897 | 0.000952 | 0.000980 | 6.9× |
| 512 | 0.04906 | 0.006859 | 0.007751 | 0.007593 | 7.2× |

**关键洞察**: SDPA 在所有 batch_size 下均保持 3~7 倍加速, 且优势随 batch_size 增大而扩大. 原因在于更大的 batch 更容易占满 GPU 的 Streaming Multiprocessor(SM), 减少 kernel 启动的固定开销占比. 

**显存占用对比**: 

| batch_size | 手动实现 (MB) | SDPA (MB) | FlashAttention (MB) | xFormers (MB) | SDPA 节省率 |
|:----------|:-------------|:----------|:--------------------|:--------------|:------------|
| 1 | 106 | 44 | 46 | 48 | 58.5% |
| 8 | 672 | 152 | 160 | 168 | 77.4% |
| 64 | 5152 | 996 | 1060 | 1124 | 80.7% |
| 512 | 40992 | 7744 | 8256 | 8768 | 81.1% |

显存节省的物理原因: 手动实现需要物化 $S$ 矩阵($B \times H \times N \times N$)和 $A$ 矩阵(同样大小), 而融合实现通过重计算(recomputation)消除了这一存储需求. 当 B=512 时, $S+A$ 的显存为 $2 \times 512 \times 16 \times 1024^2 \times 2\text{ bytes} = 32.5$ GB, 这正是手动实现与 SDPA 差距的主要来源. 

### 3.3 变量二: 序列长度(固定 B=64, H=16, D=64)

**计算耗时对比**: 

| seq_len | 手动实现 (s) | SDPA (s) | FlashAttention (s) | xFormers (s) |
|:--------|:------------|:---------|:-------------------|:-------------|
| 64 | 0.00011 | 0.000042 | 0.000054 | 0.000088 |
| 512 | 0.00177 | 0.000259 | 0.000281 | 0.000313 |
| 1024 | 0.00616 | 0.000902 | 0.000959 | 0.001000 |
| 4096 | 0.08889 | 0.013295 | 0.014418 | 0.014291 |

**复杂度分析**: Attention 的计算复杂度为 $O(N^2)$. 从数据可见, 当 seq_len 从 64 增加到 4096(64 倍), 手动实现的耗时从 0.00011s 增加到 0.08889s(约 808 倍), 接近理论上的 $64^2 = 4096$ 倍增长除以 GPU 并行度的饱和效应. 

**显存占用对比**: 

| seq_len | 手动实现 (MB) | SDPA (MB) | SDPA 节省率 |
|:--------|:-------------|:----------|:------------|
| 64 | 96 | 80 | 16.7% |
| 512 | 1568 | 514 | 67.2% |
| 1024 | 5152 | 996 | 80.7% |
| 4096 | 69664 | 3888 | **94.4%** |

长序列下显存节省尤为显著: seq_len=4096 时, 手动实现的 $S$ 矩阵大小为 $64 \times 16 \times 4096^2 \times 2\text{ bytes} \approx 34.4$ GB, 而 SDPA 通过重计算将这一开销完全消除. 

### 3.4 变量三: 注意力头数(固定 B=64, N=1024, D=64)

| num_heads | 手动实现 (s) | SDPA (s) | SDPA 加速比 | 手动实现 (MB) | SDPA (MB) | SDPA 节省率 |
|:----------|:------------|:---------|:------------|:-------------|:----------|:------------|
| 1 | 0.00038 | 0.000076 | 5.0× | 328 | 80 | 75.6% |
| 16 | 0.00615 | 0.000892 | 6.9× | 5152 | 996 | 80.7% |
| 128 | 0.04911 | 0.006860 | 7.2× | 40992 | 7744 | 81.1% |

头数变化不改变 Attention 的 $O(N^2)$ 复杂度, 但增加了总并行度. SDPA 的加速比稳定在 6~7 倍区间, 说明优化 kernel 的并行效率与头数基本无关. 

### 3.5 变量四: Head Dimension(固定 B=64, N=1024, H=16)

| head_dim | 手动实现 (s) | SDPA (s) | FlashAttention (s) | xFormers (s) | SDPA 加速比 |
|:---------|:------------|:---------|:-------------------|:-------------|:------------|
| 8 | 0.00514 | 0.00073 | 0.00075 | 0.00075 | 7.0× |
| 64 | 0.00617 | 0.00089 | 0.00095 | 0.00098 | 6.9× |
| 128 | 0.00737 | 0.00162 | 0.00158 | 0.00159 | 4.6× |
| 512 | 0.01564 | 0.01762 | | 0.01747 | **0.9×** |
| 2048 | 0.05152 | 0.07396 | | 0.07610 | **0.7×** |

**关键发现性能拐点**: 

当 head_dim 64 时, SDPA 保持 6~7 倍加速; 当 head_dim = 128 时, 加速比降至 4.6×; 当 head_dim 512 时, SDPA **反而比手动实现更慢**. 

物理原因分析: 

1. **Tensor Core 利用率**: NVIDIA Tensor Core 对矩阵乘法的加速效果在 $M \times N \times K$ 中 $K$ 为 8/16/32/64 的倍数时最优. 当 head_dim = 2048 时, $QK^T$ 的维度为 $(1024 \times 2048) \times (2048 \times 1024)$, 虽然绝对规模很大, 但分块策略(tiling)的 block size 无法完美匹配 Tensor Core 的 warp 大小, 导致利用率下降. 

2. **FlashAttention 的分块限制**: FlashAttention 的 tiling 策略在 SRAM 中同时缓存 $Q$, $K$, $V$ 块. SRAM 容量有限(A100 每 SM 为 164 KB), 当 head_dim 过大时, 单个 tile 的 $K$ 或 $V$ 块就占满 SRAM, 导致 tiling 粒度变粗, 重计算的收益降低. 当前 FlashAttention 实现 head_dim 上限为 256, 超过后直接 fallback 到标准实现. 

3. **显存带宽压力**: 大 dim 时 $Q, K, V$ 的显存占用增加($3 \times B \times N \times H \times D \times 2\text{ bytes}$), 数据传输时间占比上升. 当计算时间被内存带宽主导时, 手动实现与优化实现的差距缩小. 

**显存占用拐点**: 

| head_dim | 手动实现 (MB) | SDPA (MB) | SDPA 节省率 |
|:---------|:-------------|:----------|:------------|
| 8 | 4224 | 132 | **96.9%** |
| 64 | 5152 | 996 | 80.7% |
| 512 | 12320 | 9760 | 20.8% |
| 2048 | 34848 | 36896 | **-5.9%** |

head_dim=2048 时 SDPA 显存反超手动实现, 原因是 SDPA 的某些后端(如 Memory-Efficient Attention)需要额外的 workspace buffer 来存储中间结果, 当 dim 极大时这一开销超过了物化注意力矩阵的收益. 

---

## 4. 深层分析: Roofline 模型与内存访问模式

### 4.1 Roofline 模型视角

Roofline 模型将计算性能表示为: 

$$
\text{Performance} = \min\left(\text{Peak\_FLOPS}, \text{Memory\_Bandwidth} \times \text{Arithmetic\_Intensity}\right) \tag{7}
$$

式 (7) 中算术强度(Arithmetic Intensity)定义为每字节内存访问所执行的 FLOPs. 对于 Attention 操作: 

$$
\text{AI}_{\text{attention}} = \frac{4 \cdot B \cdot H \cdot N^2 \cdot D}{\text{total\_bytes\_moved}} \tag{8}
$$

**手动实现的内存访问**: 需要读取 $Q, K, V$($3 \cdot B \cdot N \cdot H \cdot D$), 写入 $S, A, O$($2 \cdot B \cdot H \cdot N^2 + B \cdot N \cdot H \cdot D$), 总计约 $2 \cdot B \cdot H \cdot N^2 \cdot 4$ bytes(FP32)或 $2 \cdot B \cdot H \cdot N^2 \cdot 2$ bytes(FP16). 

**融合实现的内存访问**: 仅需读取 $Q, K, V$ 和写入 $O$, 总计约 $4 \cdot B \cdot N \cdot H \cdot D$ bytes. 

因此, 融合实现的算术强度约为手动实现的 $\frac{N}{D}$ 倍. 当 $N \gg D$(长序列场景)时, 融合实现更容易达到 compute-bound 区域, 充分发挥 GPU 的峰值算力. 

### 4.2 为什么 SDPA 在长序列下优势更大? 

从实测数据看, seq_len=64 时 SDPA 仅比手动实现快 2.6 倍, 而 seq_len=4096 时快 6.7 倍. 这一趋势可以用内存墙(Memory Wall)解释: 

- **短序列**: $N$ 较小, $S$ 矩阵的显存占用不大($64 \times 16 \times 64^2 \times 2 = 8$ MB), 可以缓存于 L2 cache 中, 手动实现的内存访问惩罚不严重
- **长序列**: $N$ 较大, $S$ 矩阵的显存占用剧增($64 \times 16 \times 4096^2 \times 2 = 34.4$ GB), 远超 GPU 缓存容量, 每次访问都要经过 HBM. 融合实现通过消除 $S$ 和 $A$ 的存储, 将内存访问从 $O(N^2)$ 降低到 $O(N)$, 在长序列下的收益被放大

---

## 5. 工业选型决策树

### 5.1 快速决策表

| 场景 | 推荐实现 | 理由 |
|:-----|:--------|:-----|
| 生产环境(标准配置) | **SDPA** | 自动选择最优后端, 无需额外依赖 |
| 长序列训练(N > 2048) | **FlashAttention** | 显存优化最显著, 节省 80%+ |
| 需要 Attention 变体(稀疏/局部) | **xFormers** | 支持 Linformer, Local Attention 等 |
| 教学/调试/算法验证 | **手动实现** | 透明可控, 便于插入断点和可视化 |
| 超大 head_dim(D 512) | **手动实现或 SDPA math 后端** | 优化实现在大 dim 时可能负优化 |
| 边缘部署(CPU/无 CUDA) | **手动实现或 SDPA** | FlashAttention 需要 CUDA sm80+ |

### 5.2 配置推荐

**标准 LLM 训练**(如 LLaMA-2 7B: H=32, D=128): 
- 使用 SDPA 或 FlashAttention
- head_dim=128 时加速比约 4.6×, 显存节省约 68%

**视觉 Transformer**(如 ViT-Large: H=16, D=64): 
- 强烈推荐 SDPA/FlashAttention
- head_dim=64 时加速比 6.9×, 显存节省 80%

**长上下文模型**(如 128K 上下文): 
- FlashAttention 必选
- seq_len=4096 时显存节省 94.4%, seq_len 越大优势越明显

**超大嵌入维度实验**(如 D=1024 per head): 
- 考虑减少 num_heads(如 D=1024 H=8, D=128)
- 或使用低秩近似(Linformer)

---

## 6. 失效模式与边界条件

### 6.1 失效模式一: 大 Head Dimension 下的性能崩塌

**现象**: head_dim 512 时, SDPA/FlashAttention 加速比降至 1× 以下, 甚至显存反超手动实现. 

**根因**: 
- Tensor Core 利用率下降: warp 内的线程无法充分利用 MMA(Matrix Multiply Accumulate)指令的并行度
- FlashAttention tiling 失效: SRAM 无法容纳大块数据, 导致分块粒度变粗, 重计算开销上升
- workspace buffer 膨胀: 某些后端需要额外 buffer 存储中间累加结果

**应对**: 
- 将 head_dim 控制在 64~128(LLaMA/Qwen 的标准配置)
- 若必须使用大 dim, 减少 num_heads 以保持总 hidden_size 不变

### 6.2 失效模式二: FlashAttention 的 head_dim 上限

**现象**: head_dim > 256 时 FlashAttention 直接报错或 fallback. 

**根因**: 当前 FlashAttention-2 的 CUDA kernel 中, tile 的寄存器分配和 SRAM 使用针对 head_dim 256 优化. 更大的 dim 需要重新设计分块策略. 

**应对**: 
- 使用 SDPA(自动 fallback 到其他后端)
- 将注意力头拆分为多个小组

### 6.3 失效模式三: 因果掩码的额外开销

**现象**: 启用 causal mask(自回归生成)时, 某些后端的性能下降幅度不一致. 

**根因**: 
- FlashAttention 对 causal mask 有专门优化(跳过下三角计算), 开销极小
- 手动实现中 causal mask 需要构造 $N \times N$ 的下三角矩阵并加到 $S$ 上, 增加 $N^2$ 的显存和计算
- xFormers 的 `LowerTriangularMask` 实现较通用, 优化不如 FlashAttention 激进

**应对**: 
- 自回归训练/推理优先使用 FlashAttention
- 避免手动构造 dense causal mask

### 6.4 失效模式四: Batch Size 过小导致 GPU 利用率不足

**现象**: batch_size=1 时, SDPA 仅比手动实现快 3.2×, 远低于 batch_size=512 时的 7.2×. 

**根因**: GPU 的 SM(Streaming Multiprocessor)数量为 100+(H800 有 132 个 SM), batch_size=1 时仅占用少量 SM, 大量计算资源空闲. kernel 启动的固定开销(约 5~10 μs)在总时间中占比上升. 

**应对**: 
- 训练时尽量使用较大的 batch_size(或通过梯度累积模拟)
- 推理时使用 continuous batching(vLLM 的 PagedAttention)合并多个请求

---

## 7. 代码示例: 四种实现的核心调用

```python
import torch
import torch.nn.functional as F
from flash_attn import flash_attn_func
from xformers.ops import memory_efficient_attention

def attention_naive(q, k, v, causal=False):
    """手动实现 Attention(教学用, 不建议生产)"""
    # q, k, v: [B, H, N, D]
    d = q.size(-1)
    scores = torch.matmul(q, k.transpose(-2, -1)) / (d ** 0.5)  # [B, H, N, N]
    if causal:
        mask = torch.triu(torch.ones(scores.shape[-2:], device=q.device), diagonal=1)
        scores = scores.masked_fill(mask.bool(), float('-inf'))
    attn = F.softmax(scores, dim=-1)  # [B, H, N, N]
    out = torch.matmul(attn, v)       # [B, H, N, D]
    return out

def attention_sdpa(q, k, v, causal=False):
    """PyTorch SDPA(生产环境首选)"""
    # 自动选择 FlashAttention / Memory-Efficient / CUBLAS / Math 后端
    return F.scaled_dot_product_attention(q, k, v, is_causal=causal)

def attention_flash(q, k, v, causal=False):
    """FlashAttention(长序列最优)"""
    # 限制: head_dim <= 256
    # 输入需为 [B, N, H, D], 与 SDPA 的 [B, H, N, D] 不同
    q = q.transpose(1, 2)  # [B, N, H, D]
    k = k.transpose(1, 2)
    v = v.transpose(1, 2)
    out = flash_attn_func(q, k, v, causal=causal)
    return out.transpose(1, 2)  # [B, H, N, D]

def attention_xformers(q, k, v, causal=False):
    """xFormers(灵活多变种)"""
    # 输入格式 [B, N, H, D]
    q = q.transpose(1, 2)
    k = k.transpose(1, 2)
    v = v.transpose(1, 2)
    attn_bias = LowerTriangularMask() if causal else None
    out = memory_efficient_attention(q, k, v, attn_bias=attn_bias)
    return out.transpose(1, 2)
```

---

## 8. 总结

| 实现 | 优化层级 | 速度 | 显存 | 适用场景 | 关键限制 |
|:-----|:--------|:-----|:-----|:--------|:--------|
| **SDPA** | 自动调度最优 kernel | 最快 | 最低 | **生产环境首选** | 大 dim 时效率下降 |
| **FlashAttention** | 手写 CUDA + tiling | 接近最快 | 很低 | **长序列训练** | head_dim 256 |
| **xFormers** | C++/CUDA 通用实现 | 次之 | 中等 | **Attention 变体研究** | 标准配置不如 SDPA |
| **手动实现** | PyTorch Eager | 最慢 | 最高 | **教学/调试** | 仅用于理解原理 |

**最终建议**: 
1. **无脑使用 SDPA**: `torch.nn.functional.scaled_dot_product_attention` 是 PyTorch 2.0+ 的默认选择, 自动选择最优后端
2. **长序列必用 FlashAttention**: 当 seq_len > 2048 且 head_dim 256 时, 显存节省 80%+
3. **head_dim 控制在 64~128**: 这是当前 GPU Tensor Core 的最优工作区间
4. **混合精度训练**: FP16/BF16 可进一步提升 2~3 倍吞吐量

---

## 9. 参考文献

1. Dao, T., et al. (2022). FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness. *NeurIPS*.
2. Dao, T., et al. (2023). FlashAttention-2: Faster Attention with Better Parallelism and Work Partitioning. *ICLR*.
3. PyTorch Documentation: `torch.nn.functional.scaled_dot_product_attention`
4. xFormers GitHub: https://github.com/facebookresearch/xformers
