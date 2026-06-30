import { test, expect } from "@playwright/test";
import {
  waitForChatReady,
  sendChatMessage,
  waitForStreamingComplete,
  countUserMessages,
  countAssistantMessages,
} from "./helpers/realChatFixture";
import { fetchOcrStatus, ocrSampleExists, OCR_SAMPLE_IMAGE } from "./helpers/ocrFixture";

test.describe("Chat 真实 LLM — OCR 附件多轮持久化", () => {
  test.describe.configure({ timeout: 240_000 });

  test.beforeEach(async ({ request }) => {
    await expect
      .poll(async () => (await request.get("http://127.0.0.1:3010/health")).ok())
      .toBe(true);
  });

  test.skip("上传 OCR 图片后，第二轮文字消息不应使第一轮附件图片消失 — 真实 LLM 响应时长不稳定，暂不纳入 CI", async ({ page }) => {
    test.skip(!ocrSampleExists(), "缺少 content/uploads/00_abstract_mqxw9uuq.png");

    const status = await fetchOcrStatus();
    test.skip(!status?.ready, "OCR 环境未就绪，请运行 pnpm ocr:setup && pnpm ocr:check");

    await waitForChatReady(page);

    // 上传测试图片
    const fileInput = page.getByTestId("chat-file-input");
    await fileInput.setInputFiles(OCR_SAMPLE_IMAGE);
    await expect(page.getByTestId("chat-ocr-ready")).toBeVisible({ timeout: 60_000 });

    // 第一轮：图片 + 文字
    await sendChatMessage(page, "图中主要讲了什么？用一句话概括。");
    await waitForStreamingComplete(page);

    expect(await countUserMessages(page)).toBe(1);
    expect(await countAssistantMessages(page)).toBe(1);

    // 关键断言：第一轮 user 消息里的图片仍然可见
    const firstUserBubble = page.getByTestId("user-message-bubble").first();
    await expect(firstUserBubble.locator("img")).toBeVisible();

    // 第二轮：纯文字
    await sendChatMessage(page, "还有呢？");
    await waitForStreamingComplete(page);

    expect(await countUserMessages(page)).toBe(2);
    expect(await countAssistantMessages(page)).toBe(2);

    // 第二轮流式及完成后，第一轮附件图片不应消失
    await expect(firstUserBubble.locator("img")).toBeVisible();
  });
});
