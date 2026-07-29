/**
 * 学术 / 模型库爬虫（从 MetaBlog academic + HF Hub API 移植）
 * - arXiv Atom API（免费，约 3s/次限流）
 * - HuggingFace Hub REST API（无需 key；trending 走 API 而非 HTML 抓取）
 */
import type { NativeToolDefinition, NativeToolHandler } from "../types.js";

const FETCH_TIMEOUT_MS = 25_000;

/** HuggingFace Hub 基址；国内可设 HF_ENDPOINT=https://hf-mirror.com */
function hfBase(): string {
  const raw = (process.env.HF_ENDPOINT || "https://huggingface.co").trim().replace(/\/+$/, "");
  return raw || "https://huggingface.co";
}

async function fetchText(url: string, headers?: Record<string, string>): Promise<Response> {
  try {
    return await fetch(url, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const cause =
      err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : "";
    throw new Error(`网络请求失败: ${msg}${cause}。URL=${url.slice(0, 120)}；国内访问 HuggingFace 可设环境变量 HF_ENDPOINT=https://hf-mirror.com`);
  }
}

// ─── arXiv ───────────────────────────────────────────────────────────────────

interface ArxivPaper {
  id: string;
  title: string;
  authors: string[];
  summary: string;
  published: string;
  pdfUrl: string;
  absUrl: string;
  primaryCategory: string;
}

function cleanXmlText(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function parseArxivXml(xml: string): ArxivPaper[] {
  const papers: ArxivPaper[] = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match: RegExpExecArray | null;
  while ((match = entryRegex.exec(xml)) !== null) {
    const entry = match[1];
    const idMatch = entry.match(/<id>(.*?)<\/id>/);
    const titleMatch = entry.match(/<title>([\s\S]*?)<\/title>/);
    const summaryMatch = entry.match(/<summary>([\s\S]*?)<\/summary>/);
    const publishedMatch = entry.match(/<published>(.*?)<\/published>/);

    const authors: string[] = [];
    const authorRegex = /<author>\s*<name>(.*?)<\/name>\s*<\/author>/g;
    let authorMatch: RegExpExecArray | null;
    while ((authorMatch = authorRegex.exec(entry)) !== null) {
      authors.push(authorMatch[1].trim());
    }

    const categories: string[] = [];
    const catRegex = /<category term="(.*?)"/g;
    let catMatch: RegExpExecArray | null;
    while ((catMatch = catRegex.exec(entry)) !== null) {
      categories.push(catMatch[1]);
    }

    const arxivId =
      idMatch?.[1]
        .split("/")
        .pop()
        ?.replace("abs/", "")
        .replace(/v\d+$/, "") || "";

    if (arxivId && titleMatch) {
      papers.push({
        id: arxivId,
        title: cleanXmlText(titleMatch[1]),
        authors,
        summary: cleanXmlText(summaryMatch ? summaryMatch[1] : ""),
        published: publishedMatch ? publishedMatch[1] : "",
        pdfUrl: `https://arxiv.org/pdf/${arxivId}.pdf`,
        absUrl: `https://arxiv.org/abs/${arxivId}`,
        primaryCategory: categories[0] || "",
      });
    }
  }
  return papers;
}

function normalizeArxivId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/arxiv\.org\/(abs|pdf)\//, "")
    .replace(/\.pdf$/, "")
    .replace(/v\d+$/, "");
}

async function searchArxiv(args: Record<string, unknown>): Promise<unknown> {
  const query = String(args.query ?? "").trim();
  if (!query) throw new Error('需要 query 参数。示例: search_arxiv({ query: "transformer" })');
  const category = String(args.category ?? "").trim();
  const maxResults = Math.min(Math.max(1, Number(args.maxResults ?? 5) || 5), 50);
  const sortBy = ["relevance", "lastUpdatedDate", "submittedDate"].includes(String(args.sortBy))
    ? String(args.sortBy)
    : "relevance";

  let searchQuery = encodeURIComponent(query);
  if (category) searchQuery = `cat:${encodeURIComponent(category)}+AND+${searchQuery}`;

  const url = `https://export.arxiv.org/api/query?search_query=${searchQuery}&start=0&max_results=${maxResults}&sortBy=${sortBy}&sortOrder=descending`;
  const started = Date.now();
  const res = await fetchText(url, { Accept: "application/atom+xml" });
  if (!res.ok) throw new Error(`arXiv 搜索失败 HTTP ${res.status}`);
  const papers = parseArxivXml(await res.text());
  const slim = papers.map((p) => ({
    id: p.id,
    title: p.title,
    authors: p.authors.slice(0, 5),
    published: p.published,
    primaryCategory: p.primaryCategory,
    pdfUrl: p.pdfUrl,
    absUrl: p.absUrl,
    summaryPreview: p.summary.slice(0, 600),
  }));
  return {
    query,
    count: slim.length,
    papers: slim,
    hint:
      slim.length === 0
        ? "未找到结果，可换关键词或放宽 category"
        : "用 fetch_arxiv(paperId=...) 取完整摘要；用 download_file(url=pdfUrl) 下 PDF",
    elapsedMs: Date.now() - started,
  };
}

async function fetchArxiv(args: Record<string, unknown>): Promise<unknown> {
  const rawIds: string[] = [];
  if (Array.isArray(args.paperIds)) {
    for (const id of args.paperIds) {
      if (id != null && String(id).trim()) rawIds.push(String(id));
    }
  }
  if (args.paperId != null && String(args.paperId).trim()) {
    rawIds.push(String(args.paperId));
  }
  const cleanIds = [...new Set(rawIds.map(normalizeArxivId).filter(Boolean))];
  if (cleanIds.length === 0) {
    throw new Error('需要 paperId 或 paperIds。示例: fetch_arxiv({ paperId: "2401.12345" })');
  }

  const started = Date.now();
  const url = `https://export.arxiv.org/api/query?id_list=${cleanIds.join(",")}&start=0&max_results=${cleanIds.length}`;
  const res = await fetchText(url, { Accept: "application/atom+xml" });
  if (!res.ok) throw new Error(`获取 arXiv 论文失败 HTTP ${res.status}`);
  const papers = parseArxivXml(await res.text());
  if (papers.length === 0) {
    throw new Error(`未找到论文: ${cleanIds.join(", ")}`);
  }
  return {
    count: papers.length,
    papers: papers.length === 1 ? papers[0] : papers,
    hint: "PDF 可用 download_file(url=papers[].pdfUrl) 下载到 Workspace",
    elapsedMs: Date.now() - started,
  };
}

// ─── HuggingFace ─────────────────────────────────────────────────────────────

async function searchHuggingFace(args: Record<string, unknown>): Promise<unknown> {
  const query = String(args.query ?? "").trim();
  if (!query) throw new Error('需要 query 参数。示例: search_huggingface({ query: "bert" })');
  const task = String(args.task ?? "").trim();
  const limit = Math.min(Math.max(1, Number(args.limit ?? 10) || 10), 50);

  const base = hfBase();
  let url = `${base}/api/models?search=${encodeURIComponent(query)}&limit=${limit}`;
  if (task) url += `&filter=${encodeURIComponent(task)}`;

  const started = Date.now();
  const res = await fetchText(url);
  if (!res.ok) throw new Error(`HuggingFace 搜索失败 HTTP ${res.status}`);
  const models = (await res.json()) as Array<Record<string, unknown>>;
  const items = (Array.isArray(models) ? models : []).slice(0, limit).map((m) => ({
    id: String(m.id ?? ""),
    downloads: Number(m.downloads ?? 0),
    likes: Number(m.likes ?? 0),
    pipelineTag: String(m.pipeline_tag ?? "unknown"),
    tags: Array.isArray(m.tags) ? (m.tags as string[]).slice(0, 5) : [],
    createdAt: String(m.createdAt ?? ""),
    url: `${base}/${m.id}`,
  }));
  return {
    query,
    count: items.length,
    models: items,
    hint:
      items.length === 0
        ? "未找到模型，可换关键词或去掉 task 过滤"
        : "用 fetch_huggingface_model(modelId=...) 取详情",
    elapsedMs: Date.now() - started,
  };
}

async function fetchHuggingFaceModel(args: Record<string, unknown>): Promise<unknown> {
  const modelId = String(args.modelId ?? "").trim();
  if (!modelId) {
    throw new Error('需要 modelId。示例: fetch_huggingface_model({ modelId: "bert-base-chinese" })');
  }
  const base = hfBase();
  const started = Date.now();
  const res = await fetchText(`${base}/api/models/${encodeURIComponent(modelId)}`);
  if (res.status === 404) throw new Error(`未找到模型: ${modelId}`);
  if (!res.ok) throw new Error(`获取模型详情失败 HTTP ${res.status}`);
  const m = (await res.json()) as Record<string, unknown>;
  const card = (m.cardData && typeof m.cardData === "object" ? m.cardData : {}) as Record<
    string,
    unknown
  >;
  return {
    id: String(m.id ?? modelId),
    author: String(m.author ?? "Unknown"),
    downloads: Number(m.downloads ?? 0),
    likes: Number(m.likes ?? 0),
    pipelineTag: String(m.pipeline_tag ?? "unknown"),
    url: `${base}/${m.id ?? modelId}`,
    description: String(card.description ?? ""),
    tags: Array.isArray(m.tags) ? (m.tags as string[]).slice(0, 10) : [],
    createdAt: String(m.createdAt ?? ""),
    lastModified: String(m.lastModified ?? ""),
    elapsedMs: Date.now() - started,
  };
}

async function fetchHuggingFaceTrending(args: Record<string, unknown>): Promise<unknown> {
  const type = ["models", "datasets", "spaces", "papers"].includes(String(args.type))
    ? String(args.type)
    : "models";
  const sort = ["trending", "likes", "downloads", "created", "modified"].includes(String(args.sort))
    ? String(args.sort)
    : "trending";
  const limit = Math.min(Math.max(1, Number(args.limit ?? 20) || 20), 50);
  const filter = String(args.filter ?? "").trim();
  const started = Date.now();

  const base = hfBase();
  if (type === "papers") {
    const res = await fetchText(`${base}/api/daily_papers`);
    if (!res.ok) throw new Error(`HuggingFace daily papers 失败 HTTP ${res.status}`);
    const raw = (await res.json()) as Array<Record<string, unknown>>;
    const items = (Array.isArray(raw) ? raw : []).slice(0, limit).map((row, i) => {
      const paper = (row.paper && typeof row.paper === "object" ? row.paper : row) as Record<
        string,
        unknown
      >;
      const id = String(paper.id ?? paper.title ?? `paper-${i + 1}`);
      return {
        rank: i + 1,
        name: String(paper.title ?? id),
        url: paper.id ? `${base}/papers/${paper.id}` : `${base}/papers`,
        description: String(paper.summary ?? "").slice(0, 400),
        likes: Number(paper.upvotes ?? row.reactions ?? 0) || undefined,
        type: "papers",
        publishedAt: String(row.publishedAt ?? paper.publishedAt ?? ""),
      };
    });
    return {
      type,
      sort: "daily",
      count: items.length,
      items,
      elapsedMs: Date.now() - started,
    };
  }

  const endpoint =
    type === "datasets" ? "datasets" : type === "spaces" ? "spaces" : "models";
  const apiSort = sort === "created" ? "createdAt" : sort === "modified" ? "lastModified" : sort;
  const params = new URLSearchParams({
    sort: apiSort,
    direction: "-1",
    limit: String(limit),
  });
  if (filter) params.set("filter", filter);
  if (type === "spaces" && args.sdk) params.set("filter", String(args.sdk));

  const res = await fetchText(`${base}/api/${endpoint}?${params}`);
  if (!res.ok) throw new Error(`HuggingFace ${type} trending 失败 HTTP ${res.status}`);
  const raw = (await res.json()) as Array<Record<string, unknown>>;
  const items = (Array.isArray(raw) ? raw : []).slice(0, limit).map((m, i) => ({
    rank: i + 1,
    name: String(m.id ?? m.name ?? ""),
    url: `${base}/${m.id ?? ""}`,
    description: String(m.pipeline_tag ?? m.sdk ?? m.description ?? ""),
    likes: Number(m.likes ?? 0) || undefined,
    downloads: Number(m.downloads ?? 0) || undefined,
    type,
    tags: Array.isArray(m.tags) ? (m.tags as string[]).slice(0, 5) : [],
  }));
  return {
    type,
    sort,
    count: items.length,
    items,
    hint: type === "models" ? "用 fetch_huggingface_model(modelId=items[].name) 取详情" : undefined,
    elapsedMs: Date.now() - started,
  };
}

// ─── 注册表 ──────────────────────────────────────────────────────────────────

export const academicDefs: NativeToolDefinition[] = [
  {
    name: "search_arxiv",
    concurrencyClass: "B",
    description:
      "搜索 arXiv 学术论文（Atom API，免费）。支持关键词与分类过滤。常用分类：cs.AI / cs.CL / cs.CV / cs.LG。注意约每 3 秒 1 次限流，相关主题请用 OR 合并到一次查询。返回 id/title/authors/摘要预览/pdfUrl；详情用 fetch_arxiv，下 PDF 用 download_file。",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: '搜索关键词，可用 OR 合并，如 "transformer OR attention"',
        },
        category: { type: "string", description: "分类过滤，如 cs.AI（可选）" },
        maxResults: { type: "number", description: "返回数量 1~50，默认 5" },
        sortBy: {
          type: "string",
          enum: ["relevance", "lastUpdatedDate", "submittedDate"],
          description: "排序，默认 relevance",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "fetch_arxiv",
    concurrencyClass: "B",
    description:
      "按 arXiv ID 获取论文完整摘要/作者/PDF 链接。支持单篇 paperId 或批量 paperIds，一次请求减少限流。ID 可带 abs/pdf URL 或 vN 后缀，会自动规范化。",
    parameters: {
      type: "object",
      properties: {
        paperId: { type: "string", description: '单篇 ID，如 "2401.12345" 或完整 abs URL' },
        paperIds: {
          type: "array",
          items: { type: "string" },
          description: "多篇 ID 数组",
        },
      },
      required: [],
    },
  },
  {
    name: "search_huggingface",
    concurrencyClass: "B",
    description:
      "搜索 HuggingFace Hub 预训练模型（公开 API，无需 key）。按关键词/任务过滤，返回下载量、点赞、pipeline_tag。选型后用 fetch_huggingface_model 取详情；看热榜用 fetch_huggingface_trending。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: '关键词，如 "bert"、"llama"、"whisper"' },
        task: {
          type: "string",
          description:
            "任务过滤（可选）：text-classification / text-generation / question-answering / image-classification 等",
        },
        limit: { type: "number", description: "返回数量 1~50，默认 10" },
      },
      required: ["query"],
    },
  },
  {
    name: "fetch_huggingface_model",
    concurrencyClass: "B",
    description:
      "获取 HuggingFace 指定模型完整元数据（作者、下载量、标签、简介等）。modelId 须为完整 ID，如 bert-base-chinese 或 microsoft/DialoGPT-medium。",
    parameters: {
      type: "object",
      properties: {
        modelId: {
          type: "string",
          description: '模型完整 ID，如 "bert-base-chinese"、"Qwen/Qwen2.5-7B-Instruct"',
        },
      },
      required: ["modelId"],
    },
  },
  {
    name: "fetch_huggingface_trending",
    concurrencyClass: "B",
    description:
      "获取 HuggingFace 热榜（走 Hub REST API，非 HTML 抓取）。type=models|datasets|spaces|papers；models/datasets/spaces 支持 sort=trending|likes|downloads|created|modified；papers 走 daily_papers。",
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["models", "datasets", "spaces", "papers"],
          description: "板块，默认 models",
        },
        sort: {
          type: "string",
          enum: ["trending", "likes", "downloads", "created", "modified"],
          description: "排序（papers 忽略），默认 trending",
        },
        limit: { type: "number", description: "返回数量 1~50，默认 20" },
        filter: { type: "string", description: "可选关键词/标签过滤，如 text-generation" },
        sdk: { type: "string", description: "仅 spaces：sdk 过滤，如 gradio" },
      },
      required: [],
    },
  },
];

export const academicHandlers: Record<string, NativeToolHandler> = {
  search_arxiv: (args) => searchArxiv(args),
  fetch_arxiv: (args) => fetchArxiv(args),
  search_huggingface: (args) => searchHuggingFace(args),
  fetch_huggingface_model: (args) => fetchHuggingFaceModel(args),
  fetch_huggingface_trending: (args) => fetchHuggingFaceTrending(args),
};
