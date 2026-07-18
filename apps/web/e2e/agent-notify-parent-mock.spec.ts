import { test, expect } from "@playwright/test";
import { SERVER_URL, trpcQuery, trpcMutate } from "./helpers/trpcE2e";
import {
  sendChatMessage,
  waitForStreamingComplete,
} from "./helpers/mockChatFixture";

/**
 * Agent Notify Parent Mock — 子 Agent 在子会话中调用 agent_notify_parent，
 * 父会话应出现来自子 Agent 的通知气泡并作出回复。
 *
 * 与 chat-notify-parent-mock.spec.ts 的区别：
 * - 本例直接通过 tRPC 构造子会话，从子会话视角触发通知；
 * - 覆盖 Agent 创建 → 子会话 → notify → 父会话 UI 呈现的完整链路。
 */

test.describe("Agent Notify Parent Mock — 子 Agent 从子会话通知父会话", () => {
  test.beforeEach(async ({ request }) => {
    await expect
      .poll(async () => (await request.get(`${SERVER_URL}/health`)).ok())
      .toBe(true);
  });

  test("子 Agent 调用 agent_notify_parent 后，父会话出现来自子 Agent 的气泡", async ({
    page,
  }) => {
    // 1. 找到 E2E 默认 manager Agent 作为父 Agent
    const agents = await trpcQuery<{
      items: Array<{
        id: string;
        name: string;
        tier: string;
        workspaceId: string | null;
        model: string;
      }>;
    }>("agent.list", { page: 1, pageSize: 20 });
    const parentAgent =
      agents.items.find((a) => a.name === "assistant" && a.tier === "manager") ??
      agents.items.find((a) => a.tier === "manager");
    if (!parentAgent?.workspaceId) {
      throw new Error("E2E 需要至少一个带 workspaceId 的 manager Agent");
    }

    // 2. 创建父会话
    const parentSessionRes = await trpcMutate<{
      success: boolean;
      data?: { id: string };
      error?: { message?: string };
    }>("session.create", {
      title: `Notify-Parent-${Date.now()}`,
      model: parentAgent.model,
      agentId: parentAgent.id,
    });
    if (!parentSessionRes.success || !parentSessionRes.data) {
      throw new Error(
        parentSessionRes.error?.message ?? "父会话创建失败",
      );
    }
    const parentSessionId = parentSessionRes.data.id;

    // 3. 创建子 Agent（仅赋予 agent_notify_parent，模拟最小权限）
    const subName = `Notify-Sub-${Date.now().toString(36)}`;
    const subAgentRes = await trpcMutate<{
      success: boolean;
      data?: { id: string };
      error?: { message?: string };
    }>("agent.create", {
      name: subName,
      tier: "sub",
      parentId: parentAgent.id,
      workspaceId: parentAgent.workspaceId,
      model: parentAgent.model,
      systemPrompt: "当用户要求通知父会话时，调用 agent_notify_parent 工具。",
      tools: ["native:agent_notify_parent"],
      source: "e2e-test",
    });
    if (!subAgentRes.success || !subAgentRes.data) {
      throw new Error(subAgentRes.error?.message ?? "子 Agent 创建失败");
    }
    const subAgentId = subAgentRes.data.id;

    // 4. 创建子会话并绑定父会话
    const subSessionRes = await trpcMutate<{
      success: boolean;
      data?: { id: string };
      error?: { message?: string };
    }>("session.create", {
      title: `Notify-Child-${Date.now()}`,
      model: parentAgent.model,
      agentId: subAgentId,
      kind: "subagent",
      parentSessionId,
      isMainSession: true,
    });
    if (!subSessionRes.success || !subSessionRes.data) {
      throw new Error(
        subSessionRes.error?.message ?? "子会话创建失败",
      );
    }
    const subSessionId = subSessionRes.data.id;

    try {
      // 5. 在子会话中触发 agent_notify_parent
      await page.goto(`/chat?sessionId=${subSessionId}`);
      await page
        .getByTestId("chat-input")
        .waitFor({ state: "visible", timeout: 30_000 });

      await sendChatMessage(page, "通知父会话");
      await waitForStreamingComplete(page);

      // 6. 切换到父会话，等待前端合并队列并 drain 消费
      await page.goto(`/chat?sessionId=${parentSessionId}`);
      await page
        .getByTestId("chat-input")
        .waitFor({ state: "visible", timeout: 30_000 });

      // 来自子 Agent 的通知内容应出现在消息列表
      await expect(
        page.getByText("子 Agent 进度通知：任务进行中").first(),
      ).toBeVisible({ timeout: 30_000 });

      // 消息角标应显示「来自子 Agent」
      await expect(page.getByText("来自子 Agent").first()).toBeVisible({
        timeout: 15_000,
      });

      // 父 Agent 已针对通知作出回复
      await expect(page.getByText("收到子 Agent 通知").first()).toBeVisible({
        timeout: 30_000,
      });
    } finally {
      // 7. 清理
      await trpcMutate("session.delete", { id: subSessionId }).catch(
        () => {},
      );
      await trpcMutate("session.delete", { id: parentSessionId }).catch(
        () => {},
      );
      await trpcMutate("agent.delete", { id: subAgentId }).catch(() => {});
    }
  });
});
