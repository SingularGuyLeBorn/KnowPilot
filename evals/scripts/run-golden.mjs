/**
 * P1-03：用 mock-llm-core 跑 evals/golden/*.json（CI 零真实 LLM）。
 *
 * 用法：node evals/scripts/run-golden.mjs
 * 或：pnpm test:evals
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mockChatCompletion } from "../../packages/mock-llm-core/src/index.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const goldenDir = path.resolve(__dirname, "../golden");

/** @typedef {{ id: string, title: string, userMessage: string, expectToolsAnyOf?: string[], forbidTools?: string[], scenario?: string }} GoldenCase */

function loadCases() {
  if (!fs.existsSync(goldenDir)) {
    console.error(`缺少目录 ${goldenDir}`);
    process.exit(1);
  }
  /** @type {GoldenCase[]} */
  const cases = [];
  for (const name of fs.readdirSync(goldenDir).sort()) {
    if (!name.endsWith(".json")) continue;
    const raw = JSON.parse(fs.readFileSync(path.join(goldenDir, name), "utf8"));
    cases.push(raw);
  }
  return cases;
}

function toolNamesFromResult(result) {
  return (result.toolCalls ?? []).map((c) => c.function.name);
}

async function runCase(c) {
  const tools = [
    ...(c.expectToolsAnyOf ?? []),
    ...(c.forbidTools ?? []),
    "web_search",
    "read_file",
  ].map((name) => ({
    type: "function",
    function: { name, description: name, parameters: { type: "object", properties: {} } },
  }));
  // 去重
  const seen = new Set();
  const uniqTools = tools.filter((t) => {
    if (seen.has(t.function.name)) return false;
    seen.add(t.function.name);
    return true;
  });

  const result = await mockChatCompletion({
    model: "mock-eval",
    messages: [{ role: "user", content: c.userMessage }],
    tools: uniqTools,
    scenario: c.scenario ?? (c.id === "G01" ? "eval_G01_post_list" : undefined),
  });
  const used = toolNamesFromResult(result);
  const errors = [];

  if (c.expectToolsAnyOf?.length) {
    const hit = c.expectToolsAnyOf.some((t) => used.includes(t));
    if (!hit) {
      errors.push(`期望工具任一 ${JSON.stringify(c.expectToolsAnyOf)}，实际 ${JSON.stringify(used)}`);
    }
  }
  if (c.forbidTools?.length) {
    const bad = c.forbidTools.filter((t) => used.includes(t));
    if (bad.length) {
      errors.push(`禁用工具被调用: ${JSON.stringify(bad)}`);
    }
  }
  return { id: c.id, title: c.title, used, errors };
}

async function main() {
  const cases = loadCases();
  if (cases.length === 0) {
    console.error("golden 目录无用例");
    process.exit(1);
  }
  let failed = 0;
  for (const c of cases) {
    const r = await runCase(c);
    if (r.errors.length) {
      failed++;
      console.error(`FAIL ${r.id} ${r.title}`);
      for (const e of r.errors) console.error(`  - ${e}`);
    } else {
      console.log(`PASS ${r.id} ${r.title} tools=${JSON.stringify(r.used)}`);
    }
  }
  console.log(`\n${cases.length - failed}/${cases.length} passed`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
