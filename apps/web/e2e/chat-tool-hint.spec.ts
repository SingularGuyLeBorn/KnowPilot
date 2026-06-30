import { test, expect } from "@playwright/test";
import {
  createSessionWithFailedToolHint,
  createSessionWithInfoSourceScopedHint,
  createSessionWithReadArticleHint,
  createSessionWithShortArticleHint,
  createSessionWithScrapeHint,
  createSessionWithToolHints,
} from "./helpers/sessionFixture";

test.describe("Chat 工具时间线摘要", () => {
  test.beforeEach(async ({ request }) => {
    await expect
      .poll(async () => (await request.get("http://127.0.0.1:3010/health")).ok())
      .toBe(true);
  });

  test("历史会话：web_search 完成 pill 显示耗时与引擎", async ({ page }) => {
    const fixture = await createSessionWithToolHints();

    await page.goto(`/chat?sessionId=${fixture.sessionId}`);
    await expect(page.getByRole("heading", { name: "Agent 对话" })).toBeVisible({ timeout: 30_000 });

    const hint = page.getByTestId("tool-timing-hint").first();
    await expect(hint).toBeVisible({ timeout: 15_000 });
    await expect(hint).toContainText("88ms");
    await expect(hint).toContainText("tavily");
    await expect(page.getByTestId("tool-pill").filter({ hasText: "web_search" })).toBeVisible();
  });

  test("历史会话：web_search infoSource-scoped 显示信息源数量", async ({ page }) => {
    const fixture = await createSessionWithInfoSourceScopedHint();

    await page.goto(`/chat?sessionId=${fixture.sessionId}`);
    await expect(page.getByRole("heading", { name: "Agent 对话" })).toBeVisible({ timeout: 30_000 });

    const hint = page.getByTestId("tool-timing-hint").first();
    await expect(hint).toBeVisible({ timeout: 15_000 });
    await expect(hint).toContainText("156ms");
    await expect(hint).toContainText("infoSource-scoped");
    await expect(hint).toContainText("1 信息源");
  });

  test("历史会话：read_article 显示平台、方法与字数", async ({ page }) => {
    const fixture = await createSessionWithReadArticleHint();

    await page.goto(`/chat?sessionId=${fixture.sessionId}`);
    await expect(page.getByRole("heading", { name: "Agent 对话" })).toBeVisible({ timeout: 30_000 });

    const hint = page.getByTestId("tool-timing-hint").first();
    await expect(hint).toBeVisible({ timeout: 15_000 });
    await expect(hint).toContainText("650ms");
    await expect(hint).toContainText("juejin");
    await expect(hint).toContainText("3200 字");
  });

  test("历史会话：read_article 短正文显示 warning 与 suggestedTool", async ({ page }) => {
    const fixture = await createSessionWithShortArticleHint();

    await page.goto(`/chat?sessionId=${fixture.sessionId}`);
    await expect(page.getByRole("heading", { name: "Agent 对话" })).toBeVisible({ timeout: 30_000 });

    const hint = page.getByTestId("tool-timing-hint").first();
    await expect(hint).toBeVisible({ timeout: 15_000 });
    await expect(hint).toContainText("520ms");
    await expect(hint).toContainText("bilibili");
    await expect(hint).toContainText("正文较短");
    await expect(hint).toContainText("→scrape_web_page");
  });

  test("历史会话：scrape_web_page 显示 playwright 与字数", async ({ page }) => {
    const fixture = await createSessionWithScrapeHint();

    await page.goto(`/chat?sessionId=${fixture.sessionId}`);
    await expect(page.getByRole("heading", { name: "Agent 对话" })).toBeVisible({ timeout: 30_000 });

    const hint = page.getByTestId("tool-timing-hint").first();
    await expect(hint).toBeVisible({ timeout: 15_000 });
    await expect(hint).toContainText("900ms");
    await expect(hint).toContainText("playwright");
    await expect(hint).toContainText("2899 字");
  });

  test("历史会话：工具失败 hint 显示红色摘要", async ({ page }) => {
    const fixture = await createSessionWithFailedToolHint();

    await page.goto(`/chat?sessionId=${fixture.sessionId}`);
    await expect(page.getByRole("heading", { name: "Agent 对话" })).toBeVisible({ timeout: 30_000 });

    const hint = page.getByTestId("tool-timing-hint").first();
    await expect(hint).toBeVisible({ timeout: 15_000 });
    await expect(hint).toContainText("失败");
    await expect(hint).toContainText("页面不可用");
    await expect(hint).toHaveClass(/text-red-600/);
  });
});
