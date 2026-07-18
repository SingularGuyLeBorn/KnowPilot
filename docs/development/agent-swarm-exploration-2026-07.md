# Agent / Swarm 探索分支说明（2026-07）

分支：`feat/agent-swarm-exploration`

## 本分支落地

1. **ask_user HITL**：Chat 弹框 + AgentMail 邮件；`awaiting_human` 挂起；提醒（10min / 每小时）；通知通道 `agentmail` / `smtp` / `ntfy`。
2. **AskUserRequest 持久化**：pending 落 SQLite；启动 `hydrateAskUserGateFromDb`；无 waiter 时答复入会话 `user` 队列（孤儿投递）。
3. **`agent_inspect(includeSwarm=true)`** + **`agent.swarmHealth` tRPC**：inbox / 会话态 / ask_user / 心跳 / superior 队列。
4. **`swarm_task_update` SSE**：Orchestrator 状态推父会话。
5. **`session.resume` 对齐 ask_user**：有 pending 时注入「勿重复 ask_user」引导文案，而非盲目「继续任务」。

## 验证

```bash
pnpm --filter @knowpilot/server exec prisma db push
pnpm --filter @knowpilot/server exec vitest run src/__tests__/askUserGate.test.ts src/__tests__/sessionResume.test.ts
pnpm --filter @knowpilot/server exec tsc --noEmit
```

## 可续方向

- `/agents` 页消费 `agent.swarmHealth` 做可视化看板
- ntfy / 邮件通道的配额与熔断
- resume 后若用户已答复（孤儿队列已有项）优先 drain 再起流
