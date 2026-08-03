"use client";

import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { ArrowRight, Feather, Sparkles } from "lucide-react";
import Link from "next/link";
import { BlurFade } from "@/components/magicui/blur-fade";
import { ShineBorder } from "@/components/magicui/shine-border";

const FlickeringGrid = dynamic(
  () => import("@/components/magicui/flickering-grid").then((m) => m.FlickeringGrid),
  { ssr: false, loading: () => <div className="h-full w-full" aria-hidden /> },
);

export function FinalCta() {
  return (
    <section className="relative overflow-hidden px-[5%] py-24 md:px-[8%] md:py-32 lg:px-[10%]">
      {/* 深色底 + 闪烁网格 */}
      <div className="pointer-events-none absolute inset-0 bg-[var(--kp-ink)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.28]">
        <FlickeringGrid
          squareSize={4}
          gridGap={6}
          flickerChance={0.12}
          color="rgb(79, 185, 166)"
          maxOpacity={0.25}
          className="h-full w-full"
        />
      </div>
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.9) 1px, transparent 0)",
          backgroundSize: "28px 28px",
        }}
      />
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

      <div className="relative z-10 mx-auto max-w-5xl">
        <BlurFade direction="up" delay={0.05}>
          <div className="relative overflow-hidden rounded-[2.25rem] border border-white/10 bg-white/[0.03] p-10 backdrop-blur-xl md:p-14">
            <ShineBorder
              borderWidth={2}
              duration={16}
              shineColor={["var(--kp-accent)", "var(--kp-brand-light)", "white"]}
              className="rounded-[2.25rem] opacity-60"
            />

            <div className="relative z-10 text-center">
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                whileInView={{ scale: 1, opacity: 1 }}
                viewport={{ once: true }}
                transition={{ type: "spring", stiffness: 260, damping: 22, delay: 0.1 }}
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
                打开编辑器，把想法写进 Markdown——Agent 会帮你生长成文章。
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
            </div>
          </div>
        </BlurFade>
      </div>
    </section>
  );
}
