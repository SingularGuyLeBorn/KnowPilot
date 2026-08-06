"use client";

import { motion } from "framer-motion";

const DEFAULT_TAGS = [
  "Next.js 16",
  "React 19",
  "tRPC 11",
  "Prisma",
  "SQLite",
  "Tailwind CSS v4",
  "Milkdown",
  "Framer Motion",
  "TypeScript",
  "pnpm workspace",
  "Geist",
  "Monorepo",
];

interface TechMarqueeProps {
  /** 自定义标签；未传时使用默认技术栈列表 */
  tags?: string[];
  /** 区块上方小标题 */
  label?: string;
}

const TAG_HOVER = [
  "hover:-translate-y-1 hover:border-[var(--kp-brand)]/40 hover:text-[var(--kp-brand)] hover:shadow-[0_8px_20px_-10px_rgba(0,135,235,0.35)]",
  "hover:-translate-y-0.5 hover:rotate-[-1deg] hover:border-[var(--kp-accent)]/40 hover:text-[var(--kp-accent-deep)]",
  "hover:scale-105 hover:border-white/90 hover:text-[var(--kp-brand)] hover:shadow-[0_0_0_1px_rgba(0,135,235,0.12)]",
  "hover:translate-y-0.5 hover:scale-[0.98] hover:border-[var(--kp-brand)]/25 hover:bg-white/90",
];

export function TechMarquee({ tags = DEFAULT_TAGS, label = "Powered by modern stack" }: TechMarqueeProps) {
  const displayTags = tags.length > 0 ? tags : DEFAULT_TAGS;
  const row = (suffix: string) => (
    <>
      {displayTags.map((tag, i) => (
        <span
          key={`${tag}-${suffix}`}
          className={`flex-shrink-0 rounded-full border border-white/60 bg-white/55 px-5 py-2.5 text-sm font-medium text-[var(--kp-text-2)] shadow-sm backdrop-blur-md transition-all duration-300 hover:bg-white/80 ${TAG_HOVER[i % TAG_HOVER.length]}`}
        >
          {tag}
        </span>
      ))}
    </>
  );

  return (
    <section className="relative overflow-hidden py-14 md:py-16">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_80%_at_50%_50%,color-mix(in_srgb,var(--kp-glow-blue)_35%,transparent),transparent_70%)]" />
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-[var(--kp-bg)] to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-[var(--kp-bg)] to-transparent" />

      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.8 }}
        className="relative mb-10 text-center"
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--kp-brand)]">
          {label}
        </p>
      </motion.div>

      <div className="flex w-max animate-marquee gap-4 hover:[animation-play-state:paused]">
        {row("a")}
        {row("b")}
      </div>
    </section>
  );
}
