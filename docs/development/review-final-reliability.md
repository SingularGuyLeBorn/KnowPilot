# KnowPilot v9「投递可靠性 + 重启恢复 + 历史闭环」终审报告（2026-07-16）

> 审查范围：`master(f375b1f9)..HEAD`（feat/delivery-reliability，7 commits：5a410784 / 899978d3 / b535d716 / 56bb100e / f2385ea1 / 7da7c20f / 162a49dd，14 文件 +1533/-87）。
> 审查方式：逐 commit diff 精读 + 关键源码通读（asyncJobManager 全部 v9 改动面 / agentMessageLedger / swarm.ts requeueOrphanedSuperiorDrains / index.ts 启动序列）+ 亲自实跑（lint / server 全量 vitest ×5 / 定向 vitest ×5 / web vitest / mock e2e 全量 / grep 防线扫描 / test.db 只读查询 / vitest 排序器实证）。未修改任何非 .md 源文件，未做任何 git 写操作，未动 dev.db / content/（vitest 走独立 test.db + .test-content，与 dev.db 隔离；mock e2e 按仓库既定流程 build:mock → 跑完恢复普通 build，端口与进程已确认无残留）。

## 总结论：**有条件通过**

R-1/R-2 两条主链路（S3 两层闭环、重启恢复四动作）在代码、测试、实跑三层全部成立：回滚只有两个调用点且各自有「确定未写消息 / ground truth 无气泡」前置守卫，不存在「消息已写入却回滚」的重复投喂面；reconciler 的不变量（孤儿必被补投）收在执行层的条件写 + ChatMessage ground truth，不靠时序自觉，删掉周期调用后启动首扫仍在；v7/v8 核心语义零回归（asyncJobOrchestrator / apps/web 在 v9 均零改动）；R-3 历史闭环（stash/PLAN_STATUS/两个假绿测试/v6 补审）逐条亲验属实。

**通过条件（1 条，必修）**：
1. **S1（P1）**：`7da7c20f` 修复的 agentDrift 测试对共享 test.db 全局状态非密闭，全量套件间歇性红——本人 5 次全量实跑中 1 次确认 agentDrift 2/3 挂（另有 1 次 exit 1 细节丢失疑同因），声明基线「server 46 文件 469 passed」不可稳定复现。修法小（beforeEach 清 assistant），修好后本结论升级为「通过」。

**登记不阻塞**：S2（同轮 Pass1+Pass2 对同一 jobId 双 notify，幂等无害）、S3（>60s 气泡写入 stall 的理论重复投喂残窗，设计权衡内）、S4（started=true 后抛错路径无专测，被 T2 间接覆盖）。

---

## 必查 8 条逐项结论

### 1. S3 是否真的堵死 —— ✅ 通过（附 S3/S4 登记）

**① 抢线路径（started=false）**：`autoConsumeAsyncDelivery` 的 execute 内（asyncJobManager.ts:394-421），`startIfNotRunning=false` 走 else 分支：`requeue = await rollbackAsyncDeliveryClaim(jobId)`（:409）→ 成功则 warn 日志 + `enqueueSessionAutoConsume(sessionId, consumeWork)` 重挂链尾（:434-436）。**实跑 T1 确认真实发生**：stderr 亲眼见到「autoConsume 被抢线（started=false），已回滚 delivered 并重挂链尾」，`startSpy.mock.calls.length >= 2`（首轮 false + 重排队新一轮），最终气泡注入且携带 `toolResults.subagentResult.jobId` 台账。旧实现无 else 分支 → chatAgentStream 永不被调用 → waitFor 超时必红（负向断言成立）。

**② 抛错路径（started=true 后 chatAgentStream 中途抛错）**：catch 块（:413-421）只 warn 留痕并 `throw err`，**不回滚**——注释如实写明「无法判定消息未写入，回滚会导致重复投喂，留 reconciler 对账」。宁漏勿错原则在代码层落实。该路径无专测（S4 登记），但其产物（delivered=true 无气泡孤儿）恰是 T2 的构造，reconciler 兜底已被 T2 覆盖。

**③ 重启路径（CLAIM 与注入之间进程死掉）**：孤儿由 reconciler Pass 1 回收——T2 实证：delivered=true 无气泡 → 一轮 `rolledBack=1 / renotified=1` → 补投走正常 notify/autoConsume 管道注入气泡 → 二轮幂等零动作 → 气泡有且仅有 1 个。启动首扫 `runStartupRecovery` 动作 4 与周期扫 `startAsyncDeliveryReconciler` 共用 `reconcileAsyncDeliveries` 同一入口（asyncJobManager.ts:746），重启场景双保险。

**重复投喂面逐点推演（`rollbackAsyncDeliveryClaim` 全仓仅 2 个调用点）**：
- 调用点 1（:409，started=false 分支）：runner/chatAgentStream 确定未执行（startIfNotRunning 是 hub 内原子 check-and-start），消息必然未写入——回滚安全。
- 调用点 2（:604，reconciler Pass 1）：前置 ground truth 检查（json_extract 无气泡）+ 60s 超龄过滤 + 条件写（落选即放弃）。唯一残窗 = 「runner 已 started 但气泡写入 stall >60s」（见 S3 登记）——正常路径下 CLAIM→`message.create`（agentStream.ts:530，位于 LLM 调用前）为毫秒级，60s 阈值把该窗口压到病态 stall 才触发，属设计明示的权衡。
- 账本对称性：`rollbackAgentMessageDeliveredByTaskRef`（agentMessageLedger.ts:71-80）只命中 `status="delivered"`，已 consumed 绝不回滚；与 CLAIM 同事务执行。✓

### 2. reconciler 幂等性 —— ✅ 通过（附 S2 登记）

- **连跑多轮一致**：T2 第二轮 `rolledBack=0 / renotified=0 / skippedHasMessage>=1`；T3 默认阈值连跑三轮全部 `rolledBack=0 / renotified=0`，且 consumed 账本 `deliveredAt` 真账原值不动、在途（deliveredAt 新鲜）记录原值不动、chatAgentStream 从未被触发（零误伤实证）。
- **过滤条件逐一核对**（:558-567 查询 + :577 continue）：终态 `status in [success,failed]`、`delivered=true`、`pinned=false`、`deliveredAt < cutoff`（默认 60s，:523）、`deliverToQueue !== false` 跳过（同步任务走 tool return）、ground truth 气泡检查（`json_extract(toolResults,'$.subagentResult.jobId')`，toolResults 为 NULL 时 json_extract 返回 NULL 天然不命中——注释与 SQLite 语义一致）。✓
- **竞态原子性**：回滚 = `updateMany where {id, delivered:true}`（:276-279）；正常消费/前端 ack = `updateMany where {id, delivered:false, pinned:false}`（:380-384）——两个条件写在同一行上互斥（同一时刻至多一个命中），SQLite 单写者串行化，无丢失更新。T4 实证三时序：回滚前 ack 必输 → 回滚后 ack 必赢 → 补投链恢复后 CLAIM 落选不注入 + 二次 ack 幂等拒绝。
- **BATCH_LIMIT 超限不漏**：`orderBy deliveredAt asc, take: limit`（limit clamp 1..500）；被处理行状态改变（delivered→false）自动离开候选集，下轮从队首继续，无需 offset 分页，不漏不重。Pass 2 中因会话占线仍未被 CLAIM 的行会留在候选集每轮重 notify——幂等（CLAIM 落选），且消费链排队项受 `consumeQueuedTimeoutMs` 约束会超时脱落，链长有界。
- **S2 登记**：T2/T4 stderr 实证同一轮内 Pass 1（回滚后补投）与 Pass 2（该行此时 delivered=false 且 finishedAt 超龄/为 NULL）对同一 jobId 各补投一次——双 notify 均走 CLAIM 互斥，不产生重复气泡（T2 末断言气泡恰 1 个），纯浪费一次 notify+log，P3 微。

### 3. 重启恢复四动作 —— ✅ 通过

- **C1（动作 1+2）**：预置 running/queued 僵尸 Task×2 + running 会话（含 stale 子会话）→ 首扫后：Task failed 且 error 含「服务重启」、`startedAt` 保持 null（不自动重跑实证：无新 run/新任务）、子会话同步 failed、僵尸会话 paused（`zombieSessionsPaused=1`）；**连跑第二次计数全零**（幂等实证）。新鲜终态任务（未超龄）零误伤。
- **C2（动作 4）**：超龄未投递终态 → `renotifiedUndelivered=1` → 管道 CLAIM + 气泡注入 + jobId 台账；`deliverToQueue=false` 同步任务 `scannedUndelivered` 计入但 `renotifiedUndelivered` 不含、delivered 恒 false（不误投）。
- **C3（动作 3）**：superior 孤儿队列项 → `superiorDrainsRegistered=1` → drain 自动 consume（删除即认领）→ prepareAgentRun 写 user 消息 + MOCK_LLM 起流跑完 → AgentMessage 账本 consumed → 会话生命周期 running→paused→running→completed 全链实证。
- **负向性**：三例断言的恢复函数在旧实现（master）不存在/不处理对应项 → import 失败或状态断言必红；commit message 另声明「stash 三生产文件后 3/3 全红，恢复全绿」，与断言构造推演一致。
- **不自动重跑理由在代码注释**：asyncJobManager.ts:716-720「tool 任务有副作用（写文件/发请求），进程死亡时执行进度未知，盲目重跑可能重复执行；retryAsyncJob 保留手动重试」；测试 :195 注释同义复述。design-decisions Q2 决策理由第 1 条完整记录。✓
- **DB ground truth**：四动作全部条件写（updateMany/deleteMany 认领），顺序敏感点（先动作 2 全体 paused 再动作 3 drain 重注册会置回 running）注释写明且 C3 实证终态正确。

### 4. v6 闭环 —— ✅ 通过（P2-1 已修，但其修复引入 S1）

- **review-final-w16.md 存在且结构可信**：8 条必查 + 问题清单 + 实跑记录 + 零兼容终查齐全；其对 P2-1 的假绿定性（fresh 库 early return 增量段从不执行）与本人读的旧版代码（master 形态）一致。
- **抽查 3 条「通过」项亲自复验**：
  - **W16a-1（deliveredAt 语义）**：同型五处逐点核对——agentMessageLedger.ts:52-60（delivered 分支 data 只写 status）、swarmBus.ts:185-196 / redisSwarmBus.ts:135-146（同拆分 + fromDelivered.count>0 即返回）、services.ts:1774-1790（consume 同事务拆分）、services.ts:1738-1745（shouldSkipSuperiorMirror 条件写在 where）。全仓 `deliveredAt:` 写入点无 delivered→consumed 覆写路径。✓
  - **W16a-3（taskRef 防伪造）**：`taskRef:\s*z\.` 全 apps grep **零命中**（LLM schema 不可伪造）；swarm.ts:784-803 report_back 桥接血缘键 `$.subagentSessionId` 精确匹配为唯一方式，:802 零兼容注释在案。✓
  - **W16c（终扫零命中）**：`兼容旧|向后兼容|deprecated|旧格式|legacy|LEGACY|backward`（-i，apps/ 全量）唯一命中 = agentFactory.test.ts:172-209 的 fixture 局部变量 `legacy`（漂移检测夹具，合理例外，与 w16 报告结论逐字一致）；「兼容」单词补扫 2 处均为零兼容纪律注释本身。✓
- **P2-1 修复确认（7da7c20f）**：主用例自建 assistant fixture（`name:"assistant"` + 全量 ASSISTANT_DEFAULT_TOOLS），`expect(before.agentId).toBeTruthy()` + `expect(before.drift).toEqual([])` 基线硬断言 → 摘工具制造漂移 → `after.drift` 增长且点名缺失工具 → 恢复回基线；增量段**真实执行**（单跑 3/3 绿，44ms 用例体非 early-return 形态）；null 语义拆独立用例。**但**该修复引入全量套件隔离缺陷——见 S1（P1）。

### 5. stash/PLAN_STATUS 处置属实 —— ✅ 通过

- `git stash list` **为空**（审查开始与结束各查一次，均空）。
- `PLAN_STATUS.json` 文件不存在；`git log --all --oneline | grep -i plan_status` 2 命中均为本次删除相关 commit；b535d716 diff = 纯 17 行删除。
- commit message 的 5 标识对照抽验 2 个：`saveChatStoresToStorage` 在 useChatRunStream.ts:29 定义（:111 调用，与 message 逐字一致）；`onKeyDown` 在 chat.tsx:646 定义、:652 addEventListener（message 标 :652，指注册行，属实）。

### 6. 两个假绿测试真跑 —— ✅ 通过

- **nativeTools.test.ts**：`hasGitBinary()` 探测 git 二进制（execFileSync git --version，try/catch），`initTempGitRepo` 公共夹具临时目录自建仓库。实跑 **96 passed / 0 skipped**（输出亲眼见 git_branch/git_checkout 用例执行耗时 326ms 级——真跑非 skip）。56bb100e 声明的「恒 skip→真跑」修复链属实。
- **resilientLlmClient.test.ts**：恒真断言 `typeof content === "string" || content === null` 已替换为确定文案 + provider + finishReason 三断言（`toBe("你好！我是 Mock LLM，正在为你服务。")` 等）——错误文案/未直通 mock/返回 null 均必红，区分度成立；beforeEach/afterEach 清 MOCK_LLM_SCENARIO 防污染。实跑 **14 passed**。

### 7. 零兼容纪律与 INV-1~8 抽查 —— ✅ 通过

- **reconciler 不是时序补丁**（核心判定）：不变量「孤儿必被补投」由执行层保证——①扫描以 DB 状态为准（不是「猜某时序窗口」）；②回滚是条件写原子操作（与消费方互斥在 DB 层）；③ground truth 是 ChatMessage 存在性（不是「等一会儿再看」）。**删掉 `startAsyncDeliveryReconciler` 的 setInterval 周期调用**（编排层）：启动首扫仍在（runStartupRecovery 动作 4 + startAsyncDeliveryReconciler 挂载时的立即 `runRound()`，index.ts:261/:299），重启后孤儿仍被回收——不变量不依赖周期调用存在。周期扫只影响「运行期新产生孤儿的回收时延」，不影响正确性。判定：状态机式对账，非补丁。✓
- **兼容关键词**：生产代码 `兼容旧|向后兼容|deprecated|旧格式|legacy|backward` 零命中（见第 4 条）。✓
- **queueMicrotask**：Chat 编排层仅 chat.tsx:746 一处（drain 订阅重入边界，:742-746 注释如实声明「onStreamCommitted 在 dispatch 同步栈内触发，microtask 是重入边界」）；其余命中（PageSearch×2/subagentCreateDialog×2/Sidebar×1）均 pre-existing 且与 Chat 状态机无关；server 侧零命中。✓
- **INV-1（done→idle 唯一经 commitStream）/ INV-8（drain 收口）**：`git diff master..HEAD --name-only -- apps/web` = **0 文件**——三层 store、chat.tsx、useChatQueueDrain 全部零改动，INV-1/8 在 v9 无回归面。✓

### 8. v7/v8 成果无回归 —— ✅ 通过

- **diff --stat 全量精读**（14 文件）：全部可映射到 R-1~R-4 声明范围，无夹带；`asyncJobOrchestrator.ts` **0 行改动**（确认）；`apps/web` **0 文件**；`session.ts` 未在清单（血缘槽位/inline 路径零改动）。
- **v7 核心语义**：`async_task_wait` 生产代码零命中（仅 async-task-queue.test.ts:123-133 负向断言）；`deliverToQueue===false` 过滤/旁路 12 处齐全（autoConsume skip :309、两处 pull :587/:640、两处 list :908/:933、:972/:1021、:1077、notify 三处 :1267/:1314/:1355、:1625）；W-E drain 的 `enqueueSuperiorQueueDrain` v9 仅加 `source` 字段透传（:243，纯追加，供 R-2 重建发送方上下文）；两级分组/右栏三组 = web 零改动。
- **v8 核心语义**：池容量判定唯一在 orchestrator（零改动）；`runConsumeJob` 零改动；autoConsume 的 CLAIM 同事务 W14 记账逐字保留（:378-388，`updateMany delivered:false→true` + `markAgentMessageDeliveredByTaskRef` 同 $transaction，落选 count=0 静默 return）。
- **既有测试全绿**：全量 469 passed（绿轮次）含 W14 账本、T7 drain、50 spawn 压测等 v7/v8 断言原样通过。

---

## 发现的问题清单

### S1（P1，必修）agentDrift.test.ts 对共享 test.db 全局状态非密闭 → 全量套件间歇性红

- **位置**：`apps/server/src/__tests__/agentDrift.test.ts:24-33`（null 用例）+ `:36-56`（fixture 用例）。
- **实证**（本人 5 次全量实跑）：run#3 agentDrift **2 failed**——null 用例 `expected 'cmrmuotu4019rwbyg3i8xdzx9' to be null`（库中已存在 assistant）；fixture 用例 `创建 agent 失败：name "assistant" 已被其他记录占用`（唯一约束）。run#1 exit 1（尾部输出细节丢失，疑同因）。run#2/#4/#5 全绿（469 passed）。单跑本文件 5 次全绿（fresh 库只含自身数据）。
- **根因**：7da7c20f 把「状态容忍的 early return」换成「状态敏感的硬断言 + 硬创建」，两个用例都依赖「库中不存在 name=assistant 的 Agent」这一**全局前置态**，却不自建也不自清：null 用例直接断言 `agentId===null`；fixture 用例硬创建 name=assistant。而该前置态在全量套件不受控——①共享 test.db 跨文件污染是本套件已知现象（agentFactory.test.ts:170 注释自证「清理其他测试文件可能创建的默认 assistant」，trpcSmoke/trpc 的 agent.chat 链路 resolveAgent 会创建默认 assistant）；②用例注释声称的「字母序在会创建 assistant 的文件之前」假设，被 run#3 实证不成立（无论机制是执行序变化还是 globalSetup rm 静默失败——P2-2 已登记的 Windows 句柄竞争——导致 stale DB）；③globalSetup 的 `fs.rmSync` 失败被静默 catch（P2-2），陈旧 test.db 可把上一轮遗留 assistant 带进本轮。假绿修好了，但引入了 flake：旧形态任何状态下都绿（所以是假绿），新形态在污染态下必红。
- **修复建议**：两例改密闭——describe 级 `beforeEach` 加 `await prisma.agent.deleteMany({ where: { name: "assistant" } })`（null 用例获得确定的前置态，fixture 用例避免唯一约束撞车；fixture 用例的 afterEach 清理已有）。改法两行，语义不变且更强：null 用例从「赌环境干净」变「自己保证干净」，负向性反而更硬。
- **可否负向断言**：可——预置一个 assistant 行后跑本文件：旧形态（现状）红，修复形态绿。
- **不阻塞主链路理由**：纯测试隔离缺陷，生产代码零牵连；但它直接破坏本工单声明的「server 469 passed」基线可信度与 CI 稳定性，故定 P1 必修。

### S2（P3 微，登记）reconciler 同轮 Pass1+Pass2 对同一 jobId 双 notify

- **位置**：`asyncJobManager.ts:604-611`（Pass 1 补投）与 `:634-656`（Pass 2 补投）。
- **现象**：Pass 1 回滚 delivered→false 并补投后，同一轮的 Pass 2 扫描（`delivered=false` 且 `finishedAt` 超龄或为 NULL 且 `createdAt` 超龄）再次命中同一行 → 第二次 notify。实跑 T2/T4 stderr 亲眼见两条补投日志（`补投 jobId=X（delivered 回滚…）` + `补投未投递终态 jobId=X`）。
- **影响**：无正确性影响——两个 autoConsume 在同一 per-session 串行链上，CLAIM 互斥保证至多一个注入（T2 末断言气泡恰 1 个实证）；代价是每轮每孤儿多一次 notify + SSE async_delivery 事件 + 一行日志。
- **修复建议**（可选）：Pass 2 查询加 `deliveredAt: null` 条件不够（回滚已清空 deliveredAt，仍命中）；更干净的是 Pass 1 收集已补投 jobId 集合，Pass 2 循环内跳过。
- **可否负向断言**：可（单轮 renotify 计数断言）。

### S3（P3 微，登记·设计权衡内）>60s 气泡写入 stall 的理论重复投喂残窗

- **位置**：`reconcileAsyncDeliveries` ground truth 检查（:586-594）与回滚（:604）之间的 TOCTOU。
- **机制**：runner 已 `started=true`（交付方不做即时回滚），但 `chatAgentStream` 的气泡写入（agentStream.ts:530）stall 超过 60s（病态 DB 锁/进程假死未崩）→ reconciler 判孤儿 → 回滚 + 补投 → 原 runner 恢复后仍写入气泡 → 补投链再 CLAIM 成功（delivered 已被回滚为 false）→ 同一 jobId 两个气泡。
- **评估**：正常路径 CLAIM→气泡写入为毫秒级，60s 阈值（RECONCILER_MIN_DELIVERED_AGE_MS）只影响补投时机；触发需 >60s 的病态 stall 且恰被扫描命中，概率极低；design-decisions Q1 已明示「宁漏勿错」取舍（该残窗属于「错」侧的已知残余，方向相反但同族）。
- **修复建议**（可选，未来工单）：补投链 CLAIM 成功后、注入前再做一次 ground truth 检查（双检），把残窗压到检查与注入之间；或接受现状文档化。
- **可否负向断言**：构造复杂（需 stall runner 60s+ 的可控注入点），建议登记观察。

### S4（P3 微，登记）started=true 后 chatAgentStream 抛错路径无专测

- **位置**：`asyncJobManager.ts:413-421`（catch 只 warn + rethrow，不回滚）。
- **现状**：T1 覆盖 started=false 回滚、T2 覆盖孤儿对账（其构造 = 该路径的产物态），但「started=true 后抛错 → 不回滚 → reconciler 兜底」的串联无专测。
- **修复建议**（可选）：加一例——chatAgentStream 打桩 started 后抛错且不写气泡，断言 delivered 保持 true（不回滚）+ reconcile 一轮后补投成功。
- **可否负向断言**：可。

### 工作区卫生备注（非 v9 问题，不评分）

审查开始时工作区已存在未提交改动：3 个 content/posts 删除（dspark 系列）、开发心路历程.md 修改、architecture-fix-prompt v3~v9 七个未跟踪文件——均为并行会话/用户既有状态，**非本审查产生，与 v9 七个 commit 无关**（`master..HEAD` 范围外），本报告未触碰。建议合入前确认这些改动归属。

---

## 实跑验证记录（亲自运行，非转述）

| # | 命令 | 结果 |
|---|---|---|
| 1 | `npx vitest run src/__tests__/deliveryReliability.test.ts`（apps/server） | EXIT=0；**4 passed**（stderr 实证：抢线回滚重挂日志、reconciler 补投日志、T4 竞态三时序） |
| 2 | `npx vitest run src/__tests__/startupRecovery.test.ts` | EXIT=0；**3 passed**（四动作 + 幂等二跑 + sync 不误投） |
| 3 | `npx vitest run src/__tests__/agentDrift.test.ts`（单跑） | EXIT=0；**3 passed**（fixture 增量段真跑，44ms 非 early-return） |
| 4 | `npx vitest run src/__tests__/nativeTools.test.ts` | EXIT=0；**96 passed / 0 skipped**（git 测试真跑，git_branch/git_checkout 326ms 级耗时可见） |
| 5 | `npx vitest run src/__tests__/resilientLlmClient.test.ts` | EXIT=0；**14 passed** |
| 6 | `pnpm --filter @knowpilot/server test` / `npx vitest run` 全量 ×5 | run#1 exit 1（细节丢失）；run#2 **46 文件 469 passed**；run#3 **agentDrift 2 failed**（S1 实证）；run#4、run#5 **469 passed**——确认 S1 flake，绿轮次与声明基线逐字一致 |
| 7 | `pnpm lint` | EXIT=0（shared/server tsc --noEmit + web eslint 全过） |
| 8 | `pnpm --filter @knowpilot/web test` | EXIT=0；**2 文件 4 passed** |
| 9 | `pnpm run build:mock` → `pnpm run test:e2e:mock`（apps/web）→ `pnpm run build`（恢复普通 build） | **19/19 passed**（53.3s；含 v9 server 启动序列 runStartupRecovery + reconciler 挂载下全绿）；跑后端口仅 TIME_WAIT 无残留进程；普通 build 已恢复（apps/web build = 纯 next build，不触 db:sync） |
| 10 | test.db 只读查询（node prisma，file:./test.db） | 全量绿轮后 `assistant=0 / agents=9 / tasks=2`——agentDrift fixture 自清有效；佐证跨文件残留是已知现象 |
| 11 | grep 防线扫描 | `taskRef:\s*z\.` 零命中；`async_task_wait` 生产零命中；兼容关键词生产零命中（唯一例外 agentFactory fixture 变量 + 2 处纪律注释）；`deliverToQueue===false` 12 处齐全；queueMicrotask Chat 编排层仅 chat.tsx:746 |
| 12 | `git diff master..HEAD --name-only` + orchestrator/web 改动计数 | 14 文件全部可映射 R-1~R-4；**asyncJobOrchestrator.ts 0 行、apps/web 0 文件**；`git stash list` 空（首尾两查）；PLAN_STATUS.json 不存在；工作区既有改动与 v9 无关（见卫生备注） |

---

> 审查人：终审架构师（只读审查 subagent）。本报告 `docs/development/review-final-reliability.md` 为唯一产出物；8 条必查全部逐项实测闭环，S1（P1）必修，S2~S4（P3）登记观察。S1 修复后建议复审单条闭环、总结论升级为「通过」。
