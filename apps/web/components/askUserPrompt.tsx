"use client";

/**
 * ask_user Chat 弹框 —— 选项列表 + 自定义输入（仿 Kimi AskUserQuestion）。
 */

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

export type AskUserPromptProps = {
  askId: string;
  question: string;
  options?: string[];
  channel?: "ui" | "email";
  onResolved?: () => void;
  className?: string;
};

export function AskUserPrompt({
  askId,
  question,
  options,
  channel = "ui",
  onResolved,
  className,
}: AskUserPromptProps) {
  const [custom, setCustom] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const resolveMutation = trpc.askUser.resolve.useMutation({
    onSuccess: () => {
      setDone(true);
      onResolved?.();
    },
  });

  const opts = useMemo(
    () => (Array.isArray(options) ? options.map((o) => String(o).trim()).filter(Boolean) : []),
    [options],
  );

  const submit = (answer: string) => {
    const text = answer.trim();
    if (!text || resolveMutation.isPending || done) return;
    resolveMutation.mutate({ askId, answer: text });
  };

  if (done) {
    return (
      <div
        data-testid="ask-user-resolved"
        className={cn(
          "w-full rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800",
          className,
        )}
      >
        已提交答复，Agent 继续中…
      </div>
    );
  }

  return (
    <div
      data-testid="ask-user-prompt"
      className={cn(
        "w-full rounded-xl border border-[var(--kp-brand-light)] bg-[var(--kp-bg)] px-4 py-3 shadow-sm",
        className,
      )}
    >
      <p className="text-sm font-medium text-[var(--kp-text-1)]">{question}</p>
      {channel === "email" && (
        <p className="mt-1 text-[11px] text-[var(--kp-text-3)]">
          已发邮件；也可在此直接作答，或回复邮件。
        </p>
      )}
      {opts.length > 0 && (
        <ul className="mt-3 space-y-2" data-testid="ask-user-options">
          {opts.map((opt, idx) => (
            <li key={`${idx}-${opt}`}>
              <button
                type="button"
                data-testid={`ask-user-option-${idx + 1}`}
                disabled={resolveMutation.isPending}
                onClick={() => {
                  setSelected(idx);
                  submit(opt);
                }}
                className={cn(
                  "flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                  selected === idx
                    ? "border-[var(--kp-brand)] bg-[var(--kp-brand-soft)]/40"
                    : "border-[var(--kp-divider)] hover:border-[var(--kp-brand-light)] hover:bg-[var(--kp-bg-alt)]",
                )}
              >
                <span className="shrink-0 font-semibold text-[var(--kp-brand)]">{idx + 1}.</span>
                <span className="min-w-0 flex-1 text-[var(--kp-text-1)]">{opt}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex gap-2">
        <input
          data-testid="ask-user-custom-input"
          type="text"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit(custom);
            }
          }}
          placeholder={opts.length > 0 ? "自定义回答…" : "输入你的答复…"}
          disabled={resolveMutation.isPending}
          className="min-w-0 flex-1 rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg-alt)] px-3 py-2 text-sm text-[var(--kp-text-1)] outline-none focus:border-[var(--kp-brand)]"
        />
        <button
          type="button"
          data-testid="ask-user-submit"
          disabled={resolveMutation.isPending || !custom.trim()}
          onClick={() => submit(custom)}
          className="shrink-0 rounded-lg bg-[var(--kp-brand)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {resolveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "提交"}
        </button>
      </div>
      {resolveMutation.isError && (
        <p className="mt-2 text-[11px] text-red-600">
          {(resolveMutation.error as { message?: string })?.message || "提交失败"}
        </p>
      )}
    </div>
  );
}
