/**
 * 会话轮换血缘 —— 管理页派生视图（链 + 图）
 * 只读 rotatedFrom / rotatedTo，不另造图协议。
 */

"use client";

import { Waypoints } from "lucide-react";
import { AdminPage, PageHeader } from "@/components/shared";
import { SessionRotateLineageView } from "@/components/sessionRotateLineageView";

export default function SessionLineagePage() {
  return (
    <AdminPage>
      <PageHeader
        icon={Waypoints}
        title="会话轮换血缘"
        description="从 SessionRotate 的 RotatedFrom / RotatedTo 边字段派生链与图；点击节点打开 Chat。"
      />
      <SessionRotateLineageView />
    </AdminPage>
  );
}
