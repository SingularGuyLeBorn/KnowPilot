/**
 * 免费模型目录 — OpenRouter :free + freellm 网关通道
 */

"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { AdminPage, PageHeader } from "@/components/shared";
import { FreeModelsPanel } from "@/components/freeModelsPanel";
import {
  freeModelsMessages,
  readFreeModelsLocale,
  writeFreeModelsLocale,
  type FreeModelsLocale,
} from "@/lib/freeModelsI18n";
import { cn } from "@/lib/utils";

function LocaleToggle({
  locale,
  onChange,
  labels,
}: {
  locale: FreeModelsLocale;
  onChange: (next: FreeModelsLocale) => void;
  labels: { zh: string; en: string };
}) {
  return (
    <div
      role="group"
      aria-label="Language"
      className="inline-flex items-center rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg)] p-0.5 text-[11px] font-medium"
    >
      <button
        type="button"
        onClick={() => onChange("zh")}
        className={cn(
          "rounded-md px-2.5 py-1 transition-colors",
          locale === "zh"
            ? "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]"
            : "text-[var(--kp-text-2)] hover:text-[var(--kp-text-1)]",
        )}
      >
        {labels.zh}
      </button>
      <button
        type="button"
        onClick={() => onChange("en")}
        className={cn(
          "rounded-md px-2.5 py-1 transition-colors",
          locale === "en"
            ? "bg-[var(--kp-brand-soft)] text-[var(--kp-brand-deep)]"
            : "text-[var(--kp-text-2)] hover:text-[var(--kp-text-1)]",
        )}
      >
        {labels.en}
      </button>
    </div>
  );
}

export default function FreeModelsPage() {
  const [locale, setLocale] = useState<FreeModelsLocale>(() => readFreeModelsLocale());
  const t = freeModelsMessages(locale);

  const onLocaleChange = (next: FreeModelsLocale) => {
    setLocale(next);
    writeFreeModelsLocale(next);
  };

  return (
    <AdminPage>
      <div className="mx-auto w-full max-w-5xl space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <PageHeader icon={Sparkles} title={t.pageTitle} description={t.pageDesc} />
          <LocaleToggle
            locale={locale}
            onChange={onLocaleChange}
            labels={{ zh: t.langZh, en: t.langEn }}
          />
        </div>
        <FreeModelsPanel locale={locale} />
      </div>
    </AdminPage>
  );
}
