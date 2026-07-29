"use client";

import { useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { DEFAULT_POST_GARDEN } from "@knowpilot/shared";

/**
 * 内容区当前「作用域花园」。
 * - `/gardens/{id}`、`?garden=` → 只显示该库目录
 * - `/posts/{slug}` 无 query → 默认 posts 库
 * - `/posts` 全部列表 → null（跨库全树）
 * - `/editor`：优先 `?garden=`；无 query 时新建默认 posts
 *
 * 叶子模块：PostSidebar 等勿经 hooks.ts 大桶间接引入全量 CRUD。
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
    if (pathname === "/editor" || pathname.startsWith("/editor/")) {
      return { gardenId: DEFAULT_POST_GARDEN, isScoped: true };
    }
    return { gardenId: null, isScoped: false };
  }, [pathname, searchParams]);
}
