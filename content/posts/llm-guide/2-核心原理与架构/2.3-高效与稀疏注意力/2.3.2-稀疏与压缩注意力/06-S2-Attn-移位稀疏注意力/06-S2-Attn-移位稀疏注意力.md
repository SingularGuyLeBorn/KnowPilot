---
title: "06 S²-Attn：移位稀疏注意力"
date: 2026-05-24
tags: [S2-Attn, LongLoRA, 长上下文微调, 稀疏注意力, Shifted Sparse]
---

# 06 S²-Attn：移位稀疏注意力（Shifted Sparse Attention）

> 系列索引：[2.3.2 稀疏与压缩注意力](../2.3.2-稀疏与压缩注意力.md) · [2.3 高效与稀疏注意力](../../2.3-高效与稀疏注意力.md)  
> 论文：[LongLoRA: Efficient Fine-tuning of Long-Context LLMs](https://arxiv.org/abs/2309.12307) · 代码：[LongLoRA](https://github.com/dvlab-research/LongLoRA)

**S²-Attn**（Shifted Sparse Attention，$S^2$-Attn）来自 LongLoRA（2023）。它解决 **长上下文微调** 的算力爆炸：8192 训练相对 2048 时，self-attention FLOPs 约 **×16**。LongLoRA 用 **分组局部 attention + 半头移位** 在训练期近似全局模式，且 **推理可切回全注意力**。

---

## 1. 动机

| 杠杆 | 作用 |
|------|------|
| **S²-Attn** | 训练时 $O(L \cdot g)$ 而非 $O(L^2)$ |
| **扩展 LoRA** | 对 embedding、norm 也训练，弥补长文分布偏移 |

即使用 LoRA，若仍做全局 dense attention，长上下文 SFT 依然极慢 — S² 改的是 **attention 图**，不是参数量。

---

## 2. 算法：分组 + 半头移位

设上下文 $L$，组大小 $g$（如 8192 训练、$g=2048$）。

**Step 1 — 分组局部注意力**  
序列切成 $L/g$ 组，**组内**独立 causal self-attention。单组 $O(g^2)$，总计 $O(L \cdot g)$。

**Step 2 — 半头移位（Shift）**  
在 **一半 head** 上将序列 **平移 $g/2$**，再分组 attention。相邻组经移位头 **交换信息**，避免组间完全隔离 — 与 Swin Transformer 的 shifted window 同 spirit。

![S²-Attn 分组与移位示意](./images/fig-s2attn-shifted-sparse-pattern.jpg)

> 图 1: S²-Attn 分组局部 attention + 半头移位形成跨组边（LongLoRA 论文）。

**图 1 解析**

- **未移位头**：attention 只在同色块（组）内 — 等价于把长序列当成多个短序列并行训练，块间无连接。
- **移位头**：token 索引整体 roll $g/2$ 后再分组 — 原来属于不同组的 token 落入同一组，形成 **跨组边**。
- **因果性**：roll 后仍施加因果 mask，不窥视未来。
- **有效感受野**：两轮（移位/不移位）叠加后，信息可沿序列传播多组距离，但 FLOPs 仍按 $L \cdot g$ 计。

### PyTorch 伪代码（论文 Algorithm 1 精神）

```python
# x: [B, L, H, D]
x1, x2 = x.chunk(2, dim=2)           # 半头
x2 = torch.roll(x2, shifts=group_size // 2, dims=1)
x = torch.cat([x1, x2], dim=2)
x = rearrange(x, 'b (ng g) h d -> (b ng) g h d', g=group_size)
out = flash_attn(x, causal=True)
# 逆变换 + 对移位头 roll 回来
```

---

## 3. 训练 vs 推理

| 阶段 | Attention | 说明 |
|------|-----------|------|
| **训练** | S²-Attn | 省显存与 FLOPs |
| **推理** | 可选 **全注意力** | 避免过拟合固定稀疏；测试用 dense 不损外推 |

这是 S² 与多数「训练推理不一致」稀疏方案的关键区别。

![LongLoRA 上下文扩展与训练配置](./images/fig-s2attn-longlora-overview.jpg)

> 图 2: LongLoRA 将 4K 模型扩至 8K–100K 的训练/评测曲线（论文）。

**图 2 解析**

- 通常对比 **4K 预训练 → 8K/16K/32K/100K** 微调后的 loss 或 benchmark。
- **S² + LoRA** 曲线应接近 **全注意力微调**，但训练 wall-clock 更短 — 验证稀疏近似是否足够。
- **7B / 70B** 两档：70B 往往只扩到 32K（资源限制），7B 可到 100K — 读图时区分模型规模。
- 若 S² 曲线在超长处掉队，优先检查 **组大小 $g$** 与 **是否推理阶段恢复全注意力**。

---

## 4. 与 DCA、MLA 的对比

| 方法 | 主要目标 | 是否训练 | KV Cache |
|------|---------|---------|----------|
| [MLA](../../../2.2-基础注意力机制/2.2.2-多头注意力变体/04-MLA-低秩潜变量与解耦式注意力/04-MLA-低秩潜变量与解耦式注意力.md) | 压缩 KV | 预训练结构 | 显著减小 |
| [DCA](../05-DCA-双块注意力/05-DCA-双块注意力.md) | Training-free 外推 | 否 | 不压缩 |
| **S²-Attn** | 高效长上下文 **微调** | LoRA+S² | 训练期仍全量 |

**LongLoRA 成绩单（论文）**

- Llama-2 **7B**：4K → **100K**（8×A100）
- Llama-2 **70B**：4K → **32K**
- 兼容 FlashAttention-2

---

## 5. 局限

- 组大小需与目标长度、预训练长度联合调参  
- 移位只连 **邻近组**；极长依赖仍依赖 LoRA + 位置外推（PI、YaRN 等可叠加）  
- 主要服务 **微调**；仅推理外推优先 [DCA](../05-DCA-双块注意力/05-DCA-双块注意力.md)

---

## 6. 参考文献

1. Chen, Y., et al. (2023). [LongLoRA: Efficient Fine-tuning of Long-Context Large Language Models](https://arxiv.org/abs/2309.12307). *arXiv*.
2. [LongLoRA GitHub](https://github.com/dvlab-research/LongLoRA).
