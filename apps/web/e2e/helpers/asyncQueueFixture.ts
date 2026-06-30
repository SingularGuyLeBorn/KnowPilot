/**
 * E2E 夹具：向 SQLite 写入真实 async_agent Task，走 pullAsyncQueue 全链路（不 mock HTTP）
 */

import { trpcMutate } from "./trpcE2e";

const ASYNC_KIND = "async_agent";

type ApiResult<T> = { success: boolean; data?: T; error?: { message?: string } };

const tasksBySession = new Map<string, string[]>();

export async function seedAsyncQueueTasks(
  sessionId: string,
  opts: {
    running?: Array<{ taskLabel: string }>;
    pendingDeliveries?: Array<{ taskLabel: string; asyncResult: string }>;
  },
) {
  const agentSnapshot = {
    id: "e2e-agent",
    model: "deepseek-v4-flash",
    systemPrompt: "E2E 测试",
    tools: [] as string[],
  };

  const ids: string[] = [];

  for (const item of opts.running ?? []) {
    const res = await trpcMutate<ApiResult<{ id: string }>>("task.create", {
      name: `[async] ${item.taskLabel}`,
      type: "oneshot",
      status: "running",
      input: {
        kind: ASYNC_KIND,
        sessionId,
        task: item.taskLabel,
        taskLabel: item.taskLabel,
        agentSnapshot,
        delivered: false,
      },
    });
    if (!res.success || !res.data) {
      throw new Error(res.error?.message ?? `task.create 失败: ${item.taskLabel}`);
    }
    ids.push(res.data.id);
  }

  for (const item of opts.pendingDeliveries ?? []) {
    const res = await trpcMutate<ApiResult<{ id: string }>>("task.create", {
      name: `[async] ${item.taskLabel}`,
      type: "oneshot",
      status: "success",
      input: {
        kind: ASYNC_KIND,
        sessionId,
        task: item.taskLabel,
        taskLabel: item.taskLabel,
        agentSnapshot,
        delivered: false,
      },
      output: { asyncResult: item.asyncResult },
    });
    if (!res.success || !res.data) {
      throw new Error(res.error?.message ?? `task.create 失败: ${item.taskLabel}`);
    }
    ids.push(res.data.id);
  }

  tasksBySession.set(sessionId, [...(tasksBySession.get(sessionId) ?? []), ...ids]);
}

/** 清理 E2E 写入的 async 任务（按 sessionId） */
export async function cleanupAsyncQueueTasks(sessionId: string) {
  const ids = tasksBySession.get(sessionId) ?? [];
  tasksBySession.delete(sessionId);
  for (const id of ids) {
    await trpcMutate<ApiResult<unknown>>("task.delete", { id }).catch(() => {});
  }
}
