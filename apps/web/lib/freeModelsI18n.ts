/**
 * 免费模型目录页文案（中/英）。默认中文，localStorage 记忆选择。
 */

export type FreeModelsLocale = "zh" | "en";

const STORAGE_KEY = "kp-free-models-locale";

export function readFreeModelsLocale(): FreeModelsLocale {
  if (typeof window === "undefined") return "zh";
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "en" || v === "zh") return v;
  } catch {
    /* ignore */
  }
  return "zh";
}

export function writeFreeModelsLocale(locale: FreeModelsLocale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* ignore */
  }
}

const zh = {
  pageTitle: "免费模型目录",
  pageDesc: "OpenRouter :free 与 freellm 通道 · 复制模型 id 即可在 Chat / 压缩摘要中使用",
  langZh: "中文",
  langEn: "EN",
  syncAt: "同步于",
  refresh: "立即刷新",
  refreshing: "同步中…",
  refreshed: (or: number, validated: number, synced: number) =>
    `已刷新：OpenRouter ${or} · freellm 探活 ${validated}（新增 ${synced}）`,
  refreshFailed: (msg: string) => `刷新失败：${msg}`,
  noOrKey: "未配 OR key",
  runtime: "运行时",
  openRouterTitle: "OpenRouter 免费模型",
  openRouterSubtitle: "点击模型 id 即可复制到 Chat",
  officialCatalog: "官方目录",
  noOrKeyHint:
    "未配置 OPENROUTER_API_KEY。写入项目根目录 .env 后重启即可在线同步 :free 目录；有落盘缓存时可只读浏览。",
  searchPlaceholder: "搜索模型 id / 名称 / 描述…",
  modalityAll: "全部模态",
  modalityText: "纯文本",
  modalityMulti: "多模态",
  sortCtxDesc: "上下文 ↓",
  sortCtxAsc: "上下文 ↑",
  sortName: "名称",
  emptyOrTitle: "暂无 :free 模型",
  emptyOrDescHasKey: "点击「立即刷新」从 OpenRouter 拉取目录。",
  emptyOrDescNoKey: "配置 OPENROUTER_API_KEY 后刷新即可。",
  multimodal: "多模态",
  freeBadge: "免费",
  /** 上下文窗口角标后缀，如「1.0M 上下文」 */
  ctxLabel: "上下文",
  modalityTextToText: "文本→文本",
  expand: "展开全部",
  collapse: "收起",
  copyId: "复制 id",
  copied: "已复制",
  copyTitle: "复制模型 id",
  freellmTitle: "Freellm 网关通道",
  freellmSubtitle: "已探活入库 · 不展示明文 key",
  emptyFreellmTitle: "暂无 freellm 通道",
  emptyFreellmDesc: "启动同步或点击「立即刷新」从 GitHub freellm / 本地 README 拉取并探活。",
  validated: "已探活",
  budget: "预算",
  rateLimit: "限速",
  expires: "过期",
  summaryTitle: "免费模型目录",
  summaryLoading: "加载中…",
  summaryViewAll: "查看全部 →",
} as const;

const en: { [K in keyof typeof zh]: (typeof zh)[K] } = {
  pageTitle: "Free Models",
  pageDesc: "OpenRouter :free & freellm · Copy a model id for Chat / compaction",
  langZh: "中文",
  langEn: "EN",
  syncAt: "Synced",
  refresh: "Refresh now",
  refreshing: "Syncing…",
  refreshed: (or, validated, synced) =>
    `Refreshed: OpenRouter ${or} · freellm validated ${validated} (+${synced})`,
  refreshFailed: (msg) => `Refresh failed: ${msg}`,
  noOrKey: "No OR key",
  runtime: "Runtime",
  openRouterTitle: "OpenRouter free models",
  openRouterSubtitle: "Click a model id to copy for Chat",
  officialCatalog: "Official catalog",
  noOrKeyHint:
    "OPENROUTER_API_KEY is not set. Add it to .env and restart to sync the :free catalog online; cached catalogs remain readable.",
  searchPlaceholder: "Search id / name / description…",
  modalityAll: "All modalities",
  modalityText: "Text only",
  modalityMulti: "Multimodal",
  sortCtxDesc: "Context ↓",
  sortCtxAsc: "Context ↑",
  sortName: "Name",
  emptyOrTitle: "No :free models",
  emptyOrDescHasKey: "Click “Refresh now” to pull from OpenRouter.",
  emptyOrDescNoKey: "Set OPENROUTER_API_KEY, then refresh.",
  multimodal: "Multimodal",
  freeBadge: "Free",
  ctxLabel: "ctx",
  modalityTextToText: "text→text",
  expand: "Show more",
  collapse: "Show less",
  copyId: "Copy id",
  copied: "Copied",
  copyTitle: "Copy model id",
  freellmTitle: "Freellm gateway",
  freellmSubtitle: "Validated credentials · keys never shown",
  emptyFreellmTitle: "No freellm channels",
  emptyFreellmDesc: "Sync on startup or click “Refresh now” to pull and validate from GitHub / local README.",
  validated: "Validated",
  budget: "Budget",
  rateLimit: "Rate limit",
  expires: "Expires",
  summaryTitle: "Free models",
  summaryLoading: "Loading…",
  summaryViewAll: "View all →",
};

export type FreeModelsMessages = typeof zh;

export function freeModelsMessages(locale: FreeModelsLocale): FreeModelsMessages {
  return locale === "en" ? en : zh;
}

/** OpenRouter 厂商 slug → 展示名（品牌；未收录则原样） */
const PUBLISHER_LABEL: Record<FreeModelsLocale, Record<string, string>> = {
  zh: {
    nvidia: "英伟达",
    google: "谷歌",
    meta: "Meta",
    openai: "OpenAI",
    anthropic: "Anthropic",
    qwen: "通义千问",
    deepseek: "DeepSeek",
    mistralai: "Mistral",
    microsoft: "微软",
    amazon: "亚马逊",
    cohere: "Cohere",
    "x-ai": "xAI",
    moonshotai: "月之暗面",
    zhipu: "智谱",
    "01-ai": "零一万物",
    baidu: "百度",
    tencent: "腾讯",
    alibaba: "阿里巴巴",
    bytedance: "字节跳动",
    freellm: "Freellm",
    openrouter: "OpenRouter",
  },
  en: {
    nvidia: "NVIDIA",
    google: "Google",
    meta: "Meta",
    openai: "OpenAI",
    anthropic: "Anthropic",
    qwen: "Qwen",
    deepseek: "DeepSeek",
    mistralai: "Mistral",
    microsoft: "Microsoft",
    amazon: "Amazon",
    cohere: "Cohere",
    "x-ai": "xAI",
    moonshotai: "Moonshot",
    zhipu: "Zhipu",
    "01-ai": "01.AI",
    baidu: "Baidu",
    tencent: "Tencent",
    alibaba: "Alibaba",
    bytedance: "ByteDance",
    freellm: "Freellm",
    openrouter: "OpenRouter",
  },
};

export function formatPublisherLabel(slug: string | undefined | null, locale: FreeModelsLocale): string {
  if (!slug || slug === "—") return "—";
  const key = slug.trim().toLowerCase();
  return PUBLISHER_LABEL[locale][key] ?? slug;
}

export function formatModalityLabel(
  modality: string | undefined,
  locale: FreeModelsLocale,
): string {
  const t = freeModelsMessages(locale);
  if (!modality || modality === "text" || modality === "text->text" || modality === "text→text") {
    return t.modalityTextToText;
  }
  return modality.replace("->", "→");
}

export function formatContextPill(
  contextLength: number | undefined,
  locale: FreeModelsLocale,
  formatContext: (n?: number) => string,
): string {
  const t = freeModelsMessages(locale);
  return `${formatContext(contextLength)} ${t.ctxLabel}`;
}
