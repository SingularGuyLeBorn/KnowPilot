"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCReact, httpLink, httpBatchLink, splitLink } from "@trpc/react-query";
import superjson from "superjson";
import type { AppRouter } from "@knowpilot/server/router";
import { authHeaders } from "@/lib/auth";

export const trpc = createTRPCReact<AppRouter>();

/** TanStack Query 并发 refetch 取消旧 fetch 时抛 CancelledError；AbortError 同理。 */
export function isCancelledOrAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === "CancelledError" || err.name === "AbortError");
}

/** 取消类错误静默；其余 warn 便于观测，避免 unhandled rejection。 */
export function warnUnlessCancelled(context: string, err: unknown): void {
  if (isCancelledOrAbortError(err)) return;
  console.warn(context, err);
}

export function catchUnlessCancelled(context: string): (err: unknown) => void {
  return (err) => warnUnlessCancelled(context, err);
}

function getBaseUrl() {
  if (typeof window !== "undefined") return "";
  return process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3010";
}

export function TRPCProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30 * 1000,
            gcTime: 5 * 60 * 1000,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        // P4：query 走 httpBatchLink（同 tick 多 query 合并单 HTTP 请求，减少往返），
        // mutation/subscription 走 httpLink（不合并）。file.upload 等大 payload 是 mutation，
        // 自动落在非 batch 分支，避免 payload 过大；SSE 流式不走 tRPC，不受影响。
        splitLink({
          condition: (op) => op.type === "query",
          true: httpBatchLink({
            url: `${getBaseUrl()}/api/trpc`,
            transformer: superjson,
            headers: () => authHeaders(),
          }),
          false: httpLink({
            url: `${getBaseUrl()}/api/trpc`,
            transformer: superjson,
            headers: () => authHeaders(),
          }),
        }),
      ],
    })
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
