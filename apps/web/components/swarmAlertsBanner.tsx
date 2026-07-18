/**
 * /agents 列表顶栏：全仓 Swarm 轻量告警（ask_user / 熔断 / inbox）。
 * needsAttention=false → 渲染 null。
 */

import Link from "next/link";
import { Radar } from "lucide-react";

export function SwarmAlertsBanner(props: {
  askUserPendingCount: number;
  askUserSamples: Array<{ askId: string; sessionId: string; question: string }>;
  suspendedAgents: Array<{ id: string; name: string }>;
  highInboxAgents: Array<{ id: string; name: string; pending: number }>;
  needsAttention: boolean;
}) {
  if (!props.needsAttention) return null;

  const bits: string[] = [];
  if (props.askUserPendingCount > 0) {
    bits.push(`${props.askUserPendingCount} 个 ask_user 待答复`);
  }
  if (props.suspendedAgents.length > 0) {
    bits.push(
      `${props.suspendedAgents.length} 个 Agent 心跳熔断（${props.suspendedAgents
        .slice(0, 2)
        .map((a) => a.name)
        .join("、")}${props.suspendedAgents.length > 2 ? "…" : ""}）`,
    );
  }
  if (props.highInboxAgents.length > 0) {
    bits.push(
      `inbox 积压：${props.highInboxAgents
        .slice(0, 2)
        .map((a) => `${a.name}(${a.pending})`)
        .join("、")}`,
    );
  }

  return (
    <div
      data-testid="swarm-alerts-banner"
      className="flex items-start gap-2 rounded-xl border border-sky-300/70 bg-sky-50 px-3 py-2 text-xs text-sky-950 dark:border-sky-500/40 dark:bg-sky-950/40 dark:text-sky-100"
    >
      <Radar className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0 space-y-1">
        <div>
          <span className="font-medium">Swarm 告警：</span>
          {bits.join("；")}。
        </div>
        {props.askUserSamples.length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-sky-900/90 dark:text-sky-200/90">
            {props.askUserSamples.slice(0, 3).map((s) => (
              <Link
                key={s.askId}
                href={`/chat?sessionId=${s.sessionId}`}
                className="truncate underline-offset-2 hover:underline"
              >
                去答复：{s.question.slice(0, 40)}
                {s.question.length > 40 ? "…" : ""}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
