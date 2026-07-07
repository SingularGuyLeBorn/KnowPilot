import { test, expect } from "@playwright/test";
import { SERVER_URL } from "./helpers/trpcE2e";
import {
  waitForChatReady,
  sendChatMessage,
  waitForStreamingComplete,
  countAssistantMessages,
  expectToolPill,
} from "./helpers/mockChatFixture";

test.describe("Chat Mock — 工具失败态", () => {
  test.beforeEach(async ({ request }) => {
    await expect
      .poll(async () => (await request.get(`${SERVER_URL}/health`)).ok())
      .toBe(true);
  });

  test("工具失败显示红色摘要", async ({ page }) => {
    await waitForChatReady(page);
    // 消息需同时命中 Mock LLM 的 tool_error 场景（关键词：读取文章 + broken）
    // 与 Mock native 的 read_article 失败分支（URL 含 broken）
    await sendChatMessage(page, "读取文章 https://example.com/broken");
    await waitForStreamingComplete(page);

    expect(await countAssistantMessages(page)).toBe(1);
    await expectToolPill(page, "read_article");

    const hint = page.getByTestId("tool-timing-hint").first();
    await expect(hint).toBeVisible({ timeout: 10_000 });
    await expect(hint).toHaveClass(/text-red-600/, { timeout: 5_000 });
    await expect(hint).toContainText("失败");
  });
});
