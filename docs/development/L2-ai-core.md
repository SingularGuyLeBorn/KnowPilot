# L2：AI 核心

> 目标：让 KnowPilot 从「博客」进化为「AI 知识工作台」。Agent 能读文章、调技能、记记忆、连接 MCP 服务器，并与用户聊天。

---

## 模块清单

| 模块 | 实体 | 内容目录 | 状态 |
|---|---|---|---|
| L2-M01 Agent 管理 | `Agent` | `content/agents/` | [待开始] 后端 Router 已存在，缺 sync 脚本和前端页面 |
| L2-M02 Skill 管理 | `Skill` | `content/skills/` | [待开始] 同上 |
| L2-M03 MCP 服务器管理 | `McpServer` | `content/mcp/` | [待开始] 同上 |
| L2-M04 长期记忆 | `Memory` | `content/memories/` | [待开始] 同上 |
| L2-M05 聊天会话 | `ChatSession` / `ChatMessage` | 仅数据库 | [待开始] 后端 Router 已存在，缺 UI |
| L2-M06 AI 工具发现 | `ai.tools` | 无 | [待开始] 需新增 Router |
| L2-M07 Agent 运行时 | 运行时 | 无 | [待开始] 需实现 Agent Loop |

---

## L2-M01 Agent 管理

### 数据格式 `content/agents/{name}.json`

```json
{
  "name": "coder",
  "description": "资深前端工程师",
  "model": "claude-sonnet-4",
  "systemPrompt": "你是...",
  "tools": ["skill:refactor", "skill:explain", "mcp:filesystem"],
  "createdAt": "2026-06-28T00:00:00Z",
  "updatedAt": "2026-06-28T00:00:00Z"
}
```

### API

| procedure | 输入 | 输出 |
|---|---|---|
| `agent.create` | `createAgentSchema` | Agent |
| `agent.getById` | `{ id }` | Agent + tools 展开 |
| `agent.list` | `listAgentsSchema` | Paginated<Agent> |
| `agent.update` | `updateAgentSchema` | Agent |
| `agent.delete` | `{ id }` | Agent |

### 特殊要求

- `name` 唯一。
- `tools` 数组元素格式：`skill:{name}` 或 `mcp:{name}`。
- update 时若 `name` 变化，需重命名本地 json 文件。

---

## L2-M02 Skill 管理

### 数据格式 `content/skills/{name}.json`

```json
{
  "name": "refactor",
  "description": "重构代码",
  "icon": "Wand2",
  "trigger": "@refactor",
  "enabled": true,
  "code": "// TypeScript 函数或 prompt 模板"
}
```

### API

标准 CRUD + list，字段见 `createSkillSchema`。

### 运行方式

Skill 是一段可被 Agent 调用的代码：

```ts
// 伪代码
const skill = await loadSkill("refactor");
const result = await runSkill(skill, { input: codeBlock, context: articleContext });
```

---

## L2-M03 MCP 服务器管理

### 数据格式 `content/mcp/{name}.json`

```json
{
  "name": "filesystem",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "D:\\ALL IN AI\\KnowPilot"],
  "env": {},
  "enabled": true
}
```

### API

标准 CRUD + list。

### 运行方式

通过 MCP client 启动 stdio/sse 连接，把 MCP tool 暴露给 Agent。

---

## L2-M04 长期记忆

### 数据格式 `content/memories/{timestamp}-{type}.json`

```json
{
  "content": "用户偏好中文和莫兰迪色系",
  "type": "preference",
  "strength": 0.9,
  "keywords": ["language", "theme"]
}
```

### API

标准 CRUD + list，支持按 `type` / `keyword` 过滤。

### 使用场景

Agent 在回复前读取相关记忆，提升个性化程度。

---

## L2-M05 聊天会话

### 数据模型

- `ChatSession`：会话元数据（标题、模型、系统提示）。
- `ChatMessage`：消息记录（role, content, toolCalls, toolResults, tokenUsage）。

### API

| procedure | 说明 |
|---|---|
| `session.create` | 创建会话 |
| `session.getById` | 获取会话及消息列表 |
| `session.list` | 会话列表 |
| `session.update` | 修改标题/系统提示 |
| `session.delete` | 删除会话及级联消息 |
| `message.create` | 发送消息（用户或助手） |
| `message.list` | 分页获取某会话消息 |
| `message.delete` | 删除单条消息 |

### UI

- 聊天侧边栏会话列表。
- 消息气泡支持 Markdown、代码块、工具调用折叠。

---

## L2-M06 AI 工具发现

新增 `ai` router：

```ts
ai.tools.query(() => ToolSchema[]);
ai.call.mutation(({ tool, args }) => executeTool(tool, args));
```

让 LLM 能先发现工具，再调用工具。

---

## L2 验收标准

- [ ] 可以创建/编辑/删除 Agent、Skill、MCP、Memory。
- [ ] 这些实体的修改能写回 `content/` 目录。
- [ ] `pnpm db:sync` 能把 `content/` 下这些实体同步到数据库。
- [ ] 可以开始一个聊天会话，Agent 能读取 Post / Skill / Memory。
- [ ] AI 工具发现接口可用。
