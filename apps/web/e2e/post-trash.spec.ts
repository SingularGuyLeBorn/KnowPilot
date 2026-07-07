import { test, expect } from "@playwright/test";
import { trpcMutate, trpcQuery, SERVER_URL } from "./helpers/trpcE2e";

/**
 * 强制清理一篇文章：无论它在「正常列表」「回收站」还是「已不存在」，
 * 都尝试软删 + 硬删，确保不残留 md 文件与 DB 记录。
 */
async function forceCleanupPost(postId: string): Promise<void> {
  // 1. 若在回收站，直接硬删
  try {
    const listDeleted = await trpcQuery<{ items: Array<{ id: string }> }>("post.listDeleted");
    if (listDeleted.items?.some((p) => p.id === postId)) {
      await trpcMutate("post.permanentDelete", { id: postId });
      return;
    }
  } catch {
    /* 忽略，继续尝试 */
  }
  // 2. 若在正常列表，先软删再硬删
  try {
    await trpcMutate("post.delete", { id: postId });
    await trpcMutate("post.permanentDelete", { id: postId });
  } catch {
    /* 可能已被删，忽略 */
  }
}

test.describe("文章回收站", () => {
  test.beforeEach(async ({ request }) => {
    await expect
      .poll(async () => (await request.get(`${SERVER_URL}/health`)).ok())
      .toBe(true);
  });

  test("删除文章后可在回收站恢复", async ({ page }) => {
    const title = `E2E 回收站 ${Date.now()}`;
    const slug = `e2e-trash-${Date.now()}`;
    let createdId: string | undefined;

    try {
      // 1. 通过 tRPC 创建文章
      const createRes = await trpcMutate("post.create", {
        title,
        slug,
        content: "测试回收站流程",
        excerpt: "摘要",
        published: true,
        category: "测试",
        tags: ["e2e"],
      });
      if (!createRes.success || !createRes.data) {
        throw new Error(createRes.error?.message ?? "post.create 失败");
      }
      createdId = createRes.data.id;

      // 2. 打开文章列表并删除
      await page.goto("/posts");
      await expect(page.getByRole("heading", { name: "文章管理" })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(title).first()).toBeVisible({ timeout: 15_000 });
      const card = page.locator("[data-testid='post-card']").filter({ hasText: title }).first();
      await card.getByRole("button", { name: "删除" }).click();

      await expect(page.getByRole("heading", { name: "删除文章" })).toBeVisible({ timeout: 5_000 });
      await page.getByTestId("confirm-dialog-confirm").click();

      // 3. 验证文章从列表消失
      await expect(card).toBeHidden({ timeout: 10_000 });

      // 4. 进入回收站恢复
      await page.goto("/posts/trash");
      await expect(page.getByRole("heading", { name: "文章回收站" })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(title).first()).toBeVisible({ timeout: 15_000 });
      const trashCard = page.locator("[data-testid='trash-post-card']").filter({ hasText: title }).first();
      await trashCard.getByRole("button", { name: "恢复" }).click();
      await expect(page.getByRole("heading", { name: "恢复文章" })).toBeVisible({ timeout: 5_000 });
      await page.getByTestId("confirm-dialog-confirm").click();
      await page.waitForLoadState("networkidle");

      // 5. 验证文章回到列表（等待 React Query 刷新）
      await page.goto("/posts");
      await page.waitForLoadState("networkidle");
      await expect
        .poll(async () => {
          const visible = await page.getByText(title).first().isVisible().catch(() => false);
          if (visible) return true;
          await page.reload();
          await page.waitForLoadState("networkidle");
          return false;
        })
        .toBe(true);
    } finally {
      // 6. 强制清理：用创建时的 id，无论文章处于何种状态都清干净
      if (createdId) {
        await forceCleanupPost(createdId);
      }
    }
  });
});
