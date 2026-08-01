/**
 * 文档解析域 — PDF / Word → Markdown
 *
 * Inbox / 知识库入库：把下载的论文 PDF、笔记 Word 转为可编辑 Markdown。
 * 依赖：unpdf（PDF 文本层）、mammoth（docx→HTML→turndown Markdown）。
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import mammoth from "mammoth";
import { extractText } from "unpdf";
import { resolveSafePath, assertPathWithinProjectRoot } from "../../safePath.js";
import type { NativeToolContext, NativeToolDefinition, NativeToolHandler } from "./types.js";
import { registerNativeDomain } from "./registerDomain.js";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TurndownService = require("turndown") as new (opts?: Record<string, unknown>) => {
  turndown(html: string): string;
};

function clampInt(n: unknown, def: number, min: number, max: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return def;
  return Math.min(max, Math.max(min, Math.floor(v)));
}

async function resolveInputPath(
  ctx: NativeToolContext,
  relPath: string,
): Promise<{ abs: string; rel: string }> {
  let p = String(relPath ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!p) {
    throw new Error(
      "需要 path：Workspace 相对（如 downloads/foo.pdf）、content/uploads/… 或 workspaces/…",
    );
  }
  // 与 download_file / write_file 对齐，避免「下到 Workspace、解析却按项目根找」
  const { resolveAgentFsPath } = await import("./fs.js");
  const { abs, relForReturn } = await resolveAgentFsPath(ctx, p, "read");
  assertPathWithinProjectRoot(ctx.config, abs);
  if (!fs.existsSync(abs)) throw new Error(`文件不存在: ${relForReturn}`);
  if (!fs.statSync(abs).isFile()) throw new Error(`不是文件: ${relForReturn}`);
  return { abs, rel: relForReturn };
}

function detectKind(filePath: string, explicit?: string): "pdf" | "docx" {
  const e = (explicit || "").toLowerCase().trim();
  if (e === "pdf" || e === "docx") return e;
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".pdf") return "pdf";
  if (ext === ".docx" || ext === ".doc") return "docx";
  throw new Error("无法识别文件类型：请提供 .pdf / .docx，或传 fileType=pdf|docx");
}

function htmlToMarkdown(html: string): string {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });
  return td.turndown(html || "").trim();
}

async function pdfToMarkdown(abs: string): Promise<{ markdown: string; pageCount?: number }> {
  const data = new Uint8Array(fs.readFileSync(abs));
  const result = await extractText(data, { mergePages: true });
  const text = Array.isArray(result.text) ? result.text.join("\n\n") : String(result.text || "");
  const pages = typeof result.totalPages === "number" ? result.totalPages : undefined;
  // 纯文本转简易 Markdown：保留段落
  const markdown = text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!markdown) {
    throw new Error(
      "PDF 未提取到文本层（可能是扫描件）。可先用 scroll_screenshot/read_image 或 OCR 路径处理。",
    );
  }
  return { markdown, pageCount: pages };
}

async function docxToMarkdown(abs: string): Promise<{ markdown: string }> {
  const { value: html } = await mammoth.convertToHtml({ path: abs });
  const markdown = htmlToMarkdown(html);
  if (!markdown) throw new Error("Word 文档转换结果为空");
  return { markdown };
}

function defaultOutPath(inputRel: string): string {
  const dir = path.posix.dirname(inputRel.replace(/\\/g, "/"));
  const base = path.posix.basename(inputRel.replace(/\\/g, "/"), path.extname(inputRel));
  const outDir = dir.startsWith("content/uploads")
    ? dir
    : dir.startsWith("data/")
      ? dir
      : "data/workspace/parsed";
  return `${outDir}/${base}.md`;
}

async function documentToMarkdown(args: Record<string, unknown>, ctx: NativeToolContext) {
  const { abs, rel } = await resolveInputPath(ctx, String(args.path ?? ""));
  const kind = detectKind(abs, args.fileType != null ? String(args.fileType) : undefined);
  const maxChars = clampInt(args.maxChars, 20000, 1000, 100000);
  const save = args.save !== false && String(args.save).toLowerCase() !== "false";

  let markdown: string;
  let pageCount: number | undefined;
  if (kind === "pdf") {
    const r = await pdfToMarkdown(abs);
    markdown = r.markdown;
    pageCount = r.pageCount;
  } else {
    const r = await docxToMarkdown(abs);
    markdown = r.markdown;
  }

  const totalChars = markdown.length;
  let outPath: string | undefined;
  if (save) {
    const outRel = String(args.outputPath ?? defaultOutPath(rel)).replace(/\\/g, "/").replace(/^\/+/, "");
    if (outRel.includes("..")) throw new Error("outputPath 不允许包含 ..");
    const outAbs = resolveSafePath(ctx.config, outRel);
    assertPathWithinProjectRoot(ctx.config, outAbs);
    // 禁止写 core posts 根文章（脱同步）；uploads / data / workspaces 可写
    const allowed =
      outRel.startsWith("content/uploads/") ||
      outRel.startsWith("data/") ||
      outRel.startsWith("workspaces/");
    if (!allowed) {
      throw new Error(
        `outputPath 仅允许 content/uploads/、data/、workspaces/ 下：收到 ${outRel}`,
      );
    }
    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    const fm = [
      "---",
      `title: ${JSON.stringify(path.basename(rel, path.extname(rel)))}`,
      `sourceFile: ${JSON.stringify(rel)}`,
      `parsedAt: ${JSON.stringify(new Date().toISOString())}`,
      `format: ${JSON.stringify(kind)}`,
      "---",
      "",
    ].join("\n");
    fs.writeFileSync(outAbs, fm + markdown + "\n", "utf8");
    outPath = outRel;
  }

  const truncated = totalChars > maxChars;
  return {
    path: rel,
    format: kind,
    pageCount,
    totalChars,
    truncated,
    outputPath: outPath,
    markdown: truncated ? markdown.slice(0, maxChars) : markdown,
    hint: truncated
      ? "正文已截断返回；完整内容见 outputPath，可用 read_file 按 offset 续读。"
      : outPath
        ? "已保存 Markdown；可 post_create 入库或继续编辑。"
        : undefined,
  };
}

const DOCUMENT_DEFS: NativeToolDefinition[] = [
  {
    name: "document_to_markdown",
    concurrencyClass: "A",
    description:
      "将本地 PDF 或 Word（.docx）转为 Markdown。path 与 download_file 对齐：Workspace 相对（如 downloads/paper.pdf）、content/uploads/… 或 workspaces/…。默认把 .md 写到同目录或 data/workspace/parsed/。扫描件无文本层时会报错并提示 OCR。长文返回可能截断，完整版看 outputPath。",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Workspace 相对、content/uploads/… 或 workspaces/… 的 PDF/DOCX",
        },
        fileType: { type: "string", description: "可选 pdf|docx，默认按扩展名" },
        outputPath: {
          type: "string",
          description: "可选输出 .md 路径（仅 content/uploads|data|workspaces）",
        },
        save: { type: "boolean", description: "是否落盘 Markdown，默认 true" },
        maxChars: { type: "number", description: "返回 markdown 最大字符，默认 20000" },
      },
      required: ["path"],
    },
  },
];

const DOCUMENT_HANDLERS: Record<string, NativeToolHandler> = {
  document_to_markdown: documentToMarkdown,
};

export function registerDocumentTools(): void {
  registerNativeDomain(DOCUMENT_DEFS, DOCUMENT_HANDLERS);
}
