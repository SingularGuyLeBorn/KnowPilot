/**
 * 工具结果全量落盘（记录平面）+ 超阈值时只向主 LLM 注入厚 metadata + keywords。
 * - 原文：data/tool-results/{bucket}/{toolCallId}.json
 * - 元数据：同目录 {toolCallId}.meta.json + 瘦 index.jsonl
 * - 压缩视图不含正文；写盘原子化；索引追加失败不阻断主路径；支持 TTL 清理
 */

import fs from "fs";
import path from "path";
import type { AppConfig } from "./config.js";
import {
  buildToolResultMetadata,
  type ToolResultThickMetadata,
} from "./toolResultMetadata.js";

/** 压缩后给主 LLM 的索引卡（无正文） */
export type ToolResultOffloadMeta = {
  offloaded: true;
  path: string;
  metaPath: string;
  originalChars: number;
  suggestedTool: "read_file";
  hint: string;
  keywords: string[];
  hitCount: number;
  missedKeywords: string[];
  metadata: ToolResultThickMetadata;
  artifact?: ToolResultThickMetadata["artifact"];
};

export const KP_RESULT_PATH_KEY = "_kp_result_path";
export const KP_META_PATH_KEY = "_kp_meta_path";
export const KP_PERSISTED_KEY = "_kp_persisted";
export const KP_ORIGINAL_CHARS_KEY = "_kp_original_chars";

export type ToolResultPersistOutcome = {
  path: string;
  metaPath: string;
  originalChars: number;
  compacted: boolean;
  llmResult: unknown;
  metadata: ToolResultThickMetadata;
  artifact?: ToolResultThickMetadata["artifact"];
};

export type ToolResultOffloadOpts = {
  sessionId?: string;
  runId?: string;
  toolCallId: string;
  toolName: string;
  thresholdChars?: number;
  expectKeywords?: string[];
  expectPatterns?: string[];
  contextWindow?: number;
};

/** 瘦索引行：全文 metadata 在 .meta.json，避免 jsonl 膨胀 */
export type ToolResultIndexEntry = {
  toolCallId: string;
  toolName: string;
  path: string;
  metaPath: string;
  createdAt: string;
  originalChars: number;
  compacted: boolean;
  keywords: string[];
  hitCount: number;
  contentType: string;
  title?: string;
  topics: string[];
  entities: string[];
};

function toolResultsDir(config: AppConfig): string {
  return config.dataPaths.toolResults ?? path.join(config.dataDir, "tool-results");
}

function writeFileAtomic(abs: string, content: string): void {
  const dir = path.dirname(abs);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(abs)}.${process.pid}.${Date.now().toString(36)}.tmp`,
  );
  fs.writeFileSync(tmp, content, "utf8");
  try {
    fs.renameSync(tmp, abs);
  } catch {
    // Windows：目标存在时 rename 可能失败 → 先删再移
    try {
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
      fs.renameSync(tmp, abs);
    } catch (err) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
      throw err;
    }
  }
}

function allocateResultPaths(
  dir: string,
  safeCall: string,
): { fileName: string; metaFileName: string; abs: string; metaAbs: string } {
  let fileName = `${safeCall}.json`;
  let abs = path.join(dir, fileName);
  if (fs.existsSync(abs)) {
    const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    fileName = `${safeCall}-${stamp}.json`;
    abs = path.join(dir, fileName);
  }
  const metaFileName = fileName.replace(/\.json$/i, ".meta.json");
  return { fileName, metaFileName, abs, metaAbs: path.join(dir, metaFileName) };
}

function extractArtifact(
  result: unknown,
  offloadRel: string,
): ToolResultThickMetadata["artifact"] | undefined {
  if (!result || typeof result !== "object" || Array.isArray(result)) return undefined;
  const obj = result as Record<string, unknown>;
  const art = obj.artifact;
  if (art && typeof art === "object" && !Array.isArray(art)) {
    const a = art as Record<string, unknown>;
    return {
      type: String(a.type || "file"),
      title: a.title != null ? String(a.title) : undefined,
      path: a.path != null ? String(a.path) : offloadRel,
      mime: a.mime != null ? String(a.mime) : undefined,
    };
  }
  if (typeof obj.htmlPath === "string") {
    return { type: "html", path: obj.htmlPath, title: String(obj.title || obj.name || "webpage") };
  }
  if (typeof obj.markdownPath === "string") {
    return {
      type: "markdown",
      path: obj.markdownPath,
      title: String(obj.title || obj.name || "document"),
    };
  }
  if (typeof obj.publicUrl === "string" && String(obj.publicUrl).includes("/uploads/")) {
    return {
      type: "image",
      path: String(obj.path || obj.publicUrl),
      title: String(obj.name || "screenshot"),
      mime: "image/png",
    };
  }
  return undefined;
}

function annotateWithPath(
  result: unknown,
  rel: string,
  metaRel: string,
  originalChars: number,
): unknown {
  if (result !== null && typeof result === "object" && !Array.isArray(result)) {
    return {
      ...(result as Record<string, unknown>),
      [KP_PERSISTED_KEY]: true,
      [KP_RESULT_PATH_KEY]: rel,
      [KP_META_PATH_KEY]: metaRel,
      [KP_ORIGINAL_CHARS_KEY]: originalChars,
    };
  }
  return {
    value: result,
    [KP_PERSISTED_KEY]: true,
    [KP_RESULT_PATH_KEY]: rel,
    [KP_META_PATH_KEY]: metaRel,
    [KP_ORIGINAL_CHARS_KEY]: originalChars,
  };
}

function appendIndexEntry(dir: string, entry: ToolResultIndexEntry): void {
  const indexPath = path.join(dir, "index.jsonl");
  const line = JSON.stringify(entry) + "\n";
  let lastErr: unknown;
  for (let i = 0; i < 5; i++) {
    try {
      fs.appendFileSync(indexPath, line, "utf8");
      return;
    } catch (err) {
      lastErr = err;
      // 短暂退避后重试（并发 append / 瞬时锁）
      const start = Date.now();
      while (Date.now() - start < 8 + i * 8) {
        /* spin */
      }
    }
  }
  console.warn(
    "[toolResultOffload] index.jsonl 追加失败（原文/meta 已落盘）:",
    lastErr instanceof Error ? lastErr.message : lastErr,
  );
}

function buildHint(rel: string, meta: ToolResultThickMetadata): string {
  const first = meta.recommendedRead[0];
  const offsetHint =
    first != null
      ? `建议先 read_file(path="${rel}", offset=${first.offset}, maxChars=${first.maxChars ?? 4000})（${first.reason}）`
      : `用 read_file(path="${rel}", offset=0, maxChars=12000) 分段读取`;
  return (
    `完整结果已落盘（记录平面可追溯）。上下文仅含 metadata+keywords，无正文。` +
    `${offsetHint}；也可用 tool_results_list / tool_result_meta 查询。`
  );
}

/** 读取某 bucket 的落盘瘦索引（自动跳过正文已删的陈旧行） */
export function listToolResultIndex(
  config: AppConfig,
  sessionOrRunId: string,
): ToolResultIndexEntry[] {
  const bucket = sessionOrRunId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  const indexPath = path.join(toolResultsDir(config), bucket, "index.jsonl");
  if (!fs.existsSync(indexPath)) return [];
  const lines = fs.readFileSync(indexPath, "utf8").split("\n").filter(Boolean);
  const out: ToolResultIndexEntry[] = [];
  for (const line of lines) {
    try {
      const row = JSON.parse(line) as ToolResultIndexEntry & { metadata?: unknown };
      // 兼容旧行：丢掉嵌套 metadata 大字段
      const { metadata: _drop, ...rest } = row as ToolResultIndexEntry & { metadata?: unknown };
      const entry = rest as ToolResultIndexEntry;
      if (!entry.path || typeof entry.path !== "string") continue;
      const abs = path.isAbsolute(entry.path)
        ? entry.path
        : path.join(config.projectRoot, entry.path);
      if (!fs.existsSync(abs)) continue;
      out.push(entry);
    } catch {
      /* skip */
    }
  }
  return out;
}

function rewriteIndexPruned(bucketAbs: string, projectRoot: string): void {
  const indexPath = path.join(bucketAbs, "index.jsonl");
  if (!fs.existsSync(indexPath)) return;
  const lines = fs.readFileSync(indexPath, "utf8").split("\n").filter(Boolean);
  const kept: string[] = [];
  for (const line of lines) {
    try {
      const row = JSON.parse(line) as ToolResultIndexEntry;
      if (!row.path) continue;
      const abs = path.isAbsolute(row.path) ? row.path : path.join(projectRoot, row.path);
      if (fs.existsSync(abs)) kept.push(JSON.stringify(row));
    } catch {
      /* drop */
    }
  }
  if (kept.length === 0) {
    try {
      fs.unlinkSync(indexPath);
    } catch {
      /* ignore */
    }
    return;
  }
  writeFileAtomic(indexPath, kept.join("\n") + "\n");
}

function resolveWithinToolResults(config: AppConfig, relOrAbs: string): string {
  const rel = relOrAbs.replace(/\\/g, "/");
  const abs = path.isAbsolute(rel) ? rel : path.join(config.projectRoot, rel);
  const root = path.resolve(toolResultsDir(config));
  const resolved = path.resolve(abs);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(`路径必须在 data/tool-results 内：${relOrAbs}`);
  }
  return resolved;
}

/** 读 .meta.json；path 可为 metaPath 或相对 projectRoot */
export function readToolResultMeta(
  config: AppConfig,
  metaPathOrRel: string,
): ToolResultThickMetadata | null {
  const resolved = resolveWithinToolResults(config, metaPathOrRel);
  if (!fs.existsSync(resolved)) return null;
  try {
    return JSON.parse(fs.readFileSync(resolved, "utf8")) as ToolResultThickMetadata;
  } catch {
    return null;
  }
}

/** UI / tRPC：按需读落盘原文片段（防路径穿越；默认截断） */
export function readToolResultPayload(
  config: AppConfig,
  pathRel: string,
  opts?: { offset?: number; maxChars?: number },
): {
  path: string;
  content: string;
  totalChars: number;
  offset: number;
  truncated: boolean;
  nextOffset: number | null;
} {
  const resolved = resolveWithinToolResults(config, pathRel);
  if (!fs.existsSync(resolved)) {
    throw new Error(`工具结果文件不存在：${pathRel}`);
  }
  const full = fs.readFileSync(resolved, "utf8");
  const offset = Math.max(0, Math.min(opts?.offset ?? 0, full.length));
  const maxChars = Math.min(Math.max(opts?.maxChars ?? 12_000, 200), 100_000);
  const slice = full.slice(offset, offset + maxChars);
  const end = offset + slice.length;
  return {
    path: path.relative(config.projectRoot, resolved).replace(/\\/g, "/"),
    content: slice,
    totalChars: full.length,
    offset,
    truncated: end < full.length,
    nextOffset: end < full.length ? end : null,
  };
}

let ttlTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 启动即清一轮 + 周期 TTL（节拍复用 stream.cleanupIntervalMs，不新增 config 面）。
 * retentionDays≤0 时不挂定时器。返回 stop。
 */
export function startToolResultTtlCleanup(config: AppConfig): () => void {
  stopToolResultTtlCleanup();
  const days = config.compact?.toolResultOffload?.retentionDays ?? 14;
  if (days <= 0) return stopToolResultTtlCleanup;
  const intervalMs = Math.max(60_000, config.stream?.cleanupIntervalMs ?? 60_000);
  const run = () => {
    try {
      const r = cleanupExpiredToolResults(config);
      if (r.removedFiles > 0) {
        console.log(
          `[ToolResults] TTL 周期清理 ${r.removedFiles} 个文件（${r.scannedBuckets} 桶）`,
        );
      }
    } catch (err) {
      console.warn(
        "[ToolResults] TTL 周期清理失败:",
        err instanceof Error ? err.message : err,
      );
    }
  };
  run();
  ttlTimer = setInterval(run, intervalMs);
  ttlTimer.unref?.();
  return stopToolResultTtlCleanup;
}

export function stopToolResultTtlCleanup(): void {
  if (ttlTimer) {
    clearInterval(ttlTimer);
    ttlTimer = null;
  }
}

/**
 * TTL 清理过期工具结果（按文件 mtime）。
 * retentionDays<=0 表示不清理。返回删除的文件数。
 */
export function cleanupExpiredToolResults(
  config: AppConfig,
  opts?: { retentionDays?: number; now?: number },
): { removedFiles: number; scannedBuckets: number } {
  const days =
    opts?.retentionDays ??
    config.compact?.toolResultOffload?.retentionDays ??
    14;
  if (days <= 0) return { removedFiles: 0, scannedBuckets: 0 };
  const maxAgeMs = days * 24 * 60 * 60 * 1000;
  const now = opts?.now ?? Date.now();
  const root = toolResultsDir(config);
  if (!fs.existsSync(root)) return { removedFiles: 0, scannedBuckets: 0 };

  let removedFiles = 0;
  let scannedBuckets = 0;
  for (const name of fs.readdirSync(root)) {
    const bucketAbs = path.join(root, name);
    let st: fs.Stats;
    try {
      st = fs.statSync(bucketAbs);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    scannedBuckets++;
    let entries: string[];
    try {
      entries = fs.readdirSync(bucketAbs);
    } catch {
      continue;
    }
    for (const file of entries) {
      // index 最后统一重写，避免边删边改造成半截 jsonl
      if (file === "index.jsonl") continue;
      const abs = path.join(bucketAbs, file);
      try {
        const fst = fs.statSync(abs);
        if (!fst.isFile()) continue;
        if (now - fst.mtimeMs > maxAgeMs) {
          fs.unlinkSync(abs);
          removedFiles++;
        }
      } catch {
        /* ignore */
      }
    }
    rewriteIndexPruned(bucketAbs, config.projectRoot);
    // 空桶删除（保留有内容的）
    try {
      if (fs.readdirSync(bucketAbs).length === 0) fs.rmdirSync(bucketAbs);
    } catch {
      /* ignore */
    }
  }
  return { removedFiles, scannedBuckets };
}

/**
 * 全量落盘；超阈值时对 LLM 只返回厚 metadata + keywords。
 * 原文落盘失败才抛错；index 失败仅 warn。
 */
export function offloadToolResultIfNeeded(
  config: AppConfig,
  result: unknown,
  opts: ToolResultOffloadOpts,
): ToolResultPersistOutcome | null {
  const offCfg = config.compact?.toolResultOffload;
  if (!offCfg?.enabled) return null;

  const threshold =
    opts.thresholdChars ??
    offCfg.thresholdChars ??
    config.compact?.microCompact?.toolResultMaxChars ??
    4000;

  let fullStr: string;
  try {
    fullStr = JSON.stringify(result);
  } catch {
    fullStr = JSON.stringify({ error: "tool_result_not_serializable", toolName: opts.toolName });
  }

  const bucket = (opts.sessionId || opts.runId || "anon").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "anon";
  const safeCall = opts.toolCallId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "call";
  const dir = path.join(toolResultsDir(config), bucket);
  fs.mkdirSync(dir, { recursive: true });

  const { abs, metaAbs } = allocateResultPaths(dir, safeCall);
  const rel = path.relative(config.projectRoot, abs).replace(/\\/g, "/");
  const metaRel = path.relative(config.projectRoot, metaAbs).replace(/\\/g, "/");

  // 先落原文（失败则整次失败，reactLoop 回退截断）
  writeFileAtomic(abs, fullStr);

  const keywords = (opts.expectKeywords ?? []).map((k) => k.trim()).filter(Boolean);
  const patterns = (opts.expectPatterns ?? []).map((p) => p.trim()).filter(Boolean);
  const artifact = extractArtifact(result, rel);

  const metadata = buildToolResultMetadata(result, {
    toolName: opts.toolName,
    originalChars: fullStr.length,
    keywords,
    patterns,
    contextWindow: opts.contextWindow ?? offCfg.contextWindow ?? 400,
    chunkStride: offCfg.chunkStrideChars ?? 1000,
    artifact,
  });

  try {
    writeFileAtomic(metaAbs, JSON.stringify(metadata, null, 2));
  } catch (err) {
    console.warn(
      "[toolResultOffload] meta 落盘失败（原文已在）:",
      err instanceof Error ? err.message : err,
    );
  }

  const compacted = fullStr.length > threshold;
  let llmResult: unknown;

  if (compacted) {
    const card: ToolResultOffloadMeta = {
      offloaded: true,
      path: rel,
      metaPath: metaRel,
      originalChars: fullStr.length,
      suggestedTool: "read_file",
      hint: buildHint(rel, metadata),
      keywords: metadata.keywords,
      hitCount: metadata.hitCount,
      missedKeywords: metadata.missedKeywords,
      metadata,
      ...(artifact ? { artifact } : {}),
    };
    llmResult = card;
  } else {
    llmResult = annotateWithPath(result, rel, metaRel, fullStr.length);
  }

  appendIndexEntry(dir, {
    toolCallId: opts.toolCallId,
    toolName: opts.toolName,
    path: rel,
    metaPath: metaRel,
    createdAt: new Date().toISOString(),
    originalChars: fullStr.length,
    compacted,
    keywords: metadata.keywords,
    hitCount: metadata.hitCount,
    contentType: metadata.contentType,
    ...(metadata.title ? { title: metadata.title } : {}),
    topics: metadata.topics,
    entities: metadata.entities,
  });

  return {
    path: rel,
    metaPath: metaRel,
    originalChars: fullStr.length,
    compacted,
    llmResult,
    metadata,
    artifact,
  };
}
