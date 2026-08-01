"use client";

import { motion } from "framer-motion";
import { ArrowRight, PenLine } from "lucide-react";
import Link from "next/link";
import { OasisMindLogo } from "@/lib/icons";
import { DeferredStarField } from "./DeferredStarField";

interface HeroSectionProps {
  postCount: number;
  categoryCount: number;
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.12,
      delayChildren: 0.15,
    },
  },
};

const easeSpring = [0.22, 1, 0.36, 1] as const;

const itemVariants = {
  hidden: { opacity: 0, y: 32 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.8, ease: easeSpring },
  },
};

export function HeroSection({ postCount, categoryCount }: HeroSectionProps) {
  return (
    <section className="relative flex min-h-[calc(100vh-4rem)] items-center justify-center overflow-hidden px-[5%] py-20 md:px-[8%] lg:px-[10%]">
      {/* Three.js：idle 后再挂，先靠下方 CSS 渐变撑氛围 */}
      <DeferredStarField variant="home" className="pointer-events-none absolute inset-0" />

      {/* 浅色氛围：少遮罩，让 WebGL 更可见 */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(var(--kp-accent-rgb),0.12),transparent_58%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_75%,rgba(var(--kp-brand-rgb),0.14),transparent_42%)]" />
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-[var(--kp-bg)] to-transparent" />

      <motion.div
        className="relative z-10 mx-auto max-w-5xl text-center"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <motion.div
          variants={itemVariants}
          className="mb-8 flex flex-col items-center gap-5"
        >
          <OasisMindLogo size={80} className="drop-shadow-sm" />
          <h1 className="text-5xl font-extrabold leading-[0.95] tracking-[-0.03em] text-[var(--kp-text-1)] md:text-7xl lg:text-8xl">
            见微
            <br />
            <span className="text-[var(--kp-text-2)]">OasisMind</span>
          </h1>
        </motion.div>

        <motion.p
          variants={itemVariants}
          className="mx-auto mb-10 max-w-2xl text-lg leading-relaxed text-[var(--kp-text-2)] md:text-xl"
        >
          见微知著 · 以 Markdown 为原子、AI 为引擎的本地优先数字主力。
          <br className="hidden sm:block" />
          写作、收集、蒸馏品味，常驻提醒你还没看完、还没做完的事。
        </motion.p>

        <motion.div
          variants={itemVariants}
          className="mb-14 flex flex-col items-center justify-center gap-4 sm:flex-row"
        >
          <Link
            href="/posts"
            className="group inline-flex h-12 items-center gap-2 rounded-full bg-[var(--kp-accent)] px-7 text-sm font-semibold text-white shadow-lg shadow-[rgba(var(--kp-accent-rgb),0.35)] transition-transform duration-300 hover:-translate-y-0.5 hover:bg-[var(--kp-accent-deep)] hover:shadow-xl hover:shadow-[rgba(var(--kp-accent-rgb),0.45)]"
          >
            浏览文章
            <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
          </Link>
          <Link
            href="/editor"
            className="group inline-flex h-12 items-center gap-2 rounded-full glass-card px-7 text-sm font-semibold text-[var(--kp-text-1)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-[var(--kp-brand-soft)]"
          >
            <PenLine className="h-4 w-4" />
            开始写作
          </Link>
        </motion.div>

        <motion.div
          variants={itemVariants}
          className="mx-auto flex max-w-md flex-wrap items-center justify-center gap-6 text-sm text-[var(--kp-text-3)]"
        >
          <div className="flex flex-col items-center">
            <span className="text-2xl font-bold text-[var(--kp-text-1)]">{postCount}</span>
            <span>文章</span>
          </div>
          <div className="h-8 w-px bg-[var(--kp-divider)]" />
          <div className="flex flex-col items-center">
            <span className="text-2xl font-bold text-[var(--kp-text-1)]">{categoryCount}</span>
            <span>分类</span>
          </div>
          <div className="h-8 w-px bg-[var(--kp-divider)]" />
          <div className="flex flex-col items-center">
            <span className="text-2xl font-bold text-[var(--kp-text-1)]">∞</span>
            <span>本地优先</span>
          </div>
        </motion.div>
      </motion.div>
    </section>
  );
}
