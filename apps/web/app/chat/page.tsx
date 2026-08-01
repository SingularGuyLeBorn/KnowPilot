"use client";

import { Suspense } from "react";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

function ChatFallback() {
  return (
    <div className="flex flex-1 items-center justify-center text-[var(--kp-text-3)]">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  );
}

/** Chat 巨型 client 图按需加载，避免顶栏首次点「对话」卡死编译主线程 */
const ChatView = dynamic(
  () => import("@/components/chat").then((m) => m.ChatView),
  { ssr: false, loading: () => <ChatFallback /> },
);

export default function ChatPage() {
  return (
    <Suspense fallback={<ChatFallback />}>
      <ChatView />
    </Suspense>
  );
}
