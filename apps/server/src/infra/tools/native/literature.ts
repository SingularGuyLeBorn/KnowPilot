/**
 * 文献检索域 — OpenAlex / arXiv / Semantic Scholar
 *
 * 创作场景：写文章前找论文、对 DOI/arXiv id 拉摘要与元数据。
 * 零强制付费 key：OpenAlex/arXiv 免费；Semantic Scholar 可选 SEMANTIC_SCHOLAR_API_KEY 提高限额。
 */
import type { NativeToolContext, NativeToolDefinition, NativeToolHandler } from "./types.js";
import { getCredentialValue } from "../../credentialVault.js";
import { registerNativeDomain } from "./registerDomain.js";

export type LiteratureSource = "openalex" | "arxiv" | "semantic_scholar";

export type LiteraturePaper = {
  source: LiteratureSource;
  id: string;
  title: string;
  abstract?: string;
  authors: string[];
  year?: number;
  doi?: string;
  arxivId?: string;
  url?: string;
  citationCount?: number;
  venue?: string;
};

function readEnv(name: string, fallback = ""): string {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback;
}

function mailtoContact(): string {
  return readEnv("OPENALEX_MAILTO", readEnv("LITERATURE_CONTACT_EMAIL", "knowpilot@local"));
}

async function semanticScholarKey(ctx: NativeToolContext): Promise<string | undefined> {
  const fromDb = ctx.prisma
    ? await getCredentialValue(ctx.prisma, "semantic_scholar", "api_key")
    : undefined;
  return (fromDb && fromDb.trim()) || readEnv("SEMANTIC_SCHOLAR_API_KEY") || undefined;
}

function clampInt(n: unknown, def: number, min: number, max: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return def;
  return Math.min(max, Math.max(min, Math.floor(v)));
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeDoi(raw: string): string | undefined {
  const s = raw.trim();
  if (!s) return undefined;
  const m = s.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i);
  return m ? m[0] : undefined;
}

function normalizeArxivId(raw: string): string | undefined {
  const s = raw.trim().replace(/^arxiv:/i, "");
  if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(s)) return s.replace(/v\d+$/, "");
  if (/^[a-z-]+\/\d{7}(v\d+)?$/i.test(s)) return s.replace(/v\d+$/, "");
  return undefined;
}

async function fetchJson(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": `KnowPilot/1.0 (mailto:${mailtoContact()})`,
      Accept: "application/json",
      ...headers,
    },
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { ok: res.ok, status: res.status, json, text };
}

/** OpenAlex works search */
export async function searchOpenAlex(query: string, maxResults: number): Promise<LiteraturePaper[]> {
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", query);
  url.searchParams.set("per_page", String(maxResults));
  url.searchParams.set("mailto", mailtoContact());
  const { ok, status, json, text } = await fetchJson(url.toString());
  if (!ok) throw new Error(`OpenAlex 搜索失败 ${status}: ${text.slice(0, 300)}`);
  const results = (json as { results?: unknown[] })?.results ?? [];
  return results.map((w): LiteraturePaper => {
    const work = w as Record<string, unknown>;
    const ids = (work.ids as Record<string, string> | undefined) || {};
    const authorships = (work.authorships as Array<{ author?: { display_name?: string } }>) || [];
    const doi = normalizeDoi(String(ids.doi || work.doi || ""));
    const primary = work.primary_location as { source?: { display_name?: string }; landing_page_url?: string } | null;
    return {
      source: "openalex",
      id: String(work.id || ids.openalex || ""),
      title: String(work.title || work.display_name || "(untitled)"),
      abstract: typeof work.abstract_inverted_index === "object"
        ? invertAbstract(work.abstract_inverted_index as Record<string, number[]>)
        : undefined,
      authors: authorships.map((a) => a.author?.display_name || "").filter(Boolean),
      year: typeof work.publication_year === "number" ? work.publication_year : undefined,
      doi,
      url: ids.doi || primary?.landing_page_url || String(work.id || ""),
      citationCount: typeof work.cited_by_count === "number" ? work.cited_by_count : undefined,
      venue: primary?.source?.display_name,
    };
  });
}

/** OpenAlex stores abstract as inverted index */
function invertAbstract(index: Record<string, number[]>): string | undefined {
  const pairs: Array<{ word: string; pos: number }> = [];
  for (const [word, positions] of Object.entries(index || {})) {
    for (const pos of positions) pairs.push({ word, pos });
  }
  if (!pairs.length) return undefined;
  pairs.sort((a, b) => a.pos - b.pos);
  return pairs.map((p) => p.word).join(" ");
}

/** arXiv Atom API */
export async function searchArxiv(query: string, maxResults: number): Promise<LiteraturePaper[]> {
  const url = new URL("http://export.arxiv.org/api/query");
  url.searchParams.set("search_query", `all:${query}`);
  url.searchParams.set("start", "0");
  url.searchParams.set("max_results", String(maxResults));
  url.searchParams.set("sortBy", "relevance");
  url.searchParams.set("sortOrder", "descending");
  const res = await fetch(url.toString(), {
    headers: { "User-Agent": `KnowPilot/1.0 (mailto:${mailtoContact()})` },
  });
  const xml = await res.text();
  if (!res.ok) throw new Error(`arXiv 搜索失败 ${res.status}: ${xml.slice(0, 300)}`);
  return parseArxivAtom(xml);
}

export function parseArxivAtom(xml: string): LiteraturePaper[] {
  const entries = xml.split(/<entry>/i).slice(1);
  const out: LiteraturePaper[] = [];
  for (const chunk of entries) {
    const entry = chunk.split(/<\/entry>/i)[0] || "";
    const title = stripHtml(pickTag(entry, "title") || "");
    const summary = stripHtml(pickTag(entry, "summary") || "");
    const idUrl = pickTag(entry, "id") || "";
    const arxivId = normalizeArxivId(idUrl.replace(/.*\/abs\//, "")) || idUrl;
    const published = pickTag(entry, "published") || "";
    const year = published ? Number(published.slice(0, 4)) : undefined;
    const authors = [...entry.matchAll(/<name>([^<]+)<\/name>/gi)].map((m) => m[1]!.trim());
    const doi =
      normalizeDoi(pickTag(entry, "arxiv:doi") || "") ||
      normalizeDoi((entry.match(/doi\.org\/([^\s<]+)/i) || [])[1] || "");
    out.push({
      source: "arxiv",
      id: arxivId || idUrl,
      title: title || "(untitled)",
      abstract: summary || undefined,
      authors,
      year: Number.isFinite(year) ? year : undefined,
      doi,
      arxivId: arxivId || undefined,
      url: arxivId ? `https://arxiv.org/abs/${arxivId}` : idUrl,
      venue: "arXiv",
    });
  }
  return out;
}

function pickTag(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = xml.match(re);
  return m?.[1]?.trim();
}

/** Semantic Scholar Graph API */
export async function searchSemanticScholar(
  query: string,
  maxResults: number,
  apiKey?: string,
): Promise<LiteraturePaper[]> {
  const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
  url.searchParams.set("query", query);
  url.searchParams.set("limit", String(maxResults));
  url.searchParams.set(
    "fields",
    "paperId,title,abstract,year,authors,externalIds,url,citationCount,venue",
  );
  const headers: Record<string, string> = {};
  if (apiKey) headers["x-api-key"] = apiKey;
  const { ok, status, json, text } = await fetchJson(url.toString(), headers);
  if (!ok) throw new Error(`Semantic Scholar 搜索失败 ${status}: ${text.slice(0, 300)}`);
  const data = (json as { data?: unknown[] })?.data ?? [];
  return data.map((p): LiteraturePaper => {
    const paper = p as Record<string, unknown>;
    const ext = (paper.externalIds as Record<string, string> | undefined) || {};
    const authors = ((paper.authors as Array<{ name?: string }>) || [])
      .map((a) => a.name || "")
      .filter(Boolean);
    return {
      source: "semantic_scholar",
      id: String(paper.paperId || ""),
      title: String(paper.title || "(untitled)"),
      abstract: typeof paper.abstract === "string" ? paper.abstract : undefined,
      authors,
      year: typeof paper.year === "number" ? paper.year : undefined,
      doi: normalizeDoi(ext.DOI || ""),
      arxivId: normalizeArxivId(ext.ArXiv || "") || undefined,
      url: typeof paper.url === "string" ? paper.url : undefined,
      citationCount: typeof paper.citationCount === "number" ? paper.citationCount : undefined,
      venue: typeof paper.venue === "string" ? paper.venue : undefined,
    };
  });
}

async function literatureSearch(args: Record<string, unknown>, ctx: NativeToolContext) {
  const query = String(args.query ?? "").trim();
  if (!query) throw new Error("需要 query（检索关键词或短语）");
  const maxResults = clampInt(args.maxResults, 5, 1, 25);
  const sourceRaw = String(args.source ?? "all").trim().toLowerCase();
  const sources: LiteratureSource[] =
    sourceRaw === "all" || !sourceRaw
      ? ["openalex", "arxiv", "semantic_scholar"]
      : sourceRaw === "openalex" || sourceRaw === "arxiv" || sourceRaw === "semantic_scholar"
        ? [sourceRaw]
        : (() => {
            throw new Error("source 须为 openalex | arxiv | semantic_scholar | all");
          })();

  const s2Key = sources.includes("semantic_scholar") ? await semanticScholarKey(ctx) : undefined;
  const errors: string[] = [];
  const papers: LiteraturePaper[] = [];

  for (const src of sources) {
    try {
      if (src === "openalex") papers.push(...(await searchOpenAlex(query, maxResults)));
      else if (src === "arxiv") papers.push(...(await searchArxiv(query, maxResults)));
      else papers.push(...(await searchSemanticScholar(query, maxResults, s2Key)));
    } catch (e) {
      errors.push(`${src}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 按 title 粗去重，保留引用更高者
  const byTitle = new Map<string, LiteraturePaper>();
  for (const p of papers) {
    const key = p.title.toLowerCase().replace(/\s+/g, " ").trim();
    const prev = byTitle.get(key);
    if (!prev || (p.citationCount || 0) > (prev.citationCount || 0)) byTitle.set(key, p);
  }
  const items = [...byTitle.values()].slice(0, maxResults * (sources.length > 1 ? 2 : 1));

  return {
    query,
    sources,
    count: items.length,
    items,
    errors: errors.length ? errors : undefined,
    hint: "需要全文时：有 DOI/arXiv 用 literature_get；PDF 落盘后用 document_to_markdown。写作流程可 skill_view deep-research。",
  };
}

async function literatureGet(args: Record<string, unknown>, ctx: NativeToolContext) {
  const id = String(args.id ?? "").trim();
  if (!id) throw new Error("需要 id（DOI / arXiv id / OpenAlex URL / Semantic Scholar paperId）");

  const doi = normalizeDoi(id);
  const arxivId = normalizeArxivId(id);

  // arXiv
  if (arxivId && !doi) {
    const url = new URL("http://export.arxiv.org/api/query");
    url.searchParams.set("id_list", arxivId);
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": `KnowPilot/1.0 (mailto:${mailtoContact()})` },
    });
    const xml = await res.text();
    if (!res.ok) throw new Error(`arXiv get 失败 ${res.status}`);
    const items = parseArxivAtom(xml);
    if (!items.length) throw new Error(`arXiv 未找到: ${arxivId}`);
    return { paper: items[0] };
  }

  // OpenAlex by DOI
  if (doi) {
    const url = `https://api.openalex.org/works/https://doi.org/${doi}?mailto=${encodeURIComponent(mailtoContact())}`;
    const { ok, status, json, text } = await fetchJson(url);
    if (ok && json && typeof json === "object") {
      const work = json as Record<string, unknown>;
      const ids = (work.ids as Record<string, string> | undefined) || {};
      const authorships = (work.authorships as Array<{ author?: { display_name?: string } }>) || [];
      return {
        paper: {
          source: "openalex" as const,
          id: String(work.id || ""),
          title: String(work.title || work.display_name || "(untitled)"),
          abstract:
            typeof work.abstract_inverted_index === "object"
              ? invertAbstract(work.abstract_inverted_index as Record<string, number[]>)
              : undefined,
          authors: authorships.map((a) => a.author?.display_name || "").filter(Boolean),
          year: typeof work.publication_year === "number" ? work.publication_year : undefined,
          doi,
          url: ids.doi || String(work.id || ""),
          citationCount: typeof work.cited_by_count === "number" ? work.cited_by_count : undefined,
        } satisfies LiteraturePaper,
      };
    }
    // fall through to S2
    if (!ok && status !== 404) {
      /* try S2 */
    } else if (!ok) {
      /* try S2 */
    }
  }

  // Semantic Scholar by paperId / DOI / arXiv
  const s2Key = await semanticScholarKey(ctx);
  const s2Id = doi ? `DOI:${doi}` : arxivId ? `ARXIV:${arxivId}` : id;
  const s2Url = new URL(
    `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(s2Id)}`,
  );
  s2Url.searchParams.set(
    "fields",
    "paperId,title,abstract,year,authors,externalIds,url,citationCount,venue,tldr",
  );
  const headers: Record<string, string> = {};
  if (s2Key) headers["x-api-key"] = s2Key;
  const { ok, status, json, text } = await fetchJson(s2Url.toString(), headers);
  if (!ok) throw new Error(`文献获取失败 ${status}: ${text.slice(0, 400)}`);
  const paper = json as Record<string, unknown>;
  const ext = (paper.externalIds as Record<string, string> | undefined) || {};
  const tldr = paper.tldr as { text?: string } | undefined;
  return {
    paper: {
      source: "semantic_scholar" as const,
      id: String(paper.paperId || ""),
      title: String(paper.title || "(untitled)"),
      abstract:
        (typeof paper.abstract === "string" && paper.abstract) ||
        tldr?.text ||
        undefined,
      authors: ((paper.authors as Array<{ name?: string }>) || [])
        .map((a) => a.name || "")
        .filter(Boolean),
      year: typeof paper.year === "number" ? paper.year : undefined,
      doi: normalizeDoi(ext.DOI || doi || ""),
      arxivId: normalizeArxivId(ext.ArXiv || arxivId || "") || undefined,
      url: typeof paper.url === "string" ? paper.url : undefined,
      citationCount: typeof paper.citationCount === "number" ? paper.citationCount : undefined,
      venue: typeof paper.venue === "string" ? paper.venue : undefined,
    } satisfies LiteraturePaper,
  };
}

const LITERATURE_DEFS: NativeToolDefinition[] = [
  {
    name: "literature_search",
    concurrencyClass: "B",
    description:
      "学术文献检索（OpenAlex / arXiv / Semantic Scholar）。创作前找论文、对比观点、收集引用用。source=all 时并行查三源并按标题去重。返回 title/abstract/authors/year/doi/arxivId/citationCount。需要单篇详情用 literature_get；PDF 转文用 document_to_markdown。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "检索关键词或短语" },
        source: {
          type: "string",
          description: "openalex | arxiv | semantic_scholar | all（默认 all）",
        },
        maxResults: { type: "number", description: "每源最多条数，默认 5，上限 25" },
      },
      required: ["query"],
    },
  },
  {
    name: "literature_get",
    concurrencyClass: "B",
    description:
      "按标识符取单篇文献元数据与摘要。支持 DOI（10.xxxx/...）、arXiv id（2301.12345）、OpenAlex/Semantic Scholar paper id。",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "DOI / arXiv id / paper id" },
      },
      required: ["id"],
    },
  },
];

const LITERATURE_HANDLERS: Record<string, NativeToolHandler> = {
  literature_search: literatureSearch,
  literature_get: literatureGet,
};

export function registerLiteratureTools(): void {
  registerNativeDomain(LITERATURE_DEFS, LITERATURE_HANDLERS);
}
