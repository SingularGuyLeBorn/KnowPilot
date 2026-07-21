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
import { markdownToBlocks } from "./feishuMarkdownToBlocks.js";

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

/** 新建内容请走 children API；batch_update 仅改已有 block_id */
const FEISHU_APPEND_HINT =
  "新建内容请用 feishu_append_doc_text / feishu_append_doc_blocks（docx children），不要猜 batch_update。";

/** 单条 text_run 保守上限（过长易 1770001） */
export const FEISHU_TEXT_RUN_MAX_CHARS = 2000;
/** 单次 children 创建上限（飞书文档约定） */
export const FEISHU_CHILDREN_BATCH_MAX = 50;

/** 飞书 docx 子块最小形态（Agent / Markdown 转换用） */
export type FeishuDocxBlock = {
  block_type: number;
  text?: { elements: Array<Record<string, unknown>> };
  board?: Record<string, unknown>;
  [key: string]: unknown;
};

type TextRunEl = {
  text_run?: { content?: string; text_element_style?: Record<string, unknown> };
  equation?: { content?: string };
};

function chunkString(str: string, maxLen: number): string[] {
  if (str.length <= maxLen) return [str];
  const chunks: string[] = [];
  let remaining = str;
  while (remaining.length > maxLen) {
    let breakAt = remaining.lastIndexOf("\n", maxLen);
    if (breakAt <= 0) breakAt = maxLen;
    chunks.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt);
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

/** 超长 text_run 切片，避免 1770001 / 1770033 */
function splitLongTextRuns(blocks: FeishuDocxBlock[], maxChars: number): FeishuDocxBlock[] {
  return blocks.map((block) => {
    const blockType = Object.keys(block).find((k) => k !== "block_type");
    if (!blockType) return block;
    const data = block[blockType] as { elements?: TextRunEl[] } | undefined;
    if (!data || !Array.isArray(data.elements)) return block;
    const newElements: TextRunEl[] = [];
    for (const el of data.elements) {
      const content = el.text_run?.content;
      if (typeof content === "string" && content.length > maxChars) {
        for (const chunk of chunkString(content, maxChars)) {
          newElements.push({
            text_run: {
              content: chunk,
              text_element_style: el.text_run?.text_element_style,
            },
          });
        }
      } else {
        newElements.push(el);
      }
    }
    return { ...block, [blockType]: { ...data, elements: newElements } };
  });
}

function elementsToPlain(els: TextRunEl[]): string {
  return els
    .map((el) => el.text_run?.content || (el.equation?.content ? `$${el.equation.content}$` : ""))
    .join("");
}

/**
 * 表格兜底：多步创建失败时再压成「| 单元格 |」文本行（勿作主路径）。
 */
function flattenTableBlock(block: FeishuDocxBlock): FeishuDocxBlock[] {
  const cells = block._cell_contents as TextRunEl[][] | undefined;
  const cols = Number((block.table as { property?: { column_size?: number } } | undefined)?.property?.column_size) || 0;
  if (!Array.isArray(cells) || cells.length === 0 || cols <= 0) {
    return [
      {
        block_type: 2,
        text: { elements: [{ text_run: { content: "[表格]" } }] },
      },
    ];
  }
  const rows: FeishuDocxBlock[] = [];
  for (let r = 0; r < cells.length; r += cols) {
    const parts = cells.slice(r, r + cols).map((els) => elementsToPlain(els || []));
    rows.push({
      block_type: 2,
      text: { elements: [{ text_run: { content: `| ${parts.join(" | ")} |` } }] },
    });
  }
  return rows;
}

function isNativeTableBlock(block: FeishuDocxBlock): boolean {
  return block.block_type === 31 && Array.isArray(block._cell_contents);
}

/** 非表格块：去掉内部字段并切片；误入的表格压扁（children 直写拒 _cell_contents） */
function prepareBlocksForChildren(blocks: FeishuDocxBlock[]): FeishuDocxBlock[] {
  const out: FeishuDocxBlock[] = [];
  for (const block of blocks) {
    if (isNativeTableBlock(block)) {
      out.push(...flattenTableBlock(block));
      continue;
    }
    const { _cell_contents: _, ...rest } = block;
    out.push(rest as FeishuDocxBlock);
  }
  return splitLongTextRuns(out, FEISHU_TEXT_RUN_MAX_CHARS);
}

/**
 * 剥掉 `_cell_contents`，得到可直写 children 的空表壳（对标 MetaBlog createTableBlock 第 1 步）。
 */
export function stripTableCellContents(block: FeishuDocxBlock): FeishuDocxBlock {
  const { _cell_contents: _, ...rest } = block;
  return rest as FeishuDocxBlock;
}

/**
 * Markdown → 飞书 docx 块（标题/列表/加粗/分割线/公式/原生表格）。
 * 表格保留 block_type=31 + `_cell_contents`；写入走 MetaBlog 同款多步：
 * 建空表 → GET cell 自带 text child → PATCH update_text_elements。
 * 勿把带 `_cell_contents` 的块直接丢给 children API。
 */
export function markdownToDocxBlocks(markdown: string): FeishuDocxBlock[] {
  if (markdown == null || String(markdown).trim().length === 0) return [];
  const blocks = markdownToBlocks(String(markdown)) as FeishuDocxBlock[];
  return blocks.map((block) => {
    if (isNativeTableBlock(block)) return block;
    return prepareBlocksForChildren([block])[0] ?? block;
  });
}

/**
 * 在父块下创建子块（POST .../blocks/:block_id/children）。
 * 根文档追加时 parentBlockId 默认 = documentId。
 */
export async function feishuCreateDocChildren(
  documentId: string,
  children: unknown[],
  opts: { parentBlockId?: string; index?: number } | undefined,
  prisma: PrismaClient,
  config: AppConfig,
) {
  if (!Array.isArray(children) || children.length === 0) {
    throw new Error("children 不能为空");
  }
  if (children.length > FEISHU_CHILDREN_BATCH_MAX) {
    throw new Error(
      `单次 children 最多 ${FEISHU_CHILDREN_BATCH_MAX} 个，当前 ${children.length}；请分批或用 feishu_append_doc_text 自动切片。`,
    );
  }
  const parentBlockId = opts?.parentBlockId?.trim() || documentId;
  const body: Record<string, unknown> = { children };
  if (typeof opts?.index === "number" && Number.isFinite(opts.index)) {
    body.index = opts.index;
  }
  return feishuApi(
    `/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(parentBlockId)}/children`,
    {
      method: "POST",
      body,
      useUserToken: true,
    },
    prisma,
    config,
  );
}

async function feishuGetDocBlock(
  documentId: string,
  blockId: string,
  prisma: PrismaClient,
  config: AppConfig,
): Promise<{ block?: { children?: string[] } }> {
  return feishuApi(
    `/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(blockId)}`,
    { useUserToken: true },
    prisma,
    config,
  );
}

async function feishuPatchTextElements(
  documentId: string,
  blockId: string,
  elements: TextRunEl[],
  prisma: PrismaClient,
  config: AppConfig,
): Promise<unknown> {
  return feishuApi(
    `/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(blockId)}`,
    {
      method: "PATCH",
      body: { update_text_elements: { elements } },
      useUserToken: true,
    },
    prisma,
    config,
  );
}

/**
 * MetaBlog `createTableBlock` 同款：
 * 1) children 创建空 table（无 _cell_contents）
 * 2) 从返回的 table.cells 取 cell id（行优先）
 * 3) GET cell → PATCH 其 auto-generated text child（消空 child 副作用）
 */
async function feishuCreateTableBlock(
  documentId: string,
  tableBlock: FeishuDocxBlock,
  prisma: PrismaClient,
  config: AppConfig,
): Promise<{ tableId: string; cellIds: string[]; cellResults: unknown[] }> {
  const cellContents = (tableBlock._cell_contents as TextRunEl[][]) || [];
  const tableShell = stripTableCellContents(tableBlock);
  const prop = (tableShell.table as { property?: { row_size?: number; column_size?: number } } | undefined)
    ?.property;
  const rowCount = Number(prop?.row_size) || 0;
  const colCount = Number(prop?.column_size) || 0;
  if (rowCount > 9 || colCount > 9) {
    throw new Error(
      `表格尺寸超限：${rowCount}×${colCount}（飞书硬限各 ≤9）。请拆成多个 ≤9×9 的小表。`,
    );
  }

  type CreateChildrenRes = {
    children?: Array<{
      block_id?: string;
      table?: { cells?: string[] };
    }>;
  };
  const created = (await feishuCreateDocChildren(
    documentId,
    [tableShell],
    undefined,
    prisma,
    config,
  )) as CreateChildrenRes;

  const tableNode = created.children?.[0];
  const tableId = tableNode?.block_id;
  const cellIds = tableNode?.table?.cells ?? [];
  if (!tableId || cellIds.length === 0) {
    throw new Error("创建 table block 后未返回 block_id 或 cell_ids");
  }
  if (cellContents.length !== cellIds.length) {
    throw new Error(
      `cell 内容数量不匹配: _cell_contents=${cellContents.length}, cell_ids=${cellIds.length}`,
    );
  }

  const cellResults: unknown[] = [];
  for (let i = 0; i < cellIds.length; i++) {
    const elements = cellContents[i] || [];
    const hasContent = elements.some((el) => el.text_run?.content || el.equation?.content);
    if (!hasContent) continue;

    // QPS：每 3 个 cell 延时（每个 cell 2 请求），对标 MetaBlog
    if (i > 0 && i % 3 === 0) {
      await new Promise((r) => setTimeout(r, 400));
    }

    const cellRes = await feishuGetDocBlock(documentId, cellIds[i]!, prisma, config);
    const textChildId = cellRes.block?.children?.[0];
    if (!textChildId) {
      throw new Error(`Cell ${i} 未找到 auto-generated text child`);
    }
    cellResults.push(
      await feishuPatchTextElements(documentId, textChildId, elements, prisma, config),
    );
  }

  return { tableId, cellIds, cellResults };
}

async function feishuAppendNativeTable(
  documentId: string,
  tableBlock: FeishuDocxBlock,
  prisma: PrismaClient,
  config: AppConfig,
): Promise<unknown> {
  try {
    return await feishuCreateTableBlock(documentId, tableBlock, prisma, config);
  } catch (err) {
    // 多步创建失败时降级为管道文本，保证长文主路径不炸
    const flat = prepareBlocksForChildren([tableBlock]);
    if (flat.length === 0) throw err;
    console.warn(
      `[feishu] 原生表格写入失败，降级为管道文本: ${err instanceof Error ? err.message : String(err)}`,
    );
    return feishuCreateDocChildren(documentId, flat, undefined, prisma, config);
  }
}

/** 追加 Markdown/文本到文档末尾（对标 MetaBlog /doc/append：普通块 children，表格多步填格） */
export async function feishuAppendDocText(
  documentId: string,
  text: string,
  prisma: PrismaClient,
  config: AppConfig,
) {
  const blocks = markdownToDocxBlocks(text);
  if (blocks.length === 0) {
    throw new Error("text 为空或无法解析为可写入块，无法追加文档内容");
  }
  const results: unknown[] = [];
  const QPS_DELAY_MS = 400;
  let wroteBatch = false;
  let tableCount = 0;
  let i = 0;
  while (i < blocks.length) {
    if (isNativeTableBlock(blocks[i]!)) {
      if (wroteBatch) await new Promise((r) => setTimeout(r, QPS_DELAY_MS));
      results.push(await feishuAppendNativeTable(documentId, blocks[i]!, prisma, config));
      tableCount += 1;
      wroteBatch = true;
      i += 1;
      continue;
    }
    const segment: FeishuDocxBlock[] = [];
    while (i < blocks.length && !isNativeTableBlock(blocks[i]!)) {
      segment.push(blocks[i]!);
      i += 1;
    }
    const prepared = prepareBlocksForChildren(segment);
    for (let b = 0; b < prepared.length; b += FEISHU_CHILDREN_BATCH_MAX) {
      if (wroteBatch) await new Promise((r) => setTimeout(r, QPS_DELAY_MS));
      const batch = prepared.slice(b, b + FEISHU_CHILDREN_BATCH_MAX);
      results.push(await feishuCreateDocChildren(documentId, batch, undefined, prisma, config));
      wroteBatch = true;
    }
  }
  return { blockCount: blocks.length, tableCount, batches: results.length, results };
}

export async function feishuUpdateDocBlocks(
  documentId: string,
  blocks: unknown[],
  prisma: PrismaClient,
  config: AppConfig,
) {
  try {
    return await feishuApi(
      `/docx/v1/documents/${documentId}/blocks/batch_update`,
      {
        method: "PATCH",
        body: { requests: blocks },
        useUserToken: true,
      },
      prisma,
      config,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("1770001") || msg.includes("invalid param") || msg.includes("Invalid")) {
      throw new Error(`${msg} — ${FEISHU_APPEND_HINT}`);
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
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
  try {
    return await feishuApi(
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 1063003：参数合法但操作被拒——最常见是「给文档所有者加权限」或可见性/企管策略
    if (msg.includes("code=1063003")) {
      throw new Error(
        `${msg}\n排查：① 目标是否就是文档所有者（飞书禁止给所有者再加协作者，所有者已有完整权限）；` +
          `② 调用身份与目标是否同企业/互为联系人且未屏蔽；③ 企业是否管控禁止外部分享协作者；` +
          `④ 「转移所有者」需专用 transfer owner API，不是 add_permission_member。`,
      );
    }
    throw err;
  }
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
