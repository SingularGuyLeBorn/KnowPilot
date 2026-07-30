<div align="center">
  <p>
    <img src="docs/assets/logo.svg" alt="见微 · OasisMind" width="96" height="96">
  </p>
  <img src="docs/assets/readme-banner.svg" alt="见微 · OasisMind" width="100%">

  <p align="center">
    <strong>见微 · OasisMind</strong><br>
    见微知著 · 以 Markdown 为原子、AI 为引擎的本地优先数字主力
  </p>

  <p align="center">
    <img src="https://img.shields.io/badge/Next.js-16-black?logo=next.js&logoColor=white&color=2d2a26&labelColor=b8a090" alt="Next.js 16">
    <img src="https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=white&color=2d2a26&labelColor=b8a090" alt="React 19">
    <img src="https://img.shields.io/badge/tRPC-11-2596be?logo=trpc&logoColor=white&color=2d2a26&labelColor=b8a090" alt="tRPC 11">
    <img src="https://img.shields.io/badge/Prisma-6-2d3748?logo=prisma&logoColor=white&color=2d2a26&labelColor=b8a090" alt="Prisma">
    <img src="https://img.shields.io/badge/SQLite-3-003b57?logo=sqlite&logoColor=white&color=2d2a26&labelColor=b8a090" alt="SQLite">
    <img src="https://img.shields.io/badge/Tailwind_CSS-v4-06b6d4?logo=tailwindcss&logoColor=white&color=2d2a26&labelColor=b8a090" alt="Tailwind CSS v4">
    <img src="https://img.shields.io/badge/License-MIT-green?color=2d2a26&labelColor=b8a090" alt="MIT">
  </p>

  <p align="center">
    <a href="#为什么做见微">为什么做见微</a> ·
    <a href="#快速开始">快速开始</a> ·
    <a href="#核心能力">核心能力</a> ·
    <a href="#技术栈">技术栈</a> ·
    <a href="#项目结构">项目结构</a> ·
    <a href="#架构亮点">架构亮点</a> ·
    <a href="#路线图">路线图</a> ·
    <a href="#uih">UIH</a> ·
    <a href="docs/development/README.md">开发文档</a>
  </p>
</div>

---

## 为什么做见微

LLM 领域里，为了对抗 Transformer 的平方复杂度，已经出现了诸多流派。算法在竞速，上下文窗口在变长，工具调用在变稳。

但当 **2025 年 7 月前后**，大模型的 **agentic 能力**真正起来之后，human-in-the-loop 里最大的瓶颈，渐渐不再是模型——而是 **human 的上下文**，以及人类自己的懒惰。

你对技术仍有热忱：每天收藏、点赞、稍后读。内容散落在知乎、小红书、B 站、微信、浏览器书签……很多地方打开都费劲，每天手动收一次会累，自然想「干脆收集起来」。可真正动手时又很难：收藏一多，收藏本身就需要分类；越拖成本越高；到后面彻底放弃。

这时，让一个 Agent 去做，就很合适。

重要的是：这个 Agent 不该只是通用助手——它应该和你**一样的品味（taste）**。要做到这一点，就要**自己蒸馏自己**；蒸馏需要来源，也需要对自我有清晰认知。这很难，非常需要时间与精力。但总要做。

**见微（OasisMind）** 因此而生：希望它成为真正的**数字主力**——常驻、本地、不离场；每天提醒你昨晚还有什么没看、没做；一周过去了，哪些事还在晾着。见微知著：从细处积累，看见自己。

> 产品曾用名 KnowPilot。仓库与 npm 工作区包名（`@knowpilot/*`）仍处过渡期，用户可见品牌以 **见微 / OasisMind** 为准。

---

## 项目简介

见微是一个**单用户、本地优先**的智能知识管理与博客平台，定位为「以 Markdown 为原子、AI 为引擎的数字花园」。

它把博客、AI 对话和自主 Agent 收拢在同一张桌面：文章以本地 Markdown 文件为唯一事实源，SQLite 只作查询与缓存层；Agent 不仅能聊天，还能读文章、调技能、记记忆、跑工作流，并通过三层 Swarm 层级自主协作。所有数据落盘在你自己的机器上，Git 可跟踪、可离线编辑，没有云端锁定。

> 本文件面向新接触项目的开发者。背景与规范另见 [`AGENTS.md`](AGENTS.md)、[`MIGRATION_PLAN.md`](MIGRATION_PLAN.md)、[`docs/development/`](docs/development/)。

---

## 核心能力

| 能力 | 说明 |
|------|------|
| <img src="docs/assets/icons/markdown.svg" width="18" align="absmiddle" alt=""> **Markdown 原生** | 文章以 `.md` 文件为单一事实来源，Git 可跟踪。支持 GFM、代码高亮、数学公式、HTML 嵌入、脚注。Milkdown 所见即所得编辑；图片按文章稳定 id 分目录（`content/uploads/{garden}/{postId}/`，草稿走 `_draft/{draftKey}`），改 slug 不断链；上传先占位再替换。 |
| <img src="docs/assets/icons/ai.svg" width="18" align="absmiddle" alt=""> **AI 核心** | Agent、Skill、MCP Server、Memory、Prompt 全部内置。ReAct + SSE 流式 `/chat`，思考时间线、工具同步/异步标识；三段式 auto-compact（micro → memory flush → macro），`/compact` 与侧栏按钮经 Agent `session_compact` 统一执行。编辑器选区可一键润色 / 精简 / 扩写（Canvas 式改写）。支持本地推理：Ollama / llama.cpp / LM Studio / vLLM（OpenAI 兼容，会话模型 id 形如 `ollama/llama3.2`）。 |
| <img src="docs/assets/icons/sparkles.svg" width="18" align="absmiddle" alt=""> **Swarm 三层 Agent** | 超级 / 管理 / 子 Agent 三层层级，权限硬拦截、Agent 间消息总线、心跳自主运行、`spawn_subagent` 异步派生与 `report_back`。 |
| <img src="docs/assets/icons/palette.svg" width="18" align="absmiddle" alt=""> **莫兰迪星河设计** | 暖灰莫兰迪色系 + 玻璃拟态 + Three.js 星空 Hero + Bento 网格。100 个几何 SVG Agent 头像按 id 稳定分配，深浅主题切换。 |
| <img src="docs/assets/icons/database.svg" width="18" align="absmiddle" alt=""> **本地优先** | 内容先落盘到本地文件，再同步到 SQLite。~22 Service CRUD + 管理页，Markdown ↔ SQLite 双向写回，`db:sync` 支持 `--watch`。 |
| <img src="docs/assets/icons/wrench.svg" width="18" align="absmiddle" alt=""> **自动化流** | Trigger 事件触发 + Approval 审批拦截 + Agent Loop。异步任务队列 `async_task_run/status`，后台运行结果自动回流对话。 |
| <img src="docs/assets/icons/map.svg" width="18" align="absmiddle" alt=""> **全局搜索与相关笔记** | FTS5 全文索引 `search.global`，跨文章 / Agent / Skill / Memory / Prompt 统一检索。阅读页 `post.related` 按全文 / 标签 / 花园 / 分类综合推荐邻近笔记。 |
| <img src="docs/assets/icons/folder.svg" width="18" align="absmiddle" alt=""> **对话落库与派工可见** | Chat 助手消息可一键写入知识库（新建 / 覆盖 / 追加，正文以服务端 `messageId` 为准）。中栏派工条展示进行中 / 待消费 / 同步子任务，可跳转子会话与取消。 |
| <img src="docs/assets/icons/hourglass.svg" width="18" align="absmiddle" alt=""> **可选鉴权与部署** | `AUTH_MODE=none/password` 本地或远程部署。Docker + CI + `db:backup` 一键备份。 |

---

## 快速开始

### 环境要求

- Node.js 20+
- pnpm（包管理器，monorepo `workspace:*` 协议）

### 安装与启动

```bash
# 1. 克隆仓库
git clone <repository-url>
cd OasisMind   # 或本地目录名 KnowPilot（过渡期）

# 2. 安装依赖
pnpm install

# 3. 一键补齐开发 .env（CREDENTIAL_MASTER_KEY / EMAIL_PROVIDER=none 等，不覆盖已有值）
pnpm setup:dev

# 4. 同步 Markdown 文章到 SQLite
pnpm db:sync

# 5. 启动开发服务（并行启动 server + web）
pnpm dev
# 已有库、想跳过全量 sync：pnpm dev:quick
```

- 前端：<http://localhost:3000>
- 后端：<http://localhost:3010>
- tRPC 端点：<http://localhost:3010/api/trpc>

### 环境变量

复制 `.env.example` 为 `.env`，按需配置：

```env
# 后端端口（默认 3010）
SERVER_PORT=3010

# SQLite 数据库路径
DATABASE_URL="file:./dev.db"

# 凭据加密主密钥（AES-256-GCM 加密 Credential 表）
# 生成：node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
CREDENTIAL_MASTER_KEY=

# LLM API Key（云端至少一个；或改用下方本地后端）
DEEPSEEK_API_KEY=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=

# 本地模型（可选；无需真实 Key，Chat 菜单「本地模型」可探测）
# LLM_DEFAULT_PROVIDER=ollama
# DEFAULT_LLM_MODEL=ollama/llama3.2
# OLLAMA_BASE_URL=http://127.0.0.1:11434/v1

# 可选鉴权：none（默认，本地）/ password（远程部署）
AUTH_MODE=none
```

> `CREDENTIAL_MASTER_KEY` 是凭据库的加密主密钥，不是 LLM API Key。开发模式不设则凭据明文落库（启动告警）；生产模式必须配置，否则拒绝启动。丢失后已加密凭据无法解密。

### 常用命令

```bash
pnpm dev            # 同步文章 + 并行启动 server / web
pnpm dev:web        # 单独启动前端
pnpm dev:server     # 单独启动后端
pnpm dev:ngrok      # ngrok 固定域名隧道 + dev（邮件 webhook 自动注册，见下文「远程访问与邮件 webhook」）

pnpm db:sync        # content/ → SQLite 同步（支持 --watch）
pnpm db:backup      # dev.db 备份到 backups/
pnpm db:migrate     # Prisma migrate dev
pnpm db:studio      # 打开 Prisma Studio

pnpm lint           # 全仓 lint（server/shared 用 tsc，web 用 eslint）
pnpm test           # Vitest 全 package
pnpm test:e2e       # Playwright E2E（web:3002 + server:3010）
pnpm build          # Next.js 生产构建
pnpm validate       # lint → test → build → e2e 一键验收
```

---

## 技术栈

| 层级 | 技术 |
|---|---|
| 语言 / 运行时 | TypeScript 5.8、Node.js（server 通过 `tsx` 运行） |
| 包管理 | pnpm monorepo（`workspace:*`） |
| 前端 | Next.js 16 + React 19（App Router） |
| 样式 | Tailwind CSS 4 + shadcn/ui + `@tailwindcss/typography` + Framer Motion + Three.js |
| 编辑器 | Milkdown 7（Markdown WYSIWYG） |
| 通信 | tRPC 11 + `@trpc/react-query` + superjson |
| 数据获取 | TanStack React Query 5 |
| 后端 | Express 5 + CORS |
| ORM / 数据库 | Prisma 6 + SQLite |
| 校验 / 共享类型 | Zod 3，集中定义在 `packages/shared` |
| 测试 | Vitest 3（server / shared / web）+ Playwright（web Chat E2E） |

---

## 项目结构

```text
OasisMind/                  # 产品名见微；本地目录或仍叫 KnowPilot
├── apps/
│   ├── web/                 # Next.js 16 前端（App Router）
│   └── server/              # Express + tRPC + Prisma 后端
│       ├── prisma/schema.prisma   # ~30 model（业务实体 + 支撑表）
│       └── src/
│           ├── router.ts          # AppRouter 纯聚合（域路由 → infra/trpcRouters/）
│           ├── services.ts        # BaseService / FileSync 基座（实体 → infra/entityServices/）
│           └── infra/             # entityServices / trpcRouters / agentTools /
│                                 # agentStream / sessionStreamHub / heartbeatEngine /
│                                 # swarmBus / asyncJobManager / uiStateNotify ...
├── packages/
│   └── shared/              # 前后端共享 Zod schema + TS 类型 + 常量
├── content/                 # 纯知识库事实源（Git 跟踪）
│   ├── {gardenId}/          # 动态花园（posts 等）
│   ├── about/               # About Me
│   └── uploads/             # 上传文件
├── config/                  # Agent 配置事实源（agents/skills/memories/prompts/mcp/tasks/…）
├── data/                    # 运行时产物（gitignore，可重建）
├── docs/
│   ├── development/        # L1-L5 阶段开发文档与 API 规范
│   ├── assets/             # logo / banner / UIH 等品牌素材
│   └── surveys-2026/       # 2026 记忆 / Harness / Agent 综述与对比分析
├── config.yaml              # 运行时业务参数（stream / compact 等）
└── README.md                # 本文件
```

> 项目遵循「单出口 + 叶子拆分」：根 `router.ts` / `services.ts` 只聚合或保留基座；域逻辑在 `infra/trpcRouters/` 与 `infra/entityServices/`。前端 React Query hooks 仍收拢 `lib/hooks.ts`，通用 UI 收拢 `components/shared.tsx`。禁止平行第二套 `services/`、`trpc/routers/`、`hooks/`、`components/shared/` 树。

---

## 架构亮点

### 本地优先：Markdown 是事实源，SQLite 是缓存

文章、Agent、Skill、Memory、Prompt 等内容首先以本地 Markdown/YAML 文件存在，受 Git 跟踪；`pnpm db:sync` 把它们 upsert 到 SQLite 作为查询与缓存层。`create` / `update` / `delete` 会同步写回 `content/` 文件。数据永远属于你。

### Swarm：三层 Agent 层级 + 心跳自主运行

| 层级 | tier | 权限 | 说明 |
|---|---|---|---|
| 超级 Agent | `super` | 全局 CRUD + 跨 Workspace | 首次启动自动创建，心跳自主运行 |
| 管理 Agent | `manager` | Workspace 内 CRUD 子 Agent | 每个 Workspace 一个，自动创建主 session |
| 子 Agent | `sub` | 执行任务 + report_back | 由管理 Agent 或用户创建 |

权限硬拦截（`swarmPermissionGuard`）、Agent 间消息总线（`swarmBus`）、node-cron 心跳引擎、向上发消息时机与 depth 防循环都在 `infra/` 内闭环。

### Chat 状态架构：三层 Store + 不变量

为根治聊天界面「闪烁 / 错位 / 需刷新」的整类 bug，前端采用三层 Store 设计并显式声明不变量：

- **MessageStore** — 持久化消息的唯一事实源（DB 驱动，经 SSE `message_upserted` 更新）
- **StreamLifecycle** — 显式状态机（`idle → streaming → done → idle`）管理流式 UI
- **Compose Store** — 瞬态 UI（输入队列、乐观气泡、异步任务覆盖层）

七条不变量（INV-1 ~ INV-7）覆盖流提交、渲染单一所有权、挂接进度一致性、消息持久化广播一致性、切会话即对账等。详见 [`docs/development/chat-state-architecture.md`](docs/development/chat-state-architecture.md)。

### Auto-Compact：摘要单源，防重复暴露

对标 Claude Code 的 `compact_boundary` + `getMessagesAfterCompactBoundary` 实践，压缩后摘要**只经一条路径**进入 LLM：

| 存储 / 通道 | 作用 |
|---|---|
| `ChatSession.contextSummary` | 摘要唯一权威源 |
| `maybeCompactMessages` | 每轮最多注入一份摘要 + 最近消息 |
| 边界消息 `__context_compact__` | UI 时间线与元数据，**不含**完整摘要正文 |
| `session_compact` 工具返回值 | 仅 `success` / 条数，**无** `summaryPreview` |
| Agent 确认回复 | 代码层强制「压缩已完成」，禁止复述摘要 |

手动压缩：`/compact`、侧栏「立即压缩」→ 普通用户消息 → Agent → `session_compact`。程序化调用可走 tRPC `session.compact`（`aiReadable`，不经 Agent 回合）。详见 [`docs/development/开发心路历程.md`](docs/development/开发心路历程.md) 与 [`docs/surveys-2026/对比分析-记忆-Harness-Agent.md`](docs/surveys-2026/对比分析-记忆-Harness-Agent.md)。

### 100 个几何 SVG Agent 头像

每个 Agent 按 cuid 稳定哈希到 100 个预设之一（20 套莫兰迪配色 × 5 种几何 motif），纯 SVG 渲染、零图片资源、任意尺寸清晰。见 [`apps/web/components/agentAvatar.tsx`](apps/web/components/agentAvatar.tsx)。

---

## 当前状态

L1 ~ L5 已全部落地，项目处于**功能完备、持续打磨**阶段。近期完成的重点：

- **数字花园体验（完整版）**：附件按 `uploads/{garden}/{slug}/` 分目录；Milkdown 上传占位；编辑器选区 AI 润色 / 精简 / 扩写；阅读页相关笔记（`post.related`）；Chat → 知识库落库（`post.createFromChat` 新建 / 覆盖 / 追加）；中栏派工条（进行中 / 待消费 / 同步子任务）
- **本地推理**：Ollama / llama.cpp / LM Studio / vLLM（OpenAI 兼容）；Chat 模型菜单「本地模型」动态探测；会话 id 形如 `ollama/llama3.2`
- **工程纪律**：Chat Store 不变量有 Vitest 锁定（`chatStoreInvariants.test.ts`）；实验模块时间盒见 [`docs/development/experiments.md`](docs/development/experiments.md)；`pnpm setup:dev` 降低换机摩擦
- **v8 ~ v10**：全局任务池、投递可靠性、可重入与续跑
- **W1 ~ W16**：会话树、心跳决策层、审批 scope、context 钩子、compaction 切割、stream 内核不变量、Web Chat store 不变量
- **Chat UI**：Kimi 风格模型菜单、思考时间线、回到底部按钮、刷新不丢回复
- **记忆系统**：三层 scope（global / workspace / agent）、按类型差异化衰减、被调用重置衰减
- **审批与邮件**：审批 scope、邮件通知、AgentMail webhook 支持邮件回复审批 / ask_user

详细变更记录见 [`AGENTS.md`](AGENTS.md) 的「当前状态与近期变更」节。

---

## 路线图

项目已完成 L1 ~ L5 全部阶段：

| 阶段 | 主题 | 状态 |
|---|---|---|
| **L1** | 博客基建：首页、文章、编辑器、Markdown ↔ SQLite 同步 | 已封板 |
| **L2** | AI 核心：Agent / Skill / MCP / Memory / Chat | 已完成 |
| **L3** | 内容运维：File / Git / Task / Log / Workspace | 已完成 |
| **L4** | 自动化流：Trigger / Approval / Agent Loop | 已完成 |
| **L5** | 打磨与规模化：搜索、鉴权、统计、部署 | 已完成 |

后续规划见 [`docs/development/future-features.md`](docs/development/future-features.md)。

---

## 部署

```bash
# Docker 一键起
docker compose up --build

# 生产构建前先同步
pnpm db:sync && pnpm build

# 备份
pnpm db:backup    # dev.db → backups/
```

> 远程部署请设 `AUTH_MODE=password` 并增加反向代理与限流。SQLite 文件不进 Git，但 `content/posts/` 下的 Markdown 源文件受 Git 跟踪，是数据的持久化真相源。

---

## 远程访问与邮件 webhook

本地 `localhost` 不可公网访问，Agent 的「邮件回复审批 / ask_user 邮件答复」需要公网回调。项目内置两种隧道方案，**推荐 ngrok 固定域名**（免费、永久固定、一次配好不用管）。

### 方案 A：ngrok 固定域名（推荐）

**前提**：ngrok 免费账号 + 一个 dev domain（永久固定，不花钱）。

```bash
# 1. 装 ngrok
winget install --id Ngrok.Ngrok            # Windows
# 或 brew install ngrok / snap install ngrok

# 2. 注册免费账号 + 领固定域名
#    https://dashboard.ngrok.com/signup        注册
#    https://dashboard.ngrok.com/get-started/your-authtoken   复制 authtoken
#    https://dashboard.ngrok.com/domains       点 Claim domain 领一个 xxx.ngrok-free.dev

# 3. 配 authtoken（一次性）
ngrok config add-authtoken <你的-authtoken>

# 4. 在 .env 写两行（一次性）
#    NGROK_DOMAIN=xxx.ngrok-free.dev
#    PUBLIC_URL=https://xxx.ngrok-free.dev

# 5. 以后每次开发只需一条命令
pnpm dev:ngrok          # 自动：ngrok 起固定域名 → dev 起 server+web → server 自动注册 AgentMail webhook
pnpm dev:ngrok:quick    # 跳过 db:sync
```

启动后日志会打印：
```
📧 [AgentMail] inbox ready: yourname@agentmail.to
[AgentMail] webhook 已注册: https://xxx.ngrok-free.dev/api/webhooks/agentmail
✅ 开发环境已就绪
```

之后 Agent 触发 ask_user（邮件通道）或审批时，用户回复邮件 → AgentMail 回调公网域名 → ngrok 转发到本地 → 注入回复给 Agent。**每次同一个 URL，webhook 永久有效，不用每次管。**

> ngrok 免费版浏览器访问公网域名会先显示一个警告页（点 Visit Site 进入），但 AgentMail 的 webhook 是 server-to-server POST（非浏览器），直接转发不显示警告页，不影响邮件回复接收。

### 方案 B：Cloudflare Tunnel（需 Cloudflare 账号 + 域名）

适合已有 Cloudflare 域名的用户，详见 [docs/development/cloudflare-tunnel.md](docs/development/cloudflare-tunnel.md)。

```bash
pnpm remote              # dev + 临时隧道（URL 每次重启变，不推荐用于邮件 webhook）
pnpm remote --named       # 命名隧道（需 .env 配 CLOUDFLARE_TUNNEL_TOKEN + PUBLIC_URL=固定域名）
```

临时隧道 URL 每次变，AgentMail webhook 会失效，需每次重新注册。**邮件 webhook 场景请用方案 A（ngrok 固定）或方案 B 命名隧道。**

### 邮件 webhook 工作原理

```
用户回复邮件
   ↓
AgentMail 平台收到回复
   ↓ POST https://<公网域名>/api/webhooks/agentmail
   ↓
ngrok / Cloudflare Tunnel 转发到本地 :3000
   ↓ next.config.ts rewrite /api/webhooks/agentmail → :3010
   ↓
server webhook 端点（验签 → 解析回复原文）
   ↓
审批：resolveApprovalFromMail → 注入回复原文给 Agent（Agent 自行理解意图）
ask_user：resolveAskUserFromMail → 注入答复给 Agent 续轮
```

关键：**邮件回复 = 用户输入通道，和聊天框打字等价**。Agent 收到回复全文自己理解意图，不是后端硬判断 approved/rejected。

### 必需的环境变量

| 变量 | 必需 | 说明 |
|---|---|---|
| `AGENTMAIL_API_KEY` | 是 | AgentMail 平台 API Key |
| `AGENTMAIL_INBOX_ID` | 否 | 指定 inbox（缺省自动创建） |
| `AGENTMAIL_ASK_TO` | 是 | ask_user 邮件发给谁（你的邮箱） |
| `NGROK_DOMAIN` | 方案 A | ngrok 固定域名（如 `xxx.ngrok-free.dev`） |
| `PUBLIC_URL` | 是 | 公网完整 URL（`https://xxx.ngrok-free.dev`），server 据此注册 webhook |
| `AGENTMAIL_WEBHOOK_SECRET` | 推荐 | webhook 验签密钥（未配时开发期放行并 warn） |
| `AGENTMAIL_WEBHOOK_URL` | 否 | 直接指定完整 webhook URL（优先级高于 PUBLIC_URL 派生） |

---

## 安全与敏感信息

- `.env` 被 `.gitignore` 忽略，不得提交。`.env.example` 仅含占位值。
- `CREDENTIAL_MASTER_KEY` 用于 AES-256-GCM 加密 Credential 表，丢失后已加密凭据无法解密。
- 默认 `AUTH_MODE=none` 无鉴权，仅适合本地。暴露公网必须启用鉴权。
- 用隧道把本机暴露到公网（无需开端口）：**ngrok 固定域名**（`pnpm dev:ngrok`，见上方「远程访问与邮件 webhook」）或 Cloudflare Tunnel（见 [docs/development/cloudflare-tunnel.md](docs/development/cloudflare-tunnel.md)，`pnpm remote` / `pnpm remote --named`）。
- `apps/server/prisma/dev.db` 不进 Git；数据持久化依赖 `content/` 下的 Markdown 源文件。

---

## UIH

<div align="center">
  <img src="docs/assets/uih-quote.svg" alt="UIH — 我们的征途是星辰大海，但在那之前，不妨先去码头搞点薯条。" width="100%">
  <p>
    <strong>我们的征途是星辰大海，但在那之前，不妨先去码头搞点薯条。</strong><br>
    <em>Our voyage is to the stars and the sea — but first, fries at the pier.</em>
  </p>
</div>

---

## 许可证

[MIT](LICENSE)
