"use client";

/**
 * Chat 标签页 + 分屏 —— React 绑定层。
 * 状态机在 chatTabsState；此处负责 sessionStorage 持久化与派生焦点 id。
 */

import { useCallback, useEffect, useMemo, useReducer } from "react";
import {
  CHAT_TABS_STORAGE_KEY,
  chatTabsReducer,
  createEmptyChatTabsState,
  getFocusedSessionId,
  getVisibleSessionIds,
  parseChatTabsStorage,
  serializeChatTabsState,
  type ChatPaneSlot,
  type ChatTabsAction,
  type ChatTabsState,
} from "@/lib/chatTabsState";

export interface UseChatTabsResult {
  tabs: ChatTabsState;
  focusedSessionId: string | null;
  visibleSessionIds: string[];
  /** sessionStorage 水合完成；此前勿按「无会话」去 ensureMain，否则会擦掉恢复中的 tabs */
  tabsHydrated: boolean;
  openTab: (sessionId: string, pane?: ChatPaneSlot) => void;
  openInOtherPane: (sessionId: string) => void;
  focusTab: (sessionId: string) => void;
  focusPane: (pane: ChatPaneSlot) => void;
  closeTab: (sessionId: string) => void;
  enterSplit: (otherSessionId?: string) => void;
  exitSplit: () => void;
  bindPane: (pane: ChatPaneSlot, sessionId: string | null) => void;
  startNewChatInTabs: () => void;
  /** 深链 / URL 同步：确保 session 在 tabs 中并聚焦 */
  ensureFocusedSession: (sessionId: string) => void;
  /** 恢复分屏另一侧（来自 URL ?split=） */
  ensureSplitWith: (otherSessionId: string) => void;
}

type TabsHookState = {
  tabs: ChatTabsState;
  storageReady: boolean;
};

type TabsHookAction =
  | ChatTabsAction
  | { type: "STORAGE_HYDRATE"; state: ChatTabsState | null };

function createInitialTabsHookState(): TabsHookState {
  return { tabs: createEmptyChatTabsState(), storageReady: false };
}

function tabsHookReducer(state: TabsHookState, action: TabsHookAction): TabsHookState {
  if (action.type === "STORAGE_HYDRATE") {
    return {
      tabs: action.state
        ? chatTabsReducer(state.tabs, { type: "HYDRATE", state: action.state })
        : state.tabs,
      storageReady: true,
    };
  }
  return {
    tabs: chatTabsReducer(state.tabs, action),
    storageReady: state.storageReady,
  };
}

export function useChatTabs(): UseChatTabsResult {
  // 首屏必须与 SSR 一致：禁止在 useReducer 初始化时读 sessionStorage
  // （否则服务端渲染「新对话」、客户端首帧已有 tabs → hydration mismatch）。
  // storageReady 收进同一 reducer：水合与 ready 同批提交，避免独立 setState 级联渲染。
  const [{ tabs, storageReady }, dispatch] = useReducer(
    tabsHookReducer,
    undefined,
    createInitialTabsHookState,
  );

  useEffect(() => {
    const fromStorage = parseChatTabsStorage(sessionStorage.getItem(CHAT_TABS_STORAGE_KEY));
    dispatch({ type: "STORAGE_HYDRATE", state: fromStorage });
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    try {
      sessionStorage.setItem(CHAT_TABS_STORAGE_KEY, serializeChatTabsState(tabs));
    } catch {
      /* ignore quota */
    }
  }, [tabs, storageReady]);

  const focusedSessionId = useMemo(() => getFocusedSessionId(tabs), [tabs]);
  const visibleSessionIds = useMemo(() => getVisibleSessionIds(tabs), [tabs]);

  const openTab = useCallback((sessionId: string, pane?: ChatPaneSlot) => {
    dispatch({ type: "OPEN_TAB", sessionId, pane });
  }, []);

  const openInOtherPane = useCallback((sessionId: string) => {
    dispatch({ type: "OPEN_IN_OTHER_PANE", sessionId });
  }, []);

  const focusTab = useCallback((sessionId: string) => {
    dispatch({ type: "FOCUS_TAB", sessionId });
  }, []);

  const focusPane = useCallback((pane: ChatPaneSlot) => {
    dispatch({ type: "FOCUS_PANE", pane });
  }, []);

  const closeTab = useCallback((sessionId: string) => {
    dispatch({ type: "CLOSE_TAB", sessionId });
  }, []);

  const enterSplit = useCallback((otherSessionId?: string) => {
    dispatch({ type: "ENTER_SPLIT", otherSessionId });
  }, []);

  const exitSplit = useCallback(() => {
    dispatch({ type: "EXIT_SPLIT" });
  }, []);

  const bindPane = useCallback((pane: ChatPaneSlot, sessionId: string | null) => {
    dispatch({ type: "BIND_PANE", pane, sessionId });
  }, []);

  const startNewChatInTabs = useCallback(() => {
    dispatch({ type: "START_NEW_CHAT" });
  }, []);

  const ensureFocusedSession = useCallback((sessionId: string) => {
    dispatch({ type: "OPEN_TAB", sessionId });
  }, []);

  const ensureSplitWith = useCallback((otherSessionId: string) => {
    dispatch({ type: "ENTER_SPLIT", otherSessionId });
  }, []);

  return {
    tabs,
    focusedSessionId,
    visibleSessionIds,
    tabsHydrated: storageReady,
    openTab,
    openInOtherPane,
    focusTab,
    focusPane,
    closeTab,
    enterSplit,
    exitSplit,
    bindPane,
    startNewChatInTabs,
    ensureFocusedSession,
    ensureSplitWith,
  };
}
