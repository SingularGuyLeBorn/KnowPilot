# 实体总览矩阵

> 快速查阅每个实体的「后端 API / 前端调用 / 内容目录 / 同步策略 / AI 调用 / 当前状态」。
> 最后与代码对齐：**2026-06-29**。

---

| 实体 | 后端 CRUD | 前端调用 | 内容目录 | 同步方式 | AI 可读 | 当前状态 |
|---|---|---|---|---|---|---|
| **Post** | [已完成] CRUD + search/tree | [已完成] 博客全链路 | `content/posts/` | 双向 + `db:sync` | [已完成] | **L1 已封板** |
| **Agent** | [已完成] CRUD + list + run/chat/stream | [已完成] `/agents` | `content/agents/` | 双向 + `db:sync`（`.md`） | [已完成] | L2 运行时 + toolSummary |
| **Skill** | [已完成] CRUD + list + skillRunner | [已完成] `/skills` | `content/skills/` | 双向 + `db:sync`（`.md`） | [已完成] | L2 SkillTool + `/` 触发 |
| **McpServer** | [已完成] CRUD + list + mcpClient | [已完成] `/mcp` | `content/mcp/` | 双向 + `db:sync`（`.yaml`） | [已完成] | L2 MCP 桥接已通 |
| **Memory** | [已完成] CRUD + list | [已完成] `/memories` | `content/memories/` | 双向 + `db:sync`（`.md`） | [已完成] | L2 管理页已完成 |
| **Prompt** | [已完成] CRUD + list | [已完成] `/prompts` | `content/prompts/` | 双向 + `db:sync`（`.md`） | [已完成] | L2 后端 + sync + UI |
| **ChatSession** | [已完成] CRUD + list | [已完成] `/chat` | 无 | 仅数据库 | [已完成] | L2 Chat 三栏 + Session 搜索 |
| **ChatMessage** | [已完成] CRUD + list + switchVersion | [已完成] `/chat` | 无 | 仅数据库 | [已完成] | L2 流式 SSE + 多版本 |
| **File** | [已完成] CRUD + list + upload | [已完成] `/files` | 磁盘 + DB | 上传写盘 | [已完成] | L3 上传链路已完成 |
| **GitRepo** | [已完成] CRUD + status/log/diff/commit | [已完成] `/git` | 磁盘 + DB | 仅元数据 | [已完成] | L3 status/log UI 已通 |
| **Task** | [已完成] CRUD + list + run | [已完成] `/tasks` | `content/tasks/` | 单向 sync（`.json`） | [已完成] | L3 TaskScheduler 已接入 |
| **Log** | [已完成] CRUD + list + clearAll | [已完成] `/logs` | 无 | 仅数据库 | [注意] 敏感 | L3 管理页已完成 |
| **Workspace** | [已完成] CRUD + list | [已完成] `/workspaces` | 无 | 仅数据库 | [已完成] | L3 管理页已完成 |
| **Trigger** | [已完成] CRUD + list | [已完成] `/triggers` | 无 | 仅数据库 | [已完成] | L4 引擎 + UI |
| **Approval** | [已完成] CRUD + list + execute | [已完成] `/approvals` | 无 | 仅数据库 | [注意] 仅读 | L4 ApprovalGate |
| **Tool** | [已完成] CRUD + list | [已完成] `/tools` | 无 | 仅数据库 | [已完成] | L4 工具注册 UI |
| **Run** | [已完成] CRUD + list | [已完成] `/runs` | 无 | 仅数据库 | [已完成] | L2 Agent 运行时记录 |
| **Credential** | [已完成] CRUD + list | [已完成] `/credentials` | 无 | 仅数据库 | [注意] 敏感 | L5 凭据 UI（值脱敏） |
| **AI 反射** | [已完成] `ai.tools` / `ai.invoke` | [已完成] `useAIApi()` | 无 | 无 | — | L2 工具发现已完成 |

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

### Prompt

```ts
id, name, description?, content, tags, createdAt, updatedAt
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

### Tool

```ts
id, name, description?, schema?, handler?, enabled, createdAt, updatedAt
```

### Run

```ts
id, agentId?, taskId?, status, input?, output?, error?, startedAt?, finishedAt?, createdAt, updatedAt
```

### Credential

```ts
id, name, type, value, createdAt, updatedAt
```
