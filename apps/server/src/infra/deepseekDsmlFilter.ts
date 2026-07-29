/**
 * DeepSeek V4 DSML 工具调用标记过滤器。
 *
 * 模型在 tool_choice=auto + stream 时偶发把内部标记漏进 content：
 *   <｜DSML｜tool_calls> … <｜DSML｜invoke name="web_search"> …
 * 用户会看到「乱码标签」叠在工具卡片旁。业界已知（vLLM #40801）。
 *
 * 流式：缓冲可能的标记前缀，确认是 DSML 则吞掉整块；流结束无 tool_calls 再 flush。
 * 非流式：整段 strip。
 */

/** 全角竖线 ｜ (U+FF5C) 与 ASCII | 都认 */
const DSML_OPEN_RE =
  /<(?:｜|\|)DSML(?:｜|\|)tool_calls(?:\s*)>/i;
const DSML_CLOSE_RE =
  /<\/(?:｜|\|)DSML(?:｜|\|)tool_calls(?:\s*)>/i;
/** 裸 invoke 碎片（缺外层 wrapper 时） */
const DSML_INVOKE_RE =
  /<(?:｜|\|)DSML(?:｜|\|)invoke\b[\s\S]*?(?:<\/(?:｜|\|)DSML(?:｜|\|)invoke(?:\s*)>|(?=<(?:｜|\|)DSML)|$)/gi;
const DSML_PARAM_RE =
  /<(?:｜|\|)DSML(?:｜|\|)parameter\b[\s\S]*?(?:<\/(?:｜|\|)DSML(?:｜|\|)parameter(?:\s*)>|(?=<(?:｜|\|)DSML)|$)/gi;

/** 可能构成 DSML 开标签的后缀前缀（跨 chunk） */
const PARTIAL_PREFIXES = [
  "<",
  "<|",
  "<｜",
  "<|D",
  "<｜D",
  "<|DS",
  "<｜DS",
  "<|DSM",
  "<｜DSM",
  "<|DSML",
  "<｜DSML",
  "<|DSML|",
  "<｜DSML｜",
  "<|DSML|t",
  "<｜DSML｜t",
  "<|DSML|to",
  "<｜DSML｜to",
  "<|DSML|too",
  "<｜DSML｜too",
  "<|DSML|tool",
  "<｜DSML｜tool",
  "<|DSML|tool_",
  "<｜DSML｜tool_",
  "<|DSML|tool_c",
  "<｜DSML｜tool_c",
  "<|DSML|tool_ca",
  "<｜DSML｜tool_ca",
  "<|DSML|tool_cal",
  "<｜DSML｜tool_cal",
  "<|DSML|tool_call",
  "<｜DSML｜tool_call",
  "<|DSML|tool_calls",
  "<｜DSML｜tool_calls",
  "<|DSML|tool_calls>",
  "<｜DSML｜tool_calls>",
  "</",
  "</|",
  "</｜",
  "</|D",
  "</｜D",
  "</|DS",
  "</｜DS",
  "</|DSM",
  "</｜DSM",
  "</|DSML",
  "</｜DSML",
  "</|DSML|",
  "</｜DSML｜",
];

function endsWithPartialPrefix(s: string): string | null {
  for (const p of PARTIAL_PREFIXES) {
    if (s.endsWith(p)) return p;
  }
  // 更短的「尾部像前缀开头」
  const tail = s.slice(-24);
  for (let i = 1; i < tail.length; i++) {
    const suffix = tail.slice(i);
    if (PARTIAL_PREFIXES.some((p) => p.startsWith(suffix) && suffix.length > 0)) {
      // 仅当 suffix 是某前缀的真前缀（且不是普通文本常见结尾）才 hold
      if (suffix === "<" || suffix.startsWith("<|") || suffix.startsWith("<｜") || suffix.startsWith("</")) {
        return suffix;
      }
    }
  }
  return null;
}

/** 去掉完整 / 残缺 DSML 工具块，保留正常正文 */
export function stripDsmlToolMarkup(text: string): string {
  if (!text || (!text.includes("DSML") && !text.includes("dsml"))) return text;
  let out = text;
  // 成对 tool_calls 块
  out = out.replace(
    /<(?:｜|\|)DSML(?:｜|\|)tool_calls(?:\s*)>[\s\S]*?(?:<\/(?:｜|\|)DSML(?:｜|\|)tool_calls(?:\s*)>|$)/gi,
    "",
  );
  out = out.replace(DSML_INVOKE_RE, "");
  out = out.replace(DSML_PARAM_RE, "");
  // 残留开/闭标签
  out = out.replace(DSML_OPEN_RE, "");
  out = out.replace(DSML_CLOSE_RE, "");
  out = out.replace(/<\/?(?:｜|\|)DSML(?:｜|\|)[^>]*>/gi, "");
  return out;
}

export function looksLikeDsmlLeak(text: string): boolean {
  return /<(?:｜|\|)?DSML(?:｜|\|)?/i.test(text);
}

/**
 * 流式过滤器：hold 可疑前缀；完整 DSML 块不向外发；
 * 若同流随后出现 structured tool_calls，缓冲哨兵整段丢弃。
 */
export class DsmlStreamFilter {
  private hold = "";
  private insideBlock = false;
  private suppressedForTools = false;

  /** 本流已见到 structured tool_calls → 后续 content 里 DSML 一律丢 */
  markStructuredToolCalls(): void {
    this.suppressedForTools = true;
    this.hold = "";
    this.insideBlock = false;
  }

  push(delta: string): string {
    if (!delta) return "";
    if (this.suppressedForTools && looksLikeDsmlLeak(delta)) {
      return stripDsmlToolMarkup(delta);
    }

    let incoming = this.hold + delta;
    this.hold = "";
    let emit = "";

    while (incoming.length > 0) {
      if (this.insideBlock) {
        const closeIdx = incoming.search(DSML_CLOSE_RE);
        if (closeIdx >= 0) {
          const m = incoming.match(DSML_CLOSE_RE);
          const end = closeIdx + (m?.[0].length ?? 0);
          incoming = incoming.slice(end);
          this.insideBlock = false;
          continue;
        }
        // 未闭合：整段继续 hold（不泄露）
        this.hold = incoming;
        incoming = "";
        break;
      }

      const openIdx = incoming.search(DSML_OPEN_RE);
      if (openIdx >= 0) {
        emit += incoming.slice(0, openIdx);
        const m = incoming.match(DSML_OPEN_RE);
        const start = openIdx + (m?.[0].length ?? 0);
        incoming = incoming.slice(start);
        this.insideBlock = true;
        continue;
      }

      // 也可能整段就是残缺 DSML（无完整 open）
      if (looksLikeDsmlLeak(incoming) && !DSML_OPEN_RE.test(incoming)) {
        // 含 DSML 但开标签不完整或已是 invoke 碎片
        const cleaned = stripDsmlToolMarkup(incoming);
        const partial = endsWithPartialPrefix(cleaned);
        if (partial && cleaned.endsWith(partial)) {
          emit += cleaned.slice(0, cleaned.length - partial.length);
          this.hold = partial;
        } else {
          emit += cleaned;
        }
        incoming = "";
        break;
      }

      const partial = endsWithPartialPrefix(incoming);
      if (partial) {
        emit += incoming.slice(0, incoming.length - partial.length);
        this.hold = partial;
        incoming = "";
        break;
      }

      emit += incoming;
      incoming = "";
    }

    return emit;
  }

  /** 流结束：若仍 hold 且不像 DSML，放出；否则 strip 后放出 */
  flush(): string {
    if (!this.hold && !this.insideBlock) return "";
    if (this.insideBlock || looksLikeDsmlLeak(this.hold)) {
      const out = stripDsmlToolMarkup(this.hold);
      this.hold = "";
      this.insideBlock = false;
      return out;
    }
    const out = this.hold;
    this.hold = "";
    return out;
  }
}
