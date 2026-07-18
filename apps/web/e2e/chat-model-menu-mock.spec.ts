import { test, expect } from "@playwright/test";
import { SERVER_URL } from "./helpers/trpcE2e";
import { waitForChatReady, sendChatMessage, waitForStreamingComplete } from "./helpers/mockChatFixture";

test.describe("Chat Mock — 去右栏布局", () => {
  test.beforeEach(async ({ request }) => {
    await expect
      .poll(async () => (await request.get(`${SERVER_URL}/health`)).ok())
      .toBe(true);
  });

  test("发送消息仍可用；模型菜单可切换模型；左栏运行 Tab 可打开", async ({ page }) => {
    await waitForChatReady(page);

    // 无右栏开关
    await expect(page.getByTestId("right-tab-config")).toHaveCount(0);
    await expect(page.getByTestId("right-tab-runtime")).toHaveCount(0);

    // 模型菜单
    await page.getByTestId("chat-model-menu-trigger").first().click();
    await expect(page.getByTestId("chat-model-menu")).toBeVisible();
    await page.getByTestId("chat-model-option-deepseek-v4-pro").click();
    await expect(page.getByTestId("chat-model-menu-trigger").first()).toContainText(/Pro|V4/i);

    // chip 行
    await expect(page.getByTestId("chat-chip-skill").first()).toBeVisible();

    // 左栏运行
    await page.getByTestId("left-tab-runtime").click();
    await expect(page.getByTestId("left-runtime-panel")).toBeVisible();
    await expect(page.getByTestId("left-runtime-delivery")).toBeVisible();
    await page.getByTestId("left-tab-history").click();

    await sendChatMessage(page, "你好，请简短回复");
    await waitForStreamingComplete(page);
    await expect(page.getByTestId("assistant-message-bubble").first()).toBeVisible();
  });
});
