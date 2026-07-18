import { test, expect } from "@playwright/test";
import { SERVER_URL, trpcQuery } from "./helpers/trpcE2e";
import {
  waitForChatReady,
  sendChatMessage,
  waitForStreamingComplete,
  selectAssistantAgent,
  expectAssistantAnswer,
} from "./helpers/mockChatFixture";

test.describe("Notify Parent Mock — 子 Agent 主动通知父会话", () => {
  test.beforeEach(async ({ request }) => {
    await expect
      .poll(async () => (await request.get(`${SERVER_URL}/health`)).ok())
      .toBe(true);
  });

  test("子 Agent 调用 agent_notify_parent 后，父会话收到通知并回复", async ({ page }) => {
    await waitForChatReady(page);
    await selectAssistantAgent(page);

    await sendChatMessage(page, "spawn notify parent");
    await waitForStreamingComplete(page);
    await expectAssistantAnswer(page, "已派生子 Agent");

    // 取父会话 ID，验证子 Agent 已通过 agent_notify_parent 写入 child_notify 队列项
    const parentSessionId = new URL(page.url()).searchParams.get("sessionId");
    if (!parentSessionId) throw new Error("父会话 URL 缺少 sessionId");

    await expect
      .poll(
        async () => {
          const items = await trpcQuery<
            Array<{ kind: string; content: string }>
          >("agent.listSessionQueueItems", { sessionId: parentSessionId });
          return items.find((i) => i.kind === "child_notify");
        },
        { timeout: 15_000, intervals: [500, 1000] },
      )
      .toBeTruthy();

    // 父 Agent 对通知生成回复（用文案可见性，避免 Virtuoso 离屏卸载导致 count 假失败）
    await expect(page.getByText("子 Agent 进度通知：任务进行中").first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("收到子 Agent 通知").first()).toBeVisible({
      timeout: 30_000,
    });
    await expectAssistantAnswer(page, "收到子 Agent 通知");
  });
});
