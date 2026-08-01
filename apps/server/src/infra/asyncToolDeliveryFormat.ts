/**
 * 异步纯工具投递契约：把 tool 返回值收成「LLM 可行动文本 + UI 结构化元数据」。
 *
 * 不变量（写进本叶子，禁止调用方再裸 JSON.stringify）：
 * 1. 投递进会话的 content 必须是可读摘要/正文，不是整包 JSON dump
 * 2. 文本末尾必须带「请继续完成用户任务」行动指令（与 sleep 投递同口径）
 * 3. structured 供前端卡片渲染；缺省也可从 text 降级，但写点必须尽量填
 */

import { AGENT_TOOL_RESULT_MAX_CHARS } from "@knowpilot/shared";

export type AsyncToolDeliveryKind = "read_article" | "generic";

export interface AsyncToolDeliveryStructured {
  tool: string;
  kind: AsyncToolDeliveryKind;
  title?: string;
  author?: string;
  platform?: string;
  url?: string;
  /** 正文（可能已截断，供卡片展开） */
  content?: string;
  contentChars?: number;
  totalChars?: number;
  method?: string;
  elapsedMs?: number;
  truncated?: boolean;
  /** generic：挑出的短字段预览 */
  previewFields?: Array<{ key: string; value: string }>;
}

export interface AsyncToolDeliveryFormatted {
  /** 写入 Task.output.asyncResult / ChatMessage.content 的文本 */
  textForLlm: string;
  structured: AsyncToolDeliveryStructured;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function isReadArticleShape(o: Record<string, unknown>): boolean {
  return typeof o.content === "string" && (typeof o.title === "string" || typeof o.url === "string");
}

function truncateText(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return {
    text: `${text.slice(0, maxChars)}\n\n[content TRUNCATED, original=${text.length}, kept=${maxChars}]`,
    truncated: true,
  };
}

function headerLine(tool: string, taskLabel?: string): string {
  const label = taskLabel?.trim();
  return label
    ? `[异步工具结果 · ${tool} · ${label}]`
    : `[异步工具结果 · ${tool}]`;
}

const CONTINUE_HINT =
  "请根据以上结果继续推进用户目标（整理/写入知识库/回答问题等）。不要复述原始 JSON；若结果不足再调用工具补齐。";

function formatReadArticle(
  tool: string,
  o: Record<string, unknown>,
  taskLabel: string | undefined,
  maxContentChars: number,
): AsyncToolDeliveryFormatted {
  const title = str(o.title) ?? "(无标题)";
  const author = str(o.author);
  const platform = str(o.platform);
  const url = str(o.url);
  const method = str(o.method);
  const elapsedMs = num(o.elapsedMs);
  const totalChars = num(o.totalChars) ?? (typeof o.content === "string" ? o.content.length : undefined);
  const rawContent = typeof o.content === "string" ? o.content : "";
  const { text: content, truncated } = truncateText(rawContent, maxContentChars);

  const metaLines = [
    `- 标题：${title}`,
    author ? `- 作者：${author}` : null,
    platform ? `- 平台：${platform}` : null,
    url ? `- URL：${url}` : null,
    method ? `- 抓取：${method}` : null,
    totalChars != null ? `- 字数：${totalChars}` : null,
    elapsedMs != null ? `- 耗时：${Math.round(elapsedMs)}ms` : null,
  ].filter(Boolean);

  const textForLlm = [
    headerLine(tool, taskLabel),
    "后台工具已完成。",
    "",
    "## 文章元信息",
    ...metaLines,
    "",
    "## 正文",
    content || "(无正文)",
    "",
    CONTINUE_HINT,
  ].join("\n");

  return {
    textForLlm,
    structured: {
      tool,
      kind: "read_article",
      title,
      author,
      platform,
      url,
      content,
      contentChars: content.length,
      totalChars,
      method,
      elapsedMs,
      truncated,
    },
  };
}

function formatGeneric(
  tool: string,
  result: unknown,
  taskLabel: string | undefined,
  maxContentChars: number,
): AsyncToolDeliveryFormatted {
  const o = asRecord(result);
  const previewFields: Array<{ key: string; value: string }> = [];
  if (o) {
    for (const [key, value] of Object.entries(o)) {
      if (previewFields.length >= 8) break;
      if (value == null) continue;
      if (typeof value === "string") {
        previewFields.push({ key, value: value.length > 160 ? `${value.slice(0, 160)}…` : value });
      } else if (typeof value === "number" || typeof value === "boolean") {
        previewFields.push({ key, value: String(value) });
      }
    }
  }

  const raw =
    typeof result === "string"
      ? result
      : JSON.stringify(result ?? null, null, 2);
  const { text: body, truncated } = truncateText(raw, maxContentChars);

  const textForLlm = [
    headerLine(tool, taskLabel),
    "后台工具已完成。",
    "",
    "```",
    body,
    "```",
    "",
    CONTINUE_HINT,
  ].join("\n");

  return {
    textForLlm,
    structured: {
      tool,
      kind: "generic",
      content: body,
      contentChars: body.length,
      truncated,
      previewFields: previewFields.length ? previewFields : undefined,
    },
  };
}

/** 纯工具异步终态 → 投递文本 + 结构化元数据（唯一格式化入口） */
export function formatAsyncToolDelivery(
  tool: string,
  result: unknown,
  opts?: { taskLabel?: string; maxContentChars?: number },
): AsyncToolDeliveryFormatted {
  const maxContentChars = Math.max(
    500,
    opts?.maxContentChars ?? AGENT_TOOL_RESULT_MAX_CHARS,
  );
  const taskLabel = opts?.taskLabel;
  const o = asRecord(result);
  if (tool === "read_article" || (o && isReadArticleShape(o))) {
    return formatReadArticle(tool || "read_article", o ?? { content: String(result ?? "") }, taskLabel, maxContentChars);
  }
  return formatGeneric(tool || "tool", result, taskLabel, maxContentChars);
}
