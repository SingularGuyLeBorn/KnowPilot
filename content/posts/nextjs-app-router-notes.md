---
title: "Next.js App Router 学习笔记"
category: "技术"
tags: ["Next.js", "React"]
published: false
excerpt: "Next.js App Router 的核心概念和使用方式。"
---
# Next.js App Router 学习笔记

## Server Components

React Server Components 是 Next.js 13+ 的默认模式。

```tsx
// app/page.tsx — 默认是 Server Component
export default async function Page() {
  const data = await fetchData(); // 直接在服务端获取数据
  return <div>{data.title}</div>;
}
```

## Client Components

需要交互的组件用 `"use client"` 标记。

```tsx
"use client";
import { useState } from "react";

export function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
}
```

## 路由

基于文件系统的路由，目录结构即路由结构。

这篇是草稿，还在完善中...
