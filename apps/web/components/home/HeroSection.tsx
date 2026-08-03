"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { ArrowRight, Feather, MessageSquare, Sparkles, Telescope } from "lucide-react";
import { OasisMindLogo } from "@/lib/icons";
import { GardenConstellation } from "@/components/magicui/garden-constellation";

const easeSpring = [0.22, 1, 0.36, 1] as const;

const FLOATING_TAGS = ["本地优先", "Markdown 为源", "AI 常驻", "多 Agent 协作"];

export function HeroSection() {
  return (
    <section className="kp-hero-mesh relative flex min-h-[90dvh] flex-col justify-center overflow-hidden px-6 py-14 lg:px-12">
      <div className="relative z-10 mx-auto grid w-full max-w-7xl items-center gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10">
        <motion.div
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: easeSpring }}
          className="flex flex-col"
        >
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg)]/80 px-3.5 py-1.5 text-xs font-medium text-[var(--kp-text-2)] backdrop-blur-sm">
              <Sparkles className="h-3.5 w-3.5 text-[var(--kp-accent)]" />
              本地优先 · AI 驱动 · Markdown 为源
            </span>
            {FLOATING_TAGS.map((tag, i) => (
              <motion.span
                key={tag}
                initial={{ opacity: 0, scale: 0.85, y: 6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ delay: 0.35 + i * 0.08, duration: 0.45, ease: easeSpring }}
                className="hidden rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg)]/60 px-3 py-1 text-xs text-[var(--kp-text-3)] backdrop-blur-sm md:inline-flex"
              >
                {tag}
              </motion.span>
            ))}
          </div>

          <div className="flex items-center gap-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.85, rotate: -8 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              transition={{ delay: 0.12, duration: 0.7, ease: easeSpring }}
              className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg)]/80 shadow-sm backdrop-blur-sm"
            >
              <OasisMindLogo size={44} className="drop-shadow-sm" />
            </motion.div>
            <h1 className="kp-display-tight text-[clamp(4rem,12vw,8rem)] font-black tracking-tight text-[var(--kp-text-1)]">
              见微
            </h1>
          </div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.22, duration: 0.7 }}
            className="mt-1 text-[clamp(1.5rem,3.2vw,2.4rem)] font-light tracking-tight text-[var(--kp-brand-dark)]"
          >
            OasisMind
          </motion.p>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.7, ease: easeSpring }}
            className="mt-4 max-w-lg text-base leading-relaxed text-[var(--kp-text-2)] md:text-lg"
          >
            以 Markdown 为原子、AI 为引擎的数字花园。写作、收集、蒸馏品味，让 Agent 常驻提醒你还没看完、还没做完的事。
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.7, ease: easeSpring }}
            className="mt-7 flex flex-wrap items-center gap-3"
          >
            <Link
              href="/posts"
              className="group inline-flex h-10 items-center gap-1.5 rounded-full bg-[var(--kp-accent)] px-5 text-sm font-semibold text-white shadow-lg shadow-[rgba(var(--kp-accent-rgb),0.25)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-[var(--kp-accent-deep)]"
            >
              浏览文章
              <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
            </Link>
            <Link
              href="/editor"
              className="group inline-flex h-10 items-center gap-1.5 rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg)]/80 px-5 text-sm font-semibold text-[var(--kp-text-1)] backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-[var(--kp-brand-light)] hover:bg-[var(--kp-brand-soft)]"
            >
              <Feather className="h-4 w-4" />
              开始写作
            </Link>
            <Link
              href="/chat"
              className="inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-sm font-medium text-[var(--kp-text-2)] transition-colors hover:text-[var(--kp-brand-deep)]"
            >
              <MessageSquare className="h-4 w-4" />
              对话
            </Link>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6, duration: 0.6 }}
            className="mt-6 hidden items-center gap-2 text-xs text-[var(--kp-text-3)] md:flex"
          >
            <Telescope className="h-3.5 w-3.5" />
            <span>AI 常驻 · 多 Agent 协作 · 本地优先</span>
          </motion.div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.18, duration: 1.1, ease: easeSpring }}
          className="relative hidden aspect-[4/3] lg:block"
        >
          <GardenConstellation className="h-full w-full" />
          <div className="pointer-events-none absolute bottom-4 right-0 max-w-[13rem] rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg)]/85 p-3 text-xs leading-relaxed text-[var(--kp-text-3)] shadow-sm backdrop-blur-sm">
            <span className="mb-1 block font-semibold text-[var(--kp-text-2)]">数字花园星系</span>
            每个节点都是一种能力：写作、Agent、Skills、记忆、任务，在本地持续生长。
          </div>
        </motion.div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[var(--kp-bg)] to-transparent" />
    </section>
  );
}
