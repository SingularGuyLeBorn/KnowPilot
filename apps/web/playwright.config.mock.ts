import { defineConfig, devices } from "@playwright/test";
import path from "path";

const webPort = process.env.E2E_WEB_PORT ?? "3003";
const serverPort = process.env.E2E_SERVER_PORT ?? "3011";
const webBaseUrl = `http://127.0.0.1:${webPort}`;
const serverInternal = `http://127.0.0.1:${serverPort}`;

// 让测试文件能读取到 mock server 地址
process.env.E2E_SERVER_URL = serverInternal;
process.env.E2E_SERVER_PORT = serverPort;
process.env.E2E_WEB_PORT = webPort;
process.env.SERVER_INTERNAL_URL = serverInternal;
process.env.NEXT_PUBLIC_SERVER_URL = serverInternal;

// Mock 环境变量需在最外层设置，globalSetup 启动 server 时会继承
process.env.MOCK_LLM = "true";
process.env.MOCK_MCP = "true";
process.env.MOCK_NATIVE_TOOLS = "true";
process.env.REQUIRE_APPROVAL = "false";

/**
 * Mock 模式 Playwright 配置：
 * - 启动独立 server / web 端口，避免与真实 LLM E2E 冲突
 * - 注入 MOCK_LLM=true / MOCK_MCP=true，所有 Chat 测试不依赖外部 API
 */
export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/test-results-mock",
  globalSetup: path.resolve(__dirname, "e2e-global/setup.mjs"),
  globalTeardown: path.resolve(__dirname, "e2e-global/teardown.mjs"),
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
});
