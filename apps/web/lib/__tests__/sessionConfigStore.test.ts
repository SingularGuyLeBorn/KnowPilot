import { describe, it, expect, beforeEach } from "vitest";
import {
  __resetSessionConfigStoreForTests,
  ensureSessionConfigHydrated,
  getSessionConfig,
  migrateSessionConfig,
  patchSessionConfig,
  setSessionConfig,
} from "../sessionConfigStore";
import { DEFAULT_CHAT_CONFIG } from "../chatConfig";

describe("sessionConfigStore (E8)", () => {
  beforeEach(() => {
    __resetSessionConfigStoreForTests();
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
  });
});
