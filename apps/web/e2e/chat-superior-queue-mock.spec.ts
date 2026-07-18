import { test, expect } from "@playwright/test";
import { SERVER_URL, trpcQuery, trpcMutate } from "./helpers/trpcE2e";
import {
  waitForChatReady,
  sendChatMessage,
  waitForStreamingComplete,
  selectAssistantAgent,
} from "./helpers/mockChatFixture";

/**
 * Superior / child_notify 发送队列实时性 + 单次消费。
 *
 * 覆盖：
 * 1. 打开子会话时，通过 tRPC 写入 superior 队列项 → 不刷新即可在待发队列看到非空内容
 * 2. 消费删除后队列面板收起（SSE merge 对齐）
 * 3. child_notify：通知气泡只出现一次，消费后队列为空
 */

test.describe("Superior Queue Mock — 实时队列与单次消费", () => {
  test.beforeEach(async ({ request }) => {
    await expect
      .poll(async () => (await request.get(`${SERVER_URL}/health`)).ok())
      .toBe(true);
  });

  test("子会话打开时 superior 入队实时可见且内容非空，消费后消失", async ({ page }) => {
    const agents = await trpcQuery<{
      items: Array<{ id: string; name: string; tier: string; workspaceId: string | null; model: string }>;
    }>("agent.list", { page: 1, pageSize: 20 });
    const parentAgent =
      agents.items.find((a) => a.name === "assistant" && a.tier === "manager") ??
      agents.items.find((a) => a.tier === "manager");
    if (!parentAgent?.workspaceId) {
      throw new Error("E2E 需要带 workspaceId 的 manager Agent");
    }

    const subName = `SupQ-Sub-${Date.now().toString(36)}`;
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
      systemPrompt: "测试子 Agent",
      tools: ["native:sleep"],
      source: "e2e-test",
    });
    if (!subAgentRes.success || !subAgentRes.data) {
      throw new Error(subAgentRes.error?.message ?? "子 Agent 创建失败");
    }
    const subAgentId = subAgentRes.data.id;

    const subSessionRes = await trpcMutate<{
      success: boolean;
      data?: { id: string };
      error?: { message?: string };
    }>("session.create", {
      title: `SupQ-Child-${Date.now()}`,
      model: parentAgent.model,
      agentId: subAgentId,
      kind: "subagent",
      isMainSession: true,
    });
    if (!subSessionRes.success || !subSessionRes.data) {
      throw new Error(subSessionRes.error?.message ?? "子会话创建失败");
    }
    const subSessionId = subSessionRes.data.id;

    try {
      await page.goto(`/chat?sessionId=${subSessionId}`);
      await page.getByTestId("chat-input").waitFor({ state: "visible", timeout: 30_000 });

      const msgB = `SUPERIOR-UI-B-${Date.now().toString(36)}`;
      const msgC = `SUPERIOR-UI-C-${Date.now().toString(36)}`;

      const createdB = await trpcMutate<{
        success: boolean;
        data?: { id: string };
      }>("agent.createSessionQueueItem", {
        sessionId: subSessionId,
        kind: "superior",
        content: msgB,
        source: parentAgent.id,
        sourceName: parentAgent.name,
      });
      const createdC = await trpcMutate<{
        success: boolean;
        data?: { id: string };
      }>("agent.createSessionQueueItem", {
        sessionId: subSessionId,
        kind: "superior",
        content: msgC,
        source: parentAgent.id,
        sourceName: parentAgent.name,
      });
      expect(createdB.success).toBe(true);
      expect(createdC.success).toBe(true);

      // DB 已写入；前端靠 SSE 重放 / 3s 轮询 / merge 水合，不刷新也应出现
      await expect
        .poll(async () => page.getByTestId("chat-queue-panel").count(), {
          timeout: 20_000,
          intervals: [300, 500, 1000],
        })
        .toBe(1);

      const queuePanel = page.getByTestId("chat-queue-panel");
      await expect(queuePanel).toContainText("待发消息 2", { timeout: 10_000 });

      // 展开后才能看到条目正文（默认折叠只显示计数）
      await queuePanel.getByRole("button", { name: /待发消息/ }).click();
      await expect(queuePanel.getByTestId("chat-queue-item-superior")).toHaveCount(2, {
        timeout: 15_000,
      });
      await expect(queuePanel.getByText(msgB)).toBeVisible();
      await expect(queuePanel.getByText(msgC)).toBeVisible();

      // 内容非空：卡片文本不是空白/仅标签
      const texts = await queuePanel.getByTestId("chat-queue-item-superior").allTextContents();
      for (const t of texts) {
        expect(t.replace(/\s+/g, " ").trim().length).toBeGreaterThan(8);
      }

      // 消费一条后 SSE merge：面板剩 1 条
      const idB = createdB.data!.id;
      await trpcMutate("agent.consumeSessionQueueItem", { id: idB });
      await expect(queuePanel.getByTestId("chat-queue-item-superior")).toHaveCount(1, {
        timeout: 15_000,
      });
      await expect(queuePanel.getByText(msgB)).toHaveCount(0);
      await expect(queuePanel.getByText(msgC)).toBeVisible();

      // 消费完：面板消失
      await trpcMutate("agent.consumeSessionQueueItem", { id: createdC.data!.id });
      await expect(queuePanel).toBeHidden({ timeout: 15_000 });
    } finally {
      await trpcMutate("session.delete", { id: subSessionId }).catch(() => {});
      await trpcMutate("agent.delete", { id: subAgentId }).catch(() => {});
    }
  });

  test("child_notify 消费后只产生一条父回复气泡，队列为空", async ({ page }) => {
    await waitForChatReady(page);
    await selectAssistantAgent(page);

    await sendChatMessage(page, "spawn notify parent");
    await waitForStreamingComplete(page);

    const parentSessionId = new URL(page.url()).searchParams.get("sessionId");
    if (!parentSessionId) throw new Error("父会话 URL 缺少 sessionId");

    // 通知正文与父回复各出现一次（Virtuoso 可能卸载离屏节点，故用 toBeVisible 而非 count）
    await expect(page.getByText("子 Agent 进度通知：任务进行中").first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("收到子 Agent 通知").first()).toBeVisible({
      timeout: 30_000,
    });

    // 通知气泡不得连发两遍
    await expect(page.getByText("子 Agent 进度通知：任务进行中")).toHaveCount(1);

    // 消费完成后父会话发送队列应为空
    await expect
      .poll(
        async () => {
          const items = await trpcQuery<Array<{ kind: string }>>(
            "agent.listSessionQueueItems",
            { sessionId: parentSessionId },
          );
          return items.filter((i) => i.kind === "child_notify").length;
        },
        { timeout: 20_000, intervals: [500, 1000] },
      )
      .toBe(0);

    await expect(page.getByTestId("chat-queue-panel")).toBeHidden({ timeout: 10_000 });
  });
});
