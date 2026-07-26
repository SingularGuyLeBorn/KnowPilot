/**
 * 文章链接解析与生成。
 * - 详情 URL：默认花园 posts 走 /posts/{slug}；其它花园带 ?garden=
 * - Markdown 相对链接 / wiki 解析：在 tree 结果里按 slug 匹配，并带上 garden
 */
import { DEFAULT_POST_GARDEN } from "@knowpilot/shared";

export interface PostTreeItem {
  slug: string;
  title: string;
  /** 知识库花园 id；缺省按 posts */
  garden?: string;
}

const EXTERNAL_HREF_RE = /^([a-z][a-z0-9+.-]*:|\/\/)/i;

export function isExternalHref(href: string): boolean {
  return EXTERNAL_HREF_RE.test(href);
}

/**
 * 文章详情链接：默认花园 posts 走 /posts/{slug}；其它花园带 ?garden=
 * slug 可含 /，统一 encodeURIComponent。
 */
export function postDetailHref(slug: string, garden: string = DEFAULT_POST_GARDEN): string {
  const encoded = encodeURIComponent(slug);
  if (!garden || garden === DEFAULT_POST_GARDEN) return `/posts/${encoded}`;
  return `/posts/${encoded}?garden=${encodeURIComponent(garden)}`;
}

/** 将相对 Markdown 路径解析为 post slug（不含 .md 后缀） */
export function resolveRelativeMdSlug(href: string, postSlug: string): string | null {
  if (isExternalHref(href) || href.startsWith("#")) return null;

  const slugDir = postSlug.replace(/\/[^/]+$/, "");
  const base = `http://a/${slugDir ? `${slugDir}/` : ""}`;

  try {
    let path = new URL(href, base).pathname.replace(/^\//, "");
    if (path.endsWith(".md")) path = path.slice(0, -3);
    return path || null;
  } catch {
    return null;
  }
}

/** 规范化链接目标（处理 ../、./ 与 .md 后缀） */
export function normalizeMdTarget(href: string): string {
  const clean = href.split(/[#?]/)[0]?.trim() ?? "";
  try {
    let path = new URL(clean, "http://a/base/").pathname.replace(/^\//, "");
    if (path.endsWith(".md")) path = path.slice(0, -3);
    return path;
  } catch {
    let path = clean.replace(/^\.\//, "").replace(/^\//, "");
    if (path.endsWith(".md")) path = path.slice(0, -3);
    return path;
  }
}

function pickPreferGarden(
  matches: PostTreeItem[],
  preferGarden?: string,
): PostTreeItem | null {
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];
  if (preferGarden) {
    const inGarden = matches.find((p) => (p.garden ?? DEFAULT_POST_GARDEN) === preferGarden);
    if (inGarden) return inGarden;
  }
  return matches[0];
}

/** 在文章树中查找与 Markdown 链接对应的文章（含 garden） */
export function findPostByHref(
  href: string,
  posts: PostTreeItem[],
  preferGarden?: string,
): PostTreeItem | null {
  const target = normalizeMdTarget(href);
  if (!target) return null;

  const exact = posts.filter(
    (post) => post.slug === target || post.slug.toLowerCase() === target.toLowerCase(),
  );
  const exactHit = pickPreferGarden(exact, preferGarden);
  if (exactHit) return exactHit;

  const suffixMatches = posts.filter(
    (post) => post.slug.endsWith(`/${target}`) || post.slug.endsWith(target),
  );
  const suffixHit = pickPreferGarden(suffixMatches, preferGarden);
  if (suffixHit && (suffixMatches.length === 1 || preferGarden)) return suffixHit;
  if (suffixMatches.length === 1) return suffixMatches[0];

  const basename = target.split("/").pop();
  if (!basename) return null;

  const folderFileMatches = posts.filter((post) => post.slug.endsWith(`/${basename}/${basename}`));
  const folderHit = pickPreferGarden(folderFileMatches, preferGarden);
  if (folderHit && (folderFileMatches.length === 1 || preferGarden)) return folderHit;
  if (folderFileMatches.length === 1) return folderFileMatches[0];

  const basenameMatches = posts.filter((post) => {
    const parts = post.slug.split("/");
    return parts[parts.length - 1] === basename;
  });
  const baseHit = pickPreferGarden(basenameMatches, preferGarden);
  if (baseHit && (basenameMatches.length === 1 || preferGarden)) return baseHit;
  if (basenameMatches.length === 1) return basenameMatches[0];

  return null;
}

/** 仅返回 slug；需要花园时用 findPostByHref */
export function findPostSlugByHref(href: string, posts: PostTreeItem[]): string | null {
  return findPostByHref(href, posts)?.slug ?? null;
}

export function resolvePostLinkHref(
  href: string,
  posts: PostTreeItem[],
  postSlug?: string,
  preferGarden?: string,
): string | null {
  if (href.startsWith("/posts/")) {
    return href;
  }

  if (postSlug && !href.startsWith("/") && !isExternalHref(href)) {
    const resolved = resolveRelativeMdSlug(href, postSlug);
    if (resolved) {
      const candidates = posts.filter((post) => post.slug === resolved);
      const hit = pickPreferGarden(candidates, preferGarden);
      if (hit) return postDetailHref(hit.slug, hit.garden ?? DEFAULT_POST_GARDEN);
    }
  }

  const matched = findPostByHref(href, posts, preferGarden);
  if (matched) {
    return postDetailHref(matched.slug, matched.garden ?? DEFAULT_POST_GARDEN);
  }

  return null;
}
