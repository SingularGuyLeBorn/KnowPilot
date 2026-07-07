/**
 * ============================================================================
 * 知乎浏览器启动器(共享)
 * ============================================================================
 *
 * 提供统一的 Playwright 浏览器启动逻辑, 供知乎登录和收藏夹抓取复用.
 *
 * @module server/services/zhihuBrowser
 */

import fs from "fs";
import type { Browser, BrowserContext, Page } from "playwright";

/**
 * 检测系统是否安装了 Chrome
 */
export function hasSystemChrome(): boolean {
  return [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ].some((p) => fs.existsSync(p));
}

/**
 * 启动知乎浏览器
 *
 * @param options.headless - 是否无头模式. 登录建议 false, 后台任务建议 true
 * @param options.storageState - 登录态文件路径(可选)
 */
export async function launchZhihuBrowser(options: {
  headless?: boolean;
  storageState?: string;
} = {}): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  const { headless = false, storageState } = options;

  const { chromium } = await import("playwright");

  const browser = await chromium.launch({
    headless,
    channel: hasSystemChrome() ? "chrome" : undefined,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const contextOptions: Parameters<typeof browser.newContext>[0] = {
    viewport: { width: 1920, height: 1080 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
  };

  if (storageState && fs.existsSync(storageState)) {
    contextOptions.storageState = storageState;
  }

  const context = await browser.newContext(contextOptions);

  await context.addInitScript(`
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    window.chrome = { runtime: {} };
    Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
  `);

  const page = await context.newPage();

  return { browser, context, page };
}
