# KnowPilot 架构深度体检报告（2026-07-20）

> 基线：`master @ f866c89b`。方法：按 5 个集群并行深检（Loop/Stream/Session 内核、Async/Swarm 调度、Heartbeat/Trigger/Approval/Budget、API/数据层/同步、Web Chat 状态层）。
> 判定纪律：与 AGENTS.md「禁止打补丁」「不变量收进 store/reducer/转移点」对齐——凡靠编排层时序猜测（`setTimeout`/`queueMicrotask`/`await 重新拉取赌落库`/散布的 phase 守卫）维持的正确性，均记为缺陷。
> 严重级：**P0** = 数据丢失/不可恢复错乱；**P1** = 常规操作可触发的错误持久状态/静默丢消息/永久卡死；**P2** = 窄窗口竞态或扩展摩擦；**P3** = 登记备查。

## 发现总览

| ID | 级 | 标题 | 位置 | 修复 PR |
|---|---|---|---|---|
| D1 | P0 | 实体双写顺序倒置无补偿：写文件失败 → 下次 sync 硬删实体 | services.ts:268-331,400-469 | PR-1 |
| D2 | P0 | Windows 下 sync-posts `.trash` 过滤永不命中：回收站文章以新 slug 复活并公开 | sync-posts.ts:25,112 | PR-1 |
| A1 | P1 | 合成轮吞掉 AbortError：用户点停止被写成 success 并落库假兜底文案 | reactLoop.ts:619-674 | PR-5 |
| A2 | P1 | SSE 事件 id 双命名空间：断线续传重放错乱 + 重放后 synthetic done 双发 | sessionStreamHub.ts:103-115,540-556; agentStream.ts:1045-1112 | PR-5 |
| A3 | P1 | autoCompact 双写无串行化/CAS：contextSummary 与边界消息可分裂，静默丢上下文视野 | autoCompact.ts:450-517; router.ts:676-698 | PR-5 |
| A4 | P1 | POST 起流返回值被忽略 + 占位 sessionId 共享键 `""`：新消息静默丢失、两新聊天串流 | agentStream.ts:963-1010 | PR-5 |
| A5 | P1 | steer/follow_up 注入队列随 RunState 销毁：UI 承诺「已注入」服务端静默丢弃 | sessionStreamHub.ts:315-467; reactLoop.ts:381,605 | PR-5 |
| B1 | P1 | reconciler 对「失败轻量任务」形成永不收敛的对账循环 | asyncJobManager.ts:354-360↔619-688 | PR-4 |
| B2 | P1 | superior drain「删除即认领」+ 同事务置 consumed：崩溃窗口消息永久丢失 | services.ts:2129-2159; asyncJobManager.ts:271-286 | PR-4 |
| C1 | P1 | 僵尸 running Task 永久卡死心跳与定时任务（恢复扫描只认 `[async]` 前缀） | asyncJobManager.ts:930-935; heartbeatEngine.ts:331-375; taskScheduler.ts:56-59; triggerEngine.ts:142-148 | PR-3 |
| C2 | P1 | HeartbeatEngine.refresh() 无串行化：并发 refresh 泄漏 cron job 重复调度 | heartbeatEngine.ts:158-207 | PR-3 |
| C3 | P1 | 审批等待注册表 missed-wakeup + TTL 误报「已过期」（操作实际已执行） | approvalGate.ts:160-233,284-308 | PR-2 |
| D3 | P1 | 实体文件写回零路径消毒：name/slug 直接进 path.join 可穿越出 content | services.ts:382-398,948,1292,2636 | PR-1 |
| D4 | P1 | sync 与运行时 CRUD 并发无保护：rename 窗口期 watch unlink 可硬删刚改名实体 | sync.ts:122-195; services.ts:408-415 | PR-1 |
| D5 | P1 | FTS 三条漂移通道（watch 不碰 FTS / rebuild 不过滤墓碑 / 增量只覆盖 4/8 实体） | sync.ts:122-186; ftsIndex.ts:51-102 | PR-1 |
| D6 | P1 | destructive 两份清单漂移：`agent_delete_sub` 删除操作绕过审批 | approvalGate.ts:48-65 vs native/swarm.ts:1476 | PR-2 |
| E1 | P1 | ACK 瞬态失败 → 异步结果永久丢失（consumedDeliveries 持久化无 unmark） | useChatQueueDrain.ts:107-122 | PR-6 |
| E2 | P1 | INV-1 不在 reducer：COMMIT_STREAM 接受 streaming→idle 直跳 | useStreamLifecycle.ts:248-262,511-525 | PR-6 |
| E3 | P1 | abort 后 2s setTimeout 兜底（时序猜测补丁，partial 对齐靠赌） | useChatRunStream.ts:566-573 | PR-6（+PR-5 服务端契约） |
| A6 | P2 | 审批/ask_user 两 gate 挂起-唤醒-中止语义不一致 | approvalGate.ts:160-232 | PR-2（随 C3） |
| A7 | P2 | stream/sync 两链路行为分叉：reflection 拦不住已流出拒稿；sync abort 不留部分稿 | reflection.ts:138-150; agentStream.ts:870-898; agentRuntime.ts:252-258 | 登记 |
| A8 | P2 | 扁平存储重建：注入消息时序失真 + inject 落库失败幻影消息 | chatHistory.ts:144-215; reactLoop.ts:161-187 | 登记 |
| B3 | P2 | autoConsume 在池槽位内等 hub 空闲：消费任务把全局 LLM 槽变停车场 | asyncJobManager.ts:441-444 vs 258-262 | PR-4 |
| B4 | P2 | runStartupRecovery 时序竞态 + resume 分支非幂等（同 jobId 可双入池） | asyncJobManager.ts:942-983,810-813 | PR-4 |
| B5 | P2 | depth 防循环名存实亡：计数来源是 LLM 入参，服务端从不递增 | swarmPermissionGuard.ts:167-176; swarmBus.ts:87 | PR-4 |
| B6 | P2 | orchestrator.start() 对同步抛错的 execute 泄漏槽位计数 | asyncJobOrchestrator.ts:397-442 | PR-4 |
| B7 | P2 | SessionQueueItem 幂等/排序靠 check-then-insert，无 DB 唯一约束兜底 | services.ts:2016-2048; schema.prisma:159-175 | PR-4 |
| B8 | P3 | spawn 去重窗口与任务在途期脱节，窗口外重派无幂等承接 | swarmOrchestrator.ts:29,277-281 | 登记 |
| C4 | P2 | 心跳状态写回混合版本 read-modify-write：丢计数、吞「配置变更清零」 | heartbeatEngine.ts:622-657 | PR-3 |
| C5 | P2 | llmBudget 检查-扣费 TOCTOU + 重启 hydrate 竞态丢额度 | llmBudget.ts:43-62,121-142 | PR-2 |
| C6 | P2 | CircuitBreaker 半开期无探测纪元：陈旧成功误合闸、陈旧失败误重计时 | circuitBreaker.ts:123-153 | PR-2 |
| C7 | P2 | cron 触发与手动触发无原子认领：TaskService.run/TriggerEngine 可叠跑 | taskScheduler.ts:53-63; services.ts:2357; triggerEngine.ts:142-148 | PR-3 |
| C8 | P2 | config.yaml 无热更新且生效口径分裂（config 快照 vs env 活读并存） | config.ts:650-656; approvalGate.ts:72-78 等 | 登记 |
| D7 | P2 | safePath 纯词法校验：无符号链接/Junction 解析可逃逸 projectRoot | safePath.ts:9-17 | 登记 |
| D8 | P2 | memoryRepository.supersedeUpdate 两步写无事务；memoryService 缺省静默降级 | memoryRepository.ts:282-370 | PR-1 |
| E4 | P2 | 悬停/预取（只读意图）经 hydrate 无条件置 drainRequested：悬停即发消息 | useSessionMessages.ts:164-168,521-530 | PR-6 |
| E5 | P2 | hydrate 合并新鲜度粒度是「整列 id 序列」：stale 页面可覆盖 SSE 新内容 | useSessionMessages.ts:73-90 | PR-6 |
| E6 | P2 | queueHydrate 的 sessionChanged 全量替换会抹掉无 dbId 本地项 | chat.tsx:516-522; chatSessionPane.tsx:201-207 | PR-6 |
| E7 | P2 | useSubagentMessageMirror 用「消息内容撞名」判重：误吞上级指令 | useSubagentMessageMirror.ts:39-82 | 登记 |
| E8 | P2 | 会话配置双事实源 + mount-resume 吃首帧闭包 | chat.tsx:590,636-698; chatSessionPane.tsx:224 | 登记 |

---

## P0 详述

### D1：实体双写顺序倒置且无补偿（services.ts）

核心原则是「Markdown 是唯一事实源、SQLite 是缓存」，但 `BaseService.create/update/delete` 的双写顺序是 **DB 先行、文件后行**，与 sync 的删除语义（文件不存在 = 删除）方向相反：

- **create**：`delegate.create` 提交后才 `writeFile`。writeFileSync 抛错（Windows 非法文件名字符 `:` `?` `*`、磁盘满、权限）→ 接口返回失败但 DB 行已存在（如 Agent 行 `sourceSlug=null` 成幽灵行）。
- **update 改名**：`afterUpdate` **先 deleteFileBySlug（旧）再 writeFile（新）**（services.ts:408-415）。写新文件失败 → 新旧文件全没 → 下次 `db:sync` cleanup 发现 sourceSlug 不在磁盘 → Agent/Skill/Prompt/MCP **硬删**（sync-agents.ts:119 等四处），数据彻底丢失（Post 软删可恢复，其余实体不可）。
- **delete**：DB 先删，`deleteFileBySlug` 用 `try { unlinkSync } catch {}` 静默吞错（services.ts:463-469）→ Windows 文件被占用时 unlink 常失败 → 残留文件在下次 sync 被 upsert **复活为新 id 实体**，原会话/引用全部断裂。

**修法方向**：不变量改为「文件先成为事实，DB 后投影」——create/update 先写文件（先写新文件成功后再删旧文件），文件写失败不动 DB；delete 先删文件（或移 `.trash`），删不掉就报错不删 DB；`deleteFileBySlug` 禁止静默吞错。

### D2：Windows 下 `.trash` 过滤永不命中（sync-posts.ts）

过滤条件 `p.includes(`${contentDir}/.trash/`)` 用**正斜杠**模板，而 `getFilesRecursive`（path.join）与 `getContentDir`（path.resolve）在 Windows 产出**反斜杠**路径，`includes` 永远为 false。后果：`content\posts\.trash\foo.md` 被正常扫描，slug=`.trash/foo`，upsert 按 slug 唯一键**创建新 Post 行**——UI 删进回收站的已发布文章在下次 `db:sync` 后以新 slug 重新公开。本项目开发环境就是 Windows，**live bug**。

**修法方向**：路径比较前统一 `replace(/\\/g,"/")` 归一化；更好是把「跳过 `.trash`/`.`/`_` 开头目录」收进 `getFilesRecursive` 的 ignoreDirs 一层（与 `_templates` 同款机制）。

---

## P1 详述（按主题）

### 流式内核（PR-5）

**A1 合成轮吞 AbortError**：maxRounds 耗尽或预算触发进 `synthesizing` 后，合成 `transport.complete` 抛出的 AbortError 被 `catch{}`（reactLoop.ts:652-654）整体吞掉 → 落兜底文案 → `finalizeRun("success")`。用户点「停止」被写成 success 且把从未真正得到的兜底文案落库为 assistant 消息。**修法**：终态不变量收进内核——「run 只有在非 aborted 时才允许以 success 收口」由 finalizeRun/synthesizing 入口强制（aborted 唯一合法终态 cancelled）；合成轮 catch 用 `isAbortLikeError` 重抛。

**A2 SSE 事件 id 双命名空间**：内存 `nextId = maxEventIdFor(sessionId)+1`（per-session），而 `SessionStreamEvent.id` 是**全表全局自增**。前端 lastEventId 是内存命名空间，重连 GET `resumeAfter` 打 SQLite 重放比对的是 DB 命名空间 → 服务重启后已见事件整段重放/混入残留。叠加：token 合帧 `writeSse` 不带 id（lastEventId 不前进，重连后 token 尾巴必重复）；重放后 `!isRunning` 分支补发 synthetic done 与真实 done 双发；`flushPersistQueue` 重排队自承「顺序可能乱」。**修法**：事件 id 单一事实源——持久化行加 per-session `seq` 列，重放/续传/内存全用 seq；token 合帧携带帧内最后事件 id。

**A3 autoCompact 双写无串行化/CAS**：「contextSummary 覆盖到哪条消息」与「边界消息插在哪」是同一事实，却分两次独立写。run 入口 auto-compact 与手动 `/compact`（router.ts:676-698，无 running 守卫）并发时交错写 → contextSummary 只覆盖到 msg100、历史切片却从 msg120 起——msg101–120 从模型视野静默消失（原文在 DB，下次压缩自愈）。附带：`nextCompactGeneration` 靠解析摘要文本 `v\d+@`，落库摘要无 marker，generation 永远停在 2。**修法**：压缩写回收单事务 + 代际 CAS（`WHERE id=? AND contextSummary <=> ?`），边界消息同事务；manual compact 复用同一 per-session 锁。

**A4 POST 起流返回值被忽略 + 占位键共享**：`startIfNotRunning` 返回 false 时不区分「同消息重试」与「新消息」，一律降级为订阅——运行中直发的新消息**从不落库、不进队列、无报错**；新会话占位键是共享 `""`，两标签页同时发首条消息 → 第二个 POST 撞车订阅到第一个聊天的流（消息被丢且看到别人的输出）。**修法**：互斥结果三态化（started / duplicate-same-request（clientMessageId 判定）/ busy（结构化 409 由前端转 steer/排队））；占位键每 POST 唯一。

**A5 注入队列随 RunState 销毁**：follow_up 仅在 BEFORE_STOP 消费、steer 仅在 AFTER_TOOL_BATCH 消费；run 收尾窗口/最终 LLM 轮/one-at-a-time 剩余项全部滞留，RunState 随 run 结束被 GC，消息不落 DB、不通知前端，UI 却已 toast「已加入后续追问」。**修法**：接受即持久——enqueueInject 先写 SessionQueueItem（kind=steer/follow_up）做事实源，内存队列只是索引；run 收尾转移点统一移交既有 drain 通道。

### Async/Swarm 调度（PR-4）

**B1 reconciler 永不收敛对账循环**：autoConsume 对 sleep/async_task_tool 失败「标 delivered=true 但不写气泡」（避免反复 notify）；reconciler Pass 1 以 ChatMessage 气泡为唯一 ground truth → 永远判孤儿 → 回滚 → renotify → 再标 delivered=true → 无限循环（每轮伴随 SSE 推送+DB 写+warn）。**修法**：Pass 1 候选直接排除 `status=failed && sourceType ∈ (sleep, async_task_tool)`，或 autoConsume 落 `output.deliveryExempt=true` 台账标记供对账识别——豁免判定收在 reconciler 单点。

**B2 superior drain 崩溃窗口消息永久丢失**：认领语义 = 物理删除 SessionQueueItem 且同事务把 AgentMessage 置 consumed，但消息进子会话发生在之后的 `runItem→prepareAgentRun`；崩溃/抛错 → 行已删、账已 consumed、气泡未写，且三条恢复路径（requeueOrphanedSuperiorDrains/reconcileAgentMessageLedger/drain catch）都覆盖不到。**修法**：改「软认领列」（claimedAt，启动恢复扫超龄未落地项重置重投），删行推迟到 ChatMessage 写入成功之后——**队列项只能在内容已进 ChatMessage 之后消失**。

**B3 autoConsume 槽内等待**：drain 通道先 `hub.waitFor` 再准入（槽外等）；autoConsume 先获槽再 `await hub.waitFor`（槽内等）——maxConcurrent=2 时一条 delivery 的 consume 可占住全局槽一半数分钟。**修法**：waitFor 移到 runConsumeJob 之前，与 drain 对齐——池槽只覆盖「执行」，不覆盖「等待起流条件」。

**B4 启动恢复两缺陷**：a) resume 分支条件写认领后把状态写回 `"queued"`——行仍匹配认领条件，同进程二次调用 retryCount 再 +1、同 jobId 重复入池双跑；b) 动作 1 入池即返回、执行体并发跑，动作 2 `running→paused` 可能把刚被 resume 置 running 的子会话误判僵尸。**修法**：resume 认领写中间态 `resuming`（认领条件排除之，条件写天然幂等）；动作 2 移到动作 1 之前或加 `updatedAt < bootTime` 过滤。

**B5 depth 防循环名存实亡**：depth 事实源是 `msg.depth ?? 1`（LLM 可见入参），全仓无服务端自动递增点，busy 分支干脆不传。**修法**：与 W16a taskRef 同手法——depth 移出 LLM 可见 schema，服务端沿派生链物化（spawn/send 取父链 depth+1）。

**B6 start() 同步抛错泄漏槽位**：计数递增与 runningJobs 登记在 `spec.execute()` 调用之前，同步 throw 穿透 finally 不执行 → runningGlobal 永久 +1。**修法**：`Promise.resolve().then(() => spec.execute(signal))` 或 try 包调用点，异常归入失败路径。

**B7 SessionQueueItem 无唯一约束**：superior 幂等（findFirst 后 create）与 maxOrder 都是 check-then-insert，两条锁外并发路径（服务端 busy 分支 + 前端镜像）可双建行、撞 order。**修法**：schema 加 `@@unique([sessionId, agentMessageId])`，create 改 upsert/捕获唯一冲突走幂等返回。

### 心跳/审批/预算（PR-2、PR-3）

**C1 僵尸 running Task 永久卡死**：恢复扫描 where 只认 `name startsWith "[async]"` 或 `type="async_agent"`；心跳/cron/trigger 三个入口在 v8 池体系外自写 running Task 行，且心跳与 TaskScheduler 把该行当重叠闸——崩溃或池准入失败后行永远 running → 心跳**静默永久停摆**（不计失败、不触发熔断告警）。**修法**：恢复扫描按 type/命名空间收拢全部执行型 Task；重叠闸改原子条件写认领（`updateMany where status!="running"`）；Task 生命周期与池口径合一（入队先 queued，获槽才 running，拒绝对已建行补偿收尾）。

**C2 refresh() 无串行化**：`jobs.clear()` 与重新 `cron.schedule` 之间隔着两处 await DB；交叠 refresh 各自注册同一 agent，`jobs.set` 互相覆盖，先注册的 ScheduledTask 永远摘不掉 → cron 到点双发（双倍 LLM 消耗）。**修法**：refresh 串行化（单条 promise 链排队/coalesce）或 generation 令牌（注册前比对代际，过期代际 stop 已建 job 并放弃）。

**C3 审批等待注册表 missed-wakeup + TTL 误报**：先 `await getById` 读 pending、后注册 waiter——读与注册之间决策+notify 落地则事件丢失，waiter 挂到 TTL（默认 24h）；TTL 定时器忽略 `expireApprovalIfPending` 返回值，count=0（实际已被并发批准执行）也无条件 resolve `"expired"` → **操作其实已执行，LLM 却被告知「审批超时未执行」**，可能重复执行（如 git_commit）。**修法**：注册先行再对账（register→复读状态，已决直接 resolve）；TTL/批量清扫只对条件写**实际翻转成功**（count>0）的行发事件，否则读真实状态转达。随带统一 approval/ask_user 两 gate 的挂起-唤醒-中止语义（A6）。

**C4 心跳状态混合版本 read-modify-write**：`consecutiveFailures` 用触发时刻的旧值算，其余字段用新读的 current 合并再整 blob 覆写——并发 run 丢计数；在途失败写回旧值+1 会覆盖用户刚保存的清零（suspended 复活的唯一条件被破坏）。**修法**：计数改原子 increment/条件更新；运行态与配置态分列。

**C5 llmBudget TOCTOU + hydrate 竞态**：检查与扣费分离（并发 N 入口都看到未超限全放行）；重启后首个 getState 触发异步读盘，读盘完成前的消耗（dirty=true）使整份磁盘消耗被丢弃——**重启即抹掉今日已花额度**。**修法**：hydrate 改启动期一次性 await 完成后再服务请求（或合并式取 max）；软语义文档明示或改预留制。

**C6 CircuitBreaker 半开期无探测纪元**：closed 期发出的在途请求在 half-open 探测在途时完成，其成功/失败被当作探测结果（误合闸/误重开重计时）。**修法**：tryAcquire 返回探测令牌，record* 校验令牌归属，非探测期迟到事件忽略。

**C7 触发无原子认领**：cron tick 与手动 task.run / TriggerEngine 之间 check-then-act，窗口内可双跑。**修法**：认领单点化 `updateMany({id, status:{not:"running"}},{status:"running"})`，三入口共用同一认领函数。

### 数据层/同步（PR-1，随 P0）

**D3 实体文件写回零路径消毒**：`FileSyncService.writeFile` 是绕过 safePath 的第二条文件写通道——`agent.create({name:"../../tmp/pwn"})` 可写出 content 之外；Skill（sanitizeSkillName）/InfoSource（slugifyName）已有正确做法，Agent/MCP/Prompt 是遗漏。且该入口经 native 工具暴露给 LLM。**修法**：FileSyncService 单点加 slug 消毒 + `assertPathWithinProjectRoot`；shared schema 给 name/slug 加禁止 `/ \ ..` 与 Windows 保留字符 refine。

**D4 sync 与 CRUD 并发无保护**：dev 编排把 sync:watch 与 server 并行拉起；改名时序中 chokidar unlink（旧）事件若在 sourceSlug 回写前触发，`deleteBySlug(旧)` 硬删刚改名的实体。**修法**：根因靠 D1 顺序修正（先写新文件后改 DB）；sync 侧 watch deleteBySlug 加「该 slug 行 5 秒内刚被 update 过则跳过并转全量」保护；`syncFileMetaToDb` 禁止静默 catch。

**D5 FTS 三条漂移通道**：① watch 模式单文件事件不碰 FTS（编辑后搜索持续陈旧）；② rebuildFtsIndex 不过滤墓碑（post 无 `deletedAt:null`、agent 不排除 deleted → 回收站/已删实体重回搜索）；③ 增量维护只覆盖 post/agent/skill/memory，mcp/task/prompt/message 没有。**修法**：FTS upsert/delete 收进各 syncer 的 upsert/deleteBySlug；rebuild 补墓碑过滤；mcp/prompt 补 syncFts 挂钩；FileSyncService 可把 syncFts 声明为抽象钩子强制子类实现。

**D8 supersedeUpdate 两步写无事务**：write（新 active 行）与旧行标 superseded 无 `$transaction`，崩溃留双 active；memoryService 缺省时静默降级直写 prisma（跳过文件写回与 FTS 且无告警）。**修法**：两步写包事务（文件/FTS 副作用事务后按 D1 顺序补）；缺省降级改显式 throw/error。

### Web Chat 状态层（PR-6）

**E1 ACK 瞬态失败 → 异步结果永久丢失**：`markDeliveryConsumed` 在 ACK 请求**之前**乐观标记，ACK 失败 catch 只释放 drain 锁不回滚标记；标记持久化到 localStorage 且无 unmark 路径 → 服务端 reconciler 重投后 UI 依然 skip，任务结果永不进对话。**修法**：`claimed:true` 之后才 markDeliveryConsumed（drain 锁已保证无并发，提前标记无保护作用），或新增 unmark action。

**E2 INV-1 不在 reducer**：COMMIT_STREAM 对任意 phase 照单全收；`commitStream()` 公共 API 显式放行 streaming→idle 直跳（useChatRunStream.ts:591-593 finally「强制 commit」正是这么绕过 INV-1 的）；COMPLETE_STREAM/FAIL_STREAM 无相位守卫。**修法**：reducer 拒绝 phase==="streaming" 的 COMMIT_STREAM（dev 期 console.error）；「流式中道崩殂需释放占用」建模为显式 ABORT_STREAM action（自带 leftover 处置语义）。

**E3 abort 后 2s setTimeout 兜底**：abort 路径等服务端 partial assistant 对齐来 commit，「服务端可能无 partial」这个协议空洞用 `setTimeout(2000)` 赌——partial 落库慢于 2s → 强制 commit 拆块后迟到 upsert 再出现（闪烁原样回归）。**修法**：协议显式化——`stopAgentChat` 响应（或服务端 abort 事件）携带 `partialAssistantMessageId | null`；reducer 增加 abort-pending 语义：有 id 走对齐 commit，明确无 partial 立即 commit。计时器删除后行为不变才算根治。

**E4 悬停/预取置 drainRequested**：prefetchSessionMessages 只读意图走同一 hydrate dispatch → 无条件置 drainRequested → 鼠标悬停可能把后台会话 compose 队列里的消息发出去。**修法**：hydrate action 增加 `source:"view"|"prefetch"`，prefetch 不置 drainRequested；INV-8 ④ 的四类合法 drain 源在类型层面枚举。

**E5 hydrate 合并新鲜度粒度太粗**：same-id 消息一律以 incoming 快照为准，唯一保护是「整列 id 序列相同则跳过」——快照旧但 id 集合不同会回写旧内容（M=v2 被回写 v1）。**修法**：hydrate 对 same-id 复用 upsert 的 compare-skip（或按 updatedAt 取新），整列相等仅作快路径。

**E6 sessionChanged 全量替换抹本地项**：新会话首条消息时序中，queueHydrate 快照先于 dbId 回填落库返回 → 全量替换抹掉迁移来的排队项 → dbId 补写丢失、消息滞留。**修法**：全量替换也走 mergeUserQueueFromDb（DB 行 + local-only 单一合并入口）。

---

## P2/P3 登记项（本轮不修，转入 design-decisions 待办）

- **A7**：stream/sync 两链路行为分叉（reflection 拒稿已流出；sync abort 不留部分稿）。修法方向：reflection 开启时 transport 对疑似终轮缓冲 token 至 verdict；部分稿保存收进 reactLoop catch 转移点。
- **A8**：扁平存储重建时序失真 + inject 幻影消息。修法方向：assistant 按轮拆行或 toolCalls 带 round 序位、注入消息记 injectAfterRound；inject 落库失败=注入失败（不 push 进 LLM 上下文）。
- **B8**：spawn 去重窗口对齐任务在途期（挂 completion）而非固定 60s。
- **C8**：config 单通道化（活读 env 全部启动时解析进 AppConfig）或显式维护「热生效旋钮清单」。
- **D7**：safePath 写操作前对父目录 realpath 并重新校验前缀。
- **E7**：useSubagentMessageMirror 判重键改 agentMessageId（镜像写入时记入 toolResults/source），触发改显式事件。
- **E8**：会话配置收进 per-session store 切片消灭上报效应；mount-resume 改「先 hydrate 配置再起流」两阶段编排。

---

## 已确认稳固（抽查通过的机制，免于复查）

- **Run 相位机本体**：转移表完整（含 awaiting_human），非法转移抛错；全链路经 machine.transition，无绕过路径；assistant 消息 + Run.output 单事务，message_upserted/done 均在事务成功后发出。
- **hub 并发占位**：start() 同步 runs.set 占位先于首个 await；subscribe 内存路径「重放+挂订」同步无窗口；事件合帧先冲刷后插非 token 事件。
- **Session resume 闭环**：paused→running 条件写唯一互斥点、幂等、回滚条件写、终态归位 where status:"running" 防覆盖。
- **askUserGate**：pending 检查与 waiter 注册同步临界区（免疫 approvalGate 式竞态）；孤儿答复入 SessionQueueItem 由既有 drain 起轮。
- **审批执行路径**：canonical JSON argsMatch、executed 软删除、先落库后 notify、执行失败也唤醒；多 waiter 全量唤醒、removeApprovalWaiter 幂等、TTL+abort 双兜底无泄漏。
- **池准入原子性**：drain() 同步循环三层计数判定+递增无 await 交错，无 TOCTOU；崩溃时执行体同归于尽，DB Task 行为 ground truth。
- **reconciler ↔ 前端 ack 互斥**：CLAIM/回滚条件互斥、同事务带 AgentMessage 账本、双认领路径都写 jobId 台账。
- **deliveredAt 记账一致性**（W16a-1 已落实）：delivered→consumed 不覆写、pending→consumed 兜底补齐、回滚清 deliveredAt。
- **断路器状态机本体**：转移表 + 唯一写入口、非法转移拒绝、half-open 单探测同步布尔、open 期零真实连接。
- **TriggerEngine 互斥**：runningTriggers check→set 同步段原子；stop() 正确摘除通配监听；node-cron 不补射停机期触发（无开机风暴）。
- **SwarmOrchestrator dispatch**：guard+dedup 同步段判定、dedup 注册先于任何 await。
- **SessionQueueItemService.consume/reorder**：$transaction + deleteMany 原子认领 + 条件写，落选方 claimed:false。
- **sync cleanup 保护**：只删 sourceSlug 非空行；activeSlugs 为空拒绝清库；taskSyncer.upsert 不覆盖运行态；agentSyncer name 兜底。
- **FileService.upload**：basename 消毒 + 文件先行 DB 后行（D1 的正面范例）。
- **无长事务包 LLM/文件 IO**；列表无 N+1 热点；db.ts WAL。
- **Web reducer**：BEGIN_STREAM occupied 拒绝、HYDRATE_DONE 仅 idle 置位、MARK_INFLIGHT_ASSISTANT 仅 occupied、done 双通道幂等收敛、drain 单驱动（onStreamCommitted 唯一订阅点）、会话切换按 originSid 键控隔离、存储 JSON.parse 全有兜底、MIGRATE 成对。
