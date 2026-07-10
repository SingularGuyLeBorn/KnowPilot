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
│   │       ├── infra/          # agentTools、nativeTools、mcpClient、autoCompact、agentStream、
│   │       │                  # swarmPermissionGuard、swarmBus、swarmInitializer、heartbeatEngine、
│   │       │                  # asyncJobManager、asyncJobOrchestrator、safePath 等
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
├── scripts/
│   └── clean-content.mjs       # 清理 emoji、规范化数学公式
├── .dev-log/                   # 开发日志
└── 根配置（package.json、pnpm-workspace.yaml、tsconfig.base.json 等）
```

### 实体矩阵（当前实现状态）

详见 `docs/development/entities/entity-matrix.md`。关键事实：

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
- 动画偏好：Framer Motion `type: "spring", stiffness: 260, damping: 26`（Chat 等）；旧页面可用 180/20。
- **图标**：统一 Lucide 或 `apps/web/lib/icons.tsx` 自绘 SVG；**禁止**用 emoji / 键盘可直接输入字符当 UI 图标。详见 `docs/development/frontend/ui-design.md`。

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
3. `pnpm db:sync` 扫描 `content/posts/`、`content/agents/` 等已注册目录，解析后 upsert 到对应表；删除本地已不存在但数据库仍有的记录。
4. Post / Agent / Skill / MCP / Memory / Prompt 的 `create` / `update` / `delete` 会同步写回 `content/` 对应文件。
5. 自动保存：`useAutoSave.ts` 500ms 节流写入 LocalStorage，2s 防抖调用 `post.update`（仅对已存在 id）。

### 项目扁平化与代码收拢约定

为了杜绝项目文件夹过深、同名文件繁多引发维护崩溃，以及防止功能重复定义，项目必须严格遵循**“单文件逻辑收拢”**原则：
1. **后端业务层合并**：禁止创建 `services/` 子目录及零散服务文件。所有 19 个实体的 Service 业务逻辑统一写在 `apps/server/src/services.ts` 中。
2. **后端路由层合并**：禁止创建 `trpc/routers/` 子目录及零散路由文件。所有 API 路由统一声明在 `apps/server/src/router.ts` 中。
3. **前端 Hooks 合并**：禁止创建 `hooks/` 子目录及零散数据 hooks 文件。所有 React Query hooks 统一放在 `apps/web/lib/hooks.ts` 中。
4. **前端通用组件合并**：禁止创建 `components/shared/` 目录及零散小组件。通用的页面基础 UI 组件（如分页、空状态、骨架屏、确认弹窗）统一放在 `apps/web/components/shared.tsx` 中。

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

Agent 工具链：`docs/development/backend/agent-tools.md`  
Chat UX 对标：`docs/development/frontend/agent-ux-reference.md`  
E2E 说明：`docs/development/frontend/e2e-testing.md`

### Lint

```bash
pnpm lint
```

- `@knowpilot/server` / `@knowpilot/shared`：`tsc --noEmit`
- `@knowpilot/web`：`eslint`（`eslint.config.mjs` 使用 `eslint-config-next/core-web-vitals` + `eslint-config-next/typescript`）

---

## Swarm 架构（三层 Agent 层级 + 心跳自主运行）

KnowPilot 已落地完整的 Swarm 能力，设计决策详见 `docs/development/swarmplan.md`（48 项决策全部确认）。

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
| `AGENT_DESTRUCTIVE_APPROVAL` | `false` | true 时删除操作走审批 |

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
| Swarm 架构设计决策 | `docs/development/swarmplan.md` |
| 设计新的后端接口 | `docs/development/backend/api-design.md`、`docs/development/backend/error-handling.md` |
| 让 AI 调用某个实体 | `docs/development/backend/ai-callable-api.md` |
| 查看实体实现状态矩阵 | `docs/development/entities/entity-matrix.md` |
| 修改前端样式/组件 | `apps/web/components/`、`apps/web/app/globals.css` |
| Chat / About / UX 对标 | `docs/development/frontend/agent-ux-reference.md`、`ui-design.md` |
| 修改 Agent 工具 / MCP / Skill 运行时 | `apps/server/src/infra/agentTools.ts`、`docs/development/backend/agent-tools.md` |
| 新增或修改 tRPC Router | `apps/server/src/router.ts`、`packages/shared/src/schemas.ts` |
| 新增内容同步逻辑 | `apps/server/src/scripts/sync.ts`、`apps/server/src/scripts/sync/sync-*.ts` |

---

## 设计决策 Q&A 流程

当遇到需要用户决策的设计问题时，遵循以下流程：

1. **AI 把问题写入文件**（如 `docs/development/swarmplan.md`），每条问题包含：
   - 问题描述
   - 推荐的解决方式
   - `回答：` 占位行
2. **用户在文件内回答**：直接在 `回答：` 后写回复
3. **回答约定**：
   - 用户**不写回答** = **默认同意**推荐方案
   - 用户**写了回答** = AI 需阅读并据此调整，如有疑问再追加问题
4. **AI 读取回复后**：确认的决策移入「已确认 ✅」表格，新问题继续追加到文件末尾

---

> 最后更新：2026-07-10。L1–L5 已全部落地；REMEDIATION_PLAN.md 与性能优化计划 28 项已收尾；Async Task Queue Phase 1–5、子 Agent 会话恢复、深色模式主题切换、普通对话刷新恢复已落地。`pnpm validate` 全绿：lint 0 error + Vitest 256 passed + 真实 LLM E2E 46 passed / 1 skipped + Mock E2E 18 passed。
