# KnowPilot 开发文档

> 本文档是 KnowPilot 的「活地图」：按 **L1 ~ L5** 阶段拆解产品演进路线，每个阶段内再按模块展开。
> 所有技术决策、实体设计、API 规范、同步策略、AI 调用方式、错误处理规范都在此记录。
> 项目路径：`D:\ALL IN AI\KnowPilot`

---

## 文档结构

```text
docs/
├── development/
│   ├── README.md                         # 本文件：总览与索引
│   ├── L1-foundation.md                  # L1：博客与项目基础
│   ├── L2-ai-core.md                     # L2：AI 核心（Agent / Skill / MCP / Memory / Chat）
│   ├── L3-content-knowledge.md           # L3：内容与知识运维（File / Git / Task / Log / Workspace）
│   ├── L4-automation-workflows.md        # L4：自动化与工作流（Trigger / Approval / Agent Loop）
│   ├── L5-polish-scale.md                # L5：打磨与规模化（Search / Auth / Analytics / Deploy）
│   ├── L6-future-scale.md                # L6+：未来扩展（规划，非当前范围）
│   ├── REMEDIATION_PLAN.md               # 整改计划（审视发现的问题与修复进度）
│   ├── backend/
│   │   ├── api-design.md                 # 后端 API 设计总则
│   │   ├── agent-tools.md                # Agent native / skill / mcp 工具链
│   │   ├── error-handling.md             # 错误处理规范：让 AI 和人都能看懂
│   │   ├── ai-callable-api.md            # 如何让 AI 方便、安全地调用后端
│   │   └── entity-sync.md                # Markdown / SQLite / 运行时数据同步策略
│   ├── frontend/
│   │   ├── ui-design.md                  # Chat 三栏、图标、玻璃拟态
│   │   ├── agent-ux-reference.md         # OpenClaw / Hermes / Codex 对标
│   │   └── e2e-testing.md                # Playwright Chat E2E
│   └── entities/
│       └── entity-matrix.md            # 19 个实体的 API/目录/状态矩阵
└── deployment/
    └── cloudflare-tunnel.md          # 远程访问（Tunnel）
```

---

## 阶段总览

| 阶段 | 主题 | 核心目标 | 主要实体 |
|---|---|---|---|
| **L1** | 博客基建 | 跑通单用户博客的读写渲染 | Post / Category / Tag |
| **L2** | AI 核心 | 让 Agent 能读文章、调技能、记记忆、聊会话 | Agent / Skill / McpServer / Memory / ChatSession / ChatMessage |
| **L3** | 内容运维 | 管理文件、Git、任务、日志、工作区 | File / GitRepo / Task / Log / Workspace |
| **L4** | 自动化流 | 触发器、审批、多 Agent 协作工作流 | Trigger / Approval |
| **L5** | 打磨与规模化 | 搜索、统计、鉴权、部署、测试 | User / Analytics / SearchIndex |

---

## 当前状态（2026-06-29）

- [已完成] **L1 博客基建（已封板）**：主题、布局、首页、文章 CRUD、编辑器、Markdown ↔ SQLite 双向同步、Command Palette、构建与测试验收通过。
- [已完成] **L2 AI 核心**：Agent ReAct + SSE Chat（三栏 UI、Token 预算条）、Skill/MCP/Memory/Prompt、`skill:*`、auto-compact、Playwright E2E、`/tools` `/runs`。
- [已完成] **L3 内容运维**：File / Git / Task / Log / Workspace 后端 CRUD + 管理页；Task sync + TaskScheduler。
- [已完成] **L4 自动化**：TriggerEngine + ApprovalGate + 前端页 + agent.runWorkflow。
- [已完成] **L5 打磨**：FTS5 全局搜索、Analytics 看板、可选鉴权、Docker、CI E2E、`db:backup`、`/credentials`。

> 详细模块进度见各 `L{N}-*.md` 与 [`entities/entity-matrix.md`](entities/entity-matrix.md)。

---

## 计划完成与验收（2026-06-29）

**L1–L5 全部完成。** 后续新功能应新开 L6+ 阶段文档（见 `L6-future-scale.md`），勿再修改已封板的 L1 验收项。

```bash
pnpm validate   # lint(0 error) → test(88) → build → e2e(26)
pnpm dev        # 日常开发 http://localhost:3000 + :3010
```

| 验收项 | 标准 |
|---|---|
| Lint | `pnpm lint` 0 errors |
| 单元/集成 | Vitest 88 passed |
| 生产构建 | `pnpm build` 无 Turbopack 警告 |
| E2E | Playwright 26 passed（19 管理路由 + about + 4 L1 博客 + 2 Chat） |
| CI | `.github/workflows/ci.yml` 同上流程 |

开发日志：`.dev-log/session-2026-06-29.md`

---

## 设计原则

1. **本地优先 / Markdown 为源**：所有适合文本化的实体（Post / Agent / Skill / Memory / Task / MCP）都应有 `content/{entity}/` 目录作为 Git 可跟踪的数据源。
2. **SQLite 是缓存/检索层**：前端只通过 tRPC 与 SQLite 交互；`pnpm db:sync` 负责把文本源同步到数据库。
3. **单用户模式（可选鉴权）**：默认 `AUTH_MODE=none` 无登录；远程部署可设 `AUTH_MODE=password` + `/login`。
4. **AI 优先的 API**：每个实体 API 都要能被 Agent 理解和调用，返回结构化错误，而不是只有一个状态码或 [未实现]。
5. **人因工程的错误信息**：人类调试时，错误要包含「发生了什么、在哪发生、怎么修」。

---

## 如何阅读本文档

- 如果你在做某一阶段的功能，先看对应 `L{N}-*.md`。
- 如果你在设计新的后端接口，先看 `backend/api-design.md` 和 `backend/error-handling.md`。
- 如果你要让 AI 调用某个实体，先看 `backend/ai-callable-api.md`。
