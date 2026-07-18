/**
 * ============================================================================
 * Lark Token 管理器
 * ============================================================================
 *
 * 解决 env 热更新问题: 
 * - 不依赖 process.env.FEISHU_USER_ACCESS_TOKEN(进程启动后不会重新加载)
 * - 从独立 JSON 缓存文件读取 token,每次调用前都重新读取,实现热更新
 * - access_token 过期前自动用 refresh_token 刷新
 * - refresh_token 过期时抛出自定义错误,引导重新授权
 *
 * @module server/services
 */

import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { exec } from "child_process";
import { randomBytes } from "crypto";
import { URL } from "url";

const FEISHU_BASE = "https://open.feishu.cn/open-apis";
const ACCOUNTS_AUTHORIZE = "https://accounts.feishu.cn/open-apis/authen/v1/authorize";

/** 默认申请的用户 scope（含画板/IM/权限；应用后台须先开通对应权限） */
export const FEISHU_DEFAULT_OAUTH_SCOPES = [
  "offline_access",
  "board:whiteboard:node:read",
  "board:whiteboard:node:create",
  "board:whiteboard:node:delete",
  "docx:document",
  "drive:drive",
  "wiki:wiki",
  "search:docs:read",
  // 协作者增删改（文档权限 API；建群用 im:chat，勿带未开通的 create_as_user → 20043）
  "im:chat",
  "im:chat:create",
  "im:chat:delete",
  "im:chat:read",
  "im:chat:update",
  "docs:permission.member:create",
  "docs:permission.member:update",
  "docs:permission.member:delete",
  "docs:permission.member:retrieve",
  "docs:permission.setting:read",
  "docs:permission.setting:write_only",
].join(" ");

function readEnv(...keys: string[]): string {
  for (const key of keys) {
    const val = process.env[key];
    if (val && val.trim()) return val.trim();
  }
  return "";
}

function getLarkAppId(): string {
  return readEnv("FEISHU_APP_ID", "LARK_APP_ID");
}

function getLarkAppSecret(): string {
  return readEnv("FEISHU_APP_SECRET", "LARK_APP_SECRET");
}

/** 解析 monorepo 根（避免从 apps/server 启动时读到 apps/server/content/...） */
function resolveRepoRoot(): string {
  if (process.env.KNOWPILOT_ROOT?.trim()) return path.resolve(process.env.KNOWPILOT_ROOT.trim());
  const candidates = [
    process.cwd(),
    path.resolve(process.cwd(), "../.."),
    path.resolve(process.cwd(), "../../.."),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "pnpm-workspace.yaml"))) return candidate;
  }
  return path.resolve(process.cwd(), "../..");
}

/** 缓存文件路径: 仓库根/content/cookies/feishu_oauth.json */
function getCachePath(): string {
  return path.join(resolveRepoRoot(), "content", "cookies", "feishu_oauth.json");
}

/** 读取缓存文件 */
function readCache(): CacheData | null {
  try {
    const cachePath = getCachePath();
    if (!fs.existsSync(cachePath)) return null;
    const raw = fs.readFileSync(cachePath, "utf-8");
    return JSON.parse(raw) as CacheData;
  } catch {
    return null;
  }
}

/** 写入缓存文件 */
function writeCache(data: CacheData): void {
  try {
    fs.writeFileSync(getCachePath(), JSON.stringify(data, null, 2), "utf-8");
  } catch (e) {
    console.error("[LarkTokenManager] 写入缓存失败:", e);
  }
}

/** 缓存数据结构 */
interface CacheData {
  app_id: string;
  access_token: string;
  refresh_token?: string;
  expire_at: number;
  refresh_expire_at?: number;
  scope: string;
  saved_at: number;
}

/** 刷新结果 */
interface RefreshResult {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  refresh_token_expires_in?: number;
  scope: string;
}

/** 自定义错误类型 */
export class RefreshTokenExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefreshTokenExpiredError";
  }
}

/** 调用飞书刷新接口 */
async function doRefresh(refreshToken: string): Promise<RefreshResult> {
  const res = await fetch(`${FEISHU_BASE}/authen/v2/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: getLarkAppId(),
      client_secret: getLarkAppSecret(),
      refresh_token: refreshToken,
    }),
  });

  const data = await res.json();

  if (data.code !== 0) {
    const errorCode = data.code;
    const errorDesc = data.error_description || data.msg || "Unknown";

    // refresh_token 失效的错误码
    if (errorCode === 20026 || errorCode === 20037 || errorCode === 20064 || errorCode === 20073) {
      throw new RefreshTokenExpiredError(
        `refresh_token 已失效(${errorDesc}). 用户授权已满365天或 token 已被使用,需要重新走 OAuth 授权流程. `
      );
    }
    if (errorCode === 20074) {
      throw new Error(
        `应用未开启刷新 token 权限(${errorDesc}). 请在开发者后台 → 安全设置 → 开启刷新开关,并重新发版. `
      );
    }
    throw new Error(`刷新 token 失败: ${errorDesc} (code: ${errorCode})`);
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    refresh_token_expires_in: data.refresh_token_expires_in,
    scope: data.scope || "",
  };
}

// ── 内存缓存(用于减少文件读取次数,但过期时会重新读文件)──
let memCache: { data: CacheData; loadedAt: number } | null = null;
const MEM_CACHE_TTL_MS = 5000; // 内存缓存 5 秒

/**
 * 获取有效的 user_access_token(热更新 + 自动刷新)
 *
 * 执行逻辑: 
 * 1. 从 JSON 缓存文件读取最新 token
 * 2. 如果 access_token 还有 5 分钟以上有效期,直接返回
 * 3. 如果快过期/已过期,用 refresh_token 自动刷新
 * 4. 刷新成功后写回缓存文件,返回新 token
 * 5. 如果 refresh_token 也过期,抛出 RefreshTokenExpiredError
 */
export async function getUserAccessToken(): Promise<string> {
  const now = Date.now() / 1000; // 秒
  const cachePath = getCachePath();

  // 优先读文件(热更新),内存缓存只减少高频读取
  let cache: CacheData | null = null;
  if (memCache && Date.now() - memCache.loadedAt < MEM_CACHE_TTL_MS) {
    cache = memCache.data;
  } else {
    cache = readCache();
    if (cache) {
      memCache = { data: cache, loadedAt: Date.now() };
    }
  }

  if (!cache || !cache.access_token) {
    throw new Error(
      `没有找到 user_access_token 缓存文件: ${cachePath}\n` +
      "请先在 notebook 中运行授权流程获取 token,token 会自动保存到上述路径. "
    );
  }

  // 还有 5 分钟以上有效期,直接返回
  if (cache.expire_at > now + 300) {
    return cache.access_token;
  }

  // 快过期了,尝试刷新
  if (!cache.refresh_token) {
    throw new Error(
      "access_token 即将过期,但缓存中没有 refresh_token,无法自动续期. \n" +
      "请在授权时申请 offline_access 权限,或重新运行授权流程. "
    );
  }

  console.log("[LarkTokenManager] access_token 即将过期,自动刷新中...");
  const refreshed = await doRefresh(cache.refresh_token);

  // 更新缓存
  const newCache: CacheData = {
    app_id: getLarkAppId(),
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token || cache.refresh_token,
    expire_at: now + refreshed.expires_in,
    refresh_expire_at: refreshed.refresh_token_expires_in
      ? now + refreshed.refresh_token_expires_in
      : cache.refresh_expire_at,
    scope: refreshed.scope,
    saved_at: now,
  };

  writeCache(newCache);
  memCache = { data: newCache, loadedAt: Date.now() };

  console.log(
    `[LarkTokenManager] 刷新成功,新 token 有效期 ${refreshed.expires_in}s`
  );
  return refreshed.access_token;
}

/**
 * 获取当前 token 状态(供状态查询工具使用)
 */
export function getTokenStatus(): {
  exists: boolean;
  access_token_valid: boolean;
  access_token_expire_in?: number;
  refresh_token_exists: boolean;
  refresh_token_expire_in?: number;
  cache_path: string;
} {
  const now = Date.now() / 1000;
  const cache = readCache();
  const cachePath = getCachePath();

  if (!cache) {
    return {
      exists: false,
      access_token_valid: false,
      refresh_token_exists: false,
      cache_path: cachePath,
    };
  }

  return {
    exists: true,
    access_token_valid: cache.expire_at > now + 60,
    access_token_expire_in: Math.max(0, Math.round(cache.expire_at - now)),
    refresh_token_exists: !!cache.refresh_token,
    refresh_token_expire_in: cache.refresh_expire_at
      ? Math.max(0, Math.round(cache.refresh_expire_at - now))
      : undefined,
    cache_path: cachePath,
  };
}

/**
 * 手动刷新 token(供外部调用)
 */
export async function refreshTokenManually(): Promise<{
  success: boolean;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
}> {
  const cache = readCache();
  if (!cache || !cache.refresh_token) {
    return {
      success: false,
      error: "缓存中没有 refresh_token,无法刷新. 请先运行授权流程获取初始 token. ",
    };
  }

  try {
    const now = Date.now() / 1000;
    const refreshed = await doRefresh(cache.refresh_token);
    const newCache: CacheData = {
      app_id: getLarkAppId(),
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token || cache.refresh_token,
      expire_at: now + refreshed.expires_in,
      refresh_expire_at: refreshed.refresh_token_expires_in
        ? now + refreshed.refresh_token_expires_in
        : cache.refresh_expire_at,
      scope: refreshed.scope,
      saved_at: now,
    };
    writeCache(newCache);
    memCache = { data: newCache, loadedAt: Date.now() };

    return {
      success: true,
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      expires_in: refreshed.expires_in,
    };
  } catch (e: any) {
    return {
      success: false,
      error: e.message,
    };
  }
}

export type FeishuAuthorizeResult = {
  success: boolean;
  cachePath: string;
  accessTokenPrefix?: string;
  hasRefreshToken?: boolean;
  expiresIn?: number;
  scope?: string;
  authUrl?: string;
  error?: string;
};

function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd =
    platform === "win32"
      ? `start "" "${url}"`
      : platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, () => undefined);
}

/**
 * 浏览器 OAuth 授权：拉起本地回调 → 换 token → 写入 feishu_oauth.json
 * 与 capture_zhihu_login 同模式：需用户在浏览器点一次同意；之后靠 refresh 自动续。
 */
export async function authorizeUserViaBrowser(options?: {
  redirectUri?: string;
  port?: number;
  timeoutSec?: number;
  scope?: string;
  openBrowser?: boolean;
}): Promise<FeishuAuthorizeResult> {
  // 确保从仓库根 .env 读到 APP_ID/SECRET（tsx 直接跑脚本时未必已 load）
  try {
    const { loadRootEnv } = await import("../config.js");
    loadRootEnv();
  } catch {
    /* ignore */
  }

  const appId = getLarkAppId();
  const appSecret = getLarkAppSecret();
  const cachePath = getCachePath();
  if (!appId || !appSecret) {
    return {
      success: false,
      cachePath,
      error: "未配置 FEISHU_APP_ID / FEISHU_APP_SECRET",
    };
  }

  const redirectUri = options?.redirectUri || "http://localhost:8088";
  const port = options?.port ?? 8088;
  const timeoutSec = options?.timeoutSec ?? 180;
  const scope = (options?.scope || FEISHU_DEFAULT_OAUTH_SCOPES).trim();
  const state = randomBytes(16).toString("base64url");
  const authUrl =
    `${ACCOUNTS_AUTHORIZE}?app_id=${encodeURIComponent(appId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(scope)}` +
    `&state=${encodeURIComponent(state)}`;

  type Pending = {
    done: boolean;
    error?: string;
    data?: {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      refresh_token_expires_in?: number;
      scope?: string;
    };
  };
  const pending: Pending = { done: false };

  const server = http.createServer(async (req, res) => {
    try {
      const rawUrl = req.url || "/";
      // 浏览器预检 / 旧标签页：无 code 的请求一律忽略，勿结束整个授权流程
      if (rawUrl.includes("favicon") || rawUrl === "/" || !rawUrl.includes("code=")) {
        if (!rawUrl.includes("code=")) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end("<p>等待飞书授权回调…请在授权页点击同意。</p>");
          return;
        }
      }
      const u = new URL(rawUrl, redirectUri);
      const code = u.searchParams.get("code");
      const returnedState = u.searchParams.get("state");
      if (!code) {
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("waiting");
        return;
      }
      if (returnedState !== state) {
        // 旧标签页带过期 state：提示用户关掉旧页，不要把本次授权判死
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          "<h2>这是过期的授权回调（state 不匹配）</h2><p>请关闭本页，回到最新弹出的飞书授权窗口重新点「同意」。</p>",
        );
        return;
      }

      const tokenRes = await fetch(`${FEISHU_BASE}/authen/v2/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: appId,
          client_secret: appSecret,
          code,
          redirect_uri: redirectUri,
        }),
      });
      const tokenJson = (await tokenRes.json()) as {
        code?: number;
        msg?: string;
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        refresh_token_expires_in?: number;
        scope?: string;
      };
      if (tokenJson.code !== 0 || !tokenJson.access_token) {
        const err = tokenJson.msg || `HTTP ${tokenRes.status}`;
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<h2 style="color:red">换取 token 失败</h2><p>${err}</p>`);
        pending.error = err;
        pending.done = true;
        return;
      }

      pending.data = {
        access_token: tokenJson.access_token,
        refresh_token: tokenJson.refresh_token,
        expires_in: tokenJson.expires_in,
        refresh_token_expires_in: tokenJson.refresh_token_expires_in,
        scope: tokenJson.scope,
      };
      pending.done = true;
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        "<h2 style='color:green'>飞书授权成功</h2><p>可关闭此页，回到 KnowPilot。</p>",
      );
    } catch (e) {
      pending.error = e instanceof Error ? e.message : String(e);
      pending.done = true;
      res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<h2>错误</h2><p>${pending.error}</p>`);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });

  if (options?.openBrowser !== false) openBrowser(authUrl);

  const deadline = Date.now() + timeoutSec * 1000;
  try {
    while (!pending.done && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 400));
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  if (!pending.done) {
    return {
      success: false,
      cachePath,
      authUrl,
      error: `等待授权超时（${timeoutSec}s）。请打开 authUrl 完成扫码后重试。`,
    };
  }
  if (pending.error || !pending.data?.access_token) {
    return {
      success: false,
      cachePath,
      authUrl,
      error: pending.error || "未拿到 access_token",
    };
  }

  const now = Date.now() / 1000;
  const expiresIn = pending.data.expires_in ?? 7200;
  const newCache: CacheData = {
    app_id: appId,
    access_token: pending.data.access_token,
    refresh_token: pending.data.refresh_token,
    expire_at: now + expiresIn,
    refresh_expire_at: pending.data.refresh_token_expires_in
      ? now + pending.data.refresh_token_expires_in
      : undefined,
    scope: pending.data.scope || scope,
    saved_at: now,
  };
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  writeCache(newCache);
  memCache = { data: newCache, loadedAt: Date.now() };

  return {
    success: true,
    cachePath,
    accessTokenPrefix: pending.data.access_token.slice(0, 12) + "...",
    hasRefreshToken: Boolean(pending.data.refresh_token),
    expiresIn,
    scope: pending.data.scope,
    authUrl,
  };
}
