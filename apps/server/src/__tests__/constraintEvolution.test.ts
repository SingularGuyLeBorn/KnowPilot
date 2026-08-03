import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  recordViolation,
  getConstraintEvolutionBlock,
  injectConstraintBlock,
  readConstraintFileRaw,
} from "../infra/constraintEvolution.js";
import {
  __resetContextHooksForTests,
  ensureBuiltinContextHooks,
  runContextHooks,
  type ContextHookInput,
} from "../infra/contextHooks.js";
import type { AppConfig } from "../infra/config.js";
import type { Agent } from "@knowpilot/shared";

function createTempConfig(): AppConfig {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kp-constraint-"));
  const config = {
    projectRoot: tmp,
    configDir: path.join(tmp, "config"),
    configPaths: {
      agents: path.join(tmp, "config", "agents"),
      skills: path.join(tmp, "config", "skills"),
      mcp: path.join(tmp, "config", "mcp"),
      memories: path.join(tmp, "config", "memories"),
      tasks: path.join(tmp, "config", "tasks"),
      prompts: path.join(tmp, "config", "prompts"),
      sources: path.join(tmp, "config", "sources"),
    },
  } as unknown as AppConfig;
  fs.mkdirSync(config.configPaths.memories, { recursive: true });
  return config;
}

function buildAgent(id: string): Agent {
  return {
    id,
    name: "TestAgent",
    tier: "sub",
    tools: [],
    systemPrompt: "",
  } as unknown as Agent;
}

describe("constraintEvolution", () => {
  let config: AppConfig;
  let cleanup: () => void;

  beforeEach(() => {
    config = createTempConfig();
    cleanup = () => {
      try {
        fs.rmSync(config.projectRoot, { recursive: true, force: true });
      } catch {
        // ignore
      }
    };
  });

  afterEach(() => {
    cleanup();
  });

  it("同一 Agent 7 天内同类错误达到 3 次后升级为红线", () => {
    const agentId = "agent-a";
    for (let i = 0; i < 2; i++) {
      recordViolation(agentId, "MD_PSEUDO_MATH_UNICODE", { filePath: "x.md" }, config);
    }
    let raw = readConstraintFileRaw(agentId, config);
    expect(raw).toBeTruthy();
    expect(raw!.data.violations.length).toBe(2);
    expect(raw!.data.promoted.length).toBe(0);

    recordViolation(agentId, "MD_PSEUDO_MATH_UNICODE", { filePath: "y.md" }, config);
    raw = readConstraintFileRaw(agentId, config);
    expect(raw!.data.violations.length).toBe(3);
    expect(raw!.data.promoted.length).toBe(1);
    expect(raw!.data.promoted[0]!.code).toBe("MD_PSEUDO_MATH_UNICODE");
    expect(raw!.data.promoted[0]!.rule).toContain("数学公式禁止用 Unicode 伪符号");
    expect(raw!.body).toContain("已升级为红线的错误");
  });

  it("不同错误码独立计数", () => {
    const agentId = "agent-b";
    recordViolation(agentId, "MD_PSEUDO_MATH_UNICODE", {}, config);
    recordViolation(agentId, "MD_PSEUDO_MATH_UNICODE", {}, config);
    recordViolation(agentId, "TS_SYNTAX_ERROR", {}, config);
    const raw = readConstraintFileRaw(agentId, config);
    expect(raw!.data.promoted.length).toBe(0);
  });

  it("无 AgentId 时静默返回", () => {
    expect(() =>
      recordViolation(undefined, "MD_PSEUDO_MATH_UNICODE", {}, config),
    ).not.toThrow();
  });

  it("getConstraintEvolutionBlock 只在有红线时返回内容", () => {
    const agentId = "agent-c";
    expect(getConstraintEvolutionBlock(agentId, config)).toBeNull();
    for (let i = 0; i < 3; i++) {
      recordViolation(agentId, "MD_FRONTMATTER_MISSING_TITLE", {}, config);
    }
    const block = getConstraintEvolutionBlock(agentId, config);
    expect(block).toContain("错误记录");
    expect(block).toContain("MD_FRONTMATTER_MISSING_TITLE");
  });

  it("injectConstraintBlock 可替换已存在的错误记录小节", () => {
    const original = `# 你是 Agent\n\n## 错误记录\n\n<!-- old -->\n\n## 你的职责\n- do something`;
    const block = `## 错误记录（运行时沉淀的教训）\n\n- [2026-08-03] **X**：禁止做某事。\n`;
    const injected = injectConstraintBlock(original, block);
    expect(injected).toContain("禁止做某事");
    expect(injected).not.toContain("<!-- old -->");
    expect(injected).toContain("## 你的职责");
  });

  it("injectConstraintBlock 无错误记录小节时追加", () => {
    const original = "# 你是 Agent\n\n## 你的职责\n- do something";
    const block = `## 错误记录（运行时沉淀的教训）\n\n- [2026-08-03] **X**：禁止做某事。\n`;
    const injected = injectConstraintBlock(original, block);
    expect(injected).toContain("## 错误记录");
    expect(injected).toContain("禁止做某事");
  });

  it("contextHooks 将红线注入 system prompt", async () => {
    const agentId = "agent-d";
    for (let i = 0; i < 3; i++) {
      recordViolation(agentId, "TS_SYNTAX_ERROR", { message: "syntax error" }, config);
    }

    __resetContextHooksForTests();
    ensureBuiltinContextHooks();

    const basePrompt = `# 你是 Agent\n\n## 错误记录（运行时沉淀的教训）\n\n<!-- 初始为空 -->\n\n## 你的职责\n- do something`;
    const input: ContextHookInput = {
      agent: buildAgent(agentId),
      sessionId: "s1",
      runId: "r1",
      round: 1,
      messages: [],
      systemPrompt: basePrompt,
      ctx: { config } as ContextHookInput["ctx"],
      scratch: {},
    };
    const result = await runContextHooks(input);
    expect(result.systemPrompt).toContain("TS_SYNTAX_ERROR");
    expect(result.systemPrompt).toContain("TypeScript/TSX 代码必须通过语法检查");
    expect(result.systemPrompt).not.toContain("<!-- 初始为空 -->");
  });
});
