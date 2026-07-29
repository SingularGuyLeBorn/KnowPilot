---
title: "工程实现：分布式训练、LoRA 与推理部署"
category: null
tags:
  - "工程实现"
  - "分布式训练"
  - "LoRA"
  - "FSDP"
  - "量化"
  - "vLLM"
  - "QLoRA"
published: true
excerpt: null
---
# 工程实现：分布式训练、LoRA 与推理部署

> ⚠️ **时效性说明**：2025 年后，QLoRA、PagedAttention 取代传统微调和 Naive 推理成为主流考点。ZeRO-3 知识仍是基础但不再够用，需结合 3D 并行理解。
>
> **来源**：AgentGuide 面经、小林笔记、牛客面经、CSDN 面试题、DeepSeek 工程博客

---

## 1. LoRA 原理 + 秩 r 选择 + α 缩放

- **元数据**：`{topic: "工程·微调", quality: ⭐⭐⭐⭐⭐, year: "经典题·持续有效", difficulty: mid}`
- **来源**：AgentGuide 面经、掘金

**原理**：冻结 W ∈ R^{d×k}，旁路学习低秩矩阵 A·B（r ≪ min(d,k)）：
```
W' = W + α·A·B,  A∈R^{d×r}, B∈R^{r×k}
```

**秩 r 的工业界经验**（2025-2026 新共识）：
- r=8/16 仍是通用默认值
- r=64 在需要学习新知识时更好（如代码、数学推理）
- **选 r 的标准**：验证集上试 8/16/32/64，选效果饱和的最小值

**追问**：「α 的典型值？」→ 通常设 r 的 1-2 倍。α 不是 r 的替代品，两者配合使用。

> ✅ **时效判断**：LoRA 是久经考验的经典题。2025-2026 新增"r=64"和"多任务 LoRA"变体。

---

## 2. QLoRA: 4-bit NF4 + 双重量化

- **元数据**：`{topic: "工程·量化微调", quality: ⭐⭐⭐⭐⭐, year: "2025-2026", difficulty: senior}`
- **来源**：小林笔记、QLoRA 论文

**三个关键技术**：
1. **NF4 (NormalFloat4)**：信息论最优的 4-bit 数据类型，比 INT4 更适合模型权重的正态分布
2. **双重量化**：对量化常数再做 8-bit 量化，进一步压缩
3. **Paged Optimizer**：显存不够时换出到 CPU 内存

**效果**：单张 24GB 显卡微调 65B 模型。

**追问**：「NF4 和 INT4 的区别？」→ INT4 均匀量化，NF4 按正态分布的非均匀量化，精度更高。

> ✅ **时效判断**：2025 起热门，QLoRA 已成低成本微调标配。

---

## 3. FSDP / DeepSpeed ZeRO 分片策略详解

- **元数据**：`{topic: "工程·分布式", quality: ⭐⭐⭐⭐⭐, year: "2024-2026", difficulty: senior}`
- **来源**：AgentGuide 面经、CSDN

| 策略 | ZeRO Stage | 分片内容 | 通信模式 |
|---|---|---|---|
| DDP | — | 无 | all-reduce 梯度 |
| ZeRO-1 | Optimizer states | 优化器状态 | all-gather + reduce-scatter |
| ZeRO-2 | + Gradients | 梯度 | 同上 |
| **ZeRO-3 (FSDP)** | + Parameters | 全部参数 | 每层前 all-gather，后 reduce-scatter |

**FSDP vs Megatron 3D 并行**（2026 面试高频）：
| | FSDP | Megatron (TP+PP+DP) |
|---|---|---|
| 切分粒度 | 层级别（纵向） | 层内切分（横向）+ 流水线 |
| 通信量 | all-gather 完整层 | 更细粒度，带宽要求更高 |
| 适用规模 | ≤ 100B | > 100B |
| 易用性 | 高（几行配置） | 低（需手动切分） |

> ✅ **时效判断**：FSDP 是 2024-2026 标准答案。2025-2026 面试已不满足于背 ZeRO 表格，要求理解 FSDP vs 3D 并行的选型。

---

## 4. PagedAttention / vLLM 推理优化

- **元数据**：`{topic: "工程·推理", quality: ⭐⭐⭐⭐⭐, year: "2025-2026", difficulty: senior}`
- **来源**：林哥笔记、牛客面经

**核心洞察**：KV Cache 存在严重碎片化问题（20-40% 利用率）。

**PagedAttention 方案**：像操作系统虚拟内存一样将 KV Cache 分页管理：
- 固定大小 page（类似 4KB 内存页）
- 按需分配，零碎片
- 支持 Copy-on-Write（beam search 时共享 pages）
- 内存利用率 → 95%+

**追问**：「vLLM 和 TensorRT-LLM 有什么区别？」→ vLLM 专注 PagedAttention 内存管理；TensorRT-LLM 侧重算子融合和编译优化。两者可结合使用。

> ✅ **时效判断**：2025-2026 面试超高频，每个推理优化相关岗位必问。

---

## 5. 模型量化部署对比

- **元数据**：`{topic: "工程·量化", quality: ⭐⭐⭐⭐, year: "2025-2026", difficulty: mid}`
- **来源**：掘金、小林笔记

| 方式 | 精度 | 模型大小 (7B) | 适用场景 | 代表工具 |
|---|---|---|---|---|
| FP16 | 16-bit | ~14GB | 基线 | — |
| INT8 | 8-bit | ~7GB | 在线服务 | TensorRT |
| INT4 / NF4 | 4-bit | ~3.5GB | 单卡推理 | AWQ, GPTQ |
| GGUF (Q4_K_M) | 4-bit CPU优化 | ~4GB | 本地笔记本 | llama.cpp |

**面试题**：「AWQ 和 GPTQ 有什么区别？」→ AWQ 是权重感知量化（保留重要权重精度）；GPTQ 是二阶近似量化（OBS 方法的推广）。AWQ 通常更简单高效。

> ✅ **时效判断**：2025-2026 面试中 AWQ 已取代 GPTQ 成为推荐答案。

---

## 6. 分布式训练场景题

- **元数据**：`{topic: "工程·场景题", quality: ⭐⭐⭐⭐⭐, year: "2025-2026", difficulty: senior}`
- **来源**：牛客面经、AgentGuide

**经典场景题 1**：「Qwen-72B 在 8×A100 (80GB) 上用 FSDP 训练，batch size 怎么配？」
→ 72B FP16 = 144GB → 每卡 18GB 参数 → 剩余 ~62GB → per_gpu_batch_size=1，gradient_accum=8

**经典场景题 2**：「100B+ 模型该用 FSDP 还是 Megatron？」
→ FSDP all-gather 完整层的通信开销在超大模型时太高 → Megatron TP（层内切分） + PP（流水线）是必须的。DeepSeek V2 配置参考：TP=8, PP=16, DP=…

**经典场景题 3**：「训练时显存不够，先调什么？」
→ 便宜方案：Gradient Checkpointing（以算力换显存，~20% 训练时间换 ~50% 显存）
→ 中等方案：ZeRO-2 → ZeRO-3
→ 大动干戈：TP + PP 模型并行

> ✅ **时效判断**：2025-2026 面试出现"给配置推 batch size"类场景题频率上升，纯背表格不够了。

---

## 来源汇总

- CSDN 大模型面试20题 — Transformer 与分布式训练核心解析
- AgentGuide 面经 — LoRA、FSDP 面试追问
- 小林笔记 — QLoRA NF4、PagedAttention 图解
- 牛客面经 — KV Cache 显存计算场景题
- DeepSeek 工程博客 — MoE + 3D 并行工程实践

**🔍 下次搜索关键词**：Megatron TP 实现细节、Gradient Checkpointing 公式推导、DeepSeek 的 Multi-Token Prediction 训练加速
