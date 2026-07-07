import { test, expect } from "@playwright/test";
import { SERVER_URL } from "./helpers/trpcE2e";
import {
  waitForChatReady,
  sendChatMessage,
  waitForStreamingComplete,
  countAssistantMessages,
  expectToolPill,
  expectToolHint,
  expectAssistantAnswer,
} from "./helpers/mockChatFixture";

test.describe("Chat Mock — 工具调用与回答", () => {
  test.beforeEach(async ({ request }) => {
    await expect
      .poll(async () => (await request.get(`${SERVER_URL}/health`)).ok())
      .toBe(true);
  });

  test("触发 web_search 工具并显示 pill/hint", async ({ page }) => {
    await waitForChatReady(page);
    await sendChatMessage(page, "搜索 KnowPilot 并一句话介绍");
    await waitForStreamingComplete(page);

    expect(await countAssistantMessages(page)).toBe(1);
    await expectToolPill(page, "web_search");
    // Mock native 工具后，hint 含 "mock" 引擎与耗时，不再含 tavily
    await expectToolHint(page, "mock");
    await expectAssistantAnswer(page, "KnowPilot 是一个本地优先");
  });

  test("普通问候不触发工具", async ({ page }) => {
    await waitForChatReady(page);
    await sendChatMessage(page, "你好");
    await waitForStreamingComplete(page);

    expect(await countAssistantMessages(page)).toBe(1);
    expect(await page.getByTestId("tool-pill").count()).toBe(0);
    await expectAssistantAnswer(page, "Mock LLM");
  });
});
