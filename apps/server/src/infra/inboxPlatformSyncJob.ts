/**
 * Inbox 平台批量同步后台任务
 *
 * mutation 立即返回 jobId；任务在服务端异步跑，与前端页面生命周期无关。
 * 进度落盘到 data/inbox/platform-sync-latest.json，切页 / 刷新只影响展示轮询。
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { InboxPlatformSyncStartInput } from "@knowpilot/shared";
import { getAppConfig } from "./config.js";
import type { ServiceContainer } from "./serviceContainer.js";
import type { InboxSyncProgress, InboxSyncProgressChild } from "./inboxPipeline.js";
import { isInboxSyncAbortedError } from "./inboxPipeline.js";

export type PlatformSyncStepKey = "screenshots" | "wechat" | "zhihu" | "xhs" | "bilibili";
export type PlatformSyncStepStatus = "pending" | "running" | "done" | "error" | "skipped";

export interface PlatformSyncStep {
  key: PlatformSyncStepKey;
  label: string;
  status: PlatformSyncStepStatus;
  /** 列表已知总数 */
  total: number;
  /** 成功入库（新建或更新）条数 */
  done: number;
  created?: number;
  updated?: number;
  message?: string;
  /** 最近活动行（新在前） */
  recent?: string[];
  /** 知乎：按收藏夹拆开的子进度 */
  children?: InboxSyncProgressChild[];
}

export interface PlatformSyncJob {
  id: string;
  status: "running" | "done" | "failed" | "cancelled";
  mode: "full" | "incremental";
  steps: PlatformSyncStep[];
  startedAt: number;
  finishedAt?: number;
  currentLabel?: string;
  error?: string;
}

const STEP_META: Array<{ key: PlatformSyncStepKey; label: string; flag: keyof InboxPlatformSyncStartInput }> =
  [
    { key: "screenshots", label: "截图 drop", flag: "screenshots" },
    { key: "wechat", label: "微信 links.txt", flag: "wechat" },
    { key: "zhihu", label: "知乎收藏夹", flag: "zhihu" },
    { key: "xhs", label: "小红书点赞+收藏", flag: "xhs" },
    { key: "bilibili", label: "B站收藏+稍后再看", flag: "bilibili" },
  ];

const jobs = new Map<string, PlatformSyncJob>();
let activeJobId: string | null = null;
/** jobId → 用户请求停止 */
const abortFlags = new Map<string, boolean>();
/** 进度落盘节流：每条 upsert 同步写盘会卡住事件循环，前端轮询也像「卡住」 */
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistPending: PlatformSyncJob | null = null;

function shouldAbortJob(jobId: string): boolean {
  return abortFlags.get(jobId) === true;
}

function markStepStopped(step: PlatformSyncStep, message = "已停止"): void {
  if (step.status === "running" || step.status === "pending") {
    step.status = "error";
    step.message = message;
  }
  if (step.children?.length) {
    for (const child of step.children) {
      if (child.status === "running" || child.status === "pending") {
        child.status = "error";
        child.message = child.message || message;
      }
    }
  }
}

function finalizeCancelled(job: PlatformSyncJob, id: string): void {
  for (const step of job.steps) {
    if (step.status === "running" || step.status === "pending") {
      markStepStopped(step);
    }
  }
  job.status = "cancelled";
  job.error = "用户已停止";
  job.finishedAt = Date.now();
  if (activeJobId === id) activeJobId = null;
  abortFlags.delete(id);
  persistJob(job, true);
}

/** 停止当前（或指定）平台同步；下一页/下一夹会退出，已写入的保留 */
export function cancelInboxPlatformSyncJob(jobId?: string): PlatformSyncJob {
  const id = jobId ?? activeJobId;
  if (!id) {
    throw new Error("没有进行中的同步任务");
  }
  const job = jobs.get(id);
  if (!job) {
    throw new Error(`同步任务不存在: ${id}`);
  }
  if (job.status !== "running") {
    throw new Error("任务已结束，无法停止");
  }
  abortFlags.set(id, true);
  const running = job.steps.find((s) => s.status === "running");
  if (running) running.message = "正在停止…";
  persistJob(job, true);
  return snapshot(job);
}

function latestJobPath(): string {
  return path.join(getAppConfig().dataPaths.inbox, "platform-sync-latest.json");
}

function cloneChildren(children?: InboxSyncProgressChild[]): InboxSyncProgressChild[] | undefined {
  if (!children?.length) return undefined;
  return children.map((c) => ({ ...c }));
}

function snapshot(job: PlatformSyncJob): PlatformSyncJob {
  return {
    ...job,
    steps: job.steps.map((s) => ({
      ...s,
      children: cloneChildren(s.children),
    })),
    currentLabel: job.steps.find((s) => s.status === "running")?.label,
  };
}

function persistJobNow(job: PlatformSyncJob): void {
  try {
    const file = latestJobPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(snapshot(job)), "utf8");
  } catch (err) {
    console.warn(
      "[inboxPlatformSyncJob] persist failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/** 运行中节流落盘；终态务必立刻写 */
function persistJob(job: PlatformSyncJob, force = false): void {
  if (force || job.status !== "running") {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    persistPending = null;
    persistJobNow(job);
    return;
  }
  persistPending = job;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (persistPending) persistJobNow(persistPending);
    persistPending = null;
  }, 500);
}

function loadPersistedJob(): PlatformSyncJob | null {
  try {
    const file = latestJobPath();
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as PlatformSyncJob;
    if (!raw?.id || !Array.isArray(raw.steps)) return null;
    return raw;
  } catch {
    return null;
  }
}

function markInterrupted(job: PlatformSyncJob): PlatformSyncJob {
  job.status = "failed";
  job.error = "服务重启，任务中断";
  job.finishedAt = Date.now();
  for (const step of job.steps) {
    if (step.status === "running" || step.status === "pending") {
      step.status = "error";
      step.message = step.message || "服务重启，任务中断";
      if (step.children?.length) {
        for (const child of step.children) {
          if (child.status === "running" || child.status === "pending") {
            child.status = "error";
            child.message = child.message || "服务重启，任务中断";
          }
        }
      }
    }
  }
  return job;
}

/** 单平台条目进度百分比：done/total；total 未知时 running=0、终态=100 */
export function computeStepItemPercent(step: Pick<PlatformSyncStep, "total" | "done" | "status">): number {
  if (step.status === "skipped") return 0;
  if (step.status === "done" || step.status === "error") {
    if (step.total <= 0) return 100;
    return Math.min(100, Math.round((step.done / step.total) * 100));
  }
  if (step.total <= 0) return 0;
  return Math.min(100, Math.round((step.done / step.total) * 100));
}

export function getInboxPlatformSyncJob(jobId: string): PlatformSyncJob | null {
  const job = jobs.get(jobId);
  if (job) return snapshot(job);
  const disk = loadPersistedJob();
  if (disk?.id === jobId) {
    if (disk.status === "running") {
      markInterrupted(disk);
      persistJob(disk, true);
    }
    jobs.set(disk.id, disk);
    return snapshot(disk);
  }
  return null;
}

export function getActiveInboxPlatformSyncJob(): PlatformSyncJob | null {
  if (!activeJobId) return null;
  return getInboxPlatformSyncJob(activeJobId);
}

/** 进行中优先，否则最近一次（含已结束）——切页回来要能恢复进度卡 */
export function getLatestInboxPlatformSyncJob(): PlatformSyncJob | null {
  const active = getActiveInboxPlatformSyncJob();
  if (active) return active;
  let latest: PlatformSyncJob | null = null;
  for (const job of jobs.values()) {
    if (!latest || job.startedAt > latest.startedAt) latest = job;
  }
  if (latest) return snapshot(latest);

  const disk = loadPersistedJob();
  if (!disk) return null;
  if (disk.status === "running") {
    // 内存无此任务 = 进程已重启，执行体丢失
    markInterrupted(disk);
    persistJob(disk, true);
  }
  jobs.set(disk.id, disk);
  return snapshot(disk);
}

function summarizeSyncResult(r: {
  created?: number;
  updated?: number;
  errors?: string[];
}): { created: number; updated: number; message?: string } {
  const created = r.created ?? 0;
  const updated = r.updated ?? 0;
  const err = r.errors?.[0];
  return {
    created,
    updated,
    message: err ? `新 ${created} · 更新 ${updated} · ${err}` : `新 ${created} · 更新 ${updated}`,
  };
}

function bindStepProgress(job: PlatformSyncJob, step: PlatformSyncStep): (p: InboxSyncProgress) => void {
  return (p) => {
    step.total = p.total;
    step.done = p.done;
    if (p.message) step.message = p.message;
    if (p.recent) step.recent = [...p.recent];
    if (p.children) step.children = cloneChildren(p.children);
    persistJob(job);
  };
}

export function startInboxPlatformSyncJob(
  services: ServiceContainer,
  input: InboxPlatformSyncStartInput,
): { jobId: string; job: PlatformSyncJob } {
  const running = activeJobId ? jobs.get(activeJobId) : null;
  if (running && running.status === "running") {
    throw new Error(`已有同步进行中（${running.id.slice(0, 8)}…），请等待结束后再试`);
  }

  const mode = input.mode === "full" ? "full" : "incremental";
  const probe = input.probe === true;
  // 试跑：list≤10、入库≤3，少夹少目录，几分钟内能验登录
  const maxItems = probe ? 10 : (input.maxItems ?? (mode === "full" ? 2000 : 200));
  const maxUpsert = probe ? 3 : input.maxUpsert;
  const maxCollections = probe ? 1 : undefined;
  const maxFolders = probe ? 1 : undefined;
  const fetchContent = input.fetchContent === true;

  const steps: PlatformSyncStep[] = STEP_META.map((meta) => {
    const enabled = input[meta.flag] !== false;
    return {
      key: meta.key,
      label: meta.label,
      status: enabled ? ("pending" as const) : ("skipped" as const),
      total: 0,
      done: 0,
      message: enabled ? undefined : "未勾选，已跳过",
    };
  });

  if (steps.every((s) => s.status === "skipped")) {
    throw new Error("未选择任何同步平台");
  }

  const id = randomUUID();
  const job: PlatformSyncJob = {
    id,
    status: "running",
    mode,
    steps,
    startedAt: Date.now(),
  };
  jobs.set(id, job);
  activeJobId = id;
  abortFlags.set(id, false);
  persistJob(job);
  const shouldAbort = () => shouldAbortJob(id);

  const finished = [...jobs.values()].filter((j) => j.status !== "running");
  if (finished.length > 20) {
    finished
      .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0))
      .slice(0, finished.length - 20)
      .forEach((j) => jobs.delete(j.id));
  }

  Promise.resolve()
    .then(async () => {
      const { isInboxSyncAbortedError } = await import("./inboxPipeline.js");
      for (const step of job.steps) {
        if (shouldAbort()) {
          finalizeCancelled(job, id);
          return;
        }
        if (step.status === "skipped") continue;
        step.status = "running";
        step.total = 0;
        step.done = 0;
        step.children = undefined;
        step.message = probe ? "试跑：list≤10 · 入库≤3…" : "拉取列表中…";
        persistJob(job);
        const onProgress = bindStepProgress(job, step);
        try {
          let summary: { created: number; updated: number; message?: string };
          if (step.key === "screenshots") {
            if (shouldAbort()) {
              finalizeCancelled(job, id);
              return;
            }
            summary = summarizeSyncResult(
              await services.inbox.scanScreenshots(
                { maxFiles: Math.min(maxUpsert ?? maxItems, 200), runOcr: true },
                onProgress,
              ),
            );
          } else if (step.key === "wechat") {
            if (shouldAbort()) {
              finalizeCancelled(job, id);
              return;
            }
            summary = summarizeSyncResult(
              await services.inbox.ingestWechatDrop(
                {
                  maxUrls: Math.min(maxUpsert ?? maxItems, 100),
                  fetchContent,
                  maxChars: 12000,
                },
                onProgress,
              ),
            );
          } else if (step.key === "zhihu") {
            summary = summarizeSyncResult(
              await services.inbox.syncZhihu(
                {
                  mode: probe ? "incremental" : mode,
                  maxCollections: maxCollections ?? 50,
                  maxItemsPerCollection: maxItems,
                  maxItems,
                  maxUpsert,
                  fetchContent,
                },
                onProgress,
                shouldAbort,
              ),
            );
          } else if (step.key === "xhs") {
            summary = summarizeSyncResult(
              await services.inbox.syncXhs(
                {
                  mode: probe ? "incremental" : mode,
                  kinds: ["liked", "collect"],
                  maxItems,
                  maxUpsert,
                  fetchContent,
                },
                onProgress,
                shouldAbort,
              ),
            );
          } else {
            summary = summarizeSyncResult(
              await services.inbox.syncBilibili(
                {
                  mode: probe ? "incremental" : mode,
                  kinds: ["fav", "toview"],
                  maxItems,
                  maxFolders: maxFolders ?? 50,
                  maxUpsert,
                  fetchContent,
                },
                onProgress,
                shouldAbort,
              ),
            );
          }
          if (shouldAbort()) {
            step.created = summary.created;
            step.updated = summary.updated;
            finalizeCancelled(job, id);
            return;
          }
          step.created = summary.created;
          step.updated = summary.updated;
          step.message = summary.message;
          if (step.total <= 0 && step.done <= 0) {
            step.total = summary.created + summary.updated;
            step.done = step.total;
          }
          const zeroUpsert = summary.created === 0 && summary.updated === 0;
          const hasBizError = Boolean(
            summary.message && /失败|未登录|登录|未采集|请先|SESSDATA|cookie/i.test(summary.message),
          );
          step.status = zeroUpsert && hasBizError ? "error" : "done";
          // onProgress 回调会写 children；控制流分析看不到，需经 PlatformSyncStep 再读
          const finishingChildren = (step as PlatformSyncStep).children;
          if (finishingChildren?.length) {
            for (const child of finishingChildren) {
              if (child.status === "running" || child.status === "pending") {
                child.status = step.status === "error" ? "error" : "done";
              }
            }
          }
        } catch (err) {
          if (isInboxSyncAbortedError(err) || shouldAbort()) {
            step.message = "已停止";
            finalizeCancelled(job, id);
            return;
          }
          step.status = "error";
          step.message = err instanceof Error ? err.message : String(err);
        }
        persistJob(job);
      }

      if (shouldAbort()) {
        finalizeCancelled(job, id);
        return;
      }
      const hardFail = job.steps.some((s) => s.status === "error");
      job.status = hardFail ? "failed" : "done";
      job.finishedAt = Date.now();
      if (activeJobId === id) activeJobId = null;
      abortFlags.delete(id);
      persistJob(job, true);
    })
    .catch((err) => {
      if (shouldAbortJob(id)) {
        finalizeCancelled(job, id);
        return;
      }
      job.status = "failed";
      job.error = err instanceof Error ? err.message : String(err);
      job.finishedAt = Date.now();
      if (activeJobId === id) activeJobId = null;
      abortFlags.delete(id);
      persistJob(job, true);
    });

  return { jobId: id, job: snapshot(job) };
}

/** 测试用：清空内存态 */
export function __resetInboxPlatformSyncJobsForTests(): void {
  jobs.clear();
  activeJobId = null;
  abortFlags.clear();
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  persistPending = null;
  try {
    const file = latestJobPath();
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    /* ignore */
  }
}

export function __seedInboxPlatformSyncJobForTests(
  job: PlatformSyncJob & { active?: boolean },
): void {
  const { active, ...rest } = job;
  jobs.set(rest.id, rest);
  if (active || rest.status === "running") activeJobId = rest.id;
  persistJob(rest);
}
