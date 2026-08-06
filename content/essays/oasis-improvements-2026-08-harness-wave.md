---
title: 见微可落地改进汇总（2026-08 Harness / RSI / 长任务波次）
category: 工程随笔
published: true
excerpt: >-
  把本波次精读（LongHorizon-Harness、微软
  Orchard/OpenForge/Evolving-Intent/ReOPD、Argus、RSIBench 等）
  收成一份可开工改进清单：按优先级写清动机、目标模块与验收标准，禁止散落在各精读文里。
tags:
  - oasismind
  - harness
  - long-horizon
  - rsi
  - roadmap
---
# 见微可落地改进汇总（2026-08 Harness / RSI / 长任务波次）

> **本篇是本波次唯一写「见微怎么改」的地方。** 各精读文只做原文精读 + 架构解析，文末一行指回这里。\
> 素材：`content/uploads/papers/*.pdf`、`content/uploads/github-readme/*.md`；精读见 `longhorizon/notes`、`rsi/notes`、`llm-guide/notes`。

## 优先级总表（对见微价值从高到低）

| P  | 主题                                    | 主要来源                                  | 见微落点（模块）                                                     |
| -- | ------------------------------------- | ------------------------------------- | ------------------------------------------------------------ |
| P0 | 长任务 MEA：状态外置 + 审计准入                   | LongHorizon-Harness                   | `goalLoop` / SessionGoal / Swarm 角色分工 / Run.output           |
| P0 | 演化意图：reveal / revision / switch 显式状态机 | Evolving User Intent                  | Chat steer 队列、`session_goal_*`、Compose drain                 |
| P1 | 验证门控的 runtime 自进化（固定权重）               | Argus                                 | Skill curator、Memory scope、AgentMessage 台账、审批 decision-scope |
| P1 | Harness = 可执行/可验证/有状态的外壳              | Code as Agent Harness + Orchard       | `infra/loop/*`、ToolCommand、Workspace、SessionStreamHub        |
| P2 | 训练期 Env 与部署 harness 对齐（认知+远期）         | OpenForge RL / Orchard                | 评测沙箱、mock-llm、E2E harness；非近期训练栈                             |
| P2 | 数据中心 RSI 评测思维                         | RSIBench-Data                         | 心跳决策、Skill 晋升门槛、checkpoint 保留策略                              |
| P3 | 多轮蒸馏 / 探索轴 / 端侧小模型                    | ReOPD / Explorative Modeling / LFM2.5 | 后训练知识库；可选本地小模型路由                                             |
| P3 | 科研 Agent / 课程 Skill / 资源工具            | Polaris / CS329A / bilibili2skill 等   | `config/skills`、resources 花园；非核心 runtime                     |

***

## P0-1 · MEA 风格的任务状态外置（LongHorizon-Harness）

### 动机

见微已有 ReAct + Goal + Swarm + 审批，但长 Goal / 过夜调研时，**进度真相仍常混在增长的 ChatMessage 上下文里**；Agent 自评「做完了」缺少环境侧独立认证（MEA 的 Auditor）。

### 建议改动

1. **TaskState 显式结构**（建议挂在 `ChatSession.goal` 或独立 JSON 列）：`intent` / `verifiedProgress[]` / `nextSubtask` / `openRisks`；只允许经「审计结果」写入 `verifiedProgress`。
2. **三角色轻量映射（不强制三进程）**：
   * Manager ≈ Goal 外环 / manager-tier Agent：只读 verified 状态派下一子任务；
   * Executor ≈ 当前 run / subagent：fresh 子会话或强 compact 后执行单子任务；
   * Auditor ≈ 只读工具批次 + 可选独立模型：核对文件/测试/post\_list 结果，产出 audit report。
3. **跨轮唯一记忆 = audit report**：对标现有 `contextSummary` / auto-compact——长 Goal 结束后把审计事实写入 GoalState，而不是整段 transcript。
4. **AgentAdapter 思路**：见微已是自有 harness；重点是 **角色可换模型**（criticModel 已存在于 reflection），把 auditor 接到 `config.yaml` 便宜模型。

### 验收

* [ ] 过夜 Goal 刷新后仍能从 DB 恢复 `verifiedProgress`（PULL）
* [ ] 子任务完成但审计失败时，状态不前进（PUSH 事件可见）
* [ ] 删掉「自评 done」路径后，错误完成率下降（对照手工抽检）

### 精读

* [LongHorizon-Harness](../longhorizon/notes/longhorizon-harness.md)

***

## P0-2 · 演化意图状态机（Evolving User Intent）

### 动机

见微 Chat 已有 steer / follow\_up / 用户队列，但**没有把「意图修订」与「任务切换」从普通追加消息中区分开**。论文显示 function switch 是最大跌点；oracle 复述当前目标仍难追回单轮水平——说明需要**结构化状态更新**，不是更长历史。

### 建议改动

1. **IntentContract**：`function` + `arguments{}` + `superseded[]`；用户消息可标注/由轻量分类器标为 `reveal | revision | switch`。
2. **revision**：覆盖旧 argument，写入 tombstone（禁止被 compact 摘要当成仍有效）。
3. **switch**：归档当前 Goal 子树为 paused/superseded，开新 Goal 分支并显式 handoff「仍有效的约束」。
4. **评测**：用 `microsoft/evolving-intent` 思路，把内部可验证任务（如 post 写入、tool 沙箱断言）升维成多轮意图扰动回归（mock-llm scenario）。

### 验收

* [ ] 用户中途改约束后，工具调用不再使用旧 argument（抽检 trace）
* [ ] switch 后旧 Goal 不继续 autoConsume 污染新目标
* [ ] 新增至少 2 个 mock-llm evolving-intent 场景 E2E

### 精读

* [Evolving User Intent](../longhorizon/notes/evolving-user-intent.md)

***

## P1-1 · Verification-gated 运行时自进化（Argus）

### 动机

见微已有 Skill、Memory、curator、心跳决策；缺的是 Argus 式：**候选技能/记忆/路由入持久态前必须角色门控 + 任务原生证据**，否则「自进化」= 污染搜索策略。

### 建议改动

1. **Standing intent ι vs 操作合同 (o,c,v)**：心跳 / Goal 文案拆成稳定意图与可修订操作目标；pivot 必须写 Log + 证据引用。
2. **Admission 门**：Skill 晋升、Memory 写入 global/workspace、失败路径记入「rejected routes」——对齐 `approvalScope` / destructive 审批，扩展到「可复用经验」而不只是破坏性工具。
3. **四角色轻映射**：Manager=super/Goal；Planner=manager；Engineer=sub/executor；Reviewer=独立 run 或 reflection critic；低风险允许 Engineer self-review（记台账）。
4. **保留证伪路线**：RSIBench/Argus 都强调「失败路径有价值」——`data/sessions` 摘要与 Memory experience 应能引用 rejected route。

### 验收

* [ ] 无证据的 skill\_promote / memory\_create(global) 被硬拦
* [ ] 心跳 `terminal_no_followup` / `wait_user_gate` 能附带「已证伪路线」摘要
* [ ] 台账可查：某条经验因何证据被 admit

### 精读

* [Argus](../rsi/notes/argus-agentic-runtime.md)

***

## P1-2 · Harness 三性质自检（Code as Agent Harness + Orchard）

### 动机

见微 harness 已强（loop/tools/hub/审批），应用三性质做**缺口清单**，而不是再造一套：

| 性质         | 见微现状                      | 缺口                                |
| ---------- | ------------------------- | --------------------------------- |
| Executable | ToolCommand + native/MCP  | 长任务子目标缺少「环境断言」工具约定                |
| Verifiable | 审批、reflection、部分测试        | 缺通用 Auditor；完成度常靠 LLM 自评          |
| Stateful   | Session/DB/Workspace/Goal | GoalState 与 verifiedProgress 未产品化 |

Orchard 的启示：把 **Env（沙箱生命周期）** 与 **Harness（推理循环）** 分层——见微 E2E/mock 已部分做到，可把「可重置 Workspace + 断言」收成评测 Env 原语，供 Goal 过夜与 RSI 实验复用。

### 建议改动

1. 文档化「见微 Harness 边界图」进 `docs/development/`（执行器 vs 控制平面 vs 记录平面）。
2. 为 Goal 增加可选 `envAssertions[]`（文件存在、测试命令 exit 0、post 已发布）。
3. OpenForge/Orchard 的训练栈 **不作为近期产品目标**；只吸收「部署用什么 harness，评测就用什么 harness」原则到 E2E。

### 精读

* [Code as Agent Harness](../longhorizon/notes/code-as-agent-harness.md)
* [Orchard](../longhorizon/notes/orchard-agentic-modeling.md)
* [OpenForge RL](../longhorizon/notes/openforge-rl.md)

***

## P2 · RSIBench 思维：反馈不等于可靠改进

### 动机

RSIBench-Data：58% 场景能超过首次尝试，但达峰后续跑 **78% 最终更差**。见微心跳 / Skill curator / 自动改 prompt 若「有反馈就改」，会系统性回退。

### 建议改动

1. **Checkpoint 保留**：任何自动修改 config/agents、skills、prompts 前 git/版本快照；回退默认开启。
2. **Curator 门禁**：采纳变更需验证集或用户确认；禁止连续失败仍 raise 变更幅度。
3. **指标**：区分 discovery（出现过更好分数）与 reliability（最终提交仍好）。

### 精读

* [RSIBench-Data](../rsi/notes/rsibench-data.md)

***

## P3 · 知识库与 Skill 流水线（本波次元工作）

### 已落地（本 Goal）

1. **建库 SkillTemplate**：`config/skills/knowledge-garden/templates/garden-bootstrap.md`
2. **论文成文 SkillTemplate**：`config/skills/knowledge-garden/templates/paper-article.md`（精读→解析；改进集中本篇）
3. 论文 PDF → `content/uploads/papers/`；GitHub → `content/uploads/github-readme/`（不整仓 clone）

### 后续可做

1. `knowledge-garden` SKILL.md 主流程显式引用上述两模板；论文波次强制「改进只写汇总文」。
2. 接入 `bilibili2skill` / CS329A skill 为可选外部 Skill（人工审核后 `skills` 目录）。
3. Polaris 流水线对照见微 Goal 过夜科研场景，补「关键节点审批」文案到 super 模板。

### 精读 / 资源

* [Polaris](../rsi/notes/polaris-research-agent.md)
* [Stanford CS329A Skill](../rsi/notes/stanford-cs329a-agent-skill.md)
* [bilibili2skill](../resources/tools/bilibili2skill.md)
* 资源花园其它工具/创意 Skill：见 `resources/_garden.md`

***

## P3 · 模型与训练向（知识向，非马上改 runtime）

| 主题                   | 用途                                       |
| -------------------- | ---------------------------------------- |
| ReOPD                | 理解多轮 OPD 的 prefix trap；若未来蒸馏自家轨迹，优先早期步监督 |
| Explorative Modeling | 预训练第三轴「探索次数 K」——记入 llm-guide，暂不动产品       |
| LFM2.5-2.6B          | 端侧 agentic 候选；可进模型菜单调研，不替换默认云端模型         |

***

## 建议开工顺序（同一主题内）

1. **IntentContract + Goal verifiedProgress 数据模型**（P0-1 ∩ P0-2，一次 schema 设计）
2. **Auditor 只读回合**（可先复用 reflection critic 通道）
3. **经验 admit 门控**（P1-1，挂现有审批/ledger）
4. **evolving-intent mock 回归**（防回归）
5. 文档与 Skill 模板收口（已大部完成）

***

## 本波次资产索引

### PDF

`content/uploads/papers/`：`longhorizon-harness`、`llms-evolving-user-intent`、`openforge-rl`、`reopd-prefix-replay`、`orchard-agentic-modeling`、`code-as-agent-harness`、`argus-verification-guided`、`rsibench-data`、`explorative-modeling`

### GitHub README 摘要

`content/uploads/github-readme/`：LongHorizon-Harness、evolving-intent、ReOPD、RSIBench-Data、Orchard、Polaris、stanford-ai-agent-skill、bilibili2skill 等

### 精读文

见各花园 `_garden.md` 内容地图。
