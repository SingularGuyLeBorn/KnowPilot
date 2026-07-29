/**
 * processSafety：安装幂等（不在单测里真扔 unhandledRejection，避免污染 vitest 进程）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  installProcessSafetyHandlers,
  __resetProcessSafetyForTests,
} from "../infra/processSafety.js";

describe("processSafety", () => {
  beforeEach(() => {
    __resetProcessSafetyForTests();
  });

  it("install 幂等且不抛", () => {
    expect(() => {
      installProcessSafetyHandlers();
      installProcessSafetyHandlers();
    }).not.toThrow();
  });
});
