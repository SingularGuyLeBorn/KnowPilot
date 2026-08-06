"use client";

import { ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Blend,
  Code2,
  Database,
  GitBranch,
  ScrollText,
  Waypoints,
} from "lucide-react";
import { CurlyMark, SquareMark } from "@/components/home/accentMark";
import { ScrollReveal, StaggerContainer, StaggerItem } from "@/components/magicui/scroll-reveal";

const hoverSpring = { type: "spring", stiffness: 260, damping: 26 } as const;

interface Feature {
  icon: ReactNode;
  title: string;
  description: string;
}

/** icon 与文案避开 Hero / Stats / CTA 已用集合 */
const features: Feature[] = [
  {
    icon: <GitBranch className="h-5 w-5" />,
    title: "语义图谱",
    description: "文章、标签与灵感自动连成可生长的关系网。",
  },
  {
    icon: <Waypoints className="h-5 w-5" />,
    title: "协作编排",
    description: "选题、润色、归档、复盘，分角色接力完成。",
  },
  {
    icon: <ScrollText className="h-5 w-5" />,
    title: "语法即结构",
    description: "用纯文本描述世界，格式透明、版本友好。",
  },
  {
    icon: <Code2 className="h-5 w-5" />,
    title: "全语法渲染",
    description: "GFM、代码高亮、数学公式、HTML 嵌入、脚注，复杂文档优雅呈现。",
  },
  {
    icon: <Database className="h-5 w-5" />,
    title: "磁盘即金库",
    description: "先写进本地文件，再投影到查询层，所有权不外包。",
  },
  {
    icon: <Blend className="h-5 w-5" />,
    title: "蒸馏品味",
    description: "把碎片整理成文章，把收藏炼成可复用的知识。",
  },
];

export function FeatureBento() {
  return (
    <section className="relative overflow-hidden px-6 py-12 lg:px-12 lg:py-16">
      <div className="relative z-10 mx-auto max-w-7xl">
        <ScrollReveal className="mb-8 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--kp-brand)]">
              Capabilities
            </p>
            <h2 className="text-2xl font-bold tracking-tight text-[var(--kp-text-1)] md:text-3xl">
              为深度写作而生的 <CurlyMark>工作台</CurlyMark>
            </h2>
          </div>
          <p className="max-w-md text-sm text-[var(--kp-text-2)]">
            把内容创作拆成可组合的模块，每个方块都是一种能力。
            <SquareMark className="ml-1 text-xs font-semibold">可拼装</SquareMark>
          </p>
        </ScrollReveal>

        <StaggerContainer className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {features.map((feature, i) => {
            const hoverMotion = [
              { y: -8 },
              { y: -5, rotate: -1.1 },
              { y: -4, scale: 1.02 },
              { y: -6, x: 3 },
              { y: 2, scale: 0.985 },
              { y: -7, scale: 1.015 },
            ][i % 6];
            const hoverClass = [
              "kp-card-topline kp-card-sheen hover:border-[var(--kp-brand)]/35 hover:shadow-[0_22px_52px_-16px_rgba(0,135,235,0.32)]",
              "hover:border-[var(--kp-accent)]/40 hover:shadow-[0_18px_44px_-14px_rgba(232,168,74,0.3)]",
              "hover:border-white/80 hover:shadow-[0_0_0_1px_rgba(0,135,235,0.12),0_20px_48px_-18px_rgba(0,135,235,0.28)]",
              "border-l-[3px] border-l-transparent hover:border-l-[var(--kp-brand)] hover:border-[var(--kp-brand)]/25 hover:shadow-[0_16px_40px_-14px_rgba(0,80,160,0.24)]",
              "hover:bg-white/80 hover:shadow-[inset_0_2px_12px_rgba(0,80,160,0.08)]",
              "kp-card-sheen hover:border-[var(--kp-brand)]/30 hover:shadow-[0_24px_50px_-18px_rgba(0,80,160,0.28)]",
            ][i % 6];
            return (
              <StaggerItem key={feature.title}>
                <motion.div
                  whileHover={hoverMotion}
                  transition={hoverSpring}
                  className={`group relative flex h-full items-center gap-3.5 overflow-hidden rounded-2xl border border-white/55 bg-white/50 p-5 shadow-[0_12px_36px_-18px_rgba(0,80,160,0.18)] backdrop-blur-xl transition-[border-color,box-shadow,background-color] duration-500 hover:bg-white/70 ${hoverClass}`}
                >
                  <div
                    aria-hidden
                    className={`pointer-events-none absolute -right-10 -top-12 h-28 w-28 rounded-full blur-3xl transition-all duration-500 ${
                      i % 2 === 0
                        ? "bg-[var(--kp-glow-peach)]/0 group-hover:bg-[var(--kp-glow-peach)]/45"
                        : "bg-[var(--kp-glow-blue)]/0 group-hover:bg-[var(--kp-glow-blue)]/50"
                    }`}
                  />
                  <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/70 bg-white/70 text-[var(--kp-brand)] shadow-sm transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3">
                    {feature.icon}
                  </div>
                  <div className="relative min-w-0 flex-1">
                    <h3 className="mb-1 text-sm font-bold text-[var(--kp-text-1)]">{feature.title}</h3>
                    <p className="text-xs leading-relaxed text-[var(--kp-text-2)]">{feature.description}</p>
                  </div>
                </motion.div>
              </StaggerItem>
            );
          })}
        </StaggerContainer>
      </div>
    </section>
  );
}
