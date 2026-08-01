"use client";

/**
 * session_rotate 血缘链 / 图 —— 管理页派生视图。
 * 数据只读 session.rotateGraph（rotatedFrom/rotatedTo），不另造协议。
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ExternalLink, GitBranch } from "lucide-react";
import { trpc, catchUnlessCancelled } from "@/lib/trpc";
import { cn, formatRelativeTime } from "@/lib/utils";
import { EmptyState, LoadingState } from "@/components/shared";
import { UI_STATE_CHANNEL } from "@/lib/uiStateChannel";
import { toPascalCaseId } from "@/lib/toolDisplayName";

const NODE_W = 148;
const NODE_H = 52;
const GAP_X = 36;
const GAP_Y = 28;
const PAD = 24;

function nodeLabel(n: { autoName?: string | null; title: string }): string {
  return (n.autoName || n.title || "会话").slice(0, 18);
}

const STATUS_DOT: Record<string, string> = {
  active: "bg-emerald-500",
  running: "bg-sky-500",
  archived: "bg-[var(--kp-text-3)]",
  paused: "bg-amber-500",
  completed: "bg-emerald-600",
  failed: "bg-red-500",
  deleted: "bg-red-400",
};

export function SessionRotateLineageView() {
  const utils = trpc.useUtils();
  // 推拉：PUSH=session_list_changed（SSE→BC）；PULL=15s 兜底（无 Chat 开着也能动）
  const { data, isLoading, error } = trpc.session.rotateGraph.useQuery(
    { limit: 300 },
    { refetchInterval: 15_000 },
  );
  const [selectedRootId, setSelectedRootId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    let bc: BroadcastChannel;
    try {
      bc = new BroadcastChannel(UI_STATE_CHANNEL);
    } catch {
      return;
    }
    const onMsg = (ev: MessageEvent) => {
      const t = (ev.data as { type?: string } | null)?.type;
      if (t !== "session_list_changed" && t !== "cron_session_started") return;
      utils.session.rotateGraph.invalidate().catch(catchUnlessCancelled("components/sessionRotateLineageView.tsx"));
    };
    bc.addEventListener("message", onMsg);
    return () => {
      bc.removeEventListener("message", onMsg);
      bc.close();
    };
  }, [utils]);

  const byId = useMemo(() => {
    type Node = NonNullable<typeof data>["nodes"][number];
    const m = new Map<string, Node>();
    for (const n of data?.nodes ?? []) m.set(n.id, n);
    return m;
  }, [data?.nodes]);

  const chains = useMemo(() => data?.chains ?? [], [data?.chains]);
  const activeRoot = selectedRootId ?? chains[0]?.rootId ?? null;
  const activeChain = chains.find((c) => c.rootId === activeRoot) ?? null;

  const layout = useMemo(() => {
    if (!activeChain) return null;
    const nodes = activeChain.nodeIds
      .map((id) => byId.get(id))
      .filter((n): n is NonNullable<typeof n> => !!n);
    const width = PAD * 2 + nodes.length * NODE_W + Math.max(0, nodes.length - 1) * GAP_X;
    const height = PAD * 2 + NODE_H;
    const positions = nodes.map((n, i) => ({
      node: n,
      x: PAD + i * (NODE_W + GAP_X),
      y: PAD,
    }));
    return { width, height, positions, nodes };
  }, [activeChain, byId]);

  /** 全景：多链纵向排布的轻量总图 */
  const panorama = useMemo(() => {
    if (!data || chains.length === 0) return null;
    const maxLen = Math.max(...chains.map((c) => c.nodeIds.length), 1);
    const rowH = NODE_H + GAP_Y;
    const width = PAD * 2 + maxLen * NODE_W + Math.max(0, maxLen - 1) * GAP_X;
    const height = PAD * 2 + chains.length * NODE_H + Math.max(0, chains.length - 1) * GAP_Y;
    const rows = chains.map((chain, row) => {
      const nodes = chain.nodeIds
        .map((id) => byId.get(id))
        .filter((n): n is NonNullable<typeof n> => !!n);
      return {
        chain,
        y: PAD + row * rowH,
        nodes: nodes.map((n, i) => ({
          node: n,
          x: PAD + i * (NODE_W + GAP_X),
        })),
      };
    });
    return { width, height, rows };
  }, [data, chains, byId]);

  if (isLoading) return <LoadingState count={4} />;
  if (error) {
    return (
      <EmptyState
        icon={<GitBranch className="h-6 w-6 opacity-50" />}
        title="血缘图加载失败"
        description={error.message}
      />
    );
  }
  if (!data || chains.length === 0) {
    return (
      <EmptyState
        icon={<GitBranch className="h-6 w-6 opacity-50" />}
        title="暂无会话轮换血缘"
        description="Agent 调用 SessionRotate 后，会在此只读展示 RotatedFrom / RotatedTo 链与图。"
      />
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]" data-testid="session-rotate-lineage-view">
      {/* 链列表 */}
      <aside className="kp-card-premium flex max-h-[70vh] flex-col overflow-hidden rounded-2xl">
        <div className="border-b border-[var(--kp-divider)] px-4 py-3">
          <p className="text-sm font-semibold text-[var(--kp-text-1)]">轮换链</p>
          <p className="mt-0.5 text-[11px] text-[var(--kp-text-3)]">
            {chains.length} 条 · {data.nodes.length} 节点 · {data.edges.length} 边
          </p>
        </div>
        <ul className="flex-1 overflow-y-auto p-2">
          {chains.map((chain) => {
            const tip = byId.get(chain.nodeIds[chain.nodeIds.length - 1]!);
            const root = byId.get(chain.rootId);
            const active = chain.rootId === activeRoot;
            return (
              <li key={chain.rootId}>
                <button
                  type="button"
                  onClick={() => setSelectedRootId(chain.rootId)}
                  className={cn(
                    "flex w-full flex-col gap-0.5 rounded-xl px-3 py-2.5 text-left transition-colors",
                    active
                      ? "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]"
                      : "hover:bg-[var(--kp-bg-mute)] text-[var(--kp-text-1)]",
                  )}
                >
                  <span className="truncate text-sm font-medium">
                    {tip ? nodeLabel(tip) : chain.rootId.slice(0, 8)}
                  </span>
                  <span className="truncate text-[11px] text-[var(--kp-text-3)]">
                    {chain.nodeIds.length} 节
                    {root ? ` · 自 ${nodeLabel(root)}` : ""}
                    {tip?.agentName ? ` · ${tip.agentName}` : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <div className="flex min-w-0 flex-col gap-4">
        {/* 当前链放大 */}
        <section className="kp-card-premium overflow-hidden rounded-2xl p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-[var(--kp-text-1)]">当前链</h2>
              <p className="text-[11px] text-[var(--kp-text-3)]">
                点击节点打开 Chat；边来自 rotatedFrom ↔ rotatedTo
              </p>
            </div>
            {activeChain && layout?.nodes[layout.nodes.length - 1] && (
              <Link
                href={`/chat?sessionId=${layout.nodes[layout.nodes.length - 1]!.id}`}
                className="inline-flex items-center gap-1 text-xs font-medium text-[var(--kp-brand-deep)] hover:underline"
              >
                打开尖端会话
                <ExternalLink className="h-3 w-3" />
              </Link>
            )}
          </div>
          {layout && (
            <div className="overflow-x-auto">
              <svg
                width={layout.width}
                height={layout.height}
                viewBox={`0 0 ${layout.width} ${layout.height}`}
                className="min-w-full"
                role="img"
                aria-label="当前轮换链图"
              >
                {layout.positions.slice(0, -1).map((p, i) => {
                  const next = layout.positions[i + 1]!;
                  const x1 = p.x + NODE_W;
                  const y1 = p.y + NODE_H / 2;
                  const x2 = next.x;
                  const y2 = next.y + NODE_H / 2;
                  return (
                    <line
                      key={`${p.node.id}-${next.node.id}`}
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke="var(--kp-brand)"
                      strokeOpacity={0.45}
                      strokeWidth={2}
                      markerEnd="url(#rotate-arrow)"
                    />
                  );
                })}
                <defs>
                  <marker
                    id="rotate-arrow"
                    markerWidth="8"
                    markerHeight="8"
                    refX="6"
                    refY="3"
                    orient="auto"
                  >
                    <path d="M0,0 L6,3 L0,6 Z" fill="var(--kp-brand)" fillOpacity={0.6} />
                  </marker>
                </defs>
                {layout.positions.map(({ node: n, x, y }, i) => {
                  const tip = i === layout.positions.length - 1;
                  return (
                    <g key={n.id}>
                      <motion.rect
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.04, type: "spring", stiffness: 260, damping: 26 }}
                        x={x}
                        y={y}
                        width={NODE_W}
                        height={NODE_H}
                        rx={12}
                        fill={tip ? "var(--kp-brand-soft)" : "var(--kp-bg-mute)"}
                        stroke={tip ? "var(--kp-brand)" : "var(--kp-divider)"}
                        strokeWidth={tip ? 1.5 : 1}
                      />
                      <a href={`/chat?sessionId=${n.id}`}>
                        <title>{n.autoName || n.title}</title>
                        <text
                          x={x + 12}
                          y={y + 22}
                          className="fill-[var(--kp-text-1)]"
                          style={{ fontSize: 12, fontWeight: 600 }}
                        >
                          {nodeLabel(n)}
                        </text>
                        <text
                          x={x + 12}
                          y={y + 40}
                          className="fill-[var(--kp-text-3)]"
                          style={{ fontSize: 10 }}
                        >
                          {toPascalCaseId(n.status)}
                          {n.agentName ? ` · ${n.agentName.slice(0, 8)}` : ""}
                        </text>
                      </a>
                    </g>
                  );
                })}
              </svg>
            </div>
          )}
          {activeChain && (
            <ol className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--kp-text-2)]">
              {activeChain.nodeIds.map((id, i) => {
                const n = byId.get(id);
                if (!n) return null;
                return (
                  <li key={id} className="inline-flex items-center gap-1.5">
                    {i > 0 && <span className="text-[var(--kp-text-3)]">→</span>}
                    <Link
                      href={`/chat?sessionId=${id}`}
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-[var(--kp-brand-soft)] hover:text-[var(--kp-brand-deep)]"
                    >
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          STATUS_DOT[n.status] ?? "bg-[var(--kp-text-3)]",
                        )}
                      />
                      {nodeLabel(n)}
                      <span className="text-[var(--kp-text-3)]">
                        {formatRelativeTime(n.createdAt)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {/* 全景图 */}
        {panorama && (
          <section className="kp-card-premium overflow-hidden rounded-2xl p-4">
            <div className="mb-3">
              <h2 className="text-sm font-bold text-[var(--kp-text-1)]">全景图</h2>
              <p className="text-[11px] text-[var(--kp-text-3)]">
                每行一条轮换链；高亮行为左侧选中项
              </p>
            </div>
            <div className="overflow-auto">
              <svg
                width={panorama.width}
                height={Math.min(panorama.height, 480)}
                viewBox={`0 0 ${panorama.width} ${panorama.height}`}
                className="max-h-[480px]"
                role="img"
                aria-label="会话轮换全景图"
                data-testid="session-rotate-panorama"
              >
                <defs>
                  <marker
                    id="rotate-arrow-pan"
                    markerWidth="7"
                    markerHeight="7"
                    refX="5"
                    refY="2.5"
                    orient="auto"
                  >
                    <path d="M0,0 L5,2.5 L0,5 Z" fill="var(--kp-text-3)" />
                  </marker>
                </defs>
                {panorama.rows.map(({ chain, y, nodes }) => {
                  const selected = chain.rootId === activeRoot;
                  return (
                    <g
                      key={chain.rootId}
                      style={{ cursor: "pointer" }}
                      onClick={() => setSelectedRootId(chain.rootId)}
                    >
                      {nodes.slice(0, -1).map((p, i) => {
                        const next = nodes[i + 1]!;
                        return (
                          <line
                            key={`${p.node.id}-${next.node.id}`}
                            x1={p.x + NODE_W}
                            y1={y + NODE_H / 2}
                            x2={next.x}
                            y2={y + NODE_H / 2}
                            stroke={selected ? "var(--kp-brand)" : "var(--kp-divider)"}
                            strokeWidth={selected ? 2 : 1.5}
                            markerEnd="url(#rotate-arrow-pan)"
                          />
                        );
                      })}
                      {nodes.map(({ node: n, x }) => (
                        <g key={n.id}>
                          <rect
                            x={x}
                            y={y}
                            width={NODE_W}
                            height={NODE_H}
                            rx={10}
                            fill={
                              selected
                                ? "var(--kp-brand-soft)"
                                : "color-mix(in srgb, var(--kp-bg) 88%, var(--kp-bg-mute))"
                            }
                            stroke={selected ? "var(--kp-brand)" : "var(--kp-divider)"}
                            strokeWidth={selected ? 1.5 : 1}
                          />
                          <text
                            x={x + 10}
                            y={y + 22}
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              fill: "var(--kp-text-1)",
                            }}
                          >
                            {nodeLabel(n)}
                          </text>
                          <text
                            x={x + 10}
                            y={y + 38}
                            style={{ fontSize: 9, fill: "var(--kp-text-3)" }}
                          >
                            {toPascalCaseId(n.status)}
                          </text>
                        </g>
                      ))}
                    </g>
                  );
                })}
              </svg>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
