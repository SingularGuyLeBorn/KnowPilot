import { test, expect } from "@playwright/test";
import { SERVER_URL } from "./helpers/trpcE2e";
import {
  waitForChatReady,
  sendChatMessage,
  waitForStreamingComplete,
  expectAssistantAnswer,
} from "./helpers/mockChatFixture";

function currentSessionId(page: import("@playwright/test").Page): string | null {
  const url = new URL(page.url());
  return url.searchParams.get("sessionId");
}

test.describe("Chat Mock — 普通对话刷新后恢复", () => {
  test.beforeEach(async ({ request }) => {
    await expect.poll(async () => (await request.get(`${SERVER_URL}/health`)).ok()).toBe(true);
  });

  test("普通问候完成后刷新，点回会话不丢失最终结果", async ({ page }) => {
    await waitForChatReady(page);

    // 触发普通问候
    await sendChatMessage(page, "你好");

    // 等待最终回复完整输出
    await waitForStreamingComplete(page);
    await expectAssistantAnswer(page, "Mock LLM");

    // 记录当前会话 ID，避免列表污染导致点错
    const parentSessionId = currentSessionId(page);
    expect(parentSessionId).toBeTruthy();

    // 模拟刷新：丢失内存状态，sessionStorage 保留
    await page.reload();
    await page.getByTestId("chat-input").waitFor({ state: "visible", timeout: 30_000 });

    // 刷新后通过 URL 直接回到原会话，最终结果应仍在
    await page.goto(`/chat?sessionId=${parentSessionId}`);
    await page.getByTestId("chat-input").waitFor({ state: "visible", timeout: 30_000 });
    await expect(page.getByTestId("assistant-message-bubble").first()).toBeVisible({ timeout: 10_000 });
    await expectAssistantAnswer(page, "Mock LLM");
  });
});
