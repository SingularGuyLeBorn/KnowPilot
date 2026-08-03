"use client";

import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { BookOpen, Bot, GitBranch, Wand2 } from "lucide-react";

const SolarSystem = dynamic(
  () => import("@/components/home/SolarSystem").then((m) => m.SolarSystem),
  { ssr: false, loading: () => <div className="min-h-[28rem]" aria-hidden /> },
);

const easeSpring = [0.22, 1, 0.36, 1] as const;

export function SolarSystemSection() {
  return (
    <section className="dark relative overflow-hidden bg-[var(--kp-bg)] px-[5%] py-24 md:px-[8%] lg:px-[10%]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_50%,rgba(var(--kp-accent-rgb),0.10),transparent_60%)]" />
      <div className="relative mx-auto grid items-center gap-12 lg:grid-cols-2">
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.8, ease: easeSpring }}
        >
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--kp-accent)]">
            OasisMind Universe
          </p>
          <h2 className="mb-4 text-3xl font-bold tracking-tight text-[var(--kp-text-1)] md:text-4xl">
            四个模块，一个花园
          </h2>
          <p className="mb-8 max-w-md text-[var(--kp-text-2)]">
            文章、Agent、知识库、Skills 像行星一样围绕你的思考旋转。每个模块都可以独立生长，也可以被 Agent 调用。
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <ModuleItem icon={BookOpen} title="博客" desc="Markdown 驱动的文章发布与阅读" />
            <ModuleItem icon={Bot} title="Agent" desc="常驻运行的 AI 助手与工作流" />
            <ModuleItem icon={GitBranch} title="知识库" desc="多花园、多分类的语义网络" />
            <ModuleItem icon={Wand2} title="Skills" desc="可编排、可进化的自定义能力" />
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.9, ease: easeSpring }}
          className="relative h-[28rem] w-full lg:h-[36rem]"
        >
          <SolarSystem className="h-full w-full" />
          <div className="pointer-events-none absolute inset-0">
            <span className="absolute left-[18%] top-[22%] rounded-full bg-[var(--kp-bg-alt)]/80 px-2 py-1 text-xs font-medium text-[var(--kp-text-2)] backdrop-blur-sm">博客</span>
            <span className="absolute right-[20%] top-[30%] rounded-full bg-[var(--kp-bg-alt)]/80 px-2 py-1 text-xs font-medium text-[var(--kp-text-2)] backdrop-blur-sm">Agent</span>
            <span className="absolute bottom-[25%] left-[20%] rounded-full bg-[var(--kp-bg-alt)]/80 px-2 py-1 text-xs font-medium text-[var(--kp-text-2)] backdrop-blur-sm">知识库</span>
            <span className="absolute bottom-[30%] right-[22%] rounded-full bg-[var(--kp-bg-alt)]/80 px-2 py-1 text-xs font-medium text-[var(--kp-text-2)] backdrop-blur-sm">Skills</span>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function ModuleItem({
  icon: Icon,
  title,
  desc,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/60 p-4 transition-colors hover:border-[var(--kp-brand-light)] hover:bg-[var(--kp-bg-alt)]">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--kp-brand-soft)] text-[var(--kp-brand-light)]">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <h3 className="font-semibold text-[var(--kp-text-1)]">{title}</h3>
        <p className="text-sm text-[var(--kp-text-3)]">{desc}</p>
      </div>
    </div>
  );
}
