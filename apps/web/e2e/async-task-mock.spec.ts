import { test, expect } from "@playwright/test";
import { SERVER_URL, trpcMutate, trpcQuery } from "./helpers/trpcE2e";
import { seedAsyncQueueTasks, cleanupAsyncQueueTasks } from "./helpers/asyncQueueFixture";
import {
  waitForChatReady,
  sendChatMessage,
  waitForStreamingComplete,
  countAssistantMessages,
} from "./helpers/mockChatFixture";

test.describe("Chat Mock — 异步任务队列", () => {
  test.beforeEach(async ({ request }) => {
    await expect
      .poll(async () => (await request.get(`${SERVER_URL}/health`)).ok())
      .toBe(true);
  });

  test("async_task_run 后台任务完成后结果自动插入对话", async ({ page }) => {
    const logs: string[] = [];
    page.on("console", (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
    page.on("pageerror", (err) => logs.push(`[pageerror] ${err.message}`));

    await waitForChatReady(page);
    await sendChatMessage(page, "请启动一个后台任务总结当前项目");

    // 异步任务进度在左侧「运行」面板展示
    await page.getByTestId("left-tab-runtime").click();

    // 父会话时间线应实时显示后台任务进度（在流式/结果消费期间任一时间点出现即可）
    try {
      await expect
        .poll(async () => page.getByTestId("async-progress-step").count(), {
          timeout: 10_000,
          intervals: [50],
        })
        .toBeGreaterThanOrEqual(1);
    } catch (e) {
      console.log("=== debug logs ===\n" + logs.join("\n"));
      throw e;
    }

    await waitForStreamingComplete(page);

    // 异步任务完成后会额外产生一条 assistant 消息（子 Agent 结果）
    await expect
      .poll(async () => countAssistantMessages(page), {
        timeout: 30_000,
        intervals: [500, 1000],
      })
      .toBeGreaterThanOrEqual(2);

    // 结果消息中包含 Mock LLM 的兜底回复
    const pageText = await page.locator("[data-testid='assistant-message-bubble']").allTextContents();
    expect(pageText.some((t) => t.includes("Mock LLM"))).toBe(true);
  });

  test("左栏运行「同步任务」分组：卡片可见、无钉住/发送按钮，切回「异步队列」不回归", async ({ page }) => {
    // 准备：创建会话并写入同步任务（deliverToQueue=false，结果走 tool return，只展示不进队列）
    const agents = await trpcQuery<{ items: { id: string; name: string; model: string; systemPrompt: string }[] }>(
      "agent.list",
      { page: 1, pageSize: 20 },
    );
    const agent = agents.items.find((a) => a.name === "assistant") ?? agents.items[0];
    if (!agent) throw new Error("E2E 需要至少一个 Agent");
    const sessionRes = await trpcMutate<{ success: boolean; data?: { id: string }; error?: { message?: string } }>(
      "session.create",
      { title: `E2E 同步任务 ${Date.now()}`, model: agent.model, systemPrompt: agent.systemPrompt },
    );
    if (!sessionRes.success || !sessionRes.data) {
      throw new Error(sessionRes.error?.message ?? "session.create 失败");
    }
    const sessionId = sessionRes.data.id;

    await seedAsyncQueueTasks(sessionId, {
      syncTasks: [
        { taskLabel: "E2E 同步运行中", status: "running" },
        { taskLabel: "E2E 同步已完成", status: "success", asyncResult: "E2E-SYNC-RESULT 同步任务结果全文" },
      ],
    });

    try {
      await page.goto(`/chat?sessionId=${sessionId}`);
      await page.getByTestId("chat-input").waitFor({ state: "visible", timeout: 30_000 });
      // 等 URL 深链会话落入焦点 pane（chat-input 在新对话页也可见，不能单靠它判定）
      await expect(page.locator('[data-testid="chat-session-pane"][data-session-id="' + sessionId + '"]')).toBeVisible({
        timeout: 15_000,
      });

      // 切到左栏「运行」→ 一级分组「同步任务」
      await page.getByTestId("left-tab-runtime").click();
      await page.getByTestId("runtime-group-sync").click();

      // 卡片可见：进行中（running）+ 已结束（completed）各一，结果预览 ~120 字
      const syncList = page.getByTestId("sync-task-list");
      await expect(syncList.getByTestId("sync-task-card")).toHaveCount(2, { timeout: 10_000 });
      await expect(syncList).toContainText("E2E 同步运行中");
      await expect(syncList).toContainText("E2E 同步已完成");
      await expect(syncList).toContainText("E2E-SYNC-RESULT");

      // 无钉住 / 无发送（消费）按钮：同步任务只展示，不可 pin、不可喂入气泡
      await expect(syncList.getByTitle("置顶", { exact: true })).toHaveCount(0);
      await expect(syncList.getByTitle("取消置顶", { exact: true })).toHaveCount(0);
      await expect(syncList.getByTitle("发送", { exact: true })).toHaveCount(0);
      await expect(syncList.getByRole("button", { name: /发送|喂入|消费/ })).toHaveCount(0);

      // 切回「异步队列」：TP-3 三组状态模型（进行中/待消费/已消费）与容器不回归
      await page.getByTestId("runtime-group-async").click();
      const asyncPanel = page.getByTestId("chat-runtime-queue");
      await expect(asyncPanel).toBeVisible();
      await expect(asyncPanel).toContainText("进行中");
      await expect(asyncPanel).toContainText("待消费");
      await expect(asyncPanel).toContainText("已消费");
    } finally {
      await cleanupAsyncQueueTasks(sessionId);
    }
  });
});
