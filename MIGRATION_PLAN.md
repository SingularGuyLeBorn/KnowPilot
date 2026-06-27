# KnowPilot — 完整实施计划 (Markdown ↔ SQLite 同步版)

> 本文件为项目迁移与重构的终极指南，开发人员必须严格遵循此规范。
> 项目路径: `D:\ALL IN AI\KnowPilot`
> 核心原则: 单用户模式，文章采用 “Markdown 为源，SQLite 为缓存/检索层” 双向同步架构。

---

## 🎨 视觉设计系统与组件形态 (复刻 MetaBlog)

直接移植 MetaBlog 的 **“星河设计系统 · 莫兰迪色系 (Star River Design System - Morandi Palette)”**。

### 1. 颜色配比 (Morandi Palette)

```css
:root {
  /* 基础背景 — 莫兰迪温暖米白 */
  --vp-c-bg: #f8f6f3;
  --vp-c-bg-alt: #f0ede8;
  --vp-c-bg-soft: #e8e4dd;
  --vp-c-bg-mute: #e0dcd5;

  /* 文字 — 柔和对比暖黑 */
  --vp-c-text: #2d2a26;
  --vp-c-text-1: #2d2a26;
  --vp-c-text-2: #6a6560;
  --vp-c-text-3: #9a9588;

  /* 品牌色 — 莫兰迪暖棕 */
  --vp-c-brand: #b8a090;
  --vp-c-brand-1: #b8a090;
  --vp-c-brand-light: #c9b8b3;
  --vp-c-brand-dark: #a89080;
  --vp-c-brand-rgb: 184, 160, 144;
  --vp-c-brand-soft: rgba(184, 160, 144, 0.12);

  /* 分隔线 */
  --vp-c-divider: rgba(200, 195, 188, 0.35);
  --vp-c-divider-light: rgba(200, 195, 188, 0.18);
}

.dark {
  /* 背景 — 莫兰迪深灰暖调 */
  --vp-c-bg: #1a1a1a;
  --vp-c-bg-alt: #242424;
  --vp-c-bg-soft: #2d2d2d;
  --vp-c-bg-mute: #363636;

  /* 文字 — 暖灰 */
  --vp-c-text: #e0ddd8;
  --vp-c-text-1: #e0ddd8;
  --vp-c-text-2: #b0aba4;
  --vp-c-text-3: #8a8580;

  /* 品牌色 */
  --vp-c-brand: #c9b8b3;
  --vp-c-brand-1: #c9b8b3;
  --vp-c-brand-light: #d8ccc8;
  --vp-c-brand-dark: #b8a090;
  --vp-c-brand-soft: rgba(201, 184, 179, 0.15);

  /* 分隔线 */
  --vp-c-divider: rgba(255, 255, 255, 0.08);
  --vp-c-divider-light: rgba(255, 255, 255, 0.04);
}
```

### 2. 组件与交互形态

- **玻璃拟态导航与侧边栏 (Morandi Glassmorphism)**:
  - 导航栏使用：`background: rgba(248, 246, 243, 0.78)` 混合 `backdrop-blur-md`。
  - 侧边栏与面板使用：`background: var(--vp-c-bg-alt)`，结合 `border-right: 1px solid var(--vp-c-divider)`。
- **玻璃卡片 (.glass-card)**:
  - 默认状态：`background: #f8f6f3; border: 1px solid #e2e8f0; border-radius: 16px;`
  - 悬停状态：`background: #ffffff; border-color: #cbd5e1;` 产生微妙的呼吸感。
- **过渡动画 (Morandi Spring)**:
  - 使用与 MetaBlog 相同的弹簧过渡曲线 (`var(--sr-spring-gentle)`)。
  - Framer Motion 动画配置：`type: "spring", stiffness: 180, damping: 20`。
  - 悬停交互：列表项或侧边栏选项悬停时，向右或向上微移 `3px`。

---

## 💾 文章保存与 Markdown ↔ SQLite 同步机制

项目采用 **“本地 Markdown 文件作为数据源 (Git 跟踪) ➔ 编译到 SQLite ➔ 前端只读/写数据库并写回文件”** 的混合模式：

### 1. Markdown 目录与 Frontmatter 规范
文章文件存放在根目录的 `content/posts/` 下，文件名为文章的 `slug.md`。
头部属性（YAML Frontmatter）规范：
```markdown
---
title: "文章标题"
category: "分类"
tags: ["标签1", "标签2"]
published: true
excerpt: "一句话文章简要介绍。"
---
这是正文 Markdown 内容...
```

### 2. 单向编译同步 (Markdown ➔ SQLite)
运行 `pnpm db:sync` 时，后端同步脚本会执行以下流程：
1. 扫描 `content/posts/` 下的所有 `.md` 文件。
2. 使用 `gray-matter` 解析其 YAML Frontmatter 和正文。
3. 将内容写入 (Prisma Upsert) `apps/server/prisma/dev.db` 数据库。
4. **Cloudflare / 部署保障**：在 Next.js 打包阶段，此脚本会自动运行，将预编译好的 `dev.db` 一同打包上线，保证云端零延迟、安全只读访问。

### 3. 反向双写同步 (Web 编辑器 ➔ SQLite + Markdown)
在本地开发环境（Local Dev）下，当用户在网页端通过 Milkdown 编辑器修改文章并保存时：
1. 前端通过 tRPC `post.update` 将内容发送给后端。
2. 后端保存更新至 `dev.db` 数据库。
3. 后端自动在 `content/posts/` 目录下定位对应的 `[slug].md` 文件，生成对应的 Frontmatter 头部并**同步覆盖写入该 `.md` 文件**。
4. 保证本地文件与数据库永远一致。

### 4. 实时自动保存 (Auto-Save) 策略
- **本地容灾**：用户输入的每一个字在 **500ms 内节流**存入浏览器的 `LocalStorage`。
- **草稿自动同步**：用户停止输入 **2 秒后（防抖）**，自动通过 tRPC `post.update` 写入数据库及本地 md 文件（标记 `published: false`）。
- **发布同步**：按下 `Ctrl + S` 或点击发布，立即写入并标记 `published: true`。

---

## 🎯 任务优先级划分 (P0 -> P1 -> P2)

### P0: L1 纯博客基建 (最核心，先做好这个)
- **L1-T01 ~ L1-T04**: 搭建 Next.js + Express + tRPC monorepo 基础，连接 SQLite 数据库并能够通过 API 读写文章。
- **L1-T05**: **Markdown ↔ SQLite 同步编译器实现**（完成 `pnpm db:sync` 同步脚本和 Web 端的双向写回）。
- **L1-T06, L1-T09**: 实现主页面导航和文章的 Markdown 渲染（包含代码块 and 公式）。
- **L1-T10**: Milkdown 编辑器集成，跑通**实时自动保存**和**手动保存**。

### P1: 博客功能完整性
- **L1-T07, L1-T08**: 首页（莫兰迪米白 UI）、文章列表（支持筛选和搜索）。
- **L1-T11, L1-T12**: Command Palette 全局搜索（Cmd+K）与图片上传组件。

### P2: 单用户本地 AI 模块
- **L2**: AI 聊天 UI 与文章 CRUD 工具注入。

---

## 📋 L1 任务拆解与执行细节 (新增同步脚本)

### L1-T05: Markdown ↔ SQLite 同步编译器 (P0 - 新增)
- [ ] 后端引入 `gray-matter` 进行 Frontmatter 结构解析。
- [ ] 创建 `content/posts/` 目录，并将 3 篇示例种子文章转化为实体 `.md` 文件存入。
- [ ] 编写 `apps/server/src/scripts/sync.ts` 同步编译脚本：
  - 扫描本地 md 文件，解析 frontmatter。
  - 通过 Prisma 同步至 `dev.db` 数据库。
  - 如果数据库中存在某篇文章但在本地 md 文件中已被删除，自动从数据库中清除（保持 Git 真实性）。
- [ ] 修改 `post.ts` tRPC router：
  - `create` 成功时，在本地 `content/posts/` 下生成新 `.md` 文件。
  - `update` 成功时，根据 `slug` 生成 YAML Frontmatter + Markdown，同步写入对应的 `.md` 文件。
  - `delete` 成功时，删除对应的 `.md` 文件。
- [ ] 根目录 `package.json` 注册 `"db:sync": "pnpm --filter @knowpilot/server db:sync"`。

---

## 🧪 单元测试与质量保证规范

### 1. 同步编译器单元测试 (Vitest)
测试 `.md` 文件解析与数据库写入的正确性。
```typescript
// apps/server/src/scripts/sync.test.ts
import { syncMarkdownToDb } from './sync';
import { prisma } from '../db';

describe("Markdown 同步测试", () => {
  it("应该能成功解析 markdown 并 upsert 到 SQLite", async () => {
    // 写入一个模拟 md 文件 -> 跑 sync 脚本 -> 查询 Prisma 确保入库且字段解析正确
  });
});
```
