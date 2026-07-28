/**
 * 平台每日同步 — 自动化与工作流
 * 立即同步：任务在服务端后台跑；本页只轮询 latest 展示进度，切页不影响执行
 */

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  RefreshCw,
  Inbox,
  Play,
  CalendarClock,
  Check,
  Loader2,
  BookMarked,
  AlertCircle,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Task } from "@knowpilot/shared";
import { useTask, useInbox } from "@/lib/hooks";
import { AdminPage, LoadingState } from "@/components/shared";
import { cn } from "@/lib/utils";

const TASK_NAME = "Inbox 平台每日同步";
const DEFAULT_CRON = "0 3 * * *";
const SYNC_JOB_ID_KEY = "kp-inbox-platform-sync-job-id";
const CHILD_PAGE_SIZE = 8;

type SyncFlags = {
  xhs: boolean;
  screenshots: boolean;
  wechat: boolean;
  zhihu: boolean;
  bilibili: boolean;
};

type SyncStepChild = {
  id: string;
  label: string;
  total: number;
  done: number;
  status?: "pending" | "running" | "done" | "error";
  message?: string;
};

type SyncStep = {
  key: string;
  label: string;
  status: "pending" | "running" | "done" | "error" | "skipped";
  total: number;
  done: number;
  created?: number;
  updated?: number;
  message?: string;
  /** 最近活动行（新在前） */
  recent?: string[];
  children?: SyncStepChild[];
};

type SyncJob = {
  id: string;
  status: "running" | "done" | "failed" | "cancelled";
  mode: "full" | "incremental";
  steps: SyncStep[];
  currentLabel?: string;
  error?: string;
};

function parseTaskInput(task: Task | undefined): SyncFlags & { cron: string } {
  if (!task) {
    return {
      xhs: true,
      screenshots: true,
      wechat: true,
      zhihu: true,
      bilibili: true,
      cron: DEFAULT_CRON,
    };
  }
  const input = (task.input ?? {}) as Record<string, unknown>;
  return {
    xhs: input.xhs !== false,
    screenshots: input.screenshots !== false,
    wechat: input.wechat !== false,
    zhihu: input.zhihu === true || typeof input.zhihuCollectionUrl === "string",
    bilibili: input.bilibili === true,
    cron: task.cronExpression || DEFAULT_CRON,
  };
}

function StepStatusIcon({ status }: { status: SyncStep["status"] | SyncStepChild["status"] }) {
  if (status === "running") {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--kp-brand-deep)]" />;
  }
  if (status === "done") return <Check className="h-3.5 w-3.5 text-emerald-600" />;
  if (status === "error") return <AlertCircle className="h-3.5 w-3.5 text-red-500" />;
  return <span className="h-2 w-2 rounded-full bg-[var(--kp-border)]" />;
}

function jobSummaryLine(job: SyncJob): string {
  const created = job.steps.reduce((n, s) => n + (s.created ?? 0), 0);
  const updated = job.steps.reduce((n, s) => n + (s.updated ?? 0), 0);
  const errors = job.steps.filter((s) => s.status === "error").length;
  const modeLabel = job.mode === "full" ? "全量" : "增量";
  if (job.status === "running") {
    return `正在同步${job.currentLabel ? ` · ${job.currentLabel}` : ""}`;
  }
  if (created === 0 && updated === 0 && errors > 0) {
    return `${modeLabel}未写入任何条目（${errors} 步失败）— 请检查登录态`;
  }
  if (created === 0 && updated === 0) {
    return `${modeLabel}结束：未发现新条目（Inbox 可能仍为空）`;
  }
  if (job.status === "cancelled") {
    return `${modeLabel}已停止：新 ${created} · 更新 ${updated}（已写入保留）`;
  }
  if (job.status === "failed") {
    return `${modeLabel}结束：新 ${created} · 更新 ${updated} · ${errors} 步失败`;
  }
  return `${modeLabel}完成：新 ${created} · 更新 ${updated}`;
}

/** done/total：列表落盘或 feed 补拉阶段都会推进 */
function writeProgressLabel(done: number, total: number, status: string): string {
  if (status === "pending") return "等待";
  if (status === "running" && total <= 0) return "拉取列表…";
  if (status === "done" || status === "error") {
    return total > 0 ? `已写 ${done}（列表约 ${total}）` : `已写 ${done}`;
  }
  if (total > 0) return `${done} / ${total}`;
  return `已写 ${done}`;
}

/** 进行中用 done/total；结束态条拉满 */
function writeProgressPct(done: number, total: number, status: string): number {
  if (status === "pending") return 0;
  if (status === "done" || status === "error") return 100;
  // total=0：不定进度占位，避免条看起来完全不动
  if (total <= 0) return status === "running" ? 12 : 0;
  return Math.min(100, Math.max(2, Math.round((done / total) * 100)));
}

function folderProgressLabel(children: SyncStepChild[]): string | null {
  if (!children.length) return null;
  const finished = children.filter((c) => c.status === "done" || c.status === "error").length;
  const running = children.some((c) => c.status === "running");
  if (running) return `收藏夹 ${finished}/${children.length} · 处理中`;
  return `收藏夹 ${finished}/${children.length} 已处理`;
}

export default function PlatformSyncPage() {
  const { useList, useCreate, useUpdate, useRun } = useTask();
  const {
    useStartPlatformSync,
    useCancelPlatformSync,
    useLatestPlatformSync,
    invalidateInboxQueries,
  } = useInbox();
  const { data, isLoading, refetch } = useList({ page: 1, pageSize: 50 });
  const createMutation = useCreate();
  const updateMutation = useUpdate();
  const runMutation = useRun();
  const startSync = useStartPlatformSync();
  const cancelSync = useCancelPlatformSync();

  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cronOverride, setCronOverride] = useState<string | null>(null);
  const [flagsOverride, setFlagsOverride] = useState<SyncFlags | null>(null);
  const [syncJob, setSyncJob] = useState<SyncJob | null>(null);
  const dismissedJobIdRef = useRef<string | null>(null);
  const wasRunningRef = useRef(false);
  const [childrenExpanded, setChildrenExpanded] = useState(true);
  const [childPage, setChildPage] = useState(0);
  /** 手动翻页后不再自动跟随 running 夹 */
  const [childPagePinned, setChildPagePinned] = useState(false);

  // React Query 定时 refetch（勿用 utils.fetch 缓存，否则进度卡住要手动刷新）
  const { data: latestFromQuery } = useLatestPlatformSync({
    refetchInterval: (query: { state: { data: SyncJob | null | undefined } }) =>
      query.state.data?.status === "running" ? 800 : 5000,
    refetchIntervalInBackground: true,
    structuralSharing: false,
  });

  useEffect(() => {
    const latest = latestFromQuery as SyncJob | null | undefined;
    if (!latest) return;
    if (latest.status === "running") {
      dismissedJobIdRef.current = null;
    } else if (dismissedJobIdRef.current === latest.id) {
      return;
    }
    setSyncJob(latest);
    try {
      sessionStorage.setItem(SYNC_JOB_ID_KEY, latest.id);
    } catch {
      /* ignore */
    }
    if (wasRunningRef.current && latest.status !== "running") {
      invalidateInboxQueries();
    }
    wasRunningRef.current = latest.status === "running";
  }, [latestFromQuery, invalidateInboxQueries]);

  const syncTask = useMemo(() => {
    const items = data?.items ?? [];
    return items.find((t: Task) => {
      const input = t.input as { action?: string } | null;
      return t.name === TASK_NAME || input?.action === "inbox:sync";
    });
  }, [data?.items]);

  const parsed = useMemo(() => parseTaskInput(syncTask), [syncTask]);
  const cron = cronOverride ?? parsed.cron;
  const flags = flagsOverride ?? {
    xhs: parsed.xhs,
    screenshots: parsed.screenshots,
    wechat: parsed.wechat,
    zhihu: parsed.zhihu,
    bilibili: parsed.bilibili,
  };

  const setCron = (value: string) => setCronOverride(value);
  const setFlags = (updater: (prev: SyncFlags) => SyncFlags) => {
    setFlagsOverride((prev) => updater(prev ?? flags));
  };

  const buildInput = () => ({
    action: "inbox:sync",
    xhs: flags.xhs,
    screenshots: flags.screenshots,
    wechat: flags.wechat,
    zhihu: flags.zhihu,
    bilibili: flags.bilibili,
    zhihuMode: "incremental",
    xhsMode: "incremental",
    bilibiliMode: "incremental",
    xhsKinds: ["liked", "collect"],
    bilibiliKinds: ["fav", "toview"],
    maxItems: 200,
    fetchContent: false,
  });

  const enableDaily = async () => {
    setBusy("启用每日同步");
    setNotice(null);
    try {
      if (syncTask) {
        await updateMutation.mutateAsync({
          id: syncTask.id,
          cronExpression: cron.trim() || DEFAULT_CRON,
          type: "cron",
          status: "pending",
          input: buildInput(),
        });
      } else {
        await createMutation.mutateAsync({
          name: TASK_NAME,
          type: "cron",
          status: "pending",
          cronExpression: cron.trim() || DEFAULT_CRON,
          input: buildInput(),
          output: {},
        });
      }
      await refetch().catch(() => {});
      setNotice("已启用每日同步：调度器已热注册，无需重启服务");
    } catch (err) {
      setNotice(`启用失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const runNowScheduled = async () => {
    if (!syncTask) {
      setNotice("请先启用每日同步，或用下方「立即增量同步」");
      return;
    }
    setBusy("执行定时任务");
    setNotice(null);
    try {
      const res = await runMutation.mutateAsync({ id: syncTask.id });
      if ((res as { success?: boolean })?.success === false) {
        setNotice(`执行失败: ${(res as { error?: { message?: string } }).error?.message ?? "未知"}`);
      } else {
        setNotice("已触发定时任务执行，结果进知识 Inbox");
        invalidateInboxQueries();
      }
      await refetch().catch(() => {});
    } catch (err) {
      setNotice(`失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const runManualSync = async (mode: "incremental" | "full" | "probe") => {
    const label =
      mode === "probe" ? "试跑 list10/入库3" : mode === "full" ? "立即全量同步" : "立即增量同步";
    if (
      !flags.zhihu &&
      !flags.xhs &&
      !flags.bilibili &&
      !flags.screenshots &&
      !flags.wechat
    ) {
      setNotice("请先勾选至少一个平台（可用全选）");
      return;
    }
    if (syncJob?.status === "running" || busy?.startsWith("立即") || busy?.startsWith("试跑")) {
      setNotice("已有同步进行中，请等待结束后再试");
      return;
    }
    setBusy(label);
    setNotice(null);
    dismissedJobIdRef.current = null;
    try {
      const res = await startSync.mutateAsync({
        mode: mode === "full" ? "full" : "incremental",
        zhihu: flags.zhihu,
        xhs: flags.xhs,
        bilibili: flags.bilibili,
        screenshots: flags.screenshots,
        wechat: flags.wechat,
        ...(mode === "probe"
          ? { probe: true, maxItems: 10, maxUpsert: 3 }
          : { maxItems: mode === "full" ? 2000 : 200 }),
        fetchContent: false,
      });
      const started = res as { jobId: string; job: SyncJob };
      setSyncJob(started.job);
      setChildPage(0);
      setChildPagePinned(false);
      setChildrenExpanded(true);
      try {
        sessionStorage.setItem(SYNC_JOB_ID_KEY, started.jobId);
      } catch {
        /* ignore */
      }
    } catch (err) {
      setNotice(`启动失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const syncRunning =
    syncJob?.status === "running" ||
    !!busy?.startsWith("立即") ||
    !!busy?.startsWith("试跑");
  const activeSteps = syncJob?.steps.filter((s) => s.status !== "skipped") ?? [];

  // 知乎子进度分页：有 running 夹时跟过去；否则用手动翻页
  const zhihuStep = activeSteps.find((s) => s.key === "zhihu");
  const zhihuChildren = zhihuStep?.children ?? [];
  const childTotalPages = Math.max(1, Math.ceil(zhihuChildren.length / CHILD_PAGE_SIZE));
  const runningChildIdx = zhihuChildren.findIndex((c) => c.status === "running");
  const followPage =
    !childPagePinned && runningChildIdx >= 0
      ? Math.floor(runningChildIdx / CHILD_PAGE_SIZE)
      : childPage;
  const safeChildPage = Math.min(Math.max(0, followPage), childTotalPages - 1);
  const pagedChildren = zhihuChildren.slice(
    safeChildPage * CHILD_PAGE_SIZE,
    safeChildPage * CHILD_PAGE_SIZE + CHILD_PAGE_SIZE,
  );

  const platformCards = [
    { key: "zhihu" as const, source: "zhihu", label: "知乎收藏夹", desc: "自动发现全部夹 · 连续10条已落盘才早停" },
    { key: "xhs" as const, source: "xhs", label: "小红书点赞+收藏", desc: "双 Tab · 连续10条已落盘才早停" },
    { key: "bilibili" as const, source: "bilibili", label: "B站收藏+稍后再看", desc: "SESSDATA · 连续10条已落盘才早停" },
    { key: "screenshots" as const, source: "screenshot", label: "截图 drop", desc: "扫描 data/inbox/screenshots/drop" },
    { key: "wechat" as const, source: "wechat", label: "微信 links.txt", desc: "读取 wechat/links.txt" },
  ];

  const selectedCount = platformCards.filter((p) => flags[p.key]).length;
  const allSelected = selectedCount === platformCards.length;
  const noneSelected = selectedCount === 0;

  const selectAllPlatforms = () => {
    setFlags(() => ({
      zhihu: true,
      xhs: true,
      bilibili: true,
      screenshots: true,
      wechat: true,
    }));
  };

  const selectNonePlatforms = () => {
    setFlags(() => ({
      zhihu: false,
      xhs: false,
      bilibili: false,
      screenshots: false,
      wechat: false,
    }));
  };

  return (
    <AdminPage>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--kp-border)] pb-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-[var(--kp-text-1)]">
            平台每日同步
          </h1>
          <p className="mt-0.5 text-xs text-[var(--kp-text-3)]">
            后台拉到 Inbox · 切页不中断
            {syncTask
              ? ` · 定时已启用 · 上次 ${
                  syncTask.finishedAt
                    ? new Date(syncTask.finishedAt).toLocaleString()
                    : "尚未运行"
                }`
              : " · 定时未启用"}
          </p>
        </div>
        <Link
          href="/inbox"
          className="inline-flex h-8 items-center rounded-md border border-[var(--kp-border)] bg-[var(--kp-surface)] px-3 text-sm hover:bg-[var(--kp-bg-mute)]"
        >
          <Inbox className="mr-1.5 h-3.5 w-3.5" />
          Inbox
        </Link>
      </header>

      {isLoading ? (
        <LoadingState />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)] lg:items-start">
          {/* 左栏：控制面，窄而密 */}
          <aside className="space-y-4 lg:sticky lg:top-3">
            <section className="rounded-xl border border-[var(--kp-border)] bg-[var(--kp-surface)] p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kp-text-3)]">
                  定时
                </h2>
              </div>
              <label className="block text-[11px] text-[var(--kp-text-3)]">
                Cron
                <Input
                  className="mt-1 h-8 font-mono text-xs"
                  value={cron}
                  onChange={(e) => setCron(e.target.value)}
                  placeholder={DEFAULT_CRON}
                />
              </label>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button size="sm" className="h-8" disabled={!!busy || syncRunning} onClick={() => enableDaily()}>
                  {busy === "启用每日同步" ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CalendarClock className="mr-1 h-3.5 w-3.5" />
                  )}
                  {syncTask ? "更新" : "启用"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  disabled={!!busy || syncRunning || !syncTask}
                  onClick={() => runNowScheduled()}
                >
                  <Play className="mr-1 h-3.5 w-3.5" />
                  跑一次
                </Button>
              </div>
            </section>

            <section className="rounded-xl border border-[var(--kp-border)] bg-[var(--kp-surface)] p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kp-text-3)]">
                  平台
                  <span className="ml-1.5 font-normal normal-case tracking-normal">
                    {selectedCount}/{platformCards.length}
                  </span>
                </h2>
                <div className="flex gap-1">
                  <button
                    type="button"
                    className="text-[11px] text-[var(--kp-text-3)] hover:text-[var(--kp-text-1)] disabled:opacity-40"
                    disabled={syncRunning || allSelected}
                    onClick={selectAllPlatforms}
                  >
                    全选
                  </button>
                  <span className="text-[var(--kp-border)]">·</span>
                  <button
                    type="button"
                    className="text-[11px] text-[var(--kp-text-3)] hover:text-[var(--kp-text-1)] disabled:opacity-40"
                    disabled={syncRunning || noneSelected}
                    onClick={selectNonePlatforms}
                  >
                    清空
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-1.5">
                {platformCards.map((p) => {
                  const on = flags[p.key];
                  return (
                    <button
                      key={p.key}
                      type="button"
                      disabled={syncRunning}
                      title={p.desc}
                      onClick={() => setFlags((prev) => ({ ...prev, [p.key]: !prev[p.key] }))}
                      className={cn(
                        "flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition",
                        on
                          ? "border-[color-mix(in_oklab,var(--kp-brand)_45%,var(--kp-border))] bg-[var(--kp-brand-soft)]"
                          : "border-transparent bg-[var(--kp-bg-mute)]/60 opacity-70 hover:opacity-100",
                        syncRunning && "pointer-events-none opacity-50",
                      )}
                    >
                      {on ? (
                        <Check className="h-3.5 w-3.5 shrink-0 text-[var(--kp-brand-deep)]" />
                      ) : (
                        <span className="h-3.5 w-3.5 shrink-0 rounded border border-[var(--kp-border)]" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-[var(--kp-text-1)]">
                          {p.label}
                        </span>
                        <span className="block truncate text-[10px] text-[var(--kp-text-3)]">
                          {p.desc}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="rounded-xl border border-[var(--kp-border)] bg-[var(--kp-surface)] p-3">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--kp-text-3)]">
                立即同步
              </h2>
              {notice ? (
                <div className="mb-2 flex items-start gap-1.5 rounded-lg bg-[var(--kp-bg-mute)] px-2 py-1.5 text-xs text-[var(--kp-text-2)]">
                  <p className="min-w-0 flex-1 leading-snug">{notice}</p>
                  <button
                    type="button"
                    className="shrink-0 rounded p-0.5 hover:bg-[var(--kp-surface)]"
                    aria-label="关闭提示"
                    onClick={() => setNotice(null)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  disabled={syncRunning || noneSelected}
                  onClick={() => runManualSync("probe")}
                  title="列表最多 10 条，只入库 3 条，用来验登录"
                >
                  {busy === "试跑 list10/入库3" ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Play className="mr-1 h-3.5 w-3.5" />
                  )}
                  试跑
                </Button>
                <Button
                  size="sm"
                  className="h-8"
                  disabled={syncRunning || noneSelected}
                  onClick={() => runManualSync("full")}
                >
                  {busy === "立即全量同步" ||
                  (syncJob?.status === "running" && syncJob.mode === "full") ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <BookMarked className="mr-1 h-3.5 w-3.5" />
                  )}
                  全量
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  disabled={syncRunning || noneSelected}
                  onClick={() => runManualSync("incremental")}
                >
                  {busy === "立即增量同步" ||
                  (syncJob?.status === "running" && syncJob.mode === "incremental") ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-1 h-3.5 w-3.5" />
                  )}
                  增量
                </Button>
                {syncRunning ? (
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-8"
                    disabled={cancelSync.isPending || busy === "正在停止"}
                    onClick={async () => {
                      setBusy("正在停止");
                      setNotice(null);
                      try {
                        const stopped = (await cancelSync.mutateAsync(
                          syncJob?.id ? { jobId: syncJob.id } : undefined,
                        )) as SyncJob;
                        setSyncJob(stopped);
                        setNotice("已请求停止：当前夹写完检查点后退出，已入库条数保留");
                      } catch (err) {
                        setNotice(`停止失败: ${err instanceof Error ? err.message : String(err)}`);
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    {busy === "正在停止" || cancelSync.isPending ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Square className="mr-1 h-3.5 w-3.5 fill-current" />
                    )}
                    停止
                  </Button>
                ) : null}
              </div>
            </section>
          </aside>

          {/* 右栏：进度主舞台 */}
          <section className="min-w-0 space-y-3">
            {syncJob ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-[var(--kp-text-1)]">进度</h2>
                    <p className="mt-0.5 text-sm text-[var(--kp-text-2)]">{jobSummaryLine(syncJob)}</p>
                    <p className="mt-0.5 text-xs text-[var(--kp-text-3)]">
                      {syncJob.status === "running"
                        ? "后台进行中 · 可停止 · ~0.8s 刷新"
                        : syncJob.status === "cancelled"
                          ? "已停止；已入库保留"
                          : "分子=入库 · 分母=列表估算，结束时不必相等"}
                    </p>
                  </div>
                  {syncJob.status !== "running" ? (
                    <button
                      type="button"
                      className="shrink-0 rounded p-1 hover:bg-[var(--kp-bg-mute)]"
                      aria-label="关闭进度"
                      onClick={() => {
                        dismissedJobIdRef.current = syncJob.id;
                        setSyncJob(null);
                        try {
                          sessionStorage.removeItem(SYNC_JOB_ID_KEY);
                        } catch {
                          /* ignore */
                        }
                      }}
                    >
                      <X className="h-3.5 w-3.5 text-[var(--kp-text-3)]" />
                    </button>
                  ) : null}
                </div>

                <div className="grid gap-3">
                  {activeSteps.map((step) => {
                    const pct = writeProgressPct(step.done, step.total, step.status);
                    const isZhihu = step.key === "zhihu";
                    const folderLine =
                      isZhihu && zhihuChildren.length > 0
                        ? folderProgressLabel(zhihuChildren)
                        : null;
                    const recentLines = step.recent?.length
                      ? step.recent
                      : step.message
                        ? [step.message]
                        : [];
                    return (
                      <div
                        key={step.key}
                        className="flex min-h-[320px] flex-col rounded-xl border border-[var(--kp-border)] bg-[var(--kp-surface)] p-4"
                      >
                        <div className="flex items-start gap-2.5">
                          <StepStatusIcon status={step.status} />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                              <span className="text-base font-medium text-[var(--kp-text-1)]">
                                {step.label}
                              </span>
                              <span className="text-xs tabular-nums text-[var(--kp-text-3)]">
                                {folderLine ?? writeProgressLabel(step.done, step.total, step.status)}
                              </span>
                            </div>
                            {folderLine ? (
                              <p className="mt-0.5 text-[11px] tabular-nums text-[var(--kp-text-3)]">
                                {writeProgressLabel(step.done, step.total, step.status)}
                              </p>
                            ) : null}
                            <div
                              className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-[var(--kp-border)]"
                              role="progressbar"
                              aria-valuenow={pct}
                              aria-valuemin={0}
                              aria-valuemax={100}
                            >
                              <div
                                className={cn(
                                  "h-full rounded-full transition-[width] duration-300",
                                  step.status === "error"
                                    ? "bg-amber-500"
                                    : step.status === "pending"
                                      ? "bg-transparent"
                                      : "bg-[var(--kp-brand-deep)]",
                                )}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            {step.message && step.status !== "pending" ? (
                              <p
                                className={cn(
                                  "mt-2 break-words text-sm leading-snug",
                                  step.status === "error"
                                    ? "text-red-600 dark:text-red-400"
                                    : "text-[var(--kp-text-1)]",
                                )}
                                title={step.message}
                              >
                                {step.message}
                              </p>
                            ) : null}
                          </div>
                        </div>

                        {recentLines.length > 0 && step.status !== "pending" ? (
                          <div className="mt-3 min-h-0 flex-1 border-t border-[var(--kp-border)] pt-3">
                            <div className="mb-1.5 flex items-center justify-between gap-2">
                              <span className="text-xs font-medium text-[var(--kp-text-2)]">
                                拉取记录
                              </span>
                              <span className="text-[11px] tabular-nums text-[var(--kp-text-3)]">
                                {recentLines.length} 条
                              </span>
                            </div>
                            <ul className="max-h-[360px] space-y-1.5 overflow-y-auto overscroll-contain pr-1">
                              {recentLines.map((line, idx) => (
                                <li
                                  key={`${idx}-${line.slice(0, 24)}`}
                                  className={cn(
                                    "rounded-lg px-2.5 py-1.5 text-xs leading-snug",
                                    idx === 0
                                      ? "bg-[var(--kp-brand-soft)] text-[var(--kp-text-1)]"
                                      : "bg-[var(--kp-bg-mute)]/70 text-[var(--kp-text-2)]",
                                  )}
                                  title={line}
                                >
                                  {line}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        {isZhihu && zhihuChildren.length > 0 ? (
                          <div className="mt-2 border-t border-[var(--kp-border)] pt-2">
                            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 text-xs text-[var(--kp-text-2)] hover:text-[var(--kp-text-1)]"
                                onClick={() => setChildrenExpanded((v) => !v)}
                              >
                                {childrenExpanded ? (
                                  <ChevronUp className="h-3.5 w-3.5" />
                                ) : (
                                  <ChevronDown className="h-3.5 w-3.5" />
                                )}
                                收藏夹 · {zhihuChildren.length}
                              </button>
                              {childrenExpanded && childTotalPages > 1 ? (
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    disabled={safeChildPage <= 0}
                                    className="inline-flex h-6 w-6 items-center justify-center rounded border border-[var(--kp-border)] disabled:opacity-30"
                                    onClick={() => {
                                      setChildPagePinned(true);
                                      setChildPage(Math.max(0, safeChildPage - 1));
                                    }}
                                    aria-label="上一页"
                                  >
                                    <ChevronLeft className="h-3 w-3" />
                                  </button>
                                  <span className="min-w-[2.5rem] text-center text-[10px] tabular-nums text-[var(--kp-text-3)]">
                                    {safeChildPage + 1}/{childTotalPages}
                                  </span>
                                  <button
                                    type="button"
                                    disabled={safeChildPage >= childTotalPages - 1}
                                    className="inline-flex h-6 w-6 items-center justify-center rounded border border-[var(--kp-border)] disabled:opacity-30"
                                    onClick={() => {
                                      setChildPagePinned(true);
                                      setChildPage(
                                        Math.min(childTotalPages - 1, safeChildPage + 1),
                                      );
                                    }}
                                    aria-label="下一页"
                                  >
                                    <ChevronRight className="h-3 w-3" />
                                  </button>
                                </div>
                              ) : null}
                            </div>
                            {childrenExpanded ? (
                              <ul className="grid gap-1 sm:grid-cols-2">
                                {pagedChildren.map((child) => {
                                  const st = child.status ?? "pending";
                                  const cPct = writeProgressPct(child.done, child.total, st);
                                  return (
                                    <li
                                      key={child.id}
                                      className={cn(
                                        "rounded-lg border border-[var(--kp-border)] px-2 py-1.5",
                                        st === "running" && "bg-[var(--kp-brand-soft)]/50",
                                      )}
                                    >
                                      <div className="flex items-center gap-1.5 text-[11px]">
                                        <StepStatusIcon status={st} />
                                        <span className="min-w-0 flex-1 truncate text-[var(--kp-text-1)]">
                                          {child.label}
                                        </span>
                                        <span className="shrink-0 tabular-nums text-[var(--kp-text-3)]">
                                          {writeProgressLabel(child.done, child.total, st)}
                                        </span>
                                      </div>
                                      <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-[var(--kp-border)]">
                                        <div
                                          className={cn(
                                            "h-full rounded-full transition-[width] duration-300",
                                            st === "error"
                                              ? "bg-amber-500"
                                              : "bg-[var(--kp-brand-deep)]",
                                          )}
                                          style={{ width: `${cPct}%` }}
                                        />
                                      </div>
                                    </li>
                                  );
                                })}
                              </ul>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                {syncJob.status !== "running" ? (
                  <p className="text-xs text-[var(--kp-text-3)]">
                    结果在{" "}
                    <Link href="/inbox" className="text-[var(--kp-brand-deep)] hover:underline">
                      知识 Inbox
                    </Link>
                  </p>
                ) : null}
              </>
            ) : (
              <div className="flex min-h-[200px] flex-col items-center justify-center rounded-xl border border-dashed border-[var(--kp-border)] bg-[var(--kp-surface)]/50 px-6 text-center">
                <p className="text-sm text-[var(--kp-text-2)]">左侧勾选平台后点「全量」或「增量」</p>
                <p className="mt-1 text-xs text-[var(--kp-text-3)]">进度会显示在这里</p>
              </div>
            )}
          </section>
        </div>
      )}
    </AdminPage>
  );
}
