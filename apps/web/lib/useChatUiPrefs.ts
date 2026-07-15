"use client";

/**
 * useChatUiPrefs —— Chat 三栏 UI 偏好（左/右栏开关、左栏标签、历史子标签、右栏标签）。
 *
 * 【存储持久化群】localStorage 读写合一：原 chat.tsx 两个 effect（mount 水合 + 变化写回）
 * 归并为一个——首轮（未水合）走水合分支 return 不写回；水合引发的 state 更新触发
 * 第二轮起走写回分支。消除了原实现 mount 时「先写默认值再写回水合值」的中间态，
 * 最终持久化内容一致。URL view/panel 参数在水合时优先于 localStorage。
 */

import { useEffect, useRef, useState } from "react";

const CHAT_UI_STORAGE_KEY = "kp-chat-ui-v1";

export type ChatUiPrefs = {
  leftOpen: boolean;
  rightOpen: boolean;
  leftTab: "history" | "async";
  historySubTab: "main" | "sub";
  rightTab: "config" | "runtime";
};

function readChatUiPrefs(): ChatUiPrefs {
  const defaults: ChatUiPrefs = {
    leftOpen: true,
    rightOpen: true,
    leftTab: "history",
    historySubTab: "main",
    rightTab: "config",
  };
  if (typeof window === "undefined") return defaults;
  try {
    const raw = localStorage.getItem(CHAT_UI_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<ChatUiPrefs>;
    return {
      leftOpen: parsed.leftOpen ?? true,
      rightOpen: parsed.rightOpen ?? true,
      leftTab: parsed.leftTab === "async" ? "async" : "history",
      historySubTab: parsed.historySubTab === "sub" ? "sub" : "main",
      rightTab: parsed.rightTab === "runtime" ? "runtime" : "config",
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
  const [rightOpen, setRightOpen] = useState(true);
  // 左栏：history=对话历史，async=异步任务运行记录（追溯，不消费）
  const [leftTab, setLeftTab] = useState<"history" | "async">("history");
  // 对话历史下的子标签页：main=主 Agent，sub=子 Agent
  const [historySubTab, setHistorySubTab] = useState<"main" | "sub">("main");
  // 右栏：config=配置，runtime=待消费的异步队列结果
  const [rightTab, setRightTab] = useState<"config" | "runtime">("config");
  const hydratedRef = useRef(false);

  // 【存储持久化群·读写合一】刷新后恢复面板状态：URL view/panel 优先，否则用
  // localStorage 里用户上次切换后的值。不要根据「当前是不是子会话」去改 view——
  // 用户切到主 Agent 后刷新，应仍停在主 Agent。
  useEffect(() => {
    if (!hydratedRef.current) {
      hydratedRef.current = true;
      const prefs = readChatUiPrefs();
      const view = searchParams.get("view");
      const panel = searchParams.get("panel");
      setLeftOpen(prefs.leftOpen);
      setRightOpen(prefs.rightOpen);
      setLeftTab(panel === "async" || panel === "history" ? panel : prefs.leftTab);
      setHistorySubTab(view === "sub" || view === "main" ? view : prefs.historySubTab);
      setRightTab(prefs.rightTab);
      return;
    }
    writeChatUiPrefs({ leftOpen, rightOpen, leftTab, historySubTab, rightTab });
  }, [searchParams, leftOpen, rightOpen, leftTab, historySubTab, rightTab]);

  return {
    leftOpen,
    setLeftOpen,
    rightOpen,
    setRightOpen,
    leftTab,
    setLeftTab,
    historySubTab,
    setHistorySubTab,
    rightTab,
    setRightTab,
  };
}
