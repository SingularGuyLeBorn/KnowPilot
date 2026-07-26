/**
 * 多平台浏览器登录态捕获（泛化版）。
 *
 * 流程：
 *   1. 干净上下文弹窗打开登录页（禁止加载旧 storageState）
 *   2. 首屏拍 baseline（访客/设备 cookie）
 *   3. 轮询 cookie 信号（认证 cookie 新出现 / 会话 cookie 值变化）
 *   4. 有身份 API 的平台必须 verify 通过才落盘（cookie 存在 ≠ 已登录）
 *
 * 铁律：
 * - authCookieNames 只能是「登录后才出现」的认证 cookie
 * - 禁止把设备/访客 cookie 放进 authCookieNames（知乎 d_c0、小红书 web_session/a1、
 *   抖音 ttwid、B站 buvid3、微博 SINAGLOBAL、掘金 __tea_*、CSDN uuid 等）
 * - sessionCookieNames 仅作「值变化」触发器，必须配合 verifyLogin，单独不算登录
 */

import fs from "fs";
import path from "path";
import type { BrowserContext, Page } from "playwright";
import { launchZhihuBrowser } from "./zhihuBrowser.js";
import { loadCookies, saveCookies, type CookieJarEntry, type CookiePlatform } from "../../cookieJar.js";
import { getAppConfig } from "../../config.js";

export type LoginVerifyFn = (page: Page, context: BrowserContext) => Promise<boolean>;

export interface PlatformLoginConfig {
  platform: CookiePlatform;
  loginUrl: string;
  cookieUrls: string[];
  storageStateFile: string;
  /**
   * 登录后才出现的认证 cookie。任一（或 requireAllAuth 时全部）相对 baseline 新出现/变值 = 信号。
   * 离线 status 检查也只认这些（不含访客 session）。
   */
  authCookieNames: string[];
  /**
   * 未登录也会下发、登录后**值会变**的会话 cookie（如小红书 web_session）。
   * 仅作轮询触发器；有此类 cookie 的平台必须提供 verifyLogin。
   */
  sessionCookieNames?: string[];
  /** true = 落盘/离线判定要求 authCookieNames 全部存在 */
  requireAllAuth?: boolean;
  /** 身份 API / 页面复核；返回 true 才允许落盘。有 sessionCookieNames 时必填。 */
  verifyLogin?: LoginVerifyFn;
}

async function jsonGet(
  page: Page,
  url: string,
): Promise<Record<string, unknown> | null> {
  try {
    const resp = await page.request.get(url, {
      headers: { Accept: "application/json", Referer: page.url() || "https://www.baidu.com/" },
      timeout: 12000,
    });
    if (!resp.ok()) return null;
    return (await resp.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const verifyZhihu: LoginVerifyFn = async (page) => {
  const data = await jsonGet(page, "https://www.zhihu.com/api/v4/me");
  if (!data) return false;
  // 登录成功有 id / name；未登录常 401 或无 id
  return typeof data.id === "string" || typeof data.id === "number" || typeof data.name === "string";
};

/**
 * 小红书登录确认（对齐 MediaCrawler）：
 * 1) 侧栏「我」/ profile 链接出现
 * 2) web_session 相对登录前 baseline 发生变化
 * 禁止用 page.request 打 edith /user/me——该接口要 x-s 签名，未签名永远像未登录，导致扫码成功也不落盘。
 */
async function confirmXhsLoggedIn(
  page: Page,
  context: BrowserContext,
  baselineWebSession: string,
): Promise<{ ok: boolean; via: string }> {
  // 1. UI（最可靠）
  try {
    const meVisible = await page
      .isVisible("xpath=//a[contains(@href, '/user/profile/')]//span[text()='我']", { timeout: 600 })
      .catch(() => false);
    if (meVisible) return { ok: true, via: "dom_me" };
  } catch {
    /* ignore */
  }
  try {
    const profileVisible = await page
      .locator('a[href*="/user/profile/"]')
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);
    if (profileVisible) return { ok: true, via: "dom_profile" };
  } catch {
    /* ignore */
  }

  // 2. web_session 值变化（MediaCrawler 主路径）
  const cookies = await context.cookies([
    "https://www.xiaohongshu.com",
    "https://edith.xiaohongshu.com",
  ]);
  const ws = cookies.find((c) => c.name === "web_session" && c.value)?.value ?? "";
  if (ws && baselineWebSession && ws !== baselineWebSession) {
    return { ok: true, via: "web_session_change" };
  }
  // baseline 为空但登录后才出现较长 web_session
  if (!baselineWebSession && ws.length >= 20) {
    return { ok: true, via: "web_session_new" };
  }

  // 3. 页面内 fetch（可选；签名失败则忽略）
  try {
    const me = await page.evaluate(async () => {
      try {
        const r = await fetch("https://edith.xiaohongshu.com/api/sns/web/v2/user/me", {
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        if (!r.ok) return null;
        return (await r.json()) as { data?: { guest?: boolean; user_id?: string } };
      } catch {
        return null;
      }
    });
    const inner = me?.data;
    if (inner && inner.guest === false) return { ok: true, via: "me_api" };
    if (inner?.user_id && inner.guest !== true) return { ok: true, via: "me_api" };
  } catch {
    /* ignore */
  }

  return { ok: false, via: "none" };
}

/** @deprecated 保留类型位；小红书改走 confirmXhsLoggedIn */
const verifyXhs: LoginVerifyFn = async (page, context) => {
  const r = await confirmXhsLoggedIn(page, context, "");
  return r.ok;
};

const verifyBilibili: LoginVerifyFn = async (page) => {
  const data = await jsonGet(page, "https://api.bilibili.com/x/web-interface/nav");
  if (!data) return false;
  const inner = (data.data && typeof data.data === "object" ? data.data : {}) as Record<string, unknown>;
  return inner.isLogin === true;
};

const verifyDouyin: LoginVerifyFn = async (page, context) => {
  // 抖音身份接口常变；以「认证 cookie 齐全 + 非空长 sessionid」为准，再试 profile
  const cookies = await context.cookies(["https://www.douyin.com"]);
  const sessionid = cookies.find((c) => c.name === "sessionid" && c.value && c.value.length >= 16);
  if (!sessionid) return false;
  const data = await jsonGet(page, "https://www.douyin.com/aweme/v1/web/user/profile/self/");
  if (data && (data.status_code === 0 || data.statusCode === 0)) {
    const user = data.user as Record<string, unknown> | undefined;
    if (user && (user.uid || user.sec_uid || user.nickname)) return true;
  }
  // profile 失败时：sessionid + sessionid_ss 同时存在且足够长，视为已登录
  const ss = cookies.find((c) => c.name === "sessionid_ss" && c.value && c.value.length >= 16);
  return Boolean(ss);
};

const verifyWeibo: LoginVerifyFn = async (page) => {
  const data = await jsonGet(page, "https://m.weibo.cn/api/config");
  if (!data) return false;
  const inner = (data.data && typeof data.data === "object" ? data.data : data) as Record<string, unknown>;
  if (inner.login === true || inner.isLogin === true) return true;
  // PC 端：有 uid 且非空
  if (typeof inner.uid === "string" && inner.uid.length > 2 && inner.uid !== "0") return true;
  return false;
};

const verifyJuejin: LoginVerifyFn = async (page) => {
  const data = await jsonGet(page, "https://api.juejin.cn/user_api/v1/user/get");
  if (!data) return false;
  if (data.err_no === 0 && data.data && typeof data.data === "object") {
    const u = data.data as Record<string, unknown>;
    return Boolean(u.user_id || u.user_name || u.user_id_str);
  }
  return false;
};

const verifyYuque: LoginVerifyFn = async (page) => {
  const data = await jsonGet(page, "https://www.yuque.com/api/mine");
  if (!data) return false;
  const inner = (data.data && typeof data.data === "object" ? data.data : data) as Record<string, unknown>;
  return Boolean(inner.id || inner.login || inner.name);
};

const verifyWechat: LoginVerifyFn = async (page, context) => {
  const cookies = await context.cookies(["https://mp.weixin.qq.com"]);
  const sid = cookies.find((c) => c.name === "slave_sid" && c.value && c.value.length > 8);
  if (!sid) return false;
  // 登录后 URL 通常带 token，或页面不再是纯登录页
  const url = page.url();
  if (url.includes("token=") || url.includes("home") || url.includes("cgi-bin")) return true;
  // 有 slave_sid + slave_user 即足够
  return cookies.some((c) => c.name === "slave_user" && Boolean(c.value));
};

const verifyCsdn: LoginVerifyFn = async (_page, context) => {
  const cookies = await context.cookies(["https://www.csdn.net", "https://blog.csdn.net"]);
  const user = cookies.find((c) => c.name === "UserName" && c.value);
  const token = cookies.find((c) => c.name === "UserToken" && c.value && c.value.length > 8);
  return Boolean(user && token);
};

export const PLATFORM_LOGIN_CONFIGS: Record<CookiePlatform, PlatformLoginConfig> = {
  zhihu: {
    platform: "zhihu",
    loginUrl: "https://www.zhihu.com/signin",
    cookieUrls: ["https://www.zhihu.com", "https://zhuanlan.zhihu.com"],
    storageStateFile: "zhihu_storage_state.json",
    // 禁止 d_c0（设备追踪，未登录就有）
    authCookieNames: ["z_c0"],
    verifyLogin: verifyZhihu,
  },
  wechat: {
    platform: "wechat",
    loginUrl: "https://mp.weixin.qq.com/",
    cookieUrls: ["https://mp.weixin.qq.com", "https://wx.qq.com"],
    storageStateFile: "wechat_storage_state.json",
    authCookieNames: ["slave_sid"],
    requireAllAuth: true,
    verifyLogin: verifyWechat,
  },
  xhs: {
    platform: "xhs",
    // explore 更容易弹出登录框；首页也可手动点登录
    loginUrl: "https://www.xiaohongshu.com/explore",
    cookieUrls: ["https://www.xiaohongshu.com", "https://edith.xiaohongshu.com"],
    storageStateFile: "xhs_storage_state.json",
    // C 端扫码通常只有 web_session 升级，不一定有 customer-sso-sid
    authCookieNames: ["customer-sso-sid", "galaxy_creator_session_id"],
    sessionCookieNames: ["web_session"],
    verifyLogin: verifyXhs,
  },
  douyin: {
    platform: "douyin",
    loginUrl: "https://www.douyin.com",
    cookieUrls: ["https://www.douyin.com", "https://creator.douyin.com"],
    storageStateFile: "douyin_storage_state.json",
    // 禁止 ttwid / __ac_nonce（设备/访客）；sid_tt 单独不够稳，以 sessionid 为准
    authCookieNames: ["sessionid", "sessionid_ss"],
    requireAllAuth: true,
    verifyLogin: verifyDouyin,
  },
  bilibili: {
    platform: "bilibili",
    loginUrl: "https://passport.bilibili.com/login",
    cookieUrls: ["https://www.bilibili.com", "https://api.bilibili.com", "https://passport.bilibili.com"],
    storageStateFile: "bilibili_storage_state.json",
    // 禁止 buvid3/b_nut（设备）；DedeUserID 单独不够，必须 SESSDATA
    authCookieNames: ["SESSDATA"],
    verifyLogin: verifyBilibili,
  },
  weibo: {
    platform: "weibo",
    loginUrl: "https://passport.weibo.com/signin/login",
    cookieUrls: ["https://weibo.com", "https://m.weibo.cn", "https://passport.weibo.com"],
    storageStateFile: "weibo_storage_state.json",
    // 禁止 SINAGLOBAL/UOR（访客）；SUB 才是登录凭证
    authCookieNames: ["SUB"],
    verifyLogin: verifyWeibo,
  },
  juejin: {
    platform: "juejin",
    loginUrl: "https://juejin.cn/login",
    cookieUrls: ["https://juejin.cn", "https://api.juejin.cn"],
    storageStateFile: "juejin_storage_state.json",
    // 禁止 __tea_*；sessionid_ss 可能跨站残留，以 sessionid + API 为准
    authCookieNames: ["sessionid"],
    verifyLogin: verifyJuejin,
  },
  csdn: {
    platform: "csdn",
    loginUrl: "https://passport.csdn.net/login",
    cookieUrls: ["https://www.csdn.net", "https://blog.csdn.net", "https://passport.csdn.net"],
    storageStateFile: "csdn_storage_state.json",
    // 禁止 uuid（设备 id）
    authCookieNames: ["UserName", "UserToken"],
    requireAllAuth: true,
    verifyLogin: verifyCsdn,
  },
  yuque: {
    platform: "yuque",
    loginUrl: "https://www.yuque.com/login",
    cookieUrls: ["https://www.yuque.com", "https://www.yuque.com/api"],
    storageStateFile: "yuque_storage_state.json",
    // 禁止泛化 session_id；只认 _yuque_session
    authCookieNames: ["_yuque_session"],
    verifyLogin: verifyYuque,
  },
};

export interface PlatformLoginResult {
  success: boolean;
  message: string;
  platform: CookiePlatform;
  authPath: string;
  fileSize: number;
  cookieCount?: number;
  hitCookie?: string;
  verifiedBy?: string;
}

type PwCookie = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
};

function getStorageStatePath(file: string): string {
  return path.join(getAppConfig().dataPaths.cookies, file);
}

/** 身份 API 复核通过后的离线标记（小红书等「会话 cookie 升级」平台无稳定 auth cookie 时用） */
function getLoginMetaPath(platform: CookiePlatform): string {
  return path.join(getAppConfig().dataPaths.cookies, `${platform}.login-meta.json`);
}

interface LoginMeta {
  platform: CookiePlatform;
  verifiedAt: string;
  verifiedBy: string;
  hitCookie?: string;
}

function writeLoginMeta(platform: CookiePlatform, meta: Omit<LoginMeta, "platform">): void {
  const p = getLoginMetaPath(platform);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(
    p,
    JSON.stringify({ platform, ...meta } satisfies LoginMeta, null, 2),
    "utf-8",
  );
}

function readLoginMeta(platform: CookiePlatform): LoginMeta | null {
  const p = getLoginMetaPath(platform);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as LoginMeta;
  } catch {
    return null;
  }
}

function clearLoginMeta(platform: CookiePlatform): void {
  const p = getLoginMetaPath(platform);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

export function getPlatformStorageStatePath(platform: string): string | null {
  const cfg = (PLATFORM_LOGIN_CONFIGS as Record<string, PlatformLoginConfig>)[platform];
  if (!cfg) return null;
  const p = getStorageStatePath(cfg.storageStateFile);
  return fs.existsSync(p) ? p : null;
}

export function collectNamedCookieMap(
  cookies: Array<{ name: string; value: string }>,
  names: string[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of cookies) {
    if (names.includes(c.name) && c.value && c.value.length > 0) {
      map.set(c.name, c.value);
    }
  }
  return map;
}

/** 相对 baseline：新出现或值变化 */
export function findChangedCookies(
  current: Map<string, string>,
  baseline: Map<string, string>,
): Array<{ name: string; value: string }> {
  const hits: Array<{ name: string; value: string }> = [];
  for (const [name, value] of current) {
    const prev = baseline.get(name);
    if (!prev || prev !== value) hits.push({ name, value });
  }
  return hits;
}

/** 离线：storageState/jar 是否含足够认证 cookie（不含访客 session） */
export function hasRequiredAuthCookies(
  cookies: Array<{ name?: string; value?: string }>,
  cfg: PlatformLoginConfig,
): { ok: boolean; hitCookies: string[] } {
  const present = new Set(
    cookies
      .filter((c) => c.name && c.value && cfg.authCookieNames.includes(c.name))
      .map((c) => c.name as string),
  );
  const hitCookies = [...present];
  if (cfg.requireAllAuth) {
    return {
      ok: cfg.authCookieNames.every((n) => present.has(n)),
      hitCookies,
    };
  }
  return { ok: hitCookies.length > 0, hitCookies };
}

/**
 * 轮询信号：认证 cookie 变化，或（有 verify 时）会话 cookie 值变化。
 * 纯会话变化不足以落盘——调用方还必须跑 verifyLogin。
 */
export function detectLoginCookieSignal(
  cookies: Array<{ name: string; value: string }>,
  baseline: Map<string, string>,
  cfg: PlatformLoginConfig,
): { hit: boolean; reason: string; hitCookie?: string } {
  const authNames = cfg.authCookieNames;
  const sessionNames = cfg.sessionCookieNames ?? [];
  const watchNames = [...authNames, ...sessionNames];
  const current = collectNamedCookieMap(cookies, watchNames);
  const changed = findChangedCookies(current, baseline);
  if (!changed.length) return { hit: false, reason: "no_change" };

  const authChanged = changed.filter((c) => authNames.includes(c.name));
  if (cfg.requireAllAuth) {
    const authMap = collectNamedCookieMap(cookies, authNames);
    const allPresent = authNames.every((n) => authMap.has(n));
    const anyAuthChanged = authChanged.length > 0;
    if (allPresent && anyAuthChanged) {
      return { hit: true, reason: "auth_all", hitCookie: authChanged[0]?.name };
    }
  } else if (authChanged.length) {
    return { hit: true, reason: "auth", hitCookie: authChanged[0].name };
  }

  const sessionChanged = changed.filter((c) => sessionNames.includes(c.name));
  if (sessionChanged.length && cfg.verifyLogin) {
    return { hit: true, reason: "session_change", hitCookie: sessionChanged[0].name };
  }
  return { hit: false, reason: "weak_signal" };
}

/** 从已落盘的 storageState / cookieJar / 身份复核 meta 判断是否已真登录 */
export function platformHasRealLoginCookies(platform: CookiePlatform): {
  loggedIn: boolean;
  hitCookies: string[];
  source: "storageState" | "cookieJar" | "loginMeta" | "none";
} {
  const cfg = PLATFORM_LOGIN_CONFIGS[platform];
  if (!cfg) return { loggedIn: false, hitCookies: [], source: "none" };

  const authPath = getStorageStatePath(cfg.storageStateFile);
  if (fs.existsSync(authPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(authPath, "utf-8")) as {
        cookies?: Array<{ name?: string; value?: string }>;
      };
      const check = hasRequiredAuthCookies(raw.cookies ?? [], cfg);
      if (check.ok) {
        return { loggedIn: true, hitCookies: check.hitCookies, source: "storageState" };
      }
      // 会话升级型登录（如小红书）：捕获成功时写了 login-meta（via=web_session_change/dom_me 等）
      const meta = readLoginMeta(platform);
      if (meta?.verifiedBy) {
        return {
          loggedIn: true,
          hitCookies: meta.hitCookie ? [meta.hitCookie] : [meta.verifiedBy],
          source: "loginMeta",
        };
      }
    } catch {
      /* fall through */
    }
  }

  const jar = loadCookies(platform);
  const check = hasRequiredAuthCookies(jar, cfg);
  if (check.ok) {
    return { loggedIn: true, hitCookies: check.hitCookies, source: "cookieJar" };
  }
  return { loggedIn: false, hitCookies: [], source: "none" };
}

export async function capturePlatformLoginState(
  platform: CookiePlatform,
  timeoutSec: number = 180,
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
  if ((cfg.sessionCookieNames?.length ?? 0) > 0 && !cfg.verifyLogin) {
    return {
      success: false,
      message: `${platform} 配置错误：使用了 sessionCookieNames 但未提供 verifyLogin（会误判访客态）`,
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
    await page.waitForTimeout(2500);

    // 小红书：若未自动弹登录框，点一次登录按钮露出二维码
    if (platform === "xhs") {
      try {
        const loginBtn = page.locator("xpath=//*[@id='app']/div[1]/div[2]/div[1]/ul/div[1]/button");
        if (await loginBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
          await loginBtn.click().catch(() => undefined);
          await page.waitForTimeout(800);
        }
      } catch {
        /* 用户也可手动点登录 */
      }
    }

    const watchNames = [...cfg.authCookieNames, ...(cfg.sessionCookieNames ?? [])];
    let baseline = new Map<string, string>();
    try {
      const initial = await context.cookies(cfg.cookieUrls);
      baseline = collectNamedCookieMap(initial, watchNames);
    } catch {
      baseline = new Map();
    }
    const baselineWebSession = baseline.get("web_session") ?? "";

    const timeoutMs = Math.max(30, timeoutSec) * 1000;
    const pollInterval = 2500;
    const startTime = Date.now();
    /** 仅 web_session 变化时需连续确认 2 次，防访客会话抖动误存 */
    let xhsSessionStreak = 0;
    let lastFailHint = "";

    while (Date.now() - startTime < timeoutMs) {
      await page.waitForTimeout(pollInterval);
      let pwCookies: PwCookie[];
      try {
        pwCookies = await context.cookies(cfg.cookieUrls);
      } catch {
        continue;
      }

      let verifiedBy = "";
      let hitCookie: string | undefined;

      if (platform === "xhs") {
        const confirm = await confirmXhsLoggedIn(page, context, baselineWebSession);
        if (!confirm.ok) {
          xhsSessionStreak = 0;
          lastFailHint = "等待扫码后 web_session 变化或侧栏出现「我」";
          continue;
        }
        if (confirm.via === "web_session_change" || confirm.via === "web_session_new") {
          xhsSessionStreak += 1;
          if (xhsSessionStreak < 2) {
            lastFailHint = `已检测到 web_session 变化，再确认一次 (${xhsSessionStreak}/2)…`;
            continue;
          }
        } else {
          xhsSessionStreak = 0;
        }
        verifiedBy = confirm.via;
        hitCookie = "web_session";
      } else {
        const signal = detectLoginCookieSignal(pwCookies, baseline, cfg);
        if (!signal.hit) {
          lastFailHint = "等待登录 cookie 出现";
          continue;
        }
        hitCookie = signal.hitCookie;
        if (cfg.verifyLogin) {
          const ok = await cfg.verifyLogin(page, context);
          if (!ok) {
            lastFailHint = `已有 cookie 信号(${signal.reason})但身份复核未通过`;
            continue;
          }
          verifiedBy = "identity_api";
        } else {
          const check = hasRequiredAuthCookies(pwCookies, cfg);
          if (!check.ok) {
            lastFailHint = "认证 cookie 不齐";
            continue;
          }
          verifiedBy = "auth_cookies";
        }
      }

      // 落盘前稍等，让跳转后的 cookie 写全
      await page.waitForTimeout(1500);
      try {
        pwCookies = await context.cookies(cfg.cookieUrls);
      } catch {
        /* 用上一轮 cookies */
      }

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
      writeLoginMeta(platform, {
        verifiedAt: new Date().toISOString(),
        verifiedBy,
        hitCookie,
      });
      const fileSize = fs.existsSync(authPath) ? fs.statSync(authPath).size : 0;
      return {
        success: true,
        message: `${platform} 登录态已捕获（via=${verifiedBy}，storageState ${(fileSize / 1024).toFixed(1)}KB，cookieJar ${jarEntries.length} 条）。请用 browser_login_status 确认 loggedIn=true。`,
        platform,
        authPath,
        fileSize,
        cookieCount: jarEntries.length,
        hitCookie,
        verifiedBy,
      };
    }

    return {
      success: false,
      message: `${platform} 登录超时未落盘。${lastFailHint ? `最后状态：${lastFailHint}。` : ""}小红书以扫码后 web_session 变化或侧栏「我」为准（不再依赖需签名的 /user/me）。请在窗口内完成扫码，或加大 timeoutSec（建议 ≥180）。`,
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

export function listPlatformLoginStatus(): Array<{
  platform: CookiePlatform;
  loginUrl: string;
  hasStorageState: boolean;
  storageStateSize: number;
  loggedIn: boolean;
  hitCookies: string[];
  authCookieNames: string[];
  hasIdentityVerify: boolean;
}> {
  return Object.values(PLATFORM_LOGIN_CONFIGS).map((cfg) => {
    const authPath = getStorageStatePath(cfg.storageStateFile);
    let size = 0;
    try {
      if (fs.existsSync(authPath)) size = fs.statSync(authPath).size;
    } catch {
      // ignore
    }
    const real = platformHasRealLoginCookies(cfg.platform);
    return {
      platform: cfg.platform,
      loginUrl: cfg.loginUrl,
      hasStorageState: size > 0,
      storageStateSize: size,
      loggedIn: real.loggedIn,
      hitCookies: real.hitCookies,
      authCookieNames: cfg.authCookieNames,
      hasIdentityVerify: Boolean(cfg.verifyLogin),
    };
  });
}

export function purgeInvalidPlatformLogin(platform: CookiePlatform): {
  purged: boolean;
  reason: string;
} {
  const cfg = PLATFORM_LOGIN_CONFIGS[platform];
  if (!cfg) return { purged: false, reason: "unknown platform" };
  const real = platformHasRealLoginCookies(platform);
  if (real.loggedIn) {
    return { purged: false, reason: `已含真登录 cookie: ${real.hitCookies.join(",")}` };
  }
  const authPath = getStorageStatePath(cfg.storageStateFile);
  const jarPath = path.join(getAppConfig().dataPaths.cookies, `${platform}.json`);
  const metaPath = getLoginMetaPath(platform);
  let removed = false;
  for (const p of [authPath, jarPath, metaPath]) {
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      removed = true;
    }
  }
  clearLoginMeta(platform);
  return {
    purged: removed,
    reason: removed
      ? "已删除仅含访客/空登录态的文件（认证 cookie 不足且无身份复核标记）"
      : "无本地登录态文件",
  };
}

/** 清理全部平台的无效假登录态 */
export function purgeAllInvalidPlatformLogins(): Array<{ platform: CookiePlatform; purged: boolean; reason: string }> {
  return (Object.keys(PLATFORM_LOGIN_CONFIGS) as CookiePlatform[]).map((platform) => ({
    platform,
    ...purgeInvalidPlatformLogin(platform),
  }));
}
