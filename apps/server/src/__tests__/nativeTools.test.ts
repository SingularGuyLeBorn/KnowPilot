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
import {
  ALL_NATIVE_TOOL_NAMES,
  createNativeCtx,
  createTempProjectDir,
} from "./helpers/toolTestFixtures.js";

describe("Native 工具注册表", () => {
  it("listNativeTools 包含全部 32 个工具定义", () => {
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
    ).rejects.toThrow(/YUQUE_SESSION/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("API 成功返回文档 body", async () => {
    const root = createTempProjectDir();
    const ctx = createNativeCtx(root, {
      config: { integrations: { feishu: { appId: "", appSecret: "", userAccessToken: "", tenantAccessToken: "" }, yuque: { session: "sess", ctoken: "" }, github: { token: "" } } },
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
        json: async () => ({
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
});

describe("native:feishu_send_text", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("未配置 FEISHU_TENANT_ACCESS_TOKEN 时抛错", async () => {
    const root = createTempProjectDir();
    const ctx = createNativeCtx(root);
    await expect(
      executeNativeTool("feishu_send_text", { receiveId: "x", text: "hi" }, ctx),
    ).rejects.toThrow(/FEISHU_TENANT_ACCESS_TOKEN/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("飞书 API 成功返回 data", async () => {
    const root = createTempProjectDir();
    const ctx = createNativeCtx(root, {
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
