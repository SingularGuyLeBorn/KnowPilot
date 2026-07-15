/**
 * W16d-3：默认 assistant 配置漂移横幅（/agents 管理页）。
 * 纯展示组件：drift 为空时渲染 null（无漂移 = 无横幅）。
 */

import { AlertTriangle } from "lucide-react";

export function AssistantDriftBanner(props: {
  agentName: string | null;
  drift: string[];
  migrationHint: string;
}) {
  if (props.drift.length === 0) return null;
  return (
    <div
      data-testid="assistant-drift-banner"
      className="flex items-start gap-2 rounded-xl border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="space-y-1">
        <div>
          <span className="font-medium">默认助手「{props.agentName ?? "assistant"}」配置漂移：</span>
          {props.drift.join("；")}。
        </div>
        <div className="text-amber-800/90 dark:text-amber-300/90">
          系统不会自动修改（W9 只读化）。修复请执行一次性迁移脚本：
          <code className="ml-1 rounded bg-amber-100 px-1 py-0.5 font-mono text-[11px] dark:bg-amber-900/60">
            {props.migrationHint}
          </code>
        </div>
      </div>
    </div>
  );
}
