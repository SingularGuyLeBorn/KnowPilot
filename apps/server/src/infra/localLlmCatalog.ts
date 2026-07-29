/**
 * 本地 OpenAI 兼容后端模型发现（Ollama / llama.cpp / LM Studio / vLLM）。
 * 叶子模块：只读探测，不写库。
 */

import {
  LOCAL_LLM_DEFAULT_BASE_URLS,
  LOCAL_LLM_PROVIDER_IDS,
  LOCAL_LLM_PROVIDER_LABELS,
  toLocalModelRef,
  type LocalLlmProviderId,
} from "@knowpilot/shared";
import type { AppConfig } from "./config.js";

export interface LocalLlmBackendStatus {
  id: LocalLlmProviderId;
  label: string;
  baseUrl: string;
  reachable: boolean;
  error?: string;
  models: Array<{
    /** 会话用 id：provider/upstream */
    id: string;
    /** 上游原始模型名 */
    name: string;
    sizeBytes?: number;
  }>;
}

function resolveBaseUrl(config: AppConfig, id: LocalLlmProviderId): string {
  const fromCfg = config.llm.providers[id]?.baseUrl?.trim();
  return (fromCfg || LOCAL_LLM_DEFAULT_BASE_URLS[id]).replace(/\/$/, "");
}

/** OpenAI 兼容根 → 主机根（Ollama /api/tags 在 /v1 之外） */
function hostRootFromV1(baseUrl: string): string {
  return baseUrl.replace(/\/v1\/?$/i, "");
}

async function fetchJson(url: string, apiKey: string, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey || "local"}`,
      },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}${text ? `: ${text.slice(0, 160)}` : ""}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function listOllamaModels(
  baseUrl: string,
  apiKey: string,
  timeoutMs: number,
): Promise<LocalLlmBackendStatus["models"]> {
  const root = hostRootFromV1(baseUrl);
  const data = (await fetchJson(`${root}/api/tags`, apiKey, timeoutMs)) as {
    models?: Array<{ name?: string; model?: string; size?: number }>;
  };
  const rows = data.models ?? [];
  return rows
    .map((m) => {
      const name = (m.name || m.model || "").trim();
      if (!name) return null;
      return {
        id: toLocalModelRef("ollama", name),
        name,
        sizeBytes: typeof m.size === "number" ? m.size : undefined,
      };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
}

async function listOpenAiCompatibleModels(
  providerId: LocalLlmProviderId,
  baseUrl: string,
  apiKey: string,
  timeoutMs: number,
): Promise<LocalLlmBackendStatus["models"]> {
  const data = (await fetchJson(`${baseUrl}/models`, apiKey, timeoutMs)) as {
    data?: Array<{ id?: string }>;
  };
  const rows = data.data ?? [];
  return rows
    .map((m) => {
      const name = (m.id || "").trim();
      if (!name) return null;
      return { id: toLocalModelRef(providerId, name), name };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
}

export async function listLocalLlmBackends(
  config: AppConfig,
  opts?: { timeoutMs?: number; providers?: LocalLlmProviderId[] },
): Promise<{ items: LocalLlmBackendStatus[]; totalModels: number }> {
  const timeoutMs = opts?.timeoutMs ?? 2500;
  const ids = opts?.providers?.length
    ? opts.providers
    : ([...LOCAL_LLM_PROVIDER_IDS] as LocalLlmProviderId[]);

  const items: LocalLlmBackendStatus[] = [];
  for (const id of ids) {
    const baseUrl = resolveBaseUrl(config, id);
    const apiKey = config.llm.providers[id]?.apiKey?.trim() || "local";
    const entry: LocalLlmBackendStatus = {
      id,
      label: LOCAL_LLM_PROVIDER_LABELS[id],
      baseUrl,
      reachable: false,
      models: [],
    };
    try {
      entry.models =
        id === "ollama"
          ? await listOllamaModels(baseUrl, apiKey, timeoutMs)
          : await listOpenAiCompatibleModels(id, baseUrl, apiKey, timeoutMs);
      entry.reachable = true;
    } catch (err) {
      entry.reachable = false;
      entry.error = err instanceof Error ? err.message : String(err);
    }
    items.push(entry);
  }

  return {
    items,
    totalModels: items.reduce((n, b) => n + b.models.length, 0),
  };
}
