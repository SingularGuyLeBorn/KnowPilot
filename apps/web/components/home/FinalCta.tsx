"use client";

/**
 * 首页专属收尾 CTA —— 墨色全幅打断莫兰迪单调。
 * 禁止挂到 About / 管理页（每页同一块「起飞」= 设计败笔）。
 */

import { motion } from "framer-motion";
import { ArrowRight, Feather, Sparkles } from "lucide-react";
import Link from "next/link";

export function FinalCta() {
  return (
    <section className="relative overflow-hidden px-[5%] py-20 md:px-[8%] md:py-28 lg:px-[10%]">
      {/* 墨色底：与上方浅绿纸感形成段落对比 */}
      <div className="pointer-events-none absolute inset-0 bg-[var(--kp-ink)]" />
      <div
        className="pointer-events-none absolute -left-24 top-0 h-[420px] w-[420px] rounded-full opacity-70 blur-3xl"
        style={{
          background:
            "radial-gradient(circle, rgba(var(--kp-accent-rgb), 0.45) 0%, transparent 68%)",
        }}
      />
      <div
        className="pointer-events-none absolute -right-16 bottom-0 h-[380px] w-[380px] rounded-full opacity-60 blur-3xl"
        style={{
          background:
            "radial-gradient(circle, rgba(var(--kp-brand-rgb), 0.35) 0%, transparent 70%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.9) 1px, transparent 0)",
          backgroundSize: "28px 28px",
        }}
      />

      <div className="relative z-10 mx-auto max-w-5xl">
        <motion.div
          initial={{ opacity: 0, y: 36 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.85, ease: [0.22, 1, 0.36, 1] as const }}
          className="text-center"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            whileInView={{ scale: 1, opacity: 1 }}
            viewport={{ once: true }}
            transition={{ type: "spring", stiffness: 260, damping: 22, delay: 0.05 }}
            className="mx-auto mb-7 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-[11px] font-medium tracking-wide text-white/75 backdrop-blur"
          >
            <Sparkles className="h-3.5 w-3.5 text-[var(--kp-accent)]" />
            见微知著 · 本地优先数字花园
          </motion.div>

          <h2 className="mb-5 text-balance text-4xl font-extrabold tracking-[-0.03em] text-white md:text-6xl">
            下一篇，
            <span className="bg-gradient-to-r from-[var(--kp-accent)] to-[var(--kp-brand-light)] bg-clip-text text-transparent">
              从一粒种子开始
            </span>
          </h2>
          <p className="mx-auto mb-10 max-w-xl text-base leading-relaxed text-white/65 md:text-lg">
            不必再复制同一块「起飞」广告。打开编辑器，把想法写进 Markdown——Agent 会帮你生长成文章。
          </p>

          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
            <Link
              href="/editor"
              className="group inline-flex h-12 items-center gap-2 rounded-full bg-[var(--kp-accent)] px-8 text-sm font-semibold text-white shadow-[0_12px_40px_rgba(var(--kp-accent-rgb),0.35)] transition-transform duration-300 hover:-translate-y-0.5 hover:bg-[var(--kp-accent-deep)]"
            >
              <Feather className="h-4 w-4" />
              写一篇
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
            <Link
              href="/chat"
              className="inline-flex h-12 items-center gap-2 rounded-full border border-white/20 bg-white/5 px-8 text-sm font-semibold text-white/90 backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:border-white/35 hover:bg-white/10"
            >
              打开 Chat
            </Link>
            <Link
              href="/posts"
              className="inline-flex h-12 items-center gap-2 rounded-full px-4 text-sm font-medium text-white/55 transition-colors hover:text-white/90"
            >
              逛花园
            </Link>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
