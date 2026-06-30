/**
 * 搜索结果相关性评分 — 低质量/跑题结果触发路由器 fallback 下一引擎
 */

import type { SearchResult } from "./types.js";

/** 从查询中提取拉丁词与中文片段 */
export function extractQueryTerms(query: string): string[] {
  const terms: string[] = [];
  const q = query.trim();
  if (!q) return terms;

  for (const m of q.matchAll(/[a-zA-Z][a-zA-Z0-9_.-]*/g)) {
    const t = m[0].toLowerCase();
    if (t.length >= 2) terms.push(t);
  }
  for (const m of q.matchAll(/[\u4e00-\u9fff]{2,}/g)) {
    terms.push(m[0]);
  }

  return [...new Set(terms)];
}

export function scoreResultRelevance(query: string, result: SearchResult): number {
  const terms = extractQueryTerms(query);
  if (terms.length === 0) return 1;

  const haystack = `${result.title} ${result.snippet} ${result.url}`.toLowerCase();
  let score = 0;

  for (const term of terms) {
    const needle = term.toLowerCase();
    if (haystack.includes(needle)) {
      score += needle.length >= 5 ? 4 : needle.length >= 3 ? 3 : 2;
    }
  }

  return score;
}

/** 过滤无关结果；若全部跑题则返回空数组，由上层 fallback */
export function filterRelevantResults(query: string, results: SearchResult[]): SearchResult[] {
  if (results.length === 0) return [];

  const terms = extractQueryTerms(query);
  if (terms.length === 0) return results;

  const minScore = 2;
  const scored = results
    .map((r) => ({ r, score: scoreResultRelevance(query, r) }))
    .filter((x) => x.score >= minScore)
    .sort((a, b) => b.score - a.score);

  return scored.map((x) => x.r);
}
