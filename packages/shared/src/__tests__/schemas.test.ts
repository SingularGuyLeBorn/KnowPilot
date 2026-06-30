import { describe, expect, it } from "vitest";
import { createGitRepoSchema, createWorkspaceSchema } from "../schemas.js";

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
