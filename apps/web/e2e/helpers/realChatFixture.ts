/**
 * 真实 LLM Chat E2E 辅助函数（走完整 UI + SSE，不 mock）
 */

import { expect, type Page, type Locator } from "@playwright/test";

export const DEFAULT_TIMEOUT = 120_000;
export const STREAMING_TIMEOUT = 90_000;

export async function waitForChatReady(page: Page): Promise<Locator> {
  await page.goto("/chat");
  const input = page.getByTestId("chat-input");
  await input.waitFor({ state: "visible", timeout: 30_000 });
  await expect(input).toBeEnabled({ timeout: 30_000 });
  return input;
}

export async function sendChatMessage(page: Page, text: string): Promise<void> {
  const input = page.getByTestId("chat-input");
  await input.fill(text);
  await page.getByTestId("chat-send").click();
}

export async function waitForStreamingComplete(page: Page): Promise<void> {
  const streamingBubble = page.getByTestId("streaming-assistant-bubble");
  await streamingBubble.waitFor({ state: "visible", timeout: STREAMING_TIMEOUT });
  await streamingBubble.waitFor({ state: "hidden", timeout: STREAMING_TIMEOUT });
}

export function countUserMessages(page: Page): Promise<number> {
  return page.getByTestId("user-message-bubble").count();
}

export function countAssistantMessages(page: Page): Promise<number> {
  return page.getByTestId("assistant-message-bubble").count();
}

export async function lastAssistantText(page: Page): Promise<string> {
  const bubbles = page.getByTestId("assistant-message-bubble");
  const count = await bubbles.count();
  if (count === 0) return "";
  return bubbles.nth(count - 1).innerText();
}
