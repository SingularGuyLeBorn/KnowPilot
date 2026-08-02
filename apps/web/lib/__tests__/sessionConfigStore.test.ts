import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  __resetSessionConfigStoreForTests,
  ensureSessionConfigHydrated,
  getSessionConfig,
  migrateSessionConfig,
  patchSessionConfig,
  setSessionConfig,
  subscribeSessionConfigStore,
} from "../sessionConfigStore";
import { DEFAULT_CHAT_CONFIG, saveSessionChatConfig } from "../chatConfig";

describe("sessionConfigStore (E8)", () => {
  beforeEach(() => {
    __resetSessionConfigStoreForTests();
    if (typeof localStorage !== "undefined") localStorage.clear();
  });

  it("notify 合并到 microtask，不在 set 调用栈同步触发订阅方", async () => {
    const spy = vi.fn();
    const unsub = subscribeSessionConfigStore(spy);
    setSessionConfig("s-notify", { ...DEFAULT_CHAT_CONFIG, model: "m1" });
    expect(spy).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(spy).toHaveBeenCalledTimes(1);
    unsub();
  });

  it("ensureHydrated 缺省写入 DEFAULT", () => {
    const cfg = ensureSessionConfigHydrated("s1");
    expect(cfg.model).toBe(DEFAULT_CHAT_CONFIG.model);
    expect(getSessionConfig("s1")).toEqual(cfg);
  });

  it("patch 更新内存切片", () => {
    ensureSessionConfigHydrated("s1");
    const next = patchSessionConfig("s1", { model: "test-model" }, false);
    expect(next.model).toBe("test-model");
    expect(getSessionConfig("s1").model).toBe("test-model");
  });

  it("migrate 把 NEW 切片迁到真实 sessionId", () => {
    setSessionConfig("__new__", { ...DEFAULT_CHAT_CONFIG, model: "migrated-model" });
    migrateSessionConfig("__new__", "real-sid");
    expect(getSessionConfig("real-sid").model).toBe("migrated-model");
    expect(getSessionConfig("__new__").model).toBe(DEFAULT_CHAT_CONFIG.model);
  });

  it("migrate 内存无切片时从 localStorage 读 NEW 配置", () => {
    saveSessionChatConfig("__new__", { ...DEFAULT_CHAT_CONFIG, model: "from-ls" });
    __resetSessionConfigStoreForTests();
    migrateSessionConfig("__new__", "sid-from-ls");
    expect(getSessionConfig("sid-from-ls").model).toBe("from-ls");
  });

  it("migrate 保留 Agent 归属字段（E8）", () => {
    setSessionConfig("__new__", {
      ...DEFAULT_CHAT_CONFIG,
      agentId: "agent-1",
      agentSystemPrompt: "agent-system",
    });
    migrateSessionConfig("__new__", "real-sid");
    const cfg = getSessionConfig("real-sid");
    expect(cfg.agentId).toBe("agent-1");
    expect(cfg.agentSystemPrompt).toBe("agent-system");
    expect(getSessionConfig("__new__").agentId).toBeUndefined();
  });
});
