<div align="center">
  <img src="docs/assets/readme-banner.svg" alt="KnowPilot" width="100%">

  <p align="center">
    <strong>智能知识管理与博客平台</strong> — 以 Markdown 为原子、AI 为引擎的本地优先数字花园。
  </p>

  <p align="center">
    <img src="https://img.shields.io/badge/Next.js-16-black?logo=next.js&logoColor=white&color=2d2a26&labelColor=b8a090" alt="Next.js 16">
    <img src="https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=white&color=2d2a26&labelColor=b8a090" alt="React 19">
    <img src="https://img.shields.io/badge/tRPC-11-2596be?logo=trpc&logoColor=white&color=2d2a26&labelColor=b8a090" alt="tRPC 11">
    <img src="https://img.shields.io/badge/Prisma-6-2d3748?logo=prisma&logoColor=white&color=2d2a26&labelColor=b8a090" alt="Prisma">
    <img src="https://img.shields.io/badge/SQLite-3-003b57?logo=sqlite&logoColor=white&color=2d2a26&labelColor=b8a090" alt="SQLite">
    <img src="https://img.shields.io/badge/Tailwind_CSS-v4-06b6d4?logo=tailwindcss&logoColor=white&color=2d2a26&labelColor=b8a090" alt="Tailwind CSS v4">
  </p>
</div>

---

## <img src="docs/assets/icons/sparkles.svg" width="24" align="absmiddle" alt=""> 核心特性

<table>
  <tr>
    <td width="50%" valign="top">
      <h3><img src="docs/assets/icons/markdown.svg" width="20" align="absmiddle" alt=""> Markdown 原生</h3>
      <p>文章以 Markdown 文件为单一事实来源，Git 可跟踪、可随时离线编辑。支持 GFM、代码高亮、数学公式、HTML 嵌入、脚注等全语法。</p>
    </td>
    <td width="50%" valign="top">
      <h3><img src="docs/assets/icons/ai.svg" width="20" align="absmiddle" alt=""> AI 核心</h3>
      <p>Agent、Skill、MCP Server、Memory、Chat Session 全部内置。让 AI 不仅能聊天，还能读文章、调技能、记记忆、执行工作流。</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3><img src="docs/assets/icons/palette.svg" width="20" align="absmiddle" alt=""> MetaBlog 星河设计</h3>
      <p>莫兰迪暖色系 + 玻璃拟态 + 星空 Hero + Bento 网格。首页采用 Three.js 星空背景与旋转星球，营造沉浸式知识宇宙。</p>
    </td>
    <td width="50%" valign="top">
      <h3><img src="docs/assets/icons/database.svg" width="20" align="absmiddle" alt=""> 本地优先</h3>
      <p>内容首先落盘到本地文件，再同步到 SQLite。数据永远属于你，无需担心云端锁定或网络波动。</p>
    </td>
  </tr>
</table>

---

## <img src="docs/assets/icons/rocket.svg" width="24" align="absmiddle" alt=""> 快速开始

```bash
# 1. 安装依赖
pnpm install

# 2. 同步 Markdown 文章到 SQLite
pnpm db:sync

# 3. 启动开发服务
pnpm dev
```

- 前端：`http://localhost:3000`
- 后端：`http://localhost:3010`
- tRPC 端点：`http://localhost:3010/api/trpc`

### 测试与验收

```bash
pnpm lint          # 全仓 lint（0 error）
pnpm test          # Vitest：88 passed / 3 skipped
pnpm build         # Next.js 生产构建
pnpm test:e2e      # Playwright：26 passed（web:3002 + server:3010）
pnpm validate      # 以上四步一键验收
pnpm db:backup     # SQLite 备份到 backups/
```

---

## <img src="docs/assets/icons/wrench.svg" width="24" align="absmiddle" alt=""> 技术栈

| 层级 | 技术 |
|---|---|
| 前端 | Next.js 16 + React 19 + Tailwind CSS 4 |
| 动画 | Framer Motion + Three.js |
| 编辑器 | Milkdown (Markdown WYSIWYG) |
| 通信 | tRPC 11（端到端类型安全） |
| 数据库 | SQLite + Prisma 6 |
| 状态 | React Query + Zustand |
| 测试 | Vitest + React Testing Library + Playwright |

---

## <img src="docs/assets/icons/folder.svg" width="24" align="absmiddle" alt=""> 项目结构

```text
KnowPilot/
├── apps/
│   ├── web/                  # Next.js 16 前端
│   └── server/               # Express + tRPC 后端
├── packages/
│   └── shared/               # 前后端共享类型和 Zod schema
├── content/
│   ├── posts/                # 文章 Markdown 源文件
│   ├── agents/               # Agent 配置（占位）
│   ├── skills/               # Skill 配置（占位）
│   ├── memories/             # 记忆配置（占位）
│   ├── tasks/                # 任务配置（占位）
│   └── mcp/                  # MCP Server 配置（YAML + sync）
├── docs/development/         # L1-L5 分阶段开发文档
├── docker-compose.yml        # 可选：PostgreSQL 等外部服务
└── README.md                 # 本文件
```

---

## <img src="docs/assets/icons/map.svg" width="24" align="absmiddle" alt=""> 路线图

项目按 **L1 ~ L5** 五个阶段演进，详细设计见 [`docs/development/`](docs/development/)。

| 阶段 | 主题 | 状态 |
|---|---|---|
| **L1** | 博客基建：首页、文章、编辑器、Markdown ↔ SQLite 同步 | <img src="docs/assets/icons/rocket.svg" width="16" align="absmiddle" alt=""> 已封板 |
| **L2** | AI 核心：Agent / Skill / MCP / Memory / Chat | <img src="docs/assets/icons/rocket.svg" width="16" align="absmiddle" alt=""> 已完成 |
| **L3** | 内容运维：File / Git / Task / Log / Workspace | <img src="docs/assets/icons/rocket.svg" width="16" align="absmiddle" alt=""> 已完成 |
| **L4** | 自动化流：Trigger / Approval / Agent Loop | <img src="docs/assets/icons/rocket.svg" width="16" align="absmiddle" alt=""> 已完成 |
| **L5** | 打磨与规模化：搜索、鉴权、统计、部署 | <img src="docs/assets/icons/rocket.svg" width="16" align="absmiddle" alt=""> 已完成 |

---

## 📄 许可证

[MIT](LICENSE)
