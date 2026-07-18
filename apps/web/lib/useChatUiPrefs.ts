"use client";

/**
 * useChatUiPrefs — Chat 两栏 UI 偏好（左栏开关、左栏标签、历史子标签）。
 *
 * 【存储持久化群】localStorage 读写合一：
 * - 水合走 useLayoutEffect（paint 前），避免首帧 leftOpen=false → true 时
 *   侧栏从 md:w-0 过渡到 md:w-64 造成「左侧栏长出来叠层」闪烁。
 * - 写回走 useEffect（水合完成后），不把手机叠层 leftOpen 写回桌面偏好。
 *
 * leftTab: history=对话，runtime=运行（投递队列 + Task 追溯）。
 * 旧值 leftTab:"async" / URL ?panel=async 均映射为 runtime。
 * 右栏偏好（rightOpen/rightTab）已拆除，读时忽略、写时不再存。
 *
 * 窄屏（<md）：左栏默认关闭且不把 leftOpen 写回 localStorage，避免手机叠层状态污染桌面偏好。
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";

const CHAT_UI_STORAGE_KEY = "kp-chat-ui-v1";

export type ChatLeftTab = "history" | "runtime";

export type ChatUiPrefs = {
  leftOpen: boolean;
  leftTab: ChatLeftTab;
  historySubTab: "main" | "sub";
};

function isMobileViewport(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(max-width: 767px)").matches;
}

function normalizeLeftTab(raw: unknown, panel?: string | null): ChatLeftTab {
  if (panel === "async" || panel === "runtime") return "runtime";
  if (panel === "history") return "history";
  if (raw === "async" || raw === "runtime") return "runtime";
  return "history";
}

function readChatUiPrefs(): ChatUiPrefs {
  const defaults: ChatUiPrefs = {
    leftOpen: true,
    leftTab: "history",
    historySubTab: "main",
  };
  if (typeof window === "undefined") return defaults;
  try {
    const raw = localStorage.getItem(CHAT_UI_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<ChatUiPrefs> & { leftTab?: string };
    return {
      leftOpen: parsed.leftOpen ?? true,
      leftTab: normalizeLeftTab(parsed.leftTab),
      historySubTab: parsed.historySubTab === "sub" ? "sub" : "main",
    };
  } catch {
    return defaults;
  }
}

function writeChatUiPrefs(prefs: ChatUiPrefs) {
  try {
    localStorage.setItem(CHAT_UI_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

/** 客户端首屏尽量对齐 localStorage，减少 SSR/水合与偏好不一致。 */
function getClientBootstrapPrefs(searchParams: SearchParamsLike): ChatUiPrefs {
  const prefs = readChatUiPrefs();
  const view = searchParams.get("view");
  const panel = searchParams.get("panel");
  return {
    leftOpen: isMobileViewport() ? false : prefs.leftOpen,
    leftTab: normalizeLeftTab(prefs.leftTab, panel),
    historySubTab: view === "sub" || view === "main" ? view : prefs.historySubTab,
  };
}

type SearchParamsLike = Pick<URLSearchParams, "get">;

export function useChatUiPrefs(searchParams: SearchParamsLike) {
  // 桌面默认开栏（与持久化默认一致）。切勿初始化为 false：
  // 否则首帧 md:w-0 + transition，水合后再开栏会「长出来」叠层。
  const [leftOpen, setLeftOpen] = useState(true);
  const [leftTab, setLeftTab] = useState<ChatLeftTab>("history");
  const [historySubTab, setHistorySubTab] = useState<"main" | "sub">("main");
  /** 水合完成前禁止侧栏 width transition，避免偶发偏好修正仍带动画闪一下 */
  const [prefsReady, setPrefsReady] = useState(false);
  const hydratedRef = useRef(false);

  useLayoutEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const boot = getClientBootstrapPrefs(searchParams);
    setLeftOpen(boot.leftOpen);
    setLeftTab(boot.leftTab);
    setHistorySubTab(boot.historySubTab);
    // 下一帧再开 transition，避免本次 leftOpen 修正与 transition 同帧仍被动画
    const raf = requestAnimationFrame(() => setPrefsReady(true));
    return () => cancelAnimationFrame(raf);
  }, [searchParams]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    const stored = readChatUiPrefs();
    writeChatUiPrefs({
      // 手机上的 leftOpen 是叠层临时态，不写回，保留桌面偏好
      leftOpen: isMobileViewport() ? stored.leftOpen : leftOpen,
      leftTab,
      historySubTab,
    });
  }, [leftOpen, leftTab, historySubTab]);

  return {
    leftOpen,
    setLeftOpen,
    leftTab,
    setLeftTab,
    historySubTab,
    setHistorySubTab,
    prefsReady,
  };
}
