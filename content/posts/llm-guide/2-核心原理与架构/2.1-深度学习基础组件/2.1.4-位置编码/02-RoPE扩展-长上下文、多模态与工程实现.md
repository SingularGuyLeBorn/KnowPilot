---
title: "02 RoPE扩展：长上下文、多模态与工程实现"
date: 2026-05-24
tags: []
---

# 02 RoPE扩展：长上下文、多模态与工程实现

这篇是 [《2.1.4 位置编码 (Positional Encoding - RoPE, ALiBi)》](./2.1.4-位置编码.md) 的扩展篇，专门收 RoPE 在长上下文、多模态和工程实现里的后续问题. 主文只讲 RoPE 本身的数学定义与核心性质; 这里讲的是它一旦落到真实模型和真实系统里，会遇到什么新张力. 

## 1. 长上下文为什么会让 RoPE 暴露脆弱面

RoPE 的优势很强，但它并不等于“天然无限长”. 它最大的问题在于：随着序列变长，高频维度会进入训练阶段从未见过的相位区间. 

### 1.1 高频维度为什么会跑飞

假设训练长度为 $L_{train}=4096$，测试长度扩到 $L_{test}=128000$. 如果某个高频维度满足 $\theta_{max} \approx 10^{-4}$，那么它在最长位置上的总转角大约是：

$$
\phi_{max} = 128000 \times 10^{-4} = 12.8 \text{ rad} \approx 2.04 \times 2\pi \tag{1}
$$

这意味着该维度已经完整绕了两圈多. 训练时模型看到的可能只是很小一段局部相位，测试时却突然被推到陌生周期区间. 结果不是简单“分辨率变差”，而是注意力模式可能整体错位. 

这也是 RoPE 在实际长上下文中的典型表现：

- 短到中等长度时非常稳定. 
- 略超训练长度时还能靠频谱冗余撑住. 
- 一旦远超训练长度，可能突然出现质量断崖. 

### 1.2 NTK-aware：本质是改频率谱

NTK-aware scaling 的思路是：不要直接让高频维度在更长序列上跑那么多圈，而是调大频率基数，让它们旋转得慢一些. 

常见写法是把 RoPE 的 base 调整为：

$$
\text{base}' = \text{base} \cdot \left(\frac{L_{test}}{L_{train}}\right)^{d_{head}/(d_{head}-2)} \tag{2}
$$

这里 $L_{train}$ 是原始训练长度，$L_{test}$ 是目标长度，$d_{head}$ 是每个注意力头的维度. 式 (2) 的作用是把长序列上的相位分布压回更接近训练分布的区域. 

以 $d_{head}=128$、$L_{train}=4K$、$L_{test}=128K$ 为例，长度扩展比约为 32，新的 base 会从 $10000$ 被拉高到约 $3.48 \times 10^5$. 这样高频维度的周期被显著拉长，128K 上的相位不再那么陌生. 

但这个方法不是白送的. 你把高频维度转慢了，短程细节分辨率也可能一起被削弱. **NTK-aware 的本质不是“修复 RoPE”，而是在远程外推和短程分辨率之间重新做取舍. **

### 1.3 YaRN：继续调分布，不只调频率

[Peng et al. (2023)](https://arxiv.org/abs/2309.00071) 的 YaRN 进一步发现，仅靠调 base 还不够. 超长上下文下，attention logits 的分布锐度也会漂移，所以还需要温度缩放：

$$
\text{softmax}\left(\frac{\mathbf{q}_m^T\mathbf{k}_n}{t\sqrt{d_{head}}}\right) \tag{3}
$$

其中一个常见温度形式是：

$$
t = \frac{1}{s}\left(0.1\ln s + 1\right), \quad s = \frac{L_{test}}{L_{train}} \tag{4}
$$

这里 $s$ 是长度扩展比例. 直觉上，YaRN 做的是两件事：

- 用频率缩放把相位拉回训练时熟悉的区域. 
- 用温度缩放把 softmax 的分布形状也拉回更稳定的范围. 

这就是为什么 YaRN 很像工业折中方案. 它未必是理论上最优雅的，但通常是**零重训、低风险、效果稳定**的选项. 

### 1.4 PI 与渐进式训练

另一类做法是 Position Interpolation (PI)，也就是直接把更长位置压缩回训练长度区间. 这种方法本质上是“压地图”：32K 的位置被重新映射进原来 4K 的坐标系. 

再进一步，则是渐进式训练：先在短上下文训练，再逐步扩展到 32K、64K、128K. 这条路线质量通常最好，因为模型真的见过更长的分布，但训练成本也最高. 

| 方案 | 做法 | 优点 | 代价 |
|:----|:----|:----|:----|
| PI | 压缩位置索引 | 实现直接 | 位置分辨率下降 |
| NTK-aware | 调 base | 无需重训 | 高频与低频统一偏移 |
| YaRN | 调 base + 调温度 | 零调参场景更稳 | 仍是近似修正 |
| 渐进式训练 | 逐阶段扩上下文 | 质量最好 | 训练最贵 |

## 2. 多模态模型里的 3D RoPE

多模态 3D RoPE 的官方入口可以直接看 [Qwen2-VL 原论文《Qwen2-VL: Enhancing Vision-Language Model's Perception of the World at Any Resolution》](https://arxiv.org/abs/2409.12191). 当 RoPE 从纯文本走向多模态，它面对的问题就不再只是“一维序列有多长”，而是“一个 token 到底属于时间、宽度还是高度哪个坐标轴”. 文本只有顺序索引，图像 patch 至少有二维坐标，视频还会再多一条时间轴. 此时如果还把所有 token 都塞进同一条一维 RoPE 频谱里，模型就很难区分“向右移动一个 patch”和“向后移动一帧”这两种本质不同的位移. 

把这个结构写成数学形式，一个常用抽象是把每个视觉 token 的位置写成三元组 $(t, h, w)$，并把 Query/Key 的旋转拆到三条轴上：

$$
\text{MRoPE}(\mathbf{x}; t,h,w)
=
\text{RoPE}_t(\mathbf{x}_t, t)\ \oplus\
\text{RoPE}_h(\mathbf{x}_h, h)\ \oplus\
\text{RoPE}_w(\mathbf{x}_w, w) \tag{5}
$$

这里 $\mathbf{x}$ 表示原始 Query 或 Key 向量，$\oplus$ 表示把不同轴上的子向量重新拼接回完整表示，$\mathbf{x}_t,\mathbf{x}_h,\mathbf{x}_w$ 分别是分配给时间、高度、宽度三条轴的子空间. 式 (5) 的关键不是符号形式，而是“不同坐标轴各用各的 RoPE”. 时间轴负责视频帧先后，$h/w$ 两轴负责图像或页面中的空间布局，因此模型学到的就不再是单一顺序，而是三种独立又可组合的相对位移. 

如果继续写到注意力分数层面，它可以抽象为：

$$
\langle \mathbf{q}_{(t_1,h_1,w_1)}, \mathbf{k}_{(t_2,h_2,w_2)} \rangle
\;\Longrightarrow\;
f(t_1-t_2,\ h_1-h_2,\ w_1-w_2) \tag{6}
$$

式 (6) 表达的是 3D RoPE 的本质目标：最终保留下来的，不是三个绝对坐标，而是三条轴上的相对位移. 这样时间邻近性不再和空间邻近性混在一起，视频帧序关系、图像局部结构和文档版面布局都能有自己的“相位系统”. 所以 3D RoPE 的工程意义，不是把一维 RoPE 机械复制三次，而是把“位置”从单轴顺序提升成多轴坐标. 

## 3. MLA 为什么不直接适配 RoPE，DeepSeek 做了什么改进

这一块的原始论文入口是 [DeepSeek-V2《DeepSeek-V2: A Strong, Economical, and Efficient Mixture-of-Experts Language Model》](https://arxiv.org/abs/2405.04434). RoPE 和 MLA 的冲突点很直接：RoPE 是把位置信息直接写进 Query/Key 表示本身，而 MLA 的目标恰恰是把 Key/Value 压缩进更小的 latent 空间，以减少缓存和带宽开销. 问题在于，一旦你把带位置相位的 Key 直接压缩掉，后面再拿出来时，原始 attention score 未必还能被精确恢复. 

如果把标准 RoPE 的注意力写成：

$$
\text{score}_{ij}
=
\left\langle
\text{RoPE}(\mathbf{q}_i, i),\
\text{RoPE}(\mathbf{k}_j, j)
\right\rangle \tag{7}
$$

那么它默认假设 $\mathbf{q}_i,\mathbf{k}_j$ 都保留在原始头空间里，旋转相位是直接附着在这些向量上的. MLA 的目标却是先把内容压进低维 latent，再在需要时恢复近似 attention，所以两者天然有张力：**RoPE 希望你保留带相位的原始几何结构，MLA 希望你尽快把它压缩掉. **

DeepSeek-V2 的改法可以抽象写成“内容通道”和“位置通道”分离：

$$
\mathbf{q}_i = [\mathbf{q}_i^{C};\ \mathbf{q}_i^{R}], \qquad
\mathbf{k}_j = [\mathbf{k}_j^{C};\ \mathbf{k}_j^{R}] \tag{8}
$$

然后把注意力分数拆成两部分：

$$
\text{score}_{ij}
=
\langle \mathbf{q}_i^{C}, \mathbf{k}_j^{C} \rangle
+ 
\left\langle
\text{RoPE}(\mathbf{q}_i^{R}, i),\
\text{RoPE}(\mathbf{k}_j^{R}, j)
\right\rangle \tag{9}
$$

这里上标 $C$ 表示内容相关分量，$R$ 表示保留 RoPE 的位置相关分量. 式 (9) 不是在逐字抄 DeepSeek 论文原式，而是对其 decoupled RoPE 设计的结构性抽象：内容部分继续走 MLA 擅长的低秩压缩，位置部分则保留一条独立通道，避免旋转相位在 latent 压缩中被搅乱. 你可以把它理解成“不要让 RoPE 跟着 latent 一起被揉碎”，而是把最难压的那一小块位置信息显式留出来. 

因此，DeepSeek 团队做的关键改进并不是发明了另一种全新的位置编码，而是承认 MLA 和 RoPE 的张力，然后在结构上把“内容压缩”和“位置保持”解耦. 这样既保住了 MLA 的缓存优势，也尽量不牺牲 RoPE 对相对距离的表达能力. 更细的矩阵拆法和实现细节，本文不展开，因为 MLA 那一节已经单独讲过. 

## 4. RoPE 的工程成本主要取决于能否与内核融合

从理论 FLOPs 看，RoPE 只是对 Q/K 做额外旋转，单看并不贵; 真正影响部署成本的，通常不是公式本身，而是它能否和注意力内核一起做 fuse. 如果旋转必须单独跑一遍 kernel，那么 HBM 读写和调度开销就会被放大; 如果它能直接内联到 Q/K 投影后、FlashAttention 前的路径里，那么额外成本往往会被压到非常低. 

| 方案 | 额外操作 | 工程特点 |
|:----|:--------|:--------|
| Learnable / Sinusoidal PE | 输入端加法 | 最简单，但不适合长外推 |
| Shaw Relative PE | 相对位置查表与附加项 | 参数和实现复杂度更高 |
| RoPE | Q/K 旋转 | 可与 FlashAttention 类内核融合 |
| ALiBi | logits 减距离罚项 | 计算极轻，但任务偏置更强 |

现代实现里，RoPE 之所以还能长期占优，一个重要原因就是它可以和高效注意力内核一起做 fuse，而不是单独成为一个大瓶颈. 

## 5. 一个极简的 RoPE 实现

下面这个实现展示的是 Llama 风格的核心思路：先预计算频率，再把每对维度视为复数做旋转. 

```python
import torch

def precompute_freqs_cis(dim: int, max_seq_len: int, theta: float = 10000.0):
    inv_freq = 1.0 / (theta ** (torch.arange(0, dim, 2).float() / dim))
    positions = torch.arange(max_seq_len, dtype=torch.float32)
    freqs = torch.outer(positions, inv_freq)
    return torch.polar(torch.ones_like(freqs), freqs)

def apply_rotary_emb(x: torch.Tensor, freqs_cis: torch.Tensor):
    x_reshape = x.float().reshape(*x.shape[:-1], -1, 2)
    x_complex = torch.view_as_complex(x_reshape)
    x_rotated = x_complex * freqs_cis.unsqueeze(0).unsqueeze(2)
    return torch.view_as_real(x_rotated).reshape(*x.shape).type_as(x)
```

这段代码的关键不是写法，而是映射关系：

- `inv_freq` 对应主文式 (8) 里的频率谱. 
- `freqs` 对应位置与频率的外积. 
- 复数乘法对应主文式 (10) 的旋转. 

## 6. 数值精度为什么会在超长上下文里变成真问题

RoPE 在超长上下文里还有一个经常被低估的问题：大位置索引和高频维度相乘后，角度精度会退化. 尤其在 FP16 下，当 $m$ 很大时，$m\theta_i$ 的尾数误差会传导到 $\sin$ 和 $\cos$，再传导到 attention logits. 

这类问题在普通长度上通常不明显，但在 64K、128K、甚至更长窗口下会开始累积. 常见缓解方式包括：

- 用 BF16 或 FP32 预计算旋转频率. 
- 在超长上下文下使用更高精度的角度计算. 
- 通过外推缩放减少高频维度进入极端相位区域. 

**长上下文不只是“训练没见过”，也是“数值系统开始吃紧”. **

## 7. 参考文献

1. [Su, J., et al. (2021). RoFormer：带旋转位置嵌入的 Transformer(RoFormer: Enhanced Transformer with Rotary Position Embedding).](https://arxiv.org/abs/2104.09864) *arXiv*.
2. [Peng, B., et al. (2023). YaRN：高效扩展大语言模型上下文窗口(YaRN: Efficient Context Window Extension of Large Language Models).](https://arxiv.org/abs/2309.00071) *arXiv*.
3. [Qwen Team. (2024). Qwen2-VL：在任意分辨率下增强视觉语言模型的世界感知(Qwen2-VL: Enhancing Vision-Language Model's Perception of the World at Any Resolution).](https://arxiv.org/abs/2409.12191) *arXiv*.
4. [Dai, D., et al. (2024). DeepSeek-V2：强大、经济且高效的 MoE 语言模型(DeepSeek-V2: A Strong, Economical, and Efficient Mixture-of-Experts Language Model).](https://arxiv.org/abs/2405.04434) *arXiv*.
