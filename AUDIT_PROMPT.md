# KnowPilot 全面架构审计 Prompt（详细版）

> 你是新接手 KnowPilot 项目的技术负责人。你的任务是对整个项目进行一次**全面、严格、基于代码证据**的架构体检，产出可执行的修复清单。
>
> **铁律：所有结论必须引用具体文件路径 + 行号 + 代码片段。** 不允许「大概」「可能」「似乎」——要么给出代码证据，要么标「待验证」并写明验证步骤。看不懂的地方先读代码，不要臆测，不要问用户，自己决策。
>
> 本任务是**只读审计**：发现问题写进报告，**禁止改任何代码**。

---

## 0. 强制阅读顺序（跳读会漏掉关键约束）

按顺序读，每读完一份用一句话复述它的核心约束。全部读完后用 200 字以内复述：项目是什么、当前阶段、核心架构约束、你最担心的 3 个风险面。**复述不出就别往下走。**

1. `AGENTS.md` —— 项目宪法。重点：技术栈表、实体矩阵、**架构纪律两铁律**（禁止打补丁 / 禁止向后兼容）、**单文件收拢四条**（services.ts / router.ts / hooks.ts / shared.tsx）、Swarm 三层、当前状态与近期变更段（PR-1~6 / W1~W5 / v7~v10 / 可重入已移除）
2. `README.md` —— 产品定位与快速开始
3. `MIGRATION_PLAN.md` —— Markdown↔SQLite 投影层约定（FileSyncService 文件先行 DB 后投影）
4. `docs/development/README.md` —— L1-L5 阶段划分与 19 实体矩阵
5. `docs/development/design-decisions.md` —— 已确认设计决策。重点读：PR-1 数据同步完整性、PR-2 审批/断路器/预算、PR-3 心跳调度、PR-4 投递对账、PR-5 流式内核不变量、PR-6 Web Chat store 不变量、全局任务池 Q1~Q4、可重入与续跑 Q1~Q4（注意：可重入机制已按用户要求移除，确认代码里真的没了）、W1~W5
6. `docs/development/concurrency.md` —— 并发不变量与竞态防护（§8 可重入与续跑、§13 预算、全局任务池节、投递可靠性节）
7. `docs/development/architecture-audit-2026-07-20.md` —— 上一次体检结论（2 P0 + 16 P1 + 19 P2/P3）。**对照每条本次是否复发**
8. `docs/development/refactor-plan-2026-07-20.md` + `refactor-prompts-2026-07/00~11*.md` —— 重构套件执行情况
9. `docs/development/chat-state-architecture.md` + `chat-scenario-states.md` —— Chat 三层 store 不变量（Stream Commit 不变量是「删掉编排层补丁 bug 不复现」的样板）
10. `docs/development/async-tools-semantics.md` —— 异步工具语义全景
11. `apps/server/prisma/schema.prisma` —— 19 实体模型，重点看唯一约束、索引、字段默认
12. `packages/shared/src/{schemas,constants,types}.ts` —— 共享契约（Zod schema + 常量 + 类型）
13. `config.yaml` —— 运行时配置（llm / stream / reflection / compact / asyncJobs / heartbeat / approvalGate）
14. `.env.example` —— 环境变量清单

---

## 1. 核心模块地图（审计时按此索引定位代码）

### 后端 `apps/server/src/`

| 模块 | 文件 | 审计要点 |
|---|---|---|
| API 入口 | `index.ts` | 启动序列（initGlobalProxy → loadRootEnv → getAppConfig → EventBus → TriggerEngine → HeartbeatEngine → reconciler → 恢复扫描），shutdown 顺序 |
| 路由层 | `router.ts` | 20 实体 router + ai 反射；所有 procedure 是否 publicProcedure；列表返回结构是否统一 `{items,total,page,pageSize,totalPages}` |
| 业务层 | `services.ts` | 19 实体 Service；FileSyncService 双写（文件先行 DB 后投影 + 失败补偿）；deleteFileBySlug 是否静默吞错 |
| tRPC | `trpc/trpc.ts` + `trpc/context.ts` | 全局错误格式化；context 注入 prisma + ServiceContainer |
| ReAct 内核 | `infra/loop/reactLoop.ts` | maxRounds/maxToolCalls 硬顶；tool_batch 后快照写 Run.output（5s 节流 + phase 转移强制写）；终态统一 update；`truncateToolResultContent` 是否破坏结构；awaiting_human 挂起与 approval_resolved 唤醒 |
| 反思 | `infra/loop/reflection.ts` | withReflection 在 done 前一票 critic；不通过经 injectUserMessages 回注重修；轮数耗尽带标记放行 |
| Agent 运行时 | `infra/agentRuntime.ts` + `infra/agentStream.ts` | sync/stream 双链路；error 事件 retryable 填充；finalizeRun 拒绝 aborted→success；persistedCreatedAt 推送 |
| LLM 客户端 | `infra/llmClient.ts` + `infra/resilientLlmClient.ts` | 错误分类 fatal/retryable/degradable；指数退避 jitter；fallbackModels 降级；预算防抖落盘 |
| 预算 | `infra/llmBudget.ts` | 模块级内存 + 防抖异步落盘；启动 hydrateLlmBudget 同日 max 合并；日预算软语义「估算下界」 |
| 流式 hub | `infra/sessionStreamHub.ts` | 内存环形缓冲 + SQLite 事件日志双写；seq 为 SSE id/续传/重放单一事实源；subscribeExternal 不重放 message_upserted；token 合帧带 id；DB 已有 done 不补 synthetic done |
| Chat 会话 | `infra/chatTree.ts` + `infra/sessionService.ts` | compactionGeneration persist 单事务 CAS；startIfNotRunning 三态 started/duplicate/busy + 占位键；enqueueInject 先写 SessionQueueItem；handoffUnconsumedInjects；强制单主会话 |
| Swarm 权限 | `infra/swarmPermissionGuard.ts` | tier 校验 + 跨 Workspace + depth 防循环 + 向上消息时机 |
| Swarm 总线 | `infra/swarmBus.ts`（+ `redisSwarmBus.ts`） | LocalSwarmBus SQLite AgentMessage；checkUpwardMessageTiming 单点；markConsumed |
| Swarm 编排 | `infra/swarmOrchestrator.ts` | dispatch → guard → 60s 去重 → 并发池/inline → 聚合 → 审计 |
| 心跳 | `infra/heartbeatEngine.ts` + `infra/heartbeatDecision.ts` | node-cron 定时 + 预算检查 + 并发控制；buildHeartbeatDecision 纯函数；wait_user_gate 通知冷却；quiet/monitor 退避；streak 达阈值 suspended 暂停 + 持久化 Agent.heartbeatSuspendedAt |
| 异步任务 | `infra/asyncJobOrchestrator.ts` + `infra/asyncJobManager.ts` | 全局池容量准入链（global→session→workspace）；queued 记 reason+position；血缘槽位继承；runConsumeJob 队首优先；reconcileAsyncDeliveries 对账幂等；releaseStaleClaims；recoverStaleAsyncJobs 两态分叉 |
| 工具注册 | `infra/tools/registry.ts` + `infra/nativeTools.ts` | ToolCommand 注册表（destructive/reentrant/approvalExempt/output.deliveryExempt）；34 只读工具标 reentrant（**注意：可重入机制已移除，确认这些字段还在不在、有没有死代码**） |
| 工具实现 | `infra/tools/native/{fs,web,shell,swarm,session,memory,integration}.ts` | 每个工具的 schema/description；run_shell 敏感 env 过滤；safePath；platform_login 登录态判定 cookie；read_article offset 分页；vision_describe 模型路由；ask_user gate TTL；send_email vs ask_user 职责边界 |
| MCP | `infra/mcpClient.ts` + `infra/circuitBreaker.ts` | 截断重连熔断三态（closed→open→half-open）；half-open 单探测令牌；open 期零真实连接；每 server 一实例 |
| 审批 | `infra/approvalGate.ts` + `infra/approvalScope.ts` | decisionScope 派生 + 通配匹配；requiredScopes 推导；waitApprovalResolution/notifyApprovalResolved；TTL expireStaleApprovals；safeBypassUsed 只读 turn |
| 回滚 | `infra/tools/rollback.ts` | RunRollbackStack；destructive 工具 capture/commit；run failed 逆序补偿；10MB 上限 |
| 记忆 | `infra/memoryRepository.ts` + `infra/memoryDaily.ts` | scope 三层（global/workspace/agent）；resolveMemoryWriteScope 越权硬拦；decayMemories 差异化衰减；lastAccessedAt 基准；accumulateExperience 双写 |
| 上下文钩子 | `infra/contextHooks.ts` | registerContextHook/runContextHooks；order 100-999 内建 / 1000+ 外部；同名覆盖；单钩子异常 warn 跳过；v1 enabled: round===1 |
| Prompt 构建 | `infra/promptBuilder.ts` + `infra/agentResolver.ts` | buildSystemPromptSkeleton；memory/tier-identity/tool-guide/agent-extras 内建钩子；resolveAgent 只读化（返回 drift 不写库） |
| Agent 工厂 | `infra/agentFactory.ts` | 三 tier 模板（content/agents/_templates/{tier}.md）；缺失回退常量 warn 一次/tier；sync 跳过 _ 开头 |
| 平台登录 | `infra/metablog/platformLogin.ts` + `infra/metablog/auth/` | loginCookieNames 是否误含设备 cookie（d_c0/xhsappid/uuid 之类）；capturePlatformLoginState 只在检测到真登录 cookie 才存；窗口是否过早关闭 |
| 代理 | `infra/proxyDispatcher.ts` | initGlobalProxy 读 KP_HTTPS_PROXY/HTTPS_PROXY；setGlobalDispatcher(ProxyAgent) |
| 邮件 | `infra/emailNotifier.ts` | SMTP/agentmail/ntfy 多通道；断路器；Approval lastNotifiedMessageId/ThreadId；AgentMail webhook 第一行 APPROVE/REJECT |

### 前端 `apps/web/`

| 模块 | 文件 | 审计要点 |
|---|---|---|
| Chat 主页 | `app/agents/[id]/chat.tsx` | 三栏布局；useEffect 数量（应只减不增，16 只上限） |
| 消息列表 | `components/chatMessageList.tsx` | Virtuoso；回到底部浮动按钮；交互式代码块（HTML/SVG 预览、复制、最大化、换行） |
| 左栏 | `components/chatSidebar.tsx` | 子 Agent 数量是否自动更新（onToolEnd invalidation 覆盖所有 agent-modifying 工具） |
| 右栏 | `components/chatRightPanel.tsx` | 异步进度三级分组；awaiting_human 显示被堵 scope |
| 三层 store | `lib/useSessionMessages.ts` + `lib/useStreamLifecycle.ts` + `lib/useSessionComposeState.ts` | phase 转移合法性表；commitStream 唯一钩子；pickFresherMessage；mergeUserQueueFromDb；no-op upsert 跳过 tryCommitAfterAssistant |
| 域 hooks | `lib/useChat*.ts`（5 个） | UI 偏好、会话配置、悬停预览、异步 overlay、子 Agent 消息镜像 |
| SSE 订阅 | `lib/useChatSseSubscriptions.ts` | async_job_update / agent_message / subagent_session_update 推送优先 |
| 语音 | `lib/useSpeechRecognition.ts` + `lib/useSpeechSynthesis.ts` | useSyncExternalStore 防 hydration mismatch |
| tRPC | `lib/trpc.tsx` | superjson；React Query 客户端 |
| 工具图标 | `lib/toolIcons.tsx` | 是否有死映射（指向已删工具） |

### 同步脚本 `apps/server/src/scripts/`

`sync.ts`（入口）+ `sync/sync-*.ts`（各实体）+ `sync/utils.ts`（getContentDir/filePathToSlug/getFilesRecursive）。重点：getContentDir 是否统一读 config（无双轨）；filePathToSlug 是否产生嵌套前缀 slug；getFilesRecursive 是否跳过 .trash/点目录；watch guardedWatchDeleteBySlug 5s 改名窗口。

---

## 2. 审计方法论（分阶段交付，每阶段完成停下等我确认）

### Phase 0 — 全景侦察（只读）

逐项确认并记录：

- [ ] 仓库目录结构（`apps/` / `packages/` / `content/` / `config/` / `data/` / `docs/`）是否符合 AGENTS.md 描述，有无残留嵌套（如 `config/agents/agents/`）
- [ ] `pnpm install` 是否成功，有无 peer 警告
- [ ] `pnpm lint` 是否通过（server/shared tsc --noEmit + web eslint）
- [ ] `pnpm test` 是否通过（全量 Vitest），记录失败用例
- [ ] `pnpm build` 是否通过（web Next.js build）
- [ ] `pnpm db:sync` 是否成功，有无 stale slug 清理
- [ ] git 历史最近 30 提交主题脉络
- [ ] `apps/server/src/scripts/` 剩余 15 个脚本是否都有明确用途
- [ ] 全仓 `兼容|legacy|LEGACY|deprecated|backward` 关键词扫生产代码（应为零命中）
- [ ] 全仓 `TODO|FIXME|HACK|XXX` 注释清单
- [ ] `data/` 目录是否被 .gitignore 整体忽略
- [ ] `apps/server/config/` 是否存在（应为不存在，若存在说明 memoryDaily 路径 bug 复发）

**交付物**：项目骨架图 + 能跑/不能跑清单 + 残留嵌套/死代码/TODO 清单。**完成后停下。**

### Phase 1 — 项目理解（只读）

画出两张图：

1. **核心模块依赖图**（谁 import 谁，标出循环依赖环是否已断）
2. **关键不变量清单**：每条不变量标注它在哪个 reducer/action/转移点被强制。例如：
   - `done→idle 必经 commitStream` → `useStreamLifecycle.ts` reducer 的 COMMIT_STREAM action
   - `BEGIN_STREAM 在 occupied 时拒绝` → 同上 reducer
   - `compactGeneration persist 单事务 CAS` → `chatTree.ts` persistCompactResult
   - `startIfNotRunning 三态` → `chatTree.ts` startIfNotRunning
   - `superior queue drain FIFO + 软认领` → `asyncJobManager.ts` enqueueSuperiorQueueDrain + SessionQueueItemService.consume
   - `spawn 去重 60s` → `swarmOrchestrator.ts` dispatch
   - `审批 decisionScope 通配匹配` → `approvalScope.ts`
   - `memory scope 越权硬拦` → `memoryRepository.ts` resolveMemoryWriteScope

**交付物**：依赖图 + 不变量清单。**完成后停下。**

### Phase 2 — 架构审计（只读，逐维度排查）

按下表 11 个维度逐项排查。**每个维度都要给出：① 证据（文件:行号 + 代码片段）② 是否合规 ③ 若不合规，根因属于哪层职责越界 ④ 修复建议（架构层根治，禁止打补丁）⑤ 验证方法（删掉某段编排层代码 bug 是否复现）。**

#### 维度 1：状态机不变量（Chat 三层 store）

逐行读 `lib/useStreamLifecycle.ts` 的 reducer 与 `lib/useSessionMessages.ts`、`lib/useSessionComposeState.ts`。检查：

- [ ] phase 转移合法性表是否由 reducer 强制（不是靠编排层守卫）
- [ ] `done→idle` 是否必经 `commitStream`（删掉编排层任何 await/守卫，reducer 仍拒绝直跳）
- [ ] `BEGIN_STREAM` 在 occupied 时 reducer 是否拒绝（返回 busy/duplicate）
- [ ] `ABORT_STREAM` 三态契约：streaming→idle（有 partialId 等对齐）/ null 立即 idle / 非法转移 no-op
- [ ] `COMMIT`/`COMPLETE`/`FAIL` 相位合法性表
- [ ] `ackThenMarkDelivery`：claimed:true 后才 mark，失败可 unmark
- [ ] `mergeUserQueueFromDb` 统一水合，prefetch 不置 drainRequested
- [ ] `pickFresherMessage` same-id 取新
- [ ] no-op upsert 跳过 `tryCommitAfterAssistant`（防 stale 重放误标 in-flight）
- [ ] 编排层有没有偷偷加 `await hydrate` / `setTimeout` / `queueMicrotask` / `phase === "xxx"` 守卫（**有就是正在打补丁的信号**）

**自检**：随机删掉 `chat.tsx` / `useChatRunStream.ts` 里一段编排层代码，bug 还复现吗？复现 = 不变量没收进 reducer。

#### 维度 2：Swarm 竞态

逐行读 `swarmPermissionGuard.ts` / `swarmBus.ts` / `swarmOrchestrator.ts` / `agentStream.ts` 的 `prepareAgentRun` / `asyncJobManager.ts` 的 `enqueueSuperiorQueueDrain` / `agentMessageLedger.ts`。检查：

- [ ] tier 校验：super 近似全能（硬禁删自己/自降 tier）、manager 本 Workspace CRUD、sub 执行+report_back
- [ ] 跨 Workspace 通信禁止（除 super 向上报告）
- [ ] depth 防循环（SWARM_MAX_DEPTH）
- [ ] 向上消息时机：checkUpwardMessageTiming 单点（#41 时机约束归属 swarmBus.send）
- [ ] `prepareAgentRun` 三态 started/queued/failed，busy 判定前移到写 ChatMessage 之前
- [ ] busy 时消息走 `bus.send` 写 AgentMessage pending + superior 幂等镜像，**不写 ChatMessage**
- [ ] superior queue drain FIFO + 软认领（`{success, claimed}`，落选返回 claimed:false 不抛错）
- [ ] spawn 去重 60s 窗口（agentId + hash(taskText)）
- [ ] 血缘槽位继承防死锁（waitForResult=true inline 不占新槽）
- [ ] `agentMessageLedger` 对账幂等（taskRef=jobId，updateMany 条件幂等）
- [ ] report_back 的消费载具是 Task 管道（autoConsume 原子认领 → 注入父会话），旁路邮箱 AgentMessage 是否回写 consumed
- [ ] **复现场景**：父 Agent 给 3 个子 Agent 派活，子 Agent report_back 时父 Agent 正在跑别的——消息会丢吗？重复吗？死锁吗？写出具体步骤

#### 维度 3：工具死循环 / 终止条件

逐行读 `reactLoop.ts` 的循环条件 + `approvalGate.ts` + `askUserGate`（在 integration.ts 或独立模块）。检查：

- [ ] `maxRounds` / `AGENT_MAX_TOOL_CALLS_PER_RUN`（168）是否硬顶，超出是否终止
- [ ] 工具异常是否会被吞成无限重试（catch 后是否计入失败计数）
- [ ] `destructive` 工具 rollback 栈在 run failed（非用户 abort）时是否逆序补偿
- [ ] `awaiting_human` 挂起后 `approval_resolved` 唤醒续跑，拒绝/过期注入消息让 LLM 收尾
- [ ] `ask_user` gate TTL（默认 5 分钟，测试 10s）与超时回收
- [ ] ask_user 提醒邮件升级序列（1min → 10min → 30min → 30min → 1h 固定）是否实现
- [ ] ask_user 邮件回复是否注入 session 上下文送 LLM 但**不显示为 chat 气泡**，而是填入 customResponse 输入框
- [ ] 审批邮件回复（APPROVE/REJECT）是否作为用户输入送 Agent（不是后端自动决策）
- [ ] **复现场景**：Agent 调一个一直失败的工具（如网络不通的 MCP），会不会无限重试耗尽预算？审批挂起后用户不回复，会不会永远卡住？

#### 维度 4：工具设计合理性

逐个工具读 `infra/tools/native/*.ts` 的 schema + description。检查：

- [ ] 每个工具 description 是否足以让 LLM 在多工具场景下选对（有无歧义）
- [ ] `send_email` vs `ask_user` 职责边界：send_email 是单向通知，ask_user 是等待回复；是否可通过参数切换收件人邮箱
- [ ] `read_article` offset 分页是否真生效（slice(offset) 在 maxChars 之前），返回是否含 totalChars/offset/nextOffset
- [ ] `vision_describe` 模型路由优先级：env > agent vision > 智谱 GLM-4.1V > Kimi > Gemini > OpenRouter > deepseek-vl2
- [ ] `platform_login` 登录态判定：loginCookieNames 是否误含设备 cookie（d_c0/xhsappid/uuid 之类会导致「窗口一开就关显示已登录」）
- [ ] `truncateToolResultContent` 是否破坏工具结果结构（长文本字段优先截断，保留 metadata）
- [ ] `invoke_api` 是否已删（用户要求 cut）
- [ ] `agent_inspect` 的 recentMessages 内容是否已删（父 Agent 只看子状态，消息经 report_back 才可见）
- [ ] `capture_zhihu_login` 是否已删（被 platform_login 取代）
- [ ] `async_task_wait` 是否已删
- [ ] 工具图标映射 `toolIcons.tsx` 是否有指向已删工具的死映射

#### 维度 5：并发与竞态

检查：

- [ ] SQLite `PRAGMA busy_timeout` 是否设置
- [ ] CAS `updateMany` 条件写（compactGeneration / consecutiveFailures / claimTaskRun）
- [ ] `claimedAt` 软认领 + `releaseStaleClaims` 启动清理
- [ ] `compactGeneration` persist 单事务 CAS，running 拒手动 compact
- [ ] `startIfNotRunning` 三态 + 占位键 `pending:${clientMessageId|uuid}`，busy→409
- [ ] 双通道 SSE 幂等消除（后到达做幂等 upsert/commit，不用 await hydrate 赌）
- [ ] `reconcileAsyncDeliveries` 对账幂等（delivered=true 终态超龄 60s 未 pinned → 回滚 → 重投，每轮上限 50）
- [ ] `enqueueInject` 先写 SessionQueueItem，ack 确认消费，收尾 handoffUnconsumedInjects→kind=user
- [ ] `@@unique([sessionId, agentMessageId])` + 事务 create / P2002 幂等
- [ ] `Promise.resolve().then(execute)` 同步抛错不漏槽
- [ ] `runStartupRecovery` 四动作（僵尸 Task→failed / 僵尸 ChatSession→paused / superior 孤儿重注册 / delivered=false 重投）
- [ ] **注意：可重入机制已移除**——确认 `reentrant`/`retryCount`/`maxRetries` 字段是否还在 schema（应在）、是否还有代码读这些字段做自动续跑（应无自动续跑，只有手动 retryAsyncJob）

#### 维度 6：安全

检查：

- [ ] `run_shell` 敏感环境变量过滤（不泄漏 API key 到 LLM）
- [ ] `safePath` 路径穿越防护（content/config/data 子目录落点校验）
- [ ] 凭证加密（Credential 表）
- [ ] `AUTH_MODE=none/password` 鉴权
- [ ] Express rate-limit IPv6 keyGenerator（曾出 ValidationError）
- [ ] 审批 `decisionScope` 通配匹配 `<domain>:<verb>:<target>`
- [ ] `memory_create` scope 越权硬拦（仅 super 写 global，禁止伪造他 Agent/他 Workspace）
- [ ] `agent_delete_sub` 是否纳入审批
- [ ] `AGENT_DESTRUCTIVE_APPROVAL` 开关
- [ ] `APPROVAL_PENDING_TTL_MS` 过期清理 cron

#### 维度 7：可观测性

检查：

- [ ] `trace_id` AsyncLocalStorage 传播是否覆盖所有异步边界（fetch / setTimeout / queueMicrotask）
- [ ] Run 快照 5s 节流 + phase 转移强制写
- [ ] LLM schema size warning
- [ ] SessionStreamEvent TTL 清理（eventTtlMs / cleanupIntervalMs）
- [ ] 断路器三态转移拒绝日志
- [ ] heartbeat decision event=heartbeat_decision 日志
- [ ] agentDrift warn（console.warn + driftStatus tRPC + /agents 横幅）
- [ ] 邮件告警通道（streak 达阈值）

#### 维度 8：依赖治理

检查：

- [ ] 循环依赖环 `agentRuntime → loop → reactLoop → agentTools → nativeTools → agentRuntime` 是否已断（`importOrder.test.ts` 防线）
- [ ] `promptBuilder.ts` / `agentResolver.ts` 叶子模块是否被直连（无 re-export 兼容层）
- [ ] 动态 import 是否收窄到最少（agentStream / asyncJobManager / nodemailer）
- [ ] `undici` / `nodemailer` 可选依赖处理
- [ ] `@types/node` 在 server/web 间 ProcessEnv 定义不一致是否已处理（shellRunner cast）

#### 维度 9：测试有效性

逐个测试文件读，重点找「假绿」：

- [ ] spy 断言空（`expect(spy).toHaveBeenCalledOnce()` 但 spy 没 mock 返回值，实际逻辑没跑）
- [ ] mock 过度（整个 Service 被 mock，真实路径没覆盖）
- [ ] flaky 测试：时间敏感（decayMemories 用 Date.now()）、端口竞争、并行污染（process.cwd() 写工作树）
- [ ] e2e 是否覆盖关键路径（chat 发消息/重试/思考时间线/工具/OCR/队列/子 Agent resume/异步任务/主题切换/回收站）
- [ ] mock LLM 服务是否覆盖错误注入（retryable/degradable/fatal）
- [ ] 负向断言（旧实现即红）是否存在
- [ ] `chatSidebarRender.test.tsx` memo 屏障（10×50ms token 更新函数体仅执行 1 次）是否仍有效

#### 维度 10：文档一致性

检查：

- [ ] AGENTS.md「当前状态与近期变更」段与代码实际是否一致（PR-1~6 / W1~W5 / v7~v10 都标已落地，代码里真的有吗）
- [ ] `docs/development/` 各文档与实现是否漂移
- [ ] 注释与代码是否矛盾（如注释说「已删」但代码还在）
- [ ] `design-decisions.md` 已确认 ✅ 表格与代码是否一致
- [ ] 实体矩阵 19 实体落地状态与代码是否一致

#### 维度 11：死代码 / 冗余

检查：

- [ ] 未使用的 export（ts-prune 或手动 grep）
- [ ] 无引用的脚本（`apps/server/src/scripts/` 应剩 15 个都有用途）
- [ ] 兼容层残留（`兼容`/`legacy`/`deprecated`/`backward` 生产代码零命中）
- [ ] 一次性脚本是否执行后已删（migrate-* / fix-super-agent-* 应已删）
- [ ] .gitignore 冗余规则（嵌套防御 `config/**/` 应已删）
- [ ] 死配置（compact.charThreshold 之类）
- [ ] 死字段（AgentMessageInput.taskRef 之类）

---

### Phase 3 — 报告

把所有发现写入 `AUDIT_REPORT_v2.md`（项目根）。严格用以下格式，每条问题必须填满所有字段，缺一不可：

```markdown
# KnowPilot 架构审计报告 v2（YYYY-MM-DD）

## 执行摘要
- 审计范围：<覆盖的模块/维度>
- 审计方法：<读代码 + 跑测试 + grep 扫描>
- 整体健康度评分：<A-F> + 一句话结论
- P0/P1/P2/P3 问题数量统计表

## 已确认稳固（绿区）
| 模块 | 不变量 | 证据（文件:行号） | 验证方法 |
|---|---|---|---|
| Chat store | done→idle 必经 commitStream | lib/useStreamLifecycle.ts:Lxx reducer COMMIT_STREAM | 删掉 chat.tsx 编排层 await，reducer 仍拒绝直跳 |

## 问题清单

### [P0] <问题标题>
- **维度**：<维度 1-11>
- **证据**：`apps/server/src/xxx.ts:L123-L145`
  ```typescript
  // 粘贴代码片段
  ```
- **根因**：属于 <层> 的 <职责越界/不变量缺失/补丁栈/兼容层残留/...>
- **影响**：<数据丢失/竞态/死循环/安全漏洞/资金损失/...>
- **修复建议**：<架构层根治方案。必须回答：这个不变量收进哪个 reducer/action？>
- **验证方法**：<删掉哪段编排层代码 bug 仍不复现 / 负向测试用例 / 复现场景步骤>
- **自检**：
  - [ ] 删掉编排层补丁，bug 还复现吗？（复现 = 没收进 store）
  - [ ] 不变量收进 reducer 了吗？
  - [ ] 有没有新增 await/setTimeout/queueMicrotask/phase 守卫？（有 = 正在打补丁）

### [P1] ...
### [P2] ...
### [P3] ...

## 与上次审计（2026-07-20）对照
| 上次问题（标号） | 本次状态 | 证据（文件:行号） |
|---|---|---|
| D1 FileSyncService 双写 | 已修复 | services.ts:Lxx 文件先行 DB 后投影 |

## 建议的修复 PR 拆分
| PR | 范围 | 风险（低/中/高） | 依赖前序 PR | 验收清单 |
|---|---|---|---|---|
```

**严重度定义**：
- **P0**：数据丢失 / 资金损失 / 安全漏洞 / 死循环会拖垮服务 / 状态机可被打破导致消息错乱
- **P1**：竞态导致功能错误 / 工具误用高频 / 可观测性盲区导致排障困难 / 测试假绿掩盖真实 bug
- **P2**：文档漂移 / 死代码 / 兼容层残留 / 命名不一致 / 微优化
- **P3**：代码风格 / 注释措辞

---

## 3. 红线（违反即审计无效）

1. **禁止只看注释不看代码**。注释说「不变量由 reducer 强制」——你要打开 reducer 看它真的强制的。注释说「已删」——你要 grep 确认真的没了。
2. **禁止臆测**。说「这里可能有竞态」——你要么写出复现场景（步骤 + 预期 + 实际），要么标「待验证」并给验证步骤。
3. **禁止打补丁式判断**。「加个 await 就好了」「setTimeout 缓一缓」不是修复建议，是补丁。修复建议必须回答：根因是哪个不变量没被强制？把它收进哪个 reducer？
4. **禁止跳过 Swarm / 状态机 / 并发三块**。这是项目最复杂的部分，也是最可能藏 bug 的地方。这三块要逐行读 reducer / orchestrator / guard / ledger。
5. **禁止信任测试绿**。测试绿不代表代码对——你要看测试是否真的覆盖了不变量，还是 spy 断言空 / mock 过度 / 时间敏感 flaky。
6. **禁止改代码**。本任务是只读审计。发现问题写进报告，不要动手修。
7. **禁止向后兼容建议**。本项目是单用户本地优先未发布 1.0，没有外部消费者。改接口就改所有调用方，不要建议「保留旧签名做兼容」。
8. **禁止问用户决策**。所有设计决策你自己拍板，按最推荐方案写进报告。用户只在 Phase 0/1 完成后确认是否继续。

---

## 4. 反模式识别手册（看到这些立刻标红）

### 4.1 补丁栈（AGENTS.md 铁律）

编排层出现以下任一即为打补丁信号，必须追查根因：

- `onDone` 里 `await hydrate` 赌消息已落库
- 清 UI 前 `queueMicrotask` 看一眼 phase
- `finally` 里再 hydrate 一次保险
- `useEffect` 监听 `!isSessionStreaming` 就 `consumeRef()`
- `setTimeout` / debounce 缓一缓让两路 SSE 谁先谁后不重要
- `phase === "xxx"` 守卫挡非法转移（应 reducer 拒绝）

**判断标准**：删掉你这段编排层代码，bug 还复现吗？复现 = 补丁，没收进 store。

### 4.2 兼容层（AGENTS.md 铁律）

- `// 兼容旧调用方` 分支
- deprecated 参数「先留着」
- 老文件 re-export 新模块「方便旧引用」
- 双轨注册（如 `ensureNativeToolsRegistered` 双轨）
- 读路径 `if (老格式) ... else ...` 永久分支
- 一次性迁移脚本执行后没删

### 4.3 测试假绿

- `expect(spy).toHaveBeenCalledOnce()` 但 spy 没 mock 返回值，真实逻辑没跑
- 整个 Service 被 mock，真实路径零覆盖
- `Date.now() + N*DAY` 时间敏感断言（flaky）
- `process.cwd()` 作 projectRoot 写工作树（污染）
- 测试只断言「不抛错」不断言「结果正确」

### 4.4 状态机职责越界

- 编排层（callbacks/useEffect/try-finally）用时序猜弥补 store 没强制的变量
- 副作用散落在 4 个回调各清一遍互相救火
- 跨层通信用 useEffect 猜状态变化（应走显式 onStreamCommitted 钩子）
- 双通道竞态用时序赌（应用幂等 upsert/commit）

---

## 5. 重点关注（用户特别担心的，必须给复现场景）

### 5.1 Swarm 父子竞态

父 Agent 给多个子 Agent 派活，子 Agent report_back 时父 Agent 正在跑别的。给出具体复现步骤：

1. 触发条件（什么操作 / 什么时序）
2. 预期行为（消息应如何投递 / 父 Agent 应如何感知）
3. 实际行为（消息会丢吗 / 重复吗 / 死锁吗 / 父 Agent 会卡吗）
4. 证据（哪个文件哪行没处理这个时序）

不要泛泛说「可能有竞态」。

### 5.2 工具死循环

Agent 调一个一直失败的工具（如网络不通的 MCP / 一直返回错误的 API）。给出复现步骤：

1. 触发条件（哪个工具 / 什么错误）
2. 预期：应在 N 次后终止 / 计入失败预算
3. 实际：会无限重试吗 / 会耗尽 maxToolCalls 吗 / 会拖垮服务吗
4. 证据（reactLoop 哪行没把工具异常计入失败计数）

审批/ask_user 挂起后用户不回复：给出复现步骤 + 实际是否永远卡住 + TTL 是否生效。

### 5.3 工具设计合理性

逐个工具判断：description 是否足以让 LLM 在多工具场景下选对。重点对比：

- `send_email`（单向通知）vs `ask_user`（等待回复）：职责边界清晰吗？LLM 会乱选吗？能否指定收件人？
- `read_article` vs `scrape_web_page` vs `browser_screenshot`：三个读取类工具 LLM 怎么选？
- `agent_inspect` vs `agent_send_message`：父 Agent 看子 Agent 状态 vs 发消息，边界清晰吗？

给出「LLM 选错工具」的具体场景示例。

---

## 6. 开始

先执行 Phase 0。完成后把「项目骨架图 + 能跑/不能跑清单 + 残留嵌套/死代码/TODO 清单」发给我，等我确认再继续 Phase 1。

**记住：你的价值不在于发现问题的数量，而在于每个发现都经得起「删掉编排层补丁 bug 还复现吗」的检验。泛泛而谈的发现一律视为无效。**




