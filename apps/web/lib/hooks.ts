/**
 * KnowPilot 前端 React Hooks 数据层 (Hooks Layer)
 *
 * 【扁平化单文件设计】：
 * 1. 包含通用 CRUD React Query hooks 工厂 (useCRUDApi)。
 * 2. 包含文章专属 hooks 扩展、文件 Base64 上传及 AI 反射调用 hooks。
 * 3. 彻底删除 hooks/ 子目录，杜绝深层结构命名冲突。
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- 动态 tRPC router 名称绑定 */
import { useCallback, useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import type {
  OperationResult,
  CreatePostInput, UpdatePostInput, ListPostsInput, Post,
  Agent, Skill, McpServer, Memory, InfoSource,
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

/** 文章专属 Hooks 扩展 */
export function usePosts() {
  const postCrud = useCRUDApi<CreatePostInput, UpdatePostInput, ListPostsInput, Post>("post");
  return {
    ...postCrud,
    useBySlug: (slug: string, options?: any) => {
      return trpc.post.getBySlug.useQuery({ slug }, { enabled: !!slug, ...options });
    },
    useSearch: (query: string, limit = 10, options?: any) => {
      return trpc.post.search.useQuery({ query, limit }, { enabled: !!query, ...options });
    },
    useTree: (options?: any) => {
      return trpc.post.tree.useQuery(undefined, options);
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
  onCreateSuccess?: (slug: string) => void;
  onUpdateSuccess?: (slug: string) => void;
  onDeleteSuccess?: () => void;
}) {
  const utils = trpc.useUtils();

  const invalidatePostQueries = () => {
    void utils.post.list.invalidate();
    void utils.post.tree.invalidate();
    void utils.post.categories.invalidate();
    void utils.post.tags.invalidate();
  };

  const create = trpc.post.create.useMutation({
    onSuccess: (result: OperationResult<Post>) => {
      if (result.success) {
        invalidatePostQueries();
        if (result.data?.slug) options?.onCreateSuccess?.(result.data.slug);
      }
    },
  });

  const update = trpc.post.update.useMutation({
    onSuccess: (result: OperationResult<Post>) => {
      if (result.success && result.data) {
        invalidatePostQueries();
        void utils.post.getById.invalidate({ id: result.data.id });
        void utils.post.getBySlug.invalidate({ slug: result.data.slug });
        options?.onUpdateSuccess?.(result.data.slug);
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
      void utils.post.listDeleted.invalidate();
    },
  });

  const permanentDelete = trpc.post.permanentDelete.useMutation({
    onSuccess: () => {
      invalidatePostQueries();
      void utils.post.listDeleted.invalidate();
    },
  });

  return { create, update, remove, restore, permanentDelete, invalidatePostQueries };
}

// 通用实体 Hooks
export const useAgent = () => useCRUDApi<any, any, any, Agent>("agent");
export const useSkill = () => useCRUDApi<any, any, any, Skill>("skill");
export const useMcp = () => useCRUDApi<any, any, any, McpServer>("mcp");
export const useMemory = () => useCRUDApi<any, any, any, Memory>("memory");
export const useInfoSource = () => useCRUDApi<any, any, any, InfoSource>("infoSource");
export const useSession = () => useCRUDApi<any, any, any, ChatSession>("session");
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
  return {
    ...crud,
    useStatus: (input: { repoId?: string; repoPath?: string }, options?: { enabled?: boolean }) =>
      trpc.git.status.useQuery(input, options),
    useLog: (
      input: { repoId?: string; repoPath?: string; limit?: number },
      options?: { enabled?: boolean },
    ) => trpc.git.log.useQuery(input, options),
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
          if (res?.imported?.length) void utils.credential.list.invalidate();
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
  const [density, setDensityState] = useState<CardDensity>(() => {
    if (typeof window === "undefined") return "comfortable";
    return readSavedDensity();
  });

  useEffect(() => {
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

/** Agent 聊天（L2：Chat 作为 Agent 子集） */
export function useAgentChat() {
  const utils = trpc.useUtils();
  const chat = trpc.agent.chat.useMutation({
    onSuccess: (res) => {
      if (res.success && res.data?.sessionId) {
        void utils.session.list.invalidate();
        void utils.session.getById.invalidate({ id: res.data.sessionId });
        void utils.message.list.invalidate({ sessionId: res.data.sessionId });
      }
    },
  });
  const providers = trpc.agent.llmProviders.useQuery();
  return { chat, providers };
}
