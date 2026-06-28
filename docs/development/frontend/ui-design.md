# 前端 UI / UX 设计规范

> 对齐 `content/skills/design-references/` 与 [`agent-ux-reference.md`](agent-ux-reference.md)（OpenClaw / Hermes PiAgent / Codex）。

---

## 设计原则

1. **Motion 有意义**：过渡 150–300ms，弹簧 `stiffness: 260, damping: 26`；尊重 `prefers-reduced-motion`
2. **图标**：Lucide 或 `apps/web/lib/icons.tsx` 自绘 SVG；**禁止** emoji / 键盘符号当 UI 图标
3. **玻璃拟态**：`--kp-glass-bg` + `backdrop-blur` + `--kp-divider`
4. **渐进披露**：思考时间线、工具 JSON 默认折叠；高频操作（发送、重试）始终可达
5. **Hover 反馈**：消息操作在气泡外 hover 显示（Codex 式）

---

## 布局模式（`layoutMode.ts`）

| 模式 | 路由 | 侧栏 |
|---|---|---|
| `home` | `/`、`/about` | 无 |
| `content` | `/posts`、`/editor` | PostSidebar |
| `chat` | `/chat` | Chat 内三栏 |
| `app` | `/agents`、`/skills` 等 | Sidebar |

顶栏：Logo · 文章 · 写作 · 对话 · Agents · About · ⌘K

---

## Chat 三栏（对标 OpenClaw + Codex）

| 栏 | 默认 | 说明 |
|---|---|---|
| 左 Session | 展开 | 标题 + 模型；新建会话 |
| 中消息 | 始终 | 用户右 / 助手左；**单条**流式助手气泡 |
| 右设置 | 展开 | 模型、温度、maxTokens、Skill、Token 预算 |

### 思考时间线（Hermes / Codex）

- 组件：`ThinkingTimeline`（`data-testid="thinking-timeline"`）
- 每轮：思考 → 工具；**禁止**重复渲染两个时间线容器（见 E2E）
- 流式助手气泡：`data-testid="streaming-assistant-bubble"`

### Token 预算（Codex）

- Header + 设置 Panel：`TokenBudgetBar`
- 展示：会话累计 token、输出 maxTokens、距 auto-compact 估算

---

## 组件收拢

| 类型 | 路径 |
|---|---|
| 通用 UI | `apps/web/components/shared.tsx` |
| 图标 | `apps/web/lib/icons.tsx` |
| Chat | `chat.tsx` · `chatInput.tsx` · `chatSettingsPanel.tsx` |
| Token | `apps/web/lib/tokenBudget.ts` |
| Hooks | `apps/web/lib/hooks.ts` |

---

## 测试

- 后端：Vitest（`agent-tools.md`）
- **前端 Chat：Playwright**（[`e2e-testing.md`](e2e-testing.md)），本机 Chrome，无需下载 Chromium

---

## 无障碍

- 图标按钮 `aria-label` 或 Tooltip
- 正文 `--kp-text-1` / `--kp-text-2` 对比 ≥ 4.5:1
- `globals.css` 中 `@media (prefers-reduced-motion: reduce)` 降低动画
