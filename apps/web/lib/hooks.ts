/**
 * 前端 React Query hooks 单文件收拢层。
 *
 * 设计不变量：
 * - 禁止新增 hooks/ 子目录；所有数据 hook 集中于此，避免同名文件冲突。
 * - useResumeSession 成功后失效 listRunning，由 chat.tsx 的 INV-5 自动 runStream 续传。
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- 动态 tRPC router 名称绑定 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { DEFAULT_POST_GARDEN } from "@knowpilot/shared";
import type {
  OperationResult,
  CreatePostInput, UpdatePostInput, ListPostsInput, Post,
  CreateGardenInput, UpdateGardenInput, ListGardensInput, Garden,
  Agent, Skill, McpServer, Memory, InfoSource, InboxItem,
  ChatSession, ChatMessage, FileMeta, GitRepo,
  Task, Workspace, Trigger, Approval,
  Tool, Prompt, Credential, Run,
} from "@knowpilot/shared";

/* ─── 1. 通用 CRUD Hook 工厂 ─── */

/**
 * 自动绑定并生成实体的 CRUD Hook 集合
 * @param entityRouterName tRPC Router 名称（例如 "agent", "skill"）
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- 泛型供调用方推断 create/update 输入类型
export function useCRUDApi<TCreate = any, TUpdate extends { id: string } = any, TList = any, TEntity = any>(
  entityRouterName: string,
) {
  const api = (trpc as any)[entityRouterName];
  if (!api) {
    throw new Error(`找不到 tRPC 路由对象: ${entityRouterName}`);
  }

  return {
    useList: (input: TList, options?: any) => {
      return api.list.useQuery(input, options);
    },

    useById: (id: string, options?: any) => {
      return api.getById.useQuery({ id }, { enabled: !!id, ...options });
    },

    useCreate: (options?: any) => {
      const utils = trpc.useUtils() as any;
      return api.create.useMutation({
        onSuccess: (res: OperationResult<TEntity>) => {
          if (res.success) {
            utils[entityRouterName].list.invalidate();
          }
          options?.onSuccess?.(res);
        },
        ...options,
      });
    },

    useUpdate: (options?: any) => {
      const utils = trpc.useUtils() as any;
      return api.update.useMutation({
        onSuccess: (res: OperationResult<TEntity>) => {
          if (res.success) {
            utils[entityRouterName].list.invalidate();
            if (res.data) {
              utils[entityRouterName].getById.invalidate({ id: (res.data as any).id });
            }
          }
          options?.onSuccess?.(res);
        },
        ...options,
      });
    },

    useDelete: (options?: any) => {
      const utils = trpc.useUtils() as any;
      return api.delete.useMutation({
        onSuccess: (res: OperationResult<any>) => {
          if (res.success) {
            utils[entityRouterName].list.invalidate();
          }
          options?.onSuccess?.(res);
        },
        ...options,
      });
    },
  };
}

/* ─── 2. 18 个实体的具体 Hook 绑定与特定扩展 ─── */

/** 知识库花园 Hooks */
export function useGardens() {
  return useCRUDApi<CreateGardenInput, UpdateGardenInput & { id: string }, ListGardensInput, Garden>("garden");
}

/**
 * 内容区当前「作用域花园」。
 * - `/gardens/{id}`、`?garden=` → 只显示该库目录
 * - `/posts/{slug}` 无 query → 默认 posts 库（不混其它库）
 * - `/posts` 全部列表（无 garden）→ null（跨库全树）
 * - `/editor`：优先 `?garden=`（编辑页会把文章所属库写进 URL）；无 query 时新建页默认 posts
 */
export function useContentGardenScope(): {
  gardenId: string | null;
  isScoped: boolean;
} {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return useMemo(() => {
    const fromQuery = searchParams.get("garden")?.trim() || "";
    const gardenHome = pathname.match(/^\/gardens\/([^/]+)\/?$/);
    if (gardenHome?.[1]) {
      const id = decodeURIComponent(gardenHome[1]);
      return { gardenId: id, isScoped: true };
    }
    if (fromQuery) {
      return { gardenId: fromQuery, isScoped: true };
    }
    if (pathname.startsWith("/posts/") && !pathname.startsWith("/posts/trash")) {
      return { gardenId: DEFAULT_POST_GARDEN, isScoped: true };
    }
    // 编辑器无 ?garden= 时：新建默认 posts；编辑已有文由页面 sync query，避免误显 posts 三篇
    if (pathname === "/editor" || pathname.startsWith("/editor/")) {
      return { gardenId: DEFAULT_POST_GARDEN, isScoped: true };
    }
    return { gardenId: null, isScoped: false };
  }, [pathname, searchParams]);
}

/** 文章专属 Hooks 扩展 */
export function usePosts() {
  const postCrud = useCRUDApi<CreatePostInput, UpdatePostInput, ListPostsInput, Post>("post");
  return {
    ...postCrud,
    useBySlug: (slug: string, garden?: string, options?: any) => {
      return trpc.post.getBySlug.useQuery(
        { slug, garden: garden ?? DEFAULT_POST_GARDEN },
        { enabled: !!slug, ...options },
      );
    },
    useSearch: (
      query: string,
      limit = 10,
      garden?: string,
      options?: any,
    ) => {
      return trpc.post.search.useQuery(
        { query, limit, garden },
        { enabled: !!query, ...options },
      );
    },
    useTree: (garden?: string, options?: any) => {
      return trpc.post.tree.useQuery(garden ? { garden } : {}, options);
    },
    useCategories: (options?: any) => {
      return trpc.post.categories.useQuery(undefined, options);
    },
    useTags: (options?: any) => {
      return trpc.post.tags.useQuery(undefined, options);
    },
  };
}

/** 文章 mutation 封装：创建/更新/删除后统一刷新相关 query */
export function usePostMutations(options?: {
  /** 创建成功：回传 slug + garden，便于跳转带花园的详情页 */
  onCreateSuccess?: (post: { slug: string; garden: Post["garden"] }) => void;
  onUpdateSuccess?: (post: { slug: string; garden: Post["garden"] }) => void;
  onDeleteSuccess?: () => void;
}) {
  const utils = trpc.useUtils();

  const invalidatePostQueries = () => {
    utils.post.list.invalidate().catch(() => {});
    utils.post.tree.invalidate().catch(() => {});
    utils.post.categories.invalidate().catch(() => {});
    utils.post.tags.invalidate().catch(() => {});
  };

  const create = trpc.post.create.useMutation({
    onSuccess: (result: OperationResult<Post>) => {
      if (result.success && result.data?.slug) {
        invalidatePostQueries();
        options?.onCreateSuccess?.({
          slug: result.data.slug,
          garden: result.data.garden ?? "posts",
        });
      }
    },
  });

  const update = trpc.post.update.useMutation({
    onSuccess: (result: OperationResult<Post>) => {
      if (result.success && result.data) {
        invalidatePostQueries();
        utils.post.getById.invalidate({ id: result.data.id }).catch(() => {});
        utils.post.getBySlug
          .invalidate({ slug: result.data.slug, garden: result.data.garden ?? "posts" })
          .catch(() => {});
        options?.onUpdateSuccess?.({
          slug: result.data.slug,
          garden: result.data.garden ?? "posts",
        });
      }
    },
  });

  const remove = trpc.post.delete.useMutation({
    onSuccess: (result) => {
      const res = result as OperationResult;
      if (res.success) {
        invalidatePostQueries();
        options?.onDeleteSuccess?.();
      }
    },
  });

  const restore = trpc.post.restore.useMutation({
    onSuccess: () => {
      invalidatePostQueries();
      utils.post.listDeleted.invalidate().catch(() => {});
    },
  });

  const permanentDelete = trpc.post.permanentDelete.useMutation({
    onSuccess: () => {
      invalidatePostQueries();
      utils.post.listDeleted.invalidate().catch(() => {});
    },
  });

  return { create, update, remove, restore, permanentDelete, invalidatePostQueries };
}

// 通用实体 Hooks
export const useAgent = () => useCRUDApi<any, any, any, Agent>("agent");
export const useSkill = () => useCRUDApi<any, any, any, Skill>("skill");
export const useMcp = () => useCRUDApi<any, any, any, McpServer>("mcp");
export const useMemory = () => useCRUDApi<any, any, any, Memory>("memory");
export const useInfoSource = () => {
  const base = useCRUDApi<any, any, any, InfoSource>("infoSource");
  const utils = trpc.useUtils();
  const fetchMutation = trpc.infoSource.fetch.useMutation({
    onSuccess: () => {
      utils.infoSource.list.invalidate().catch(() => {});
    },
  });
  const fetchDueMutation = trpc.infoSource.fetchDue.useMutation({
    onSuccess: () => {
      utils.infoSource.list.invalidate().catch(() => {});
    },
  });
  return {
    ...base,
    useFetch: () => fetchMutation,
    useFetchDue: () => fetchDueMutation,
  };
};

export const useInbox = () => {
  const base = useCRUDApi<any, any, any, InboxItem>("inbox");
  const utils = trpc.useUtils();
  const invalidate = () => {
    utils.inbox.list.invalidate().catch(() => {});
    utils.inbox.stats.invalidate().catch(() => {});
    utils.inbox.facets.invalidate().catch(() => {});
  };
  return {
    ...base,
    useStats: (options?: any) => trpc.inbox.stats.useQuery(undefined, options),
    useFacets: (input?: { status?: string }, options?: any) =>
      trpc.inbox.facets.useQuery(input ?? {}, options),
    useCaptureUrl: () =>
      trpc.inbox.captureUrl.useMutation({ onSuccess: invalidate }),
    useCaptureUrls: () =>
      trpc.inbox.captureUrls.useMutation({ onSuccess: invalidate }),
    useSyncZhihu: () =>
      trpc.inbox.syncZhihu.useMutation({ onSuccess: invalidate }),
    useSyncXhs: () =>
      trpc.inbox.syncXhs.useMutation({ onSuccess: invalidate }),
    useSyncBilibili: () =>
      trpc.inbox.syncBilibili.useMutation({ onSuccess: invalidate }),
    /** 启动即返回 jobId；勿在 onSuccess invalidate（任务尚未跑完，会无谓闪烁） */
    useStartPlatformSync: () => trpc.inbox.startPlatformSync.useMutation(),
    useCancelPlatformSync: () => trpc.inbox.cancelPlatformSync.useMutation(),
    usePlatformSyncProgress: (jobId: string | null, options?: any) =>
      trpc.inbox.platformSyncProgress.useQuery(
        { jobId: jobId ?? "" },
        {
          enabled: !!jobId,
          staleTime: 0,
          refetchOnWindowFocus: false,
          ...options,
        },
      ),
    useActivePlatformSync: (options?: any) =>
      trpc.inbox.activePlatformSync.useQuery(undefined, {
        refetchOnWindowFocus: false,
        ...options,
      }),
    useLatestPlatformSync: (options?: any) =>
      trpc.inbox.latestPlatformSync.useQuery(undefined, {
        refetchOnWindowFocus: true,
        staleTime: 0,
        ...options,
      }),
    invalidateInboxQueries: invalidate,
    useScanScreenshots: () =>
      trpc.inbox.scanScreenshots.useMutation({ onSuccess: invalidate }),
    useIngestWechat: () =>
      trpc.inbox.ingestWechatDrop.useMutation({ onSuccess: invalidate }),
    useDistill: () =>
      trpc.inbox.distill.useMutation({ onSuccess: invalidate }),
    useIgnore: () =>
      trpc.inbox.ignore.useMutation({ onSuccess: invalidate }),
    useBulkDelete: () =>
      trpc.inbox.bulkDelete.useMutation({ onSuccess: invalidate }),
  };
};

export const useSession = () => useCRUDApi<any, any, any, ChatSession>("session");

/**
 * C-3 不变量：恢复按钮触发 resume mutation 后，立即失效 listRunning /
 * session.getById / list / listChildren，chat.tsx INV-5 挂接 effect 发现运行中会话自动 runStream 续传。
 */
export function useResumeSession(options?: { onError?: (message: string) => void }) {
  const utils = trpc.useUtils();
  return trpc.session.resume.useMutation({
    onSuccess: (_res, vars) => {
      utils.session.getById.invalidate({ id: vars.id }).catch(() => {});
      utils.session.list.invalidate().catch(() => {});
      utils.session.listChildren.invalidate().catch(() => {});
      utils.session.listRunning.invalidate().catch(() => {});
    },
    onError: (err) => options?.onError?.(err.message),
  });
}

export const useMessage = () => useCRUDApi<any, any, any, ChatMessage>("message");

export const useFile = () => {
  const base = useCRUDApi<any, any, any, FileMeta>("file");
  const uploadMutation = trpc.file.upload.useMutation({
    onSuccess: () => {
      const utils = trpc.useUtils();
      utils.file.list.invalidate();
    },
  });
  return {
    ...base,
    useUpload: () => uploadMutation,
  };
};

export const useLog = () => useCRUDApi<unknown, { id: string }, unknown, unknown>("log");
export const useGit = () => {
  const crud = useCRUDApi<any, any, any, GitRepo>("git");
  const utils = trpc.useUtils();
  return {
    ...crud,
    useStatus: (input: { repoId?: string; repoPath?: string }, options?: { enabled?: boolean }) =>
      trpc.git.status.useQuery(input, options),
    useLog: (
      input: { repoId?: string; repoPath?: string; limit?: number },
      options?: { enabled?: boolean },
    ) => trpc.git.log.useQuery(input, options),
    useDiff: (
      input: { repoId?: string; repoPath?: string; staged?: boolean },
      options?: { enabled?: boolean },
    ) => trpc.git.diff.useQuery(input, options),
    useCommit: (options?: {
      onSuccess?: (res: unknown) => void;
      onError?: (err: { message?: string }) => void;
    }) =>
      trpc.git.commit.useMutation({
        onSuccess: (res) => {
          utils.git.status.invalidate().catch(() => {});
          utils.git.log.invalidate().catch(() => {});
          utils.git.diff.invalidate().catch(() => {});
          options?.onSuccess?.(res);
        },
        onError: options?.onError,
      }),
    usePull: (options?: {
      onSuccess?: (res: unknown) => void;
      onError?: (err: { message?: string }) => void;
    }) =>
      trpc.git.pull.useMutation({
        onSuccess: (res) => {
          utils.git.status.invalidate().catch(() => {});
          utils.git.log.invalidate().catch(() => {});
          utils.git.diff.invalidate().catch(() => {});
          options?.onSuccess?.(res);
        },
        onError: options?.onError,
      }),
    usePush: (options?: {
      onSuccess?: (res: unknown) => void;
      onError?: (err: { message?: string }) => void;
    }) =>
      trpc.git.push.useMutation({
        onSuccess: (res) => {
          utils.git.status.invalidate().catch(() => {});
          utils.git.log.invalidate().catch(() => {});
          options?.onSuccess?.(res);
        },
        onError: options?.onError,
      }),
  };
};
export const useTask = () => {
  const crud = useCRUDApi<any, any, any, Task>("task");
  return {
    ...crud,
    useRun: (options?: any) => {
      const utils = trpc.useUtils() as any;
      return trpc.task.run.useMutation({
        onSuccess: (res: OperationResult<any>) => {
          if (res.success) utils.task.list.invalidate();
          options?.onSuccess?.(res);
        },
        ...options,
      });
    },
  };
};
export const useWorkspace = () => useCRUDApi<any, any, any, Workspace>("workspace");
export const useTrigger = () => useCRUDApi<any, any, any, Trigger>("trigger");
export const useApproval = () => {
  const crud = useCRUDApi<any, any, any, Approval>("approval");
  return {
    ...crud,
    useExecute: (options?: any) => {
      const utils = trpc.useUtils() as any;
      return trpc.approval.execute.useMutation({
        onSuccess: (res: OperationResult<any>) => {
          if (res.success) utils.approval.list.invalidate();
          options?.onSuccess?.(res);
        },
        ...options,
      });
    },
    useApproveAndExecute: (options?: any) => {
      const utils = trpc.useUtils() as any;
      return trpc.approval.approveAndExecute.useMutation({
        onSuccess: (res: OperationResult<any>) => {
          if (res.success) utils.approval.list.invalidate();
          options?.onSuccess?.(res);
        },
        ...options,
      });
    },
  };
};
export const useTool = () => useCRUDApi<any, any, any, Tool>("tool");

/** 邮件回复死信审计（未匹配 pending 的邮件回复） */
export function useDeadLetterList(status: "pending" | "reviewed" | "all" = "all") {
  return trpc.deadLetter.list.useQuery({ status, limit: 50 });
}
export function useDeadLetterReview() {
  const utils = trpc.useUtils() as any;
  return trpc.deadLetter.review.useMutation({
    onSuccess: () => utils.deadLetter.list.invalidate(),
  });
}
export function useDeadLetterClear() {
  const utils = trpc.useUtils() as any;
  return trpc.deadLetter.clear.useMutation({
    onSuccess: () => utils.deadLetter.list.invalidate(),
  });
}

/** 原生工具运行时能力（搜索/OCR/浏览器/read_article 平台） */
export function useNativeCapabilities(options?: { staleTime?: number }) {
  return trpc.native.capabilities.useQuery(undefined, {
    staleTime: options?.staleTime ?? 60_000,
  });
}

export const useRun = () => useCRUDApi<any, any, any, Run>("run");
export const usePrompt = () => useCRUDApi<any, any, any, Prompt>("prompt");
export const useCredential = () => {
  const crud = useCRUDApi<any, any, any, Credential>("credential");
  return {
    ...crud,
    useImportFromEnv: (options?: any) => {
      const utils = trpc.useUtils();
      return trpc.credential.importFromEnv.useMutation({
        onSuccess: (res: any) => {
          if (res?.imported?.length) utils.credential.list.invalidate().catch(() => {});
          options?.onSuccess?.(res);
        },
        ...options,
      });
    },
  };
};

/* ─── 3. AI 反射调用 Hooks ─── */

export function useAIApi() {
  const utils = trpc.useUtils();
  return {
    useTools: (options?: any) => {
      return trpc.ai.tools.useQuery(undefined, options);
    },
    useCall: (options?: any) => {
      return trpc.ai.invoke.useMutation({
        onSuccess: () => {
          utils.invalidate();
        },
        ...options,
      });
    },
  };
}

/* ─── 4. 实体卡片密度偏好 ─── */

export type CardDensity = "comfortable" | "compact";

const CARD_DENSITY_KEY = "kp-card-density";
const CARD_DENSITY_CHANGE_EVENT = "kp-card-density-change";

function readSavedDensity(): CardDensity {
  try {
    const saved = localStorage.getItem(CARD_DENSITY_KEY);
    if (saved === "comfortable" || saved === "compact") return saved;
  } catch {
    // ignore
  }
  return "comfortable";
}

export function useCardDensity() {
  // 水合约束：SSR 与客户端首帧必须渲染相同结果，localStorage 只能在挂载后（effect 里）读，
  // 否则存了 compact 的浏览器首帧图标/title 与服务端 HTML 不一致 → hydration mismatch
  const [density, setDensityState] = useState<CardDensity>("comfortable");

  useEffect(() => {
    // mount 后读 localStorage 同步到 React state（SSR hydration 安全），非派生数据
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDensityState(readSavedDensity());
    const handler = () => setDensityState(readSavedDensity());
    window.addEventListener(CARD_DENSITY_CHANGE_EVENT, handler);
    return () => window.removeEventListener(CARD_DENSITY_CHANGE_EVENT, handler);
  }, []);

  const setDensity = useCallback((d: CardDensity) => {
    setDensityState(d);
    try {
      localStorage.setItem(CARD_DENSITY_KEY, d);
    } catch {
      // ignore
    }
    window.dispatchEvent(new CustomEvent(CARD_DENSITY_CHANGE_EVENT));
  }, []);

  const toggle = useCallback(() => {
    setDensity(density === "compact" ? "comfortable" : "compact");
  }, [density, setDensity]);

  return { density, setDensity, toggle };
}

/* ─── 4b. 会话列表 hover 预览悬浮窗（默认关闭） ─── */

const SESSION_HOVER_PREVIEW_KEY = "kp-session-hover-preview";
const SESSION_HOVER_PREVIEW_EVENT = "kp-session-hover-preview-change";

function readSessionHoverPreview(): boolean {
  try {
    return localStorage.getItem(SESSION_HOVER_PREVIEW_KEY) === "1";
  } catch {
    return false;
  }
}

/** 会话 hover 监控小窗：默认关，可在对话设置 → 参数里开启 */
export function useSessionHoverPreview() {
  const [enabled, setEnabledState] = useState(false);

  useEffect(() => {
    // mount 后读 localStorage 同步到 React state（SSR hydration 安全），非派生数据
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEnabledState(readSessionHoverPreview());
    const handler = () => setEnabledState(readSessionHoverPreview());
    window.addEventListener(SESSION_HOVER_PREVIEW_EVENT, handler);
    return () => window.removeEventListener(SESSION_HOVER_PREVIEW_EVENT, handler);
  }, []);

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    try {
      localStorage.setItem(SESSION_HOVER_PREVIEW_KEY, next ? "1" : "0");
    } catch {
      // ignore
    }
    window.dispatchEvent(new CustomEvent(SESSION_HOVER_PREVIEW_EVENT));
  }, []);

  return { enabled, setEnabled };
}

/** L2 遗留入口：Chat 是 Agent 聊天的子集。 */
export function useAgentChat() {
  const utils = trpc.useUtils();
  const chat = trpc.agent.chat.useMutation({
    onSuccess: (res) => {
      if (res.success && res.data?.sessionId) {
        utils.session.list.invalidate().catch(() => {});
        utils.session.getById.invalidate({ id: res.data.sessionId }).catch(() => {});
        utils.message.list.invalidate({ sessionId: res.data.sessionId }).catch(() => {});
      }
    },
  });
  const providers = trpc.agent.llmProviders.useQuery();
  return { chat, providers };
}
