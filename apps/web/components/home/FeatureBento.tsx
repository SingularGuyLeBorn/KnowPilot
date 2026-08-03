"use client";

import { motion } from "framer-motion";
import {
  Bot,
  Code2,
  FileText,
  GitBranch,
  HardDrive,
  Sparkles,
} from "lucide-react";
import { ReactNode } from "react";
import { BlurFade } from "@/components/magicui/blur-fade";
import { ShineBorder } from "@/components/magicui/shine-border";
import { FloatingShapes } from "@/components/FloatingShapes";
import { cn } from "@/lib/utils";

type FeatureCard = {
  icon: ReactNode;
  title: string;
  description: string;
  span: "large" | "tall" | "normal";
  style: "gradient" | "glass" | "outline" | "solid" | "soft";
};

const features: FeatureCard[] = [
  {
    icon: <GitBranch className="h-8 w-8" />,
    title: "Agentic 知识网络",
    description:
      "让 Agent 自动连接文章、标签与灵感，形成可生长的语义图谱，而不是沉睡的文件夹。",
    span: "large",
    style: "gradient",
  },
  {
    icon: <Bot className="h-6 w-6" />,
    title: "多 Agent 工作流",
    description: "选题、润色、归档、复盘，由专属 Agent 协作完成，把重复劳动交给 AI。",
    span: "normal",
    style: "glass",
  },
  {
    icon: <FileText className="h-6 w-6" />,
    title: "Markdown 原生",
    description: "以 Markdown 为单一事实来源，内容、Frontmatter、版本全部可移植。",
    span: "normal",
    style: "outline",
  },
  {
    icon: <Code2 className="h-6 w-6" />,
    title: "全语法渲染",
    description: "GFM、代码高亮、数学公式、HTML 嵌入、脚注，复杂文档也能优雅呈现。",
    span: "normal",
    style: "solid",
  },
  {
    icon: <HardDrive className="h-6 w-6" />,
    title: "本地优先",
    description: "内容首先落盘到本地 Markdown，再同步到 SQLite，数据永远属于你。",
    span: "normal",
    style: "soft",
  },
];

export function FeatureBento() {
  return (
    <section className="relative overflow-hidden px-[5%] py-24 md:px-[8%] lg:px-[10%]">
      <div className="absolute inset-0 bg-[var(--kp-bg)]" />
      <FloatingShapes variant="rings" className="opacity-60" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_30%,rgba(var(--kp-accent-rgb),0.08),transparent_40%)]" />

      <div className="relative mx-auto max-w-6xl">
        <BlurFade direction="down" delay={0.05} className="mb-14 max-w-2xl">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--kp-accent)]">
            Capabilities
          </p>
          <h2 className="mb-4 text-3xl font-bold tracking-tight text-[var(--kp-text-1)] md:text-5xl">
            为深度写作而生的工作台
          </h2>
          <p className="text-[var(--kp-text-2)]">
            把内容创作拆成可组合的模块，每一个方块代表一种能力。不同的卡片、不同的材质，拼出同一套工作流。
          </p>
        </BlurFade>

        <div className="grid auto-rows-[minmax(180px,auto)] grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4 lg:grid-rows-2">
          {features.map((feature, index) => (
            <BlurFade
              key={feature.title}
              direction="down"
              delay={0.08 + index * 0.08}
              className={cn(
                feature.span === "large" && "md:col-span-2 md:row-span-2",
                feature.span === "tall" && "md:row-span-2",
              )}
            >
              <FeatureCard feature={feature} />
            </BlurFade>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureCard({ feature }: { feature: FeatureCard }) {
  const isGradient = feature.style === "gradient";
  const isGlass = feature.style === "glass";
  const isOutline = feature.style === "outline";
  const isSolid = feature.style === "solid";
  const isSoft = feature.style === "soft";

  return (
    <motion.div
      whileHover={{ y: -5, scale: 1.01 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-[1.75rem] p-6 md:p-7",
        isGradient &&
          "bg-gradient-to-br from-[var(--kp-accent-deep)] via-[var(--kp-brand-deep)] to-[var(--kp-ink)] text-white shadow-2xl",
        isGlass && "border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/60 backdrop-blur-xl",
        isOutline && "border-2 border-[var(--kp-accent)]/30 bg-[var(--kp-bg)]/80",
        isSolid && "border border-[var(--kp-divider)] bg-[var(--kp-brand-soft)]/60",
        isSoft && "border border-[var(--kp-divider)] bg-gradient-to-br from-[var(--kp-bg-alt)] to-[var(--kp-bg-soft)]",
      )}
    >
      {isGradient && (
        <ShineBorder
          borderWidth={2}
          duration={12}
          shineColor={["var(--kp-accent)", "var(--kp-brand-light)", "var(--kp-accent-deep)"]}
          className="rounded-[1.75rem]"
        />
      )}
      <div className="relative z-10">
        <div
          className={cn(
            "mb-5 inline-flex rounded-2xl p-3.5 transition-transform duration-500 group-hover:scale-110",
            isGradient
              ? "bg-white/15 text-white"
              : "bg-[var(--kp-bg)]/80 text-[var(--kp-accent-deep)] shadow-sm",
          )}
        >
          {feature.icon}
        </div>
        <h3
          className={cn(
            "mb-3 font-semibold",
            feature.span === "large" ? "text-2xl md:text-3xl" : "text-xl",
            isGradient ? "text-white" : "text-[var(--kp-text-1)]",
          )}
        >
          {feature.title}
        </h3>
        <p
          className={cn(
            "leading-relaxed",
            feature.span === "large" ? "max-w-md text-base" : "text-sm",
            isGradient ? "text-white/75" : "text-[var(--kp-text-2)]",
          )}
        >
          {feature.description}
        </p>
      </div>

      {feature.span === "large" && (
        <div className="absolute -bottom-4 -right-4 h-40 w-40 opacity-30 blur-2xl group-hover:opacity-50 transition-opacity">
          <Sparkles className="h-full w-full text-white" />
        </div>
      )}
    </motion.div>
  );
}
