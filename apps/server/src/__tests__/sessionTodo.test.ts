/**
 * 会话级 todo_write / todo_read
 * - 整表替换；至多一条 in_progress
 * - 需 sessionId；第二次 write 覆盖
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../db.js";
import { executeNativeTool } from "../infra/nativeTools.js";
import { createNativeCtx, createTempProjectDir } from "./helpers/toolTestFixtures.js";
import { normalizeTodoWriteInput } from "../infra/tools/native/session.js";

const RUN = `todo-${Date.now()}`;

describe("session todo_write / todo_read", () => {
  let sessionId: string;
  let projectRoot: string;
  const sessionIds: string[] = [];

  beforeAll(async () => {
    projectRoot = createTempProjectDir();
    const row = await prisma.chatSession.create({
      data: {
        title: `${RUN}-sess`,
        model: "deepseek-v4-flash",
      },
    });
    sessionId = row.id;
    sessionIds.push(row.id);
  });

  afterAll(async () => {
    for (const id of sessionIds) {
      await prisma.chatSession.delete({ where: { id } }).catch(() => undefined);
    }
    const fs = await import("fs");
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  function ctx(overrides?: { sessionId?: string | null }) {
    const base = createNativeCtx(projectRoot, { prisma });
    return {
      ...base,
      sessionId: overrides?.sessionId === null ? undefined : (overrides?.sessionId ?? sessionId),
      prisma,
    };
  }

  it("normalizeTodoWriteInput：双 in_progress 拒绝", () => {
    expect(() =>
      normalizeTodoWriteInput([
        { id: "a", content: "A", status: "in_progress" },
        { id: "b", content: "B", status: "in_progress" },
      ]),
    ).toThrow(/至多允许一条/);
  });

  it("无 sessionId 失败", async () => {
    await expect(
      executeNativeTool(
        "todo_write",
        { todos: [{ id: "1", content: "x", status: "pending" }] },
        ctx({ sessionId: null }),
      ),
    ).rejects.toThrow(/sessionId/);
  });

  it("write → read 一致；第二次 write 覆盖", async () => {
    const first = (await executeNativeTool(
      "todo_write",
      {
        todos: [
          { id: "1", content: "调研", status: "completed" },
          { id: "2", content: "实现", status: "in_progress" },
          { id: "3", content: "测试", status: "pending" },
        ],
      },
      ctx(),
    )) as { ok: boolean; total: number; summary: string; todos: Array<{ id: string }> };

    expect(first.ok).toBe(true);
    expect(first.total).toBe(3);
    expect(first.summary).toContain("3项");
    expect(first.summary).toContain("1进行中");

    const read1 = (await executeNativeTool("todo_read", {}, ctx())) as {
      total: number;
      todos: Array<{ id: string; content: string; status: string }>;
    };
    expect(read1.total).toBe(3);
    expect(read1.todos.map((t) => t.id)).toEqual(["1", "2", "3"]);
    expect(read1.todos[1]!.status).toBe("in_progress");

    const second = (await executeNativeTool(
      "todo_write",
      {
        todos: [{ id: "only", content: "只剩一项", status: "completed" }],
      },
      ctx(),
    )) as { total: number };

    expect(second.total).toBe(1);
    const read2 = (await executeNativeTool("todo_read", {}, ctx())) as {
      total: number;
      todos: Array<{ id: string }>;
    };
    expect(read2.total).toBe(1);
    expect(read2.todos[0]!.id).toBe("only");

    const row = await prisma.chatSession.findUnique({
      where: { id: sessionId },
      select: { todoState: true },
    });
    const state = row?.todoState as { todos?: unknown[] } | null;
    expect(Array.isArray(state?.todos)).toBe(true);
    expect(state!.todos).toHaveLength(1);
  });

  it("工具调用双 in_progress 拒绝且不改库", async () => {
    await executeNativeTool(
      "todo_write",
      { todos: [{ id: "keep", content: "保留", status: "pending" }] },
      ctx(),
    );
    await expect(
      executeNativeTool(
        "todo_write",
        {
          todos: [
            { id: "a", content: "A", status: "in_progress" },
            { id: "b", content: "B", status: "in_progress" },
          ],
        },
        ctx(),
      ),
    ).rejects.toThrow(/至多允许一条/);

    const read = (await executeNativeTool("todo_read", {}, ctx())) as {
      todos: Array<{ id: string }>;
    };
    expect(read.todos.map((t) => t.id)).toEqual(["keep"]);
  });
});
