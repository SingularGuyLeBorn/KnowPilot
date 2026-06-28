# 后端 API 设计总则

> 适用于 `apps/server/src/router.ts` 中收拢的所有实体 Router。

---

## 1. 每个实体必须具备的标准操作

除非是只读日志类实体，否则每个实体 Router 至少提供：

| 操作 | tRPC procedure | 作用 | 必备？ |
|---|---|---|---|
| 创建 | `create` | mutation | [已完成] |
| 详情 | `getById` | query | [已完成] |
| 列表 | `list` | query | [已完成] |
| 更新 | `update` | mutation | [已完成] |
| 删除 | `delete` | mutation | [已完成] |
| 搜索/运行 | `search` / `run` / `execute` | query/mutation | 按需 |

### 命名约定

- procedure 名使用 camelCase，动词开头：`create`, `getById`, `list`, `update`, `delete`。
- 不要使用 `add`, `remove`, `fetch`, `find` 等混用动词。
- 批量操作可以加后缀：`deleteMany`, `createMany`。

---

## 2. 输入输出规范

### 2.1 ID

- 所有 ID 使用 CUID（Prisma 默认）。
- `getById`, `update`, `delete` 的输入必须包含 `id: z.string().cuid()`。

### 2.2 列表分页

所有 `list` 默认支持：

```ts
{
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  keyword: z.string().optional(), // 按名称/标题/内容模糊搜索
}
```

返回统一分页结构：

```ts
{
  items: T[],
  total: number,
  page: number,
  pageSize: number,
  totalPages: number,
}
```

### 2.3 排序

列表支持 `orderBy` + `order`：

```ts
orderBy: z.enum(["createdAt", "updatedAt", "name", "title"]).default("createdAt"),
order: z.enum(["asc", "desc"]).default("desc"),
```

---

## 3. 共享 Schema 复用

所有 Zod schema 放在 `packages/shared/src/schemas.ts`。

原则：

- `createXxxSchema`：创建时必填字段用 `.default()` 或 `.optional()` 标注清楚。
- `updateXxxSchema`：必须包含 `id`，其他字段全部 optional。
- `listXxxSchema`：统一分页 + 过滤字段。

---

## 4. 数据格式化

Prisma 读取的 `Json` 字段可能是对象也可能是字符串（取决于驱动），所以每个 Router 应有一个 `formatXxx` 函数做统一转换：

```ts
function formatAgent(agent: Agent) {
  return {
    ...agent,
    tools: typeof agent.tools === "string" ? JSON.parse(agent.tools) : agent.tools,
  };
}
```

不要直接把 Prisma 原始对象返回给前端，避免 `Date` / `Json` 序列化不一致。

---

## 5. 文件/内容目录规范

适合 Markdown/JSON 化的实体，在 `content/{entity}/` 下存储：

```text
content/
├── posts/        # .md + frontmatter
├── agents/       # .json 或 .md
├── skills/       # .json 或 .md
├── memories/     # .json
├── tasks/        # .json
└── mcp/          # .json
```

具体格式在 `entity-sync.md` 和各阶段文档中定义。

---

## 6. 当前已有 Router 的整改清单

| 实体 | 已有 CRUD | 需要整改 |
|---|---|---|
| Post | [已完成] | 修复 `getBySlug` viewCount 返回旧值；增加删除 UI。 |
| Agent | [已完成] | update 需检查 `name` 唯一性。 |
| Skill | [已完成] | update 需检查 `name` 唯一性。 |
| ChatSession | [已完成] | 无 |
| ChatMessage | [已完成] | 无 |
| File | [已完成] | update schema 扩展更多字段。 |
| Log | [已完成] | update 使用共享 schema；考虑是否允许改日志。 |
| McpServer | [已完成] | update 需检查 `name` 唯一性。 |
| Memory | [已完成] | 无 |
| GitRepo | [已完成] | update 需检查 `path` 唯一性。 |
| Task | [已完成] | update schema 补齐 `type` / `input`。 |
| Workspace | [已完成] | 无（已检查唯一性） |
| Trigger | [已完成] | 无（已检查唯一性） |
| Approval | [已完成] | 无 |
