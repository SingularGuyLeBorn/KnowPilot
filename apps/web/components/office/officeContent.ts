/** 见微 3D 办公室 · 量化级 AI 工位内容 */

export type OfficeHotspotId =
  | "monitor"
  | "binder"
  | "board"
  | "map"
  | "plant"
  | "dog"
  | "phone"
  | "calendar"
  | "lamp"
  | "server"
  | "bookshelf"
  | "chalkboard"
  | "papers";

export type OverlayKind =
  | "projects"
  | "about"
  | "knowledge"
  | "journey"
  | "garden"
  | "agents"
  | "fun"
  | "mood"
  | "server"
  | "bookshelf"
  | "architecture"
  | "formulas";

export interface OfficeProject {
  id: string;
  tag: string;
  tagColor: string;
  title: string;
  meta: string;
  href: string;
  cta: string;
}

/** 多屏墙各屏标题（量化终端感） */
export const MONITOR_WALL = [
  { id: "chat", label: "CHAT SSE", color: "#22D3EE", href: "/chat" },
  { id: "swarm", label: "SWARM", color: "#34D399", href: "/agents" },
  { id: "garden", label: "GARDEN", color: "#FBBF24", href: "/gardens" },
  { id: "fts", label: "FTS5", color: "#60A5FA", href: "/search" },
  { id: "runs", label: "RUNS", color: "#A78BFA", href: "/runs" },
  { id: "hitl", label: "HITL", color: "#F472B6", href: "/approvals" },
  { id: "mem", label: "MEMORY", color: "#38BDF8", href: "/memories" },
  { id: "cron", label: "CRON", color: "#FB923C", href: "/cron" },
] as const;

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

/** 整齐知识库板：花园条目 */
export const KNOWLEDGE_BOARD = [
  { id: "posts", title: "博客花园", meta: "公开长文 · 主展厅" },
  { id: "knowledge", title: "知识库", meta: "蒸馏笔记 · 可检索" },
  { id: "resources", title: "资源库", meta: "素材索引 · 清单" },
  { id: "llm-guide", title: "LLM 指南", meta: "体系化入门" },
  { id: "interview", title: "面试题集", meta: "刷题与复盘" },
  { id: "daily", title: "每日碎片", meta: "随记沉淀" },
] as const;

/** Transformer / LLM 架构板条目 */
export const ARCHITECTURE_BOARD = {
  title: "Transformer Architecture",
  subtitle: "Attention Is All You Need → LLM Stack",
  blocks: [
    { label: "Token Embed + Pos", detail: "x = E·w + P" },
    { label: "Multi-Head Attn", detail: "softmax(QKᵀ/√d)V" },
    { label: "FFN", detail: "GELU(xW₁)W₂" },
    { label: "LayerNorm + Residual", detail: "x + Sublayer(LN(x))" },
    { label: "LM Head", detail: "softmax(h W_out)" },
  ],
  stack: ["Embedding", "N × Decoder Block", "RMSNorm", "Vocab Projection"],
};

/** A4 推导纸条（完整式子，非占位） */
export const FORMULA_SHEETS = [
  {
    title: "Scaled Dot-Product",
    lines: [
      "Attn(Q,K,V)=softmax(QKᵀ/√d_k)V",
      "Q=XW_Q, K=XW_K, V=XW_V",
      "d_k=d_model/h",
    ],
  },
  {
    title: "Cross-Entropy LM",
    lines: [
      "p_t=softmax(h_t W_out)",
      "L=-Σ_t log p_t[y_t]",
      "Teacher forcing",
    ],
  },
  {
    title: "KV Cache",
    lines: [
      "K_t=[K_<t; k_t]",
      "V_t=[V_<t; v_t]",
      "decode: O(n)→O(1)/tok",
    ],
  },
  {
    title: "RoPE",
    lines: [
      "f(q,m)=R_Θ,m q",
      "⟨Rq_m,Rk_n⟩∝(m-n)",
      "相对位置可外推",
    ],
  },
  {
    title: "GQA / MoE",
    lines: [
      "n_kv ≪ n_q (GQA)",
      "y=Σ_i g_i(x) E_i(x)",
      "g=Top-k softmax",
    ],
  },
  {
    title: "RLHF / DPO",
    lines: [
      "max E[r_φ]-β KL(π||π_ref)",
      "DPO: σ(β log π/π_ref)",
      "偏好对齐目标",
    ],
  },
] as const;

export const BOOKSHELF_TITLES = [
  "Deep Learning · Goodfellow",
  "Attention Is All You Need",
  "Pattern Recognition & ML",
  "Neural Networks · Bishop",
  "Transformers for NLP",
  "Reinforcement Learning",
  "Speech & Language Proc.",
  "The LLM Engineer Path",
  "Scaling Laws Notes",
  "CUDA for Deep Learning",
  "Probabilistic ML",
  "Agent Systems Design",
] as const;

export const BOARD_STICKIES = [
  { label: "Markdown 真相源", color: "#FDE68A" },
  { label: "推拉结合", color: "#A7F3D0" },
  { label: "禁止打补丁", color: "#FBCFE8" },
  { label: "SSE 实时", color: "#BFDBFE" },
  { label: "Swarm 心跳", color: "#FED7AA" },
  { label: "本地优先", color: "#DDD6FE" },
] as const;

export const BOARD_POSTER = {
  title: "Local-first Agent Architecture for a Personal Knowledge Garden",
  subtitle: "OasisMind · Markdown as Source of Truth · Push/Pull UI State",
  sections: [
    {
      heading: "Abstract",
      body: "见微以本地 Markdown 为唯一事实源，用 Agent ReAct + SSE 驱动数字花园的收集、蒸馏与编排。状态权威在服务端，前端只订阅与渲染。",
    },
    {
      heading: "Method",
      body: "三层 Swarm（super / manager / sub）+ 心跳决策；工具闭集、子 Agent 结果仅经 report_back。",
    },
    {
      heading: "Invariant",
      body: "不变量收进 reducer；编排层禁止 setTimeout / await hydrate 赌时序。",
    },
  ],
  keywords: ["Local-first", "Markdown", "SSE", "Swarm", "HITL", "Transformer"],
};

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
  { label: "工位", value: "L 型电竞桌 · 多屏量化墙 · NVIDIA 推理机架" },
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
    body: "写点后同栈推 SSE；进页/刷新从权威源水合。开着的面板必须秒级自己动。",
    keywords: ["SSE", "uiStateNotify", "hydrate"],
  },
  {
    title: "禁止打补丁",
    body: "不变量收进 store reducer；编排层用 setTimeout 赌时序一律打回。",
    keywords: ["store", "commitStream", "架构铁律"],
  },
];

export const JOURNEY_STOPS = [
  { year: "L1", place: "博客与编辑器", note: "花园文章 · 自动保存", region: "花园起点" },
  { year: "L2", place: "Agent 运行时", note: "ReAct + SSE · Skill / MCP", region: "引擎层" },
  { year: "L3", place: "任务与工作区", note: "Task · Workspace · 沙箱", region: "执行层" },
  { year: "L4", place: "自动化与审批", note: "Trigger · Approval · HITL", region: "治理层" },
  { year: "L5", place: "搜索与部署", note: "FTS5 · Docker · 鉴权", region: "交付层" },
  { year: "Now", place: "数字主力", note: "心跳 · Swarm · 量化工位", region: "常驻" },
];

export const HOTSPOT_META: Record<
  OfficeHotspotId,
  { label: string; overlay: OverlayKind; hint: string }
> = {
  monitor: { label: "多屏工作墙", overlay: "projects", hint: "点击打开能力矩阵" },
  binder: { label: "速查夹", overlay: "about", hint: "Quick Facts · 关于见微" },
  board: { label: "知识库看板", overlay: "knowledge", hint: "整齐花园目录" },
  map: { label: "旅程地图", overlay: "journey", hint: "L1→Now 演进钉点" },
  plant: { label: "绿植", overlay: "garden", hint: "数字花园入口" },
  dog: { label: "小伙伴", overlay: "fun", hint: "本地优先吉祥物" },
  phone: { label: "手机支架", overlay: "agents", hint: "随时呼叫 Agent" },
  calendar: { label: "台历", overlay: "fun", hint: "今日待办 · 心跳节奏" },
  lamp: { label: "落地灯", overlay: "mood", hint: "切换书房氛围" },
  server: { label: "NVIDIA 推理机架", overlay: "server", hint: "DGX 风格本地算力" },
  bookshelf: { label: "AI 书架", overlay: "bookshelf", hint: "深度学习与大模型藏书" },
  chalkboard: { label: "架构黑板", overlay: "architecture", hint: "Transformer 栈板书" },
  papers: { label: "推导草稿", overlay: "formulas", hint: "桌面 A4 · Attention 公式" },
};
