import { test, expect } from "@playwright/test";
import {
  waitForChatReady,
  sendChatMessage,
  countUserMessages,
  countAssistantMessages,
} from "./helpers/realChatFixture";

test.describe("Chat 真实 LLM — 发送队列", () => {
  test.describe.configure({ timeout: 240_000 });

  test.beforeEach(async ({ request }) => {
    await expect
      .poll(async () => (await request.get("http://127.0.0.1:3010/health")).ok())
      .toBe(true);
  });

  test("连续发送两条消息，队列按顺序生成两份 assistant 回复", async ({ page }) => {
    await waitForChatReady(page);

    await sendChatMessage(page, "回答：5 的平方是多少？");
    await sendChatMessage(page, "回答：6 的平方是多少？");

    // 等待所有流式结束
    const streamingBubble = page.getByTestId("streaming-assistant-bubble");
    await expect(streamingBubble).toHaveCount(0, { timeout: 120_000 });

    const userCount = await countUserMessages(page);
    const assistantCount = await countAssistantMessages(page);

    expect(userCount).toBe(2);
    expect(assistantCount).toBe(2);
  });
});
