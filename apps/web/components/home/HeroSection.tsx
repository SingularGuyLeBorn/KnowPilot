"use client";

import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Bot,
  Code2,
  FileText,
  FolderKanban,
  HardDrive,
  MessageSquare,
  PenLine,
  Sparkles,
  Wand2,
} from "lucide-react";
import { OasisMindLogo } from "@/lib/icons";
import { OrbitingCircles } from "@/components/magicui/orbiting-circles";

const Particles = dynamic(
  () => import("@/components/magicui/particles").then((m) => m.Particles),
  { ssr: false, loading: () => <div className="h-full w-full" aria-hidden /> },
);

const easeSpring = [0.22, 1, 0.36, 1] as const;

export function HeroSection({
  postCount,
  categoryCount,
}: {
  postCount: number;
  categoryCount: number;
}) {
  return (
    <section className="dark relative flex min-h-[100dvh] items-center overflow-hidden bg-[var(--kp-bg)] px-[5%] py-20 md:px-[8%] lg:px-[10%]">
      {/* 动态粒子背景：随鼠标轻微移动 */}
      <div className="pointer-events-none absolute inset-0">
        <Particles
          className="h-full w-full"
          quantity={80}
          size={0.5}
          staticity={30}
          ease={40}
          color="#4ad8c4"
          vx={0.2}
          vy={0.2}
          refresh={false}
        />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_0%_50%,var(--kp-bg)_0%,transparent_55%)]" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[var(--kp-bg)] to-transparent" />
      </div>

      <div className="relative z-10 grid w-full items-center gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <motion.div
          initial={{ opacity: 0, x: -40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 1, ease: easeSpring }}
        >
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/70 px-3.5 py-1.5 text-xs font-medium text-[var(--kp-text-2)] backdrop-blur-md">
            <Sparkles className="h-3.5 w-3.5 text-[var(--kp-accent)]" />
            本地优先 · AI 驱动 · Markdown 为源
          </div>

          <div className="flex items-end gap-5">
            <OasisMindLogo size={72} className="drop-shadow-lg" />
            <h1 className="text-[clamp(3rem,10vw,7rem)] font-black leading-[0.9] tracking-[-0.04em] text-[var(--kp-text-1)]">
              见微
            </h1>
          </div>
          <p className="mt-3 text-[clamp(1.5rem,4vw,2.5rem)] font-light tracking-tight text-[var(--kp-brand-light)]">
            OasisMind
          </p>

          <p className="mt-6 max-w-xl text-lg leading-relaxed text-[var(--kp-text-2)] md:text-xl">
            以 Markdown 为原子、AI 为引擎的数字花园。写作、收集、蒸馏品味，让 Agent 常驻提醒你还没看完、还没做完的事。
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              href="/posts"
              className="group inline-flex h-12 items-center gap-2 rounded-full bg-[var(--kp-accent)] px-7 text-sm font-semibold text-white shadow-lg shadow-[rgba(var(--kp-accent-rgb),0.35)] transition-transform duration-300 hover:-translate-y-0.5 hover:bg-[var(--kp-accent-deep)]"
            >
              浏览文章
              <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
            </Link>
            <Link
              href="/editor"
              className="group inline-flex h-12 items-center gap-2 rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/70 px-7 text-sm font-semibold text-[var(--kp-text-1)] backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 hover:border-[var(--kp-brand-light)] hover:bg-[var(--kp-brand-soft)]"
            >
              <PenLine className="h-4 w-4" />
              开始写作
            </Link>
            <Link
              href="/chat"
              className="inline-flex h-12 items-center gap-2 rounded-full px-4 text-sm font-medium text-[var(--kp-text-2)] transition-colors hover:text-[var(--kp-brand-light)]"
            >
              <MessageSquare className="h-4 w-4" />
              对话
            </Link>
          </div>

          <div className="mt-10 flex flex-wrap gap-6 text-sm text-[var(--kp-text-3)]">
            <StatPill icon={FileText} value={postCount} label="文章" />
            <StatPill icon={FolderKanban} value={categoryCount} label="分类" />
            <StatPill icon={HardDrive} value={"∞"} label="本地优先" />
          </div>
        </motion.div>

        {/* 右侧：旋转轨道图标 */}
        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.2, delay: 0.2, ease: easeSpring }}
          className="relative hidden h-[420px] w-[420px] items-center justify-center lg:flex"
        >
          <OrbitingCircles radius={180} iconSize={44} duration={30} path>
            <OrbitingIcon icon={BookOpen} label="博客" />
            <OrbitingIcon icon={Bot} label="Agent" />
            <OrbitingIcon icon={Wand2} label="Skills" />
            <OrbitingIcon icon={Code2} label="代码" />
          </OrbitingCircles>
          <OrbitingCircles
            radius={120}
            iconSize={36}
            duration={22}
            reverse
            path={false}
          >
            <OrbitingIcon icon={Sparkles} small />
            <OrbitingIcon icon={ArrowRight} small />
            <OrbitingIcon icon={HardDrive} small />
          </OrbitingCircles>
        </motion.div>
      </div>
    </section>
  );
}

function StatPill({
  icon: Icon,
  value,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: number | string;
  label: string;
}) {
  return (
    <div className="inline-flex items-center gap-2.5 rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/60 px-4 py-2 backdrop-blur-sm">
      <Icon className="h-4 w-4 text-[var(--kp-brand-light)]" />
      <span className="font-semibold text-[var(--kp-text-1)]">{value}</span>
      <span>{label}</span>
    </div>
  );
}

function OrbitingIcon({
  icon: Icon,
  label,
  small,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label?: string;
  small?: boolean;
}) {
  return (
    <div className="group flex flex-col items-center gap-1">
      <div
        className={[
          "flex items-center justify-center rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/90 shadow-lg backdrop-blur-md transition-transform group-hover:scale-110",
          small ? "h-9 w-9" : "h-11 w-11",
        ].join(" ")}
      >
        <Icon className={small ? "h-4 w-4 text-[var(--kp-brand-light)]" : "h-5 w-5 text-[var(--kp-accent)]"} />
      </div>
      {label && <span className="text-[10px] font-medium text-[var(--kp-text-3)]">{label}</span>}
    </div>
  );
}
