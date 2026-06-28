import { test, expect } from "@playwright/test";
import path from "path";
import { mockAgentStreamHoldOpen } from "./helpers/mockStream";
import { createUserOnlySession } from "./helpers/sessionFixture";

const screenshotDir = path.join(__dirname, "screenshots");

test.describe("Chat 思考时间线", () => {
  test.beforeEach(async ({ page, request }) => {
    await expect
      .poll(async () => (await request.get("http://127.0.0.1:3010/health")).ok())
      .toBe(true);
    await page.goto("/chat");
    await expect(page.getByRole("heading", { name: "Agent 对话" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("chat-input")).toBeEnabled({ timeout: 20_000 });
  });

  test("新对话发消息：只显示一条思考时间线", async ({ page }) => {
    await mockAgentStreamHoldOpen(page);

    await page.screenshot({ path: path.join(screenshotDir, "01-chat-empty.png"), fullPage: true });

    const input = page.getByTestId("chat-input");
    await input.click();
    await input.fill("用 list_directory 查看 content/agents");
    await expect(input).toHaveValue("用 list_directory 查看 content/agents");
    await page.screenshot({ path: path.join(screenshotDir, "02-chat-typed.png"), fullPage: true });

    await input.press("Control+Enter");

    await expect(page.getByTestId("streaming-assistant-bubble")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("thinking-timeline")).toHaveCount(1, { timeout: 10_000 });
    await expect(page.getByText("Agent 思考中…")).toHaveCount(1);

    await page.screenshot({ path: path.join(screenshotDir, "04-chat-single-thinking.png"), fullPage: true });
  });

  test("会话仅有用户消息时继续发送：不出现重复思考块", async ({ page }) => {
    const fixture = await createUserOnlySession();

    await page.goto(`/chat?sessionId=${fixture.sessionId}`);
    await expect(page.getByRole("heading", { name: "Agent 对话" })).toBeVisible();
    await mockAgentStreamHoldOpen(page);

    await expect(
      page.getByText("用 list_directory 工具查看 content/agents 目录，一句话回复有哪些文件"),
    ).toBeVisible({ timeout: 15_000 });

    const input = page.getByTestId("chat-input");
    await input.fill("继续：列出 agents 目录");

    const streamResponse = page.waitForResponse(
      (r) => r.url().includes("/api/agent/chat/stream") && r.ok(),
    );
    await input.press("Control+Enter");
    await streamResponse;

    await expect(page.getByText("继续：列出 agents 目录")).toHaveCount(1);
    await expect(page.getByTestId("streaming-assistant-bubble")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("thinking-timeline")).toHaveCount(1, { timeout: 10_000 });

    await page.screenshot({ path: path.join(screenshotDir, "07-no-duplicate-thinking.png"), fullPage: true });
  });
});
