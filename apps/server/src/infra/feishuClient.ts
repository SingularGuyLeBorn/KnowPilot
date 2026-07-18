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
  // 优先从 Credential 表读取
  const status = await getUserAccessTokenStatus(prisma, config);
  const credToken = await getCredentialValue(prisma, "feishu", "feishu_user_access_token");
  if (credToken) {
    if (status.valid) return credToken;
    const refreshToken = await getCredentialValue(prisma, "feishu", "feishu_refresh_token");
    if (refreshToken) return refreshUserAccessToken(prisma, refreshToken);
    return credToken;
  }

  // fallback：.env FEISHU_USER_ACCESS_TOKEN（与 tenant 一样允许本地直配）
  const envUser = getFeishuCredentials(config).userAccessToken?.trim();
  if (envUser) return envUser;

  // fallback：MetaBlog 风格的文件缓存
  try {
    return await getFileCachedUserToken();
  } catch (e) {
    if (e instanceof RefreshTokenExpiredError) throw e;
    return undefined;
  }
}

export async function refreshUserAccessToken(
  prisma: PrismaClient,
  refreshToken: string,
): Promise<string> {
  const res = await fetch(`${FEISHU_BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });
  const data = (await res.json()) as {
    code?: number;
    msg?: string;
    data?: {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      refresh_token_expires_in?: number;
      scope?: string;
    };
  };
  if (!res.ok || data.code !== 0 || !data.data?.access_token) {
    throw new Error(`飞书 user token 刷新失败: ${data.msg || res.status}`);
  }

  const now = nowSec();
  const accessToken = data.data.access_token;
  const newRefreshToken = data.data.refresh_token || refreshToken;
  const expiresAt = now + (data.data.expires_in || 7200);
  const refreshExpiresAt = data.data.refresh_token_expires_in ? now + data.data.refresh_token_expires_in : undefined;

  await upsertCredential(prisma, {
    name: "feishu_user_access_token",
    type: "token",
    value: accessToken,
    scope: ["feishu"],
    expiresAt: new Date(expiresAt * 1000),
    metadata: {
      expiresAt,
      scope: data.data.scope,
      refreshExpiresAt,
    },
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
  const explicitToken = options.token;
  let token: string | undefined;

  if (explicitToken) {
    token = explicitToken;
  } else if (options.useUserToken || path.startsWith("/wiki/") || path.startsWith("/board/")) {
    if (!prisma || !config) throw new Error("调用 user_token 接口需要提供 prisma 与 config");
    token = await getUserAccessToken(prisma, config);
  }

  if (!token) {
    if (!config) throw new Error("调用 tenant_token 接口需要提供 config");
    token = await getTenantAccessToken(config);
  }

  if (!token) {
    throw new Error("未配置飞书凭证（需 FEISHU_APP_ID/FEISHU_APP_SECRET 或 FEISHU_TENANT_ACCESS_TOKEN）");
  }

  const url = new URL(`${FEISHU_BASE}${path.startsWith("/") ? path : `/${path}`}`);
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

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
  if (!res.ok || data.code !== 0) {
    throw new Error(`飞书 API 失败: ${data.msg || res.statusText} (${res.status})`);
  }
  return data.data as T;
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
    `/docx/v1/documents/${documentId}/blocks batchUpdate`,
    {
      method: "POST",
      body: { requests: blocks },
      useUserToken: true,
    },
    prisma,
    config,
  );
}

export async function feishuSearchDocs(query: string, prisma: PrismaClient, config: AppConfig) {
  return feishuApi(
    "/search/v1/docs",
    {
      method: "POST",
      body: { search_key: query },
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
