# KnowPilot — AI 开发指南

> 本文件面向 AI 编码助手。阅读本文档前，默认你对本项目一无所知。请优先以本文件、README.md、MIGRATION_PLAN.md、docs/development/ 的顺序了解项目背景与规范。

---

## 项目概述

KnowPilot 是一个**单用户、本地优先**的智能知识管理与博客平台，定位为「以 Markdown 为原子、AI 为引擎的数字花园」。

- **核心原则**：本地 Markdown 文件是数据的唯一事实源，SQLite（通过 Prisma）只作为查询与缓存层。
- **当前阶段**：**L1–L5 已全部落地**。本地 Markdown 为源、19 实体 CRUD + 管理页、Agent SSE Chat、自动化/审批、FTS 搜索、可选鉴权、Docker/CI 均已就绪。

项目完整路径：`D:\ALL IN AI\KnowPilot`

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
| 全局状态 | Zustand 5.0.3（当前未实际使用） |
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
│   │   │   ├── schema.prisma   # 19 个实体模型
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
├── content/                    # Git 跟踪的文本数据源
│   ├── posts/                  # 文章 Markdown 源文件（已大量使用）
│   ├── about/                  # About Me（profile.md，Web /about 读取）
│   ├── agents/                 # Agent 配置（Markdown，运行时 CRUD 写回）
│   ├── skills/                 # Skill 配置（Markdown）
│   ├── memories/               # Memory 配置（Markdown）
│   ├── prompts/                # Prompt 模板（Markdown）
│   ├── tasks/                  # Task 配置（JSON + db:sync）
│   ├── mcp/                    # MCP Server 配置（YAML）
│   └── uploads/                # 上传文件（file.upload）
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
- **Git 提交前缀**：`feat:`、`fix:`、`docs:`、`docs(dev-log):`、`refactor:`、`test:` 等。
- **长路径支持**：仓库已开启 `core.longpaths=true` 以支持深层中文 Markdown 路径。
- **空目录占位**：使用 `.gitkeep` 保留占位目录（如 `content/agents/`、`content/skills/`）。

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

1. 文章源文件位于 `content/posts/{slug}.md`。
2. Frontmatter 规范字段：
   ```yaml
   ---
   title: "文章标题"
   category: "分类"
   tags: ["标签1", "标签2"]
   published: true
   excerpt: "一句话文章简要介绍。"
   ---
   ```
3. `pnpm db:sync` 扫描 `content/posts/`、`content/agents/` 等已注册目录，解析后 upsert 到对应表；删除本地已不存在但数据库仍有的记录。
4. Post / Agent / Skill / MCP / Memory / Prompt 的 `create` / `update` / `delete` 会同步写回 `content/` 对应文件。
5. 自动保存：`useAutoSave.ts` 500ms 节流写入 LocalStorage，2s 防抖调用 `post.update`（仅对已存在 id）。

### 项目扁平化与代码收拢约定

为了杜绝项目文件夹过深、同名文件繁多引发维护崩溃，以及防止功能重复定义，项目必须严格遵循**“单文件逻辑收拢”**原则：
1. **后端业务层合并**：禁止创建 `services/` 子目录及零散服务文件。所有 19 个实体的 Service 业务逻辑统一写在 `apps/server/src/services.ts` 中。
2. **后端路由层合并**：禁止创建 `trpc/routers/` 子目录及零散路由文件。所有 API 路由统一声明在 `apps/server/src/router.ts` 中。
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
| `trpc.test.ts` | 19 实体 CRUD（含 InfoSource）、db:sync、Agent chat、GitRepo 沙箱、git.commit/pull 审批 |
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
- 运行中的 Agent 任务执行体仍随服务端进程重启而丢失；v10 起 `reentrant=true` 的可重入任务由启动恢复按 at-least-once 语义自动续跑（`retryCount`/`maxRetries` 账本持久化，超限标 failed 交人工），不可重入任务标 failed 留人工 `retryAsyncJob`，paused 会话由用户手动恢复（`chatSession.resume`）。

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
| 开发踩坑与教训（战地笔记） | `docs/development/开发心路历程.md` |
| 未来功能规划 | `docs/development/future-features.md` |
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
3. **回答约定**：
   - 用户**不写回答** = **默认同意**推荐方案
   - 用户**写了回答** = AI 需阅读并据此调整，如有疑问再追加问题
4. **AI 读取回复后**：确认的决策移入「已确认 ✅」表格，新问题继续追加到文件末尾

---

## 当前状态与近期变更（2026-07-16）

- **v10 可重入与续跑已落地（C-1~C-4）**：① C-1（`e624e08a`）可重入性基座——Task 表三列：`retryCount`（自动重跑计数，crash-loop 闸）、`maxRetries`（自动重跑上限，入队物化 = `config.asyncJobs.maxRetries`）、`reentrant`（入队按工具声明推断物化，存量 false 保守）；声明链单点 `NativeToolDefinition.reentrant` → `registerDomain` 透传 → `ToolCommand.reentrant`（与 `destructive` 同处），34 个只读/幂等工具标 true（fs 读类 4 / web 只读 3 / async_task_status·wait / memory_search / swarm 只读 3 / integration 只读 21），保守 false：rss_fetch、invoke_api、feishu 读类（token 刷新写库）、free_api_keys_fetch、sleep、skill:*·mcp:*；`inferTaskReentrant` tool 任务按其工具、llm 任务按 `agentSnapshot.tools` 取最严（无工具 = true 纯 LLM）；`input.retryCount` 内存字段删除（列 = 唯一事实源）；首建 migrations（0_init baseline + task_reentrancy）。② C-2（`580b5e56`）僵尸任务自动续跑——`recoverStaleAsyncJobs` 同函数内两态分叉（`runStartupRecovery` 动作 1 唯一收拢点）：`reentrant=true && retryCount<maxRetries` → `retryCount+1` 先落库再重建执行体入 v8 池（crash-loop 防护即账本），否则 failed 两态文案「服务重启，任务中断」/「已达自动重试上限（N 次），需人工介入」；入池被拒维持 queued 下轮再试；恢复风暴背压全交 v8 池（Q4 不新造限流层）；手动 `retryAsyncJob` 清零重来不受限（人工最后一道闸）。③ C-3（`81a7e481`，server 侧）会话手动恢复闭环——`chatSession.resume` 条件写 `paused→running` 唯一互斥锁（并发 double-resume 只一生效；已 running 幂等返回；archived/failed 等 BAD_REQUEST），获权后注入 source:system 消息「（服务已重启，请继续完成未完成的任务）」经 `hub.startIfNotRunning` 交互式起流（v8 Q2 口径：不入池计全局占用），起流抛错回滚 paused，终态归位挂 runner 内（done→active/completed、error/abort→paused 可再恢复）；web 恢复按钮 + e2e 由并行工单落地（commit 后补）。④ C-4 文档：决策记录见 `design-decisions.md` 文末「可重入与续跑 Q1~Q4」（含 Q3 不做会话自动恢复的完整理由）；并发不变量见 `concurrency.md`「可重入与续跑」节（§8，含与 v8 池 / v9 reconciler 职责边界）；语义全景 `async-tools-semantics.md`。测试 `__tests__/reentrancyModel.test.ts` + `reentrantResume.test.ts`（T1~T5）+ `sessionResume.test.ts`（T6~T8），均过变异验证。
- **v9 投递可靠性已落地（R-1/R-2/R-3/R-4）**：① R-1（`5a410784`）S3「认领了但气泡没进会话」两层根治——同链即时回滚（CLAIM 后 `startIfNotRunning` 返回 false = 确定未写消息，事务回滚 `delivered=false` + W14 账本回滚 + 重挂消费链队尾；宁漏勿错：started=true 后抛错等无法判定路径不回滚，交第二层）+ 对账者 reconciler（收进 `asyncJobManager.ts`，启动即扫+周期扫，周期复用 `stream.cleanupIntervalMs` 无新增 config 面；扫 `delivered=true` 终态、超龄 60s、未 pinned、`deliverToQueue≠false` 且 ChatMessage 无 `toolResults.subagentResult.jobId=X` 的孤儿 → 条件写回滚（与前端 ack `markAsyncDeliveryConsumed` 条件互斥）→ `notifyAsyncDelivery` 重走正常管道补投，每轮上限 50；ChatMessage 为唯一 ground truth，全动作幂等）。② R-2（`899978d3`）`runStartupRecovery` 启动首扫四动作（index.ts 启动序列挂载，shutdown 停 reconciler）：僵尸 running/queued Task→failed（「服务重启，任务中断」，**不自动重跑**——tool 任务有副作用、进度未知，盲目重跑可能重复执行；`retryAsyncJob` 保留手动重试）、僵尸 running ChatSession→paused、superior 孤儿 SessionQueueItem 重注册 drain（v7 W-E 机制）、delivered=false 终态重新 notify（与 R-1 reconciler 同一幂等入口 `reconcileAsyncDeliveries`）；AgentMessage pending 超龄走 W14 既有 stale 对账，未新造逻辑。③ R-3 历史闭环四项：v6 自审补跑（`review-final-w16.md` 结论通过，揪出 agentDrift 假绿已修 `7da7c20f`）、stash@{0} 逐 hunk 对照后 drop、`PLAN_STATUS.json` 零消费者删除、2 个假绿测试修复（`56bb100e`）。④ R-4 文档：决策记录见 `design-decisions.md` 文末「投递可靠性 Q1~Q3」；并发不变量见 `concurrency.md`「投递可靠性」节。测试 `__tests__/deliveryReliability.test.ts` + `startupRecovery.test.ts`。
- **v8 全局任务池已落地（TP-1/TP-2）**：`infra/asyncJobOrchestrator.ts` 成为后台任务并发容量的单一事实源——容量/互斥不变量（maxGlobal、maxPerSession、maxPerWorkspace、maxQueued、taskTimeoutMs、queuedTimeoutMs）收在执行层；`spawn_subagent(waitForResult=false)` 等后台执行统一走池容量准入（queued 期间跟踪 Task / 子会话状态落 queued），准入判定链 global→session→workspace，queued 记录 reason+position，右栏三组状态（进行中/待消费/已消费）的「进行中」组展示「第 N 位 · 因 X 上限排队」。配置在 `config.yaml` `asyncJobs` 节（maxConcurrent=2、maxPerWorkspace=0、maxQueued=100 等）。四条设计决策——Q1 全局单池（LLM 成本是全局的，会话间公平靠调度而非分池）、Q2 交互式运行不入池但计入全局占用（hub 即时起流零排队 + `onHubRunSettled` 活性钩子）、Q3 消费续跑与执行正交（`runConsumeJob` 高优通道：队首优先 + 全局占用约束，CLAIM 移到获槽后）、Q4 `waitForResult=true` 血缘槽位继承防死锁（inline 不占新槽，同一血缘同时只有一个执行体占槽）——见 `design-decisions.md` 文末「全局任务池 Q1~Q4」；并发防护细节见 `concurrency.md`「全局任务池」节。测试 `__tests__/globalTaskPool.test.ts`。
- **v7 异步工具体系收敛已落地（W-0/W-A/W-E/W-F）**：① 双工具分工——`spawn_subagent` 专职带 LLM 子任务，`async_task_run` 收窄纯工具（删 `mode` 参数、`toolCall` 必填；`buildAsyncExecute` llm 分支保留给前端「派生子代理」按钮）；② **`async_task_wait` 工具删除**（注册表/权限清单/UI 全清 + 负向断言）；③ `async_task_status` 去全文（只回状态元信息，结果全文唯一通道 = `Task.delivered` 原子 claim；问题 G 的 A1/A2 撞车面机制性消除，`async-result-dedup-proposal.md` 标「已落地（变体）」）；④ 右栏状态页两级分组「异步队列/同步任务」（W-A：`pullAsyncDeliveries`/`pullConsumedAsyncDeliveries` 过滤 `deliverToQueue=false` + 新增 `listSyncAsyncJobs` + `pullAsyncQueue.syncTasks`）；⑤ W-E running 子 Agent 消息服务端持久队列 + 空闲自动 drain（见下条）；⑥ W-F 存量清理——dev.db 历史 `sourceType="async_task_llm"` Task 行物理删除（执行 0 行命中）+ 全仓残留清扫。「启动后改主意要结果」新姿势 = `agent_send_message` 经服务端队列催子提前 `report_back`。决策记录见 `design-decisions.md` 文末 v7 节。
- **W-E running 子 Agent 消息服务端持久队列 + 空闲自动 drain 已落地**：`triggerAgentRun` 重构为 `prepareAgentRun`（返回 started/queued/failed 三态），busy 判定前移到写 ChatMessage 之前——子会话 running（或 idle 但队列有残留）时消息走 `bus.send`（depth/queue-size 守卫，旧 autoRun 路绕过的守卫此路径补上）写 AgentMessage pending + `sessionQueueItem.create` superior 幂等镜像，**不写 ChatMessage**；新增 `enqueueSuperiorQueueDrain`（asyncJobManager，复用 per-session 串行链，waitFor 空闲 → consume 原子认领 → 重入 `prepareAgentRun(fromDrain)` 起流 → 下一项，FIFO）。`SessionQueueItemService.consume` 改软认领（`{success, claimed}`，不存在/并发落选返回 `claimed:false` 不抛错，deleteMany 删除即认领），前端 `useChatQueueDrain` superior 项 `claimed:false` 静默跳过不起流（防双跑）。`agentRunLocks` 收窄为只覆盖 prepare 段。`waitForRun=true` + busy：等该 item 的 drain 链完成后读最后 assistant 返回。spawn_subagent 派活首轮（新会话必闲）与 `agent_report_back` 路径不变。测试 `__tests__/superiorQueueDrain.test.ts`（T7 等 4 例负向断言，旧实现即红）。
- **W16d stream 反思接入 / 心跳熔断持久化 / drift 横幅已落地**：W16d-1 stream 链路接入 `withReflection`（agentStream，与 agentRuntime sync 链路对齐，`config.yaml` `reflection.enabled` 默认 false、开启全覆盖；`__tests__/reflection.test.ts`）。W16d-2 心跳熔断 suspended 从引擎内存态持久化到 `Agent.heartbeatSuspendedAt`（schema +1 列），恢复按个体 Agent（不再随 `refresh()` 全体复活）；`circuitBreaker.test.ts` 扩充。W16d-3 drift 可发现性：默认 assistant 配置漂移不再只有 server `console.warn`——新增只读 `agent.driftStatus` tRPC 通道（`agentResolver.getAssistantDriftStatus`，不创建不修改，assistant 不存在返回 `agentId=null` 绝不引导创建），`/agents` 页顶部 `assistantDriftBanner.tsx` 横幅（drift 为空渲染 null，附一次性迁移脚本提示）；测试 `agentDrift.test.ts` + `assistantDriftBanner.test.tsx`。决策记录见 `design-decisions.md` 末尾。
- **W16a W14 记账三 bug 已修复**：① consumed 不再覆写 `deliveredAt` 真账——`delivered → consumed` 不动该字段，`pending → consumed` 直跳才按消费时刻兜底补齐；同型五处一并修正（`agentMessageLedger.markAgentMessageConsumedByTaskRef`、`swarmBus`/`redisSwarmBus.markConsumed`、`SessionQueueItemService.consume()`、`shouldSkipSuperiorMirror` 滞留兜底改条件 `updateMany`）。② waitForResult（`deliverToQueue=false`）路径 report_back 直接把旁路邮箱 AgentMessage 置 `consumed`（结果已由 tool return 交付），`deliveredAt` 如实记为 report_back 时刻——根治永远 pending、修复脚本告警不消解、`SWARM_MAX_QUEUE_SIZE` 累积堵 QUEUE_FULL；决策记录（方案 A）见 `design-decisions.md` 末尾。③ `taskRef` 对账键移出 `agent_send_message`/`agent_report_back` 的 LLM 可见 zod schema，handler 不再读 `args.taskRef`（LLM 传了也无效），唯一写入点为 report_back 桥接服务端强制写 jobId；`AgentMessageInput.taskRef` 死字段连带删除。每 bug 均先写负向断言测试（旧实现红）再改实现，`agentMessageLedger.test.ts` 9 → 12 例。
- **W16c compat 清零收尾**：C6 剩余 `globals.css` `--vp-c-*` 兼容映射块（14 个零消费变量）整块删除；`agentRuntime.ts` 无消费者 re-export trio（DEFAULT_SUBAGENT_TOOLS / resolveToolsForAgentTier / parseToolCall）删除；一次性脚本 `scripts/fix-agent-message-ledger.ts` 执行 0 命中后退役删除（对账核心 `reconcileAgentMessageLedger` 迁入 `infra/agentMessageLedger.ts`，package.json script 同步移除）；全仓终扫 `兼容|legacy|LEGACY|deprecated|backward` 生产代码零命中。
- **v4 工单（W13~W15 + 问题 G 调研）全部完成**：W13 chat.tsx 上帝文件拆分收官（3515 → **1117 行**；W13a~c 组件外提 chatMessageList/chatSidebar/chatRightPanel，W13d useEffect 23→8（chat.tsx 内）+ 5 个域 hook 收 8 个、造册 `chat-effects-inventory.md`，W13e 编排簇收拢 `useChatRunStream`/`useChatQueueDrain`/`useChatSseSubscriptions`/`useChatEnqueue`/`useChatDerivedQueues`，useEffect 合计 16 只减不增、queueMicrotask 全文 1 处；mock e2e **18/18**）。W15 兼容债务 C1~C6 清零（生产代码 `兼容|legacy|deprecated|backward` 零命中）。问题 G 纯调研文档 `docs/development/async-result-dedup-proposal.md`（推荐方案三：复用 `Task.delivered` 原子 claim 为全文交付唯一互斥点，wait 变认领参与者；零 schema 变更；**待用户拍板 3 问**）。

- **W14 AgentMessage 投递记账回写已落地**：report_back 的消费载具是 Task 管道（autoConsume 原子认领 → 注入父会话气泡），旁路邮箱 AgentMessage 此前永不回写（pending 残留 = 重复投递定时炸弹）。新增叶子模块 `infra/agentMessageLedger.ts`（按 `taskRef=jobId` 对账，updateMany 条件幂等）：① `agent_report_back` 在桥接段把 AgentMessage 关联 `taskRef=jobId`；② delivered 回写落在两处原子 CLAIM 同事务（服务端 `autoConsumeAsyncDelivery` + 前端 `markAsyncDeliveryConsumed`）；③ consumed 挂点在 `chatAgentStream`（两条认领路径都带 `toolResults.subagentResult.jobId` 经过，历史加载 + LLM messages 构建完成即「读入上下文」）；④ 幂等防线收在 `SessionQueueItemService.create`（superior 镜像投递前对账：已 delivered/consumed 不再镜像；滞留 pending 超 5min 且会话已有同 content 消息只回写 consumed 不注入）；⑤ 存量对账 `reconcileAgentMessageLedger`（W16c 起收在 `infra/agentMessageLedger.ts`，原一次性脚本执行 0 命中后已退役；滞留 pending 超 1h 对照目标会话，已注入置 consumed、未注入保持 pending 并告警）。问题 G（Task 侧 consumedBy 语义扩展）不在本工单范围。测试 `__tests__/agentMessageLedger.test.ts`（9 例）。
- **W13 chat.tsx 拆分已收官**：W13a/b/c（消息列表 → `chatMessageList.tsx`、左栏 → `chatSidebar.tsx`、右栏/异步进度 → `chatRightPanel.tsx` + `useAsyncProgressSteps.ts`）后，W13d 完成 effect 群落清点归并——`chat.tsx` 内 useEffect 23 → **8**（每个带归属注释；SSE 订阅 / mount 恢复 / listRunning 挂接 / drain 订阅四个心脏区 effect 体未改），另 8 个收进 5 个 `lib/useChat*.ts` 域 hook（UI 偏好读写合一、会话配置、悬停预览、异步 overlay 三 effect、子 Agent 消息镜像），合计 23 → 16 只减不增；toast 自动消失改为 `showToast` 内联定时器。造册与等价性论证：`docs/development/chat-effects-inventory.md`。
- **W12 MCP 断路器 + 审批清理定时化 + 心跳熔断暂停已落地**：新增 `infra/circuitBreaker.ts` 通用三态断路器（closed→open→half-open；`transition()` 转移表拒绝非法转移 open→closed / closed→half-open；open 期陈旧成功不合闸、陈旧失败不重计时；half-open 单探测）。接入 `executeMcpTool`：每 MCP server 一实例（模块级 Map + `__resetMcpCircuitBreakersForTests`），首试+重连重试整体计一次失败，open 期零真实连接、返回 `MCP_CIRCUIT_OPEN` 结构化结果喂回 LLM（不抛）。审批过期清理每日 cron（`3 4 * * *`）挂 HeartbeatEngine maintenance 通道（不随 refresh 重建；启动一次性清理仍在 index.ts）。心跳 streak 达 `HEARTBEAT_MAX_CONSECUTIVE_FAILURES` → 引擎内存态 suspended 暂停并摘除 cron job（恢复：下次 refresh() 或 `resumeHeartbeat()`，告警邮件同步说明）。测试 `__tests__/circuitBreaker.test.ts`（11 例）。
- **W11 Run 活状态 + awaiting_human 已落地**：reactLoop 内核统一接管 Run 生命周期——入口落 `status:"running"` 行、每轮 tool_batch 后 `{ phase, roundsUsed, executedToolsCount }` 快照写 `Run.output`（5s 节流，phase 转移点强制写）、终态统一 update（success/failed，用户 abort 标 cancelled），调用方（agentStream/agentRuntime）不再自建终态行。新增 `awaiting_human` phase（合法转移 `tool_batch → awaiting_human → llm`）：工具触发审批 pending 时 loop 挂起，等 `approval_resolved` 显式事件（approvalGate 等待注册表 `waitApprovalResolution`/`notifyApprovalResolved`，waiter 自带 TTL 截止与 expireStaleApprovals 同规则）唤醒，续跑消息复用 W7 injectUserMessages 注入原 session（kind=approval）；拒绝/过期注入消息让 LLM 收尾、run 正常结束。`recoverStaleRuns` 启动挂载（index.ts，recoverStaleAsyncJobs 旁）把遗留 running Run 标 `interrupted`（如实不续跑）；/runs 页补 interrupted chips。测试：`runLifecycle.test.ts`（5 例）+ `agentRunPhase.test.ts` 扩充。

- **W10 SwarmOrchestrator 中介者已落地**：新增叶子模块 `infra/swarmOrchestrator.ts`（仅依赖 asyncJobOrchestrator/swarmPermissionGuard，无环），统一 `dispatch(taskSpec) → swarmPermissionGuard 校验 → 60s spawn 去重（agentId+hash(taskText)）→ 并发池/inline 执行 → 结果聚合 → Log 审计` 公共骨架。四入口改为调用方：`spawn_subagent`（inline，同步等待语义不动）、`async_task_run`（startAsyncAgentTask 内走 pool）、`heartbeatEngine`（**已删除返回 undefined 的 invokeTrpc 桩**，心跳 Agent 与 trigger/async 共用 createTrpcInvoker 真实通道）、`TriggerEngine`（run_agent 从直跑改为 pool + await completion 保住 per-trigger 互斥）。`swarmPermissionGuard.ts` 空块检查已删，#41 时机约束单点归属 swarmBus.send → checkUpwardMessageTiming。防线测试 `__tests__/swarmOrchestrator.test.ts`（dispatch 双路 spy / spawn 去重 / guard / 在途幂等）。
- **W9 AgentFactory 模板化已落地**：三 tier（super/manager/sub）默认模板收至 `content/agents/_templates/{tier}.md`（frontmatter 格式同普通 agent 文件，super 额外含 heartbeat 段，manager/sub 支持 `{{name}}` 占位符），新增叶子模块 `infra/agentFactory.ts`（`getTierTemplate` / `createAgentForTier`，模板按 mtime 缓存，缺失时回退 shared 常量并 warn 一次/tier）；swarmInitializer（super）、workspaceProvision（manager）、loop/setup（sub）三处创建/默认值均走工厂。sync 跳过 `_` 开头目录（`sync/utils.ts` getFilesRecursive + sync.ts watch ignored），模板不会进库。`resolveAgent` 已只读化：返回 `{ agent, drift: string[] }`（调用方经 `logAgentDrift` 打 warn），读路径不再写库；老库默认 assistant 修复走一次性脚本 `scripts/migrate-assistant-tools.ts`（`pnpm --filter @knowpilot/server exec tsx src/scripts/migrate-assistant-tools.ts`，幂等）。注意：`agent.list` 按 R19 裁剪 systemPrompt，漂移检测与调用方需经 `agent.getById` 取全量实体。单测 `__tests__/agentFactory.test.ts`（7 例）。
- **W8 常量化收敛已落地**：模型名/分层工具清单/深度上限/截断值单点定义到 `packages/shared/src/constants.ts`——`LLM_MODEL_IDS` / `LLM_PROVIDER_DEEPSEEK` / `DEFAULT_LLM_MODEL`（server 生效值 = env `DEFAULT_LLM_MODEL` > `config.yaml` `llm.defaultModel` > shared 常量，解析在 `config.ts`）、`TIER_DEFAULT_TOOLS: Record<AgentTier, string[]>`（super=swarmInitializer、manager=workspaceProvision、sub=loop/setup 三处清单收敛；assistant 清单为 `ASSISTANT_DEFAULT_TOOLS`，agentResolver 创建与补齐检查共用）、`SWARM_MAX_DEPTH`/`SWARM_MAX_QUEUE_SIZE`（swarmBus/redisSwarmBus/swarmPermissionGuard 同源）、`AGENT_TOOL_RESULT_MAX_CHARS=16000`（reactLoop snapshot 与 read_article 同源）、`MEMORY_INITIAL_STRENGTH`、`HEARTBEAT_MAX_CONSECUTIVE_FAILURES`、`APPROVAL_DEFAULT_TTL_MS`。心跳连续失败告警不再是「Phase 5」僵尸：发送通道抽为 `infra/emailNotifier.ts`（send_email 工具与 HeartbeatEngine 复用同一实现），streak 达阈值时邮件告警一次（`EMAIL_PROVIDER=none` 时降级为日志）。
- **W7 反思装饰器已落地**：`infra/loop/reflection.ts` `withReflection(transport, opts)` 在「即将 done」终轮（withTools 且零 toolCalls）用 criticModel 跑一票 JSON critic（`{passed, issues}`），verdict 附到 `LlmTurnResult.reflection`；**评估在 transport 装饰器、决策在 reactLoop done 转移点**——不通过且轮数未满经既有 `injectUserMessages`（kind=follow_up）回注重修，轮数耗尽带 `[未经反思通过]` 标记放行（不阻断用户）。critic 经内部 `createSyncTransport(config, criticModel)` 走 W2 弹性客户端；critic 失败/解析失败 = 静默跳过。`config.yaml` `reflection: { enabled: false, maxRounds: 1, criticModel: "" }` 默认关闭；仅接入 agentRuntime sync 链路，stream 链路另立跟进。单测 `__tests__/reflection.test.ts`（5 例）。
- **W6 D 类工具幂等 rollback 已落地**：`infra/tools/rollback.ts` 新增 `RunRollbackStack`——reactLoop 每 run 建栈注入 `NativeToolContext.rollbackStack`；`executeNativeTool` 对注册处标记 `destructive` 的工具执行前 capture、成功后 commit；run failed 且非用户 abort 时逆序补偿，报告写 failed Run 的 `output.rollback`。补偿语义：`write_file` 快照还原（run 级 10MB 上限）；`post_create`/`memory_create` 走 Service 删 id；`file_delete`/`directory_delete` 执行时移项目根 `.trash/`（用户手动清理），rollback 移回；`git_commit` 等不可逆操作如实 warn「需人工 revert」。单测 `toolRollback.test.ts`；详见 `docs/development/p0-agent-arch-pr-split.md` PR-4 节。
- **W5-followup 记忆三层落地**：scope 三层（`global` / `workspace:{wid}` / `agent:{aid}`）读写全通——`buildMemoryContext` 与 native `memory_search` 注入三层 scopes（Agent 有 Workspace 时）；`memory_create` 加可选 scope 参数，越权由 `memoryRepository.resolveMemoryWriteScope` 硬拦（仅 super 写 global、禁止伪造他 Agent/他 Workspace）；`accumulateExperience` 对属于 Workspace 的 Agent 双写 agent + workspace 两层经验（sub 无 memory 工具权限，workspace 层供管理/超级 Agent 检索）。
- **W1/W3/W5 已落地**：W1（`f2f889d4`）审批审计合规——`Approval` 加 `decidedBy/decidedAt/decisionNote/executedAt`，执行后软删除 `status=executed` 永不物理删除，过期清理改 `updateMany` 批量；W3（`209ac858`+`b4208022`）Chat Compose drain 收口——INV-8 单驱动不变量收进 useStreamLifecycle reducer（`drainRequested` + `HYDRATE_DONE` + 显式触发事件），双驱动补丁与 `await hydrate` 赌落库删除；W5（`3fc4be4d`）MemoryRepository 仓储抽象——`infra/memoryRepository.ts` 接口 + Prisma 实现，Memory 加 `scope`/`agentId`/`contentHash`，`decayMemories` 按日复利衰减归档，prompt 拼接/agentEvolution/native memory_* 全走接口。
- **W4 循环依赖环已打断**：原环 `agentRuntime → loop/index → reactLoop → agentTools → nativeTools → agentRuntime`。新增叶子模块 `infra/promptBuilder.ts`（buildMemoryContext / buildSystemPromptWithHints / buildTierIdentityHint / buildAgentToolGuide）与 `infra/agentResolver.ts`（resolveAgent）；W15 已删除 agentRuntime 的兼容 re-export，全仓 import 直连叶子模块。resolveAgent 经 `NativeToolContext.resolveAgent` 注入（createAgentToolContext 填充，缺省回退 agentResolver）。nativeTools 动态 import 15→3（仅 agentStream / asyncJobManager 两个环内模块 + nodemailer 可选依赖）。防线测试：`apps/server/src/__tests__/importOrder.test.ts`（import 顺序冒烟 + 源码防线）。
- **W15 兼容性债务清零（C1~C6）**：删除 agentRuntime 兼容 re-export；memory_search 删 page 伪装分页；feishu_send_text 删无 prisma 直发分支（缺上下文即报错）；session.list 统一 agentIds 批量过滤（单 agentId 入参移除）；全仓 compat 扫描清零——删 TOOL_NAME_ALIASES 空别名表、chat.tsx 旧 sessionStorage 键迁移块、未使用的 AsyncTaskQueueList、死代码 CLEAR_STREAMING_UI/clearStreamingUi、compact.charThreshold 死配置、ocrImage 死参数 chatSupportsVision、memory .json 同步分支（存量文件已迁 .md）、webScraper closeBrowser 别名、ChatModelOption.supportsReasoning 废弃字段；VITE_ 环境变量回退保留（本机 .env 在用）。

- **W2 LLM 弹性客户端已落地**：`infra/resilientLlmClient.ts` 装饰器包装 llmClient（错误分类 fatal/retryable/degradable + 指数退避 jitter 重试 + `config.yaml` `llm.fallbackModels` 按序降级）；`agentRuntime`/`agentStream` error 事件的 `retryable` 改为按分类真实填充；`llmBudget.ts` 预算状态改为模块级内存 + 防抖异步落盘（LLM 调用路径零同步 IO）。

- **P0 Agent 架构（分支 `fix/p0-agent-budget-hitl`）**：PR-1～7 已全部落地；native 工具已全量按域拆至 `infra/tools/native/{fs,web,shell,swarm,session,memory,integration}.ts`，`nativeTools.ts`（118 行）只留注册 + 分发。见 `docs/development/p0-agent-arch-pr-split.md`。
- **重复超级 Agent 已清理**：文件 `content/agents/KnowPilot 超级 Agent-v5wh3v.md` 已删除；`sync-agents.ts` 跳过 `tier === "super"`。
- **设计决策文档**：沉淀在 `docs/development/design-decisions.md`。

## 未来功能

1. ~~**Agent 自动开启新 Session**~~：已落地 `session_rotate`（归档旧会话 + 同 Agent 新会话 + 总结首条消息；旧页提示跳转不自动切换）。
2. **自动压缩（Auto-Compact）**：已产品化（`config.yaml` compact + `ChatSession.contextSummary` + 手动压缩）。
3. ~~**推送替代轮询**~~：Chat 侧已推优先（`async_job_update` / `agent_message` / `subagent_session_update`），轮询降为兜底。
4. ~~**PR-4b / 4c**~~：已落地（W6）——swarm/session/memory/integration 四域拆分，`nativeTools.ts` 3420 → 118 行。
5. ~~**长期后台任务跨重启续跑**~~：已落地 at-least-once 版（v10 C-1~C-3）——`reentrant=true` 僵尸任务自动续跑 + 重试账本持久化 + paused 会话手动恢复闭环；断点 checkpoint 续跑仍为未来扩展。

---

> 最后更新：2026-07-17。L1–L5 已全部落地；P0 PR-1～7（含 PR-4b/4c native 全域拆分）已验收；W1–W12 架构修复工单全部落地（审计报告 10 维度终态 6✅/4⚠️/0❌，见 `docs/development/architecture-audit-2026-07.md`），不做/跟进项已登记 `design-decisions.md`；v4 工单（W13 chat.tsx 拆分至 1117 行、W14 AgentMessage 记账回写、W15 兼容清零）已完成；v7 异步工具体系收敛（W-0/W-A/W-E/W-F：双工具分工、`async_task_wait` 删除、status 去全文、C7 服务端队列、存量硬删）已落地；v8 全局任务池（TP-1/TP-2：容量不变量 + Q1~Q4 决策）已落地；v9 投递可靠性（R-1 S3 两层根治 + R-2 重启恢复四动作 + R-3 历史闭环）已落地；v10 可重入与续跑（C-1 基座 + C-2 僵尸任务自动续跑 + C-3 会话手动恢复闭环 + C-4 文档；P2 S1 重复 system 消息去重修复已合入 master）已落地。
