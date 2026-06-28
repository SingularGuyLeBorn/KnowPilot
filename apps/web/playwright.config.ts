import { defineConfig, devices } from "@playwright/test";
import path from "path";

const rootDir = path.resolve(__dirname, "../..");

/** Web 用 3002 生产模式，避开 Next dev 全局锁与 3000 占用 */
const webPort = process.env.E2E_WEB_PORT ?? "3002";
const serverPort = process.env.E2E_SERVER_PORT ?? "3010";
const webBaseUrl = `http://127.0.0.1:${webPort}`;
const serverHealthUrl = `http://127.0.0.1:${serverPort}/health`;
const serverInternal = `http://127.0.0.1:${serverPort}`;

const webStartCommand = `pnpm --filter @knowpilot/web exec next start -p ${webPort}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/test-results",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 60_000,
  reporter: [["list"], ["html", { open: "never", outputFolder: "./e2e/playwright-report" }]],
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
      command: "pnpm --filter @knowpilot/server dev",
      url: serverHealthUrl,
      cwd: rootDir,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        SERVER_PORT: serverPort,
        DATABASE_URL: process.env.DATABASE_URL ?? "file:./dev.db",
        REQUIRE_APPROVAL: "false",
      },
    },
    {
      command: webStartCommand,
      url: webBaseUrl,
      cwd: rootDir,
      reuseExistingServer: false,
      timeout: 300_000,
      env: {
        SERVER_INTERNAL_URL: serverInternal,
        NEXT_PUBLIC_SERVER_URL: serverInternal,
      },
    },
  ],
});
