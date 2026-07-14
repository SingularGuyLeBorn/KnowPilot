/**
 * W6：D 类工具幂等 rollback 单测
 *
 * 覆盖：
 * 1. write_file 执行后 run failed → 写回执行前快照（内容还原），failed Run 落 output.rollback
 * 2. run failed 时多个 D 类工具逆序回滚（write_file 快照还原 + file_delete 回收站移回）
 * 3. git_commit 标记 destructive 但无补偿实现 → 只记 warn「需人工 revert」，不假装回滚
 * 4. 快照容量超上限 → 标记不可回滚并 warn
 * 5. post_create / memory_create 回滚 = 走 Service 删除该 id（文件回写同步）
 * 6. 用户 abort → 不触发回滚
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { runReactLoop } from "../infra/loop/reactLoop.js";
import type { ReactLoopInput, LlmTransport } from "../infra/loop/types.js";
import type { LlmToolCall } from "../infra/llmClient.js";
import type { ServiceContainer } from "../infra/serviceContainer.js";
import { RunRollbackStack, ROLLBACK_SNAPSHOT_CAP_CHARS } from "../infra/tools/rollback.js";
import { getTool } from "../infra/tools/registry.js";
import { listNativeTools } from "../infra/nativeTools.js";
import { createContextInner } from "../trpc/context.js";
import { createTempProjectDir, createTestConfig } from "./helpers/toolTestFixtures.js";

function tc(id: string, name: string, args: Record<string, unknown>): LlmToolCall {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

/** 脚本化 transport：按序返回 toolCalls / 抛错 */
function scriptedTransport(
  steps: Array<{ toolCalls?: LlmToolCall[]; content?: string; throwError?: string }>,
): LlmTransport {
  let i = 0;
  return {
    async complete() {
      const step = steps[Math.min(i++, steps.length - 1)];
      if (step.throwError) throw new Error(step.throwError);
      return {
        content: step.content ?? "",
        toolCalls: step.toolCalls ?? [],
        model: "test-model",
        provider: "test",
      };
    },
  };
}

function stubServices() {
  const runCreate = vi.fn(async (_input: Record<string, unknown>) => ({
    success: true,
    data: { id: "run-stub" },
  }));
  const services = { run: { create: runCreate } } as unknown as ServiceContainer;
  return { services, runCreate };
}

function loopInput(
  root: string,
  services: ServiceContainer,
  transport: LlmTransport,
  tools: string[],
): ReactLoopInput {
  return {
    config: createTestConfig(root),
    services,
    agent: { model: "test-model", systemPrompt: "", tools },
    messages: [{ role: "user", content: "go" }],
    invokeTrpc: async () => ({}),
    transport,
    runOrigin: "user",
  };
}

describe("W6 D 类工具 rollback", () => {
  let root: string;

  beforeEach(() => {
    root = createTempProjectDir();
    // 确保 native 工具已注册（其他测试文件可能清空过 registry）
    listNativeTools();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("write_file 后 run failed → 内容还原为执行前快照，failed Run 落 output.rollback", async () => {
    fs.writeFileSync(path.join(root, "target.txt"), "old content", "utf8");
    const { services, runCreate } = stubServices();
    const transport = scriptedTransport([
      { toolCalls: [tc("c1", "write_file", { path: "target.txt", content: "corrupted" })] },
      { throwError: "LLM boom" },
    ]);

    let caught: unknown;
    try {
      await runReactLoop(loopInput(root, services, transport, ["native:write_file"]));
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("LLM boom");
    // 内容已还原
    expect(fs.readFileSync(path.join(root, "target.txt"), "utf8")).toBe("old content");
    // 回滚报告挂在错误对象上
    const report = (caught as Error & { rollbackReport?: { rolledBack: number; entries: Array<{ toolName: string; status: string }> } }).rollbackReport;
    expect(report).toBeDefined();
    expect(report!.rolledBack).toBe(1);
    expect(report!.entries[0]).toMatchObject({ toolName: "write_file", status: "rolled_back" });
    // failed Run 终态写入 output.rollback
    expect(runCreate).toHaveBeenCalledTimes(1);
    const runArg = runCreate.mock.calls[0][0] as unknown as {
      status: string;
      output: { error: string; rollback: { rolledBack: number } };
    };
    expect(runArg.status).toBe("failed");
    expect(runArg.output.error).toContain("LLM boom");
    expect(runArg.output.rollback.rolledBack).toBe(1);
  });

  it("write_file 新建文件后 run failed → 回滚为删除该新建文件", async () => {
    const { services } = stubServices();
    const transport = scriptedTransport([
      { toolCalls: [tc("c1", "write_file", { path: "new.txt", content: "brand new" })] },
      { throwError: "LLM boom" },
    ]);

    await expect(
      runReactLoop(loopInput(root, services, transport, ["native:write_file"])),
    ).rejects.toThrow("LLM boom");
    expect(fs.existsSync(path.join(root, "new.txt"))).toBe(false);
  });

  it("run failed 时多个 D 类工具逆序回滚（write_file 快照 + file_delete 回收站移回）", async () => {
    fs.writeFileSync(path.join(root, "a.txt"), "A", "utf8");
    fs.writeFileSync(path.join(root, "b.txt"), "B", "utf8");
    const { services } = stubServices();
    const transport = scriptedTransport([
      {
        toolCalls: [
          tc("c1", "write_file", { path: "a.txt", content: "A2" }),
          tc("c2", "file_delete", { path: "b.txt" }),
        ],
      },
      { throwError: "LLM boom" },
    ]);

    let caught: unknown;
    try {
      await runReactLoop(loopInput(root, services, transport, ["native:write_file", "native:file_delete"]));
    } catch (err) {
      caught = err;
    }

    // 执行后立即状态：a 被改写、b 被移入回收站 → 回滚后双双恢复
    expect(fs.readFileSync(path.join(root, "a.txt"), "utf8")).toBe("A");
    expect(fs.existsSync(path.join(root, "b.txt"))).toBe(true);
    expect(fs.readFileSync(path.join(root, "b.txt"), "utf8")).toBe("B");

    const report = (caught as Error & { rollbackReport?: { entries: Array<{ toolName: string; status: string }> } }).rollbackReport;
    // 逆序：先回滚 file_delete，再回滚 write_file
    expect(report!.entries.map((e) => e.toolName)).toEqual(["file_delete", "write_file"]);
    expect(report!.entries.every((e) => e.status === "rolled_back")).toBe(true);
  });

  it("git_commit 标记 destructive 但不可回滚 → 只记 warn「需人工 revert」", async () => {
    const cmd = getTool("git_commit");
    expect(cmd?.destructive).toBe(true);
    expect(cmd?.rollback).toBeUndefined();

    // 直接驱动回滚栈：模拟 git_commit 已执行成功入栈，run failed 后只 warn 不补偿
    const stack = new RunRollbackStack();
    const artifact = await stack.capture(cmd!, { message: "x" }, {});
    stack.commit(cmd!, { message: "x" }, { path: "/repo", output: "committed" }, artifact);
    const report = await stack.rollbackAll({});

    expect(report).not.toBeNull();
    expect(report!.rolledBack).toBe(0);
    expect(report!.warned).toBe(1);
    expect(report!.entries[0]).toMatchObject({ toolName: "git_commit", status: "warn" });
    expect(report!.entries[0].message).toContain("人工 revert");
    // 幂等：二次调用返回同一份报告
    expect(await stack.rollbackAll({})).toBe(report);
  });

  it("快照总量超容量上限 → 标记不可回滚并 warn", async () => {
    const stack = new RunRollbackStack({ snapshotCapChars: 16 });
    const cmd = getTool("write_file");
    expect(cmd?.captureRollback).toBeDefined();

    fs.writeFileSync(path.join(root, "big.txt"), "x".repeat(64), "utf8");
    const ctx = { config: createTestConfig(root) };
    const artifact = await stack.capture(cmd!, { path: "big.txt" }, ctx);
    expect(artifact.unrecoverable).toBeTruthy();
    expect(artifact.captured).toBeUndefined();

    stack.commit(cmd!, { path: "big.txt" }, { path: "big.txt", bytes: 64 }, artifact);
    const report = await stack.rollbackAll(ctx);
    expect(report!.entries[0].status).toBe("warn");
    expect(report!.entries[0].message).toContain("上限");
    // 默认上限为 10MB
    expect(ROLLBACK_SNAPSHOT_CAP_CHARS).toBe(10 * 1024 * 1024);
  });

  it("post_create / memory_create 回滚 = 走 Service 删除该 id（文件同步移除）", async () => {
    const ctx = await createContextInner();
    const services = ctx.services as ServiceContainer;
    const title = `rollback-test-${Date.now()}`;
    const transport = scriptedTransport([
      {
        toolCalls: [
          tc("c1", "post_create", { title, content: "正文" }),
          tc("c2", "memory_create", { content: `rollback-mem-${Date.now()}`, type: "note" }),
        ],
      },
      { throwError: "LLM boom" },
    ]);

    await expect(
      runReactLoop(loopInput(root, services, transport, ["native:post_create", "native:memory_create"])),
    ).rejects.toThrow("LLM boom");

    // 两个实体都已被 Service 删除（getById 抛 NOT_FOUND）
    const posts = await services.post.list({ page: 1, pageSize: 50, keyword: title } as Parameters<typeof services.post.list>[0]);
    expect(posts.items.some((p: { title: string }) => p.title === title)).toBe(false);
    const mems = await services.memory.list({ page: 1, pageSize: 50, keyword: "rollback-mem-" } as Parameters<typeof services.memory.list>[0]);
    expect(mems.items).toHaveLength(0);

    // content 目录无残留文件（Service afterDelete 已删文件）
    const postsDir = path.join(ctx.config.contentPaths.posts);
    expect(fs.readdirSync(postsDir).some((f) => f.includes("rollback-test-"))).toBe(false);
  });

  it("用户 abort → run failed 但不触发回滚", async () => {
    fs.writeFileSync(path.join(root, "keep.txt"), "old", "utf8");
    const { services, runCreate } = stubServices();
    const controller = new AbortController();
    // 第一轮执行 write_file；第二轮 complete 前 abort 并抛 AbortError
    let calls = 0;
    const transport: LlmTransport = {
      async complete() {
        calls++;
        if (calls === 1) {
          return {
            content: "",
            toolCalls: [tc("c1", "write_file", { path: "keep.txt", content: "modified" })],
            model: "test-model",
            provider: "test",
          };
        }
        controller.abort();
        const err = new Error("流式输出已被用户中断");
        err.name = "AbortError";
        throw err;
      },
    };

    const input = loopInput(root, services, transport, ["native:write_file"]);
    input.signal = controller.signal;
    await expect(runReactLoop(input)).rejects.toThrow("用户中断");
    // abort 不回滚：文件保持已修改状态，也不写 failed Run
    expect(fs.readFileSync(path.join(root, "keep.txt"), "utf8")).toBe("modified");
    expect(runCreate).not.toHaveBeenCalled();
  });
});
