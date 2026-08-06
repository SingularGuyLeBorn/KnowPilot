"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { keepPreviousData } from "@tanstack/react-query";
import { CurlyMark, SquareMark } from "@/components/home/accentMark";
import { ScrollReveal } from "@/components/magicui/scroll-reveal";
import { formatGardenId } from "@/lib/gardenDisplay";
import { postDetailHref } from "@/lib/postHref";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

export type ActivityDay = { date: string; count: number };

export type ActivityCalendarData = {
  days: ActivityDay[];
  totalUpdates: number;
  activeDays: number;
  startDate: string;
  endDate: string;
};

const LEVEL_CLASS = [
  "bg-black/[0.07]",
  "bg-[var(--kp-brand)]/25",
  "bg-[var(--kp-brand)]/45",
  "bg-[var(--kp-brand)]/70",
  "bg-[var(--kp-brand)]",
] as const;

const WEEKDAY_LABELS = ["", "一", "", "三", "", "五", ""];
const MONTH_SHORT = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

function levelFor(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (max <= 1) return 1;
  const r = count / max;
  if (r <= 0.25) return 1;
  if (r <= 0.5) return 2;
  if (r <= 0.75) return 3;
  return 4;
}

function parseLocalDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatTipDate(key: string): string {
  const d = parseLocalDate(key);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString("zh-CN");
}

function buildWeeks(days: ActivityDay[]): ActivityDay[][] {
  const weeks: ActivityDay[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }
  return weeks;
}

function monthLabels(weeks: ActivityDay[][]): Array<{ label: string; col: number }> {
  const labels: Array<{ label: string; col: number }> = [];
  let prevMonth = -1;
  weeks.forEach((week, col) => {
    const first = week[0];
    if (!first) return;
    const month = parseLocalDate(first.date).getMonth();
    if (month !== prevMonth) {
      labels.push({ label: MONTH_SHORT[month], col });
      prevMonth = month;
    }
  });
  return labels;
}

type DayPost = { id: string; garden: string; slug: string; title: string };

function PostList({
  title,
  tone,
  items,
  empty,
}: {
  title: string;
  tone: "created" | "updated" | "deleted";
  items: DayPost[];
  empty: string;
}) {
  const toneClass =
    tone === "created"
      ? "text-[#1f6f56] bg-[#2f9f7a]/10 border-[#2f9f7a]/25"
      : tone === "updated"
        ? "text-[var(--kp-brand-deep)] bg-[var(--kp-brand-soft)] border-[var(--kp-brand)]/25"
        : "text-[var(--kp-text-3)] bg-black/[0.04] border-[var(--kp-divider)]";
  const linkable = tone !== "deleted";

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", toneClass)}>
          {title}
        </span>
        <span className="text-[10px] tabular-nums text-[var(--kp-text-3)]">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-[11px] text-[var(--kp-text-3)]">{empty}</p>
      ) : (
        <ul className="max-h-24 space-y-1 overflow-y-auto pr-0.5">
          {items.map((p) => {
            const inner = (
              <>
                <span className="mr-1 shrink-0 text-[10px] text-[var(--kp-text-3)]">
                  {formatGardenId(p.garden)}/
                </span>
                {p.title}
              </>
            );
            const cls =
              "block truncate rounded-lg border border-white/60 bg-white/70 px-2 py-1 text-[11px] text-[var(--kp-text-2)]";
            return (
              <li key={p.id}>
                {linkable ? (
                  <Link
                    href={postDetailHref(p.slug, p.garden)}
                    className={cn(cls, "transition-colors hover:border-[var(--kp-brand)]/35 hover:text-[var(--kp-brand)]")}
                    title={p.title}
                  >
                    {inner}
                  </Link>
                ) : (
                  <span className={cn(cls, "opacity-80")} title={`${p.title}（已删除）`}>
                    {inner}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const EMPTY_DAY = {
  created: [] as DayPost[],
  updated: [] as DayPost[],
  deleted: [] as DayPost[],
  tokens: { total: 0, prompt: 0, completion: 0, runCount: 0, messageCount: 0 },
};

function DayDetailPanel({
  date,
  count,
}: {
  date: string | null;
  count: number;
}) {
  const enabled = !!date;
  const { data, isError, isPlaceholderData } = trpc.post.activityDayDetail.useQuery(
    { date: date ?? "1970-01-01", publishedOnly: true },
    {
      enabled,
      staleTime: 30_000,
      // 切日时保留上一份详情，禁止「加载中…」中间态
      placeholderData: keepPreviousData,
    },
  );

  if (!date) return null;

  // 首屏无数据时直接用空结构占位，布局与终态一致，不出现加载文案
  const view = data ?? EMPTY_DAY;
  const stale = isPlaceholderData && !!data;

  return (
    <div
      className={cn(
        "rounded-xl bg-white/65 p-3.5 shadow-[0_8px_24px_-16px_rgba(0,80,160,0.18)] backdrop-blur-md transition-opacity duration-200 sm:p-4",
        stale && "opacity-70",
      )}
      style={{ boxShadow: "0 8px 24px -16px rgba(0,80,160,0.18), inset 0 0 0 1px rgba(0,0,0,0.05)" }}
    >
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2 border-b border-black/[0.05] pb-2.5">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--kp-text-3)]">
            {"{"} 当日详情 {"}"}
          </p>
          <p className="text-sm font-bold text-[var(--kp-text-1)]">{formatTipDate(date)}</p>
        </div>
        <span className="rounded-full bg-[var(--kp-brand-soft)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--kp-brand-deep)]">
          [{count}]
        </span>
      </div>

      {isError ? (
        <p className="text-[11px] text-red-500/80">详情加载失败，请稍后重试</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <PostList title="新增" tone="created" items={view.created} empty="当日无新增文章" />
          <PostList title="更新" tone="updated" items={view.updated} empty="当日无更新文章" />
          <PostList title="删除" tone="deleted" items={view.deleted} empty="当日无删除文章" />

          <div
            className="rounded-xl bg-[var(--kp-brand-soft)]/70 px-3 py-2.5"
            style={{ boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--kp-brand) 18%, transparent)" }}
          >
            <p className="text-[10px] font-semibold tracking-wide text-[var(--kp-brand)]">
              {"{"} Token {"}"}
            </p>
            {view.tokens.total > 0 ? (
              <>
                <p className="mt-0.5 text-xl font-black tabular-nums text-[var(--kp-text-1)]">
                  {formatTokens(view.tokens.total)}
                  <span className="ml-1 text-xs font-semibold text-[var(--kp-text-3)]">tokens</span>
                </p>
                <p className="mt-1 text-[10px] leading-relaxed text-[var(--kp-text-3)]">
                  prompt {formatTokens(view.tokens.prompt)} · completion{" "}
                  {formatTokens(view.tokens.completion)}
                  {view.tokens.runCount > 0
                    ? ` · ${view.tokens.runCount} 次 Run`
                    : view.tokens.messageCount > 0
                      ? ` · ${view.tokens.messageCount} 条消息`
                      : null}
                </p>
              </>
            ) : (
              <p className="mt-0.5 text-[11px] text-[var(--kp-text-3)]">暂无 token 记录</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function defaultSelectedDay(days: ActivityDay[]): { date: string; count: number } | null {
  if (days.length === 0) return null;
  const lastActive = [...days].reverse().find((d) => d.count > 0);
  const pick = lastActive ?? days[days.length - 1];
  return pick ? { date: pick.date, count: pick.count } : null;
}

export function ArticleUpdateCalendar({ data }: { data: ActivityCalendarData | null }) {
  const [tip, setTip] = useState<{ date: string; count: number; x: number; y: number } | null>(null);
  const [selectedOverride, setSelectedOverride] = useState<{ date: string; count: number } | null>(null);

  const { weeks, max, months } = useMemo(() => {
    const days = data?.days ?? [];
    const weeks = buildWeeks(days);
    const max = days.reduce((m, d) => Math.max(m, d.count), 0);
    return { weeks, max, months: monthLabels(weeks) };
  }, [data]);

  const selected = selectedOverride ?? (data ? defaultSelectedDay(data.days) : null);

  if (!data || data.days.length === 0) {
    return null;
  }

  return (
    <section className="relative overflow-hidden px-6 py-10 lg:px-12 lg:py-12">
      <div className="relative z-10 mx-auto max-w-7xl">
        <ScrollReveal className="mb-5">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--kp-brand)]">
            Activity
          </p>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-2xl font-bold tracking-tight text-[var(--kp-text-1)] md:text-3xl">
              文章更新 <CurlyMark>日历</CurlyMark>
            </h2>
            <SquareMark className="text-xs font-semibold">{data.totalUpdates} 次</SquareMark>
          </div>
          <p className="mt-1.5 text-sm text-[var(--kp-text-2)]">
            点选日期，下方查看新增、更新、删除与 token
          </p>
        </ScrollReveal>

        <ScrollReveal delay={0.06}>
          <div className="rounded-2xl border border-white/55 bg-white/45 p-4 shadow-[0_12px_40px_-20px_rgba(0,80,160,0.18)] backdrop-blur-xl sm:p-5">
            <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--kp-text-3)]">
              <span className="rounded-full border border-white/70 bg-white/60 px-2.5 py-0.5">
                <span className="font-semibold text-[var(--kp-text-1)]">{data.totalUpdates}</span> 次更新
              </span>
              <span className="rounded-full border border-white/70 bg-white/60 px-2.5 py-0.5">
                <span className="font-semibold text-[var(--kp-text-1)]">{data.activeDays}</span> 个活跃日
              </span>
              <span className="tabular-nums">
                {data.startDate} → {data.endDate}
              </span>
            </div>

            {/* 上：日历占满整行 · 下：当日详情 */}
            <div className="flex flex-col gap-4">
              <div className="min-w-0">
                <div className="min-w-0 overflow-x-auto">
                  <div className="inline-flex min-w-full flex-col gap-1">
                    <div className="relative mb-1 ml-6 h-4">
                      {months.map((m) => (
                        <span
                          key={`${m.label}-${m.col}`}
                          className="absolute top-0 text-[10px] font-medium text-[var(--kp-text-3)]"
                          style={{ left: `calc(${m.col} * (11px + 3px))` }}
                        >
                          {m.label}
                        </span>
                      ))}
                    </div>

                    <div className="flex gap-1">
                      <div className="flex w-5 shrink-0 flex-col gap-[3px]">
                        {WEEKDAY_LABELS.map((label, i) => (
                          <div
                            key={i}
                            className="flex h-[11px] items-center text-[9px] leading-none text-[var(--kp-text-3)]"
                          >
                            {label}
                          </div>
                        ))}
                      </div>

                      <div className="flex gap-[3px]">
                        {weeks.map((week, wi) => (
                          <div key={wi} className="flex flex-col gap-[3px]">
                            {week.map((day) => {
                              const level = levelFor(day.count, max);
                              const future = parseLocalDate(day.date).getTime() > Date.now();
                              const isSelected = selected?.date === day.date;
                              return (
                                <button
                                  key={day.date}
                                  type="button"
                                  disabled={future}
                                  aria-label={`${formatTipDate(day.date)}：${day.count} 次更新`}
                                  aria-pressed={isSelected}
                                  className={cn(
                                    "h-[11px] w-[11px] rounded-[2px] transition-[transform,box-shadow] duration-150",
                                    future ? "bg-transparent" : LEVEL_CLASS[level],
                                    !future && "hover:scale-125 hover:ring-1 hover:ring-[var(--kp-brand)]/40",
                                    isSelected && "ring-2 ring-[var(--kp-brand)] ring-offset-1 ring-offset-white/80",
                                  )}
                                  onMouseEnter={(e) => {
                                    if (future) return;
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    setTip({
                                      date: day.date,
                                      count: day.count,
                                      x: rect.left + rect.width / 2,
                                      y: rect.top,
                                    });
                                  }}
                                  onMouseLeave={() => setTip(null)}
                                  onClick={() => {
                                    if (future) return;
                                    setSelectedOverride({ date: day.date, count: day.count });
                                  }}
                                />
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-2 flex items-center gap-1.5 text-[10px] text-[var(--kp-text-3)]">
                  <span>少</span>
                  {LEVEL_CLASS.map((cls, i) => (
                    <span key={i} className={cn("h-[11px] w-[11px] rounded-[2px]", cls)} />
                  ))}
                  <span>多</span>
                </div>
              </div>

              <DayDetailPanel date={selected?.date ?? null} count={selected?.count ?? 0} />
            </div>

            {tip && (
              <div
                className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-[calc(100%+8px)] rounded-lg border border-white/70 bg-[var(--kp-text-1)] px-2.5 py-1.5 text-[11px] text-white shadow-lg"
                style={{ left: tip.x, top: tip.y }}
              >
                <span className="font-semibold">
                  {tip.count === 0 ? "无更新" : `${tip.count} 次更新`}
                </span>
                <span className="ml-1.5 opacity-80">{formatTipDate(tip.date)}</span>
                <span className="ml-1.5 opacity-60">· 点击查看</span>
              </div>
            )}
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
