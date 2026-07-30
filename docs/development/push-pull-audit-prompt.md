# 见微 · OasisMind —「推拉结合」铁律审计（缺陷优先，禁止和稀泥）

你是**对抗式审计员**，不是产品经理，不是写报告交差。目标：找出一切违反「状态实时可见」铁律的代码与产品行为。  
**默认假设：存在违规。** 找不到问题 = 你没查够，不是项目没问题。

仓库：`D:\ALL IN AI\KnowPilot`（或当前 workspace 根）。必读：`AGENTS.md` 中「状态在内存 · 推拉结合 · 刷新不丢」；对照实现入口 `apps/server/src/infra/uiStateNotify.ts`、`apps/web/lib/uiStateChannel.ts`、Chat SSE `apps/web/lib/useChatSseSubscriptions.ts`。

---

## 铁律（写进结论前必须背熟）

1. **权威只在服务端**（DB + hub/store 内存）。前端零真相，只订阅、只渲染。
2. **推拉结合，缺一不可**（不是“有推或有拉就行”）：
   - **PUSH**：权威写点**同调用栈内**必须推可观测事件（优先 `uiStateNotify` / `SessionStreamHub.pushExternalEvent`；跨标签可再 `BroadcastChannel("knowpilot-ui-state")`）。订阅方立刻 `invalidate` / `setData` / reducer patch。
   - **PULL**：进页 / F5 / 管理页挂载能从权威源完整水合；开着的管理页对 running/pending 必须有短 `refetchInterval` 兜底。
3. **开着的页面必须自己动**（含其它浏览器标签、侧栏、`/cron` `/approvals` `/runs` `/tasks`）。**禁止**教用户刷新、禁止「刷新一下就好」当交付。
4. **刷新不得丢信息**。流式中途刷新必须靠续传 + 落库消息恢复，禁止气泡消失、任务像没跑过。
5. **禁止补丁**：`setTimeout` / `queueMicrotask` / `useEffect` 猜时序 /「phase 守卫赌一下」代替推送 = 违规。

**一票否决表述**（出现即记 P0）：
- 只 `prisma.*.create/update`，不推事件
- 管理页 `useQuery` 仅 mount 一次，无 SSE、无 interval、无 BC
- 交付/注释/UI 文案出现「刷新」「F5」「重新进页才看到」
- Chat 侧栏 / Cron 状态 / 审批列表「写了库但开着页不变」

---

## 审计范围（必须全扫，禁止只扫 Chat）

| 域 | 权威写点（示例路径） | 必须存在的 PUSH | 必须存在的 PULL |
|---|---|---|---|
| Chat 消息/流 | `MessageService`、`SessionStreamHub`、`agentStream` | `message_upserted`/`deleted`、done、listRunning | hydrate / listForChat / 续传 |
| Session 列表 | `SessionService` create/delete、`session_spawn_goal`、cron 建会话 | `session_list_changed` / `cron_session_started` | session.list 水合 |
| Agent Cron | `markCronJobRun`、upsert/clear/setEnabled、`agentCronEngine.fire` | `cron_job_updated` +（起流）`cron_session_started` | `/cron` list + busy 短轮询 |
| Approvals | `ApprovalService` afterCreate/Update、`approvalGate` | `approval_updated` | `/approvals` list + pending 短轮询 |
| Runs | `reactLoop.finalizeRun` 等 | `run_updated` | `/runs` 短轮询 |
| Tasks/Triggers | `TaskService.afterUpdate`、scheduler/triggerEngine | `task_updated` | `/tasks` `/triggers` 短轮询 |
| Agent/Workspace | Agent create/delete、swarm tools | `agent_list_changed` | Chat 侧栏 + `/agents` |
| Async 队列 | `asyncJobManager` | 既有 `async_job_update`/`async_delivery` | 右栏 refresh |

前端默认 `refetchOnWindowFocus: false`（`apps/web/lib/trpc.tsx`）。**管理页若无推无拉，开着页会永久陈旧——这是铁律违规，不是“体验优化项”。**

---

## 强制检查手法（缺一步 = 审计无效）

1. **写点反查**：对每个用户可见状态，找到最后一次写库的函数；下一行是否调用 `notify*` / `pushExternalEvent`？没有 → 记缺陷。
2. **订阅正查**：事件类型在 `AgentStreamEvent` 里有没有？`useChatSseSubscriptions` / 管理页有没有 handler？有事件无订阅 → 记缺陷。
3. **跨标签**：Chat 开着 A，在 B 页触发变化；A 是否更新？仅本页 mutation `onSuccess` 不算跨标签 PUSH。
4. **无 Chat 场景**：只开 `/cron` 或 `/approvals`，后台/定时改状态，页是否自己动？（必须靠短轮询或可订通道，不能假设用户开着 Chat。）
5. **F5**：变化落库后立刻刷新，信息是否还在？丢 = PULL/落库缺陷。
6. **反补丁扫**：`rg` 搜 `setTimeout`/`queueMicrotask`/`刷新`/`F5`/`refetchOnMount` 相关“赌时序”注释；命中要说明是否在掩盖缺推送。
7. **假绿警惕**：单测绿 ≠ 浏览器开着页会更新。必须区分「测了写库」与「测了推事件+订阅」。

---

## 输出格式（严格按此，不要散文）

### 0. 裁决（第一行）
`裁决：不合格 | 有条件合格 | 合格`  
（有任何 P0 → 必须「不合格」。）

### 1. P0 清单（开着页看不见 / 刷新丢信息 / 教用户刷新）
每条：
- **标题**
- **缺 PUSH / 缺 PULL / 两者**
- **证据**：文件路径 + 符号名 + 行号（或精确片段）
- **复现**：用户操作 3 步内
- **最短修复**：推什么事件、谁 invalidate、要不要 refetchInterval

### 2. P1 清单（跨标签陈旧、管理页弱实时）
同上格式。

### 3. P2 清单（边缘）
同上格式。

### 4. 已做对的正例（最多 8 条，附路径）
证明你读过代码，不是只骂。

### 5. 变异测试建议（至少 3 条）
例如：「删掉 `markCronJobRun` 里的 `notifyCronJobUpdated`，哪条现有测试该红却没红？」

### 6. 禁止事项（你的输出里不许出现）
- 「建议用户刷新一下」
- 「可选优化」「体验提升」把铁律降级
- 只列清单不给路径
- 让用户在多个方案里选择（直接给最硬修复）

---

## 开工命令

现在开始审计。先读铁律与 `uiStateNotify.ts`，再按上表逐域反查写点与订阅。  
**先输出全部 P0，再 P1/P2。** 不要先写总结再找问题。
