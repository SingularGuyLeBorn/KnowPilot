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

    // 第二条消息的发送要穿越三个竞态窗口，三种落点最终都经队列产生第二次运行：
    // ① 点击落在流式开始前 → 正常入队，drain 后开第二轮；
    // ② 流式期间发送按钮变为「停止生成」(chat-stop)，需等本轮结束按钮恢复再点；
    // ③ 新会话创建会按 key 重挂载输入框，可能吞掉已填草稿，需重填。
    const msg2 = "回答：6 的平方是多少？";
    const input = page.getByTestId("chat-input");
    await expect(async () => {
      if ((await input.inputValue()) !== msg2) await input.fill(msg2);
      const sendBtn = page.getByTestId("chat-send");
      if (!(await sendBtn.isEnabled().catch(() => false))) {
        throw new Error("本轮流式未结束（按钮为停止生成态），等待恢复");
      }
      await sendBtn.click();
    }).toPass({ timeout: 120_000, intervals: [1_000, 2_000, 5_000] });

    // 等两条用户消息与两份回复全部落地——两条流之间存在「commit → INV-8 drain → 新一轮」
    // 间隙，直接等 streaming 气泡归零会在间隙中误判结束，必须等计数达标。
    await expect(page.getByTestId("user-message-bubble")).toHaveCount(2, { timeout: 120_000 });
    await expect(page.getByTestId("assistant-message-bubble")).toHaveCount(2, { timeout: 120_000 });
    await expect(page.getByTestId("streaming-assistant-bubble")).toHaveCount(0, { timeout: 120_000 });

    expect(await countUserMessages(page)).toBe(2);
    expect(await countAssistantMessages(page)).toBe(2);
  });
});
