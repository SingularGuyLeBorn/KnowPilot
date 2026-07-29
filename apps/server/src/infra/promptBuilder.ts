/**
 * Prompt 构建 — 从 agentRuntime 抽出的叶子模块。
 *
 * 职责：纯字符串 / 记忆片段构建（buildMemoryContext、buildTierIdentityHint、buildAgentToolGuide、
 * buildSystemPromptSkeleton）。注入编排（何时拼进 system prompt）已迁至 contextHooks 内建钩子。
 * 不依赖 loop/reactLoop/agentTools/nativeTools。
 */

import type { ServiceContainer } from "./serviceContainer.js";
import {
  MEMORY_INJECTABLE_TYPES,
  memoryAgentScope,
  memoryWorkspaceScope,
  MEMORY_SCOPE_GLOBAL,
} from "@knowpilot/shared";
import { createMemoryRepository } from "./memoryRepository.js";
import {
  recordMemoryRetrieveOutcome,
  shouldSkipMemoryRetrieve,
} from "./memoryRetrieveGate.js";
import { ensurePinnedMemoryHint } from "./pinnedMemory.js";

/**
 * 构建注入 system prompt 的长期记忆片段。
 * W5：统一走 MemoryRepository（FTS 优先 / LIKE 回退；BM25×(1+strength)×recency 排序）；
 * W5-followup：三层 scope 读路径——global + workspace:{wid}（Agent 有 Workspace 时）+ agent:{aid}；
 * 门控：连续无命中后跳过若干轮检索（综述① retrieve-or-not）。
 */
export async function buildMemoryContext(
  services: ServiceContainer,
  userText: string,
  options?: { agentId?: string | null },
): Promise<string> {
  const keyword = userText.slice(0, 80).trim();
  if (!keyword) return "";
  const gateKey = options?.agentId ?? "__global__";
  if (shouldSkipMemoryRetrieve(gateKey)) {
    return "";
  }
  const scopes = [MEMORY_SCOPE_GLOBAL];
  if (options?.agentId) {
    const agent = await services.prisma.agent.findUnique({
      where: { id: options.agentId },
      select: { workspaceId: true },
    });
    if (agent?.workspaceId) scopes.push(memoryWorkspaceScope(agent.workspaceId));
    scopes.push(memoryAgentScope(options.agentId));
  }
  const repo = createMemoryRepository(services);
  const memories = await repo.read({
    keyword,
    types: [...MEMORY_INJECTABLE_TYPES],
    scopes,
    limit: 5,
  });
  recordMemoryRetrieveOutcome(gateKey, memories.length > 0);
  if (!memories.length) return "";

  // S6 轻量：同 content 去重（保留强度更高/更新的一条已在 repo 排序）
  const seen = new Set<string>();
  const unique = memories.filter((m) => {
    const key = m.content.trim().toLowerCase().slice(0, 120);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const now = Date.now();
  const lines = unique.map((m) => {
    const attr = m.attribution && m.attribution !== "agent" ? `/${m.attribution}` : "";
    const ageMs = m.updatedAt ? now - new Date(m.updatedAt).getTime() : 0;
    const stale =
      Number.isFinite(ageMs) && ageMs > 24 * 60 * 60 * 1000
        ? "（可能过时，需验证）"
        : "";
    return `- [${m.type}${attr}] ${m.content.slice(0, 300)}${stale}`;
  });
  return `\n\n## 相关长期记忆\n${lines.join("\n")}`;
}

/**
 * L1 常驻层（冻结）+ 动态 FTS 记忆（按轮检索）。
 * sessionId 有值时 USER/AGENT 快照会话内不变；动态层仍按 userText 检索。
 */
export async function buildAllMemoryHints(
  services: ServiceContainer,
  userText: string,
  options?: { agentId?: string | null; sessionId?: string | null },
): Promise<string> {
  const pinned = await ensurePinnedMemoryHint(services, options?.sessionId);
  const dynamic = await buildMemoryContext(services, userText, { agentId: options?.agentId });
  return pinned + dynamic;
}

const WEB_TOOL_GUIDE = `## 网络工具用法
- web_search：查最新信息、文档、新闻；返回标题+URL+摘要，优先用结果中的 URL 继续深挖。已配置 Tavily/SerpAPI 时按 SEARCH_ENGINE_PRIORITY 自动降级；在 /sources 启用信息源后，Tavily/SerpAPI 会优先在信息源域名内 scoped 搜索（hint 含 infoSource-scoped / N 信息源）。
- search_arxiv / fetch_arxiv：学术论文走 arXiv API（免费，约 3s/次限流）。搜用 search_arxiv（可用 OR 合并主题、category=cs.AI 等）；详情用 fetch_arxiv(paperId)；下 PDF 用 download_file(url=pdfUrl)。不要用 web_search/read_article 硬爬 arxiv.org。
- search_huggingface / fetch_huggingface_model / fetch_huggingface_trending：HuggingFace Hub（无需 key）。搜模型用 search_huggingface；详情用 fetch_huggingface_model(modelId)；热榜用 fetch_huggingface_trending(type=models|datasets|spaces|papers)。
- read_article：读取单篇网页正文（Markdown）。支持知乎/微信/小红书/B站/掘金/CSDN/InfoQ/SegmentFault/开源中国/博客园/简书/GitHub 等；GitHub blob→raw + jsDelivr/API（~1s）；InfoQ/OSChina API；SegmentFault/CSDN/掘金/博客园 SSR HTTP；简书 Mobile HTTP；知乎 Cookie HTTP（~1s，需登录态）；HTTP 404 秒级报错；正文偏短（<150 字）时返回 contentWarning 并建议 scrape_web_page。默认 embedOcr=true：对前几张图**临时下载→OCR→把文字嵌进正文**（OCR 完删临时文件，**不永久落盘**）；\`images\` 返回 CDN URL 列表（图本身不进知识库）。小红书等图文笔记会从 SSR imageList 抽图。
- scrape_web_page：Playwright 采集复杂 SPA/需 JS 渲染页面；返回 method=playwright 与 platform；read_article 失败或页面高度动态时再试。
- download_file：按 URL 下载任意文件（PDF/zip/图片等）到本地，默认 Agent Workspace 的 downloads/；也可 path=content/uploads/…。与 save_webpage（存网页正文）不同。上限 50MB；文本类再用 read_file。
- save_webpage：把网页正文存成 HTML/Markdown 到 data/webpages/，便于反复/离线读。
- browser_screenshot：打开页面截图（PNG）落盘，返回 path/publicUrl（无图片字节）。用于视觉确认布局、登录墙、图表、验证码页等；随后用 read_image。
- read_image：读图。path 用 screenshot 返回路径；也可传 read_article 返回的图片 URL。mode=ocr|vision|auto（默认 auto：当前模型支持 vision 则识图，否则 OCR）。只回文本，勿期望 base64。
- vision_describe：外挂多模态模型做语义理解/描述（适合流程图、UI 截图、版面、纯文字模型看不懂的图）；可直接传图片 URL。
**图文策略**：先 read_article（正文 + images URL + 内嵌 OCR 粗读）。若 OCR 空白/乱码/看不懂图意（流程图、截图 UI、表格、手写），再对 \`images[]\` 里的 URL 调用 read_image（偏文字）或 vision_describe（偏语义）；**当前模型若支持多模态**，可用 read_image(mode=vision/auto) 直接读图。正文已够用就不要对每张图都 vision_describe。建议流程：web_search 找 URL → read_article → 必要时 scrape_web_page / 读图补强。知乎/微信/小红书/抖音/B站/微博/掘金/CSDN/语雀**访问需登录内容（收藏夹/付费/私密）前，若不确定登录态，先 native:browser_login_status 或 native:platform_doctor 确认（不弹窗；doctor 还报告有序后端/tier），未登录则 native:platform_login 弹浏览器让用户手动登录（扫码/账密），登录态自动落盘后 read_article 自动复用 cookie——不要让用户手动 F12 复制 cookie，也不要用 browser_screenshot/read_image 截图检查登录状态（模型无 vision 会卡死）**。即使用户只说「看看登录状态」，也优先 browser_login_status / platform_doctor 而非截图。同步收藏优先 inbox_start_platform_sync。GitHub 可选 GITHUB_TOKEN 提高 API 限速余量。`;

const PINME_TOOL_GUIDE = `## 公网部署（PinMe）
用户要「写个小工具/HTML 小游戏并给公网链接」时：
1. 用 write_file 写到当前 Workspace（如 \`demo/index.html\`），或对话里直接 \`\`\`html\`\`\` 预览（仅预览不部署）。
2. 需要可分享链接时调用 **pinme_upload**（path 指向含 index.html 的目录；省略则自动找 dist/build/out/public）。
3. 把返回的 url 发给用户。不要用 run_shell 调 pinme（密钥会被 shell 沙箱剥掉）。需配置 PINME_APPKEY。`;

const SESSION_HISTORY_GUIDE = `## 会话压缩与历史召回
- session_compact 只缩小**模型视野**（摘要 + 边界后消息），**不删除** ChatMessage；UI 历史仍在。
- 压缩后摘要丢细节 ≠ 数据丢失。用 **session_search(keyword)** 在本会话原文检索；命中 inLlmContext=false 再用 **session_message_get(messageId)** 拉片段。
- session_message_get(beforeCompact=true) 可浏览压缩前最近若干条。禁止用 run_shell/grep 扫会话库。
- 跨会话长期事实用 memory_*；本会话细节用 session_search。`;

/** Hermes SKILLS_GUIDANCE：程序记忆 vs Memory（陈述事实） */
export const SKILLS_GUIDANCE = `## Skill 程序记忆（Hermes + DeerFlow 渐进加载）
After completing a complex task (约 5+ tool calls)、攻克棘手错误、或发现可复用工作流，用 skill_manage 保存为 Skill，下次复用。
使用 Skill 时若发现过时/缺步/错误，立刻 skill_manage(action='patch')，不要等被要求。
**渐进加载（铁律）**：默认只 skills_list 看短描述；需要时再 skill_view 读全文/references——禁止一上来把多个 Skill 全文灌进上下文。
procedural Skill 不会出现在 skill__* 工具列表里。create/write_file 会跑 SkillScan（拦私钥/child_process/eval 等）。
Memory 记「用户是谁/偏好」；Skill 记「这类任务怎么做」。禁止把一次性任务名（PR 号、今日 debug）当成 skill name。`;

const GOAL_TOOL_GUIDE = `## Standing Goal（跨轮外环）
用户**不必**输入 /goal。当你判断任务需要多轮推进（修测试、完成交付物、深度调研、明确可验收目标）时，主动调用 \`session_goal_set\`。
- 短问短答、一次性查询：**不要**设 goal。
- \`todo_write\` = 本轮步骤清单；\`session_goal_set\` = 跨轮外环（回合结束后系统裁判续跑）。
- 查进度用 \`session_goal_status\`；完成/放弃用 \`session_goal_clear\`；暂停/恢复用 pause/resume。
- 设立后本轮直接推进目标，勿再要求用户手动 /goal。`;

const ALGO_VIZ_TOOL_GUIDE = `## 算法动画（algo-viz）铁律
- 创建/更新动画**唯一**工具：\`algo_viz_create\`（直接写入 apps/algo-viz 并自动注册）。\`algo_viz_list\` 查已有 id。
- **禁止** \`write_file\` 写 \`apps/algo-viz/**\` 或把 \`.tsx\` 丢进 \`content/uploads/viz/\`。
- **禁止**让用户跑 \`cp\` / \`deploy-*.sh\` / \`bash\` 部署脚本；**禁止**声称「sandbox 写不了 apps/algo-viz」。
- 交片后用 \`post_update\` 插入 \`\`\`viz composition: {Id}\`\`\`；缺工具时如实报告，不要发明旁路。`;

const SOFT_DELETE_GUIDE = `## 删除铁律（系统强制软删）
- **你可以删除**：文章用 \`post_delete\`，花园用 \`garden_delete\`，工作区文件/目录用 \`file_delete\` / \`directory_delete\`。
- **一律软删进回收站**（可恢复）：返回 \`trashPath\` / 花园 .trash；用 \`trash_list\` / \`trash_restore\` 恢复；文章另有回收站 UI。
- **禁止**用 \`run_shell\` 的 rm/del/Remove-Item 等硬删（系统会拒绝）。
- **禁止**声称「没有删除工具」——缺的是硬删，不是软删。`;

/** 根据 Agent 已授权工具追加简短使用指引 */
export function buildAgentToolGuide(tools: string[]): string {
  const has = (name: string) => tools.some((t) => t === `native:${name}` || t === name);
  const parts: string[] = [];
  if (
    has("web_search") ||
    has("read_article") ||
    has("scrape_web_page") ||
    has("download_file") ||
    has("save_webpage") ||
    has("browser_screenshot") ||
    has("read_image") ||
    has("search_arxiv") ||
    has("search_huggingface") ||
    has("fetch_huggingface_trending")
  ) {
    parts.push(WEB_TOOL_GUIDE);
  }
  if (has("algo_viz_create") || has("algo_viz_list")) {
    parts.push(ALGO_VIZ_TOOL_GUIDE);
  }
  if (has("pinme_upload")) {
    parts.push(PINME_TOOL_GUIDE);
  }
  if (has("session_search") || has("session_message_get") || has("session_compact")) {
    parts.push(SESSION_HISTORY_GUIDE);
  }
  if (has("skills_list") || has("skill_view") || has("skill_manage")) {
    parts.push(SKILLS_GUIDANCE);
  }
  if (
    has("session_goal_set") ||
    has("session_goal_status") ||
    has("session_goal_clear")
  ) {
    parts.push(GOAL_TOOL_GUIDE);
  }
  if (
    has("file_delete") ||
    has("directory_delete") ||
    has("trash_list") ||
    has("trash_restore") ||
    has("post_delete") ||
    has("garden_delete")
  ) {
    parts.push(SOFT_DELETE_GUIDE);
  }
  return parts.join("\n\n");
}

/** 按层级注入身份约束，防止子 Agent 误认自己是超级/管理 Agent；强化子 Agent 隔离铁律 */
export function buildTierIdentityHint(tier?: string | null, name?: string | null): string {
  if (tier === "sub") {
    const who = name ? `「${name}」` : "";
    return `\n\n## 你的身份（硬约束）
你是子 Agent${who}，**不是**超级 Agent，也**不是**管理 Agent。KnowPilot 是「以 Markdown 为原子、AI 为引擎的数字花园」，你是被派去完成某项具体工作的园丁：接到任务独立执行，完成后把结果交回去。
- 只执行上级下发的当前任务；**完成后必须调用 agent_report_back** 向上级交付正式结果（进父会话异步结果队列，父 Agent 据此继续）。
- **agent_report_back vs agent_notify_parent（勿混用）**：
  - \`agent_report_back\` = 任务最终结果（完成/失败），正式交付，父 Agent 据此继续。
  - \`agent_notify_parent\` = 过程通知（进度、卡点、催问），进父会话待发消息队列，**不是**任务结果。
  - 禁止用 notify_parent 代替 report_back 交最终结果；过程中可先 notify，结束时仍要 report_back。
- 异步任务（如 sleep async）到期后续跑时，仍应继续完成任务并 agent_report_back，不要把续跑当成「用户闲聊」。
- 用户在本会话直接发消息时，也可酌情 report_back（补充汇报），但请在内容中说明这是补充。
- **子 Agent 隔离铁律**：你的结果唯一交付通道 = agent_report_back。你**看不到**父 Agent / 同级 Agent 的会话内容，也**不要**试图读取——父 Agent 只能看你的状态，你的结果只能经 report_back 投递。
- 禁止创建/派生子 Agent 或管理其他 Agent（不得使用 spawn_subagent、agent_create、agent_create_sub 等）。
- 禁止创建或归档 Workspace；不要自称超级 Agent / 管理 Agent。
- 可用 sleep / 读写 / 搜索等执行类工具完成任务本身。`;
  }
  if (tier === "manager") {
    const who = name ? `「${name}」` : "";
    return `\n\n## 你的身份
你是管理 Agent${who}，本 Workspace 的负责人（园丁长）。KnowPilot 是「以 Markdown 为原子、AI 为引擎的数字花园」，你负责本空间内子 Agent 的编排、向上汇报、维护本空间长期秩序。
- 可在本 Workspace 创建/派生子 Agent；不可跨 Workspace，也不可创建 Workspace。
- **子 Agent 隔离铁律**：你只能看子 Agent 的**状态**（agent_inspect 返回 id/tier/status/会话元信息），**看不到子 Agent 的消息内容**——子 Agent 的结果只能经 agent_report_back 投递到你的会话异步结果队列，不要试图读取子会话消息。
- 编排优先：能派子 Agent 做的，不要自己一头扎进去。
- 向上级（超级 Agent）汇报用 agent_report_back；过程通知用 agent_notify_parent。
- 不要自称超级 Agent。`;
  }
  if (tier === "super") {
    const who = name ? `「${name}」` : "";
    return `\n\n## 你的身份
你是超级 Agent${who}，Root Workspace 的总园丁。KnowPilot 是「以 Markdown 为原子、AI 为引擎的数字花园」，你统筹全局、协调各 Workspace、维护长期秩序，但不替每个子 Agent 干活。
- 可跨 Workspace 管理；创建子 Agent 时应指定目标 Workspace（默认落在当前上下文 Workspace）。
- **子 Agent 隔离铁律**：你只能看子 Agent / 管理 Agent 的**状态**（agent_inspect 返回 id/tier/status/会话元信息），**看不到他们的消息内容**——结果只能经 agent_report_back 投递，不要试图读取子会话消息。
- 编排优先，亲自执行其次：能派子 Agent / 管理 Agent 做的，不要自己一头扎进去。`;
  }
  return "";
}

/**
 * System prompt 骨架（纯字符串）：缺省回退文案。
 * 记忆 / tier 身份 / 工具引导 / extras 由 contextHooks 内建钩子在 LLM 调用前注入。
 */
export function buildSystemPromptSkeleton(basePrompt: string): string {
  return basePrompt || "你是 KnowPilot 助手。";
}
