"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { Garden } from "@knowpilot/shared";
import { CurlyMark } from "@/components/home/accentMark";
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

/** 卡片角标：从花园 id / 标题派生，填满「空」感 */
function gardenTags(garden: GardenCard): string[] {
  const id = garden.id.toLowerCase();
  if (id === "posts" || id.includes("blog")) return ["博客", "长文", "公开"];
  if (id === "knowledge" || id.includes("note")) return ["笔记", "蒸馏", "检索"];
  if (id === "resources") return ["素材", "索引", "链接"];
  if (id.includes("interview") || id.includes("面试")) return ["面试", "题集", "刷题"];
  if (id.includes("guide") || id.includes("指南")) return ["指南", "入门", "体系"];
  if (id.includes("daily") || id.includes("碎片")) return ["碎片", "日记", "随记"];
  if (id.includes("rsi")) return ["研究", "递归", "实验"];
  const title = displayGardenTitle(garden.title);
  return [title.slice(0, 4), "本地", "Markdown"].filter(Boolean);
}

function fillLevel(postCount: number): number {
  return Math.min(100, Math.round(18 + postCount * 5.5));
}

/** 自定义图标：书脊/文档；选中态不用描边方框，避免绿卡上冒出「白框」 */
function CardGlyph({ className, solid }: { className?: string; solid?: boolean }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" aria-hidden>
      {solid ? (
        <>
          <rect x="7" y="5" width="18" height="22" rx="3" fill="currentColor" fillOpacity="0.22" />
          <path d="M11 11h10M11 15h8M11 19h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.9" />
        </>
      ) : (
        <>
          <rect x="7" y="5" width="18" height="22" rx="3" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.08" />
          <path d="M11 11h10M11 15h8M11 19h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

/** 命中检测用基准 X（不含选中推开），避免 active 循环依赖 */
function baseSlotX(index: number, total: number, compact: boolean): number {
  const mid = (total - 1) / 2;
  const step = compact ? 56 + 14 : 68 + 18;
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

/** 软弹簧：低刚度 + 高阻尼，悬停切换不「啪」一下 */
const FAN_SPRING = { type: "spring" as const, stiffness: 140, damping: 22, mass: 1.05 };
const FAN_SPRING_SOFT = { type: "spring" as const, stiffness: 110, damping: 20, mass: 1.1 };
const PANEL_EASE = [0.22, 1, 0.36, 1] as const;

/**
 * 槽位姿态：展开时选中卡浮起，邻卡向两侧让开。
 * 全程单层挂载 + spring，禁止选中卡 remount（remount = 生硬根因）。
 * 倾角适中 + 不透明底 + 侧卡降透明度，兼顾顺滑与不穿白线。
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
  const abs = Math.abs(dist);

  if (!expanded) {
    return {
      x: t * (compact ? 14 : 18),
      y: 20 + Math.abs(t) * 3,
      z: -Math.abs(t) * 8,
      rotateY: -52,
      rotateZ: t * 1.2,
      rotateX: 6,
      scale: 0.92,
      opacity: 0.92,
    };
  }

  const step = compact ? 56 : 68;
  const push = dist === 0 ? 0 : Math.sign(dist) * (compact ? 28 : 36) * abs;
  const isActive = dist === 0;

  return {
    x: t * step + push,
    y: isActive ? -22 : 4 + abs * 3 + Math.abs(t) * 1.5,
    z: isActive ? 80 : -24 - abs * 18,
    // 轻倾角保留扇形感，又不至于穿面
    rotateY: isActive ? 0 : (dist < 0 ? 18 : -18) + t * 0.8,
    rotateZ: isActive ? 0 : t * 0.35,
    rotateX: isActive ? 0 : 4,
    scale: isActive ? 1.12 : Math.max(0.82, 0.94 - abs * 0.04),
    opacity: isActive ? 1 : Math.max(0.55, 0.88 - abs * 0.1),
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
  const cardW = compact ? 118 : 138;
  const cardH = compact ? 248 : 288;
  const zIndex = selected ? total + 40 : total - Math.abs(index - activeIndex);
  const idLabel = formatGardenId(garden.id);
  const title = displayGardenTitle(garden.title);
  const tags = gardenTags(garden);
  const level = fillLevel(garden.postCount);
  const recent = garden.recentPosts.slice(0, selected ? 3 : 2);
  const spring = reducedMotion ? { duration: 0 } : selected ? FAN_SPRING : FAN_SPRING_SOFT;

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
        transformPerspective: 1200,
        pointerEvents: "none",
        willChange: "transform, opacity",
      }}
      initial={false}
      animate={{
        x: pose.x,
        y: pose.y,
        z: pose.z,
        rotateY: pose.rotateY,
        rotateZ: pose.rotateZ,
        rotateX: pose.rotateX,
        scale: pose.scale,
        opacity: pose.opacity,
      }}
      transition={spring}
      aria-hidden
    >
      <motion.div
        className={cn(
          "relative h-full w-full overflow-hidden rounded-[1.15rem] text-left",
          selected ? "text-white" : "text-[var(--kp-text-1)]",
        )}
        style={{
          backgroundColor: selected ? style.deep : "#ffffff",
          backgroundImage: selected
            ? style.fill
            : `linear-gradient(165deg, #ffffff 0%, color-mix(in srgb, ${style.soft} 55%, #ffffff) 48%, #f7fafc 100%)`,
          backgroundRepeat: "no-repeat",
          backfaceVisibility: "hidden",
          WebkitBackfaceVisibility: "hidden",
          isolation: "isolate",
        }}
        initial={false}
        animate={{
          boxShadow: selected
            ? `0 32px 56px -12px ${style.glow}, 0 12px 28px -16px rgba(0,40,80,0.35)`
            : `0 14px 32px -18px rgba(0,80,160,0.22), 0 0 0 1px color-mix(in srgb, ${style.solid} 12%, transparent)`,
        }}
        transition={spring}
      >
        {!selected && (
          <>
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-3 left-0 w-[3px] rounded-full"
              style={{ background: `linear-gradient(180deg, ${style.solid}, ${style.deep})` }}
            />
            <span
              aria-hidden
              className="pointer-events-none absolute -right-4 -top-6 h-20 w-20 rounded-full opacity-70 blur-2xl"
              style={{ background: style.soft }}
            />
          </>
        )}
        {selected && (
          <>
            <motion.span
              aria-hidden
              className="pointer-events-none absolute -left-8 -top-10 h-32 w-32 rounded-full blur-3xl"
              style={{ background: "rgba(255,255,255,0.3)" }}
              animate={{ opacity: [0.28, 0.45, 0.28], scale: [1, 1.08, 1] }}
              transition={
                reducedMotion
                  ? { duration: 0 }
                  : { duration: 3.2, repeat: Infinity, ease: "easeInOut" }
              }
            />
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-3 top-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent"
            />
          </>
        )}

        <div className="relative flex h-full flex-col px-2.5 pb-2.5 pt-2.5">
          {/* 顶栏：序号 + id + 图标 */}
          <div className="flex items-start justify-between gap-1">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <span
                  className={cn(
                    "inline-flex h-4 min-w-4 items-center justify-center rounded px-1 text-[8px] font-bold tabular-nums",
                    selected ? "bg-white/20 text-white" : "bg-[#eef4fb] text-[var(--kp-brand)]",
                  )}
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span
                  className={cn(
                    "inline-flex max-w-[78%] items-center truncate rounded-full px-1.5 py-0.5 text-[8px] font-bold tracking-wide",
                    selected
                      ? "bg-black/20 text-white"
                      : "bg-[#f3f7fb] text-[var(--kp-brand-deep)]",
                  )}
                >
                  <span className="mr-0.5 opacity-70">{"{"}</span>
                  {idLabel}
                  <span className="ml-0.5 opacity-70">{"}"}</span>
                </span>
              </div>
              <p
                className={cn(
                  "mt-1.5 line-clamp-2 text-[12px] font-black leading-snug tracking-tight",
                  selected ? "text-white" : "text-[var(--kp-text-1)]",
                )}
                title={title}
              >
                {title}
              </p>
            </div>
            <CardGlyph
              solid={selected}
              className={cn("mt-0.5 h-4 w-4 shrink-0 opacity-90", selected ? "text-white" : "text-[var(--kp-brand)]")}
            />
          </div>

          {/* 篇数 + 进度 */}
          <div
            className={cn(
              "mt-2 rounded-lg px-2 py-1.5",
              selected ? "bg-black/20" : "bg-[#f3f7fb]",
            )}
          >
            <div
              className={cn(
                "flex w-full items-center justify-between text-[9px] font-semibold tabular-nums",
                selected ? "text-white" : "text-[var(--kp-text-2)]",
              )}
            >
              <span>[{garden.postCount}] 篇</span>
              <span className={selected ? "text-white/75" : "text-[var(--kp-text-3)]"}>{level}%</span>
            </div>
            <div
              className={cn(
                "mt-1.5 h-1 w-full overflow-hidden rounded-full",
                selected ? "bg-black/25" : "bg-black/8",
              )}
            >
              <motion.div
                className="h-full rounded-full"
                style={{ background: selected ? "rgba(255,255,255,0.85)" : style.solid }}
                initial={false}
                animate={{ width: `${level}%` }}
                transition={spring}
              />
            </div>
          </div>

          {/* 标签 */}
          <div className="mt-2 flex flex-wrap gap-1">
            {tags.slice(0, selected ? 3 : 2).map((tag) => (
              <span
                key={tag}
                className={cn(
                  "rounded px-1.5 py-0.5 text-[8px] font-semibold",
                  selected
                    ? "bg-white/15 text-white/90"
                    : "bg-white text-[var(--kp-text-2)] shadow-[inset_0_0_0_1px_rgba(0,80,160,0.1)]",
                )}
              >
                {tag}
              </span>
            ))}
          </div>

          {/* 简介：选中多行，侧卡一行 */}
          <p
            className={cn(
              "mt-2 text-[9px] leading-snug",
              selected
                ? "line-clamp-2 text-white/85"
                : "line-clamp-2 text-[var(--kp-text-3)]",
            )}
          >
            {garden.description}
          </p>

          {/* 近期文章列表：填满中部空白 */}
          <div
            className={cn(
              "mt-2 min-h-0 flex-1 rounded-lg px-1.5 py-1.5",
              selected ? "bg-black/15" : "bg-white/70",
            )}
          >
            <p
              className={cn(
                "mb-1 text-[8px] font-semibold uppercase tracking-[0.1em]",
                selected ? "text-white/65" : "text-[var(--kp-text-3)]",
              )}
            >
              Recent
            </p>
            {recent.length > 0 ? (
              <ul className="space-y-1">
                {recent.map((p, i) => (
                  <li
                    key={p.slug}
                    className={cn(
                      "flex items-start gap-1 text-[8.5px] leading-snug",
                      selected ? "text-white/90" : "text-[var(--kp-text-2)]",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-px flex h-3 w-3 shrink-0 items-center justify-center rounded text-[7px] font-bold tabular-nums",
                        selected ? "bg-white/20" : "bg-[#eef4fb] text-[var(--kp-brand)]",
                      )}
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0 line-clamp-2">{p.title}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="space-y-1">
                {[0, 1].map((i) => (
                  <div
                    key={i}
                    className={cn(
                      "h-2 rounded",
                      selected ? "bg-white/15" : "bg-[var(--kp-divider)]",
                    )}
                    style={{ width: `${72 - i * 18}%` }}
                  />
                ))}
                <p
                  className={cn(
                    "pt-0.5 text-[8px]",
                    selected ? "text-white/55" : "text-[var(--kp-text-3)]",
                  )}
                >
                  暂无近期文章
                </p>
              </div>
            )}
          </div>

          {/* 底栏：路径暗示 */}
          <div
            className={cn(
              "mt-2 flex items-center justify-between border-t pt-1.5 text-[8px] font-medium",
              selected ? "border-white/20 text-white/75" : "border-black/5 text-[var(--kp-text-3)]",
            )}
          >
            <span className="truncate">content/{garden.id}</span>
            <span className={selected ? "text-white" : "text-[var(--kp-brand)]"}>→</span>
          </div>
        </div>
      </motion.div>

      <motion.div
        aria-hidden
        className="absolute -bottom-5 left-1/2 h-7 w-[72%] -translate-x-1/2 rounded-full blur-xl"
        style={{ background: style.glow }}
        initial={false}
        animate={{
          opacity: selected ? 0.65 : 0.1,
          scaleX: selected ? 1.08 : 0.9,
        }}
        transition={spring}
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
        <ScrollReveal className="mb-8">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--kp-brand)]">
            Gardens
          </p>
          <h2 className="text-2xl font-bold tracking-tight text-[var(--kp-text-1)] md:text-3xl">
            知识库 <CurlyMark>收纳盒</CurlyMark>
          </h2>
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

              {/* 滑动暗示弧线：轻微呼吸，提示可扫 */}
              <motion.div
                className="pointer-events-none relative mx-auto mt-2 h-6 w-[55%]"
                aria-hidden
                animate={reduced ? undefined : { opacity: [0.35, 0.65, 0.35] }}
                transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
              >
                <svg viewBox="0 0 200 24" className="h-full w-full text-[var(--kp-text-3)]">
                  <path
                    d="M10 16 Q100 2 190 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeDasharray="3 4"
                  />
                  <path d="M8 14l-4 2 4 2M192 14l4 2-4 2" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              </motion.div>

              <div
                className="relative mx-auto h-[380px] w-full max-w-3xl cursor-pointer sm:h-[420px]"
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

                {/* 单层挂载：切换 active 只改 spring 目标，不 remount */}
                <div
                  className="pointer-events-none absolute inset-0"
                  style={{ transformStyle: "preserve-3d", perspective: 1200 }}
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

            {/* 右侧详情：底色柔过渡 + 内容交叉淡入 */}
            <motion.div
              className="relative flex h-full min-h-[320px] flex-col overflow-hidden rounded-[1.75rem] p-5 text-white"
              initial={false}
              animate={{
                backgroundColor: currentStyle?.deep ?? "#1f6f56",
                boxShadow: `0 28px 60px -18px ${currentStyle?.glow ?? "rgba(0,80,160,0.35)"}`,
              }}
              transition={reduced ? { duration: 0 } : FAN_SPRING_SOFT}
              style={{
                backgroundImage: currentStyle?.fill,
                backgroundRepeat: "no-repeat",
              }}
            >
              <motion.div
                aria-hidden
                className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-white/20 blur-3xl"
                animate={reduced ? undefined : { x: [0, 8, 0], y: [0, -6, 0] }}
                transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
              />
              <div
                aria-hidden
                className="pointer-events-none absolute -bottom-16 -left-10 h-40 w-40 rounded-full bg-black/25 blur-3xl"
              />
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-white/10 to-transparent"
              />
              <AnimatePresence mode="wait">
                {current && currentStyle ? (
                  <motion.div
                    key={current.id}
                    className="relative flex flex-1 flex-col"
                    initial={reduced ? false : { opacity: 0, y: 14, filter: "blur(4px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    exit={reduced ? undefined : { opacity: 0, y: -10, filter: "blur(3px)" }}
                    transition={
                      reduced ? { duration: 0 } : { duration: 0.38, ease: PANEL_EASE }
                    }
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/70">
                        Selected Garden
                      </p>
                      <motion.span
                        className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold text-white/85"
                        animate={reduced ? undefined : { opacity: [0.75, 1, 0.75] }}
                        transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
                      >
                        LIVE
                      </motion.span>
                    </div>
                    <h3 className="mt-1 text-xl font-black tracking-tight">
                      <span className="opacity-70">{"{"}</span> {displayGardenTitle(current.title)}{" "}
                      <span className="opacity-70">{"}"}</span>
                    </h3>
                    <p className="mt-1.5 inline-flex items-center rounded-full bg-black/15 px-2.5 py-0.5 text-xs text-white/90">
                      [{formatGardenId(current.id)}]
                    </p>
                    <p className="mt-3 text-sm leading-relaxed text-white/90">{current.description}</p>

                    <div className="mt-5 grid grid-cols-2 gap-2">
                      <motion.div
                        className="rounded-xl bg-black/15 px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]"
                        initial={reduced ? false : { scale: 0.96, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ delay: 0.05, duration: 0.3, ease: PANEL_EASE }}
                      >
                        <p className="text-[10px] text-white/70">文章</p>
                        <p className="text-2xl font-black tabular-nums">{current.postCount}</p>
                      </motion.div>
                      <motion.div
                        className="rounded-xl bg-black/15 px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]"
                        initial={reduced ? false : { scale: 0.96, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ delay: 0.1, duration: 0.3, ease: PANEL_EASE }}
                      >
                        <p className="text-[10px] text-white/70">近期</p>
                        <p className="text-2xl font-black tabular-nums">{current.recentPosts.length}</p>
                      </motion.div>
                    </div>

                    <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-black/20">
                      <motion.div
                        className="h-full rounded-full bg-white/80"
                        initial={false}
                        animate={{
                          width: `${Math.min(100, 12 + current.postCount * 4)}%`,
                        }}
                        transition={reduced ? { duration: 0 } : FAN_SPRING}
                      />
                    </div>

                    <div className="mt-4 flex-1">
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/70">
                        Recent activity
                      </p>
                      {current.recentPosts.length > 0 ? (
                        <ul className="w-full space-y-1.5">
                          {current.recentPosts.slice(0, 3).map((p, i) => (
                            <motion.li
                              key={p.slug}
                              className="flex w-full items-center gap-2 truncate rounded-xl bg-black/15 px-2.5 py-1.5 text-[11px] text-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
                              initial={reduced ? false : { opacity: 0, x: 10 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{
                                delay: 0.08 + i * 0.06,
                                duration: 0.32,
                                ease: PANEL_EASE,
                              }}
                            >
                              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-white/15 text-[10px] font-bold tabular-nums">
                                {i + 1}
                              </span>
                              <span className="min-w-0 truncate">{p.title}</span>
                            </motion.li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-[11px] text-white/65">暂无近期文章预览</p>
                      )}
                    </div>

                    <Link
                      href={`/gardens/${current.id}`}
                      className="mt-5 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-full bg-white text-sm font-bold text-[var(--kp-text-1)] shadow-[0_8px_24px_-8px_rgba(0,0,0,0.35)] transition hover:bg-white/92 hover:shadow-[0_12px_28px_-8px_rgba(0,0,0,0.4)]"
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
              </AnimatePresence>
            </motion.div>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
