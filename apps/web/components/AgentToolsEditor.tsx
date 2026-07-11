"use client";

import { memo, useMemo, useState } from "react";
import { Check, Info, Loader2, Puzzle, Server, Wrench } from "lucide-react";
import {
  DEFAULT_AGENT_NATIVE,
  materializeAgentTools,
  parseAgentToolSelection,
  serializeAgentTools,
  type AgentToolSelection,
} from "@knowpilot/shared";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const NATIVE_LABELS: Record<string, string> = {
  web_search: "网页搜索",
  read_article: "读取网页文章",
  scrape_web_page: "采集网页",
  read_file: "读取文件",
  write_file: "写入文件",
  list_directory: "列出目录",
  delete_all_chat_sessions: "删除全部会话",
  file_rename: "重命名文件",
  file_move: "移动文件",
  file_copy: "复制文件",
  file_delete: "删除文件",
  file_stat: "文件元信息",
  search_files: "搜索文件内容",
  directory_create: "创建目录",
  directory_delete: "删除目录",
  post_create: "创建文章",
  post_update: "更新文章",
  memory_create: "创建记忆",
  memory_search: "搜索记忆",
  git_status: "Git 状态",
  git_branch: "Git 分支",
  git_checkout: "Git 切换分支",
  git_clone: "Git 克隆",
  git_log: "Git 日志",
  git_diff: "Git 差异",
  git_commit: "Git 提交",
  git_pull: "Git 拉取",
  git_push: "Git 推送",
  task_run: "运行 Task",
  yuque_get_doc: "语雀文档",
  github_search_repos: "GitHub 搜索",
  feishu_send_text: "飞书消息",
  invoke_api: "调用后端 API",
  async_task_run: "后台异步任务",
  async_task_status: "异步任务状态",
  async_task_wait: "等待异步任务",
  async_task_cancel: "取消异步任务",
  run_shell: "执行 Shell 命令",
  wait: "等待/延迟",
  sleep: "睡眠/定时器",
};

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
  const { data, isLoading } = trpc.agent.toolSummary.useQuery(
    { tools },
    { staleTime: 30_000 },
  );

  if (isLoading || !data) {
    return (
      <div className="flex items-center gap-2 text-xs text-[var(--kp-text-3)]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        计算实际可用能力…
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border border-[var(--kp-brand)]/20 bg-[var(--kp-brand-soft)]/50 p-3">
      <div className="flex items-start gap-2 text-xs text-[var(--kp-brand-deep)]">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div>
          <p className="font-medium">
            对话时 LLM 可见约 <strong>{data.llmFunctions}</strong> 个工具函数
          </p>
          {data.usesDefaultNative && (
            <p className="mt-1 text-[var(--kp-text-3)]">
              未单独勾选内置工具时，系统会自动附带 {DEFAULT_AGENT_NATIVE.length} 个基础能力（搜索、读文件等）。保存后将写入配置文件。
            </p>
          )}
          {data.apiProcedures > 0 && (
            <p className="mt-1 text-[var(--kp-text-3)]">
              「调用 API」展开后可访问约 {data.apiProcedures} 个后端接口。
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {data.resolvedNative.map((name) => (
          <span key={`n-${name}`} className="rounded-full bg-[var(--kp-bg)] px-2 py-0.5 text-[10px] text-[var(--kp-text-2)]">
            内置 · {NATIVE_LABELS[name] ?? name}
          </span>
        ))}
        {data.resolvedSkills.map((name) => (
          <span key={`s-${name}`} className="rounded-full bg-[var(--kp-bg)] px-2 py-0.5 text-[10px] text-[var(--kp-text-2)]">
            Skill · {name}
          </span>
        ))}
        {data.resolvedMcpServers.map((name) => (
          <span key={`m-${name}`} className="rounded-full bg-[var(--kp-bg)] px-2 py-0.5 text-[10px] text-[var(--kp-text-2)]">
            MCP · {name}
            {data.mcpTools > 0 ? `（${data.mcpTools} 工具）` : ""}
          </span>
        ))}
      </div>
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
          checked ? "border-[var(--kp-brand)] bg-[var(--kp-brand-deep)] text-white" : "border-[var(--kp-divider)]",
        )}
      >
        {checked && <Check className="h-2.5 w-2.5" />}
      </span>
      <span>{label}</span>
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

  const update = (next: ToolSelection) => {
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

  return (
    <div className="space-y-4">
      <ToolPreview tools={serialized} />

      <section className="space-y-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--kp-text-3)]">
          <Wrench className="h-3.5 w-3.5" />
          内置工具
        </h3>
        <p className="text-[11px] text-[var(--kp-text-3)]">Agent 直接可用的系统能力，勾选后写入配置。</p>
        <div className="flex flex-wrap gap-2">
          {nativeTools.map((tool) => (
            <ToggleChip
              key={tool.name}
              checked={sel.native.has(tool.name)}
              label={NATIVE_LABELS[tool.name] ?? tool.name}
              hint={tool.description}
              onClick={() => toggleNative(tool.name)}
            />
          ))}
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
        <summary className="cursor-pointer text-[11px] text-[var(--kp-text-3)]">高级：查看原始配置行</summary>
        <pre className="mt-2 overflow-x-auto font-mono text-[10px] leading-relaxed text-[var(--kp-text-2)]">
          {serialized.length > 0 ? serialized.join("\n") : "（未授权任何工具）"}
        </pre>
      </details>
    </div>
  );
}

/** 列表卡片上的工具摘要（人类可读） */
export const AgentToolSummaryCard = memo(function AgentToolSummaryCard({ tools }: { tools: string[] }) {
  const { data, isLoading } = trpc.agent.toolSummary.useQuery(
    { tools },
    { staleTime: 60_000 },
  );

  if (isLoading || !data) {
    return <p className="text-[11px] text-[var(--kp-text-3)]">加载工具信息…</p>;
  }

  if (tools.length === 0) {
    return (
      <p className="text-[11px] leading-relaxed text-[var(--kp-text-2)]">
        未限制工具（默认全开）
      </p>
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
          <span key={name} className="rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg-mute)] px-2 py-0.5 text-[9px] text-[var(--kp-text-3)]">
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
          <span key={name} className="rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg-mute)] px-2 py-0.5 text-[9px] text-[var(--kp-text-3)]">
            MCP: {name}
          </span>
        ))}
      </div>
    </div>
  );
});
