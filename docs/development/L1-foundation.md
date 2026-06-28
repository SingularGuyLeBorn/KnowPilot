# L1：博客与项目基础

> 目标：把 KnowPilot 打造成一个可用、好看、Markdown 原生、本地优先的单用户博客。
>
> **状态：已封板（2026-06-28）** — 核心博客链路、构建验收与文档已对齐。

---

## 模块清单

| 模块 | 状态 | 说明 |
|---|---|---|
| L1-M01 项目架构 | [已完成] | Next.js 16 + React 19 + tRPC 11 + Prisma + SQLite monorepo |
| L1-M02 视觉系统 | [已完成] | MetaBlog 星河版莫兰迪色系、玻璃拟态；**固定浅色主题，无主题切换 UI** |
| L1-M03 布局与导航 | [已完成] | 根 Layout 持久 Shell、Sidebar、PostTreeNav、百分比响应式布局 |
| L1-M04 首页 | [已完成] | Three.js 星空 Hero、Bento、Marquee、文章网格、CTA |
| L1-M05 文章列表 | [已完成] | `/posts` 分页、搜索、草稿筛选、列表删除 |
| L1-M06 文章详情 | [已完成] | GFM、代码高亮、KaTeX、脚注、TOC、页内搜索；自定义标签（如 ThinkingNode）安全降级 |
| L1-M07 编辑器 | [已完成] | Milkdown + 自动保存 + 手动保存 |
| L1-M08 Markdown ↔ SQLite 同步 | [已完成] | `pnpm db:sync` + 运行时双写 |
| L1-M09 文章删除 | [已完成] | 详情页与列表页均支持，含二次确认 |
| L1-M10 图片上传 | [已完成] | `file.upload`；新建/编辑页按钮、拖拽、**粘贴图片**上传 |
| L1-M11 Command Palette | [已完成] | Cmd+K：文章、分类、标签、Agent、Skill、快捷导航 |

---

## L1-M08：Markdown ↔ SQLite 同步（核心）

### 数据目录

```text
content/posts/
├── welcome-to-knowpilot.md
├── markdown-full-syntax-demo.md
└── llm-guide/
    ├── llm-guide.md          # 章节索引（非 React 组件占位）
    ├── 1-导论与基础/
    └── ...
```

### Frontmatter 规范

```yaml
---
title: "文章标题"
category: "分类"
tags:
  - "标签1"
  - "标签2"
published: true
excerpt: "一句话摘要"
---
```

### 同步流程

1. `pnpm db:sync`：扫描 `content/posts/**/*.md`，解析 frontmatter，upsert 到 `Post` 表。
2. 运行时写回：`post.create` / `post.update` / `post.delete` 同时操作 DB 和 `.md` 文件。
3. Slug 规则：相对路径去掉 `.md`，例如 `llm-guide/1-导论与基础/1-导论与基础`。

---

## L1 验收标准

- [x] 首页、列表页、详情页、编辑器页均可正常访问。
- [x] 创建/编辑/删除文章后，`content/posts/` 和数据库保持一致。
- [x] Markdown 渲染无 React 未知标签控制台报错（`llm-guide` 索引与 ThinkingNode 已处理）。
- [x] 固定莫兰迪主题与响应式布局正常（**不**提供暗色/亮色切换 UI）。
- [x] `pnpm lint`（0 error）、`pnpm --filter @knowpilot/web build`、`pnpm --filter @knowpilot/server test` 通过。

---

## 封板后边界

以下能力**不属于 L1**，在 L2+ 实现：

- Agent 对话、工具运行时、MCP 连接
- Git 操作 API、任务调度器
- 全局 FTS 搜索、用户鉴权、E2E 测试套件

详见 [`L2-ai-core.md`](L2-ai-core.md) 与 [`README.md`](README.md)。
