# Agent / Swarm 探索分支说明（2026-07）

分支：`feat/agent-swarm-exploration`

## 本分支落地

1. **ask_user HITL**：Chat 弹框 + AgentMail 邮件；`awaiting_human` 挂起；提醒（10min / 每小时）；通知通道 `agentmail` / `smtp` / `ntfy`。
2. **AskUserRequest 持久化**：pending 落 SQLite；启动 `hydrateAskUserGateFromDb`；无 waiter 时答复入会话 `user` 队列（孤儿投递）。
3. **`agent_inspect(includeSwarm=true)`** + **`agent.swarmHealth` / `agent.swarmAlerts` tRPC**：单 Agent 快照 + 全仓轻量告警。
4. **`/agents` Swarm 可观测**：列表顶栏 `SwarmAlertsBanner`；编辑页 `SwarmHealthPanel`（链到待答复会话）。
5. **`swarm_task_update` SSE**：Orchestrator 状态推父会话。
6. **`session.resume` 对齐 ask_user**：
   - 队首有孤儿答复（`kind=user` + `source=ask_user`）→ 优先 `claimHeadAskUserOrphan` 并以 user 源起流；
   - 仍有 pending → 注入「勿重复 ask_user」引导；
   - 否则默认「服务已重启，请继续…」。

## 验证

```bash
pnpm --filter @knowpilot/server exec prisma db push
pnpm --filter @knowpilot/server exec vitest run src/__tests__/askUserGate.test.ts src/__tests__/sessionResume.test.ts src/__tests__/swarmHealth.test.ts
pnpm --filter @knowpilot/web exec vitest run components/__tests__/swarmAlertsBanner.test.tsx
pnpm --filter @knowpilot/server exec tsc --noEmit
```

## 可续方向

- ntfy / 邮件通道的配额与熔断
- resume 遇队首 `superior` 时先挂 superior drain 再处理 ask_user
- Chat 右栏嵌入同款 Swarm 健康条（按当前会话 agentId）
