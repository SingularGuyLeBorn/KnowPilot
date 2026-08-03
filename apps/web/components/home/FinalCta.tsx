"use client";

import { motion } from "framer-motion";
import { ArrowRight, Feather, MessageSquare, Sparkles } from "lucide-react";
import Link from "next/link";
import { ScrollReveal } from "@/components/magicui/scroll-reveal";
import { GardenNetwork } from "@/components/magicui/garden-network";

const steps = [
  { label: "Seed", text: "随手记下灵感" },
  { label: "Sprout", text: "Agent 初筛关联" },
  { label: "Grow", text: "润色成文归档" },
  { label: "Bloom", text: "发布蒸馏品味" },
];

export function FinalCta() {
  return (
    <section className="relative overflow-hidden bg-[var(--kp-bg)] px-6 py-12 lg:px-12 lg:py-16">
      <div className="relative z-10 mx-auto max-w-7xl">
        <ScrollReveal>
          <div className="kp-card-dense relative overflow-hidden p-5 md:p-6">
            <div className="relative z-10 grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
              <div>
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  whileInView={{ scale: 1, opacity: 1 }}
                  viewport={{ once: true }}
                  transition={{ type: "spring", stiffness: 260, damping: 22, delay: 0.1 }}
                  className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg)]/70 px-3 py-1 text-[11px] font-medium tracking-wide text-[var(--kp-text-2)]"
                >
                  <Sparkles className="h-3.5 w-3.5 text-[var(--kp-accent)]" />
                  见微知著 · 本地优先数字花园
                </motion.div>

                <h2 className="mb-2 text-balance text-2xl font-bold tracking-tight text-[var(--kp-text-1)] md:text-4xl">
                  下一篇，从一粒<span className="text-[var(--kp-accent-deep)]">种子</span>开始
                </h2>
                <p className="mb-4 max-w-md text-sm leading-relaxed text-[var(--kp-text-2)]">
                  打开编辑器，把想法写进 Markdown——Agent 会帮你生长成文章。
                </p>

                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href="/editor"
                    className="group inline-flex h-9 items-center gap-1.5 rounded-full bg-[var(--kp-accent)] px-4 text-xs font-semibold text-white shadow-lg shadow-[rgba(var(--kp-accent-rgb),0.25)] transition-transform duration-300 hover:-translate-y-0.5 hover:bg-[var(--kp-accent-deep)]"
                  >
                    <Feather className="h-3.5 w-3.5" />
                    写一篇
                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                  </Link>
                  <Link
                    href="/chat"
                    className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg)]/70 px-4 text-xs font-semibold text-[var(--kp-text-1)] transition-colors hover:border-[var(--kp-brand-light)] hover:bg-[var(--kp-brand-soft)]"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    打开 Chat
                  </Link>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {steps.map((step, i) => (
                    <div key={step.label} className="rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)]/60 p-2.5">
                      <div className="mb-1 text-[10px] font-bold text-[var(--kp-accent-deep)]">0{i + 1} · {step.label}</div>
                      <div className="text-[11px] text-[var(--kp-text-2)]">{step.text}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="relative hidden h-48 lg:block">
                <GardenNetwork className="h-full w-full" />
              </div>
            </div>

            <motion.div
              className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full opacity-25 blur-3xl"
              style={{ background: "radial-gradient(circle, rgba(var(--kp-accent-rgb), 0.4), transparent 70%)" }}
              animate={{ scale: [1, 1.1, 1], opacity: [0.2, 0.3, 0.2] }}
              transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
            />
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
