"use client";

/**
 * 相关笔记完整版：FTS + 标签交集 + 同花园/同分类加权（post.related）。
 */

import Link from "next/link";
import { GitBranch, Loader2, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { postDetailHref } from "@/lib/postHref";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export function RelatedPosts({
  postId,
  className,
}: {
  postId: string;
  className?: string;
}) {
  const { data, isLoading, isError, error, refetch } = trpc.post.related.useQuery(
    { id: postId, limit: 8 },
    { staleTime: 60_000, enabled: !!postId },
  );

  if (isLoading) {
    return (
      <section
        className={cn("mt-10 border-t border-[var(--kp-divider)] pt-8", className)}
        data-testid="related-posts-loading"
      >
        <div className="mb-4 flex items-center gap-2 text-sm font-medium text-[var(--kp-text-2)]">
          <Sparkles className="h-4 w-4 text-[var(--kp-brand)]" />
          相关笔记
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--kp-text-3)]" />
        </div>
      </section>
    );
  }

  if (isError) {
    return (
      <section className={cn("mt-10 border-t border-[var(--kp-divider)] pt-8", className)}>
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--kp-text-2)]">
          <Sparkles className="h-4 w-4 text-[var(--kp-brand)]" />
          相关笔记
        </div>
        <p className="text-xs text-red-600">
          加载失败：{error.message}
          <button
            type="button"
            className="ml-2 underline"
            onClick={() => {
              refetch().catch(() => {});
            }}
          >
            重试
          </button>
        </p>
      </section>
    );
  }

  if (!data?.length) return null;

  return (
    <section
      className={cn("mt-10 border-t border-[var(--kp-divider)] pt-8", className)}
      data-testid="related-posts"
      aria-label="相关笔记"
    >
      <div className="mb-4 flex items-center gap-2 text-sm font-medium text-[var(--kp-text-1)]">
        <Sparkles className="h-4 w-4 text-[var(--kp-brand)]" />
        相关笔记
        <span className="text-xs font-normal text-[var(--kp-text-3)]">
          按全文 / 标签 / 花园 / 分类综合排序
        </span>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {data.map((item) => (
          <li key={item.id}>
            <Link
              href={postDetailHref(item.slug, item.garden)}
              className="group block rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/40 px-3.5 py-3 transition hover:border-[var(--kp-brand)]/40 hover:bg-[var(--kp-brand-soft)]/30"
            >
              <div className="mb-1 flex items-start justify-between gap-2">
                <h3 className="line-clamp-2 text-sm font-semibold text-[var(--kp-text-1)] group-hover:text-[var(--kp-brand-deep)]">
                  {item.title}
                </h3>
                <span className="shrink-0 tabular-nums text-[10px] text-[var(--kp-text-3)]">
                  {item.score}
                </span>
              </div>
              {item.excerpt && (
                <p className="mb-2 line-clamp-2 text-xs leading-relaxed text-[var(--kp-text-3)]">
                  {item.excerpt}
                </p>
              )}
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--kp-text-3)]">
                <span className="inline-flex items-center gap-0.5">
                  <GitBranch className="h-3 w-3" />
                  {item.garden}
                </span>
                {item.category && <span>· {item.category}</span>}
              </div>
              {item.tags.length > 0 && (
                <div className="mb-1.5 flex flex-wrap gap-1">
                  {item.tags.slice(0, 4).map((tag) => (
                    <Badge key={tag} variant="outline" className="px-1.5 py-0 text-[10px] font-normal">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
              <p className="truncate text-[10px] text-[var(--kp-text-3)]">
                {item.reasons.join(" · ")}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
