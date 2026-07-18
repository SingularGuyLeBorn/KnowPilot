/**
 * 一次性联调：飞书 / 语雀 / GitHub 只读探测（不发消息、不写文档）。
 * 用法：pnpm --filter @knowpilot/server exec tsx src/scripts/smoke-integrations.ts
 */
import { prisma } from "../db.js";
import { getAppConfig } from "../infra/config.js";
import { getTenantAccessToken, getUserAccessTokenStatus, feishuSearchDocs } from "../infra/feishuClient.js";
import { getYuqueCredentials, yuqueListBooks, yuqueListRepos } from "../infra/yuqueClient.js";
import { getGitHubToken, githubSearchRepos } from "../infra/githubClient.js";

type Row = { name: string; ok: boolean; detail: string };

async function checkFeishu(): Promise<Row> {
  const config = getAppConfig();
  try {
    const tenant = await getTenantAccessToken(config);
    if (!tenant) {
      return { name: "feishu", ok: false, detail: "无法取得 tenant_access_token" };
    }
    const status = await getUserAccessTokenStatus(prisma, config);
    const hasEnvUser = Boolean(config.integrations.feishu.userAccessToken?.trim());
    // 真实打一枪搜索（空结果也算通）
    let searchNote = "search=skipped";
    try {
      const hits = await feishuSearchDocs("test", prisma, config);
      const n = Array.isArray(hits) ? hits.length : "?";
      searchNote = `search_docs n=${n}`;
    } catch (e) {
      searchNote = `search_docs err=${e instanceof Error ? e.message.slice(0, 120) : String(e)}`;
    }
    // tenant 可换 = 应用凭证通；文档类另看 searchNote
    const docsOk = !searchNote.includes(" err=");
    return {
      name: "feishu",
      ok: true,
      detail: `tenant=ok envUser=${hasEnvUser} credUserExists=${status.exists} valid=${status.valid} docsOk=${docsOk} ${searchNote}`,
    };
  } catch (e) {
    return {
      name: "feishu",
      ok: false,
      detail: e instanceof Error ? e.message.slice(0, 240) : String(e),
    };
  }
}

async function checkYuque(): Promise<Row> {
  const config = getAppConfig();
  try {
    const creds = await getYuqueCredentials(prisma, config);
    // Web API（cookie）：list books
    let booksNote = "";
    try {
      const books = await yuqueListBooks(creds);
      const n = Array.isArray(books) ? books.length : (books as { data?: unknown[] })?.data?.length ?? "?";
      booksNote = `list_books n=${n}`;
    } catch (e) {
      booksNote = `list_books err=${e instanceof Error ? e.message.slice(0, 100) : String(e)}`;
    }
    // Open API v2（ctoken 当 token）：list repos
    let reposNote = "";
    try {
      const repos = await yuqueListRepos(creds.ctoken);
      const n = Array.isArray(repos)
        ? repos.length
        : (repos as { data?: unknown[] })?.data?.length ?? "?";
      reposNote = `list_repos n=${n}`;
    } catch (e) {
      reposNote = `list_repos err=${e instanceof Error ? e.message.slice(0, 100) : String(e)}`;
    }
    const ok = !booksNote.includes(" err=") || !reposNote.includes(" err=");
    return {
      name: "yuque",
      ok,
      detail: `session=ok ctoken=ok ${booksNote}; ${reposNote}`,
    };
  } catch (e) {
    return {
      name: "yuque",
      ok: false,
      detail: e instanceof Error ? e.message.slice(0, 240) : String(e),
    };
  }
}

async function checkGitHub(): Promise<Row> {
  const config = getAppConfig();
  const token = getGitHubToken(config);
  if (!token) {
    return { name: "github", ok: false, detail: "未配置 GITHUB_TOKEN / VITE_GITHUB_TOKEN" };
  }
  try {
    const res = (await githubSearchRepos("language:typescript", 1, token)) as {
      total_count?: number;
      items?: unknown[];
      message?: string;
    };
    if (res.message && !res.total_count && !res.items) {
      return { name: "github", ok: false, detail: res.message.slice(0, 200) };
    }
    return {
      name: "github",
      ok: true,
      detail: `token=ok search total_count=${res.total_count ?? "?"} items=${res.items?.length ?? 0}`,
    };
  } catch (e) {
    return {
      name: "github",
      ok: false,
      detail: e instanceof Error ? e.message.slice(0, 240) : String(e),
    };
  }
}

async function main() {
  const rows = [await checkFeishu(), await checkYuque(), await checkGitHub()];
  for (const r of rows) {
    console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}: ${r.detail}`);
  }
  await prisma.$disconnect();
  process.exit(rows.some((r) => !r.ok) ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
