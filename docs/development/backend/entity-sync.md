# 实体同步策略

> 哪些实体用 Markdown/JSON 文件做源？哪些只放数据库？如何双向同步？

---

## 1. 实体分类

### 1.1 文本化实体（Git 跟踪 + 数据库缓存）

适合人类编辑、版本控制、AI 读取的实体：

| 实体 | 目录 | 文件格式 | 说明 |
|---|---|---|---|
| Post | `content/posts/` | `.md` + frontmatter | 已实现 |
| Agent | `content/agents/` | `.json` | 待实现 |
| Skill | `content/skills/` | `.json` | 待实现 |
| Memory | `content/memories/` | `.json` | 待实现 |
| Task | `content/tasks/` | `.json` | 待实现 |
| McpServer | `content/mcp/` | `.json` | 待实现 |

### 1.2 运行时实体（仅数据库）

频繁变化、不适合文本化的实体：

| 实体 | 存储 | 说明 |
|---|---|---|
| ChatSession | SQLite | 聊天会话，动态产生 |
| ChatMessage | SQLite | 消息记录，量大且实时 |
| File | SQLite + 磁盘 | 元数据在 DB，实际文件在磁盘/上传目录 |
| Log | SQLite | 日志只增不改，定期归档 |
| GitRepo | SQLite | 仓库元数据，真实仓库在磁盘 |
| Workspace | SQLite | 工作区配置 |
| Trigger | SQLite | 触发器规则 |
| Approval | SQLite | 审批记录 |

---

## 2. 文件格式规范

### 2.1 Agent 示例 `content/agents/coder.json`

```json
{
  "id": "cuid-optional",
  "name": "coder",
  "description": "擅长写 TypeScript 和 React 的编程助手",
  "model": "claude-sonnet-4",
  "systemPrompt": "你是一个严谨的资深前端工程师...",
  "tools": ["skill:refactor", "skill:explain"],
  "createdAt": "2026-06-28T00:00:00Z",
  "updatedAt": "2026-06-28T00:00:00Z"
}
```

### 2.2 Skill 示例 `content/skills/refactor.json`

```json
{
  "name": "refactor",
  "description": "重构代码并返回优化建议",
  "icon": "Wand2",
  "trigger": "@refactor",
  "enabled": true,
  "code": "// TypeScript function body or LLM prompt template"
}
```

### 2.3 MCP Server 示例 `content/mcp/filesystem.json`

```json
{
  "name": "filesystem",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "D:\\ALL IN AI\\KnowPilot"],
  "env": {},
  "enabled": true
}
```

### 2.4 Memory 示例 `content/memories/2026-06-28-preference.json`

```json
{
  "content": "用户喜欢用中文交流，偏好莫兰迪色系",
  "type": "preference",
  "strength": 0.9,
  "keywords": ["language", "theme"]
}
```

### 2.5 Task 示例 `content/tasks/daily-sync.json`

```json
{
  "name": "每日数据库备份",
  "type": "scheduled",
  "status": "active",
  "cronExpression": "0 2 * * *",
  "input": { "target": "backup" }
}
```

---

## 3. 同步脚本 `pnpm db:sync`

### 3.1 职责

1. 扫描 `content/{entity}/` 下所有有效文件。
2. 解析并校验 JSON / YAML / Markdown。
3. 通过 Prisma upsert 写入数据库。
4. 删除数据库中本地已经不存在的记录（Git 真实性）。
5. 输出同步报告：新增、更新、删除、错误。

### 3.2 错误报告示例

```text
[db:sync] 开始同步...
[posts] 12 个文件，成功 12，失败 0
[agents] 3 个文件，新增 1，更新 0，删除 0
[skills] 5 个文件，新增 0，更新 2，删除 1
ERROR: content/skills/bad.json — JSON parse failed at line 3
[db:sync] 完成
```

---

## 4. 双向写回规则

对文本化实体，前端调用 `create` / `update` / `delete` 时，后端必须同时写回文件：

| 操作 | 数据库 | 本地文件 | 备注 |
|---|---|---|---|
| create | insert | 写入新文件 | 文件名用 slug / name |
| update | update | 覆盖原文件 | 若 name 变更则重命名文件 |
| delete | delete | 删除文件 | 级联处理需确认 |

### 4.1 name 变更处理

如果 Agent 的 `name` 从 `coder` 改成 `coder-v2`，后端应：

1. 数据库更新记录。
2. 删除 `content/agents/coder.json`。
3. 创建 `content/agents/coder-v2.json`。

---

## 5. 目前实现状态

- [已完成] Post：双向同步已实现。
- [未实现] Agent / Skill / Memory / Task / MCP：只有占位目录，缺少 sync 脚本和 router 写回逻辑。
- [未实现] 其他运行时实体：无需文件同步，但部分 Router 需要完善错误处理。
