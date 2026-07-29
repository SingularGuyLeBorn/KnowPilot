/**
 * 编辑器补全上下文：以「当前段落」为默认焦点，再截取前后窗口。
 */

export const EDITOR_CTX_CHARS = 1200;

export type EditorCompleteContext = {
  /** 光标所在段落（含空行分隔的块） */
  paragraph: string;
  /** 光标前窗口（含段落之前） */
  before: string;
  /** 光标后窗口 */
  after: string;
  /** 有划选时的选区文本 */
  selected?: string;
  /** 源码坐标：光标/选区（用于 Accept 写回） */
  start: number;
  end: number;
};

/** 找包含 cursor 的段落边界（按空行分段） */
export function findParagraphBounds(
  content: string,
  cursor: number,
): { start: number; end: number } {
  const c = Math.max(0, Math.min(cursor, content.length));
  let start = c;
  while (start > 0) {
    if (content[start - 1] === "\n" && content[start - 2] === "\n") break;
    start -= 1;
  }
  let end = c;
  while (end < content.length) {
    if (content[end] === "\n" && content[end + 1] === "\n") break;
    end += 1;
  }
  return { start, end };
}

/**
 * 从 Markdown 源码 + 光标/选区提取补全上下文。
 * 默认带上当前段落；before/after 再向两侧扩 EDITOR_CTX_CHARS。
 */
export function extractEditorCompleteContext(
  content: string,
  start: number,
  end: number = start,
): EditorCompleteContext {
  const s = Math.max(0, Math.min(start, content.length));
  const e = Math.max(s, Math.min(end, content.length));
  const selected = s !== e ? content.slice(s, e) : undefined;
  const focus = selected?.trim() ? Math.floor((s + e) / 2) : s;
  const para = findParagraphBounds(content, focus);
  const paragraph = content.slice(para.start, para.end).trim();

  const beforeStart = Math.max(0, Math.min(s, para.start) - EDITOR_CTX_CHARS);
  const afterEnd = Math.min(content.length, Math.max(e, para.end) + EDITOR_CTX_CHARS);

  return {
    paragraph,
    before: content.slice(beforeStart, s),
    after: content.slice(e, afterEnd),
    selected: selected?.trim() ? selected : undefined,
    start: s,
    end: e,
  };
}

/** 正文键入 @agent… 时识别（大小写不敏感） */
export function detectEditorAgentAtTrigger(
  text: string,
  cursor: number,
): { query: string; token: string; tokenStart: number } | null {
  const before = text.slice(0, cursor);
  const m = before.match(/@(agent)([\w\u4e00-\u9fff-]*)$/i);
  if (!m) return null;
  return {
    token: m[0]!,
    query: (m[2] ?? "").replace(/^[-_]+/, ""),
    tokenStart: cursor - m[0]!.length,
  };
}
