"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CurlyMark, SquareMark } from "@/components/home/accentMark";
import { ScrollReveal } from "@/components/magicui/scroll-reveal";
import { cn } from "@/lib/utils";

const spring = { type: "spring", stiffness: 260, damping: 26 } as const;

/** 控制论 · 闭环反馈 */
function IconCybernetics({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden>
      <circle cx="20" cy="20" r="11" stroke="currentColor" strokeWidth="1.6" opacity="0.35" />
      <path
        d="M20 9a11 11 0 0 1 9.5 5.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M29.5 14.5 26 12.2M29.5 14.5 27.8 18"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="20" cy="20" r="3.2" fill="currentColor" />
      <path
        d="M14 26.5c1.6 1.4 3.7 2.2 6 2.2s4.4-.8 6-2.2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.7"
      />
    </svg>
  );
}

/** 系统论 · 多层嵌套 */
function IconSystems({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden>
      <rect x="7" y="8" width="26" height="24" rx="4" stroke="currentColor" strokeWidth="1.5" opacity="0.35" />
      <rect x="11" y="12" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <rect x="19" y="20" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M21 16h4a2 2 0 0 1 2 2v2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.75"
      />
      <circle cx="16" cy="16" r="1.4" fill="currentColor" />
      <circle cx="24" cy="24" r="1.4" fill="currentColor" />
    </svg>
  );
}

/** 信息论 · 信号与熵 */
function IconInformation({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden>
      <path
        d="M8 28V12c0-1.1.9-2 2-2h6l3 4h11c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H10c-1.1 0-2-.9-2-2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.4"
      />
      <path
        d="M12 22h4M12 18h8M20 22h8"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <circle cx="28" cy="14" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M28 12.2v2.6M28 17h.01" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

const THEORIES = [
  {
    id: "cybernetics",
    title: "控制论",
    en: "Cybernetics",
    tag: "闭环",
    accent: "o" as const,
    Icon: IconCybernetics,
    thesis: "Agent 应该是可控、可观测的系统。",
    body: "没有反馈就没有控制。每一次工具调用、审批闸门、流式中断，都是把「黑箱智能」收进可调节的回路：输入—行动—感知—修正。见微不追求神秘的全知，而追求你能看见它在干什么、能在关键点踩住刹车。",
    points: [
      { label: "可观测", text: "Thinking、工具链、Run 状态实时可见" },
      { label: "可干预", text: "Steer、暂停、审批，人始终在回路里" },
      { label: "可收敛", text: "熔断与预算防止失控空转" },
    ],
  },
  {
    id: "systems",
    title: "系统论",
    en: "Systems Theory",
    tag: "涌现",
    accent: "m" as const,
    Icon: IconSystems,
    thesis: "智能来自结构，而不是单点模型。",
    body: "超级 / 管理 / 子 Agent 分层，Workspace 隔离，Markdown 作事实源——整体大于零件之和。把花园当成系统：种子、土壤、园丁各司其职，关系网长出来的才是知识，而不是某次对话的一次性答案。",
    points: [
      { label: "分层", text: "tier 权限与职责边界清晰" },
      { label: "耦合适度", text: "子结果唯一经 report_back 上交" },
      { label: "可生长", text: "文件与配置可版本、可带走" },
    ],
  },
  {
    id: "information",
    title: "信息论",
    en: "Information Theory",
    tag: "降熵",
    accent: "o" as const,
    Icon: IconInformation,
    thesis: "知识工作的本质是降噪与压缩。",
    body: "收藏、碎片、语音、视频——原始信道嘈杂。蒸馏品味 = 提高信噪比：把不确定的输入压成可检索、可复用的 Markdown 原子。Memory 不是堆字，是带衰减与强度的信道编码，让下一轮对话少付一点「重新解释自己」的代价。",
    points: [
      { label: "原子", text: "Markdown 是单一事实源" },
      { label: "压缩", text: "摘要、标签、图谱减少熵" },
      { label: "信道", text: "推拉结合，状态不靠刷新猜" },
    ],
  },
];

export function ThreeTheories() {
  const [active, setActive] = useState(THEORIES[0].id);
  const current = THEORIES.find((t) => t.id === active) ?? THEORIES[0];

  return (
    <section className="relative overflow-hidden px-6 py-10 lg:px-12 lg:py-12">
      <div className="relative z-10 mx-auto max-w-7xl">
        <ScrollReveal className="mb-8">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--kp-brand)]">
            Foundations
          </p>
          <h2 className="text-2xl font-bold tracking-tight text-[var(--kp-text-1)] md:text-3xl">
            三论立园 · <CurlyMark>控制 · 系统 · 信息</CurlyMark>
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--kp-text-2)]">
            见微不是堆功能，而是用三套透镜看 Agent：如何管得住、如何长成体、如何把噪声炼成知识。
            <SquareMark className="ml-1 text-xs font-semibold">悬停展开</SquareMark>
          </p>
        </ScrollReveal>

        <div className="grid gap-3 lg:grid-cols-3">
          {THEORIES.map((t, i) => {
            const selected = active === t.id;
            const isO = t.accent === "o";
            const hoverMotion = [
              { y: -8, scale: 1.015 },
              { y: -5, rotate: -0.8 },
              { y: -4, x: 3 },
            ][i % 3];
            return (
              <motion.button
                key={t.id}
                type="button"
                onClick={() => setActive(t.id)}
                onMouseEnter={() => setActive(t.id)}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ ...spring, delay: i * 0.06 }}
                whileHover={hoverMotion}
                className={cn(
                  "group relative flex flex-col overflow-hidden rounded-2xl border p-5 text-left shadow-[0_12px_36px_-18px_rgba(0,80,160,0.18)] backdrop-blur-xl transition-[border-color,box-shadow,background-color] duration-500",
                  selected
                    ? isO
                      ? "border-[var(--kp-brand)]/40 bg-white/75 shadow-[0_22px_52px_-16px_rgba(0,135,235,0.28)]"
                      : "border-[var(--kp-accent)]/45 bg-white/75 shadow-[0_22px_52px_-16px_rgba(232,168,74,0.28)]"
                    : "border-white/55 bg-white/50 hover:border-[var(--kp-brand)]/25 hover:bg-white/70",
                  i === 0 && "hover:shadow-[0_22px_48px_-16px_rgba(0,135,235,0.3)]",
                  i === 1 && "hover:shadow-[0_20px_44px_-14px_rgba(232,168,74,0.32)]",
                  i === 2 && "kp-card-sheen hover:shadow-[0_18px_40px_-14px_rgba(0,80,160,0.28)]",
                )}
              >
                <div
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full blur-3xl transition-opacity duration-500",
                    isO ? "bg-[var(--kp-glow-blue)]/40" : "bg-[var(--kp-glow-peach)]/45",
                    selected ? "opacity-100" : "opacity-0 group-hover:opacity-70",
                  )}
                />

                <div className="relative flex items-start justify-between gap-3">
                  <div
                    className={cn(
                      "flex h-11 w-11 items-center justify-center rounded-xl border transition-transform duration-300 group-hover:scale-105",
                      isO
                        ? "border-[var(--kp-brand)]/30 bg-[var(--kp-brand-soft)] text-[var(--kp-brand)]"
                        : "border-[var(--kp-accent)]/35 bg-[rgba(var(--kp-accent-rgb),0.12)] text-[var(--kp-accent-deep)]",
                    )}
                  >
                    <t.Icon className="h-7 w-7" />
                  </div>
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      isO
                        ? "border-[var(--kp-brand)]/25 text-[var(--kp-brand)]"
                        : "border-[var(--kp-accent)]/30 text-[var(--kp-accent-deep)]",
                    )}
                  >
                    {t.tag}
                  </span>
                </div>

                <div className="relative mt-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--kp-text-3)]">
                    {t.en}
                  </p>
                  <h3 className="mt-0.5 text-lg font-bold text-[var(--kp-text-1)]">{t.title}</h3>
                  <p className="mt-2 text-sm font-semibold leading-snug text-[var(--kp-text-1)]">
                    {t.thesis}
                  </p>
                  <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-[var(--kp-text-2)]">
                    {t.body}
                  </p>
                </div>

                <div className="relative mt-4 flex items-center gap-1.5">
                  {THEORIES.map((dot) => (
                    <span
                      key={dot.id}
                      className={cn(
                        "h-1 rounded-full transition-all duration-300",
                        active === dot.id
                          ? isO
                            ? "w-5 bg-[var(--kp-brand)]"
                            : "w-5 bg-[var(--kp-accent)]"
                          : "w-1.5 bg-[var(--kp-text-3)]/35",
                      )}
                    />
                  ))}
                </div>
              </motion.button>
            );
          })}
        </div>

        {/* 展开详情带 */}
        <AnimatePresence mode="wait">
          <motion.div
            key={current.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={spring}
            className="mt-4 overflow-hidden rounded-2xl border border-white/55 bg-white/55 p-5 shadow-[0_12px_36px_-18px_rgba(0,80,160,0.14)] backdrop-blur-xl md:p-6"
          >
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="max-w-2xl">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--kp-brand)]">
                  {current.en} · 展开
                </p>
                <p className="mt-1 text-base font-bold text-[var(--kp-text-1)] md:text-lg">
                  {current.thesis}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-[var(--kp-text-2)]">{current.body}</p>
              </div>
              <div className="grid flex-1 gap-2 sm:grid-cols-3 md:max-w-md">
                {current.points.map((p, i) => (
                  <motion.div
                    key={p.label}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ ...spring, delay: 0.05 + i * 0.05 }}
                    whileHover={{ y: -3 }}
                    className="rounded-xl border border-white/60 bg-white/70 px-3 py-2.5 shadow-sm"
                  >
                    <p className="text-[11px] font-bold text-[var(--kp-brand)]">{p.label}</p>
                    <p className="mt-1 text-[11px] leading-snug text-[var(--kp-text-2)]">{p.text}</p>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}
