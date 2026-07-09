"use client";

import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { ArrowRight, PenLine, Sparkles } from "lucide-react";
import Link from "next/link";

// R14：three.js + @react-three/fiber（~600KB）改为 client 懒加载（ssr:false），
// 从首页/about 初始 bundle 拆出，首屏 HTML/JS 不再背 three.js，StarField 在客户端异步挂载。
const StarField = dynamic(() => import("./StarField").then((m) => m.StarField), {
  ssr: false,
  loading: () => null,
});

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
      {/* Three.js starfield + planet */}
      <StarField className="pointer-events-none absolute inset-0" />

      {/* Ambient gradient overlays */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(184,160,144,0.18),transparent_55%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_80%_80%,rgba(184,160,144,0.12),transparent_40%)]" />
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-[var(--kp-bg)] to-transparent" />

      <motion.div
        className="relative z-10 mx-auto max-w-5xl text-center"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={itemVariants} className="mb-8 flex justify-center">
          <span className="glass-card inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium tracking-wide text-[var(--kp-brand-dark)] shadow-sm">
            <Sparkles className="h-3.5 w-3.5" />
            KNOWLEDGE ENGINE v1.0
          </span>
        </motion.div>

        <motion.h1
          variants={itemVariants}
          className="mb-6 text-5xl font-bold leading-[1.05] tracking-tight md:text-7xl lg:text-8xl"
        >
          <span className="gradient-text">KnowPilot</span>
          <br />
          <span className="text-[var(--kp-text-1)]">Agentic Knowledge OS</span>
        </motion.h1>

        <motion.p
          variants={itemVariants}
          className="mx-auto mb-10 max-w-2xl text-lg leading-relaxed text-[var(--kp-text-2)] md:text-xl"
        >
          以 Markdown 为原子、AI 为引擎的个人知识管理与博客平台。
          <br className="hidden sm:block" />
          写作、思考、沉淀，全部发生在本地优先的数字花园。
        </motion.p>

        <motion.div
          variants={itemVariants}
          className="mb-14 flex flex-col items-center justify-center gap-4 sm:flex-row"
        >
          <Link
            href="/posts"
            className="group inline-flex h-12 items-center gap-2 rounded-full bg-[var(--kp-brand)] px-7 text-sm font-semibold text-white shadow-lg shadow-[rgba(184,160,144,0.35)] transition-transform duration-300 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-[rgba(184,160,144,0.45)]"
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
