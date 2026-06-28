# L5：打磨与规模化

> 目标：让 KnowPilot 更快、更稳、更安全、更可部署。

---

## 模块清单

| 模块 | 实体 | 状态 |
|---|---|---|
| L5-M01 全局搜索 | `SearchIndex` | [完成] FTS5 + `search.global` + `/search` UI |
| L5-M02 统计与看板 | `Analytics` | [完成] `analytics.dashboard` + `/dashboard` UI |
| L5-M03 用户与鉴权 | `User` | [完成] `AUTH_MODE=password` + `/login` + `/settings` |
| L5-M04 部署与备份 | 配置 | [完成] Docker + `pnpm db:backup` |
| L5-M05 测试覆盖 | 测试 | [完成] Vitest + Playwright + GitHub Actions CI |
| L5-M06 性能优化 | 配置 | [完成] React Query 缓存 + FTS5 + Markdown LRU + 目录虚拟列表 |

---

## L5-M01 全局搜索

### 方案

- 本地：SQLite FTS5 扩展。
- 云端：可切换 Meilisearch / Algolia。

### 搜索范围

Post、Agent、Skill、Memory、Task、McpServer、ChatMessage。

### API

```ts
search.global.query({ query: string, entities?: string[], limit?: number });
```

---

## L5-M02 统计与看板

### 指标

- 文章数、字数、分类分布。
- Agent 调用次数、Token 消耗。
- 任务成功/失败率。
- 日志错误趋势。

### API

```ts
analytics.dashboard.query({ from?: Date, to?: Date });
```

---

## L5-M03 用户与鉴权

### 目标

从 single-user 升级到可选多用户 / 登录。

### 方案

- 本地模式（默认）：`AUTH_MODE=none`，无登录，与现有单用户行为一致。
- 远程模式：`AUTH_MODE=password` + `AUTH_PASSWORD`，前端 `/login` 获取 Bearer Token；SSE 与 tRPC 均校验 `Authorization` 头。
- 未来扩展：NextAuth / Clerk + JWT（多用户 `userId` 隔离）。

### 影响

- 所有 `publicProcedure` 改为 `protectedProcedure`。
- 实体增加 `userId` / `workspaceId` 隔离。

---

## L5-M04 部署与备份

### 部署

- Docker + docker-compose。
- 构建时自动 `pnpm db:sync`。
- 静态导出或 Node 运行时。

### 备份

- `content/` 目录本身就是 Git 可跟踪的备份。
- `pnpm db:backup` 将 `dev.db` 导出到 `backups/dev-YYYYMMDD-HHMMSS.db`。

---

## L5-M05 测试覆盖

### 测试类型

| 类型 | 范围 | 工具 |
|---|---|---|
| 单元测试 | sync 脚本、format 函数 | Vitest |
| 集成测试 | tRPC router | Vitest + tRPC test client |
| E2E 测试 | 前端关键流程 | Playwright |

---

## L5-M06 性能优化

- tRPC 查询缓存（React Query `staleTime: 30s`、`gcTime: 5min`）。
- Markdown 预处理 LRU 缓存（`packages/shared/src/markdownCache.ts` + PostContent）。
- Markdown 渲染图片 `loading="lazy"`（PostContent）。
- SQLite FTS5 全文索引（`search.global`）。
- 文章目录搜索模式虚拟列表（PostTreeNav + `VirtualFlatList`）。
- 各管理页服务端分页（`Pagination`）。

---

## L5 验收标准

- [x] 全局搜索在 200ms 内返回结果（`search.global` 并行查询 + `/search`）。
- [x] 看板展示关键指标（`/dashboard`）。
- [x] 可选登录模式不影响本地单用户模式（`AUTH_MODE=none` 默认）。
- [x] Docker 镜像可一键构建运行（`docker compose up --build`）。
- [x] 核心流程有测试覆盖（Vitest 88 + Playwright 26 E2E CI）。
