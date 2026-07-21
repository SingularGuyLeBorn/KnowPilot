import { test, expect } from "@playwright/test";
import { SERVER_URL, trpcMutate, trpcQuery } from "./helpers/trpcE2e";
import { expectAssistantAnswer } from "./helpers/mockChatFixture";

/**
 * 用户软暂停后的 UI/续跑闭环（与 server T12 互补）：
 * - Server：hub.stop("user") → paused + 保留队列（sessionResume T12）
 * - 本例：finishReason=aborted 的 paused 现场 → 横幅文案 → 恢复运行
 *   → 注入「用户暂停了生成」而非「服务已重启」→ mock 续跑落库
 */

type ApiResult<T> = { success: boolean; data?: T; error?: { message?: string } };
type AgentList = { items: Array<{ id: string; name: string; model: string; systemPrompt: string }> };

test.describe("Chat Mock — 用户软暂停后恢复", () => {
  test.beforeEach(async ({ request }) => {
    await expect.poll(async () => (await request.get(`${SERVER_URL}/health`)).ok()).toBe(true);
  });

  test("paused+aborted 半截气泡 → 恢复运行注入用户暂停文案 → 续跑落库", async ({ page }) => {
    const agents = await trpcQuery<AgentList>("agent.list", { page: 1, pageSize: 20 });
    const agent = agents.items.find((a) => a.name === "assistant") ?? agents.items[0];
    if (!agent) throw new Error("E2E 需要至少一个 Agent，请先 pnpm db:seed");

    const title = `E2E 软暂停 ${Date.now()}`;
    const sessionRes = await trpcMutate<ApiResult<{ id: string }>>("session.create", {
      title,
      model: agent.model,
      systemPrompt: agent.systemPrompt,
      agentId: agent.id,
    });
    if (!sessionRes.success || !sessionRes.data) {
      throw new Error(sessionRes.error?.message ?? "session.create 失败");
    }
    const sessionId = sessionRes.data.id;

    await trpcMutate("message.create", {
      sessionId,
      role: "user",
      content: "请开始写长文，中途我会暂停",
    });
    await trpcMutate("message.create", {
      sessionId,
      role: "assistant",
      content: "半截回复：第一章已经写好了……",
      finishReason: "aborted",
    });
    await trpcMutate("session.update", { id: sessionId, status: "paused" });

    try {
      await page.goto(`/chat?sessionId=${sessionId}`);
      await page.getByTestId("chat-input").waitFor({ state: "visible", timeout: 30_000 });

      await expect(page.getByTestId("session-resume-banner")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId("session-resume-banner")).toContainText("会话已暂停，可恢复继续");
      await expect(page.getByText("半截回复：第一章已经写好了……")).toBeVisible();

      await page.getByTestId("resume-session-button").click();
      await expect(page.getByTestId("session-resume-banner")).toBeHidden({ timeout: 15_000 });

      await expect
        .poll(async () => (await trpcQuery<{ status: string }>("session.getById", { id: sessionId })).status, {
          timeout: 30_000,
        })
        .toBe("active");

      await page.reload();
      await page.getByTestId("chat-input").waitFor({ state: "visible", timeout: 30_000 });
      await expect(page.getByText("半截回复：第一章已经写好了……")).toBeVisible();
      await expect(page.getByText("用户暂停了生成")).toBeVisible();
      await expect(page.getByText("服务已重启")).toHaveCount(0);
      await expectAssistantAnswer(page, "Mock LLM");
      await expect(page.getByTestId("session-resume-banner")).toBeHidden();
    } finally {
      await trpcMutate("session.delete", { id: sessionId }).catch(() => {});
    }
  });
});
