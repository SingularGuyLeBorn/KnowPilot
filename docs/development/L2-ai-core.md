# L2：AI 核心

> 目标：让 KnowPilot 从「博客」进化为「AI 知识工作台」。Agent 能读文章、调技能、记记忆、连接 MCP 服务器，并与用户聊天。

---

## 模块清单

| 模块 | 实体 | 内容目录 | 状态 |
|---|---|---|---|
| L2-M01 Agent 管理 | `Agent` | `content/agents/` | [已完成] CRUD + sync + `/agents` + seed `assistant.md` |
| L2-M02 Skill 管理 | `Skill` | `content/skills/` | [已完成] CRUD + sync + `/skills` + 版本 badge + SkillTool |
| L2-M03 MCP 服务器管理 | `McpServer` | `content/mcp/` | [已完成] CRUD + sync + `/mcp` + MCP Client |
| L2-M04 长期记忆 | `Memory` | `content/memories/` | [已完成] CRUD + sync + `/memories` + chat keyword 注入 |
| L2-M05 聊天会话 | `ChatSession` / `ChatMessage` | 仅数据库 | [已完成] `/chat`：选 Agent、tool call 折叠、错误态 |
| L2-M06 AI 工具发现 | `ai.tools` / `ai.invoke` | 无 | [已完成] 反射所有 `aiReadable` procedure |
| L2-M07 Agent 运行时 | 运行时 | 无 | [已完成] ReAct 循环 + `native:`/`skill:`/`mcp:` 统一桥接 |
| L2-M08 Prompt 模板 | `Prompt` | `content/prompts/` | [已完成] CRUD + sync + `/prompts` |

---

## L2-M01 Agent 管理

### 数据格式 `content/agents/{slug}.md`

```markdown
---
name: coder
description: 资深前端工程师
model: claude-sonnet-4
tools:
  - skill:refactor
  - skill:explain
  - mcp:filesystem
---

你是...
```

正文为 `systemPrompt`；`pnpm db:sync` 与运行时 CRUD 均支持双向写回。

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
- update 时若 slug / name 变化，需重命名本地 `.md` 文件。

---

## L2-M02 Skill 管理

### 数据格式 `content/skills/{slug}.md`

```markdown
---
name: refactor
description: 重构代码
icon: Wand2
trigger: "@refactor"
enabled: true
model: deepseek-chat          # 可选：Skill 专用模型
context: inline               # inline | fork
kind: skill                   # reference = 设计参考，默认不进 skill:*
allowed-tools:
  - native:read_file
---

// TypeScript 函数或 prompt 模板（正文为 code 字段）
```

`pnpm db:sync` 会把 frontmatter 写入 `Skill.metaJson`（model / context / allowed-tools / kind）。

### API

标准 CRUD + list，字段见 `createSkillSchema`。

### 运行方式

Agent 工具统一格式：

- `native:web_search` — 内置原生工具
- `skill:frontend-design` — 单个 Skill（function call + Chat `/` 注入双路径）
- `skill:*` — 所有已启用、非 reference 的 Skill
- `mcp:filesystem` — 连接 MCP Server 并暴露其 tools

ReAct 循环上限由 `AGENT_MAX_TOOL_ROUNDS` 控制（默认 **16**）。只读 native / Skill / MCP 读类工具并发执行，写入类串行。详见 [`backend/agent-tools.md`](backend/agent-tools.md)。

```bash
pnpm --filter @knowpilot/server exec tsx src/scripts/smoke-agent-chat.ts
pnpm --filter @knowpilot/server test   # nativeTools / agentTools / skillRunner / mcpClient
```

---

## L2-M03 MCP 服务器管理

### 数据格式 `content/mcp/{slug}.yaml`

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

### API

标准 CRUD + list。

### 运行方式

通过 MCP client 启动 stdio/sse 连接，把 MCP tool 暴露给 Agent。

---

## L2-M04 长期记忆

### 数据格式 `content/memories/{slug}.md`

```markdown
---
content: 用户偏好中文和莫兰迪色系
type: preference
strength: 0.9
keywords:
  - language
  - theme
---
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

- **三栏布局**（`/chat`）：左 Session · 中消息 · 右 `ChatSettingsPanel` + **Token 预算条**（Codex 式上下文可见性）。
- **思考时间线**：Hermes/Codex 分区；SSE `round_start` / `thinking` / `tool_*`；**禁止双气泡重复**（E2E 回归 `pnpm test:e2e`）。
- 消息操作在气泡外 hover；快捷键 Lucide + Tooltip（`ChatShortcutHints`）。
- UX 对标清单：[`frontend/agent-ux-reference.md`](frontend/agent-ux-reference.md) · E2E：[`frontend/e2e-testing.md`](frontend/e2e-testing.md)。
- 长对话 `autoCompact`（~48k 字符）；工具结果截断见 [`backend/agent-tools.md`](backend/agent-tools.md)。

### 测试

```bash
pnpm --filter @knowpilot/server test   # 工具链单元测试
pnpm test:e2e                        # Playwright + 本机 Chrome
```

---

## L2-M06 AI 工具发现

[已完成] `ai` router 已实现：

```ts
ai.tools.query()   // 反射 appRouter 中 meta.aiReadable !== false 的所有 procedure
ai.invoke.mutation({ tool: "post.list", args: { page: 1 } })
```

前端可通过 `useAIApi()`（`hooks.ts`）调用；Agent 运行时（L2-M07）已接入 LLM ReAct + SSE 流式。

---

## L2 验收标准

- [x] 可以创建/编辑/删除 Agent、Skill、MCP、Memory（管理页 + tRPC）。
- [x] 这些实体的修改能写回 `content/` 目录（Service 层 `writeFile`）。
- [x] `pnpm db:sync` 能把 Post / Agent / Skill / MCP / Memory / Prompt 同步到数据库。
- [x] 可以开始一个聊天会话，Agent 能读取 Post / Skill / Memory（`/chat` + `agent.chat` / stream）。
- [x] AI 工具发现接口可用（`ai.tools` / `ai.invoke`）。
- [x] Chat Playwright E2E（思考时间线唯一、发消息/重试）+ 管理页 19 路由冒烟 + `/about`。
