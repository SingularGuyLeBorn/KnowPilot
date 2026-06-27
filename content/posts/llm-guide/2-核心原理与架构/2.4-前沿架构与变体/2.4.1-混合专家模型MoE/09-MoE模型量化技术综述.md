---
title: "MoE 模型量化技术综述"
date: 2026-05-16
tags: [MoE, 量化, PTQ, 混合精度, GPTQ, AWQ, 低秩补偿]
---

# MoE 模型量化技术综述

> 本文系统梳理 MoE(Mixture-of-Experts)模型的量化技术前沿, 涵盖 Sub-1-Bit 压缩、专家级混合精度、动态校准、低秩补偿等核心方法, 为 MoE 模型的高效部署提供技术选型参考. 

---

## 1. MoE 量化的独特挑战

### 1.1 为什么 MoE 量化更难

MoE 模型在 4-bit、3-bit 量化时会遭受比 Dense 模型更严重的精度损失, 原因包括：

- **稀疏动态计算**：传统激活量化未考虑门控产生的结构性稀疏, 导致量化步长不稳定
- **专家激活不平衡**：不同专家被激活的频率差异巨大(最高可达 11.7 倍), 导致校准数据覆盖不足
- **路由敏感性**：门控分数的微小扰动会扰乱 top-k 专家分配, 引发级联误差

### 1.2 核心解决思路

| 挑战 | 解决方向 |
|:-----|:--------|
| 专家激活不平衡 | 专家级混合精度、平衡采样校准 |
| 路由敏感性 | KL 散度约束、双目标校准 |
| 精度损失大 | 低秩补偿、敏感通道保留 |
| 系统开销高 | Roofline-aware 精度选择、GEMM 编排 |

---

## 2. 代表性方法详解

### 2.1 QMoE：Sub-1-Bit 压缩

**论文**：QMoE: Practical Sub-1-Bit Compression of Trillion-Parameter Models (MLSys 2024)
**目标模型**：SwitchTransformer-c2048 (1.6T 参数)

**核心方法**：
- 使用 GPTQ 算法对分组专家进行三进制量化(-m, 0, +m)
- 三进制自然产生 ~90% 的零值稀疏性
- 利用稀疏矩阵乘法进一步压缩, 实现 **< 1 bit/weight** 的压缩率
- 非专家层保持 BF16, 专家层用 2-bit

**效果**：1.6T 模型压缩到 < 160GB(20× 压缩)

### 2.2 MoQa：多阶段数据-模型分布感知

**论文**：MoQa: Rethinking MoE Quantization with Multi-stage Data-model Distribution Awareness (2025)
**目标模型**：OLMoE、Qwen-MoE、DeepSeek-MoE

**核心洞察**：
- 不同输入数据分布下, 专家重要性差异巨大
- 单一校准数据集无法覆盖所有专家的数据分布

**三阶段框架**：
1. **预校准**：基于专家路由概率初始化量化缩放因子
2. **自适应**：在线调整专家的量化范围(动态缩放)
3. **微调**：通过知识蒸馏修复专家间交互误差

**专家级混合精度**：
- 共享专家 + 重要性高的专家 → INT8
- 重要性低的专家 → INT2/INT4

**通道级动态调整**：
- 筛选出 1% 最敏感的通道(类似 AWQ 的发现)
- 这些通道用 FP16 计算, 开销可忽略

### 2.3 MxMoE：精度与性能协同设计

**论文**：MxMoE: Mixed-precision Quantization for MoE with Accuracy and Performance Co-Design (2025)

**核心思想**：混合精度不仅要考虑精度, 还要考虑**实际加速效果**

**Roofline 分析**：
- 不同量化方法在 Roofline 模型中处于不同位置
- 激活比例高的专家 → W8A8(计算受限, 需降低计算量)
- 激活比例低的专家 → W4A16(内存受限, 需降低带宽)

**细粒度划分**：
- 将 MoE 块划分为 Gate、Proj_Up、Proj_Down
- 不同块使用不同量化方法
- 编写专门的 GEMM Orchestration kernel

### 2.4 MoEQuant：专家平衡采样与亲和度引导

**论文**：MoEQuant: Enhancing Quantization for MoE via Expert-Balanced Sampling and Affinity Guidance (2025)

**核心问题**：PTQ 校准数据的负载不均衡

**自采样(Self-Sampling)** ：
- 利用模型自身自回归生成校准数据
- 从固定起点(词汇表)开始, 选择最优分支直到 EoS
- 路径剪枝优化, 忽略低概率分支

**亲和度引导**：
- 将门控系数纳入逐层校准
- 样本与专家之间的相关性作为量化调整依据

### 2.5 EAQuant：专家感知优化

**论文**：EAQuant: Enhancing Post-Training Quantization for MoE via Expert-Aware Optimization (2025)
**目标场景**：W4A4 和极端 W3A4 量化

**三个具体方法**：
1. **统一通道级平滑向量**：跨专家最大化, 抑制激活中的极端值
2. **双目标校准**：MSE + KL 散度, 同时保持数值精度和路由分布一致
3. **非专家参数校准**：PTQ 中不仅校准专家参数, 还校准非专家参数

### 2.6 MiLo：低秩补偿

**论文**：MiLo: Efficient Quantized MoE Inference with Mixture of Low-Rank Compensators (2025)
**目标场景**：INT3 量化

**核心方法**：
- 对残差矩阵(量化前后差值)进行 SVD 分解
- 用低秩矩阵补偿量化误差
- 解决 INT3 "理论节省无法转化为实际加速"的问题

### 2.7 Fate：跨层门控预取

**论文**：Fate: Fast Edge Inference of MoE via Cross-Layer Gate (2025)
**目标场景**：边缘设备 CPU offload

**核心设计**：
- 利用相邻层 gate 输入预测下一层激活的专家
- 实现高准确率的专家预取(prefetch)

**分阶段量化策略**：
- CPU 缓存阶段：统一 INT4 存储
- Prefill 阶段：受欢迎专家 INT4, 不受欢迎专家 INT2
- Decode 阶段：统一 INT4(batch=1 时不区分)

### 2.8 MoQAE：量化感知专家

**论文**：MoQAE: Mixed-Precision Quantization for Long-Context via Mixture of Quantization-Aware Experts (2025)

**核心思想**：借用 MoE 门控机制选择**最优量化比特宽度**
- 不是压缩 MoE 架构本身
- 而是用门控为不同 KV Cache 选择不同精度
- 类似 MoBA 用门控选择注意力机制

---

## 3. 技术选型指南

| 场景 | 推荐方法 | 压缩率 | 精度损失 |
|:-----|:--------|:------|:--------|
| 极致压缩(云端) | QMoE (Sub-1-Bit) | 20× | 中等 |
| 动态数据分布 | MoQa | 4-8× | 低 |
| 追求实际加速 | MxMoE | 4-6× | 低 |
| 校准数据不足 | MoEQuant (自采样) | 4-8× | 低 |
| 极端低比特 | EAQuant + MiLo | 8-16× | 中 |
| 边缘设备 | Fate | 4-8× | 低 |
| KV Cache 压缩 | MoQAE | 2-4× | 低 |

---

## 4. 未来方向

1. **训练时量化感知**：当前多为 PTQ, 未来可能在预训练阶段就引入量化约束
2. **专家剪枝 + 量化联合优化**：先剪掉不重要的专家, 再量化剩余专家
3. **动态精度切换**：根据输入复杂度实时调整量化精度
4. **硬件-算法协同**：为 MoE 量化设计专门的稀疏 GEMM 加速器

> 参考来源：[笔记：聊聊 MoE 模型的量化](https://zhuanlan.zhihu.com/p/1929499400977256981)
