"use client";

import { motion } from "framer-motion";
import { ArrowRight, Rocket } from "lucide-react";
import Link from "next/link";

export function FinalCta() {
  return (
    <section className="relative px-[5%] py-24 md:px-[8%] lg:px-[10%]">
      <div className="mx-auto max-w-5xl">
        <motion.div
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] as const }}
          className="relative overflow-hidden rounded-[2.5rem] kp-card px-8 py-16 text-center md:px-16 md:py-24"
        >
          <div className="pointer-events-none absolute -left-20 -top-20 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(184,160,144,0.22),transparent_70%)] blur-2xl" />
          <div className="pointer-events-none absolute -bottom-20 -right-20 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(184,160,144,0.18),transparent_70%)] blur-2xl" />

          <div className="relative z-10">
            <div className="mx-auto mb-6 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--kp-brand-soft)] text-[var(--kp-brand-dark)]">
              <Rocket className="h-7 w-7" />
            </div>
            <h2 className="mb-4 text-3xl font-bold tracking-tight text-[var(--kp-text-1)] md:text-5xl">
              准备好起飞了吗？
            </h2>
            <p className="mx-auto mb-10 max-w-xl text-[var(--kp-text-2)] md:text-lg">
              把你的第一篇知识笔记变成一篇精美的博客文章，只需一次点击。
            </p>
            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link
                href="/editor"
                className="group inline-flex h-12 items-center gap-2 rounded-full bg-[var(--kp-brand-deep)] px-8 text-sm font-semibold text-white shadow-lg shadow-[rgba(110,92,74,0.35)] transition-transform duration-300 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-[rgba(110,92,74,0.45)]"
              >
                创建第一篇文章
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
              <Link
                href="/posts"
                className="inline-flex h-12 items-center gap-2 rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg)]/60 px-8 text-sm font-semibold text-[var(--kp-text-1)] backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-[var(--kp-brand-light)] hover:bg-[var(--kp-brand-soft)]"
              >
                浏览示例
              </Link>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
