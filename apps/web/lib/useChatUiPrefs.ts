"use client";

/**
 * useChatUiPrefs —— Chat 两栏 UI 偏好（左栏开关、左栏标签、历史子标签）。
 *
 * 【存储持久化群】localStorage 读写合一：原 chat.tsx 两个 effect（mount 水合 + 变化写回）
 * 归并为一个——首轮（未水合）走水合分支 return 不写回；水合引发的 state 更新触发
 * 第二轮起走写回分支。消除了原实现 mount 时「先写默认值再写回水合值」的中间态，
 * 最终持久化内容一致。URL view/panel 参数在水合时优先于 localStorage。
 *
 * leftTab: history=对话，runtime=运行（投递队列 + Task 追溯）。
 * 旧值 leftTab:"async" / URL ?panel=async 均映射为 runtime。
 * 右栏偏好（rightOpen/rightTab）已拆除，读时忽略、写时不再存。
 */

import { useEffect, useRef, useState } from "react";

const CHAT_UI_STORAGE_KEY = "kp-chat-ui-v1";

export type ChatLeftTab = "history" | "runtime";

export type ChatUiPrefs = {
  leftOpen: boolean;
  leftTab: ChatLeftTab;
  historySubTab: "main" | "sub";
};

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

type SearchParamsLike = Pick<URLSearchParams, "get">;

export function useChatUiPrefs(searchParams: SearchParamsLike) {
  const [leftOpen, setLeftOpen] = useState(true);
  const [leftTab, setLeftTab] = useState<ChatLeftTab>("history");
  const [historySubTab, setHistorySubTab] = useState<"main" | "sub">("main");
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (!hydratedRef.current) {
      hydratedRef.current = true;
      const prefs = readChatUiPrefs();
      const view = searchParams.get("view");
      const panel = searchParams.get("panel");
      setLeftOpen(prefs.leftOpen);
      setLeftTab(normalizeLeftTab(prefs.leftTab, panel));
      setHistorySubTab(view === "sub" || view === "main" ? view : prefs.historySubTab);
      return;
    }
    writeChatUiPrefs({ leftOpen, leftTab, historySubTab });
  }, [searchParams, leftOpen, leftTab, historySubTab]);

  return {
    leftOpen,
    setLeftOpen,
    leftTab,
    setLeftTab,
    historySubTab,
    setHistorySubTab,
  };
}
