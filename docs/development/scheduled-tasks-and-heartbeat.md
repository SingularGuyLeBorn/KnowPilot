# 定时任务与 Agent 心跳

> 两套机制都叫「定期跑一点东西」，但职责不同。配置入口也不同。

---

## 一句话区分

| | **Task（/tasks）** | **Heartbeat（Agent 心跳）** |
|---|---|---|
| 是什么 | 系统级后台脚本作业 | **某个 Agent** 按 cron 自主唤醒跑一轮 |
| 配置入口 | `/tasks` | `/agents` → 选 Agent → 配置 →「心跳」 |
| 谁执行 | TaskScheduler（脚本 / 命令） | HeartbeatEngine → SwarmOrchestrator → Agent ReAct |
| 会话 | 无对话会话 | 专用 `ChatSession.kind = "heartbeat"`，与主会话隔离 |
| 典型用途 | DB 备份、健康检查、增量同步 | 超级 Agent 巡检 Workspace、下发待办 |

---

## Agent 心跳：增删改查

### 查

1. 打开 **`/agents`**
2. 卡片上若已开启心跳，会显示：
   - 频率（如「每天 9:00」+ cron）
   - 目标摘要
   - 上次运行时间 / 状态
   - 连续失败或熔断暂停标记
3. 运行痕迹还可在 **`/runs`** 查看（心跳 Run 的 `runOrigin` / input 会标记 heartbeat）

### 增 / 改

1. `/agents` →「配置」
2. 打开「心跳（定时自主运行）」开关
3. 设置：
   - **触发频率**：预设（每天 9:00 / 0:00、每 6/12 小时、每周一 9:00、每 30 分钟）或自定义 cron
   - **心跳目标**：每次触发时注入给 Agent 的任务文案
4. 保存

保存时会保留 `lastRunAt` / `lastRunStatus` / `consecutiveFailures`（不会因改配置而清零运行史）。  
若修改了 `enabled` / `cron` / `goal` / `heartbeatModel`，引擎会清除该 Agent 的熔断暂停（`heartbeatSuspendedAt`），以便新配置立即生效。

### 删（关闭）

关掉心跳开关并保存即可。配置 JSON 仍挂在 Agent 上，只是不再调度。

### 数据落在哪

- DB：`Agent.heartbeat`（JSON：`enabled/cron/goal/lastRunAt/lastRunStatus/consecutiveFailures/loopContract?`）
- DB：`Agent.heartbeatSuspendedAt`（连续失败熔断暂停时刻；`null` = 未暂停）
- 可选：`Agent.heartbeatModel`（心跳用便宜模型；空则用 Agent 默认 model）
- Markdown 源：`content/agents/*.md` frontmatter 的 `heartbeat:` 段（`db:sync` 双向）
- 超级 Agent 默认模板：`content/agents/_templates/super.md`

---

## 引擎行为（实现要点）

模块：`apps/server/src/infra/heartbeatEngine.ts`

1. 按各 Agent 的 `heartbeat.cron` 注册 node-cron
2. 触发时找到或创建该 Agent 的 `kind=heartbeat` 会话
3. 注入 goal 作为本轮任务，经 SwarmOrchestrator（`origin: "heartbeat"`）入池执行
4. 回写 `lastRunAt` / `lastRunStatus` / `consecutiveFailures`
5. 连续失败达阈值 → 写 `heartbeatSuspendedAt` 并摘除 cron（邮件告警，视 `EMAIL_PROVIDER`）
6. 配置变更或指标好转后可个体恢复（不随全局 `refresh()` 连坐复活）

Loop Contract（控制平面：`gateOpen` / `handoff` / evidence）挂在 `heartbeat.loopContract`；API：

- `agent.getLoopContract`
- `agent.resumeLoopContract`
- `agent.closeLoopGate`

管理页目前以开关 + cron + goal 为主；Loop Contract 的完整可视化控制台可后续补。

---

## Task（系统定时任务）

入口：**`/tasks`**

- 配置周期性脚本（备份、健康检查等）
- 与 Agent 对话 / 心跳无关
- 运行记录同样可对照 `/runs`（视 Task 实现是否落 Run）

Trigger（**`/triggers`**）是第三类：事件驱动，不是 cron 心跳。

---

## 推荐工作流

1. 超级 Agent：在 `/agents` 打开心跳，goal 写清「巡检 / 整理待办 / 下发管理 Agent」
2. 日常看卡片上的「上次运行」；异常看红色失败或「已熔断暂停」
3. 系统备份类作业放 `/tasks`，不要塞进 Agent 心跳
4. 需要人工停心跳：关开关保存；需要只停触发门控：调 `closeLoopGate`（API）

---

## 相关文件

| 路径 | 说明 |
|---|---|
| `apps/web/app/agents/page.tsx` | 心跳 UI（列表摘要 + 编辑表单） |
| `apps/server/src/infra/heartbeatEngine.ts` | 调度与熔断 |
| `packages/shared/src/schemas.ts` | `heartbeatConfigSchema` |
| `content/agents/_templates/super.md` | 超级 Agent 默认心跳 |
| `apps/web/app/tasks/page.tsx` | 系统 Task 管理 |
| `config.yaml` → `heartbeat.loopContract` | 全局 Loop Contract 默认 |

最后更新：2026-07-18
