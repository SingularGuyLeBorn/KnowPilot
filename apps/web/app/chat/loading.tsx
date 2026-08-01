/**
 * Chat 路由专用 loading 骨架：全高居中 spinner，
 * 避免根 RouteLoading 的 grid-card 骨架在 chat 布局下闪现错位。
 */
import { Loader2 } from "lucide-react";

export default function ChatLoading() {
  return (
    <div className="flex flex-1 items-center justify-center" role="status" aria-label="对话加载中">
      <Loader2 className="h-6 w-6 animate-spin text-[var(--kp-text-3)]" />
    </div>
  );
}
