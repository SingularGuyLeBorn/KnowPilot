/**
 * 工具调用死循环熔断（DeerFlow LoopDetection 启发）。
 * 纯函数：同参连续 / 同名变参刷屏 / 双指纹交替 → 阻断。
 */

export type ToolCallFingerprintInput = {
  name: string;
  args: Record<string, unknown>;
};

export type LoopGuardState = {
  /** fingerprint → 连续命中次数（中间被不同 call 打断则归零该链） */
  streakFp: string | null;
  streakCount: number;
  /** 同工具名连续次数（忽略 args，防微调参数刷屏） */
  lastName: string | null;
  nameStreak: number;
  /** 本 run 已见过的指纹历史（最近 N） */
  recent: string[];
};

export type LoopGuardVerdict =
  | { blocked: false; state: LoopGuardState }
  | {
      blocked: true;
      state: LoopGuardState;
      fingerprint: string;
      message: string;
    };

const DEFAULT_STREAK = 3;
/** 同名不同参连续上限（默认 2× 同参阈值） */
const DEFAULT_NAME_STREAK = 6;
const RECENT_CAP = 32;
const OSCILLATION_WINDOW = 6;

/**
 * 知识库勘察类只读工具：连续 list/read 不同路径是正常推进，
 * 不计入「同名变参刷屏」与「双指纹交替」；仍受同参 fingerprint 熔断约束。
 */
const EXPLORE_READONLY_TOOLS = new Set([
  "list_directory",
  "read_file",
  "post_list",
  "garden_list",
  "garden_get",
  "search_files",
  "glob_files",
  // 连续换 URL/关键词勘察也是推进，不是死循环
  "read_article",
  "scrape_web_page",
  "memory_search",
  "memory_daily_search",
  "todo_read",
  "browser_login_status",
  "web_search",
  "search_arxiv",
  "fetch_arxiv",
  "search_huggingface",
  "literature_search",
  "literature_get",
  "video_transcript",
  "media_download",
  "audio_transcribe",
  "video_notes",
  "tikhub_request",
  "inbox_list",
  "inbox_stats",
  "inbox_enrich",
  "inbox_capture_url",
  "inbox_capture_urls",
  "inbox_scan_screenshots",
  "inbox_platform_sync_status",
  "inbox_sync_zhihu",
  "inbox_sync_xhs",
  "inbox_sync_bilibili",
  "session_search",
  "rss_fetch",
  // 场景 B 资料员：连存多页 / 连截多屏是推进
  "save_webpage",
  "download_file",
  "article_material_pack",
  "browser_screenshot",
  "scroll_screenshot",
  "read_image",
  "vision_describe",
  // 状态轮询（换 jobId / 平台）
  "async_task_status",
  "platform_login",
  "agent_inspect",
]);

function isExploreReadonlyTool(name: string): boolean {
  return EXPLORE_READONLY_TOOLS.has(String(name || "").replace(/^native:/, ""));
}

/** 稳定序列化：键排序，避免同参不同字段序误判为不同 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function toolCallFingerprint(call: ToolCallFingerprintInput): string {
  const name = String(call.name || "").replace(/^native:/, "");
  return `${name}::${stableStringify(call.args ?? {})}`;
}

export function createLoopGuardState(): LoopGuardState {
  return { streakFp: null, streakCount: 0, lastName: null, nameStreak: 0, recent: [] };
}

/** 最近 window 条是否在两个指纹间严格交替（A/B/A/B…） */
export function detectOscillation(recent: string[], window = OSCILLATION_WINDOW): string | null {
  if (recent.length < window || window < 4) return null;
  const slice = recent.slice(-window);
  const a = slice[0]!;
  const b = slice[1]!;
  if (!a || !b || a === b) return null;
  for (let i = 0; i < window; i++) {
    if (slice[i] !== (i % 2 === 0 ? a : b)) return null;
  }
  return `${a.slice(0, 60)} ⇄ ${b.slice(0, 60)}`;
}

/**
 * 检查本批 tool calls；命中任一类死循环模式则 blocked。
 * 1) 同 fingerprint 连续 ≥ streakLimit
 * 2) 同工具名连续 ≥ nameStreakLimit（变参刷屏）
 * 3) 最近 window 条双指纹交替
 */
export function checkToolLoop(
  state: LoopGuardState,
  calls: ToolCallFingerprintInput[],
  streakLimit = DEFAULT_STREAK,
  nameStreakLimit = DEFAULT_NAME_STREAK,
): LoopGuardVerdict {
  let streakFp = state.streakFp;
  let streakCount = state.streakCount;
  let lastName = state.lastName;
  let nameStreak = state.nameStreak;
  const recent = [...state.recent];

  for (const call of calls) {
    const name = String(call.name || "").replace(/^native:/, "");
    const fp = toolCallFingerprint(call);

    if (streakFp === fp) {
      streakCount += 1;
    } else {
      streakFp = fp;
      streakCount = 1;
    }

    const explore = isExploreReadonlyTool(name);
    if (!explore) {
      if (lastName === name) {
        nameStreak += 1;
      } else {
        lastName = name;
        nameStreak = 1;
      }
    } else {
      // 勘察工具打断「写/搜」类同名 streak，避免读完目录后误连坐
      lastName = null;
      nameStreak = 0;
    }

    recent.push(fp);
    while (recent.length > RECENT_CAP) recent.shift();

    const next: LoopGuardState = { streakFp, streakCount, lastName, nameStreak, recent };

    if (streakCount >= streakLimit) {
      return {
        blocked: true,
        state: next,
        fingerprint: fp,
        message:
          `检测到工具死循环：连续 ${streakCount} 次相同调用（${fp.slice(0, 120)}）。` +
          `请改换策略或向用户说明卡点，禁止再以相同参数重试。`,
      };
    }

    if (!explore && nameStreak >= nameStreakLimit) {
      return {
        blocked: true,
        state: next,
        fingerprint: fp,
        message:
          `检测到工具死循环：连续 ${nameStreak} 次调用同一工具「${name}」（参数在变但仍无进展）。` +
          `请改换工具或策略，禁止继续微调参数重试。`,
      };
    }

    // 勘察类 A/B 交替读文件是常态，不做乒乓熔断
    if (!explore) {
      const osc = detectOscillation(recent);
      if (osc) {
        return {
          blocked: true,
          state: next,
          fingerprint: fp,
          message:
            `检测到工具死循环：在两种调用间交替（${osc}）。` +
            `请停止乒乓调用，改换策略或向用户说明卡点。`,
        };
      }
    }
  }

  return {
    blocked: false,
    state: { streakFp, streakCount, lastName, nameStreak, recent },
  };
}
