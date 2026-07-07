/**
 * 真实第三方 API 工具连通性测试
 * 读取 .env 中的搜索 / 语雀 / 飞书 / GitHub 配置，直接调用原生工具。
 */
import { getAppConfig } from "../infra/config.js";
import { executeNativeTool, type NativeToolContext } from "../infra/nativeTools.js";

const config = getAppConfig();

const ctx: NativeToolContext = {
  config,
  services: {} as any,
  invokeTrpc: async () => ({}),
};

async function run(label: string, name: string, args: Record<string, unknown>) {
  console.log(`\n--- ${label} ---`);
  try {
    const result = await executeNativeTool(name, args, ctx);
    console.log("OK:", JSON.stringify(result, null, 2).slice(0, 2000));
  } catch (err) {
    console.log("ERR:", err instanceof Error ? err.message : String(err));
  }
}

async function main() {
  console.log("配置快照（已脱敏）:");
  console.log("  web_search 引擎优先级:", config.search.enginePriority);
  console.log("  tavily:", config.search.tavilyApiKey ? "已配置" : "未配置");
  console.log("  serpapi:", config.search.serpApiKey ? "已配置" : "未配置");
  console.log("  yuque session:", config.integrations.yuque.session ? "已配置" : "未配置");
  console.log("  github token:", config.integrations.github.token ? "已配置" : "未配置");
  console.log("  feishu tenant token:", config.integrations.feishu.tenantAccessToken ? "已配置" : "未配置");

  await run("web_search (Tavily/SerpAPI 智能搜索)", "web_search", { query: "KnowPilot", maxResults: 3 });
  await run("github_search_repos", "github_search_repos", { query: "KnowPilot", limit: 3 });
  await run("yuque_get_doc（使用占位文档路径测试连通性）", "yuque_get_doc", {
    namespace: "KnowPilot/test",
    slug: "intro",
  });
  await run("feishu_send_text（使用占位 receiveId 测试 token 连通性）", "feishu_send_text", {
    receiveId: "ou_test_user_123456",
    receiveIdType: "open_id",
    text: "来自 KnowPilot 工具测试的消息",
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
