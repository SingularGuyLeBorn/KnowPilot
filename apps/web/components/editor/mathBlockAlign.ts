/**
 * 公式块对齐：默认 center；靠左时写入首行 `% kp-align: left`，Markdown 可往返。
 */

export type MathBlockAlign = "center" | "left";

const ALIGN_LINE_RE = /^%[ \t]*kp-align:[ \t]*(center|left)[ \t]*\r?\n?/i;

export function parseMathBlockPayload(raw: string): {
  value: string;
  align: MathBlockAlign;
} {
  const src = raw ?? "";
  const m = src.match(ALIGN_LINE_RE);
  if (!m) return { value: src, align: "center" };
  const align = (m[1]!.toLowerCase() === "left" ? "left" : "center") as MathBlockAlign;
  return { value: src.slice(m[0].length), align };
}

/** 序列化进 $$…$$：center 不写 meta，left 写首行注释 */
export function serializeMathBlockPayload(value: string, align: MathBlockAlign): string {
  const body = value ?? "";
  if (align === "left") return `% kp-align: left\n${body}`;
  // 去掉误残留的 meta
  return parseMathBlockPayload(body).value;
}

export function normalizeMathAlign(v: unknown): MathBlockAlign {
  return v === "left" ? "left" : "center";
}
