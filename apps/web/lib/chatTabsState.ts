/**
 * Chat 标签页 + 两栏分屏 —— 纯状态机（不变量收进 reducer，编排层写错也打不破）。
 *
 * 不变量：
 * 1. layout===single → secondarySessionId=null
 * 2. layout===split → primary/secondary 均非空且不相同
 * 3. openTabIds 无重复；关闭 pane 上的 tab 时 pane 切到相邻仍打开的 tab
 * 4. 打开已在 tabs 中的 session → 只聚焦，不重复加 tab
 * 5. 分屏上限 2
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
  return state.focusedPane === "secondary"
    ? state.secondarySessionId
    : state.primarySessionId;
}

/** 当前可见 pane 绑定的 session（用于 drain / SSE） */
export function getVisibleSessionIds(state: ChatTabsState): string[] {
  const ids: string[] = [];
  if (state.primarySessionId) ids.push(state.primarySessionId);
  if (state.layout === "split" && state.secondarySessionId) {
    ids.push(state.secondarySessionId);
  }
  return ids;
}

function uniquePush(ids: string[], id: string): string[] {
  if (ids.includes(id)) return ids;
  return [...ids, id];
}

function neighborTab(openTabIds: string[], closingId: string): string | null {
  const idx = openTabIds.indexOf(closingId);
  if (idx < 0) return openTabIds[0] ?? null;
  const next = openTabIds[idx + 1] ?? openTabIds[idx - 1] ?? null;
  return next && next !== closingId ? next : null;
}

function replacePaneSession(
  state: ChatTabsState,
  pane: ChatPaneSlot,
  sessionId: string | null,
): ChatTabsState {
  if (pane === "primary") {
    return { ...state, primarySessionId: sessionId };
  }
  return { ...state, secondarySessionId: sessionId };
}

function ensureSplitInvariant(state: ChatTabsState): ChatTabsState {
  if (state.layout !== "split") {
    return { ...state, secondarySessionId: null, focusedPane: "primary" };
  }
  if (
    !state.primarySessionId ||
    !state.secondarySessionId ||
    state.primarySessionId === state.secondarySessionId
  ) {
    // 非法分屏 → 退回单屏，保留 primary（或 secondary 若 primary 空）
    const keep =
      state.primarySessionId &&
      state.primarySessionId !== state.secondarySessionId
        ? state.primarySessionId
        : state.secondarySessionId &&
            state.secondarySessionId !== state.primarySessionId
          ? state.secondarySessionId
          : state.primarySessionId;
    return {
      ...state,
      layout: "single",
      primarySessionId: keep,
      secondarySessionId: null,
      focusedPane: "primary",
    };
  }
  return state;
}

export function chatTabsReducer(state: ChatTabsState, action: ChatTabsAction): ChatTabsState {
  switch (action.type) {
    case "HYDRATE":
      return ensureSplitInvariant({
        ...createEmptyChatTabsState(),
        ...action.state,
        openTabIds: Array.isArray(action.state.openTabIds)
          ? [...new Set(action.state.openTabIds.filter(Boolean))]
          : [],
      });

    case "OPEN_TAB": {
      const pane = action.pane ?? state.focusedPane;
      const openTabIds = uniquePush(state.openTabIds, action.sessionId);
      let next: ChatTabsState = {
        ...state,
        openTabIds,
        focusedPane: pane === "secondary" && state.layout === "split" ? "secondary" : "primary",
      };
      if (next.focusedPane === "secondary" && state.layout === "split") {
        next = { ...next, secondarySessionId: action.sessionId, focusedPane: "secondary" };
      } else {
        next = { ...next, primarySessionId: action.sessionId, focusedPane: "primary" };
      }
      return ensureSplitInvariant(next);
    }

    case "OPEN_IN_OTHER_PANE": {
      const openTabIds = uniquePush(state.openTabIds, action.sessionId);
      if (state.layout === "single") {
        // 单屏 → 分屏：当前 primary 留左，新 session 开右
        const primary = state.primarySessionId;
        if (!primary || primary === action.sessionId) {
          // 无左侧可对照时退化为 OPEN_TAB
          return chatTabsReducer(
            { ...state, openTabIds },
            { type: "OPEN_TAB", sessionId: action.sessionId },
          );
        }
        return ensureSplitInvariant({
          ...state,
          openTabIds,
          layout: "split",
          primarySessionId: primary,
          secondarySessionId: action.sessionId,
          focusedPane: "secondary",
        });
      }
      // 已分屏：写到非焦点侧
      const other: ChatPaneSlot =
        state.focusedPane === "primary" ? "secondary" : "primary";
      if (
        (other === "primary" ? state.secondarySessionId : state.primarySessionId) ===
        action.sessionId
      ) {
        // 另一侧已是该 session：只聚焦那一侧
        return { ...state, openTabIds, focusedPane: other };
      }
      return ensureSplitInvariant(
        replacePaneSession(
          { ...state, openTabIds, focusedPane: other },
          other,
          action.sessionId,
        ),
      );
    }

    case "FOCUS_TAB": {
      if (state.layout === "split" && state.secondarySessionId === action.sessionId) {
        return { ...state, focusedPane: "secondary" };
      }
      if (state.primarySessionId === action.sessionId) {
        return { ...state, focusedPane: "primary" };
      }
      // 未显示：打开到焦点 pane
      return chatTabsReducer(state, {
        type: "OPEN_TAB",
        sessionId: action.sessionId,
        pane: state.focusedPane,
      });
    }

    case "FOCUS_PANE": {
      if (action.pane === "secondary" && state.layout !== "split") {
        return state;
      }
      return { ...state, focusedPane: action.pane };
    }

    case "CLOSE_TAB": {
      const { sessionId } = action;
      if (!state.openTabIds.includes(sessionId)) return state;
      const openTabIds = state.openTabIds.filter((id) => id !== sessionId);
      const fallback = neighborTab(state.openTabIds, sessionId);

      let next: ChatTabsState = { ...state, openTabIds };

      if (state.layout === "split") {
        if (state.primarySessionId === sessionId && state.secondarySessionId === sessionId) {
          // 不应发生（不变量）
          next = {
            ...next,
            layout: "single",
            primarySessionId: fallback,
            secondarySessionId: null,
            focusedPane: "primary",
          };
        } else if (state.primarySessionId === sessionId) {
          if (fallback && fallback !== state.secondarySessionId) {
            next = { ...next, primarySessionId: fallback };
          } else {
            // 左侧无替代 → 升格右侧为单屏
            next = {
              ...next,
              layout: "single",
              primarySessionId: state.secondarySessionId,
              secondarySessionId: null,
              focusedPane: "primary",
            };
          }
        } else if (state.secondarySessionId === sessionId) {
          if (fallback && fallback !== state.primarySessionId) {
            next = { ...next, secondarySessionId: fallback };
          } else {
            next = {
              ...next,
              layout: "single",
              secondarySessionId: null,
              focusedPane: "primary",
            };
          }
        }
      } else if (state.primarySessionId === sessionId) {
        next = {
          ...next,
          primarySessionId: fallback,
          focusedPane: "primary",
        };
      }

      return ensureSplitInvariant(next);
    }

    case "ENTER_SPLIT": {
      if (state.layout === "split") return state;
      const primary = state.primarySessionId;
      if (!primary) return state;
      const candidate =
        action.otherSessionId &&
        action.otherSessionId !== primary &&
        state.openTabIds.includes(action.otherSessionId)
          ? action.otherSessionId
          : state.openTabIds.find((id) => id !== primary) ?? null;
      if (!candidate) return state;
      return ensureSplitInvariant({
        ...state,
        layout: "split",
        primarySessionId: primary,
        secondarySessionId: candidate,
        focusedPane: "secondary",
        openTabIds: uniquePush(state.openTabIds, candidate),
      });
    }

    case "EXIT_SPLIT": {
      if (state.layout !== "split") return state;
      const keep =
        state.focusedPane === "secondary" && state.secondarySessionId
          ? state.secondarySessionId
          : state.primarySessionId;
      return {
        ...state,
        layout: "single",
        primarySessionId: keep,
        secondarySessionId: null,
        focusedPane: "primary",
      };
    }

    case "BIND_PANE": {
      let next = replacePaneSession(state, action.pane, action.sessionId);
      if (action.sessionId) {
        next = { ...next, openTabIds: uniquePush(next.openTabIds, action.sessionId) };
      }
      return ensureSplitInvariant(next);
    }

    case "START_NEW_CHAT": {
      // 焦点侧进入「新对话」；不关闭其它已打开 tab
      if (state.layout === "split" && state.focusedPane === "secondary") {
        // 分屏右侧不能挂 null（不变量要求非空）→ 退出分屏后新建
        return {
          ...state,
          layout: "single",
          primarySessionId: null,
          secondarySessionId: null,
          focusedPane: "primary",
        };
      }
      return {
        ...state,
        primarySessionId: null,
        secondarySessionId: state.layout === "split" ? state.secondarySessionId : null,
        focusedPane: "primary",
        layout: state.layout === "split" && state.secondarySessionId ? "split" : "single",
      };
    }

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
