# Agent / Swarm 探索分支说明（2026-07）

分支：`feat/agent-swarm-exploration`

## 本分支落地

1. **ask_user HITL**：Chat 弹框 + AgentMail；`awaiting_human`；提醒；`agentmail` / `smtp` / `ntfy`。
2. **AskUserRequest 持久化** + 孤儿答复入队；`session.resume` 队列感知（superior drain / 孤儿答复 / pending 引导）。
3. **Swarm 可观测**：`agent.swarmHealth` / `agent.swarmAlerts`（含通知熔断）；`/agents` 看板；Chat「运行」页健康条 + inbox 预览。
4. **`swarm_brief` native 工具**：manager/super 生成作战简报 markdown，派活前先看积压。
5. **通知通道熔断**：每通道 CircuitBreaker，状态并入 `swarmAlerts`。
6. **`swarm_task_update` SSE** + `agent_inspect(includeSwarm)`。

## 验证

```bash
pnpm --filter @knowpilot/server exec vitest run \
  src/__tests__/swarmHealth.test.ts \
  src/__tests__/emailNotifierChannels.test.ts \
  src/__tests__/sessionResume.test.ts
pnpm --filter @knowpilot/web exec vitest run components/__tests__/swarmAlertsBanner.test.tsx
pnpm --filter @knowpilot/shared exec tsc --noEmit
pnpm --filter @knowpilot/server exec tsc --noEmit
```

## 可续方向

- superior / ask_user 交错的统一队列调度器
- `swarm_brief` 心跳自动巡检（写入 daily memory）
- Dashboard 嵌入全仓 Swarm 告警条
