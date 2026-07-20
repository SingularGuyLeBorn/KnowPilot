# 04 PR-4：投递对账 / 队列认领 / 池槽 / depth / 启动恢复（分支 `arch/async-delivery-queue`）

> 用法：连同 `00-执行约定.md` 一起粘贴给实现 agent。发现细节见体检报告 B1-B7 条。

## 任务

### B1（P1）reconciler 对失败轻量任务永不收敛的对账循环

现状：`asyncJobManager.ts` autoConsume 对 sleep/async_task_tool 失败「标 delivered=true 但不写气泡」（:354-360，注释自述为避免反复 notify）；reconciler Pass 1（:619-688）以 ChatMessage 气泡为唯一 ground truth → 这些行永远判孤儿 → 回滚 → renotify → 再标 delivered=true → 无限循环（每轮 SSE 推送+DB 写+warn），仅当前端手动消费才跳出。

设计契约：豁免判定收在 reconciler 单点——Pass 1 候选直接排除 `status=failed && sourceType ∈ (sleep, async_task_tool)`（或 autoConsume 跳过写气泡时落 `output.deliveryExempt=true` 台账，Pass 1 识别台账；二选一，倾向台账方案更通用）。不变量一句话：`delivered=true` 必须对应「气泡存在 ∨ 对账点可判定的豁免类别」。

### B2（P1）superior drain 崩溃窗口消息永久丢失

现状：drain 认领 = **物理删除** SessionQueueItem 且同事务把 AgentMessage 置 consumed（services.ts:2129-2159 的 consume + asyncJobManager.ts:271-286 的 runItem）；消息进子会话发生在之后的 `prepareAgentRun`——崩溃/抛错 → 行已删、账已 consumed、气泡未写；三条恢复路径（requeueOrphanedSuperiorDrains/reconcileAgentMessageLedger/drain catch）都覆盖不到。

设计契约：改**软认领**——SessionQueueItem 加 `claimedAt DateTime?` 列；consume 改为「条件写置 claimedAt」（不再删行）；ChatMessage 写入成功后才删行；启动恢复扫「claimedAt 超龄（如 120s）且未落地」项重置 claimedAt=null 重投。不变量：**队列项只能在内容已进 ChatMessage 之后消失**。schema 变更走 `prisma db push`，注意既有 consume 语义（success/claimed 双字段返回）与前端 `useChatQueueDrain` 的 claimed:false 分支保持兼容——对外行为不变，只改内部持久化时序。

### B3（P2）autoConsume 槽内等待

现状：drain 通道先 `hub.waitFor` 再 `runConsumeJob` 准入（槽外等，:258-262）；autoConsume 先获槽再 `await hub.waitFor(sessionId)`（槽内等，:441-444）——maxConcurrent=2 时消费任务可占住全局槽一半数分钟。

设计契约：autoConsume 与 drain 对齐——`waitFor` 移到 `runConsumeJob` 之前。不变量：池槽只覆盖「执行」，不覆盖「等待起流条件」。

### B4（P2）启动恢复时序竞态 + resume 分支非幂等

现状：`asyncJobManager.ts:942-983`——a) resume 分支条件写认领后把状态写回 `"queued"`，行仍匹配认领条件 `status in (running,queued)`：同进程二次调用 retryCount 再 +1、同 jobId 重复入池双跑（enqueue 对 jobId 不查重）；b) 动作 1 入池即返回、执行体并发跑，动作 2 `chatSession.updateMany running→paused` 可能把刚被 resume 执行体置 running 的子会话误判僵尸。

设计契约：a) resume 认领写中间态（`status:"resuming"`），认领条件排除之——条件写天然幂等；执行体入池后由池侧转 queued/running。b) 动作 2（僵尸会话 paused）移到动作 1（Task 恢复）之前执行，或对动作 2 加 `updatedAt < bootTime` 过滤（二选一，倾向前者，语义更直白）。

### B5（P2）depth 防循环名存实亡

现状：`swarmPermissionGuard.ts:167-176` 读 `args.depth`（LLM 可见入参）、`swarmBus.ts:87` `msg.depth ?? 1`——全仓无服务端自动递增点，LLM 不报/报 1 即绕过防循环。

设计契约：与 W16a taskRef 同手法——depth 移出 LLM 可见 zod schema（LLM 传了也无效），由服务端沿派生链物化：spawn/send 时取父链 depth+1（父链 depth 从会话/AgentMessage 记录取），落 AgentMessage/会话上下文；guard 只读服务端物化值。注意 `prepareAgentRun` busy 分支的 bus.send 当前不传 depth，物化后由写入点统一填。

### B6（P2）orchestrator.start() 同步抛错泄漏槽位计数

现状：`asyncJobOrchestrator.ts:397-442`——计数递增与 runningJobs 登记在 `spec.execute()` 调用之前；同步 throw 穿透 start→drain→enqueue 上抛，finally 不执行 → runningGlobal 永久 +1 直到重启。

设计契约：`Promise.resolve().then(() => spec.execute(signal))`（或 try 包调用点）把同步抛错归入 execute 失败路径（finally 必走）。加负向测试：execute 同步 throw → 计数平衡。

### B7（P2）SessionQueueItem 幂等/排序无 DB 唯一约束

现状：`services.ts:2016-2048`——superior 幂等（findFirst(agentMessageId) 后 create）与 maxOrder 赋值都是 check-then-insert；两条锁外并发路径（服务端 busy 分支 + 前端镜像 useSubagentMessageMirror）可双建行、撞 order。

设计契约：schema 加 `@@unique([sessionId, agentMessageId])`（agentMessageId 可空的行不受限，核对 Prisma 对 nullable unique 的语义——SQLite 中 NULL 不冲突，符合预期）；create 改 upsert 或捕获 P2002 走幂等返回。maxOrder 保持 check-then-insert 但把赋值挪进与 create 同一 `$transaction`（串行化后撞 order 消失），或接受短暂顺序失真并在文档注明（二选一，倾向事务）。

## 测试要求

- B1：负向断言——构造 failed 轻量 Task（delivered=true 无气泡）跑两轮 reconciler → 旧实现每轮回滚重投，新实现零动作；台账方案另测「豁免标记缺失时仍按孤儿处理」。
- B2：负向断言——runItem 注入失败（mock prepareAgentRun 抛错）→ 旧实现行消失消息丢失，新实现 item 保留（claimedAt 置位）且恢复扫描后可重投；正常路径 consume→落地→删行时序测试。
- B3：构造 hub 长占用 → 断言 consume 不持槽等待（池占用计数为 0）。
- B4：同进程二次调用恢复 resume 分支 → retryCount 只 +1、单执行体；动作顺序测试（先 paused 后 resume 的不被误伤）。
- B5：负向断言——LLM 显式传 depth:1 的深层派生 → guard 按服务端物化 depth 拦截。
- B6：execute 同步 throw → runningGlobal 归零。
- B7：并发双写同 (sessionId, agentMessageId) → 单行；既有 superiorQueueDrain.test.ts 不回归。
- 跑：`pnpm --filter @knowpilot/server test` 全绿；`pnpm lint`。

## 验收清单

- [ ] 7 个发现各有负向测试 + 修复 commit
- [ ] schema 变更（claimedAt、unique 约束）db push + 既有数据兼容（一次性脚本或不需迁移，说明理由）
- [ ] depth 从 LLM schema 移除后全仓调用方（工具描述、权限清单、UI）同步清理
- [ ] lint + server test 全绿，合并入 master；体检报告对应行标注；AGENTS.md 更新

## 红线

- 不改变投递对外语义（delivered/consumed 状态机、前端 ack 协议、右栏分组展示）。
- redisSwarmBus 只做同步对齐修改，不验证 redis 模式（Phase 4 未启用）。
- 不动 v8 池的容量不变量数值语义（maxGlobal/maxPerSession/maxPerWorkspace 判定顺序不变）。
