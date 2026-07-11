import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createTestConfig, createNativeCtx } from "./helpers/toolTestFixtures.js";
import { executeNativeTool, NATIVE_TOOL_DEFINITIONS } from "../infra/nativeTools.js";

describe("session_rotate", () => {
  let tmpRoot: string;
  let pushExternalEvent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kp-rotate-"));
    fs.mkdirSync(path.join(tmpRoot, "content"), { recursive: true });
    pushExternalEvent = vi.fn();
    vi.doMock("../infra/sessionStreamHub.js", () => ({
      getStreamHub: () => ({ pushExternalEvent }),
    }));
  });

  afterEach(() => {
    vi.doUnmock("../infra/sessionStreamHub.js");
    vi.resetModules();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("工具定义已注册", () => {
    const def = NATIVE_TOOL_DEFINITIONS.find((d) => d.name === "session_rotate");
    expect(def).toBeTruthy();
    expect(def?.parameters.required).toContain("summary");
  });

  it("归档旧会话、创建新会话、写总结并推送 SSE", async () => {
    // 重新 import 以应用 getStreamHub mock
    vi.resetModules();
    vi.doMock("../infra/sessionStreamHub.js", () => ({
      getStreamHub: () => ({ pushExternalEvent }),
    }));
    const { executeNativeTool: exec } = await import("../infra/nativeTools.js");

    const oldSession = {
      id: "clxxxxxxxxxxxxxxxxxxxx01",
      title: "旧对话",
      model: "deepseek-v4-flash",
      systemPrompt: "sys",
      agentId: "clxxxxxxxxxxxxxxxxxxxxag",
      kind: "chat",
      status: "active",
    };
    const newSession = { id: "clxxxxxxxxxxxxxxxxxxxx02", title: "旧对话 · 续" };

    const sessionService = {
      getByIdLite: vi.fn().mockResolvedValue(oldSession),
      create: vi.fn().mockResolvedValue({ success: true, data: newSession }),
      update: vi.fn().mockResolvedValue({ success: true }),
    };
    const messageService = {
      create: vi.fn().mockResolvedValue({ success: true, data: { id: "msg1" } }),
    };

    const config = createTestConfig(tmpRoot);
    const ctx = {
      ...createNativeCtx(tmpRoot),
      config,
      sessionId: oldSession.id,
      agentSnapshot: { id: oldSession.agentId, tier: "manager" as const },
      services: {
        session: sessionService,
        message: messageService,
        log: { create: vi.fn().mockResolvedValue({}) },
      },
    };

    const result = (await exec(
      "session_rotate",
      { summary: "这是总结内容", reason: "轮数过多" },
      ctx as any,
    )) as {
      success: boolean;
      oldSessionId: string;
      newSessionId: string;
      summaryPath: string;
    };

    expect(result.success).toBe(true);
    expect(result.oldSessionId).toBe(oldSession.id);
    expect(result.newSessionId).toBe(newSession.id);
    expect(sessionService.create).toHaveBeenCalled();
    expect(sessionService.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: oldSession.id,
        status: "archived",
        rotatedToSessionId: newSession.id,
      }),
    );
    expect(messageService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: newSession.id,
        role: "user",
        content: expect.stringContaining("这是总结内容"),
      }),
    );

    const summaryFile = path.join(tmpRoot, "content", "sessions", `${oldSession.id}-summary.md`);
    expect(fs.existsSync(summaryFile)).toBe(true);
    expect(fs.readFileSync(summaryFile, "utf8")).toContain("这是总结内容");
    expect(pushExternalEvent).toHaveBeenCalledWith(
      oldSession.id,
      expect.objectContaining({
        type: "session_rotated",
        newSessionId: newSession.id,
      }),
    );
  });

  it("缺少 summary 时抛错", async () => {
    const ctx = createNativeCtx(tmpRoot);
    await expect(
      executeNativeTool("session_rotate", { summary: "  " }, { ...ctx, sessionId: "x" } as any),
    ).rejects.toThrow(/summary/);
  });

  it("已归档会话拒绝重复 rotate", async () => {
    const ctx = {
      ...createNativeCtx(tmpRoot),
      sessionId: "clxxxxxxxxxxxxxxxxxxxx01",
      services: {
        session: {
          getByIdLite: vi.fn().mockResolvedValue({
            id: "clxxxxxxxxxxxxxxxxxxxx01",
            status: "archived",
            rotatedToSessionId: "clxxxxxxxxxxxxxxxxxxxx02",
            kind: "chat",
          }),
        },
        message: {},
      },
    };
    const result = (await executeNativeTool(
      "session_rotate",
      { summary: "再压一次" },
      ctx as any,
    )) as { success: boolean; error?: string };
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/已归档/);
  });
});
