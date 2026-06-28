# 实体总览矩阵

> 快速查阅每个实体的「后端 API / 前端调用 / 内容目录 / 同步策略 / AI 调用 / 当前状态」。

---

| 实体 | 后端 CRUD | 前端调用 | 内容目录 | 同步方式 | AI 可读 | 当前状态 |
|---|---|---|---|---|---|---|
| **Post** | [已完成] create/read/list/update/delete/search | [已完成] 全部使用 | `content/posts/` | 双向同步 | [已完成] | L1 已完成 |
| **Agent** | [已完成] CRUD + list | [未实现] 未使用 | `content/agents/` | 待实现 | [已完成] 待暴露 | L2 待做 |
| **Skill** | [已完成] CRUD + list | [未实现] 未使用 | `content/skills/` | 待实现 | [已完成] 待暴露 | L2 待做 |
| **McpServer** | [已完成] CRUD + list | [未实现] 未使用 | `content/mcp/` | 待实现 | [已完成] 待暴露 | L2 待做 |
| **Memory** | [已完成] CRUD + list | [未实现] 未使用 | `content/memories/` | 待实现 | [已完成] 待暴露 | L2 待做 |
| **ChatSession** | [已完成] CRUD + list | [未实现] 未使用 | 无 | 仅数据库 | [已完成] 待暴露 | L2 待做 |
| **ChatMessage** | [已完成] CRUD + list | [未实现] 未使用 | 无 | 仅数据库 | [已完成] 待暴露 | L2 待做 |
| **File** | [已完成] CRUD + list | [未实现] 未使用 | 磁盘 + DB | 上传接口待实现 | [已完成] 待暴露 | L3 待做 |
| **GitRepo** | [已完成] CRUD + list | [未实现] 未使用 | 磁盘 + DB | 仅元数据 | [已完成] 待暴露 | L3 待做 |
| **Task** | [已完成] CRUD + list | [未实现] 未使用 | `content/tasks/` | 待实现 | [已完成] 待暴露 | L3 待做 |
| **Log** | [已完成] CRUD + list + clearAll | [未实现] 未使用 | 无 | 仅数据库 | [注意] 敏感 | L3 待做 |
| **Workspace** | [已完成] CRUD + list | [未实现] 未使用 | 无 | 仅数据库 | [已完成] 待暴露 | L3 待做 |
| **Trigger** | [已完成] CRUD + list | [未实现] 未使用 | 无 | 仅数据库 | [已完成] 待暴露 | L4 待做 |
| **Approval** | [已完成] CRUD + list | [未实现] 未使用 | 无 | 仅数据库 | [注意] 仅读 | L4 待做 |

---

## 字段速查

### Post

```ts
id, title, slug, content, excerpt?, coverImage?, published, category?, tags, viewCount, metadata?, createdAt, updatedAt
```

### Agent

```ts
id, name, description?, model, systemPrompt, tools, createdAt, updatedAt
```

### Skill

```ts
id, name, description, code, icon?, trigger?, enabled, createdAt, updatedAt
```

### McpServer

```ts
id, name, command, args?, env?, enabled, createdAt, updatedAt
```

### Memory

```ts
id, content, type, strength, keywords, createdAt, updatedAt
```

### ChatSession

```ts
id, title, model, systemPrompt?, createdAt, updatedAt
```

### ChatMessage

```ts
id, sessionId, role, content, toolCalls?, toolResults?, tokenUsage?, createdAt
```

### File

```ts
id, name, path, mimeType, size, url, createdAt
```

### GitRepo

```ts
id, name, path, branch, remoteUrl?, createdAt, updatedAt
```

### Task

```ts
id, name, type, status, input?, output?, cronExpression?, createdAt, updatedAt
```

### Log

```ts
id, level, component, event, message, metadata?, createdAt
```

### Workspace

```ts
id, name, description?, path, createdAt, updatedAt
```

### Trigger

```ts
id, name, type, source, actionType, actionId, enabled, createdAt, updatedAt
```

### Approval

```ts
id, toolName, args, status, createdAt, updatedAt
```
