# Agent / Swarm 探索分支说明（2026-07）

分支：`feat/agent-swarm-exploration`

## 本分支落地

1. **ask_user HITL**：Chat 弹框 + AgentMail 邮件；`awaiting_human` 挂起；提醒（10min / 每小时）；通知通道 `agentmail` / `smtp` / `ntfy`。
2. **AskUserRequest 持久化**：pending 落 SQLite；启动 `hydrateAskUserGateFromDb`；无 waiter 时答复入会话 `user` 队列（孤儿投递）。
3. **`agent_inspect(includeSwarm=true)`**：inbox 积压、会话运行态、ask_user pending、心跳熔断、superior 队列（`swarmHealth.ts`）。
4. **`swarm_task_update` SSE**：Orchestrator 在 duplicate / queued / running / completed / failed 时推父会话，前端 invalidate 任务列表。

## 验证

```bash
pnpm --filter @knowpilot/server exec prisma db push
pnpm --filter @knowpilot/server test
pnpm --filter @knowpilot/shared exec tsc --noEmit
pnpm --filter @knowpilot/server exec tsc --noEmit
```

## 可续方向

- paused 会话 `resume` 时自动认领未完成 ask_user（与 Run 账本对齐）
- `/agents` 页可视化 Swarm 健康快照
- ntfy / 邮件通道的配额与熔断
