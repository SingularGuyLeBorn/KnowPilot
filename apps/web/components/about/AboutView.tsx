"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useInView, useScroll, useTransform } from "framer-motion";
import Link from "next/link";
import {
  ArrowUpRight,
  BookOpen,
  Bot,
  Briefcase,
  Calendar,
  Code2,
  Cpu,
  ExternalLink,
  FileText,
  Github,
  Globe,
  GraduationCap,
  Lightbulb,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Rocket,
  Sparkles,
  Target,
  Wand2,
} from "lucide-react";
import type { AboutProfile } from "@knowpilot/shared";
import { PostContent } from "@/components/post/PostContent";
import { RecentIntelligence } from "@/components/home/RecentIntelligence";
import { DeferredStarField } from "@/components/home/DeferredStarField";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const spring = { type: "spring" as const, stiffness: 260, damping: 26 };
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
    <div className="relative w-full overflow-x-hidden bg-[var(--kp-bg)]">
      {/* 背景：星空 + 渐变光晕 */}
      <div className="pointer-events-none fixed inset-0 z-0 opacity-90">
        <DeferredStarField variant="about" className="h-full w-full" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(var(--kp-accent-rgb),0.12),transparent_45%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_30%,rgba(var(--kp-brand-rgb),0.10),transparent_50%)]" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[var(--kp-bg)]" />
      </div>

      <div className="relative z-10">
        <HeroSection profile={profile} />

        <StatsSection
          loading={postsLoading || analyticsLoading}
          postCount={postCount}
          categoryCount={categoryCount}
          agentCount={analytics?.agents.total}
          skillEnabled={analytics?.skills.enabled}
          sessionCount={analytics?.sessions.total}
          runCount={analytics?.runs.total}
        />

        {profile.timeline.length > 0 && <TimelineSection timeline={profile.timeline} />}

        <BentoSection profile={profile} />

        {profile.projects.length > 0 && <ProjectsSection projects={profile.projects} />}

        {profile.contents.length > 0 && <ContentsSection contents={profile.contents} />}

        <StorySection bodyMarkdown={profile.bodyMarkdown} />

        {profile.philosophy.length > 0 && <PhilosophySection philosophy={profile.philosophy} />}

        <div className="bg-[var(--kp-bg)]/92">
          <RecentIntelligence posts={posts} />
        </div>

        <FooterCta profile={profile} />
      </div>
    </div>
  );
}

function HeroSection({ profile }: { profile: AboutProfile }) {
  return (
    <section className="relative flex min-h-[92vh] items-center px-[5%] pb-12 pt-24 md:px-[8%] lg:pt-28">
      <div className="grid w-full items-center gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: easeOut }}
          className="flex flex-col"
        >
          <div className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/70 px-3 py-1.5 text-xs font-medium text-[var(--kp-text-2)] backdrop-blur-md">
            <Sparkles className="h-3.5 w-3.5 text-[var(--kp-brand-deep)]" />
            <span>{profile.oneLiner || "Creator · Developer · AI 协作者"}</span>
          </div>

          <h1 className="text-[clamp(3.5rem,12vw,8rem)] font-black leading-[0.9] tracking-tighter text-[var(--kp-text-1)]">
            <span className="block bg-gradient-to-br from-[var(--kp-text-1)] via-[var(--kp-brand-deep)] to-[var(--kp-accent-deep)] bg-clip-text text-transparent">
              {profile.name}
            </span>
          </h1>

          <p className="mt-4 text-xl font-medium text-[var(--kp-brand-deep)] md:text-2xl">
            {profile.title}
          </p>

          <p className="mt-5 max-w-xl text-base leading-relaxed text-[var(--kp-text-2)] md:text-lg">
            {profile.tagline}
          </p>

          {profile.roles.length > 0 && (
            <div className="mt-6 flex flex-wrap gap-2">
              {profile.roles.map((role) => (
                <span
                  key={role}
                  className="rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/70 px-3 py-1 text-xs text-[var(--kp-text-2)] backdrop-blur-sm"
                >
                  {role}
                </span>
              ))}
            </div>
          )}

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/chat"
              className="group inline-flex items-center gap-2 rounded-full bg-[var(--kp-brand)] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-[var(--kp-brand)]/20 transition-all hover:scale-105 hover:bg-[var(--kp-brand-deep)] hover:shadow-xl hover:shadow-[var(--kp-brand)]/30"
            >
              <MessageSquare className="h-4 w-4" />
              开始对话
              <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>
            {profile.socials.map((s) => (
              <a
                key={s.platform}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/70 px-5 py-3 text-sm font-medium text-[var(--kp-text-1)] backdrop-blur-md transition-all hover:border-[var(--kp-brand-light)] hover:bg-[var(--kp-brand-soft)]"
              >
                <SocialIcon platform={s.platform} />
                {s.platform}
              </a>
            ))}
            {!profile.socials.find((s) => s.platform.toLowerCase() === "github") && profile.github && (
              <a
                href={profile.github}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/70 px-5 py-3 text-sm font-medium text-[var(--kp-text-1)] backdrop-blur-md transition-all hover:border-[var(--kp-brand-light)] hover:bg-[var(--kp-brand-soft)]"
              >
                <Github className="h-4 w-4" />
                GitHub
              </a>
            )}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-4 text-xs text-[var(--kp-text-3)]">
            {profile.location && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" />
                {profile.location}
              </span>
            )}
            {profile.email && (
              <a
                href={`mailto:${profile.email}`}
                className="inline-flex items-center gap-1.5 transition hover:text-[var(--kp-brand-deep)]"
              >
                <Mail className="h-3.5 w-3.5" />
                {profile.email}
              </a>
            )}
          </div>
        </motion.div>

        <HeroVisual />
      </div>
    </section>
  );
}

function SocialIcon({ platform }: { platform: string }) {
  const p = platform.toLowerCase();
  if (p.includes("github")) return <Github className="h-4 w-4" />;
  if (p.includes("twitter") || p.includes("x")) return <Globe className="h-4 w-4" />;
  if (p.includes("bilibili")) return <Globe className="h-4 w-4" />;
  return <Globe className="h-4 w-4" />;
}

function HeroVisual() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 1, delay: 0.2, ease: easeOut }}
      className="relative hidden aspect-square w-full max-w-lg lg:block"
    >
      <div className="absolute inset-[10%] rounded-full bg-gradient-to-br from-[var(--kp-brand)] via-[var(--kp-accent)] to-[var(--kp-brand-deep)] opacity-80 blur-2xl" />
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
        className="absolute inset-[15%] rounded-full bg-gradient-to-tr from-[var(--kp-brand-soft)] via-[var(--kp-accent-soft)] to-[var(--kp-bg-alt)]"
        style={{ boxShadow: "inset 0 0 80px rgba(var(--kp-brand-rgb),0.3)" }}
      />
      <motion.div
        animate={{ rotate: -360 }}
        transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
        className="absolute inset-0 rounded-full border border-[var(--kp-divider)]"
        style={{ borderRadius: "45% 55% 60% 40% / 55% 45% 55% 45%" }}
      />
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
        className="absolute inset-[8%] rounded-full border border-dashed border-[var(--kp-accent)]/30"
        style={{ borderRadius: "40% 60% 55% 45% / 50% 50% 60% 40%" }}
      />

      <FloatingCard icon={Bot} label="Agents" sub="常驻运行" className="left-0 top-[20%]" delay={0.4} />
      <FloatingCard icon={BookOpen} label="Notes" sub="Markdown 为源" className="bottom-[18%] right-0" delay={0.6} />
      <FloatingCard icon={Wand2} label="Skills" sub="可编排" className="right-[8%] top-[8%]" delay={0.8} />
    </motion.div>
  );
}

function FloatingCard({
  icon: Icon,
  label,
  sub,
  className,
  delay,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  sub: string;
  className?: string;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, delay, ease: easeOut }}
      className={cn(
        "absolute flex items-center gap-3 rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/80 p-3 shadow-lg backdrop-blur-md",
        className,
      )}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-sm font-semibold text-[var(--kp-text-1)]">{label}</p>
        <p className="text-[10px] text-[var(--kp-text-3)]">{sub}</p>
      </div>
    </motion.div>
  );
}

function StatsSection({
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
    <section className="relative z-10 px-[5%] pb-20 md:px-[8%]">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.8, ease: easeOut }}
        className="rounded-3xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/60 p-6 backdrop-blur-xl md:p-8"
      >
        <p className="mb-6 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--kp-text-3)]">
          见微实时数据
        </p>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-[var(--kp-text-3)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载中…
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-6">
            {stats.map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, scale: 0.92 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.06, ...spring }}
                className="flex flex-col items-center gap-2 text-center"
              >
                <stat.icon className="h-5 w-5 text-[var(--kp-brand-deep)]" />
                <AnimatedNumber value={stat.value ?? 0} />
                <span className="text-[11px] uppercase tracking-wider text-[var(--kp-text-3)]">
                  {stat.label}
                </span>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>
    </section>
  );
}

function AnimatedNumber({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true });
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!isInView) return;
    let raf: number;
    const start = performance.now();
    const duration = 1200;
    const animate = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 4);
      setDisplay(Math.floor(eased * value));
      if (progress < 1) raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [isInView, value]);

  return (
    <span ref={ref} className="text-3xl font-bold tabular-nums text-[var(--kp-text-1)] md:text-4xl">
      {display}
    </span>
  );
}

function TimelineSection({ timeline }: { timeline: AboutProfile["timeline"] }) {
  return (
    <section className="relative z-10 px-[5%] py-20 md:px-[8%]">
      <SectionHeader eyebrow="Timeline" title="一点经历" />
      <div className="relative mx-auto max-w-4xl">
        <div className="absolute left-4 top-0 bottom-0 w-px bg-[var(--kp-divider)] md:left-1/2" />
        {timeline.map((item, i) => {
          const Icon = (item.tag && TAG_ICON[item.tag]) || Calendar;
          const isLeft = i % 2 === 0;
          return (
            <motion.div
              key={item.period + item.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.7, delay: i * 0.1, ease: easeOut }}
              className={cn(
                "relative mb-8 flex items-start md:items-center",
                isLeft ? "md:flex-row" : "md:flex-row-reverse",
              )}
            >
              <div className="hidden w-1/2 md:block" />
              <div className="absolute left-4 z-10 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] md:left-1/2">
                <Icon className="h-4 w-4 text-[var(--kp-brand-deep)]" />
              </div>
              <div className="pl-12 md:w-1/2 md:pl-0 md:px-10">
                <div
                  className={cn(
                    "rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/70 p-5 backdrop-blur-md transition hover:border-[var(--kp-brand-light)]",
                    isLeft ? "md:text-right" : "md:text-left",
                  )}
                >
                  <span className="text-xs font-semibold uppercase tracking-wider text-[var(--kp-brand-deep)]">
                    {item.period}
                  </span>
                  <h3 className="mt-1 text-lg font-semibold text-[var(--kp-text-1)]">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--kp-text-2)]">{item.description}</p>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}

function BentoSection({ profile }: { profile: AboutProfile }) {
  return (
    <section className="relative z-10 px-[5%] py-20 md:px-[8%]">
      <SectionHeader eyebrow="Profile" title="偏好与工具" />

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
        {/* 关注方向 */}
        <BentoCard className="md:col-span-2 lg:col-span-2" delay={0}>
          <div className="flex h-full flex-col">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]">
              <Target className="h-5 w-5" />
            </div>
            <h3 className="mb-4 text-xl font-semibold text-[var(--kp-text-1)]">关注方向</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {profile.focus.map((item) => (
                <div key={item.title} className="rounded-xl border border-[var(--kp-divider-light)] bg-[var(--kp-bg)]/50 p-4">
                  <h4 className="mb-1 font-semibold text-[var(--kp-text-1)]">{item.title}</h4>
                  {item.description && (
                    <p className="text-xs leading-relaxed text-[var(--kp-text-2)]">{item.description}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </BentoCard>

        {/* 技术栈 */}
        {profile.stack.map((group) => (
          <BentoCard key={group.category} delay={0.05}>
            <div className="flex h-full flex-col">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--kp-accent-soft)] text-[var(--kp-accent-deep)]">
                <Code2 className="h-5 w-5" />
              </div>
              <h3 className="mb-3 text-lg font-semibold text-[var(--kp-text-1)]">{group.category}</h3>
              <div className="flex flex-wrap gap-2">
                {group.items.map((item) => (
                  <span
                    key={item}
                    className="rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg)]/60 px-3 py-1 text-xs text-[var(--kp-text-2)]"
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </BentoCard>
        ))}

        {/* 工具箱 */}
        <BentoCard className="md:col-span-2 lg:col-span-3" delay={0.1}>
          <div className="flex h-full flex-col">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]">
              <Wand2 className="h-5 w-5" />
            </div>
            <h3 className="mb-4 text-xl font-semibold text-[var(--kp-text-1)]">现在用的工具</h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {profile.toolbox.map((group) => (
                <div key={group.category} className="rounded-xl border border-[var(--kp-divider-light)] bg-[var(--kp-bg)]/50 p-4">
                  <h4 className="mb-2 text-sm font-semibold text-[var(--kp-text-1)]">{group.category}</h4>
                  <p className="text-xs leading-relaxed text-[var(--kp-text-2)]">{group.items.join(" · ")}</p>
                </div>
              ))}
            </div>
          </div>
        </BentoCard>
      </div>
    </section>
  );
}

function BentoCard({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.7, delay, ease: easeOut }}
      className={cn(
        "rounded-3xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/70 p-6 backdrop-blur-md transition-all duration-300 hover:border-[var(--kp-brand-light)] hover:bg-[var(--kp-bg-alt)]/90 hover:shadow-lg hover:shadow-[var(--kp-brand)]/5 md:p-7",
        className,
      )}
    >
      {children}
    </motion.div>
  );
}

function ProjectsSection({ projects }: { projects: AboutProfile["projects"] }) {
  return (
    <section className="relative z-10 px-[5%] py-20 md:px-[8%]">
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
  const y = useTransform(scrollYProgress, [0, 1], [30, -30]);

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
        {project.href && (
          <a
            href={project.href}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-[var(--kp-brand-deep)] transition hover:underline"
          >
            查看详情
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </motion.div>
  );
}

function ContentsSection({ contents }: { contents: AboutProfile["contents"] }) {
  return (
    <section className="relative z-10 px-[5%] py-20 md:px-[8%]">
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
                <span className="rounded-full bg-[var(--kp-bg)] px-2 py-0.5 text-[10px] text-[var(--kp-text-3)]">
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
          </motion.div>
        ))}
      </div>
    </section>
  );
}

function StorySection({ bodyMarkdown }: { bodyMarkdown: string }) {
  return (
    <section id="story" className="relative z-10 px-[5%] py-20 md:px-[8%]">
      <div className="mx-auto max-w-4xl">
        <SectionHeader eyebrow="Story" title="更碎的自述" />
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.8, delay: 0.1, ease: easeOut }}
          className="prose-kp rounded-3xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/80 p-6 backdrop-blur-md md:p-10"
        >
          <PostContent content={bodyMarkdown} />
        </motion.div>
      </div>
    </section>
  );
}

function PhilosophySection({ philosophy }: { philosophy: AboutProfile["philosophy"] }) {
  return (
    <section className="relative z-10 px-[5%] py-20 md:px-[8%]">
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
    </section>
  );
}

function FooterCta({ profile }: { profile: AboutProfile }) {
  return (
    <section className="relative z-10 px-[5%] py-24 md:px-[8%]">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.8, ease: easeOut }}
        className="relative overflow-hidden rounded-[2rem] border border-[var(--kp-divider)] bg-gradient-to-br from-[var(--kp-brand-soft)] to-[var(--kp-accent-soft)]/60 p-10 text-center backdrop-blur-md md:p-16"
      >
        <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-[var(--kp-brand)]/20 blur-3xl" />
        <div className="absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-[var(--kp-accent)]/20 blur-3xl" />

        <div className="relative z-10">
          <h2 className="text-3xl font-bold tracking-tight text-[var(--kp-text-1)] md:text-4xl">
            想聊聊？
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-[var(--kp-text-2)]">
            通过 Agent 聊天、GitHub 或小红书都可以。本页源文件在{" "}
            <code className="rounded bg-[var(--kp-bg)]/60 px-1.5 py-0.5 text-xs">content/about/profile.md</code>。
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/chat"
              className="inline-flex items-center gap-2 rounded-full bg-[var(--kp-brand)] px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:scale-105 hover:bg-[var(--kp-brand-deep)]"
            >
              <MessageSquare className="h-4 w-4" />
              开始对话
            </Link>
            {profile.github && (
              <a
                href={profile.github}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/70 px-6 py-3 text-sm font-medium text-[var(--kp-text-1)] transition hover:bg-[var(--kp-bg)]"
              >
                <Github className="h-4 w-4" />
                GitHub
              </a>
            )}
          </div>
        </div>
      </motion.div>
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
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--kp-accent)]">
        {eyebrow}
      </p>
      <h2 className="text-3xl font-bold tracking-tight text-[var(--kp-text-1)] md:text-4xl">{title}</h2>
    </motion.div>
  );
}
