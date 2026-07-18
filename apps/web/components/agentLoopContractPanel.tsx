"use client";

import { Loader2, Lock, Unlock } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** 超级 Agent 心跳 Loop Contract 控制平面（只在编辑页、已开心跳时展示） */
export function AgentLoopContractPanel({ agentId }: { agentId: string }) {
  const utils = trpc.useUtils();
  const { data: contract, isLoading, isError } = trpc.agent.getLoopContract.useQuery(
    { agentId },
    { enabled: !!agentId, refetchInterval: 15_000 },
  );
  const resumeMut = trpc.agent.resumeLoopContract.useMutation({
    onSuccess: () => void utils.agent.getLoopContract.invalidate({ agentId }),
  });
  const closeMut = trpc.agent.closeLoopGate.useMutation({
    onSuccess: () => void utils.agent.getLoopContract.invalidate({ agentId }),
  });

  if (isLoading) {
    return (
      <div className="rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] p-3 text-[11px] text-[var(--kp-text-3)]">
        加载 Loop Contract…
      </div>
    );
  }

  if (isError || !contract) {
    return (
      <div className="rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] p-3 text-[11px] text-[var(--kp-text-3)]">
        当前 Agent 无 Loop Contract（通常仅超级 Agent 心跳启用）。
      </div>
    );
  }

  return (
    <div
      className="space-y-2 rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] p-3"
      data-testid="agent-loop-contract"
    >
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="font-medium text-[var(--kp-text-1)]">Loop Contract</span>
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[9px] font-semibold",
            contract.gateOpen ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800",
          )}
        >
          {contract.gateOpen ? "gate 开" : "gate 关"}
        </span>
        <span className="text-[var(--kp-text-3)]">
          handoff {contract.handoff ? "开" : "关"} · stale {contract.staleRounds}/
          {contract.stopRule.maxStaleRounds}
        </span>
      </div>
      {contract.stoppedReason && (
        <p className="text-[10px] text-amber-800">停止原因：{contract.stoppedReason}</p>
      )}
      {contract.evidence?.length > 0 && (
        <ul className="max-h-24 space-y-1 overflow-y-auto text-[10px] text-[var(--kp-text-2)]">
          {[...contract.evidence].slice(-5).reverse().map((e, i) => (
            <li key={`${e.at}-${i}`} className="truncate rounded bg-[var(--kp-bg-mute)] px-2 py-1">
              {e.status} · {e.summary}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={resumeMut.isPending || contract.gateOpen}
          onClick={() => resumeMut.mutate({ agentId })}
          className="h-7 gap-1 text-[11px]"
        >
          {resumeMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unlock className="h-3 w-3" />}
          恢复 gate
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={closeMut.isPending || !contract.gateOpen}
          onClick={() => closeMut.mutate({ agentId, reason: "管理页手动关闭" })}
          className="h-7 gap-1 text-[11px]"
        >
          {closeMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Lock className="h-3 w-3" />}
          关闭 gate
        </Button>
      </div>
    </div>
  );
}
