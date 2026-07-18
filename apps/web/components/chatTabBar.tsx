"use client";

/**
 * Chat 标签栏 —— VS Code 风格：横向 tabs + 分屏/取消分屏。
 */

import { Columns2, PanelLeftClose, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatTabsLayout, ChatTabsState } from "@/lib/chatTabsState";

export interface ChatTabBarItem {
  id: string;
  title: string;
}

export interface ChatTabBarProps {
  tabs: ChatTabsState;
  items: ChatTabBarItem[];
  onFocusTab: (sessionId: string) => void;
  onCloseTab: (sessionId: string) => void;
  onEnterSplit: () => void;
  onExitSplit: () => void;
  canEnterSplit: boolean;
}

export function ChatTabBar({
  tabs,
  items,
  onFocusTab,
  onCloseTab,
  onEnterSplit,
  onExitSplit,
  canEnterSplit,
}: ChatTabBarProps) {
  const focusedId =
    tabs.focusedPane === "secondary" ? tabs.secondarySessionId : tabs.primarySessionId;
  const visibleSecondary =
    tabs.layout === "split" ? tabs.secondarySessionId : null;

  const byId = new Map(items.map((i) => [i.id, i]));
  const ordered = tabs.openTabIds
    .map((id) => byId.get(id) ?? { id, title: "新对话" })
    .filter(Boolean);

  return (
    <div
      className="flex h-9 shrink-0 items-center gap-1 border-b border-[var(--kp-divider)] bg-[var(--kp-bg-soft)] px-1"
      data-testid="chat-tab-bar"
    >
      <div className="flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto">
        {ordered.length === 0 ? (
          <div className="flex items-center px-3 text-[11px] text-[var(--kp-text-3)]">
            新对话
          </div>
        ) : (
          ordered.map((item) => {
            const isFocused = item.id === focusedId;
            const isVisibleOther = item.id === visibleSecondary || (
              tabs.layout === "split" && item.id === tabs.primarySessionId && !isFocused
            );
            return (
              <div
                key={item.id}
                className={cn(
                  "group flex max-w-[180px] shrink-0 items-center gap-1 border-r border-[var(--kp-divider-light)] px-2 text-[11px]",
                  isFocused
                    ? "bg-[var(--kp-bg)] font-medium text-[var(--kp-text-1)]"
                    : isVisibleOther
                      ? "bg-[var(--kp-bg)]/60 text-[var(--kp-text-2)]"
                      : "text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)]",
                )}
                data-testid="chat-tab"
                data-session-id={item.id}
                data-focused={isFocused ? "true" : "false"}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate py-1.5 text-left"
                  onClick={() => onFocusTab(item.id)}
                  onMouseDown={(e) => {
                    if (e.button === 1) {
                      e.preventDefault();
                      onCloseTab(item.id);
                    }
                  }}
                  title={item.title}
                >
                  {item.title}
                </button>
                <button
                  type="button"
                  className="shrink-0 rounded p-0.5 opacity-0 hover:bg-[var(--kp-bg-mute)] group-hover:opacity-100"
                  aria-label={`关闭 ${item.title}`}
                  data-testid="chat-tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(item.id);
                  }}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5 pr-1">
        {tabs.layout === "split" ? (
          <button
            type="button"
            className="rounded p-1.5 text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)]"
            title="取消分屏"
            aria-label="取消分屏"
            data-testid="chat-exit-split"
            onClick={onExitSplit}
          >
            <PanelLeftClose className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            type="button"
            className={cn(
              "rounded p-1.5 text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)]",
              !canEnterSplit && "cursor-not-allowed opacity-40",
            )}
            title={canEnterSplit ? "分屏显示" : "至少打开两个会话才能分屏"}
            aria-label="分屏显示"
            data-testid="chat-enter-split"
            disabled={!canEnterSplit}
            onClick={onEnterSplit}
          >
            <Columns2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

export type { ChatTabsLayout };
