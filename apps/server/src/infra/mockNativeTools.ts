/**
 * Mock Native Tools —— 用于 E2E / 单元测试，避免 native 工具（web_search / read_article 等）
 * 触发真实网络调用（Tavily / MetaBlog）。
 *
 * 通过环境变量启用：
 *   MOCK_NATIVE_TOOLS=true
 *
 * 当前覆盖：web_search、read_article、scrape_web_page、read_file、write_file。
 * 未覆盖的工具会回退到真实实现（如需可继续补）。
 */

import type { NativeToolContext } from "./nativeTools.js";

type MockHandler = (
  args: Record<string, unknown>,
  ctx: NativeToolContext,
) => unknown | Promise<unknown>;

const MOCK_HANDLERS: Record<string, MockHandler> = {
  web_search: (args) => {
    const query = String(args.query ?? "");
    return {
      query,
      engine: "mock",
      results: [
        {
          title: "KnowPilot - 本地优先的智能知识管理平台",
          url: "https://example.com/knowpilot",
          snippet: `Mock 搜索结果：${query}。KnowPilot 是一个以 Markdown 为原子、AI 为引擎的数字花园。`,
        },
        {
          title: "Mock Secondary Result",
          url: "https://example.com/mock-secondary",
          snippet: "Mock 次要结果，仅用于 E2E 测试。",
        },
      ],
      elapsedMs: 5,
    };
  },

  read_article: (args) => {
    const url = String(args.url ?? "");
    // 模拟失败场景：URL 含 broken / 404 时返回 error 字段
    if (/broken|404|fail/i.test(url)) {
      return {
        url,
        title: "",
        content: "",
        chars: 0,
        error: "Mock 读取失败：404 Not Found",
        elapsedMs: 5,
      };
    }
    return {
      url,
      title: "Mock 文章标题",
      content: "Mock 文章正文内容。这是一段用于 E2E 测试的占位文本，不依赖真实网络。",
      chars: 64,
      elapsedMs: 5,
    };
  },

  scrape_web_page: (args) => ({
    url: String(args.url ?? ""),
    title: "Mock Page",
    content: "Mock scrape content.",
    links: [{ text: "Mock Link", href: "https://example.com" }],
    elapsedMs: 5,
  }),

  read_file: (args) => ({
    path: String(args.path ?? ""),
    content: "Mock file content for E2E testing.",
    chars: 32,
    elapsedMs: 1,
  }),

  write_file: (args) => ({
    path: String(args.path ?? ""),
    bytes: String(args.content ?? "").length,
    elapsedMs: 1,
  }),
};

/**
 * 检查某个 native 工具是否在 Mock 模式下被覆盖。
 */
export function hasMockNativeTool(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(MOCK_HANDLERS, name);
}

/**
 * 执行 Mock native 工具。调用前应先 hasMockNativeTool 校验。
 */
export async function executeMockNativeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: NativeToolContext,
): Promise<unknown> {
  const handler = MOCK_HANDLERS[name];
  if (!handler) {
    throw new Error(`Mock native 工具 "${name}" 未注册`);
  }
  const started = Date.now();
  const raw = await Promise.resolve(handler(args, ctx));
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.elapsedMs !== "number") {
      return { ...obj, elapsedMs: Date.now() - started };
    }
  }
  return raw;
}
