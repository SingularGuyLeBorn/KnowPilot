import { test, expect } from "@playwright/test";
import { SERVER_URL } from "./helpers/trpcE2e";
import {
  waitForChatReady,
  sendChatMessage,
  waitForStreamingComplete,
  countAssistantMessages,
  expectToolPill,
  expectAssistantAnswer,
} from "./helpers/mockChatFixture";

test.describe("Chat Mock — 中间正式回复进导轨", () => {
  test.beforeEach(async ({ request }) => {
    await expect
      .poll(async () => (await request.get(`${SERVER_URL}/health`)).ok())
      .toBe(true);
  });

  test("工具轮次中的中间正式回复进入左侧导轨（无圆点）", async ({ page }) => {
    await waitForChatReady(page);
    // "中间回复" 关键词触发 intermediate_content 场景：
    // 第一轮 probe 返回 content("我将先搜索...") + web_search tool_call
    // 第二轮 probe 返回最终回答
    await sendChatMessage(page, "中间回复测试，请搜索后回答");
    await waitForStreamingComplete(page);

    // 最终 assistant 气泡存在
    expect(await countAssistantMessages(page)).toBe(1);
    // 工具 pill 出现
    await expectToolPill(page, "web_search");
    // 中间正式回复 step 出现在导轨内
    const intermediateStep = page.getByTestId("intermediate-content-step");
    await expect(intermediateStep).toBeVisible({ timeout: 15_000 });
    await expect(intermediateStep).toContainText("我将先搜索");
    // 最终回答在独立气泡
    await expectAssistantAnswer(page, "已完成工具调用");
  });
});
