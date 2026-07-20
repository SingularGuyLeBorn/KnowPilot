# 06 PR-6：Web Chat store 不变量（分支 `arch/chat-web-store`）

> 用法：连同 `00-执行约定.md` 一起粘贴给实现 agent。发现细节见体检报告 E1-E6 条。**E3 依赖 PR-5 的服务端契约（stopAgentChat 响应携带 `partialAssistantMessageId | null`）——按同一契约开发，PR-5 合并后本 PR 联调合并。**

## 任务

### E1（P1）ACK 瞬态失败 → 异步结果永久丢失

现状：`apps/web/lib/useChatQueueDrain.ts:107-122`——`markDeliveryConsumed(sid, jobId)` 在 ACK 请求**之前**乐观标记，ACK 失败 catch 只释放 drain 锁不回滚标记；标记持久化到 localStorage 且无 unmark 路径 → 服务端 reconciler 重投后 UI 依然 skip，任务结果永不进对话。

设计契约：`claimed:true` 之后才 `markDeliveryConsumed`（queueDraining 锁已保证无并发 drain，提前标记无保护作用）；如仍有防御需要，新增 `unmarkDeliveryConsumed` action 在未 claimed 且服务端未消费时回滚。自检：删掉 catch 分支，瞬态断网后结果仍能投递。

### E2（P1）INV-1 收进 reducer：COMMIT_STREAM 相位守卫

现状：`useStreamLifecycle.ts:248-262,511-525`——COMMIT_STREAM 对任意 phase 照单全收；`commitStream()` 公共 API 显式放行 streaming→idle 直跳（`useChatRunStream.ts:591-593` finally「强制 commit」正是这么绕过 INV-1 的）；COMPLETE_STREAM/FAIL_STREAM 无相位守卫（idle 态收到 stale done 也置 done）。

设计契约：reducer 拒绝 `phase==="streaming"` 的 COMMIT_STREAM（dev 期 `console.error`，生产 no-op）；COMPLETE/FAIL 同样加相位合法性表（明确各 action 的合法源相位集，写进 reducer 注释）；「流式中道崩殂需释放占用」建模为显式 **ABORT_STREAM** action（自带 leftover 处置与 optimistic 清理语义），调用方全部改用 ABORT_STREAM，非法转移从此无合法 action 可表达。与 E3 联动：abort 流程统一走 ABORT_STREAM。

### E3（P1）abort 后 2s setTimeout 兜底消除

现状：`useChatRunStream.ts:566-573`——abort 路径等 partial assistant 对齐 commit，「服务端可能无 partial」用 `setTimeout(2000)` 赌：partial 落库慢于 2s → 强制 commit 拆块后迟到 upsert 再出现（闪烁回归）；trim 比较不符 → 对齐永不发生。

设计契约：协议显式化——`stopAgentChat` 响应（PR-5 契约）携带 `partialAssistantMessageId | null`；reducer 增加 **abort-pending** 语义：有 id → 等该 messageId 的 upsert 对齐后 commit（无超时兜底）；明确无 partial → 立即 commit。**计时器删除后行为不变才算根治**——验收必须包含「断网慢于 2s 落库」的无计时器验证。

### E4（P2）悬停/预取不置 drainRequested

现状：`useSessionMessages.ts:164-168,521-530`——`prefetchSessionMessages`（悬停预热/tab 预取，只读意图）走同一 hydrate dispatch → 无条件置 drainRequested → `drainAllPendingQueues` 可能把后台会话 compose 队列里的消息发出去（鼠标悬停即发消息）。

设计契约：hydrate action 增加 `source: "view" | "prefetch"`（或独立 PREFETCH_DONE action），prefetch 路径不置 drainRequested；INV-8 ④ 的合法 drain 源在类型层面枚举（union type），新增调用方编译期可审。

### E5（P2）hydrate 合并新鲜度粒度细化

现状：`useSessionMessages.ts:73-90`——hydrate 对 same-id 消息一律以 incoming（tRPC 快照）为准，唯一保护是「整列 id 序列相同则跳过」——快照旧但 id 集合不同会回写旧内容（SSE upsert 的 v2 被 hydrate 的 v1 覆盖）。

设计契约：hydrate 对 same-id 消息复用 upsert reducer 的逐字段 compare-skip（或按 updatedAt/版本号取新），「整列 id 相等跳过」仅作快路径。不变量：后到达者幂等取新，不覆盖更新内容。

### E6（P2）queueHydrate sessionChanged 全量替换抹本地项

现状：`chat.tsx:516-522` / `chatSessionPane.tsx:201-207`——sessionChanged 分支 `setUserQueue(DB 行全量)` 不保留无 dbId 本地项（enqueue 持久化失败的本地兜底、NEW_STREAM_KEY 迁移后 dbId 回填完成前的窗口），时序命中即抹掉迁移来的排队项 → dbId 补写丢失、消息滞留。

设计契约：全量替换也走 `mergeUserQueueFromDb`（「DB 行 + local-only 保留」单一合并入口），替换语义与 merge 语义不再两套代码路径。

## 测试要求

- E1：负向断言——ACK reject 后 → 标记未持久化，下次 merge 后 delivery 重新出现并可再 claim。
- E2：负向断言——streaming 相位 dispatch COMMIT_STREAM → 状态不变 + dev 报错；ABORT_STREAM 后占用释放、leftover 处置正确；旧「强制 commit」调用点全部改走 ABORT_STREAM。
- E3：负向断言（无计时器）——partial id 对齐 commit；null id 立即 commit；慢于 2s 的迟到 upsert 场景气泡不闪断。
- E4：prefetch hydrate 后不触发 drain（spy drainAllPendingQueues）；view hydrate 正常触发。
- E5：构造「hydrate 快照旧、SSE 已 upsert 新」→ 断言新内容不被回写。
- E6：构造「sessionChanged 快照先于 dbId 回填」→ 本地项保留、回填 patch 找得到项。
- 既有 `chatSidebarRender.test.tsx`、`localAbortedAssistant.test.ts`、`streamLifecycleWatchdog.test.ts`、`messageUpsertMerge.test.ts` 等不回归（注意这些在 feat/chat-kimi-composer 工作区是 WIP——master 上以 `apps/web/lib/__tests__/`、`components/__tests__/` 现有文件为准）。
- 跑：`pnpm --filter @knowpilot/web test` 全绿；`pnpm lint`（web eslint）全绿。

## 验收清单

- [ ] 6 个发现各有负向测试 + 修复 commit
- [ ] useChatRunStream.ts 无 setTimeout 兜底（全仓 grep `setTimeout` 于 chat 流式编排区清零）
- [ ] 与 PR-5 契约联调通过（abort 慢落库场景）
- [ ] lint + web test 全绿，合并入 master；体检报告对应行标注；AGENTS.md 更新

## 红线

- 不改三层 store 的职责划分（MS/Lifecycle/Compose 边界不动）与 INV-2/3/4/8 既有语义。
- chat.tsx 编排簇只动本工单列出的点，不顺手重构。
- 不引入新状态管理库（Zustand 未启用是有意的）。
