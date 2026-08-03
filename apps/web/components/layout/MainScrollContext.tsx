"use client";

import { createContext, useContext, ReactNode, RefObject } from "react";

const MainScrollContext = createContext<RefObject<HTMLElement | null> | null>(null);

export function MainScrollProvider({
  rootRef,
  children,
}: {
  rootRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  return <MainScrollContext value={rootRef}>{children}</MainScrollContext>;
}

export function useMainScrollRoot() {
  const ctx = useContext(MainScrollContext);
  return ctx?.current ?? null;
}
