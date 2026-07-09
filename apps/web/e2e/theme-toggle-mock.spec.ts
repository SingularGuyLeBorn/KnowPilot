import { test, expect } from "@playwright/test";
import { SERVER_URL } from "./helpers/trpcE2e";

test.describe("主题切换", () => {
  test.beforeEach(async ({ request }) => {
    await expect
      .poll(async () => (await request.get(`${SERVER_URL}/health`)).ok())
      .toBe(true);
  });

  test("Navbar 主题切换按钮可切换 light/dark", async ({ page }) => {
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");

    const html = page.locator("html");
    const lightBtn = page.getByRole("button", { name: "浅色" });
    const darkBtn = page.getByRole("button", { name: "深色" });

    await expect(lightBtn).toBeVisible();
    await expect(darkBtn).toBeVisible();

    // 切到深色
    await darkBtn.click();
    await expect(html).toHaveClass(/dark/);

    // 切到浅色
    await lightBtn.click();
    await expect(html).toHaveClass(/light/);
    await expect(html).not.toHaveClass(/dark/);
  });
});
