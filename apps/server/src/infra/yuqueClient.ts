/**
 * Yuque API Client — 对标 MetaBlog yuque.ts
 *
 * 同时支持语雀官方 Open API v2 和内部 Web API（Cookie 认证）。
 */

import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "./config.js";
import { getCredentialValue } from "./credentialVault.js";

const YUQUE_BASE = "https://www.yuque.com";

interface YuqueCredentials {
  session: string;
  ctoken: string;
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
        "3. 复制 _yuque_session 和 _ctoken 到 .env 或 Credentials 表（scope=yuque）",
    );
  }
  return { session, ctoken };
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
    });
    return await res.json();
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
  const res = await fetch(url.toString(), {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = (await res.json()) as any;
  if (!res.ok || data.status !== undefined) {
    throw new Error(`语雀 API 失败: ${data.message || res.statusText} (${res.status})`);
  }
  return data.data as T;
}

/* ─── 内部 Web API 快捷 ─── */

export async function yuqueListBooks(credentials: YuqueCredentials) {
  return yuqueApi("GET", "/api/books", { credentials });
}

export async function yuqueGetBookToc(bookId: string, credentials: YuqueCredentials) {
  return yuqueApi("GET", `/api/books/${bookId}/toc`, { credentials });
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
  return yuqueApi(
    "POST",
    "/api/docs",
    {
      body: { book_id: bookId, title, body, format: "markdown" },
      referer: `${YUQUE_BASE}/api/docs`,
      credentials,
    },
  );
}

export async function yuqueUpdateDoc(
  docId: string,
  bookId: string,
  title: string,
  body: string,
  credentials: YuqueCredentials,
) {
  return yuqueApi(
    "PUT",
    `/api/docs/${docId}`,
    {
      body: { title, body, format: "markdown" },
      referer: `${YUQUE_BASE}/api/docs`,
      credentials,
    },
  );
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

export async function yuqueListDocs(namespace: string, token: string) {
  return yuqueOpenApi("GET", `/repos/${namespace}/docs`, { token });
}

export async function yuqueGetDocV2(namespace: string, slug: string, token: string) {
  if (!token) throw new Error("未配置语雀凭证（YUQUE_CTOKEN 或 Credential scope=yuque yuque_ctoken）");
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
