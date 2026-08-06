/** 见微 3D 办公室 · 热点内容（对齐交互房间 UX，内容换成 OasisMind） */

export type OfficeHotspotId =
  | "monitor"
  | "binder"
  | "board"
  | "map"
  | "plant"
  | "dog"
  | "phone"
  | "calendar";

export type OverlayKind =
  | "projects"
  | "about"
  | "knowledge"
  | "journey"
  | "garden"
  | "agents"
  | "fun";

export interface OfficeProject {
  id: string;
  tag: string;
  tagColor: string;
  title: string;
  meta: string;
  href: string;
  cta: string;
}

export const OFFICE_BRAND = {
  name: "见微",
  en: "OasisMind",
  doorLabel: "见微",
  tagline: "Local-first Knowledge Garden",
};

export const PROJECTS: OfficeProject[] = [
  {
    id: "chat",
    tag: "对话",
    tagColor: "#0087EB",
    title: "Agent SSE Chat",
    meta: "三层 store · 推拉结合 · 刷新不丢",
    href: "/chat",
    cta: "开始对话",
  },
  {
    id: "gardens",
    tag: "知识库",
    tagColor: "#10B981",
    title: "Markdown 数字花园",
    meta: "content/ 为唯一事实源 · SQLite 缓存",
    href: "/gardens",
    cta: "进入花园",
  },
  {
    id: "agents",
    tag: "Swarm",
    tagColor: "#8B5CF6",
    title: "三层 Agent 层级",
    meta: "super / manager / sub · 心跳自主",
    href: "/agents",
    cta: "打开工作台",
  },
  {
    id: "skills",
    tag: "Skill",
    tagColor: "#F59E0B",
    title: "Skill 沙箱",
    meta: "config/skills · 可发现可晋升",
    href: "/skills",
    cta: "浏览技能",
  },
  {
    id: "memories",
    tag: "记忆",
    tagColor: "#EC4899",
    title: "三层 Memory",
    meta: "global · workspace · agent",
    href: "/memories",
    cta: "查看记忆",
  },
  {
    id: "approvals",
    tag: "HITL",
    tagColor: "#EF4444",
    title: "审批闸门",
    meta: "decision-scope · 可邮件回复",
    href: "/approvals",
    cta: "待审批",
  },
];

export const ABOUT_FACTS = [
  { label: "定位", value: "以 Markdown 为原子、AI 为引擎的数字花园" },
  { label: "原则", value: "本地优先 · 单用户 · 推拉结合" },
  { label: "栈", value: "Next.js 16 · Express · tRPC · Prisma · R3F" },
  { label: "阶段", value: "L1–L5 已落地 · Swarm 心跳就绪" },
  { label: "入口", value: "对话 / 知识库 / Agent 工作台" },
];

export const KNOWLEDGE_NOTES = [
  {
    title: "本地 Markdown 是真相源",
    body: "文章、Agent、Skill、Memory 均写回磁盘；SQLite 只做查询与缓存，可随时重建。",
    keywords: ["Markdown", "FileSync", "db:sync"],
  },
  {
    title: "状态在内存 · 推拉结合",
    body: "写点后同栈推 SSE；进页/刷新从权威源水合。开着的 Chat / cron / approvals 必须秒级自己动。",
    keywords: ["SSE", "uiStateNotify", "hydrate"],
  },
  {
    title: "禁止打补丁",
    body: "不变量收进 reducer；编排层用 setTimeout / await hydrate 赌时序一律打回。",
    keywords: ["store", "commitStream", "架构铁律"],
  },
];

export const JOURNEY_STOPS = [
  { year: "L1", place: "博客与编辑器", note: "花园文章 · 自动保存 · 图片粘贴" },
  { year: "L2", place: "Agent 运行时", note: "ReAct + SSE · Skill / MCP" },
  { year: "L3", place: "任务与工作区", note: "Task · Workspace · 文件沙箱" },
  { year: "L4", place: "自动化与审批", note: "Trigger · Approval · HITL" },
  { year: "L5", place: "搜索与部署", note: "FTS5 · Docker · 可选鉴权" },
  { year: "Now", place: "数字主力", note: "心跳 · Swarm · 晴空玻璃 UI" },
];

export const HOTSPOT_META: Record<
  OfficeHotspotId,
  { label: string; overlay: OverlayKind; hint: string }
> = {
  monitor: { label: "工作台显示器", overlay: "projects", hint: "点击查看能力矩阵" },
  binder: { label: "红色速查夹", overlay: "about", hint: "Quick Facts · 关于见微" },
  board: { label: "公告板", overlay: "knowledge", hint: "架构笔记与铁律" },
  map: { label: "旅程地图", overlay: "journey", hint: "L1→L5 演进路线" },
  plant: { label: "绿植", overlay: "garden", hint: "数字花园入口" },
  dog: { label: "小伙伴", overlay: "fun", hint: "本地优先吉祥物" },
  phone: { label: "手机支架", overlay: "agents", hint: "随时呼叫 Agent" },
  calendar: { label: "台历", overlay: "fun", hint: "今日待办 · 心跳节奏" },
};
