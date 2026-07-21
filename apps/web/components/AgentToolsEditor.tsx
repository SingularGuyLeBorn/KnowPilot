"use client";

import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Info,
  Loader2,
  Puzzle,
  Search,
  Server,
  Wrench,
} from "lucide-react";
import {
  DEFAULT_AGENT_NATIVE,
  materializeAgentTools,
  parseAgentToolSelection,
  serializeAgentTools,
  type AgentToolSelection,
} from "@knowpilot/shared";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  NATIVE_LABELS,
  NATIVE_TOOL_GROUPS,
  groupIdForNativeTool,
  type NativeToolGroupId,
} from "@/lib/nativeToolGroups";

interface ToolSelection {
  native: Set<string>;
  skillWildcard: boolean;
  skills: Set<string>;
  mcp: Set<string>;
}

function toToolSelection(sel: AgentToolSelection): ToolSelection {
  return {
    native: new Set(sel.native),
    skillWildcard: sel.skillWildcard,
    skills: new Set(sel.skills),
    mcp: new Set(sel.mcp),
  };
}

function fromToolSelection(sel: ToolSelection): AgentToolSelection {
  return {
    native: [...sel.native],
    skillWildcard: sel.skillWildcard,
    skills: [...sel.skills],
    mcp: [...sel.mcp],
  };
}

function parseTools(tools: string[]): ToolSelection {
  return toToolSelection(parseAgentToolSelection(tools));
}

function serializeTools(sel: ToolSelection): string[] {
  return serializeAgentTools(fromToolSelection(sel));
}

function ToolPreview({ tools }: { tools: string[] }) {
  // keepPreviousData：勾选时勿卸掉旧摘要 → 顶栏高度不塌，下方列表不会跟着「跳一下」
  const { data, isLoading, isFetching } = trpc.agent.toolSummary.useQuery(
    { tools },
    { staleTime: 30_000, placeholderData: keepPreviousData },
  );

  return (
    <div className="min-h-[4.5rem] space-y-2 rounded-xl border border-[var(--kp-brand)]/20 bg-[var(--kp-brand-soft)]/50 p-3">
      {!data ? (
        <div className="flex items-center gap-2 text-xs text-[var(--kp-text-3)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          计算实际可用能力…
        </div>
      ) : (
        <div className="flex items-start gap-2 text-xs text-[var(--kp-brand-deep)]">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              对话时 LLM 可见约 <strong>{data.llmFunctions}</strong> 个工具函数
              {isFetching && !isLoading && (
                <Loader2 className="ml-1.5 inline h-3 w-3 animate-spin opacity-60" />
              )}
            </p>
            {data.usesDefaultNative && (
              <p className="mt-1 text-[var(--kp-text-3)]">
                未单独勾选内置工具时，系统会自动附带 {DEFAULT_AGENT_NATIVE.length}{" "}
                个基础能力（搜索、读文件等）。保存后将写入配置文件。
              </p>
            )}
            {data.apiProcedures > 0 && (
              <p className="mt-1 text-[var(--kp-text-3)]">
                「调用 API」展开后可访问约 {data.apiProcedures} 个后端接口。
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ToggleChip({
  checked,
  label,
  hint,
  onClick,
}: {
  checked: boolean;
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-left text-xs transition",
        checked
          ? "border-[var(--kp-brand)] bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]"
          : "border-[var(--kp-divider)] bg-[var(--kp-bg)] text-[var(--kp-text-2)] hover:border-[var(--kp-brand-light)]",
      )}
      title={hint}
    >
      <span
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
          checked
            ? "border-[var(--kp-brand)] bg-[var(--kp-brand-deep)] text-white"
            : "border-[var(--kp-divider)]",
        )}
      >
        {checked && <Check className="h-2.5 w-2.5" />}
      </span>
      <span>{label}</span>
    </button>
  );
}

function ToolRow({
  checked,
  label,
  description,
  name,
  onClick,
}: {
  checked: boolean;
  label: string;
  description?: string;
  name: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left transition",
        checked
          ? "border-[var(--kp-brand)]/40 bg-[var(--kp-brand-soft)]/60"
          : "border-transparent hover:border-[var(--kp-divider)] hover:bg-[var(--kp-bg)]",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
          checked
            ? "border-[var(--kp-brand)] bg-[var(--kp-brand-deep)] text-white"
            : "border-[var(--kp-divider)] bg-[var(--kp-bg)]",
        )}
      >
        {checked && <Check className="h-2.5 w-2.5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span
            className={cn(
              "text-xs font-medium",
              checked ? "text-[var(--kp-brand-deep)]" : "text-[var(--kp-text-1)]",
            )}
          >
            {label}
          </span>
          <code className="font-mono text-[10px] text-[var(--kp-text-3)]">{name}</code>
        </span>
        {description ? (
          <span className="mt-0.5 line-clamp-2 block text-[11px] leading-relaxed text-[var(--kp-text-3)]">
            {description}
          </span>
        ) : null}
      </span>
    </button>
  );
}

interface AgentToolsEditorProps {
  tools: string[];
  onChange: (tools: string[]) => void;
}

export function AgentToolsEditor({ tools, onChange }: AgentToolsEditorProps) {
  const [sel, setSel] = useState<ToolSelection>(() => parseTools(tools));
  const [toolsSnapshot, setToolsSnapshot] = useState(tools);
  const [query, setQuery] = useState("");
  const [openGroups, setOpenGroups] = useState<Set<NativeToolGroupId>>(
    () => new Set(["web", "fs", "async", "swarm"]),
  );
  const listRef = useRef<HTMLDivElement>(null);
  const listScrollTopRef = useRef(0);

  if (tools !== toolsSnapshot) {
    setToolsSnapshot(tools);
    setSel(parseTools(tools));
  }

  const { data: nativeTools = [] } = trpc.native.list.useQuery();
  const { data: skillData } = trpc.skill.list.useQuery({ page: 1, pageSize: 100, enabled: true });
  const { data: mcpData } = trpc.mcp.list.useQuery({ page: 1, pageSize: 100 });

  const skills = skillData?.items ?? [];
  const mcpServers = mcpData?.items ?? [];

  const serialized = useMemo(() => materializeAgentTools(serializeTools(sel)), [sel]);

  // 勾选导致重渲染时锁住列表 scrollTop，避免点哪滚哪
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = listScrollTopRef.current;
  }, [sel, openGroups, query]);

  const update = (next: ToolSelection) => {
    if (listRef.current) listScrollTopRef.current = listRef.current.scrollTop;
    setSel(next);
    onChange(materializeAgentTools(serializeTools(next)));
  };

  const toggleNative = (name: string) => {
    const native = new Set(sel.native);
    if (native.has(name)) native.delete(name);
    else native.add(name);
    update({ ...sel, native });
  };

  const toggleSkill = (name: string) => {
    if (sel.skillWildcard) return;
    const skillsSet = new Set(sel.skills);
    if (skillsSet.has(name)) skillsSet.delete(name);
    else skillsSet.add(name);
    update({ ...sel, skills: skillsSet });
  };

  const toggleMcp = (name: string) => {
    const mcp = new Set(sel.mcp);
    if (mcp.has(name)) mcp.delete(name);
    else mcp.add(name);
    update({ ...sel, mcp });
  };

  const q = query.trim().toLowerCase();

  const grouped = useMemo(() => {
    const map = new Map<NativeToolGroupId, typeof nativeTools>();
    for (const g of NATIVE_TOOL_GROUPS) map.set(g.id, []);
    for (const tool of nativeTools) {
      const label = (NATIVE_LABELS[tool.name] ?? tool.name).toLowerCase();
      const desc = (tool.description ?? "").toLowerCase();
      if (q && !tool.name.toLowerCase().includes(q) && !label.includes(q) && !desc.includes(q)) {
        continue;
      }
      const gid = groupIdForNativeTool(tool.name);
      map.get(gid)?.push(tool);
    }
    return map;
  }, [nativeTools, q]);

  const selectedNativeCount = sel.native.size;

  const setGroupOpen = (id: NativeToolGroupId, open: boolean) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const selectGroup = (names: string[], all: boolean) => {
    const native = new Set(sel.native);
    for (const n of names) {
      if (all) native.add(n);
      else native.delete(n);
    }
    update({ ...sel, native });
  };

  return (
    <div className="space-y-4">
      <ToolPreview tools={serialized} />

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--kp-text-3)]">
            <Wrench className="h-3.5 w-3.5" />
            内置工具
            <span className="font-normal normal-case tracking-normal text-[var(--kp-text-3)]">
              · 已选 {selectedNativeCount}
            </span>
          </h3>
          <div className="flex gap-1.5">
            <button
              type="button"
              className="rounded-md px-2 py-1 text-[11px] text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)]"
              onClick={() => {
                setOpenGroups(new Set(NATIVE_TOOL_GROUPS.map((g) => g.id)));
              }}
            >
              全部展开
            </button>
            <button
              type="button"
              className="rounded-md px-2 py-1 text-[11px] text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)]"
              onClick={() => setOpenGroups(new Set())}
            >
              全部折叠
            </button>
          </div>
        </div>
        <p className="text-[11px] text-[var(--kp-text-3)]">
          按能力分组勾选；可用搜索缩小范围。悬停/阅读每行说明再决定是否授权。
        </p>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--kp-text-3)]" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索工具名 / 中文名 / 说明…"
            className="w-full rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] py-1.5 pl-8 pr-2 text-xs outline-none focus:border-[var(--kp-brand)]"
          />
        </div>

        <div
          ref={listRef}
          onScroll={(e) => {
            listScrollTopRef.current = e.currentTarget.scrollTop;
          }}
          className="max-h-[28rem] space-y-2 overflow-y-auto rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/40 p-2"
        >
          {NATIVE_TOOL_GROUPS.map((group) => {
            const items = grouped.get(group.id) ?? [];
            if (items.length === 0) return null;
            const names = items.map((t) => t.name);
            const selectedInGroup = names.filter((n) => sel.native.has(n)).length;
            const open = openGroups.has(group.id) || !!q;
            return (
              <div
                key={group.id}
                className="overflow-hidden rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)]"
              >
                <div className="flex items-center gap-1 border-b border-[var(--kp-divider)] px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => setGroupOpen(group.id, !open)}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                  >
                    {open ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--kp-text-3)]" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--kp-text-3)]" />
                    )}
                    <span className="text-xs font-semibold text-[var(--kp-text-1)]">
                      {group.label}
                    </span>
                    <span className="truncate text-[10px] text-[var(--kp-text-3)]">
                      {group.hint}
                    </span>
                    <span className="ml-auto shrink-0 rounded-full bg-[var(--kp-bg-mute)] px-1.5 py-0.5 text-[10px] tabular-nums text-[var(--kp-text-2)]">
                      {selectedInGroup}/{items.length}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-[var(--kp-brand-deep)] hover:bg-[var(--kp-brand-soft)]"
                    onClick={() => selectGroup(names, selectedInGroup < items.length)}
                  >
                    {selectedInGroup === items.length ? "清空" : "全选"}
                  </button>
                </div>
                {open && (
                  <div className="grid gap-0.5 p-1 sm:grid-cols-2">
                    {items.map((tool) => (
                      <ToolRow
                        key={tool.name}
                        checked={sel.native.has(tool.name)}
                        label={NATIVE_LABELS[tool.name] ?? tool.name}
                        description={tool.description}
                        name={tool.name}
                        onClick={() => toggleNative(tool.name)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {nativeTools.length > 0 &&
            NATIVE_TOOL_GROUPS.every((g) => (grouped.get(g.id) ?? []).length === 0) && (
              <p className="px-2 py-6 text-center text-[11px] text-[var(--kp-text-3)]">
                无匹配工具，试试别的关键词
              </p>
            )}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--kp-text-3)]">
          <Puzzle className="h-3.5 w-3.5" />
          Skill 技能
        </h3>
        <ToggleChip
          checked={sel.skillWildcard}
          label="全部已启用 Skill"
          hint="等价于配置 skill:*"
          onClick={() =>
            update({
              ...sel,
              skillWildcard: !sel.skillWildcard,
              skills: new Set(),
            })
          }
        />
        {!sel.skillWildcard && (
          <div className="flex flex-wrap gap-2 pt-1">
            {skills.length === 0 ? (
              <p className="text-[11px] text-[var(--kp-text-3)]">暂无 Skill，请先在「Skills」页创建。</p>
            ) : (
              skills.map((skill) => (
                <ToggleChip
                  key={skill.id}
                  checked={sel.skills.has(skill.name)}
                  label={skill.name}
                  hint={skill.description ?? undefined}
                  onClick={() => toggleSkill(skill.name)}
                />
              ))
            )}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--kp-text-3)]">
          <Server className="h-3.5 w-3.5" />
          MCP 外部服务
        </h3>
        {mcpServers.length === 0 ? (
          <p className="text-[11px] text-[var(--kp-text-3)]">暂无 MCP 配置，请先在「MCP」页添加服务。</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {mcpServers.map((server) => (
              <ToggleChip
                key={server.id}
                checked={sel.mcp.has(server.name)}
                label={server.name}
                hint={server.command}
                onClick={() => toggleMcp(server.name)}
              />
            ))}
          </div>
        )}
      </section>

      <details className="rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-3 py-2">
        <summary className="cursor-pointer text-[11px] text-[var(--kp-text-3)]">
          高级：查看原始配置行
        </summary>
        <pre className="mt-2 overflow-x-auto font-mono text-[10px] leading-relaxed text-[var(--kp-text-2)]">
          {serialized.length > 0 ? serialized.join("\n") : "（未授权任何工具）"}
        </pre>
      </details>
    </div>
  );
}

/** 列表卡片上的工具摘要（人类可读） */
export const AgentToolSummaryCard = memo(function AgentToolSummaryCard({
  tools,
}: {
  tools: string[];
}) {
  const { data, isLoading } = trpc.agent.toolSummary.useQuery(
    { tools },
    { staleTime: 60_000 },
  );

  if (isLoading || !data) {
    return <p className="text-[11px] text-[var(--kp-text-3)]">加载工具信息…</p>;
  }

  if (tools.length === 0) {
    return (
      <p className="text-[11px] leading-relaxed text-[var(--kp-text-2)]">未限制工具（默认全开）</p>
    );
  }

  const parts: string[] = [];
  if (data.resolvedNative.length > 0) {
    parts.push(`内置 ${data.resolvedNative.length} 项`);
  }
  if (data.resolvedSkills.length > 0) {
    parts.push(`Skill ${data.resolvedSkills.length} 个`);
  }
  if (data.resolvedMcpServers.length > 0) {
    parts.push(`MCP ${data.resolvedMcpServers.join("、")}`);
  }

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium text-[var(--kp-text-2)]">
        可用约 {data.llmFunctions} 个工具 · {parts.join(" · ") || "无"}
      </p>
      {data.usesDefaultNative && (
        <p className="text-[10px] text-[var(--kp-text-3)]">含系统默认基础内置包</p>
      )}
      <div className="flex flex-wrap gap-1">
        {data.resolvedNative.slice(0, 3).map((name) => (
          <span
            key={name}
            className="rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg-mute)] px-2 py-0.5 text-[9px] text-[var(--kp-text-3)]"
          >
            {NATIVE_LABELS[name] ?? name}
          </span>
        ))}
        {data.resolvedSkills.length > 0 && (
          <span className="rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg-mute)] px-2 py-0.5 text-[9px] text-[var(--kp-text-3)]">
            {data.resolvedSkills.length === 1
              ? `Skill: ${data.resolvedSkills[0]}`
              : `Skill ×${data.resolvedSkills.length}`}
          </span>
        )}
        {data.resolvedMcpServers.map((name) => (
          <span
            key={name}
            className="rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg-mute)] px-2 py-0.5 text-[9px] text-[var(--kp-text-3)]"
          >
            MCP: {name}
          </span>
        ))}
      </div>
    </div>
  );
});
