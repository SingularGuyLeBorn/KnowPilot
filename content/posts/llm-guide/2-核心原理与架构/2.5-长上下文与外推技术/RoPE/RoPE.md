# RoPE：旋转位置编码

> RoPE(Rotary Position Embedding)是当前大语言模型最主流的位置编码方案. 本文档集从数学原理、工程实现、长度外推、视觉扩展到工业实践, 系统性覆盖RoPE的全貌. 

---

## 目录结构

| 序号 | 子文档 | 核心内容 | 篇幅 |
|------|--------|---------|------|
| 01 | [数学原理：从旋转矩阵到相对位置编码](01-数学原理：从旋转矩阵到相对位置编码.md) | 向量旋转、复数表示、多维分组、内积恒等式 | ~200行 |
| 02 | [工程实现与高效计算](02-工程实现与高效计算.md) | HF Transformers实现、GPT-NeoX Style、预计算缓存、融合kernel | ~200行 |
| 03 | [长度外推：从PI到YaRN的频率扩展](03-长度外推：从PI到YaRN的频率扩展.md) | 位置内插、NTK-aware、YaRN、动态NTK、各模型配置 | ~250行 |
| 04 | [视觉与多模态扩展](04-视觉与多模态扩展.md) | 2D-RoPE、3D-RoPE、M-RoPE、Interleaved-MRoPE | ~250行 |
| 05 | [工业实践与失效模式](05-工业实践与失效模式.md) | 典型配置对比、计算开销、失效模式深度分析 | ~150行 |

---

## 核心公式速查

**旋转角度**：
$$
\theta_i = \text{base}^{-2i/d}, \quad i \in [0, d/2 - 1]
$$

**相对位置内积**：
$$
(R_m q)^T (R_n k) = q^T R_{n-m} k
$$

**高效实现**：
$$
q_{\text{embed}} = q \cdot \cos + \text{rotate\_half}(q) \cdot \sin
$$

---

## 与其他主题的关系

- **Attention架构**：RoPE是MHA/GQA/MLA等注意力变体的标配位置编码
- **长度外推**：RoPE本身不支持超长序列, 需配合NTK/YaRN等技术
- **多模态模型**：Qwen-VL系列通过M-RoPE将RoPE扩展到2D/3D视觉数据
- **融合Kernel**：FlashAttention-v2+ 原生支持RoPE的在线计算, 避免额外内存访问
