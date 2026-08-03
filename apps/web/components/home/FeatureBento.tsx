"use client";

import { ReactNode } from "react";
import {
  Bot,
  Code2,
  FileText,
  GitBranch,
  HardDrive,
  Sparkles,
} from "lucide-react";
import { ScrollReveal, StaggerContainer, StaggerItem } from "@/components/magicui/scroll-reveal";
import { GardenNetwork } from "@/components/magicui/garden-network";

interface Feature {
  icon: ReactNode;
  title: string;
  description: string;
  accent: "green" | "slate";
}

const features: Feature[] = [
  {
    icon: <GitBranch className="h-5 w-5" />,
    title: "Agentic 知识网络",
    description: "Agent 自动连接文章、标签与灵感，形成可生长的语义图谱。",
    accent: "green",
  },
  {
    icon: <Bot className="h-5 w-5" />,
    title: "多 Agent 工作流",
    description: "选题、润色、归档、复盘，由专属 Agent 协作完成。",
    accent: "slate",
  },
  {
    icon: <FileText className="h-5 w-5" />,
    title: "Markdown 原生",
    description: "以 Markdown 为单一事实来源，内容全部可移植。",
    accent: "slate",
  },
  {
    icon: <Code2 className="h-5 w-5" />,
    title: "全语法渲染",
    description: "GFM、代码高亮、数学公式、HTML 嵌入、脚注，复杂文档优雅呈现。",
    accent: "slate",
  },
  {
    icon: <HardDrive className="h-5 w-5" />,
    title: "本地优先",
    description: "内容首先落盘到本地，再同步到 SQLite，数据永远属于你。",
    accent: "green",
  },
  {
    icon: <Sparkles className="h-5 w-5" />,
    title: "蒸馏品味",
    description: "把碎片整理成文章，把收藏变成知识。",
    accent: "slate",
  },
];

const accentIconBg = {
  green: "bg-[var(--kp-accent-soft)] text-[var(--kp-accent-deep)]",
  slate: "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]",
};

const accentTop = {
  green: "bg-[var(--kp-accent)]",
  slate: "bg-[var(--kp-brand-1)]",
};

export function FeatureBento() {
  return (
    <section className="relative overflow-hidden bg-[var(--kp-bg)] px-6 py-12 lg:px-12 lg:py-16">
      <div className="relative z-10 mx-auto max-w-7xl">
        <ScrollReveal className="mb-6 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--kp-accent)]">
              Capabilities
            </p>
            <h2 className="text-2xl font-bold tracking-tight text-[var(--kp-text-1)] md:text-3xl">
              为深度写作而生的<span className="text-[var(--kp-accent-deep)]">工作台</span>
            </h2>
          </div>
          <p className="max-w-md text-sm text-[var(--kp-text-2)]">
            把内容创作拆成可组合的模块，每个方块都是一种能力。
          </p>
        </ScrollReveal>

        <StaggerContainer className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <StaggerItem key={feature.title}>
              <div className="kp-card-dense group relative flex h-full flex-col overflow-hidden p-4">
                <div className={`absolute left-0 top-0 h-1 w-full ${accentTop[feature.accent]} opacity-70`} />
                <div className="mb-2.5 flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] shadow-sm transition-transform duration-300 group-hover:scale-105">
                  <div className={accentIconBg[feature.accent]}>{feature.icon}</div>
                </div>
                <h3 className="mb-1 text-sm font-bold text-[var(--kp-text-1)]">{feature.title}</h3>
                <p className="text-xs leading-relaxed text-[var(--kp-text-2)]">{feature.description}</p>
              </div>
            </StaggerItem>
          ))}

          <StaggerItem className="md:col-span-2 lg:col-span-3">
            <div className="kp-card-dense flex flex-col gap-3 overflow-hidden p-4 sm:flex-row sm:items-center">
              <div className="flex-1">
                <h3 className="mb-1 text-sm font-bold text-[var(--kp-text-1)]">能力在本地连成网络</h3>
                <p className="text-xs leading-relaxed text-[var(--kp-text-2)]">
                  文章、Agent、Skills、记忆、任务不是孤立的模块，而是在同一个本地花园里互相引用、生长。
                </p>
              </div>
              <div className="h-24 w-full sm:w-56">
                <GardenNetwork className="h-full w-full" />
              </div>
            </div>
          </StaggerItem>
        </StaggerContainer>
      </div>
    </section>
  );
}
