---
title: "MiniMax-M2.1 极长上下文对齐"
---
# MiniMax-M2.1 核心技术专题：极长上下文与专家路由优化

>  **[返回 14.8-MiniMax 家族总览](../../14.8-MiniMax.md)**


## MoE 与线性注意力的化武效应
M2.1 将 MoE 架构与 Lightning Attention 进行了底层算子级别的融合 (Triton 优化)。它证明了，在极长文中，部分 Token 只需要极少数专门处理时序关联的 Expert，这种解耦大幅度降低了冗余计算。
