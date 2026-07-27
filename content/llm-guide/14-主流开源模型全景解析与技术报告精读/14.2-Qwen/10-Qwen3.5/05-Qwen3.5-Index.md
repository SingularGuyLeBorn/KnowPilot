---
title: "05 · Qwen3.5 Index"
date: 2026-05-24
status: completed
tags:
  - Qwen
  - Qwen3.5
  - MoE
  - Multimodal
  - Agent
---

# Qwen3.5 技术入口

> 返回上级：[14.2-Qwen](../../14.2-Qwen.md)

Qwen3.5 是 Qwen 系列从「强基础模型 + 独立 VL 线」向「原生多模态 Agent 基座」转型的关键节点. 旗舰开放权重版本 Qwen3.5-397B-A17B 采用 Gated DeltaNet + 稀疏 MoE 混合架构, 在 17B 激活参数下对标 1T+ 级能力, 并将文本、图像、视频预训练与大规模 RL 环境扩展整合为一条面向 Agent 的产品路线.

## 文档导航

| 文件 | 说明 |
| --- | --- |
| [01-Qwen3.5 技术报告精译](./01-Qwen3.5技术报告精译.md) | 基于官方博客的中文精译主稿 |
| [03-Qwen3.5-mineru-en](./03-Qwen3.5-mineru-en.md) | 英文源资料整理稿(无独立 PDF) |
| [04-Qwen3.5-mineru-zh](./04-Qwen3.5-mineru-zh.md) | 中文交付稿(含译者注) |
| [05-Qwen3.5-Architecture-Overview](./05-Qwen3.5-Architecture-Overview.md) | 混合注意力、MoE、多模态与 RL 框架深度拆解 |

## 技术问题定义

Qwen3.5 要解决的核心问题可以概括为四点. 第一, 如何在旗舰能力密度与推理成本之间取得更优折中——397B 总参数仅激活 17B, 却要在推理、代码、Agent 和多模态上同时对标闭源 frontier. 第二, 如何把「视觉理解」从后拼接 ViT 升级为预训练阶段的原生多模态融合, 使 GUI Agent、空间推理和代码级图像操作成为一等能力. 第三, 如何把 Post-training 从静态偏好对齐推进到可扩展的 RL 环境闭环, 让 Agent 泛化能力随环境规模增长而非 benchmark 调参. 第四, 如何在 1M 上下文 API 版本下, 通过线性注意力(Gated DeltaNet)降低长序列解码的吞吐瓶颈.

## 方法拆解

Qwen3.5 的方法主线分为架构、预训练、后训练与基础设施四层.

**架构层**: Gated DeltaNet(线性注意力, $O(n)$ 复杂度)与 Gated Attention(标准注意力的门控变体)混合, 短上下文精细对齐、长上下文高吞吐; 稀疏 MoE(397B/17B)进一步压缩激活成本; 25 万词表与 201 种语言覆盖提升编码效率与全球可用性.

**预训练层**: 更大规模视觉-文本语料 + 更严格过滤 + 加强 STEM/推理数据; 早期文本-视觉融合实现原生多模态; 基座 Qwen3.5-397B-A17B 与 Qwen3-Max-Base(1T+) 表现相当.

**后训练层**: 相对 Qwen3 全面扩展 RL 任务与环境, 强调环境难度与可泛化性; Agent 能力(BFCL-V4、VITA-Bench、MCP-Mark 等)随 RL Environment scaling 显著提升.

**基础设施层**: 视觉 TP + 语言 EP 异构并行(混合模态训练吞吐近 100%); 原生 FP8 + 运行时 BF16 回退; 异步 RL 训推分离框架(3-5x 端到端加速, 支持百万级 Agent 脚手架).

## 工程与架构分析

从工程落地看, Qwen3.5 有三个值得关注的系统设计.

第一, **混合注意力是长上下文吞吐的关键**. 官方数据: 32k/256k 下解码吞吐分别为 Qwen3-Max 的 8.6x/19.0x, 256k 加速比远高于 32k, 说明线性注意力在长序列 KV Cache 压力场景的收益最大. 这与 2025-2026 年旗舰模型普遍采用「精确注意力 + 线性注意力」混合范式的行业趋势一致.

第二, **原生多模态 + 代码级图像处理改变 Agent 能力边界**. V* 基准启用 Code Interpreter 达 95.8; OSWorld-Verified(62.2)和 AndroidWorld(66.8)接近 Claude 4.5 Opus. 这意味着视觉 Agent 不再依赖「描述图像再推理」, 而是直接在统一表征空间中进行像素级操作.

第三, **产品层已就绪**. Qwen Chat 提供 auto/thinking/fast 三模式; 百炼 API(Qwen3.5-Plus)支持 1M 上下文、`enable_thinking`、`enable_search`; 兼容 OpenAI 接口并可集成 Qwen Code、Claude Code、Cline 等. 开放权重 Qwen3.5-397B-A17B 与 API 版本形成「自部署 + 云服务」双轨.

## 结论与适用边界

Qwen3.5 适合需要「单一模型覆盖推理 + 代码 + Agent + 多模态」的团队, 尤其是:

- 需要 GUI/移动端视觉 Agent 能力的应用
- 需要长上下文(256k-1M)高吞吐解码的场景
- 需要 201 种语言覆盖的全球化产品
- 希望基于开放权重自部署又需要百炼 API 弹性的混合架构

适用边界同样清晰:

1. **无独立技术报告 PDF**: 当前公开信息以博客为主, 详细消融、训练配方、RL 环境设计可能不完整, 需关注后续技术报告.
2. **MoE 部署门槛**: 17B 激活参数 + all-to-all 通信对推理集群有要求, 消费级单卡部署仍有 40GB+ 显存压力.
3. **异步 RL 的长轨迹风险**: 50+ 轮 Agent 交互中样本陈旧性控制尚未被充分验证.
4. **低资源语言深度**: 201 种语言覆盖广, 但部分语种可能存在「有覆盖、深度不足」的问题.
5. **benchmark 策略依赖**: BrowseComp 等搜索 Agent 分数对上下文管理策略(discard-all vs folding)敏感, 部署时需复现官方策略.

Qwen3.5 的强项是「原生多模态 Agent + 极致稀疏效率 + 工程化 RL 基础设施」, 不是在每个单点 benchmark 上都绝对第一, 而是把 Qwen 系列推向 Agent 原生时代的产品化收束.
