/**
 * Chat 标签页 + 两栏分屏（Mock）
 * - 打开两个会话后可分屏
 * - 焦点 pane 可切换
 * - 刷新后 tabs 从 sessionStorage 恢复
 */

import { test, expect } from "@playwright/test";
import { SERVER_URL } from "./helpers/trpcE2e";
import {
  waitForChatReady,
  sendChatMessage,
  waitForStreamingComplete,
} from "./helpers/mockChatFixture";

test.describe("Chat 标签页 + 分屏", () => {
  test.beforeEach(async ({ request }) => {
    await expect
      .poll(async () => (await request.get(`${SERVER_URL}/health`)).ok())
      .toBe(true);
  });

  test("打开两会话后分屏，两侧 pane 并存且可切焦点", async ({ page }) => {
    await waitForChatReady(page);
    await sendChatMessage(page, "你好");
    await waitForStreamingComplete(page);

    await page.getByRole("button", { name: "新建对话" }).click();
    await page.getByTestId("chat-input").first().waitFor({ state: "visible" });
    await sendChatMessage(page, "第二会话");
    await waitForStreamingComplete(page);

    await expect(page.getByTestId("chat-tab-bar")).toBeVisible();
    const tabs = page.getByTestId("chat-tab");
    await expect.poll(async () => tabs.count()).toBeGreaterThanOrEqual(2);

    const enterSplit = page.getByTestId("chat-enter-split");
    await expect(enterSplit).toBeEnabled({ timeout: 5_000 });
    await enterSplit.click();

    await expect(page.getByTestId("chat-exit-split")).toBeVisible();
    const panes = page.getByTestId("chat-session-pane");
    await expect(panes).toHaveCount(2);

    const unfocused = panes.filter({ has: page.locator('[data-focused="false"]') }).first();
    if (await unfocused.count()) {
      await unfocused.click({ position: { x: 20, y: 40 } });
      await expect(panes.filter({ has: page.locator('[data-focused="true"]') })).toHaveCount(1);
    }

    // 刷新：标签栏仍在（sessionStorage）；chat-input 分屏时可能有两个，取 first
    await page.reload();
    await page.goto("/chat");
    await page.getByTestId("chat-input").first().waitFor({ state: "visible", timeout: 30_000 });
    await expect(page.getByTestId("chat-tab-bar")).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => page.getByTestId("chat-tab").count()).toBeGreaterThanOrEqual(1);
  });
});
