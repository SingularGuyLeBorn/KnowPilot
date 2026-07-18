/**
 * 知乎登录态获取：Playwright 弹窗登录 → 写 storageState + 同步 cookieJar（供 read_article HTTP/PW 复用）
 */

import fs from "fs";
import path from "path";
import { launchZhihuBrowser } from "./zhihuBrowser.js";
import { saveCookies, type CookieJarEntry } from "../../cookieJar.js";

const AUTH_PATH = path.join(
  process.env.KNOWPILOT_ROOT || process.cwd(),
  "content",
  "cookies",
  "zhihu_storage_state.json",
);

export interface LoginResult {
  success: boolean;
  message: string;
  authPath: string;
  fileSize: number;
  cookieCount?: number;
}

export async function captureZhihuLoginState(timeoutSec: number = 120): Promise<LoginResult> {
  fs.mkdirSync(path.dirname(AUTH_PATH), { recursive: true });

  const { browser, context, page } = await launchZhihuBrowser({
    headless: false,
  });

  try {
    await page.goto("https://www.zhihu.com", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    const timeoutMs = timeoutSec * 1000;
    const pollInterval = 3000;
    const startTime = Date.now();
    let likelyLoggedIn = false;

    while (Date.now() - startTime < timeoutMs) {
      await page.waitForTimeout(pollInterval);
      try {
        await context.storageState({ path: AUTH_PATH });
      } catch {
        continue;
      }
      if (fs.existsSync(AUTH_PATH)) {
        const stats = fs.statSync(AUTH_PATH);
        if (stats.size > 10 * 1024) {
          likelyLoggedIn = true;
          break;
        }
      }
    }

    await context.storageState({ path: AUTH_PATH });

    // 同步到 cookieJar：read_article HTTP 路径与 Playwright 注入共用 zhihu.json
    const pwCookies = await context.cookies(["https://www.zhihu.com", "https://zhuanlan.zhihu.com"]);
    const jarEntries: CookieJarEntry[] = pwCookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain || ".zhihu.com",
      path: c.path || "/",
      expires: c.expires,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: (c.sameSite as CookieJarEntry["sameSite"]) || "Lax",
    }));
    if (jarEntries.length) saveCookies("zhihu", jarEntries);

    // 同步 Cookie 头字符串提示到结果（不写 .env，避免覆盖用户密钥文件）
    const stats = fs.existsSync(AUTH_PATH) ? fs.statSync(AUTH_PATH) : { size: 0 };
    const fileSize = stats.size;
    if (!likelyLoggedIn && fileSize > 10 * 1024) likelyLoggedIn = true;

    return {
      success: true,
      message: likelyLoggedIn
        ? `登录态已捕获（storageState ${(fileSize / 1024).toFixed(1)}KB，cookieJar ${jarEntries.length} 条），read_article 可复用`
        : `登录态已保存（${(fileSize / 1024).toFixed(1)}KB / cookies=${jarEntries.length}），可能未登录，建议再试`,
      authPath: AUTH_PATH,
      fileSize,
      cookieCount: jarEntries.length,
    };
  } catch (error: unknown) {
    return {
      success: false,
      message: `登录态捕获失败: ${error instanceof Error ? error.message : String(error)}`,
      authPath: AUTH_PATH,
      fileSize: 0,
    };
  } finally {
    await browser.close();
  }
}
