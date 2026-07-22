/**
 * Tools 工具注册表 — 完整 CRUD 配置页（参考 MetaBlog / sources）
 */

"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ChevronLeft,
  Cpu,
  Link2,
  Plus,
  Puzzle,
  Search,
  Server,
  Trash2,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Tool } from "@knowpilot/shared";
import { useTool, useNativeCapabilities } from "@/lib/hooks";
import { trpc } from "@/lib/trpc";
import { EmptyState, KpSelect, LoadingState, ConfirmDialog, Pagination, NativeCapabilitiesPanel, PageHeader } from "@/components/shared";
import { cn } from "@/lib/utils";

type ToolForm = {
  name: string;
  type: Tool["type"];
  targetId: string;
  description: string;
  parametersSchema: string;
  enabled: boolean;
};

const TYPE_OPTIONS = [
  { value: "native", label: "原生工具 (Native)" },
  { value: "skill", label: "Skill 绑定" },
  { value: "mcp", label: "MCP 绑定" },
] as const;

const TYPE_LABELS: Record<Tool["type"], string> = {
  native: "原生工具",
  skill: "Skill 绑定",
  mcp: "MCP 绑定",
};

const TYPE_ICONS: Record<Tool["type"], typeof Wrench> = {
  native: Wrench,
  skill: Puzzle,
  mcp: Server,
};

const EMPTY_FORM: ToolForm = {
  name: "",
  type: "native",
  targetId: "",
  description: "",
  parametersSchema: "",
  enabled: true,
};

export default function ToolsPage() {
  const { useList, useCreate, useUpdate, useDelete } = useTool();

  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [enabledFilter, setEnabledFilter] = useState<boolean | undefined>(undefined);

  const [view, setView] = useState<"list" | "edit">("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ToolForm>(EMPTY_FORM);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);

  const listInput = {
    page,
    pageSize: 12,
    keyword: keyword || undefined,
    type: typeFilter || undefined,
    enabled: enabledFilter,
  };

  const { data, isLoading, refetch } = useList(listInput);
  const { data: caps } = useNativeCapabilities();
  const { data: nativeTools = [] } = trpc.native.list.useQuery(undefined, { staleTime: 60_000 });
  const { data: skillData } = trpc.skill.list.useQuery({ page: 1, pageSize: 100, enabled: true });
  const { data: mcpData } = trpc.mcp.list.useQuery({ page: 1, pageSize: 100 });

  const createMutation = useCreate();
  const updateMutation = useUpdate();
  const deleteMutation = useDelete();

  const nativeOptions = useMemo(
    () => nativeTools.map((t) => ({ value: t.name, label: t.name })),
    [nativeTools],
  );

  const skillOptions = useMemo(() => {
    const skills = skillData?.items ?? [];
    return skills.map((s) => ({ value: s.name, label: s.name }));
  }, [skillData]);

  const mcpOptions = useMemo(() => {
    const mcpServers = mcpData?.items ?? [];
    return mcpServers.map((s) => ({ value: s.name, label: s.name }));
  }, [mcpData]);

  const targetDisplayName = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of nativeTools) m.set(t.name, t.name);
    for (const s of skillData?.items ?? []) {
      m.set(s.id, s.name);
      m.set(s.name, s.name);
    }
    for (const s of mcpData?.items ?? []) {
      m.set(s.id, s.name);
      m.set(s.name, s.name);
    }
    return m;
  }, [nativeTools, skillData, mcpData]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setSchemaError(null);
    setView("edit");
  };

  const openEdit = (tool: Tool) => {
    setEditingId(tool.id);
    setForm({
      name: tool.name,
      type: tool.type,
      targetId: tool.targetId ?? "",
      description: tool.description ?? "",
      parametersSchema: tool.parametersSchema ?? "",
      enabled: tool.enabled,
    });
    setSchemaError(null);
    setView("edit");
  };

  const applyNativeTemplate = (name: string) => {
    const def = nativeTools.find((t) => t.name === name);
    if (!def) return;
    setForm((prev) => ({
      ...prev,
      name: prev.name || def.name,
      type: "native",
      targetId: def.name,
      description: def.description,
      parametersSchema: JSON.stringify(def.parameters, null, 2),
    }));
    setSchemaError(null);
  };

  const validateSchema = (raw: string): boolean => {
    if (!raw.trim()) {
      setSchemaError(null);
      return true;
    }
    try {
      JSON.parse(raw);
      setSchemaError(null);
      return true;
    } catch {
      setSchemaError("parametersSchema 必须是合法 JSON");
      return false;
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    if (!validateSchema(form.parametersSchema)) return;

    const payload = {
      name: form.name.trim(),
      type: form.type,
      targetId: form.targetId.trim() || undefined,
      description: form.description.trim() || undefined,
      parametersSchema: form.parametersSchema.trim() || undefined,
      enabled: form.enabled,
    };

    if (editingId) {
      await updateMutation.mutateAsync({ id: editingId, ...payload });
    } else {
      await createMutation.mutateAsync(payload);
    }
    setView("list");
    void refetch();
  };

  const handleSearch = () => {
    setKeyword(searchInput.trim());
    setPage(1);
  };

  const toggleEnabled = (tool: Tool) => {
    updateMutation.mutate({ id: tool.id, enabled: !tool.enabled });
  };

  const confirmDelete = () => {
    if (deleteId) {
      deleteMutation.mutate({ id: deleteId });
      setDeleteId(null);
      if (editingId === deleteId) setView("list");
    }
  };

  if (view === "edit") {
    return (
      <div className="flex-1 overflow-y-auto bg-[var(--kp-bg)] p-6 md:p-8">
        <button
          type="button"
          onClick={() => setView("list")}
          className="mb-6 flex items-center gap-1 text-sm text-[var(--kp-text-3)] hover:text-[var(--kp-text-1)]"
        >
          <ChevronLeft className="h-4 w-4" />
          返回工具列表
        </button>

        <div className="mx-auto w-full max-w-[1400px] space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-[var(--kp-text-1)]">
              {editingId ? "编辑工具注册" : "注册新工具"}
            </h1>
            <p className="mt-1 text-sm text-[var(--kp-text-3)]">
              登记 Native / Skill / MCP 工具元数据，供 Agent 授权与 ai.tools 反射发现。Native 实现仍由
              nativeTools.ts 提供，此处为配置与文档层。
            </p>
          </div>

          <div className="space-y-4 rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] p-6">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--kp-text-3)]">工具名称</label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="web_search"
              />
              <p className="mt-1 text-[10px] text-[var(--kp-text-3)]">全局唯一，Agent 授权时使用 native:名称 等形式。</p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--kp-text-3)]">类型</label>
                <KpSelect
                  value={form.type}
                  onChange={(type) => setForm({ ...form, type: type as Tool["type"], targetId: "" })}
                  options={[...TYPE_OPTIONS]}
                  className="w-full"
                  aria-label="工具类型"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--kp-text-3)]">
                  {form.type === "native" ? "内置工具" : form.type === "skill" ? "绑定 Skill" : "绑定 MCP 服务"}
                </label>
                {form.type === "native" ? (
                  <KpSelect
                    value={form.targetId}
                    onChange={(targetId) => {
                      setForm({ ...form, targetId });
                      applyNativeTemplate(targetId);
                    }}
                    options={[{ value: "", label: "选择内置工具…" }, ...nativeOptions]}
                    className="w-full"
                    aria-label="内置工具"
                  />
                ) : form.type === "skill" ? (
                  <KpSelect
                    value={form.targetId}
                    onChange={(targetId) => setForm({ ...form, targetId })}
                    options={[{ value: "", label: "选择 Skill…" }, ...skillOptions]}
                    className="w-full"
                    aria-label="Skill"
                  />
                ) : (
                  <KpSelect
                    value={form.targetId}
                    onChange={(targetId) => setForm({ ...form, targetId })}
                    options={[{ value: "", label: "选择 MCP 服务…" }, ...mcpOptions]}
                    className="w-full"
                    aria-label="MCP 服务"
                  />
                )}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--kp-text-3)]">描述</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={3}
                className="w-full resize-none rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--kp-brand)]"
                placeholder="说明该工具的用途、限制与典型场景"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--kp-text-3)]">
                参数 Schema（JSON）
              </label>
              <textarea
                value={form.parametersSchema}
                onChange={(e) => {
                  setForm({ ...form, parametersSchema: e.target.value });
                  if (schemaError) validateSchema(e.target.value);
                }}
                onBlur={() => validateSchema(form.parametersSchema)}
                rows={10}
                spellCheck={false}
                className={cn(
                  "w-full resize-y rounded-xl border bg-[var(--kp-bg)] px-3 py-2 font-mono text-xs outline-none focus:border-[var(--kp-brand)]",
                  schemaError ? "border-red-400" : "border-[var(--kp-divider)]",
                )}
                placeholder='{"type":"object","properties":{...}}'
              />
              {schemaError && <p className="mt-1 text-xs text-red-500">{schemaError}</p>}
              {form.type === "native" && form.targetId && (
                <button
                  type="button"
                  onClick={() => applyNativeTemplate(form.targetId)}
                  className="mt-2 text-xs text-[var(--kp-brand-deep)] hover:underline"
                >
                  从内置工具「{form.targetId}」重新填充 Schema
                </button>
              )}
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--kp-text-2)]">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                className="rounded accent-[var(--kp-brand)]"
              />
              启用此工具注册
            </label>
          </div>

          <div className="flex gap-3">
            <Button
              onClick={() => void handleSave()}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {editingId ? "保存修改" : "注册工具"}
            </Button>
            {editingId && (
              <Button variant="destructive" onClick={() => setDeleteId(editingId)}>
                <Trash2 className="mr-1 h-4 w-4" />
                删除
              </Button>
            )}
          </div>
        </div>

        <ConfirmDialog
          isOpen={deleteId !== null}
          title="删除工具注册"
          description="确定删除此工具注册条目？不会影响 nativeTools 实际实现。"
          isDestructive
          confirmLabel="确认删除"
          onConfirm={confirmDelete}
          onCancel={() => setDeleteId(null)}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--kp-bg)] p-6 md:p-8 space-y-6">
      <PageHeader
        icon={Wrench}
        title="Tools 工具目录"
        description="像 MetaBlog 一样完整注册工具元数据：名称、类型、绑定目标、参数 Schema 与启用状态。Agent 通过 native:/skill:/mcp: 授权后才会在对话中可见。"
        action={{ label: "注册工具", onClick: openCreate, icon: Plus }}
      />

      {caps && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <NativeCapabilitiesPanel data={caps} />
        </motion.div>
      )}

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[200px] flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--kp-text-3)]" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="搜索工具名称或描述…"
            className="pl-9"
          />
        </div>
        <KpSelect
          value={typeFilter}
          onChange={setTypeFilter}
          options={[{ value: "", label: "全部类型" }, ...TYPE_OPTIONS]}
          aria-label="类型筛选"
        />
        <KpSelect
          value={enabledFilter === undefined ? "" : enabledFilter ? "true" : "false"}
          onChange={(v) => setEnabledFilter(v === "" ? undefined : v === "true")}
          options={[
            { value: "", label: "全部状态" },
            { value: "true", label: "已启用" },
            { value: "false", label: "已禁用" },
          ]}
          aria-label="启用状态"
        />
        <Button variant="outline" onClick={handleSearch}>
          搜索
        </Button>
      </div>

      {isLoading ? (
        <LoadingState count={3} />
      ) : !data?.items?.length ? (
        <EmptyState
          title="工具注册表为空"
          description="注册第一个工具，或从内置 Native 工具模板快速导入。"
          actionLabel="注册工具"
          onAction={openCreate}
        />
      ) : (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] ">
            {data.items.map((tool: Tool, idx: number) => {
              const Icon = TYPE_ICONS[tool.type] ?? Cpu;
              return (
                <motion.div
                  key={tool.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0, transition: { delay: idx * 0.04 } }}
                  className="kp-card-premium kp-lift group relative rounded-2xl p-5"
                >
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="font-bold text-[var(--kp-text-1)]">{tool.name}</h3>
                        <span className="text-[10px] text-[var(--kp-text-3)]">{TYPE_LABELS[tool.type]}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDeleteId(tool.id)}
                      className="rounded-lg px-2 py-1 text-red-500 opacity-0 transition group-hover:opacity-100 hover:bg-red-500/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  <p className="mb-3 min-h-[32px] text-xs leading-relaxed text-[var(--kp-text-3)] line-clamp-2">
                    {tool.description || "无描述"}
                  </p>

                  {tool.targetId && (
                    <p
                      className="mb-3 flex items-center gap-1 truncate text-[10px] text-[var(--kp-text-3)]"
                      title={tool.targetId}
                    >
                      <Link2 className="h-3 w-3 shrink-0" />
                      {targetDisplayName.get(tool.targetId) || tool.targetId}
                    </p>
                  )}

                  <div className="flex items-center justify-between border-t border-[var(--kp-divider)] pt-3">
                    <button
                      type="button"
                      onClick={() => toggleEnabled(tool)}
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-[10px] font-medium transition",
                        tool.enabled
                          ? "bg-green-500/10 text-green-600 hover:bg-green-500/20"
                          : "bg-gray-500/10 text-gray-500 hover:bg-gray-500/20",
                      )}
                    >
                      {tool.enabled ? "已启用" : "已禁用"}
                    </button>
                    <button
                      type="button"
                      onClick={() => openEdit(tool)}
                      className="rounded-xl border border-[var(--kp-divider)] px-3 py-1.5 text-xs text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)]"
                    >
                      编辑
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>

          {data && (
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              totalPages={data.totalPages}
              onPageChange={setPage}
            />
          )}
        </>
      )}

      <ConfirmDialog
        isOpen={deleteId !== null}
        title="删除工具注册"
        description="确定要从工具注册表中删除该条目吗？不会影响实际 nativeTools 实现。"
        isDestructive
        confirmLabel="确认删除"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
