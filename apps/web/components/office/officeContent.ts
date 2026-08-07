/** 见微 3D 办公室 · 热点内容（布局对齐交互书房参考，文案换成 OasisMind） */

export type OfficeHotspotId =
  | "monitor"
  | "binder"
  | "board"
  | "map"
  | "plant"
  | "dog"
  | "phone"
  | "calendar"
  | "lamp";

export type OverlayKind =
  | "projects"
  | "about"
  | "knowledge"
  | "journey"
  | "garden"
  | "agents"
  | "fun"
  | "mood";

export interface OfficeProject {
  id: string;
  tag: string;
  tagColor: string;
  title: string;
  meta: string;
  href: string;
  cta: string;
}

/** 显示器桌面图标（对齐参考里的 App 网格，模块换成见微） */
export const MONITOR_APPS = [
  { id: "chat", label: "Chat", color: "#EF4444", href: "/chat" },
  { id: "gardens", label: "Garden", color: "#F59E0B", href: "/gardens" },
  { id: "agents", label: "Swarm", color: "#10B981", href: "/agents" },
  { id: "skills", label: "Skills", color: "#14B8A6", href: "/skills" },
  { id: "memories", label: "Memory", color: "#0087EB", href: "/memories" },
  { id: "approvals", label: "HITL", color: "#8B5CF6", href: "/approvals" },
  { id: "search", label: "FTS", color: "#0EA5E9", href: "/search" },
  { id: "runs", label: "Runs", color: "#64748B", href: "/runs" },
] as const;

/** 公告板便利贴（参考里的主题便签 → 见微铁律/能力） */
export const BOARD_STICKIES = [
  { label: "Markdown 真相源", color: "#FDE68A" },
  { label: "推拉结合", color: "#A7F3D0" },
  { label: "禁止打补丁", color: "#FBCFE8" },
  { label: "SSE 实时", color: "#BFDBFE" },
  { label: "Swarm 心跳", color: "#FED7AA" },
  { label: "本地优先", color: "#DDD6FE" },
] as const;

export const OFFICE_BRAND = {
  name: "见微",
  en: "OasisMind",
  doorLabel: "见微",
  tagline: "Local-first Knowledge Garden",
  officeTitle: "见微的办公室",
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
    tagColor: "#0284C7",
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

/** 公告板「论文海报」——结构对齐参考里的学术海报，内容是见微架构 */
export const BOARD_POSTER = {
  title: "Local-first Agent Architecture for a Personal Knowledge Garden",
  subtitle: "OasisMind · Markdown as Source of Truth · Push/Pull UI State",
  sections: [
    {
      heading: "Abstract",
      body: "见微以本地 Markdown 为唯一事实源，用 Agent ReAct + SSE 驱动数字花园的收集、蒸馏与编排。状态权威在服务端，前端只订阅与渲染；写点后同栈推送，刷新再水合，禁止用 F5 当修复。",
    },
    {
      heading: "Method",
      body: "三层 Swarm（super / manager / sub）+ 心跳决策；工具闭集、子 Agent 结果仅经 report_back；审批 decision-scope 与断路器守护副作用。",
    },
    {
      heading: "Invariant",
      body: "不变量收进 reducer；编排层禁止 setTimeout / await hydrate 赌时序。服务重启不自动续跑僵尸任务。",
    },
  ],
  keywords: [
    "Local-first",
    "Markdown",
    "SSE",
    "Swarm",
    "HITL",
    "FileSync",
  ],
};

export const KNOWLEDGE_NOTES = [
  {
    title: "本地 Markdown 是真相源",
    body: "文章、Agent、Skill、Memory 均写回磁盘；SQLite 只做查询与缓存，可随时重建。花园对应 content/{gardenId}，配置在 config/，运行时产物在 data/。",
    keywords: ["Markdown", "FileSync", "db:sync"],
  },
  {
    title: "状态在内存 · 推拉结合",
    body: "写点后同栈推 SSE（uiStateNotify）；进页/刷新从权威源水合。开着的 Chat / cron / approvals / runs 必须秒级自己动。",
    keywords: ["SSE", "uiStateNotify", "hydrate"],
  },
  {
    title: "禁止打补丁",
    body: "不变量收进 store reducer；编排层用 setTimeout / await hydrate 赌时序一律打回。删掉补丁后 bug 仍不复现，才算架构落地。",
    keywords: ["store", "commitStream", "架构铁律"],
  },
];

export const JOURNEY_STOPS = [
  { year: "L1", place: "博客与编辑器", note: "花园文章 · 自动保存 · 图片粘贴", region: "花园起点" },
  { year: "L2", place: "Agent 运行时", note: "ReAct + SSE · Skill / MCP", region: "引擎层" },
  { year: "L3", place: "任务与工作区", note: "Task · Workspace · 文件沙箱", region: "执行层" },
  { year: "L4", place: "自动化与审批", note: "Trigger · Approval · HITL", region: "治理层" },
  { year: "L5", place: "搜索与部署", note: "FTS5 · Docker · 可选鉴权", region: "交付层" },
  { year: "Now", place: "数字主力", note: "心跳 · Swarm · 交互办公室", region: "常驻" },
];

export const HOTSPOT_META: Record<
  OfficeHotspotId,
  { label: string; overlay: OverlayKind; hint: string }
> = {
  monitor: { label: "工作台显示器", overlay: "projects", hint: "点击打开能力矩阵" },
  binder: { label: "速查夹", overlay: "about", hint: "Quick Facts · 关于见微" },
  board: { label: "架构公告板", overlay: "knowledge", hint: "海报 · 便签 · 铁律" },
  map: { label: "旅程地图", overlay: "journey", hint: "L1→Now 演进钉点" },
  plant: { label: "绿植", overlay: "garden", hint: "数字花园入口" },
  dog: { label: "小伙伴", overlay: "fun", hint: "本地优先吉祥物" },
  phone: { label: "手机支架", overlay: "agents", hint: "随时呼叫 Agent" },
  calendar: { label: "台历", overlay: "fun", hint: "今日待办 · 心跳节奏" },
  lamp: { label: "落地灯", overlay: "mood", hint: "切换书房氛围" },
};
