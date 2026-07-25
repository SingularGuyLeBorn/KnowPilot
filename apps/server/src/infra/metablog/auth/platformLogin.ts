/**
 * 多平台浏览器登录态捕获（泛化版）。
 *
 * 复用 launchZhihuBrowser（实为通用 Playwright Chrome 启动器）：
 *   1. 弹窗打开平台登录页 → 用户手动登录（扫码/账密）
 *   2. 轮询 storageState 文件大小，登录后 cookie 显著增大
 *   3. 落盘 storageState + 同步 cookieJar（供 read_article HTTP/PW 复用）
 *
 * 各平台官方开放平台需企业认证 + OAuth，对单用户本地优先项目过重；
 * 知乎等无官方公开 API，非官方 SDK 依赖 x-zse-96 签名不稳定。
 * 浏览器登录态捕获是最务实方案：用户用自己的账号登录，cookie 落盘，
 * read_article 抓取时复用，访问需登录内容（收藏夹/付费/私密）。
 */

import fs from "fs";
import path from "path";
import { launchZhihuBrowser } from "./zhihuBrowser.js";
import { saveCookies, type CookieJarEntry, type CookiePlatform } from "../../cookieJar.js";
import { getAppConfig } from "../../config.js";

export interface PlatformLoginConfig {
  platform: CookiePlatform;
  /** 登录页 URL（用户在此页登录） */
  loginUrl: string;
  /** cookie 抓取的 URL 列表（覆盖该平台所有需登录态的域） */
  cookieUrls: string[];
  /** storageState 文件名（data/cookies/{name}） */
  storageStateFile: string;
  /** 登录成功的 storageState 最小字节数（阈值，超过视为已登录）——仅作辅助，主判定靠 loginCookieNames */
  minLoggedInBytes?: number;
  /** 平台登录态核心 cookie 名（任一存在且非空即视为登录成功，比文件大小可靠） */
  loginCookieNames: string[];
}

export const PLATFORM_LOGIN_CONFIGS: Record<CookiePlatform, PlatformLoginConfig> = {
  zhihu: {
    platform: "zhihu",
    loginUrl: "https://www.zhihu.com/signin",
    cookieUrls: ["https://www.zhihu.com", "https://zhuanlan.zhihu.com"],
    storageStateFile: "zhihu_storage_state.json",
    minLoggedInBytes: 10 * 1024,
    loginCookieNames: ["z_c0"],
  },
  wechat: {
    platform: "wechat",
    loginUrl: "https://mp.weixin.qq.com/",
    cookieUrls: ["https://mp.weixin.qq.com", "https://wx.qq.com"],
    storageStateFile: "wechat_storage_state.json",
    minLoggedInBytes: 5 * 1024,
    loginCookieNames: ["slave_sid", "slave_user"],
  },
  xhs: {
    platform: "xhs",
    loginUrl: "https://www.xiaohongshu.com",
    cookieUrls: ["https://www.xiaohongshu.com", "https://edith.xiaohongshu.com"],
    storageStateFile: "xhs_storage_state.json",
    minLoggedInBytes: 5 * 1024,
    loginCookieNames: ["web_session"],
  },
  douyin: {
    platform: "douyin",
    loginUrl: "https://www.douyin.com",
    cookieUrls: ["https://www.douyin.com", "https://creator.douyin.com"],
    storageStateFile: "douyin_storage_state.json",
    minLoggedInBytes: 5 * 1024,
    loginCookieNames: ["sessionid_ss", "sid_guard", "sid_tt"],
  },
  bilibili: {
    platform: "bilibili",
    loginUrl: "https://passport.bilibili.com/login",
    cookieUrls: ["https://www.bilibili.com", "https://api.bilibili.com"],
    storageStateFile: "bilibili_storage_state.json",
    minLoggedInBytes: 5 * 1024,
    loginCookieNames: ["SESSDATA", "DedeUserID"],
  },
  weibo: {
    platform: "weibo",
    loginUrl: "https://passport.weibo.com/signin/login",
    cookieUrls: ["https://weibo.com", "https://m.weibo.cn"],
    storageStateFile: "weibo_storage_state.json",
    minLoggedInBytes: 5 * 1024,
    loginCookieNames: ["SUB", "SUBP"],
  },
  juejin: {
    platform: "juejin",
    loginUrl: "https://juejin.cn/login",
    cookieUrls: ["https://juejin.cn", "https://api.juejin.cn"],
    storageStateFile: "juejin_storage_state.json",
    minLoggedInBytes: 4 * 1024,
    loginCookieNames: ["sessionid_ss", "sessionid"],
  },
  csdn: {
    platform: "csdn",
    loginUrl: "https://passport.csdn.net/login",
    cookieUrls: ["https://www.csdn.net", "https://blog.csdn.net"],
    storageStateFile: "csdn_storage_state.json",
    minLoggedInBytes: 4 * 1024,
    loginCookieNames: ["UserName", "UserToken"],
  },
  yuque: {
    platform: "yuque",
    loginUrl: "https://www.yuque.com/login",
    cookieUrls: ["https://www.yuque.com", "https://www.yuque.com/api"],
    storageStateFile: "yuque_storage_state.json",
    minLoggedInBytes: 4 * 1024,
    loginCookieNames: ["_yuque_session", "session_id"],
  },
};

export interface PlatformLoginResult {
  success: boolean;
  message: string;
  platform: CookiePlatform;
  authPath: string;
  fileSize: number;
  cookieCount?: number;
}

function getStorageStatePath(file: string): string {
  return path.join(getAppConfig().dataPaths.cookies, file);
}

/**
 * 获取指定平台 storageState 文件路径（供 read_article 的 Playwright 抓取复用完整浏览器态）。
 * 文件不存在返回 null（调用方回退到 addCookies）。
 */
export function getPlatformStorageStatePath(platform: string): string | null {
  const cfg = (PLATFORM_LOGIN_CONFIGS as Record<string, PlatformLoginConfig>)[platform];
  if (!cfg) return null;
  const p = getStorageStatePath(cfg.storageStateFile);
  return fs.existsSync(p) ? p : null;
}

/**
 * 捕获指定平台的浏览器登录态。
 * 弹窗打开 loginUrl，用户手动登录后落盘 storageState + cookieJar。
 */
export async function capturePlatformLoginState(
  platform: CookiePlatform,
  timeoutSec: number = 120,
): Promise<PlatformLoginResult> {
  const cfg = PLATFORM_LOGIN_CONFIGS[platform];
  if (!cfg) {
    return {
      success: false,
      message: `不支持的平台：${platform}（支持：${Object.keys(PLATFORM_LOGIN_CONFIGS).join(", ")}）`,
      platform,
      authPath: "",
      fileSize: 0,
    };
  }

  const authPath = getStorageStatePath(cfg.storageStateFile);
  fs.mkdirSync(path.dirname(authPath), { recursive: true });

  const { browser, context, page } = await launchZhihuBrowser({ headless: false });

  try {
    await page.goto(cfg.loginUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    const timeoutMs = timeoutSec * 1000;
    const pollInterval = 3000;
    const startTime = Date.now();
    let hitName = "";

    // 轮询：检查是否出现平台登录态核心 cookie（比文件大小可靠）
    while (Date.now() - startTime < timeoutMs) {
      await page.waitForTimeout(pollInterval);
      let pwCookies: Array<{ name: string; value: string; domain?: string; path?: string; expires?: number; httpOnly?: boolean; secure?: boolean; sameSite?: "Strict" | "Lax" | "None" }>;
      try {
        pwCookies = await context.cookies(cfg.cookieUrls);
      } catch {
        continue;
      }
      const hit = pwCookies.find(
        (c) => cfg.loginCookieNames.includes(c.name) && c.value && c.value.length > 0,
      );
      if (hit) {
        hitName = hit.name;
        // 登录成功：落盘 storageState + cookieJar
        await context.storageState({ path: authPath });
        const jarEntries: CookieJarEntry[] = pwCookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain || `.${new URL(cfg.loginUrl).hostname}`,
          path: c.path || "/",
          expires: c.expires,
          httpOnly: c.httpOnly,
          secure: c.secure,
          sameSite: (c.sameSite as CookieJarEntry["sameSite"]) || "Lax",
        }));
        saveCookies(platform, jarEntries);
        const stats = fs.existsSync(authPath) ? fs.statSync(authPath) : { size: 0 };
        const fileSize = stats.size;
        return {
          success: true,
          message: `${platform} 登录态已捕获（命中 ${hitName}，storageState ${(fileSize / 1024).toFixed(1)}KB，cookieJar ${jarEntries.length} 条），read_article 可复用`,
          platform,
          authPath,
          fileSize,
          cookieCount: jarEntries.length,
        };
      }
    }

    // 超时未登录：不落盘、不覆盖旧登录态（保留旧的有效 cookie）
    return {
      success: false,
      message: `${platform} 登录超时或未检测到登录态 cookie（${cfg.loginCookieNames.join("/")}），未保存（保留旧登录态）。请在弹出窗口内完成登录后重试，或加大 timeoutSec。`,
      platform,
      authPath,
      fileSize: fs.existsSync(authPath) ? fs.statSync(authPath).size : 0,
    };
  } catch (error: unknown) {
    return {
      success: false,
      message: `${platform} 登录态捕获失败: ${error instanceof Error ? error.message : String(error)}`,
      platform,
      authPath,
      fileSize: 0,
    };
  } finally {
    await browser.close();
  }
}

/** 列出所有支持的平台及其当前登录态 */
export function listPlatformLoginStatus(): Array<{
  platform: CookiePlatform;
  loginUrl: string;
  hasStorageState: boolean;
  storageStateSize: number;
}> {
  return Object.values(PLATFORM_LOGIN_CONFIGS).map((cfg) => {
    const authPath = getStorageStatePath(cfg.storageStateFile);
    let size = 0;
    try {
      if (fs.existsSync(authPath)) size = fs.statSync(authPath).size;
    } catch {
      // ignore
    }
    return {
      platform: cfg.platform,
      loginUrl: cfg.loginUrl,
      hasStorageState: size > 0,
      storageStateSize: size,
    };
  });
}
