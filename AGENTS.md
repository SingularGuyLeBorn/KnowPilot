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
| 测试 | Vitest 3.2.3（server、shared）+ Playwright（web Chat E2E） |
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
│       ├── lib/                # trpc.tsx、hooks.ts、icons.tsx、aboutProfile.ts
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
- **Agent / Skill / McpServer / Memory / Prompt**：L2 后端 CRUD、内容双向写回、`db:sync`、管理页已完成；Agent ReAct + SSE 流式 `/chat`（三栏 UI）、`skill:*` 双路径、MCP 截断重连、auto-compact 已实现。
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

- **Vitest 3.2.3**：`@knowpilot/server` / `@knowpilot/shared`
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
| `async-task-queue.test.ts` | `async_task_run/status/wait` 与队列状态 |
| `capabilities.test.ts` / `platformFetch.test.ts` | 运行时能力 / 平台 fetch |
| `e2e/blog-smoke.spec.ts` | L1 博客冒烟（/posts、/editor、/、/posts/[slug]） |
| `e2e/admin-pages.spec.ts` | 管理页冒烟（20 路由 + /about） |
| `e2e/chat-thinking-real.spec.ts` | 真实 LLM Chat 发消息/重试、思考时间线不重复 |
| `e2e/chat-tool-hint-real.spec.ts` / `chat-ocr-real.spec.ts` / `chat-queue-real.spec.ts` | 真实 LLM 工具/OCR/异步队列 |
| `e2e/chat-mock.spec.ts` / `chat-thinking-mock.spec.ts` / `chat-tool-error-mock.spec.ts` | Mock E2E（全离线，MOCK_LLM/MCP/NATIVE_TOOLS） |
| `e2e/chat-subagent-resume-mock.spec.ts` | 刷新 / 切 session / 切 Agent 后父会话流式恢复 |
| `e2e/chat-resume-mock.spec.ts` | 普通对话刷新后最终结果不丢失 |
| `e2e/async-task-mock.spec.ts` | Mock 异步任务结果自动插入对话 |
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

### 三层 Agent 层级

| 层级 | tier | 权限 | 说明 |
|---|---|---|---|
| 超级 Agent | `super` | 全局 CRUD + 跨 Workspace | 首次启动自动创建，心跳自主运行 |
| 管理 Agent | `manager` | Workspace 内 CRUD 子 Agent | 每个 Workspace 一个，自动创建主 session |
| 子 Agent | `sub` | 执行任务 + report_back | 由管理 Agent 或用户创建 |

### 核心模块

| 模块 | 文件 | 说明 |
|---|---|---|
| 权限硬拦截 | `infra/swarmPermissionGuard.ts` | tier 校验 + 向上发消息时机 + 跨 Workspace + depth 防循环 |
| Agent 间消息 | `infra/swarmBus.ts` | LocalSwarmBus（SQLite AgentMessage 表） |
| 心跳引擎 | `infra/heartbeatEngine.ts` | node-cron 定时触发 + 预算检查 + 并发控制 |
| 超级 Agent 初始化 | `infra/swarmInitializer.ts` | 首次启动自动创建 |
| Swarm native tools | `infra/nativeTools.ts` | agent_create/update/delete/inspect/send_message/report_back + workspace_create/archive + skill_discover/promote + send_email + free_api_keys |

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `SWARM_MODE` | `local` | `local`（零依赖）/ `redis`（BullMQ，Phase 4） |
| `EMAIL_PROVIDER` | `none` | `none` / `smtp` / `agentemail` |
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
stream:
  ringSize: 500          # SessionStreamHub 内存环形缓冲事件数
  persist: true          # 是否持久化事件到 SQLite
  eventTtlMs: 300000     # 持久化事件保留时长
  cleanupIntervalMs: 60000 # 过期事件清理间隔
```

- `SessionStreamHub` 采用「内存热缓冲 + SQLite 事件日志」双写：低延迟推送走内存，断线续传 / 服务端重启恢复走数据库。
- 运行中的 Agent 任务仍随服务端进程重启而丢失；长期后台任务的跨重启恢复属于后续扩展。

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
| 修改 Agent 工具 / MCP / Skill 运行时 | `apps/server/src/infra/agentTools.ts`、`apps/server/src/infra/tools/`（ToolCommand 注册表 + `native/{fs,web,shell}`）、`apps/server/src/infra/loop/`（统一 ReAct 内核） |
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

## 当前状态与近期变更（2026-07-13）

- **W5-followup 记忆三层落地**：scope 三层（`global` / `workspace:{wid}` / `agent:{aid}`）读写全通——`buildMemoryContext` 与 native `memory_search` 注入三层 scopes（Agent 有 Workspace 时）；`memory_create` 加可选 scope 参数，越权由 `memoryRepository.resolveMemoryWriteScope` 硬拦（仅 super 写 global、禁止伪造他 Agent/他 Workspace）；`accumulateExperience` 对属于 Workspace 的 Agent 双写 agent + workspace 两层经验（sub 无 memory 工具权限，workspace 层供管理/超级 Agent 检索）。
- **W4 循环依赖环已打断**：原环 `agentRuntime → loop/index → reactLoop → agentTools → nativeTools → agentRuntime`。新增叶子模块 `infra/promptBuilder.ts`（buildMemoryContext / buildSystemPromptWithHints / buildTierIdentityHint / buildAgentToolGuide）与 `infra/agentResolver.ts`（resolveAgent）；agentRuntime 仅保留兼容 re-export，新代码直接引叶子模块。resolveAgent 经 `NativeToolContext.resolveAgent` 注入（createAgentToolContext 填充，缺省回退 agentResolver）。nativeTools 动态 import 15→3（仅 agentStream / asyncJobManager 两个环内模块 + nodemailer 可选依赖）。防线测试：`apps/server/src/__tests__/importOrder.test.ts`（import 顺序冒烟 + 源码防线）。

- **W2 LLM 弹性客户端已落地**：`infra/resilientLlmClient.ts` 装饰器包装 llmClient（错误分类 fatal/retryable/degradable + 指数退避 jitter 重试 + `config.yaml` `llm.fallbackModels` 按序降级）；`agentRuntime`/`agentStream` error 事件的 `retryable` 改为按分类真实填充；`llmBudget.ts` 预算状态改为模块级内存 + 防抖异步落盘（LLM 调用路径零同步 IO）。

- **P0 Agent 架构（分支 `fix/p0-agent-budget-hitl`）**：PR-1～3、PR-4a、PR-5～7 已落地；PR-4a 将 FS/WEB/SHELL 抽至 `infra/tools/native/{fs,web,shell}.ts`，`nativeTools.ts` 保留其余域 + 兼容 re-export。见 `docs/development/p0-agent-arch-pr-split.md`。
- **重复超级 Agent 已清理**：文件 `content/agents/KnowPilot 超级 Agent-v5wh3v.md` 已删除；`sync-agents.ts` 跳过 `tier === "super"`。
- **设计决策文档**：沉淀在 `docs/development/design-decisions.md`。

## 未来功能

1. ~~**Agent 自动开启新 Session**~~：已落地 `session_rotate`（归档旧会话 + 同 Agent 新会话 + 总结首条消息；旧页提示跳转不自动切换）。
2. **自动压缩（Auto-Compact）**：已产品化（`config.yaml` compact + `ChatSession.contextSummary` + 手动压缩）。
3. ~~**推送替代轮询**~~：Chat 侧已推优先（`async_job_update` / `agent_message` / `subagent_session_update`），轮询降为兜底。
4. **PR-4b / 4c**：继续按域拆分 swarm/session/memory 与第三方集成工具。

---

> 最后更新：2026-07-14。L1–L5 已全部落地；P0 PR-4a（native fs/web/shell 域拆分）已验收；W5-followup 记忆三层已落地。
