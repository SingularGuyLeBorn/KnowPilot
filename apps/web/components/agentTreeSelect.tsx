"use client";

/**
 * AgentTreeSelect — Chat header 的 Agent 树形下拉选择器
 *
 * 结构（按 parentId 层级嵌套）：
 *   👑 超级 Agent          ← Crown，根节点
 *     🛡️ 管理 Agent        ← ShieldCheck，缩进一级，标"由 超级Agent 创建"
 *       🤖 子 Agent        ← Bot，缩进两级，标"由 管理Agent 创建"
 *   🤖 assistant           ← 无 parentId 的普通 Agent，标"用户创建"
 *
 * 视觉沿用 KpSelect 的 portal + 定位 + 动效模式。
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, useMemo } from "react";
import ReactDOM from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, Check, ChevronDown, Crown, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AgentTreeItem {
  id: string;
  name: string;
  tier?: string;
  parentId?: string | null;
  status?: string;
}

interface TreeNode {
  item: AgentTreeItem;
  children: TreeNode[];
}

const TIER_RANK: Record<string, number> = { super: 0, manager: 1, sub: 2 };

function tierIcon(tier?: string) {
  if (tier === "super") return Crown;
  if (tier === "manager") return ShieldCheck;
  return Bot;
}

function tierIconColor(tier?: string) {
  if (tier === "super") return "text-amber-500";
  if (tier === "manager") return "text-blue-500";
  return "text-[var(--kp-brand)]";
}

/** 按 parentId 构建 Agent 树；parentId 不存在于列表的视为根节点 */
function buildAgentTree(items: AgentTreeItem[]): TreeNode[] {
  const alive = items.filter((a) => a.status !== "deleted");
  const byId = new Map(alive.map((a) => [a.id, a]));
  const childrenMap = new Map<string, AgentTreeItem[]>();
  const roots: AgentTreeItem[] = [];

  for (const a of alive) {
    if (a.parentId && byId.has(a.parentId)) {
      const list = childrenMap.get(a.parentId) ?? [];
      list.push(a);
      childrenMap.set(a.parentId, list);
    } else {
      roots.push(a);
    }
  }

  const sortAgents = (list: AgentTreeItem[]) =>
    [...list].sort(
      (x, y) =>
        (TIER_RANK[x.tier ?? "sub"] ?? 2) - (TIER_RANK[y.tier ?? "sub"] ?? 2) ||
        x.name.localeCompare(y.name, "zh-CN"),
    );

  const toNode = (item: AgentTreeItem): TreeNode => ({
    item,
    children: sortAgents(childrenMap.get(item.id) ?? []).map(toNode),
  });

  return sortAgents(roots).map(toNode);
}

/** 展平树为渲染行（带深度与创建者名） */
function flattenTree(
  nodes: TreeNode[],
  byId: Map<string, AgentTreeItem>,
  depth = 0,
): Array<{ item: AgentTreeItem; depth: number; creatorName: string | null }> {
  const rows: Array<{ item: AgentTreeItem; depth: number; creatorName: string | null }> = [];
  for (const node of nodes) {
    const creatorName = node.item.parentId ? byId.get(node.item.parentId)?.name ?? null : null;
    rows.push({ item: node.item, depth, creatorName });
    rows.push(...flattenTree(node.children, byId, depth + 1));
  }
  return rows;
}

export function AgentTreeSelect({
  value,
  agents,
  onChange,
  disabled,
  className,
  "aria-label": ariaLabel,
}: {
  value: string;
  agents: AgentTreeItem[];
  onChange: (id: string) => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listId = React.useId();
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 0 });

  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const rows = useMemo(() => flattenTree(buildAgentTree(agents), byId), [agents, byId]);
  const selected = byId.get(value);

  const updateMenuPos = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // 菜单右对齐 trigger，避免树形长名字撑出屏幕
    setMenuPos({ top: rect.bottom + 6, left: rect.right, width: rect.width });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPos();
    window.addEventListener("scroll", updateMenuPos, true);
    window.addEventListener("resize", updateMenuPos);
    return () => {
      window.removeEventListener("scroll", updateMenuPos, true);
      window.removeEventListener("resize", updateMenuPos);
    };
  }, [open, updateMenuPos]);

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
    typeof document !== "undefined" &&
    ReactDOM.createPortal(
      <AnimatePresence>
        <motion.div
          ref={menuRef}
          id={listId}
          role="listbox"
          initial={{ opacity: 0, y: -4, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, scale: 0.98 }}
          transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          style={{
            position: "fixed",
            top: menuPos.top,
            left: menuPos.left,
            transform: "translateX(-100%)",
            minWidth: Math.max(menuPos.width, 260),
            maxWidth: 360,
            zIndex: 9999,
          }}
          className="max-h-[60vh] overflow-y-auto rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] p-1 shadow-lg shadow-[rgba(45,42,38,0.08)] backdrop-blur-md"
          data-testid="agent-tree-select-menu"
        >
          {rows.map(({ item, depth, creatorName }) => {
            const active = item.id === value;
            const Icon = tierIcon(item.tier);
            return (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(item.id);
                  setOpen(false);
                }}
                style={{ paddingLeft: `${10 + depth * 16}px` }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg py-2 pr-3 text-left text-xs transition-colors",
                  active
                    ? "bg-[var(--kp-brand-soft)] font-medium text-[var(--kp-brand-dark)]"
                    : "text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)] hover:text-[var(--kp-text-1)]",
                )}
              >
                <Icon className={cn("h-3.5 w-3.5 shrink-0", tierIconColor(item.tier))} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{item.name}</span>
                  <span className="block truncate text-[10px] text-[var(--kp-text-3)]">
                    {creatorName ? `由 ${creatorName} 创建` : "用户创建"}
                    {item.status === "dormant" && " · 休眠"}
                  </span>
                </span>
                {active && <Check className="h-3.5 w-3.5 shrink-0 text-[var(--kp-brand-dark)]" />}
              </button>
            );
          })}
          {rows.length === 0 && (
            <p className="px-3 py-2 text-xs text-[var(--kp-text-3)]">暂无 Agent</p>
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
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        data-testid="agent-tree-select"
        className={cn(
          "inline-flex items-center justify-between gap-2 rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)]/80 px-2.5 py-1 text-xs text-[var(--kp-text-1)] shadow-sm outline-none transition",
          "hover:border-[var(--kp-brand-light)] focus-visible:border-[var(--kp-brand)] focus-visible:ring-2 focus-visible:ring-[var(--kp-brand)]/20",
          "disabled:cursor-not-allowed disabled:opacity-45",
          className,
        )}
      >
        {React.createElement(tierIcon(selected?.tier), {
          className: cn("h-3.5 w-3.5 shrink-0", tierIconColor(selected?.tier)),
        })}
        <span className="truncate">{selected?.name ?? "选择 Agent"}</span>
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
