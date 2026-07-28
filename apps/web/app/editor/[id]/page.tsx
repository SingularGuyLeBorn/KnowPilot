"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { postDetailHref } from "@/lib/postHref";
import { trpc } from "@/lib/trpc";

/**
 * 旧「编辑模式」入口：直接跳到文章页（文章页即编辑，自动保存）。
 * 新建文章仍走 /editor。
 */
export default function EditPostRedirectPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const { data: post, isLoading, isError } = trpc.post.getById.useQuery(
    { id },
    { enabled: !!id && id !== "new" && id !== "undefined" && id.length > 5 },
  );

  useEffect(() => {
    if (!post) return;
    router.replace(postDetailHref(post.slug, post.garden));
  }, [post, router]);

  if (isLoading || post) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-[var(--kp-text-2)]">正在打开文章…</div>
      </div>
    );
  }

  if (isError || !post) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-[var(--kp-text-2)]">文章不存在</div>
      </div>
    );
  }

  return null;
}
