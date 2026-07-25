/**
 * 集成域 — yuque_*（从 integration.ts 拆出，P2-01 选 B）
 *
 * 语雀文档/知识库操作：Web Cookie（YUQUE_SESSION + YUQUE_CTOKEN）与 Open API v2（YUQUE_TOKEN 个人令牌）双通道。
 */
import {
  getYuqueCredentials,
  getYuquePersonalToken,
  yuqueListBooks,
  yuqueGetBookToc,
  yuqueCreateBook,
  yuqueUpdateBook,
  yuqueDeleteBook,
  yuqueGetDocWeb,
  yuqueCreateDoc,
  yuqueUpdateDoc,
  yuqueDeleteDoc,
  yuqueListRepos,
  yuqueCreateRepo,
  yuqueUpdateRepo,
  yuqueDeleteRepo,
  yuqueListDocs,
  yuqueGetDocV2,
  yuqueCreateDocV2,
  yuqueUpdateDocV2,
  yuqueDeleteDocV2,
  yuqueProbeSession,
} from "../../../yuqueClient.js";
import type { NativeToolContext, NativeToolDefinition, NativeToolHandler } from "../types.js";
import { z } from "zod";
import { zodParams } from "../zodParams.js";

async function yuqueGetDocTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  // Web：bookId + slug；Open API：namespace + slug
  if (args.bookId) {
    const credentials = await getYuqueCredentials(ctx.prisma, ctx.config);
    const data = await yuqueGetDocWeb(String(args.slug), String(args.bookId), credentials);
    const doc = (data as { data?: { title?: string; slug?: string; body?: string; content?: string } })?.data ?? data;
    const body = (doc as { body?: string; content?: string }).body || (doc as { content?: string }).content || "";
    return {
      title: (doc as { title?: string }).title,
      slug: (doc as { slug?: string }).slug,
      body: String(body).slice(0, 12000),
      via: "web",
    };
  }
  const token = await getYuquePersonalToken(ctx.prisma, ctx.config);
  const data = (await yuqueGetDocV2(String(args.namespace), String(args.slug), token)) as {
    title?: string;
    slug?: string;
    body?: string;
  };
  return { title: data.title, slug: data.slug, body: (data.body || "").slice(0, 12000), via: "open_api_v2" };
}

async function yuqueListBooksTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const credentials = await getYuqueCredentials(ctx.prisma, ctx.config);
  return yuqueListBooks(credentials);
}

async function yuqueGetBookTocTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const credentials = await getYuqueCredentials(ctx.prisma, ctx.config);
  return yuqueGetBookToc(String(args.bookId), credentials);
}

async function yuqueCreateBookTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const credentials = await getYuqueCredentials(ctx.prisma, ctx.config);
  return yuqueCreateBook(
    String(args.name),
    {
      description: args.description ? String(args.description) : undefined,
      public: args.public !== undefined ? Number(args.public) : undefined,
      slug: args.slug ? String(args.slug) : undefined,
    },
    credentials,
  );
}

async function yuqueUpdateBookTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const credentials = await getYuqueCredentials(ctx.prisma, ctx.config);
  return yuqueUpdateBook(
    String(args.bookId),
    {
      name: args.name ? String(args.name) : undefined,
      description: args.description ? String(args.description) : undefined,
      public: args.public !== undefined ? Number(args.public) : undefined,
    },
    credentials,
  );
}

async function yuqueDeleteBookTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const credentials = await getYuqueCredentials(ctx.prisma, ctx.config);
  return yuqueDeleteBook(String(args.bookId), credentials);
}

async function yuqueCreateDocTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const credentials = await getYuqueCredentials(ctx.prisma, ctx.config);
  return yuqueCreateDoc(String(args.bookId), String(args.title), String(args.body), credentials);
}

async function yuqueUpdateDocTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const credentials = await getYuqueCredentials(ctx.prisma, ctx.config);
  return yuqueUpdateDoc(String(args.docId), String(args.bookId), String(args.title), String(args.body), credentials);
}

async function yuqueDeleteDocTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const credentials = await getYuqueCredentials(ctx.prisma, ctx.config);
  return yuqueDeleteDoc(String(args.docId), String(args.bookId), credentials);
}

async function yuqueSessionStatusTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const credentials = await getYuqueCredentials(ctx.prisma, ctx.config);
  return yuqueProbeSession(credentials);
}

async function yuqueListReposTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const token = await getYuquePersonalToken(ctx.prisma, ctx.config);
  return yuqueListRepos(token);
}

async function yuqueCreateRepoTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const token = await getYuquePersonalToken(ctx.prisma, ctx.config);
  return yuqueCreateRepo(
    String(args.name),
    {
      description: args.description ? String(args.description) : undefined,
      public: args.public !== undefined ? Number(args.public) : undefined,
      slug: args.slug ? String(args.slug) : undefined,
    },
    token,
  );
}

async function yuqueUpdateRepoTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const token = await getYuquePersonalToken(ctx.prisma, ctx.config);
  return yuqueUpdateRepo(
    String(args.namespace),
    {
      name: args.name ? String(args.name) : undefined,
      description: args.description ? String(args.description) : undefined,
      public: args.public !== undefined ? Number(args.public) : undefined,
    },
    token,
  );
}

async function yuqueDeleteRepoTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const token = await getYuquePersonalToken(ctx.prisma, ctx.config);
  return yuqueDeleteRepo(String(args.namespace), token);
}

async function yuqueListDocsTool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const token = await getYuquePersonalToken(ctx.prisma, ctx.config);
  return yuqueListDocs(String(args.namespace), token);
}

async function yuqueCreateDocV2Tool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const token = await getYuquePersonalToken(ctx.prisma, ctx.config);
  return yuqueCreateDocV2(String(args.namespace), String(args.title), String(args.body), token);
}

async function yuqueUpdateDocV2Tool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const token = await getYuquePersonalToken(ctx.prisma, ctx.config);
  return yuqueUpdateDocV2(String(args.namespace), String(args.slug), String(args.title), String(args.body), token);
}

async function yuqueDeleteDocV2Tool(args: Record<string, unknown>, ctx: NativeToolContext) {
  const token = await getYuquePersonalToken(ctx.prisma, ctx.config);
  return yuqueDeleteDocV2(String(args.namespace), String(args.slug), token);
}

export const yuqueDefs: NativeToolDefinition[] = [
  {
    name: "yuque_get_doc",
    reentrant: true,
    description:
      "读取语雀文档。优先 Web：传 bookId+slug（需 YUQUE_SESSION）；或 Open API：传 namespace+slug（需 YUQUE_TOKEN 个人令牌）。",
    parameters: zodParams(
      z.object({
        slug: z.string().describe("文档 slug"),
        bookId: z.string().describe("Web API：知识库 id").optional(),
        namespace: z.string().describe("Open API：如 user/repo").optional(),
      }),
    ),
  },
  {
    name: "yuque_list_books",
    reentrant: true,
    description: "列出语雀知识库（Web Cookie：YUQUE_SESSION + YUQUE_CTOKEN）。",
    parameters: zodParams(z.object({})),
  },
  {
    name: "yuque_get_book_toc",
    reentrant: true,
    description: "获取语雀知识库目录（Web Cookie）。",
    parameters: zodParams(z.object({ bookId: z.string() })),
  },
  {
    name: "yuque_create_book",
    concurrencyClass: "D",
    description: "创建语雀知识库（Web Cookie）。",
    parameters: zodParams(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        slug: z.string().optional(),
        public: z.number().describe("0 私密 / 1 公开，默认 0").optional(),
      }),
    ),
  },
  {
    name: "yuque_update_book",
    concurrencyClass: "D",
    description: "更新语雀知识库元信息（Web Cookie）。",
    parameters: zodParams(
      z.object({
        bookId: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        public: z.number().optional(),
      }),
    ),
  },
  {
    name: "yuque_delete_book",
    concurrencyClass: "D",
    destructive: true,
    description: "删除语雀知识库（Web Cookie，不可恢复）。",
    parameters: zodParams(z.object({ bookId: z.string() })),
  },
  {
    name: "yuque_create_doc",
    description: "在语雀知识库创建文档（Web Cookie）。",
    parameters: zodParams(
      z.object({
        bookId: z.string(),
        title: z.string(),
        body: z.string().describe("Markdown 内容"),
      }),
    ),
  },
  {
    name: "yuque_update_doc",
    description: "更新语雀文档（Web Cookie）。",
    parameters: zodParams(
      z.object({
        docId: z.string(),
        bookId: z.string(),
        title: z.string(),
        body: z.string(),
      }),
    ),
  },
  {
    name: "yuque_delete_doc",
    destructive: true,
    description: "删除语雀文档（Web Cookie）。",
    parameters: zodParams(
      z.object({
        docId: z.string(),
        bookId: z.string(),
      }),
    ),
  },
  {
    name: "yuque_session_status",
    reentrant: true,
    description: "探测语雀 Cookie 会话是否仍有效（list_books 轻量探测）。",
    parameters: zodParams(z.object({})),
  },
  {
    name: "yuque_list_repos",
    reentrant: true,
    description: "列出语雀知识库（Open API v2，需 YUQUE_TOKEN 个人令牌，不是网页 _ctoken）。",
    parameters: zodParams(z.object({})),
  },
  {
    name: "yuque_create_repo",
    concurrencyClass: "D",
    description: "创建语雀知识库（Open API v2，需 YUQUE_TOKEN）。",
    parameters: zodParams(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        slug: z.string().optional(),
        public: z.number().optional(),
      }),
    ),
  },
  {
    name: "yuque_update_repo",
    concurrencyClass: "D",
    description: "更新语雀知识库（Open API v2）。",
    parameters: zodParams(
      z.object({
        namespace: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        public: z.number().optional(),
      }),
    ),
  },
  {
    name: "yuque_delete_repo",
    concurrencyClass: "D",
    destructive: true,
    description: "删除语雀知识库（Open API v2）。",
    parameters: zodParams(z.object({ namespace: z.string() })),
  },
  {
    name: "yuque_list_docs",
    reentrant: true,
    description: "列出语雀知识库文档（Open API v2，需 YUQUE_TOKEN）。",
    parameters: zodParams(z.object({ namespace: z.string() })),
  },
  {
    name: "yuque_create_doc_v2",
    description: "创建语雀文档（Open API v2，需 YUQUE_TOKEN）。",
    parameters: zodParams(
      z.object({
        namespace: z.string(),
        title: z.string(),
        body: z.string(),
      }),
    ),
  },
  {
    name: "yuque_update_doc_v2",
    description: "更新语雀文档（Open API v2，需 YUQUE_TOKEN）。",
    parameters: zodParams(
      z.object({
        namespace: z.string(),
        slug: z.string(),
        title: z.string(),
        body: z.string(),
      }),
    ),
  },
  {
    name: "yuque_delete_doc_v2",
    destructive: true,
    description: "删除语雀文档（Open API v2，需 YUQUE_TOKEN）。",
    parameters: zodParams(
      z.object({
        namespace: z.string(),
        slug: z.string(),
      }),
    ),
  },
];

export const yuqueHandlers: Record<string, NativeToolHandler> = {
  yuque_get_doc: yuqueGetDocTool,
  yuque_list_books: yuqueListBooksTool,
  yuque_create_book: yuqueCreateBookTool,
  yuque_update_book: yuqueUpdateBookTool,
  yuque_delete_book: yuqueDeleteBookTool,
  yuque_session_status: yuqueSessionStatusTool,
  yuque_create_repo: yuqueCreateRepoTool,
  yuque_update_repo: yuqueUpdateRepoTool,
  yuque_delete_repo: yuqueDeleteRepoTool,
  yuque_get_book_toc: yuqueGetBookTocTool,
  yuque_create_doc: yuqueCreateDocTool,
  yuque_update_doc: yuqueUpdateDocTool,
  yuque_delete_doc: yuqueDeleteDocTool,
  yuque_list_repos: yuqueListReposTool,
  yuque_list_docs: yuqueListDocsTool,
  yuque_create_doc_v2: yuqueCreateDocV2Tool,
  yuque_update_doc_v2: yuqueUpdateDocV2Tool,
  yuque_delete_doc_v2: yuqueDeleteDocV2Tool,
};
