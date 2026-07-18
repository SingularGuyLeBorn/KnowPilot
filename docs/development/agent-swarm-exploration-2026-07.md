# Agent / Swarm 探索分支说明（2026-07）

分支：`feat/agent-swarm-exploration`

## 本分支落地

1. **ask_user HITL**：Chat 弹框 + AgentMail 邮件；`awaiting_human` 挂起；提醒（10min / 每小时）；通知通道 `agentmail` / `smtp` / `ntfy`。
2. **AskUserRequest 持久化**：pending 落 SQLite；启动 `hydrateAskUserGateFromDb`；无 waiter 时答复入会话 `user` 队列（孤儿投递）。
3. **Swarm 可观测**：`agent.swarmHealth` / `agent.swarmAlerts`；`/agents` 告警横幅 + 编辑页面板；Chat「运行」页嵌入健康条（`hideWhenHealthy`）。
4. **`swarm_task_update` SSE**：Orchestrator 状态推父会话。
5. **`session.resume` 队列感知**：
   - 队首 `superior` → `enqueueSuperiorDrainForSession`，不注入「继续任务」并行流；
   - 队首孤儿 `ask_user` 答复 → `claimHeadAskUserOrphan` 以 user 源起流；
   - 仍有 pending → 「勿重复 ask_user」引导；否则默认续跑文案。
6. **通知通道熔断**：ntfy / agentmail / smtp 各通道独立 CircuitBreaker（3 次失败 / 5min 冷却）。

## 验证

```bash
pnpm --filter @knowpilot/server exec vitest run \
  src/__tests__/askUserGate.test.ts \
  src/__tests__/sessionResume.test.ts \
  src/__tests__/swarmHealth.test.ts \
  src/__tests__/emailNotifierChannels.test.ts
pnpm --filter @knowpilot/web exec vitest run components/__tests__/swarmAlertsBanner.test.tsx
pnpm --filter @knowpilot/server exec tsc --noEmit
```

## 可续方向

- Chat 右栏旁路复盘旁增加 inbox 明细抽屉
- superior drain 与 ask_user 孤儿交错的统一队列调度器
- 通知熔断状态暴露到 `agent.swarmAlerts`
