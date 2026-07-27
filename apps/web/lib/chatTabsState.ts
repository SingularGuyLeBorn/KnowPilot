/**
 * Chat 会话焦点 —— 纯状态机（侧栏切换；已取消标签栏 / 分屏 UI）。
 *
 * 不变量：
 * 1. 始终 layout===single，secondarySessionId=null
 * 2. 同一时刻最多一个焦点会话：openTabIds ⊆ {primarySessionId} 或空
 * 3. OPEN_TAB 替换焦点，不累积多标签
 * 4. ENTER_SPLIT / OPEN_IN_OTHER_PANE 退化为单焦点（兼容旧 action / 旧 storage）
 */

export type ChatPaneSlot = "primary" | "secondary";
export type ChatTabsLayout = "single" | "split";

export interface ChatTabsState {
  openTabIds: string[];
  layout: ChatTabsLayout;
  primarySessionId: string | null;
  secondarySessionId: string | null;
  focusedPane: ChatPaneSlot;
}

export type ChatTabsAction =
  | { type: "HYDRATE"; state: ChatTabsState }
  | { type: "OPEN_TAB"; sessionId: string; pane?: ChatPaneSlot }
  | { type: "OPEN_IN_OTHER_PANE"; sessionId: string }
  | { type: "FOCUS_TAB"; sessionId: string }
  | { type: "FOCUS_PANE"; pane: ChatPaneSlot }
  | { type: "CLOSE_TAB"; sessionId: string }
  | { type: "ENTER_SPLIT"; otherSessionId?: string }
  | { type: "EXIT_SPLIT" }
  | { type: "BIND_PANE"; pane: ChatPaneSlot; sessionId: string | null }
  | { type: "START_NEW_CHAT" };

export const CHAT_TABS_STORAGE_KEY = "kp:chat-tabs-v1";

export function createEmptyChatTabsState(): ChatTabsState {
  return {
    openTabIds: [],
    layout: "single",
    primarySessionId: null,
    secondarySessionId: null,
    focusedPane: "primary",
  };
}

export function getFocusedSessionId(state: ChatTabsState): string | null {
  return state.primarySessionId;
}

/** 当前可见 pane 绑定的 session（用于 drain / SSE） */
export function getVisibleSessionIds(state: ChatTabsState): string[] {
  return state.primarySessionId ? [state.primarySessionId] : [];
}

/** 强制单焦点：旧分屏 / 多标签 storage 一律压成 primary 一个会话 */
function ensureSingleFocus(state: ChatTabsState): ChatTabsState {
  const keep =
    state.focusedPane === "secondary" && state.secondarySessionId
      ? state.secondarySessionId
      : state.primarySessionId ??
        state.secondarySessionId ??
        state.openTabIds[0] ??
        null;
  return {
    openTabIds: keep ? [keep] : [],
    layout: "single",
    primarySessionId: keep,
    secondarySessionId: null,
    focusedPane: "primary",
  };
}

export function chatTabsReducer(state: ChatTabsState, action: ChatTabsAction): ChatTabsState {
  switch (action.type) {
    case "HYDRATE":
      return ensureSingleFocus({
        ...createEmptyChatTabsState(),
        ...action.state,
        openTabIds: Array.isArray(action.state.openTabIds)
          ? [...new Set(action.state.openTabIds.filter(Boolean))]
          : [],
      });

    case "OPEN_TAB":
      return {
        openTabIds: [action.sessionId],
        layout: "single",
        primarySessionId: action.sessionId,
        secondarySessionId: null,
        focusedPane: "primary",
      };

    case "OPEN_IN_OTHER_PANE":
      // 已取消分屏：等同切换焦点
      return chatTabsReducer(state, { type: "OPEN_TAB", sessionId: action.sessionId });

    case "FOCUS_TAB":
      if (state.primarySessionId === action.sessionId) return state;
      return chatTabsReducer(state, { type: "OPEN_TAB", sessionId: action.sessionId });

    case "FOCUS_PANE":
      // 单屏无 secondary；忽略
      return state;

    case "CLOSE_TAB": {
      const { sessionId } = action;
      if (state.primarySessionId !== sessionId && !state.openTabIds.includes(sessionId)) {
        return state;
      }
      // 单焦点：关掉当前 → 新对话空态
      if (state.primarySessionId === sessionId) {
        return createEmptyChatTabsState();
      }
      return ensureSingleFocus({
        ...state,
        openTabIds: state.openTabIds.filter((id) => id !== sessionId),
      });
    }

    case "ENTER_SPLIT":
      // 已取消分屏
      return ensureSingleFocus(state);

    case "EXIT_SPLIT":
      return ensureSingleFocus(state);

    case "BIND_PANE": {
      if (action.pane === "secondary") {
        // secondary 已废弃
        return action.sessionId
          ? chatTabsReducer(state, { type: "OPEN_TAB", sessionId: action.sessionId })
          : ensureSingleFocus(state);
      }
      if (!action.sessionId) {
        return createEmptyChatTabsState();
      }
      return chatTabsReducer(state, { type: "OPEN_TAB", sessionId: action.sessionId });
    }

    case "START_NEW_CHAT":
      return createEmptyChatTabsState();

    default:
      return state;
  }
}

export function parseChatTabsStorage(raw: string | null): ChatTabsState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ChatTabsState>;
    return chatTabsReducer(createEmptyChatTabsState(), {
      type: "HYDRATE",
      state: {
        openTabIds: Array.isArray(parsed.openTabIds) ? parsed.openTabIds.map(String) : [],
        layout: parsed.layout === "split" ? "split" : "single",
        primarySessionId: parsed.primarySessionId ? String(parsed.primarySessionId) : null,
        secondarySessionId: parsed.secondarySessionId
          ? String(parsed.secondarySessionId)
          : null,
        focusedPane: parsed.focusedPane === "secondary" ? "secondary" : "primary",
      },
    });
  } catch {
    return null;
  }
}

export function serializeChatTabsState(state: ChatTabsState): string {
  return JSON.stringify({
    openTabIds: state.openTabIds,
    layout: state.layout,
    primarySessionId: state.primarySessionId,
    secondarySessionId: state.secondarySessionId,
    focusedPane: state.focusedPane,
  });
}
