import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { createTempProjectDir, createTestConfig } from "./helpers/toolTestFixtures.js";
import { assertWorkspacePathAllowed } from "../infra/safePath.js";

describe("assertWorkspacePathAllowed", () => {
  let root: string;

  beforeEach(() => {
    root = createTempProjectDir();
    fs.mkdirSync(path.join(root, "content/posts"), { recursive: true });
    fs.mkdirSync(path.join(root, "workspaces"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("拒绝 path=content/posts", () => {
    const config = createTestConfig(root);
    expect(() => assertWorkspacePathAllowed(config, "content/posts")).toThrow(/知识库核心|content\/posts/);
  });

  it("拒绝 path=content/about", () => {
    const config = createTestConfig(root);
    expect(() => assertWorkspacePathAllowed(config, "content/about")).toThrow(/知识库核心|content\/about/);
  });

  it("拒绝 path=config/agents", () => {
    const config = createTestConfig(root);
    expect(() => assertWorkspacePathAllowed(config, "config/agents")).toThrow(/Agent 配置区/);
  });

  it("允许 workspaces/foo", () => {
    const config = createTestConfig(root);
    expect(() => assertWorkspacePathAllowed(config, "workspaces/foo")).not.toThrow();
  });
});
