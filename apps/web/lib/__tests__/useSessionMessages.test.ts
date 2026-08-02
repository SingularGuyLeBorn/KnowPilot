import { describe, expect, it, beforeEach } from "vitest";
import {
  __resetSessionMessageStoreForTests,
  __messageFieldsEqualForTests,
  sessionMessagesStore,
} from "@/lib/useSessionMessages";
import type { ChatMessage } from "@knowpilot/shared";

function baseMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-1",
    sessionId: "s1",
    role: "assistant",
    content: "hello",
    parentId: null,
    label: null,
    kind: null,
    attachments: [],
    toolCalls: null,
    toolResults: null,
    tokenUsage: null,
    finishReason: "stop",
    source: "user",
    createdAt: new Date("2026-08-02T00:00:00Z"),
    ...overrides,
  };
}

describe("useSessionMessages / messageFieldsEqual", () => {
  beforeEach(() => {
    __resetSessionMessageStoreForTests();
  });

  it("相同字段的消息判定为相等", () => {
    const a = baseMessage();
    const b = baseMessage();
    expect(__messageFieldsEqualForTests(a, b)).toBe(true);
  });

  it("role 不同判定为不等", () => {
    const a = baseMessage();
    const b = baseMessage({ role: "user" });
    expect(__messageFieldsEqualForTests(a, b)).toBe(false);
  });

  it("content 不同判定为不等", () => {
    const a = baseMessage();
    const b = baseMessage({ content: "world" });
    expect(__messageFieldsEqualForTests(a, b)).toBe(false);
  });

  it("source 不同判定为不等", () => {
    const a = baseMessage();
    const b = baseMessage({ source: "sub" });
    expect(__messageFieldsEqualForTests(a, b)).toBe(false);
  });

  it("parentId 不同判定为不等", () => {
    const a = baseMessage();
    const b = baseMessage({ parentId: "p2" });
    expect(__messageFieldsEqualForTests(a, b)).toBe(false);
  });

  it("label 不同判定为不等", () => {
    const a = baseMessage();
    const b = baseMessage({ label: "pinned" });
    expect(__messageFieldsEqualForTests(a, b)).toBe(false);
  });

  it("kind 不同判定为不等", () => {
    const a = baseMessage();
    const b = baseMessage({ kind: "branch_summary" });
    expect(__messageFieldsEqualForTests(a, b)).toBe(false);
  });

  it("finishReason 不同判定为不等", () => {
    const a = baseMessage();
    const b = baseMessage({ finishReason: "length" });
    expect(__messageFieldsEqualForTests(a, b)).toBe(false);
  });

  it("attachments 不同判定为不等", () => {
    const a = baseMessage();
    const b = baseMessage({ attachments: [{ type: "image", url: "a.png" }] });
    expect(__messageFieldsEqualForTests(a, b)).toBe(false);
  });

  it("toolCalls 不同判定为不等", () => {
    const a = baseMessage();
    const b = baseMessage({ toolCalls: [{ id: "c1", function: { name: "x" } }] });
    expect(__messageFieldsEqualForTests(a, b)).toBe(false);
  });

  it("toolResults 不同判定为不等", () => {
    const a = baseMessage();
    const b = baseMessage({ toolResults: { subagentResult: { jobId: "j1" } } });
    expect(__messageFieldsEqualForTests(a, b)).toBe(false);
  });

  it("tokenUsage 不同判定为不等", () => {
    const a = baseMessage();
    const b = baseMessage({ tokenUsage: { prompt: 1, completion: 2, total: 3 } });
    expect(__messageFieldsEqualForTests(a, b)).toBe(false);
  });

  it("内容相同但对象引用不同的 attachments 判定为相等", () => {
    const a = baseMessage({ attachments: [{ type: "image", url: "a.png" }] });
    const b = baseMessage({ attachments: [{ type: "image", url: "a.png" }] });
    expect(a.attachments).not.toBe(b.attachments);
    expect(__messageFieldsEqualForTests(a, b)).toBe(true);
  });

  it("store upsert 同内容消息时 state 不变（no-op）", () => {
    const msg = baseMessage();
    sessionMessagesStore.upsertMessage("s1", msg);
    const before = sessionMessagesStore.getMessages("s1");
    sessionMessagesStore.upsertMessage("s1", baseMessage());
    const after = sessionMessagesStore.getMessages("s1");
    expect(after).toBe(before);
    expect(after).toHaveLength(1);
  });

  it("store upsert source 变化时 state 更新", () => {
    sessionMessagesStore.upsertMessage("s1", baseMessage());
    sessionMessagesStore.upsertMessage("s1", baseMessage({ source: "sub" }));
    const list = sessionMessagesStore.getMessages("s1");
    expect(list).toHaveLength(1);
    expect(list[0]?.source).toBe("sub");
  });
});
