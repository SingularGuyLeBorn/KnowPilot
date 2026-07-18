/**
 * Cookie Jar — 网页访问登录态持久化
 *
 * 保存/复用各平台 Cookie，支持从 .env 初始化。
 * 文件路径：content/cookies/{platform}.json（Git 不跟踪）
 */

import fs from "fs";
import path from "path";

export type CookiePlatform = "zhihu" | "wechat" | "xhs" | "douyin" | "yuque";

const COOKIE_DIR = path.join(process.env.KNOWPILOT_ROOT || process.cwd(), "content", "cookies");

function getCookiePath(platform: CookiePlatform): string {
  return path.join(COOKIE_DIR, `${platform}.json`);
}

function getEnvCookieName(platform: CookiePlatform): string[] {
  switch (platform) {
    case "zhihu":
      return ["ZHIHU_COOKIE"];
    case "wechat":
      return ["WECHAT_COOKIE"];
    case "xhs":
      return ["XHS_COOKIE", "XIAOHONGSHU_COOKIE"];
    case "douyin":
      return ["DOUYIN_COOKIE"];
    case "yuque":
      return ["YUQUE_SESSION"];
    default:
      return [];
  }
}

function readEnvCookie(platform: CookiePlatform): string | undefined {
  for (const name of getEnvCookieName(platform)) {
    const val = process.env[name]?.trim();
    if (val) return val;
  }
  return undefined;
}

export interface CookieJarEntry {
  name: string;
  value: string;
  domain: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

/** 从 Cookie 头字符串解析为 Playwright cookie 格式 */
export function parseCookieHeader(header: string, domain: string): CookieJarEntry[] {
  return header
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((part) => {
      const eq = part.indexOf("=");
      const name = eq > 0 ? part.slice(0, eq).trim() : part;
      const value = eq > 0 ? part.slice(eq + 1).trim() : "";
      return { name, value, domain, path: "/" };
    });
}

/** 加载某平台 Cookie（优先文件，fallback .env） */
export function loadCookies(platform: CookiePlatform): CookieJarEntry[] {
  const cookiePath = getCookiePath(platform);
  if (fs.existsSync(cookiePath)) {
    try {
      const raw = fs.readFileSync(cookiePath, "utf-8");
      const parsed = JSON.parse(raw) as CookieJarEntry[];
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // 忽略损坏文件
    }
  }

  const envCookie = readEnvCookie(platform);
  if (!envCookie) return [];

  const domain =
    platform === "zhihu"
      ? ".zhihu.com"
      : platform === "wechat"
        ? ".weixin.qq.com"
        : platform === "xhs"
          ? ".xiaohongshu.com"
          : platform === "douyin"
            ? ".douyin.com"
            : platform === "yuque"
              ? ".yuque.com"
              : "";
  const entries = parseCookieHeader(envCookie, domain);
  saveCookies(platform, entries);
  return entries;
}

/** 保存某平台 Cookie */
export function saveCookies(platform: CookiePlatform, cookies: CookieJarEntry[]): void {
  fs.mkdirSync(COOKIE_DIR, { recursive: true });
  fs.writeFileSync(getCookiePath(platform), JSON.stringify(cookies, null, 2), "utf-8");
}

/** CookieJar → HTTP Cookie 头 */
export function cookiesToHeader(cookies: CookieJarEntry[]): string {
  return cookies
    .filter((c) => c.name && c.value)
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

/** 追加/更新 Cookie（按 name + domain） */
export function mergeCookies(platform: CookiePlatform, newCookies: CookieJarEntry[]): CookieJarEntry[] {
  const existing = loadCookies(platform);
  const map = new Map<string, CookieJarEntry>();
  for (const c of existing) map.set(`${c.domain}:${c.name}`, c);
  for (const c of newCookies) map.set(`${c.domain}:${c.name}`, c);
  const merged = Array.from(map.values());
  saveCookies(platform, merged);
  return merged;
}

/** 把 Cookie Jar 应用到 Playwright context */
export async function applyCookies(
  context: { addCookies: (cookies: CookieJarEntry[]) => Promise<void> },
  platform: CookiePlatform,
): Promise<void> {
  const cookies = loadCookies(platform);
  if (cookies.length) await context.addCookies(cookies);
}

/** 从 Playwright context 抓取 Cookie 并保存 */
export async function captureCookies(
  context: { cookies: (urls?: string[]) => Promise<CookieJarEntry[]> },
  platform: CookiePlatform,
  urls?: string[],
): Promise<CookieJarEntry[]> {
  const cookies = await context.cookies(urls);
  mergeCookies(platform, cookies);
  return cookies;
}

/** 列出已保存的平台 */
export function listSavedCookiePlatforms(): CookiePlatform[] {
  if (!fs.existsSync(COOKIE_DIR)) return [];
  return fs
    .readdirSync(COOKIE_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""))
    .filter((p): p is CookiePlatform => ["zhihu", "wechat", "xhs", "douyin", "yuque"].includes(p));
}
