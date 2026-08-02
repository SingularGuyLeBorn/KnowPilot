/**
 * Chat 发送队列 drain 生命周期测试。
 *
 * 覆盖场景：
 * - S1：空闲直发 M1，M1 run 期间入队 M2，M1 结束后应自动 drain 发 M2。
 * - S2：run settled 后队空，不额外发送。
 * - S3：done 后 drain 撞上 queueDraining 锁未释放时，必须有可靠二次触发。
 *
 * 使用真实 store + createRoot/act（项目约定，不引入 RTL），mock tRPC。
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";

const mockMutation = (impl?: (input: unknown) => Promise<unknown>) => ({
  mutateAsync: vi.fn(async (input: unknown) => (impl ? impl(input) : { data: { id: `db-${Math.random().toString(36).slice(2)}` } })),
  mutate: vi.fn(),
  isPending: false,
  isError: false,
  error: null,
  status: "idle",
  data: undefined,
  isSuccess: false,
  reset: vi.fn(),
  variables: undefined,
  failureReason: null,
  isIdle: true,
  submittedAt: 0,
});

vi.mock("@/lib/trpc", () => ({
  trpc: {
    agent: {
      consumeSessionQueueItem: { useMutation: () => mockMutation(() => Promise.resolve({ claimed: true })) },
      finalizeSessionQueueItem: { useMutation: () => mockMutation(() => Promise.resolve({ success: true })) },
      unclaimSessionQueueItem: { useMutation: () => mockMutation(() => Promise.resolve({ success: true })) },
      createSessionQueueItem: { useMutation: () => mockMutation() },
    },
    useUtils: () => ({
      agent: { listSessionQueueItems: { setData: vi.fn() } },
    }),
  },
  catchUnlessCancelled: () => () => {},
}));

import { useChatQueueDrain, type UseChatQueueDrainParams } from "../useChatQueueDrain";
import type { RunStreamOptions, RunStreamOutcome } from "../useChatRunStream";
import {
  sessionComposeActions,
  sessionComposeStore,
  __resetSessionComposeStoreForTests,
} from "../useSessionComposeState";
import {
  streamLifecycleActions,
  streamLifecycleStore,
  __resetStreamLifecycleStoreForTests,
} from "../useStreamLifecycle";
import { sessionMessagesStore, __resetSessionMessageStoreForTests } from "../useSessionMessages";
import { createUserQueueItem } from "../chatQueueTypes";

const SID = "sess-drain-lifecycle";

const dummyConsumeRef: RefObject<(preferredSessionId?: string) => void> = { current: () => {} };

function makeParams(runStream: (opts: RunStreamOptions) => Promise<RunStreamOutcome>): UseChatQueueDrainParams {
  return {
    effectiveSessionId: SID,
    visibleSessionIds: [SID],
    isSessionRunOccupied: (sid) => streamLifecycleStore.isRunOccupied(sid),
    sessionsItems: [{ id: SID, agentId: "agent-1" }],
    consumeSessionQueueItemMutation: mockMutation(() => Promise.resolve({ claimed: true })) as never,
    finalizeSessionQueueItemMutation: mockMutation(() => Promise.resolve({ success: true })) as never,
    unclaimSessionQueueItemMutation: mockMutation(() => Promise.resolve({ success: true })) as never,
    runStream,
    consumeRef: dummyConsumeRef,
  };
}

function Harness({ runStream }: { runStream: (opts: RunStreamOptions) => Promise<RunStreamOutcome> }) {
  const consumeRef = useRef<(preferredSessionId?: string) => void>(() => {});
  const params = useMemo(() => makeParams(runStream), [runStream]);
  const { drainAllPendingQueues } = useChatQueueDrain({ ...params, consumeRef });

  useEffect(() => {
    consumeRef.current = drainAllPendingQueues;
    const drain = (sid: string) => {
      streamLifecycleActions.clearDrainRequest(sid);
      // 与 chat.tsx 一致：queueMicrotask 作为 dispatch 重入边界
      queueMicrotask(() => consumeRef.current(sid));
    };
    const off = streamLifecycleActions.onStreamCommitted(drain);
    for (const sid of streamLifecycleStore.takeDrainRequests()) drain(sid);
    return off;
  }, [drainAllPendingQueues]);

  return null;
}

beforeEach(() => {
  __resetSessionComposeStoreForTests();
  __resetStreamLifecycleStoreForTests();
  __resetSessionMessageStoreForTests();
});

async function setupHarness(runStream: (opts: RunStreamOptions) => Promise<RunStreamOutcome>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<Harness runStream={runStream} />);
  });
  return { root, container };
}

describe("Chat queue drain 生命周期", () => {
  it("S1：run 结束后自动 drain 队列中下一条", async () => {
    const calls: RunStreamOptions[] = [];
    let resolveM1: (() => void) | null = null;

    const runStream = vi.fn(async (opts: RunStreamOptions): Promise<RunStreamOutcome> => {
      calls.push(opts);
      const callIndex = calls.length;
      streamLifecycleActions.beginStream(opts.targetSessionId ?? SID, {});
      if (callIndex === 1) {
        return new Promise<RunStreamOutcome>((resolve) => {
          resolveM1 = () => resolve({ status: "streamed" });
        });
      }
      return { status: "streamed" };
    });

    await setupHarness(runStream);

    // 步骤 1：空闲发送 M1
    const m1 = createUserQueueItem("M1", { visibility: "dispatching" });
    sessionComposeActions.enqueueUserQueueItem(SID, m1);
    // 直接触发 drain（模拟 enqueue 完成后的 consumeRef.current）
    sessionComposeActions.setQueueDraining(SID, false);
    streamLifecycleActions.hydrateDone(SID);
    await act(async () => {});

    expect(runStream).toHaveBeenCalledTimes(1);
    expect(sessionComposeStore.get(SID).userQueue).toHaveLength(0);
    expect(streamLifecycleStore.get(SID).phase).toBe("streaming");

    // 步骤 2：run 期间发送 M2（应入队）
    const m2 = createUserQueueItem("M2", { visibility: "visible" });
    sessionComposeActions.enqueueUserQueueItem(SID, m2);
    await act(async () => {});

    expect(sessionComposeStore.get(SID).userQueue).toHaveLength(1);
    expect(sessionComposeStore.get(SID).userQueue[0]?.text).toBe("M2");
    expect(runStream).toHaveBeenCalledTimes(1);

    // 步骤 3：模拟 run 结束（onDone 路径）
    const assistantId = `assistant-${Date.now()}`;
    streamLifecycleActions.completeStream(SID, "reply", { assistantMessageId: assistantId });
    sessionMessagesStore.upsertAssistantFromDone(SID, {
      assistantMessageId: assistantId,
      content: "reply",
    });
    // completeStream + upsert 已触发 tryCommit → COMMIT → onStreamCommitted → drain microtask
    await act(async () => {});

    // M1 的 runStream promise 仍 pending：queueDraining 未释放，
    // 此时 drain 会被 queueDraining 挡回，M2 还在队列
    expect(streamLifecycleStore.get(SID).phase).toBe("idle");
    expect(sessionComposeStore.get(SID).userQueue).toHaveLength(1);

    // 步骤 4：释放 M1 promise（finally 执行 queueDraining=false）
    resolveM1?.();
    await act(async () => {});
    await act(async () => {});

    // 期望：finally 释放锁后应再次触发 drain，M2 发出去
    expect(runStream).toHaveBeenCalledTimes(2);
    expect(sessionComposeStore.get(SID).userQueue).toHaveLength(0);
    expect(calls[1]?.message).toBe("M2");
  });

  it("S2：run settled 后没有 queue 时不再额外发送", async () => {
    const calls: RunStreamOptions[] = [];
    const runStream = vi.fn(async (opts: RunStreamOptions): Promise<RunStreamOutcome> => {
      calls.push(opts);
      streamLifecycleActions.beginStream(opts.targetSessionId ?? SID, {});
      // 同步结束
      streamLifecycleActions.completeStream(SID, "reply", { assistantMessageId: `a-${Date.now()}` });
      return { status: "streamed" };
    });

    await setupHarness(runStream);

    const m1 = createUserQueueItem("M1", { visibility: "dispatching" });
    sessionComposeActions.enqueueUserQueueItem(SID, m1);
    sessionComposeActions.setQueueDraining(SID, false);
    streamLifecycleActions.hydrateDone(SID);
    await act(async () => {});
    await act(async () => {});

    expect(runStream).toHaveBeenCalledTimes(1);
    expect(sessionComposeStore.get(SID).userQueue).toHaveLength(0);
  });
});
