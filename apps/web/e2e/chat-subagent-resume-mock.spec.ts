import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { SERVER_URL } from "./helpers/trpcE2e";
import {
  waitForChatReady,
  sendChatMessage,
  waitForStreamingComplete,
  expectToolPill,
  expectAssistantAnswer,
  selectAssistantAgent,
} from "./helpers/mockChatFixture";

test.describe("Subagent Mock — 刷新后父会话流式恢复", () => {
  test.beforeEach(async ({ request }) => {
    await expect
      .poll(async () => (await request.get(`${SERVER_URL}/health`)).ok())
      .toBe(true);
  });

  test("spawn_subagent waitForResult=true 时刷新，父会话应恢复并收到子 Agent 结果", async ({ page }, testInfo) => {
    const logs: string[] = [];
    page.on("console", (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
    page.on("pageerror", (err) => logs.push(`[pageerror] ${err.message}`));

    await page.route("**/api/agent/chat/stream", async (route, request) => {
      logs.push(`[network] ${request.method()} ${request.url()}`);
      await route.continue();
    });

    try {
      await waitForChatReady(page);
      await selectAssistantAgent(page);

      await page.evaluate(() => {
        sessionStorage.setItem("kp:test", "hello");
      });

      // 触发父 Agent 阻塞派生子 Agent（waitForResult=true），子 Agent 会 sleep 3s
      await sendChatMessage(page, "派子 Agent 慢速总结");

      // 等待 spawn_subagent 工具 pill 出现，说明已开始工具调用、lastEventId > 0
      await expectToolPill(page, "spawn_subagent");

      const rawStatesBefore = await page.evaluate(() => ({
        test: sessionStorage.getItem("kp:test"),
        stream: sessionStorage.getItem("kp:chat-stream-states"),
      }));
      logs.push(`[sessionStorage before reload] ${JSON.stringify(rawStatesBefore)}`);

      // 模拟用户刷新页面：切断 SSE 并丢失内存状态
      await page.reload();

      // 刷新后先回到 /chat，等待侧边栏加载并点击最新会话
      await page.getByTestId("chat-input").waitFor({ state: "visible", timeout: 30_000 });

      const rawStates = await page.evaluate(() => ({
        test: sessionStorage.getItem("kp:test"),
        stream: sessionStorage.getItem("kp:chat-stream-states"),
      }));
      logs.push(`[sessionStorage after reload] ${JSON.stringify(rawStates)}`);

      await page.getByTestId("session-list-item").first().click();

      // 等待流式结束并生成最终回复（resume 后父 Agent 基于子 Agent 结果继续生成）
      await waitForStreamingComplete(page);

      // 父 Agent 基于子 Agent 结果给出最终回复
      await expectAssistantAnswer(page, "父 Agent 已收到子 Agent 结果");

      // 子 Agent 结果消息出现在父会话（source=sub）
      await expect(page.getByText("子 Agent 慢速总结已完成")).toBeVisible({ timeout: 10_000 });
    } finally {
      const logPath = path.join(testInfo.outputDir, "browser-logs.txt");
      fs.mkdirSync(testInfo.outputDir, { recursive: true });
      fs.writeFileSync(logPath, logs.join("\n"), "utf8");
    }
  });

  test("spawn_subagent waitForResult=true 不刷新也应正常完成", async ({ page }) => {
    await waitForChatReady(page);
    await selectAssistantAgent(page);
    await sendChatMessage(page, "派子 Agent 慢速总结");
    await waitForStreamingComplete(page);
    await expectAssistantAnswer(page, "父 Agent 已收到子 Agent 结果");
    await expect(page.getByText("子 Agent 慢速总结已完成")).toBeVisible({ timeout: 10_000 });
  });

  test("spawn_subagent waitForResult=true 时切到别的 session 再切回，父会话应恢复并完成", async ({ page }) => {
    await waitForChatReady(page);
    await selectAssistantAgent(page);

    // 父会话开始派生子 Agent
    await sendChatMessage(page, "派子 Agent 慢速总结");
    await expectToolPill(page, "spawn_subagent");

    // 切到新会话并发送一条普通消息
    await page.getByLabel("新建对话").click();
    await page.getByTestId("chat-input").waitFor({ state: "visible", timeout: 10_000 });
    await sendChatMessage(page, "你好");
    await waitForStreamingComplete(page);

    // 切回父会话（按标题找）
    const parentItem = page.getByTestId("session-list-item").filter({ hasText: "派子 Agent 慢速总结" }).first();
    await expect(parentItem).toBeVisible({ timeout: 10_000 });
    await parentItem.click();

    // 父会话应继续流式并完成
    await waitForStreamingComplete(page);
    await expectAssistantAnswer(page, "父 Agent 已收到子 Agent 结果");
    await expect(page.getByText("子 Agent 慢速总结已完成")).toBeVisible({ timeout: 10_000 });
  });

  test("spawn_subagent waitForResult=true 时切换 Agent 再切回，父会话仍应在后台更新并完成", async ({ page }) => {
    await waitForChatReady(page);
    await selectAssistantAgent(page);

    // 父会话开始派生子 Agent
    await sendChatMessage(page, "派子 Agent 慢速总结");
    await expectToolPill(page, "spawn_subagent");

    // 记录当前 Agent，稍后切回
    const currentAgentName = (await page.getByTestId("agent-tree-select").textContent())?.trim() ?? "";
    expect(currentAgentName.length).toBeGreaterThan(0);

    // 打开 Agent 选择器并切换到另一个 Agent
    await page.getByTestId("agent-tree-select").click();
    const menu = page.getByTestId("agent-tree-select-menu");
    await menu.waitFor({ state: "visible", timeout: 10_000 });
    const options = menu.locator("button[role='option']");
    const optionCount = await options.count();
    expect(optionCount).toBeGreaterThan(1);

    let switched = false;
    for (let i = 0; i < optionCount; i++) {
      const text = (await options.nth(i).textContent())?.trim() ?? "";
      if (text && !text.includes(currentAgentName)) {
        await options.nth(i).click();
        switched = true;
        break;
      }
    }
    expect(switched).toBe(true);

    // 切到另一个 Agent 后，原父会话会从列表中过滤掉，但后台运行应继续
    await expect(page.getByTestId("agent-tree-select")).not.toContainText(currentAgentName);

    // 切回原 Agent，使父会话重新出现
    await page.getByTestId("agent-tree-select").click();
    const menu2 = page.getByTestId("agent-tree-select-menu");
    await menu2.locator("button[role='option']").filter({ hasText: currentAgentName }).first().click();

    // 点回父会话，应继续流式并完成
    const parentItem = page.getByTestId("session-list-item").filter({ hasText: "派子 Agent 慢速总结" }).first();
    await expect(parentItem).toBeVisible({ timeout: 10_000 });
    await parentItem.click();

    await waitForStreamingComplete(page);
    await expectAssistantAnswer(page, "父 Agent 已收到子 Agent 结果");
    await expect(page.getByText("子 Agent 慢速总结已完成")).toBeVisible({ timeout: 10_000 });
  });
});
