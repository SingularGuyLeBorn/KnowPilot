# KnowPilot 整改计划

> 本文档按重要性排列 KnowPilot 项目审视发现的所有不合理实现，逐项给出**问题定位、修复方案、验证方式、状态**。从上往下挨个解决，每完成一批即提交并更新状态。
>
> - **创建日期**：2026-07-07
> - **审视范围**：services / router / nativeTools / sync / prisma / trigger / credentialVault / autoCompact / web / shared / docs（Mock/Chat/agentStream 已在上一轮审视中修复，不再列入）
> - **状态图例**：⬜ 待办 / 🟦 进行中 / ✅ 已完成 / ⏸️ 暂缓（附理由）

---

## 优先级总览

| ID | 严重度 | 标题 | 状态 |
|---|---|---|---|
| P0-1 | 🔴 严重 | 凭据 API 明文返回 + `ai.invoke` 可读 | ✅ |
| P0-2 | 🔴 严重 | 无 `CREDENTIAL_MASTER_KEY` 时凭据明文落库 | ✅ |
| P0-3 | 🔴 严重 | Git 仓库 `repoId`/`repoPath` 路径绕过沙箱 | ✅ |
| P0-4 | 🔴 严重 | `ai.invoke` 反射面过大，审批覆盖不全 | ✅ |
| P0-5 | 🔴 严重 | Sync `cleanup` 可能批量误删 DB 记录 | ✅ |
| P1-1 | 🟡 中等 | 静态资源无鉴权 + Token 设计薄弱 | ✅ |
| P1-2 | 🟡 中等 | TriggerEngine 阻塞 + 并发重入 | ✅ |
| P1-3 | 🟡 中等 | TaskScheduler 无重叠保护 | ✅ |
| P1-4 | 🟡 中等 | Task sync 覆盖运行时状态 | ✅ |
| P1-5 | 🟡 中等 | Credential 缓存不清理 + scope 子串匹配 | ✅ |
| P1-6 | 🟡 中等 | 错误处理不一致（CRUD vs getById vs JSON.parse） | ✅ |
| P1-7 | 🟡 中等 | 性能隐患（列表全 content / 会话全消息 / FTS 阻塞 / N+1） | ✅ |
| P1-8 | 🟡 中等 | Prisma 几乎无外键，删 Agent/Task 留孤儿 | ✅ |
| P1-9 | 🟡 中等 | Skill `node:vm` 沙箱逃逸面 | ⏸️ |
| P1-10 | 🟡 中等 | Trigger 日志可能泄露敏感数据 | ✅ |
| P1-11 | 🟡 中等 | `assertUnique` 竞态 | ✅ |
| P2-1 | 🟢 轻微 | `nativeTools.ts` 过大（~2546 行） | ⏸️ |
| P2-2 | 🟢 轻微 | 死代码（`internalProcedure` / `runSync`） | ⬜ |
| P2-3 | 🟢 轻微 | 类型安全（Service `any` / `ai.invoke` args） | ⏸️ |
| P2-4 | 🟢 轻微 | 分页不一致（messages pageSize=200 vs 100） | ⬜ |
| P2-5 | 🟢 轻微 | `autoCompact` 静默降级 | ⏸️ |
| P2-6 | 🟢 轻微 | `recoverStaleAsyncJobs` 仅启动时跑一次 | ⏸️ |
| P2-7 | 🟢 轻微 | Post 软删不触发 EventBus | ⬜ |
| D-1 | 📋 文档 | entity-matrix 补 InfoSource，"18 实体"改 19 | ⬜ |
| D-2 | 📋 文档 | E2E 文件名清单更新（chat-thinking 拆分等） | ⬜ |
| D-3 | 📋 文档 | `docs/development/README.md` 索引路径修正 | ⬜ |
| D-4 | 📋 文档 | 新增 `.dev-log` 记录封板后演进 | ⬜ |

---

## P0 — 严重（安全/数据丢失，公网部署即灾难）

### P0-1 凭据 API 明文返回 + `ai.invoke` 可读

- **定位**：`apps/server/src/services.ts:1400`（`CredentialService.formatEntity`）；`apps/server/src/router.ts:465-470`（`credentialRouter`）
- **问题**：
  - `formatEntity` 解密后原样返回 `value`，前端 `credential.list`/`getById` 直接拿到明文密钥。
  - `credential.*` 全部 `aiReadable: true`，Agent 通过 `ai.invoke` 可反射调用 `list` 拖走全部密钥。
  - 默认 `AUTH_MODE=none` 时局域网内任何人可读。
- **修复方案**：
  1. `CredentialService.formatEntity` 不返回明文 `value`，改为 `valuePreview: maskSecret(raw.value)`（仅留末 4 位，前缀 `••••`）。
  2. `credential.getById` / `credential.list` 的 `meta.aiReadable` 改为 `false`（Agent 不可读）。
  3. `create` / `update` / `delete` / `importFromEnv` 保留 `aiReadable: true`（写操作不泄露密钥本身）。
  4. `importFromEnv` 返回值已是 count，无需改。
- **验证**：
  - 单测：`credential.list` 返回的 item 不含明文 `value`，只有 `valuePreview`。
  - 单测：`ai.invoke({ path: "credential.list" })` 在无审批时被拒（`aiReadable: false`）。
  - 手动：前端 `/credentials` 页面显示掩码而非明文。

### P0-2 无 `CREDENTIAL_MASTER_KEY` 时凭据明文落库

- **定位**：`apps/server/src/infra/credentialVault.ts:31-33`
- **问题**：`encryptCredentialValue` 无 master key 时 `return plain`，SQLite `dev.db` 被复制即泄露全部密钥。
- **修复方案**：
  1. 无 `CREDENTIAL_MASTER_KEY` 时，**生产模式**（`NODE_ENV=production`）启动即 `throw`，拒绝明文落库。
  2. 开发模式（`NODE_ENV !== production`）保留明文回退，但启动时 `console.warn` 警告。
  3. 在 `index.ts` 启动检查中加该护栏（与现有 Mock 护栏同位置）。
- **验证**：
  - 单测：`NODE_ENV=production` 且无 key 时 `encryptCredentialValue` 抛错。
  - 单测：开发模式无 key 时 warn 但不抛。

### P0-3 Git 仓库 `repoId`/`repoPath` 路径绕过沙箱

- **定位**：`apps/server/src/infra/nativeTools.ts:1266-1273`（`resolveRepoPath`）；`apps/server/src/services.ts:1133-1140`（`GitService.resolveRepoPath`）
- **问题**：
  - `nativeTools.resolveRepoPath`：`repoPath` 走 `resolveSafePath`，但 `repoId` 直接返回 DB 里的 `repo.path`，无根目录校验。
  - `GitService.resolveRepoPath`：`repoPath` 参数**零校验**，直接当 `cwd`。
  - `safePathString` 仅禁 `..`，**允许任意绝对路径**（`C:\`、`D:\`）。注册一个 GitRepo 指向 `C:\Windows` 后 Agent 可对其 `git add -A`。
- **修复方案**：
  1. 抽公共 `assertPathWithinProjectRoot(config, absPath)` 工具，所有 Git 路径解析必经此校验。
  2. `nativeTools.resolveRepoPath`：`repoId` 分支拿到 `repo.path` 后也走 `assertPathWithinProjectRoot`。
  3. `GitService.resolveRepoPath`：`repoPath` 分支同样走 `resolveSafePath`（不再裸返）。
  4. `GitService` 创建/更新时校验 `path` 必须在 `projectRoot` 下（堵住注册阶段）。
- **验证**：
  - 单测：注册 `path: "C:/Windows"` 的 GitRepo 被拒。
  - 单测：`nativeTools` 用 `repoId` 指向项目外路径时抛错。

### P0-4 `ai.invoke` 反射面过大，审批覆盖不全

- **定位**：`apps/server/src/router.ts`（`ai.invoke`）；`apps/server/src/infra/approvalGate.ts`
- **问题**：`ai.invoke` 可调用几乎所有 `aiReadable` 路由；审批仅覆盖 6 个 delete + `git.push`。`credential.*`、`git.commit/pull`、`log.clearAll`、`session.delete`、`native.execute`（含 `write_file`/`run_shell`）、`workspace.create`（任意磁盘路径）均无审批。
- **修复方案**（分两步）：
  1. **第一步（本轮）**：把高风险路由的 `aiReadable` 收紧——`log.clearAll` 改 `false`；`session.delete` 改 `false`；`workspace.create` 改 `false`（Agent 不该建工作区）。`git.commit/pull` 保留 `true` 但加入 `approvalGate`（与 `git.push` 同档）。
  2. **第二步（后续）**：`native.execute` 的 `write_file`/`run_shell`/`session_clear` 在 Agent 调用时强制审批（已有部分逻辑，需补全）。
- **验证**：
  - 单测：`ai.invoke({ path: "log.clearAll" })` 被拒。
  - 单测：`ai.invoke({ path: "git.commit" })` 触发审批。

### P0-5 Sync `cleanup` 可能批量误删 DB 记录

- **定位**：`apps/server/src/scripts/sync/sync-posts.ts:88-96`；其余 `sync-*.ts` 同模式
- **问题**：
  - `cleanup` 策略：扫描不到的 slug → **硬删** DB 行，与 Post 软删/回收站语义冲突。
  - `content/posts` 为空或目录配错 → 清空所有未软删文章 DB 行。
  - 单文件**解析失败**未进入 `records` → 文件仍在磁盘但 DB 被删。
  - `sync-posts` upsert 写 `deletedAt: null`，会"复活"已软删文章。
- **修复方案**：
  1. `cleanup` 改为**软删**（设 `deletedAt`），不再硬删；与 `PostService.delete` 语义一致。
  2. 解析失败的文件计入 `parseFailedSlugs`，`cleanup` 跳过这些 slug（不删）。
  3. `sync-posts` upsert **不覆盖** `deletedAt`：若 DB 已有 `deletedAt` 且磁盘文件未显式恢复，保留 DB 的 `deletedAt`。
  4. 加防御：`activeSlugs.length === 0` 时 `cleanup` 直接跳过并 warn（避免空目录清库）。
- **验证**：
  - 单测：空 `content/posts` 时 `cleanup` 不删任何 DB 行。
  - 单测：解析失败的 slug 不被 cleanup 删。
  - 单测：已软删文章 upsert 后 `deletedAt` 仍保留。

---

## P1 — 中等（功能/性能/一致性，影响日常使用）

### P1-1 静态资源无鉴权 + Token 设计薄弱

- **定位**：`apps/server/src/index.ts`（静态托管中间件）；`apps/server/src/infra/config.ts`（`AUTH_TOKEN` 回退）
- **问题**：`/uploads`、`/api/posts/assets` 在 `AUTH_MODE=password` 下也裸奔；`AUTH_TOKEN` 默认回退为 `AUTH_PASSWORD`（同值、无过期、无轮换）。
- **修复方案**：
  1. `AUTH_MODE=password` 时，静态资源中间件也走 token 校验（复用 `authMiddleware`）。
  2. `AUTH_TOKEN` 不再回退 `AUTH_PASSWORD`；未设则启动时生成一次性 token 并打印一次。
  3. 文档（`.env.example`）说明 token 轮换方式。
- **验证**：`AUTH_MODE=password` 时无 token 访问 `/uploads/x.png` 返回 401。

### P1-2 TriggerEngine 阻塞 + 并发重入

- **定位**：`apps/server/src/infra/triggerEngine.ts`
- **问题**：`executeAgent` 在事件处理器内同步 await 完整 Agent 循环，阻塞后续事件；`eventBus.emit` 不 await，同任务可并行跑。
- **修复方案**：引入 per-`taskId`/per-`triggerId` 互斥锁（`Map<id, Promise>`）；事件处理器改为入队异步消费，不阻塞 emit。
- **验证**：单测：同 taskId 并发 emit 两次，第二次被跳过或排队。

### P1-3 TaskScheduler 无重叠保护

- **定位**：`apps/server/src/infra/taskScheduler.ts`
- **问题**：`node-cron` 触发不查 `status === "running"`，长任务叠跑。
- **修复方案**：cron 触发前查 DB `status`，`running` 则跳过并记 log。
- **验证**：单测：任务 running 时 cron 触发被跳过。

### P1-4 Task sync 覆盖运行时状态

- **定位**：`apps/server/src/scripts/sync/sync-tasks.ts`
- **问题**：upsert 把 JSON 里的 `status` 写回 DB，`db:sync` 运行中会把 `running` 任务重置为文件里的 `pending/success`。
- **修复方案**：`sync-tasks` upsert **不覆盖** `status`/`lastRunAt`/`result` 等运行时字段；仅同步配置字段（cron、input、agentId 等）。
- **验证**：单测：DB `running` 任务 sync 后仍 `running`。

### P1-5 Credential 缓存不清理 + scope 子串匹配

- **定位**：`apps/server/src/infra/credentialVault.ts:84-100`（`listCredentialsByScope`）；`apps/server/src/services.ts`（CredentialService CRUD）
- **问题**：CRUD 不调 `clearCredentialCache()`，30s 缓存返回旧密钥；`scope: { contains: scope }` 子串匹配，`"llm"` 误命中 `"myllm"`。
- **修复方案**：
  1. `CredentialService.create/update/delete` 后调 `clearCredentialCache()`。
  2. `listCredentialsByScope` 改精确匹配：DB 存逗号分隔，查询用 `scope: { in: [scope, ...含 scope 的组合] }` 或拉全量后内存过滤。
- **验证**：单测：update 后立刻 list 拿到新值；scope `"llm"` 不命中 `"myllm"`。

### P1-6 错误处理不一致

- **定位**：`apps/server/src/services.ts`（BaseService）；`credentialVault.ts:72`（`JSON.parse(metadata)`）
- **问题**：`create/update/delete` 返回 `OperationResult`，`getById` 直接 `throw`；`formatCredential` 的 `JSON.parse` 无 try/catch，坏数据致 list 崩。
- **修复方案**：
  1. `formatCredential`/`formatEntity` 的 `JSON.parse` 包 try/catch，失败返回 `null` 并 warn。
  2. 统一 `getById` 风格（保留 throw，但确保所有实体一致）。
- **验证**：单测：坏 `metadata` 不致 list 崩，返回 `metadata: null`。

### P1-7 性能隐患

- **定位**：`services.ts`（`PostService.list`、`SessionService.getById`）；`ftsIndex.ts`（`rebuildFtsIndex`）；`mapFtsHits`
- **问题**：列表带完整 `content`；会话 `include: { messages: true }` 无分页；FTS 全量阻塞重建；`mapFtsHits` N+1。
- **修复方案**：
  1. `PostService.list` 默认 select 不含 `content`，加 `includeContent?: boolean` 参数。
  2. `SessionService.getById` 的 messages 加 `take` 限制（如最近 200 条）+ 总数。
  3. `rebuildFtsIndex` 改事务内批量 `INSERT`，或加 `CREATE VIRTUAL TABLE IF NOT EXISTS` + 原子 swap。
  4. `mapFtsHits` 改 `findMany` + Map 索引，消除 N+1。
- **验证**：单测：`post.list` 返回项不含 `content`；`session.getById` messages 数 ≤ 上限。

### P1-8 Prisma 几乎无外键

- **定位**：`apps/server/prisma/schema.prisma`
- **问题**：仅 `ChatMessage → ChatSession` Cascade；删 Agent/Task 后留孤儿引用。
- **修复方案**：补 `ChatSession.agentId`、`Run.agentId/sessionId`、`Trigger.actionId`、`Log.*Id` 等外键 + `onDelete: Restrict` 或 `Cascade`（按语义）。需 `prisma migrate`。
- **验证**：删除有 Run 的 Agent 时按策略拒/级联。

### P1-9 Skill `node:vm` 沙箱逃逸面

- **状态**：⏸️ 暂缓 — 本地单用户场景可接受，且替换为 isolated-vm 是较大改造，留待 L6+。

### P1-10 Trigger 日志可能泄露敏感数据

- **定位**：`apps/server/src/infra/triggerEngine.ts`
- **问题**：完整 `eventPayload` 写入 `Log.metadata`，若含凭据/消息正文会持久化。
- **修复方案**：写 log 前对 `eventPayload` 做脱敏（截断长字符串、遮蔽 `*token*`/`*secret*`/`*key*` 字段）。
- **验证**：单测：含 `password` 字段的 payload 写 log 后被遮蔽。

### P1-11 `assertUnique` 竞态

- **定位**：`apps/server/src/services.ts`（`BaseService.assertUnique`）
- **问题**：`findFirst` 无事务/唯一约束兜底，并发 create 可能 P2002 未被友好转化。
- **修复方案**：catch `PrismaClientKnownRequestError` with `P2002`，转 `TRPCError(CONFLICT, 友好 message)`。
- **验证**：单测：并发 create 同名触发 CONFLICT 而非 500。

---

## P2 — 轻微（代码质量，不影响功能）

### P2-1 `nativeTools.ts` 过大（~2546 行）

- **状态**：⏸️ 暂缓 — 符合 AGENTS "单文件收拢" 原则，拆分需先与项目规范对齐。

### P2-2 死代码

- **定位**：`router.ts`（`internalProcedure` 未用）；`sync.ts`（`runSync` 标 `@deprecated`）
- **修复方案**：删除未用 import；`runSync` 直接删或标注 `// TODO L6 remove`。
- **验证**：lint 通过。

### P2-3 类型安全

- **状态**：⏸️ 暂缓 — Service 层 `any` 是 Prisma delegate 泛化代价，全量收紧工作量过大，留待 L6+。

### P2-4 分页不一致

- **定位**：`packages/shared/src/schemas.ts`（`listMessagesSchema` pageSize max=200）
- **修复方案**：统一为 100（或显式说明 messages 为何允许 200）。
- **验证**：zod 解析 pageSize=150 在 messages 仍通过 / 其余实体失败。

### P2-5 `autoCompact` 静默降级

- **状态**：⏸️ 暂缓 — 当前 `console.warn` 已足够，用户侧反馈留待 UX 改造。

### P2-6 `recoverStaleAsyncJobs` 仅启动时跑

- **状态**：⏸️ 暂缓 — 加周期巡检需谨慎（进程 hang 检测复杂），留待 L6+。

### P2-7 Post 软删不触发 EventBus

- **定位**：`apps/server/src/services.ts`（`PostService.delete` override）
- **问题**：覆写后不调 `afterDelete`，`post.deleted` 触发器永远不触发。
- **修复方案**：override 末尾调 `this.afterDelete?.(existing)` 或显式 emit `post.deleted`。
- **验证**：单测：Post 软删后 `post.deleted` 事件被 emit。

---

## D — 文档同步

### D-1 entity-matrix 补 InfoSource

- **定位**：`docs/development/entities/entity-matrix.md`
- **修复**：新增 `InfoSource` 行；"18 实体"措辞改 19。

### D-2 E2E 文件名清单更新

- **定位**：`docs/development/frontend/e2e-testing.md`；`AGENTS.md` 测试表
- **修复**：`chat-thinking.spec.ts` → `chat-thinking-real.spec.ts` / `chat-thinking-mock.spec.ts`；补 `post-trash`、`ui-components`、`chat-*-mock`；路由数 19 → 20。

### D-3 索引路径修正

- **定位**：`docs/development/README.md:30`
- **修复**：`docs/development/deployment/cloudflare-tunnel.md` → `docs/deployment/cloudflare-tunnel.md`。

### D-4 新增 `.dev-log` 记录封板后演进

- **定位**：`.dev-log/`
- **修复**：新增 `session-2026-07-07.md`，记录 Mock E2E 体系落地、chatHistory 扁平格式重构、本次审视与整改计划。

---

## 进度跟踪

| 批次 | 范围 | 状态 |
|---|---|---|
| 第 1 批 | P0-1 ~ P0-5（严重安全/数据） | ✅ 已完成（vitest 228 passed） |
| 第 2 批 | P1-1 ~ P1-6 + P1-10（中等） | ✅ 已完成（vitest 228 passed） |
| 第 3 批 | P1-7 ~ P1-11（中等） | ✅ 已完成（P1-9 暂缓，P1-10 随第 2 批完成） |
| 第 4 批 | P2-2 / P2-4 / P2-7（轻微可做） | ⬜ |
| 第 5 批 | D-1 ~ D-4（文档同步） | ⬜ |

> 每完成一批即 git commit + 更新本文档状态列。
