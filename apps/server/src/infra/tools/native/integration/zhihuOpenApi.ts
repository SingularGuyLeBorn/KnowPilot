/**
 * 集成域 — 知乎数据开放平台（developer.zhihu.com）
 * 凭据：ZHIHU_ACCESS_SECRET 或 Credential scope=zhihu_openapi name=access_secret
 */
import type { NativeToolContext, NativeToolDefinition, NativeToolHandler } from "../types.js";
import {
  resolveZhihuAccessSecret,
  zhihuFavlistContents,
  zhihuGlobalSearch,
  zhihuHotList,
  zhihuSearch,
  zhihuUserCollections,
  zhihuUserFavlists,
  zhihuZhida,
} from "../../../zhihuOpenApi.js";

async function requireSecret(ctx: NativeToolContext): Promise<string> {
  const secret = await resolveZhihuAccessSecret(ctx.prisma);
  if (!secret) {
    throw new Error(
      "未配置知乎开放平台凭据：请设置环境变量 ZHIHU_ACCESS_SECRET，或在 Credential 表新增 scope=zhihu_openapi name=access_secret。申请：https://developer.zhihu.com/ （个人中心申请 Token）",
    );
  }
  return secret;
}

async function zhihuOpenapiSearch(args: Record<string, unknown>, ctx: NativeToolContext) {
  const query = String(args.query ?? "").trim();
  if (query.length < 2) throw new Error("query 至少 2 个字符");
  const scope = args.scope === "web" ? "web" : "zhihu";
  const count = typeof args.count === "number" ? args.count : 10;
  const secret = await requireSecret(ctx);
  const res =
    scope === "web"
      ? await zhihuGlobalSearch(secret, query, {
          count,
          filter: typeof args.filter === "string" ? args.filter : undefined,
          searchDb:
            args.searchDb === "realtime" || args.searchDb === "static" ? args.searchDb : "all",
        })
      : await zhihuSearch(secret, query, count);
  if (!res.ok) throw new Error(`知乎开放平台搜索失败 Code=${res.code}: ${res.message}`);
  return { ok: true, scope, query, data: res.data };
}

async function zhihuOpenapiHotList(args: Record<string, unknown>, ctx: NativeToolContext) {
  const secret = await requireSecret(ctx);
  const limit = typeof args.limit === "number" ? args.limit : 30;
  const res = await zhihuHotList(secret, limit);
  if (!res.ok) throw new Error(`知乎热榜失败 Code=${res.code}: ${res.message}`);
  return { ok: true, data: res.data };
}

async function zhihuOpenapiAsk(args: Record<string, unknown>, ctx: NativeToolContext) {
  const question = String(args.question ?? "").trim();
  if (!question) throw new Error("需要 question");
  const secret = await requireSecret(ctx);
  const model =
    args.model === "zhida-thinking-1p5" || args.model === "zhida-agent"
      ? args.model
      : "zhida-fast-1p5";
  const res = await zhihuZhida(secret, question, { model });
  if (!res.ok) throw new Error(`知乎直答失败 Code=${res.code}: ${res.message}`);
  return { ok: true, model, data: res.data };
}

async function zhihuOpenapiFavlists(args: Record<string, unknown>, ctx: NativeToolContext) {
  const secret = await requireSecret(ctx);
  const limit = typeof args.limit === "number" ? args.limit : 50;
  const res = await zhihuUserFavlists(secret, limit);
  if (!res.ok) throw new Error(`知乎收藏夹列表失败 Code=${res.code}: ${res.message}`);
  return { ok: true, data: res.data };
}

async function zhihuOpenapiRecentCollections(args: Record<string, unknown>, ctx: NativeToolContext) {
  const secret = await requireSecret(ctx);
  const limit = typeof args.limit === "number" ? args.limit : 20;
  const res = await zhihuUserCollections(secret, limit);
  if (!res.ok) throw new Error(`知乎近期收藏失败 Code=${res.code}: ${res.message}`);
  return { ok: true, data: res.data };
}

async function zhihuOpenapiFavlistContents(args: Record<string, unknown>, ctx: NativeToolContext) {
  const secret = await requireSecret(ctx);
  const tokenRaw = args.favlistUrlToken ?? args.urlToken;
  const idRaw = args.favlistId;
  const favlistUrlToken =
    typeof tokenRaw === "number"
      ? tokenRaw
      : typeof tokenRaw === "string" && tokenRaw.trim()
        ? Number(tokenRaw)
        : undefined;
  const favlistId =
    typeof idRaw === "number"
      ? idRaw
      : typeof idRaw === "string" && idRaw.trim()
        ? Number(idRaw)
        : undefined;
  if (
    (favlistUrlToken == null || !Number.isFinite(favlistUrlToken)) &&
    (favlistId == null || !Number.isFinite(favlistId))
  ) {
    throw new Error("需要 favlistUrlToken（收藏夹 URL 末尾数字）或 favlistId");
  }
  const res = await zhihuFavlistContents(secret, {
    favlistUrlToken: Number.isFinite(favlistUrlToken) ? favlistUrlToken : undefined,
    favlistId: Number.isFinite(favlistId) ? favlistId : undefined,
    offset: (args.offset as number | string | undefined) ?? 0,
    limit: typeof args.limit === "number" ? args.limit : 20,
  });
  if (!res.ok) throw new Error(`知乎收藏夹内容失败 Code=${res.code}: ${res.message}`);
  return { ok: true, data: res.data };
}

export const zhihuOpenApiDefs: NativeToolDefinition[] = [
  {
    name: "zhihu_openapi_search",
    concurrencyClass: "B",
    description:
      "知乎数据开放平台搜索（官方 API，无需浏览器/cookie）。scope=zhihu 站内问答文章；scope=web 全网搜索。凭据 ZHIHU_ACCESS_SECRET。比 platform_login+爬虫稳，适合检索公开知识。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索词，至少 2 字" },
        scope: { type: "string", enum: ["zhihu", "web"], description: "默认 zhihu" },
        count: { type: "number", description: "条数；站内最多 10，全网最多 20" },
        filter: { type: "string", description: "仅 scope=web：如 host==\"github.com\"" },
        searchDb: { type: "string", enum: ["all", "realtime", "static"] },
      },
      required: ["query"],
    },
  },
  {
    name: "zhihu_openapi_hot_list",
    concurrencyClass: "B",
    description: "知乎热榜（官方开放平台）。凭据 ZHIHU_ACCESS_SECRET。",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", description: "1–30，默认 30" },
      },
    },
  },
  {
    name: "zhihu_openapi_ask",
    concurrencyClass: "B",
    description:
      "知乎直答（官方合成回答，非链接列表）。model：zhida-fast-1p5（默认）/ zhida-thinking-1p5 / zhida-agent。",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string" },
        model: {
          type: "string",
          enum: ["zhida-fast-1p5", "zhida-thinking-1p5", "zhida-agent"],
        },
      },
      required: ["question"],
    },
  },
  {
    name: "zhihu_openapi_favlists",
    concurrencyClass: "B",
    description:
      "列出当前开放平台账号的收藏夹（官方 API）。Inbox 全量同步优先走此通道，无需 platform_login。",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", description: "默认 50，最大 50" },
      },
    },
  },
  {
    name: "zhihu_openapi_recent_collections",
    concurrencyClass: "B",
    description: "近期收藏内容列表（官方 API，跨收藏夹）。",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number" },
      },
    },
  },
  {
    name: "zhihu_openapi_favlist_contents",
    concurrencyClass: "B",
    description:
      "拉取指定收藏夹内容（官方 API）。favlistUrlToken=收藏夹 URL 末尾数字。用 offset/NextOffset 翻页。",
    parameters: {
      type: "object",
      properties: {
        favlistUrlToken: { type: "number" },
        favlistId: { type: "number" },
        offset: { type: ["number", "string"] },
        limit: { type: "number" },
      },
    },
  },
];

export const zhihuOpenApiHandlers: Record<string, NativeToolHandler> = {
  zhihu_openapi_search: zhihuOpenapiSearch,
  zhihu_openapi_hot_list: zhihuOpenapiHotList,
  zhihu_openapi_ask: zhihuOpenapiAsk,
  zhihu_openapi_favlists: zhihuOpenapiFavlists,
  zhihu_openapi_recent_collections: zhihuOpenapiRecentCollections,
  zhihu_openapi_favlist_contents: zhihuOpenapiFavlistContents,
};
