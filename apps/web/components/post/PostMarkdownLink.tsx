"use client";

import Link from "next/link";
import type { ComponentPropsWithoutRef } from "react";
import { trpc } from "@/lib/trpc";
import { isExternalHref, resolvePostLinkHref } from "@/lib/postHref";
import { WikiLink } from "./WikiLink";

interface PostMarkdownLinkProps extends ComponentPropsWithoutRef<"a"> {
  href?: string;
  postSlug?: string;
}

export function PostMarkdownLink({ href, postSlug, children, ...props }: PostMarkdownLinkProps) {
  const { data: posts = [] } = trpc.post.tree.useQuery();

  if (!href) {
    return <span {...props}>{children}</span>;
  }

  if (href.startsWith("wiki://")) {
    const target = decodeURIComponent(href.slice(7));
    return <WikiLink target={target}>{children}</WikiLink>;
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

  const postHref = resolvePostLinkHref(href, posts, postSlug);
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
      title={`未找到页面：${href}`}
      {...props}
    >
      {children}
    </span>
  );
}
