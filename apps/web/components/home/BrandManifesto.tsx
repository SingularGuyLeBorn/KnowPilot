"use client";

import { motion } from "framer-motion";
import {
  Brain,
  CircuitBoard,
  Fingerprint,
  Hash,
  Image as ImageIcon,
  ListChecks,
  Luggage,
  Mic,
  Sparkles,
  Type,
  UsersRound,
  Video,
  Wand2,
} from "lucide-react";
import { CurlyMark, SquareMark } from "@/components/home/accentMark";
import { ScrollReveal } from "@/components/magicui/scroll-reveal";
import { cn } from "@/lib/utils";

const easeSpring = [0.22, 1, 0.36, 1] as const;

const OMNI_MODES = [
  { icon: Type, label: "Text" },
  { icon: ImageIcon, label: "Image" },
  { icon: Mic, label: "Voice" },
  { icon: Video, label: "Video" },
];

const AGENT_CAPS = [
  { icon: UsersRound, label: "Agents" },
  { icon: Wand2, label: "Skills" },
  { icon: Brain, label: "Memory" },
  { icon: ListChecks, label: "Tasks" },
];

const BRAND_ANCHORS = [
  { icon: Hash, label: "Markdown 原子", hint: "单一事实源" },
  { icon: Fingerprint, label: "主权在你", hint: "落盘再索引" },
  { icon: CircuitBoard, label: "编排引擎", hint: "自动生长知识" },
  { icon: Luggage, label: "随时带走", hint: "文件可移植" },
];

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
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <LetterBadge letter={letter} side={side} />
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-sm font-bold leading-tight text-[var(--kp-text-1)]">
          {title}{" "}
          <span className={side === "o" ? "text-[var(--kp-brand)]" : "text-[var(--kp-accent-deep)]"}>
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
    </div>
  );
}

/** About 页 O×M 公式卡（不重复品牌名；首页已并入 Hero） */
export function BrandManifesto() {
  return (
    <section className="relative overflow-hidden px-6 py-6 lg:px-12 lg:py-8">
      <div className="relative z-10 mx-auto max-w-7xl">
        <ScrollReveal>
          <div className="kp-card-premium relative overflow-hidden rounded-[1.5rem] p-4 md:p-5">
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
                initial={{ opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.2, duration: 0.45, ease: easeSpring }}
                className="shrink-0 rounded-2xl border border-white/55 bg-white/55 px-4 py-3 shadow-sm backdrop-blur-md"
              >
                <p className="text-lg font-black tracking-tight md:text-xl">
                  <CurlyMark>全模态</CurlyMark>
                  <span className="mx-1 text-[var(--kp-text-3)]">·</span>
                  <SquareMark>多智能体</SquareMark>
                </p>
                <p className="mt-1 inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--kp-text-2)]">
                  <Sparkles className="h-3 w-3 text-[var(--kp-accent)]" />
                  AGI 的另一种表述
                </p>
              </motion.div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {BRAND_ANCHORS.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.label}
                    className="flex items-start gap-2.5 rounded-xl border border-white/50 bg-white/40 px-3 py-2.5 backdrop-blur-sm"
                  >
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--kp-brand)]/20 bg-[var(--kp-brand-soft)] text-[var(--kp-brand)]">
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-[var(--kp-text-1)]">{item.label}</p>
                      <p className="mt-0.5 text-[10px] text-[var(--kp-text-3)]">{item.hint}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
