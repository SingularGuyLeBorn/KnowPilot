/**
 * Logs 运行日志审计页面 (L3 系统与运维)
 *
 * 实现了日志级别（INFO, WARN, ERROR, SUCCESS）动态过滤和一键清空日志库的完整数据链路。
 */

"use client";

import React, { useState } from "react";
import { ScrollText, Trash2, Filter } from "lucide-react";
import { useLog } from "@/lib/hooks";
import { EmptyState, LoadingState, ConfirmDialog, PageHeader } from "@/components/shared";
import { trpc } from "@/lib/trpc";

interface LogEntry {
  id: string;
  level: string;
  component: string;
  event: string;
  message: string;
  createdAt: string | Date;
}

export default function LogsPage() {
  const { useList } = useLog();
  const [page, setPage] = useState(1);
  const [level, setLevel] = useState<string>("");
  
  // 动态数据获取
  const { data, isLoading, refetch } = useList({ page, pageSize: 50, level: level || undefined });

  // 清空日志 Mutation
  const clearAllMutation = trpc.log.clearAll.useMutation({
    onSuccess: () => {
      refetch();
    }
  });

  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);

  const handleClearAll = () => {
    setIsClearConfirmOpen(true);
  };

  const confirmClear = () => {
    clearAllMutation.mutate();
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--kp-bg)] p-6 md:p-8 space-y-6">
      <PageHeader
        icon={ScrollText}
        title="控制台与系统日志"
        description="审计智能代理运行状况、外部 MCP 调用细节和触发器执行记录。日志信息专为 AI 和开发调试设计，精准记录每一个微服务轨迹。"
        action={{ label: clearAllMutation.isPending ? "正在清理..." : "清空全部日志", onClick: handleClearAll, icon: Trash2, disabled: clearAllMutation.isPending }}
      />

      {/* 筛选菜单 */}
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-xs font-bold uppercase tracking-wider text-[var(--kp-text-3)] flex items-center gap-1">
          <Filter className="w-3.5 h-3.5" />
          级别过滤
        </span>
        {["", "info", "success", "warn", "error"].map((lvl) => (
          <button
            key={lvl}
            type="button"
            onClick={() => { setLevel(lvl); setPage(1); }}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all ${
              level === lvl
                ? "border-[var(--kp-brand)] bg-[var(--kp-brand-deep)] text-white shadow-sm"
                : "border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] text-[var(--kp-text-2)] hover:border-[var(--kp-brand-light)] hover:bg-[var(--kp-bg-soft)]"
            }`}
          >
            {lvl === "" ? "全部" : lvl.toUpperCase()}
          </button>
        ))}
      </div>

      {/* 日志展现表格 */}
      {isLoading ? (
        <LoadingState count={5} />
      ) : !data?.items || data.items.length === 0 ? (
        <EmptyState
          title="日志库空置"
          description="目前没有任何系统执行痕迹。所有的 tRPC 变更操作（如创建文章、上传文件等）都会被自动记录日志。"
        />
      ) : (
        <div className="kp-card-premium overflow-hidden rounded-2xl">
          <div className="overflow-x-auto">
            <table className="kp-table">
              <thead>
                <tr>
                  <th className="w-28">级别</th>
                  <th className="w-32">组件</th>
                  <th className="w-36">事件</th>
                  <th>日志信息</th>
                  <th className="w-40 text-right">时间戳</th>
                </tr>
              </thead>
              <tbody className="font-mono text-[11px]">
                {data.items.map((log: LogEntry) => {
                  const levelKey = log.level.toLowerCase();
                  const levelBadge: Record<string, string> = {
                    info: "kp-badge-info",
                    success: "kp-badge-success",
                    warn: "kp-badge-warning",
                    error: "kp-badge-danger",
                    debug: "kp-badge",
                  };
                  return (
                    <tr key={log.id}>
                      <td>
                        <span className={levelBadge[levelKey] ?? "kp-badge"}>
                          {log.level.toUpperCase()}
                        </span>
                      </td>
                      <td className="text-[var(--kp-text-2)]">{log.component}</td>
                      <td className="text-[var(--kp-brand-deep)]">{log.event}</td>
                      <td className="text-[var(--kp-text-1)] truncate max-w-xs md:max-w-md" title={log.message}>
                        {log.message}
                      </td>
                      <td className="text-right text-[var(--kp-text-3)]">
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={isClearConfirmOpen}
        title="清空运行日志"
        description="确定要彻底清空历史数据库中的所有日志信息吗？清空后控制台的历史事件和 AI 轨迹将无法找回。"
        isDestructive={true}
        confirmLabel="确认清空"
        onConfirm={confirmClear}
        onCancel={() => setIsClearConfirmOpen(false)}
      />
    </div>
  );
}
