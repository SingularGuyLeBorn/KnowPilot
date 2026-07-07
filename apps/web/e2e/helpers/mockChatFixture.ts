/**
 * Mock LLM Chat E2E 辅助函数
 *
 * 与 realChatFixture 复用同一套 UI 操作，但额外提供 mock 场景断言封装。
 * 注意：waitForStreamingComplete 在此覆盖为「等 assistant 气泡出现」，
 * 因为 Mock 流式极快（~240ms），realChatFixture 的「先等 streaming visible 再等 hidden」
 * 会因为 Playwright 错过短暂的 visible 窗口而误判超时。
 */

import { expect, type Page } from "@playwright/test";
export { waitForChatReady, sendChatMessage, countAssistantMessages, lastAssistantText } from "./realChatFixture";

/**
 * Mock 模式专用：等流式结束。
 * 策略：等待 assistant-message-bubble 出现（流式完成的标志）。
 * Mock 流式极快（~240ms），realChatFixture 的「先等 streaming visible 再等 hidden」
 * 会因 Playwright 错过短暂 visible 窗口而误判超时，故改用此实现。
 */
export async function waitForStreamingComplete(page: Page): Promise<void> {
  const assistantBubble = page.getByTestId("assistant-message-bubble");
  const streamingBubble = page.getByTestId("streaming-assistant-bubble");
  await expect
    .poll(() => assistantBubble.count(), { timeout: 30_000, intervals: [200, 500, 1000] })
    .toBeGreaterThan(0);
  // 兜底：等 streaming bubble 真正消失，避免后续断言遇到残留
  await streamingBubble.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
}

export async function expectToolPill(page: import("@playwright/test").Page, name: string): Promise<void> {
  await expect(page.getByTestId("tool-pill").filter({ hasText: name })).toBeVisible({ timeout: 15_000 });
}

export async function expectToolHint(page: import("@playwright/test").Page, text: string): Promise<void> {
  const hint = page.getByTestId("tool-timing-hint").first();
  await expect(hint).toBeVisible({ timeout: 15_000 });
  await expect(hint).toContainText(text);
}

export async function expectThinkingTimeline(page: Page): Promise<void> {
  await expect(page.getByTestId("thinking-timeline")).toBeVisible({ timeout: 15_000 });
}

export async function expectAssistantAnswer(page: Page, text: string): Promise<void> {
  const last = await (await import("./realChatFixture")).lastAssistantText(page);
  expect(last).toContain(text);
}
