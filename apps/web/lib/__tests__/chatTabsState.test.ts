import { describe, expect, it } from "vitest";
import {
  chatTabsReducer,
  createEmptyChatTabsState,
  getFocusedSessionId,
  getVisibleSessionIds,
} from "../chatTabsState";

describe("chatTabsReducer（单焦点，无标签栏/分屏）", () => {
  it("OPEN_TAB 聚焦且不累积多标签", () => {
    let s = createEmptyChatTabsState();
    s = chatTabsReducer(s, { type: "OPEN_TAB", sessionId: "a" });
    s = chatTabsReducer(s, { type: "OPEN_TAB", sessionId: "b" });
    expect(s.openTabIds).toEqual(["b"]);
    expect(s.primarySessionId).toBe("b");
    expect(s.layout).toBe("single");
    expect(getFocusedSessionId(s)).toBe("b");
    expect(getVisibleSessionIds(s)).toEqual(["b"]);
  });

  it("OPEN_IN_OTHER_PANE 退化为切换焦点，不分屏", () => {
    let s = createEmptyChatTabsState();
    s = chatTabsReducer(s, { type: "OPEN_TAB", sessionId: "a" });
    s = chatTabsReducer(s, { type: "OPEN_IN_OTHER_PANE", sessionId: "b" });
    expect(s.layout).toBe("single");
    expect(s.primarySessionId).toBe("b");
    expect(s.secondarySessionId).toBeNull();
    expect(s.openTabIds).toEqual(["b"]);
  });

  it("CLOSE_TAB：关掉当前回到空态", () => {
    let s = createEmptyChatTabsState();
    s = chatTabsReducer(s, { type: "OPEN_TAB", sessionId: "a" });
    s = chatTabsReducer(s, { type: "CLOSE_TAB", sessionId: "a" });
    expect(s.openTabIds).toEqual([]);
    expect(s.primarySessionId).toBeNull();
  });

  it("ENTER_SPLIT 为 no-op（保持单屏）", () => {
    let s = createEmptyChatTabsState();
    s = chatTabsReducer(s, { type: "OPEN_TAB", sessionId: "a" });
    s = chatTabsReducer(s, { type: "OPEN_TAB", sessionId: "b" });
    const blocked = chatTabsReducer(s, { type: "ENTER_SPLIT", otherSessionId: "a" });
    expect(blocked.layout).toBe("single");
    expect(blocked.primarySessionId).toBe("b");
    expect(blocked.secondarySessionId).toBeNull();
  });

  it("HYDRATE 把旧分屏压成单焦点", () => {
    const s = chatTabsReducer(createEmptyChatTabsState(), {
      type: "HYDRATE",
      state: {
        openTabIds: ["a", "b"],
        layout: "split",
        primarySessionId: "a",
        secondarySessionId: "b",
        focusedPane: "secondary",
      },
    });
    expect(s.layout).toBe("single");
    expect(s.primarySessionId).toBe("b");
    expect(s.secondarySessionId).toBeNull();
    expect(s.openTabIds).toEqual(["b"]);
  });

  it("START_NEW_CHAT 清空焦点", () => {
    let s = createEmptyChatTabsState();
    s = chatTabsReducer(s, { type: "OPEN_TAB", sessionId: "a" });
    s = chatTabsReducer(s, { type: "START_NEW_CHAT" });
    expect(s.primarySessionId).toBeNull();
    expect(s.openTabIds).toEqual([]);
  });
});
