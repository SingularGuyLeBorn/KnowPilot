import { defineConfig, devices } from "@playwright/test";
import path from "path";

const rootDir = path.resolve(__dirname, "../..");

const webPort = process.env.E2E_WEB_PORT ?? "3003";
const serverPort = process.env.E2E_SERVER_PORT ?? "3011";
const webBaseUrl = `http://127.0.0.1:${webPort}`;
const serverHealthUrl = `http://127.0.0.1:${serverPort}/health`;
const serverInternal = `http://127.0.0.1:${serverPort}`;

// 让测试文件能读取到 mock server 地址
process.env.E2E_SERVER_URL = serverInternal;
process.env.E2E_SERVER_PORT = serverPort;
process.env.E2E_WEB_PORT = webPort;
process.env.SERVER_INTERNAL_URL = serverInternal;
process.env.NEXT_PUBLIC_SERVER_URL = serverInternal;

// 与默认 E2E 一致：webServer 只负责启动，不在此处 build（否则每次跑 mock 都等 3–10 分钟像卡死）
const webStartCommand = `pnpm --filter @knowpilot/web run start:mock`;

/**
 * Mock 模式 Playwright 配置：
 * - 启动独立 server / web 端口，避免与真实 LLM E2E 冲突
 * - 注入 MOCK_LLM=true / MOCK_MCP=true，所有 Chat 测试不依赖外部 API
 */
export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/test-results-mock",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 60_000,
  reporter: [["list"], ["html", { open: "never", outputFolder: "./e2e/playwright-report-mock" }]],
  testMatch: ["**/*mock.spec.ts", "**/post-trash.spec.ts", "**/ui-components.spec.ts"],
  use: {
    baseURL: webBaseUrl,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    process.env.CI
      ? {
          name: "chromium",
          use: { ...devices["Desktop Chrome"] },
        }
      : {
          name: "chrome",
          use: { ...devices["Desktop Chrome"], channel: "chrome" },
        },
  ],
  webServer: [
    {
      command: `pnpm --filter @knowpilot/server run dev:mock`,
      url: serverHealthUrl,
      cwd: rootDir,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        SERVER_PORT: serverPort,
        DATABASE_URL: process.env.DATABASE_URL ?? "file:./dev.db",
        REQUIRE_APPROVAL: "false",
        MOCK_LLM: "true",
        MOCK_MCP: "true",
        MOCK_NATIVE_TOOLS: "true",
      },
    },
    {
      command: webStartCommand,
      url: webBaseUrl,
      cwd: rootDir,
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
      env: {
        SERVER_INTERNAL_URL: serverInternal,
        NEXT_PUBLIC_SERVER_URL: serverInternal,
      },
    },
  ],
});
