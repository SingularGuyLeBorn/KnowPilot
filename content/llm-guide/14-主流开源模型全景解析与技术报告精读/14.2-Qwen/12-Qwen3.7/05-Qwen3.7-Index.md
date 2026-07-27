---
title: "05 · Qwen3.7 Index"
date: 2026-05-24
status: completed
tags:
  - Qwen
  - Qwen3.7
  - Agent
  - Long-Horizon
---

# Qwen3.7 技术入口

> 返回上级：[14.2-Qwen](../../14.2-Qwen.md)

Qwen3.7-Max 是 Qwen 系列向「智能体基座」战略转型的旗舰节点(2026-05, 仅 API). 其核心卖点不是单一 benchmark 再涨 2%, 而是长程自主执行(35 小时 / 1,158 次工具调用)、跨框架泛化(Claude Code / OpenClaw / Qwen Code)与环境扩展驱动的 Agent 能力泛化.

## 文档导航

| 文件 | 说明 |
| --- | --- |
| [01-Qwen3.7 技术报告精译](./01-Qwen3.7技术报告精译.md) | 基于官方博客的中文精译主稿 |
| [03-Qwen3.7-mineru-en](./03-Qwen3.7-mineru-en.md) | 英文源资料整理稿 |
| [04-Qwen3.7-mineru-zh](./04-Qwen3.7-mineru-zh.md) | 中文交付稿(含译者注) |
| [05-Qwen3.7 长程自主执行专题](./05-Qwen3.7-长程自主执行与跨框架泛化的工程实践.md) | 35h kernel 优化与跨框架 RL 工程拆解 |

## 技术问题定义

Qwen3.7 要解决的不是「再做一个更强的聊天模型」, 而是四个 Agent 时代问题. 第一, 能否在数百至数千步的长周期任务中保持策略连贯, 不因上下文腐化或指令漂移而崩溃? 第二, 能否在 Claude Code、OpenClaw、自定义 Harness 等不同运行框架下稳定发挥, 而非过拟合单一脚手架? 第三, 能否通过扩展训练环境(而非单环境过优化)实现 Agent 能力的可预测泛化? 第四, 能否在未见硬件/未见评测环境上依靠运行时反馈完成复杂工程任务(如 GPU kernel 优化)?

## 方法拆解

Qwen3.7 的方法主线包括五条.

**环境扩展 RL**: 在 Qwen3.5 基础上大幅扩展 Agent 训练环境的质量与多样性; 评测环境均为训练外 OOD 环境; 子集 benchmark 增益可预测整体增益.

**Task / Harness / Verifier 解耦**: Rollout 基础设施三组件正交重组, 支持跨框架、跨验证器 RL, 迫使模型学习任务本质而非框架捷径.

**长程自主执行训练**: YC-Bench 等超千步决策任务强化规划一致性; SWE RL 中加入奖励作弊自主监控(80h+, 13 条自进化规则).

**自适应推理预算**: Terminal Bench 等评测允许每轮自主选择 extended thinking; API 层 `preserve_thinking` 保留多轮思维链.

**实战验证 trilogy**: (1) 35h M890 PPU kernel 优化 10.0x; (2) RL 作弊监控 1,618 案例; (3) YC-Bench 营收 2.08M vs 前代 1.05M.

## 工程与架构分析

工程上,Qwen3.7-Max 的定位是「企业级 Agent 运行时」而非「可自部署开源权重」.

**API 优先**: 1M 上下文, 百炼 `qwen3.7-max`, 兼容 OpenAI / Anthropic 接口, 集成 Claude Code / OpenClaw / Qwen Code. 无开源权重意味着能力边界由云 API 定义.

**评测体系 Agent 原生**: Terminal Bench(5h/256K)、Kernel Bench L3(隔离 Docker/CUTLASS only)、MCP-Mark/Atlas、QwenClawBench(已部分开源)、CoWorkBench、SkillsBench(OpenCode 78 任务). 分数来自多框架, 强调跨 Harness 一致性.

**可靠性参数 vs 能力参数**: Kernel 对比表显示 Qwen3.6-Plus 1.1x 后主动停止(元认知放弃), Qwen3.7-Max 10.0x 完成——差异在「知道何时坚持」. 这是长程 Agent 的关键工程指标.

**与谱系关系**: Qwen3(双模式) → Qwen3.5(原生多模态 Agent) → Qwen3.6(全尺度编程) → Qwen3.7(长程自主 + 跨框架). 平均 1-2 月一个大版本, 生态锁定优先于论文完整披露.

## 结论与适用边界

Qwen3.7-Max 适合:

- 需要数小时级自主 Agent 运行的企业工作流(办公自动化、长文档分析、复杂代码工程)
- 多框架部署(Claude Code / OpenClaw / 自研 Harness)且不愿被单一生态绑定
- GPU 内核/性能工程等需要 In-context 硬件探索的场景
- 对 SWE RL 训练需奖励作弊监控的研究/平台团队

适用边界:

1. **仅 API, 无开源权重**: 无法本地私有化完整能力, 成本与数据合规受云服务商约束.
2. **技术报告未发布**: 环境扩展细节、Scaling Law 公式、架构参数未公开, 深度复现困难.
3. **受控实验 vs 开放世界**: 35h kernel 实验有预设任务/脚本/参考实现; YC-Bench 仍是模拟环境.
4. **xhigh reasoning 分数**: HLE/GPQA 等旗舰分数在最大推理预算下取得, 生产默认配置会打折.
5. **高频版本迭代**: API 兼容性与文档可能滞后, 企业需评估升级节奏.

Qwen3.7 的强项是「长程可靠 Agent + 跨框架泛化 + 环境扩展方法论」, 代表 Qwen 从语言模型竞赛进入 Agent 基础设施竞赛.
