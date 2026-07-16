# KnowPilot v10「任务可重入性与跨重启续跑」终审报告

> 审查范围：`b70fe547..HEAD`（feat/reentrant-resume），C-1 ~ C-4 共 5 个 commits，31 文件 +2225/-64。  
> 审查方式：逐 commit diff 精读 + 关键源码通读（Task schema / 工具注册链 / inferTaskReentrant / recoverStaleAsyncJobs / session.resume / SessionStreamHub 互斥）+ 亲自实跑（lint / server 全量 vitest / 定向 vitest / web vitest / mock e2e / grep 防线扫描）。  
> 硬约束遵守：**未修改任何非 `.md` 源文件**，未做 git 写操作，未运行 `db:sync`，未动 `content/`、`dev.db`。（工作区已存在的内容删除/未追踪文件与本审查无关。）

## 总结论：**通过**

v10 目标全部达成：Task 三列落地、34 个工具 reentrant 声明链正确、任务级推断与入队物化完成、僵尸任务自动续跑走单一路径、会话 paused→running 手动恢复闭环完整，且 v7/v8/v9 成果无回归。

实证全绿：`pnpm lint` 三包通过；`@knowpilot/server` 49 文件 487 passed；`@knowpilot/web` 2 文件 4 passed；mock e2e **20/20 passed**（先 `build:mock` 重建后）。

**通过条件**：无必修阻塞项。仅登记 1 条 P2 观察项（S1：resume 流失败重试时可能重复注入系统消息），建议后续工单处理，不影响合入。

---

## 必查 6 条逐项结论

### 1. 变异验证 —— ⚠️ 未实际执行阉割/回退实验，负向断言已可等价区分

- **未执行原因**：本审查 Agent 被硬约束「只允许写一个 md 文件、禁改任何非 md 文件」。三类变异（`inferTaskReentrant` 恒 false、recover 分支恒走 failed、resume 去掉 `where status:"paused"`）都需要修改 TS 源码或 stash，属于被禁止的写操作。
- **等价验证**：逐条审查了对应测试的负向断言构造，确认坏变体下必红：
  - `inferTaskReentrant` 恒 false → `reentrancyModel.test.ts` 中 `llm 空工具 reentrant=true`、`web_search=true`、`wait=true`、`startAsyncAgentTask` 入库断言等全部变红；进而 `reentrantResume.test.ts` T1/T2/T5 因任务被标 `reentrant=false` 走 failed 分支而红。
  - recover 分叉恒走 R-2 failed → `reentrantResume.test.ts` T1（`status` 变为 failed、retryCount 不变）、T2（无法递增到 maxRetries）、T5（`resumed=0`）均红。
  - resume 去掉条件写 → `sessionResume.test.ts` T7 中 `chatSpy` 会被调 2 次、系统 user 消息出现 2 条，`winners.length===1` 断言必红。
- **结论**：变异验证的精神（用坏变体证明测试区分度）已通过「读代码 + 读负向断言」完成；未实际跑阉割实验是合规约束导致，不是审查缺项。

### 2. reentrant 标注抽查 —— ✅ 通过

- **34 个 true 工具清单**（`grep -R "reentrant: true" apps/server/src/infra/tools/native | wc -l = 34`）：
  - fs 读类 4：`read_file`、`list_directory`、`search_files`、`file_stat`
  - web 只读 3：`web_search`、`read_article`、`scrape_web_page`
  - shell 2：`async_task_status`、`wait`
  - memory 1：`memory_search`
  - swarm 3：`agent_inspect`、`free_api_keys_list`、`skill_discover`
  - git 读类 4：`git_branch`、`git_status`、`git_log`、`git_diff`
  - yuque 读类 5：`yuque_get_doc`、`yuque_list_books`、`yuque_get_book_toc`、`yuque_list_repos`、`yuque_list_docs`
  - browser 1：`browser_login_status`
  - github 读类 10：`github_search_repos`、`github_get_repo`、`github_get_file`、`github_list_issues`、`github_get_issue`、`github_list_pull_requests`、`github_get_pull_request`、`github_list_branches`、`github_get_branch`、`github_list_workflows`
  - feishu 1：`feishu_token_status`
- **重点抽查 false 工具**：`rss_fetch` / `invoke_api` / `feishu_get_doc` / `free_api_keys_fetch` / `sleep` / `run_shell` / `write_file` / `git_commit` / `send_email` 等均**未标** `reentrant: true`（默认 false），与副作用一致。
- **抽查 true 工具实现**：`web_search` 只读搜索（仅进程内 env 幂等同步）、`read_file` 只读、`git_status` 本地只读、`free_api_keys_list` 仅 `Credential.findMany` 不刷新 `lastUsedAt`、`agent_inspect` / `skill_discover` / `memory_search` 均只读。未发现误标。

### 3. crash-loop 实测 —— ✅ 通过

- **覆盖测试**：`reentrantResume.test.ts` T2 完整模拟 crash-loop：
  - 预置 `reentrant=true`、`maxRetries=2`、执行体必败的僵尸 Task；
  - 第 1 轮恢复：`retryCount 0→1`，入池运行后 failed；
  - 手动把状态改回 running 模拟再次崩溃；第 2 轮恢复：`retryCount 1→2`，入池运行后 failed；
  - 再次改回 running；第 3 轮恢复：`retryCount(2) >= maxRetries(2)`，`resumed=0`、`failed=1`，error 文案含「已达自动重试上限（2 次），需人工介入」；
  - 后续多次恢复：`resumed=0`、`failed=0`，`runAgentLoop` 总调用次数停在 2 次。
- **计数持久化**：每次递增通过 `prisma.task.updateMany({ data: { retryCount: { increment: 1 } } })` 落库；测试断言读取 DB 验证。
- **结论**：crash-loop 防护账本正确，耗尽后不再入池。

### 4. 单一路径纪律 —— ✅ 通过

- **唯一恢复入口**：生产代码中只有 `runStartupRecovery`（`index.ts:261`）调用 `recoverStaleAsyncJobs`（`asyncJobManager.ts:770`），测试中的直接调用不影响生产路径。
- **无新限流层**：恢复风暴中的 50 个僵尸直接 `getAsyncJobOrchestrator(config).enqueue(...)`，背压完全复用 v8 池的 `maxGlobal/maxQueued/queuedTimeoutMs`（`asyncJobManager.ts:917-942`）。
- **唯一并发口径**：`runningGlobal` 仍只在 `asyncJobOrchestrator.ts:377` 同步递增、`onAny` 事件统计仍是 v8 池唯一并发口径（`reentrantResume.test.ts` T5 与 `globalTaskPool.test.ts` 同手法验证 `peak ≤ maxGlobal`）。
- **grep 实证**：`recoverStaleAsyncJobs` 生产调用仅 1 处；`maxConcurrent/runningGlobal/maxGlobal` 未在恢复路径新增判定。

### 5. resume 幂等竞态 —— ✅ 通过

- **条件写互斥**：`SessionService.resume` 唯一互斥点 = `prisma.chatSession.updateMany({ where: { id, status: "paused" }, data: { status: "running" } })`（`services.ts:1468-1471`）。`count=0` 时重读：已 running → 幂等返回；其它 → `BAD_REQUEST`。
- **hub.startIfNotRunning 自身互斥**：`sessionStreamHub.ts:208-222` 先 `isRunning` 检查；`start` 内同步 `runs.set` 占位后再 `await maxEventIdFor`（`:265`），并发第二方会命中「已有运行中的 Agent 流」并返回 `false`。
- **runner 终态归位**：在 resume 传入的 runner 内部、hub 标 `completed` 之前，用 `updateMany where status:"running"` 把状态置 `active`/`completed`/`paused`（`services.ts:1537-1548`）。
- **测试实证**：`sessionResume.test.ts` T7 并发 double-resume，`chatSpy` 仅调 1 次、系统 user 消息仅 1 条、结果 `[resumed:true, streamStarted:true]` 与 `[resumed:false, streamStarted:false]` 各一；T8 验证 active/failed/archived → `BAD_REQUEST`、已 running → 幂等。
- **架构判断**：删掉 `session.resume` 的编排层调用后，不变量仍由 `updateMany` 条件写与 `hub.startIfNotRunning` 同步占位保证，符合「把不变量收进 reducer/原子操作」的铁律。

### 6. v7/v8/v9 成果无回归 —— ✅ 通过

- **v9 R-2 非 reentrant 僵尸语义未变**：`startupRecovery.test.ts` C1 仍断言 `staleTasksFailed=2`、error 含「服务重启」、不自动重跑；`recoverStaleAsyncJobs` 对 `reentrant=false` 仍走 failed 分支（`asyncJobManager.ts:947-970`）。
- **v9 reconciler 零误伤**：`deliveryReliability.test.ts` 4 例全绿（同链回滚、孤儿补投、未投递补投、并发竞态）。
- **v8 池容量/右栏三组未变**：`globalTaskPool.test.ts` 18 例全绿（含 50 spawn 压测、Q2 口径、Q4 死锁）；`async-task-queue.test.ts` 13 例全绿（sync 任务分组、重试保留 `deliverToQueue=false`）；`superiorQueueDrain.test.ts` 7 例全绿（busy 不写 ChatMessage、软认领竞态、S1/S2/S4 修复回归）。
- **v7 两级分组/去全文未变**：`async_task_wait` 生产代码零命中；`getAsyncJobStatus` 仍不返回全文；`deliverToQueue=false` 过滤 4 处仍齐。

---

## 发现的问题清单

### S1（P2 低）resume 流中途失败后再次恢复，可能重复注入 `source:system` 续跑提示消息

- **位置**：`apps/server/src/services.ts:1505-1512`（resume body 的 system 消息）+ `apps/server/src/infra/agentStream.ts:529-543`（`chatAgentStream` 无条件创建 user 消息）。
- **根因**：`chatAgentStream` 在起流后**首先**把 `source:system` 的续跑提示写入 `ChatMessage`（`!prepared.skipUserCreate`），然后才执行 ReAct。若执行体在该轮中抛出非 abort 错误（LLM 故障、预算耗尽等），catch 仅 `emit error` 不删除消息，resume runner 将状态置为 `paused`。用户再次点「恢复运行」时，`chatAgentStream` 会再写一条同样的 system user 消息，导致历史链重复。
- **修复建议**：给 system 续跑提示加去重键——在 `chatAgentStream` 写消息前检查该会话最后一条消息是否已是 `role=user && source=system && content=...`，是则跳过；或让 resume body 携带 `skipUserCreate=true` 并由 resume 自己负责幂等写。
- **可否负向断言**：可。构造 paused 会话 → resume → 在 `chatAgentStream` 内注入错误 → 状态回到 paused → 再次 resume → 断言 `source=system` 的 user 消息只有 1 条。

---

## 实跑验证记录（亲自运行，非转述）

| # | 命令 | 结果 |
|---|---|---|
| 1 | `cd "/d/ALL IN AI/KnowPilot" && pnpm lint` | EXIT=0；shared/server `tsc --noEmit` + web `eslint` 全过 |
| 2 | `cd apps/server && npx vitest run src/__tests__/reentrancyModel.test.ts src/__tests__/reentrantResume.test.ts src/__tests__/sessionResume.test.ts` | EXIT=0；3 文件 **27 passed**（reentrancyModel 11 / reentrantResume 5 / sessionResume 3） |
| 3 | `cd apps/server && npx vitest run src/__tests__/startupRecovery.test.ts src/__tests__/deliveryReliability.test.ts src/__tests__/globalTaskPool.test.ts` | EXIT=0；3 文件 **25 passed**（startupRecovery 3 / deliveryReliability 4 / globalTaskPool 18） |
| 4 | `cd "/d/ALL IN AI/KnowPilot" && pnpm --filter @knowpilot/server test` | EXIT=0；**49 文件 487 passed**（68.6s） |
| 5 | `cd "/d/ALL IN AI/KnowPilot" && pnpm --filter @knowpilot/web test` | EXIT=0；**2 文件 4 passed** |
| 6 | `cd apps/web && pnpm run build:mock` | EXIT=0；Next.js 生产构建成功（所有路由生成） |
| 7 | `cd apps/web && pnpm run test:e2e:mock` | **20/20 passed**（55.0s），含 C-3 `chat-session-resume-mock.spec.ts` 1 例通过 |
| 8 | `grep -R "reentrant: true" apps/server/src/infra/tools/native --include="*.ts" \| wc -l` | **34**，与 C-1 声明数量一致 |
| 9 | `git diff --stat b70fe547..HEAD` | 31 文件，全部落在 C-1~C-4 声明范围，无夹带 |

**e2e 环境排障记录**：首次直接用既有 `.next` 跑 `test:e2e:mock` 因 build 指向 3010 而 mock server 在 3011 导致全灭（`ECONNREFUSED 127.0.0.1:3010`）。按仓库流程 `pnpm run build:mock` 重建后 20/20 全绿。此失败属测试产物状态，与 v10 代码无关。

---

> 审查人：只读审查 subagent。本报告为唯一产出物；除 S1（P2 观察项）外，v10 可重入与续跑机制完整落地、测试不注水、基线无回归，**建议总结论为「通过」**。
