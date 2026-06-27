---
title: "Qwen3.7 - 逐段精译与译者注"
source: 03-Qwen3.7-mineru-en.md
source_type: "official blog announcement"
translated_by: "AI Agent"
date: 2026-05-24
status: completed
---

# Qwen3.7: 面向智能体时代的新一代旗舰模型

> [返回 14.2-Qwen 家族总览](../../14.2-Qwen.md)

## 说明

Qwen3.7-Max 无独立技术报告 PDF, 且未开放权重(仅 API). 本文基于 2026-05-20 官方博客整理, 用于闭环 D3 / D4 / D5.

## Introduction

We release Qwen3.7-Max, a new flagship for the agent era, available via API.

今天我们正式发布 Qwen3.7-Max——面向智能体时代的新一代旗舰模型, 即将通过 API 提供服务.

> **译者注**: Qwen3.7 距 Qwen3.6 仅约一个月, 「月更」节奏在旗舰领域极为罕见. 核心叙事从 benchmark 分数转向「35 小时自主执行不崩溃」——从能力参数到可靠性参数的范式转移.

It aims to be a universal agent foundation for coding, office automation, and long-horizon autonomous execution.

Qwen3.7-Max 致力于成为全能智能体基座: 编程调试、办公自动化、跨越数百至数千步的长周期自主执行.

## 1 Model Performance

### 1.1 Coding Agents

| 基准 | Opus-4.6 Max | K2.6 Thinking | GLM-5.1 Thinking | DS-V4-Pro Max | Qwen3.6-Plus | **Qwen3.7-Max** |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|
| Terminal Bench 2.0-Terminus | 65.4 | 66.7 | 63.5 | 67.9 | 61.6 | **69.7** |
| SWE-Verified | 80.8 | 80.2 | — | 80.6 | 78.8 | **80.4** |
| SWE-Pro | 57.3 | 59.5 | 58.8 | 59.0 | 56.6 | **60.6** |
| SWE-Multilingual | 77.5 | 76.7 | — | 76.2 | 73.8 | **78.3** |
| NL2repo | 47.6 | 42.8 | 41.0 | 35.5 | 34.4 | **47.2** |
| SciCode | 51.9 | 52.2 | 45.1 | — | 41.4 | **53.5** |
| QwenSVG | 1541 | 1325 | 1605 | 1506 | 1432 | **1608** |

> **评测配置说明**:
> - Terminal Bench 2.0: Harbor/Terminus-2 harness; 5h timeout, 12 CPU/24 GB RAM; temp=1.0, top_p=0.95, top_k=20, max_tokens=80K, 256K ctx; avg of 5 runs.
> - SWE-Bench 系列: Internal agent scaffold (bash + file-edit tools); temp=1.0, top_p=0.95, 200K context window.
> - SWE-bench Pro: Problematic tasks corrected and all baselines evaluated on the refined benchmark.
> - NL2repo: Evaluated via Claude-code. Bash commands that attempt to access the specific repository (pip download, pip install, git clone) are disabled.

> **译者注**: Terminal Bench 2.0 使用 5h 超时与 256K 上下文, 每轮可自主选择是否 extended thinking, 更贴近真实编程 Agent 场景.

### 1.2 General Agents

| 基准 | Opus-4.6 Max | K2.6 Thinking | GLM-5.1 Thinking | DS-V4-Pro Max | Qwen3.6-Plus | **Qwen3.7-Max** |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|
| Qwenclaw | 65.5 | 54.7 | 58.7 | 59.2 | 57.2 | **64.3** |
| CoWorkBench | 68.2 | 58.2 | 66.0 | 66.3 | 64.5 | **67.2** |
| ClawEval | 70.4 | 61.5 | 62.7 | 58.4 | 57.1 | **65.2** |
| Skillsbench | — | 56.2 | 53.1 | 52.3 | 45.7 | **59.2** |
| BFCL-V4 | 76.7 | 71.3 | 70.9 | 70.6 | 68.9 | **75.0** |
| MCP-Mark | 56.7 | 55.9 | 57.5 | 57.1 | 48.2 | **60.8** |
| MCP-Atlas | 75.8 | 66.6 | 71.8 | 73.6 | 74.1 | **76.4** |
| SpreadSheetBench-v1 | 89.3 | 84.5 | 85.2 | 84.9 | 80.2 | **87.0** |
| Kernel Bench L3 | 2.63/98% | 1.41/80% | 2.00/78% | 1.07/54% | 1.03/48% | **1.98/96%** |
| HLE w/ tools | 53.0 | 54.0 | 52.3 | 48.2 | 50.2 | **53.5** |
| QwenWorldBench | 56.1 | 50.9 | 50.2 | 52.3 | 47.6 | **57.3** |

> **评测配置说明**:
> - QwenClawBench: 真实用户分布的 Claw agent 基准; 开源: https://github.com/SKYLENAGE-AI/QwenClawBench.
> - CoWorkBench: 内部 cowork 基准; 覆盖计算机科学、金融、法律、医学等生产力领域的长程任务.
> - SkillsBench: 通过 OpenCode 在 78 个任务上评估(排除 9 个依赖外部 API 的任务); 5 次运行平均.
> - MCP-Mark: GitHub MCP v0.30.3; Playwright responses truncated at 32K tokens.
> - MCP-Atlas: Public set score; gemini-2.5-pro judger.
> - Kernel Bench L3: 中位数加速比(相对于 PyTorch eager 参考) / 超过 torch.compile 的问题比例, 共 50 个问题. 每个测试在独立 Docker 容器中运行(H100 80GB), 互联网限制为 CUTLASS 代码库和官方 CUDA 文档, 最多 500 次工具调用, 100 次无改进后提前停止. GPT-5.4 (xhigh) 检测潜在作弊行为. CUPTI 用于内核级计时.

> **译者注**: Kernel Bench L3 在隔离 Docker 中仅依赖 CUTLASS 与 CUDA 文档自主写 GPU 内核; 96% 加速率说明具备性能工程能力, 但 GPT-5.4 反作弊检测暗示 Agent 评测复杂性.

### 1.3 STEM and Reasoning

| 基准 | Opus-4.6 Max | K2.6 Thinking | GLM-5.1 Thinking | DS-V4-Pro Max | Qwen3.6-Plus | **Qwen3.7-Max** |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|
| GPQA Diamond | 91.3 | 90.5 | 86.2 | 90.1 | 90.4 | **92.4** |
| HLE | 40.0 | 36.4 | 34.7 | 37.7 | 28.8 | **41.4** |
| LiveCodeBench | 88.8 | 89.6 | — | 93.5 | 87.1 | **91.6** |
| HMMT 2026 Feb | 96.2 | 92.7 | 89.4 | 95.2 | 87.8 | **97.1** |
| IMOAnswerBench | 75.3 | 86.0 | 83.8 | 89.8 | 83.8 | **90.0** |
| CritPT | 12.6 | 8.0 | 4.6 | 12.9 | 2.9 | **11.4** |
| Apex | 34.5 | 24.0 | 11.5 | 38.3 | 8.8 | **44.5** |

> **评测配置说明**:
> - Reasoning scenarios: 推荐系统提示: "Reasoning effort is set to xhigh. Please think carefully through the task, validate key assumptions, consider plausible alternatives, and prioritize correctness, consistency, and clarity in the final answer."

> **译者注**: HLE 41.4% 在 xhigh reasoning budget 下取得; 实际部署降低推理预算时分数会显著下降.

### 1.4 General Capability and Multilingual

| 基准 | Opus-4.6 Max | K2.6 Thinking | GLM-5.1 Thinking | DS-V4-Pro Max | Qwen3.6-Plus | **Qwen3.7-Max** |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|
| MMLU-Pro | 89.7 | 87.1 | 86.3 | 87.5 | 88.5 | **89.6** |
| MMLU-Redux | 95.2 | 95.3 | 94.3 | 94.8 | 94.5 | **95.0** |
| SuperGPQA | 72.5 | 71.3 | 68.0 | 69.9 | 71.6 | **73.6** |
| IFEval | 91.9 | 94.5 | 94.5 | 91.9 | 94.3 | **94.3** |
| IFBench | 62.5 | 76.0 | 76.0 | 77.0 | 74.2 | **79.1** |
| MRCR-v2 128k | 84.0 | 63.1 | 62.0 | 74.4 | 85.9 | **90.4** |
| WMT24++ | 82.7 | 81.6 | 81.8 | 82.2 | 84.3 | **85.8** |
| MAXIFE | 81.3 | 87.7 | 87.7 | 88.9 | 88.2 | **89.2** |

> **评测配置说明**:
> - MRCR-v2: 128K context subset containing 8 needles utilized.
> - WMT24++: Harder WMT24 subset; avg scores on 55 langs via XCOMET-XXL.
> - MAXIFE: Accuracy on EN + multilingual prompts (23 settings total).

> **译者注**: MRCR-v2 128K(90.4%) 测检索非复杂推理; IFBench(79.1) 更能反映复杂指令遵循可靠性.

## 2-4 Agent Training and Generalization

Qwen3.7 在 Qwen3.5 环境扩展基础上大幅扩展 Agent 训练环境质量与多样性. Rollout 基础设施将 Task / Harness / Verifier 三组件解耦, 支持跨框架 RL, 避免过拟合特定脚手架.

> **译者注**: 第三条路线——「环境扩展驱动泛化」, 类似预训练 Loss Scaling Laws, 若成立可为 Agent 训练资源分配提供科学依据.

## 5 Case Study: 35-Hour Kernel Optimization

35 小时自主优化 Extend Attention kernel: 1,158 次工具调用, 相对 Triton 几何平均 10.0x 加速, 30+ 小时后仍有改进.

| 模型 | 相对 Triton 参考实现的加速比 | 提前停止原因 |
|:---|:---:|:---|
| **Qwen3.7-Max** | **10.0x** | 完成优化 |
| GLM-5.1 | 7.3x | 完成优化 |
| Kimi K2.6 | 5.0x | 完成优化 |
| DeepSeek V4 Pro | 3.3x | 完成优化 |
| Qwen3.6-Plus | 1.1x | 主动结束(连续五轮未发出工具调用) |

> **译者注**: 零 M890 硬件先验, 依靠运行时反馈学习; 但任务描述、评估脚本、参考实现均为预设, 真实场景更难.

## 6-7 Additional Case Studies

80+ 小时 RL 奖励作弊自主监控: 新增 13 条规则, 识别 1,618 作弊案例.

YC-Bench 模拟经营: 营收 2.08M 美元, 237 项任务, 展现跨上下文窗口策略进化.

## 8 Getting Started

百炼 API 提供 Qwen3.7-Max; 支持 `preserve_thinking`; 可集成 Claude Code、OpenClaw、Qwen Code.

## 9 Summary

Qwen3.7-Max 是迄今最全面的 Agent 模型, 融合前沿推理、跨框架泛化与长程执行.

> **译者注(局限风险)**: (1) 仅 API 无开源权重; (2) 高频迭代带来兼容性与文档滞后风险; (3) 35h/80h 实验条件受控; (4) 自监控 RL 存在「谁来监控监控者」问题; (5) 完整技术报告尚未发布.

## 全文完

## 关联文件说明

- 英文源资料整理稿: `03-Qwen3.7-mineru-en.md`
- 中文精译主稿: `01-Qwen3.7技术报告精译.md`
- D5 专题: `05-Qwen3.7-长程自主执行与跨框架泛化的工程实践.md`
- D5 Index: `05-Qwen3.7-Index.md`
- 源资料: `pdfs/Qwen3.7.html`
- 原文链接: https://qwen.ai/blog?id=qwen3.7
