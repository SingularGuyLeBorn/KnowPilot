# Agent 工具链规范

> 统一说明 KnowPilot Agent 的 `native:` / `skill:` / `mcp:` 三类工具、执行策略、测试与 token 控制。

---

## 架构概览

```text
Agent.tools[]  →  parseAgentTools()
                      ↓
              buildAgentToolSchemas()  →  OpenAI function schemas + registry
                      ↓
              runAgentLoop / agentStream
                      ↓
              executeToolCallsBatch()  →  executeAgentTool()
                      ↓
         nativeTools | skillRunner | mcpClient
```

核心文件：

| 文件 | 职责 |
|---|---|
| `apps/server/src/infra/nativeTools.ts` | 11 个内置 native 工具 |
| `apps/server/src/infra/skillRunner.ts` | Skill 沙箱 / Prompt 模式 |
| `apps/server/src/infra/mcpClient.ts` | MCP 连接、截断、重连 |
| `apps/server/src/infra/agentTools.ts` | 解析、授权、并发批次 |
| `apps/server/src/infra/autoCompact.ts` | 长对话上下文摘要 |
| `apps/server/src/infra/agentRuntime.ts` | 非流式 ReAct |
| `apps/server/src/infra/agentStream.ts` | SSE 流式 ReAct |

---

## 工具授权格式

Agent 的 `tools` 数组每行一个引用：

| 前缀 | 示例 | 含义 |
|---|---|---|
| `native:` | `native:read_file` | 内置文件/搜索/Git/API 工具 |
| `skill:` | `skill:frontend-design` | 单个 Skill |
| `skill:` | `skill:*` | 所有已启用、非 reference 的 Skill |
| `mcp:` | `mcp:filesystem` | 连接并桥接该 MCP Server 的全部 tools |

空 `tools[]` 等价于 `native: all` + `skill:*`。

---

## Native 工具清单（11 个内置）

> **注意**：11 仅为 `nativeTools.ts` 内置数。`invoke_api` 可触达 ~100 个 `aiReadable` tRPC procedure；Skill/MCP 运行时还会展开为更多 LLM function。详见 `agent.toolSummary` API 与 Agents 管理页统计。

| 名称 | 只读 | 说明 |
|---|---|---|
| `web_search` | 是 | Tavily / SerpAPI |
| `read_file` | 是 | 读项目内文本，默认 max 12000 字符 |
| `list_directory` | 是 | 列目录 |
| `write_file` | 否 | 写项目内文件 |
| `git_status` | 是 | Git porcelain status |
| `git_log` | 是 | 最近提交 |
| `git_diff` | 是 | 工作区 diff（max 12k） |
| `yuque_get_doc` | 是 | 语雀文档（需 YUQUE_SESSION） |
| `github_search_repos` | 是 | GitHub 仓库搜索 |
| `feishu_send_text` | 否 | 飞书发消息 |
| `invoke_api` | 视 procedure | 调用 tRPC `aiReadable` 工具 |

外部名：`read_file`（无前缀）。Skill：`skill__{name}`。MCP：`mcp__{server}__{tool}`。

---

## Skill 双路径

1. **用户 `/` 路径（Chat UI）**：选中 Skill → 注入 System Prompt（会话级）
2. **模型 SkillTool**：`skill__name` function call → `executeSkill()`

Skill frontmatter（`content/skills/**/*.md`）：

```yaml
---
name: frontend-design
description: UI 设计指引
icon: Wand2
trigger: /frontend-design
enabled: true
model: deepseek-chat      # 可选
context: inline           # inline | fork（fork 待完善）
kind: skill               # reference = 设计参考文档，默认不进 skill:*
allowed-tools:
  - native:read_file
---
```

`design-references/` 下文件 sync 时默认 `kind: reference` 且 `enabled: false`。

---

## 执行策略

### 并发

- **只读 native**（web_search、read_file、list_directory）与 **Skill**、MCP 读类工具 → `Promise.all` 并发
- **写入类**（write_file、feishu 等）→ 串行

### MCP 结果截断

- 超过 `MCP_MAX_RESULT_CHARS`（12000）→ 返回 `_truncated` + preview
- 调用失败 → 断开重连并重试一次

### 上下文压缩（auto-compact）

- 对话字符估计超过 ~48k → Agent 循环前 LLM 摘要旧消息
- 保留最近 8 条，插入 `[此前对话摘要]` 块

---

## 单元测试

```bash
pnpm --filter @knowpilot/server test
```

| 测试文件 | 覆盖 |
|---|---|
| `nativeTools.test.ts` | 11 个 native 工具各一组用例 |
| `agentTools.test.ts` | 解析、授权、并发批次、Skill 注册 |
| `skillRunner.test.ts` | 沙箱、Prompt 模式、命名 |
| `mcpClient.test.ts` | 命名、截断 |
| `trpc.test.ts` | 集成含 `agent.chat` |

---

## Token 控制建议

| 层级 | 手段 | UI |
|---|---|---|
| 工具结果 | read_file / git_diff / MCP truncate 上限 | 工具 `<details>` 折叠 |
| 历史 | auto-compact 摘要（~48k 字符） | `TokenBudgetBar` 进度条 |
| 会话 | maxTokens、temperature | 设置 Panel 滑块 |
| 本轮 | SSE `done.tokenUsage` | Header 会话 tok 计数 |
| Skill | Prompt 切片 4000 | Skill 卡片 |
| 模型 | reasoning 单独存储 | 思考时间线分区 |

前端：`apps/web/lib/tokenBudget.ts` · `components/tokenBudgetBar.tsx`  
UX 对标：[`../frontend/agent-ux-reference.md`](../frontend/agent-ux-reference.md)

---

## 设计参考（外部产品）

借鉴方向（非代码移植）：

- **Claude Code / Codex**：工具注册、只读并发、MCP 桥接、Skill frontmatter
- **OpenClaw / Hermes PiAgent**（待持续对齐）：Session 侧栏默认可见、流式 tool 时间线、token 预算 UI

KnowPilot 差异：Web 三栏 Chat + 本地 Markdown 真相源 + monorepo 单文件收拢。
