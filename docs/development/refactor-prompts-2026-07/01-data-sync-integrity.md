# 01 PR-1：Markdown↔DB 投影层完整性（分支 `arch/data-sync-integrity`）

> 用法：连同 `00-执行约定.md` 一起粘贴给实现 agent。发现细节见 `docs/development/architecture-audit-2026-07-20.md` 的 D1/D2/D3/D4/D5/D8 条。

## 任务

修复 2 个 P0 + 4 个关联发现，全部在「Markdown 是事实源、SQLite 是投影」这一层。

### D1（P0）实体双写顺序倒置无补偿

现状：`apps/server/src/services.ts` `BaseService.create/update/delete`（约 268-331 行）先写 DB 后写文件；`FileSyncService`（约 400-469 行）`afterUpdate` 先删旧文件再写新文件、`afterDelete` 的 `deleteFileBySlug` 静默吞错。后果：文件写失败 → 下次 `db:sync` 按「文件不存在=删除」硬删 Agent/Skill/Prompt/MCP；文件删失败 → 残留文件复活为新 id 实体。

设计契约（按此实现，勿另起方案）：

- 不变量一句话：**「文件先成为事实，DB 后投影；文件操作失败则 DB 不动」**。
- `create`：先 `writeFile`（成功）→ 再 DB create。DB create 失败 → 补偿删文件，抛错。
- `update`（含改名）：先写新文件 → DB update → 成功后删旧文件（slug 未变则覆盖写单文件即可）。写新文件失败 → 不动 DB、不动旧文件。删旧文件失败 → warn 但不回滚（旧文件残留会在下次 sync 以新 slug upsert 为新行——可接受，记入 design-decisions；或顺手按 slug 冲突去重，不做强制）。
- `delete`：先删文件（或移入对应目录 `.trash/`，参照 PostService 现有 trash 流方向）→ 再 DB delete。文件删不掉 → 报错，不删 DB。
- `deleteFileBySlug` 禁止静默吞错，失败必须冒泡或 warn+返回 false 由调用方决策。
- 注意文件 IO 不能进 Prisma 事务，用「顺序 + 补偿」而非 `$transaction`。
- Post（软删回收站）与其他实体（硬删）语义不同，逐实体核对 syncer 行为（sync-agents/sync-skills/sync-prompts/sync-mcp 的 cleanup 是硬删）。

### D2（P0）Windows `.trash` 过滤永不命中

现状：`apps/server/src/scripts/sync/sync-posts.ts:25,112` 用正斜杠模板 `` `${contentDir}/.trash/` `` 做 `includes` 过滤，Windows 路径是反斜杠，永不命中 → 回收站文章以 `.trash/foo` slug 复活公开。

设计契约：

- 路径比较前统一归一化（`replace(/\\/g,"/")`），收在 `sync/utils.ts` 的工具函数里（如 `toPosixPath`），所有 syncer 的路径过滤都用它。
- 根治：把「跳过 `.trash`、`.`/`_` 开头目录」收进 `getFilesRecursive` 的 ignoreDirs 参数（`_templates` 已是同款机制），各 syncer 不再各自字符串包含判断。

### D3（P1）实体文件写回零路径消毒

现状：`FileSyncService.writeFile/deleteFile`（services.ts:382-398）对 slug 无校验，Agent 文件名由 `` `${name}-${id.slice(-6)}` `` 生成（:948）、MCP/Prompt 用 `entity.name`（:1292/:2636）——`agent.create({name:"../../tmp/pwn"})` 可穿越出 content；该入口经 native 工具暴露给 LLM。

设计契约：

- 在 `FileSyncService` 写/删文件单点加 slug 消毒（禁止 `/ \ ..`、Windows 保留字符 `<>:"|?*` 与控制字符；空格/中文允许）+ 最终路径 `assertPathWithinProjectRoot`（复用 `infra/safePath.ts` 思路，文件落点必须在对应 content 子目录内）。
- `packages/shared/src/schemas.ts` 给相关实体的 `name`/`slug` 加 zod refine（禁止 `/`、`\\`、`..`、Windows 保留字符）。
- 已有正确范例可参考：`skillPackage.ts` 的 `sanitizeSkillName`、`sync-sources` 的 `slugifyName`。

### D4（P1）sync 与运行时 CRUD 并发无保护

现状：dev 编排 sync:watch 与 server 并行；改名时序中 chokidar `unlink(旧)` 事件若在 `syncFileMetaToDb` 回写 sourceSlug 前触发，`deleteBySlug(旧)` 硬删刚改名的实体；`syncFileMetaToDb` 对所有错误静默 catch。

设计契约（D1 修完后本项是增量保护）：

- watch 路径 `deleteBySlug` 加保护：目标行 `updatedAt` 在 5 秒内 → 跳过本次删除并标记「需全量重扫」（下一防抖周期跑一次 upsert 全量）。
- `syncFileMetaToDb` 去掉静默 catch，失败 warn 并带实体/slug 上下文。

### D5（P1）FTS 三条漂移通道

现状：① watch 单文件事件不走 FTS；② `rebuildFtsIndex`（infra/ftsIndex.ts:51-102）不过滤墓碑（post 无 `deletedAt:null`、agent 不排除 deleted）；③ 增量 syncFts 只覆盖 post/agent/skill/memory，mcp/prompt 没有。

设计契约：

- FTS upsert/delete 收进各 syncer 的 `upsert/deleteBySlug`（与 DB 写同一处），watch 路径自动覆盖。
- rebuild 的 findMany 补墓碑过滤（全部实体统一核对）。
- mcp/prompt 补 syncFts 挂钩；可考虑把 syncFts 声明为 FileSyncService 的抽象/默认钩子强制子类对齐。

### D8（P2）memoryRepository.supersedeUpdate 两步写无事务

现状：`infra/memoryRepository.ts:331-370` 新 active 行与旧行标 superseded 无事务；`memoryService` 缺省时静默降级直写 prisma（跳过文件写回与 FTS 且无告警）。

设计契约：旧行标 superseded + 新行 DB 创建包 `$transaction`（文件/FTS 副作用按 D1 新顺序在事务外先行/补做）；缺省降级改 `console.error` 显式告警（或 throw，看调用方容忍度，选 error）。

## 测试要求（先负向后正向）

- `apps/server/src/__tests__/` 新增（或扩充既有 trpc.test.ts 相关区）：
  - D1：模拟 writeFile 抛错（如注入非法 slug 字符触发，或 mock fs）→ 断言 DB 无行；改名写新文件失败 → 旧文件与 DB 行俱在；delete 文件占用失败 → DB 行仍在。
  - D2：在 `.trash` 目录放假文章 → db:sync 后断言无 `.trash/` slug 的 Post 行（此测试在 Windows 必现红，POSIX 同样应通过）。
  - D3：`agent.create({name:"../evil"})` → 断言拒绝（TRPCError BAD_REQUEST）且 content 外无文件。
  - D4：模拟「刚 update 的行的旧 slug 收到 unlink」→ 断言行未被删。
  - D5：回收站 post / deleted agent 不出现在 rebuildFtsIndex 结果；watch upsert 后 FTS 可搜到。
  - D8：supersede 中断注入（mock prisma 第二步抛错）→ 断言不出现双 active。
- 跑：`pnpm --filter @knowpilot/server test` 全绿；`pnpm lint` 全绿。

## 验收清单

- [ ] 6 个发现各有负向断言测试 + 修复 commit
- [ ] `deleteFileBySlug` 全仓无静默吞错
- [ ] getFilesRecursive 统一 ignoreDirs，syncer 无自行 `.trash` 字符串过滤
- [ ] schemas.ts name/slug refine 就位，全仓调用方适配
- [ ] lint + server test 全绿，合并入 master
- [ ] 体检报告 D1/D2/D3/D4/D5/D8 行标注「已修复@commit」；AGENTS.md 更新

## 红线

- 不改变 Post 软删/回收站的对外语义（UI 行为不变）。
- 不给 sync 加分布式锁/队列等重武器——单用户本地场景，顺序+保护即可。
- services.ts 是共享文件：若与并行的 PR-3（TaskService 区）冲突，本 PR 先合并，冲突区保持各自行段。
