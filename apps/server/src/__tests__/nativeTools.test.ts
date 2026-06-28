/**
 * Native 工具 — 每个 Agent 内置工具单元测试
 */

import fs from "fs";
import path from "path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  executeNativeTool,
  buildNativeToolSchemas,
  listNativeTools,
  resolveAllowedNativeTools,
} from "../infra/nativeTools.js";
import {
  ALL_NATIVE_TOOL_NAMES,
  createNativeCtx,
  createTempProjectDir,
} from "./helpers/toolTestFixtures.js";

describe("Native 工具注册表", () => {
  it("listNativeTools 包含全部 11 个工具定义", () => {
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
});

describe("native:invoke_api", () => {
  it("转发到 invokeTrpc", async () => {
    const root = createTempProjectDir();
    const invokeTrpc = vi.fn(async (tool: string, args?: unknown) => ({ tool, args }));
    const ctx = createNativeCtx(root, { invokeTrpc });
    const result = await executeNativeTool("invoke_api", { tool: "post.list", args: { page: 1 } }, ctx);
    expect(invokeTrpc).toHaveBeenCalledWith("post.list", { page: 1 });
    expect(result).toEqual({ tool: "post.list", args: { page: 1 } });
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("native:web_search", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("未配置 API Key 时抛错", async () => {
    const root = createTempProjectDir();
    const ctx = createNativeCtx(root);
    await expect(executeNativeTool("web_search", { query: "test" }, ctx)).rejects.toThrow(/未配置/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("Tavily 成功返回结果", async () => {
    const root = createTempProjectDir();
    const ctx = createNativeCtx(root, {
      config: { search: { tavilyApiKey: "test-key", serpApiKey: "" } },
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
      answer: string;
    };
    expect(result.provider).toBe("tavily");
    expect(result.answer).toBe("42");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("query 为空时抛错", async () => {
    const root = createTempProjectDir();
    const ctx = createNativeCtx(root, {
      config: { search: { tavilyApiKey: "k", serpApiKey: "" } },
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
    expect(result).toEqual({ message_id: "m1" });
    fs.rmSync(root, { recursive: true, force: true });
  });
});
