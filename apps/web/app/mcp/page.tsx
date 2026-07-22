/**
 * MCP 服务器配置页面 (L2 智能工作台)
 */

"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { Cpu, Plus, Terminal } from "lucide-react";
import Link from "next/link";
import type { McpServer } from "@knowpilot/shared";
import { useMcp, useCardDensity } from "@/lib/hooks";
import { EmptyState, LoadingState, ConfirmDialog, PageHeader } from "@/components/shared";

export default function McpPage() {
  const { useList, useCreate, useDelete } = useMcp();
  const { density } = useCardDensity();
  const [page] = useState(1);
  const { data, isLoading } = useList({ page, pageSize: 12 });
  const createMutation = useCreate();
  const deleteMutation = useDelete();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const handleCreateDemo = () => {
    createMutation.mutate({
      name: `filesystem_${Math.random().toString(36).substring(2, 6)}`,
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "D:\\ALL IN AI\\KnowPilot"],
      env: {},
      headers: {},
      enabled: true,
    });
  };

  const confirmDelete = () => {
    if (deleteId) {
      deleteMutation.mutate({ id: deleteId });
      setDeleteId(null);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--kp-bg)] p-6 md:p-8 space-y-6">
      <PageHeader
        icon={Cpu}
        title="MCP 服务器接入"
        description="Model Context Protocol (MCP) 让智能体安全、标准地读取本地数据源（如本地文件系统、数据库或外部 API 终端）。"
        action={{ label: "接入 MCP 服务", onClick: handleCreateDemo, icon: Plus }}
        showDensityToggle
      />

      {isLoading ? (
        <LoadingState count={3} />
      ) : !data?.items || data.items.length === 0 ? (
        <EmptyState
          title="无运行中的 MCP 连接"
          description="目前还没有接入任何外部数据连接器。大模型暂时无法读取你的本地磁盘。点击下方按钮添加本地文件服务。"
          actionLabel="添加本地文件连接器"
          onAction={handleCreateDemo}
        />
      ) : (
        <div className={cn("grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] ", density === "compact" ? "gap-4" : "gap-6")}>
          {data.items.map((server: McpServer, idx: number) => (
            <motion.div
              key={server.id}
              initial={{ opacity: 0, y: 15 }}
              animate={{ 
                opacity: 1, 
                y: 0,
                transition: { delay: idx * 0.05, type: "spring", stiffness: 200, damping: 20 }
              }}
              className={cn("kp-card-premium kp-lift group relative overflow-hidden rounded-2xl flex flex-col justify-between", density === "compact" ? "p-3" : "p-5")}
            >
              <div className="flex justify-between items-start gap-4 mb-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]">
                    <Cpu className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-[var(--kp-text-1)] group-hover:text-[var(--kp-brand-deep)] transition-colors text-sm">
                      {server.name}
                    </h3>
                    <span className="text-[10px] text-[var(--kp-text-3)] font-mono">
                      {(server.transport ?? "stdio") === "http" ? "远程 HTTP" : "本地 Stdio"}
                    </span>
                  </div>
                </div>
                
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Link
                    href={`/mcp/edit/${server.id}`}
                    className="text-xs text-[var(--kp-brand-deep)] hover:text-[var(--kp-brand-deep)] px-2 py-0.5 rounded hover:bg-[var(--kp-brand-soft)]"
                  >
                    编辑
                  </Link>
                  <button
                    onClick={() => setDeleteId(server.id)}
                    className="text-xs text-red-500 hover:text-red-600 transition-opacity px-2 py-0.5 rounded hover:bg-red-500/10"
                  >
                    卸载
                  </button>
                </div>
              </div>

              <div className="space-y-1 mb-4">
                <div className="text-[9px] uppercase font-bold text-[var(--kp-text-3)]">
                  {(server.transport ?? "stdio") === "http" ? "URL" : "命令"}
                </div>
                <code className="text-[11px] block p-2 rounded-lg bg-[var(--kp-bg-mute)] font-mono text-[var(--kp-text-2)] truncate">
                  {(server.transport ?? "stdio") === "http"
                    ? server.url || "（未配置 url）"
                    : `${server.command} ${server.args?.join(" ") ?? ""}`}
                </code>
              </div>

              <div className="flex items-center justify-between border-t border-[var(--kp-divider-light)] pt-3 text-[10px] text-[var(--kp-text-3)]">
                <span className="flex items-center gap-1">
                  <Terminal className="w-3 h-3 text-[var(--kp-brand-deep)]" />
                  {(server.transport ?? "stdio") === "http" ? "Streamable HTTP" : "Stdio"}
                </span>
                <span className={cn("kp-badge", server.enabled ? "kp-badge-success" : "")}>
                  {server.enabled ? "已连接" : "已断开"}
                </span>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <ConfirmDialog
        isOpen={deleteId !== null}
        title="移除 MCP 服务"
        description="确定要断开并移除该 MCP 外部服务配置吗？这会导致 Agent 失去对该外部数据源的读写能力。"
        isDestructive={true}
        confirmLabel="确认移除"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
