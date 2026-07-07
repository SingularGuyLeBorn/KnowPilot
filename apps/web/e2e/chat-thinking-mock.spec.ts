import { test, expect } from "@playwright/test";
import { SERVER_URL } from "./helpers/trpcE2e";
import {
  waitForChatReady,
  sendChatMessage,
  waitForStreamingComplete,
  countAssistantMessages,
  expectThinkingTimeline,
  expectAssistantAnswer,
} from "./helpers/mockChatFixture";

test.describe("Chat Mock — 思考时间线", () => {
  test.use({});

  test.beforeEach(async ({ request }) => {
    await expect
      .poll(async () => (await request.get(`${SERVER_URL}/health`)).ok())
      .toBe(true);
  });

  test("思考模式只保留一份时间线", async ({ page }) => {
    await waitForChatReady(page);
    await sendChatMessage(page, "请解释你的思考过程");
    await waitForStreamingComplete(page);

    expect(await countAssistantMessages(page)).toBe(1);
    await expectThinkingTimeline(page);
    expect(await page.getByTestId("thinking-timeline").count()).toBeLessThanOrEqual(1);
    await expectAssistantAnswer(page, "最终回答");
  });
});
