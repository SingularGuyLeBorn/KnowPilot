/**
 * 文章链接解析与生成。
 * - 详情 URL：默认花园 posts 走 /posts/{slug}；其它花园带 ?garden=
 * - Markdown 相对链接 / wiki 解析：在 tree 结果里按 slug 匹配，并带上 garden
 */
import { DEFAULT_POST_GARDEN, type PostGarden } from "@knowpilot/shared";

export interface PostTreeItem {
  slug: string;
  title: string;
  /** 知识库花园；缺省按 posts 处理（兼容旧 tree 缓存） */
  garden?: PostGarden | string;
}

const EXTERNAL_HREF_RE = /^([a-z][a-z0-9+.-]*:|\/\/)/i;

export function isExternalHref(href: string): boolean {
  return EXTERNAL_HREF_RE.test(href);
}

/**
 * 文章详情链接：默认花园 posts 走 /posts/{slug}；其它花园带 ?garden=
 * slug 可含 /，统一 encodeURIComponent。
 */
export function postDetailHref(slug: string, garden: PostGarden | string = DEFAULT_POST_GARDEN): string {
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

/** 在文章树中查找与 Markdown 链接对应的文章（含 garden） */
export function findPostByHref(
  href: string,
  posts: PostTreeItem[],
): PostTreeItem | null {
  const target = normalizeMdTarget(href);
  if (!target) return null;

  const exact = posts.find(
    (post) => post.slug === target || post.slug.toLowerCase() === target.toLowerCase(),
  );
  if (exact) return exact;

  const suffixMatches = posts.filter(
    (post) => post.slug.endsWith(`/${target}`) || post.slug.endsWith(target),
  );
  if (suffixMatches.length === 1) return suffixMatches[0];

  const basename = target.split("/").pop();
  if (!basename) return null;

  const folderFileMatches = posts.filter((post) => post.slug.endsWith(`/${basename}/${basename}`));
  if (folderFileMatches.length === 1) return folderFileMatches[0];

  const basenameMatches = posts.filter((post) => {
    const parts = post.slug.split("/");
    return parts[parts.length - 1] === basename;
  });
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
): string | null {
  if (href.startsWith("/posts/")) {
    return href;
  }

  if (postSlug && !href.startsWith("/") && !isExternalHref(href)) {
    const resolved = resolveRelativeMdSlug(href, postSlug);
    if (resolved) {
      const hit = posts.find((post) => post.slug === resolved);
      if (hit) return postDetailHref(hit.slug, hit.garden ?? DEFAULT_POST_GARDEN);
    }
  }

  const matched = findPostByHref(href, posts);
  if (matched) {
    return postDetailHref(matched.slug, matched.garden ?? DEFAULT_POST_GARDEN);
  }

  return null;
}
