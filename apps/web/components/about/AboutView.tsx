"use client";

import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import Link from "next/link";
import {
  BookOpen,
  Bot,
  Brain,
  Code2,
  ExternalLink,
  FileText,
  Github,
  Globe,
  Loader2,
  MapPin,
  MessageSquare,
  Sparkles,
  Wand2,
} from "lucide-react";
import type { AboutProfile } from "@knowpilot/shared";
import { PostContent } from "@/components/post/PostContent";
import { FinalCta } from "@/components/home/FinalCta";
import { RecentIntelligence } from "@/components/home/RecentIntelligence";
// R14：three.js 改 client 懒加载，从 about 初始 bundle 拆出
const StarField = dynamic(() => import("@/components/home/StarField").then((m) => m.StarField), {
  ssr: false,
  loading: () => null,
});
import { TechMarquee } from "@/components/home/TechMarquee";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const spring = { type: "spring" as const, stiffness: 260, damping: 26 };
const easeOut = [0.22, 1, 0.36, 1] as const;

export function AboutView({ profile }: { profile: AboutProfile }) {
  const { data: recentPosts, isLoading: postsLoading } = trpc.post.list.useQuery({
    published: true,
    pageSize: 100,
  });
  const { data: analytics, isLoading: analyticsLoading } = trpc.analytics.dashboard.useQuery({});

  const posts = recentPosts?.items.slice(0, 6) ?? [];
  const postCount = analytics?.posts.published ?? recentPosts?.total ?? 0;
  const categoryCount = new Set(
    recentPosts?.items.map((p) => p.category).filter(Boolean) ?? [],
  ).size;

  const stackTags =
    profile.stack.length > 0
      ? [...profile.stack, ...profile.focus.slice(0, 4)]
      : undefined;

  return (
    <div className="relative w-full shrink-0 overflow-x-hidden">
      {/* Hero — 与首页一致的星空背景 + 个人简介 */}
      <section className="relative flex min-h-[min(72vh,720px)] items-center justify-center overflow-hidden px-[5%] py-16 md:px-[8%]">
        <StarField className="pointer-events-none absolute inset-0 opacity-90" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(184,160,144,0.2),transparent_55%)]" />
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[var(--kp-bg)] to-transparent" />

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: easeOut }}
          className="relative z-10 mx-auto w-full max-w-4xl"
        >
          <div className="rounded-3xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] p-8 shadow-lg md:p-10">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-[var(--kp-brand-soft)] px-3 py-1 text-xs font-semibold text-[var(--kp-brand-deep)]">
              <Sparkles className="h-3.5 w-3.5" />
              About Me
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-[var(--kp-text-1)] md:text-5xl">
              {profile.name}
            </h1>
            <p className="mt-2 text-lg text-[var(--kp-brand-deep)] md:text-xl">{profile.title}</p>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[var(--kp-text-2)] md:text-base">
              {profile.tagline}
            </p>
            <div className="mt-6 flex flex-wrap gap-3 text-sm">
              {profile.location && (
                <span className="inline-flex items-center gap-1.5 text-[var(--kp-text-3)]">
                  <MapPin className="h-4 w-4" />
                  {profile.location}
                </span>
              )}
              {profile.github && (
                <a
                  href={profile.github}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[var(--kp-brand-deep)] transition hover:text-[var(--kp-text-1)]"
                >
                  <Github className="h-4 w-4" />
                  GitHub
                  <ExternalLink className="h-3 w-3 opacity-60" />
                </a>
              )}
              {profile.site && (
                <a
                  href={profile.site}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[var(--kp-brand-deep)] transition hover:text-[var(--kp-text-1)]"
                >
                  <Globe className="h-4 w-4" />
                  个人站点
                  <ExternalLink className="h-3 w-3 opacity-60" />
                </a>
              )}
              <Link
                href="/chat"
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-3 py-1 text-[var(--kp-brand-deep)] transition hover:border-[var(--kp-brand-light)] hover:bg-[var(--kp-brand-soft)]"
              >
                <MessageSquare className="h-4 w-4" />
                开始对话
              </Link>
            </div>
          </div>

          <AboutLiveStats
            loading={postsLoading || analyticsLoading}
            postCount={postCount}
            categoryCount={categoryCount}
            agentCount={analytics?.agents.total}
            skillEnabled={analytics?.skills.enabled}
            sessionCount={analytics?.sessions.total}
            runCount={analytics?.runs.total}
          />
        </motion.div>
      </section>

      {/* 静态 profile + 动态内容 */}
      <div className="relative mx-auto max-w-4xl px-4 pb-8 md:px-8">
        <div className="grid gap-6 md:grid-cols-2">
          <ProfileCard title="关注方向" icon={Brain} items={profile.focus} delay={0.05} />
          <ProfileCard title="技术栈" icon={Code2} items={profile.stack} delay={0.1} />
        </div>

        <motion.section
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ ...spring, delay: 0.12 }}
          className="mt-6 rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] p-6"
        >
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--kp-text-3)]">
            <BookOpen className="h-4 w-4" />
            项目
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {profile.projects.map((p, i) => (
              <motion.div
                key={p.name}
                initial={{ opacity: 0, x: 8 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.08 + i * 0.04, ...spring }}
                className="rounded-xl border border-[var(--kp-divider-light)] bg-[var(--kp-bg)] p-4 transition hover:border-[var(--kp-brand-light)] hover:shadow-md"
              >
                {p.href ? (
                  <Link
                    href={p.href}
                    className="font-semibold text-[var(--kp-text-1)] hover:text-[var(--kp-brand-deep)]"
                  >
                    {p.name}
                  </Link>
                ) : (
                  <span className="font-semibold text-[var(--kp-text-1)]">{p.name}</span>
                )}
                <p className="mt-1 text-xs leading-relaxed text-[var(--kp-text-2)]">{p.description}</p>
              </motion.div>
            ))}
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ ...spring, delay: 0.18 }}
          className="prose-kp mt-6 rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] p-6 md:p-8"
        >
          <PostContent content={profile.bodyMarkdown} />
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ ...spring, delay: 0.22 }}
          className="mt-6 rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-brand-soft)]/40 p-6"
        >
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--kp-text-3)]">
            理念
          </h2>
          <ul className="space-y-2">
            {profile.philosophy.map((line) => (
              <li key={line} className="flex gap-2 text-sm text-[var(--kp-text-2)]">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--kp-brand)]" />
                {line}
              </li>
            ))}
          </ul>
        </motion.section>
      </div>

      {/* 与首页相同的动态区块 */}
      <RecentIntelligence posts={posts} />
      <TechMarquee tags={stackTags} label="技术栈与关注方向" />
      <FinalCta />
    </div>
  );
}

function AboutLiveStats({
  loading,
  postCount,
  categoryCount,
  agentCount,
  skillEnabled,
  sessionCount,
  runCount,
}: {
  loading: boolean;
  postCount: number;
  categoryCount: number;
  agentCount?: number;
  skillEnabled?: number;
  sessionCount?: number;
  runCount?: number;
}) {
  const stats = [
    { icon: FileText, value: postCount, label: "已发布文章" },
    { icon: BookOpen, value: categoryCount, label: "分类" },
    { icon: Bot, value: agentCount, label: "Agent" },
    { icon: Wand2, value: skillEnabled, label: "Skill 启用" },
    { icon: MessageSquare, value: sessionCount, label: "对话会话" },
    { icon: Sparkles, value: runCount, label: "Agent 运行" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2, duration: 0.7, ease: easeOut }}
      className="mt-6 rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] p-4 md:p-6"
    >
      <p className="mb-4 text-center text-xs font-medium tracking-widest text-[var(--kp-text-3)] uppercase">
        KnowPilot 实时数据
      </p>
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-4 text-sm text-[var(--kp-text-3)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载中…
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-6">
          {stats.map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.25 + i * 0.05, ...spring }}
              className="flex flex-col items-center gap-1 text-center"
            >
              <stat.icon className="mb-1 h-4 w-4 text-[var(--kp-brand-deep)]" />
              <span className="text-2xl font-bold tabular-nums text-[var(--kp-text-1)]">
                {stat.value ?? "—"}
              </span>
              <span className="text-[10px] text-[var(--kp-text-3)]">{stat.label}</span>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function ProfileCard({
  title,
  icon: Icon,
  items,
  delay,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  items: string[];
  delay: number;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ ...spring, delay }}
      className="rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] p-6"
    >
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--kp-text-3)]">
        <Icon className="h-4 w-4 text-[var(--kp-brand-deep)]" />
        {title}
      </h2>
      <ul className="flex flex-wrap gap-2">
        {items.map((item) => (
          <li
            key={item}
            className={cn(
              "rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg)]/70 px-3 py-1 text-xs text-[var(--kp-text-2)]",
            )}
          >
            {item}
          </li>
        ))}
      </ul>
    </motion.section>
  );
}
