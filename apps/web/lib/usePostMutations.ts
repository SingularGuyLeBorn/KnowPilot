"use client";

import { DEFAULT_POST_GARDEN, type OperationResult, type Post } from "@knowpilot/shared";
import { catchUnlessCancelled, trpc } from "@/lib/trpc";

/** 文章 mutation：创建/更新/删除后统一刷新相关 query（叶子，勿经 hooks 大桶） */
export function usePostMutations(options?: {
  onCreateSuccess?: (post: { slug: string; garden: Post["garden"] }) => void;
  onUpdateSuccess?: (post: { slug: string; garden: Post["garden"] }) => void;
  onDeleteSuccess?: () => void;
}) {
  const utils = trpc.useUtils();

  const invalidatePostQueries = () => {
    const w = catchUnlessCancelled("post.invalidate");
    utils.post.list.invalidate().catch(w);
    utils.post.tree.invalidate().catch(w);
    utils.post.categories.invalidate().catch(w);
    utils.post.tags.invalidate().catch(w);
  };

  const create = trpc.post.create.useMutation({
    onSuccess: (result: OperationResult<Post>) => {
      if (result.success && result.data?.slug) {
        invalidatePostQueries();
        options?.onCreateSuccess?.({
          slug: result.data.slug,
          garden: result.data.garden ?? DEFAULT_POST_GARDEN,
        });
      }
    },
  });

  const update = trpc.post.update.useMutation({
    onSuccess: (result: OperationResult<Post>) => {
      if (result.success && result.data) {
        invalidatePostQueries();
        utils.post.getById
          .invalidate({ id: result.data.id })
          .catch(catchUnlessCancelled("post.getById.invalidate"));
        utils.post.getBySlug
          .invalidate({
            slug: result.data.slug,
            garden: result.data.garden ?? DEFAULT_POST_GARDEN,
          })
          .catch(catchUnlessCancelled("post.getBySlug.invalidate"));
        options?.onUpdateSuccess?.({
          slug: result.data.slug,
          garden: result.data.garden ?? DEFAULT_POST_GARDEN,
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
      utils.post.listDeleted.invalidate().catch(catchUnlessCancelled("post.listDeleted.invalidate"));
    },
  });

  const permanentDelete = trpc.post.permanentDelete.useMutation({
    onSuccess: () => {
      invalidatePostQueries();
      utils.post.listDeleted.invalidate().catch(catchUnlessCancelled("post.listDeleted.invalidate"));
    },
  });

  return { create, update, remove, restore, permanentDelete, invalidatePostQueries };
}
