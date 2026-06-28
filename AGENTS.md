# KnowPilot — AI 开发指南

> 本文件面向 AI 编码助手。阅读本文档前，默认你对本项目一无所知。请优先以本文件、README.md、MIGRATION_PLAN.md、docs/development/ 的顺序了解项目背景与规范。

---

## 项目概述

KnowPilot 是一个**单用户、本地优先**的智能知识管理与博客平台，定位为「以 Markdown 为原子、AI 为引擎的数字花园」。

- **核心原则**：本地 Markdown 文件是数据的唯一事实源，SQLite（通过 Prisma）只作为查询与缓存层。
- **当前阶段**：L1（博客基建）中后期，核心博客读写、渲染、编辑器、自动保存、TOC、页内搜索已跑通。
- **未完成领域**：L2 ~ L5 仅后端 tRPC Router 与 Prisma 模型存在，前端页面、内容目录同步、AI 能力均未实现。

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
| 测试 | Vitest 3.2.3（server、shared） |
| 其他工具 | `gray-matter`（frontmatter 解析）、`lodash-es`、lucide-react |

> 注意：`docker-compose.yml` 中提供了可选的 PostgreSQL 16 服务，但当前 `.env.example` 与代码实际使用 SQLite（`DATABASE_URL="file:./dev.db"`）。PostgreSQL 容器仅作未来扩展使用，日常开发无需启动。

---

## 项目结构与模块划分

```text
KnowPilot/
├── apps/
│   ├── server/                 # Express + tRPC + Prisma 后端
│   │   ├── prisma/
│   │   │   ├── schema.prisma   # 14 个实体模型
│   │   │   ├── seed.ts         # 3 篇示例文章种子
│   │   │   └── dev.db          # SQLite 数据库（运行时生成/更新）
│   │   └── src/
│   │       ├── index.ts        # Express 入口
│   │       ├── router.ts       # 导出 AppRouter 类型给前端
│   │       ├── db.ts           # Prisma 单例
│   │       ├── scripts/sync.ts # Markdown ↔ SQLite 同步脚本
│   │       ├── __tests__/trpc.test.ts
│   │       └── trpc/
│   │           ├── trpc.ts     # initTRPC + publicProcedure
│   │           ├── context.ts  # 注入 prisma
│   │           ├── router.ts   # 合并 14 个子 router
│   │           └── routers/    # post/agent/session/... 共 14 个
│   └── web/                    # Next.js 16 前端
│       ├── app/                # 页面路由
│       ├── components/         # layout、post、editor、home、ui
│       ├── lib/                # trpc.tsx、useAutoSave.ts、utils.ts
│       ├── public/
│       └── 配置文件
├── packages/
│   └── shared/                 # 前后端共享 Zod schema + TS 类型
│       └── src/
│           ├── schemas.ts
│           └── index.ts
├── content/                    # Git 跟踪的文本数据源
│   ├── posts/                  # 文章 Markdown 源文件（已大量使用）
│   ├── agents/                 # Agent 配置（占位 .gitkeep）
│   ├── skills/                 # Skill 配置（占位 .gitkeep）
│   ├── memories/               # Memory 配置（占位 .gitkeep）
│   ├── tasks/                  # Task 配置（占位 .gitkeep）
│   └── mcp/                    # MCP Server 配置（占位 .gitkeep）
├── docs/development/           # L1-L5 阶段开发文档与 API 规范
├── scripts/
│   └── clean-content.mjs       # 清理 emoji、规范化数学公式
├── .dev-log/                   # 开发日志
└── 根配置（package.json、pnpm-workspace.yaml、tsconfig.base.json 等）
```

### 实体矩阵（当前实现状态）

详见 `docs/development/entities/entity-matrix.md`。关键事实：

- **Post**：后端 CRUD、前端页面、Markdown 同步、AI 可读性全部完成。
- 其余 13 个实体（Agent、Skill、McpServer、Memory、ChatSession、ChatMessage、File、GitRepo、Task、Log、Workspace、Trigger、Approval）：后端 CRUD 基本就绪，但前端未实现、内容目录同步未实现。

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
pnpm db:sync      # Markdown → SQLite 单向同步（关键，开发前/构建前必须执行）
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
  - `/api/trpc`：tRPC 端点，挂载 14 个 router。
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

规范来源：`docs/development/backend/api-design.md`、`docs/development/backend/error-handling.md`

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
- 动画偏好：Framer Motion `type: "spring", stiffness: 180, damping: 20`。
- 图标统一使用 `lucide-react`。

### Markdown ↔ SQLite 同步约定

来源：`MIGRATION_PLAN.md`、`docs/development/backend/entity-sync.md`

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
3. `pnpm db:sync` 扫描 `content/posts/**/*.md`，解析 frontmatter，以相对路径（去掉 `.md`）作为 `slug` 写入 `Post` 表；删除本地已不存在但数据库仍有的文章。
4. `post.create` / `post.update` / `post.delete` 会同步创建/覆盖/删除 `content/posts/{slug}.md`。
5. 自动保存：`useAutoSave.ts` 500ms 节流写入 LocalStorage，2s 防抖调用 `post.update`（仅对已存在 id）。

---

## 测试说明

### 测试框架

- **Vitest 3.2.3**：用于 `@knowpilot/server` 与 `@knowpilot/shared`。
- 未发现独立的 `vitest.config.*` 文件，使用各 package 的 `package.json` 默认脚本。
- Web 端未配置测试脚本；README 中提到 Playwright，但项目中未找到 `playwright.config.ts`。`.playwright-mcp/` 目录为 Playwright MCP 运行痕迹，不是正式测试套件。

### 运行测试

```bash
pnpm test              # 运行所有 package 的测试
pnpm --filter @knowpilot/server test
pnpm --filter @knowpilot/shared test
```

### 现有测试

- `apps/server/src/__tests__/trpc.test.ts`：测试 Workspace 的 CRUD（create → getById → list → update → delete），使用 `appRouter.createCaller(ctx)` 而非 HTTP。

### Lint

```bash
pnpm lint
```

- `@knowpilot/server` / `@knowpilot/shared`：`tsc --noEmit`
- `@knowpilot/web`：`eslint`（`eslint.config.mjs` 使用 `eslint-config-next/core-web-vitals` + `eslint-config-next/typescript`）

---

## 安全与敏感信息

- `.env` 文件被 `.gitignore` 忽略，不得提交到 Git。
- `.env.example` 仅包含占位值，用于说明所需环境变量：
  - `DATABASE_URL`：SQLite 路径（当前为 `file:./dev.db`）。
  - `SERVER_PORT`：后端端口（默认 3010）。
  - `DEEPSEEK_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`：L2+ AI 能力使用，当前未启用。
- 当前为单用户模式，所有 tRPC procedure 公开，无鉴权、无输入长度限制、无速率限制。若暴露到公网，必须额外增加反向代理、鉴权、限流等安全措施。
- SQLite 文件 `apps/server/prisma/dev.db` 被 `.gitignore` 忽略，但 `content/posts/` 下的 Markdown 源文件受 Git 跟踪，是数据的持久化真相源。

---

## 部署相关

- **当前状态**：项目明显处于本地开发阶段，尚无成熟部署流程。
- **Docker**：`docker-compose.yml` 仅定义 PostgreSQL 容器，没有为 web/server 构建的 Dockerfile。
- **生产构建**：根 `build` 脚本仅执行 `pnpm --filter @knowpilot/web build`。构建前应执行 `pnpm db:sync` 把 `content/posts` 同步到 `dev.db`。
- **CI/CD**：未找到 `.github/workflows`、`.gitlab-ci.yml` 等持续集成配置。
- **部署建议**（按当前架构）：构建前同步 Markdown 到 SQLite，将生成的 `dev.db` 与 Next.js 产物一起部署；server 作为独立服务运行时注意配置 `SERVER_PORT` 与跨域。

---

## 给 AI 助手的快速导航

| 你想做的事 | 先看这里 |
|---|---|
| 了解产品背景与快速开始 | `README.md` |
| 了解迁移/重构原则与同步机制 | `MIGRATION_PLAN.md` |
| 了解 L1-L5 阶段划分与当前状态 | `docs/development/README.md` |
| 设计新的后端接口 | `docs/development/backend/api-design.md`、`docs/development/backend/error-handling.md` |
| 让 AI 调用某个实体 | `docs/development/backend/ai-callable-api.md` |
| 查看实体实现状态矩阵 | `docs/development/entities/entity-matrix.md` |
| 修改前端样式/组件 | `apps/web/components/`、`apps/web/app/globals.css` |
| 新增或修改 tRPC Router | `apps/server/src/trpc/routers/`、`packages/shared/src/schemas.ts` |
| 新增内容同步逻辑 | `apps/server/src/scripts/sync.ts`、对应实体的 router |

---

> 最后更新：2026-06-28。若你修改了构建流程、技术栈、目录结构或开发约定，请务必同步更新本文件。
