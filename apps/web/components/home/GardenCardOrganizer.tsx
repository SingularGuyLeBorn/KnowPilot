"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import type { Garden } from "@knowpilot/shared";
import { CurlyMark, SquareMark } from "@/components/home/accentMark";
import { ScrollReveal } from "@/components/magicui/scroll-reveal";
import { displayGardenTitle, formatGardenId } from "@/lib/gardenDisplay";
import { cn } from "@/lib/utils";

type GardenCard = {
  id: string;
  title: string;
  description: string;
  postCount: number;
  recentPosts: Array<{ title: string; slug: string }>;
  accent: "blue" | "peach" | "mint" | "slate";
};

const FALLBACK_GARDENS: GardenCard[] = [
  {
    id: "posts",
    title: "博文花园",
    description: "公开发表的文章与随笔，见微知著的主展厅。",
    postCount: 0,
    recentPosts: [],
    accent: "blue",
  },
  {
    id: "knowledge",
    title: "知识库",
    description: "结构化笔记与概念蒸馏，供检索与复用。",
    postCount: 0,
    recentPosts: [],
    accent: "peach",
  },
  {
    id: "resources",
    title: "资源库",
    description: "链接、素材与参考资料的本地收纳。",
    postCount: 0,
    recentPosts: [],
    accent: "mint",
  },
];

const ACCENT = {
  blue: {
    glow: "rgba(0,135,235,0.55)",
    soft: "var(--kp-brand-soft)",
    solid: "var(--kp-brand)",
    deep: "var(--kp-brand-deep)",
    fill: "linear-gradient(165deg, color-mix(in srgb, var(--kp-brand) 72%, white), var(--kp-brand-deep))",
    badge: "border-white/40 bg-white/25 text-white",
  },
  peach: {
    glow: "rgba(232,168,74,0.5)",
    soft: "color-mix(in srgb, var(--kp-accent) 22%, white)",
    solid: "var(--kp-accent)",
    deep: "var(--kp-accent-deep)",
    fill: "linear-gradient(165deg, color-mix(in srgb, var(--kp-accent) 75%, white), var(--kp-accent-deep))",
    badge: "border-white/40 bg-white/25 text-white",
  },
  mint: {
    glow: "rgba(52,180,140,0.48)",
    soft: "rgba(52,180,140,0.16)",
    solid: "#2f9f7a",
    deep: "#1f6f56",
    fill: "linear-gradient(165deg, #4ec9a0, #1f6f56)",
    badge: "border-white/40 bg-white/25 text-white",
  },
  slate: {
    glow: "rgba(80,100,140,0.45)",
    soft: "rgba(80,100,140,0.14)",
    solid: "#5a6d8c",
    deep: "#3d4d66",
    fill: "linear-gradient(165deg, #7a8eae, #3d4d66)",
    badge: "border-white/40 bg-white/25 text-white",
  },
} as const;

const ACCENT_ORDER: GardenCard["accent"][] = ["blue", "peach", "mint", "slate"];

function pickAccent(id: string, index: number): GardenCard["accent"] {
  if (id === "posts") return "blue";
  if (id === "knowledge") return "peach";
  if (id === "resources") return "mint";
  return ACCENT_ORDER[index % ACCENT_ORDER.length];
}

function toCards(gardens: Garden[]): GardenCard[] {
  if (gardens.length === 0) return FALLBACK_GARDENS;
  return gardens.slice(0, 6).map((g, i) => ({
    id: g.id,
    title: g.title,
    description: g.description?.trim() || "一座本地知识库，文章与首页同根生长。",
    postCount: g.postCount ?? 0,
    recentPosts: g.recentPosts ?? [],
    accent: pickAccent(g.id, i),
  }));
}

/** 自定义图标：书脊/文档，避开 Lucide */
function CardGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" aria-hidden>
      <rect x="7" y="5" width="18" height="22" rx="3" stroke="currentColor" strokeWidth="1.7" fill="currentColor" fillOpacity="0.12" />
      <path d="M11 11h10M11 15h8M11 19h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** 命中检测用基准 X（不含选中推开），避免 active 循环依赖 */
function baseSlotX(index: number, total: number, compact: boolean): number {
  const mid = (total - 1) / 2;
  const step = compact ? 52 : 64;
  return (index - mid) * step;
}

function pickIndexFromClientX(
  clientX: number,
  stageWidth: number,
  total: number,
  compact: boolean,
): number {
  const x = clientX - stageWidth / 2;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < total; i++) {
    const d = Math.abs(baseSlotX(i, total, compact) - x);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

const FAN_SPRING = { type: "spring" as const, stiffness: 220, damping: 28, mass: 0.85 };

/**
 * 槽位姿态：展开时读 activeIndex——选中卡居前，左右邻卡向两侧让开。
 * 悬停命中不走单卡 pointer（会被 3D 叠层挡住），由舞台按 X 坐标选卡。
 */
function slotTransform(
  index: number,
  total: number,
  expanded: boolean,
  compact: boolean,
  activeIndex: number,
) {
  const mid = (total - 1) / 2;
  const t = index - mid;
  const dist = index - activeIndex;

  if (!expanded) {
    return {
      x: t * (compact ? 14 : 18),
      y: 20 + Math.abs(t) * 3,
      z: -Math.abs(t) * 8,
      rotateY: -58,
      rotateZ: t * 1.2,
      scale: 0.92,
    };
  }

  const step = compact ? 50 : 60;
  // 推开幅度略收，切换时位移更小、弹簧更顺
  const push = dist === 0 ? 0 : Math.sign(dist) * (compact ? 16 : 22) * Math.abs(dist);
  const isActive = dist === 0;

  return {
    x: t * step + push,
    y: isActive ? -14 : Math.abs(t) * 1.5 + Math.abs(dist) * 0.8,
    z: isActive ? 72 : -10 - Math.abs(dist) * 16,
    rotateY: isActive ? -6 : -34 + t * 1.8,
    rotateZ: isActive ? 0 : t * 0.5,
    scale: isActive ? 1.06 : 0.95,
  };
}

function FanCard({
  garden,
  index,
  total,
  expanded,
  selected,
  activeIndex,
  compact,
  reducedMotion,
}: {
  garden: GardenCard;
  index: number;
  total: number;
  expanded: boolean;
  selected: boolean;
  activeIndex: number;
  compact: boolean;
  reducedMotion: boolean;
}) {
  const style = ACCENT[garden.accent];
  const pose = slotTransform(index, total, expanded, compact, activeIndex);
  const cardW = compact ? 108 : 128;
  const cardH = compact ? 200 : 236;
  const zIndex = selected ? total + 40 : total - Math.abs(index - activeIndex);
  const idLabel = formatGardenId(garden.id);

  return (
    <motion.div
      className="absolute left-1/2 top-1/2"
      style={{
        width: cardW,
        height: cardH,
        marginLeft: -cardW / 2,
        marginTop: -cardH / 2 - 8,
        zIndex,
        transformStyle: "preserve-3d",
        transformPerspective: 1100,
        pointerEvents: "none",
      }}
      initial={false}
      animate={{
        x: pose.x,
        y: pose.y,
        z: pose.z,
        rotateY: pose.rotateY,
        rotateZ: pose.rotateZ,
        scale: pose.scale,
      }}
      transition={reducedMotion ? { duration: 0 } : FAN_SPRING}
      aria-hidden
    >
      {/* 无硬白描边：叠卡时的竖白线多半来自 border / 1px ring */}
      <div
        className={cn(
          "relative h-full w-full overflow-hidden rounded-[1.15rem] text-left",
          "backdrop-blur-xl",
          selected ? "text-white" : "bg-white/70 text-[var(--kp-text-1)]",
        )}
        style={{
          background: selected
            ? style.fill
            : "linear-gradient(165deg, rgba(255,255,255,0.82), rgba(255,255,255,0.58))",
          // 内描边低对比，避免叠卡缝窜出竖白线（旧版 border-white + 1px ring）
          boxShadow: selected
            ? `0 26px 48px -16px ${style.glow}, inset 0 0 0 1px rgba(255,255,255,0.14)`
            : "0 14px 32px -18px rgba(0,80,160,0.22), inset 0 0 0 1px rgba(0,0,0,0.05)",
        }}
      >
        {/* 柔光：只从左上铺开，避免右缘亮出竖白线 */}
        <span
          aria-hidden
          className="pointer-events-none absolute -left-6 -top-8 h-28 w-28 rounded-full opacity-70 blur-2xl"
          style={{ background: selected ? "rgba(255,255,255,0.28)" : style.soft }}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-3 top-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent"
        />

        <div className="relative flex h-full flex-col px-2.5 pb-2.5 pt-3">
          <div className="flex items-start justify-between gap-1">
            <span
              className={cn(
                "inline-flex max-w-[88%] items-center truncate rounded-full px-2 py-0.5 text-[9px] font-bold tracking-wide",
                selected
                  ? "bg-white/20 text-white"
                  : "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]",
              )}
            >
              <span className={cn("mr-0.5 opacity-70", selected ? "text-white" : "text-[var(--kp-brand)]")}>
                {"{"}
              </span>
              {idLabel}
              <span className={cn("ml-0.5 opacity-70", selected ? "text-white" : "text-[var(--kp-brand)]")}>
                {"}"}
              </span>
            </span>
            <CardGlyph
              className={cn("h-3.5 w-3.5 shrink-0 opacity-80", selected ? "text-white" : "text-[var(--kp-brand)]")}
            />
          </div>

          <div className="mt-2 flex flex-wrap gap-1">
            <span
              className={cn(
                "inline-flex items-center rounded-md px-1.5 py-0.5 text-[9px] font-semibold tabular-nums",
                selected ? "bg-white/18 text-white" : "bg-black/[0.04] text-[var(--kp-text-2)]",
              )}
            >
              [{garden.postCount}]
            </span>
            <span
              className={cn(
                "inline-flex items-center rounded-md px-1.5 py-0.5 text-[9px] font-medium",
                selected ? "bg-white/12 text-white/85" : "bg-black/[0.03] text-[var(--kp-text-3)]",
              )}
            >
              篇
            </span>
          </div>

          <div className="mt-auto min-w-0 space-y-1.5">
            {selected && (
              <p className="line-clamp-3 text-[10px] leading-snug text-white/88">
                {garden.description}
              </p>
            )}
            <p
              className={cn(
                "min-w-0 text-[11px] font-bold leading-snug tracking-tight",
                selected ? "line-clamp-2 text-white" : "truncate text-[var(--kp-text-1)]",
              )}
              title={displayGardenTitle(garden.title)}
            >
              {selected ? (
                <>
                  <span className="opacity-75">{"{"}</span> {displayGardenTitle(garden.title)}{" "}
                  <span className="opacity-75">{"}"}</span>
                </>
              ) : (
                displayGardenTitle(garden.title)
              )}
            </p>
            {!selected && (
              <p className="text-[10px] text-[var(--kp-text-3)]">
                <SquareMark className="text-[10px] font-semibold">{garden.postCount} 篇</SquareMark>
              </p>
            )}
          </div>
        </div>
      </div>

      <motion.div
        aria-hidden
        className="absolute -bottom-5 left-1/2 h-6 w-[70%] -translate-x-1/2 rounded-full blur-xl"
        style={{ background: style.glow }}
        initial={false}
        animate={{ opacity: selected ? 0.6 : 0.1 }}
        transition={reducedMotion ? { duration: 0 } : { duration: 0.35 }}
      />
    </motion.div>
  );
}

export function GardenCardOrganizer({ gardens }: { gardens: Garden[] }) {
  const cards = useMemo(() => toCards(gardens), [gardens]);
  const [expanded, setExpanded] = useState(true);
  const [active, setActive] = useState(0);
  const [compact, setCompact] = useState(false);
  const [touchLike, setTouchLike] = useState(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    const mqCompact = window.matchMedia("(max-width: 768px)");
    const mqTouch = window.matchMedia("(hover: none)");
    const sync = () => {
      setCompact(mqCompact.matches);
      setTouchLike(mqTouch.matches);
      if (reduced) setExpanded(true);
    };
    sync();
    mqCompact.addEventListener("change", sync);
    mqTouch.addEventListener("change", sync);
    return () => {
      mqCompact.removeEventListener("change", sync);
      mqTouch.removeEventListener("change", sync);
    };
  }, [reduced]);

  const current = cards[Math.min(active, cards.length - 1)] ?? cards[0];
  const currentStyle = current ? ACCENT[current.accent] : null;

  return (
    <section className="relative overflow-hidden px-6 py-12 lg:px-12 lg:py-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 55% 50% at 55% 45%, color-mix(in srgb, var(--kp-glow-blue) 45%, transparent), transparent 70%)," +
            "radial-gradient(ellipse 40% 35% at 15% 80%, color-mix(in srgb, var(--kp-glow-peach) 30%, transparent), transparent 65%)",
        }}
      />

      <div className="relative z-10 mx-auto max-w-7xl">
        <ScrollReveal className="mb-8 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--kp-brand)]">
              Gardens
            </p>
            <h2 className="text-2xl font-bold tracking-tight text-[var(--kp-text-1)] md:text-3xl">
              知识库 <CurlyMark>收纳盒</CurlyMark>
            </h2>
          </div>
          <p className="max-w-md text-sm text-[var(--kp-text-2)]">
            悬停哪张，哪张置顶；邻卡向两侧让开，详情在右侧展开。
            <SquareMark className="ml-1 text-xs font-semibold">本地优先</SquareMark>
          </p>
        </ScrollReveal>

        <ScrollReveal>
          <div className="grid items-stretch gap-5 lg:grid-cols-[1.35fr_0.75fr]">
            {/* 收纳盒舞台：overflow 不裁切侧向推开的卡；悬停命中在下方 stage */}
            <div
              className="relative overflow-visible rounded-[1.75rem] border border-white/60 bg-white/40 shadow-[0_24px_64px_-28px_rgba(0,80,160,0.28)] backdrop-blur-xl"
              onMouseEnter={() => setExpanded(true)}
              onMouseLeave={() => {
                // 桌面保持展开，避免进出托盘时整扇收起造成「僵硬」顿挫
                if (touchLike && !reduced) setExpanded(false);
              }}
            >
              <div className="flex items-center justify-between px-5 pt-4">
                <div className="flex items-center gap-2">
                  <span className="rounded-full border border-white/70 bg-white/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--kp-text-3)]">
                    Card Tray
                  </span>
                  <span className="text-[11px] text-[var(--kp-text-3)]">
                    {expanded ? "扇形展开" : "收纳叠放"} · {cards.length} 座
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {touchLike && (
                    <button
                      type="button"
                      onClick={() => setExpanded((v) => !v)}
                      className="rounded-full border border-white/70 bg-white/70 px-3 py-1 text-[11px] font-semibold text-[var(--kp-text-2)]"
                    >
                      {expanded ? "收起" : "展开"}
                    </button>
                  )}
                  <Link
                    href="/gardens"
                    className="inline-flex items-center gap-1 rounded-full border border-white/70 bg-white/70 px-3 py-1 text-[11px] font-semibold text-[var(--kp-brand)] transition hover:bg-white"
                  >
                    全部花园
                    <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" aria-hidden>
                      <path
                        d="M2.5 6h7M6.5 3.5L9.5 6 6.5 8.5"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </Link>
                </div>
              </div>

              {/* 滑动暗示弧线 */}
              <div className="pointer-events-none relative mx-auto mt-2 h-6 w-[55%]" aria-hidden>
                <svg viewBox="0 0 200 24" className="h-full w-full text-[var(--kp-text-3)]/45">
                  <path
                    d="M10 16 Q100 2 190 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeDasharray="3 4"
                  />
                  <path d="M8 14l-4 2 4 2M192 14l4 2-4 2" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              </div>

              <div
                className="relative mx-auto h-[320px] w-full max-w-3xl cursor-pointer sm:h-[360px]"
                style={{ perspective: 1100, perspectiveOrigin: "50% 45%" }}
                role="listbox"
                aria-label="知识库扇形卡片"
                aria-activedescendant={current?.id}
                tabIndex={0}
                onMouseMove={(e) => {
                  if (!expanded) setExpanded(true);
                  const rect = e.currentTarget.getBoundingClientRect();
                  const next = pickIndexFromClientX(
                    e.clientX - rect.left,
                    rect.width,
                    cards.length,
                    compact,
                  );
                  setActive((prev) => (prev === next ? prev : next));
                }}
                onClick={(e) => {
                  if (!expanded) setExpanded(true);
                  const rect = e.currentTarget.getBoundingClientRect();
                  const next = pickIndexFromClientX(
                    e.clientX - rect.left,
                    rect.width,
                    cards.length,
                    compact,
                  );
                  setActive(next);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight") {
                    e.preventDefault();
                    setExpanded(true);
                    setActive((i) => Math.min(cards.length - 1, i + 1));
                  } else if (e.key === "ArrowLeft") {
                    e.preventDefault();
                    setExpanded(true);
                    setActive((i) => Math.max(0, i - 1));
                  }
                }}
              >
                {/* 托盘底板 */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-[12%] bottom-8 h-[46%] rounded-2xl border border-white/45 bg-gradient-to-b from-white/50 to-white/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]"
                  style={{ transform: "rotateX(62deg)", transformOrigin: "50% 100%" }}
                />
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-[18%] bottom-6 h-3 rounded-full bg-[rgba(0,80,160,0.1)] blur-md"
                />

                <div
                  className="pointer-events-none absolute inset-0"
                  style={{ transformStyle: "preserve-3d" }}
                >
                  {cards.map((garden, i) => (
                    <FanCard
                      key={garden.id}
                      garden={garden}
                      index={i}
                      total={cards.length}
                      expanded={expanded || !!reduced}
                      selected={active === i && (expanded || !!reduced)}
                      activeIndex={active}
                      compact={compact}
                      reducedMotion={!!reduced}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* 右侧详情 */}
            <div
              className="relative overflow-hidden rounded-[1.75rem] p-5 text-white shadow-[0_24px_56px_-22px_rgba(0,80,160,0.35)]"
              style={{
                background: currentStyle?.fill ?? "var(--kp-brand)",
                boxShadow: `0 24px 56px -22px rgba(0,80,160,0.35), inset 0 0 0 1px rgba(255,255,255,0.16)`,
              }}
            >
              <div
                aria-hidden
                className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/20 blur-3xl"
              />
              {current && currentStyle ? (
                <motion.div
                  key={current.id}
                  initial={reduced ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={reduced ? { duration: 0 } : { duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/70">
                    Selected Garden
                  </p>
                  <h3 className="mt-1 text-xl font-black tracking-tight">
                    <span className="opacity-70">{"{"}</span> {displayGardenTitle(current.title)}{" "}
                    <span className="opacity-70">{"}"}</span>
                  </h3>
                  <p className="mt-1.5 inline-flex items-center rounded-full bg-white/15 px-2.5 py-0.5 text-xs text-white/90">
                    [{formatGardenId(current.id)}]
                  </p>
                  <p className="mt-3 text-sm leading-relaxed text-white/90">{current.description}</p>

                  <div className="mt-5 grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-white/15 px-3 py-2.5 backdrop-blur-sm">
                      <p className="text-[10px] text-white/70">文章</p>
                      <p className="text-2xl font-black tabular-nums">{current.postCount}</p>
                    </div>
                    <div className="rounded-xl bg-white/15 px-3 py-2.5 backdrop-blur-sm">
                      <p className="text-[10px] text-white/70">近期</p>
                      <p className="text-2xl font-black tabular-nums">{current.recentPosts.length}</p>
                    </div>
                  </div>

                  <div className="mt-4">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/70">
                      Recent activity
                    </p>
                    {current.recentPosts.length > 0 ? (
                      <ul className="space-y-1.5">
                        {current.recentPosts.slice(0, 3).map((p) => (
                          <li
                            key={p.slug}
                            className="truncate rounded-full bg-white/12 px-2.5 py-1.5 text-[11px] text-white/90"
                          >
                            {p.title}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[11px] text-white/65">暂无近期文章预览</p>
                    )}
                  </div>

                  <Link
                    href={`/gardens/${current.id}`}
                    className="mt-5 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-full bg-white text-sm font-bold text-[var(--kp-text-1)] shadow-sm transition hover:bg-white/90"
                  >
                    进入花园
                    <svg viewBox="0 0 12 12" className="h-3.5 w-3.5" fill="none" aria-hidden>
                      <path
                        d="M2.5 6h7M6.5 3.5L9.5 6 6.5 8.5"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </Link>
                </motion.div>
              ) : null}
            </div>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
