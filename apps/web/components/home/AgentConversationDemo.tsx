"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView } from "framer-motion";
import Link from "next/link";
import { CurlyMark, SquareMark } from "@/components/home/accentMark";
import { ScrollReveal } from "@/components/magicui/scroll-reveal";
import { useMainScrollRoot } from "@/components/layout/MainScrollContext";
import { cn } from "@/lib/utils";

/* ——— 自绘 SVG ——— */

function IconSpark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden>
      <path
        d="M10 2.2 11.2 7.5 16.5 8.8 11.2 10.1 10 15.4 8.8 10.1 3.5 8.8 8.8 7.5 10 2.2Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M15.2 3.2v2.4M16.4 4.4h-2.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function IconThink({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden>
      <circle cx="10" cy="9" r="5.2" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M7.2 14.2c.8 1.4 1.8 2.2 2.8 2.2s2-.8 2.8-2.2"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <path d="M8.2 8.2h.01M10 8.2h.01M11.8 8.2h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconTool({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden>
      <path
        d="M12.8 4.2a3.2 3.2 0 0 0-4.1 3.9L4.2 12.6a1.4 1.4 0 0 0 2 2l4.5-4.5a3.2 3.2 0 0 0 3.9-4.1l-1.6 1.6-1.6-1.6 1.4-1.8Z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconCheck({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden>
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.4" opacity="0.35" />
      <path
        d="M6.5 10.2 9 12.6 13.6 7.6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconSpin({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={cn(className, "animate-spin")} fill="none" aria-hidden>
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.4" opacity="0.25" />
      <path d="M10 3a7 7 0 0 1 7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function IconChatArrow({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden>
      <path
        d="M4 10h10.5M11 5.5 15.5 10 11 14.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconReplay({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden>
      <path d="M4.5 10a5.5 5.5 0 1 0 1.6-3.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path
        d="M4 4.8v3.2h3.2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconBubble({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden>
      <path
        d="M4 5.5A2.5 2.5 0 0 1 6.5 3h7A2.5 2.5 0 0 1 16 5.5v5A2.5 2.5 0 0 1 13.5 13H9l-3.2 2.4V13H6.5A2.5 2.5 0 0 1 4 10.5v-5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconChevron({ className, open }: { className?: string; open?: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={cn(className, "transition-transform duration-300", open && "rotate-180")}
      fill="none"
      aria-hidden
    >
      <path d="M5 7.5 10 12.5 15 7.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ——— 三场景 · 合计 ≥4 轮 ——— */

type ToolStatus = "pending" | "running" | "done";

interface ToolCall {
  name: string;
  summary: string;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
}

interface DemoTurn {
  user: string;
  thinking: string;
  tools: ToolCall[];
  assistant: string;
}

interface Scenario {
  id: string;
  label: string;
  hint: string;
  turns: DemoTurn[];
}

const SCENARIOS: Scenario[] = [
  {
    id: "distill",
    label: "蒸馏落盘",
    hint: "收藏 → 草稿 → 提醒",
    turns: [
      {
        user: "把这篇知乎收藏蒸馏成花园草稿，偏好：偏短、带行动项。",
        thinking: "先 memory_search 偏好，再 read_article 抓正文；长文 spawn 润色园丁，最后 post_create。",
        tools: [
          {
            name: "memory_search",
            summary: "命中写作偏好",
            args: { query: "写作偏好 行动项", scopes: ["agent", "global"] },
            result: { hits: 2, top: "偏短 · 带行动项 · 少形容词" },
          },
          {
            name: "read_article",
            summary: "正文 4.2k 字",
            args: { url: "https://zhuanlan.zhihu.com/p/…", maxChars: 8000, offset: 0 },
            result: { contentChars: 4200, nextOffset: 4200, title: "本地优先的知识工作" },
          },
          {
            name: "spawn_subagent",
            summary: "润色园丁 · 同步等待",
            args: { goal: "压到 120 字摘要 + 3 行动项", waitForResult: true },
            result: { status: "completed", agent: "润色园丁", jobId: "job_8f2a" },
          },
          {
            name: "post_create",
            summary: "写入花园草稿",
            args: { title: "见微：把碎片养成文章", garden: "posts", published: false },
            result: { slug: "garden-draft", id: "post_91c" },
          },
        ],
        assistant: "草稿已写入 posts/garden-draft。摘要约 120 字、三条行动项就绪；偏好已记入 Memory。",
      },
      {
        user: "标题再锐利一点，并加两个标签。",
        thinking: "局部改写：post_update 标题与 tags，不必重跑整条蒸馏链。",
        tools: [
          {
            name: "post_update",
            summary: "改标题 + 标签",
            args: {
              slug: "garden-draft",
              title: "见微：碎片进园，三日成文",
              tags: ["本地优先", "蒸馏品味"],
            },
            result: { ok: true, updatedAt: "2026-08-07T00:12:00Z" },
          },
        ],
        assistant: "已改成《见微：碎片进园，三日成文》，标签：本地优先、蒸馏品味。",
      },
      {
        user: "明早 9 点催我改第二段。",
        thinking: "定时催办：memory 记意图 + task/cron 挂点，确认文案回会话。",
        tools: [
          {
            name: "memory_create",
            summary: "记催改进度",
            args: { type: "episodic", content: "催改 garden-draft 第二段", strength: 0.8 },
            result: { id: "mem_44", scope: "agent" },
          },
          {
            name: "task_create",
            summary: "cron 明早 9:00",
            args: { cron: "0 9 * * *", text: "改《碎片进园》第二段", deliverToQueue: true },
            result: { taskId: "task_c3", nextRunAt: "明天 09:00" },
          },
        ],
        assistant: "已挂明早 09:00 提醒，会推到本会话；也可在 /cron 改时间。",
      },
      {
        user: "把摘要发到飞书文档末尾。",
        thinking: "集成通道：feishu_append_doc_text，带上摘要即可，不碰知识库正文。",
        tools: [
          {
            name: "feishu_append_doc_text",
            summary: "追加到飞书 doc",
            args: { docToken: "doccn…", text: "## 见微摘要\n碎片进园，三日成文…" },
            result: { ok: true, blocksAppended: 2 },
          },
        ],
        assistant: "摘要已追加到飞书文档末尾。花园里的 Markdown 仍是事实源。",
      },
      {
        user: "再搜一下相关视频字幕，贴进草稿附录。",
        thinking: "video_transcript 抓字幕，再 post_update 追加附录段。",
        tools: [
          {
            name: "video_transcript",
            summary: "B 站字幕",
            args: { url: "https://www.bilibili.com/video/BV…", includeSummary: true },
            result: { platform: "bilibili", transcriptChars: 8600, summary: "本地优先与文件主权…" },
          },
          {
            name: "post_update",
            summary: "追加附录",
            args: { slug: "garden-draft", appendSection: "## 附录 · 视频笔记" },
            result: { ok: true, charsAdded: 920 },
          },
        ],
        assistant: "字幕要点已写入附录。完整逐字稿在 Workspace，需要我再展开某一段可以说。",
      },
    ],
  },
  {
    id: "swarm",
    label: "多智能体",
    hint: "派工 · 汇报 · 汇总",
    turns: [
      {
        user: "开一个 Workspace「算法可视化」，派管理 Agent 搭骨架。",
        thinking: "workspace_create 带 withManager，再 agent_create_sub 挂资料员。",
        tools: [
          {
            name: "workspace_create",
            summary: "业务 Workspace",
            args: { name: "算法可视化", withManager: true, initialTask: "搭 Remotion 骨架" },
            result: { workspaceId: "ws_algo", managerId: "ag_mgr_12" },
          },
          {
            name: "agent_create_sub",
            summary: "资料整理员",
            args: { name: "资料整理员", parentId: "ag_mgr_12", tools: ["native:web_search", "native:read_article"] },
            result: { agentId: "ag_sub_77", tier: "sub" },
          },
        ],
        assistant: "Workspace「算法可视化」已建，管理 Agent 在位；资料整理员已挂到其下。",
      },
      {
        user: "让资料员搜两篇 FFT 可视化参考，汇报给你。",
        thinking: "经管理 Agent 派 spawn；结果只能走 report_back，我不窥子会话正文。",
        tools: [
          {
            name: "spawn_subagent",
            summary: "资料员检索",
            args: { agentId: "ag_sub_77", goal: "FFT 可视化参考 ×2", waitForResult: false },
            result: { jobId: "job_fft1", status: "running" },
          },
          {
            name: "agent_inspect",
            summary: "只看状态",
            args: { agentId: "ag_sub_77" },
            result: { status: "running", sessions: 1, messageCount: 4, note: "无消息正文" },
          },
        ],
        assistant: "已派资料员异步检索。我会等 report_back；你可在左侧看到子 Agent 状态更新。",
      },
      {
        user: "他回了吗？汇总进一篇短文。",
        thinking: "消费异步结果队列，再 post_create；不经 invoke_api 读子会话。",
        tools: [
          {
            name: "async_task_status",
            summary: "任务已完成",
            args: { jobId: "job_fft1" },
            result: { status: "completed", delivered: true, hint: "结果已自动投递" },
          },
          {
            name: "post_create",
            summary: "写入短文",
            args: { title: "FFT 可视化两则参考", garden: "knowledge", excerpt: "频谱与时域并置…" },
            result: { slug: "fft-viz-refs", id: "post_ab2" },
          },
        ],
        assistant: "子 Agent 已 report_back。短文《FFT 可视化两则参考》写进 knowledge 花园。",
      },
      {
        user: "给管理 Agent 发一句：下周做交互 scrub。",
        thinking: "agent_send_message 走服务端队列；对方 busy 会 drain，不丢消息。",
        tools: [
          {
            name: "agent_send_message",
            summary: "上行指令入队",
            args: { toAgentId: "ag_mgr_12", content: "下周优先做交互 scrub 时间轴" },
            result: { queued: true, queueDepth: 1 },
          },
        ],
        assistant: "已入管理 Agent 队列。他空闲后会自动 drain 处理。",
      },
      {
        user: "资料员闲着的话，再补一版「常见坑」清单。",
        thinking: "agent_inspect 确认 idle，再 spawn 第二轮；结果仍走 report_back。",
        tools: [
          {
            name: "agent_inspect",
            summary: "子 Agent 空闲",
            args: { agentId: "ag_sub_77" },
            result: { status: "idle", sessions: 1, messageCount: 9 },
          },
          {
            name: "spawn_subagent",
            summary: "补坑清单",
            args: { agentId: "ag_sub_77", goal: "FFT 可视化常见坑 ×5", waitForResult: true },
            result: { jobId: "job_fft2", status: "completed" },
          },
        ],
        assistant: "第二轮已跑完。五条常见坑已 report_back，要我并进那篇短文吗？",
      },
      {
        user: "并进去，然后归档这个 Workspace 的今日进度。",
        thinking: "post_update 合并内容；memory_create 记 workspace 层进度。",
        tools: [
          {
            name: "post_update",
            summary: "合并坑点",
            args: { slug: "fft-viz-refs", appendSection: "## 常见坑" },
            result: { ok: true, sections: 3 },
          },
          {
            name: "memory_create",
            summary: "Workspace 进度",
            args: {
              type: "episodic",
              scope: "workspace:ws_algo",
              content: "FFT 参考文 + 坑点清单已落盘",
            },
            result: { id: "mem_ws9", scope: "workspace:ws_algo" },
          },
        ],
        assistant: "已合并进短文，并在 Workspace 记忆里记了今日进度。管理 Agent 下次心跳能看见。",
      },
    ],
  },
  {
    id: "ops",
    label: "提醒审批",
    hint: "登录 · 审批 · 推送",
    turns: [
      {
        user: "帮我确认知乎登录态，过期就弹窗重登。",
        thinking: "先 browser_login_status；未登录再 platform_login，禁止截图绕路。",
        tools: [
          {
            name: "browser_login_status",
            summary: "检查各平台",
            args: { platforms: ["zhihu"] },
            result: { zhihu: { loggedIn: false, cookie: "missing z_c0" } },
          },
          {
            name: "platform_login",
            summary: "弹窗登录知乎",
            args: { platform: "zhihu", timeoutSec: 180 },
            result: { success: true, cookies: ["z_c0"], storageStateKb: 48 },
          },
        ],
        assistant: "知乎原先未登录，已弹出浏览器完成登录并保存 storageState。",
      },
      {
        user: "删掉上周那篇失败的 smoke 测试文，走审批。",
        thinking: "破坏性操作走审批闸门；挂起 awaiting_human，等你点通过。",
        tools: [
          {
            name: "post_delete",
            summary: "等待审批",
            args: { slug: "smoke-post-e2e-0812" },
            result: {
              status: "awaiting_human",
              approvalId: "appr_91",
              decisionScope: "post:delete:smoke-post-e2e-0812",
            },
          },
        ],
        assistant: "已挂起审批「删除 smoke-post-e2e-0812」。通过后我会继续；也可在 /approvals 处理。",
      },
      {
        user: "通过。删完用 QQ 回我一声。",
        thinking: "审批通过后续跑；send_qq_text 走 ChannelBinding 推送。",
        tools: [
          {
            name: "approval_resolve",
            summary: "批准删除",
            args: { approvalId: "appr_91", decision: "approve" },
            result: { status: "executed", deleted: true },
          },
          {
            name: "send_qq_text",
            summary: "QQ 文本推送",
            args: { text: "smoke 测试文已删除 ✓" },
            result: { ok: true, segments: 1 },
          },
        ],
        assistant: "已删除并经 QQ 通知你。审批记录保留在库里可审计。",
      },
      {
        user: "把今天的心跳决策摘要发邮件给我。",
        thinking: "读心跳决策日志，send_email 发出；EMAIL_PROVIDER 未配则降级说明。",
        tools: [
          {
            name: "memory_search",
            summary: "心跳摘要",
            args: { query: "heartbeat_decision today", type: "experience" },
            result: { hits: 1, summary: "quiet→monitor · skipRemaining=1" },
          },
          {
            name: "send_email",
            summary: "发送摘要",
            args: { subject: "[KnowPilot 通知] 心跳决策", body: "今日 quiet→monitor…" },
            result: { ok: true, provider: "ntfy" },
          },
        ],
        assistant: "心跳摘要已发出（ntfy）。需要改通知通道可在设置里调 EMAIL_PROVIDER。",
      },
    ],
  },
];

type Phase =
  | { kind: "idle" }
  | { kind: "user"; turn: number }
  | { kind: "thinking"; turn: number }
  | { kind: "tools"; turn: number; toolIndex: number }
  | { kind: "reply"; turn: number; chars: number }
  | { kind: "done" };

function MacDots() {
  return (
    <div className="flex items-center gap-1.5" aria-hidden>
      <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
    </div>
  );
}

function ToolCard({
  tool,
  status,
  defaultOpen,
}: {
  tool: ToolCall;
  status: ToolStatus;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (defaultOpen && status === "done") setOpen(true);
  }, [defaultOpen, status]);

  const canExpand = status === "done" || status === "running";

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border text-[11px] transition-colors",
        status === "running" && "border-[var(--kp-brand)]/35 bg-[var(--kp-brand-soft)]/70",
        status === "done" && "border-white/60 bg-white/65",
        status === "pending" && "border-transparent bg-transparent opacity-40",
      )}
    >
      <button
        type="button"
        disabled={!canExpand}
        onClick={() => canExpand && setOpen((v) => !v)}
        className={cn(
          "flex w-full items-start gap-2 px-2.5 py-2 text-left",
          canExpand && "cursor-pointer hover:bg-white/40",
          !canExpand && "cursor-default",
        )}
      >
        <span className="mt-0.5 shrink-0 text-[var(--kp-brand)]">
          {status === "running" ? (
            <IconSpin className="h-3.5 w-3.5" />
          ) : status === "done" ? (
            <IconCheck className="h-3.5 w-3.5" />
          ) : (
            <IconTool className="h-3.5 w-3.5 opacity-50" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-mono font-semibold text-[var(--kp-text-1)]">{tool.name}</span>
            <span className="text-[var(--kp-text-2)]">{tool.summary}</span>
          </div>
        </div>
        {canExpand && (
          <IconChevron className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--kp-text-3)]" open={open} />
        )}
      </button>

      <AnimatePresence initial={false}>
        {open && canExpand && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="overflow-hidden border-t border-white/50"
          >
            <div className="grid gap-2 px-2.5 py-2 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--kp-brand)]">
                  Args
                </p>
                <pre className="max-h-28 overflow-auto rounded-lg bg-[var(--kp-text-1)]/[0.04] p-2 font-mono text-[10px] leading-relaxed text-[var(--kp-text-2)]">
                  {JSON.stringify(tool.args, null, 2)}
                </pre>
              </div>
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--kp-accent-deep)]">
                  Result
                </p>
                <pre className="max-h-28 overflow-auto rounded-lg bg-[var(--kp-text-1)]/[0.04] p-2 font-mono text-[10px] leading-relaxed text-[var(--kp-text-2)]">
                  {status === "running" ? "…" : JSON.stringify(tool.result, null, 2)}
                </pre>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export function AgentConversationDemo() {
  const scrollRoot = useMainScrollRoot();
  const sectionRef = useRef<HTMLElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const inView = useInView(sectionRef, {
    root: scrollRoot ?? undefined,
    once: true,
    amount: 0.22,
  });
  const reduced = usePrefersReducedMotion();
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [runId, setRunId] = useState(0);

  const scenario = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0];
  const turns = scenario.turns;

  useEffect(() => {
    if (!inView && runId === 0) return;

    const script =
      SCENARIOS.find((s) => s.id === scenarioId)?.turns ?? SCENARIOS[0].turns;

    let cancelled = false;
    const timeouts: number[] = [];
    const wait = (ms: number) =>
      new Promise<void>((r) => {
        timeouts.push(window.setTimeout(r, ms));
      });

    const play = async () => {
      setPhase({ kind: "idle" });
      if (reduced) {
        setPhase({ kind: "done" });
        return;
      }
      await wait(180);
      for (let t = 0; t < script.length; t++) {
        if (cancelled) return;
        setPhase({ kind: "user", turn: t });
        await wait(560);
        if (cancelled) return;
        setPhase({ kind: "thinking", turn: t });
        await wait(900);
        if (cancelled) return;
        for (let i = 0; i < script[t].tools.length; i++) {
          if (cancelled) return;
          setPhase({ kind: "tools", turn: t, toolIndex: i });
          await wait(520);
        }
        if (cancelled) return;
        const full = script[t].assistant;
        const step = Math.max(2, Math.ceil(full.length / 36));
        for (let c = step; c <= full.length + step; c += step) {
          if (cancelled) return;
          setPhase({ kind: "reply", turn: t, chars: Math.min(c, full.length) });
          await wait(28);
        }
        await wait(380);
      }
      if (!cancelled) setPhase({ kind: "done" });
    };

    play().catch(() => {});
    return () => {
      cancelled = true;
      for (const id of timeouts) window.clearTimeout(id);
    };
  }, [inView, runId, reduced, scenarioId]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, [phase, reduced]);

  const switchScenario = (id: string) => {
    if (id === scenarioId) return;
    setScenarioId(id);
    setRunId((n) => n + 1);
  };

  const maxTurn =
    phase.kind === "idle" ? -1 : phase.kind === "done" ? turns.length - 1 : phase.turn;
  const turnVisible = (t: number) => t <= maxTurn || phase.kind === "done";

  return (
    <section
      ref={sectionRef}
      className="relative overflow-hidden px-6 py-12 lg:px-12 lg:py-16"
      aria-label="Agent 多场景对话演示"
    >
      <div className="relative z-10 mx-auto max-w-7xl">
        <ScrollReveal className="mb-6 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--kp-brand)]">
              Agent Studio
            </p>
            <h2 className="text-2xl font-bold tracking-tight text-[var(--kp-text-1)] md:text-3xl">
              三场景 · <CurlyMark>多轮工作流</CurlyMark>
            </h2>
          </div>
          <p className="max-w-md text-sm text-[var(--kp-text-2)]">
            蒸馏落盘（5）/ 多智能体（6）/ 提醒审批（4）。工具卡可展开 Args / Result。
            <SquareMark className="ml-1 text-xs font-semibold">可展开</SquareMark>
          </p>
        </ScrollReveal>

        {/* 场景切换 */}
        <div className="mb-4 flex flex-wrap gap-2">
          {SCENARIOS.map((s) => {
            const active = s.id === scenarioId;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => switchScenario(s.id)}
                className={cn(
                  "rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-all",
                  active
                    ? "border-[var(--kp-brand)]/40 bg-[var(--kp-brand)] text-white shadow-[0_8px_20px_-10px_rgba(0,135,235,0.55)]"
                    : "border-white/60 bg-white/55 text-[var(--kp-text-2)] hover:border-[var(--kp-brand)]/30 hover:text-[var(--kp-brand)]",
                )}
              >
                {s.label}
                <span className={cn("ml-1.5 font-normal", active ? "text-white/80" : "text-[var(--kp-text-3)]")}>
                  {s.hint}
                </span>
              </button>
            );
          })}
        </div>

        <div className="grid items-stretch gap-6 lg:grid-cols-[1.45fr_0.65fr]">
          <motion.div
            key={scenarioId}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ y: -4 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
            className="group/chat kp-card-topline kp-card-sheen overflow-hidden rounded-[1.5rem] border border-white/55 bg-white/55 shadow-[0_20px_56px_-22px_rgba(0,80,160,0.28)] backdrop-blur-xl transition-[border-color,box-shadow] duration-500 hover:border-[var(--kp-brand)]/30 hover:shadow-[0_28px_64px_-22px_rgba(0,135,235,0.34)]"
          >
            <div className="flex items-center justify-between border-b border-white/50 px-4 py-3">
              <div className="flex items-center gap-3">
                <MacDots />
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[var(--kp-brand-soft)] text-[var(--kp-brand)]">
                    <IconSpark className="h-3.5 w-3.5" />
                  </span>
                  <div>
                    <p className="text-xs font-bold text-[var(--kp-text-1)]">见微助手</p>
                    <p className="text-[10px] text-[var(--kp-text-3)]">
                      {scenario.label} · {turns.length} 轮
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {(phase.kind === "done" || phase.kind === "idle") && !reduced && inView && (
                  <button
                    type="button"
                    onClick={() => setRunId((n) => n + 1)}
                    className="inline-flex items-center gap-1 rounded-full border border-white/60 bg-white/70 px-2.5 py-1 text-[10px] font-medium text-[var(--kp-text-2)] transition hover:border-[var(--kp-brand)]/35 hover:text-[var(--kp-brand)]"
                  >
                    <IconReplay className="h-3 w-3" />
                    重播
                  </button>
                )}
                <span className="rounded-full border border-white/60 bg-white/70 px-2.5 py-0.5 font-mono text-[10px] text-[var(--kp-text-2)]">
                  deepseek-v4
                </span>
              </div>
            </div>

            <div
              ref={scrollerRef}
              className={cn(
                "flex max-h-[460px] min-h-[380px] flex-col gap-4 overflow-y-auto px-4 py-4 md:max-h-[480px] md:px-5",
                /* 默认隐藏滚动条，仅鼠标在整张对话卡片内时显示 */
                "[scrollbar-width:none] [&::-webkit-scrollbar]:w-0 [&::-webkit-scrollbar]:h-0",
                "group-hover/chat:[scrollbar-width:thin] group-hover/chat:[&::-webkit-scrollbar]:w-2 group-hover/chat:[&::-webkit-scrollbar]:h-2",
                "group-focus-within/chat:[scrollbar-width:thin] group-focus-within/chat:[&::-webkit-scrollbar]:w-2 group-focus-within/chat:[&::-webkit-scrollbar]:h-2",
              )}
            >
              {phase.kind === "idle" && (
                <div className="flex flex-1 items-center justify-center text-xs text-[var(--kp-text-3)]">
                  滚动到此处开始回放…
                </div>
              )}

              {phase.kind !== "idle" &&
                turns.map((turn, t) => {
                  if (!turnVisible(t) && phase.kind !== "done") return null;
                  const p = phase;
                  const showUser = p.kind === "done" || ("turn" in p && p.turn >= t);
                  const showThink =
                    p.kind === "done" ||
                    (p.kind === "thinking" && p.turn === t) ||
                    (p.kind === "tools" && p.turn === t) ||
                    (p.kind === "reply" && p.turn === t) ||
                    ("turn" in p && p.turn > t);
                  const showTools =
                    p.kind === "done" ||
                    (p.kind === "tools" && p.turn === t) ||
                    (p.kind === "reply" && p.turn === t) ||
                    ("turn" in p && p.turn > t);
                  const toolIndex =
                    p.kind === "done" || ("turn" in p && p.turn > t)
                      ? turn.tools.length - 1
                      : p.kind === "tools" && p.turn === t
                        ? p.toolIndex
                        : p.kind === "reply" && p.turn === t
                          ? turn.tools.length - 1
                          : -1;
                  const showReply =
                    p.kind === "done" ||
                    (p.kind === "reply" && p.turn === t) ||
                    ("turn" in p && p.turn > t);
                  const replyChars =
                    p.kind === "done" || ("turn" in p && p.turn > t)
                      ? turn.assistant.length
                      : p.kind === "reply" && p.turn === t
                        ? p.chars
                        : 0;
                  const thinkLive = p.kind === "thinking" && p.turn === t;

                  if (!showUser) return null;

                  return (
                    <div key={`${scenarioId}-${t}`} className="flex flex-col gap-2.5">
                      <div className="my-0.5 flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-[var(--kp-text-3)]">
                        <span className="h-px flex-1 bg-[var(--kp-divider)]" />
                        Round {t + 1}
                        <span className="h-px flex-1 bg-[var(--kp-divider)]" />
                      </div>

                      <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="ml-auto max-w-[92%] rounded-2xl rounded-br-md bg-[var(--kp-brand)] px-3.5 py-2.5 text-[13px] leading-relaxed text-white shadow-[0_10px_24px_-12px_rgba(0,135,235,0.55)]"
                      >
                        {turn.user}
                      </motion.div>

                      {showThink && (
                        <div className="rounded-xl border border-white/55 bg-white/50 px-3 py-2">
                          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-[var(--kp-text-2)]">
                            <IconThink
                              className={cn(
                                "h-3.5 w-3.5 text-[var(--kp-brand)]",
                                thinkLive && "animate-pulse",
                              )}
                            />
                            {thinkLive ? "Thinking…" : "Thought"}
                          </div>
                          <p className="text-[12px] leading-relaxed text-[var(--kp-text-2)]">
                            {turn.thinking}
                          </p>
                        </div>
                      )}

                      {showTools && toolIndex >= 0 && (
                        <div className="space-y-1.5 border-l-2 border-[var(--kp-brand)]/20 pl-2.5">
                          {turn.tools.slice(0, toolIndex + 1).map((tool, i) => {
                            let status: ToolStatus = "done";
                            if (p.kind === "tools" && p.turn === t) {
                              status =
                                i < p.toolIndex
                                  ? "done"
                                  : i === p.toolIndex
                                    ? "running"
                                    : "pending";
                            }
                            return (
                              <ToolCard
                                key={`${tool.name}-${i}`}
                                tool={tool}
                                status={status}
                                defaultOpen={p.kind === "done" && i === 0 && t === turns.length - 1}
                              />
                            );
                          })}
                        </div>
                      )}

                      {showReply && replyChars > 0 && (
                        <div className="mr-auto max-w-[94%] rounded-2xl rounded-bl-md border border-white/60 bg-white/85 px-3.5 py-3 text-[13px] leading-relaxed text-[var(--kp-text-1)] shadow-sm">
                          {turn.assistant.slice(0, replyChars)}
                          {p.kind === "reply" && p.turn === t && (
                            <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-[2px] animate-pulse bg-[var(--kp-brand)]" />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </motion.div>

          <ScrollReveal delay={0.08} className="flex flex-col justify-center gap-3">
            <motion.div
              whileHover={{ y: -5, scale: 1.015 }}
              transition={{ type: "spring", stiffness: 260, damping: 24 }}
              className="rounded-2xl border border-white/55 bg-white/50 p-5 shadow-[0_12px_36px_-18px_rgba(0,80,160,0.18)] backdrop-blur-xl transition-[border-color,box-shadow] duration-500 hover:border-[var(--kp-brand)]/35 hover:shadow-[0_20px_48px_-16px_rgba(0,135,235,0.28)]"
            >
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--kp-brand)]">
                当前场景
              </p>
              <p className="text-sm font-bold text-[var(--kp-text-1)]">{scenario.label}</p>
              <p className="mt-1 text-xs text-[var(--kp-text-2)]">{scenario.hint}</p>
              <ul className="mt-4 space-y-2.5 text-sm text-[var(--kp-text-2)]">
                <li className="flex gap-2">
                  <IconThink className="mt-0.5 h-4 w-4 shrink-0 text-[var(--kp-brand)]" />
                  每轮含思考过程
                </li>
                <li className="flex gap-2">
                  <IconTool className="mt-0.5 h-4 w-4 shrink-0 text-[var(--kp-accent-deep)]" />
                  工具卡可展开 Args / Result
                </li>
                <li className="flex gap-2">
                  <IconBubble className="mt-0.5 h-4 w-4 shrink-0 text-[var(--kp-brand)]" />
                  本场景 {turns.length} 轮（各场景 4–6 轮不等）
                </li>
              </ul>
              <Link
                href="/chat"
                className="group mt-5 inline-flex h-10 items-center gap-1.5 rounded-full bg-[var(--kp-brand)] px-5 text-xs font-semibold text-white shadow-[0_10px_28px_-8px_rgba(0,135,235,0.55)] transition-transform duration-300 hover:-translate-y-0.5 hover:bg-[var(--kp-brand-dark)]"
              >
                <IconBubble className="h-3.5 w-3.5" />
                开始真实对话
                <IconChatArrow className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </motion.div>

            <motion.div
              whileHover={{ y: 2, scale: 0.99 }}
              transition={{ type: "spring", stiffness: 280, damping: 24 }}
              className="rounded-2xl border border-white/55 bg-white/40 p-4 text-[11px] leading-relaxed text-[var(--kp-text-3)] backdrop-blur-xl transition-[border-color,box-shadow,background-color] duration-500 hover:border-[var(--kp-accent)]/35 hover:bg-white/55 hover:shadow-[inset_0_2px_10px_rgba(0,80,160,0.06)]"
            >
              切换场景会重播该场景剧本。点开工具卡片可看入参与返回，对齐真实 Chat 时间线。
            </motion.div>
          </ScrollReveal>
        </div>
      </div>
    </section>
  );
}
