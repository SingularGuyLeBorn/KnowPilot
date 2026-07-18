/**
 * Feishu / Lark API Client — 对标 MetaBlog lark.ts + larkTokenManager
 *
 * 1. tenant_access_token：用 App ID + App Secret 自动换取/刷新。
 * 2. user_access_token：从 Credential 表读取，支持 refresh_token 自动刷新并持久化。
 * 3. 统一 feishuApi 自动根据 path 选择 tenant / user token。
 */

import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "./config.js";
import { getCredentialValue, upsertCredential } from "./credentialVault.js";
import {
  getUserAccessToken as getFileCachedUserToken,
  getTokenStatus as getFileTokenStatus,
  refreshTokenManually as refreshFileToken,
  RefreshTokenExpiredError,
} from "./external/larkTokenManager.js";

const FEISHU_BASE = "https://open.feishu.cn/open-apis";

interface TenantTokenCache {
  token: string;
  expireAt: number;
}

interface FeishuCredentials {
  appId: string;
  appSecret: string;
  userAccessToken: string;
  tenantAccessToken: string;
}

let tenantTokenCache: TenantTokenCache | null = null;

export function getFeishuCredentials(config: AppConfig): FeishuCredentials {
  return config.integrations.feishu;
}

function nowSec(): number {
  return Date.now() / 1000;
}

export async function getTenantAccessToken(config: AppConfig): Promise<string | undefined> {
  const { appId, appSecret, tenantAccessToken } = getFeishuCredentials(config);

  // 如果只有手动填写的 tenant token 且没配 app 凭证，直接复用
  if ((!appId || !appSecret) && tenantAccessToken) {
    return tenantAccessToken;
  }
  if (!appId || !appSecret) return undefined;

  if (tenantTokenCache && tenantTokenCache.expireAt > nowSec() + 300) {
    return tenantTokenCache.token;
  }

  const res = await fetch(`${FEISHU_BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const data = (await res.json()) as { code?: number; msg?: string; tenant_access_token?: string; expire?: number };
  if (!res.ok || data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`飞书 tenant token 获取失败: ${data.msg || res.status}`);
  }
  tenantTokenCache = {
    token: data.tenant_access_token,
    expireAt: nowSec() + (data.expire || 7200),
  };
  return tenantTokenCache.token;
}

export interface FeishuUserTokenPayload {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  refreshTokenExpiresIn?: number;
  scope?: string;
}

export async function getUserAccessTokenStatus(
  prisma: PrismaClient,
  config: AppConfig,
): Promise<{ exists: boolean; valid: boolean; expiresAt?: number; scope?: string; source?: "credential" | "file" }> {
  const credValue = await getCredentialValue(prisma, "feishu", "feishu_user_access_token");
  if (credValue) {
    const metadataRaw = await getCredentialValue(prisma, "feishu", "feishu_user_access_token_metadata").catch(() => undefined);
    const metadata = metadataRaw ? (JSON.parse(metadataRaw) as { expiresAt?: number; scope?: string }) : undefined;
    const expiresAt = metadata?.expiresAt;
    const valid = !expiresAt || expiresAt > nowSec() + 300;
    return { exists: true, valid, expiresAt, scope: metadata?.scope, source: "credential" };
  }

  const fileStatus = getFileTokenStatus();
  return {
    exists: fileStatus.exists,
    valid: fileStatus.access_token_valid,
    expiresAt: fileStatus.access_token_expire_in ? nowSec() + fileStatus.access_token_expire_in : undefined,
    source: "file",
  };
}

export async function getUserAccessToken(
  prisma: PrismaClient,
  config: AppConfig,
): Promise<string | undefined> {
  // 1) Credential 表（可 refresh）
  const status = await getUserAccessTokenStatus(prisma, config);
  const credToken = await getCredentialValue(prisma, "feishu", "feishu_user_access_token");
  if (credToken) {
    if (status.valid) return credToken;
    const refreshToken = await getCredentialValue(prisma, "feishu", "feishu_refresh_token");
    if (refreshToken) return refreshUserAccessToken(prisma, refreshToken, config);
    // 过期且无 refresh：不要死拿过期 token，继续尝试文件缓存 / env
  }

  // 2) OAuth 文件缓存（可自动 refresh，优先于可能过期的 .env）
  try {
    const fileTok = await getFileCachedUserToken();
    if (fileTok) return fileTok;
  } catch (e) {
    if (e instanceof RefreshTokenExpiredError) throw e;
  }

  // 3) .env 直配（无自动续期，可能已过期）
  const envUser = getFeishuCredentials(config).userAccessToken?.trim();
  if (envUser) return envUser;

  // 4) 过期 Credential 最后兜底（仅当没有别的来源）
  if (credToken) return credToken;
  return undefined;
}

export async function refreshUserAccessToken(
  prisma: PrismaClient,
  refreshToken: string,
  config?: AppConfig,
): Promise<string> {
  // 与 larkTokenManager 同源：/authen/v2/oauth/token（旧路径 tenant_access_token/internal 无效）
  const appId = config?.integrations.feishu.appId || readEnv("FEISHU_APP_ID", "LARK_APP_ID");
  const appSecret = config?.integrations.feishu.appSecret || readEnv("FEISHU_APP_SECRET", "LARK_APP_SECRET");
  const res = await fetch(`${FEISHU_BASE}/authen/v2/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: appId,
      client_secret: appSecret,
      refresh_token: refreshToken,
    }),
  });
  const data = (await res.json()) as {
    code?: number;
    msg?: string;
    error_description?: string;
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    refresh_token_expires_in?: number;
    scope?: string;
    data?: {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      refresh_token_expires_in?: number;
      scope?: string;
    };
  };
  // v2 响应字段可能在顶层或 data 内
  const accessToken = data.access_token || data.data?.access_token;
  const newRefreshToken = data.refresh_token || data.data?.refresh_token || refreshToken;
  const expiresIn = data.expires_in ?? data.data?.expires_in ?? 7200;
  const refreshExpiresIn = data.refresh_token_expires_in ?? data.data?.refresh_token_expires_in;
  const scope = data.scope || data.data?.scope;
  if (!res.ok || data.code !== 0 || !accessToken) {
    throw new Error(`飞书 user token 刷新失败: ${data.error_description || data.msg || res.status}`);
  }

  const now = nowSec();
  const expiresAt = now + expiresIn;
  const refreshExpiresAt = refreshExpiresIn ? now + refreshExpiresIn : undefined;

  await upsertCredential(prisma, {
    name: "feishu_user_access_token",
    type: "token",
    value: accessToken,
    scope: ["feishu"],
    expiresAt: new Date(expiresAt * 1000),
    metadata: { expiresAt, scope, refreshExpiresAt },
  });
  await upsertCredential(prisma, {
    name: "feishu_refresh_token",
    type: "token",
    value: newRefreshToken,
    scope: ["feishu"],
    expiresAt: refreshExpiresAt ? new Date(refreshExpiresAt * 1000) : undefined,
  });

  return accessToken;
}

function readEnv(...keys: string[]): string {
  for (const k of keys) {
    const v = process.env[k]?.trim();
    if (v) return v;
  }
  return "";
}

/** token 失效业务码：需 refresh 后重试 */
function isFeishuTokenExpiredCode(code: number | undefined): boolean {
  if (code == null) return false;
  return (
    code === 99991663 ||
    code === 99991661 ||
    code === 99991664 ||
    code === 99991668 ||
    code === 99991400 ||
    code === 99991677 // Authentication token expired
  );
}

export interface FeishuApiOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  useUserToken?: boolean;
  token?: string;
}

export async function feishuApi<T = unknown>(
  path: string,
  options: FeishuApiOptions = {},
  prisma?: PrismaClient,
  config?: AppConfig,
): Promise<T> {
  const wantsUser =
    Boolean(options.token) ||
    options.useUserToken === true ||
    path.startsWith("/wiki/") ||
    path.startsWith("/board/") ||
    path.startsWith("/docx/") ||
    path.startsWith("/suite/") ||
    path.startsWith("/drive/");

  const resolveToken = async (forceRefresh: boolean): Promise<string> => {
    if (options.token) return options.token;
    if (wantsUser) {
      if (!prisma || !config) throw new Error("调用 user_token 接口需要提供 prisma 与 config");
      if (forceRefresh) {
        const refreshToken = await getCredentialValue(prisma, "feishu", "feishu_refresh_token");
        if (refreshToken) return refreshUserAccessToken(prisma, refreshToken, config);
        // Credential 无 refresh → 试 OAuth 文件缓存刷新
        const fileRefresh = await refreshFileToken();
        if (fileRefresh.success && fileRefresh.access_token) return fileRefresh.access_token;
        throw new Error(
          "飞书 user_access_token 已过期且无法自动刷新。请调用 native 工具 feishu_authorize（会打开浏览器，用户点一次同意），" +
            "或手动跑：pnpm --filter @knowpilot/server exec tsx src/scripts/feishu-authorize.ts",
        );
      }
      const t = await getUserAccessToken(prisma, config);
      if (!t) throw new Error("未配置飞书 user_access_token（FEISHU_USER_ACCESS_TOKEN / Credential / OAuth 文件）");
      return t;
    }
    if (!config) throw new Error("调用 tenant_token 接口需要提供 config");
    const t = await getTenantAccessToken(config);
    if (!t) throw new Error("未配置飞书凭证（需 FEISHU_APP_ID/FEISHU_APP_SECRET 或 FEISHU_TENANT_ACCESS_TOKEN）");
    return t;
  };

  const url = new URL(`${FEISHU_BASE}${path.startsWith("/") ? path : `/${path}`}`);
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await resolveToken(attempt > 0);
    const init: RequestInit = {
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    };
    if (options.body !== undefined && options.method !== "GET") {
      init.body = JSON.stringify(options.body);
    }

    const res = await fetch(url.toString(), init);
    const raw = await res.text();
    let data: { code?: number; msg?: string; data?: T };
    try {
      data = JSON.parse(raw) as { code?: number; msg?: string; data?: T };
    } catch {
      throw new Error(
        `飞书 API 返回非 JSON（HTTP ${res.status} ${res.statusText}）：${raw.slice(0, 120).replace(/\s+/g, " ")}`,
      );
    }

    if (res.ok && data.code === 0) return data.data as T;

    lastError = new Error(`飞书 API 失败: ${data.msg || res.statusText} (code=${data.code ?? res.status})`);
    const canRetry =
      attempt === 0 &&
      wantsUser &&
      !options.token &&
      prisma &&
      config &&
      (res.status === 401 || isFeishuTokenExpiredCode(data.code));
    if (!canRetry) break;
  }
  throw lastError ?? new Error("飞书 API 失败");
}

/* ─── 快捷封装 ─── */

export async function feishuSendMessage(
  receiveId: string,
  receiveIdType: string,
  msgType: string,
  content: Record<string, unknown>,
  config: AppConfig,
): Promise<unknown> {
  return feishuApi(
    `/im/v1/messages?receive_id_type=${receiveIdType}`,
    {
      method: "POST",
      body: {
        receive_id: receiveId,
        msg_type: msgType,
        content: JSON.stringify(content),
      },
    },
    undefined,
    config,
  );
}

export async function feishuSendText(receiveId: string, receiveIdType: string, text: string, config: AppConfig) {
  return feishuSendMessage(receiveId, receiveIdType, "text", { text }, config);
}

export async function feishuGetDoc(documentId: string, prisma: PrismaClient, config: AppConfig) {
  return feishuApi(`/docx/v1/documents/${documentId}`, { useUserToken: true }, prisma, config);
}

export async function feishuCreateDoc(title: string, folderToken?: string, prisma?: PrismaClient, config?: AppConfig) {
  return feishuApi(
    "/docx/v1/documents",
    {
      method: "POST",
      body: { title, folder_token: folderToken },
      useUserToken: true,
    },
    prisma,
    config,
  );
}

export async function feishuUpdateDocBlocks(
  documentId: string,
  blocks: unknown[],
  prisma: PrismaClient,
  config: AppConfig,
) {
  return feishuApi(
    `/docx/v1/documents/${documentId}/blocks/batch_update`,
    {
      method: "PATCH",
      body: { requests: blocks },
      useUserToken: true,
    },
    prisma,
    config,
  );
}

export async function feishuDeleteDoc(documentId: string, prisma: PrismaClient, config: AppConfig) {
  // 云文档删除走 drive 文件 API
  return feishuApi(
    `/drive/v1/files/${encodeURIComponent(documentId)}`,
    {
      method: "DELETE",
      query: { type: "docx" },
      useUserToken: true,
    },
    prisma,
    config,
  );
}

export async function feishuUpdateDocTitle(
  documentId: string,
  title: string,
  prisma: PrismaClient,
  config: AppConfig,
) {
  // 文档标题 = 根 Page Block 的文本；官方不支持 PATCH /documents/:id {title}
  // 见：更新块 PATCH /documents/:document_id/blocks/:block_id（根块 id = document_id）
  return feishuApi(
    `/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(documentId)}`,
    {
      method: "PATCH",
      body: {
        update_text_elements: {
          elements: [{ text_run: { content: title } }],
        },
      },
      useUserToken: true,
    },
    prisma,
    config,
  );
}

export async function feishuSearchDocs(query: string, prisma: PrismaClient, config: AppConfig) {
  // 对齐 MetaBlog/实验客户端：/suite/docs-api/search/object（旧 /search/v1/docs 已 404）
  return feishuApi(
    "/suite/docs-api/search/object",
    {
      method: "POST",
      body: { search_key: query, count: 20 },
      useUserToken: true,
    },
    prisma,
    config,
  );
}

export async function feishuCreateWikiNode(
  spaceId: string,
  title: string,
  options: { parentNodeToken?: string; objType?: string },
  prisma: PrismaClient,
  config: AppConfig,
) {
  return feishuApi(
    `/wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes`,
    {
      method: "POST",
      body: {
        obj_type: options.objType || "docx",
        node_type: "origin",
        title,
        ...(options.parentNodeToken ? { parent_node_token: options.parentNodeToken } : {}),
      },
      useUserToken: true,
    },
    prisma,
    config,
  );
}

export async function feishuGetWikiSpace(spaceId: string, prisma: PrismaClient, config: AppConfig) {
  return feishuApi(`/wiki/v2/spaces/${spaceId}`, { useUserToken: true }, prisma, config);
}

export async function feishuGetWikiNodes(
  spaceId: string,
  parentNodeToken: string | undefined,
  prisma: PrismaClient,
  config: AppConfig,
) {
  return feishuApi(
    `/wiki/v2/spaces/${spaceId}/nodes`,
    {
      query: { parent_node_token: parentNodeToken || "" },
      useUserToken: true,
    },
    prisma,
    config,
  );
}

export async function feishuCreateSpreadsheet(
  title: string,
  folderToken?: string,
  prisma?: PrismaClient,
  config?: AppConfig,
) {
  return feishuApi(
    "/sheets/v3/spreadsheets",
    {
      method: "POST",
      body: { title, folder_token: folderToken },
      useUserToken: true,
    },
    prisma,
    config,
  );
}

export async function feishuAppendSpreadsheetValues(
  spreadsheetToken: string,
  range: string,
  values: unknown[],
  prisma: PrismaClient,
  config: AppConfig,
) {
  return feishuApi(
    `/sheets/v2/spreadsheets/${spreadsheetToken}/values_append`,
    {
      method: "POST",
      body: {
        valueRange: { range, values },
      },
      useUserToken: true,
    },
    prisma,
    config,
  );
}

/* ─── 画板 board-v1（文档内 block_type=43，token = whiteboard_id）─── */

/** 文档块类型：画板 */
export const FEISHU_BLOCK_TYPE_BOARD = 43;

export type FeishuWhiteboardRef = {
  whiteboardId: string;
  blockId: string;
  parentId?: string;
};

/**
 * 列出文档内所有画板（分页拉齐 blocks，筛 block_type=43）。
 * whiteboard_id = block.board.token（或兼容 block.token）。
 */
export async function feishuListDocWhiteboards(
  documentId: string,
  prisma: PrismaClient,
  config: AppConfig,
): Promise<FeishuWhiteboardRef[]> {
  type BlockRow = {
    block_id?: string;
    parent_id?: string;
    block_type?: number;
    token?: string;
    board?: { token?: string };
  };
  type BlocksPage = { items?: BlockRow[]; page_token?: string; has_more?: boolean };

  const out: FeishuWhiteboardRef[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < 50; i++) {
    const page = await feishuApi<BlocksPage>(
      `/docx/v1/documents/${encodeURIComponent(documentId)}/blocks`,
      {
        method: "GET",
        query: { page_size: 500, page_token: pageToken },
        useUserToken: true,
      },
      prisma,
      config,
    );
    for (const b of page?.items ?? []) {
      if (b.block_type !== FEISHU_BLOCK_TYPE_BOARD) continue;
      const whiteboardId = b.board?.token || b.token;
      if (!whiteboardId || !b.block_id) continue;
      out.push({ whiteboardId, blockId: b.block_id, parentId: b.parent_id });
    }
    if (!page?.has_more || !page.page_token) break;
    pageToken = page.page_token;
  }
  return out;
}

export async function feishuListWhiteboardNodes(
  whiteboardId: string,
  prisma: PrismaClient,
  config: AppConfig,
) {
  return feishuApi(
    `/board/v1/whiteboards/${encodeURIComponent(whiteboardId)}/nodes`,
    { method: "GET", useUserToken: true },
    prisma,
    config,
  );
}

export async function feishuCreateWhiteboardNodes(
  whiteboardId: string,
  nodes: unknown[],
  options: { overwrite?: boolean; clientToken?: string },
  prisma: PrismaClient,
  config: AppConfig,
) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    throw new Error("nodes 不能为空数组");
  }
  return feishuApi(
    `/board/v1/whiteboards/${encodeURIComponent(whiteboardId)}/nodes`,
    {
      method: "POST",
      query: options.clientToken ? { client_token: options.clientToken } : undefined,
      body: {
        nodes,
        ...(options.overwrite ? { overwrite: true } : {}),
      },
      useUserToken: true,
    },
    prisma,
    config,
  );
}

/**
 * 用 PlantUML / Mermaid / SVG 源码写入画板（官方 plantuml 导入接口，syntax_type: 1/2/3）。
 * 对 Agent 最友好的「画流程图」路径；overwrite=true 时整板覆盖。
 */
export async function feishuWhiteboardFromDiagram(
  whiteboardId: string,
  code: string,
  format: "plantuml" | "mermaid" | "svg",
  options: { overwrite?: boolean; clientToken?: string },
  prisma: PrismaClient,
  config: AppConfig,
) {
  const syntaxType = format === "plantuml" ? 1 : format === "mermaid" ? 2 : 3;
  return feishuApi(
    `/board/v1/whiteboards/${encodeURIComponent(whiteboardId)}/nodes/plantuml`,
    {
      method: "POST",
      query: options.clientToken ? { client_token: options.clientToken } : undefined,
      body: {
        plant_uml_code: code,
        syntax_type: syntaxType,
        parse_mode: 1,
        diagram_type: 0,
        ...(options.overwrite ? { overwrite: true } : {}),
      },
      useUserToken: true,
    },
    prisma,
    config,
  );
}

export async function feishuDeleteWhiteboardNodes(
  whiteboardId: string,
  ids: string[],
  options: { clientToken?: string },
  prisma: PrismaClient,
  config: AppConfig,
) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error("ids 不能为空");
  }
  if (ids.length > 100) {
    throw new Error("单次最多删除 100 个节点，请分批调用");
  }
  return feishuApi(
    `/board/v1/whiteboards/${encodeURIComponent(whiteboardId)}/nodes/batch_delete`,
    {
      method: "DELETE",
      query: options.clientToken ? { client_token: options.clientToken } : undefined,
      body: { ids },
      useUserToken: true,
    },
    prisma,
    config,
  );
}

export async function feishuGetWhiteboardTheme(
  whiteboardId: string,
  prisma: PrismaClient,
  config: AppConfig,
) {
  return feishuApi(
    `/board/v1/whiteboards/${encodeURIComponent(whiteboardId)}/theme`,
    { method: "GET", useUserToken: true },
    prisma,
    config,
  );
}

export async function feishuUpdateWhiteboardTheme(
  whiteboardId: string,
  theme: string,
  prisma: PrismaClient,
  config: AppConfig,
) {
  return feishuApi(
    `/board/v1/whiteboards/${encodeURIComponent(whiteboardId)}/update_theme`,
    {
      method: "POST",
      body: { theme },
      useUserToken: true,
    },
    prisma,
    config,
  );
}

/* ─── 云文档协作者（drive permission member） ─── */

let cachedAppOpenId: string | null = null;

/**
 * 解析本应用 open_id（无需开通机器人）。
 * 官方推荐：tenant 身份建临时文档 → metas.owner_id = 应用 open_id，再删临时文档。
 */
export async function resolveFeishuAppOpenId(
  config: AppConfig,
  prisma?: PrismaClient,
): Promise<string> {
  if (cachedAppOpenId) return cachedAppOpenId;
  const tenant = await getTenantAccessToken(config);
  if (!tenant) throw new Error("未配置飞书 App ID/Secret，无法解析应用 open_id");

  const created = (await feishuApi(
    "/docx/v1/documents",
    {
      method: "POST",
      token: tenant,
      body: { title: `kp-app-openid-${Date.now().toString(36)}` },
    },
    prisma,
    config,
  )) as { document?: { document_id?: string }; document_id?: string };
  const docId = created?.document?.document_id || created?.document_id;
  if (!docId) throw new Error("tenant 建临时文档失败，无法解析应用 open_id");

  try {
    const meta = (await feishuApi(
      "/drive/v1/metas/batch_query",
      {
        method: "POST",
        token: tenant,
        body: { request_docs: [{ doc_token: docId, doc_type: "docx" }] },
      },
      prisma,
      config,
    )) as { metas?: Array<{ owner_id?: string }> };
    const ownerId = meta?.metas?.[0]?.owner_id;
    if (!ownerId) throw new Error("metas 未返回 owner_id");
    cachedAppOpenId = ownerId;
    return ownerId;
  } finally {
    try {
      await feishuApi(
        `/drive/v1/files/${encodeURIComponent(docId)}`,
        { method: "DELETE", token: tenant, query: { type: "docx" } },
        prisma,
        config,
      );
    } catch {
      /* 临时文档清理失败不阻断 */
    }
  }
}

/** 测试用：清空应用 open_id 缓存 */
export function __resetFeishuAppOpenIdCacheForTests() {
  cachedAppOpenId = null;
}

export async function feishuListPermissionMembers(
  token: string,
  type: string,
  prisma: PrismaClient,
  config: AppConfig,
) {
  return feishuApi(
    `/drive/v1/permissions/${encodeURIComponent(token)}/members`,
    { useUserToken: true, query: { type, page_size: 50 } },
    prisma,
    config,
  );
}

export async function feishuAddPermissionMember(
  token: string,
  type: string,
  member: { memberType: string; memberId: string; perm: string },
  prisma: PrismaClient,
  config: AppConfig,
) {
  return feishuApi(
    `/drive/v1/permissions/${encodeURIComponent(token)}/members`,
    {
      method: "POST",
      useUserToken: true,
      query: { type, need_notification: "false" },
      body: {
        member_type: member.memberType,
        member_id: member.memberId,
        perm: member.perm,
      },
    },
    prisma,
    config,
  );
}

export async function feishuUpdatePermissionMember(
  token: string,
  type: string,
  member: { memberType: string; memberId: string; perm: string },
  prisma: PrismaClient,
  config: AppConfig,
) {
  // PUT body 必须带 member_type + member_id，否则飞书返回 1063001 Invalid parameter
  return feishuApi(
    `/drive/v1/permissions/${encodeURIComponent(token)}/members/${encodeURIComponent(member.memberId)}`,
    {
      method: "PUT",
      useUserToken: true,
      query: { type, member_type: member.memberType },
      body: {
        member_type: member.memberType,
        member_id: member.memberId,
        perm: member.perm,
      },
    },
    prisma,
    config,
  );
}

export async function feishuRemovePermissionMember(
  token: string,
  type: string,
  member: { memberType: string; memberId: string },
  prisma: PrismaClient,
  config: AppConfig,
) {
  return feishuApi(
    `/drive/v1/permissions/${encodeURIComponent(token)}/members/${encodeURIComponent(member.memberId)}`,
    {
      method: "DELETE",
      useUserToken: true,
      query: { type, member_type: member.memberType },
    },
    prisma,
    config,
  );
}

/* ─── 云文档权限设置（可见性 / 分享策略，对应 UI「权限设置」） ─── */

export type FeishuPermissionPublicPatch = {
  external_access_entity?: "open" | "closed" | "allow_share_partner_tenant";
  security_entity?: "anyone_can_view" | "anyone_can_edit" | "only_full_access";
  comment_entity?: "anyone_can_view" | "anyone_can_edit";
  share_entity?: "anyone" | "same_tenant";
  manage_collaborator_entity?: "collaborator_can_view" | "collaborator_can_edit" | "collaborator_full_access";
  link_share_entity?:
    | "tenant_readable"
    | "tenant_editable"
    | "partner_tenant_readable"
    | "partner_tenant_editable"
    | "anyone_readable"
    | "anyone_editable"
    | "closed";
  copy_entity?: "anyone_can_view" | "anyone_can_edit" | "only_full_access";
};

export async function feishuGetPermissionPublic(
  token: string,
  type: string,
  prisma: PrismaClient,
  config: AppConfig,
) {
  return feishuApi(
    `/drive/v2/permissions/${encodeURIComponent(token)}/public`,
    { useUserToken: true, query: { type } },
    prisma,
    config,
  );
}

export async function feishuUpdatePermissionPublic(
  token: string,
  type: string,
  patch: FeishuPermissionPublicPatch,
  prisma: PrismaClient,
  config: AppConfig,
) {
  return feishuApi(
    `/drive/v2/permissions/${encodeURIComponent(token)}/public`,
    {
      method: "PATCH",
      useUserToken: true,
      query: { type },
      body: patch,
    },
    prisma,
    config,
  );
}

/**
 * 手机号 / 邮箱 → open_id（通讯录 batch_get_id，需应用开通 contact 相关权限，用 tenant token）。
 * 注意：加协作者时邮箱也可直接用 member_type=email，不必先解析。
 */
export async function feishuBatchGetUserIds(
  options: { mobiles?: string[]; emails?: string[]; includeResigned?: boolean },
  config: AppConfig,
  prisma?: PrismaClient,
): Promise<{
  user_list: Array<{
    user_id?: string;
    mobile?: string;
    email?: string;
    status?: unknown;
  }>;
}> {
  const tenant = await getTenantAccessToken(config);
  if (!tenant) throw new Error("未配置飞书 App ID/Secret，无法解析手机号/邮箱");
  const emails = (options.emails || []).map((e) => e.trim()).filter(Boolean);
  const rawMobiles = (options.mobiles || []).map((m) => m.trim()).filter(Boolean);
  // 中国手机号自动补 +86 变体（官方示例常用 +86xxxxxxxxxxx）
  const mobileSet = new Set<string>();
  for (const m of rawMobiles) {
    mobileSet.add(m);
    if (/^1\d{10}$/.test(m)) mobileSet.add(`+86${m}`);
    if (/^\+86\d{11}$/.test(m)) mobileSet.add(m.slice(3));
  }
  const mobiles = [...mobileSet];
  if (!mobiles.length && !emails.length) throw new Error("请提供 mobiles 和/或 emails");

  const call = async (includeResigned: boolean) =>
    (await feishuApi(
      "/contact/v3/users/batch_get_id",
      {
        method: "POST",
        token: tenant,
        query: { user_id_type: "open_id" },
        body: {
          mobiles: mobiles.length ? mobiles : undefined,
          emails: emails.length ? emails : undefined,
          include_resigned: includeResigned,
        },
      },
      prisma,
      config,
    )) as { user_list: Array<{ user_id?: string; mobile?: string; email?: string; status?: unknown }> };

  try {
    let data = await call(options.includeResigned === true);
    const hasId = data.user_list?.some((u) => u.user_id);
    if (!hasId && options.includeResigned !== true) {
      data = await call(true);
    }
    return data;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `${msg}\n提示：手机号转 open_id 需开通 contact:user.id:readonly（或 contact:contact:readonly_as_app）并发布；` +
        `且该用户须在本企业通讯录、且在应用可用范围内。邮箱可直接 feishu_add_permission_member(memberType=email)。`,
    );
  }
}

/** 用手机号或邮箱加协作者：邮箱直加；手机号先 batch_get_id 再按 openid 加 */
export async function feishuAddCollaboratorByContact(
  token: string,
  type: string,
  contact: { mobile?: string; email?: string; perm: string },
  prisma: PrismaClient,
  config: AppConfig,
) {
  const mobile = contact.mobile?.trim();
  const email = contact.email?.trim();
  if (!mobile && !email) throw new Error("请提供 mobile 或 email");

  if (email && !mobile) {
    return {
      resolved: { memberType: "email" as const, memberId: email },
      result: await feishuAddPermissionMember(
        token,
        type,
        { memberType: "email", memberId: email, perm: contact.perm },
        prisma,
        config,
      ),
    };
  }

  const looked = await feishuBatchGetUserIds(
    { mobiles: mobile ? [mobile] : undefined, emails: email && mobile ? [email] : undefined },
    config,
    prisma,
  );
  const mobileTail = mobile?.replace(/^\+?86/, "") || "";
  const hit =
    looked.user_list?.find(
      (u) =>
        Boolean(u.user_id) &&
        mobile &&
        (u.mobile === mobile ||
          u.mobile === `+86${mobileTail}` ||
          u.mobile?.replace(/^\+?86/, "") === mobileTail),
    ) || looked.user_list?.find((u) => u.user_id);
  if (!hit?.user_id) {
    throw new Error(
      `未找到对应用户 open_id（mobile=${mobile || "-"} email=${email || "-"}）。` +
        `请确认该手机号已绑定本企业飞书账号，且应用已开通通讯录查 ID 权限。原始返回=${JSON.stringify(looked).slice(0, 200)}`,
    );
  }
  return {
    resolved: { memberType: "openid" as const, memberId: hit.user_id, mobile: hit.mobile, email: hit.email },
    result: await feishuAddPermissionMember(
      token,
      type,
      { memberType: "openid", memberId: hit.user_id, perm: contact.perm },
      prisma,
      config,
    ),
  };
}
