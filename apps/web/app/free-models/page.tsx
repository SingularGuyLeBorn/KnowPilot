/**
 * 免费模型目录 — OpenRouter :free + freellm 网关通道
 */

"use client";

import { AdminPage, PageHeader } from "@/components/shared";
import { FreeModelsPanel } from "@/components/freeModelsPanel";

export default function FreeModelsPage() {
  return (
    <AdminPage>
      <PageHeader
        title="免费模型目录"
        description="浏览 OpenRouter :free 模型详情与 freellm 已探活网关通道。复制模型 id 后可在 Chat 会话配置中使用。"
      />
      <FreeModelsPanel />
    </AdminPage>
  );
}
