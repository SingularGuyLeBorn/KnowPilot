"use client";

/**
 * 会话级 ask_user 恢复条：刷新后若 timeline 未带 pending 结果，仍可从 listPending 恢复弹框。
 */

import { AskUserPrompt } from "@/components/askUserPrompt";
import { trpc } from "@/lib/trpc";

export function SessionAskUserBar({ sessionId }: { sessionId: string | null }) {
  const query = trpc.askUser.listPending.useQuery(
    { sessionId: sessionId! },
    { enabled: Boolean(sessionId), refetchOnWindowFocus: true, staleTime: 5_000 },
  );

  const items = query.data?.items ?? [];
  if (!sessionId || items.length === 0) return null;

  return (
    <div className="flex w-full flex-col gap-2 px-1 pb-2" data-testid="session-ask-user-bar">
      {items.map((item) => (
        <AskUserPrompt
          key={item.askId}
          askId={item.askId}
          question={item.question}
          options={item.options}
          channel={item.channel}
          onResolved={() => {
            void query.refetch();
          }}
        />
      ))}
    </div>
  );
}
