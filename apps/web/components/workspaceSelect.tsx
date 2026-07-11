"use client";

/**
 * WorkspaceSelect — Chat 左侧栏顶部的 Workspace 切换器
 *
 * 列出所有 active Workspace，系统 Workspace 置顶。
 * 切换时通知父组件，由父组件负责加载该 Workspace 的 Agent/Session。
 */

import { useState, useRef, useEffect, useMemo } from "react";
import ReactDOM from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Crown, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";

export interface WorkspaceItem {
  id: string;
  name: string;
  isSystem?: boolean;
  systemType?: string | null;
}

interface WorkspaceSelectProps {
  value: string | null;
  workspaces: WorkspaceItem[];
  onChange: (id: string) => void;
  disabled?: boolean;
  className?: string;
}

export function WorkspaceSelect({
  value,
  workspaces,
  onChange,
  disabled,
  className,
}: WorkspaceSelectProps) {
  const [open, setOpen] = useState(false);
  const [mounted] = useState(() => typeof document !== "undefined");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 0 });

  const sortedWorkspaces = useMemo(() => {
    return [...workspaces].sort((a, b) => {
      if (a.isSystem && !b.isSystem) return -1;
      if (!a.isSystem && b.isSystem) return 1;
      return a.name.localeCompare(b.name, "zh-CN");
    });
  }, [workspaces]);

  const selected = useMemo(
    () => sortedWorkspaces.find((w) => w.id === value) ?? sortedWorkspaces[0],
    [sortedWorkspaces, value],
  );

  useEffect(() => {
    if (!open) return;
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 6, left: rect.left, width: rect.width });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const menu =
    open &&
    mounted &&
    ReactDOM.createPortal(
      <AnimatePresence>
        <motion.div
          ref={menuRef}
          initial={{ opacity: 0, y: -4, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, scale: 0.98 }}
          transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          style={{
            position: "fixed",
            top: menuPos.top,
            left: menuPos.left,
            width: menuPos.width,
            zIndex: 9999,
          }}
          className="max-h-[60vh] overflow-y-auto rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] p-1 shadow-lg shadow-[rgba(45,42,38,0.08)] backdrop-blur-md"
          data-testid="workspace-select-menu"
        >
          {sortedWorkspaces.map((ws) => {
            const active = ws.id === selected?.id;
            const Icon = ws.isSystem ? Crown : FolderOpen;
            const iconColor = ws.isSystem ? "text-amber-500" : "text-amber-500";
            return (
              <button
                key={ws.id}
                type="button"
                onClick={() => {
                  onChange(ws.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors",
                  active
                    ? "bg-[var(--kp-brand-soft)] font-medium text-[var(--kp-brand-deep)]"
                    : "text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-text-1)]",
                )}
              >
                <Icon className={cn("h-3.5 w-3.5 shrink-0", iconColor)} />
                <span className="min-w-0 flex-1 truncate">{ws.name}</span>
                {active && <Check className="h-3.5 w-3.5 shrink-0 text-[var(--kp-brand-deep)]" />}
              </button>
            );
          })}
          {sortedWorkspaces.length === 0 && (
            <p className="px-3 py-2 text-xs text-[var(--kp-text-3)]">暂无 Workspace</p>
          )}
        </motion.div>
      </AnimatePresence>,
      document.body,
    );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        data-testid="workspace-select"
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)]/80 px-3 py-2 text-left text-xs text-[var(--kp-text-1)] shadow-sm outline-none transition",
          "hover:border-[var(--kp-brand-light)] focus-visible:border-[var(--kp-brand)] focus-visible:ring-2 focus-visible:ring-[var(--kp-brand)]/20",
          "disabled:cursor-not-allowed disabled:opacity-45",
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected?.isSystem ? (
            <Crown className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          ) : (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          )}
          <span className="truncate font-medium">{selected?.name ?? "选择 Workspace"}</span>
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-[var(--kp-text-3)] transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>
      {menu}
    </>
  );
}
