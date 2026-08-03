"use client";

import { ArrowUpRight, Calendar, FileText, Tag } from "lucide-react";
import Link from "next/link";
import { ScrollReveal } from "@/components/magicui/scroll-reveal";
import { cn } from "@/lib/utils";

interface Post {
  id: string;
  slug: string;
  garden?: string;
  title: string;
  excerpt: string | null;
  category: string | null;
  tags: string[];
  createdAt: string | Date;
}

interface RecentIntelligenceProps {
  posts: Post[];
}

function formatDate(input: string | Date) {
  const date = typeof input === "string" ? new Date(input) : input;
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "short", day: "numeric" });
}

function postHref(post: Post) {
  if (post.garden && post.garden !== "posts") {
    return `/posts/${encodeURIComponent(post.slug)}?garden=${encodeURIComponent(post.garden)}`;
  }
  return `/posts/${encodeURIComponent(post.slug)}`;
}

function gradientFromTitle(title: string) {
  let hash = 0;
  for (let i = 0; i < title.length; i++) hash = (hash * 31 + title.charCodeAt(i)) % 360;
  return `linear-gradient(135deg, hsl(${hash} 28% 78%), hsl(${(hash + 40) % 360} 30% 70%))`;
}

const categoryColors: Record<string, string> = {
  入门: "bg-[var(--kp-accent-soft)] text-[var(--kp-accent-deep)]",
  测试: "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]",
  教程: "bg-[var(--kp-accent)]/10 text-[var(--kp-accent-deep)]",
  原理: "bg-[var(--kp-brand-1)]/10 text-[var(--kp-brand-deep)]",
};

export function RecentIntelligence({ posts }: RecentIntelligenceProps) {
  if (posts.length === 0) {
    return (
      <section className="relative overflow-hidden bg-[var(--kp-bg)] px-6 py-10 lg:px-12 lg:py-12">
        <div className="relative z-10 mx-auto max-w-7xl">
          <div className="kp-card-dense flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-center">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[var(--kp-text-1)]">花园还在播种</h3>
              <p className="text-xs text-[var(--kp-text-2)]">
                暂无已发布文章。去编辑器写第一篇，Agent 会帮你整理成可生长的笔记。
              </p>
            </div>
            <Link
              href="/editor"
              className="ml-auto inline-flex items-center gap-1 rounded-full bg-[var(--kp-accent)] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[var(--kp-accent-deep)]"
            >
              开始写作 <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const [featured, ...rest] = posts;
  const sidePosts = rest.slice(0, 3);
  const gridPosts = rest.slice(3, 6);

  return (
    <section className="relative overflow-hidden bg-[var(--kp-bg)] px-6 py-12 lg:px-12 lg:py-16">
      <div className="relative z-10 mx-auto max-w-7xl">
        <ScrollReveal className="mb-6 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--kp-accent)]">
              Growing notes
            </p>
            <h2 className="text-2xl font-bold tracking-tight text-[var(--kp-text-1)] md:text-3xl">
              最近<span className="text-[var(--kp-accent-deep)]">生长</span>的笔记
            </h2>
          </div>
          <Link
            href="/posts"
            className="group inline-flex items-center gap-1 rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] px-3 py-1.5 text-xs font-medium text-[var(--kp-brand-deep)] transition-colors hover:border-[var(--kp-accent)] hover:text-[var(--kp-accent-deep)]"
          >
            查看全部 <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </Link>
        </ScrollReveal>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          {featured && (
            <ScrollReveal className="lg:col-span-7 lg:row-span-2">
              <Link
                href={postHref(featured)}
                className="group kp-card-dense relative flex h-full min-h-[280px] flex-col overflow-hidden"
              >
                <div
                  className="h-36 w-full bg-cover bg-center transition-transform duration-500 group-hover:scale-105"
                  style={{ backgroundImage: gradientFromTitle(featured.title) }}
                />
                <div className="flex flex-1 flex-col p-4">
                  <div className="mb-2 flex items-center gap-2 text-[11px] text-[var(--kp-text-3)]">
                    {featured.category ? (
                      <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold", categoryColors[featured.category] ?? "bg-[var(--kp-accent-soft)] text-[var(--kp-accent-deep)]")}>
                        <Tag className="h-3 w-3" /> {featured.category}
                      </span>
                    ) : null}
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="h-3 w-3" /> {formatDate(featured.createdAt)}
                    </span>
                  </div>
                  <h3 className="mb-2 text-xl font-bold leading-tight text-[var(--kp-text-1)] transition-colors group-hover:text-[var(--kp-accent-deep)] md:text-2xl">
                    {featured.title}
                  </h3>
                  <p className="mb-3 line-clamp-3 max-w-lg text-sm leading-relaxed text-[var(--kp-text-2)]">
                    {featured.excerpt || "暂无摘要"}
                  </p>
                  <div className="mt-auto flex flex-wrap gap-1">
                    {featured.tags.slice(0, 5).map((tag) => (
                      <span key={tag} className="rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg)]/60 px-2 py-0.5 text-[10px] text-[var(--kp-text-3)]">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </Link>
            </ScrollReveal>
          )}

          <div className="flex flex-col gap-3 lg:col-span-5">
            {sidePosts.map((post) => (
              <ScrollReveal key={post.id} delay={0.1}>
                <ArticleCard post={post} compact />
              </ScrollReveal>
            ))}
          </div>

          {gridPosts.map((post, i) => (
            <ScrollReveal key={post.id} delay={0.1 + i * 0.06} className="lg:col-span-4">
              <ArticleCard post={post} />
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function ArticleCard({ post, compact }: { post: Post; compact?: boolean }) {
  const categoryClass = categoryColors[post.category ?? ""] || "bg-[var(--kp-accent-soft)] text-[var(--kp-accent-deep)]";
  return (
    <Link
      href={postHref(post)}
      className={cn(
        "group kp-card-dense flex h-full flex-col overflow-hidden p-4",
        compact ? "justify-center" : "",
      )}
    >
      <div className="mb-2 flex items-center gap-2 text-[11px] text-[var(--kp-text-3)]">
        {post.category ? (
          <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold", categoryClass)}>
            <Tag className="h-3 w-3" /> {post.category}
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1">
          <Calendar className="h-3 w-3" /> {formatDate(post.createdAt)}
        </span>
      </div>

      <h3 className={cn("mb-1 font-bold text-[var(--kp-text-1)] transition-colors group-hover:text-[var(--kp-accent-deep)]", compact ? "text-base" : "text-sm")}>
        {post.title}
      </h3>

      {!compact && (
        <p className={cn("mb-2 line-clamp-2 flex-1 text-xs leading-relaxed text-[var(--kp-text-2)]", post.excerpt ? "" : "italic")}>
          {post.excerpt || "暂无摘要"}
        </p>
      )}

      <div className="mt-auto flex items-center justify-between">
        <div className="flex flex-wrap gap-1">
          {post.tags.slice(0, compact ? 2 : 3).map((tag) => (
            <span key={tag} className="rounded-full border border-[var(--kp-divider)] px-1.5 py-0.5 text-[10px] text-[var(--kp-text-3)]">
              {tag}
            </span>
          ))}
        </div>
        <ArrowUpRight className="h-3.5 w-3.5 text-[var(--kp-text-3)] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}
