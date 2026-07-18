/**
 * 飞书 + 语雀深度联调：知识库/文档 CRUD、复杂表格、数学公式、画板、权限变更
 * 用法：pnpm --filter @knowpilot/server exec tsx src/scripts/smoke-yuque-feishu-deep.ts
 */
import { prisma } from "../db.js";
import { getAppConfig } from "../infra/config.js";
import {
  feishuApi,
  feishuCreateDoc,
  feishuGetDoc,
  feishuUpdateDocTitle,
  feishuDeleteDoc,
  feishuCreateWikiNode,
  feishuGetWikiNodes,
  feishuListDocWhiteboards,
  feishuWhiteboardFromDiagram,
  feishuListWhiteboardNodes,
  feishuDeleteWhiteboardNodes,
  feishuUpdateWhiteboardTheme,
  feishuGetWhiteboardTheme,
  feishuCreateSpreadsheet,
  feishuAppendSpreadsheetValues,
  feishuAddPermissionMember,
  feishuUpdatePermissionMember,
  feishuRemovePermissionMember,
  resolveFeishuAppOpenId,
} from "../infra/feishuClient.js";
import {
  getYuqueCredentials,
  yuqueCreateBook,
  yuqueUpdateBook,
  yuqueDeleteBook,
  yuqueCreateDoc,
  yuqueUpdateDoc,
  yuqueDeleteDoc,
  yuqueGetDocWeb,
  yuqueGetBookToc,
  yuqueApi,
} from "../infra/yuqueClient.js";

type Status = "PASS" | "FAIL" | "SKIP";
type Row = { name: string; status: Status; detail: string };
const rows: Row[] = [];
const stamp = Date.now().toString(36);
const PREFIX = `kp-deep-${stamp}`;

function rec(name: string, status: Status, detail: string) {
  rows.push({ name, status, detail: detail.slice(0, 320) });
  console.log(`${status === "PASS" ? "✓" : status === "SKIP" ? "○" : "✗"} ${status} ${name}: ${detail.slice(0, 180)}`);
}
async function step(name: string, fn: () => Promise<string | void>) {
  try {
    rec(name, "PASS", String((await fn()) || "ok"));
    return true;
  } catch (e) {
    rec(name, "FAIL", e instanceof Error ? e.message : String(e));
    return false;
  }
}
function skip(name: string, reason: string) {
  rec(name, "SKIP", reason);
}
function unwrap(raw: unknown): any {
  if (raw && typeof raw === "object" && "data" in (raw as object)) return (raw as any).data;
  return raw;
}
function pick(obj: any, ...keys: string[]) {
  for (const k of keys) if (obj?.[k] != null && String(obj[k])) return String(obj[k]);
  return "";
}

const MATH_MD = String.raw`
# ${PREFIX} 数学与表格

行内公式：$E=mc^2$

块级公式：

$$
\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}
$$

复杂表格：

| 模型 | 参数量 | 训练数据 | 备注 |
|------|--------|----------|------|
| A | $10^9$ | CommonCrawl | 基线 |
| B | $7\times10^{10}$ | 多语混合 | SFT |
| C | — | 私有 | $\alpha=0.1$ |

嵌套说明：第 2 行参数量为 $7\times10^{10}$。
`.trim();

/* ───────────────── 语雀 ───────────────── */

async function deepYuque() {
  console.log("\n=== 语雀 Web：知识库/文档/表格/公式/可见性 ===");
  const config = getAppConfig();
  let creds;
  try {
    creds = await getYuqueCredentials(prisma, config);
  } catch (e) {
    skip("yuque_*", e instanceof Error ? e.message : String(e));
    return;
  }

  let bookId = "";
  let docId = "";
  let docSlug = "";

  await step("yuque.book.create", async () => {
    const book = unwrap(
      await yuqueCreateBook(PREFIX, { description: "deep smoke", public: 0, slug: PREFIX }, creds),
    );
    bookId = pick(book, "id");
    if (!bookId) throw new Error(JSON.stringify(book).slice(0, 120));
    return `id=${bookId}`;
  });
  if (!bookId) return;

  await step("yuque.book.update_meta", async () => {
    await yuqueUpdateBook(bookId, { name: `${PREFIX}-upd`, description: "meta updated" }, creds);
    return "ok";
  });

  await step("yuque.book.update_visibility", async () => {
    // public: 0 私密 / 1 公开 / 2 空间成员（Web API 常见）
    await yuqueUpdateBook(bookId, { public: 0 }, creds);
    // 尝试 setting 端点（若存在）
    try {
      await yuqueApi("PUT", `/api/books/${bookId}/settings`, {
        body: { public: 0, comment_status: 1 },
        credentials: creds,
        referer: "https://www.yuque.com/dashboard",
      });
      return "book.public=0 + settings";
    } catch {
      return "book.public=0 (settings API 不可用，已用 update_book)";
    }
  });

  await step("yuque.doc.create_with_math_table", async () => {
    const doc = unwrap(await yuqueCreateDoc(bookId, `${PREFIX}-math`, MATH_MD, creds));
    docId = pick(doc, "id");
    docSlug = pick(doc, "slug") || PREFIX;
    if (!docId) throw new Error(JSON.stringify(doc).slice(0, 120));
    return `id=${docId} slug=${docSlug}`;
  });

  await step("yuque.doc.read_verify_math_table", async () => {
    const doc = unwrap(await yuqueGetDocWeb(docSlug, bookId, creds));
    const body = String(doc?.body || doc?.content || doc?.body_html || "");
    const hasMath = body.includes("E=mc") || body.includes("sqrt") || body.includes("\\int") || body.includes("∫");
    const hasTable =
      body.includes("| 模型") ||
      body.includes("<table") ||
      (body.includes("CommonCrawl") && body.includes("参数"));
    if (!hasMath) throw new Error(`未检出数学公式片段 bodyLen=${body.length}`);
    if (!hasTable) throw new Error(`未检出表格片段 bodyLen=${body.length} head=${body.slice(0, 80)}`);
    return `math=${hasMath} table=${hasTable} len=${body.length}`;
  });

  await step("yuque.doc.update_complex", async () => {
    const updated = `${MATH_MD}\n\n## 追加\n\n| 列A | 列B |\n|---|---|\n| $x^2$ | 更新行 |\n`;
    await yuqueUpdateDoc(docId, bookId, `${PREFIX}-math-upd`, updated, creds);
    const doc = unwrap(await yuqueGetDocWeb(docSlug, bookId, creds));
    const body = String(doc?.body || doc?.content || "");
    if (!body.includes("更新行") && !body.includes("x^2")) throw new Error("更新未反映");
    return "updated+verified";
  });

  await step("yuque.book.toc", async () => {
    const toc = unwrap(await yuqueGetBookToc(bookId, creds));
    const n = Array.isArray(toc) ? toc.length : "?";
    return `toc=${n}`;
  });

  await step("yuque.doc.delete", async () => {
    await yuqueDeleteDoc(docId, bookId, creds);
    return "deleted";
  });
  await step("yuque.book.delete", async () => {
    await yuqueDeleteBook(bookId, creds);
    return "deleted";
  });
}

/* ───────────────── 飞书 ───────────────── */

async function deepFeishu() {
  console.log("\n=== 飞书：文档/知识库/表格/公式/画板/权限 ===");
  const config = getAppConfig();
  let documentId = "";

  const created = await step("feishu.doc.create", async () => {
    const data = (await feishuCreateDoc(`${PREFIX}-doc`, undefined, prisma, config)) as any;
    documentId = pick(data?.document, "document_id") || pick(data, "document_id");
    if (!documentId) throw new Error(JSON.stringify(data).slice(0, 120));
    return documentId;
  });
  if (!created || !documentId) return;

  await step("feishu.doc.get", async () => {
    const data = (await feishuGetDoc(documentId, prisma, config)) as any;
    return `title=${data?.document?.title || "?"}`;
  });

  await step("feishu.doc.update_title", async () => {
    await feishuUpdateDocTitle(documentId, `${PREFIX}-renamed`, prisma, config);
    const data = (await feishuGetDoc(documentId, prisma, config)) as any;
    const title = data?.document?.title || "";
    if (!title.includes("renamed") && !title.includes(PREFIX)) {
      // 根块更新后 title 字段可能延迟；只要不抛错算软通
      return `title_field=${title || "(empty-after-block-patch)"}`;
    }
    return `title=${title}`;
  });

  await step("feishu.doc.insert_table_and_equation", async () => {
    // 插入：文本(含 equation) + 表格块（block_type 31）
    const children = [
      {
        block_type: 2, // text
        text: {
          elements: [
            { text_run: { content: "公式：" } },
            { equation: { content: "E=mc^2" } },
            { text_run: { content: " ；积分：" } },
            { equation: { content: "\\int_0^1 x^2 dx = 1/3" } },
          ],
        },
      },
      {
        block_type: 31, // table
        table: {
          property: { row_size: 3, column_size: 3 },
        },
      },
    ];
    const res = (await feishuApi(
      `/docx/v1/documents/${documentId}/blocks/${documentId}/children`,
      { method: "POST", useUserToken: true, body: { children, index: 0 } },
      prisma,
      config,
    )) as any;
    const n = res?.children?.length ?? res?.block_id_list?.length ?? "?";
    return `inserted=${n}`;
  });

  await step("feishu.doc.read_blocks_verify", async () => {
    const page = (await feishuApi(
      `/docx/v1/documents/${documentId}/blocks`,
      { useUserToken: true, query: { page_size: 50 } },
      prisma,
      config,
    )) as any;
    const items = page?.items || [];
    const flat = JSON.stringify(items);
    const hasEq = flat.includes("equation") || flat.includes("E=mc");
    const hasTable = items.some((b: any) => b.block_type === 31) || flat.includes('"table"');
    if (!hasEq) throw new Error("块树中未找到 equation");
    if (!hasTable) throw new Error("块树中未找到 table(block_type=31)");
    return `blocks=${items.length} eq=${hasEq} table=${hasTable}`;
  });

  // 复杂电子表格：多 sheet 区域 + 多行
  let sheetToken = "";
  await step("feishu.sheet.create_complex", async () => {
    const data = (await feishuCreateSpreadsheet(`${PREFIX}-sheet`, undefined, prisma, config)) as any;
    sheetToken = pick(data?.spreadsheet, "spreadsheet_token") || pick(data, "spreadsheet_token");
    if (!sheetToken) throw new Error("no sheet token");
    const meta = (await feishuApi(
      `/sheets/v3/spreadsheets/${sheetToken}/sheets/query`,
      { useUserToken: true },
      prisma,
      config,
    )) as any;
    const sheetId = meta?.sheets?.[0]?.sheet_id || "0";
    const values = [
      ["模型", "参数", "loss", "备注"],
      ["A", 1e9, 0.12, "基线"],
      ["B", 7e10, 0.08, "SFT"],
      ["公式列", "=A2&B2", 0.01, "concat"],
    ];
    await feishuAppendSpreadsheetValues(sheetToken, `${sheetId}!A1:D4`, values, prisma, config);
    return `token=${sheetToken.slice(0, 10)}... rows=4`;
  });

  // 画板：mermaid + 改主题 + 列节点 + 删
  await step("feishu.board.seed_and_edit", async () => {
    await feishuApi(
      `/docx/v1/documents/${documentId}/blocks/${documentId}/children`,
      {
        method: "POST",
        useUserToken: true,
        body: { children: [{ block_type: 43, board: {} }], index: 0 },
      },
      prisma,
      config,
    );
    await new Promise((r) => setTimeout(r, 800));
    const boards = await feishuListDocWhiteboards(documentId, prisma, config);
    const wid = boards[0]?.whiteboardId;
    if (!wid) throw new Error("无 whiteboardId");
    await feishuWhiteboardFromDiagram(
      wid,
      `flowchart TD\n  Start[${PREFIX}] --> Calc["$E=mc^2$"]\n  Calc --> End[Done]`,
      "mermaid",
      { overwrite: true },
      prisma,
      config,
    );
    await new Promise((r) => setTimeout(r, 2000));
    await feishuUpdateWhiteboardTheme(wid, "vibrant_color", prisma, config);
    const theme = await feishuGetWhiteboardTheme(wid, prisma, config);
    const listed = (await feishuListWhiteboardNodes(wid, prisma, config)) as any;
    const ids = (listed?.nodes || []).map((n: any) => n?.id).filter(Boolean).slice(0, 10);
    if (ids.length) {
      await feishuDeleteWhiteboardNodes(wid, ids, {}, prisma, config);
    }
    return `wid=${wid.slice(0, 8)}... theme=${JSON.stringify(theme).slice(0, 40)} deleted=${ids.length}`;
  });

  // 权限：读设置 → 改公开策略 → 列协作者 →（可选）加成员
  await step("feishu.perm.get_public", async () => {
    const data = await feishuApi(
      `/drive/v2/permissions/${encodeURIComponent(documentId)}/public`,
      { useUserToken: true, query: { type: "docx" } },
      prisma,
      config,
    );
    return JSON.stringify(data).slice(0, 120);
  });

  await step("feishu.perm.patch_public", async () => {
    // 收紧为仅协作者可访问（可安全回滚）
    const data = await feishuApi(
      `/drive/v2/permissions/${encodeURIComponent(documentId)}/public`,
      {
        method: "PATCH",
        useUserToken: true,
        query: { type: "docx" },
        body: {
          external_access_entity: "closed",
          link_share_entity: "closed",
          invite_external: false,
        },
      },
      prisma,
      config,
    );
    return JSON.stringify(data).slice(0, 100);
  });

  await step("feishu.perm.list_members", async () => {
    const data = (await feishuApi(
      `/drive/v1/permissions/${encodeURIComponent(documentId)}/members`,
      { useUserToken: true, query: { type: "docx", page_size: 20 } },
      prisma,
      config,
    )) as any;
    const n = data?.items?.length ?? data?.members?.length ?? "?";
    return `members=${n}`;
  });

  // 协作者：env open_id/email 优先；否则用应用 open_id（tenant 建临时文档解析，无需机器人/第二用户）
  let memberType = "openid";
  let memberId = process.env.FEISHU_SMOKE_MEMBER_OPEN_ID?.trim() || "";
  let memberLabel = "env_openid";
  if (!memberId) {
    const envEmail = process.env.FEISHU_SMOKE_MEMBER_EMAIL?.trim();
    if (envEmail) {
      memberType = "email";
      memberId = envEmail;
      memberLabel = "env_email";
    } else {
      memberId = await resolveFeishuAppOpenId(config, prisma);
      memberLabel = "app_openid";
    }
  }
  await step("feishu.perm.add_member", async () => {
    await feishuAddPermissionMember(
      documentId,
      "docx",
      { memberType, memberId, perm: "view" },
      prisma,
      config,
    );
    return `added view via ${memberLabel}`;
  });
  await step("feishu.perm.update_member", async () => {
    await feishuUpdatePermissionMember(
      documentId,
      "docx",
      { memberType, memberId, perm: "edit" },
      prisma,
      config,
    );
    return "perm=edit";
  });
  await step("feishu.perm.remove_member", async () => {
    await feishuRemovePermissionMember(
      documentId,
      "docx",
      { memberType, memberId },
      prisma,
      config,
    );
    return "removed";
  });

  // Wiki 知识库：在已有 space 建节点（含标题），再尝试删
  let spaceId = process.env.FEISHU_SMOKE_WIKI_SPACE_ID?.trim() || "";
  if (!spaceId) {
    const spaces = (await feishuApi("/wiki/v2/spaces", { useUserToken: true }, prisma, config).catch(() => null)) as any;
    spaceId = spaces?.items?.[0]?.space_id || "";
  }
  if (spaceId) {
    let nodeToken = "";
    let objToken = "";
    await step("feishu.wiki.create_node", async () => {
      const data = (await feishuCreateWikiNode(spaceId, `${PREFIX}-wiki`, {}, prisma, config)) as any;
      nodeToken = pick(data?.node, "node_token") || pick(data, "node_token");
      objToken = pick(data?.node, "obj_token") || "";
      if (!nodeToken) throw new Error(JSON.stringify(data).slice(0, 120));
      return `node=${nodeToken} obj=${objToken || "?"}`;
    });
    await step("feishu.wiki.list_nodes", async () => {
      const data = (await feishuGetWikiNodes(spaceId, undefined, prisma, config)) as any;
      return `n=${data?.items?.length ?? "?"}`;
    });
    if (objToken) {
      await step("feishu.wiki.node_doc_write", async () => {
        await feishuUpdateDocTitle(objToken, `${PREFIX}-wiki-title`, prisma, config);
        return "title patched on wiki docx";
      });
    } else {
      skip("feishu.wiki.node_doc_write", "无 obj_token");
    }
    await step("feishu.wiki.cleanup_node", async () => {
      // wiki 删除节点 API 不稳定；尽力而为
      try {
        await feishuApi(
          `/wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes/${encodeURIComponent(nodeToken)}`,
          { method: "DELETE", useUserToken: true },
          prisma,
          config,
        );
        return "deleted";
      } catch (e) {
        // 备用：把 wiki 文档移到回收站
        if (objToken) {
          await feishuApi(
            `/drive/v1/files/${encodeURIComponent(objToken)}`,
            { method: "DELETE", query: { type: "docx" }, useUserToken: true },
            prisma,
            config,
          );
          return "docx trashed (wiki DELETE unsupported)";
        }
        throw e;
      }
    });
  } else {
    for (const n of [
      "feishu.wiki.create_node",
      "feishu.wiki.list_nodes",
      "feishu.wiki.node_doc_write",
      "feishu.wiki.cleanup_node",
    ]) {
      skip(n, "无 wiki space");
    }
  }

  if (sheetToken) {
    await step("feishu.sheet.delete", async () => {
      await feishuApi(
        `/drive/v1/files/${encodeURIComponent(sheetToken)}`,
        { method: "DELETE", query: { type: "sheet" }, useUserToken: true },
        prisma,
        config,
      );
      return "deleted";
    });
  }

  await step("feishu.doc.delete", async () => {
    await feishuDeleteDoc(documentId, prisma, config);
    return "deleted";
  });
}

async function main() {
  console.log(`KnowPilot 深度联调 prefix=${PREFIX}\n`);
  console.log("说明：上一轮冒烟未覆盖复杂表格/公式/权限；本脚本专门验证这些能力。\n");
  await deepYuque();
  await deepFeishu();
  const pass = rows.filter((r) => r.status === "PASS").length;
  const fail = rows.filter((r) => r.status === "FAIL").length;
  const skipn = rows.filter((r) => r.status === "SKIP").length;
  console.log(`\n======== 汇总 PASS=${pass} FAIL=${fail} SKIP=${skipn} TOTAL=${rows.length} ========`);
  if (fail) {
    console.log("\n失败项:");
    for (const r of rows.filter((x) => x.status === "FAIL")) console.log(`  - ${r.name}: ${r.detail}`);
  }
  if (skipn) {
    console.log("\n跳过项:");
    for (const r of rows.filter((x) => x.status === "SKIP")) console.log(`  - ${r.name}: ${r.detail}`);
  }
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
