/**
 * 从工具结果中提取可预览的图片 URL（browser_screenshot / scroll_screenshot 等）。
 * 路径统一成 Next rewrite 可代理的 `/uploads/...`。
 */

export type ToolResultImage = { src: string; label?: string };

/** content/uploads/xxx 或 /uploads/xxx → /uploads/xxx */
export function resolveUploadPublicUrl(pathOrUrl: string): string | null {
  const s = pathOrUrl.trim();
  if (!s) return null;
  if (s.startsWith("/uploads/")) return s;
  // 外链图片（少见）；Chat 内直接用
  if (/^https?:\/\//i.test(s) && /\.(png|jpe?g|gif|webp)(\?|$)/i.test(s)) return s;
  const normalized = s.replace(/\\/g, "/").replace(/^\/+/, "");
  const m = normalized.match(/^(?:content\/)?uploads\/(.+)$/i);
  if (m) return `/uploads/${m[1]}`;
  return null;
}

function pushImage(out: ToolResultImage[], src: string | null, label?: string) {
  if (!src) return;
  if (out.some((i) => i.src === src)) return;
  out.push(label ? { src, label } : { src });
}

/** 从 tool result 抽出截图预览列表 */
export function extractToolResultImages(result: unknown): ToolResultImage[] {
  if (!result || typeof result !== "object") return [];
  const r = result as Record<string, unknown>;
  const out: ToolResultImage[] = [];

  if (typeof r.publicUrl === "string") {
    pushImage(out, resolveUploadPublicUrl(r.publicUrl), typeof r.title === "string" ? r.title : undefined);
  }
  if (typeof r.path === "string" && /\.(png|jpe?g|gif|webp)$/i.test(r.path)) {
    pushImage(out, resolveUploadPublicUrl(r.path));
  }

  if (Array.isArray(r.screenshots)) {
    for (const item of r.screenshots) {
      if (!item || typeof item !== "object") continue;
      const s = item as Record<string, unknown>;
      const src =
        typeof s.publicUrl === "string"
          ? resolveUploadPublicUrl(s.publicUrl)
          : typeof s.path === "string"
            ? resolveUploadPublicUrl(s.path)
            : null;
      const label = typeof s.step === "number" ? `第 ${s.step + 1} 屏` : undefined;
      pushImage(out, src, label);
    }
  }

  return out;
}
