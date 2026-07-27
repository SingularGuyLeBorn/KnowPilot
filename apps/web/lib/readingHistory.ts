"use client";

import { useCallback, useSyncExternalStore } from "react";
import { postDetailHref } from "@/lib/postHref";

const STORAGE_KEY = "kp-reading-history";
const MAX_ENTRIES = 40;
const listeners = new Set<() => void>();

/** SSR / 空态稳定引用，禁止 getServerSnapshot 每次 new [] */
const EMPTY_HISTORY: ReadingHistoryEntry[] = [];

export interface ReadingHistoryEntry {
  postId: string;
  slug: string;
  garden: string;
  title: string;
  /** 0–1，相对文章正文可滚动高度 */
  progress: number;
  /** 主滚动容器 scrollTop（相对文档内容区） */
  scrollTop: number;
  updatedAt: number;
}

/** 与 localStorage 原始串对齐的缓存，保证 getSnapshot 引用稳定 */
let cachedRaw: string | null | undefined = undefined;
let cachedEntries: ReadingHistoryEntry[] = EMPTY_HISTORY;
let cachedSorted: ReadingHistoryEntry[] = EMPTY_HISTORY;

function emit() {
  for (const l of listeners) l();
}

function invalidateCache() {
  cachedRaw = undefined;
}

function parseEntries(raw: string | null): ReadingHistoryEntry[] {
  if (!raw) return EMPTY_HISTORY;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return EMPTY_HISTORY;
    const list = parsed.filter(
      (e): e is ReadingHistoryEntry =>
        !!e &&
        typeof e === "object" &&
        typeof (e as ReadingHistoryEntry).postId === "string" &&
        typeof (e as ReadingHistoryEntry).slug === "string" &&
        typeof (e as ReadingHistoryEntry).garden === "string" &&
        typeof (e as ReadingHistoryEntry).title === "string" &&
        typeof (e as ReadingHistoryEntry).progress === "number" &&
        typeof (e as ReadingHistoryEntry).scrollTop === "number" &&
        typeof (e as ReadingHistoryEntry).updatedAt === "number",
    );
    return list.length === 0 ? EMPTY_HISTORY : list;
  } catch {
    return EMPTY_HISTORY;
  }
}

function ensureCache(): void {
  if (typeof window === "undefined") {
    cachedRaw = null;
    cachedEntries = EMPTY_HISTORY;
    cachedSorted = EMPTY_HISTORY;
    return;
  }
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (raw === cachedRaw) return;
  cachedRaw = raw;
  cachedEntries = parseEntries(raw);
  if (cachedEntries === EMPTY_HISTORY) {
    cachedSorted = EMPTY_HISTORY;
    return;
  }
  cachedSorted = [...cachedEntries].sort((a, b) => b.updatedAt - a.updatedAt);
}

function readAll(): ReadingHistoryEntry[] {
  ensureCache();
  return cachedEntries;
}

function writeAll(entries: ReadingHistoryEntry[]) {
  const next = entries.slice(0, MAX_ENTRIES);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  invalidateCache();
  ensureCache();
  emit();
}

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) {
      invalidateCache();
      onStoreChange();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** 进度是否值得恢复（开了头、且未读完） */
export function shouldRestoreProgress(entry: ReadingHistoryEntry): boolean {
  return entry.progress >= 0.04 && entry.progress < 0.92 && entry.scrollTop > 40;
}

export function getReadingHistory(): ReadingHistoryEntry[] {
  ensureCache();
  return cachedSorted;
}

export function getLastRead(garden?: string | null): ReadingHistoryEntry | null {
  const list = getReadingHistory();
  if (!garden) return list[0] ?? null;
  return list.find((e) => e.garden === garden) ?? null;
}

export function getEntryByPostId(postId: string): ReadingHistoryEntry | null {
  return readAll().find((e) => e.postId === postId) ?? null;
}

export function upsertReadingProgress(input: {
  postId: string;
  slug: string;
  garden: string;
  title: string;
  progress: number;
  scrollTop: number;
}): void {
  const progress = Math.min(1, Math.max(0, input.progress));
  const next: ReadingHistoryEntry = {
    postId: input.postId,
    slug: input.slug,
    garden: input.garden,
    title: input.title,
    progress,
    scrollTop: Math.max(0, Math.round(input.scrollTop)),
    updatedAt: Date.now(),
  };
  const prev = readAll().filter((e) => e.postId !== input.postId);
  writeAll([next, ...prev]);
}

export function clearReadingEntry(postId: string): void {
  writeAll(readAll().filter((e) => e.postId !== postId));
}

export function readingEntryHref(entry: ReadingHistoryEntry): string {
  return postDetailHref(entry.slug, entry.garden);
}

function getServerHistorySnapshot(): ReadingHistoryEntry[] {
  return EMPTY_HISTORY;
}

function getServerLastReadSnapshot(): null {
  return null;
}

export function useReadingHistory(): ReadingHistoryEntry[] {
  return useSyncExternalStore(subscribe, getReadingHistory, getServerHistorySnapshot);
}

export function useLastRead(garden?: string | null): ReadingHistoryEntry | null {
  const getSnapshot = useCallback(() => getLastRead(garden), [garden]);
  return useSyncExternalStore(subscribe, getSnapshot, getServerLastReadSnapshot);
}

/** 查找 Shell 主滚动容器 */
export function getMainScrollEl(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLElement>("[data-kp-main-scroll]");
}
