/**
 * Skill 管理页面 (L2 智能工作台)
 *
 * 展示大模型代理可以调用的 TypeScript 技能代码库。
 */

"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import { Wand2, Plus, Code } from "lucide-react";
import Link from "next/link";
import type { Skill } from "@knowpilot/shared";
import { useSkill, useCardDensity } from "@/lib/hooks";
import { LucideIconByName } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { EmptyState, LoadingState, ConfirmDialog, PageHeader } from "@/components/shared";

function parseSkillVersion(metaJson?: string | null): string {
  if (!metaJson) return "1.0.0";
  try {
    const meta = JSON.parse(metaJson) as { version?: string };
    return meta.version?.trim() || "1.0.0";
  } catch {
    return "1.0.0";
  }
}

export default function SkillsPage() {
  const { useList, useCreate, useDelete } = useSkill();
  const { density } = useCardDensity();
  const [page] = useState(1);
  const { data, isLoading } = useList({ page, pageSize: 12 });
  const createMutation = useCreate();
  const deleteMutation = useDelete();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const handleCreateDemo = () => {
    createMutation.mutate({
      name: `refactor_code_${Math.random().toString(36).substring(2, 6)}`,
      description: "智能重构传入的 TypeScript/React 代码，消除坏味道。",
      code: `export async function run(input: string) {\n  return "Refactored: " + input;\n}`,
      icon: "Wand2",
      trigger: "@refactor",
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
    <div className="flex-1 overflow-y-auto bg-[var(--vp-c-bg)] p-6 md:p-8 space-y-6">
      <PageHeader
        icon={Wand2}
        title="Skills 专属动作库"
        description="定义可被智能代理调用的原子化执行能力。Skill 支持 TypeScript 原生脚本或特定 Prompt 模板指令，赋予 Agent 精准的外部操作与自动化流程控制。"
        action={{ label: "新建插件技能", onClick: handleCreateDemo, icon: Plus }}
        showDensityToggle
      />

      {/* 数据列表 */}
      {isLoading ? (
        <LoadingState count={3} />
      ) : !data?.items || data.items.length === 0 ? (
        <EmptyState
          title="技能库尚未武装"
          description="当前还没有任何执行技能，Agent 只能进行纯文本对话。点击下方按钮快速部署一个重构技能。"
          actionLabel="添加示例技能"
          onAction={handleCreateDemo}
        />
      ) : (
        <div className={cn("grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3", density === "compact" ? "gap-4" : "gap-6")}>
          {data.items.map((skill: Skill, idx: number) => (
            <motion.div
              key={skill.id}
              initial={{ opacity: 0, y: 15 }}
              animate={{ 
                opacity: 1, 
                y: 0,
                transition: { delay: idx * 0.05, type: "spring", stiffness: 200, damping: 20 }
              }}
              className={cn(
                "group relative overflow-hidden rounded-2xl border border-[var(--vp-c-divider-light)] bg-[var(--vp-c-bg-alt)]/40 hover:bg-white dark:hover:bg-[var(--vp-c-bg-soft)] hover:border-[var(--vp-c-divider)] hover:shadow-xl transition-all duration-300",
                density === "compact" ? "p-3" : "p-5",
              )}
            >
              <div className="flex justify-between items-start gap-4 mb-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--vp-c-brand-soft)] text-[var(--vp-c-brand)]">
                    <LucideIconByName name={skill.icon} className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-[var(--vp-c-text-1)] group-hover:text-[var(--vp-c-brand-dark)] transition-colors text-sm">
                      {skill.name}
                    </h3>
                    <span className="text-[10px] text-[var(--vp-c-text-3)] font-mono">{skill.trigger || "无触发词"}</span>
                    <span className="ml-1 rounded bg-[var(--vp-c-brand-soft)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--vp-c-brand)]">
                      v{parseSkillVersion(skill.metaJson)}
                    </span>
                  </div>
                </div>
                
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Link
                    href={`/skills/edit/${skill.id}`}
                    className="text-xs text-[var(--vp-c-brand)] hover:text-[var(--vp-c-brand-dark)] px-2 py-0.5 rounded hover:bg-[var(--vp-c-brand-soft)]"
                  >
                    编辑
                  </Link>
                  <button
                    onClick={() => setDeleteId(skill.id)}
                    className="text-xs text-red-500 hover:text-red-600 transition-opacity px-2 py-0.5 rounded hover:bg-red-500/10"
                  >
                    卸载
                  </button>
                </div>
              </div>

              <p className="text-xs text-[var(--vp-c-text-3)] min-h-[35px] mb-4">
                {skill.description}
              </p>

              {/* 动作属性 */}
              <div className="flex items-center justify-between border-t border-[var(--vp-c-divider-light)] pt-3 text-[10px] text-[var(--vp-c-text-3)]">
                <span className="flex items-center gap-1">
                  <Code className="w-3 h-3 text-[var(--vp-c-brand)]" />
                  TypeScript 实装
                </span>
                <span className={`px-2 py-0.5 rounded-full font-medium ${
                  skill.enabled ? "bg-green-500/10 text-green-500" : "bg-gray-500/10 text-gray-500"
                }`}>
                  {skill.enabled ? "已启用" : "已禁用"}
                </span>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <ConfirmDialog
        isOpen={deleteId !== null}
        title="卸载动作技能"
        description="确定要从动作库中卸载（删除）该技能吗？删除后绑定此技能的 Agent 将无法调用它。"
        isDestructive={true}
        confirmLabel="确认卸载"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
