/**
 * Playwright 浏览器单例 — webScraper 与 read_article 共用，避免每次 launch/close
 */

import { chromium, type Browser } from "playwright";
import { getChromeLaunchOptions } from "./playwrightChrome.js";

let browserInstance: Browser | null = null;

/** 获取共享 headless Chrome/Chromium 实例 */
export async function getSharedBrowser(): Promise<Browser> {
  if (!browserInstance?.isConnected()) {
    if (browserInstance) {
      await browserInstance.close().catch(() => undefined);
      browserInstance = null;
    }
    browserInstance = await chromium.launch(getChromeLaunchOptions());
  }
  return browserInstance;
}

/** 优雅退出时关闭共享浏览器 */
export async function closeSharedBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close().catch(() => undefined);
    browserInstance = null;
  }
}

export function isSharedBrowserReady(): boolean {
  return !!browserInstance?.isConnected();
}
