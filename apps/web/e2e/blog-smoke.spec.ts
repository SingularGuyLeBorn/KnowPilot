import { test, expect } from "@playwright/test";

/**
 * L1 博客基建冒烟 — 文章列表、编辑器、首页
 */

test.describe("L1 博客冒烟", () => {
  test.beforeEach(async ({ request }) => {
    await expect
      .poll(async () => (await request.get("http://127.0.0.1:3010/health")).ok())
      .toBe(true);
  });

  test("/posts 文章管理页应正常渲染", async ({ page }) => {
    await page.goto("/posts");
    await expect(page.getByRole("heading", { name: "文章管理", level: 1 })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("link", { name: /新建文章/ })).toBeVisible();
  });

  test("/editor 新建文章页应正常渲染", async ({ page }) => {
    await page.goto("/editor");
    await expect(page.getByPlaceholder("文章标题")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("link", { name: "返回" })).toBeVisible();
  });

  test("/ 首页应正常渲染", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 30_000 });
  });

  test("/posts/[slug] 文章详情页应正常渲染", async ({ page }) => {
    await page.goto("/posts/welcome-to-knowpilot");
    await expect(
      page.locator("header").getByRole("heading", { name: "欢迎使用 KnowPilot", level: 1 })
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("link", { name: "返回文章列表" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "功能特点", level: 2 })).toBeVisible();
  });
});
