import type { Page } from "@playwright/test";

/** 模拟 Agent SSE：先 round_start + thinking，延迟后再 done */
export async function mockAgentStream(
  page: Page,
  opts?: {
    holdMs?: number;
    thinking?: string;
    reply?: string;
    sessionId?: string;
  },
) {
  const holdMs = opts?.holdMs ?? 1500;
  const thinking = opts?.thinking ?? "正在分析目录结构…";
  const reply = opts?.reply ?? "content/agents 目录下有 assistant.md 等文件。";
  const sessionId = opts?.sessionId ?? "e2e-session-id";

  await page.route("**/api/agent/chat/stream", async (route) => {
    await new Promise((r) => setTimeout(r, holdMs));
    const donePayload = JSON.stringify({
      sessionId,
      agentId: "e2e-agent",
      content: reply,
      toolCalls: [],
      model: "deepseek-chat",
      provider: "deepseek",
      roundsUsed: 1,
      assistantMessageId: "e2e-assistant-msg",
      versionIndex: 0,
      versionCount: 1,
    });
    const body = [
      "event: round_start",
      'data: {"round":1}',
      "",
      "event: thinking",
      `data: ${JSON.stringify({ delta: thinking })}`,
      "",
      "event: token",
      `data: ${JSON.stringify({ delta: reply })}`,
      "",
      "event: done",
      `data: ${donePayload}`,
      "",
    ].join("\n");

    await route.fulfill({
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
      body,
    });
  });
}

/** 流式响应：立即返回 round_start + thinking（无 done），便于断言 UI */
export async function mockAgentStreamHoldOpen(page: Page) {
  await page.route("**/api/agent/chat/stream", async (route) => {
    const body = [
      "event: round_start",
      'data: {"round":1}',
      "",
      "event: thinking",
      'data: {"delta":"分析 content/agents …"}',
      "",
    ].join("\n");

    await route.fulfill({
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
      body,
    });
  });
}
