import { test, expect } from "@playwright/test";
import { SERVER_URL, trpcMutate, trpcQuery } from "./helpers/trpcE2e";
import { expectAssistantAnswer } from "./helpers/mockChatFixture";

/**
 * C-3 会话手动恢复闭环（v10）：paused 会话点「恢复运行」→ 服务端起流 → mock LLM 回复落库
 * → 终态归位 active → 刷新水合后 UI 完整可见。
 *
 * 数据构造：tRPC 造会话 + 预置 user/assistant 历史链 → session.update 置 paused
 * （模拟 R-2 重启首扫把僵尸 running 会话标 paused 后的现场）。
 *
 * 断言口径说明（为什么走「DB 终态 → 刷新水合」而非「等 UI 实时气泡」）：
 * Mock LLM 流 ~240ms 即完成，可能快于 listRunning invalidate 的 refetch 往返——
 * 若 refetch 返回时流已 done，INV-5 挂接 effect 收不到该会话，UI 实时气泡路径根本不触发，
 * 「等 UI 气泡」会因这个竞态间歇性变红（且预置历史链已有 1 条 assistant 气泡，
 * mockChatFixture.waitForStreamingComplete 的「有气泡即完成」判定会被历史链直接命中）。
 * 故本例确定性断言：① 横幅/按钮交互（无按钮 → 红）；② DB 终态与消息落库（无 resume → 红）；
 * ③ 刷新水合完整性（终态归位缺失 → 红）。实时挂接 SSE 路径由 chat-resume-mock /
 * chat-subagent-resume-mock 覆盖，不在本例重复赌时序。
 */

type ApiResult<T> = { success: boolean; data?: T; error?: { message?: string } };
type AgentList = { items: Array<{ id: string; name: string; model: string; systemPrompt: string }> };

test.describe("Chat Mock — paused 会话手动恢复", () => {
  test.beforeEach(async ({ request }) => {
    await expect.poll(async () => (await request.get(`${SERVER_URL}/health`)).ok()).toBe(true);
  });

  test("paused 会话点「恢复运行」→ mock LLM 回复落库 → 终态归位 active → 水合完整", async ({ page }) => {
    // 造 paused 会话（预置 user + assistant 扁平链）
    const agents = await trpcQuery<AgentList>("agent.list", { page: 1, pageSize: 20 });
    const agent = agents.items.find((a) => a.name === "assistant") ?? agents.items[0];
    if (!agent) throw new Error("E2E 需要至少一个 Agent，请先 pnpm db:seed");

    const title = `E2E 手动恢复 ${Date.now()}`;
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

    await trpcMutate("message.create", { sessionId, role: "user", content: "历史问题：请记住数字 42" });
    await trpcMutate("message.create", { sessionId, role: "assistant", content: "历史回答：已记住 42。" });
    await trpcMutate("session.update", { id: sessionId, status: "paused" });

    try {
      await page.goto(`/chat?sessionId=${sessionId}`);
      await page.getByTestId("chat-input").waitFor({ state: "visible", timeout: 30_000 });

      // paused 横幅 + 「恢复运行」按钮可见；预置历史链仍在
      await expect(page.getByTestId("session-resume-banner")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText("历史回答：已记住 42。")).toBeVisible();

      // 点「恢复运行」→ mutation 成功 → getById invalidate → 状态非 paused，横幅消失
      await page.getByTestId("resume-session-button").click();
      await expect(page.getByTestId("session-resume-banner")).toBeHidden({ timeout: 15_000 });

      // 服务端闭环：终态归位 active（done → 主会话回 active，见 services.resume 终态归位不变量）
      await expect
        .poll(async () => (await trpcQuery<{ status: string }>("session.getById", { id: sessionId })).status, {
          timeout: 30_000,
        })
        .toBe("active");
      // Mock LLM 回复落库：assistant 总数 = 2（预置 1 + 恢复新增 1，不重复、不丢失）
      await expect
        .poll(
          async () => {
            const list = await trpcQuery<{ items: Array<{ role: string }> }>("message.list", {
              sessionId,
              page: 1,
              pageSize: 100,
            });
            return list.items.filter((m) => m.role === "assistant").length;
          },
          { timeout: 30_000 },
        )
        .toBe(2);

      // 刷新水合：历史链 + 注入的系统续跑消息 + Mock 回复全部可见；横幅不再出现
      await page.reload();
      await page.getByTestId("chat-input").waitFor({ state: "visible", timeout: 30_000 });
      await expect(page.getByText("历史回答：已记住 42。")).toBeVisible();
      await expect(page.getByText("服务已重启，请继续完成未完成的任务")).toBeVisible();
      await expectAssistantAnswer(page, "Mock LLM");
      await expect(page.getByTestId("session-resume-banner")).toBeHidden();
    } finally {
      await trpcMutate("session.delete", { id: sessionId }).catch(() => {});
    }
  });
});
