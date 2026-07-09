import { describe, expect, it } from "vitest";
import {
  createGitRepoSchema,
  createWorkspaceSchema,
  createSessionSchema,
  listSessionsSchema,
  stopSessionSchema,
  rerunSessionSchema,
  createTaskSchema,
  updateTaskSchema,
} from "../schemas.js";

describe("createGitRepoSchema path 校验", () => {
  it("接受 Windows 绝对路径", () => {
    const parsed = createGitRepoSchema.safeParse({ name: "repo", path: "D:/projects/foo", branch: "main" });
    expect(parsed.success).toBe(true);
  });

  it("接受 Unix 绝对路径", () => {
    const parsed = createGitRepoSchema.safeParse({ name: "repo", path: "/home/user/foo", branch: "main" });
    expect(parsed.success).toBe(true);
  });

  it("接受相对路径", () => {
    const parsed = createGitRepoSchema.safeParse({ name: "repo", path: "content/foo", branch: "main" });
    expect(parsed.success).toBe(true);
  });

  it("拒绝包含 .. 的路径", () => {
    const parsed = createGitRepoSchema.safeParse({ name: "repo", path: "../etc", branch: "main" });
    expect(parsed.success).toBe(false);
  });
});

describe("createWorkspaceSchema path 校验", () => {
  it("接受绝对路径", () => {
    const parsed = createWorkspaceSchema.safeParse({ name: "ws", path: "D:/workspaces/ws1" });
    expect(parsed.success).toBe(true);
  });

  it("拒绝包含 .. 的路径", () => {
    const parsed = createWorkspaceSchema.safeParse({ name: "ws", path: "/tmp/../etc" });
    expect(parsed.success).toBe(false);
  });
});

describe("Session / Subagent schema 校验", () => {
  it("createSessionSchema 接受普通会话", () => {
    const parsed = createSessionSchema.safeParse({ title: "新会话" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.kind).toBeUndefined();
      expect(parsed.data.status).toBeUndefined();
    }
  });

  it("createSessionSchema 接受 subagent 会话", () => {
    const parsed = createSessionSchema.safeParse({
      title: "子代理任务",
      kind: "subagent",
      status: "running",
      parentSessionId: "clx12345678901234567890123",
      taskDescription: "搜索 KnowPilot 并整理摘要",
    });
    expect(parsed.success).toBe(true);
  });

  it("createSessionSchema 拒绝非法 kind", () => {
    const parsed = createSessionSchema.safeParse({ title: "x", kind: "worker" });
    expect(parsed.success).toBe(false);
  });

  it("createSessionSchema 拒绝非法 status", () => {
    const parsed = createSessionSchema.safeParse({ title: "x", status: "unknown" });
    expect(parsed.success).toBe(false);
  });

  it("listSessionsSchema 支持 subagent 过滤", () => {
    const parsed = listSessionsSchema.safeParse({
      page: 1,
      pageSize: 20,
      kind: "subagent",
      status: "running",
      parentSessionId: "clx12345678901234567890123",
    });
    expect(parsed.success).toBe(true);
  });

  it("stopSessionSchema 要求合法 cuid", () => {
    expect(stopSessionSchema.safeParse({ id: "clx12345678901234567890123" }).success).toBe(true);
    expect(stopSessionSchema.safeParse({ id: "not-a-cuid" }).success).toBe(false);
  });

  it("rerunSessionSchema 要求合法 cuid", () => {
    expect(rerunSessionSchema.safeParse({ id: "clx12345678901234567890123" }).success).toBe(true);
    expect(rerunSessionSchema.safeParse({ id: "not-a-cuid" }).success).toBe(false);
  });
});

describe("Task schema 校验", () => {
  it("createTaskSchema 接受 async_agent / queued 及时间戳", () => {
    const parsed = createTaskSchema.safeParse({
      name: "后台任务",
      type: "async_agent",
      status: "queued",
      sessionId: "clx12345678901234567890123",
      queuedAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.type).toBe("async_agent");
      expect(parsed.data.status).toBe("queued");
    }
  });

  it("createTaskSchema 拒绝非法 type", () => {
    expect(createTaskSchema.safeParse({ name: "x", type: "unknown" }).success).toBe(false);
  });

  it("createTaskSchema 拒绝非法 status", () => {
    expect(createTaskSchema.safeParse({ name: "x", status: "unknown" }).success).toBe(false);
  });

  it("updateTaskSchema 允许只更新状态", () => {
    const parsed = updateTaskSchema.safeParse({ id: "clx12345678901234567890123", status: "running" });
    expect(parsed.success).toBe(true);
  });
});
