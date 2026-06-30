/**
 * Playwright 启动 — 优先本机 Chrome，不下载 Playwright 自带 Chromium
 */

import fs from "fs";
import type { Browser, LaunchOptions } from "playwright";

function chromeCandidates(): string[] {
  const fromEnv = [process.env.CHROME_PATH, process.env.PLAYWRIGHT_CHROME_PATH].filter(Boolean) as string[];
  const defaults =
    process.platform === "win32"
      ? [
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        ]
      : process.platform === "darwin"
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
        : ["/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/usr/bin/chromium"];
  return [...fromEnv, ...defaults];
}

/** 本机是否安装了 Chrome / Chromium */
export function hasSystemChrome(): boolean {
  return chromeCandidates().some((p) => fs.existsSync(p));
}

/** 通用 launch 选项：有 Chrome 时用 channel: "chrome" */
export function getChromeLaunchOptions(extra?: LaunchOptions): LaunchOptions {
  const useChrome = hasSystemChrome();
  return {
    headless: true,
    channel: useChrome ? "chrome" : undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    ...extra,
  };
}

export async function launchPlaywrightBrowser(
  chromium: { launch: (opts?: LaunchOptions) => Promise<Browser> },
  opts: LaunchOptions & { isZhihu?: boolean } = {},
): Promise<Browser> {
  const { isZhihu = false, ...rest } = opts;
  const useChrome = hasSystemChrome();
  return chromium.launch({
    headless: isZhihu ? false : (rest.headless ?? true),
    channel: useChrome ? "chrome" : undefined,
    args: isZhihu
      ? ["--disable-blink-features=AutomationControlled"]
      : ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", ...(rest.args ?? [])],
    ...rest,
  });
}
