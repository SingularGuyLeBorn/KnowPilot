/**
 * 真实 LLM Chat E2E 辅助函数（走完整 UI + SSE，不 mock）
 */

import { expect, type Page, type Locator } from "@playwright/test";

export const DEFAULT_TIMEOUT = 120_000;
export const STREAMING_TIMEOUT = 90_000;

export async function waitForChatReady(page: Page): Promise<Locator> {
  await page.goto("/chat");
  // 分屏时可能有两个 chat-input：取焦点侧 / 首个
  const input = page.getByTestId("chat-input").first();
  await input.waitFor({ state: "visible", timeout: 30_000 });
  await expect(input).toBeEnabled({ timeout: 30_000 });
  return input;
}

export async function sendChatMessage(page: Page, text: string): Promise<void> {
  const focusedPane = page.getByTestId("chat-session-pane").filter({
    has: page.locator('[data-focused="true"]'),
  });
  const input =
    (await focusedPane.count()) > 0
      ? focusedPane.getByTestId("chat-input")
      : page.getByTestId("chat-input").first();
  const send =
    (await focusedPane.count()) > 0
      ? focusedPane.getByTestId("chat-send")
      : page.getByTestId("chat-send").first();
  await input.fill(text);
  await send.click();
}

export async function waitForStreamingComplete(page: Page): Promise<void> {
  const streamingBubble = page.getByTestId("streaming-assistant-bubble");
  const assistantBubbles = page.getByTestId("assistant-message-bubble");
  const start = Date.now();
  const prevCount = await assistantBubbles.count();
  const prevText = prevCount > 0 ? await assistantBubbles.nth(prevCount - 1).innerText() : "";

  const isResponseReady = async () => {
    const currentCount = await assistantBubbles.count();
    if (currentCount > prevCount) return true;
    if (currentCount > 0 && currentCount >= prevCount) {
      const currentText = await assistantBubbles.nth(currentCount - 1).innerText();
      if (currentText !== prevText && currentText.trim().length > 0) return true;
    }
    return false;
  };

  while (Date.now() - start < STREAMING_TIMEOUT) {
    // 正常路径：流式气泡出现后等待其消失，再确认最终消息已落地
    const bubbleCount = await streamingBubble.count();
    if (bubbleCount > 0) {
      const visible = await streamingBubble.first().isVisible().catch(() => false);
      if (visible) {
        await streamingBubble.waitFor({ state: "hidden", timeout: STREAMING_TIMEOUT });
        continue;
      }
    }

    // 极快响应：流式气泡可能在我们检查前就已经完成，以 assistant 消息出现或内容变化视为结束
    if (await isResponseReady()) return;

    await page.waitForTimeout(100);
  }
  throw new Error("流式响应未在预期时间内完成");
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
