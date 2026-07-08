# Agent UX 参考：OpenClaw · Hermes PiAgent · Codex

> KnowPilot Chat 的对标清单。原则：**借鉴交互与信息架构，不移植代码**；视觉仍遵循莫兰迪 + 玻璃拟态（`ui-design.md`）。

---

## 对标产品概览

| 产品 | 定位 | KnowPilot 已吸收 | 待推进 |
|---|---|---|---|
| **Codex / Claude Code** | CLI/IDE Agent | 工具时间线、Skill/MCP、`skill:*`、只读并发、Token/LLM 预算条 | 工具 pill 动效 polish |
| **OpenClaw** | 多通道 Agent 网关 | Session 侧栏/搜索/相对时间/分组、发送队列、Tunnel 脚本、Access 鉴权 UI（`/login` + `/settings`） | 通道状态 |
| **Hermes PiAgent** | 自进化 Agent 框架 | 思考链与回复分离、Skill Markdown、推理/工具/观察标签、Skill 版本 badge | 自改进闭环 |

---

## 1. Codex / Claude Code

### UI

- **工具调用**：每条 tool 显示名称 + 参数摘要 + 运行/完成/失败态；不展开 JSON 除非用户点击。
- **思考（Reasoning）**：默认折叠；展开后只读 pre 块，与最终回复气泡分离。
- **颜色**：中性灰底 + 单一 accent（KnowPilot 对应 `--kp-brand`），成功/警告/错误用 semantic 色，不用 emoji。

### UX

- **渐进披露**：高频操作（复制、重试）hover 显示；低频（版本切换、Prompt 编辑）在侧栏。
- **流式反馈**：先出现「思考/工具」时间线，再流式正文；避免同一轮出现两个时间线容器（见 `chat.tsx` 修复说明）。
- **错误**：结构化 message + suggestion + 一键重试。

### Token 控制

- 工具结果截断（12k 字符）、`read_file` / `git_diff` 上限。
- 长对话 **auto-compact**（~48k 字符触发摘要）。
- UI 应展示：**本轮输出预算**（maxTokens）、**会话累计 token**、**距压缩阈值**（估算）。

KnowPilot 映射：

| Codex 概念 | KnowPilot 实现 |
|---|---|
| Context window | `TokenBudgetBar` + `chatConfig.maxTokens` |
| Tool output cap | `agent-tools.md` → MCP/read_file 截断 |
| Compaction | `autoCompact.ts` |
| Reasoning stream | SSE `thinking` + `ThinkingTimeline` |

---

## 2. OpenClaw

### UI

- **Session 列表**：标题、模型、相对时间；当前项高亮；新建会话固定入口。
- **三栏**：左 Session · 中对话 · 右 Agent/工具配置（KnowPilot 已实现）。
- **队列**：待发消息列表可取消（KnowPilot `queue` 已实现）。

### UX

- **Agent 切换**：顶栏下拉 + 管理页 deep link。
- **远程访问**：Cloudflare Tunnel 只暴露 Web 3000，API 走 Next rewrite（见 `docs/deployment/cloudflare-tunnel.md`）。
- **并发工具**：只读 batch 并行，写入串行；UI 上同一轮多个 tool 可并列 running 态。

### Token 控制

- 网关层可设每日预算（KnowPilot：`LLM_DAILY_BUDGET` env，后端 config）。
- 前端应提示「接近预算」而非静默失败。

---

## 3. Hermes PiAgent

### UI

- **推理边界**：`<thinking>` / reasoning 与 user-facing answer 严格分区（对应 `ThinkingTimeline` + `PostContent`）。
- **Skill 卡片**：名称、描述、图标（Lucide）；`/` 触发与 SkillTool 双路径。
- **Skill 即资产**：reference 类 Skill 不进 `skill:*`（`kind: reference`）。

### UX

- **ReAct 轮次**：每轮「思考 → 工具 → 观察」顺序可读；轮次编号 `round` 贯穿 SSE。
- **记忆注入**：keyword 匹配 Memory 后注入 system（后端已实现）。
- **自改进**：L4+ 方向；当前只做 Skill frontmatter + sync。

### Token 控制

- Skill prompt 切片（`skillRunner` 默认 4000 字符）。
- `allowed-tools` frontmatter 限制 Skill 可触达工具，减少无效调用。

---

## KnowPilot Chat 组件映射

```text
/chat
├── 左栏 Session          ← OpenClaw 会话列表
├── 中栏 MessageArea      ← Codex 气泡 + Hermes 推理分区
│   ├── ThinkingTimeline  ← 单实例；data-testid="thinking-timeline"
│   │   ├── ThinkingStep  ← 有圆点（导轨标记思考阶段）
│   │   ├── ContentStep   ← 无圆点（中间正式回复，后续仍有工具调用）
│   │   └── ToolStep      ← 无圆点（工具调用）
│   └── PostContent       ← 最终回复（独立气泡，导轨外）
├── 右栏 ChatSettingsPanel← Codex 紧凑参数 + Skill
└── TokenBudgetBar        ← 上下文/输出预算（header + 设置 Panel）
```

---

## 颜色与交互 token（设计变量）

| 用途 | CSS 变量 | 说明 |
|---|---|---|
| 主 accent | `--kp-brand` | 用户气泡、主按钮 |
| 玻璃面板 | `--kp-glass-bg` | 设置 Panel、About |
| 思考/工具底 | `--kp-bg-mute` | 时间线容器 |
| 正文 | `--kp-text-1` / `--kp-text-2` | 4.5:1 对比 |
| 运行中 | `--kp-brand-dark` + `Loader2` | 禁止文字 emoji |
| 错误 | `red-50` / `red-700` | 与品牌色分离 |

弹簧：`stiffness: 260, damping: 26`（150–300ms 感知）。

---

## 测试要求

| 层级 | 工具 | 范围 |
|---|---|---|
| 后端工具 | Vitest | native / agentTools / skill / mcp |
| 前端 Chat | **Playwright** | 发消息、重试、思考时间线 **唯一性**、截图 |

```bash
pnpm test:e2e          # 使用本机 Chrome（channel: chrome），无需 playwright install chromium
pnpm test:e2e:headed   # 有界面调试
```

详见 [`e2e-testing.md`](e2e-testing.md)。

---

## 路线图（L2 Chat 抛光）

- [x] 三栏布局、Skill `/`、流式 SSE、设置 Panel
- [x] 思考时间线重复渲染修复
- [x] Playwright E2E（Chrome 本机）
- [x] Token 预算条 + done 事件 tokenUsage
- [x] 工具 pill 化（折叠 JSON，`<details>` 渐进披露）
- [x] Session 搜索 / 相对时间 / 日期分组
- [x] Cloudflare Tunnel 远程访问（`scripts/tunnel.ps1` + `pnpm tunnel:quick`）
- [x] `prefers-reduced-motion` 全局降级（`globals.css`）

---

## 参考路径（本机）

| 资源 | 路径 |
|---|---|
| Claude Code 逆向 | `D:\ALL IN AI\claude-code-rev-main` |
| 设计 Skill | `content/skills/design-references/` |
| Hermes 笔记 | `content/posts/llm-guide/7-LLM应用开发/7.8-Hermes/` |

OpenClaw 以公开文档与社区 UI 描述为准；实现时以本文「待推进」列为准逐项勾选。
