# KnowPilot

> 智能知识管理与博客平台 — Next.js + React + tRPC + PostgreSQL

## 快速开始

```bash
# 1. 安装依赖
pnpm install

# 2. 启动 PostgreSQL (需要 Docker)
docker compose up -d

# 3. 初始化数据库
pnpm db:migrate

# 4. 启动开发服务
pnpm dev
```

前端: http://localhost:3000
后端: http://localhost:3010

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Next.js 15 + React 19 + Tailwind CSS 4 |
| 组件 | shadcn/ui + Framer Motion |
| 编辑器 | Milkdown (Markdown WYSIWYG) |
| 通信 | tRPC 11 (端到端类型安全) |
| 数据库 | PostgreSQL 16 + Prisma 6 |
| 状态 | Zustand 5 |
| 测试 | Vitest + React Testing Library + Playwright |

## 项目结构

```
KnowPilot/
├── apps/web/          # Next.js 前端
├── apps/server/       # Express + tRPC 后端
├── packages/shared/   # 前后端共享类型和 schema
└── docker-compose.yml # PostgreSQL 本地开发
```
