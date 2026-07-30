/**
 * askUser tRPC 子路由（从 router.ts 拆出的叶子）。
 */

import { TRPCError } from "@trpc/server";
import {
  resolveAskUserSchema, listAskUserPendingSchema,
} from "@knowpilot/shared";
import { router, publicProcedure } from "../../trpc/trpc.js";
import {
  getAskUserPending,
  listAskUserPendingForSession,
  resolveAskUser,
} from "../askUserGate.js";
import { getStreamHub } from "../sessionStreamHub.js";

export const askUserRouter = router({
  listPending: publicProcedure
    .meta({ description: "列出会话内仍在等待的 ask_user 提问（刷新后恢复弹框）。", aiReadable: false })
    .input(listAskUserPendingSchema)
    .query(({ input }) => ({
      items: listAskUserPendingForSession(input.sessionId).map((p) => ({
        askId: p.askId,
        sessionId: p.sessionId,
        question: p.question,
        options: p.options,
        channel: p.channel,
        subject: p.subject,
        createdAt: p.createdAt,
      })),
    })),
  resolve: publicProcedure
    .meta({ description: "答复 ask_user（Chat 弹框），唤醒挂起的 Agent run。", aiReadable: false })
    .input(resolveAskUserSchema)
    .mutation(({ input }) => {
      const pending = getAskUserPending(input.askId);
      const result = resolveAskUser(input.askId, input.answer, "ui");
      if (!result.ok) {
        throw new TRPCError({ code: "BAD_REQUEST", message: result.reason });
      }
      if (pending?.sessionId) {
        getStreamHub()?.pushExternalEvent(pending.sessionId, {
          type: "ask_user_resolved",
          sessionId: pending.sessionId,
          askId: input.askId,
          outcome: "answered",
          answer: input.answer,
        });
      }
      return { askId: input.askId, outcome: "answered" as const };
    }),
});

