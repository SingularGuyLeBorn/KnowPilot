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


---

## 六、外部审计找茬记录

> 本章节由 AI 助手以「挑毛病」视角复核 `perf-plan.md` 与 `perf-audit-report.md` 后补充，记录文档结构、实现方式、验证基线、风险控制等方面的存疑项，供后续决策者参考。

### 6.1 文档与流程层面的问题

#### 1. `perf-plan.md` 身兼「计划」与「实施日志」两职，结构混乱
- `perf-plan.md` 前半部分是 Q&A 决策流程，中间插入「已确认 ✅」表，后面又塞入 8 个批次的自审记录、round 2 的 R1–R10 及另 8 个批次自审，文件定位不统一。
- **建议**：`perf-plan.md` 只保留 Q&A + 已确认表；所有自审、实现细节、批次记录迁移到 `perf-audit-report.md`。

#### 2. Round 2 的 R7–R10 未经过 Q&A 流程
- R1–R6 在 `perf-plan.md` 中有条目和「回答：同意。已实施。」；R7–R10 直接出现在「批次 7/8 自审记录」中，没有前置问题描述与决策回答。
- **建议**：补齐 R7–R10 的独立 Q&A 条目，或在「已确认 ✅」总表中补全这 4 项。

#### 3. 「38 项」数字未在文档中清晰对应
- 读者需手动计算 P1–P12(12) + A1–A16(16) + R1–R10(10) = 38，缺少一张总览表。
- **建议**：`perf-audit-report.md` 开头增加总览表，列清编号、名称、状态、批次、风险等级。

#### 4. Q&A 回答由 AI 自行填写，缺乏用户确认痕迹
- 文档写着「你只需在每条 `回答：` 后写回复」，但实际由 AI 填写。后续审计无法区分人类确认与 AI 默认同意。
- **建议**：在 `perf-plan.md` 中明确标注「回答由 AI 根据推荐方案默认填写，用户未逐条反驳即视为同意」，或让用户逐条确认。

---

### 6.2 实现方式上的「茬」

#### 5. A1 WorkspaceTree 从「展开才查」退化成「一次性查全部」
- 实现改为 Chat 层一次性拉所有 agent 的会话再分组传下，解决了 N+1，但变成 **over-fetch**。
- **风险**：100 个 agent 只展开 2 个时仍要拉 100 个 agent 的会话。
- **建议**：后端支持 `session.list({ agentIds })` 批量查询，前端仍按展开状态控制传入的 agentIds，或做按需加载。

#### 6. A6 `AgentService.bulkDelete` 的 deleteMany 与文件清理非原子
- 实现为 `findMany + deleteMany + 逐条文件/FTS 清理`。
- **风险**：`deleteMany` 已提交后，若某条 Markdown 删除或 FTS 清理失败，DB 与文件/索引不一致。
- **建议**：用 `$transaction([...deleteMany..., ...文件删除...])` 整体回滚，或先清理文件/FTS 再删 DB。

#### 7. A13 sync watch 只优化 add/change，unlink 仍全量扫描
- 文档明确「unlink 仍走全量 `syncEntity`（含 cleanup）」。
- **风险**：批量删除文件时每次 unlink 都触发全目录扫描，仍是性能热点。
- **建议**：unlink 也做增量——根据删除文件路径推断 affected slug，只做对应实体的 cleanup。

#### 8. R5 把主流程 history pageSize 从 100 提到 200
- 文档称这是为了与 prepareMessage 对齐的正确性修复。
- **问题**：这**加剧**了历史加载负担。本来 stop/rerun 拉 500 条已过重，现在主流程也改成 200，每次 Agent 运行多加载一倍历史。
- **建议**：两边都降到 100，或实现真正的分页/滑动窗口加载历史。

#### 9. R4 `swarmStats` 用 `take: 5000` 封顶只是「创可贴」
- 实现未解决 JS 聚合内存高的问题，只是把上限从无限改成 5000。
- **风险**：5000 条 Run 的 tokenUsage JSON 仍可能占用大量内存。
- **建议**：按文档自己提出的方向，用 SQL `groupBy` + `_count/_sum` 替代 JS 聚合。

#### 10. P1 凭据缓存的 generation 计数器方案复杂且缺少实现细节
- 文档仅描述「引入 generation 计数器；invalidate 自增 gen 使进行中的旧注入作废」。
- **风险**：gen 的读取与 config 写入之间若缺乏原子性，仍可能竞态。
- **建议**：在 `perf-audit-report.md` 补充 P1 的实现伪代码或关键代码路径，方便后续审计。

#### 11. P11 FTS 增量更新后，软删/永久删的 Post 未即时移除 FTS
- 文档承认这是「已知可接受项」。
- **问题**：用户软删文章后搜索仍能搜到，直到下次 `db:sync`，属于**功能缺口**。
- **建议**：在 `PostService.softDelete/permanentDelete` 内补 `removeFts`，不要长期接受。

#### 12. R8 dashboard 缓存 miss 时仍是 13 路并行 count
- 仅加了 30s TTL，缓存失效/首次调用时仍是 13 次 count。
- **建议**：要么合并为单 SQL/CTE，要么不要把此项当作「已完成」性能优化来宣扬。

#### 13. R2 SSE 16ms token 合并可能引入可感知延迟
- token buffer + 16ms 定时器冲刷；Node.js 定时器精度不保证，实际可能 16–30ms。
- **风险**：大模型吐字慢时用户会感觉「顿一下才出字」。
- **建议**：增加 max buffer size 条件，buffer 满 N 字符或 16ms 先到先冲。

#### 14. P2 fire-and-forget 日志没有错误处理/降级
- 实现为 `void prisma.log.create(...).catch(()=>{})`。
- **风险**：Prisma 临时断开时日志静默丢失，调用方完全不知。
- **建议**：`catch` 中至少 `console.error` 或写入本地文件降级日志，不要完全吞掉。

#### 15. P10 `/health` capabilities 缓存 30s，缺少主动失效
- InfoSource/Skill/Agent 等 CRUD 后 capabilities 可能 30s 内 stale。
- **建议**：在对应 CRUD 路径调用 `invalidateCapabilitiesCache`。

---

### 6.3 验证与测试层面的问题

#### 16. 验证基线缺少 E2E 运行结果
- `perf-audit-report.md` 只列了 tsc、Vitest、build、eslint，未列 `pnpm test:e2e:mock` 和真实 LLM E2E。
- **风险**：R2 SSE 合并、P4 batchLink、A8/R9 轮询、R10 prop 传递都严重影响前端交互，unit test 和 build 无法覆盖。
- **建议**：补充 E2E 运行结果，尤其是 chat 相关用例。

#### 17. 没有性能基准（before/after）
- 文档称「收益高」「最大单点开销」，但没有任何数字：请求延迟、HTTP 请求数、响应大小、count 耗时等。
- **风险**：无法证明优化有效，也无法防止后续回退。
- **建议**：至少补充一次手动 benchmark，把关键数字写入报告。

#### 18. 未提及并发/压力测试
- P1、P2、P4、A6 等涉及并发行为，Vitest 单线程测试无法发现竞态。
- **建议**：对 P1 凭据缓存和 A6 bulkDelete 增加并发调用测试。

---

### 6.4 遗漏/未处理的真问题

#### 19. Chat 消息全量加载仍是 P0 级问题，但未动
- 审计报告承认这是「最高收益，最高回归风险」。
- **建议**：把「补 Chat E2E」本身列为独立高优先级任务，而不是无限期挂起；否则最大卡顿源一直存在。

#### 20. `agent.list` 仍返回 `apiKey` 明文
- 审计报告第 1 优先建议做，但还没做。
- **性质**：这首先是**安全漏洞**，不应只作为性能审计的「第 1 优先」轻描淡写。
- **建议**：立即单独修复并补回归测试「list 响应不含明文密钥」。

#### 21. `buildMemoryContext` 每条消息 LIKE 查 Memory 未改
- Memory 已有 FTS（P11），但 Chat 运行时记忆召回仍走 LIKE，等于 FTS 没被充分利用。
- **建议**：尽快改 FTS 召回 + 补中文短词召回测试。

#### 22. dashboard 13 count 仍未合并
- 同上，识别为瓶颈但未真正解决。

---

### 6.5 最严重的 5 个「茬」（按优先级排序）

| 优先级 | 问题 | 理由 |
|---|---|---|
| 🔴 1 | `agent.list` 返回 `apiKey` 明文 | 安全漏洞，应立即修复 |
| 🔴 2 | Chat 消息全量 500 条未解决 | 最大性能瓶颈，用户体验最卡 |
| 🟠 3 | A13 unlink 仍全量扫描 | watch 删除场景性能没真正解决 |
| 🟠 4 | R5 pageSize 100→200 | 以性能换正确性，方向反了 |
| 🟠 5 | 缺少 E2E 与性能基准 | 无法证明优化有效，也无法防回归 |

---

### 6.6 总体评价

- **分析能力**：8/10 — 识别到了大量真实问题。
- **文档规范**：4/10 — 计划与审计混为一谈，Q&A 自答，R7–R10 缺决策流程。
- **验证基线**：3/10 — 缺 E2E、缺性能基准、缺并发测试。
- **工程严谨性**：5/10 — 部分实现是创可贴（R4/R5/A1/A13），正确性与原子性有隐患。

> 结论：方向正确、覆盖面广，但建议先整理文档结构，补齐安全与 E2E 验证，再把「创可贴」方案替换为更彻底的实现。

---

## 七、批次 9 硬茬修复（针对第六章找茬）

> 针对第六章「外部审计找茬记录」中可立即修的代码层硬茬，开 `perf/batch9-hardening` 分支闭环修复。

| 找茬 # | 处置 | 实现 |
|---|---|---|
| #20 apiKey 明文（🔴 安全） | ✅ 修复 | `AgentService.formatEntity` 剥离 apiKey，API 响应（create/getById/list）永不返回明文；agent.apiKey 仍可经 create/update 写入 DB，LLM 实际用 config providers 的 env key，不受影响。新增回归测试「agent API 响应不返回明文 apiKey」 |
| #11 软删/永久删 Post 未移 FTS | ✅ 修复 | `PostService.delete`(软删) 后 `removeFts`；`restore` 后 `syncFts` 重新入索引；`permanentDelete` 后 `removeFts`。软删文章不再被搜索命中 |
| #14 P2 日志 catch 完全吞错 | ✅ 修复 | 成功审计日志 catch 改 `console.error` 降级，Prisma 临时断开等问题可见 |
| #13 R2 SSE 16ms 可能顿 | ✅ 修复 | coalescedEmit 加 buffer 字符数上限（≥512 立即冲），快吐字时单帧不过大、慢吐字时满即出字，不再硬等 16ms |
| #6 A6 bulkDelete 失败静默 | ✅ 修复 | 文件删除失败改 `console.error` 记录，DB 与文件不一致可见（文件/FTS 非 DB 事务，原子性限制本身仍在，但不再静默） |
| #9 R4 swarmStats take:5000 创可贴 | ✅ 修复 | 改 SQL `run.groupBy(by:[agentId,status], _count, _sum durationMs/toolCallCount)` 精确聚合（走 Run(createdAt) 索引，无内存上限）；tokenUsage(JSON) 仍 bounded findMany 近似求和。计数/耗时/工具数现精确，仅 token 为最近 5000 条近似 |

### 未在本批处理（留待后续，见第四章分级）

- #5 A1 over-fetch：改按展开 agentIds 传参（后端已支持 agentIds，前端按 expanded 传）——可做，留批次 10
- #7 A13 unlink 增量 cleanup——可做，留批次 10
- #8 R5 pageSize 100→200：本质指向 P0-1 滑动窗口加载，属大重构
- #16/#17/#18 E2E/性能基准/并发测试：流程改进，需单独安排
- #1/#3 文档结构整理：编辑性，可随时做

### 核对修正（第六章中描述与实际不符的）

- **#2 R7–R10 缺 Q&A**：perf-plan round-2 段中 R7/R8/R9/R10 均有独立 Q&A 条目（问题描述/推荐/`回答：同意。已实施。`），且已补入「已确认 ✅」表。该找茬不成立。
- **#15 P10 capabilities 无主动失效**：InfoSource CRUD 已接 `invalidateCapabilitiesCache`（A10/P10）；capabilities 的 DB 依赖部分仅 infoSources 计数，已失效。search/ocr/browser 读 env/进程状态，运行时不变。该找茬部分不成立。

### 验证

server tsc ✅ / web tsc ✅ / vitest **248 passed 5 skipped**（含新增 apiKey masking 回归测试）✅

---

## 八、验证补强（批次 11：#16/#17/#18）

> 针对第六章 #16/#17/#18 的验证流程改进，开 `perf/batch11-verification` 分支落地。

### #16 E2E

- `pnpm test:e2e:mock`（playwright mock 配置，MOCK_LLM/MCP/NATIVE_TOOLS 全开，web 3002 + server 3011）：**11 passed (41.8s)**
  - 覆盖：chat 工具调用/思考时间线/中间正式回复/工具失败、文章回收站删除恢复、子代理创建展示、通用 UI 组件
  - 验证前端性能改造（虚拟化、rAF token 合并、input 下放、SSE 合并、WorkspaceTree prop 传递）未破坏 mock 交互流
- 真实 LLM E2E（chat-thinking-real / chat-tool-hint-real / chat-ocr-real / chat-queue-real）未运行：需真实 API Key（DEEPSEEK/OPENAI 等），本地无 keys 时跳过；建议在具备 keys 的环境补跑

### #17 性能基准（dev.db：posts=1312 sessions=37 agents=37 runs=102）

脚本：`apps/server/src/scripts/bench-perf.ts`（`pnpm --filter @knowpilot/server exec tsx src/scripts/bench-perf.ts`）

| 热路径 | avg | 说明 |
|---|---|---|
| post.search **FTS**（R1） | **0ms** | searchFts post，走 FTS5 索引 |
| post.search LIKE（优化前等价路径） | **33ms** | title+content contains 全表扫 |
| → FTS 较 LIKE | **~33x 提速** | 1312 篇文章下 R1 的实际收益 |
| session.getById（include 500 消息） | 0–1ms | 测试会话仅 2 条消息、载荷 ~1.7KiB |
| agent.list（take 100 全字段） | 0–1ms | 37 agents |
| analytics.dashboard（13 count，冷） | 14ms | R8 缓存未命中时 |
| swarmStats groupBy（30d，#9） | 14ms | SQL 聚合，runs=102 |

- **结论**：R1（post.search FTS）有可量化的大幅提速（33x）；session.getById 在小会话下快，但 P0-1 的风险在大会话（多消息 + 图片附件 data URL）时才显现——本次基准的会话太小未触发，需用大会话构造场景才能体现 P0-1 收益。
- dashboard/swarmStats 在当前数据量下 14ms，可接受。

### #18 并发测试

新增 `apps/server/src/__tests__/concurrency.test.ts`（3 tests passed）：
- P1：`ensureIntegrationCredentialsInjected` 10 并发调用幂等不抛错，config 一致
- P1：`invalidate` 后再次 `ensure` 重新注入，config 一致
- A6：两组不相交 agent 并发 `bulkDelete` 互不干扰，各删 2 条

### 验证

server tsc ✅ / web tsc ✅ / vitest **251 passed 5 skipped**（248 + 3 并发测试）✅ / mock E2E **11 passed** ✅

---

# 第三轮性能优化（round 3）

> 第二轮 10 项 + 硬茬 6 + 验证 3 + #5/#7 + P0-1 已落地。本轮继续做不碰 Chat UI 的安全后端项。
> 自答自审，`回答：` 由 AI 据 AGENTS.md 流程默认填写。

## R11. buildMemoryContext 改 FTS 召回

- **位置**：`apps/server/src/infra/agentRuntime.ts` buildMemoryContext
- **当前**：`memory.list({keyword})` 用 LIKE 扫 content；Memory 已有 FTS（P11）却未用。
- **推荐**：searchFts(entity=memory) 取 id → prisma.memory.findMany 回填；FTS 无命中/不可用回退 LIKE。
- **回答：同意。已实施。**

## R12. dashboard 13 count 合并为单 SQL

- **位置**：`apps/server/src/infra/analytics.ts` getAnalyticsDashboard
- **当前**：Promise.all 13 个 count/findMany（已 30s 缓存，但缓存 miss 时 13 路）。
- **推荐**：12 个 count 合并为一条 raw SQL（子查询），tokenUsage(JSON) 仍 findMany；2 查询替代 13。
- **回答：同意。已实施。**

## R13. post.list.keyword 走 FTS

- **位置**：`apps/server/src/services.ts` PostService.buildListWhere keyword（LIKE 扫 title+content）
- **推荐**：list override 时 keyword 先 searchFts 取 post id，buildListWhere 按 id 过滤；FTS 无命中回退 LIKE。
- **回答：同意。已实施。**

## R14. three.js（StarField）改 client 懒加载

- **位置**：`apps/web/components/home/HeroSection.tsx`、`apps/web/components/about/AboutView.tsx` 静态 import StarField（@react-three/fiber + three ~600KB）
- **问题**：首页 /about 初始 bundle 背 three.js，拖慢首屏。
- **推荐**：`next/dynamic` ssr:false 懒加载 StarField，three.js 拆到独立 client chunk，首屏 HTML/JS 不含 three。
- **回答：同意。已实施。** 验证：build 成功（/ 与 /about 静态生成通过）；admin-pages + blog-smoke E2E 30 passed（含 /、/about、/posts、/editor、/posts/[slug]）。

## 批次 12 自审记录

### 复核

- **R11**：FTS 优先 + LIKE 回退；services.prisma.memory.findMany 回填；agent.chat E2E 覆盖未破坏。
- **R12**：raw SQL 用子查询 12 count，SQLite 布尔用 =1，DateTime 比较 ISO 字符串；range.to 可选 lte；dashboard 测试（typeof number）通过。基准 16ms（小数据集，单 SQL vs 13 并行差距小，主要减少查询/parse 数）。
- **R13**：list override 注入 ftsIds（transient，as any），buildListWhere 优先 ftsIds else LIKE；super.list 复用分页/count/getListSelect；回退保证。

### 验证

server tsc ✅ / vitest **251 passed** ✅ / web build ✅ / mock E2E **11 passed** ✅

---

## 九、最终状态与剩余项（自审收尾）

### 已合并 master（安全面穷尽）

第一轮 28（P1–P12 + A1–A16）+ 第二轮 10（R1–R10）+ 硬茬 6（批次9）+ 验证 3（批次11）+ #5/#7（批次10）+ 第三轮 3（R11–R13，批次12）= **50 项**已合并 master。master 干净检出可构建、vitest 251 全绿、mock E2E 11 绿。

### 待合并（高风险分支，brutal 测试已绿，待真实 LLM E2E + 用户确认）

- 分支 `perf/p0-1-chat-messages-RISKY`：P0-1 Chat 消息加载彻底解耦（session 元数据 + message.listForChat 无限查询 + startReached 自动加载）。已含批次12 合并。brutal 全绿（vitest 251 / build / mock E2E 11）。**未合并**，建议补真实 LLM E2E（chat-thinking-real / chat-tool-hint-real / chat-queue-real，需 API Key）覆盖多轮 + 大会话向上滚动后合并。

### 唯一剩余有意义项（自审判定不 hastily 做）

- **Agent.list 排除 systemPrompt + Chat 改用 agent.getById 取 systemPrompt/model**
  - 收益：agent.list 载荷去掉 systemPrompt（~KB×100）。
  - 风险：getById 异步加载 → Chat chatConfig effect 时序（saved 配置 vs agent 默认）需重写，初次渲染可能短暂 undefined systemPrompt 后纠正；叠加 P0-1 已是第二次动 Chat 核心。
  - 处置：**留作独立后续**，建议在 P0-1 合并后、单独分支 + 真实 E2E 覆盖 chatConfig 初始化后再做，不与 P0-1 捆绑冒险。
  - apiKey 明文已修（批次9 formatEntity 剥离 + 回归测试），故此项纯性能而非性能+安全。

### 基准小结（dev.db: posts≈1316）

- post.search FTS 0ms vs LIKE 34ms → **~33x**（R1）
- post.list.keyword 同改 FTS（R13）；buildMemoryContext FTS 优先 + LIKE 回退（R11）
- dashboard 13 count → 单 SQL（R12，小数据集 16ms，主要减少查询/parse 数）
- session.getById 载荷：P0-1 解耦后由 500 条 → 0（元数据）+ 消息按需无限加载（待合并）
- swarmStats SQL groupBy 精确聚合（#9）；Run.list 裁剪（R6）

> 结论：不影响功能的安全高收益 + 中等风险可落地区间已穷尽。剩余 P0-1（待真实 E2E 合并）与 Agent.list 裁剪（待 P0-1 后单独做）两项需配套真实 E2E 与 Chat chatConfig 时序验证，不宜在无真实 LLM 环境下继续冒险。
