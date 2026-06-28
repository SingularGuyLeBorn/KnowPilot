"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCReact, httpLink } from "@trpc/react-query";
import superjson from "superjson";
import type { AppRouter } from "@knowpilot/server/router";
import { authHeaders } from "@/lib/auth";

export const trpc = createTRPCReact<AppRouter>();

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
        httpLink({
          url: `${getBaseUrl()}/api/trpc`,
          transformer: superjson,
          headers: () => authHeaders(),
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
