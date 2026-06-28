"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc";

interface WikiLinkProps {
  target: string;
  children: React.ReactNode;
}

export function WikiLink({ target, children }: WikiLinkProps) {
  const { data: posts = [] } = trpc.post.tree.useQuery();

  const normalizedTarget = target.trim().toLowerCase();
  const match = posts.find((post) => {
    if (post.slug.toLowerCase() === normalizedTarget) return true;
    if (post.title.toLowerCase() === normalizedTarget) return true;
    return false;
  });

  if (!match) {
    return (
      <span className="border-b border-dashed border-muted-foreground/50 text-muted-foreground" title={`未找到页面：${target}`}>
        {children}
      </span>
    );
  }

  return (
    <Link
      href={`/posts/${encodeURIComponent(match.slug)}`}
      className="border-b border-dashed border-primary/50 text-primary hover:border-solid"
      title={match.title}
    >
      {children}
    </Link>
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
