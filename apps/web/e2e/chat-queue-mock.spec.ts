import { test, expect } from "@playwright/test";
import { SERVER_URL } from "./helpers/trpcE2e";
import {
  waitForChatReady,
  sendChatMessage,
  countUserMessages,
  countAssistantMessages,
} from "./helpers/mockChatFixture";

test.describe("Chat Mock — 连续发送队列自动 drain", () => {
  test.beforeEach(async ({ request }) => {
    await expect
      .poll(async () => (await request.get(`${SERVER_URL}/health`)).ok())
      .toBe(true);
  });

  test("第一条流式回复结束后，队列中的第二条消息自动发出并生成第二份回复", async ({ page }) => {
    await waitForChatReady(page);

    // 第一条消息启动本轮
    await sendChatMessage(page, "队列测试第一条");

    // 第二条消息要穿越「发送按钮变为停止生成」的竞态窗口：
    // 若点击时本轮已结束则直接发；若仍在 streaming 则入队，等第一条 commit 后 drain 自动发。
    const msg2 = "队列测试第二条";
    const input = page.getByTestId("chat-input");
    await expect(async () => {
      if ((await input.inputValue()) !== msg2) await input.fill(msg2);
      const sendBtn = page.getByTestId("chat-send");
      if (!(await sendBtn.isEnabled().catch(() => false))) {
        throw new Error("本轮流式未结束（按钮为停止生成态），等待恢复");
      }
      await sendBtn.click();
    }).toPass({ timeout: 30_000, intervals: [200, 500, 1_000] });

    // 最终应产生两条 user 与两条 assistant；中间状态（streaming）可能短暂出现，
    // 以最终落库计数为准（自动 drain 会在第一条 assistant 落库后触发第二条）。
    await expect(page.getByTestId("user-message-bubble")).toHaveCount(2, { timeout: 30_000 });
    await expect(page.getByTestId("assistant-message-bubble")).toHaveCount(2, { timeout: 30_000 });
    await expect(page.getByTestId("streaming-assistant-bubble")).toHaveCount(0, { timeout: 10_000 });

    expect(await countUserMessages(page)).toBe(2);
    expect(await countAssistantMessages(page)).toBe(2);
  });
});
