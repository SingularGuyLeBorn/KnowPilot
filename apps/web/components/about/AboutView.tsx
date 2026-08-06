"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, type ReactNode } from "react";
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
  Target,
  Terminal,
  User,
  Wand2,
} from "lucide-react";
import type { AboutProfile } from "@knowpilot/shared";
import { CurlyMark, SquareMark } from "@/components/home/accentMark";
import { ScrollReveal, StaggerContainer, StaggerItem } from "@/components/magicui/scroll-reveal";
import { HeroSection } from "@/components/about/HeroSection";
import { ThreeTheories } from "@/components/about/ThreeTheories";
import { OasisMindLogo } from "@/lib/icons";
import { cn } from "@/lib/utils";

const SolarSystemScene = dynamic(
  () => import("@/components/about/SolarSystemScene").then((m) => m.SolarSystemScene),
  { ssr: false, loading: () => null },
);
const BlackHoleScene = dynamic(
  () => import("@/components/about/BlackHoleScene").then((m) => m.BlackHoleScene),
  { ssr: false, loading: () => null },
);
const easeSpring = [0.22, 1, 0.36, 1] as const;
const hoverSpring = { type: "spring", stiffness: 260, damping: 26 } as const;

/** 卡片 hover 配方：同页多套，避免千篇一律 */
type HoverKind = "lift" | "tilt" | "sheen" | "glowBlue" | "glowPeach" | "rail" | "scale" | "sink";

const HOVER_MOTION: Record<
  HoverKind,
  { whileHover: Record<string, number>; className: string }
> = {
  lift: {
    whileHover: { y: -7 },
    className:
      "transition-[border-color,box-shadow] duration-500 hover:border-[var(--kp-brand)]/35 hover:shadow-[0_22px_48px_-16px_rgba(0,135,235,0.28)]",
  },
  tilt: {
    whileHover: { y: -4, rotate: -1.2, scale: 1.015 },
    className:
      "origin-center transition-[border-color,box-shadow] duration-500 hover:border-[var(--kp-accent)]/40 hover:shadow-[0_18px_40px_-14px_rgba(232,168,74,0.28)]",
  },
  sheen: {
    whileHover: { y: -5 },
    className:
      "kp-card-topline kp-card-sheen transition-[border-color,box-shadow,background-color] duration-500 hover:border-[var(--kp-brand)]/30 hover:bg-white/70 hover:shadow-[0_20px_44px_-16px_rgba(0,135,235,0.26)]",
  },
  glowBlue: {
    whileHover: { y: -4, scale: 1.01 },
    className:
      "transition-[border-color,box-shadow] duration-500 hover:border-[var(--kp-brand)]/40 hover:shadow-[0_0_0_1px_rgba(0,135,235,0.12),0_20px_48px_-18px_rgba(0,135,235,0.35)]",
  },
  glowPeach: {
    whileHover: { y: -3, scale: 1.02 },
    className:
      "transition-[border-color,box-shadow] duration-500 hover:border-[var(--kp-accent)]/45 hover:shadow-[0_0_0_1px_rgba(232,168,74,0.14),0_18px_42px_-16px_rgba(232,168,74,0.32)]",
  },
  rail: {
    whileHover: { x: 4, y: -2 },
    className:
      "border-l-[3px] border-l-transparent transition-[border-color,box-shadow,border-left-color] duration-500 hover:border-l-[var(--kp-brand)] hover:border-[var(--kp-brand)]/25 hover:shadow-[0_14px_36px_-14px_rgba(0,80,160,0.22)]",
  },
  scale: {
    whileHover: { scale: 1.03 },
    className:
      "origin-center transition-[border-color,box-shadow] duration-500 hover:border-white/80 hover:shadow-[0_24px_50px_-20px_rgba(0,80,160,0.3)]",
  },
  sink: {
    whileHover: { y: 2, scale: 0.985 },
    className:
      "transition-[border-color,box-shadow,background-color] duration-500 hover:border-[var(--kp-divider)] hover:bg-white/75 hover:shadow-[inset_0_2px_12px_rgba(0,80,160,0.08)]",
  },
};

function HoverCard({
  kind,
  className,
  children,
}: {
  kind: HoverKind;
  className?: string;
  children: ReactNode;
}) {
  const cfg = HOVER_MOTION[kind];
  return (
    <motion.div
      whileHover={cfg.whileHover}
      transition={hoverSpring}
      className={cn(
        "group relative h-full overflow-hidden rounded-2xl border border-white/55 bg-white/50 shadow-[0_12px_32px_-18px_rgba(0,80,160,0.16)] backdrop-blur-xl",
        cfg.className,
      )}
    >
      {(kind === "glowBlue" || kind === "glowPeach") && (
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute -right-10 -top-12 h-28 w-28 rounded-full opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-100",
            kind === "glowBlue" ? "bg-[var(--kp-glow-blue)]/55" : "bg-[var(--kp-glow-peach)]/55",
          )}
        />
      )}
      {kind === "sheen" && (
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-10 -left-8 h-24 w-24 rounded-full bg-[var(--kp-glow-blue)]/0 blur-3xl transition-all duration-500 group-hover:bg-[var(--kp-glow-blue)]/40"
        />
      )}
      {/* className（含 flex）必须落在内容层：外层只有一个子节点时 flex-row 无效 */}
      <div className={cn("relative h-full", className)}>{children}</div>
    </motion.div>
  );
}

const STORY_HOVER: HoverKind[] = ["lift", "tilt", "sheen", "glowBlue"];
const PHILO_HOVER: HoverKind[] = ["glowPeach", "rail", "scale", "sink"];
const FOCUS_HOVER: HoverKind[] = ["sheen", "lift", "tilt"];

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
  if (title.includes("见微") || title.includes("OasisMind")) return Layers;
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
      className="relative overflow-hidden border-y border-white/40 bg-white/40 py-6 text-center backdrop-blur-md"
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
    <div className={cn("flex min-w-0 items-start gap-2.5", className)}>
      <div
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]",
          iconClassName,
        )}
      >
        {icon}
      </div>
      <h3 className="mt-0.5 min-w-0 truncate text-base font-bold text-[var(--kp-text-1)]" title={title}>
        {title}
      </h3>
    </div>
  );
}

function SectionLabel({
  icon: Icon,
  children,
  square = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  square?: boolean;
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Icon className="h-4 w-4 text-[var(--kp-brand)]" />
      <p className="text-sm font-bold uppercase tracking-[0.12em] text-[var(--kp-text-1)]">
        {square ? <SquareMark>{children}</SquareMark> : <CurlyMark>{children}</CurlyMark>}
      </p>
    </div>
  );
}

export function AboutView({ profile }: { profile: AboutProfile }) {
  const storyCards = parseStoryCards(profile.bodyMarkdown);

  return (
    <div className="kp-force-light relative w-full shrink-0 overflow-x-hidden">
      <HeroSection profile={profile} />
      <ThreeTheories />
      <QuoteCarousel />

      <main className="mx-auto max-w-7xl px-6 py-8 lg:px-12 lg:py-10">
        {/* Story cards */}
        {storyCards.length > 0 && (
          <section className="mb-6">
            <ScrollReveal>
              <SectionLabel icon={BookOpen}>Story</SectionLabel>
            </ScrollReveal>
            <StaggerContainer className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {storyCards.map((card, i) => {
                const Icon = storyIcon(card.title);
                return (
                  <StaggerItem key={card.title}>
                    <HoverCard kind={STORY_HOVER[i % STORY_HOVER.length]} className="flex flex-col p-4">
                      <SectionHeader
                        icon={<Icon className="h-4 w-4 transition-transform duration-300 group-hover:scale-110" />}
                        title={card.title}
                        className="mb-2"
                      />
                      <div className="text-xs leading-relaxed text-[var(--kp-text-2)]">
                        <StoryMarkdown>{card.body}</StoryMarkdown>
                      </div>
                    </HoverCard>
                  </StaggerItem>
                );
              })}
            </StaggerContainer>
          </section>
        )}

        {/* Philosophy */}
        <section className="mb-6">
          <ScrollReveal>
            <SectionLabel icon={Sparkles} square>
              Philosophy
            </SectionLabel>
          </ScrollReveal>
          <StaggerContainer className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {profile.philosophy.map((item, i) => {
              const Icon = philosophyIcon(item.title);
              return (
                <StaggerItem key={item.title}>
                  <HoverCard kind={PHILO_HOVER[i % PHILO_HOVER.length]} className="flex flex-col p-4">
                    <SectionHeader
                      icon={
                        <Icon className="h-4 w-4 transition-transform duration-500 group-hover:rotate-12" />
                      }
                      title={item.title}
                      className="mb-2"
                    />
                    <p className="text-xs leading-relaxed text-[var(--kp-text-2)]">{item.description}</p>
                  </HoverCard>
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
            <motion.div
              whileHover={{ y: -5, scale: 1.01 }}
              transition={hoverSpring}
              className="overflow-hidden rounded-2xl shadow-[0_12px_32px_-18px_rgba(0,80,160,0.2)] transition-shadow duration-500 hover:shadow-[0_24px_56px_-18px_rgba(0,135,235,0.35)]"
            >
              <SolarSystemScene />
            </motion.div>
            <motion.div
              whileHover={{ y: -5, scale: 1.01, rotate: 0.4 }}
              transition={hoverSpring}
              className="overflow-hidden rounded-2xl shadow-[0_12px_32px_-18px_rgba(0,0,0,0.35)] transition-shadow duration-500 hover:shadow-[0_24px_56px_-16px_rgba(120,40,180,0.45)]"
            >
              <BlackHoleScene />
            </motion.div>
          </div>
        </section>

        {/* Focus + Stack + Toolbox */}
        <section className="mb-6">
          <ScrollReveal>
            <SectionLabel icon={User}>Profile</SectionLabel>
          </ScrollReveal>
          <StaggerContainer className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {profile.focus.map((f, i) => {
              const Icon = focusIcon(f.title);
              const title = f.title.replace(/^\*\*([^*]+)\*\*/, "$1").replace(/：$/, "").trim();
              return (
                <StaggerItem key={f.title}>
                  <HoverCard kind={FOCUS_HOVER[i % FOCUS_HOVER.length]} className="flex flex-col p-4">
                    <SectionHeader
                      icon={
                        <Icon className="h-4 w-4 transition-transform duration-300 group-hover:-translate-y-0.5" />
                      }
                      title={title}
                      className="mb-2"
                    />
                    <div className="text-xs leading-relaxed text-[var(--kp-text-2)]">
                      <StoryMarkdown>{f.description}</StoryMarkdown>
                    </div>
                  </HoverCard>
                </StaggerItem>
              );
            })}
          </StaggerContainer>
          <StaggerContainer className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <StaggerItem>
              <HoverCard kind="rail" className="p-3">
                <SectionHeader icon={<Cpu className="h-4 w-4" />} title="技术栈" className="mb-1.5" />
                <div className="space-y-1">
                  {profile.stack.map((g) => (
                    <p key={g.category} className="text-[11px] leading-snug text-[var(--kp-text-3)]">
                      <span className="font-semibold text-[var(--kp-text-1)]">{g.category}</span>
                      <span className="text-[var(--kp-text-3)]">: {g.items.slice(0, 6).join(" · ")}</span>
                    </p>
                  ))}
                </div>
              </HoverCard>
            </StaggerItem>

            <StaggerItem>
              <HoverCard kind="sink" className="p-3">
                <SectionHeader icon={<Wand2 className="h-4 w-4" />} title="现在用的工具" className="mb-1.5" />
                <div className="space-y-1">
                  {profile.toolbox.map((g) => (
                    <p key={g.category} className="text-[11px] leading-snug text-[var(--kp-text-3)]">
                      <span className="font-semibold text-[var(--kp-text-1)]">{g.category}</span>
                      <span className="text-[var(--kp-text-3)]">: {g.items.slice(0, 7).join(" · ")}</span>
                    </p>
                  ))}
                </div>
              </HoverCard>
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
                  {profile.timeline.map((item, i) => (
                    <StaggerItem key={item.period + item.title}>
                      <div className="relative pl-5">
                        <div className="absolute -left-1.5 top-1.5 h-3 w-3 rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] shadow-sm transition-transform duration-300 group-hover:scale-125" />
                        <HoverCard
                          kind={i % 2 === 0 ? "rail" : "glowBlue"}
                          className="p-3"
                        >
                          <h3 className="flex min-w-0 items-center gap-1.5 text-sm font-bold text-[var(--kp-text-1)]">
                            {item.title.includes("大学") || item.title.includes("科技") ? (
                              <GraduationCap className="h-3.5 w-3.5 shrink-0 text-[var(--kp-brand)]" aria-hidden />
                            ) : item.title.includes("回家") ? (
                              <Heart className="h-3.5 w-3.5 shrink-0 text-[var(--kp-brand)]" aria-hidden />
                            ) : (
                              <Quote className="h-3.5 w-3.5 shrink-0 text-[var(--kp-brand)]" aria-hidden />
                            )}
                            <span className="min-w-0 truncate whitespace-nowrap">
                              <span className="text-[var(--kp-brand-1)]">
                                {item.period.replace(/—/g, "-")}
                              </span>
                              <span className="mx-1.5 text-[var(--kp-text-3)]">·</span>
                              {item.title}
                            </span>
                          </h3>
                          <p className="mt-1 text-xs leading-relaxed text-[var(--kp-text-2)]">
                            {item.description}
                          </p>
                        </HoverCard>
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
                {profile.projects.slice(0, 4).map((p, i) => (
                  <StaggerItem key={p.name}>
                    <ProjectCard project={p} hoverKind={(["tilt", "sheen", "glowPeach", "scale"] as HoverKind[])[i % 4]} />
                  </StaggerItem>
                ))}
              </StaggerContainer>
            </div>
          </div>
        </section>

        {/* Contact */}
        <section>
          <ScrollReveal>
            <HoverCard
              kind="glowBlue"
              className="flex flex-nowrap items-center justify-between gap-4 p-4"
            >
              <div className="min-w-0 shrink">
                <p className="text-sm font-bold text-[var(--kp-text-1)]">
                  想聊聊？ <SquareMark className="text-sm font-semibold">随时</SquareMark>
                </p>
                <p className="text-xs text-[var(--kp-text-3)]">对话、GitHub 或邮件都可以。</p>
              </div>
              <div className="flex shrink-0 flex-nowrap items-center gap-2">
                <Link
                  href="/chat"
                  className="group inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-[var(--kp-accent)] px-4 text-xs font-bold text-white transition-transform hover:scale-105"
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
                    className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg)]/70 px-4 text-xs font-bold text-[var(--kp-text-1)] transition-colors hover:border-[var(--kp-brand-light)]"
                  >
                    <Github className="h-3.5 w-3.5" /> GitHub
                  </a>
                )}
                {profile.email && (
                  <a
                    href={`mailto:${profile.email}`}
                    className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg)]/70 px-4 text-xs font-bold text-[var(--kp-text-1)] transition-colors hover:border-[var(--kp-brand-light)]"
                  >
                    <Mail className="h-3.5 w-3.5" /> 邮件
                  </a>
                )}
              </div>
            </HoverCard>
          </ScrollReveal>
        </section>

        <CosmicFooter />
      </main>
    </div>
  );
}

function CosmicFooter() {
  return (
    <section className="relative mt-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.4 }}
        transition={{ type: "spring", stiffness: 260, damping: 26 }}
        whileHover={{ y: -4, scale: 1.008 }}
        className="group relative overflow-hidden rounded-[1.75rem] border border-white/60 bg-[color-mix(in_srgb,var(--kp-glass-bg)_88%,white)] px-7 py-12 shadow-[0_16px_48px_-22px_rgba(0,80,160,0.18)] backdrop-blur-xl transition-shadow duration-500 hover:border-[var(--kp-brand)]/25 hover:shadow-[0_28px_64px_-20px_rgba(0,135,235,0.28)] md:px-14 md:py-16"
      >
        {/* 氛围光 */}
        <div
          aria-hidden
          className="pointer-events-none absolute -left-16 top-0 h-40 w-40 rounded-full bg-[var(--kp-glow-blue)]/35 blur-3xl transition-opacity duration-500 group-hover:opacity-80"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-10 bottom-0 h-36 w-36 rounded-full bg-[var(--kp-glow-peach)]/30 blur-3xl"
        />

        {/* 细基准线 */}
        <div aria-hidden className="pointer-events-none absolute inset-x-8 top-[38%] hidden h-px bg-[var(--kp-divider)]/50 md:block" />
        <div aria-hidden className="pointer-events-none absolute inset-x-8 top-[52%] hidden h-px bg-[var(--kp-divider)]/35 md:block" />
        <div aria-hidden className="pointer-events-none absolute inset-x-8 top-[66%] hidden h-px bg-[var(--kp-divider)]/25 md:block" />

        {/* 角标 */}
        <span className="absolute left-5 top-4 text-[10px] font-semibold tracking-[0.2em] text-[var(--kp-text-3)] md:left-7 md:top-5">
          见微
        </span>
        <span className="absolute right-6 top-5 flex gap-1.5 md:right-8" aria-hidden>
          <span className="h-1 w-1 rounded-full bg-[var(--kp-brand)]/35" />
          <span className="h-1 w-1 rounded-full bg-[var(--kp-accent)]/40" />
        </span>

        {/* 正文 */}
        <div className="relative z-10 mx-auto max-w-3xl text-center">
          <p className="text-balance text-[clamp(1.15rem,2.6vw,1.65rem)] font-semibold leading-relaxed tracking-tight text-[var(--kp-text-1)]">
            我们的征途是星辰大海，但在那之前，不妨先去码头搞点薯条。
          </p>
          <p className="kp-display-serif mt-4 text-[clamp(0.95rem,2vw,1.2rem)] italic leading-relaxed text-[var(--kp-text-2)]">
            Our voyage is to the stars and the sea — but first, fries at the pier.
          </p>
        </div>

        {/* 右下轻浪线 */}
        <svg
          aria-hidden
          className="pointer-events-none absolute bottom-3 right-6 h-8 w-28 text-[var(--kp-brand)]/25 md:bottom-4 md:right-10 md:h-10 md:w-36"
          viewBox="0 0 140 40"
          fill="none"
        >
          <path
            d="M4 28c18-16 36-16 54 0s36 16 54 0 20-10 24-12"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </motion.div>
    </section>
  );
}

function ProjectCard({
  project,
  hoverKind = "tilt",
}: {
  project: AboutProfile["projects"][number];
  hoverKind?: HoverKind;
}) {
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
        className="pointer-events-none absolute inset-0 opacity-[0.07] transition-transform duration-500 group-hover:scale-110"
        style={{ backgroundImage: gradientFromTitle(project.name) }}
      />
      <div className="relative flex flex-1 flex-col p-3">
        <div className="mb-1.5 flex items-start justify-between gap-2">
          <SectionHeader icon={iconNode} title={project.name} className="min-w-0" />
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
        {project.tagline && (
          <p className="mb-1 text-[10px] font-bold text-[var(--kp-brand-deep)]">{project.tagline}</p>
        )}
        <p className="mb-2 line-clamp-2 text-xs leading-relaxed text-[var(--kp-text-2)]">
          {project.description}
        </p>
        <div className="mt-auto flex flex-wrap gap-1">
          {project.stack.slice(0, 3).map((s) => (
            <span
              key={s}
              className="rounded-md border border-[var(--kp-divider)] bg-[var(--kp-bg)]/60 px-1.5 py-0.5 text-[10px] text-[var(--kp-text-3)] transition-colors group-hover:border-[var(--kp-brand)]/25"
            >
              {s}
            </span>
          ))}
        </div>
      </div>
    </>
  );

  const shell = "relative flex h-full flex-col";

  return (
    <HoverCard kind={hoverKind} className={shell}>
      {!project.href ? (
        <div className="flex h-full flex-col">{body}</div>
      ) : project.href.startsWith("http") ? (
        <a
          href={project.href}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-full flex-col"
        >
          {body}
        </a>
      ) : (
        <Link href={project.href} className="flex h-full flex-col">
          {body}
        </Link>
      )}
    </HoverCard>
  );
}
