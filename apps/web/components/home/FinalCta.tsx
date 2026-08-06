"use client";

import { motion } from "framer-motion";
import { ArrowRight, Feather, MessageSquare } from "lucide-react";
import Link from "next/link";
import { CurlyMark, SquareMark } from "@/components/home/accentMark";
import { ScrollReveal } from "@/components/magicui/scroll-reveal";
import { GardenNetwork } from "@/components/magicui/garden-network";

const steps = [
  { label: "Seed", text: "随手记下灵感" },
  { label: "Sprout", text: "初筛与关联" },
  { label: "Grow", text: "润色成文归档" },
  { label: "Bloom", text: "发布与回味" },
];

export function FinalCta() {
  return (
    <section className="relative overflow-hidden px-6 py-12 lg:px-12 lg:py-16">
      <div className="relative z-10 mx-auto max-w-7xl">
        <ScrollReveal>
          <div className="relative overflow-hidden rounded-[1.75rem] border border-white/55 bg-white/55 p-5 shadow-[0_20px_56px_-22px_rgba(0,80,160,0.28)] backdrop-blur-xl md:p-8">
            <div className="relative z-10 grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
              <div>
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  whileInView={{ scale: 1, opacity: 1 }}
                  viewport={{ once: true }}
                  transition={{ type: "spring", stiffness: 260, damping: 22, delay: 0.1 }}
                  className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/60 bg-white/70 px-3 py-1 text-[11px] font-medium tracking-wide text-[var(--kp-text-2)] shadow-sm"
                >
                  <SquareMark className="text-[11px] font-semibold">下一篇</SquareMark>
                  从这里出发
                </motion.div>

                <h2 className="mb-2 text-balance text-2xl font-bold tracking-tight text-[var(--kp-text-1)] md:text-4xl">
                  从一粒 <CurlyMark>种子</CurlyMark> 开始
                </h2>
                <p className="mb-4 max-w-md text-sm leading-relaxed text-[var(--kp-text-2)]">
                  打开编辑器，把想法写下来——后面的生长交给工作台。
                </p>

                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href="/editor"
                    className="group inline-flex h-10 items-center gap-1.5 rounded-full bg-[var(--kp-brand)] px-5 text-xs font-semibold text-white shadow-[0_10px_28px_-8px_rgba(0,135,235,0.55)] transition-transform duration-300 hover:-translate-y-0.5 hover:bg-[var(--kp-brand-dark)]"
                  >
                    <Feather className="h-3.5 w-3.5" />
                    写一篇
                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                  </Link>
                  <Link
                    href="/chat"
                    className="inline-flex h-10 items-center gap-1.5 rounded-full border border-white/60 bg-white/70 px-5 text-xs font-semibold text-[var(--kp-text-1)] shadow-sm backdrop-blur-md transition-colors hover:border-[var(--kp-brand)]/35"
                  >
                    <MessageSquare className="h-3.5 w-3.5 text-[var(--kp-brand)]" />
                    打开 Chat
                  </Link>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {steps.map((step, i) => (
                    <motion.div
                      key={step.label}
                      whileHover={
                        [
                          { y: -4 },
                          { y: -3, rotate: -1.5 },
                          { scale: 1.04 },
                          { y: 2, scale: 0.98 },
                        ][i % 4]
                      }
                      transition={{ type: "spring", stiffness: 280, damping: 22 }}
                      className={[
                        "cursor-default rounded-xl border border-white/55 bg-white/50 p-2.5 backdrop-blur-sm transition-[border-color,box-shadow,background-color] duration-300",
                        i === 0 && "hover:border-[var(--kp-brand)]/35 hover:shadow-[0_10px_24px_-12px_rgba(0,135,235,0.28)]",
                        i === 1 && "hover:border-[var(--kp-accent)]/40 hover:bg-white/75",
                        i === 2 && "hover:border-white/80 hover:shadow-[0_12px_28px_-14px_rgba(0,80,160,0.22)]",
                        i === 3 && "hover:bg-white/80 hover:shadow-[inset_0_1px_8px_rgba(0,80,160,0.08)]",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <div className="mb-1 text-[10px] font-bold text-[var(--kp-brand)]">
                        0{i + 1} · {step.label}
                      </div>
                      <div className="text-[11px] text-[var(--kp-text-2)]">{step.text}</div>
                    </motion.div>
                  ))}
                </div>
              </div>

              <div className="relative hidden min-h-[300px] lg:block lg:h-[320px] lg:cursor-grab lg:active:cursor-grabbing">
                <GardenNetwork className="h-full w-full" />
              </div>
            </div>

            <motion.div
              className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full opacity-40 blur-3xl"
              style={{
                background:
                  "radial-gradient(circle, color-mix(in srgb, var(--kp-glow-peach) 70%, transparent), transparent 70%)",
              }}
              animate={{ scale: [1, 1.1, 1], opacity: [0.3, 0.45, 0.3] }}
              transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
              className="pointer-events-none absolute -bottom-20 -left-10 h-56 w-56 rounded-full opacity-35 blur-3xl"
              style={{
                background:
                  "radial-gradient(circle, color-mix(in srgb, var(--kp-glow-blue) 80%, transparent), transparent 70%)",
              }}
              animate={{ scale: [1.05, 1, 1.05], opacity: [0.25, 0.4, 0.25] }}
              transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
            />
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
