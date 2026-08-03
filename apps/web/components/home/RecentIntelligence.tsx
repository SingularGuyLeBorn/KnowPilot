"use client";

import { motion } from "framer-motion";
import { ArrowUpRight, Calendar, FileText, Tag } from "lucide-react";
import Link from "next/link";
import { BlurFade } from "@/components/magicui/blur-fade";
import { ShineBorder } from "@/components/magicui/shine-border";
import { FloatingShapes } from "@/components/FloatingShapes";
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

const CARD_GLOWS = [
  "rgba(var(--kp-accent-rgb), 0.28)",
  "rgba(var(--kp-brand-rgb), 0.32)",
  "rgba(56, 120, 140, 0.28)",
  "rgba(var(--kp-accent-rgb), 0.22)",
  "rgba(var(--kp-brand-rgb), 0.26)",
  "rgba(90, 110, 70, 0.28)",
];

function formatDate(input: string | Date) {
  const date = typeof input === "string" ? new Date(input) : input;
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function postHref(post: Post) {
  if (post.garden && post.garden !== "posts") {
    return `/posts/${encodeURIComponent(post.slug)}?garden=${encodeURIComponent(post.garden)}`;
  }
  return `/posts/${encodeURIComponent(post.slug)}`;
}

export function RecentIntelligence({ posts }: RecentIntelligenceProps) {
  const [featured, ...rest] = posts;

  return (
    <section className="relative overflow-hidden px-[5%] py-24 md:px-[8%] lg:px-[10%]">
      <div className="absolute inset-0 bg-[var(--kp-bg)]" />
      <FloatingShapes variant="dot-grid" className="opacity-50" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(var(--kp-brand-rgb),0.08),transparent_45%)]" />

      <div className="relative mx-auto max-w-6xl">
        <BlurFade direction="down" delay={0.05} className="mb-14 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--kp-accent)]">
              Growing notes
            </p>
            <h2 className="mb-3 text-3xl font-bold tracking-tight text-[var(--kp-text-1)] md:text-5xl">
              最近文章
            </h2>
            <p className="max-w-lg text-[var(--kp-text-2)]">
              从想法到发布，记录正在生长的知识。
            </p>
          </div>
          <Link
            href="/posts"
            className="group inline-flex items-center gap-1.5 rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] px-4 py-2 text-sm font-medium text-[var(--kp-brand-deep)] transition-all hover:border-[var(--kp-accent)] hover:text-[var(--kp-accent-deep)]"
          >
            查看全部
            <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </Link>
        </BlurFade>

        {posts.length === 0 ? (
          <BlurFade>
            <div className="grid gap-5 rounded-[2rem] border border-dashed border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/50 p-10 text-center md:p-16">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]">
                <FileText className="h-7 w-7" />
              </div>
              <h3 className="text-xl font-semibold text-[var(--kp-text-1)]">花园还在播种</h3>
              <p className="mx-auto max-w-sm text-sm text-[var(--kp-text-2)]">
                暂无已发布文章。去编辑器写第一篇，Agent 会帮你整理成可生长的笔记。
              </p>
              <Link
                href="/editor"
                className="mx-auto inline-flex items-center gap-2 rounded-full bg-[var(--kp-accent)] px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--kp-accent-deep)]"
              >
                开始写作
              </Link>
            </div>
          </BlurFade>
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {featured && (
              <BlurFade direction="down" delay={0.1} className="md:col-span-2 lg:col-span-2 lg:row-span-2">
                <FeaturedArticleCard post={featured} index={0} />
              </BlurFade>
            )}
            {rest.map((post, index) => (
              <BlurFade key={post.id} direction="down" delay={0.15 + index * 0.08}>
                <ArticleCard post={post} index={index + 1} />
              </BlurFade>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function FeaturedArticleCard({ post, index }: { post: Post; index: number }) {
  return (
    <Link
      href={postHref(post)}
      className="group relative flex h-full min-h-[340px] flex-col overflow-hidden rounded-[1.75rem] border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/70 p-7 backdrop-blur-md transition-all duration-500 hover:-translate-y-1.5 hover:border-[var(--kp-brand-light)] hover:shadow-[0_24px_60px_rgba(var(--kp-accent-rgb),0.14)] md:p-8"
    >
      <ShineBorder
        borderWidth={1}
        duration={18}
        shineColor={["var(--kp-accent)", "var(--kp-brand-light)"]}
        className="rounded-[1.75rem] opacity-0 transition-opacity duration-500 group-hover:opacity-100"
      />
      <div className="relative z-10 flex flex-1 flex-col">
        <div className="mb-4 flex items-center gap-3 text-xs text-[var(--kp-text-3)]">
          {post.category ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--kp-accent-soft)] px-2.5 py-1 font-medium text-[var(--kp-accent-deep)]">
              <Tag className="h-3 w-3" />
              {post.category}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {formatDate(post.createdAt)}
          </span>
        </div>

        <h3 className="mb-4 text-2xl font-semibold leading-tight text-[var(--kp-text-1)] transition-colors group-hover:text-[var(--kp-accent-deep)] md:text-3xl">
          {post.title}
        </h3>

        <p className="mb-6 flex-1 text-base leading-relaxed text-[var(--kp-text-2)]">
          {post.excerpt || "暂无摘要"}
        </p>

        <div className="flex flex-wrap gap-2">
          {post.tags.slice(0, 5).map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg)]/60 px-2.5 py-1 text-xs text-[var(--kp-text-3)] transition-colors group-hover:border-[var(--kp-accent)]/30"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      <motion.div
        className="pointer-events-none absolute -bottom-12 -right-10 h-56 w-56 rounded-full blur-3xl"
        style={{ background: `radial-gradient(circle, ${CARD_GLOWS[index % CARD_GLOWS.length]}, transparent 70%)` }}
        initial={{ opacity: 0 }}
        whileHover={{ opacity: 1, scale: 1.1 }}
        transition={{ duration: 0.5 }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[3px] opacity-80 transition-opacity group-hover:opacity-100"
        style={{ background: `linear-gradient(90deg, ${CARD_GLOWS[index % CARD_GLOWS.length]}, transparent)` }}
      />
    </Link>
  );
}

function ArticleCard({ post, index }: { post: Post; index: number }) {
  return (
    <Link
      href={postHref(post)}
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-[1.75rem] border border-[var(--kp-divider)] p-6 transition-all duration-500 hover:-translate-y-1.5 hover:border-[var(--kp-brand-light)]",
        index % 2 === 0
          ? "bg-[var(--kp-bg-alt)]/70 backdrop-blur-md"
          : "bg-[var(--kp-brand-soft)]/40",
      )}
    >
      <div className="mb-3 flex items-center gap-2 text-xs text-[var(--kp-text-3)]">
        {post.category ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--kp-accent-soft)] px-2 py-0.5 font-medium text-[var(--kp-accent-deep)]">
            <Tag className="h-3 w-3" />
            {post.category}
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1">
          <Calendar className="h-3 w-3" />
          {formatDate(post.createdAt)}
        </span>
      </div>

      <h3 className="mb-3 line-clamp-2 text-lg font-semibold text-[var(--kp-text-1)] transition-colors group-hover:text-[var(--kp-accent-deep)]">
        {post.title}
      </h3>

      <p className="mb-4 line-clamp-3 flex-1 text-sm leading-relaxed text-[var(--kp-text-2)]">
        {post.excerpt || "暂无摘要"}
      </p>

      <div className="flex flex-wrap gap-1.5">
        {post.tags.slice(0, 3).map((tag) => (
          <span
            key={tag}
            className="rounded-full border border-[var(--kp-divider)] px-2 py-0.5 text-[10px] text-[var(--kp-text-3)] transition-colors group-hover:border-[var(--kp-accent)]/30"
          >
            {tag}
          </span>
        ))}
      </div>
    </Link>
  );
}
