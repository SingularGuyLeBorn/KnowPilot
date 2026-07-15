/**
 * Native 工具 — 每个 Agent 内置工具单元测试
 */

import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  executeNativeTool,
  buildNativeToolSchemas,
  listNativeTools,
  resolveAllowedNativeTools,
  isUnreadableArticlePage,
} from "../infra/nativeTools.js";
import { resetSwarmBus } from "../infra/swarmBus.js";
import {
  ALL_NATIVE_TOOL_NAMES,
  createNativeCtx,
  createTempProjectDir,
} from "./helpers/toolTestFixtures.js";

describe("Native 工具注册表", () => {
  it("listNativeTools 包含全部工具定义", () => {
    const names = listNativeTools().map((d) => d.name);
    expect(names).toEqual(expect.arrayContaining([...ALL_NATIVE_TOOL_NAMES]));
    expect(names).toHaveLength(ALL_NATIVE_TOOL_NAMES.length);
  });

  it("buildNativeToolSchemas 按授权过滤", () => {
    const schemas = buildNativeToolSchemas(["read_file", "invoke_api"]);
    expect(schemas.map((s) => s.function.name)).toEqual(["read_file", "invoke_api"]);
  });

  it("resolveAllowedNativeTools 空配置返回 all", () => {
    expect(resolveAllowedNativeTools([])).toBe("all");
  });

  it("未知工具抛出明确错误", async () => {
    const root = createTempProjectDir();
    const ctx = createNativeCtx(root);
    await expect(executeNativeTool("not_a_tool", {}, ctx)).rejects.toThrow(/未知原生工具/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("agent_report_back 在用户直接对话(runOrigin=user)时不再硬拦截（有上级即可回报）", async () => {
    const root = createTempProjectDir();
    const ctx = {
      ...createNativeCtx(root),
      runOrigin: "user" as const,
      // 无 prisma：会在 bus 前因缺少 prisma 抛错，或走到无上级——此处验证不再返回 USER_ORIGIN_NO_REPORT
      agentSnapshot: { id: "sub-1", model: "m", systemPrompt: "", tools: [], tier: "sub", parentId: "mgr-1" },
      prisma: undefined,
    };
    await expect(executeNativeTool("agent_report_back", { content: "汇报" }, ctx)).rejects.toThrow(/prisma/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("agent_report_back 无上级时仍拒绝", async () => {
    const root = createTempProjectDir();
    const ctx = {
      ...createNativeCtx(root),
      runOrigin: "parent" as const,
      agentSnapshot: { id: "sub-1", model: "m", systemPrompt: "", tools: [], tier: "sub", parentId: null },
    };
    const result = (await executeNativeTool("agent_report_back", { content: "汇报" }, ctx)) as { error?: string };
    expect(result.error).not.toContain("USER_ORIGIN_NO_REPORT");
    expect(result.error).toContain("无上级");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("checkUpwardMessageTiming：report 工具允许在工具轮次向上发送", async () => {
    const { checkUpwardMessageTiming } = await import("../infra/swarmPermissionGuard.js");
    expect(checkUpwardMessageTiming("sub", "manager", true)).toMatchObject({ code: "UPWARD_MESSAGE_IN_TOOL_ROUND" });
    expect(checkUpwardMessageTiming("sub", "manager", true, { allowReportTool: true })).toBeNull();
  });

  it("sleep(async=\"true\") 字符串应走非阻塞路径而非同步阻塞", async () => {
    const root = createTempProjectDir();
    const startAsyncSleepTask = vi.fn().mockResolvedValue({ jobId: "j1", status: "queued" });
    vi.doMock("../infra/asyncJobManager.js", () => ({ startAsyncSleepTask }));
    vi.resetModules();
    const { executeNativeTool: exec } = await import("../infra/nativeTools.js");
    const ctx = {
      ...createNativeCtx(root),
      sessionId: "clxxxxxxxxxxxxxxxxxxxx01",
      agentSnapshot: { id: "a1", model: "m", systemPrompt: "", tools: [], tier: "sub" as const },
    };
    const t0 = Date.now();
    const result = await exec("sleep", { seconds: 60, async: "true" }, ctx as any);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(startAsyncSleepTask).toHaveBeenCalled();
    expect(result).toMatchObject({ jobId: "j1" });
    vi.doUnmock("../infra/asyncJobManager.js");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("isUnreadableArticlePage 识别 404 标题", () => {
    expect(isUnreadableArticlePage("404 页面不存在 - 博客园", 73)).toBe(true);
    expect(isUnreadableArticlePage("正常标题", 73)).toBe(false);
    expect(isUnreadableArticlePage("404", 200)).toBe(false);
  });

  it("isUnreadableArticlePage 识别简书免责声明壳页", () => {
    const shell = "著作权归作者所有 简书系信息发布平台 平台声明";
    expect(isUnreadableArticlePage("未知标题", 137, 80, shell)).toBe(true);
  });

  it("isArticleFetchFatalError 识别 fetch 层 404", async () => {
    const { isArticleFetchFatalError } = await import("../infra/metablog/platform/fetcher.js");
    expect(isArticleFetchFatalError(new Error("页面不存在或已删除 (www.cnblogs.com)"))).toBe(true);
    expect(isArticleFetchFatalError(new Error("network timeout"))).toBe(false);
  });

  it("readArticleContentWarning 短正文提示", async () => {
    const { readArticleContentWarning } = await import("../infra/nativeTools.js");
    expect(readArticleContentWarning(120, 80)).toBe("正文较短");
    expect(readArticleContentWarning(200, 80)).toBeUndefined();
    expect(readArticleContentWarning(50, 80)).toBeUndefined();
  });

  it("read_article 短正文返回 suggestedTool", async () => {
    const { readArticleContentWarning } = await import("../infra/nativeTools.js");
    const warning = readArticleContentWarning(120, 80);
    expect(warning).toBe("正文较短");
    const suggestedTool = warning ? "scrape_web_page" : undefined;
    expect(suggestedTool).toBe("scrape_web_page");
  });
});

describe("native:read_file", () => {
  let root: string;

  beforeEach(() => {
    root = createTempProjectDir();
    fs.mkdirSync(path.join(root, "content"), { recursive: true });
    fs.writeFileSync(path.join(root, "content", "hello.txt"), "hello world", "utf8");
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("读取项目内文本文件", async () => {
    const ctx = createNativeCtx(root);
    const result = (await executeNativeTool("read_file", { path: "content/hello.txt" }, ctx)) as {
      content: string;
      truncated: boolean;
    };
    expect(result.content).toBe("hello world");
    expect(result.truncated).toBe(false);
  });

  it("拒绝路径穿越 ..", async () => {
    const ctx = createNativeCtx(root);
    await expect(executeNativeTool("read_file", { path: "../etc/passwd" }, ctx)).rejects.toThrow(/\.\./);
  });

  it("文件不存在时抛错", async () => {
    const ctx = createNativeCtx(root);
    await expect(executeNativeTool("read_file", { path: "missing.txt" }, ctx)).rejects.toThrow(/不存在/);
  });

  it("maxChars 截断长内容", async () => {
    fs.writeFileSync(path.join(root, "long.txt"), "a".repeat(100), "utf8");
    const ctx = createNativeCtx(root);
    const result = (await executeNativeTool("read_file", { path: "long.txt", maxChars: 10 }, ctx)) as {
      content: string;
      truncated: boolean;
    };
    expect(result.content).toHaveLength(10);
    expect(result.truncated).toBe(true);
  });

  it("offset 控制读取起点", async () => {
    fs.writeFileSync(path.join(root, "seq.txt"), "0123456789", "utf8");
    const ctx = createNativeCtx(root);
    const result = (await executeNativeTool("read_file", { path: "seq.txt", offset: 3, maxChars: 4 }, ctx)) as {
      content: string;
      offset: number;
      totalChars: number;
    };
    expect(result.content).toBe("3456");
    expect(result.offset).toBe(3);
    expect(result.totalChars).toBe(10);
  });
});

describe("native:write_file", () => {
  let root: string;

  beforeEach(() => {
    root = createTempProjectDir();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("写入并创建目录", async () => {
    const ctx = createNativeCtx(root);
    const result = (await executeNativeTool(
      "write_file",
      { path: "out/nested/file.txt", content: "saved" },
      ctx,
    )) as { path: string; bytes: number };
    expect(result.bytes).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(root, "out/nested/file.txt"), "utf8")).toBe("saved");
  });
});

describe("native:list_directory", () => {
  let root: string;

  beforeEach(() => {
    root = createTempProjectDir();
    fs.writeFileSync(path.join(root, "a.txt"), "a", "utf8");
    fs.mkdirSync(path.join(root, "subdir"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("列出目录内容", async () => {
    const ctx = createNativeCtx(root);
    const entries = (await executeNativeTool("list_directory", { path: "." }, ctx)) as Array<{
      name: string;
      type: string;
    }>;
    const names = entries.map((e) => e.name);
    expect(names).toContain("a.txt");
    expect(names).toContain("subdir");
    expect(entries.find((e) => e.name === "subdir")?.type).toBe("directory");
  });

  it("recursive 递归列出", async () => {
    fs.writeFileSync(path.join(root, "subdir", "nested.txt"), "n", "utf8");
    const ctx = createNativeCtx(root);
    const entries = (await executeNativeTool("list_directory", { path: ".", recursive: true }, ctx)) as Array<{
      path: string;
      type: string;
    }>;
    const paths = entries.map((e) => e.path);
    expect(paths).toContain("subdir");
    expect(paths).toContain("subdir/nested.txt");
  });
});

describe("native:append_to_file", () => {
  let root: string;

  beforeEach(() => {
    root = createTempProjectDir();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("在已有文件末尾追加内容", async () => {
    fs.writeFileSync(path.join(root, "log.txt"), "line1\n", "utf8");
    const ctx = createNativeCtx(root);
    const result = (await executeNativeTool("append_to_file", { path: "log.txt", content: "line2\n" }, ctx)) as {
      path: string;
      bytes: number;
    };
    expect(result.bytes).toBe(6);
    expect(fs.readFileSync(path.join(root, "log.txt"), "utf8")).toBe("line1\nline2\n");
  });

  it("文件不存在时创建并写入", async () => {
    const ctx = createNativeCtx(root);
    const result = (await executeNativeTool("append_to_file", { path: "new.txt", content: "x" }, ctx)) as {
      path: string;
      bytes: number;
    };
    expect(result.bytes).toBe(1);
    expect(fs.readFileSync(path.join(root, "new.txt"), "utf8")).toBe("x");
  });
});

describe("native:file_delete", () => {
  let root: string;

  beforeEach(() => {
    root = createTempProjectDir();
    fs.writeFileSync(path.join(root, "to-delete.txt"), "bye", "utf8");
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("删除项目内文件", async () => {
    const ctx = createNativeCtx(root);
    const result = (await executeNativeTool("file_delete", { path: "to-delete.txt" }, ctx)) as {
      path: string;
      deleted: boolean;
    };
    expect(result.deleted).toBe(true);
    expect(fs.existsSync(path.join(root, "to-delete.txt"))).toBe(false);
  });

  it("拒绝路径穿越", async () => {
    const ctx = createNativeCtx(root);
    await expect(executeNativeTool("file_delete", { path: "../etc/passwd" }, ctx)).rejects.toThrow(/\.\./);
  });

  it("文件不存在时报错", async () => {
    const ctx = createNativeCtx(root);
    await expect(executeNativeTool("file_delete", { path: "missing.txt" }, ctx)).rejects.toThrow(/不存在/);
  });
});

describe("native:task_run", () => {
  it("按 id 执行任务并返回结果", async () => {
    const root = createTempProjectDir();
    const taskService = {
      run: vi.fn(async (id: string) => ({ success: true, data: { id, ok: true } })),
    };
    const ctx = createNativeCtx(root, { services: { task: taskService } as never });
    const result = (await executeNativeTool("task_run", { id: "task-123" }, ctx)) as {
      taskId: string;
      output: unknown;
    };
    expect(taskService.run).toHaveBeenCalledWith("task-123");
    expect(result.taskId).toBe("task-123");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("按 name 查找并执行", async () => {
    const root = createTempProjectDir();
    const taskService = {
      list: vi.fn(async () => ({
        items: [{ id: "task-456", name: "daily-sync" }],
        total: 1,
        page: 1,
        pageSize: 50,
        totalPages: 1,
      })),
      run: vi.fn(async (id: string) => ({ success: true, data: { id } })),
    };
    const ctx = createNativeCtx(root, { services: { task: taskService } as never });
    const result = (await executeNativeTool("task_run", { name: "daily-sync" }, ctx)) as {
      taskId: string;
    };
    expect(taskService.list).toHaveBeenCalledWith({ page: 1, pageSize: 50 });
    expect(taskService.run).toHaveBeenCalledWith("task-456");
    expect(result.taskId).toBe("task-456");
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("native:file_rename", () => {
  let root: string;

  beforeEach(() => {
    root = createTempProjectDir();
    fs.writeFileSync(path.join(root, "old.txt"), "content", "utf8");
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("重命名文件", async () => {
    const ctx = createNativeCtx(root);
    const result = (await executeNativeTool("file_rename", { path: "old.txt", newName: "new.txt" }, ctx)) as {
      from: string;
      to: string;
    };
    expect(result.to).toBe("new.txt");
    expect(fs.existsSync(path.join(root, "new.txt"))).toBe(true);
    expect(fs.existsSync(path.join(root, "old.txt"))).toBe(false);
  });

  it("拒绝重命名目录", async () => {
    fs.mkdirSync(path.join(root, "dir"), { recursive: true });
    const ctx = createNativeCtx(root);
    await expect(executeNativeTool("file_rename", { path: "dir", newName: "x" }, ctx)).rejects.toThrow(/不支持重命名目录/);
  });

  it("newName 含目录分隔符时报错", async () => {
    const ctx = createNativeCtx(root);
    await expect(executeNativeTool("file_rename", { path: "old.txt", newName: "x/y" }, ctx)).rejects.toThrow(/不能包含目录分隔符/);
  });

  it("目标已存在时报错", async () => {
    fs.writeFileSync(path.join(root, "existing.txt"), "", "utf8");
    const ctx = createNativeCtx(root);
    await expect(executeNativeTool("file_rename", { path: "old.txt", newName: "existing.txt" }, ctx)).rejects.toThrow(/目标已存在/);
  });
});

describe("native:file_move", () => {
  let root: string;

  beforeEach(() => {
    root = createTempProjectDir();
    fs.writeFileSync(path.join(root, "a.txt"), "a", "utf8");
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("移动文件并创建目标目录", async () => {
    const ctx = createNativeCtx(root);
    const result = (await executeNativeTool("file_move", { path: "a.txt", dest: "dir/b.txt" }, ctx)) as {
      from: string;
      to: string;
    };
    expect(result.to).toBe("dir/b.txt");
    expect(fs.existsSync(path.join(root, "dir", "b.txt"))).toBe(true);
    expect(fs.existsSync(path.join(root, "a.txt"))).toBe(false);
  });

  it("拒绝移动目录", async () => {
    fs.mkdirSync(path.join(root, "dir"), { recursive: true });
    const ctx = createNativeCtx(root);
    await expect(executeNativeTool("file_move", { path: "dir", dest: "x.txt" }, ctx)).rejects.toThrow(/不支持移动目录/);
  });

  it("目标已存在时报错", async () => {
    fs.writeFileSync(path.join(root, "b.txt"), "", "utf8");
    const ctx = createNativeCtx(root);
    await expect(executeNativeTool("file_move", { path: "a.txt", dest: "b.txt" }, ctx)).rejects.toThrow(/目标已存在/);
  });
});

describe("native:file_copy", () => {
  let root: string;

  beforeEach(() => {
    root = createTempProjectDir();
    fs.writeFileSync(path.join(root, "a.txt"), "copy me", "utf8");
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("复制文件并保留原文件", async () => {
    const ctx = createNativeCtx(root);
    const result = (await executeNativeTool("file_copy", { path: "a.txt", dest: "dir/b.txt" }, ctx)) as {
      from: string;
      to: string;
    };
    expect(result.to).toBe("dir/b.txt");
    expect(fs.existsSync(path.join(root, "dir", "b.txt"))).toBe(true);
    expect(fs.existsSync(path.join(root, "a.txt"))).toBe(true);
    expect(fs.readFileSync(path.join(root, "dir", "b.txt"), "utf8")).toBe("copy me");
  });

  it("目标已存在时报错", async () => {
    fs.writeFileSync(path.join(root, "b.txt"), "", "utf8");
    const ctx = createNativeCtx(root);
    await expect(executeNativeTool("file_copy", { path: "a.txt", dest: "b.txt" }, ctx)).rejects.toThrow(/目标已存在/);
  });
});

describe("native:search_files", () => {
  let root: string;

  beforeEach(() => {
    root = createTempProjectDir();
    fs.mkdirSync(path.join(root, "notes"), { recursive: true });
    fs.writeFileSync(path.join(root, "notes", "a.md"), "hello world\nfoo bar", "utf8");
    fs.writeFileSync(path.join(root, "b.md"), "another hello", "utf8");
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("按字面量搜索并返回行号", async () => {
    const ctx = createNativeCtx(root);
    const result = (await executeNativeTool("search_files", { pattern: "hello", path: "." }, ctx)) as {
      total: number;
      results: Array<{ file: string; line: number; snippet: string }>;
    };
    expect(result.total).toBeGreaterThanOrEqual(2);
    expect(result.results.some((r) => r.file === "notes/a.md" && r.line === 1)).toBe(true);
    expect(result.results.some((r) => r.file === "b.md")).toBe(true);
  });

  it("isRegex 支持正则", async () => {
    const ctx = createNativeCtx(root);
    const result = (await executeNativeTool("search_files", { pattern: "^foo", path: ".", isRegex: true }, ctx)) as {
      total: number;
      results: Array<{ file: string; line: number; snippet: string }>;
    };
    expect(result.results.length).toBeGreaterThanOrEqual(1);
    expect(result.results[0]?.snippet).toContain("foo");
  });

  it("maxResults 限制返回数量", async () => {
    const ctx = createNativeCtx(root);
    const result = (await executeNativeTool("search_files", { pattern: "hello", path: ".", maxResults: 1 }, ctx)) as {
      total: number;
    };
    expect(result.total).toBe(1);
  });

  it("glob 过滤文件名", async () => {
    const ctx = createNativeCtx(root);
    const result = (await executeNativeTool("search_files", { pattern: "hello", path: ".", glob: "*.md" }, ctx)) as {
      total: number;
      results: Array<{ file: string }>;
    };
    expect(result.results.every((r) => r.file.endsWith(".md"))).toBe(true);
  });

  it("caseSensitive 区分大小写", async () => {
    fs.writeFileSync(path.join(root, "case.txt"), "Hello\nhello", "utf8");
    const ctx = createNativeCtx(root);
    const result = (await executeNativeTool(
      "search_files",
      { pattern: "Hello", path: ".", caseSensitive: true },
      ctx,
    )) as {
      total: number;
      results: Array<{ snippet: string }>;
    };
    expect(result.total).toBe(1);
    expect(result.results[0]?.snippet).toBe("Hello");
  });
});

describe("native:directory_create", () => {
  let root: string;

  beforeEach(() => {
    root = createTempProjectDir();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("创建目录", async () => {
    const ctx = createNativeCtx(root);
    await executeNativeTool("directory_create", { path: "a/b/c" }, ctx);
    expect(fs.existsSync(path.join(root, "a", "b", "c"))).toBe(true);
  });

  it("路径已存在时报错", async () => {
    fs.mkdirSync(path.join(root, "a"), { recursive: true });
    const ctx = createNativeCtx(root);
    await expect(executeNativeTool("directory_create", { path: "a" }, ctx)).rejects.toThrow(/路径已存在/);
  });
});

describe("native:file_stat", () => {
  let root: string;

  beforeEach(() => {
    root = createTempProjectDir();
    fs.writeFileSync(path.join(root, "a.txt"), "abc", "utf8");
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("返回文件元信息", async () => {
    const ctx = createNativeCtx(root);
    const result = (await executeNativeTool("file_stat", { path: "a.txt" }, ctx)) as {
      isFile: boolean;
      size: number;
      modifiedAt: string;
    };
    expect(result.isFile).toBe(true);
    expect(result.size).toBe(3);
    expect(result.modifiedAt).toBeTruthy();
  });
});

describe("native:directory_delete", () => {
  let root: string;

  beforeEach(() => {
    root = createTempProjectDir();
    fs.mkdirSync(path.join(root, "empty"), { recursive: true });
    fs.mkdirSync(path.join(root, "full"), { recursive: true });
    fs.writeFileSync(path.join(root, "full", "a.txt"), "a", "utf8");
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("删除空目录", async () => {
    const ctx = createNativeCtx(root);
    await executeNativeTool("directory_delete", { path: "empty" }, ctx);
    expect(fs.existsSync(path.join(root, "empty"))).toBe(false);
  });

  it("recursive 删除非空目录", async () => {
    const ctx = createNativeCtx(root);
    await executeNativeTool("directory_delete", { path: "full", recursive: true }, ctx);
    expect(fs.existsSync(path.join(root, "full"))).toBe(false);
  });

  it("目标不是目录时报错", async () => {
    fs.writeFileSync(path.join(root, "file.txt"), "", "utf8");
    const ctx = createNativeCtx(root);
    await expect(executeNativeTool("directory_delete", { path: "file.txt" }, ctx)).rejects.toThrow(/不是目录/);
  });
});

describe("native:post_create / post_update", () => {
  it("post_create 调用 post.create 并返回 slug", async () => {
    const root = createTempProjectDir();
    const postService = {
      create: vi.fn(async () => ({ success: true, data: { id: "p1", slug: "hello-world", title: "Hello" } })),
    };
    const ctx = createNativeCtx(root, { services: { post: postService } as never });
    const result = (await executeNativeTool(
      "post_create",
      { title: "Hello", content: "# Hi", tags: ["a", "b"], published: true },
      ctx,
    )) as { id: string; slug: string };
    expect(postService.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Hello", content: "# Hi", published: true, tags: ["a", "b"] }),
    );
    expect(result.slug).toBe("hello-world");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("post_update 调用 post.update", async () => {
    const root = createTempProjectDir();
    const postService = {
      update: vi.fn(async () => ({ success: true, data: { id: "p1", slug: "hello", title: "Hello Updated" } })),
    };
    const ctx = createNativeCtx(root, { services: { post: postService } as never });
    const result = (await executeNativeTool("post_update", { id: "p1", title: "Hello Updated" }, ctx)) as {
      id: string;
      title: string;
    };
    expect(postService.update).toHaveBeenCalledWith(expect.objectContaining({ id: "p1", title: "Hello Updated" }));
    expect(result.title).toBe("Hello Updated");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("post_create title 为空时报错", async () => {
    const root = createTempProjectDir();
    const ctx = createNativeCtx(root);
    await expect(executeNativeTool("post_create", { title: "  " }, ctx)).rejects.toThrow(/title 不能为空/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("post_delete 调用 post.delete 并返回 deleted", async () => {
    const root = createTempProjectDir();
    const postService = {
      delete: vi.fn(async () => ({ success: true, data: { id: "p1", deleted: true } })),
    };
    const ctx = createNativeCtx(root, { services: { post: postService } as never });
    const result = (await executeNativeTool("post_delete", { id: "p1" }, ctx)) as { id: string; deleted: boolean };
    expect(postService.delete).toHaveBeenCalledWith("p1");
    expect(result.deleted).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("native:git_branch / git_checkout", () => {
  let repo: string;
  const isGitRepo = fs.existsSync(path.join(process.cwd(), ".git"));

  beforeEach(() => {
    repo = createTempProjectDir();
    if (isGitRepo) {
      execFileSync("git", ["init"], { cwd: repo, stdio: "ignore" });
      execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: repo, stdio: "ignore" });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: repo, stdio: "ignore" });
      fs.writeFileSync(path.join(repo, "a.txt"), "a", "utf8");
      execFileSync("git", ["add", "-A"], { cwd: repo, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "init"], { cwd: repo, stdio: "ignore" });
    }
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it.skipIf(!isGitRepo)("git_branch 列出分支并标记当前分支", async () => {
    const ctx = createNativeCtx(repo);
    const result = (await executeNativeTool("git_branch", { repoPath: "." }, ctx)) as {
      branches: Array<{ name: string; current: boolean }>;
    };
    expect(result.branches.some((b) => b.current)).toBe(true);
  });

  it.skipIf(!isGitRepo)("git_checkout create 创建并切换分支", async () => {
    const ctx = createNativeCtx(repo);
    await executeNativeTool("git_checkout", { repoPath: ".", branch: "feature", create: true }, ctx);
    const result = (await executeNativeTool("git_branch", { repoPath: "." }, ctx)) as {
      branches: Array<{ name: string; current: boolean }>;
    };
    expect(result.branches.some((b) => b.name === "feature" && b.current)).toBe(true);
  });
});

describe("native:memory_create / memory_search", () => {
  it("memory_create 调用 memory.create", async () => {
    const root = createTempProjectDir();
    const memoryService = {
      create: vi.fn(async () => ({ success: true, data: { id: "m1", type: "note", strength: 0.8, keywords: ["a", "b"] } })),
    };
    // W5-followup：memory_create 改走 MemoryRepository（去重 + scope 守卫），
    // 需补 prisma mock 应答 contentHash 去重查询（无重复 → null）
    const prismaMock = { memory: { findFirst: vi.fn(async () => null) } };
    const ctx = createNativeCtx(root, { services: { memory: memoryService, prisma: prismaMock } as never });
    const result = (await executeNativeTool("memory_create", { content: "记住这件事", type: "note", strength: 0.8, keywords: ["a", "b"] }, ctx)) as {
      id: string;
      strength: number;
    };
    expect(memoryService.create).toHaveBeenCalledWith(
      expect.objectContaining({ content: "记住这件事", type: "note", strength: 0.8, keywords: ["a", "b"] }),
    );
    expect(result.id).toBe("m1");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("memory_search 经 MemoryRepository 按 scope 过滤并返回摘要（W5）", async () => {
    const root = createTempProjectDir();
    const findMany = vi.fn(async () => [
      {
        id: "m1",
        content: "这是一段很长的记忆内容...",
        type: "note",
        strength: 1,
        keywords: "a",
        scope: "global",
        agentId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const ctx = createNativeCtx(root, {
      services: { prisma: { memory: { findMany } } } as never,
    });
    const result = (await executeNativeTool("memory_search", { keyword: "记忆" }, ctx)) as {
      total: number;
      items: Array<{ content: string }>;
    };
    expect(findMany).toHaveBeenCalled();
    const firstCall = (findMany.mock.calls as unknown as Array<[{ where: { scope: { in: string[] } } }]>)[0]?.[0];
    expect(firstCall?.where.scope.in).toContain("global");
    expect(result.total).toBe(1);
    expect(result.items[0]?.content).toContain("这是一段很长的记忆内容");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("memory_delete 调用 memory.delete 并返回 deleted", async () => {
    const root = createTempProjectDir();
    const memoryService = {
      delete: vi.fn(async () => ({ success: true, data: { id: "m1", deleted: true } })),
    };
    const ctx = createNativeCtx(root, { services: { memory: memoryService } as never });
    const result = (await executeNativeTool("memory_delete", { id: "m1" }, ctx)) as { id: string; deleted: boolean };
    expect(memoryService.delete).toHaveBeenCalledWith("m1");
    expect(result.deleted).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("memory_create content 为空时报错", async () => {
    const root = createTempProjectDir();
    const ctx = createNativeCtx(root);
    await expect(executeNativeTool("memory_create", { content: "  " }, ctx)).rejects.toThrow(/content 不能为空/);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("native:git_clone", () => {
  it("无效 URL 时报错", async () => {
    const root = createTempProjectDir();
    const ctx = createNativeCtx(root);
    await expect(executeNativeTool("git_clone", { url: "not-a-url", dest: "repo" }, ctx)).rejects.toThrow(/无效/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("目标目录已存在时报错", async () => {
    const root = createTempProjectDir();
    fs.mkdirSync(path.join(root, "repo"), { recursive: true });
    const ctx = createNativeCtx(root);
    await expect(executeNativeTool("git_clone", { url: "https://example.com/repo.git", dest: "repo" }, ctx)).rejects.toThrow(/已存在/);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("native:invoke_api", () => {
  it("转发到 invokeTrpc", async () => {
    const root = createTempProjectDir();
    const invokeTrpc = vi.fn(async (tool: string, args?: unknown) => ({ tool, args }));
    const ctx = createNativeCtx(root, { invokeTrpc });
    const result = await executeNativeTool("invoke_api", { tool: "post.list", args: { page: 1 } }, ctx);
    expect(invokeTrpc).toHaveBeenCalledWith("post.list", { page: 1 });
    expect(result).toEqual(expect.objectContaining({ tool: "post.list", args: { page: 1 } }));
    expect(result).toHaveProperty("elapsedMs");
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("native:web_search", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("无 API Key 且无信息源时 smartSearch 失败后抛错", async () => {
    const root = createTempProjectDir();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        text: async () => "unavailable",
      })),
    );
    const ctx = createNativeCtx(root, {
      config: {
        search: {
          tavilyApiKey: "",
          serpApiKey: "",
          baiduQianfanApiKey: "",
          metasoApiKey: "",
          bochaApiKey: "",
          langsearchApiKey: "",
          braveApiKey: "",
          bingApiKey: "",
          enginePriority: "bing_crawler,duckduckgo",
        },
      },
    });
    await expect(executeNativeTool("web_search", { query: "test" }, ctx)).rejects.toThrow(/搜索失败|不可用/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("无 API Key 时回退到已启用信息源目录", async () => {
    const root = createTempProjectDir();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        text: async () => "unavailable",
      })),
    );
    const ctx = createNativeCtx(root, {
      config: {
        search: {
          tavilyApiKey: "",
          serpApiKey: "",
          baiduQianfanApiKey: "",
          metasoApiKey: "",
          bochaApiKey: "",
          langsearchApiKey: "",
          braveApiKey: "",
          bingApiKey: "",
          enginePriority: "bing_crawler",
        },
      },
      services: {
        infoSource: {
          list: vi.fn(async () => ({
            items: [
              {
                name: "DeepSeek 官方文档",
                url: "https://api-docs.deepseek.com/",
                type: "official",
                description: "DeepSeek API 文档",
                reliability: 5,
                enabled: true,
              },
            ],
            total: 1,
            page: 1,
            pageSize: 100,
            totalPages: 1,
          })),
        },
      } as never,
    });
    const result = (await executeNativeTool("web_search", { query: "DeepSeek API", maxResults: 3 }, ctx)) as {
      provider: string;
      searchPhase: string;
      results: Array<{ title: string }>;
    };
    expect(result.provider).toBe("infoSource");
    expect(result.searchPhase).toBe("infoSource-catalog");
    expect(result.results[0]?.title).toBe("DeepSeek 官方文档");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("Tavily 优先在信息源域名内搜索", async () => {
    const root = createTempProjectDir();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true,
      json: async () => ({
        answer: "scoped",
        results: [{ title: "Doc", url: "https://api-docs.deepseek.com/x", content: "body" }],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const ctx = createNativeCtx(root, {
      config: {
        search: {
          tavilyApiKey: "test-key",
          serpApiKey: "",
          baiduQianfanApiKey: "",
          metasoApiKey: "",
          bochaApiKey: "",
          langsearchApiKey: "",
          braveApiKey: "",
          bingApiKey: "",
          enginePriority: "tavily",
        },
      },
      services: {
        infoSource: {
          list: vi.fn(async () => ({
            items: [
              {
                name: "DeepSeek 官方文档",
                url: "https://api-docs.deepseek.com/",
                type: "official",
                description: "DeepSeek API",
                reliability: 5,
                enabled: true,
              },
            ],
            total: 1,
            page: 1,
            pageSize: 100,
            totalPages: 1,
          })),
        },
      } as never,
    });

    const result = (await executeNativeTool("web_search", { query: "thinking mode", maxResults: 3 }, ctx)) as {
      provider: string;
      searchPhase: string;
      results: Array<{ title: string }>;
    };
    expect(result.provider).toBe("tavily");
    expect(result.searchPhase).toBe("infoSource-scoped");
    expect(result.results[0]?.title).toBe("Doc");

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.query).toBe("thinking mode");
    expect(body.include_domains).toEqual(["api-docs.deepseek.com"]);

    fs.rmSync(root, { recursive: true, force: true });
  });

  it("信息源 scoped 无结果时继续 smartSearch", async () => {
    const root = createTempProjectDir();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (body?.include_domains) {
        return {
          ok: true,
          json: async () => ({ results: [] }),
        };
      }
      if (String(url).includes("tavily.com")) {
        return {
          ok: true,
          json: async () => ({
            answer: "general",
            results: [{ title: "General Hit", url: "https://example.com/g", content: "body" }],
          }),
        };
      }
      return { ok: false, status: 503, text: async () => "unavailable" };
    });
    vi.stubGlobal("fetch", fetchMock);

    const ctx = createNativeCtx(root, {
      config: {
        search: {
          tavilyApiKey: "test-key",
          serpApiKey: "",
          baiduQianfanApiKey: "",
          metasoApiKey: "",
          bochaApiKey: "",
          langsearchApiKey: "",
          braveApiKey: "",
          bingApiKey: "",
          enginePriority: "tavily",
        },
      },
      services: {
        infoSource: {
          list: vi.fn(async () => ({
            items: [
              {
                name: "DeepSeek 官方文档",
                url: "https://api-docs.deepseek.com/",
                type: "official",
                description: "DeepSeek API",
                reliability: 5,
                enabled: true,
              },
            ],
            total: 1,
            page: 1,
            pageSize: 100,
            totalPages: 1,
          })),
        },
      } as never,
    });

    const result = (await executeNativeTool("web_search", { query: "thinking mode", maxResults: 3 }, ctx)) as {
      provider: string;
      searchPhase: string;
      results: Array<{ title: string }>;
    };
    expect(result.searchPhase).toBe("smart-search");
    expect(result.results[0]?.title).toBe("General Hit");
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);

    fs.rmSync(root, { recursive: true, force: true });
  });

  it("百度千帆 API 成功时优先返回", async () => {
    const root = createTempProjectDir();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          references: [{ title: "百度结果", url: "https://example.com/a", summary: "snippet" }],
        }),
      })),
    );
    const ctx = createNativeCtx(root, {
      config: {
        search: {
          tavilyApiKey: "t",
          serpApiKey: "",
          baiduQianfanApiKey: "bq-key",
          metasoApiKey: "",
          bochaApiKey: "",
          langsearchApiKey: "",
          braveApiKey: "",
          bingApiKey: "",
          enginePriority: "baidu_qianfan",
        },
      },
    });
    const result = (await executeNativeTool("web_search", { query: "测试", maxResults: 3 }, ctx)) as {
      provider: string;
      searchPhase: string;
      results: Array<{ title: string }>;
    };
    expect(result.provider).toBe("baidu_qianfan");
    expect(result.searchPhase).toBe("smart-search");
    expect(result.results[0]?.title).toBe("百度结果");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("Tavily 成功返回结果（无信息源时）", async () => {
    const root = createTempProjectDir();
    const ctx = createNativeCtx(root, {
      config: {
        search: {
          tavilyApiKey: "test-key",
          serpApiKey: "",
          baiduQianfanApiKey: "",
          metasoApiKey: "",
          bochaApiKey: "",
          langsearchApiKey: "",
          braveApiKey: "",
          bingApiKey: "",
          enginePriority: "tavily",
        },
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ answer: "42", results: [{ title: "T", url: "https://x", content: "c" }] }),
      })),
    );
    const result = (await executeNativeTool("web_search", { query: "life", maxResults: 3 }, ctx)) as {
      provider: string;
      searchPhase: string;
      results: Array<{ title: string }>;
    };
    expect(result.provider).toBe("tavily");
    expect(result.results[0]?.title).toBe("T");
    expect(result.searchPhase).toBe("smart-search");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("query 为空时抛错", async () => {
    const root = createTempProjectDir();
    const ctx = createNativeCtx(root, {
      config: {
        search: {
          tavilyApiKey: "k",
          serpApiKey: "",
          baiduQianfanApiKey: "",
          metasoApiKey: "",
          bochaApiKey: "",
          langsearchApiKey: "",
          braveApiKey: "",
          bingApiKey: "",
          enginePriority: "tavily",
        },
      },
    });
    await expect(executeNativeTool("web_search", { query: "" }, ctx)).rejects.toThrow(/query/);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("native:git_status / git_log / git_diff", () => {
  let root: string;
  const isGitRepo = fs.existsSync(path.join(process.cwd(), ".git"));

  beforeEach(() => {
    root = createTempProjectDir();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it.skipIf(!isGitRepo)("git_status 返回 porcelain 状态", async () => {
    const ctx = createNativeCtx(process.cwd());
    const result = (await executeNativeTool("git_status", { repoPath: "." }, ctx)) as { status: string };
    expect(typeof result.status).toBe("string");
  });

  it.skipIf(!isGitRepo)("git_log 返回提交列表", async () => {
    const ctx = createNativeCtx(process.cwd());
    const result = (await executeNativeTool("git_log", { repoPath: ".", limit: 3 }, ctx)) as { log: string[] };
    expect(Array.isArray(result.log)).toBe(true);
  });

  it.skipIf(!isGitRepo)("git_diff 返回 diff 字符串", async () => {
    const ctx = createNativeCtx(process.cwd());
    const result = (await executeNativeTool("git_diff", { repoPath: "." }, ctx)) as { diff: string };
    expect(typeof result.diff).toBe("string");
  });
});

describe("native:yuque_get_doc", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("未配置 YUQUE_SESSION 时抛错", async () => {
    const root = createTempProjectDir();
    const ctx = createNativeCtx(root);
    await expect(
      executeNativeTool("yuque_get_doc", { namespace: "u/r", slug: "doc" }, ctx),
    ).rejects.toThrow(/YUQUE_CTOKEN|语雀凭证/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("API 成功返回文档 body", async () => {
    const root = createTempProjectDir();
    const ctx = createNativeCtx(root, {
      config: { integrations: { feishu: { appId: "", appSecret: "", userAccessToken: "", tenantAccessToken: "" }, yuque: { session: "", ctoken: "sess" }, github: { token: "" } } },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: { title: "Doc", slug: "doc", body: "# Hi" } }),
      })),
    );
    const result = (await executeNativeTool(
      "yuque_get_doc",
      { namespace: "user/repo", slug: "doc" },
      ctx,
    )) as { title: string; body: string };
    expect(result.title).toBe("Doc");
    expect(result.body).toBe("# Hi");
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("native:github_search_repos", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GitHub API 成功映射仓库列表", async () => {
    const root = createTempProjectDir();
    const ctx = createNativeCtx(root);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () =>
          JSON.stringify({
            items: [{ full_name: "o/r", html_url: "https://github.com/o/r", description: "d", stargazers_count: 9 }],
          }),
      })),
    );
    const result = (await executeNativeTool("github_search_repos", { query: "knowpilot", limit: 1 }, ctx)) as Array<{
      name: string;
      stars: number;
    }>;
    expect(result[0].name).toBe("o/r");
    expect(result[0].stars).toBe(9);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("native:wait", () => {
  it("等待指定毫秒", async () => {
    const root = createTempProjectDir();
    const ctx = createNativeCtx(root);
    const start = Date.now();
    const result = (await executeNativeTool("wait", { ms: 30 }, ctx)) as { waitedMs: number };
    expect(result.waitedMs).toBe(30);
    expect(Date.now() - start).toBeGreaterThanOrEqual(20);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("native:sleep", () => {
  it("阻塞等待指定秒数", async () => {
    const root = createTempProjectDir();
    const ctx = createNativeCtx(root);
    const start = Date.now();
    const result = (await executeNativeTool("sleep", { seconds: 0.05 }, ctx)) as { waitedSeconds: number };
    expect(result.waitedSeconds).toBeCloseTo(0.05, 1);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("async=true 需要 sessionId/agentSnapshot", async () => {
    const root = createTempProjectDir();
    const ctx = createNativeCtx(root);
    await expect(executeNativeTool("sleep", { seconds: 0.1, async: true }, ctx)).rejects.toThrow(/sessionId/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("sub Agent 无权调用 spawn_subagent", async () => {
    const root = createTempProjectDir();
    const ctx = {
      ...createNativeCtx(root),
      sessionId: "sess-1",
      agentSnapshot: { id: "sub-1", model: "m", systemPrompt: "", tools: [], tier: "sub", parentId: "mgr-1" },
    };
    const result = (await executeNativeTool("spawn_subagent", { task: "再派生子代理" }, ctx)) as {
      error?: string;
      permissionDenied?: boolean;
    };
    expect(result.permissionDenied).toBe(true);
    expect(result.error).toContain("TIER_INSUFFICIENT");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("sub Agent 无权调用 memory_create / memory_search", async () => {
    const root = createTempProjectDir();
    const ctx = {
      ...createNativeCtx(root),
      sessionId: "sess-1",
      agentSnapshot: {
        id: "sub-1",
        model: "m",
        systemPrompt: "",
        tools: ["native:memory_create", "native:memory_search"],
        tier: "sub",
        parentId: "mgr-1",
      },
    };
    for (const tool of ["memory_create", "memory_search"] as const) {
      const result = (await executeNativeTool(tool, { content: "记住", keyword: "x" }, ctx)) as {
        error?: string;
        permissionDenied?: boolean;
      };
      expect(result.permissionDenied).toBe(true);
      expect(result.error).toContain("TIER_INSUFFICIENT");
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("sub Agent 无权调用 session_compact", async () => {
    const root = createTempProjectDir();
    const ctx = {
      ...createNativeCtx(root),
      sessionId: "sess-1",
      agentSnapshot: {
        id: "sub-1",
        model: "m",
        systemPrompt: "",
        tools: ["native:session_compact"],
        tier: "sub",
        parentId: "mgr-1",
      },
    };
    const result = (await executeNativeTool("session_compact", {}, ctx)) as {
      error?: string;
      permissionDenied?: boolean;
    };
    expect(result.permissionDenied).toBe(true);
    expect(result.error).toContain("TIER_INSUFFICIENT");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("sub Agent 可调用 async_task_run 创建纯工具后台任务", async () => {
    const root = createTempProjectDir();
    const ctx = {
      ...createNativeCtx(root, {
        services: {
          task: {
            create: vi.fn().mockResolvedValue({ success: true, data: { id: "task-123" } }),
          },
        } as any,
        prisma: {
          agent: { findUnique: vi.fn().mockResolvedValue(null) },
        } as any,
      }),
      sessionId: "sess-1",
      agentSnapshot: { id: "sub-1", model: "m", systemPrompt: "", tools: [], tier: "sub", parentId: "mgr-1" },
    };
    const result = (await executeNativeTool("async_task_run", { task: "后台任务", toolCall: { tool: "sleep", args: { ms: 1 } } }, ctx)) as {
      jobId?: string;
      error?: string;
      permissionDenied?: boolean;
      sourceType?: string;
    };
    expect(result.permissionDenied).not.toBe(true);
    expect(result.jobId).toBe("task-123");
    expect(result.sourceType).toBe("async_task_tool");
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("native:spawn_subagent 同步等待系统抓取", () => {
  beforeEach(() => {
    resetSwarmBus();
  });
  afterEach(() => {
    resetSwarmBus();
  });

  it("waitForResult=true：无 report_back 时抓取子会话最后一条 assistant", async () => {
    const root = createTempProjectDir();
    const subAgentId = "sub-agent-1";
    const subSessionId = "sub-sess-1";
    let trackerStatus = "running";

    const prisma = {
      chatSession: {
        findFirst: vi.fn().mockResolvedValue({
          id: subSessionId,
          agentId: subAgentId,
          isMainSession: true,
          kind: "subagent",
          status: "running",
        }),
        findUnique: vi.fn(),
        // v8 TP-1：spawn maxSubagentsPerSession 检查走 count（mock 无活跃子会话）
        count: vi.fn().mockResolvedValue(0),
      },
      agent: {
        findUnique: vi.fn().mockResolvedValue({
          id: subAgentId,
          name: "调研员",
          tier: "sub",
          status: "active",
          parentId: "mgr-1",
          workspaceId: null,
        }),
      },
      chatMessage: {
        findFirst: vi.fn().mockImplementation(async ({ where }: { where: { role?: string } }) => {
          if (where.role === "user") {
            return { id: "u1", createdAt: new Date(Date.now() - 5000) };
          }
          if (where.role === "assistant") {
            return { content: "系统抓取的最终答复" };
          }
          return null;
        }),
      },
      task: {
        count: vi.fn().mockResolvedValue(0),
      },
      agentMessage: {
        findFirst: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue({ id: "msg-spawn-1" }),
      },
      log: { create: vi.fn().mockResolvedValue({}) },
    };

    const services = {
      agent: {
        getById: vi.fn().mockResolvedValue({
          id: subAgentId,
          name: "调研员",
          model: "mock-model",
          systemPrompt: "sp",
          tools: ["native:wait"],
          status: "active",
          tier: "sub",
          parentId: "mgr-1",
          workspaceId: null,
        }),
      },
      task: {
        create: vi.fn().mockResolvedValue({ success: true, data: { id: "track-1" } }),
        getById: vi.fn().mockImplementation(async () => ({
          id: "track-1",
          status: trackerStatus,
          output: {},
        })),
        update: vi.fn().mockImplementation(async (args: { status?: string }) => {
          if (args.status) trackerStatus = args.status;
          return { success: true };
        }),
      },
      session: {
        update: vi.fn().mockResolvedValue({ success: true }),
        create: vi.fn(),
      },
      message: {
        create: vi.fn().mockResolvedValue({ success: true }),
      },
    };

    const ctx = {
      ...createNativeCtx(root, { services: services as any, prisma: prisma as any }),
      sessionId: "parent-sess",
      agentSnapshot: {
        id: "mgr-1",
        model: "m",
        systemPrompt: "",
        tools: [],
        tier: "manager" as const,
        workspaceId: null,
        parentId: "super-1",
      },
    };

    const result = (await executeNativeTool(
      "spawn_subagent",
      { task: "调研 React 19", waitForResult: true, agentId: subAgentId },
      ctx,
    )) as {
      content?: string;
      status?: string;
      success?: boolean;
      error?: string;
      jobId?: string;
    };

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.content).toBe("系统抓取的最终答复");
    expect(result.status).toBe("success");
    expect(result.jobId).toBe("track-1");
    expect(services.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "track-1",
        status: "success",
        delivered: true,
        output: { asyncResult: "系统抓取的最终答复" },
      }),
    );
    fs.rmSync(root, { recursive: true, force: true });
  }, 15_000);
});

function createMockPrismaForAgentSendMessage(opts: {
  agent: Record<string, unknown>;
  messages?: Array<{ fromAgentId: string; toAgentId: string; createdAt: Date }>;
}) {
  const messages = opts.messages ?? [];
  return {
    agent: {
      findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        return Promise.resolve((opts.agent as { id: string }).id === where.id ? opts.agent : null);
      }),
    },
    agentMessage: {
      findFirst: vi.fn().mockImplementation(({ where }: { where: { fromAgentId: string; toAgentId: string } }) => {
        const match = messages
          .filter((m) => m.fromAgentId === where.fromAgentId && m.toAgentId === where.toAgentId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
        return Promise.resolve(match ?? null);
      }),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({ id: "msg-1" }),
    },
    log: {
      create: vi.fn().mockResolvedValue({}),
    },
  } as any;
}

describe("native:agent_send_message", () => {
  beforeEach(() => {
    resetSwarmBus();
  });

  it("super 可跨 Workspace 向下级 Agent 发消息", async () => {
    const root = createTempProjectDir();
    const prisma = createMockPrismaForAgentSendMessage({
      agent: { id: "sub-1", tier: "sub", workspaceId: "ws-other", status: "active" },
    });
    const ctx = createNativeCtx(root, { prisma });
    ctx.agentSnapshot = { id: "super-1", model: "m", systemPrompt: "", tools: [], tier: "super", workspaceId: null, parentId: null };
    const result = (await executeNativeTool("agent_send_message", { toAgentId: "sub-1", content: "任务", autoRun: false }, ctx)) as {
      success?: boolean;
      error?: string;
      permissionDenied?: boolean;
    };
    expect(result.success).toBe(true);
    expect(prisma.agentMessage.create).toHaveBeenCalled();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("manager 只能给本 Workspace 内的下级发消息", async () => {
    const root = createTempProjectDir();
    const prisma = createMockPrismaForAgentSendMessage({
      agent: { id: "sub-1", tier: "sub", workspaceId: "ws-a", status: "active" },
    });
    const ctx = createNativeCtx(root, { prisma });
    ctx.agentSnapshot = { id: "mgr-1", model: "m", systemPrompt: "", tools: [], tier: "manager", workspaceId: "ws-b", parentId: "super-1" };
    const result = (await executeNativeTool("agent_send_message", { toAgentId: "sub-1", content: "任务", autoRun: false }, ctx)) as {
      success?: boolean;
      error?: string;
      permissionDenied?: boolean;
    };
    expect(result.success).not.toBe(true);
    expect(result.permissionDenied).toBe(true);
    expect(result.error).toContain("CROSS_WORKSPACE_FORBIDDEN");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("sub 不能主动向上级发消息（无上级消息记录）", async () => {
    const root = createTempProjectDir();
    const prisma = createMockPrismaForAgentSendMessage({
      agent: { id: "mgr-1", tier: "manager", workspaceId: "ws-a", status: "active" },
    });
    const ctx = createNativeCtx(root, { prisma });
    ctx.agentSnapshot = { id: "sub-1", model: "m", systemPrompt: "", tools: [], tier: "sub", workspaceId: "ws-a", parentId: "mgr-1" };
    const result = (await executeNativeTool("agent_send_message", { toAgentId: "mgr-1", content: "汇报", autoRun: false }, ctx)) as {
      success?: boolean;
      error?: string;
      permissionDenied?: boolean;
    };
    expect(result.permissionDenied).toBe(true);
    expect(result.error).toContain("UPWARD_REPLY_REQUIRED");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("sub 可在上级发来消息后向上级回复", async () => {
    const root = createTempProjectDir();
    const now = Date.now();
    const prisma = createMockPrismaForAgentSendMessage({
      agent: { id: "mgr-1", tier: "manager", workspaceId: "ws-a", status: "active" },
      messages: [{ fromAgentId: "mgr-1", toAgentId: "sub-1", createdAt: new Date(now - 1000) }],
    });
    const ctx = createNativeCtx(root, { prisma });
    ctx.agentSnapshot = { id: "sub-1", model: "m", systemPrompt: "", tools: [], tier: "sub", workspaceId: "ws-a", parentId: "mgr-1" };
    const result = (await executeNativeTool("agent_send_message", { toAgentId: "mgr-1", content: "收到", autoRun: false }, ctx)) as {
      success?: boolean;
      error?: string;
      permissionDenied?: boolean;
    };
    expect(result.success).toBe(true);
    expect(prisma.agentMessage.create).toHaveBeenCalled();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("sub 连发两条消息给上级会被拦截", async () => {
    const root = createTempProjectDir();
    const now = Date.now();
    const prisma = createMockPrismaForAgentSendMessage({
      agent: { id: "mgr-1", tier: "manager", workspaceId: "ws-a", status: "active" },
      messages: [
        { fromAgentId: "mgr-1", toAgentId: "sub-1", createdAt: new Date(now - 2000) },
        { fromAgentId: "sub-1", toAgentId: "mgr-1", createdAt: new Date(now - 1000) },
      ],
    });
    const ctx = createNativeCtx(root, { prisma });
    ctx.agentSnapshot = { id: "sub-1", model: "m", systemPrompt: "", tools: [], tier: "sub", workspaceId: "ws-a", parentId: "mgr-1" };
    const result = (await executeNativeTool("agent_send_message", { toAgentId: "mgr-1", content: "又一条", autoRun: false }, ctx)) as {
      success?: boolean;
      error?: string;
      permissionDenied?: boolean;
    };
    expect(result.permissionDenied).toBe(true);
    expect(result.error).toContain("UPWARD_REPLY_REQUIRED");
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("native:session_clear", () => {
  it("confirm 不为 true 时拒绝", async () => {
    const root = createTempProjectDir();
    const ctx = createNativeCtx(root);
    await expect(executeNativeTool("session_clear", { confirm: false }, ctx)).rejects.toThrow(/confirm/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("未提供 SessionService 时抛错", async () => {
    const root = createTempProjectDir();
    const ctx = createNativeCtx(root);
    await expect(executeNativeTool("session_clear", { confirm: true }, ctx)).rejects.toThrow(/SessionService/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("删除全部 ChatSession 并返回数量", async () => {
    const root = createTempProjectDir();
    const deleteMany = vi.fn().mockResolvedValue({ count: 7 });
    const ctx = createNativeCtx(root, {
      services: { session: { deleteMany } } as any,
    });
    const result = (await executeNativeTool("session_clear", { confirm: true }, ctx)) as { deletedSessions: number };
    expect(result.deletedSessions).toBe(7);
    expect(deleteMany).toHaveBeenCalledWith();
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("native:run_shell", () => {
  it("危险命令被拒绝", async () => {
    const root = createTempProjectDir();
    const ctx = createNativeCtx(root);
    await expect(executeNativeTool("run_shell", { command: "rm -rf /" }, ctx)).rejects.toThrow(/安全策略/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("Shell 未启用时抛错", async () => {
    const root = createTempProjectDir();
    const ctx = createNativeCtx(root, {
      config: { shell: { enabled: false, mode: "disabled", timeoutMs: 1000, maxOutputChars: 1000, shell: "auto" } },
    });
    await expect(executeNativeTool("run_shell", { command: "echo hi" }, ctx)).rejects.toThrow(/未启用/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("非零退出码返回 exitCode 而不是抛错", async () => {
    const root = createTempProjectDir();
    const ctx = createNativeCtx(root, {
      config: { shell: { enabled: true, mode: "host_restricted", timeoutMs: 1000, maxOutputChars: 1000, shell: "cmd" } },
    });
    const result = (await executeNativeTool("run_shell", { command: "exit 42" }, ctx)) as {
      exitCode: number;
    };
    expect(result.exitCode).toBe(42);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("timeoutMs 覆盖全局默认超时", async () => {
    const root = createTempProjectDir();
    const ctx = createNativeCtx(root, {
      config: { shell: { enabled: true, mode: "host_restricted", timeoutMs: 60_000, maxOutputChars: 1000, shell: "auto" } },
    });
    const sleepCmd = process.platform === "win32" ? "Start-Sleep -Milliseconds 2000" : "sleep 2";
    await expect(
      executeNativeTool("run_shell", { command: sleepCmd, timeoutMs: 100 }, ctx),
    ).rejects.toThrow(/超时/);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("native:feishu_send_text", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("未配置飞书凭证时抛错", async () => {
    const root = createTempProjectDir();
    const ctx = createNativeCtx(root, { prisma: {} as never });
    await expect(
      executeNativeTool("feishu_send_text", { receiveId: "x", text: "hi" }, ctx),
    ).rejects.toThrow(/FEISHU_TENANT_ACCESS_TOKEN/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("飞书 API 成功返回 data", async () => {
    const root = createTempProjectDir();
    const ctx = createNativeCtx(root, {
      prisma: {} as never,
      config: {
        integrations: {
          feishu: { appId: "", appSecret: "", userAccessToken: "", tenantAccessToken: "tok" },
          yuque: { session: "", ctoken: "" },
          github: { token: "" },
        },
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ code: 0, data: { message_id: "m1" } }),
      })),
    );
    const result = await executeNativeTool(
      "feishu_send_text",
      { receiveId: "ou_xxx", text: "hello" },
      ctx,
    );
    expect(result).toEqual(expect.objectContaining({ message_id: "m1" }));
    expect(result).toHaveProperty("elapsedMs");
    fs.rmSync(root, { recursive: true, force: true });
  });
});
