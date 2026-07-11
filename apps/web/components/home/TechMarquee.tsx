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

export function TechMarquee({ tags = DEFAULT_TAGS, label = "Powered by modern stack" }: TechMarqueeProps) {
  const displayTags = tags.length > 0 ? tags : DEFAULT_TAGS;
  const row = (
    <>
      {displayTags.map((tag) => (
        <span
          key={tag}
          className="flex-shrink-0 rounded-full kp-card px-5 py-2.5 text-sm font-medium text-[var(--kp-text-2)] transition-colors duration-300 hover:bg-[var(--kp-brand-soft)] hover:text-[var(--kp-text-1)]"
        >
          {tag}
        </span>
      ))}
    </>
  );

  return (
    <section className="relative overflow-hidden py-20">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-[var(--kp-bg)] to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-[var(--kp-bg)] to-transparent" />

      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.8 }}
        className="mb-10 text-center"
      >
        <p className="text-sm font-medium text-[var(--kp-text-3)]">
          {label}
        </p>
      </motion.div>

      <div className="flex w-max animate-marquee gap-4 hover:[animation-play-state:paused]">
        {row}
        {row}
      </div>
    </section>
  );
}
