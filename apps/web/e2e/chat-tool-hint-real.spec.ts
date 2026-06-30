import { test, expect } from "@playwright/test";
import {
  waitForChatReady,
  sendChatMessage,
  waitForStreamingComplete,
  countAssistantMessages,
  lastAssistantText,
} from "./helpers/realChatFixture";

test.describe("Chat 真实 LLM — 工具时间线摘要", () => {
  test.describe.configure({ timeout: 180_000 });

  test.beforeEach(async ({ request }) => {
    await expect
      .poll(async () => (await request.get("http://127.0.0.1:3010/health")).ok())
      .toBe(true);
  });

  test("让 assistant 搜索 KnowPilot 后显示 web_search 工具 pill 与 hint", async ({ page }) => {
    await waitForChatReady(page);

    await sendChatMessage(page, "请使用 web_search 工具搜索 KnowPilot，并用一句话介绍它。");

    // 等待工具 pill 出现
    const toolPill = page.getByTestId("tool-pill").filter({ hasText: /web_search|搜索/ });
    await expect(toolPill).toBeVisible({ timeout: 60_000 });

    await waitForStreamingComplete(page);

    const assistantCount = await countAssistantMessages(page);
    expect(assistantCount).toBe(1);

    const text = await lastAssistantText(page);
    expect(text.length).toBeGreaterThan(10);

    // 工具 pill 与 hint 在完成后仍应保留在历史消息中
    await expect(page.getByTestId("tool-pill").filter({ hasText: /web_search|搜索/ })).toBeVisible();
    await expect(page.getByTestId("tool-timing-hint").first()).toBeVisible();
  });
});
