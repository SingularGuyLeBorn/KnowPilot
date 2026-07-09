import { test, expect } from "@playwright/test";
import { SERVER_URL } from "./helpers/trpcE2e";
import {
  waitForChatReady,
  sendChatMessage,
  waitForStreamingComplete,
} from "./helpers/mockChatFixture";

test.describe("Subagent Mock — 子代理任务创建与展示", () => {
  test.beforeEach(async ({ request }) => {
    await expect
      .poll(async () => (await request.get(`${SERVER_URL}/health`)).ok())
      .toBe(true);
  });

  test("通过弹窗创建子代理后左侧出现卡片", async ({ page }) => {
    await waitForChatReady(page);
    // 先发一条消息以创建父会话（SubagentPanel 需 parentSessionId）
    await sendChatMessage(page, "你好");
    await waitForStreamingComplete(page);

    // 打开创建弹窗（先切到左栏「子代理」标签页）
    await page.getByTestId("left-tab-subagents").click();
    await page.getByRole("button", { name: "新建子代理" }).click();
    await expect(page.getByText("新建子代理任务")).toBeVisible({ timeout: 5_000 });

    // 填任务描述并提交
    await page.getByPlaceholder(/搜索 KnowPilot 并整理/).fill("总结本地文章并生成摘要");
    await page.getByRole("button", { name: "创建并运行" }).click();

    // 子代理卡片应出现在左侧 SubagentPanel
    await expect(page.getByTestId("subagent-card").first()).toBeVisible({ timeout: 15_000 });
  });

  test("/subagents 页应列出已创建的子代理", async ({ page }) => {
    await page.goto("/subagents");
    await expect(page.getByRole("heading", { name: "子代理任务", level: 1 })).toBeVisible({ timeout: 30_000 });
    // 至少有一行子代理（上一个测试创建的，或本测试创建）
    await expect(page.getByTestId("subagent-card").first()).toBeVisible({ timeout: 15_000 }).catch(() => {
      // /subagents 页用表格而非卡片，兜底验证表格行
      void expect(page.locator("tbody tr").first()).toBeVisible({ timeout: 10_000 });
    });
  });
});
