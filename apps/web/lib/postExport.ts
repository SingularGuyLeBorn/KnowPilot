import JSZip from "jszip";

export interface PostExportInput {
  title: string;
  slug: string;
  content: string;
  excerpt?: string | null;
  category?: string | null;
  tags?: string[];
  published?: boolean;
}

const MD_IMAGE_RE = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const HTML_IMG_RE = /<img[^>]+src=["']([^"']+)["']/gi;
const EXTERNAL_SRC_RE = /^([a-z][a-z0-9+.-]*:|\/\/)/i;

function serializePostMarkdown(post: PostExportInput): string {
  const tagsYaml =
    post.tags && post.tags.length > 0
      ? `\ntags:\n${post.tags.map((tag) => `  - "${tag.replace(/"/g, '\\"')}"`).join("\n")}`
      : "";
  return `---
title: "${post.title.replace(/"/g, '\\"')}"
category: ${post.category ? `"${post.category.replace(/"/g, '\\"')}"` : "null"}${tagsYaml}
published: ${post.published ?? true}
excerpt: ${post.excerpt ? `"${post.excerpt.replace(/"/g, '\\"')}"` : "null"}
---
${post.content}
`;
}

function collectImageSources(content: string): string[] {
  const sources = new Set<string>();
  for (const re of [MD_IMAGE_RE, HTML_IMG_RE]) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      const src = match[1]?.trim();
      if (src && !src.startsWith("#")) sources.add(src);
    }
  }
  return Array.from(sources);
}

function resolveAssetPath(src: string, postSlug: string): string | null {
  if (src.startsWith("data:")) return null;
  if (src.startsWith("/api/posts/assets")) {
    return src.replace(/^\/api\/posts\/assets/, "") || "/";
  }
  if (src.startsWith("/")) {
    return src;
  }
  if (EXTERNAL_SRC_RE.test(src)) return null;

  const slugDir = postSlug.replace(/\/[^/]+$/, "");
  const base = `http://a/${slugDir ? `${slugDir}/` : ""}`;
  try {
    return new URL(src, base).pathname;
  } catch {
    return null;
  }
}

function resolveFetchUrl(src: string, postSlug: string): string | null {
  if (src.startsWith("data:")) return src;
  if (EXTERNAL_SRC_RE.test(src)) return src;

  const assetPath = resolveAssetPath(src, postSlug);
  if (!assetPath) return null;
  return `/api/posts/assets${assetPath.startsWith("/") ? assetPath : `/${assetPath}`}`;
}

function assetFileName(index: number, src: string): string {
  const raw = src.split("/").pop()?.split("?")[0] || `image-${index}`;
  const safe = raw.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${String(index + 1).padStart(3, "0")}-${safe}`;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function replaceAll(content: string, replacements: Map<string, string>): string {
  let next = content;
  for (const [from, to] of replacements) {
    next = next.split(from).join(to);
  }
  return next;
}

/** 导出 Markdown + 图片资源 ZIP */
export async function exportPostMarkdownZip(post: PostExportInput): Promise<void> {
  const zip = new JSZip();
  const baseName = post.slug.split("/").pop() || "post";
  const replacements = new Map<string, string>();
  const imageSources = collectImageSources(post.content);

  const assetsFolder = zip.folder("assets");
  if (!assetsFolder) throw new Error("无法创建 ZIP 资源目录");

  await Promise.all(
    imageSources.map(async (src, index) => {
      const fetchUrl = resolveFetchUrl(src, post.slug);
      if (!fetchUrl) return;

      try {
        const response = await fetch(fetchUrl);
        if (!response.ok) return;
        const blob = await response.blob();
        const fileName = assetFileName(index, src);
        assetsFolder.file(fileName, blob);
        replacements.set(src, `./assets/${fileName}`);
      } catch {
        // 保留原始链接
      }
    }),
  );

  const markdown = replaceAll(serializePostMarkdown(post), replacements);
  zip.file(`${baseName}.md`, markdown);

  const blob = await zip.generateAsync({ type: "blob" });
  triggerDownload(blob, `${baseName}.zip`);
}

/** 导出 PDF（基于文章 DOM） */
export async function exportPostPdf(
  element: HTMLElement,
  filename: string,
): Promise<void> {
  const html2pdf = (await import("html2pdf.js")).default;
  const safeName = filename.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);

  await html2pdf()
    .set({
      margin: [12, 12, 12, 12],
      filename: `${safeName}.pdf`,
      image: { type: "jpeg", quality: 0.92 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        logging: false,
        scrollY: 0,
      },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
    })
    .from(element)
    .save();
}
