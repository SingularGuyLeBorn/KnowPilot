# L1：博客与项目基础

> 目标：把 KnowPilot 打造成一个可用、好看、Markdown 原生、本地优先的单用户博客。

---

## 模块清单

| 模块 | 状态 | 说明 |
|---|---|---|
| L1-M01 项目架构 | [已完成] | Next.js 16 + React 19 + tRPC 11 + Prisma + SQLite monorepo |
| L1-M02 视觉系统 | [已完成] | MetaBlog 星河版莫兰迪色系、玻璃拟态、主题切换 |
| L1-M03 布局与导航 | [已完成] | Navbar、Sidebar、百分比响应式布局 |
| L1-M04 首页 | [已完成] | Three.js 星空 Hero、Bento、Marquee、文章网格、CTA |
| L1-M05 文章列表 | [已完成] | 支持分页、分类、标签、搜索 |
| L1-M06 文章详情 | [已完成] | Markdown 全语法渲染（GFM、代码、公式、HTML、脚注） |
| L1-M07 编辑器 | [已完成] | Milkdown + 自动保存 + 手动保存 |
| L1-M08 Markdown ↔ SQLite 同步 | [已完成] | `pnpm db:sync` + 运行时双写 |
| L1-M09 文章删除 | [未实现] | 后端已实现 `post.delete`，前端缺少删除入口 |
| L1-M10 图片上传 | [未实现] | 尚未实现 |
| L1-M11 Command Palette | [未实现] | 全局 Cmd+K 搜索 |

---

## L1-M08：Markdown ↔ SQLite 同步（核心）

### 数据目录

```text
content/posts/
├── welcome-to-knowpilot.md
├── markdown-full-syntax-demo.md
├── markdown-cheat-sheet.md
├── nextjs-app-router-notes.md
└── llm-guide/
    ├── 1-导论与基础/
    │   ├── 1-导论与基础.md
    │   └── images/
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

## L1 遗留任务

### L1-M09 文章删除

- 后端：`post.delete` 已存在，接收 `{ id }`。
- 前端：在文章详情页或文章列表卡片加删除按钮，调用 `post.delete` 后刷新列表/跳转首页。
- 危险操作：建议加二次确认，L4 可接入 Approval 审批。

### L1-M10 图片上传

- 后端：新增 `file.create` 接口接收文件元数据；实际文件存 `public/uploads/` 或 `content/uploads/`。
- 前端：编辑器支持拖拽/粘贴上传，返回 `![alt](/uploads/xxx.png)`。

### L1-M11 Command Palette

- 前端：`Cmd+K` 全局搜索文章、Agent、Skill、命令。
- 后端：复用 `post.search` 和各实体 `list`。

---

## L1 验收标准

- [ ] 首页、列表页、详情页、编辑器页均可正常访问。
- [ ] 创建/编辑/删除文章后，`content/posts/` 和数据库保持一致。
- [ ] Markdown 全语法渲染无报错。
- [ ] 主题切换、响应式布局正常。
- [ ] `pnpm tsc --noEmit` 与 `pnpm build` 通过。
