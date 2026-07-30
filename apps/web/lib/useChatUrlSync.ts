/**
 * useChatUrlSync —— Chat URL ↔ 焦点会话同步（P3-04 / p13 自 chat.tsx 拆出）。
 *
 * 不变量：URL→tabs 只响应「URL 本身变化」（深链 / 前进后退 / 外链），
 * 绝不把 focusedSessionId / layout 放进 URL→tabs 的 deps——否则会与 tabs→URL 乒乓。
 */

"use client";

import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { ReadonlyURLSearchParams } from "next/navigation";
import { catchUnlessCancelled, trpc } from "@/lib/trpc";

type RouterLike = {
  replace: (href: string, opts?: { scroll?: boolean }) => void;
};

export function useChatUrlSync(args: {
  searchParams: ReadonlyURLSearchParams;
  pathname: string;
  router: RouterLike;
  sessionFromUrl: string | null;
  focusedSessionId: string | null;
  tabsHydrated: boolean;
  ensureFocusedSession: (id: string) => void;
  consumeRef: MutableRefObject<(preferredSessionId?: string) => void>;
}) {
  const {
    searchParams,
    pathname,
    router,
    sessionFromUrl,
    focusedSessionId,
    tabsHydrated,
    ensureFocusedSession,
    consumeRef,
  } = args;

  const utils = trpc.useUtils();
  const prevFocusedRef = useRef<string | null>(null);
  const focusedSessionIdRef = useRef(focusedSessionId);

  const syncChatUiToUrl = useCallback(
    (patch: { view?: "main" | "sub"; panel?: "history" | "runtime" }) => {
      const params = new URLSearchParams(searchParams.toString());
      let changed = false;
      if (patch.view === "sub" || patch.view === "main") {
        if (params.get("view") !== patch.view) {
          params.set("view", patch.view);
          changed = true;
        }
      }
      if (patch.panel === "runtime") {
        if (params.get("panel") !== "runtime") {
          params.set("panel", "runtime");
          changed = true;
        }
      } else if (patch.panel === "history") {
        if (params.has("panel")) {
          params.delete("panel");
          changed = true;
        }
      }
      if (changed) {
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      }
    },
    [searchParams, pathname, router],
  );

  useEffect(() => {
    focusedSessionIdRef.current = focusedSessionId;
  }, [focusedSessionId]);

  useEffect(() => {
    if (sessionFromUrl && sessionFromUrl !== focusedSessionIdRef.current) {
      ensureFocusedSession(sessionFromUrl);
      utils.session.list.invalidate().catch(catchUnlessCancelled("useChatUrlSync"));
      utils.session.listRunning.invalidate().catch(catchUnlessCancelled("useChatUrlSync"));
      consumeRef.current(sessionFromUrl);
    }
  }, [sessionFromUrl, ensureFocusedSession, utils.session.list, utils.session.listRunning, consumeRef]);

  useEffect(() => {
    if (!tabsHydrated) return;
    if (sessionFromUrl && !focusedSessionId) {
      ensureFocusedSession(sessionFromUrl);
    }
  }, [tabsHydrated, sessionFromUrl, focusedSessionId, ensureFocusedSession]);

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    let changed = false;
    const focus = focusedSessionId;
    if (focus) {
      if (params.get("sessionId") !== focus) {
        params.set("sessionId", focus);
        changed = true;
      }
    } else if (params.has("sessionId") && prevFocusedRef.current) {
      params.delete("sessionId");
      changed = true;
    }
    if (params.has("split")) {
      params.delete("split");
      changed = true;
    }
    prevFocusedRef.current = focus;
    if (changed) {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }
  }, [focusedSessionId, searchParams, pathname, router]);

  return { syncChatUiToUrl };
}
