/**
 * 工具大结果落盘（DeerFlow 启发）：超阈值不整段塞进 LLM，只回路径 + 预览。
 * 落点：data/tool-results/{sessionOrRun}/{toolCallId}.json
 */

import fs from "fs";
import path from "path";
import type { AppConfig } from "./config.js";

export type ToolResultOffloadMeta = {
  offloaded: true;
  path: string;
  originalChars: number;
  preview: string;
  suggestedTool: "read_file";
  hint: string;
  /** 若原结果带 artifact 字段，透传供 SSE/UI */
  artifact?: {
    type: string;
    title?: string;
    path: string;
    mime?: string;
  };
};

export type ToolResultOffloadOpts = {
  sessionId?: string;
  runId?: string;
  toolCallId: string;
  toolName: string;
  /** 超过此 JSON 长度才落盘；默认取 microCompact.toolResultMaxChars */
  thresholdChars?: number;
  /** 预览保留字符数 */
  previewChars?: number;
};

function toolResultsDir(config: AppConfig): string {
  const base = config.dataPaths.toolResults ?? path.join(config.dataDir, "tool-results");
  return base;
}

function extractArtifact(
  result: unknown,
  offloadRel: string,
): ToolResultOffloadMeta["artifact"] | undefined {
  if (!result || typeof result !== "object" || Array.isArray(result)) return undefined;
  const obj = result as Record<string, unknown>;
  const art = obj.artifact;
  if (art && typeof art === "object" && !Array.isArray(art)) {
    const a = art as Record<string, unknown>;
    const type = String(a.type || "file");
    const title = a.title != null ? String(a.title) : undefined;
    const p = a.path != null ? String(a.path) : offloadRel;
    const mime = a.mime != null ? String(a.mime) : undefined;
    return { type, title, path: p, mime };
  }
  // 常见产物字段：htmlPath / markdownPath / publicUrl
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

/**
 * 若 JSON 超阈值：写入 data/tool-results，返回供 LLM 的瘦身对象；否则返回 null（调用方原样截断）。
 */
export function offloadToolResultIfNeeded(
  config: AppConfig,
  result: unknown,
  opts: ToolResultOffloadOpts,
): { llmResult: ToolResultOffloadMeta; artifact?: ToolResultOffloadMeta["artifact"] } | null {
  const threshold =
    opts.thresholdChars ??
    config.compact?.toolResultOffload?.thresholdChars ??
    config.compact?.microCompact?.toolResultMaxChars ??
    4000;
  if (!config.compact?.toolResultOffload?.enabled) return null;

  const fullStr = JSON.stringify(result);
  if (fullStr.length <= threshold) return null;

  const bucket = (opts.sessionId || opts.runId || "anon").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  const safeCall = opts.toolCallId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "call";
  const dir = path.join(toolResultsDir(config), bucket);
  fs.mkdirSync(dir, { recursive: true });
  const fileName = `${safeCall}.json`;
  const abs = path.join(dir, fileName);
  fs.writeFileSync(abs, fullStr, "utf8");
  const rel = path.relative(config.projectRoot, abs).replace(/\\/g, "/");

  const previewChars = opts.previewChars ?? 600;
  const preview =
    fullStr.length > previewChars
      ? fullStr.slice(0, previewChars) + `\n…[preview, full at ${rel}]`
      : fullStr;

  const artifact = extractArtifact(result, rel);
  const llmResult: ToolResultOffloadMeta = {
    offloaded: true,
    path: rel,
    originalChars: fullStr.length,
    preview,
    suggestedTool: "read_file",
    hint: `完整结果已落盘。用 read_file(path="${rel}", offset=0) 分段读取；勿要求用户打开文件。`,
    ...(artifact ? { artifact } : {}),
  };
  return { llmResult, artifact };
}
