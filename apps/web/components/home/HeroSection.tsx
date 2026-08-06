"use client";

import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  BookOpen,
  Brain,
  CircuitBoard,
  Fingerprint,
  Hash,
  Image as ImageIcon,
  KeyRound,
  Leaf,
  ListChecks,
  Lock,
  Luggage,
  MessageSquare,
  Mic,
  Orbit,
  Type,
  UsersRound,
  Video,
  Wand2,
} from "lucide-react";
import { CurlyMark, SquareMark } from "@/components/home/accentMark";
import { OasisMindLogo } from "@/lib/icons";
import { cn } from "@/lib/utils";

const Particles = dynamic(
  () => import("@/components/magicui/particles").then((m) => m.Particles),
  { ssr: false, loading: () => <div className="h-full w-full" aria-hidden /> },
);

const easeSpring = [0.22, 1, 0.36, 1] as const;

/** O 模态 chips：仅在公式区出现一次 */
const OMNI_MODES = [
  { icon: Type, label: "Text" },
  { icon: ImageIcon, label: "Image" },
  { icon: Mic, label: "Voice" },
  { icon: Video, label: "Video" },
];

/** M 能力 chips：避开 Bot，全页唯一 */
const AGENT_CAPS = [
  { icon: UsersRound, label: "Agents" },
  { icon: Wand2, label: "Skills" },
  { icon: Brain, label: "Memory" },
  { icon: ListChecks, label: "Tasks" },
];

/** 四支柱：icon 全页不复用 */
const BRAND_ANCHORS = [
  { icon: Hash, label: "Markdown 原子", hint: "单一事实源" },
  { icon: Fingerprint, label: "主权在你", hint: "落盘再索引" },
  { icon: CircuitBoard, label: "编排引擎", hint: "自动生长知识" },
  { icon: Luggage, label: "随时带走", hint: "文件可移植" },
];

const CODE_MAIN = [
  { c: "kw", t: "const" },
  { c: "plain", t: " " },
  { c: "var", t: "garden" },
  { c: "plain", t: " = " },
  { c: "fn", t: "await" },
  { c: "plain", t: " " },
  { c: "fn", t: "openOasis" },
  { c: "plain", t: "({" },
  { c: "nl", t: "\n" },
  { c: "plain", t: "  source: " },
  { c: "str", t: '"content/*.md"' },
  { c: "plain", t: "," },
  { c: "nl", t: "\n" },
  { c: "plain", t: "  engine: " },
  { c: "str", t: '"local-first"' },
  { c: "plain", t: "," },
  { c: "nl", t: "\n" },
  { c: "plain", t: "  agents: " },
  { c: "str", t: '"always-on"' },
  { c: "plain", t: "," },
  { c: "nl", t: "\n" },
  { c: "plain", t: "});" },
];

const CODE_SNIPPET = [
  { c: "cmt", t: "/* glass surface */" },
  { c: "nl", t: "\n" },
  { c: "sel", t: ".kp-glass" },
  { c: "plain", t: " {" },
  { c: "nl", t: "\n" },
  { c: "prop", t: "  backdrop-filter" },
  { c: "plain", t: ": " },
  { c: "str", t: "blur(16px)" },
  { c: "plain", t: ";" },
  { c: "nl", t: "\n" },
  { c: "prop", t: "  background" },
  { c: "plain", t: ": " },
  { c: "str", t: "rgba(255,255,255,.58)" },
  { c: "plain", t: ";" },
  { c: "nl", t: "\n" },
  { c: "plain", t: "}" },
];

/** 浮动气泡：icon / 文案都不与支柱、能力区撞车 */
const FLOAT_BADGES = [
  { icon: KeyRound, label: "文件即真相源", className: "bottom-0 left-2", duration: 5.5, delay: 0.3 },
  { icon: Leaf, label: "种子会发芽", className: "right-0 top-16", duration: 6.2, delay: 0.8 },
  { icon: Activity, label: "推拉实时", className: "bottom-16 left-[-0.5rem]", duration: 5.8, delay: 1.2 },
  { icon: Orbit, label: "常驻提醒", className: "right-10 bottom-28", duration: 6.5, delay: 0.5 },
] as const;

function CodeToken({ c, t }: { c: string; t: string }) {
  if (c === "nl") return <br />;
  const color =
    c === "kw"
      ? "text-[#7c6bc4]"
      : c === "str"
        ? "text-[#d4884a]"
        : c === "fn"
          ? "text-[#0087eb]"
          : c === "var"
            ? "text-[#c9a227]"
            : c === "prop"
              ? "text-[#0087eb]"
              : c === "sel"
                ? "text-[#0a4a85]"
                : c === "cmt"
                  ? "text-[var(--kp-text-3)]"
                  : "text-[var(--kp-text-1)]";
  return <span className={color}>{t}</span>;
}

function MacDots() {
  return (
    <div className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
    </div>
  );
}

function ModeChip({
  icon: Icon,
  label,
  side,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  side: "o" | "m";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
        side === "o"
          ? "border-[var(--kp-brand)]/25 bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]"
          : "border-[var(--kp-accent)]/30 bg-[rgba(var(--kp-accent-rgb),0.12)] text-[var(--kp-accent-deep)]",
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

function LetterBadge({ letter, side }: { letter: "O" | "M"; side: "o" | "m" }) {
  const isO = side === "o";
  return (
    <div
      className={cn(
        "relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border md:h-14 md:w-14",
        isO
          ? "border-[var(--kp-brand)]/35 bg-[var(--kp-brand-soft)] shadow-[0_10px_24px_-12px_rgba(0,135,235,0.45)]"
          : "border-[var(--kp-accent)]/40 bg-[rgba(var(--kp-accent-rgb),0.12)] shadow-[0_10px_24px_-12px_rgba(232,168,74,0.4)]",
      )}
    >
      <span
        className={cn(
          "bg-gradient-to-br bg-clip-text text-2xl font-black tracking-tight text-transparent md:text-3xl",
          isO
            ? "from-[var(--kp-brand-light)] to-[var(--kp-brand-deep)]"
            : "from-[var(--kp-accent)] to-[var(--kp-accent-deep)]",
        )}
      >
        {letter}
      </span>
    </div>
  );
}

function FactorBlock({
  letter,
  side,
  title,
  titleAccent,
  subtitle,
  chips,
}: {
  letter: "O" | "M";
  side: "o" | "m";
  title: string;
  titleAccent: string;
  subtitle: string;
  chips: typeof OMNI_MODES;
}) {
  const isO = side === "o";
  return (
    <motion.div
      whileHover={isO ? { y: -4, scale: 1.015 } : { y: -3, rotate: 0.8 }}
      transition={{ type: "spring", stiffness: 320, damping: 24 }}
      className={cn(
        "flex min-w-0 cursor-default items-start gap-2.5 rounded-xl border border-transparent bg-transparent p-2.5 transition-[border-color,background-color,box-shadow] duration-300",
        isO
          ? "kp-card-sheen hover:border-[var(--kp-brand)]/25 hover:bg-white/55 hover:shadow-[0_10px_28px_-14px_rgba(0,135,235,0.35)]"
          : "hover:border-[var(--kp-accent)]/30 hover:bg-white/55 hover:shadow-[0_12px_30px_-14px_rgba(232,168,74,0.35)]",
      )}
    >
      <LetterBadge letter={letter} side={side} />
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-sm font-bold leading-tight text-[var(--kp-text-1)]">
          {title}{" "}
          <span className={isO ? "text-[var(--kp-brand)]" : "text-[var(--kp-accent-deep)]"}>
            {titleAccent}
          </span>
        </p>
        <p className="mt-0.5 text-[11px] font-medium text-[var(--kp-text-3)]">{subtitle}</p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {chips.map((m) => (
            <ModeChip key={m.label} icon={m.icon} label={m.label} side={side} />
          ))}
        </div>
      </div>
    </motion.div>
  );
}

/**
 * 首页 Hero：Logo + OasisMind 为品牌；LOCAL-FIRST / { Garden } 为描述；
 * O×M 公式同屏融合。icon 与文案在整页尽量只出现一次。
 */
export function HeroSection() {
  return (
    <section className="relative overflow-hidden px-6 pb-10 pt-8 lg:px-12 lg:pb-14 lg:pt-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse 70% 55% at 75% -5%, color-mix(in srgb, var(--kp-glow-peach) 70%, transparent), transparent 58%)," +
            "radial-gradient(ellipse 65% 50% at 5% 100%, color-mix(in srgb, var(--kp-glow-blue) 75%, transparent), transparent 55%)," +
            "radial-gradient(ellipse 40% 35% at 45% 45%, color-mix(in srgb, var(--kp-glow-peach) 22%, transparent), transparent 60%)",
        }}
      />
      <div className="pointer-events-none absolute inset-0 -z-10">
        <Particles
          className="h-full w-full"
          quantity={72}
          size={1.3}
          staticity={32}
          ease={42}
          color="#0087eb"
          accentColor="#e8a84a"
          connectDistance={110}
          glow={5}
          vx={0.1}
          vy={0.06}
          refresh={false}
        />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-col gap-8">
        <div className="grid items-center gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:gap-10">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.75, ease: easeSpring }}
            className="flex min-w-0 flex-col"
          >
            <div className="flex flex-nowrap items-baseline gap-x-2.5">
              <span className="text-xl font-bold tracking-tight text-[var(--kp-text-1)] md:text-2xl">见微</span>
              <span className="text-sm font-semibold text-[var(--kp-brand)] md:text-base">知著</span>
            </div>

            {/* Logo 在左，OasisMind 在右 */}
            <div className="mt-2 flex items-center gap-3 md:gap-4">
              <OasisMindLogo
                size={56}
                className="shrink-0 rounded-2xl border border-white/55 shadow-[0_12px_32px_-14px_rgba(0,135,235,0.35)] md:h-16 md:w-16"
              />
              <h1
                className="kp-display-serif kp-text-gradient inline-block overflow-visible pb-1 pr-[0.35em] text-[clamp(2.4rem,6.5vw,4.2rem)] italic leading-[0.95] tracking-[-0.03em]"
                aria-label="OasisMind"
              >
                OasisMind
              </h1>
            </div>

            {/* 描述：GARDEN 可换行、字号更大；混用 {} 与 [] */}
            <p className="mt-5 text-[clamp(1.25rem,3vw,1.85rem)] font-bold uppercase leading-[1.15] tracking-tight text-[var(--kp-text-1)]">
              <span className="block">Local-first Knowledge</span>
              <CurlyMark className="mt-1 block text-[clamp(1.6rem,4vw,2.4rem)] font-black normal-case tracking-tight">
                Garden
              </CurlyMark>
            </p>

            <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-[var(--kp-text-2)] md:text-base">
              写作、收集、蒸馏品味——把碎片养成文章。数据落在你这边，真相留在文件里。
              <SquareMark className="ml-1 text-sm font-semibold normal-case">常驻提醒</SquareMark>
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href="/chat"
                className="group inline-flex h-12 items-center gap-2 rounded-full bg-[var(--kp-brand)] px-6 text-sm font-semibold text-white shadow-[0_10px_28px_-8px_rgba(0,135,235,0.55)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-[var(--kp-brand-dark)]"
              >
                <MessageSquare className="h-4 w-4" />
                开始对话
                <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/gardens"
                className="group inline-flex h-12 items-center gap-2 rounded-full border border-white/60 bg-white/55 px-6 text-sm font-semibold text-[var(--kp-text-1)] shadow-[0_8px_24px_-12px_rgba(17,24,39,0.18)] backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 hover:border-[var(--kp-brand)]/35 hover:bg-white/80"
              >
                <BookOpen className="h-4 w-4 text-[var(--kp-brand)]" />
                进入知识库
              </Link>
              <Link
                href="/office"
                className="inline-flex h-12 items-center gap-2 rounded-full px-4 text-sm font-medium text-[var(--kp-text-2)] underline-offset-4 transition hover:text-[var(--kp-brand)] hover:underline"
              >
                参观 3D 办公室
              </Link>
            </div>
          </motion.div>

          {/* 右侧叠层玻璃窗 */}
          <motion.div
            initial={{ opacity: 0, scale: 0.94, x: 20 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            transition={{ delay: 0.12, duration: 0.9, ease: easeSpring }}
            className="relative mx-auto hidden h-[380px] w-full max-w-lg lg:block"
          >
            <motion.div
              animate={{ y: [0, -8, 0] }}
              whileHover={{ scale: 1.02, rotate: -0.4 }}
              transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
              className="absolute left-0 top-4 w-[88%] cursor-default overflow-hidden rounded-2xl border border-white/50 bg-white/55 shadow-[0_20px_50px_-18px_rgba(0,80,160,0.28)] backdrop-blur-xl transition-[border-color,box-shadow] duration-300 hover:border-[var(--kp-brand)]/30 hover:shadow-[0_28px_60px_-18px_rgba(0,135,235,0.34)]"
            >
              <div className="flex items-center gap-3 border-b border-white/40 px-4 py-3">
                <MacDots />
                <span className="font-mono text-[11px] text-[var(--kp-text-3)]">oasis.open.ts</span>
              </div>
              <pre className="overflow-x-auto px-5 py-4 font-mono text-[12.5px] leading-6">
                <code>
                  {CODE_MAIN.map((tok, i) => (
                    <CodeToken key={i} c={tok.c} t={tok.t} />
                  ))}
                </code>
              </pre>
            </motion.div>

            <motion.div
              animate={{ y: [0, 10, 0] }}
              whileHover={{ scale: 1.04, rotate: 1 }}
              transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", delay: 0.6 }}
              className="absolute bottom-6 right-0 w-[58%] cursor-default overflow-hidden rounded-2xl border border-white/55 bg-white/65 shadow-[0_16px_40px_-14px_rgba(0,80,160,0.22)] backdrop-blur-xl transition-[border-color,box-shadow] duration-300 hover:border-[var(--kp-accent)]/40 hover:shadow-[0_22px_48px_-14px_rgba(232,168,74,0.3)]"
            >
              <div className="flex items-center gap-2 border-b border-white/40 px-3 py-2.5">
                <MacDots />
                <span className="font-mono text-[10px] text-[var(--kp-text-3)]">glass.css</span>
              </div>
              <pre className="px-3.5 py-3 font-mono text-[11px] leading-5">
                <code>
                  {CODE_SNIPPET.map((tok, i) => (
                    <CodeToken key={i} c={tok.c} t={tok.t} />
                  ))}
                </code>
              </pre>
            </motion.div>

            <motion.div
              animate={{ y: [0, -6, 0] }}
              whileHover={{ scale: 1.12, rotate: -8 }}
              transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 1 }}
              className="absolute right-6 top-0 flex h-12 w-12 cursor-default items-center justify-center rounded-2xl border border-white/60 bg-white/70 shadow-[0_10px_28px_-10px_rgba(0,135,235,0.45)] backdrop-blur-md transition-[box-shadow] duration-300 hover:shadow-[0_14px_32px_-8px_rgba(0,135,235,0.55)]"
              title="锁在本地"
            >
              <Lock className="h-5 w-5 text-[var(--kp-brand)]" />
            </motion.div>

            {FLOAT_BADGES.map((badge) => {
              const Icon = badge.icon;
              return (
                <motion.div
                  key={badge.label}
                  animate={{ y: [0, 7, 0] }}
                  transition={{
                    duration: badge.duration,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: badge.delay,
                  }}
                  className={cn(
                    "absolute inline-flex items-center gap-1.5 rounded-full border border-white/55 bg-white/70 px-3 py-1.5 text-[11px] font-medium text-[var(--kp-text-2)] shadow-sm backdrop-blur-md",
                    badge.className,
                  )}
                >
                  <Icon className="h-3.5 w-3.5 text-[var(--kp-brand)]" />
                  {badge.label}
                </motion.div>
              );
            })}
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.28, duration: 0.65, ease: easeSpring }}
          className="kp-card-premium relative overflow-hidden rounded-[1.5rem] p-4 md:p-5"
        >
          <p className="mb-4 w-full text-sm leading-relaxed text-[var(--kp-text-2)] lg:text-[15px]">
            从细微之处照见全局——每一粒种子都被看见、被关联、被养成。O × M 合起来，就是
            <SquareMark className="mx-1 font-semibold">全模态多智能体</SquareMark>
            ：AGI 的另一种表述。
          </p>

          <div className="grid items-center gap-3 rounded-2xl border border-white/50 bg-white/35 p-3.5 backdrop-blur-md lg:grid-cols-[1fr_auto_1fr_auto_auto] lg:gap-4 lg:p-4">
            <FactorBlock
              letter="O"
              side="o"
              title="Oasis ·"
              titleAccent="Omni"
              subtitle="全模态输入"
              chips={OMNI_MODES}
            />
            <span aria-hidden className="shrink-0 self-center text-2xl font-light text-[var(--kp-text-3)]">
              ×
            </span>
            <FactorBlock
              letter="M"
              side="m"
              title="Mind ·"
              titleAccent="Multi-Agent"
              subtitle="多智能体协作"
              chips={AGENT_CAPS}
            />
            <span aria-hidden className="shrink-0 self-center text-2xl font-light text-[var(--kp-text-3)]">
              =
            </span>
            <motion.div
              whileHover={{ y: -3, scale: 1.02 }}
              transition={{ type: "spring", stiffness: 320, damping: 24 }}
              className="shrink-0 cursor-default rounded-2xl border border-white/55 bg-white/55 px-4 py-3 shadow-sm backdrop-blur-md transition-[border-color,box-shadow,background-color] duration-300 hover:border-[var(--kp-brand)]/30 hover:bg-white/80 hover:shadow-[0_12px_32px_-14px_rgba(0,135,235,0.35)]"
            >
              <p className="text-lg font-black tracking-tight md:text-xl">
                <CurlyMark>全模态</CurlyMark>
                <span className="mx-1 text-[var(--kp-text-3)]">·</span>
                <SquareMark>多智能体</SquareMark>
              </p>
              <p className="mt-1 text-[11px] font-semibold text-[var(--kp-text-2)]">AGI 的另一种表述</p>
            </motion.div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {BRAND_ANCHORS.map((item, i) => {
              const Icon = item.icon;
              const hoverMotion = [
                { y: -4 },
                { y: -3, rotate: -1.2 },
                { y: -3, scale: 1.03 },
                { y: 2, scale: 0.98 },
              ][i % 4];
              const hoverClass = [
                "hover:border-[var(--kp-brand)]/35 hover:shadow-[0_10px_24px_-14px_rgba(0,135,235,0.3)]",
                "hover:border-[var(--kp-accent)]/40 hover:shadow-[0_10px_24px_-14px_rgba(232,168,74,0.3)]",
                "kp-card-sheen hover:border-white/80 hover:shadow-[0_12px_28px_-14px_rgba(0,80,160,0.24)]",
                "hover:bg-white/80 hover:shadow-[inset_0_2px_8px_rgba(0,80,160,0.08)]",
              ][i % 4];
              return (
                <motion.div
                  key={item.label}
                  whileHover={hoverMotion}
                  transition={{ type: "spring", stiffness: 320, damping: 24 }}
                  className={`group flex cursor-default items-start gap-2.5 rounded-xl border border-white/50 bg-white/40 px-3 py-2.5 backdrop-blur-sm transition-[border-color,background-color,box-shadow] duration-300 hover:bg-white/70 ${hoverClass}`}
                >
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--kp-brand)]/20 bg-[var(--kp-brand-soft)] text-[var(--kp-brand)] transition-transform duration-300 group-hover:scale-110 group-hover:rotate-6">
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-[var(--kp-text-1)]">{item.label}</p>
                    <p className="mt-0.5 text-[10px] text-[var(--kp-text-3)]">{item.hint}</p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
