/**
 * ```viz 围栏解析（零 Remotion 依赖，可被单测 / PostContent 轻量引用）
 */

export type VizSpec = {
  composition?: string;
  src?: string;
  title?: string;
  poster?: string;
  props: Record<string, unknown>;
};

function parseScalar(raw: string): unknown {
  const v = raw.trim();
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (
    (v.startsWith("[") && v.endsWith("]")) ||
    (v.startsWith("{") && v.endsWith("}"))
  ) {
    try {
      return JSON.parse(v) as unknown;
    } catch {
      // fallthrough
    }
  }
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }
  return v;
}

export function parseVizFence(raw: string): VizSpec | null {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  const entries: Array<{ key: string; value: string }> = [];
  for (const line of lines) {
    const m = /^([a-zA-Z_][\w-]*)\s*:\s*(.+)$/.exec(line);
    if (m) {
      entries.push({ key: m[1], value: m[2].trim() });
      continue;
    }
    if (lines.length === 1 && !line.includes(":")) {
      if (line.startsWith("/") || /^https?:\/\//i.test(line)) {
        return { src: line, props: {} };
      }
      return { composition: line, props: {} };
    }
  }

  const reserved = new Set([
    "composition",
    "comp",
    "src",
    "url",
    "video",
    "title",
    "caption",
    "poster",
  ]);
  const props: Record<string, unknown> = {};
  let composition: string | undefined;
  let src: string | undefined;
  let title: string | undefined;
  let poster: string | undefined;

  for (const { key, value } of entries) {
    const low = key.toLowerCase();
    if (low === "composition" || low === "comp") {
      composition = value;
      continue;
    }
    if (low === "src" || low === "url" || low === "video") {
      src = value;
      continue;
    }
    if (low === "title" || low === "caption") {
      title = value;
      continue;
    }
    if (low === "poster") {
      poster = value;
      continue;
    }
    if (reserved.has(low)) continue;
    props[key] = parseScalar(value);
  }

  if (!composition && !src) return null;

  return { composition, src, title, poster, props };
}

export function normalizeVizSrc(src: string): string {
  if (/^https?:\/\//i.test(src) || src.startsWith("/")) return src;
  if (src.startsWith("content/uploads/")) return `/${src.slice("content/".length)}`;
  if (src.startsWith("uploads/")) return `/${src}`;
  return src;
}
