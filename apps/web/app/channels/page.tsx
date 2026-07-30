"use client";

import { useState } from "react";
import Link from "next/link";
import { Radio, Trash2 } from "lucide-react";
import { AdminPage, EmptyState } from "@/components/shared";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

export default function ChannelsPage() {
  const statusQ = trpc.channel.status.useQuery(undefined, { refetchInterval: 5_000 });
  const bindingsQ = trpc.channel.listBindings.useQuery(undefined, { refetchInterval: 10_000 });
  const deleteMut = trpc.channel.deleteBinding.useMutation({
    onSuccess: () => {
      bindingsQ.refetch().catch(() => {});
    },
  });
  const simMut = trpc.channel.simulateInbound.useMutation({
    onSuccess: () => {
      statusQ.refetch().catch(() => {});
      bindingsQ.refetch().catch(() => {});
    },
  });
  const [peerId, setPeerId] = useState("debug-user");
  const [text, setText] = useState("你好，这是一条模拟 QQ 消息");
  const channel = "qq" as const;

  const adapters = statusQ.data?.adapters ?? [];
  const bindings = bindingsQ.data?.items ?? [];

  return (
    <AdminPage>
      <header className="mb-2">
        <h1 className="text-xl font-semibold tracking-tight text-[var(--kp-text-1)]">IM 通道</h1>
        <p className="mt-0.5 text-xs text-[var(--kp-text-3)]">
          QQ / 飞书入站归一化后进既有 ChatSession / SessionStreamHub。
        </p>
      </header>
      <div className="mb-4 rounded-xl border border-[var(--kp-border)] bg-[var(--kp-surface)] p-4 text-sm text-[var(--kp-text-2)]">
        <p className="font-medium text-[var(--kp-text-1)]">配置（根目录 .env）</p>
        <ul className="mt-2 list-inside list-disc space-y-1 text-xs">
          <li>
            QQ：<code>QQ_BOT_APP_ID</code> + <code>QQ_BOT_SECRET</code>；回调{" "}
            <code>/api/webhooks/qq</code>（需 <code>pnpm remote</code>）或 <code>QQ_BOT_WS=1</code>
          </li>
          <li>
            白名单：<code>QQ_BOT_ALLOWED_OPENIDS</code>（空 = 不限制）
          </li>
        </ul>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        {adapters.map((a) => (
          <div
            key={a.channel}
            className={cn(
              "rounded-xl border p-4",
              a.enabled
                ? "border-[var(--kp-brand)]/40 bg-[var(--kp-brand-soft)]"
                : "border-[var(--kp-border)] bg-[var(--kp-surface)]",
            )}
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--kp-text-1)]">
              <Radio className="h-4 w-4" />
              {a.name}
            </div>
            <p className="mt-2 text-xs text-[var(--kp-text-3)]">
              {a.enabled ? "已启用" : "未启用"} · 状态 {a.state}
              {a.detail ? ` · ${a.detail}` : ""}
            </p>
            {a.lastError ? (
              <p className="mt-1 text-xs text-red-600">{a.lastError}</p>
            ) : null}
          </div>
        ))}
        {adapters.length === 0 ? (
          <EmptyState title="通道未启动" description="重启 server 后此处显示 QQ 适配器状态。" />
        ) : null}
      </div>

      <div className="mb-6 rounded-xl border border-[var(--kp-border)] bg-[var(--kp-surface)] p-4">
        <p className="text-sm font-medium text-[var(--kp-text-1)]">模拟入站（调试）</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <span className="rounded-md border border-[var(--kp-border)] px-2 py-1.5 text-sm text-[var(--kp-text-3)]">
            qq
          </span>
          <input
            className="flex-1 rounded-md border border-[var(--kp-border)] bg-transparent px-2 py-1.5 text-sm"
            value={peerId}
            onChange={(e) => setPeerId(e.target.value)}
            placeholder="peerId"
          />
        </div>
        <textarea
          className="mt-2 w-full rounded-md border border-[var(--kp-border)] bg-transparent px-2 py-1.5 text-sm"
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          type="button"
          className="mt-2 rounded-md bg-[var(--kp-brand)] px-3 py-1.5 text-sm text-white disabled:opacity-50"
          disabled={simMut.isPending || !text.trim()}
          onClick={() => simMut.mutate({ channel, peerId, text })}
        >
          {simMut.isPending ? "发送中…" : "注入 MessageGateway"}
        </button>
        {simMut.data ? (
          <p className="mt-2 text-xs text-[var(--kp-text-3)]">
            结果：{JSON.stringify(simMut.data)}
            {"sessionId" in simMut.data && simMut.data.sessionId ? (
              <>
                {" "}
                <Link className="text-[var(--kp-brand-deep)] underline" href={`/chat?session=${simMut.data.sessionId}`}>
                  打开会话
                </Link>
              </>
            ) : null}
          </p>
        ) : null}
        {simMut.error ? (
          <p className="mt-2 text-xs text-red-600">{simMut.error.message}</p>
        ) : null}
      </div>

      <h2 className="mb-2 text-sm font-semibold text-[var(--kp-text-1)]">绑定列表</h2>
      {bindings.length === 0 ? (
        <EmptyState title="暂无绑定" description="收到第一条 QQ 消息或模拟入站后会出现。" />
      ) : (
        <ul className="divide-y divide-[var(--kp-border)] rounded-xl border border-[var(--kp-border)] bg-[var(--kp-surface)]">
          {bindings.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium text-[var(--kp-text-1)]">
                  {b.channel} · {b.peerId}
                  {b.chatId ? ` · 群 ${b.chatId}` : ""}
                </p>
                <p className="truncate text-xs text-[var(--kp-text-3)]">
                  {b.title} ·{" "}
                  <Link className="underline" href={`/chat?session=${b.sessionId}`}>
                    会话
                  </Link>
                </p>
              </div>
              <button
                type="button"
                title="删除绑定"
                className="rounded-md p-1.5 text-[var(--kp-text-3)] hover:bg-[var(--kp-bg-mute)] hover:text-red-600"
                onClick={() => deleteMut.mutate({ id: b.id })}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </AdminPage>
  );
}
