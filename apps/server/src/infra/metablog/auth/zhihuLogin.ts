/**
 * ============================================================================
 * 知乎登录态获取服务
 * ============================================================================
 *
 * 用 Playwright 打开知乎登录页, 等待用户手动登录, 
 * 超时后自动保存登录态(cookies + localStorage + sessionStorage).
 *
 * @module server/services/zhihuLogin
 */

import fs from "fs";
import path from "path";
import { launchZhihuBrowser } from "./zhihuBrowser.js";

const AUTH_PATH = path.join(
  process.env.KNOWPILOT_ROOT || process.cwd(),
  "content",
  "cookies",
  "zhihu_storage_state.json"
);

export interface LoginResult {
  success: boolean;
  message: string;
  authPath: string;
  fileSize: number;
}

/**
 * 捕获知乎登录态
 *
 * @param timeoutSec - 等待超时时间(秒), 默认 120
 * @returns 登录结果
 */
export async function captureZhihuLoginState(
  timeoutSec: number = 120
): Promise<LoginResult> {
  // 确保目录存在
  fs.mkdirSync(path.dirname(AUTH_PATH), { recursive: true });

  const { browser, context, page } = await launchZhihuBrowser({
    headless: false,
  });

  try {
    await page.goto("https://www.zhihu.com", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // 轮询检测登录态文件, 检测到有效数据立即返回
    const timeoutMs = timeoutSec * 1000;
    const pollInterval = 3000;
    const startTime = Date.now();
    let likelyLoggedIn = false;

    while (Date.now() - startTime < timeoutMs) {
      await page.waitForTimeout(pollInterval);

      // 尝试保存当前状态到文件
      try {
        await context.storageState({ path: AUTH_PATH });
      } catch {
        // 保存失败则继续等待
        continue;
      }

      // 检查文件是否有有效登录态
      if (fs.existsSync(AUTH_PATH)) {
        const stats = fs.statSync(AUTH_PATH);
        if (stats.size > 10 * 1024) {
          likelyLoggedIn = true;
          break;
        }
      }
    }

    // 最终保存一次(兜底)
    await context.storageState({ path: AUTH_PATH });

    const stats = fs.existsSync(AUTH_PATH) ? fs.statSync(AUTH_PATH) : { size: 0 };
    const fileSize = stats.size;

    if (!likelyLoggedIn && fileSize > 10 * 1024) {
      likelyLoggedIn = true;
    }

    return {
      success: true,
      message: likelyLoggedIn
        ? `登录态已捕获(文件大小 ${(fileSize / 1024).toFixed(1)}KB), 看起来已登录`
        : `登录态已保存(文件大小 ${(fileSize / 1024).toFixed(1)}KB), 可能未登录或登录态较空, 建议验证`,
      authPath: AUTH_PATH,
      fileSize,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `登录态捕获失败: ${error.message}`,
      authPath: AUTH_PATH,
      fileSize: 0,
    };
  } finally {
    await browser.close();
  }
}
