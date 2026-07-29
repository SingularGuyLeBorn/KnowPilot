"use client";

import { trpc } from "@/lib/trpc";
import { postDetailHref } from "@/lib/postHref";
import { PostLinkPreview } from "./PostLinkPreview";

interface WikiLinkProps {
  target: string;
  children: React.ReactNode;
  /** 优先在该花园内匹配 slug/title */
  preferGarden?: string;
}

function matchPost(
  posts: Array<{ slug: string; title: string; garden: string }>,
  target: string,
  preferGarden?: string,
) {
  const normalizedTarget = target.trim().toLowerCase();
  const pool = preferGarden
    ? [
        ...posts.filter((p) => p.garden === preferGarden),
        ...posts.filter((p) => p.garden !== preferGarden),
      ]
    : posts;

  return pool.find((post) => {
    if (post.slug.toLowerCase() === normalizedTarget) return true;
    if (post.title.toLowerCase() === normalizedTarget) return true;
    // 允许 wiki 只写末段：[[ddpm]] → 01-foundations/ddpm
    if (post.slug.toLowerCase().endsWith(`/${normalizedTarget}`)) return true;
    return false;
  });
}

export function WikiLink({ target, children, preferGarden }: WikiLinkProps) {
  const { data: posts = [] } = trpc.post.tree.useQuery(
    {},
    { staleTime: 10 * 60 * 1000 },
  );
  const match = matchPost(posts, target, preferGarden);

  if (!match) {
    return (
      <span
        className="border-b border-dashed border-muted-foreground/50 text-muted-foreground"
        title={`未找到页面：${target}`}
      >
        {children}
      </span>
    );
  }

  return (
    <PostLinkPreview
      href={postDetailHref(match.slug, match.garden)}
      slug={match.slug}
      garden={match.garden}
      title={match.title}
      className="border-b border-dashed border-primary/50 text-primary hover:border-solid"
    >
      {children}
    </PostLinkPreview>
  );
}

const WIKI_LINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

export function transformWikiLinks(content: string): string {
  return content.replace(WIKI_LINK_RE, (_, target: string, display?: string) => {
    const label = display?.trim() || target.trim();
    const encodedTarget = encodeURIComponent(target.trim());
    return `[${label}](wiki://${encodedTarget})`;
  });
}
