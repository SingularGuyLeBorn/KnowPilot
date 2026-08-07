/**
 * 零模型关键信息狙击：按关键词/正则在原文中定位命中点，保留前后上下文窗口。
 * 产出写入厚 metadata（hitOffsets / recommendedRead）；正文不回灌主 LLM。
 */

export type HitSpan = {
  start: number;
  end: number;
  keyword: string;
  context: string;
};

export type KeyInfoExtractOpts = {
  /** 命中点前后各保留字符数 */
  contextWindow?: number;
  /** 是否合并重叠/相邻窗口 */
  mergeOverlap?: boolean;
  /** 合并时允许的最大间隔（字符） */
  mergeGap?: number;
};

const DEFAULTS = {
  contextWindow: 400,
  mergeOverlap: true,
  mergeGap: 100,
} as const;

function findWordBoundary(text: string, pos: number, direction: "left" | "right"): number {
  const marks = " \n\r\t。，；！？、.,;!?:\"'`";
  if (direction === "right") {
    for (let i = pos; i < Math.min(pos + 24, text.length); i++) {
      if (marks.includes(text[i]!)) return i + 1;
    }
    return pos;
  }
  for (let i = pos; i > Math.max(pos - 24, 0); i--) {
    if (marks.includes(text[i]!)) return i + 1;
  }
  return pos;
}

function createSpan(
  text: string,
  hitStart: number,
  hitLen: number,
  keyword: string,
  contextWindow: number,
): HitSpan {
  const textLen = text.length;
  let ctxStart = Math.max(0, hitStart - contextWindow);
  let ctxEnd = Math.min(textLen, hitStart + hitLen + contextWindow);
  ctxStart = findWordBoundary(text, ctxStart, "right");
  ctxEnd = findWordBoundary(text, ctxEnd, "left");
  if (ctxStart >= ctxEnd) {
    ctxStart = Math.max(0, hitStart - contextWindow);
    ctxEnd = Math.min(textLen, hitStart + hitLen + contextWindow);
  }
  return {
    start: ctxStart,
    end: ctxEnd,
    keyword,
    context: text.slice(ctxStart, ctxEnd),
  };
}

function deduplicate(hits: HitSpan[]): HitSpan[] {
  if (hits.length === 0) return hits;
  const sorted = [...hits].sort((a, b) => a.start - b.start || b.end - a.end - (a.end - a.start));
  const filtered: HitSpan[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const h = sorted[i]!;
    const last = filtered[filtered.length - 1]!;
    if (h.start >= last.start && h.end <= last.end) continue;
    filtered.push(h);
  }
  return filtered;
}

function mergeSpans(hits: HitSpan[], text: string, mergeGap: number): HitSpan[] {
  if (hits.length === 0) return hits;
  const sorted = [...hits].sort((a, b) => a.start - b.start);
  const merged: HitSpan[] = [
    {
      ...sorted[0]!,
      keyword: sorted[0]!.keyword,
    },
  ];
  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i]!;
    const last = merged[merged.length - 1]!;
    if (current.start <= last.end + mergeGap) {
      last.end = Math.max(last.end, current.end);
      last.context = text.slice(last.start, last.end);
      if (!last.keyword.split(", ").includes(current.keyword)) {
        last.keyword = `${last.keyword}, ${current.keyword}`;
      }
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

/** 从原文提取命中片段（不生成摘要字符串） */
export function extractKeyInfoSpans(
  text: string,
  keywords: string[] = [],
  patterns: string[] = [],
  opts: KeyInfoExtractOpts = {},
): HitSpan[] {
  const contextWindow = opts.contextWindow ?? DEFAULTS.contextWindow;
  const mergeOverlap = opts.mergeOverlap ?? DEFAULTS.mergeOverlap;
  const mergeGap = opts.mergeGap ?? DEFAULTS.mergeGap;

  const hits: HitSpan[] = [];
  const textLower = text.toLowerCase();

  for (const kw of keywords) {
    const trimmed = kw.trim();
    if (!trimmed) continue;
    const kwLower = trimmed.toLowerCase();
    let start = 0;
    while (true) {
      const idx = textLower.indexOf(kwLower, start);
      if (idx === -1) break;
      hits.push(createSpan(text, idx, trimmed.length, trimmed, contextWindow));
      start = idx + Math.max(1, trimmed.length);
    }
  }

  for (const pat of patterns) {
    if (!pat.trim()) continue;
    try {
      const re = new RegExp(pat, "gi");
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        hits.push(createSpan(text, m.index, m[0].length, `regex:${pat}`, contextWindow));
        if (m[0].length === 0) re.lastIndex++;
      }
    } catch {
      // 非法正则忽略
    }
  }

  let result = deduplicate(hits);
  if (mergeOverlap) result = mergeSpans(result, text, mergeGap);
  result.sort((a, b) => a.start - b.start);
  return result;
}

/** 从工具入参自动推导期望关键词（无显式 expect 时的兜底） */
export function deriveExpectKeywordsFromArgs(args: Record<string, unknown>): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    const t = s.trim();
    if (t.length >= 2 && t.length <= 80) out.push(t);
  };

  for (const key of ["expect_keywords", "expectKeywords", "expect"]) {
    const v = args[key];
    if (Array.isArray(v)) {
      for (const item of v) if (typeof item === "string") push(item);
    } else if (typeof v === "string" && v.trim()) {
      for (const part of v.split(/[,，;；|/]/)) push(part);
    }
  }

  if (out.length > 0) return dedupeKeywords(out);

  for (const key of ["query", "q", "keyword", "keywords", "search", "topic", "title"]) {
    const v = args[key];
    if (typeof v === "string" && v.trim()) {
      // 整句 query 本身作为关键词 + 拆出较长词元
      push(v);
      for (const tok of v.split(/[\s,，;；|/]+/)) {
        if (tok.length >= 3) push(tok);
      }
    } else if (Array.isArray(v)) {
      for (const item of v) if (typeof item === "string") push(item);
    }
  }

  return dedupeKeywords(out).slice(0, 12);
}

function dedupeKeywords(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of list) {
    const key = k.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(k);
  }
  return out;
}

/** 从工具 args 取出 expect 控制参数（不参与工具业务逻辑） */
export function peelExpectControls(args: Record<string, unknown>): {
  keywords: string[];
  patterns: string[];
  contextWindow?: number;
  cleanArgs: Record<string, unknown>;
} {
  const cleanArgs = { ...args };
  const keywords = deriveExpectKeywordsFromArgs(args);

  let patterns: string[] = [];
  for (const key of ["expect_patterns", "expectPatterns"]) {
    const v = args[key];
    if (Array.isArray(v)) {
      patterns = v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
    } else if (typeof v === "string" && v.trim()) {
      patterns = [v.trim()];
    }
  }

  let contextWindow: number | undefined;
  for (const key of ["expect_context_chars", "expectContextChars", "context_window"]) {
    const v = args[key];
    if (typeof v === "number" && Number.isFinite(v)) {
      contextWindow = Math.max(50, Math.min(4000, Math.floor(v)));
    } else if (typeof v === "string" && /^\d+$/.test(v.trim())) {
      contextWindow = Math.max(50, Math.min(4000, parseInt(v.trim(), 10)));
    }
  }

  for (const key of [
    "expect_keywords",
    "expectKeywords",
    "expect",
    "expect_patterns",
    "expectPatterns",
    "expect_context_chars",
    "expectContextChars",
    "context_window",
  ]) {
    delete cleanArgs[key];
  }

  return { keywords, patterns, contextWindow, cleanArgs };
}

/** 注入到所有工具 JSON Schema 的通用 expect 参数 */
export const TOOL_EXPECT_SCHEMA_PROPS: Record<string, unknown> = {
  expect_keywords: {
    type: "array",
    items: { type: "string" },
    description:
      "可选。你期望在工具结果中看到的关键信息（3–8 个词/短语）。系统会只保留命中点前后上下文给你，完整结果落盘可按需 read_file。",
  },
  expect_patterns: {
    type: "array",
    items: { type: "string" },
    description: "可选。正则表达式列表，用于在结果中定位关键片段（如版本号、百分比）。",
  },
  expect_context_chars: {
    type: "integer",
    description: "可选。每个命中点前后各保留的字符数（默认约 400，范围 50–4000）。",
  },
};

export function injectExpectPropsIntoParameters(
  parameters: Record<string, unknown>,
): Record<string, unknown> {
  const params = { ...parameters };
  const props =
    params.properties && typeof params.properties === "object" && !Array.isArray(params.properties)
      ? { ...(params.properties as Record<string, unknown>) }
      : {};
  for (const [k, v] of Object.entries(TOOL_EXPECT_SCHEMA_PROPS)) {
    if (props[k] == null) props[k] = v;
  }
  params.properties = props;
  if (params.type == null) params.type = "object";
  return params;
}
