"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import {
  ArrowUpRight,
  BookOpen,
  Cpu,
  Github,
  Lightbulb,
  Mail,
  MessageSquare,
  Rocket,
  Sparkles,
  Target,
  Wand2,
} from "lucide-react";
import type { AboutProfile } from "@knowpilot/shared";
import { NumberTicker } from "@/components/magicui/number-ticker";
import { ScrollReveal, StaggerContainer, StaggerItem } from "@/components/magicui/scroll-reveal";
import { HeroSection } from "@/components/about/HeroSection";
import { trpc } from "@/lib/trpc";

const easeSpring = [0.22, 1, 0.36, 1] as const;
const PHILOSOPHY_ICONS = [Lightbulb, Target, Sparkles, Rocket, BookOpen];

function parseStoryCards(bodyMarkdown: string) {
  const cards: { title: string; description: string }[] = [];
  if (!bodyMarkdown) return cards;
  const parts = bodyMarkdown.trim().split(/^## /m).filter(Boolean);
  for (const part of parts) {
    const lines = part.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const title = lines[0]?.replace(/^#+\s*/, "").trim();
    const description = lines
      .slice(1)
      .join(" ")
      .replace(/\*\*/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .trim()
      .slice(0, 110);
    if (title && description) cards.push({ title, description });
  }
  return cards.slice(0, 4);
}

function gradientFromTitle(title: string) {
  let hash = 0;
  for (let i = 0; i < title.length; i++) hash = (hash * 31 + title.charCodeAt(i)) % 360;
  return `linear-gradient(135deg, hsl(${hash} 26% 80%), hsl(${(hash + 45) % 360} 28% 72%))`;
}

export function AboutView({ profile }: { profile: AboutProfile }) {
  const { data: recentPosts } = trpc.post.list.useQuery({ published: true, pageSize: 6 });
  const [analyticsReady, setAnalyticsReady] = useState(false);
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (typeof w.requestIdleCallback === "function") {
      const id = w.requestIdleCallback(() => setAnalyticsReady(true), { timeout: 2500 });
      return () => {
        if (typeof w.cancelIdleCallback === "function") w.cancelIdleCallback(id);
      };
    }
    const t = setTimeout(() => setAnalyticsReady(true), 1400);
    return () => clearTimeout(t);
  }, []);
  const { data: analytics } = trpc.analytics.dashboard.useQuery({}, { enabled: analyticsReady });
  const postCount = analytics?.posts.published ?? recentPosts?.total ?? 0;
  const categoryCount = new Set(recentPosts?.items.map((p) => p.category).filter(Boolean) ?? []).size;
  const storyCards = parseStoryCards(profile.bodyMarkdown);

  return (
    <div className="relative w-full shrink-0 overflow-x-hidden bg-[var(--kp-bg)]">
      <HeroSection profile={profile} />

      {/* Compact stats */}
      <section className="relative border-y border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/60">
        <div className="absolute inset-0 opacity-[0.035]" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, var(--kp-brand-deep) 1px, transparent 0)", backgroundSize: "26px 26px" }} />
        <StaggerContainer className="relative z-10 mx-auto grid max-w-7xl grid-cols-2 divide-x divide-[var(--kp-divider)] md:grid-cols-4">
          {[
            { label: "已发布", value: postCount },
            { label: "分类", value: categoryCount },
            { label: "项目", value: profile.projects.length },
            { label: "偏见", value: profile.philosophy.length },
          ].map((stat) => (
            <StaggerItem key={stat.label}>
              <div className="group flex flex-col items-center gap-1 px-3 py-4 text-center">
                <span className="text-2xl font-black tabular-nums tracking-tight text-[var(--kp-text-1)] md:text-3xl">
                  <NumberTicker value={stat.value} className="text-[var(--kp-text-1)]" />
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--kp-text-3)]">{stat.label}</span>
              </div>
            </StaggerItem>
          ))}
        </StaggerContainer>
      </section>

      <main className="mx-auto max-w-7xl px-6 py-8 lg:px-12 lg:py-10">
        {/* Story cards */}
        {storyCards.length > 0 && (
          <section className="mb-6">
            <ScrollReveal className="mb-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--kp-accent)]">Story</p>
            </ScrollReveal>
            <StaggerContainer className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {storyCards.map((card) => (
                <StaggerItem key={card.title}>
                  <div className="kp-card-dense flex h-full flex-col p-4">
                    <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]">
                      <BookOpen className="h-4 w-4" />
                    </div>
                    <h3 className="mb-1 text-sm font-bold text-[var(--kp-text-1)]">{card.title}</h3>
                    <p className="text-xs leading-relaxed text-[var(--kp-text-2)]">{card.description}</p>
                  </div>
                </StaggerItem>
              ))}
            </StaggerContainer>
          </section>
        )}

        {/* Philosophy */}
        <section className="mb-6">
          <ScrollReveal className="mb-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--kp-accent)]">Philosophy</p>
          </ScrollReveal>
          <StaggerContainer className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {profile.philosophy.map((item, i) => {
              const Icon = PHILOSOPHY_ICONS[i % PHILOSOPHY_ICONS.length];
              return (
                <StaggerItem key={item.title}>
                  <div className="kp-card-dense flex h-full flex-col p-4">
                    <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--kp-accent-soft)] text-[var(--kp-accent-deep)]">
                      <Icon className="h-4 w-4" />
                    </div>
                    <h3 className="mb-1 text-sm font-bold text-[var(--kp-text-1)]">{item.title}</h3>
                    <p className="text-xs leading-relaxed text-[var(--kp-text-2)]">{item.description}</p>
                  </div>
                </StaggerItem>
              );
            })}
          </StaggerContainer>
        </section>

        {/* Focus + Stack + Toolbox + Now */}
        <section className="mb-6">
          <ScrollReveal className="mb-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--kp-accent)]">Profile</p>
          </ScrollReveal>
          <StaggerContainer className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <StaggerItem className="lg:col-span-1">
              <div className="kp-card-dense h-full p-4">
                <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--kp-accent-soft)] text-[var(--kp-accent-deep)]">
                  <Target className="h-4 w-4" />
                </div>
                <h3 className="mb-2 text-sm font-bold text-[var(--kp-text-1)]">关注方向</h3>
                <div className="flex flex-col gap-2">
                  {profile.focus.map((f) => (
                    <div key={f.title} className="rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)]/60 p-2">
                      <div className="text-xs font-bold text-[var(--kp-text-1)]">{f.title.replace(/^\*\*([^*]+)\*\*/, "$1")}</div>
                      <div className="mt-0.5 text-[11px] leading-relaxed text-[var(--kp-text-2)]">{f.description}</div>
                    </div>
                  ))}
                </div>
              </div>
            </StaggerItem>

            <StaggerItem className="lg:col-span-1">
              <div className="kp-card-dense h-full p-4">
                <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]">
                  <Cpu className="h-4 w-4" />
                </div>
                <h3 className="mb-2 text-sm font-bold text-[var(--kp-text-1)]">技术栈</h3>
                <div className="grid grid-cols-1 gap-2">
                  {profile.stack.map((g) => (
                    <div key={g.category} className="rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)]/60 p-2">
                      <div className="text-[11px] font-bold text-[var(--kp-text-1)]">{g.category}</div>
                      <div className="mt-0.5 text-[10px] leading-relaxed text-[var(--kp-text-3)]">{g.items.slice(0, 5).join(" · ")}</div>
                    </div>
                  ))}
                </div>
              </div>
            </StaggerItem>

            <StaggerItem className="lg:col-span-1">
              <div className="kp-card-dense h-full p-4">
                <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]">
                  <Wand2 className="h-4 w-4" />
                </div>
                <h3 className="mb-2 text-sm font-bold text-[var(--kp-text-1)]">现在用的工具</h3>
                <div className="grid grid-cols-1 gap-2">
                  {profile.toolbox.map((g) => (
                    <div key={g.category} className="rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)]/60 p-2">
                      <div className="text-[11px] font-bold text-[var(--kp-text-1)]">{g.category}</div>
                      <div className="mt-0.5 text-[10px] leading-relaxed text-[var(--kp-text-3)]">{g.items.slice(0, 6).join(" · ")}</div>
                    </div>
                  ))}
                </div>
              </div>
            </StaggerItem>
          </StaggerContainer>
        </section>

        {/* Timeline + Projects */}
        <section className="mb-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <ScrollReveal className="mb-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--kp-accent)]">Timeline</p>
              </ScrollReveal>
              <div className="relative pl-4">
                <div className="absolute left-0 top-1 bottom-1 w-px bg-[var(--kp-divider)]" />
                <StaggerContainer className="space-y-3">
                  {profile.timeline.map((item) => (
                    <StaggerItem key={item.period + item.title}>
                      <div className="relative pl-5">
                        <div className="absolute -left-1.5 top-1.5 h-3 w-3 rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] shadow-sm" />
                        <div className="kp-card-dense p-3">
                          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--kp-brand-1)]">{item.period}</span>
                          <h3 className="mt-0.5 text-sm font-bold text-[var(--kp-text-1)]">{item.title}</h3>
                          <p className="mt-0.5 text-xs leading-relaxed text-[var(--kp-text-2)]">{item.description}</p>
                        </div>
                      </div>
                    </StaggerItem>
                  ))}
                </StaggerContainer>
              </div>
            </div>

            <div>
              <ScrollReveal className="mb-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--kp-accent)]">Projects</p>
              </ScrollReveal>
              <StaggerContainer className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {profile.projects.slice(0, 4).map((p) => (
                  <StaggerItem key={p.name}>
                    <ProjectCard project={p} />
                  </StaggerItem>
                ))}
              </StaggerContainer>
            </div>
          </div>
        </section>

        {/* Contact */}
        <section>
          <ScrollReveal>
            <div className="kp-card-dense flex flex-col items-start justify-between gap-4 p-4 sm:flex-row sm:items-center">
              <div>
                <p className="text-sm font-bold text-[var(--kp-text-1)]">想聊聊？</p>
                <p className="text-xs text-[var(--kp-text-3)]">通过 Agent 聊天、GitHub 或邮件都可以。</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/chat"
                  className="group inline-flex h-9 items-center gap-1.5 rounded-full bg-[var(--kp-accent)] px-4 text-xs font-bold text-white transition-transform hover:scale-105"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  对话
                  <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </Link>
                {profile.github && (
                  <a
                    href={profile.github}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg)]/70 px-4 text-xs font-bold text-[var(--kp-text-1)] transition-colors hover:border-[var(--kp-brand-light)]"
                  >
                    <Github className="h-3.5 w-3.5" /> GitHub
                  </a>
                )}
                {profile.email && (
                  <a
                    href={`mailto:${profile.email}`}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg)]/70 px-4 text-xs font-bold text-[var(--kp-text-1)] transition-colors hover:border-[var(--kp-brand-light)]"
                  >
                    <Mail className="h-3.5 w-3.5" /> 邮件
                  </a>
                )}
              </div>
            </div>
          </ScrollReveal>
        </section>
      </main>
    </div>
  );
}

function ProjectCard({ project }: { project: AboutProfile["projects"][number] }) {
  const className = "kp-card-dense flex h-full flex-col overflow-hidden";
  const body = (
    <>
      <div
        className="h-24 w-full bg-cover bg-center transition-transform duration-500 group-hover:scale-105"
        style={{ backgroundImage: gradientFromTitle(project.name) }}
      />
      <div className="flex flex-1 flex-col p-3">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-[var(--kp-text-1)] transition-colors group-hover:text-[var(--kp-accent-deep)]">
            {project.name}
          </h3>
          {project.highlight && (
            <span className="shrink-0 rounded-full bg-[var(--kp-accent-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--kp-accent-deep)]">
              {project.highlight}
            </span>
          )}
        </div>
        {project.tagline && <p className="mb-1 text-[10px] font-bold text-[var(--kp-brand-deep)]">{project.tagline}</p>}
        <p className="mb-2 line-clamp-2 text-xs leading-relaxed text-[var(--kp-text-2)]">{project.description}</p>
        <div className="mt-auto flex flex-wrap gap-1">
          {project.stack.slice(0, 3).map((s) => (
            <span key={s} className="rounded-md border border-[var(--kp-divider)] bg-[var(--kp-bg)]/60 px-1.5 py-0.5 text-[10px] text-[var(--kp-text-3)]">
              {s}
            </span>
          ))}
        </div>
      </div>
    </>
  );

  const inner = !project.href ? (
    <div className={className}>{body}</div>
  ) : project.href.startsWith("http") ? (
    <a href={project.href} target="_blank" rel="noopener noreferrer" className={className}>
      {body}
    </a>
  ) : (
    <Link href={project.href} className={className}>
      {body}
    </Link>
  );

  return (
    <motion.div
      whileHover={{ y: -2 }}
      transition={{ duration: 0.2, ease: easeSpring }}
      className="group h-full"
    >
      {inner}
    </motion.div>
  );
}
