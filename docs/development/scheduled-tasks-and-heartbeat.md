# 定时任务与心跳机制 — 查看入口

> 一句话：日常状态看 Web 管理页，实现细节看对应源码与 L4/Swarm 文档。

---

## 1. 定时任务（Task）

| 层级 | 入口 | 说明 |
|---|---|---|
| Web 管理页 | `/tasks` | 创建、编辑、启用/禁用定时 Task；配置 cron 表达式与执行动作。 |
| 运行记录 | `/runs` | 查看每次 Task / Trigger / Agent 调度的实际执行结果、日志与耗时。 |
| 实现源码 | `apps/server/src/infra/taskRunner.ts` | Task 解析、调度、执行与重试逻辑。 |
| 设计文档 | `docs/development/L4-automation-workflows.md` | Trigger / Task / Approval 整体设计。 |

### Task 与 Trigger 的区别
- **Task**：面向“周期性后台脚本”，由 cron 驱动，执行 Skill / MCP / Agent。
- **Trigger**：面向“事件响应”，如文章发布、Agent 创建后自动触发某个动作。
- 两者都会在 `/runs` 产生运行记录。

---

## 2. Agent 心跳（Heartbeat）

| 层级 | 入口 | 说明 |
|---|---|---|
| Web 管理页 | `/agents` | Agent 卡片会显示心跳状态徽章（绿色/红色）。 |
| Agent 编辑 | `/agents` → 点击“配置” | 在表单底部可开启心跳、设置 cron 与心跳目标。 |
| 实现源码 | `apps/server/src/infra/heartbeatEngine.ts` | 基于 `node-cron` 的定时触发引擎，负责拉取启用心跳的 Agent 并启动运行。 |
| 实现源码 | `apps/server/src/services.ts` `AgentService` | Agent 创建/更新时持久化心跳配置；运行结果回写 `lastRunAt` / `lastRunStatus` / `consecutiveFailures`。 |
| 设计文档 | `docs/development/swarm-architecture.md` | Swarm 三层 Agent 与心跳的架构设计。 |

### 心跳状态含义
- **绿色“心跳”**：最近一次执行成功。
- **红色“心跳失败×N”**：连续 N 次执行失败，需要检查 Agent Prompt / 工具权限 / 日志。
- **无徽章**：该 Agent 未启用心跳。

---

## 3. 异步后台任务队列

| 层级 | 入口 | 说明 |
|---|---|---|
| Web 管理页 | `/runs` | 所有异步任务的运行记录与状态。 |
| Web 管理页 | Chat 左栏“子代理” | 当前会话派生的子代理任务实时状态。 |
| 实现源码 | `apps/server/src/infra/asyncJobManager.ts` | 异步任务生命周期、重试、取消、结果投递。 |
| 设计文档 | `docs/development/async-task-queue-plan.md` | 异步任务队列设计。 |

---

## 4. 快速导航建议

- 想看“有哪些定时任务在跑”→ `/tasks` + `/runs`。
- 想看“Agent 是否按时自主运行”→ `/agents` 看心跳徽章，失败时进 `/runs` 看详情。
- 想看“代码在哪里”→ 本文件表格里的源码路径。
