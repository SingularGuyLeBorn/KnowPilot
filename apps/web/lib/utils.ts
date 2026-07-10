import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** 中文相对时间（OpenClaw 会话列表风格） */
export function formatRelativeTime(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date
  const diffMs = Date.now() - d.getTime()
  if (Number.isNaN(diffMs) || diffMs < 0) return "刚刚"
  const sec = Math.floor(diffMs / 1000)
  if (sec < 60) return "刚刚"
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day} 天前`
  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" })
}

export type SessionDateGroup = "today" | "yesterday" | "thisWeekEarlier" | "lastWeek" | "lastMonth" | "older";

const SESSION_GROUP_LABELS: Record<SessionDateGroup, string> = {
  today: "今天",
  yesterday: "昨天",
  thisWeekEarlier: "本周更早",
  lastWeek: "一周之前",
  lastMonth: "一月之前",
  older: "更早",
};

export function getSessionDateGroup(date: string | Date): SessionDateGroup {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const startOfThisWeekEarlier = new Date(startOfYesterday);
  startOfThisWeekEarlier.setDate(startOfThisWeekEarlier.getDate() - 6);
  const startOfLastWeek = new Date(startOfThisWeekEarlier);
  const startOfLastMonth = new Date(startOfToday);
  startOfLastMonth.setDate(startOfLastMonth.getDate() - 30);

  if (d >= startOfToday) return "today";
  if (d >= startOfYesterday) return "yesterday";
  if (d >= startOfThisWeekEarlier) return "thisWeekEarlier";
  if (d >= startOfLastWeek) return "lastWeek";
  if (d >= startOfLastMonth) return "lastMonth";
  return "older";
}

/** 按更新时间将会话分组（今天 / 昨天 / 本周更早 / 一周之前 / 一月之前 / 更早） */
export function groupBySessionDate<T extends { updatedAt: string | Date }>(
  items: T[],
): { key: SessionDateGroup; label: string; items: T[] }[] {
  const order: SessionDateGroup[] = ["today", "yesterday", "thisWeekEarlier", "lastWeek", "lastMonth", "older"];
  const buckets = new Map<SessionDateGroup, T[]>();

  for (const item of items) {
    const key = getSessionDateGroup(item.updatedAt);
    const list = buckets.get(key) ?? [];
    list.push(item);
    buckets.set(key, list);
  }

  return order
    .filter((key) => buckets.has(key))
    .map((key) => ({ key, label: SESSION_GROUP_LABELS[key], items: buckets.get(key)! }));
}
