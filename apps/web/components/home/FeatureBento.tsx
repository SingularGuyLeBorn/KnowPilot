"use client";

import { motion } from "framer-motion";
import {
  Bot,
  Code2,
  FileText,
  GitBranch,
  HardDrive,
} from "lucide-react";
import { ReactNode } from "react";

const features: {
  icon: ReactNode;
  title: string;
  description: string;
  large?: boolean;
}[] = [
  {
    icon: <GitBranch className="h-7 w-7" />,
    title: "Agentic 知识网络",
    description:
      "让 Agent 自动连接文章、标签与灵感，形成可生长的语义图谱，而不是沉睡的文件夹。",
    large: true,
  },
  {
    icon: <Bot className="h-6 w-6" />,
    title: "多 Agent 工作流",
    description: "选题、润色、归档、复盘，由专属 Agent 协作完成，把重复劳动交给 AI。",
  },
  {
    icon: <FileText className="h-6 w-6" />,
    title: "Markdown 原生",
    description: "以 Markdown 为单一事实来源，内容、Frontmatter、版本全部可移植。",
  },
  {
    icon: <Code2 className="h-6 w-6" />,
    title: "全语法渲染",
    description: "GFM、代码高亮、数学公式、HTML 嵌入、脚注，复杂文档也能优雅呈现。",
  },
  {
    icon: <HardDrive className="h-6 w-6" />,
    title: "本地优先",
    description: "内容首先落盘到本地 Markdown，再同步到 SQLite，数据永远属于你。",
  },
];

const cardBase =
  "group relative overflow-hidden rounded-3xl kp-card p-6 transition-all duration-500 hover:-translate-y-1 hover:shadow-xl hover:shadow-[rgba(184,160,144,0.18)]";

export function FeatureBento() {
  return (
    <section className="relative px-[5%] py-24 md:px-[8%] lg:px-[10%]">
      <div className="mx-auto max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] as const }}
          className="mb-12 text-center"
        >
          <h2 className="mb-4 text-3xl font-bold tracking-tight text-[var(--kp-text-1)] md:text-4xl">
            为深度写作而生的工作台
          </h2>
          <p className="mx-auto max-w-xl text-[var(--kp-text-2)]">
            把内容创作拆成可组合的模块，每一个方块都是一种能力。
          </p>
        </motion.div>

        <div className="grid auto-rows-[minmax(160px,auto)] grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4 lg:grid-rows-2">
          {features.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 28 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{
                duration: 0.7,
                delay: index * 0.08,
                ease: [0.22, 1, 0.36, 1] as const,
              }}
              className={[
                cardBase,
                feature.large
                  ? "lg:col-span-2 lg:row-span-2 lg:p-8"
                  : "lg:col-span-1",
              ].join(" ")}
            >
              <div className="mb-4 inline-flex rounded-2xl bg-[var(--kp-brand-soft)] p-3 text-[var(--kp-brand-deep)] transition-transform duration-500 group-hover:scale-110">
                {feature.icon}
              </div>
              <h3
                className={[
                  "mb-2 font-semibold text-[var(--kp-text-1)]",
                  feature.large ? "text-2xl" : "text-lg",
                ].join(" ")}
              >
                {feature.title}
              </h3>
              <p
                className={[
                  "leading-relaxed text-[var(--kp-text-2)]",
                  feature.large ? "max-w-md text-base" : "text-sm",
                ].join(" ")}
              >
                {feature.description}
              </p>

              {/* subtle ambient glow on hover */}
              <div className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full bg-[radial-gradient(circle,rgba(184,160,144,0.22),transparent_70%)] opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100" />
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
