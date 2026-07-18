/**
 * 免费 LLM 运行时槽位（进程内）：
 * - freellm 网关：sync-free-keys 探活成功后写入，供 llmClient 在 env key 缺失时注入
 * - OpenRouter :free 模型目录：有 OPENROUTER_API_KEY 时定时刷新（含详情元数据）
 */

import fs from "node:fs";
import path from "node:path";

export type FreellmGatewayRuntime = {
  apiKey: string;
  baseUrl: string;
  model?: string;
  credentialId?: string;
  provider?: string;
  syncedAt: string;
};

/** OpenRouter /models 条目的精简投影（对标官方目录信息密度） */
export type OpenRouterFreeModelInfo = {
  id: string;
  name: string;
  description?: string;
  contextLength?: number;
  modality?: string;
  tokenizer?: string;
  pricingPrompt?: string;
  pricingCompletion?: string;
  topProvider?: string;
};

export type OpenRouterFreeCatalog = {
  syncedAt: string;
  models: OpenRouterFreeModelInfo[];
};

const CATALOG_REL = path.join(".dev-log", "openrouter-free-models.json");

let freellmGateway: FreellmGatewayRuntime | null = null;
let openRouterCatalog: OpenRouterFreeCatalog | null = null;

export function setFreellmGatewayRuntime(slot: FreellmGatewayRuntime | null): void {
  freellmGateway = slot;
}

export function getFreellmGatewayRuntime(): FreellmGatewayRuntime | null {
  return freellmGateway;
}

export function setOpenRouterFreeModelCatalog(catalog: OpenRouterFreeCatalog): void {
  openRouterCatalog = {
    syncedAt: catalog.syncedAt,
    models: catalog.models.filter((m) => m.id.endsWith(":free")),
  };
}

/** 兼容旧调用：只写 id 列表 */
export function setOpenRouterFreeModels(models: string[]): void {
  const syncedAt = new Date().toISOString();
  setOpenRouterFreeModelCatalog({
    syncedAt,
    models: [...new Set(models.filter(Boolean))].map((id) => ({ id, name: id })),
  });
}

export function getOpenRouterFreeModelCatalog(): OpenRouterFreeCatalog | null {
  return openRouterCatalog;
}

export function getOpenRouterFreeModels(): string[] {
  return openRouterCatalog?.models.map((m) => m.id) ?? [];
}

export function getOpenRouterFreeSyncedAt(): string | null {
  return openRouterCatalog?.syncedAt ?? null;
}

export function catalogFilePath(projectRoot: string): string {
  return path.join(projectRoot, CATALOG_REL);
}

export function loadOpenRouterFreeCatalogFromDisk(projectRoot: string): OpenRouterFreeCatalog | null {
  try {
    const file = catalogFilePath(projectRoot);
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as OpenRouterFreeCatalog;
    if (!raw?.syncedAt || !Array.isArray(raw.models)) return null;
    openRouterCatalog = {
      syncedAt: raw.syncedAt,
      models: raw.models.filter((m) => typeof m?.id === "string" && m.id.endsWith(":free")),
    };
    return openRouterCatalog;
  } catch {
    return null;
  }
}

export function saveOpenRouterFreeCatalogToDisk(projectRoot: string, catalog: OpenRouterFreeCatalog): void {
  try {
    const file = catalogFilePath(projectRoot);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(catalog, null, 2), "utf8");
  } catch (err) {
    console.warn(
      "  ⚠️ [freeLlmRuntime] 落盘 OpenRouter 目录失败:",
      err instanceof Error ? err.message : err,
    );
  }
}

export function filterOpenRouterFreeModels(opts?: {
  q?: string;
  modality?: "text" | "multimodal" | "all";
  sort?: "context_desc" | "context_asc" | "name";
}): OpenRouterFreeModelInfo[] {
  let items = [...(openRouterCatalog?.models ?? [])];
  const q = opts?.q?.trim().toLowerCase();
  if (q) {
    items = items.filter(
      (m) =>
        m.id.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q) ||
        (m.description?.toLowerCase().includes(q) ?? false),
    );
  }
  const modality = opts?.modality ?? "all";
  if (modality === "text") {
    items = items.filter((m) => !m.modality || m.modality === "text->text" || m.modality === "text");
  } else if (modality === "multimodal") {
    items = items.filter((m) => !!m.modality && m.modality !== "text->text" && m.modality !== "text");
  }
  const sort = opts?.sort ?? "context_desc";
  items.sort((a, b) => {
    if (sort === "name") return a.id.localeCompare(b.id);
    const ca = a.contextLength ?? 0;
    const cb = b.contextLength ?? 0;
    return sort === "context_asc" ? ca - cb : cb - ca;
  });
  return items;
}

/** env 未配置 apiKey 时，用 freellm 网关填充 */
export function withFreellmGatewayFallback<T extends { apiKey?: string; baseUrl?: string; model?: string }>(
  provider: T,
): T {
  if (provider.apiKey?.trim()) return provider;
  const free = freellmGateway;
  if (!free?.apiKey) return provider;
  return {
    ...provider,
    apiKey: free.apiKey,
    baseUrl: free.baseUrl || provider.baseUrl,
    model: provider.model || free.model || provider.model,
  };
}

export function __resetFreeLlmRuntimeForTests(): void {
  freellmGateway = null;
  openRouterCatalog = null;
}
