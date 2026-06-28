"use client";

import { Suspense } from "react";
import { ChatView } from "@/components/chat";
import { Loader2 } from "lucide-react";

function ChatFallback() {
  return (
    <div className="flex flex-1 items-center justify-center text-[var(--kp-text-3)]">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<ChatFallback />}>
      <ChatView />
    </Suspense>
  );
}
