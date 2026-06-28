# L5：打磨与规模化

> 目标：让 KnowPilot 更快、更稳、更安全、更可部署。

---

## 模块清单

| 模块 | 实体 | 状态 |
|---|---|---|
| L5-M01 全局搜索 | `SearchIndex` | [待开始] 未开始 |
| L5-M02 统计与看板 | `Analytics` | [待开始] 未开始 |
| L5-M03 用户与鉴权 | `User` | [待开始] 未开始 |
| L5-M04 部署与备份 | 配置 | [待开始] 未开始 |
| L5-M05 测试覆盖 | 测试 | [待开始] 未开始 |
| L5-M06 性能优化 | 配置 | [待开始] 未开始 |

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

- 本地模式：保留 single-user，无登录。
- 在线模式：NextAuth / Clerk + JWT。

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
- `dev.db` 定期导出到 `backups/`。

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

- 图片懒加载、WebP 转换。
- tRPC 查询缓存（React Query）。
- Markdown 编译缓存。
- 大数据集分页 / 虚拟列表。

---

## L5 验收标准

- [ ] 全局搜索在 200ms 内返回结果。
- [ ] 看板展示关键指标。
- [ ] 可选登录模式不影响本地单用户模式。
- [ ] Docker 镜像可一键构建运行。
- [ ] 核心流程有测试覆盖。
