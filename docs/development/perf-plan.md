# KnowPilot 性能优化决策清单（第二轮 · 深度）

> 本文件遵循 AGENTS.md「设计决策 Q&A 流程」：每条问题包含「问题描述 / 推荐解决方式 / `回答：`」。
> **你只需在每条 `回答：` 后写回复**：不写 = 默认同意推荐方案；写了 = 我据此调整。
> 确认后我会把决策移入「已确认 ✅」并执行。

本轮聚焦**不影响功能**前提下的大幅性能提升，重点在**后端中间件 / 请求上下文层**（用户提示「中间件可能也需要改，或自己设计一个」）。已按收益与风险分级。

---

## 🔴 后端中间件 / 请求上下文层（收益最高）

### P1. createContext 每个请求执行 3 次 DB 查询注入凭据

- **位置**：`apps/server/src/trpc/context.ts:16-30`；`apps/server/src/infra/credentialVault.ts:160-201`
- **当前行为**：`createContext` 对每个 tRPC 请求都 `await injectIntegrationCredentials(config, prisma)`，其内部 `getIntegrationCredentials` 用 `Promise.all` 跑 `listCredentialsByScope(feishu/yuque/github)` 三次 DB 查询，并每次改写共享 `config.integrations`。
- **问题**：**每个 tRPC 请求（list / getById / mutation 全部）额外 3 次 DB 往返**，是后端单点最大开销；并发请求还会竞态改写共享 `config` 对象。Chat 页一次挂载数十个查询，开销被放大数十倍。
- **推荐解决方式**：自己设计一个 `credentialCache` 模块：
  1. 启动时加载一次凭据写入 `config.integrations`；
  2. 模块级缓存 + TTL（如 60s）兜底；
  3. `credential.create / update / delete / importFromEnv` 成功后调用 `refreshIntegrationCredentials()` 主动失效；
  4. `createContext` 只读缓存，**零 DB**。
- **风险/兼容**：需确保凭据 CRUD 路径都触发 refresh；`createContextInner`（测试）同样走缓存路径；现有测试不应感知差异。
- **回答：**

### P2. loggerMiddleware 每个 mutation 同步写 Log 表

- **位置**：`apps/server/src/trpc/trpc.ts:69-130`
- **当前行为**：每个 mutation 成功/失败都 `await ctx.prisma.log.create(...)`，在请求关键路径上多一次同步写。
- **问题**：每次增删改多一次 DB 写往返，批量操作时累计明显。
- **推荐解决方式**：改为 fire-and-forget（`void prisma.log.create(...).catch(()=>{})`，不 await）；或入内存环形缓冲由定时器批量 flush。错误日志可保留同步写入以保可靠。
- **风险/兼容**：进程崩溃可能丢最后几条审计日志；可接受（日志非业务关键路径）。
- **回答：**

### P3. loggerMiddleware 对 query 也调用 getRawInput

- **位置**：`apps/server/src/trpc/trpc.ts:74-79`
- **当前行为**：每个请求（含 query）都 `await opts.getRawInput()`，但 query 不写日志，属纯浪费。
- **推荐解决方式**：仅 `type === "mutation"` 时才取 `rawInput`；query 直接跳过。
- **风险/兼容**：无；仅影响日志元数据收集，query 本就不记日志。
- **回答：**

### P4. 前端缺少 httpBatchLink，并发查询不合并

- **位置**：`apps/web/lib/trpc.tsx:31-41`（当前用 `httpLink`）
- **当前行为**：Chat 页一次挂载发起 `agent.list / skill.list / session.list / workspace.list / agent.llmProviders / native.capabilities` 等多个查询，每个各走一个 HTTP 往返。
- **推荐解决方式**：用 `splitLink`：query 走 `httpBatchLink`（同 tick 多 query 合并单请求），mutation/subscription 走 `httpLink`。SSE 流式不走 tRPC，不受影响。
- **风险/兼容**：superjson + batch 兼容良好；需确认大 payload（file upload）不受 batch 影响（upload 走 mutation，已在 split 的非 batch 分支）。
- **回答：**

---

## 🟠 数据层索引

### P5. ChatMessage 缺 sessionId 索引（高收益）

- **位置**：`apps/server/prisma/schema.prisma:120-133`
- **当前行为**：`ChatMessage` 无 `@@index([sessionId])`。`session.getById` 取 messages、`message.list` 按 sessionId 过滤均为全表扫描。
- **问题**：消息量增长后，打开会话/翻历史越来越慢。
- **推荐解决方式**：加 `@@index([sessionId, createdAt])`，`pnpm db:migrate` 生成迁移并提交。
- **风险/兼容**：低；纯加索引，不改语义。
- **回答：**

### P6. ChatSession 缺 agentId 索引

- **位置**：`apps/server/prisma/schema.prisma:90-117`
- **当前行为**：Chat 侧边栏按 `agentId` 过滤 session 列表，无索引。
- **推荐解决方式**：加 `@@index([agentId, updatedAt])`。
- **风险/兼容**：低。
- **回答：**

---

## 🟠 SSE 流式传输

### P7. writeSse 每事件 2 次 res.write

- **位置**：`apps/server/src/infra/agentStream.ts:58-61`
- **当前行为**：每个 token 事件两次 `res.write`（`event:` 行 + `data:` 行），高频吐字下系统调用翻倍。
- **推荐解决方式**：合并为单次 `res.write(\`event: ${type}\ndata: ${json}\n\n\`)`。
- **风险/兼容**：无；SSE 协议兼容。
- **回答：**

### P8. SSE 缺 X-Accel-Buffering 响应头

- **位置**：`apps/server/src/infra/agentStream.ts:785-788`
- **当前行为**：未设置 `X-Accel-Buffering: no`。经 nginx / Cloudflare Tunnel 反代时 SSE 易被缓冲，前端收不到实时流（表现为「卡半天一次性吐完」）。
- **推荐解决方式**：`res.setHeader("X-Accel-Buffering", "no")`。
- **风险/兼容**：无；仅影响代理缓冲行为。
- **回答：**

---

## 🟡 响应传输

### P9. 缺少 compression 中间件

- **位置**：`apps/server/src/index.ts:60-68`
- **当前行为**：Express 未启用 gzip/br，session 详情（含全部 messages）、post 内容等大响应全量传输。
- **推荐解决方式**：加 `compression` 中间件，并对 `text/event-stream` 路径排除（SSE 不应压缩）。
- **风险/兼容**：localhost 收益小，远程/隧道明显；需确保 SSE 不被压缩。
- **回答：**

### P10. /health 每次查 DB

- **位置**：`apps/server/src/index.ts:71-89`
- **当前行为**：每次 health 调 `getEnrichedServerCapabilities` + `infoSource.list`（DB 查询）。
- **推荐解决方式**：capabilities 缓存（TTL 30–60s），health 不查 DB。
- **风险/兼容**：低；capabilities 变化低频。
- **回答：**

---

## 🟡 同步 / FTS

### P11. FTS 全量重建且 CRUD 不更新索引

- **位置**：`apps/server/src/infra/ftsIndex.ts:48-100`
- **当前行为**：`rebuildFtsIndex` 全量 `DELETE + INSERT`，仅 `db:sync` 调用；tRPC 对 post/agent/skill/memory 的 `create/update/delete` **不更新 FTS** → CRUD 写入的内容搜不到，直到下次 sync。这既是性能问题也是功能缺口。
- **推荐解决方式**：新增 `upsertFtsRow(entity, id, title, body)` / `deleteFtsRow(entity, id)`，在对应 Service 的 create/update/delete 后调用（增量）。`rebuildFtsIndex` 保留作为全量兜底。
- **风险/兼容**：中；需在各 Service 接入，可先接 post/agent/skill/memory 四类。
- **回答：**

---

## 🟢 前端数据层（补充，可选）

### P12. useCRUDApi mutation 后全量 invalidate

- **位置**：`apps/web/lib/hooks.ts:45-85`
- **当前行为**：`create/update/delete` 成功后 `utils[entity].list.invalidate()`，频繁小操作导致列表反复全量重请求。
- **推荐解决方式**：作为 `useCRUDApi` 的 options 扩展，提供「按 listInput 精确失效」或「乐观更新」选项，不强制改动现有调用方。
- **风险/兼容**：中；需逐实体评估是否启用。
- **回答：**

---

## 追加项（来自广度扫描，与上方不重复）

### 🔴 高收益

#### A1. WorkspaceTree 每个展开 Agent 独立查 session（前端 N+1）

- **位置**：`apps/web/components/workspaceTree.tsx:221-224`；后端 `services.ts:235-257` `session.list`
- **当前行为**：每个展开的 `AgentNode` 各发一次 `session.list({ agentId })`（findMany+count）。Swarm 模式左侧栏展开 N 个 Agent → 2N 次 DB。
- **问题**：Swarm 模式下左侧栏是持续热点，Agent 多时载入明显卡。
- **推荐解决方式**：后端新增 `session.listByAgentIds({ agentIds, ... })` 批量接口，一次拉回所有 agent 的会话；前端合并为 1 次请求后在内存按 `agentId` 分组。
- **风险/兼容**：低；需调整 WorkspaceTree 数据流。
- **回答：**

#### A2. buildAgentToolSchemas 对每个 Skill 单独查库（N+1）

- **位置**：`apps/server/src/infra/agentTools.ts:238-246`；`skillRunner.ts:20-26`
- **当前行为**：解析 Agent 工具时，对每个 skill 调 `findSkillByName` → 每次 `skill.list({ keyword })`。10 个 skill → 10 次 list 查询。
- **问题**：每次 Agent 运行都走这条路径，是 Agent 运行时单点开销。
- **推荐解决方式**：改 `skill.findUnique({ where: { name } })`（`Skill.name` 已 `@unique`），或一次 `findMany({ where: { name: { in: [...] } } })` 批量加载。
- **风险/兼容**：低。
- **回答：**

#### A3. agent.list 列表返回完整大字段

- **位置**：`apps/server/src/services.ts:754-766`（`AgentService` 无 `getListSelect`，对比 `PostService` 已有）
- **当前行为**：`agent.list` 返回完整 `systemPrompt`、`tools` 等大字段。Agent 管理页、Chat 侧边栏、AgentTreeSelect 都拿全量。
- **问题**：列表载荷偏大，Agent 多时管理页载入慢。
- **推荐解决方式**：仿 `PostService.getListSelect` 加列表字段裁剪，列表只返 metadata；编辑器/详情走 `getById` 取全量。
- **风险/兼容**：低；需确认前端列表未直接用 systemPrompt（应只用 getById）。
- **回答：**

### 🟠 中等收益

#### A4. session.stop / rerun 拉取 500 条消息

- **位置**：`apps/server/src/router.ts` `session.stop`/`rerun` → `services.ts:1094-1101` `session.getById`（`include: { messages: { take: 500 } }`）
- **当前行为**：stop/rerun 只需 `kind/status`，却连带 500 条消息。
- **推荐解决方式**：新增轻量 `getByIdLite`（无 include），stop/rerun 改用之。
- **风险/兼容**：低。
- **回答：**

#### A5. agentStream 编辑消息时循环逐条 delete

- **位置**：`apps/server/src/infra/agentStream.ts:398-400`
- **当前行为**：编辑消息后删除 K 条尾部消息用 `for` 循环 `await message.delete` → K 次往返。
- **推荐解决方式**：改 `prisma.chatMessage.deleteMany({ where: { id: { in: ids } } })`。
- **风险/兼容**：低。
- **回答：**

#### A6. agent.bulkDelete 循环逐条删除

- **位置**：`apps/server/src/router.ts:117-124`
- **当前行为**：循环 `await agent.delete`，每条含 findUnique + delete + 写回 Markdown。
- **推荐解决方式**：`deleteMany` + 批量文件操作，或 `$transaction` 合并；保留审批/事件语义。
- **风险/兼容**：中；需保留事件触发与 Markdown 写回。
- **回答：**

#### A7. SSE probe 短路路径逐字符 emit

- **位置**：`apps/server/src/infra/agentStream.ts:273-274`（`probe.content.split("")`）
- **当前行为**：probe 短路时把 content 按字符 split 后逐字符 emit token，中文长文 → 字符级 SSE 风暴。
- **推荐解决方式**：按词/句切分，或直接整段发一个 `token` 事件。
- **风险/兼容**：低；前端已按 delta 累积，整段也能正确拼接。
- **回答：**

#### A8. pullAsyncQueue 无条件 2.5s 轮询

- **位置**：`router.ts:145-151`；`chat.tsx:798-803`
- **当前行为**：有 `effectiveSessionId` 时每 2.5s 轮询 `pullAsyncQueue`（含 raw UPDATE + findMany），无论是否真的有待投递。
- **推荐解决方式**：仅在有活跃异步任务时轮询（参照 `listChildren` 的 running 判断）；或合并 `pullAsyncQueue`+`asyncQueueStats` 为单端点减少 HTTP 往返。
- **风险/兼容**：中；需前端判断「是否有 running async job」条件。
- **回答：**

#### A9. agentSchemaCache 无失效

- **位置**：`apps/server/src/infra/agentTools.ts:143-261`
- **当前行为**：按 tools 配置缓存 schema，但 skill/mcp 变更后 stale 到进程重启。
- **推荐解决方式**：EventBus 监听 `skill.updated/deleted`、`mcp.updated/deleted` 清 `agentSchemaCache`。
- **风险/兼容**：低。
- **回答：**

#### A10. native.capabilities 用 infoSource.list 取 total

- **位置**：`router.ts:578-583`；`hooks.ts:260-262`
- **当前行为**：capabilities 里用 `infoSource.list({ page:1, pageSize:1 })` 取 total，实际多取了一页数据。
- **推荐解决方式**：改 `infoSource.count({ where: { enabled: true } })`，或进程缓存 + 变更失效。
- **风险/兼容**：低。
- **回答：**

#### A11. Run / Log / Approval / Skill 补索引

- **位置**：`schema.prisma` Run(无索引)、Log(无索引)、Approval(无 status 索引)、Skill(无 enabled 索引)
- **当前行为**：dashboard 多次 count、mutation 日志持续增长、审批页按 status 过滤、`skill.list({enabled:true})` 高频，均无索引支撑。
- **推荐解决方式**：
  - Run: `@@index([agentId, status])`、`@@index([sessionId])`、`@@index([createdAt])`
  - Log: `@@index([level, createdAt])`、`@@index([component])`
  - Approval: `@@index([status, createdAt])`
  - Skill: `@@index([enabled])`
- **风险/兼容**：低；纯加索引。可与 P5/P6 合并到一次迁移。
- **回答：**

#### A12. agentStream 结束时 message.create + run.create 未合并事务

- **位置**：`apps/server/src/infra/agentStream.ts:656-684`
- **当前行为**：流结束时分两次写 `message.create` 与 `run.create`，2 次 commit。
- **推荐解决方式**：`prisma.$transaction([...])` 合并。
- **风险/兼容**：低。
- **回答：**

### 🟢 低收益 / 可选

#### A13. sync watch 仍全目录 scan

- **位置**：`apps/server/src/scripts/sync.ts:60-93`
- **当前行为**：watch 触发（300ms 防抖后）仍对整个 content 目录 `getFilesRecursive` 全扫，再按 mtime 决定 upsert。
- **推荐解决方式**：watch 时只处理 `eventPath` 单文件；全量 scan 仅 startup 一次。
- **风险/兼容**：中；需改 syncer 接口支持单文件入参。
- **回答：**

#### A14. heartbeatEngine 每 60s 全量重建 cron

- **位置**：`apps/server/src/infra/heartbeatEngine.ts:63-64,75-86`
- **当前行为**：每 60s `agent.findMany` 全量重建 cron job 表。
- **推荐解决方式**：监听 `agent.updated` 事件增量更新 job，去掉轮询重建。
- **风险/兼容**：低。
- **回答：**

#### A15. post.getBySlug 每次 viewCount increment

- **位置**：`apps/server/src/services.ts:527-529`
- **当前行为**：每次读文章详情都同步 `viewCount increment`，高流量文章 2 倍写。
- **推荐解决方式**：异步批量更新 viewCount，或内存计数定时 flush。
- **风险/兼容**：中；统计精度略降。
- **回答：**

#### A16. Chat 页 skill.list 无 staleTime

- **位置**：`apps/web/components/chat.tsx:740`
- **当前行为**：每次进 Chat 都 `skill.list({ pageSize:100, enabled:true })`，无 staleTime。
- **推荐解决方式**：前端 `staleTime: 5min`；skill 变更时 invalidate。
- **风险/兼容**：极低。
- **回答：**

---

## 已确认 ✅

全部 28 条已确认同意推荐方案（用户回答汇总见文件末尾）。实现时额外注意以下提醒：

| 编号 | 决策 | 备注/提醒 |
|---|---|---|
| P1 | createContext 凭据注入改缓存 | `credential.importFromEnv` 等批量导入路径也触发 refresh；`createContextInner` 测试路径走缓存 |
| P2 | loggerMiddleware 成功日志 fire-and-forget | **错误日志保留同步写入**以保证可靠性 |
| P3 | loggerMiddleware 仅 mutation 取 rawInput | — |
| P4 | 前端 splitLink + httpBatchLink | `file.upload` 等大 payload mutation 不走 batch |
| P5 | ChatMessage 加 `@@index([sessionId, createdAt])` | 与 A11 合并迁移 |
| P6 | ChatSession 加 `@@index([agentId, updatedAt])` | 与 A11 合并迁移 |
| P7 | writeSse 合并单次 res.write | — |
| P8 | SSE 加 `X-Accel-Buffering: no` | — |
| P9 | 加 compression 中间件 | **排除 SSE 路径**，避免流式被压缩缓冲 |
| P10 | /health capabilities 缓存 | **保留轻量 DB 连通性检查**，DB 挂时返回非 200 |
| P11 | FTS 增量 upsert/delete | 先接 post/agent/skill/memory 四类 |
| P12 | useCRUDApi options 扩展精确失效 | 不强制改动现有调用方 |
| A1 | WorkspaceTree 批量 listByAgentIds | 后端新增批量接口 |
| A2 | buildAgentToolSchemas 批量查 Skill | `findMany({ name: { in: [...] } })` |
| A3 | agent.list 加 getListSelect 字段裁剪 | — |
| A4 | session.stop/rerun 用 getByIdLite | — |
| A5 | agentStream 编辑消息改 deleteMany | — |
| A6 | agent.bulkDelete 批量删除 | 保留审批/事件/Markdown 写回语义 |
| A7 | SSE probe 按词/句或整段 emit | — |
| A8 | pullAsyncQueue 条件轮询 | 参照 listChildren running 判断 |
| A9 | agentSchemaCache 监听事件失效 | EventBus skill/mcp 变更 |
| A10 | native.capabilities 改 infoSource.count | — |
| A11 | Run/Log/Approval/Skill 补索引 | 与 P5/P6 合并迁移 |
| A12 | agentStream 结束写合并 $transaction | — |
| A13 | sync watch 单文件增量 | 改 syncer 接口 |
| A14 | heartbeatEngine 事件驱动增量 cron | — |
| A15 | post.getBySlug viewCount 异步批量 | — |
| A16 | Chat skill.list staleTime 5min | — |

**执行批次**：① P1→P2/P3→P4→P5/P6+A11→A1→A2 ② P7/P8→P11→A4→A5/A6→A12 ③ P9→P10→A7→A8→A9→A10→A16 ④ A13→A14→A15

---

> 扫描结论摘要：后端最大单点开销是 **P1（createContext 每请求 3 次 DB 注入凭据）**；前端 Swarm UI 最大开销是 **A1（WorkspaceTree N+1）**；Agent 运行时最大开销是 **A2（Skill N+1）**。这三项 + **P5/A11（索引）** + **P2/P3（loggerMiddleware）** 构成「不影响功能、收益最大」的核心批次。


---

## 回答汇总（按文件出现顺序）

> 由 AI 助手统一填写，默认同意推荐方案；含提醒项已标注 ⚠️。

1. **P1 createContext 每请求 3 次 DB 查询注入凭据** — **同意**。这是后端最大单点开销，必须做。⚠️ 提醒：`credential.importFromEnv` 等批量导入路径也要触发 refresh；`createContextInner` 测试路径同样走缓存，避免测试特殊处理。
2. **P2 loggerMiddleware 每个 mutation 同步写 Log 表** — **同意**。成功/普通审计日志改为 fire-and-forget；错误日志建议保留同步写入以保证可靠性。
3. **P3 loggerMiddleware 对 query 也调用 getRawInput** — **同意**。query 本就不记日志，跳过 `getRawInput` 零风险。
4. **P4 前端缺少 httpBatchLink** — **同意**。Chat 页并发查询多，batch 收益明显。⚠️ 提醒：用 `splitLink` 确保 `file.upload` 这类大 payload mutation 不走 batch，避免 payload 过大。
5. **P5 ChatMessage 缺 sessionId 索引** — **同意**。必须加，消息量增长后这是打开会话/翻历史的关键瓶颈。
6. **P6 ChatSession 缺 agentId 索引** — **同意**。Chat 侧边栏按 agentId 过滤高频，加索引收益稳定。
7. **P7 writeSse 每事件 2 次 res.write** — **同意**。合并为单次 `res.write`，零风险，高频吐字下减少系统调用。
8. **P8 SSE 缺 X-Accel-Buffering 响应头** — **同意**。加 `X-Accel-Buffering: no` 对 nginx/Cloudflare Tunnel 场景是必要修复。
9. **P9 缺少 compression 中间件** — **同意**。localhost 收益小，远程/隧道明显。⚠️ 提醒：务必排除 SSE 路径，避免流式被压缩缓冲。
10. **P10 /health 每次查 DB** — **同意**。⚠️ 提醒：capabilities 可缓存，但建议 health 仍保留一个轻量级 DB 连通性检查，避免 DB 挂掉时 health 仍返回 200。
11. **P11 FTS 全量重建且 CRUD 不更新索引** — **同意**。这既是性能问题也是功能缺口。建议先接入 post/agent/skill/memory 四类实体的增量更新。
12. **P12 useCRUDApi mutation 后全量 invalidate** — **同意**。作为 `useCRUDApi` 的 options 扩展，不强制改动现有调用方，风险可控。
13. **A1 WorkspaceTree 每个展开 Agent 独立查 session** — **同意**。WorkspaceTree N+1 是 Swarm UI 最大卡顿源，后端新增 `listByAgentIds` 批量接口是正确方向。
14. **A2 buildAgentToolSchemas 对每个 Skill 单独查库** — **同意**。Agent 运行时每次都要解析 skill，改 `findMany({ name: { in: [...] } })` 最简洁低风险。
15. **A3 agent.list 列表返回完整大字段** — **同意**。仿 `PostService.getListSelect` 加字段裁剪，列表只返回 metadata，编辑器/详情走 `getById`。
16. **A4 session.stop / rerun 拉取 500 条消息** — **同意**。stop/rerun 只需 kind/status，新增 `getByIdLite` 轻量接口。
17. **A5 agentStream 编辑消息时循环逐条 delete** — **同意**。改为 `prisma.chatMessage.deleteMany({ id: { in: ids } })`，单次往返。
18. **A6 agent.bulkDelete 循环逐条删除** — **同意**。当前循环单删含文件写回，建议保留语义前提下用 `deleteMany` + 批量文件操作或 `$transaction`。
19. **A7 SSE probe 短路路径逐字符 emit** — **同意**。probe 逐字符 emit 中文长文时会形成 SSE 风暴，按词/句切分或整段发送。
20. **A8 pullAsyncQueue 无条件 2.5s 轮询** — **同意**。改为仅当有 running async job 时才轮询，可参照 `listChildren` 的 running 判断逻辑。
21. **A9 agentSchemaCache 无失效** — **同意**。通过 EventBus 监听 skill/mcp 变更事件清缓存，避免 stale schema。
22. **A10 native.capabilities 用 infoSource.list 取 total** — **同意**。改 `infoSource.count({ where: { enabled: true } })`，避免多取一页数据。
23. **A11 Run / Log / Approval / Skill 补索引** — **同意**。纯加索引，可与 P5/P6 合并到一次迁移。
24. **A12 agentStream 结束时 message.create + run.create 未合并事务** — **同意**。流结束时两次写合并为 `prisma.$transaction([...])`。
25. **A13 sync watch 仍全目录 scan** — **同意**。watch 触发时只处理变更的单个文件，全量 scan 仅 startup 一次。
26. **A14 heartbeatEngine 每 60s 全量重建 cron** — **同意**。改为事件驱动增量更新 cron job，去掉 60s 轮询重建。
27. **A15 post.getBySlug 每次 viewCount increment** — **同意**。建议内存计数 + 定时 flush，或后续用 Redis 计数。
28. **A16 Chat 页 skill.list 无 staleTime** — **同意**。给 `skill.list` 加 `staleTime: 5min`，skill 变更时 invalidate。

---

## 建议执行批次

如果进入实施阶段，建议按以下顺序落地：

**第一批（核心高收益）**：P1 → P2/P3 → P4 → P5/P6 + A11 索引 → A1 → A2  
**第二批（SSE 与数据层）**：P7/P8 → P11 → A4 → A5/A6 → A12  
**第三批（体验优化）**：P9 → P10 → A7 → A8 → A9 → A10 → A16  
**第四批（可选）**：A13 → A14 → A15

> AI 助手结论：计划整体合理，无需要推翻的项，仅个别实现细节（P1 批量导入失效、P4 file.upload 排除 batch、P9 SSE 排除压缩、P10 health 保留 DB 连通性检查）需要在编码时额外注意。
