# KnowPilot 项目总览

> 本文档面向使用者和二次开发者，说明项目有哪些模块、哪些实体、完整 CRUD 是否具备，以及前端如何与系统交互。
> 如果你只想快速了解“点哪里、看到什么”，请先看 `scenarios.md`。

---

## 1. 项目定位

KnowPilot 是一个**单用户、本地优先**的智能知识管理与博客平台。

- **核心原则**：本地 Markdown 文件是数据的唯一事实源，SQLite（通过 Prisma）只作为查询与缓存层。
- **核心能力**：Markdown 博客、Agent 聊天、Agent 工具调用、子 Agent 委派、异步任务、审批、搜索、定时任务。

---

## 2. 模块划分

```
KnowPilot/
├── apps/
│   ├── server/          # Express + tRPC + Prisma 后端
│   └── web/             # Next.js 16 + React 19 前端
├── packages/
│   └── shared/          # 前后端共享的 Zod schema、类型、常量
├── content/             # Git 跟踪的文本数据源（Markdown/YAML/JSON）
├── docs/                # 项目文档（本文档所在目录）
└── scripts/             # 根目录工具脚本（backup、clean、dev 等）
```

### 2.1 `apps/server`

后端唯一入口是 `apps/server/src/index.ts`。

启动后会做三件事：

1. 初始化 Prisma 连接。
2. 调用 `initSwarm()`：如果数据库里没有超级 Agent，自动创建系统 Workspace 和唯一超级 Agent。
3. 监听 `SERVER_PORT`（默认 3010），挂载以下端点：
   - `/health`：健康检查。
   - `/api/posts/assets/*`：托管 `content/posts/` 下的图片等资源。
   - `/api/trpc/*`：tRPC 路由，所有业务接口都在这里。
   - `/uploads/*`：托管 `content/uploads/` 上传文件。

后端代码采用**扁平化单文件**设计：

| 文件 | 职责 | 禁止做的事 |
| --- | --- | --- |
| `apps/server/src/services.ts` | 19 个实体的业务逻辑 | 禁止创建 `services/` 子目录 |
| `apps/server/src/router.ts` | 所有 tRPC 路由 | 禁止创建 `trpc/routers/` 子目录 |
| `apps/server/src/infra/*.ts` | 基础设施（Agent 运行时、工具、Swarm、异步任务等） | — |
| `apps/server/prisma/schema.prisma` | 数据库模型 | — |
| `apps/server/src/scripts/sync.ts` | Markdown/YAML ↔ SQLite 同步入口 | — |

### 2.2 `apps/web`

前端基于 Next.js App Router。

| 目录 | 说明 |
| --- | --- |
| `apps/web/app/` | 页面路由 |
| `apps/web/components/` | 组件（通用组件统一在 `shared.tsx`） |
| `apps/web/lib/trpc.tsx` | tRPC React Query 客户端 |
| `apps/web/lib/hooks.ts` | 所有数据 hooks |
| `apps/web/lib/icons.tsx` | 自定义 SVG 图标 |

前端同样采用**扁平化单文件**设计：

| 文件 | 职责 | 禁止做的事 |
| --- | --- | --- |
| `apps/web/lib/hooks.ts` | 所有 React Query hooks | 禁止创建 `hooks/` 子目录 |
| `apps/web/components/shared.tsx` | 分页、空态、骨架屏、确认弹窗等通用 UI | 禁止创建 `components/shared/` 子目录 |

### 2.3 `packages/shared`

前后端共享：

- `src/schemas.ts`：Zod schema
- `src/types.ts`：TypeScript 类型
- `src/constants.ts`：常量

修改接口或实体字段时，**优先改这里**，再让前后端同时生效。

### 2.4 `content/`

本地数据源，受 Git 跟踪：

| 目录 | 内容 |
| --- | --- |
| `content/posts/` | 博客文章 Markdown |
| `content/agents/` | Agent 配置 Markdown |
| `content/skills/` | Skill 配置 Markdown |
| `content/memories/` | Memory 配置 Markdown |
| `content/prompts/` | Prompt 模板 Markdown |
| `content/tasks/` | Task 配置 JSON |
| `content/mcp/` | MCP Server 配置 YAML |
| `content/sources/` | 信息源配置 |
| `content/uploads/` | 上传文件 |

---

## 3. 实体与 CRUD

目前共有 **19 个实体**，每个实体在后端都有完整的 `create / getById / list / update / delete`，前端都有对应的管理页面。

| # | 实体 | 管理页面 | 完整 CRUD | 数据源文件 |
| --- | --- | --- | --- | --- |
| 1 | Post | `/posts`、`/editor` | ✅ | `content/posts/*.md` |
| 2 | Agent | `/agents` | ✅ | `content/agents/*.md` |
| 3 | Skill | `/skills` | ✅ | `content/skills/*.md` |
| 4 | McpServer | `/mcp` | ✅ | `content/mcp/*.yaml` |
| 5 | Memory | `/memories` | ✅ | `content/memories/*.md` |
| 6 | Prompt | `/prompts` | ✅ | `content/prompts/*.md` |
| 7 | Task | `/tasks` | ✅ | `content/tasks/*.json` |
| 8 | InfoSource | `/sources` | ✅ | `content/sources/*` |
| 9 | ChatSession | Chat 左栏 | ✅ | DB |
| 10 | ChatMessage | Chat 对话区 | ✅ | DB |
| 11 | File | `/files` | ✅ | `content/uploads/` + DB |
| 12 | GitRepo | `/git` | ✅ | DB |
| 13 | Log | `/logs` | ✅ | DB |
| 14 | Workspace | `/workspaces` | ✅ | DB |
| 15 | Trigger | `/triggers` | ✅ | DB + `content/tasks/` |
| 16 | Approval | `/approvals` | ✅ | DB |
| 17 | Tool | `/tools` | ✅ | DB |
| 18 | Run | `/runs` | ✅ | DB |
| 19 | Credential | `/credentials` | ✅ | DB |

### 3.1 列表接口统一格式

所有 `list` 接口返回：

```ts
{
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
```

### 3.2 前端调用实体 CRUD 的方式

以 `Agent` 为例：

```ts
import { useAgent } from "@/lib/hooks";

const { useList, useById, useCreate, useUpdate, useDelete } = useAgent();

const agentsQuery = useList({ page: 1, pageSize: 20 });
const agentQuery = useById("agent-id");
const createMutation = useCreate();
const updateMutation = useUpdate();
const deleteMutation = useDelete();
```

所有实体都通过 `useCRUDApi(routerName)` 生成，routerName 与 `apps/server/src/router.ts` 里的子路由名一致，例如 `post`、`agent`、`skill`、`session`、`message` 等。

---

## 4. 前端页面与交互

### 4.1 主要页面

| 路径 | 功能 |
| --- | --- |
| `/` | 博客首页 |
| `/posts` | 文章列表/管理 |
| `/editor` | Markdown 编辑器（新建/编辑文章） |
| `/posts/[slug]` | 文章详情页 |
| `/agents` | Agent 管理 |
| `/skills` | Skill 管理 |
| `/mcp` | MCP Server 管理 |
| `/memories` | 记忆管理 |
| `/prompts` | Prompt 模板管理 |
| `/tasks` | 后台任务管理 |
| `/sources` | 信息源管理 |
| `/chat` | Agent Chat（核心交互页面） |
| `/workspaces` | Workspace 管理 |
| `/triggers` | 触发器管理 |
| `/approvals` | 审批管理 |
| `/tools` | 工具管理 |
| `/runs` | 运行记录 |
| `/credentials` | 凭证管理 |
| `/dashboard` | 统计面板 |
| `/settings` | 设置（模型、密码等） |
| `/login` | 登录页（`AUTH_MODE=password` 时启用） |

### 4.2 Chat 页面结构

Chat 页面 (`/chat`) 是三栏布局：

- **左栏**：会话历史 / Async 任务 / 子 Agent 会话树。
- **中栏**：消息对话区 + 底部输入框。
- **右栏**：Chat 配置 / Runtime 异步任务队列。

消息布局：

- **右侧气泡**：用户发送的消息、上级 Agent 下发的任务、异步任务结果。
- **左侧气泡**：Agent 的回复（assistant）。
- **时间线/导轨**：出现在 assistant 气泡上方，展示 thinking、工具调用、中间内容等步骤。

### 4.3 前后端通信

前端通过 tRPC + React Query 与后端通信：

```ts
import { trpc } from "@/lib/trpc";

const query = trpc.agent.getById.useQuery({ id: "xxx" });
const mutation = trpc.agent.update.useMutation();
```

SSE 流式聊天走 `streamAgentChat`（`apps/web/lib/agentStream.ts`），路径为 `/api/agent/chat/stream`。

---

## 5. 常用命令

| 命令 | 作用 |
| --- | --- |
| `pnpm install` | 安装依赖 |
| `pnpm dev` | 同步内容并同时启动 server + web |
| `pnpm dev:web` | 只启动前端 |
| `pnpm dev:server` | 只启动后端 |
| `pnpm db:sync` | Markdown/YAML ↔ SQLite 同步 |
| `pnpm db:backup` | 备份 `dev.db` |
| `pnpm build` | 构建前端 |
| `pnpm lint` | 全仓库 lint |
| `pnpm test` | 全仓库 Vitest |
| `pnpm test:e2e` | Playwright E2E |
| `pnpm validate` | lint + test + build + e2e |

---

## 6. 接下来读什么

- 想了解具体使用场景（Agent、子 Agent、异步任务）：看 `scenarios.md`。
- 想了解并发和竞态条件防护：看 `concurrency.md`。
- 想了解未来规划：看 `future-features.md`。
