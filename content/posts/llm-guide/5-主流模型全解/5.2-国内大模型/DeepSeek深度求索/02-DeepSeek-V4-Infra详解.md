---
title: "DeepSeek-V4 Infra 详解"
date: 2026-05-16
tags: [DeepSeek, V4, MoE, mHC, CSA, HCA, FP4, Muon, 专家并行]
---

# DeepSeek-V4 Infra 详解

> 本文基于 DeepSeek-V4 技术报告，系统整理其模型结构、训练系统、推理系统和后训练 Infra 四大核心模块，涵盖流形约束超连接(mHC)、混合注意力(CSA+HCA)、FP4 量化感知训练、细粒度 EP 通信-计算重叠等前沿技术. 

---

## 1. 模型结构

### 1.1 继承自 DeepSeek-V3 的设计

**MoE 架构**：
- 细粒度路由专家 + 共享专家
- 激活函数：从 Sigmoid 改为 sqrt(Softplus)
- 负载均衡：无辅助损失策略 + 轻量序列级平衡损失
- 初始层改造：前几层 Dense FFN 替换为 Hash 路由的 MoE 层

**Multi-Token Prediction (MTP)** ：与 V3 完全一致

### 1.2 流形约束超连接(mHC)

mHC 替代传统残差连接，核心思想是将残差映射约束在特定流形上. 

**标准超连接(Standard HC)** ：
- 残差流宽度扩展 n_hc 倍：从 R^d 扩展到 R^{n_hc x d}
- 引入三个线性映射 A^l, B^l, C^l
- 残差状态更新：X_{l+1} = B^l X_l + C^l F_l(A^l X_l)

**流形约束残差映射**：
- 将 B^l 约束在双随机矩阵的流形(Birkhoff 多面体)上
- 谱范数有界：||B^l||_2 <= 1，保证前向/反向传播稳定
- 乘法封闭：深层堆叠时依然稳定

**动态参数化**：
- 参数由动态分量(输入依赖)和静态分量组合生成
- 输入/输出映射通过 Sigmoid 约束为非负有界
- 残差映射通过 Sinkhorn-Knopp 算法投影到双随机矩阵

### 1.3 混合注意力机制：CSA + HCA

#### 1.3.1 压缩稀疏注意力(CSA)

**压缩 KV 条目**：
- 每 m 个 token 的 KV 压缩为一个条目
- 两组 KV 条目(C^a, C^b)通过加权求和压缩
- 重叠压缩：相邻压缩条目共享部分 KV

**Lightning Indexer(闪电索引器)** ：
- 对压缩 KV 条目进一步压缩，得到索引器键 K^{IComp}
- 低秩方式生成索引器查询：c^Q_t = h_t * W^{DQ}
- 计算查询 token 与压缩块之间的索引分数
- Top-k 选择最相关的压缩 KV 条目

**共享 KV MQA + 分组输出投影**：
- 每个压缩 KV 条目同时作为 key 和 value
- 分组策略降低输出投影计算量

#### 1.3.2 重度压缩注意力(HCA)

- 更高压缩率 m'(m' >> m)
- 不使用稀疏注意力，对所有压缩条目做注意力
- 结构更简单，适合对局部依赖要求不高的层

#### 1.3.3 其他细节

- **滑动窗口 KV**：增强局部细粒度依赖
- **Query/KV 归一化**：核心注意力前执行 RMSNorm，避免 logits 爆炸

---

## 2. 训练系统

### 2.1 细粒度 EP 通信-计算重叠

**核心观察**：单个 MoE 层内，通信总时间 < 计算总时间

**基于 Wave 的专家调度**：
- 将专家拆分为多个 Wave
- 当前 Wave 计算、下一个 Wave 传输、已完成 Wave 的结果发送 三者并发
- 形成全局统一的细粒度流水线

**计算-通信比条件**：

C/B <= 2d = 6144 FLOPs/Byte

即每 GBps 互联带宽可隐藏 6.1 TFLOP/s 的计算. 

**实测加速**：通用推理 1.50-1.73x，延迟敏感场景最高 1.96x

### 2.2 FP4 量化感知训练(FP4 QAT)

**MXFP4 格式**：
- E2M1：1 sign + 2 exponent + 1 mantissa，bias = 1
- 配合 Microscaling(块级缩放因子)提升有效精度

**QAT 流程**：
- 后训练阶段引入量化感知训练
- 使模型适应 FP4 量化带来的精度损失
- 推理和 RL Rollout 阶段直接使用 FP4 权重

### 2.3 Muon 优化器与 ZeRO 的高效结合

**核心矛盾**：Muon 的更新方向与 Adam 不同，无法直接用 ZeRO 的梯度聚合逻辑

**解决方案**：
- Dense 参数：标准 ZeRO 分配
- MoE 参数：展平后按专家分配，冗余计算换显存
- 额外优化：融合算子、选择性重计算

### 2.4 上下文并行(Contextual Parallelism)

**两阶段通信方案**：
1. **边界 KV 交换**：相邻节点交换边界 token 的 KV
2. **All-Gather + Select-and-Pad**：收集全局信息，按需选择

**可见范围(Visible Range)** ：
- 每个查询 token 只能看到特定范围内的 KV
- 根据注意力类型(CSA/HCA/SWA)动态计算可见范围

### 2.5 灵活的激活值Checkpoint

**张量级 Checkpoint**：
- 传统方案：层级别的 checkpoint(重算整层)
- V4 方案：张量级别的细粒度 checkpoint
- 只重算真正需要的张量，减少冗余计算

---

## 3. 推理系统

### 3.1 双区 KV Cache 布局

**异构 KV 条目的挑战**：
- CSA 压缩 KV、HCA 压缩 KV、滑动窗口 KV 三种不同格式
- 大小、生命周期、访问模式各不相同

**双区布局**：
- **State Cache**：存储 CSA/HCA 的压缩 KV，按块管理
- **Classical KV Cache**：存储滑动窗口 KV，标准方式管理

### 3.2 磁盘 KV Cache 存储

**CSA/HCA 压缩 KV**：
- 压缩率高，适合持久化到磁盘
- 预填充阶段写入，后续请求直接加载

**SWA KV 三种存储策略**：
1. **全内存**：低延迟，高显存占用
2. **内存+磁盘 LRU**：热数据在内存，冷数据落盘
3. **全磁盘**：最低显存，最高延迟

---

## 4. 后训练 Infra

### 4.1 On-Policy Distillation(OPD)

**动机**：用更大的教师模型蒸馏到学生模型，但保持 on-policy 特性

**目标函数**：
- 学生模型先生成回答，教师模型在这些轨迹上提供监督
- 支持 Sampled-token、Top-k、Full-vocab 三种蒸馏粒度

**关键设计**：
- 教师权重按需加载(减少显存占用)
- 隐状态缓存替代 Logits 存储
- 教师 Head 的显存优化

### 4.2 可抢占的容错 Rollout 服务

**Token 级预写日志(WAL)** ：
- 每个生成的 token 立即写入持久化日志
- 故障恢复时从最近 checkpoint 继续，无需重新生成

### 4.3 百万 Token 上下文的 RL 扩展

**轻量元数据 + 重量 Token 字段分离**：
- 元数据(位置、注意力掩码)独立存储和传输
- Token 字段按需加载

**动态 Mini-Batch 数量**：
- 根据上下文长度动态调整 batch size
- 长上下文用小 batch，短上下文用大 batch

### 4.4 Agentic AI 沙箱基础设施(DSec)

**架构组成**：
- 统一接口下的四种执行基底：代码解释器、浏览器、Shell、文件系统
- 分层存储实现快速镜像加载
- 轨迹日志与抢占安全恢复

---

## 5. 总结

DeepSeek-V4 的关键创新点：

| 模块 | 创新 |
|:-----|:-----|
| 模型结构 | mHC 流形约束残差连接 + CSA/HCA 混合注意力 |
| 训练系统 | 细粒度 EP Wave 调度 + FP4 QAT + Muon-ZeRO 融合 |
| 推理系统 | 双区 KV Cache + 磁盘持久化 + 稀疏注意力 Kernel 协同 |
| 后训练 | OPD 蒸馏 + WAL 容错 + 百万 Token RL + DSec 沙箱 |

> 参考来源：[DeepSeek-V4 Infra 详解](https://zhuanlan.zhihu.com/p/2032186080871625286)
