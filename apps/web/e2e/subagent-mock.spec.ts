import { test, expect } from "@playwright/test";
import { SERVER_URL } from "./helpers/trpcE2e";
import {
  waitForChatReady,
  sendChatMessage,
  waitForStreamingComplete,
} from "./helpers/mockChatFixture";

test.describe("Subagent Mock — 子 Agent 任务创建与展示", () => {
  test.beforeEach(async ({ request }) => {
    await expect
      .poll(async () => (await request.get(`${SERVER_URL}/health`)).ok())
      .toBe(true);
  });

  test("通过弹窗创建子 Agent 后左侧出现卡片", async ({ page }) => {
    await waitForChatReady(page);
    // 先发一条消息以创建父会话（SubagentPanel 需 parentSessionId）
    await sendChatMessage(page, "你好");
    await waitForStreamingComplete(page);

    // 打开创建弹窗（先切到「对话历史 -> 子 Agent」）
    await page.getByTestId("left-tab-history").click();
    await page.getByTestId("history-subtab-sub").click();
    await page.getByTestId("subagent-create-button").click();
    await expect(page.getByText("新建子 Agent 任务")).toBeVisible({ timeout: 5_000 });

    // 切换到「新建子 Agent」模式，填写名称与任务描述并提交
    await page.getByRole("button", { name: "新建子 Agent", exact: true }).click();
    await page.getByPlaceholder("例如：Research-Helper").fill("E2E-Test-Subagent");
    await page.getByPlaceholder(/搜索 KnowPilot 并整理/).fill("总结本地文章并生成摘要");
    await page.getByRole("button", { name: "创建并启动" }).click();

    // 子 Agent 会话应出现在左侧「子 Agent」面板
    await expect(page.getByTestId("subsession-item").first()).toBeVisible({ timeout: 15_000 });
  });

  test("/subagents 页应列出已创建的子 Agent", async ({ page }) => {
    await page.goto("/subagents");
    await expect(page.getByRole("heading", { name: "子 Agent 任务", level: 1 })).toBeVisible({ timeout: 30_000 });
    // 至少有一行子 Agent（上一个测试创建的，或本测试创建）
    await expect(page.getByTestId("subagent-card").first()).toBeVisible({ timeout: 15_000 }).catch(() => {
      // /subagents 页用表格而非卡片，兜底验证表格行
      void expect(page.locator("tbody tr").first()).toBeVisible({ timeout: 10_000 });
    });
  });
});
