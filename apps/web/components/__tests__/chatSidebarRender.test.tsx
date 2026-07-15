/**
 * ChatSidebar 渲染屏障测试（W16b-1 验收）。
 *
 * 场景还原：流式期 ChatView 订阅 useStreamLifecycle，每 token 重渲染一次；
 * 左栏 ChatSidebar 是其直接子组件。修复前左栏无 memo，整树随每 token 重渲染。
 *
 * 测试设计：
 * - Harness 复刻 ChatView 的接线——订阅真实 useStreamLifecycle store，
 *   把一组**引用稳定**的 props（module 级单例，镜像 chat.tsx 稳定化后的形态）传给
 *   真实 ChatSidebar（已包 React.memo）。
 * - 计数机制（计数 mock）：WorkspaceSelect 在默认视图（history/main）下无条件渲染，
 *   用 vi.mock 替换成计数桩——桩执行次数 === ChatSidebar 函数体执行次数。
 * - 每 50ms 经 streamLifecycleActions.setStreamingContent 推一次 token，共 10 次。
 * - 对照组：Harness 自身渲染计数 ≥ 11 且 echo 节点文本为最终 token，
 *   证明 10 次更新真实流过订阅链（测试不是空转）。
 * - 第三阶段：真实 prop 变化（renameDraft）必须正常触发重渲染，证明 memo 不过度阻塞。
 *
 * tRPC / 子组件全部 mock，保证用例密闭（不引入 next/navigation / 网络）。
 */

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* ─── 计数桩（vi.mock 工厂内只能引用 vi.hoisted 变量）─── */
const counters = vi.hoisted(() => ({ sidebarBody: 0 }));

vi.mock("@/lib/trpc", () => {
  const queryResult = {
    data: { items: [], total: 0, page: 1, pageSize: 40, totalPages: 0 },
    isLoading: false,
    refetch: vi.fn(),
  };
  const mutationResult = {
    mutate: vi.fn(),
    mutateAsync: vi.fn(async () => ({ success: true })),
    isPending: false,
  };
  const entity = { useQuery: () => queryResult, useMutation: () => mutationResult };
  return {
    trpc: {
      session: { list: entity, update: entity, delete: entity, bulkDelete: entity },
      workspace: { list: entity },
      task: { list: entity },
      useUtils: () => ({ session: { list: { invalidate: vi.fn() } } }),
    },
  };
});

vi.mock("@/lib/hooks", () => ({
  useAgent: () => ({ useList: () => ({ data: { items: [] }, isLoading: false }) }),
}));

vi.mock("@/components/workspaceSelect", () => ({
  WorkspaceSelect: () => {
    counters.sidebarBody += 1;
    return null;
  },
}));
vi.mock("@/components/workspaceTree", () => ({ WorkspaceTree: () => null }));
vi.mock("@/components/asyncTaskPanel", () => ({ AsyncTaskPanel: () => null }));
vi.mock("@/components/chatTimelineSteps", () => ({ ThinkingTimeline: () => null }));
vi.mock("@/components/chatSessionListItem", () => ({ SessionListItem: () => null }));
vi.mock("@/components/shared", () => ({ ConfirmDialog: () => null }));

import { ChatSidebar, type ChatSidebarProps } from "@/components/chatSidebar";
import { streamLifecycleActions, useStreamLifecycle } from "@/lib/useStreamLifecycle";

const SID = "w16b-render-barrier-test";

const noop = () => {};

/** 镜像 chat.tsx 稳定化后的 props：全部引用稳定（module 级单例） */
const stableProps: ChatSidebarProps = {
  leftOpen: true,
  leftTab: "history",
  setLeftTab: noop,
  historySubTab: "main",
  setHistorySubTab: noop,
  syncChatUiToUrl: noop,
  effectiveSessionId: SID,
  effectiveAgentId: "agent-1",
  mainSessionId: SID,
  mainAgentId: "agent-1",
  isSubagentSession: false,
  parentSessionId: null,
  selectedWorkspaceId: null,
  selectedAgent: undefined,
  chatConfigModel: "mock-model",
  asyncResultQueue: [],
  selectSession: noop,
  selectWorkspace: noop,
  startNewChat: noop,
  editingSessionId: null,
  setEditingSessionId: noop,
  renameDraft: "",
  setRenameDraft: noop,
  handleSessionHover: noop,
  handleSessionHoverEnd: noop,
  setShowCreateSubagent: noop,
  setError: noop,
  setToast: noop,
  refetchSession: noop,
  cancelAsyncJobMutate: noop,
  retryAsyncJobMutate: noop,
};

let harnessRenders = 0;

function Harness({ renameDraft }: { renameDraft: string }) {
  // 与 ChatView 同款订阅：token 更新 → Harness 重渲染（ChatSidebar 是其直接子组件）。
  // commit 计数放 effect（render 期写模块变量违反 react-hooks/globals）；
  // 无 deps → 每次 Harness commit 后 +1，语义等同渲染计数。
  const { state } = useStreamLifecycle(SID);
  useEffect(() => {
    harnessRenders += 1;
  });
  return (
    <>
      <ChatSidebar {...stableProps} renameDraft={renameDraft} />
      <output data-testid="echo">{state.streamingContent}</output>
    </>
  );
}

describe("ChatSidebar 渲染屏障（W16b-1）", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    counters.sidebarBody = 0;
    harnessRenders = 0;
    streamLifecycleActions.resetSession(SID);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<Harness renameDraft="" />);
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    streamLifecycleActions.resetSession(SID);
  });

  it("流式期 streamingContent 每 50ms 更新 10 次，ChatSidebar 函数体只执行 1 次", async () => {
    expect(counters.sidebarBody).toBe(1); // mount
    expect(harnessRenders).toBe(1);

    await act(async () => {
      streamLifecycleActions.beginStream(SID, { streamTargetUserId: "u1" });
    });
    for (let i = 1; i <= 10; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      await act(async () => {
        streamLifecycleActions.setStreamingContent(SID, `token-${i}`);
      });
    }

    // 对照组：10 次 token 更新真实流过 store 订阅链
    expect(container.querySelector('[data-testid="echo"]')?.textContent).toBe("token-10");
    expect(harnessRenders).toBeGreaterThanOrEqual(11); // mount + beginStream + 10 tokens（commit 计数）

    // 核心断言：ChatSidebar 函数体仍只执行过 mount 那 1 次
    expect(counters.sidebarBody).toBe(1);
  });

  it("真实 prop 变化时 ChatSidebar 正常重渲染（memo 不过度阻塞）", async () => {
    expect(counters.sidebarBody).toBe(1);
    await act(async () => {
      root.render(<Harness renameDraft="新标题" />);
    });
    expect(counters.sidebarBody).toBe(2);
  });
});
