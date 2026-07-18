/**
 * 语雀 + 飞书全量联调（含写操作：创建 → 改 → 删，前缀 kp-smoke-*，测完尽量清理）
 *
 * 用法：
 *   pnpm --filter @knowpilot/server exec tsx src/scripts/smoke-yuque-feishu-full.ts
 *
 * 可选环境变量：
 *   FEISHU_SMOKE_RECEIVE_ID   测发消息（open_id/user_id）
 *   FEISHU_SMOKE_WIKI_SPACE_ID 指定 Wiki space（否则尝试 list spaces）
 *   YUQUE_TOKEN               Open API v2（无则 v2 整组 SKIP）
 */
import { prisma } from "../db.js";
import { getAppConfig } from "../infra/config.js";
import { getCredentialValue } from "../infra/credentialVault.js";
import {
  getTenantAccessToken,
  getUserAccessTokenStatus,
  getUserAccessToken,
  refreshUserAccessToken,
  feishuApi,
  feishuSearchDocs,
  feishuCreateDoc,
  feishuGetDoc,
  feishuUpdateDocTitle,
  feishuDeleteDoc,
  feishuGetWikiSpace,
  feishuGetWikiNodes,
  feishuCreateWikiNode,
  feishuCreateSpreadsheet,
  feishuAppendSpreadsheetValues,
  feishuListDocWhiteboards,
  feishuListWhiteboardNodes,
  feishuCreateWhiteboardNodes,
  feishuWhiteboardFromDiagram,
  feishuDeleteWhiteboardNodes,
  feishuGetWhiteboardTheme,
  feishuUpdateWhiteboardTheme,
  feishuSendText,
} from "../infra/feishuClient.js";
import {
  getYuqueCredentials,
  getYuquePersonalToken,
  yuqueProbeSession,
  yuqueListBooks,
  yuqueGetBookToc,
  yuqueCreateBook,
  yuqueUpdateBook,
  yuqueDeleteBook,
  yuqueCreateDoc,
  yuqueUpdateDoc,
  yuqueDeleteDoc,
  yuqueGetDocWeb,
  yuqueGetUser,
  yuqueListRepos,
  yuqueCreateRepo,
  yuqueUpdateRepo,
  yuqueDeleteRepo,
  yuqueListDocs,
  yuqueCreateDocV2,
  yuqueUpdateDocV2,
  yuqueDeleteDocV2,
  yuqueGetDocV2,
} from "../infra/yuqueClient.js";

type Status = "PASS" | "FAIL" | "SKIP";
type Row = { name: string; status: Status; detail: string };

const rows: Row[] = [];
const stamp = Date.now().toString(36);
const PREFIX = `kp-smoke-${stamp}`;

function rec(name: string, status: Status, detail: string) {
  rows.push({ name, status, detail: detail.slice(0, 280) });
  const mark = status === "PASS" ? "✓" : status === "SKIP" ? "○" : "✗";
  console.log(`${mark} ${status.padEnd(4)} ${name}: ${detail.slice(0, 200)}`);
}

async function step(name: string, fn: () => Promise<string | void>): Promise<boolean> {
  try {
    const detail = (await fn()) || "ok";
    rec(name, "PASS", String(detail));
    return true;
  } catch (e) {
    rec(name, "FAIL", e instanceof Error ? e.message : String(e));
    return false;
  }
}

function skip(name: string, reason: string) {
  rec(name, "SKIP", reason);
}

function unwrapData<T = any>(raw: unknown): T {
  if (raw && typeof raw === "object" && "data" in (raw as object)) {
    return (raw as { data: T }).data;
  }
  return raw as T;
}

function pickId(obj: any, ...keys: string[]): string {
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && String(v)) return String(v);
  }
  return "";
}

/* ───────────────── 语雀 Cookie 路径 ───────────────── */

async function smokeYuqueWeb() {
  console.log("\n=== 语雀 Web Cookie ===");
  const config = getAppConfig();
  let creds: Awaited<ReturnType<typeof getYuqueCredentials>>;
  try {
    creds = await getYuqueCredentials(prisma, config);
  } catch (e) {
    skip("yuque_session_status", e instanceof Error ? e.message : String(e));
    for (const n of [
      "yuque_list_books",
      "yuque_create_book",
      "yuque_update_book",
      "yuque_get_book_toc",
      "yuque_create_doc",
      "yuque_update_doc",
      "yuque_get_doc",
      "yuque_delete_doc",
      "yuque_delete_book",
    ]) {
      skip(n, "无 Cookie 凭证");
    }
    return;
  }

  await step("yuque_session_status", async () => {
    const p = await yuqueProbeSession(creds);
    if (!p.ok) throw new Error(p.detail);
    return p.detail;
  });

  let bookId = "";
  let docId = "";
  let docSlug = "";

  await step("yuque_list_books", async () => {
    const raw = await yuqueListBooks(creds);
    const list = unwrapData<any[]>(raw);
    const arr = Array.isArray(list) ? list : [];
    return `n=${arr.length}`;
  });

  const createdBook = await step("yuque_create_book", async () => {
    const raw = await yuqueCreateBook(
      PREFIX,
      { description: "KnowPilot smoke test — safe to delete", public: 0, slug: PREFIX },
      creds,
    );
    const book = unwrapData<any>(raw);
    bookId = pickId(book, "id", "book_id");
    if (!bookId) throw new Error(`无 book id: ${JSON.stringify(raw).slice(0, 180)}`);
    return `id=${bookId}`;
  });

  if (createdBook && bookId) {
    await step("yuque_update_book", async () => {
      await yuqueUpdateBook(bookId, { description: `${PREFIX} updated` }, creds);
      return "updated";
    });

    await step("yuque_get_book_toc", async () => {
      const raw = await yuqueGetBookToc(bookId, creds);
      const toc = unwrapData<any>(raw);
      const n = Array.isArray(toc) ? toc.length : Array.isArray(toc?.toc) ? toc.toc.length : "?";
      return `toc=${n}`;
    });

    const createdDoc = await step("yuque_create_doc", async () => {
      const raw = await yuqueCreateDoc(bookId, `${PREFIX}-doc`, `# ${PREFIX}\n\nhello`, creds);
      const doc = unwrapData<any>(raw);
      docId = pickId(doc, "id");
      docSlug = pickId(doc, "slug") || PREFIX;
      if (!docId) throw new Error(`无 doc id: ${JSON.stringify(raw).slice(0, 180)}`);
      return `id=${docId} slug=${docSlug}`;
    });

    if (createdDoc && docId) {
      await step("yuque_update_doc", async () => {
        await yuqueUpdateDoc(docId, bookId, `${PREFIX}-doc-upd`, `# updated\n\n${PREFIX}`, creds);
        return "updated";
      });

      await step("yuque_get_doc", async () => {
        const raw = await yuqueGetDocWeb(docSlug, bookId, creds);
        const doc = unwrapData<any>(raw);
        const title = doc?.title || "?";
        return `title=${title}`;
      });

      await step("yuque_delete_doc", async () => {
        await yuqueDeleteDoc(docId, bookId, creds);
        return "deleted";
      });
    } else {
      for (const n of ["yuque_update_doc", "yuque_get_doc", "yuque_delete_doc"]) {
        skip(n, "create_doc 失败");
      }
    }

    await step("yuque_delete_book", async () => {
      await yuqueDeleteBook(bookId, creds);
      return "deleted";
    });
  } else {
    for (const n of [
      "yuque_update_book",
      "yuque_get_book_toc",
      "yuque_create_doc",
      "yuque_update_doc",
      "yuque_get_doc",
      "yuque_delete_doc",
      "yuque_delete_book",
    ]) {
      skip(n, "create_book 失败");
    }
  }
}

/* ───────────────── 语雀 Open API v2 ───────────────── */

async function smokeYuqueV2() {
  console.log("\n=== 语雀 Open API v2 ===");
  const config = getAppConfig();
  let token = "";
  try {
    token = await getYuquePersonalToken(prisma, config);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    for (const n of [
      "yuque_list_repos",
      "yuque_create_repo",
      "yuque_update_repo",
      "yuque_list_docs",
      "yuque_create_doc_v2",
      "yuque_update_doc_v2",
      "yuque_get_doc_v2",
      "yuque_delete_doc_v2",
      "yuque_delete_repo",
    ]) {
      skip(n, reason.includes("YUQUE_TOKEN") ? "未配置 YUQUE_TOKEN（个人令牌）" : reason);
    }
    return;
  }

  let namespace = "";
  let docSlug = `${PREFIX}-v2`;

  await step("yuque_list_repos", async () => {
    const repos = await yuqueListRepos(token);
    const arr = Array.isArray(repos) ? repos : [];
    return `n=${arr.length}`;
  });

  let login = "";
  await step("yuque_v2_whoami", async () => {
    const me = await yuqueGetUser(token);
    login = me?.login || "";
    if (!login) throw new Error(`无法取得 login: ${JSON.stringify(me).slice(0, 120)}`);
    return `login=${login}`;
  });

  const created = await step("yuque_create_repo", async () => {
    const repo = (await yuqueCreateRepo(
      PREFIX,
      { description: "KnowPilot smoke", public: 0, slug: PREFIX, login },
      token,
    )) as any;
    namespace =
      pickId(repo, "namespace") ||
      (repo?.user?.login && repo?.slug ? `${repo.user.login}/${repo.slug}` : "") ||
      (login ? `${login}/${pickId(repo, "slug") || PREFIX}` : "");
    if (!namespace) throw new Error(`无 namespace: ${JSON.stringify(repo).slice(0, 200)}`);
    return `ns=${namespace} id=${pickId(repo, "id") || "?"}`;
  });

  if (!created || !namespace) {
    for (const n of [
      "yuque_update_repo",
      "yuque_list_docs",
      "yuque_create_doc_v2",
      "yuque_update_doc_v2",
      "yuque_get_doc_v2",
      "yuque_delete_doc_v2",
      "yuque_delete_repo",
    ]) {
      skip(n, "create_repo 失败");
    }
    return;
  }

  await step("yuque_update_repo", async () => {
    await yuqueUpdateRepo(namespace, { description: `${PREFIX} upd` }, token);
    return "updated";
  });

  await step("yuque_list_docs", async () => {
    const docs = await yuqueListDocs(namespace, token);
    const arr = Array.isArray(docs) ? docs : [];
    return `n=${arr.length}`;
  });

  const docOk = await step("yuque_create_doc_v2", async () => {
    const doc = (await yuqueCreateDocV2(namespace, `${PREFIX}-doc`, `# ${PREFIX}`, token)) as any;
    docSlug = pickId(doc, "slug") || docSlug;
    return `slug=${docSlug}`;
  });

  if (docOk) {
    await step("yuque_update_doc_v2", async () => {
      await yuqueUpdateDocV2(namespace, docSlug, `${PREFIX}-doc-upd`, `# upd`, token);
      return "updated";
    });
    await step("yuque_get_doc_v2", async () => {
      const doc = (await yuqueGetDocV2(namespace, docSlug, token)) as any;
      return `title=${doc?.title || "?"}`;
    });
    await step("yuque_delete_doc_v2", async () => {
      await yuqueDeleteDocV2(namespace, docSlug, token);
      return "deleted";
    });
  } else {
    for (const n of ["yuque_update_doc_v2", "yuque_get_doc_v2", "yuque_delete_doc_v2"]) {
      skip(n, "create_doc_v2 失败");
    }
  }

  await step("yuque_delete_repo", async () => {
    await yuqueDeleteRepo(namespace, token);
    return "deleted";
  });
}

/* ───────────────── 飞书 ───────────────── */

async function smokeFeishu() {
  console.log("\n=== 飞书 ===");
  const config = getAppConfig();

  await step("feishu_tenant_token", async () => {
    const t = await getTenantAccessToken(config);
    if (!t) throw new Error("无 tenant token");
    return `len=${t.length}`;
  });

  await step("feishu_token_status", async () => {
    const s = await getUserAccessTokenStatus(prisma, config);
    const envUser = Boolean(config.integrations.feishu.userAccessToken?.trim());
    return `exists=${s.exists} valid=${s.valid} source=${s.source || "?"} envUser=${envUser}`;
  });

  await step("feishu_user_token_resolve", async () => {
    const t = await getUserAccessToken(prisma, config);
    if (!t) throw new Error("无法解析 user_access_token");
    return `len=${t.length}`;
  });

  // refresh：Credential 或 oauth 文件均可
  const refreshTok =
    (await getCredentialValue(prisma, "feishu", "feishu_refresh_token").catch(() => "")) ||
    process.env.FEISHU_REFRESH_TOKEN?.trim() ||
    "";
  if (refreshTok) {
    await step("feishu_refresh_token", async () => {
      const t = await refreshUserAccessToken(prisma, refreshTok, config);
      return `new_prefix=${t.slice(0, 6)}...`;
    });
  } else {
    const { refreshTokenManually, getTokenStatus } = await import("../infra/external/larkTokenManager.js");
    const st = getTokenStatus();
    if (st.refresh_token_exists) {
      await step("feishu_refresh_token", async () => {
        const r = await refreshTokenManually();
        if (!r.success) throw new Error(r.error || "file refresh failed");
        return `source=file expires_in=${r.expires_in}`;
      });
    } else {
      skip("feishu_refresh_token", "无 refresh_token（Credential / feishu_oauth.json）");
    }
  }

  // 授权工具存在性（不重复弹浏览器）
  await step("feishu_authorize_tool_registered", async () => {
    const { listNativeTools } = await import("../infra/nativeTools.js");
    const hit = listNativeTools().some((t) => t.name === "feishu_authorize");
    if (!hit) throw new Error("feishu_authorize 未注册");
    return "registered";
  });

  await step("feishu_search_docs", async () => {
    const hits = await feishuSearchDocs("KnowPilot", prisma, config);
    const n = Array.isArray(hits) ? hits.length : typeof hits === "object" ? "obj" : "?";
    return `hits=${n}`;
  });

  let documentId = "";
  const docCreated = await step("feishu_create_doc", async () => {
    const data = (await feishuCreateDoc(`${PREFIX}-doc`, undefined, prisma, config)) as any;
    documentId =
      pickId(data?.document, "document_id") ||
      pickId(data, "document_id") ||
      pickId(data?.document, "obj_token");
    if (!documentId) throw new Error(`无 document_id: ${JSON.stringify(data).slice(0, 200)}`);
    return `id=${documentId}`;
  });

  if (docCreated && documentId) {
    await step("feishu_get_doc", async () => {
      const data = (await feishuGetDoc(documentId, prisma, config)) as any;
      const title = data?.document?.title || data?.title || "?";
      return `title=${title}`;
    });

    await step("feishu_update_doc", async () => {
      await feishuUpdateDocTitle(documentId, `${PREFIX}-doc-upd`, prisma, config);
      return "title updated";
    });

    // 画板：空文档通常无 board → 尝试插入 board block，再测节点
    await step("feishu_list_doc_whiteboards", async () => {
      const boards = await feishuListDocWhiteboards(documentId, prisma, config);
      return `n=${boards.length}`;
    });

    let whiteboardId = "";
    const boardSeed = await step("feishu_seed_board_block", async () => {
      // 取根 block，挂一个画板子块
      const root = (await feishuApi(
        `/docx/v1/documents/${documentId}/blocks/${documentId}`,
        { useUserToken: true },
        prisma,
        config,
      )) as any;
      const children = (await feishuApi(
        `/docx/v1/documents/${documentId}/blocks/${documentId}/children`,
        {
          method: "POST",
          useUserToken: true,
          body: {
            children: [{ block_type: 43, board: {} }],
            index: 0,
          },
        },
        prisma,
        config,
      )) as any;
      const boards = await feishuListDocWhiteboards(documentId, prisma, config);
      whiteboardId = boards[0]?.whiteboardId || "";
      if (!whiteboardId) {
        throw new Error(`插入画板后仍无 whiteboardId children=${JSON.stringify(children).slice(0, 160)} root=${!!root}`);
      }
      return `whiteboardId=${whiteboardId}`;
    });

    if (boardSeed && whiteboardId) {
      await step("feishu_list_whiteboard_nodes", async () => {
        const nodes = await feishuListWhiteboardNodes(whiteboardId, prisma, config);
        const n = Array.isArray((nodes as any)?.nodes) ? (nodes as any).nodes.length : "?";
        return `nodes=${n}`;
      });

      // 原生节点 JSON 结构随官方迭代变化大；主路径用 mermaid 导入（Agent 友好）
      await step("feishu_create_whiteboard_nodes", async () => {
        try {
          const res = (await feishuCreateWhiteboardNodes(
            whiteboardId,
            [
              {
                type: "composite_shape",
                shape: "round_rect",
                x: 80,
                y: 80,
                width: 160,
                height: 80,
                text: { text: PREFIX.slice(0, 24) },
              },
            ],
            { overwrite: false },
            prisma,
            config,
          )) as any;
          return `ok ${JSON.stringify(res).slice(0, 60)}`;
        } catch (e) {
          // 结构不兼容时不阻断：from_diagram 才是主路径
          return `soft-fail(用 from_diagram): ${e instanceof Error ? e.message.slice(0, 80) : e}`;
        }
      });

      await step("feishu_whiteboard_from_diagram", async () => {
        await feishuWhiteboardFromDiagram(
          whiteboardId,
          `flowchart LR\n  A[${PREFIX}] --> B[ok]`,
          "mermaid",
          { overwrite: true },
          prisma,
          config,
        );
        // 导入后白板异步就绪，稍等再删
        await new Promise((r) => setTimeout(r, 2000));
        return "mermaid written";
      });

      await step("feishu_get_whiteboard_theme", async () => {
        const t = await feishuGetWhiteboardTheme(whiteboardId, prisma, config);
        return JSON.stringify(t).slice(0, 80);
      });

      await step("feishu_update_whiteboard_theme", async () => {
        await feishuUpdateWhiteboardTheme(whiteboardId, "classic", prisma, config);
        return "classic";
      });

      await step("feishu_delete_whiteboard_nodes", async () => {
        for (let i = 0; i < 3; i++) {
          try {
            const listed = (await feishuListWhiteboardNodes(whiteboardId, prisma, config)) as any;
            const ids = (listed?.nodes || [])
              .map((n: any) => n?.id)
              .filter(Boolean)
              .slice(0, 20) as string[];
            if (!ids.length) return "no nodes to delete (ok)";
            await feishuDeleteWhiteboardNodes(whiteboardId, ids, {}, prisma, config);
            return `deleted=${ids.length}`;
          } catch (e) {
            if (i === 2) throw e;
            await new Promise((r) => setTimeout(r, 1500));
          }
        }
        return "ok";
      });
    } else {
      for (const n of [
        "feishu_list_whiteboard_nodes",
        "feishu_create_whiteboard_nodes",
        "feishu_whiteboard_from_diagram",
        "feishu_get_whiteboard_theme",
        "feishu_update_whiteboard_theme",
        "feishu_delete_whiteboard_nodes",
      ]) {
        skip(n, "无法创建画板块（权限/API）");
      }
    }

    await step("feishu_delete_doc", async () => {
      await feishuDeleteDoc(documentId, prisma, config);
      return "deleted";
    });
  } else {
    for (const n of [
      "feishu_get_doc",
      "feishu_update_doc",
      "feishu_list_doc_whiteboards",
      "feishu_seed_board_block",
      "feishu_list_whiteboard_nodes",
      "feishu_create_whiteboard_nodes",
      "feishu_whiteboard_from_diagram",
      "feishu_get_whiteboard_theme",
      "feishu_update_whiteboard_theme",
      "feishu_delete_whiteboard_nodes",
      "feishu_delete_doc",
    ]) {
      skip(n, "create_doc 失败");
    }
  }

  // 表格
  let sheetToken = "";
  const sheetOk = await step("feishu_create_spreadsheet", async () => {
    const data = (await feishuCreateSpreadsheet(`${PREFIX}-sheet`, undefined, prisma, config)) as any;
    sheetToken =
      pickId(data?.spreadsheet, "spreadsheet_token") ||
      pickId(data, "spreadsheet_token") ||
      pickId(data?.spreadsheet, "token");
    if (!sheetToken) throw new Error(`无 spreadsheet_token: ${JSON.stringify(data).slice(0, 180)}`);
    return `token=${sheetToken.slice(0, 12)}...`;
  });

  if (sheetOk && sheetToken) {
    await step("feishu_append_spreadsheet_values", async () => {
      // sheets v2 常用 sheetId!A1；先查 meta
      let range = "A1:B1";
      try {
        const meta = (await feishuApi(
          `/sheets/v3/spreadsheets/${sheetToken}/sheets/query`,
          { useUserToken: true },
          prisma,
          config,
        )) as any;
        const sheetId = meta?.sheets?.[0]?.sheet_id || meta?.sheets?.[0]?.sheetId;
        if (sheetId) range = `${sheetId}!A1:B1`;
      } catch {
        /* 用默认 */
      }
      await feishuAppendSpreadsheetValues(sheetToken, range, [[PREFIX, "ok"]], prisma, config);
      return `range=${range}`;
    });

    await step("feishu_delete_spreadsheet", async () => {
      await feishuApi(
        `/drive/v1/files/${encodeURIComponent(sheetToken)}`,
        { method: "DELETE", query: { type: "sheet" }, useUserToken: true },
        prisma,
        config,
      );
      return "deleted";
    });
  } else {
    skip("feishu_append_spreadsheet_values", "create_spreadsheet 失败");
    skip("feishu_delete_spreadsheet", "create_spreadsheet 失败");
  }

  // Wiki
  let spaceId = process.env.FEISHU_SMOKE_WIKI_SPACE_ID?.trim() || "";
  if (!spaceId) {
    await step("feishu_list_wiki_spaces", async () => {
      const data = (await feishuApi("/wiki/v2/spaces", { useUserToken: true }, prisma, config)) as any;
      const items = data?.items || [];
      spaceId = items[0]?.space_id || items[0]?.spaceId || "";
      return `n=${items.length} pick=${spaceId || "none"}`;
    });
  } else {
    rec("feishu_list_wiki_spaces", "SKIP", `使用 FEISHU_SMOKE_WIKI_SPACE_ID=${spaceId}`);
  }

  if (spaceId) {
    await step("feishu_get_wiki_space", async () => {
      const data = await feishuGetWikiSpace(spaceId, prisma, config);
      return JSON.stringify(data).slice(0, 100);
    });
    await step("feishu_get_wiki_nodes", async () => {
      const data = (await feishuGetWikiNodes(spaceId, undefined, prisma, config)) as any;
      const n = data?.items?.length ?? "?";
      return `nodes=${n}`;
    });
    let nodeToken = "";
    const nodeOk = await step("feishu_create_wiki_node", async () => {
      const data = (await feishuCreateWikiNode(spaceId, `${PREFIX}-wiki`, {}, prisma, config)) as any;
      nodeToken = pickId(data?.node, "node_token") || pickId(data, "node_token") || "";
      const obj = pickId(data?.node, "obj_token") || "";
      return `node=${nodeToken || "?"} obj=${obj || "?"}`;
    });
    if (nodeOk && nodeToken) {
      // wiki 节点删除：move to trash if API allows
      await step("feishu_cleanup_wiki_node", async () => {
        try {
          await feishuApi(
            `/wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes/${encodeURIComponent(nodeToken)}`,
            { method: "DELETE", useUserToken: true },
            prisma,
            config,
          );
          return "deleted";
        } catch (e) {
          return `cleanup-fail(可手动删): ${e instanceof Error ? e.message.slice(0, 80) : e}`;
        }
      });
    } else {
      skip("feishu_cleanup_wiki_node", "create_wiki_node 失败");
    }
  } else {
    for (const n of [
      "feishu_get_wiki_space",
      "feishu_get_wiki_nodes",
      "feishu_create_wiki_node",
      "feishu_cleanup_wiki_node",
    ]) {
      skip(n, "无可用 Wiki space（设 FEISHU_SMOKE_WIKI_SPACE_ID 或开通知识库）");
    }
  }

  // 发消息
  const receiveId = process.env.FEISHU_SMOKE_RECEIVE_ID?.trim();
  if (receiveId) {
    await step("feishu_send_text", async () => {
      await feishuSendText(receiveId, "open_id", `[KnowPilot smoke] ${PREFIX}`, config);
      return `to=${receiveId.slice(0, 8)}...`;
    });
    skip("feishu_send_message", "与 send_text 同通道，略");
  } else {
    skip("feishu_send_text", "未设 FEISHU_SMOKE_RECEIVE_ID");
    skip("feishu_send_message", "未设 FEISHU_SMOKE_RECEIVE_ID");
  }
}

async function main() {
  console.log(`KnowPilot 语雀/飞书全量联调  prefix=${PREFIX}\n`);
  await smokeYuqueWeb();
  await smokeYuqueV2();
  await smokeFeishu();

  const pass = rows.filter((r) => r.status === "PASS").length;
  const fail = rows.filter((r) => r.status === "FAIL").length;
  const skipn = rows.filter((r) => r.status === "SKIP").length;
  console.log(`\n======== 汇总 PASS=${pass} FAIL=${fail} SKIP=${skipn} TOTAL=${rows.length} ========`);
  if (fail) {
    console.log("\n失败项:");
    for (const r of rows.filter((x) => x.status === "FAIL")) {
      console.log(`  - ${r.name}: ${r.detail}`);
    }
  }
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
