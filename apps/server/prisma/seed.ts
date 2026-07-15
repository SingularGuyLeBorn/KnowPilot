/**
 * Prisma Seed — 初始化示例文章数据（SQLite）
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const samplePosts = [
  {
    title: "欢迎使用 KnowPilot",
    slug: "welcome-to-knowpilot",
    content: `# 欢迎使用 KnowPilot

KnowPilot 是一个智能知识管理与博客平台。

## 功能特点

- **Markdown 编辑器** — 基于 Milkdown 的所见即所得编辑体验
- **实时自动保存** — 编辑内容自动存入数据库，不怕断电
- **全文搜索** — Cmd+K 快速检索所有文章
- **暗色模式** — 莫兰迪色系，温暖护眼

## 代码高亮

\`\`\`typescript
const greeting = "Hello, KnowPilot!";
console.log(greeting);
\`\`\`

## 数学公式

行内公式 $E = mc^2$，块级公式：

$$
\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}
$$

开始你的知识之旅吧！
`,
    published: true,
    category: "入门",
    tags: "教程,入门", // 改为逗号分隔字符串
    excerpt: "KnowPilot 是一个智能知识管理与博客平台。",
  },
  {
    title: "Markdown 语法速查",
    slug: "markdown-cheatsheet",
    content: `# Markdown 语法速查

## 标题

使用 \`#\` 号标记标题级别。

## 强调

**粗体** 和 *斜体* 和 ~~删除线~~。

## 列表

- 无序列表项 1
- 无序列表项 2
  - 嵌套项

1. 有序列表
2. 第二项

## 引用

> 这是一段引用文字。

## 表格

| 名称 | 类型 | 描述 |
|------|------|------|
| id | string | 唯一标识 |
| title | string | 文章标题 |

## 代码块

\`\`\`python
def hello():
    print("Hello, World!")
\`\`\`

行内代码：\`const x = 42;\`
`,
    published: true,
    category: "教程",
    tags: "Markdown,语法", // 改为逗号分隔字符串
    excerpt: "常用 Markdown 语法的速查参考。",
  },
  {
    title: "Next.js App Router 学习笔记",
    slug: "nextjs-app-router-notes",
    content: `# Next.js App Router 学习笔记

## Server Components

React Server Components 是 Next.js 13+ 的默认模式。

\`\`\`tsx
// app/page.tsx — 默认是 Server Component
export default async function Page() {
  const data = await fetchData(); // 直接在服务端获取数据
  return <div>{data.title}</div>;
}
\`\`\`

## Client Components

需要交互的组件用 \`"use client"\` 标记。

\`\`\`tsx
"use client";
import { useState } from "react";

export function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
}
\`\`\`

## 路由

基于文件系统的路由，目录结构即路由结构。

这篇是草稿，还在完善中...
`,
    published: false,
    category: "技术",
    tags: "Next.js,React", // 改为逗号分隔字符串
    excerpt: "Next.js App Router 的核心概念和使用方式。",
  },
];

async function main() {
  console.log("🌱 开始播种示例数据...");

  for (const post of samplePosts) {
    await prisma.post.upsert({
      where: { slug: post.slug },
      update: post,
      create: post,
    });
    console.log(`  ✅ ${post.title}`);
  }

  console.log("🌱 播种完成！");
}

main()
  .catch((e) => {
    console.error("❌ 播种失败:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
