"use client";

import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { BookOpen, Bot, Lightbulb, Wand2 } from "lucide-react";

const SolarSystem = dynamic(
  () => import("@/components/home/SolarSystem").then((m) => m.SolarSystem),
  { ssr: false, loading: () => <div className="min-h-[24rem]" aria-hidden /> },
);

const easeOut = [0.22, 1, 0.36, 1] as const;

export function SolarSystemUniverse() {
  return (
    <section className="dark relative overflow-hidden bg-[var(--kp-bg)] px-[5%] py-24 lg:px-[8%]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_50%,rgba(var(--kp-brand-rgb),0.10),transparent_60%)]" />
      <div className="relative mx-auto grid items-center gap-12 lg:grid-cols-2">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.9, ease: easeOut }}
          className="relative h-[28rem] w-full lg:h-[36rem]"
        >
          <SolarSystem className="h-full w-full" />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, x: 30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.8, ease: easeOut }}
        >
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--kp-accent)]">
            Digital Universe
          </p>
          <h2 className="mb-4 text-3xl font-bold tracking-tight text-[var(--kp-text-1)] md:text-4xl">
            思想像星系一样运转
          </h2>
          <p className="mb-8 max-w-md text-[var(--kp-text-2)]">
            每一个项目、每一段经历、每一篇文章都围绕同一个核心旋转：做出东西，而不是罗列工具。
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--kp-brand-soft)] text-[var(--kp-brand-light)]">
                <Lightbulb className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-semibold text-[var(--kp-text-1)]">想法捕获</h3>
                <p className="text-sm text-[var(--kp-text-3)]">随时记录，Agent 后续整理</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--kp-accent-soft)] text-[var(--kp-accent)]">
                <Wand2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-semibold text-[var(--kp-text-1)]">AI 蒸馏</h3>
                <p className="text-sm text-[var(--kp-text-3)]">从碎片到结构化知识</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--kp-accent-soft)] text-[var(--kp-accent)]">
                <BookOpen className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-semibold text-[var(--kp-text-1)]">公开发布</h3>
                <p className="text-sm text-[var(--kp-text-3)]">Markdown 即网站</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--kp-brand-soft)] text-[var(--kp-brand-light)]">
                <Bot className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-semibold text-[var(--kp-text-1)]">常驻提醒</h3>
                <p className="text-sm text-[var(--kp-text-3)]">Agent 记住你该做的事</p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
