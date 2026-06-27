import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@knowpilot/server";
import superjson from "superjson";

export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: process.env.NEXT_PUBLIC_API_URL || "http://localhost:3010/api/trpc",
      transformer: superjson,
    }),
  ],
});
export type { AppRouter };
export type * from "@knowpilot/shared";
export * from "@knowpilot/shared";
