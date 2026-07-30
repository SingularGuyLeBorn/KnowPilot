/**
 * about tRPC 子路由（从 router.ts 拆出的叶子）。
 */

import { router, publicProcedure } from "../../trpc/trpc.js";
import { loadAboutProfile } from "../aboutProfile.js";

export const aboutRouter = router({
  getProfile: publicProcedure
    .meta({ description: "About Me 页面 profile（content/about/profile.md）。", aiReadable: true })
    .query(() => loadAboutProfile()),
});

