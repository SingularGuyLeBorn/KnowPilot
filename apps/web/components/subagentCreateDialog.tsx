"use client";

/**
 * 创建子代理任务弹窗 — 选择 Agent + 任务描述 + 模型，提交后启动 subagent
 */

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, Loader2, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { KpSelect } from "@/components/shared";
import { PRIMARY_CHAT_MODELS } from "@knowpilot/shared";

export function SubagentCreateDialog({
  open,
  parentSessionId,
  onClose,
  onCreated,
}: {
  open: boolean;
  parentSessionId?: string;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const utils = trpc.useUtils();
  const agentsQuery = trpc.agent.list.useQuery({ page: 1, pageSize: 50 });
  const spawnMut = trpc.session.spawn.useMutation({
    onSuccess: () => {
      void utils.session.list.invalidate();
      void utils.session.listChildren.invalidate();
      onCreated?.();
      onClose();
    },
  });

  const agents = (agentsQuery.data?.items as any[]) ?? [];
  const [agentId, setAgentId] = useState<string>("");
  const [task, setTask] = useState("");
  const [model, setModel] = useState<string>("");

  useEffect(() => {
    if (open && !agentId && agents[0]) setAgentId(agents[0].id);
  }, [open, agents, agentId]);

  useEffect(() => {
    if (!open) {
      setTask("");
      setModel("");
      spawnMut.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSubmit = () => {
    const trimmed = task.trim();
    if (!trimmed || !parentSessionId || !agentId) return;
    spawnMut.mutate({
      parentSessionId,
      agentId,
      task: trimmed,
      model: model || undefined,
    });
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="w-[420px] max-w-[92vw] rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] p-5 shadow-xl"
            initial={{ scale: 0.96, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0, y: 8 }}
            transition={{ type: "spring", stiffness: 300, damping: 26 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--kp-brand-soft)] text-[var(--kp-brand-dark)]">
                <Bot className="h-4 w-4" />
              </span>
              <h2 className="text-sm font-bold text-[var(--kp-text-1)]">新建子代理任务</h2>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--kp-text-2)]">Agent</label>
                <KpSelect
                  value={agentId}
                  onChange={setAgentId}
                  options={agents.map((a) => ({ value: a.id, label: a.name }))}
                  variant="capsule"
                  size="sm"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--kp-text-2)]">任务描述</label>
                <textarea
                  value={task}
                  onChange={(e) => setTask(e.target.value)}
                  rows={4}
                  autoFocus
                  placeholder="例如：搜索 KnowPilot 并整理成 200 字摘要"
                  className="w-full resize-none rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-3 py-2 text-xs leading-relaxed text-[var(--kp-text-1)] outline-none focus:border-[var(--kp-brand)]"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--kp-text-2)]">模型（可选）</label>
                <KpSelect
                  value={model}
                  onChange={setModel}
                  options={PRIMARY_CHAT_MODELS.map((m) => ({ value: m.id, label: m.label }))}
                  variant="capsule"
                  size="sm"
                />
              </div>

              {spawnMut.isError && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-[11px] text-red-600">
                  {spawnMut.error?.message ?? "创建失败"}
                </p>
              )}
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-xs")}
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!task.trim() || !agentId || spawnMut.isPending}
                className={cn(
                  buttonVariants({ size: "sm" }),
                  "gap-1.5 bg-[var(--kp-brand)] text-xs text-white hover:bg-[var(--kp-brand-dark)]",
                )}
              >
                {spawnMut.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                创建并运行
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
