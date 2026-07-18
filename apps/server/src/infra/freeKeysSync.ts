/**
 * 免费 API Key 同步：GitHub freellm 源 + OpenRouter :free 目录
 *
 * - 默认随 server 启动（FREE_KEYS_AUTO_SYNC=0/false 关闭）
 * - 探活通过后写入 Credential（scope=llm, metadata.source=free）
 * - 选一条最佳 key 注入 freellm 运行时槽，供 llmClient 在 env key 缺失时使用
 * - 若配置了 OPENROUTER_API_KEY，拉取 OpenRouter 官方 :free 模型列表
 */

import fs from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "./config.js";
import {
  getFreellmGatewayRuntime,
  getOpenRouterFreeModelCatalog,
  loadOpenRouterFreeCatalogFromDisk,
  saveOpenRouterFreeCatalogToDisk,
  setFreellmGatewayRuntime,
  setOpenRouterFreeModelCatalog,
  type OpenRouterFreeModelInfo,
} from "./freeLlmRuntime.js";

export const FREELLM_GATEWAY_BASE_URL = "https://aiapiv2.pekpik.com/v1";
export const OPENROUTER_API_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;
const MAX_PROBE = 20;

export interface FreeKeyEntry {
  key: string;
  model?: string;
  provider?: string;
  baseUrl?: string;
  budget?: string;
  rateLimit?: string;
  status?: string;
  description?: string;
  expiresAt?: string;
}

export interface FreeKeysSyncResult {
  fetched: number;
  validated: number;
  synced: number;
  updated: number;
  skipped: number;
  cleaned: number;
  openRouterFreeModels: number;
  runtimeModel?: string;
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

function envFlagEnabled(name: string, defaultOn: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultOn;
  const v = raw.trim().toLowerCase();
  if (["0", "false", "off", "no"].includes(v)) return false;
  if (["1", "true", "on", "yes"].includes(v)) return true;
  return defaultOn;
}

function withProxy(url: string): string {
  const proxy = (process.env.FREE_KEYS_PROXY ?? "").trim();
  if (!proxy) return url;
  return `${proxy.replace(/\/$/, "")}/${url}`;
}

function freellmSources(): { url: string; kind: "readme" | "json" }[] {
  return [
    {
      url: withProxy("https://raw.githubusercontent.com/alistaitsacle/free-llm-api-keys/main/README.md"),
      kind: "readme",
    },
    {
      url: withProxy("https://raw.githubusercontent.com/alistaitsacle/free-llm-api-keys/main/keys.json"),
      kind: "json",
    },
    {
      url: withProxy("https://raw.githubusercontent.com/alistaitsacle/free-llm-api-keys/main/free-keys.json"),
      kind: "json",
    },
  ];
}

export function parseExpiresDate(raw: string): string | undefined {
  const s = raw.trim();
  if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T23:59:59Z`;
  return /Z|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}Z`;
}

export function parseReadmeKeys(md: string, defaultBaseUrl = FREELLM_GATEWAY_BASE_URL): FreeKeyEntry[] {
  const entries: FreeKeyEntry[] = [];
  const rowRe =
    /\|\s*`((?:sk-)?[A-Za-z0-9_\-]+)`\s*\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(md)) !== null) {
    const key = m[1]!.trim();
    if (!/^sk-/.test(key)) continue;
    const model = m[2]!.trim();
    const status = m[3]!.trim();
    const budget = m[4]!.trim();
    const rateLimit = m[5]!.trim();
    const expires = m[6]!.trim();
    const description = m[7]!.trim();
    const provider = model.includes("/") ? model.split("/")[0] : model.split("-")[0];
    entries.push({
      key,
      model: model || undefined,
      provider: provider || undefined,
      baseUrl: defaultBaseUrl,
      budget: budget || undefined,
      rateLimit: rateLimit || undefined,
      status: status || undefined,
      description: description || undefined,
      expiresAt: parseExpiresDate(expires),
    });
  }
  return entries;
}

export function parseJsonKeys(data: unknown, defaultBaseUrl = FREELLM_GATEWAY_BASE_URL): FreeKeyEntry[] {
  const out: FreeKeyEntry[] = [];
  const push = (raw: Record<string, unknown>) => {
    const key = String(raw.key ?? raw.apiKey ?? raw.api_key ?? "").trim();
    if (!key) return;
    const model = raw.model != null ? String(raw.model) : undefined;
    const provider =
      raw.provider != null
        ? String(raw.provider)
        : model?.includes("/")
          ? model.split("/")[0]
          : undefined;
    out.push({
      key,
      model,
      provider,
      baseUrl: raw.baseUrl != null ? String(raw.baseUrl) : defaultBaseUrl,
      budget: raw.budget != null ? String(raw.budget) : undefined,
      rateLimit: raw.rateLimit != null ? String(raw.rateLimit) : undefined,
      status: raw.status != null ? String(raw.status) : undefined,
      description: raw.description != null ? String(raw.description) : undefined,
      expiresAt: raw.expiresAt != null ? String(raw.expiresAt) : undefined,
    });
  };

  if (Array.isArray(data)) {
    for (const item of data) {
      if (typeof item === "string") out.push({ key: item, baseUrl: defaultBaseUrl });
      else if (item && typeof item === "object") push(item as Record<string, unknown>);
    }
    return out;
  }
  if (!data || typeof data !== "object") return out;
  const obj = data as Record<string, unknown>;
  if (Array.isArray(obj.keys)) return parseJsonKeys(obj.keys, defaultBaseUrl);
  if (Array.isArray(obj.providers)) {
    for (const p of obj.providers) {
      if (p && typeof p === "object" && Array.isArray((p as { keys?: unknown }).keys)) {
        out.push(...parseJsonKeys((p as { keys: unknown }).keys, defaultBaseUrl));
      }
    }
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string" && /^sk-/.test(v)) out.push({ key: v, model: k, baseUrl: defaultBaseUrl });
    else if (typeof v === "string" && /^sk-/.test(k)) out.push({ key: k, model: v, baseUrl: defaultBaseUrl });
  }
  return out;
}

async function fetchText(url: string): Promise<{ ok: boolean; status: number; text: string }> {
  const res = await fetch(url, {
    headers: { "User-Agent": "KnowPilot-freeKeysSync/1.0" },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

export async function fetchFreellmKeys(projectRoot: string): Promise<FreeKeyEntry[]> {
  for (const src of freellmSources()) {
    try {
      const res = await fetchText(src.url);
      if (!res.ok) {
        console.warn(`  ⚠️ [freeKeysSync] ${src.url} -> HTTP ${res.status}`);
        continue;
      }
      if (src.kind === "readme") {
        const keys = parseReadmeKeys(res.text);
        if (keys.length > 0) {
          console.log(`  📄 [freeKeysSync] 从 README 解析到 ${keys.length} 个 key`);
          return keys;
        }
        continue;
      }
      const keys = parseJsonKeys(JSON.parse(res.text) as unknown);
      if (keys.length > 0) {
        console.log(`  📦 [freeKeysSync] 从 ${src.url} 解析到 ${keys.length} 个 key`);
        return keys;
      }
    } catch (err) {
      console.warn(
        `  ⚠️ [freeKeysSync] 拉取 ${src.url} 失败:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const local =
    process.env.FREE_KEYS_LOCAL_FILE?.trim() ||
    path.join(projectRoot, "content", "free-keys-readme.md");
  try {
    if (fs.existsSync(local)) {
      const text = fs.readFileSync(local, "utf8");
      const keys = local.endsWith(".json")
        ? parseJsonKeys(JSON.parse(text) as unknown)
        : parseReadmeKeys(text);
      if (keys.length > 0) {
        console.log(`  📁 [freeKeysSync] 从本地 ${local} 解析到 ${keys.length} 个 key`);
        return keys;
      }
    }
  } catch (err) {
    console.warn(
      `  ⚠️ [freeKeysSync] 本地文件失败:`,
      err instanceof Error ? err.message : err,
    );
  }
  return [];
}

/** 轻量探活：GET /models */
export async function probeFreeKey(
  entry: FreeKeyEntry,
  opts?: { timeoutMs?: number },
): Promise<boolean> {
  const baseUrl = (entry.baseUrl || FREELLM_GATEWAY_BASE_URL).replace(/\/$/, "");
  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${entry.key}`,
        "User-Agent": "KnowPilot-freeKeysSync/1.0",
      },
      signal: AbortSignal.timeout(opts?.timeoutMs ?? 12_000),
    });
    return res.ok || res.status === 404; // 少数网关无 /models 但仍可用
  } catch {
    return false;
  }
}

function preferenceScore(entry: FreeKeyEntry): number {
  const m = (entry.model ?? "").toLowerCase();
  if (m.includes("deepseek-v4-flash")) return 100;
  if (m === "smart-chat") return 90;
  if (m.endsWith(":free")) return 80;
  if (m.startsWith("openrouter/")) return 70;
  if (m.includes("deepseek")) return 60;
  if (m.includes("gemini") && m.includes("flash")) return 50;
  return 10;
}

export async function validateEntries(entries: FreeKeyEntry[]): Promise<FreeKeyEntry[]> {
  if (envFlagEnabled("FREE_KEYS_SKIP_PROBE", false)) return entries;
  const sorted = [...entries].sort((a, b) => preferenceScore(b) - preferenceScore(a));
  const candidates = sorted.slice(0, MAX_PROBE);
  const ok: FreeKeyEntry[] = [];
  for (const entry of candidates) {
    const valid = await probeFreeKey(entry);
    if (valid) ok.push(entry);
  }
  console.log(`  🔎 [freeKeysSync] 探活 ${candidates.length} 条，通过 ${ok.length} 条`);
  return ok;
}

type OpenRouterApiModel = {
  id?: string;
  name?: string;
  description?: string;
  context_length?: number;
  architecture?: { modality?: string; tokenizer?: string };
  pricing?: { prompt?: string; completion?: string };
  top_provider?: { name?: string } | string;
};

/** 将 OpenRouter /models 原始条目投影为面板用精简结构 */
export function projectOpenRouterFreeModel(raw: OpenRouterApiModel): OpenRouterFreeModelInfo | null {
  const id = raw.id?.trim() ?? "";
  if (!id.endsWith(":free")) return null;
  const top =
    typeof raw.top_provider === "string"
      ? raw.top_provider
      : raw.top_provider?.name;
  return {
    id,
    name: (raw.name?.trim() || id),
    description: raw.description?.trim() || undefined,
    contextLength: typeof raw.context_length === "number" ? raw.context_length : undefined,
    modality: raw.architecture?.modality,
    tokenizer: raw.architecture?.tokenizer,
    pricingPrompt: raw.pricing?.prompt,
    pricingCompletion: raw.pricing?.completion,
    topProvider: top,
  };
}

export async function syncOpenRouterFreeModels(config: AppConfig): Promise<string[]> {
  const apiKey = config.llm.providers.openrouter?.apiKey?.trim();
  if (!apiKey) {
    // 无 key：尽量用磁盘缓存撑起面板首屏
    if (!getOpenRouterFreeModelCatalog()) {
      loadOpenRouterFreeCatalogFromDisk(config.projectRoot);
    }
    console.log("  ℹ️ [freeKeysSync] 未配置 OPENROUTER_API_KEY，跳过 OpenRouter :free 在线同步");
    return getOpenRouterFreeModelCatalog()?.models.map((m) => m.id) ?? [];
  }
  const base = (config.llm.providers.openrouter.baseUrl || OPENROUTER_API_BASE_URL).replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://knowpilot.local",
        "X-Title": "KnowPilot",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.warn(`  ⚠️ [freeKeysSync] OpenRouter /models HTTP ${res.status}`);
      return [];
    }
    const data = (await res.json()) as { data?: OpenRouterApiModel[] };
    const models = (data.data ?? [])
      .map(projectOpenRouterFreeModel)
      .filter((m): m is OpenRouterFreeModelInfo => !!m);
    const syncedAt = new Date().toISOString();
    const catalog = { syncedAt, models };
    setOpenRouterFreeModelCatalog(catalog);
    saveOpenRouterFreeCatalogToDisk(config.projectRoot, catalog);

    const freeIds = models.map((m) => m.id);
    const existing = config.llm.fallbackModels ?? [];
    const merged = [...freeIds.slice(0, 8), ...existing.filter((m) => !freeIds.includes(m))];
    config.llm.fallbackModels = merged.slice(0, 16);
    console.log(`  🌐 [freeKeysSync] OpenRouter :free 模型 ${models.length} 个（已写入 fallback + 落盘）`);
    return freeIds;
  } catch (err) {
    console.warn(
      `  ⚠️ [freeKeysSync] OpenRouter 同步失败:`,
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

function credentialName(entry: FreeKeyEntry): string {
  return `free-${entry.provider ?? "unknown"}-${entry.model ?? "default"}-${entry.key.slice(-8)}`;
}

export async function syncFreeKeys(
  prisma: PrismaClient,
  config: AppConfig,
): Promise<FreeKeysSyncResult> {
  console.log("🔄 [freeKeysSync] 开始同步免费 API Key...");
  const fetched = await fetchFreellmKeys(config.projectRoot);
  const validated = fetched.length ? await validateEntries(fetched) : [];

  let synced = 0;
  let updated = 0;
  let skipped = 0;
  const nowIso = new Date().toISOString();
  const seen = new Set<string>();

  for (const entry of validated) {
    if (!entry.key || seen.has(entry.key)) {
      skipped++;
      continue;
    }
    seen.add(entry.key);
    const name = credentialName(entry);
    const metadata = JSON.stringify({
      source: "free",
      channel: "freellm",
      provider: entry.provider ?? "unknown",
      model: entry.model,
      baseUrl: entry.baseUrl ?? FREELLM_GATEWAY_BASE_URL,
      budget: entry.budget,
      rateLimit: entry.rateLimit,
      status: entry.status,
      description: entry.description,
      validated: true,
      syncedAt: nowIso,
    });
    const expiresAt = entry.expiresAt ? new Date(entry.expiresAt) : null;
    const existing = await prisma.credential.findFirst({ where: { name } });
    if (existing) {
      await prisma.credential.update({
        where: { id: existing.id },
        data: { value: entry.key, metadata, expiresAt },
      });
      updated++;
    } else {
      await prisma.credential.create({
        data: {
          name,
          type: "api_key",
          value: entry.key,
          scope: "llm",
          metadata,
          expiresAt,
        },
      });
      synced++;
    }
  }

  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const allFree = await prisma.credential.findMany({ where: { scope: { contains: "llm" } } });
  let cleaned = 0;
  for (const c of allFree) {
    try {
      const meta = JSON.parse(c.metadata || "{}") as { source?: string; syncedAt?: string };
      if (meta.source !== "free") continue;
      const syncedAt = meta.syncedAt ? new Date(meta.syncedAt) : c.updatedAt;
      if (syncedAt < cutoff) {
        await prisma.credential.delete({ where: { id: c.id } });
        cleaned++;
      }
    } catch {
      /* ignore */
    }
  }

  // 注入运行时：优先 deepseek-v4-flash / smart-chat
  const best = [...validated].sort((a, b) => preferenceScore(b) - preferenceScore(a))[0];
  if (best) {
    const name = credentialName(best);
    const row = await prisma.credential.findFirst({ where: { name }, select: { id: true } });
    setFreellmGatewayRuntime({
      apiKey: best.key,
      baseUrl: best.baseUrl ?? FREELLM_GATEWAY_BASE_URL,
      model: best.model,
      provider: best.provider,
      credentialId: row?.id,
      syncedAt: nowIso,
    });
  } else if (!getFreellmGatewayRuntime()) {
    setFreellmGatewayRuntime(null);
  }

  const openRouterFree = await syncOpenRouterFreeModels(config);

  const result: FreeKeysSyncResult = {
    fetched: fetched.length,
    validated: validated.length,
    synced,
    updated,
    skipped,
    cleaned,
    openRouterFreeModels: openRouterFree.length,
    runtimeModel: best?.model,
  };
  console.log(
    `  ✅ [freeKeysSync] 获取 ${result.fetched}，探活通过 ${result.validated}，新增 ${result.synced}，更新 ${result.updated}，清理 ${result.cleaned}；运行时模型=${result.runtimeModel ?? "无"}；OpenRouter:free=${result.openRouterFreeModels}`,
  );
  return result;
}

export function startFreeKeysAutoSync(prisma: PrismaClient, config: AppConfig): void {
  if (!envFlagEnabled("FREE_KEYS_AUTO_SYNC", true)) {
    console.log("  ℹ️ [freeKeysSync] FREE_KEYS_AUTO_SYNC 已关闭，跳过启动同步");
    // 仍加载磁盘目录，供面板只读浏览
    loadOpenRouterFreeCatalogFromDisk(config.projectRoot);
    return;
  }
  if (process.env.MOCK_LLM === "true") {
    console.log("  ℹ️ [freeKeysSync] MOCK_LLM=true，跳过免费 key 同步");
    loadOpenRouterFreeCatalogFromDisk(config.projectRoot);
    return;
  }

  loadOpenRouterFreeCatalogFromDisk(config.projectRoot);

  const intervalMs = Math.max(
    5 * 60 * 1000,
    Number(process.env.FREE_KEYS_SYNC_INTERVAL_MS) || DEFAULT_INTERVAL_MS,
  );

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await syncFreeKeys(prisma, config);
    } catch (err) {
      console.warn("  ⚠️ [freeKeysSync] 同步失败:", err instanceof Error ? err.message : err);
    } finally {
      running = false;
    }
  };

  void tick();
  if (timer) clearInterval(timer);
  timer = setInterval(() => void tick(), intervalMs);
  console.log(`  👀 [freeKeysSync] 已启动（默认开启，间隔 ${Math.round(intervalMs / 60000)} 分钟）`);
}

export function stopFreeKeysAutoSync(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export type FreellmChannelInfo = {
  id: string;
  name: string;
  model?: string;
  provider?: string;
  baseUrl?: string;
  budget?: string;
  rateLimit?: string;
  status?: string;
  validated?: boolean;
  expiresAt?: string | null;
  lastUsedAt?: string | null;
  syncedAt?: string;
  isRuntime: boolean;
};

/** Credential 中 freellm 通道列表（永不返回 value） */
export async function listFreellmChannels(prisma: PrismaClient): Promise<FreellmChannelInfo[]> {
  const runtime = getFreellmGatewayRuntime();
  const rows = await prisma.credential.findMany({
    where: { scope: { contains: "llm" } },
    select: {
      id: true,
      name: true,
      metadata: true,
      expiresAt: true,
      lastUsedAt: true,
    },
    orderBy: { updatedAt: "desc" },
  });
  const out: FreellmChannelInfo[] = [];
  for (const c of rows) {
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(c.metadata || "{}") as Record<string, unknown>;
    } catch {
      continue;
    }
    if (meta.source !== "free") continue;
    out.push({
      id: c.id,
      name: c.name,
      model: typeof meta.model === "string" ? meta.model : undefined,
      provider: typeof meta.provider === "string" ? meta.provider : undefined,
      baseUrl: typeof meta.baseUrl === "string" ? meta.baseUrl : undefined,
      budget: typeof meta.budget === "string" ? meta.budget : undefined,
      rateLimit: typeof meta.rateLimit === "string" ? meta.rateLimit : undefined,
      status: typeof meta.status === "string" ? meta.status : undefined,
      validated: meta.validated === true,
      expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
      lastUsedAt: c.lastUsedAt ? c.lastUsedAt.toISOString() : null,
      syncedAt: typeof meta.syncedAt === "string" ? meta.syncedAt : undefined,
      isRuntime: !!runtime && (runtime.credentialId === c.id || runtime.model === meta.model),
    });
  }
  return out;
}
