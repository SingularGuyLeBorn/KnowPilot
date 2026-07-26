/**
 * 平台每日同步 — 自动化与工作流
 * 用 cron Task(action=inbox:sync) 定时拉知乎/小红书/B站/截图/微信
 */

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  RefreshCw,
  Inbox,
  Play,
  CalendarClock,
  Check,
  Loader2,
  BookMarked,
  Heart,
  ImageIcon,
  MessageSquare,
  Tv,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Task } from "@knowpilot/shared";
import { useTask, useInbox } from "@/lib/hooks";
import { AdminPage, LoadingState, PageHeader } from "@/components/shared";
import { cn } from "@/lib/utils";

const SPRING = { type: "spring" as const, stiffness: 260, damping: 26 };
const TASK_NAME = "Inbox 平台每日同步";
const DEFAULT_CRON = "0 9 * * *";

type SyncFlags = {
  xhs: boolean;
  screenshots: boolean;
  wechat: boolean;
  zhihu: boolean;
  bilibili: boolean;
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

export default function PlatformSyncPage() {
  const { useList, useCreate, useUpdate, useRun } = useTask();
  const { useSyncZhihu, useSyncXhs, useSyncBilibili, useScanScreenshots, useIngestWechat } = useInbox();
  const { data, isLoading, refetch } = useList({ page: 1, pageSize: 50 });
  const createMutation = useCreate();
  const updateMutation = useUpdate();
  const runMutation = useRun();
  const syncZhihu = useSyncZhihu();
  const syncXhs = useSyncXhs();
  const syncBilibili = useSyncBilibili();
  const scan = useScanScreenshots();
  const wechat = useIngestWechat();

  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [cronOverride, setCronOverride] = useState<string | null>(null);
  const [flagsOverride, setFlagsOverride] = useState<SyncFlags | null>(null);

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

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
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
      await refetch();
      showToast("已启用：调度器已热注册，无需重启服务");
    } catch (err) {
      showToast(`失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const runNowScheduled = async () => {
    if (!syncTask) {
      showToast("请先启用每日同步，或用下方「立即增量同步」");
      return;
    }
    setBusy("执行定时任务");
    try {
      const res = await runMutation.mutateAsync({ id: syncTask.id });
      if ((res as { success?: boolean })?.success === false) {
        showToast(`执行失败: ${(res as { error?: { message?: string } }).error?.message ?? "未知"}`);
      } else {
        showToast("已触发执行，结果进知识 Inbox");
      }
      await refetch();
    } catch (err) {
      showToast(`失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const runManualSync = async (mode: "incremental" | "full") => {
    const label = mode === "full" ? "立即全量同步" : "立即增量同步";
    setBusy(label);
    try {
      const parts: string[] = [];
      if (flags.screenshots) {
        const r = await scan.mutateAsync({});
        parts.push(`截图+${(r as { created?: number })?.created ?? 0}`);
      }
      if (flags.wechat) {
        const r = await wechat.mutateAsync({});
        parts.push(`微信+${(r as { created?: number })?.created ?? 0}`);
      }
      if (flags.zhihu) {
        const r = await syncZhihu.mutateAsync({
          mode,
          maxItemsPerCollection: mode === "full" ? 5000 : 200,
        });
        parts.push(`知乎+${(r as { created?: number })?.created ?? 0}`);
      }
      if (flags.xhs) {
        const r = await syncXhs.mutateAsync({
          mode,
          kinds: ["liked", "collect"],
          maxItems: mode === "full" ? 2000 : 200,
        });
        parts.push(`小红书+${(r as { created?: number })?.created ?? 0}`);
      }
      if (flags.bilibili) {
        const r = await syncBilibili.mutateAsync({
          mode,
          kinds: ["fav", "toview"],
          maxItems: mode === "full" ? 2000 : 200,
        });
        parts.push(`B站+${(r as { created?: number })?.created ?? 0}`);
      }
      showToast(`${mode === "full" ? "全量" : "增量"}完成：${parts.join(" · ") || "未选平台"}`);
    } catch (err) {
      showToast(`失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const platformCards = [
    { key: "zhihu" as const, label: "知乎收藏夹", desc: "自动发现全部夹 · 增量早停", icon: BookMarked },
    { key: "xhs" as const, label: "小红书点赞+收藏", desc: "双 Tab · 遇已知笔记早停", icon: Heart },
    { key: "bilibili" as const, label: "B站收藏+稍后再看", desc: "SESSDATA · 对齐 BiliNote", icon: Tv },
    { key: "screenshots" as const, label: "截图 drop", desc: "扫描 data/inbox/screenshots/drop", icon: ImageIcon },
    { key: "wechat" as const, label: "微信 links.txt", desc: "读取 wechat/links.txt", icon: MessageSquare },
  ];

  return (
    <AdminPage>
      <PageHeader
        icon={RefreshCw}
        title="平台每日同步"
        description="在「自动化与工作流」里定时拉取知乎 / 小红书 / B站 / 截图 / 微信到 Inbox。结果去知识 Inbox 浏览与蒸馏。"
      />

      {toast && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-[var(--kp-border)] bg-[var(--kp-surface)] px-4 py-2.5 text-sm"
        >
          {toast}
        </motion.div>
      )}

      {isLoading ? (
        <LoadingState />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={SPRING}
            className="kp-card-premium space-y-5 rounded-2xl p-6"
          >
            <div>
              <p className="kp-eyebrow">Schedule</p>
              <h2 className="mt-1 text-xl font-semibold text-[var(--kp-text-1)]">每日拉取</h2>
              <p className="mt-1 text-sm text-[var(--kp-text-2)]">
                定时默认每天 9:00、增量、不抓正文。首次打底请点下方「立即全量同步」。
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="flex-1 text-xs text-[var(--kp-text-3)]">
                Cron 表达式
                <Input
                  className="mt-1 font-mono"
                  value={cron}
                  onChange={(e) => setCron(e.target.value)}
                  placeholder={DEFAULT_CRON}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={!!busy} onClick={() => enableDaily()}>
                  {busy === "启用每日同步" ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CalendarClock className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {syncTask ? "更新并启用" : "启用每日同步"}
                </Button>
                <Button size="sm" variant="outline" disabled={!!busy || !syncTask} onClick={() => runNowScheduled()}>
                  <Play className="mr-1.5 h-3.5 w-3.5" />
                  跑一次定时任务
                </Button>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {platformCards.map((p) => {
                const Icon = p.icon;
                const on = flags[p.key];
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setFlags((prev) => ({ ...prev, [p.key]: !prev[p.key] }))}
                    className={cn(
                      "flex items-start gap-3 rounded-xl border px-3 py-3 text-left transition",
                      on
                        ? "border-[color-mix(in_oklab,var(--kp-brand)_40%,var(--kp-border))] bg-[var(--kp-brand-soft)]"
                        : "border-[var(--kp-border)] bg-[var(--kp-bg)] opacity-70 hover:opacity-100",
                    )}
                  >
                    <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--kp-surface)]">
                      <Icon className="h-4 w-4 text-[var(--kp-brand-deep)]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-medium text-[var(--kp-text-1)]">
                        {p.label}
                        {on && <Check className="h-3.5 w-3.5 text-[var(--kp-brand-deep)]" />}
                      </div>
                      <p className="mt-0.5 text-xs text-[var(--kp-text-3)]">{p.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-2 border-t border-[var(--kp-border)] pt-4">
              <Button size="sm" disabled={!!busy} onClick={() => runManualSync("full")}>
                {busy === "立即全量同步" ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <BookMarked className="mr-1.5 h-3.5 w-3.5" />
                )}
                立即全量同步
              </Button>
              <Button size="sm" variant="outline" disabled={!!busy} onClick={() => runManualSync("incremental")}>
                {busy === "立即增量同步" ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                )}
                立即增量同步
              </Button>
              <Link
                href="/inbox"
                className="inline-flex h-8 items-center rounded-md border border-[var(--kp-border)] bg-[var(--kp-surface)] px-3 text-sm hover:bg-[var(--kp-bg-mute)]"
              >
                <Inbox className="mr-1.5 h-3.5 w-3.5" />
                打开知识 Inbox
              </Link>
            </div>
          </motion.section>

          <motion.aside
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...SPRING, delay: 0.05 }}
            className="kp-card-premium h-fit space-y-4 rounded-2xl p-5"
          >
            <h3 className="text-sm font-semibold text-[var(--kp-text-1)]">当前状态</h3>
            {syncTask ? (
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--kp-text-3)]">任务</dt>
                  <dd className="font-medium text-[var(--kp-text-1)]">{syncTask.name}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--kp-text-3)]">Cron</dt>
                  <dd className="font-mono text-xs">{syncTask.cronExpression || "—"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--kp-text-3)]">状态</dt>
                  <dd>{syncTask.status}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--kp-text-3)]">上次结束</dt>
                  <dd className="text-xs">
                    {syncTask.finishedAt
                      ? new Date(syncTask.finishedAt).toLocaleString()
                      : "尚未运行"}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-[var(--kp-text-2)]">
                尚未启用。点「启用每日同步」会创建名为「{TASK_NAME}」的 cron 任务，并热挂到调度器。
              </p>
            )}
            <p className="text-xs leading-relaxed text-[var(--kp-text-3)]">
              知乎 / 小红书 / B站需先在 Chat 用 <code>platform_login</code> 登录（B站对齐{" "}
              <a
                href="https://github.com/JefferyHcool/BiliNote"
                target="_blank"
                rel="noreferrer"
                className="text-[var(--kp-brand-deep)] hover:underline"
              >
                BiliNote
              </a>{" "}
              复用 SESSDATA）。首次用「立即全量同步」打底，之后开每日增量即可。
            </p>
            <Link
              href="/tasks"
              className="inline-flex text-xs text-[var(--kp-brand-deep)] hover:underline"
            >
              在 Tasks 列表查看全部定时任务 →
            </Link>
          </motion.aside>
        </div>
      )}
    </AdminPage>
  );
}
