import { test, expect } from "@playwright/test";
import { createUserOnlySession } from "./helpers/sessionFixture";

test.describe("Chat 运行时能力面板", () => {
  test.beforeEach(async ({ request }) => {
    await expect
      .poll(async () => (await request.get("http://127.0.0.1:3010/health")).ok())
      .toBe(true);
  });

  test("设置面板参数 tab 展示网络工具运行时能力", async ({ page }) => {
    const fixture = await createUserOnlySession();

    await page.goto(`/chat?sessionId=${fixture.sessionId}`);
    await expect(page.getByTestId("chat-input")).toBeEnabled({ timeout: 20_000 });

    await page.getByRole("button", { name: "参数" }).click();
    await expect(page.getByTestId("chat-runtime-capabilities")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("网络工具运行时")).toBeVisible();
    await expect(page.getByText(/搜索 \d+/)).toBeVisible();
  });
});
