/**
 * 免费模型目录 — OpenRouter :free + freellm 网关通道
 */

"use client";

import { Sparkles } from "lucide-react";
import { AdminPage, PageHeader } from "@/components/shared";
import { FreeModelsPanel } from "@/components/freeModelsPanel";

export default function FreeModelsPage() {
  return (
    <AdminPage>
      <div className="mx-auto w-full max-w-5xl space-y-5">
        <PageHeader
          icon={Sparkles}
          title="免费模型目录"
          description="OpenRouter :free 与 freellm 通道 · 复制模型 id 即可在 Chat / 压缩摘要中使用"
        />
        <FreeModelsPanel />
      </div>
    </AdminPage>
  );
}
