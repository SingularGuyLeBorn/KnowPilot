/**
 * tRPC / ai.tools smoke 测试辅助 — 自动枚举 procedure 并构造最小调用参数
 */

import type { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { appRouter } from "../../router.js";

/** 格式合法的假 CUID（通过 zod .cuid()，但数据库中不存在） */
export const FAKE_CUID = "cl0123456789012345678901";

type AppRouter = typeof appRouter;

export interface AiToolDescriptor {
  name: string;
  description?: string;
}

export interface SmokeInvokeResult {
  tool: string;
  ok: boolean;
  kind: "success" | "failure" | "trpc_error" | "crash";
  message?: string;
  code?: string;
}

/** 跳过：LLM/副作用过大/需真实凭据/已在专项测试中覆盖 */
export const SMOKE_SKIP = new Set<string>([
  "ai.tools",
  "ai.invoke",
  "agent.run",
  "agent.chat",
  "agent.runWorkflow",
  "agent.ocrImage",
  "agent.pullAsyncQueue",
  "native.execute",
  "git.commit",
  "git.pull",
  "git.push",
  "task.run",
  "log.clearAll",
  "approval.execute",
  "approval.approveAndExecute",
  "auth.login",
]);

/** 精确参数覆盖（优先于启发式） */
const SMOKE_ARG_OVERRIDES: Record<string, unknown> = {
  "post.list": { page: 1, pageSize: 1 },
  "post.search": { query: "smoke", limit: 3 },
  "post.getBySlug": { slug: "__smoke_nonexistent_slug__" },
  "post.getById": { id: FAKE_CUID },
  "post.create": {
    title: `Smoke Post ${Date.now()}`,
    slug: `smoke-post-${Date.now()}`,
    content: "smoke test content",
    published: false,
  },
  "post.update": { id: FAKE_CUID, title: "Smoke Updated" },
  "post.delete": { id: FAKE_CUID },

  "agent.list": { page: 1, pageSize: 1 },
  "agent.getById": { id: FAKE_CUID },
  "agent.create": {
    name: `Smoke Agent ${Date.now()}`,
    model: "deepseek-chat",
    systemPrompt: "smoke",
    tools: [],
  },
  "agent.update": { id: FAKE_CUID, description: "smoke" },
  "agent.delete": { id: FAKE_CUID },
  "agent.toolSummary": { tools: ["native:read_file"] },

  "skill.list": { page: 1, pageSize: 1, enabled: true },
  "skill.getById": { id: FAKE_CUID },
  "skill.create": {
    name: `smoke_skill_${Date.now().toString(36)}`,
    description: "smoke",
    code: "export async function run(input: string) { return input; }",
    enabled: true,
  },
  "skill.update": { id: FAKE_CUID, description: "smoke" },
  "skill.delete": { id: FAKE_CUID },

  "mcp.list": { page: 1, pageSize: 1 },
  "mcp.getById": { id: FAKE_CUID },
  "mcp.create": {
    name: `smoke_mcp_${Date.now().toString(36)}`,
    command: "npx",
    args: ["-v"],
  },
  "mcp.update": { id: FAKE_CUID, description: "smoke" },
  "mcp.delete": { id: FAKE_CUID },

  "memory.list": { page: 1, pageSize: 1 },
  "memory.getById": { id: FAKE_CUID },
  "memory.create": { content: "smoke memory content", type: "episodic" },
  "memory.update": { id: FAKE_CUID, content: "smoke updated" },
  "memory.delete": { id: FAKE_CUID },

  "infoSource.list": { page: 1, pageSize: 1, enabled: true },
  "infoSource.getById": { id: FAKE_CUID },
  "infoSource.create": {
    name: `Smoke Source ${Date.now()}`,
    url: "https://example.com/docs",
    type: "general",
    enabled: true,
  },
  "infoSource.update": { id: FAKE_CUID, description: "smoke" },
  "infoSource.delete": { id: FAKE_CUID },

  "session.list": { page: 1, pageSize: 1 },
  "session.getById": { id: FAKE_CUID },
  "session.create": { title: `Smoke Session ${Date.now()}` },
  "session.update": { id: FAKE_CUID, title: "Smoke Updated" },
  "session.delete": { id: FAKE_CUID },

  "message.list": { page: 1, pageSize: 1, sessionId: FAKE_CUID },
  "message.getById": { id: FAKE_CUID },
  "message.create": { sessionId: FAKE_CUID, role: "user", content: "smoke" },
  "message.update": { id: FAKE_CUID, content: "smoke updated" },
  "message.delete": { id: FAKE_CUID },
  "message.switchVersion": { messageId: FAKE_CUID, versionIndex: 0 },

  "file.list": { page: 1, pageSize: 1 },
  "file.getById": { id: FAKE_CUID },
  "file.create": {
    name: `smoke-${Date.now()}.txt`,
    path: `/uploads/smoke-${Date.now()}.txt`,
    mimeType: "text/plain",
    size: 5,
    url: `/api/uploads/smoke-${Date.now()}.txt`,
  },
  "file.update": { id: FAKE_CUID, name: "smoke-renamed.txt" },
  "file.delete": { id: FAKE_CUID },
  "file.upload": {
    filename: `smoke-${Date.now()}.txt`,
    base64: Buffer.from("smoke upload").toString("base64"),
    mimeType: "text/plain",
  },

  "log.list": { page: 1, pageSize: 1 },
  "log.getById": { id: FAKE_CUID },
  "log.create": { level: "info", message: "smoke log", component: "smoke-test", event: "smoke" },

  "git.list": { page: 1, pageSize: 1 },
  "git.getById": { id: FAKE_CUID },
  "git.create": { name: `smoke-repo-${Date.now()}`, path: ".", branch: "main" },
  "git.update": { id: FAKE_CUID, branch: "main" },
  "git.delete": { id: FAKE_CUID },
  "git.status": { repoPath: "." },
  "git.log": { repoPath: ".", limit: 3 },
  "git.diff": { repoPath: "." },

  "search.web": { query: "KnowPilot smoke", maxResults: 2 },
  "search.global": { query: "smoke", limit: 5 },

  "analytics.dashboard": {},

  "task.list": { page: 1, pageSize: 1 },
  "task.getById": { id: FAKE_CUID },
  "task.create": { name: `smoke-task-${Date.now()}`, type: "oneshot" },
  "task.update": { id: FAKE_CUID, status: "pending" },
  "task.delete": { id: FAKE_CUID },

  "workspace.list": { page: 1, pageSize: 1 },
  "workspace.getById": { id: FAKE_CUID },
  "workspace.create": { name: `Smoke WS ${Date.now()}`, path: `/tmp/smoke-${Date.now()}` },
  "workspace.update": { id: FAKE_CUID, description: "smoke" },
  "workspace.delete": { id: FAKE_CUID },

  "trigger.list": { page: 1, pageSize: 1 },
  "trigger.getById": { id: FAKE_CUID },
  "trigger.create": {
    name: `smoke-trigger-${Date.now()}`,
    type: "cron",
    source: "0 0 * * *",
    actionType: "run_task",
    actionId: FAKE_CUID,
    enabled: false,
  },
  "trigger.update": { id: FAKE_CUID, enabled: false },
  "trigger.delete": { id: FAKE_CUID },

  "approval.list": { page: 1, pageSize: 1 },
  "approval.getById": { id: FAKE_CUID },
  "approval.create": { toolName: "smoke.test", args: { ping: true }, status: "pending" },
  "approval.update": { id: FAKE_CUID, status: "rejected" },
  "approval.delete": { id: FAKE_CUID },

  "tool.list": { page: 1, pageSize: 1 },
  "tool.getById": { id: FAKE_CUID },
  "tool.create": {
    name: `smoke_tool_${Date.now().toString(36)}`,
    type: "native",
    description: "smoke",
    enabled: true,
  },
  "tool.update": { id: FAKE_CUID, description: "smoke updated" },
  "tool.delete": { id: FAKE_CUID },

  "run.list": { page: 1, pageSize: 1 },
  "run.getById": { id: FAKE_CUID },
  "run.create": { status: "pending", input: { smoke: true } },
  "run.update": { id: FAKE_CUID, status: "failed" },
  "run.delete": { id: FAKE_CUID },

  "prompt.list": { page: 1, pageSize: 1 },
  "prompt.getById": { id: FAKE_CUID },
  "prompt.create": {
    name: `smoke-prompt-${Date.now()}`,
    version: "1.0.0",
    content: "smoke {{input}}",
    variables: ["input"],
    tags: ["smoke"],
  },
  "prompt.update": { id: FAKE_CUID, description: "smoke" },
  "prompt.delete": { id: FAKE_CUID },

  "credential.list": { page: 1, pageSize: 1 },
  "credential.getById": { id: FAKE_CUID },
  "credential.create": {
    name: `smoke-cred-${Date.now()}`,
    type: "api_key",
    value: "smoke-secret",
    scope: ["smoke"],
  },
  "credential.update": { id: FAKE_CUID, value: "smoke-secret-2" },
  "credential.delete": { id: FAKE_CUID },

  "native.list": {},
  "native.capabilities": {},

  "native.read_file": { path: "README.md" },
  "native.list_directory": { path: "." },
  "native.web_search": { query: "KnowPilot", maxResults: 2 },
  "native.invoke_api": { tool: "post.list", args: { page: 1, pageSize: 1 } },
  "native.wait": { ms: 1 },
  "native.git_status": { repoPath: "." },
  "native.git_log": { repoPath: ".", limit: 2 },
  "native.git_diff": { repoPath: "." },
  "native.write_file": { path: `content/uploads/smoke-${Date.now()}.txt`, content: "smoke" },
  "native.run_shell": { command: "echo smoke" },
  "native.async_task_run": { task: "smoke noop", label: "smoke" },
  "native.yuque_get_doc": { namespace: "user/repo", slug: "doc" },
  "native.github_search_repos": { query: "knowpilot", limit: 2 },
  "native.feishu_send_text": { receiveId: "smoke", text: "smoke" },
};

export function listAiTools(tools: AiToolDescriptor[]): AiToolDescriptor[] {
  return tools.filter((t) => !SMOKE_SKIP.has(t.name));
}

export function getProcedureValidator(
  procedures: AppRouter["_def"]["procedures"],
  path: string,
): z.ZodTypeAny | undefined {
  const proc = procedures[path as keyof typeof procedures] as { _def?: { inputs?: z.ZodTypeAny[] } } | undefined;
  return proc?._def?.inputs?.[0];
}

export function buildSmokeArgs(path: string, validator?: z.ZodTypeAny): unknown {
  if (path in SMOKE_ARG_OVERRIDES) return SMOKE_ARG_OVERRIDES[path];
  if (!validator) return {};

  const candidates: unknown[] = [
    {},
    { page: 1, pageSize: 1 },
    { id: FAKE_CUID },
    { query: "smoke", limit: 3 },
    { query: "smoke" },
    { slug: "__smoke__" },
    { tools: [] },
    { repoPath: "." },
    { path: "." },
  ];

  for (const candidate of candidates) {
    const parsed = validator.safeParse(candidate);
    if (parsed.success) return parsed.data;
  }

  return {};
}

export function isSmokeOutcomeOk(result: SmokeInvokeResult): boolean {
  return result.kind !== "crash";
}

export async function smokeInvokeTool(
  caller: {
    ai: {
      invoke: (input: { tool: string; args?: unknown }) => Promise<{
        success?: boolean;
        message?: string;
        code?: string;
      }>;
    };
  },
  tool: string,
  args: unknown,
): Promise<SmokeInvokeResult> {
  try {
    const result = await caller.ai.invoke({ tool, args });
    if (result && typeof result === "object" && "success" in result) {
      if (result.success === false) {
        return {
          tool,
          ok: true,
          kind: "failure",
          message: result.message,
          code: typeof result.code === "string" ? result.code : undefined,
        };
      }
      return { tool, ok: true, kind: "success" };
    }
    return { tool, ok: true, kind: "success" };
  } catch (error) {
    if (error instanceof TRPCError) {
      return { tool, ok: true, kind: "trpc_error", message: error.message, code: error.code };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { tool, ok: false, kind: "crash", message };
  }
}
