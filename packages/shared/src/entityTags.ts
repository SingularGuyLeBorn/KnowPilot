/**
 * 跨实体统一标签约定（Post / Skill / Memory / Prompt / InfoSource / Inbox）
 *
 * - 存储：DB 列为逗号分隔 CSV（与现有 Post/Prompt 一致）
 * - API：一律 string[]
 * - keywords（Memory）≠ tags：keywords 负责检索召回，tags 负责组织与优先级
 * - 「非常有用」「必装」为高价值约定标签，列表可置顶
 * - 写入时经同义词归并（canonicalize），避免 useful / 很有用 分叉
 */

/** 高价值约定标签（展示置顶 / skills_list.useful） */
export const HIGH_VALUE_TAGS = ["非常有用", "必装"] as const;

export type HighValueTag = (typeof HIGH_VALUE_TAGS)[number];

/**
 * 官方建议词表（输入建议 + 跨实体浏览优先展示）。
 * 允许自由标签；此处只做引导，不硬拦。
 */
export const SUGGESTED_TAGS = [
  ...HIGH_VALUE_TAGS,
  "CS329A",
  "自改进Agent",
  "Agent设计",
  "Harness",
  "长程控制",
  "审计评测",
  "偏好",
  "教程",
  "论文",
  "工具",
  "模板",
] as const;

/** 同义词 → 规范标签（小写键；中文原样） */
const TAG_SYNONYMS: Record<string, string> = {
  useful: "非常有用",
  "very useful": "非常有用",
  很有用: "非常有用",
  超有用: "非常有用",
  高价值: "非常有用",
  "must install": "必装",
  "must-install": "必装",
  mustinstall: "必装",
  必备: "必装",
  推荐安装: "必装",
};

/** Inbox 平台噪音标签：不进跨实体 facets / 建议 */
export const INBOX_NOISE_TAGS = new Set([
  "like",
  "favorite",
  "fav",
  "toview",
  "watchlater",
  "history",
]);

export type TagEntityKind =
  | "post"
  | "skill"
  | "memory"
  | "prompt"
  | "infoSource"
  | "inbox";

/** 规范化单个标签：去空白、同义词归并、压长度 */
export function normalizeTag(raw: unknown, maxLen = 40): string | null {
  if (raw == null) return null;
  const t = String(raw).trim().replace(/\s+/g, " ");
  if (!t) return null;
  const key = t.toLowerCase();
  const canon = TAG_SYNONYMS[key] ?? TAG_SYNONYMS[t] ?? t;
  return canon.slice(0, maxLen);
}

/** 任意输入 → 去重后的 tags 数组（已 canonicalize） */
export function parseTags(input: unknown, max = 20): string[] {
  let parts: unknown[] = [];
  if (Array.isArray(input)) {
    parts = input;
  } else if (typeof input === "string") {
    parts = input.split(/[,，\n]+/);
  } else if (input != null) {
    parts = [input];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const t = normalizeTag(p);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** string[] → DB CSV */
export function formatTagsCsv(tags: string[] | undefined | null): string {
  return parseTags(tags ?? []).join(",");
}

/** list 筛选入参：同义词归并后的单一标签；空则 undefined */
export function canonicalListTag(raw: string | undefined | null): string | undefined {
  if (raw == null || !String(raw).trim()) return undefined;
  return parseTags(raw)[0];
}

/** DB CSV / 任意 → string[]（formatEntity 用） */
export function tagsFromCsv(raw: string | null | undefined): string[] {
  return parseTags(raw ?? "");
}

export function isHighValueTag(tag: string): boolean {
  return (HIGH_VALUE_TAGS as readonly string[]).includes(tag);
}

export function hasHighValueTag(tags: string[] | undefined | null): boolean {
  return (tags ?? []).some(isHighValueTag);
}

/** 高价值优先，再按名称 */
export function compareByHighValueTags<T>(
  a: T,
  b: T,
  getTags: (x: T) => string[] | undefined | null,
  getName?: (x: T) => string,
): number {
  const ah = hasHighValueTag(getTags(a)) ? 0 : 1;
  const bh = hasHighValueTag(getTags(b)) ? 0 : 1;
  if (ah !== bh) return ah - bh;
  if (getName) return getName(a).localeCompare(getName(b), "zh");
  return 0;
}

/** FTS body 片段 */
export function tagsForFts(tags: string[] | string | null | undefined): string {
  const list = typeof tags === "string" ? tagsFromCsv(tags) : parseTags(tags ?? []);
  return list.length ? `tags:${list.join(" ")}` : "";
}

/** 输入建议：官方词表 + 可选语料，排除已选与噪音 */
export function suggestTags(
  query: string,
  selected: string[] = [],
  corpus: string[] = [],
  limit = 12,
): string[] {
  const q = query.trim().toLowerCase();
  const selectedSet = new Set(parseTags(selected));
  const pool = new Set<string>([
    ...SUGGESTED_TAGS,
    ...corpus.flatMap((t) => parseTags(t)),
  ]);
  const scored: string[] = [];
  for (const tag of pool) {
    if (selectedSet.has(tag) || INBOX_NOISE_TAGS.has(tag.toLowerCase())) continue;
    if (!q || tag.toLowerCase().includes(q) || tag.includes(query.trim())) {
      scored.push(tag);
    }
  }
  scored.sort((a, b) => {
    const ah = isHighValueTag(a) ? 0 : 1;
    const bh = isHighValueTag(b) ? 0 : 1;
    if (ah !== bh) return ah - bh;
    return a.localeCompare(b, "zh");
  });
  return scored.slice(0, limit);
}

export interface TagFacet {
  tag: string;
  count: number;
  highValue: boolean;
}

/** 从实体 tags 列表聚合 facets */
export function buildTagFacets(
  rows: Array<{ tags?: string[] | string | null }>,
  opts?: { excludeNoise?: boolean; limit?: number },
): TagFacet[] {
  const excludeNoise = opts?.excludeNoise !== false;
  const limit = opts?.limit ?? 80;
  const counts = new Map<string, number>();
  for (const row of rows) {
    const tags =
      typeof row.tags === "string" ? tagsFromCsv(row.tags) : parseTags(row.tags ?? []);
    for (const tag of tags) {
      if (excludeNoise && INBOX_NOISE_TAGS.has(tag.toLowerCase())) continue;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count, highValue: isHighValueTag(tag) }))
    .sort((a, b) => {
      if (a.highValue !== b.highValue) return a.highValue ? -1 : 1;
      if (b.count !== a.count) return b.count - a.count;
      return a.tag.localeCompare(b.tag, "zh");
    })
    .slice(0, limit);
}
