---
title: "01 · MiniMax-M2 技术报告精译"
---
# MiniMax-M2 技术报告精译

>  **[返回 14.8-MiniMax 家族总览](../../14.8-MiniMax.md)**


> **模型定位**：全球首批将 Transformer 与 Linear Attention(闪电注意力 Lightning Attention)深度融合的开源旗舰。
> 
## 1. 核心瓶颈突破
在极长上下文(百万级别)下，传统 Softmax Attention 的 $O(N^2)$ 计算复杂度与内存占用是毁灭性的。M2 通过引入 Lightning Attention，将复杂度降至 $O(N)$，使得在普通硬件上跑通超长文成为可能。
