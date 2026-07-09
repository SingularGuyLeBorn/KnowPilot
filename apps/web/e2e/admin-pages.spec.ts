import { test, expect } from "@playwright/test";

/**
 * 管理控制台页面冒烟测试 — L5 验收（覆盖全部 Sidebar 管理路由）
 */

const ADMIN_PAGES: Array<{ path: string; heading: string }> = [
  { path: "/chat", heading: "Agent 对话" },
  { path: "/agents", heading: "我的 Agents" },
  { path: "/subagents", heading: "子 Agent 任务" },
  { path: "/skills", heading: "Skills 专属动作库" },
  { path: "/mcp", heading: "MCP 服务器接入" },
  { path: "/memories", heading: "Memories 记忆晶体" },
  { path: "/prompts", heading: "Prompts 提示词库" },
  { path: "/files", heading: "资源与文件柜" },
  { path: "/git", heading: "Git 仓库" },
  { path: "/tasks", heading: "Tasks 定时任务" },
  { path: "/logs", heading: "控制台与系统日志" },
  { path: "/workspaces", heading: "Workspaces 工作空间" },
  { path: "/search", heading: "搜索 KnowPilot" },
  { path: "/dashboard", heading: "Analytics 概览" },
  { path: "/tools", heading: "Tools 工具目录" },
  { path: "/sources", heading: "信息源管理" },
  { path: "/runs", heading: "Runs 执行记录" },
  { path: "/credentials", heading: "Credentials 凭据库" },
  { path: "/settings", heading: "远程访问与安全" },
  { path: "/approvals", heading: "Approvals 审批队列" },
  { path: "/triggers", heading: "Triggers 触发器" },
];

test.describe("管理控制台冒烟", () => {
  test.beforeEach(async ({ request }) => {
    await expect
      .poll(async () => (await request.get("http://127.0.0.1:3010/health")).ok())
      .toBe(true);
  });

  for (const { path, heading } of ADMIN_PAGES) {
    test(`${path} 应正常渲染`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible({
        timeout: 30_000,
      });
    });
  }

  test("/about 应正常渲染 profile", async ({ page }) => {
    await page.goto("/about");
    await expect(page.getByText("About Me")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
  });

  test("/tools 展示原生运行时能力面板", async ({ page }) => {
    await page.goto("/tools");
    await expect(page.getByRole("heading", { name: "Tools 工具目录", level: 1 })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("native-capabilities-panel")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("原生运行时能力")).toBeVisible();
  });

  test("/sources 展示搜索引擎能力条", async ({ page }) => {
    await page.goto("/sources");
    await expect(page.getByRole("heading", { name: "信息源管理", level: 1 })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("native-capabilities-panel")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("web_search 与 read_article")).toBeVisible();
    await expect(page.getByText(/信息源 \d+/)).toBeVisible();
  });

  test("/dashboard 展示紧凑能力面板", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Analytics 概览", level: 1 })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("native-capabilities-panel")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("link", { name: /Tools 能力详情/ })).toBeVisible();
  });

  test("/settings 展示运行时能力面板", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "远程访问与安全", level: 1 })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("native-capabilities-panel")).toBeVisible({ timeout: 15_000 });
  });
});
