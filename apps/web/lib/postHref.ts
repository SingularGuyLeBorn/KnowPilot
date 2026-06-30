export interface PostTreeItem {
  slug: string;
  title: string;
}

const EXTERNAL_HREF_RE = /^([a-z][a-z0-9+.-]*:|\/\/)/i;

export function isExternalHref(href: string): boolean {
  return EXTERNAL_HREF_RE.test(href);
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

/** 在文章树中查找与 Markdown 链接对应的文章 slug */
export function findPostSlugByHref(href: string, posts: PostTreeItem[]): string | null {
  const target = normalizeMdTarget(href);
  if (!target) return null;

  const exact = posts.find(
    (post) => post.slug === target || post.slug.toLowerCase() === target.toLowerCase(),
  );
  if (exact) return exact.slug;

  const suffixMatches = posts.filter(
    (post) => post.slug.endsWith(`/${target}`) || post.slug.endsWith(target),
  );
  if (suffixMatches.length === 1) return suffixMatches[0].slug;

  const basename = target.split("/").pop();
  if (!basename) return null;

  const folderFileMatches = posts.filter((post) => post.slug.endsWith(`/${basename}/${basename}`));
  if (folderFileMatches.length === 1) return folderFileMatches[0].slug;

  const basenameMatches = posts.filter((post) => {
    const parts = post.slug.split("/");
    return parts[parts.length - 1] === basename;
  });
  if (basenameMatches.length === 1) return basenameMatches[0].slug;

  return null;
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
    if (resolved && posts.some((post) => post.slug === resolved)) {
      return `/posts/${encodeURIComponent(resolved)}`;
    }
  }

  const matched = findPostSlugByHref(href, posts);
  if (matched) {
    return `/posts/${encodeURIComponent(matched)}`;
  }

  return null;
}
