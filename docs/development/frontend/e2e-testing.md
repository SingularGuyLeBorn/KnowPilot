# Chat E2E 测试（Playwright）

> 前端 Chat **必须**用 Playwright 验证真实浏览器交互；后端 Vitest 不能替代 UI 回归。

---

## 环境

- **浏览器**：本机已安装的 **Google Chrome**（`playwright.config.ts` → `channel: "chrome"`）
- **无需** `playwright install chromium`
- **无需** ffmpeg（`video: "off"`）

```bash
# 根目录
pnpm test:e2e
pnpm test:e2e:headed   # 可见浏览器
pnpm --filter @knowpilot/web test:e2e:ui
```

Playwright 会自动启动 **server:3010**（本地若已在跑则复用）+ **web:3002**（`next start` 生产模式，避免与 `pnpm dev` 的 3000 冲突）。

本地首次 E2E 前需先 `pnpm --filter @knowpilot/web build`；CI 会在 E2E 步骤内自动 build。

---

## 用例目录

| 文件 | 场景 |
|---|---|
| `apps/web/e2e/chat-thinking.spec.ts` | 新对话发消息；用户-only 会话重试 |
| `apps/web/e2e/admin-pages.spec.ts` | 管理页冒烟（19 路由 + /about） |
| `apps/web/e2e/blog-smoke.spec.ts` | L1 博客冒烟（/posts、/editor、/、/posts/[slug]） |
| `apps/web/e2e/helpers/mockStream.ts` | Mock SSE（round_start / thinking / done） |
| `apps/web/e2e/helpers/sessionFixture.ts` | 创建「仅有用户消息」会话 |

---

## 断言要点

1. **`[data-testid="thinking-timeline"]` 数量为 1** — 防止思考块重复（历史 bug：fallback 气泡 + `renderAssistantBubble` 双渲染）
2. **`[data-testid="streaming-assistant-bubble"]` 数量为 1**
3. **`Agent 思考中…` 文案数量为 1**
4. 每步 `page.screenshot()` 存于 `apps/web/e2e/screenshots/`（gitignore）

---

## 编写新用例

```typescript
await page.goto("/chat");
await expect(page.getByTestId("chat-input")).toBeEnabled({ timeout: 15_000 });
await mockAgentStream(page, { sessionId: "..." });
await page.getByTestId("chat-input").fill("消息");
await page.getByTestId("chat-send").click();
await expect(page.getByTestId("thinking-timeline")).toHaveCount(1);
await page.screenshot({ path: "e2e/screenshots/step.png", fullPage: true });
```

Mock 流式接口：`page.route("**/api/agent/chat/stream", ...)`，勿 mock 整个 tRPC（Agent 列表等走真实后端）。

---

## CI

已在 `.github/workflows/ci.yml` 中启用：`pnpm lint` → `pnpm test` → `pnpm build` → `pnpm test:e2e`（Chromium + web:3002）。

---

## 故障排查

| 现象 | 处理 |
|---|---|
| ffmpeg 报错 | 确认 `video: "off"` |
| 找不到 Chrome | 安装 Google Chrome 或改 `channel` |
| 502 / 后端未连接 | 等待 webServer health 或手动 `pnpm dev:server` |
| 3000 端口占用 | E2E 使用 3002，与 dev 不冲突；需确保 3002 未被占用 |
| `next build` 失败 | 先 `pnpm lint` 修复 TS/SSR 问题后再跑 E2E |
| 无 Agent | `pnpm db:seed` |
