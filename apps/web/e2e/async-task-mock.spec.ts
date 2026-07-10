import { test, expect } from "@playwright/test";
import { SERVER_URL } from "./helpers/trpcE2e";
import {
  waitForChatReady,
  sendChatMessage,
  waitForStreamingComplete,
  countAssistantMessages,
} from "./helpers/mockChatFixture";

test.describe("Chat Mock — 异步任务队列", () => {
  test.beforeEach(async ({ request }) => {
    await expect
      .poll(async () => (await request.get(`${SERVER_URL}/health`)).ok())
      .toBe(true);
  });

  test("async_task_run 后台任务完成后结果自动插入对话", async ({ page }) => {
    const logs: string[] = [];
    page.on("console", (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
    page.on("pageerror", (err) => logs.push(`[pageerror] ${err.message}`));

    await waitForChatReady(page);
    await sendChatMessage(page, "请启动一个后台任务总结当前项目");

    // 父会话时间线应实时显示后台任务进度（在流式/结果消费期间任一时间点出现即可）
    try {
      await expect
        .poll(async () => page.getByTestId("async-progress-step").count(), {
          timeout: 10_000,
          intervals: [50],
        })
        .toBeGreaterThanOrEqual(1);
    } catch (e) {
      console.log("=== debug logs ===\n" + logs.join("\n"));
      throw e;
    }

    await waitForStreamingComplete(page);

    // 异步任务完成后会额外产生一条 assistant 消息（子 Agent 结果）
    await expect
      .poll(async () => countAssistantMessages(page), {
        timeout: 30_000,
        intervals: [500, 1000],
      })
      .toBeGreaterThanOrEqual(2);

    // 结果消息中包含 Mock LLM 的兜底回复
    const pageText = await page.locator("[data-testid='assistant-message-bubble']").allTextContents();
    expect(pageText.some((t) => t.includes("Mock LLM"))).toBe(true);
  });
});
