"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
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
  MessageSquare,
  Rocket,
  Sparkles,
  Target,
  Wand2,
} from "lucide-react";
import type { AboutProfile } from "@knowpilot/shared";
import { HeroSection } from "@/components/about/HeroSection";
import { SolarSystemUniverse } from "@/components/about/SolarSystemUniverse";
import { RecentIntelligence } from "@/components/home/RecentIntelligence";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const easeOut = [0.22, 1, 0.36, 1] as const;

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

  const posts = recentPosts?.items ?? [];
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

      <div className="relative">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(var(--kp-accent-rgb),0.08),transparent_50%)]" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_70%_80%,rgba(var(--kp-brand-rgb),0.08),transparent_50%)]" />

        <BentoSection profile={profile} />

        <SolarSystemUniverse />

        {profile.timeline.length > 0 && <TimelineSection timeline={profile.timeline} />}

        {profile.featured && profile.featured.length > 0 && <FeaturedSection featured={profile.featured} />}

        {profile.projects.length > 0 && <ProjectsSection projects={profile.projects} />}

        {profile.contents.length > 0 && <ContentsSection contents={profile.contents} />}

        {profile.storyCards && profile.storyCards.length > 0 && <StoryCardsSection cards={profile.storyCards} />}

        {profile.philosophy.length > 0 && <PhilosophySection philosophy={profile.philosophy} />}
      </div>

      <div className="bg-[var(--kp-bg)]/92">
        <RecentIntelligence posts={posts} />
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
    <section className="relative z-10 border-y border-[var(--kp-divider)] bg-[var(--kp-bg)]/80 backdrop-blur-md">
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
              className="flex flex-col items-center gap-2 px-4 py-6 text-center transition-colors hover:bg-[var(--kp-bg-alt)]/60"
            >
              <stat.icon className="h-6 w-6 text-[var(--kp-brand-deep)]" />
              <span className="text-2xl font-bold text-[var(--kp-text-1)]">{stat.value ?? 0}</span>
              <span className="text-[10px] uppercase tracking-wider text-[var(--kp-text-3)]">{stat.label}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function BentoSection({ profile }: { profile: AboutProfile }) {
  return (
    <section className="relative z-10 px-[5%] py-24 lg:px-[8%]">
      <div className="mx-auto grid gap-12 lg:grid-cols-2">
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.8, ease: easeOut }}
        >
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--kp-accent)]">
            Profile
          </p>
          <h2 className="mb-4 text-3xl font-bold tracking-tight text-[var(--kp-text-1)] md:text-4xl">
            偏好、工具与现状
          </h2>
          <p className="mb-8 max-w-md text-[var(--kp-text-2)]">
            把复杂自我介绍拆成可扫描的方块。每个方块代表一种思考方式或工作习惯。
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <BentoCard>
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]">
                <Target className="h-5 w-5" />
              </div>
              <h3 className="mb-3 text-lg font-semibold text-[var(--kp-text-1)]">关注方向</h3>
              <div className="flex flex-wrap gap-2">
                {profile.focus.map((item) => (
                  <span key={item.title} className="rounded-full bg-[var(--kp-bg)]/60 px-3 py-1 text-xs text-[var(--kp-text-2)]">
                    {item.title}
                  </span>
                ))}
              </div>
            </BentoCard>
            <BentoCard>
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--kp-accent-soft)] text-[var(--kp-accent-deep)]">
                <Rocket className="h-5 w-5" />
              </div>
              <h3 className="mb-3 text-lg font-semibold text-[var(--kp-text-1)]">最近在忙</h3>
              <ul className="flex flex-col gap-2">
                {profile.now?.slice(0, 4).map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-[var(--kp-text-2)]">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--kp-brand)]" />
                    {item}
                  </li>
                ))}
              </ul>
            </BentoCard>
            {profile.stack.map((group) => (
              <BentoCard key={group.category}>
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--kp-accent-soft)] text-[var(--kp-accent-deep)]">
                  <Cpu className="h-5 w-5" />
                </div>
                <h3 className="mb-3 text-lg font-semibold text-[var(--kp-text-1)]">{group.category}</h3>
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
              </BentoCard>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.8, ease: easeOut }}
          className="relative"
        >
          <div className="sticky top-24">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]">
              <Layers className="h-5 w-5" />
            </div>
            <h3 className="mb-4 text-xl font-semibold text-[var(--kp-text-1)]">现在用的工具</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {profile.toolbox.map((group) => (
                <div
                  key={group.category}
                  className="rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/70 p-4 backdrop-blur-sm transition-colors hover:border-[var(--kp-brand-light)]"
                >
                  <h4 className="mb-2 text-sm font-semibold text-[var(--kp-text-1)]">{group.category}</h4>
                  <p className="text-xs leading-relaxed text-[var(--kp-text-3)]">{group.items.join(" · ")}</p>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function BentoCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.7, ease: easeOut }}
      className={cn(
        "rounded-3xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/70 p-6 backdrop-blur-md transition-all duration-300 hover:border-[var(--kp-brand-light)] hover:bg-[var(--kp-bg-alt)]/90 md:p-7",
        className,
      )}
    >
      {children}
    </motion.div>
  );
}

function TimelineSection({ timeline }: { timeline: AboutProfile["timeline"] }) {
  return (
    <section className="relative z-10 px-[5%] py-24 lg:px-[8%]">
      <div className="mx-auto grid gap-12 lg:grid-cols-[0.4fr_1fr]">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <SectionHeader eyebrow="Timeline" title="一点经历" />
          <p className="mt-4 max-w-xs text-sm text-[var(--kp-text-3)]">
            不是完整简历，而是一些改变方向的节点。
          </p>
        </div>
        <div className="relative">
          <div className="absolute left-4 top-0 bottom-0 w-px bg-[var(--kp-divider)] md:left-8" />
          {timeline.map((item, i) => {
            const Icon = (item.tag && TAG_ICON[item.tag]) || Calendar;
            return (
              <motion.div
                key={item.period + item.title}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.7, delay: i * 0.1, ease: easeOut }}
                className="relative mb-10 pl-14 md:pl-20"
              >
                <div className="absolute left-0 top-0 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] md:h-10 md:w-10">
                  <Icon className="h-4 w-4 text-[var(--kp-brand-deep)]" />
                </div>
                <div className="rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/70 p-5 backdrop-blur-md transition hover:border-[var(--kp-brand-light)]">
                  <span className="text-xs font-semibold uppercase tracking-wider text-[var(--kp-brand-deep)]">
                    {item.period}
                  </span>
                  <h3 className="mt-1 text-lg font-semibold text-[var(--kp-text-1)]">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--kp-text-2)]">{item.description}</p>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function FeaturedSection({ featured }: { featured: NonNullable<AboutProfile["featured"]> }) {
  return (
    <section className="relative z-10 px-[5%] py-24 lg:px-[8%]">
      <SectionHeader eyebrow="Featured" title="精选" />
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {featured.map((item, i) => (
          <motion.div
            key={item.title}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.7, delay: i * 0.08, ease: easeOut }}
            className="group relative overflow-hidden rounded-3xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/70 backdrop-blur-md transition hover:border-[var(--kp-brand-light)]"
          >
            {item.coverImage && (
              <div className="relative h-48 w-full overflow-hidden">
                <FeaturedImage src={item.coverImage} alt={item.title} />
                <div className="absolute inset-0 bg-gradient-to-t from-[var(--kp-bg-alt)] to-transparent" />
              </div>
            )}
            <div className="p-6 md:p-7">
              <div className="mb-3 flex items-center gap-2">
                <h3 className="text-lg font-semibold text-[var(--kp-text-1)]">{item.title}</h3>
                {item.tag && (
                  <span className="rounded-full bg-[var(--kp-brand-soft)] px-2 py-0.5 text-[10px] text-[var(--kp-brand-deep)]">
                    {item.tag}
                  </span>
                )}
              </div>
              <p className="text-sm leading-relaxed text-[var(--kp-text-2)]">{item.description}</p>
              {item.url && (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-[var(--kp-brand-deep)] transition hover:underline"
                >
                  查看
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </motion.div>
        ))}
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

function ProjectsSection({ projects }: { projects: AboutProfile["projects"] }) {
  return (
    <section className="relative z-10 px-[5%] py-24 lg:px-[8%]">
      <SectionHeader eyebrow="Projects" title="做过 / 正在做的事" />
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {projects.map((p, i) => (
          <ProjectCard key={p.name} project={p} index={i} />
        ))}
      </div>
    </section>
  );
}

function ProjectCard({ project, index }: { project: AboutProfile["projects"][number]; index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  const y = useTransform(scrollYProgress, [0, 1], [20, -20]);

  return (
    <motion.div
      ref={ref}
      style={{ y }}
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.7, delay: index * 0.08, ease: easeOut }}
      className="group relative"
    >
      <div className="relative h-full rounded-3xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/80 p-6 backdrop-blur-md transition-all duration-500 hover:-translate-y-1.5 hover:border-[var(--kp-brand-light)] hover:bg-[var(--kp-bg-alt)] md:p-7">
        {project.coverImage && (
          <div className="relative mb-4 h-40 w-full overflow-hidden rounded-2xl">
            <FeaturedImage src={project.coverImage} alt={project.name} />
          </div>
        )}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]">
            <Cpu className="h-4 w-4" />
          </div>
          {project.highlight && (
            <span className="rounded-full bg-[var(--kp-accent-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--kp-accent-deep)]">
              {project.highlight}
            </span>
          )}
        </div>
        <h3 className="mb-1 text-lg font-semibold text-[var(--kp-text-1)]">
          {project.href ? (
            <Link href={project.href} className="transition hover:text-[var(--kp-brand-deep)]">
              {project.name}
            </Link>
          ) : (
            project.name
          )}
        </h3>
        {project.tagline && <p className="mb-2 text-xs font-medium text-[var(--kp-brand-deep)]">{project.tagline}</p>}
        <p className="text-sm leading-relaxed text-[var(--kp-text-2)]">{project.description}</p>
        {project.stack.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {project.stack.slice(0, 5).map((s) => (
              <span key={s} className="rounded-md bg-[var(--kp-bg)] px-2 py-0.5 text-[10px] text-[var(--kp-text-3)]">
                {s}
              </span>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function ContentsSection({ contents }: { contents: AboutProfile["contents"] }) {
  return (
    <section className="relative z-10 px-[5%] py-24 lg:px-[8%]">
      <SectionHeader eyebrow="Contents" title="输出与内容" />
      <div className="grid gap-4 md:grid-cols-2">
        {contents.map((item, i) => (
          <motion.div
            key={item.title}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.6, delay: i * 0.06, ease: easeOut }}
            className="group flex items-start gap-4 rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/70 p-5 backdrop-blur-md transition hover:border-[var(--kp-brand-light)]"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--kp-accent-soft)] text-[var(--kp-accent-deep)]">
              <BookOpen className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <div className="mb-1 flex items-center gap-2">
                <h3 className="font-semibold text-[var(--kp-text-1)]">{item.title}</h3>
                <span className="rounded-full bg-[var(--kp-bg)] px-2 py-0.5 text-[10px] text-[var(--kp-text-3)]">{item.type}</span>
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
          </motion.div>
        ))}
      </div>
    </section>
  );
}

function StoryCardsSection({ cards }: { cards: AboutProfile["storyCards"] }) {
  if (!cards || cards.length === 0) return null;
  return (
    <section className="relative z-10 px-[5%] py-24 lg:px-[8%]">
      <SectionHeader eyebrow="Story" title="片段" />
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {cards.map((card, i) => (
          <motion.div
            key={card.title}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.7, delay: i * 0.08, ease: easeOut }}
            className="rounded-3xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/80 p-6 backdrop-blur-md transition hover:border-[var(--kp-brand-light)] md:p-7"
          >
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]">
              <BookOpen className="h-5 w-5" />
            </div>
            <h3 className="mb-3 text-lg font-semibold text-[var(--kp-text-1)]">{card.title}</h3>
            <p className="text-sm leading-relaxed text-[var(--kp-text-2)]">{card.description}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

function PhilosophySection({ philosophy }: { philosophy: AboutProfile["philosophy"] }) {
  return (
    <section className="relative z-10 px-[5%] py-24 lg:px-[8%]">
      <div className="mx-auto grid gap-12 lg:grid-cols-2">
        <SectionHeader eyebrow="Philosophy" title="一些偏见" />
        <div className="grid gap-5 md:grid-cols-2">
          {philosophy.map((item, i) => (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.7, delay: i * 0.08, ease: easeOut }}
              className="rounded-3xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/70 p-6 backdrop-blur-md transition hover:border-[var(--kp-brand-light)] md:p-7"
            >
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]">
                <Lightbulb className="h-5 w-5" />
              </div>
              <h3 className="mb-3 text-lg font-semibold text-[var(--kp-text-1)]">{item.title}</h3>
              {item.description && <p className="text-sm leading-relaxed text-[var(--kp-text-2)]">{item.description}</p>}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FooterCta({ profile }: { profile: AboutProfile }) {
  return (
    <section className="relative overflow-hidden px-[5%] py-24 lg:px-[8%]">
      <div className="pointer-events-none absolute inset-0 bg-[var(--kp-ink)]" />
      <div
        className="pointer-events-none absolute -left-24 top-0 h-[420px] w-[420px] rounded-full opacity-70 blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(var(--kp-accent-rgb), 0.45) 0%, transparent 68%)" }}
      />
      <div
        className="pointer-events-none absolute -right-16 bottom-0 h-[380px] w-[380px] rounded-full opacity-60 blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(var(--kp-brand-rgb), 0.35) 0%, transparent 70%)" }}
      />
      <div className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.9) 1px, transparent 0)", backgroundSize: "28px 28px" }} />

      <div className="relative z-10 mx-auto max-w-5xl text-center">
        <motion.div
          initial={{ opacity: 0, y: 36 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.85, ease: easeOut }}
        >
          <div className="mx-auto mb-7 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-[11px] font-medium tracking-wide text-white/75 backdrop-blur">
            <Sparkles className="h-3.5 w-3.5 text-[var(--kp-accent)]" />
            见微知著 · 本地优先数字花园
          </div>

          <h2 className="mb-5 text-balance text-4xl font-extrabold tracking-[-0.03em] text-white md:text-6xl">
            想聊聊？
          </h2>
          <p className="mx-auto mb-10 max-w-xl text-base leading-relaxed text-white/65 md:text-lg">
            通过 Agent 聊天、GitHub 或小红书都可以。本页源文件在 <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs">content/about/profile.md</code>。
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
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.7, ease: easeOut }}
      className="mb-10"
    >
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--kp-accent)]">{eyebrow}</p>
      <h2 className="text-3xl font-bold tracking-tight text-[var(--kp-text-1)] md:text-4xl">{title}</h2>
    </motion.div>
  );
}
