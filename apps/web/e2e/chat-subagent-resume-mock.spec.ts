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

async function waitForSessionId(page: import("@playwright/test").Page, timeout = 10_000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const id = new URL(page.url()).searchParams.get("sessionId");
    if (id) return id;
    await page.waitForTimeout(200);
  }
  throw new Error("等待 URL 出现 sessionId 超时");
}

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
      const parentSessionId = await waitForSessionId(page);

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

      await page.goto(`/chat?sessionId=${parentSessionId}`);
      await page.getByTestId("chat-input").waitFor({ state: "visible", timeout: 30_000 });

      // 等待流式结束并生成最终回复（resume 后父 Agent 基于子 Agent 结果继续生成）
      await waitForStreamingComplete(page);

      // 父 Agent 基于子 Agent 结果给出最终回复
      await expectAssistantAnswer(page, "父 Agent 已收到子 Agent 结果");

      // 子 Agent 结果通过 assistant 总结展示，不再显示原始 source=sub 占位气泡。
      await expectAssistantAnswer(page, "慢速总结已完成");
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
    // 子 Agent 结果通过 assistant 总结展示，不再显示原始 source=sub 占位气泡。
    await expectAssistantAnswer(page, "慢速总结已完成");
  });

  test("spawn_subagent waitForResult=true 时切到别的 session 再切回，父会话应恢复并完成", async ({ page }) => {
    await waitForChatReady(page);
    await selectAssistantAgent(page);

    // 父会话开始派生子 Agent
    await sendChatMessage(page, "派子 Agent 慢速总结");
    await expectToolPill(page, "spawn_subagent");

    // 记录父会话 ID，避免历史会话污染导致点错
    const parentSessionId = await waitForSessionId(page);
    expect(parentSessionId).toBeTruthy();

    // 切到新会话并发送一条普通消息
    await page.getByLabel("新建对话").click();
    await page.getByTestId("chat-input").waitFor({ state: "visible", timeout: 10_000 });
    await sendChatMessage(page, "你好");
    await waitForStreamingComplete(page);

    // 切回父会话（通过 URL，避免同标题会话干扰）
    await page.goto(`/chat?sessionId=${parentSessionId}`);
    await page.getByTestId("chat-input").waitFor({ state: "visible", timeout: 10_000 });

    // 父会话应继续流式并完成
    await waitForStreamingComplete(page);
    await expectAssistantAnswer(page, "父 Agent 已收到子 Agent 结果");
    // 子 Agent 结果通过 assistant 总结展示，不再显示原始 source=sub 占位气泡。
    await expectAssistantAnswer(page, "慢速总结已完成");
  });

  test("spawn_subagent waitForResult=true 时切换 Workspace 再切回，父会话仍应在后台更新并完成", async ({ page }) => {
    await waitForChatReady(page);
    await selectAssistantAgent(page);

    // 父会话开始派生子 Agent
    await sendChatMessage(page, "派子 Agent 慢速总结");
    await expectToolPill(page, "spawn_subagent");

    // 记录当前 Workspace 与父会话 ID
    const currentWorkspaceName = (await page.getByTestId("workspace-select").textContent())?.trim() ?? "";
    expect(currentWorkspaceName.length).toBeGreaterThan(0);
    const parentSessionId = await waitForSessionId(page);
    expect(parentSessionId).toBeTruthy();

    // 打开 Workspace 选择器并切换到另一个 Workspace
    await page.getByTestId("workspace-select").click();
    const menu = page.getByTestId("workspace-select-menu");
    await menu.waitFor({ state: "visible", timeout: 10_000 });
    const options = menu.locator("button");
    const optionCount = await options.count();
    expect(optionCount).toBeGreaterThan(1);

    let switched = false;
    for (let i = 0; i < optionCount; i++) {
      const text = (await options.nth(i).textContent())?.trim() ?? "";
      if (text && !text.includes(currentWorkspaceName)) {
        await options.nth(i).click();
        switched = true;
        break;
      }
    }
    expect(switched).toBe(true);

    // 切到另一个 Workspace 后，原父会话会从列表中过滤掉，但后台运行应继续
    await expect(page.getByTestId("workspace-select")).not.toContainText(currentWorkspaceName);

    // 切回原 Workspace，然后直接通过 URL 回到父会话
    await page.getByTestId("workspace-select").click();
    const menu2 = page.getByTestId("workspace-select-menu");
    await menu2.locator("button").filter({ hasText: currentWorkspaceName }).first().click();
    await page.goto(`/chat?sessionId=${parentSessionId}`);
    await page.getByTestId("chat-input").waitFor({ state: "visible", timeout: 10_000 });

    await waitForStreamingComplete(page);
    await expectAssistantAnswer(page, "父 Agent 已收到子 Agent 结果");
    // 子 Agent 结果通过 assistant 总结展示，不再显示原始 source=sub 占位气泡。
    await expectAssistantAnswer(page, "慢速总结已完成");
  });
});
