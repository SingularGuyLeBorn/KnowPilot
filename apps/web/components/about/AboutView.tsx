"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Archive,
  ArrowUpRight,
  BarChart3,
  Blocks,
  BookOpen,
  Brain,
  Briefcase,
  Bug,
  CalendarClock,
  Compass,
  Cpu,
  Eye,
  Gamepad2,
  Github,
  GraduationCap,
  Heart,
  Layers,
  Mail,
  MessageSquare,
  Network,
  Newspaper,
  Quote,
  Rocket,
  Sparkles,
  Sprout,
  Target,
  Terminal,
  User,
  Wand2,
} from "lucide-react";
import type { AboutProfile } from "@knowpilot/shared";
import { ScrollReveal, StaggerContainer, StaggerItem } from "@/components/magicui/scroll-reveal";
import { HeroSection } from "@/components/about/HeroSection";
import { SolarSystemScene } from "@/components/about/SolarSystemScene";
import { BlackHoleScene } from "@/components/about/BlackHoleScene";
import { SeasideCanvas } from "@/components/about/SeasideCanvas";
import { OasisMindLogo } from "@/lib/icons";
import { cn } from "@/lib/utils";

const easeSpring = [0.22, 1, 0.36, 1] as const;

function parseStoryCards(bodyMarkdown: string) {
  const cards: { title: string; body: string }[] = [];
  if (!bodyMarkdown) return cards;
  const parts = bodyMarkdown.trim().split(/^## /m).filter(Boolean);
  for (const part of parts) {
    const lines = part.split(/\n/).map((l) => l.trimEnd());
    const title = lines[0]?.replace(/^#+\s*/, "").trim();
    const body = lines.slice(1).join("\n").trim();
    if (title && body) cards.push({ title, body });
  }
  return cards.slice(0, 4);
}

function StoryMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-1.5 text-xs leading-relaxed text-[var(--kp-text-2)] last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="mb-1.5 list-disc space-y-0.5 pl-4 text-xs text-[var(--kp-text-2)]">{children}</ul>,
        ol: ({ children }) => <ol className="mb-1.5 list-decimal space-y-0.5 pl-4 text-xs text-[var(--kp-text-2)]">{children}</ol>,
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="underline decoration-[var(--kp-accent-light)] underline-offset-2 hover:text-[var(--kp-accent-deep)]">{children}</a>,
        strong: ({ children }) => <strong className="font-semibold text-[var(--kp-text-1)]">{children}</strong>,
        h1: ({ children }) => <h4 className="mb-1 text-xs font-bold text-[var(--kp-text-1)]">{children}</h4>,
        h2: ({ children }) => <h4 className="mb-1 text-xs font-bold text-[var(--kp-text-1)]">{children}</h4>,
        h3: ({ children }) => <h4 className="mb-1 text-xs font-bold text-[var(--kp-text-1)]">{children}</h4>,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}

function storyIcon(title: string) {
  if (title.includes("我是谁")) return User;
  if (title.includes("做什么")) return Briefcase;
  if (title.includes("为什么")) return Heart;
  if (title.includes("技术")) return Cpu;
  return Compass;
}

function philosophyIcon(title: string) {
  if (title.includes("做出东西")) return Rocket;
  if (title.includes("可控")) return Eye;
  if (title.includes("多收")) return Archive;
  if (title.includes("梦想")) return Sparkles;
  return Compass;
}

function focusIcon(title: string) {
  if (title.includes("AI")) return Brain;
  if (title.includes("见微") || title.includes("OasisMind")) return Sprout;
  if (title.includes("Agent")) return Eye;
  return Target;
}

function gradientFromTitle(title: string) {
  let hash = 0;
  for (let i = 0; i < title.length; i++) hash = (hash * 31 + title.charCodeAt(i)) % 360;
  return `linear-gradient(135deg, hsl(${hash} 26% 80%), hsl(${(hash + 45) % 360} 28% 72%))`;
}

const QUOTES = [
  "须知少时凌云志，曾许人间第一流。",
  "少年不惧岁月长，彼方尚有荣光在。",
  "白马长枪飘如诗，鲜衣怒马少年时。",
  "春风得意马蹄疾，一日看尽长安花。",
  "大鹏一日同风起，扶摇直上九万里。",
  "且将新火试新茶，诗酒趁年华。",
  "纵有千古，横有八荒；前途似海，来日方长。",
  "追风赶月莫停留，平芜尽处是春山。",
];

function QuoteCarousel() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return undefined;
    const timer = setInterval(() => setIndex((i) => (i + 1) % QUOTES.length), 6000);
    return () => clearInterval(timer);
  }, [paused]);
  return (
    <div
      className="relative overflow-hidden border-y border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/60 py-6 text-center"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <Quote className="mx-auto mb-2 h-5 w-5 text-[var(--kp-brand-light)]" />
      <div className="relative mx-auto min-h-[3.5rem] max-w-4xl px-6 md:min-h-[4rem]">
        <AnimatePresence mode="wait">
          <motion.p
            key={index}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.45, ease: easeSpring }}
            className="text-lg font-medium italic text-[var(--kp-text-1)] md:text-xl lg:text-2xl"
          >
            {QUOTES[index]}
          </motion.p>
        </AnimatePresence>
      </div>
      <div className="mt-4 flex justify-center gap-1.5">
        {QUOTES.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setIndex(i)}
            className={cn(
              "h-1.5 rounded-full transition-all",
              i === index ? "w-4 bg-[var(--kp-accent)]" : "w-1.5 bg-[var(--kp-divider)] hover:bg-[var(--kp-brand-light)]",
            )}
            aria-label={`切换到第 ${i + 1} 句`}
          />
        ))}
      </div>
    </div>
  );
}

function projectIcon(name: string) {
  if (name.includes("见微") || name.includes("OasisMind")) {
    return { type: "logo" as const };
  }
  if (name.includes("PubCrawler")) return { type: "lucide" as const, Icon: Bug };
  if (name.includes("CS336")) return { type: "lucide" as const, Icon: GraduationCap };
  if (name.includes("LLM")) return { type: "lucide" as const, Icon: Brain };
  if (name.includes("go-game")) return { type: "lucide" as const, Icon: Gamepad2 };
  if (name.includes("xhs")) return { type: "lucide" as const, Icon: BarChart3 };
  if (name.includes("wechat")) return { type: "lucide" as const, Icon: Terminal };
  if (name.includes("Transformer")) return { type: "lucide" as const, Icon: Network };
  if (name.includes("Daily")) return { type: "lucide" as const, Icon: Newspaper };
  if (name.includes("MetaBlog")) return { type: "lucide" as const, Icon: Blocks };
  return { type: "lucide" as const, Icon: Layers };
}

function SectionHeader({
  icon,
  title,
  className,
  iconClassName,
}: {
  icon: React.ReactNode;
  title: string;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      <div
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]",
          iconClassName,
        )}
      >
        {icon}
      </div>
      <h3 className="mt-0.5 text-base font-bold text-[var(--kp-text-1)]">{title}</h3>
    </div>
  );
}

function SectionLabel({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Icon className="h-4 w-4 text-[var(--kp-accent)]" />
      <p className="text-sm font-bold uppercase tracking-[0.12em] text-[var(--kp-accent)]">{children}</p>
    </div>
  );
}

export function AboutView({ profile }: { profile: AboutProfile }) {
  const storyCards = parseStoryCards(profile.bodyMarkdown);

  return (
    <div className="relative w-full shrink-0 overflow-x-hidden bg-[var(--kp-bg)]">
      <HeroSection profile={profile} />
      <QuoteCarousel />

      <main className="mx-auto max-w-7xl px-6 py-8 lg:px-12 lg:py-10">
        {/* Story cards */}
        {storyCards.length > 0 && (
          <section className="mb-6">
            <ScrollReveal>
              <SectionLabel icon={BookOpen}>Story</SectionLabel>
            </ScrollReveal>
            <StaggerContainer className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {storyCards.map((card) => {
                const Icon = storyIcon(card.title);
                return (
                  <StaggerItem key={card.title}>
                    <div className="kp-card-dense flex h-full flex-col p-4">
                      <SectionHeader icon={<Icon className="h-4 w-4" />} title={card.title} className="mb-2" />
                      <div className="text-xs leading-relaxed text-[var(--kp-text-2)]">
                        <StoryMarkdown>{card.body}</StoryMarkdown>
                      </div>
                    </div>
                  </StaggerItem>
                );
              })}
            </StaggerContainer>
          </section>
        )}

        {/* Philosophy */}
        <section className="mb-6">
          <ScrollReveal>
            <SectionLabel icon={Sparkles}>Philosophy</SectionLabel>
          </ScrollReveal>
          <StaggerContainer className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {profile.philosophy.map((item) => {
              const Icon = philosophyIcon(item.title);
              return (
                <StaggerItem key={item.title}>
                  <div className="kp-card-dense flex h-full flex-col p-4">
                    <SectionHeader icon={<Icon className="h-4 w-4" />} title={item.title} className="mb-2" />
                    <p className="text-xs leading-relaxed text-[var(--kp-text-2)]">{item.description}</p>
                  </div>
                </StaggerItem>
              );
            })}
          </StaggerContainer>
        </section>

        {/* Cosmos */}
        <section className="mb-6">
          <ScrollReveal>
            <SectionLabel icon={Rocket}>Cosmos</SectionLabel>
          </ScrollReveal>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <SolarSystemScene />
            <BlackHoleScene />
          </div>
        </section>

        {/* Focus + Stack + Toolbox */}
        <section className="mb-6">
          <ScrollReveal>
            <SectionLabel icon={User}>Profile</SectionLabel>
          </ScrollReveal>
          <StaggerContainer className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {profile.focus.map((f) => {
              const Icon = focusIcon(f.title);
              const title = f.title.replace(/^\*\*([^*]+)\*\*/, "$1").replace(/：$/, "").trim();
              return (
                <StaggerItem key={f.title}>
                  <div className="kp-card-dense flex h-full flex-col p-4">
                    <SectionHeader icon={<Icon className="h-4 w-4" />} title={title} className="mb-2" />
                    <div className="text-xs leading-relaxed text-[var(--kp-text-2)]">
                      <StoryMarkdown>{f.description}</StoryMarkdown>
                    </div>
                  </div>
                </StaggerItem>
              );
            })}
          </StaggerContainer>
          <StaggerContainer className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <StaggerItem>
              <div className="kp-card-dense h-full p-3">
                <SectionHeader icon={<Cpu className="h-4 w-4" />} title="技术栈" className="mb-1.5" />
                <p className="text-[11px] leading-snug text-[var(--kp-text-3)]">
                  {profile.stack.map((g, i) => (
                    <span key={g.category}>
                      <span className="font-semibold text-[var(--kp-text-1)]">{g.category}</span>
                      <span>: {g.items.slice(0, 6).join(" · ")}</span>
                      {i < profile.stack.length - 1 && <span className="mx-1.5 text-[var(--kp-text-3)]/60">·</span>}
                    </span>
                  ))}
                </p>
              </div>
            </StaggerItem>

            <StaggerItem>
              <div className="kp-card-dense h-full p-3">
                <SectionHeader icon={<Wand2 className="h-4 w-4" />} title="现在用的工具" className="mb-1.5" />
                <p className="text-[11px] leading-snug text-[var(--kp-text-3)]">
                  {profile.toolbox.map((g, i) => (
                    <span key={g.category}>
                      <span className="font-semibold text-[var(--kp-text-1)]">{g.category}</span>
                      <span>: {g.items.slice(0, 7).join(" · ")}</span>
                      {i < profile.toolbox.length - 1 && <span className="mx-1.5 text-[var(--kp-text-3)]/60">·</span>}
                    </span>
                  ))}
                </p>
              </div>
            </StaggerItem>
          </StaggerContainer>
        </section>

        {/* Timeline + Projects */}
        <section className="mb-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <ScrollReveal>
                <SectionLabel icon={CalendarClock}>Timeline</SectionLabel>
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
              <ScrollReveal>
                <SectionLabel icon={Layers}>Projects</SectionLabel>
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

        <CosmicFooter />
      </main>
    </div>
  );
}

function CosmicFooter() {
  return (
    <section className="relative mt-6 h-[320px] overflow-hidden rounded-2xl border border-[var(--kp-divider)] md:h-[420px]">
      <SeasideCanvas />
      <div className="relative z-10 flex h-full flex-col items-center justify-center px-6 py-10 text-center">
        <p className="text-2xl font-black tracking-tight text-white drop-shadow md:text-3xl lg:text-4xl">
          我们的征途是星辰大海
        </p>
        <p className="mt-2 text-sm font-bold text-white/90 drop-shadow md:text-base">
          这个世界太你妈坏了 卧槽
        </p>
        <p className="mt-1 text-sm font-medium text-white/80 drop-shadow md:text-base">
          所以，不如先去海边搞点薯条
        </p>
      </div>
    </section>
  );
}

function ProjectCard({ project }: { project: AboutProfile["projects"][number] }) {
  const className = "kp-card-dense relative flex h-full flex-col overflow-hidden";
  const iconDef = projectIcon(project.name);
  const iconNode =
    iconDef.type === "logo" ? (
      <OasisMindLogo size={18} variant="ink-seed" />
    ) : (
      <iconDef.Icon className="h-4 w-4" />
    );

  const body = (
    <>
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07] transition-transform duration-500 group-hover:scale-105"
        style={{ backgroundImage: gradientFromTitle(project.name) }}
      />
      <div className="relative flex flex-1 flex-col p-3">
        <div className="mb-1.5 flex items-start justify-between gap-2">
          <SectionHeader
            icon={iconNode}
            title={project.name}
            className="min-w-0"
          />
          <div className="flex shrink-0 items-center gap-1.5">
            {project.highlight && (
              <span className="rounded-full bg-[var(--kp-accent-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--kp-accent-deep)]">
                {project.highlight}
              </span>
            )}
            {project.href && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-[var(--kp-text-3)] opacity-0 transition-all group-hover:text-[var(--kp-accent-deep)] group-hover:opacity-100">
                访问
                <ArrowUpRight className="h-3 w-3 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </span>
            )}
          </div>
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
