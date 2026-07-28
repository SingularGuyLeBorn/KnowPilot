"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

/** 编辑页等非 /posts/[slug] 路由时，告诉侧栏「当前文章」以便高亮/定位 */
export type ContentNavHighlight = {
  slug: string | null;
  garden: string | null;
};

const ContentNavContext = createContext<ContentNavHighlight>({
  slug: null,
  garden: null,
});

export function ContentNavProvider({
  slug,
  garden,
  children,
}: ContentNavHighlight & { children: ReactNode }) {
  const value = useMemo(
    () => ({
      slug: slug?.trim() || null,
      garden: garden?.trim() || null,
    }),
    [slug, garden],
  );
  return <ContentNavContext.Provider value={value}>{children}</ContentNavContext.Provider>;
}

export function useContentNavHighlight(): ContentNavHighlight {
  return useContext(ContentNavContext);
}
