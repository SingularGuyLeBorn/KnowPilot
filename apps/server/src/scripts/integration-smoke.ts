/**
 * 真实环境冒烟（无 mock）— 搜索 / OCR / 网页 / Playwright / 平台解析
 * 用法: pnpm --filter @knowpilot/server integration:smoke
 */

import path from "path";
import fs from "fs";
import { formatToolResultHint } from "@knowpilot/shared";
import { loadRootEnv, getAppConfig } from "../infra/config.js";
import { performOcrFromFile, getOcrStatus, probeOcrPython } from "../infra/ocrService.js";
import { executeNativeTool, syncSearchEnvFromConfig } from "../infra/nativeTools.js";
import { getServerCapabilities } from "../infra/capabilities.js";
import { smartSearch, getEngineStatus, closeBrowser } from "../infra/metablog/index.js";
import { hasSystemChrome } from "../infra/metablog/playwrightChrome.js";
import { prisma } from "../db.js";
import { getEventBus } from "../infra/eventBus.js";
import { getServiceContainer } from "../infra/serviceContainer.js";

loadRootEnv();
const config = getAppConfig();
syncSearchEnvFromConfig(config);

const eventBus = getEventBus();
const services = getServiceContainer(prisma, eventBus, config);

const isCi = process.env.INTEGRATION_SMOKE_CI === "1" || process.env.CI === "true";
const runPlatform = process.env.INTEGRATION_SMOKE_PLATFORM === "1" || process.argv.includes("--platform");
const runPlatformQuick =
  process.env.INTEGRATION_SMOKE_PLATFORM_QUICK === "1" || process.argv.includes("--quick-platform");
const runPlatformMedium =
  process.env.INTEGRATION_SMOKE_PLATFORM_MEDIUM === "1" || process.argv.includes("--medium-platform");
const runPlatformExtended =
  process.env.INTEGRATION_SMOKE_PLATFORM_EXTENDED === "1" || process.argv.includes("--extended-platform");

const ctx = { config, services, invokeTrpc: async () => ({}) };

function briefResults(results: Array<{ title: string; url: string; snippet?: string }>) {
  return results.map((r) => ({ title: r.title, url: r.url, snippet: (r.snippet || "").slice(0, 120) }));
}

function logToolHint(label: string, result: unknown) {
  const hint = formatToolResultHint(result);
  if (hint) console.log(`  [hint] ${label}: ${hint}`);
}

async function optionalStep(label: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`\n⚠ ${label} 跳过: ${msg.split("\n")[0]}`);
  }
}

type ReadArticleSmoke = {
  label: string;
  url?: string;
  defaultUrl?: string;
  envVar?: string;
  /** 未设置该 env 时跳过（如 Cookie 门禁） */
  requiresEnv?: string;
  minChars: number;
  timeout?: number;
  /** 失败时记为 skipped 而非 failed（如简书反爬不稳定） */
  softFail?: boolean;
  /** 连跑冒烟前重置共享 Playwright 浏览器（减轻 SPA 壳页/反爬） */
  refreshBrowser?: boolean;
};

/** 平台冒烟执行顺序（轻量 HTTP/API 优先，Playwright 密集靠后） */
const PLATFORM_SMOKE_ORDER = [
  "博客园",
  "GitHub",
  "InfoQ",
  "B站",
  "开源中国",
  "掘金",
  "CSDN",
  "SegmentFault",
  "简书",
  "知乎",
  "微信",
  "小红书",
  "抖音",
] as const satisfies readonly string[];

function sortPlatformSmokeCases(cases: ReadArticleSmoke[]): ReadArticleSmoke[] {
  const rank = new Map<string, number>(PLATFORM_SMOKE_ORDER.map((label, i) => [label, i]));
  return [...cases].sort((a, b) => (rank.get(a.label) ?? 999) - (rank.get(b.label) ?? 999));
}

async function runPlatformSmokesParallel(
  specs: ReadArticleSmoke[],
  concurrency = 3,
): Promise<
  Array<{
    label: string;
    status: string;
    ms: number;
    author?: string;
    method?: string;
    contentChars?: number;
  }>
> {
  const results: Array<{
    label: string;
    status: string;
    ms: number;
    author?: string;
    method?: string;
    contentChars?: number;
  }> = new Array(specs.length);
  let next = 0;
  async function worker() {
    while (next < specs.length) {
      const index = next++;
      const spec = specs[index]!;
      if (spec.refreshBrowser) {
        await closeBrowser().catch(() => undefined);
      }
      results[index] = { label: spec.label, ...(await optionalReadArticleSmoke(spec)) };
    }
  }
  const workers = Math.min(concurrency, specs.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

async function optionalReadArticleSmoke(
  spec: ReadArticleSmoke,
): Promise<{
  status: "passed" | "skipped" | "failed";
  ms: number;
  author?: string;
  method?: string;
  contentChars?: number;
}> {
  if (spec.requiresEnv) {
    const keys = spec.requiresEnv.split("|").map((k) => k.trim()).filter(Boolean);
    const configured = keys.some((k) => Boolean(process.env[k]?.trim()));
    if (!configured) {
      console.log(`\n⚠ 未设置 ${keys.join(" 或 ")}，跳过 ${spec.label} read_article`);
      return { status: "skipped", ms: 0 };
    }
  }
  const url =
    spec.url?.trim() ||
    (spec.envVar ? process.env[spec.envVar]?.trim() : undefined) ||
    spec.defaultUrl?.trim();
  if (!url) {
    const hint = spec.envVar ? `未设置 ${spec.envVar}` : "未提供 URL";
    console.log(`\n⚠ ${hint}，跳过 ${spec.label} read_article`);
    return { status: "skipped", ms: 0 };
  }
  const t0 = Date.now();
  let passed = false;
  let author: string | undefined;
  let method: string | undefined;
  let contentChars: number | undefined;
  await optionalStep(`read_article (${spec.label})`, async () => {
    console.log(`\n=== read_article (${spec.label}) ===`);
    const t = Date.now();
    const raw = await executeNativeTool(
      "read_article",
      { url, timeout: spec.timeout ?? 45000, embedOcr: false, maxChars: 8000 },
      ctx,
    );
    const row = raw as {
      title?: string;
      author?: string;
      platform?: string;
      method?: string;
      contentChars?: number;
      elapsedMs?: number;
    };
    author = row.author?.trim() || undefined;
    method = row.method;
    contentChars = row.contentChars;
    console.log(JSON.stringify({ ms: Date.now() - t, ...row }, null, 2));
    logToolHint(`read_article (${spec.label})`, raw);
    if ((row.contentChars ?? 0) < spec.minChars) {
      throw new Error(`${spec.label} 正文过短 (${row.contentChars ?? 0} < ${spec.minChars})`);
    }
    passed = true;
  });
  const ms = Date.now() - t0;
  const meta = { author, method, contentChars };
  if (passed) return { status: "passed", ms, ...meta };
  if (spec.softFail) return { status: "skipped", ms, ...meta };
  return { status: "failed", ms, ...meta };
}

async function main() {
  const ocrStatus = getOcrStatus(config);
  const ocrProbe = await probeOcrPython(config);
  const runtimeCaps = getServerCapabilities(config);
  const enabledSources = await services.infoSource.list({ page: 1, pageSize: 1, enabled: true });
  const realInfoSources = await services.infoSource.list({ page: 1, pageSize: 200, enabled: true });
  const realInfoSourceCount = realInfoSources.items.filter(
    (s) => !/^Smoke Source \d+$/.test(s.name) && !/^smoke-source-\d+$/.test(s.sourceSlug ?? ""),
  ).length;
  const summary: Record<string, unknown> = {
    chrome: hasSystemChrome(),
    searchPriority: config.search.enginePriority,
    engines: getEngineStatus().filter((e) => e.available).map((e) => e.name),
    ocr: { ...ocrStatus, probe: ocrProbe },
    readArticleCookies: runtimeCaps.readArticle.cookies,
    readArticlePlatforms: runtimeCaps.readArticle.platforms.length,
    infoSourcesEnabled: enabledSources.total,
    infoSourcesReal: realInfoSourceCount,
  };

  console.log("=== 配置摘要 ===");
  console.log(JSON.stringify(summary, null, 2));

  console.log("\n=== smartSearch ===");
  const t0 = Date.now();
  const search = await smartSearch("KnowPilot 本地知识库", 3);
  console.log(
    JSON.stringify(
      { ms: Date.now() - t0, engine: search.engine, total: search.total, results: briefResults(search.results) },
      null,
      2,
    ),
  );

  console.log("\n=== web_search ===");
  const t1 = Date.now();
  const native = await executeNativeTool("web_search", { query: "DeepSeek API 文档", maxResults: 3 }, ctx);
  const n = native as {
    provider?: string;
    searchPhase?: string;
    elapsedMs?: number;
    enginesAttempted?: string[];
    infoSourcesUsed?: Array<{ name?: string }>;
    results?: Array<{ title: string; url: string }>;
  };
  console.log(
    JSON.stringify(
      {
        ms: Date.now() - t1,
        elapsedMs: n.elapsedMs,
        enginesAttempted: n.enginesAttempted,
        provider: n.provider,
        phase: n.searchPhase,
        infoSourcesUsed: n.infoSourcesUsed?.map((s) => s.name),
        results: (n.results || []).map((r) => ({ title: r.title, url: r.url })),
      },
      null,
      2,
    ),
  );
  logToolHint("web_search", native);
  if (realInfoSourceCount > 0) {
    const phase = n.searchPhase ?? "unknown";
    const scopedPhases = new Set(["infoSource-scoped", "infoSource-catalog"]);
    if (!scopedPhases.has(phase)) {
      console.log(`⚠ 已启用 ${realInfoSourceCount} 个真实信息源，但 web_search 阶段为 ${phase}（期望 scoped/catalog）`);
    } else {
      console.log(`✓ 信息源搜索阶段: ${phase}（${realInfoSourceCount} 个真实信息源）`);
    }
  } else if (enabledSources.total > 0) {
    console.log(`⚠ 数据库有 ${enabledSources.total} 条信息源，但均为 smoke 残留；可执行 pnpm cleanup:smoke-artifacts`);
  }

  console.log("\n=== read_article (文档站) ===");
  const t2 = Date.now();
  const article = await executeNativeTool(
    "read_article",
    { url: "https://api-docs.deepseek.com/", timeout: 25000, embedOcr: false },
    ctx,
  );
  const a = article as { title?: string; platform?: string; method?: string; contentChars?: number; elapsedMs?: number };
  console.log(
    JSON.stringify(
      {
        ms: Date.now() - t2,
        elapsedMs: a.elapsedMs,
        title: a.title,
        platform: a.platform,
        method: a.method,
        contentChars: a.contentChars,
      },
      null,
      2,
    ),
  );
  logToolHint("read_article", article);

  if (!runPlatform && !runPlatformQuick && !runPlatformMedium && !runPlatformExtended) {
    await optionalStep("read_article (GitHub README)", async () => {
    const githubUrl =
      process.env.GITHUB_SMOKE_URL?.trim() ||
      "https://raw.githubusercontent.com/deepseek-ai/DeepSeek-V3/main/README.md";
    console.log("\n=== read_article (GitHub) ===");
    const t = Date.now();
    const gh = await executeNativeTool(
      "read_article",
      {
        url: githubUrl,
        timeout: 35000,
        embedOcr: false,
        maxChars: 8000,
      },
      ctx,
    );
    const g = gh as { title?: string; platform?: string; method?: string; contentChars?: number; content?: string };
    console.log(
      JSON.stringify(
        {
          ms: Date.now() - t,
          title: g.title,
          platform: g.platform,
          method: g.method,
          contentChars: g.contentChars,
          preview: g.content?.slice(0, 120),
        },
        null,
        2,
      ),
    );
    if (!g.content || (g.contentChars ?? 0) < 100) {
      throw new Error("GitHub 正文过短");
    }
    });
  }

  if (runPlatform || runPlatformQuick || runPlatformMedium || runPlatformExtended) {
    const allPlatformCases: ReadArticleSmoke[] = [
      {
        label: "博客园",
        envVar: "CNBLOGS_SMOKE_URL",
        defaultUrl: "https://www.cnblogs.com/metaz/p/16798692.html",
        minChars: 200,
      },
      {
        label: "简书",
        envVar: "JIANSHU_SMOKE_URL",
        defaultUrl: "https://www.jianshu.com/p/5a35a61bad8f",
        minChars: 200,
        timeout: 60000,
      },
      {
        label: "GitHub",
        envVar: "GITHUB_SMOKE_URL",
        defaultUrl: "https://raw.githubusercontent.com/deepseek-ai/DeepSeek-V3/main/README.md",
        minChars: 80,
        timeout: 35000,
      },
      { label: "InfoQ", envVar: "INFOQ_SMOKE_URL", defaultUrl: "https://www.infoq.cn/article/d6oe4ghorgrfotcuxxhf", minChars: 200 },
      {
        label: "开源中国",
        envVar: "OSCHINA_SMOKE_URL",
        defaultUrl: "https://www.oschina.net/news/285000/boostkit-bigdata",
        minChars: 200,
      },
      { label: "B站", url: "https://www.bilibili.com/video/BV1GJ411x7h7", minChars: 150, timeout: 45000 },
      {
        label: "掘金",
        envVar: "JUEJIN_SMOKE_URL",
        defaultUrl: "https://juejin.cn/post/7588146449006379044",
        minChars: 200,
      },
      {
        label: "CSDN",
        envVar: "CSDN_SMOKE_URL",
        defaultUrl: "https://blog.csdn.net/weixin_44612221/article/details/148827532",
        minChars: 200,
      },
      {
        label: "SegmentFault",
        envVar: "SEGMENTFAULT_SMOKE_URL",
        defaultUrl: "https://segmentfault.com/a/1190000046145001",
        minChars: 200,
        timeout: 60000,
      },
      {
        label: "知乎",
        envVar: "ZHIHU_SMOKE_URL",
        defaultUrl: "https://zhuanlan.zhihu.com/p/348594600",
        requiresEnv: "ZHIHU_COOKIE",
        minChars: 200,
        timeout: 45000,
      },
      { label: "微信", envVar: "WECHAT_SMOKE_URL", requiresEnv: "WECHAT_COOKIE", minChars: 150 },
      { label: "小红书", envVar: "XHS_SMOKE_URL", requiresEnv: "XHS_COOKIE|XIAOHONGSHU_COOKIE", minChars: 100 },
      { label: "抖音", envVar: "DOUYIN_SMOKE_URL", requiresEnv: "DOUYIN_COOKIE", minChars: 80 },
    ];
    const quickLabels = new Set(["B站", "掘金", "CSDN"]);
    const mediumLabels = new Set(["B站", "掘金", "CSDN", "GitHub", "InfoQ", "开源中国", "SegmentFault"]);
    const extendedLabels = new Set([...mediumLabels, "博客园", "简书", "知乎", "微信", "小红书", "抖音"]);
    const platformCases = sortPlatformSmokeCases(
      runPlatformQuick
        ? allPlatformCases.filter((c) => quickLabels.has(c.label))
        : runPlatformExtended
          ? allPlatformCases.filter((c) => extendedLabels.has(c.label))
          : runPlatformMedium
            ? allPlatformCases.filter((c) => mediumLabels.has(c.label))
            : allPlatformCases,
    );

    let platformOk = 0;
    let platformSkipped = 0;
    let platformFailed = 0;
    let unreadable404Ok = false;
    const platformStarted = Date.now();
    const platformResults = await runPlatformSmokesParallel(platformCases, 3);
    const platformWallMs = Date.now() - platformStarted;
    for (const row of platformResults) {
      if (row.status === "passed") platformOk += 1;
      else if (row.status === "skipped") platformSkipped += 1;
      else platformFailed += 1;
    }
    console.log(`\n=== 平台 read_article 摘要${runPlatformQuick ? " (quick)" : runPlatformExtended ? " (extended)" : runPlatformMedium ? " (medium)" : ""} ===`);
    console.log(
      JSON.stringify(
        {
          passed: platformOk,
          failed: platformFailed,
          skipped: platformSkipped,
          total: platformCases.length,
          wallMs: platformWallMs,
          totalMs: platformResults.reduce((s, r) => s + r.ms, 0),
          results: platformResults,
        },
        null,
        2,
      ),
    );

    console.log("\n=== read_article (404 应抛错) ===");
    await closeBrowser().catch(() => undefined);
    try {
      await executeNativeTool(
        "read_article",
        {
          url: "https://www.cnblogs.com/skyszal/p/9805805.html",
          timeout: 15000,
          embedOcr: false,
          minChars: 150,
        },
        ctx,
      );
      console.log("⚠ 404 检测失败：read_article 未抛出错误");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/页面不可用|页面不存在或已删除/.test(msg)) {
        unreadable404Ok = true;
        console.log(JSON.stringify({ ok: true, message: msg.split("\n")[0] }, null, 2));
      } else {
        console.log(`⚠ 404 检测异常: ${msg.split("\n")[0]}`);
      }
    }

    if (!isCi && (platformFailed > 0 || !unreadable404Ok)) {
      process.exitCode = 1;
    }
  }

  console.log("\n=== scrape_web_page ===");
  const t3 = Date.now();
  const scraped = await executeNativeTool(
    "scrape_web_page",
    { url: "https://api-docs.deepseek.com/", timeout: 25000 },
    ctx,
  );
  const s = scraped as { title?: string; textTruncated?: boolean; text?: string; textChars?: number; elapsedMs?: number };
  console.log(
    JSON.stringify(
      {
        ms: Date.now() - t3,
        elapsedMs: s.elapsedMs,
        textChars: s.textChars,
        title: s.title,
        textTruncated: s.textTruncated,
        textPreview: s.text?.slice(0, 200),
      },
      null,
      2,
    ),
  );
  logToolHint("scrape_web_page", scraped);
  if ((s.textChars ?? 0) < 100) {
    console.log("⚠ scrape_web_page 正文过短 (<100 字)");
    if (!isCi) process.exitCode = 1;
  }

  const img = path.join(config.projectRoot, "content/uploads/00_abstract_mqxw9uuq.png");
  console.log("\n=== OCR ===", fs.existsSync(img) ? img : "(测试图不存在，跳过)");
  if (fs.existsSync(img)) {
    const t4 = Date.now();
    const ocr = await performOcrFromFile(config, img, "auto");
    console.log(
      JSON.stringify(
        {
          ms: Date.now() - t4,
          success: ocr.success,
          engine: ocr.engine,
          textLen: ocr.text.length,
          preview: ocr.text.slice(0, 160),
          error: ocr.error?.split("\n")[0],
        },
        null,
        2,
      ),
    );
    if (!ocr.success) {
      if (isCi) {
        console.log("\n⚠ CI 模式：OCR 未就绪，不阻断流水线");
      } else {
        process.exitCode = 1;
      }
    }
  }

  console.log("\n✅ 冒烟完成");
}

main()
  .catch((err) => {
    console.error("❌", err);
    process.exit(1);
  })
  .finally(() => {
    void closeBrowser().catch(() => undefined);
    void prisma.$disconnect().catch(() => undefined);
  });
