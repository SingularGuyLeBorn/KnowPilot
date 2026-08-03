"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowRight,
  BookOpen,
  Bot,
  Briefcase,
  Calendar,
  Cpu,
  ExternalLink,
  FileText,
  Github,
  GraduationCap,
  Layers,
  Lightbulb,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Quote,
  Rocket,
  Sparkles,
  Target,
  Wand2,
} from "lucide-react";
import type { AboutProfile } from "@knowpilot/shared";
import dynamic from "next/dynamic";
import { NumberTicker } from "@/components/magicui/number-ticker";
import { BlurFade } from "@/components/magicui/blur-fade";
import { ShineBorder } from "@/components/magicui/shine-border";
import { FloatingShapes } from "@/components/FloatingShapes";
import { HeroSection } from "@/components/about/HeroSection";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const FlickeringGrid = dynamic(
  () => import("@/components/magicui/flickering-grid").then((m) => m.FlickeringGrid),
  { ssr: false, loading: () => <div className="h-full w-full" aria-hidden /> },
);

const TAG_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  工作: Briefcase,
  项目: Rocket,
  转折: Target,
  学习: GraduationCap,
};

export function AboutView({ profile }: { profile: AboutProfile }) {
  const { data: recentPosts, isLoading: postsLoading } = trpc.post.list.useQuery({
    published: true,
    pageSize: 6,
  });

  const [analyticsReady, setAnalyticsReady] = useState(false);
  useEffect(() => {
    const warm = () => setAnalyticsReady(true);
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof w.requestIdleCallback === "function") {
      const id = w.requestIdleCallback(warm, { timeout: 2500 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(warm, 1400);
    return () => window.clearTimeout(t);
  }, []);

  const { data: analytics, isLoading: analyticsLoading } = trpc.analytics.dashboard.useQuery(
    {},
    { enabled: analyticsReady },
  );

  const postCount = analytics?.posts.published ?? recentPosts?.total ?? 0;
  const categoryCount = new Set(
    recentPosts?.items.map((p) => p.category).filter(Boolean) ?? [],
  ).size;

  return (
    <div className="relative w-full shrink-0 overflow-x-hidden bg-[var(--kp-bg)]">
      <HeroSection profile={profile} />
      <StatsStrip
        loading={postsLoading || analyticsLoading}
        postCount={postCount}
        categoryCount={categoryCount}
        agentCount={analytics?.agents.total}
        skillEnabled={analytics?.skills.enabled}
        sessionCount={analytics?.sessions.total}
        runCount={analytics?.runs.total}
      />

      <ProfileStory bodyMarkdown={profile.bodyMarkdown} name={profile.name} />

      <div className="relative">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(var(--kp-accent-rgb),0.08),transparent_50%)]" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_70%_80%,rgba(var(--kp-brand-rgb),0.08),transparent_50%)]" />

        <BentoSection profile={profile} />
        {profile.timeline.length > 0 && <TimelineSection timeline={profile.timeline} />}
        {profile.featured && profile.featured.length > 0 && <FeaturedSection featured={profile.featured} />}
        {profile.projects.length > 0 && <ProjectsSection projects={profile.projects} />}
        {profile.contents.length > 0 && <ContentsSection contents={profile.contents} />}
        {profile.storyCards && profile.storyCards.length > 0 && <StoryCardsSection cards={profile.storyCards} />}
        {profile.philosophy.length > 0 && <PhilosophySection philosophy={profile.philosophy} />}
      </div>

      <FooterCta profile={profile} />
    </div>
  );
}

function StatsStrip({
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
    { icon: FileText, value: postCount, label: "已发布" },
    { icon: BookOpen, value: categoryCount, label: "分类" },
    { icon: Bot, value: agentCount, label: "Agent" },
    { icon: Wand2, value: skillEnabled, label: "Skills" },
    { icon: MessageSquare, value: sessionCount, label: "会话" },
    { icon: Sparkles, value: runCount, label: "运行" },
  ];

  return (
    <section className="relative z-10 overflow-hidden border-y border-[var(--kp-divider)] bg-[var(--kp-bg)]/80 backdrop-blur-md">
      <FloatingShapes variant="circuit" density="sparse" className="opacity-40" />
      <div className="grid grid-cols-2 gap-px divide-x divide-[var(--kp-divider)] md:grid-cols-3 lg:grid-cols-6">
        {loading ? (
          <div className="col-span-full flex items-center justify-center gap-2 py-6 text-sm text-[var(--kp-text-3)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载实时数据…
          </div>
        ) : (
          stats.map((stat) => (
            <div
              key={stat.label}
              className="group flex flex-col items-center gap-2 px-4 py-6 text-center transition-colors hover:bg-[var(--kp-bg-alt)]/60"
            >
              <stat.icon className="h-6 w-6 text-[var(--kp-brand-deep)] transition-transform group-hover:scale-110" />
              <span className="bg-gradient-to-br from-[var(--kp-text-1)] to-[var(--kp-brand-light)] bg-clip-text text-2xl font-bold tabular-nums text-transparent">
                {typeof stat.value === "number" ? (
                  <NumberTicker
                    value={stat.value ?? 0}
                    className="bg-gradient-to-br from-[var(--kp-text-1)] to-[var(--kp-brand-light)] bg-clip-text text-transparent"
                  />
                ) : (
                  stat.value ?? 0
                )}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-[var(--kp-text-3)]">{stat.label}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function ProfileStory({ bodyMarkdown, name }: { bodyMarkdown: string; name: string }) {
  const trimmed = bodyMarkdown?.trim() ?? "";
  if (!trimmed || trimmed.length < 20 || trimmed.startsWith("About profile")) return null;
  const firstPara = trimmed.split(/\n\n+/)[0]?.replace(/^#+\s*/, "");

  return (
    <section className="relative overflow-hidden px-[5%] py-24 lg:px-[8%]">
      <FloatingShapes variant="blob" className="opacity-40" />
      <div className="relative mx-auto grid max-w-6xl gap-12 lg:grid-cols-[1.2fr_0.8fr]">
        <BlurFade direction="down" delay={0.05}>
          <div>
            <SectionHeader eyebrow="Story" title="自述" />
            <div className="prose prose-sm max-w-none columns-1 text-[var(--kp-text-2)] md:columns-2 md:gap-8">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{bodyMarkdown}</ReactMarkdown>
            </div>
          </div>
        </BlurFade>

        <BlurFade direction="left" delay={0.15}>
          <div className="relative overflow-hidden rounded-[1.75rem] border border-[var(--kp-divider)] bg-gradient-to-br from-[var(--kp-brand-soft)]/60 to-[var(--kp-bg-alt)] p-8 md:p-10">
            <Quote className="mb-5 h-8 w-8 text-[var(--kp-accent)]" />
            <blockquote className="mb-6 text-xl font-medium leading-relaxed text-[var(--kp-text-1)] md:text-2xl">
              {firstPara || "把复杂自我介绍拆成可扫描的方块。"}
            </blockquote>
            <p className="text-sm text-[var(--kp-text-3)]">— {name || "应知序"}</p>
          </div>
        </BlurFade>
      </div>
    </section>
  );
}

function BentoSection({ profile }: { profile: AboutProfile }) {
  return (
    <section className="relative overflow-hidden px-[5%] py-24 lg:px-[8%]">
      <FloatingShapes variant="grid" className="opacity-40" />
      <div className="relative mx-auto grid gap-12 lg:grid-cols-[0.45fr_1fr]">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <BlurFade direction="down" delay={0.05}>
            <SectionHeader eyebrow="Profile" title="偏好、工具与现状" />
            <p className="mt-4 max-w-xs text-sm text-[var(--kp-text-3)]">
              把复杂自我介绍拆成可扫描的方块。每个方块代表一种思考方式或工作习惯。
            </p>
          </BlurFade>
        </div>

        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          <BlurFade direction="down" delay={0.08} className="md:col-span-2 lg:col-span-2">
            <div className="group relative flex h-full flex-col overflow-hidden rounded-[1.75rem] bg-gradient-to-br from-[var(--kp-accent-deep)] via-[var(--kp-brand-deep)] to-[var(--kp-ink)] p-7 text-white shadow-xl md:p-8">
              <ShineBorder
                borderWidth={2}
                duration={14}
                shineColor={["var(--kp-accent)", "var(--kp-brand-light)", "var(--kp-accent-deep)"]}
                className="rounded-[1.75rem]"
              />
              <div className="relative z-10 mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15">
                <Target className="h-6 w-6 text-white" />
              </div>
              <h3 className="relative z-10 mb-3 text-xl font-semibold">关注方向</h3>
              <div className="relative z-10 flex flex-wrap gap-2">
                {profile.focus.map((item) => (
                  <span
                    key={item.title}
                    className="rounded-full bg-white/15 px-3 py-1.5 text-sm text-white/90 backdrop-blur-sm"
                  >
                    {item.title}
                  </span>
                ))}
              </div>
            </div>
          </BlurFade>

          <BlurFade direction="down" delay={0.12} className="md:row-span-2">
            <div className="group flex h-full flex-col rounded-[1.75rem] border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/70 p-6 backdrop-blur-md transition hover:border-[var(--kp-brand-light)] md:p-7">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]">
                <Rocket className="h-6 w-6" />
              </div>
              <h3 className="mb-4 text-lg font-semibold text-[var(--kp-text-1)]">最近在忙</h3>
              <ul className="flex flex-col gap-3">
                {profile.now?.slice(0, 5).map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-[var(--kp-text-2)]">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--kp-accent)]" />
                    {item}
                  </li>
                ))}
                {(profile.now?.length ?? 0) === 0 && (
                  <li className="text-sm text-[var(--kp-text-3)]">暂无记录。</li>
                )}
              </ul>
            </div>
          </BlurFade>

          {profile.stack.map((group, i) => (
            <BlurFade
              key={group.category}
              direction="down"
              delay={0.16 + i * 0.06}
            >
              <div className={cn(
                "group flex h-full flex-col rounded-[1.75rem] p-6 transition",
                i === 0
                  ? "border-2 border-dashed border-[var(--kp-accent)]/30 bg-[var(--kp-bg)]/80"
                  : "border border-[var(--kp-divider)] bg-[var(--kp-brand-soft)]/40 hover:border-[var(--kp-brand-light)]",
              )}>
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--kp-accent-soft)] text-[var(--kp-accent-deep)]">
                  <Cpu className="h-5 w-5" />
                </div>
                <h3 className="mb-3 text-base font-semibold text-[var(--kp-text-1)]">{group.category}</h3>
                <div className="flex flex-wrap gap-2">
                  {group.items.map((item) => (
                    <span
                      key={item}
                      className="rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg)]/60 px-2.5 py-1 text-xs text-[var(--kp-text-2)]"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            </BlurFade>
          ))}

          <BlurFade direction="down" delay={0.22} className="md:col-span-2 lg:col-span-2">
            <div className="group flex h-full flex-col rounded-[1.75rem] border border-[var(--kp-divider)] bg-gradient-to-br from-[var(--kp-bg-alt)] to-[var(--kp-bg-soft)] p-6 transition hover:border-[var(--kp-brand-light)] md:p-7">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]">
                <Layers className="h-5 w-5" />
              </div>
              <h3 className="mb-4 text-lg font-semibold text-[var(--kp-text-1)]">现在用的工具</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                {profile.toolbox.map((group) => (
                  <div
                    key={group.category}
                    className="rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)]/60 p-4 transition-colors hover:border-[var(--kp-brand-light)]"
                  >
                    <h4 className="mb-1 text-sm font-semibold text-[var(--kp-text-1)]">{group.category}</h4>
                    <p className="text-xs leading-relaxed text-[var(--kp-text-3)]">{group.items.join(" · ")}</p>
                  </div>
                ))}
              </div>
            </div>
          </BlurFade>
        </div>
      </div>
    </section>
  );
}

function TimelineSection({ timeline }: { timeline: AboutProfile["timeline"] }) {
  return (
    <section className="relative overflow-hidden px-[5%] py-24 lg:px-[8%]">
      <FloatingShapes variant="rings" className="opacity-30" />
      <div className="relative mx-auto grid gap-12 lg:grid-cols-[0.4fr_1fr]">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <BlurFade direction="down" delay={0.05}>
            <SectionHeader eyebrow="Timeline" title="一点经历" />
            <p className="mt-4 max-w-xs text-sm text-[var(--kp-text-3)]">
              不是完整简历，而是一些改变方向的节点。
            </p>
          </BlurFade>
        </div>
        <div className="relative">
          <div className="absolute left-1/2 top-0 bottom-0 hidden w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-[var(--kp-divider)] to-transparent md:block" />
          {timeline.map((item, i) => {
            const Icon = (item.tag && TAG_ICON[item.tag]) || Calendar;
            const isLeft = i % 2 === 0;
            return (
              <BlurFade
                key={item.period + item.title}
                direction={isLeft ? "right" : "left"}
                delay={0.08 + i * 0.1}
                className="relative mb-12 md:mb-0"
              >
                <div className={cn(
                  "relative md:flex md:items-center md:justify-between",
                  isLeft ? "md:flex-row" : "md:flex-row-reverse",
                )}>
                  <div className={cn(
                    "md:w-[46%]",
                    isLeft ? "md:pr-8 md:text-right" : "md:pl-8 md:text-left",
                  )}>
                    <div className={cn(
                      "rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/70 p-5 backdrop-blur-md transition hover:border-[var(--kp-brand-light)]",
                    )}>
                      <span className="text-xs font-semibold uppercase tracking-wider text-[var(--kp-brand-deep)]">
                        {item.period}
                      </span>
                      <h3 className="mt-1 text-lg font-semibold text-[var(--kp-text-1)]">{item.title}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-[var(--kp-text-2)]">{item.description}</p>
                    </div>
                  </div>

                  <div className="absolute left-4 top-0 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] shadow md:left-1/2 md:top-8 md:-translate-x-1/2">
                    <Icon className="h-4 w-4 text-[var(--kp-brand-deep)]" />
                  </div>
                </div>
              </BlurFade>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function FeaturedSection({ featured }: { featured: NonNullable<AboutProfile["featured"]> }) {
  const [first, ...rest] = featured;
  return (
    <section className="relative overflow-hidden px-[5%] py-24 lg:px-[8%]">
      <FloatingShapes variant="dot-grid" className="opacity-40" />
      <div className="relative mx-auto max-w-6xl">
        <BlurFade direction="down" delay={0.05} className="mb-14">
          <SectionHeader eyebrow="Featured" title="精选" />
        </BlurFade>

        <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
          {first && (
            <BlurFade direction="down" delay={0.1} className="lg:row-span-2">
              <div className="group relative flex h-full flex-col overflow-hidden rounded-[1.75rem] border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/70 shadow-sm transition hover:border-[var(--kp-brand-light)]">
                {first.coverImage && (
                  <div className="relative h-56 w-full overflow-hidden">
                    <FeaturedImage src={first.coverImage} alt={first.title} />
                    <div className="absolute inset-0 bg-gradient-to-t from-[var(--kp-bg-alt)] to-transparent" />
                  </div>
                )}
                <div className="flex flex-1 flex-col p-7 md:p-8">
                  <div className="mb-3 flex items-center gap-2">
                    <h3 className="text-2xl font-semibold text-[var(--kp-text-1)]">{first.title}</h3>
                    {first.tag && (
                      <span className="rounded-full bg-[var(--kp-brand-soft)] px-2.5 py-0.5 text-[10px] font-medium text-[var(--kp-brand-deep)]">
                        {first.tag}
                      </span>
                    )}
                  </div>
                  <p className="flex-1 text-base leading-relaxed text-[var(--kp-text-2)]">{first.description}</p>
                  {first.url && (
                    <a
                      href={first.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-[var(--kp-brand-deep)] transition hover:underline"
                    >
                      查看
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              </div>
            </BlurFade>
          )}

          <div className="flex flex-col gap-5">
            {rest.map((item, i) => (
              <BlurFade key={item.title} direction="left" delay={0.15 + i * 0.08}>
                <div className="group flex flex-col rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg)]/80 p-5 transition hover:border-[var(--kp-brand-light)] hover:bg-[var(--kp-bg-alt)]/60">
                  <div className="mb-2 flex items-center gap-2">
                    <h3 className="font-semibold text-[var(--kp-text-1)]">{item.title}</h3>
                    {item.tag && (
                      <span className="rounded-full bg-[var(--kp-accent-soft)] px-2 py-0.5 text-[10px] text-[var(--kp-accent-deep)]">
                        {item.tag}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-[var(--kp-text-2)]">{item.description}</p>
                  {item.url && (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[var(--kp-brand-deep)] transition hover:underline"
                    >
                      查看
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </BlurFade>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function ProjectsSection({ projects }: { projects: AboutProfile["projects"] }) {
  const [first, ...rest] = projects;
  return (
    <section className="relative overflow-hidden px-[5%] py-24 lg:px-[8%]">
      <FloatingShapes variant="circuit" density="sparse" className="opacity-30" />
      <div className="relative mx-auto max-w-6xl">
        <BlurFade direction="down" delay={0.05} className="mb-14">
          <SectionHeader eyebrow="Projects" title="做过 / 正在做的事" />
        </BlurFade>

        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {first && (
            <BlurFade direction="down" delay={0.1} className="md:col-span-2 lg:col-span-2">
              <ProjectCard project={first} featured />
            </BlurFade>
          )}
          {rest.map((p, i) => (
            <BlurFade key={p.name} direction="down" delay={0.15 + i * 0.08}>
              <ProjectCard project={p} />
            </BlurFade>
          ))}
        </div>
      </div>
    </section>
  );
}

function ProjectCard({ project, featured }: { project: AboutProfile["projects"][number]; featured?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  const y = useTransform(scrollYProgress, [0, 1], [featured ? 30 : 20, featured ? -30 : -20]);

  return (
    <motion.div
      ref={ref}
      style={{ y }}
      className={cn(
        "group relative h-full overflow-hidden rounded-[1.75rem] border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/70 backdrop-blur-md transition-all duration-500 hover:-translate-y-1.5 hover:border-[var(--kp-brand-light)]",
        featured ? "p-7 md:p-8" : "p-6",
      )}
    >
      {project.coverImage && (
        <div className={cn("relative mb-5 w-full overflow-hidden rounded-2xl", featured ? "h-56" : "h-40")}>
          <FeaturedImage src={project.coverImage} alt={project.name} />
        </div>
      )}
      <div className="mb-4 flex items-center justify-between">
        <div className={cn(
          "flex items-center justify-center rounded-xl bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]",
          featured ? "h-11 w-11" : "h-9 w-9",
        )}>
          <Cpu className={featured ? "h-5 w-5" : "h-4 w-4"} />
        </div>
        {project.highlight && (
          <span className="rounded-full bg-[var(--kp-accent-soft)] px-2.5 py-0.5 text-[10px] font-medium text-[var(--kp-accent-deep)]">
            {project.highlight}
          </span>
        )}
      </div>
      <h3 className={cn("font-semibold text-[var(--kp-text-1)]", featured ? "text-2xl" : "text-lg")}>
        {project.href ? (
          <Link href={project.href} className="transition hover:text-[var(--kp-brand-deep)]">
            {project.name}
          </Link>
        ) : (
          project.name
        )}
      </h3>
      {project.tagline && <p className="mb-2 text-xs font-medium text-[var(--kp-brand-deep)]">{project.tagline}</p>}
      <p className={cn("leading-relaxed text-[var(--kp-text-2)]", featured ? "text-base" : "text-sm")}>
        {project.description}
      </p>
      {project.stack.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-1.5">
          {project.stack.slice(0, featured ? 8 : 5).map((s) => (
            <span key={s} className="rounded-md bg-[var(--kp-bg)] px-2 py-0.5 text-[10px] text-[var(--kp-text-3)]">
              {s}
            </span>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function ContentsSection({ contents }: { contents: AboutProfile["contents"] }) {
  return (
    <section className="relative overflow-hidden px-[5%] py-24 lg:px-[8%]">
      <FloatingShapes variant="dot-grid" className="opacity-30" />
      <div className="relative mx-auto max-w-6xl">
        <BlurFade direction="down" delay={0.05} className="mb-14">
          <SectionHeader eyebrow="Contents" title="输出与内容" />
        </BlurFade>

        <div className="grid gap-4 md:grid-cols-2">
          {contents.map((item, i) => (
            <BlurFade key={item.title} direction={i % 2 === 0 ? "right" : "left"} delay={0.08 + i * 0.06}>
              <div className="group flex items-start gap-4 rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg)]/80 p-5 transition hover:border-[var(--kp-brand-light)] hover:bg-[var(--kp-bg-alt)]/60">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--kp-accent-soft)] text-[var(--kp-accent-deep)]">
                  <BookOpen className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <h3 className="font-semibold text-[var(--kp-text-1)]">{item.title}</h3>
                    <span className="rounded-full bg-[var(--kp-bg-alt)] px-2 py-0.5 text-[10px] text-[var(--kp-text-3)]">
                      {item.type}
                    </span>
                  </div>
                  <p className="text-sm text-[var(--kp-text-2)]">{item.description}</p>
                  {item.url && (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[var(--kp-brand-deep)] transition hover:underline"
                    >
                      查看
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            </BlurFade>
          ))}
        </div>
      </div>
    </section>
  );
}

function StoryCardsSection({ cards }: { cards: AboutProfile["storyCards"] }) {
  if (!cards || cards.length === 0) return null;
  return (
    <section className="relative overflow-hidden px-[5%] py-24 lg:px-[8%]">
      <FloatingShapes variant="blob" className="opacity-30" />
      <div className="relative mx-auto max-w-6xl">
        <BlurFade direction="down" delay={0.05} className="mb-14">
          <SectionHeader eyebrow="Story" title="片段" />
        </BlurFade>
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {cards.map((card, i) => (
            <BlurFade
              key={card.title}
              direction="down"
              delay={0.08 + i * 0.08}
            >
              <div className="group flex h-full flex-col rounded-[1.75rem] border border-dashed border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/50 p-6 transition hover:border-[var(--kp-brand-light)] hover:bg-[var(--kp-bg-alt)]/80">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]">
                  <BookOpen className="h-5 w-5" />
                </div>
                <h3 className="mb-3 text-lg font-semibold text-[var(--kp-text-1)]">{card.title}</h3>
                <p className="text-sm leading-relaxed text-[var(--kp-text-2)]">{card.description}</p>
              </div>
            </BlurFade>
          ))}
        </div>
      </div>
    </section>
  );
}

function PhilosophySection({ philosophy }: { philosophy: AboutProfile["philosophy"] }) {
  return (
    <section className="relative overflow-hidden px-[5%] py-24 lg:px-[8%]">
      <FloatingShapes variant="grid" className="opacity-25" />
      <div className="relative mx-auto max-w-6xl">
        <div className="grid gap-12 lg:grid-cols-2">
          <BlurFade direction="down" delay={0.05} className="lg:sticky lg:top-24 lg:self-start">
            <SectionHeader eyebrow="Philosophy" title="一些偏见" />
            <p className="mt-4 max-w-xs text-sm text-[var(--kp-text-3)]">
              观点不一定对，但都是真实的判断。
            </p>
          </BlurFade>

          <div className="grid gap-5 md:grid-cols-2">
            {philosophy.map((item, i) => (
              <BlurFade
                key={item.title}
                direction="down"
                delay={0.1 + i * 0.08}
                className={i === 0 ? "md:col-span-2" : ""}
              >
                <div className={cn(
                  "group flex h-full flex-col rounded-[1.75rem] p-6 transition",
                  i === 0
                    ? "border border-[var(--kp-divider)] bg-gradient-to-br from-[var(--kp-brand-soft)]/60 to-[var(--kp-bg-alt)] md:p-8"
                    : "border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/70 hover:border-[var(--kp-brand-light)]",
                )}>
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]">
                    <Lightbulb className="h-5 w-5" />
                  </div>
                  <h3 className={cn("mb-3 font-semibold text-[var(--kp-text-1)]", i === 0 ? "text-xl" : "text-lg")}>
                    {item.title}
                  </h3>
                  {item.description && (
                    <p className="text-sm leading-relaxed text-[var(--kp-text-2)]">{item.description}</p>
                  )}
                </div>
              </BlurFade>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function FooterCta({ profile }: { profile: AboutProfile }) {
  return (
    <section className="relative overflow-hidden px-[5%] py-24 lg:px-[8%]">
      <div className="pointer-events-none absolute inset-0 bg-[var(--kp-ink)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.25]">
        <FlickeringGrid
          squareSize={4}
          gridGap={6}
          flickerChance={0.1}
          color="rgb(79, 185, 166)"
          maxOpacity={0.22}
          className="h-full w-full"
        />
      </div>
      <div
        className="pointer-events-none absolute -left-24 top-0 h-[420px] w-[420px] rounded-full opacity-70 blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(var(--kp-accent-rgb), 0.45) 0%, transparent 68%)" }}
      />
      <div
        className="pointer-events-none absolute -right-16 bottom-0 h-[380px] w-[380px] rounded-full opacity-60 blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(var(--kp-brand-rgb), 0.35) 0%, transparent 70%)" }}
      />

      <div className="relative z-10 mx-auto max-w-5xl">
        <BlurFade direction="up" delay={0.05}>
          <div className="relative overflow-hidden rounded-[2.25rem] border border-white/10 bg-white/[0.03] p-10 backdrop-blur-xl md:p-14">
            <ShineBorder
              borderWidth={2}
              duration={16}
              shineColor={["var(--kp-accent)", "var(--kp-brand-light)", "white"]}
              className="rounded-[2.25rem] opacity-60"
            />
            <div className="relative z-10 text-center">
              <div className="mx-auto mb-7 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-[11px] font-medium tracking-wide text-white/75 backdrop-blur">
                <Sparkles className="h-3.5 w-3.5 text-[var(--kp-accent)]" />
                见微知著 · 本地优先数字花园
              </div>

              <h2 className="mb-5 text-balance text-4xl font-extrabold tracking-[-0.03em] text-white md:text-6xl">
                想聊聊？
              </h2>
              <p className="mx-auto mb-10 max-w-xl text-base leading-relaxed text-white/65 md:text-lg">
                通过 Agent 聊天、GitHub 或小红书都可以。本页源文件在{" "}
                <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs">content/about/profile.md</code>。
              </p>

              <div className="flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
                <Link
                  href="/chat"
                  className="group inline-flex h-12 items-center gap-2 rounded-full bg-[var(--kp-accent)] px-8 text-sm font-semibold text-white shadow-[0_12px_40px_rgba(var(--kp-accent-rgb),0.35)] transition-transform duration-300 hover:-translate-y-0.5 hover:bg-[var(--kp-accent-deep)]"
                >
                  <MessageSquare className="h-4 w-4" />
                  开始对话
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Link>
                {profile.github && (
                  <a
                    href={profile.github}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-12 items-center gap-2 rounded-full border border-white/20 bg-white/5 px-8 text-sm font-semibold text-white/90 backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:border-white/35 hover:bg-white/10"
                  >
                    <Github className="h-4 w-4" />
                    GitHub
                  </a>
                )}
                {profile.email && (
                  <a
                    href={`mailto:${profile.email}`}
                    className="inline-flex h-12 items-center gap-2 rounded-full px-4 text-sm font-medium text-white/55 transition-colors hover:text-white/90"
                  >
                    <Mail className="h-4 w-4" />
                    邮件
                  </a>
                )}
              </div>

              {profile.location && (
                <p className="mt-8 inline-flex items-center gap-1.5 text-xs text-white/40">
                  <MapPin className="h-3.5 w-3.5" />
                  {profile.location}
                </p>
              )}
            </div>
          </div>
        </BlurFade>
      </div>
    </section>
  );
}

function FeaturedImage({ src, alt }: { src: string; alt: string }) {
  if (src.startsWith("http") || src.startsWith("//")) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={alt} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
    );
  }
  const path = src.startsWith("/") ? src : `/${src}`;
  return <Image src={path} alt={alt} fill className="object-cover transition duration-500 group-hover:scale-105" unoptimized />;
}

function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mb-10">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--kp-accent)]">{eyebrow}</p>
      <h2 className="text-3xl font-bold tracking-tight text-[var(--kp-text-1)] md:text-4xl">{title}</h2>
    </div>
  );
}
