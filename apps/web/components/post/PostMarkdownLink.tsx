"use client";

import Link from "next/link";
import type { ComponentPropsWithoutRef } from "react";
import { DEFAULT_POST_GARDEN } from "@knowpilot/shared";
import { trpc } from "@/lib/trpc";
import {
  isExternalHref,
  postDetailHref,
  resolvePostLinkHref,
  resolvePostLinkTarget,
} from "@/lib/postHref";
import { WikiLink } from "./WikiLink";
import { PostLinkPreview } from "./PostLinkPreview";

interface PostMarkdownLinkProps extends ComponentPropsWithoutRef<"a"> {
  href?: string;
  postSlug?: string;
  postGarden?: string;
}

export function PostMarkdownLink({
  href,
  postSlug,
  postGarden,
  children,
  ...props
}: PostMarkdownLinkProps) {
  // 全库树用于相对路径/跨库解析；同库优先在 resolvePostLinkHref / WikiLink 内处理
  const { data: posts = [] } = trpc.post.tree.useQuery(
    {},
    { staleTime: 10 * 60 * 1000 },
  );

  if (!href) {
    return <span {...props}>{children}</span>;
  }

  if (href.startsWith("wiki://")) {
    const target = decodeURIComponent(href.slice(7));
    return (
      <WikiLink target={target} preferGarden={postGarden}>
        {children}
      </WikiLink>
    );
  }

  if (href.startsWith("#")) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  }

  if (isExternalHref(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </a>
    );
  }

  const target = resolvePostLinkTarget(href, posts, postSlug, postGarden);
  if (target) {
    const garden = target.garden ?? postGarden ?? DEFAULT_POST_GARDEN;
    return (
      <PostLinkPreview
        href={postDetailHref(target.slug, garden)}
        slug={target.slug}
        garden={garden}
        title={target.title}
        className={props.className}
      >
        {children}
      </PostLinkPreview>
    );
  }

  const postHref = resolvePostLinkHref(href, posts, postSlug, postGarden);
  if (postHref) {
    return (
      <Link href={postHref} {...props}>
        {children}
      </Link>
    );
  }

  if (href.startsWith("/") && !href.endsWith(".md")) {
    return (
      <Link href={href} {...props}>
        {children}
      </Link>
    );
  }

  return (
    <span
      className="border-b border-dashed border-muted-foreground/50 text-muted-foreground"
      title={`未找到文章：${href}（先创建目标页或检查路径）`}
      {...props}
    >
      {children}
    </span>
  );
}
