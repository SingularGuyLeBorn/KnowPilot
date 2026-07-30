/**
 * 小红书收藏/点赞探测：小步慢滚 + 每步等列表 API + noteId 去重。
 *
 *   pnpm --filter @knowpilot/server exec tsx src/scripts/probe-xhs-fav.ts --kind collect
 *   pnpm --filter @knowpilot/server exec tsx src/scripts/probe-xhs-fav.ts --kind both
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getAppConfig } from "../infra/config.js";
import {
  clearPlatformLoginState,
  getPlatformStorageStatePath,
  isXhsPageLoggedIn,
  waitAndPersistPlatformLogin,
} from "../infra/metablog/auth/platformLogin.js";
import { launchZhihuBrowser } from "../infra/metablog/auth/zhihuBrowser.js";
import { loadCookies } from "../infra/cookieJar.js";
import { parseXhsNotesFromApiJson, type XhsSyncKind } from "../infra/inbox/xhs.js";

const DEFAULT_UID = "63461962000000001802c1c4";

const KIND_CFG: Record<
  XhsSyncKind,
  { tabQuery: string; apiPattern: RegExp; label: string }
> = {
  collect: {
    tabQuery: "tab=fav&subTab=note",
    apiPattern: /\/api\/sns\/web\/v\d+\/note\/collect\/page/i,
    label: "收藏",
  },
  liked: {
    tabQuery: "tab=liked&subTab=note",
    apiPattern: /\/api\/sns\/web\/v\d+\/note\/like\/page/i,
    label: "点赞",
  },
};

type NoteRow = {
  noteId: string;
  title: string;
  author?: string;
  url: string;
  source: "api" | "dom";
  kind: XhsSyncKind;
};

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i < 0) return undefined;
  return process.argv[i + 1];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function scrapeDomNotes(page: {
  evaluate: (fn: () => unknown) => Promise<unknown>;
}): Promise<Array<{ noteId: string; title: string; author: string; url: string }>> {
  return (await page.evaluate(() => {
    const out: Array<{ noteId: string; title: string; author: string; url: string }> = [];
    for (const sec of Array.from(document.querySelectorAll<HTMLElement>("section.note-item"))) {
      const noteId = (sec.getAttribute("data-note-id") || "").trim();
      if (!noteId) continue;
      const title =
        sec.querySelector(".title span")?.textContent?.trim() ||
        sec.querySelector(".title")?.textContent?.trim() ||
        "";
      const author = sec.querySelector(".author .name, .name")?.textContent?.trim() || "";
      const a = sec.querySelector<HTMLAnchorElement>('a[href*="/explore/"]');
      out.push({
        noteId,
        title: title.slice(0, 200),
        author,
        url: a?.href || `https://www.xiaohongshu.com/explore/${noteId}`,
      });
    }
    return out;
  })) as Array<{ noteId: string; title: string; author: string; url: string }>;
}

async function main(): Promise<void> {
  const uid = argValue("--uid") || DEFAULT_UID;
  const kindArg = (argValue("--kind") || "collect").toLowerCase();
  const kinds: XhsSyncKind[] =
    kindArg === "liked" || kindArg === "like"
      ? ["liked"]
      : kindArg === "both"
        ? ["collect", "liked"]
        : ["collect"];

  // 小步：每次只滚一点点；慢：滚完必须等到列表 API 或超时
  const scrollDelta = Number(argValue("--delta") || "420");
  const gapMs = Number(argValue("--gap") || "2800");
  const maxRounds = Number(argValue("--rounds") || "200");
  const stagnantStop = Number(argValue("--stagnant") || "12");

  const config = getAppConfig();
  const storageState = getPlatformStorageStatePath("xhs");
  const cookies = loadCookies("xhs");
  console.log("[probe] uid:", uid, "kinds:", kinds.join(","));
  console.log(
    `[probe] 小步慢滚 delta=${scrollDelta}px gap=${gapMs}ms rounds<=${maxRounds} stagnantStop=${stagnantStop}`,
  );

  const { browser, context, page } = await launchZhihuBrowser({
    headless: false,
    storageState: storageState ?? undefined,
  });
  if (cookies.length) {
    await context.addCookies(
      cookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path || "/",
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: (c.sameSite as "Strict" | "Lax" | "None" | undefined) ?? "Lax",
        ...(typeof c.expires === "number" && c.expires > 0 ? { expires: c.expires } : {}),
      })),
    );
  }

  let activeKind: XhsSyncKind | null = null;
  const byKind = new Map<XhsSyncKind, Map<string, NoteRow>>();
  for (const k of kinds) byKind.set(k, new Map());

  const ingestApi = (kind: XhsSyncKind, json: unknown, via: string): number => {
    const parsed = parseXhsNotesFromApiJson(json, kind);
    const bucket = byKind.get(kind)!;
    let added = 0;
    for (const n of parsed) {
      if (bucket.has(n.noteId)) continue;
      bucket.set(n.noteId, {
        noteId: n.noteId,
        title: n.title,
        author: n.author,
        url: n.url,
        source: "api",
        kind,
      });
      added += 1;
    }
    if (added > 0 || parsed.length > 0) {
      console.log(
        `[probe][${KIND_CFG[kind].label}] API +${added}/${parsed.length} total=${bucket.size} ← ${via}`,
      );
    }
    return added;
  };

  const ingestDom = async (kind: XhsSyncKind): Promise<number> => {
    const bucket = byKind.get(kind)!;
    let added = 0;
    for (const n of await scrapeDomNotes(page)) {
      if (bucket.has(n.noteId)) continue;
      bucket.set(n.noteId, { ...n, source: "dom", kind });
      added += 1;
    }
    return added;
  };

  // 全程挂 response：宁可重复解析，Set 去重
  context.on("response", async (response) => {
    try {
      if (!activeKind) return;
      const u = response.url();
      if (!KIND_CFG[activeKind].apiPattern.test(u)) return;
      if (!response.ok()) return;
      const json = await response.json().catch(() => null);
      if (!json) return;
      ingestApi(activeKind, json, u.split("?")[0] || "api");
    } catch {
      /* ignore */
    }
  });

  const ensureLogin = async (): Promise<boolean> => {
    await page.goto("https://www.xiaohongshu.com/explore", {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await sleep(2000);
    if (await isXhsPageLoggedIn(page)) return true;
    console.log("[probe] 请扫码登录（手机点确认）…");
    const relogin = await waitAndPersistPlatformLogin("xhs", context, page, 480);
    if (!relogin.success) {
      clearPlatformLoginState("xhs");
      console.error("[probe] 补登失败:", relogin.message);
      return false;
    }
    return true;
  };

  if (!(await ensureLogin())) {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    process.exit(1);
  }

  for (const kind of kinds) {
    const cfg = KIND_CFG[kind];
    const pageUrl = `https://www.xiaohongshu.com/user/profile/${uid}?${cfg.tabQuery}`;
    activeKind = kind;
    const bucket = byKind.get(kind)!;
    console.log(`\n[probe] === ${cfg.label} ===`);
    console.log("[probe] goto", pageUrl);

    const firstWait = page
      .waitForResponse((r) => cfg.apiPattern.test(r.url()) && r.ok(), { timeout: 45000 })
      .catch(() => null);
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
    const first = await firstWait;
    if (first) {
      const json = await first.json().catch(() => null);
      if (json) ingestApi(kind, json, "first");
    }
    await sleep(gapMs);
    await ingestDom(kind);
    console.log(`[probe][${cfg.label}] first paint total=${bucket.size}`);

    let stagnant = 0;
    for (let i = 0; i < maxRounds; i++) {
      const before = bucket.size;

      // 小步滚 → 优先等下一次列表 API 完成再继续（避免翻页请求被取消）
      const waitApi = page
        .waitForResponse((r) => cfg.apiPattern.test(r.url()) && r.ok(), {
          timeout: gapMs + 5000,
        })
        .catch(() => null);

      await page.mouse.wheel(0, scrollDelta);
      const resp = await waitApi;
      if (resp) {
        const json = await resp.json().catch(() => null);
        if (json) ingestApi(kind, json, `scroll#${i + 1}`);
      }
      // 即使没新 API，也收当前屏 DOM（虚拟列表卸掉前）
      const domAdded = await ingestDom(kind);
      // 额外停一拍，让未完成请求落地
      await sleep(Math.floor(gapMs * 0.5));

      const after = bucket.size;
      const delta = after - before;
      console.log(
        `[probe][${cfg.label}] step ${i + 1}/${maxRounds} +${delta} (dom+${domAdded}) total=${after} stagnant=${delta === 0 ? stagnant + 1 : 0}`,
      );

      if (delta === 0) stagnant += 1;
      else stagnant = 0;
      if (stagnant >= stagnantStop) {
        console.log(`[probe][${cfg.label}] 连续 ${stagnantStop} 步无新增，结束`);
        break;
      }
    }

    activeKind = null;
    console.log(`[probe][${cfg.label}] DONE unique=${bucket.size}`);
  }

  const outDir = path.join(config.dataPaths.inbox, "xhs");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `probe-slow-${Date.now()}.json`);
  const report = {
    uid,
    fetchedAt: new Date().toISOString(),
    expectedCollectHint: 132,
    strategy: "small-scroll-wait-api-dedupe",
    scrollDelta,
    gapMs,
    byKind: Object.fromEntries(
      kinds.map((k) => {
        const notes = [...byKind.get(k)!.values()];
        return [
          k,
          {
            total: notes.length,
            notes: notes.map((n) => ({
              noteId: n.noteId,
              title: n.title,
              author: n.author,
              url: n.url,
              source: n.source,
            })),
          },
        ];
      }),
    ),
  };
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

  if (byKind.has("collect")) {
    const notes = [...byKind.get("collect")!.values()];
    const lines = [
      `# 小红书收藏（笔记）已拉取 ${notes.length} 条`,
      "",
      `来源: ${path.basename(outPath)} · 小步慢滚去重`,
      "",
      "| # | noteId | 标题 | 作者 |",
      "|---|---|---|---|",
    ];
    notes.forEach((n, i) => {
      lines.push(
        `| ${i + 1} | ${n.noteId} | ${String(n.title || "").replace(/\|/g, "\\|")} | ${n.author || ""} |`,
      );
    });
    fs.writeFileSync(path.join(outDir, "collect-list.md"), lines.join("\n"), "utf8");
    fs.writeFileSync(
      path.join(outDir, "collect-list.csv"),
      ["#,noteId,title,author,url"]
        .concat(
          notes.map(
            (n, i) =>
              `${i + 1},${n.noteId},${JSON.stringify(n.title || "")},${JSON.stringify(n.author || "")},${n.url}`,
          ),
        )
        .join("\n"),
      "utf8",
    );
  }

  console.log("\n[probe] wrote", outPath);
  for (const k of kinds) {
    console.log(`[probe] ${KIND_CFG[k].label}=${byKind.get(k)!.size}`);
  }

  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain || process.argv[1]?.includes("probe-xhs-fav")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
