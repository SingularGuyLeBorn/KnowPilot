/**
 * Hermes 式 auxiliary 模型解析（background_review / goal_judge 等旁路任务）。
 *
 * auto 策略（与 compact.summaryModel 的「轻量优先」刻意相反）：
 * 1. 有 OpenRouter key + 已同步 :free 目录 → 按 strong_free / lite_free 打分挑一条
 * 2. 否则 freellm 网关兜底默认 provider 时 → 用网关模型
 * 3. 否则回退主对话模型
 */

import type { AppConfig } from "./config.js";
import {
  filterOpenRouterFreeModels,
  getFreellmGatewayRuntime,
  type OpenRouterFreeModelInfo,
} from "./freeLlmRuntime.js";

export type AuxModelPreference = "strong_free" | "lite_free";

function paramBillions(id: string): number {
  const m = id.match(/(\d+(?:\.\d+)?)b\b/i);
  return m ? Number(m[1]) : 0;
}

/** 供单测 / 诊断：对单条 :free 模型打分（越高越优先） */
export function scoreOpenRouterFreeModel(
  m: OpenRouterFreeModelInfo,
  preference: AuxModelPreference,
): number {
  const id = m.id.toLowerCase();
  // 上下文只作细粒度决胜；避免 1M flash 靠窗口碾压 70B
  const ctxTie = Math.min(m.contextLength ?? 0, 256_000) / 10_000;
  const params = paramBillions(id);

  const isLite =
    /flash|mini|lite|nano|tiny|small|haiku/.test(id) || (params > 0 && params <= 9);
  const isStrongFamily =
    /qwen3|deepseek|llama-4|llama-3\.3|gemma-3|kimi|glm-4|gpt-oss|mistral|command-r|gemini-2\.5|gemini-3|\byi-/.test(
      id,
    ) || params >= 14;

  if (preference === "strong_free") {
    let score = ctxTie + params * 2;
    if (isStrongFamily) score += 40;
    if (isLite) score -= 120;
    return score;
  }

  let score = ctxTie;
  if (isLite) score += 80;
  if (isStrongFamily && !isLite) score -= 30;
  // lite 偏好下参数越小略加分
  if (params > 0 && params <= 9) score += (10 - params);
  return score;
}

export function pickOpenRouterFreeModel(preference: AuxModelPreference): string | null {
  const text = filterOpenRouterFreeModels({ modality: "text", sort: "context_desc" });
  const pool = text.length > 0 ? text : filterOpenRouterFreeModels({ sort: "context_desc" });
  if (pool.length === 0) return null;

  let best = pool[0]!;
  let bestScore = scoreOpenRouterFreeModel(best, preference);
  for (let i = 1; i < pool.length; i++) {
    const m = pool[i]!;
    const s = scoreOpenRouterFreeModel(m, preference);
    if (s > bestScore) {
      best = m;
      bestScore = s;
    }
  }
  return best.id;
}

/**
 * @param configured `"auto"` 或具体模型 id（含 `org/model:free`）
 * @param mainModel 主 Agent / 会话模型，作最终回退
 */
export function resolveAuxiliaryModel(
  config: AppConfig,
  opts: {
    configured: string;
    mainModel: string;
    preference?: AuxModelPreference;
  },
): string {
  const configured = (opts.configured || "auto").trim();
  if (configured.toLowerCase() !== "auto") return configured;

  const preference = opts.preference ?? "strong_free";
  const hasOpenRouter = !!config.llm?.providers?.openrouter?.apiKey?.trim();
  if (hasOpenRouter) {
    const picked = pickOpenRouterFreeModel(preference);
    if (picked) return picked;
  }

  const freellm = getFreellmGatewayRuntime();
  const freellmModel = freellm?.model?.trim();
  const providers = config.llm?.providers;
  const defaultProviderId = config.llm?.defaultProvider;
  const defaultProvider = defaultProviderId ? providers?.[defaultProviderId] : undefined;
  const freellmBackingDefault = !!freellm?.apiKey && !defaultProvider?.apiKey?.trim();
  if (freellmBackingDefault && freellmModel) return freellmModel;

  return opts.mainModel;
}
