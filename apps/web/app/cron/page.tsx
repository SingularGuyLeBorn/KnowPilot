/**
 * Agent Cron 管理 — 定时 briefing → session_spawn_goal
 * 列表按「配置页」字段展示；Prompt 为 Markdown 并渲染预览。
 */

"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlarmClock,
  Bot,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Eye,
  FileCode2,
  Loader2,
  Pause,
  PenLine,
  Play,
  Plus,
  Sparkles,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";
import { trpc, catchUnlessCancelled } from "@/lib/trpc";
import { describeCron } from "@/lib/cronDescribe";
import { agentLabel } from "@/lib/displayLabels";
import { cn } from "@/lib/utils";
import {
  AdminPage,
  ConfirmDialog,
  EmptyState,
  KpSelect,
  LoadingState,
} from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PostContent } from "@/components/post/PostContent";
import { postSessionListHint, UI_STATE_CHANNEL } from "@/lib/uiStateChannel";

const CRON_PRESETS = [
  { value: "0 8 * * *", label: "每天 08:00" },
  { value: "0 9 * * *", label: "每天 09:00" },
  { value: "0 9 * * 1-5", label: "工作日 09:00" },
  { value: "30 21 * * *", label: "每天 21:30" },
  { value: "0 */6 * * *", label: "每 6 小时" },
] as const;

const PROMPT_PLACEHOLDER = `## Briefing 专用

摸清 \`llm-interview\` 花园与 bus 现状后，写出今日完整执行 prompt，然后必须调用：

\`\`\`ts
session_spawn_goal({
  model: "deepseek-v4-flash",
  mode: "goal",
  title: "知乎面经日搜 · " + 今日日期,
  prompt: "<你写的完整执行说明>",
})
\`\`\`

### 执行说明须包含

- 按 \`config/prompts/zhihu-llm-interview-collect.md\`
- \`zhihu_openapi_search(scope=zhihu)\` 搜「大模型 面试」等
- 最多深读 8 篇、入库最多 15 题 → 花园 \`llm-interview\`
- 公式用 \`$…$\`；缺 \`ZHIHU_ACCESS_SECRET\` 则停并告知
- 结束后更新花园首页并 \`write_file\` 更新 bus

> 本 briefing 会话禁止亲自搜题入库。
`;

type CronForm = {
  agentId: string;
  name: string;
  cron: string;
  prompt: string;
  busPath: string;
  enabled: boolean;
};

const EMPTY_FORM: CronForm = {
  agentId: "",
  name: "",
  cron: "0 8 * * *",
  prompt: PROMPT_PLACEHOLDER,
  busPath: "",
  enabled: true,
};

/** 历史纯文本墙 → 可渲染 Markdown（已含 fence 则原样） */
function promptAsMarkdown(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  if (/```/.test(t)) return t;

  let out = t;
  out = out.replace(
    /(session_spawn_goal\s*\(\s*\{[\s\S]*?\}\s*\))/g,
    (block) => `\n\`\`\`ts\n${block.trim()}\n\`\`\`\n`,
  );

  // 首行【标题】→ ##
  out = out.replace(/^【([^】]+)】\s*/m, "## $1\n\n");

  // 「执行说明须要求：」起拆成列表感
  out = out.replace(
    /(执行说明须要求[：:])\s*/g,
    "\n### 执行说明须包含\n\n",
  );

  if (/本 briefing 会话禁止/.test(out) && !out.includes("> 本 briefing")) {
    out = out.replace(
      /(本 briefing 会话禁止亲自搜题入库。?)/,
      "\n\n> $1\n",
    );
  }

  return out;
}

function formatWhen(d: Date | string | null | undefined): string {
  if (!d) return "尚未运行";
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return "—";
  return t.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusDot({ status }: { status: string | null | undefined }) {
  if (!status) {
    return <span className="kp-badge kp-badge-info">待命</span>;
  }
  if (status === "running") {
    return (
      <span className="kp-badge kp-badge-info">
        <Loader2 className="h-3 w-3 animate-spin" />
        运行中
      </span>
    );
  }
  if (status === "success") {
    return (
      <span className="kp-badge kp-badge-success">
        <CheckCircle2 className="h-3 w-3" />
        成功
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="kp-badge kp-badge-danger">
        <XCircle className="h-3 w-3" />
        失败
      </span>
    );
  }
  return <span className="kp-badge kp-badge-warning">{status}</span>;
}

function ConfigRow({
  label,
  children,
  mono,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-3 border-b border-[var(--kp-divider-light)] py-2.5 last:border-b-0">
      <dt className="pt-0.5 text-[11px] font-semibold tracking-wide text-[var(--kp-text-3)]">
        {label}
      </dt>
      <dd
        className={cn(
          "min-w-0 break-words text-sm text-[var(--kp-text-1)]",
          mono && "font-mono text-xs text-[var(--kp-text-2)]",
        )}
      >
        {children}
      </dd>
    </div>
  );
}

/** 列表卡 Prompt：固定高度（原折叠 9.5rem × 1.2 ≈ 11.4rem），内部滚动，禁止撑破卡片 */
function PromptPreview({
  prompt,
  className,
}: {
  prompt: string;
  className?: string;
}) {
  const md = useMemo(() => promptAsMarkdown(prompt), [prompt]);
  return (
    <div
      className={cn(
        "h-[11.4rem] overflow-x-hidden overflow-y-auto overscroll-contain rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] px-3.5 py-3",
        className,
      )}
    >
      <PostContent
        content={md}
        className="prose-sm max-w-none break-words text-[var(--kp-text-1)] [&_h1]:mt-0 [&_h1]:text-base [&_h2]:mt-3 [&_h2]:text-sm [&_h3]:text-sm [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:text-[11px] [&_code]:break-all [&_code]:text-[11px]"
      />
    </div>
  );
}

type AwaitingFire = {
  sessionId: string;
  jobName: string;
  agentName: string;
};

export default function AgentCronPage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  // 推拉结合：PUSH=SSE/BC cron_job_updated；PULL=有 running 时 2s 轮询，否则 12s 兜底（无 Chat 开着也能动）
  const listQuery = trpc.agentCron.list.useQuery(
    {},
    {
      refetchInterval: (q) => {
        const items = q.state.data?.items ?? [];
        const busy = items.some((j) => j.lastRunStatus === "running");
        return busy ? 2000 : 12_000;
      },
    },
  );
  const agentsQuery = trpc.agent.list.useQuery({ page: 1, pageSize: 100 });
  const [fireHint, setFireHint] = useState<string | null>(null);
  const [promptTab, setPromptTab] = useState<"edit" | "preview">("edit");
  const [awaitingFire, setAwaitingFire] = useState<AwaitingFire | null>(null);
  /** 用户已关掉「是否跳转」弹窗（含留在本页） */
  const [jumpPromptDismissed, setJumpPromptDismissed] = useState(false);

  const upsertMutation = trpc.agentCron.upsert.useMutation({
    onSuccess: () => {
      listQuery.refetch().catch(catchUnlessCancelled("app/cron/page.tsx"));
      setComposerOpen(false);
      setForm(EMPTY_FORM);
      setFormError(null);
      setPromptTab("edit");
    },
  });
  const setEnabledMutation = trpc.agentCron.setEnabled.useMutation({
    onSuccess: () => listQuery.refetch().catch(catchUnlessCancelled("app/cron/page.tsx")),
  });
  const clearMutation = trpc.agentCron.clear.useMutation({
    onSuccess: () => {
      listQuery.refetch().catch(catchUnlessCancelled("app/cron/page.tsx"));
      setDeleteId(null);
    },
  });
  const fireTargetRef = React.useRef<{ jobName: string; agentName: string } | null>(null);
  const fireMutation = trpc.agentCron.fire.useMutation({
    onSuccess: (data) => {
      listQuery.refetch().catch(catchUnlessCancelled("app/cron/page.tsx"));
      utils.session.list.invalidate().catch(catchUnlessCancelled("app/cron/page.tsx"));
      if (!data.sessionId) {
        setFireHint("已触发，但未返回会话 id");
        return;
      }
      const meta = fireTargetRef.current;
      setAwaitingFire({
        sessionId: data.sessionId,
        jobName: meta?.jobName ?? "定时任务",
        agentName: meta?.agentName ?? "Agent",
      });
      setJumpPromptDismissed(false);
      setFireHint("已在对应 Agent 下启动 briefing 会话（不跳转），等待回复…");
      postSessionListHint(data.sessionId);
    },
    onError: (err) => {
      setFireHint(err.message || "触发失败");
    },
  });

  // PUSH 跨标签：Chat SSE → BC → 本页立刻拉；无 Chat 时靠上面 refetchInterval
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channels: BroadcastChannel[] = [];
    const onMsg = (ev: MessageEvent) => {
      const t = (ev.data as { type?: string } | null)?.type;
      if (t === "cron_job_updated" || t === "cron_session_started" || t === "session_list_changed") {
        listQuery.refetch().catch(catchUnlessCancelled("app/cron/page.tsx"));
        utils.session.list.invalidate().catch(catchUnlessCancelled("app/cron/page.tsx"));
      }
    };
    for (const name of [UI_STATE_CHANNEL]) {
      try {
        const bc = new BroadcastChannel(name);
        bc.addEventListener("message", onMsg);
        channels.push(bc);
      } catch {
        /* ignore */
      }
    }
    return () => {
      for (const bc of channels) {
        bc.removeEventListener("message", onMsg);
        bc.close();
      }
    };
  }, [listQuery, utils]);

  // 等 briefing 出现 assistant 回复（或会话终态）后再弹跳转询问——不立刻离开 Cron 页
  const watchSessionQuery = trpc.session.getById.useQuery(
    { id: awaitingFire?.sessionId ?? "" },
    {
      enabled: !!awaitingFire && !jumpPromptDismissed,
      refetchInterval: (q) => {
        const st = q.state.data?.status;
        if (st === "completed" || st === "failed" || st === "paused" || st === "archived") {
          return false;
        }
        return 1500;
      },
    },
  );
  const watchMessagesQuery = trpc.message.listForChat.useQuery(
    { sessionId: awaitingFire?.sessionId ?? "", limit: 30 },
    {
      enabled: !!awaitingFire && !jumpPromptDismissed,
      refetchInterval: 1500,
    },
  );

  const briefingReady = useMemo(() => {
    if (!awaitingFire) return false;
    const status = watchSessionQuery.data?.status;
    const items = watchMessagesQuery.data?.items ?? [];
    const hasAssistant = items.some(
      (m) => m.role === "assistant" && typeof m.content === "string" && m.content.trim().length > 0,
    );
    const terminal =
      status === "completed" || status === "failed" || status === "paused" || status === "archived";
    return hasAssistant || terminal;
  }, [
    awaitingFire,
    watchSessionQuery.data?.status,
    watchMessagesQuery.data?.items,
  ]);

  const jumpAskOpen = !!awaitingFire && briefingReady && !jumpPromptDismissed;
  const fireStatusHint = awaitingFire
    ? jumpAskOpen
      ? "Briefing 已有进展，可选择是否打开会话"
      : "已在对应 Agent 下启动 briefing 会话（不跳转），等待回复…"
    : fireHint;

  const [composerOpen, setComposerOpen] = useState(false);
  const [form, setForm] = useState<CronForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "on" | "off">("all");
  const agentOptions = useMemo(() => {
    const items = (agentsQuery.data?.items ?? []).filter(
      (a: { tier?: string; status?: string }) =>
        a.status !== "deleted" && (a.tier === "super" || a.tier === "manager"),
    );
    return items.map((a: { id: string; name: string; autoName?: string | null; tier?: string }) => ({
      value: a.id,
      label: `${agentLabel(a)}${a.tier === "super" ? " · 超级" : ""}`,
    }));
  }, [agentsQuery.data?.items]);

  const items = useMemo(() => {
    const raw = listQuery.data?.items ?? [];
    if (filter === "on") return raw.filter((r) => r.enabled);
    if (filter === "off") return raw.filter((r) => !r.enabled);
    return raw;
  }, [listQuery.data?.items, filter]);

  const openCreate = () => {
    const defaultAgent =
      agentOptions.find((o) => o.label.includes("超级"))?.value ||
      agentOptions[0]?.value ||
      "";
    setForm({ ...EMPTY_FORM, agentId: defaultAgent });
    setFormError(null);
    setPromptTab("edit");
    setComposerOpen(true);
  };

  const openEdit = (row: (typeof items)[number]) => {
    setForm({
      agentId: row.agentId,
      name: row.name,
      cron: row.cron,
      prompt: promptAsMarkdown(row.prompt),
      busPath: row.busPath ?? "",
      enabled: row.enabled,
    });
    setFormError(null);
    setPromptTab("preview");
    setComposerOpen(true);
  };

  const submit = () => {
    if (!form.agentId) {
      setFormError("请选择 Agent");
      return;
    }
    if (!form.name.trim()) {
      setFormError("请填写任务名");
      return;
    }
    if (form.prompt.trim().length < 8) {
      setFormError("prompt 至少 8 字，写清每次点火要做什么");
      return;
    }
    setFormError(null);
    upsertMutation.mutate({
      agentId: form.agentId,
      name: form.name.trim(),
      cron: form.cron.trim(),
      prompt: form.prompt.trim(),
      busPath: form.busPath.trim() || null,
      enabled: form.enabled,
    });
  };

  const spring = { type: "spring" as const, stiffness: 260, damping: 26 };

  return (
    <AdminPage>
      <div className="relative mb-8 overflow-hidden rounded-3xl border border-[var(--kp-divider)]">
        <div
          className="absolute inset-0 opacity-90"
          style={{
            background:
              "radial-gradient(120% 80% at 10% 0%, color-mix(in srgb, var(--kp-brand) 28%, transparent), transparent 55%)," +
              "radial-gradient(90% 70% at 90% 20%, color-mix(in srgb, var(--kp-brand-deep) 18%, transparent), transparent 50%)," +
              "linear-gradient(165deg, var(--kp-bg-alt), var(--kp-bg))",
          }}
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, var(--kp-brand-deep) 1px, transparent 0)",
            backgroundSize: "22px 22px",
          }}
        />
        <div className="relative flex flex-col gap-6 px-6 py-8 md:flex-row md:items-end md:justify-between md:px-8">
          <div className="max-w-xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg)]/60 px-3 py-1 text-[11px] font-medium text-[var(--kp-brand-deep)] backdrop-blur">
              <AlarmClock className="h-3.5 w-3.5" />
              Agent Cron · Briefing → Goal
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-[var(--kp-text-1)]">
                定时节律
              </h1>
              <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-[var(--kp-text-3)]">
                到点新建 briefing 会话，摸清现状后 spawn goal 执行。与心跳、Triggers 正交——这里只管 Agent 自设定时。
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              onClick={openCreate}
              className="gap-1.5 rounded-xl shadow-sm"
            >
              <Plus className="h-4 w-4" />
              新建节律
            </Button>
          </div>
        </div>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {[
          {
            icon: CalendarClock,
            label: "全部任务",
            value: listQuery.data?.total ?? "—",
          },
          {
            icon: Zap,
            label: "已启用",
            value: listQuery.data?.enabledCount ?? "—",
          },
          {
            icon: Pause,
            label: "已暂停",
            value:
              listQuery.data != null
                ? listQuery.data.total - listQuery.data.enabledCount
                : "—",
          },
        ].map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: i * 0.04 }}
            className="kp-card-premium kp-lift rounded-2xl p-4"
          >
            <div className="flex items-center gap-2 text-[var(--kp-text-3)]">
              <s.icon className="h-4 w-4" />
              <span className="text-xs font-medium">{s.label}</span>
            </div>
            <p className="kp-stat-number mt-2">{s.value}</p>
          </motion.div>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(
          [
            ["all", "全部"],
            ["on", "运行中"],
            ["off", "已暂停"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors",
              filter === k
                ? "bg-[var(--kp-brand-deep)] text-[var(--kp-bg)]"
                : "bg-[var(--kp-bg-soft)] text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)]",
            )}
          >
            {label}
          </button>
        ))}
        {fireStatusHint ? (
          <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-[var(--kp-brand-deep)]">
            {awaitingFire && !jumpAskOpen ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : null}
            {fireStatusHint}
          </span>
        ) : null}
      </div>

      {listQuery.isLoading ? (
        <LoadingState />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Clock3 className="h-6 w-6" />}
          title={filter === "all" ? "还没有定时节律" : "没有符合筛选的任务"}
          description={
            filter === "all"
              ? "新建一条，或在 Chat 里让超级 Agent / assistant 调用 agent_cron_set。"
              : "切换筛选看看其它状态。"
          }
          actionLabel={filter === "all" ? "新建第一条" : undefined}
          onAction={filter === "all" ? openCreate : undefined}
        />
      ) : (
        <div className="grid gap-4">
          <AnimatePresence mode="popLayout">
            {items.map((row, idx) => (
                <motion.article
                  key={row.id}
                  layout
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ ...spring, delay: Math.min(idx * 0.03, 0.2) }}
                  className={cn(
                    "kp-card-premium group relative overflow-hidden rounded-2xl p-5",
                    !row.enabled && "opacity-75",
                  )}
                >
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-stretch lg:gap-6">
                    {/* 节律摘要 */}
                    <div className="flex shrink-0 flex-col items-center justify-center rounded-2xl border border-[var(--kp-divider-light)] bg-[var(--kp-bg-alt)] px-4 py-5 lg:w-40">
                      <div
                        className={cn(
                          "relative flex h-24 w-24 items-center justify-center rounded-full",
                          row.enabled
                            ? "bg-[color-mix(in_srgb,var(--kp-brand)_16%,transparent)]"
                            : "bg-[var(--kp-bg-soft)]",
                        )}
                      >
                        <div
                          className={cn(
                            "absolute inset-2 rounded-full border-2 border-dashed",
                            row.enabled
                              ? "border-[var(--kp-brand)] animate-[spin_28s_linear_infinite]"
                              : "border-[var(--kp-divider)]",
                          )}
                        />
                        <div className="relative text-center">
                          <Clock3
                            className={cn(
                              "mx-auto h-5 w-5",
                              row.enabled
                                ? "text-[var(--kp-brand-deep)]"
                                : "text-[var(--kp-text-3)]",
                            )}
                          />
                          <p className="mt-1 max-w-[5rem] text-[11px] font-semibold leading-tight text-[var(--kp-text-1)]">
                            {describeCron(row.cron)}
                          </p>
                        </div>
                      </div>
                      <code className="mt-3 rounded-md bg-[var(--kp-bg)] px-2 py-0.5 font-mono text-[10px] text-[var(--kp-text-3)]">
                        {row.cron}
                      </code>
                    </div>

                    {/* 配置表 */}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <h2 className="text-lg font-semibold tracking-tight text-[var(--kp-text-1)]">
                            {row.name}
                          </h2>
                          <p className="mt-0.5 text-[11px] text-[var(--kp-text-3)]">
                            节律配置 · Briefing → session_spawn_goal
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {row.enabled ? (
                            <span className="kp-badge kp-badge-success">启用</span>
                          ) : (
                            <span className="kp-badge kp-badge-warning">暂停</span>
                          )}
                          <StatusDot status={row.lastRunStatus} />
                        </div>
                      </div>

                      <dl className="mt-3 rounded-xl border border-[var(--kp-divider-light)] bg-[var(--kp-bg)]/40 px-3.5">
                        <ConfigRow label="Agent">
                          <span className="inline-flex items-center gap-1.5">
                            <Bot className="h-3.5 w-3.5 text-[var(--kp-text-3)]" />
                            {row.agentName}
                            {row.agentTier ? (
                              <span className="text-[var(--kp-text-3)]">· {row.agentTier}</span>
                            ) : null}
                          </span>
                        </ConfigRow>
                        <ConfigRow label="频率">
                          {describeCron(row.cron)}
                          <span className="ml-2 font-mono text-[11px] text-[var(--kp-text-3)]">
                            {row.cron}
                          </span>
                        </ConfigRow>
                        <ConfigRow label="Bus" mono>
                          {row.busPath || (
                            <span className="font-sans text-[var(--kp-text-3)]">未设置</span>
                          )}
                        </ConfigRow>
                        <ConfigRow label="上次运行">
                          <span className="inline-flex flex-wrap items-center gap-2">
                            {formatWhen(row.lastRunAt)}
                            {row.lastSessionId ? (
                              <Link
                                href={`/chat?sessionId=${row.lastSessionId}`}
                                className="text-[var(--kp-brand-deep)] underline-offset-2 hover:underline"
                              >
                                打开会话
                              </Link>
                            ) : null}
                          </span>
                        </ConfigRow>
                      </dl>

                      <div className="mt-4 min-w-0">
                        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-[var(--kp-text-3)]">
                          <FileCode2 className="h-3.5 w-3.5" />
                          Briefing Prompt
                          <span className="font-normal text-[var(--kp-text-3)]">· Markdown</span>
                        </div>
                        <PromptPreview prompt={row.prompt} />
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="gap-1 rounded-xl"
                          disabled={setEnabledMutation.isPending}
                          onClick={() =>
                            setEnabledMutation.mutate({
                              id: row.id,
                              enabled: !row.enabled,
                            })
                          }
                        >
                          {row.enabled ? (
                            <>
                              <Pause className="h-3.5 w-3.5" /> 暂停
                            </>
                          ) : (
                            <>
                              <Play className="h-3.5 w-3.5" /> 启用
                            </>
                          )}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="gap-1 rounded-xl"
                          disabled={!row.enabled || fireMutation.isPending}
                          onClick={() => {
                            fireTargetRef.current = {
                              jobName: row.name,
                              agentName: row.agentName,
                            };
                            fireMutation.mutate({ id: row.id });
                          }}
                        >
                          {fireMutation.isPending ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="h-3.5 w-3.5" />
                          )}
                          立刻跑一次
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="gap-1 rounded-xl"
                          onClick={() => openEdit(row)}
                        >
                          <PenLine className="h-3.5 w-3.5" />
                          编辑
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="gap-1 rounded-xl text-red-600 hover:text-red-700"
                          onClick={() => setDeleteId(row.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          删除
                        </Button>
                      </div>
                      {fireMutation.isError && fireMutation.variables?.id === row.id ? (
                        <p className="mt-2 text-xs text-red-600">
                          {(fireMutation.error as Error)?.message ?? "触发失败"}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </motion.article>
            ))}
          </AnimatePresence>
        </div>
      )}

      <AnimatePresence>
        {composerOpen ? (
          <motion.div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 backdrop-blur-[2px] sm:items-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !upsertMutation.isPending && setComposerOpen(false)}
          >
            <motion.div
              role="dialog"
              aria-labelledby="cron-composer-title"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={spring}
              className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[var(--kp-divider)] bg-[var(--kp-bg)] p-5 shadow-xl sm:p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h2
                id="cron-composer-title"
                className="text-lg font-semibold text-[var(--kp-text-1)]"
              >
                {form.name && items.some((i) => i.name === form.name && i.agentId === form.agentId)
                  ? "编辑节律配置"
                  : "新建节律配置"}
              </h2>
              <p className="mt-1 text-xs text-[var(--kp-text-3)]">
                同 Agent + 同名会覆盖。Prompt 请用 Markdown；到点开 briefing，须调用{" "}
                <code className="rounded bg-[var(--kp-bg-soft)] px-1">session_spawn_goal</code>。
              </p>

              <div className="mt-4 space-y-4">
                <div className="rounded-xl border border-[var(--kp-divider-light)] px-3.5">
                  <label className="block border-b border-[var(--kp-divider-light)] py-3">
                    <span className="text-[11px] font-semibold text-[var(--kp-text-3)]">Agent</span>
                    <div className="mt-1.5">
                      <KpSelect
                        value={form.agentId}
                        onChange={(v) => setForm((f) => ({ ...f, agentId: v }))}
                        options={agentOptions}
                        placeholder="选择 super / manager"
                      />
                    </div>
                  </label>
                  <label className="block border-b border-[var(--kp-divider-light)] py-3">
                    <span className="text-[11px] font-semibold text-[var(--kp-text-3)]">任务名</span>
                    <Input
                      className="mt-1.5"
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="zhihu-llm-interview-daily"
                    />
                  </label>
                  <div className="border-b border-[var(--kp-divider-light)] py-3">
                    <span className="text-[11px] font-semibold text-[var(--kp-text-3)]">频率</span>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {CRON_PRESETS.map((p) => (
                        <button
                          key={p.value}
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, cron: p.value }))}
                          className={cn(
                            "rounded-full px-2.5 py-1 text-[11px] transition-colors",
                            form.cron === p.value
                              ? "bg-[var(--kp-brand-deep)] text-[var(--kp-bg)]"
                              : "bg-[var(--kp-bg-soft)] text-[var(--kp-text-2)] hover:bg-[var(--kp-bg-mute)]",
                          )}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                    <Input
                      className="mt-2 font-mono text-sm"
                      value={form.cron}
                      onChange={(e) => setForm((f) => ({ ...f, cron: e.target.value }))}
                      placeholder="0 8 * * *"
                    />
                    <span className="mt-1 block text-[11px] text-[var(--kp-text-3)]">
                      {describeCron(form.cron)} · 本机时区
                    </span>
                  </div>
                  <label className="block py-3">
                    <span className="text-[11px] font-semibold text-[var(--kp-text-3)]">
                      Bus 文件（可选）
                    </span>
                    <Input
                      className="mt-1.5 font-mono text-sm"
                      value={form.busPath}
                      onChange={(e) => setForm((f) => ({ ...f, busPath: e.target.value }))}
                      placeholder="cron-bus/zhihu-interview-state.md"
                    />
                  </label>
                </div>

                <div>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-[var(--kp-text-3)]">
                      Briefing Prompt · Markdown
                    </span>
                    <div className="flex rounded-lg border border-[var(--kp-divider)] p-0.5">
                      <button
                        type="button"
                        onClick={() => setPromptTab("edit")}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium",
                          promptTab === "edit"
                            ? "bg-[var(--kp-brand-deep)] text-[var(--kp-bg)]"
                            : "text-[var(--kp-text-2)]",
                        )}
                      >
                        <PenLine className="h-3 w-3" />
                        编辑
                      </button>
                      <button
                        type="button"
                        onClick={() => setPromptTab("preview")}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium",
                          promptTab === "preview"
                            ? "bg-[var(--kp-brand-deep)] text-[var(--kp-bg)]"
                            : "text-[var(--kp-text-2)]",
                        )}
                      >
                        <Eye className="h-3 w-3" />
                        预览
                      </button>
                    </div>
                  </div>
                  {promptTab === "edit" ? (
                    <textarea
                      className="min-h-[220px] w-full resize-y rounded-xl border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] px-3 py-2 font-mono text-xs leading-relaxed text-[var(--kp-text-1)] outline-none focus:border-[var(--kp-brand)]"
                      value={form.prompt}
                      onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
                      placeholder={PROMPT_PLACEHOLDER}
                      spellCheck={false}
                    />
                  ) : (
                    <PromptPreview
                      prompt={form.prompt || PROMPT_PLACEHOLDER}
                      className="h-[16rem]"
                    />
                  )}
                </div>

                <label className="flex items-center gap-2 text-xs text-[var(--kp-text-2)]">
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
                    className="rounded border-[var(--kp-divider)]"
                  />
                  保存后立即启用
                </label>

                {formError ? (
                  <p className="text-xs text-red-600">{formError}</p>
                ) : null}
                {upsertMutation.isError ? (
                  <p className="text-xs text-red-600">
                    {(upsertMutation.error as Error)?.message ?? "保存失败"}
                  </p>
                ) : null}
              </div>

              <div className="mt-5 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={upsertMutation.isPending}
                  onClick={() => setComposerOpen(false)}
                >
                  取消
                </Button>
                <Button
                  type="button"
                  className="gap-1.5"
                  disabled={upsertMutation.isPending}
                  onClick={submit}
                >
                  {upsertMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  保存配置
                </Button>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <ConfirmDialog
        isOpen={!!deleteId}
        title="删除这条定时节律？"
        description="删除后不会再触发；已产生的历史会话不会被删。"
        confirmLabel="删除"
        isDestructive
        onConfirm={() => {
          if (deleteId) clearMutation.mutate({ id: deleteId });
        }}
        onCancel={() => setDeleteId(null)}
      />

      <ConfirmDialog
        isOpen={jumpAskOpen}
        title="Briefing 已有进展"
        description={
          awaitingFire
            ? `「${awaitingFire.jobName}」在 ${awaitingFire.agentName} 下的会话已产生回复。是否打开该会话查看？`
            : ""
        }
        confirmLabel="打开会话"
        cancelLabel="留在本页"
        onConfirm={() => {
          if (awaitingFire) router.push(`/chat?sessionId=${awaitingFire.sessionId}`);
          setJumpPromptDismissed(true);
          setAwaitingFire(null);
          setFireHint(null);
        }}
        onCancel={() => {
          setJumpPromptDismissed(true);
          setFireHint("已留在 Cron 页；可稍后从「打开会话」进入");
        }}
      />
    </AdminPage>
  );
}
