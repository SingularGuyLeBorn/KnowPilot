"use client";

import { ArrowUpRight, Calendar, FileText, Tag } from "lucide-react";
import { motion } from "framer-motion";
import Link from "next/link";
import { CurlyMark } from "@/components/home/accentMark";
import { ScrollReveal } from "@/components/magicui/scroll-reveal";
import { cn } from "@/lib/utils";

const MotionLink = motion.create(Link);

/** 与 /gardens 一致的弹簧上浮手感：物理回弹取代线性 CSS 位移 */
const hoverSpring = { type: "spring", stiffness: 260, damping: 26 } as const;

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

/** 玻璃卡片基础类：Light Glass Editorial（transform 由 Framer 弹簧接管，CSS 只过渡非位移属性） */
const glassCard =
  "rounded-3xl border border-white/60 bg-white/40 shadow-[0_8px_32px_-20px_rgba(0,80,160,0.16)] backdrop-blur-xl transition-[border-color,box-shadow,background-color] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]";

/** 环境光晕：hover 时缓缓亮起（/gardens 同款丝滑氛围） */
function HoverGlow() {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-[var(--kp-glow-peach)]/0 blur-3xl transition-all duration-500 group-hover:bg-[var(--kp-glow-peach)]/45"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-10 -left-8 h-28 w-28 rounded-full bg-[var(--kp-glow-blue)]/0 blur-3xl transition-all duration-500 group-hover:bg-[var(--kp-glow-blue)]/50"
      />
    </>
  );
}

export function RecentIntelligence({ posts }: RecentIntelligenceProps) {
  if (posts.length === 0) {
    return (
      <section className="relative overflow-hidden px-6 py-10 lg:px-12 lg:py-12">
        <div className="relative z-10 mx-auto max-w-7xl">
          <div className={cn(glassCard, "flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-center")}>
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[var(--kp-brand-light)]/30 bg-[var(--kp-brand-soft)] text-[var(--kp-brand)]">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[var(--kp-text-1)]">花园还在播种</h3>
              <p className="text-xs leading-relaxed text-[var(--kp-text-2)]">
                暂无已发布文章。去编辑器写第一篇，Agent 会帮你整理成可生长的笔记。
              </p>
            </div>
            <Link
              href="/editor"
              className="ml-auto inline-flex items-center gap-1 rounded-full bg-[var(--kp-brand)] px-4 py-2 text-xs font-semibold text-white shadow-[0_8px_20px_-8px_rgba(0,135,235,0.5)] transition hover:bg-[var(--kp-brand-dark)]"
            >
              开始写作 <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const [featured, ...rest] = posts;
  const sidePosts = rest.slice(0, 4);
  const gridPosts = rest.slice(4, 7);

  return (
    <section className="relative overflow-hidden px-6 py-12 lg:px-12 lg:py-16">
      <div className="relative z-10 mx-auto max-w-7xl">
        <ScrollReveal className="mb-8 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--kp-brand)]">
              Growing notes
            </p>
            <h2 className="text-2xl font-bold tracking-tight text-[var(--kp-text-1)] md:text-3xl">
              最近 <CurlyMark>生长</CurlyMark> 的笔记
            </h2>
          </div>
          <Link
            href="/posts"
            className="group inline-flex items-center gap-1 rounded-full border border-white/60 bg-white/55 px-4 py-2 text-xs font-medium text-[var(--kp-brand)] shadow-sm backdrop-blur-md transition hover:bg-white/80"
          >
            查看全部{" "}
            <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </Link>
        </ScrollReveal>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {featured && (
            <ScrollReveal className="lg:col-span-7">
              <MotionLink
                href={postHref(featured)}
                whileHover={{ y: -8, scale: 1.01 }}
                transition={hoverSpring}
                className={cn(
                  glassCard,
                  "kp-card-topline kp-card-sheen group relative flex flex-col p-6 hover:border-[var(--kp-brand)]/35 hover:bg-white/65 hover:shadow-[0_24px_56px_-18px_rgba(0,135,235,0.32)]",
                )}
              >
                <HoverGlow />
                <div className="relative mb-4 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-[11px] text-[var(--kp-text-3)]">
                    {featured.category ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-[var(--kp-brand-light)]/30 bg-[var(--kp-brand-soft)] px-2.5 py-1 font-semibold text-[var(--kp-brand)] transition-colors group-hover:bg-[var(--kp-brand)]/20 group-hover:text-[var(--kp-brand-dark)]">
                        <Tag className="h-3 w-3" /> {featured.category}
                      </span>
                    ) : null}
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="h-3 w-3" /> {formatDate(featured.createdAt)}
                    </span>
                  </div>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-[var(--kp-text-3)] opacity-0 transition-all duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[var(--kp-brand)] group-hover:opacity-100" />
                </div>
                <h3 className="relative mb-3 text-xl font-bold leading-snug tracking-tight text-[var(--kp-text-1)] transition-colors group-hover:text-[var(--kp-brand)] md:text-2xl">
                  {featured.title}
                </h3>
                <p className="relative mb-4 text-sm leading-relaxed text-[var(--kp-text-2)]">
                  {featured.excerpt || "暂无摘要"}
                </p>
                {featured.tags.length > 0 ? (
                  <div className="relative flex flex-wrap gap-1.5">
                    {featured.tags.slice(0, 5).map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full border border-white/70 bg-white/50 px-2.5 py-0.5 text-[10px] text-[var(--kp-text-3)]"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
              </MotionLink>
            </ScrollReveal>
          )}

          <div className="flex flex-col gap-3 lg:col-span-5">
            {sidePosts.map((post, i) => (
              <ScrollReveal key={post.id} delay={0.1}>
                <SidePostRow post={post} variant={i % 3} />
              </ScrollReveal>
            ))}
          </div>

          {gridPosts.map((post, i) => (
            <ScrollReveal key={post.id} delay={0.1 + i * 0.06} className="lg:col-span-4">
              <ArticleCard post={post} variant={i % 3} />
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function SidePostRow({ post, variant = 0 }: { post: Post; variant?: number }) {
  const hoverMotion = [
    { y: -4, x: 4 },
    { y: -5, scale: 1.01 },
    { y: 1, scale: 0.99 },
  ][variant % 3];
  const hoverClass = [
    "hover:border-[var(--kp-brand)]/35 hover:shadow-[0_16px_40px_-16px_rgba(0,135,235,0.28)]",
    "hover:border-[var(--kp-accent)]/40 hover:shadow-[0_14px_36px_-14px_rgba(232,168,74,0.28)]",
    "hover:bg-white/70 hover:shadow-[inset_0_2px_10px_rgba(0,80,160,0.07)]",
  ][variant % 3];
  return (
    <MotionLink
      href={postHref(post)}
      whileHover={hoverMotion}
      transition={hoverSpring}
      className={cn(glassCard, "kp-card-topline group flex items-start gap-3 p-3", hoverClass)}
    >
      <HoverGlow />
      <div className="relative mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--kp-brand-light)]/30 bg-[var(--kp-brand-soft)] text-[var(--kp-brand)] transition-all duration-300 group-hover:scale-110 group-hover:border-[var(--kp-brand-light)]/50 group-hover:bg-[var(--kp-brand)]/20 group-hover:shadow-[0_0_12px_rgba(0,135,235,0.18)]">
        <FileText className="h-4 w-4 transition-transform duration-300 group-hover:scale-110" />
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2 text-[10px] text-[var(--kp-text-3)]">
          {post.category ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--kp-brand-soft)] px-1.5 py-0.5 font-semibold text-[var(--kp-brand-deep)] transition-colors group-hover:bg-[var(--kp-brand)]/20">
              {post.category}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1">
            <Calendar className="h-2.5 w-2.5" /> {formatDate(post.createdAt)}
          </span>
        </div>
        <h3
          className="mb-1 truncate text-sm font-bold leading-snug text-[var(--kp-text-1)] transition-colors group-hover:text-[var(--kp-brand)]"
          title={post.title}
        >
          {post.title}
        </h3>
        <div className="flex flex-wrap gap-1">
          {post.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-white/70 bg-white/50 px-1.5 py-0.5 text-[10px] text-[var(--kp-text-3)]"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
      <ArrowUpRight className="relative mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--kp-text-3)] opacity-70 transition-all duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[var(--kp-brand)] group-hover:opacity-100" />
    </MotionLink>
  );
}

function ArticleCard({ post, variant = 0 }: { post: Post; variant?: number }) {
  const hoverMotion = [
    { y: -7, rotate: -0.6 },
    { y: -6, scale: 1.02 },
    { y: -4, x: -2 },
  ][variant % 3];
  const hoverClass = [
    "kp-card-sheen hover:border-[var(--kp-brand)]/35 hover:shadow-[0_22px_52px_-16px_rgba(0,135,235,0.3)]",
    "hover:border-[var(--kp-accent)]/40 hover:shadow-[0_20px_48px_-16px_rgba(232,168,74,0.28)]",
    "hover:border-white/80 hover:shadow-[0_0_0_1px_rgba(0,135,235,0.1),0_18px_44px_-16px_rgba(0,80,160,0.26)]",
  ][variant % 3];
  return (
    <MotionLink
      href={postHref(post)}
      whileHover={hoverMotion}
      transition={hoverSpring}
      className={cn(glassCard, "group relative flex h-full flex-col p-5", hoverClass)}
    >
      <HoverGlow />
      <ArrowUpRight className="absolute right-4 top-4 h-4 w-4 text-[var(--kp-text-3)] opacity-0 transition-all duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[var(--kp-brand)] group-hover:opacity-100" />
      <div className="relative mb-3 flex items-center gap-2 text-[11px] text-[var(--kp-text-3)]">
        {post.category ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-[var(--kp-brand-light)]/30 bg-[var(--kp-brand-soft)] px-2 py-0.5 font-semibold text-[var(--kp-brand)] transition-colors group-hover:bg-[var(--kp-brand)]/20 group-hover:text-[var(--kp-brand-dark)]">
            <Tag className="h-3 w-3" /> {post.category}
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1">
          <Calendar className="h-3 w-3" /> {formatDate(post.createdAt)}
        </span>
      </div>

      <h3
        className="relative mb-2 line-clamp-2 text-sm font-bold leading-snug text-[var(--kp-text-1)] transition-colors group-hover:text-[var(--kp-brand)]"
        title={post.title}
      >
        {post.title}
      </h3>

      <p className="relative mb-3 line-clamp-2 flex-1 text-xs leading-relaxed text-[var(--kp-text-2)]">
        {post.excerpt || "暂无摘要"}
      </p>

      <div className="relative mt-auto flex flex-wrap gap-1">
        {post.tags.slice(0, 3).map((tag) => (
          <span
            key={tag}
            className="rounded-full border border-white/70 px-1.5 py-0.5 text-[10px] text-[var(--kp-text-3)]"
          >
            {tag}
          </span>
        ))}
      </div>
    </MotionLink>
  );
}

