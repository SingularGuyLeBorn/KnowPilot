# KnowPilot 性能审计报告与后续优化方向

> 本文件是两轮性能优化（38 项）落地后的**事后审计**：记录已完成工作、自审发现与修复、当前仍存风险，并给出分级后续优化建议。
> 决策清单与逐批自审见 `perf-plan.md`。本文聚焦「现状审计 + 方向建议」。
>
> 最后更新：2026-07-09

---

## 一、已完成工作总览

两轮共 **38 项**优化，均按「新分支 → 实施 → 自审找茬 → 修复 → 隔离测试（server tsc / web tsc / vitest / web build / eslint）→ 合并 master → 删分支」闭环落地。提交脉络（master）：

- 前端首轮（5 commit）：PostContent memo、input 下放、流式 rAF 合并、附件懒加载 + 子代理轮询退避、长消息列表虚拟化（react-virtuoso）
- 第一轮 4 批次：P1–P12 + A1–A16
- 第二轮 4 批次：R1–R10

### 按层分组

**后端中间件 / 请求上下文**
- P1 createContext 凭据注入幂等化（generation 计数器消除竞态）+ 启动注入 + CRUD 即时刷新
- P2/P3 loggerMiddleware 成功日志 fire-and-forget + query 跳过 rawInput（错误日志保留同步）

**数据层 / 索引**
- P5/P6/A11 索引：ChatMessage(sessionId,createdAt)、ChatSession(agentId,updatedAt)、Run/Log/Approval/Skill 补索引（原生 SQL 应用，未动 FTS 表）
- R6 Run.list getListSelect 裁剪大 JSON
- R7 listSessionAsyncJobs 改 DB 层 sessionId 过滤（修漏任务）
- A4 session.getByIdLite（stop/rerun 不再拉 500 消息）
- A5 agentStream 编辑消息尾部删除改 deleteMany
- A6 AgentService.bulkDelete（findMany+deleteMany+逐条文件/FTS 清理）
- A12 agentStream 结束 message.create+run.create 合并 $transaction
- A15 post.getBySlug viewCount 自增改 fire-and-forget

**FTS / 搜索**
- P11 FTS 增量 upsert/delete（Post/Agent/Skill/Memory CRUD 后即时入索引）+ 2 个测试
- R1 post.search 改 FTS 优先 + LIKE 回退

**SSE / 流式**
- P7 writeSse 合并 event+data 单次 write
- P8 SSE X-Accel-Buffering: no
- A7 probe 短路整段 emit（取代逐字符）
- R2 服务端 SSE token 16ms 合并（coalescedEmit）
- 前端：流式 token rAF 合并、probe 整段拼接

**Agent 运行时**
- A2 buildAgentToolSchemas 批量 findSkillsByNames（消除 Skill N+1）
- A9 agentSchemaCache 监听 skill.*/mcp.* 事件自动失效
- A14 heartbeatEngine 事件驱动 cron（取代 60s 全量重建轮询）
- R3 chatHistory 复用 allCalls 消除重复 parse
- R5 agentStream 历史 pageSize 统一 200（修 >100 条截断正确性）

**同步**
- A13 Syncer scanFile 单文件解析，watch add/change 不再全目录扫描

**前端数据层 / UI**
- P4 tRPC splitLink + httpBatchLink（并发 query 合并）
- A1 WorkspaceTree 批量 session.list(agentIds)（消除 N+1）
- A8 pullAsyncQueue 条件轮询（仅活跃任务时 2.5s）
- R9 asyncQueueStats 自适应轮询（active 5s / idle 15s / error 30s）
- R10 Chat agent.list 去重（WorkspaceTree 复用父组件 agents）
- A16 Chat skill.list staleTime 5min
- 长消息列表虚拟化、PostContent memo、input 下放、附件懒加载、子代理轮询指数退避

**响应传输 / 看板**
- P9 compression 中间件（排除 SSE）
- P10 /health DB 连通性检查 + capabilities 30s 缓存
- A10 capabilities 计数改 infoSource.count + InfoSource CRUD 失效缓存
- R4 swarmStats run.findMany 加 take:5000 封顶
- R8 dashboard 30s TTL 缓存

---

## 二、验证基线（合并后状态）

- `apps/server` tsc --noEmit：✅
- `apps/web` tsc --noEmit：✅
- `pnpm --filter @knowpilot/server test`（Vitest）：**247 passed / 5 skipped**（含 FTS 增量、post.search FTS 路径覆盖）✅
- `pnpm build`（Next 生产构建，29 路由）：✅
- `eslint`（改动文件）：✅
- 隔离验证方法：每批用 `git stash` 隔离 WIP 后在纯净提交状态跑全套，确保 master 干净检出可构建

### 自审中发现并修复的关键问题

1. **master 干净检出构建已坏**（批次1自审发现）：此前直接提交 master 的 chat.tsx 性能批次连带引入对未提交 WIP 的依赖（`source` 字段、`MessageQueue.onOpenSubagent`），master 在干净检出时 web 构建失败（之前 `pnpm build` 通过仅因工作区有 WIP）。修复：合并被依赖的关联 WIP 恢复一致性。→ 这催生了后续「分支 + 隔离测试再合并」的强制流程。
2. **P1 凭据注入并发竞态**：初版 invalidate 仅置失效标记，首次注入进行中发生 CRUD 时旧注入会用旧凭据覆盖 config。修复：generation 计数器 + CRUD 立即重注入。

---

## 三、当前仍存在的性能 / 正确性风险（审计发现）

> 这些是审计后**确认仍存在**但**未在本轮处理**的点，按风险/收益排序。

### A. Chat 会话详情全量消息载荷（最高收益，最高回归风险）

- **位置**：`apps/server/src/services.ts` SessionService.getById `include: { messages: { take: 500 } }`；`apps/web/components/chat.tsx` session.getById.useQuery + onDone refetch
- **现状**：打开/切换会话、每轮流结束都拉取至多 500 条消息的完整 `content + toolCalls + toolResults + attachments`（含 OCR/vision 的 data URL）。长会话 + 多轮工具 + 图片附件时单次响应可达 MB 级。
- **风险**：SQLite 读 + 序列化 + 网络 + React 重渲染叠加；虚拟化已缓解 DOM，但**载荷本身**未减。
- **为何未做**：涉及 Chat 消息分组、版本切换、NavRail、编辑/重试一致性，回归面最大。

### B. Agent.list / Skill.list 列表返回大字段

- **位置**：AgentService（systemPrompt、apiKey）、SkillService（code、metaJson）
- **现状**：Chat 依赖 agent.list 的 `systemPrompt`（chatConfig）、skill.list 的 `code`（skillPrompt），故不能全局裁剪。agent.list 仍返回 `apiKey`（**安全泄露面**，虽非性能）。
- **为何未做**：需配合 Chat 改用 agent.getById 取 systemPrompt/code，改造面中等。

### C. buildMemoryContext 每条消息 LIKE 查 Memory

- **位置**：`agentRuntime.ts` buildMemoryContext 用 `memory.list({keyword})`（LIKE on content）；Memory 已有 FTS（P11）却未用
- **现状**：每次 Chat 多 1 次 DB + 5 条全文；keyword contains 扫 content 列
- **为何未做**：改 FTS 召回质量需回归测试，无现成记忆召回覆盖

### D. prepareMessage 与主流程双查历史

- **位置**：`agentStream.ts` edit/regenerate/retry 路径 prepareMessage loadHistory + 主流程 message.list
- **现状**：编辑/重试路径双查（普通发送只一次）；pageSize 已统一（R5）
- **为何未做**：edit 路径 prepareMessage 会 deleteMany 尾部 + update 被编辑消息，其 items 在删除/更新后 stale，主流程复用会拿到被删的旧 assistant——**正确性风险**。仅做 pageSize 统一，不做 items 复用。

### E. dashboard 仍 13 路并行 count

- **位置**：`analytics.ts` getAnalyticsDashboard
- **现状**：已加 30s TTL 缓存（R8），但缓存 miss 时仍 13 路并行 count
- **为何未做**：单 SQL/CTE 合并收益中等、写法较繁，留待后续

### F. 其他次要点（留痕，非紧急）

- MessageService.list 全字段（agentStream 重建历史需 toolCalls/toolResults，不能裁剪；可考虑专用 listForLlm procedure）
- McpService.list 返回 env/args（列表页 JSON.parse，载荷不大）
- Memory/Prompt list 返回完整 content（列表 UI 需展示，不能裁剪）
- asyncQueueStats idle 15s 仍轮询（R9 已自适应，可进一步改 SSE/WebSocket 推送）

---

## 四、建议优化方向（分级）

### 🟢 第 1 优先：立即可做，低风险（小步快跑）

1. **Agent.list 排除 apiKey**（安全 + 极小 perf）
   - 位置：`AgentService.formatEntity` / getListSelect
   - 做法：列表响应永不返回明文 apiKey（getById 编辑页如需展示则遮蔽）
   - 收益：消除密钥泄露面；风险：低；估工：0.5h；需确认 agents 编辑页是否依赖 apiKey 字段

2. **swarmStats SQL GROUP BY 聚合**（替代 R4 的 take 封顶 + JS 聚合）
   - 位置：`router.ts` swarmStats
   - 做法：prisma.run.groupBy by agentId + _count + _sum(durationMs, toolCallCount)；tokenUsage(JSON) 单独 bounded findMany
   - 收益：准确统计 + 内存可控；风险：低；估工：1h

3. **post.list.keyword 也走 FTS**
   - 位置：`PostService.buildListWhere` keyword 分支（当前 OR title/content contains）
   - 做法：keyword 时走 searchFts 取 id 再分页，或仅搜 title/slug
   - 收益：文章列表关键词过滤不再扫 content；风险：低（FTS 分词 vs contains 差异需中文短词测试）；估工：1h

### 🟡 第 2 优先：中等重构，中等收益（需配套改动）

4. **Agent.list / Skill.list 字段裁剪 + Chat 改用 getById**
   - 位置：AgentService/SkillService getListSelect + `chat.tsx` selectedAgent 数据源
   - 做法：列表只返 metadata；Chat 对 effectiveAgentId 发 agent.getById 取 systemPrompt/model；skill 选中时按 id 取 code
   - 收益：消除 Chat 侧栏/WorkspaceTree 的大字段载荷（含 systemPrompt/code）；风险：中（Chat 核心路径，需确保 chatConfig/selectedAgent 切换无空窗）；估工：3–4h；依赖：需补 Chat 对 agent.getById 的 loading 态处理
   - 前置：先做第 1 项（apiKey）可顺带验证

5. **buildMemoryContext 改 FTS + 回归测试**
   - 位置：`agentRuntime.ts` + 新增 memory 召回测试
   - 做法：searchFts(entity=memory) 取 id → memory.findMany 回填；保留 LIKE fallback
   - 收益：记忆召回不再扫 content 全表；风险：中（召回质量）；估工：2h + 测试

6. **dashboard 单 SQL / CTE 合并 13 count**
   - 位置：`analytics.ts`
   - 做法：一条 raw SQL 用 CASE WHEN 聚合多个 count（post total/published、run success/failed、task cron、log error24h 等）；tokenUsage 仍 bounded findMany
   - 收益：缓存 miss 时 1 次 SQL 替代 13 次；风险：低；估工：1.5h

### 🔴 第 3 优先：大重构，最高收益（独立评审，单独分支）

7. **Chat 消息加载改造：session 与 message 分离 + 流结束增量更新（P0-1）**
   - 位置：`SessionService.getById`（去 messages include）+ 新增 `message.list` 分页/游标 + 列表 select 裁剪 + `chat.tsx` 消息分组/版本/NavRail/编辑重试改为基于分页消息 + 流结束增量 merge 新 assistant
   - 收益：**最高**——长会话/OCR 场景载荷从 MB 级降到 KB 级；消除每轮 onDone 全量 refetch 500 条
   - 风险：**最高**——回归面覆盖 Chat 消息分组、多版本切换、NavRail 定位、从中间编辑/重试一致性、虚拟化交互
   - 估工：1–2 天；建议：拆 3 个子 PR——① message.list 分页 + select ② Chat 改分页加载 + 增量 merge ③ session.getById 去 include + 全量回退路径移除
   - 前置条件：必须有 Chat E2E（真实 + mock）覆盖消息渲染/编辑/重试/版本切换/NavRail 后再做

8. **（可选）asyncQueueStats / pullAsyncQueue 改 SSE/WebSocket 推送**
   - 收益：消除轮询；风险：中（需长连接基础设施）；估工：1 天；当前 R9+A8 自适应已大幅降本，非紧急

### ⚪ 不建议动的项

- **MessageService.list 全字段**：agentStream 重建历史必须用 toolCalls/toolResults/content，裁剪会破坏 ReAct 回放。如要做，需新增 `message.listForLlm` 专用 procedure 并保证与 session.getById 前端数据源策略一致——属于第 3 优先的大重构子项。
- **Memory/Prompt list 裁剪 content**：列表 UI 展示完整 content，裁剪会破坏页面。
- **P2-4 历史复用**：edit 路径 items stale 是正确性风险，不宜复用。

---

## 五、验证与回归建议

1. **每项后续优化仍走分支闭环**：新分支 → 隔离测试（server tsc / web tsc / vitest / web build / eslint）→ 合并。
2. **第 3 优先（Chat 消息加载）前置**：补 Chat E2E 覆盖（消息渲染、编辑、重试、版本切换、NavRail、虚拟化滚动）后再动，否则回归不可控。
3. **FTS 相关改动**（第 1 优先 3、第 2 优先 5）需补中文短词召回测试，确认分词与 contains 行为差异可接受。
4. **缓存类改动**（第 2 优先 6 已有 R8）建议补 CRUD 失效接入测试，避免 stale。
5. **安全项**（第 1 优先 1 apiKey）建议补一个「list 响应不含明文密钥」的回归测试锁死。

---

> 结论：两轮 38 项已把「安全高收益 + 中等风险可落地」区间穷尽，master 干净检出可构建、测试全绿。剩余最高收益项（Chat 消息加载，P0-1）属大重构，建议独立评审、拆分子 PR、前置 E2E 后再攻。第 1/2 优先的小项可随时穿插落地。
