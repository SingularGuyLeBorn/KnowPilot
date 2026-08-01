/**
 * 解析/序列化 raw `<mark>` HTML（受限：只认 <mark> 标签）。
 */

export interface MarkHtmlData {
  raw: string;
  value: string;
  annotation: string;
  color: string;
  strokeWidth: number;
  padding: number;
  iterations: number;
  multiline: boolean;
  animate: boolean;
  animationDuration: number;
  bracket: string;
}

const DEFAULTS = {
  annotation: "underline",
  color: "",
  strokeWidth: 2,
  padding: 2,
  iterations: 2,
  multiline: true,
  animate: true,
  animationDuration: 800,
  bracket: "",
};

export function parseMarkHtml(raw: string): MarkHtmlData | null {
  if (!raw || !raw.startsWith("<mark")) return null;
  const m = raw.match(/^<mark\b\s*([^>]*)>([\s\S]*?)<\/mark>$/i);
  if (!m) return null;
  const [, attrString, value] = m;
  const attrs = parseAttributes(attrString ?? "");
  return {
    raw,
    value: value ?? "",
    annotation: attrs["data-annotation"] || DEFAULTS.annotation,
    color: attrs["data-color"] || DEFAULTS.color,
    strokeWidth: parseNumber(attrs["data-stroke-width"], DEFAULTS.strokeWidth),
    padding: parseNumber(attrs["data-padding"], DEFAULTS.padding),
    iterations: parseNumber(attrs["data-iterations"], DEFAULTS.iterations),
    multiline: parseBoolean(attrs["data-multiline"], DEFAULTS.multiline),
    animate: parseBoolean(attrs["data-animate"], DEFAULTS.animate),
    animationDuration: parseNumber(attrs["data-animation-duration"], DEFAULTS.animationDuration),
    bracket: attrs["data-bracket"] || DEFAULTS.bracket,
  };
}

function parseAttributes(s: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^=\s]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const key = m[1];
    const value = m[2] ?? m[3] ?? m[4] ?? "";
    attrs[key] = value;
  }
  return attrs;
}

function parseNumber(s: string | undefined, def: number): number {
  if (s == null || s === "") return def;
  const n = Number(s);
  return Number.isFinite(n) ? n : def;
}

function parseBoolean(s: string | undefined, def: boolean): boolean {
  if (s == null || s === "") return def;
  if (s === "true") return true;
  if (s === "false") return false;
  return def;
}

export function serializeMarkHtml(attrs: MarkHtmlData): string {
  const parts = [`<mark data-annotation="${attrs.annotation}"`];
  if (attrs.color) parts.push(`data-color="${attrs.color}"`);
  if (attrs.strokeWidth !== DEFAULTS.strokeWidth) parts.push(`data-stroke-width="${attrs.strokeWidth}"`);
  if (attrs.padding !== DEFAULTS.padding) parts.push(`data-padding="${attrs.padding}"`);
  if (attrs.iterations !== DEFAULTS.iterations) parts.push(`data-iterations="${attrs.iterations}"`);
  if (attrs.multiline !== DEFAULTS.multiline) parts.push(`data-multiline="${attrs.multiline}"`);
  if (attrs.animate !== DEFAULTS.animate) parts.push(`data-animate="${attrs.animate}"`);
  if (attrs.animationDuration !== DEFAULTS.animationDuration) {
    parts.push(`data-animation-duration="${attrs.animationDuration}"`);
  }
  if (attrs.bracket) parts.push(`data-bracket="${attrs.bracket}"`);
  parts.push(`>${attrs.value}</mark>`);
  return parts.join(" ");
}
