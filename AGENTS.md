# 见微 · OasisMind — AI 开发指南

> 本文件面向 AI 编码助手。阅读本文档前，默认你对本项目一无所知。请优先以本文件、README.md、MIGRATION_PLAN.md、docs/development/ 的顺序了解项目背景与规范。
>
> **品牌**：产品中文名 **见微**（见微知著），英文名 **OasisMind**。曾用名 KnowPilot；npm 工作区包名仍为 `@knowpilot/*`（过渡期）。

---

## 项目概述

见微（OasisMind）是一个**单用户、本地优先**的智能知识管理与博客平台，定位为「以 Markdown 为原子、AI 为引擎的数字花园」——并进一步做成常驻的**数字主力**（提醒、收集、蒸馏品味）。

- **核心原则**：本地 Markdown 文件是数据的唯一事实源，SQLite（通过 Prisma）只作为查询与缓存层。
- **当前阶段**：**L1–L5 已全部落地**。本地 Markdown 为源、业务实体 CRUD + 管理页、Agent SSE Chat、自动化/审批、FTS 搜索、可选鉴权、Docker/CI 均已就绪。Prisma 现约 **30** 个 model（含 ChatMessage/AgentMessage/InboxItem 等支撑表）；业务 Service 约 22 个。

项目完整路径：`D:\ALL IN AI\KnowPilot`（本地目录名可暂未改）

---

## 技术栈

| 层级 | 技术 |
|---|---|
| 语言 / 运行时 | TypeScript 5.8.3、Node.js（server 通过 `tsx` 运行） |
| 包管理器 | pnpm monorepo（`workspace:*` 协议） |
| 前端框架 | Next.js 16.2.9 + React 19.2.4（App Router） |
| 样式 | Tailwind CSS 4.3.1、shadcn/ui、`@tailwindcss/typography`、`tw-animate-css` |
| 动画 | Framer Motion 12.42.0、Three.js（`@react-three/fiber`） |
| Markdown 编辑器 | Milkdown 7.5.9 |
| Markdown 渲染 | `react-markdown` + `remark-gfm` + `remark-math` + `rehype-raw` + `rehype-highlight` + `rehype-katex` |
| 前后端通信 | tRPC 11.1.0 + `@trpc/react-query` + `superjson` |
| 数据获取 | TanStack React Query 5.66.0 |
| 全局状态 | 无（Chat 用三层 store hooks；勿再引入未使用的 zustand） |
| 后端 | Express 5.1.0 + CORS |
| ORM / 数据库 | Prisma 6.9.0 + SQLite |
| 校验 / 共享类型 | Zod 3.25.56，集中定义在 `packages/shared` |
| 测试 | Vitest 3.2.3（server、shared、web 组件单测）+ Playwright（web Chat E2E） |
| 其他工具 | `gray-matter`（frontmatter 解析）、`lodash-es`、lucide-react |

> 注意：`docker-compose.yml` 中提供了可选的 PostgreSQL 16 服务，但当前 `.env.example` 与代码实际使用 SQLite（`DATABASE_URL="file:./dev.db"`）。PostgreSQL 容器仅作未来扩展使用，日常开发无需启动。

---

## 项目结构与模块划分

```text
KnowPilot/
├── apps/
│   ├── server/                 # Express + tRPC + Prisma 后端
│   │   ├── prisma/
│   │   │   ├── schema.prisma   # ~30 个 Prisma model（业务实体 + 支撑表）
│   │   │   ├── seed.ts         # 3 篇示例文章种子
│   │   │   └── dev.db          # SQLite 数据库（运行时生成/更新）
│   │   └── src/
│   │       ├── index.ts        # Express 入口（启动 EventBus + TriggerEngine）
│   │       ├── router.ts       # 唯一 API 路由文件（20 业务路由 + about + ai 反射）
│   │       ├── services.ts     # 唯一业务服务层文件（收拢全部 Service 逻辑）
│   │       ├── db.ts           # Prisma 单例
│   │       ├── infra/          # agentTools、nativeTools、tools/{registry,native/*}、loop/、
│   │       │                  # mcpClient、autoCompact、agentStream、swarm*、heartbeatEngine、
│   │       │                  # asyncJobManager、safePath 等
│   │       ├── scripts/
│   │       │   ├── sync.ts     # Markdown/YAML ↔ SQLite 同步入口
│   │       │   ├── sync-free-keys.ts  # 免费 API Key 同步（GitHub → Credential 表）
│   │       │   └── sync/       # 各实体 sync-* 脚本
│   │       ├── __tests__/      # trpc + nativeTools + agentTools + skillRunner + mcpClient
│   │       └── trpc/
│   │           ├── trpc.ts     # initTRPC + publicProcedure + 全局错误格式化
│   │           └── context.ts  # 注入 prisma 与 ServiceContainer
│   └── web/                    # Next.js 16 前端
│       ├── app/                # 页面：博客 + agents/skills/mcp/memories/prompts/triggers/approvals/search/dashboard/...
│       ├── components/         # 布局与页面组件
│       │   └── shared.tsx      # 唯一共享通用 UI 组件库 (分页、空态、骨架屏、弹窗)
│       ├── lib/                # trpc.tsx、hooks.ts、icons.tsx、aboutProfile.ts；
│       │                       # Chat 三层 store（useSessionMessages/useStreamLifecycle/useSessionComposeState）
│       │                       # + useChat* 域 hooks（W13d：useChatUiPrefs/useChatConfig/useChatHoverMonitor/
│       │                       #   useChatAsyncOverlayEffects/useSubagentMessageMirror）
│       ├── public/
│       └── 配置文件
├── packages/
│   └── shared/                 # 前后端共享 Zod schema + TS 类型 + 常量
│       └── src/
│           ├── schemas.ts
│           ├── constants.ts
│           ├── types.ts
│           └── index.ts
├── content/                    # Git 跟踪的纯知识库事实源
│   ├── {gardenId}/             # 动态花园（含种子 posts/knowledge/resources）
│   │   ├── _garden.md          # 库元数据 + 首页正文（不进 Post 表）
│   │   └── {slug}.md           # 文章（Post）
│   ├── about/                  # About Me（非花园；profile.md）
│   └── uploads/                # 上传文件（file.upload + 截图）
├── config/                     # Git 跟踪的 Agent 配置事实源
│   ├── agents/                 # Agent 配置（Markdown，运行时 CRUD 写回 + _templates/）
│   ├── skills/                 # Skill 配置（Markdown + .curator_state/.usage.json 运行时忽略）
│   ├── memories/               # Memory 配置（Markdown + daily/ 运行时忽略）
│   ├── prompts/                # Prompt 模板（Markdown）
│   ├── tasks/                  # Task 配置（JSON + db:sync 单向导入）
│   ├── mcp/                    # MCP Server 配置（YAML）
│   └── sources/                # InfoSource 信息源（JSON + db:sync）
├── data/                       # 运行时产物（整体 .gitignore，可随时重建）
│   ├── approvals/              # 审批记录（仅 DB，目录占位）
│   ├── cookies/                # OAuth/登录态（zhihu/feishu 等 storageState + cookieJar）
│   ├── files/                  # 文件实体（仅 DB，目录占位）
│   ├── git/                    # GitRepo（仅 DB，目录占位）
│   ├── logs/                   # 日志（仅 DB，目录占位）
│   ├── messages/               # AgentMessage（仅 DB，目录占位）
│   ├── sessions/               # 会话摘要（session_rotate 写入）
│   ├── tools/                  # Tool（仅 DB，目录占位）
│   └── workspace/              # write_file 无 Workspace 时的回退区
├── workspaces/                 # DB Workspace.path 实际落点（根级，.gitignore）
├── docs/development/           # L1-L5 阶段开发文档与 API 规范
├── docs/surveys-2026/          # 2026 综述 PDF（记忆/Harness/Agent）+ KnowPilot 对比分析
├── scripts/
│   └── clean-content.mjs       # 清理 emoji、规范化数学公式
├── .dev-log/                   # 开发日志
└── 根配置（package.json、pnpm-workspace.yaml、tsconfig.base.json 等）
```

### 实体矩阵（当前实现状态）

详见 `docs/development/README.md`。关键事实：

- **Post**：L1 已封板（博客、编辑器、同步、删除、Command Palette、图片上传含粘贴）。
- **Agent / Skill / McpServer / Memory / Prompt**：L2 后端 CRUD、内容双向写回、`db:sync`、管理页已完成；Agent ReAct + SSE 流式 `/chat`（三栏 UI）、`skill:*` 双路径、MCP 截断重连熔断（W12 断路器）、auto-compact 已实现。
- **ChatSession / ChatMessage**：`/chat` 会话 UI + 后端 CRUD + Agent 运行时已接入。
- **File / GitRepo / Task / Log / Workspace**：L3 后端 CRUD + 管理页 + Task sync/Scheduler 已完成。
- **Trigger / Approval**：L4 后端 + 前端页（`/triggers`、`/approvals`）+ 审批拦截已通。
- **L5**：`search.global` + FTS5、`/dashboard`、`AUTH_MODE=password` 可选鉴权（`/login`、`/settings`）、Docker + CI + `db:backup`。
- **Tool / Run / Credential**：后端 CRUD + `/tools` `/runs` `/credentials` 管理页已完成。

---

## 构建与运行命令

所有命令均在项目根目录执行。

### 安装依赖

```bash
pnpm install
```

### 开发启动

```bash
# 同步 Markdown 文章到 SQLite，然后并行启动 server + web
pnpm dev
```

- 前端：`http://localhost:3000`
- 后端：`http://localhost:3010`
- tRPC 端点：`http://localhost:3010/api/trpc`

```bash
# 单独启动
pnpm dev:web
pnpm dev:server
```

### 数据库相关

```bash
pnpm db:sync      # content/ → SQLite 同步（Post/Agent/Skill/MCP/Memory/Prompt/Task；支持 --watch）
pnpm db:backup    # 将 dev.db 复制到 backups/ 目录
pnpm db:migrate   # Prisma migrate dev
pnpm db:push      # Prisma db push
pnpm db:generate  # 生成 Prisma Client
pnpm db:seed      # 写入 3 篇示例文章
pnpm db:studio    # 打开 Prisma Studio
```

### 构建与生产

```bash
pnpm build        # 仅构建 @knowpilot/web（Next.js）
pnpm lint         # 全仓库 lint（server/shared 用 tsc --noEmit，web 用 eslint）
pnpm test         # 全仓库运行 Vitest
```

### 运行时架构

- **Server**：Express 监听 `SERVER_PORT`（默认 3010）。
  - `/health`：健康检查。
  - `/api/posts/assets`：静态托管 `content/posts/` 下的图片等资源。
  - `/api/trpc`：tRPC 端点，挂载 20 个实体 router + `ai` 反射。
  - `/uploads`：静态托管 `content/uploads/` 上传文件。
- **Web**：Next.js Dev Server（默认 3000）。
  - `next.config.ts` 配置 rewrites：
    - `/api/trpc/:path*` → `http://localhost:3010/api/trpc/:path*`
    - `/api/posts/assets/:path*` → `http://localhost:3010/api/posts/assets/:path*`
  - `transpilePackages: ["@knowpilot/server", "@knowpilot/shared"]`
- **前后端通信**：前端通过 `apps/web/lib/trpc.tsx` 创建 tRPC React Query 客户端，使用 `superjson`；开发时走 Next.js rewrite 到后端，SSR 时使用 `NEXT_PUBLIC_SERVER_URL` 或默认 `http://localhost:3010`。

---

## 代码风格与开发约定

### 通用约定

- **语言**：注释、UI 文案、Git 提交信息、文档以中文为主；代码标识符（变量、函数、组件名）使用英文。
- **Git 提交前缀**：`feat:`、`fix:`、`docs:`、`docs(dev-log):`、`refactor:`、`test:`、`chore:` 等。
- **长路径支持**：仓库已开启 `core.longpaths=true` 以支持深层中文 Markdown 路径。
- **空目录占位**：使用 `.gitkeep` 保留占位目录（如 `config/agents/`、`config/skills/`）。

### Git 管理与工程化规范

> 工作树脏乱 = 失职。AI 助手每次结束工作前，必须让 `git status` 干净（或只剩明确不该提交的运行时产物）。这是工程纪律，不是可选项。

#### 1. 提交分组原则

- **按主题分组，不按时间堆**：一次会话可能做多批工作（审计修复 + 新功能 + 重构 + 文档）。结束前按主题拆成多个提交，每条提交信息说清「为什么改」，不要 83 个文件一锅端成「update」。
- **主题划分粒度**：基础设施（依赖/安全/测试设施）/ 重构（拆分）/ 功能（新能力）/ 修复（bug）/ 文档（报告+规范）/ 配置（.env.example/config.yaml）分开。
- **跨主题文件归主要主题**：一个文件被多主题改时，归到改动量最大或语义最贴的主题。例如 `apps/server/package.json` 同时含 `mock-llm-core`（测试设施）和 `express-rate-limit`（安全）两个依赖，归到「基础设施」提交，提交信息注明含限流依赖。
- **跨主题 hunk 拆分**：当且仅当两个主题都很大、合并会严重损害可读性时，用 `git add -p` 按 hunk 拆。PowerShell 无 `printf`，用 `Write-Output "y`nn`n" | git add -p <file>` 喂入交互输入。hunk 顺序不确定时慎用，优先选归并。

#### 2. 提交信息规范

- **格式**：`<type>(<scope>): <中文摘要>` + 空行 + `<中文正文，说 why 不只说 what>`。
- **前缀**：`feat` / `fix` / `refactor` / `test` / `docs` / `chore` / `perf`。`feat(swarm)` / `fix(chat)` / `refactor` 等 scope 可选但推荐。
- **正文说 why**：不是罗列改了哪些文件，而是说清「为什么这么改、解决了什么问题、有什么架构含义」。例如「砍 invoke_api 万能后门 = 砍掉所有打地鼠黑名单的维护负担」比「删除 invokeApiTool 函数」有价值。
- **HEREDOC 写多行**：PowerShell 用 `git commit -m "第一行`n第二行"` 或多个 `-m`（每个 -m 一段）。复杂正文用 `git commit -m "$(cat <<'EOF' ... EOF)"`（需 bash；PowerShell 用反引号 n 拼接）。

#### 3. 工作树卫生（提交前必做）

- **误创建文件即删**：测试时把任务文本当 Agent 名建出来的 `config/agents/请先等待...md` 这类文件，发现即删，不要留着污染工作树。
- **运行时产物 gitignore**：日记（`config/memories/daily/`）、curator 状态（`config/skills/.curator_state`）、心跳临时 agent（`config/agents/*-e3f87d.md`）等运行时产物，加进 `.gitignore` 防御，不要提交。
- **测试产物防御**：`.gitignore` 已有 `content/posts/smoke-post-*.md`、`config/agents/*子 Agent*.md` 等模式，新增测试产物路径时同步加防御。
- **不提交密钥/凭据**：`.env` / `*.db` / `backups/` 已 gitignore，绝不 `git add -f` 强加。`dev.db` 是缓存层随时可重建，不入库。

#### 4. 提交前验证（铁律）

每次提交前必须跑：
- `pnpm --filter @knowpilot/server lint` + `--filter @knowpilot/shared lint` + `--filter @knowpilot/web lint`：tsc/eslint 0 error。
- `pnpm --filter @knowpilot/server test`：全量绿。跨包改动时跑 `pnpm test`（含 shared + web 组件单测）。
- 单测绿 ≠ 运行时无错（CancelledError 教训）：lint + test 通过只是必要条件，不是充分条件。低频路径同样必修。

#### 5. 提交操作纪律

- **禁止 `git push --force` 到 master/main**：除非用户明确要求且你已警告风险。
- **禁止 `git commit --amend` 已推送提交**：已推送的提交 amend 等于改写历史，会让协作者拉到冲突。amend 仅限「本地未推送 + 你自己创建的提交 + pre-commit hook 自动改了文件」。
- **禁止 `git config` 修改**：不动用户 git 配置。
- **禁止 `--no-verify` 跳钩**：除非用户明确要求。
- **禁止 `git add -A` 一锅端**：按主题 `git add <指定路径>`，避免误加运行时产物/密钥。
- **PowerShell 无 `&&`**：用 `;` 分步，或 `git add X; git commit -m "..."`。`printf` 也不存在，用 `Write-Output`。

#### 6. 整理流程（每次会话结束前执行）

1. `git status`：扫一遍，识别误创建文件（删）、运行时产物（gitignore）、跨主题改动（分组）。
2. 按主题 `git add <路径>` + `git commit`，每条提交信息说 why。
3. `pnpm --filter @knowpilot/server lint` + `pnpm --filter @knowpilot/server test` 验证无回归。
4. 最终 `git status` 必须 `nothing to commit, working tree clean`（或只剩明确 gitignore 的运行时产物）。
5. `git log --oneline -10` 检查历史可读：每条提交能从信息看懂「为什么改」。

### 后端 API 设计（tRPC）

规范来源：`docs/development/README.md`

- 每个实体 router 必备 `create`、`getById`、`list`、`update`、`delete`。
- procedure 名使用 camelCase，动词统一。
- 列表统一返回 `{ items, total, page, pageSize, totalPages }`。
- 共享 Zod schema 必须放在 `packages/shared/src/schemas.ts`。
- 错误处理使用 `TRPCError`，code 包括 `NOT_FOUND`、`CONFLICT`、`BAD_REQUEST`、`INTERNAL_SERVER_ERROR` 等，message 需说明「发生了什么、在哪发生、怎么修」。
- 当前所有 procedure 均为 `publicProcedure`，无鉴权（L5 再引入用户系统）。

### 类型共享

- server 通过 `src/router.ts` 导出 `AppRouter` 类型。
- web 直接 `import type { AppRouter } from "@knowpilot/server/router"`。
- `@knowpilot/shared` 通过 `workspace:*` 被 server 与 web 同时依赖。

### 前端约定

- 使用 `cn()` 工具（`clsx` + `tailwind-merge`）合并 Tailwind 类名，位于 `apps/web/lib/utils.ts`。
- 颜色变量同时存在 `--kp-*`（项目自定义莫兰迪色）与 shadcn/ui 标准 CSS variables。
- 动画偏好：Framer Motion `type: "spring", stiffness: 260, damping: 26`（Chat 等）；旧页面可用 180/20。
- **图标**：统一 Lucide 或 `apps/web/lib/icons.tsx` 自绘 SVG；**禁止**用 emoji / 键盘可直接输入字符当 UI 图标。

### Markdown ↔ SQLite 同步约定

来源：`MIGRATION_PLAN.md`、`docs/development/README.md`

1. **花园**：`content/{gardenId}/_garden.md`（可 `garden.create` / `garden_create` 新建第 N 座）；种子三库 posts/knowledge/resources 启动自动 ensure。`about`/`uploads` 不是花园。
2. **文章**：`content/{gardenId}/{slug}.md`；`(garden, slug)` 联合唯一；frontmatter **不写** garden。
3. Frontmatter 规范字段：
 ```yaml
 ---
 title: "文章标题"
 category: "分类"
 tags: ["标签1", "标签2"]
 published: true
 excerpt: "一句话文章简要介绍。"
 ---
 ```
4. `pnpm db:sync` 先同步 Garden，再按发现的花园动态挂 Post syncer。禁止 `write_file` 直写 `content/`（除 `uploads/`）。
5. 自动保存：`useAutoSave.ts` 500ms 节流写入 LocalStorage，2s 防抖调用 `post.update`（仅对已存在 id）。

### 项目扁平化与代码收拢约定

为了杜绝项目文件夹过深、同名文件繁多引发维护崩溃，以及防止功能重复定义，项目必须严格遵循**“单文件逻辑收拢”**原则：
1. **后端业务层合并**：禁止创建 `services/` 子目录及零散平行 Service 树。`apps/server/src/services.ts` 只保留 BaseService/FileSyncService 基座；实体 Service 在 `infra/entityServices/<entity>Service.ts`（由 `serviceContainer` 直连叶子），禁止平行第二套实现或兼容 re-export。
2. **后端路由层合并**：禁止创建 `trpc/routers/` 子目录及零散平行路由树。域路由在 `infra/trpcRouters/<domain>Router.ts`；根 `apps/server/src/router.ts` **只聚合**出口 `AppRouter`，禁止第二套实现或兼容 re-export。
3. **前端 Hooks 合并**：禁止创建 `hooks/` 子目录及零散数据 hooks 文件。所有 React Query hooks 统一放在 `apps/web/lib/hooks.ts` 中。
4. **前端通用组件合并**：禁止创建 `components/shared/` 目录及零散小组件。通用的页面基础 UI 组件（如分页、空状态、骨架屏、确认弹窗）统一放在 `apps/web/components/shared.tsx` 中。

### 架构纪律：禁止打补丁，必须从架构层面根治

> 这一条是**铁律**，不是建议。违反就是失职。看不懂这条的人没资格改本项目的状态机 / 编排层。

#### 反模式：补丁栈

什么叫打补丁？就是**在编排层（callbacks、useEffect、try/finally）用时序猜测去弥补 store 没强制的不变量**。典型症状：

- 「`onDone` 里 `await hydrate` 一下，赌消息已经落库」
- 「清 UI 前先 `queueMicrotask` 看一眼 phase，是 streaming 就跳过」
- 「`finally` 里再 hydrate 一次保险，然后再 consume 一次」
- 「`useEffect` 监听 `!isSessionStreaming` 就 `consumeRef()`」
- 「加个 `setTimeout` / debounce 缓一缓，让两路 SSE 谁先谁后不重要」

**这不是修复，这是把一个 bug 拆成五个时序依赖的 bug。**回调顺序变一次、SSE 抖一下、用户切个 session、刷新一下——补丁立刻破。然后你再加一个补丁压住它。然后第三个补丁压第二个的边界 case。**几十个场景就几十个补丁，最后谁都不敢动，重构白做。**

#### 正模式：架构层根治

架构层根治 = **把不变量收进 store 的 reducer / action，编排层写错也打不破**。判断标准只有一条：

> **删掉你这段编排层补丁，bug 还会不会复现？**
> - 会复现 → 你的不变量没收进 store，你打的还是补丁，只是包装得更精致。
> - 不会复现 → 编排层再怎么写错时序，reducer 都会拒绝非法转移，这才是架构落地。

具体怎么做：

1. **先画状态机**：哪些 phase、哪些转移合法、哪些非法。画不出来就别写代码。
2. **不变量写进 reducer，不是写进注释**：
   - 非法转移直接 no-op 或断言（开发期 `console.error`，生产期静默）。
   - 「done→idle 必须经 commitStream 且 MS 已对齐」这种规则，**必须由 reducer 强制**，不能靠编排层「记得」调用顺序。
3. **副作用集中到转移点**：进入/离开某个 phase 的清理只在 reducer 或 transition 函数里写一遍，**禁止** 4 个回调各清一遍然后互相救火。
4. **跨层通信走显式事件**：Layer A 进入某状态后要通知 Layer B？走 `onStreamCommitted(cb)` 这种显式钩子，**不要**让 B 用 `useEffect` 猜 A 的状态变化。
5. **双通道竞态用幂等消除，不要用时序赌**：两路 SSE 无 happens-before？让后到达的一路做幂等 upsert / 幂等 commit，**不要**用 `await hydrate` refetch 赌谁先到。

#### 自检清单（提交前必过）

改任何状态机 / 编排层 / 多层 store 协作之前，先回答：

- [ ] 这次 bug 的**根因**属于哪一层职责越界 / 不变量缺失？说不清楚就别动手。
- [ ] 我的修复是改 store 的 reducer / action，还是又加了一段编排层时序猜测？后者一律打回。
- [ ] 删掉我新加的编排层代码，reducer 还能不能保证正确？不能就是补丁。
- [ ] 我有没有新增 `await hydrate` / `setTimeout` / `queueMicrotask` / `phase === "xxx"` 守卫？有就是**正在打补丁的信号**，停下来重新设计。
- [ ] 这个不变量能不能写成一句中文，让半年后的自己 / 别的 AI 看懂？写不出就是没想清楚。

#### 本项目已落地的范例（参照执行）

- **Stream Commit 不变量**（Chat 三层 store）：`done → idle` 只经 `commitStream`，`BEGIN_STREAM` 在 occupied 时 reducer 拒绝，`onStreamCommitted` 是 Compose drain 的唯一钩子。详见 `docs/development/chat-state-architecture.md` §4.2 与 `docs/development/chat-scenario-states.md`。**这就是「删掉编排层补丁，bug 不复现」的样板。**

#### 给 AI 助手的死命令

**如果你（AI）在改 Chat / Swarm / 任何状态机时，第一反应是「加个 await」「加个 setTimeout」「加个 phase 守卫」——立刻停手，你在打补丁。**回去先想：这个 bug 的根因是哪个不变量没被强制？把它收进 reducer。如果做不到，说明你对这个模块的理解还不够，**继续读代码，别动手写补丁**。

几十个场景靠几十个补丁维护的项目，不是工程，是债务堆。本项目不接受这种债务。

### 架构纪律：状态在内存 · 推拉结合 · 刷新不丢（前端只忠实显示）

> **铁律，不是建议。** 与「禁止打补丁」同级。违反 = 失职。  
> 凡用户可见状态：**开着页必须自己动；刷新不得变干净；禁止用 F5 当修复。**

#### 一句话（死命令）

**权威只在服务端（DB + hub/store 内存）。前端零真相、只订阅、只渲染。**  
**核心状态变化必须「推拉结合」——缺任一半 = 不合格交付。**

#### 推拉结合（强制双通道，不是二选一）

| 通道 | 职责 | 不做的后果 |
|---|---|---|
| **PUSH（推）** | 权威写点**同事务/同调用栈内**推 SSE / hub 内存 /（跨标签）BroadcastChannel；Chat 或管理页订阅后 `invalidate`/`setData`/`reducer patch` | 用户盯着开着的页，库已变、界面假死，只能 F5 → **P0 事故** |
| **PULL（拉）** | 进页 / 刷新 / 管理页挂载时从权威源再水合；开着的管理页对「进行中」态保留短 `refetchInterval` 作兜底（推是主路径，拉是保险） | F5 丢气泡 / 丢任务 / 丢 cron 状态 → **P0 事故** |

**禁止**：
- 只写 `prisma.*.create/update`，不推事件，交付文案写「刷新一下就好」  
- 只靠内存乐观 UI，不落库，刷新变空白  
- 只用 mount 一次 `useQuery`、无 SSE、无 interval，后台改了列表永陈旧  
- 用 `setTimeout` / `useEffect` 猜时序代替推送（那是补丁，打回）

**合法 PUSH 通道（优先从上到下）**：
1. `SessionStreamHub.pushExternalEvent`（`message_upserted` / `cron_job_updated` / `session_list_changed` / `approval_updated` / …）  
2. hub 内存态（`listRunning`、环形缓冲）  
3. 事件驱动的 React Query `invalidate` / `setData`（必须由 1/2 触发，不是用户手刷）  
4. 同浏览器 `BroadcastChannel("knowpilot-ui-state")`（跨标签兜底；**不能替代**服务端推）

收拢入口：`apps/server/src/infra/uiStateNotify.ts`（`notifyAgentUi` / `notifyAllMainSessionsUi` / `notifyCronJobUpdated`）。新写点优先走这里，禁止再散落裸 `prisma` + 沉默。

#### 三条硬约束

1. **状态先进内存可观测面，再谈 UI** — 写库瞬间用户侧必须有可订阅读点。  
2. **打开中的一切表面实时更新** — 含其它标签页、侧栏、`/cron` `/approvals` `/runs`；秒级，不靠 F5。  
3. **刷新 = 再水合，信息零损失** — 流式中靠续传 + 落库消息；冲突以服务端为准。

#### 前端职责边界（死命令）

| 前端必须 | 前端严禁 |
|---|---|
| 订 PUSH + 做 PULL 水合 | 把业务真相 invent 在本地又不同步 |
| reducer / `setData` 幂等 patch | `useEffect` / `setTimeout` 赌「何时出现」 |
| 管理页：有 running/pending 就短轮询兜底 | 「刷新当修复」、交付说明教用户按 F5 |
| 跨标签仍一致 | 只伺候当前焦点页 |

#### 自检清单（改状态机 / SSE / 管理页 / Chat 前必过，打勾才能交）

- [ ] **PUSH**：权威写点之后调了 `uiStateNotify` 或等价 `pushExternalEvent`？  
- [ ] **PULL**：刷新 / 进页能从 DB·list·getById 完整回来？  
- [ ] 用户开着 A 页、在 B 触发变化，A 会不会自己动？不会 → **缺 PUSH**，不准合。  
- [ ] 立刻 F5，信息还在吗？不在 → **缺 PULL/落库**，不准合。  
- [ ] 交付里有没有「刷新一下」？有 → **打回重做**。

#### 反例（已踩过，再犯按失职论）

- Cron 只写库入池，管理页 `lastRunStatus` 假死、侧栏不出现  
- 会话列表只 mount fetch，新 session / spawn_goal 要手动刷新  
- 消息靠盲 `invalidate` 赌落库，SSE 晚到空白  
- `/approvals` `/runs` 无推无拉，Agent 已挂起人还不知道

#### 正例（参照执行）

- Chat：`MessageService` → `message_upserted` → reducer（推）+ `listForChat` 水合（拉）  
- Cron：`fire` → hub 起流 + `cron_session_started` / `cron_job_updated`（推）+ `/cron` 短轮询与进页 list（拉）  
- 样板文档：`docs/development/chat-state-architecture.md`

### 架构纪律：自主执行铁律（禁止停下等用户选择）

> 与「禁止打补丁」「禁止向后兼容」同级的铁律。本项目是单人项目，用户的时间比 AI 的时间贵，**AI 不得把决策成本转嫁给用户**。

具体执行：

1. **禁止用 AskQuestion / 提问等方式把技术决策抛给用户**：架构选型、拆分边界、修复方案、重构顺序、命名、是否放宽某条纪律——AI 自己拍板，按最推荐方案直接做。只有涉及**不可逆的外部副作用**（删线上数据、push 远程、花钱调真实付费 API、改 git config）才允许停下来确认。
2. **每次运行必须把发现的问题修掉，禁止「列清单等用户挑」**：审计 / 重构 / 修 bug 时扫到的所有问题（含低频、含边界、含「概率低」），一律当场修完。不得输出「以下是选项，请你选择」「这几个有什么选项推荐哪个」然后停下。**最推荐方案 = 默认执行方案**，修完再汇报。
3. **禁止「打票不施工」**：不得只写 TODO / 报告 / 工单而不动手。发现即修，修完即验证（lint + test），验证完再写进度。报告是施工的副产物，不是施工的替代品。
4. **禁止「半成品交付」**：不得修一半留一半等用户催。一个改动要么修完跑绿，要么不动；跨文件的连带改动必须在同一次改动里改完，禁止「先改 A，B 留到下次」。
5. **判断标准**：删掉你这段「询问用户」的话，任务还能不能往下推进？能推进就该直接做，问都不要问。不能推进（缺外部信息 / 缺权限 / 缺不可逆确认）才允许问，且问完必须立刻继续，不得等用户回。

#### 今天踩过的坑（2026-07-25，必须内化为规范）

- **`void promise` 是 unhandled rejection 的温床**：TanStack Query 取消进行中的 `fetch`/`refetch` 时以 `CancelledError` reject；前端大量 `void utils.*.refetch()` / `void utils.*.invalidate()` / `void query.refetch()` 丢弃返回值，rejection 被 Next.js dev overlay 捕获上报。**单测（jsdom + createRoot + act）覆盖不到浏览器运行时 unhandled rejection 路径**——单测全绿 ≠ 运行时无错。
  - **铁规**：今后全仓**禁止** `void <promise>` 写法。所有 `refetch` / `fetch` / `invalidate` / `prefetch` / `mutateAsync` / `clipboard.writeText` 等 Promise 调用，要么 `await`（在 try/catch 内），要么 `.catch(() => {})` 静默兜底。`void` 只用于「明确不返回 Promise 的语句表达式」场景。
  - **审查义务**：改前端任何涉及 promise 的代码，必须连带审查同文件 / 同 hook 链路的 `void promise` 残留；发现即改，不得留。
- **单测绿不能给运行时打包票**：给用户说「没问题」前，必须明确区分「单测覆盖路径绿」与「浏览器运行时路径未验证」。后者要靠静态审查 + 实际跑 dev server 复现，不得用单测绿代替。此前对父子 Agent 通信路径打包票后被用户实测打脸，教训记下。
- **低频不是不修的理由**：用户手动触发的低频路径（手动刷新按钮、创建对话框、git 页刷新）并发概率低，但 `CancelledError` 隐患与高频路径同源。审计扫到的所有 `void promise` 一律修，不得按「频率」分级取舍。

### 架构纪律：禁止向后兼容包袱

> 与「禁止打补丁」同级的铁律。本项目是**单用户、本地优先、未发布 1.0** 的项目——没有外部消费者，没有线上多版本共存，**没有任何理由保留向后兼容层**。

具体执行：

1. **改接口就改所有调用方**：函数签名、tRPC procedure、表结构、frontmatter 字段变了，就在同一次改动里把全仓调用方改完，**禁止**保留旧签名做「兼容重载」、禁止 `// 兼容旧调用方` 分支、禁止 deprecated 参数「先留着」。
2. **禁止兼容 re-export**：模块拆分后（如 W4 的 `promptBuilder.ts`/`agentResolver.ts`），老文件不得 re-export 新模块「方便旧引用」。所有 import 必须直连新叶子模块，拆完即删旧出口。
3. **禁止兼容注册/适配层**：工具注册、schema 转换等只有一条路径。过渡期的兼容层（如 `ensureNativeToolsRegistered` 的双轨注册）必须在对应拆分工单结束时一并删除，不得「留着以防万一」。
4. **数据迁移走一次性脚本，不走代码分支**：老库数据形态变化（如字段新增、枚举扩展）写 `apps/server/src/scripts/` 下的一次性迁移脚本，执行完即删；**禁止**在读路径写 `if (老格式) ... else ...` 永久分支。
5. **SQLite 是缓存层，随时可重建**：`dev.db` 不是事实源（Markdown 才是）。表结构变更优先 `db:push` + 迁移脚本，不考虑「线上旧版本客户端连新库」这种不存在的场景。

判断标准只有一条：**这个兼容层服务的「旧版本」在哪台机器上运行？** 答不出来，就没有旧版本，删。

---

### 架构纪律：服务重启不自动续跑

> 与「禁止打补丁」同级的铁律。**服务重启后，任何僵尸 running/queued Task 一律标 failed，绝不自动重建执行体续跑。** 理由：tool 任务有副作用、进度未知，盲目重跑可能重复执行（写两份文件、发两封邮件、扣两次额度）；本地单用户场景下，用户在场可手动 `retryAsyncJob`，不在场时自动续跑只会制造不可控副作用。

具体执行：

1. **`recoverStaleAsyncJobs` 单一收拢点**：启动恢复只标 failed（文案「服务重启，任务中断」），**禁止**按 `reentrant`/`maxRetries`/`retryCount` 分叉重建执行体入池。
2. **`reentrant`/`maxRetries`/`retryCount` 三列已从 schema 删除**：整个 reentrancy 基座（`inferTaskReentrant`、`NativeToolDefinition.reentrant`、`ToolCommand.reentrant`、`registerDomain` 透传、34 工具 `reentrant: true` 声明、入队物化、`retryAsyncJob` 物化）已全部删除。手动 `retryAsyncJob` 不再物化这三列，直接重建执行体入池。
3. **`paused` 会话走手动恢复**：`chatSession.resume` 由用户点按钮触发，**禁止**启动时自动 resume。
4. **`recoverStaleRuns` 如实标 interrupted**：遗留 running Run 标 interrupted，不假装能续跑；ReAct 状态随进程丢失，checkpoint 重建另立设计。
5. **判断标准**：删掉自动续跑分支，僵尸任务是否还能"复活"？答不能 = 正确。能复活 = 违反铁律，删掉续跑代码。

---

## 测试说明

### 测试框架

- **Vitest 3.2.3**：`@knowpilot/server` / `@knowpilot/shared` / `@knowpilot/web`（组件单测：jsdom + createRoot + act，无 RTL；`apps/web/vitest.config.ts`）
- **Playwright 1.52+**：`apps/web/e2e/`，使用本机 **Chrome**（`channel: "chrome"`），无需 `playwright install chromium`

### 运行测试

```bash
pnpm validate          # 一键验收：lint → test → build → e2e
pnpm test              # Vitest 全 package
pnpm test:e2e          # Playwright E2E（web 3002 + server 3010）
pnpm test:e2e:headed   # 有界面调试
pnpm --filter @knowpilot/server test
```

> E2E server / web 进程统一由 `apps/web/e2e-global/setup.mjs` 启动（不再依赖 Playwright `webServer`），避免 `webServer` 与 `globalSetup` 并行导致的时序与端口冲突问题。

### 现有测试

| 文件 | 覆盖 |
|---|---|
| `trpc.test.ts` | 业务实体 CRUD（含 InfoSource）、db:sync、Agent chat、GitRepo 沙箱、git.commit/pull 审批 |
| `trpcSmoke.test.ts` | 所有 ai-readable procedure 通过 ai.invoke 触达无崩溃 |
| `auth.test.ts` | AUTH_MODE 鉴权 |
| `fts.test.ts` | FTS5 全局搜索索引 |
| `nativeTools.test.ts` | native 工具 |
| `agentTools.test.ts` | 解析、授权、并发批次 |
| `skillRunner.test.ts` | Skill 沙箱 |
| `mcpClient.test.ts` | MCP 截断 |
| `chatHistory.test.ts` | 扁平存储重建多轮 ReAct 消息链 |
| `apps/web/components/__tests__/chatSidebarRender.test.tsx` | ChatSidebar memo 渲染屏障：10×50ms token 更新下函数体仅执行 1 次（W16b） |
| `async-task-queue.test.ts` | `async_task_run/status` 与队列状态（含 async_task_wait 注册表移除负向断言）；同步任务通道（deliverToQueue=false：pull 过滤 + listSyncAsyncJobs + pullAsyncQueue.syncTasks） |
| `superiorQueueDrain.test.ts` | W-E running 子 Agent 消息服务端队列 + 空闲自动 drain（T7：busy 入队不写 ChatMessage / 转闲 drain 起轮 + AgentMessage 记账 consumed / idle 残留 FIFO / waitForRun / consume 软认领） |
| `capabilities.test.ts` / `platformFetch.test.ts` | 运行时能力 / 平台 fetch |
| `circuitBreaker.test.ts` | W12：断路器三态/非法转移拒绝、MCP open 零真实连接、审批清理 cron 挂载、心跳 suspended 暂停/恢复 |
| `e2e/blog-smoke.spec.ts` | L1 博客冒烟（/posts、/editor、/、/posts/[slug]） |
| `e2e/admin-pages.spec.ts` | 管理页冒烟（20 路由 + /about） |
| `e2e/chat-thinking-real.spec.ts` | 真实 LLM Chat 发消息/重试、思考时间线不重复 |
| `e2e/chat-tool-hint-real.spec.ts` / `chat-ocr-real.spec.ts` / `chat-queue-real.spec.ts` | 真实 LLM 工具/OCR/异步队列 |
| `e2e/chat-mock.spec.ts` / `chat-thinking-mock.spec.ts` / `chat-tool-error-mock.spec.ts` | Mock E2E（全离线，MOCK_LLM/MCP/NATIVE_TOOLS） |
| `e2e/chat-subagent-resume-mock.spec.ts` | 刷新 / 切 session / 切 Agent 后父会话流式恢复 |
| `e2e/chat-resume-mock.spec.ts` | 普通对话刷新后最终结果不丢失 |
| `e2e/async-task-mock.spec.ts` | Mock 异步任务结果自动插入对话；右栏状态页两级分组（异步队列/同步任务） |
| `e2e/theme-toggle-mock.spec.ts` | Navbar 主题切换 light/dark |
| `e2e/post-trash.spec.ts` | 文章回收站删除/恢复（try/finally 强制清理） |
| `e2e/ui-components.spec.ts` | 通用组件冒烟 |

使用场景：`docs/development/scenarios.md`  
并发与竞态防护：`docs/development/concurrency.md`

### Lint

```bash
pnpm lint
```

- `@knowpilot/server` / `@knowpilot/shared`：`tsc --noEmit`
- `@knowpilot/web`：`eslint`（`eslint.config.mjs` 使用 `eslint-config-next/core-web-vitals` + `eslint-config-next/typescript`）

---

## Swarm 架构（三层 Agent 层级 + 心跳自主运行）

KnowPilot 已落地完整的 Swarm 能力，设计决策详见 `docs/development/design-decisions.md`。

### 三层 Agent 层级 + Root Workspace

| 层级 | tier | 权限 | 说明 |
|---|---|---|---|
| 超级 Agent | `super` | 近似用户全能（硬禁：删自己 / 自降 tier） | 归属 **KnowPilot Root**（`isSystem` Workspace）；可建业务 Workspace |
| 管理 Agent | `manager` | 本 Workspace 内 CRUD；除向超级报告外禁止出域 | 创建 Workspace 时默认附带（`withManager`）；可带 `initialTask` |
| 子 Agent | `sub` | 执行任务 + report_back / notify_parent | 由管理 Agent 或用户创建 |

- 业务 Workspace 行级后台 LLM 槽：`Workspace.asyncSlotQuota`（默认 2；Root=0 不限）；全局 `asyncJobs.maxConcurrent` 仍是硬顶。
- 设计决策见 `docs/development/design-decisions.md`「Workspace 层级 + 超级 Agent」；通道/槽位见 `docs/development/async-slots-and-parent-child.md`。

### 核心模块

| 模块 | 文件 | 说明 |
|---|---|---|
| 权限硬拦截 | `infra/swarmPermissionGuard.ts` | tier 校验 + 向上发消息时机 + 跨 Workspace + depth 防循环 |
| Agent 间消息 | `infra/swarmBus.ts` | LocalSwarmBus（SQLite AgentMessage 表） |
| 心跳引擎 | `infra/heartbeatEngine.ts` | node-cron 定时触发 + 预算检查 + 并发控制 |
| 调度中介者 | `infra/swarmOrchestrator.ts` | W10：统一四入口 dispatch→guard→去重→并发池→聚合→审计骨架 |
| 超级 Agent 初始化 | `infra/swarmInitializer.ts` | 首次启动自动创建 |
| Swarm native tools | `infra/nativeTools.ts` | agent_create/update/delete/inspect/send_message/report_back + workspace_create/archive + skill_discover/promote + send_email + free_api_keys |

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `SWARM_MODE` | `local` | `local`（零依赖）/ `redis`（BullMQ，Phase 4） |
| `EMAIL_PROVIDER` | `none` | `none` / `smtp` / `agentmail` / `ntfy`；可叠加 `NTFY_TOPIC` |
| `AGENT_MAX_TOOL_CALLS_PER_RUN` | `168` | 单次运行工具调用上限 |
| `AGENT_DESTRUCTIVE_APPROVAL` | `false` | `true` 时删除类操作走审批（native + 对齐的 tRPC `memory.delete`/`post.delete`）；见 `approvalGate.ts` |
| `APPROVAL_PENDING_TTL_MS` | `86400000`（24h） | pending 审批过期后标 rejected；`0` 关闭 TTL |

### 启用免费 API Key 同步

```bash
pnpm --filter @knowpilot/server run sync-free-keys     # 单次同步
pnpm --filter @knowpilot/server run sync-free-keys:watch  # 定时刷新
```

---

## 安全与敏感信息

- `.env` 文件被 `.gitignore` 忽略，不得提交到 Git。
- `.env.example` 仅包含占位值，用于说明所需环境变量：
  - `DATABASE_URL`：SQLite 路径（当前为 `file:./dev.db`）。
  - `SERVER_PORT`：后端端口（默认 3010）。
  - `DEEPSEEK_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`：L2+ AI 能力使用，当前未启用。
- 当前默认 `AUTH_MODE=none` 无鉴权；远程部署可设 `AUTH_MODE=password`。若暴露到公网，必须启用鉴权并增加反向代理、限流等措施。
- SQLite 文件 `apps/server/prisma/dev.db` 被 `.gitignore` 忽略，但 `content/posts/` 下的 Markdown 源文件受 Git 跟踪，是数据的持久化真相源。

---

## 运行时配置（config.yaml）

业务行为参数统一放到项目根目录 `config.yaml`，与 `.env` 的部署/密钥配置分离，便于教学与版本管理：

```yaml
llm:
  defaultModel: deepseek-v4-flash  # 全局默认模型 id；env DEFAULT_LLM_MODEL 可覆盖，缺省回退 shared DEFAULT_LLM_MODEL 常量

stream:
  ringSize: 500          # SessionStreamHub 内存环形缓冲事件数
  persist: true          # 是否持久化事件到 SQLite
  eventTtlMs: 300000     # 持久化事件保留时长
  cleanupIntervalMs: 60000 # 过期事件清理间隔

# W7 反思（默认关闭）：done 前一票结构化 critic，不通过经 injectUserMessages 回注重修
reflection:
  enabled: false
  maxRounds: 1           # 反思重修轮数；轮数耗尽带 [未经反思通过] 标记放行
  criticModel: ""        # critic 便宜模型；空 = 与主 Agent 模型相同
```

- `SessionStreamHub` 采用「内存热缓冲 + SQLite 事件日志」双写：低延迟推送走内存，断线续传 / 服务端重启恢复走数据库。
- 运行中的 Agent 任务执行体仍随服务端进程重启而丢失；**服务重启一律不自动续跑**（用户明确要求）——所有僵尸 running/queued Task 统一标 failed「服务重启，任务中断」，留待人工 `retryAsyncJob` 手动恢复。`reentrant`/`maxRetries`/`retryCount` 三列已从 schema 删除（不再存在「可重入自动续跑」分叉）。paused 会话由用户手动恢复（`chatSession.resume`）。

## 部署相关

- **Docker**：根目录 `Dockerfile` + `docker-compose.yml`（`docker compose up --build`）。
- **CI**：`.github/workflows/ci.yml`（lint + Vitest + Playwright E2E）。
- **生产构建**：根 `build` 前执行 `pnpm db:sync`；server 独立运行时配置 `SERVER_PORT` 与 CORS。
- **备份**：`pnpm db:backup` 导出 `dev.db` 到 `backups/`。

---

## 给 AI 助手的快速导航

| 你想做的事 | 先看这里 |
|---|---|
| 了解产品背景与快速开始 | `README.md` |
| 了解迁移/重构原则与同步机制 | `MIGRATION_PLAN.md` |
| 了解 L1-L5 阶段划分与当前状态 | `docs/development/README.md` |
| Swarm 架构设计决策 | `docs/development/design-decisions.md` |
| P0 Agent 架构 PR 拆分（工具/HITL/Steering/LoopContract） | `docs/development/p0-agent-arch-pr-split.md` |
| 项目模块 / 实体 / CRUD / 前端用法 | `docs/development/README.md` |
| 具体使用场景（Agent / 子 Agent / 异步任务） | `docs/development/scenarios.md` |
| 并发 / 阻塞 / 竞态条件防护 | `docs/development/concurrency.md` |
| UI 实时性铁律（推拉结合） | `AGENTS.md`「状态在内存 · 推拉结合 · 刷新不丢」；`infra/uiStateNotify.ts`；`.cursor/rules/ui-state-realtime.mdc`；Chat 样板 `chat-state-architecture.md` |
| 开发踩坑与教训（战地笔记） | `docs/development/开发心路历程.md` |
| 未来功能规划 | `docs/development/future-features.md` |
| 文内手写画板 | `apps/web/components/editor/BoardCanvas.tsx`（编辑器 `/hb`） |
| 算法可视化 / Remotion / ```viz 播放 | `docs/development/algo-viz-workflow.md`、`apps/algo-viz`、`config/skills/algo-viz`、Agent `algo-viz-director` |
| 修改前端样式/组件 | `apps/web/components/`、`apps/web/app/globals.css` |
| 修改 Agent 工具 / MCP / Skill 运行时 | `apps/server/src/infra/agentTools.ts`、`apps/server/src/infra/tools/`（ToolCommand 注册表 + `native/{fs,web,shell,swarm,session,memory,integration}`）、`apps/server/src/infra/loop/`（统一 ReAct 内核） |
| 新增或修改 tRPC Router | `apps/server/src/router.ts`、`packages/shared/src/schemas.ts` |
| 新增内容同步逻辑 | `apps/server/src/scripts/sync.ts`、`apps/server/src/scripts/sync/sync-*.ts` |

---

## 设计决策 Q&A 流程

当遇到需要用户决策的设计问题时，遵循以下流程：

1. **AI 把问题写入文件**（如 `docs/development/design-decisions.md`），每条问题包含：
   - 问题描述
   - 推荐的解决方式
   - `回答：` 占位行
2. **用户在文件内回答**：直接在 `回答：` 后写回复
3. **回答约定**（2026-07-29 修订）：
   - **纯基础设施**（无用户可感知默认行为变化）不写回答 = 默认同意推荐方案
   - **产品 / UI 默认**（发送路径、队列语义、快捷键、可见文案、与已定场景文档冲突的项）**必须显式回答**；空回答不得落地（问题 A 用「默认同意」把 Pi steer 盖过 §4 发送队列即前车之鉴）
   - 用户**写了回答** = AI 需阅读并据此调整，如有疑问再追加问题
4. **AI 读取回复后**：确认的决策移入「已确认 ✅」表格，新问题继续追加到文件末尾

---

## 当前状态与近期变更（2026-07-16）

- **feat/chat-kimi-composer 已合入 master（2026-07-21，WIP 整合）**：Kimi 风格模型菜单（hover 飞出子菜单）、chatQueue/messageNavRail/sessionContextUsage 等 Chat UI 增强、飞书 docx 集成（`infra/feishuMarkdownToBlocks.ts` Markdown→blocks + `feishu_append_doc_text`/`feishu_append_doc_blocks` 工具）、tombstone 防迟到 DB 塞回（`consumedQueueDbIds`）、resumeClaimed、done watchdog、软暂停立即标 paused、upsert field-level merge（undefined 字段保留 prev）。与修复套件（PR-1~6 + W1~W5）12 文件冲突的解决原则：**架构语义一律以修复版为准**，WIP 正交特性保留；唯一被取代的 WIP 机制是 sealUserAbortStream 本地占位（与 E3 stop 契约 `partialAssistantMessageId` + abort-pending 解决同一问题，按禁止双轨纪律删除，含其测试）；hub.stop 对齐 A5（任何 stop 清内存注入队列，持久行 run 收尾统一移交 user 队列），软暂停标 paused 保留；done watchdog 武装/拆除条件对齐 ABORT_STREAM（带 partialId=武装，null=拆除）；`steerInject`/`sessionResume` T9/T12 断言对齐 A4 三态与 A5 移交语义；circuitBreaker streak 测试 waitFor 加宽至 15s（WIP 新增真实流式测试抬高并行负载，1s 默认值不敷）。
- **W4 context 钩子链已落地（`feat/context-hooks`→master）**：新建叶子 `infra/contextHooks.ts`（`registerContextHook` / `runContextHooks`；内建 order 100–999，外部 1000+；同名覆盖；单钩子异常 warn 跳过）；reactLoop 在每次 `transport.complete` 前接入（sync/stream 共用内核）。`promptBuilder` 的记忆/tier 身份/工具引导迁为内建钩子 `memory`/`tier-identity`/`tool-guide`/`agent-extras`，`buildSystemPromptWithHints` 删除、调用方只拼 `buildSystemPromptSkeleton`；**v1 内建钩子 `enabled: round===1`** 保持「每 run 开头注入一次」现状语义（每轮生效留给后续钩子自选）。等价性快照 `__tests__/fixtures/contextHooks.equivalence.json` + `contextHooks.test.ts`。设计见 `design-decisions.md`「W4 context 钩子链」。
- **W3 审批 decision-scope / safe bypass 已落地（`feat/approval-scope`→master）**：`Approval.decisionScope` + `lastNotifiedAt`；叶子 `infra/approvalScope.ts`（派生 `<domain>:<verb>:<target>`、通配匹配、`requiredScopes` 工具集推导、通知冷却）；创建审批写 scope 并刷新 pending 缓存；`AsyncJobOrchestrator` 准入链优先 gate 相交（`reason=gate`，被堵 lane 挂着其余继续；容量类保留入队首因）；心跳 `wait_user_gate` 附带被堵 scope，不相交且有队列可 `bounded_delivery`；同 gate 一次性只读 turn（`safeBypassUsed`，无只读工具则纯等待；写工具 `readonlyOnly` 硬拒）；`config.yaml` `approvalGate.notifyCooldownMs`（默认 30min）。UI：`/approvals` 展示 scope、`/runs` awaiting_human 显示被堵 scope、右栏「因审批 X 阻塞 scope」。测试 `approvalScope.test.ts`。设计见 `design-decisions.md`「W3 审批 decision-scope」。**边界：v1 保留单 run 内 awaiting_human 挂起，升级的是跨工作项调度面。**
- **PR-1 数据同步完整性已落地（`arch/data-sync-integrity`→master）**：D1（`a10d1a5c`）FileSyncService 双写改为文件先行 DB 后投影（create/update/delete + 失败补偿；`deleteFileBySlug` 禁止静默吞错）；D2（`a916242e`）`getFilesRecursive` 统一 ignoreDirs 跳过 `.trash`/点目录（修 Windows 回收站复活）；D3（`ca3f5dfb`）slug 消毒 + `safeEntityNameSchema`/`safeEntitySlugSchema` + content 子目录落点校验；D4（`97c0eebd`）watch `guardedWatchDeleteBySlug` 5s 改名窗口保护 + 全量重扫标记；D5（`8f9e8978`）FTS 收进 syncer upsert/deleteBySlug、rebuild 过滤墓碑、mcp/prompt 补挂钩；D8（`0757c085`）`supersedeUpdate` 两步写包事务、memoryService 缺省显式 `console.error`。设计权衡见 `design-decisions.md`「PR-1 Markdown↔DB 投影层完整性」；体检表已标「已修复@commit」。
- **PR-2 审批/断路器/预算已落地（`arch/approval-circuit-budget`→master）**：C3（`1f19ee4f`）审批等待「注册先行、对账在后」+ TTL 须条件写 count=1 + expireStaleApprovals 只 notify 翻转成功行（A6 与 ask_user abort 语义文档化）；D6（`36a785b2`）删除硬编码 `DESTRUCTIVE_NATIVE_OPS`，`listDestructiveNativeOpsForApproval()` 从 registry 派生，`approvalExempt` 豁免创建/写入类，`agent_delete_sub` 纳入审批；C6（`a8b22159`）CircuitBreaker half-open 探测令牌，迟到无令牌事件忽略；C5（`fd63331f`）启动 `await hydrateLlmBudget` 同日 max 合并 + 日预算软语义「估算下界、并发可超」（预留制登记待办）。设计见 `design-decisions.md`「审批 / 断路器 / 预算」；并发语义见 `concurrency.md` §13。
- **PR-3 心跳/调度器已落地（`arch/heartbeat-scheduler`→master）**：C7（`63af42c2`）`claimTaskRun` 单点认领，TaskService.run / TaskScheduler / TriggerEngine 三入口共用；C1（`d14fc926`）恢复扫描收拢心跳/cron/oneshot 僵尸 + 心跳 Task 先 queued 再会话级原子认领 + 池拒绝「队列满」收尾并计 streak；C2（`af286fe2`）refresh 串行 promise 链 + generation 令牌防双发/泄漏；C4（`046a169f`）consecutiveFailures/lastRun* 用 SQLite `json_set` 原子更新，禁止整 blob 覆写。设计见 `design-decisions.md`「心跳调度与 Task 认领」。
- **W2 心跳决策层已落地（`feat/heartbeat-decision`→master）**：新建纯函数叶子 `infra/heartbeatDecision.ts`（禁止 prisma）；`triggerHeartbeat` 收集 signals → `buildHeartbeatDecision` → `bounded_delivery`/`repair` 才入池，其余写 Log（`event=heartbeat_decision`）；`wait_user_gate` 附具体 summary + 通知冷却；quiet/monitor 用 skip 计数退避（1→3→7→cap，`reset_token` 变化归零）；`terminal_no_followup` 复用 `heartbeatSuspendedAt`（`decision.terminalAt` 防 refresh 误摘除）；`Agent.heartbeat.decision` 子键 `json_set` 原子更新。`config.yaml` `heartbeat.decisionEnabled/quietCap/terminalAfterQuiet/gateNotifyCooldownMs`；swarm_brief + `/agents` 展示 lastMode/skipRemaining。测试 `heartbeatDecision.test.ts` + `heartbeatDecisionEngine.test.ts`。设计见 `design-decisions.md`「W2 心跳决策层」。
- **PR-6 Web Chat store 不变量已落地（`arch/chat-web-store`→master）**：E1（`3aea9557`）`ackThenMarkDelivery`——`claimed:true` 后才 mark，失败可 unmark；E2（`b4094a95`）COMMIT/COMPLETE/FAIL 相位合法性表 + `ABORT_STREAM`（禁 streaming→idle 直跳）；E3（`a0a2dbab`）stop 契约 `partialAssistantMessageId`→abortStream（有 id 等对齐 / null 立即 idle），删 `setTimeout(2000)`；E4（`714fe080`）`MessageHydrateSource` view|prefetch，prefetch 不置 drainRequested；E5（`3776708f`）hydrate same-id `pickFresherMessage`；E6（`0d9e16a7`）队列水合统一 `mergeUserQueueFromDb`。设计见 `design-decisions.md`「PR-6 Web Chat store 不变量」。
- **PR-4 投递对账 / 队列认领已落地（`arch/async-delivery-queue`→master）**：B1（`74e26ea5`）`output.deliveryExempt` 台账，reconciler Pass 1 跳过豁免行；B2（`84f5b573`）`SessionQueueItem.claimedAt` 软认领 + finalize 删行 + 启动 `releaseStaleClaims`；B3（`3e6f340d`）autoConsume `waitFor` 移到 `runConsumeJob` 之前；B4（`78e74dec`）恢复认领写 `resuming`，僵尸会话 paused 先于 Task 续跑；B5（`cbc8d637`）depth 服务端物化（叶子 `delegationDepth.ts`）；B6（`82dfa081`）`Promise.resolve().then(execute)` 同步抛错不漏槽；B7（`a555470a`）`@@unique([sessionId, agentMessageId])` + 事务 create / P2002 幂等。设计见 `design-decisions.md`「PR-4 投递对账」。
- **PR-5 流式内核不变量已落地（`arch/stream-kernel`→master）**：A1（`57b0fe2b`）synthesizing AbortError 重抛 + `finalizeRun` 拒绝 aborted→success；A2（`ee762e2f`）`SessionStreamEvent.seq` 为 SSE id/续传/重放单一事实源，token 合帧带 id，DB 已有 done 不补 synthetic done；A3（`8e6a3eb6`）`ChatSession.compactGeneration` + persist 单事务 CAS，running 拒手动 compact；A4（`2afbc363`）`startIfNotRunning` 三态 started/duplicate/busy，占位键 `pending:${clientMessageId|uuid}`，busy→409；A5（`84132a60`）enqueueInject 先写 `SessionQueueItem(kind=steer|follow_up)`，ack 确认消费，收尾 `handoffUnconsumedInjects`→kind=user（与 PR-4 `claimedAt` 软认领叠加）；E3 服务端（`d42f82f4`）stop 响应 `partialAssistantMessageId` 与 abort 落库同 id（web 侧 PR-6 已消 2s setTimeout）。附带：`SessionService` 强制单主会话（P11 ensureMainSession 与二次 create 不再双主）。设计见 `design-decisions.md`「PR-5 流式内核不变量」。
- **2026-07-20 架构深度体检 + 重构套件已合入**：体检快照见 `docs/development/architecture-audit-2026-07-20.md`；PR-1～PR-6 + W1～W5 已落地。过程用的 refactor-plan / refactor-prompts 套件已退役删除。
- **v10 reentrancy 基座已整体撤销（C-1/C-2）；仅保留 C-3 会话手动恢复**：① **C-1 可重入性基座已删除**——Task 表 `retryCount`/`maxRetries`/`reentrant` 三列已从 schema 删除（`ALTER TABLE DROP COLUMN`），`inferTaskReentrant` 函数、`NativeToolDefinition.reentrant`/`ToolCommand.reentrant` 字段、`registerDomain` 透传、34 工具 `reentrant: true` 声明、入队物化、`retryAsyncJob` 物化全部删除；`config.asyncJobs.maxRetries` 配置项删除；`approvalScope.isReadonlyTool`/`listReadonlyNativeToolNames` 改用 `!destructive` 判断只读；`reentrancyModel.test.ts` 删除，`reentrantResume.test.ts` 重写为统一 failed 语义。② **C-2 自动续跑已撤销**——`recoverStaleAsyncJobs` 所有僵尸 running/queued Task 统一标 failed「服务重启，任务中断」，不重建执行体；`retryAsyncJob` 手动重试保留（人工最后一道闸，不再物化三列，直接重建执行体入池）。③ C-3（`81a7e481`，server 侧）会话手动恢复闭环保留——`chatSession.resume` 条件写 `paused→running` 唯一互斥锁（并发 double-resume 只一生效；已 running 幂等返回；archived/failed 等 BAD_REQUEST），获权后注入 source:system 消息「（服务已重启，请继续完成未完成的任务）」经 `hub.startIfNotRunning` 交互式起流（v8 Q2 口径：不入池计全局占用），起流抛错回滚 paused，终态归位挂 runner 内（done→active/completed、error/abort→paused 可再恢复）；web 恢复按钮 + e2e 由并行工单落地（commit 后补）。④ C-4 文档：决策记录见 `design-decisions.md` 文末「可重入与续跑 Q1~Q4」；并发不变量见 `concurrency.md`「可重入与续跑」节；语义全景 `async-tools-semantics.md`。测试 `reentrantResume.test.ts`（T1~T4）+ `sessionResume.test.ts`（T6~T8），均过变异验证。
- **v9 投递可靠性已落地（R-1/R-2/R-3/R-4）**：① R-1（`5a410784`）S3「认领了但气泡没进会话」两层根治——同链即时回滚（CLAIM 后 `startIfNotRunning` 返回 false = 确定未写消息，事务回滚 `delivered=false` + W14 账本回滚 + 重挂消费链队尾；宁漏勿错：started=true 后抛错等无法判定路径不回滚，交第二层）+ 对账者 reconciler（收进 `asyncJobManager.ts`，启动即扫+周期扫，周期复用 `stream.cleanupIntervalMs` 无新增 config 面；扫 `delivered=true` 终态、超龄 60s、未 pinned、`deliverToQueue≠false` 且 ChatMessage 无 `toolResults.subagentResult.jobId=X` 的孤儿 → 条件写回滚（与前端 ack `markAsyncDeliveryConsumed` 条件互斥）→ `notifyAsyncDelivery` 重走正常管道补投，每轮上限 50；ChatMessage 为唯一 ground truth，全动作幂等）。② R-2（`899978d3`）`runStartupRecovery` 启动首扫四动作（index.ts 启动序列挂载，shutdown 停 reconciler）：僵尸 running/queued Task→failed（「服务重启，任务中断」，**不自动重跑**——tool 任务有副作用、进度未知，盲目重跑可能重复执行；`retryAsyncJob` 保留手动重试）、僵尸 running ChatSession→paused、superior 孤儿 SessionQueueItem 重注册 drain（v7 W-E 机制）、delivered=false 终态重新 notify（与 R-1 reconciler 同一幂等入口 `reconcileAsyncDeliveries`）；AgentMessage pending 超龄走 W14 既有 stale 对账，未新造逻辑。③ R-3 历史闭环四项：v6 自审补跑（`review-final-w16.md` 结论通过，揪出 agentDrift 假绿已修 `7da7c20f`）、stash@{0} 逐 hunk 对照后 drop、`PLAN_STATUS.json` 零消费者删除、2 个假绿测试修复（`56bb100e`）。④ R-4 文档：决策记录见 `design-decisions.md` 文末「投递可靠性 Q1~Q3」；并发不变量见 `concurrency.md`「投递可靠性」节。测试 `__tests__/deliveryReliability.test.ts` + `startupRecovery.test.ts`。
- **v8 全局任务池已落地（TP-1/TP-2）**：`infra/asyncJobOrchestrator.ts` 成为后台任务并发容量的单一事实源——容量/互斥不变量（maxGlobal、maxPerSession、maxPerWorkspace、maxQueued、taskTimeoutMs、queuedTimeoutMs）收在执行层；`spawn_subagent(waitForResult=false)` 等后台执行统一走池容量准入（queued 期间跟踪 Task / 子会话状态落 queued），准入判定链 global→session→workspace，queued 记录 reason+position，右栏三组状态（进行中/待消费/已消费）的「进行中」组展示「第 N 位 · 因 X 上限排队」。配置在 `config.yaml` `asyncJobs` 节（maxConcurrent=2、maxPerWorkspace=0、maxQueued=100 等）。四条设计决策——Q1 全局单池（LLM 成本是全局的，会话间公平靠调度而非分池）、Q2 交互式运行不入池但计入全局占用（hub 即时起流零排队 + `onHubRunSettled` 活性钩子）、Q3 消费续跑与执行正交（`runConsumeJob` 高优通道：队首优先 + 全局占用约束，CLAIM 移到获槽后）、Q4 `waitForResult=true` 血缘槽位继承防死锁（inline 不占新槽，同一血缘同时只有一个执行体占槽）——见 `design-decisions.md` 文末「全局任务池 Q1~Q4」；并发防护细节见 `concurrency.md`「全局任务池」节。测试 `__tests__/globalTaskPool.test.ts`。
- **v7 异步工具体系收敛已落地（W-0/W-A/W-E/W-F）**：① 双工具分工——`spawn_subagent` 专职带 LLM 子任务，`async_task_run` 收窄纯工具（删 `mode` 参数、`toolCall` 必填；`buildAsyncExecute` llm 分支保留给前端「派生子代理」按钮）；② **`async_task_wait` 工具删除**（注册表/权限清单/UI 全清 + 负向断言）；③ `async_task_status` 去全文（只回状态元信息，结果全文唯一通道 = `Task.delivered` 原子 claim；问题 G 撞车面机制性消除，见 `design-decisions.md` v7）；④ 右栏状态页两级分组「异步队列/同步任务」（W-A：`pullAsyncDeliveries`/`pullConsumedAsyncDeliveries` 过滤 `deliverToQueue=false` + 新增 `listSyncAsyncJobs` + `pullAsyncQueue.syncTasks`）；⑤ W-E running 子 Agent 消息服务端持久队列 + 空闲自动 drain（见下条）；⑥ W-F 存量清理——dev.db 历史 `sourceType="async_task_llm"` Task 行物理删除（执行 0 行命中）+ 全仓残留清扫。「启动后改主意要结果」新姿势 = `agent_send_message` 经服务端队列催子提前 `report_back`。决策记录见 `design-decisions.md` 文末 v7 节。
- **W-E running 子 Agent 消息服务端持久队列 + 空闲自动 drain 已落地**：`triggerAgentRun` 重构为 `prepareAgentRun`（返回 started/queued/failed 三态），busy 判定前移到写 ChatMessage 之前——子会话 running（或 idle 但队列有残留）时消息走 `bus.send`（depth/queue-size 守卫，旧 autoRun 路绕过的守卫此路径补上）写 AgentMessage pending + `sessionQueueItem.create` superior 幂等镜像，**不写 ChatMessage**；新增 `enqueueSuperiorQueueDrain`（asyncJobManager，复用 per-session 串行链，waitFor 空闲 → consume 原子认领 → 重入 `prepareAgentRun(fromDrain)` 起流 → 下一项，FIFO）。`SessionQueueItemService.consume` 改软认领（`{success, claimed}`，不存在/并发落选返回 `claimed:false` 不抛错，deleteMany 删除即认领），前端 `useChatQueueDrain` superior 项 `claimed:false` 静默跳过不起流（防双跑）。`agentRunLocks` 收窄为只覆盖 prepare 段。`waitForRun=true` + busy：等该 item 的 drain 链完成后读最后 assistant 返回。spawn_subagent 派活首轮（新会话必闲）与 `agent_report_back` 路径不变。测试 `__tests__/superiorQueueDrain.test.ts`（T7 等 4 例负向断言，旧实现即红）。
- **W16d stream 反思接入 / 心跳熔断持久化 / drift 横幅已落地**：W16d-1 stream 链路接入 `withReflection`（agentStream，与 agentRuntime sync 链路对齐，`config.yaml` `reflection.enabled` 默认 false、开启全覆盖；`__tests__/reflection.test.ts`）。W16d-2 心跳熔断 suspended 从引擎内存态持久化到 `Agent.heartbeatSuspendedAt`（schema +1 列），恢复按个体 Agent（不再随 `refresh()` 全体复活）；`circuitBreaker.test.ts` 扩充。W16d-3 drift 可发现性：默认 assistant 配置漂移不再只有 server `console.warn`——新增只读 `agent.driftStatus` tRPC 通道（`agentResolver.getAssistantDriftStatus`，不创建不修改，assistant 不存在返回 `agentId=null` 绝不引导创建），`/agents` 页顶部 `assistantDriftBanner.tsx` 横幅（drift 为空渲染 null，附一次性迁移脚本提示）；测试 `agentDrift.test.ts` + `assistantDriftBanner.test.tsx`。决策记录见 `design-decisions.md` 末尾。
- **W16a W14 记账三 bug 已修复**：① consumed 不再覆写 `deliveredAt` 真账——`delivered → consumed` 不动该字段，`pending → consumed` 直跳才按消费时刻兜底补齐；同型五处一并修正（`agentMessageLedger.markAgentMessageConsumedByTaskRef`、`swarmBus`/`redisSwarmBus.markConsumed`、`SessionQueueItemService.consume()`、`shouldSkipSuperiorMirror` 滞留兜底改条件 `updateMany`）。② waitForResult（`deliverToQueue=false`）路径 report_back 直接把旁路邮箱 AgentMessage 置 `consumed`（结果已由 tool return 交付），`deliveredAt` 如实记为 report_back 时刻——根治永远 pending、修复脚本告警不消解、`SWARM_MAX_QUEUE_SIZE` 累积堵 QUEUE_FULL；决策记录（方案 A）见 `design-decisions.md` 末尾。③ `taskRef` 对账键移出 `agent_send_message`/`agent_report_back` 的 LLM 可见 zod schema，handler 不再读 `args.taskRef`（LLM 传了也无效），唯一写入点为 report_back 桥接服务端强制写 jobId；`AgentMessageInput.taskRef` 死字段连带删除。每 bug 均先写负向断言测试（旧实现红）再改实现，`agentMessageLedger.test.ts` 9 → 12 例。
- **W16c compat 清零收尾**：C6 剩余 `globals.css` `--vp-c-*` 兼容映射块（14 个零消费变量）整块删除；`agentRuntime.ts` 无消费者 re-export trio（DEFAULT_SUBAGENT_TOOLS / resolveToolsForAgentTier / parseToolCall）删除；一次性脚本 `scripts/fix-agent-message-ledger.ts` 执行 0 命中后退役删除（对账核心 `reconcileAgentMessageLedger` 迁入 `infra/agentMessageLedger.ts`，package.json script 同步移除）；全仓终扫 `兼容|legacy|LEGACY|deprecated|backward` 生产代码零命中。
- **v4 工单（W13~W15 + 问题 G）全部完成**：W13 chat.tsx 拆分收官（编排簇收拢 `useChatRunStream`/`useChatQueueDrain`/`useChatSseSubscriptions`/`useChatEnqueue`/`useChatDerivedQueues`）；W15 兼容债务清零。问题 G 以 `Task.delivered` 原子 claim 为全文交付唯一互斥点落地（见 `design-decisions.md`）。

- **W14 AgentMessage 投递记账回写已落地**：report_back 的消费载具是 Task 管道（autoConsume 原子认领 → 注入父会话气泡），旁路邮箱 AgentMessage 此前永不回写（pending 残留 = 重复投递定时炸弹）。新增叶子模块 `infra/agentMessageLedger.ts`（按 `taskRef=jobId` 对账，updateMany 条件幂等）：① `agent_report_back` 在桥接段把 AgentMessage 关联 `taskRef=jobId`；② delivered 回写落在两处原子 CLAIM 同事务（服务端 `autoConsumeAsyncDelivery` + 前端 `markAsyncDeliveryConsumed`）；③ consumed 挂点在 `chatAgentStream`（两条认领路径都带 `toolResults.subagentResult.jobId` 经过，历史加载 + LLM messages 构建完成即「读入上下文」）；④ 幂等防线收在 `SessionQueueItemService.create`（superior 镜像投递前对账：已 delivered/consumed 不再镜像；滞留 pending 超 5min 且会话已有同 content 消息只回写 consumed 不注入）；⑤ 存量对账 `reconcileAgentMessageLedger`（W16c 起收在 `infra/agentMessageLedger.ts`，原一次性脚本执行 0 命中后已退役；滞留 pending 超 1h 对照目标会话，已注入置 consumed、未注入保持 pending 并告警）。问题 G（Task 侧 consumedBy 语义扩展）不在本工单范围。测试 `__tests__/agentMessageLedger.test.ts`（9 例）。
- **W13 chat.tsx 拆分已收官**：消息列表 / 左栏 / 右栏外提；effect 收进域 hook；编排簇见上。不变量以 `chat-state-architecture.md` 为准。
- **W12 MCP 断路器 + 审批清理定时化 + 心跳熔断暂停已落地**：新增 `infra/circuitBreaker.ts` 通用三态断路器（closed→open→half-open；`transition()` 转移表拒绝非法转移 open→closed / closed→half-open；open 期陈旧成功不合闸、陈旧失败不重计时；half-open 单探测）。接入 `executeMcpTool`：每 MCP server 一实例（模块级 Map + `__resetMcpCircuitBreakersForTests`），首试+重连重试整体计一次失败，open 期零真实连接、返回 `MCP_CIRCUIT_OPEN` 结构化结果喂回 LLM（不抛）。审批过期清理每日 cron（`3 4 * * *`）挂 HeartbeatEngine maintenance 通道（不随 refresh 重建；启动一次性清理仍在 index.ts）。心跳 streak 达 `HEARTBEAT_MAX_CONSECUTIVE_FAILURES` → 引擎内存态 suspended 暂停并摘除 cron job（恢复：下次 refresh() 或 `resumeHeartbeat()`，告警邮件同步说明）。测试 `__tests__/circuitBreaker.test.ts`（11 例）。
- **W11 Run 活状态 + awaiting_human 已落地**：reactLoop 内核统一接管 Run 生命周期——入口落 `status:"running"` 行、每轮 tool_batch 后 `{ phase, roundsUsed, executedToolsCount }` 快照写 `Run.output`（5s 节流，phase 转移点强制写）、终态统一 update（success/failed，用户 abort 标 cancelled），调用方（agentStream/agentRuntime）不再自建终态行。新增 `awaiting_human` phase（合法转移 `tool_batch → awaiting_human → llm`）：工具触发审批 pending 时 loop 挂起，等 `approval_resolved` 显式事件（approvalGate 等待注册表 `waitApprovalResolution`/`notifyApprovalResolved`，waiter 自带 TTL 截止与 expireStaleApprovals 同规则）唤醒，续跑消息复用 W7 injectUserMessages 注入原 session（kind=approval）；拒绝/过期注入消息让 LLM 收尾、run 正常结束。`recoverStaleRuns` 启动挂载（index.ts，recoverStaleAsyncJobs 旁）把遗留 running Run 标 `interrupted`（如实不续跑）；/runs 页补 interrupted chips。测试：`runLifecycle.test.ts`（5 例）+ `agentRunPhase.test.ts` 扩充。

- **W10 SwarmOrchestrator 中介者已落地**：新增叶子模块 `infra/swarmOrchestrator.ts`（仅依赖 asyncJobOrchestrator/swarmPermissionGuard，无环），统一 `dispatch(taskSpec) → swarmPermissionGuard 校验 → 60s spawn 去重（agentId+hash(taskText)）→ 并发池/inline 执行 → 结果聚合 → Log 审计` 公共骨架。四入口改为调用方：`spawn_subagent`（inline，同步等待语义不动）、`async_task_run`（startAsyncAgentTask 内走 pool）、`heartbeatEngine`（**已删除返回 undefined 的 invokeTrpc 桩**，心跳 Agent 与 trigger/async 共用 createTrpcInvoker 真实通道）、`TriggerEngine`（run_agent 从直跑改为 pool + await completion 保住 per-trigger 互斥）。`swarmPermissionGuard.ts` 空块检查已删，#41 时机约束单点归属 swarmBus.send → checkUpwardMessageTiming。防线测试 `__tests__/swarmOrchestrator.test.ts`（dispatch 双路 spy / spawn 去重 / guard / 在途幂等）。
- **W9 AgentFactory 模板化已落地**：三 tier（super/manager/sub）默认模板收至 `config/agents/_templates/{tier}.md`（frontmatter 格式同普通 agent 文件，super 额外含 heartbeat 段，manager/sub 支持 `{{name}}` 占位符），新增叶子模块 `infra/agentFactory.ts`（`getTierTemplate` / `createAgentForTier`，模板按 mtime 缓存，缺失时回退 shared 常量并 warn 一次/tier）；swarmInitializer（super）、workspaceProvision（manager）、loop/setup（sub）三处创建/默认值均走工厂。sync 跳过 `_` 开头目录（`sync/utils.ts` getFilesRecursive + sync.ts watch ignored），模板不会进库。`resolveAgent` 已只读化：返回 `{ agent, drift: string[] }`（调用方经 `logAgentDrift` 打 warn），读路径不再写库；老库默认 assistant 修复走一次性脚本 `scripts/migrate-assistant-tools.ts`（`pnpm --filter @knowpilot/server exec tsx src/scripts/migrate-assistant-tools.ts`，幂等）。注意：`agent.list` 按 R19 裁剪 systemPrompt，漂移检测与调用方需经 `agent.getById` 取全量实体。单测 `__tests__/agentFactory.test.ts`（7 例）。
- **W8 常量化收敛已落地**：模型名/分层工具清单/深度上限/截断值单点定义到 `packages/shared/src/constants.ts`——`LLM_MODEL_IDS` / `LLM_PROVIDER_DEEPSEEK` / `DEFAULT_LLM_MODEL`（server 生效值 = env `DEFAULT_LLM_MODEL` > `config.yaml` `llm.defaultModel` > shared 常量，解析在 `config.ts`）、`TIER_DEFAULT_TOOLS: Record<AgentTier, string[]>`（super=swarmInitializer、manager=workspaceProvision、sub=loop/setup 三处清单收敛；assistant 清单为 `ASSISTANT_DEFAULT_TOOLS`，agentResolver 创建与补齐检查共用）、`SWARM_MAX_DEPTH`/`SWARM_MAX_QUEUE_SIZE`（swarmBus/redisSwarmBus/swarmPermissionGuard 同源）、`AGENT_TOOL_RESULT_MAX_CHARS=16000`（reactLoop snapshot 与 read_article 同源）、`MEMORY_INITIAL_STRENGTH`、`HEARTBEAT_MAX_CONSECUTIVE_FAILURES`、`APPROVAL_DEFAULT_TTL_MS`。心跳连续失败告警不再是「Phase 5」僵尸：发送通道抽为 `infra/emailNotifier.ts`（send_email 工具与 HeartbeatEngine 复用同一实现），streak 达阈值时邮件告警一次（`EMAIL_PROVIDER=none` 时降级为日志）。
- **W7 反思装饰器已落地**：`infra/loop/reflection.ts` `withReflection(transport, opts)` 在「即将 done」终轮（withTools 且零 toolCalls）用 criticModel 跑一票 JSON critic（`{passed, issues}`），verdict 附到 `LlmTurnResult.reflection`；**评估在 transport 装饰器、决策在 reactLoop done 转移点**——不通过且轮数未满经既有 `injectUserMessages`（kind=follow_up）回注重修，轮数耗尽带 `[未经反思通过]` 标记放行（不阻断用户）。critic 经内部 `createSyncTransport(config, criticModel)` 走 W2 弹性客户端；critic 失败/解析失败 = 静默跳过。`config.yaml` `reflection: { enabled: false, maxRounds: 1, criticModel: "" }` 默认关闭；仅接入 agentRuntime sync 链路，stream 链路另立跟进。单测 `__tests__/reflection.test.ts`（5 例）。
- **W6 D 类工具幂等 rollback 已落地**：`infra/tools/rollback.ts` 新增 `RunRollbackStack`——reactLoop 每 run 建栈注入 `NativeToolContext.rollbackStack`；`executeNativeTool` 对注册处标记 `destructive` 的工具执行前 capture、成功后 commit；run failed 且非用户 abort 时逆序补偿，报告写 failed Run 的 `output.rollback`。补偿语义：`write_file` 快照还原（run 级 10MB 上限）；`post_create`/`memory_create` 走 Service 删 id；`file_delete`/`directory_delete` 执行时移项目根 `.trash/`（用户手动清理），rollback 移回；`git_commit` 等不可逆操作如实 warn「需人工 revert」。单测 `toolRollback.test.ts`；详见 `docs/development/p0-agent-arch-pr-split.md` PR-4 节。
- **W5-followup 记忆三层落地**：scope 三层（`global` / `workspace:{wid}` / `agent:{aid}`）读写全通——`buildMemoryContext` 与 native `memory_search` 注入三层 scopes（Agent 有 Workspace 时）；`memory_create` 加可选 scope 参数，越权由 `memoryRepository.resolveMemoryWriteScope` 硬拦（仅 super 写 global、禁止伪造他 Agent/他 Workspace）；`accumulateExperience` 对属于 Workspace 的 Agent 双写 agent + workspace 两层经验（sub 无 memory 工具权限，workspace 层供管理/超级 Agent 检索）。
- **W1/W3/W5 已落地**：W1（`f2f889d4`）审批审计合规——`Approval` 加 `decidedBy/decidedAt/decisionNote/executedAt`，执行后软删除 `status=executed` 永不物理删除，过期清理改 `updateMany` 批量；W3（`209ac858`+`b4208022`）Chat Compose drain 收口——INV-8 单驱动不变量收进 useStreamLifecycle reducer（`drainRequested` + `HYDRATE_DONE` + 显式触发事件），双驱动补丁与 `await hydrate` 赌落库删除；W5（`3fc4be4d`）MemoryRepository 仓储抽象——`infra/memoryRepository.ts` 接口 + Prisma 实现，Memory 加 `scope`/`agentId`/`contentHash`，`decayMemories` 按日复利衰减归档，prompt 拼接/agentEvolution/native memory_* 全走接口。
- **W4 循环依赖环已打断**：原环 `agentRuntime → loop/index → reactLoop → agentTools → nativeTools → agentRuntime`。新增叶子模块 `infra/promptBuilder.ts`（buildMemoryContext / buildSystemPromptWithHints / buildTierIdentityHint / buildAgentToolGuide）与 `infra/agentResolver.ts`（resolveAgent）；W15 已删除 agentRuntime 的兼容 re-export，全仓 import 直连叶子模块。resolveAgent 经 `NativeToolContext.resolveAgent` 注入（createAgentToolContext 填充，缺省回退 agentResolver）。nativeTools 动态 import 15→3（仅 agentStream / asyncJobManager 两个环内模块 + nodemailer 可选依赖）。防线测试：`apps/server/src/__tests__/importOrder.test.ts`（import 顺序冒烟 + 源码防线）。
- **W15 兼容性债务清零（C1~C6）**：删除 agentRuntime 兼容 re-export；memory_search 删 page 伪装分页；feishu_send_text 删无 prisma 直发分支（缺上下文即报错）；session.list 统一 agentIds 批量过滤（单 agentId 入参移除）；全仓 compat 扫描清零——删 TOOL_NAME_ALIASES 空别名表、chat.tsx 旧 sessionStorage 键迁移块、未使用的 AsyncTaskQueueList、死代码 CLEAR_STREAMING_UI/clearStreamingUi、compact.charThreshold 死配置、ocrImage 死参数 chatSupportsVision、memory .json 同步分支（存量文件已迁 .md）、webScraper closeBrowser 别名、ChatModelOption.supportsReasoning 废弃字段；VITE_ 环境变量回退保留（本机 .env 在用）。

- **W2 LLM 弹性客户端已落地**：`infra/resilientLlmClient.ts` 装饰器包装 llmClient（错误分类 fatal/retryable/degradable + 指数退避 jitter 重试 + `config.yaml` `llm.fallbackModels` 按序降级）；`agentRuntime`/`agentStream` error 事件的 `retryable` 改为按分类真实填充；`llmBudget.ts` 预算状态改为模块级内存 + 防抖异步落盘（LLM 调用路径零同步 IO）。

- **P0 Agent 架构（分支 `fix/p0-agent-budget-hitl`）**：PR-1～7 已全部落地；native 工具已全量按域拆至 `infra/tools/native/{fs,web,shell,swarm,session,memory,integration}.ts`，`nativeTools.ts`（118 行）只留注册 + 分发。见 `docs/development/p0-agent-arch-pr-split.md`。
- **重复超级 Agent 已清理**：文件 `config/agents/KnowPilot 超级 Agent-v5wh3v.md` 已删除；`sync-agents.ts` 跳过 `tier === "super"`。
- **设计决策文档**：沉淀在 `docs/development/design-decisions.md`。

## 未来功能

1. ~~**Agent 自动开启新 Session**~~：已落地 `session_rotate`（归档旧会话 + 同 Agent 新会话 + 总结首条消息；旧页提示跳转不自动切换）。
2. **自动压缩（Auto-Compact）**：已产品化（`config.yaml` compact + `ChatSession.contextSummary` + 手动压缩）。
3. ~~**推送替代轮询**~~：Chat 侧已推优先（`async_job_update` / `agent_message` / `subagent_session_update`），轮询降为兜底。
4. ~~**PR-4b / 4c**~~：已落地（W6）——swarm/session/memory/integration 四域拆分，`nativeTools.ts` 3420 → 118 行。
5. ~~**长期后台任务跨重启续跑**~~：**已撤销自动续跑**（用户明确要求服务重启不自动续跑）——僵尸 Task 统一标 failed 留人工 `retryAsyncJob`；paused 会话手动恢复（`chatSession.resume`）；断点 checkpoint 续跑仍为未来扩展。

---

> 最后更新：2026-07-30。铁律升级为「推拉结合」：`uiStateNotify` + `cron_job_updated`/`approval_updated`/`session_list_changed`/`run_updated`/`task_updated`；管理页短轮询兜底。L1–L5 已全部落地；重构套件 PR-1～PR-6 + W1～W5 已合入；P0 Agent 架构 PR-1～7 已验收。

### 2026-07-22 追加

- **Chat 刷新丢回复修复**：SessionStreamHub `subscribeExternal` 不再重放 `message_upserted`；`useSessionMessages` 对 no-op upsert 跳过 `tryCommitAfterAssistant`，防止 stale 重放误标 in-flight；`agentStream` 落库后使用 `persistedCreatedAt` 推送。新增 `sessionStreamHubReplay.test.ts` / `upsertNoopNoInFlight.test.ts`。
- **Chat UI 增强**：右下角「回到底部」浮动按钮（Virtuoso `atBottomStateChange` 驱动，回底自动隐藏）。
- **记忆系统升级**：Memory 新增 `lastAccessedAt` / `accessCount`；`decayMemories` 按类型差异化衰减（preference/semantic 不衰减，note/procedural 0.98，episodic 0.95，experience 0.90）；衰减基准优先 `lastAccessedAt`（被调用即重置）。
- **审批邮件可回复**：Approval 新增 `lastNotifiedMessageId` / `lastNotifiedThreadId`；AgentMail webhook 支持第一行 `APPROVE` / `REJECT` 自动决策并执行；邮件主题统一为 `[KnowPilot 待审批]` / `[KnowPilot 需回复]` / `[KnowPilot 通知]`。
- **控制台视觉升级**：`globals.css` 新增 `kp-card-premium` / `kp-badge` / `kp-stat-number` / `kp-table` / `kp-progress` / `kp-lift`；Dashboard / Agents / Approvals / Runs 应用新设计系统。
- **README 重写**：删除 71 个命名候选，更新为当前真实状态。

### 2026-07-25 追加（审计 + 修复 + 规范内化）

- **深度审计报告落地**：`AUDIT_REPORT_2026-07-26.md`（收口摘要）。审计基于代码证据。
- **Swarm 竞态 / 工具死循环 / 工具设计审查**：P0-02（Swarm 竞态）、P1-01（spawn jobId 竞态）、P1-06（AgentMessage 投递记账）等均已在 v7~v10 + PR-1~6 + W1~W5 重构套件中系统性根治——事务写、CAS `updateMany` 条件写、同步占位认领、软认领、幂等 upsert、reconciler 对账多层防护已落地，代码证据见 `swarmBus.ts`/`swarmOrchestrator.ts`/`taskClaim.ts`/`sessionStreamHub.ts`/`services.ts`/`asyncJobManager.ts`/`agentMessageLedger.ts`。
- **mock-llm 测试服务落地**：独立 HTTP 服务（`apps/mock-llm` + `packages/mock-llm-core`），OpenAI 协议兼容，header `x-mock-scenario` 控制场景，共享 scenario 逻辑（流式 / 非流式 / 工具调用 / 错误注入 / 超时 / 限流）。修复 scenario 永久污染 `process.env` bug（改 `opts.scenario` 隔离到请求上下文）。用于 `resilientLlmClient` 重试 / 降级 / 错误分类的端到端测试，省真实 API 费用。
- **CancelledError 全链路根治**：父子 Agent 通信 SSE 风暴 + 低频用户操作路径 + invalidate/prefetch 全仓兜底，共修 70+ 处 `void promise` → `.catch(() => {})` / try/catch。详见 `AUDIT_REPORT_2026-07-26.md`。**铁规已写入 AGENTS.md「自主执行铁律」节**：今后禁止 `void <promise>`，单测绿不等于运行时无错，低频同样必修。
- **P2-01 选 B 落地**：`integration.ts` 2100 行 god file 拆为 137 行聚合器 + 5 个域文件（`integration/{email,git,yuque,github,feishu}.ts`），lint + 全量测试零回归。此拆分不违反「单文件收拢」铁律（铁律针对业务 Service / Router / Hooks / 通用组件，工具域定义 + handler 是叶子模块，按域拆是收拢的反面——是叶子化）。
- **P1-04 死字段清理**：删除 `Agent.apiKey`（schema + shared + services + native tools + 测试），`prisma db execute` 直接 SQL drop column。
- **P1-03 子任务**：LLM schema 体积 warn 落地；`defaultHidden` 现状确认。
- **AGENTS.md 新增「自主执行铁律」**：禁止 AI 把技术决策抛给用户、禁止列清单等用户挑、禁止打票不施工、禁止半成品交付。最推荐方案 = 默认执行方案，发现即修修完即验证。
- **子 Agent 隔离铁律落地（双通道重复投喂根治）**：父 Agent 收到子 Agent `report_back` 结果出现「两遍」根因 = 父经 `invoke_api` 通用后门读子会话消息 / 子任务 output 全文（通道 A）与 `autoConsume` 注入 tool result（通道 B）双投喂。架构层根治：
  1. **`invoke_api` 工具彻底下线**（`session.ts` 删函数 + def + handler；`shared/agentTools.ts` `DEFAULT_AGENT_NATIVE` 删；`shared/constants.ts` 三 tier `TIER_DEFAULT_TOOLS` + `ASSISTANT_DEFAULT_TOOLS` 删；`server/agentTools.ts` `hasInvokeApi`/`countAiReadableProcedures` 死代码删；web `agents/page.tsx`/`nativeToolGroups.ts`/`toolIcons.tsx` 删；测试 `nativeTools.test.ts`/`agentTools.test.ts`/`shared/agentTools.test.ts`/`trpcSmokeHarness`/`toolTestFixtures` 同步）。砍掉万能后门 = 砍掉所有「打地鼠黑名单」的维护负担。
  2. **`agent_inspect` 彻底不返消息内容**（`swarm.ts` 删 `recentMessages` 字段 + `isOwnChild` 脱敏分支；`sessions` 改 `select` 只取元信息 + `_count.messages`，不取 content；def 描述明示「不返回任何会话消息内容，子 Agent 结果只能经 agent_report_back」；hint 文案重申）。父 Agent 只能看子 Agent 的状态（id/title/status/messageCount/swarm 健康快照），不能看任何消息内容。
  3. **`async_task_status` hint 加固**（`asyncJobManager.ts` completed/failed 返回 hint 明示「结果已自动投递，无需主动拉取」），堵 LLM 轮询后窥探的动机。
  - **设计原则（已写入本节）**：子 Agent 的结果**唯一交付通道** = `agent_report_back` → `autoConsume` 注入父会话异步结果队列（带 jobId 台账）。父 Agent 对子 Agent 只可见状态，不可见消息内容。这是子 Agent 隔离的根本——否则子 Agent 完整上下文污染父 Agent，子 Agent 的存在失去意义。`invoke_api` 反射式「零胶水 Agent 化」是历史妥协，已被业界先例（闭工具集、无万能 API 后门）否定，本次彻底砍除。
- **系统提示词全家桶改进（符合主题）**：KnowPilot 主题 =「以 Markdown 为原子、AI 为引擎的数字花园」。统一三 tier 提示词基调：超级 Agent=总园丁（统筹全局、协调各 Workspace、维护长期秩序，但不替子 Agent 干活）；管理 Agent=园丁长（本 Workspace 负责人，编排子 Agent + 向上汇报）；子 Agent=园丁（被派去完成具体工作，结果经 report_back 交回）。落地：
  1. **正式模板文件** `config/agents/_templates/{super,manager,sub}.md`（frontmatter + 正文，含主题定位 + 能力/职责 + 行为准则；sync 跳过 `_` 目录不进库）；agentFactory 优先读模板，缺失回退兜底文案。
  2. **兜底文案** `agentFactory.ts` `SUPER/MANAGER/SUB_FALLBACK_PROMPT` 与模板正文对齐（精简版安全网）。
  3. **运行时身份约束** `promptBuilder.ts` `buildTierIdentityHint` 三 tier 分支强化「子 Agent 隔离铁律」——明示「你只能看子 Agent 状态，看不到消息内容，结果等 report_back」，与刚落地的架构铁律对齐。
  4. **会话/子 Agent 取名 prompt** `sessionAutoName.ts` `SESSION_PROMPT`/`AGENT_PROMPT` 加入主题语境（「数字花园」+ 角色名引导如「资料整理员」「代码审阅官」）。
  5. **等价性 fixture** `contextHooks.equivalence.json` 用当前 `buildTierIdentityHint` 重新生成（脚本复刻 agent-extras 钩子拼装逻辑：base→identity→memory→`\n\n`→guide）。
- **post_list 专用只读工具补充**：砍 invoke_api 后博客 Agent 失去列文章能力，补 `post_list`（`memory.ts`，reentrant=true 只读，调 `services.post.list`，service 已裁剪 content 不返正文，只返 id/title/slug/excerpt/category/tags/published/updatedAt 元信息）。与 post_create/update/delete 一致，**不加入 tier 默认清单**（按需勾选，闭工具集原则）。测试 fixture `ALL_NATIVE_TOOL_NAMES` 同步。
- **vision_describe 外挂视觉理解器落地**：纯文本模型（如 deepseek-v4-flash）看图能力的架构层补齐。新工具 `vision_describe`（`web.ts`，concurrencyClass B 只读）把图片交给多模态模型做语义理解，返回文字描述回灌给当前模型。与 `read_image` 区别：`read_image` 偏 OCR 文字提取（auto 优先 OCR，纯文本 Agent 走 OCR）；`vision_describe` 强制 vision 语义理解/描述/问答，默认用**免费多模态模型**不消耗付费额度。默认模型选择顺序：env `VISION_DESCRIBE_MODEL` → 当前 Agent 模型若支持 vision → Gemini provider（有免费层）→ OpenRouter 免费多模态（`google/gemma-4-26b-a4b-it:free`）→ `deepseek-vl2` 兜底。复用 `readImageWithVision`（base64 + resilientChatCompletion）。加入 `ASSISTANT_DEFAULT_TOOLS` + 三 tier `TIER_DEFAULT_TOOLS`（super/manager/sub 全配，纯文本 Agent 即开即用）。`.env.example` 补 `VISION_DESCRIBE_MODEL` 配置说明。
- **heartbeatDecisionEngine flaky 根除**：`vi.waitFor` 默认 1000ms 超时在全量高负载下偶发 SQLite 落库 >1s 触发超时（非测试间状态泄漏，是真实定时器+DB 轮询阈值不够）。给 `heartbeatDecisionEngine`/`heartbeatSchedulerC1`/`swarmOrchestrator` 共 7 处 fire-and-forget DB 轮询 `vi.waitFor` 统一加 `{ timeout: 5000, interval: 100 }`，彻底消除偶发红。
- **Chat 流式渲染对齐 Kimi（边流式边预览 + 思考计时 + 工具运行指示 + 重试竞态根治 + HTML 预览引导）**：用户反馈「长工具调用卡在 Thinking 无进度感」「要 Kimi 类似 HTML 预览」「重试 A 却 A 消失 B 重发」。根因诊断与修复：
  1. **流式期直接走 `PostContent`**（`chatMessageList.tsx` 流式气泡 `StreamingPlainContent` → `PostContent`）：代码块即时支持代码/预览切换、复制、最大化、换行，实现「边流式输出边视图渲染」；落库后复用同一渲染器，消除流式→终态视觉跳变。思考过程（reasoning_content）仍用 `StreamingPlainContent` 轻量渲染（避免高亮抖动）。
  2. **Thinking 计时进度**（`chatTimelineSteps.tsx` `ThinkingStep`）：isLive 起每秒计时，标题旁显示 `Thinking… Ns`，给长思考进度感，消除「卡住」错觉；终态停表。
  3. **ToolStep running 视觉指示**（`chatTimelineSteps.tsx` `ToolStep`）：原 running 状态只有脉冲圆点+边框，不够醒目。加 `Loader2` spinner + 「运行中」/「等待回复」（ask_user）文案（ml-auto 对齐 done hint 位置），与 `ProgressStep` 一致，工具调用进行中明确可见。
  4. **重试/重新生成竞态根治**（`agentStream.ts` `prepareMessage`）：原 `retryFromMessageId`/`regenerate` 只复用 A 的 assistant（`excludeAssistantId`/`updateAssistantId`），不删尾部消息——若 A 之后还有 B（A 的 assistant 失败后用户接着发 B），重试 A 时 B 残留，新 assistant 插入后 B 重复或 A「消失」B「重发」竞态。提取 `deleteTailMessages(services, sessionId, items, idx)` 辅助函数（单次 `deleteMany` + 推 `message_deleted` SSE 让前端即时移除），重试/重新生成/编辑三处统一调用：删除该用户消息之后的所有消息（含旧 assistant 与后续 user/assistant）再重发，对齐 ChatGPT 业界惯例。`excludeAssistantId`/`updateAssistantId` 不再设置（旧 assistant 已删，新建）。
  5. **HTML 预览系统提示词引导**（`agentResolver.ts` `DEFAULT_ASSISTANT_SYSTEM_PROMPT`）：用户要「写 HTML 页面/小游戏/可视化/可交互 demo」等可直接预览的内容时，直接在回复用 ` ```html ` 代码块输出完整代码（前端有「代码/预览」切换 tab 可即时渲染），不要 `write_file` 写文件（文件需另开浏览器体验差）；仅当用户明确要「保存到知识库/创建文件」时才 `write_file`/`post_create`。SVG 同理用 ` ```svg ` 代码块可预览。
- **assistant 多版本切换闪烁根治**（`useSessionMessages.ts` `pickFresherMessage`）：用户反馈「重试消息可以往前切换、无法切回后边、且一直闪烁」。根因：`pickFresherMessage` 对 assistant 用 `content.length` 判断新旧（为流式 SSE 递进设计：更长=更新）。版本切换到更短的旧版本时，`hydrateFromServer` 返回的 incoming（旧版本短内容）被 prev（新版本长内容）按 `content.length` 误判为「旧」而覆盖回新版本 → 切换无效 + hydrate 反复拉回闪烁。修复：assistant 比较前先看 `toolResults.versionMeta.activeIndex`——incoming 与 prev 的 activeIndex 不同即为版本切换（`switchVersion` 后端写回权威值），直接取 incoming，不走 `content.length` 逻辑。流式递进（activeIndex 不变）仍走原 `content.length` 判断，行为不变。
- **Workspace 落地 + content/ 污染根治（write_file 默认落 Agent 自己的 Workspace）**：用户反馈「每个 agent 都有自己的 workspace，为什么写到 content/workspace 下」「content 下有核心 posts 怎么能随便污染」「content 太包罗万象能不能拆」。诊断：`Workspace.path` 字段 schema 有、`swarmInitializer`/`workspaceProvision` 创建时也建了 `.knowpilot/` 子目录（Root=`workspaces/__system__`、Assistant Home=`workspaces/__assistant__`、业务 Workspace=用户提供的 path），但 `write_file` 完全没用 `Workspace.path`——`resolveSafePath` 一律相对 `projectRoot`，Agent 可写任意项目根路径，导致 `content/围棋游戏.html`、`content/go-game.html` 直接污染核心知识库根。架构层根治：
  1. **`safePath.ts` 新增 `resolveWithinDir(dir, relPath)` + `assertPathWithinDir`**：路径必须在指定 dir 内（防 `..` 穿越 / 绝对路径），用于 Workspace 隔离边界。
  2. **`fs.ts` `writeFileTool`/`appendToFileTool` 改用 `resolveWritablePath(ctx, relPath)`**：path 以 `content/` 开头 → 走 `projectRoot`（知识库资源，如 `content/uploads/` 放图片、`content/posts/` 写文章建议 `post_create`）；否则 → 落到**当前 Agent 的 Workspace 目录**（`ctx.agentSnapshot.workspaceId` 查 `Workspace.path` → `resolveSafePath`/`resolveWithinDir` 解析），无 Workspace 时回退到 `data/workspace/`。返回 `relForReturn`（相对 projectRoot 的路径）便于 `read_file` 复用。
  3. **工具描述 + 系统提示词对齐**：`write_file`/`append_to_file` def 描述明示「path 相对当前 Agent 的 Workspace 目录（如 `demo.html` → `workspaces/{当前workspace}/demo.html`）；`content/` 开头走知识库」；`DEFAULT_ASSISTANT_SYSTEM_PROMPT` 同步更新引导。
  4. **污染清理**：`content/围棋游戏.html`、`content/go-game.html` 移到 `data/workspace/`；`content/posts/.trash/` 212 个 e2e 测试垃圾物理删除（已 gitignore）；`data/workspace/` 加入 `.gitignore`（Agent 工作产物可重建）。
  5. **设计原则**：每个 Agent 有独立 Workspace，工作产物隔离——assistant 写 `workspaces/__assistant__/`、super 写 `workspaces/__system__`、业务 Agent 写自己 Workspace.path。核心知识库 `content/posts/`、`content/about/` 由 `post_create`/`post_update` 走 Service 同步管道保护，`write_file` 不直接写 `content/posts/`（会脱同步）。测试 `nativeTools`/`toolRollback` 路径同步迁到 `data/workspace/`，全量 767/767 通过。
  - **content/ 拆分大重构已落地（content/config/data 三桶）**：原 `content/` 混 4 类（核心知识库 posts/about/uploads、Agent 配置 agents/skills/memories/prompts/mcp/tasks/sources、运行时产物 approvals/cookies/files/git/logs/messages/sessions/tools/workspace、上传 uploads）。本次彻底三分：
    1. **config.ts 三分法** `AppConfig` 拆 `contentDir`+`configDir`+`dataDir`，对应 `contentPaths`{posts,about,uploads} / `configPaths`{agents,skills,mcp,memories,tasks,prompts,sources} / `dataPaths`{approvals,cookies,files,git,logs,messages,sessions,tools,workspace}。`resolveStorageRoot(name, envName)` 统一解析，支持 `KP_CONTENT_DIR`/`KP_CONFIG_DIR`/`KP_DATA_DIR` 三 env 隔离（`KP_CONTENT_DIR` 兼容旧测试）。启动 mkdir 三桶循环。
    2. **物理迁移** `git mv` 7 个配置目录到 `config/`（agents/skills/mcp/memories/prompts/tasks/sources）、9 个运行时目录到 `data/`（approvals/cookies/files/git/logs/messages/sessions/tools/workspace），`content/` 只剩 posts/about/uploads + free-keys-readme.md。空壳 `content/triggers` 删除（无代码引用）。
    3. **sync 双轨消灭** `sync/utils.ts` `getContentDir` 改读 `getAppConfig()`（先查 configPaths → contentPaths → dataPaths），不再硬编码 `content/${dirName}`，与 `KP_*_DIR` 同源。
    4. **FileSyncService** `services.ts` `getContentDir()` 改 `configPaths[contentDirName] || contentPaths[contentDirName] || configDir/contentDirName`（posts 走 contentPaths，其余走 configPaths）；错误文案去 `content/` 前缀。
    5. **散落硬编码收拢**：`cookieJar`/`platformLogin`/`larkTokenManager` cookies → `dataPaths.cookies`；`memoryDaily` → `projectRoot/config/memories/daily`；`pinnedMemory` `PINNED_MEMORY_DIR` 常量改 `config/memories/_pinned`；`session_rotate` 摘要 → `dataPaths.sessions`；`aboutProfile` → `contentPaths.about`；`agentFactory`/`skillUsage`/`skillCurator`/`skills.ts`/`swarm.ts` skills → `configPaths.skills/agents`；`cleanupSmokeArtifacts` 改读 config 三桶；`write_file` 无 Workspace 回退 `content/workspace` → `data/workspace`。
    6. **工具描述/提示词/注释**：`memory.ts` daily 路径、`feishu.ts`/`github.ts` cookies 路径、各 `sync-*.ts` 顶部注释、`agentFactory`/`skillPackage`/`skillUsage`/`mcpClient`/`skillRunner`/`memoryRepository`/`loop/setup`/`reflection` 注释统一改新路径。
    7. **测试隔离** `globalSetup.ts` + `e2e-global/setup.mjs` 拆三桶（CONTENT/CONFIG/DATA_SUBDIRS），设三个 `KP_*_DIR` env 指向 `.test-content`/`.test-config`/`.test-data`（E2E 加 `-e2e` 后缀）。`toolTestFixtures.ts` `createTestConfig` 三桶结构。`hermesSkillLoop`/`sessionRotate`/`agentFactory`/`fileSyncSlugSafety`/`fileSyncOrder`/`ftsTombstone`/`watchDeleteGuard`/`memoryDaily` 测试路径同步迁 `config/`/`data/`。
    8. **`.gitignore`/`Dockerfile`/`docker-compose.yml`/`reset-data.mjs`**：`.gitignore` content/ 段重写（content 只留 posts/about/uploads 规则 + uploads 运行时；config/ 加 smoke/curator/daily/usage 忽略；`/data/` 整体忽略；三 `.test-*` 隔离目录）。`Dockerfile` 加 `COPY config`。`docker-compose.yml` 加 `./config:/app/config:ro` 挂载。`reset-data.mjs` `RUNTIME_CONFIG_DIRS`/`RUNTIME_DATA_DIRS`/`RUNTIME_CONTENT_DIRS` 三桶清理。
  - **设计原则**：`content/`=纯知识库事实源（Git 跟踪，posts/about/uploads）、`config/`=Agent 配置事实源（Git 跟踪，运行时沉淀如 daily/_pinned/.curator_state/.usage.json 忽略）、`data/`=运行时产物（整体 .gitignore，可随时重建）。三桶由 config.ts 单点配置，sync/Service/工具全走 config，消灭双轨。server tsc 通过、单线程全量 767/767 通过、web eslint 零错误（并发 3 个既有隔离 flaky 单跑均过，非本次引入）。
- **语音输入 + 语音输出 + 视频转文字落地（浏览器原生，零 API key/零后端依赖）**：用户要「语音输入和语音输出」+「学习 metablog 视频转文字场景」。诊断：metablog `fetcher.ts` 已有 bilibili 字幕抓取（`fetchBilibiliSubtitleExcerpt` 抓字幕逐字稿 + `fetchBilibiliAiConclusion` 抓 AI 总结），但函数私有、未暴露成 Agent 工具。落地：
  1. **语音输入（STT）** `apps/web/lib/useSpeechRecognition.ts`：封装 `webkitSpeechRecognition`（Chrome/Edge 原生，免费、无需 API key；识别走浏览器内置引擎）。`onInterim`/`onFinal` 回调把转写文本追加到 ChatInput 输入框（`voiceBaseRef` 维护基线 + interim 叠加）。ChatInput 能力条加麦克风按钮（`Mic` 图标，listening 时红色脉冲，title 显示错误/状态）。`sttSupported` 为 false 时按钮不渲染（Safari/Firefox 无该 API）。
  2. **语音输出（TTS）** `apps/web/lib/useSpeechSynthesis.ts`：封装 `speechSynthesis`（浏览器原生，纯本地引擎，免费）。`speak(text)` 自动清洗 markdown（代码块→「代码块」、去除标记符号）、按 lang 选本地语音。ChatMessageList 顶层用一个 hook 实例（避免多实例冲突全局 speechSynthesis），`speakingAssistantId` 跟踪当前朗读气泡，assistant 气泡 `MessageActions` 加朗读按钮（`Volume2` 图标，朗读中脉冲 + 品牌色，点击切换朗读/停止）。
  3. **视频转文字工具 `video_transcript`** `apps/web/lib` → `apps/server/src/infra/tools/native/web.ts`：新增 native tool，给 bilibili 视频链接/BV 号，复用 metablog `fetchBilibiliPagelistCid` + `fetchBilibiliSubtitleExcerpt` + `fetchBilibiliAiConclusion`（三函数 export 化）抓字幕逐字稿 + AI 总结。入参 `url`（必填）+ `maxChars`（默认 20000，上限 50000）+ `includeSummary`（默认 true）。返回 `{ bvid, cid, transcript, summary, transcriptChars, truncated, note? }`。无字幕视频返回 note 提示走 whisper。加入 `ASSISTANT_DEFAULT_TOOLS` + 三 tier `TIER_DEFAULT_TOOLS`（super/manager/sub 全配，让所有 Agent 能「给视频链接→转文字→生成草稿/逐字稿/知识库文章」）。测试 fixture `ALL_NATIVE_TOOL_NAMES` 同步。
  - **设计原则**：语音 IO 用浏览器原生 Web Speech API（`webkitSpeechRecognition` + `speechSynthesis`），零外部依赖、零 API key、零后端改动，符合「本地优先」。`video_transcript` 复用既有 metablog bilibili 抓取能力，不重复造轮子。全量 server 测试 95/95 通过，web eslint 零错误零警告。
- **主流平台访问权限扩展（多平台浏览器登录态捕获）**：用户要「加几个主流平台的访问权限 比如 知乎的 sdk」。调研结论：各平台官方开放平台（抖音/小红书/微信/知乎/B站）均需企业认证 + OAuth + 回调 URL，对单用户本地优先项目过重且违背「本地优先」；知乎无官方公开 API，非官方 SDK（`zhihu-api`）依赖 cookie + `x-zse-96` 签名，反爬严格不稳定。最务实方案 = 浏览器登录态捕获（用户用自己的账号登录，cookie 落盘，`read_article` 复用访问需登录内容）。落地：
  1. **`CookiePlatform` 扩展** `cookieJar.ts`：从 `zhihu|wechat|xhs|douyin|yuque` 扩到 9 平台（加 `bilibili|weibo|juejin|csdn`），env cookie 名 + domain 映射同步。
  2. **泛化登录捕获** 新建 `apps/server/src/infra/metablog/auth/platformLogin.ts`：`PLATFORM_LOGIN_CONFIGS`（9 平台的 loginUrl + cookieUrls + storageStateFile + 阈值）+ `capturePlatformLoginState(platform, timeoutSec)`（弹窗登录 → 轮询 storageState 大小 → 落盘 + 同步 cookieJar）+ `listPlatformLoginStatus()`。`captureZhihuLoginState` 改为委托 `capturePlatformLoginState("zhihu")`（向后兼容）。
  3. **新工具 `platform_login`** `integration/github.ts`：入参 `platform`（9 选 1）+ `timeoutSec`，弹浏览器让用户手动登录，登录态落盘供 `read_article` 复用。`browser_login_status` 增强：返回 `details`（各平台 storageState 状态）+ `cookieJars`（cookie 条数）。加入 `ASSISTANT_DEFAULT_TOOLS` + 测试 fixture。（后续按「禁止兼容层」铁律删除了旧 `capture_zhihu_login` 工具及其兼容委托层 `zhihuLogin.ts`，统一用 `platform_login`；DB 内 assistant agent 的 tools 字段残留引用由一次性脚本清理。）
  4. **系统提示词引导** `agentResolver.ts`：明示「用户要访问知乎/微信/小红书/抖音/B站/微博/掘金/CSDN/语雀的需登录内容时用 `platform_login` 弹浏览器登录，`read_article` 自动复用 cookie」。
  - **设计原则**：不引入官方开放平台 SDK（企业认证过重）+ 不依赖非官方签名 SDK（不稳定）。浏览器登录态捕获 = 用户用自己的账号登录，cookie 落盘本地，`read_article` 抓取时复用，访问收藏夹/付费/私密内容。符合「本地优先、单用户、用自己的账号」。server tsc 通过、nativeTools 95/95 通过。
- **video_transcript 扩展 YouTube + 外部 Agent 平台接入（Coze/Dify）**：用户要「把 video_transcript 扩展到 YouTube，云端 api 为主 本地轻量，找现成方案复用」+「国内外平台提供了 agent 方便的，多找找」。调研：YouTube 字幕有现成纯 HTTP 库（`youtube-transcript-api-js` 4.0.0，2026-07 发布，零 API key、零浏览器，调 YouTube 内部 timedtext 端点，符合「轻量」）；外部 Agent 平台 Coze（扣子）+ Dify 提供 REST API（Bearer token，chat/workflow 端点），可让 KnowPilot Agent 委托子任务给平台已编排好的 bot/workflow（RAG/知识库/复杂多步逻辑）。落地：
  1. **YouTube 字幕抓取** `web.ts`：新增 `extractYouTubeId`（解析 watch/youtu.be/shorts/embed/live 链接或纯 11 位 videoId）+ `fetchYouTubeTranscript`（`new YouTubeTranscriptApi().fetch(videoId, ['zh-Hans','zh','en'])`，无指定语言时回退 `list().getAllTranscripts()[0]`，拿 snippets 拼纯文本 + metadata 取 title/author）。`videoTranscriptTool` 加 YouTube 分支：检测到 YouTube ID 走云端字幕抓取，否则走 bilibili。返回加 `platform` 字段（`youtube`/`bilibili`）。工具描述更新支持 bilibili + YouTube。装 `youtube-transcript-api-js` 依赖。
  2. **外部 Agent 平台接入** 新建 `integration/agentPlatform.ts`：4 个 native tool——`coze_chat`（Coze v3 chat 异步发起 → 轮询 message/list → 取 assistant answer + followUpQuestions）、`coze_workflow`（Coze workflow run blocking）、`dify_chat`（Dify chat-messages blocking 返回 answer）、`dify_workflow`（Dify workflows/run blocking 返回 outputs）。凭据走 `credentialVault`（scope=coze name=access_token / scope=dify name=api_key），回退 env（`COZE_ACCESS_TOKEN`/`DIFY_API_KEY`）。区域可配（`COZE_API_HOST` 默认 `https://api.coze.cn`，国际站设 `https://api.coze.com`；`DIFY_API_BASE` 默认 `https://api.dify.ai/v1`，自托管设自己域名）。聚合到 `integration.ts` `INTEGRATION_DEFS`/`INTEGRATION_HANDLERS`。测试 fixture `ALL_NATIVE_TOOL_NAMES` 同步加 4 个工具名。
  - **设计原则**：YouTube 用纯 HTTP 库复用 YouTube 自带字幕（零 API key、零浏览器、零本地模型，符合「云端为主、本地轻量」）；Coze/Dify 用官方 REST API blocking 模式（简单可靠，streaming 留后续），让 KnowPilot Agent 能把 RAG/知识库/复杂工作流委托给专业平台，不重复造轮子。server tsc 通过、nativeTools 95/95 通过、trpcSmoke 4/4 通过。
- **国内社交媒体平台接入（TikHub API）**：用户要「微信 知乎 小红书 抖音 等国内平台为主」。调研结论：官方开放平台（微信/知乎/小红书/抖音）均需企业认证 + OAuth + 回调，不开放内容读取 API（只开放小程序/商家业务 API），对单用户本地优先项目过重；非官方签名 SDK（zhihu-api 等）依赖 cookie + x-zse-96 签名，反爬严格不稳定。最务实方案 = TikHub API（第三方社交媒体数据基础设施，一个 key 覆盖 16 平台 1000+ 端点：小红书/抖音/B站/微博/微信公众号/知乎/快手/TikTok/YouTube/Twitter 等，纯 REST + Bearer token，无需登录账号/浏览器/企业认证，~$0.001/请求，注册送 ~50 次免费）。与既有 `platform_login`（浏览器登录态读私密内容）互补：TikHub 补充「搜索 + 公开内容结构化读取」。落地：
  1. **新建 `integration/tikhub.ts`**：1 个 native tool `tikhub_request`——通用端点转发，Agent 传 `endpoint`（如 `xiaohongshu/app_v2/get_note_info`）+ `params`（查询参数对象）+ 可选 `method`，自动补 `/api/v1/` 前缀，Bearer token 转发，覆盖全部 1000+ 端点。描述内嵌各平台常用端点示例（小红书 search_note/get_note_info/get_user_notes/get_note_comments、抖音 fetch_one_video/search_general、B站 search/view、微博 search、知乎 search、微信公众号 articles）。凭据走 `credentialVault`（scope=tikhub name=api_key），回退 env `TIKHUB_API_KEY`；Base URL 可用 `TIKHUB_API_BASE` 覆盖。聚合到 `integration.ts`，测试 fixture `ALL_NATIVE_TOOL_NAMES` 同步加 `tikhub_request`。
  - **设计原则**：不做高层 social_search 封装（各平台 search 端点参数名/结果结构差异大、端点易变，封装不稳且维护成本高）；通用 `tikhub_request` 最灵活、最稳、覆盖全部端点，Agent 查 TikHub 文档拿准确端点路径。不引入官方开放平台 SDK（企业认证过重）+ 不依赖非官方签名 SDK（不稳定）。TikHub 纯 HTTP、本地零依赖，符合「云端为主、本地轻量」。server tsc 通过、nativeTools 95/95 通过。
- **platform_login 登录态捕获可靠性根治**：用户反馈「Agent 说登录后自动保存 cookie 但实际上并没有」。诊断 `capturePlatformLoginState` 三个 bug：① 登录成功判定靠 storageState 文件大小（5KB/10KB 阈值）——未登录的知乎首页 localStorage 也可能超阈值，误判「已登录」但 cookie 无登录态；② 超时后无条件 `context.storageState({path})` 落盘 + `saveCookies`——用户登录慢超时，保存的是未登录态；③ `saveCookies` 覆盖旧 cookie——新捕获的无效 cookie 覆盖旧的有效登录态。根治：
  1. **`PlatformLoginConfig` 加 `loginCookieNames: string[]`**：每平台定义登录态核心 cookie 名（zhihu `z_c0`/`d_c0`、wechat `slave_sid`、xhs `web_session`、douyin `sessionid_ss`/`sid_guard`、bilibili `SESSDATA`、weibo `SUB`、juejin `sessionid_ss`、csdn `UserName`/`UserToken`、yuque `_yuque_session`）。
  2. **轮询改检查 cookie 名**：每 3s `context.cookies(cookieUrls)` 找是否含任一 `loginCookieNames` 且值非空——比文件大小可靠，未登录首页 localStorage 再大也不会误判。
  3. **超时未登录不落盘、不 saveCookies**：保留旧的有效登录态，返回 `success:false`「未检测到登录态 cookie，未保存（保留旧登录态）」，让用户重试或加 timeoutSec。
  4. **登录成功才落盘**：命中登录态 cookie 时才 `storageState` + `saveCookies`，message 报告命中的 cookie 名 + storageState 大小 + cookieJar 条数。
  - **设计原则**：登录态判定必须基于平台特定登录 cookie 名（语义可靠），不能靠文件大小（localStorage 噪声）；未登录时禁止落盘覆盖旧态（宁可不保存也不保存无效态）。server tsc 通过、nativeTools 95/95 + platformFetch 38/38 通过。
- **super/manager tier 工具清单补齐 platform_login（根因：超级 Agent 拿不到登录工具）**：用户反馈超级 Agent 在「重新登录知乎」任务里 thinking 说「无法直接调用 native:platform_login 作为标准工具」，绕路让用户手动操作。诊断：`platform_login`/`browser_login_status` 只在 `ASSISTANT_DEFAULT_TOOLS`（内置 assistant）里，**`TIER_DEFAULT_TOOLS.super` 和 `TIER_DEFAULT_TOOLS.manager` 都没有**——超级 Agent / 管理 Agent 的工具清单不含登录工具，所以 Agent 拿不到。修复：
  1. **`constants.ts` `TIER_DEFAULT_TOOLS.super` 加 `native:platform_login` + `native:browser_login_status`**（`...INTEGRATION_DEFAULT_TOOLS` 前）；`TIER_DEFAULT_TOOLS.manager` 同样加（`send_email` 后）。sub tier 不加（子 Agent 不该弹浏览器登录）。
  2. **一次性脚本 `scripts/fix-super-agent-tools.ts`**：现有 super/manager Agent 的 `tools` 字段是创建时固化的旧清单（resolveAgent 只读化 W9 不自动补齐），脚本读 DB 给现有 Agent 的 tools 字段补齐 `native:platform_login` + `native:browser_login_status`（去重），跑后即删。执行结果：assistant (manager) 补齐 platform_login；超级 Agent 已含（跳过）。
  3. **兜底模板生效**：`agentFactory.ts` `FALLBACK_TEMPLATES` 用 `TIER_DEFAULT_TOOLS.super/manager`（常量已含 platform_login），模板文件缺失时兜底自动含登录工具。
  - **设计原则**：新增工具加到 `TIER_DEFAULT_TOOLS` 常量后，新创建的 tier Agent 自动获得；已存在的 Agent 需一次性脚本补齐 tools 字段（resolveAgent 只读化不自动改）。server tsc 通过、nativeTools 95/95 通过。
- **子 Agent 创建后左侧 panel 不自动更新（根因：invalidate 只覆盖 spawn_subagent）**：用户反馈「子 agent 创建时左侧 panel 数量没自动更新，得刷新才看到，强调多少次了还在犯」。诊断 `apps/web/lib/useChatRunStream.ts` `onToolEnd`：L390 `if (name === "spawn_subagent" ...)` 才 `utils.agent.list.invalidate()`——**只 `spawn_subagent` 工具触发 invalidate**，`agent_create`/`agent_create_sub`/`agent_update`/`agent_delete`/`workspace_create`/`workspace_archive` 这些同样改变 agent/workspace 列表的工具**都不刷新左侧 panel**。超级 Agent 用 `agent_create` 建子 Agent 时，前端 cache 不失效，必须手动刷新。修复：`onToolEnd` 末尾加 `AGENT_LIST_MUTATING_TOOLS` 集合判断，对上述 8 个工具统一 `agent.list.invalidate().then(refetch)` + `session.list.invalidate().then(refetch)`（spawn_subagent 已在上面处理不重复）。设计原则：**任何改变左侧 panel 数据源的工具都必须 invalidate 对应 query**，不能只覆盖单一工具。server tsc 通过、platformFetch 38/38 通过。
- **登录态「一塌糊涂」根因：read_article 抓取只用 cookieJar 不用 storageState（学 MetaBlog）**：用户反馈「登录态一塌糊涂」，参考 `D:\ALL IN AI\MetaBlog`。对比 MetaBlog `server/services/zhihuCollection.ts` L161 `launchZhihuBrowser({ storageState: fs.existsSync(AUTH_PATH) ? AUTH_PATH : undefined })`——**MetaBlog 抓取用 Playwright + storageState（完整浏览器态：cookies + localStorage + sessionStorage）**。而 KnowPilot `apps/server/src/infra/metablog/platform/fetcher.ts` 的 ZhihuFetcher/DouyinFetcher/XhsFetcher/WechatFetcher 虽然也用 Playwright，但**只 `context.addCookies(loadCookies(...))`（HTTP cookie），没用 storageState**——localStorage/sessionStorage 丢失，知乎/小红书/抖音这种强反爬平台（依赖 x-zse-96 等签名 + 浏览器态指纹）光靠 HTTP cookie 抓不到登录后内容。修复：
  1. **`platformLogin.ts` export `getPlatformStorageStatePath(platform): string | null`**：返回 `data/cookies/{platform}_storage_state.json` 路径，文件不存在返回 null（调用方回退 addCookies）。
  2. **fetcher.ts 四个平台 fetcher 优先用 storageState**：`browser.newContext({ ..., ...(storageStatePath ? { storageState: storageStatePath } : {}) })`，有 storageState 时跳过 `addCookies`（storageState 已含 cookies），无 storageState 回退 `addCookies(cookies)` 保持兼容。
  - **设计原则**：强反爬平台抓取必须复用完整浏览器态（storageState），不能只注入 HTTP cookie（丢失 localStorage/签名上下文）；storageState 优先、cookieJar 回退，保证旧登录态不丢。server tsc 通过、platformFetch 38/38 通过。
- **platform_login「窗口一开就关、显示已登录」（根因：loginCookieNames 混入设备 cookie）**：用户反馈「打开浏览器还没登录窗口就关了，然后显示已登录，纯扯淡」。诊断 `capturePlatformLoginState` 轮询逻辑：L175 `pwCookies.find(c => cfg.loginCookieNames.includes(c.name) && c.value)` 命中即判定登录成功 → 立刻 `storageState` 落盘 + `browser.close()` 关窗。bug 在 `PLATFORM_LOGIN_CONFIGS` 的 `loginCookieNames` 混入了**未登录就存在的设备 cookie**：① 知乎 `d_c0` 是设备追踪 cookie（未登录首页就有，真正的登录态是 `z_c0`）；② 小红书 `xhsappid` 是设备 id（未登录就有，真正登录态是 `web_session`）；③ csdn `uuid` 是设备 id（未登录就有，真正登录态是 `UserName`/`UserToken`）。结果：浏览器一打开平台页，3s 后首次轮询就检测到设备 cookie 命中 → 误判「已登录」→ 立刻关窗 + 落盘无效态。修复：`loginCookieNames` 只保留**登录后才出现的认证 cookie**——zhihu `["z_c0"]`、xhs `["web_session"]`、csdn `["UserName","UserToken"]`（移除 `d_c0`/`xhsappid`/`uuid` 三个设备 cookie）。其他平台（wechat/douyin/bilibili/weibo/juejin/yuque）的 loginCookieNames 已是纯登录态 cookie，无需改。
  - **设计原则**：`loginCookieNames` 必须是「登录后才出现」的认证 cookie，绝不能含设备追踪 cookie（`d_c0`/`xhsappid`/`uuid` 这类未登录就有的）——否则首次轮询就误判、关窗、落盘无效态，用户体验「窗口一开就关、显示已登录」。server tsc 通过、platformFetch 38/38 通过。
- **超级 Agent 绕过 platform_login 用 browser_screenshot（根因：systemPrompt 固化无 platform_login 指引）**：用户截图反馈超级 Agent 读知乎收藏夹时用 `browser_screenshot`+`vision_describe` 而非 `platform_login`，vision_describe 因 Gemini key 无效失败卡死。诊断：`DEFAULT_ASSISTANT_SYSTEM_PROMPT`（agentResolver.ts）已含 platform_login 铁律，但**超级 Agent（super tier）的 systemPrompt 是 `config/agents/_templates/super.md` 创建时固化的旧版本，完全不含 platform_login 指引**；tool-guide 钩子虽注入 `WEB_TOOL_GUIDE`，但措辞是「若被登录墙拦截」（被动），Agent 主动读收藏夹时没意识到会撞登录墙，且 LLM 更听从 systemPrompt（身份核心）。修复四处：
  1. **`super.md` 模板加「平台登录态（铁律）」段落**：明确 platform_login 是唯一入口、禁止 browser_screenshot/read_image/vision_describe 截图检查、禁止手动 F12 复制 cookie、检查登录态用 browser_login_status、访问需登录内容前先确认登录态。
  2. **`manager.md` 模板同样加该段落**（管理 Agent 也需）。
  3. **一次性脚本 `scripts/fix-super-agent-prompt.ts`**：给现有 super/manager Agent 的 systemPrompt 追加该段落（检测不含 `platform_login` 才追加，已含则跳过），执行结果：assistant (manager) + KnowPilot 超级 Agent (super) 各追加一次。
  4. **`promptBuilder.ts` `WEB_TOOL_GUIDE` 措辞从被动改主动**：「若被登录墙拦截」→「**访问需登录内容前，若不确定登录态，先 browser_login_status 确认，未登录则 platform_login**」，并加「即使用户只说看看登录状态，也优先 browser_login_status 而非截图」。fixture 同步更新 4 处。
  - **设计原则**：工具使用铁律必须写进 Agent 的 systemPrompt（身份核心，LLM 最听从），不能只靠 tool-guide 钩子的被动措辞；措辞要从「若被拦截」改为「访问前先确认」（主动前置）；模板更新 + 一次性脚本补齐现有 Agent + 钩子措辞强化三管齐下。server tsc 通过、contextHooks 11/11 通过。
- **超级 Agent 读文章被知乎反爬拦截（根因：TIER_DEFAULT_TOOLS.super 缺 read_article/scrape_web_page）**：dump 最近 session 发现超级 Agent 读知乎专栏 `zhuanlan.zhihu.com/p/...` 时调用链是 `read_article`→`scrape_web_page`→`browser_screenshot`→`read_image`→`vision_describe`，OCR 显示知乎返回「您当前请求存在异常，暂时限制本次访问」拦截页。诊断 `packages/shared/src/constants.ts` `TIER_DEFAULT_TOOLS.super`（L438）和 `config/agents/_templates/super.md` 模板**都没有 `native:read_article` 和 `native:scrape_web_page`**——超级 Agent 拿不到正文抓取工具，只能退回 browser_screenshot 截图（被反爬拦截 + 模型无 vision 卡死）。修复：
  1. **`constants.ts` `TIER_DEFAULT_TOOLS.super` 和 `.manager` 在 `web_search` 后加 `native:read_article` + `native:scrape_web_page`**（编排者也要能亲自读文章，不能只靠截图）。
  2. **`super.md` 和 `manager.md` 模板同步加这两个工具**。
  3. **一次性脚本 `scripts/fix-super-agent-read-article.ts`** 给现有 super/manager Agent 的 tools 字段补齐（已执行：2/2 补齐）。
  - **设计原则**：编排 tier Agent 也需要核心执行工具（read_article/scrape_web_page），否则遇登录墙/反爬时只能退回截图绕路；工具清单变更必须模板 + 常量 + 现有 DB 三处同步。server tsc 通过、nativeTools 95/95 通过。
- **read_article offset 参数无效（根因：工具根本没 offset 参数）**：用户反馈「只能读一半，offset=4000 没用」。诊断 `apps/server/src/infra/tools/native/web.ts` read_article 工具 schema（L1012）**只有 maxChars（从头截断），没有 offset 参数**——用户传 offset=4000 被忽略，每次都从第 0 字符开始读，长文永远只能读前 maxChars 一段。修复：
  1. **schema 加 `offset` 参数**：描述「正文起始字符偏移（默认 0），配合 maxChars 翻页：第一次 offset=0，第二次 offset=上次返回的 offset+contentChars」。
  2. **实现 `fullContent.slice(offset)` 后再 maxChars 截断**：返回 `content`（offset 后的内容，再截 maxChars）、`contentChars`（本段长度）、`totalChars`（全文长度）、`offset`（当前偏移）、`nextOffset`（下一段起始，truncated 或未到末尾时给出）。
  3. **工具描述加翻页指引**：「长文分段读：第一次 offset=0，根据返回的 nextOffset 继续读下一段（contentTruncated=true 或 nextOffset 存在时翻页）」。
  - **设计原则**：长文抓取工具必须支持分段（offset + nextOffset），不能只从头截断——否则 LLM 永远只能读前半段，后半段拿不到。server tsc 通过、platformFetch 38/38 通过。
- **read_article 返回 4000 字符就截断（根因：reactLoop 整体 JSON.stringify 截断砍掉 content 字段）**：用户反馈「这么粗暴 4000 字符截断」。dump 最新 session 发现 Agent 读知乎专栏时第一次 read_article 返回 contentChars 后用 offset=4000 翻页，说明第一次只拿到 ~4000 字符。诊断 `apps/server/src/infra/loop/reactLoop.ts` L230-234：工具结果进 LLM 时 `JSON.stringify(item.result)` 整体截断到 `AGENT_TOOL_RESULT_MAX_CHARS=16000`。read_article 返回对象含 `title/author/platform/url/method/content/contentChars/images/videos/metadata` 等字段，`content` 字段本身可能 12000 字符，但整个 JSON stringify 后超 16000，被 `slice(0,16000)` 砍掉，`content` 字段在 JSON 中间被截断只剩 ~4000 字符（前面 title/author/metadata 等占用了 12000 字符）。L228 注释说「优先截断 content 字段」但实现没做。修复：
  1. **新增 `truncateToolResultContent(result, maxChars)` helper**：工具结果超 maxChars 时，找 result 的长文本字段（content/text/transcript/excerpt/html/markdown），计算其他字段 JSON 长度后，给目标字段留 `maxChars - overhead - 200` 预算，截断该字段并加 `[content TRUNCATED, original=N, kept=M]` 标记，保留其他元信息字段完整。
  2. **L230-234 改用 helper**：优先智能截断 content 字段；无长文本字段时回退整体 slice（原行为）。
  - **设计原则**：工具结果截断必须优先砍长文本字段（content/text），保留元信息字段完整，不能整体 JSON.stringify 后 slice——否则 content 在 JSON 中间被砍，LLM 只看到残缺正文且不知元信息。注释与实现必须一致。server tsc 通过、runLifecycle 5/5 + agentRunPhase 9/9 通过。
- **新增 scroll_screenshot + save_webpage 两个工具**：用户反馈 read_article 截断、长文分段麻烦、SPA 懒加载截图空白。新增两个工具解决：
  1. **`scroll_screenshot`**（concurrencyClass B）：分段滚动截图，解决 SPA 懒加载/长页 fullPage 截图空白。每次滚动一个视口高度，等待加载后截一张视口图，返回多张截图路径（按滚动顺序）。参数：url、scrollSteps（1~20，默认 5）、scrollDelay（200~5000ms，默认 800，懒加载页调大）、width/height（视口，height 也是滚动步长，默认 800）。自动检测到底（`innerHeight+scrollY >= scrollHeight-10`）提前停止。落盘 `content/uploads/screenshots/`，返回 `screenshots[]`（path/publicUrl/step）+ suggestedTool=read_image。
  2. **`save_webpage`**（concurrencyClass A）：把网页完整正文保存到本地 `data/webpages/`（HTML 和/或 Markdown），再用 read_file 读取。解决 read_article 截断、长文分段麻烦——存本地后可反复读、离线读、用 read_file offset 分段读长文。复用 read_article 抓取链路（含登录态复用）。参数：url、format（html|markdown|both，默认 both）、method（playwright 强制渲染）。返回 htmlPath/markdownPath/contentChars + suggestedTool=read_file。
  - **设计原则**：长文/复杂页场景需多管齐下——read_article（分段 offset）适合纯文字、save_webpage（存本地反复读）适合超长文/离线、scroll_screenshot（滚动截图）适合懒加载/需看清布局的 SPA。三者互补，LLM 按场景选。server tsc 通过、nativeTools 95/95 通过。
