---
title: "03 · Qwen3.7 - Source Notes (EN)"
source: "https://qwen.ai/blog?id=qwen3.7"
source_type: "official blog announcement"
compiled_by: "AI Agent"
date: 2026-05-24
status: completed
---

# Qwen3.7: The Agent Frontier

> [Back to 14.2-Qwen family overview](../../14.2-Qwen.md)

## Source note

Qwen3.7-Max has no standalone public technical report PDF and no open weights (API only). Source: official blog (2026-05-20), preserved under `pdfs/Qwen3.7.html`. This is a cleaned English source-note document, not MinerU PDF extraction.

## Introduction

We release Qwen3.7-Max, a new flagship for the agent era, available via API. It aims to be a universal agent foundation: coding/debugging, office automation, and long-horizon autonomous execution across hundreds or thousands of steps.

Key strengths: breadth and depth of agent capability; coding from frontend prototypes to multi-file engineering; productivity via MCP and multi-agent collaboration; 35-hour autonomous kernel optimization with 1,000+ tool calls; strong cross-framework generalization (Claude Code, OpenClaw, Qwen Code, etc.).

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

On coding agents, Qwen3.7-Max leads on SWE-Pro (60.6), SWE-Multilingual (78.3), SciCode (53.5), QwenSVG (1608), and Terminal Bench 2.0-Terminus (69.7).

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

On general agents, Qwen3.7-Max excels on MCP-Mark (60.8), MCP-Atlas (76.4), Skillsbench (59.2), Kernel Bench L3 (1.98x median speedup, 96% accelerated), BFCL-V4 (75.0), SpreadSheetBench-v1 (87.0).

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

On reasoning, Qwen3.7-Max leads on GPQA Diamond (92.4), HLE (41.4), HMMT 2026 Feb (97.1), IMOAnswerBench (90.0), Apex (44.5).

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

On general capability, Qwen3.7-Max leads on IFBench (79.1), WMT24++ (85.8), MAXIFE (89.2), MRCR-v2 128K (90.4), SuperGPQA (73.6).

Scores come from diverse agent frameworks; Qwen3.7-Max generalizes across Claude Code, OpenClaw, Qwen Code, and custom harnesses.

## 2 Productivity Assistant

Qwen3.7-Max supports long-horizon delivery: hours of autonomous planning, thousands of tool calls, dozens of version iterations. Complex projects that once took professional teams 1-2 weeks may close in hours via agent-driven end-to-end delivery.

## 3 Agent Scaling

Building on Qwen3.5 environment scaling, Qwen3.7 greatly expands agent training environment quality and diversity. Agent capability generalizes from diverse environments like language models from diverse pretraining text.

Environment scaling yields stable performance gains; Qwen3.7-Max ranks top-3 overall, near Claude-4.6-Opus-Max. All evaluated environments are out-of-domain vs training. Gains on any benchmark subset predict overall gains, indicating true generalization not benchmark overfitting.

## 4 Cross-Framework Generalization

Rollout infrastructure decouples Task, Harness, and Verifier—freely recombinable. Compatible with multiple harness versions; environments grounded in real scenarios. Enables cross-harness and cross-verifier RL: same task with varying harness configs forces general strategies not harness shortcuts.

On QwenClawBench and CoWorkBench, Qwen3.7-Max performs strongly regardless of evaluation harness, surpassing Qwen3.6 series.

## 5 Case Study: 35-Hour Autonomous Evolution

Extend Attention kernel optimization on Pingtouge M890 PPUs (unseen hardware): 432 kernel evaluations, 1,158 tool calls over ~35 hours. Geometric mean 10.0x speedup vs Triton reference. Meaningful improvements continued after 30+ hours.

### 5.1 Structural Leaps in Optimization Trajectory

| 模型 | 相对 Triton 参考实现的加速比 | 提前停止原因 |
|:---|:---:|:---|
| **Qwen3.7-Max** | **10.0x** | 完成优化 |
| GLM-5.1 | 7.3x | 完成优化 |
| Kimi K2.6 | 5.0x | 完成优化 |
| DeepSeek V4 Pro | 3.3x | 完成优化 |
| Qwen3.6-Plus | 1.1x | 主动结束(连续五轮未发出工具调用) |

Early-stopped models halted after five consecutive rounds without tool calls. Qwen3.7-Max also generates production kernels on multiple NVIDIA GPUs; KernelBench L3: 96% scenarios with speedup.

Demonstrates long-horizon coherent reasoning (1,000+ tool calls) and strong in-context generalization on unseen hardware.

## 6 Case Study: Reward Hacking Self-Monitoring

Qwen3.7-Max monitors SWE RL training for reward hacking over 80+ hours: 10,000+ calls, evolved 13 heuristic rules, identified 1,618 cheating cases, stabilizing RL rewards.

## 7 Case Study: Long-Horizon Business Planning

YC-Bench (year-long startup simulation): Qwen3.7-Max revenue $2.08M vs Qwen3.6-Plus $1.05M vs Qwen3.5-Plus $352K; 237 tasks completed. Shows cross-context strategy evolution.

## 8 Getting Started

Qwen3.7-Max via Alibaba Cloud Bailian. Supports `preserve_thinking` for agent tasks. Integrates with Claude Code, OpenClaw, Qwen Code.

## 9 Summary

Qwen3.7-Max is our most comprehensive agent model: coding, office automation, long-horizon autonomy, frontier reasoning, cross-framework generalization.

## Appendix: Key Terms

| Term | Description |
|:---|:---|
| Agent | AI system that plans, uses tools, interacts with environment |
| MCP | Model Context Protocol for tool interaction |
| Harness | Agent runtime: task, tools, verification |
| Reward Hacking | Exploiting reward function without solving task |
| Kernel | GPU compute function |
| Triton | Python DSL for GPU kernels |
| SGLang | Efficient LLM serving framework |
| MTP | Multi-Token Prediction |
| KV Cache | Cached keys/values for attention |
| RL | Reinforcement Learning |
| YC-Bench | Long-horizon startup simulation benchmark |
| SWE-Bench | Software engineering issue-fix benchmark |
