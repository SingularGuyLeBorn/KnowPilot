---
title: "MiniMax-M2 Lightning Attention 架构解析"
---
# MiniMax-M2 核心技术专题：Lightning Attention 闪电注意力

>  **[返回 14.8-MiniMax 家族总览](../../14.8-MiniMax.md)**


## 1. 线性注意力的复兴
传统的 Transformer 饱受 KV Cache 显存墙的困扰。M2 摒弃了标准的 Softmax 归一化，通过核技巧 (Kernel Trick) 和右乘关联机制，在训练和推理时将复杂度极限压缩。这意味着无论上下文多长，理论上的推理状态大小都是固定的 (O(1) 的显存增长)。
