/**
 * Agent 管理页面 — 参考 MetaBlog Agent 档案馆
 */

"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Bot,
  ChevronLeft,
  Cpu,
  MessageSquare,
  Plus,
  Search,
  Sparkles,
  Terminal,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Agent } from "@knowpilot/shared";
import { CHAT_MODELS } from "@knowpilot/shared";
import { useAgent } from "@/lib/hooks";
import { trpc } from "@/lib/trpc";
import { EmptyState, LoadingState, ConfirmDialog, Pagination } from "@/components/shared";
import { cn } from "@/lib/utils";

type AgentForm = {
  name: string;
  description: string;
  model: string;
  systemPrompt: string;
  tools: string;
};

const DEFAULT_AGENT_TOOLS = [
  "native:web_search",
  "native:read_file",
  "native:list_directory",
  "native:invoke_api",
  "native:git_status",
  "skill:*",
  "mcp:filesystem",
].join("\n");

const EMPTY_FORM: AgentForm = {
  name: "",
  description: "",
  model: "deepseek-chat",
  systemPrompt: "你是 KnowPilot 智能助手，擅长知识管理与 Markdown 写作。",
  tools: DEFAULT_AGENT_TOOLS,
};

function AgentToolStats({ tools }: { tools: string[] }) {
  const { data, isLoading } = trpc.agent.toolSummary.useQuery(
    { tools },
    { enabled: tools.length > 0, staleTime: 60_000 },
  );

  if (isLoading || !data) {
    return (
      <div className="text-[10px] font-bold uppercase text-[var(--kp-text-3)]">
        工具 · 授权 {tools.length} 项
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1 text-[10px] font-bold uppercase text-[var(--kp-text-3)]">
        <Terminal className="h-3 w-3" />
        工具 · LLM {data.llmFunctions} 个
      </div>
      <p className="text-[9px] leading-relaxed text-[var(--kp-text-3)]">
        授权 {data.authLines} 行 · Native {data.nativeGranted}/{data.nativeBuiltinTotal}
        {data.skillTools > 0 ? ` · Skill ${data.skillTools}` : ""}
        {data.mcpTools > 0 ? ` · MCP ${data.mcpTools}` : ""}
        {data.apiProcedures > 0 ? ` · API ${data.apiProcedures}（invoke_api）` : ""}
      </p>
    </div>
  );
}

export default function AgentsPage() {
  const { useList, useCreate, useUpdate, useDelete } = useAgent();

  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [view, setView] = useState<"list" | "edit">("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AgentForm>(EMPTY_FORM);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data, isLoading, refetch } = useList({ page, pageSize: 12, keyword });
  const createMutation = useCreate();
  const updateMutation = useUpdate();
  const deleteMutation = useDelete();

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setView("edit");
  };

  const openEdit = (agent: Agent) => {
    setEditingId(agent.id);
    setForm({
      name: agent.name,
      description: agent.description ?? "",
      model: agent.model,
      systemPrompt: agent.systemPrompt,
      tools: (agent.tools ?? []).join("\n"),
    });
    setView("edit");
  };

  const parseTools = (raw: string) =>
    raw
      .split(/[\n,]/)
      .map((t) => t.trim())
      .filter(Boolean);

  const handleSave = async () => {
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      model: form.model,
      systemPrompt: form.systemPrompt,
      tools: parseTools(form.tools),
    };
    if (!payload.name) return;

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
          返回档案馆
        </button>

        <div className="mx-auto max-w-2xl space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-[var(--kp-text-1)]">
              {editingId ? "编辑 Agent" : "新建 Agent"}
            </h1>
            <p className="mt-1 text-sm text-[var(--kp-text-3)]">
              配置模型、System Prompt 与工具授权。Chat 页右侧设置可会话级覆盖 Prompt。
            </p>
          </div>

          <div className="space-y-4 rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] p-6">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--kp-text-3)]">名称</label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="assistant" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--kp-text-3)]">描述</label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Agent 职责简介" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--kp-text-3)]">默认模型</label>
              <select
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                className="w-full rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-3 py-2 text-sm"
              >
                {CHAT_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--kp-text-3)]">System Prompt</label>
              <textarea
                value={form.systemPrompt}
                onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
                rows={8}
                className="w-full resize-none rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--kp-brand)]"
                placeholder="定义 Agent 角色与行为…"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--kp-text-3)]">
                授权工具（每行一个）
              </label>
              <textarea
                value={form.tools}
                onChange={(e) => setForm({ ...form, tools: e.target.value })}
                rows={7}
                className="w-full resize-none rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] px-3 py-2 font-mono text-xs outline-none focus:border-[var(--kp-brand)]"
                placeholder={"native:read_file\nskill:*\nmcp:filesystem"}
              />
              <p className="mt-2 text-[11px] leading-relaxed text-[var(--kp-text-3)]">
                前缀：<code className="rounded bg-[var(--kp-bg-mute)] px-1">native:</code> 内置工具 ·
                <code className="rounded bg-[var(--kp-bg-mute)] px-1">skill:</code> 技能（<code className="rounded bg-[var(--kp-bg-mute)] px-1">skill:*</code> 全部已启用） ·
                <code className="rounded bg-[var(--kp-bg-mute)] px-1">mcp:</code> MCP 服务名。
                内置：web_search、read_file、write_file、list_directory、git_status、git_log、git_diff、invoke_api 等。
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            <Button onClick={() => void handleSave()} disabled={createMutation.isPending || updateMutation.isPending}>
              {editingId ? "保存修改" : "创建 Agent"}
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
          title="删除 Agent"
          description="确定删除此 Agent？关联配置将不可恢复。"
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
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-3xl border border-[var(--kp-divider)] bg-gradient-to-br from-[var(--kp-bg-alt)] to-[var(--kp-bg-mute)] p-8"
      >
        <div className="absolute right-0 top-0 -translate-y-12 translate-x-12 opacity-5">
          <Bot className="h-80 w-80 text-[var(--kp-brand)]" />
        </div>
        <div className="relative z-10 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-[var(--kp-brand-soft)] px-3 py-1 text-xs font-semibold text-[var(--kp-brand-dark)]">
              <Sparkles className="h-3.5 w-3.5" />
              Agent 档案馆
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-[var(--kp-text-1)]">我的 Agents</h1>
            <p className="max-w-xl text-sm text-[var(--kp-text-3)]">
              创建、配置并管理 AI 代理。每个 Agent 拥有独立的模型、System Prompt 与工具授权。
            </p>
          </div>
          <Button onClick={openCreate} className="shrink-0 gap-2 rounded-2xl px-5 py-6">
            <Plus className="h-5 w-5" />
            新建 Agent
          </Button>
        </div>
      </motion.div>

      <div className="flex gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--kp-text-3)]" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="搜索 Agent 名称…"
            className="pl-9"
          />
        </div>
        <Button variant="outline" onClick={handleSearch}>搜索</Button>
      </div>

      {isLoading ? (
        <LoadingState count={3} />
      ) : !data?.items?.length ? (
        <EmptyState
          title="暂无 Agent"
          description="创建第一个 Agent，然后在 Chat 页开始对话。"
          actionLabel="新建 Agent"
          onAction={openCreate}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {data.items.map((agent: Agent, idx: number) => (
              <motion.div
                key={agent.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0, transition: { delay: idx * 0.04 } }}
                className="group relative rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)]/60 p-5 transition hover:border-[var(--kp-brand)]/30 hover:shadow-lg"
              >
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--kp-brand-soft)] text-[var(--kp-brand)]">
                      <Bot className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-[var(--kp-text-1)]">{agent.name}</h3>
                      <div className="mt-0.5 inline-flex items-center gap-1 rounded bg-[var(--kp-bg-mute)] px-1.5 py-0.5 text-[10px] text-[var(--kp-text-3)]">
                        <Cpu className="h-2.5 w-2.5" />
                        {agent.model}
                      </div>
                    </div>
                  </div>
                </div>

                <p className="mb-4 min-h-[36px] text-xs leading-relaxed text-[var(--kp-text-3)]">
                  {agent.description || "暂无描述"}
                </p>

                <div className="mb-4 space-y-1 border-t border-[var(--kp-divider)] pt-3">
                  <AgentToolStats tools={agent.tools ?? []} />
                  <div className="flex flex-wrap gap-1 pt-1">
                    {(agent.tools ?? []).slice(0, 4).map((t: string) => (
                      <span key={t} className="rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg-mute)] px-2 py-0.5 text-[9px]">
                        {t}
                      </span>
                    ))}
                    {(agent.tools?.length ?? 0) > 4 && (
                      <span className="text-[9px] text-[var(--kp-text-3)]">+{(agent.tools?.length ?? 0) - 4}</span>
                    )}
                  </div>
                </div>

                <div className="flex gap-2">
                  <Link
                    href={`/chat?agentId=${agent.id}`}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1 rounded-xl bg-[var(--kp-brand)] py-2 text-xs font-medium text-white transition hover:opacity-90",
                    )}
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    对话
                  </Link>
                  <button
                    type="button"
                    onClick={() => openEdit(agent)}
                    className="rounded-xl border border-[var(--kp-divider)] px-3 py-2 text-xs text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)]"
                  >
                    配置
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteId(agent.id)}
                    className="rounded-xl px-2 py-2 text-red-500 opacity-0 transition group-hover:opacity-100 hover:bg-red-500/10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </motion.div>
            ))}
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
        title="删除 Agent"
        description="确定删除此 Agent？此操作不可撤销。"
        isDestructive
        confirmLabel="确认删除"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
