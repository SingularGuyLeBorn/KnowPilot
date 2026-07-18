/**
 * Yuque API Client — Web Cookie API + Open API v2
 *
 * - Web：`YUQUE_SESSION` + `YUQUE_CTOKEN`（_ctoken CSRF）→ /api/*
 * - Open API v2：`YUQUE_TOKEN` / `YUQUE_PERSONAL_TOKEN`（勿与 CSRF ctoken 混用）→ /api/v2/*
 */

import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "./config.js";
import { getCredentialValue } from "./credentialVault.js";

const YUQUE_BASE = "https://www.yuque.com";

export interface YuqueCredentials {
  session: string;
  ctoken: string;
}

function readEnv(...keys: string[]): string {
  for (const k of keys) {
    const v = process.env[k]?.trim();
    if (v) return v;
  }
  return "";
}

export async function getYuqueCredentials(
  prisma: PrismaClient | undefined,
  config: AppConfig,
): Promise<YuqueCredentials> {
  let session = config.integrations.yuque.session || "";
  let ctoken = config.integrations.yuque.ctoken || "";

  if (prisma && (!session || !ctoken)) {
    session = (await getCredentialValue(prisma, "yuque", "yuque_session")) || session;
    ctoken = (await getCredentialValue(prisma, "yuque", "yuque_ctoken")) || ctoken;
  }

  if (!session) {
    throw new Error(
      "【语雀认证失败】未配置 YUQUE_SESSION。\n" +
        "1. 登录语雀网页版 https://www.yuque.com\n" +
        "2. F12 → Application → Cookies → https://www.yuque.com\n" +
        "3. 复制 _yuque_session 和 _ctoken 到 .env（YUQUE_SESSION / YUQUE_CTOKEN）或 Credentials",
    );
  }
  return { session, ctoken };
}

/** Open API v2 个人令牌（与 Web CSRF ctoken 分离） */
export async function getYuquePersonalToken(
  prisma: PrismaClient | undefined,
  config: AppConfig,
): Promise<string> {
  let token = config.integrations.yuque.personalToken || readEnv("YUQUE_TOKEN", "YUQUE_PERSONAL_TOKEN");
  if (prisma && !token) {
    token =
      (await getCredentialValue(prisma, "yuque", "yuque_token")) ||
      (await getCredentialValue(prisma, "yuque", "yuque_personal_token")) ||
      "";
  }
  if (!token) {
    throw new Error(
      "【语雀 Open API】未配置个人令牌。请设置 YUQUE_TOKEN（语雀 → 设置 → 令牌），" +
        "不要用网页 Cookie 的 _ctoken（那是 CSRF，不是 X-Auth-Token）。",
    );
  }
  return token;
}

function buildHeaders(ctoken: string, referer?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    Accept: "application/json, text/plain, */*",
    "X-CSRF-Token": ctoken,
    "X-Requested-With": "XMLHttpRequest",
  };
  if (referer) headers["Referer"] = referer;
  return headers;
}

function assertYuqueJsonOk(res: Response, data: unknown, path: string): void {
  const ctype = res.headers.get("content-type") || "";
  if (!res.ok) {
    const msg =
      typeof data === "object" && data && "message" in data
        ? String((data as { message?: string }).message)
        : res.statusText;
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `【语雀会话失效】HTTP ${res.status} ${msg}（${path}）。请重新从浏览器复制 _yuque_session / _ctoken 到 .env。`,
      );
    }
    throw new Error(`语雀 API 失败: ${msg} (${res.status}) path=${path}`);
  }
  if (ctype.includes("text/html")) {
    throw new Error(
      `【语雀会话失效】返回 HTML 登录页而非 JSON（${path}）。请更新 YUQUE_SESSION / YUQUE_CTOKEN。`,
    );
  }
}

export async function yuqueApi(
  method: string,
  path: string,
  options: {
    body?: unknown;
    query?: Record<string, string>;
    referer?: string;
    credentials?: YuqueCredentials;
  } = {},
): Promise<any> {
  const { session, ctoken } = options.credentials!;

  let url = `${YUQUE_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  if (options.query) {
    const params = new URLSearchParams(options.query);
    url += "?" + params.toString();
  }

  const headers = buildHeaders(ctoken, options.referer);
  headers["Cookie"] = `_yuque_session=${session}; _ctoken=${ctoken}`;
  if (options.body && method !== "GET" && method !== "DELETE") {
    headers["Content-Type"] = "application/json";
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
      redirect: "manual",
    });
    if (res.status >= 300 && res.status < 400) {
      throw new Error(
        `【语雀会话失效】被重定向到登录（HTTP ${res.status}）。请更新 YUQUE_SESSION / YUQUE_CTOKEN。`,
      );
    }
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      assertYuqueJsonOk(res, { message: text.slice(0, 80) }, path);
      throw new Error(`语雀返回非 JSON：${text.slice(0, 120)}`);
    }
    assertYuqueJsonOk(res, data, path);
    return data;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function yuqueOpenApi<T = unknown>(
  method: string,
  endpoint: string,
  options: { body?: unknown; query?: Record<string, string>; token?: string } = {},
): Promise<T> {
  const url = new URL(`https://www.yuque.com/api/v2${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`);
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) url.searchParams.set(k, v);
  }
  const headers: Record<string, string> = {
    "User-Agent": "KnowPilot/1.0",
    Accept: "application/json",
    "X-Auth-Token": options.token || "",
  };
  if (options.body && method !== "GET") {
    headers["Content-Type"] = "application/json";
  }

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url.toString(), {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as {
      status?: number;
      message?: string;
      data?: T;
    };
    if (res.ok && data.status === undefined) {
      return data.data as T;
    }
    lastErr = new Error(`语雀 API 失败: ${data.message || res.statusText} (${res.status})`);
    if (res.status !== 429 && res.status < 500) break;
    await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
  }
  throw lastErr ?? new Error("语雀 API 失败");
}

/** 轻量探测 Cookie 是否仍有效 */
export async function yuqueProbeSession(credentials: YuqueCredentials): Promise<{ ok: boolean; detail: string }> {
  try {
    const data = await yuqueListBooks(credentials);
    const n = Array.isArray(data) ? data.length : (data as { data?: unknown[] })?.data?.length ?? 0;
    return { ok: true, detail: `books=${n}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

/* ─── 内部 Web API 快捷 ─── */

export async function yuqueListBooks(credentials: YuqueCredentials) {
  return yuqueApi("GET", "/api/books", { credentials });
}

export async function yuqueGetBookToc(bookId: string, credentials: YuqueCredentials) {
  return yuqueApi("GET", `/api/books/${bookId}/toc`, { credentials });
}

export async function yuqueCreateBook(
  name: string,
  options: { description?: string; public?: number; slug?: string },
  credentials: YuqueCredentials,
) {
  return yuqueApi("POST", "/api/books", {
    body: {
      name,
      description: options.description || "",
      public: options.public ?? 0,
      ...(options.slug ? { slug: options.slug } : {}),
    },
    referer: `${YUQUE_BASE}/dashboard`,
    credentials,
  });
}

export async function yuqueUpdateBook(
  bookId: string,
  options: { name?: string; description?: string; public?: number },
  credentials: YuqueCredentials,
) {
  return yuqueApi("PUT", `/api/books/${bookId}`, {
    body: options,
    referer: `${YUQUE_BASE}/dashboard`,
    credentials,
  });
}

export async function yuqueDeleteBook(bookId: string, credentials: YuqueCredentials) {
  return yuqueApi("DELETE", `/api/books/${bookId}`, {
    referer: `${YUQUE_BASE}/dashboard`,
    credentials,
  });
}

export async function yuqueGetDocWeb(docSlug: string, bookId: string, credentials: YuqueCredentials) {
  return yuqueApi("GET", `/api/docs/${docSlug}`, { query: { book_id: bookId }, credentials });
}

export async function yuqueCreateDoc(
  bookId: string,
  title: string,
  body: string,
  credentials: YuqueCredentials,
) {
  return yuqueApi("POST", "/api/docs", {
    body: { book_id: bookId, title, body, format: "markdown" },
    referer: `${YUQUE_BASE}/api/docs`,
    credentials,
  });
}

export async function yuqueUpdateDoc(
  docId: string,
  bookId: string,
  title: string,
  body: string,
  credentials: YuqueCredentials,
) {
  return yuqueApi("PUT", `/api/docs/${docId}`, {
    body: { title, body, format: "markdown" },
    referer: `${YUQUE_BASE}/api/docs`,
    credentials,
  });
}

export async function yuqueDeleteDoc(docId: string, bookId: string, credentials: YuqueCredentials) {
  return yuqueApi("DELETE", `/api/docs/${docId}`, {
    query: { book_id: bookId },
    referer: `${YUQUE_BASE}/api/docs`,
    credentials,
  });
}

/* ─── Open API v2 快捷 ─── */

export async function yuqueListRepos(token: string) {
  return yuqueOpenApi("GET", "/users/me/repos", { token });
}

/** 当前登录用户（Open API） */
export async function yuqueGetUser(token: string) {
  return yuqueOpenApi<{ login?: string; name?: string; id?: number }>("GET", "/user", { token });
}

export async function yuqueCreateRepo(
  name: string,
  options: { description?: string; public?: number; slug?: string; login?: string },
  token: string,
) {
  // 官方：POST /users/:login/repos（login 缺省时先 /user 解析）
  let login = options.login?.trim() || "";
  if (!login) {
    const me = await yuqueGetUser(token);
    login = me?.login || "";
  }
  if (!login) throw new Error("语雀 create_repo 需要用户 login（YUQUE_TOKEN 对应账号）");
  return yuqueOpenApi("POST", `/users/${encodeURIComponent(login)}/repos`, {
    token,
    body: {
      name,
      description: options.description || "",
      public: options.public ?? 0,
      ...(options.slug ? { slug: options.slug } : {}),
    },
  });
}

export async function yuqueUpdateRepo(
  namespace: string,
  options: { name?: string; description?: string; public?: number },
  token: string,
) {
  return yuqueOpenApi("PUT", `/repos/${namespace}`, { token, body: options });
}

export async function yuqueDeleteRepo(namespace: string, token: string) {
  return yuqueOpenApi("DELETE", `/repos/${namespace}`, { token });
}

export async function yuqueListDocs(namespace: string, token: string) {
  return yuqueOpenApi("GET", `/repos/${namespace}/docs`, { token });
}

export async function yuqueGetDocV2(namespace: string, slug: string, token: string) {
  if (!token) throw new Error("未配置语雀个人令牌（YUQUE_TOKEN）");
  return yuqueOpenApi("GET", `/repos/${namespace}/docs/${slug}`, { token });
}

export async function yuqueCreateDocV2(
  namespace: string,
  title: string,
  body: string,
  token: string,
) {
  return yuqueOpenApi("POST", `/repos/${namespace}/docs`, {
    token,
    body: { title, body, public: 0 },
  });
}

export async function yuqueUpdateDocV2(
  namespace: string,
  slug: string,
  title: string,
  body: string,
  token: string,
) {
  return yuqueOpenApi("PUT", `/repos/${namespace}/docs/${slug}`, {
    token,
    body: { title, body },
  });
}

export async function yuqueDeleteDocV2(namespace: string, slug: string, token: string) {
  return yuqueOpenApi("DELETE", `/repos/${namespace}/docs/${slug}`, { token });
}
