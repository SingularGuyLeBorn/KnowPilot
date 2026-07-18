/**
 * Triggers 事件触发器管理 — 完整创建/编辑表单
 */

"use client";

import React, { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { ChevronLeft, Plus, ToggleLeft, ToggleRight, Zap } from "lucide-react";
import type { Trigger } from "@knowpilot/shared";
import { useTrigger, useTask, useAgent, useCardDensity } from "@/lib/hooks";
import {
  AdminFormShell,
  AdminPage,
  EmptyState,
  KpSelect,
  LoadingState,
  ConfirmDialog,
  Pagination,
  PageHeader,
} from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { agentLabel } from "@/lib/displayLabels";

const EVENT_SOURCES = ["post.create", "post.update", "post.delete", "agent.create", "skill.create"];
const TYPE_OPTIONS = [
  { value: "file_change", label: "文件/实体事件 file_change" },
  { value: "webhook", label: "Webhook" },
  { value: "cron", label: "Cron 表达式" },
] as const;
const ACTION_OPTIONS = [
  { value: "run_agent", label: "运行 Agent" },
  { value: "run_task", label: "运行 Task" },
] as const;

type TriggerForm = {
  name: string;
  type: "file_change" | "webhook" | "cron";
  source: string;
  actionType: "run_agent" | "run_task";
  actionId: string;
  enabled: boolean;
};

const EMPTY_FORM: TriggerForm = {
  name: "",
  type: "file_change",
  source: "post.create",
  actionType: "run_agent",
  actionId: "",
  enabled: true,
};

export default function TriggersPage() {
  const { useList, useCreate, useUpdate, useDelete } = useTrigger();
  const { useList: useTaskList } = useTask();
  const { useList: useAgentList } = useAgent();
  const { density } = useCardDensity();
  const [page, setPage] = useState(1);
  const { data, isLoading } = useList({ page, pageSize: 12 });
  const tasksQuery = useTaskList({ page: 1, pageSize: 100 });
  const agentsQuery = useAgentList({ page: 1, pageSize: 100 });
  const createMutation = useCreate();
  const updateMutation = useUpdate();
  const deleteMutation = useDelete();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "edit">("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TriggerForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  const actionLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tasksQuery.data?.items ?? []) m.set(t.id, t.name);
    for (const a of agentsQuery.data?.items ?? []) m.set(a.id, agentLabel(a));
    return m;
  }, [tasksQuery.data?.items, agentsQuery.data?.items]);

  const actionOptions = useMemo(() => {
    if (form.actionType === "run_task") {
      return (tasksQuery.data?.items ?? []).map((t: { id: string; name: string }) => ({
        value: t.id,
        label: t.name,
      }));
    }
    return (agentsQuery.data?.items ?? []).map(
      (a: { id: string; name: string; autoName?: string | null }) => ({
        value: a.id,
        label: agentLabel(a),
      }),
    );
  }, [form.actionType, tasksQuery.data?.items, agentsQuery.data?.items]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setView("edit");
  };

  const openEdit = (t: Trigger) => {
    setEditingId(t.id);
    setForm({
      name: t.name,
      type: t.type as TriggerForm["type"],
      source: t.source,
      actionType: t.actionType as TriggerForm["actionType"],
      actionId: t.actionId,
      enabled: t.enabled,
    });
    setFormError(null);
    setView("edit");
  };

  const handleSave = async () => {
    setFormError(null);
    if (!form.name.trim()) {
      setFormError("名称不能为空");
      return;
    }
    if (!form.source.trim()) {
      setFormError("事件源 / cron / webhook 不能为空");
      return;
    }
    if (!form.actionId) {
      setFormError("请选择动作目标");
      return;
    }
    try {
      if (editingId) {
        await updateMutation.mutateAsync({
          id: editingId,
          name: form.name.trim(),
          type: form.type,
          source: form.source.trim(),
          actionType: form.actionType,
          actionId: form.actionId,
          enabled: form.enabled,
        });
      } else {
        await createMutation.mutateAsync({
          name: form.name.trim(),
          type: form.type,
          source: form.source.trim(),
          actionType: form.actionType,
          actionId: form.actionId,
          enabled: form.enabled,
        });
      }
      setView("list");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "保存失败");
    }
  };

  const toggleEnabled = (trigger: Trigger) => {
    updateMutation.mutate({ id: trigger.id, enabled: !trigger.enabled });
  };

  const confirmDelete = () => {
    if (deleteId) {
      deleteMutation.mutate({ id: deleteId });
      setDeleteId(null);
    }
  };

  if (view === "edit") {
    return (
      <AdminFormShell>
        <button
          type="button"
          onClick={() => setView("list")}
          className="flex items-center gap-1 text-sm text-[var(--kp-text-3)] hover:text-[var(--kp-text-1)]"
        >
          <ChevronLeft className="h-4 w-4" />
          返回列表
        </button>
        <div>
          <h1 className="text-2xl font-bold text-[var(--kp-text-1)]">
            {editingId ? "编辑触发器" : "新建触发器"}
          </h1>
          <p className="mt-1 text-sm text-[var(--kp-text-3)]">
            事件发生时自动唤醒 Agent 或执行 Task。file_change 的 source 形如 entity.action。
          </p>
        </div>

        <div className="max-w-2xl space-y-4 rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] p-5 md:p-6">
          <div>
            <label className="mb-1 block text-xs text-[var(--kp-text-3)]">名称</label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="文章创建后整理"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-[var(--kp-text-3)]">类型</label>
              <KpSelect
                value={form.type}
                onChange={(v) => setForm({ ...form, type: v as TriggerForm["type"] })}
                options={[...TYPE_OPTIONS]}
                className="w-full"
                aria-label="触发类型"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--kp-text-3)]">动作</label>
              <KpSelect
                value={form.actionType}
                onChange={(v) =>
                  setForm({
                    ...form,
                    actionType: v as TriggerForm["actionType"],
                    actionId: "",
                  })
                }
                options={[...ACTION_OPTIONS]}
                className="w-full"
                aria-label="动作类型"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--kp-text-3)]">
              {form.type === "cron" ? "Cron 表达式" : form.type === "webhook" ? "Webhook 路径/密钥" : "事件源"}
            </label>
            {form.type === "file_change" ? (
              <KpSelect
                value={EVENT_SOURCES.includes(form.source) ? form.source : "custom"}
                onChange={(v) => v !== "custom" && setForm({ ...form, source: v })}
                options={[
                  ...EVENT_SOURCES.map((s) => ({ value: s, label: s })),
                  ...(EVENT_SOURCES.includes(form.source)
                    ? []
                    : [{ value: "custom", label: `自定义（${form.source}）` }]),
                ]}
                className="w-full"
                aria-label="事件源"
              />
            ) : null}
            <Input
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
              placeholder={
                form.type === "cron" ? "0 9 * * *" : form.type === "webhook" ? "/hooks/my-event" : "post.create"
              }
              className="mt-1.5 font-mono text-xs"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--kp-text-3)]">
              动作目标（{form.actionType === "run_task" ? "Task" : "Agent"}）
            </label>
            {actionOptions.length === 0 ? (
              <p className="text-xs text-amber-700">
                暂无{form.actionType === "run_task" ? " Task" : " Agent"}可选，请先创建。
              </p>
            ) : (
              <KpSelect
                value={form.actionId || actionOptions[0]?.value || ""}
                onChange={(v) => setForm({ ...form, actionId: v })}
                options={actionOptions}
                className="w-full"
                aria-label="动作目标"
              />
            )}
          </div>
          <label className="flex items-center gap-2 text-xs text-[var(--kp-text-2)]">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              className="h-4 w-4 rounded border-[var(--kp-divider)]"
            />
            创建后立即启用
          </label>
          {formError && <p className="text-xs text-red-600">{formError}</p>}
          <div className="flex gap-2 pt-1">
            <Button
              onClick={() => void handleSave()}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {editingId ? "保存修改" : "创建触发器"}
            </Button>
            <Button variant="outline" onClick={() => setView("list")}>
              取消
            </Button>
          </div>
        </div>
      </AdminFormShell>
    );
  }

  return (
    <AdminPage>
      <PageHeader
        icon={Zap}
        title="Triggers 触发器"
        description="当 post.create 等事件发生时，自动唤醒 Agent 或执行后台 Task。"
        action={{ label: "新建触发器", onClick: openCreate, icon: Plus }}
        showDensityToggle
      />

      <div className="rounded-2xl border border-[var(--kp-divider-light)] bg-[var(--kp-bg-alt)] p-4 text-xs text-[var(--kp-text-3)]">
        <p className="mb-1 font-semibold text-[var(--kp-text-2)]">常用事件源</p>
        <code className="text-[10px]">{EVENT_SOURCES.join(" · ")}</code>
      </div>

      {isLoading ? (
        <LoadingState count={3} />
      ) : !data?.items || data.items.length === 0 ? (
        <EmptyState
          title="尚未配置触发器"
          description="创建规则后，TriggerEngine 会在 server 启动时监听 AppEventBus 事件。"
          actionLabel="新建触发器"
          onAction={openCreate}
        />
      ) : (
        <>
          <div
            className={cn(
              "grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))]",
              density === "compact" ? "gap-4" : "gap-6",
            )}
          >
            {data.items.map((trigger: Trigger, idx: number) => (
              <motion.div
                key={trigger.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  transition: { delay: idx * 0.05, type: "spring", stiffness: 200, damping: 20 },
                }}
                className={cn(
                  "group rounded-2xl border border-[var(--kp-divider-light)] bg-[var(--kp-bg-alt)] transition-all hover:shadow-lg",
                  density === "compact" ? "p-3" : "p-5",
                )}
              >
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-bold text-[var(--kp-text-1)]">{trigger.name}</h3>
                    <p className="mt-1 text-[10px] text-[var(--kp-text-3)]">
                      {trigger.type} · {trigger.actionType}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleEnabled(trigger)}
                    className="flex items-center gap-1 text-xs text-[var(--kp-brand-deep)]"
                    aria-label={trigger.enabled ? "禁用" : "启用"}
                  >
                    {trigger.enabled ? (
                      <ToggleRight className="h-5 w-5 text-green-500" />
                    ) : (
                      <ToggleLeft className="h-5 w-5 text-[var(--kp-text-3)]" />
                    )}
                    {trigger.enabled ? "已启用" : "已禁用"}
                  </button>
                </div>

                <div className="space-y-2 text-xs">
                  <div>
                    <span className="text-[var(--kp-text-3)]">事件源 </span>
                    <code className="rounded bg-[var(--kp-bg-mute)] px-1.5 py-0.5 font-mono">
                      {trigger.source}
                    </code>
                  </div>
                  <div>
                    <span className="text-[var(--kp-text-3)]">动作目标 </span>
                    <span className="rounded bg-[var(--kp-bg-mute)] px-1.5 py-0.5 text-[10px]">
                      {actionLabelById.get(trigger.actionId) ||
                        (trigger.actionType === "run_task" ? "未知任务" : "未知 Agent")}
                    </span>
                  </div>
                </div>

                <div className="mt-4 flex justify-end gap-2 border-t border-[var(--kp-divider-light)] pt-3">
                  <button
                    type="button"
                    onClick={() => openEdit(trigger)}
                    className="rounded px-2 py-1 text-xs text-[var(--kp-brand-deep)] hover:bg-[var(--kp-brand-soft)]"
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteId(trigger.id)}
                    className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-500/10"
                  >
                    删除
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
        title="删除触发器"
        description="确定删除此触发规则？删除后事件将不再自动触发。"
        isDestructive
        confirmLabel="确认删除"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteId(null)}
      />
    </AdminPage>
  );
}
