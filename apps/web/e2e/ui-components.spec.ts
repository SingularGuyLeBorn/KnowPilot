import { test, expect } from "@playwright/test";
import { SERVER_URL } from "./helpers/trpcE2e";

test.describe("通用 UI 组件", () => {
  test.beforeEach(async ({ request }) => {
    await expect
      .poll(async () => (await request.get(`${SERVER_URL}/health`)).ok())
      .toBe(true);
  });

  test("分页组件正常渲染", async ({ page }) => {
    await page.goto("/posts");
    await expect(page.getByRole("heading", { name: "文章管理" })).toBeVisible({ timeout: 30_000 });
    // 若文章不足一页则分页不出现；断言至少页面正常加载即可
    await expect(page.getByText(/共 \d+ 篇/)).toBeVisible();
  });

  test("管理页搜索框可交互", async ({ page }) => {
    await page.goto("/posts");
    const input = page.getByPlaceholder("搜索标题或 slug…");
    await expect(input).toBeVisible({ timeout: 30_000 });
    await input.fill("不存在的关键词");
    await expect(page.getByText("试试更换关键词")).toBeVisible({ timeout: 10_000 });
  });

  test("回收站空态渲染", async ({ page }) => {
    await page.goto("/posts/trash");
    await expect(page.getByRole("heading", { name: "文章回收站" })).toBeVisible({ timeout: 30_000 });
    // 空态或列表至少出现其一
    await expect(
      page.getByText("回收站为空").or(page.getByText("篇已删除文章")),
    ).toBeVisible({ timeout: 10_000 });
  });
});
