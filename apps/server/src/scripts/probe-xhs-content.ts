/**
 * 探测：对若干收藏笔记走与 fetchContent 相同的 parsePlatformUrl（正文+图片）。
 *
 *   pnpm --filter @knowpilot/server exec tsx src/scripts/probe-xhs-content.ts
 *   pnpm --filter @knowpilot/server exec tsx src/scripts/probe-xhs-content.ts --n 3
 */
import fs from "fs";
import path from "path";
import { getAppConfig } from "../infra/config.js";
import { parsePlatformUrl } from "../infra/metablog/index.js";

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const n = Math.min(5, Math.max(1, Number(argValue("--n") || "2")));
  const dir = path.join(getAppConfig().dataPaths.inbox, "xhs");
  const probes = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("probe-slow-") || f.startsWith("probe-tabs-"))
    .sort()
    .reverse();
  if (!probes.length) {
    console.error("无 probe 结果，请先跑 probe-xhs-fav");
    process.exit(1);
  }
  const report = JSON.parse(fs.readFileSync(path.join(dir, probes[0]!), "utf8")) as {
    byKind?: { collect?: { notes?: Array<{ noteId: string; title: string; url: string }> } };
  };
  const pick = (report.byKind?.collect?.notes ?? []).slice(0, n);
  console.log("[content] source", probes[0], "try", pick.length, "notes");
  console.log(
    "[content] storageState",
    fs.existsSync(path.join(getAppConfig().dataPaths.cookies, "xhs_storage_state.json")),
  );

  const out: unknown[] = [];
  for (const note of pick) {
    console.log("\n[content] ===", note.title, note.noteId);
    console.log("[content] url", note.url);
    try {
      const parsed = await parsePlatformUrl({
        url: note.url,
        timeout: 60000,
        method: "playwright",
        embedOcr: false,
      });
      const images = Array.isArray(parsed.images) ? parsed.images : [];
      const content = String(parsed.content || "");
      const row = {
        noteId: note.noteId,
        titleIn: note.title,
        titleOut: parsed.title,
        author: parsed.author,
        platform: parsed.platform,
        method: parsed.method,
        contentChars: content.length,
        contentPreview: content.replace(/\s+/g, " ").trim().slice(0, 220),
        imageCount: images.length,
        images: images.slice(0, 5),
        ok: content.length > 20 || images.length > 0,
      };
      console.log(JSON.stringify(row, null, 2));
      out.push(row);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[content] FAIL", msg);
      out.push({ noteId: note.noteId, titleIn: note.title, ok: false, error: msg });
    }
    await sleep(2500);
  }

  const outPath = path.join(dir, `probe-content-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ fetchedAt: new Date().toISOString(), results: out }, null, 2));
  console.log("\n[content] wrote", outPath);
  const ok = out.filter((r) => (r as { ok?: boolean }).ok).length;
  console.log(`[content] success ${ok}/${out.length}`);
  process.exit(ok > 0 ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
