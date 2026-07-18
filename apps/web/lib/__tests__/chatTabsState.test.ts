import { describe, expect, it } from "vitest";
import {
  chatTabsReducer,
  createEmptyChatTabsState,
  getFocusedSessionId,
  getVisibleSessionIds,
} from "../chatTabsState";

describe("chatTabsReducer", () => {
  it("OPEN_TAB 去重并聚焦", () => {
    let s = createEmptyChatTabsState();
    s = chatTabsReducer(s, { type: "OPEN_TAB", sessionId: "a" });
    s = chatTabsReducer(s, { type: "OPEN_TAB", sessionId: "a" });
    expect(s.openTabIds).toEqual(["a"]);
    expect(s.primarySessionId).toBe("a");
    expect(getFocusedSessionId(s)).toBe("a");
  });

  it("OPEN_IN_OTHER_PANE：单屏变分屏且两侧不同", () => {
    let s = createEmptyChatTabsState();
    s = chatTabsReducer(s, { type: "OPEN_TAB", sessionId: "a" });
    s = chatTabsReducer(s, { type: "OPEN_IN_OTHER_PANE", sessionId: "b" });
    expect(s.layout).toBe("split");
    expect(s.primarySessionId).toBe("a");
    expect(s.secondarySessionId).toBe("b");
    expect(s.focusedPane).toBe("secondary");
    expect(getVisibleSessionIds(s)).toEqual(["a", "b"]);
  });

  it("CLOSE_TAB：关闭左侧升格右侧为单屏", () => {
    let s = createEmptyChatTabsState();
    s = chatTabsReducer(s, { type: "OPEN_TAB", sessionId: "a" });
    s = chatTabsReducer(s, { type: "OPEN_IN_OTHER_PANE", sessionId: "b" });
    s = chatTabsReducer(s, { type: "CLOSE_TAB", sessionId: "a" });
    expect(s.layout).toBe("single");
    expect(s.primarySessionId).toBe("b");
    expect(s.secondarySessionId).toBeNull();
    expect(s.openTabIds).toEqual(["b"]);
  });

  it("CLOSE_TAB：关闭唯一 tab 回到新对话", () => {
    let s = createEmptyChatTabsState();
    s = chatTabsReducer(s, { type: "OPEN_TAB", sessionId: "a" });
    s = chatTabsReducer(s, { type: "CLOSE_TAB", sessionId: "a" });
    expect(s.openTabIds).toEqual([]);
    expect(s.primarySessionId).toBeNull();
  });

  it("ENTER_SPLIT 需要至少两个不同 tab", () => {
    let s = createEmptyChatTabsState();
    s = chatTabsReducer(s, { type: "OPEN_TAB", sessionId: "a" });
    const blocked = chatTabsReducer(s, { type: "ENTER_SPLIT" });
    expect(blocked.layout).toBe("single");
    s = chatTabsReducer(s, { type: "OPEN_TAB", sessionId: "b" });
    // OPEN_TAB 到 primary 会把 primary 换成 b，openTabIds=[a,b]
    s = chatTabsReducer(s, { type: "ENTER_SPLIT", otherSessionId: "a" });
    expect(s.layout).toBe("split");
    expect(s.primarySessionId).toBe("b");
    expect(s.secondarySessionId).toBe("a");
  });

  it("EXIT_SPLIT 保留焦点侧", () => {
    let s = createEmptyChatTabsState();
    s = chatTabsReducer(s, { type: "OPEN_TAB", sessionId: "a" });
    s = chatTabsReducer(s, { type: "OPEN_IN_OTHER_PANE", sessionId: "b" });
    s = chatTabsReducer(s, { type: "EXIT_SPLIT" });
    expect(s.layout).toBe("single");
    expect(s.primarySessionId).toBe("b");
  });

  it("FOCUS_TAB 切到已显示的 secondary", () => {
    let s = createEmptyChatTabsState();
    s = chatTabsReducer(s, { type: "OPEN_TAB", sessionId: "a" });
    s = chatTabsReducer(s, { type: "OPEN_IN_OTHER_PANE", sessionId: "b" });
    s = chatTabsReducer(s, { type: "FOCUS_PANE", pane: "primary" });
    s = chatTabsReducer(s, { type: "FOCUS_TAB", sessionId: "b" });
    expect(s.focusedPane).toBe("secondary");
  });

  it("START_NEW_CHAT 清空 primary 焦点", () => {
    let s = createEmptyChatTabsState();
    s = chatTabsReducer(s, { type: "OPEN_TAB", sessionId: "a" });
    s = chatTabsReducer(s, { type: "START_NEW_CHAT" });
    expect(s.primarySessionId).toBeNull();
    expect(s.openTabIds).toEqual(["a"]);
  });
});
