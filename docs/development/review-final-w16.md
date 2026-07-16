# KnowPilot v6（W16a~W16d）自审补跑报告（2026-07-16）

> 审查范围：`f0b02336..faf51bf6`（W16a 三 fix + W16a docs + W16b 三 fix + W16c compat-C6 + W16d 三 refactor + W16d docs，共 12 commits，全部已在 master / feat/delivery-reliability）。
> 审查方式：逐 commit diff 精读 + 关键源码通读 + 亲自实跑（pnpm lint / server 全量 vitest ×3 / 定向 vitest ×5 / grep 残留扫描 / test.db 只读查询）。未修改任何非 .md 文件，未做任何 git 写操作，未触碰 dev.db / content/（vitest 走独立 test.db + .test-content，与 dev.db 隔离）。
>
> **并发工作区披露**：审查期间有另一并行会话在本分支推进 delivery-reliability 新工作（工作区新增 `deliveryReliability.test.ts` 与 `index.ts`/`agentMessageLedger.ts`/`asyncJobManager.ts` 的未提交改动，均为纯追加——经 diff 核对，对 agentMessageLedger 仅新增 `rollbackAgentMessageDeliveredByTaskRef` 函数，**未触碰** W16a 既有记账逻辑）。本报告全部代码通读与 git diff/show 基于 **committed HEAD**；定向 vitest（实跑记录 #1~#5）均在并行改动落入工作区**之前**运行，反映 committed 状态；仅第三次全量跑（实跑记录 #6b）落在混合工作区（含并行新增的 4 例，44→45 文件差异即来源于此），其全绿对 v6 结论无负面影响（v6 自身测试文件未被并行改动）。

## 总结论：**通过**

必查 8 条全部通过：W16a 三个记账 bug 的修复在代码、测试、实跑三层全部成立（负向断言有效、13 例全绿）；W16b 渲染屏障测试设计密闭且实跑绿、字面量单源成立；W16c 终扫生产代码零命中、三项删除无残留；W16d 三项机制与测试成立；INV-1~8 无回归（三层 store v6 零改动）；零补丁抽查通过（v6 生产代码零新增 setTimeout/queueMicrotask/phase 守卫）。未发现 P0/P1。问题清单仅 1 项 P2 测试注水缺口（agentDrift 主用例增量段在 fresh 库不执行）+ 2 项 P2 观察项，均不阻塞。

---

## 必查清单逐项结论

### 1. W16a-1 deliveredAt 语义 —— ✅ 通过

**代码核对（同型五处全部落实）**：

| 位置 | 机制 |
|---|---|
| `agentMessageLedger.ts:48-61` | 拆两个 updateMany：`status:"delivered"` 分支 data 只写 `status:"consumed"`；`status:"pending"` 分支才补 `deliveredAt: new Date()` |
| `swarmBus.ts:185-195` / `redisSwarmBus.ts:135-146` | 同拆分；`fromDelivered.count > 0` 即返回，否则走 pending 分支；已 consumed/不存在为幂等 no-op |
| `services.ts:1774-1787`（consume()） | 同事务内同拆分，条件写在 where 里 |
| `services.ts:1737-1747`（shouldSkipSuperiorMirror 滞留兜底） | 先读后写改 `updateMany({ id, status: "pending" })`——竞态下不覆写并发 CLAIM 真账 |

**全仓 AgentMessage.deliveredAt 写入点审计**（`grep "deliveredAt:"` 逐点过筛）：写入点共 8 处——ledger:35（pending→delivered）、ledger:58 / services:1742 / services:1784 / swarmBus:195 / redisSwarmBus:144 / swarm.ts:798（均 pending 条件分支）、ledger:186（reconcile 只扫 pending）。**无任何 delivered→consumed 路径触碰 deliveredAt**。（heartbeatEngine/session/shell 的 deliveredAt 均为 Task 表另一本账，与 AgentMessage 无关。）

**测试断言**：`agentMessageLedger.test.ts:616-686` 负向断言覆盖 ledger/swarmBus/consume() 三路径——T1（真实投递时刻）落账 delivered，T2 consumed 后断言 `deliveredAt.getTime() === T1.getTime()` 且 status=consumed；:667-682 另断言 pending 直跳 consumed 仍兜底补齐（语义不退化）；:600-604（W14 第 8 例）delivered 落账捕获时间戳、consumed 后断言未改写。旧实现（`status in [pending,delivered]` 单 updateMany 覆写 deliveredAt）下 T1≠覆写后时间必红，负向断言有效。

**实跑**：`npx vitest run src/__tests__/agentMessageLedger.test.ts` → **13 passed**（见实跑记录 #1）。

### 2. W16a-2 waitForResult consumed —— ✅ 通过

**代码**：`swarm.ts:789-803`——`matchedInput?.deliverToQueue === false` 分支识别后直接把旁路邮箱 AgentMessage `update` 置 consumed、`deliveredAt = now()`（report_back 时刻，注释如实声明「tool return 交付发生在此刻」），跳过 notify/autoConsume。安全性核对：该 messageId 由本次 `bus.send` 新建（必为 pending），deliverToQueue=false 时 Task 永不 CLAIM、无并发 delivered 路径，直接 update 不会覆写真账；重复 report_back 是不同 messageId，互不影响。

**测试**：`agentMessageLedger.test.ts:688-732` 同步 spawn 全链路——断言终态 consumed、taskRef=jobId、deliveredAt ∈ [before, after]（report_back 时刻窗口）、父会话无同内容气泡（结果确走 tool return）。

**「存量对账零告警」机制性成立**：`reconcileAgentMessageLedger` 扫描集为 `where: { status: "pending", createdAt: { lt: before } }`（ledger:134-135）——consumed 终态天然不进扫描集，不可能被报滞留。测试 :722-728 进一步把 createdAt 回拨 2h 后实跑 reconcile，断言 `warnings` 不含该消息且状态保持 consumed。实跑绿（同 #1）。

### 3. W16a-3 taskRef 防伪造 —— ✅ 通过

**LLM 可见 schema 无 taskRef**：`swarm.ts:1137-1153`（agent_send_message / agent_report_back 的 zod schema 仅 toAgentId/content/messageType）；`buildNativeToolSchemas`（nativeTools.ts:105-118）直接由注册表 schema 生成 parameters，无二次注入点；全仓 `taskRef:\s*z\.` grep **零命中**。

**handler 不读 + 服务端强制写**：两个 handler 的 `bus.send` 调用均无 taskRef 字段（swarm.ts:615-626 / :642-653，附 W16a-3 注释）；`LocalSwarmBus.send` 落库 data 无 taskRef（swarmBus.ts:104-114），Redis 同；唯一写入点 = report_back 桥接找到跟踪 Task 后 `update({ data: { taskRef: jobId } })`（swarm.ts:778-786）。`AgentMessageInput.taskRef` 死字段已删（types.ts:87 仅剩读取侧 record 类型 `taskRef: string | null`，DB 列仍在，合理）。

**测试**：`agentMessageLedger.test.ts:734-803` 三层断言——① schema 层 `Object.keys(properties)` 不含 taskRef（两工具）；② agent_send_message 入参带 `taskRef:"w16a-forged-job"` → 落库 `taskRef === null`；③ agent_report_back 无桥接场景带伪造 taskRef → 落库 null。旧实现下①（schema 含 taskRef）②③（bus.send 透传 args.taskRef 原样留库）均红，负向断言有效。实跑绿（同 #1）。

### 4. W16b 渲染屏障 + 字面量单源 —— ✅ 通过

**断言方式核对**（chatSidebarRender.test.tsx）：
- 计数机制：vi.mock 把 WorkspaceSelect 换成计数桩——已核实 WorkspaceSelect 在默认视图（leftTab=history，isMain 无论真假）下**无条件渲染**（chatSidebar.tsx:336-343），故桩执行次数 === ChatSidebar 函数体执行次数，计数等价成立。
- Harness 复刻 ChatView 接线：订阅真实 `useStreamLifecycle` store + module 级引用稳定 props（镜像 chat.tsx 稳定化后形态）；10×50ms `setStreamingContent` 推 token。
- 对照组防空转：Harness commit 计数 ≥ 11（mount + beginStream + 10 tokens）且 echo 节点文本 = `token-10`，证明 10 次更新真实流过订阅链。
- 核心断言：sidebarBody === 1（仅 mount）。负向推导：摘掉 memo 后 ChatSidebar 随 Harness 每次重渲染执行 → 计数 ≥ 11 ≠ 1 → **必红**，断言能区分实现。
- 第二例：renameDraft prop 真变 → 计数 1→2，证明 memo 不过度阻塞。

**实跑**：`cd apps/web && npx vitest run components/__tests__` → **2 文件 4 passed**（chatSidebarRender 2 + assistantDriftBanner 2），见实跑记录 #2。

**memo 前提链核对**：chat.tsx 6 个消息列表回调 + handleSubagentCreated 全部 useCallback（:784-844/:520）；messageListProps useMemo 打包（:951-982，deps 26 项逐一对应）；mutation 只注入 observer 绑定的稳定 `.mutate`（:1020-1021/:1096-1097）；useChatConfig.updateConfig deps 改用 `.mutate`（lib/useChatConfig.ts:32-34）。chatMessageList/chatRightPanel/chatOverlays/chatSidebar 四组件 memo 确认；chatCenterPane 判定不包且理由写入文件头注释（它就是消息列表相关组件，memo 永不命中，加了只是误导）——判定正确。

**字面量单源**：`"__new__"` 字面量全 apps/web 仅剩 `chatKeys.ts:10` 一处定义；`kp:chat-lifecycle-states` / `kp:chat-compose-states` 同；6 个消费文件（chat.tsx / chatCenterPane / chatSidebar / useChatEnqueue / useChatQueueDrain / useChatRunStream）全部 `import ... from "@/lib/chatKeys"`，grep 实证零重复硬编码。useChatDerivedQueues 的 `getConsumedDeliveries` 取值守卫（`data?.consumed ?? []`）与原两份 inline cast 行为等价。

### 5. W16c 终扫 —— ✅ 通过

**grep 终扫**（`兼容旧|向后兼容|deprecated|旧格式|legacy|LEGACY|backward`，-i，范围 apps/ + packages/）：
- 唯一命中 = `agentFactory.test.ts:172-209` 测试 fixture 局部变量 `legacy`（「老库形态 assistant」漂移检测夹具，正是 resolveAgent 只读化 drift 检测的测试目标）——与 a1d1becb commit 声明的已知例外逐字一致，评估：**非兼容层代码，合理保留**。
- `兼容` 单词补扫：仅 2 处命中，均为「零兼容纪律」的纪律注释本身（async-task-queue.test.ts:423、swarm.ts:730），非兼容层。
- packages/ 零命中。

**三项删除无残留**：
- `globals.css` `--vp-c-*`：源码零命中（grep 计数 0）；web 侧 .tsx/.ts/.css 零引用——仅 `.next/dev/` 旧构建缓存命中 14 行（stale build artifact，非源码，下次 build 自消，不计残留）。
- agentRuntime re-export trio：`agentRuntime.ts` 现仅导出 runAgentLoop/runAgent/chatAgent + 类型；trio 唯一定义在叶子 `loop/setup.ts`，消费者全部直连，无任何文件从 agentRuntime import trio（grep 实证）。
- `scripts/fix-agent-message-ledger.ts`：文件不存在；`package.json` 无 `fix:agent-message-ledger` script；对账核心 `reconcileAgentMessageLedger` 已在 `infra/agentMessageLedger.ts` 并由测试直连。

**W16a/W16b 删除的旧字段/旧路径残留引用**：零（见第 3、4 条 grep 记录）。

### 6. W16d 三项 —— ✅ 通过（附 2 条任务描述澄清，1 个 P2 测试缺口见问题清单）

**① 中间正式回复进导轨（e2e 断言核对）**：`chat-intermediate-content-mock.spec.ts` 断言具体——`intermediate-content-step` testid 可见 + 含文案「我将先搜索」+ assistant 气泡恰 1 个 + 最终答案在独立气泡（expectAssistantAnswer "已完成工具调用"）。**能区分实现**：若无 intermediate_content → 导轨映射机制，testid 不存在，`toBeVisible({ timeout: 15_000 })` 必红；非恒真断言。
⚠️ **澄清**：该 e2e 与机制属 **pre-existing**（`c2388c68`「feat(chat): 中间正式回复进左侧导轨」，已验证在 v6 基线 `f0b02336` 之前）。W16d-1（b17e128b）实际落地的是「**反思 verdict → `__reflection__` 伪工具条进 ThinkingTimeline**」（SSE reflection 事件 → lib/agentStream.ts 映射 onToolStart/onToolEnd，复用 `__content__` 同一伪工具模式 + toolIcons ShieldCheck + chatTimelineSteps 标签「反思复核」）。任务描述把 pre-existing 机制归入 W16d-1，特在此校正——W16d-1 的真实覆盖是 server 侧 reflection.test.ts 4 新例（onReflection 两事件 retry→marked、followUp 抢先 verdict 不消费、stream 端到端开启全覆盖、默认关零反思），实跑 **9 passed**（实跑记录 #3）。

**② suspended 持久化**：2f7cc9c3 diff 精读确认——挂起态落库 `Agent.heartbeatSuspendedAt`（schema +1 列）；`suspendHeartbeat` 改 `updateMany({ heartbeatSuspendedAt: null })` 幂等写（保留首次熔断时刻）；`triggerHeartbeat` 改查 DB（`agent.heartbeatSuspendedAt` 跳过）；内存 `suspendedAgents` Set 删除（全仓 grep 零命中）；恢复两条显式路径——(a) AgentService.update 检测 heartbeat.enabled/cron/goal/heartbeatModel **值确实变化**才清零 consecutiveFailures（原样保存不清零，有专测），refresh() 个体化摘除计数已清零者、不再连坐恢复；(b) `resumeHeartbeat` 手动摘标记。circuitBreaker.test.ts 扩充用例覆盖「落库 / refresh 不连坐 / 新引擎实例重启不失 / 配置变更清零后个体化摘除 / resume 不清计数立即重熔断 / 原样保存不清零」，实跑 **12 passed**（实跑记录 #4）。
⚠️ **澄清**：任务描述称「ChatSession 挂起态落库」——实为 **Agent 心跳熔断暂停态**（heartbeatSuspendedAt 在 Agent 行），与 ChatSession 无关；AGENTS.md W16d 段落口径正确。

**③ drift 横幅**：组件 drift 为空渲染 null、非空渲染漂移项 + 迁移脚本提示（assistantDriftBanner.tsx）；tRPC 只读通道 `agent.driftStatus`（router.ts:154-160，aiReadable）；`getAssistantDriftStatus` 不创建不修改、assistant 不存在返回 `agentId=null` 绝不引导创建（agentResolver.ts:106-133，与 resolveAgent 的创建路径严格分离）；/agents 页挂载（agents/page.tsx:628-635，staleTime 60s）。测试 assistantDriftBanner.test.tsx 2 例 + agentDrift.test.ts 2 例，实跑全绿（实跑记录 #2/#5）。迁移脚本 `migrate-assistant-tools.ts` 存在。**测试缺口见问题清单 P2-1**。

### 7. INV-1~8 无回归抽查 —— ✅ 通过

- **INV-1（done→idle 唯一经 commitStream）**：`git diff f0b02336..faf51bf6 -- apps/web/lib/useStreamLifecycle.ts` **空**——三层 store（+ useSessionMessages / useSessionComposeState）v6 全程零改动，reducer 强制点未被触碰。
- **INV-8（drain 单驱动四事件）**：reducer 零改动；chat.tsx 的 drain 订阅 effect（:736-752 心脏区）、队列水合 effect、mount 恢复 effect 在 v6 diff 中**仅注释文本变化**（W16b-3 两处 runStreamRef 注释如实化），effect 体与触发链零改动；useChatEnqueue/useChatQueueDrain/useChatRunStream 的 v6 diff 逐行核对 = 纯字面量换 import（各 ±1-3 行），行为零变化。
- **INV-4（渲染单一所有权）**：chatMessageList 的 v6 diff = memo 包装 + eslint 注释调整 + 文件头注释，渲染逻辑（inFlightAssistantId 屏蔽、liveTimeline 独占）零改动。

### 8. 零补丁抽查 —— ✅ 通过

- **queueMicrotask**：Chat 编排层仅 1 处（chat.tsx:746，drain 订阅重入边界）——注释如实声明「onStreamCommitted 在 dispatch 同步栈内触发，microtask 是重入边界，不是时序猜测补丁——删掉它任何场景都不丢」。其余命中（subagentCreateDialog ×2 / PageSearch ×2 / Sidebar ×1）均为 pre-existing 且 v6 零改动、与 Chat 状态机无关。server 侧零命中。
- **v6 全 diff 新增 `setTimeout|queueMicrotask|await hydrate|phase ===` 扫描**：唯一命中 = 测试文件 chatSidebarRender.test.tsx:159 的 50ms token 推送间隔（模拟流式更新，正当用途）。**生产代码零新增时序猜测**。
- W16d-1 的 verdict 消费点收在 reactLoop 内核 done 转移点、`onReflection` 显式事件钩子透传（types.ts LoopHooks 注释「跨层通信走显式事件」）——符合「跨层通信走显式事件」纪律，非 useEffect 状态猜测。

---

## 问题清单

### P2-1（建议修）agentDrift.test.ts 主用例漂移增量段在 fresh 测试库从不执行——用例名与实际覆盖不符

- **位置**：`apps/server/src/__tests__/agentDrift.test.ts:23-60`。
- **现象**：用例名声称「制造漂移后 drift 增长并点名缺失工具，恢复后回到基线」，但 `:30-35` 的 early return 分支（`if (!before.agentId) return;`）在 fresh 测试库必命中——`.test-content` 为空、`getAssistantDriftStatus` 只读不创建，assistant 不存在 → `agentId=null` → 直接 return。:38-59 的核心增量断言（制造漂移 → drift 增长点名缺失工具 → 恢复基线）**从未执行**。
- **实证**：实跑 agentDrift.test.ts 后对 test.db 只读查询 `agent where name='assistant'` → **count=0**（实跑记录 #7）；vitest 单 fork 字母序 agentDrift 排在所有可能创建 assistant 的测试文件（agentFactory/trpc 等）之前，全量跑同样走 early return。
- **根因**：用例依赖环境前置态（assistant 存在）却不自建 fixture——fresh 库下静默降级为「null 语义冒烟」，覆盖了了。
- **修复建议**：用例内自建 fixture（`services.agent.create` 一个 name=assistant 且带 ASSISTANT_DEFAULT_TOOLS 的 Agent，或用例首行断言 `before.agentId` 非空倒逼 fixture），跑增量段后 finally 清理。
- **可否负向断言**：可以——在 early return 分支加 `expect.unreachable("fresh 库必须有 assistant fixture")` 或直接在 fixture 后断言 agentId 非空；旧形态（无 fixture）必红。
- **不阻塞理由**：server 侧 drift 检测逻辑本身已被 agentFactory.test.ts 的 drift 用例（legacy 夹具）覆盖；通道的 null 语义分支（管理页零写副作用承诺）恰是当前唯一被执行的部分且断言有效。

### P2-2（观察项，pre-existing 测试基建）连续高密度跑 vitest 时 globalSetup 与 Windows 句柄释放竞争，偶发冷启动失败

- **现象**（本次实跑亲历，见实跑记录 #6）：连续多轮 vitest 后，① 单独跑 trpc.test.ts 连续 2 次 globalSetup 的 `prisma db push` 炸（`no such table: search_fts_config`，DropTable）——globalSetup 注释自承「删除旧 test.db 避免 FTS 虚表残留」，而 `fs.rmSync` 失败被 catch 吞掉后 db push 必炸；② 首次全量跑 trpc.test.ts 的 about profile 用例 ENOENT `.test-content/about/profile.md`。间隔约 1 分钟后第三次全量跑 **45 文件 465 passed 全绿**。
- **定性**：globalSetup.ts / trpc.test.ts / FTS 相关代码在 v6 范围**零改动**（git diff 实证），与 v6 无关的 pre-existing 基建 flake；与 v7/v8 报告记录的 async-task-mock:17 冷启动 flake 同族（Windows 文件句柄释放滞后 + rm 失败静默）。
- **建议**（非本工单必修）：globalSetup 的 rm 失败时至少 console.warn（当前静默吞），或对 rm 加 retry。

### P2-3（观察项）W16d-1 前端 `__reflection__` 映射路径无 web 侧测试

- **位置**：`apps/web/lib/agentStream.ts:108-123`（reflection SSE → onToolStart/onToolEnd 伪工具条）。
- **现状**：server 侧 SSE emit 已由 reflection.test.ts 端到端覆盖（含 `events.some(e => e.type === "reflection")` 断言）；前端映射复用 compact 事件同款已验证模式，结构简单（纯字段透传 + 两处 callbacks 调用），风险低。
- **建议**：后续可在 web 组件测试补一例「reflection SSE → ThinkingTimeline 出现反思复核步骤」（与 chatSidebarRender 同基建，jsdom + createRoot）；不阻塞本结论。

---

## 任务描述与实际核对（澄清项，非项目问题）

1. 任务描述称 W16d-1 =「流式期中间正式回复进左侧导轨」——实际 = **反思 verdict 进时间线**；「中间回复进导轨」机制与 e2e 为 pre-existing（c2388c68）。项目产物无误，已在第 6① 条校正口径。
2. 任务描述称 W16d-2 =「ChatSession 挂起态落库」——实际 = **Agent.heartbeatSuspendedAt**（心跳熔断暂停态），与 ChatSession 无关。AGENTS.md 口径正确。
3. AGENTS.md 计数口径时点差异（说明项，非错误）：W16a 段落称 agentMessageLedger.test.ts「9 → 12 例」为 v6 落地时口径；当前实跑 **13 例**（v8 `0c0aa370` 追加「桥接零模糊兜底」1 例）；W14 段落「9 例」为更早时点口径。同文档不同段落各记各时点，可接受。

---

## 实跑验证记录（亲自运行，非转述）

| # | 命令 | 结果 |
|---|---|---|
| 1 | `cd apps/server && npx vitest run src/__tests__/agentMessageLedger.test.ts` | EXIT=0；**13 passed**（含 W16a-1 负向断言三路径、W16a-2 waitForResult 全链路 + reconcile 零告警、W16a-3 taskRef 三层伪造断言） |
| 2 | `cd apps/web && npx vitest run components/__tests__` | EXIT=0；**2 文件 4 passed**（chatSidebarRender 2 例：流式期函数体仅 1 次 + prop 真变正常重渲染；assistantDriftBanner 2 例） |
| 3 | `npx vitest run src/__tests__/reflection.test.ts`（apps/server） | EXIT=0；**9 passed**（含 W16d-1 stream 端到端开启全覆盖 / 默认关零反思） |
| 4 | `npx vitest run src/__tests__/circuitBreaker.test.ts`（apps/server） | EXIT=0；**12 passed**（含 suspended 落库 / 不连坐 / 重启不失 / 原样保存不清零） |
| 5 | `npx vitest run src/__tests__/agentDrift.test.ts`（apps/server） | EXIT=0；**2 passed**（注意：主用例走 early return 分支，见 P2-1） |
| 6 | `pnpm lint` | EXIT=0（shared/server tsc --noEmit + web eslint 全过） |
| 6b | `pnpm --filter @knowpilot/server test` ×3（回归兜底） | 第 1 次 460 passed/1 failed（about profile ENOENT）；第 2 次 trpc.test.ts 1 failed（同族）+ globalSetup db push 句柄竞争；间隔后第 3 次 **45 文件 465 passed 全绿**——定性为 pre-existing 基建 flake（P2-2），非 v6 回归。注：第 3 次落在并行会话改动后的混合工作区（45 文件含其新增 `deliveryReliability.test.ts` 4 例；前两次 44 文件 461 为 committed HEAD 口径），v6 自身测试文件未被并行改动，全绿结论对 v6 有效 |
| 7 | test.db **只读**查询（node prisma，`name='assistant'`） | count=0——实证 P2-1：agentDrift 主用例增量段未执行 |
| 8 | grep 残留扫描 | `taskRef:\s*z\.` 零命中；`"__new__"` 字面量仅 chatKeys.ts 1 处；`--vp-c` 源码零命中（仅 .next 旧 build 缓存）；agentRuntime trio re-export 零命中；fix-agent-message-ledger 文件与 script 均不存在；`兼容旧/向后兼容/deprecated/旧格式/legacy/backward` 生产代码零命中（唯一例外 = agentFactory.test.ts fixture 变量，已评估） |
| 9 | `git diff f0b02336..faf51bf6` 逐文件精读（47 文件，+1445/-409） | 全部改动可映射到已声明工单（W16a×3+docs / W16b×3 / W16c / W16d×3+docs），**无夹带**；三层 store 零改动；生产代码零新增 setTimeout/queueMicrotask/phase 守卫 |

---

## 零兼容违规终查

逐项核对零兼容铁律（改接口就改所有调用方 / 禁兼容 re-export / 一次性脚本执行完即删）：

1. `AgentMessageInput.taskRef` 死字段已删，bus.send 双实现（Local/Redis）落库同批不再写 taskRef——无「接受但忽略」兼容分支（handler 注释明示「LLM 传了也无效，不留接受但忽略」）。
2. agentRuntime re-export trio 删除后消费者全直连 `loop/setup.ts`，无 re-export 残留。
3. 一次性脚本 `fix-agent-message-ledger.ts` 执行 0 命中后物理删除 + package.json script 移除 + 对账核心迁入叶子模块——教科书式执行「执行完即删」。
4. `resumeHeartbeat`/`isHeartbeatSuspended` 签名 sync→async，调用方（仅 circuitBreaker.test.ts）同批改完，无旧签名残留；生产代码无这两个方法的调用方（纯管理/观测通道）。
5. schema.prisma +1 列走 db push（SQLite 缓存层纪律），无「旧格式兼容读分支」。

**零命中违规。**

---

> 审查人：自审补跑 Agent（subagent，只读权限）。本报告 `docs/development/review-final-w16.md` 为唯一产出物；8 条必查全部闭环，P2-1 建议修、P2-2/P2-3 登记观察。
