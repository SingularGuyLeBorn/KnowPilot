import { test, expect } from "@playwright/test";
import {
  waitForChatReady,
  sendChatMessage,
  waitForStreamingComplete,
  countAssistantMessages,
  lastAssistantText,
} from "./helpers/realChatFixture";

test.describe("Chat 真实 LLM — 思考时间线", () => {
  test.describe.configure({ timeout: 180_000 });

  test.beforeEach(async ({ request }) => {
    await expect
      .poll(async () => (await request.get("http://127.0.0.1:3010/health")).ok())
      .toBe(true);
  });

  test("单轮对话完成后只保留一份 assistant 回复，无重复思考时间线", async ({ page }) => {
    await waitForChatReady(page);

    await sendChatMessage(page, "用一句话回答：2 的 3 次方是多少？");
    await waitForStreamingComplete(page);

    const assistantCount = await countAssistantMessages(page);
    expect(assistantCount).toBe(1);

    const text = await lastAssistantText(page);
    expect(text.length).toBeGreaterThan(3);

    // 关键断言：无论模型是否输出 thinking，都不应出现重复的思考时间线
    const timelineCount = await page.getByTestId("thinking-timeline").count();
    expect(timelineCount).toBeLessThanOrEqual(1);
  });

  test("第二轮流式期间第一轮 assistant 气泡不消失", async ({ page }) => {
    await waitForChatReady(page);

    // 第一轮
    await sendChatMessage(page, "1+1 等于几？请只回答数字。");
    await waitForStreamingComplete(page);

    const firstRoundText = await lastAssistantText(page);
    expect(firstRoundText).toMatch(/2/);

    // 第二轮：发送后立即检查，此时应仍处于流式状态
    await sendChatMessage(page, "再加 3 呢？");

    // 关键断言：第二轮流式期间，第一轮 assistant 气泡仍然可见
    await expect(page.getByTestId("assistant-message-bubble").first()).toBeVisible({
      timeout: 5_000,
    });

    await waitForStreamingComplete(page);

    const assistantCount = await countAssistantMessages(page);
    expect(assistantCount).toBe(2);

    const secondRoundText = await lastAssistantText(page);
    expect(secondRoundText.length).toBeGreaterThan(3);
  });
});
