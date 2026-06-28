# 实体同步策略

> 哪些实体用 Markdown/YAML 文件做源？哪些只放数据库？如何双向同步？

---

## 1. 实体分类

### 1.1 文本化实体（Git 跟踪 + 数据库缓存）

适合人类编辑、版本控制、AI 读取的实体：

| 实体 | 目录 | 文件格式 | 说明 |
|---|---|---|---|
| Post | `content/posts/` | `.md` + frontmatter | [已完成] |
| Agent | `content/agents/` | `.md` + frontmatter + 正文 systemPrompt | [已完成] |
| Skill | `content/skills/` | `.md` + frontmatter + 正文 code | [已完成] |
| Memory | `content/memories/` | `.md` + frontmatter | [已完成] |
| Prompt | `content/prompts/` | `.md` + frontmatter + 正文 content | [已完成] |
| McpServer | `content/mcp/` | `.yaml` / `.yml` | [已完成] |
| Task | `content/tasks/` | `.json` | [已完成] sync 脚本 + TaskScheduler |

### 1.2 运行时实体（仅数据库）

频繁变化、不适合文本化的实体：

| 实体 | 存储 | 说明 |
|---|---|---|
| ChatSession | SQLite | 聊天会话，动态产生 |
| ChatMessage | SQLite | 消息记录，量大且实时 |
| File | SQLite + 磁盘 | 元数据在 DB，实际文件在 `content/uploads/` |
| Log | SQLite | 日志只增不改，定期归档 |
| GitRepo | SQLite | 仓库元数据，真实仓库在磁盘 |
| Workspace | SQLite | 工作区配置 |
| Trigger | SQLite | 触发器规则 |
| Approval | SQLite | 审批记录 |
| Tool / Run / Credential | SQLite | 运行时与敏感数据 |

---

## 2. 文件格式规范

### 2.1 Agent 示例 `content/agents/coder.md`

```markdown
---
name: coder
description: 擅长写 TypeScript 和 React 的编程助手
model: claude-sonnet-4
tools:
  - skill:refactor
  - skill:explain
---

你是一个严谨的资深前端工程师...
```

### 2.2 Skill 示例 `content/skills/refactor.md`

```markdown
---
name: refactor
description: 重构代码并返回优化建议
icon: Wand2
trigger: "@refactor"
enabled: true
---

// TypeScript function body or LLM prompt template
```

### 2.3 MCP Server 示例 `content/mcp/filesystem.yaml`

```yaml
name: filesystem
command: npx
args:
  - "-y"
  - "@modelcontextprotocol/server-filesystem"
  - "D:\\ALL IN AI\\KnowPilot"
env: {}
enabled: true
```

### 2.4 Memory 示例 `content/memories/user-preference.md`

```markdown
---
content: 用户喜欢用中文交流，偏好莫兰迪色系
type: preference
strength: 0.9
keywords:
  - language
  - theme
---
```

### 2.5 Task 示例 `content/tasks/daily-sync.json`（已接入 `taskSyncer`）

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

实现位置：`apps/server/src/scripts/sync.ts` + `scripts/sync/sync-*.ts`。

### 3.1 已注册同步器

| 同步器 | 源目录 |
|---|---|
| `postSyncer` | `content/posts/` |
| `agentSyncer` | `content/agents/` |
| `skillSyncer` | `content/skills/` |
| `mcpServerSyncer` | `content/mcp/` |
| `memorySyncer` | `content/memories/` |
| `promptSyncer` | `content/prompts/` |
| `taskSyncer` | `content/tasks/`（JSON） |

支持 `pnpm db:sync --watch` 监听文件变更（chokidar）。

### 3.2 职责

1. 扫描 `content/{entity}/` 下所有有效文件。
2. 解析并校验 Markdown / YAML frontmatter。
3. 通过 Prisma upsert 写入数据库（增量：比较 `mtime`）。
4. 删除数据库中本地已经不存在的记录（Git 真实性）。
5. 输出同步报告：扫描、同步、清理条数。

### 3.3 错误报告示例

```text
🔄 开始同步本地内容文件至数据库...

📂 [Post] 源目录: .../content/posts
  📊 扫描 12 条，同步 2 条，清理 0 条

📂 [Agent] 源目录: .../content/agents
  ⚠️ 目录不存在，跳过

🎉 内容同步完成！
```

---

## 4. 双向写回规则

对文本化实体，前端调用 `create` / `update` / `delete` 时，后端 `ContentBackedService`（`services.ts`）必须同时写回文件：

| 操作 | 数据库 | 本地文件 | 备注 |
|---|---|---|---|
| create | insert | 写入新文件 | 文件名用 slug / name |
| update | update | 覆盖原文件 | 若 name 变更则重命名文件 |
| delete | delete | 删除文件 | 级联处理需确认 |

### 4.1 name 变更处理

如果 Agent 的 slug 从 `coder` 改成 `coder-v2`，后端应：

1. 数据库更新记录。
2. 删除 `content/agents/coder.md`。
3. 创建 `content/agents/coder-v2.md`。

---

## 5. 目前实现状态

- [已完成] **Post**：双向同步 + sync 脚本 + `--watch`。
- [已完成] **Agent / Skill / Memory / Prompt**：双向写回 + sync 脚本。
- [已完成] **McpServer**：双向写回 + sync 脚本（YAML 格式）。
- [已完成] **Task**：`content/tasks/*.json` 单向 sync + TaskScheduler cron 注册。
- [不适用] 其他运行时实体：无需文件同步。
